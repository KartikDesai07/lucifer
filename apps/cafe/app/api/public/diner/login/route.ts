import { checkBotId } from "botid/server";
import { NextResponse } from "next/server";

import { PUBLIC_MOBILE_PATTERN } from "@pos/shared/public";
import {
  DINER_LOGIN_FAILED,
  DINER_LOGIN_RATE_LIMITED,
  isValidDinerPin,
} from "@pos/shared/public-diner";
import { connectDB } from "@/lib/db";
import { failure, serverError, success } from "@/lib/api-helpers";
import { resolveTenantFromHost } from "@/lib/tenant";
import { readSettings } from "@/lib/settings";
import { verifyDinerPin } from "@/lib/diner-pin";
import { startDinerSession, pruneDinerSessions } from "@/lib/diner-session";
import {
  dinerAccountsOn,
  DINER_ACCOUNTS_OFF_MESSAGE,
  hashSource,
  noStoreDiner,
} from "@/lib/diner-route-guard";

export const dynamic = "force-dynamic";

// POST /api/public/diner/login — mobile + 4-digit PIN, no OTP (the phase
// brief's cost decision: SMS OTP needs DLT registration at Rs 5-10k/yr per
// client, which breaks both "near-lifetime-free" and "an unpadh client must
// configure it easily"). A forgotten PIN is reset BY STAFF AT THE COUNTER.
//
// This is an unauthenticated public route, so it self-gates in the same order
// the sibling order-request route documents:
//   1. BotID — reject a scripted client first.
//   2. Host gate — /api is outside the middleware matcher, so this route is
//      the only thing standing between an unknown host and a login attempt.
//   3. Feature gate — a cafe with diner accounts switched OFF has no login.
//   4. Shape check — mobile + PIN, generic message, never echoing the body.
//   5. verifyDinerPin — which charges BOTH rate-limit buckets itself, before
//      it reads any customer, and spends the same bcrypt work whether or not
//      the mobile exists (see lib/diner-pin.ts for why that matters).
//
// The response NEVER distinguishes "no such mobile" from "wrong PIN": telling
// them apart would make this route an oracle for which mobile numbers hold an
// account at this cafe.
export async function POST(req: Request) {
  try {
    const bot = await checkBotId();
    if (bot.isBot) return noStoreDiner(failure(DINER_LOGIN_FAILED, 403));

    const tenant = await resolveTenantFromHost(req.headers.get("host"));
    const configuredTenant = process.env.TENANT_ID;
    if (!tenant || (configuredTenant && tenant.tenantId !== configuredTenant)) {
      return noStoreDiner(new NextResponse("Not found", { status: 404 }));
    }

    await connectDB();
    const settings = await readSettings();
    if (!dinerAccountsOn(settings)) {
      return noStoreDiner(failure(DINER_ACCOUNTS_OFF_MESSAGE, 404));
    }

    const body: unknown = await req.json().catch(() => null);
    const shaped =
      typeof body === "object" && body !== null
        ? (body as { mobile?: unknown; pin?: unknown })
        : {};
    const mobile = typeof shaped.mobile === "string" ? shaped.mobile.trim() : "";
    const pin = shaped.pin;

    // Shape failures return the SAME generic message as a wrong PIN. They are
    // still metered — verifyDinerPin charges the per-mobile bucket before it
    // does anything else — so a malformed PIN is not a free probe. A shape
    // check that short-circuits BEFORE metering would be exactly that.
    if (!PUBLIC_MOBILE_PATTERN.test(mobile) || !isValidDinerPin(pin)) {
      return noStoreDiner(failure(DINER_LOGIN_FAILED, 401));
    }

    // The SECONDARY, deliberately loose bucket: a whole cafe shares one WiFi
    // egress, so this can never be tight. Hashed, never stored raw — this
    // collection is rate-limit bookkeeping, not a visitor log, and a bucket id
    // that IS an IP address would make it one.
    const sourceKey = hashSource(req.headers.get("x-forwarded-for"));

    const result = await verifyDinerPin(mobile, pin, sourceKey);
    if (!result.ok) {
      if (result.reason === "rate-limited") {
        const res = noStoreDiner(failure(DINER_LOGIN_RATE_LIMITED, 429));
        res.headers.set("Retry-After", String(result.retryAfterSec));
        return res;
      }
      return noStoreDiner(failure(DINER_LOGIN_FAILED, 401));
    }

    await startDinerSession(result.customerId, result.mobile);
    // Opportunistic, best-effort, never scheduled (no cafe-side cron exists):
    // the same discipline as the order route's pruneRateWindows.
    await pruneDinerSessions();

    // The payload names the diner to THEMSELVES — never their spend, dues or
    // any other CRM field. Those belong to the staff surface.
    return noStoreDiner(success({ name: result.name, mobile: result.mobile }));
  } catch (error) {
    return noStoreDiner(serverError(DINER_LOGIN_FAILED, error));
  }
}
