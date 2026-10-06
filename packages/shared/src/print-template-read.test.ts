import { test } from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import {
  PRINT_CUSTOM_TEXT_MAX,
  PRINT_QR_BLOCKS_MAX,
  PRINT_QR_CAPTION_MAX,
  PRINT_QR_URL_MAX,
  PRINT_TEMPLATE_BLOCKS_MAX,
} from "./print-template";
import {
  PRINT_TEMPLATE_READ_LIMITS,
  billTemplateReadSchema,
  billTemplateSchema,
  kotTemplateReadSchema,
  kotTemplateSchema,
  tokenTemplateReadSchema,
  tokenTemplateSchema,
} from "./schemas/print-template.schema";
import * as readModule from "./schemas/print-template-read.schema";
import {
  accepts,
  billFixture,
  customText,
  divider,
  issuePaths,
  kotFixture,
  qr,
  rejects,
  tokenFixture,
  withBlock,
  without,
  type Block,
  type Template,
} from "./print-template-fixtures";

// The READ ceilings guard templates that are ALREADY stored: they may only grow, never shrink.
test("the READ ceilings are pinned to their literal values", () => {
  assert.deepEqual({ ...PRINT_TEMPLATE_READ_LIMITS }, { blocks: 64, customText: 240, qrUrl: 400, qrCaption: 120, qrBlocks: 8 });
});

test("every READ ceiling is at least its WRITE constant", () => {
  assert.ok(PRINT_TEMPLATE_READ_LIMITS.blocks >= PRINT_TEMPLATE_BLOCKS_MAX);
  assert.ok(PRINT_TEMPLATE_READ_LIMITS.customText >= PRINT_CUSTOM_TEXT_MAX);
  assert.ok(PRINT_TEMPLATE_READ_LIMITS.qrUrl >= PRINT_QR_URL_MAX);
  assert.ok(PRINT_TEMPLATE_READ_LIMITS.qrCaption >= PRINT_QR_CAPTION_MAX);
  assert.ok(PRINT_TEMPLATE_READ_LIMITS.qrBlocks >= PRINT_QR_BLOCKS_MAX);
});

const link = (url: string, caption?: string): Block => ({ content: "link", url, ...(caption === undefined ? {} : { caption }) });
const tokenWith = (...blocks: Block[]): Template => ({ ...tokenFixture(), blocks: [tokenFixture().blocks[1], ...blocks] });

test("over the WRITE caps but inside the READ ceilings: READ passes, WRITE fails", () => {
  const longUrl = `https://example.com/${"a".repeat(PRINT_QR_URL_MAX)}`; // 220 chars
  const over: [string, Template, string][] = [
    ["url", tokenWith(qr(1, link(longUrl))), "blocks.1.options.url"],
    ["customText", tokenWith(customText(1, "x".repeat(PRINT_CUSTOM_TEXT_MAX + 1))), "blocks.1.options.text"],
    ["caption", tokenWith(qr(1, link("https://example.com", "c".repeat(PRINT_QR_CAPTION_MAX + 1)))), "blocks.1.options.caption"],
    ["blocks", { ...tokenFixture(), blocks: [...tokenFixture().blocks, ...Array.from({ length: PRINT_TEMPLATE_BLOCKS_MAX }, (_, i) => divider(i + 2))] }, "blocks"],
    ["qr count", tokenWith(...Array.from({ length: PRINT_QR_BLOCKS_MAX + 1 }, (_, i) => qr(i + 1, link("https://example.com")))), `blocks.${PRINT_QR_BLOCKS_MAX + 1}`],
  ];
  for (const [label, template, path] of over) {
    accepts(tokenTemplateReadSchema, template, `read ${label}`);
    rejects(tokenTemplateSchema, template, path);
  }
  // the same holds for the other two kinds
  const kot = { ...kotFixture(), blocks: [...kotFixture().blocks, qr(1, link(longUrl))] };
  accepts(kotTemplateReadSchema, kot, "read kot url");
  rejects(kotTemplateSchema, kot, `blocks.${kotFixture().blocks.length}.options.url`);
  const bill = { ...billFixture(), blocks: [...billFixture().blocks, customText(1, "x".repeat(PRINT_CUSTOM_TEXT_MAX + 1))] };
  accepts(billTemplateReadSchema, bill, "read bill customText");
  rejects(billTemplateSchema, bill, `blocks.${billFixture().blocks.length}.options.text`);
});

test("READ keeps no content rule on the link: any string up to the ceiling reads", () => {
  for (const url of ["http://old.example.com", "https:example.com", "not a url", "https://user:pass@example.com", ""]) {
    accepts(tokenTemplateReadSchema, tokenWith(qr(1, link(url))), `read url ${url}`);
  }
  rejects(tokenTemplateReadSchema, tokenWith(qr(1, link("h".repeat(PRINT_TEMPLATE_READ_LIMITS.qrUrl + 1)))), "blocks.1.options.url");
});

test("READ still enforces the shape and the ceilings", () => {
  const u = PRINT_TEMPLATE_READ_LIMITS;
  rejects(tokenTemplateReadSchema, { ...tokenFixture(), blocks: Array.from({ length: u.blocks + 1 }, (_, i) => divider(i + 1)) }, "blocks");
  rejects(tokenTemplateReadSchema, tokenWith(...Array.from({ length: u.qrBlocks + 1 }, (_, i) => qr(i + 1, link("https://example.com")))), `blocks.${u.qrBlocks + 1}`);
  rejects(tokenTemplateReadSchema, tokenWith(customText(1, "x".repeat(u.customText + 1))), "blocks.1.options.text");
  rejects(tokenTemplateReadSchema, tokenWith(qr(1, link("https://example.com", "c".repeat(u.qrCaption + 1)))), "blocks.1.options.caption");
  rejects(tokenTemplateReadSchema, withBlock(tokenFixture(), 0, { extra: 1 }), "blocks.0");
  rejects(kotTemplateReadSchema, { ...kotFixture(), blocks: [...kotFixture().blocks, qr(1, { content: "upi" })] }, `blocks.${kotFixture().blocks.length}.options.content`);
  assert.deepEqual(billTemplateReadSchema.parse(billFixture()), billFixture());
});

// R6 (A4): the READ schemas live in schemas/print-template-read.schema.ts (the client's resolver imports only that
// module, so a receipt bundle never builds the WRITE gate); print-template.schema.ts re-exports them.
test("R6: the READ schemas print-template.schema.ts exports ARE the objects print-template-read.schema.ts builds (one instance, not a copy)", () => {
  assert.notEqual(billTemplateReadSchema, undefined, "landmark: the re-exported READ schema exists");
  assert.strictEqual(billTemplateReadSchema, readModule.billTemplateReadSchema);
  assert.strictEqual(kotTemplateReadSchema, readModule.kotTemplateReadSchema);
  assert.strictEqual(tokenTemplateReadSchema, readModule.tokenTemplateReadSchema);
  assert.strictEqual(PRINT_TEMPLATE_READ_LIMITS, readModule.PRINT_TEMPLATE_READ_LIMITS);
  // ...and the WRITE gate is a different, stricter schema built on the same shape.
  assert.notStrictEqual(billTemplateSchema, readModule.billTemplateReadSchema);
  assert.notStrictEqual(kotTemplateSchema, readModule.kotTemplateReadSchema);
  assert.notStrictEqual(tokenTemplateSchema, readModule.tokenTemplateReadSchema);
});

test("R6: a template missing a required block fails WRITE (the presence check) but still READS, for all three kinds", () => {
  const cases: [string, Template, z.ZodType<unknown>, z.ZodType<unknown>, string][] = [
    ["bill", without(billFixture(), "total"), billTemplateSchema, billTemplateReadSchema, "total"],
    ["kot", without(kotFixture(), "title"), kotTemplateSchema, kotTemplateReadSchema, "title"],
    ["token", without(tokenFixture(), "tokenNo"), tokenTemplateSchema, tokenTemplateReadSchema, "token no"],
  ];
  for (const [kind, template, write, read, plain] of cases) {
    assert.ok(write.safeParse(structuredClone(template)).success === false, `${kind}: WRITE rejects a missing required block`);
    assert.deepEqual(issuePaths(write, template), ["blocks"], `${kind}: the issue is the presence check on blocks`);
    assert.ok(write.safeParse(structuredClone(template)).error?.issues[0].message.includes(plain), `${kind}: it names the missing line`);
    accepts(read, template, `${kind} read without the required block`);
  }
  // Landmark: the complete fixtures pass BOTH, so the rejections above are the presence rule and nothing else.
  accepts(billTemplateSchema, billFixture(), "write bill");
  accepts(kotTemplateSchema, kotFixture(), "write kot");
  accepts(tokenTemplateSchema, tokenFixture(), "write token");
});

// S5 (owner, s79): table and items are locked on a void / moved slip, so a NEW save must keep both lines (on or off).
// A template stored before S5 may lack them: it must still READ (the resolver re-inserts them off), never go unreadable.
test("S5: a kot template without table (or without items) fails WRITE naming the line, and still READS", () => {
  for (const [type, plain] of [["table", "table"], ["items", "items"]] as const) {
    const template = without(kotFixture(), type);
    assert.ok(template.blocks.length === kotFixture().blocks.length - 1, `landmark: ${type} was really removed`);
    assert.ok(kotFixture().blocks.some((b) => b.type === type), `landmark: the complete fixture carries ${type}`);
    assert.equal(kotTemplateSchema.safeParse(structuredClone(template)).success, false, `WRITE rejects a kot without ${type}`);
    assert.deepEqual(issuePaths(kotTemplateSchema, template), ["blocks"], `${type}: the issue is the presence check on blocks`);
    assert.ok(kotTemplateSchema.safeParse(structuredClone(template)).error?.issues[0].message.includes(plain), `${type}: it names the missing line`);
    accepts(kotTemplateReadSchema, template, `read kot without ${type}`);
  }
  // Present-but-off is fine on WRITE (the switch stays free; only the line itself is required).
  const off = { ...kotFixture(), blocks: kotFixture().blocks.map((b) => (b.type === "table" || b.type === "items" ? { ...b, on: false } : b)) };
  accepts(kotTemplateSchema, off, "write kot with table + items present but off");
});
