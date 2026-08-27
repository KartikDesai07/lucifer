import mongoose from "mongoose";

import {
  resolvePromoDiscount,
  type PublicOrderRequestCreatedData,
  PROMO_SESSION_OPEN,
  PROMO_ALREADY_USED,
  canonicalPromoMobile,
  SELF_ORDER_RECEIVER,
} from "@pos/shared/public";
import type { CreatePublicOrderRequestInput } from "@pos/shared/schemas/public-order.schema";
import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import { Product } from "@/models/Product";
import { PromoRedemption } from "@/models/PromoRedemption";
import { readSettings } from "@/lib/settings";
import { mintPublicCode } from "@/lib/public-token";
import { PUBLIC_PRODUCT_FILTER } from "@/lib/public-menu";
import { priceRequestItems, type PricedLine, type PricedProductSource } from "@/lib/public-pricing";
import type { ISettings } from "@/models/Settings";
import {
  buildRequestDoc,
  quoteRequestTotals,
  tableChargeAppliesNow,
  type IntakeTable,
} from "@/lib/order-request-intake";
import { acceptOrderRequest } from "@/lib/order-request-accept";

// Sibling of app/api/public/order-request/route.ts (CR2.2d split) — split out
// purely to keep the route file under the ~300-line budget while POST's full
// numbered control flow (pinned by lib/order-request-paths.test.ts) stays
// intact THERE. Holds the promo resolver and the honeypot-mimicry helpers the
// route's POST handler calls into; nothing here decides the real path's own
// control order.

// Response copy for the route file above (moved here in CR2.3b S8 to keep
// route.ts under the ~300-line cap — mechanical relocation, meaning unchanged).
export const BOT_DENIED_MESSAGE = "Access denied";
export const BODY_TOO_LARGE_MESSAGE = "That order is too large to send";
export const BAD_REQUEST_MESSAGE = "We couldn't read that order — please try again";
export const TABLE_NOT_FOUND_MESSAGE = "Table not found";
export const RATE_LIMITED_MESSAGE = "Too many orders from this table right now";
export const ORDER_REQUEST_FAILED_MESSAGE = "Could not place your order";

// Resolves `data.promoCode` (if any) against LIVE Settings + the priced
// SUBTOTAL (never a diner-sent amount — client money must encode INTENT).
// Shared by the real path (§8.5) and the honeypot mimic (buildHoneypotResponse
// below) so a filled `hp` can never be told apart by promo handling alone. Probes
// quoteRequestTotals once (discount 0) purely to read its subtotal — the
// discount itself is still decided by resolvePromoDiscount, and the ONE
// totals function this ever reaches is computeOrderTotals (via
// quoteRequestTotals/buildRequestDoc), never re-implemented here.
export async function resolveRequestPromo(
  data: CreatePublicOrderRequestInput,
  lines: PricedLine[],
  table: IntakeTable | null,
  settings: ISettings | null,
  chargeApplies: boolean,
): Promise<{ discount: number; code?: string } | { error: string }> {
  if (!data.promoCode) return { discount: 0 };
  // SERVER-side session gate (review 2026-08-20): a promo rides a table's
  // FIRST order of a session only. `chargeApplies` is that exact fact — no
  // open tab and no sibling request in flight — so the promo and the table
  // charge can never disagree about when a session started. Without this the
  // client's hidden control was the only guard, and the pending-edit screen
  // walked straight past it: one flat code re-applied per round zeroes the
  // entire tab. A parcel has no session, so it is unaffected (chargeApplies
  // is passed true there by the caller).
  if (!chargeApplies) return { error: PROMO_SESSION_OPEN };
  const probe = quoteRequestTotals(lines, table, settings, chargeApplies);
  const resolved = resolvePromoDiscount(settings?.promoCodes, data.promoCode, probe.quotedSubtotal);
  if ("error" in resolved) return { error: resolved.error };
  // SPEC P4 — quote-time COURTESY check: the fence itself is
  // models/PromoRedemption.ts's unique {code,mobile} index, claimed only at
  // accept time (lib/order-request-accept-promo.ts) — this only spares a
  // diner from being told a doomed code "worked".
  if (resolved.oncePerCustomer) {
    // Keyed on the CANONICAL mobile — the fence's own key (review MAJOR #2:
    // "+91"/"0" re-typings of one number must collapse to one identity).
    const used = await PromoRedemption.exists({
      code: resolved.code,
      mobile: canonicalPromoMobile(data.mobile),
    });
    if (used) return { error: PROMO_ALREADY_USED };
  }
  return { discount: resolved.discount, code: resolved.code };
}

// Step 10 of POST /api/public/order-request (moved here in CR2.3b S8 to keep
// the route under the ~300-line cap). ANY failure (a pricing/table-state
// rejection, or an unexpected throw) degrades to the tray, exactly as if
// selfOrderMode were "approve" — a human resolves it from there.
export async function resolveAutoAcceptStatus(
  requestId: string,
  settings: ISettings | null,
): Promise<PublicOrderRequestCreatedData["status"]> {
  if (settings?.selfOrderMode !== "auto") return "pending";
  try {
    const result = await acceptOrderRequest(requestId, {
      actor: SELF_ORDER_RECEIVER,
      settings,
      createCustomer: false,
    });
    return "error" in result ? "pending" : "accepted";
  } catch {
    // A throw here does NOT mean the request stayed "pending" in the DB —
    // acceptOrderRequest may have already CAS'd it into "accepting" (bridge
    // step 2) before throwing, which is visible in the staff tray and
    // resumable/rejectable from there. Only the caller's local status is
    // guaranteed to stay "pending".
    return "pending";
  }
}

// The zero-real-work honeypot shape — a bot's junk shortCode is never
// checked for uniqueness or stored, so it 404s on the status GET exactly
// like a pruned row, whether this is reached via the metering short-circuit
// (§5's peekRateLimit gate) or buildHoneypotResponse's own catch-all below.
export function honeypotFallback(parcel: boolean): PublicOrderRequestCreatedData {
  return { shortCode: mintPublicCode(), status: "pending", total: 0, tableLabel: null, parcel };
}

// Honeypot mimicry (control #5): mirrors §6 (target resolution) and §8
// (pricing) exactly, but touches nothing durable — no rate-limit hit (would
// let a bot starve a real table's budget by pretending) and no
// OrderRequest.create. The minted code is never checked for uniqueness or
// stored, so the status GET 404s it exactly like a pruned row. Any failure
// inside degrades to a generic-but-still-plausible 201, never a leaked
// distinguishing status code.
export async function buildHoneypotResponse(
  data: CreatePublicOrderRequestInput,
): Promise<PublicOrderRequestCreatedData | { promoError: string }> {
  const parcel = data.target.kind === "parcel";
  try {
    await connectDB();
    let table: IntakeTable | null = null;
    if (data.target.kind === "table") {
      const found = await Table.findOne({ publicToken: data.target.token })
        .select("tableNo chargeAmount chargeLabel")
        .lean();
      if (!found) throw new Error("honeypot: table not found");
      table = found;
    }

    const productIds = data.items.map((it) => it.productId).filter(mongoose.isValidObjectId);
    const products = (await Product.find({ _id: { $in: productIds }, ...PUBLIC_PRODUCT_FILTER })
      .select("name price discount available modifiers variations")
      .lean()) as unknown as PricedProductSource[];
    const priced = priceRequestItems(products, data.items);
    if ("error" in priced) throw new Error(priced.error);

    const settings = await readSettings();
    // Mirrors §6.5 (the real path's own table-charge session check) — the
    // honeypot simulation touches the SAME real target-resolution + pricing
    // work a genuine diner gets (file-level comment), and that includes this
    // read (an exists() query, not a write).
    const chargeApplies = table ? await tableChargeAppliesNow(table.tableNo) : true;
    // Promo parity with the real path: a rejected code answers 422 THERE, so
    // answering 201 here would be a one-probe honeypot tell (review
    // 2026-08-20). Signalled to the caller, which returns the same 422.
    const promo = await resolveRequestPromo(data, priced.lines, table, settings, chargeApplies);
    if ("error" in promo) return { promoError: promo.error };
    const doc = buildRequestDoc(data, priced.lines, table, settings, chargeApplies, promo.discount, promo.code);
    return {
      shortCode: mintPublicCode(),
      status: "pending",
      total: doc.quotedTotal,
      tableLabel: doc.tableNo ?? null,
      parcel,
    };
  } catch {
    return honeypotFallback(parcel);
  }
}
