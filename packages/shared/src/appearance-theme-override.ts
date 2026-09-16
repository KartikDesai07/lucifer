import type { ResolvedAppearance } from "./appearance";
import { appearanceCssVars } from "./appearance";
import { HEX_COLOR_PATTERN } from "./appearance-contrast";

// CR2 S9 — the diner Account tab's theme OVERRIDE. appearanceScopedCss
// (appearance.ts, NOT edited by this file) already emits a full OS-driven
// palette: a bare `:root{<light>}` block plus a
// `@media (prefers-color-scheme: dark){:root{<dark>}}` block. This module is
// a SEPARATE, additive producer that lets a diner override that OS choice
// on THEIR device — it reuses appearanceCssVars (appearance.ts's own
// exported per-scheme token producer) rather than re-deriving palette math.
//
// Both blocks stay anchored at `:root` (never a class): the cart Drawer, the
// item Sheet and the sonner Toaster all portal to document.body, outside the
// `.pos-public-theme` wrapper div, so only a :root-anchored token reaches
// them. An ATTRIBUTE selector on :root (`:root[data-pub-theme="dark"]`) has
// higher specificity than both the bare `:root` and the media-query `:root`,
// so whichever one this file emits wins in both directions — including
// forcing light while the OS itself prefers dark.

export const DINER_THEME_ATTR = "data-pub-theme";
export const DINER_THEMES = ["system", "light", "dark"] as const;
export type DinerTheme = (typeof DINER_THEMES)[number];

function assertSafeFontFamily(value: string): void {
  // Same programmer-error guard appearanceScopedCss applies to its own
  // font-family strings — build-time constants only, never untrusted input.
  if (/[<>&]/.test(value)) {
    throw new Error(`Unsafe character in font-family string: ${value}`);
  }
}

const COLOR_TOKEN_KEYS = [
  "--background", "--foreground", "--card", "--card-foreground",
  "--muted", "--muted-foreground", "--border", "--accent",
  "--primary", "--primary-foreground", "--input", "--ring",
  "--secondary", "--secondary-foreground", "--accent-foreground",
  "--popover", "--popover-foreground", "--destructive", "--destructive-foreground",
] as const;

// Same defense-in-depth appearance.ts's own (unexported) sanitizedVars
// applies: re-validate every color token as this producer emits it, rather
// than trusting whatever ResolvedAppearance it was handed. A token that
// fails HEX_COLOR_PATTERN falls back to the un-overridden preset value.
function sanitizedVars(resolved: ResolvedAppearance, scheme: "light" | "dark"): Record<string, string> {
  const vars = appearanceCssVars(resolved, scheme);
  const fallback = appearanceCssVars({ ...resolved, accentOverride: "" }, scheme);
  for (const key of COLOR_TOKEN_KEYS) {
    if (!HEX_COLOR_PATTERN.test(vars[key])) vars[key] = fallback[key];
  }
  return vars;
}

function declarationsOf(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}:${value};`)
    .join("");
}

/** The SOLE producer of the diner theme-override `<style>` text. Emits
 *  exactly two attribute-scoped blocks — `:root[data-pub-theme="light"]{}`
 *  and `:root[data-pub-theme="dark"]{}` — never a class selector, and never
 *  touches appearanceScopedCss's own two `:root{}` blocks. */
export function appearanceOverrideCss(
  resolved: ResolvedAppearance,
  fontFamilies: { body: string; display: string },
): string {
  assertSafeFontFamily(fontFamilies.body);
  assertSafeFontFamily(fontFamilies.display);

  const fontVars = `--pub-body-font:${fontFamilies.body};--pub-display-font:${fontFamilies.display};`;
  const light = declarationsOf(sanitizedVars(resolved, "light"));
  const dark = declarationsOf(sanitizedVars(resolved, "dark"));

  return (
    `:root[${DINER_THEME_ATTR}="light"]{${light}${fontVars}}` +
    `:root[${DINER_THEME_ATTR}="dark"]{${dark}${fontVars}}`
  );
}

// The no-flash script: a CONSTANT STRING, never built by template
// interpolation of any runtime value — the server cannot read localStorage,
// so this must run in a plain <script> BEFORE paint. It reads the SAME
// "pos.public.theme.v1" key public-cart-store.ts's readTheme/writeTheme use.
// That store's safeWrite always JSON.stringifies (so a stored "light" is the
// literal bytes `"light"`, quotes included) — JSON.parse mirrors that, and a
// missing key / corrupt JSON / any value other than "light"/"dark" (that
// includes "system") leaves the attribute off so the media query in
// appearanceScopedCss governs, exactly as it does today. Wrapped in
// try/catch: private-mode localStorage access, and JSON.parse on a corrupt
// value, can both throw synchronously.
export const DINER_THEME_SCRIPT =
  "try{" +
  'var t=JSON.parse(localStorage.getItem("pos.public.theme.v1"));' +
  'if(t==="light"||t==="dark"){' +
  'document.documentElement.setAttribute("data-pub-theme",t);' +
  "}" +
  "}catch(e){}";
