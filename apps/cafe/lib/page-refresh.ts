// The POS app's Refresh (the top bar's button beside the printer icon; the owner, 2026-10-03): the app has
// no browser bar, so this reloads the page as a browser would. A part of the page that holds work not sent
// yet (the POS cart's unfired lines) says so here, so Refresh asks before throwing it away. Pure; no React.

const holders = new Set<symbol>();

/** `holding` true while this holder has unsent work; false (or on unmount) when it has none. */
export function holdUnsentWork(token: symbol, holding: boolean): void {
  if (holding) holders.add(token);
  else holders.delete(token);
}

export function hasUnsentWork(): boolean {
  return holders.size > 0;
}

export const REFRESH_CONFIRM_TITLE = "Refresh the POS?";
export const REFRESH_CONFIRM_BODY = "Items in the cart that were not sent yet will be cleared. Orders already sent are safe.";
