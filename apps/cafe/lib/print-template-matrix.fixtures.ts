import { ITEMS, REWARD_LINE, FIXED_NOW_MS, KOT_PROP_SETS, orderOf, settingsOf, type KotExtra } from "./print-template-golden.fixtures"; // FIRST: it selects React's production renderer before react loads
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import { create } from "qrcode";

import { BillSlip, KotSlip } from "@/components/print/slip/SlipEngine";
import { QR_MODULE_PX, QR_QUIET_MODULES } from "@/components/print/slip/generic-blocks";
import { defaultBillTemplate } from "@/lib/print-template-designs";
import type { BillBlock, BillDesign, BillTemplate, KotTemplate } from "@pos/shared/print-template";
import type { Order, OrderItem, Settings } from "@/types";

// Shared by the designs x blocks matrix pins (print customization S3, 01-PLAN Amendment A1.3): the MAXIMAL slip
// fixtures (every optional line has something to print), the render helpers, and the markup readers the cross-checks
// use. Not a test file (it is not in the testChain). The cafe tsconfig is jsx:"preserve", so the engine's JSX compiles
// to React.createElement and needs a global React at render time.
(globalThis as { React?: typeof React }).React = React;

export { FIXED_NOW_MS };
export const UPI_ID = "samplecafe@okaxis";
export const DEVANAGARI_NAME = "मसाला चाय";
const PAID_PART = 100;
export const MATRIX_TOKEN = 4417; // the token the maximal bill and round ticket carry

/** Content-full settings: name, tagline, address, mobile, GSTIN, FSSAI, header, footer, logo, UPI id; GST 18 % exclusive. */
export function maxSettings(over: Partial<Settings> = {}): Settings {
  return settingsOf({ gstEnabled: true, gstRate: 18, gstMode: "exclusive", upiId: UPI_ID, ...over });
}

const MAX_OPTS = {
  items: [...ITEMS, REWARD_LINE],
  gst: { rate: 18, mode: "exclusive" as const },
  discount: 20,
  discountKind: "gst" as const,
  tableCharge: 20,
  extraCharge: 15,
};

/** GST exclusive, a discount, two charges, a reward line, modifiers + instructions, notes, a bill number, UNPAID (due > 0). */
export const MAX_BILL: Order = orderOf({ ...MAX_OPTS, over: { paidAmount: PAID_PART, status: "Pending", notes: "Birthday table, no peanuts", tokenNumber: MATRIX_TOKEN } });
export const PAID_BILL: Order = orderOf({ ...MAX_OPTS, over: { notes: "Birthday table, no peanuts" } });
export const OVERPAID_BILL: Order = orderOf({ ...MAX_OPTS, over: { paidAmount: PAID_PART * 100 } });
export const CANCELLED_BILL: Order = orderOf({ ...MAX_OPTS, over: { paidAmount: PAID_PART, status: "Cancelled", cancelReason: "Guest left before food arrived" } });
export const INCLUSIVE_BILL: Order = orderOf({ items: ITEMS, gst: { rate: 12, mode: "inclusive" }, over: { paidAmount: PAID_PART, status: "Pending" } });
export const INCLUSIVE_SETTINGS: Settings = maxSettings({ gstRate: 12, gstMode: "inclusive" });
export const NO_GST_BILL: Order = orderOf({ items: ITEMS, over: { paidAmount: PAID_PART, status: "Pending" } });
export const NO_GST_SETTINGS: Settings = maxSettings({ gstEnabled: false, gstRate: 0, gstMode: "inclusive" });

export const DEVANAGARI_ITEM: OrderItem = { productId: "p7", name: DEVANAGARI_NAME, price: 30, qty: 1, modifiers: [], instructions: "", kotRound: 1 };
export const withDevanagari = (order: Order): Order => ({ ...order, items: [...order.items, DEVANAGARI_ITEM] });

const kotSet = (id: string): { order: Order; extra: KotExtra } => {
  const found = KOT_PROP_SETS.find((p) => p.id === id);
  if (!found || !found.order) throw new Error(`fixture ${id} missing`);
  return { order: found.order, extra: found.extra };
};
/** A round slip: round items, label "Round 1", number #7, order notes, a table. */
export const KOT_ROUND: ReturnType<typeof kotSet> = ((k) => ({ ...k, order: { ...k.order, tokenNumber: MATRIX_TOKEN } }))(kotSet("round-label-number"));
export const KOT_VOID = kotSet("void-reason-by-at");
export const KOT_MOVED = kotSet("moved-from-by-at");
export const KOT_CANCEL_NOTICE = kotSet("cancel-notice-reason");

export const renderBill = (order: Order | null, settings: Settings, template: BillTemplate, banner?: string, now?: number): string =>
  renderToStaticMarkup(createElement(BillSlip, { order, settings, banner, template, now }));
export const renderKot = (order: Order | null, settings: Settings, extra: KotExtra, template: KotTemplate): string =>
  renderToStaticMarkup(createElement(KotSlip, { order, settings, ...extra, template }));

// ── Markup readers ───────────────────────────────────────────────────────────

const unescapeAttr = (v: string): string => v.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** The slip root's opening tag attributes: the div carrying the paper-width class (next/image can hoist a preload <link> in front of it). */
export function rootAttrs(html: string): { classes: string[]; style: string | null } {
  const tag = /<div([^>]*\sclass="[^"]*\bw-\[(?:210|300)px\][^"]*"[^>]*)>/.exec(html);
  if (!tag) throw new Error("slip markup has no root div with a paper-width class");
  const cls = /\sclass="([^"]*)"/.exec(tag[1]);
  const style = /\sstyle="([^"]*)"/.exec(tag[1]);
  return { classes: cls ? cls[1].split(/\s+/).filter(Boolean) : [], style: style ? unescapeAttr(style[1]) : null };
}

/** Every class token of every class="..." attribute. */
export function classTokens(html: string): string[] {
  return [...html.matchAll(/\sclass="([^"]*)"/g)].flatMap((m) => unescapeAttr(m[1]).split(/\s+/).filter(Boolean));
}

/** Every family name (quotes stripped) of every font-family declaration in a style attribute, in order per attribute. */
export function styleFamilyLists(html: string): string[][] {
  return [...html.matchAll(/\sstyle="([^"]*)"/g)].flatMap((m) => {
    const decl = /font-family:([^;]*)/.exec(unescapeAttr(m[1]));
    return decl ? [decl[1].split(",").map((n) => n.trim().replace(/^["']|["']$/g, ""))] : [];
  });
}

/** How many QR codes the markup holds (every QR svg carries this label; the ornament svg does not). */
export const qrCount = (html: string): number => html.split('aria-label="QR code"').length - 1;

/** The bill template of a design with ONE on QR block (content per `options`) placed just before the footer text. */
export const billWithQr = (design: BillDesign, options: object, s: Settings = maxSettings()): BillTemplate => {
  const base = defaultBillTemplate(design, s);
  const blocks = base.blocks.filter((b) => b.type !== "qr");
  const at = blocks.findIndex((b) => b.type === "footerText");
  return { ...base, blocks: [...blocks.slice(0, at), { id: "qr-1", type: "qr", on: true, options } as BillBlock, ...blocks.slice(at)] };
};

/** One QR svg: its size attributes, the set of dark modules as "row,col" (quiet zone removed). */
export function readQr(html: string): { width: number; height: number; span: number; dark: Set<string> } {
  const svg = /<svg width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"[^>]*aria-label="QR code"[^>]*><path d="([^"]*)"/.exec(html);
  assert.ok(svg, "the markup holds a QR svg");
  assert.equal(svg[3], svg[4], "the viewBox is square");
  const dark = new Set<string>();
  for (const m of svg[5].matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(m[3]); i++) dark.add(`${Number(m[2]) - QR_QUIET_MODULES},${Number(m[1]) + i - QR_QUIET_MODULES}`);
  }
  return { width: Number(svg[1]), height: Number(svg[2]), span: Number(svg[3]), dark };
}

/** Asserts the markup's QR is, module for module and at the pinned module size, the code for `text`. */
export function expectEncodes(label: string, html: string, text: string): void {
  const qr = readQr(html);
  const modules = create(text, { errorCorrectionLevel: "M" }).modules;
  assert.equal(qr.span, modules.size + 2 * QR_QUIET_MODULES, `${label}: the viewBox is the code plus the quiet zone`);
  assert.equal(qr.width, qr.span * QR_MODULE_PX, `${label}: width = (modules + 2 x quiet) x QR_MODULE_PX`);
  assert.equal(qr.height, qr.width, `${label}: square`);
  let dark = 0;
  for (let r = 0; r < modules.size; r++) for (let c = 0; c < modules.size; c++) {
    assert.equal(qr.dark.has(`${r},${c}`), Boolean(modules.get(r, c)), `${label}: module ${r},${c}`);
    if (modules.get(r, c)) dark++;
  }
  assert.equal(qr.dark.size, dark, `${label}: no extra dark module outside the code`);
}
