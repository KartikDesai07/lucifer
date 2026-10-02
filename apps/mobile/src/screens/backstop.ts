// Pure budgets for the two self-healing paths of the POS screen. No
// react-native import: safe for node:test.

// Debug builds only: the dev-menu "Crash web page" navigates here on purpose.
export const CRASH_URL = 'chrome://crash';

// The top-frame backstop may bring the WebView back to the start page this
// many times inside BACKSTOP_WINDOW_MS. A POS address that itself redirects to
// a foreign site would otherwise loop for ever (and keep opening the browser).
export const MAX_BACKSTOP_RECOVERIES = 3;
export const BACKSTOP_WINDOW_MS = 60_000;

// The fence callback and the backstop can both see the same foreign page; the
// system browser must get it once.
export const EXTERNAL_OPEN_DEDUPE_MS = 2_000;

export type OpenedExternally = { url: string; at: number } | null;

export function isDuplicateOpen(
  last: OpenedExternally,
  url: string,
  now: number,
): boolean {
  return (
    last !== null && last.url === url && now - last.at < EXTERNAL_OPEN_DEDUPE_MS
  );
}

export type RecoveryBudget = { allowed: boolean; times: number[] };

// `times` are the timestamps of the recoveries already spent. Old ones expire;
// when a slot is free the new one is recorded.
export function spendRecovery(times: number[], now: number): RecoveryBudget {
  const recent = times.filter(t => now - t < BACKSTOP_WINDOW_MS);
  if (recent.length >= MAX_BACKSTOP_RECOVERIES) {
    return { allowed: false, times: recent };
  }
  return { allowed: true, times: [...recent, now] };
}
