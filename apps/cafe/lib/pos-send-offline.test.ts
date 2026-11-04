// Send to Kitchen and Pay Now while offline (Printing Phase 5, spec 5.5–5.6; plan Task 11), over the pure controller
// (lib/pos-send.ts) with fake ports. Only a send made while the state is ALREADY offline is kept on the device (it was
// never attempted, so the server certainly does not have it); a held (unanswered) send is never kept here (S3); a
// round on an order made offline is kept even online (its create has not reached the server yet).

import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@pos/shared/api-client";
import { createPosSend, SEND_OFFLINE_NOT_KEPT, type PosSendPorts, type SendJob, type SendOfflineFacts, type SendOfflineKept } from "./pos-send";
import type { Order } from "@/types";

const PLACED = { _id: "tab1", orderId: "ORD-1", status: "Pending", kotRounds: 1, items: [] } as unknown as Order;
const NO_ANSWER = new ApiError("Could not reach the server.", "network", null);

function harness(over: { offline?: boolean; keep?: (job: SendJob & { offline: SendOfflineFacts }, key: string) => Promise<SendOfflineKept> } = {}) {
  const calls = { requests: 0, keeps: [] as string[], answers: [] as unknown[], done: [] as SendOfflineKept[], confirms: 0 };
  let offline = over.offline ?? false;
  let n = 0;
  const ports: PosSendPorts = {
    mintKey: () => `key-${++n}`,
    toastUnmounted: () => undefined,
    offline: () => offline,
    keepOffline: async (job, key) => {
      calls.keeps.push(key);
      return over.keep ? over.keep(job, key) : { kept: true, message: "Offline: KOT O-1 printed here. It is sent when the internet is back." };
    },
    onAnswer: (error) => {
      calls.answers.push(error);
    },
  };
  const send = createPosSend(ports);
  send.mount();
  const job = (reply: Order | Error, base: Order | null = null): SendJob => ({
    kind: "kitchen",
    scope: base?._id ?? "create",
    request: async () => {
      calls.requests += 1;
      if (reply instanceof Error) throw reply;
      return reply;
    },
    confirm: () => {
      calls.confirms += 1;
    },
    offline: { body: { items: [] }, shownTotal: 120, base, done: (kept) => calls.done.push(kept) },
  });
  return { send, calls, job, setOffline: (on: boolean) => (offline = on) };
}

test("offline: the send is kept on the device under its own new key, and no request is made", async () => {
  const { send, calls, job } = harness({ offline: true });
  await send.run(job(PLACED));
  assert.equal(calls.requests, 0, "no request while offline");
  assert.deepEqual(calls.keeps, ["key-1"], "kept under the minted key");
  assert.equal(calls.done.length, 1, "the job hears it was kept");
  assert.equal(calls.done[0].kept, true, "kept");
  assert.equal(calls.confirms, 0, "no online confirm");
  assert.equal(send.isLocked(), false, "nothing is held: the cart is free");
  assert.deepEqual(send.getState(), { sending: null, frozen: null, notice: null }, "idle afterwards");
});

test("offline: a keep that failed leaves the cart as it is and says so; a keep that throws never crashes", async () => {
  const refused = harness({ offline: true, keep: async () => ({ kept: false, message: "Too many orders are waiting on this device. Connect to the internet to send them." }) });
  await refused.send.run(refused.job(PLACED));
  assert.equal(refused.calls.done[0].kept, false, "not kept");
  assert.equal(refused.send.isLocked(), false, "not frozen either: the cart stays editable");
  const thrown = harness({ offline: true, keep: async () => Promise.reject(new Error("boom")) });
  await thrown.send.run(thrown.job(PLACED));
  assert.deepEqual(thrown.calls.done, [{ kept: false, message: SEND_OFFLINE_NOT_KEPT }], "a throw is a keep that failed");
  assert.equal(SEND_OFFLINE_NOT_KEPT, "Could not keep this order on the device.", "spec 5.2's words");
});

test("online: today's request, never kept; each answer is reported (null for one that came back)", async () => {
  const { send, calls, job } = harness();
  await send.run(job(PLACED));
  assert.equal(calls.requests, 1, "one request");
  assert.equal(calls.keeps.length, 0, "never kept online");
  assert.equal(calls.confirms, 1, "the online confirm");
  assert.deepEqual(calls.answers, [null], "the answer reached us");
  await send.run(job(NO_ANSWER));
  assert.equal(calls.answers[1], NO_ANSWER, "an unanswered send is reported with its error");
});

test("a held (unanswered) send is never kept here, even once offline (S3): Send again repeats its request", async () => {
  const { send, calls, job, setOffline } = harness();
  await send.run(job(NO_ANSWER));
  assert.equal(send.holds("kitchen"), true, "held under its key");
  setOffline(true);
  await send.run(job(PLACED));
  assert.equal(calls.keeps.length, 0, "an attempted send never prints offline by itself");
  assert.equal(calls.requests, 2, "Send again is the same request again");
});

test("a job with no offline facts, or a device with no key, goes online as today even while offline", async () => {
  const { send, calls, job } = harness({ offline: true });
  const bare = { ...job(PLACED) };
  delete bare.offline;
  await send.run(bare);
  assert.equal(calls.requests, 1, "no facts: today's request");
  const keyless = createPosSend({ mintKey: () => undefined, toastUnmounted: () => undefined, offline: () => true, keepOffline: async () => ({ kept: true, message: null }) });
  let requested = 0;
  await keyless.run({ ...job(PLACED), request: async () => (requested += 1, PLACED) });
  assert.equal(requested, 1, "no key to keep it under: today's request");
});

test("a round on an order made offline is kept even online (its create has not reached the server)", async () => {
  const { send, calls, job } = harness({ offline: false });
  const local = { ...PLACED, _id: "offline-key-create", orderId: "O-3" } as Order;
  await send.run(job(PLACED, local));
  assert.equal(calls.requests, 0, "never posted to an id the server does not know");
  assert.deepEqual(calls.keeps, ["key-1"], "kept, chained to its order");
});

test("a second tap while the keep is running is ignored", async () => {
  let release: (value: SendOfflineKept) => void = () => undefined;
  const { send, calls, job } = harness({ offline: true, keep: () => new Promise<SendOfflineKept>((resolve) => (release = resolve)) });
  const first = send.run(job(PLACED));
  await send.run(job(PLACED));
  release({ kept: true, message: null });
  await first;
  assert.equal(calls.keeps.length, 1, "one keep");
  assert.equal(calls.done.length, 1, "one result");
});
