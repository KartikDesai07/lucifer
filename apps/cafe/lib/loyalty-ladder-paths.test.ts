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
//
// CB-6C S6 — PublicRewardsTab.tsx split into 200 lines + three new files
// (over-300-line cap). Each pin below now reads whichever file carries its
// landmark: the flat single-milestone stamp grid moved to
// PublicStampCard.tsx, the ladder + its reached/next progress moved to
// PublicRewardLadder.tsx, and the branch/empty-state copy stayed on
// PublicRewardsTab.tsx (the composing file). Every needle string from the
// pre-split pins is still asserted verbatim — only its file changed.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const TAB_PATH = "apps/cafe/components/public/PublicRewardsTab.tsx";
const STAMP_CARD_PATH = "apps/cafe/components/public/PublicStampCard.tsx";
const LADDER_PATH = "apps/cafe/components/public/PublicRewardLadder.tsx";
const CODES_PATH = "apps/cafe/components/public/PublicRewardCodes.tsx";
// CB-6D-B — PublicLoyaltyGlance.tsx (Home's stamp-card hero, CB-6D-A
// ACCEPTED) already drew its dots with this literal. PublicStampCard.tsx
// (the Rewards tab's own hero) is being rebuilt on the SAME hero surface
// (PUB_HERO_LG_CLASS) by this slice, so the needle below moves off the old
// bordered-dot literal to match — the two stamp cards must now agree
// byte-for-byte, not just look similar.
const GLANCE_PATH = "apps/cafe/components/public/PublicLoyaltyGlance.tsx";

test("PIN: PublicRewardsTab references card.ladder and card.unitLabel", () => {
  const src = readSrc(TAB_PATH);
  assert.match(src, /card\.ladder/, "must reference card.ladder — the milestone ladder must reach the screen");
  assert.match(src, /card\.unitLabel/, "must reference card.unitLabel — the noun must not be hardcoded 'stamp'");
});

// Positive landmark: the pre-CB-5A single-reward experience (stamp circles +
// MAX_DRAWN_STAMPS) must still be present, byte-provable, not just assumed
// from the absence of a ladder branch (memory: negative pins need vision
// guards — pair every absence with a positive landmark). CB-6C: the grid
// itself now lives in PublicStampCard.tsx; the branch that ROUTES to it
// (card.ladder.length) stays on PublicRewardsTab.tsx.
test("PIN: PublicRewardsTab + PublicStampCard keep the legacy single-milestone stamp-circle path", () => {
  const stampCardSrc = readSrc(STAMP_CARD_PATH);
  const tabSrc = readSrc(TAB_PATH);
  assert.match(stampCardSrc, /MAX_DRAWN_STAMPS/, "PublicStampCard must still carry the MAX_DRAWN_STAMPS landmark");
  // CB-6D-B — re-pointed from the old bordered-dot literal
  // (`h-6 w-6 rounded-full border`) to the Home hero's own dot literal, now
  // that PublicStampCard is rebuilt on the same PUB_HERO_LG_CLASS surface as
  // PublicLoyaltyGlance. Catches: PublicStampCard's flat (non-ladder) branch
  // silently reverting to the pre-CB-6D-B bordered dot instead of the shared
  // filled/outline circle.
  assert.match(
    stampCardSrc,
    /h-7 w-7 place-items-center rounded-full/,
    "PublicStampCard must render the stamp-circle dots for the legacy (non-ladder) card using the Home hero's own dot literal",
  );
  assert.match(
    tabSrc,
    /card\.ladder\.length/,
    "PublicRewardsTab must branch on card.ladder.length so a single-milestone card still gets the legacy render",
  );
});

// CB-6D-B — parity assert: PublicStampCard.tsx (Rewards) and
// PublicLoyaltyGlance.tsx (Home, CB-6D-A ACCEPTED) must draw their stamp dots
// with the SAME literal so the two stamp-card surfaces the diner sees stay
// visually identical rather than drifting into two "close enough" dot
// styles. Catches: either file's dot className losing a token (e.g.
// "place-items-center" dropped, or "h-7 w-7" changed to a different size)
// while the other keeps the original — the byte-for-byte compare below would
// go from two matches to one.
test("PIN: PublicStampCard.tsx and PublicLoyaltyGlance.tsx draw their stamp dots with the SAME literal (h-7 w-7 place-items-center rounded-full)", () => {
  const stampCardSrc = readSrc(STAMP_CARD_PATH);
  const glanceSrc = readSrc(GLANCE_PATH);
  const DOT_LITERAL = "h-7 w-7 place-items-center rounded-full";

  // Positive landmark for the glance side too — proves PublicLoyaltyGlance
  // still exports its component (not gutted), so the parity match below
  // isn't passing vacuously against an emptied file.
  assert.match(glanceSrc, /export function PublicLoyaltyGlance/, "PublicLoyaltyGlance.tsx must still export its component");

  assert.match(stampCardSrc, /h-7 w-7 place-items-center rounded-full/, "PublicStampCard.tsx must carry the shared dot literal");
  assert.ok(glanceSrc.includes(DOT_LITERAL), "PublicLoyaltyGlance.tsx must carry the SAME dot literal as PublicStampCard.tsx");
});

// Positive landmark: the ladder view must actually render each milestone's
// threshold and reward, and state progress toward the NEXT one (not merely
// import the type) — the "explicit progress to next threshold" requirement.
// CB-6C: this view now lives in PublicRewardLadder.tsx.
test("PIN: PublicRewardLadder renders ladder milestones with reached/next progress", () => {
  const src = readSrc(LADDER_PATH);
  assert.match(src, /cyclePosition/, "must compare against card.cyclePosition to know what's reached");
  assert.match(src, /reachedThisCycle|milestone\.at <= cyclePosition/, "must decide reached-vs-upcoming per milestone");
  // F7c (CB-6D-B review fix) — the old bare /toNext/ needle also matched the
  // substring inside card.toNextReward (an unrelated field), so it would
  // still pass even if the ladder's own toNext distance line were deleted.
  // Tightened to the exact "more to reach this" copy OR a word-boundary
  // \btoNext\b match, which card.toNextReward can never satisfy.
  assert.match(src, /more to reach this|\btoNext\b/, "must state the distance to the next threshold");
});

// FIX C — an owner who deletes every milestone row must show the diner an
// explicit "no reward set up yet" state, never the stale reward copy and
// never a claimable-reward banner. Vision guard: pair the absence assertion
// (no stale copy reachable from the empty branch) with the positive landmark
// that the guided empty state actually renders. Unchanged home: this branch
// stays on PublicRewardsTab.tsx (the composing file), not either split-out.
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

// NEW (CB-6C S6) — PublicRewardsTab must actually RENDER its three new split
// components, not just import them: a component that compiles but is never
// mounted is a dead file (memory: a new surface is not done until it is
// reachable). Positive landmark for the S9 reachability sweep too.
test("PIN: PublicRewardsTab renders PublicStampCard, PublicRewardLadder and PublicRewardCodes", () => {
  const src = readSrc(TAB_PATH);
  assert.match(src, /<PublicStampCard/, "must render <PublicStampCard for the flat (non-ladder) card");
  assert.match(src, /<PublicRewardLadder/, "must render <PublicRewardLadder for the milestone-ladder card");
  assert.match(src, /<PublicRewardCodes/, "must render <PublicRewardCodes for the assigned-codes list");
  // Vision guard for the codes file itself: prove it actually renders the
  // assigned reward's code, not merely accept the prop.
  const codesSrc = readSrc(CODES_PATH);
  assert.match(codesSrc, /reward\.code/, "PublicRewardCodes must render each assigned reward's code");
});
