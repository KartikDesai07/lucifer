// What waits while offline (Printing Phase 5, spec 5.10; plan Task 15): settle, void, move, cancel, QR accept and
// reject, reprints, Print bill, End of day and setup saves answer "Offline: this needs the internet…" and send nothing;
// an order made offline is not on the server yet, so its settle, void, move and cancel wait too. A refusal made on the
// device reads as definite (nothing was sent) and never as an answer from the server. The automatic reload waits.

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyFailure } from "@/lib/pending-writes";
import { reachOf } from "@/lib/offline-state";
import { OFFLINE_NEEDS_INTERNET, OFFLINE_ORDER_NOT_SENT, OFFLINE_ROUND_NOT_SENT, offlineRefusalOf, throwIfOffline } from "@/lib/offline-guard";
import { emptyOutbox } from "@/lib/offline-outbox";
import type { OutboxEntry } from "@/lib/offline-outbox-schema";
import { reloadWhenOnline } from "@/lib/offline-reload";
import { createServerReach } from "@/lib/server-reach";

test("offline: the write is refused on the device with spec 5.10's words; online it goes", () => {
  const reach = createServerReach();
  assert.equal(offlineRefusalOf(undefined, reach), null, "online: nothing to refuse");
  reach.report({ type: "browser", online: false });
  const refusal = offlineRefusalOf({ id: "srv-1", data: {} }, reach);
  assert.equal(refusal?.message, OFFLINE_NEEDS_INTERNET, "the words");
  assert.equal(OFFLINE_NEEDS_INTERNET, "Offline: this needs the internet. Try again once it is back.", "spec 5.10");
  assert.equal(classifyFailure(refusal), "definite", "nothing was sent: no Check, no Send again");
  assert.equal(reachOf(refusal), "unreached", "never taken for an answer that reached the server");
  assert.throws(() => throwIfOffline({ id: "srv-1" }, reach), (e: unknown) => e === e && (e as Error).message === OFFLINE_NEEDS_INTERNET, "onMutate refuses before the request");
});

test("an order made offline waits for its create, online too", () => {
  const reach = createServerReach();
  assert.equal(offlineRefusalOf({ id: "offline-k1", tableNo: "T-3" }, reach)?.message, OFFLINE_ORDER_NOT_SENT, "its id is the device's own");
  assert.equal(OFFLINE_ORDER_NOT_SENT, "This order is still waiting to be sent. Try again once it is sent.", "the words");
  assert.equal(offlineRefusalOf({ id: "srv-1" }, reach), null, "a server order goes");
  assert.equal(offlineRefusalOf("offline-k1", reach)?.message, OFFLINE_ORDER_NOT_SENT, "an id passed alone");
});

// The pre-deploy review (2026-11-05): a round kept offline on a server tab was not on that tab's screen, and online
// nothing refused its settle, so the bill closed without the round and the round's replay was then refused (spec 5.5:
// "A round on a tab the server already has works the same way. Settle, void, move and cancel wait").
test("a tab with a round still kept on this device waits, online too: settle, void, move and cancel (spec 5.5)", () => {
  const reach = createServerReach();
  const kept = (over: Partial<OutboxEntry>): OutboxEntry => ({
    key: "k-r1", ref: "O-1", at: 1, kind: "round", sale: false, uncertain: false, local: "srv-1", orderId: "srv-1", table: "T-3",
    body: { items: [] }, shownTotal: 100, lines: [], state: "waiting", ...over,
  });
  const outboxOf = (entries: OutboxEntry[]) => ({ getSnapshot: () => ({ record: { ...emptyOutbox("2026-11-05"), entries }, unreadable: false }) });
  const waiting = outboxOf([kept({})]);
  const refusal = offlineRefusalOf({ id: "srv-1", data: {} }, reach, waiting);
  assert.equal(refusal?.message, OFFLINE_ROUND_NOT_SENT, "a settle, a move or a cancel ({ id })");
  assert.equal(OFFLINE_ROUND_NOT_SENT, "A round of this order is still waiting to be sent (Offline orders). Try again once it is sent.", "the words");
  assert.equal(classifyFailure(refusal), "definite", "nothing was sent");
  assert.equal(offlineRefusalOf("srv-1", reach, waiting)?.message, OFFLINE_ROUND_NOT_SENT, "a void (the id alone)");
  assert.throws(() => throwIfOffline({ id: "srv-1" }, reach, waiting), (e: unknown) => (e as Error).message === OFFLINE_ROUND_NOT_SENT, "onMutate refuses before the request");
  assert.equal(offlineRefusalOf({ id: "srv-2" }, reach, waiting), null, "another tab goes");
  assert.equal(offlineRefusalOf({ id: "srv-1" }, reach, outboxOf([kept({ state: "needs-staff", message: "Masala Chai is out of stock." })]))?.message, OFFLINE_ROUND_NOT_SENT, "a refused round waits for staff first");
  assert.equal(offlineRefusalOf({ id: "srv-9" }, reach, outboxOf([kept({ local: "offline-k1", orderId: "srv-9" })]))?.message, OFFLINE_ROUND_NOT_SENT, "an order made offline whose create was saved, while its rounds wait");
  assert.equal(offlineRefusalOf({ id: "srv-1" }, reach, { getSnapshot: () => ({ record: null, unreadable: false }) }), null, "no record: nothing waits");
  reach.report({ type: "browser", online: false });
  assert.equal(offlineRefusalOf({ id: "srv-1" }, reach, waiting)?.message, OFFLINE_NEEDS_INTERNET, "offline: the offline words first");
});

test("the automatic reload waits for the connection; it runs at once when there is one", () => {
  const reach = createServerReach();
  let reloads = 0;
  const win = { navigator: { onLine: true }, addEventListener: () => undefined, removeEventListener: () => undefined };
  reloadWhenOnline(() => (reloads += 1), reach, win);
  assert.equal(reloads, 1, "online: at once");
  reach.report({ type: "browser", online: false });
  const stop = reloadWhenOnline(() => (reloads += 1), reach, win);
  assert.equal(reloads, 1, "offline: it waits");
  // 5C Task 20: while the browser itself says offline no answer ends offline; it comes back first.
  reach.report({ type: "browser", online: true });
  assert.equal(reloads, 1, "the browser back alone: it still waits");
  reach.report({ type: "pulse", reach: "reached" });
  assert.equal(reloads, 2, "the first answer that reaches us runs it");
  reach.report({ type: "browser", online: false });
  reach.report({ type: "pulse", reach: "reached" });
  assert.equal(reloads, 2, "once");
  stop();
});

test("End of day on a device that still holds offline orders says so (the review's I10)", async () => {
  const { offlineEodWarning } = await import("@/lib/offline-guard");
  assert.equal(offlineEodWarning(3), "3 offline orders are still on this device: send them before End of day.", "spec 5.10");
  assert.equal(offlineEodWarning(1), "1 offline order is still on this device: send it before End of day.", "one");
});

test("the header while offline: amber, and what the device does with a send (spec 5.10)", async () => {
  const { offlineHeaderOf, OFFLINE_HEADER_PRINTING, OFFLINE_HEADER_KEEPING } = await import("@/lib/offline-guard");
  assert.equal(offlineHeaderOf({ offline: false, printsHere: true }), null, "online: the printer button as today");
  assert.deepEqual(offlineHeaderOf({ offline: true, printsHere: true }), { name: OFFLINE_HEADER_PRINTING }, "a printing device");
  assert.deepEqual(offlineHeaderOf({ offline: true, printsHere: false }), { name: OFFLINE_HEADER_KEEPING }, "a waiter phone");
  assert.equal(OFFLINE_HEADER_PRINTING, "Offline — KOTs print here", "spec 5.10");
  assert.equal(OFFLINE_HEADER_KEEPING, "Offline — orders are kept on this device", "spec 5.10");
});
