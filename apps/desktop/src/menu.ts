// The app menu (Help) and tray icon. No window chrome beyond this — the
// shell is a thin remote-content wrapper.
import path from "node:path";
import { dialog, Menu, nativeImage, Tray } from "electron";
import { APP_ICON_FILE, PRODUCT_NAME } from "./shared";

export interface AppMenuActions {
  openPos(): void;
  reload(): void;
  changeServerAddress(): void;
  autoStartChecked: boolean;
  setAutoStart(on: boolean): void;
  showAbout(): void;
  quit(): void;
}

export function buildAppMenu(actions: AppMenuActions): Menu {
  return Menu.buildFromTemplate([
    {
      label: "Help",
      submenu: [
        { label: "Open POS", click: () => actions.openPos() },
        { label: "Reload", click: () => actions.reload() },
        { type: "separator" },
        { label: "Change server address…", click: () => actions.changeServerAddress() },
        {
          label: "Start with Windows",
          type: "checkbox",
          checked: actions.autoStartChecked,
          click: (menuItem) => actions.setAutoStart(menuItem.checked),
        },
        { type: "separator" },
        { label: `About ${PRODUCT_NAME}`, click: () => actions.showAbout() },
        { type: "separator" },
        { label: "Quit", click: () => actions.quit() },
      ],
    },
  ]);
}

export interface TrayActions {
  openPos(): void;
  changeServerAddress(): void;
  quit(): void;
}

// Module-scope so the Tray survives as long as the process — Electron drops
// the tray icon if its object is garbage-collected.
let tray: Tray | null = null;

export function createTray(actions: TrayActions): Tray {
  // M2: the icon is pre-generated at 32×32 — no runtime resize.
  const icon = nativeImage.createFromPath(path.join(__dirname, "../assets/tray.png"));
  tray = new Tray(icon);
  tray.setToolTip(PRODUCT_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open POS", click: () => actions.openPos() },
      { label: "Change server address…", click: () => actions.changeServerAddress() },
      { type: "separator" },
      { label: "Quit", click: () => actions.quit() },
    ]),
  );
  // M6: both click and double-click open the POS window.
  tray.on("click", () => actions.openPos());
  tray.on("double-click", () => actions.openPos());
  return tray;
}

export interface AboutDetails {
  version: string;
  electronVersion: string;
  serverOrigin: string | null;
}

export async function showAboutDialog(details: AboutDetails): Promise<void> {
  await dialog.showMessageBox({
    type: "info",
    // The product logo, not Electron's default — this dialog is one of the
    // few places Windows does not take the icon from the exe.
    icon: nativeImage.createFromPath(path.join(__dirname, "../assets", APP_ICON_FILE)),
    title: `About ${PRODUCT_NAME}`,
    message: PRODUCT_NAME,
    detail:
      `Version ${details.version}\n` +
      `Electron ${details.electronVersion}\n` +
      `Server address: ${details.serverOrigin ?? "not set"}`,
  });
}
