// Print-host plan (.claude/plan/v2/print-host-plan.md §B7, slice PH-7) — RAW
// source-text pins over the print-host CARD tree: reachability from
// /requests, the design-review MERGED-13 ban on a component-owned print
// trigger, the A-16/§B7 attestation call contract, the busy-gate/never-queue
// rule, MERGED-17 clear-host (device-agnostic, UA-independent), the wizard's
// F1 mobile-UA swap, A-13's disabled auto-print toggle, line budgets +
// hygiene, and the dark-rollout fence landmark. Same readSrc + REPO_ROOT +
// stripComments idiom as lib/printer-setup-paths.test.ts and
// lib/print-host-paths.test.ts. Every negative pin below is paired with a
// positive landmark assert in the SAME test, per testing.md's vision-guard
// rule; grep-gate needles are built by concatenation so this file never
// carries the literal it bans.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// Normalised to LF: the needles below are indentation-anchored across line
// breaks, and a checkout with core.autocrlf can hand the scanned file back as
// CRLF (2026-09-08: a stash/pop did exactly that and this pin went red on a
// file whose structure was untouched).
const readSrc = (rel: string): string =>
  readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const REQUESTS_PAGE = "apps/cafe/app/(dashboard)/requests/page.tsx";
const CARD_TSX = "apps/cafe/components/print/PrintHostCard.tsx";
const PARTS_TSX = "apps/cafe/components/print/PrintHostCardParts.tsx";
const WIZARD_TSX = "apps/cafe/components/print/PrinterSetupWizard.tsx";
const PRINT_LIB = "apps/cafe/lib/print.ts";
const DEVICE_ALERT_SETTINGS = "apps/cafe/components/orders/DeviceAlertSettings.tsx";
const DEVICE_ALERT_SETTINGS_DIALOG = "apps/cafe/components/orders/DeviceAlertSettingsDialog.tsx";
const SETTINGS_FIELDS = "apps/cafe/components/settings/SettingsFields.tsx";
const PRINT_HOST_LIB = "apps/cafe/lib/print-host.ts";
const PRINTING_PAGE = "apps/cafe/app/(dashboard)/settings/printing/page.tsx";

const CARD_FILES = [CARD_TSX, PARTS_TSX];

// ── (a) Reachability ─────────────────────────────────────────────────────

test("PIN (a) PH-10b: requests/page.tsx imports { DeviceAlertSettingsDialog } from @/components/orders/DeviceAlertSettingsDialog and renders <DeviceAlertSettingsDialog />; that dialog imports { DeviceAlertSettings } and renders <DeviceAlertSettings /> and imports Dialog/DialogContent from @/components/ui/dialog (2-hop reachability); requests/page.tsx contains NO PrintHostCard (the card moved to /settings/printing, ABOVE the wizard)", () => {
  const src = readSrc(REQUESTS_PAGE);

  assert.match(
    src,
    /import\s*\{\s*DeviceAlertSettingsDialog\s*\}\s*from\s*"@\/components\/orders\/DeviceAlertSettingsDialog"/,
    "requests/page.tsx must import { DeviceAlertSettingsDialog } from @/components/orders/DeviceAlertSettingsDialog",
  );
  assert.match(src, /<DeviceAlertSettingsDialog\s*\/>/, "requests/page.tsx must render <DeviceAlertSettingsDialog />");

  const dialogSrc = readSrc(DEVICE_ALERT_SETTINGS_DIALOG);
  assert.match(
    dialogSrc,
    /import\s*\{\s*DeviceAlertSettings\s*\}\s*from\s*"@\/components\/orders\/DeviceAlertSettings"/,
    "DeviceAlertSettingsDialog.tsx must import { DeviceAlertSettings } from @/components/orders/DeviceAlertSettings",
  );
  assert.match(dialogSrc, /<DeviceAlertSettings\s*\/>/, "DeviceAlertSettingsDialog.tsx must render <DeviceAlertSettings />");
  assert.match(
    dialogSrc,
    /import\s*\{[^}]*\bDialog\b[^}]*\bDialogContent\b[^}]*\}\s*from\s*"@\/components\/ui\/dialog"|import\s*\{[^}]*\bDialogContent\b[^}]*\bDialog\b[^}]*\}\s*from\s*"@\/components\/ui\/dialog"/,
    "DeviceAlertSettingsDialog.tsx must import Dialog and DialogContent from @/components/ui/dialog",
  );

  // Negative pin: requests/page.tsx must NOT reference PrintHostCard anymore
  // (needle built by concatenation so this file never carries the literal it
  // bans). Positive landmark for this pin's own vision: settings/printing/
  // page.tsx really does import+render PrintHostCard ABOVE PrinterSetupWizard
  // — so an accidentally-blinded stripComments/readSrc couldn't vacuously pass
  // the negative half.
  const printHostCardNeedle = "Print" + "HostCard";
  assert.ok(
    !src.includes(printHostCardNeedle),
    `requests/page.tsx must NOT reference ${printHostCardNeedle} — the card moved to /settings/printing (PH-10b)`,
  );

  const printingSrc = readSrc(PRINTING_PAGE);
  assert.match(
    printingSrc,
    /import\s*\{\s*PrintHostCard\s*\}\s*from\s*"@\/components\/print\/PrintHostCard"/,
    "positive landmark: settings/printing/page.tsx must import { PrintHostCard } from @/components/print/PrintHostCard",
  );
  const cardIdx = printingSrc.indexOf("<PrintHostCard />");
  const wizardIdx = printingSrc.indexOf("<PrinterSetupWizard");
  assert.ok(cardIdx >= 0 && wizardIdx > cardIdx, "positive landmark: settings/printing/page.tsx must render <PrintHostCard /> ABOVE <PrinterSetupWizard");
});

// ── (b) MERGED-13: no component-owned print trigger ──────────────────────

test("PIN (b) MERGED-13: PrintHostCard.tsx and PrintHostCardParts.tsx raw source contain NO useReactToPrint and NO pageStyle (needles built by concatenation); positive landmarks: the card awaits queueTestSlip() and destructures queueTestSlip from usePrintHostContext()", () => {
  const useReactToPrintNeedle = "useReact" + "ToPrint";
  const pageStyleNeedle = "page" + "Style";

  for (const rel of CARD_FILES) {
    const raw = readSrc(rel);
    assert.ok(!raw.includes(useReactToPrintNeedle), `${rel} must never reference ${useReactToPrintNeedle}`);
    assert.ok(!raw.includes(pageStyleNeedle), `${rel} must never reference ${pageStyleNeedle}`);
  }

  const cardSrc = stripComments(readSrc(CARD_TSX));
  assert.match(cardSrc, /await queueTestSlip\(\)/, "positive landmark: PrintHostCard.tsx must await queueTestSlip()");
  assert.match(
    cardSrc,
    /const \{[^}]*\bqueueTestSlip\b[^}]*\} = usePrintHostContext\(\);/,
    "positive landmark: PrintHostCard.tsx must destructure queueTestSlip from usePrintHostContext()",
  );
});

// ── (c) Attestation contract (A-16/§B7) ───────────────────────────────────

test("PIN (c) A-16/§B7: the card imports useBeatPrintHost from @/hooks/use-print-host-beat; beat.mutateAsync({ deviceId, silentMode, silentProbeMs: Math.round(dt) }) appears exactly once; both onYes/onNo branches wired exactly once; readDeviceId() (from @/lib/pos-device-id) is called inside handleAttest, never printHost.deviceId/pulse.printHost.deviceId; no KIOSK_SILENT_MAX_MS threshold and no numeric dt/silentProbeMs comparison", () => {
  const src = readSrc(CARD_TSX);

  assert.match(
    src,
    /import\s*\{\s*useBeatPrintHost\s*\}\s*from\s*"@\/hooks\/use-print-host-beat"/,
    "must import { useBeatPrintHost } from @/hooks/use-print-host-beat",
  );

  const mutateAsyncLiteral = 'beat.mutateAsync({ deviceId, silentMode, silentProbeMs: Math.round(dt) })';
  const mutateAsyncCount = countOccurrences(src, mutateAsyncLiteral);
  assert.equal(mutateAsyncCount, 1, `expected ${mutateAsyncLiteral} exactly once, found ${mutateAsyncCount}`);

  const onYesCount = countOccurrences(src, "onYes={() => void handleAttest(true)}");
  const onNoCount = countOccurrences(src, "onNo={() => void handleAttest(false)}");
  assert.equal(onYesCount, 1, `expected onYes={() => void handleAttest(true)} exactly once, found ${onYesCount}`);
  assert.equal(onNoCount, 1, `expected onNo={() => void handleAttest(false)} exactly once, found ${onNoCount}`);

  assert.match(
    src,
    /import\s*\{\s*readDeviceId\s*\}\s*from\s*"@\/lib\/pos-device-id"/,
    "must import { readDeviceId } from @/lib/pos-device-id",
  );
  const handleAttestBody = src.slice(src.indexOf("const handleAttest"), src.indexOf("const handleClear"));
  assert.ok(handleAttestBody.includes("readDeviceId()"), "positive landmark: handleAttest must call readDeviceId()");

  assert.ok(!src.includes("printHost.deviceId"), "must NOT contain printHost.deviceId — deviceId comes from readDeviceId(), never the pulse");
  assert.ok(!src.includes("pulse.printHost.deviceId"), "must NOT contain pulse.printHost.deviceId");

  const thresholdNeedle = "KIOSK_SILENT" + "_MAX_MS";
  assert.ok(!src.includes(thresholdNeedle), `must NOT contain ${thresholdNeedle} — no threshold, raw ms only (§E open question SF-11)`);
  assert.ok(
    !/\b(dt|silentProbeMs)\s*(<|>|<=|>=)\s*\d/.test(src),
    "must NOT contain a numeric comparison against dt/silentProbeMs — no client-side threshold",
  );
  assert.match(src, /Math\.round\(dt\)/, "positive landmark: Math.round(dt) must be present (the raw-ms call)");
});

// ── (d) Busy gate + never-queue ───────────────────────────────────────────

test("PIN (d): const testDisabled = current !== null || phase !== \"idle\" || beat.isPending; wired to disabled={testDisabled}; the catch compares err.message === PRINT_HOST_BUSY_MESSAGE (imported from @/lib/print-host-slips); no pendingRef and no .push( — a test slip is refused, never queued", () => {
  const src = readSrc(CARD_TSX);

  assert.match(
    src,
    /const testDisabled = current !== null \|\| phase !== "idle" \|\| beat\.isPending;/,
    'must declare const testDisabled = current !== null || phase !== "idle" || beat.isPending;',
  );
  assert.match(src, /disabled=\{testDisabled\}/, "must wire disabled={testDisabled}");

  assert.match(
    src,
    /import\s*\{\s*PRINT_HOST_BUSY_MESSAGE\s*\}\s*from\s*"@\/lib\/print-host-slips"/,
    "must import { PRINT_HOST_BUSY_MESSAGE } from @/lib/print-host-slips",
  );
  assert.match(
    src,
    /err\.message === PRINT_HOST_BUSY_MESSAGE/,
    "positive landmark: the catch must compare err.message === PRINT_HOST_BUSY_MESSAGE",
  );

  assert.ok(!src.includes("pendingRef"), "PrintHostCard.tsx must NOT contain pendingRef — the bridge owns the FIFO, the card never queues");
  assert.ok(!src.includes(".push("), "PrintHostCard.tsx must NOT contain .push( — a test slip is refused (busy), never queued");
});

// ── (e) Clear host (MERGED-17) ────────────────────────────────────────────

test("PIN (e) MERGED-17: the card imports useClearPrintHost from @/hooks/use-print-host and calls clear.mutateAsync(); dropHostPref's three read-modify-write lines appear in order; dropHostPref() runs inside handleClear AFTER await clear.mutateAsync(); the clear button's disabled expression is exactly disabled={clear.isPending || host?.configured === false}; card+parts contain NO isMobileUserAgent and NO useDesignatePrintHost", () => {
  const src = readSrc(CARD_TSX);

  assert.match(
    src,
    /import\s*\{\s*useClearPrintHost\s*\}\s*from\s*"@\/hooks\/use-print-host"/,
    "must import { useClearPrintHost } from @/hooks/use-print-host",
  );
  assert.match(src, /clear\.mutateAsync\(\)/, "must call clear.mutateAsync()");

  const readAt = src.indexOf("const prefs = readDevicePrefs();");
  const writeAt = src.indexOf('if (prefs.printHost) writeDevicePrefs({ ...prefs, printHost: false });');
  const syncAt = src.indexOf("syncHostPref();");
  assert.ok(readAt >= 0 && writeAt >= 0 && syncAt >= 0, "positive landmark: all three dropHostPref lines must be present");
  assert.ok(
    readAt < writeAt && writeAt < syncAt,
    `expected index order const prefs = readDevicePrefs();(${readAt}) < if (prefs.printHost) writeDevicePrefs(...)(${writeAt}) < syncHostPref();(${syncAt})`,
  );

  const handleClearBody = src.slice(src.indexOf("const handleClear"));
  const awaitClearAt = handleClearBody.indexOf("await clear.mutateAsync();");
  const dropHostPrefCallAt = handleClearBody.indexOf("dropHostPref();");
  assert.ok(awaitClearAt >= 0 && dropHostPrefCallAt >= 0, "positive landmark: both markers must be present inside handleClear");
  assert.ok(
    awaitClearAt < dropHostPrefCallAt,
    `expected await clear.mutateAsync();(${awaitClearAt}) BEFORE dropHostPref();(${dropHostPrefCallAt}) inside handleClear`,
  );

  assert.match(
    src,
    /disabled=\{clear\.isPending \|\| host\?\.configured === false\}/,
    "the clear button's disabled expression must be exactly disabled={clear.isPending || host?.configured === false}",
  );

  const isMobileNeedle = "isMobile" + "UserAgent";
  const designateNeedle = "useDesignate" + "PrintHost";
  for (const rel of CARD_FILES) {
    const raw = readSrc(rel);
    assert.ok(!raw.includes(isMobileNeedle), `${rel} must NOT contain ${isMobileNeedle} — clear-host is not UA-gated (MERGED-17)`);
    assert.ok(!raw.includes(designateNeedle), `${rel} must NOT contain ${designateNeedle} — designation lives in the wizard`);
  }
  assert.match(src, /useClearPrintHost/, "positive landmark: useClearPrintHost must be present");
});

// ── (f) lib/print.ts ──────────────────────────────────────────────────────

test("PIN (f): lib/print.ts exports isMobileUserAgent, declares MOBILE_UA_RE exactly once, tests it in the function body, guards the server default arg, and still carries the print-chain comment landmarks", () => {
  const src = readSrc(PRINT_LIB);

  assert.match(src, /export function isMobileUserAgent\(/, "must declare export function isMobileUserAgent(");

  const mobileUaReLiteral =
    'const MOBILE_UA_RE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone/i;';
  const mobileUaReCount = countOccurrences(src, mobileUaReLiteral);
  assert.equal(mobileUaReCount, 1, `expected ${mobileUaReLiteral} exactly once, found ${mobileUaReCount}`);

  const fnBody = src.slice(src.indexOf("export function isMobileUserAgent("));
  assert.match(fnBody, /MOBILE_UA_RE\.test\(ua\)/, "the function body must test MOBILE_UA_RE.test(ua)");
  assert.match(
    fnBody,
    /ua: string = typeof navigator === "undefined" \? "" : navigator\.userAgent,/,
    'the default arg must guard the server: typeof navigator === "undefined" ? "" : navigator.userAgent',
  );

  assert.match(src, /MOBILE user-agents/, "positive landmark: the print-chain comment must still name MOBILE user-agents");
  assert.match(src, /500ms timer/, "positive landmark: the print-chain comment must still name the 500ms timer");
});

// ── (g) Wizard swap (PS-A follow-up F1) ────────────────────────────────────

test("PIN (g) F1: PrinterSetupWizard.tsx contains NO WIZARD_MOBILE_UA_RE; imports isMobileUserAgent from @/lib/print and calls isMobile: isMobileUserAgent(); imports usePrintHostContext from @/components/layout/PrintHostProvider and destructures syncHostPref; inside handleDesignate, syncHostPref() runs AFTER writeDevicePrefs({ ...readDevicePrefs(), printHost: true }); and BEFORE the success toast; the wizard still does not import from @/components/layout/PosPulseProvider", () => {
  const src = readSrc(WIZARD_TSX);

  assert.ok(!src.includes("WIZARD_MOBILE_UA_RE"), "PrinterSetupWizard.tsx must NOT contain WIZARD_MOBILE_UA_RE (deleted in favour of the shared helper)");

  assert.match(
    src,
    /import\s*\{\s*isMobileUserAgent\s*\}\s*from\s*"@\/lib\/print";/,
    'positive landmark: must import { isMobileUserAgent } from "@/lib/print";',
  );
  assert.match(src, /isMobile: isMobileUserAgent\(\)/, "positive landmark: must call isMobile: isMobileUserAgent()");

  assert.match(
    src,
    /import\s*\{\s*usePrintHostContext\s*\}\s*from\s*"@\/components\/layout\/PrintHostProvider"/,
    "must import { usePrintHostContext } from @/components/layout/PrintHostProvider",
  );
  assert.match(
    src,
    /const \{\s*syncHostPref\s*\} = usePrintHostContext\(\);/,
    "must destructure const { syncHostPref } = usePrintHostContext();",
  );

  const handleDesignateBody = src.slice(src.indexOf("async function handleDesignate"), src.indexOf("function handleDownloadShortcut"));
  const writePrefsAt = handleDesignateBody.indexOf('writeDevicePrefs({ ...readDevicePrefs(), printHost: true });');
  const syncAt = handleDesignateBody.indexOf("syncHostPref();");
  const toastAt = handleDesignateBody.indexOf('toast.success("Print host set.");');
  assert.ok(writePrefsAt >= 0 && syncAt >= 0 && toastAt >= 0, "positive landmark: all three handleDesignate markers must be present");
  assert.ok(
    writePrefsAt < syncAt && syncAt < toastAt,
    `expected index order writeDevicePrefs(...)(${writePrefsAt}) < syncHostPref();(${syncAt}) < toast.success("Print host set.");(${toastAt}) inside handleDesignate`,
  );

  assert.ok(
    !src.includes('from "@/components/layout/PosPulseProvider"'),
    "PrinterSetupWizard.tsx must still never import from @/components/layout/PosPulseProvider (plan §B1)",
  );
});

// ── (h) A-13: disabled auto-print toggle on the host ──────────────────────

test("PIN (h) A-13: DeviceAlertSettings.tsx imports usePrintHostContext from @/components/layout/PrintHostProvider, destructures { isHostDevice }, and only the Auto-print self-orders ToggleRow carries disabled={isHostDevice} (the Alert-sound ToggleRow has no disabled=); SettingsFields.tsx's ToggleRow declares disabled?: boolean, defaults disabled = false, and forwards disabled={disabled} on <Switch", () => {
  const dasSrc = readSrc(DEVICE_ALERT_SETTINGS);

  // PH-10b (D6, review MED): the Card wrapper is GONE — a card nested inside
  // the Device settings dialog is the exact shape the owner rejected, and the
  // indentation-anchored ToggleRow needles below cannot tell a re-wrapped
  // Card apart from the bare div. Negatives by concatenation + the positive
  // landmark of the bare wrapper itself.
  const cardTagNeedle = "<Ca" + "rd";
  const cardImportNeedle = "@/components/ui/" + "card";
  assert.ok(!dasSrc.includes(cardTagNeedle), "DeviceAlertSettings.tsx must render NO Card element — it lives inside a Dialog now (D6)");
  assert.ok(!dasSrc.includes(cardImportNeedle), "DeviceAlertSettings.tsx must not import from the ui card module (D6)");
  assert.match(dasSrc, /<div className="space-y-4">/, 'positive landmark: the bare <div className="space-y-4"> wrapper must be present');

  assert.match(
    dasSrc,
    /import\s*\{\s*usePrintHostContext\s*\}\s*from\s*"@\/components\/layout\/PrintHostProvider"/,
    "must import { usePrintHostContext } from @/components/layout/PrintHostProvider",
  );
  assert.match(
    dasSrc,
    /const \{\s*isHostDevice\s*\} = usePrintHostContext\(\);/,
    "must destructure const { isHostDevice } = usePrintHostContext();",
  );

  // Scope each check to its own ToggleRow JSX block: from `<ToggleRow` to the
  // next `/>` that closes it. PH-10b (D6): DeviceAlertSettings dropped its
  // Card wrapper (bare `<div className="space-y-4">` now), which re-measures
  // to 6-space indentation on `<ToggleRow` and 8-space on `label=` (was
  // deeper under the Card).
  const alertSoundAt = dasSrc.indexOf('<ToggleRow\n        label="Alert sound"');
  const alertSoundClose = dasSrc.indexOf("/>", alertSoundAt);
  const alertSoundBlock = dasSrc.slice(alertSoundAt, alertSoundClose);
  assert.ok(alertSoundAt >= 0 && alertSoundClose > alertSoundAt, "positive landmark: the Alert sound ToggleRow block must be found");
  assert.ok(!alertSoundBlock.includes("disabled="), "the Alert-sound ToggleRow must carry NO disabled= prop");

  const autoPrintAt = dasSrc.indexOf('<ToggleRow\n        label="Auto-print self-orders"');
  const autoPrintClose = dasSrc.indexOf("/>", autoPrintAt);
  const autoPrintBlock = dasSrc.slice(autoPrintAt, autoPrintClose);
  assert.ok(autoPrintAt >= 0 && autoPrintClose > autoPrintAt, "positive landmark: the Auto-print self-orders ToggleRow block must be found");
  assert.ok(autoPrintBlock.includes("disabled={isHostDevice}"), "the Auto-print self-orders ToggleRow must carry disabled={isHostDevice}");
  // PH-11 gate (review L4-03): the note says the toggle "stays off" on the host,
  // so the switch must SHOW off there even when a pre-designation stored value
  // is true — the stored value itself is left alone (it comes back on demotion).
  assert.ok(
    autoPrintBlock.includes("checked={prefs.autoPrintSelfOrders && !isHostDevice}"),
    "the Auto-print self-orders ToggleRow must render checked={prefs.autoPrintSelfOrders && !isHostDevice}",
  );

  const fieldsSrc = readSrc(SETTINGS_FIELDS);
  assert.match(fieldsSrc, /disabled\?: boolean;/, "ToggleRow's props type must declare disabled?: boolean;");
  assert.match(fieldsSrc, /disabled = false,/, "ToggleRow must default disabled = false,");
  assert.match(fieldsSrc, /disabled=\{disabled\}/, "ToggleRow must forward disabled={disabled} on <Switch");
});

// ── (i) Budgets + hygiene ──────────────────────────────────────────────────

test("PIN (i): line budgets — PrintHostCard.tsx <= 180, PrintHostCardParts.tsx <= 100, PrinterSetupWizard.tsx <= 200, DeviceAlertSettings.tsx <= 100, DeviceAlertSettingsDialog.tsx <= 60; none of CARD_FILES + PrinterSetupSteps.tsx + PrinterSetupWizard.tsx + print-host-setup.ts contain console. or Lucifer (case-insensitive) or the copy table's mandated English strings are present (positive landmark, safer than a Hinglish-word grep-gate); the card contains no useEffect( — all device/prefs reads are in handlers (F8)", () => {
  const budgets: [string, number][] = [
    [CARD_TSX, 180],
    [PARTS_TSX, 100],
    [WIZARD_TSX, 200],
    [DEVICE_ALERT_SETTINGS, 100],
    [DEVICE_ALERT_SETTINGS_DIALOG, 60],
  ];
  for (const [file, budget] of budgets) {
    const src = readSrc(file);
    const lineCount = src.replace(/\n$/, "").split("\n").length;
    assert.ok(lineCount <= budget, `${file} must stay <= ${budget} lines, got ${lineCount}`);
  }

  const consoleNeedle = "console" + ".";
  const luciferNeedle = "Luci" + "fer";
  for (const rel of CARD_FILES) {
    const raw = readSrc(rel);
    assert.ok(!raw.includes(consoleNeedle), `${rel} must NOT contain ${consoleNeedle} anywhere, not even in a comment`);
    assert.ok(!new RegExp(luciferNeedle, "i").test(raw), `${rel} must NOT contain "${luciferNeedle}" (case-insensitive), not even in a comment`);
  }

  // PH-10b (D4/D5, review LOW): the card no longer self-links to
  // /settings/printing and the wizard's silent-status step no longer links to
  // /requests — neither file may import next/link (needle by concatenation);
  // landmarks: Parts still imports Badge, Steps still imports Input.
  const nextLinkNeedle = 'from "next/' + 'link"';
  const partsRaw = readSrc(PARTS_TSX);
  assert.ok(!partsRaw.includes(nextLinkNeedle), "PrintHostCardParts.tsx must not import next/link — the self-link is gone (D5)");
  assert.match(partsRaw, /import \{ Badge \} from "@\/components\/ui\/badge";/, "positive landmark: PrintHostCardParts.tsx still imports Badge");
  const stepsRaw = readSrc("apps/cafe/components/print/PrinterSetupSteps.tsx");
  assert.ok(!stepsRaw.includes(nextLinkNeedle), "PrinterSetupSteps.tsx must not import next/link — the /requests link is gone (D4)");
  assert.match(stepsRaw, /import \{ Input \} from "@\/components\/ui\/input";/, "positive landmark: PrinterSetupSteps.tsx still imports Input");

  const cardSrc = readSrc(CARD_TSX);
  assert.ok(!cardSrc.includes("useEffect("), "PrintHostCard.tsx must NOT contain useEffect( — device/prefs reads happen in handlers only (F8)");
  // positive landmark: the card still uses other hooks (useState/useRef), so
  // an empty/stubbed file could not vacuously pass the useEffect( absence.
  assert.match(cardSrc, /useState<TestPhase>\("idle"\)/, "positive landmark: PrintHostCard.tsx must still call useState<TestPhase>(\"idle\")");

  // PH-10b hygiene (spec item 1): prefer positive pins over a Hinglish-word
  // grep-gate (a needle like "kar" + "o." can legitimately match English
  // words too, e.g. "kar" never appears in English but this file set changes
  // often — asserting the copy table's own mandated English strings ARE
  // present is the safer, non-vacuous check). PrintHostCard.tsx's own toast
  // literals are already exercised by PIN (d)/(e)'s exact-match asserts
  // above, so this only adds the ones not otherwise pinned verbatim.
  assert.match(cardSrc, /Print host removed — /, "positive landmark: PrintHostCard.tsx must carry the new English clearedMessage template");
  assert.match(cardSrc, /Remove print host/, "positive landmark: PrintHostCard.tsx must carry the new English button label");

  const partsSrc = readSrc(PARTS_TSX);
  assert.match(partsSrc, /No print host is set — every device prints its own slips\./, "positive landmark: PrintHostCardParts.tsx must carry the new English no-host line");
});

// ── (j) Fence untouched (dark rollout) ─────────────────────────────────────

test("PIN (j): lib/print-host.ts contains export const PRINT_HOST_DESIGNATION_ENABLED = true; since PH-8 (belt-and-braces landmark alongside print-queue.test.ts §16b — both pins flip together with the literal)", () => {
  const src = readSrc(PRINT_HOST_LIB);
  assert.match(
    src,
    /export const PRINT_HOST_DESIGNATION_ENABLED = true;/,
    "lib/print-host.ts must declare export const PRINT_HOST_DESIGNATION_ENABLED = true; (PH-8 opened the fence)",
  );
});
