import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HELD_ROUTES_WINDOW_MS, createHeldRoutes, heldKeyOf, heldRoutes, markVisit } from "./held-routes";

test("holds is true only for a marked route, strictly inside the window", () => {
  const held = createHeldRoutes(1000);
  assert.equal(held.holds("/pos", 0), false, "an unmarked route is not held");
  assert.equal(held.offeredAt("/pos"), undefined, "no offer time before a mark");
  held.mark("/pos", 100);
  assert.equal(held.offeredAt("/pos"), 100, "the offer time is what was marked");
  assert.equal(held.holds("/pos", 100), true, "held at the moment of the mark");
  assert.equal(held.holds("/pos", 1099), true, "held just inside the window");
  assert.equal(held.holds("/pos", 1100), false, "at the boundary the entry is gone (strict)");
  assert.equal(held.holds("/pos", 5000), false, "after the window it is not held");
  assert.equal(held.holds("/orders", 100), false, "another route is unaffected");
});

test("marking again restarts the window", () => {
  const held = createHeldRoutes(1000);
  held.mark("/pos", 0);
  held.mark("/pos", 900);
  assert.equal(held.holds("/pos", 1500), true, "the later mark counts");
  assert.equal(held.offeredAt("/pos"), 900, "the offer time is the later mark");
});

test("the page's record uses the router-cache window: HELD_ROUTES_WINDOW_MS equals next.config.ts PREFETCH_REUSE_SECONDS * 1000", () => {
  const config = readFileSync(fileURLToPath(new URL("../next.config.ts", import.meta.url)), "utf8");
  const m = config.match(/const PREFETCH_REUSE_SECONDS = (\d+) \* (\d+);/);
  assert.ok(m, "next.config.ts must declare PREFETCH_REUSE_SECONDS as <a> * <b>");
  assert.equal(HELD_ROUTES_WINDOW_MS, Number(m![1]) * Number(m![2]) * 1000, "the two windows must not drift apart");
  heldRoutes.mark("/__held-test", 0);
  assert.equal(heldRoutes.holds("/__held-test", HELD_ROUTES_WINDOW_MS - 1), true, "the shared record uses that window");
  assert.equal(heldRoutes.holds("/__held-test", HELD_ROUTES_WINDOW_MS), false, "and expires at it");
});

// Final review m-d (ruling R36): Next's router cache keeps a screen per URL, so a link with a query string counts as held
// only by that exact URL, and a visit marks both forms.
test("heldKeyOf: the path alone, or the path + query when the href has one", () => {
  assert.equal(heldKeyOf("/orders"), "/orders", "a plain href is its path");
  assert.equal(heldKeyOf("/orders/"), "/orders", "a trailing slash names the same page");
  assert.equal(heldKeyOf("/orders?date=2026-11-07"), "/orders?date=2026-11-07", "a query is part of the key");
  assert.equal(heldKeyOf("/orders?date=X#top"), "/orders?date=X", "the hash never is");
  assert.equal(heldKeyOf("/orders?"), "/orders", "an empty query is no query");
  assert.equal(heldKeyOf("https://pos.example.com/kitchen?x=1"), "/kitchen?x=1", "an absolute URL by its path + query");
});

test("markVisit: the path always, and the path + query when the page shows one", () => {
  const held = createHeldRoutes(1000);
  markVisit(held, "/orders", "", 5);
  assert.equal(held.holds("/orders", 5), true, "a plain visit holds the path");
  assert.equal(held.offeredAt("/orders?"), undefined, "and marks nothing else");
  markVisit(held, "/orders", "?date=X", 6);
  assert.equal(held.offeredAt("/orders"), 6, "a visit with a query marks the path too");
  assert.equal(held.holds(heldKeyOf("/orders?date=X"), 6), true, "the visit's key is the one a tap on that href asks about");
  assert.equal(held.holds("/orders?date=Y", 6), false, "another query is not held");
});
