import mongoose from "mongoose";
import { NextResponse, after } from "next/server";
import { checkBotId } from "botid/server";

import {
  isPublicCode, PUBLIC_ORDER_BODY_MAX_BYTES, PUBLIC_ORDER_EDIT_RATE_MAX,
  type PublicOrderRequestStatusData, type PublicOrderRequestUpdatedData,
  PROMO_ALREADY_USED,
} from "@pos/shared/public";
import { connectDB } from "@/lib/db";
import { OrderRequest } from "@/models/OrderRequest";
import { Table } from "@/models/Table";
import { Product } from "@/models/Product";
import { readSettings } from "@/lib/settings";
import { failure, notFound, serverError, success } from "@/lib/api-helpers";
import { resolveTenantFromHost } from "@/lib/tenant";
import { hitRateLimit, refundRateLimit } from "@/lib/public-rate-limit";
import { priceRequestItems, type PricedProductSource } from "@/lib/public-pricing";
import {
  hasOpenTabNow, PUBLIC_REQUEST_PENDING_TTL_MS, quoteRequestTotals,
  tableChargeAppliesOnEditNow, type IntakeTable,
} from "@/lib/order-request-intake";
// Sibling-lib re-exports (CR2.2d split) — moved to lib/order-request-edit.ts to keep this route under the ~300-line cap.
import {
  editOrderRequestSchema, resolveEditPromo, editStatusGuard, noStore, toStatusItems, buildEditUpdate,
  ORDER_NOT_FOUND_MESSAGE, ORDER_STATUS_FAILED_MESSAGE, BOT_DENIED_MESSAGE,
  BODY_TOO_LARGE_MESSAGE, BAD_REQUEST_MESSAGE, ORDER_EDIT_FAILED_MESSAGE,
  RATE_LIMITED_MESSAGE, EDIT_TOO_OLD_MESSAGE, EDIT_TABLE_CHANGED_MESSAGE,
  EDIT_NEW_ITEM_MESSAGE, EDIT_CONFLICT_MESSAGE,
} from "@/lib/order-request-edit";
import { notifyRequestEvent, telegramSummaryOfEdit } from "@/lib/telegram/notify";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ shortCode: string }> };

// GET /api/public/order-request/[shortCode] — the diner's post-submit poll
// target. PUBLIC on purpose: the shortCode IS the capability. No mobile, no
// acceptedOrderId, no customerName. Item LINES are the one addition beyond
// the summary fields (CR2.2b §17.B) — a diner may see what THEIR order holds.
export async function GET(_req: Request, { params }: Params) {
  const { shortCode } = await params;

  // Shape-validated BEFORE any query, never echoed back.
  if (!isPublicCode(shortCode)) return noStore(notFound(ORDER_NOT_FOUND_MESSAGE));

  try {
    await connectDB();
    const request = await OrderRequest.findOne({ shortCode }).lean();
    if (!request) return noStore(notFound(ORDER_NOT_FOUND_MESSAGE));

    const items = toStatusItems(request.items);

    const data: PublicOrderRequestStatusData = {
      status: request.status,
      shortCode: request.shortCode,
      tableLabel: request.tableNo ?? null,
      parcel: request.targetKind === "parcel",
      itemCount: request.items.length,
      total: request.quotedTotal,
      createdAt: request.createdAt.toISOString(),
      items: items,
    };
    // The stored promo + kitchen note ride along so the edit UI can SHOW them
    // and round-trip/amend them (absent-vs-"" is meaningful on the PATCH side
    // for both — see there). Without the promo here a diner could never see,
    // or undo, a code applied in an earlier round.
    if (request.promoCode) data.promoCode = request.promoCode;
    if (request.quotedDiscount) data.quotedDiscount = request.quotedDiscount;
    if (request.note) data.note = request.note;
    // Omit-empty: only a resolved request carries either of these.
    if (request.status === "rejected" && request.rejectedReason) {
      data.rejectedReason = request.rejectedReason;
    }
    if (request.status === "accepted" && request.acceptedAt) {
      data.acceptedAt = request.acceptedAt.toISOString();
    }

    return noStore(success(data));
  } catch (error) {
    return noStore(serverError(ORDER_STATUS_FAILED_MESSAGE, error, 503));
  }
}

// PATCH /api/public/order-request/[shortCode] — lets a diner change their OWN
// still-pending request (CR2.2b §17.C). PUBLIC, capability-scoped like the
// sibling GET/cancel routes. Identity/target are NOT editable — only
// items/note. Controls run in the exact order commented inline below,
// mirroring POST /api/public/order-request's own numbered discipline: bot
// check, host gate, shortCode shape, body cap, parse + hp lift, load, status
// gate, age gate, rate limit, Zod, price, charge, re-quote, CAS, respond.
//
// Honeypot discipline (redesigned after the 2026-08-20 review): a filled `hp`
// does NOT short-circuit early — the early branch was unmetered attacker-keyed
// DB work and its hand-rolled subtotal a one-probe tell. The flag rides the
// ENTIRE real path (same 404s/409s/429s, metered rate hit, Zod caps, same
// quoteRequestTotals) and skips ONLY the CAS write. Nothing stored.
export async function PATCH(req: Request, { params }: Params) {
  const { shortCode } = await params;

  try {
    // 1. Bot check.
    const bot = await checkBotId();
    if (bot.isBot) return noStore(failure(BOT_DENIED_MESSAGE, 403));

    // 2. Host gate — run by hand; /api is outside the middleware's matcher.
    const tenant = await resolveTenantFromHost(req.headers.get("host"));
    const configuredTenant = process.env.TENANT_ID;
    if (!tenant || (configuredTenant && tenant.tenantId !== configuredTenant)) {
      return noStore(new NextResponse("Not found", { status: 404 }));
    }

    // 3. Shape-check the shortCode itself, before any query. Same copy as the
    // GET's own 404 — an edit link must never distinguish malformed vs gone.
    if (!isPublicCode(shortCode)) return noStore(notFound(ORDER_NOT_FOUND_MESSAGE));

    // 4. Body size cap, in UTF-8 bytes.
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > PUBLIC_ORDER_BODY_MAX_BYTES) {
      return noStore(failure(BODY_TOO_LARGE_MESSAGE, 413));
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return noStore(failure(BAD_REQUEST_MESSAGE, 400));
    }

    // Honeypot lift — BEFORE Zod, exactly POST's discipline.
    const bodyObj =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : undefined;
    const hpFilled = bodyObj?.hp !== undefined && bodyObj.hp !== "";
    if (bodyObj) delete bodyObj.hp;

    const bucket = `edit:${shortCode}`;
    const now = Date.now();

    // 5. Load the request by shortCode — a fabricated code 404s HERE, before
    // any pricing work, honeypot or not (the shortCode space is the gate).
    await connectDB();
    const doc = await OrderRequest.findOne({ shortCode }).lean();
    if (!doc) return noStore(notFound(ORDER_NOT_FOUND_MESSAGE));

    // 6. Status gate — only "pending" may be edited.
    const lockedResponse = editStatusGuard(doc.status);
    if (lockedResponse) return noStore(lockedResponse);

    // 6b. Age gate — the accept bridge 409s (and the prune sweep deletes) any
    // pending row past the 12h cutoff; a 200 here would "save" an order that
    // can never be accepted.
    if (now - doc.createdAt.getTime() > PUBLIC_REQUEST_PENDING_TTL_MS) {
      return noStore(failure(EDIT_TOO_OLD_MESSAGE, 409));
    }

    // 7. Rate limit, keyed on THIS request (never the table, unlike POST) —
    // honeypot traffic is metered identically (no peek-only path: the bucket
    // is real because the code proved real in step 5).
    const decision = await hitRateLimit(bucket, PUBLIC_ORDER_EDIT_RATE_MAX, now);
    if (!decision.allowed) {
      const res = noStore(failure(RATE_LIMITED_MESSAGE, 429));
      res.headers.set("Retry-After", String(decision.retryAfterSec));
      return res;
    }

    // 8. Zod — .strict() rejects any identity/target keys outright. Generic
    // 400 on failure, POST parity — never Zod's flattened messages (they echo
    // attacker-chosen key names back).
    const parsed = editOrderRequestSchema.safeParse(body);
    if (!parsed.success) return noStore(failure(BAD_REQUEST_MESSAGE, 400));
    const data = parsed.data;

    // 9. Membership — every edited line must already be on the request.
    const ordered = new Set(doc.items.map((it) => String(it.productId)));
    if (data.items.some((it) => !ordered.has(it.productId))) {
      return noStore(failure(EDIT_NEW_ITEM_MESSAGE, 422));
    }

    // 10. Price against LIVE products. Filtered on isActive ONLY — the same
    // query the accept bridge runs (lib/order-request-accept.ts): once a
    // request exists, a product hidden from the public menu is still
    // orderable, so hiding one item must not make the whole pending request
    // un-editable while staff can still accept it. The membership gate above
    // is what keeps the looser filter from becoming a way IN.
    const productIds = data.items.map((it) => it.productId).filter(mongoose.isValidObjectId);
    const products = (await Product.find({ _id: { $in: productIds }, isActive: true })
      .select("name price discount available modifiers variations")
      .lean()) as unknown as PricedProductSource[];
    const priced = priceRequestItems(products, data.items);
    if ("error" in priced) return noStore(failure(priced.error, 422));

    // 11. Charge — the edit-time charge-CARRIER rule (§17.C), never create's
    // own "any sibling suppresses" rule. A table-kind request whose Table row
    // is GONE is doomed at accept ONLY when no tab is open on that tableNo
    // (with one, accept takes the add-round branch and never reads the Table
    // row) — so the refusal is scoped to the genuinely-doomed case rather
    // than blocking an edit staff could still accept.
    let table: IntakeTable | null = null;
    // A PARCEL has no table and no session, so it starts `true` — matching
    // what the create route passes for a parcel. Money-neutral for the charge
    // (table stays null ⇒ NO_TABLE_CHARGE either way); it is the PROMO session
    // gate that reads this, and a parcel must never be gated by a table's tab.
    let chargeApplies = true;
    if (doc.targetKind === "table" && doc.tableNo) {
      table = await Table.findOne({ tableNo: doc.tableNo })
        .select("tableNo chargeAmount chargeLabel")
        .lean();
      if (!table && !(await hasOpenTabNow(doc.tableNo))) {
        return noStore(failure(EDIT_TABLE_CHANGED_MESSAGE, 409));
      }
      chargeApplies = await tableChargeAppliesOnEditNow(doc.tableNo, doc._id);
    }

    // 12. Re-quote against live settings.
    const settings = await readSettings();

    // 12.5. Promo (CR2.2c) — three-way semantics matching `note` (see
    // resolveEditPromo). POST-parity refund on its deterministic 422s, except
    // the usage oracle, which must stay metered (create route's own comment).
    const promo = await resolveEditPromo(data, doc, priced.lines, table, settings, chargeApplies);
    if ("error" in promo) {
      if (promo.error !== PROMO_ALREADY_USED) await refundRateLimit(bucket, now);
      return noStore(failure(promo.error, 422));
    }

    const quote = quoteRequestTotals(priced.lines, table, settings, chargeApplies, promo.discount);

    // 13. Honeypot skip — the ONE divergence from the real path: everything
    // above ran (and was metered) for mimicry; nothing is written.
    if (hpFilled) {
      const pretend: PublicOrderRequestUpdatedData = {
        shortCode,
        status: "pending",
        total: quote.quotedTotal,
        itemCount: quote.items.length,
      };
      return noStore(success(pretend));
    }

    // 14. CAS — $set what's present, $unset what dropped (built by
    // buildEditUpdate, lib/order-request-edit.ts — moved there in CR2.3b S8
    // to keep this route under the line cap; behavior unchanged).
    const { update, editedNote } = buildEditUpdate(quote, data.note, promo.code, doc.note);
    const result = await OrderRequest.updateOne({ _id: doc._id, status: "pending" }, update);
    if (result.matchedCount === 0) {
      // Never trust the pre-read status after a CAS miss — re-read and
      // answer per the SAME gate the fresh status check used above.
      const reread = await OrderRequest.findOne({ shortCode }).select("status").lean();
      if (!reread) return noStore(notFound(ORDER_NOT_FOUND_MESSAGE));
      const guard = editStatusGuard(reread.status);
      if (guard) return noStore(guard);
      return noStore(failure(EDIT_CONFLICT_MESSAGE, 409)); // see the constant's own comment
    }

    // 14.5. Telegram (CR2.3b) — only once the CAS write is known to have
    // matched (never on the miss above, never on the honeypot skip §13).
    after(() =>
      notifyRequestEvent(
        "editedRequest",
        telegramSummaryOfEdit({
          shortCode, targetKind: doc.targetKind, tableNo: doc.tableNo, name: doc.name,
          items: quote.items, total: quote.quotedTotal, note: editedNote,
        }),
      ),
    );

    // 15. Success — the diner UI's exact contract.
    const responseData: PublicOrderRequestUpdatedData = {
      shortCode,
      status: "pending",
      total: quote.quotedTotal,
      itemCount: quote.items.length,
    };
    return noStore(success(responseData));
  } catch (error) {
    return noStore(serverError(ORDER_EDIT_FAILED_MESSAGE, error, 503));
  }
}
