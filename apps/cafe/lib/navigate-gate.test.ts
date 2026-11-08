// R71: the navigation's document loads (a full load, "Try again") go through the print gate, wait for the line, and are
// dropped when the opening they started under ends. The gate is faked here; its own behaviour is lib/print-host-busy.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { heldRoutes } from "@/lib/held-routes";
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

// Post-verifier V1/V2: a suspect row (lib/held-routes.ts distrustSince) is never left to Next, which would load the
// document itself past the gate (or show the browser's error page offline): online our gated full load, offline the toast.
test("a suspect row online: the gated full load, pending or not, even when it reads as held", () => {
  for (const pending of [false, true]) {
    const h = harness();
    const asked: string[] = [];
    const deps: Partial<NavDeps> = { ...h.deps, updatePending: () => pending, holds: () => true, suspect: (key, now) => (asked.push(`${key}@${now}`), true) };
    const p = createNavProgress();
    const r = beginNavigation("/orders?d=1#x", undefined, "/pos", 5, p, deps);
    applyNavAction(r, "/orders?d=1#x", deps, { progress: p });
    assert.equal(r.action, "full-load", `pending=${pending}: a suspect row is our full load`);
    assert.deepEqual(asked, ["/orders?d=1@5"], `pending=${pending}: asked by heldKeyOf(href) and now`);
    assert.equal(h.gates.length, 1, `pending=${pending}: it goes through the print gate`);
    assert.deepEqual(h.loads, [], `pending=${pending}: nothing loads before the gate goes`);
    h.open(0);
    assert.deepEqual(h.loads, ["assign /orders?d=1#x"], `pending=${pending}: one load once it goes`);
  }
});

test("a suspect row offline: the toast, no gate, no skeleton", () => {
  const h = harness({ offline: true });
  const deps: Partial<NavDeps> = { ...h.deps, holds: () => true, suspect: () => true };
  const p = createNavProgress();
  const r = beginNavigation("/orders", undefined, "/pos", 1, p, deps);
  applyNavAction(r, "/orders", deps, { progress: p });
  assert.equal(r.action, "refuse", "offline, a suspect row is refused even though it reads as held");
  assert.deepEqual(h.toasts, ["Offline: Orders opens once the internet is back"], "the refused tap's toast");
  assert.equal(h.gates.length, 0, "no gate");
  assert.equal(p.get(), null, "no skeleton");
});

test("the real default asks the page's held record: a distrusted mark is a full load, a trusted one navigates", () => {
  heldRoutes.mark("/__suspect-a", 100);
  heldRoutes.mark("/__suspect-b", 300);
  heldRoutes.distrustSince(300);
  const online: Partial<NavDeps> = { isOffline: () => false, updatePending: () => false };
  assert.equal(beginNavigation("/__suspect-a", undefined, "/pos", 400, createNavProgress(), online).action, "navigate", "marked before `since`: held, opens from memory");
  assert.equal(beginNavigation("/__suspect-b", undefined, "/pos", 400, createNavProgress(), online).action, "full-load", "distrusted: our gated load");
  const src = stripComments(readFileSync(fileURLToPath(new URL("./navigate.ts", import.meta.url)), "utf8"));
  assert.match(src, /suspect: \(key, now\) => heldRoutes\.suspect\(key, now\),/, "realDeps.suspect reads heldRoutes.suspect");
});

// Ruling V3 (fix round 1): Back reads how the opening began. Our own full load (no Next navigation ever started): it is
// dropped and the router is not touched, since a replace of a stale current screen would refetch it (with a newer build
// waiting, Next loads the document itself). A soft navigation, Try again or not: Next's navigation may still be in
// flight, so Back also replaces the current screen as R35 always did, and our waiting load is dropped with the opening.
const recordingRouter = (calls: string[]) =>
  ({ replace: (href: string, o?: object) => void calls.push(`replace ${href}${o === undefined ? "" : ` ${JSON.stringify(o)}`}`) }) as never;

test("Back on an opening that began as our full load: the load is cancelled, no replace, no load", () => {
  const h = harness();
  const p = createNavProgress();
  assert.equal(tap(h, p, "/orders").action, "full-load", "landmark: the opening began as our own full load");
  const calls: string[] = [];
  withPath(() => abandonNavigation(recordingRouter(calls), p));
  assert.equal(h.gates[0].cancelled, true, "the waiting gate is cancelled");
  assert.deepEqual(calls, [], "no router.replace: no Next navigation is in flight");
  assert.equal(p.get(), null, "the old screen shows again");
  h.open(0);
  assert.deepEqual(h.loads, [], "never a late load");
});

test("Back on a soft navigation whose Try again waits for print: one replace drops Next's navigation, our load never goes", () => {
  const h = harness();
  const p = createNavProgress();
  const soft: Partial<NavDeps> = { ...h.deps, updatePending: () => false };
  const r = beginNavigation("/orders", undefined, "/pos", 1, p, soft);
  assert.equal(applyNavAction(r, "/orders", soft, { progress: p }), true, "landmark: a soft navigation, Next's own, is in flight");
  retryNavigation("/orders", "Orders", h.deps, p);
  assert.equal(h.gates.length, 1, "landmark: Try again's load waits at the gate (a slip printing here)");
  const calls: string[] = [];
  withPath(() => abandonNavigation(recordingRouter(calls), p));
  assert.deepEqual(calls, ['replace /pos {"scroll":false}'], "one replace: Next drops its pending navigation (R35); Try again changed nothing");
  assert.equal(h.gates[0].cancelled, true, "our waiting load is cancelled with the opening");
  h.open(0);
  assert.deepEqual(h.loads, [], "our load never goes");
  assert.equal(p.get(), null, "the old screen shows again");
});

test("Back with no load of ours waiting (a Next navigation opening): today's replace of the current screen (R35)", () => {
  const h = harness();
  const p0 = createNavProgress();
  tap(h, p0, "/kitchen");
  h.open(0);
  assert.deepEqual(h.loads, ["assign /kitchen"], "landmark: our earlier load went, so none of ours waits");
  const p = createNavProgress();
  const soft: Partial<NavDeps> = { ...h.deps, updatePending: () => false };
  const r = beginNavigation("/orders", undefined, "/pos", 2, p, soft);
  assert.equal(applyNavAction(r, "/orders", soft, { progress: p }), true, "landmark: a soft navigation, Next's own");
  const calls: string[] = [];
  withPath(() => abandonNavigation(recordingRouter(calls), p));
  assert.deepEqual(calls, ['replace /pos {"scroll":false}'], "the replace that makes Next drop its pending navigation");
  assert.equal(p.get(), null, "the old screen shows again");
});
