import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// s63 fix round FX-A -- source pins (each with named in-memory MUTATIONS the pin must notice) for the
// pieces whose BEHAVIOUR is driven by lib/print-host-bridge-late.test.ts and lib/print-host-hooks.test.ts:
// W-K (the app's WebView), W-A (b) the late-completion guard, W-H/W-O the beat, W-D the page lane gate
// (round 2: R2-W2 the gate follows shouldRoutePrint at call time; R2-W5 the printer beat hears the desktop store).
// Same mechanics as print-gating-paths.test.ts (pins read the code with comments removed).
const CAFE = path.join(__dirname, "..", "..");
const raw = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8");
const lines = (src: string): number => src.replace(/\n$/, "").split("\n").length;
function between(src: string, from: string, to: string): string {
  const at = src.indexOf(from);
  const end = at < 0 ? -1 : src.indexOf(to, at);
  return at < 0 || end < 0 ? "" : src.slice(at, end);
}
function ordered(src: string, needles: string[]): boolean {
  let cursor = -1;
  for (const needle of needles) {
    const at = src.indexOf(needle);
    if (at <= cursor) return false;
    cursor = at;
  }
  return true;
}
const sub = (from: string, to: string) => (src: string) => src.replace(from, () => to);
function check(problems: string[], ok: boolean, message: string): void {
  if (!ok) problems.push(message);
}

interface PinCase {
  name: string;
  file: string;
  pin: (src: string, rawSrc: string) => string[];
  mutations: { name: string; apply: (src: string) => string }[];
}

const SETTLE = "const failure = lateGuard.take() ? null : requested;";

const CASES: PinCase[] = [
  {
    name: "capabilities: the app's injected WebView object is a capability, never the browser identity",
    file: "lib/printer/capabilities.ts",
    pin: (s) => {
      const p: string[] = [];
      check(p, s.includes('return typeof window !== "undefined" && "ReactNativeWebView" in window;'), "inAppWebView() asks for the injected object on window");
      const capable = between(s, "export function rasterCapable()", "\n}\n");
      check(p, capable.includes("nativeBridge() !== null || inAppWebView()"), "rasterCapable() includes the WebView object");
      check(p, capable.includes("serialApi() !== null || bluetoothApi() !== null"), "positive landmark: the other capabilities are still there");
      return p;
    },
    mutations: [
      { name: "WebView dropped from rasterCapable", apply: sub(" || inAppWebView();", ";") },
      { name: "object renamed (a different global)", apply: sub('"ReactNativeWebView" in window', '"ReactNativeWebViewX" in window') },
      { name: "reads the window unguarded", apply: sub('typeof window !== "undefined" && ', "") },
    ],
  },
  {
    name: "bridge: the watchdog ABANDONS the job; a late completion releases quietly (W-A b)",
    file: "hooks/use-print-host-bridge.ts",
    pin: (s, r) => {
      const p: string[] = [];
      check(p, s.includes('import { createWindowLateCompletionGuard } from "@/lib/print-host-late-completion";'), "imports the guard factory");
      check(p, s.includes("const [lateGuard] = useState(createWindowLateCompletionGuard);"), "one guard per bridge");
      const settle = between(s, "const settle = useCallback(", "setCurrent(null);");
      check(p, ordered(settle, [SETTLE, "window.clearTimeout(watchdogRef.current);", "dispatchedRef.current = false;", "toast.error(failure);"]), "settle: a late completion drops the failure BEFORE anything is announced");
      check(p, settle.includes("if (failure !== null) {"), "settle announces the (possibly dropped) failure, not the raw request");
      const abandon = between(s, "const abandon = useCallback(", "[lateGuard, settle]");
      check(p, ordered(abandon, ["toast.error(PRINT_HOST_PRINT_FAILED_MESSAGE);", "testRef.current?.reject(", "testRef.current = null;", "lateGuard.abandon(() => settle(null));"]), "abandon: announce, reject a waiting test slip, then hold the slot");
      check(p, s.includes("window.setTimeout(abandon, PRINT_HOST_DISPATCH_TIMEOUT_MS)"), "the watchdog abandons (it no longer settles)");
      check(p, !abandon.includes("occupiedRef") && !abandon.includes("setCurrent"), "abandon must NOT free the slot itself");
      check(p, lines(r) <= 250, "stays <= 250 lines");
      return p;
    },
    mutations: [
      { name: "late completion toasts again", apply: sub(SETTLE, "const failure = requested;") },
      { name: "watchdog settles again", apply: sub("window.setTimeout(abandon, ", "window.setTimeout(() => settle(PRINT_HOST_PRINT_FAILED_MESSAGE), ") },
      { name: "no grace timer (the slot would never free)", apply: sub("    lateGuard.abandon(() => settle(null));\n", "") },
      { name: "failure never announced", apply: sub("    toast.error(PRINT_HOST_PRINT_FAILED_MESSAGE);\n    testRef", "    testRef") },
      { name: "abandon frees the slot itself", apply: sub("    lateGuard.abandon(() => settle(null));", "    occupiedRef.current = false;\n    lateGuard.abandon(() => settle(null));") },
      { name: "the late-completion verdict is computed but not used", apply: sub("    if (failure !== null) {", "    if (requested !== null) {") },
    ],
  },
  {
    name: "late-completion guard: the grace is 30 s and the module is pure",
    file: "lib/print-host-late-completion.ts",
    pin: (s) => {
      const p: string[] = [];
      check(p, s.includes("export const PRINT_HOST_LATE_COMPLETION_GRACE_MS = 30_000;"), "grace constant 30_000");
      check(p, ordered(s, ["abandon(onGraceOver) {", "timers.schedule(() => {", "held = null;", "onGraceOver();", "}, PRINT_HOST_LATE_COMPLETION_GRACE_MS)"]), "the grace timer clears itself, then releases");
      check(p, ordered(between(s, "    take() {", "    },"), ["timers.cancel(held.handle);", "held = null;", "return true;"]), "take() cancels the grace and reports the late completion once");
      check(p, !/^import /m.test(s), "no imports -- pure, client-safe");
      return p;
    },
    mutations: [
      { name: "grace 30 s -> 5 s", apply: sub("GRACE_MS = 30_000", "GRACE_MS = 5_000") },
      { name: "grace timer not cleared on take()", apply: sub("      timers.cancel(held.handle);\n      held = null;\n      return true;", "      held = null;\n      return true;") },
      { name: "expiry forgets to clear itself", apply: sub("          held = null;\n          onGraceOver();", "          onGraceOver();") },
      { name: "an import sneaks in", apply: (s) => 'import { x } from "@/lib/y";\n' + s },
    ],
  },
  {
    name: "beat: one shared mutation scope; a host answer can follow up (W-H, W-O)",
    file: "hooks/use-print-host-beat.ts",
    pin: (s) => {
      const p: string[] = [];
      check(p, s.includes('export const PRINT_HOST_BEAT_SCOPE = "print-host-beat";'), "the scope id constant");
      check(p, s.includes("scope: { id: PRINT_HOST_BEAT_SCOPE },"), "useBeatPrintHost's mutation carries the scope");
      check(p, ordered(s, ["if (!result.isHost) onNotHost?.();", "else onHost?.();"]), "a host answer calls onHost, a demotion onNotHost");
      check(p, s.includes("const onHost = useOfflineFollowUp();") && s.includes("useBeatPrintHost({ onNotHost: onDemoted, onHost })"), "the routine beat wires the follow-up");
      return p;
    },
    mutations: [
      { name: "scope dropped", apply: sub("    scope: { id: PRINT_HOST_BEAT_SCOPE },\n", "") },
      { name: "onHost never called", apply: sub("      else onHost?.();\n", "") },
      { name: "follow-up not wired", apply: sub("useBeatPrintHost({ onNotHost: onDemoted, onHost })", "useBeatPrintHost({ onNotHost: onDemoted })") },
    ],
  },
  {
    name: "offline follow-up: once per offline episode, only for a host answer",
    file: "hooks/use-print-host-offline-followup.ts",
    pin: (s) => {
      const p: string[] = [];
      check(p, s.includes("qc.getQueryData<PosPulseData>(POS_PULSE_KEYS.all)?.printHost?.offline === true"), "reads the cached pulse's printHost.offline");
      check(p, ordered(s, ["if (!showsOffline) {", "armed.current = true;", "if (!armed.current) return;", "armed.current = false;", "void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });"]), "re-armed on online, latched before the single invalidation");
      return p;
    },
    mutations: [
      { name: "latch removed (a refetch loop)", apply: sub("    if (!armed.current) return;\n", "") },
      { name: "never re-armed", apply: sub("      armed.current = true;\n", "") },
      { name: "invalidates while online too", apply: sub("?.printHost?.offline === true", "?.printHost?.offline !== true") },
      { name: "invalidates a different key", apply: sub("queryKey: POS_PULSE_KEYS.all", 'queryKey: ["x"]') },
    ],
  },
  {
    name: "self-order lane: a page lane with no host claims only while this device can print (W-D)",
    file: "hooks/use-self-order-auto-print.ts",
    pin: (s) => {
      const p: string[] = [];
      // R2-W2: the verdict is "this device prints the slip itself" = shouldRoutePrint says no (an unknown tick on a
      // device that never saw a host counts), read from the stored prefs at CALL time -- not routing === "no-host".
      check(p, s.includes("return !isHostLane && !shouldRoutePrint(routing, readDevicePrefs().printHostSeen);") && s.includes("const routing = usePrintHostRouting();"), "the gate is page lanes whose slips shouldRoutePrint does not route");
      check(p, !s.includes('routing === "no-host"'), "the render-time no-host test is gone (a degraded tick must gate too)");
      const registered = between(s, "return registerKotPrintHandler(", "claimAndPrint(requestId, \"manual\"");
      check(p, ordered(registered, ["if (printsOnThisDevice(isHostLane, routing) && !canPrintNow()) {", "toast.error(printBlockedMessage());", "return;", "if (claimLock) claimLock.current = true;"]), "manual tap: say why and return BEFORE the claim lock");
      check(p, ordered(s, ["if (printsOnThisDevice(isHostLane, routing) && !canPrint) return;", "if (claimingRef.current) return;", "claimingRef.current = true;"]), "auto lane: skip before anything is claimed");
      check(p, s.includes("const canPrint = useCanPrintNow();") && /\[enabled, busy, pulse, claimAndPrint, isHostLane, claimLock, maxAgeMs, routing, canPrint\]/.test(s), "canPrint and routing are dependencies, so the claim retries when the printer comes back");
      check(p, /\[enabled, registerKotPrintHandler, claimAndPrint, claimLock, isHostLane, routing\]/.test(s), "the manual handler is re-registered when the lane or routing changes");
      return p;
    },
    mutations: [
      { name: "gate also covers a configured host", apply: sub("!shouldRoutePrint(routing, readDevicePrefs().printHostSeen)", 'routing !== "unknown"') },
      { name: "gate ignores a degraded tick again (no-host only)", apply: sub("!shouldRoutePrint(routing, readDevicePrefs().printHostSeen)", 'routing === "no-host"') },
      { name: "gate forgets that a seen host routes", apply: sub("!shouldRoutePrint(routing, readDevicePrefs().printHostSeen)", "!shouldRoutePrint(routing, false)") },
      { name: "gate also covers the host lane", apply: sub("return !isHostLane && !shouldRoutePrint", "return !shouldRoutePrint") },
      { name: "manual tap claims anyway", apply: sub("      if (printsOnThisDevice(isHostLane, routing) && !canPrintNow()) {\n        toast.error(printBlockedMessage());\n        return;\n      }\n", "") },
      { name: "auto lane claims anyway", apply: sub("    if (printsOnThisDevice(isHostLane, routing) && !canPrint) return;", "") },
      { name: "canPrint not a dependency (never retried)", apply: sub("maxAgeMs, routing, canPrint]", "maxAgeMs, routing]") },
      { name: "routing not a dependency of the handler", apply: sub("claimLock, isHostLane, routing]", "claimLock, isHostLane]") },
      { name: "manual tap toasts a fixed sentence", apply: sub("toast.error(printBlockedMessage());", 'toast.error("Could not print.");') },
    ],
  },
  {
    name: "printer beat: also hears the desktop shell's printer choice, and lets go of it (R2-W5)",
    file: "hooks/use-print-host-printer-beat.ts",
    pin: (s) => {
      const p: string[] = [];
      check(p, s.includes('import { subscribeDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";'), "imports the store's subscribe");
      check(p, ordered(s, ["const offDesktop = subscribeDesktopPrinterChosen(debouncer.poke);", "if (first !== undefined) beat({ deviceId, printer: first });", "return () => {", "offDesktop();", "debouncer.dispose();"]), "subscribed with the others, released in the cleanup");
      return p;
    },
    mutations: [
      { name: "subscription dropped", apply: sub("    const offDesktop = subscribeDesktopPrinterChosen(debouncer.poke);\n", "    const offDesktop = (): void => undefined;\n") },
      { name: "subscription never released", apply: sub("      offDesktop();\n", "") },
      { name: "subscribed to a different poke", apply: sub("subscribeDesktopPrinterChosen(debouncer.poke)", "subscribeDesktopPrinterChosen(() => undefined)") },
    ],
  },
];

for (const c of CASES) {
  test(`PIN: ${c.name}`, () => {
    const rawSrc = raw(c.file);
    assert.deepEqual(c.pin(stripComments(rawSrc), rawSrc), [], c.file);
  });
}

test("MUTATION self-check: every FX-A pin reports a problem for each named in-memory mutation", () => {
  let applied = 0;
  for (const c of CASES) {
    assert.ok(c.mutations.length > 0, `${c.file}: a pin case needs at least one mutation`);
    const real = raw(c.file);
    assert.deepEqual(c.pin(stripComments(real), real), [], `${c.file}: the unmutated source must be clean first`);
    for (const m of c.mutations) {
      const mutated = m.apply(real);
      assert.notEqual(mutated, real, `${c.file} :: ${m.name}: the mutation changed nothing`);
      assert.ok(c.pin(stripComments(mutated), mutated).length >= 1, `${c.file} :: ${m.name}: the pin did NOT notice`);
      applied++;
    }
  }
  assert.ok(applied >= CASES.length, "landmark: mutations were applied");
});

// ---- reachability (built-but-uncalled is not done) + hygiene ---------------------------------------

function callSites(needle: string): string[] {
  const hits: string[] = [];
  for (const dir of ["app", "components", "hooks", "lib"]) {
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && readFileSync(full, "utf8").includes(needle)) {
          hits.push(path.relative(CAFE, full).split(path.sep).join("/"));
        }
      }
    };
    walk(path.join(CAFE, dir));
  }
  return hits.sort();
}

test("reachability: the follow-up hook and the guard each have a definition and a real call site", () => {
  assert.deepEqual(callSites("useOfflineFollowUp("), ["hooks/use-print-host-beat.ts", "hooks/use-print-host-offline-followup.ts"]);
  assert.deepEqual(callSites("createWindowLateCompletionGuard"), ["hooks/use-print-host-bridge.ts", "lib/print-host-late-completion.ts"]);
});

test("new files: no console call, no cafe name, no browser-identity read, <= 300 lines", () => {
  const banned = [/\bconsole\s*\./, new RegExp("luci" + "fer", "i"), new RegExp("user" + "agent", "i")];
  for (const file of ["hooks/use-print-host-offline-followup.ts", "lib/print-host-late-completion.ts", "lib/hook-harness.ts"]) {
    const src = raw(file);
    for (const re of banned) assert.ok(!re.test(src), `${file}: banned ${re}`);
    assert.ok(lines(src) <= 300, `${file} must stay <= 300 lines`);
  }
});
