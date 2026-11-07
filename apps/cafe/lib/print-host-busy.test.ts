// P2 N4: a new build never reloads the page while this device holds a print job. Two kinds of hold: a token holder
// (the host bridge while a slip is on its way to paper) and the print agent's lease and print, tracked while in flight.

import { test } from "node:test";
import assert from "node:assert/strict";

import { REFRESH_SETTLE_MS } from "@/lib/page-refresh";
import { directPrintTab, setDirectPrintSource } from "@/lib/print-agent-seams";
import {
  PRINT_HOST_CLOSING_MS,
  closePrintHost,
  holdPrintBusy,
  leaseUnlessClosing,
  printHostBusy,
  printHostClosing,
  trackPrintBusy,
} from "@/lib/print-host-busy";

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

// The verifiers' I1: after location.reload() the old page lives on until the new document answers. A lease it took in
// that gap would go with the page (the job expires into a REPRINT). From the reload on, no new lease starts.
test("closing: for PRINT_HOST_CLOSING_MS from the reload no new lease starts; the agent hears no answer", async () => {
  assert.equal(PRINT_HOST_CLOSING_MS, 8000, "8 s");
  assert.equal(PRINT_HOST_CLOSING_MS, REFRESH_SETTLE_MS, "the time after which a reload that did not tear the page down counts as not happened");
  assert.equal(printHostClosing(), false, "open at first");
  closePrintHost(1000);
  assert.equal(printHostClosing(1000), true, "closing from the reload");
  assert.equal(printHostClosing(1000 + PRINT_HOST_CLOSING_MS - 1), true, "closing until the window ends");
  assert.equal(printHostClosing(1000 + PRINT_HOST_CLOSING_MS), false, "open again once the page is still here after it");
  closePrintHost();
  let started = 0;
  await assert.rejects(
    leaseUnlessClosing(async () => {
      started += 1;
      return "job";
    }),
    /reloading/,
    "a lease while closing is refused like a lease with no answer (the agent looks again later)",
  );
  assert.equal(started, 0, "no lease request is sent while closing");
  assert.equal(printHostBusy(), false, "a refused lease holds nothing");
  closePrintHost(0);
  const work = deferred<string>();
  const leased = leaseUnlessClosing(() => work.promise);
  assert.equal(printHostBusy(), true, "an open lease is tracked while in flight, as before");
  work.resolve("job");
  assert.equal(await leased, "job", "the agent gets the lease's own answer");
  assert.equal(printHostBusy(), false, "released once it settled");
});

// The re-review's I1 rest: a request that makes a slip names this tab (directPrintTab → the lease header), so the
// server makes it already leased here — the self-order claim does that with nobody at the screen. Closing names none.
test("closing: a page that began its reload names no tab for the slips its requests make", () => {
  const off = setDirectPrintSource(() => "tab-1");
  try {
    closePrintHost(0);
    assert.equal(directPrintTab(), "tab-1", "open: the agent's tab, as before");
    closePrintHost();
    assert.equal(directPrintTab(), null, "closing: no tab, so the slip goes to its line, never leased to the dying page");
    closePrintHost(0);
    assert.equal(directPrintTab(), "tab-1", "the page still here after the window: named again");
  } finally {
    off();
  }
});
