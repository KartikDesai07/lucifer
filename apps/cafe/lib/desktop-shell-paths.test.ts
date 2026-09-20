import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// CB-D1 Slice C2 (plan §3, C2) — source-text pins over the desktop-shell seam:
// the INVENTORY of the nine useReactToPrint(slipPrintOptions( call sites, the
// QR page's deliberate non-wrap, use-print-host-wake.ts's capability check,
// desktop-shell.ts's own capability-keyed-only raw bytes, and the PARITY pin
// against apps/desktop/src/preload.ts's real bridge surface. Same readSrc +
// REPO_ROOT idiom as print-host-paths.test.ts. Every negative pin below is
// paired with a positive landmark assert in the SAME test (testing.md's
// vision-guard rule) — raw source, no stripComments (a banned-string scan
// must read comments too).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const DESKTOP_SHELL = "apps/cafe/lib/desktop-shell.ts";
const DESKTOP_SHELL_DOCUMENT = "apps/cafe/lib/desktop-shell-document.ts";
const DESKTOP_SHELL_PRINTER = "apps/cafe/lib/desktop-shell-printer.ts";
const DESKTOP_PRINTER_PICKER = "apps/cafe/components/print/DesktopPrinterPicker.tsx";
const USE_PRINT_HOST_BRIDGE = "apps/cafe/hooks/use-print-host-bridge.ts";
const USE_KOT_PRINT_BRIDGE = "apps/cafe/hooks/use-kot-print-bridge.ts";
const ORDER_DETAIL_SHEET = "apps/cafe/components/orders/OrderDetailSheet.tsx";
const END_OF_DAY_BUTTON = "apps/cafe/components/reports/EndOfDayButton.tsx";
const MOVE_TABLE_DIALOG = "apps/cafe/components/orders/MoveTableDialog.tsx";
const QR_PAGE = "apps/cafe/app/(dashboard)/tables/qr/page.tsx";
const USE_PRINT_HOST_WAKE = "apps/cafe/hooks/use-print-host-wake.ts";
const DESKTOP_PRELOAD = "apps/desktop/src/preload.ts";

// The needle is built by concatenation (testing.md rule): a literal would
// match this test file's own source (it contains this exact string many
// times over, in prose and in code).
const WRAP_NEEDLE = "useReactToPrint" + "(" + "slipPrintOptions" + "(";

// ── A. INVENTORY: the five wrapped files, with their per-file counts ───────

test("INVENTORY: useReactToPrint(slipPrintOptions( appears with counts 3/2/2/1/1 across exactly the five known wrapped files, each importing slipPrintOptions from @/lib/desktop-shell", () => {
  const expectedCounts: Record<string, number> = {
    [USE_PRINT_HOST_BRIDGE]: 3,
    [USE_KOT_PRINT_BRIDGE]: 2,
    [ORDER_DETAIL_SHEET]: 2,
    [END_OF_DAY_BUTTON]: 1,
    [MOVE_TABLE_DIALOG]: 1,
  };

  for (const [rel, expectedCount] of Object.entries(expectedCounts)) {
    const src = readSrc(rel);
    const actualCount = countOccurrences(src, WRAP_NEEDLE);
    assert.equal(actualCount, expectedCount, `expected ${WRAP_NEEDLE} exactly ${expectedCount} times in ${rel}, found ${actualCount}`);
    assert.match(
      src,
      /import\s*\{\s*slipPrintOptions\s*\}\s*from\s*"@\/lib\/desktop-shell"/,
      `${rel} must import { slipPrintOptions } from "@/lib/desktop-shell"`,
    );
  }
});

test("INVENTORY WALK: files under app/components/hooks containing useReactToPrint(slipPrintOptions( are EXACTLY the five known wrapped files — no more, no fewer", () => {
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
      if (text.includes(WRAP_NEEDLE)) {
        hits.push(path.relative(path.join(REPO_ROOT, "apps/cafe"), full).split(path.sep).join("/"));
      }
    }
  }
  for (const root of roots) walk(root);
  hits.sort();

  const expected = [
    "components/orders/MoveTableDialog.tsx",
    "components/orders/OrderDetailSheet.tsx",
    "components/reports/EndOfDayButton.tsx",
    "hooks/use-kot-print-bridge.ts",
    "hooks/use-print-host-bridge.ts",
  ].sort();

  assert.deepEqual(hits, expected, `useReactToPrint(slipPrintOptions( call sites must be exactly the five known files; found: ${hits.join(", ")}`);
});

// ── B. The QR page is deliberately NOT wrapped ──────────────────────────────

test("tables/qr/page.tsx calls useReactToPrint( with QR_PRINT_STYLE and does NOT wrap through slipPrintOptions — the A4 sheet keeps the browser print dialog (plan §2 B.2)", () => {
  const src = readSrc(QR_PAGE);

  assert.ok(src.includes("useReactToPrint" + "("), "positive landmark: tables/qr/page.tsx must still call useReactToPrint(");
  assert.ok(src.includes("QR_PRINT_STYLE"), "positive landmark: tables/qr/page.tsx must still reference QR_PRINT_STYLE");
  assert.ok(!src.includes("slipPrintOptions"), "tables/qr/page.tsx must NOT contain slipPrintOptions anywhere — the QR sheet is deliberately unwrapped");
});

// ── C. use-print-host-wake.ts capability check ──────────────────────────────

test("use-print-host-wake.ts sets refetchIntervalInBackground: isDesktopShell() and imports it from @/lib/desktop-shell — landmark useQueryClient() still present", () => {
  const src = readSrc(USE_PRINT_HOST_WAKE);

  assert.match(src, /useQueryClient\(\)/, "positive landmark: the hook must still call useQueryClient()");
  assert.match(
    src,
    /refetchIntervalInBackground:\s*isDesktopShell\(\)/,
    "must set refetchIntervalInBackground: isDesktopShell()",
  );
  assert.match(
    src,
    /import\s*\{\s*isDesktopShell\s*\}\s*from\s*"@\/lib\/desktop-shell"/,
    "must import { isDesktopShell } from \"@/lib/desktop-shell\"",
  );
});

// ── D. desktop-shell.ts raw bytes: capability-keyed ONLY ────────────────────
//
// Plan requirement (cb-d1-slices.md §3 C2), asserted LITERALLY: raw bytes
// contain NO "navigator.userAgent", NO "Electron", NO bare "userAgent".
// Raw bytes, comments included: the file's own header describes the rule
// without spelling either banned substring (testing.md — never quote a banned
// literal anywhere in a scanned file).

test("desktop-shell.ts: capability-keyed only — raw bytes contain NO navigator.userAgent, NO Electron, NO bare userAgent anywhere (comments included), paired with positive landmarks for the real capability checks", () => {
  const src = readSrc(DESKTOP_SHELL);

  // Positive landmarks first (vision-guard rule) — the real capability gate.
  assert.match(src, /export function isDesktopShell\(/, "positive landmark: must export function isDesktopShell(");
  assert.ok(src.includes("window.posDesktop"), "positive landmark: must reference window.posDesktop");
  assert.ok(
    src.includes('typeof bridge.printHtml !== "function"'),
    'positive landmark: must guard with typeof bridge.printHtml !== "function"',
  );

  assert.ok(!src.includes("navigator" + ".userAgent"), 'desktop-shell.ts must NEVER contain "navigator.userAgent" anywhere, not even in a comment — capability-keyed only');
  assert.ok(!src.includes("Electron"), 'desktop-shell.ts must NEVER contain "Electron" anywhere, not even in a comment — capability-keyed only');
  assert.ok(!src.includes("userAgent"), 'desktop-shell.ts must NEVER contain bare "userAgent" anywhere, not even in a comment — capability-keyed only');
});

// The document half (lib/desktop-shell-document.ts, split out 2026-09-11) is
// part of the SAME seam and must stay just as capability-keyed — it never
// sniffs a runtime name, only serializes/inspects the DOM it is handed.

test("desktop-shell-document.ts: capability-keyed only — raw bytes contain NO navigator.userAgent, NO Electron, NO bare userAgent anywhere (comments included), paired with positive landmarks for its real exports", () => {
  const src = readSrc(DESKTOP_SHELL_DOCUMENT);

  // Positive landmarks first (vision-guard rule).
  assert.match(src, /export function printDocumentHasText\(/, "positive landmark: must export function printDocumentHasText(");
  assert.match(src, /export function inlineStylesheets\(/, "positive landmark: must export function inlineStylesheets(");

  assert.ok(!src.includes("navigator" + ".userAgent"), 'desktop-shell-document.ts must NEVER contain "navigator.userAgent" anywhere, not even in a comment — capability-keyed only');
  assert.ok(!src.includes("Electron"), 'desktop-shell-document.ts must NEVER contain "Electron" anywhere, not even in a comment — capability-keyed only');
  assert.ok(!src.includes("userAgent"), 'desktop-shell-document.ts must NEVER contain bare "userAgent" anywhere, not even in a comment — capability-keyed only');
});

test("desktop-shell.ts: default onPrintError body toasts shellErrorMessage(error) (which falls back to DESKTOP_PRINT_FAILED_MESSAGE) + calls onAfterPrint?.(); file stays <= 150 lines", () => {
  const src = readSrc(DESKTOP_SHELL);

  const defaultOnPrintErrorAt = src.indexOf("function defaultOnPrintError(");
  assert.ok(defaultOnPrintErrorAt >= 0, "positive landmark: must declare function defaultOnPrintError(");
  const bodyEnd = src.indexOf("\n}", defaultOnPrintErrorAt);
  assert.ok(bodyEnd > defaultOnPrintErrorAt, "expected to find the end of defaultOnPrintError's body");
  const body = src.slice(defaultOnPrintErrorAt, bodyEnd);

  assert.ok(body.includes("desktopToast(shellErrorMessage(error))"), "defaultOnPrintError must toast the shell's own sentence via shellErrorMessage(error)");
  assert.ok(body.includes("onAfterPrint?.();"), "defaultOnPrintError's body must call onAfterPrint?.();");

  const fallbackAt = src.indexOf("export function shellErrorMessage(");
  assert.ok(fallbackAt >= 0, "positive landmark: must export shellErrorMessage(");
  const fallbackBody = src.slice(fallbackAt, src.indexOf("\n}", fallbackAt));
  assert.ok(fallbackBody.includes("DESKTOP_PRINT_FAILED_MESSAGE"), "shellErrorMessage must fall back to DESKTOP_PRINT_FAILED_MESSAGE");

  // Budget raised 120 → 150 with the review fix round: the seam gained the
  // size mirror, the reply timeout and the shell-message parsing (C1/C7/C19).
  const lineCount = src.replace(/\n$/, "").split("\n").length;
  assert.ok(lineCount <= 150, `desktop-shell.ts must stay <= 150 lines, got ${lineCount}`);
});

// ── D2. The blank-slip fence wiring (2026-09-11) ────────────────────────────

test("desktop-shell.ts imports DESKTOP_PRINT_EMPTY_MESSAGE, printDocumentHasText, serializePrintDocument from @/lib/desktop-shell-document and re-exports serializePrintDocument; SEAM_MESSAGES includes DESKTOP_PRINT_EMPTY_MESSAGE; printThroughShell checks printDocumentHasText(html) BEFORE the DESKTOP_PRINT_HTML_MAX_CHARS size check; desktop-shell-document.ts stays <= 150 lines", () => {
  const src = readSrc(DESKTOP_SHELL);

  assert.match(
    src,
    /import\s*\{[\s\S]*?DESKTOP_PRINT_EMPTY_MESSAGE[\s\S]*?printDocumentHasText[\s\S]*?serializePrintDocument[\s\S]*?\}\s*from\s*"@\/lib\/desktop-shell-document"/,
    "must import { DESKTOP_PRINT_EMPTY_MESSAGE, printDocumentHasText, serializePrintDocument } from \"@/lib/desktop-shell-document\"",
  );
  assert.match(
    src,
    /export\s*\{\s*serializePrintDocument[\s\S]*?\}/,
    "must re-export serializePrintDocument so existing import sites keep working",
  );

  const seamMessagesAt = src.indexOf("const SEAM_MESSAGES");
  assert.ok(seamMessagesAt >= 0, "positive landmark: const SEAM_MESSAGES must be declared");
  const seamMessagesEnd = src.indexOf("]);", seamMessagesAt);
  assert.ok(seamMessagesEnd > seamMessagesAt, "expected to find the end of the SEAM_MESSAGES set literal");
  const seamMessagesBlock = src.slice(seamMessagesAt, seamMessagesEnd);
  assert.ok(seamMessagesBlock.includes("DESKTOP_PRINT_EMPTY_MESSAGE"), "SEAM_MESSAGES must include DESKTOP_PRINT_EMPTY_MESSAGE");

  const hasTextCheckAt = src.indexOf("printDocumentHasText(html)");
  const sizeCheckAt = src.indexOf("html.length > DESKTOP_PRINT_HTML_MAX_CHARS");
  assert.ok(hasTextCheckAt >= 0 && sizeCheckAt >= 0, "positive landmark: both checks must be present in printThroughShell");
  assert.ok(
    hasTextCheckAt < sizeCheckAt,
    `expected printDocumentHasText(html)(${hasTextCheckAt}) BEFORE the size check html.length > DESKTOP_PRINT_HTML_MAX_CHARS(${sizeCheckAt}) — the blank-slip fence must trip before the shell is ever asked to print an empty body`,
  );

  const documentSrc = readSrc(DESKTOP_SHELL_DOCUMENT);
  const documentLineCount = documentSrc.replace(/\n$/, "").split("\n").length;
  assert.ok(documentLineCount <= 150, `desktop-shell-document.ts must stay <= 150 lines, got ${documentLineCount}`);
});

test("PARITY: desktop-shell.ts's DESKTOP_PRINT_HTML_MAX_CHARS mirrors apps/desktop/src/shared.ts PRINT_HTML_MAX_CHARS, and the seam's reply timeout is LONGER than the shell's job timeout", () => {
  const seam = readSrc(DESKTOP_SHELL);
  const shellShared = readSrc("apps/desktop/src/shared.ts");
  const seamCap = /export const DESKTOP_PRINT_HTML_MAX_CHARS = ([0-9_]+);/.exec(seam);
  const shellCap = /export const PRINT_HTML_MAX_CHARS = ([0-9_]+);/.exec(shellShared);
  assert.ok(seamCap && shellCap, "both sides must declare their size ceiling as a numeric literal");
  assert.equal(seamCap![1], shellCap![1], "the cafe seam must refuse exactly what the shell refuses");
  const seamTimeout = /export const DESKTOP_PRINT_TIMEOUT_MS = ([0-9_]+);/.exec(seam);
  const shellTimeout = /export const PRINT_JOB_TIMEOUT_MS = ([0-9_]+);/.exec(shellShared);
  assert.ok(seamTimeout && shellTimeout, "both sides must declare their timeout as a numeric literal");
  assert.ok(
    Number(seamTimeout![1].replace(/_/g, "")) > Number(shellTimeout![1].replace(/_/g, "")),
    "the seam's no-reply timeout must outlast the shell's own job deadline so the shell's message wins when it answers",
  );
});

// ── E. PARITY: apps/desktop/src/preload.ts (readFileSync, never an import) ─
//
// Plan requirement, asserted LITERALLY: `exposeInMainWorld("posDesktop"`,
// `version`, `printHtml`, `"pos-desktop:print-html"`, and NOT
// `exposeInMainWorld("posDesktopSetup"`. The preload passes the bridge key as
// the literal at the call site (never a named constant) so this grep — and the
// desktop side's own pin — read the same bytes.

test('PARITY: apps/desktop/src/preload.ts contains exposeInMainWorld("posDesktop", version, printHtml, "pos-desktop:print-html", and NOT exposeInMainWorld("posDesktopSetup"', () => {
  const src = readSrc(DESKTOP_PRELOAD);

  // Positive landmarks first — the bridge's real presence, independent of the
  // exact call-site literal shape asserted below.
  assert.ok(src.includes("contextBridge"), "positive landmark: preload.ts must reference contextBridge");
  assert.ok(src.includes("posDesktop"), 'positive landmark: preload.ts must reference "posDesktop" somewhere');

  assert.ok(src.includes('exposeInMainWorld("posDesktop"'), 'preload.ts must contain the literal exposeInMainWorld("posDesktop"');
  assert.ok(src.includes("version"), 'preload.ts must expose "version"');
  assert.ok(src.includes("printHtml"), 'preload.ts must expose "printHtml"');
  assert.ok(src.includes('"pos-desktop:print-html"'), 'preload.ts must reference the "pos-desktop:print-html" channel');
  assert.ok(!src.includes('exposeInMainWorld("posDesktopSetup"'), 'preload.ts must NOT expose a "posDesktopSetup" bridge');
});

// ── F. Print-method (2026-09-19): savePrintMode is OPTIONAL, printMode too ─
//
// The new shell build adds a `printMode` field to listPrinters()'s resolved
// object and an optional `savePrintMode` method — both OPTIONAL on the bridge
// type, same rationale as listPrinters/savePrinter: an older, un-upgraded
// shell's installer never carries them.

test("desktop-shell.ts: PosDesktopBridge declares savePrintMode? as OPTIONAL (question mark on the member, never required) and listPrinters?'s resolved type carries an optional printMode? field — paired with the positive landmark that printHtml stays REQUIRED (no question mark)", () => {
  const src = readSrc(DESKTOP_SHELL);

  // Positive landmark: printHtml is still required (no trailing ?).
  assert.match(src, /printHtml\(html: string\): Promise<void>;/, "positive landmark: printHtml must stay required (no ?)");

  assert.match(
    src,
    /savePrintMode\?\(mode: DesktopPrintMode\): Promise<\{ printMode: DesktopPrintMode \}>;/,
    "savePrintMode must be declared OPTIONAL (savePrintMode?(...)), never required — an older shell's bridge lacks it",
  );
  assert.match(
    src,
    /listPrinters\?\(\): Promise<\{[\s\S]*?printMode\?:\s*DesktopPrintMode[\s\S]*?\}>;/,
    "listPrinters?'s resolved object must carry an OPTIONAL printMode? field",
  );

  assert.match(
    src,
    /import type \{ DesktopPrintMode \} from "@\/lib\/desktop-shell-printer";/,
    "desktop-shell.ts must import the DesktopPrintMode type from lib/desktop-shell-printer.ts (the 150-line budget left no room to declare it here)",
  );
});

test("desktop-shell-printer.ts: desktopPrinterApi() binds savePrintMode ONLY via a typeof bridge.savePrintMode === \"function\" check, and it is bound OUTSIDE the listPrinters/savePrinter presence check that gates the null return — paired with the positive landmark that listPrinters/savePrinter stay the REQUIRED gate for a non-null api", () => {
  const src = readSrc(DESKTOP_SHELL_PRINTER);

  // Positive landmark: listPrinters/savePrinter remain the required gate.
  assert.match(
    src,
    /if \(typeof listPrinters !== "function" \|\| typeof savePrinter !== "function"\) return null;/,
    "positive landmark: desktopPrinterApi() must still return null unless BOTH listPrinters and savePrinter are functions",
  );

  const gateAt = src.indexOf('if (typeof listPrinters !== "function"');
  const bindAt = src.indexOf('typeof bridge.savePrintMode === "function"');
  assert.ok(gateAt >= 0 && bindAt >= 0, "positive landmark: both markers must be present");
  assert.ok(
    gateAt < bindAt,
    `expected the listPrinters/savePrinter gate(${gateAt}) BEFORE the savePrintMode feature-detect(${bindAt}) — savePrintMode must never be part of the required gate`,
  );
  assert.match(
    src,
    /if \(typeof bridge\.savePrintMode === "function"\) api\.savePrintMode = bridge\.savePrintMode\.bind\(bridge\);/,
    'savePrintMode must be bound ONLY behind typeof bridge.savePrintMode === "function" — never called/bound unconditionally',
  );

  assert.match(
    src,
    /export const DESKTOP_PRINT_MODES: readonly DesktopPrintMode\[\] = \["direct", "driver"\];/,
    "must export DESKTOP_PRINT_MODES as readonly [\"direct\", \"driver\"]",
  );
  assert.match(
    src,
    /export const DEFAULT_DESKTOP_PRINT_MODE: DesktopPrintMode = "direct";/,
    'must export DEFAULT_DESKTOP_PRINT_MODE = "direct"',
  );
});

// ── G. DesktopPrinterPicker.tsx: the print-method radio block ─────────────
// Split into a sibling, DesktopPrintMethod.tsx, to keep the picker's own size
// in check — same idiom as PrintHostCardParts.tsx. The picker only renders it
// behind a THREE-way feature detection: printers.length > 0, savePrintMode is
// a function, and the list actually reported a printMode.

const DESKTOP_PRINT_METHOD = "apps/cafe/components/print/DesktopPrintMethod.tsx";

test("PIN: DesktopPrinterPicker.tsx renders <DesktopPrintMethod behind printers.length > 0 && typeof api.savePrintMode === \"function\" && printMode !== undefined — paired with the positive landmark that the printer <select> renders unconditionally on printers.length > 0 alone (the mode block is STRICTLY narrower)", () => {
  const pickerSrc = readSrc(DESKTOP_PRINTER_PICKER);

  // Positive landmark: the existing printer select's own (looser) gate.
  assert.match(pickerSrc, /printers\.length === 0 \? \(/, "positive landmark: the printer list's own empty-check must still be present");

  assert.match(
    pickerSrc,
    /\{printers\.length > 0 && typeof api\.savePrintMode === "function" && printMode !== undefined && \(/,
    "DesktopPrinterPicker.tsx must gate the print-method block on printers.length > 0 && typeof api.savePrintMode === \"function\" && printMode !== undefined",
  );
  assert.match(
    pickerSrc,
    /<DesktopPrintMethod api=\{api\} savePrintMode=\{api\.savePrintMode\} printMode=\{printMode\} \/>/,
    "must render <DesktopPrintMethod api={api} savePrintMode={api.savePrintMode} printMode={printMode} />",
  );
  assert.match(
    pickerSrc,
    /import \{ DesktopPrintMethod \} from "@\/components\/print\/DesktopPrintMethod";/,
    "must import { DesktopPrintMethod } from \"@/components/print/DesktopPrintMethod\"",
  );
});

test("PIN: DesktopPrintMethod.tsx's two radio values equal DESKTOP_PRINT_MODES exactly (order and membership), and it imports DESKTOP_PRINT_MODES from @/lib/desktop-shell-printer rather than hardcoding the literals a second time", () => {
  const src = readSrc(DESKTOP_PRINT_METHOD);

  assert.match(
    src,
    /import\s*\{[\s\S]*?DESKTOP_PRINT_MODES[\s\S]*?\}\s*from\s*"@\/lib\/desktop-shell-printer"/,
    "DesktopPrintMethod.tsx must import DESKTOP_PRINT_MODES from @/lib/desktop-shell-printer",
  );
  assert.match(
    src,
    /\{DESKTOP_PRINT_MODES\.map\(/,
    "positive landmark: the radios must be generated by mapping DESKTOP_PRINT_MODES, not two hand-written literals — the only way the two stay equal by construction",
  );

  const modesSrc = readSrc(DESKTOP_SHELL_PRINTER);
  const modesMatch = /export const DESKTOP_PRINT_MODES: readonly DesktopPrintMode\[\] = \[("[^"]+"(?:, "[^"]+")*)\];/.exec(modesSrc);
  assert.ok(modesMatch, "desktop-shell-printer.ts must declare DESKTOP_PRINT_MODES as a literal array");
  const modes = JSON.parse(`[${modesMatch![1]}]`) as string[];
  assert.deepEqual(modes, ["direct", "driver"], "DESKTOP_PRINT_MODES must be exactly [\"direct\", \"driver\"], in that order");
});

test("PIN: DesktopPrintMethod.tsx carries the mandated English copy verbatim — labels and one-line descriptions for both direct and driver modes", () => {
  const src = readSrc(DESKTOP_PRINT_METHOD);

  assert.ok(src.includes("Direct to printer (recommended)"), 'must carry the label "Direct to printer (recommended)"');
  assert.ok(
    src.includes("The slip is sent to the printer as an image, so the paper is exactly as long as the slip."),
    "must carry the direct-mode description verbatim",
  );
  assert.ok(src.includes("Through the Windows driver"), 'must carry the label "Through the Windows driver"');
  assert.ok(
    src.includes("Use only if direct printing gives blank or garbled paper. The driver's page size decides the paper length."),
    "must carry the driver-mode description verbatim",
  );

  assert.ok(src.includes("Print method saved."), 'must carry the success toast "Print method saved."');
  assert.ok(
    src.includes("Could not save the print method — try again."),
    'must carry the failure toast "Could not save the print method — try again."',
  );
});
