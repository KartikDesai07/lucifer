/**
 * CR2.2 live leg — proves the accept bridge's DB-truth against a REAL MongoDB,
 * which the DB-free unit tests (order-request-accept.test.ts) deliberately
 * skip: the step-2 CAS entry into "accepting" and its re-enterable-after-a-
 * crash resume, the step-3 repair-lookup-first ordering, the add-round CAS
 * filter's actual match/miss against a live Order (including the
 * sourceRequestIds reciprocal-CAS fence and the unique+sparse multikey index
 * it depends on), Customer attach/create/auto-mode-skip against real rows,
 * the live Product re-validation (price drift), the create path's table-free
 * gate, and the pure-but-DB-adjacent helpers (hitRateLimit, pruneRateWindows,
 * pruneOrderRequests) against a real PublicRateLimit/OrderRequest collection.
 *
 * SCOPE — this script drives `acceptOrderRequest` (lib/order-request-accept.ts)
 * directly, using `buildRequestDoc` + `priceRequestItems` + `OrderRequest.create`
 * to stage requests exactly as POST /api/public/order-request does (read that
 * route's own numbered-comment before touching this file). It deliberately
 * does NOT stand up the HTTP routes themselves — no BotID, no host gate, no
 * Zod body parsing — those stay in the route/unit-test layer.
 *
 *   npm run verify:order-request:live
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_order_request npm run verify:order-request:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops the WHOLE scratch database (start and end) rather
 * than leaving prior-run leftovers to collide with this run's fixed ids.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, type IOrder, type IOrderItem } from "@/models/Order";
import { OrderRequest, type IOrderRequest, type OrderRequestStatus } from "@/models/OrderRequest";
import { Product } from "@/models/Product";
import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import { PublicRateLimit } from "@/models/PublicRateLimit";
import { PromoRedemption } from "@/models/PromoRedemption";
import { Counter } from "@/models/Counter";
import type { ISettings } from "@/models/Settings";
import type { OrderStatus, PaymentMode, GstMode } from "@/lib/constants";
import {
  acceptOrderRequest,
  REQUEST_REJECTED_ERROR,
  REQUEST_TOO_OLD_ERROR,
  TABLE_STATE_CONFLICT_ERROR,
  PROMO_DRIFT_ERROR,
  PROMO_USED_ERROR,
  findByRequestId,
  type AcceptContext,
} from "@/lib/order-request-accept";
import { applyAddRound, createOrFindCustomer } from "@/lib/order-request-accept-write";
import { finalizeAccept, reject } from "@/lib/order-request-accept-core";
import { claimPromoRedemption } from "@/lib/order-request-accept-promo";
import { resolveRequestPromo } from "@/lib/order-request-create";
import {
  buildRequestDoc,
  hasOpenTabNow,
  quoteRequestTotals,
  tableChargeAppliesNow,
  tableChargeAppliesOnEditNow,
  pruneOrderRequests,
  resolvedCutoff,
  pendingCutoff,
  acceptingCutoff,
  type IntakeTable,
} from "@/lib/order-request-intake";
import { priceRequestItems, PRICE_DRIFT_ERROR, SOLD_OUT_ERROR, type PricedProductSource } from "@/lib/public-pricing";
import { hitRateLimit, peekRateLimit, pruneRateWindows, rateWindowKey } from "@/lib/public-rate-limit";
import { mintUniquePublicCode } from "@/lib/public-token";
import {
  SELF_ORDER_RECEIVER,
  SELF_ORDER_SOURCE,
  PARCEL_BUCKET_KEY,
  PUBLIC_ORDER_RATE_WINDOW_MS,
  DINER_CANCELLED_REASON,
  DINER_ACTOR,
  sanitizePublicText,
  resolvePromoDiscount,
  normalizePromoCode,
  PROMO_SESSION_OPEN,
  PROMO_ALREADY_USED,
  type PromoCodeConfig,
} from "@pos/shared/public";
import type { CreatePublicOrderRequestInput } from "@pos/shared/schemas/public-order.schema";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}order_request`;
const DUPLICATE_KEY_CODE = 11000;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

// ── shared product fixtures (seeded once in main, read by every leg) ───────
let teaId: string;
let coffeeId: string;
let burgerId: string;

async function seedProducts(): Promise<void> {
  const tea = await Product.create({
    name: "Tea",
    category: "Beverages",
    price: 100,
    discount: 0,
    available: true,
    modifiers: [],
    isActive: true,
  });
  const coffee = await Product.create({
    name: "Coffee",
    category: "Beverages",
    price: 150,
    discount: 10, // effectiveUnitPrice = round(150 - 15) = 135
    available: true,
    modifiers: ["Extra Shot"],
    isActive: true,
  });
  const burger = await Product.create({
    name: "Burger",
    category: "Mains",
    price: 300,
    variations: [
      { name: "Regular", price: 300 },
      { name: "Large", price: 400 },
    ],
    discount: 0,
    available: true,
    modifiers: ["Cheese", "Spicy"],
    isActive: true,
  });
  teaId = String(tea._id);
  coffeeId = String(coffee._id);
  burgerId = String(burger._id);
}

// ── staging helper — mirrors POST /api/public/order-request's own §6-9 ─────
// (target resolution, pricing, buildRequestDoc, shortCode mint, create) using
// the REAL priceRequestItems/buildRequestDoc/mintUniquePublicCode, exactly
// like the route does, so this script's fixtures cannot silently drift off
// what a diner's request actually looks like on disk.
interface StageItem {
  productId: string;
  variation?: string;
  modifiers?: string[];
  instructions?: string;
  qty: number;
}
interface StageOptions {
  targetKind: "table" | "parcel";
  tableNo?: string;
  items: StageItem[];
  name: string;
  mobile: string;
  note?: string;
  // CR2.2c — mirrors POST's own §9.5: a code + the cafe's configured list.
  // Resolved against the priced SUBTOTAL exactly like the route, never a
  // hand-rolled amount.
  promoCode?: string;
  promoCodes?: PromoCodeConfig[];
}

async function stageRequest(opts: StageOptions): Promise<IOrderRequest> {
  const productIds = opts.items.map((it) => it.productId);
  const products = (await Product.find({ _id: { $in: productIds } })
    .select("name price discount available modifiers variations")
    .lean()) as unknown as PricedProductSource[];
  const priced = priceRequestItems(
    products,
    opts.items.map((it) => ({
      productId: it.productId,
      variation: it.variation,
      modifiers: it.modifiers ?? [],
      instructions: it.instructions,
      qty: it.qty,
    })),
  );
  if ("error" in priced) throw new Error(`stageRequest: pricing failed — ${priced.error}`);

  let table: IntakeTable | null = null;
  if (opts.targetKind === "table") {
    if (!opts.tableNo) throw new Error("stageRequest: table target needs a tableNo");
    const found = await Table.findOne({ tableNo: opts.tableNo })
      .select("tableNo chargeAmount chargeLabel")
      .lean();
    if (!found) throw new Error(`stageRequest: table ${opts.tableNo} not found`);
    table = found;
  }

  const input: CreatePublicOrderRequestInput = {
    target: opts.targetKind === "table" ? { kind: "table", token: "STAGE-TOKEN-UNUSED" } : { kind: "parcel" },
    items: opts.items.map((it) => ({
      productId: it.productId,
      variation: it.variation,
      modifiers: it.modifiers ?? [],
      instructions: it.instructions,
      qty: it.qty,
    })),
    name: opts.name,
    mobile: opts.mobile,
    note: opts.note,
  };

  let discount = 0;
  let resolvedCode: string | undefined;
  if (opts.promoCode) {
    const probe = quoteRequestTotals(priced.lines, table, null, true);
    const resolved = resolvePromoDiscount(opts.promoCodes, opts.promoCode, probe.quotedSubtotal);
    if ("error" in resolved) throw new Error(`stageRequest: promo resolution failed — ${resolved.error}`);
    discount = resolved.discount;
    resolvedCode = resolved.code;
  }

  // chargeApplies: true — this script prices directly against buildRequestDoc,
  // outside the per-table-session gate the POST route itself now applies
  // (order-request-intake.ts's tableChargeAppliesNow); true preserves this
  // script's prior behavior (always price the table's configured charge).
  const doc = buildRequestDoc(input, priced.lines, table, null, true, discount, resolvedCode);
  const shortCode = await mintUniquePublicCode((code) => OrderRequest.exists({ shortCode: code }).then(Boolean));
  return OrderRequest.create({ ...doc, shortCode });
}

// ── CR2.2b §17.C edit-request fixtures/helpers ──────────────────────────────
// A second table-staging helper, used ONLY by the leg 27 block below: unlike
// stageRequest (chargeApplies always forced `true`, see its own comment), the
// charge-carrier/charge-handoff legs need each staged request's INITIAL
// charge state to be exactly what the REAL create-time rule
// (tableChargeAppliesNow) would give it — otherwise "B is charge-less because
// A already exists" could never be staged faithfully.
async function stageTableRequestCharge(
  tableNo: string,
  items: StageItem[],
  name: string,
  mobile: string,
): Promise<IOrderRequest> {
  const productIds = items.map((it) => it.productId);
  const products = (await Product.find({ _id: { $in: productIds } })
    .select("name price discount available modifiers variations")
    .lean()) as unknown as PricedProductSource[];
  const priced = priceRequestItems(
    products,
    items.map((it) => ({
      productId: it.productId,
      variation: it.variation,
      modifiers: it.modifiers ?? [],
      instructions: it.instructions,
      qty: it.qty,
    })),
  );
  if ("error" in priced) throw new Error(`stageTableRequestCharge: pricing failed — ${priced.error}`);
  const table = await Table.findOne({ tableNo }).select("tableNo chargeAmount chargeLabel").lean();
  if (!table) throw new Error(`stageTableRequestCharge: table ${tableNo} not found`);
  const chargeApplies = await tableChargeAppliesNow(tableNo);
  const input: CreatePublicOrderRequestInput = {
    target: { kind: "table", token: "STAGE-TOKEN-UNUSED" },
    items: items.map((it) => ({
      productId: it.productId,
      variation: it.variation,
      modifiers: it.modifiers ?? [],
      instructions: it.instructions,
      qty: it.qty,
    })),
    name,
    mobile,
  };
  const doc = buildRequestDoc(input, priced.lines, table, null, chargeApplies);
  const shortCode = await mintUniquePublicCode((code) => OrderRequest.exists({ shortCode: code }).then(Boolean));
  return OrderRequest.create({ ...doc, shortCode });
}

type EditOutcome =
  | { error: "not-found" | "locked" | "cancelled" | "cas-miss" | "table-gone" | "new-item" }
  | { error: string } // pricing rejection, verbatim from priceRequestItems
  | { total: number; itemCount: number };

// Mirrors app/api/public/order-request/[shortCode]/route.ts's PATCH core (its
// steps 9-13: price, charge, re-quote, hp-skip aside, CAS) by hand — this
// script never stands up the HTTP routes themselves (file-level comment),
// same discipline as leg25b's hand-mirrored reject route. Skips the HTTP-only
// controls (BotID/host/body-size/rate-limit/Zod/age-gate) that the route/
// unit-test layers own. `settings` mirrors the route's readSettings() input;
// `note` carries the route's three-way semantics: undefined = keep the stored
// note, "" = clear, text = replace (review HIGH #1 2026-08-20).
async function applyEdit(
  shortCode: string,
  items: StageItem[],
  note?: string,
  settings: ISettings | null = null,
  // CR2.2c — three-way semantics matching `note`: undefined = keep the
  // stored code (re-resolved), "" = remove, text = apply that code.
  promoCode?: string,
): Promise<EditOutcome> {
  const doc = await OrderRequest.findOne({ shortCode }).lean();
  if (!doc) return { error: "not-found" };
  if (doc.status === "accepting" || doc.status === "accepted") return { error: "locked" };
  if (doc.status === "rejected") return { error: "cancelled" };

  // Route parity: an edit may only touch items already on the request, and it
  // re-prices with the accept bridge's isActive-only filter (a product hidden
  // from the public menu stays orderable once a request exists).
  const ordered = new Set(doc.items.map((it) => String(it.productId)));
  if (items.some((it) => !ordered.has(it.productId))) return { error: "new-item" };

  const productIds = items.map((it) => it.productId);
  const products = (await Product.find({ _id: { $in: productIds }, isActive: true })
    .select("name price discount available modifiers variations")
    .lean()) as unknown as PricedProductSource[];
  const priced = priceRequestItems(
    products,
    items.map((it) => ({
      productId: it.productId,
      variation: it.variation,
      modifiers: it.modifiers ?? [],
      instructions: it.instructions,
      qty: it.qty,
    })),
  );
  if ("error" in priced) return { error: priced.error };

  let table: IntakeTable | null = null;
  // Route parity: a parcel has no table session (see the route's own comment).
  let chargeApplies = true;
  if (doc.targetKind === "table" && doc.tableNo) {
    table = await Table.findOne({ tableNo: doc.tableNo }).select("tableNo chargeAmount chargeLabel").lean();
    // Route parity: a table-kind request whose Table row is gone 409s there
    // (EDIT_TABLE_CHANGED_MESSAGE) — surfaced as a distinct outcome here.
    if (!table && !(await hasOpenTabNow(doc.tableNo))) return { error: "table-gone" };
    chargeApplies = await tableChargeAppliesOnEditNow(doc.tableNo, doc._id);
  }

  // Route parity: promo three-way semantics — undefined keeps the stored
  // code (re-resolved against live settings + the NEW subtotal), "" drops
  // it, text applies it. Resolved against a probe of THIS edit's own
  // (re-priced) lines, never a hand-rolled amount.
  const requestedCode = promoCode !== undefined ? promoCode : doc.promoCode;
  let discount = 0;
  let resolvedCode: string | undefined;
  if (requestedCode) {
    // Route parity: a NEW code is refused once the table session is open; an
    // already-stored one is exempt (review 2026-08-20 — the edit screen was a
    // way to re-apply one flat code to every round of a tab).
    const isNewCode = normalizePromoCode(requestedCode) !== normalizePromoCode(doc.promoCode ?? "");
    if (isNewCode && !chargeApplies) return { error: PROMO_SESSION_OPEN };
    const probe = quoteRequestTotals(priced.lines, table, settings, chargeApplies);
    const resolved = resolvePromoDiscount(settings?.promoCodes, requestedCode, probe.quotedSubtotal);
    if ("error" in resolved) return { error: resolved.error };
    discount = resolved.discount;
    resolvedCode = resolved.code;
  }

  const quote = quoteRequestTotals(priced.lines, table, settings, chargeApplies, discount);

  const set: Record<string, unknown> = {
    items: quote.items,
    quotedSubtotal: quote.quotedSubtotal,
    quotedCharge: quote.quotedCharge,
    quotedTotal: quote.quotedTotal,
  };
  const unset: Record<string, ""> = {};
  if (quote.quotedChargeLabel) set.quotedChargeLabel = quote.quotedChargeLabel;
  else unset.quotedChargeLabel = "";
  if (note !== undefined) {
    // Route parity: the $set/$unset decision is made on the SANITIZED value,
    // so a note of only invisible/bidi characters clears rather than stores.
    const clean = sanitizePublicText(note);
    if (clean) set.note = clean;
    else unset.note = "";
  }
  if (quote.quotedDiscount > 0) set.quotedDiscount = quote.quotedDiscount;
  else unset.quotedDiscount = "";
  if (resolvedCode) set.promoCode = resolvedCode;
  else unset.promoCode = "";
  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length > 0) update.$unset = unset;

  const result = await OrderRequest.updateOne({ _id: doc._id, status: "pending" }, update);
  if (result.matchedCount === 0) return { error: "cas-miss" };
  return { total: quote.quotedTotal, itemCount: quote.items.length };
}

const STAFF_CTX = (actor: string): AcceptContext => ({ actor, settings: null, createCustomer: true });
const AUTO_CTX: AcceptContext = { actor: SELF_ORDER_RECEIVER, settings: null, createCustomer: false };
// A real gstConfigOfSettings/printConfigOf only ever reads the gst*/print*
// fields off `settings` (everything else is `?.`-optional with a default) —
// so a minimal object carrying just the three GST fields is a faithful stand-in
// for a live Settings doc at this call boundary, without standing up Settings.
const gstSettingsCtx = (actor: string, gst: { gstEnabled: boolean; gstRate: number; gstMode: GstMode }): AcceptContext => ({
  actor,
  settings: gst as unknown as ISettings,
  createCustomer: true,
});
// CR2.2c — same faithful-stand-in reasoning as gstSettingsCtx above: the
// accept bridge's own promo resolution only ever reads `settings.promoCodes`
// off the context, so a minimal object carrying just that field is enough.
const promoSettingsCtx = (actor: string, promoCodes: PromoCodeConfig[]): AcceptContext => ({
  actor,
  settings: { promoCodes } as unknown as ISettings,
  createCustomer: true,
});

const PROMO_CODES: PromoCodeConfig[] = [
  { code: "SAVE10", kind: "percent", value: 10, active: true },
  { code: "FLAT500", kind: "flat", value: 500, active: true },
];
// Same codes, SAVE10 flipped inactive — simulates a cafe deactivating a code
// between a diner's quote and staff's accept (leg30c).
const PROMO_CODES_SAVE10_INACTIVE: PromoCodeConfig[] = [
  { code: "SAVE10", kind: "percent", value: 10, active: false },
  { code: "FLAT500", kind: "flat", value: 500, active: true },
];
// SPEC P4 — a code capped to one accepted order per mobile, ever.
const PROMO_CODES_ONCE: PromoCodeConfig[] = [
  { code: "ONCE10", kind: "percent", value: 10, active: true, oncePerCustomer: true },
];

function line(productId: string, name: string, price: number, qty: number, kotRound: number): IOrderItem {
  return { productId, name, price, qty, modifiers: [], instructions: "", kotRound };
}

// A minimal, valid standalone Order — used only for the sparse-index legs
// (6) where the money/pricing math is irrelevant to what's being proved.
function minimalOrder(orderId: string, extra: Partial<IOrder> = {}) {
  return {
    orderId,
    customerName: "Walk-in",
    items: [line("p-x", "Item", 100, 1, 1)],
    subtotal: 100,
    discount: 0,
    gstAmount: 0,
    gstRate: 0,
    gstMode: "exclusive" as GstMode,
    total: 100,
    paidAmount: 0,
    payment: "Unpaid" as PaymentMode,
    status: "Pending" as OrderStatus,
    receiver: "Verifier",
    kotRounds: 1,
    ...extra,
  };
}

function rawOrderRequest(overrides: Partial<IOrderRequest> & { shortCode: string }) {
  return {
    targetKind: "parcel" as const,
    items: [{ productId: "p-x", name: "Item", price: 100, qty: 1, modifiers: [], instructions: "" }],
    quotedSubtotal: 100,
    quotedCharge: 0,
    quotedTotal: 100,
    mobile: "9990000000",
    name: "Fixture",
    status: "pending" as OrderRequestStatus,
    ...overrides,
  };
}

// ── legs ─────────────────────────────────────────────────────────────────────

async function leg1(): Promise<{ order: IOrder; requestId: string }> {
  console.log("\nLeg 1 — CREATE happy path: staff accept of a pending table request on a FREE table\n");

  await Table.create({ tableNo: "T-1", capacity: 4, status: "Available", chargeAmount: 40, chargeLabel: "Cover Charge" });

  const request = await stageRequest({
    targetKind: "table",
    tableNo: "T-1",
    items: [
      { productId: teaId, qty: 2 },
      { productId: burgerId, variation: "Large", modifiers: ["Cheese"], qty: 1 },
    ],
    name: "Asha",
    mobile: "9990000001",
  });
  const requestId = String(request._id);
  check("staged request has the expected quoted total (200 tea + 400 burger + 40 charge = 640)", request.quotedTotal === 640);

  const result = await acceptOrderRequest(requestId, STAFF_CTX("Staff A"));
  check("accept succeeds (no error)", !("error" in result));
  if ("error" in result) throw new Error(`leg1: accept unexpectedly failed — ${result.error}`);

  const { order, request: resolvedRequest, replayed } = result;
  check("replayed is false on a fresh accept", replayed === false);
  check("kotRounds is 1 on the opening round", order.kotRounds === 1);
  check("kotNumbers[0] is set (a real ticket, > 0)", (order.kotNumbers?.[0] ?? 0) > 0);
  check("orderId was allocated (ORD-YYYYMMDD-NNN shape)", /^ORD-\d{8}-\d+$/.test(order.orderId));
  check("receiver is the accepting staff member (the actor)", order.receiver === "Staff A");
  check("payment is Unpaid", order.payment === "Unpaid");
  check("status is Pending", order.status === "Pending");
  check("source is the self-order marker", order.source === SELF_ORDER_SOURCE);
  check("sourceRequestIds is exactly [requestId]", JSON.stringify(order.sourceRequestIds) === JSON.stringify([requestId]));
  check("the table's charge rode onto the order (40, 'Cover Charge')", order.chargeAmount === 40 && order.chargeLabel === "Cover Charge");
  check("total matches the quote (640)", order.total === 640);

  const table = await Table.findOne({ tableNo: "T-1" }).lean();
  check("the table is now Occupied with currentOrderId set to the order", table?.status === "Occupied" && table?.currentOrderId === order.orderId);

  check("the request is accepted with acceptedOrderId set", resolvedRequest.status === "accepted" && resolvedRequest.acceptedOrderId === order.orderId);

  const customer = await Customer.findOne({ mobile: "9990000001" }).lean();
  check("a Customer row was CREATED with the request's name/mobile", customer?.name === "Asha" && customer?.mobile === "9990000001");
  check("exactly one Customer row exists for this mobile", (await Customer.countDocuments({ mobile: "9990000001" })) === 1);

  return { order, requestId };
}

async function leg2(): Promise<void> {
  console.log("\nLeg 2 — existing-customer attach: same mobile, different name → original name wins, no second row\n");

  await Table.create({ tableNo: "T-2", capacity: 4, status: "Available" });

  const request = await stageRequest({
    targetKind: "table",
    tableNo: "T-2",
    items: [{ productId: teaId, qty: 1 }],
    name: "Wrong Name",
    mobile: "9990000001", // SAME mobile as leg1's Asha
  });

  const result = await acceptOrderRequest(String(request._id), STAFF_CTX("Staff A"));
  check("accept succeeds", !("error" in result));
  if ("error" in result) throw new Error(`leg2: accept unexpectedly failed — ${result.error}`);

  check("the order carries the EXISTING customer's ORIGINAL name, never the diner's submitted one", result.order.customerName === "Asha");
  const customer = await Customer.findOne({ mobile: "9990000001" }).lean();
  check("the existing customer's own name is untouched", customer?.name === "Asha");
  check("no second Customer row was minted for this mobile", (await Customer.countDocuments({ mobile: "9990000001" })) === 1);
}

async function leg3(order1: IOrder, requestId1: string): Promise<{ requestId3: string }> {
  console.log("\nLeg 3 — ADD-ROUND: accept another pending request for the SAME occupied table\n");

  const request3 = await stageRequest({
    targetKind: "table",
    tableNo: "T-1", // still occupied by leg1's order
    items: [{ productId: coffeeId, qty: 1 }],
    name: "Ravi",
    mobile: "9990000003",
  });
  const requestId3 = String(request3._id);

  const result = await acceptOrderRequest(requestId3, STAFF_CTX("Staff A"));
  check("add-round accept succeeds", !("error" in result));
  if ("error" in result) throw new Error(`leg3: accept unexpectedly failed — ${result.error}`);

  const { order, request: resolvedRequest } = result;
  check("round 2 was appended to the SAME order (same _id)", order._id.equals(order1._id));
  check("kotRounds is now 2", order.kotRounds === 2);
  check("kotNumbers has a positional entry for round 2", order.kotNumbers?.length === 2 && (order.kotNumbers?.[1] ?? 0) > 0);
  check("the coffee line carries kotRound 2", order.items.some((it) => it.productId === coffeeId && it.kotRound === 2));
  check(
    "totals were recomputed on the tab's stored GST snapshot (600 + 135 + 40 charge = 775)",
    order.total === 775,
  );
  check("chargeAmount is unchanged (still 40)", order.chargeAmount === 40);
  check("the request is accepted", resolvedRequest.status === "accepted" && resolvedRequest.acceptedOrderId === order.orderId);
  check(
    "sourceRequestIds now holds BOTH the create and the add-round request ids",
    (order.sourceRequestIds ?? []).length === 2 &&
      (order.sourceRequestIds ?? []).includes(requestId1) &&
      (order.sourceRequestIds ?? []).includes(requestId3),
  );

  return { requestId3 };
}

async function leg4(): Promise<void> {
  console.log("\nLeg 4 — DOUBLE-ACCEPT, create case: sequential replay, then a simulated crash-race resume\n");

  await Table.create({ tableNo: "T-4", capacity: 4, status: "Available" });
  const request = await stageRequest({
    targetKind: "table",
    tableNo: "T-4",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg4 Diner",
    mobile: "9990000004",
  });
  const requestId = String(request._id);

  const first = await acceptOrderRequest(requestId, STAFF_CTX("Staff B"));
  check("first accept succeeds", !("error" in first));
  if ("error" in first) throw new Error("leg4: first accept unexpectedly failed");

  const second = await acceptOrderRequest(requestId, STAFF_CTX("Staff B"));
  check("second (sequential) accept replays instead of erroring", !("error" in second));
  if ("error" in second) throw new Error("leg4: second accept unexpectedly failed");
  check("the replay reports replayed:true", second.replayed === true);
  check("the replay returns the SAME order _id", second.order._id.equals(first.order._id));
  check("exactly one Order carries this request id", (await Order.countDocuments({ sourceRequestIds: requestId })) === 1);

  // Simulate the crash-race: a request whose Order already exists but whose
  // OWN status got reset to "accepting" (mirrors a crash between the order
  // write and finalizeAccept's mark) — accept must RESUME it via the step-3
  // repair lookup, never mint a second order.
  await Table.create({ tableNo: "T-4B", capacity: 4, status: "Available" });
  const request4b = await stageRequest({
    targetKind: "table",
    tableNo: "T-4B",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg4b Diner",
    mobile: "9990000041",
  });
  const requestId4b = String(request4b._id);
  const accepted4b = await acceptOrderRequest(requestId4b, STAFF_CTX("Staff B"));
  if ("error" in accepted4b) throw new Error("leg4: 4b's own accept unexpectedly failed");

  await OrderRequest.updateOne({ _id: requestId4b }, { $set: { status: "accepting" } });
  const resumed = await acceptOrderRequest(requestId4b, STAFF_CTX("Staff B"));
  check("the crash-race resume succeeds (no error)", !("error" in resumed));
  if ("error" in resumed) throw new Error("leg4: crash-race resume unexpectedly failed");
  check("the resume reports replayed:true (via the repair lookup, not a fresh create)", resumed.replayed === true);
  check("the resume returns the SAME order the original accept minted", resumed.order._id.equals(accepted4b.order._id));
  check("still exactly one Order carries request 4b's id — nothing new was created", (await Order.countDocuments({ sourceRequestIds: requestId4b })) === 1);
}

async function leg5(order1: IOrder): Promise<void> {
  console.log("\nLeg 5 — DOUBLE-ACCEPT, add-round case: re-accepting an already-applied add-round replays, no double-append\n");

  const request5 = await stageRequest({
    targetKind: "table",
    tableNo: "T-1",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg5 Diner",
    mobile: "9990000005",
  });
  const requestId5 = String(request5._id);

  const first = await acceptOrderRequest(requestId5, STAFF_CTX("Staff A"));
  check("the add-round accept succeeds", !("error" in first));
  if ("error" in first) throw new Error("leg5: first accept unexpectedly failed");
  const itemCountAfterFirst = first.order.items.length;
  const kotRoundsAfterFirst = first.order.kotRounds;
  check("first is not a replay", first.replayed === false);

  const second = await acceptOrderRequest(requestId5, STAFF_CTX("Staff A"));
  check("re-accepting the SAME add-round request replays", !("error" in second) && second.replayed === true);
  if ("error" in second) throw new Error("leg5: second accept unexpectedly failed");
  check("items were NOT appended twice", second.order.items.length === itemCountAfterFirst);
  check("kotRounds is unchanged by the replay", second.order.kotRounds === kotRoundsAfterFirst);
  void order1;
}

async function leg6(requestId1: string): Promise<void> {
  console.log("\nLeg 6 — sparse-index safety: many sourceRequestIds-less orders coexist; a reused APPLIED id collides\n");

  await Order.create(minimalOrder("ORD-SPARSE-TEST-1"));
  await Order.create(minimalOrder("ORD-SPARSE-TEST-2"));
  check(
    "two ordinary orders with NO sourceRequestIds coexist under the unique sparse multikey index",
    (await Order.countDocuments({ orderId: { $in: ["ORD-SPARSE-TEST-1", "ORD-SPARSE-TEST-2"] } })) === 2,
  );

  let threw: unknown = null;
  try {
    await Order.create(minimalOrder("ORD-SPARSE-DUP", { sourceRequestIds: [requestId1] }));
  } catch (e) {
    threw = e;
  }
  check(
    "reusing an APPLIED request id in sourceRequestIds on a second document throws E11000",
    threw !== null && (threw as { code?: number }).code === DUPLICATE_KEY_CODE,
  );
}

async function leg7(): Promise<void> {
  console.log("\nLeg 7 — REJECT: pending→rejected via the reject route's CAS shape; double-reject and accept-after-reject\n");

  await Table.create({ tableNo: "T-7", capacity: 4, status: "Available" });
  const request7 = await stageRequest({
    targetKind: "table",
    tableNo: "T-7",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg7 Diner",
    mobile: "9990000007",
  });
  const requestId7 = String(request7._id);

  // Mirrors app/api/order-requests/[id]/reject/route.ts's exact CAS filter.
  const rejected = await OrderRequest.findOneAndUpdate(
    { _id: requestId7, status: "pending" },
    { $set: { status: "rejected", rejectedReason: "Kitchen closed", actor: "Staff D" } },
    { new: true },
  );
  check("pending → rejected via the reject route's CAS", rejected?.status === "rejected");

  // Rejecting an already-ACCEPTED request (leg1's) matches nothing.
  const acceptedRequest = await OrderRequest.findOne({ acceptedOrderId: { $exists: true }, mobile: "9990000001" }).lean();
  if (!acceptedRequest) throw new Error("leg7: could not find an already-accepted request from leg1 to test against");
  const missResult = await OrderRequest.updateOne(
    { _id: acceptedRequest._id, status: "pending" },
    { $set: { status: "rejected", rejectedReason: "should not land" } },
  );
  check("rejecting an ACCEPTED request matches nothing", missResult.matchedCount === 0);

  const acceptOnRejected = await acceptOrderRequest(requestId7, STAFF_CTX("Staff D"));
  check(
    "accepting a REJECTED request returns REQUEST_REJECTED_ERROR with 409",
    "error" in acceptOnRejected && acceptOnRejected.error === REQUEST_REJECTED_ERROR && acceptOnRejected.status === 409,
  );
}

async function leg8(): Promise<void> {
  console.log("\nLeg 8 — AUTO mode: unknown mobile mints no customer; known mobile attaches the existing one\n");

  const unknown = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "New Guy",
    mobile: "9990000099",
  });
  const unknownResult = await acceptOrderRequest(String(unknown._id), AUTO_CTX);
  check("auto-mode accept with an unknown mobile succeeds", !("error" in unknownResult));
  if ("error" in unknownResult) throw new Error("leg8: unknown-mobile accept unexpectedly failed");
  check("the order's receiver is the self-order sentinel", unknownResult.order.receiver === SELF_ORDER_RECEIVER);
  check("NO Customer row was minted for the unknown mobile (createCustomer:false)", (await Customer.countDocuments({ mobile: "9990000099" })) === 0);

  const known = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Someone Else",
    mobile: "9990000001", // Asha, already a customer from leg1
  });
  const knownResult = await acceptOrderRequest(String(known._id), AUTO_CTX);
  check("auto-mode accept with a KNOWN mobile succeeds", !("error" in knownResult));
  if ("error" in knownResult) throw new Error("leg8: known-mobile accept unexpectedly failed");
  const asha = await Customer.findOne({ mobile: "9990000001" }).lean();
  check("the order attaches the EXISTING customer even in auto mode with createCustomer:false", knownResult.order.customerId === String(asha?._id));
  check("the order carries the existing customer's own name", knownResult.order.customerName === "Asha");
}

async function leg9(): Promise<void> {
  console.log("\nLeg 9 — PARCEL: no table, zero charge, a control table is left untouched\n");

  await Table.create({ tableNo: "T-9-CONTROL", capacity: 4, status: "Available" });

  const request = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Parcel Guy",
    mobile: "9990000009",
  });
  const result = await acceptOrderRequest(String(request._id), STAFF_CTX("Staff C"));
  check("parcel accept succeeds", !("error" in result));
  if ("error" in result) throw new Error("leg9: parcel accept unexpectedly failed");

  const stored = await Order.findById(result.order._id).lean();
  check("the order carries no tableNo", !stored?.tableNo);
  check("the order carries no chargeAmount (absent, not 0)", !!stored && !("chargeAmount" in stored));

  const control = await Table.findOne({ tableNo: "T-9-CONTROL" }).lean();
  check("the control table's status is unchanged by an unrelated parcel accept", control?.status === "Available" && !control?.currentOrderId);
}

async function leg10(): Promise<void> {
  console.log("\nLeg 10 — Occupied-no-tab conflict: table Occupied but its order already Completed\n");

  const staleOrder = await Order.create(
    minimalOrder("ORD-LEG10-001", { tableNo: "T-10", status: "Completed" as OrderStatus, payment: "Cash" as PaymentMode, paidAmount: 100 }),
  );
  await Table.create({ tableNo: "T-10", capacity: 4, status: "Occupied", currentOrderId: staleOrder.orderId });

  const request = await stageRequest({
    targetKind: "table",
    tableNo: "T-10",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg10 Diner",
    mobile: "9990000010",
  });
  const requestId = String(request._id);

  const result = await acceptOrderRequest(requestId, STAFF_CTX("Staff E"));
  check(
    "accept 409s with TABLE_STATE_CONFLICT_ERROR naming the table",
    "error" in result && result.status === 409 && result.error === TABLE_STATE_CONFLICT_ERROR("T-10"),
  );

  const after = await OrderRequest.findById(requestId).lean();
  check("the request is back to pending after the conflict", after?.status === "pending");
}

async function leg11(): Promise<void> {
  console.log("\nLeg 11 — PRICE DRIFT: add-round line-price drift, and create-case quoted-total drift\n");

  // ── a) add-round drift ──────────────────────────────────────────────────
  const request11a = await stageRequest({
    targetKind: "table",
    tableNo: "T-1", // still open from legs 1/3/5
    items: [{ productId: coffeeId, qty: 1 }],
    name: "Leg11a Diner",
    mobile: "9990000011",
  });
  const requestId11a = String(request11a._id);

  await Product.updateOne({ _id: coffeeId }, { $set: { price: 999 } });
  const result11a = await acceptOrderRequest(requestId11a, STAFF_CTX("Staff F"));
  check(
    "a) an add-round line-price drift 409s with PRICE_DRIFT_ERROR",
    "error" in result11a && result11a.status === 409 && result11a.error === PRICE_DRIFT_ERROR,
  );
  const after11a = await OrderRequest.findById(requestId11a).lean();
  check("a) the request is back to pending after the price-drift rejection", after11a?.status === "pending");
  await Product.updateOne({ _id: coffeeId }, { $set: { price: 150 } }); // restore for later legs

  // ── b) create-case quoted-total drift (table charge moved) ─────────────
  await Table.create({ tableNo: "T-11B", capacity: 4, status: "Available", chargeAmount: 20, chargeLabel: "Service" });
  const request11b = await stageRequest({
    targetKind: "table",
    tableNo: "T-11B",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg11b Diner",
    mobile: "9990000012",
  });
  check("b) the staged quote includes the ORIGINAL charge (100 + 20 = 120)", request11b.quotedTotal === 120);
  const requestId11b = String(request11b._id);

  await Table.updateOne({ tableNo: "T-11B" }, { $set: { chargeAmount: 999 } });
  const result11b = await acceptOrderRequest(requestId11b, STAFF_CTX("Staff F"));
  check(
    "b) a moved table charge makes the create-case total disagree with the quote → PRICE_DRIFT_ERROR, 409",
    "error" in result11b && result11b.status === 409 && result11b.error === PRICE_DRIFT_ERROR,
  );
  const after11b = await OrderRequest.findById(requestId11b).lean();
  check("b) the request is back to pending after the quoted-total drift rejection", after11b?.status === "pending");
}

async function leg12(): Promise<void> {
  console.log("\nLeg 12 — RATE LIMIT: hitRateLimit windowing, an independent bucket, window rollover, and pruneRateWindows\n");

  const bucket = "LEG12-BUCKET";
  const max = 3;
  const now0 = Date.now();

  for (let i = 1; i <= max; i++) {
    const decision = await hitRateLimit(bucket, max, now0);
    check(`hit ${i}/${max} is allowed`, decision.allowed === true);
  }
  const overLimit = await hitRateLimit(bucket, max, now0);
  check(`hit ${max + 1} is blocked`, overLimit.allowed === false);
  check("a blocked hit reports retryAfterSec >= 1", overLimit.retryAfterSec >= 1);

  const parcelDecision = await hitRateLimit(PARCEL_BUCKET_KEY, max, now0);
  check("a DIFFERENT bucket (the parcel bucket) is unaffected by the first bucket's cap", parcelDecision.allowed === true);

  // CR2.2 fix round — peekRateLimit: read-only, never increments (the
  // honeypot metering gate's own primitive).
  const peekedEmpty = await peekRateLimit("LEG12-PEEK", now0);
  check("peekRateLimit on an untouched bucket reads 0", peekedEmpty === 0);
  await hitRateLimit("LEG12-PEEK", max, now0);
  await hitRateLimit("LEG12-PEEK", max, now0);
  const peekedAfterTwoHits = await peekRateLimit("LEG12-PEEK", now0);
  check("peekRateLimit reflects the real count after two real hits (2)", peekedAfterTwoHits === 2);
  const peekedAgain = await peekRateLimit("LEG12-PEEK", now0);
  check("calling peekRateLimit again does NOT increment — still reads 2", peekedAgain === 2);
  await hitRateLimit("LEG12-PEEK", max, now0);
  const finalCount = await peekRateLimit("LEG12-PEEK", now0);
  check("the counter reads exactly 3 after a real 3rd hit — the peeks never inflated it", finalCount === 3);

  const now1 = now0 + PUBLIC_ORDER_RATE_WINDOW_MS; // next fixed window
  const rolledOver = await hitRateLimit(bucket, max, now1);
  check("advancing `now` past the window resets the count — allowed again", rolledOver.allowed === true && rolledOver.freshWindow === true);

  // pruneRateWindows: an ancient window (older than 2x the window size) is
  // reaped; the just-created live window survives.
  const staleKey = rateWindowKey("LEG12-STALE", 0);
  await PublicRateLimit.create({ _id: staleKey, n: 1, at: new Date(now1 - 2 * PUBLIC_ORDER_RATE_WINDOW_MS - 1000) });
  await pruneRateWindows(now1);
  const staleGone = await PublicRateLimit.findById(staleKey).lean();
  check("pruneRateWindows removes a window older than 2x the window size", staleGone === null);
  const liveKey = rateWindowKey(bucket, now1);
  const liveSurvives = await PublicRateLimit.findById(liveKey).lean();
  check("pruneRateWindows keeps the live window", liveSurvives !== null);
}

async function leg13(): Promise<void> {
  console.log("\nLeg 13 — PRUNING: stale accepted/rejected/pending rows are reaped; a fresh pending one survives\n");

  const nowP = Date.now();

  const oldAccepted = await OrderRequest.create(rawOrderRequest({ shortCode: "LEG13ACPT1", status: "accepted", acceptedOrderId: "ORD-FAKE-13A" }));
  const oldRejected = await OrderRequest.create(rawOrderRequest({ shortCode: "LEG13REJ01", status: "rejected", rejectedReason: "test" }));
  const oldPending = await OrderRequest.create(rawOrderRequest({ shortCode: "LEG13PEND1", status: "pending" }));
  const freshPending = await OrderRequest.create(rawOrderRequest({ shortCode: "LEG13FRESH", status: "pending" }));

  // Mongoose timestamps resist casual backdating (they're re-stamped on
  // save/update by the plugin) — bypass via a RAW collection write.
  // FIX8(a) — resolved rows (accepted/rejected) are reaped on createdAt now,
  // not updatedAt (rides the existing {status:1, createdAt:-1} index instead
  // of a COLLSCAN) — backdate createdAt here to match.
  await OrderRequest.collection.updateMany(
    { _id: { $in: [oldAccepted._id, oldRejected._id] } },
    { $set: { createdAt: new Date(resolvedCutoff(nowP).getTime() - 1000) } },
  );
  await OrderRequest.collection.updateMany(
    { _id: oldPending._id },
    { $set: { createdAt: new Date(pendingCutoff(nowP).getTime() - 1000) } },
  );

  await pruneOrderRequests(nowP);

  const remainingIds = new Set(
    (await OrderRequest.find({ _id: { $in: [oldAccepted._id, oldRejected._id, oldPending._id, freshPending._id] } }).lean()).map((d) =>
      String(d._id),
    ),
  );
  check("the stale accepted row was pruned", !remainingIds.has(String(oldAccepted._id)));
  check("the stale rejected row was pruned", !remainingIds.has(String(oldRejected._id)));
  check("the stale pending row was pruned", !remainingIds.has(String(oldPending._id)));
  check("the fresh pending row survives", remainingIds.has(String(freshPending._id)));
  check("exactly the three stale rows were removed (no over/under-pruning)", remainingIds.size === 1);
}

async function leg14(): Promise<void> {
  console.log("\nLeg 14 — stored-doc hygiene: control characters are stripped from name/note/instructions\n");

  // \uXXXX escapes ONLY — never literal control characters in source.
  const rawName = "Rogue"; // BEL
  const rawNote = "Pleasehurry"; // ESC
  const rawInstructions = "no onionextra ghee"; // BEL between two words

  const request = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1, instructions: rawInstructions }],
    name: rawName,
    mobile: "9990000014",
    note: rawNote,
  });

  const stored = await OrderRequest.findById(request._id).lean();
  check("control characters are stripped from the stored name (replaced with a space, not dropped)", stored?.name === "Ro gue");
  check("control characters are stripped from the stored note", stored?.note === "Please hurry");
  check(
    "control characters are stripped from the stored item instructions (no two words glued together)",
    stored?.items[0]?.instructions === "no onion extra ghee",
  );
  // COVERAGE GAP (reported, not filled): buildRequestDoc does not itself cap
  // note/name length — PUBLIC_NOTE_MAX_LEN/PUBLIC_NAME_MAX_LEN are enforced by
  // the Zod schema (createPublicOrderRequestSchema) at the route layer, which
  // this script deliberately bypasses (it calls buildRequestDoc directly).
  // So only sanitization is asserted here, not truncation.
}

async function leg15(): Promise<void> {
  console.log("\nLeg 15 — shortCode uniqueness: a duplicate insert throws E11000\n");

  await OrderRequest.create(rawOrderRequest({ shortCode: "DUPECODE01" }));
  let threw: unknown = null;
  try {
    await OrderRequest.create(rawOrderRequest({ shortCode: "DUPECODE01" }));
  } catch (e) {
    threw = e;
  }
  check("a duplicate shortCode throws E11000", threw !== null && (threw as { code?: number }).code === DUPLICATE_KEY_CODE);
}

// ── review-fix-wave legs (arbiter-confirmed FIX1/FIX2/FIX3/FIX4/FIX5/FIX6/
// FIX7/FIX8/FIX9) — appended after the original 15, which stay green above
// unmodified in behavior (leg13's staging was corrected for FIX8(a), same
// assertions, see its comment). ──────────────────────────────────────────

async function leg16(): Promise<void> {
  console.log(
    "\nLeg 16 — FIX1 loser-revert race repair: applyAddRound's own CAS-miss on an ALREADY-APPLIED request replays via guardedReject, never reverts to pending\n",
  );

  await Table.create({ tableNo: "T-16", capacity: 4, status: "Available" });
  const openRequest = await stageRequest({
    targetKind: "table",
    tableNo: "T-16",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg16 Opener",
    mobile: "9990000016",
  });
  const openResult = await acceptOrderRequest(String(openRequest._id), STAFF_CTX("Staff G"));
  if ("error" in openResult) throw new Error("leg16: opening the tab unexpectedly failed");

  // The "loser" reads the tab's kotRounds/voids BEFORE the winner's round below lands.
  const staleOpenTab = (await Order.findOne({ _id: openResult.order._id })
    .select("_id kotRounds voids")
    .lean()) as unknown as Pick<IOrder, "_id" | "kotRounds" | "voids">;

  const request16 = await stageRequest({
    targetKind: "table",
    tableNo: "T-16",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg16 Diner",
    mobile: "9990000017",
  });
  const requestId16 = String(request16._id);

  // The WINNER: a normal accept applies this request's round for real.
  const winnerResult = await acceptOrderRequest(requestId16, STAFF_CTX("Staff G"));
  check("the winner's accept succeeds", !("error" in winnerResult));
  if ("error" in winnerResult) throw new Error("leg16: winner accept unexpectedly failed");
  const itemCountAfterWinner = winnerResult.order.items.length;
  const kotRoundsAfterWinner = winnerResult.order.kotRounds;

  // Simulate the LOSER: reset the (already-applied) request back to
  // "accepting" — mirrors the instant a concurrent caller's own step-2 CAS
  // landed just before the winner's write — then force applyAddRound with
  // the STALE pre-winner openTab snapshot, so its own CAS filter (kotRounds
  // pinned to the stale value) misses against the now-mutated order.
  await OrderRequest.updateOne({ _id: requestId16 }, { $set: { status: "accepting" } });
  const loserUpdate = {
    $set: { kotRounds: (staleOpenTab.kotRounds ?? 0) + 1 },
    $addToSet: { sourceRequestIds: requestId16 },
  };
  const loserResult = await applyAddRound(staleOpenTab, loserUpdate, requestId16, "Staff H (loser)");
  check("the loser's stale-snapshot CAS-miss does NOT surface as an error", !("error" in loserResult));
  if ("error" in loserResult) throw new Error(`leg16: loser path unexpectedly errored — ${loserResult.error}`);
  check(
    "guardedReject resolves the miss as a REPLAY of the winner's round — same order, no duplicated items/rounds",
    loserResult.replayed === true &&
      loserResult.order._id.equals(winnerResult.order._id) &&
      loserResult.order.items.length === itemCountAfterWinner &&
      loserResult.order.kotRounds === kotRoundsAfterWinner,
  );

  const requestAfter16 = await OrderRequest.findById(requestId16).lean();
  check("the request ends ACCEPTED — the loser's miss never reverted it to pending", requestAfter16?.status === "accepted");
}

async function leg17(): Promise<void> {
  console.log(
    "\nLeg 17 — finalize-from-pending: an Order already carries a request id whose row is still 'pending' (pre-fix race artifact) — accept repairs via the step-3 lookup, never mints a second order\n",
  );

  const request17 = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg17 Diner",
    mobile: "9990000018",
  });
  const requestId17 = String(request17._id);
  check("the staged request starts pending (never touched 'accepting')", request17.status === "pending");

  const preExisting = await Order.create(minimalOrder("ORD-LEG17-001", { sourceRequestIds: [requestId17] }));

  const result17 = await acceptOrderRequest(requestId17, STAFF_CTX("Staff I"));
  check("accept succeeds from a pending request an Order already carries", !("error" in result17));
  if ("error" in result17) throw new Error(`leg17: accept unexpectedly failed — ${result17.error}`);
  check(
    "the repair replays the PRE-EXISTING order; the request ends accepted, pointing at it",
    result17.replayed === true &&
      result17.order._id.equals(preExisting._id) &&
      result17.request.status === "accepted" &&
      result17.request.acceptedOrderId === preExisting.orderId,
  );
  check(
    "exactly one Order carries this request id — no second order was minted",
    (await Order.countDocuments({ sourceRequestIds: requestId17 })) === 1,
  );
}

async function leg18(): Promise<void> {
  console.log(
    "\nLeg 18 — FIX3 ensureTableClaim repair: a crash-window Order+table pair gets its table claim repaired on accept; a table already Occupied by ANOTHER order is left untouched\n",
  );

  // ── a) repair case: order exists, table was never claimed ──────────────
  await Table.create({ tableNo: "T-18A", capacity: 4, status: "Available" });
  const request18a = await stageRequest({
    targetKind: "table",
    tableNo: "T-18A",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg18a Diner",
    mobile: "9990000019",
  });
  const requestId18a = String(request18a._id);
  const order18a = await Order.create(
    minimalOrder("ORD-LEG18A-001", { tableNo: "T-18A", sourceRequestIds: [requestId18a] }),
  );
  await OrderRequest.updateOne({ _id: requestId18a }, { $set: { status: "accepting" } });

  const before18a = await Table.findOne({ tableNo: "T-18A" }).lean();
  check("a) the table starts Available while the order already exists (the crash window)", before18a?.status === "Available");

  const result18a = await acceptOrderRequest(requestId18a, STAFF_CTX("Staff J"));
  if ("error" in result18a) throw new Error(`leg18: repair-case accept unexpectedly failed — ${result18a.error}`);
  check(
    "a) accept replays the pre-existing order via the crash-window repair",
    result18a.replayed === true && result18a.order._id.equals(order18a._id),
  );

  const after18a = await Table.findOne({ tableNo: "T-18A" }).lean();
  check(
    "a) ensureTableClaim repairs the table — now Occupied, currentOrderId set to the order",
    after18a?.status === "Occupied" && after18a?.currentOrderId === order18a.orderId,
  );

  // ── b) no-op case: table already Occupied by a DIFFERENT order ─────────
  const otherOrder = await Order.create(minimalOrder("ORD-LEG18B-OTHER"));
  await Table.create({ tableNo: "T-18B", capacity: 4, status: "Occupied", currentOrderId: otherOrder.orderId });
  const request18b = await stageRequest({
    targetKind: "table",
    tableNo: "T-18B",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg18b Diner",
    mobile: "9990000020",
  });
  const requestId18b = String(request18b._id);
  await Order.create(minimalOrder("ORD-LEG18B-001", { tableNo: "T-18B", sourceRequestIds: [requestId18b] }));
  await OrderRequest.updateOne({ _id: requestId18b }, { $set: { status: "accepting" } });

  const result18b = await acceptOrderRequest(requestId18b, STAFF_CTX("Staff J"));
  if ("error" in result18b) throw new Error(`leg18: no-op-case accept unexpectedly failed — ${result18b.error}`);

  const tableAfter18b = await Table.findOne({ tableNo: "T-18B" }).lean();
  check(
    "b) a table already Occupied by ANOTHER order is left untouched by the repair (no-op)",
    tableAfter18b?.status === "Occupied" && tableAfter18b?.currentOrderId === otherOrder.orderId,
  );
}

async function leg19(): Promise<void> {
  console.log(
    "\nLeg 19 — FIX4 age gate: a pending request older than the 12h TTL 409s BEFORE the claim CAS ever runs; a fresh one still accepts\n",
  );

  const request19 = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg19 Diner",
    mobile: "9990000021",
  });
  const requestId19 = String(request19._id);
  const nowA = Date.now();
  await OrderRequest.collection.updateOne(
    { _id: request19._id },
    { $set: { createdAt: new Date(pendingCutoff(nowA).getTime() - 1000) } },
  );

  const result19 = await acceptOrderRequest(requestId19, STAFF_CTX("Staff K"));
  check(
    "a request older than the pending TTL 409s with REQUEST_TOO_OLD_ERROR",
    "error" in result19 && result19.status === 409 && result19.error === REQUEST_TOO_OLD_ERROR,
  );
  const after19 = await OrderRequest.findById(requestId19).lean();
  check("the stale request STAYS pending — the claim CAS never ran (never touched 'accepting')", after19?.status === "pending");

  const request19b = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg19b Diner",
    mobile: "9990000022",
  });
  const result19b = await acceptOrderRequest(String(request19b._id), STAFF_CTX("Staff K"));
  check("a FRESH request (well within the TTL) still accepts normally", !("error" in result19b));
}

async function leg20(): Promise<void> {
  console.log(
    "\nLeg 20 — FIX5 GST-snapshot drift: an add-round bills against the TAB's frozen GST snapshot, not live settings — a live-config change 409s and leaves the tab untouched\n",
  );

  await Table.create({ tableNo: "T-20", capacity: 4, status: "Available" });
  const openRequest = await stageRequest({
    targetKind: "table",
    tableNo: "T-20",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg20 Diner",
    mobile: "9990000023",
  });
  // stageRequest's own quote is built against buildRequestDoc(..., settings:
  // null) — i.e. gstConfigOfSettings(undefined)'s defaults (disabled, 0%,
  // inclusive). gstA matches that EXACTLY so the create-path's own
  // totalMatchesQuote check (unrelated to this leg) doesn't drift the quote
  // out from under the open; only the add-round path below is under test.
  const gstA: { gstEnabled: boolean; gstRate: number; gstMode: GstMode } = { gstEnabled: false, gstRate: 0, gstMode: "inclusive" };
  const openResult = await acceptOrderRequest(String(openRequest._id), gstSettingsCtx("Staff L", gstA));
  check("the tab opens under GST config A (no GST)", !("error" in openResult));
  if ("error" in openResult) throw new Error(`leg20: opening accept unexpectedly failed — ${openResult.error} (status ${openResult.status})`);
  const tabTotalBefore = openResult.order.total;
  const kotRoundsBefore = openResult.order.kotRounds;
  const itemsBefore = openResult.order.items.length;

  const addRoundRequest = await stageRequest({
    targetKind: "table",
    tableNo: "T-20",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg20b Diner",
    mobile: "9990000024",
  });
  const requestId20b = String(addRoundRequest._id);
  const gstB = { gstEnabled: true, gstRate: 12, gstMode: "exclusive" as GstMode }; // rate moved after the tab opened
  const driftResult = await acceptOrderRequest(requestId20b, gstSettingsCtx("Staff L", gstB));
  check(
    "a live GST-config drift on the add-round path 409s with PRICE_DRIFT_ERROR",
    "error" in driftResult && driftResult.status === 409 && driftResult.error === PRICE_DRIFT_ERROR,
  );
  const requestAfter20b = await OrderRequest.findById(requestId20b).lean();
  check("the add-round request is back to pending after the GST-drift rejection", requestAfter20b?.status === "pending");

  const tabAfter = await Order.findById(openResult.order._id).lean();
  check(
    "the open tab itself is UNCHANGED by the rejected add-round (same total/kotRounds/item count)",
    tabAfter?.total === tabTotalBefore && tabAfter?.kotRounds === kotRoundsBefore && tabAfter?.items.length === itemsBefore,
  );
}

async function leg21(): Promise<void> {
  console.log("\nLeg 21 — FIX6 note carry: a diner's note lands on `notes` at create; a second note on an add-round is JOINED, not overwritten\n");

  await Table.create({ tableNo: "T-21", capacity: 4, status: "Available" });
  const request21a = await stageRequest({
    targetKind: "table",
    tableNo: "T-21",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg21a Diner",
    mobile: "9990000025",
    note: "No sugar please",
  });
  const result21a = await acceptOrderRequest(String(request21a._id), STAFF_CTX("Staff M"));
  if ("error" in result21a) throw new Error("leg21: create accept unexpectedly failed");
  check("a create-accept's notes equal the request's note verbatim", result21a.order.notes === "No sugar please");

  const request21b = await stageRequest({
    targetKind: "table",
    tableNo: "T-21",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg21b Diner",
    mobile: "9990000026",
    note: "Extra napkins",
  });
  const result21b = await acceptOrderRequest(String(request21b._id), STAFF_CTX("Staff M"));
  if ("error" in result21b) throw new Error("leg21: add-round accept unexpectedly failed");
  check(
    "an add-round's notes are JOINED — the first note is preserved and the new one appended",
    result21b.order.notes === "No sugar please | Extra napkins",
  );
}

async function leg22(): Promise<void> {
  console.log("\nLeg 22 — FIX7 createOrFindCustomer E11000 race: a duplicate-mobile create attempt attaches the existing row instead of failing\n");

  const existing = await Customer.create({ name: "Original Name", mobile: "9990000027" });

  // Forces the ACTUAL try/catch/duplicate-key path (not simulated): the row
  // already exists, so this create attempt genuinely throws E11000.
  const attached = await createOrFindCustomer("Racing Name", "9990000027");
  check(
    "createOrFindCustomer attaches the EXISTING row on a genuine E11000, original name intact",
    String(attached._id) === String(existing._id) && attached.name === "Original Name",
  );
  check("no second Customer row was minted for this mobile", (await Customer.countDocuments({ mobile: "9990000027" })) === 1);
}

async function leg23(): Promise<void> {
  console.log(
    "\nLeg 23 — FIX8(b) PRUNE SWEEPS: an 'accepting' row is EXCLUDED from the 12h pending sweep but reaped by its own 48h sweep\n",
  );

  const nowQ = Date.now();
  const HOUR_MS = 60 * 60 * 1000;

  const accepting13h = await OrderRequest.create(rawOrderRequest({ shortCode: "LEG23ACPT1", status: "accepting" }));
  const accepting49h = await OrderRequest.create(rawOrderRequest({ shortCode: "LEG23ACPT2", status: "accepting" }));

  // 13h old: past the 12h pending cutoff, well within the 48h accepting cutoff.
  await OrderRequest.collection.updateOne(
    { _id: accepting13h._id },
    { $set: { createdAt: new Date(pendingCutoff(nowQ).getTime() - HOUR_MS) } },
  );
  // 49h old: past the 48h accepting cutoff.
  await OrderRequest.collection.updateOne(
    { _id: accepting49h._id },
    { $set: { createdAt: new Date(acceptingCutoff(nowQ).getTime() - HOUR_MS) } },
  );

  await pruneOrderRequests(nowQ);

  const remaining = new Set(
    (await OrderRequest.find({ _id: { $in: [accepting13h._id, accepting49h._id] } }).lean()).map((d) => String(d._id)),
  );
  check("a 13h-old 'accepting' row SURVIVES — excluded from the 12h pending sweep", remaining.has(String(accepting13h._id)));
  check("a 49h-old 'accepting' row is PRUNED by its own 48h sweep", !remaining.has(String(accepting49h._id)));
}

async function leg24(): Promise<void> {
  console.log(
    "\nLeg 24 — FIX9(b) reject-route guard: the widened accepting-CAS pre-check refuses an APPLIED request; a stranded order-free 'accepting' row can still be rejected\n",
  );

  // Mirrors app/api/order-requests/[id]/reject/route.ts's exact sequence:
  // verify-before-CAS (findByRequestId), THEN the widened pending|accepting CAS.

  // ── a) applied case: an Order already carries this request id ──────────
  const request24a = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg24a Diner",
    mobile: "9990000028",
  });
  const requestId24a = String(request24a._id);
  await Order.create(minimalOrder("ORD-LEG24A-001", { sourceRequestIds: [requestId24a] }));
  await OrderRequest.updateOne({ _id: requestId24a }, { $set: { status: "accepting" } });

  const appliedOrder24a = await findByRequestId(requestId24a);
  let rejectedRow24a: IOrderRequest | null = null;
  if (!appliedOrder24a) {
    rejectedRow24a = await OrderRequest.findOneAndUpdate(
      { _id: requestId24a, status: { $in: ["pending", "accepting"] } },
      { $set: { status: "rejected", rejectedReason: "should not land" } },
      { new: true },
    );
  }
  check(
    "a) an APPLIED request is refused by the pre-check — the CAS never even runs",
    appliedOrder24a !== null && rejectedRow24a === null,
  );
  const after24a = await OrderRequest.findById(requestId24a).lean();
  check("a) the applied request's status is untouched — never reaches 'rejected'", after24a?.status === "accepting");

  // ── b) stranded case: 'accepting' but NO order was ever created ────────
  const request24b = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg24b Diner",
    mobile: "9990000029",
  });
  const requestId24b = String(request24b._id);
  await OrderRequest.updateOne({ _id: requestId24b }, { $set: { status: "accepting" } });

  const appliedOrder24b = await findByRequestId(requestId24b);
  let rejectedRow24b: IOrderRequest | null = null;
  if (!appliedOrder24b) {
    rejectedRow24b = await OrderRequest.findOneAndUpdate(
      { _id: requestId24b, status: { $in: ["pending", "accepting"] } },
      { $set: { status: "rejected", rejectedReason: "kitchen closed" } },
      { new: true },
    );
  }
  check(
    "b) a stranded order-free 'accepting' row passes the pre-check and CAN be rejected",
    appliedOrder24b === null && rejectedRow24b?.status === "rejected",
  );
}

// ── CR2.2 FINAL fix round (billed-but-rejected race + age-gate/crash-repair
// ordering) — appended after the original 24 legs, which stay green above
// unmodified in behavior. ──────────────────────────────────────────────────

async function leg25(): Promise<void> {
  console.log(
    "\nLeg 25 — billed-but-rejected race: finalizeAccept's widened CAS (now includes \"rejected\") repairs a row forced 'rejected' mid-race; the reject route's own post-CAS re-check converges the same way\n",
  );

  // ── a) finalizeCasFilter widening ───────────────────────────────────────
  const request25a = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg25a Diner",
    mobile: "9990000030",
  });
  const requestId25a = String(request25a._id);
  // Simulate the exact race window: the order-write already landed while a
  // concurrent reject won the CAS and set the row "rejected" BEFORE
  // finalizeAccept's own CAS ran.
  const order25a = await Order.create(minimalOrder("ORD-LEG25A-001", { sourceRequestIds: [requestId25a] }));
  await OrderRequest.updateOne({ _id: requestId25a }, { $set: { status: "rejected", rejectedReason: "raced" } });

  const finalized25a = await finalizeAccept(order25a, requestId25a, "Staff N", true);
  check(
    "a) finalizeAccept marks a raced-rejected row accepted (return value) instead of leaving it stuck against a real Order",
    finalized25a.request.status === "accepted" && finalized25a.request.acceptedOrderId === order25a.orderId,
  );
  const after25a = await OrderRequest.findById(requestId25a).lean();
  check("a) the row reads accepted IN THE DB, not just the in-memory return", after25a?.status === "accepted");

  // ── b) reject route's own post-CAS re-check (mirrors the route by hand —
  // this script deliberately never stands up HTTP routes; see the file-level
  // comment) ───────────────────────────────────────────────────────────────
  const request25b = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg25b Diner",
    mobile: "9990000031",
  });
  const requestId25b = String(request25b._id);

  const preCheck25b = await findByRequestId(requestId25b);
  check("b) the reject route's pre-check finds no order yet", preCheck25b === null);

  const casResult25b = await OrderRequest.findOneAndUpdate(
    { _id: requestId25b, status: { $in: ["pending", "accepting"] } },
    { $set: { status: "rejected", rejectedReason: "raced", actor: "Staff O" } },
    { new: true },
  );
  check("b) the reject CAS lands (status now \"rejected\")", casResult25b?.status === "rejected");

  // NOW an accept's own order-write lands in the gap between the CAS and the
  // route's post-CAS re-check.
  const order25b = await Order.create(minimalOrder("ORD-LEG25B-001", { sourceRequestIds: [requestId25b] }));

  const raced25b = await findByRequestId(requestId25b);
  check(
    "b) the post-CAS re-check now finds the raced order",
    raced25b !== null && raced25b._id.equals(order25b._id),
  );
  if (raced25b) {
    await OrderRequest.findOneAndUpdate(
      { _id: requestId25b, status: "rejected" },
      { $set: { status: "accepting" } },
    );
  }
  const handedBack25b = await OrderRequest.findById(requestId25b).lean();
  check("b) the row was handed back to \"accepting\", never left \"rejected\"", handedBack25b?.status === "accepting");

  const converged25b = await finalizeAccept(order25b, requestId25b, "Staff O", true);
  check(
    "b) the accept flow's own finalizeAccept still converges the handed-back row to accepted",
    converged25b.request.status === "accepted" && converged25b.request.acceptedOrderId === order25b.orderId,
  );
}

async function leg26(): Promise<void> {
  console.log(
    "\nLeg 26 — age gate vs crash repair: an 'accepting' row past the 12h cutoff WITH an existing Order still repairs to accepted; without one, 409s REQUEST_TOO_OLD_ERROR and stays 'accepting'\n",
  );

  // ── a) repairable: old + accepting + an Order already exists ───────────
  const request26a = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg26a Diner",
    mobile: "9990000032",
  });
  const requestId26a = String(request26a._id);
  const order26a = await Order.create(minimalOrder("ORD-LEG26A-001", { sourceRequestIds: [requestId26a] }));
  const nowR = Date.now();
  await OrderRequest.collection.updateOne(
    { _id: request26a._id },
    { $set: { status: "accepting", createdAt: new Date(pendingCutoff(nowR).getTime() - 1000) } },
  );

  const result26a = await acceptOrderRequest(requestId26a, STAFF_CTX("Staff P"));
  check(
    "a) an old 'accepting' row WITH an existing Order still repairs to accepted — the age gate never applies once the repair lookup wins",
    !("error" in result26a) && result26a.replayed === true && result26a.order._id.equals(order26a._id),
  );

  // ── b) not repairable: old + accepting + NO Order ──────────────────────
  const request26b = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg26b Diner",
    mobile: "9990000033",
  });
  const requestId26b = String(request26b._id);
  await OrderRequest.collection.updateOne(
    { _id: request26b._id },
    { $set: { status: "accepting", createdAt: new Date(pendingCutoff(nowR).getTime() - 1000) } },
  );

  const result26b = await acceptOrderRequest(requestId26b, STAFF_CTX("Staff P"));
  check(
    "b) an old 'accepting' row with NO Order 409s REQUEST_TOO_OLD_ERROR",
    "error" in result26b && result26b.status === 409 && result26b.error === REQUEST_TOO_OLD_ERROR,
  );
  const after26b = await OrderRequest.findById(requestId26b).lean();
  check(
    "b) the row stays 'accepting' — never reverted — so it remains rejectable from the tray",
    after26b?.status === "accepting",
  );
}

// ── CR2.2b §17.C — PATCH edit-request legs (appended, unmodified above) ─────

async function leg27(): Promise<void> {
  console.log(
    "\nLeg 27 — edit-request charge-carrier handoff: the carrier keeps its charge across edits; a non-carrier sibling stays charge-less; cancelling the carrier hands the charge to the next edited sibling\n",
  );

  await Table.create({ tableNo: "T-27", capacity: 4, status: "Available", chargeAmount: 30, chargeLabel: "Cover" });

  // a) A is staged first — no sibling yet, so it becomes the charge carrier.
  const requestA = await stageTableRequestCharge("T-27", [{ productId: teaId, qty: 1 }], "Leg27a Diner", "9990000034");
  check("a) A is staged as the charge carrier (subtotal 100 + charge 30 = 130)", requestA.quotedCharge === 30 && requestA.quotedTotal === 130);

  const editA1 = await applyEdit(requestA.shortCode, [{ productId: teaId, qty: 2 }]);
  check(
    "a) PATCH A (qty 2, no sibling yet) KEEPS the charge — 200 + 30 = 230",
    !("error" in editA1) && editA1.total === 230,
  );

  // b) B is staged AFTER A — the real create-time rule (any sibling
  // suppresses) makes B charge-less at birth.
  const requestB = await stageTableRequestCharge("T-27", [{ productId: teaId, qty: 1 }], "Leg27b Diner", "9990000035");
  check("b) B is staged charge-less (A already pending) — subtotal 100, no charge", requestB.quotedCharge === 0 && requestB.quotedTotal === 100);

  const editA2 = await applyEdit(requestA.shortCode, [{ productId: teaId, qty: 3 }]);
  check(
    "b) PATCH A again (qty 3) STILL keeps the charge — B's own quotedCharge is 0, so B is not a carrier — 300 + 30 = 330",
    !("error" in editA2) && editA2.total === 330,
  );

  const editB1 = await applyEdit(requestB.shortCode, [{ productId: teaId, qty: 2 }]);
  check(
    "b) PATCH B (qty 2) stays charge-less — A is still a real carrier (quotedCharge 30 > 0) — total 200",
    !("error" in editB1) && editB1.total === 200,
  );
  const bAfterEdit1 = await OrderRequest.findOne({ shortCode: requestB.shortCode }).lean();
  check("b) B's stored quotedCharge is 0 after that edit", bAfterEdit1?.quotedCharge === 0);

  // c) Cancel A (mirrors the diner cancel route's own CAS by hand — see the
  // file-level comment on why HTTP routes are never stood up here).
  const cancelledA = await OrderRequest.findOneAndUpdate(
    { shortCode: requestA.shortCode, status: "pending" },
    { $set: { status: "rejected", rejectedReason: DINER_CANCELLED_REASON, actor: DINER_ACTOR } },
    { new: true },
  );
  check("c) A cancels (status now rejected)", cancelledA?.status === "rejected");

  const editB2 = await applyEdit(requestB.shortCode, [{ productId: teaId, qty: 3 }]);
  check(
    "c) PATCH B (qty 3) PICKS UP the charge now that A is rejected — 300 + 30 = 330",
    !("error" in editB2) && editB2.total === 330,
  );
  const bAfterEdit2 = await OrderRequest.findOne({ shortCode: requestB.shortCode }).lean();
  check("c) B's stored quotedCharge is now 30", bAfterEdit2?.quotedCharge === 30);
}

async function leg28(): Promise<void> {
  console.log("\nLeg 28 — edit-request status gate: an 'accepting'/'accepted' request 409s locked; PATCHing a still-pending request then accepting it bills the EDITED quote\n");

  // a) force a fresh request straight to "accepted" — PATCH must refuse it.
  const requestA2 = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg28a Diner",
    mobile: "9990000036",
  });
  await OrderRequest.updateOne({ _id: requestA2._id }, { $set: { status: "accepted" } });
  const lockedEdit = await applyEdit(requestA2.shortCode, [{ productId: teaId, qty: 2 }]);
  check('a) PATCHing an "accepted" request is refused with the locked outcome', "error" in lockedEdit && lockedEdit.error === "locked");
  const afterLockedEdit = await OrderRequest.findOne({ shortCode: requestA2.shortCode }).lean();
  check("a) the row's items/total are untouched by the refused edit", afterLockedEdit?.items.length === 1 && afterLockedEdit.quotedTotal === 100);

  // b) edit-then-accept: the accepted Order must bill the EDITED quote, not
  // the ORIGINAL one — proves createTotalsMatchQuote passes against whatever
  // the request's CURRENT (post-edit) quotedTotal is.
  const requestB2 = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg28b Diner",
    mobile: "9990000037",
  });
  check("b) B2 is staged at the original quote (100)", requestB2.quotedTotal === 100);

  const editedB2 = await applyEdit(requestB2.shortCode, [{ productId: teaId, qty: 3 }]);
  check("b) PATCH B2 to qty 3 recomputes to 300", !("error" in editedB2) && editedB2.total === 300);

  const acceptedB2 = await acceptOrderRequest(String(requestB2._id), STAFF_CTX("Staff Q"));
  check("b) accept succeeds against the EDITED request", !("error" in acceptedB2));
  if (!("error" in acceptedB2)) {
    check("b) the minted order's total equals the EDITED quote (300), not the original (100)", acceptedB2.order.total === 300);
  }
}

async function leg29(): Promise<void> {
  console.log(
    "\nLeg 29 — edit-request note three-way semantics (review HIGH #1 2026-08-20): absent keeps, \"\" clears, text replaces\n",
  );

  const requestC = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg29 Diner",
    mobile: "9990000038",
    note: "Extra spicy — nut allergy",
  });
  check("the request is staged with a kitchen note", requestC.note === "Extra spicy — nut allergy");

  // a) ABSENT note = KEEP — a qty-only edit must never delete a kitchen note.
  const editedNoNote = await applyEdit(requestC.shortCode, [{ productId: teaId, qty: 2 }]); // no `note` argument
  check("a) the qty-only edit itself succeeds", !("error" in editedNoNote));
  const afterKeep = await OrderRequest.findOne({ shortCode: requestC.shortCode }).lean();
  check("a) the note SURVIVES an edit that never mentions it", afterKeep?.note === "Extra spicy — nut allergy");

  // b) text = REPLACE.
  const editedReplace = await applyEdit(requestC.shortCode, [{ productId: teaId, qty: 2 }], "Less sugar");
  check("b) the replace edit succeeds", !("error" in editedReplace));
  const afterReplace = await OrderRequest.findOne({ shortCode: requestC.shortCode }).lean();
  check("b) the note is REPLACED when new text is sent", afterReplace?.note === "Less sugar");

  // c) "" = CLEAR — $unset, never stored as an empty string.
  const editedClear = await applyEdit(requestC.shortCode, [{ productId: teaId, qty: 2 }], "");
  check("c) the clear edit succeeds", !("error" in editedClear));
  const afterClear = await OrderRequest.findOne({ shortCode: requestC.shortCode }).lean();
  check('c) the note field is ABSENT after a "" edit ($unset, not stored as "")', afterClear ? !("note" in afterClear) : false);

  // d) GST-enabled settings flow through the edit re-quote (the mirror used
  // to pass `settings: null` unconditionally — review LOW #10).
  const requestD = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 2 }], // 2 × 100 = 200 subtotal
    name: "Leg29 GST Diner",
    mobile: "9990000039",
  });
  const gstSettings = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" } as unknown as ISettings;
  const editedGst = await applyEdit(requestD.shortCode, [{ productId: teaId, qty: 3 }], undefined, gstSettings);
  check("d) the GST edit succeeds", !("error" in editedGst));
  if (!("error" in editedGst)) {
    // 3 × 100 = 300 subtotal, +5% exclusive GST = 315 — the edit quote must
    // carry the same computeOrderTotals math the create path does.
    check("d) the edited quote carries exclusive GST on top (315, not 300)", editedGst.total === 315);
  }

  // e) a note of only invisible characters clears (sanitize decides $set vs
  // $unset) — pins the mirror to the route's sanitized-value decision.
  const requestE = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg29 Invisible",
    mobile: "9990000040",
    note: "Real note",
  });
  const editedInvisible = await applyEdit(requestE.shortCode, [{ productId: teaId, qty: 1 }], "​​");
  check("e) the invisible-note edit succeeds", !("error" in editedInvisible));
  const afterInvisible = await OrderRequest.findOne({ shortCode: requestE.shortCode }).lean();
  check("e) an invisible-only note CLEARS the stored note rather than storing blanks", afterInvisible ? !("note" in afterInvisible) : false);

  // f) membership — an edit may not introduce a product the request never had.
  const editedNewItem = await applyEdit(requestE.shortCode, [{ productId: coffeeId, qty: 1 }]);
  check("f) an edit naming a product not already on the request is refused", "error" in editedNewItem && editedNewItem.error === "new-item");

  // g) a hidden-from-menu product stays EDITABLE once the request exists —
  // accept's own isActive-only filter, mirrored (review LOW 2026-08-20).
  const requestG = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 2 }],
    name: "Leg29 Hidden",
    mobile: "9990000041",
  });
  await Product.updateOne({ _id: teaId }, { $set: { publicVisible: false } });
  const editedHidden = await applyEdit(requestG.shortCode, [{ productId: teaId, qty: 1 }]);
  check("g) hiding a product from the public menu does NOT block editing a request that already holds it", !("error" in editedHidden));
  await Product.updateOne({ _id: teaId }, { $unset: { publicVisible: "" } });

  // h) table-gone: doomed only with no open tab; with one, accept takes the
  // add-round branch and never reads the Table row, so the edit stands.
  const tableH = await Table.create({ tableNo: "LEG29-H", status: "Available" });
  const requestH = await stageRequest({
    targetKind: "table",
    tableNo: tableH.tableNo,
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg29 TableGone",
    mobile: "9990000042",
  });
  await Table.deleteOne({ _id: tableH._id });
  const editedTableGone = await applyEdit(requestH.shortCode, [{ productId: teaId, qty: 2 }]);
  check("h) a table-kind request whose Table row is gone AND has no open tab is refused", "error" in editedTableGone && editedTableGone.error === "table-gone");

  await Order.create(
    minimalOrder("LEG29H-1", {
      tableNo: tableH.tableNo,
      status: "Pending",
      payment: "Unpaid",
      items: [line(teaId, "Tea", 100, 1, 1)],
      subtotal: 100,
      total: 100,
    }),
  );
  const editedTableGoneOpenTab = await applyEdit(requestH.shortCode, [{ productId: teaId, qty: 2 }]);
  check("h) the SAME request edits fine once an open tab exists on that tableNo", !("error" in editedTableGoneOpenTab));
  if (!("error" in editedTableGoneOpenTab)) {
    check("h) and it re-quotes charge-less (200), never inventing a charge from a missing Table", editedTableGoneOpenTab.total === 200);
  }
}

// ── CR2.2c §17.E — promo-code legs (appended, unmodified above) ────────────

async function leg30(): Promise<void> {
  console.log(
    "\nLeg 30 — CR2.2c promo codes: create quotes+stores a resolved discount, accept carries it onto Order.discount + a note line, deactivation between quote and accept 409s PROMO_DRIFT_ERROR with no Order minted, add-round SUMS the tab's own discount with the request's, edit applies/removes a code, and a flat code larger than the subtotal clamps rather than going negative\n",
  );

  // ── a) create with a percent code ⇒ stored quotedDiscount, total reduced ──
  await Table.create({ tableNo: "T-30A", capacity: 4, status: "Available" });
  const requestA = await stageRequest({
    targetKind: "table",
    tableNo: "T-30A",
    items: [{ productId: teaId, qty: 3 }], // subtotal 300
    name: "Leg30a Diner",
    mobile: "9990000043",
    promoCode: "SAVE10",
    promoCodes: PROMO_CODES,
  });
  check(
    "a) SAVE10 (10% of 300 = 30) is stored as quotedDiscount, and the total reflects it (300 - 30 = 270)",
    requestA.quotedDiscount === 30 && requestA.promoCode === "SAVE10" && requestA.quotedTotal === 270,
  );

  // ── b) accept it ⇒ Order.discount equals it and the order total matches ──
  const acceptedA = await acceptOrderRequest(String(requestA._id), promoSettingsCtx("Staff Promo", PROMO_CODES));
  check("b) accept succeeds", !("error" in acceptedA));
  if ("error" in acceptedA) throw new Error(`leg30: b) accept unexpectedly failed — ${acceptedA.error}`);
  check("b) Order.discount equals the resolved promo discount (30)", acceptedA.order.discount === 30);
  check("b) Order.total matches the quote (270)", acceptedA.order.total === 270);
  check(
    "b) a staff-actionable promo note line was appended through mergedNote",
    acceptedA.order.notes === "PROMO SAVE10 -₹30",
  );

  // ── c) deactivate the code, then accept a second request quoted with it ──
  //      ⇒ rejected with PROMO_DRIFT_ERROR, no Order minted ────────────────
  await Table.create({ tableNo: "T-30C", capacity: 4, status: "Available" });
  const requestC = await stageRequest({
    targetKind: "table",
    tableNo: "T-30C",
    items: [{ productId: teaId, qty: 1 }], // subtotal 100
    name: "Leg30c Diner",
    mobile: "9990000044",
    promoCode: "SAVE10",
    promoCodes: PROMO_CODES,
  });
  check("c) the request is staged with SAVE10 applied (discount 10)", requestC.quotedDiscount === 10);
  const requestIdC = String(requestC._id);
  const acceptedC = await acceptOrderRequest(
    requestIdC,
    promoSettingsCtx("Staff Promo", PROMO_CODES_SAVE10_INACTIVE),
  );
  check(
    "c) accepting against a NOW-INACTIVE code 409s with PROMO_DRIFT_ERROR",
    "error" in acceptedC && acceptedC.status === 409 && acceptedC.error === PROMO_DRIFT_ERROR,
  );
  const afterC = await OrderRequest.findById(requestIdC).lean();
  check("c) the request is back to pending — never left stuck at 'accepting'", afterC?.status === "pending");
  check("c) no Order was minted for this request", (await Order.countDocuments({ sourceRequestIds: requestIdC })) === 0);

  // ── d) add-round: a tab with its OWN staff discount + a promo'd request ──
  //      ⇒ the order's discount is the SUM and the total is right ─────────
  await Table.create({ tableNo: "T-30D", capacity: 4, status: "Available" });
  const openTabD = await Order.create(
    minimalOrder("ORD-LEG30D-OPEN", {
      tableNo: "T-30D",
      items: [line(teaId, "Tea", 100, 2, 1)],
      subtotal: 200,
      discount: 20, // the tab's own staff-applied discount, from BEFORE this round
      total: 180,
      // Matches promoSettingsCtx's live-settings default (gstConfigOfSettings
      // falls back to "inclusive") — a real cafe's tab would carry whatever
      // was live when it opened; the point under test is the SUM, not GST.
      gstMode: "inclusive" as GstMode,
    }),
  );
  const requestD = await stageRequest({
    targetKind: "table",
    tableNo: "T-30D",
    items: [{ productId: teaId, qty: 1 }], // THIS round's own subtotal: 100
    name: "Leg30d Diner",
    mobile: "9990000045",
    promoCode: "SAVE10",
    promoCodes: PROMO_CODES,
  });
  check(
    "d) the add-round request is staged against its OWN subtotal (SAVE10: 10% of 100 = 10), not the tab's",
    requestD.quotedDiscount === 10,
  );
  const acceptedD = await acceptOrderRequest(String(requestD._id), promoSettingsCtx("Staff Promo", PROMO_CODES));
  check("d) the add-round accept succeeds", !("error" in acceptedD));
  if (!("error" in acceptedD)) {
    check("d) round 2 landed on the SAME order", acceptedD.order._id.equals(openTabD._id));
    check(
      "d) the order's discount is the SUM of the tab's own (20) and the resolved promo (10) = 30",
      acceptedD.order.discount === 30,
    );
    check("d) the total reflects the summed discount (200 + 100 - 30 = 270)", acceptedD.order.total === 270);
    check("d) the promo note line landed on the tab", acceptedD.order.notes === "PROMO SAVE10 -₹10");
  }

  // ── e) edit: apply a code to a pending request (total drops), then ""
  //      removes it (fields $unset, total back up) ─────────────────────────
  const requestE = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 2 }], // subtotal 200
    name: "Leg30e Diner",
    mobile: "9990000046",
  });
  check(
    "e) the request starts with no promo applied (total 200)",
    requestE.quotedTotal === 200 && requestE.promoCode === undefined,
  );

  const settingsE = { promoCodes: PROMO_CODES } as unknown as ISettings;
  const editApplied = await applyEdit(requestE.shortCode, [{ productId: teaId, qty: 2 }], undefined, settingsE, "SAVE10");
  check(
    "e) applying SAVE10 via PATCH drops the total (10% of 200 = 20 off -> 180)",
    !("error" in editApplied) && editApplied.total === 180,
  );
  const afterApplied = await OrderRequest.findOne({ shortCode: requestE.shortCode }).lean();
  check(
    "e) the stored promoCode/quotedDiscount reflect the applied code",
    afterApplied?.promoCode === "SAVE10" && afterApplied?.quotedDiscount === 20,
  );

  const editRemoved = await applyEdit(requestE.shortCode, [{ productId: teaId, qty: 2 }], undefined, settingsE, "");
  check(
    'e) removing the code ("") via PATCH restores the total (200)',
    !("error" in editRemoved) && editRemoved.total === 200,
  );
  const afterRemoved = await OrderRequest.findOne({ shortCode: requestE.shortCode }).lean();
  check(
    "e) promoCode/quotedDiscount are ABSENT after removal ($unset, never stored as falsy)",
    afterRemoved ? !("promoCode" in afterRemoved) && !("quotedDiscount" in afterRemoved) : false,
  );

  // ── f) a flat code larger than the subtotal ⇒ discount clamped, total
  //      never < 0 ──────────────────────────────────────────────────────────
  const requestF = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 2 }], // subtotal 200
    name: "Leg30f Diner",
    mobile: "9990000047",
    promoCode: "FLAT500", // flat 500 on a 200 subtotal
    promoCodes: PROMO_CODES,
  });
  check(
    "f) FLAT500 on a 200 subtotal clamps the discount to 200, total is 0 (never negative)",
    requestF.quotedDiscount === 200 && requestF.quotedTotal === 0,
  );
  const acceptedF = await acceptOrderRequest(String(requestF._id), promoSettingsCtx("Staff Promo", PROMO_CODES));
  check("f) accept still succeeds against the clamped quote", !("error" in acceptedF));
  if (!("error" in acceptedF)) {
    check("f) Order.discount is clamped to the subtotal (200), never the raw 500", acceptedF.order.discount === 200);
    check("f) Order.total is 0, never negative", acceptedF.order.total === 0);
  }
}


async function leg31(): Promise<void> {
  console.log(
    "\nLeg 31 — CR2.2c promo session gate (review 2026-08-20): one flat code must not re-apply to every round of a tab; an ALREADY-stored code survives an edit that never touches it\n",
  );

  const table = await Table.create({ tableNo: "T-31A", capacity: 4, status: "Available" });
  const settings = { promoCodes: PROMO_CODES } as unknown as ISettings;

  // The exploit, replayed: round 1 carries the promo and is accepted, opening
  // a tab; round 2 then tries to apply the SAME code from the edit screen.
  const round1 = await stageRequest({
    targetKind: "table",
    tableNo: table.tableNo,
    items: [{ productId: teaId, qty: 2 }],
    name: "Leg31 Diner",
    mobile: "9990000051",
    promoCode: "SAVE10",
    promoCodes: PROMO_CODES,
  });
  const accepted1 = await acceptOrderRequest(String(round1._id), promoSettingsCtx("Staff 31", PROMO_CODES));
  check("a) round 1 with the promo accepts and opens the tab", !("error" in accepted1));

  const round2 = await stageRequest({
    targetKind: "table",
    tableNo: table.tableNo,
    items: [{ productId: teaId, qty: 2 }],
    name: "Leg31 Diner",
    mobile: "9990000051",
  });
  check("b) round 2 is quoted with NO promo", round2.promoCode === undefined);

  const reapplied = await applyEdit(round2.shortCode, [{ productId: teaId, qty: 2 }], undefined, settings, "SAVE10");
  check(
    "b) applying the same code from the edit screen is REFUSED once the tab is open",
    "error" in reapplied && reapplied.error === PROMO_SESSION_OPEN,
  );
  const afterReapply = await OrderRequest.findOne({ shortCode: round2.shortCode }).lean();
  check("b) and nothing was written to the request", afterReapply ? !("promoCode" in afterReapply) : false);

  // An already-stored code is exempt: a qty-only edit re-resolves and KEEPS it.
  const table2 = await Table.create({ tableNo: "T-31B", capacity: 4, status: "Available" });
  const promoed = await stageRequest({
    targetKind: "table",
    tableNo: table2.tableNo,
    items: [{ productId: teaId, qty: 3 }],
    name: "Leg31 Keeper",
    mobile: "9990000052",
    promoCode: "SAVE10",
    promoCodes: PROMO_CODES,
  });
  check("c) the request is staged carrying the promo", promoed.promoCode === "SAVE10");
  const qtyOnly = await applyEdit(promoed.shortCode, [{ productId: teaId, qty: 2 }], undefined, settings);
  check("c) a qty-only edit of the CARRIER succeeds (a stored code is exempt from the gate)", !("error" in qtyOnly));
  const afterQtyOnly = await OrderRequest.findOne({ shortCode: promoed.shortCode }).lean();
  check(
    "c) and the stored promo survives, re-resolved against the NEW subtotal (2x100 = 200 -> 10% = 20)",
    afterQtyOnly?.promoCode === "SAVE10" && afterQtyOnly?.quotedDiscount === 20,
  );
}

async function leg32(): Promise<void> {
  console.log(
    "\nLeg 32 — SPEC P4 per-customer usage cap: a oncePerCustomer code claims a durable redemption at accept (orderId backfilled), the SAME mobile is refused at CREATE, two requests staged before any accept resolve first-wins/second-rejects with no order minted for the loser, a repair replay of the winner never self-blocks, a different mobile still works, and an un-flagged code is completely unaffected\n",
  );

  // ── a) accept ⇒ a redemption row exists, backfilled with the order's id ──
  await Table.create({ tableNo: "T-32A", capacity: 4, status: "Available" });
  const requestA = await stageRequest({
    targetKind: "table",
    tableNo: "T-32A",
    items: [{ productId: teaId, qty: 1 }], // subtotal 100
    name: "Leg32a Diner",
    mobile: "9990000061",
    promoCode: "ONCE10",
    promoCodes: PROMO_CODES_ONCE,
  });
  check("a) the request quotes fine with ONCE10 applied (10% of 100 = 10)", requestA.quotedDiscount === 10 && requestA.promoCode === "ONCE10");
  const acceptedA = await acceptOrderRequest(String(requestA._id), promoSettingsCtx("Staff 32a", PROMO_CODES_ONCE));
  check("a) accept succeeds", !("error" in acceptedA));
  if ("error" in acceptedA) throw new Error(`leg32: a) accept unexpectedly failed — ${acceptedA.error}`);
  const redemptionA = await PromoRedemption.findOne({ code: "ONCE10", mobile: "9990000061" }).lean();
  check("a) a redemption row exists for (ONCE10, this mobile)", redemptionA !== null);
  check("a) the redemption's requestId is this request's own id", redemptionA?.requestId === String(requestA._id));
  check("a) the redemption's orderId was best-effort backfilled to the winning order", redemptionA?.orderId === acceptedA.order.orderId);

  // ── b) the SAME mobile trying the SAME code again at CREATE is refused ──
  //      (the quote-time courtesy check, via the real resolveRequestPromo) ──
  await Table.create({ tableNo: "T-32B", capacity: 4, status: "Available" });
  const tableB = await Table.findOne({ tableNo: "T-32B" }).select("tableNo chargeAmount chargeLabel").lean();
  const productsB = (await Product.find({ _id: { $in: [teaId] } })
    .select("name price discount available modifiers variations")
    .lean()) as unknown as PricedProductSource[];
  const pricedB = priceRequestItems(productsB, [{ productId: teaId, modifiers: [], qty: 1 }]);
  if ("error" in pricedB) throw new Error("leg32: b) pricing failed unexpectedly");
  const dataB: CreatePublicOrderRequestInput = {
    target: { kind: "table", token: "STAGE-TOKEN-UNUSED" },
    items: [{ productId: teaId, modifiers: [], qty: 1 }],
    name: "Leg32b Diner",
    mobile: "9990000061", // SAME mobile as (a)
    promoCode: "ONCE10",
  };
  const settingsB = { promoCodes: PROMO_CODES_ONCE } as unknown as ISettings;
  const promoB = await resolveRequestPromo(dataB, pricedB.lines, tableB, settingsB, true);
  check(
    "b) the SAME mobile re-trying ONCE10 at CREATE is refused with PROMO_ALREADY_USED",
    "error" in promoB && promoB.error === PROMO_ALREADY_USED,
  );

  // ── c) two requests staged BEFORE any accept (both quote fine) — first
  //      accept lands, second rejects PROMO_USED_ERROR, no order minted ──────
  await Table.create({ tableNo: "T-32C1", capacity: 4, status: "Available" });
  await Table.create({ tableNo: "T-32C2", capacity: 4, status: "Available" });
  const requestC1 = await stageRequest({
    targetKind: "table",
    tableNo: "T-32C1",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg32c Diner",
    mobile: "9990000062",
    promoCode: "ONCE10",
    promoCodes: PROMO_CODES_ONCE,
  });
  const requestC2 = await stageRequest({
    targetKind: "table",
    tableNo: "T-32C2",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg32c Diner",
    mobile: "9990000062", // SAME mobile as requestC1
    promoCode: "ONCE10",
    promoCodes: PROMO_CODES_ONCE,
  });
  check(
    "c) both requests staged fine BEFORE either was accepted (the courtesy check only runs at CREATE, not staging)",
    requestC1.promoCode === "ONCE10" && requestC2.promoCode === "ONCE10",
  );

  const acceptedC1 = await acceptOrderRequest(String(requestC1._id), promoSettingsCtx("Staff 32c", PROMO_CODES_ONCE));
  check("c) the FIRST request accepts fine and claims the fence", !("error" in acceptedC1));
  if ("error" in acceptedC1) throw new Error(`leg32: c) first accept unexpectedly failed — ${acceptedC1.error}`);

  const requestIdC2 = String(requestC2._id);
  const acceptedC2 = await acceptOrderRequest(requestIdC2, promoSettingsCtx("Staff 32c", PROMO_CODES_ONCE));
  check(
    "c) the SECOND request rejects with PROMO_USED_ERROR — a genuinely different request already holds the fence",
    "error" in acceptedC2 && acceptedC2.status === 409 && acceptedC2.error === PROMO_USED_ERROR,
  );
  check("c) no Order was minted for the second (losing) request", (await Order.countDocuments({ sourceRequestIds: requestIdC2 })) === 0);
  const afterC2 = await OrderRequest.findById(requestIdC2).lean();
  check("c) the second request's status reverted to pending, never left stuck at accepting", afterC2?.status === "pending");

  // ── d) replaying accept for the FIRST (winning) request never self-blocks ─
  const repliedC1 = await acceptOrderRequest(String(requestC1._id), promoSettingsCtx("Staff 32c", PROMO_CODES_ONCE));
  check("d) replaying accept for the winning request repairs/replays, never self-blocking on its own redemption", !("error" in repliedC1));
  if (!("error" in repliedC1)) {
    check("d) the replay reports replayed:true", repliedC1.replayed === true);
    check("d) the replay returns the SAME order as the first accept", repliedC1.order._id.equals(acceptedC1.order._id));
  }
  check(
    "d) exactly one redemption row exists for (ONCE10, this mobile) — the replay minted no duplicate",
    (await PromoRedemption.countDocuments({ code: "ONCE10", mobile: "9990000062" })) === 1,
  );

  // ── e) a DIFFERENT mobile using the same code still works fine ────────────
  await Table.create({ tableNo: "T-32E", capacity: 4, status: "Available" });
  const requestE = await stageRequest({
    targetKind: "table",
    tableNo: "T-32E",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg32e Diner",
    mobile: "9990000063", // a DIFFERENT mobile from (c)/(d)
    promoCode: "ONCE10",
    promoCodes: PROMO_CODES_ONCE,
  });
  const acceptedE = await acceptOrderRequest(String(requestE._id), promoSettingsCtx("Staff 32e", PROMO_CODES_ONCE));
  check("e) a different mobile claims the SAME code fine — the fence is per (code,mobile), never per code alone", !("error" in acceptedE));

  // ── f) an UN-FLAGGED code is completely unaffected — two accepts, two
  //      orders, no PromoRedemption rows written at all ────────────────────
  await Table.create({ tableNo: "T-32F1", capacity: 4, status: "Available" });
  await Table.create({ tableNo: "T-32F2", capacity: 4, status: "Available" });
  const requestF1 = await stageRequest({
    targetKind: "table",
    tableNo: "T-32F1",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg32f Diner",
    mobile: "9990000064",
    promoCode: "SAVE10", // NOT oncePerCustomer
    promoCodes: PROMO_CODES,
  });
  const requestF2 = await stageRequest({
    targetKind: "table",
    tableNo: "T-32F2",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg32f Diner",
    mobile: "9990000064", // SAME mobile as requestF1, still unaffected
    promoCode: "SAVE10",
    promoCodes: PROMO_CODES,
  });
  const acceptedF1 = await acceptOrderRequest(String(requestF1._id), promoSettingsCtx("Staff 32f", PROMO_CODES));
  const acceptedF2 = await acceptOrderRequest(String(requestF2._id), promoSettingsCtx("Staff 32f", PROMO_CODES));
  check("f) an un-flagged code lets the SAME mobile accept it twice — both succeed", !("error" in acceptedF1) && !("error" in acceptedF2));
  if (!("error" in acceptedF1) && !("error" in acceptedF2)) {
    check("f) the two accepts minted two DIFFERENT orders", !acceptedF1.order._id.equals(acceptedF2.order._id));
  }
  check(
    "f) no PromoRedemption rows were written for this un-flagged code",
    (await PromoRedemption.countDocuments({ code: "SAVE10", mobile: "9990000064" })) === 0,
  );
}


async function leg33(): Promise<void> {
  console.log(
    "\nLeg 33 — review fixes 2026-08-20: canonical-mobile fence (+91/0 variants collapse), add-round fence rejects a second same-mobile use ON THE SAME TABLE, a reject RELEASES a claimed-but-orderless fence, the request holding its OWN claim stays editable, and a zero-resolving flagged code burns nothing\n",
  );
  const onceSettings = { promoCodes: PROMO_CODES_ONCE } as unknown as ISettings;

  // ── a) canonical mobile: "+91" re-typing of a used number is refused ──
  const reqA = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 2 }],
    name: "Leg33 Canon",
    mobile: "9990000071",
    promoCode: "ONCE10",
    promoCodes: PROMO_CODES_ONCE,
  });
  const accA = await acceptOrderRequest(String(reqA._id), promoSettingsCtx("Staff 33", PROMO_CODES_ONCE));
  check("a) first use accepts", !("error" in accA));
  const productsA = (await Product.find({ _id: teaId })
    .select("name price discount available modifiers variations")
    .lean()) as unknown as PricedProductSource[];
  const pricedA = priceRequestItems(productsA, [
    { productId: teaId, qty: 2, modifiers: [] },
  ]);
  if ("error" in pricedA) throw new Error("leg33: a) pricing failed unexpectedly");
  const usedPlus91 = await resolveRequestPromo(
    {
      target: { kind: "parcel" },
      items: [{ productId: teaId, qty: 2 }],
      mobile: "+919990000071",
      name: "x",
      promoCode: "ONCE10",
    } as CreatePublicOrderRequestInput,
    pricedA.lines,
    null,
    onceSettings,
    true,
  );
  check(
    'a) the SAME number typed as "+91…" is refused at create (canonical fence key)',
    "error" in usedPlus91 && usedPlus91.error === PROMO_ALREADY_USED,
  );

  // ── b) add-round fence: same TABLE, second request with the code ──
  const tableB = await Table.create({ tableNo: "T-33B", capacity: 4, status: "Available" });
  const reqB1 = await stageRequest({
    targetKind: "table",
    tableNo: tableB.tableNo,
    items: [{ productId: teaId, qty: 2 }],
    name: "Leg33 Round",
    mobile: "9990000072",
    promoCode: "ONCE10",
    promoCodes: PROMO_CODES_ONCE,
  });
  const reqB2 = await stageRequest({
    targetKind: "table",
    tableNo: tableB.tableNo,
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg33 Round",
    mobile: "9990000072",
    promoCode: "ONCE10",
    promoCodes: PROMO_CODES_ONCE,
  });
  const accB1 = await acceptOrderRequest(String(reqB1._id), promoSettingsCtx("Staff 33", PROMO_CODES_ONCE));
  check("b) round 1 accepts and opens the tab", !("error" in accB1));
  const accB2 = await acceptOrderRequest(String(reqB2._id), promoSettingsCtx("Staff 33", PROMO_CODES_ONCE));
  check(
    "b) round 2 (ADD-ROUND branch, same mobile) rejects with PROMO_USED_ERROR",
    "error" in accB2 && accB2.error === PROMO_USED_ERROR,
  );
  const b2After = await OrderRequest.findById(reqB2._id).lean();
  check("b) the loser reverted to pending (guardedReject), no order minted for it", b2After?.status === "pending");

  // ── c) …and that guardedReject RELEASED nothing of the winner's claim,
  //       while the loser (who never claimed) left no row behind ──
  const rowsB = await PromoRedemption.find({ code: "ONCE10", mobile: "9990000072" }).lean();
  check("c) exactly ONE redemption row stands after the race (the winner's)", rowsB.length === 1 && rowsB[0].requestId === String(reqB1._id));

  // ── d) reject releases a claimed-but-orderless fence: simulate a crashed
  //       accept that claimed then died before its order write ──
  const reqD = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 2 }],
    name: "Leg33 Release",
    mobile: "9990000073",
    promoCode: "ONCE10",
    promoCodes: PROMO_CODES_ONCE,
  });
  await OrderRequest.updateOne({ _id: reqD._id }, { $set: { status: "accepting" } });
  const claimD = await claimPromoRedemption("ONCE10", "9990000073", String(reqD._id));
  check("d) the simulated crashed accept claimed the fence", claimD === "claimed");
  await reject(String(reqD._id), "simulated failure");
  const rowD = await PromoRedemption.findOne({ code: "ONCE10", mobile: "9990000073" }).lean();
  check("d) reject() RELEASED the orderless claim — the code is usable again", rowD === null);

  // ── e) the request holding its OWN claim stays editable ──
  const reqE = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 3 }],
    name: "Leg33 OwnClaim",
    mobile: "9990000074",
    promoCode: "ONCE10",
    promoCodes: PROMO_CODES_ONCE,
  });
  const claimE = await claimPromoRedemption("ONCE10", "9990000074", String(reqE._id));
  check("e) the request's own claim stands", claimE === "claimed");
  const editE = await applyEdit(reqE.shortCode, [{ productId: teaId, qty: 2 }], undefined, onceSettings);
  check("e) a qty-only edit of the claim-holder succeeds (own claim excluded from the courtesy check)", !("error" in editE));

  // ── f) a zero-resolving flagged code burns nothing at accept ──
  // ONCE10 is 10% — on a subtotal small enough to floor to 0 there is no
  // discount, so the claim must not run. Cheapest item is 100 ⇒ 10% = 10, so
  // stage with a 1-rupee product instead.
  const tiny = await Product.create({
    name: "Leg33 Candy", category: "Mains", price: 5, discount: 0, available: true, modifiers: [], isActive: true,
  });
  const reqF = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: String(tiny._id), qty: 1 }],
    name: "Leg33 Zero",
    mobile: "9990000075",
    promoCode: "ONCE10",
    promoCodes: PROMO_CODES_ONCE,
  });
  check("f) the tiny order quotes a ZERO discount (10% of 5 floors to 0)", (reqF.quotedDiscount ?? 0) === 0);
  const accF = await acceptOrderRequest(String(reqF._id), promoSettingsCtx("Staff 33", PROMO_CODES_ONCE));
  check("f) it still accepts fine", !("error" in accF));
  const rowF = await PromoRedemption.findOne({ code: "ONCE10", mobile: "9990000075" }).lean();
  check("f) and NO redemption was burned for a zero-value use", rowF === null);
}

// ── CR2.5 S4 — L34 sold-out edit (§23.2 S4, §23.6 risk 2) ───────────────────
// The applyEdit mirror above already routes through the REAL priceRequestItems
// (lib/public-pricing.ts:83, `if (product.available === false) return { error:
// SOLD_OUT_ERROR(product.name) }`) against a `Product.find({..., isActive:
// true}).select("name price discount available modifiers variations")` query
// — byte-identical to the route's own step 10 (route.ts:187-192) and to the
// accept bridge's own re-validation (order-request-accept.ts:130-145). No
// mirror extension was needed: the availability path was already there,
// inherited for free from priceRequestItems, never hand-rolled separately.
async function leg34(): Promise<void> {
  console.log(
    "\nLeg 34 — sold-out edit: a PATCH that keeps a now-unavailable item is refused with SOLD_OUT_ERROR and the stored row is byte-unchanged; dropping the sold-out item re-quotes; accepting a SEPARATE pending request that still holds it 409s with the SAME message — proving PATCH/accept parity (D-4)\n",
  );

  const requestA = await stageRequest({
    targetKind: "parcel",
    items: [
      { productId: teaId, qty: 1 },
      { productId: coffeeId, qty: 1 },
    ],
    name: "Leg34 Diner",
    mobile: "9990000076",
  });
  const shortCodeA = requestA.shortCode;

  // Stage the SEPARATE request used by check c) BEFORE Tea sells out — like a
  // real diner, it can only ever be staged while the item was still
  // available; the drift happens to it afterward, same as every other
  // accept-time drift leg in this file (11/20). Staging it AFTER the sell-out
  // would 500 here (stageRequest's own priceRequestItems call would throw),
  // which would prove nothing about the PATCH/accept parity this leg exists
  // to pin.
  const requestC = await stageRequest({
    targetKind: "parcel",
    items: [{ productId: teaId, qty: 1 }],
    name: "Leg34 Accept Diner",
    mobile: "9990000077",
  });
  const requestIdC = String(requestC._id);

  // Sell out Tea (A) — B (Coffee) stays available.
  await Product.updateOne({ _id: teaId }, { $set: { available: false } });

  const before = await OrderRequest.findOne({ shortCode: shortCodeA }).lean();

  // a) PATCH keeping the sold-out item ⇒ refused with SOLD_OUT_ERROR(A.name),
  // and the stored row is byte-unchanged (the mirror returns before ever
  // reaching the update — same as the route's 422 short-circuit).
  const editKeepingSoldOut = await applyEdit(shortCodeA, [
    { productId: teaId, qty: 1 },
    { productId: coffeeId, qty: 1 },
  ]);
  check(
    "a) PATCH keeping the sold-out item is refused with SOLD_OUT_ERROR(Tea)",
    "error" in editKeepingSoldOut && editKeepingSoldOut.error === SOLD_OUT_ERROR("Tea"),
  );
  const after = await OrderRequest.findOne({ shortCode: shortCodeA }).lean();
  check(
    "a) the stored row is BYTE-UNCHANGED by the refused edit (full-doc compare)",
    JSON.stringify(before) === JSON.stringify(after),
  );

  // b) PATCH dropping the sold-out item (keeping only Coffee) ⇒ succeeds and
  // re-quotes to Coffee-only (150 - 10% discount, rounded = 135).
  const editDropSoldOut = await applyEdit(shortCodeA, [{ productId: coffeeId, qty: 1 }]);
  check(
    "b) PATCH dropping the sold-out item succeeds and re-quotes to Coffee-only (135)",
    !("error" in editDropSoldOut) && editDropSoldOut.total === 135,
  );
  const afterDrop = await OrderRequest.findOne({ shortCode: shortCodeA }).lean();
  check(
    "b) the stored row now holds only the Coffee line",
    afterDrop?.items.length === 1 && afterDrop.items[0]?.productId === coffeeId,
  );

  // c) accept a SEPARATE pending request that still holds the sold-out item
  // (Tea) ⇒ 409 with the SAME SOLD_OUT_ERROR message, and the request lands
  // back pending (the same "attempt refused, row untouched-in-status" shape
  // every other accept-time rejection in this file uses — legs 10/11/19/20) —
  // this is the PATCH/accept parity that justifies D-4 (fail-fast kept, not
  // loosened to a partial-accept). requestC was staged above, before Tea sold
  // out.
  const acceptResult = await acceptOrderRequest(requestIdC, STAFF_CTX("Staff R"));
  check(
    "c) accepting a request still holding the sold-out item 409s with the SAME SOLD_OUT_ERROR message",
    "error" in acceptResult && acceptResult.status === 409 && acceptResult.error === SOLD_OUT_ERROR("Tea"),
  );
  const afterAccept = await OrderRequest.findById(requestIdC).lean();
  check(
    "c) the request is back to pending after the sold-out accept rejection (same shape as the PATCH refusal)",
    afterAccept?.status === "pending",
  );

  // Restore Tea's availability — teaId is a SHARED fixture read by every leg
  // in this file; leave it exactly as seedProducts() created it.
  await Product.updateOne({ _id: teaId }, { $set: { available: true } });
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`,
    );
  }

  process.env.MONGODB_URI = uri;
  await connectDB();
  await mongoose.connection.dropDatabase(); // clean slate even after a crashed prior run
  await Promise.all([
    Order.createIndexes(),
    OrderRequest.createIndexes(),
    PublicRateLimit.createIndexes(),
    PromoRedemption.createIndexes(),
    Table.createIndexes(),
    Product.createIndexes(),
    Customer.createIndexes(),
    Counter.createIndexes(),
  ]);

  console.log(`\nCR2.2 order-request accept bridge — live against ${dbName}\n`);

  try {
    await seedProducts();
    const { order: order1, requestId: requestId1 } = await leg1();
    await leg2();
    await leg3(order1, requestId1);
    await leg4();
    await leg5(order1);
    await leg6(requestId1);
    await leg7();
    await leg8();
    await leg9();
    await leg10();
    await leg11();
    await leg12();
    await leg13();
    await leg14();
    await leg15();
    await leg16();
    await leg17();
    await leg18();
    await leg19();
    await leg20();
    await leg21();
    await leg22();
    await leg23();
    await leg24();
    await leg25();
    await leg26();
    await leg27();
    await leg28();
    await leg29();
    await leg30();
    await leg31();
    await leg32();
    await leg33();
    await leg34();
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
