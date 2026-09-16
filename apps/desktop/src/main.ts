// The only stateful module: owns the main window, the tray/menu, the
// on-disk store, and wires every other module's dependencies together.
import path from "node:path";
import { app, Notification, session } from "electron";
import {
  APP_ID,
  HIDDEN_FLAG,
  LOG_FILE_NAME,
  POS_PARTITION,
  PRODUCT_NAME,
} from "./shared";
import { isSameOrigin, startUrl } from "./server-url";
import { readStore, writeStore, STORE_FILE_NAME, type ShellStore, type WindowBounds } from "./store";
import { createLogger } from "./log";
import { installPermissionHandlers } from "./permissions";
import { registerPrintHandler } from "./print";
import { createMainWindow } from "./shell-window";
import { openUrlWindow, registerUrlHandlers } from "./url-window";
import { buildAppMenu, createTray, showAboutDialog } from "./menu";
import type { BrowserWindow } from "electron";

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // --hidden applies to the FIRST window only (the auto-start launch); every
  // later window is operator-initiated and must appear (review C5).
  let startHiddenPending = process.argv.includes(HIDDEN_FLAG);

  let mainWindow: BrowserWindow | null = null;
  let urlWindow: BrowserWindow | null = null;
  let store: ShellStore;
  let quitting = false;

  void app.whenReady().then(() => {
    // M3: sets the Windows taskbar/tray identity; must match build.appId.
    app.setAppUserModelId(APP_ID);

    const storeFile = path.join(app.getPath("userData"), STORE_FILE_NAME);
    const logFile = path.join(app.getPath("userData"), LOG_FILE_NAME);
    const log = createLogger(logFile);
    store = readStore(storeFile);

    // The single writer. deviceName is hand-edited on disk (no picker in v1),
    // so it is re-read before every write instead of being clobbered by the
    // startup snapshot (review C22); a failed write is logged, never thrown
    // into a timer callback (review C15).
    const persist = (patch: Partial<ShellStore>): void => {
      const onDisk = readStore(storeFile);
      store = { ...store, deviceName: onDisk.deviceName, ...patch };
      try {
        writeStore(storeFile, store);
      } catch (error) {
        log.error(`store write failed: ${error instanceof Error ? error.name : "unknown"}`);
      }
    };

    // A failed print must be visible even while the window sits in the tray:
    // a Windows notification from the main process, never only a toast inside
    // the hidden window (review C3). Message = a curated constant from print.ts.
    const notifyPrintFailure = (message: string): void => {
      if (!Notification.isSupported()) return;
      new Notification({ title: PRODUCT_NAME, body: message }).show();
    };

    installPermissionHandlers(session.fromPartition(POS_PARTITION), () => store.serverOrigin);

    registerPrintHandler({
      getMainWebContentsId: () =>
        mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.id : null,
      getOrigin: () => store.serverOrigin,
      getDeviceName: () => store.deviceName,
      log,
      onJobFailed: notifyPrintFailure,
    });

    const openMain = (): void => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        return;
      }
      const origin = store.serverOrigin;
      if (origin === null) {
        // "Open POS" with no saved address must never be a dead end (review C17).
        openSetupWindow(false);
        return;
      }
      const startHidden = startHiddenPending;
      startHiddenPending = false;
      mainWindow = createMainWindow({
        getOrigin: () => store.serverOrigin ?? origin,
        startHidden,
        store,
        saveBounds: (bounds: WindowBounds) => persist({ windowBounds: bounds }),
        isQuitting: () => quitting,
        log,
      });
      // Auto-start is decided ONCE, after the first load that actually reached
      // the saved origin (Chromium's own error page also finishes loading, so
      // the URL is checked, not just the event). autoStart === null is the
      // "never decided" sentinel; an operator's later OFF stays OFF.
      const webContents = mainWindow.webContents;
      webContents.on("did-finish-load", () => {
        if (store.autoStart !== null || !app.isPackaged) return;
        if (!isSameOrigin(webContents.getURL(), store.serverOrigin ?? "")) return;
        persist({ autoStart: true });
        app.setLoginItemSettings({
          openAtLogin: true,
          path: process.execPath,
          args: [HIDDEN_FLAG],
        });
        rebuildMenu();
      });
      mainWindow.on("closed", () => {
        mainWindow = null;
      });
    };

    const closeUrlWindow = (): void => {
      if (urlWindow && !urlWindow.isDestroyed()) {
        urlWindow.close();
      }
      urlWindow = null;
    };

    // Single writer for a saved address, used by both the open window's
    // deps and its IPC handler (registered once, below).
    const onServerAddressSaved = (origin: string): void => {
      persist({ serverOrigin: origin });
      if (mainWindow && !mainWindow.isDestroyed()) {
        // An operator-initiated re-point is a foreground action (review C16).
        mainWindow.loadURL(startUrl(origin)).catch(() => undefined);
        mainWindow.show();
        mainWindow.focus();
      } else {
        openMain();
      }
      closeUrlWindow();
    };

    // Mutable so the currently-open window's Cancel button reflects how it
    // was opened (first run: no cancel; "Change server address…": cancel ok).
    let urlWindowAllowsCancel = false;

    const openSetupWindow = (allowCancel: boolean): void => {
      urlWindowAllowsCancel = allowCancel;
      if (urlWindow && !urlWindow.isDestroyed()) {
        urlWindow.focus();
        return;
      }
      urlWindow = openUrlWindow({
        currentOrigin: () => store.serverOrigin,
        onSaved: onServerAddressSaved,
        allowCancel,
        log,
      });
      urlWindow.on("closed", () => {
        urlWindow = null;
      });
    };

    // ipcMain.handle can only be called once per channel — register the URL
    // window's handlers up front, reading current state through closures.
    registerUrlHandlers({
      currentOrigin: () => store.serverOrigin,
      onSaved: onServerAddressSaved,
      allowCancel: () => urlWindowAllowsCancel,
      closeUrlWindow,
    });

    const setAutoStart = (on: boolean): void => {
      persist({ autoStart: on });
      app.setLoginItemSettings({
        openAtLogin: on,
        path: process.execPath,
        args: [HIDDEN_FLAG],
      });
      rebuildMenu();
    };

    function rebuildMenu(): void {
      const menu = buildAppMenu({
        openPos: () => openMain(),
        reload: () => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
        },
        changeServerAddress: () => openSetupWindow(true),
        autoStartChecked: store.autoStart === true,
        setAutoStart,
        showAbout: () => {
          void showAboutDialog({
            version: app.getVersion(),
            electronVersion: process.versions.electron,
            serverOrigin: store.serverOrigin,
          });
        },
        quit: () => app.quit(),
      });
      // The tray keeps its own short menu (createTray) — never the Help menu.
      app.applicationMenu = menu;
    }

    rebuildMenu();
    // menu.ts keeps the Tray in module scope so it is never garbage-collected.
    createTray({
      openPos: () => openMain(),
      changeServerAddress: () => openSetupWindow(true),
      quit: () => app.quit(),
    });

    if (store.serverOrigin === null) {
      openSetupWindow(false);
    } else {
      openMain();
    }

    // A second launch (Start-menu click while the tray app runs) re-shows
    // whatever window exists — the POS, else the address window — and creates
    // one when none exists (review C17).
    app.on("second-instance", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      } else if (urlWindow && !urlWindow.isDestroyed()) {
        urlWindow.focus();
      } else {
        openMain();
      }
    });
  });

  // The shell lives in the tray after the last window closes — quitting
  // happens only from the tray/menu "Quit" action.
  app.on("window-all-closed", () => {
    // intentionally no-op
  });

  // Accepted (review C4): the latch is not reset if an OS-initiated quit is
  // cancelled after before-quit — the next X then destroys the window instead
  // of hiding it, and "Open POS" simply creates a fresh one (closed → null).
  app.on("before-quit", () => {
    quitting = true;
  });
}
