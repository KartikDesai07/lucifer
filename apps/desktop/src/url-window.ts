// The first-run/"Change server address…" window: a small, non-resizable
// prompt for the saved server origin. No preload state beyond three IPC
// channels; the actual validation lives in server-url.ts.
import path from "node:path";
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  APP_ICON_FILE,
  URL_CANCEL_CHANNEL,
  URL_CURRENT_CHANNEL,
  URL_SAVE_CHANNEL,
} from "./shared";
import { normalizeServerUrl } from "./server-url";
import type { Logger } from "./log";

export const URL_WINDOW_WIDTH = 520;
export const URL_WINDOW_HEIGHT = 360;

interface OpenUrlWindowDeps {
  currentOrigin(): string | null;
  onSaved(origin: string): void;
  allowCancel: boolean;
  log: Logger;
}

// currentOrigin/onSaved/allowCancel are read by registerUrlHandlers via the
// IPC channels this window's preload calls into — this window itself only
// needs to load the HTML and log a failed load.
export function openUrlWindow(deps: OpenUrlWindowDeps): BrowserWindow {
  const win = new BrowserWindow({
    width: URL_WINDOW_WIDTH,
    height: URL_WINDOW_HEIGHT,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "Server address",
    icon: path.join(__dirname, "../assets", APP_ICON_FILE),
    webPreferences: {
      preload: path.join(__dirname, "url-preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
    },
  });

  // A local page with a preload that writes the saved origin: no navigation,
  // no popups — the same posture as every other window (review C20).
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  void win.loadFile(path.join(__dirname, "../assets/url-window.html"));

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    deps.log.error(`url-window did-fail-load ${errorCode} ${errorDescription}`);
  });

  return win;
}

interface RegisterUrlHandlersDeps {
  currentOrigin(): string | null;
  onSaved(origin: string): void;
  // Read at cancel-time, not registration-time: the same handlers serve
  // both the first-run window (allowCancel false) and every later
  // "Change server address…" window (allowCancel true) — ipcMain.handle
  // can only be bound once per channel for the app's lifetime.
  allowCancel(): boolean;
  closeUrlWindow(): void;
}

export function registerUrlHandlers(deps: RegisterUrlHandlersDeps): void {
  ipcMain.handle(URL_CURRENT_CHANNEL, () => {
    return deps.currentOrigin();
  });

  ipcMain.handle(URL_SAVE_CHANNEL, (_event: IpcMainInvokeEvent, input: unknown) => {
    if (typeof input !== "string") {
      return { ok: false, error: "Enter the address of your POS." };
    }
    const result = normalizeServerUrl(input);
    if (result.ok) {
      deps.onSaved(result.origin);
      return { ok: true };
    }
    return { ok: false, error: result.error };
  });

  ipcMain.handle(URL_CANCEL_CHANNEL, () => {
    if (deps.allowCancel()) {
      deps.closeUrlWindow();
    }
  });
}
