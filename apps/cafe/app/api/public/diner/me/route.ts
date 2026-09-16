import { DINER_ME_RATE_MAX, dinerMeBucket } from "@pos/shared/public-diner";
import { connectDB } from "@/lib/db";
import { hitRateLimit } from "@/lib/public-rate-limit";
import { failure, serverError, success } from "@/lib/api-helpers";
import { readSettings } from "@/lib/settings";
import { Customer } from "@/models/Customer";
import { readDinerSession, readDinerSessionToken, endDinerSession } from "@/lib/diner-session";
import {
  dinerAccountsOn,
  dinerLoyaltyOn,
  hashSource,
  noStoreDiner,
} from "@/lib/diner-route-guard";
import { resolveLoyaltyConfig, dinerStampCard, type DinerStampCard } from "@/lib/diner-loyalty";
import { isAssignedRewardExpired } from "@pos/shared/public-promo";
import type { IAssignedReward } from "@/models/Customer";

export const dynamic = "force-dynamic";

// Deliberately vague and transient-sounding: this is a "you are going too fast"
// signal, not a statement about the account.
const DINER_LOOKUP_BUSY = "Too many requests — please wait a moment.";

// CB-5D part 2 — one assigned reward as sent to the phone. Dates become epoch
// MS (never an ISO string): the diner client compares this straight against
// `Date.now()` to grey out an about-to-expire reward, and an ISO string would
// have to be re-parsed for that on every render — epoch ms is also what
// isAssignedRewardExpired itself takes, so the route and the client share one
// unit with no conversion step anywhere.
export interface DinerAssignedReward {
  code: string;
  at: number;
  kind: string;
  assignedAt: number;
  expiresAt?: number;
}

interface DinerMeData {
  // null = not signed in. A 200-with-null rather than a 401: "are you signed
  // in?" is the question this route EXISTS to answer, so not being signed in
  // is a valid answer, not an error the diner UI has to catch.
  diner: { name: string; mobile: string } | null;
  // Absent unless the cafe runs the stamp card AND the caller is signed in.
  stampCard?: DinerStampCard;
  // Absent unless the cafe runs loyalty, the caller is signed in, AND at
  // least one assigned reward survives the filters below (omit-empty,
  // matching stampCard).
  rewards?: DinerAssignedReward[];
}

// CB-5D part 2 — turns one stored IAssignedReward into its wire shape, and is
// also the FILTER: returns null for a reward that must never reach the phone
// at all — spent (`usedAt` set, so it is never offered again) or expired
// (isAssignedRewardExpired against `now`, so a dead code doesn't even round-trip).
function dinerRewardOf(reward: IAssignedReward, now: number): DinerAssignedReward | null {
  if (reward.usedAt) return null;
  const expiresAt = reward.expiresAt ? reward.expiresAt.getTime() : undefined;
  if (isAssignedRewardExpired(expiresAt, now)) return null;
  return {
    code: reward.code,
    at: reward.at,
    kind: reward.kind,
    assignedAt: reward.assignedAt.getTime(),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

// The single "not signed in" answer, so every one of the four ways to reach it
// (accounts off, no cookie, unknown/expired token, deleted customer) is
// byte-identical to the caller — none of them is distinguishable from another.
const NOT_SIGNED_IN: DinerMeData = { diner: null };

// GET /api/public/diner/me — who is this device signed in as, and how far
// along is their stamp card.
//
// This payload names ONE diner, so it must never be cached anywhere: no-store
// (noStoreDiner) is the whole defence against the next phone on the same cafe
// WiFi being handed the previous diner's card. It is also why none of this
// rides the SHARED, 30s-cached /api/public/menu payload.
export async function GET(req: Request) {
  try {
    await connectDB();
    const settings = await readSettings();
    if (!dinerAccountsOn(settings)) {
      return noStoreDiner(success(NOT_SIGNED_IN));
    }

    // Metered BEFORE the two uncached DB round-trips below (the session row and
    // the customer). This is a read, but an unauthenticated and uncached one,
    // so without a bucket it is a cheap way to hammer a 512MB M0. Keyed on the
    // caller's OWN session token (no DB hit — it is just the cookie value) so
    // one diner's polling can never spend another's budget; a caller with no
    // cookie shares a per-source bucket instead. The cap is deliberately
    // generous: the shell calls this once per page load and once per sign-in,
    // so a real diner never meets it.
    const token = await readDinerSessionToken();
    const bucketKey = token ?? `src:${hashSource(req.headers.get("x-forwarded-for"))}`;
    const decision = await hitRateLimit(dinerMeBucket(bucketKey), DINER_ME_RATE_MAX, Date.now());
    if (!decision.allowed) {
      const res = noStoreDiner(failure(DINER_LOOKUP_BUSY, 429));
      res.headers.set("Retry-After", String(decision.retryAfterSec));
      return res;
    }

    const session = await readDinerSession();
    if (!session) return noStoreDiner(success(NOT_SIGNED_IN));

    // The session row is denormalised, so this read exists to confirm the
    // account still EXISTS and to fetch live stamp counts. A session whose
    // customer has been deleted resolves to "not signed in" and the cookie is
    // cleared, rather than leaving a device holding a handle to nothing.
    const customer = await Customer.findById(session.customerId)
      .select("name mobile stamps stampsLifetime rewards")
      .lean();
    if (!customer) {
      await endDinerSession();
      return noStoreDiner(success(NOT_SIGNED_IN));
    }

    const diner = { name: customer.name, mobile: customer.mobile };
    if (!dinerLoyaltyOn(settings)) {
      return noStoreDiner(success({ diner } satisfies DinerMeData));
    }
    const config = resolveLoyaltyConfig(settings);
    // A reward list is loyalty data (assigned by a milestone claim), gated the
    // same way the stamp card is — never sent unless the cafe runs loyalty.
    const rewards = (customer.rewards ?? [])
      .map((r) => dinerRewardOf(r, Date.now()))
      .filter((r): r is DinerAssignedReward => r !== null);
    return noStoreDiner(
      success({
        diner,
        stampCard: dinerStampCard(customer.stamps ?? 0, customer.stampsLifetime ?? 0, config),
        // Omit-empty (matching stampCard's own gating): no key at all when
        // every assigned reward was filtered out above.
        ...(rewards.length > 0 ? { rewards } : {}),
      } satisfies DinerMeData),
    );
  } catch (error) {
    return noStoreDiner(serverError("Could not load your account", error));
  }
}
