import { DINER_SCRATCH_RATE_MAX, dinerScratchBucket } from "@pos/shared/public-diner";
import {
  CARD_NOT_SCRATCHABLE,
  CARDS_SIGN_IN,
  SCRATCH_BUSY,
  SCRATCH_PAUSED,
  type DinerScratchData,
} from "@pos/shared/public-diner-cards";
import { REWARD_CARD_ID_RE } from "@pos/shared/reward-levels";
import { connectDB } from "@/lib/db";
import { failure, serverError, success } from "@/lib/api-helpers";
import { readSettings } from "@/lib/settings";
import { hitRateLimit } from "@/lib/public-rate-limit";
import { readDinerSession, readDinerSessionToken } from "@/lib/diner-session";
import { DINER_ACCOUNTS_OFF_MESSAGE, dinerAccountsOn, noStoreDiner } from "@/lib/diner-route-guard";
import { scratchRewardCard } from "@/lib/reward-card-scratch";

export const dynamic = "force-dynamic";

const SCRATCH_RATE_LIMITED = "Too many requests — please wait a moment.";

type Params = { params: Promise<{ id: string }> };

// POST /api/public/diner/cards/[id]/scratch — reveal one of the signed-in diner's cards (CB-7 S4).
//
// A malformed id is answered FIRST, before any database call. Then the same chain as GET /cards: accounts off ->
// 404, no cookie -> 401, rate limit (own token, before the uncached reads) -> 429, session -> 401. The diner's id
// comes ONLY from the session, never from the URL or body (no body is read). Refusals are fixed copy; ONE 404 covers
// an expired card, an unknown id and another diner's card, so the route cannot be used to tell them apart. The
// diner cookie is SameSite=lax, so a cross-site POST carries no session (parity with pin / logout).
export async function POST(_req: Request, { params }: Params) {
  try {
    const { id } = await params;
    if (!REWARD_CARD_ID_RE.test(id)) return noStoreDiner(failure(CARD_NOT_SCRATCHABLE, 404));

    await connectDB();
    const settings = await readSettings();
    if (!dinerAccountsOn(settings)) return noStoreDiner(failure(DINER_ACCOUNTS_OFF_MESSAGE, 404));

    const token = await readDinerSessionToken();
    if (!token) return noStoreDiner(failure(CARDS_SIGN_IN, 401));

    const decision = await hitRateLimit(dinerScratchBucket(token), DINER_SCRATCH_RATE_MAX, Date.now());
    if (!decision.allowed) {
      const res = noStoreDiner(failure(SCRATCH_RATE_LIMITED, 429));
      res.headers.set("Retry-After", String(decision.retryAfterSec));
      return res;
    }

    const session = await readDinerSession();
    if (!session) return noStoreDiner(failure(CARDS_SIGN_IN, 401));

    const result = await scratchRewardCard(settings, session.customerId, id);
    if (result.ok) return noStoreDiner(success({ card: result.card } satisfies DinerScratchData));
    if (result.reason === "paused") return noStoreDiner(failure(SCRATCH_PAUSED, 403));
    if (result.reason === "busy") return noStoreDiner(failure(SCRATCH_BUSY, 503));
    return noStoreDiner(failure(CARD_NOT_SCRATCHABLE, 404));
  } catch (error) {
    return noStoreDiner(serverError(SCRATCH_BUSY, error));
  }
}
