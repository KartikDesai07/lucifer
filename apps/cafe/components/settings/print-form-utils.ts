import type { FocusEvent } from "react";
import type { UseFormSetValue } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { PRINT_NUMBER_START_MIN } from "@/lib/constants";

// A blank "starts at" field means nothing was typed. Unlike the OPTIONAL
// number fields elsewhere (TableFormSheet's blankToUndefinedNumber),
// bill/kotNumberStart are REQUIRED by the schema, so react-hook-form's
// valueAsNumber (which turns an empty field into NaN — a schema-rejected,
// unactionable error) is replaced with this: blank maps to the documented
// floor instead.
export function blankToMinStart(v: unknown): number {
  if (v === null || v === undefined) return PRINT_NUMBER_START_MIN;
  // Trim BEFORE the blank check: `Number("   ")` is 0, not NaN, so a
  // whitespace-only value would sail past the isFinite guard below and store a
  // 0 start — which the schema then rejects with an error on a field the admin
  // believes is simply empty. Blank is blank however it is spelled.
  const raw = typeof v === "string" ? v.trim() : v;
  if (raw === "") return PRINT_NUMBER_START_MIN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : PRINT_NUMBER_START_MIN;
}

// Print size options (small/normal/large, small/medium/large) are stored
// lowercase; capitalized only for on-screen display in the Select.
export function capitalizePrintOption(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// A cleared "starts at" box otherwise saves blankToMinStart's coercion while
// still DISPLAYING blank — the admin has no way to see what was actually
// stored. On blur, write the same coercion back into the field so the box
// visibly becomes PRINT_NUMBER_START_MIN before Save, instead of silently
// after it. Shared by BillPrintCard and KotPrintCard.
export function makeNumberStartBlurHandler(
  setValue: UseFormSetValue<SettingsInput>,
  name: "billNumberStart" | "kotNumberStart",
) {
  return (e: FocusEvent<HTMLInputElement>) => {
    setValue(name, blankToMinStart(e.target.value), {
      shouldDirty: true,
      shouldValidate: true,
    });
  };
}
