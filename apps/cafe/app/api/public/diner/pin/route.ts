import { checkBotId } from "botid/server";
import { NextResponse } from "next/server";

import { normalizePublicMobile, PUBLIC_MOBILE_PATTERN } from "@pos/shared/public";
import {
  DINER_PIN_RATE_MAX,
  DINER_PIN_SHAPE,
  DINER_PIN_WEAK,
  dinerPinBucket,
} from "@pos/shared/public-diner";
import { connectDB } from "@/lib/db";
import { failure, serverError, success } from "@/lib/api-helpers";
import { resolveTenantFromHost } from "@/lib/tenant";
import { readSettings } from "@/lib/settings";
import { Customer } from "@/models/Customer";
import { hitRateLimit } from "@/lib/public-rate-limit";
import { checkDinerPinShape, hashDinerPin } from "@/lib/diner-pin";
import { startDinerSession } from "@/lib/diner-session";
import { dinerAccountsOn, DINER_ACCOUNTS_OFF_MESSAGE, noStoreDiner } from "@/lib/diner-route-guard";

export const dynamic = "force-dynamic";

// Deliberately the SAME message for "this mobile already has a PIN" and for a
// generic refusal. An attacker must not be able to use this route to learn
// which mobile numbers already hold an account — that is the same enumeration
// oracle the login route closes, and it would be pointless to close it there
// and re-open it here.
const PIN_SETUP_REFUSED =
  "We couldn't set a PIN for that number. Please ask at the counter.";

// POST /api/public/diner/pin — a diner sets their OWN PIN for the first time.
//
// THE RULE THIS ROUTE EXISTS TO ENFORCE: a PIN may only ever be set on an
// account that does NOT already have one. Anything else would let anybody who
// knows a mobile number overwrite that diner's PIN and take the account — the
// mobile number alone is NOT a secret (it is printed on every bill and known
// to anyone who has seen the diner's phone). Changing or clearing an EXISTING
// PIN is therefore a STAFF action at the counter, never a public one, which is
// exactly the recovery model the phase brief chose in place of OTP.
//
// The claim is still only as strong as "possession of a mobile number", which
// is why this sets a PIN on an account that has none rather than proving
// ownership: the fence is that it can never TAKE an account that is already
// claimed, and staff at the counter can always reset one that is.
export async function POST(req: Request) {
  try {
    const bot = await checkBotId();
    if (bot.isBot) return noStoreDiner(failure(PIN_SETUP_REFUSED, 403));

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
        ? (body as { mobile?: unknown; pin?: unknown; name?: unknown })
        : {};
    const rawMobile = typeof shaped.mobile === "string" ? shaped.mobile.trim() : "";
    const name = typeof shaped.name === "string" ? shaped.name.trim() : "";
    if (!PUBLIC_MOBILE_PATTERN.test(rawMobile)) {
      return noStoreDiner(failure(PIN_SETUP_REFUSED, 400));
    }
    const mobile = normalizePublicMobile(rawMobile);

    // Metered on the SAME per-mobile bucket the login route charges: without
    // this, an attacker blocked by login's limit could just probe here
    // instead, and the two routes would fence different things. Charged BEFORE
    // any customer read, so a probe costs a slot whatever the outcome.
    const limited = await hitRateLimit(dinerPinBucket(mobile), DINER_PIN_RATE_MAX, Date.now());
    if (!limited.allowed) {
      const res = noStoreDiner(failure(PIN_SETUP_REFUSED, 429));
      res.headers.set("Retry-After", String(limited.retryAfterSec));
      return res;
    }

    // Shape and strength are reported HONESTLY (unlike the account state
    // below): these are facts about the PIN the caller just typed, and they
    // reveal nothing about any account. Hiding them would only mean a diner
    // cannot tell why their PIN was refused.
    const shapeError = checkDinerPinShape(shaped.pin);
    if (shapeError === "shape") return noStoreDiner(failure(DINER_PIN_SHAPE, 400));
    if (shapeError === "weak") return noStoreDiner(failure(DINER_PIN_WEAK, 400));
    const pin = shaped.pin as string;

    const pinHash = await hashDinerPin(pin);

    // THE FENCE, as a CAS: `pinHash: { $exists: false }` lives in the update
    // FILTER, so the write is conditional in the database rather than after a
    // read — two concurrent claims on the same fresh account cannot both
    // observe "no PIN yet" and both win. matchedCount === 0 means the account
    // already had a PIN (or does not exist), and both answer the same way.
    const claimed = await Customer.findOneAndUpdate(
      { mobile, pinHash: { $exists: false } },
      { $set: { pinHash, pinSetAt: new Date() }, $inc: { pinVersion: 1 } },
      { new: true },
    )
      .select("name mobile")
      .lean();

    if (!claimed) {
      // No such customer, or one that already has a PIN — indistinguishable on
      // purpose. A diner in this position is told to ask at the counter, which
      // is exactly where a real reset happens.
      return noStoreDiner(failure(PIN_SETUP_REFUSED, 409));
    }

    // A Customer row exists only once staff have accepted an order from this
    // diner, so `name` is already theirs; a supplied name is used ONLY to fill
    // a blank, never to overwrite what the cafe has on file.
    if (name.length > 0 && claimed.name.length === 0) {
      await Customer.updateOne({ _id: claimed._id }, { $set: { name } });
    }

    await startDinerSession(String(claimed._id), claimed.mobile);
    return noStoreDiner(success({ name: claimed.name || name, mobile: claimed.mobile }));
  } catch (error) {
    return noStoreDiner(serverError(PIN_SETUP_REFUSED, error));
  }
}
