import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { DEVICE_WRITE_DEADLINE_MS } from "@/lib/printer/device-printer";
import { LANE_RASTER_DEADLINE_MS } from "@/lib/printer/lane-print";
import { PRINT_HOST_DISPATCH_TIMEOUT_MS } from "@/lib/print-host-slips";
import { stripComments } from "@/lib/source-pin-utils";

// Bluetooth-print plan W4 -- source pins over the seam, host gating and beat
// reporting, each with named in-memory MUTATIONS the pin must notice. Pins read
// the code with comments removed, so a needle in a comment never satisfies one.
const CAFE = path.join(__dirname, "..", "..");
const raw = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8");
const code = stripComments;
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
const lines = (src: string): number => src.replace(/\n$/, "").split("\n").length;
function between(src: string, from: string, to: string): string {
  const at = src.indexOf(from);
  const end = at < 0 ? -1 : src.indexOf(to, at);
  return at < 0 || end < 0 ? "" : src.slice(at, end);
}
// Every needle present, in this order.
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

interface PinCase {
  name: string;
  file: string;
  pin: (src: string, rawSrc: string) => string[];
  mutations: { name: string; apply: (src: string) => string }[];
}
function check(problems: string[], ok: boolean, message: string): void {
  if (!ok) problems.push(message);
}

// Phase 2 Session 2F1 (deliberate change): a printer job of one of the POS app's printers names it (raster).
const DELEGATE = "if (!shell) return laneSlipPrintOptions(options, raster);";
// The final release check (2026-10-03, deliberate change): the routine beat also says whether this host is
// silent by construction (beatSilentMode), so an app host never reads "a dialog for every slip".
const BEAT_CALL = "beat({ deviceId, printer: beatPrinterReport(), silentMode: beatSilentMode() });";
// Session 1C: the agent (the host, or with no host every device) asks for the lock; still only while it can print.
const LOCK_CALL = "const holdsLock = usePrintHostDrainLock(isAgent && canPrint);";
const LANE_MESSAGE_NAMES = ["NO_PRINTER_MESSAGE", "PRINTER_NOT_CONNECTED_MESSAGE", "PRINTER_WRITE_FAILED_MESSAGE", "PRINTER_ELSEWHERE_MESSAGE", "RASTER_FAILED_MESSAGE", "RASTER_TOO_LARGE_MESSAGE", "DESKTOP_PRINT_EMPTY_MESSAGE", "nativeErrorMessage(nativeError(code, code))"];

const CASES: PinCase[] = [
  {
    name: "seam: the shell branch stays first, then the delegate line",
    file: "lib/desktop-shell.ts",
    pin: (s, r) => {
      const p: string[] = [];
      check(p, s.includes('import { laneSlipPrintOptions, type RasterPrintTarget } from "@/lib/printer/lane-print";'), "imports laneSlipPrintOptions from lane-print");
      check(p, count(s, DELEGATE) === 1, "the delegate line appears exactly once");
      check(p, ordered(s, ["const shell = desktopShell();", DELEGATE, "print: async (iframe"]), "order: const shell -> delegate -> the shell's print override");
      check(p, !s.includes("if (!shell) return options;"), "the old same-reference line is gone");
      check(p, !/\bnavigator\b|rasterCapable|devicePrinter/.test(s), "no lane logic in the seam file");
      check(p, lines(r) <= 150, "stays <= 150 lines");
      return p;
    },
    mutations: [
      { name: "delegate removed", apply: sub(DELEGATE, "if (!shell) return options;") },
      { name: "delegate only in a comment", apply: sub(DELEGATE, `// ${DELEGATE}\n  if (!shell) return options;`) },
      { name: "delegate before the shell check", apply: sub(`const shell = desktopShell();\n  ${DELEGATE}`, `if (!desktopShell()) return laneSlipPrintOptions(options);\n  const shell = desktopShell();\n  if (!shell) return options;`) },
      { name: "import dropped", apply: sub('import { laneSlipPrintOptions, type RasterPrintTarget } from "@/lib/printer/lane-print";\n', "") },
      { name: "lane logic leaks into the seam", apply: sub("const shell = desktopShell();", "const shell = desktopShell(); void navigator;") },
    ],
  },
  {
    name: "lane-print: one-way imports, call-time decision, order of the lanes",
    file: "lib/printer/lane-print.ts",
    pin: (s) => {
      const p: string[] = [];
      check(p, !/from\s+["']@\/lib\/desktop-shell["']/.test(s), "must not import the desktop-shell seam (import cycle)");
      check(p, !/from\s+["']@\/lib\/printer\/print-lane["']/.test(s), "must not import print-lane (it imports the seam)");
      check(p, s.includes("if (!rasterCapable()) return options;"), "no capability -> the SAME options reference");
      const wrap = between(s, "export function laneSlipPrintOptions", "\n}\n");
      check(p, wrap.includes("lanePrint(iframe, options.documentTitle)"), "print() delegates to lanePrint at call time");
      check(p, !/devicePrinter|nativeBridge|getSnapshot/.test(wrap), "the lane is NOT decided when the options are wrapped");
      check(p, wrap.includes("options.onPrintError ?? laneOnPrintError(options)"), "a caller's onPrintError wins by identity");
      const lane = between(s, "async function lanePrint(", "\n}\n");
      check(p, lane.includes("devicePrinter().getSnapshot()"), "lanePrint reads the printer snapshot itself");
      check(p, ordered(lane, ['if (snapshot.status === "elsewhere") throw new Error(PRINTER_ELSEWHERE_MESSAGE);', "return rasterPrint(iframe, snapshot.printer);", "if (nativeBridge() !== null || inAppWebView()) throw new Error(NO_PRINTER_MESSAGE);", "return systemPrint("]), "order: elsewhere -> raster -> app (bridge OR its WebView) without a printer -> system");
      check(p, ordered(between(s, "async function rasterPrint(", "\n}\n"), ["bitmap.rows === 0", "bitmap.rows > RASTER_MAX_ROWS", "devicePrinter().write(escposJob(bitmap))"]), "rasterPrint refuses blank / too long BEFORE the write");
      check(p, s.includes("export const SYSTEM_PRINT_SETTLE_MS = 500;") && s.includes("export const LANE_RASTER_DEADLINE_MS = 12_000;"), "the two timing constants");
      check(p, s.includes("Promise.race([laneRasterizer(iframe, dots), expired])") && s.includes("RASTER_FAILED_MESSAGE)), LANE_RASTER_DEADLINE_MS);"), "the drawing runs under the one deadline");
      // s63 W-A(a): the settle wait only follows a print() that came straight back; nothing is awaited before print().
      check(p, s.includes("if (!blocked) await laneSleep(SYSTEM_PRINT_SETTLE_MS);") && count(s, ".print()") === 1, "system lane: one print(), then the settle wait only when print() did not block");
      check(p, s.includes("blocked = performance.now() - startedAt >= SYSTEM_PRINT_SETTLE_MS;"), "print() is timed against the settle wait");
      const beforePrint = between(s, "async function systemPrint(", ".print()");
      check(p, beforePrint.includes("iframe.contentWindow?") && !/\bawait\b/.test(beforePrint), "no await runs before print() (react-to-print dispatches from a timer)");
      check(p, s.includes("laneToast(laneFailureMessage(error) ?? LANE_PRINT_FAILED_MESSAGE);\n    options.onAfterPrint?.();"), "default onPrintError: toast, then onAfterPrint");
      const set = between(s, "const LANE_MESSAGES", "]);");
      for (const name of LANE_MESSAGE_NAMES) check(p, set.includes(name), `the whitelist carries ${name}`);
      return p;
    },
    mutations: [
      { name: "imports the seam", apply: (s) => 'import { desktopShell } from "@/lib/desktop-shell";\n' + s },
      { name: "imports print-lane", apply: (s) => 'import { currentLane } from "@/lib/printer/print-lane";\n' + s },
      { name: "elsewhere check removed", apply: sub('if (snapshot.status === "elsewhere") throw new Error(PRINTER_ELSEWHERE_MESSAGE);', "") },
      { name: "no-printer throw after the system lane", apply: sub("if (nativeBridge() !== null || inAppWebView()) throw new Error(NO_PRINTER_MESSAGE);\n  return systemPrint(iframe, titleOf(documentTitle));", "return systemPrint(iframe, titleOf(documentTitle));") },
      { name: "the app's WebView no longer fails loud", apply: sub("nativeBridge() !== null || inAppWebView()", "nativeBridge() !== null") },
      { name: "settle wait unconditional again", apply: sub("if (!blocked) await laneSleep", "await laneSleep") },
      { name: "an await sneaks in before print()", apply: sub("  let blocked = false;", "  await laneSleep(0);\n  let blocked = false;") },
      { name: "print() no longer timed", apply: sub("blocked = performance.now() - startedAt >= SYSTEM_PRINT_SETTLE_MS;", "blocked = false;") },
      { name: "lane decided at wrap time", apply: sub("  if (!rasterCapable()) return options;\n", "  if (!rasterCapable()) return options;\n  const decided = devicePrinter().getSnapshot();\n") },
      { name: "settle wait 500 -> 50", apply: sub("SYSTEM_PRINT_SETTLE_MS = 500", "SYSTEM_PRINT_SETTLE_MS = 50") },
      { name: "deadline 12 s -> 18 s", apply: sub("LANE_RASTER_DEADLINE_MS = 12_000", "LANE_RASTER_DEADLINE_MS = 18_000") },
      { name: "write before the blank check", apply: sub("  if (bitmap.rows === 0) throw new Error(DESKTOP_PRINT_EMPTY_MESSAGE);", "  await devicePrinter().write(escposJob(bitmap));\n  if (bitmap.rows === 0) throw new Error(DESKTOP_PRINT_EMPTY_MESSAGE);") },
      { name: "caller's onPrintError overwritten", apply: sub("options.onPrintError ?? laneOnPrintError(options)", "laneOnPrintError(options)") },
      { name: "onAfterPrint dropped from the default handler", apply: sub("    options.onAfterPrint?.();\n", "") },
      { name: "whitelist loses the elsewhere sentence", apply: sub("  PRINTER_ELSEWHERE_MESSAGE,\n  PRINTER_TOO_LARGE_MESSAGE,", "  PRINTER_TOO_LARGE_MESSAGE,") },
    ],
  },
  {
    name: "drain: the lock is asked for only by a window that can print; the two new hooks run with `enabled`",
    file: "components/print/PrintHostDrain.tsx",
    pin: (s) => {
      const p: string[] = [];
      // Session 2F1 (deliberate change): any printer of this device (one of the POS app's printers that is off never
      // stops the others, spec §9.2).
      check(p, ordered(s, ["const canPrint = useCanPrintOnAny();", LOCK_CALL, "const drains = isAgent && holdsLock;"]), "canPrint -> gated lock -> drains");
      check(p, count(s, "usePrintHostDrainLock(") === 1 && !s.includes("usePrintHostDrainLock(enabled)"), "no ungated lock call");
      check(p, s.includes("usePrintHostWakeLock(enabled);") && s.includes("usePrintHostBeat({ enabled, deviceId, onDemoted });"), "wake lock and routine beat keep `enabled`");
      check(p, s.includes("usePrintHostPrinterBeat({ enabled, deviceId, onDemoted });"), "printer beat is wired with `enabled`");
      // Phase 3 Session 3D (spec §9.5) deliberately changed: the host, and in printers mode a device that writes a printer.
      check(p, s.includes("const printsForCafe = enabled || (surfacesMounted && printers.printersMode && printers.isWriter);"), "native host background: the host and every printers-mode writer");
      check(p, s.includes("const decided = surfacesMounted && deviceId !== \"\" && routing !== \"unknown\" && printersRead.loaded;\n  useNativeHostBackground(printsForCafe, decided);"), "and it tells the app no only once it knows");
      check(p, s.includes('import { useCanPrintOnAny } from "@/hooks/use-device-printer";'), "imports useCanPrintOnAny");
      return p;
    },
    mutations: [
      { name: "lock ungated", apply: sub(LOCK_CALL, "const holdsLock = usePrintHostDrainLock(enabled);") },
      { name: "canPrint read after the lock", apply: sub(`const canPrint = useCanPrintOnAny();\n  ${LOCK_CALL}`, `${LOCK_CALL}\n  const canPrint = useCanPrintOnAny();`) },
      { name: "printer beat armed by drains", apply: sub("usePrintHostPrinterBeat({ enabled,", "usePrintHostPrinterBeat({ enabled: drains,") },
      { name: "native background removed", apply: sub("  useNativeHostBackground(printsForCafe, decided);\n", "") },
      { name: "the no told before the role is known", apply: sub(' && routing !== "unknown" && printersRead.loaded;', ";") },
      { name: "native background for the host only", apply: sub("const printsForCafe = enabled || (surfacesMounted && printers.printersMode && printers.isWriter);", "const printsForCafe = enabled;") },
      { name: "native background for every agent", apply: sub("printers.printersMode && printers.isWriter", "printers.printersMode") },
      { name: "routine beat gated by canPrint", apply: sub("usePrintHostBeat({ enabled, deviceId, onDemoted });", "usePrintHostBeat({ enabled: enabled && canPrint, deviceId, onDemoted });") },
    ],
  },
  {
    // The Phase 1 final gate (I-1, deliberate change): the provider's claim print (and its "a window that
    // cannot print claims nothing" guard) is gone; the band's Print is the lifecycle's Print now.
    name: "provider: init in the mount effect; no claim print",
    file: "components/layout/PrintHostProvider.tsx",
    pin: (s, r) => {
      const p: string[] = [];
      const mount = between(s, "useEffect(() => {\n    setDeviceId(readDeviceId());", "}, []);");
      check(p, ordered(mount, ["setPrefHost(readDevicePrefs().printHost);", "void devicePrinter().init();"]), "devicePrinter().init() runs inside the mount effect after setPrefHost");
      check(p, count(s, "devicePrinter().init()") === 1, "init is called once");
      check(p, !s.includes("claimAsync(") && !s.includes("printQueuedJob"), "no claim print in new builds");
      check(p, lines(r) <= 200, "stays <= 200 lines");
      return p;
    },
    mutations: [
      { name: "a claim print comes back", apply: sub("  const value = useMemo", "  const printQueuedJob = (id: string) => claimAsync({ id });\n  const value = useMemo") },
      { name: "init moved out of the effect", apply: (s) => sub("    void devicePrinter().init();\n", "")(s).replace("  const syncHostPref", "  void devicePrinter().init();\n  const syncHostPref") },
      { name: "init removed", apply: sub("    void devicePrinter().init();\n", "") },
    ],
  },
  {
    // The Phase 1 final gate (I-3, deliberate change): in the Windows app the shell's own sentence, unwrapped.
    name: "bridge: a lane failure shows its own sentence; the Windows app's, unwrapped",
    file: "hooks/use-print-host-bridge.ts",
    pin: (s) => {
      const p: string[] = [];
      check(p, s.includes('import { hostPrintFailureMessage } from "@/lib/print-write-outcome";'), "imports hostPrintFailureMessage");
      const handler = between(s, "const onPrintError = useCallback(", "[settle]");
      check(p, handler.includes('(_where: "onBeforePrint" | "print", error: Error) =>') && handler.includes("settle(hostPrintFailureMessage(error))"), "onPrintError maps hostPrintFailureMessage(error)");
      check(p, count(s, "onPrintError,") === 3, "all three surfaces still pass onPrintError,");
      return p;
    },
    mutations: [
      { name: "always the generic sentence", apply: sub("settle(hostPrintFailureMessage(error))", "settle(PRINT_HOST_PRINT_FAILED_MESSAGE)") },
      { name: "import dropped", apply: sub('import { hostPrintFailureMessage } from "@/lib/print-write-outcome";\n', "") },
      { name: "error argument ignored", apply: sub("(_where: \"onBeforePrint\" | \"print\", error: Error) =>", "() =>") },
    ],
  },
  {
    name: "routine beat: carries the printer report, absent on no report",
    file: "hooks/use-print-host-beat.ts",
    pin: (s, r) => {
      const p: string[] = [];
      check(p, count(s, BEAT_CALL) === 1 && !s.includes("beat({ deviceId });"), "the routine beat is beat({ deviceId, printer: beatPrinterReport() })");
      check(p, s.includes('import { beatPrinterReport, beatSilentMode } from "@/lib/printer/print-lane";'), "imports beatPrinterReport and beatSilentMode");
      check(p, /printer\?: PrintHostBeatPrinter;/.test(s), "BeatPrintHostInput.printer is optional");
      // s63 W-H/W-O: 80 -> 90 -- the shared mutation scope, the onHost hook and its option add 7 lines (measured 86).
      check(p, lines(r) <= 90, "stays <= 90 lines");
      return p;
    },
    mutations: [
      { name: "printer dropped", apply: sub(BEAT_CALL, "beat({ deviceId });") },
      { name: "silent mode dropped", apply: sub(BEAT_CALL, "beat({ deviceId, printer: beatPrinterReport() });") },
      { name: "printer required", apply: sub("printer?: PrintHostBeatPrinter;", "printer: PrintHostBeatPrinter;") },
      { name: "reported only in a comment", apply: sub(BEAT_CALL, `beat({ deviceId }); // ${BEAT_CALL}`) },
    ],
  },
  {
    name: "printer beat: debounced, change-only, only while enabled",
    file: "hooks/use-print-host-printer-beat.ts",
    pin: (s) => {
      const p: string[] = [];
      check(p, s.includes("export const PRINTER_STATUS_BEAT_DEBOUNCE_MS = 1000;"), "debounce constant 1000");
      check(p, ordered(s, ['if (!enabled || deviceId === "") return;', "createReportDebouncer<BeatPrinterReport, number>({", "delayMs: PRINTER_STATUS_BEAT_DEBOUNCE_MS,", "read: beatPrinterReport,", "send: (printer) => beat({ deviceId, printer }),", "devicePrinter().subscribe(debouncer.poke)", "debouncer.dispose();"]), "gate -> debouncer(delay, read, send) -> subscribe -> dispose");
      check(p, s.includes("onWindowEvent(NATIVE_READY_EVENT, debouncer.poke)"), "a late app bridge also re-reads");
      // s63 W-I: the first report goes out at once, and the debouncer starts from it (no duplicate on the first poke).
      check(p, ordered(s, ["const first = beatPrinterReport();", "initial: first,", "if (first !== undefined) beat({ deviceId, printer: first });", "return () => {"]), "enable -> send the current report once, debouncer seeded with it");
      check(p, s.includes("useBeatPrintHost({ onNotHost: onDemoted })"), "a demotion answer clears the host pref");
      return p;
    },
    mutations: [
      { name: "enabled gate removed", apply: sub('if (!enabled || deviceId === "") return;', 'if (deviceId === "") return;') },
      { name: "debounce 1000 -> 0", apply: sub("DEBOUNCE_MS = 1000", "DEBOUNCE_MS = 0") },
      { name: "no dispose", apply: sub("      debouncer.dispose();\n", "") },
      { name: "sends every poke (read bypasses the report)", apply: sub("read: beatPrinterReport,", "read: () => \"connected\" as const,") },
      { name: "never subscribes to the printer", apply: sub("devicePrinter().subscribe(debouncer.poke)", "(() => undefined)") },
      { name: "no immediate report", apply: sub("    if (first !== undefined) beat({ deviceId, printer: first });\n", "") },
      { name: "debouncer not seeded (first poke would resend)", apply: sub("      initial: first,\n", "") },
    ],
  },
  {
    name: "native host: visible-only, app.wake = one refetch, cleanup lets go, no poll",
    file: "hooks/use-native-host.ts",
    pin: (s) => {
      const p: string[] = [];
      check(p, s.includes('export const NATIVE_HOST_FALLBACK_LABEL = "This device";'), "the label constant");
      check(p, s.includes('if (document.visibilityState === "visible") tell(true);'), "announces only while visible");
      check(p, s.includes('document.addEventListener("visibilitychange", announce);') && s.includes('document.removeEventListener("visibilitychange", announce);'), "re-announces on visibilitychange and unhooks it");
      // s63 W-Z: a wake right after a poll would only stack a second fetch -- refresh only when the pulse is older than one poll.
      check(p, ordered(s, ['nativeOn("app.wake", () => {', "qc.getQueryState(POS_PULSE_KEYS.all)?.dataUpdatedAt ?? 0;", "if (Date.now() - updatedAt <= REFETCH_INTERVALS.POS_PULSE) return;", "void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });"]), "app.wake invalidates the pulse once, and only when it is older than one poll interval");
      check(p, s.includes('import { REFETCH_INTERVALS } from "@/lib/query";'), "imports REFETCH_INTERVALS");
      // Phase 3 Session 3D deliberately changed: the cleanup's own tell(false) (a second one tells a page that knows it prints nothing).
      check(p, ordered(s, ["const announce = (): void => {", "announce();", "return () => {", "offWake();\n      tell(false);"]), "cleanup unhooks then sends active:false");
      check(p, s.includes("if (!enabled || !hasBridge) return;") && s.includes("usePrintCapabilities().native"), "only while enabled with the app bridge present");
      check(p, s.includes("nativeRequest(\"host.background\", params).catch(() => undefined);"), "a failed request is swallowed");
      // Phase 3 Session 3D: a page that knows this device prints nothing says so once (the app keeps a wish across restarts).
      check(p, s.includes("if (!hasBridge || enabled || !decided) return;\n    tell(false);"), "a page that knows this device prints nothing tells the app once");
      check(p, !/setInterval|refetchInterval/.test(s), "no new poll (ruling 5)");
      return p;
    },
    mutations: [
      { name: "visible gate removed", apply: sub('if (document.visibilityState === "visible") tell(true);', "tell(true);") },
      { name: "wake event renamed", apply: sub('nativeOn("app.wake"', 'nativeOn("app.woke"') },
      { name: "no cleanup release", apply: sub("      tell(false);\n", "") },
      { name: "a poll sneaks in", apply: sub("announce();\n", "announce();\n    setInterval(announce, 5000);\n") },
      { name: "wake refetches another key", apply: sub("queryKey: POS_PULSE_KEYS.all", 'queryKey: ["x"]') },
      { name: "wake always refetches (freshness guard removed)", apply: sub("      if (Date.now() - updatedAt <= REFETCH_INTERVALS.POS_PULSE) return;\n", "") },
      { name: "freshness guard compares the wrong way", apply: sub("<= REFETCH_INTERVALS.POS_PULSE", ">= REFETCH_INTERVALS.POS_PULSE") },
      { name: "errors surface", apply: sub(".catch(() => undefined)", "") },
      { name: "bridge gate removed", apply: sub("!enabled || !hasBridge", "!enabled") },
    ],
  },
];

for (const c of CASES) {
  test(`PIN: ${c.name}`, () => {
    const rawSrc = raw(c.file);
    assert.deepEqual(c.pin(code(rawSrc), rawSrc), [], c.file);
  });
}

test("MUTATION self-check: every pin reports a problem for each named in-memory mutation", () => {
  let applied = 0;
  for (const c of CASES) {
    assert.ok(c.mutations.length > 0, `${c.file}: a pin case needs at least one mutation`);
    const real = raw(c.file);
    assert.deepEqual(c.pin(code(real), real), [], `${c.file}: the unmutated source must be clean first`);
    for (const m of c.mutations) {
      const mutated = m.apply(real);
      assert.notEqual(mutated, real, `${c.file} :: ${m.name}: the mutation changed nothing`);
      assert.ok(c.pin(code(mutated), mutated).length >= 1, `${c.file} :: ${m.name}: the pin did NOT notice`);
      applied++;
    }
  }
  assert.ok(applied >= CASES.length, "landmark: mutations were applied");
});

// ---- the dispatch budget -----------------------------------------------------------------------

// react-to-print's own pre-work before print() runs: its 500 ms dispatch timer, the content clone,
// the stylesheet/image waits -- measured, then rounded up (s63 W-C).
const RTP_PREPRINT_ALLOWANCE_MS = 3_000;
const fitsDispatch = (write: number, raster: number, allowance: number, dispatch: number): boolean => write + raster + allowance < dispatch;

test("budget: the slowest print (slip drawing + device write) ends before the host bridge's watchdog fires", () => {
  // The write deadline is IMPORTED, never restated here: it is owned (and lowered, s63) by device-printer.ts.
  assert.deepEqual([LANE_RASTER_DEADLINE_MS, PRINT_HOST_DISPATCH_TIMEOUT_MS, RTP_PREPRINT_ALLOWANCE_MS], [12_000, 90_000, 3_000]);
  assert.ok(fitsDispatch(DEVICE_WRITE_DEADLINE_MS, LANE_RASTER_DEADLINE_MS, RTP_PREPRINT_ALLOWANCE_MS, PRINT_HOST_DISPATCH_TIMEOUT_MS), "write + drawing + react-to-print pre-work < the dispatch watchdog");
  assert.equal(fitsDispatch(DEVICE_WRITE_DEADLINE_MS, 18_000, RTP_PREPRINT_ALLOWANCE_MS, PRINT_HOST_DISPATCH_TIMEOUT_MS), false, "the check bites: a drawing that ran 18 s does not fit");
  assert.equal(fitsDispatch(DEVICE_WRITE_DEADLINE_MS, LANE_RASTER_DEADLINE_MS, 8_000, PRINT_HOST_DISPATCH_TIMEOUT_MS), false, "the check bites: the pre-work allowance counts");
});

// ---- reachability (built-but-uncalled is not done) ------------------------------------------------

function callSites(needle: string): string[] {
  const hits: string[] = [];
  for (const dir of ["app", "components", "hooks", "lib"]) {
    const walk = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") && readFileSync(full, "utf8").includes(needle)) {
          hits.push(path.relative(CAFE, full).split(path.sep).join("/"));
        }
      }
    };
    walk(path.join(CAFE, dir));
  }
  return hits.sort();
}

test("reachability: each new hook has its definition and exactly one call site, in PrintHostDrain", () => {
  assert.deepEqual(callSites("usePrintHostPrinterBeat("), ["components/print/PrintHostDrain.tsx", "hooks/use-print-host-printer-beat.ts"]);
  assert.deepEqual(callSites("useNativeHostBackground("), ["components/print/PrintHostDrain.tsx", "hooks/use-native-host.ts"]);
  assert.deepEqual(callSites("return laneSlipPrintOptions("), ["lib/desktop-shell.ts"]);
});

test("new files: no console call, no cafe name, no browser-identity read, <= 300 lines", () => {
  const banned = [/\bconsole\s*\./, new RegExp("luci" + "fer", "i"), new RegExp("user" + "agent", "i")];
  for (const file of ["lib/printer/lane-print.ts", "hooks/use-print-host-printer-beat.ts", "hooks/use-native-host.ts"]) {
    const src = raw(file);
    for (const re of banned) assert.ok(!re.test(src), `${file}: banned ${re}`);
    assert.ok(lines(src) <= 300, `${file} must stay <= 300 lines`);
  }
});
