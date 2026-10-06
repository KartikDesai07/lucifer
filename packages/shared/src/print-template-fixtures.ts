import assert from "node:assert/strict";
import type { z } from "zod";

// Shared by the print-template test files. Plain data, deliberately loose: the tests mutate copies to build
// bad inputs. Not a test file itself (it is not in the package.json test chain).
export type Block = Record<string, unknown>;
export type Template = { v: number; design: string; font: string; size: string; blocks: Block[] };
export type Kind = "bill" | "kot" | "token";

export const plain = (type: string, on = true): Block => ({ id: type, on, type });
export const divider = (n: number): Block => ({ id: `divider-${n}`, on: true, type: "divider" });
export const customText = (n: number, text: string): Block => ({
  id: `customText-${n}`,
  on: true,
  type: "customText",
  options: { text },
});
export const qr = (n: number, options: Block): Block => ({ id: `qr-${n}`, on: true, type: "qr", options });
export const wrap = (design: string, blocks: Block[]): Template => ({ v: 1, design, font: "geistMono", size: "normal", blocks });

// Exactly what the cafe's Classic-from-legacy converter emits (title off: the legacy bill prints none).
export const billFixture = (): Template =>
  wrap("classic", [
    { id: "logo", on: true, type: "logo", options: { logoSize: "medium" } },
    ...["name", "tagline", "address", "phone", "gstin", "fssai", "headerText"].map((t) => plain(t)),
    divider(1),
    plain("title", false),
    ...["cancelBanner", "billNo", "token", "orderId", "dateTime", "table", "customer", "cashier", "cancelReason"].map((t) => plain(t)),
    divider(2),
    plain("items"),
    divider(3),
    ...["subtotal", "discount", "taxes", "charges", "total", "taxIncluded", "payment", "due"].map((t) => plain(t)),
    divider(4),
    ...["footerText", "printedAt"].map((t) => plain(t)),
  ]);

export const kotFixture = (): Template =>
  wrap("classic", [
    { id: "logo", on: true, type: "logo", options: { logoSize: "small" } },
    ...["name", "title", "station", "kotNo", "token", "roundLabel"].map((t) => plain(t)),
    divider(1),
    ...["orderId", "table", "time", "staff", "voidReason"].map((t) => plain(t)),
    divider(2),
    { id: "items", on: true, type: "items", options: { prices: false, modifiers: true, instructions: true } },
    plain("notes"),
    divider(3),
    ...["itemCount", "roundTotal"].map((t) => plain(t)),
  ]);

export const tokenFixture = (): Template =>
  wrap("bigNumber", [
    plain("name"),
    plain("tokenNo"),
    divider(1),
    customText(1, "Thank you"),
    qr(1, { content: "link", url: "https://example.com/menu" }),
  ]);

export const DIVIDER_AT = 8; // the first divider in the bill fixture

export const withBlock = (t: Template, index: number, patch: Block): Template => ({
  ...t,
  blocks: t.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)),
});
export const without = (t: Template, type: string): Template => ({ ...t, blocks: t.blocks.filter((b) => b.type !== type) });
export const indexOfType = (t: Template, type: string): number => t.blocks.findIndex((b) => b.type === type);

type Schema = z.ZodType<unknown>;
// Paths of every issue, joined, so a rejection can be pinned to the exact line it names.
export function issuePaths(schema: Schema, input: unknown): string[] {
  const result = schema.safeParse(input);
  assert.equal(result.success, false, "expected a rejection");
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}
export function rejects(schema: Schema, input: unknown, path: string): void {
  const paths = issuePaths(schema, input);
  assert.ok(paths.includes(path), `expected an issue at "${path}", got ${JSON.stringify(paths)}`);
}
export function accepts(schema: Schema, input: unknown, label = "input"): void {
  const result = schema.safeParse(input);
  assert.ok(result.success, `${label} should parse: ${result.success ? "" : JSON.stringify(result.error.issues)}`);
}

// One valid block of a catalog type, with whatever options that type needs in that kind.
export function validBlock(kind: Kind, type: string): Block {
  if (type === "logo") return { id: "logo", on: true, type, options: { logoSize: "large" } };
  if (type === "divider") return { id: "divider-1", on: true, type, options: { style: "double" } };
  if (type === "customText") return customText(1, "Hello");
  if (type === "qr") return qr(1, { content: "link", url: "https://example.com", caption: "Scan me" });
  if (type === "items" && kind === "kot") {
    return { id: "items", on: true, type, options: { prices: true, modifiers: false, instructions: true } };
  }
  return plain(type);
}
