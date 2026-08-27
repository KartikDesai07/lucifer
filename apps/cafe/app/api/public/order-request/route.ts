import mongoose from "mongoose";
import { NextResponse, after } from "next/server";
import { checkBotId } from "botid/server";

import {
  PARCEL_BUCKET_KEY,
  PUBLIC_ORDER_BODY_MAX_BYTES,
  PUBLIC_ORDER_RATE_MAX,
  PUBLIC_ORDER_RATE_MAX_PARCEL,
  type PublicOrderRequestCreatedData,
  PROMO_ALREADY_USED,
} from "@pos/shared/public";
import { createPublicOrderRequestSchema } from "@pos/shared/schemas/public-order.schema";
import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import { Product } from "@/models/Product";
import { OrderRequest } from "@/models/OrderRequest";
import { readSettings } from "@/lib/settings";
import { created, failure, notFound, serverError } from "@/lib/api-helpers";
import { resolveTenantFromHost } from "@/lib/tenant";
import { mintUniquePublicCode } from "@/lib/public-token";
import { hitRateLimit, peekRateLimit, pruneRateWindows, refundRateLimit } from "@/lib/public-rate-limit";
import { PUBLIC_PRODUCT_FILTER } from "@/lib/public-menu";
import { priceRequestItems, type PricedProductSource } from "@/lib/public-pricing";
import {
  buildRequestDoc,
  pruneOrderRequests,
  tableChargeAppliesNow,
  type IntakeTable,
} from "@/lib/order-request-intake";
import {
  resolveRequestPromo,
  honeypotFallback,
  buildHoneypotResponse,
  resolveAutoAcceptStatus,
  BOT_DENIED_MESSAGE,
  BODY_TOO_LARGE_MESSAGE,
  BAD_REQUEST_MESSAGE,
  TABLE_NOT_FOUND_MESSAGE,
  RATE_LIMITED_MESSAGE,
  ORDER_REQUEST_FAILED_MESSAGE,
} from "@/lib/order-request-create";
import { notifyRequestEvent, telegramSummaryOfCreate } from "@/lib/telegram/notify";

export const dynamic = "force-dynamic";

// POST /api/public/order-request — one of exactly TWO unauthenticated WRITEs
// in the app (the other is POST /api/telegram/webhook — CR2.3b, §21; secret-
// token gated). Everything else under app/api/public/** is a read; this route
// lets a diner's own phone, with no session and no login, create a real
// document. That makes it the highest-value target on the whole surface, so
// every control below runs in this EXACT order, and each is commented with
// its number so a future edit can't reorder past one without noticing:
//
//   1. Vercel BotID (checkBotId) — reject a scripted client before anything
//      else runs.
//   2. Host gate — mirrors middleware.ts's resolveTenantFromHost check. The
//      middleware matcher excludes /api entirely (see middleware.ts), so this
//      route is the ONLY thing standing between an unknown/mismatched host
//      and a write — it must self-gate, and it must do so before touching the
//      body.
//   3. Body size cap — reject an oversized payload before it is ever parsed,
//      measured in UTF-8 BYTES (Buffer.byteLength, not raw.length) — the body
//      is already fully buffered by req.text(), so this bounds PARSE/
//      VALIDATION work and storage, never network intake (Vercel's own
//      platform limit owns that).
//   4. JSON parse; the honeypot field (`hp`) is then lifted off the raw
//      parsed object and deleted from it BEFORE Zod ever sees the body (the
//      schema no longer declares the field at all), and Zod shape-validates
//      what's left. A malformed/off-shape body gets a generic message; the
//      raw body is never echoed back. `hp` is "filled" on ANY non-empty
//      value, not only a string — a deliberate non-string `hp` is still a
//      bot tell.
//   5. Honeypot branch — a filled `hp` is a bot. PEEKS (never increments)
//      the SAME rate bucket a real request would be charged, and — only if
//      that bucket is already at/over cap — skips straight to a zero-real-
//      work fallback instead of doing buildHoneypotResponse's own reads;
//      otherwise it gets the full PRETEND success (buildHoneypotResponse
//      below) built from the SAME real target-resolution + pricing work
//      (§6/§8) a genuine diner gets, but with every write skipped.
//   6. connectDB + target resolution — resolve the table (or accept "parcel"
//      with no table at all).
//   6.5. Table-charge session check (owner field-feedback 2026-08-20) —
//      tableChargeAppliesNow(table.tableNo), the SAME helper the sibling
//      GET /api/public/table/[token] route quotes off of, so what a diner is
//      shown before submitting can never disagree with what they're billed.
//   7. Rate limit, keyed on the TABLE TOKEN (or the shared parcel bucket) —
//      never the caller's IP. A cafe's WiFi is one shared egress: every
//      diner's phone at the table exits through the same handful of public
//      IPs (or the cafe's own NAT), so an IP-keyed limit would either starve
//      every diner in the room over one table's traffic or do nothing at all.
//      Keying on the token scopes the limit to what a diner actually shares —
//      their table.
//   8. Price the items against LIVE products, enforcing the PUBLIC menu rules
//      (PUBLIC_PRODUCT_FILTER — isActive AND publicVisible) — deliberately
//      STRICTER than the accept bridge's own re-validation (isActive only;
//      see lib/order-request-accept.ts's comment on why hidden-from-menu
//      products stay orderable once a request already exists).
//   9. readSettings (never getSettings — pinned below) + mint a unique
//      shortCode + persist the request.
//   9.5. Promo code (CR2.2c) — resolved against live Settings + the priced
//      subtotal via resolvePromoDiscount; a diner never sends an amount.
//      {error} is a 422 with that error verbatim (unknown/inactive/min-not-met).
//   10. Auto-accept branch, when the cafe's selfOrderMode is "auto".
//   11. Best-effort pruning of old rows, bounded to once per rate-limit
//       window (never on every hit).
//   12. Respond with the exact PublicOrderRequestCreatedData contract the
//       diner UI already consumes (packages/shared/src/public.ts).
//   12.5. Telegram (CR2.3b) — after() the response is sent, never before it,
//       and never in the honeypot branch (§5). Type is decided by the
//       resolved status, so one call covers both approve and auto mode.
//
// Never throws to the client (mirrors public-menu.ts/public-table/[token]):
// any uncaught failure degrades to a generic 503, never a stack trace or an
// echoed request body.

// Every response from this route is uncacheable (this is a write, and its
// success payload names a specific diner's order) and nosniff — mirrors the
// noStore helper in the sibling public GET routes.
function noStore<T extends { headers: Headers }>(res: T): T {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

export async function POST(req: Request) {
  try {
    // 1. Bot check. Always isBot:false in local dev (no client-side signal
    // was ever collected outside a real deploy) — the production curl-403 is
    // the deploy probe's success signal, not something reproducible here.
    const bot = await checkBotId();
    if (bot.isBot) return noStore(failure(BOT_DENIED_MESSAGE, 403));

    // 2. Host gate — same tenant + Tier-B assertion as middleware.ts, run by
    // hand because /api is outside the middleware's matcher.
    const tenant = await resolveTenantFromHost(req.headers.get("host"));
    const configuredTenant = process.env.TENANT_ID;
    if (!tenant || (configuredTenant && tenant.tenantId !== configuredTenant)) {
      return noStore(new NextResponse("Not found", { status: 404 }));
    }

    // 3. Body size cap — see the file-level comment for why bytes, not chars.
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > PUBLIC_ORDER_BODY_MAX_BYTES) {
      return noStore(failure(BODY_TOO_LARGE_MESSAGE, 413));
    }

    // 4. Parse. Neither failure below ever echoes `raw`.
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return noStore(failure(BAD_REQUEST_MESSAGE, 400));
    }

    // Honeypot lift — BEFORE Zod (see the file-level comment). Hazard-free:
    // `body` here is our own freshly parsed object, never re-served to any
    // caller. FIX-CR2.2 (non-string hp) — ANY non-empty value counts as
    // filled, not only a string: a deliberate non-string `hp` (an object, a
    // number, `true`) is still a bot tell, and the diner UI never sends this
    // field at all, so "absent" and "empty string" are the only honest values.
    const bodyObj =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : undefined;
    const hpFilled = bodyObj?.hp !== undefined && bodyObj.hp !== "";
    if (bodyObj) delete bodyObj.hp;

    // Shape-validate what's left.
    const parsed = createPublicOrderRequestSchema.safeParse(body);
    if (!parsed.success) return noStore(failure(BAD_REQUEST_MESSAGE, 400));
    const data = parsed.data;

    // Resolved once here (needs only `data.target`, no DB) — reused by both
    // the honeypot peek (§5) and the real hitRateLimit charge (§7) below, so
    // the two can never independently drift.
    const now = Date.now();
    const bucket = data.target.kind === "table" ? data.target.token : PARCEL_BUCKET_KEY;
    const max = data.target.kind === "table" ? PUBLIC_ORDER_RATE_MAX : PUBLIC_ORDER_RATE_MAX_PARCEL;

    // 5. Honeypot branch — see buildHoneypotResponse's own comment above.
    // FIX-CR2.2 (metering) — peek (never increments) the bucket a real
    // request would be charged; already at/over cap means this exact bucket
    // is already spent, so a bot gets the zero-real-work fallback instead of
    // buildHoneypotResponse's own Table/Product/Settings reads.
    if (hpFilled) {
      const peeked = await peekRateLimit(bucket, now);
      if (peeked >= max) {
        return noStore(created(honeypotFallback(data.target.kind === "parcel")));
      }
      const pretend = await buildHoneypotResponse(data);
      // A promo the real path would 422 must 422 here too — same status, same
      // message — or one probe tells the honeypot apart.
      if ("promoError" in pretend) return noStore(failure(pretend.promoError, 422));
      return noStore(created(pretend));
    }

    // 6. Target resolution. A table is proved by its opaque token, never a
    // guessable name; the token is never echoed in the 404.
    await connectDB();
    let table: IntakeTable | null = null;
    if (data.target.kind === "table") {
      const found = await Table.findOne({ publicToken: data.target.token })
        .select("tableNo chargeAmount chargeLabel")
        .lean();
      if (!found) return noStore(notFound(TABLE_NOT_FOUND_MESSAGE));
      table = found;
    }

    // 6.5. See the file-level comment — irrelevant for a parcel (table stays
    // null there, and buildRequestDoc's own NO_TABLE_CHARGE fallback covers it).
    const chargeApplies = table ? await tableChargeAppliesNow(table.tableNo) : true;

    // 7. Rate limit — keyed on the table token (or the shared parcel bucket),
    // never IP (see the file-level comment for why).
    const decision = await hitRateLimit(bucket, max, now);
    if (!decision.allowed) {
      const res = noStore(failure(RATE_LIMITED_MESSAGE, 429));
      res.headers.set("Retry-After", String(decision.retryAfterSec));
      return res;
    }

    // 8. Price against LIVE products, enforcing the public menu's own rules
    // (isActive AND publicVisible) — the accept bridge deliberately drops the
    // publicVisible clause at accept time (lib/order-request-accept.ts).
    const productIds = data.items.map((it) => it.productId).filter(mongoose.isValidObjectId);
    const products = (await Product.find({ _id: { $in: productIds }, ...PUBLIC_PRODUCT_FILTER })
      .select("name price discount available modifiers variations")
      .lean()) as unknown as PricedProductSource[];
    const priced = priceRequestItems(products, data.items);
    if ("error" in priced) return noStore(failure(priced.error, 422));

    // 9. readSettings — NEVER getSettings (pinned in public-surface-paths.test.ts
    // for the sibling menu route; the same discipline applies here: an
    // anonymous write must not additionally trigger the upsert getter's
    // per-call `updatedAt` write against a 512MB M0 with no backups).
    const settings = await readSettings();

    // 9.5. Promo code — resolved against live Settings + the priced subtotal,
    // BEFORE quoting. On {error}, the diner must be told WHICH of the three
    // it is (unknown/inactive/min-not-met), so this is a 422 with that error
    // verbatim — never folded into the generic 400 above.
    const promo = await resolveRequestPromo(data, priced.lines, table, settings, chargeApplies);
    if ("error" in promo) {
      // Deterministic promo 422s wrote nothing ⇒ refund the metered slot
      // (§17.E) — EXCEPT PROMO_ALREADY_USED, a cross-customer fact whose
      // probing must stay metered (review MED #5; residual documented in §18).
      if (promo.error !== PROMO_ALREADY_USED) await refundRateLimit(bucket, now);
      return noStore(failure(promo.error, 422));
    }

    const doc = buildRequestDoc(data, priced.lines, table, settings, chargeApplies, promo.discount, promo.code);
    const shortCode = await mintUniquePublicCode((code) =>
      OrderRequest.exists({ shortCode: code }).then(Boolean),
    );
    const request = await OrderRequest.create({ ...doc, shortCode });

    // 10. Auto-accept — settings.selfOrderMode === "auto" (the branch itself
    // moved to lib/order-request-create.ts's resolveAutoAcceptStatus to keep
    // this route under the line cap; behavior unchanged).
    const status = await resolveAutoAcceptStatus(String(request._id), settings);

    // 11. Best-effort pruning, bounded to once per bucket-window (not on
    // every hit) — both callees swallow their own errors.
    if (decision.freshWindow) {
      await pruneOrderRequests(now);
      await pruneRateWindows(now);
    }

    // 12. The diner UI's exact contract (packages/shared/src/public.ts). Never
    // the mobile, never anything that would tell a diner whether their number
    // matched a known customer — the auto-accept branch above (§10) makes
    // that indistinguishable by construction, since both paths return the
    // SAME shape.
    const responseData: PublicOrderRequestCreatedData = {
      shortCode,
      status,
      total: doc.quotedTotal,
      tableLabel: doc.tableNo ?? null,
      parcel: data.target.kind === "parcel",
    };

    // 12.5. Telegram (CR2.3b) — after() the response is sent, never before it;
    // type mirrors the resolved status, so one call covers approve + auto mode.
    const telegramType = status === "accepted" ? "autoAccepted" : "newRequest";
    after(() =>
      notifyRequestEvent(
        telegramType,
        telegramSummaryOfCreate({
          type: telegramType, shortCode, targetKind: doc.targetKind, tableNo: doc.tableNo,
          name: doc.name, items: doc.items, total: doc.quotedTotal, note: doc.note,
        }),
      ),
    );

    return noStore(created(responseData));
  } catch (error) {
    return noStore(serverError(ORDER_REQUEST_FAILED_MESSAGE, error, 503));
  }
}
