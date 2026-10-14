import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CB-7 S6 slice C — source pins for the staff POS "Use points" row. Every negative pin carries a positive landmark.
const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const raw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8");
const code = (rel: string): string => stripComments(raw(rel));
const lineCount = (rel: string): number => raw(rel).replace(/\n$/, "").split("\n").length;
const count = (s: string, needle: string): number => s.split(needle).length - 1;

const HOOK = "hooks/use-settle-points.ts";
const ROW = "components/pos/PaymentPoints.tsx";
const MODAL = "components/pos/PaymentModal.tsx";
const TOTALS = "hooks/use-pos-modal-totals.ts";
const TAB = "hooks/use-pos-tab.ts";

test("PIN: the hook shares the reward picker's one request, tags the switch with customer + tab, and clears with the popup", () => {
  const s = code(HOOK);
  assert.ok(s.includes("useCustomerRewards(customerId).data?.points"), "landmark: the balance comes from the shared customer-rewards query");
  assert.ok(s.includes("pick.customerId === customerId && pick.tabKey === tabKey"), "the switch is tagged with the customer and the tab");
  // Session 2 (O2): an OFF flip is a real choice that stands while the popup is open (the diner's ask cannot undo it); an
  // ON with nothing left to offer still clears, exactly as before.
  assert.ok(
    s.includes("if (pick !== null && (!open || (!frozen && (!pickStands || (pick.on && !on))))) setPick(null);"),
    "it clears when the popup closes or the pick no longer stands — never while a send is frozen",
  );
  assert.ok(s.includes("const asked = resumedOrder?.pointsRequested === true;"), "the ask is the resumed TAB's own hint");
  assert.ok(s.includes("const on = pointsSwitchOn(pickStands ? pick.on : null, asked, row.amount);"), "an untouched switch follows the ask");
  assert.ok(s.includes("setPick({ customerId, tabKey, on: next });"), "the operator's flip (on OR off) is stored, tagged");
  assert.equal(count(s, "pointsRequested"), 1, "the hook reads the ask once and never writes it");
  assert.ok(s.includes("const live = on && open ? row.amount : 0;"), "nothing is spent while the popup is closed (Send to Kitchen can never carry points)");
  // Review F1: a frozen Pay Now keeps the amount it carried, latched DURING render so no refetch can land first.
  assert.ok(s.includes("const nextHold = stepPointsHold(hold, frozen, live);") && s.includes("if (nextHold !== hold) setHold(nextHold);"), "the latch is stored by a guarded setState during render");
  assert.ok(s.includes("const amount = carriedPoints(nextHold, frozen, live);"), "the amount the bill carries comes from the latch while frozen");
  assert.ok(s.includes("rowWithHold(row, frozen, amount)"), "the row shown carries the latched amount while frozen");
  assert.ok(/if \(!row\.usable\) return;/.test(s), "the toggle is gated on the reader, not just the control");
  assert.ok(s.includes("pointsRedeemedReward(amount)"), "the preview's reward is the ONE function the server prices with");
  assert.ok(!/kind: "flat"/.test(s), "no hand-built reward object");
});

test("PIN: the row is one shadcn switch in a >=44px row, disabled while the popup is in flight or frozen, with a reason line", () => {
  const s = code(ROW);
  assert.ok(s.includes('from "@/components/ui/switch"'), "landmark: the shared Switch");
  assert.ok(s.includes("min-h-11"), "a 44px row");
  assert.ok(s.includes("disabled={disabled || !row.usable}"), "disabled while locked or blocked");
  assert.ok(s.includes("{row.reason && ("), "one plain reason line");
  assert.ok(/Use \$\{row\.amount\} points \(−\$\{inr\(row\.amount\)\}\)/.test(s), "the copy: Use N points (−₹N)");
  assert.ok(!/<input|type="number"/.test(s), "no typed amount (owner O3)");
  assert.ok(s.includes("{asked && ("), "session 2 (O2): the 'Customer asked to use points' line shows only on an ask");
});

test("PIN: PaymentModal shows the row only when told to, locks it with the rest, and confirms the ticked points", () => {
  const s = code(MODAL);
  assert.ok(s.includes("{points?.show && <PaymentPoints points={points} disabled={locked} />}"), "the row, locked with the popup");
  assert.ok(s.includes("...(pointsNow > 0 ? { rewardPoints: pointsNow } : {}),"), "confirm adds rewardPoints only when ticked");
  assert.ok(s.includes("const pointsNow = points?.on ? points.row.amount : 0;"), "the figure shown is the figure sent");
  assert.ok(lineCount(MODAL) <= 300, `PaymentModal.tsx stays within 300 lines, got ${lineCount(MODAL)}`);
  assert.ok(count(code("components/pos/PaymentModeGrid.tsx"), "onClick={() => onSelect(m)}") === 1, "landmark: the mode grid moved to its own file");
});

test("PIN: the settle/pay popup prices points as discountKind reward with the points reward, on both branches", () => {
  const s = code(TOTALS);
  assert.equal(count(s, 'discountKind: reward ? "reward" : discountKind,'), 3, "the computeOrderTotals call and both returned shapes");
  assert.ok(/reward,\s*\/\/ The tab's own snapshotted charge|\n\s+reward,\n/.test(s), "the reward reaches computeOrderTotals");
  assert.ok(s.includes("orderTableCharge(resumedOrder)"), "landmark: the s92 table-charge fix is intact");
});

test("PIN: use-pos-tab feeds the points reward to the shown totals and the popup, and keeps its line budget", () => {
  const s = code(TAB);
  assert.ok(s.includes("reward: reward.selectedReward ?? points.reward,"), "the cart/mobile/popup previews price the points");
  assert.ok(s.includes("paymentIntent, reward: points.reward,"), "the popup's totals take the points reward");
  assert.ok(s.includes("points: points.view,"), "the row rides with the popup totals (PosModals spreads them to PaymentModal)");
  assert.ok(s.includes("open: paymentOpen,"), "the switch lives only while the popup is open");
  assert.ok(lineCount(TAB) <= 546, `use-pos-tab.ts was over the budget at 546 and must not grow, got ${lineCount(TAB)}`);
  assert.ok(code("components/pos/PosModals.tsx").includes("{...totals}"), "landmark: PosModals still spreads the totals");
});

test("PIN: the new files stay under the 300-line budget", () => {
  for (const f of [HOOK, ROW, "components/pos/PaymentModeGrid.tsx", "lib/settle-points-view.ts", "lib/settle-points-view.test.ts"]) {
    assert.ok(lineCount(f) <= 300, `${f} must stay within 300 lines, got ${lineCount(f)}`);
  }
});

test("PIN: the rewards route reports points from the wallet read it already makes (0 when diner accounts are off)", () => {
  const s = code("app/api/customers/[id]/rewards/route.ts");
  assert.ok(s.includes("points: pointsBalance(wallet, now)"), "the balance is derived from the same wallet read");
  assert.equal(count(s, "readWalletCardsOf("), 1, "one wallet read");
  assert.ok(s.includes("return { cards: [], points: 0 };"), "accounts off: nothing");
});

// s92 seam pass — the settle route spends points from the TAB's own customer only (lib/settle-reward.ts reads
// old.customerId; a customer attached in the popup is never charged points), so the row must not offer another
// customer's balance on a resumed tab — the switch would only reach a server refusal.
test("PIN: on a resumed tab the row reads the TAB's own customer, never one picked in the popup", () => {
  const s = code(HOOK);
  assert.ok(
    s.includes("const customerId = resumedOrder ? (resumedOrder.customerId === customer?._id ? resumedOrder.customerId : undefined) : customer?._id;"),
    "customerId = the tab's own customer on a resumed tab (only when it is also the one on screen); the picked customer on a new sale",
  );
  assert.ok(!/const customerId = customer\?\._id;/.test(s), "the popup's customer alone never decides the balance");
});
