// The DOCUMENT half of the desktop-shell seam (split out of lib/desktop-shell.ts
// for its line budget, 2026-09-11 — owner: a print must NEVER come out blank).
// What the shell receives for one slip, and the two checks that stand between
// a slip and blank paper. Pure string/DOM helpers: no React, no runtime-name
// sniffing (the seam stays capability-keyed).

export const DESKTOP_PRINT_EMPTY_MESSAGE =
  "That slip had nothing to print — open the order and print it again.";

/**
 * Replaces every stylesheet <link> the print iframe loaded with an inline
 * <style> carrying its rules, and drops the <link as="style"> preload copies.
 *
 * react-to-print copies a page's <link rel="stylesheet"> elements into the
 * iframe by ATTRIBUTE (a root-relative `/_next/static/css/<hash>.css` href),
 * so the serialized document used to reach the shell's offscreen window still
 * pointing at the network: a cold, cookie-less print session had to re-fetch
 * the app's CSS on every slip, and a deploy between the tab's load and the
 * print (the old hash is gone) or a flaky link printed an unstyled slip.
 * Inlining removes the print-time network dependency entirely. A sheet whose
 * rules cannot be read (a cross-origin stylesheet) keeps its <link>. Returns
 * the number of sheets inlined; inert on a document without querySelectorAll
 * (the unit tests' minimal fakes).
 */
export function inlineStylesheets(doc: Document): number {
  if (typeof doc.querySelectorAll !== "function") return 0;
  let inlined = 0;
  for (const link of Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'))) {
    const sheet = link.sheet;
    if (!sheet) continue;
    let css = "";
    try {
      for (const rule of Array.from(sheet.cssRules)) css += `${rule.cssText}\n`;
    } catch {
      continue;
    }
    const style = doc.createElement("style");
    style.textContent = css;
    link.replaceWith(style);
    inlined += 1;
  }
  for (const preload of Array.from(doc.querySelectorAll('link[as="style"]'))) preload.remove();
  return inlined;
}

// react-to-print's custom `print` override receives the already-built iframe;
// this turns it into the flat HTML string the shell's IPC channel can carry
// (see lib/print.ts's print-chain comment — the iframe is fully built before
// this runs, and onAfterPrint fires only once the returned promise resolves).
// The charset is declared in the document itself, not only in the data: URL
// the shell builds, so glyphs (₹) never depend on a transport default.
export function serializePrintDocument(iframe: HTMLIFrameElement, title: string | undefined): string {
  const doc = iframe.contentDocument;
  if (!doc) {
    throw new Error("serializePrintDocument: iframe has no contentDocument");
  }
  if (title !== undefined) doc.title = title;
  inlineStylesheets(doc);
  const html = doc.documentElement.outerHTML;
  const withCharset = /<meta[^>]+charset/i.test(html)
    ? html
    : html.replace(/<head[^>]*>/i, (head) => `${head}<meta charset="utf-8">`);
  return "<!DOCTYPE html>" + withCharset;
}

const HEAD_RE = /<head[\s\S]*?<\/head>/gi;
const STYLE_RE = /<style[\s\S]*?<\/style>/gi;
const SCRIPT_RE = /<script[\s\S]*?<\/script>/gi;
const TAG_RE = /<[^>]+>/g;
const BLANK_ENTITY_RE = /&(?:nbsp|#160|#xa0);/gi;

/**
 * True when the serialized document carries visible text in its body. The
 * slip components render their whole body inside `{order && (...)}`, so a
 * surface snapshotted with no order is a styled but EMPTY node — react-to-print
 * clones and prints it happily. This is the last fence before blank paper on
 * the shell path; the page/host bridges refuse the same case before the
 * iframe is ever built.
 */
export function printDocumentHasText(html: string): boolean {
  const text = html
    .replace(HEAD_RE, "")
    .replace(STYLE_RE, "")
    .replace(SCRIPT_RE, "")
    .replace(TAG_RE, "")
    .replace(BLANK_ENTITY_RE, " ")
    .trim();
  return text.length > 0;
}
