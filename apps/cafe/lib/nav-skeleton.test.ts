import assert from "node:assert/strict";
import { test } from "node:test";

import { NAV_STILL_OPENING_MS, type NavProgress } from "./nav-progress";
import { coverOf, skeletonKindOf, stillOpeningIn } from "./nav-skeleton";

// P2 N1: a tap shows the target screen's skeleton in the same frame. One table picks its kind per route.

test("skeletonKindOf: the boards, the forms, and the list for every other screen", () => {
  const table: Array<[string, "list" | "board" | "form"]> = [
    ["/", "board"],
    ["/tables", "board"],
    ["/kitchen", "board"],
    ["/pos", "board"],
    ["/now-serving", "board"],
    ["/settings", "form"],
    ["/settings/business", "form"],
    ["/settings/bill-print", "form"],
    ["/settings/taxes", "form"],
    ["/printers", "form"],
    ["/orders", "list"],
    ["/requests", "list"],
    ["/reservations", "list"],
    ["/customers", "list"],
    ["/customers/festival-cards", "list"],
    ["/products", "list"],
    ["/categories", "list"],
    ["/reports/sales", "list"],
    ["/tables/setup", "list"],
    ["/tables/qr", "list"],
    ["/staff", "list"],
    ["/inventory", "list"],
    ["/expenses", "list"],
    ["/events", "list"],
  ];
  for (const [path, kind] of table) assert.equal(skeletonKindOf(path), kind, `${path} opens on the ${kind} skeleton`);
});

test("skeletonKindOf reads the path only: a query, a hash or a trailing slash changes nothing", () => {
  assert.equal(skeletonKindOf("/pos?table=T-1"), "board", "a query is not part of the path");
  assert.equal(skeletonKindOf("/tables/"), "board", "a trailing slash is the same page");
  assert.equal(skeletonKindOf("/settings/taxes#gst"), "form", "a hash is not part of the path");
  assert.equal(skeletonKindOf("/settingsx"), "list", "the settings forms are a path segment, not a text prefix");
  assert.equal(skeletonKindOf("/printers/x"), "list", "only the printers page itself is a form");
});

const tapped: NonNullable<NavProgress> = { href: "/orders?status=open", label: "Orders", startedAt: 1000, fromPath: "/pos" };

test("coverOf: the skeleton covers the page only while the path is still the one the tap came from", () => {
  assert.equal(coverOf(tapped, "/pos"), tapped, "the path at the tap is covered by the target's skeleton");
  assert.equal(coverOf(tapped, "/orders"), null, "the target path: the new screen shows");
  assert.equal(coverOf(tapped, "/reports/sales"), null, "a redirect landed somewhere else: never covered");
  assert.equal(coverOf(null, "/pos"), null, "nothing opening: nothing covers");
});

test("stillOpeningIn: the wait until the words show, counted from the tap", () => {
  assert.equal(stillOpeningIn(tapped, 1000), NAV_STILL_OPENING_MS, "at the tap: the whole 8 s");
  assert.equal(stillOpeningIn(tapped, 4000), NAV_STILL_OPENING_MS - 3000, "3 s after the tap: the rest");
  assert.equal(stillOpeningIn(tapped, 1000 + NAV_STILL_OPENING_MS + 500), 0, "past the 8 s: at once, never negative");
  assert.equal(NAV_STILL_OPENING_MS, 8000, "the global constraint's 8 s");
});
