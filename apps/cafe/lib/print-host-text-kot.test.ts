import "@/lib/hook-harness"; // installs the react / react-to-print / sonner stubs: MUST stay the first import
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mountHook, resetStubs, stubModule, stubs, type MountedHook } from "@/lib/hook-harness";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_DISPATCH_TIMEOUT_MS, PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
import type { TextKotWrite, TextKotWriteInput } from "@/lib/printer/kot-text/text-kot-print";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing Phase 4 (spec 2026-10-15 §5.2, S1, S3, S4): the print bridge's text step, driven through the REAL hook body
// (lib/hook-harness.ts) with the text step stubbed. A kitchen slip the text step answers goes through that write, never
// the picture, under the same busy window, watchdog and outcome; one it answers null for fires the picture as before.

const world: { answer: (input: TextKotWriteInput) => TextKotWrite | null; asked: string[] } = { answer: () => null, asked: [] };
stubModule("@/lib/printer/kot-text/text-kot-print", {
  textKotEnv: () => ({}),
  textKotWriteFor: (input: TextKotWriteInput) => {
    world.asked.push(input.slip.documentTitle);
    return world.answer(input);
  },
}); // BEFORE the bridge loads
const load = createRequire(__filename);
const { usePrintHostBridge } = load("@/hooks/use-print-host-bridge") as typeof import("@/hooks/use-print-host-bridge");

type Bridge = ReturnType<typeof usePrintHostBridge>;
const BYTES = Uint8Array.from([0x1b, 0x40, 0x41, 0x0a]);
const slipOf = (surface: HostPrintSlip["surface"], title: string): HostPrintSlip => ({ surface, documentTitle: title, kotVariant: "kot", order: {} }) as unknown as HostPrintSlip;

interface Held {
  calls: number;
  resolve(): void;
  reject(error: Error): void;
}
/** A text write the test settles by hand. */
function heldWrite(): Held & { answer: TextKotWrite } {
  const held = { calls: 0, resolve: () => undefined, reject: (_error: Error) => undefined } as Held;
  const answer: TextKotWrite = {
    bytes: BYTES,
    write: () => {
      held.calls += 1;
      return new Promise<void>((resolve, reject) => {
        held.resolve = resolve;
        held.reject = reject;
      });
    },
  };
  return Object.assign(held, { answer });
}

function scene(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  resetStubs();
  world.asked = [];
  world.answer = () => null;
  const hook: MountedHook<Bridge> = mountHook(() => usePrintHostBridge({ surfacesMounted: true }));
  for (const ref of [hook.result().kotRef, hook.result().receiptRef, hook.result().eodRef]) ref.current = { textContent: "A SLIP" } as HTMLDivElement;
  const outcomes: string[] = [];
  const done: HostPrintDone = (result) => void outcomes.push(result.ok ? "printed" : `failed: ${result.error instanceof Error ? result.error.message : String(result.error)}`);
  return {
    hook,
    outcomes,
    queue: (surface: HostPrintSlip["surface"], title: string) => hook.act(() => hook.result().queueSlip(slipOf(surface, title), done)),
    /** react-to-print reports the picture done (the KOT surface's onAfterPrint). */
    finish: () => hook.act(() => stubs.options[0]?.onAfterPrint?.()),
    settled: async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
      hook.rerender();
    },
  };
}

test("S1: a kitchen slip the text step answers nothing for fires the picture, exactly as before", async (t) => {
  const s = scene(t);
  s.queue("kot", "KOT-1");
  assert.deepEqual(world.asked, ["KOT-1"], "the text step was asked, once");
  assert.deepEqual(stubs.printed, ["kot"], "the picture: the KOT surface fired");
  s.finish();
  assert.deepEqual(s.outcomes, ["printed"], "the picture's own outcome");
  assert.equal(s.hook.result().current, null, "the bridge is free");
});

test("text: the slip's bytes go through its printer's writer, never the picture, and the slip settles with the write", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  world.answer = () => held.answer;
  s.queue("kot", "KOT-1");
  assert.equal(held.calls, 1, "one write");
  assert.deepEqual(stubs.printed, [], "the KOT surface never fired");
  assert.equal(s.hook.result().busy, true, "the busy window holds while the write is out");
  held.resolve();
  await s.settled();
  assert.deepEqual(s.outcomes, ["printed"], "printed when the write is done");
  assert.equal(s.hook.result().current, null, "the bridge is free");
  assert.deepEqual(stubs.toasts, [], "no message");
});

test("a text write that fails settles with the writer's own sentence, as the picture's failure does", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  world.answer = () => held.answer;
  s.queue("kot", "KOT-1");
  held.reject(new Error(PRINTER_NOT_CONNECTED_MESSAGE));
  await s.settled();
  assert.deepEqual(s.outcomes, [`failed: ${PRINTER_NOT_CONNECTED_MESSAGE}`], "the agent hears the printer's sentence (sent: no, never counted)");
  assert.deepEqual(stubs.toasts, [PRINTER_NOT_CONNECTED_MESSAGE], "and staff see it, as for a picture");
});

test("the watchdog bounds a text write as it bounds a picture", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  world.answer = () => held.answer;
  s.queue("kot", "KOT-1");
  s.hook.act(() => t.mock.timers.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS));
  assert.deepEqual(stubs.toasts, [PRINT_HOST_PRINT_FAILED_MESSAGE], "given up and said so");
  s.queue("kot", "KOT-2");
  assert.equal(held.calls, 1, "the next slip waits while the abandoned write may still be printing");
  held.resolve();
  await s.settled();
  assert.equal(held.calls, 2, "the late completion released the bridge: the next slip went (as text: the same answer)");
});

test("slips print in order: the next waits for the text write", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  world.answer = (input) => (input.slip.documentTitle === "KOT-1" ? held.answer : null);
  s.queue("kot", "KOT-1");
  s.queue("kot", "KOT-2");
  assert.deepEqual(world.asked, ["KOT-1"], "the second slip waits");
  assert.deepEqual(stubs.printed, [], "nothing fired yet");
  held.resolve();
  await s.settled();
  assert.deepEqual(world.asked, ["KOT-1", "KOT-2"], "then the second is asked");
  assert.deepEqual(stubs.printed, ["kot"], "and prints as a picture (its answer was null)");
  s.finish();
  assert.deepEqual(s.outcomes, ["printed", "printed"], "each slip's own outcome, in order");
});

test("a bill, a token, End of day and the attestation test slip never ask the text step", async (t) => {
  const s = scene(t);
  world.answer = () => {
    throw new Error("never asked");
  };
  s.queue("receipt", "BILL-1");
  assert.deepEqual(stubs.printed, ["receipt"], "the bill's picture");
  s.hook.act(() => stubs.options[1]?.onAfterPrint?.());
  s.queue("token", "TOKEN-1");
  assert.deepEqual(stubs.printed, ["receipt", "receipt"], "the token's picture");
  s.hook.act(() => stubs.options[1]?.onAfterPrint?.());
  const test = s.hook.result().queueTestSlip();
  assert.deepEqual(stubs.printed, ["receipt", "receipt", "kot"], "the attestation test slip's picture");
  s.finish();
  await test;
  assert.deepEqual(world.asked, [], "the text step was never asked");
});
