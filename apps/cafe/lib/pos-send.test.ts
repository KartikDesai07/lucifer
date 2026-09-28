// Runtime rules of Send to Kitchen / Pay Now (lib/pos-send.ts) over fake ports
// that COUNT every POST. The owner's rule (2026-09-28): one foreground request
// per tap; the cart is freed only on the server's answer; after an unanswered
// send the POS is FROZEN (no edit can change what the kept key replays) and the
// only ways on are Send again — the frozen request, byte for byte, with the
// same key; the server's replay is the check (R4) — or Discard. A definite
// refusal ends it. No timers, no automatic resend.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@pos/shared/api-client";
import { IDEM_KEY_MISMATCH_ERROR, IDEM_REPLAY_CANCELLED_ERROR } from "@pos/shared/order-idem";
import { idemKeySchema } from "@pos/shared/schemas/order.schema";
import { mintAttemptId } from "./pos-device-id";
import {
  createPosSend,
  kotRoundOfSend,
  SEND_DONE_AWAY_KITCHEN,
  SEND_DONE_AWAY_PAY,
  SEND_LOST_KITCHEN,
  SEND_LOST_PAY,
  SEND_SIGNED_OUT,
  SEND_STILL_UNREACHABLE,
  SEND_UNCONFIRMED_KITCHEN,
  SEND_UNCONFIRMED_PAY,
  SEND_UNCONFIRMED_UNKEYED_KITCHEN,
  SEND_UNCONFIRMED_UNKEYED_PAY,
  type PosSend,
  type SendJob,
  type SendKind,
  type UnmountedToast,
} from "./pos-send";
import type { Order } from "@/types";

const http = (status: number, message = `HTTP ${status}`) => new ApiError(message, "http", status);
const TIMEOUT = new ApiError("The server took too long to answer.", "timeout", null);
const OFFLINE = new ApiError("Could not reach the server.", "network", null);
const SERVER_DOWN = http(503);
const BAD_REQUEST = http(400, "Variation no longer exists");
const SIGNED_OUT = http(401, "Unauthorized");
const FORBIDDEN = http(403, "Forbidden");
const STAMPS = http(409, "Not enough stamps");
const MISMATCH = http(409, IDEM_KEY_MISMATCH_ERROR);
const CANCELLED = http(409, IDEM_REPLAY_CANCELLED_ERROR);
const DEFINITE = [BAD_REQUEST, SIGNED_OUT, FORBIDDEN, http(404), STAMPS, MISMATCH, CANCELLED];
/** K3: the routes check the sign-in BEFORE the replay, so a 401/403 on Send again proves nothing. */
const AUTH = [SIGNED_OUT, FORBIDDEN];
const REFUSALS = DEFINITE.filter((f) => !AUTH.includes(f));

function order(over: Partial<Order> = {}): Order {
  return { _id: "tab1", orderId: "ORD-20260929-001", status: "Pending", kotRounds: 1, items: [], ...over } as Order;
}
const PLACED = order();
const BODY = { items: [{ productId: "p1", qty: 1 }], total: 100 };

type Reply = Order | Error | Promise<Order>;
type Body = Record<string, unknown>;

function deferred() {
  let resolve!: (o: Order) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<Order>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A controller whose keys are K1, K2, … (or none); every POST logs the body it carried. */
function harness(mint: () => string | undefined = counterKeys()) {
  const log = {
    posts: [] as { job: string; key: string | undefined; body: string }[],
    confirmed: [] as { job: string; order: Order; key: string | undefined }[],
    toasts: [] as UnmountedToast[],
  };
  const send: PosSend = createPosSend({ mintKey: mint, toastUnmounted: (t) => log.toasts.push(t) });
  const unmount = send.mount();
  const job = (name: string, replies: Reply[], over: Partial<SendJob> = {}, body: Body = BODY): SendJob => ({
    kind: "kitchen",
    scope: "create",
    request: (key) => {
      log.posts.push({ job: name, key, body: JSON.stringify({ ...body, idemKey: key }) });
      const r = replies.shift();
      if (r === undefined) return Promise.reject(new Error("unscripted POST"));
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    },
    confirm: (o, key) => log.confirmed.push({ job: name, order: o, key }),
    ...over,
  });
  return { send, log, job, unmount };
}

function counterKeys() {
  let n = 0;
  return () => `K${++n}`;
}

const IDLE = { sending: null, frozen: null, notice: null };
const noticeOf = (send: PosSend, kind: SendKind) => {
  const n = send.getState().notice;
  return n && n.job === kind ? n.notice : null;
};

test("success: one POST carrying a key, confirm exactly once with the SERVER's order, then idle and unlocked", async () => {
  const { send, log, job } = harness();
  await send.run(job("a", [PLACED]));
  assert.deepEqual(log.posts.map((p) => [p.job, p.key]), [["a", "K1"]]);
  assert.equal(log.confirmed.length, 1);
  assert.equal(log.confirmed[0].order, PLACED, "confirm gets the order the server answered with");
  assert.equal(log.confirmed[0].key, "K1");
  assert.deepEqual(send.getState(), IDLE);
  assert.equal(send.isLocked(), false);
});

test("the cart is freed only on the answer: nothing confirms while the POST is in flight, and the lock is up", async () => {
  const { send, log, job } = harness();
  const d = deferred();
  const flight = send.run(job("a", [d.promise]));
  assert.equal(send.isLocked(), true, "locked synchronously at the tap");
  assert.equal(send.getState().sending, "kitchen", "the button reads Sending…");
  assert.equal(log.confirmed.length, 0, "never freed before the server answers");
  d.resolve(PLACED);
  await flight;
  assert.equal(log.confirmed.length, 1);
  assert.equal(send.isLocked(), false);
});

test("a double tap sends ONE request (the rendered busy flag lands a macrotask late)", async () => {
  const { send, log, job } = harness();
  const d = deferred();
  const first = send.run(job("a", [d.promise]));
  await send.run(job("b", [PLACED]));
  await send.run(job("c", [PLACED]));
  assert.equal(log.posts.length, 1, "the second and third taps sent nothing");
  d.resolve(PLACED);
  await first;
  assert.equal(log.confirmed.length, 1);
});

test("a definite failure (any 4xx, a 409, a 401) keeps the cart: no confirm, no notice, no freeze, and the next send gets a new key", async () => {
  for (const failure of DEFINITE) {
    const { send, log, job } = harness();
    await send.run(job("a", [failure]));
    assert.equal(log.confirmed.length, 0, "nothing freed");
    assert.deepEqual(send.getState(), IDLE, `no notice for ${failure.message} — the hook's toast says it`);
    assert.equal(send.isLocked(), false, "the operator can fix it and send");
    await send.run(job("b", [PLACED]));
    assert.deepEqual(log.posts.map((p) => p.key), ["K1", "K2"], "a refused request spent nothing: a fresh attempt");
  }
});

test("an uncertain failure (timeout, offline, 5xx) shows Couldn't confirm with Send again — only the notice, nothing freed", async () => {
  for (const failure of [TIMEOUT, OFFLINE, SERVER_DOWN, http(408), http(429)]) {
    const { send, log, job } = harness();
    await send.run(job("a", [failure]));
    const notice = noticeOf(send, "kitchen");
    assert.ok(notice, `a notice for ${failure.message}`);
    assert.equal(notice.kind, "uncertain");
    assert.equal(notice.title, "Couldn't confirm");
    assert.equal(notice.action, "send-again");
    assert.equal(notice.message, SEND_UNCONFIRMED_KITCHEN);
    assert.equal(log.confirmed.length, 0);
  }
});

test("R-b (1): while a send is unconfirmed the POS is FROZEN — every edit's lock is up, though nothing is in flight", async () => {
  const { send, job } = harness();
  await send.run(job("a", [TIMEOUT]));
  assert.equal(send.getState().sending, null, "nothing in flight — the Send again button is live");
  assert.equal(send.getState().frozen, "kitchen", "the cart is frozen");
  assert.equal(send.isLocked(), true, "useCart and every fence refuse edits while unconfirmed");
});

test("R-b (2): Send again re-sends the FROZEN request with the SAME key, byte for byte, even when the caller passes a different body", async () => {
  const { send, log, job } = harness();
  await send.run(job("first", [TIMEOUT, PLACED]));
  const other = { items: [{ productId: "p2", qty: 5 }], total: 999 };
  await send.run(job("again", [], {}, other));
  assert.equal(log.posts.length, 2, "one more POST");
  assert.equal(log.posts[1].job, "first", "the frozen request went out, not the rebuilt one");
  assert.equal(log.posts[1].body, log.posts[0].body, "byte-identical body, key included");
  assert.equal(log.posts[1].key, "K1");
  assert.equal(log.confirmed.length, 1, "one confirm — one KOT, one toast");
  assert.deepEqual(send.getState(), IDLE, "an answer ends the freeze");
  assert.equal(send.isLocked(), false);
});

test("a second uncertain failure stays frozen, says the server is still unreachable, and still keeps the key", async () => {
  const { send, log, job } = harness();
  await send.run(job("a", [TIMEOUT, OFFLINE, PLACED]));
  await send.run(job("a2", []));
  assert.equal(noticeOf(send, "kitchen")?.message, SEND_STILL_UNREACHABLE);
  assert.equal(send.isLocked(), true);
  await send.run(job("a3", []));
  assert.deepEqual(log.posts.map((p) => p.key), ["K1", "K1", "K1"]);
  assert.equal(log.confirmed.length, 1);
});

test("R-c (3): a DEFINITE failure on Send again ends the unconfirmed state — freeze released, notice gone, key re-minted", async () => {
  assert.equal(REFUSALS.length, DEFINITE.length - AUTH.length, "vision guard: only the sign-in failures are carved out");
  for (const failure of REFUSALS) {
    const { send, log, job } = harness();
    await send.run(job("a", [TIMEOUT, failure]));
    await send.run(job("again", []));
    assert.deepEqual(send.getState(), IDLE, `${failure.message}: nobody stays stuck behind the notice`);
    assert.equal(send.isLocked(), false, "edits are free again");
    await send.run(job("next", [PLACED], {}, { items: [{ productId: "p3", qty: 1 }] }));
    assert.deepEqual(log.posts.map((p) => p.key), ["K1", "K1", "K2"], "the next send is a new attempt");
    assert.equal(log.posts[2].job, "next", "and it sends what is on screen now");
  }
});

test("R-c (5): the Pay Now popup hold releases on a definite failure", async () => {
  const { send, job } = harness();
  await send.run(job("pay", [TIMEOUT, BAD_REQUEST], { kind: "pay" }));
  assert.equal(send.holds("pay"), true);
  await send.run(job("pay-again", [], { kind: "pay" }));
  assert.equal(send.holds("pay"), false, "the popup can close — the hook's toast says why");
  assert.equal(noticeOf(send, "pay"), null);
});

test("R-d (4): Discard (reset) forgets the attempt — unfrozen, no notice, no hold — and the next send gets a new key", async () => {
  for (const kind of ["kitchen", "pay"] as const) {
    const { send, log, job } = harness();
    await send.run(job("a", [TIMEOUT], { kind }));
    assert.equal(send.isLocked(), true);
    send.reset();
    assert.deepEqual(send.getState(), IDLE, "Discard clears the notice");
    assert.equal(send.isLocked(), false, "resetOrder can then clear the cart");
    assert.equal(send.holds(kind), false);
    await send.run(job("b", [PLACED], { kind }));
    assert.deepEqual(log.posts.map((p) => p.key), ["K1", "K2"], "resetOrder / enterResume start a new attempt");
    assert.equal(log.posts[1].job, "b", "the frozen request is gone with it");
  }
});

test("Pay Now: Couldn't confirm holds the popup (R13), and no other send can start over it", async () => {
  const { send, log, job } = harness();
  await send.run(job("pay", [TIMEOUT], { kind: "pay" }));
  assert.equal(noticeOf(send, "pay")?.message, SEND_UNCONFIRMED_PAY);
  assert.equal(noticeOf(send, "kitchen"), null, "the notice belongs to the popup, not the cart");
  assert.equal(send.getState().frozen, "pay");
  assert.equal(send.holds("pay"), true, "the popup cannot close");
  assert.equal(send.holds("kitchen"), false);
  await send.run(job("kitchen", [PLACED]));
  await send.run(job("round", [PLACED], { scope: "tab1" }));
  assert.equal(log.posts.length, 1, "a different write never goes out over an unconfirmed one");
  await send.run(job("pay-again", [], { kind: "pay" }));
  assert.equal(log.posts.length, 2);
  assert.equal(log.posts[1].key, "K1");
});

test("no entropy at all: the send goes WITHOUT a key, and an uncertain failure is never offered as a safe Send again", async () => {
  const { send, log, job } = harness(() => undefined);
  await send.run(job("a", [TIMEOUT, PLACED]));
  assert.deepEqual(log.posts.map((p) => p.key), [undefined]);
  const notice = noticeOf(send, "kitchen");
  assert.ok(notice);
  assert.equal(notice.kind, "uncertain");
  assert.notEqual(notice.action, "send-again", "without a key a resend could make a second order");
  assert.equal(send.getState().frozen, null, "nothing to replay, so nothing to freeze for");
  assert.equal(send.holds("kitchen"), false);
  await send.run(job("b", []));
  assert.equal(log.posts.length, 2);
});

test("subscribers hear every change (useSyncExternalStore), and the state is a new object each time", async () => {
  const { send, job } = harness();
  const seen: unknown[] = [];
  const off = send.subscribe(() => seen.push(send.getState()));
  await send.run(job("a", [TIMEOUT]));
  off();
  assert.equal(seen.length, 2, "sending, then Couldn't confirm");
  assert.notEqual(seen[0], seen[1]);
});

test("M5: a new order prints KOT round 1 even when the replayed tab has gained rounds; a round prints the round its key landed as", () => {
  const replayed = order({ kotRounds: 3, kotIdemKeys: ["K1", "", "K3"] });
  assert.equal(kotRoundOfSend(replayed, false, "K1"), 1, "a new order's ticket is round 1");
  assert.equal(kotRoundOfSend(replayed, true, "K1"), 1, "a round replay prints its own round");
  assert.equal(kotRoundOfSend(replayed, true, "K3"), 3);
  assert.equal(kotRoundOfSend(replayed, true, "K9"), 3, "a key the server did not store falls back to the latest round");
  assert.equal(kotRoundOfSend(replayed, true, undefined), 3, "a keyless send prints the latest round, as before F5");
});

test("M1: mintAttemptId passes the server's idemKey schema — with randomUUID, and with only getRandomValues", () => {
  const withUuid = mintAttemptId();
  assert.ok(withUuid && idemKeySchema.safeParse(withUuid).success, `randomUUID key must parse: ${withUuid}`);

  const proto = Object.getPrototypeOf(crypto) as { randomUUID?: unknown };
  const original = Object.getOwnPropertyDescriptor(proto, "randomUUID");
  assert.ok(original, "vision guard: this runtime has randomUUID to take away");
  Object.defineProperty(proto, "randomUUID", { value: undefined, configurable: true, writable: true });
  try {
    assert.equal(typeof crypto.randomUUID, "undefined", "vision guard: randomUUID is really gone");
    const a = mintAttemptId();
    const b = mintAttemptId();
    assert.ok(a && idemKeySchema.safeParse(a).success, `the getRandomValues fallback must be a UUID, got ${a}`);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "RFC 4122 version 4 and variant bits");
    assert.notEqual(a, b, "never a constant");
  } finally {
    Object.defineProperty(proto, "randomUUID", original);
  }
});

test("M1: with no crypto at all mintAttemptId returns undefined (send without a key), never a made-up value", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  assert.ok(original, "vision guard: globalThis.crypto exists here");
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
  try {
    assert.equal(mintAttemptId(), undefined);
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
});

test("K3: a 401/403 on Send again keeps the held request, its key and the freeze — it says sign in, then Send again", async () => {
  for (const failure of AUTH) {
    for (const kind of ["kitchen", "pay"] as const) {
      const { send, log, job } = harness();
      await send.run(job("a", [TIMEOUT, failure, PLACED], { kind }));
      await send.run(job("again", [], { kind }));
      const notice = noticeOf(send, kind);
      assert.ok(notice, `${failure.status} ${kind}: a notice`);
      assert.equal(notice.message, SEND_SIGNED_OUT);
      assert.equal(notice.action, "send-again", "the button is still Send again");
      assert.equal(send.getState().frozen, kind, "still frozen: the first try may have landed");
      assert.equal(send.isLocked(), true);
      assert.equal(send.holds(kind), true, "the attempt is still held (the Pay Now popup stays open)");
      await send.run(job("after-sign-in", [], { kind }));
      assert.deepEqual(log.posts.map((p) => [p.job, p.key]), [["a", "K1"], ["a", "K1"], ["a", "K1"]], "the SAME request and key go out again");
      assert.equal(log.confirmed.length, 1);
      assert.deepEqual(send.getState(), IDLE);
    }
  }
});

test("K3: Discard still ends a signed-out held attempt", async () => {
  const { send, log, job } = harness();
  await send.run(job("a", [TIMEOUT, SIGNED_OUT]));
  await send.run(job("again", []));
  assert.equal(send.isLocked(), true);
  send.reset();
  assert.deepEqual(send.getState(), IDLE);
  await send.run(job("b", [PLACED]));
  assert.deepEqual(log.posts.map((p) => p.key), ["K1", "K1", "K2"]);
});

test("K3: a 401 on the FIRST send is still a plain refusal — nothing was held, nothing to keep", async () => {
  const { send, job } = harness();
  await send.run(job("a", [SIGNED_OUT]));
  assert.deepEqual(send.getState(), IDLE);
  assert.equal(send.isLocked(), false);
});

test("K4a: without a key the unconfirmed words name the right place to look — Open tabs for the kitchen, Orders for a sale", async () => {
  for (const [kind, message] of [["kitchen", SEND_UNCONFIRMED_UNKEYED_KITCHEN], ["pay", SEND_UNCONFIRMED_UNKEYED_PAY]] as const) {
    const { send, job } = harness(() => undefined);
    await send.run(job("a", [TIMEOUT], { kind }));
    assert.equal(noticeOf(send, kind)?.message, message, kind);
  }
  assert.ok(SEND_UNCONFIRMED_UNKEYED_KITCHEN.includes("Check Open tabs"));
  assert.ok(SEND_UNCONFIRMED_UNKEYED_PAY.includes("Check Orders"));
  assert.ok(!SEND_UNCONFIRMED_UNKEYED_PAY.includes("Open tabs"));
});

test("K2: an unanswered send that lands after the POS unmounted is toasted once, per kind, in plain words", async () => {
  for (const [kind, message] of [["kitchen", SEND_LOST_KITCHEN], ["pay", SEND_LOST_PAY]] as const) {
    for (const failure of [TIMEOUT, SERVER_DOWN]) {
      const { send, log, job, unmount } = harness();
      const d = deferred();
      const flight = send.run(job("a", [d.promise], { kind }));
      unmount();
      d.reject(failure);
      await flight;
      assert.deepEqual(log.toasts, [{ tone: "warning", message }], `${kind} ${failure.message}`);
      assert.equal(log.confirmed.length, 0);
    }
  }
  assert.equal(SEND_LOST_KITCHEN, "Couldn't confirm the order was sent. Check Open tabs before sending it again.");
  assert.equal(SEND_LOST_PAY, "Couldn't confirm the sale. Check Orders before taking payment again.");
});

test("K2: a keyless unanswered send, or a signed-out Send again, after unmount is toasted once too", async () => {
  const keyless = harness(() => undefined);
  const d = deferred();
  const flight = keyless.send.run(keyless.job("a", [d.promise]));
  keyless.unmount();
  d.reject(OFFLINE);
  await flight;
  assert.deepEqual(keyless.log.toasts, [{ tone: "warning", message: SEND_LOST_KITCHEN }]);
  const auth = harness();
  await auth.send.run(auth.job("a", [TIMEOUT, FORBIDDEN], { kind: "pay" }));
  auth.unmount();
  await auth.send.run(auth.job("again", [], { kind: "pay" }));
  assert.deepEqual(auth.log.toasts, [{ tone: "warning", message: SEND_LOST_PAY }]);
});

test("K2: a send that SUCCEEDS after unmount says it went through and that the slip may not have printed — confirm never runs", async () => {
  for (const [kind, message] of [["kitchen", SEND_DONE_AWAY_KITCHEN], ["pay", SEND_DONE_AWAY_PAY]] as const) {
    const { send, log, job, unmount } = harness();
    const d = deferred();
    const flight = send.run(job("a", [d.promise], { kind }));
    unmount();
    d.resolve(PLACED);
    await flight;
    assert.deepEqual(log.toasts, [{ tone: "success", message }], kind);
    assert.equal(log.confirmed.length, 0, "the page's print surface and its toast are gone — one toast, from here");
    assert.ok(message.includes("Reprint it from Orders"));
  }
});

test("K2: while mounted nothing is toasted from here — the notice and the confirm say it", async () => {
  const { send, log, job } = harness();
  await send.run(job("a", [TIMEOUT, PLACED]));
  await send.run(job("again", []));
  await send.run(job("refused", [BAD_REQUEST]));
  assert.deepEqual(log.toasts, []);
  assert.equal(log.confirmed.length, 1);
});
