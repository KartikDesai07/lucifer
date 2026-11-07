// What a staff tap on a link does, as one pure answer. Offline, a screen this page does not already hold would
// only fail after a wait, so it is refused up front with a toast; a screen it holds still opens from memory.
// When a newer build of the app is waiting, a screen not held is loaded as a whole document so the tab
// picks up the new build instead of mixing old and new code.

export type NavAction = "navigate" | "full-load" | "refuse";

export function navDecision(input: { href: string; offline: boolean; held: boolean; updatePending: boolean }): NavAction {
  if (input.held) return "navigate";
  if (input.offline) return "refuse";
  if (input.updatePending) return "full-load";
  return "navigate";
}

/** The toast for a refused tap; `label` is the screen's name as the staff see it. */
export function offlineNavMessage(label: string): string {
  return `Offline: ${label} opens once the internet is back`;
}
