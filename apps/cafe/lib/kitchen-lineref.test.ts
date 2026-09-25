import { test } from "node:test";
import assert from "node:assert/strict";
import { kotLineRef, orderLineKey } from "@pos/shared/utils";
import { buildKitchenRows, kitchenAgeBand, type FiredItem, type KitchenOrderInput } from "./kitchen-board";

// P4-A — the LINE-REF IDENTITY half of the board contract (pins 1-3c of
// .claude/plan/v2/p4a-kot-board-plan.md §7). Split from kitchen-board.test.ts
// purely for the 300-line ceiling — the board-BEHAVIOUR pins (4-10) live
// there. DB-free.

const PRODUCT_A = "1".repeat(24);
const NOW = new Date("2026-09-23T12:00:00.000Z");

function firedItem(over: Partial<FiredItem> = {}): FiredItem {
  return { productId: PRODUCT_A, name: "Masala Chai", qty: 1, kotRound: 1, ...over };
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

// ── Pin 1 — the reason kotLineRef exists ────────────────────────────────────

test("pin1: kotLineRef is qty-free (same ref for qty 1 vs qty 3) while orderLineKey DIFFERS for the same pair", () => {
  const lineQty1 = { productId: PRODUCT_A, qty: 1, kotRound: 1, instructions: "less sugar" };
  const lineQty3 = { productId: PRODUCT_A, qty: 3, kotRound: 1, instructions: "less sugar" };

  assert.equal(
    kotLineRef(lineQty1),
    kotLineRef(lineQty3),
    "kotLineRef must be identical across a qty change — that's the whole reason it exists",
  );
  assert.notEqual(
    orderLineKey(lineQty1),
    orderLineKey(lineQty3),
    "orderLineKey includes qty by design — it MUST differ for the same pair",
  );
});

// ── Pin 2/3 — ref still differs on the fields that matter; no trailing sep ──

test("pin2: kotLineRef differs on round, instructions, modifier SET (order-independent), and variation", () => {
  const base = { productId: PRODUCT_A, kotRound: 1, instructions: "", modifiers: [] as string[] };
  const roundRef = kotLineRef(base);
  const round2Ref = kotLineRef({ ...base, kotRound: 2 });
  assert.notEqual(roundRef, round2Ref, "a later round firing the same dish must get a fresh ref");

  const instrRef = kotLineRef({ ...base, instructions: "extra spicy" });
  assert.notEqual(roundRef, instrRef, "different instructions must get a different ref");

  const modsA = kotLineRef({ ...base, modifiers: ["no onion", "extra raita"] });
  const modsB = kotLineRef({ ...base, modifiers: ["extra raita", "no onion"] });
  assert.equal(modsA, modsB, "modifier ORDER must not matter — it's a set");
  assert.notEqual(roundRef, modsA, "a non-empty modifier set must differ from an empty one");

  const varRef = kotLineRef({ ...base, variation: "Large" });
  assert.notEqual(roundRef, varRef, "a variation must change the ref");
});

test("pin3: no trailing separator artifact from the variation branch when variation is absent", () => {
  // kotLineRef appends the variation ONLY when present (base.join vs
  // [...base, variation].join) — omitting it must never leave an extra
  // trailing LINE_KEY_SEP where the variation would have gone. Proven by: a
  // ref with no variation is BYTE-IDENTICAL whether variation is omitted or
  // explicitly undefined (both take the "no variation" branch), and it must
  // NOT equal what you'd get by explicitly appending an EMPTY variation.
  const omitted = kotLineRef({ productId: PRODUCT_A, kotRound: 1, instructions: "", modifiers: [] });
  const explicitUndefined = kotLineRef({
    productId: PRODUCT_A,
    kotRound: 1,
    instructions: "",
    modifiers: [],
    variation: undefined,
  });
  assert.equal(omitted, explicitUndefined, "omitted vs explicit-undefined variation must produce the same ref");

  const withVariation = kotLineRef({
    productId: PRODUCT_A,
    kotRound: 1,
    instructions: "",
    modifiers: [],
    variation: "Large",
  });
  assert.equal(
    withVariation,
    `${omitted}Large`,
    "a present variation appends exactly ONE separator + the variation — no extra separator either side",
  );
  assert.notEqual(omitted, withVariation, "presence vs absence of variation must produce different refs");
});

// ── Pin 3b — the two id fields never swap ───────────────────────────────────
// `orderId` on a ROW is the Mongo hex `_id` (what a tick is addressed by),
// while `orderNo` is the printed "ORD-…" a cook reads off the paper slip.
// The names collide by one letter and the first build shipped WITHOUT
// `orderNo` at all, so a row could not be matched to its ticket when the
// cafe has ticket numbering off. Pinned so a refactor cannot quietly swap
// them: a tick addressed by the human number would 404 on every line.
test("pin3b: row.orderId is the Mongo _id (tick key) and row.orderNo is the printed order number — never swapped", () => {
  const rows = buildKitchenRows({
    orders: [order({ _id: "b".repeat(24), orderId: "ORD-20260923-042" })],
    ticksByOrder: {},
    now: NOW,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].orderId, "b".repeat(24), "orderId must be the hex _id the tick route keys on");
  assert.equal(rows[0].orderNo, "ORD-20260923-042", "orderNo must be the printed order number");
  assert.ok(rows[0].id.startsWith(`${"b".repeat(24)}:`), "the row id must be built from the hex _id, not the order number");
  assert.notEqual(rows[0].orderId, rows[0].orderNo, "the two id fields must never be the same value");
});

// ── Pin 3c — the row must survive the WIRE ──────────────────────────────────
// A KitchenRow is JSON-encoded by the route and parsed by apiGet's `unwrap`,
// which does a plain res.json() with NO date reviver. A `Date` on this type
// would therefore arrive at the client as a string while the type still
// claimed Date — tsc stays green (the fetch generic is an unchecked assertion
// over parsed JSON) and EVERY row then throws "getTime is not a function" at
// render. The first build shipped exactly that. Pinned by round-tripping the
// row through JSON and re-running the real consumers over the result.
test("pin3c: a row survives a JSON round-trip — firedAt stays usable by kitchenAgeBand and the age maths", () => {
  const stampedAt = new Date("2026-09-23T11:50:00.000Z");
  const rows = buildKitchenRows({
    orders: [order({ items: [firedItem({ kotRound: 1 })], kotFiredAt: [stampedAt] })],
    ticksByOrder: {},
    now: NOW,
  });

  // Exactly what NextResponse.json + res.json() do to the payload.
  const overTheWire = JSON.parse(JSON.stringify(rows)) as typeof rows;
  const row = overTheWire[0];

  assert.equal(typeof row.firedAt, "string", "firedAt must cross the wire as a string, never a Date");
  assert.equal(row.firedAt, stampedAt.toISOString(), "and it must still be the stamped fire time");

  // The two real consumers, run over the POST-WIRE row — this is the assertion
  // that would have caught the crash.
  const band = kitchenAgeBand(row.firedAt, NOW);
  assert.equal(band.key, "warn", "10m old must band as warn, computed from the wire value");
  const ageMinutes = Math.floor((NOW.getTime() - new Date(row.firedAt).getTime()) / 60_000);
  assert.equal(ageMinutes, 10, "the age maths must work on the wire value without throwing");
});
