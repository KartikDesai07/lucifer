"use client";

import { useEffect } from "react";

import { PRINT_FONT_CATALOG } from "@pos/shared/print-fonts";
import { BILL_DESIGN_FACES, KOT_DESIGN_FACES, TOKEN_DESIGN_FACES, templateFaces } from "@/lib/print-template-designs";
import { billTemplateOf, kotTemplateOf, tokenTemplateOf } from "@/lib/print-template-resolve";
import type { Settings } from "@/types";

// Print customization S3 (01-PLAN §2.5 / R4): warm the saved templates' faces into the HTTP cache so the
// react-to-print iframe and the desktop print window find them already fetched. Devanagari is never preloaded
// (the largest file; it loads on demand when a slip carries Devanagari text).

// Any size works: document.fonts.load only needs a valid font shorthand to pick the face.
const PRELOAD_PROBE_SIZE_PX = 16;

/** CSS font shorthands (`500 16px "POS Print Sans"`) for every face the saved bill, KOT and token templates can name. */
export function printFontPreloadDescriptors(settings: Settings | null | undefined): string[] {
  const descriptors = new Set<string>();
  const add = (faces: ReturnType<typeof templateFaces>) => {
    for (const face of faces) {
      const { family, weights } = PRINT_FONT_CATALOG[face];
      for (const weight of weights) descriptors.add(`${weight} ${PRELOAD_PROBE_SIZE_PX}px "${family}"`);
    }
  };
  const bill = billTemplateOf(settings);
  if (bill) add(templateFaces(bill, BILL_DESIGN_FACES[bill.design], false));
  const kot = kotTemplateOf(settings);
  if (kot) add(templateFaces(kot, KOT_DESIGN_FACES[kot.design], false));
  // The token slip (S7) has no legacy fallback, so its faces are warmed once tokens are on or a design is stored. With
  // tokens off and none stored the list is exactly what it was.
  if (settings?.tokenEnabled === true || (settings?.tokenTemplate !== undefined && settings.tokenTemplate !== null)) {
    const token = tokenTemplateOf(settings);
    add(templateFaces(token, TOKEN_DESIGN_FACES[token.design], false));
  }
  return [...descriptors];
}

export function usePrintFontsPreload(settings: Settings | null | undefined): void {
  const key = printFontPreloadDescriptors(settings).join("\n");
  useEffect(() => {
    if (!key || typeof document === "undefined" || !("fonts" in document)) return;
    for (const descriptor of key.split("\n")) {
      // A failed preload only means the print falls back to the stack's next family, as before.
      document.fonts.load(descriptor).catch(() => {});
    }
  }, [key]);
}
