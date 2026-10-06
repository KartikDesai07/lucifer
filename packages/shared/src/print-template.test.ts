import { test } from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";
import {
  BILL_BLOCK_TYPES,
  BILL_REQUIRED_BLOCKS,
  KOT_BLOCK_TYPES,
  KOT_REQUIRED_BLOCKS,
  PRINT_CUSTOM_TEXT_MAX,
  PRINT_TEMPLATE_BLOCKS_MAX,
  TOKEN_BLOCK_TYPES,
  TOKEN_REQUIRED_BLOCKS,
} from "./print-template";
import {
  billTemplateReadSchema,
  billTemplateSchema,
  kotTemplateReadSchema,
  kotTemplateSchema,
  tokenTemplateReadSchema,
  tokenTemplateSchema,
} from "./schemas/print-template.schema";
import {
  DIVIDER_AT,
  accepts,
  billFixture,
  customText,
  divider,
  indexOfType,
  kotFixture,
  plain,
  qr,
  rejects,
  tokenFixture,
  validBlock,
  withBlock,
  without,
  wrap,
  type Kind,
  type Template,
} from "./print-template-fixtures";

test("the three realistic fixtures parse, and the output equals the input", () => {
  assert.deepEqual(billTemplateSchema.parse(billFixture()), billFixture());
  assert.deepEqual(kotTemplateSchema.parse(kotFixture()), kotFixture());
  assert.deepEqual(tokenTemplateSchema.parse(tokenFixture()), tokenFixture());
  assert.deepEqual(billTemplateReadSchema.parse(billFixture()), billFixture());
});

test("every type of every catalog parses as a valid block (a type dropped from a union goes red)", () => {
  const kinds: [Kind, readonly string[], () => Template, z.ZodType<unknown>][] = [
    ["bill", BILL_BLOCK_TYPES, billFixture, billTemplateSchema],
    ["kot", KOT_BLOCK_TYPES, kotFixture, kotTemplateSchema],
    ["token", TOKEN_BLOCK_TYPES, tokenFixture, tokenTemplateSchema],
  ];
  for (const [kind, catalog, fixture, schema] of kinds) {
    for (const type of catalog) {
      const base = fixture();
      const template: Template = { ...base, blocks: [...without(base, type).blocks, validBlock(kind, type)] };
      accepts(schema, template, `${kind} ${type}`);
      assert.deepEqual(schema.parse(template), template, `${kind} ${type} round-trips`);
    }
  }
  // the bill's QR may also pay by UPI
  const base = billFixture();
  accepts(billTemplateSchema, { ...base, blocks: [...base.blocks, qr(1, { content: "upi", caption: "Pay" })] }, "bill upi qr");
});

test("unknown keys are rejected at every level", () => {
  rejects(billTemplateSchema, { ...billFixture(), extra: 1 }, "");
  rejects(billTemplateSchema, withBlock(billFixture(), 1, { extra: 1 }), "blocks.1");
  rejects(billTemplateSchema, withBlock(billFixture(), 1, { options: {} }), "blocks.1");
  rejects(billTemplateSchema, withBlock(billFixture(), 0, { options: { logoSize: "small", extra: 1 } }), "blocks.0.options");
  const items = indexOfType(kotFixture(), "items");
  rejects(kotTemplateSchema, withBlock(kotFixture(), items, { options: { prices: true, modifiers: true, instructions: true, extra: 1 } }), `blocks.${items}.options`);
});

test("every block variant is strict, not just the plain one", () => {
  // logo, divider, customText, qr (token fixture) and items (kot fixture) each reject a stray key
  const stray = { extra: 1 };
  rejects(billTemplateSchema, withBlock(billFixture(), 0, stray), "blocks.0");
  rejects(billTemplateSchema, withBlock(billFixture(), DIVIDER_AT, stray), `blocks.${DIVIDER_AT}`);
  rejects(tokenTemplateSchema, withBlock(tokenFixture(), 3, stray), "blocks.3");
  rejects(tokenTemplateSchema, withBlock(tokenFixture(), 4, stray), "blocks.4");
  const items = indexOfType(kotFixture(), "items");
  rejects(kotTemplateSchema, withBlock(kotFixture(), items, stray), `blocks.${items}`);
  rejects(billTemplateSchema, withBlock(billFixture(), DIVIDER_AT, { options: { style: "solid", extra: 1 } }), `blocks.${DIVIDER_AT}.options`);
  rejects(tokenTemplateSchema, withBlock(tokenFixture(), 3, { options: { text: "hi", extra: 1 } }), "blocks.3.options");
  rejects(tokenTemplateSchema, withBlock(tokenFixture(), 4, { options: { content: "link", url: "https://example.com", extra: 1 } }), "blocks.4.options");
});

test("version, design and kind-of-block are pinned to the kind", () => {
  rejects(billTemplateSchema, { ...billFixture(), v: 2 }, "v");
  rejects(billTemplateSchema, { ...billFixture(), design: "kitchenBold" }, "design");
  rejects(kotTemplateSchema, { ...kotFixture(), design: "modern" }, "design");
  rejects(tokenTemplateSchema, { ...tokenFixture(), design: "classic" }, "design");
  rejects(billTemplateSchema, { ...billFixture(), font: "comic" }, "font");
  rejects(billTemplateSchema, { ...billFixture(), size: "huge" }, "size");
  const bill = billFixture();
  bill.blocks.push(plain("kotNo"));
  rejects(billTemplateSchema, bill, `blocks.${bill.blocks.length - 1}.type`);
  const kot = kotFixture();
  kot.blocks.push(plain("subtotal"));
  rejects(kotTemplateSchema, kot, `blocks.${kot.blocks.length - 1}.type`);
});

test("style fields are checked", () => {
  accepts(billTemplateSchema, withBlock(billFixture(), 1, { align: "center", size: "lg", bold: true }));
  rejects(billTemplateSchema, withBlock(billFixture(), 1, { align: "middle" }), "blocks.1.align");
  rejects(billTemplateSchema, withBlock(billFixture(), 1, { size: "huge" }), "blocks.1.size");
  rejects(billTemplateSchema, withBlock(billFixture(), 1, { bold: "yes" }), "blocks.1.bold");
});

test("ids: unique, and a non-repeatable id must equal its type", () => {
  const dup = billFixture();
  dup.blocks.push(divider(1));
  rejects(billTemplateSchema, dup, `blocks.${dup.blocks.length - 1}.id`);
  rejects(billTemplateSchema, withBlock(billFixture(), 1, { id: "nameX" }), "blocks.1.id");
  for (const id of ["divider", "divider-0", "divider-01", "divider-1000", "divider-x"]) {
    rejects(billTemplateSchema, withBlock(billFixture(), DIVIDER_AT, { id }), `blocks.${DIVIDER_AT}.id`);
  }
  for (const id of ["divider-1", "divider-999"]) accepts(billTemplateSchema, withBlock(billFixture(), DIVIDER_AT, { id }), id);
});

test("size caps: 40 lines, 3 QR codes", () => {
  const forty = tokenFixture();
  while (forty.blocks.length < PRINT_TEMPLATE_BLOCKS_MAX) forty.blocks.push(divider(forty.blocks.length + 1));
  accepts(tokenTemplateSchema, forty);
  rejects(tokenTemplateSchema, { ...forty, blocks: [...forty.blocks, divider(99)] }, "blocks");
  const url = { content: "link", url: "https://example.com" };
  const three = { ...tokenFixture(), blocks: [plain("tokenNo"), qr(1, url), qr(2, url), qr(3, url)] };
  accepts(tokenTemplateSchema, three);
  rejects(tokenTemplateSchema, { ...three, blocks: [...three.blocks, qr(4, url)] }, "blocks.4");
});

test("customText: trimmed, 1..120", () => {
  const at = (text: string): Template => ({ ...tokenFixture(), blocks: [plain("tokenNo"), customText(1, text)] });
  accepts(tokenTemplateSchema, at("x".repeat(PRINT_CUSTOM_TEXT_MAX)));
  assert.equal(
    (tokenTemplateSchema.parse(at("  hi  ")).blocks[1] as unknown as { options: { text: string } }).options.text,
    "hi",
  );
  for (const text of ["", "   ", "x".repeat(PRINT_CUSTOM_TEXT_MAX + 1)]) {
    rejects(tokenTemplateSchema, at(text), "blocks.1.options.text");
  }
  rejects(tokenTemplateSchema, wrap("bigNumber", [plain("tokenNo"), { id: "customText-1", on: true, type: "customText" }]), "blocks.1.options");
});

test("required lines: removing any one is rejected by the write gate", () => {
  assert.ok(BILL_REQUIRED_BLOCKS.includes("title"), "the bill's title is required now");
  for (const type of BILL_REQUIRED_BLOCKS) rejects(billTemplateSchema, without(billFixture(), type), "blocks");
  for (const type of KOT_REQUIRED_BLOCKS) rejects(kotTemplateSchema, without(kotFixture(), type), "blocks");
  for (const type of TOKEN_REQUIRED_BLOCKS) rejects(tokenTemplateSchema, without(tokenFixture(), type), "blocks");
  rejects(kotTemplateSchema, without(kotFixture(), "title"), "blocks");
  rejects(tokenTemplateSchema, without(tokenFixture(), "tokenNo"), "blocks");
});

test("read vs write: a missing required line passes the READ schema and fails the WRITE gate", () => {
  for (const type of ["gstin", "title"]) {
    accepts(billTemplateReadSchema, without(billFixture(), type), `read, no ${type}`);
    rejects(billTemplateSchema, without(billFixture(), type), "blocks");
  }
  accepts(kotTemplateReadSchema, without(kotFixture(), "title"), "read, kot without title");
  rejects(kotTemplateSchema, without(kotFixture(), "title"), "blocks");
  accepts(tokenTemplateReadSchema, without(tokenFixture(), "tokenNo"), "read, token without tokenNo");
  rejects(tokenTemplateSchema, without(tokenFixture(), "tokenNo"), "blocks");
  // the read schema still enforces shape and ids
  rejects(billTemplateReadSchema, { ...billFixture(), v: 2 }, "v");
  rejects(billTemplateReadSchema, withBlock(billFixture(), 1, { id: "nameX" }), "blocks.1.id");
});

test("options are required where the type has them", () => {
  const items = indexOfType(kotFixture(), "items");
  const noOptions = { ...kotFixture(), blocks: kotFixture().blocks.map((b, i) => (i === items ? { id: "items", on: true, type: "items" } : b)) };
  rejects(kotTemplateSchema, noOptions, `blocks.${items}.options`);
  rejects(kotTemplateSchema, withBlock(kotFixture(), items, { options: { prices: true, modifiers: true } }), `blocks.${items}.options.instructions`);
  const noLogoOptions = { ...billFixture(), blocks: billFixture().blocks.map((b, i) => (i === 0 ? { id: "logo", on: true, type: "logo" } : b)) };
  rejects(billTemplateSchema, noLogoOptions, "blocks.0.options");
  rejects(billTemplateSchema, withBlock(billFixture(), 0, { options: { logoSize: "huge" } }), "blocks.0.options.logoSize");
  // a bill's "items" is a plain line: the kitchen's options do not belong on it
  const billItems = indexOfType(billFixture(), "items");
  rejects(billTemplateSchema, withBlock(billFixture(), billItems, { options: { prices: true, modifiers: true, instructions: true } }), `blocks.${billItems}`);
  accepts(billTemplateSchema, withBlock(billFixture(), DIVIDER_AT, { options: { style: "double" } }));
  rejects(billTemplateSchema, withBlock(billFixture(), DIVIDER_AT, { options: { style: "wavy" } }), `blocks.${DIVIDER_AT}.options.style`);
});
