import { test } from "node:test";
import assert from "node:assert/strict";

import { beginNavigation, navigateTo } from "@/lib/navigate";
import { createNavProgress, navProgress } from "@/lib/nav-progress";

test("a tap on another page starts the progress with that page's title and fromPath, and navigates", () => {
  const p = createNavProgress();
  const r = beginNavigation("/orders", undefined, "/pos", 1000, p);
  assert.equal(r.go, true, "a new page navigates");
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
  assert.equal(r.go, true, "Next navigates as today");
  assert.equal(p.get(), null, "no progress for the page already shown (R21)");
});

test("a tap on the href already opening does not navigate again and keeps the first start", () => {
  const p = createNavProgress();
  beginNavigation("/orders", undefined, "/pos", 1, p);
  const again = beginNavigation("/orders", undefined, "/pos", 99, p);
  assert.equal(again.go, false, "the second tap is cancelled (R21)");
  assert.equal(p.get()?.startedAt, 1, "the first start stands");
});

test("an absolute same-origin URL is read by its path", () => {
  const p = createNavProgress();
  assert.equal(beginNavigation("https://pos.example.com/orders?a=1", undefined, "/orders", 1, p).go, true, "same page: navigates");
  assert.equal(p.get(), null, "an absolute URL of the current page starts nothing");
  beginNavigation("https://pos.example.com/kitchen", undefined, "/orders", 2, p);
  assert.equal(p.get()?.label, "Kitchen", "its path gives the title");
});

test("a tap on the page already showing cancels an opening in progress, then navigates (R30)", () => {
  const p = createNavProgress();
  beginNavigation("/orders", undefined, "/pos", 1, p);
  assert.notEqual(p.get(), null, "landmark: /orders is opening from /pos");
  const r = beginNavigation("/pos", undefined, "/pos", 2, p);
  assert.equal(r.go, true, "the tap navigates as today");
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
