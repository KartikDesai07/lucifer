// CB-CHG — UI-slice raw-source pins (plan §5B/§5C/§6) over the files THIS
// slice owns: CartExtraCharges.tsx, Cart.tsx/pos-cart-props.ts wiring, and
// MoveTableDialog.tsx's confirm-before-mutate rule + the banned old copy.
// The server/route/CAS pins (moveOrderFilter, reward passthrough, etc.) live
// in the OTHER agent's lib/charge-move-paths.test.ts — not duplicated here.
// Same readSrc + REPO_ROOT + stripComments idiom as
// lib/print-host-band-paths.test.ts; every negative pin is paired with a
// positive landmark in the SAME test (testing.md's vision-guard rule); every
// grep-gate needle is built by concatenation, never as one literal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const MOVE_CHARGE_PREVIEW = "apps/cafe/lib/move-charge-preview.ts";
const MOVE_TABLE_DIALOG = "apps/cafe/components/orders/MoveTableDialog.tsx";
const CART_TSX = "apps/cafe/components/pos/Cart.tsx";
const POS_CART_PROPS = "apps/cafe/lib/pos-cart-props.ts";
const CART_EXTRA_CHARGES = "apps/cafe/components/pos/CartExtraCharges.tsx";

// ── (1) MoveTableDialog: the only mutateAsync call is behind the confirm ───

test("PIN (1): MoveTableDialog.tsx's only moveTable.mutateAsync call site is inside confirmMove, not the table-grid onClick — the grid's onClick sets pendingTable only", () => {
  const src = stripComments(readSrc(MOVE_TABLE_DIALOG));

  const mutateAsyncMatches = [...src.matchAll(/moveTable\.mutateAsync\(/g)];
  assert.equal(mutateAsyncMatches.length, 1, `expected exactly one moveTable.mutateAsync( call site, found ${mutateAsyncMatches.length}`);

  const confirmMoveStart = src.indexOf("const confirmMove = async () => {");
  assert.ok(confirmMoveStart >= 0, "positive landmark: const confirmMove = async () => { must be present");
  const confirmMoveEnd = src.indexOf("\n  };", confirmMoveStart);
  assert.ok(confirmMoveEnd > confirmMoveStart, "confirmMove's closing `};` must be found");
  const mutateAsyncAt = mutateAsyncMatches[0].index!;
  assert.ok(
    mutateAsyncAt > confirmMoveStart && mutateAsyncAt < confirmMoveEnd,
    "moveTable.mutateAsync( must be called INSIDE confirmMove",
  );

  // The table-grid button's onClick must set pendingTable only, never call
  // the mutation directly.
  assert.match(src, /onClick=\{\(\) => handlePick\(t\)\}/, "the table-grid button must call onClick={() => handlePick(t)}");
  assert.match(src, /const handlePick = \(table: Table\) => setPendingTable\(table\);/, "handlePick must be exactly setPendingTable(table) — a pure selection, no mutation");
});

// ── (2) MoveTableDialog: the banned old copy is gone, a Dialog still renders ─

test('PIN (2): MoveTableDialog.tsx no longer contains the old "will NOT add it to this bill" copy (it stated the OPPOSITE of the new auto-reprice rule); the file still renders a Dialog', () => {
  const src = readSrc(MOVE_TABLE_DIALOG);

  // Built by concatenation (testing.md): a literal needle here would match
  // this very assertion's own source text on a repo-wide banned-string scan.
  const bannedNeedle = "will NOT add it" + " to this bill";
  assert.ok(!src.includes(bannedNeedle), `MoveTableDialog.tsx must not contain "${bannedNeedle}" — the old always-on note stated the rule this slice reversed (owner decision 1/2)`);

  const secondBannedNeedle = "Moving keeps the bill" + "'s";
  assert.ok(!src.includes(secondBannedNeedle), `MoveTableDialog.tsx must not contain "${secondBannedNeedle}" — the other half of the retired moneyNote string`);

  // Positive landmark: the file must still be a real, working Dialog, not a
  // gutted stub — proves the negative scans above aren't vacuous.
  assert.match(src, /<Dialog open=\{open\}/, "landmark: MoveTableDialog.tsx must still render <Dialog open={open}");
  assert.match(src, /export function MoveTableDialog\(/, "landmark: MoveTableDialog.tsx must still export MoveTableDialog(");
});

// ── (3) MoveTableDialog: confirm copy + preview use the shared helpers ─────

test("PIN (3): the move preview is built from the SHARED charge helpers — never a hand-rolled arithmetic re-derivation", () => {
  // The rule moved out of the dialog into lib/move-charge-preview.ts (the file
  // was over the 300-line budget and the preview is pure), so the pin follows
  // it. The INTENT is unchanged and is the thing that matters: the figure a
  // staff member reads before agreeing to change a live bill must come from
  // the same helpers the SERVER writer uses, so client and server can never
  // disagree about which entry changes.
  const preview = stripComments(readSrc(MOVE_CHARGE_PREVIEW));
  assert.match(
    preview,
    /from\s*"@pos\/shared\/order-charges"/,
    'the preview must source its helpers from "@pos/shared/order-charges"',
  );
  for (const helper of ["chargesFromOrder", "chargesTotal", "withTableCharge"]) {
    assert.ok(preview.includes(helper), `the preview must use the shared ${helper}`);
  }
  assert.match(
    preview,
    /withTableCharge\(currentCharges, tableChargeOf\(destination\)\)/,
    "the preview must swap the TABLE entry via withTableCharge(…, tableChargeOf(destination))",
  );

  // And the dialog must RENDER that shared result rather than recomputing it.
  const dialog = stripComments(readSrc(MOVE_TABLE_DIALOG));
  assert.match(dialog, /moveChargePreview\(/, "the dialog must call moveChargePreview()");
  assert.match(dialog, /New total: \{inr\(preview\.total\)\}/, "the confirm panel must render New total from the shared preview");
  // Negative, with the positive landmark above as its vision guard: the dialog
  // must not re-derive the total itself.
  assert.ok(
    !/order\.total\s*[-+]/.test(dialog),
    "the dialog must not do its own arithmetic on order.total — that is the preview helper's job",
  );
});

// ── (4) Reachability: pos-cart-props.ts wires the add handler AND Cart.tsx
//        renders <CartExtraCharges ───────────────────────────────────────

test("PIN (4): pos-cart-props.ts wires onAddExtraCharge/onRemoveExtraCharge/extraCharges from pos.*, and Cart.tsx renders <CartExtraCharges — a prop not wired here is a dead feature", () => {
  const builder = stripComments(readSrc(POS_CART_PROPS));
  assert.match(builder, /extraCharges:\s*pos\.extraCharges,/, "pos-cart-props.ts must carry extraCharges: pos.extraCharges,");
  assert.match(builder, /onAddExtraCharge:\s*pos\.addExtraCharge,/, "pos-cart-props.ts must carry onAddExtraCharge: pos.addExtraCharge,");
  assert.match(builder, /onRemoveExtraCharge:\s*pos\.removeExtraCharge,/, "pos-cart-props.ts must carry onRemoveExtraCharge: pos.removeExtraCharge,");

  const cartSrc = stripComments(readSrc(CART_TSX));
  assert.match(cartSrc, /<CartExtraCharges/, "Cart.tsx must render <CartExtraCharges");
  assert.match(
    cartSrc,
    /import\s*\{\s*CartExtraCharges,\s*type ExtraChargeEntry\s*\}\s*from\s*"@\/components\/pos\/CartExtraCharges"/,
    'Cart.tsx must import { CartExtraCharges, type ExtraChargeEntry } from "@/components/pos/CartExtraCharges"',
  );

  // Positive ordering landmark: the extras control renders BELOW the table
  // charge block and ABOVE the Total row (plan §5C — where it lands in the
  // arithmetic, after GST, before the bottom total).
  const tableChargeBlockAt = cartSrc.indexOf('chargeLabel !== "" && (entitledCharge > 0 || charge > 0)');
  const extrasAt = cartSrc.indexOf("<CartExtraCharges");
  const totalRowAt = cartSrc.indexOf("<span>Total</span>");
  assert.ok(tableChargeBlockAt >= 0, "positive landmark: the table-charge conditional block must still be present");
  assert.ok(totalRowAt >= 0, "positive landmark: the Total row must still be present");
  assert.ok(tableChargeBlockAt < extrasAt, "expected the table-charge block BEFORE <CartExtraCharges");
  assert.ok(extrasAt < totalRowAt, "expected <CartExtraCharges BEFORE the Total row");
});

// ── (5) CartExtraCharges.tsx: hygiene (no console., no emoji) ──────────────

// A broad emoji range check — this repo's UI copy is plain English, Lucide
// icons only (CLAUDE.md/cafe.md), never emoji.
const EMOJI_RANGE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test("PIN (5): CartExtraCharges.tsx contains no console. and no emoji", () => {
  const raw = readSrc(CART_EXTRA_CHARGES);
  const consoleNeedle = "console" + ".";
  assert.ok(!raw.includes(consoleNeedle), `CartExtraCharges.tsx must NOT contain ${consoleNeedle} anywhere, not even in a comment`);
  assert.ok(!EMOJI_RANGE.test(raw), "CartExtraCharges.tsx must NOT contain an emoji character");
  // Positive landmark: the file has real content (not blinded/empty).
  assert.match(raw, /export function CartExtraCharges\(/, "positive landmark: CartExtraCharges.tsx must still export CartExtraCharges(");
});

// ── (6) CartExtraCharges.tsx: NO max-amount comparison (decision 8), paired
//        with a positive landmark that it DOES validate trim() ────────────

test("PIN (6): CartExtraCharges.tsx does NOT compare the amount against any upper bound (owner decision 8: no limits on the new extra charge), and DOES validate label.trim()", () => {
  const raw = readSrc(CART_EXTRA_CHARGES);
  const stripped = stripComments(raw);

  // Built by concatenation per testing.md (a literal here would match this
  // very assertion's own source on a repo-wide scan). Scans the whole file,
  // comments included, for any of the usual "there is a ceiling" shapes.
  const maxNeedle = "TABLE_CHARGE_" + "MAX";
  assert.ok(!raw.includes(maxNeedle), `CartExtraCharges.tsx must NOT reference ${maxNeedle} — the table's admin bound must never be applied to the new extra charge (owner decision 8)`);
  assert.ok(!/amount\s*>\s*\d{3,}/.test(stripped), "CartExtraCharges.tsx must not compare `amount` against a large literal ceiling");
  assert.ok(!/\.max\(/.test(stripped), "CartExtraCharges.tsx must not call a .max( bound anywhere on the amount validation");

  // Positive landmark: the validation function DOES exist and DOES check
  // label.trim() — proves the negative scans above aren't passing vacuously
  // against a gutted/stubbed file.
  assert.match(stripped, /label\.trim\(\)\.length === 0/, "positive landmark: validationError must check label.trim().length === 0");
  assert.match(stripped, /Number\.isInteger\(amount\)/, "positive landmark: validationError must check Number.isInteger(amount) — shape only, never size");
});
