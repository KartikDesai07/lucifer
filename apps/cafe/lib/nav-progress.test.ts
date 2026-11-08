import assert from "node:assert/strict";
import { test } from "node:test";
import { NAV_STILL_OPENING_MS, createNavProgress, navTargetPath } from "./nav-progress";

test("start while pending replaces", () => {
  const s = createNavProgress();
  assert.equal(s.get(), null, "idle at the start");
  assert.equal(s.start("/orders", "Orders", 100, "/pos"), true, "first start is accepted");
  assert.equal(s.start("/tables", "Tables", 200, "/pos"), true, "a different href is accepted");
  assert.deepEqual(s.get(), { href: "/tables", label: "Tables", startedAt: 200, fromPath: "/pos" }, "the newer tap replaced the older");
});

test("start same href is a no-op (returns false)", () => {
  const s = createNavProgress();
  s.start("/orders", "Orders", 100, "/pos");
  const before = s.get();
  let heard = 0;
  s.subscribe(() => heard++);
  assert.equal(s.start("/orders", "Orders", 900, "/pos"), false, "same href is refused");
  assert.equal(s.get(), before, "state object is untouched (same reference)");
  assert.equal(heard, 0, "nobody is told about a refused start");
});

test("settle on pathname clears; on another path keeps", () => {
  const s = createNavProgress();
  s.start("/customers?x=1", "Customers", 0, "/pos");
  s.settle("/pos");
  assert.notEqual(s.get(), null, "still on the old path keeps");
  s.settle("/customers");
  assert.equal(s.get(), null, "target path clears, query ignored");
});

test("settle ignores query and hash, and reduces an absolute same-origin URL", () => {
  const s = createNavProgress();
  s.start("http://localhost:3171/customers?x=1#y", "Customers", 0, "/pos");
  s.settle("/customers");
  assert.equal(s.get(), null, "absolute URL reduces to /customers");
  s.start("/orders#top", "Orders", 0, "/pos");
  s.settle("/orders");
  assert.equal(s.get(), null, "hash ignored");
});

test("settle on any other path clears (a redirect landed elsewhere)", () => {
  const s = createNavProgress();
  s.start("/reports", "Reports", 0, "/pos");
  s.settle("/reports/sales");
  assert.equal(s.get(), null, "a redirect target clears");
});

test("settle keeps on the path the tap came from", () => {
  const s = createNavProgress();
  s.start("/reports", "Reports", 0, "/pos");
  let heard = 0;
  s.subscribe(() => heard++);
  s.settle("/pos");
  assert.notEqual(s.get(), null, "fromPath keeps");
  assert.equal(heard, 0, "a keeping settle notifies nobody");
});

test("a superseded target landing late keeps the newer one pending", () => {
  const s = createNavProgress();
  s.start("/a", "A", 0, "/pos");
  s.start("/b", "B", 10, "/pos");
  s.settle("/a");
  assert.equal(s.get()?.href, "/b", "A landing late keeps B pending");
  s.settle("/b");
  assert.equal(s.get(), null, "B landing clears");
});

test("the superseded list empties when the store clears", () => {
  const s = createNavProgress();
  s.start("/a", "A", 0, "/pos");
  s.start("/b", "B", 10, "/pos");
  s.cancel();
  s.start("/c", "C", 20, "/pos");
  s.settle("/a");
  assert.equal(s.get(), null, "after a cancel, /a is no longer superseded: it counts as another path and clears");
  s.start("/a", "A", 30, "/pos");
  s.start("/b", "B", 40, "/pos");
  s.settle("/b");
  assert.equal(s.get(), null, "target landing clears");
  s.start("/d", "D", 50, "/pos");
  s.settle("/a");
  assert.equal(s.get(), null, "after a settle-clear the list is empty too");
});

test("a path that becomes the target again leaves the superseded list", () => {
  const s = createNavProgress();
  s.start("/a", "A", 0, "/pos");
  s.start("/b", "B", 1, "/pos");
  s.start("/a", "A", 2, "/pos");
  s.settle("/a");
  assert.equal(s.get(), null, "/a is the target again, so landing there clears");
});

test("cancel clears", () => {
  const s = createNavProgress();
  s.start("/orders", "Orders", 0, "/pos");
  s.cancel();
  assert.equal(s.get(), null, "cancel clears");
});

test("stillOpening after 8000 ms only", () => {
  const s = createNavProgress();
  assert.equal(NAV_STILL_OPENING_MS, 8000, "the threshold is 8 s");
  assert.equal(s.stillOpening(99999), false, "idle is never still opening");
  s.start("/orders", "Orders", 1000, "/pos");
  assert.equal(s.stillOpening(1000 + 7999), false, "7999 ms is not yet");
  assert.equal(s.stillOpening(1000 + 8000), true, "8000 ms is");
});

test("subscribers hear every change once", () => {
  const s = createNavProgress();
  let heard = 0;
  const off = s.subscribe(() => heard++);
  s.cancel();
  assert.equal(heard, 0, "cancel when idle is a no-op");
  s.start("/a", "A", 0, "/pos");
  assert.equal(heard, 1, "start notifies once");
  s.start("/b", "B", 1, "/pos");
  assert.equal(heard, 2, "replacing notifies once");
  s.settle("/pos");
  assert.equal(heard, 2, "keeping settle is silent");
  s.settle("/b");
  assert.equal(heard, 3, "clearing settle notifies once");
  s.settle("/b");
  assert.equal(heard, 3, "settle when idle is silent");
  s.start("/c", "C", 2, "/pos");
  s.cancel();
  assert.equal(heard, 5, "start + cancel notify once each");
  off();
  s.start("/d", "D", 3, "/pos");
  assert.equal(heard, 5, "an unsubscribed listener hears nothing");
});

test("get returns a stable reference between changes", () => {
  const s = createNavProgress();
  s.start("/a", "A", 0, "/pos");
  assert.equal(s.get(), s.get(), "same object until something changes");
});

test("navTargetPath reduces an href to its path", () => {
  assert.equal(navTargetPath("/customers?x=1#y"), "/customers", "query and hash stripped");
  assert.equal(navTargetPath("http://localhost:3171/customers?x=1#y"), "/customers", "absolute URL gives its pathname");
  assert.equal(navTargetPath("/orders/"), "/orders", "trailing slash removed");
  assert.equal(navTargetPath("/"), "/", "root stays");
  assert.equal(navTargetPath("/?a=1"), "/", "root with query stays root");
  assert.equal(navTargetPath("https://x.test"), "/", "bare origin is root");
});
