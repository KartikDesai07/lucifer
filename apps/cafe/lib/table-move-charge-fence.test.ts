import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chargeAmountSeenAt, fenceTableChargeAmount, settleCharges } from "./settle-charges";
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

// ── the echo: another device moved the tab before this POS heard (deferred T1, 2026-11-05) ───────────
// The POS sends the table its change was made at (`expectedTableNo`, null = walk-in). Add-round drops a change made
// at a table the tab has since left; settle refuses instead (lib/settle-guard.ts), so the POS shows the new bill first.

test("chargeAmountSeenAt: a change made at another table is dropped (lowered or waived); the same table keeps it", () => {
  assert.equal(chargeAmountSeenAt(20, "T-1", "T-2"), undefined, "a lowered amount from the old table");
  assert.equal(chargeAmountSeenAt(0, "T-1", "T-2"), undefined, "a waiver from the old table");
  assert.equal(chargeAmountSeenAt(20, "T-1", "T-1"), 20);
  assert.equal(chargeAmountSeenAt(0, "T-1", "T-1"), 0);
  assert.equal(chargeAmountSeenAt(undefined, "T-1", "T-2"), undefined);
});

test("chargeAmountSeenAt: a walk-in is no table, null or an empty name; an omitted echo (an old POS tab) is not checked", () => {
  assert.equal(chargeAmountSeenAt(20, null, undefined), 20);
  assert.equal(chargeAmountSeenAt(20, null, null), 20);
  assert.equal(chargeAmountSeenAt(20, null, ""), 20);
  assert.equal(chargeAmountSeenAt(20, null, "T-1"), undefined, "seated elsewhere");
  assert.equal(chargeAmountSeenAt(20, "T-1", undefined), undefined, "unseated elsewhere");
  assert.equal(chargeAmountSeenAt(20, undefined, "T-2"), 20, "no echo: today's rule (the fence inside settleCharges still holds)");
});

test("settleCharges after the echo: a stale 20 sent for a tab moved to an 80 table bills the 80", () => {
  const AT_80: OrderCharge = { type: "table", label: "AC", amount: 80 };
  assert.equal(tableOf(settleCharges([AT_80], 20, undefined))?.amount, 20, "regression witness: without the echo the 20 lands");
  assert.equal(tableOf(settleCharges([AT_80], chargeAmountSeenAt(20, "T-50", "T-80"), undefined))?.amount, 80);
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

test("PIN (add-round): the charges are built through settleCharges with the body amount seen at the tab's table, no inline table lane", () => {
  const src = read(ITEMS_ROUTE);
  const seen = "const chargeAmount = chargeAmountSeenAt(parsed.data.chargeAmount, parsed.data.expectedTableNo, old.tableNo);";
  const call = "settleCharges(chargesFromOrder(old), chargeAmount, parsed.data.extraCharges)";
  assert.equal(count(src, seen), 1, "the body amount runs through the table echo first");
  assert.equal(count(src, "const charges = " + call + ";"), 1, "the one charges builder is the shared settleCharges");
  assert.ok(src.indexOf(seen) < src.indexOf(call), "the echo runs before the builder");
  assert.equal(count(src, "parsed.data.chargeAmount"), 1, "the body amount is read only there");
  assert.equal(count(src, "parsed.data.expectedTableNo"), 1, "the echo is read only there");
  assert.match(src, /import \{ chargeAmountSeenAt, settleCharges \} from "@\/lib\/settle-charges";/, "both from the shared builder's module");
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

test("PIN (settle echo): the route refuses on the WHOLE body's echo (table included) before any claim or pricing", () => {
  const src = read(SETTLE_ROUTE);
  const refusalAt = src.indexOf("const refusal = settleRefusal(old, data);");
  assert.ok(refusalAt !== -1, "the guard reads the whole parsed body, so the table echo reaches it");
  assert.ok(refusalAt < src.indexOf("resolveSettleReward({"), "refused before the reward claim");
  const guard = read("lib/settle-guard.ts");
  assert.ok(guard.includes("expectedTableNo?: string | null;"), "the echo is part of SettleSeen");
  assert.ok(
    guard.includes("if (seen.expectedTableNo !== undefined && !sameTable(seen.expectedTableNo, old.tableNo)) return TAB_CHANGED;"),
    "a moved tab is TAB_CHANGED (the settle flow's 'changed' step re-reads it into the POS)",
  );
  assert.ok(read("lib/settle-flow.ts").includes("expectedTableNo: p.expectedTableNo"), "the flow's Check re-reads against the same echo");
});

test("PIN (reciprocal CAS): the add-round and the settle fence their write on the table they priced from, the move's own term", () => {
  // The echo is checked on the route's READ; a move landing between that read and the write (the move changes neither
  // kotRounds nor voids, nor the total between two same-charge tables) must make the write miss, not clobber it.
  const TERM = "...tableGuardFilter(old.tableNo),";
  for (const rel of [ITEMS_ROUTE, SETTLE_ROUTE]) {
    const src = read(rel);
    const at = src.indexOf("const filter: FilterQuery<IOrder> = {");
    assert.ok(at !== -1, `landmark: ${rel}'s CAS filter`);
    const filter = src.slice(at, src.indexOf("};", at));
    assert.ok(filter.includes("kotRounds: old.kotRounds ?? 0,"), `landmark: ${rel}'s round term`);
    assert.ok(filter.includes(TERM), `${rel}: the CAS fences the table`);
    assert.match(src, /import \{ tableGuardFilter \} from "@\/lib\/order-table-move";/, `${rel}: the one shared builder`);
  }
  const move = read("lib/order-table-move.ts");
  const fn = move.slice(move.indexOf("export function moveOrderFilter("), move.indexOf("export function claimTableFilter("));
  assert.ok(fn.includes("...tableGuardFilter(fromTableNo),"), "the move's own CAS uses the same builder");
});

test("PIN (POS echo): the add-round and the settle both send the table the POS held, null for a walk-in", () => {
  const src = read("hooks/use-pos-tab.ts");
  const ECHO = "expectedTableNo: table ?? null";
  assert.equal(count(src, ECHO), 2, "exactly the two payloads");
  const roundAt = src.indexOf("const round = resumedOrder");
  const round = src.slice(roundAt, src.indexOf(": null;", roundAt));
  assert.ok(roundAt !== -1 && round.includes("chargeAmount: chargeOverride") && round.includes(ECHO), "the round carries it beside the change");
  const settleAt = src.indexOf("const settlePayload = ");
  const settle = src.slice(settleAt, src.indexOf("\n  });", settleAt));
  assert.ok(settleAt !== -1 && settle.includes("expectedTotal: tab.total,") && settle.includes(ECHO), "the settle carries it beside the other echoes");
  // One rule for "the same table" on both sides: the POS's override fence and the server's echo.
  assert.ok(read("lib/pending-writes.ts").includes("sameTable(heldTable, serverTable) ? override : undefined"), "the client fence uses sameTable");
  assert.ok(read(SETTLE_CHARGES).includes("import { sameTable } from \"@/lib/settle-guard\";"), "the server echo uses the same sameTable");
});
