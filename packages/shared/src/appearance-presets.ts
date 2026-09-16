import type { PresetId } from "./appearance";

// CR2.4 — the 6 shipped Appearance presets + the fixed destructive pair (A18).
// Generic, product-owned names (CLAUDE.md: never hardcode a cafe's identity) —
// a cafe picks one and may layer an accentOverride on top (see appearance.ts).
//
// Hex, not oklch (a documented exception to globals.css's usual palette
// format): WCAG contrast math (appearance-contrast.ts) is defined in sRGB, and
// round-tripping through oklch here would just re-introduce rounding error at
// the one place accuracy actually matters.
//
// Design rule for every palette below: card/muted stay NEUTRAL (never tinted
// toward the accent hue) because food photos sit on them and must never read
// through a color cast; background and card differ by a few points of
// lightness so a card is visibly a card, not indistinguishable from the page.
// Every numeric pairing below is gated by appearance-contrast.test.ts's
// full matrix (§22.5 A18a) — a palette edit that regresses contrast fails
// that test, not this file.

export interface Palette {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  accent: string;
  primary: string;
  primaryForeground: string;
}

interface AppearancePreset {
  label: string;
  light: Palette;
  dark: Palette;
}

export const APPEARANCE_PRESETS: Record<PresetId, AppearancePreset> = {
  classicBistro: {
    label: "Classic Bistro",
    light: {
      background: "#faf7f2", foreground: "#241a12", card: "#ffffff", cardForeground: "#241a12",
      muted: "#efe8de", mutedForeground: "#6b5d4d", border: "#e2d8ca",
      accent: "#8a4a24", primary: "#8a4a24", primaryForeground: "#ffffff",
    },
    dark: {
      background: "#1c1712", foreground: "#f4ede2", card: "#26201a", cardForeground: "#f4ede2",
      muted: "#332b23", mutedForeground: "#c2b3a0", border: "#3d332a",
      accent: "#d68a53", primary: "#d68a53", primaryForeground: "#000000",
    },
  },
  warmTerracotta: {
    label: "Warm Terracotta",
    light: {
      background: "#fbf5f1", foreground: "#2a1a12", card: "#ffffff", cardForeground: "#2a1a12",
      muted: "#f0e0d6", mutedForeground: "#75543f", border: "#e8cebb",
      accent: "#a04a2a", primary: "#a04a2a", primaryForeground: "#ffffff",
    },
    dark: {
      background: "#201410", foreground: "#f7e9df", card: "#2b1c16", cardForeground: "#f7e9df",
      muted: "#3a271e", mutedForeground: "#cba48d", border: "#463024",
      accent: "#e08a52", primary: "#e08a52", primaryForeground: "#000000",
    },
  },
  masalaCharcoal: {
    label: "Masala Charcoal",
    light: {
      background: "#f8f6f5", foreground: "#1e1a1a", card: "#ffffff", cardForeground: "#1e1a1a",
      muted: "#e9e3e2", mutedForeground: "#6b5f5e", border: "#d9d0cf",
      accent: "#7a2530", primary: "#7a2530", primaryForeground: "#ffffff",
    },
    dark: {
      background: "#191616", foreground: "#f2ecea", card: "#231e1e", cardForeground: "#f2ecea",
      muted: "#2e2727", mutedForeground: "#b8aaa8", border: "#3a3232",
      accent: "#d97a86", primary: "#d97a86", primaryForeground: "#000000",
    },
  },
  freshMint: {
    label: "Fresh Mint",
    light: {
      background: "#f5faf7", foreground: "#16211c", card: "#ffffff", cardForeground: "#16211c",
      muted: "#e2ede7", mutedForeground: "#526b60", border: "#cfe0d7",
      accent: "#276a4e", primary: "#276a4e", primaryForeground: "#ffffff",
    },
    dark: {
      background: "#111c17", foreground: "#e9f5ef", card: "#182620", cardForeground: "#e9f5ef",
      muted: "#22332b", mutedForeground: "#a3c2b4", border: "#2c4034",
      accent: "#63c297", primary: "#63c297", primaryForeground: "#000000",
    },
  },
  royalMaroon: {
    label: "Royal Maroon",
    light: {
      background: "#faf5f6", foreground: "#241318", card: "#ffffff", cardForeground: "#241318",
      muted: "#efe0e3", mutedForeground: "#6f4e56", border: "#e2ccd2",
      accent: "#7a1d3a", primary: "#7a1d3a", primaryForeground: "#ffffff",
    },
    dark: {
      background: "#1c1215", foreground: "#f6e9ec", card: "#271a1e", cardForeground: "#f6e9ec",
      muted: "#33232a", mutedForeground: "#c8a5ae", border: "#40292f",
      accent: "#e07d97", primary: "#e07d97", primaryForeground: "#000000",
    },
  },
  sunsetChai: {
    label: "Sunset Chai",
    light: {
      background: "#fbf6ee", foreground: "#2a1d0d", card: "#ffffff", cardForeground: "#2a1d0d",
      muted: "#f1e5cf", mutedForeground: "#7a6438", border: "#e6d2a8",
      accent: "#96591a", primary: "#96591a", primaryForeground: "#ffffff",
    },
    dark: {
      background: "#1f1810", foreground: "#f7ecd8", card: "#2a2015", cardForeground: "#f7ecd8",
      muted: "#3a2d1c", mutedForeground: "#cbb389", border: "#48381f",
      accent: "#e0a13f", primary: "#e0a13f", primaryForeground: "#000000",
    },
  },
};

// A curated, pre-vetted swatch row (§22.1 S5) — NOT derived from the presets'
// own `primary` values, which are tuned to their OWN scheme only and every one
// of them fails checkAccent's both-halves rule (a preset's primary is a deep
// saturated color; checkAccent additionally requires ≥3:1 against the OTHER
// scheme's background/card, which no preset primary clears — see
// appearance-contrast.test.ts's own note on this). Each hex below is a
// mid-tone color independently verified (accentSuggestionsFor's own checkAccent
// filter is defense-in-depth, not how these were chosen) to clear checkAccent
// for its listed presetId — i.e. ≥3:1 against BOTH halves' background AND
// card, and ≥4.5:1 for bestForeground(hex) against the hex itself.
export const SUGGESTED_ACCENTS: Record<PresetId, string[]> = {
  classicBistro: ["#b65535", "#967c2c", "#c6395c", "#3575b6"],
  warmTerracotta: ["#c63939", "#b65535", "#967c2c", "#a339c6"],
  masalaCharcoal: ["#c6395c", "#96612c", "#2c967c", "#3575b6"],
  freshMint: ["#2c9696", "#2c962c", "#af20df", "#c63980"],
  royalMaroon: ["#b63596", "#c6395c", "#96612c", "#306ba6"],
  sunsetChai: ["#967c2c", "#c63939", "#2c7c96", "#c639a3"],
};

// The "error/void/sold-out" pair — fenced OUT of the per-preset Palette on
// purpose (A18b, §5): a theme picker must never be able to make a sold-out
// badge or a destructive confirm button unreadable, or blend it into the
// preset's own accent. One fixed pair per scheme, used by EVERY preset;
// checked against every preset's background/card in appearance-contrast.test.ts.
export const PUBLIC_DESTRUCTIVE: Record<"light" | "dark", { bg: string; fg: string }> = {
  light: { bg: "#b3261e", fg: "#ffffff" },
  dark: { bg: "#f2b8b5", fg: "#601410" },
};
