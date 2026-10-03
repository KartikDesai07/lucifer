import "@/lib/hook-harness"; // installs the stubs: MUST stay the first import
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import { usePrintHostBridge, type HostPrintCurrent } from "@/hooks/use-print-host-bridge";
import { mountHook, resetStubs, stubs, type MountedHook } from "@/lib/hook-harness";
import { PRINT_HOST_LATE_COMPLETION_GRACE_MS } from "@/lib/print-host-late-completion";
import {
  PRINT_HOST_DISPATCH_TIMEOUT_MS,
  PRINT_HOST_PRINT_FAILED_MESSAGE,
  type HostPrintSlip,
} from "@/lib/print-host-slips";

// s63 fix round FX-A, W-A (b) -- the host bridge's LATE-COMPLETION guard, driven
// through the REAL hook body (lib/hook-harness.ts). react-to-print reports a job's
// end through ONE shared onAfterPrint, with no job identity. When the dispatch
// watchdog gave job A up and freed the bridge, A's own completion -- a print dialog
// closed minutes later -- arrived while B was in flight and settled B. The fix keeps
// A's slot occupied ("abandoned") until A reports, or a grace period passes.

type Bridge = ReturnType<typeof usePrintHostBridge>;

const slip = (title: string): HostPrintSlip =>
  ({ surface: "kot", documentTitle: title, kotVariant: "kot", order: {} }) as unknown as HostPrintSlip;
const titleOf = (current: HostPrintCurrent | null): string | null =>
  current?.kind === "slip" ? current.slip.documentTitle : current?.kind === "test" ? "<test>" : null;

interface Scene {
  hook: MountedHook<Bridge>;
  queue(title: string): void;
  tick(ms: number): void;
  /** react-to-print's onAfterPrint of the KOT surface (every job here prints on it). */
  finish(): void;
  printFailed(): void;
  current(): string | null;
}

function scene(t: TestContext): Scene {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  resetStubs();
  const hook = mountHook(() => usePrintHostBridge({ surfacesMounted: true }));
  hook.result().kotRef.current = { textContent: "KOT TEXT" } as HTMLDivElement;
  return {
    hook,
    queue: (title) => hook.act(() => hook.result().queueSlip(slip(title))),
    tick: (ms) => hook.act(() => t.mock.timers.tick(ms)),
    finish: () => hook.act(() => stubs.options[0]?.onAfterPrint?.()),
    printFailed: () => hook.act(() => stubs.options[0]?.onPrintError?.("print", new Error("late failure"))),
    current: () => titleOf(hook.result().current),
  };
}

test("W-A(b) the arbiter's ordering: dispatch A, watchdog gives up, B queued, A's LATE onAfterPrint arrives -> B is still in flight and settles only on ITS completion", (t) => {
  const s = scene(t);
  s.queue("A");
  assert.deepEqual(stubs.printed, ["kot"], "A was dispatched");
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS);
  assert.deepEqual(stubs.toasts, [PRINT_HOST_PRINT_FAILED_MESSAGE], "the watchdog says so, once");
  s.queue("B");
  s.finish(); // A's own completion, finally
  assert.equal(s.current(), "B", "A's completion must never settle the job dispatched after the watchdog");
  assert.equal(s.hook.result().busy, true);
  assert.deepEqual(stubs.printed, ["kot", "kot"], "B was dispatched exactly once, after A reported");
  s.finish(); // B's own completion
  assert.equal(s.current(), null);
  assert.equal(s.hook.result().busy, false);
  assert.deepEqual(stubs.toasts, [PRINT_HOST_PRINT_FAILED_MESSAGE], "no second toast for the late completion");
});

test("W-A(b) an abandoned job keeps the bridge OCCUPIED: a slip queued after the watchdog waits instead of tearing down A's iframe", (t) => {
  const s = scene(t);
  s.queue("A");
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS);
  s.queue("B");
  assert.deepEqual(stubs.printed, ["kot"], "B must not be dispatched while A may still be on the iframe");
  assert.equal(s.current(), "A");
  assert.equal(s.hook.result().busy, true, "the claiming lanes keep waiting");
});

test("W-A(b) a late onPrintError of the abandoned job releases the bridge silently (no second toast) and the queued slip goes next", (t) => {
  const s = scene(t);
  s.queue("A");
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS);
  s.queue("B");
  s.printFailed();
  assert.deepEqual(stubs.toasts, [PRINT_HOST_PRINT_FAILED_MESSAGE], "the failure was already announced");
  assert.equal(s.current(), "B");
  assert.deepEqual(stubs.printed, ["kot", "kot"]);
});

test("W-A(b) no late completion at all: after PRINT_HOST_LATE_COMPLETION_GRACE_MS the bridge releases silently and the queued slip goes next", (t) => {
  const s = scene(t);
  s.queue("A");
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS);
  s.queue("B");
  s.tick(PRINT_HOST_LATE_COMPLETION_GRACE_MS - 1);
  assert.equal(s.current(), "A", "one ms before the grace ends it is still held");
  s.tick(1);
  assert.equal(s.current(), "B");
  assert.deepEqual(stubs.printed, ["kot", "kot"]);
  assert.deepEqual(stubs.toasts, [PRINT_HOST_PRINT_FAILED_MESSAGE]);
  s.finish();
  assert.equal(s.hook.result().busy, false);
});

test("W-A(b) grace over with nothing queued: the bridge is simply idle again", (t) => {
  const s = scene(t);
  s.queue("A");
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS);
  assert.equal(s.hook.result().busy, true, "still held while the grace runs");
  s.tick(PRINT_HOST_LATE_COMPLETION_GRACE_MS);
  assert.equal(s.hook.result().busy, false);
  assert.deepEqual(stubs.toasts, [PRINT_HOST_PRINT_FAILED_MESSAGE]);
});

test("W-A(b) a pending test slip is rejected AT the watchdog (its caller must not wait out the grace) and is not resolved by the late completion", async (t) => {
  const s = scene(t);
  let outcome: Promise<string> = Promise.resolve("never asked");
  s.hook.act(() => {
    outcome = s.hook.result().queueTestSlip().then(() => "resolved", (error: Error) => error.message);
  });
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS);
  s.finish();
  assert.equal(await outcome, PRINT_HOST_PRINT_FAILED_MESSAGE);
  assert.deepEqual(stubs.toasts, [PRINT_HOST_PRINT_FAILED_MESSAGE]);
});

test("the happy path is unchanged: a completion before the watchdog frees the bridge, toasts nothing, and the cleared watchdog never fires", (t) => {
  const s = scene(t);
  s.queue("A");
  s.finish();
  assert.equal(s.hook.result().busy, false);
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS + PRINT_HOST_LATE_COMPLETION_GRACE_MS);
  assert.deepEqual(stubs.toasts, []);
  assert.equal(s.hook.result().busy, false);
});

test("a second slip queued while the first is in flight (no watchdog involved) still waits its turn", (t) => {
  const s = scene(t);
  s.queue("A");
  s.queue("B");
  assert.deepEqual(stubs.printed, ["kot"]);
  s.finish();
  assert.equal(s.current(), "B");
  assert.deepEqual(stubs.printed, ["kot", "kot"]);
});

test("budget: the dispatch watchdog plus the late-completion grace stays under three minutes", () => {
  assert.equal(PRINT_HOST_LATE_COMPLETION_GRACE_MS, 30_000);
  assert.ok(PRINT_HOST_DISPATCH_TIMEOUT_MS + PRINT_HOST_LATE_COMPLETION_GRACE_MS < 3 * 60 * 1000);
});

// Session 1C final review I1: the print agent acks what the bridge tells it. A slip the watchdog gave up
// on that never reported may or may not be on paper, so its caller must hear a failure ("maybe" for the
// agent), never "printed"; a late completion inside the grace still says what really happened.
test("Session 1C: a slip that never reports tells its caller it failed (may have printed); a late completion inside the grace still counts", (t) => {
  const s = scene(t);
  const heard: string[] = [];
  const done = (result: { ok: boolean; error?: unknown }) =>
    heard.push(result.ok ? "printed" : `failed: ${result.error instanceof Error ? result.error.message : "?"}`);
  s.hook.act(() => s.hook.result().queueSlip(slip("A"), done));
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS);
  s.tick(PRINT_HOST_LATE_COMPLETION_GRACE_MS);
  assert.deepEqual(heard, [`failed: ${PRINT_HOST_PRINT_FAILED_MESSAGE}`], "the grace ran out with no report: never 'printed'");
  assert.deepEqual(stubs.toasts, [PRINT_HOST_PRINT_FAILED_MESSAGE], "announced once, at the watchdog");
  s.hook.act(() => s.hook.result().queueSlip(slip("B"), done));
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS);
  s.finish(); // B's own completion, late but inside the grace
  assert.deepEqual(heard.slice(1), ["printed"], "a late completion is the slip's real result");
  s.tick(PRINT_HOST_LATE_COMPLETION_GRACE_MS);
  assert.equal(heard.length, 2, "each caller hears once");
  assert.equal(s.hook.result().busy, false, "the bridge is idle again");
});
