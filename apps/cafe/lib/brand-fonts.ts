// The "Paper & Ink" brand typefaces (Schibsted Grotesk and Fraunces) were
// replaced by Geist on 2026-10-16: the whole staff app now uses the one face
// that lib/fonts.ts already loads for every route, and font-brand-sans /
// font-brand-display in globals.css resolve to it. This export stays, empty,
// so the screens that put it on their root need no change in this work.

/** Empty on purpose: no brand font is loaded any more. */
export const brandFontVariables = "";
