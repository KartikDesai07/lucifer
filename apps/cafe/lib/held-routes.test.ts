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

// Post-verifier V1/V2: Next 15.5 keeps a prefetch answered by another build, or one that failed, as a hard-load marker
// for its entry's whole life, so a mark made at or after the last moment the answers were known good is distrusted.
test("distrustSince: a mark made at or after `since` is suspect and not held, until its own window ends", () => {
  const held = createHeldRoutes(1000);
  held.mark("/pos", 100);
  held.mark("/orders", 300);
  held.mark("/kitchen", 500);
  held.distrustSince(300);
  assert.equal(held.suspect("/pos", 600), false, "a mark before `since` stays trusted");
  assert.equal(held.holds("/pos", 600), true, "and held");
  assert.equal(held.suspect("/orders", 600), true, "a mark exactly at `since` is suspect (its answer may have come after)");
  assert.equal(held.holds("/orders", 600), false, "a suspect mark is never held");
  assert.equal(held.suspect("/kitchen", 600), true, "a later mark is suspect");
  assert.equal(held.offeredAt("/kitchen"), 500, "its offer time stays: a touch must not ask again for an entry Next keeps");
  assert.equal(held.suspect("/kitchen", 1499), true, "suspect to the end of its own window");
  assert.equal(held.suspect("/kitchen", 1500), false, "at the boundary the entry is gone, and the suspicion with it");
  assert.equal(held.holds("/kitchen", 1500), false, "and nothing is held there either");
  assert.equal(held.suspect("/menu", 600), false, "an unmarked route is never suspect");
});

test("a suspect mark stays suspect through a later mark inside its window; a mark after the window starts trusted", () => {
  const held = createHeldRoutes(1000);
  held.mark("/orders", 100);
  held.distrustSince(50);
  held.mark("/orders", 900);
  assert.equal(held.suspect("/orders", 950), true, "a later mark inside the window clears nothing (Next would not refetch a live entry)");
  assert.equal(held.holds("/orders", 950), false, "still not held");
  held.mark("/orders", 1100);
  assert.equal(held.suspect("/orders", 1100), false, "a mark after the window ended is a new entry: trusted");
  assert.equal(held.holds("/orders", 1100), true, "and held");
});

test("distrustSince(null) distrusts every mark; a mark made after the call is trusted", () => {
  const held = createHeldRoutes(1000);
  held.mark("/pos", 0);
  held.mark("/orders", 10);
  held.distrustSince(null);
  assert.equal(held.suspect("/pos", 20), true, "no good report seen yet: every mark is suspect, even one at 0");
  assert.equal(held.suspect("/orders", 20), true, "every mark");
  held.mark("/kitchen", 30);
  assert.equal(held.suspect("/kitchen", 40), false, "a mark after the distrust is not touched by it");
  assert.equal(held.holds("/kitchen", 40), true, "and is held");
});

// Post-verifier V11: a soft visit that landed proves Next's entry for its key came from this page's build (another
// build's answer or a failed fetch would have loaded the document instead), so that window is never distrusted.
test("visit: a landed visit's window is never distrusted; a prefetch-only mark made at the same time is", () => {
  const held = createHeldRoutes(1000);
  held.visit("/pos", 300);
  held.mark("/orders", 300);
  held.distrustSince(200);
  assert.equal(held.suspect("/pos", 400), false, "a landed visit after `since` is not distrusted");
  assert.equal(held.holds("/pos", 400), true, "it still opens from memory");
  assert.equal(held.suspect("/orders", 400), true, "a prefetch-only mark after `since` is distrusted");
  held.distrustSince(null);
  assert.equal(held.suspect("/pos", 400), false, "not even by a distrust of every mark");
});

test("visit: a landed visit inside a distrusted window clears it for that window; the next window starts unproven", () => {
  const held = createHeldRoutes(1000);
  held.mark("/orders", 100);
  held.distrustSince(50);
  assert.equal(held.suspect("/orders", 500), true, "landmark: a distrusted prefetch mark");
  held.visit("/orders", 600);
  assert.equal(held.offeredAt("/orders"), 100, "the visit keeps the window's first time");
  assert.equal(held.suspect("/orders", 700), false, "Next opened the screen from that entry, so the entry is good");
  assert.equal(held.holds("/orders", 700), true, "held again");
  held.mark("/orders", 1200);
  held.distrustSince(1100);
  assert.equal(held.suspect("/orders", 1300), true, "a new window (a prefetch after the old one ended) is not proven by the old visit");
});

test("markVisit: a landing that proves its entry is a visit; one that does not only marks; a query visit marks nothing", () => {
  const held = createHeldRoutes(1000);
  markVisit(held, "/pos", "", 300, true);
  markVisit(held, "/kitchen", "", 300);
  markVisit(held, "/menu", "?x=1", 300, true);
  held.distrustSince(200);
  assert.equal(held.suspect("/pos", 400), false, "a proving landing is never distrusted");
  assert.equal(held.suspect("/kitchen", 400), true, "a landing that proves nothing (a Back / Forward step) is only a mark");
  assert.equal(held.offeredAt("/menu"), undefined, "a query visit still marks nothing (R40, R41)");
});
