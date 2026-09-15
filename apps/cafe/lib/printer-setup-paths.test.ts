// Print-standardization plan (.claude/plan/v2/print-standardization-plan.md
// §C slice A5) — paths/pins for the printer-setup wizard: reachability,
// zero print-bridge machinery, no PosPulseProvider, the isPending disable,
// the mobile-UA gate's F1-swap-safety, single kiosk-template source, and the
// WIZARD_LABEL_MAX_CHARS/PRINT_HOST_LABEL_MAX_CHARS parity pin. Raw
// readFileSync source pins, mirroring lib/pos-layout-paths.test.ts's idiom —
// no React test framework exists in this repo. §E: this file + the trailing
// package.json test-chain append are the ONLY edits this slice makes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const SETTINGS_PAGE = "apps/cafe/app/(dashboard)/settings/page.tsx";
const PRINTING_PAGE = "apps/cafe/app/(dashboard)/settings/printing/page.tsx";
const WIZARD_TSX = "apps/cafe/components/print/PrinterSetupWizard.tsx";
const STEPS_TSX = "apps/cafe/components/print/PrinterSetupSteps.tsx";
const PRINT_LIB = "apps/cafe/lib/print.ts";
const PRINT_HOST_LIB = "apps/cafe/lib/print-host.ts";

const WIZARD_FILES = [PRINTING_PAGE, WIZARD_TSX, STEPS_TSX];

test("PIN (a): reachable — settings/page.tsx links to /settings/printing, and printing/page.tsx renders <PrinterSetupWizard imported from @/components/print/PrinterSetupWizard; PH-10b: also renders <PrintHostCard /> imported from @/components/print/PrintHostCard, ABOVE the wizard", () => {
  const settingsSrc = stripComments(readSrc(SETTINGS_PAGE));
  assert.match(settingsSrc, /href="\/settings\/printing"/, "settings/page.tsx must link to /settings/printing");

  const printingSrc = stripComments(readSrc(PRINTING_PAGE));
  assert.match(printingSrc, /<PrinterSetupWizard\b/, "printing/page.tsx must render <PrinterSetupWizard");
  assert.match(
    printingSrc,
    /import\s*\{\s*PrinterSetupWizard\s*\}\s*from\s*"@\/components\/print\/PrinterSetupWizard"/,
    "printing/page.tsx must import PrinterSetupWizard from @/components/print/PrinterSetupWizard",
  );

  // PH-10b (D3): the print-host card moved here, ABOVE the wizard.
  assert.match(
    printingSrc,
    /import\s*\{\s*PrintHostCard\s*\}\s*from\s*"@\/components\/print\/PrintHostCard"/,
    "printing/page.tsx must import PrintHostCard from @/components/print/PrintHostCard",
  );
  const cardIdx = printingSrc.indexOf("<PrintHostCard />");
  const wizardIdx = printingSrc.indexOf("<PrinterSetupWizard");
  assert.ok(cardIdx >= 0, "printing/page.tsx must render <PrintHostCard />");
  assert.ok(wizardIdx > cardIdx, "printing/page.tsx must render <PrintHostCard /> ABOVE <PrinterSetupWizard");
});

test("PIN (b): zero print-bridge machinery across the wizard-side files (protects PH-10's bridge-count pin); positive landmarks: the wizard calls useDesignatePrintHost and useQuery", () => {
  for (const rel of WIZARD_FILES) {
    const raw = readSrc(rel);
    assert.ok(!raw.includes("useReactToPrint"), `${rel} must never reference useReactToPrint`);
    assert.ok(!raw.includes("pageStyle"), `${rel} must never reference pageStyle`);
  }
  const wizardSrc = stripComments(readSrc(WIZARD_TSX));
  assert.match(wizardSrc, /useDesignatePrintHost/, "positive landmark: PrinterSetupWizard.tsx must call useDesignatePrintHost");
  assert.match(wizardSrc, /useQuery/, "positive landmark: PrinterSetupWizard.tsx must call useQuery");
});

test("PIN (c): no PosPulseProvider IMPORT in any wizard-side file (plan §B1: own page-scoped pulse query instead) — scoped to the import statement, not bare prose mentions (the wizard's own header comment legitimately explains the decision in words); positive landmark: the wizard declares its own WIZARD_PULSE_KEY", () => {
  for (const rel of WIZARD_FILES) {
    const raw = readSrc(rel);
    assert.ok(!raw.includes('from "@/components/layout/PosPulseProvider"'), `${rel} must never import from @/components/layout/PosPulseProvider`);
  }
  const wizardSrc = stripComments(readSrc(WIZARD_TSX));
  assert.match(wizardSrc, /WIZARD_PULSE_KEY/, "positive landmark: PrinterSetupWizard.tsx must declare its own WIZARD_PULSE_KEY");
});

test("PIN (d): the designation Save button is disabled while isPending — PrinterSetupWizard passes designate.isPending down, PrinterSetupSteps' disabled= consumes it", () => {
  const wizardSrc = stripComments(readSrc(WIZARD_TSX));
  assert.match(wizardSrc, /isPending=\{designate\.isPending\}/, "PrinterSetupWizard.tsx must pass isPending={designate.isPending} to DesignateStep");

  const stepsSrc = stripComments(readSrc(STEPS_TSX));
  assert.match(stepsSrc, /disabled=\{isPending \|\|/, "PrinterSetupSteps.tsx's Save button must be disabled={isPending || ...}");
});

test("PIN (e): the mobile-UA gate exists in exactly ONE F1-swap-safe form — either WIZARD_MOBILE_UA_RE byte-identical to lib/print.ts's documented regex, or an isMobileUserAgent import from @/lib/print (never neither, never both)", () => {
  const wizardSrc = readSrc(WIZARD_TSX);
  const localMatch = wizardSrc.match(/const WIZARD_MOBILE_UA_RE\s*=\s*(\/(?:\\.|[^/\n])+\/[a-z]*)/);
  const hasImport = /import\s*\{[^}]*\bisMobileUserAgent\b[^}]*\}\s*from\s*"@\/lib\/print"/.test(wizardSrc);
  const hasLocal = Boolean(localMatch);

  assert.notEqual(hasLocal, hasImport, `expected exactly one of {WIZARD_MOBILE_UA_RE, isMobileUserAgent import}, found local=${hasLocal} import=${hasImport}`);

  if (hasLocal) {
    const printLibSrc = readSrc(PRINT_LIB);
    const printLibMatch = printLibSrc.match(/(\/(?:Android|webOS)(?:\\.|[^/\n])+\/[a-z]*)/);
    assert.ok(printLibMatch, "lib/print.ts must carry the documented mobile-UA regex literal for this byte-copy pin to compare against");
    assert.equal(
      localMatch![1],
      printLibMatch![1],
      `WIZARD_MOBILE_UA_RE (${localMatch![1]}) must be byte-identical to lib/print.ts's mobile-UA regex literal (${printLibMatch![1]})`,
    );
  }
});

test("PIN (f): single kiosk-template source — PrinterSetupWizard imports kioskShortcutBat from @/lib/print-host-setup, and no wizard-side file inlines a second --kiosk-printing template literal", () => {
  const wizardSrc = stripComments(readSrc(WIZARD_TSX));
  assert.match(
    wizardSrc,
    /import\s*\{[^}]*\bkioskShortcutBat\b[^}]*\}\s*from\s*"@\/lib\/print-host-setup"/,
    "PrinterSetupWizard.tsx must import kioskShortcutBat from @/lib/print-host-setup",
  );
  for (const rel of WIZARD_FILES) {
    const raw = readSrc(rel);
    assert.ok(!raw.includes("--kiosk-printing"), `${rel} must never inline the --kiosk-printing literal — the .bat template has a single source`);
  }
});

test("PIN (g): WIZARD_LABEL_MAX_CHARS mirrors PRINT_HOST_LABEL_MAX_CHARS — the client-side copy must equal the server-only bound (consolidation is a pinned follow-up, not a silent drift)", () => {
  const wizardSrc = readSrc(WIZARD_TSX);
  const wizardMatch = wizardSrc.match(/WIZARD_LABEL_MAX_CHARS\s*=\s*(\d+)/);
  assert.ok(wizardMatch, "PrinterSetupWizard.tsx must declare WIZARD_LABEL_MAX_CHARS = <n>");

  const printHostSrc = readSrc(PRINT_HOST_LIB);
  const printHostMatch = printHostSrc.match(/PRINT_HOST_LABEL_MAX_CHARS\s*=\s*(\d+)/);
  assert.ok(printHostMatch, "lib/print-host.ts must declare PRINT_HOST_LABEL_MAX_CHARS = <n>");

  assert.equal(
    Number(wizardMatch![1]),
    Number(printHostMatch![1]),
    `apps/cafe/components/print/PrinterSetupWizard.tsx's WIZARD_LABEL_MAX_CHARS (${wizardMatch![1]}) must equal apps/cafe/lib/print-host.ts's PRINT_HOST_LABEL_MAX_CHARS (${printHostMatch![1]})`,
  );
});

test("PIN (h): render ladder is data-first — the wizard branches on isLoadingError/isPaused, never a bare data-discarding isError (regression: C13/C14/C25, 2026-09-03)", () => {
  const wizardSrc = readSrc(WIZARD_TSX);
  assert.ok(wizardSrc.includes("isLoadingError"), "wizard must gate its hard error card on isLoadingError (error AND no data)");
  assert.ok(wizardSrc.includes("isPaused"), "positive landmark: the offline (isPaused) branch must exist");
  const bare = "is" + "Error";
  assert.ok(!stripComments(wizardSrc).replace(/isLoadingError/g, "").includes(bare), "a bare " + bare + " branch would discard a fully-rendered wizard on any refetch failure");
});
