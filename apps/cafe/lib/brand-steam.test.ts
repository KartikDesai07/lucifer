import { test } from "node:test";
import assert from "node:assert/strict";

import { STEAM_HEIGHT, steamAt, steamSeeds } from "./brand-steam";

const BANDS = 10;

/** How many of BANDS equal height bands up the wisp hold at least one
 *  visible puff — an even column fills them all; a single rising band fills one. */
function bandsFilled(t: number): number {
  const filled = new Set<number>();
  for (const p of steamAt(t, steamSeeds())) {
    if (p.alpha > 0.02) filled.add(Math.min(BANDS - 1, Math.floor((p.rise / STEAM_HEIGHT) * BANDS)));
  }
  return filled.size;
}

test("the steam is evenly spread up the wisp at ANY time — including after an hour with the tab in the background", () => {
  // Regression (owner screenshot 2026-09-26): the frame-by-frame version
  // re-spawned every expired puff at the same instant when a background tab
  // woke up, and they rose together as one white streak across the sky.
  for (const t of [0, 1.3, 47.9, 3600, 86_400.5]) {
    assert.ok(bandsFilled(t) >= BANDS - 1, `t=${t}s: puffs fill ${bandsFilled(t)}/${BANDS} bands`);
  }
});

test("steamAt is a pure function of time — the same t, the same steam", () => {
  assert.deepEqual(steamAt(12.5, steamSeeds()), steamAt(12.5, steamSeeds()));
  assert.notDeepEqual(steamAt(12.5, steamSeeds()), steamAt(12.6, steamSeeds()), "and it moves");
});

test("every puff rises from the bowl, stays under its height, and fades out by the top", () => {
  for (const t of [0, 5, 999]) {
    for (const p of steamAt(t, steamSeeds())) {
      assert.ok(p.rise >= 0 && p.rise <= STEAM_HEIGHT, `rise ${p.rise}`);
      assert.ok(p.alpha >= 0 && p.alpha <= 1, `alpha ${p.alpha}`);
      assert.ok(p.r > 0, "every puff has a size");
      if (p.rise > STEAM_HEIGHT * 0.97) assert.ok(p.alpha < 0.1, "near the top it has all but faded");
    }
  }
});
