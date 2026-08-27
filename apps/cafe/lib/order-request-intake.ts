import { sanitizePublicText } from "@pos/shared/public";
import type { CreatePublicOrderRequestInput } from "@pos/shared/schemas/public-order.schema";
import type { PricedLine } from "@/lib/public-pricing";
import type { ISettings } from "@/models/Settings";
import { OrderRequest, type IOrderRequestItem, type OrderRequestTargetKind } from "@/models/OrderRequest";
import { Order } from "@/models/Order";
import { computeOrderTotals, gstConfigOfSettings, tableChargeOf, NO_TABLE_CHARGE } from "@/lib/receipt";

// CR2.2 SLICE 5 — turns a priced, validated diner submission into the exact
// document POST /api/public/order-request inserts, plus best-effort pruning
// of old rows. The money/sanitization math is pure (DB-free) so it's
// unit-testable without a live connection — same split as lib/public-pricing.ts
// and lib/public-rate-limit.ts (pure decision, DB call kept separate).

// ── Retention ────────────────────────────────────────────────────────────────
// A diner who placed an order (or is re-checking one staff already resolved)
// can come back to /m/o/<code> across a slow weekend shift change — three
// days keeps that link alive well past any realistic revisit, without
// growing the collection without bound on a 512MB M0 (there is no TTL index
// on this model — see models/OrderRequest.ts's own comment on why).
export const PUBLIC_REQUEST_RESOLVED_TTL_MS = 3 * 24 * 60 * 60 * 1000;

// A request nobody actioned must NEVER still be sitting in the tray the next
// morning — accepting it then would bill a table (or a parcel pickup) for
// yesterday's food. Pruned far more aggressively than the resolved TTL above.
// The accept bridge's own age gate (isRequestTooOld, order-request-accept-core.ts)
// reuses THIS constant for its 12h freshness check on "pending" rows.
export const PUBLIC_REQUEST_PENDING_TTL_MS = 12 * 60 * 60 * 1000;

// FIX8(b) — "accepting" gets its OWN, much wider cutoff: this status can mean
// an accept is genuinely in-flight, or that one crashed mid-write — either
// way staff need the row to stay visible in the tray to resume it. The
// bridge's own age gate already refuses a FRESH accept of anything past the
// 12h pending cutoff, so this sweep only needs to catch rows truly abandoned,
// not merely slow.
export const PUBLIC_REQUEST_ACCEPTING_TTL_MS = 48 * 60 * 60 * 1000;

export function resolvedCutoff(now: number): Date {
  return new Date(now - PUBLIC_REQUEST_RESOLVED_TTL_MS);
}

export function pendingCutoff(now: number): Date {
  return new Date(now - PUBLIC_REQUEST_PENDING_TTL_MS);
}

export function acceptingCutoff(now: number): Date {
  return new Date(now - PUBLIC_REQUEST_ACCEPTING_TTL_MS);
}

// Best-effort reap, mirroring pruneRateWindows' discipline (lib/public-rate-limit.ts):
// called opportunistically from the hot path, never blocking, never retried —
// a transient Mongo hiccup here must not turn into a 500 for a diner placing
// an order, so every failure is swallowed rather than logged (no console.* in
// app/lib code).
export async function pruneOrderRequests(now: number): Promise<void> {
  try {
    // FIX8(a) — filtered on createdAt (not updatedAt) so this rides the
    // existing {status:1, createdAt:-1} index instead of a COLLSCAN (there is
    // no index on updatedAt). A resolved row's createdAt is always <= its
    // updatedAt, so this can only delete a row NO LATER than the old
    // updatedAt-keyed filter would have — it never holds a row around longer.
    await OrderRequest.deleteMany({
      status: { $in: ["accepted", "rejected"] },
      createdAt: { $lt: resolvedCutoff(now) },
    });
    // Stuck PENDING rows age out from when they were PLACED, on the 12h
    // clock — un-actioned must go stale on a fixed clock, not on staff
    // activity (the thing that never happened). "accepting" is EXCLUDED here
    // (FIX8(b)) — it gets its own, wider sweep below.
    await OrderRequest.deleteMany({
      status: "pending",
      createdAt: { $lt: pendingCutoff(now) },
    });
    await OrderRequest.deleteMany({
      status: "accepting",
      createdAt: { $lt: acceptingCutoff(now) },
    });
  } catch {
    // best-effort — see comment above
  }
}

// ── Table charge session rule (owner field-feedback 2026-08-20) ────────────
// "every order me additional charge lag rahe hai" — a table's charge is
// quoted/billed only on the FIRST order of a table's session, never on every
// subsequent round. A session is "open" the moment either an open tab exists
// (an unpaid Pending Order already on that table) or a request for it is
// already in flight (pending/accepting) — once either is true, the charge is
// already on (or about to land on) the table's bill, so quoting it again
// would double it in the diner's eyes. Pure decision table, DB-free and
// directly unit-tested; tableChargeAppliesNow below resolves the two
// booleans from live state. ONE exported async helper — both the table route
// (display) and this file's own caller, the POST route (the actual quote),
// call tableChargeAppliesNow so display can never disagree with what's billed.
export function tableChargeApplies(hasOpenTab: boolean, hasPendingRequest: boolean): boolean {
  return !hasOpenTab && !hasPendingRequest;
}

// The ONE definition of "this table has a bill running" — every caller that
// needs the fact (both charge rules, and the edit route's own table-gone
// guard) reads it from here so they can never disagree.
export async function hasOpenTabNow(tableNo: string): Promise<boolean> {
  return Boolean(await Order.exists({ tableNo, status: "Pending", payment: "Unpaid" }));
}

export async function tableChargeAppliesNow(tableNo: string): Promise<boolean> {
  const [hasOpenTab, hasPendingRequest] = await Promise.all([
    hasOpenTabNow(tableNo),
    OrderRequest.exists({ tableNo, status: { $in: ["pending", "accepting"] } }),
  ]);
  return tableChargeApplies(Boolean(hasOpenTab), Boolean(hasPendingRequest));
}

// ── Edit-time charge rule (CR2.2b §17.C, owner field-feedback 2026-08-20) ──
// "Any sibling suppresses" (tableChargeApplies above) is right at CREATE time
// — the FIRST request of a session should carry the charge, and every later
// one should not. Reusing that same rule at EDIT time is wrong: the moment a
// SECOND request exists on the table, re-editing the FIRST one (the one that
// legitimately carries the charge) would see its own sibling and suppress its
// own charge — silently dropping it from the quote the diner already agreed
// to. So editing asks a narrower question: is THIS request the table's charge
// CARRIER right now? It stays the carrier unless an open tab exists (the
// charge is already on a real bill) or ANOTHER pending/accepting sibling is
// ALREADY carrying a charge (quotedCharge > 0) — excluding itself, so a
// request never "sees" its own quote. If the carrier is later cancelled, the
// next edited sibling picks the charge up (display never flaps, and
// createTotalsMatchQuote's accept-side tolerance still covers the races).
export function tableChargeAppliesOnEdit(hasOpenTab: boolean, hasChargeCarrierSibling: boolean): boolean {
  return !hasOpenTab && !hasChargeCarrierSibling;
}

export async function tableChargeAppliesOnEditNow(tableNo: string, excludeId: unknown): Promise<boolean> {
  const [hasOpenTab, hasChargeCarrierSibling] = await Promise.all([
    hasOpenTabNow(tableNo),
    OrderRequest.exists({
      tableNo,
      status: { $in: ["pending", "accepting"] },
      _id: { $ne: excludeId },
      quotedCharge: { $gt: 0 },
    }),
  ]);
  return tableChargeAppliesOnEdit(Boolean(hasOpenTab), Boolean(hasChargeCarrierSibling));
}

// ── Draft doc ────────────────────────────────────────────────────────────────

// The table this request targets — narrowed to what tableChargeOf and the
// tableNo snapshot need. `null` for a parcel (no table claimed, no charge).
export interface IntakeTable {
  tableNo: string;
  chargeAmount?: number;
  chargeLabel?: string;
}

// The exact shape OrderRequest.create() takes, minus `shortCode` (minted
// separately by the caller via mintUniquePublicCode — this function has no
// existence check to run against).
export interface OrderRequestDraft {
  targetKind: OrderRequestTargetKind;
  tableNo?: string;
  items: IOrderRequestItem[];
  quotedSubtotal: number;
  quotedCharge: number;
  quotedChargeLabel?: string;
  quotedTotal: number;
  note?: string;
  mobile: string;
  name: string;
  quotedDiscount?: number;
  promoCode?: string;
}

// The money core, shared VERBATIM by create (buildRequestDoc below) and edit
// (PATCH /api/public/order-request/[shortCode], CR2.2b §17.C) — the only
// thing that differs between the two callers is HOW `chargeApplies` is
// decided (tableChargeAppliesNow vs. tableChargeAppliesOnEditNow), never the
// pricing/sanitization math itself. Kept pure and DB-free like the rest of
// this file. PARITY REQUIREMENT: the accept bridge's create-case
// (lib/order-request-accept.ts, createTotalsMatchQuote) 409-rejects a request
// the instant staff accept it if the CREATE-side total this function produces
// ever disagrees with what that function recomputes (beyond the one tolerated
// charge-once delta — see buildRequestDoc's own comment below), so this
// construction must stay in lockstep with POST /api/orders' own totals math.
export function quoteRequestTotals(
  lines: PricedLine[],
  table: IntakeTable | null,
  settings: ISettings | null,
  chargeApplies: boolean,
  discount = 0, // a diner never TYPES an amount — this is a resolved promo discount, or 0
): {
  items: IOrderRequestItem[];
  quotedSubtotal: number;
  quotedCharge: number;
  quotedChargeLabel?: string;
  quotedTotal: number;
  quotedDiscount: number;
} {
  const items: IOrderRequestItem[] = lines.map((line) => {
    const item: IOrderRequestItem = {
      productId: line.productId,
      name: line.name,
      price: line.price,
      qty: line.qty,
      // Modifiers are NOT run through sanitizePublicText: priceRequestItems
      // already rejected anything not byte-equal to one of the product's own
      // allow-listed modifier strings, so sanitizing here could only corrupt
      // a value that was already trusted — never make it safer.
      modifiers: line.modifiers,
      instructions: sanitizePublicText(line.instructions ?? ""),
    };
    if (line.variation) item.variation = line.variation;
    return item;
  });

  // The SAME tableChargeOf the POS and every order-write route price
  // against. A parcel (table === null) always resolves to NO_TABLE_CHARGE, as
  // does a table whose caller-supplied chargeApplies verdict says the charge
  // was already quoted/billed elsewhere this session.
  const charge = chargeApplies ? tableChargeOf(table) : NO_TABLE_CHARGE;

  // Same settings-derived GST cfg construction as POST /api/orders
  // (getSettings → gstConfigOf there; readSettings → gstConfigOfSettings
  // here, since this path must never write).
  const totals = computeOrderTotals({
    items: lines,
    discount, // 0 unless a promo code resolved — see resolvePromoDiscount (@pos/shared/public)
    charge: charge.amount,
    cfg: gstConfigOfSettings(settings ?? undefined),
  });

  const result: {
    items: IOrderRequestItem[];
    quotedSubtotal: number;
    quotedCharge: number;
    quotedChargeLabel?: string;
    quotedTotal: number;
    quotedDiscount: number;
  } = {
    items,
    quotedSubtotal: totals.subtotal,
    quotedCharge: totals.charge,
    quotedTotal: totals.total,
    quotedDiscount: totals.discount,
  };
  // Omit-empty, matching the model's own field discipline: a charge-less
  // quote carries no quotedChargeLabel key at all.
  if (totals.charge > 0) result.quotedChargeLabel = charge.label;
  return result;
}

// Builds the insert shape from a priced, validated submission. `table` is the
// RESOLVED row the route looked up by token — targetKind/tableNo are read
// from it and from `input.target.kind`, never from anything else the client
// sent (target.kind is safe to trust as-is: it is only "table"/"parcel",
// never the token itself). `chargeApplies` is the caller's own
// tableChargeAppliesNow(table.tableNo) verdict (irrelevant, and safe to pass
// either way, for a parcel — table is null there regardless, so the charge
// resolves to NO_TABLE_CHARGE either way): false forces the quote to
// NO_TABLE_CHARGE even when the table itself carries a configured charge.
//
// Delegates its money math to quoteRequestTotals (above) — accept-side
// consequence, unchanged by the delegation: when THIS charge-less quote is
// the one staff accept FIRST (out-of-order taps across same-table siblings,
// or the earlier tab/request evaporating), the create branch recomputes WITH
// the charge and createTotalsMatchQuote TOLERATES exactly that delta — the
// order carries the table's one-time charge instead of its sibling, and the
// table's total converges the same whichever accept order staff pick (field
// bug 2026-08-20). Any OTHER difference still 409s as real price drift.
export function buildRequestDoc(
  input: CreatePublicOrderRequestInput,
  lines: PricedLine[],
  table: IntakeTable | null,
  settings: ISettings | null,
  chargeApplies: boolean,
  discount = 0, // resolvePromoDiscount's own result, or 0 — never a diner-sent amount
  promoCode?: string, // the NORMALIZED code that resolved, only when one applied
): OrderRequestDraft {
  const quote = quoteRequestTotals(lines, table, settings, chargeApplies, discount);

  const doc: OrderRequestDraft = {
    targetKind: input.target.kind,
    items: quote.items,
    quotedSubtotal: quote.quotedSubtotal,
    quotedCharge: quote.quotedCharge,
    quotedTotal: quote.quotedTotal,
    mobile: input.mobile,
    name: sanitizePublicText(input.name),
  };
  // Omit-empty, matching the model's own field discipline: a parcel carries
  // no tableNo, and a table with no configured (or waived) charge carries no
  // quotedChargeLabel.
  if (table) doc.tableNo = table.tableNo;
  if (quote.quotedChargeLabel) doc.quotedChargeLabel = quote.quotedChargeLabel;
  if (input.note) doc.note = sanitizePublicText(input.note);
  // Omit-empty: quotedDiscount only when it's actually non-zero, promoCode
  // only when the caller resolved one (a resolved-but-zero code — e.g. a
  // percent floor on a tiny subtotal — still counts as "applied", so the two
  // keys are independent, not one gated on the other).
  if (quote.quotedDiscount > 0) doc.quotedDiscount = quote.quotedDiscount;
  if (promoCode) doc.promoCode = promoCode;
  return doc;
}
