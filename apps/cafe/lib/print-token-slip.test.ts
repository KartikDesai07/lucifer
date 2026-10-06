import { FIXED_NOW_MS, classTokens, qrCount, rootAttrs, styleFamilyLists } from "./print-template-matrix.fixtures"; // FIRST: it selects React's production renderer before react loads
import { orderOf, settingsOf } from "./print-template-golden.fixtures";
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TOKEN_BLOCK_TYPES, TOKEN_DESIGNS, type TokenBlock, type TokenBlockType, type TokenTemplate } from "@pos/shared/print-template";
import { PRINT_FONT_CATALOG, SLIP_DEVANAGARI_RE } from "@pos/shared/print-fonts";
import { PAPER_WIDTHS } from "@/lib/constants";
import { PAPER_WIDTH_CLASS } from "@/lib/print";
import { TOKEN_DEFAULT_DESIGN, TOKEN_DESIGN_FACES, BILL_DESIGN_FACES, KOT_DESIGN_FACES, defaultBillTemplate, defaultTokenTemplate, templateFaces } from "@/lib/print-template-designs";
import { billTemplateOf, kotTemplateOf } from "@/lib/print-template-resolve";
import { printFontPreloadDescriptors } from "@/hooks/use-print-fonts-preload";
import { settingsNeedSlipCode } from "@/hooks/use-slip-code-pending";
import { PrintSources } from "@/components/pos/PrintSources";
import { TokenSlip } from "@/components/print/slip/TokenSlip";
import { loadSlipCode } from "@/components/print/slip/slip-code";
import { BAND_NUMBER_SIZES_PX, BIG_NUMBER_SIZES_PX, TOKEN_BAND_TEXT, TOKEN_LABEL_TEXT, TOKEN_MESSAGE_TEXT, tokenNumberSizePx } from "@/components/print/slip/token-blocks";
import type { Order, Settings } from "@/types";

// Print customization S7 Slice C: the token slip, rendered through the REAL TokenSlip (both designs x 58/80 mm), plus
// the byte-identical-OFF pins (PrintSources, the font preload). It reads markup, not source; the one source read is the
// "literal classes" scan, as the matrix suite does for the bill and the kitchen ticket.

before(() => loadSlipCode()); // the QR encoder is the one lazy part of a token slip (R6); preload it the way the matrix suites do
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS }));
after(() => mock.timers.reset());

const TOKEN_NO = 4417;
const ORDER: Order = orderOf({ over: { tokenNumber: TOKEN_NO } }); // billNumber 12, Masala Chai x2 ...
const LINK = "https://example.com/menu";
const withTemplate = (template: unknown, over: Partial<Settings> = {}): Settings => settingsOf({ ...over, tokenTemplate: template });
const slip = (order: Order | null, settings: Settings | null, banner?: string): string => renderToStaticMarkup(createElement(TokenSlip, { order, settings, banner }));
const text = (html: string): string => html.replace(/<[^>]*>/g, "").trim();
const CORPUS: string[] = [];
const rendered = (order: Order | null, settings: Settings | null, banner?: string): string => {
  const html = slip(order, settings, banner);
  CORPUS.push(html);
  return html;
};
const tpl = (design: (typeof TOKEN_DESIGNS)[number], blocks?: TokenBlock[]): TokenTemplate => {
  const base = defaultTokenTemplate(design);
  return { ...base, blocks: blocks ?? base.blocks };
};
const fontSizes = (html: string): number[] => [...html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));

test("both designs x 58/80 mm render a non-empty slip carrying the number, at the paper's own width", () => {
  for (const design of TOKEN_DESIGNS) for (const paper of PAPER_WIDTHS) {
    const html = rendered(ORDER, withTemplate(tpl(design), { billPaperWidth: paper }));
    const label = `${design} ${paper}`;
    assert.ok(text(html).includes(String(TOKEN_NO)), `${label}: the number prints`);
    assert.ok(text(html).includes("Test Cafe") && text(html).includes(TOKEN_MESSAGE_TEXT), `${label}: the name and the message print`);
    assert.ok(rootAttrs(html).classes.includes(PAPER_WIDTH_CLASS[paper]), `${label}: laid out at ${paper}`);
  }
  assert.ok(text(rendered(ORDER, withTemplate(tpl("bigNumber")))).includes(TOKEN_LABEL_TEXT), "landmark: Big Number's label");
  assert.ok(rendered(ORDER, withTemplate(tpl("numberItems"))).includes(`>${TOKEN_BAND_TEXT}<`), "landmark: Number + Items' band word");
});

test("the root is as wide as the BILL paper, never the kitchen ticket's (kot != bill fixture)", () => {
  for (const design of TOKEN_DESIGNS) for (const [bill, kot] of [["58mm", "80mm"], ["80mm", "58mm"]] as const) {
    const classes = rootAttrs(rendered(ORDER, withTemplate(tpl(design), { billPaperWidth: bill, kotPaperWidth: kot }))).classes;
    assert.ok(classes.includes(PAPER_WIDTH_CLASS[bill]), `${design}: bill ${bill} / kot ${kot}: the bill's width`);
    assert.ok(!classes.includes(PAPER_WIDTH_CLASS[kot]), `${design}: ...and not the kitchen ticket's`);
  }
  assert.notEqual(PAPER_WIDTH_CLASS["58mm"], PAPER_WIDTH_CLASS["80mm"], "landmark: the two widths differ");
});

test("the number's own line is locked ON: it prints with every block (it included) switched off, and the other lines do not", () => {
  for (const design of TOKEN_DESIGNS) {
    const off = tpl(design).blocks.map((b) => ({ ...b, on: false }));
    const html = rendered(ORDER, withTemplate(tpl(design, off)));
    assert.ok(text(html).includes(String(TOKEN_NO)), `${design}: the number still prints`);
    assert.ok(!text(html).includes("Test Cafe") && !text(html).includes(TOKEN_MESSAGE_TEXT), `${design}: no other line does`);
    assert.ok(rendered(ORDER, withTemplate(tpl(design))).includes("Test Cafe"), `${design}: landmark: they do print when on`);
    // The number's block can also be missing from a stored document: it comes back, still locked.
    const without = tpl(design).blocks.filter((b) => b.type !== "tokenNo");
    assert.ok(text(rendered(ORDER, withTemplate(tpl(design, without)))).includes(String(TOKEN_NO)), `${design}: a template with no number line still prints it`);
  }
});

test("no template stored prints Big Number (owner decision); so does a stored one that cannot be read", () => {
  assert.equal(TOKEN_DEFAULT_DESIGN, "bigNumber");
  const stored = rendered(ORDER, withTemplate(defaultTokenTemplate("bigNumber")));
  assert.equal(rendered(ORDER, settingsOf()), stored, "no tokenTemplate = the stored Big Number default, byte for byte");
  assert.equal(rendered(ORDER, settingsOf({ tokenTemplate: null })), stored, "null likewise");
  assert.ok(text(rendered(ORDER, null)).includes(String(TOKEN_NO)), "landmark: no settings at all still prints the number");
  assert.notEqual(rendered(ORDER, withTemplate(defaultTokenTemplate("numberItems"))), stored, "landmark: the other design renders differently");
  const good = defaultTokenTemplate("bigNumber");
  for (const bad of ["garbage", 7, [], {}, { ...good, design: "classic" }, { ...good, font: "comicSans" }, { ...good, v: 99 }, { ...good, blocks: [{ id: "x", type: "kotNo", on: true }] }]) {
    assert.equal(rendered(ORDER, withTemplate(bad)), stored, `unreadable ${JSON.stringify(bad).slice(0, 60)} prints Big Number`);
  }
});

const BLOCK_CASES: Record<TokenBlockType, { block: TokenBlock; needle: (html: string) => boolean }> = {
  name: { block: { id: "name", type: "name", on: true }, needle: (h) => text(h).includes("Test Cafe") },
  logo: { block: { id: "logo", type: "logo", on: true, options: { logoSize: "small" } }, needle: (h) => h.includes('alt="Logo"') },
  tokenNo: { block: { id: "tokenNo", type: "tokenNo", on: true }, needle: (h) => text(h).includes(String(TOKEN_NO)) },
  label: { block: { id: "label", type: "label", on: true }, needle: (h) => text(h).includes(TOKEN_LABEL_TEXT) },
  dateTime: { block: { id: "dateTime", type: "dateTime", on: true }, needle: (h) => /04 Oct/.test(text(h)) },
  items: { block: { id: "items", type: "items", on: true }, needle: (h) => text(h).includes("2 × Masala Chai") && /\d+ items/.test(text(h)) },
  message: { block: { id: "message", type: "message", on: true }, needle: (h) => text(h).includes(TOKEN_MESSAGE_TEXT) },
  qr: { block: { id: "qr-9", type: "qr", on: true, options: { content: "link", url: LINK, caption: "Menu here" } }, needle: (h) => qrCount(h) === 1 && text(h).includes("Menu here") },
  divider: { block: { id: "divider-9", type: "divider", on: true, options: { style: "solid" } }, needle: (h) => h.includes("border-solid") },
  customText: { block: { id: "customText-9", type: "customText", on: true, options: { text: "Wifi: cafe123" } }, needle: (h) => text(h).includes("Wifi: cafe123") },
};

test("every token block type prints in each design: ON adds its line, absent does not", () => {
  assert.deepEqual(Object.keys(BLOCK_CASES).sort(), [...TOKEN_BLOCK_TYPES].sort(), "landmark: the table covers the whole catalog");
  for (const design of TOKEN_DESIGNS) for (const type of TOKEN_BLOCK_TYPES) {
    const { block, needle } = BLOCK_CASES[type];
    const base = tpl(design).blocks.filter((b) => b.type !== type);
    const message = base.findIndex((b) => b.type === "message");
    const on = type === "tokenNo" ? tpl(design).blocks : [...base.slice(0, message), block, ...base.slice(message)];
    const settings = (blocks: TokenBlock[]): Settings => withTemplate(tpl(design, blocks));
    const html = rendered(ORDER, settings(on));
    assert.ok(needle(html), `${design} ${type}: prints when on`);
    // tokenNo is locked: its "absent" slip still prints the number (the lock test above); every other type must not.
    if (type !== "tokenNo") assert.ok(!needle(rendered(ORDER, settings(base))), `${design} ${type}: absent when the block is not in the template`);
    if (type !== "tokenNo") assert.notEqual(html, rendered(ORDER, settings(base)), `${design} ${type}: the markup differs`);
  }
});

test("a QR line with an unsafe link prints nothing (the lazy encoder is in, so it is the link rule that stops it)", () => {
  const { block } = BLOCK_CASES.qr;
  for (const design of TOKEN_DESIGNS) {
    const mk = (url: string): string => rendered(ORDER, withTemplate(tpl(design, [...tpl(design).blocks, { ...block, options: { content: "link", url } } as TokenBlock])));
    assert.equal(qrCount(mk(LINK)), 1, `${design}: landmark: a safe https link prints a code`);
    for (const url of ["http://example.com/menu", "javascript:alert(1)", "https://exa mple.com", "", "ftp://example.com/x", "https://example.com/​"]) assert.equal(qrCount(mk(url)), 0, `${design}: ${JSON.stringify(url)} prints no code`);
  }
});

test("\"· Bill n\" prints only while Show bill number is on AND the order has a bill number", () => {
  const html = (order: Order, over: Partial<Settings>): string => text(rendered(order, withTemplate(tpl("bigNumber"), over)));
  assert.ok(html(ORDER, { billShowNumber: true }).includes("· Bill 12"), "landmark: on + numbered");
  assert.ok(!html(ORDER, { billShowNumber: false }).includes("Bill"), "switch off: no bill number, even though the order has one");
  assert.ok(!html({ ...ORDER, billNumber: undefined }, { billShowNumber: true }).includes("Bill"), "unnumbered order: nothing");
  assert.ok(html({ ...ORDER, billNumber: undefined }, { billShowNumber: true }).includes("04 Oct 2026"), "landmark: the date line itself still prints");
});

test("the number steps DOWN with its digit count: monotonic, every step <= the 1-digit size, 7 digits get a smaller step, none overflows its line", () => {
  const CONTENT_PX = { "58mm": 186, "80mm": 276 }; // 210 / 300 px minus the slip's p-3
  const BAND_CONTENT_PX = { "58mm": 166, "80mm": 256 }; // the same, inside the band's px-2.5
  const DIGIT_EM = 0.75; // the source's own stated (conservative) advance of the display face; the real glyph metric is not measured here
  for (const [name, sizes, width] of [["bigNumber", BIG_NUMBER_SIZES_PX, CONTENT_PX], ["numberItems", BAND_NUMBER_SIZES_PX, BAND_CONTENT_PX]] as const) {
    for (const paper of PAPER_WIDTHS) {
      const steps = sizes[paper];
      assert.ok(steps.length >= 7, `${name} ${paper}: a step for up to 7 digits`);
      for (let i = 1; i < steps.length; i++) assert.ok(steps[i] <= steps[i - 1], `${name} ${paper}: step ${i + 1} <= step ${i}`);
      assert.ok(steps.every((s) => s <= steps[0]), `${name} ${paper}: no step above the 1-digit size`);
      assert.ok(tokenNumberSizePx(sizes, paper, 7) < tokenNumberSizePx(sizes, paper, 1), `${name} ${paper}: a 7-digit number is smaller than a 1-digit one`);
      assert.equal(tokenNumberSizePx(sizes, paper, 99), steps[steps.length - 1], `${name} ${paper}: a longer number takes the last step`);
      assert.equal(tokenNumberSizePx(sizes, paper, 0), steps[0], `${name} ${paper}: no digits clamps to the first`);
      for (let digits = 1; digits <= steps.length; digits++) assert.ok(digits * DIGIT_EM * steps[digits - 1] <= width[paper], `${name} ${paper}: ${digits} digits fit ${width[paper]} px`);
      const one = fontSizes(rendered({ ...ORDER, tokenNumber: 7 }, withTemplate(tpl(name), { billPaperWidth: paper })));
      const seven = fontSizes(rendered({ ...ORDER, tokenNumber: 9999999 }, withTemplate(tpl(name), { billPaperWidth: paper })));
      assert.deepEqual(one, [steps[0]], `${name} ${paper}: the rendered 1-digit size`);
      assert.deepEqual(seven, [tokenNumberSizePx(sizes, paper, 7)], `${name} ${paper}: the rendered 7-digit size`);
    }
  }
});

test("faces: at most 4 per slip, Devanagari included, and the markup names only those families", () => {
  const devanagari: Order = { ...ORDER, items: [...ORDER.items, { productId: "p7", name: "मसाला चाय", price: 30, qty: 1, modifiers: [], instructions: "", kotRound: 1 }] };
  for (const design of TOKEN_DESIGNS) for (const font of ["geistMono", "sans", "condensed"] as const) for (const order of [ORDER, devanagari]) {
    const template = { ...tpl(design, tpl(design).blocks.map((b) => ({ ...b, on: true }))), font };
    const html = rendered(order, withTemplate(template));
    const dev = SLIP_DEVANAGARI_RE.test(html);
    const faces = templateFaces(template, TOKEN_DESIGN_FACES[design], dev);
    assert.ok(faces.length <= 4, `${design} ${font}: ${faces.length} faces`);
    const allowed = new Set<string>([...faces.map((f) => PRINT_FONT_CATALOG[f].family), "sans-serif", "serif", "monospace"]);
    const lists = styleFamilyLists(html);
    assert.ok(lists.some((l) => l.includes(PRINT_FONT_CATALOG.display.family)), `${design} ${font}: landmark: the number is set in the display face`);
    for (const list of lists) for (const name of list) assert.ok(allowed.has(name), `${design} ${font}: names ${name}`);
    assert.equal(lists.every((l) => l.includes(PRINT_FONT_CATALOG.devanagari.family)), dev, `${design} ${font}: Devanagari in every stack iff the slip has Devanagari text`);
  }
  assert.ok(rendered(devanagari, withTemplate(tpl("numberItems"))).includes("मसाला चाय"), "landmark: the Devanagari dish prints");
});

const CAFE_ROOT = path.join(__dirname, "..");
const SLIP_DIR = path.join(CAFE_ROOT, "components", "print", "slip");
const SOURCES = [
  ...["TokenSlip.tsx", "token-blocks.tsx", "token-designs.tsx", "generic-blocks.tsx", "slip-rows.tsx", "slip-style.ts", "SlipEngine.tsx"].map((f) => path.join(SLIP_DIR, f)),
  path.join(CAFE_ROOT, "components", "pos", "PrintBanner.tsx"),
  path.join(CAFE_ROOT, "lib", "print.ts"),
].map((f) => readFileSync(f, "utf8")).join("\n");
const CLASS_CHAR = /[A-Za-z0-9_\-[\].:&*%/#]/;
const inSource = (token: string): boolean => {
  for (let at = SOURCES.indexOf(token); at >= 0; at = SOURCES.indexOf(token, at + 1)) {
    if (!CLASS_CHAR.test(SOURCES[at - 1] ?? "") && !CLASS_CHAR.test(SOURCES[at + token.length] ?? "")) return true;
  }
  return false;
};

test("1-bit and literal: every class a token slip renders is written literally in source; no grey, opacity or shadow", () => {
  const withBanner = [rendered(ORDER, withTemplate(tpl("bigNumber")), "DUPLICATE"), rendered(ORDER, withTemplate(tpl("numberItems")), "DUPLICATE")];
  assert.ok(CORPUS.length > 50 && withBanner.every((h) => h.includes("DUPLICATE")), `landmark: ${CORPUS.length} slips (banner included) rendered`);
  const tokens = new Set(CORPUS.flatMap(classTokens));
  assert.ok(tokens.has("bg-black") && tokens.has("w-[210px]") && tokens.has("tabular-nums"), "landmark: the band, 58 mm and the number's classes are in the corpus");
  assert.deepEqual([...tokens].filter((t) => !inSource(t)), [], "classes built at runtime (Tailwind would never emit them)");
  const mush = (t: string): boolean => t.includes("opacity") || t.includes("shadow") || /(?:^|[:-])(?:gray|grey|neutral|slate|zinc|stone)(?:-|$)/.test(t) || /\/\d+$/.test(t);
  assert.ok(["opacity-50", "text-gray-500", "bg-black/50", "shadow-md"].every(mush) && !["bg-black", "text-[0.86em]", "border-dashed"].some(mush), "landmark: the detector flags the bad ones and spares the good");
  assert.deepEqual([...tokens].filter(mush), []);
  assert.deepEqual(CORPUS.flatMap((h) => h.match(/style="[^"]*(?:opacity|shadow|(?<!-)color:(?!transparent))[^"]*"/g) ?? []).slice(0, 2), [], "no inline opacity, shadow or colour (next/image own color:transparent on the logo is not the slip)");
});

test("an order with no token number (or no order) has nothing to print: an empty root, banner included", () => {
  for (const design of TOKEN_DESIGNS) {
    const s = withTemplate(tpl(design));
    for (const order of [null, orderOf({}), { ...ORDER, tokenNumber: undefined }]) {
      const html = slip(order, s, "DUPLICATE");
      assert.equal(text(html), "", `${design}: no printable text for ${order === null ? "null" : "a tokenless order"}`);
      assert.ok(rootAttrs(html).classes.includes("bg-white"), `${design}: landmark: the empty root is still the slip root`);
    }
    assert.ok(text(slip(ORDER, s, "DUPLICATE")).startsWith("DUPLICATE"), `${design}: landmark: with a token the same call prints, banner first`);
  }
});

// ── byte-identical OFF ───────────────────────────────────────────────────────

const printSources = (order: Order | null, extra: object = {}): string =>
  renderToStaticMarkup(createElement(PrintSources, { order, settings: settingsOf(), kotRef: () => undefined, kotVariant: "kot", ...extra }));
const NOOP_REF = (): void => undefined; // a callback ref: a null ref would be falsy and prove nothing

test("PrintSources: no tokenRef, or no token number, is byte-identical to the markup without the new prop; with both, the ONLY difference is the slip", () => {
  const tokenSlip = slip(ORDER, settingsOf());
  assert.ok(tokenSlip.includes(String(TOKEN_NO)), "landmark: the slip itself");
  for (const order of [null, orderOf({})]) {
    assert.equal(printSources(order, { tokenRef: NOOP_REF }), printSources(order), "no token number: a tokenRef changes nothing");
    assert.ok(!printSources(order, { tokenRef: NOOP_REF }).includes(TOKEN_LABEL_TEXT), "...and no token text");
  }
  const without = printSources(ORDER);
  assert.ok(!without.includes(tokenSlip) && !without.includes(TOKEN_LABEL_TEXT), "no tokenRef: no slip even for a numbered order");
  const withRef = printSources(ORDER, { tokenRef: NOOP_REF });
  assert.ok(withRef.includes(tokenSlip), "landmark: with a tokenRef and a number the slip is in the markup");
  assert.equal(withRef.replace(tokenSlip, ""), without, "taking the slip out leaves exactly the markup without the prop");
  assert.ok(printSources(ORDER, { tokenRef: NOOP_REF, banner: "DUPLICATE" }).includes(slip(ORDER, settingsOf(), "DUPLICATE")), "the banner reaches the slip");
});

test("font preload: tokens off with none stored add no descriptor; tokens on, or a stored design, add the display face", () => {
  const base = settingsOf({ billTemplate: defaultBillTemplate("cafe", settingsOf()) });
  // The list as it was before S7: the bill's and the kitchen ticket's faces only.
  const expected = (s: Settings): string[] => {
    const out = new Set<string>();
    const bill = billTemplateOf(s);
    const kot = kotTemplateOf(s);
    const faces = [...(bill ? templateFaces(bill, BILL_DESIGN_FACES[bill.design], false) : []), ...(kot ? templateFaces(kot, KOT_DESIGN_FACES[kot.design], false) : [])];
    for (const f of faces) for (const w of PRINT_FONT_CATALOG[f].weights) out.add(`${w} 16px "${PRINT_FONT_CATALOG[f].family}"`);
    return [...out];
  };
  assert.ok(expected(base).length > 0 && printFontPreloadDescriptors(base).length > 0, "landmark: a stored Cafe bill warms the slab face");
  const display = (list: string[]): boolean => list.some((d) => d.includes(`"${PRINT_FONT_CATALOG.display.family}"`));
  for (const off of [base, { ...base, tokenEnabled: false }, { ...base, tokenEnabled: undefined, tokenTemplate: null }]) {
    assert.deepEqual(printFontPreloadDescriptors(off), expected(off), "the list is exactly the bill's and the kitchen ticket's");
    assert.ok(!display(printFontPreloadDescriptors(off)), "no display face");
  }
  assert.ok(display(printFontPreloadDescriptors({ ...base, tokenEnabled: true })), "tokens on: the number's face is warmed");
  assert.ok(display(printFontPreloadDescriptors({ ...base, tokenTemplate: tpl("numberItems") })), "a stored design: likewise");
  assert.deepEqual(expected(base).filter((d) => !printFontPreloadDescriptors({ ...base, tokenEnabled: true }).includes(d)), [], "...and nothing the bill and kitchen ticket warm is dropped");
});

// ── the lazy chunk: only a token's QR line needs it ──────────────────────────

test("settingsNeedSlipCode: a token design alone never waits for the chunk; a stored token QR line does; an unreadable token adds nothing", () => {
  const withQr = tpl("bigNumber", [...tpl("bigNumber").blocks, BLOCK_CASES.qr.block]);
  for (const design of TOKEN_DESIGNS) assert.equal(settingsNeedSlipCode(withTemplate(tpl(design))), false, `${design} without a QR is eager: no wait`);
  assert.equal(settingsNeedSlipCode(settingsOf()), false, "no template at all");
  assert.equal(settingsNeedSlipCode(settingsOf({ tokenEnabled: true })), false, "tokens on with no stored design: nothing to wait for");
  assert.equal(settingsNeedSlipCode(withTemplate(withQr)), true, "landmark: a stored token QR line needs the encoder");
  assert.equal(settingsNeedSlipCode(withTemplate({ ...withQr, design: "neon" })), false, "an unreadable design prints Big Number, which has no QR");
  assert.equal(settingsNeedSlipCode(withTemplate(tpl("numberItems", [...tpl("numberItems").blocks, BLOCK_CASES.qr.block]))), true, "either design");
});

test("the token renderers import nothing lazy: no lazy chunk module, no bill/kitchen theme file, no qrcode value", () => {
  const files = ["TokenSlip.tsx", "token-blocks.tsx", "token-designs.tsx"].map((f) => readFileSync(path.join(SLIP_DIR, f), "utf8"));
  assert.ok(files.every((src) => src.length > 500) && files[0].includes("loadSlipCode"), "landmark: the files were read, and TokenSlip uses the lazy loader (from slip-code, never the chunk)");
  for (const src of files) {
    const specifiers = [...src.matchAll(/^(?:import|export)\s+(type\s+)?[^;]*?from\s+"([^"]+)"/gm)].map((m) => ({ type: Boolean(m[1]), spec: m[2] }));
    assert.ok(specifiers.length > 3, "landmark: imports were found");
    assert.deepEqual(specifiers.filter((i) => /slip-code-lazy|bill-themed-blocks|bill-\w+-blocks|kot-\w+-blocks|slip-groups-lazy/.test(i.spec)), [], "no lazy or bill/kitchen theme module");
    assert.deepEqual(specifiers.filter((i) => !i.type && /^qrcode$/.test(i.spec)), [], "no qrcode value import (the encoder arrives through slip-code)");
  }
});
