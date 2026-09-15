import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PRINT_NUMBER_START_MIN } from "@pos/shared/constants";
import { blankToMinStart } from "@/components/settings/print-form-utils";
import { stripComments } from "@/lib/source-pin-utils";

// Defect 4 (Settings save was a silent no-op) + Defect 5 (a cleared "starts
// at" box saved PRINT_NUMBER_START_MIN while still showing blank) — CR1.7
// print-customization review. There is no React test framework in this repo
// (deliberate): every source-read pin below reads the REAL component source,
// the same technique as lib/print-paths.test.ts and lib/settle-money.test.ts's
// PaymentModal-caller pin. Comments are stripped before matching so a comment
// merely DESCRIBING the fix can neither satisfy nor trip a pin (the
// settings-branding.test.ts banned-string scan hit exactly this hazard once).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const USE_SETTINGS_SECTION_FORM = "apps/cafe/hooks/use-settings-section-form.ts";
const SETTINGS_SECTIONS_TEST = "apps/cafe/lib/settings-sections.test.ts";
const BILL_PRINT_CARD = "apps/cafe/components/settings/BillPrintCard.tsx";
const KOT_PRINT_CARD = "apps/cafe/components/settings/KotPrintCard.tsx";
const SETTINGS_COMPONENTS_DIR = "apps/cafe/components/settings";
const SETTINGS_APP_DIR = "apps/cafe/app/(dashboard)/settings";

// ── A — blankToMinStart: a real unit test of the coercion helper itself ─────

test("blankToMinStart: a blank string coerces to PRINT_NUMBER_START_MIN", () => {
  assert.equal(blankToMinStart(""), PRINT_NUMBER_START_MIN);
});

// `Number("   ")` is `0` in JS, not `NaN` — if blankToMinStart checked
// `raw === ""` before trimming, that `0` would sail straight past the
// isFinite guard and store a schema-rejecting `0` instead of the documented
// floor. print-form-utils.ts's blankToMinStart avoids exactly this by
// trimming FIRST (`v.trim()`), so a whitespace-only value hits the same
// `raw === ""` branch a true blank does. Confirmed live via a direct call
// below, not assumed.
test("blankToMinStart: whitespace-only input IS floored to PRINT_NUMBER_START_MIN — trim happens before the blank check", () => {
  assert.equal(blankToMinStart("   "), PRINT_NUMBER_START_MIN);
});

test("blankToMinStart: null and undefined both coerce to PRINT_NUMBER_START_MIN", () => {
  assert.equal(blankToMinStart(null), PRINT_NUMBER_START_MIN);
  assert.equal(blankToMinStart(undefined), PRINT_NUMBER_START_MIN);
});

test("blankToMinStart: a valid number (or numeric string) passes through unchanged", () => {
  assert.equal(blankToMinStart(501), 501);
  assert.equal(blankToMinStart("501"), 501);
});

test("blankToMinStart: a non-numeric, non-blank string still floors to the minimum, not NaN", () => {
  assert.equal(blankToMinStart("abc"), PRINT_NUMBER_START_MIN);
});

// ── B — Defect 4: Save must never be a silent no-op ─────────────────────────
// CB-UI1 S6 re-point: the single 4-tab SettingsForm.tsx (and its tab router)
// is retired — one react-hook-form instance now lives per section ROUTE
// (use-settings-section-form.ts), so "switch to the tab owning the error"
// becomes "name the section owning the error" (sectionForField) plus a
// setFocus on THIS page's own field. Never weakened: the replacement below
// still proves the operator gets feedback, is told WHERE to go for an
// out-of-section error, and that no panel is ever conditionally unmounted.

test("PIN: use-settings-section-form.ts calls handleSubmit(onValid, onInvalid) and onInvalid raises a toast — Save must never be a silent no-op on any section route", () => {
  const src = stripComments(readSrc(USE_SETTINGS_SECTION_FORM));
  assert.match(
    src,
    /handleSubmit\(onValid,\s*onInvalid\)/,
    "handleSubmit must be called with an onInvalid second argument — without it, an error on this section's own hidden/unmounted field, or on a field belonging to a DIFFERENT section, produces NO feedback at all and the page becomes unsavable",
  );
  assert.match(
    src,
    /toast\.error\(/,
    "onInvalid must surface a sonner toast, or the operator still sees nothing when Save silently fails validation",
  );
});

test("PIN: use-settings-section-form.ts's onInvalid resolves the errored field's OWNING SECTION via sectionForField, focuses it in-page when it belongs to THIS section, and otherwise names the other section rather than failing silently — the retired tab-switch router's replacement, one level more general (any of the 7 sections, not just appearance/bill/kot/telegram)", () => {
  const src = stripComments(readSrc(USE_SETTINGS_SECTION_FORM));
  const fnStart = src.indexOf("const onInvalid");
  assert.ok(fnStart >= 0, "onInvalid must be defined");
  const fnEnd = src.indexOf("const submit", fnStart);
  assert.ok(fnEnd > fnStart, "onInvalid must be defined before the hook builds `submit`");
  const body = src.slice(fnStart, fnEnd);

  assert.match(
    body,
    /const owner = sectionForField\(rootKey as keyof SettingsInput\);/,
    "onInvalid must resolve the first errored field's owning section via sectionForField — a hardcoded tab-name router (appearance*/bill*/kot*/telegram* prefixes) cannot express a NEW section without a matching new prefix rule",
  );
  assert.match(
    body,
    /owner\.slug === section\.slug/,
    "onInvalid must compare the errored field's owning section against THIS page's own section — an error on a field belonging to a different section cannot be fixed from here",
  );
  assert.match(
    body,
    /const leaf = firstErrorLeaf\(formErrors\);/,
    "onInvalid must walk to the first error LEAF (lib/form-errors.ts) - a nested appearance/promoCodes error reports under its container key with no message and no registered input, so the top-level key alone yields a generic toast and a no-op focus",
  );
  assert.match(
    body,
    /setFocus\(leaf\.path as Path<SettingsInput>\)/,
    "an in-section error must focus the offending LEAF field (its dotted path is the registered name) - same intent as the retired router, one level deeper",
  );
  assert.match(
    body,
    /toast\.error\(leaf\.message \|\| "Check the highlighted field before saving"\)/,
    "the in-section toast must carry the leaf's own message, with the generic line only as the fallback",
  );
  assert.match(
    readSrc("apps/cafe/lib/form-errors.test.ts"),
    /appearance\.accentOverride/,
    "lib/form-errors.test.ts must pin the nested-object leaf case the hook relies on",
  );
  // Mutation this catches: silently swallowing an out-of-section error
  // instead of naming where to go — the operator would see nothing at all
  // for a legacy-invalid field elsewhere on the document.
  assert.match(
    body,
    /toast\.error\(`Fix "\$\{owner\?\.title \?\? "another section"\}" first`\)/,
    'the cross-section branch must toast `Fix "<other section title>" first` — never fail silently for an error this page cannot fix',
  );

  // The partition-parity guarantee this replacement leans on (every
  // settingsSchema field belongs to exactly one SETTINGS_SECTIONS entry) is
  // itself pinned, not assumed here — sectionForField cannot resolve a
  // field for onInvalid to route unless every field is covered.
  const parityTestSrc = readSrc(SETTINGS_SECTIONS_TEST);
  assert.match(
    parityTestSrc,
    /Object\.keys\(settingsSchema\.shape\)/,
    "lib/settings-sections.test.ts must pin the partition-parity assertion (union of every section's fields === Object.keys(settingsSchema.shape)) — onInvalid's sectionForField lookup is meaningless without it",
  );
});

test('PIN: no file under components/settings/ or app/(dashboard)/settings/ contains role="tablist"/role="tab" belonging to the retired SettingsForm tab router (excepting the pre-existing, unrelated AppearancePreview/AppearanceSegmentedField colour-scheme widget) — "keep every panel mounted, hidden via a class" is now obsolete BY CONSTRUCTION: one react-hook-form instance per route means there is no sibling panel to keep mounted at all', () => {
  // Needle built by concatenation (testing.md grep-gate rule).
  const roleAttr = "role" + "=";
  const tablistValue = '"' + "tablist" + '"';
  const tabValue = '"' + "tab" + '"';

  const KNOWN_SEGMENTED_CONTROL_FILES = new Set([
    `${SETTINGS_COMPONENTS_DIR}/AppearancePreview.tsx`,
    `${SETTINGS_COMPONENTS_DIR}/AppearanceSegmentedField.tsx`,
  ]);

  const SKIP_DIRS = new Set(["node_modules", ".next"]);
  function walk(dirAbs: string, out: string[]): void {
    for (const entry of readdirSync(dirAbs)) {
      if (SKIP_DIRS.has(entry)) continue;
      const abs = path.join(dirAbs, entry);
      const stat = statSync(abs);
      if (stat.isDirectory()) walk(abs, out);
      else if (/\.tsx?$/.test(entry)) out.push(abs);
    }
  }

  const files: string[] = [];
  walk(path.join(REPO_ROOT, SETTINGS_COMPONENTS_DIR), files);
  walk(path.join(REPO_ROOT, SETTINGS_APP_DIR), files);
  assert.ok(files.length > 5, "the walk must find a substantial number of files, or it found the wrong directory");

  const offenders = files
    .map((abs) => path.relative(REPO_ROOT, abs).split(path.sep).join("/"))
    .filter((rel) => !KNOWN_SEGMENTED_CONTROL_FILES.has(rel))
    .filter((rel) => {
      const src = stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
      return new RegExp(`${roleAttr}${tablistValue}|${roleAttr}${tabValue}`).test(src);
    });

  assert.deepEqual(
    offenders,
    [],
    `no file under components/settings/ or app/(dashboard)/settings/ (outside the known segmented-control exception) may declare role="tablist"/role="tab" — found: ${JSON.stringify(offenders)}`,
  );

  // Positive landmark (vision guard, testing.md): settings/page.tsx must
  // reference SETTINGS_SECTIONS, proving the scan read real, non-empty
  // source rather than passing vacuously on a blinded/empty file list.
  const hubSrc = readSrc(`${SETTINGS_APP_DIR}/page.tsx`);
  assert.match(hubSrc, /SETTINGS_SECTIONS/, "positive landmark: settings/page.tsx must reference SETTINGS_SECTIONS");
});

// ── C — Defect 4 (second half): turning a number toggle off resets its start ─

test("PIN: BillPrintCard.tsx resets billNumberStart to PRINT_NUMBER_START_MIN, with shouldValidate, when its toggle goes off", () => {
  const src = stripComments(readSrc(BILL_PRINT_CARD));
  const toggleIdx = src.indexOf('name="billShowNumber"');
  assert.ok(toggleIdx >= 0, "the billShowNumber toggle must exist");
  const onChangeIdx = src.indexOf("onChange=", toggleIdx);
  assert.ok(onChangeIdx > toggleIdx, "billShowNumber's Controller must define an onChange");
  const scopeEnd = src.indexOf("BillSwitch", onChangeIdx);
  const scope = src.slice(onChangeIdx, scopeEnd > 0 ? scopeEnd : undefined);
  assert.match(scope, /if \(!v\) \{/, "the reset must be gated on the toggle turning OFF");
  assert.match(
    scope,
    /setValue\("billNumberStart",\s*PRINT_NUMBER_START_MIN,\s*\{\s*shouldValidate:\s*true\s*\}\)/,
    "turning the toggle off must reset billNumberStart to the floor with shouldValidate — otherwise a stale invalid value survives in form state where the operator can no longer see or fix it, permanently blocking Save",
  );
});

test("PIN: KotPrintCard.tsx resets kotNumberStart to PRINT_NUMBER_START_MIN, with shouldValidate, when its toggle goes off", () => {
  const src = stripComments(readSrc(KOT_PRINT_CARD));
  const toggleIdx = src.indexOf('name="kotShowNumber"');
  assert.ok(toggleIdx >= 0, "the kotShowNumber toggle must exist");
  const onChangeIdx = src.indexOf("onChange=", toggleIdx);
  assert.ok(onChangeIdx > toggleIdx, "kotShowNumber's Controller must define an onChange");
  const scopeEnd = src.indexOf("showNumber &&", onChangeIdx);
  assert.ok(scopeEnd > onChangeIdx, "the conditional reveal must follow the toggle's onChange");
  const scope = src.slice(onChangeIdx, scopeEnd);
  assert.match(scope, /if \(!v\) \{/, "the reset must be gated on the toggle turning OFF");
  assert.match(
    scope,
    /setValue\("kotNumberStart",\s*PRINT_NUMBER_START_MIN,\s*\{\s*shouldValidate:\s*true\s*\}\)/,
    "turning the toggle off must reset kotNumberStart to the floor with shouldValidate",
  );
});

// ── D — Defect 5: a shared onBlur handler writes the coerced value back ─────
// Fixes the hazard blankToMinStart alone cannot: `setValueAs` silently coerces
// on SUBMIT, so a cleared box still DISPLAYS blank right up until Save. The
// onBlur handler writes the same coercion back into the field immediately, so
// the box visibly becomes PRINT_NUMBER_START_MIN before the operator ever hits
// Save.

test('PIN: BillPrintCard.tsx wires its number-start Input\'s onBlur through makeNumberStartBlurHandler(setValue, "billNumberStart")', () => {
  const src = stripComments(readSrc(BILL_PRINT_CARD));
  assert.match(
    src,
    /makeNumberStartBlurHandler\(setValue,\s*"billNumberStart"\)/,
    "BillPrintCard must build its blur handler from the shared factory, bound to its OWN field name",
  );
  assert.match(
    src,
    /onBlur=\{\(e\) => \{[\s\S]*?handleBillNumberStartBlur\(e\);[\s\S]*?\}\}/,
    "the Input's onBlur must actually call the shared handler, or a cleared box saves the coerced minimum while still DISPLAYING blank",
  );
});

test('PIN: KotPrintCard.tsx wires its number-start Input\'s onBlur through makeNumberStartBlurHandler(setValue, "kotNumberStart")', () => {
  const src = stripComments(readSrc(KOT_PRINT_CARD));
  assert.match(
    src,
    /makeNumberStartBlurHandler\(setValue,\s*"kotNumberStart"\)/,
    "KotPrintCard must build its blur handler from the shared factory, bound to its OWN field name",
  );
  assert.match(
    src,
    /onBlur=\{\(e\) => \{[\s\S]*?handleKotNumberStartBlur\(e\);[\s\S]*?\}\}/,
    "the Input's onBlur must actually call the shared handler",
  );
});
