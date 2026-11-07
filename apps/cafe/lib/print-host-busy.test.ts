// P2 N4: a new build never reloads the page while this device holds a print job. Two kinds of hold: a token holder
// (the host bridge while a slip is on its way to paper) and the print agent's lease and print, tracked while in flight.

import { test } from "node:test";
import assert from "node:assert/strict";

import { holdPrintBusy, printHostBusy, trackPrintBusy } from "@/lib/print-host-busy";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("holders: busy while any holder says so; letting go twice is harmless", () => {
  const bridge = Symbol("bridge");
  const other = Symbol("other");
  assert.equal(printHostBusy(), false, "nothing held at first");
  holdPrintBusy(bridge, true);
  assert.equal(printHostBusy(), true, "the bridge prints");
  holdPrintBusy(other, true);
  holdPrintBusy(bridge, false);
  assert.equal(printHostBusy(), true, "the other holder still prints");
  holdPrintBusy(other, false);
  assert.equal(printHostBusy(), false, "all released");
  holdPrintBusy(other, false);
  assert.equal(printHostBusy(), false, "releasing twice is harmless");
});

test("trackPrintBusy: busy while the work is pending, released when it resolves, with the same value", async () => {
  const work = deferred<string>();
  const tracked = trackPrintBusy(work.promise);
  assert.equal(printHostBusy(), true, "a lease or a print in flight");
  work.resolve("printed");
  assert.equal(await tracked, "printed", "the caller gets the same value");
  assert.equal(printHostBusy(), false, "released once it settled");
});

test("trackPrintBusy: released when the work rejects, and the rejection still reaches the caller", async () => {
  const work = deferred<string>();
  const tracked = trackPrintBusy(work.promise);
  assert.equal(printHostBusy(), true, "in flight");
  const boom = new Error("offline");
  work.reject(boom);
  await assert.rejects(tracked, (error) => error === boom, "the same error reaches the agent");
  assert.equal(printHostBusy(), false, "released after a failure too");
});

test("trackPrintBusy: two overlapping tracks keep it busy until both settle; a holder and a track together", async () => {
  const lease = deferred<number>();
  const print = deferred<number>();
  const first = trackPrintBusy(lease.promise);
  const second = trackPrintBusy(print.promise);
  lease.resolve(1);
  assert.equal(await first, 1, "the first settles");
  assert.equal(printHostBusy(), true, "the second is still in flight");
  const bridge = Symbol("bridge");
  holdPrintBusy(bridge, true);
  print.resolve(2);
  assert.equal(await second, 2, "the second settles");
  assert.equal(printHostBusy(), true, "the bridge still holds");
  holdPrintBusy(bridge, false);
  assert.equal(printHostBusy(), false, "nothing left");
});
