// Native apps 2.0 (spec §7): what the Windows updater does when, as pure values (update-plan.test.ts). It looks one
// minute after start and then every 24 hours; a downloaded update is announced once per version (one Windows
// notification) and the tray and the Help menu offer Restart to update; otherwise it installs when the app quits. Never a
// dialog, never an automatic restart (spec D3).

export const FIRST_CHECK_MS = 60_000;
export const CHECK_EVERY_MS = 86_400_000;

export type UpdateState = { kind: "idle" } | { kind: "downloaded"; version: string };
export const UPDATE_IDLE: UpdateState = { kind: "idle" };

export const RESTART_TO_UPDATE = "Restart to update";

export interface ReadyNotice {
  title: string;
  body: string;
}

export function readyNotice(version: string): ReadyNotice {
  return { title: "Update ready", body: `POS Software ${version} is ready. It installs when you close the app.` };
}

/** The notice for a downloaded [version], or null when that version was already announced. */
export function noticeFor(lastNotified: string | null, version: string): ReadyNotice | null {
  return version === lastNotified ? null : readyNotice(version);
}

/** The menu item a downloaded update adds; nothing until then. */
export function trayUpdateItem(state: UpdateState): { label: string } | null {
  return state.kind === "downloaded" ? { label: RESTART_TO_UPDATE } : null;
}
