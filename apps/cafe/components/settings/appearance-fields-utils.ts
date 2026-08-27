import type { CornerRadius, Density, FontPairKey, LogoPlacement, PresetId } from "@pos/shared/appearance";
import { SUGGESTED_ACCENTS } from "@pos/shared/appearance-presets";
import { checkAccent } from "@pos/shared/appearance-contrast";

// CR2.4 S5 — display-only label maps for the Appearance tab's closed enums.
// The STORED values stay the shared package's own PresetId/FontPairKey/etc.
// enums; these maps only decide what the admin reads on screen, never a
// second copy of the enum itself (AppearanceFields always keys off PRESET_IDS/
// FONT_PAIR_KEYS/CORNER_RADII/DENSITIES/LOGO_PLACEMENTS, never off these maps'
// own key order).

export const FONT_PAIR_LABELS: Record<FontPairKey, string> = {
  clean: "Clean — Inter",
  classic: "Classic — Playfair Display + Lato",
  warm: "Warm — Quicksand + Nunito Sans",
  bold: "Bold — Oswald + Inter",
  elegant: "Elegant — Cormorant Garamond + Lato",
  friendly: "Friendly — Baloo 2 + Nunito Sans",
};

export const CORNER_RADIUS_LABELS: Record<CornerRadius, string> = {
  sharp: "Sharp",
  soft: "Soft",
  round: "Round",
};

export const DENSITY_LABELS: Record<Density, string> = {
  compact: "Compact",
  cosy: "Cosy",
  roomy: "Roomy",
};

export const LOGO_PLACEMENT_LABELS: Record<LogoPlacement, string> = {
  left: "Left",
  center: "Center",
  hidden: "Hidden",
};

// A curated, pre-vetted swatch row (§22.1 S5) instead of a bare color wheel,
// so a tap here can never fail the same Zod gate Save re-checks. Draws from
// packages/shared's SUGGESTED_ACCENTS — NOT the presets' own `primary` values
// (every preset's own primary fails checkAccent's both-halves rule; see that
// constant's comment) — keyed per presetId. The checkAccent filter stays as
// defense-in-depth: it should always pass for a correctly curated list, but a
// future edit to the shared palettes (which checkAccent is gated against)
// must never silently reintroduce a failing suggestion here.
export function accentSuggestionsFor(presetId: PresetId): string[] {
  return SUGGESTED_ACCENTS[presetId].filter((hex) => checkAccent(hex, presetId).ok);
}
