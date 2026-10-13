// The first-run/"Change server address…" window: a small, non-resizable
// prompt for the saved server origin. No preload state beyond three IPC
// channels; the address rules live in pos-url.ts (the Android app's).
import path from "node:path";
import { app, BrowserWindow, ipcMain, net, type IpcMainInvokeEvent } from "electron";
import {
  APP_ICON_FILE,
  URL_CANCEL_CHANNEL,
  URL_CURRENT_CHANNEL,
  URL_SAVE_CHANNEL,
  VERSION_ARG_PREFIX,
} from "./shared";
import { normalizePosUrl, URL_EMPTY_ERROR } from "./pos-url";
import { checkPos } from "./pos-health";
import type { Logger } from "./log";

// Native apps 2.0 (spec §9): the Android start screen's size on a PC, of content (the menu bar comes on top).
export const URL_WINDOW_WIDTH = 480;
export const URL_WINDOW_HEIGHT = 640;

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
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "POS address",
    backgroundColor: "#f5f7fb",
    icon: path.join(__dirname, "../assets", APP_ICON_FILE),
    webPreferences: {
      preload: path.join(__dirname, "url-preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: false,
      additionalArguments: [`${VERSION_ARG_PREFIX}${app.getVersion()}`],
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
  log: Logger;
}

export function registerUrlHandlers(deps: RegisterUrlHandlersDeps): void {
  ipcMain.handle(URL_CURRENT_CHANNEL, () => {
    return deps.currentOrigin();
  });

  ipcMain.handle(URL_SAVE_CHANNEL, async (_event: IpcMainInvokeEvent, input: unknown) => {
    if (typeof input !== "string") {
      return { ok: false, error: URL_EMPTY_ERROR };
    }
    const result = normalizePosUrl(input);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    // Native apps 2.0 (spec §9): one GET <origin>/api/health before saving, through the system proxy (net.fetch); the
    // page itself makes no request.
    const check = await checkPos(result.origin, (url, init) => net.fetch(url, init));
    deps.log.info(`address check: ${check.ok ? "found" : "not saved"}`);
    if (!check.ok) return check;
    deps.onSaved(result.origin);
    return { ok: true };
  });

  ipcMain.handle(URL_CANCEL_CHANNEL, () => {
    if (deps.allowCancel()) {
      deps.closeUrlWindow();
    }
  });
}
