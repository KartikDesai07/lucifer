import type { CreatePublicOrderRequestInput } from "@pos/shared/schemas/public-order.schema";
import type { ISettings } from "@/models/Settings";
import { Customer } from "@/models/Customer";
import { readDinerSession } from "@/lib/diner-session";
import { Table } from "@/models/Table";
import { hasOpenTabNow } from "@/lib/order-request-intake";
import {
  canonicalPromoMobile,
  REWARD_NEEDS_SIGN_IN,
  REWARD_NOT_ON_CARD,
  REWARD_NOT_ENOUGH_STAMPS,
  REWARD_BILL_TOO_SMALL,
  REWARD_PROMO_EXCLUSIVE,
  REWARD_ON_OPEN_TAB,
} from "@pos/shared/public";
import { findMilestoneAt } from "@/lib/reward-claim";
import { decideRedemption } from "@/lib/reward-redemption";
import { isRungClaimWindowClosed, REWARD_CLAIM_WINDOW_CLOSED } from "@pos/shared/public-promo";

// CB-5B S8 (owner decision D4) — the DINER-ORIGINATED reward claim's
// quote-time gate. Sibling of lib/order-request-create.ts's
// resolveRequestPromo, deliberately its own file rather than +80 lines there
// (179 already, ~300 cap) because it is its own concern: the promo resolver
// answers "does this code still apply", this one answers "may this diner ask
// to spend their own stamps here".
//
// WHAT THIS IS NOT: it is NOT the spend. No stamps move here, and nothing this
// returns is a grant. A request is pre-money — it can be rejected, expire, or
// drift — so a rejected request must cost no stamps. The actual claim happens
// at ACCEPT (lib/order-request-accept*.ts), against the diner's own Customer
// row, keyed on the orderId that actually lands, and it re-resolves everything
// below from live state: this gate exists only so a diner is not told a doomed
// claim "worked" and then billed full price at the counter.

// Diner-facing copy lives in @pos/shared/public-promo (imported above), NOT
// here: the client bundle must classify these same 422s to revert the
// selection, and it cannot import this module (Mongoose). One home, two
// importers — a wording change on a money path can never land on one side
// only. A2/D6 (reward and promo are mutually exclusive, because an Order
// carries ONE scalar and ONE kind) is what REWARD_PROMO_EXCLUSIVE states.

export type RewardIntentResult =
  // The diner asked for nothing, or asked for something they may ask for. The
  // `at` is echoed back rather than re-read from `data` so the ONE validated
  // value is what gets stored.
  | { requestedRewardAt?: number }
  | { error: string };

/**
 * Decide whether this submission may CARRY a reward intent.
 *
 * Gates, in this order (each is a thing the diner can act on):
 *  1. Nothing asked -> nothing to check.
 *  2. A promo code is also present -> refuse (A2/D6, direction 2). The
 *     reciprocal fence — a promo arriving onto a tab that already carries a
 *     reward — lives in lib/order-request-accept-addround.ts. Every writer of
 *     a mutually-exclusive pair must guard it, or the pair only holds from one
 *     side (the reciprocal-CAS-guards lesson).
 *  3. A DINER SESSION IS REQUIRED. Stamps live on a Customer row, so an
 *     anonymous QR order has no balance to spend. The body's `mobile` is NOT
 *     an identity — it is diner-typed text, so trusting it here would let
 *     anyone spend any stranger's stamps by typing their number. Only the
 *     signed-in session's own customerId is ever used.
 *  4. The rung must exist in the OWNER-configured ladder (and not be
 *     ambiguous — findMilestoneAt refuses a duplicate `at` rather than
 *     silently taking the first, because a legacy Settings doc predates the
 *     save-time uniqueness refinement).
 *  5. The balance and the per-milestone minBill must allow it, priced against
 *     the quote the diner is looking at.
 *
 * The balance read here is a COURTESY, never the fence: claimRewardStamps
 * carries `stamps: {$gte: cost}` in its own update FILTER, so the real check
 * is atomic at accept time against another device spending the same stamps in
 * between.
 */
export async function resolveRequestReward(
  data: CreatePublicOrderRequestInput,
  settings: ISettings | null,
  quotedTotal: number,
): Promise<RewardIntentResult> {
  if (data.requestedRewardAt === undefined) return {};

  if (data.promoCode) return { error: REWARD_PROMO_EXCLUSIVE };

  const session = await readDinerSession();
  if (!session) return { error: REWARD_NEEDS_SIGN_IN };

  // IDENTITY BINDING — the claim must belong to the person whose stamps it
  // spends. This gate validates the balance on the SESSION's row, but the
  // accept bridge attaches the order's customer by looking up
  // `request.mobile` (order-request-accept.ts step 5) — a body-supplied,
  // unauthenticated value. Without this check the two identities can differ:
  // a signed-in diner submitting a STRANGER'S mobile passes this gate on
  // their own balance and then spends the stranger's stamps at accept.
  //
  // Compared on the CANONICAL form, mirroring the promo fence's own key
  // (canonicalPromoMobile): "+91"/"0"/hyphen re-typings of one number are one
  // identity, so a diner is never locked out of their own reward by how they
  // typed their number. `data.mobile` has already been through the schema's
  // normalizePublicMobile transform; the session's stored value has not
  // necessarily been, so BOTH sides are canonicalised here rather than
  // trusting either to already match.
  if (canonicalPromoMobile(data.mobile) !== canonicalPromoMobile(session.mobile)) {
    return { error: REWARD_NEEDS_SIGN_IN };
  }

  // ADD-ROUND REFUSAL (review HIGH, confirmed by tracing the accept bridge).
  // The accept path resolves a reward claim ONLY on its create/parcel branch
  // (order-request-accept.ts); the add-round branch
  // (order-request-accept-addround.ts) re-derives the tab's EXISTING reward
  // from the Order snapshot and never reads `requestedRewardAt`. That is the
  // right shape — an Order carries ONE discount scalar and ONE kind, so a
  // second reward cannot be claimed onto a tab that may already carry one,
  // and the staff add-round writer refuses exactly the same way
  // ("This tab already has a reward applied").
  //
  // But a request submitted onto a table with a bill already running WILL be
  // classified add-round at accept. Without this refusal the diner is shown
  // "Reward selected — applied when the cafe accepts this order", the claim is
  // silently dropped, and they are billed full price with no message to
  // anyone. Refusing HERE is the only place the diner can still be told.
  //
  // Reads the ONE shared definition of "this table has a bill running"
  // (hasOpenTabNow) rather than re-deriving it, so this can never disagree
  // with what classifyTarget decides moments later. A parcel has no tab and is
  // unaffected.
  if (data.target.kind === "table") {
    const table = await Table.findOne({ publicToken: data.target.token }).select("tableNo").lean();
    // No table resolves here only if the token is bad, which the route itself
    // rejects before this gate ever runs — treated as "no open tab" rather
    // than inventing a second table-not-found path.
    if (table && (await hasOpenTabNow(table.tableNo))) {
      return { error: REWARD_ON_OPEN_TAB };
    }
  }

  const found = findMilestoneAt(settings, data.requestedRewardAt);
  // Both refusal reasons (no such rung / two rungs share that stamp count)
  // read the same to a diner: the card they are looking at cannot give them
  // this. The owner-actionable distinction belongs on the STAFF surface
  // (rewardClaimMessage), not on a public one that must never narrate the
  // cafe's configuration problems to a stranger.
  if (!found.ok) return { error: REWARD_NOT_ON_CARD };

  const customer = await Customer.findById(session.customerId).select("stamps rungEarnedAt").lean();
  if (!customer) return { error: REWARD_NEEDS_SIGN_IN };

  // CLAIM-WINDOW GATE — placed right after milestone resolution and before
  // the balance/minBill check below: like gate 4 above, this refuses on the
  // RUNG itself (its configured `claimWithinDays`) rather than on the bill
  // being quoted, so it belongs with the other "is this rung even claimable"
  // checks, ahead of "can THIS bill claim it". `.lean()` returns `rungEarnedAt`
  // as a plain object, NOT a Mongoose Map (Map instances are a Document-
  // hydration feature that lean skips entirely) — indexed as `[key]`, never
  // `.get(key)`, which would throw on a lean result. A rung never crossed is
  // simply an absent key, read as `undefined` and passed through as-is
  // (never coerced to 0/NaN): a customer with no recorded earn time for this
  // rung — every customer who crossed it before this feature shipped — must
  // read as "no deadline", not as an epoch-0 refusal that would lock out
  // every pre-existing diner.
  const earnedAt = customer.rungEarnedAt?.[String(found.milestone.at)];
  if (isRungClaimWindowClosed(earnedAt?.getTime(), found.milestone.claimWithinDays, Date.now())) {
    return { error: REWARD_CLAIM_WINDOW_CLOSED };
  }

  const decision = decideRedemption(customer.stamps ?? 0, found.milestone, quotedTotal);
  if (!decision.ok) {
    // Total mapping rather than an assertion: a reason added to
    // decideRedemption later must surface as a refusal, never an exception on
    // an unauthenticated write path. "no-milestone" cannot occur (one was
    // resolved above) but is mapped for the same reason.
    return {
      error:
        decision.reason === "insufficient-stamps"
          ? REWARD_NOT_ENOUGH_STAMPS
          : decision.reason === "below-min-bill"
            ? REWARD_BILL_TOO_SMALL
            : REWARD_NOT_ON_CARD,
    };
  }
  return { requestedRewardAt: data.requestedRewardAt };
}
