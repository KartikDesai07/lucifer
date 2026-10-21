// Ruling P38 (U1 final fix wave, 2026-10-22; the final review's Important 1): closing a nested dialog by a press must
// not close the sheet beneath it. Radix's dismissable layer defers a modal layer's outside pointer-down to the click
// that follows; the nested dialogs of the /pos cart sheet (the payment, the void, the move, the confirm prompts) and of
// the Orders / dashboard order sheet (its payment and move dialogs) are React SIBLINGS of the sheet, so a press on their
// ✕ or Cancel is "outside" for the sheet, and by the click the nested layer has unmounted and the sheet is the top layer.
// The pressed element is detached by then, but its ancestors are still linked, so closest() still finds the nested
// panel: such a press is the nested dialog's own, never a tap outside the sheet. Escape is not affected (only the top
// layer answers it). Pure: no React, no DOM globals (the target is duck-typed), unit-tested in lib/nested-dialog.test.ts.

/** A Radix dialog panel's role, or an alert dialog's (the confirm prompts). */
export const DIALOG_ROLE_SELECTOR = '[role="dialog"], [role="alertdialog"]';

/** True when the pressed / focused `target` sits in a dialog panel other than the parent's own panel `own`. */
export function landedInNestedDialog(target: unknown, own: object | null): boolean {
  if (typeof target !== "object" || target === null) return false;
  const closest = (target as { closest?: unknown }).closest;
  if (typeof closest !== "function") return false;
  const dialog: unknown = closest.call(target, DIALOG_ROLE_SELECTOR);
  return dialog != null && dialog !== own;
}

/** A parent sheet's onInteractOutside: a press or focus that landed in a nested dialog keeps the sheet open; a tap
 *  outside every dialog still closes it, as before. */
export function keepOpenForNestedDialog(event: { target: unknown; preventDefault: () => void }, own: object | null): void {
  if (landedInNestedDialog(event.target, own)) event.preventDefault();
}
