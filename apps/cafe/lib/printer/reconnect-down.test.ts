import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrinterHere } from "@/lib/print-agent-here";
import type { ConnectOutcome } from "@/lib/printer/web-printer-types";
import { THIS_DEVICE_PRINTER, reconnectDown, reconnectToastOf } from "@/lib/printer/reconnect-down";

// PX-2 Task 6 (spec §6.5, F-M5): Reconnect reconnects exactly the printers of this device that are down, in the setup's
// order, one after the other; the first call is made inside the click (user activation); a closed chooser says nothing.

const here = (id: string, name: string, over: Partial<PrinterHere> = {}): PrinterHere => ({ id, name, appName: "RPP02N", transport: "bluetooth", nativeId: `bt-classic:${id}`, status: "disconnected", ...over });
const KITCHEN_DOWN = here("A", "Kitchen printer");
const BILL_UP = here("B", "Bill printer", { status: "connected" });
const BILL_DOWN = here("B", "Bill printer");

interface Call {
  what: string;
  settle: (outcome: ConnectOutcome) => void;
  fail: (error: Error) => void;
}

// Each call is recorded the moment it is made and answers only when the test settles it.
function deferredDeps() {
  const calls: Call[] = [];
  const record = (what: string): Promise<ConnectOutcome> =>
    new Promise<ConnectOutcome>((resolve, reject) => {
      calls.push({ what, settle: resolve, fail: reject });
    });
  return { calls, deps: { device: () => record("device"), native: (id: string) => record(`native:${id}`) } };
}

const answering = (outcomes: Record<string, ConnectOutcome>) => {
  const calls: string[] = [];
  const answer = (what: string) => {
    calls.push(what);
    return Promise.resolve(outcomes[what] ?? "failed");
  };
  return { calls, deps: { device: () => answer("device"), native: (id: string) => answer(`native:${id}`) } };
};

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a cancelled chooser is neither connected nor failed (F-M5: no toast for it alone)", async () => {
  const { deps } = answering({ "native:bt-classic:A": "cancelled" });
  assert.deepEqual(await reconnectDown([KITCHEN_DOWN], deps), { connected: [], failed: [] }, "a closed chooser counts as nothing");
  const device = answering({ device: "cancelled" });
  assert.deepEqual(await reconnectDown([], device.deps), { connected: [], failed: [] }, "the same for this device's own printer");
  const mixed = answering({ "native:bt-classic:A": "cancelled", "native:bt-classic:B": "connected" });
  assert.deepEqual(await reconnectDown([KITCHEN_DOWN, BILL_DOWN], mixed.deps), { connected: ["Bill printer"], failed: [] }, "only the one that connected is said");
});

test("only the printers that are down, in order", async () => {
  const { calls, deps } = answering({ "native:bt-classic:A": "connected" });
  const result = await reconnectDown([KITCHEN_DOWN, BILL_UP], deps);
  assert.deepEqual(calls, ["native:bt-classic:A"], "Kitchen once, through the app; Bill (connected) never");
  assert.deepEqual(result, { connected: ["Kitchen printer"], failed: [] }, "the Kitchen printer connected");
  const own = here("C", "Counter printer", { nativeId: undefined, status: "needs-tap" });
  const mix = answering({ "native:bt-classic:A": "failed", device: "connected" });
  assert.deepEqual(await reconnectDown([KITCHEN_DOWN, BILL_UP, own], mix.deps), { connected: ["Counter printer"], failed: ["Kitchen printer"] }, "each answer under its own name");
  assert.deepEqual(mix.calls, ["native:bt-classic:A", "device"], "a printer without a native id is this device's own: devicePrinter().reconnect()");
  const none = answering({});
  assert.deepEqual(await reconnectDown([BILL_UP], none.deps), { connected: [], failed: [] }, "nothing down: nothing to do");
  assert.deepEqual(none.calls, [], "and nothing is called");
});

test("two down, one after the other (the second starts after the first settles)", async () => {
  const { calls, deps } = deferredDeps();
  const run = reconnectDown([KITCHEN_DOWN, BILL_DOWN], deps);
  await tick();
  assert.deepEqual(calls.map((c) => c.what), ["native:bt-classic:A"], "only the first while it runs");
  calls[0]?.settle("connected");
  await tick();
  assert.deepEqual(calls.map((c) => c.what), ["native:bt-classic:A", "native:bt-classic:B"], "the second once the first settled");
  calls[1]?.fail(new Error("The printer did not answer."));
  assert.deepEqual(await run, { connected: ["Kitchen printer"], failed: ["Bill printer"] }, "a thrown attempt is a failure, never a rejection");
});

test("the first starts inside the call", () => {
  const { calls, deps } = deferredDeps();
  const run = reconnectDown([KITCHEN_DOWN, BILL_DOWN], deps);
  assert.equal(calls.length, 1, "the first reconnect was asked before the returned promise was awaited (user activation)");
  assert.equal(calls[0]?.what, "native:bt-classic:A", "and it is the first printer that is down");
  const thrown = reconnectDown([], { device: () => { throw new Error("not the owner tab"); }, native: () => Promise.resolve("connected") });
  assert.ok(run instanceof Promise && thrown instanceof Promise, "a promise either way, even when the call throws at once");
  return thrown.then((result) => assert.deepEqual(result, { connected: [], failed: [THIS_DEVICE_PRINTER] }, "a throw inside the click is a failure"));
});

test("simple mode reconnects the device's printer", async () => {
  const { calls, deps } = answering({ device: "connected" });
  assert.deepEqual(await reconnectDown([], deps), { connected: [THIS_DEVICE_PRINTER], failed: [] }, "an empty subject is this device's own printer");
  assert.deepEqual(calls, ["device"], "devicePrinter().reconnect(), once");
  const sync = deferredDeps();
  void reconnectDown([], sync.deps);
  assert.equal(sync.calls.length, 1, "called inside the click too");
  assert.equal(THIS_DEVICE_PRINTER, "the printer", "its name in the toast");
});

test("the toast words", () => {
  assert.deepEqual(reconnectToastOf({ connected: ["Kitchen printer"], failed: [] }), { tone: "success", text: "Kitchen printer connected." }, "one connected");
  assert.deepEqual(reconnectToastOf({ connected: ["Kitchen printer", "Bill printer"], failed: [] }), { tone: "success", text: "Kitchen printer, Bill printer connected." }, "names joined with a comma");
  assert.deepEqual(
    reconnectToastOf({ connected: [], failed: ["Kitchen printer"] }),
    { tone: "error", text: "Could not connect Kitchen printer. Check it is on, then tap Reconnect again." },
    "one failed",
  );
  assert.deepEqual(
    reconnectToastOf({ connected: ["Bill printer"], failed: ["Kitchen printer", "Bar printer"] }),
    { tone: "error", text: "Could not connect Kitchen printer, Bar printer. Check it is on, then tap Reconnect again." },
    "any failed: the error names only the failed ones",
  );
  assert.deepEqual(reconnectToastOf({ connected: [THIS_DEVICE_PRINTER], failed: [] }), { tone: "success", text: "The printer connected." }, "simple mode: a sentence starts with a capital");
  assert.deepEqual(
    reconnectToastOf({ connected: [], failed: [THIS_DEVICE_PRINTER] }),
    { tone: "error", text: "Could not connect the printer. Check it is on, then tap Reconnect again." },
    "simple mode, failed",
  );
});
