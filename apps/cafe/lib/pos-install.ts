import type { MetadataRoute } from "next";
import { APP_NAME } from "@pos/shared/constants";

// CB-1d.2 — installable POS. The web app manifest that lets a counter device
// install the POS as a standalone app (no URL bar) and the icon paths it
// advertises. Pure and React-free so the manifest route, the dashboard layout
// and the DB-free test suites all read ONE contract.
//
// Served from a ROUTE HANDLER under /api (not app/manifest.ts): a root
// `app/manifest.ts` is root-wide static metadata whose <link rel="manifest">
// would land on every route, including public /login and the diner /m flow —
// only the staff dashboard advertises install. Browsers fetch the manifest
// WITHOUT cookies in production (Next only sets crossOrigin="use-credentials"
// on preview deploys), so the route must be auth-free; /api is already outside
// the middleware matcher.
export const MANIFEST_PATH = "/api/manifest";
export const MANIFEST_CONTENT_TYPE = "application/manifest+json";

// Owner decision O2 (2026-09-04): the installed app opens straight on the
// billing screen. A session-expiry redirect to /login must stay INSIDE the
// installed window, so `scope` is the site root, not the manifest's own
// directory (the spec default would be "/api/").
export const MANIFEST_START_URL = "/pos";
export const MANIFEST_SCOPE = "/";
// Explicit `id`: the app's identity stays stable even if start_url changes
// later, so a change is an update, not a second "new app" install.
export const MANIFEST_ID = "/pos";
export const MANIFEST_DISPLAY = "standalone" as const;

// Splash/background approximates the dashboard's light shell (`--background`
// in globals.css is oklch(0.985 0.005 240) ≈ slate-50); theme colour is the
// product mark's navy (lib/branding-default-logo.ts), also painted as the
// title bar of the installed window via the dashboard viewport's themeColor.
export const MANIFEST_BACKGROUND_COLOR = "#f8fafc";
export const MANIFEST_THEME_COLOR = "#0f172a";

// Home-screen labels get clipped by launchers; the spec's guidance for
// short_name is ~12 characters.
export const MANIFEST_SHORT_NAME_MAX = 12;

// Owner decision O1 (2026-09-04): a generic product icon set (always
// installable, never the tenant's arbitrary-size upload). Served from
// public/icons — the middleware matcher excludes `icons/` so a cookie-less
// icon fetch gets bytes, not a 307 to /login. Generated once by
// scripts/gen-pos-icons.mjs from the default product mark.
export const POS_ICON_DIR = "/icons";
export const POS_ICON_SIZE_SMALL_PX = 192;
export const POS_ICON_SIZE_LARGE_PX = 512;
export const APPLE_TOUCH_ICON_SIZE_PX = 180;
export const POS_ICON_192_PATH = `${POS_ICON_DIR}/pos-192.png`;
export const POS_ICON_512_PATH = `${POS_ICON_DIR}/pos-512.png`;
export const POS_ICON_MASKABLE_512_PATH = `${POS_ICON_DIR}/pos-maskable-512.png`;
export const APPLE_TOUCH_ICON_PATH = `${POS_ICON_DIR}/apple-touch-icon.png`;
const PNG_TYPE = "image/png";
const sizes = (px: number): string => `${px}x${px}`;

// A word cut is only taken when it keeps a readable label ("Alpha Test Cafe"
// → "Alpha Test", never "Foo" for "Foo Barbazquxquux"); below this many
// characters the plain hard cut wins.
const SHORT_NAME_WORD_CUT_MIN = 6;

// Launcher labels are cut by VISIBLE character, never by UTF-16 code unit: a
// cut inside a surrogate pair leaves a lone surrogate (renders as a broken
// glyph), and a cut inside a Devanagari base+vowel-sign cluster leaves a broken
// letter — both realistic for a cafe name (review RC1, 2026-09-04). Grapheme
// clusters via Intl.Segmenter where the runtime has it; code points otherwise
// (never splits a pair either way).
function visibleChars(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

export function manifestShortName(name: string): string {
  const full = name.trim();
  const chars = visibleChars(full);
  if (chars.length <= MANIFEST_SHORT_NAME_MAX) return full;
  const hard = chars.slice(0, MANIFEST_SHORT_NAME_MAX).join("");
  if (chars[MANIFEST_SHORT_NAME_MAX] === " ") return hard.trimEnd();
  const wordCut = hard.slice(0, Math.max(hard.lastIndexOf(" "), 0)).trimEnd();
  return wordCut.length >= SHORT_NAME_WORD_CUT_MIN ? wordCut : hard.trimEnd();
}

// hooks/use-wake-lock.ts's ONLY decision, kept pure so it is unit-testable
// without a DOM harness: request the screen lock only when the caller wants
// it (owner decision O4: always while /pos is mounted; PH-5 passes isHost),
// the browser supports it, AND the document is visible — a request while
// hidden rejects with NotAllowedError (MDN), so the hook waits for the next
// visibilitychange instead.
export function shouldRequestWakeLock(input: {
  enabled: boolean;
  supported: boolean;
  visibility: DocumentVisibilityState;
}): boolean {
  return input.enabled && input.supported && input.visibility === "visible";
}

// `name` is the cafe's own restaurantName from Settings (tenant branding rides
// the label, never a hardcoded cafe); blank → the generic product name, so a
// freshly provisioned cluster or a DB-down read still yields a valid manifest.
// Deliberately NO share_target / prefer_related_applications — the POS is not a
// share destination and must never point at a native store listing.
export function buildManifest(name: string): MetadataRoute.Manifest {
  const fullName = name.trim() || APP_NAME;
  return {
    id: MANIFEST_ID,
    name: fullName,
    short_name: manifestShortName(fullName),
    start_url: MANIFEST_START_URL,
    scope: MANIFEST_SCOPE,
    display: MANIFEST_DISPLAY,
    background_color: MANIFEST_BACKGROUND_COLOR,
    theme_color: MANIFEST_THEME_COLOR,
    icons: [
      { src: POS_ICON_192_PATH, sizes: sizes(POS_ICON_SIZE_SMALL_PX), type: PNG_TYPE, purpose: "any" },
      { src: POS_ICON_512_PATH, sizes: sizes(POS_ICON_SIZE_LARGE_PX), type: PNG_TYPE, purpose: "any" },
      { src: POS_ICON_MASKABLE_512_PATH, sizes: sizes(POS_ICON_SIZE_LARGE_PX), type: PNG_TYPE, purpose: "maskable" },
    ],
  };
}
