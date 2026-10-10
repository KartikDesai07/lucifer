// The ready-made colours in the button-colour picker (AppearanceAccentInput),
// 4 per row on the phone grid: blues, teals and greens, warm colours, then
// pinks, purples and a brown. Every one is a MID tone on purpose: the accent
// gate (checkAccent) needs 3:1 against both the light and the dark half of a
// theme AND readable button text on top, so a deep navy or a pale yellow would
// fail on every theme. The test beside it measures each against ALL presets.

export interface AccentSwatch {
  name: string; // spoken to a screen reader (the swatch itself shows no text)
  hex: string; // lowercase #rrggbb, the shape the settings schema stores
}

export const ACCENT_SWATCHES: readonly AccentSwatch[] = [
  { name: "Royal blue", hex: "#2563eb" },
  { name: "Sky blue", hex: "#0284c7" },
  { name: "Ocean", hex: "#0891b2" },
  { name: "Indigo", hex: "#6366f1" },
  { name: "Teal", hex: "#0d9488" },
  { name: "Emerald", hex: "#059669" },
  { name: "Green", hex: "#16a34a" },
  { name: "Slate", hex: "#64748b" },
  { name: "Amber", hex: "#b45309" },
  { name: "Orange", hex: "#ea580c" },
  { name: "Red", hex: "#dc2626" },
  { name: "Rose", hex: "#e11d48" },
  { name: "Pink", hex: "#db2777" },
  { name: "Fuchsia", hex: "#c026d3" },
  { name: "Purple", hex: "#a855f7" },
  { name: "Coffee", hex: "#a0643c" },
];

const HEX_INPUT_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** What the hex field accepts: `#RRGGBB` in any case, with or without the `#`
 *  and stray spaces. Returns the lowercase form the form stores, or null. */
export function normalizeAccentHex(raw: string): string | null {
  const trimmed = raw.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return HEX_INPUT_PATTERN.test(withHash) ? withHash.toLowerCase() : null;
}
