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

test("marking again inside the window keeps the first time; after it, a new window starts", () => {
  const held = createHeldRoutes(1000);
  held.mark("/pos", 0);
  held.mark("/pos", 900);
  assert.equal(held.offeredAt("/pos"), 0, "a mark inside the window keeps the first time (Next never extends an entry)");
  assert.equal(held.holds("/pos", 999), true, "held until first + window");
  assert.equal(held.holds("/pos", 1000), false, "gone at first + window, whatever the later mark said");
  held.mark("/pos", 1500);
  assert.equal(held.offeredAt("/pos"), 1500, "a mark after the window ended starts a new window");
  assert.equal(held.holds("/pos", 2499), true, "held until new + window");
  assert.equal(held.holds("/pos", 2500), false, "and ends there");
  held.mark("/kitchen", 0);
  held.mark("/kitchen", 1000);
  assert.equal(held.offeredAt("/kitchen"), 1000, "a mark exactly at first + window starts a new window");
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
// only by that exact URL, and only once it was offered: a visit with a query marks nothing (rulings R40, R41).
test("heldKeyOf: the path alone, or the path + query when the href has one", () => {
  assert.equal(heldKeyOf("/orders"), "/orders", "a plain href is its path");
  assert.equal(heldKeyOf("/orders/"), "/orders", "a trailing slash names the same page");
  assert.equal(heldKeyOf("/orders?date=2026-11-07"), "/orders?date=2026-11-07", "a query is part of the key");
  assert.equal(heldKeyOf("/orders?date=X#top"), "/orders?date=X", "the hash never is");
  assert.equal(heldKeyOf("/orders?"), "/orders", "an empty query is no query");
  assert.equal(heldKeyOf("https://pos.example.com/kitchen?x=1"), "/kitchen?x=1", "an absolute URL by its path + query");
});

test("markVisit: a plain visit holds the path; a visit with a query marks nothing (R40, R41)", () => {
  const held = createHeldRoutes(1000);
  markVisit(held, "/orders", "", 5);
  assert.equal(held.holds("/orders", 5), true, "a plain visit holds the path");
  assert.equal(held.offeredAt("/orders?"), undefined, "and marks nothing else");
  markVisit(held, "/orders", "", 500);
  assert.equal(held.offeredAt("/orders"), 5, "a plain visit inside a live window keeps the first time");
  markVisit(held, "/orders", "?date=X", 600);
  assert.equal(held.offeredAt("/orders"), 5, "a query visit leaves a held bare path's time alone");
  assert.equal(held.offeredAt("/orders?date=X"), undefined, "the query URL is stored nowhere by Next, so never held");
  markVisit(held, "/kitchen", "?x=1", 7);
  assert.equal(held.offeredAt("/kitchen"), undefined, "a query visit does not mark the bare path either");
  assert.equal(held.holds("/orders?date=Y", 600), false, "another query is not held");
});
