// Source pins for Send to Kitchen / Pay Now as ONE confirmed foreground
// request (owner decision 2, 2026-09-28; smooth-writes slice C2). The rules
// are runtime-tested in lib/pos-send.test.ts over counting fake ports; these
// pin the WIRING a refactor could silently undo: the POS sends through the one
// controller, frees the cart only in the confirm, prints the KOT from the
// server's order, locks every editing surface during the flight AND while a
// send is unconfirmed (R-b), and offers only Send again or a confirmed Discard
// (R-d) — in the cart and in the Pay Now popup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readRaw = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readSrc = (rel: string): string => stripComments(readRaw(rel));

const CONTROLLER = "apps/cafe/lib/pos-send.ts";
const HOOK = "apps/cafe/hooks/use-pos-send.ts";
const POS_TAB = "apps/cafe/hooks/use-pos-tab.ts";
const CART_HOOK = "apps/cafe/hooks/use-cart.ts";
const ORDERS_HOOK = "apps/cafe/hooks/use-orders.ts";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const CART_PROPS = "apps/cafe/lib/pos-cart-props.ts";
const CART = "apps/cafe/components/pos/Cart.tsx";
const CART_LINE = "apps/cafe/components/pos/CartLine.tsx";
const CART_NOTES = "apps/cafe/components/pos/CartNotes.tsx";
const GRID = "apps/cafe/components/pos/ProductGrid.tsx";
const HEADER = "apps/cafe/components/pos/PosHeader.tsx";
const OPEN_TABS = "apps/cafe/components/pos/OpenTabsButton.tsx";
const CUSTOMER = "apps/cafe/components/pos/CustomerSearch.tsx";
const MOBILE_BAR = "apps/cafe/components/pos/MobileCartBar.tsx";
const MODAL = "apps/cafe/components/pos/PaymentModal.tsx";
const DISCARD = "apps/cafe/components/pos/SendDiscard.tsx";

const count = (src: string, needle: string) => src.split(needle).length - 1;

/** `src` between two landmarks, both asserted to exist (an absent one would blind the slice). */
function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + 1);
  assert.ok(start >= 0, `landmark missing: ${from}`);
  assert.ok(end > start, `landmark missing after ${from}: ${to}`);
  return src.slice(start, end);
}

test("S1: the controller is pure — no React, no fetch, no timers — and reaches the server through one request call", () => {
  const raw = readRaw(CONTROLLER);
  const specifiers = [...raw.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(specifiers.includes("@pos/shared/order-idem"), "landmark: the controller reuses the shared idempotency rules");
  const allowed = new Set(["@pos/shared/order-idem", "@/lib/pending-writes", "@/types"]);
  assert.deepEqual(specifiers.filter((s) => !allowed.has(s)), [], "no React, no toasts, no hooks, no api-client");
  const src = readSrc(CONTROLLER);
  assert.ok(src.includes("export function createPosSend(ports: PosSendPorts): PosSend {"), "landmark");
  assert.equal(count(src, "await request(key)"), 1, "exactly one POST site, carrying the attempt's key");
  assert.equal(count(src, "ports.mintKey()"), 1, "exactly one place mints a key");
  // R-b: Send again is the frozen request with its key — never rebuilt from the screen.
  assert.ok(src.includes("const key = again ? again.key : ports.mintKey();"));
  assert.ok(src.includes("const request = again ? again.request : job.request;"));
  assert.ok(src.includes("isLocked: () => inFlight || held !== null,"), "an unconfirmed send freezes every edit");
  for (const banned of ["fetch(", "set" + "Timeout(", "set" + "Interval(", "sleep", "window.", "document.", "localStorage"]) {
    assert.ok(!src.includes(banned), `no IO, timers or persistence in the controller: found ${banned}`);
  }
});

test("S2: the hook is a thin shell — one controller per mount, the M1 key minter, useSyncExternalStore, one mount effect, no timers", () => {
  const src = readSrc(HOOK);
  assert.equal(count(src, "createPosSend("), 1, "one controller");
  assert.ok(src.includes("const [send] = useState(() => createPosSend({ mintKey: mintAttemptId, toastUnmounted }));"), "created once, keyed by mintAttemptId");
  // K2: the one effect marks the POS mounted, so an answer after it unmounts is toasted.
  assert.equal(count(src, "useEffect("), 1, "exactly one effect");
  assert.ok(src.includes("useEffect(() => send.mount(), [send]);"), "and it is the mount");
  assert.ok(src.includes('const toastUnmounted = (t: UnmountedToast) => (t.tone === "success" ? toast.success(t.message) : toast.warning(t.message));'), "the toast port");
  assert.ok(src.includes('import { mintAttemptId } from "@/lib/pos-device-id";'));
  assert.ok(src.includes("useSyncExternalStore(send.subscribe, send.getState, send.getState)"));
  assert.ok(src.includes("frozen: state.frozen,"), "the freeze reaches the POS");
  for (const banned of ["set" + "Timeout(", "set" + "Interval(", "randomUUID", "mutateAsync"]) {
    assert.ok(!src.includes(banned), `the hook decides nothing and waits for nothing: found ${banned}`);
  }
});

test("S3: the POS sends through the one controller, and its lock freezes the cart's edits", () => {
  const pos = readSrc(POS_TAB);
  const send = pos.indexOf("const send = usePosSend();");
  const cart = pos.indexOf("} = useCart(send.isLocked);");
  assert.ok(send >= 0 && cart > send, "usePosSend is created before useCart, which takes its lock");
  assert.equal(count(pos, "usePosSend("), 1);
  const hook = readSrc(CART_HOOK);
  assert.ok(hook.includes("export function useCart(isLocked: () => boolean = NEVER_LOCKED): UseCart {"));
  for (const fn of ["const addToCart", "const updateQty", "const removeFromCart"]) {
    const body = between(hook, fn, "}, [isLocked]);");
    assert.ok(body.includes("if (isLocked()) return;"), `${fn} refuses an edit while a send is in flight`);
  }
  assert.ok(hook.includes("if (!isLocked()) setCart([]);"), "clearCart refuses too — a Clear mid-flight would lose lines on a refusal");
});

test("S4: Send to Kitchen frees the cart ONLY in its confirm, prints the KOT from the server's order (M5), and never re-syncs the tab", () => {
  const fn = between(readSrc(POS_TAB), "const sendToKitchen", "const payNow");
  assert.ok(fn.includes("void send.run({"), "one controller run per tap");
  assert.ok(!fn.includes("await "), "the tap never awaits — the controller owns the flight");
  assert.ok(!fn.includes("applyTabUpdate("), "the fire path must not re-hydrate the cart (it dropped lines added during a flight)");
  assert.ok(fn.includes("addItems.mutateAsync({ id: round.id, data: { ...round.data, idemKey } })"), "a round carries the attempt's key");
  assert.ok(fn.includes("createOrder.mutateAsync({ ...create, idemKey })"), "a new order carries the attempt's key");
  assert.ok(fn.includes('scope: round?.id ?? "create",'), "a round's attempt is scoped to its tab");
  const confirm = fn.slice(fn.indexOf("confirm: (order, idemKey) => {"));
  assert.ok(fn.includes("confirm: (order, idemKey) => {"), "landmark: the confirm");
  const printed = confirm.indexOf("print.queueKotRound(order, printed);");
  const toasted = confirm.indexOf("toast.success(kitchenSentMessage(order, round ? printed : null));");
  const freed = confirm.indexOf("if (tabIdRef.current === startedFor) resetOrder();");
  assert.ok(printed >= 0 && toasted > printed && freed > toasted, "print, one toast, then free — only the tab the round started for");
  assert.ok(confirm.includes("const printed = kotRoundOfSend(order, round !== null, idemKey);"), "M5: round 1 for a new order, the key's own round for a round");
  const beforeConfirm = fn.slice(0, fn.indexOf("confirm: (order, idemKey) => {"));
  assert.ok(!beforeConfirm.includes("resetOrder()"), "nothing frees the cart before the server's answer");
  assert.ok(fn.includes("const startedFor = resumedOrder?._id ?? null;"), "the tab is latched at the tap");
});

test("S5: Pay Now sends through the controller with its own key, and prints + frees + offers the table only in the confirm", () => {
  const fn = between(readSrc(POS_TAB), "const confirmPayment", "const enterResume");
  const pay = fn.slice(fn.indexOf("} else {"));
  assert.ok(fn.indexOf("} else {") > 0, "landmark: confirmPayment still branches settle / Pay Now on `} else {`");
  assert.ok(pay.includes("await send.run({"), "one controller run");
  assert.ok(pay.includes('kind: "pay",'));
  assert.ok(pay.includes("request: (idemKey) => createOrder.mutateAsync({ ...sale, idemKey }),"));
  assert.ok(!pay.includes("try {") && !pay.includes("catch"), "the controller owns every failure — no local catch that could free the cart");
  const confirm = pay.slice(pay.indexOf("confirm: (order) => {"));
  assert.ok(pay.includes("confirm: (order) => {"), "landmark: the confirm");
  const order = [
    "print.queueKotRound(order);",
    "print.queueReceipt(order);",
    "freeTable.askToFreeTable(",
    "toast.success(`Order ${order.orderId} placed`);",
    "setPaymentOpen(false);",
    "resetOrder();",
  ].map((n) => {
    const at = confirm.indexOf(n);
    assert.ok(at >= 0, `the Pay Now confirm must contain ${n}`);
    return at;
  });
  assert.deepEqual([...order].sort((a, b) => a - b), order, "KOT, bill, free-table offer, one toast, close, then free — in that order");
  const beforeConfirm = pay.slice(0, pay.indexOf("confirm: (order) => {"));
  for (const early of ["setPaymentOpen(", "resetOrder()", "print."]) {
    assert.ok(!beforeConfirm.includes(early), `nothing happens before the server answers: found ${early}`);
  }
});

test("S6: the lock, the popup spinner (M3), the popup hold (R13) and the notices are wired", () => {
  const pos = readSrc(POS_TAB);
  assert.match(pos, /const isBusy =\s*createOrder\.isPending \|\| addItems\.isPending \|\| settleFlow\.busy \|\| send\.sending !== null \|\| send\.frozen !== null;/, "R-b: every isBusy lock also holds while a send is unconfirmed");
  assert.ok(pos.includes("const paymentBusy = settleFlow.busy || send.sending !== null;"), "M3: in flight only — never the unconfirmed state");
  const page = readSrc(POS_PAGE);
  assert.ok(page.includes("isSubmitting={pos.paymentBusy}"), "the popup spins only while a request flies, so Send again stays tappable");
  assert.ok(!page.includes("isSubmitting={pos.isBusy}"));
  const close = between(pos, "const onPaymentOpenChange", "const requestCloseTab");
  const hold = close.indexOf('if (send.holds("pay")) return discard();');
  assert.ok(hold >= 0 && hold < close.indexOf("if (isBusy) return;"), "an unconfirmed Pay Now closes only as a Discard — before the busy guard, which the freeze holds up");
  assert.ok(pos.includes("paymentNotice: resumedOrder ? settleFlow.noticeFor(resumedOrder._id) : send.payNotice,"), "a Pay Now notice reaches the popup");
  assert.ok(pos.includes('sendingKitchen: send.sending === "kitchen",'));
  assert.ok(pos.includes("kitchenNotice: send.kitchenNotice,"));
  const props = readSrc(CART_PROPS);
  assert.ok(props.includes("sending: pos.sendingKitchen,") && props.includes("sendNotice: pos.kitchenNotice,"));
});

test("S7: a new attempt starts on resetOrder and enterResume (M6), and a late answer is latched to the tab on screen", () => {
  const pos = readSrc(POS_TAB);
  const reset = between(pos, "const resetOrder", "const selectTable");
  assert.ok(reset.includes("tabIdRef.current = null;"));
  const unfreeze = reset.indexOf("send.reset();");
  assert.ok(unfreeze >= 0 && unfreeze < reset.indexOf("clearCart();"), "the attempt is dropped BEFORE clearCart, which the freeze would refuse");
  assert.match(pos, /const discard = \(\) => \{\s*setPaymentOpen\(false\);\s*resetOrder\(\);\s*\};/, "R-d: Discard closes the popup and resets the whole order");
  assert.ok(pos.includes("discardSend: discard,"));
  assert.ok(readSrc(CART_PROPS).includes("onDiscardSend: pos.discardSend,"));
  const resume = between(pos, "const enterResume", "const requestResume");
  assert.ok(resume.includes("send.reset();") && resume.includes("tabIdRef.current = order._id;"));
  const apply = between(pos, "const applyTabUpdate", "const sendToKitchen");
  assert.match(apply, /\) => \{\s*if \(order\._id !== tabIdRef\.current\) return;/, "applyTabUpdate's first line is the tab latch");
  assert.ok(between(pos, "const requestResume", "const confirmResume").includes("if (send.isLocked()) return;"), "no tab opens mid-flight");
});

test("S8: every editing surface is locked during the flight — grid, lines, Clear, notes, charge, header controls", () => {
  const page = readSrc(POS_PAGE);
  assert.match(between(page, "<ProductGrid", "/>"), /disabled=\{pos\.isBusy\}/, "the product grid is inert while a send flies");
  const grid = readSrc(GRID);
  assert.ok(grid.includes('<div className={cn(gridClass, disabled && "opacity-50")} inert={disabled}>'));
  const cart = readSrc(CART);
  assert.match(between(cart, "fresh.map((item) => (", "))"), /disabled=\{isBusy\}/, "unsent lines' steppers lock");
  assert.ok(cart.includes("onClick={onClear} disabled={isBusy}"), "Clear locks");
  assert.ok(cart.includes("trailing={moreMenu} disabled={isBusy} />"), "the note locks");
  assert.ok(cart.includes("disabled={charge === 0 || isBusy}"), "the waive button locks");
  assert.match(between(cart, "value={charge === 0 ? \"\" : charge}", "/>"), /disabled=\{isBusy\}/, "the charge input locks");
  assert.match(between(cart, "onClick={onChargeReset}", ">"), /disabled=\{isBusy\}/, "Undo locks");
  assert.equal(count(readSrc(CART_LINE), "disabled={disabled}"), 3, "both steppers and remove");
  assert.equal(count(readSrc(CART_NOTES), "disabled={disabled}"), 2, "the Add note row and the textarea");
  assert.equal(count(readSrc(HEADER), "disabled={isBusy}"), 5, "KOT reprint, Open tabs, move/assign, table tiles, customer");
  assert.ok(readSrc(OPEN_TABS).includes("disabled={disabled}"), "the Open tabs trigger honours it");
  assert.ok(readSrc(CUSTOMER).includes("disabled={disabled}"), "the customer trigger honours it");
});

test("S9: the cart shows Sending… and, after an unanswered send, the notice with Send again (and only that)", () => {
  const cart = readSrc(CART);
  assert.ok(cart.includes("<WriteNoticePanel notice={sendNotice} />"), "the notice sits in the cart, one place");
  const actions = cart.slice(cart.indexOf("function CartActions"));
  assert.ok(cart.includes("function CartActions"), "landmark");
  assert.ok(actions.includes("Sending…"), "the Send button reads Sending… in flight");
  const again = between(actions, 'if (notice?.action === "send-again") {', "if (resuming) {");
  assert.ok(again.includes('{inFlight || "Send again"}') && again.includes("onClick={onSendToKitchen}"), "Send again re-runs the send");
  assert.match(again, /<Button className=\{POS_CART_CTA_CLASS\} size="lg" disabled=\{sending\}/, "Send again is live while frozen — only a flight disables it");
  assert.ok(again.includes('<SendDiscard kind="kitchen" disabled={sending} onDiscard={onDiscard} />'), "R-d: the cart offers Discard");
  assert.ok(!again.includes("onPayNow") && !again.includes("onSettle"), "nothing else can go out over an unanswered send");
  assert.ok(cart.includes("onDiscard={onDiscardSend}"), "the cart hands CartActions the Discard");
  const bar = readSrc(MOBILE_BAR);
  assert.ok(bar.includes("cartProps.sendNotice.title"), "a closed sheet still says Couldn't confirm");
});

test("S10: the create/round hooks toast once — no success toast (the confirm says it), no toast for an unanswered write (the notice says it)", () => {
  const src = readSrc(ORDERS_HOOK);
  const create = between(src, "export function useCreateOrder", "export function useUpdateOrder");
  const round = between(src, "export function useAddOrderItems", "export function useSettleOrder");
  for (const [name, hook] of [["useCreateOrder", create], ["useAddOrderItems", round]] as const) {
    assert.ok(hook.includes("onError: (err: Error"), `landmark: ${name} still handles errors`);
    assert.ok(!hook.includes("toast.success("), `${name} raises no success toast`);
    assert.match(hook, /if \(toastsFailure\(err\)\) toast\.error\(/, `${name} skips the toast for an uncertain failure`);
  }
  assert.ok(src.includes('const toastsFailure = (err: Error) => classifyFailure(err) !== "uncertain";'));
  // The freed POS must never offer the optimistic row as a tab.
  assert.ok(create.includes("o._id !== OPTIMISTIC_ORDER_ID ? [o] : belongs ? [order] : []"), "onSuccess swaps the optimistic row for the server's order");
});

test("S11 (R-b): the Pay Now popup is frozen while its sale is unconfirmed — mode, amounts, split, customer and the X all refuse", () => {
  const src = readSrc(MODAL);
  assert.ok(src.includes('const frozen = notice?.action === "send-again";'), "frozen = an unconfirmed Pay Now");
  assert.ok(src.includes("const locked = isSubmitting || frozen;"));
  assert.equal(count(src, "disabled={isSubmitting}"), 1, "only Discard is gated on the flight alone — no input is");
  assert.equal(count(src, "disabled={locked}"), 4, "the mode buttons, the amount, the split fields and the customer picker");
  assert.ok(src.includes("<CustomerSearch value={customer} onChange={onSelectCustomer} disabled={locked} />"), "the customer picker");
  const guard = between(src, "const openChange = (next: boolean) => {", "onOpenChange(next);");
  assert.ok(guard.includes("if (!next && isSubmitting) return;") && guard.includes("if (!next && frozen) return;"), "X / Escape / outside tap cannot close a frozen sale — only its Discard");
  // The main button stays Send again (M3: isSubmitting is the flight only).
  assert.ok(src.includes('action === "send-again" ? "Send again"'), "landmark: the Send again label");
  assert.ok(src.includes('{frozen && <SendDiscard kind="pay" disabled={isSubmitting} onDiscard={() => onOpenChange(false)} />}'), "R-d: the popup offers Discard");
});

test("S12 (R-d): Discard confirms first, in plain English, through the shared ConfirmDialog", () => {
  const src = readSrc(DISCARD);
  assert.ok(src.includes('import { ConfirmDialog } from "@/components/shared/ConfirmDialog";'), "reuses the shared confirm, no new dialog");
  assert.ok(src.includes('description={kind === "pay" ? SEND_DISCARD_PAY : SEND_DISCARD_KITCHEN}'));
  assert.match(src, /onConfirm=\{\(\) => \{\s*setOpen\(false\);\s*onDiscard\(\);\s*\}\}/, "Discard runs only from the confirm");
  assert.equal(count(src, "onDiscard("), 1, "and nowhere else");
  assert.match(src, /onClick=\{\(\) => setOpen\(true\)\}/, "the button only opens the confirm");
  assert.ok(src.includes("className={POS_CART_CTA_CLASS}"), "a touch-sized CTA on both surfaces");
  const copy = readSrc(CONTROLLER);
  assert.ok(copy.includes('"The order may already have reached the kitchen. Check Open tabs before sending it again."'));
  assert.ok(copy.includes('"The sale may already be saved. Check Orders before taking payment again."'));
});
