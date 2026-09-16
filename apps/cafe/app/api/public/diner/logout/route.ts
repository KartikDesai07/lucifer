import { connectDB } from "@/lib/db";
import { serverError, success } from "@/lib/api-helpers";
import { endDinerSession } from "@/lib/diner-session";
import { noStoreDiner } from "@/lib/diner-route-guard";

export const dynamic = "force-dynamic";

// POST /api/public/diner/logout — signs THIS device out.
//
// Deliberately ungated beyond the cookie itself: no BotID, no host gate, no
// feature check. Every one of those would be a way for this to FAIL, and a
// sign-out that can fail is worse than one anybody can call — the worst a
// caller can do here is sign out a device they already hold the cookie for.
// It is also idempotent: with no cookie there is nothing to delete and the
// answer is still success.
//
// A cafe that switches diner accounts off mid-session must still be able to
// sign its diners out, which is the other reason this route does NOT gate on
// dinerAccountsOn.
export async function POST() {
  try {
    await connectDB();
    await endDinerSession();
    return noStoreDiner(success({ signedOut: true }));
  } catch (error) {
    return noStoreDiner(serverError("Could not sign you out", error));
  }
}
