import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHostSlipTickets, dispatchSlip, laneWriteEnd, settleOrRelease, withdrawSlip, type HostPrintResult } from "@/lib/print-host-tickets";
import { PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { PrintWriteError, hostPrintFailureMessage, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { laneWrite, nativeLaneKey } from "@/lib/printer/lane-writes";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";

// Phase 6 Session 6A Task 4: the print bridge's bookkeeping around its tickets (lib/print-host-tickets.ts), each helper on
// its own; hooks/use-print-host-bridge.ts wires them (lib/print-host-bridge-lanes.test.ts drives the real hook).

const tick = () => new Promise<void>((r) => setImmediate(r));
function recorder() {
  const results: HostPrintResult[] = [];
  return { results, done: (r: HostPrintResult) => void results.push(r) };
}

describe("the bridge's bookkeeping helpers (Phase 6 Task 4, spec §9 rulings 8–12)", () => {
  const NATIVE = { paper: "80mm" as const, nativeId: "tcp:127.0.0.1:9101" };
  const unarmed = (): boolean => {
    const never = new Promise<void>(() => undefined);
    return laneWrite(nativeLaneKey(NATIVE.nativeId), () => never) === never;
  };

  it("settleOrRelease settles a slip the surface drew, and only frees one handed off to its lane", async () => {
    const t = createHostSlipTickets();
    const [a, b] = [recorder(), recorder()];
    const [ta, tb] = [t.add(a.done), t.add(b.done)];
    t.dispatched(ta);
    t.dispatched(tb);
    t.handOff(tb, async () => {}, 1, () => {});
    assert.equal(settleOrRelease(t, null, { ok: true }), false, "no ticket: nothing to answer");
    assert.equal(settleOrRelease(t, ta, { ok: false, error: new Error("x") }), false, "a slip drawn: settled by the surface");
    assert.equal(settleOrRelease(t, tb, { ok: false, error: new Error("surface") }), true, "a slip handed off: only freed");
    await tick();
    assert.deepEqual([a.results.map((r) => r.ok), b.results], [[false], [{ ok: true, written: 1 }]], "each hears once, B by its write");
  });

  it("dispatchSlip arms only a two-step slip's printer, written `writes` times", async () => {
    const t = createHostSlipTickets();
    for (const slip of [null, { surface: "kot" }, { surface: "kot", target: { paper: "80mm" as const, printerName: "TVS" } }, { surface: "test", target: NATIVE }]) {
      dispatchSlip(t, t.add(null), slip, () => {});
      assert.ok(unarmed(), `one step, nothing armed: ${JSON.stringify(slip)}`);
    }
    dispatchSlip(t, null, { surface: "kot", target: NATIVE }, () => {});
    assert.ok(unarmed(), "no ticket: nothing armed");
    const r = recorder();
    const disarm = dispatchSlip(t, t.add(r.done), { surface: "kot", target: NATIVE, writes: 2 }, () => {});
    let writes = 0;
    await laneWrite(nativeLaneKey(NATIVE.nativeId), async () => void (writes += 1));
    await tick();
    assert.deepEqual([writes, r.results], [2, [{ ok: true, written: 2 }]], "the next write of that printer went to the ticket, twice");
    assert.ok(unarmed(), "the arm is one-shot");
    disarm();
  });

  it("withdrawSlip answers a queued slip or the current undispatched one sent no; a drawn one stays", () => {
    const t = createHostSlipTickets();
    const r = recorder();
    const [current, queued, drawn] = [t.add(r.done), t.add(r.done), t.add(r.done)];
    const queue = [{ ticket: queued }];
    t.dispatched(drawn);
    assert.deepEqual([withdrawSlip(t, queue, current, queued), queue.length], ["queue", 0], "taken off the queue");
    assert.equal(withdrawSlip(t, queue, current, current), "current", "the current slip, its dispatch still waiting");
    assert.equal(withdrawSlip(t, queue, drawn, drawn), null, "a slip drawn is waited for");
    assert.equal(withdrawSlip(t, queue, null, queued), null, "a slip already answered");
    assert.deepEqual(r.results.map((x) => (x.ok ? "printed" : printWriteOutcomeOf(x.error).sent)), ["no", "no"], "sent no, once each");
  });

  it("laneWriteEnd says a failure once, in the sentence its ticket carries, with its own slip's job; the end is always told", () => {
    const said: string[] = [];
    let ends = 0;
    const end = laneWriteEnd((failure, jobId) => void said.push(`${jobId}:${failure}`), () => void (ends += 1));
    const tk = createHostSlipTickets().add(null, "job-1");
    end(tk, { ok: true, written: 1 });
    for (const message of ["socket closed", PRINTER_NOT_CONNECTED_MESSAGE]) end(tk, { ok: false, error: new Error(hostPrintFailureMessage(new Error(message))) });
    // Fix round 1 (m-3): the ticket's sentence is already mapped once (hostPrintFailureMessage); on the Windows app an
    // unwrapped sentence of its own would not survive a second mapping, so it is said as it is.
    const windows = "The Windows app's own sentence, unwrapped once.";
    end(tk, { ok: false, error: new PrintWriteError(windows, "maybe") });
    end(tk, { ok: false, error: "not an Error" });
    const failed = PRINT_HOST_PRINT_FAILED_MESSAGE;
    assert.deepEqual(said, [`job-1:${failed}`, `job-1:${PRINTER_NOT_CONNECTED_MESSAGE}`, `job-1:${windows}`, `job-1:${failed}`], "the words the surface's settle would use, never mapped twice");
    assert.equal(ends, 5, "every end re-reads `busy`");
  });
});
