import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// CB-5A S6 — reachability pins for the diner Rewards tab's ladder render.
// Source pins (readFileSync over the real file), matching the house shape in
// settings-sections.test.ts's last test: this repo's rule is that a new
// surface is not done until something proves it is REACHABLE, not just that
// the code compiles.
//
// CB-5D (owner, 2026-09-15): `levels` and `membership` are REMOVED from
// loyaltyRulesSchema — no client used either. The two pins below that
// exercised card.level/card.membership are removed with them; the ladder
// pins are unaffected and stay.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const TAB_PATH = "apps/cafe/components/public/PublicRewardsTab.tsx";

test("PIN: PublicRewardsTab references card.ladder and card.unitLabel", () => {
  const src = readSrc(TAB_PATH);
  assert.match(src, /card\.ladder/, "must reference card.ladder — the milestone ladder must reach the screen");
  assert.match(src, /card\.unitLabel/, "must reference card.unitLabel — the noun must not be hardcoded 'stamp'");
});

// Positive landmark: the pre-CB-5A single-reward experience (stamp circles +
// MAX_DRAWN_STAMPS) must still be present, byte-provable, not just assumed
// from the absence of a ladder branch (memory: negative pins need vision
// guards — pair every absence with a positive landmark).
test("PIN: PublicRewardsTab keeps the legacy single-milestone stamp-circle path", () => {
  const src = readSrc(TAB_PATH);
  assert.match(src, /MAX_DRAWN_STAMPS/, "must still carry the MAX_DRAWN_STAMPS landmark");
  assert.match(
    src,
    /h-6 w-6 rounded-full border/,
    "must still render the stamp-circle dots for the legacy (non-ladder) card",
  );
  assert.match(
    src,
    /card\.ladder\.length/,
    "must branch on card.ladder.length so a single-milestone card still gets the legacy render",
  );
});

// Positive landmark: the ladder view must actually render each milestone's
// threshold and reward, and state progress toward the NEXT one (not merely
// import the type) — the "explicit progress to next threshold" requirement.
test("PIN: PublicRewardsTab renders ladder milestones with reached/next progress", () => {
  const src = readSrc(TAB_PATH);
  assert.match(src, /cyclePosition/, "must compare against card.cyclePosition to know what's reached");
  assert.match(src, /reachedThisCycle|milestone\.at <= cyclePosition/, "must decide reached-vs-upcoming per milestone");
  assert.match(src, /more to reach this|toNext/, "must state the distance to the next threshold");
});

// FIX C — an owner who deletes every milestone row must show the diner an
// explicit "no reward set up yet" state, never the stale reward copy and
// never a claimable-reward banner. Vision guard: pair the absence assertion
// (no stale copy reachable from the empty branch) with the positive landmark
// that the guided empty state actually renders.
test("PIN: PublicRewardsTab renders a guided no-reward-set-up state when card.ladder.length === 0, and never the reward-ready/next-reward copy in that branch", () => {
  const src = readSrc(TAB_PATH);
  assert.match(
    src,
    /card\.ladder\.length === 0/,
    "must branch explicitly on an empty ladder before reaching the reward-ready/next-reward copy",
  );
  assert.match(
    src,
    /no reward set up yet/i,
    "must render explicit guided copy telling the diner no reward exists yet",
  );
});
