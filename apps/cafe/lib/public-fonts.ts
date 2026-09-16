import {
  Inter,
  Playfair_Display,
  Lato,
  Quicksand,
  Nunito_Sans,
  Oswald,
  Cormorant_Garamond,
  Baloo_2,
} from "next/font/google";
import type { FontPairKey } from "@pos/shared/appearance";

// CR2.4 S3 — the 8 Google font families behind the 6 diner-facing font pairs
// (@pos/shared/appearance's FontPairKey). Every next/font/google call below
// is a LITERAL, module-scope const with only literal option values — next/font
// rewrites the call at build time, so it can never be built from a loop or a
// lookup table. Every family is subsetted to ["latin"] only: Hindi/Devanagari
// rendering is an explicit CR2.5 device-pass question, never claimed here (A22).
//
// Preload: next/font decides preload links PER BUILD ENTRY, not per font
// actually rendered — this module is imported unconditionally by app/m/layout.tsx,
// so an eager preload on ANY family here ships on every /m render regardless
// of which pair is resolved. All 8 families stay preload:false; Next then
// emits a preconnect instead (still a real head-start), and no diner ever
// downloads a font their cafe's pair doesn't use.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  preload: false,
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
  preload: false,
});

// Lato ships no variable-font axis on Google Fonts (A10) — next/font's own
// type for Lato has no "variable" weight option, so this is the one call here
// that MUST pass an explicit weight array. Never put "variable" inside a
// weight array — the other seven families below stay weightless on purpose;
// that omission is what selects their variable-font axis.
const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["400", "700"],
  preload: false,
});

const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin"],
  preload: false,
});

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  preload: false,
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  preload: false,
});

const cormorantGaramond = Cormorant_Garamond({
  variable: "--font-cormorant-garamond",
  subsets: ["latin"],
  preload: false,
});

const baloo2 = Baloo_2({
  variable: "--font-baloo-2",
  subsets: ["latin"],
  preload: false,
});

// The 6 shipped pairs (display face over the h1, body face over everything
// else) — see appearance.ts's FONT_PAIR_KEYS for the enum this indexes.
// Joins each pair's two .variable classes as one complete static string per
// key (no computed/interpolated lookup) so app/m/layout.tsx can apply it
// directly as a className and Next injects only that pair's @font-face rules.
export const FONT_PAIR_CLASSNAMES: Record<FontPairKey, string> = {
  clean: `${inter.variable} ${inter.variable}`,
  classic: `${playfairDisplay.variable} ${lato.variable}`,
  warm: `${quicksand.variable} ${nunitoSans.variable}`,
  bold: `${oswald.variable} ${inter.variable}`,
  elegant: `${cormorantGaramond.variable} ${lato.variable}`,
  friendly: `${baloo2.variable} ${nunitoSans.variable}`,
};

// The pair's REAL font-family strings (A9) — @pos/shared/appearance's
// appearanceScopedCss emits these at :root as --pub-body-font/--pub-display-font
// so portalled content (Sheet/Drawer/Toaster, A2) inherits the selected pair
// without that package ever needing to know next/font exists.
export const FONT_PAIR_FAMILIES: Record<FontPairKey, { body: string; display: string }> = {
  clean: { body: inter.style.fontFamily, display: inter.style.fontFamily },
  classic: { body: lato.style.fontFamily, display: playfairDisplay.style.fontFamily },
  warm: { body: nunitoSans.style.fontFamily, display: quicksand.style.fontFamily },
  bold: { body: inter.style.fontFamily, display: oswald.style.fontFamily },
  elegant: { body: lato.style.fontFamily, display: cormorantGaramond.style.fontFamily },
  friendly: { body: nunitoSans.style.fontFamily, display: baloo2.style.fontFamily },
};
