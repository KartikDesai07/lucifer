import type { Palette } from "./appearance-presets";
import { APPEARANCE_PRESETS } from "./appearance-presets";

// CR2.4 — WCAG 2.x contrast math, computed exactly per spec (never approximated
// with a perceptual shortcut): every preset palette and every admin-picked
// accentOverride is gated against this, so a cafe can never save a theme that
// prints unreadable text on its own public menu. Pure, DB-free, client-safe.

// Lowercase-only: every stored/preset hex value in this codebase is lowercased
// on the way in (see settings.schema.ts's accentOverride refine), so the
// pattern doesn't accept uppercase — a value that slips through uppercase was
// never normalized and should be treated as invalid, not silently coerced.
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

// WCAG 2.x thresholds: 4.5:1 for normal text, 3:1 for large text/UI elements
// (the accent tint is used as a decorative highlight, never as body text).
export const WCAG_AA_NORMAL = 4.5;
export const WCAG_AA_LARGE = 3;

function linearizeChannel(value255: number): number {
  const c = value255 / 255;
  // WCAG 2.x relative-luminance formula, verbatim (0.03928/12.92 knee).
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` hex color, 0 (black) .. 1 (white). */
export function srgbLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

/** WCAG contrast ratio between two `#rrggbb` colors, 1 (identical) .. 21 (max). */
export function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(srgbLuminance(a), srgbLuminance(b));
  const darker = Math.min(srgbLuminance(a), srgbLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

/** The higher-contrast of black/white text on top of `hex` — used to derive a
 *  readable foreground for an admin-picked accent (or any preset color) rather
 *  than storing a second color the admin never chose. */
export function bestForeground(hex: string): "#000000" | "#ffffff" {
  return contrastRatio("#ffffff", hex) >= contrastRatio("#000000", hex) ? "#ffffff" : "#000000";
}

/** Gates an admin-picked accentOverride against the preset it will render
 *  beside (A6): the derived foreground text must clear WCAG_AA_NORMAL against
 *  the accent itself, and the accent must clear WCAG_AA_LARGE against BOTH the
 *  background and the card of BOTH the light and dark half of that preset — an
 *  override that reads fine in daylight but vanishes on the dark half is still
 *  a rejection. `presetId` is an unchecked `string` (the schema's own
 *  z.enum(PRESET_IDS) already narrows it before this ever runs) so an unknown
 *  id fails closed rather than throwing. `failing` names the exact pair that
 *  lost, e.g. "accent vs dark background: 2.1 < 3". */
export function checkAccent(hex: string, presetId: string): { ok: true } | { ok: false; failing: string } {
  if (!HEX_COLOR_PATTERN.test(hex)) return { ok: false, failing: "accent is not a valid hex color" };
  // Object.hasOwn, never `in` — APPEARANCE_PRESETS is a plain object literal,
  // so `"constructor" in APPEARANCE_PRESETS` is true but not a real preset.
  if (!Object.hasOwn(APPEARANCE_PRESETS, presetId)) {
    return { ok: false, failing: `unknown preset "${presetId}"` };
  }
  const preset = APPEARANCE_PRESETS[presetId as keyof typeof APPEARANCE_PRESETS];

  const textRatio = contrastRatio(bestForeground(hex), hex);
  if (textRatio < WCAG_AA_NORMAL) {
    return { ok: false, failing: `text vs accent: ${textRatio.toFixed(1)} < ${WCAG_AA_NORMAL}` };
  }

  const halves: Array<{ label: "light" | "dark"; palette: Palette }> = [
    { label: "light", palette: preset.light },
    { label: "dark", palette: preset.dark },
  ];
  for (const { label, palette } of halves) {
    const bgRatio = contrastRatio(hex, palette.background);
    if (bgRatio < WCAG_AA_LARGE) {
      return { ok: false, failing: `accent vs ${label} background: ${bgRatio.toFixed(1)} < ${WCAG_AA_LARGE}` };
    }
    const cardRatio = contrastRatio(hex, palette.card);
    if (cardRatio < WCAG_AA_LARGE) {
      return { ok: false, failing: `accent vs ${label} card: ${cardRatio.toFixed(1)} < ${WCAG_AA_LARGE}` };
    }
  }
  return { ok: true };
}
