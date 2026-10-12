import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeOrderTotals, type GstConfig } from "./receipt";
import { resolveSettleMoney } from "./order";
import { resolveItemVoid } from "./order-void";
import { stripComments } from "@/lib/source-pin-utils";
import { orderLineKey } from "@pos/shared/utils";
import { rewardFromOrderSnapshot, ORDER_REWARD_SNAPSHOT_KEYS } from "@pos/shared/reward-redemption";

// CB-7 S5 / s86 P3 — a scratch-card order stores rewardAt ABSENT. Every writer that RE-PRICES an open tab rebuilds the
// reward with rewardFromOrderSnapshot(order); before the card arm existed that returned undefined for a card order and
// rewardDiscountAmount fails closed at 0, so the diner's card quietly stopped discounting the bill they paid for.
// These tests feed the REAL pure money functions the exact snapshot a card order stores and pin the discount.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, "..", rel), "utf8");

const NO_GST: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "inclusive" };
const CARD_ID = "a1b2c3d4e5f6";
const PRODUCT_ID = "60a1b2c3d4e5f60718293a4b";
const FLAT = 100;
const PRICE = 200;

// What the snapshot of a flat-₹100 card order holds (no rewardAt, no rewardStamps) and its stamp-ladder twin.
const cardOrder = { rewardCardId: CARD_ID, rewardKind: "flat" as const, rewardValue: FLAT };
const stampOrder = { rewardAt: 8, rewardKind: "flat" as const, rewardValue: FLAT };
const line = { productId: PRODUCT_ID, name: "Masala Chai", price: PRICE, qty: 2, kotRound: 1 };

// ── the positive control: the SAME money functions with the stamp-ladder snapshot (proves the harness prices a reward) ──

test("witness: a STAMP reward snapshot prices Rs 100 off through computeOrderTotals (the harness is live)", () => {
  const totals = computeOrderTotals({
    items: [line], discount: 0, discountKind: "reward", charge: 0, cfg: NO_GST, reward: rewardFromOrderSnapshot(stampOrder),
  });
  assert.equal(totals.subtotal, 400);
  assert.equal(totals.discount, FLAT);
  assert.equal(totals.total, 300);
});

// ── P3: the three re-pricing writers, fed a card order's snapshot ───────────────────────────────────────────────────

test("P3 add-round: computeOrderTotals with the card order's rebuilt reward keeps the Rs 100 discount", () => {
  // The add-round route: the tab's stored lines + this round's, discountKind carried as "reward", the reward rebuilt
  // from the order's OWN snapshot (items/route.ts rewardForTotals).
  const totals = computeOrderTotals({
    items: [line, { ...line, kotRound: 2 }],
    discount: FLAT,
    discountKind: "reward",
    charge: 0,
    extraCharge: 0,
    cfg: NO_GST,
    reward: rewardFromOrderSnapshot(cardOrder),
  });
  assert.equal(totals.subtotal, 800, "landmark: both rounds are on the bill");
  assert.equal(totals.discount, FLAT, "a card order must keep its Rs 100 off on a new round (0 = re-billed at full price)");
  assert.equal(totals.total, 700);
});

test("P3 settle: resolveSettleMoney re-pricing a card order (a charge waiver) keeps the Rs 100 discount", () => {
  const money = resolveSettleMoney({
    order: { items: [line], total: 300, discount: FLAT, discountKind: "reward", gstRate: 0, gstMode: "inclusive", chargeAmount: 0 },
    payment: "Cash",
    // A settle that re-prices at all (here: a table-charge waiver) rebuilds the reward from the snapshot, exactly as
    // settle/route.ts does when the settle claims nothing.
    chargeAmount: 0,
    liveGst: NO_GST,
    reward: rewardFromOrderSnapshot(cardOrder),
  });
  assert.ok(!("error" in money), "the settle must resolve");
  assert.ok(money.totals, "landmark: this settle re-priced the bill (the no-recompute path would hide the bug)");
  assert.equal(money.totals.subtotal, 400);
  assert.equal(money.totals.discount, FLAT, "a card order must keep its Rs 100 off at settle (0 = the diner pays full price)");
  assert.equal(money.total, 300);
});

test("P3 void: resolveItemVoid on a card order keeps the Rs 100 discount on what remains", () => {
  const resolved = resolveItemVoid({
    items: [line],
    request: {
      index: 0,
      lineKey: orderLineKey({ ...line }),
      qty: 1,
      reason: "dish returned",
      voidedBy: "Staff",
      at: new Date("2026-10-12T10:00:00.000Z"),
    },
    discount: FLAT,
    discountKind: "reward",
    reward: rewardFromOrderSnapshot(cardOrder),
    charge: 0,
    gstCfg: NO_GST,
  });
  assert.ok(!("error" in resolved), "the void must resolve");
  assert.equal(resolved.totals.subtotal, 200, "landmark: one unit remains");
  assert.equal(resolved.totals.discount, FLAT, "a card order must keep its Rs 100 off after a void (0 = re-billed at full price)");
  assert.equal(resolved.totals.total, 100);
});

// ── P3 source pin: the table-move route PROJECTS the order before re-pricing it ─────────────────────────────────────

test("P3 table move: the projection names every ORDER_REWARD_SNAPSHOT_KEYS entry (or is built from that list)", () => {
  const code = stripComments(readSrc("app/api/orders/[id]/table/route.ts"));
  const start = code.indexOf("Order.findById(id)");
  assert.ok(start >= 0, "landmark: the route reads the order with findById(id)");
  const end = code.indexOf(".lean()", start);
  const read = code.slice(start, end);
  assert.ok(read.includes(".select(") && read.includes("tableNo") && read.includes("createdAt"), "landmark: this is the money projection");
  assert.ok(code.includes("rewardFromOrderSnapshot(order)"), "landmark: the same route rebuilds the reward from the projected order");

  const importsList = /import\s*\{[^}]*\bORDER_REWARD_SNAPSHOT_KEYS\b[^}]*\}\s*from\s*"@pos\/shared\/reward-redemption"/.test(code);
  const usesList = code.split("ORDER_REWARD_SNAPSHOT_KEYS").length - 1 >= 2; // the import + at least one use
  if (importsList && usesList) return; // built from the shared list: drift-proof by construction
  const missing = ORDER_REWARD_SNAPSHOT_KEYS.filter((key) => !new RegExp(`\\b${key}\\b`).test(read));
  assert.deepEqual(
    missing,
    [],
    "the projection must carry every reward snapshot key — a key left out re-prices as Rs 0 on a table move: missing " +
      missing.join(", "),
  );
});

// ── parity: every snapshot key is a real Order path (a key the model drops would never round-trip) ──────────────────

test("parity: every ORDER_REWARD_SNAPSHOT_KEYS entry is declared in the Order reward paths", () => {
  const paths = stripComments(readSrc("models/order-reward-paths.ts"));
  assert.ok(paths.includes("orderRewardPaths"), "landmark: this is the schema paths module");
  for (const key of ORDER_REWARD_SNAPSHOT_KEYS) {
    assert.match(paths, new RegExp(`\\b${key}:\\s*\\{`), `Order must declare a schema path for ${key}`);
  }
});
