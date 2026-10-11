import { DINER_CARDS_RATE_MAX, dinerCardsBucket } from "@pos/shared/public-diner";
import { CARDS_LOAD_FAILED, CARDS_SIGN_IN } from "@pos/shared/public-diner-cards";
import { connectDB } from "@/lib/db";
import { failure, serverError, success } from "@/lib/api-helpers";
import { readSettings } from "@/lib/settings";
import { hitRateLimit } from "@/lib/public-rate-limit";
import { endDinerSession, readDinerSession, readDinerSessionToken } from "@/lib/diner-session";
import { DINER_ACCOUNTS_OFF_MESSAGE, dinerAccountsOn, noStoreDiner } from "@/lib/diner-route-guard";
import { readDinerCards } from "@/lib/reward-cards-read";

export const dynamic = "force-dynamic";

// A "you are going too fast" signal, not a statement about the account.
const CARDS_BUSY = "Too many requests — please wait a moment.";

// GET /api/public/diner/cards — the signed-in diner's scratch-card wallet (CB-7 S4).
//
// The payload names ONE diner and carries their cards, so EVERY return goes through noStoreDiner. The chain is
// fixed: accounts off -> 404 (no surface at all), no cookie -> 401, rate limit (keyed on the diner's own session
// token, BEFORE the two uncached reads below) -> 429, then the session, then the wallet. A ready card's outcome is
// never in the payload (lib/reward-cards-view.ts); an unknown / unreadable state answers fixed copy, never an error
// message.
export async function GET() {
  try {
    await connectDB();
    const settings = await readSettings();
    if (!dinerAccountsOn(settings)) return noStoreDiner(failure(DINER_ACCOUNTS_OFF_MESSAGE, 404));

    const token = await readDinerSessionToken();
    if (!token) return noStoreDiner(failure(CARDS_SIGN_IN, 401));

    const decision = await hitRateLimit(dinerCardsBucket(token), DINER_CARDS_RATE_MAX, Date.now());
    if (!decision.allowed) {
      const res = noStoreDiner(failure(CARDS_BUSY, 429));
      res.headers.set("Retry-After", String(decision.retryAfterSec));
      return res;
    }

    const session = await readDinerSession();
    if (!session) return noStoreDiner(failure(CARDS_SIGN_IN, 401));

    const data = await readDinerCards(settings, session.customerId);
    if (!data) {
      // The account was deleted: do not leave this device holding a handle to nothing (same as /me).
      await endDinerSession();
      return noStoreDiner(failure(CARDS_SIGN_IN, 401));
    }
    return noStoreDiner(success(data));
  } catch (error) {
    return noStoreDiner(serverError(CARDS_LOAD_FAILED, error));
  }
}
