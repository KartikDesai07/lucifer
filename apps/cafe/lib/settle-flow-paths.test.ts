// Source pins for settling as ONE confirmed foreground request (owner decision
// 1, 2026-09-28): the operator starts the one POST, the popup cannot close or
// send again while it is in flight, every outcome shows inside the popup, and
// "Couldn't confirm" offers Check = one GET. Nothing is resent automatically
// and nothing survives a reload. The decision rules are unit-tested in
// lib/settle-flow.test.ts (the controller, over counting fake ports),
// lib/pending-writes.test.ts and lib/settle-guard.test.ts; these pin the WIRING
// a refactor could silently undo. Needles naming the removed background lane
// are built by concatenation so this file never matches its own scan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CAFE_ROOT = path.join(REPO_ROOT, "apps/cafe");
const readRaw = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readSrc = (rel: string): string => stripComments(readRaw(rel));

const FLOW = "apps/cafe/hooks/use-settle-flow.ts";
const CONTROLLER = "apps/cafe/lib/settle-flow.ts";
const POS_TAB = "apps/cafe/hooks/use-pos-tab.ts";
const ORDERS_HOOK = "apps/cafe/hooks/use-orders.ts";
const MODAL = "apps/cafe/components/pos/PaymentModal.tsx";
const POS_MODALS = "apps/cafe/components/pos/PosModals.tsx";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const OPEN_TABS = "apps/cafe/components/pos/OpenTabsButton.tsx";
const PROVIDERS = "apps/cafe/components/providers.tsx";
const SHEET = "apps/cafe/components/orders/OrderDetailSheet.tsx";
const ROUTE = "apps/cafe/app/api/orders/[id]/settle/route.ts";
const SCHEMA = "packages/shared/src/schemas/order.schema.ts";

const count = (src: string, needle: string) => src.split(needle).length - 1;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test("P1: the background settle lane is gone — its files, its provider, its chip, its retry loop", () => {
  for (const rel of [
    "components/layout/" + "Pending" + "WritesProvider.tsx",
    "components/layout/" + "Pending" + "WritesChip.tsx",
    "hooks/use-pos-settle" + "-lane.ts",
  ]) {
    assert.ok(!existsSync(path.join(CAFE_ROOT, rel)), `${rel} must be deleted`);
  }
  const needles = ["Pending" + "Writes", "use-pos-settle" + "-lane", "run" + "Settle("];
  const files = ["app", "components", "hooks", "lib"].flatMap((d) => sourceFiles(path.join(CAFE_ROOT, d)));
  assert.ok(files.length >= 150, `vision guard: the scan must actually read the tree (read ${files.length} files)`);
  const offenders = files.filter((f) => needles.some((n) => readFileSync(f, "utf8").includes(n)));
  assert.deepEqual(offenders, [], "no source file may still name the background lane");
  assert.ok(readSrc(POS_TAB).includes("useSettleFlow("), "landmark: the POS settles through useSettleFlow");
  // Open tabs lists every tab normally again — no "Settling…" row, no lock.
  const tabs = readSrc(OPEN_TABS);
  assert.ok(tabs.includes("onClick={() => resume(t)}"), "landmark: each open tab resumes on tap");
  assert.ok(!tabs.includes("isSettling"), "Open tabs no longer asks a lane whether a tab is settling");
  assert.match(tabs, /\{inr\(t\.total\)\}/);
});

test("P2: the hook is a thin shell — one controller, useSettleOrder's mutateAsync as send, one GET as read, no rules of its own", () => {
  const src = readSrc(FLOW);
  assert.equal(count(src, "createSettleFlow("), 1, "one controller per hook");
  assert.ok(src.includes("const [flow] = useState(() =>"), "created once per mounted hook, never per render");
  // send = the settle mutation's mutateAsync, always the latest commit's.
  // Session 1C (R1): the hook passes on whether its caller prints the bill; still one settle mutation.
  assert.ok(src.includes("const settleOrder = useSettleOrder({ printsBill: options.printsBill === true });"), "one settle mutation, told whether the bill prints");
  assert.ok(src.includes("sendRef.current = settleOrder.mutateAsync;"));
  assert.ok(src.includes("send: (id, data) => sendRef.current({ id, data }),"));
  assert.equal(count(src, "sendRef.current("), 1, "exactly one POST site");
  assert.equal(count(src, "mutateAsync("), 0, "the hook never calls the POST outside the send port");
  assert.equal(count(src, "apiGet<"), 1, "exactly one GET site (Check / reading a 409)");
  assert.ok(src.includes("read: (id) => apiGet<Order>(`/api/orders/${id}`),"));
  // Mounted = the popup is alive; unmounted mid-flight, the outcome is a toast.
  assert.ok(src.includes("useEffect(() => flow.mount(), [flow]);"));
  assert.ok(src.includes("useSyncExternalStore(flow.subscribe, flow.getState, flow.getState)"));
  assert.ok(src.includes("return { busy: state.busy, noticeFor, submit: flow.submit, dismiss: flow.dismiss };"));
  // K1: whether the cafe numbers bills comes from the one print resolver, read
  // off the latest settings when the port is called — never re-derived here.
  assert.ok(src.includes("const settings = useSettings();"));
  assert.ok(src.includes("settingsRef.current = settings.data;"));
  assert.ok(src.includes("billNumbered: () => printConfigOf(settingsRef.current).bill.showNumber,"));
  assert.equal(count(src, "showNumber"), 1, "one reading of the numbering switch");
  // K1's wait runs on THIS device's clock, handed in as a port.
  assert.ok(src.includes("now: () => Date.now(),"), "the hook feeds the controller's clock");
  // The decisions live in the controller, where they are runtime-tested.
  for (const moved of ["noticeOfSendError(", "noticeOfReadError(", "stepFromOrder(", "attempts", "busyRef"]) {
    assert.ok(!src.includes(moved), `the hook must not decide anything itself: found ${moved}`);
  }
  for (const banned of ["setTimeout(", "setInterval(", "sleep"]) {
    assert.ok(!src.includes(banned), `no timers or waits in the settle path: found ${banned}`);
  }
});

test("P2b: the controller is pure — no React, no fetch — and reaches the server only through its two ports, once each", () => {
  const raw = readRaw(CONTROLLER);
  const specifiers = [...raw.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(specifiers.includes("@/lib/pending-writes"), "landmark: the controller reads the pure rules");
  const allowed = new Set(["@/lib/pending-writes", "@/lib/settle-guard", "@/types"]);
  assert.deepEqual(specifiers.filter((s) => !allowed.has(s)), [], "no React, no toasts, no hooks, no api-client");
  const src = readSrc(CONTROLLER);
  assert.ok(src.includes("export function createSettleFlow(ports: SettleFlowPorts): SettleFlow {"), "landmark");
  assert.equal(count(src, "ports.send("), 1, "exactly one POST site");
  assert.equal(count(src, "ports.read("), 1, "exactly one GET site");
  for (const banned of ["fetch(", "setTimeout(", "setInterval(", "sleep", "window.", "document."]) {
    assert.ok(!src.includes(banned), `no IO, timers or waits in the controller: found ${banned}`);
  }
  // K1's wait: only the injected clock — never its own, never a server timestamp.
  assert.ok(src.includes("ports.now()"), "landmark: the controller reads the clock port");
  for (const banned of ["Date.", "performance.", "updatedAt", "settledAt", "createdAt"]) {
    assert.ok(!src.includes(banned), `the wait must run on the injected device clock only: found ${banned}`);
  }
});

test("P3: the POS settle branch awaits the one foreground settle and leaves closing the popup to its outcome", () => {
  const src = readSrc(POS_TAB);
  const fn = src.slice(src.indexOf("const confirmPayment"), src.indexOf("const enterResume"));
  assert.ok(src.includes("const confirmPayment") && src.includes("const enterResume"), "landmarks: both functions exist");
  const elseIdx = fn.indexOf("} else {");
  assert.ok(elseIdx > 0, "confirmPayment still branches settle / Pay Now on `} else {`");
  const settle = fn.slice(0, elseIdx);
  assert.ok(settle.includes("await settleFlow.submit(resumedOrder, settlePayload(result, resumedOrder));"), "the settle branch submits settlePayload once");
  assert.ok(!settle.includes("setPaymentOpen("), "the popup closes only on the server's answer (the flow's handlers)");
  assert.ok(!settle.includes("mutateAsync("), "no second settle lane in the branch");
});

test("P4: the one bill for a POS settle prints from the flow's onSettled handler", () => {
  const src = readSrc(POS_TAB);
  const start = src.indexOf("const settleFlow = useSettleFlow({");
  assert.ok(start >= 0, "landmark: use-pos-tab wires useSettleFlow");
  const wiring = src.slice(start, src.indexOf("\n  });", start));
  assert.match(wiring, /onSettled: \(order\) => \{\s*print\.queueReceipt\(order\);\s*setPaymentOpen\(false\);\s*resetOrder\(\);\s*\}/);
  assert.match(wiring, /onFinished: \(\) => \{\s*setPaymentOpen\(false\);\s*resetOrder\(\);\s*\}/);
});

// P5 — moved here once from the background lane's pins (R10), unchanged.
test("PIN: every settle names the tab it priced, and the route refuses a tab that moved BEFORE pricing it", () => {
  // The builder both POS lanes use, and the Orders-page sheet.
  const pos = readSrc(POS_TAB);
  const builder = pos.slice(pos.indexOf("const settlePayload"), pos.indexOf("const confirmPayment"));
  assert.ok(pos.includes("const settlePayload"), "landmark: the settle payload builder exists");
  assert.match(builder, /expectedTotal: tab\.total,/);
  assert.match(builder, /expectedVoids: tab\.voids\?\.length \?\? 0,/);
  const sheet = readSrc(SHEET);
  assert.match(sheet, /expectedTotal: order\.total,/);
  assert.match(sheet, /expectedVoids: order\.voids\?\.length \?\? 0,/);
  // .strict(): a key missing here would 400 every settle rather than drop it —
  // pinned anyway, because the fence is only real if the route receives it.
  const schema = readSrc(SCHEMA);
  const settle = schema.slice(schema.indexOf("export const settleOrderSchema"), schema.indexOf("export const cancelOrderSchema"));
  assert.ok(schema.includes("export const settleOrderSchema"), "landmark: the settle schema exists");
  assert.match(settle, /expectedTotal: z\.number\(\)\.min\(0\)\.optional\(\),/);
  assert.match(settle, /expectedVoids: z\.number\(\)\.int\(\)\.min\(0\)\.optional\(\),/);
  // The route: one refusal helper, called on the fresh read, before any pricing.
  const route = readSrc(ROUTE);
  const refusal = route.indexOf("const refusal = settleRefusal(old, data);");
  const pricing = route.indexOf("resolveSettleMoney({");
  assert.ok(refusal >= 0 && pricing > refusal, "settleRefusal runs before resolveSettleMoney");
  assert.match(route, /if \(refusal\) return failure\(refusal, 409\);/);
  assert.ok(!route.includes('old.status === "Completed"'), "the status refusals live in lib/settle-guard.ts only");
});

test("P6: the popup cannot be closed (X, Escape, outside tap) while its request is in flight", () => {
  const src = readSrc(MODAL);
  assert.ok(src.includes("if (!next && isSubmitting) return;"), "the close guard");
  assert.ok(src.includes("onOpenChange={openChange}"), "the Dialog routes every close through the guard");
  assert.ok(!src.includes("onOpenChange={onOpenChange}"), "never the unguarded handler");
});

test("P7: a settle failure is shown once, in the popup — the hook raises no error toast and never makes mutateAsync wait on refetches", () => {
  const src = readSrc(ORDERS_HOOK);
  const start = src.indexOf("export function useSettleOrder");
  const end = src.indexOf("export function useMoveOrderTable");
  assert.ok(start >= 0 && end > start, "landmarks: both hooks exist, in order");
  const hook = src.slice(start, end);
  assert.ok(hook.includes("mutationKey: ORDER_KEYS.mutation"), "landmark: the settle is still an order mutation");
  assert.ok(!hook.includes("onError"), "no error toast — the popup's notice says it");
  assert.ok(hook.includes("onSettled: () => {"), "a block body: the invalidations are not returned, so mutateAsync resolves at once");
  assert.ok(hook.includes("toast.success(settledMessage(order))"), "one success toast, in the shared wording");
});

test("P8: every mutation fails at once while offline and is never parked to fire by itself later", () => {
  const providers = readSrc(PROVIDERS);
  assert.ok(providers.includes('mutations: { networkMode: "always" }'), "the global mutation default");
  const offenders = ["hooks", "components"]
    .flatMap((d) => sourceFiles(path.join(CAFE_ROOT, d)))
    .filter((f) => !f.endsWith(path.join("components", "providers.tsx")))
    .filter((f) => stripComments(readFileSync(f, "utf8")).includes("networkMode:"));
  assert.deepEqual(offenders, [], "no per-hook networkMode override may bring parking back");
});

test("P9: the Orders/Dashboard sheet settles through the same flow, frozen on the bill the operator is paying", () => {
  const src = readSrc(SHEET);
  assert.ok(src.includes("useSettleFlow("), "the sheet uses the settle flow");
  assert.ok(!src.includes("useSettleOrder("), "and no second settle path");
  assert.ok(src.includes("paidAmount: collectedAmount(result)"), "landmark: the sheet's settle payload");
  assert.ok(src.includes("isSubmitting={settleFlow.busy}"));
  assert.ok(src.includes("notice={settleFlow.noticeFor(order._id)}"));
  assert.ok(src.includes("onOpenChange={settleOpenChange}"), "the sheet's popup closes through the flow's dismiss");
  // Latched while paying (F3 S7): a live total change mid-popup must never
  // close the bill at an amount the operator never collected.
  assert.ok(src.includes("const [payingOrder, setPayingOrder] = useState<Order | null>(null);"));
  assert.ok(src.includes("const paying = payingOrder ?? order;"));
  assert.ok(src.includes("total={paying.total}"), "the popup shows the latched bill");
  assert.match(src, /void settleFlow\.submit\(paying, sheetSettlePayload\(paying, result, settleCustomer\)\);/, "and settles the latched bill");
  // M4: a "bill changed" answer re-latches the fresh tab, or the next Settle
  // would resend the old expectedTotal and loop on 409.
  assert.match(src, /onChanged: \(o\) => \{\s*setPayingOrder\(o\);\s*onSettled\?\.\(o\);\s*\}/);
  assert.match(src, /const openSettle = \(\) => \{\s*setPayingOrder\(order\);\s*setSettleOpen\(true\);\s*\};/);
});

test("P10: a 'bill changed' answer refreshes the tab in place through applyTabUpdate, keeping money the operator edited", () => {
  const src = readSrc(POS_TAB);
  const start = src.indexOf("const settleFlow = useSettleFlow({");
  const wiring = src.slice(start, src.indexOf("\n  });", start));
  assert.match(wiring, /onChanged: \(order\) => \{\s*if \(resumedOrder\?\._id === order\._id\) applyTabUpdate\(order, \{ kot: false, keepUnfired: true, keepMoney: moneyEditedSince\(/);
  const apply = src.slice(src.indexOf("const applyTabUpdate"), src.indexOf("const sendToKitchen"));
  assert.ok(src.includes("const applyTabUpdate") && src.includes("const sendToKitchen"), "landmarks");
  // The cart is re-synced from its LATEST value, not a stale closure copy.
  assert.ok(apply.includes("resync(order.items, keepUnfired);"));
  assert.ok(!apply.includes("hydrate("), "no stale-closure rebuild");
  // The operator's own discount and extras survive a refresh they did not ask for.
  assert.match(apply, /if \(!keepMoney\) \{\s*setDiscountRaw\(order\.discount\);\s*setDiscountUnit\(order\.discountKind === "gst" \? "GST" : "₹"\);\s*setExtraCharges\(/);
  // A tab that gained a customer elsewhere gets it here, or Due/Credit dead-ends.
  assert.match(apply, /if \(order\.customerId && customer\?\._id !== order\.customerId\) \{\s*setCustomer\(\{ _id: order\.customerId, name: order\.customerName \} as Customer\);/);
});

test("P11: the popup's notice and its guarded close are wired POS page -> PosModals -> PaymentModal", () => {
  const page = readSrc(POS_PAGE);
  assert.ok(page.includes("paymentNotice={pos.paymentNotice}"));
  assert.ok(page.includes("onPaymentOpenChange={pos.onPaymentOpenChange}"));
  assert.ok(readSrc(POS_MODALS).includes("notice={paymentNotice}"));
  const pos = readSrc(POS_TAB);
  const close = pos.slice(pos.indexOf("const onPaymentOpenChange"), pos.indexOf("const onPaymentOpenChange") + 400);
  assert.ok(pos.includes("const onPaymentOpenChange"), "landmark");
  assert.match(close, /if \(isBusy\) return;\s*if \(!settleFlow\.dismiss\(resumedOrder\?\._id\)\) return;\s*setPaymentOpen\(false\);/);
  // A resumed tab shows its settle's notice; a new sale shows its Pay Now send's
  // (smooth-writes C2, R-a — `: null` was C1's provisional "no Pay Now yet").
  assert.match(pos, /paymentNotice: resumedOrder \? settleFlow\.noticeFor\(resumedOrder\._id\) : send\.payNotice,/);
  assert.ok(!/^\s*setPaymentOpen,\s*$/m.test(pos), "the raw setter is no longer handed out");
});
