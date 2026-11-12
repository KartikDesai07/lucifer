import "@/lib/hook-harness"; // installs the stubs: MUST stay the first import
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

import { usePrintHostBridge } from "@/hooks/use-print-host-bridge";
import { mountHook, resetStubs, stubs } from "@/lib/hook-harness";
import { PRINT_HOST_NOT_DRAWN_MESSAGE, type HostPrintResult } from "@/lib/print-host-tickets";
import { JOB_NOT_CONNECTED_TOAST, slipToastOf } from "@/lib/print-job-toast";
import { PRINT_HOST_BUSY_MESSAGE, PRINT_HOST_DISPATCH_TIMEOUT_MS, PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip, type SlipPrintTarget } from "@/lib/print-host-slips";
import { laneKeyOfTarget, laneWrite } from "@/lib/printer/lane-writes";
import { RASTER_FAILED_MESSAGE } from "@/lib/printer/raster";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";

// Phase 6 Session 6A Task 4 (spec §9 rulings 8–14), driven through the REAL bridge body (lib/hook-harness.ts): a slip for
// one of the POS app's printers (bridge v2, `nativeId`) or a Windows app network printer (`lan`) is drawn on the one
// surface, its bytes are handed to that printer's lane (lib/printer/lane-writes.ts), and the surface frees for the next
// slip while they are written; each caller hears its own write's result. A "draw" here is what lib/printer/lane-print.ts
// does for such a slip: the writer's laneWrite(key, write), then the KOT surface's onAfterPrint.

const native = (n: number): SlipPrintTarget => ({ paper: "80mm", nativeId: `tcp:127.0.0.1:910${n}` });
const LAN: SlipPrintTarget = { paper: "80mm", lan: { host: "10.0.0.9", port: 9100 } };
const slipOf = (name: string, target: SlipPrintTarget | undefined, extra: Partial<HostPrintSlip>): HostPrintSlip =>
  ({ surface: "kot", documentTitle: name, kotVariant: "kot", order: {}, jobId: name, ...(target !== undefined ? { target } : {}), ...extra }) as unknown as HostPrintSlip;
const said = (name: string, result: HostPrintResult): string => `${name}:${result.ok ? "printed" : (result.error as Error).message}`;
const IDLE = { current: null, drawing: false, busy: false };

interface Held {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}
/** A printer write the test ends by hand. */
function held(): Held {
  const out = {} as Held;
  out.promise = new Promise<void>((resolve, reject) => Object.assign(out, { resolve, reject }));
  out.promise.catch(() => undefined);
  return out;
}

/** Nothing is armed for that printer: laneWrite hands back the write's own promise (an armed key answers at once). */
function unarmed(target: SlipPrintTarget): boolean {
  const never = new Promise<void>(() => undefined);
  return laneWrite(laneKeyOfTarget(target) ?? "", () => never) === never;
}

function scene(t: TestContext, mounted = true) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  resetStubs();
  const world = { mounted, gone: false };
  const hook = mountHook(() => usePrintHostBridge({ surfacesMounted: world.mounted }));
  hook.result().kotRef.current = { textContent: "KOT TEXT" } as HTMLDivElement;
  const unmount = (): void => {
    if (!world.gone) hook.unmount();
    world.gone = true;
  };
  t.after(unmount); // a slip left on the surface never leaves its printer armed for the next test
  const heard: string[] = [];
  const handles = new Map<string, { withdraw(): boolean } | undefined>();
  const queueOne = (name: string, target?: SlipPrintTarget, extra: Partial<HostPrintSlip> = {}): void =>
    void handles.set(name, hook.result().queueSlip(slipOf(name, target, extra), (result) => void heard.push(said(name, result))));
  return {
    heard,
    unmount,
    queue: (name: string, target?: SlipPrintTarget, extra?: Partial<HostPrintSlip>) => hook.act(() => queueOne(name, target, extra)),
    /** Several slips queued in one tick, before any re-render (the page's gate lags a render, spec ruling 14). */
    queueAll: (slips: Array<[string, SlipPrintTarget]>) => hook.act(() => slips.forEach(([name, target]) => queueOne(name, target))),
    withdraw: (name: string): boolean => {
      let out: unknown = "no handle";
      hook.act(() => void (out = handles.get(name)?.withdraw()));
      return out === true;
    },
    draw: (target: SlipPrintTarget, write: Held) =>
      hook.act(() => {
        void laneWrite(laneKeyOfTarget(target) ?? "", () => write.promise).catch(() => undefined);
        stubs.options[0]?.onAfterPrint?.();
      }),
    finish: () => hook.act(() => stubs.options[0]?.onAfterPrint?.()),
    fail: (message: string) => hook.act(() => stubs.options[0]?.onPrintError?.("print", new Error(message))),
    tick: (ms: number) => hook.act(() => t.mock.timers.tick(ms)),
    mount: () => {
      world.mounted = true;
      hook.rerender();
    },
    testSlip: (): Promise<string> => {
      let out: Promise<string> = Promise.resolve("never asked");
      hook.act(() => void (out = hook.result().queueTestSlip().then(() => "printed", (error: Error) => error.message)));
      return out;
    },
    /** The writes' own microtasks (their end re-renders the bridge by itself). */
    settled: async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
    state: () => {
      const { current, drawing, busy } = hook.result();
      return { current: current?.kind === "slip" ? current.slip.documentTitle : current?.kind === "test" ? "<test>" : null, drawing, busy };
    },
  };
}

test("a slip for one of the app's printers frees the surface once its bytes are handed off", async (t) => {
  const s = scene(t);
  const a = held();
  s.queue("A", native(1));
  assert.deepEqual(stubs.printed, ["kot"], "A is drawn on the KOT surface");
  assert.deepEqual(s.state(), { current: "A", drawing: true, busy: true }, "the surface draws A");
  s.draw(native(1), a);
  assert.deepEqual(s.state(), { current: null, drawing: false, busy: true }, "the surface is free; A's write is in flight");
  assert.deepEqual(s.heard, [], "A is answered by its write, not by the surface");
  a.resolve();
  await s.settled();
  assert.deepEqual(s.heard, ["A:printed"], "A printed once its bytes were written");
  assert.deepEqual(s.state(), IDLE, "nothing is printing");
});

test("the next slip draws while the previous one is written", async (t) => {
  const s = scene(t);
  const a = held();
  s.queue("A", native(1));
  s.queue("B", native(2));
  assert.deepEqual(stubs.printed, ["kot"], "B waits while A is drawn");
  s.draw(native(1), a);
  assert.deepEqual(stubs.printed, ["kot", "kot"], "B is dispatched at once, while A is written");
  assert.deepEqual(s.state(), { current: "B", drawing: true, busy: true }, "B is on the surface");
  assert.deepEqual(s.heard, [], "A's write is still in flight");
  a.resolve();
  await s.settled();
  assert.deepEqual(s.heard, ["A:printed"], "A hears its own write's end while B is drawn");
});

test("each slip's caller hears its own write's result", async (t) => {
  const s = scene(t);
  const [a, b, c] = [held(), held(), held()];
  s.queue("A", native(1));
  s.queue("B", native(2));
  s.queue("C", native(3), { jobId: undefined }); // a direct reprint: no job
  s.draw(native(1), a);
  s.draw(native(2), b);
  assert.equal(s.state().current, "C", "the direct reprint is on the surface while A and B are written");
  b.resolve();
  await s.settled();
  assert.deepEqual(s.heard, ["B:printed"], "B's write ended first: B hears first");
  a.reject(new Error(PRINTER_NOT_CONNECTED_MESSAGE));
  await s.settled();
  assert.deepEqual(s.heard, ["B:printed", `A:${PRINTER_NOT_CONNECTED_MESSAGE}`], "then A, with its printer's sentence");
  assert.deepEqual(stubs.toasts, [JOB_NOT_CONNECTED_TOAST], "A's toast is in A's job's words, not the direct slip's on the surface");
  s.draw(native(3), c);
  c.reject(new Error("socket closed"));
  await s.settled();
  assert.equal(s.heard.at(-1), `C:${PRINT_HOST_PRINT_FAILED_MESSAGE}`, "an unknown failure: the bridge's own sentence, as today");
  assert.deepEqual(stubs.toasts.slice(1), [slipToastOf(PRINT_HOST_PRINT_FAILED_MESSAGE, undefined)], "and today's words for a slip with no job");
});

test("a slip with no lane target holds the surface through its write", (t) => {
  const s = scene(t);
  const cases: Array<[string, SlipPrintTarget | undefined, Partial<HostPrintSlip>]> = [
    ["WINDOWS", { paper: "80mm", printerName: "Kitchen TVS" }, {}],
    ["NONE", undefined, {}],
    ["TEST", LAN, { surface: "test" }],
  ];
  for (const [name, target, extra] of cases) {
    s.queue(name, target, extra);
    assert.ok(unarmed(native(1)) && unarmed(LAN), `${name}: nothing is armed (a write of that printer is written at once)`);
    assert.deepEqual(s.state(), { current: name, drawing: true, busy: true }, `${name}: the slip holds the surface`);
    s.finish();
    assert.equal(s.heard.at(-1), `${name}:printed`, `${name}: settled at onAfterPrint, as today`);
    assert.deepEqual(s.state(), IDLE, `${name}: the bridge is free`);
  }
  assert.deepEqual(stubs.printed, ["kot", "kot", "kot"], "each drawn on the KOT surface");
});

test("a draw that fails before any byte settles the slip with that failure and disarms", (t) => {
  const s = scene(t);
  s.queue("A", native(1));
  assert.equal(s.state().drawing, true, "A is drawn");
  s.fail(RASTER_FAILED_MESSAGE);
  assert.deepEqual(s.heard, [`A:${RASTER_FAILED_MESSAGE}`], "A's caller hears the draw's own failure");
  assert.deepEqual(stubs.toasts, [slipToastOf(RASTER_FAILED_MESSAGE, "A")], "today's words, once");
  assert.ok(unarmed(native(1)), "disarmed: a later write of that printer is written at once");
  assert.deepEqual(s.state(), IDLE, "the surface is free");
});

test("the watchdog disarms the lane", (t) => {
  const s = scene(t);
  s.queue("A", native(1));
  assert.equal(s.state().drawing, true, "A is drawn");
  s.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS);
  assert.deepEqual(stubs.toasts, [slipToastOf(PRINT_HOST_PRINT_FAILED_MESSAGE, "A")], "the watchdog says so, as today");
  assert.ok(unarmed(native(1)), "A's late draw would write at once, inside its own late completion");
  assert.equal(s.state().current, "A", "the surface is held through the grace, as today");
  s.finish();
  assert.deepEqual(s.heard, ["A:printed"], "a late completion is the slip's real result (lib/print-host-bridge-late.test.ts)");
  assert.deepEqual(s.state(), IDLE, "then the bridge is free");
});

test("withdraw takes a waiting slip off the queue, sent no; the slip being drawn stays", async (t) => {
  const s = scene(t);
  const a = held();
  s.queue("A", native(1));
  s.queue("B", native(2));
  assert.equal(s.withdraw("B"), true, "B was waiting: withdrawn");
  assert.deepEqual(s.heard, [`B:${PRINT_HOST_NOT_DRAWN_MESSAGE}`], "B's caller hears it was never drawn, at once");
  assert.equal(s.withdraw("A"), false, "A is being drawn: it stays");
  assert.equal(s.withdraw("B"), false, "a second withdraw does nothing");
  s.draw(native(1), a);
  assert.deepEqual(stubs.printed, ["kot"], "B is never dispatched");
  assert.deepEqual(s.state(), { current: null, drawing: false, busy: true }, "only A's write is left");
  a.resolve();
  await s.settled();
  assert.deepEqual(s.heard, [`B:${PRINT_HOST_NOT_DRAWN_MESSAGE}`, "A:printed"], "each caller heard once");
});

test("withdraw drops the current slip while its dispatch still waits", (t) => {
  const s = scene(t, false);
  s.queue("A", native(1));
  s.queue("B", native(2));
  assert.deepEqual(stubs.printed, [], "nothing is dispatched before the surfaces mount");
  assert.equal(s.withdraw("A"), true, "A waits for the surfaces: withdrawn");
  assert.deepEqual(s.heard, [`A:${PRINT_HOST_NOT_DRAWN_MESSAGE}`], "sent no");
  assert.deepEqual(s.state(), { current: "B", drawing: true, busy: true }, "B is promoted, through the same window");
  s.mount();
  assert.deepEqual(stubs.printed, ["kot"], "once the surfaces mount only B is dispatched");
  assert.equal(s.withdraw("B"), false, "B is drawn now: it stays");
  s.finish();
  assert.deepEqual(s.heard, [`A:${PRINT_HOST_NOT_DRAWN_MESSAGE}`, "B:printed"], "B's own outcome");
  assert.deepEqual(s.state(), IDLE, "the bridge is free");
});

test("unmount answers waiting slips no and the slip on the surface maybe at once, and lets a write in flight settle by itself", async (t) => {
  const s = scene(t);
  const a = held();
  s.queue("A", native(1));
  s.queue("B", native(2));
  s.queue("C", native(3));
  s.draw(native(1), a);
  assert.equal(s.state().current, "B", "A is written, B is drawn, C waits");
  s.unmount();
  assert.deepEqual(s.heard, [`B:${PRINT_HOST_PRINT_FAILED_MESSAGE}`, `C:${PRINT_HOST_NOT_DRAWN_MESSAGE}`], "B may be on paper; C was never drawn");
  assert.ok(unarmed(native(2)), "B's printer is disarmed");
  a.resolve();
  await s.settled();
  assert.deepEqual(s.heard.slice(2), ["A:printed"], "A's write settled by itself");
});

test("a test slip is refused while a write is in flight", async (t) => {
  const s = scene(t);
  const a = held();
  s.queue("A", native(1));
  s.draw(native(1), a);
  assert.deepEqual(s.state(), { current: null, drawing: false, busy: true }, "the surface is free, A's write is in flight");
  const refused = s.testSlip();
  assert.deepEqual(stubs.printed, ["kot"], "the test slip was not drawn");
  assert.equal(await refused, PRINT_HOST_BUSY_MESSAGE, "refused, never queued");
  a.resolve();
  await s.settled();
  const test = s.testSlip();
  assert.deepEqual(stubs.printed, ["kot", "kot"], "with nothing in flight the test slip is drawn");
  s.finish();
  assert.equal(await test, "printed", "and answered");
});

test("two slips queued in one tick draw in order", async (t) => {
  const s = scene(t);
  const [a, b] = [held(), held()];
  s.queueAll([["A", native(1)], ["B", native(2)], ["C", native(3)]]);
  assert.deepEqual(stubs.printed, ["kot"], "A is dispatched; B and C wait in order");
  assert.equal(s.withdraw("C"), true, "a slip still waiting stays withdrawable");
  s.draw(native(1), a);
  assert.deepEqual(stubs.printed, ["kot", "kot"], "B is dispatched after A's hand-off");
  assert.equal(s.withdraw("B"), false, "B is drawn: no longer withdrawable");
  s.draw(native(2), b);
  b.resolve();
  a.resolve();
  await s.settled();
  assert.deepEqual(s.heard, [`C:${PRINT_HOST_NOT_DRAWN_MESSAGE}`, "B:printed", "A:printed"], "each caller hears its own result");
  assert.deepEqual(s.state(), IDLE, "the bridge is free");
});

test("busy covers every write in flight, drawing only the surface", async (t) => {
  const s = scene(t);
  const [a, b] = [held(), held()];
  s.queue("A", native(1));
  s.queue("B", LAN);
  s.draw(native(1), a);
  s.draw(LAN, b);
  assert.deepEqual(s.state(), { current: null, drawing: false, busy: true }, "two lanes writing, the surface idle");
  a.resolve();
  await s.settled();
  assert.deepEqual(s.state(), { current: null, drawing: false, busy: true }, "one write still in flight");
  b.resolve();
  await s.settled();
  assert.deepEqual(s.state(), IDLE, "both ended");
  assert.deepEqual(s.heard, ["A:printed", "B:printed"], "a network printer of the Windows app writes on its own lane too");
});
