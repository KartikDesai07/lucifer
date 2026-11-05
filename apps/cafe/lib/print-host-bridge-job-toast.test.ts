import "@/lib/hook-harness"; // installs the stubs: MUST stay the first import
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import { usePrintHostBridge } from "@/hooks/use-print-host-bridge";
import { mountHook, resetStubs, stubs } from "@/lib/hook-harness";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import { JOB_MAYBE_TOAST, JOB_NOT_CONNECTED_TOAST } from "@/lib/print-job-toast";
import { PRINT_HOST_DISPATCH_TIMEOUT_MS, PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// PX-2 Task 7 (spec §6.9 B7), driven through the REAL bridge body (lib/hook-harness.ts): the one toast a failed write
// raises follows the job for a slip printed for a print job, and keeps today's words for any other slip. What the job
// hears (its lastError) is the lane's sentence, unchanged.

const slipOf = (title: string, jobId?: string): HostPrintSlip =>
  ({ surface: "kot", documentTitle: title, kotVariant: "kot", order: {}, ...(jobId !== undefined ? { jobId } : {}) }) as unknown as HostPrintSlip;

function scene(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  resetStubs();
  const hook = mountHook(() => usePrintHostBridge({ surfacesMounted: true }));
  hook.result().kotRef.current = { textContent: "KOT TEXT" } as HTMLDivElement;
  const heard: string[] = [];
  const done = (result: PrintAgentResult): void => void heard.push(result.ok ? "printed" : `failed: ${(result.error as Error).message}`);
  return {
    heard,
    queue: (slip: HostPrintSlip) => hook.act(() => hook.result().queueSlip(slip, done)),
    fail: (message: string) => hook.act(() => stubs.options[0]?.onPrintError?.("print", new Error(message))),
    finish: () => hook.act(() => stubs.options[0]?.onAfterPrint?.()),
    tick: (ms: number) => hook.act(() => t.mock.timers.tick(ms)),
  };
}

test("a job's slip whose printer is not connected: the slip waits and prints by itself; the job still hears the lane's sentence", (t) => {
  const s = scene(t);
  s.queue(slipOf("KOT-1", "job-1"));
  s.fail(PRINTER_NOT_CONNECTED_MESSAGE);
  assert.deepEqual(stubs.toasts, [JOB_NOT_CONNECTED_TOAST], "never 'then print the slip again' for a job that prints by itself");
  assert.deepEqual(s.heard, [`failed: ${PRINTER_NOT_CONNECTED_MESSAGE}`], "its lastError stays the lane constant (printWriteOutcomeOf reads it)");
});

test("a job's slip that may be on paper: check the paper; the watchdog says the same", (t) => {
  const s = scene(t);
  s.queue(slipOf("KOT-1", "job-1"));
  s.fail(PRINTER_WRITE_FAILED_MESSAGE);
  assert.deepEqual(stubs.toasts, [JOB_MAYBE_TOAST], "a write that stopped answering");
  s.queue(slipOf("KOT-2", "job-2"));
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS);
  assert.deepEqual(stubs.toasts, [JOB_MAYBE_TOAST, JOB_MAYBE_TOAST], "the watchdog gave the job's slip up: it may be on paper");
});

test("a slip with no job keeps today's words, also right behind a job's slip", (t) => {
  const s = scene(t);
  s.queue(slipOf("KOT-1", "job-1"));
  s.queue(slipOf("REPRINT-1"));
  s.finish();
  assert.deepEqual(s.heard, ["printed"], "landmark: the job's slip printed, the direct one is on the paper now");
  s.fail(PRINTER_NOT_CONNECTED_MESSAGE);
  assert.deepEqual(stubs.toasts, [PRINTER_NOT_CONNECTED_MESSAGE], "a direct reprint: today's words");
  s.queue(slipOf("REPRINT-2"));
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS);
  assert.deepEqual(stubs.toasts, [PRINTER_NOT_CONNECTED_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE], "the watchdog on a direct slip: today's words");
});
