import { Fraunces, Schibsted_Grotesk } from "next/font/google";

// The "Paper & Ink" brand typefaces (2026-09-26). Kept OUT of lib/fonts.ts on
// purpose: that module is imported by the root layout, so anything declared
// there is preloaded on every route. These load only on screens that import
// this file and put `brandFontVariables` on their root — /login first, the
// rest as each screen moves to the brand system.
//
// Choice evidence (measured, not assumed — each font's served TTF GSUB feature
// list was parsed on 2026-09-26):
//   - Schibsted Grotesk HAS `tnum` (tabular figures): prices and times line up
//     in columns, which a POS needs everywhere. IBM Plex Sans and Hanken
//     Grotesk, the other finalists, ship WITHOUT it as served by Google.
//   - Fraunces has NO `tnum`, so it is a DISPLAY face only — greetings,
//     headings, the wordmark. Never put a number or a price in it.

export const brandSans = Schibsted_Grotesk({
  variable: "--font-brand-schibsted",
  subsets: ["latin"],
  display: "swap",
});

export const brandDisplay = Fraunces({
  variable: "--font-brand-fraunces",
  subsets: ["latin"],
  display: "swap",
  // SOFT rounds the serifs' corners — warmer, closer to a menu card than a
  // newspaper; opsz lets large sizes pick the tighter display cut.
  axes: ["SOFT", "opsz"],
});

/** Put on a screen's root element to make font-brand-sans / font-brand-display resolve. */
export const brandFontVariables = `${brandSans.variable} ${brandDisplay.variable}`;
