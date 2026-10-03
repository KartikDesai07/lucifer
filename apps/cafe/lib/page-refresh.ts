// The POS app's Refresh (the top bar's button beside the printer icon; the owner, 2026-10-03): the app has
// no browser bar, so this reloads the page as a browser would. Any part of the page that holds work a reload
// would lose says so here, so Refresh asks first. One source of truth with the page's own leave warning
// (hooks/use-unsaved-guard.ts): a refresh staff already confirmed marks itself deliberate, so that warning
// stays quiet instead of asking a second, native question (the release review's I1). Pure; no React.

/** "changes": cart lines not sent yet, or unsaved edits. "unconfirmed": an order still being sent, or one
 *  whose answer never came (a reload forgets its retry key, so re-sending it could make it twice; I2). */
export type UnsentWork = "changes" | "unconfirmed";

const holders = new Map<symbol, UnsentWork>();

/** What this holder holds now (null: nothing, or it unmounted). */
export function holdUnsentWork(token: symbol, work: UnsentWork | null): void {
  if (work === null) holders.delete(token);
  else holders.set(token, work);
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

/** A reload that has not torn the page down by now did not happen: the button lets go. */
export const REFRESH_SETTLE_MS = 8_000;

export const REFRESH_CONFIRM_TITLE = "Refresh the POS?";

export function refreshQuestion(work: UnsentWork): string {
  return work === "unconfirmed"
    ? "An order is still being sent, or it could not be confirmed. After refreshing, check Open tabs before sending it again, so it is not sent twice."
    : "Items in the cart that were not sent yet, and changes not saved on this screen, will be cleared. Orders already sent are safe.";
}

export const REFRESH_OFFLINE_MESSAGE = "You are offline. Refresh once the connection is back.";
