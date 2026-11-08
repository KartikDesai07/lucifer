// The POS app's Refresh (the top bar's button beside the printer icon; the owner, 2026-10-03): the app has
// no browser bar, so this reloads the page as a browser would. Any part of the page that holds work a reload
// would lose says so here, so Refresh asks first. One source of truth with the page's own leave warning
// (hooks/use-unsaved-guard.ts): a refresh staff already confirmed marks itself deliberate, so that warning
// stays quiet instead of asking a second, native question (the release review's I1). Pure; no React.

import { PRINT_STUCK_MS } from "@/lib/print-host-busy";

/** "changes": cart lines not sent yet, or unsaved edits. "unconfirmed": an order still being sent, or one
 *  whose answer never came (a reload forgets its retry key, so re-sending it could make it twice; I2). */
export type UnsentWork = "changes" | "unconfirmed";

const holders = new Map<symbol, UnsentWork>();

/** What this holder holds now (null: nothing, or it unmounted). */
export function holdUnsentWork(token: symbol, work: UnsentWork | null): void {
  if (work === null) holders.delete(token);
  else holders.set(token, work);
}

const cartHolders = new Map<symbol, number>();

/** The POS cart (hooks/use-cart.ts): its unsent lines are this holder's "changes", exactly as holdUnsentWork sets them,
 *  and its line count, fired lines included, tells a newer build to wait for an empty cart (lib/quiet-reload.ts).
 *  null: the cart unmounted. */
export function holdCart(token: symbol, cart: { unsent: boolean; lines: number } | null): void {
  holdUnsentWork(token, cart !== null && cart.unsent ? "changes" : null);
  if (cart === null || cart.lines === 0) cartHolders.delete(token);
  else cartHolders.set(token, cart.lines);
}

/** The lines every cart on the page holds; 0 when none. */
export function cartLines(): number {
  let lines = 0;
  for (const count of cartHolders.values()) lines += count;
  return lines;
}

/** The weightiest work the page holds: an unconfirmed send before plain changes; null when none. */
export function unsentWork(): UnsentWork | null {
  let found: UnsentWork | null = null;
  for (const work of holders.values()) {
    if (work === "unconfirmed") return work;
    found = work;
  }
  return found;
}

let deliberate = false;

/** Set right before a refresh staff confirmed (or one with nothing to lose): the leave warning stays quiet. */
export function markDeliberateReload(): void {
  deliberate = true;
}

export function clearDeliberateReload(): void {
  deliberate = false;
}

export function isDeliberateReload(): boolean {
  return deliberate;
}

export type ReloadStep =
  | { kind: "offline" }
  | { kind: "printing" }
  | { kind: "ask-print" }
  | { kind: "ask"; work: UnsentWork }
  | { kind: "reload" };

/** What this device's print hold looks like to Refresh. `since` is printHostBusySince() (null: free), `waivedSince` the
 *  hold staff already said "Refresh anyway" to. Stuck = continuous for PRINT_STUCK_MS or more. The waiver covers only
 *  that one hold: a newer hold has another start time and is judged afresh (R72). */
export function printHoldOf(
  since: number | null,
  now: number,
  waivedSince: number | null,
): { printing: boolean; stuck: boolean; waived: boolean } {
  if (since === null) return { printing: false, stuck: false, waived: false };
  return { printing: true, stuck: now - since >= PRINT_STUCK_MS, waived: waivedSince === since };
}

/** What a tap on Refresh (or the header's "Update ready · Reload" chip, P2 N4) does. In this order: offline it says so
 *  instead of reloading into an error screen (whatever was confirmed); while a slip prints here, a young hold says so (a
 *  reload would lose it: a REPRINT, the verifiers' M4), a stuck one (R72) asks "Refresh anyway" unless staff already
 *  said yes to that hold; then work a reload would lose asks first; with nothing to lose it reloads. */
export function reloadStep(
  online: boolean,
  work: UnsentWork | null,
  printing = false,
  stuck = false,
  waived = false,
): ReloadStep {
  if (!online) return { kind: "offline" };
  if (printing && !(stuck && waived)) return stuck ? { kind: "ask-print" } : { kind: "printing" };
  if (work !== null) return { kind: "ask", work };
  return { kind: "reload" };
}

/** A reload that has not torn the page down by now did not happen: the button lets go. */
export const REFRESH_SETTLE_MS = 8_000;

export const REFRESH_CONFIRM_TITLE = "Refresh the POS?";

export function refreshQuestion(work: UnsentWork): string {
  return work === "unconfirmed"
    ? "An order is still being sent, or it could not be confirmed. After refreshing, check Open tabs before sending it again, so it is not sent twice."
    : "Items in the cart that were not sent yet, and changes not saved on this screen, will be cleared. Orders already sent are safe.";
}

export const REFRESH_OFFLINE_MESSAGE = "You are offline. Refresh once the connection is back.";

export const REFRESH_PRINTING_MESSAGE = "A slip is printing. Refresh once it is done.";

// R72: a slip printing for over 30 s is a stuck printer. Lease runs out = a "maybe" failure (packages/shared
// print-lifecycle.ts): a KOT or other non-bill goes back to the line marked REPRINT, a token DUPLICATE (a second maybe
// ends in "failed", waiting for staff); a bill is never printed again by itself, it waits in the Printer panel's
// "Not printed" card for the cashier.
export const REFRESH_PRINT_TITLE = "Printing is taking long";

export const REFRESH_PRINT_QUESTION =
  "A slip has been printing on this device for over 30 seconds. If you refresh now, it may print again later, marked REPRINT or DUPLICATE, so it can come out twice. A bill is never printed again by itself: it waits in the Printer panel.";

export const REFRESH_PRINT_CONFIRM = "Refresh anyway";

export const REFRESH_PRINT_CANCEL = "Wait";
