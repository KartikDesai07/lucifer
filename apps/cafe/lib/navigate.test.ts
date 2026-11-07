import { test } from "node:test";
import assert from "node:assert/strict";

import { beginNavigation } from "@/lib/navigate";
import { createNavProgress } from "@/lib/nav-progress";

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
