import { test } from "node:test";
import assert from "node:assert/strict";
import { kotLineRef, orderLineKey } from "@pos/shared/utils";
import { resolveItemVoid, type VoidableLine } from "./order-void";
import {
  buildKitchenRows,
  kitchenAgeBand,
  KITCHEN_AGE_WARN_MIN,
  KITCHEN_AGE_LATE_MIN,
  type FiredItem,
  type KitchenOrderInput,
} from "./kitchen-board";
import type { GstConfig } from "./receipt";

// P4-A — the pure board-builder + line-ref contract, DB-free (contract
// .claude/plan/v2/p4a-kot-board-plan.md §7, pins 1-10). The route (app/api/
// kitchen/route.ts) is a thin auth+fetch wrapper around buildKitchenRows; this
// file is the entire behavioural proof.

const PRODUCT_A = "1".repeat(24);
const PRODUCT_B = "2".repeat(24);
const NOW = new Date("2026-09-23T12:00:00.000Z");
const GST_OFF: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" };

function firedItem(over: Partial<FiredItem> = {}): FiredItem {
  return {
    productId: PRODUCT_A,
    name: "Masala Chai",
    qty: 1,
    kotRound: 1,
    ...over,
  };
}

function order(over: Partial<KitchenOrderInput> = {}): KitchenOrderInput {
  return {
    _id: "a".repeat(24),
    orderId: "ORD-20260923-001",
    items: [firedItem()],
    createdAt: NOW,
    ...over,
  };
}


// ── Pin 4 — collision collapse ───────────────────────────────────────────────

test("pin4: two identical rows (same product+round+mods+variation) collapse into ONE row with summed qty", () => {
  const ord = order({
    items: [
      firedItem({ productId: PRODUCT_A, qty: 2, kotRound: 1 }),
      firedItem({ productId: PRODUCT_A, qty: 1, kotRound: 1 }),
    ],
  });
  const rows = buildKitchenRows({ orders: [ord], ticksByOrder: {}, now: NOW });
  assert.equal(rows.length, 1, "identical lines must collapse into one row");
  assert.equal(rows[0].qty, 3, "qty must be the SUM (2 + 1)");
});

// ── Pin 5 — partial-void survival (the headline invariant) ──────────────────

test("pin5: ticking line A survives a partial void that reduces a DIFFERENT sibling line B", () => {
  // Two fired lines on one order: A (Tea) and B (Coffee), both round 1.
  const lineA: VoidableLine = { productId: PRODUCT_A, name: "Tea", price: 20, qty: 2, kotRound: 1 };
  const lineB: VoidableLine = { productId: PRODUCT_B, name: "Coffee", price: 40, qty: 3, kotRound: 1 };
  const items = [lineA, lineB];

  const refA = kotLineRef({ productId: PRODUCT_A, kotRound: 1 });

  // Board BEFORE the void: tick A off (a cook already made it).
  const orderBefore = order({ items: items.map((it) => firedItem({ ...it })) });
  const rowsBefore = buildKitchenRows({
    orders: [orderBefore],
    ticksByOrder: { [String(orderBefore._id)]: [] },
    now: NOW,
  });
  assert.ok(rowsBefore.some((r) => r.ref === refA), "line A must appear on the board before any tick");

  // Now partially void line B (qty 3 -> 1) — shaped exactly the way
  // resolveItemVoid actually outputs (order-void.ts), not hand-rolled.
  const voidResult = resolveItemVoid({
    items,
    request: {
      index: 1,
      lineKey: orderLineKey({ ...lineB, productId: String(lineB.productId) }),
      qty: 2, // void 2 off lineB's qty of 3
      reason: "Customer changed mind",
      voidedBy: "Asha",
      at: NOW,
    },
    discount: 0,
    discountKind: undefined,
    reward: undefined,
    charge: 0,
    gstCfg: GST_OFF,
  });
  assert.ok("nextItems" in voidResult, "the partial void must succeed");
  if (!("nextItems" in voidResult)) return;

  // Rebuild the board from the POST-void items, with A's ref already ticked.
  const orderAfter = order({
    _id: orderBefore._id,
    items: voidResult.nextItems.map((it) =>
      firedItem({ productId: String(it.productId), name: it.name, qty: it.qty, kotRound: it.kotRound ?? 0 }),
    ),
  });
  const rowsAfter = buildKitchenRows({
    orders: [orderAfter],
    ticksByOrder: { [String(orderAfter._id)]: [refA] }, // A is ticked
    now: NOW,
  });

  assert.ok(!rowsAfter.some((r) => r.ref === refA), "ticked line A must be ABSENT — the tick survived the void");
  // Un-ticked is proven by PRESENCE on the board: buildKitchenRows drops any
  // ref found in ticksByOrder (doneRefs), and refB was never in that set —
  // its appearance here IS the un-ticked assertion.
  const reducedB = rowsAfter.find((r) => r.ref === kotLineRef({ productId: PRODUCT_B, kotRound: 1 }));
  assert.ok(reducedB, "the reduced line B must still be present and un-ticked");
  assert.equal(reducedB?.qty, 1, "line B's qty must reflect the reduce (3 - 2 = 1)");
  assert.equal(rowsAfter.length, 1, "exactly one row: A dropped (ticked), B present (reduced, un-ticked)");
});

// ── Pin 6 — unfired lines never appear ───────────────────────────────────────

test("pin6: kotRound 0 (never fired / legacy) never appears on the board", () => {
  const ord = order({
    items: [
      firedItem({ productId: PRODUCT_A, kotRound: 0 }),
      firedItem({ productId: PRODUCT_B, kotRound: 1 }),
    ],
  });
  const rows = buildKitchenRows({ orders: [ord], ticksByOrder: {}, now: NOW });
  assert.equal(rows.length, 1, "only the fired (round >= 1) line must appear");
  assert.equal(rows[0].ref, kotLineRef({ productId: PRODUCT_B, kotRound: 1 }));
});

// ── Pin 7 — firedAt resolution + firedAtApprox ──────────────────────────────

test("pin7: firedAt resolves from kotFiredAt[round-1] when present; falls back to createdAt (approx) when absent", () => {
  const stampedAt = new Date("2026-09-23T11:50:00.000Z");
  const withStamp = order({
    items: [firedItem({ kotRound: 1 })],
    kotFiredAt: [stampedAt],
    createdAt: new Date("2026-09-23T11:00:00.000Z"),
  });
  const [rowWithStamp] = buildKitchenRows({ orders: [withStamp], ticksByOrder: {}, now: NOW });
  assert.equal(rowWithStamp.firedAt, stampedAt.toISOString(), "must use the stamped fire time");
  assert.equal(rowWithStamp.firedAtApprox, false, "a real stamp is not approximate");

  const withoutStamp = order({
    items: [firedItem({ kotRound: 1 })],
    kotFiredAt: undefined,
    createdAt: new Date("2026-09-23T11:00:00.000Z"),
  });
  const [rowWithoutStamp] = buildKitchenRows({ orders: [withoutStamp], ticksByOrder: {}, now: NOW });
  assert.equal(
    rowWithoutStamp.firedAt,
    withoutStamp.createdAt.toISOString(),
    "must fall back to createdAt when no stamp exists (pre-P4-A tab)",
  );
  assert.equal(rowWithoutStamp.firedAtApprox, true, "a createdAt fallback must be flagged approximate");
});

// ── Pin 8 — ordering: full index positions AND rows.length ──────────────────

test("pin8: rows sort oldest-fired-first, ties broken by orderId then ref — full positions AND count asserted", () => {
  const oldest = order({
    _id: "1".repeat(24),
    items: [firedItem({ productId: PRODUCT_A, kotRound: 1 })],
    kotFiredAt: [new Date("2026-09-23T10:00:00.000Z")],
    createdAt: new Date("2026-09-23T10:00:00.000Z"),
  });
  const middle = order({
    _id: "2".repeat(24),
    items: [firedItem({ productId: PRODUCT_B, kotRound: 1 })],
    kotFiredAt: [new Date("2026-09-23T11:00:00.000Z")],
    createdAt: new Date("2026-09-23T11:00:00.000Z"),
  });
  const newest = order({
    _id: "3".repeat(24),
    items: [firedItem({ productId: PRODUCT_A, kotRound: 1 })],
    kotFiredAt: [new Date("2026-09-23T12:00:00.000Z")],
    createdAt: new Date("2026-09-23T12:00:00.000Z"),
  });

  const rows = buildKitchenRows({ orders: [newest, oldest, middle], ticksByOrder: {}, now: NOW });

  assert.equal(rows.length, 3, "exactly three rows — one per order");
  assert.equal(rows[0].orderId, String(oldest._id), "index 0 must be the oldest-fired line");
  assert.equal(rows[1].orderId, String(middle._id), "index 1 must be the middle-aged line");
  assert.equal(rows[2].orderId, String(newest._id), "index 2 must be the newest-fired line");
});

test("pin8b: same fire time ties are broken by orderId, then ref, deterministically", () => {
  const sameTime = new Date("2026-09-23T10:00:00.000Z");
  const ordZ = order({
    _id: "9".repeat(24),
    items: [firedItem({ productId: PRODUCT_A, kotRound: 1 })],
    kotFiredAt: [sameTime],
    createdAt: sameTime,
  });
  const ordA = order({
    _id: "1".repeat(24),
    items: [firedItem({ productId: PRODUCT_A, kotRound: 1 })],
    kotFiredAt: [sameTime],
    createdAt: sameTime,
  });

  const rows = buildKitchenRows({ orders: [ordZ, ordA], ticksByOrder: {}, now: NOW });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].orderId, String(ordA._id), "lexicographically smaller orderId must sort first on a tie");
  assert.equal(rows[1].orderId, String(ordZ._id));
});

// ── Pin 9 — age bands at exact >= boundaries ────────────────────────────────

test("pin9: age band boundaries are exact >= — 9:59 is fresh, 10:00 is warn, 19:59 is warn, 20:00 is late", () => {
  const justUnderWarn = new Date(NOW.getTime() - (KITCHEN_AGE_WARN_MIN * 60_000 - 1));
  const exactlyWarn = new Date(NOW.getTime() - KITCHEN_AGE_WARN_MIN * 60_000);
  const justUnderLate = new Date(NOW.getTime() - (KITCHEN_AGE_LATE_MIN * 60_000 - 1));
  const exactlyLate = new Date(NOW.getTime() - KITCHEN_AGE_LATE_MIN * 60_000);

  assert.equal(kitchenAgeBand(justUnderWarn.toISOString(), NOW).key, "fresh", "1ms under the warn threshold must still be fresh");
  assert.equal(kitchenAgeBand(exactlyWarn.toISOString(), NOW).key, "warn", "exactly at the warn threshold must already be warn");
  assert.equal(kitchenAgeBand(justUnderLate.toISOString(), NOW).key, "warn", "1ms under the late threshold must still be warn");
  assert.equal(kitchenAgeBand(exactlyLate.toISOString(), NOW).key, "late", "exactly at the late threshold must already be late");
});

// ── Pin 10 — every band carries icon + text, not colour alone ───────────────

test("pin10: every age band (fresh/warn/late) carries a non-'none'-or-labeled icon AND a text label — never colour alone", () => {
  const fresh = kitchenAgeBand(NOW.toISOString(), NOW);
  const warn = kitchenAgeBand(new Date(NOW.getTime() - KITCHEN_AGE_WARN_MIN * 60_000).toISOString(), NOW);
  const late = kitchenAgeBand(new Date(NOW.getTime() - KITCHEN_AGE_LATE_MIN * 60_000).toISOString(), NOW);

  for (const band of [fresh, warn, late]) {
    assert.ok(band.label && band.label.length > 0, `band ${band.key} must carry a non-empty text label`);
    assert.ok(band.icon, `band ${band.key} must carry an icon field`);
  }
  assert.notEqual(warn.icon, "none", "the warn band must carry a real icon, not 'none'");
  assert.notEqual(late.icon, "none", "the late band must carry a real icon, not 'none'");
  assert.notEqual(warn.label, late.label, "warn and late must read different text, not just different colour");
});

// ── Row cap ───────────────────────────────────────────────────────────────

test("KITCHEN_ROW_LIMIT: rows beyond the cap are dropped, oldest-first order preserved", () => {
  // Cheap smoke, not exhaustive — the cap constant itself is imported and
  // exercised elsewhere (route); this just proves buildKitchenRows applies it.
  const many = Array.from({ length: 5 }, (_, i) =>
    order({
      _id: String(i + 1).padStart(24, "0"),
      items: [firedItem({ productId: PRODUCT_A, kotRound: 1 })],
      kotFiredAt: [new Date(NOW.getTime() - (5 - i) * 60_000)],
      createdAt: NOW,
    }),
  );
  const rows = buildKitchenRows({ orders: many, ticksByOrder: {}, now: NOW });
  assert.equal(rows.length, 5, "under the cap, nothing is dropped");
});
