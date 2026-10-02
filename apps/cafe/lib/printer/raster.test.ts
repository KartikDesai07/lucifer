import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  RASTER_ASSET_CACHE_MAX,
  RASTER_ASSET_TIMEOUT_MS,
  browserAssetFetcher,
  cssUrlRefs,
  fontFaceBlocks,
  inlineFontFaces,
  inlineImages,
  keepUsedFontFaces,
  rewriteCssUrls,
  usedFontFamilies,
  type AssetFetcher,
  type ImgLike,
} from "./raster-assets";
import {
  RASTER_FAILED_MESSAGE,
  RASTER_RENDER_TIMEOUT_MS,
  RASTER_TOO_LARGE_MESSAGE,
  slipCanvasSize,
  slipSvg,
  svgDataUrl,
  type SlipSvgParts,
} from "./raster";
import { RASTER_MAX_ROWS } from "./escpos";

// --- CSS helpers -----------------------------------------------------------

const FACE_A = '@font-face { font-family: "Geist"; src: url("/m/a.woff2") format("woff2"); }';
const FACE_B = "@font-face { font-family: __Geist_Mono_9f; src: url(/m/b.woff2) format('woff2'), url(data:font/woff2;base64,AAAA); }";
const FACE_C = "@font-face{font-family:Unused;src:url('/m/c.woff2')}";
const SHEET = `body { color: red; }\n${FACE_A}\n.x { font-family: Geist; }\n${FACE_B}\n${FACE_C}`;

test("fontFaceBlocks: every @font-face block in order, nothing else", () => {
  assert.deepEqual(fontFaceBlocks(SHEET), [FACE_A, FACE_B, FACE_C]);
  assert.deepEqual(fontFaceBlocks("body { margin: 0 }"), []);
});

test("usedFontFamilies: unquotes, lowercases, splits on top-level commas only", () => {
  const used = usedFontFamilies(['"Geist", __Geist_Fallback_9f, ui-sans-serif', "'Fira, Code', monospace"]);
  assert.deepEqual([...used].sort(), ["__geist_fallback_9f", "fira, code", "geist", "monospace", "ui-sans-serif"]);
  assert.equal(usedFontFamilies([]).size, 0);
});

test("keepUsedFontFaces: drops blocks whose family is not used (case-insensitive), keeps the rest of the CSS", () => {
  const out = keepUsedFontFaces(SHEET, new Set(["geist", "__geist_mono_9f"]));
  assert.ok(out.includes(FACE_A) && out.includes(FACE_B));
  assert.ok(!out.includes("Unused"), "unused face dropped");
  assert.ok(out.includes("body { color: red; }") && out.includes(".x { font-family: Geist; }"), "other rules untouched");
  assert.equal(fontFaceBlocks(keepUsedFontFaces(SHEET, new Set())).length, 0);
});

test("cssUrlRefs: quoted, unquoted, single-quoted; data: skipped; deduped", () => {
  assert.deepEqual(cssUrlRefs(FACE_A), ["/m/a.woff2"]);
  assert.deepEqual(cssUrlRefs(FACE_B), ["/m/b.woff2"]);
  assert.deepEqual(cssUrlRefs(FACE_C), ["/m/c.woff2"]);
  assert.deepEqual(cssUrlRefs("a{src:url(/x.woff2),url( '/x.woff2' ),url(DATA:font/woff2;base64,AA)}"), ["/x.woff2"]);
});

test("rewriteCssUrls: mapped refs become quoted data URLs; unmapped and data: stay as written", () => {
  const out = rewriteCssUrls(FACE_B, new Map([["/m/b.woff2", "data:font/woff2;base64,ZZ$&"]]));
  assert.ok(out.includes('url("data:font/woff2;base64,ZZ$&")'), "replacement inserted literally (no $ patterns)");
  assert.ok(out.includes("url(data:font/woff2;base64,AAAA)"), "existing data: url untouched");
  assert.equal(rewriteCssUrls(FACE_A, new Map()), FACE_A);
});

test("inlineFontFaces: keeps used faces inlined, drops unused and unfetchable ones, resolves against base", async () => {
  const asked: string[] = [];
  const fetcher: AssetFetcher = async (url) => {
    asked.push(url);
    return url.endsWith("a.woff2") ? "data:font/woff2;base64,QQ" : null;
  };
  const out = await inlineFontFaces(SHEET, new Set(["geist", "__geist_mono_9f"]), fetcher, "https://pos.example/page");
  assert.deepEqual(asked.sort(), ["https://pos.example/m/a.woff2", "https://pos.example/m/b.woff2"]);
  assert.ok(out.includes('url("data:font/woff2;base64,QQ")'));
  assert.ok(!out.includes("Unused"), "unused family never fetched or kept");
  assert.ok(!out.includes("__Geist_Mono_9f"), "face whose files all failed is dropped");
  assert.ok(out.includes("body { color: red; }"));
});

// --- canvas size -----------------------------------------------------------

test("slipCanvasSize: 300 css px on 576 dots -> scale 1.92; on 384 dots -> 1.28", () => {
  const wide = slipCanvasSize({ width: 300, height: 100 }, 576);
  assert.deepEqual(wide, { cssWidth: 300, scale: 1.92, rows: 192 });
  assert.deepEqual(slipCanvasSize({ width: 300, height: 100 }, 384), { cssWidth: 300, scale: 1.28, rows: 128 });
});

test("slipCanvasSize: an implausible measured width falls back to the paper default", () => {
  assert.equal(slipCanvasSize({ width: 1280, height: 100 }, 576).cssWidth, 300);
  assert.equal(slipCanvasSize({ width: 0, height: 100 }, 384).cssWidth, 210);
});

test("slipCanvasSize: TOO_LARGE boundary at RASTER_MAX_ROWS", () => {
  assert.equal(slipCanvasSize({ width: 576, height: RASTER_MAX_ROWS }, 576).rows, RASTER_MAX_ROWS);
  assert.throws(() => slipCanvasSize({ width: 576, height: RASTER_MAX_ROWS + 1 }, 576), {
    message: RASTER_TOO_LARGE_MESSAGE,
  });
  assert.equal(slipCanvasSize({ width: 300, height: 8333 }, 576).rows, RASTER_MAX_ROWS);
  assert.throws(() => slipCanvasSize({ width: 300, height: 8334 }, 576), { message: RASTER_TOO_LARGE_MESSAGE });
});

test("slipCanvasSize: a non-positive or non-finite height is a plain failure", () => {
  for (const height of [0, -5, NaN, Infinity]) assert.throws(() => slipCanvasSize({ width: 300, height }, 576), { message: RASTER_FAILED_MESSAGE });
});

test("messages are plain English and budgets match the plan", () => {
  assert.equal(RASTER_FAILED_MESSAGE, "Could not prepare the slip for the printer. Print it again.");
  assert.equal(RASTER_TOO_LARGE_MESSAGE, "This slip is too long to print.");
  assert.deepEqual([RASTER_RENDER_TIMEOUT_MS, RASTER_ASSET_TIMEOUT_MS, RASTER_ASSET_CACHE_MAX], [10_000, 8_000, 16]);
});

// --- SVG -------------------------------------------------------------------

const PARTS: SlipSvgParts = {
  dots: 576,
  rows: 192,
  cssWidth: 300,
  scale: 1.92,
  css: ".a{color:#000}",
  bodyXhtml: '<p xmlns="http://www.w3.org/1999/xhtml">Total 100</p>',
  htmlClass: "root-x",
  bodyClass: "body-y",
  htmlStyle: 'font-family:"Geist", mono;font-size:16px',
  bodyStyle: "line-height:24px",
};

test("slipSvg: SVG + XHTML namespaces, dot dimensions, scaled wrapper, white fill, body content", () => {
  const svg = slipSvg(PARTS);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="576" height="192" viewBox="0 0 576 192">'));
  assert.ok(svg.includes('<foreignObject x="0" y="0" width="576" height="192">'));
  assert.ok(svg.includes('xmlns="http://www.w3.org/1999/xhtml"'));
  assert.ok(svg.includes("width:300px;") && svg.includes("transform:scale(1.92);transform-origin:0 0;"));
  assert.ok(svg.includes("background:#fff"));
  assert.ok(svg.includes('class="root-x"') && svg.includes('class="body-y"'));
  assert.ok(svg.includes("Total 100"));
  assert.ok(svg.endsWith("</foreignObject></svg>"));
  assert.ok(svg.includes("font-family:&quot;Geist&quot;, mono;font-size:16px") && !svg.includes('font-family:"Geist"'), "quotes attribute-escaped");
});

test("slipSvg: a literal </style> inside the CSS cannot close the style element; ]]> cannot close the CDATA", () => {
  const svg = slipSvg({ ...PARTS, css: 'a::after{content:"</style><b>x</b>"} b::after{content:"]]>"}' });
  assert.equal(svg.split("</style>").length - 1, 1, "exactly the one real closing tag");
  assert.ok(!svg.includes("</style><b>"));
  assert.equal(svg.split("]]>").length - 1, 2, "one CDATA close for the real end plus one re-opened section");
  assert.ok(svg.includes("]]]]><![CDATA[>"));
});

test("svgDataUrl: data:image/svg+xml prefix; # and % are encoded; the text round-trips", () => {
  const svg = '<svg>fill="#ff0000" 100% \n\r</svg>';
  const url = svgDataUrl(svg);
  assert.ok(url.startsWith("data:image/svg+xml;charset=utf-8,"));
  const body = url.slice("data:image/svg+xml;charset=utf-8,".length);
  assert.ok(!body.includes("#"), "raw # would start a URL fragment and truncate the SVG");
  assert.ok(!/%(?![0-9A-F]{2})/.test(body), "every % begins an escape");
  assert.ok(body.includes("%23ff0000") && body.includes("100%25"));
  assert.equal(decodeURIComponent(body), svg);
});

// --- inlineImages ----------------------------------------------------------

class FakeImg implements ImgLike {
  removed = false;
  attrs: Map<string, string>;
  constructor(attrs: Record<string, string>) { this.attrs = new Map(Object.entries(attrs)); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  remove(): void { this.removed = true; }
}

const rootOf = (imgs: FakeImg[]): { querySelectorAll(selector: string): FakeImg[] } => ({
  querySelectorAll: (selector) => (selector === "img" ? imgs : []),
});

test("inlineImages: src becomes a data URL, srcset/sizes dropped; failures remove the img; returns the removed count", async () => {
  const ok = new FakeImg({ src: "/api/branding/logo?v=1", srcset: "/a.png 1x, /b.png 2x", sizes: "100px" });
  const dead = new FakeImg({ src: "https://cdn.example/logo.png", srcset: "x 1x" });
  const none = new FakeImg({});
  const inline = new FakeImg({ src: "data:image/png;base64,AAA", srcset: "y 2x" });
  const threw = new FakeImg({ src: "/boom.png" });
  const asked: string[] = [];
  const fetcher: AssetFetcher = async (url) => {
    asked.push(url);
    if (url.endsWith("/boom.png")) throw new Error("network");
    return url.includes("/api/branding/") ? "data:image/png;base64,LOGO" : url.startsWith("data:") ? url : null;
  };
  const removed = await inlineImages(rootOf([ok, dead, none, inline, threw]), fetcher, "https://pos.example/print");
  assert.equal(removed, 3);
  assert.equal(ok.removed, false);
  assert.equal(ok.getAttribute("src"), "data:image/png;base64,LOGO");
  assert.equal(ok.getAttribute("srcset"), null);
  assert.equal(ok.getAttribute("sizes"), null);
  assert.equal(dead.removed, true, "unfetchable (null) -> removed, never left pointing at the network");
  assert.equal(none.removed, true, "no src -> removed");
  assert.equal(threw.removed, true, "a throwing fetcher -> removed");
  assert.equal(inline.removed, false);
  assert.equal(inline.getAttribute("srcset"), null);
  assert.ok(asked.includes("https://pos.example/api/branding/logo?v=1"), "relative src resolved against the base");
});

// --- browserAssetFetcher ---------------------------------------------------

const ORIGIN = "https://pos.example";

function fakeFetch(log: Array<{ url: string; init: RequestInit | undefined }>, ok = true): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    log.push({ url: String(input), init });
    return { ok, blob: async () => new Blob(["x"]) } as Response;
  }) as typeof fetch;
}

const readBlob = async (): Promise<string> => "data:application/octet-stream;base64,eA==";

test("browserAssetFetcher: same-origin sends cookies; cross-origin is CORS-anonymous", async () => {
  const log: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = browserAssetFetcher({ fetchFn: fakeFetch(log), origin: ORIGIN, readBlob });
  assert.equal(await fetcher("/api/branding/logo"), "data:application/octet-stream;base64,eA==");
  assert.equal(await fetcher("https://cdn.example/l.png"), "data:application/octet-stream;base64,eA==");
  assert.equal(log[0]?.url, "https://pos.example/api/branding/logo");
  assert.equal(log[0]?.init?.credentials, "same-origin");
  assert.equal(log[0]?.init?.mode, undefined);
  assert.equal(log[1]?.init?.mode, "cors");
  assert.equal(log[1]?.init?.credentials, "omit");
  assert.ok(log[0]?.init?.signal instanceof AbortSignal, "every fetch carries the timeout signal");
});

test("browserAssetFetcher: data: passes through; non-http(s), bad URLs, non-ok responses and throws are null", async () => {
  const log: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = browserAssetFetcher({ fetchFn: fakeFetch(log, false), origin: ORIGIN, readBlob });
  assert.equal(await fetcher("data:image/png;base64,AA"), "data:image/png;base64,AA");
  for (const bad of ["javascript:alert(1)", "blob:https://pos.example/uuid"]) assert.equal(await fetcher(bad), null);
  assert.equal(await fetcher("/missing.png"), null, "404 -> null");
  const boom = (async () => { throw new Error("net"); }) as typeof fetch;
  assert.equal(await browserAssetFetcher({ fetchFn: boom, origin: ORIGIN, readBlob })("/x.png"), null);
  assert.equal(await browserAssetFetcher({ fetchFn: fakeFetch([]), origin: ORIGIN, readBlob: async () => null })("/x.png"), null);
});

test("browserAssetFetcher: successes are cached (LRU, capped); failures are retried", async () => {
  const log: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = browserAssetFetcher({ fetchFn: fakeFetch(log), origin: ORIGIN, readBlob });
  await fetcher("/a.png");
  await fetcher("/a.png");
  assert.equal(log.length, 1, "second read is a cache hit");
  // Fill past the cap while keeping /a.png fresh: it must survive, /b0.png (eldest) must not.
  for (let i = 0; i < RASTER_ASSET_CACHE_MAX; i++) {
    await fetcher(`/b${i}.png`);
    await fetcher("/a.png");
  }
  const before = log.length;
  await fetcher("/a.png");
  assert.equal(log.length, before, "recently used entry survived eviction");
  await fetcher("/b0.png");
  assert.equal(log.length, before + 1, "eldest entry was evicted and is fetched again");

  const failLog: Array<{ url: string; init: RequestInit | undefined }> = [];
  const failing = browserAssetFetcher({ fetchFn: fakeFetch(failLog, false), origin: ORIGIN, readBlob });
  await failing("/n.png");
  await failing("/n.png");
  assert.equal(failLog.length, 2, "a failure is not cached");
});

test("browserAssetFetcher: a hung fetch is aborted after RASTER_ASSET_TIMEOUT_MS and reads as null", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const hung = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const pending = browserAssetFetcher({ fetchFn: hung, origin: ORIGIN, readBlob })("/slow.png");
    mock.timers.tick(RASTER_ASSET_TIMEOUT_MS);
    assert.equal(await pending, null);
  } finally {
    mock.timers.reset();
  }
});

// --- source pins -------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

test("raster.ts: the only canvas draw is the decoded SVG data image; reuses the shared document fences; no console", () => {
  const src = readSrc("apps/cafe/lib/printer/raster.ts");
  assert.equal(src.split("drawImage(").length - 1, 1, "exactly one drawImage");
  assert.ok(src.includes("ctx.drawImage(image, 0, 0, dots, size.rows)"), "...of the decoded SVG image");
  assert.ok(src.includes('data:image/svg+xml;charset=utf-8,'), "positive landmark: the data: SVG url");
  assert.ok(!src.includes("crossOrigin") && !src.includes("createObjectURL"), "no cross-origin or blob image path");
  assert.ok(src.includes('from "../desktop-shell-document"'), "imports the shared fences, no copy");
  assert.ok(src.includes("DESKTOP_PRINT_EMPTY_MESSAGE") && src.includes("printDocumentHasText(") && src.includes("inlineStylesheets("));
  for (const file of ["raster.ts", "raster-assets.ts", "escpos.ts"]) {
    const text = readSrc("apps/cafe/lib/printer/" + file);
    assert.ok(text.length > 500 && !/console[.]/.test(text) && text.split("\n").length <= 300, file + ": loaded, no console, <= 300 lines");
  }
});
