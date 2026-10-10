// Runtime rules of the settle flow (lib/settle-flow.ts) over fake ports that
// COUNT every POST and GET. The owner's rule (decision 1, 2026-09-28): one
// POST per operator tap, never an automatic resend, and once a settle went
// unanswered (or a read of it failed) the tab's next tap is a Check — ONE GET.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@pos/shared/api-client";
import { SETTLE_BILL_SAVING, SETTLE_STILL_UNREACHABLE, SETTLE_UNCONFIRMED, SIGNED_OUT_CHECK, type WriteNotice } from "./pending-writes";
import { BILL_NUMBER_WAIT_MS, createSettleFlow, type SettleFlow } from "./settle-flow";
import type { Order, SettleOrderInput } from "@/types";

const TAB_ID = "t1";
const TOTAL = 540;
const http = (status: number, message = `HTTP ${status}`) => new ApiError(message, "http", status);
const TIMEOUT = new ApiError("signal timed out", "timeout", null);
const OFFLINE = new ApiError("Failed to fetch", "network", null);
const CONFLICT = http(409, "Order already settled");
const MISSING = http(404, "Order not found");

function order(over: Partial<Order> = {}): Order {
  return { _id: TAB_ID, orderId: "ORD-20260928-001", status: "Pending", payment: "Unpaid", paidAmount: 0, total: TOTAL, items: [], ...over } as Order;
}
const PENDING = order();
const GREW = order({ total: TOTAL + 20 });
const OURS = order({ status: "Completed", payment: "Cash", paidAmount: TOTAL });
const BILL_NO = 17;
const OURS_NUMBERED = order({ status: "Completed", payment: "Cash", paidAmount: TOTAL, billNumber: BILL_NO });
const SIGNED_OUT_READ = http(401, "Not authenticated");
const FORBIDDEN_READ = http(403, "Forbidden");
const OTHER = order({ status: "Completed", payment: "Online", paidAmount: TOTAL });
const PAYLOAD = { payment: "Cash", expectedTotal: TOTAL, expectedVoids: 0 } as SettleOrderInput;

/** One scripted answer: an order resolves, an Error rejects, a promise is awaited. */
type Reply = Order | Error | Promise<Order>;

function deferred() {
  let resolve!: (o: Order) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Order>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** `numbered` = the cafe prints bill numbers (the billNumbered port). */
function harness(posts: Reply[] = [], gets: Reply[] = [], numbered = false) {
  const log = {
    posts: 0,
    gets: 0,
    settled: [] as Order[],
    changed: [] as Order[],
    finished: [] as (Order | null)[],
    toastSettled: [] as Order[],
    toastUnmounted: [] as WriteNotice[],
    invalidated: 0,
  };
  // The device's own clock, moved by hand (the now port).
  const clock = { t: 0 };
  // An unscripted call rejects; the counts are what every test asserts.
  const answer = (queue: Reply[]): Promise<Order> => {
    const r = queue.shift();
    if (r === undefined) return Promise.reject(new Error("unscripted call"));
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  const flow: SettleFlow = createSettleFlow({
    send: (id, payload) => {
      assert.equal(id, TAB_ID);
      assert.equal(payload, PAYLOAD);
      log.posts += 1;
      return answer(posts);
    },
    read: (id) => {
      assert.equal(id, TAB_ID);
      log.gets += 1;
      return answer(gets);
    },
    handlers: {
      onSettled: (o) => log.settled.push(o),
      onChanged: (o) => log.changed.push(o),
      onFinished: (o) => log.finished.push(o),
    },
    toastSettled: (o) => log.toastSettled.push(o),
    toastUnmounted: (n) => log.toastUnmounted.push(n),
    invalidate: () => {
      log.invalidated += 1;
    },
    billNumbered: () => numbered,
    now: () => clock.t,
  });
  const unmount = flow.mount();
  const tap = () => flow.submit(PENDING, PAYLOAD);
  return { flow, log, tap, unmount, posts, gets, clock };
}

const kindOf = (flow: SettleFlow) => flow.noticeFor(TAB_ID)?.kind ?? null;

test("1: the first answer settles — onSettled once, one POST, no GET, no notice", async () => {
  const h = harness([OURS]);
  await h.tap();
  assert.deepEqual(h.log.settled, [OURS]);
  assert.equal(h.log.posts, 1);
  assert.equal(h.log.gets, 0);
  assert.equal(h.flow.noticeFor(TAB_ID), null);
  assert.equal(h.flow.busy(), false);
  assert.equal(h.log.toastSettled.length, 0, "the mutation's own success toast says it — not the flow");
});

test("2: a timeout is 'Couldn't confirm' and the next tap is a Check — one GET, never a second POST", async () => {
  const h = harness([TIMEOUT], [OURS]);
  await h.tap();
  const n = h.flow.noticeFor(TAB_ID);
  assert.equal(n?.kind, "uncertain");
  assert.equal(n?.title, "Couldn't confirm");
  assert.equal(n?.message, SETTLE_UNCONFIRMED);
  assert.equal(n?.action, "check");
  await h.tap();
  assert.equal(h.log.posts, 1, "a Check never POSTs");
  assert.equal(h.log.gets, 1);
  assert.deepEqual(h.log.settled, [OURS], "the read found our settle");
  assert.deepEqual(h.log.toastSettled, [OURS], "and says so once, since the POST was never answered");
  assert.equal(h.flow.noticeFor(TAB_ID), null);
  assert.equal(h.log.invalidated, 1);
});

test("2b: a Check that finds the tab still Pending says 'not settled yet', and the next tap is a POST again", async () => {
  const h = harness([TIMEOUT, OURS], [PENDING]);
  await h.tap();
  await h.tap();
  assert.equal(kindOf(h.flow), "open");
  assert.equal(h.log.settled.length, 0);
  await h.tap();
  assert.equal(h.log.posts, 2);
  assert.equal(h.log.gets, 1);
  assert.deepEqual(h.log.settled, [OURS]);
});

test("2c: a Check whose read fails stays a Check — 'still can't reach', and the tap after is another GET", async () => {
  const h = harness([TIMEOUT], [OFFLINE, OURS]);
  await h.tap();
  await h.tap();
  assert.equal(h.flow.noticeFor(TAB_ID)?.message, SETTLE_STILL_UNREACHABLE);
  await h.tap();
  assert.equal(h.log.posts, 1);
  assert.equal(h.log.gets, 2);
  assert.deepEqual(h.log.settled, [OURS]);
});

test("3 (D1): a 409 whose read FAILS after a Check read 'open' — the next tap is a GET, never a POST, and keeps the intents", async () => {
  const h = harness([TIMEOUT, CONFLICT], [PENDING, OFFLINE, OURS]);
  await h.tap(); // timeout
  await h.tap(); // Check: still open
  await h.tap(); // POST -> 409 -> the read fails
  assert.equal(h.log.posts, 2);
  const n = h.flow.noticeFor(TAB_ID);
  assert.equal(n?.kind, "uncertain");
  assert.equal(n?.title, "Couldn't confirm");
  await h.tap();
  assert.equal(h.log.posts, 2, "the tap after a failed read must not send a new settle");
  assert.equal(h.log.gets, 3);
  assert.deepEqual(h.log.settled, [OURS], "the first attempt's intent was kept, so the read adopts it");
});

test("4 (D1b): a 409 with NO prior attempt whose read fails — the next tap is a GET, read against the echo it was made with", async () => {
  const h = harness([CONFLICT], [OFFLINE, GREW]);
  await h.tap();
  assert.equal(h.log.posts, 1);
  assert.equal(h.log.gets, 1);
  assert.equal(kindOf(h.flow), "refused", "no attempt of ours is unanswered, so the server's words stand");
  await h.tap();
  assert.equal(h.log.posts, 1, "never a POST after a failed read");
  assert.equal(h.log.gets, 2);
  assert.deepEqual(h.log.changed, [GREW], "the kept echo (total 540) tells a grown tab");
  assert.equal(kindOf(h.flow), "changed");
});

test("5 (D2): a 404 on the POST is 'gone', and closing it ends the tab — onFinished(null) once", async () => {
  const h = harness([MISSING]);
  await h.tap();
  assert.equal(kindOf(h.flow), "gone");
  assert.equal(h.flow.noticeFor(TAB_ID)?.action, "close");
  assert.equal(h.flow.dismiss(TAB_ID), true);
  assert.deepEqual(h.log.finished, [null]);
  assert.equal(h.flow.noticeFor(TAB_ID), null);
  assert.equal(h.flow.dismiss(TAB_ID), true);
  assert.deepEqual(h.log.finished, [null], "once");
});

test("5b (D2): a 404 on a Check's read, or on a 409's read, is 'gone' too — onFinished(null) once", async () => {
  const check = harness([TIMEOUT], [MISSING]);
  await check.tap();
  await check.tap();
  assert.equal(kindOf(check.flow), "gone");
  assert.equal(check.flow.dismiss(TAB_ID), true);
  assert.deepEqual(check.log.finished, [null]);
  const conflict = harness([CONFLICT], [MISSING]);
  await conflict.tap();
  assert.equal(kindOf(conflict.flow), "gone");
  assert.equal(conflict.flow.dismiss(TAB_ID), true);
  assert.deepEqual(conflict.log.finished, [null]);
});

test("6: settled on another device — closing it ends the tab with the order read", async () => {
  const h = harness([TIMEOUT], [OTHER]);
  await h.tap();
  await h.tap();
  assert.equal(kindOf(h.flow), "elsewhere");
  assert.equal(h.log.settled.length, 0);
  assert.equal(h.flow.dismiss(TAB_ID), true);
  assert.deepEqual(h.log.finished, [OTHER]);
  // With nothing of ours unanswered, even a matching Completed order is someone else's.
  const direct = harness([CONFLICT], [OURS]);
  await direct.tap();
  assert.equal(kindOf(direct.flow), "elsewhere");
  direct.flow.dismiss(TAB_ID);
  assert.deepEqual(direct.log.finished, [OURS]);
  assert.equal(direct.log.settled.length, 0);
});

test("6b: the bill changed elsewhere — onChanged with the fresh tab, and the old intents are forgotten", async () => {
  const h = harness([TIMEOUT, CONFLICT], [GREW, OURS]);
  await h.tap();
  await h.tap();
  assert.deepEqual(h.log.changed, [GREW]);
  assert.equal(kindOf(h.flow), "changed");
  assert.equal(h.flow.dismiss(TAB_ID), true);
  assert.equal(h.flow.noticeFor(TAB_ID), null, "a non-finished notice is cleared on close");
  assert.equal(h.log.finished.length, 0);
  await h.tap();
  assert.equal(h.log.posts, 2, "the next tap is a POST");
  assert.equal(h.log.settled.length, 0, "a forgotten intent can never adopt a Completed order");
  assert.equal(kindOf(h.flow), "elsewhere");
});

test("7: a 409 after an unanswered attempt whose read shows our settle adopts it — exactly one onSettled", async () => {
  const h = harness([TIMEOUT, CONFLICT], [PENDING, OURS]);
  await h.tap();
  await h.tap();
  await h.tap();
  assert.equal(h.log.posts, 2);
  assert.equal(h.log.gets, 2);
  assert.deepEqual(h.log.settled, [OURS]);
  assert.deepEqual(h.log.toastSettled, [OURS]);
  assert.equal(h.flow.noticeFor(TAB_ID), null);
});

test("8: a double tap in flight sends one POST; close is refused while busy; 'Couldn't confirm' survives a close", async () => {
  const post = deferred();
  const h = harness([post.promise], [OURS]);
  let notified = 0;
  h.flow.subscribe(() => {
    notified += 1;
  });
  const first = h.tap();
  const second = h.tap();
  assert.equal(h.log.posts, 1, "the fence is synchronous");
  assert.equal(h.flow.busy(), true);
  assert.equal(h.flow.getState().busy, true);
  assert.equal(h.flow.dismiss(TAB_ID), false);
  assert.equal(h.flow.dismiss(), false);
  post.reject(TIMEOUT);
  await Promise.all([first, second]);
  assert.equal(h.flow.busy(), false);
  assert.ok(notified > 0, "subscribers hear every change");
  const n = h.flow.noticeFor(TAB_ID);
  assert.equal(n?.kind, "uncertain");
  assert.equal(h.flow.noticeFor(TAB_ID), n, "the same object while unchanged (PaymentModal's memo)");
  assert.equal(h.flow.dismiss(TAB_ID), true);
  assert.equal(h.flow.noticeFor(TAB_ID), n, "reopening the popup still shows Check");
  assert.equal(h.log.finished.length, 0);
  await h.tap();
  assert.equal(h.log.posts, 1);
  assert.equal(h.log.gets, 1);
});

test("9: unmounted mid-flight — the outcome is toasted once and no state changes", async () => {
  const post = deferred();
  const h = harness([post.promise]);
  let notified = 0;
  h.flow.subscribe(() => {
    notified += 1;
  });
  const pending = h.tap();
  h.unmount();
  const before = h.flow.getState();
  const heard = notified;
  post.reject(TIMEOUT);
  await pending;
  assert.equal(h.log.toastUnmounted.length, 1);
  assert.equal(h.log.toastUnmounted[0].kind, "uncertain");
  assert.equal(h.flow.getState(), before, "no state update after unmount");
  assert.equal(notified, heard);
});

test("K1: a numbering cafe's Check that finds OUR settle without its bill number is 'still saving' — nothing printed, the next tap is another Check", async () => {
  const h = harness([TIMEOUT], [OURS, OURS_NUMBERED], true);
  await h.tap(); // timeout
  await h.tap(); // Check: ours, but the bill number is not on it yet
  const n = h.flow.noticeFor(TAB_ID);
  assert.equal(n?.kind, "uncertain");
  assert.equal(n?.message, SETTLE_BILL_SAVING);
  assert.equal(n?.action, "check", "the button says Check");
  assert.equal(h.log.settled.length, 0, "no onSettled — so no unnumbered bill prints");
  assert.equal(h.log.toastSettled.length, 0);
  assert.equal(h.flow.dismiss(TAB_ID), true, "the popup still closes");
  assert.equal(h.flow.noticeFor(TAB_ID), n, "and reopening it still offers Check");
  await h.tap(); // Check again: now numbered
  assert.equal(h.log.posts, 1, "never a second POST");
  assert.equal(h.log.gets, 2, "the tap after 'still saving' is one more GET");
  assert.deepEqual(h.log.settled, [OURS_NUMBERED], "the numbered order is adopted, once");
  assert.deepEqual(h.log.toastSettled, [OURS_NUMBERED]);
  assert.equal(h.flow.noticeFor(TAB_ID), null);
});

test("K1b: the same rule on a 409's read — our unnumbered settle waits; a numbered one is adopted at once", async () => {
  const waiting = harness([TIMEOUT, CONFLICT], [PENDING, OURS, OURS_NUMBERED], true);
  await waiting.tap(); // timeout
  await waiting.tap(); // Check: still open
  await waiting.tap(); // POST -> 409 -> read: ours, unnumbered
  assert.equal(waiting.flow.noticeFor(TAB_ID)?.message, SETTLE_BILL_SAVING);
  assert.equal(waiting.log.settled.length, 0);
  await waiting.tap();
  assert.equal(waiting.log.posts, 2, "the tap after 'still saving' is a GET, never a POST");
  assert.deepEqual(waiting.log.settled, [OURS_NUMBERED]);
  const numbered = harness([TIMEOUT], [OURS_NUMBERED], true);
  await numbered.tap();
  await numbered.tap();
  assert.deepEqual(numbered.log.settled, [OURS_NUMBERED], "a numbered bill is adopted on the first Check");
});

test("K1c: a cafe that does not number bills adopts our settle without a bill number, as before", async () => {
  const h = harness([TIMEOUT], [OURS], false);
  await h.tap();
  await h.tap();
  assert.deepEqual(h.log.settled, [OURS]);
  assert.equal(h.flow.noticeFor(TAB_ID), null);
});

test("K4c: after a FAILED read the notice's button is Check (the next tap is a GET) — only a 'gone' notice says Close", async () => {
  // A 409 with nothing of ours unanswered, then the read fails: "refused" words, but a Check button.
  const conflict = harness([CONFLICT], [OFFLINE, PENDING]);
  await conflict.tap();
  assert.equal(kindOf(conflict.flow), "refused");
  assert.equal(conflict.flow.noticeFor(TAB_ID)?.action, "check");
  // Signed out on a Check's read: still a Check next, and the words say so.
  const signedOut = harness([TIMEOUT], [SIGNED_OUT_READ, OURS]);
  await signedOut.tap();
  await signedOut.tap();
  const n = signedOut.flow.noticeFor(TAB_ID);
  assert.equal(n?.message, SIGNED_OUT_CHECK);
  assert.equal(n?.action, "check");
  assert.equal(signedOut.flow.dismiss(TAB_ID), true);
  assert.equal(signedOut.flow.noticeFor(TAB_ID), n, "a Check notice survives a close, so the reopened button still says Check");
  await signedOut.tap();
  assert.equal(signedOut.log.posts, 1);
  assert.equal(signedOut.log.gets, 2);
  assert.deepEqual(signedOut.log.settled, [OURS]);
  // A read that finds the tab gone still ends it.
  const gone = harness([TIMEOUT], [MISSING]);
  await gone.tap();
  await gone.tap();
  assert.equal(gone.flow.noticeFor(TAB_ID)?.action, "close");
});

test("K1 wait: 'still saving' lasts BILL_NUMBER_WAIT_MS from the FIRST sight, then our settle is adopted as stored — one onSettled", async () => {
  assert.equal(BILL_NUMBER_WAIT_MS, 30 * 1000);
  const h = harness([TIMEOUT], [OURS, OURS, OURS], true);
  await h.tap(); // timeout
  await h.tap(); // first sight at t=0
  assert.equal(h.flow.noticeFor(TAB_ID)?.message, SETTLE_BILL_SAVING);
  h.clock.t = BILL_NUMBER_WAIT_MS - 1;
  await h.tap();
  assert.equal(h.flow.noticeFor(TAB_ID)?.message, SETTLE_BILL_SAVING, "just inside the wait: still saving");
  assert.equal(h.log.settled.length, 0, "nothing printed yet");
  h.clock.t = BILL_NUMBER_WAIT_MS;
  await h.tap();
  assert.deepEqual(h.log.settled, [OURS], "the wait is over: adopt, so the bill prints as the record holds it");
  assert.deepEqual(h.log.toastSettled, [OURS]);
  assert.equal(h.flow.noticeFor(TAB_ID), null);
  assert.equal(h.log.posts, 1);
  assert.equal(h.log.gets, 3);
});

test("K1 wait: a failed read does not restart the wait — it counts from the first sight", async () => {
  const h = harness([TIMEOUT], [OURS, OFFLINE, OURS], true);
  await h.tap();
  await h.tap(); // first sight at t=0
  h.clock.t = BILL_NUMBER_WAIT_MS / 2;
  await h.tap(); // the read fails
  assert.equal(h.flow.noticeFor(TAB_ID)?.message, SETTLE_STILL_UNREACHABLE);
  h.clock.t = BILL_NUMBER_WAIT_MS;
  await h.tap();
  assert.deepEqual(h.log.settled, [OURS]);
});

test("K1 wait: the first sight is forgotten once a read says anything else — a later unnumbered sight waits again", async () => {
  const h = harness([TIMEOUT, TIMEOUT], [OURS, PENDING, OURS, OURS], true);
  await h.tap(); // timeout
  await h.tap(); // first sight at t=0: still saving
  h.clock.t = BILL_NUMBER_WAIT_MS / 2;
  await h.tap(); // Check: still open — the record is cleared
  assert.equal(kindOf(h.flow), "open");
  h.clock.t = BILL_NUMBER_WAIT_MS * 2;
  await h.tap(); // POST: timeout
  await h.tap(); // Check: unnumbered again — a NEW first sight, so it waits
  assert.equal(h.flow.noticeFor(TAB_ID)?.message, SETTLE_BILL_SAVING, "a stale first sight must not adopt at once");
  assert.equal(h.log.settled.length, 0);
  h.clock.t = BILL_NUMBER_WAIT_MS * 3;
  await h.tap();
  assert.deepEqual(h.log.settled, [OURS], "exactly one onSettled");
});

test("K1 wait: a numbered read is adopted at once, wherever the wait stands", async () => {
  const h = harness([TIMEOUT], [OURS, OURS_NUMBERED], true);
  await h.tap();
  await h.tap(); // first sight at t=0
  h.clock.t = 1;
  await h.tap();
  assert.deepEqual(h.log.settled, [OURS_NUMBERED]);
});

test("signed out on a Check's read (401 or 403): its own words, and the next tap is still a Check", async () => {
  for (const failure of [SIGNED_OUT_READ, FORBIDDEN_READ]) {
    const h = harness([TIMEOUT], [failure, OURS]);
    await h.tap();
    await h.tap();
    const n = h.flow.noticeFor(TAB_ID);
    assert.equal(n?.message, SIGNED_OUT_CHECK, String(failure.status));
    assert.equal(n?.action, "check");
    await h.tap();
    assert.equal(h.log.posts, 1);
    assert.deepEqual(h.log.settled, [OURS]);
  }
});

test("K1 wait: a read that finds the tab gone forgets the first sight too", async () => {
  const h = harness([TIMEOUT, TIMEOUT], [OURS, MISSING, OURS, OURS], true);
  await h.tap(); // timeout
  await h.tap(); // first sight at t=0
  await h.tap(); // 404: gone
  assert.equal(kindOf(h.flow), "gone");
  h.flow.dismiss(TAB_ID);
  h.clock.t = BILL_NUMBER_WAIT_MS;
  await h.tap(); // a new POST: timeout
  await h.tap(); // unnumbered again: a new first sight, so it waits
  assert.equal(h.flow.noticeFor(TAB_ID)?.message, SETTLE_BILL_SAVING);
  assert.equal(h.log.settled.length, 0);
});

// ── S10: a paid GST bill is also still being numbered until it holds its invoice serial ──

const GST_SNAPSHOT = { gstMode: "exclusive", gstRate: 5, gstAmount: 5, total: TOTAL } as const;
const OURS_GST = order({ status: "Completed", payment: "Cash", paidAmount: TOTAL, ...GST_SNAPSHOT });
const OURS_GST_INVOICED = order({ status: "Completed", payment: "Cash", paidAmount: TOTAL, ...GST_SNAPSHOT, invoiceNumber: 12, invoiceFy: 2026 });

test("S10 K1: a GST bill that reads back without its invoice waits even when the cafe prints NO bill numbers (billNumbered false)", async () => {
  const h = harness([TIMEOUT], [OURS_GST, OURS_GST_INVOICED], false);
  await h.tap(); // timeout
  await h.tap(); // Check: ours, GST, no invoice serial yet
  const n = h.flow.noticeFor(TAB_ID);
  assert.equal(n?.kind, "uncertain");
  assert.equal(n?.message, SETTLE_BILL_SAVING, "the same 'still saving' notice the bill number gives");
  assert.equal(n?.action, "check");
  assert.equal(h.log.settled.length, 0, "no onSettled, so no bill prints without its serial");
  assert.equal(h.log.toastSettled.length, 0);
  await h.tap(); // Check again: now invoiced
  assert.equal(h.log.posts, 1, "never a second POST");
  assert.deepEqual(h.log.settled, [OURS_GST_INVOICED]);
  assert.equal(h.flow.noticeFor(TAB_ID), null);
});

test("S10 K1: the GST wait ends at BILL_NUMBER_WAIT_MS from the FIRST sight, then the bill is adopted as stored (one onSettled)", async () => {
  const h = harness([TIMEOUT], [OURS_GST, OURS_GST, OURS_GST], false);
  await h.tap(); // timeout
  await h.tap(); // first sight at t=0
  h.clock.t = BILL_NUMBER_WAIT_MS - 1;
  await h.tap();
  assert.equal(h.flow.noticeFor(TAB_ID)?.message, SETTLE_BILL_SAVING, "one millisecond short: still waiting");
  assert.equal(h.log.settled.length, 0);
  h.clock.t = BILL_NUMBER_WAIT_MS;
  await h.tap();
  assert.deepEqual(h.log.settled, [OURS_GST], "adopted as stored (numbering failed for good)");
  assert.equal(h.flow.noticeFor(TAB_ID), null);
});

test("S10 K1: a non-GST bill with billNumbered false never waits, in the same harness that makes a GST bill wait", async () => {
  const plainBill = harness([TIMEOUT], [OURS], false);
  await plainBill.tap();
  await plainBill.tap();
  assert.deepEqual(plainBill.log.settled, [OURS], "adopted on the first Check");
  assert.equal(plainBill.flow.noticeFor(TAB_ID), null);
  // Landmark: the GST twin of the very same order DOES wait, so the adoption above is the GST rule and not a dead wait.
  const gstBill = harness([TIMEOUT], [OURS_GST], false);
  await gstBill.tap();
  await gstBill.tap();
  assert.equal(gstBill.log.settled.length, 0);
});

test("S10 K1: a GST bill that already holds its invoice is adopted at once when bill numbers are off", async () => {
  const h = harness([TIMEOUT], [OURS_GST_INVOICED], false);
  await h.tap();
  await h.tap();
  assert.deepEqual(h.log.settled, [OURS_GST_INVOICED]);
  assert.equal(h.flow.noticeFor(TAB_ID), null);
  assert.equal(h.log.gets, 1);
});

test("S10 K1: in a numbering cafe a GST bill waits for BOTH — the invoice alone is not enough, nor the bill number alone", async () => {
  const invoiceOnly = harness([TIMEOUT], [OURS_GST_INVOICED, { ...OURS_GST_INVOICED, billNumber: BILL_NO } as Order], true);
  await invoiceOnly.tap();
  await invoiceOnly.tap();
  assert.equal(invoiceOnly.flow.noticeFor(TAB_ID)?.message, SETTLE_BILL_SAVING, "invoice held, daily number missing");
  assert.equal(invoiceOnly.log.settled.length, 0);
  await invoiceOnly.tap();
  assert.equal(invoiceOnly.log.settled.length, 1, "landmark: it is adopted once both are held");

  const billOnly = harness([TIMEOUT], [{ ...OURS_GST, billNumber: BILL_NO } as Order], true);
  await billOnly.tap();
  await billOnly.tap();
  assert.equal(billOnly.flow.noticeFor(TAB_ID)?.message, SETTLE_BILL_SAVING, "daily number held, invoice missing");
  assert.equal(billOnly.log.settled.length, 0);
});
