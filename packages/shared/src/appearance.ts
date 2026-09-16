import { APPEARANCE_PRESETS, PUBLIC_DESTRUCTIVE } from "./appearance-presets";
import { HEX_COLOR_PATTERN, bestForeground } from "./appearance-contrast";

// CR2.4 — the Appearance CONTRACT: the closed enums a cafe can pick from, the
// shipped defaults, and the two pure functions that turn a stored (untrusted)
// value into what the public menu actually renders. Client-safe, DB-free —
// the cafe model (apps/cafe/models/Settings.ts) and the admin form both build
// on this, never restate the enums or the defaults themselves.

export const PRESET_IDS = [
  "classicBistro",
  "warmTerracotta",
  "masalaCharcoal",
  "freshMint",
  "royalMaroon",
  "sunsetChai",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const FONT_PAIR_KEYS = ["clean", "classic", "warm", "bold", "elegant", "friendly"] as const;
export type FontPairKey = (typeof FONT_PAIR_KEYS)[number];

export const CORNER_RADII = ["sharp", "soft", "round"] as const;
export type CornerRadius = (typeof CORNER_RADII)[number];

export const DENSITIES = ["compact", "cosy", "roomy"] as const;
export type Density = (typeof DENSITIES)[number];

export const LOGO_PLACEMENTS = ["left", "center", "hidden"] as const;
export type LogoPlacement = (typeof LOGO_PLACEMENTS)[number];

// Bumped only if a future migration needs to distinguish stored shapes; v1
// never branches on it (decision 22.0.8) — appearanceSchema pins it as a
// z.literal so a stale cached admin bundle saving against a future store 400s
// instead of silently stamping a shape this version doesn't understand.
export const APPEARANCE_SCHEMA_VERSION = 1;

export interface ResolvedAppearance {
  v: typeof APPEARANCE_SCHEMA_VERSION;
  presetId: PresetId;
  // "" = use the preset's own accent (Decision 7's empty-string sentinel,
  // never null/undefined — see the undefined-cannot-clear lesson).
  accentOverride: string;
  fontPairKey: FontPairKey;
  cornerRadius: CornerRadius;
  density: Density;
  logoPlacement: LogoPlacement;
  // "" = no hero image configured.
  heroImage: string;
}

// Same shape, different name at the call site: `AppearanceInput` is what a
// caller HANDS IN (a form draft, a PUT body once Zod-parsed); `ResolvedAppearance`
// is what `resolveAppearance` always HANDS BACK. Every key is required in both
// — appearance itself is optional on Settings, but once present every field is.
export type AppearanceInput = ResolvedAppearance;

export const DEFAULT_APPEARANCE: ResolvedAppearance = {
  v: APPEARANCE_SCHEMA_VERSION,
  presetId: "classicBistro",
  accentOverride: "",
  fontPairKey: "clean",
  cornerRadius: "soft",
  density: "cosy",
  logoPlacement: "left",
  heroImage: "",
};

// ── Enum membership, without leaking Object.prototype keys ───────────────────
// A plain `{ ...record }[value]` or `value in record` lookup is true for
// "constructor"/"toString"/"__proto__" even though neither map ever set them
// (object-literal allow-lists leak prototype keys — the same class of bug
// `isSupportedBrandingType` guards against in lib/branding.ts). `Object.hasOwn`
// is an OWN-property check, so those inherited names correctly miss every one
// of these sets and fall through to the field's default, never throwing.
function membershipOf<T extends string>(values: readonly T[]): Record<T, true> {
  return Object.fromEntries(values.map((value) => [value, true])) as Record<T, true>;
}

const PRESET_ID_MEMBERS = membershipOf(PRESET_IDS);
const FONT_PAIR_KEY_MEMBERS = membershipOf(FONT_PAIR_KEYS);
const CORNER_RADIUS_MEMBERS = membershipOf(CORNER_RADII);
const DENSITY_MEMBERS = membershipOf(DENSITIES);
const LOGO_PLACEMENT_MEMBERS = membershipOf(LOGO_PLACEMENTS);

function pickEnum<T extends string>(value: unknown, members: Record<T, true>, fallback: T): T {
  return typeof value === "string" && Object.hasOwn(members, value) ? (value as T) : fallback;
}

// Re-validated independently of whatever wrote it (layered-gate discipline):
// a Settings document is read back long after the schema that guarded the
// write may have changed, so a stored accentOverride is untrusted data at
// render time, not a re-check of the same gate. Anything that isn't a clean
// `#rrggbb` — including a CSS-injection attempt like
// `"#fff; } :root{background:red}"` — resolves to "" (the preset's own accent)
// rather than being trusted through to appearanceCssVars/appearanceScopedCss.
function resolvedAccentOverride(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed : "";
}

/** Turns an untrusted `Settings.appearance` value into a complete, valid
 *  ResolvedAppearance. TOTAL: never throws, no matter what `raw` is —
 *  `null`/non-object input, and any unrecognized per-field value, both
 *  resolve to that field's documented default. */
export function resolveAppearance(raw: unknown): ResolvedAppearance {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_APPEARANCE };
  }
  const r = raw as Record<string, unknown>;
  return {
    v: APPEARANCE_SCHEMA_VERSION,
    presetId: pickEnum(r.presetId, PRESET_ID_MEMBERS, DEFAULT_APPEARANCE.presetId),
    accentOverride: resolvedAccentOverride(r.accentOverride),
    fontPairKey: pickEnum(r.fontPairKey, FONT_PAIR_KEY_MEMBERS, DEFAULT_APPEARANCE.fontPairKey),
    cornerRadius: pickEnum(r.cornerRadius, CORNER_RADIUS_MEMBERS, DEFAULT_APPEARANCE.cornerRadius),
    density: pickEnum(r.density, DENSITY_MEMBERS, DEFAULT_APPEARANCE.density),
    logoPlacement: pickEnum(r.logoPlacement, LOGO_PLACEMENT_MEMBERS, DEFAULT_APPEARANCE.logoPlacement),
    heroImage: typeof r.heroImage === "string" ? r.heroImage : "",
  };
}

// ── CSS token emission ───────────────────────────────────────────────────────

// cornerRadius/density are closed enums, not free numbers — each maps to one
// literal CSS value via a named lookup (no magic number lands inline at the
// call site).
const CORNER_RADIUS_REM: Record<CornerRadius, string> = {
  sharp: "0.25rem",
  soft: "0.75rem",
  round: "1.5rem",
};
const DENSITY_GAP_REM: Record<Density, string> = {
  compact: "0.5rem",
  cosy: "0.75rem",
  roomy: "1rem",
};
const DENSITY_PAD_REM: Record<Density, string> = {
  compact: "0.5rem",
  cosy: "0.75rem",
  roomy: "1.25rem",
};

type Scheme = "light" | "dark";

/** The complete shadcn-token cover the public surface (including portalled
 *  Sheet/Drawer/Toaster content, A2) reads — not just the palette's own 10
 *  keys. `accentOverride` (A6) replaces `--primary`/`--primary-foreground`
 *  only; `--accent` always stays the preset's own tint. */
export function appearanceCssVars(resolved: ResolvedAppearance, scheme: Scheme): Record<string, string> {
  const palette = APPEARANCE_PRESETS[resolved.presetId][scheme];
  const destructive = PUBLIC_DESTRUCTIVE[scheme];
  const hasOverride = resolved.accentOverride !== "";
  const primary = hasOverride ? resolved.accentOverride : palette.primary;
  const primaryForeground = hasOverride ? bestForeground(resolved.accentOverride) : palette.primaryForeground;

  return {
    "--background": palette.background,
    "--foreground": palette.foreground,
    "--card": palette.card,
    "--card-foreground": palette.cardForeground,
    "--muted": palette.muted,
    "--muted-foreground": palette.mutedForeground,
    "--border": palette.border,
    "--accent": palette.accent,
    "--primary": primary,
    "--primary-foreground": primaryForeground,
    // Derived cover (A5): tokens the public surface reads that the stored
    // Palette doesn't carry its own value for.
    "--input": palette.border,
    "--ring": palette.accent,
    "--secondary": palette.muted,
    "--secondary-foreground": palette.mutedForeground,
    "--accent-foreground": bestForeground(palette.accent),
    "--popover": palette.card,
    "--popover-foreground": palette.cardForeground,
    "--destructive": destructive.bg,
    "--destructive-foreground": destructive.fg,
    "--radius": CORNER_RADIUS_REM[resolved.cornerRadius],
    "--pub-gap": DENSITY_GAP_REM[resolved.density],
    "--pub-pad": DENSITY_PAD_REM[resolved.density],
  };
}

const COLOR_TOKEN_KEYS = [
  "--background", "--foreground", "--card", "--card-foreground",
  "--muted", "--muted-foreground", "--border", "--accent",
  "--primary", "--primary-foreground", "--input", "--ring",
  "--secondary", "--secondary-foreground", "--accent-foreground",
  "--popover", "--popover-foreground", "--destructive", "--destructive-foreground",
] as const;

// Defense in depth, independent of resolveAppearance's own accentOverride
// re-check (layered-gate discipline): this is the SOLE producer of literal
// CSS text (A11), so it re-validates every color token itself rather than
// trusting whatever ResolvedAppearance it was handed — a hand-built object (a
// test, a future caller) gets the same guarantee a real resolveAppearance
// output does. A token that fails HEX_COLOR_PATTERN falls back to the
// preset's own un-overridden value, never to a blank/truncated declaration.
function sanitizedVars(resolved: ResolvedAppearance, scheme: Scheme): Record<string, string> {
  const vars = appearanceCssVars(resolved, scheme);
  const fallback = appearanceCssVars({ ...resolved, accentOverride: "" }, scheme);
  for (const key of COLOR_TOKEN_KEYS) {
    if (!HEX_COLOR_PATTERN.test(vars[key])) vars[key] = fallback[key];
  }
  return vars;
}

function assertSafeFontFamily(value: string): void {
  // Build-time constants only (next/font .style.fontFamily strings, S3) — a
  // violation here is a programmer error, not untrusted input, hence throw
  // rather than fail closed.
  if (/[<>&]/.test(value)) {
    throw new Error(`Unsafe character in font-family string: ${value}`);
  }
}

function declarationsOf(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}:${value};`)
    .join("");
}

/** The SOLE producer of the `/m` style-element text (A11): a `:root{}` block
 *  carrying the light tokens, a matching `@media (prefers-color-scheme:
 *  dark){:root{}}` block, and the body background rule — nothing else in the
 *  app builds this text. Tokens are emitted ONLY on `:root` (never a class),
 *  so they reach portalled content (Sheet/Drawer/Toaster, A2) that mounts
 *  outside the themed wrapper div. */
export function appearanceScopedCss(
  resolved: ResolvedAppearance,
  fontFamilies: { body: string; display: string },
): string {
  assertSafeFontFamily(fontFamilies.body);
  assertSafeFontFamily(fontFamilies.display);

  const fontVars = `--pub-body-font:${fontFamilies.body};--pub-display-font:${fontFamilies.display};`;
  const light = declarationsOf(sanitizedVars(resolved, "light"));
  const dark = declarationsOf(sanitizedVars(resolved, "dark"));

  return (
    `:root{${light}${fontVars}color-scheme:light dark;}` +
    `body{background-color:var(--background);color:var(--foreground);font-family:var(--pub-body-font)}` +
    `@media (prefers-color-scheme: dark){:root{${dark}${fontVars}}}`
  );
}
