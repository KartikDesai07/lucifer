// Sandboxed preload — may only pull in the electron module (no local
// imports, no node builtins). Literals below are duplicated from shared.ts
// on purpose. Only the .invoke() call is exposed, never ipcRenderer itself.
// A sandboxed preload may only pull in the electron module this way, never
// via an ES import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electron = require("electron");
const contextBridge = electron.contextBridge;

const PRINT_CHANNEL = "pos-desktop:print-html";
const VERSION_ARG_PREFIX = "--pos-desktop-version=";

const versionArg = process.argv.find((arg: string) => arg.startsWith(VERSION_ARG_PREFIX));
const version = versionArg ? versionArg.slice(VERSION_ARG_PREFIX.length) : "";

contextBridge.exposeInMainWorld("posDesktop", {
  version,
  printHtml: (html: string): Promise<void> => electron.ipcRenderer.invoke(PRINT_CHANNEL, html),
});

// Forces module scope so this file's top-level names never collide with
// url-preload.ts when both are compiled together (neither has any other
// import/export, which otherwise makes TS treat them as one global script).
export {};
