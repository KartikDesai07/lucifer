import "@/lib/hook-harness"; // installs the react / sonner stubs: MUST stay the first import
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { useRef } from "react";

import { mountHook, resetStubs, stubModule, stubs } from "@/lib/hook-harness";
import { REFETCH_INTERVALS } from "@/lib/query";
import { NO_PRINTER_MESSAGE } from "@/lib/printer/lane-print";

// s63 fix round FX-A, the hooks around the host bridge, each driven through its REAL
// body (lib/hook-harness.ts) with the neighbours stubbed: W-D (page lane gate),
// W-H (beat scope), W-I (first printer report), W-O (stale offline), W-Z (wake).
// Everything the hooks read from outside React lives in `world`.

type Beat = { deviceId: string; printer?: string };
type MutationOptions = { mutationKey?: unknown; scope?: { id: string }; onSuccess?: (result: { isHost: boolean }) => void };
interface Recorded {
  options: MutationOptions;
  input: unknown;
  callbacks: unknown;
}

const NOW = 1_800_000_000_000;
const PULSE_KEY = ["pos-pulse"];
const world = {
  report: "unknown" as string | undefined,
  canPrint: true,
  routing: "no-host" as string,
  prefs: { autoPrintSelfOrders: true, printHost: false, printHostSeen: false },
  pulse: undefined as unknown,
  recorded: [] as Recorded[],
  declared: [] as MutationOptions[],
  printerListeners: new Set<() => void>(),
  desktopListeners: new Set<() => void>(),
  invalidations: 0,
  cached: undefined as unknown,
  cachedState: undefined as { dataUpdatedAt: number } | undefined,
  wake: null as null | (() => void),
  handler: null as null | ((requestId: string) => void),
  native: [] as [string, unknown][],
};
function resetWorld(): void {
  Object.assign(world, { report: "unknown", canPrint: true, routing: "no-host", pulse: undefined, invalidations: 0, cached: undefined, cachedState: undefined, wake: null, handler: null });
  world.prefs = { autoPrintSelfOrders: true, printHost: false, printHostSeen: false };
  world.recorded.length = 0;
  world.declared.length = 0;
  world.native.length = 0;
  world.printerListeners.clear();
  world.desktopListeners.clear();
  resetStubs();
}

const queryClient = {
  getQueryData: () => world.cached,
  getQueryState: () => world.cachedState,
  invalidateQueries: async () => void (world.invalidations += 1),
  getQueryCache: () => ({ subscribe: () => () => undefined }),
};
stubModule("@tanstack/react-query", {
  hashKey: JSON.stringify,
  useQueryClient: () => queryClient,
  useMutation: (options: MutationOptions) => {
    world.declared.push(options);
    const ref = useRef<{ mutate: (input: unknown, callbacks?: unknown) => void } | null>(null);
    if (ref.current === null) ref.current = { mutate: (input, callbacks) => void world.recorded.push({ options, input, callbacks }) };
    return { mutate: ref.current.mutate };
  },
});
stubModule("@/lib/api-client", { apiSend: async () => undefined });
stubModule("@/hooks/use-pos-pulse", { POS_PULSE_KEYS: { all: PULSE_KEY } });
stubModule("@/hooks/use-print-host", { PRINT_JOB_KEYS: { mutation: ["print-job-mutation"] } });
stubModule("@/lib/printer/print-lane", {
  beatPrinterReport: () => world.report,
  canPrintNow: () => world.canPrint,
  printBlockedMessage: () => NO_PRINTER_MESSAGE,
});
stubModule("@/lib/printer/device-printer", {
  devicePrinter: () => ({ subscribe: (fn: () => void) => (world.printerListeners.add(fn), () => world.printerListeners.delete(fn)) }),
});
stubModule("@/lib/printer/desktop-printer-state", {
  subscribeDesktopPrinterChosen: (fn: () => void) => (world.desktopListeners.add(fn), () => world.desktopListeners.delete(fn)),
});
stubModule("@/lib/printer/capabilities", { onWindowEvent: () => () => undefined });
stubModule("@/lib/printer/native-bridge", {
  NATIVE_READY_EVENT: "posnative:ready",
  nativeOn: (_event: string, fn: () => void) => ((world.wake = fn), () => undefined),
  nativeRequest: async (method: string, params: unknown) => (world.native.push([method, params]), {}),
});
stubModule("@/hooks/use-device-printer", { usePrintCapabilities: () => ({ native: true }), useCanPrintNow: () => world.canPrint });
stubModule("@/lib/pos-device-prefs", { readDevicePrefs: () => world.prefs });
const registerKotPrintHandler = (fn: (requestId: string) => void): (() => void) => ((world.handler = fn), () => undefined);
stubModule("@/components/layout/PosPulseProvider", {
  usePosPulseContext: () => ({ pulse: world.pulse, registerKotPrintHandler }),
  usePrintHostRouting: () => world.routing,
});
(globalThis as unknown as { document: unknown }).document = { visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined };

const load = createRequire(__filename);
const beatModule = load("@/hooks/use-print-host-beat") as typeof import("@/hooks/use-print-host-beat");
const { usePrintHostPrinterBeat } = load("@/hooks/use-print-host-printer-beat") as typeof import("@/hooks/use-print-host-printer-beat");
const { useNativeHostBackground } = load("@/hooks/use-native-host") as typeof import("@/hooks/use-native-host");
const { useSelfOrderAutoPrint } = load("@/hooks/use-self-order-auto-print") as typeof import("@/hooks/use-self-order-auto-print");

const beatsOf = (): Beat[] => world.recorded.filter((r) => r.options.mutationKey !== undefined).map((r) => r.input as Beat);

// ---- W-H ------------------------------------------------------------------------------------------

test("W-H: every beat mutation carries the shared scope id, so TanStack runs the routine beat and a printer report in order", () => {
  resetWorld();
  const routine = mountHook(() => beatModule.usePrintHostBeat({ enabled: true, deviceId: "dev", onDemoted: () => undefined }));
  const printer = mountHook(() => usePrintHostPrinterBeat({ enabled: true, deviceId: "dev", onDemoted: () => undefined }));
  const beats = world.declared.filter((o) => o.mutationKey !== undefined);
  const scopes = beats.map((o) => o.scope?.id);
  assert.ok(scopes.length >= 2, "positive landmark: both beat hooks declared their mutation");
  assert.deepEqual([...new Set(scopes)], [beatModule.PRINT_HOST_BEAT_SCOPE]);
  assert.equal(beatModule.PRINT_HOST_BEAT_SCOPE, "print-host-beat");
  routine.unmount();
  printer.unmount();
});

// ---- W-I ------------------------------------------------------------------------------------------

test("W-I: the moment the printer beat is enabled the current report is sent once, immediately -- then only changes follow", (t: TestContext) => {
  resetWorld();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  world.report = "connected";
  const hook = mountHook(() => usePrintHostPrinterBeat({ enabled: true, deviceId: "dev", onDemoted: () => undefined }));
  assert.deepEqual(beatsOf(), [{ deviceId: "dev", printer: "connected" }], "sent at once, before any poke or routine beat");
  world.printerListeners.forEach((fn) => fn());
  t.mock.timers.tick(1000);
  assert.equal(beatsOf().length, 1, "a poke that settles on the value already sent adds nothing");
  world.report = "disconnected";
  world.printerListeners.forEach((fn) => fn());
  t.mock.timers.tick(1000);
  assert.deepEqual(beatsOf().at(-1), { deviceId: "dev", printer: "disconnected" });
  hook.unmount();
});

test("W-I: nothing is sent while disabled, and a tab that owns no printer (no report) sends nothing at enable time", (t: TestContext) => {
  resetWorld();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mountHook(() => usePrintHostPrinterBeat({ enabled: false, deviceId: "dev", onDemoted: () => undefined }));
  world.report = undefined;
  mountHook(() => usePrintHostPrinterBeat({ enabled: true, deviceId: "dev", onDemoted: () => undefined }));
  assert.deepEqual(beatsOf(), []);
});

// ---- W-O ------------------------------------------------------------------------------------------

function answer(isHost: boolean): void {
  const beat = world.declared.filter((o) => o.mutationKey !== undefined).at(-1);
  assert.ok(beat, "positive landmark: the beat mutation is declared");
  beat.onSuccess?.({ isHost });
}
const pulseWith = (offline: boolean): unknown => ({ printHost: { configured: true, offline } });

test("W-O: a routine beat answered as the host while the cached pulse still says offline refreshes the pulse ONCE (re-armed when the cache reads online)", () => {
  resetWorld();
  const hook = mountHook(() => beatModule.usePrintHostBeat({ enabled: true, deviceId: "dev", onDemoted: () => undefined }));
  world.cached = pulseWith(true);
  answer(true);
  assert.equal(world.invalidations, 1);
  answer(true);
  answer(true);
  assert.equal(world.invalidations, 1, "still offline in the cache: no refetch loop");
  world.cached = pulseWith(false);
  answer(true);
  assert.equal(world.invalidations, 1, "online in the cache: nothing to refresh");
  world.cached = pulseWith(true);
  answer(true);
  assert.equal(world.invalidations, 2, "a NEW offline episode may refresh once more");
  hook.unmount();
});

test("W-O: no refresh when the cache is empty/degraded, or when the beat says this device was demoted", () => {
  resetWorld();
  let demoted = 0;
  mountHook(() => beatModule.usePrintHostBeat({ enabled: true, deviceId: "dev", onDemoted: () => void (demoted += 1) }));
  answer(true);
  world.cached = { printHost: null };
  answer(true);
  world.cached = pulseWith(true);
  answer(false);
  assert.equal(world.invalidations, 0);
  assert.equal(demoted, 1);
});

// ---- W-Z ------------------------------------------------------------------------------------------

test("W-Z: app.wake refreshes the pulse only when it is OLDER than one poll interval", (t: TestContext) => {
  resetWorld();
  t.mock.method(Date, "now", () => NOW);
  const hook = mountHook(() => useNativeHostBackground(true, true));
  assert.ok(world.wake, "positive landmark: the wake listener is registered");
  const wake = (ageMs: number | null): number => {
    world.cachedState = ageMs === null ? undefined : { dataUpdatedAt: NOW - ageMs };
    const before = world.invalidations;
    world.wake?.();
    return world.invalidations - before;
  };
  assert.equal(wake(1_000), 0, "a poll landed a second ago: a wake would only stack a fetch on it");
  assert.equal(wake(REFETCH_INTERVALS.POS_PULSE), 0, "exactly one interval old is not older than it");
  assert.equal(wake(REFETCH_INTERVALS.POS_PULSE + 1), 1);
  assert.equal(wake(null), 1, "no pulse data yet: refresh");
  hook.unmount();
});

test("Session 3D: a page that knows this device prints nothing tells the POS app so once; one that does not know yet says nothing", () => {
  resetWorld();
  const unknown = mountHook(() => useNativeHostBackground(false, false));
  assert.deepEqual(world.native, [], "its role or the printers are not known yet: nothing (a page reloading in the background keeps the app's wish)");
  unknown.unmount();
  const known = mountHook(() => useNativeHostBackground(false, true));
  assert.deepEqual(world.native, [["host.background", { active: false }]], "it prints nothing for the cafe: the app drops a wish an earlier page left");
  known.unmount();
  world.native.length = 0;
  const printing = mountHook(() => useNativeHostBackground(true, true));
  assert.deepEqual(world.native, [["host.background", { active: true, label: "This device" }]], "a device that prints asks for the service as before");
  printing.unmount();
});

// ---- W-D ------------------------------------------------------------------------------------------

const ORDER_ROW = { requestId: "req-1", printed: false, acceptedAt: new Date(NOW - 1000).toISOString() };
function mountPageLane(hostLane?: { claimLock: { current: boolean }; maxAgeMs: number }) {
  world.pulse = { selfOrders: [ORDER_ROW] };
  return mountHook(() => useSelfOrderAutoPrint({ enabled: true, busy: false, queueKotRound: () => undefined, hostLane }));
}
const claims = (): unknown[] => world.recorded.filter((r) => r.options.mutationKey === undefined).map((r) => r.input);

test("W-D: a page lane with NO host does not claim (burn) a ticket while this device cannot print, and claims once it can", (t: TestContext) => {
  resetWorld();
  t.mock.method(Date, "now", () => NOW);
  world.canPrint = false;
  const hook = mountPageLane();
  assert.deepEqual(claims(), [], "printer not connected: the claim waits");
  world.canPrint = true;
  hook.rerender();
  assert.deepEqual(claims(), ["req-1"], "retried the moment the device can print");
});

test("W-D: the manual Print tap on a no-host page lane says why and claims nothing when this device cannot print", (t: TestContext) => {
  resetWorld();
  t.mock.method(Date, "now", () => NOW);
  world.canPrint = false;
  mountPageLane();
  assert.ok(world.handler, "positive landmark: the manual handler is registered");
  world.handler?.("req-9");
  assert.deepEqual(stubs.toasts, [NO_PRINTER_MESSAGE]);
  assert.deepEqual(claims(), []);
  world.canPrint = true;
  world.handler?.("req-9");
  assert.deepEqual(claims(), ["req-9"], "a device that can print claims as before");
});

test("W-D: with a print host configured the page lane only ENQUEUES, so it still claims on a device that cannot print; the host lane is untouched too", (t: TestContext) => {
  resetWorld();
  t.mock.method(Date, "now", () => NOW);
  world.canPrint = false;
  world.routing = "host";
  mountPageLane();
  assert.deepEqual(claims(), ["req-1"]);
  world.handler?.("req-2");
  assert.deepEqual(claims(), ["req-1", "req-2"]);
  assert.deepEqual(stubs.toasts, []);

  resetWorld();
  world.canPrint = false;
  world.routing = "no-host";
  mountPageLane({ claimLock: { current: false }, maxAgeMs: 30 * 60 * 1000 });
  assert.deepEqual(claims(), ["req-1"], "the host lane gates on the drain lock, not here");
});

// ---- R2-W2 (round 2): the gate is "this device prints the slip itself", decided at call time ----
test("R2-W2: a degraded tick (routing unknown) on a device that never saw a host prints HERE, so it claims only while it can print", (t: TestContext) => {
  resetWorld();
  t.mock.method(Date, "now", () => NOW);
  world.routing = "unknown";
  world.canPrint = false;
  const hook = mountPageLane();
  assert.deepEqual(claims(), [], "unknown + never seen: slips print locally, the printer cannot: nothing is claimed");
  world.handler?.("req-9");
  assert.deepEqual([stubs.toasts, claims()], [[NO_PRINTER_MESSAGE], []], "a manual tap says why and claims nothing");
  world.canPrint = true;
  hook.rerender();
  assert.deepEqual(claims(), ["req-1"], "retried the moment the device can print");
});

test("R2-W2: unknown routing on a device that HAS seen a host still only enqueues (claims without a local printer); seen is read at call time", (t: TestContext) => {
  resetWorld();
  t.mock.method(Date, "now", () => NOW);
  world.routing = "unknown";
  world.prefs.printHostSeen = true;
  world.canPrint = false;
  mountPageLane();
  world.handler?.("req-2");
  assert.deepEqual([claims(), stubs.toasts], [["req-1", "req-2"], []]);
  world.prefs.printHostSeen = false;
  world.handler?.("req-3");
  assert.deepEqual([claims(), stubs.toasts], [["req-1", "req-2"], [NO_PRINTER_MESSAGE]], "the handler re-reads the prefs on each tap, not at mount");
});

// ---- R2-W5 (round 2): a desktop chosen-state change pokes the printer beat ----
test("R2-W5: choosing or clearing the PC printer re-reads the report and beats the change; the subscription ends with the hook", (t: TestContext) => {
  resetWorld();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mountHook(() => usePrintHostPrinterBeat({ enabled: false, deviceId: "dev", onDemoted: () => undefined }));
  assert.equal(world.desktopListeners.size, 0, "a disabled beat does not subscribe");
  world.report = "connected";
  const hook = mountHook(() => usePrintHostPrinterBeat({ enabled: true, deviceId: "dev", onDemoted: () => undefined }));
  assert.equal(world.desktopListeners.size, 1, "positive landmark: subscribed to the desktop chosen-state store");
  world.report = "disconnected";
  world.desktopListeners.forEach((fn) => fn());
  t.mock.timers.tick(1000);
  assert.deepEqual(beatsOf().at(-1), { deviceId: "dev", printer: "disconnected" }, "the host reports the change within the debounce");
  hook.unmount();
  assert.equal(world.desktopListeners.size, 0, "unsubscribed on cleanup");
});
