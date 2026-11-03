import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fenceTableChargeAmount, settleCharges } from "./settle-charges";
import { stripComments } from "./source-pin-utils";
import type { OrderCharge } from "@pos/shared/order-charges";

// T1 (owner 2026-11-04) - after a move the NEW table's own charge applies. The move route re-prices the tab (it drops
// the table entry when the destination has no charge); this fence keeps an old POS tab's stale `chargeAmount` from
// re-creating one. It is keyed to the TAB's saved table entry (what the POS shows, hooks/use-pos-charge.ts), never to
// the table's live setting: an admin edit must not re-price a running bill. No DB read.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAFE_ROOT = path.join(HERE, "..");
const SETTLE_ROUTE = "app/api/orders/[id]/settle/route.ts";
const ITEMS_ROUTE = "app/api/orders/[id]/items/route.ts";
const SETTLE_CHARGES = "lib/settle-charges.ts";
const read = (rel: string) => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const count = (src: string, needle: string) => src.split(needle).length - 1;

// ── the pure fence ───────────────────────────────────────────────────────────

test("fenceTableChargeAmount: a sent amount on a tab with no table entry is zero", () => {
  assert.equal(fenceTableChargeAmount(20, 0), 0);
  assert.equal(fenceTableChargeAmount(20, -5), 0, "a nonsense saved amount is still no entry");
});

test("fenceTableChargeAmount: a tab with an entry, a waiver and an omitted amount pass through untouched", () => {
  assert.equal(fenceTableChargeAmount(30, 50), 30, "lowering the saved entry stays");
  assert.equal(fenceTableChargeAmount(80, 50), 80, "the fence never caps at the saved amount");
  assert.equal(fenceTableChargeAmount(0, 0), 0, "a waiver stays a waiver");
  assert.equal(fenceTableChargeAmount(0, 50), 0);
  assert.equal(fenceTableChargeAmount(undefined, 0), undefined, "omitted stays omitted");
  assert.equal(fenceTableChargeAmount(undefined, 50), undefined);
});

// ── settleCharges (the ONE builder under settle's bill, settle's reward gate and the add-round) ─────────

const TABLE_50: OrderCharge = { type: "table", label: "AC charge", amount: 50 };
const EXTRA: OrderCharge = { type: "extra", label: "Packing", amount: 10 };
const tableOf = (charges: readonly OrderCharge[]) => charges.find((c) => c.type === "table");
const extrasOf = (charges: readonly OrderCharge[]) => charges.filter((c) => c.type === "extra");

test("settleCharges after a move to a no-charge table (no table entry): a stale 20 yields no table entry", () => {
  const out = settleCharges([EXTRA], 20, undefined);
  assert.equal(tableOf(out), undefined);
  assert.deepEqual(extrasOf(out), [EXTRA], "the extras lane is untouched");
});

test("settleCharges on a tab that still carries its entry: 30 bills 30 with no config read (the admin-edit scenario)", () => {
  const out = settleCharges([TABLE_50, EXTRA], 30, undefined);
  assert.equal(tableOf(out)?.amount, 30);
  assert.equal(tableOf(out)?.label, "AC charge", "the saved label rides along");
  assert.deepEqual(extrasOf(out), [EXTRA]);
});

test("settleCharges: 0 waives, omitted keeps the saved entry, no entry + omitted stays none", () => {
  const waived = settleCharges([TABLE_50, EXTRA], 0, undefined);
  assert.equal(tableOf(waived), undefined);
  assert.deepEqual(extrasOf(waived), [EXTRA]);
  const kept = settleCharges([TABLE_50, EXTRA], undefined, undefined);
  assert.equal(tableOf(kept)?.amount, 50);
  assert.deepEqual(extrasOf(kept), [EXTRA]);
  const none = settleCharges([EXTRA], undefined, undefined);
  assert.equal(tableOf(none), undefined);
  assert.deepEqual(extrasOf(none), [EXTRA]);
});

test("settleCharges: a raised amount on a tab with an entry still applies; the extras replace only when sent", () => {
  assert.equal(tableOf(settleCharges([TABLE_50], 80, undefined))?.amount, 80);
  const replaced = settleCharges([EXTRA], 20, [{ label: "Service", amount: 5 }]);
  assert.equal(tableOf(replaced), undefined, "the fence holds when the extras are replaced too");
  assert.deepEqual(extrasOf(replaced).map((c) => c.label), ["Service"]);
});

// ── wiring (source pins) ─────────────────────────────────────────────────────

test("PIN: settleCharges fences the sent amount against the tab's own table entry, not a config read", () => {
  const src = read(SETTLE_CHARGES);
  const start = src.indexOf("export function settleCharges(");
  assert.ok(start !== -1, "landmark: settleCharges");
  const fn = src.slice(start, src.indexOf("\n}\n", start) + 3);
  assert.ok(fn.includes("const tableEntry = baseCharges.find((c) => c.type === \"table\");"), "landmark: the tab's saved table entry");
  assert.ok(
    fn.includes("fenceTableChargeAmount(chargeAmount, tableEntry?.amount ?? 0) ?? tableEntry?.amount ?? 0"),
    "the sent amount runs through the fence over the saved entry before it prices anything",
  );
  assert.equal(fn.includes("chargeAmount ?? tableEntry"), false, "no raw `chargeAmount ??` left in the builder");
  assert.equal(src.includes("table-admin"), false, "no table read: the fence is keyed to the tab, never the live table");
});

test("PIN (add-round): the charges are built through settleCharges with the raw body amount, no inline table lane", () => {
  const src = read(ITEMS_ROUTE);
  const call = "settleCharges(chargesFromOrder(old), parsed.data.chargeAmount, parsed.data.extraCharges)";
  assert.equal(count(src, "const charges = " + call + ";"), 1, "the one charges builder is the shared settleCharges");
  assert.equal(count(src, "parsed.data.chargeAmount"), 1, "the body amount is read only there");
  assert.match(src, /import \{ settleCharges \} from "@\/lib\/settle-charges";/, "imported from the shared builder");
  assert.equal(src.includes("withTableCharge("), false, "no inline table lane left beside the builder");
  assert.equal(src.includes("applyExtraCharges("), false, "no inline extras lane left beside the builder");
  assert.ok(src.indexOf("splitChargeTotals(charges)") > src.indexOf(call), "landmark: the totals read the built charges");
});

test("PIN (settle): the route hands the raw body amount to BOTH the reward gate and the money (fenced inside settleCharges)", () => {
  const src = read(SETTLE_ROUTE);
  const rewardAt = src.indexOf("resolveSettleReward({");
  const moneyAt = src.indexOf("resolveSettleMoney({");
  assert.ok(rewardAt !== -1 && moneyAt !== -1 && rewardAt < moneyAt, "landmarks: both resolvers, reward first");
  const reward = src.slice(rewardAt, src.indexOf("});", rewardAt));
  const money = src.slice(moneyAt, src.indexOf("});", moneyAt));
  assert.ok(reward.includes("chargeAmount: data.chargeAmount,"), "the reward minBill gate reads the body amount");
  assert.ok(money.includes("chargeAmount: data.chargeAmount,"), "the money reads the same body amount");
  assert.equal(src.includes("fencedChargeAmount"), false, "no route-level live-table fence");
  // Both resolvers fence through the one builder, so the gate can never read a different bill than the one charged.
  assert.ok(read("lib/order.ts").includes("settleCharges(baseCharges, input.chargeAmount, input.extraCharges)"), "the bill goes through settleCharges");
  assert.ok(read("lib/settle-reward.ts").includes("settleCharges(chargesFromOrder(old), chargeAmount, extraCharges)"), "the gate goes through settleCharges");
});
