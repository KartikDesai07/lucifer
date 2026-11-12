import "@/lib/hook-harness"; // installs the stubs: MUST stay the first import
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { UseReactToPrintOptions } from "react-to-print";

import { SURFACE_ORDER, mountHook, resetStubs, stubModule, stubs } from "@/lib/hook-harness";
import { PRINT_HOST_NOT_DRAWN_MESSAGE, type HostPrintResult } from "@/lib/print-host-tickets";
import type { HostPrintSlip, SlipPrintTarget } from "@/lib/print-host-slips";
import { laneKeyOfTarget, laneWrite } from "@/lib/printer/lane-writes";

// Phase 6 Task 4 fix round 1 (the review's I-1), driven through the REAL bridge body (lib/hook-harness.ts). In a raster
// runtime react-to-print hands the bridge a new print function every render, so every re-render while a slip is on the
// surface queues a dispatch-effect run; react-dom 19 runs a commit's passive effects in a later task, so the slip's own
// end (a print's onAfterPrint, a withdraw's timer) can settle it in between. That stale run must never draw the settled
// slip again, nor hand its bytes to the next slip's ticket: the dispatch effect acts only for the ticket on the surface.

let calls = 0;
stubModule("react-to-print", {
  // As react-to-print in a raster runtime: a new function every render; it prints that render's slip (its title).
  useReactToPrint: (options: UseReactToPrintOptions) => {
    const index = calls++ % SURFACE_ORDER.length;
    stubs.options[index] = options;
    return () => void stubs.printed.push(`${SURFACE_ORDER[index]}:${String(options.documentTitle)}`);
  },
}); // BEFORE the bridge loads
const load = createRequire(__filename);
const { usePrintHostBridge } = load("@/hooks/use-print-host-bridge") as typeof import("@/hooks/use-print-host-bridge");

const native = (n: number): SlipPrintTarget => ({ paper: "80mm", nativeId: `tcp:127.0.0.1:910${n}` });
const slipOf = (name: string, target?: SlipPrintTarget): HostPrintSlip =>
  ({ surface: "kot", documentTitle: name, kotVariant: "kot", order: {}, jobId: name, ...(target !== undefined ? { target } : {}) }) as unknown as HostPrintSlip;

interface Held {
  promise: Promise<void>;
  resolve(): void;
}
function held(): Held {
  const out = {} as Held;
  out.promise = new Promise<void>((resolve) => Object.assign(out, { resolve }));
  return out;
}

function scene(t: TestContext, mounted = true) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  resetStubs();
  const world = { mounted };
  const hook = mountHook(() => usePrintHostBridge({ surfacesMounted: world.mounted }));
  t.after(() => hook.unmount());
  hook.result().kotRef.current = { textContent: "KOT TEXT" } as HTMLDivElement;
  const heard: string[] = [];
  const handles = new Map<string, { withdraw(): boolean }>();
  const say = (name: string) => (result: HostPrintResult) => void heard.push(`${name}:${result.ok ? "printed" : (result.error as Error).message}`);
  return {
    hook,
    heard,
    queue: (name: string, target?: SlipPrintTarget) => hook.act(() => void handles.set(name, hook.result().queueSlip(slipOf(name, target), say(name)))),
    withdraw: (name: string) => hook.act(() => void handles.get(name)?.withdraw()),
    /** What lib/printer/lane-print.ts does for a slip on a lane: its bytes through laneWrite, then the surface's end. */
    handOff: (target: SlipPrintTarget, write: Held) => void laneWrite(laneKeyOfTarget(target) ?? "", () => write.promise),
    finish: () => hook.act(() => stubs.options[0]?.onAfterPrint?.()),
    mount: () => {
      world.mounted = true;
      hook.rerender();
    },
    settled: async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
  };
}

test("a one-step slip: a dispatch run held past its settle never draws it again, and the next slip is drawn by its own run", (t) => {
  const s = scene(t);
  s.queue("B");
  s.queue("C");
  assert.deepEqual(stubs.printed, ["kot:B"], "B is drawn; C waits");
  s.hook.holdEffects();
  s.hook.rerender(); // a re-render while B is on the surface: its dispatch run waits for a later task
  s.finish(); // B's own end lands first: C is promoted, then the held run goes
  assert.deepEqual(stubs.printed, ["kot:B", "kot:C"], "B is never drawn again; C is drawn exactly once, as itself");
  s.finish();
  assert.deepEqual(s.heard, ["B:printed", "C:printed"], "each caller hears its own slip's end");
});

test("a two-step slip: a held run never hands the settled slip's bytes to the next slip's ticket", async (t) => {
  const s = scene(t);
  const [b, again, c] = [held(), held(), held()];
  s.queue("B", native(1));
  s.queue("C", native(2));
  s.hook.holdEffects();
  s.hook.rerender();
  s.handOff(native(1), b);
  s.finish(); // B's bytes are on its lane, the surface frees, C is promoted, then the held run goes
  assert.deepEqual(stubs.printed, ["kot:B", "kot:C"], "B is never drawn again; C is drawn exactly once, as itself");
  s.handOff(native(1), again); // B's printer is written again (a stale draw would): it must not be C's
  again.resolve();
  await s.settled();
  assert.deepEqual(s.heard, [], "no caller hears another slip's write");
  s.handOff(native(2), c);
  s.finish();
  c.resolve();
  b.resolve();
  await s.settled();
  assert.deepEqual(s.heard, ["C:printed", "B:printed"], "each caller hears its own write");
});

test("withdraw: a current slip taken back before its dispatch is never drawn by a held run", (t) => {
  const s = scene(t, false);
  s.queue("A");
  s.queue("B");
  s.hook.holdEffects();
  s.mount(); // the surfaces mount: A's dispatch run waits for a later task
  s.withdraw("A"); // its bound passes first: A is answered and B promoted, then the held run goes
  assert.deepEqual(stubs.printed, ["kot:B"], "A is never drawn; B is drawn by its own run");
  s.finish();
  assert.deepEqual(s.heard, [`A:${PRINT_HOST_NOT_DRAWN_MESSAGE}`, "B:printed"], "A: sent no; B: its own end");
});
