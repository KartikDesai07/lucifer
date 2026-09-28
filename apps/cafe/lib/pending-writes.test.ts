import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@pos/shared/api-client";
import {
  SETTLE_MAX_ATTEMPTS,
  SETTLE_RETRY_DELAYS_MS,
  classifyFailure,
  reconcileSettle,
  runSettle,
  type SettleIntent,
} from "./pending-writes";
import type { Order } from "@/types";

const http = (status: number, message = `HTTP ${status}`) => new ApiError(message, "http", status);
const TIMEOUT = new ApiError("signal timed out", "timeout", null);
const OFFLINE = new ApiError("Failed to fetch", "network", null);

function order(over: Partial<Order>): Order {
  return { _id: "o1", orderId: "ORD-20260928-001", status: "Pending", payment: "Unpaid", paidAmount: 0, total: 540, items: [], ...over } as Order;
}

test("classifyFailure: a refusal is final, a 409 needs a look, anything unanswered is uncertain", () => {
  for (const s of [400, 401, 403, 404, 422]) assert.equal(classifyFailure(http(s)), "definite", `${s}`);
  assert.equal(classifyFailure(http(409)), "conflict");
  for (const s of [500, 502, 503, 504, 408, 429]) assert.equal(classifyFailure(http(s)), "uncertain", `${s}`);
  assert.equal(classifyFailure(TIMEOUT), "uncertain");
  assert.equal(classifyFailure(OFFLINE), "uncertain");
  assert.equal(classifyFailure(new Error("boom")), "uncertain", "an unknown throw is never read as a refusal");
});

test("reconcileSettle recognises OUR settle only when mode and amount match what the route would store", () => {
  const cash: SettleIntent = { payment: "Cash" };
  assert.equal(reconcileSettle(cash, order({ status: "Completed", payment: "Cash", paidAmount: 540 })), "adopt");
  assert.equal(reconcileSettle(cash, order({ status: "Completed", payment: "Online", paidAmount: 540 })), "elsewhere");
  assert.equal(reconcileSettle(cash, order({ status: "Completed", payment: "Cash", paidAmount: 300 })), "elsewhere", "a partial settle is not our full one");
  const partial: SettleIntent = { payment: "Cash", paidAmount: 300 };
  assert.equal(reconcileSettle(partial, order({ status: "Completed", payment: "Cash", paidAmount: 300 })), "adopt");
  assert.equal(reconcileSettle({ payment: "Cash", paidAmount: 900 }, order({ status: "Completed", payment: "Cash", paidAmount: 540 })), "adopt", "change is clamped to the total, as the route does");
  assert.equal(reconcileSettle({ payment: "Due" }, order({ status: "Completed", payment: "Due", paidAmount: 0 })), "adopt");
  const split: SettleIntent = { payment: "Split", splitCash: 240, splitOnline: 300 };
  assert.equal(reconcileSettle(split, order({ status: "Completed", payment: "Split", paidAmount: 540, splitCash: 240, splitOnline: 300 })), "adopt");
  assert.equal(reconcileSettle(split, order({ status: "Completed", payment: "Split", paidAmount: 540, splitCash: 540, splitOnline: 0 })), "elsewhere");
  assert.equal(reconcileSettle(cash, order({ status: "Pending" })), "open");
  assert.equal(reconcileSettle(cash, order({ status: "Cancelled" })), "cancelled");
});

/** Fake ports: scripted send/read results, recorded sleeps. */
function ports(sends: Array<Order | Error>, reads: Array<Order | Error> = []) {
  const log = { sends: 0, reads: 0, sleeps: [] as number[], retries: [] as number[] };
  return {
    log,
    ports: {
      send: async () => {
        const r = sends[Math.min(log.sends++, sends.length - 1)];
        if (r instanceof Error) throw r;
        return r;
      },
      read: async () => {
        const r = reads[Math.min(log.reads++, reads.length - 1)];
        if (r instanceof Error) throw r;
        return r;
      },
      sleep: async (ms: number) => {
        log.sleeps.push(ms);
      },
      onRetry: (n: number) => log.retries.push(n),
    },
  };
}

const CASH: SettleIntent = { payment: "Cash" };
const DONE = order({ status: "Completed", payment: "Cash", paidAmount: 540, billNumber: 17 } as Partial<Order>);

test("runSettle: a first-time answer is the whole story — no read, no retry", async () => {
  const { ports: p, log } = ports([DONE]);
  assert.deepEqual(await runSettle(CASH, p), { kind: "settled", order: DONE });
  assert.deepEqual([log.sends, log.reads, log.sleeps.length], [1, 0, 0]);
});

test("runSettle: a timeout whose settle DID land is adopted from the order — sent once, never twice", async () => {
  const { ports: p, log } = ports([TIMEOUT], [DONE]);
  assert.deepEqual(await runSettle(CASH, p), { kind: "settled", order: DONE });
  assert.equal(log.sends, 1, "the order already says settled — re-sending would only 409");
});

test("runSettle: a timeout on a tab still open waits, then re-sends", async () => {
  const { ports: p, log } = ports([TIMEOUT, DONE], [order({ status: "Pending" })]);
  assert.deepEqual(await runSettle(CASH, p), { kind: "settled", order: DONE });
  assert.deepEqual(log.sleeps, [SETTLE_RETRY_DELAYS_MS[0]]);
  assert.deepEqual(log.retries, [2]);
});

test("runSettle: a 500 after the write committed is still our settle", async () => {
  const { ports: p } = ports([http(500, "Failed to settle order")], [DONE]);
  assert.equal((await runSettle(CASH, p)).kind, "settled");
});

test("runSettle: a 409 on a tab another device settled is reported, not adopted — no second bill", async () => {
  const other = order({ status: "Completed", payment: "Online", paidAmount: 540 });
  const { ports: p } = ports([http(409, "Order already settled")], [other]);
  assert.deepEqual(await runSettle(CASH, p), { kind: "elsewhere", order: other });
});

test("runSettle: a 409 on a tab that is still open means it changed — fail loud, do not retry", async () => {
  const msg = "Tab changed or already settled — reopen it and try again";
  const { ports: p, log } = ports([http(409, msg)], [order({ status: "Pending" })]);
  assert.deepEqual(await runSettle(CASH, p), { kind: "failed", message: msg });
  assert.equal(log.sends, 1);
});

test("runSettle: a refusal (400) is final — the order is not even read", async () => {
  const { ports: p, log } = ports([http(400, "Select an existing customer for Due or Credit orders")]);
  assert.deepEqual(await runSettle(CASH, p), { kind: "failed", message: "Select an existing customer for Due or Credit orders" });
  assert.deepEqual([log.sends, log.reads], [1, 0]);
});

test("runSettle: a cancelled tab and a vanished order are GONE — nothing to retry or reopen", async () => {
  const a = ports([TIMEOUT], [order({ status: "Cancelled" })]);
  assert.deepEqual(await runSettle(CASH, a.ports), { kind: "gone", message: "The tab was cancelled" });
  const b = ports([TIMEOUT], [http(404, "Order not found")]);
  assert.deepEqual(await runSettle(CASH, b.ports), { kind: "gone", message: "The tab no longer exists" });
  const c = ports([http(404, "Order not found")]);
  assert.deepEqual(await runSettle(CASH, c.ports), { kind: "gone", message: "The tab no longer exists" });
  const d = ports([http(409, "Order was cancelled")], [order({ status: "Cancelled" })]);
  assert.deepEqual(await runSettle(CASH, d.ports), { kind: "gone", message: "The tab was cancelled" });
  assert.equal(a.log.sends + b.log.sends + c.log.sends + d.log.sends, 4);
});

test("runSettle: a lapsed sign-in is final and says what to do in plain words", async () => {
  const { ports: p, log } = ports([http(401, "Not authenticated")]);
  assert.deepEqual(await runSettle(CASH, p), { kind: "failed", message: "You were signed out — sign in again, then settle it" });
  assert.deepEqual([log.sends, log.reads], [1, 0]);
});

test("runSettle: a re-send refused because the tab moved (expectedTotal echo) is loud and final", async () => {
  const msg = "Tab changed — reopen it and try again";
  const { ports: p, log } = ports([TIMEOUT, http(409, msg)], [order({ status: "Pending" }), order({ status: "Pending", total: 560 })]);
  assert.deepEqual(await runSettle(CASH, p), { kind: "failed", message: msg });
  assert.equal(log.sends, 2, "one re-send, then the operator must look at the bigger bill");
});

test("runSettle: when nothing ever answers it gives up after SETTLE_MAX_ATTEMPTS and says it could not confirm", async () => {
  const { ports: p, log } = ports([TIMEOUT], [OFFLINE]);
  const out = await runSettle(CASH, p);
  assert.equal(out.kind, "unknown");
  assert.equal(log.sends, SETTLE_MAX_ATTEMPTS);
  assert.deepEqual(log.sleeps, SETTLE_RETRY_DELAYS_MS.slice(0, SETTLE_MAX_ATTEMPTS - 1));
  assert.deepEqual(log.retries, [2, 3, 4]);
});

// Review fallout (2026-09-28): a 409 is the server saying THIS request wrote
// nothing, so on a first attempt no settle of ours can exist — a Completed
// order that happens to match our mode and amount is someone else's (a second
// device, a second browser tab, the Orders page). Adopting it showed success
// and printed a bill where the cashier needed "check before giving change".
test("runSettle: a 409 on the FIRST attempt is never our settle, even when the order matches it", async () => {
  const { ports: p, log } = ports([http(409, "Order already settled")], [DONE]);
  assert.deepEqual(await runSettle(CASH, p), { kind: "elsewhere", order: DONE });
  assert.equal(log.sends, 1);
});

test("runSettle: a 409 AFTER an unanswered attempt is our own earlier settle landing — adopted", async () => {
  const { ports: p } = ports([TIMEOUT, http(409, "Order already settled")], [order({ status: "Pending" }), DONE]);
  assert.deepEqual(await runSettle(CASH, p), { kind: "settled", order: DONE });
});

test("runSettle: a manual Retry after 'could not confirm' still counts the earlier unanswered sends", async () => {
  const { ports: p } = ports([http(409, "Order already settled")], [DONE]);
  assert.deepEqual(await runSettle(CASH, p, { mayHaveLanded: true }), { kind: "settled", order: DONE });
});
