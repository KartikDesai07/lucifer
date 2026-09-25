import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { addItemsSchema, moveOrderTableSchema, createOrderSchema, settleOrderSchema } from "./order.schema";

// ── Defect 2 regression (owner decision 2026-08-16) ──────────────────────────
// "A charge waived on a resumed tab was silently discarded when the next KOT
// round was fired." Before the fix, addItemsSchema was `.strict()` with only
// `items` + `discount` — there was no field on this payload that could carry a
// waived charge at all, so POST /api/orders/[id]/items always fell back to the
// tab's ORIGINAL stored chargeAmount no matter what the operator had just done
// at the counter. These pins are on the SCHEMA seam only: chargeAmount must be
// accepted, must stay genuinely optional (omit = unchanged, exactly like
// discount), must still reject a negative value, and — just as important — the
// `.strict()` guard that used to make this payload uncarryable must keep
// rejecting an unknown/misspelled key.

const SAMPLE_PRODUCT_ID = "64b7f0c2a1d2e3f4a5b6c7d8"; // 24 lower-case hex
const SAMPLE_CUSTOMER_ID = "64b7f0c2a1d2e3f4a5b6c7d9"; // 24 lower-case hex
const sampleItems = [{ productId: SAMPLE_PRODUCT_ID, name: "Chai", price: 20, qty: 1 }];

test("addItemsSchema accepts chargeAmount: 0 — this is the waiver the reported bug could not send", () => {
  const r = addItemsSchema.safeParse({ items: sampleItems, chargeAmount: 0 });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.chargeAmount, 0);
});

test("addItemsSchema accepts a positive chargeAmount", () => {
  const r = addItemsSchema.safeParse({ items: sampleItems, chargeAmount: 50 });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.chargeAmount, 50);
});

test("addItemsSchema rejects a negative chargeAmount", () => {
  assert.equal(addItemsSchema.safeParse({ items: sampleItems, chargeAmount: -1 }).success, false);
});

// The guard that made the original payload unable to carry a waiver at all —
// it must keep rejecting an unknown key, including a typo of the new field
// itself, or a client could smuggle arbitrary data through /items unnoticed.
test("addItemsSchema still rejects an unknown key — .strict() is intact", () => {
  assert.equal(
    addItemsSchema.safeParse({ items: sampleItems, chargeamount: 50 }).success,
    false,
    "a misspelled 'chargeamount' must not silently pass through as an unknown key",
  );
  assert.equal(
    addItemsSchema.safeParse({ items: sampleItems, extra: "nope" }).success,
    false,
  );
});

// The whole omit-means-unchanged contract (same rule as `discount`) rests on
// undefined and 0 being genuinely different values — a payload that never
// mentions chargeAmount must parse to undefined, NOT silently coerce to 0,
// or the route could not tell "leave it alone" apart from "waive it".
test("addItemsSchema: chargeAmount is genuinely optional — omitting it parses to undefined, not 0", () => {
  const r = addItemsSchema.safeParse({ items: sampleItems });
  assert.equal(r.success, true);
  if (!r.success) return;
  assert.equal(r.data.chargeAmount, undefined);
  assert.notEqual(r.data.chargeAmount, 0);
});

test("addItemsSchema still requires at least one item and rejects an empty cart", () => {
  assert.equal(addItemsSchema.safeParse({ items: [] }).success, false);
});

// ── moveOrderTableSchema (POST /api/orders/[id]/table) ───────────────────────
// Moving a tab to another table is SEATING, not billing. The payload carries the
// destination name and nothing else: the order's table-charge snapshot is frozen
// at sale time, so if any money field were accepted here a move could re-price a
// bill the kitchen already served. `.strict()` is the whole guarantee — these
// pins fail the moment someone widens this payload.

test("moveOrderTableSchema accepts a destination table name and trims it", () => {
  const r = moveOrderTableSchema.safeParse({ tableNo: "  Rooftop 2  " });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.tableNo, "Rooftop 2");
});

test("moveOrderTableSchema requires a destination — a move to nowhere is not a move", () => {
  assert.equal(moveOrderTableSchema.safeParse({}).success, false);
  assert.equal(moveOrderTableSchema.safeParse({ tableNo: "" }).success, false);
  assert.equal(moveOrderTableSchema.safeParse({ tableNo: "   " }).success, false);
});

// ── CB-CHG — the UNSEAT verb: tableNo:null must be a DISTINCT, ACCEPTED value,
// never conflated with an omitted key. JSON drops `undefined`, so an omitted
// key is the client saying nothing at all — it must keep failing (pinned
// above) precisely so it can never be misread as "remove the table". Only an
// EXPLICIT null may express that intent (auto-memory: undefined cannot CLEAR
// a field over JSON).

test("moveOrderTableSchema accepts an explicit tableNo:null — the UNSEAT verb (frees the table)", () => {
  const r = moveOrderTableSchema.safeParse({ tableNo: null });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.tableNo, null);
});

test("moveOrderTableSchema still accepts a valid destination string — ASSIGN/MOVE unaffected by adding .nullable()", () => {
  const r = moveOrderTableSchema.safeParse({ tableNo: "T-3" });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.tableNo, "T-3");
});

test("moveOrderTableSchema: an OMITTED key is still rejected even now that null is valid — omitted must never be readable as unseat", () => {
  const omitted = moveOrderTableSchema.safeParse({});
  const explicitNull = moveOrderTableSchema.safeParse({ tableNo: null });
  assert.equal(omitted.success, false, "an omitted tableNo key must be rejected");
  assert.equal(explicitNull.success, true, "an explicit null must be accepted");
});

test("moveOrderTableSchema refuses to carry money — no charge/discount/total can ride along with a seating change", () => {
  for (const extra of [
    { chargeAmount: 0 },
    { chargeAmount: 100 },
    { chargeLabel: "Garden" },
    { discount: 50 },
    { total: 999 },
    { paidAmount: 999 },
  ]) {
    assert.equal(
      moveOrderTableSchema.safeParse({ tableNo: "T-1", ...extra }).success,
      false,
      `${JSON.stringify(extra)} must be rejected — a move never re-prices the bill`,
    );
  }
});

test("moveOrderTableSchema holds the destination to the tableNo charset (it becomes a stored join key)", () => {
  assert.equal(moveOrderTableSchema.safeParse({ tableNo: "bad/name" }).success, false);
});

// ── CB-2.7 — discountKind (C2): an enum, not a free label ───────────────────
// "gst" accepted, null accepted (explicit clear), absent accepted (unchanged),
// anything else — a wrong-case "GST" or a plain string like "promo" — rejected,
// on all three payloads that carry it. .strict() must survive the new key on
// addItemsSchema/settleOrderSchema (createOrderSchema is not .strict()).

const sampleOrder = {
  customerName: "Walk-in",
  items: sampleItems,
  subtotal: 20,
  total: 20,
  paidAmount: 20,
  payment: "Cash",
  receiver: "cashier",
};

test("createOrderSchema: discountKind accepts 'gst', null, and absent", () => {
  assert.equal(createOrderSchema.safeParse({ ...sampleOrder, discountKind: "gst" }).success, true);
  assert.equal(createOrderSchema.safeParse({ ...sampleOrder, discountKind: null }).success, true);
  assert.equal(createOrderSchema.safeParse(sampleOrder).success, true);
});

test("createOrderSchema: discountKind rejects 'GST' (wrong case) and 'promo' (not in DISCOUNT_KINDS)", () => {
  assert.equal(createOrderSchema.safeParse({ ...sampleOrder, discountKind: "GST" }).success, false);
  assert.equal(createOrderSchema.safeParse({ ...sampleOrder, discountKind: "promo" }).success, false);
});

test("addItemsSchema: discountKind accepts 'gst', null, and absent", () => {
  assert.equal(addItemsSchema.safeParse({ items: sampleItems, discountKind: "gst" }).success, true);
  assert.equal(addItemsSchema.safeParse({ items: sampleItems, discountKind: null }).success, true);
  assert.equal(addItemsSchema.safeParse({ items: sampleItems }).success, true);
});

test("addItemsSchema: discountKind rejects 'GST' and 'promo'", () => {
  assert.equal(addItemsSchema.safeParse({ items: sampleItems, discountKind: "GST" }).success, false);
  assert.equal(addItemsSchema.safeParse({ items: sampleItems, discountKind: "promo" }).success, false);
});

test("addItemsSchema: .strict() still rejects an unknown key alongside a valid discountKind", () => {
  assert.equal(
    addItemsSchema.safeParse({ items: sampleItems, discountKind: "gst", bogus: 1 }).success,
    false,
  );
});

test("settleOrderSchema: discountKind accepts 'gst', null, and absent", () => {
  assert.equal(settleOrderSchema.safeParse({ payment: "Cash", discountKind: "gst" }).success, true);
  assert.equal(settleOrderSchema.safeParse({ payment: "Cash", discountKind: null }).success, true);
  assert.equal(settleOrderSchema.safeParse({ payment: "Cash" }).success, true);
});

test("settleOrderSchema: discountKind rejects 'GST' and 'promo'", () => {
  assert.equal(settleOrderSchema.safeParse({ payment: "Cash", discountKind: "GST" }).success, false);
  assert.equal(settleOrderSchema.safeParse({ payment: "Cash", discountKind: "promo" }).success, false);
});

test("settleOrderSchema: .strict() still rejects an unknown key alongside a valid discountKind", () => {
  assert.equal(
    settleOrderSchema.safeParse({ payment: "Cash", discountKind: "gst", bogus: 1 }).success,
    false,
  );
});

// CB-5B — DISCOUNT_KINDS widens to ["gst", "reward"]; "reward" must be
// ACCEPTED by all three schemas that carry discountKind, same as "gst" is.
// The existing "GST"/"promo"-rejected negative tests above are UNTOUCHED.
test("createOrderSchema/addItemsSchema/settleOrderSchema: discountKind accepts 'reward'", () => {
  assert.equal(createOrderSchema.safeParse({ ...sampleOrder, discountKind: "reward" }).success, true);
  assert.equal(addItemsSchema.safeParse({ items: sampleItems, discountKind: "reward" }).success, true);
  assert.equal(settleOrderSchema.safeParse({ payment: "Cash", discountKind: "reward" }).success, true);
});

// ── CB-DL-2 D-B 11 — productId/customerId are now real ObjectId hex strings,
// not arbitrary non-empty strings ────────────────────────────────────────────

test("createOrderSchema: a short/non-hex productId ('p1') is rejected with path ['items',0,'productId']", () => {
  const r = createOrderSchema.safeParse({
    ...sampleOrder,
    items: [{ productId: "p1", name: "Chai", price: 20, qty: 1 }],
  });
  assert.equal(r.success, false);
  if (!r.success) {
    const issue = r.error.issues.find(
      (i) => i.path[0] === "items" && i.path[1] === 0 && i.path[2] === "productId",
    );
    assert.ok(issue, "expected an issue at path ['items', 0, 'productId']");
  }
});

test("createOrderSchema: a non-hex customerId ('abc') is rejected", () => {
  const r = createOrderSchema.safeParse({ ...sampleOrder, customerId: "abc" });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.equal(r.error.issues.some((i) => i.path[0] === "customerId"), true);
  }
});

test("createOrderSchema: customerId omitted still parses OK (optional)", () => {
  const r = createOrderSchema.safeParse(sampleOrder);
  assert.equal(r.success, true);
});

test("createOrderSchema: a valid 24-hex customerId parses through", () => {
  const r = createOrderSchema.safeParse({ ...sampleOrder, customerId: SAMPLE_CUSTOMER_ID });
  assert.equal(r.success, true);
});

test("settleOrderSchema: a non-hex customerId ('abc') is rejected at path ['customerId']", () => {
  const r = settleOrderSchema.safeParse({ payment: "Cash", customerId: "abc" });
  assert.equal(r.success, false);
  if (!r.success) {
    assert.equal(r.error.issues.some((i) => i.path[0] === "customerId"), true);
  }
});

test("settleOrderSchema: a valid 24-hex customerId is accepted", () => {
  const r = settleOrderSchema.safeParse({ payment: "Cash", customerId: SAMPLE_CUSTOMER_ID });
  assert.equal(r.success, true);
});

test("settleOrderSchema: customerId omitted still parses OK (optional)", () => {
  const r = settleOrderSchema.safeParse({ payment: "Cash" });
  assert.equal(r.success, true);
});

// ── P-NEW-12 (CB-5B S11) — MONEY FENCE: orderItemSchema must NOT gain a
// `reward` key. A client-declared `reward: true` on a line would exclude it
// from the subtotal (lib/receipt.ts's reducer) — only the server (S12) may
// ever set that flag. Bounded to the orderItemSchema block only, with a
// POSITIVE landmark (`variation` IS in the shape) so this cannot pass
// vacuously against a truncated/empty read.
test("PIN (SOURCE): orderItemSchema has no 'reward' key — a client may never declare a line free", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "order.schema.ts"), "utf8");
  const blockMatch = src.match(/export const orderItemSchema = z\.object\(\{[\s\S]*?\n\}\);/);
  assert.ok(blockMatch, "landmark: orderItemSchema block must be found");
  const block = blockMatch![0];
  assert.match(block, /variation:/, "positive landmark: variation must still be a real key in this shape");
  assert.ok(!/reward:/.test(block), "orderItemSchema must never accept a client-supplied 'reward' key — money fence");
});
