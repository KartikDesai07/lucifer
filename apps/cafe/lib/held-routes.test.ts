import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HELD_ROUTES_WINDOW_MS, createHeldRoutes, heldRoutes } from "./held-routes";

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
  assert.equal(held.offeredAt("/pos"), 900);
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
