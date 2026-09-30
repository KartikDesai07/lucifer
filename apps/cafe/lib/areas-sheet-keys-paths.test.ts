// Source pins for the Areas manager's keyboard behaviour (Tables batch 2 review
// fixes, 2026-09-30): Escape during a keyboard drag cancels the drag and not the
// sheet, Escape on the rename form (so also from Save / Cancel), and focus back to
// the "New area" box after an add. (areas-sheet-paths.test.ts holds the rest of the
// sheet's pins and was kept under 300 lines.) No React test framework here by
// design: each pin is a checker over a source string, run on the real file AND
// proven to FAIL on a deliberately broken copy (MUTATION test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rawOf = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readSrc = (rel: string): string => stripComments(rawOf(rel));

const SHEET = "apps/cafe/components/tables/AreasSheet.tsx";
const ROW = "apps/cafe/components/tables/AreaRow.tsx";
// dnd-kit's own source: the mark the sheet's guard reads is defined here.
const DND_CORE = "node_modules/@dnd-kit/core/dist/core.esm.js";

const count = (src: string, needle: string): number => src.split(needle).length - 1;
const norm = (s: string): string => s.replace(/\s+/g, " ");

function bodyOf(src: string, header: string): string {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `landmark: ${header} must exist`);
  const open = src.indexOf("{", start + header.length - 1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("bodyOf: unbalanced braces");
}

/** The opening tag around `idx`, brace-aware (an arrow's `=>` does not end it). */
function tagAround(src: string, idx: number): string {
  const start = src.lastIndexOf("<", idx);
  assert.ok(start >= 0, "landmark: an opening tag precedes the needle");
  let depth = 0;
  for (let end = start; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}") depth--;
    else if (src[end] === ">" && depth === 0) return src.slice(start, end + 1);
  }
  throw new Error("tagAround: unterminated tag");
}

/** Every needle exists exactly once and they appear in the given order. */
function inOrder(src: string, label: string, needles: readonly string[]): void {
  let last = -1;
  for (const needle of needles) {
    assert.equal(count(src, needle), 1, `${label}: landmark must appear exactly once: ${needle}`);
    const at = src.indexOf(needle);
    assert.ok(at > last, `${label}: out of order at: ${needle}`);
    last = at;
  }
}

/** Whitespace-tolerant replace; the anchor must match exactly once. */
function mutate(src: string, from: string, to: string): string {
  const pattern = new RegExp(
    from
      .split(/(\s+)/)
      .map((p) => (/^\s+$/.test(p) ? "\\s+" : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join(""),
    "g",
  );
  assert.equal(src.match(pattern)?.length ?? 0, 1, `mutation anchor must match exactly once: ${from}`);
  return src.replace(pattern, () => to);
}

// 1. Escape during a keyboard drag: dnd-kit marks the grip it is moving
// aria-pressed="true" (useDraggable's attributes), so the sheet stays open then.
function checkDragEscapeGuard(sheet: string, dndCore: string): void {
  assert.ok(dndCore.includes("'aria-pressed': isDragging"), "landmark: dnd-kit still marks the dragged handle aria-pressed");
  assert.ok(norm(sheet).includes(`const ACTIVE_DRAG_SELECTOR = '[aria-pressed="true"]';`), "the selector is dnd-kit's drag mark");
  const handler = bodyOf(sheet, "onEscapeKeyDown={(e) => {");
  assert.ok(
    norm(handler).includes("if (e.target instanceof Element && e.target.closest(ACTIVE_DRAG_SELECTOR)) e.preventDefault();"),
    "Escape inside an active drag keeps the sheet open",
  );
}
test("PIN: Escape during a keyboard drag cancels the drag, not the sheet (dnd-kit's aria-pressed mark)", () => {
  checkDragEscapeGuard(readSrc(SHEET), rawOf(DND_CORE));
});

// 2. The rename's Escape handler sits on the form, so it also works from Save / Cancel.
function checkFormEscape(row: string): void {
  assert.match(row, /<form[^>]*onKeyDown=\{onFormKeyDown\}/, "the rename form owns the Escape handler");
  assert.equal(count(row, "onKeyDown="), 1, "landmark: one key handler, on the form only");
  assert.ok(!tagAround(row, row.indexOf('aria-label="Area name"')).includes("onKeyDown"), "the Input itself has no key handler");
  assert.match(bodyOf(row, "const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {"), /event\.key === "Escape"[\s\S]*cancelRename\(\)/, "Escape cancels");
}
test("PIN: Escape cancels the rename from anywhere in the form (Save and Cancel included)", () => checkFormEscape(readSrc(ROW)));

// 3. After a successful add the keyboard returns to the name box (the button disables itself).
function checkAddFocus(sheet: string): void {
  inOrder(bodyOf(sheet, "const submit = async (event: FormEvent) => {"), "add submit", [
    "await create.mutateAsync({ name: parsed.data });",
    'setName("");',
    "nameInput.current?.focus();",
    "} catch {",
  ]);
  assert.ok(/<Input[^>]*\bref=\{nameInput\}/.test(sheet), "the name box carries the ref");
}
test("PIN: a successful add puts focus back on the New area box", () => checkAddFocus(readSrc(SHEET)));

// MUTATION proofs
test("MUTATION: drag-escape, form-escape and add-focus pins", () => {
  const sheet = readSrc(SHEET);
  const row = readSrc(ROW);
  const dnd = rawOf(DND_CORE);
  const dragLine = "if (e.target instanceof Element && e.target.closest(ACTIVE_DRAG_SELECTOR)) e.preventDefault();";
  assert.throws(() => checkDragEscapeGuard(mutate(sheet, dragLine, ""), dnd), /keeps the sheet open/);
  assert.throws(() => checkDragEscapeGuard(mutate(sheet, dragLine, dragLine.replace("e.preventDefault()", "e.stopPropagation()")), dnd), /keeps the sheet open/);
  assert.throws(() => checkDragEscapeGuard(mutate(sheet, `'[aria-pressed="true"]'`, `'[aria-grabbed="true"]'`), dnd), /drag mark/);
  assert.throws(() => checkDragEscapeGuard(sheet, dnd.replace("'aria-pressed': isDragging", "'aria-x': isDragging")), /still marks/);

  // back on the Input (or gone from the form) fails
  const onForm = "onKeyDown={onFormKeyDown} noValidate";
  assert.throws(() => checkFormEscape(mutate(row, onForm, "noValidate")), /owns the Escape handler/);
  const onInput = mutate(row, onForm, "noValidate").replace('aria-label="Area name"', 'onKeyDown={onFormKeyDown} aria-label="Area name"');
  assert.throws(() => checkFormEscape(onInput), /owns the Escape handler/);
  assert.throws(() => checkFormEscape(mutate(row, 'aria-label="Area name"', 'onKeyDown={onFormKeyDown} aria-label="Area name"')), /one key handler/);
  assert.throws(() => checkFormEscape(mutate(row, 'event.key === "Escape"', 'event.key === "Esc"')), /Escape cancels/);

  assert.throws(() => checkAddFocus(mutate(sheet, "nameInput.current?.focus();", "")), /add submit/);
  assert.throws(() => checkAddFocus(mutate(sheet, "ref={nameInput}", "")), /carries the ref/);
  assert.throws(
    () => checkAddFocus(mutate(mutate(sheet, "nameInput.current?.focus();", ""), 'setName("");', 'nameInput.current?.focus(); setName("");')),
    /out of order/,
  );
});
