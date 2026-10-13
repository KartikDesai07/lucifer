// Native apps 2.0 (spec §7): the Windows updater. electron-updater's generic provider reads <base>/latest.yml (the base
// is package.json's build.publish url, written into resources/app-update.yml by electron-builder), downloads the new
// installer in the background, checks its SHA-512, and installs it when the app quits. Never a dialog, never an automatic
// restart (spec D3): one Windows notification per version, and Restart to update in the tray and the Help menu. Only a
// packaged app looks; errors (no network, a missing file) go to the log only.
import { app, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import { CHECK_EVERY_MS, FIRST_CHECK_MS, noticeFor, type UpdateState } from "./update-plan";
import type { Logger } from "./log";

interface UpdaterDeps {
  log: Logger;
  onStateChange(state: UpdateState): void;
}

/** electron-updater's errors carry a code (ERR_UPDATER_…): the one log line names it, the logger has the detail (the N3
 *  review's m-6). */
function errorCode(error: Error): string {
  const { code } = error as Error & { code?: unknown };
  return typeof code === "string" ? code : error.name;
}

/** Starts the checks; returns what stops them (the app's before-quit). */
export function startUpdater(deps: UpdaterDeps): () => void {
  if (!app.isPackaged) return () => undefined;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  // The generic provider does not read allowPrerelease (only the GitHub ones do): the release packaging refuses a
  // version with a prerelease part instead (scripts/release-native.mjs; the N3 review's m-1).
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (message?: unknown) => deps.log.info(`updater: ${String(message)}`),
    warn: (message?: unknown) => deps.log.info(`updater: warn: ${String(message)}`),
    error: (message?: unknown) => deps.log.error(`updater: ${String(message)}`),
  };
  let notified: string | null = null;
  autoUpdater.on("update-downloaded", (info) => {
    deps.onStateChange({ kind: "downloaded", version: info.version });
    const notice = noticeFor(notified, info.version);
    if (notice === null || !Notification.isSupported()) return;
    notified = info.version;
    deps.log.info(`updater: ${info.version} is ready; notified`);
    new Notification({ title: notice.title, body: notice.body }).show();
  });
  autoUpdater.on("error", (error) => deps.log.error(`updater: ${errorCode(error)}`));
  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => undefined);
  };
  const first = setTimeout(check, FIRST_CHECK_MS);
  const every = setInterval(check, CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

/** Restart to update (the tray and the Help menu): the app quits as the tray's Quit does (before-quit), the installer
 *  runs silently, and the app starts again. */
export function restartToUpdate(): void {
  autoUpdater.quitAndInstall(true, true);
}
