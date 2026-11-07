import { test } from "node:test";
import assert from "node:assert/strict";

import { beginNavigation, navigateTo, type NavDeps } from "@/lib/navigate";
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

// navigateTo with a fake router and a stubbed window.location (node has no window); restored after each test.
type Calls = string[];
function withWindowPath<T>(pathname: string, fn: () => T): T {
  const g = globalThis as { window?: unknown };
  const had = Object.prototype.hasOwnProperty.call(g, "window");
  const before = g.window;
  g.window = { location: { pathname } };
  try {
    return fn();
  } finally {
    if (had) g.window = before;
    else delete g.window;
  }
}
function fakeRouter(calls: Calls) {
  return {
    push: (h: string) => calls.push(`push ${h}`),
    replace: (h: string) => calls.push(`replace ${h}`),
  } as unknown as Parameters<typeof navigateTo>[0];
}

test("navigateTo: push by default, replace when asked, with the progress started for a new page", () => {
  navProgress.cancel();
  const calls: Calls = [];
  withWindowPath("/pos", () => navigateTo(fakeRouter(calls), "/orders"));
  assert.deepEqual(calls, ["push /orders"], "router.push by default");
  assert.equal(navProgress.get()?.href, "/orders", "it consulted beginNavigation: the progress started");
  navProgress.cancel();
  withWindowPath("/pos", () => navigateTo(fakeRouter(calls), "/", { replace: true, label: "Home" }));
  assert.equal(calls[1], "replace /", "router.replace with { replace: true }");
  assert.equal(navProgress.get()?.label, "Home", "its label is passed on");
  navProgress.cancel();
});

test("navigateTo: the href already opening is not navigated again; the current page just navigates", () => {
  navProgress.cancel();
  const calls: Calls = [];
  withWindowPath("/pos", () => {
    navigateTo(fakeRouter(calls), "/orders");
    navigateTo(fakeRouter(calls), "/orders");
  });
  assert.deepEqual(calls, ["push /orders"], "the second call stops on go:false");
  withWindowPath("/pos", () => navigateTo(fakeRouter(calls), "/pos?x=1"));
  assert.equal(calls[1], "push /pos?x=1", "same path: pushes");
  assert.equal(navProgress.get(), null, "and the opening /orders was cancelled (R30)");
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

test("the held check asks about the target path, not the href with its query", () => {
  const asked: string[] = [];
  const p = createNavProgress();
  beginNavigation("/orders?a=1", undefined, "/pos", 7, p, { ...facts({ offline: true }), holds: (path, now) => (asked.push(`${path}@${now}`), true) });
  assert.deepEqual(asked, ["/orders@7"], "path and now are passed (R23)");
});

function fxDeps(log: string[], o: Parameters<typeof facts>[0]): Partial<NavDeps> {
  return { ...facts(o), toastOffline: (m) => log.push(`toast ${m}`), assign: (h) => log.push(`assign ${h}`) };
}

test("navigateTo: refuse = toast, no push, no progress", () => {
  navProgress.cancel();
  const calls: Calls = [];
  withWindowPath("/pos", () => navigateTo(fakeRouter(calls), "/orders", { deps: fxDeps(calls, { offline: true }) }));
  assert.deepEqual(calls, ["toast Offline: Orders opens once the internet is back"], "toast only, router untouched");
  assert.equal(navProgress.get(), null, "no progress");
});

test("navigateTo: full-load = assign, no push, progress started", () => {
  navProgress.cancel();
  const calls: Calls = [];
  withWindowPath("/pos", () => navigateTo(fakeRouter(calls), "/orders", { replace: true, deps: fxDeps(calls, { updatePending: true }) }));
  assert.deepEqual(calls, ["assign /orders"], "document load, router untouched");
  assert.equal(navProgress.get()?.href, "/orders", "skeleton while loading");
  navProgress.cancel();
});

test("navigateTo: the default full load calls window.location.assign", () => {
  navProgress.cancel();
  const calls: Calls = [];
  const g = globalThis as { window?: unknown };
  g.window = { location: { pathname: "/pos", assign: (h: string) => calls.push(`assign ${h}`) } };
  try {
    navigateTo(fakeRouter(calls), "/kitchen", { deps: facts({ updatePending: true }) });
  } finally {
    delete g.window;
  }
  assert.deepEqual(calls, ["assign /kitchen"], "the real default hands the href to the browser");
  navProgress.cancel();
});

test("AppLink prevents the default for every action but navigate", async () => {
  const { readFileSync } = await import("node:fs");
  const { stripComments } = await import("@/lib/source-pin-utils");
  const src = stripComments(readFileSync("components/layout/AppLink.tsx", "utf8"));
  assert.match(src, /action\s*!==\s*"navigate"\)\s*e\.preventDefault\(\)/, "any non-navigate action stops Next's own navigation");
  assert.match(src, /applyNavAction\(/, "the side effects come from the shared function");
});
