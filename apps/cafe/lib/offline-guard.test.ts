// What waits while offline (Printing Phase 5, spec 5.10; plan Task 15): settle, void, move, cancel, QR accept and
// reject, reprints, Print bill, End of day and setup saves answer "Offline: this needs the internet…" and send nothing;
// an order made offline is not on the server yet, so its settle, void, move and cancel wait too. A refusal made on the
// device reads as definite (nothing was sent) and never as an answer from the server. The automatic reload waits.

import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyFailure } from "@/lib/pending-writes";
import { reachOf } from "@/lib/offline-state";
import { OFFLINE_NEEDS_INTERNET, OFFLINE_ORDER_NOT_SENT, offlineRefusalOf, throwIfOffline } from "@/lib/offline-guard";
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

test("the automatic reload waits for the connection; it runs at once when there is one", () => {
  const reach = createServerReach();
  let reloads = 0;
  const win = { navigator: { onLine: true }, addEventListener: () => undefined, removeEventListener: () => undefined };
  reloadWhenOnline(() => (reloads += 1), reach, win);
  assert.equal(reloads, 1, "online: at once");
  reach.report({ type: "browser", online: false });
  const stop = reloadWhenOnline(() => (reloads += 1), reach, win);
  assert.equal(reloads, 1, "offline: it waits");
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
