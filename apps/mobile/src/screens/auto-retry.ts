// When the POS cannot be opened the error screen tries again on its own, so a
// counter tablet comes back after a network blip without anyone tapping.
// Pure: no react-native import (safe for node:test).

export const RETRY_DELAY_MS = 15_000;
// 40 tries x 15 s = about 10 minutes, then the screen waits for a tap.
export const MAX_AUTO_RETRIES = 40;
// A WebView that ran this long before failing counts as a fresh failure.
export const HEALTHY_LOAD_MS = 60_000;

const ACTIVE_APP_STATE = 'active';

// Retry only while the app is on screen: a timer must never run (or fire a
// reload) while the app is in the background, where the print host lives on.
export function canAutoRetry(used: number, appState: string): boolean {
  return used < MAX_AUTO_RETRIES && appState === ACTIVE_APP_STATE;
}

// The attempts counter to carry into the next error screen: it restarts when
// the WebView had been healthy for a while before failing.
export function usedAfterFailure(used: number, ranMs: number): number {
  return ranMs >= HEALTHY_LOAD_MS ? 0 : used;
}
