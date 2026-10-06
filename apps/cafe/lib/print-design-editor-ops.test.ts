import { settingsOf } from "./print-template-golden.fixtures"; // FIRST (selects React's production renderer; harmless here)
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrayMove } from "@dnd-kit/sortable";

import {
  BILL_REQUIRED_BLOCKS,
  BILL_BLOCK_TYPES,
  PRINT_QR_BLOCKS_MAX,
  PRINT_TEMPLATE_BLOCKS_MAX,
  REPEATABLE_BLOCK_TYPES,
  isValidBlockId,
  type BillTemplate,
} from "@pos/shared/print-template";
import { billTemplateSchema } from "@pos/shared/schemas/print-template.schema";
import {
  BILL_EDITOR,
  EDITOR_HIDDEN_BLOCK_TYPES,
  activate,
  addCheck,
  addRepeatable,
  moveBlock,
  moveBlockTo,
  removeBlock,
  setBaseSize,
  setBlockOn,
  setBlockStyle,
  setCustomText,
  setDividerStyle,
  setFont,
  setLogoSize,
  setQrOptions,
  templatesEqual,
  writeProblems,
} from "@/lib/print-design-editor";

// Print customization S4 (04-S4-plan §5): the editor's pure operations. Every op returns a NEW template, and the SAME
// object when nothing changes. The random walk and the plain-words write problems: print-design-editor-walk.test.ts.

const start = (design: BillTemplate["design"] = "modern"): BillTemplate => activate(BILL_EDITOR, design, settingsOf()).template;
const UPI = { upiId: "cafe@upi" };
const valid = (t: BillTemplate): boolean => billTemplateSchema.safeParse(t).success;
const ids = (t: BillTemplate): string[] => t.blocks.map((b) => b.id);
const blockOf = (t: BillTemplate, id: string) => {
  const found = t.blocks.find((b) => b.id === id);
  assert.ok(found, `landmark: block ${id} exists`);
  return found;
};
const optionsOf = (t: BillTemplate, id: string): unknown => (blockOf(t, id) as { options?: unknown }).options;
/** Adds repeatables of `type` the way the UI does (addCheck first) until the cap says no. */
function fill(t: BillTemplate, type: "divider" | "customText" | "qr", until: number): BillTemplate {
  let next = t;
  while (next.blocks.length < until && addCheck(next, type).ok) next = addRepeatable(next, type, UPI).template;
  return next;
}

// ── Caps ─────────────────────────────────────────────────────────────────────

test("caps: the 4th QR is refused with a plain reason, and the WRITE gate agrees on both sides of the cap", () => {
  const one = start();
  assert.equal(one.blocks.filter((b) => b.type === "qr").length, 1, "landmark: Modern starts with one QR");
  const three = fill(one, "qr", PRINT_TEMPLATE_BLOCKS_MAX);
  assert.equal(three.blocks.filter((b) => b.type === "qr").length, PRINT_QR_BLOCKS_MAX);
  assert.ok(valid(three), "three QR codes (UPI, no caption) are WRITE-valid");
  const refused = addCheck(three, "qr");
  assert.ok(!refused.ok && refused.reason.includes(String(PRINT_QR_BLOCKS_MAX)), "the reason names the limit");
  assert.ok(!refused.ok && !refused.reason.includes("blocks."), "and is words, not a path");
  assert.equal(addCheck(three, "divider").ok, true, "a divider is still fine at the QR cap");
  const forced = addRepeatable(three, "qr", UPI);
  assert.ok(!valid(forced.template), "landmark: a 4th QR really is rejected by the schema");
  assert.deepEqual(writeProblems(BILL_EDITOR, forced.template).map((p) => p.blockId), [forced.id], "reported on the 4th QR's own row");
});

test("caps: at PRINT_TEMPLATE_BLOCKS_MAX every add is refused with a reason; one removal reopens it; the 41st is schema-invalid", () => {
  const full = fill(start(), "divider", PRINT_TEMPLATE_BLOCKS_MAX);
  assert.equal(full.blocks.length, PRINT_TEMPLATE_BLOCKS_MAX);
  assert.ok(valid(full), "exactly at the cap is WRITE-valid");
  for (const type of REPEATABLE_BLOCK_TYPES) {
    const check = addCheck(full, type);
    assert.ok(!check.ok && check.reason.includes(String(PRINT_TEMPLATE_BLOCKS_MAX)), `${type}: refused at the cap, naming it`);
  }
  assert.ok(addCheck(removeBlock(full, "divider-5"), "divider").ok, "removing a divider frees a slot");
  assert.equal(removeBlock(full, "divider-5").blocks.length, PRINT_TEMPLATE_BLOCKS_MAX - 1);
  const over = addRepeatable(full, "divider", UPI).template;
  assert.equal(over.blocks.length, PRINT_TEMPLATE_BLOCKS_MAX + 1);
  assert.ok(!valid(over), "landmark: one past the cap is rejected by the schema");
  assert.deepEqual(writeProblems(BILL_EDITOR, over), [{ blockId: null, message: `Keep it under ${PRINT_TEMPLATE_BLOCKS_MAX + 1} lines` }]);
});

test("ids: type-(max+1), never reused after a removal, unique, valid, counted per type", () => {
  const t0 = start("classic"); // divider-1..4
  assert.deepEqual(t0.blocks.filter((b) => b.type === "divider").map((b) => b.id), ["divider-1", "divider-2", "divider-3", "divider-4"]);
  const removed = removeBlock(t0, "divider-2");
  const a = addRepeatable(removed, "divider", UPI);
  assert.equal(a.id, "divider-5", "one past the highest in use, not the freed divider-2");
  const b = addRepeatable(a.template, "customText", UPI);
  assert.equal(b.id, "customText-1", "each type counts on its own");
  const c = addRepeatable(b.template, "customText", UPI);
  assert.equal(c.id, "customText-2");
  assert.equal(new Set(ids(c.template)).size, ids(c.template).length, "ids stay unique");
  for (const block of c.template.blocks) assert.ok(isValidBlockId(block.type, block.id), `${block.id} is a valid id`);
  assert.equal(c.template.blocks[c.template.blocks.length - 1].id, "customText-2", "added at the end");
});

test("ids: past the id ceiling the smallest free n is used (998 -> 999 -> then the gaps), every id still valid", () => {
  const t0 = start("classic");
  const high = { ...t0, blocks: t0.blocks.map((b) => (b.id === "divider-4" ? { ...b, id: "divider-998" } : b)) };
  assert.ok(valid(high), "landmark: divider-998 is a valid id");
  const first = addRepeatable(high, "divider", UPI);
  assert.equal(first.id, "divider-999", "998 + 1 is still within the ceiling");
  const second = addRepeatable(first.template, "divider", UPI);
  assert.equal(second.id, "divider-4", "999 is the ceiling: the smallest free n is taken instead of divider-1000");
  const third = addRepeatable(second.template, "divider", UPI);
  assert.equal(third.id, "divider-5");
  assert.ok(valid(third.template) && new Set(ids(third.template)).size === ids(third.template).length);
});

// ── Removing ─────────────────────────────────────────────────────────────────

test("removeBlock: a required or fixed line is never removed (same object back); a repeatable one goes; an unknown id is a no-op", () => {
  for (const design of ["classic", "modern", "express", "cafe"] as const) {
    const t = start(design);
    for (const required of BILL_REQUIRED_BLOCKS) assert.equal(removeBlock(t, required), t, `${design}: ${required} cannot be removed`);
    for (const type of BILL_BLOCK_TYPES.filter((x) => !(REPEATABLE_BLOCK_TYPES as readonly string[]).includes(x))) {
      assert.equal(removeBlock(t, type), t, `${design}: ${type} is switched off, not removed`);
    }
    assert.equal(removeBlock(t, "no-such-id"), t);
  }
  const t = start("express");
  const gone = removeBlock(t, "divider-3");
  assert.deepEqual(ids(gone), ids(t).filter((id) => id !== "divider-3"), "landmark: only that divider went, order kept");
  assert.ok(valid(gone));
});

// ── Moving ───────────────────────────────────────────────────────────────────

test("moveBlock: the first row up and the last row down are no-ops (same object), unknown id too; a step swaps neighbours", () => {
  const t = start();
  const hidden = EDITOR_HIDDEN_BLOCK_TYPES;
  assert.equal(moveBlock(t, t.blocks[0].id, -1, hidden), t);
  assert.equal(moveBlock(t, t.blocks[t.blocks.length - 1].id, 1, hidden), t);
  assert.equal(moveBlock(t, "no-such-id", 1, hidden), t);
  const down = moveBlock(t, t.blocks[0].id, 1, []);
  assert.deepEqual(ids(down).slice(0, 2), [t.blocks[1].id, t.blocks[0].id], "landmark: a real move swaps the pair");
  assert.deepEqual(ids(moveBlock(down, t.blocks[0].id, -1, [])), ids(t), "and moving back restores the order");
});

test("moveBlock: a hidden (token) row is stepped over in both directions, and is not a landing spot at the edges", () => {
  const t = start();
  const pick = (type: string) => blockOf(t, type);
  const tiny = (...types: string[]): BillTemplate => ({ ...t, blocks: types.map(pick) });
  const hidden = ["token"];
  const order = tiny("name", "token", "tagline", "address");
  assert.deepEqual(ids(moveBlock(order, "tagline", -1, hidden)), ["tagline", "name", "token", "address"], "up skips token, lands where name was");
  assert.deepEqual(ids(moveBlock(order, "tagline", -1, [])), ["name", "tagline", "token", "address"], "landmark: without the hidden list it lands on token's old spot");
  assert.deepEqual(ids(moveBlock(order, "name", 1, hidden)), ["token", "tagline", "name", "address"], "down skips token");
  const headed = tiny("token", "name", "tagline");
  assert.equal(moveBlock(headed, "name", -1, hidden), headed, "only a hidden row above: nothing to move to");
  assert.deepEqual(ids(moveBlock(headed, "name", -1, [])), ["name", "token", "tagline"], "landmark: it would have moved without the hidden list");
  const tailed = tiny("name", "tagline", "token");
  assert.equal(moveBlock(tailed, "tagline", 1, hidden), tailed, "only a hidden row below: nothing to move to");
});

test("moveBlockTo: equals @dnd-kit's arrayMove for every (from, to) pair; same row / unknown id is a no-op", () => {
  const t = start();
  const n = t.blocks.length;
  assert.ok(n > 30, `landmark: a real design (${n} lines)`);
  let moved = 0;
  for (let from = 0; from < n; from++) {
    for (let to = 0; to < n; to++) {
      const result = moveBlockTo(t, t.blocks[from].id, t.blocks[to].id);
      if (from === to) {
        assert.equal(result, t);
        continue;
      }
      assert.deepEqual(result.blocks, arrayMove(t.blocks, from, to), `move ${from} -> ${to}`);
      moved++;
    }
  }
  assert.equal(moved, n * (n - 1));
  assert.equal(moveBlockTo(t, "no-such-id", t.blocks[0].id), t);
  assert.equal(moveBlockTo(t, t.blocks[0].id, "no-such-id"), t);
});

// ── Style and option setters ─────────────────────────────────────────────────

test("setBlockStyle: a null deletes the key (absent, not undefined), per field and as a whole patch; false is kept", () => {
  const t = start();
  const styled = setBlockStyle(t, "name", { align: "right", size: "lg", bold: true });
  assert.deepEqual(Object.keys(blockOf(styled, "name")).sort(), ["align", "bold", "id", "on", "size", "type"]);
  const noAlign = blockOf(setBlockStyle(styled, "name", { align: null }), "name");
  assert.ok(!Object.hasOwn(noAlign, "align"), "the key is gone, not set to undefined");
  assert.ok(noAlign.size === "lg" && noAlign.bold === true, "the other fields stay");
  const plain = blockOf(setBlockStyle(styled, "name", null), "name");
  assert.deepEqual(Object.keys(plain).sort(), ["id", "on", "type"], "a whole-patch null removes all three");
  const boldFalse = blockOf(setBlockStyle(styled, "name", { bold: false }), "name");
  assert.ok(Object.hasOwn(boldFalse, "bold") && boldFalse.bold === false, "bold:false is a choice, kept");
  assert.ok(!Object.hasOwn(blockOf(setBlockStyle(styled, "name", { bold: null }), "name"), "bold"));
  assert.equal(blockOf(setBlockStyle(styled, "name", { size: "sm" }), "name").align, "right", "an omitted field is left alone");
  assert.ok(templatesEqual(setBlockStyle(t, "name", null), t), "clearing an unstyled line changes nothing");
  assert.equal(setBlockStyle(t, "no-such-id", { bold: true }), t);
  assert.ok(valid(styled));
});

test("setters: same value changes nothing; the typed text is kept untrimmed; wrong-type targets are inert", () => {
  const t = start();
  assert.ok(templatesEqual(setBlockOn(t, "tagline", blockOf(t, "tagline").on), t), "setting a line to the value it has changes nothing (a new object, an equal template)");
  assert.equal(setBlockOn(t, "no-such-id", true), t);
  assert.equal(setFont(t, t.font), t);
  assert.equal(setBaseSize(t, t.size), t);
  assert.equal(setFont(t, "mono").font, "mono");
  assert.equal(setBaseSize(t, "large").size, "large");

  assert.ok(templatesEqual(setLogoSize(t, "name", "large"), t), "setLogoSize on a non-logo line does nothing");
  assert.deepEqual(optionsOf(setLogoSize(t, "logo", "large"), "logo"), { logoSize: "large" });
  assert.ok(templatesEqual(setDividerStyle(t, "name", "solid"), t), "setDividerStyle on a non-divider does nothing");
  const solid = setDividerStyle(t, "divider-1", "solid");
  assert.deepEqual(optionsOf(solid, "divider-1"), { style: "solid" });
  assert.ok(!Object.hasOwn(blockOf(setDividerStyle(solid, "divider-1", null), "divider-1"), "options"), "null removes options (the design's own divider)");
  assert.ok(templatesEqual(setCustomText(t, "name", "hi"), t), "setCustomText on a non-text line does nothing");
  assert.ok(templatesEqual(setQrOptions(t, "name", { content: "upi" }), t), "setQrOptions on a non-QR line does nothing");

  const withText = addRepeatable(t, "customText", UPI);
  const typed = setCustomText(withText.template, withText.id, "  Thank you  ");
  assert.deepEqual(optionsOf(typed, withText.id), { text: "  Thank you  " }, "kept as typed (the save gate trims)");
  assert.deepEqual(writeProblems(BILL_EDITOR, typed), [], "and a padded text is WRITE-valid");
  const qr = setQrOptions(t, "qr-1", { content: "link", url: "https://example.com/menu", caption: "Menu" });
  assert.deepEqual(optionsOf(qr, "qr-1"), { content: "link", url: "https://example.com/menu", caption: "Menu" });
  assert.ok(valid(qr));
});

test("addRepeatable: what a new line starts as (divider plain, text empty, QR = UPI only when the UPI ID is valid, else an empty link), appended on", () => {
  const t = start();
  const divider = addRepeatable(t, "divider", UPI);
  assert.deepEqual(divider.template.blocks[t.blocks.length], { id: divider.id, type: "divider", on: true });
  const text = addRepeatable(t, "customText", UPI);
  assert.deepEqual(optionsOf(text.template, text.id), { text: "" });
  assert.equal(blockOf(text.template, text.id).on, true);
  for (const bad of [{ upiId: "" }, { upiId: "not a upi" }, { upiId: null }, {}, null, undefined]) {
    const qr = addRepeatable(t, "qr", bad);
    assert.deepEqual(optionsOf(qr.template, qr.id), { content: "link", url: "" }, `no valid UPI ID (${JSON.stringify(bad)}): a link line to fill in`);
  }
  const upi = addRepeatable(t, "qr", UPI);
  assert.deepEqual(optionsOf(upi.template, upi.id), { content: "upi" });
  assert.deepEqual(writeProblems(BILL_EDITOR, upi.template), [], "a UPI QR is complete as added");
  assert.deepEqual(writeProblems(BILL_EDITOR, text.template).map((p) => p.blockId), [text.id], "an empty text is reported on its own row");
  const emptyLink = addRepeatable(t, "qr", {});
  assert.deepEqual(writeProblems(BILL_EDITOR, emptyLink.template).map((p) => p.blockId), [emptyLink.id], "an empty link is reported on its own row");
  assert.equal(t.blocks.length, ids(t).length, "the source template is untouched");
});
