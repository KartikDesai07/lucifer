// Print-host plan (.claude/plan/v2/print-host-plan.md §B7, slice PH-8) — RAW
// source-text pins over the band-readback tree: RequestAlertBar's wiring of
// PrintHostBandSection + printBandVisible, the band section's host-only
// stale-row gate + single readDeviceId() effect read (F8), the stale rows'
// prop-driven no-hook shape, use-host-routing.ts's A-17 readback recording +
// enqueuePending surface, PosPulseProvider's two new readback contexts +
// provider nesting, PrintHostProvider's printQueuedJob claim/queue/demote
// contract, the three PH-6 buttons' enqueuePending gate, reachability
// (exactly one call site each outside the owning module), and hygiene
// (no console., no cafe name). Same readSrc + REPO_ROOT + stripComments idiom
// as lib/print-host-card-paths.test.ts. Every negative pin below is paired
// with a positive landmark assert in the SAME test, per testing.md's
// vision-guard rule; grep-gate needles are built by concatenation so this
// file never carries the literal it bans.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const REQUEST_ALERT_BAR = "apps/cafe/components/orders/RequestAlertBar.tsx";
const BAND_SECTION = "apps/cafe/components/orders/PrintHostBandSection.tsx";
const STALE_ROWS = "apps/cafe/components/orders/PrintHostStaleRows.tsx";
const USE_HOST_ROUTING = "apps/cafe/hooks/use-host-routing.ts";
const POS_PULSE_PROVIDER = "apps/cafe/components/layout/PosPulseProvider.tsx";
const PRINT_HOST_PROVIDER = "apps/cafe/components/layout/PrintHostProvider.tsx";
const ORDER_DETAIL_SHEET = "apps/cafe/components/orders/OrderDetailSheet.tsx";
const END_OF_DAY_BUTTON = "apps/cafe/components/reports/EndOfDayButton.tsx";
const PRINT_READBACK_LIB = "apps/cafe/lib/print-readback.ts";

// ── (1) RequestAlertBar.tsx ─────────────────────────────────────────────────

test("PIN (1): RequestAlertBar.tsx imports usePosPulseContext + usePrintReadback from PosPulseProvider, imports PrintHostBandSection, calls printBandVisible(pulse, readback) inside `const visible =`, renders <PrintHostBandSection pulse={pulse} readback={readback} /> AFTER ref={bandRef} and BEFORE the closing return </div>, and still contains if (!visible) return null; and its <= 150-line budget", () => {
  const src = readSrc(REQUEST_ALERT_BAR);

  assert.match(
    src,
    /import\s*\{\s*usePosPulseContext,\s*usePrintReadback\s*\}\s*from\s*"@\/components\/layout\/PosPulseProvider"/,
    "must import { usePosPulseContext, usePrintReadback } from @/components/layout/PosPulseProvider",
  );
  assert.match(
    src,
    /import\s*\{\s*PrintHostBandSection\s*\}\s*from\s*"@\/components\/orders\/PrintHostBandSection"/,
    "must import { PrintHostBandSection } from @/components/orders/PrintHostBandSection",
  );

  const visibleLineMatch = src.match(/const visible = ([^\n]+);/);
  assert.ok(visibleLineMatch, "positive landmark: a `const visible = ...;` line must exist");
  const visibleLine = visibleLineMatch![1];
  // CB-UI2 (owner 2026-09-23): the line may now be PREFIXED by the POS
  // route-suppression gate (`!alertBarSuppressedForPath(pathname) && (…)`) —
  // that gate only ever REMOVES the band, and living inside `visible` is what
  // also drops the published height. The three positive triggers must still
  // all be present and OR'd, so the band can never stop showing real work.
  assert.ok(
    /openCount > 0 \|\| unprinted\.length > 0 \|\|/.test(visibleLine),
    `the visible line must still OR together "openCount > 0 || unprinted.length > 0 ||", got: ${visibleLine}`,
  );
  assert.match(visibleLine, /printBandVisible\(pulse, readback\)/, "the visible line must call printBandVisible(pulse, readback)");

  const bandRefAt = src.indexOf("ref={bandRef}");
  const sectionAt = src.indexOf("<PrintHostBandSection pulse={pulse} readback={readback} />");
  assert.ok(bandRefAt >= 0, "positive landmark: ref={bandRef} must be present");
  assert.ok(sectionAt >= 0, "must render <PrintHostBandSection pulse={pulse} readback={readback} />");
  assert.ok(bandRefAt < sectionAt, `expected ref={bandRef}(${bandRefAt}) BEFORE <PrintHostBandSection ...>(${sectionAt})`);

  const lastDivCloseAt = src.lastIndexOf("</div>");
  assert.ok(lastDivCloseAt >= 0, "positive landmark: the file must close with a </div>");
  assert.ok(sectionAt < lastDivCloseAt, `expected <PrintHostBandSection ...>(${sectionAt}) BEFORE the final closing </div>(${lastDivCloseAt})`);

  assert.match(src, /if \(!visible\) return null;/, "must still contain if (!visible) return null;");

  const lineCount = src.replace(/\n$/, "").split("\n").length;
  assert.ok(lineCount <= 150, `RequestAlertBar.tsx must stay <= 150 lines, got ${lineCount}`);
});

// ── (2) PrintHostBandSection.tsx + PrintHostStaleRows.tsx ──────────────────

test("PIN (2a): PrintHostBandSection.tsx does NOT contain readDeviceId( (deviceId now comes from usePrintHostContext()); positive landmark: the exact destructure line; isHost line is exact; PrintHostStaleRows renders only under `isHost &&`; imports useDismissPrintJob; calls printQueuedJob( and dismissMutate(; <= 120 lines", () => {
  const src = readSrc(BAND_SECTION);

  const readDeviceIdNeedle = "readDeviceId" + "(";
  assert.ok(
    !src.includes(readDeviceIdNeedle),
    "PrintHostBandSection.tsx must NOT contain readDeviceId( — the device id is provided by usePrintHostContext(), not a storage read of its own",
  );
  assert.match(
    src,
    /const \{ isHostDevice, deviceId, printQueuedJob \} = usePrintHostContext\(\);/,
    "positive landmark: must declare const { isHostDevice, deviceId, printQueuedJob } = usePrintHostContext();",
  );

  assert.match(
    src,
    /const isHost = isHostDevice && deviceId !== "" && host\?\.deviceId === deviceId;/,
    'the isHost line must be exactly: const isHost = isHostDevice && deviceId !== "" && host?.deviceId === deviceId;',
  );

  const gateAt = src.indexOf("shown.length > 0 && isHost && (");
  const staleRowsAt = src.indexOf("<PrintHostStaleRows");
  assert.ok(gateAt >= 0, "positive landmark: `shown.length > 0 && isHost && (` must be present");
  assert.ok(staleRowsAt >= 0, "positive landmark: <PrintHostStaleRows must be rendered");
  assert.ok(gateAt < staleRowsAt, `expected shown.length > 0 && isHost && ((${gateAt}) BEFORE <PrintHostStaleRows(${staleRowsAt})`);

  assert.match(
    src,
    /import\s*\{\s*useDismissPrintJob\s*\}\s*from\s*"@\/hooks\/use-print-host"/,
    "must import { useDismissPrintJob } from @/hooks/use-print-host",
  );
  assert.match(src, /printQueuedJob\(/, "positive landmark: must call printQueuedJob(");
  assert.match(src, /dismissMutate\(/, "positive landmark: must call dismissMutate(");

  const lineCount = src.replace(/\n$/, "").split("\n").length;
  assert.ok(lineCount <= 120, `PrintHostBandSection.tsx must stay <= 120 lines, got ${lineCount}`);
});

test('PIN (2b): PrintHostStaleRows.tsx contains NO hook calls (stripComments-guarded — "useMutation" in a comment must not trip it), disabled={tappedIds.has(row.id)} exactly twice, a Dismiss and a Print button, the "/orders" link; <= 80 lines', () => {
  const raw = readSrc(STALE_ROWS);
  const stripped = stripComments(raw);

  const hookCallMatches = stripped.match(/\buse[A-Z]\w*\(/g) ?? [];
  assert.deepEqual(hookCallMatches, [], `PrintHostStaleRows.tsx must contain NO hook calls in real code, found: ${hookCallMatches.join(", ")}`);
  // positive landmark: stripComments must actually have stripped real comment
  // text (proving the scan isn't reading an empty/blinded file) — the raw
  // file's header comment is longer than the stripped code by a wide margin.
  assert.ok(raw.length > stripped.length + 200, "positive landmark: stripComments must have removed a substantial header comment, proving this is a real, non-blinded scan");
  assert.match(raw, /PrintHostBandSection\.tsx for its 120-line budget/, 'positive landmark: the raw file must still carry its own header comment mentioning "PrintHostBandSection.tsx for its 120-line budget"');

  const disabledCount = countOccurrences(raw, 'disabled={tappedIds.has(row.id)}');
  assert.equal(disabledCount, 2, `expected disabled={tappedIds.has(row.id)} exactly twice, found ${disabledCount}`);

  assert.match(raw, />\s*Print\s*<\/Button>/, "must render a Print button");
  assert.match(raw, />\s*Dismiss\s*<\/Button>/, "must render a Dismiss button");
  assert.match(raw, /"\/orders"/, 'must contain the "/orders" link path');

  const lineCount = raw.replace(/\n$/, "").split("\n").length;
  assert.ok(lineCount <= 80, `PrintHostStaleRows.tsx must stay <= 80 lines, got ${lineCount}`);
});

// ── (3) use-host-routing.ts ─────────────────────────────────────────────────

test("PIN (3): use-host-routing.ts's enqueuePending is isPending || routedInFlight > 0; routedInFlight is armed (+1) BEFORE the chain append and released (-1) inside a finally within the chain; records printReadbackRecordOf on queued/already-resolved; imports usePrintReadbackRecorder + printReadbackRecordOf; keeps the OPS-7 landmark; <= 300 lines; PrintRoutingHost declares enqueuePending: boolean;", () => {
  const src = readSrc(USE_HOST_ROUTING);

  assert.match(
    src,
    /const \{ mutateAsync: enqueueAsync, isPending \} = useEnqueuePrintJob\(\);/,
    "must declare const { mutateAsync: enqueueAsync, isPending } = useEnqueuePrintJob();",
  );
  assert.match(
    src,
    /const \[routedInFlight, setRoutedInFlight\] = useState\(0\);/,
    "must declare const [routedInFlight, setRoutedInFlight] = useState(0);",
  );
  assert.match(
    src,
    /const enqueuePending = isPending \|\| routedInFlight > 0;/,
    "must declare const enqueuePending = isPending || routedInFlight > 0;",
  );
  assert.match(src, /\benqueuePending,/, "the returned object must include enqueuePending,");

  const armAt = src.indexOf("setRoutedInFlight((count) => count + 1);");
  const chainAppendAt = src.indexOf("routedChainRef.current = routedChainRef.current");
  assert.ok(armAt >= 0, "positive landmark: setRoutedInFlight((count) => count + 1); must be present");
  assert.ok(chainAppendAt >= 0, "positive landmark: the routedChainRef.current = routedChainRef.current append must be present");
  assert.ok(
    armAt < chainAppendAt,
    `expected setRoutedInFlight((count) => count + 1);(${armAt}) BEFORE routedChainRef.current = routedChainRef.current(${chainAppendAt})`,
  );

  const releaseAt = src.indexOf("setRoutedInFlight((count) => count - 1);");
  assert.ok(releaseAt >= 0, "positive landmark: setRoutedInFlight((count) => count - 1); must be present");
  assert.ok(releaseAt > chainAppendAt, "the release must be INSIDE the chain (after the chain append)");
  const finallyBeforeRelease = src.lastIndexOf("finally", releaseAt);
  assert.ok(
    finallyBeforeRelease >= 0 && finallyBeforeRelease > chainAppendAt && finallyBeforeRelease < releaseAt,
    "setRoutedInFlight((count) => count - 1); must be reached inside a `} finally {` block within the chain step",
  );

  const outcomeAt = src.indexOf('result.outcome === "queued" || result.outcome === "already-resolved"');
  assert.ok(outcomeAt >= 0, 'positive landmark: result.outcome === "queued" || result.outcome === "already-resolved" must be present');
  const blockAfter = src.slice(outcomeAt, outcomeAt + 400);
  assert.match(
    blockAfter,
    /recordReadback\(printReadbackRecordOf\(result\.id, job\.payload\)\)/,
    "recordReadback(printReadbackRecordOf(result.id, job.payload)) must follow the queued/already-resolved check within the same block",
  );

  assert.match(
    src,
    /import\s*\{[^}]*\busePrintReadbackRecorder\b[^}]*\}\s*from\s*"@\/components\/layout\/PosPulseProvider"/,
    "must import usePrintReadbackRecorder from @/components/layout/PosPulseProvider",
  );
  assert.match(
    src,
    /import\s*\{\s*printReadbackRecordOf\s*\}\s*from\s*"@\/lib\/print-readback"/,
    "must import { printReadbackRecordOf } from @/lib/print-readback",
  );

  assert.match(
    src,
    /if \(result\.outcome === "queued" && readDevicePrefs\(\)\.printHost\) \{/,
    "positive landmark: the OPS-7 block must still be present",
  );

  const lineCount = src.replace(/\n$/, "").split("\n").length;
  assert.ok(lineCount <= 300, `use-host-routing.ts must stay <= 300 lines, got ${lineCount}`);

  assert.match(src, /enqueuePending: boolean;/, "the PrintRoutingHost interface must declare enqueuePending: boolean;");
});

// ── (4) PosPulseProvider.tsx ────────────────────────────────────────────────

test("PIN (4): PosPulseProvider.tsx declares the two readback contexts, exports the two hooks with throw fences, recordPrintJob is []-stable, the prune effect is keyed [data], provider nesting order, no useMemo, <= 300 lines", () => {
  const src = readSrc(POS_PULSE_PROVIDER);

  assert.match(src, /const PrintReadbackRecordContext = createContext</, "must declare PrintReadbackRecordContext via createContext");
  assert.match(src, /const PrintReadbackContext = createContext</, "must declare PrintReadbackContext via createContext");

  assert.match(
    src,
    /export function usePrintReadbackRecorder\(\)/,
    "must export function usePrintReadbackRecorder()",
  );
  assert.match(
    src,
    /throw new Error\("usePrintReadbackRecorder must be used inside <PosPulseProvider>"\);/,
    "usePrintReadbackRecorder must throw its fence error",
  );
  assert.match(src, /export function usePrintReadback\(\)/, "must export function usePrintReadback()");
  assert.match(
    src,
    /throw new Error\("usePrintReadback must be used inside <PosPulseProvider>"\);/,
    "usePrintReadback must throw its fence error",
  );

  assert.match(
    src,
    /const recordPrintJob = useCallback\(\(record: PrintReadbackRecord\) => \{\s*\n\s*setReadback\(\(current\) => recordPrintReadback\(current, record, Date\.now\(\)\)\);\s*\n\s*\}, \[\]\);/,
    "recordPrintJob must be a useCallback closing with }, []); — the recorder is []-stable",
  );

  const pruneEffectAt = src.indexOf("prunePrintReadback(current, data, Date.now())");
  assert.ok(pruneEffectAt >= 0, "positive landmark: the prune effect must call prunePrintReadback(current, data, Date.now())");
  const afterPrune = src.slice(pruneEffectAt, pruneEffectAt + 200);
  assert.match(afterPrune, /\}, \[data\]\);/, "the prune effect must be keyed }, [data]);");

  // Provider nesting order by index — outer to inner.
  const order = [
    "PrintHostRoutingContext.Provider",
    "PrintJobFeedContext.Provider",
    "PrintReadbackRecordContext.Provider",
    "PrintReadbackContext.Provider",
    "PosPulseContext.Provider",
  ];
  const indices = order.map((marker) => src.indexOf(`<${marker}`));
  for (const [i, idx] of indices.entries()) {
    assert.ok(idx >= 0, `positive landmark: <${order[i]} must be present`);
  }
  for (let i = 1; i < indices.length; i++) {
    assert.ok(
      indices[i - 1] < indices[i],
      `expected nesting order ${order[i - 1]}(${indices[i - 1]}) BEFORE ${order[i]}(${indices[i]})`,
    );
  }

  assert.ok(!src.includes("useMemo"), "PosPulseProvider.tsx must contain NO useMemo");
  assert.match(src, /usePosPulse\(\)/, "positive landmark: PosPulseProvider.tsx must still call usePosPulse()");

  const lineCount = src.replace(/\n$/, "").split("\n").length;
  assert.ok(lineCount <= 300, `PosPulseProvider.tsx must stay <= 300 lines, got ${lineCount}`);
});

// ── (5) PrintHostProvider.tsx ────────────────────────────────────────────────

test("PIN (5): PrintHostProvider.tsx's interface gained deviceId: string; printQueuedJob's outer try/finally + inner try/catch around claimAsync, not-host demote+return, post-claim toast on a queueSlip throw, the finally invalidates the pulse; imports; useMemo inclusion; <= 200 lines", () => {
  const src = readSrc(PRINT_HOST_PROVIDER);

  assert.match(src, /printQueuedJob: \(id: string\) => Promise<void>;/, "the interface must declare printQueuedJob: (id: string) => Promise<void>;");
  assert.match(src, /deviceId: string;/, "positive landmark: the interface must declare deviceId: string;");

  const claimTrueAt = src.indexOf("claimLockRef.current = true;");
  const claimAsyncAt = src.indexOf("await claimAsync({ id, deviceId, tabId })");
  const claimFalseAt = src.indexOf("claimLockRef.current = false;");
  assert.ok(claimTrueAt >= 0 && claimAsyncAt >= 0 && claimFalseAt >= 0, "positive landmark: all three claim-lock markers must be present");
  assert.ok(
    claimTrueAt < claimAsyncAt && claimAsyncAt < claimFalseAt,
    `expected order claimLockRef.current = true;(${claimTrueAt}) < await claimAsync(...)(${claimAsyncAt}) < claimLockRef.current = false;(${claimFalseAt})`,
  );
  const finallyAt = src.lastIndexOf("finally", claimFalseAt + 50);
  assert.ok(finallyAt >= 0 && finallyAt < claimFalseAt, "claimLockRef.current = false; must be reached inside a finally block (the outer try/finally)");

  // The invalidate must be inside the SAME outer finally as the lock release.
  const invalidateAt = src.indexOf("void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });");
  assert.ok(invalidateAt >= 0, "positive landmark: void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all }); must be present");
  assert.ok(invalidateAt > claimFalseAt, "the invalidate must follow claimLockRef.current = false; inside the same finally");

  // Inner try/catch around the claim itself: not-host -> demote() + return.
  assert.match(
    src,
    /if \(!result\.claimed\) \{[\s\S]*?if \(result\.reason === "not-host"\) demote\(\);[\s\S]*?return;[\s\S]*?\}/,
    'must contain if (!result.claimed) { ... if (result.reason === "not-host") demote(); ... return; }',
  );

  // Post-claim: a queueSlip throw must be caught and toasted, not swallowed
  // by the claim's own catch (a burned claim with no paper must be said aloud).
  assert.match(
    src,
    /queueSlip\(hostPrintSlipOf\(result\.job\.payload, cafeDateString\(\)\)\)/,
    "must call queueSlip(hostPrintSlipOf(result.job.payload, cafeDateString()))",
  );
  const queueSlipAt = src.indexOf("queueSlip(hostPrintSlipOf(result.job.payload, cafeDateString()))");
  const toastAt = src.indexOf("toast.error(PRINT_HOST_PRINT_FAILED_MESSAGE);");
  assert.ok(toastAt >= 0, "positive landmark: toast.error(PRINT_HOST_PRINT_FAILED_MESSAGE); must be present");
  assert.ok(toastAt > queueSlipAt, "the post-claim toast must follow the queueSlip( call — it is the queueSlip throw's own catch");

  assert.match(src, /if \(deviceId === ""\) return;/, 'must contain if (deviceId === "") return;');

  assert.match(
    src,
    /import\s*\{\s*PRINT_HOST_PRINT_FAILED_MESSAGE,\s*hostPrintSlipOf\s*\}\s*from\s*"@\/lib\/print-host-slips"/,
    'must import { PRINT_HOST_PRINT_FAILED_MESSAGE, hostPrintSlipOf } from "@/lib/print-host-slips"',
  );
  assert.match(
    src,
    /import\s*\{\s*useClaimPrintJob\s*\}\s*from\s*"@\/hooks\/use-print-host"/,
    "must import { useClaimPrintJob } from @/hooks/use-print-host",
  );
  assert.match(
    src,
    /import\s*\{\s*useQueryClient\s*\}\s*from\s*"@tanstack\/react-query"/,
    'must import { useQueryClient } from "@tanstack/react-query"',
  );
  assert.match(src, /import\s*\{\s*toast\s*\}\s*from\s*"sonner"/, 'must import { toast } from "sonner"');
  assert.match(
    src,
    /import\s*\{\s*POS_PULSE_KEYS\s*\}\s*from\s*"@\/hooks\/use-pos-pulse"/,
    'must import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse"',
  );

  assert.match(src, /useMemo<PrintHostContextValue>/, "positive landmark: the context value must be built via useMemo<PrintHostContextValue>");
  assert.ok(
    /useMemo<PrintHostContextValue>\(\s*\(\) => \(\{[^}]*\bdeviceId\b[^}]*\}\)/.test(src),
    "deviceId must appear in the useMemo value object",
  );
  assert.ok(
    /useMemo<PrintHostContextValue>\(\s*\(\) => \(\{[^}]*\bprintQueuedJob\b[^}]*\}\)/.test(src),
    "printQueuedJob must appear in the useMemo value object",
  );

  const lineCount = src.replace(/\n$/, "").split("\n").length;
  assert.ok(lineCount <= 200, `PrintHostProvider.tsx must stay <= 200 lines, got ${lineCount}`);
});

// ── (6) The three PH-6 buttons ───────────────────────────────────────────────

test("PIN (6): OrderDetailSheet.tsx and EndOfDayButton.tsx destructure { routePrint, enqueuePending } and gate their print buttons on enqueuePending; EndOfDayButton must NOT carry the bare old disabled={!ready} form", () => {
  const sheetSrc = readSrc(ORDER_DETAIL_SHEET);
  assert.match(
    sheetSrc,
    /const \{ routePrint, enqueuePending \} = useHostRouting\(\);/,
    "OrderDetailSheet.tsx must declare const { routePrint, enqueuePending } = useHostRouting();",
  );
  assert.match(
    sheetSrc,
    /onClick=\{printBill\} disabled=\{enqueuePending\}/,
    "OrderDetailSheet.tsx must render onClick={printBill} disabled={enqueuePending}",
  );
  assert.match(
    sheetSrc,
    /onClick=\{printKitchenSlip\} disabled=\{enqueuePending\}/,
    "OrderDetailSheet.tsx must render onClick={printKitchenSlip} disabled={enqueuePending}",
  );

  const eodSrc = readSrc(END_OF_DAY_BUTTON);
  assert.match(
    eodSrc,
    /const \{ routePrint, enqueuePending \} = useHostRouting\(\);/,
    "EndOfDayButton.tsx must declare const { routePrint, enqueuePending } = useHostRouting();",
  );
  assert.match(
    eodSrc,
    /disabled=\{!ready \|\| enqueuePending\}/,
    "EndOfDayButton.tsx must render disabled={!ready || enqueuePending}",
  );
  assert.ok(
    !eodSrc.includes("disabled={!ready}\n"),
    "EndOfDayButton.tsx must NOT contain the bare old disabled={!ready}\\n form — the enqueuePending gate must not have been dropped on a later edit",
  );
});

// ── (7) Reachability ─────────────────────────────────────────────────────────

function walkFiles(root: string, onFile: (full: string) => void): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, onFile);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    onFile(full);
  }
}

function relCafe(full: string): string {
  return path.relative(path.join(REPO_ROOT, "apps/cafe"), full).split(path.sep).join("/");
}

test("INVENTORY (7a): PrintHostBandSection is imported (by an actual import statement, not a comment mention) by exactly one non-test file under apps/cafe — RequestAlertBar.tsx", () => {
  const roots = ["app", "components", "hooks"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const hits: string[] = [];
  const IMPORT_RE = /from\s*"@\/components\/orders\/PrintHostBandSection"/;
  for (const root of roots) {
    walkFiles(root, (full) => {
      if (relCafe(full) === "components/orders/PrintHostBandSection.tsx") return; // the module's own file
      const text = readFileSync(full, "utf8");
      if (IMPORT_RE.test(text)) hits.push(relCafe(full));
    });
  }
  hits.sort();
  assert.deepEqual(hits, ["components/orders/RequestAlertBar.tsx"], `PrintHostBandSection must be imported by exactly RequestAlertBar.tsx; found: ${hits.join(", ")}`);
});

test("INVENTORY (7b): printQueuedJob( has exactly one call site outside PrintHostProvider.tsx — PrintHostBandSection.tsx", () => {
  const roots = ["app", "components", "hooks"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const NEEDLE = "printQueuedJob" + "(";
  const hits: string[] = [];
  for (const root of roots) {
    walkFiles(root, (full) => {
      const rel = relCafe(full);
      if (rel === "components/layout/PrintHostProvider.tsx") return;
      const text = readFileSync(full, "utf8");
      if (text.includes(NEEDLE)) hits.push(rel);
    });
  }
  hits.sort();
  assert.deepEqual(hits, ["components/orders/PrintHostBandSection.tsx"], `printQueuedJob( must have exactly one call site outside PrintHostProvider.tsx; found: ${hits.join(", ")}`);
});

test("INVENTORY (7c): usePrintReadbackRecorder( has exactly one call site outside PosPulseProvider.tsx — use-host-routing.ts", () => {
  const roots = ["app", "components", "hooks"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const NEEDLE = "usePrintReadbackRecorder" + "(";
  const hits: string[] = [];
  for (const root of roots) {
    walkFiles(root, (full) => {
      const rel = relCafe(full);
      if (rel === "components/layout/PosPulseProvider.tsx") return;
      const text = readFileSync(full, "utf8");
      if (text.includes(NEEDLE)) hits.push(rel);
    });
  }
  hits.sort();
  assert.deepEqual(hits, ["hooks/use-host-routing.ts"], `usePrintReadbackRecorder( must have exactly one call site outside PosPulseProvider.tsx; found: ${hits.join(", ")}`);
});

test('INVENTORY (7d): usePrintReadback( (NOT followed by "Recorder") has exactly one call site outside PosPulseProvider.tsx — RequestAlertBar.tsx', () => {
  const roots = ["app", "components", "hooks"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const hits: string[] = [];
  for (const root of roots) {
    walkFiles(root, (full) => {
      const rel = relCafe(full);
      if (rel === "components/layout/PosPulseProvider.tsx") return;
      const text = readFileSync(full, "utf8");
      // A call site is "usePrintReadback(" where the identifier itself is
      // exactly usePrintReadback, not usePrintReadbackRecorder — guard by
      // checking the character right before "(" run is not part of "Recorder".
      const matches = text.match(/usePrintReadback(?:Recorder)?\(/g) ?? [];
      const bareHits = matches.filter((m) => m === "usePrintReadback(");
      if (bareHits.length > 0) hits.push(rel);
    });
  }
  hits.sort();
  assert.deepEqual(hits, ["components/orders/RequestAlertBar.tsx"], `usePrintReadback( (bare) must have exactly one call site outside PosPulseProvider.tsx; found: ${hits.join(", ")}`);
});

// ── (8) Hygiene ────────────────────────────────────────────────────────────

test("PIN (8): print-readback.ts, PrintHostBandSection.tsx, PrintHostStaleRows.tsx contain no console. and no cafe name (case-insensitive)", () => {
  const consoleNeedle = "console" + ".";
  const luciferNeedle = "Luci" + "fer";
  for (const rel of [PRINT_READBACK_LIB, BAND_SECTION, STALE_ROWS]) {
    const raw = readSrc(rel);
    assert.ok(!raw.includes(consoleNeedle), `${rel} must NOT contain ${consoleNeedle} anywhere, not even in a comment`);
    assert.ok(!new RegExp(luciferNeedle, "i").test(raw), `${rel} must NOT contain "${luciferNeedle}" (case-insensitive), not even in a comment`);
  }
  // positive landmark: each file actually has real content, so the negative
  // scans above aren't vacuously passing on an empty/blinded read.
  assert.match(readSrc(PRINT_READBACK_LIB), /export function recordPrintReadback\(/, "positive landmark: print-readback.ts must still export recordPrintReadback(");
  assert.match(readSrc(BAND_SECTION), /export function PrintHostBandSection\(/, "positive landmark: PrintHostBandSection.tsx must still export PrintHostBandSection(");
  assert.match(readSrc(STALE_ROWS), /export function PrintHostStaleRows\(/, "positive landmark: PrintHostStaleRows.tsx must still export PrintHostStaleRows(");
});
