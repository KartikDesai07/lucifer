// Print-host plan (.claude/plan/v2/print-host-plan.md §B5, slice PH-5) — RAW
// source-text pins over the print-host tree: reachability from the dashboard
// layout, the provider/drain/bridge wiring, the pure-adapter/local-lane
// parity markers, and the line budgets the file split exists for. Same
// readSrc + REPO_ROOT idiom as lib/pos-pulse-paths.test.ts and
// lib/print-routing.test.ts — NO stripComments: testing.md's banned-string
// scans read raw bytes, comments included, so a source-text pin never blinds
// them either. Every negative pin below is paired with a positive landmark
// assert in the SAME test, per testing.md's vision-guard rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const DASHBOARD_LAYOUT = "apps/cafe/app/(dashboard)/layout.tsx";
const PRINT_HOST_PROVIDER = "apps/cafe/components/layout/PrintHostProvider.tsx";
const POS_PULSE_PROVIDER = "apps/cafe/components/layout/PosPulseProvider.tsx";
const PRINT_HOST_DRAIN = "apps/cafe/components/print/PrintHostDrain.tsx";
const USE_PRINT_HOST_DRAIN = "apps/cafe/hooks/use-print-host-drain.ts";
const USE_PRINT_HOST_BEAT = "apps/cafe/hooks/use-print-host-beat.ts";
const USE_PRINT_HOST_LOCK = "apps/cafe/hooks/use-print-host-lock.ts";
const USE_PRINT_HOST_WAKE_LOCK = "apps/cafe/hooks/use-print-host-wake-lock.ts";
const USE_PRINT_HOST_BRIDGE = "apps/cafe/hooks/use-print-host-bridge.ts";
const PRINT_HOST_PRINT_SOURCES = "apps/cafe/components/print/PrintHostPrintSources.tsx";
const PRINT_HOST_EOD_SOURCE = "apps/cafe/components/print/PrintHostEodSource.tsx";
const PRINT_HOST_TEST_SLIP = "apps/cafe/components/print/PrintHostTestSlip.tsx";
const END_OF_DAY_BUTTON = "apps/cafe/components/reports/EndOfDayButton.tsx";
const USE_SELF_ORDER_AUTO_PRINT = "apps/cafe/hooks/use-self-order-auto-print.ts";
const USE_HOST_ROUTING = "apps/cafe/hooks/use-host-routing.ts";
const POS_DEVICE_ID = "apps/cafe/lib/pos-device-id.ts";

// ── A. Reachability (plan §B5 tree) ──────────────────────────────────────

test("PIN (A): app/(dashboard)/layout.tsx imports PrintHostProvider and PrintHostPrintSources; <PrintHostProvider> nests INSIDE <PosPulseProvider>, and <PrintHostPrintSources /> sits AFTER <main className=\"flex-1 p-4 md:p-6\"> and BEFORE </SidebarInset> — paired with the positive landmark <RequestAlertBar />", () => {
  const src = readSrc(DASHBOARD_LAYOUT);

  assert.match(src, /import\s*\{\s*PrintHostProvider\s*\}\s*from\s*"@\/components\/layout\/PrintHostProvider"/, "layout.tsx must import PrintHostProvider");
  assert.match(src, /import\s*\{\s*PrintHostPrintSources\s*\}\s*from\s*"@\/components\/print\/PrintHostPrintSources"/, "layout.tsx must import PrintHostPrintSources");

  const posPulseOpen = src.indexOf("<PosPulseProvider>");
  const printHostOpen = src.indexOf("<PrintHostProvider>");
  const sidebarInsetOpen = src.indexOf("<SidebarInset>");
  assert.ok(posPulseOpen >= 0, "positive landmark: <PosPulseProvider> must be present");
  assert.ok(printHostOpen >= 0, "positive landmark: <PrintHostProvider> must be present");
  assert.ok(sidebarInsetOpen >= 0, "positive landmark: <SidebarInset> must be present");
  assert.ok(
    posPulseOpen < printHostOpen && printHostOpen < sidebarInsetOpen,
    `expected index order PosPulseProvider(${posPulseOpen}) < PrintHostProvider(${printHostOpen}) < SidebarInset(${sidebarInsetOpen})`,
  );

  const mainOpen = src.indexOf('<main className="flex-1 p-4 md:p-6">');
  const printSourcesOpen = src.indexOf("<PrintHostPrintSources />");
  const sidebarInsetClose = src.indexOf("</SidebarInset>");
  assert.ok(mainOpen >= 0, "positive landmark: <main className=\"flex-1 p-4 md:p-6\"> must be present");
  assert.ok(printSourcesOpen >= 0, "positive landmark: <PrintHostPrintSources /> must be present");
  assert.ok(sidebarInsetClose >= 0, "positive landmark: </SidebarInset> must be present");
  assert.ok(
    mainOpen < printSourcesOpen && printSourcesOpen < sidebarInsetClose,
    `expected index order <main...>(${mainOpen}) < <PrintHostPrintSources />(${printSourcesOpen}) < </SidebarInset>(${sidebarInsetClose})`,
  );

  assert.match(src, /<RequestAlertBar \/>/, "positive landmark: <RequestAlertBar /> must still be present");
});

// ── B. PrintHostProvider.tsx ──────────────────────────────────────────────

test("PIN (B): PrintHostProvider.tsx renders <PrintHostDrain AFTER {children} inside <PrintHostContext.Provider; declares claimLockRef = useRef(false) exactly once; imports mintTabId/readDeviceId from @/lib/pos-device-id; reads prefs only inside effects (readDevicePrefs().printHost never on the same line as useState() — a render-time read) — paired with the positive landmark useState(false) seeding prefHost", () => {
  const src = readSrc(PRINT_HOST_PROVIDER);

  const providerOpen = src.indexOf("<PrintHostContext.Provider");
  const childrenAt = src.indexOf("{children}");
  // "<PrintHostDrain" alone also matches the header comment's prose mention
  // ("run in <PrintHostDrain>, a ...") which sits BEFORE the component
  // function — search for the actual JSX usage (its own multi-line opening
  // tag, followed by a newline before the first prop) instead.
  const drainAt = src.indexOf("<PrintHostDrain\n");
  assert.ok(providerOpen >= 0 && childrenAt >= 0 && drainAt >= 0, "positive landmark: all three markers must be present");
  assert.ok(
    providerOpen < childrenAt && childrenAt < drainAt,
    `expected index order <PrintHostContext.Provider(${providerOpen}) < {children}(${childrenAt}) < <PrintHostDrain(${drainAt})`,
  );

  const claimLockDecls = countOccurrences(src, "claimLockRef = useRef(false)");
  assert.equal(claimLockDecls, 1, `expected claimLockRef = useRef(false) exactly once, found ${claimLockDecls}`);

  assert.match(
    src,
    /import\s*\{\s*mintTabId,\s*readDeviceId\s*\}\s*from\s*"@\/lib\/pos-device-id"/,
    "PrintHostProvider.tsx must import { mintTabId, readDeviceId } from \"@/lib/pos-device-id\"",
  );

  // positive landmark before the negative render-time-read check.
  assert.match(src, /const \[prefHost, setPrefHost\] = useState\(false\)/, "positive landmark: useState(false) must seed prefHost");
  assert.ok(src.includes("readDevicePrefs().printHost"), "positive landmark: readDevicePrefs().printHost must be read somewhere");

  const lines = src.split("\n");
  for (const line of lines) {
    if (line.includes("useState(") && line.includes("readDevicePrefs()")) {
      assert.fail(`readDevicePrefs() must never be read on the same line as useState( — found: ${line.trim()}`);
    }
  }
});

// ── R. PrintHostProvider.tsx: surfacesMounted wiring (2026-09-11) ──────────
// A job claimed while PrintHostPrintSources was unmounted (behind
// MasterDataProvider's first-load placeholder) used to fire react-to-print at
// a null contentRef, which returns silently (no onAfterPrint, no
// onPrintError) and wedged the bridge for the rest of the tab's life. The
// drain and the bridge now arm only once the surfaces report themselves
// mounted. The OLD enabled prop (no surfacesMounted gate) is a needle built
// by concatenation so this test's own prose never trips it.

test("PIN (R): PrintHostProvider.tsx declares const [surfacesMounted, setSurfacesMounted] = useState(false); passes usePrintHostBridge({ surfacesMounted }); renders enabled={isHostDevice && surfacesMounted} on <PrintHostDrain (the pre-2026-09-11 enabled={isHostDevice} form is ABSENT); exposes reportSurfacesMounted in both the interface and the useMemo value", () => {
  const src = readSrc(PRINT_HOST_PROVIDER);

  assert.match(
    src,
    /const \[surfacesMounted, setSurfacesMounted\] = useState\(false\);/,
    "must declare const [surfacesMounted, setSurfacesMounted] = useState(false);",
  );
  assert.ok(
    src.includes("usePrintHostBridge({ surfacesMounted })"),
    "must call usePrintHostBridge({ surfacesMounted })",
  );

  // positive landmark: the NEW gated enabled prop is present.
  assert.ok(
    src.includes("enabled={isHostDevice && surfacesMounted}"),
    "positive landmark: <PrintHostDrain must render enabled={isHostDevice && surfacesMounted}",
  );
  // negative pin: the OLD ungated form (built by concatenation so this line
  // itself can never match) must be gone — a claim must never be won before
  // the surfaces the drain would hand it to actually exist.
  const OLD_ENABLED_NEEDLE = "enabled={isHostDevice}" + "\n";
  assert.ok(
    !src.includes(OLD_ENABLED_NEEDLE),
    "the pre-2026-09-11 enabled={isHostDevice} (ungated by surfacesMounted) must be gone",
  );

  assert.match(
    src,
    /reportSurfacesMounted: \(mounted: boolean\) => void;/,
    "the PrintHostContextValue interface must declare reportSurfacesMounted: (mounted: boolean) => void;",
  );
  assert.ok(
    src.includes("reportSurfacesMounted"),
    "positive landmark: reportSurfacesMounted must appear somewhere (the interface field just asserted above)",
  );
  const useMemoAt = src.indexOf("useMemo<PrintHostContextValue>(");
  assert.ok(useMemoAt >= 0, "positive landmark: useMemo<PrintHostContextValue>( must be present");
  const useMemoBlock = src.slice(useMemoAt, src.indexOf("\n  );", useMemoAt));
  assert.ok(
    useMemoBlock.includes("reportSurfacesMounted"),
    "reportSurfacesMounted must be exposed in the useMemo value",
  );
});

// ── S. PrintHostPrintSources.tsx: reports mount/unmount (2026-09-11) ───────

test("PIN (S): PrintHostPrintSources.tsx destructures reportSurfacesMounted from usePrintHostContext(); a useEffect( contains reportSurfacesMounted(true) with a cleanup containing reportSurfacesMounted(false); that useEffect( appears BEFORE if (!current) return null;", () => {
  const src = readSrc(PRINT_HOST_PRINT_SOURCES);

  assert.match(
    src,
    /const \{ current, kotRef, receiptRef, eodRef, setEodReady, reportSurfacesMounted \} = usePrintHostContext\(\);/,
    "must destructure reportSurfacesMounted from usePrintHostContext()",
  );

  const useEffectAt = src.indexOf("useEffect(");
  const guardAt = src.indexOf("if (!current) return null;");
  assert.ok(useEffectAt >= 0 && guardAt >= 0, "positive landmark: both useEffect( and if (!current) return null; must be present");
  assert.ok(
    useEffectAt < guardAt,
    `expected useEffect((${useEffectAt}) to appear BEFORE if (!current) return null;(${guardAt}) — the mount report must run even while current is null`,
  );

  const effectBody = src.slice(useEffectAt, guardAt);
  assert.ok(effectBody.includes("reportSurfacesMounted(true)"), "the useEffect( body must call reportSurfacesMounted(true)");
  const cleanupAt = effectBody.indexOf("return () =>");
  assert.ok(cleanupAt >= 0, "positive landmark: the effect must return a cleanup function");
  assert.ok(
    effectBody.slice(cleanupAt).includes("reportSurfacesMounted(false)"),
    "the effect's cleanup must call reportSurfacesMounted(false)",
  );
});

// ── T. use-print-host-bridge.ts: dispatch guards (2026-09-11) ──────────────

test("PIN (T): use-print-host-bridge.ts's dispatch effect guards on !surfacesMounted, settles PRINT_HOST_EMPTY_SLIP_MESSAGE on blank textContent and PRINT_HOST_PRINT_FAILED_MESSAGE on a null node, sets dispatchedRef.current = true between both settle guards and printReceipt(), arms/clears the watchdog with PRINT_HOST_DISPATCH_TIMEOUT_MS, and imports both new constants from @/lib/print-host-slips", () => {
  const src = readSrc(USE_PRINT_HOST_BRIDGE);

  assert.match(
    src,
    /if \(!current \|\| dispatchedRef\.current \|\| !surfacesMounted\) return;/,
    "the dispatch effect's first guard must be exactly if (!current || dispatchedRef.current || !surfacesMounted) return;",
  );

  assert.ok(src.includes("settle(PRINT_HOST_EMPTY_SLIP_MESSAGE)"), "must call settle(PRINT_HOST_EMPTY_SLIP_MESSAGE)");
  assert.ok(src.includes("node.textContent"), "positive landmark: node.textContent must be read");

  const nullNodeGuardAt = src.indexOf("if (!node) {");
  assert.ok(nullNodeGuardAt >= 0, "positive landmark: if (!node) { must be present");
  const afterNullGuard = src.slice(nullNodeGuardAt, nullNodeGuardAt + 200);
  assert.ok(
    afterNullGuard.includes("settle(PRINT_HOST_PRINT_FAILED_MESSAGE)"),
    "if (!node) { must be followed by settle(PRINT_HOST_PRINT_FAILED_MESSAGE)",
  );

  const emptySlipSettleAt = src.indexOf("settle(PRINT_HOST_EMPTY_SLIP_MESSAGE)");
  const dispatchedTrueAt = src.indexOf("dispatchedRef.current = true;");
  const printReceiptCallAt = src.indexOf("printReceipt();");
  assert.ok(
    nullNodeGuardAt >= 0 && emptySlipSettleAt >= 0 && dispatchedTrueAt >= 0 && printReceiptCallAt >= 0,
    "positive landmark: all four markers must be present",
  );
  assert.ok(
    nullNodeGuardAt < dispatchedTrueAt && emptySlipSettleAt < dispatchedTrueAt && dispatchedTrueAt < printReceiptCallAt,
    `expected both settle guards (node null @${nullNodeGuardAt}, empty slip @${emptySlipSettleAt}) BEFORE dispatchedRef.current = true;(${dispatchedTrueAt}), and that BEFORE printReceipt();(${printReceiptCallAt})`,
  );

  assert.ok(
    src.includes("window.setTimeout(() => settle(PRINT_HOST_PRINT_FAILED_MESSAGE), PRINT_HOST_DISPATCH_TIMEOUT_MS)"),
    "must arm the watchdog with window.setTimeout(() => settle(PRINT_HOST_PRINT_FAILED_MESSAGE), PRINT_HOST_DISPATCH_TIMEOUT_MS)",
  );

  const clearWatchdogAt = src.indexOf("window.clearTimeout(watchdogRef.current);");
  const dispatchedFalseAt = src.indexOf("dispatchedRef.current = false;");
  assert.ok(clearWatchdogAt >= 0 && dispatchedFalseAt >= 0, "positive landmark: both clear markers must be present");
  assert.ok(
    clearWatchdogAt < dispatchedFalseAt,
    `expected window.clearTimeout(watchdogRef.current);(${clearWatchdogAt}) inside settle BEFORE dispatchedRef.current = false;(${dispatchedFalseAt})`,
  );

  assert.match(
    src,
    /import\s*\{[\s\S]*?PRINT_HOST_DISPATCH_TIMEOUT_MS[\s\S]*?\}\s*from\s*"@\/lib\/print-host-slips"/,
    "must import PRINT_HOST_DISPATCH_TIMEOUT_MS from @/lib/print-host-slips",
  );
  assert.match(
    src,
    /import\s*\{[\s\S]*?PRINT_HOST_EMPTY_SLIP_MESSAGE[\s\S]*?\}\s*from\s*"@\/lib\/print-host-slips"/,
    "must import PRINT_HOST_EMPTY_SLIP_MESSAGE from @/lib/print-host-slips",
  );
});

// ── C. PosPulseProvider.tsx ────────────────────────────────────────────────

test("PIN (C): PosPulseProvider.tsx exports usePrintJobFeed; declares createContext<PrintJobFeedRow[] | null>(null); module-level EMPTY_PRINT_JOBS: PrintJobFeedRow[] = []; provides <PrintJobFeedContext.Provider value={printJobs}>; derives printJobs exactly once; the print-handler registry is a STACK (setPrintHandlers push + current.filter(h => h !== fn)), never setPrintHandler( (old single-slot setter) — landmark: value literal still names printHandler, registerKotPrintHandler; NO useMemo anywhere; hostRoutingOf( exactly once; no pulseUpdatedAt/dataUpdatedAt anywhere (MERGED-08 amendment)", () => {
  const src = readSrc(POS_PULSE_PROVIDER);

  assert.match(src, /export function usePrintJobFeed\(\)/, "PosPulseProvider.tsx must export usePrintJobFeed");
  assert.match(src, /createContext<PrintJobFeedRow\[\] \| null>\(null\)/, "must declare createContext<PrintJobFeedRow[] | null>(null)");
  assert.match(
    src,
    /const EMPTY_PRINT_JOBS: PrintJobFeedRow\[\] = \[\];/,
    "must declare a module-level const EMPTY_PRINT_JOBS: PrintJobFeedRow[] = [];",
  );
  assert.match(
    src,
    /<PrintJobFeedContext\.Provider value=\{printJobs\}>/,
    "must provide <PrintJobFeedContext.Provider value={printJobs}>",
  );
  const printJobsDerivations = countOccurrences(src, "const printJobs = data?.printJobs ?? EMPTY_PRINT_JOBS;");
  assert.equal(printJobsDerivations, 1, `expected printJobs derived exactly once, found ${printJobsDerivations}`);

  // the registry stack, and the single-slot setter it replaced must be gone.
  assert.match(src, /setPrintHandlers\(\(current\) => \[\.\.\.current, fn\]\)/, "registry must push via setPrintHandlers((current) => [...current, fn])");
  assert.match(src, /current\.filter\(\(h\) => h !== fn\)/, "unregister must filter via current.filter((h) => h !== fn)");
  assert.match(src, /printHandler, registerKotPrintHandler \}/, "positive landmark: the value literal must still name printHandler, registerKotPrintHandler");
  assert.ok(!src.includes("setPrintHandler("), "must NOT contain the old single-slot setter setPrintHandler( — replaced by the stack setPrintHandlers");

  // no useMemo anywhere — RAW scan, comments included (testing.md).
  assert.match(src, /usePosPulse\(\)/, "positive landmark: usePosPulse() must still be called");
  assert.ok(!src.includes("useMemo"), "PosPulseProvider.tsx must contain NO useMemo anywhere, not even in a comment");

  const hostRoutingOfCalls = countOccurrences(src, "hostRoutingOf(");
  assert.equal(hostRoutingOfCalls, 1, `expected hostRoutingOf( exactly once, found ${hostRoutingOfCalls}`);

  // MERGED-08 amendment: the beat uses a QueryCache subscription instead of a
  // pulseUpdatedAt/dataUpdatedAt context field.
  assert.ok(!src.includes("pulseUpdatedAt"), "must NOT contain pulseUpdatedAt anywhere (MERGED-08 amendment)");
  assert.ok(!src.includes("dataUpdatedAt"), "must NOT contain dataUpdatedAt anywhere (MERGED-08 amendment)");
});

// ── D. PrintHostDrain.tsx ──────────────────────────────────────────────────

test("PIN (D): PrintHostDrain.tsx calls usePrintJobFeed() (the narrow feed) and does NOT contain usePosPulseContext (the pos-pulse-paths.test.ts inventory pin stays at five); calls usePrintHostDrainLock(/usePrintHostWakeLock(/usePrintHostBeat(/useSelfOrderAutoPrint(/usePrintHostDrain(; passes hostLane containing PRINT_HOST_MAX_AGE_MS; both claiming lanes get enabled: drains where const drains = enabled && holdsLock; returns null; calls cafeDateString() inside onClaimed", () => {
  const src = readSrc(PRINT_HOST_DRAIN);

  assert.match(src, /usePrintJobFeed\(\)/, "must call usePrintJobFeed()");
  assert.ok(!src.includes("usePosPulseContext"), "PrintHostDrain.tsx must never reference usePosPulseContext — the pos-pulse-paths.test.ts inventory of five deliberate consumers must stay unchanged");

  for (const call of [
    "usePrintHostDrainLock(",
    "usePrintHostWakeLock(",
    "usePrintHostBeat(",
    "useSelfOrderAutoPrint(",
    "usePrintHostDrain(",
  ]) {
    assert.ok(src.includes(call), `PrintHostDrain.tsx must call ${call}`);
  }

  assert.match(src, /const drains = enabled && holdsLock;/, "must declare const drains = enabled && holdsLock;");
  const enabledDrainsCount = countOccurrences(src, "enabled: drains");
  assert.equal(enabledDrainsCount, 2, `expected enabled: drains exactly twice (both claiming lanes), found ${enabledDrainsCount}`);

  assert.ok(src.includes("PRINT_HOST_MAX_AGE_MS"), "hostLane must reference PRINT_HOST_MAX_AGE_MS");
  assert.match(src, /return null;/, "PrintHostDrain must return null — a null-rendering child");
  assert.match(src, /cafeDateString\(\)/, "must call cafeDateString() inside onClaimed");
});

// ── E. use-print-host-drain.ts ─────────────────────────────────────────────

test("PIN (E): use-print-host-drain.ts calls printJobDrainCandidate( with PRINT_HOST_MAX_AGE_MS; claimLockRef.current = true; and attemptedRef.current.add(candidate.id); BOTH appear before claimMutate(; onSettled clears claimLockRef.current = false;; onError deletes attemptedRef.current.delete(candidate.id); const { mutate: claimMutate } = claim;; if (result.reason === \"not-host\") onDemoted();; gate if (claimingRef.current || claimLockRef.current) return;", () => {
  const src = readSrc(USE_PRINT_HOST_DRAIN);

  const drainCandidateCall = src.indexOf("printJobDrainCandidate(");
  assert.ok(drainCandidateCall >= 0, "positive landmark: printJobDrainCandidate( must be called");
  // PRINT_HOST_MAX_AGE_MS must appear as an argument within the same call —
  // check it appears after the call opens and before the matching close, by
  // requiring it within a bounded window of source after the call.
  const afterCall = src.slice(drainCandidateCall, drainCandidateCall + 200);
  assert.ok(afterCall.includes("PRINT_HOST_MAX_AGE_MS"), "printJobDrainCandidate( must be called with PRINT_HOST_MAX_AGE_MS");

  const claimLockTrueAt = src.indexOf("claimLockRef.current = true;");
  const attemptedAddAt = src.indexOf("attemptedRef.current.add(candidate.id);");
  const claimMutateAt = src.indexOf("claimMutate(");
  assert.ok(claimLockTrueAt >= 0 && attemptedAddAt >= 0 && claimMutateAt >= 0, "positive landmark: all three markers must be present");
  assert.ok(
    claimLockTrueAt < claimMutateAt && attemptedAddAt < claimMutateAt,
    `expected claimLockRef.current = true;(${claimLockTrueAt}) and attemptedRef.current.add(candidate.id);(${attemptedAddAt}) both BEFORE claimMutate((${claimMutateAt})`,
  );

  assert.match(
    src,
    /onSettled:\s*\(\)\s*=>\s*\{[^}]*claimLockRef\.current = false;/,
    "the onSettled block must set claimLockRef.current = false;",
  );
  assert.match(
    src,
    /onError:\s*\(\)\s*=>\s*\{[^}]*attemptedRef\.current\.delete\(candidate\.id\)/,
    "the onError block must call attemptedRef.current.delete(candidate.id)",
  );
  assert.match(src, /const \{ mutate: claimMutate \} = claim;/, "must declare const { mutate: claimMutate } = claim;");
  assert.match(src, /if \(result\.reason === "not-host"\) onDemoted\(\);/, 'must call if (result.reason === "not-host") onDemoted();');
  assert.match(
    src,
    /if \(claimingRef\.current \|\| claimLockRef\.current\) return;/,
    "the gate must read if (claimingRef.current || claimLockRef.current) return;",
  );
});

// ── F. use-print-host-beat.ts (D-5) ─────────────────────────────────────────

test('PIN (F): use-print-host-beat.ts sends beat({ deviceId }) — never printHost.deviceId, pulse., or usePosPulseContext; calls getQueryCache().subscribe(, hashKey(POS_PULSE_KEYS.all), checks event.action.type !== "success" and event.action.manual; demotes on if (!result.isHost) onNotHost?.(); and never toasts (silent beat)', () => {
  const src = readSrc(USE_PRINT_HOST_BEAT);

  assert.match(src, /beat\(\{ deviceId \}\)/, "positive landmark: the beat body must be beat({ deviceId })");
  assert.ok(!src.includes("printHost.deviceId"), "must NOT reference printHost.deviceId — the beat sends the device's OWN id, not the pulse-visible one (D-5)");
  assert.ok(!src.includes("pulse."), 'must NOT contain the substring "pulse." anywhere');
  assert.ok(!src.includes("usePosPulseContext"), "must NOT reference usePosPulseContext");

  assert.match(src, /getQueryCache\(\)\.subscribe\(/, "must call getQueryCache().subscribe(");
  assert.match(src, /hashKey\(POS_PULSE_KEYS\.all\)/, "must call hashKey(POS_PULSE_KEYS.all)");
  assert.match(src, /event\.action\.type !== "success"/, 'must check event.action.type !== "success"');
  assert.match(src, /event\.action\.manual/, "must check event.action.manual");
  assert.match(src, /if \(!result\.isHost\) onNotHost\?\.\(\);/, "must demote via if (!result.isHost) onNotHost?.();");

  assert.ok(!src.includes("toast"), "use-print-host-beat.ts must never call toast — a missed beat is silent, retried on the next fetch");
});

// ── G. use-print-host-lock.ts ────────────────────────────────────────────

test('PIN (G): use-print-host-lock.ts contains navigator.locks and .request(PRINT_HOST_DRAIN_LOCK_NAME, { signal: controller.signal }; setHeld(true) appears exactly twice (the no-API fallback branch + the granted callback); cleanup contains controller.abort(); and release();', () => {
  const src = readSrc(USE_PRINT_HOST_LOCK);

  assert.ok(src.includes("navigator.locks"), "must reference navigator.locks");
  assert.ok(
    src.includes('.request(PRINT_HOST_DRAIN_LOCK_NAME, { signal: controller.signal }'),
    "must call .request(PRINT_HOST_DRAIN_LOCK_NAME, { signal: controller.signal }",
  );

  const setHeldTrueCount = countOccurrences(src, "setHeld(true)");
  assert.equal(setHeldTrueCount, 2, `expected setHeld(true) exactly twice (fallback + granted), found ${setHeldTrueCount}`);

  assert.ok(src.includes("controller.abort();"), "cleanup must call controller.abort();");
  assert.ok(src.includes("release();"), "cleanup must call release();");
});

// ── H. use-print-host-wake-lock.ts ────────────────────────────────────────

test('PIN (H): use-print-host-wake-lock.ts contains navigator.wakeLock.request(WAKE_LOCK_TYPE), "visibilitychange", and document.visibilityState !== "visible"', () => {
  const src = readSrc(USE_PRINT_HOST_WAKE_LOCK);
  assert.ok(src.includes("navigator.wakeLock.request(WAKE_LOCK_TYPE)"), "must call navigator.wakeLock.request(WAKE_LOCK_TYPE)");
  assert.ok(src.includes('"visibilitychange"'), 'must reference "visibilitychange"');
  assert.ok(src.includes('document.visibilityState !== "visible"'), 'must check document.visibilityState !== "visible"');
});

// ── I. use-print-host-bridge.ts (MERGED-13) ──────────────────────────────

test("PIN (I): use-print-host-bridge.ts declares exactly THREE useReactToPrint( calls, each with onAfterPrint: finish, (x3) and onPrintError, (x3); the eod surface uses pageStyle: RECEIPT_PAGE_STYLE; PRINT_HOST_EOD_READY_TIMEOUT_MS is used in a window.setTimeout(; busy: current !== null; queueTestSlip rejects with PRINT_HOST_BUSY_MESSAGE when occupiedRef is set; queueSlip queues (FIFO) while occupied and settle promotes the next slip before clearing — review L1", () => {
  const src = readSrc(USE_PRINT_HOST_BRIDGE);

  const useReactToPrintCalls = countOccurrences(src, "useReactToPrint(");
  assert.equal(useReactToPrintCalls, 3, `expected exactly 3 useReactToPrint( calls, found ${useReactToPrintCalls}`);
  const onAfterPrintCalls = countOccurrences(src, "onAfterPrint: finish,");
  assert.equal(onAfterPrintCalls, 3, `expected onAfterPrint: finish, exactly 3 times, found ${onAfterPrintCalls}`);
  const onPrintErrorCalls = countOccurrences(src, "onPrintError,");
  assert.equal(onPrintErrorCalls, 3, `expected onPrintError, exactly 3 times, found ${onPrintErrorCalls}`);

  assert.match(src, /pageStyle: RECEIPT_PAGE_STYLE,/, "the eod surface must use pageStyle: RECEIPT_PAGE_STYLE");
  assert.match(
    src,
    /window\.setTimeout\(\(\) => \{[\s\S]*?\}, PRINT_HOST_EOD_READY_TIMEOUT_MS\)/,
    "PRINT_HOST_EOD_READY_TIMEOUT_MS must be used as a window.setTimeout( duration",
  );
  assert.match(src, /busy: current !== null,/, "must return busy: current !== null,");
  // Review PH-5 L1 (HIGH, dist-verified): react-to-print removes the existing
  // fixed-id #printWindow at the start of EVERY print call, so a slip arriving
  // mid-print (the band's manual tap has no busy gate) must WAIT, never replace
  // `current`. Occupancy is a SYNCHRONOUS ref (state lags a render), and settle
  // promotes the next waiting slip without `current` ever touching null.
  assert.match(
    src,
    /if \(occupiedRef\.current\) \{\s*reject\(new Error\(PRINT_HOST_BUSY_MESSAGE\)\);/,
    "queueTestSlip must reject with PRINT_HOST_BUSY_MESSAGE when occupiedRef.current is set",
  );
  assert.match(
    src,
    /if \(occupiedRef\.current\) \{\s*pendingRef\.current\.push\(slip\);\s*return;\s*\}\s*occupiedRef\.current = true;\s*setCurrent\(\{ kind: "slip", slip \}\);/,
    "queueSlip must push onto pendingRef while occupied and only otherwise mark occupied + setCurrent",
  );
  assert.match(
    src,
    /const next = pendingRef\.current\.shift\(\);\s*if \(next\) \{\s*setCurrent\(\{ kind: "slip", slip: next \}\);\s*return;\s*\}\s*occupiedRef\.current = false;\s*setCurrent\(null\);/,
    "settle must promote the next pending slip before ever clearing occupancy / current",
  );
  assert.ok(!src.includes("currentRef"), "the render-lagging currentRef mirror must be gone — occupancy is the synchronous occupiedRef");
  assert.equal(countOccurrences(src, "setCurrent({ kind: \"slip\", slip"), 2, "exactly two slip setCurrent sites: queueSlip (idle) and settle (promotion)");
});

// ── J. PrintHostPrintSources.tsx (RR-13) ──────────────────────────────────

test("PIN (J): PrintHostPrintSources.tsx declares dynamic( with { ssr: false } BEFORE export function PrintHostPrintSources (module scope, not per-render); the eod branch wraps <PrintHostEodSource inside <div ref={eodRef}> (the ref is NOT a prop on <PrintHostEodSource); the KOT branch forwards movedFrom/movedBy/movedAt from slip (PH-4 MUST); if (!current) return null;", () => {
  const src = readSrc(PRINT_HOST_PRINT_SOURCES);

  const dynamicAt = src.indexOf("dynamic(");
  const exportFnAt = src.indexOf("export function PrintHostPrintSources");
  assert.ok(dynamicAt >= 0 && exportFnAt >= 0, "positive landmark: both dynamic( and export function PrintHostPrintSources must be present");
  assert.ok(dynamicAt < exportFnAt, `expected dynamic((${dynamicAt}) BEFORE export function PrintHostPrintSources(${exportFnAt}) — module scope, not per-render`);
  assert.match(src, /\{ ssr: false \}/, "dynamic( must be called with { ssr: false }");

  assert.match(
    src,
    /<div ref=\{eodRef\}>\s*<PrintHostEodSource/,
    "the eod branch must wrap <PrintHostEodSource inside <div ref={eodRef}>",
  );
  assert.ok(!/<PrintHostEodSource[^>]*\bref=/.test(src), "the ref must NOT be a prop directly on <PrintHostEodSource — it belongs to the wrapping div");

  assert.match(src, /movedFrom=\{slip\.movedFrom\}/, "the KOT branch must forward movedFrom={slip.movedFrom} (PH-4 MUST)");
  assert.match(src, /movedBy=\{slip\.movedBy\}/, "the KOT branch must forward movedBy={slip.movedBy} (PH-4 MUST)");
  assert.match(src, /movedAt=\{slip\.movedAt\}/, "the KOT branch must forward movedAt={slip.movedAt} (PH-4 MUST)");

  assert.match(src, /if \(!current\) return null;/, "must guard if (!current) return null;");
});

// ── K. PrintHostEodSource.tsx parity with EndOfDayButton.tsx ────────────

test("PIN (K): PrintHostEodSource.tsx and EndOfDayButton.tsx BOTH contain the literal { payment: \"Unpaid\", status: \"Pending\", limit: 200 } and the literal !!summary.data && !!settings.data && (!isToday || openTabs.isSuccess); PrintHostEodSource does NOT contain useReactToPrint (data-only) and calls onReady(ready); contains return () => onReady(false);", () => {
  const eodSrc = readSrc(PRINT_HOST_EOD_SOURCE);
  const endOfDaySrc = readSrc(END_OF_DAY_BUTTON);

  const sharedQueryLiteral = '{ payment: "Unpaid", status: "Pending", limit: 200 }';
  const sharedReadyLiteral = "!!summary.data && !!settings.data && (!isToday || openTabs.isSuccess)";

  assert.ok(eodSrc.includes(sharedQueryLiteral), `PrintHostEodSource.tsx must contain the literal ${sharedQueryLiteral}`);
  assert.ok(endOfDaySrc.includes(sharedQueryLiteral), `EndOfDayButton.tsx must contain the literal ${sharedQueryLiteral}`);
  assert.ok(eodSrc.includes(sharedReadyLiteral), `PrintHostEodSource.tsx must contain the literal ${sharedReadyLiteral}`);
  assert.ok(endOfDaySrc.includes(sharedReadyLiteral), `EndOfDayButton.tsx must contain the literal ${sharedReadyLiteral}`);

  // positive landmark before the negative check.
  assert.match(eodSrc, /onReady\(ready\)/, "positive landmark: PrintHostEodSource.tsx must call onReady(ready)");
  assert.ok(!eodSrc.includes("useReactToPrint"), "PrintHostEodSource.tsx must NOT contain useReactToPrint — it is data-only, the bridge owns the trigger");
  assert.match(eodSrc, /return \(\) => onReady\(false\);/, "must contain return () => onReady(false);");
});

// ── L. PrintHostTestSlip.tsx ─────────────────────────────────────────────

test('PIN (L): PrintHostTestSlip.tsx contains APP_NAME and does NOT contain the string "Lucifer" (case-insensitive) — generic product rule, never a hardcoded cafe name', () => {
  const src = readSrc(PRINT_HOST_TEST_SLIP);
  assert.match(src, /APP_NAME/, "positive landmark: PrintHostTestSlip.tsx must reference APP_NAME");
  assert.ok(!/lucifer/i.test(src), 'PrintHostTestSlip.tsx must never contain the string "Lucifer" (case-insensitive), not even in a comment');
});

// ── M. use-self-order-auto-print.ts amendments (MERGED-05/F14, §B6) ──────

test("PIN (M): use-self-order-auto-print.ts's register effect is gated — if (!enabled) return; appears BEFORE return registerKotPrintHandler(; BOTH call sites acquire the lock (claimLock.current = true; and claimLock.current = false; each count 2); the opt-in gate is the PH-11 block if (!isHostLane) { const prefs = readDevicePrefs(); if (!prefs.autoPrintSelfOrders || prefs.printHost) return; } and the old one-line gate is GONE; autoPrintCandidate( is followed by maxAgeMs, in the same call; claimAndPrint's deps stay [claimMutate, queueKotRound]; exports SelfOrderHostLane", () => {
  const src = readSrc(USE_SELF_ORDER_AUTO_PRINT);

  const enabledGateAt = src.indexOf("if (!enabled) return;");
  const registerAt = src.indexOf("return registerKotPrintHandler(");
  assert.ok(enabledGateAt >= 0 && registerAt >= 0, "positive landmark: both markers must be present");
  assert.ok(enabledGateAt < registerAt, `expected if (!enabled) return;(${enabledGateAt}) BEFORE return registerKotPrintHandler((${registerAt})`);

  const lockTrueCount = countOccurrences(src, "claimLock.current = true;");
  const lockFalseCount = countOccurrences(src, "claimLock.current = false;");
  assert.equal(lockTrueCount, 2, `expected claimLock.current = true; exactly twice (both call sites), found ${lockTrueCount}`);
  assert.equal(lockFalseCount, 2, `expected claimLock.current = false; exactly twice (both call sites), found ${lockFalseCount}`);

  // PH-11 gate (review L1-01/L4-02/L4-03, arbiter-confirmed against the code):
  // the A-13 "disabled toggle" mitigation cannot cover an `autoPrintSelfOrders`
  // that was already ON before designation, so a page lane on the host PC's
  // own /pos or /requests screen raced the host lane every tick. The page
  // lane now yields structurally on a host device — the host lane reads no
  // pref at all (A-13 stays). Positive landmark (the block) + negative (the
  // old one-liner is gone), per repo memory negative-source-pins-need-vision-guards.
  assert.match(
    src,
    /if \(!isHostLane\) \{\s*const prefs = readDevicePrefs\(\);\s*if \(!prefs\.autoPrintSelfOrders \|\| prefs\.printHost\) return;\s*\}/,
    "the opt-in gate must be the block: if (!isHostLane) { const prefs = readDevicePrefs(); if (!prefs.autoPrintSelfOrders || prefs.printHost) return; }",
  );
  assert.doesNotMatch(
    src,
    /if \(!isHostLane && !readDevicePrefs\(\)\.autoPrintSelfOrders\) return;/,
    "the pre-PH-11 one-line gate (pref only, host-blind) must be gone",
  );

  const candidateAt = src.indexOf("autoPrintCandidate(");
  assert.ok(candidateAt >= 0, "positive landmark: autoPrintCandidate( must be called");
  const afterCandidate = src.slice(candidateAt, candidateAt + 200);
  assert.ok(afterCandidate.includes("maxAgeMs,"), "autoPrintCandidate( must be followed by maxAgeMs, within the same call");

  assert.match(src, /\[claimMutate,\s*queueKotRound\]/, "claimAndPrint's deps must stay exactly [claimMutate, queueKotRound]");
  assert.match(src, /export interface SelfOrderHostLane/, "must export SelfOrderHostLane");
});

// ── N. use-host-routing.ts (OPS-7) ────────────────────────────────────────

test("PIN (N): use-host-routing.ts calls invalidateQueries({ queryKey: POS_PULSE_KEYS.all }) gated by readDevicePrefs().printHost in the same block; imports POS_PULSE_KEYS from @/hooks/use-pos-pulse and useQueryClient from @tanstack/react-query; still does NOT contain usePosPulseContext or useQuery(; still <= 300 lines", () => {
  const src = readSrc(USE_HOST_ROUTING);

  assert.match(
    src,
    /if \(result\.outcome === "queued" && readDevicePrefs\(\)\.printHost\) \{\s*void qc\.invalidateQueries\(\{ queryKey: POS_PULSE_KEYS\.all \}\);/,
    "invalidateQueries({ queryKey: POS_PULSE_KEYS.all }) must be gated by readDevicePrefs().printHost in the same if-block (OPS-7)",
  );
  assert.match(
    src,
    /import\s*\{\s*POS_PULSE_KEYS\s*\}\s*from\s*"@\/hooks\/use-pos-pulse"/,
    "must import { POS_PULSE_KEYS } from \"@/hooks/use-pos-pulse\"",
  );
  assert.match(
    src,
    /import\s*\{\s*useQueryClient\s*\}\s*from\s*"@tanstack\/react-query"/,
    "must import { useQueryClient } from \"@tanstack/react-query\"",
  );

  // positive landmark before the negative checks.
  assert.match(src, /usePrintHostRouting\(/, "positive landmark: usePrintHostRouting( must still be called");
  assert.ok(!src.includes("usePosPulseContext"), "use-host-routing.ts must never reference usePosPulseContext");
  assert.ok(!src.includes("useQuery("), "use-host-routing.ts must never call useQuery( — it is not its own TanStack observer");

  const lineCount = src.replace(/\n$/, "").split("\n").length;
  assert.ok(lineCount <= 300, `use-host-routing.ts must stay <= 300 lines, got ${lineCount}`);
});

// ── O. useReactToPrint wiring inventory ──────────────────────────────────
// memory slice-specs-satisfied-feature-still-dead: a slice can wire a hook
// with zero call sites. Concatenate the needle so this test's OWN text can
// never trip its own grep.

test("INVENTORY: files containing the needle useReactToPrint( under app/components/hooks are exactly the six known call sites, with the per-file counts print-host-bridge=3, kot-print-bridge=2, OrderDetailSheet=2, and 1 each elsewhere", () => {
  const NEEDLE = "useReactToPrint" + "(";
  const roots = ["app", "components", "hooks"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const hits: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      const text = readFileSync(full, "utf8");
      if (text.includes(NEEDLE)) {
        hits.push(path.relative(path.join(REPO_ROOT, "apps/cafe"), full).split(path.sep).join("/"));
      }
    }
  }
  for (const root of roots) walk(root);
  hits.sort();

  // Verified against the tree via grep before writing this pin (per the task
  // spec) — this is the actual tree contents, not an assumption.
  const expected = [
    "app/(dashboard)/tables/qr/page.tsx",
    "components/orders/MoveTableDialog.tsx",
    "components/orders/OrderDetailSheet.tsx",
    "components/reports/EndOfDayButton.tsx",
    "hooks/use-kot-print-bridge.ts",
    "hooks/use-print-host-bridge.ts",
  ].sort();

  assert.deepEqual(hits, expected, `useReactToPrint( call sites must be exactly the six known files; found: ${hits.join(", ")}`);

  const expectedCounts: Record<string, number> = {
    "hooks/use-print-host-bridge.ts": 3,
    "hooks/use-kot-print-bridge.ts": 2,
    "components/orders/OrderDetailSheet.tsx": 2,
    "app/(dashboard)/tables/qr/page.tsx": 1,
    "components/orders/MoveTableDialog.tsx": 1,
    "components/reports/EndOfDayButton.tsx": 1,
  };
  for (const [rel, expectedCount] of Object.entries(expectedCounts)) {
    const text = readFileSync(path.join(REPO_ROOT, "apps/cafe", rel), "utf8");
    const actualCount = countOccurrences(text, NEEDLE);
    assert.equal(actualCount, expectedCount, `expected ${NEEDLE} exactly ${expectedCount} times in ${rel}, found ${actualCount}`);
  }
});

// ── P. Line budgets ───────────────────────────────────────────────────────

// Budget raised 200 -> 250 for use-print-host-bridge.ts (2026-09-11): the
// surfacesMounted guard, watchdogRef and its arm/clear, and the empty-slip
// check grew the dispatch effect past 200 lines (measured 233; smallest
// round number >= 233 + 15). PrintHostProvider.tsx (192) and
// PrintHostPrintSources.tsx (95) still fit their existing budgets unchanged.
test("PIN (P): line budgets — PrintHostProvider.tsx <= 200, use-print-host-bridge.ts <= 250, use-print-host-drain.ts <= 150, use-print-host-beat.ts <= 80, PrintHostPrintSources.tsx <= 100, PrintHostEodSource.tsx <= 90, PosPulseProvider.tsx <= 300, use-self-order-auto-print.ts <= 300", () => {
  const budgets: [string, number][] = [
    [PRINT_HOST_PROVIDER, 200],
    [USE_PRINT_HOST_BRIDGE, 250],
    [USE_PRINT_HOST_DRAIN, 150],
    [USE_PRINT_HOST_BEAT, 80],
    [PRINT_HOST_PRINT_SOURCES, 100],
    [PRINT_HOST_EOD_SOURCE, 90],
    [POS_PULSE_PROVIDER, 300],
    [USE_SELF_ORDER_AUTO_PRINT, 300],
  ];
  for (const [file, budget] of budgets) {
    const src = readSrc(file);
    const lineCount = src.replace(/\n$/, "").split("\n").length;
    assert.ok(lineCount <= budget, `${file} must stay <= ${budget} lines, got ${lineCount}`);
    assert.ok(budget <= 300, `${file}'s budget ${budget} must stay <= 300 (the file-size invariant)`);
  }
});

// ── Q. lib/pos-device-id.ts ────────────────────────────────────────────────

test('PIN (Q): lib/pos-device-id.ts exports mintTabId and still contains "pos.device-id.v1"; mintTabId reuses mintDeviceId() (const minted = mintDeviceId(); inside the function body); never Math.random anywhere', () => {
  const src = readSrc(POS_DEVICE_ID);

  assert.match(src, /export function mintTabId\(\)/, "must export function mintTabId()");
  assert.ok(src.includes('"pos.device-id.v1"'), 'must still contain "pos.device-id.v1"');

  const mintTabIdBody = src.slice(src.indexOf("export function mintTabId"), src.indexOf("export function readDeviceId"));
  assert.ok(mintTabIdBody.includes("const minted = mintDeviceId();"), "mintTabId must reuse mintDeviceId() via const minted = mintDeviceId();");

  // positive landmark before the negative check.
  assert.match(src, /crypto\.getRandomValues/, "positive landmark: crypto.getRandomValues must be the real entropy fallback");
  assert.ok(!src.includes("Math.random"), "lib/pos-device-id.ts must never contain Math.random anywhere, not even in a comment — two tablets booted together would collide");
});
