// Ruling P38 (U1 final fix wave, 2026-10-22): a sheet whose nested dialogs are its React SIBLINGS (the /pos cart sheet
// below 1280px: the payment, the void, the move and the confirm prompts; the Orders / dashboard order sheet: its
// payment and move dialogs) must not close itself when one of them is closed by a press. Radix defers a modal layer's
// outside pointer-down to the click; by then the nested layer is gone, the sheet is the top layer and the press on the
// nested panel's ✕ / Cancel reads as "outside" for it. The predicate below tells such a press from a real one outside
// every dialog. No DOM here: the targets are stand-ins with the one method the predicate calls (closest), as a
// detached ✕ still has it — its ancestors stay linked after the nested panel unmounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/source-pin-utils";
import { DIALOG_ROLE_SELECTOR, keepOpenForNestedDialog, landedInNestedDialog } from "./nested-dialog";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/** An element stand-in whose closest() answers with `dialog` for the dialog selector (null: no dialog around it). */
function nodeIn(dialog: object | null): { closest: (selector: string) => object | null; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    closest: (selector: string) => {
      seen.push(selector);
      return dialog;
    },
  };
}

const sheet = { name: "the parent sheet's own panel" };
const payment = { name: "the payment sheet's panel (role=dialog)" };

test("the selector names both dialog roles (Radix Dialog: dialog; the confirm prompts: alertdialog)", () => {
  assert.equal(DIALOG_ROLE_SELECTOR, '[role="dialog"], [role="alertdialog"]', "both roles, exactly");
});

test("landedInNestedDialog: a press inside another dialog's panel (the payment's ✕, a confirm's Cancel) is nested", () => {
  const closeButton = nodeIn(payment);
  assert.equal(landedInNestedDialog(closeButton, sheet), true, "a nested panel around the target: keep the parent open");
  assert.deepEqual(closeButton.seen, [DIALOG_ROLE_SELECTOR], "it asks for the closest dialog of either role, once");
});

test("landedInNestedDialog: a press outside every dialog (the scrim, the page) is not nested", () => {
  assert.equal(landedInNestedDialog(nodeIn(null), sheet), false, "no dialog around the target: the parent closes as today");
});

test("landedInNestedDialog: the parent's own panel never counts as a nested dialog", () => {
  assert.equal(landedInNestedDialog(nodeIn(sheet), sheet), false, "the closest dialog is the parent itself");
});

test("landedInNestedDialog: a target that is not an element (text node, document, window, null) is never nested", () => {
  for (const target of [null, undefined, {}, { closest: "not a function" }, 42, "x"]) {
    assert.equal(landedInNestedDialog(target, sheet), false, `target ${JSON.stringify(target)}: no closest(), not nested`);
  }
});

test("keepOpenForNestedDialog: prevents the parent's dismissal for a nested press only", () => {
  let prevented = 0;
  const event = (target: unknown) => ({ target, preventDefault: () => (prevented += 1) });
  keepOpenForNestedDialog(event(nodeIn(payment)), sheet);
  assert.equal(prevented, 1, "a press in the nested payment panel: preventDefault, the sheet stays");
  keepOpenForNestedDialog(event(nodeIn(null)), sheet);
  assert.equal(prevented, 1, "a press outside every dialog: no preventDefault, the sheet closes");
  keepOpenForNestedDialog(event(nodeIn(sheet)), sheet);
  assert.equal(prevented, 1, "the parent's own panel: no preventDefault");
  keepOpenForNestedDialog(event(nodeIn(payment)), null);
  assert.equal(prevented, 2, "no own panel known yet: a press inside any dialog still keeps the parent open");
});

// The two parents (final review Important 1): the /pos cart sheet and the Orders / dashboard order sheet.
test("PIN: both parent sheets guard their outside interactions with the shared helper on their own panel", () => {
  const bar = stripComments(readSrc("apps/cafe/components/pos/MobileCartBar.tsx"));
  assert.match(bar, /import \{ keepOpenForNestedDialog \} from "@\/lib\/nested-dialog";/, "the cart sheet imports the helper");
  assert.match(bar, /const sheetRef = useRef<HTMLDivElement>\(null\);/, "the cart sheet holds its own panel");
  assert.match(
    bar,
    /<DialogPrimitive\.Content\s+data-ui="pos-cart-sheet"\s+ref=\{sheetRef\}[^>]*onInteractOutside=\{\(e\) => keepOpenForNestedDialog\(e, sheetRef\.current\)\}/,
    "the cart sheet's panel ignores a press that lands in a nested dialog",
  );
  const order = stripComments(readSrc("apps/cafe/components/orders/OrderDetailSheet.tsx"));
  assert.match(order, /import \{ keepOpenForNestedDialog \} from "@\/lib\/nested-dialog";/, "the order sheet imports the helper");
  assert.match(order, /const sheetRef = useRef<HTMLDivElement>\(null\);/, "the order sheet holds its own panel");
  assert.match(
    order,
    /<SheetContent\s+ref=\{sheetRef\}[^>]*onInteractOutside=\{\(e\) => keepOpenForNestedDialog\(e, sheetRef\.current\)\}/,
    "the order sheet's panel ignores a press that lands in its payment or move dialog",
  );
  // U2 Task 5: the order detail has two sheet frames (design 6.6) — the kit side sheet above (the dashboard from 1280px)
  // and, below 1280px on both pages, the full-screen bottom sheet (the /pos cart sheet's Radix panel): the same rule.
  assert.match(
    order,
    /<DialogPrimitive\.Content\s+ref=\{sheetRef\}[^>]*onInteractOutside=\{\(e\) => keepOpenForNestedDialog\(e, sheetRef\.current\)\}/,
    "the order detail's bottom sheet ignores a nested press too",
  );
  for (const [file, src] of [["MobileCartBar", bar], ["OrderDetailSheet", order]] as const) {
    assert.ok(!src.includes("onEscapeKeyDown"), `${file}: Escape is untouched (the top layer alone answers it, as today)`);
  }
});
