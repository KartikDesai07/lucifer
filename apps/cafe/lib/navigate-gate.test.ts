// R71: the navigation's document loads (a full load, "Try again") go through the print gate, wait for the line, and are
// dropped when the opening they started under ends. The gate is faked here; its own behaviour is lib/print-host-busy.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { abandonNavigation, applyNavAction, beginNavigation, retryNavigation, type NavDeps } from "@/lib/navigate";
import { createNavProgress } from "@/lib/nav-progress";
import { leaveWhenPrintFree } from "@/lib/print-host-busy";
import { stripComments } from "@/lib/source-pin-utils";

type Gate = { go: () => void; ready?: () => boolean; cancelled: boolean; went?: boolean };

// A gate the test opens by hand: it never goes by itself; `open(i)` runs the i-th gate's go once, if not cancelled.
function harness(o: { offline?: boolean } = {}) {
  const gates: Gate[] = [];
  const loads: string[] = [];
  const toasts: string[] = [];
  const state = { offline: o.offline ?? false };
  const deps: Partial<NavDeps> = {
    isOffline: () => state.offline,
    holds: () => false,
    updatePending: () => true,
    toastOffline: (m) => void toasts.push(m),
    assign: (h) => void loads.push(`assign ${h}`),
    replace: (h) => void loads.push(`replace ${h}`),
    leave: (go, options) => {
      const g: Gate = { go, ready: options?.ready, cancelled: false };
      gates.push(g);
      return () => {
        g.cancelled = true;
      };
    },
  };
  const open = (i: number) => {
    if (gates[i].cancelled || gates[i].went) return;
    gates[i].went = true;
    gates[i].go();
  };
  return { gates, loads, toasts, state, deps, open };
}

const tap = (h: ReturnType<typeof harness>, p: ReturnType<typeof createNavProgress>, href: string, opts?: { replace?: boolean }, from = "/pos") => {
  const r = beginNavigation(href, undefined, from, 1, p, h.deps);
  applyNavAction(r, href, h.deps, { ...opts, progress: p });
  return r;
};

const fakeRouter = () => ({ replace: () => undefined }) as never;
const withPath = (fn: () => void) => {
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const before = g.window;
  g.window = { location: { pathname: "/pos", search: "" } };
  try {
    fn();
  } finally {
    if (had) g.window = before;
    else delete g.window;
  }
};

test("a full load goes through the gate: nothing loads until the gate goes, then exactly one assign", () => {
  const h = harness();
  const p = createNavProgress();
  assert.equal(tap(h, p, "/orders").action, "full-load", "landmark: a pending update turns the tap into a full load");
  assert.equal(h.gates.length, 1, "one gate started");
  assert.deepEqual(h.loads, [], "print busy: no load yet");
  h.open(0);
  h.open(0);
  assert.deepEqual(h.loads, ["assign /orders"], "exactly one load once the gate goes");
});

test("a replace full load keeps replace; a push keeps assign", () => {
  const h = harness();
  tap(h, createNavProgress(), "/orders", { replace: true });
  h.open(0);
  assert.deepEqual(h.loads, ["replace /orders"], "replace stays replace");
});

test("the waiting load also waits for the line: ready is false offline, true online", () => {
  const h = harness();
  tap(h, createNavProgress(), "/orders");
  assert.equal(h.gates[0].ready?.(), true, "online: ready");
  h.state.offline = true;
  assert.equal(h.gates[0].ready?.(), false, "an internet drop during the wait: not ready, the load keeps waiting");
});

test("Back (abandonNavigation) during the wait: the load never happens", () => {
  const h = harness();
  const p = createNavProgress();
  tap(h, p, "/orders");
  withPath(() => abandonNavigation(fakeRouter(), p));
  assert.equal(h.gates[0].cancelled, true, "Back cancels the waiting gate");
  h.open(0);
  assert.deepEqual(h.loads, [], "never a late load after Back");
});

test("a same-path tap, progress.cancel() and a settle on another page each end the wait for good", () => {
  const h = harness();
  const p = createNavProgress();
  tap(h, p, "/orders");
  beginNavigation("/pos", undefined, "/pos", 2, p, h.deps);
  assert.equal(h.gates[0].cancelled, true, "a tap on the page showing cancels the opening and the load");
  tap(h, p, "/kitchen");
  p.cancel();
  assert.equal(h.gates[1].cancelled, true, "popstate / pageshow (navProgress.cancel()) cancels it");
  tap(h, p, "/menu");
  p.settle("/somewhere-else");
  assert.equal(h.gates[2].cancelled, true, "the page changing on its own ends the wait");
  h.open(0);
  h.open(1);
  h.open(2);
  assert.deepEqual(h.loads, [], "none of them ever loads");
});

test("two waiting loads: a newer tap cancels the older, only the newer can go", () => {
  const h = harness();
  const p = createNavProgress();
  tap(h, p, "/orders");
  tap(h, p, "/kitchen");
  assert.equal(h.gates[0].cancelled, true, "the older gate is cancelled");
  h.open(0);
  h.open(1);
  assert.deepEqual(h.loads, ["assign /kitchen"], "only the newer load goes");
});

// Ruling P3 on the same entry: Try again of the same href while the tap's own full load waits keeps the progress entry,
// so only the newer load replacing the waiting one (pendingLoad) stops the first gate; else both would load.
test("Try again of the same href while its full load waits: the first gate is cancelled, exactly one load", () => {
  const h = harness();
  const p = createNavProgress();
  assert.equal(tap(h, p, "/orders").action, "full-load", "landmark: the tap's full load waits at the gate (print busy)");
  const entry = p.get();
  retryNavigation("/orders", "Orders", h.deps, p);
  assert.equal(p.get(), entry, "landmark: Try again keeps the same progress entry, so no entry change cancels anything");
  assert.equal(h.gates.length, 2, "Try again started its own gate");
  assert.equal(h.gates[0].cancelled, true, "the newer load cancels the waiting one");
  h.open(0);
  h.open(1);
  assert.deepEqual(h.loads, ["assign /orders"], "both gates opened: exactly one load");
});

test("Try again online goes through the gate (with the line as ready); offline toasts and starts no gate", () => {
  const h = harness();
  const p = createNavProgress();
  p.start("/orders", "Orders", 1, "/pos");
  retryNavigation("/orders", "Orders", h.deps, p);
  assert.equal(h.gates.length, 1, "online: a gate");
  assert.equal(h.gates[0].ready?.(), true, "ready = the line is up");
  assert.deepEqual(h.loads, [], "nothing loads before the gate goes");
  h.open(0);
  assert.deepEqual(h.loads, ["assign /orders"], "one load");
  const o = harness({ offline: true });
  retryNavigation("/orders", "Orders", o.deps, createNavProgress());
  assert.equal(o.gates.length, 0, "offline: no gate");
  assert.equal(o.toasts.length, 1, "offline: today's toast");
  assert.deepEqual(o.loads, [], "offline: no load");
});

test("Back after Try again cancels that load too", () => {
  const h = harness();
  const p = createNavProgress();
  p.start("/orders", "Orders", 1, "/pos");
  retryNavigation("/orders", "Orders", h.deps, p);
  withPath(() => abandonNavigation(fakeRouter(), p));
  h.open(0);
  assert.deepEqual(h.loads, [], "no late load after Back");
});

test("PIN: the real NavDeps gate is leaveWhenPrintFree, and both loads use it", () => {
  const src = stripComments(readFileSync(fileURLToPath(new URL("./navigate.ts", import.meta.url)), "utf8"));
  assert.match(src, /leave: leaveWhenPrintFree,/, "realDeps.leave is leaveWhenPrintFree");
  assert.equal(typeof leaveWhenPrintFree, "function", "landmark: the gate exists");
  assert.equal(src.split("loadThroughGate(").length - 1, 3, "the definition plus the full load and Try again");
  assert.doesNotMatch(src, /else d\.assign\(href\)|\(opts\?\.replace \? d\.replace : d\.assign\)\(href\)/, "no bare document load is left");
});
