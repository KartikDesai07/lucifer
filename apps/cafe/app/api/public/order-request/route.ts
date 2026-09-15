import mongoose from "mongoose";
import { after } from "next/server";

import { type PublicOrderRequestCreatedData, PROMO_ALREADY_USED, selfOrderingAllowed } from "@pos/shared/public";
import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import { Product } from "@/models/Product";
import { OrderRequest } from "@/models/OrderRequest";
import { readSettings } from "@/lib/settings";
import { created, failure, notFound, serverError } from "@/lib/api-helpers";
import { mintUniquePublicCode } from "@/lib/public-token";
import { hitRateLimit, pruneRateWindows, refundRateLimit } from "@/lib/public-rate-limit";
import { PUBLIC_PRODUCT_FILTER } from "@/lib/public-menu";
import { priceRequestItems, type PricedProductSource } from "@/lib/public-pricing";
import {
  buildRequestDoc,
  quoteRequestTotals,
  pruneOrderRequests,
  tableChargeAppliesNow,
  type IntakeTable,
} from "@/lib/order-request-intake";
import { resolveRequestReward } from "@/lib/order-request-reward";
import { resolveRequestPromo, resolveAutoAcceptStatus, TABLE_NOT_FOUND_MESSAGE, RATE_LIMITED_MESSAGE, ORDER_REQUEST_FAILED_MESSAGE, SELF_ORDER_DISABLED_MESSAGE } from "@/lib/order-request-create";
import { intakePublicOrderRequest, noStore } from "@/lib/public-order-intake";
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
//   5.5. MENU-ONLY gate (CB-4) — runs right after connectDB, BEFORE the rate
//      limit: a cafe whose selfOrderMode is "menu" has switched ordering off
//      entirely, and the diner UI's hidden buttons are not a fence on an
//      unauthenticated route. Settings is read ONCE here and reused at §9, so
//      the gate and the pricing can never straddle a settings save. Numbered
//      5.5 rather than renumbering the rest: it gates BEFORE the metered
//      charge, but it needs the connection §6 opens.
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

export async function POST(req: Request) {
  try {
    // 1-5. Bot check, host gate, body-size cap, JSON parse + honeypot lift,
    // and the honeypot branch itself — moved to lib/public-order-intake.ts to
    // keep this file under the ~300-line cap. See that file for the step-by-
    // step comments; the numbered control-flow contract above still governs
    // both files together.
    const intake = await intakePublicOrderRequest(req);
    if (intake.kind === "respond") return intake.response;
    const { data, now, bucket, max } = intake;

    // 6. Target resolution. A table is proved by its opaque token, never a
    // guessable name; the token is never echoed in the 404.
    await connectDB();

    // 5.5 (CB-4). MENU-ONLY GATE — the SERVER-side half of "menu only" mode.
    // The diner UI hides its ordering affordances in this mode, but a hidden
    // button is not a fence: this route is unauthenticated and public, so the
    // refusal has to live HERE. Placed immediately after connectDB and BEFORE
    // the rate-limit charge (§7) deliberately: readSettings is cache-backed
    // (no DB round-trip on a warm isolate), and a cafe that has switched
    // ordering off must not burn a diner's metered slot to be told so. Asked
    // through `selfOrderingAllowed`, never a hand-written === "menu", so a
    // future mode cannot silently re-open ordering here.
    const orderingSettings = await readSettings();
    if (!selfOrderingAllowed(orderingSettings?.selfOrderMode)) {
      return noStore(failure(SELF_ORDER_DISABLED_MESSAGE, 403));
    }
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

    // 9. Settings — read ONCE at step 5.5 above (the menu-only gate needed it
    // first) and reused here rather than re-read: two reads in one request
    // could straddle a settings save and price an order against a different
    // config than the one that let it through the gate. readSettings, NEVER
    // getSettings (pinned in public-surface-paths.test.ts for the sibling menu
    // route; the same discipline applies here: an anonymous write must not
    // additionally trigger the upsert getter's per-call `updatedAt` write
    // against a 512MB M0 with no backups).
    const settings = orderingSettings;

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

    // 9.6. Reward claim (CB-5B S8 / owner decision D4) — the diner's OWN
    // stamps, spent against the OWNER's configured ladder. Resolved AFTER the
    // promo above so the mutual-exclusion refusal (A2/D6) is reached with the
    // promo already known, and BEFORE the quote is built, because a doomed
    // claim must not become a stored request the staff tray then has to
    // reject by hand.
    //
    // NOTHING IS SPENT HERE. The stamps are claimed at ACCEPT, keyed on the
    // orderId that actually lands — a request is pre-money, and a rejected
    // one must cost the diner nothing.
    //
    // Priced against the SAME quote the diner is looking at, built through the
    // one shared path (quoteRequestTotals) rather than a second arithmetic —
    // the per-milestone minBill gate has to be evaluated against the bill the
    // diner actually sees.
    const rewardQuote = quoteRequestTotals(priced.lines, table, settings, chargeApplies, promo.discount);
    const reward = await resolveRequestReward(data, settings, rewardQuote.quotedTotal);
    if ("error" in reward) {
      // Metering, per §17.E and the review MED #5 rule: a deterministic 422
      // that WROTE NOTHING refunds the slot, EXCEPT one whose answer is a
      // cross-customer fact worth probing (PROMO_ALREADY_USED). Every reason
      // this gate returns is about the CALLER's own session, own balance, or
      // own submission — a diner learns nothing about anyone else by asking —
      // so all of them refund. A diner fixing their own order must not be
      // rate-limited out of the cafe.
      await refundRateLimit(bucket, now);
      return noStore(failure(reward.error, 422));
    }

    const doc = buildRequestDoc(
      data, priced.lines, table, settings, chargeApplies, promo.discount, promo.code,
      reward.requestedRewardAt,
    );
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
