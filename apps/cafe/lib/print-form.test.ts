import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const SETTINGS_FORM = "apps/cafe/components/settings/SettingsForm.tsx";
const BILL_PRINT_CARD = "apps/cafe/components/settings/BillPrintCard.tsx";
const KOT_PRINT_CARD = "apps/cafe/components/settings/KotPrintCard.tsx";

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

test("PIN: SettingsForm.tsx passes onInvalid as handleSubmit's second argument, and onInvalid raises a toast", () => {
  const src = stripComments(readSrc(SETTINGS_FORM));
  assert.match(
    src,
    /handleSubmit\(onSubmit,\s*onInvalid\)/,
    "handleSubmit must be called with an onInvalid second argument — without it, an error on a hidden tab or an unmounted reveal produces NO feedback at all and the page becomes unsavable",
  );
  assert.match(
    src,
    /toast\.error\(/,
    "onInvalid must surface a sonner toast, or the operator still sees nothing when Save silently fails validation",
  );
});

test("PIN: SettingsForm.tsx's onInvalid switches to the tab owning the first errored field, for appearance*, bill*/kot* AND telegram* fields", () => {
  const src = stripComments(readSrc(SETTINGS_FORM));
  const fnStart = src.indexOf("const onInvalid");
  assert.ok(fnStart >= 0, "onInvalid must be defined");
  const fnEnd = src.indexOf("return (", fnStart);
  assert.ok(fnEnd > fnStart, "onInvalid must be defined before the component's return");
  const body = src.slice(fnStart, fnEnd);
  // CR2.4 S5 — appearance is a NESTED subdoc, so a failed superRefine reports
  // one top-level "appearance" key (never "appearance.presetId"); the branch
  // is checked first in source, ahead of bill*/kot*/telegram*.
  assert.match(
    body,
    /firstField\.startsWith\("appearance"\)/,
    "onInvalid must route to the appearance tab for the appearance field",
  );
  const appearanceIdx = body.indexOf('firstField.startsWith("appearance")');
  const billKotIdx = body.indexOf('firstField.startsWith("bill")');
  assert.ok(
    appearanceIdx >= 0 && billKotIdx > appearanceIdx,
    "the appearance branch must be checked BEFORE the bill*/kot* branch",
  );
  assert.match(
    body,
    /firstField\.startsWith\("bill"\) \|\| firstField\.startsWith\("kot"\)/,
    "onInvalid must route to the print tab for any bill*/kot* field — every print field is named that way by convention",
  );
  // CR2.3b §21 S7 — the Telegram tab ("Integrations") joined general/print;
  // every Telegram field is named telegram* and must route there, without
  // weakening the bill*/kot* pin above.
  assert.match(
    body,
    /firstField\.startsWith\("telegram"\)/,
    "onInvalid must route to the integrations tab for any telegram* field",
  );
  assert.match(
    body,
    /"integrations"/,
    "the telegram* branch must land on the integrations tab, not print or general",
  );
  assert.match(body, /setTab\(/, "onInvalid must actually switch tabs, not just report the error");
});

test("PIN: SettingsForm.tsx keeps ALL FOUR tab panels mounted (hidden via a class), never conditionally rendered — unmounting drops react-hook-form's registered values", () => {
  const src = stripComments(readSrc(SETTINGS_FORM));
  assert.match(
    src,
    /className=\{tab === "general" \? "space-y-6" : "hidden"\}/,
    "the general panel must stay mounted, hidden via a class when inactive",
  );
  // CR2.4 S5 — the 4th (Appearance) panel joins general/print/integrations,
  // held to the exact same always-mounted discipline.
  assert.match(
    src,
    /className=\{tab === "appearance" \? "space-y-6" : "hidden"\}/,
    "the appearance panel must stay mounted, hidden via a class when inactive",
  );
  assert.match(
    src,
    /className=\{tab === "print" \? "space-y-6" : "hidden"\}/,
    "the print panel must stay mounted, hidden via a class when inactive",
  );
  // CR2.3b §21 S7 — the third (Integrations) panel is held to the exact same
  // discipline as the original two: mounted always, hidden via class.
  assert.match(
    src,
    /className=\{tab === "integrations" \? "space-y-6" : "hidden"\}/,
    "the integrations panel must stay mounted, hidden via a class when inactive",
  );
  assert.ok(
    !/\{tab === "general" && /.test(src) &&
      !/\{tab === "appearance" && /.test(src) &&
      !/\{tab === "print" && /.test(src) &&
      !/\{tab === "integrations" && /.test(src),
    "no panel may be gated behind a conditional-render (&&) — that unmounts the inactive panel and react-hook-form drops its registered field values, silently resetting that tab's settings on the next save",
  );
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
