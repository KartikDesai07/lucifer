import "@/lib/hook-harness"; // installs the react / react-to-print / sonner stubs: MUST stay the first import
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mountHook, resetStubs, stubModule, stubs, type MountedHook } from "@/lib/hook-harness";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_BUSY_MESSAGE, PRINT_HOST_DISPATCH_TIMEOUT_MS, PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
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

test("m-2: a writer that throws at once settles the slip as a failed write, and the next slip goes (the 4B gate)", async (t) => {
  const s = scene(t);
  let calls = 0;
  const throwing: TextKotWrite = {
    bytes: BYTES,
    write: () => {
      calls += 1;
      throw new Error(PRINTER_NOT_CONNECTED_MESSAGE);
    },
  };
  world.answer = (input) => (input.slip.documentTitle === "KOT-1" ? throwing : null);
  s.queue("kot", "KOT-1");
  s.queue("kot", "KOT-2");
  await s.settled();
  assert.equal(calls, 1, "the write was tried once, right away");
  assert.deepEqual(s.outcomes, [`failed: ${PRINTER_NOT_CONNECTED_MESSAGE}`], "the slip settles with the printer's sentence, as a failed write");
  assert.deepEqual(stubs.toasts, [PRINTER_NOT_CONNECTED_MESSAGE], "staff see it, as for a picture");
  assert.deepEqual(world.asked, ["KOT-1", "KOT-2"], "the bridge was freed: the next slip was asked");
  assert.deepEqual(stubs.printed, ["kot"], "and printed as its picture");
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

test("spec §5.1: a printer's text test rides the test slip's busy window, written through its own writer", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  let answered: string | null = null;
  void s.hook.result().queueTestSlip(held.answer.write).then(
    () => (answered = "printed"),
    (error: Error) => (answered = error.message),
  );
  assert.equal(held.calls, 1, "the test's bytes went to the printer's writer");
  assert.deepEqual(stubs.printed, [], "the attestation slip's picture never fired");
  assert.deepEqual(world.asked, [], "a test is not a job's slip: the text step is not asked");
  s.queue("kot", "KOT-1");
  assert.deepEqual(world.asked, [], "a slip that arrives meanwhile waits");
  held.resolve();
  await s.settled();
  assert.equal(answered, "printed", "the section hears it printed");
  assert.deepEqual(world.asked, ["KOT-1"], "then the waiting slip goes");
  assert.deepEqual(s.outcomes, [], "the test's end is never the waiting slip's outcome (the review's m-1)");
  s.finish();
  assert.deepEqual(s.outcomes, ["printed"], "the slip's own outcome when its picture is done");
});

test("a text test that fails, or a busy device, leaves the section the printer's own sentence", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  const failed = s.hook.result().queueTestSlip(held.answer.write).catch((error: Error) => error.message);
  const busy = s.hook.result().queueTestSlip(held.answer.write).catch((error: Error) => error.message);
  assert.equal(await busy, PRINT_HOST_BUSY_MESSAGE, "a second test is refused, never queued");
  held.reject(new Error(PRINTER_NOT_CONNECTED_MESSAGE));
  await s.settled();
  assert.equal(await failed, PRINTER_NOT_CONNECTED_MESSAGE, "the printer's sentence");
  assert.equal(s.hook.result().current, null, "the bridge is free");
});

test("m-2: a text test whose writer throws at once is refused with the printer's sentence, and frees the bridge (the 4B gate)", async (t) => {
  const s = scene(t);
  let failed: Promise<string> = Promise.resolve("never queued");
  try {
    failed = s.hook.result().queueTestSlip(() => {
      throw new Error(PRINTER_NOT_CONNECTED_MESSAGE);
    }).then(
      () => "printed",
      (error: Error) => error.message,
    );
  } catch (error) {
    failed = Promise.resolve(`escaped: ${error instanceof Error ? error.message : String(error)}`);
  }
  await s.settled();
  assert.equal(await failed, PRINTER_NOT_CONNECTED_MESSAGE, "the section hears the printer's sentence");
  assert.equal(s.hook.result().current, null, "the bridge is free");
});
