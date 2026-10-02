// Browser rasterizer for the printer lanes: the drawn slip (react-to-print's
// iframe) -> RGBA pixels exactly `dots` wide, ready for rasterizeRgba. Same
// goal as apps/desktop/src/print-direct.ts (a bitmap as tall as the ink), but
// made inside the page: the slip is drawn into an SVG <foreignObject> that is
// loaded as a DATA: url, then painted onto a canvas. A data: SVG is
// origin-clean, so the canvas is never tainted and getImageData always works.
// Fonts and images are inlined first (raster-assets.ts); a live cross-origin
// <img> is never drawn. Pure functions here are Node-loadable.
import { DESKTOP_PRINT_EMPTY_MESSAGE, inlineStylesheets, printDocumentHasText } from "../desktop-shell-document";
import { RASTER_MAX_ROWS, usableSlipCssWidth } from "./escpos";
import {
  browserAssetFetcher,
  inlineFontFaces,
  inlineImages,
  usedFontFamilies,
  type AssetFetcher,
} from "./raster-assets";

/** Decode + draw of the slip image must finish within this long. */
export const RASTER_RENDER_TIMEOUT_MS = 10_000;
export const RASTER_FAILED_MESSAGE = "Could not prepare the slip for the printer. Print it again.";
export const RASTER_TOO_LARGE_MESSAGE = "This slip is too long to print.";

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_DATA_URL_PREFIX = "data:image/svg+xml;charset=utf-8,";
const PAPER_WHITE = "#fff";
// The font properties copied from the iframe's html/body onto the wrapper
// divs: selectors on html/body/:host do not match inside the SVG document.
const COPIED_STYLE_PROPS = ["font-family", "line-height", "font-size", "color", "letter-spacing"] as const;
const OWN_MESSAGES: ReadonlySet<string> = new Set([
  DESKTOP_PRINT_EMPTY_MESSAGE,
  RASTER_FAILED_MESSAGE,
  RASTER_TOO_LARGE_MESSAGE,
]);

export interface SlipBox {
  width: number;
  height: number;
}

export interface SlipCanvasSize {
  /** The slip's CSS width actually used (measured, or the paper default). */
  cssWidth: number;
  /** Device dots per CSS px, so the bitmap comes out `dots` wide. */
  scale: number;
  rows: number;
}

/** Everything slipSvg needs; strings are raw (escaping happens inside). */
export interface SlipSvgParts extends SlipCanvasSize {
  dots: number;
  /** Stylesheet text (fonts already inlined). */
  css: string;
  /** The slip body as well-formed XHTML. */
  bodyXhtml: string;
  htmlClass: string;
  bodyClass: string;
  /** Copied font declarations, e.g. `font-family:Geist;font-size:16px`. */
  htmlStyle: string;
  bodyStyle: string;
}

export interface RasterPixels {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface RasterDeps {
  fetcher: AssetFetcher;
  /** Loads the SVG data URL as an image (must settle within timeoutMs). */
  loadImage: (url: string, timeoutMs: number) => Promise<HTMLImageElement>;
}

/**
 * The slip's box in CSS px. The body is shrink-wrapped (inline-block, margin 0)
 * first: react-to-print sizes its iframe to the PARENT viewport, so a slip
 * wrapped in a full-width block (the end-of-day source) would otherwise
 * measure as the viewport, not as the 300px slip (plan F12).
 */
export function measureSlipBox(doc: Document): SlipBox {
  const body = doc.body;
  body.style.setProperty("display", "inline-block", "important");
  body.style.setProperty("margin", "0", "important");
  const rect = body.getBoundingClientRect();
  return { width: rect.width, height: Math.max(Math.ceil(rect.height), body.scrollHeight) };
}

/** Canvas geometry for a measured slip; throws RASTER_TOO_LARGE_MESSAGE past RASTER_MAX_ROWS. */
export function slipCanvasSize(box: SlipBox, dots: number): SlipCanvasSize {
  if (!Number.isFinite(box.height) || box.height <= 0) throw new Error(RASTER_FAILED_MESSAGE);
  const cssWidth = usableSlipCssWidth(box.width, dots);
  const scale = dots / cssWidth;
  const rows = Math.ceil(box.height * scale);
  if (rows > RASTER_MAX_ROWS) throw new Error(RASTER_TOO_LARGE_MESSAGE);
  return { cssWidth, scale, rows };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** CSS text safe inside <style><![CDATA[ ]]></style> in an XML document. */
function escapeStyleText(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style").replace(/\]\]>/g, "]]]]><![CDATA[>");
}

/**
 * The SVG document for one slip: dot-sized, with the slip laid out at its CSS
 * width inside an XHTML div scaled by `scale`, so the browser rasterizes it at
 * dot resolution (crisp text, not an upscaled bitmap). Pure.
 */
export function slipSvg(parts: SlipSvgParts): string {
  const box = `width="${parts.dots}" height="${parts.rows}"`;
  const outer =
    `width:${parts.cssWidth}px;margin:0;background:${PAPER_WHITE};` +
    `transform:scale(${parts.scale});transform-origin:0 0;${parts.htmlStyle}`;
  return (
    `<svg xmlns="${SVG_NS}" ${box} viewBox="0 0 ${parts.dots} ${parts.rows}">` +
    `<foreignObject x="0" y="0" ${box}>` +
    `<div xmlns="${XHTML_NS}" class="${escapeAttr(parts.htmlClass)}" style="${escapeAttr(outer)}">` +
    `<style><![CDATA[${escapeStyleText(parts.css)}]]></style>` +
    `<div class="${escapeAttr(parts.bodyClass)}" style="${escapeAttr(`margin:0;${parts.bodyStyle}`)}">` +
    `${parts.bodyXhtml}</div></div></foreignObject></svg>`
  );
}

/** An SVG document as a data: URL; `%` and `#` (and line breaks) would otherwise end or corrupt it. */
export function svgDataUrl(svg: string): string {
  const encoded = svg.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return SVG_DATA_URL_PREFIX + encoded;
}

function copiedDecls(style: CSSStyleDeclaration): string {
  return COPIED_STYLE_PROPS.map((prop) => `${prop}:${style.getPropertyValue(prop)}`).join(";");
}

function loadSvgImage(url: string, timeoutMs: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error(RASTER_FAILED_MESSAGE)), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error(RASTER_FAILED_MESSAGE));
    };
    img.src = url;
  });
}

let sharedFetcher: AssetFetcher | null = null;
function defaultDeps(): RasterDeps {
  sharedFetcher ??= browserAssetFetcher();
  return { fetcher: sharedFetcher, loadImage: loadSvgImage };
}

async function rasterizeDocument(doc: Document, win: Window, dots: number, deps: RasterDeps): Promise<RasterPixels> {
  const size = slipCanvasSize(measureSlipBox(doc), dots);
  const families = Array.from(doc.querySelectorAll("*"), (el) => win.getComputedStyle(el).fontFamily);
  const sheetText = Array.from(doc.querySelectorAll("style"), (el) => el.textContent ?? "").join("\n");
  const css = await inlineFontFaces(sheetText, usedFontFamilies(families), deps.fetcher, doc.baseURI);
  const clone = doc.body.cloneNode(true) as HTMLElement;
  for (const el of Array.from(clone.querySelectorAll("script, style"))) el.remove();
  await inlineImages(clone, deps.fetcher, doc.baseURI);
  const serializer = new XMLSerializer();
  const bodyXhtml = Array.from(clone.childNodes, (node) => serializer.serializeToString(node)).join("");
  const svg = slipSvg({
    ...size,
    dots,
    css,
    bodyXhtml,
    htmlClass: doc.documentElement.className,
    bodyClass: doc.body.className,
    htmlStyle: copiedDecls(win.getComputedStyle(doc.documentElement)),
    bodyStyle: copiedDecls(win.getComputedStyle(doc.body)),
  });
  const image = await deps.loadImage(svgDataUrl(svg), RASTER_RENDER_TIMEOUT_MS);
  const canvas = document.createElement("canvas");
  canvas.width = dots;
  canvas.height = size.rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error(RASTER_FAILED_MESSAGE);
  ctx.fillStyle = PAPER_WHITE;
  ctx.fillRect(0, 0, dots, size.rows);
  ctx.drawImage(image, 0, 0, dots, size.rows);
  const data = ctx.getImageData(0, 0, dots, size.rows);
  return { pixels: data.data, width: dots, height: size.rows };
}

/**
 * Rasterizes the already-built print iframe to RGBA pixels `dots` wide. Fails
 * with the blank-slip sentence, RASTER_TOO_LARGE_MESSAGE, or the generic
 * RASTER_FAILED_MESSAGE -- never with a browser-worded error.
 */
export async function rasterizePrintIframe(
  iframe: HTMLIFrameElement,
  dots: number,
  deps: RasterDeps = defaultDeps(),
): Promise<RasterPixels> {
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !doc.body || !win) throw new Error(RASTER_FAILED_MESSAGE);
  try {
    inlineStylesheets(doc);
    // The blank fence: a styled but EMPTY node must never feed blank paper.
    if (!printDocumentHasText(doc.documentElement.outerHTML)) throw new Error(DESKTOP_PRINT_EMPTY_MESSAGE);
    return await rasterizeDocument(doc, win, dots, deps);
  } catch (error) {
    if (error instanceof Error && OWN_MESSAGES.has(error.message)) throw error;
    throw new Error(RASTER_FAILED_MESSAGE);
  }
}
