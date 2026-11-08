// R71: the dashboard error screen's three document loads go through the print gate (the layout under it keeps the print
// agent and print host mounted), and the one "line is up" meaning is shared with the connection wait.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { lineIsUp, reloadWhenOnline } from "@/lib/offline-reload";
import { stripComments } from "@/lib/source-pin-utils";

const read = (rel: string): string => stripComments(readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8"));
const ERROR = "app/(dashboard)/error.tsx";

test("lineIsUp: the page's offline state and the browser must both say online", () => {
  const store = (offline: boolean) => ({ isOffline: () => offline });
  const win = (onLine: boolean) => ({ navigator: { onLine } });
  assert.equal(lineIsUp(store(false), win(true)), true, "online and online");
  assert.equal(lineIsUp(store(true), win(true)), false, "the page's own state says offline");
  assert.equal(lineIsUp(store(false), win(false)), false, "the browser says offline");
});

test("reloadWhenOnline still reloads at once online and waits offline (it now shares lineIsUp)", () => {
  const listeners: Array<() => void> = [];
  let offline = true;
  const store = { isOffline: () => offline, subscribe: (fn: () => void) => (listeners.push(fn), () => undefined) } as never;
  const win = { navigator: { onLine: true }, addEventListener: () => undefined, removeEventListener: () => undefined };
  let reloads = 0;
  reloadWhenOnline(() => void (reloads += 1), store, win);
  assert.equal(reloads, 0, "offline: waits");
  offline = false;
  listeners.forEach((fn) => fn());
  assert.equal(reloads, 1, "back online: reloads once");
});

test("PIN: every document load in the dashboard error screen is inside a leaveWhenPrintFree callback", () => {
  const src = read(ERROR);
  assert.match(src, /import \{ leaveWhenPrintFree \} from "@\/lib\/print-host-busy";/, "the screen imports the gate");
  assert.equal(src.split("leaveWhenPrintFree(").length - 1, 2, "two gate calls: the automatic reload and the buttons' load()");
  // Strip each gate callback body; nothing may still load a document outside one.
  const outside = src
    .replace(/leaveWhenPrintFree\(\(\) => window\.location\.reload\(\), \{ ready: \(\) => lineIsUp\(\) \}\)/, "")
    .replace(/go\(\);/, "")
    .replace(/load\(\(\) => window\.location\.reload\(\)\)/, "")
    .replace(/load\(\(\) => window\.location\.assign\("\/"\)\)/, "");
  assert.doesNotMatch(outside, /location\.(reload|assign|replace)\(/, "no bare location load outside a gate callback");
  assert.match(src, /leaveWhenPrintFree\(\(\) => window\.location\.reload\(\), \{ ready: \(\) => lineIsUp\(\) \}\)/, "the automatic reload also waits for the line");
  assert.match(src, /load\(\(\) => window\.location\.reload\(\)\)/, "Reload goes through load()");
  assert.match(src, /load\(\(\) => window\.location\.assign\("\/"\)\)/, "Go to dashboard goes through load()");
  assert.match(src, /leaveWhenPrintFree\(\(\) => \{\s*went = true;\s*go\(\);\s*\}\)/, "the buttons pass no ready (they keep working offline)");
});

test("PIN: the automatic reload arms the loop guard first, waits for the connection, and cancels both on cleanup", () => {
  const src = read(ERROR);
  const arm = src.indexOf("if (!armChunkReload(chunkReloadStore(), Date.now())) return;");
  const gate = src.indexOf("cancelGate = leaveWhenPrintFree(");
  assert.ok(arm > 0 && gate > arm, "armed first, then the gate");
  assert.match(src, /const stopWaiting = reloadWhenOnline\(/, "the connection wait stays");
  assert.match(src, /return \(\) => \{\s*stopWaiting\(\);\s*cancelGate\(\);\s*\};/, "cleanup stops the wait and a waiting gate");
});

test("PIN: a waiting button load shows the status words, disables both buttons, and is cancelled on unmount", () => {
  const src = read(ERROR);
  assert.match(src, /role="status"/, "a status line");
  assert.ok(src.includes("A slip is printing here. The page opens as soon as it is done."), "the exact words");
  assert.equal(src.split("disabled={waiting}").length - 1, 2, "Reload and Go to dashboard are both disabled while waiting");
  assert.match(src, /useEffect\(\(\) => \(\) => cancelLoad\.current\(\), \[\]\)/, "a waiting gate is cancelled on unmount");
});
