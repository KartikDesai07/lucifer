// Sandboxed preload for the URL-entry window — may only pull in the
// electron module (no local imports, no node builtins). Literals below are
// duplicated from shared.ts on purpose.
// A sandboxed preload may only pull in the electron module this way, never
// via an ES import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electron = require("electron");
const contextBridge = electron.contextBridge;

const URL_CURRENT_CHANNEL = "pos-desktop:url-current";
const URL_SAVE_CHANNEL = "pos-desktop:url-save";
const URL_CANCEL_CHANNEL = "pos-desktop:url-cancel";
// Native apps 2.0 (spec §9): the window's footer shows the app's version, passed as the main window's preload gets it.
const VERSION_ARG_PREFIX = "--pos-desktop-version=";

const versionArg = process.argv.find((arg: string) => arg.startsWith(VERSION_ARG_PREFIX));
const version = versionArg ? versionArg.slice(VERSION_ARG_PREFIX.length) : "";

contextBridge.exposeInMainWorld("posDesktopSetup", {
  version,
  current: (): Promise<string | null> => electron.ipcRenderer.invoke(URL_CURRENT_CHANNEL),
  save: (input: string): Promise<{ ok: true } | { ok: false; error: string }> =>
    electron.ipcRenderer.invoke(URL_SAVE_CHANNEL, input),
  cancel: (): Promise<void> => electron.ipcRenderer.invoke(URL_CANCEL_CHANNEL),
});

// Forces module scope so this file's top-level names never collide with
// preload.ts when both are compiled together (neither has any other
// import/export, which otherwise makes TS treat them as one global script).
export {};
