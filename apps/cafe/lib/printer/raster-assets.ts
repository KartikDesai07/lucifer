// Asset inlining for the browser raster lane. The slip is drawn into an SVG
// <img> (raster.ts); an SVG image cannot load ANYTHING external, so every font
// file and every <img> the slip uses is turned into a data: URL first. Fetches
// are same-origin (cookies) or CORS-anonymous; anything that cannot be fetched
// is DROPPED (a removed <img> prints the slip without its logo) -- a live
// cross-origin <img> is never drawn, because that is the one path that taints
// the canvas. Pure helpers are Node-loadable (no DOM at module evaluation).

/** Resolves an absolute-or-relative URL to a data: URL, or null when it cannot be had. */
export type AssetFetcher = (url: string) => Promise<string | null>;

/** One asset must arrive within this long, or it is treated as missing. */
export const RASTER_ASSET_TIMEOUT_MS = 8_000;
/** Data URLs kept for the next slip (logo + font files); oldest is evicted past this. */
export const RASTER_ASSET_CACHE_MAX = 16;

const DATA_URL_PREFIX = "data:";
const FETCHABLE_PROTOCOLS: readonly string[] = ["http:", "https:"];

export interface BrowserFetcherEnv {
  fetchFn?: typeof fetch;
  /** The page origin; same-origin assets are fetched with credentials. */
  origin?: string;
  readBlob?: (blob: Blob) => Promise<string | null>;
}

function readBlobAsDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/**
 * A fetcher with its own capped LRU cache (Map insertion order: a hit is
 * re-inserted, the eldest entry is evicted past RASTER_ASSET_CACHE_MAX).
 * Only successes are cached, so a flaky fetch is retried on the next slip.
 */
export function browserAssetFetcher(env: BrowserFetcherEnv = {}): AssetFetcher {
  const cache = new Map<string, string>();
  return async (url) => {
    if (url.startsWith(DATA_URL_PREFIX)) return url;
    const origin = env.origin ?? (typeof location === "undefined" ? "" : location.origin);
    let target: URL;
    try {
      target = new URL(url, origin === "" ? undefined : origin);
    } catch {
      return null;
    }
    if (!FETCHABLE_PROTOCOLS.includes(target.protocol)) return null;
    const hit = cache.get(target.href);
    if (hit !== undefined) {
      cache.delete(target.href);
      cache.set(target.href, hit);
      return hit;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RASTER_ASSET_TIMEOUT_MS);
    try {
      const fetchFn = env.fetchFn ?? globalThis.fetch.bind(globalThis);
      const sameOrigin = target.origin === origin;
      const res = await fetchFn(target.href, {
        signal: controller.signal,
        ...(sameOrigin
          ? { credentials: "same-origin" as const }
          : { mode: "cors" as const, credentials: "omit" as const }),
      });
      if (!res.ok) return null;
      const dataUrl = await (env.readBlob ?? readBlobAsDataUrl)(await res.blob());
      if (dataUrl === null) return null;
      cache.set(target.href, dataUrl);
      if (cache.size > RASTER_ASSET_CACHE_MAX) {
        const eldest = cache.keys().next();
        if (!eldest.done) cache.delete(eldest.value);
      }
      return dataUrl;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

// --- pure CSS helpers ------------------------------------------------------

const FONT_FACE_RE = /@font-face\s*\{[^{}]*\}/gi;
const FONT_FAMILY_DECL_RE = /font-family\s*:\s*([^;}]+)/i;
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi;

/** Every `@font-face { ... }` block in the stylesheet text, in order. */
export function fontFaceBlocks(css: string): string[] {
  return css.match(FONT_FACE_RE) ?? [];
}

function unquoteFamily(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
}

/** Splits `a, "b, c", d` on top-level commas into unquoted lowercase family names. */
function splitFamilies(value: string): string[] {
  const out: string[] = [];
  let quote = "";
  let current = "";
  for (const ch of value) {
    if (quote !== "") {
      if (ch === quote) quote = "";
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map(unquoteFamily).filter((name) => name !== "");
}

/** The set of (lowercase, unquoted) font families named by computed `font-family` values. */
export function usedFontFamilies(values: readonly string[]): Set<string> {
  const used = new Set<string>();
  for (const value of values) for (const name of splitFamilies(value)) used.add(name);
  return used;
}

function faceFamily(block: string): string | null {
  const match = FONT_FAMILY_DECL_RE.exec(block);
  if (match === null) return null;
  return unquoteFamily(match[1] as string);
}

/** The stylesheet with every @font-face block whose family is not in `used` removed. */
export function keepUsedFontFaces(css: string, used: ReadonlySet<string>): string {
  return css.replace(FONT_FACE_RE, (block) => {
    const family = faceFamily(block);
    return family !== null && used.has(family) ? block : "";
  });
}

/** The distinct url() references in a CSS block, as written; data: URLs are skipped. */
export function cssUrlRefs(block: string): string[] {
  const refs = new Set<string>();
  for (const match of block.matchAll(CSS_URL_RE)) {
    const ref = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (ref !== "" && !ref.toLowerCase().startsWith(DATA_URL_PREFIX)) refs.add(ref);
  }
  return [...refs];
}

/** Replaces each url(ref) found in `map` with url("<mapped>"); other references stay as written. */
export function rewriteCssUrls(css: string, map: ReadonlyMap<string, string>): string {
  return css.replace(CSS_URL_RE, (whole, dq?: string, sq?: string, bare?: string) => {
    const ref = (dq ?? sq ?? bare ?? "").trim();
    const mapped = map.get(ref);
    return mapped === undefined ? whole : `url("${mapped}")`;
  });
}

function absoluteUrl(ref: string, base: string): string | null {
  try {
    return new URL(ref, base).href;
  } catch {
    return null;
  }
}

/**
 * Keeps only the @font-face blocks the slip uses and rewrites their font file
 * references to data: URLs. A block none of whose files could be fetched is
 * dropped (the browser would fall through to the next family anyway).
 */
export async function inlineFontFaces(
  css: string,
  used: ReadonlySet<string>,
  fetcher: AssetFetcher,
  base: string,
): Promise<string> {
  const kept = keepUsedFontFaces(css, used);
  const blocks = fontFaceBlocks(kept);
  const rewritten = await Promise.all(
    blocks.map(async (block) => {
      const refs = cssUrlRefs(block);
      const map = new Map<string, string>();
      await Promise.all(
        refs.map(async (ref) => {
          const abs = absoluteUrl(ref, base);
          const data = abs === null ? null : await fetcher(abs).catch(() => null);
          if (data !== null) map.set(ref, data);
        }),
      );
      return refs.length > 0 && map.size === 0 ? "" : rewriteCssUrls(block, map);
    }),
  );
  let index = 0;
  return kept.replace(FONT_FACE_RE, () => rewritten[index++] ?? "");
}

// --- images ----------------------------------------------------------------

/** The slice of an <img> element inlineImages touches (fakes satisfy it in tests). */
export interface ImgLike {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  remove(): void;
}

export interface ImgRootLike {
  querySelectorAll(selector: string): ArrayLike<ImgLike>;
}

/**
 * Points every <img> under `root` at a data: URL and drops srcset/sizes (the
 * browser would otherwise pick a candidate the SVG cannot load). An image whose
 * source is missing, unresolvable or unfetchable is REMOVED. Returns the number
 * removed.
 */
export async function inlineImages(root: ImgRootLike, fetcher: AssetFetcher, base: string): Promise<number> {
  const imgs = Array.from(root.querySelectorAll("img"));
  const removed = await Promise.all(
    imgs.map(async (img) => {
      const src = (img.getAttribute("src") ?? "").trim();
      const abs = src === "" ? null : src.startsWith(DATA_URL_PREFIX) ? src : absoluteUrl(src, base);
      const data = abs === null ? null : await fetcher(abs).catch(() => null);
      if (data === null) {
        img.remove();
        return 1;
      }
      img.setAttribute("src", data);
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
      return 0;
    }),
  );
  return removed.reduce<number>((sum, n) => sum + n, 0);
}
