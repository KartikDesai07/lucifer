// A send that failed half-way (Printing Phase 5, spec 5.7; plan Task 12), over the pure controller with fake ports.
// A send that got no answer may already be on the server: it keeps today's "Couldn't confirm" until the page is
// offline; then it moves into the outbox as an UNCERTAIN entry (no paper: S3), the cart is freed with spec 5.7's words,
// and the replay is its check. Its paper prints only on staff's "Print KOT here" (lib/offline-keep.ts).

import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@pos/shared/api-client";
import { createPosSend, SEND_PARKED, type PosSendPorts, type SendJob, type SendOfflineKept, type SendParked } from "./pos-send";

const NO_ANSWER = new ApiError("Could not reach the server.", "network", null);

function harness(over: { park?: (held: SendParked) => Promise<boolean>; keyless?: boolean } = {}) {
  let offline = false;
  const listeners = new Set<() => void>();
  const parked: SendParked[] = [];
  const done: SendOfflineKept[] = [];
  let clock = 1_000;
  const ports: PosSendPorts = {
    mintKey: () => (over.keyless ? undefined : "key-1"),
    toastUnmounted: () => undefined,
    now: () => clock,
    offline: () => offline,
    keepOffline: async () => ({ kept: true, message: "kept" }),
    parkHeld: async (held) => {
      parked.push(held);
      return over.park ? over.park(held) : true;
    },
    onOfflineChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const send = createPosSend(ports);
  const unmount = send.mount();
  const goOffline = async () => {
    offline = true;
    for (const listener of [...listeners]) listener();
    await new Promise((resolve) => setImmediate(resolve));
  };
  const job = (): SendJob => ({
    kind: "kitchen",
    scope: "create",
    request: async () => {
      clock += 15_000;
      throw NO_ANSWER;
    },
    confirm: () => undefined,
    offline: { body: { items: [] }, shownTotal: 120, base: null, done: (kept) => done.push(kept) },
  });
  return { send, parked, done, goOffline, job, unmount, listeners, setOffline: (on: boolean) => (offline = on) };
}

test("an unanswered send waits as today; once the page is offline it moves into the outbox, uncertain, and the cart is freed", async () => {
  const { send, parked, done, goOffline, job } = harness();
  await send.run(job());
  assert.equal(send.holds("kitchen"), true, "held: Couldn't confirm, Send again");
  assert.equal(parked.length, 0, "nothing parked while the page is online");
  await goOffline();
  assert.equal(parked.length, 1, "parked once the page is offline");
  assert.deepEqual([parked[0].kind, parked[0].key, parked[0].at], ["kitchen", "key-1", 1_000], "its kind, its key, the tap's time");
  assert.equal(send.holds("kitchen"), false, "no longer held");
  assert.deepEqual(send.getState(), { sending: null, frozen: null, notice: null }, "the notice is gone");
  assert.deepEqual(done, [{ kept: true, message: SEND_PARKED }], "the cart is freed with spec 5.7's words");
  assert.equal(SEND_PARKED, "Saved on this device. It is sent by itself when the internet is back — it can never go through twice.", "the words");
});

test("a park that could not be kept leaves the send held (Send again still works)", async () => {
  const { send, done, goOffline, job } = harness({ park: async () => false });
  await send.run(job());
  await goOffline();
  assert.equal(send.holds("kitchen"), true, "still held");
  assert.equal(done.length, 0, "the cart stays frozen with its notice");
});

test("Send again while offline that still gets no answer is parked right away", async () => {
  const { send, parked, job, setOffline } = harness();
  await send.run(job());
  setOffline(true);
  await send.run(job());
  assert.equal(parked.length, 1, "parked after the failed Send again");
});

test("a held send with no key is never parked (nothing could repeat it safely)", async () => {
  const { send, parked, goOffline, job } = harness({ keyless: true });
  await send.run(job());
  await goOffline();
  assert.equal(parked.length, 0, "an unkeyed send stays with today's Check Open tabs notice");
});

test("while the park is being kept the send reads as sending (Discard waits), and an unmounted POS parks nothing", async () => {
  let release: (value: boolean) => void = () => undefined;
  const { send, goOffline, job, unmount, listeners } = harness({ park: () => new Promise<boolean>((resolve) => (release = resolve)) });
  await send.run(job());
  const going = goOffline();
  await going;
  assert.equal(send.getState().sending, "kitchen", "locked while the entry is written");
  release(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(send.getState().sending, null, "free afterwards");
  unmount();
  assert.equal(listeners.size, 0, "the offline subscription ends with the POS");
});
