import { test } from "node:test";
import assert from "node:assert/strict";

import { abandonNavigation, beginNavigation, navigateTo, retryNavigation, type NavDeps } from "@/lib/navigate";
import { createNavProgress, navProgress } from "@/lib/nav-progress";

// Facts a node test sets by hand (no window, no network): online and nothing held unless a test says so.
const facts = (o: { offline?: boolean; held?: boolean; updatePending?: boolean } = {}): Partial<NavDeps> => ({
  isOffline: () => o.offline ?? false,
  holds: () => o.held ?? false,
  updatePending: () => o.updatePending ?? false,
});

test("a tap on another page starts the progress with that page's title and fromPath, and navigates", () => {
  const p = createNavProgress();
  const r = beginNavigation("/orders", undefined, "/pos", 1000, p);
  assert.equal(r.action, "navigate", "a new page navigates");
  assert.deepEqual(p.get(), { href: "/orders", label: "Orders", startedAt: 1000, fromPath: "/pos" }, "the label is the page title (R22)");
});

test("an explicit label wins; a path with no title falls back to the path; a query is kept in the href", () => {
  const p = createNavProgress();
  beginNavigation("/orders?x=1", "Order list", "/", 5, p);
  assert.equal(p.get()?.label, "Order list", "the caller's label wins");
  assert.equal(p.get()?.href, "/orders?x=1", "the href is kept whole");
  const q = createNavProgress();
  beginNavigation("/no-such-page", undefined, "/", 5, q);
  assert.equal(q.get()?.label, "/no-such-page", "no title: the path");
});

test("a tap whose target path is the current page starts nothing and still navigates (a query change applies)", () => {
  const p = createNavProgress();
  const r = beginNavigation("/orders?status=open", undefined, "/orders", 1, p);
  assert.equal(r.action, "navigate", "Next navigates as today");
  assert.equal(p.get(), null, "no progress for the page already shown (R21)");
});

test("a tap on the href already opening does not navigate again and keeps the first start", () => {
  const p = createNavProgress();
  beginNavigation("/orders", undefined, "/pos", 1, p);
  const again = beginNavigation("/orders", undefined, "/pos", 99, p);
  assert.equal(again.action, "stay", "the second tap is cancelled (R21)");
  assert.equal(p.get()?.startedAt, 1, "the first start stands");
});

test("an absolute same-origin URL is read by its path", () => {
  const p = createNavProgress();
  assert.equal(beginNavigation("https://pos.example.com/orders?a=1", undefined, "/orders", 1, p).action, "navigate", "same page: navigates");
  assert.equal(p.get(), null, "an absolute URL of the current page starts nothing");
  beginNavigation("https://pos.example.com/kitchen", undefined, "/orders", 2, p);
  assert.equal(p.get()?.label, "Kitchen", "its path gives the title");
});

test("a tap on the page already showing cancels an opening in progress, then navigates (R30)", () => {
  const p = createNavProgress();
  beginNavigation("/orders", undefined, "/pos", 1, p);
  assert.notEqual(p.get(), null, "landmark: /orders is opening from /pos");
  const r = beginNavigation("/pos", undefined, "/pos", 2, p);
  assert.equal(r.action, "navigate", "the tap navigates as today");
  assert.equal(p.get(), null, "Next discards the pending /orders navigation, so the progress ends");
});

// navigateTo with a fake router and a stubbed window.location (node has no window); restored after each test. Each
// test hands navigateTo its own store (review m-h), so a test failing half-way never leaks a progress into the next.
type Calls = string[];
function withWindow<T>(location: { pathname: string; search?: string; assign?: (h: string) => void }, fn: () => T): T {
  const g = globalThis as { window?: unknown };
  const had = Object.prototype.hasOwnProperty.call(g, "window");
  const before = g.window;
  g.window = { location: { search: "", ...location } };
  try {
    return fn();
  } finally {
    if (had) g.window = before;
    else delete g.window;
  }
}
const withWindowPath = <T,>(pathname: string, fn: () => T): T => withWindow({ pathname }, fn);
function fakeRouter(calls: Calls) {
  const opts = (o?: object) => (o === undefined ? "" : ` ${JSON.stringify(o)}`);
  return {
    push: (h: string, o?: object) => calls.push(`push ${h}${opts(o)}`),
    replace: (h: string, o?: object) => calls.push(`replace ${h}${opts(o)}`),
  } as unknown as Parameters<typeof navigateTo>[0];
}

test("navigateTo: push by default, replace when asked, with the progress started for a new page", () => {
  const p = createNavProgress();
  const calls: Calls = [];
  withWindowPath("/pos", () => navigateTo(fakeRouter(calls), "/orders", { progress: p }));
  assert.deepEqual(calls, ["push /orders"], "router.push by default");
  assert.equal(p.get()?.href, "/orders", "it consulted beginNavigation: the progress started");
  const q = createNavProgress();
  withWindowPath("/pos", () => navigateTo(fakeRouter(calls), "/", { replace: true, label: "Home", progress: q }));
  assert.equal(calls[1], "replace /", "router.replace with { replace: true }");
  assert.equal(q.get()?.label, "Home", "its label is passed on");
});

test("navigateTo: with no store given it drives the page-wide navProgress", () => {
  navProgress.cancel();
  try {
    withWindowPath("/pos", () => navigateTo(fakeRouter([]), "/orders"));
    assert.equal(navProgress.get()?.href, "/orders", "the default store is the one the view reads");
  } finally {
    navProgress.cancel();
  }
});

test("navigateTo: the href already opening is not navigated again; the current page just navigates", () => {
  const p = createNavProgress();
  const calls: Calls = [];
  withWindowPath("/pos", () => {
    navigateTo(fakeRouter(calls), "/orders", { progress: p });
    navigateTo(fakeRouter(calls), "/orders", { progress: p });
  });
  assert.deepEqual(calls, ["push /orders"], "the second call stops on go:false");
  withWindowPath("/pos", () => navigateTo(fakeRouter(calls), "/pos?x=1", { progress: p }));
  assert.equal(calls[1], "push /pos?x=1", "same path: pushes");
  assert.equal(p.get(), null, "and the opening /orders was cancelled (R30)");
});

// --- "Back" and "Try again" under "Still opening…" (final review I1 / m-a) ---
test("abandonNavigation: ends the wait and replaces the current URL without a scroll, so Next drops the pending navigation (R35)", () => {
  const p = createNavProgress();
  p.start("/orders", "Orders", 1, "/pos");
  const calls: Calls = [];
  withWindow({ pathname: "/pos", search: "?table=T-1" }, () => abandonNavigation(fakeRouter(calls), p));
  assert.equal(p.get(), null, "the progress is cancelled: the old screen shows again");
  assert.deepEqual(calls, ['replace /pos?table=T-1 {"scroll":false}'], "one replace to the page already showing (path + query), scroll kept");
  assert.ok(!calls.some((c) => c.startsWith("push")), "never a push: no new history entry");
});

test("abandonNavigation: a page with no query replaces its bare path; the default store is the page-wide one", () => {
  navProgress.cancel();
  navProgress.start("/kitchen", "Kitchen", 1, "/orders");
  const calls: Calls = [];
  try {
    withWindow({ pathname: "/orders" }, () => abandonNavigation(fakeRouter(calls)));
    assert.equal(navProgress.get(), null, "the page-wide progress ends");
  } finally {
    navProgress.cancel();
  }
  assert.deepEqual(calls, ['replace /orders {"scroll":false}'], "the bare path, no stray '?'");
});

test("retryNavigation: online = a full page load of the target", () => {
  const log: string[] = [];
  retryNavigation("/orders?date=2026-11-07", "Orders", fxDeps(log, {}));
  assert.deepEqual(log, ["assign /orders?date=2026-11-07"], "the whole href goes to the browser");
});

test("retryNavigation: offline = the offline toast and no document load (the browser's error page would replace the POS)", () => {
  const log: string[] = [];
  retryNavigation("/orders", "Orders", fxDeps(log, { offline: true }));
  assert.deepEqual(log, ["toast Offline: Orders opens once the internet is back"], "the refused tap's toast, never assign");
});

// --- offline / update decisions (N1) ---
test("offline + held: the tap navigates and the progress starts", () => {
  const p = createNavProgress();
  const r = beginNavigation("/orders", undefined, "/pos", 1, p, facts({ offline: true, held: true }));
  assert.equal(r.action, "navigate", "a held screen still opens offline");
  assert.equal(p.get()?.href, "/orders", "its progress started");
});

test("offline + not held: refused with the label, and no progress starts", () => {
  const p = createNavProgress();
  const r = beginNavigation("/orders", undefined, "/pos", 1, p, facts({ offline: true }));
  assert.equal(r.action, "refuse", "an unheld screen is refused offline");
  assert.equal(r.label, "Orders", "the label names the screen");
  assert.equal(p.get(), null, "nothing is opening, so no skeleton");
  const q = beginNavigation("/orders", "Order list", "/pos", 1, p, facts({ offline: true }));
  assert.equal(q.label, "Order list", "the caller's label wins in the toast too");
});

test("online: navigates", () => {
  const p = createNavProgress();
  assert.equal(beginNavigation("/orders", undefined, "/pos", 1, p, facts()).action, "navigate", "online, nothing pending");
});

test("update pending + not held: full load with the progress started; held still navigates", () => {
  const p = createNavProgress();
  const r = beginNavigation("/orders", undefined, "/pos", 1, p, facts({ updatePending: true }));
  assert.equal(r.action, "full-load", "a new version loads the document");
  assert.equal(p.get()?.href, "/orders", "the skeleton shows while it loads (R24)");
  const q = createNavProgress();
  assert.equal(beginNavigation("/orders", undefined, "/pos", 1, q, facts({ updatePending: true, held: true })).action, "navigate", "held wins");
});

test("same path while offline navigates (the page showing is held)", () => {
  const p = createNavProgress();
  const r = beginNavigation("/orders?x=1", undefined, "/orders", 1, p, facts({ offline: true }));
  assert.equal(r.action, "navigate", "R30 has no offline check");
});

test("the href already opening stays even when a full load is pending", () => {
  const p = createNavProgress();
  beginNavigation("/orders", undefined, "/pos", 1, p, facts());
  const again = beginNavigation("/orders", undefined, "/pos", 2, p, facts({ updatePending: true }));
  assert.equal(again.action, "stay", "no second full load");
});

// Moved on purpose (final review m-d, ruling R36): the router cache keeps a screen per URL, so a query href is asked
// about whole; a plain href still by its path (R23).
test("the held check asks about the path, or the path + query when the href has one", () => {
  const asked: string[] = [];
  const ask = { ...facts({ offline: true }), holds: (key: string, now: number) => (asked.push(`${key}@${now}`), true) };
  beginNavigation("/orders?a=1#top", undefined, "/pos", 7, createNavProgress(), ask);
  beginNavigation("/orders/", undefined, "/pos", 8, createNavProgress(), ask);
  assert.deepEqual(asked, ["/orders?a=1@7", "/orders@8"], "path + query (no hash) and now; a plain href by its path");
});

test("offline + a query href: the path held is not enough, the exact href must be held (R36)", () => {
  const holdsOnly = (...keys: string[]) => ({ ...facts({ offline: true }), holds: (key: string) => keys.includes(key) });
  const p = createNavProgress();
  const r = beginNavigation("/orders?date=2026-11-07", undefined, "/pos", 1, p, holdsOnly("/orders"));
  assert.equal(r.action, "refuse", "/orders held says nothing about /orders?date=…: refused with the toast, never the network");
  assert.equal(p.get(), null, "and no skeleton");
  const exact = beginNavigation("/orders?date=2026-11-07", undefined, "/pos", 1, createNavProgress(), holdsOnly("/orders?date=2026-11-07"));
  assert.equal(exact.action, "navigate", "the exact href held (visited or offered) opens from memory");
  const plain = beginNavigation("/orders", undefined, "/pos", 1, createNavProgress(), holdsOnly("/orders"));
  assert.equal(plain.action, "navigate", "no query: the path held is enough (unchanged)");
});

function fxDeps(log: string[], o: Parameters<typeof facts>[0]): Partial<NavDeps> {
  return { ...facts(o), toastOffline: (m) => log.push(`toast ${m}`), assign: (h) => log.push(`assign ${h}`) };
}

test("navigateTo: refuse = toast, no push, no progress", () => {
  const p = createNavProgress();
  const calls: Calls = [];
  withWindowPath("/pos", () => navigateTo(fakeRouter(calls), "/orders", { deps: fxDeps(calls, { offline: true }), progress: p }));
  assert.deepEqual(calls, ["toast Offline: Orders opens once the internet is back"], "toast only, router untouched");
  assert.equal(p.get(), null, "no progress");
});

test("navigateTo: full-load = assign, no push, progress started", () => {
  const p = createNavProgress();
  const calls: Calls = [];
  withWindowPath("/pos", () => navigateTo(fakeRouter(calls), "/orders", { replace: true, deps: fxDeps(calls, { updatePending: true }), progress: p }));
  assert.deepEqual(calls, ["assign /orders"], "document load, router untouched");
  assert.equal(p.get()?.href, "/orders", "skeleton while loading");
});

test("navigateTo: the default full load calls window.location.assign", () => {
  const calls: Calls = [];
  const assign = (h: string) => void calls.push(`assign ${h}`);
  withWindow({ pathname: "/pos", assign }, () => navigateTo(fakeRouter(calls), "/kitchen", { deps: facts({ updatePending: true }), progress: createNavProgress() }));
  assert.deepEqual(calls, ["assign /kitchen"], "the real default hands the href to the browser");
});

test("AppLink prevents the default for every action but navigate", async () => {
  const { readFileSync } = await import("node:fs");
  const { stripComments } = await import("@/lib/source-pin-utils");
  const src = stripComments(readFileSync("components/layout/AppLink.tsx", "utf8"));
  assert.match(src, /action\s*!==\s*"navigate"\)\s*e\.preventDefault\(\)/, "any non-navigate action stops Next's own navigation");
  assert.match(src, /applyNavAction\(/, "the side effects come from the shared function");
});
