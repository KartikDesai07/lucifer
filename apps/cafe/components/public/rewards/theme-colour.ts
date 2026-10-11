// CB-7 S4 — reads one of the cafe's appearance tokens (--primary / --primary-foreground, hex, set on :root by the /m
// layout so portals inherit it too) as a plain colour string for canvas drawing, which cannot use a CSS class.
// Client-only (touches getComputedStyle); the fallback covers a token that is missing.

export const FALLBACK_FOIL = "#4b5563";
export const FALLBACK_FOIL_TEXT = "#ffffff";

export function readThemeColour(token: "--primary" | "--primary-foreground", fallback: string, el?: Element): string {
  if (typeof window === "undefined") return fallback;
  const value = window.getComputedStyle(el ?? document.documentElement).getPropertyValue(token).trim();
  return value === "" ? fallback : value;
}
