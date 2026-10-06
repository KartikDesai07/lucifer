import {
  CANCELLED_BILL, DEVANAGARI_ITEM, FIXED_NOW_MS, INCLUSIVE_BILL, INCLUSIVE_SETTINGS, KOT_CANCEL_NOTICE, KOT_MOVED, KOT_ROUND, KOT_VOID,
  MATRIX_TOKEN, MAX_BILL, NO_GST_BILL, NO_GST_SETTINGS, classTokens, maxSettings, qrCount, renderBill, renderKot, rootAttrs, styleFamilyLists, withDevanagari,
} from "./print-template-matrix.fixtures"; // FIRST: it selects React's production renderer before react loads
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  BILL_BLOCK_TYPES, BILL_DESIGNS, DIVIDER_STYLES, KOT_BLOCK_TYPES, KOT_DESIGNS, PRINT_FONT_KEYS, billBlockLocked, kotBlockLocked,
  type BillBlock, type BillBlockType, type BillTemplate, type KotBlock, type KotBlockType, type KotTemplate,
} from "@pos/shared/print-template";
import { PRINT_FONT_CATALOG, SLIP_DEVANAGARI_RE, printFontFaceOf } from "@pos/shared/print-fonts";
import { BILL_DESIGN_FACES, KOT_DESIGN_FACES, defaultBillTemplate, defaultKotTemplate, templateFaces } from "@/lib/print-template-designs";
import { billGstShows } from "./print-template-golden.fixtures";
import { PAPER_WIDTHS } from "@/lib/constants";
import { PAPER_WIDTH_CLASS } from "@/lib/print";
import type { Order, Settings } from "@/types";
import { loadSlipCode } from "@/components/print/slip/slip-code";

// Print customization S3, Amendment A1.3: the designs x block-types matrix. Every design of a kind x every block type
// of the kind x 58 / 80 mm over a MAXIMAL fixture: the slip with the block ON must print something the slip without
// it does not (the one documented silent block: KOT station, owned by Phase 2, which must update this pin). Then, over ALL the markup the matrix rendered: literal Tailwind classes, a 1-bit look, font families.

before(() => loadSlipCode()); // R6: the non-Classic designs and the QR encoder are one lazy chunk; load it before rendering
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS })); // the bill's "Printed ..." line
after(() => mock.timers.reset());

interface Rendered { label: string; kind: "bill" | "kot"; design: string; template: { font: string }; designFaces: readonly string[]; html: string }
const CORPUS: Rendered[] = [];
const REPEATABLE: readonly string[] = ["divider", "customText", "qr"];
const BILL_TYPES = BILL_BLOCK_TYPES.filter((t) => !REPEATABLE.includes(t));
const KOT_TYPES = KOT_BLOCK_TYPES.filter((t) => !REPEATABLE.includes(t));
const SILENT = { bill: [] as string[], kot: ["station"] };
const plain = <T>(v: T): T => structuredClone(v);

function bill(label: string, order: Order, settings: Settings, template: BillTemplate): string {
  const html = renderBill(order, settings, template);
  CORPUS.push({ label, kind: "bill", design: template.design, template, designFaces: BILL_DESIGN_FACES[template.design], html });
  return html;
}
function kot(label: string, ctx: typeof KOT_ROUND, settings: Settings, template: KotTemplate): string {
  const html = renderKot(ctx.order, settings, ctx.extra, template);
  CORPUS.push({ label, kind: "kot", design: template.design, template, designFaces: KOT_DESIGN_FACES[template.design], html });
  return html;
}
const allOn = <B extends { on: boolean }>(blocks: B[]): B[] => blocks.map((b) => ({ ...b, on: true }));
// A block the default lacks (Classic's bill has no loyalty) is added before the total / the items.
const placed = <B extends { type: string }>(blocks: B[], block: B, anchor: string): B[] => {
  const at = blocks.findIndex((b) => b.type === anchor);
  return [...blocks.slice(0, at), block, ...blocks.slice(at)];
};

// ── the matrix: every (design, block type, paper) ────────────────────────────

type Ctx<O> = { order: O; settings: Settings };
const BILL_CTX: Partial<Record<BillBlockType, Ctx<Order>>> = {
  cancelBanner: { order: CANCELLED_BILL, settings: maxSettings() },
  cancelReason: { order: CANCELLED_BILL, settings: maxSettings() },
  taxIncluded: { order: INCLUSIVE_BILL, settings: INCLUSIVE_SETTINGS },
};

test("matrix (bill): 4 designs x every block type x 58/80 mm: ON prints what OFF does not (no silent block; the token prints its number)", () => {
  let cells = 0, silent = 0;
  for (const design of BILL_DESIGNS) {
    for (const paper of PAPER_WIDTHS) {
      for (const type of BILL_TYPES) {
        const ctx = BILL_CTX[type] ?? { order: MAX_BILL, settings: maxSettings() };
        const settings = { ...ctx.settings, billPaperWidth: paper };
        const base = defaultBillTemplate(design, settings);
        const present = base.blocks.some((b) => b.type === type);
        const block = { id: type, type, on: true } as BillBlock;
        const onBlocks = present ? base.blocks.map((b) => (b.type === type ? { ...b, on: true } : b)) : placed(base.blocks, block, "total");
        const offBlocks = base.blocks.filter((b) => b.type !== type);
        const cell = `${design} ${paper} ${type}`;
        const on = bill(cell, ctx.order, settings, { ...base, blocks: onBlocks });
        const off = bill(`${cell} (absent)`, ctx.order, settings, { ...base, blocks: offBlocks });
        assert.ok(on.includes(PAPER_WIDTH_CLASS[paper]), `${cell}: the slip is laid out at ${paper}`);
        if (SILENT.bill.includes(type)) {
          assert.equal(on, off, `${cell}: a silent block prints nothing`);
          silent++;
        } else {
          assert.notEqual(on, off, `${cell}: turning the block on changes the slip`);
          assert.ok(on.length > off.length && (type !== "token" || on.includes(String(MATRIX_TOKEN))), `${cell}: the block adds markup (the token adds its number)`);
        }
        // on:false is the same as absent unless a lock forces the block (locks act on blocks the template holds).
        const locked = billBlockLocked(type, { gst: billGstShows(ctx.order, settings), fssai: true, banner: false });
        if (present && !locked) {
          const flagged = bill(`${cell} (off)`, ctx.order, settings, { ...base, blocks: base.blocks.map((b) => (b.type === type ? { ...b, on: false } : b)) });
          assert.equal(flagged, off, `${cell}: on:false equals absent`);
        }
        cells++;
      }
    }
  }
  assert.equal(cells, BILL_DESIGNS.length * PAPER_WIDTHS.length * BILL_TYPES.length);
  assert.equal(silent, 0, "landmark: no bill block is silent now that the token prints");
});

test("matrix (kot): 2 designs x every block type x 58/80 mm: ON prints what OFF does not (only station is silent)", () => {
  let cells = 0, silent = 0;
  for (const design of KOT_DESIGNS) {
    for (const paper of PAPER_WIDTHS) {
      for (const type of KOT_TYPES) {
        const ctx = type === "voidReason" ? KOT_VOID : KOT_ROUND;
        const settings = maxSettings({ kotPaperWidth: paper });
        const base = defaultKotTemplate(design, settings);
        // The round total prints only beside an items block that shows prices.
        const priced = (blocks: KotBlock[]): KotBlock[] => blocks.map((b) => (b.type === "items" ? { ...b, options: { ...b.options, prices: true } } : b));
        const block = { id: type, type, on: true } as KotBlock;
        const present = base.blocks.some((b) => b.type === type);
        const onBlocks = present ? base.blocks.map((b) => (b.type === type ? { ...b, on: true } : b)) : placed(base.blocks, block, "items");
        const cell = `${design} ${paper} ${type}`;
        const on = kot(cell, ctx, settings, { ...base, blocks: priced(onBlocks) });
        const off = kot(`${cell} (absent)`, ctx, settings, { ...base, blocks: priced(base.blocks.filter((b) => b.type !== type)) });
        assert.ok(on.includes(PAPER_WIDTH_CLASS[paper]), `${cell}: the slip is laid out at ${paper}`);
        if (SILENT.kot.includes(type)) {
          assert.equal(on, off, `${cell}: the documented silent block prints nothing (Phase 2 updates this pin)`);
          silent++;
        } else {
          assert.notEqual(on, off, `${cell}: turning the block on changes the slip`);
          assert.ok(on.length > off.length && (type !== "token" || on.includes(String(MATRIX_TOKEN))), `${cell}: the block adds markup (the token adds its number)`);
        }
        const locked = kotBlockLocked(type as KotBlockType, { gst: false, fssai: false, banner: false });
        // kotNo is exempt (owner, s79): "Show ticket number" is its SOLE control, so its own `on` is ignored and on:false is NOT
        // the same as absent (print-template-kot-number.test.ts pins the rule). Every other unlocked block still is.
        if (present && !locked && type !== "kotNo") {
          const flagged = kot(`${cell} (off)`, ctx, settings, { ...base, blocks: priced(base.blocks.map((b) => (b.type === type ? { ...b, on: false } : b))) });
          assert.equal(flagged, off, `${cell}: on:false equals absent`);
        }
        cells++;
      }
    }
  }
  assert.equal(cells, KOT_DESIGNS.length * PAPER_WIDTHS.length * KOT_TYPES.length);
  assert.equal(silent, KOT_DESIGNS.length * PAPER_WIDTHS.length, "landmark: exactly the KOT station cells were silent");
});

// ── repeatables: divider (every style), customText, qr ───────────────────────

const DEFAULT_DIVIDER = { classic: "dashed", modern: "solid", express: "double", cafe: "ornament", kitchenBold: "double" } as const;
const URL_OK = "https://example.com/menu";

test("matrix (repeatables): a divider of every style, customText and qr each print in every design at both widths", () => {
  let cells = 0;
  for (const paper of PAPER_WIDTHS) {
    const settings = maxSettings({ billPaperWidth: paper, kotPaperWidth: paper });
    const kinds = [
      ...BILL_DESIGNS.map((d) => ({ kind: "bill" as const, d, base: defaultBillTemplate(d, settings) as BillTemplate | KotTemplate })),
      ...KOT_DESIGNS.map((d) => ({ kind: "kot" as const, d, base: defaultKotTemplate(d, settings) as BillTemplate | KotTemplate })),
    ];
    for (const { kind, d, base } of kinds) {
      const blocks = (base.blocks as { type: string }[]).filter((b) => !REPEATABLE.includes(b.type));
      const run = (extra: object | null): string => {
        const added = extra ? placed(blocks, extra as { type: string }, "items") : blocks;
        return kind === "bill"
          ? bill(`${d} ${paper} repeatable`, MAX_BILL, settings, { ...base, blocks: added } as BillTemplate)
          : kot(`${d} ${paper} repeatable`, KOT_ROUND, settings, { ...base, blocks: added } as KotTemplate);
      };
      const off = run(null);
      const styled = DIVIDER_STYLES.map((style) => run({ id: "divider-1", type: "divider", on: true, options: { style } }));
      styled.forEach((html, i) => assert.notEqual(html, off, `${kind} ${d} ${paper}: divider ${DIVIDER_STYLES[i]} prints`));
      assert.equal(new Set(styled).size, DIVIDER_STYLES.length, `${kind} ${d} ${paper}: every divider style looks different`);
      const plainDivider = run({ id: "divider-1", type: "divider", on: true });
      assert.equal(plainDivider, styled[DIVIDER_STYLES.indexOf(DEFAULT_DIVIDER[d as keyof typeof DEFAULT_DIVIDER])], `${kind} ${d}: no options = the design's own divider`);
      const text = run({ id: "customText-1", type: "customText", on: true, options: { text: "Thank you, visit again soon" } });
      assert.ok(text.includes("Thank you, visit again soon") && text !== off, `${kind} ${d} ${paper}: custom text prints`);
      for (const empty of ["", "   "]) assert.equal(run({ id: "customText-1", type: "customText", on: true, options: { text: empty } }), off, `${kind} ${d}: empty custom text prints nothing`);
      const link = run({ id: "qr-1", type: "qr", on: true, options: { content: "link", url: URL_OK } });
      assert.equal(qrCount(link) - qrCount(off), 1, `${kind} ${d} ${paper}: a link QR prints one code`);
      if (kind === "bill") {
        const upi = run({ id: "qr-1", type: "qr", on: true, options: { content: "upi" } });
        assert.equal(qrCount(upi) - qrCount(off), 1, `bill ${d} ${paper}: a UPI QR prints one code on an unpaid bill`);
      }
      cells++;
    }
  }
  assert.equal(cells, (BILL_DESIGNS.length + KOT_DESIGNS.length) * PAPER_WIDTHS.length);
});

// ── every design x every font x context, all blocks on: roots, families, Devanagari ──

const DEV = "POS Print Devanagari";

test("fonts: root rule per font key (geistMono = font-mono and no style; others = no font-mono and their own family first), Devanagari only when the slip has it", () => {
  const kotDev = { order: KOT_ROUND.order, extra: { ...KOT_ROUND.extra, roundItems: [...(KOT_ROUND.extra.roundItems ?? []), DEVANAGARI_ITEM] } };
  const billCtx: [string, Order, Settings][] = [
    ["max", MAX_BILL, maxSettings()], ["cancelled", CANCELLED_BILL, maxSettings()], ["inclusive", INCLUSIVE_BILL, INCLUSIVE_SETTINGS],
    ["no-gst", NO_GST_BILL, NO_GST_SETTINGS], ["devanagari", withDevanagari(MAX_BILL), maxSettings()],
  ];
  const kotCtx: [string, typeof KOT_ROUND][] = [["round", KOT_ROUND], ["void", KOT_VOID], ["moved", KOT_MOVED], ["cancel-notice", KOT_CANCEL_NOTICE], ["devanagari", kotDev]];
  let cells = 0, withDev = 0;
  const check = (label: string, html: string, font: string, design: string, kind: "bill" | "kot"): void => {
    const root = rootAttrs(html);
    const dev = SLIP_DEVANAGARI_RE.test(html);
    if (dev) withDev++;
    if (font === "geistMono") {
      assert.ok(root.classes.includes("font-mono"), `${label}: Classic's face keeps font-mono`);
      assert.equal(root.style, null, `${label}: and no style attribute on the root`);
    } else {
      assert.ok(!root.classes.includes("font-mono"), `${label}: no font-mono on a self-hosted font`);
      const face = printFontFaceOf(font as (typeof PRINT_FONT_KEYS)[number]);
      assert.ok(face && root.style !== null, `${label}: a style font-family`);
      const first = styleFamilyLists(html)[0][0];
      assert.equal(first, PRINT_FONT_CATALOG[face as keyof typeof PRINT_FONT_CATALOG].family, `${label}: the font's own family leads the root stack`);
      assert.equal(styleFamilyLists(html)[0].includes(DEV), dev, `${label}: Devanagari in the root stack iff the slip has Devanagari text`);
    }
    for (const list of styleFamilyLists(html)) assert.equal(list.includes(DEV), dev, `${label}: Devanagari in a ${kind} ${design} stack iff the slip has it`);
    if (!dev) assert.ok(!html.includes(DEV), `${label}: a Latin-only slip never names the Devanagari family`);
    cells++;
  };
  for (const design of BILL_DESIGNS) for (const font of PRINT_FONT_KEYS) for (const paper of PAPER_WIDTHS) for (const [id, order, s] of billCtx) {
    const settings = { ...s, billPaperWidth: paper };
    const tpl = { ...defaultBillTemplate(design, settings), font };
    const html = bill(`bill ${design} ${font} ${paper} ${id}`, order, settings, { ...tpl, blocks: allOn(plain(tpl.blocks)) });
    check(`bill ${design} ${font} ${paper} ${id}`, html, font, design, "bill");
  }
  for (const design of KOT_DESIGNS) for (const font of PRINT_FONT_KEYS) for (const paper of PAPER_WIDTHS) for (const [id, ctx] of kotCtx) {
    const settings = maxSettings({ kotPaperWidth: paper });
    const tpl = { ...defaultKotTemplate(design, settings), font };
    const html = kot(`kot ${design} ${font} ${paper} ${id}`, ctx, settings, { ...tpl, blocks: allOn(plain(tpl.blocks)) });
    check(`kot ${design} ${font} ${paper} ${id}`, html, font, design, "kot");
  }
  assert.equal(cells, (BILL_DESIGNS.length * billCtx.length + KOT_DESIGNS.length * kotCtx.length) * PRINT_FONT_KEYS.length * PAPER_WIDTHS.length);
  assert.ok(withDev > 0 && withDev < cells, `landmark: some slips carry Devanagari and some do not (${withDev}/${cells})`);
});

test("styled blocks: every block sized lg, centred and bold renders in every design (the wrapper classes join the cross-checks)", () => {
  const style = { size: "lg", align: "center", bold: true } as const;
  for (const design of BILL_DESIGNS) {
    const tpl = defaultBillTemplate(design, maxSettings());
    const html = bill(`bill ${design} styled`, MAX_BILL, maxSettings(), { ...tpl, blocks: allOn(tpl.blocks).map((b) => ({ ...b, ...style })) as BillBlock[] });
    assert.ok(html.includes("[&amp;_*]:font-bold") && html.includes("[&amp;_*]:text-center"), `bill ${design}: the wrappers are there`);
  }
  for (const design of KOT_DESIGNS) {
    const tpl = defaultKotTemplate(design, maxSettings());
    const html = kot(`kot ${design} styled`, KOT_ROUND, maxSettings(), { ...tpl, blocks: allOn(tpl.blocks).map((b) => ({ ...b, ...style })) as KotBlock[] });
    assert.ok(html.includes("[&amp;_*]:font-bold"), `kot ${design}: the wrappers are there`);
  }
});

// ── across ALL the markup rendered above ─────────────────────────────────────

const CAFE_ROOT = path.resolve(__dirname, "..");
const SLIP_DIR = path.join(CAFE_ROOT, "components", "print", "slip");
const SOURCES = [
  ...readdirSync(SLIP_DIR).filter((f) => /\.tsx?$/.test(f)).map((f) => readFileSync(path.join(SLIP_DIR, f), "utf8")),
  readFileSync(path.join(CAFE_ROOT, "components", "pos", "PrintBanner.tsx"), "utf8"),
  readFileSync(path.join(CAFE_ROOT, "lib", "print.ts"), "utf8"),
].join("\n");

const CLASS_CHAR = /[A-Za-z0-9_\-[\].:&*%/#]/;
// A whole-token search: the characters on both sides of the match must not continue a class name ("px-2" is not in "px-2.5").
function sourceHasToken(src: string, token: string): boolean {
  for (let from = src.indexOf(token); from >= 0; from = src.indexOf(token, from + 1)) {
    if (!CLASS_CHAR.test(src[from - 1] ?? "") && !CLASS_CHAR.test(src[from + token.length] ?? "")) return true;
  }
  return false;
}

test("(a) every class token of every rendered slip appears literally in the slip sources (Tailwind only emits classes it finds in source)", () => {
  assert.ok(CORPUS.length > 1000, `landmark: the matrix rendered ${CORPUS.length} slips`);
  const tokens = new Set(CORPUS.flatMap((r) => classTokens(r.html)));
  assert.ok(tokens.size > 100 && tokens.has("w-[210px]") && tokens.has("w-[300px]") && tokens.has("bg-black"), `landmark: ${tokens.size} distinct tokens incl. both paper widths`);
  assert.ok(sourceHasToken(SOURCES, "px-2") && !sourceHasToken("className=\"px-2.5\"", "px-2") && !sourceHasToken(SOURCES, "zz-not-a-class"), "landmark: the token search tells a class from a longer class and from nothing");
  const missing = [...tokens].filter((t) => !sourceHasToken(SOURCES, t));
  assert.deepEqual(missing, [], "class tokens a design builds at runtime (Tailwind would never emit them)");
});

// 1-bit thermal (01-PLAN §2.5): a grey, an opacity or a shadow prints as mush or as nothing.
const GREY_RE = /(?:^|[:-])(?:gray|grey|neutral|slate|zinc|stone)(?:-|$)/;
const isMush = (token: string): boolean => token.includes("opacity-") || token.includes("shadow") || GREY_RE.test(token);

test("(b) no opacity / grey / shadow class in any NON-Classic design's markup (Classic's legacy reward line is the detector's landmark)", () => {
  for (const sample of ["opacity-50", "text-gray-500", "bg-neutral-100", "text-slate-700", "bg-zinc-100", "text-stone-400", "shadow-md", "hover:opacity-60"]) assert.ok(isMush(sample), `landmark: the detector flags ${sample}`);
  for (const sample of ["bg-black", "text-white", "border-t-[3px]", "font-medium", "gap-0.5"]) assert.ok(!isMush(sample), `landmark: the detector spares ${sample}`);
  const classic = CORPUS.filter((r) => r.design === "classic");
  assert.ok(classic.some((r) => classTokens(r.html).some(isMush)), "landmark: Classic's own markup (the legacy reward strike-through opacity-60) IS flagged");
  const themed = CORPUS.filter((r) => r.design !== "classic");
  assert.ok(themed.length > 500 && new Set(themed.map((r) => r.design)).size === 4, "landmark: modern, express, cafe and kitchenBold were all rendered");
  const offenders = themed.flatMap((r) => classTokens(r.html).filter(isMush).map((t) => `${r.label}: ${t}`));
  assert.deepEqual([...new Set(offenders)], []);
  for (const r of themed) assert.ok(!/style="[^"]*(?:opacity|shadow)/.test(r.html), `${r.label}: no inline opacity or shadow`);
});

test("(c) every font-family in every style attribute names only families from templateFaces(template, designFaces, devanagari)", () => {
  let checked = 0;
  for (const r of CORPUS) {
    const faces = templateFaces(r.template as { font: (typeof PRINT_FONT_KEYS)[number] }, r.designFaces as never, SLIP_DEVANAGARI_RE.test(r.html));
    const allowed = new Set<string>([...faces.map((f) => PRINT_FONT_CATALOG[f].family), "sans-serif", "serif", "monospace"]);
    for (const list of styleFamilyLists(r.html)) {
      for (const name of list) assert.ok(allowed.has(name), `${r.label}: names ${JSON.stringify(name)}, outside ${[...allowed].join(" | ")}`);
      checked++;
    }
  }
  assert.ok(checked > 200, `landmark: ${checked} font-family stacks were checked`);
  assert.ok(CORPUS.some((r) => r.design === "cafe" && r.template.font === "geistMono" && styleFamilyLists(r.html).some((l) => l.includes("POS Print Slab"))), "landmark: Cafe's slab headings sit on a geistMono slip");
});
