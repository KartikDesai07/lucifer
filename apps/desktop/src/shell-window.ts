// The one visible window: loads the cafe's POS app from the saved address,
// hides to the tray instead of closing, and keeps its own on-disk bounds.
import path from "node:path";
import { app, BrowserWindow, screen, shell } from "electron";
import {
  BOUNDS_SAVE_DEBOUNCE_MS,
  LOAD_ABORTED_CODE,
  OPEN_EXTERNAL_MIN_INTERVAL_MS,
  POS_PARTITION,
  PRODUCT_NAME,
  READY_TO_SHOW_FALLBACK_MS,
  RETRY_LOAD_MS,
  VERSION_ARG_PREFIX,
} from "./shared";
import { isExternalHttpUrl, isSameOrigin, startUrl } from "./server-url";
import { clampBounds, MIN_WINDOW } from "./window-state";
import type { ShellStore, WindowBounds } from "./store";
import type { Logger } from "./log";

interface CreateMainWindowDeps {
  // A getter, not a value: "Change server address…" re-points the SAME window,
  // so the navigation guards and the retry must always read the current origin.
  getOrigin(): string;
  startHidden: boolean;
  store: ShellStore;
  saveBounds(bounds: WindowBounds): void;
  isQuitting(): boolean;
  log: Logger;
}

export function createMainWindow(deps: CreateMainWindowDeps): BrowserWindow {
  const bounds = clampBounds(deps.store.windowBounds, screen.getPrimaryDisplay().workArea);

  const win = new BrowserWindow({
    show: false,
    title: PRODUCT_NAME,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    ...bounds,
    autoHideMenuBar: false,
    webPreferences: {
      partition: POS_PARTITION,
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      devTools: !app.isPackaged,
      additionalArguments: [`${VERSION_ARG_PREFIX}${app.getVersion()}`],
    },
  });

  // loadURL rejects on a failed navigation; did-fail-load below owns the
  // retry, so these fire-and-forget loads only swallow the duplicate signal.
  const load = (url: string): void => {
    win.loadURL(url).catch(() => undefined);
  };

  const showNow = (): void => {
    if (!deps.startHidden && !win.isDestroyed() && !win.isVisible()) win.show();
  };
  const showFallback = setTimeout(showNow, READY_TO_SHOW_FALLBACK_MS);
  win.once("ready-to-show", () => {
    clearTimeout(showFallback);
    showNow();
  });

  // Off-origin http(s) links open in the default browser, at most once per
  // OPEN_EXTERNAL_MIN_INTERVAL_MS — never any other scheme (review C21).
  let lastOpenExternalAt = 0;
  const openExternalThrottled = (url: string): void => {
    if (!isExternalHttpUrl(url)) return;
    const now = Date.now();
    if (now - lastOpenExternalAt < OPEN_EXTERNAL_MIN_INTERVAL_MS) return;
    lastOpenExternalAt = now;
    void shell.openExternal(url);
  };

  win.webContents.on("will-navigate", (event) => {
    if (isSameOrigin(event.url, deps.getOrigin())) return;
    event.preventDefault();
    openExternalThrottled(event.url);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, deps.getOrigin())) {
      load(url);
      return { action: "deny" };
    }
    openExternalThrottled(url);
    return { action: "deny" };
  });

  win.on("close", (event) => {
    // A window the operator just sent to the tray must never be re-shown by
    // the first-paint fallback (review C24).
    clearTimeout(showFallback);
    if (!deps.isQuitting()) {
      event.preventDefault();
      win.hide();
    }
  });

  let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleBoundsSave = (): void => {
    if (win.isMinimized() || win.isMaximized()) return;
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(() => {
      const current = win.getBounds();
      deps.saveBounds({
        x: current.x,
        y: current.y,
        width: current.width,
        height: current.height,
      });
    }, BOUNDS_SAVE_DEBOUNCE_MS);
  };
  win.on("resize", scheduleBoundsSave);
  win.on("move", scheduleBoundsSave);

  // Bounded retry shared by a failed navigation and a dead renderer: the
  // shell lives hidden in the tray, so nobody would notice either otherwise.
  const retryLater = (target: string): void => {
    setTimeout(() => {
      if (!win.isDestroyed()) load(target);
    }, RETRY_LOAD_MS);
  };

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      // M7: -3 (ERR_ABORTED) fires on ordinary superseded navigations
      // (e.g. a same-origin redirect racing a reload) — not a real failure.
      if (!isMainFrame || errorCode === LOAD_ABORTED_CODE) return;
      deps.log.error(`did-fail-load ${errorCode} ${errorDescription}`);
      // Retry the page that failed, not the start page — an operator on
      // /orders must land back on /orders (review C23).
      const origin = deps.getOrigin();
      retryLater(isSameOrigin(validatedURL, origin) ? validatedURL : startUrl(origin));
    },
  );

  // A renderer crash (OOM, GPU) in a tray-hidden window is not a navigation
  // failure — without this it would sit dead and print nothing (review C2).
  win.webContents.on("render-process-gone", (_event, details) => {
    deps.log.error(`render-process-gone ${details.reason}`);
    retryLater(startUrl(deps.getOrigin()));
  });

  load(startUrl(deps.getOrigin()));

  return win;
}
