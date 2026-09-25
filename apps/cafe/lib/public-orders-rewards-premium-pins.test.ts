import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CB-6D-B — source pins for the Orders + Rewards premium rebuild
// (.claude/plan/v2/cb6d-b-orders-rewards-plan.md, "PINS (slice C)"). Behaviour
// of the pure public-rewards-view.ts module is pinned separately in
// lib/public-rewards-view.test.ts (kept out of this file to stay under the
// 300-line budget). Same readSrc/mustInclude technique as
// lib/public-home-premium-pins.test.ts and lib/public-diner-panel-pins.test.ts.
//
// CB-6D-B REVIEW FIXES (.claude/plan/v2/cb6d-b-review-fixes.md) — this file
// was already at 292 lines, so its Orders-side pins were MOVED byte-for-byte
// into a NEW sibling lib/public-orders-premium-pins.test.ts to make room for
// the F1/F7a pins added below; only the Rewards-side + shared touch-floor/
// account/shell pins stayed here.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

function mustInclude(haystack: string, needle: string, what: string): void {
  assert.ok(haystack.includes(needle), `expected to find ${what}`);
}

const PUBLIC_UI = "apps/cafe/components/public/public-ui.ts";
const ORDERS_TAB = "apps/cafe/components/public/PublicMyOrdersTab.tsx";
const STAMP_CARD = "apps/cafe/components/public/PublicStampCard.tsx";
const STAMP_TRACK = "apps/cafe/components/public/PublicStampTrack.tsx";
const REWARD_LADDER = "apps/cafe/components/public/PublicRewardLadder.tsx";
const REWARDS_TAB = "apps/cafe/components/public/PublicRewardsTab.tsx";
const REWARD_CODES = "apps/cafe/components/public/PublicRewardCodes.tsx";
const REWARDS_VIEW = "apps/cafe/components/public/public-rewards-view.ts";
const ACCOUNT_TAB = "apps/cafe/components/public/PublicAccountTab.tsx";
const SHELL = "apps/cafe/components/public/PublicDinerShell.tsx";

// ── (1) public-ui.ts foundation literals reach both tabs ───────────────────

test("PIN: public-ui.ts exports PUB_SCREEN_TITLE_CLASS and PUB_PILL_BUTTON_CLASS as whole literals, and both tabs contain PUB_SCREEN_TITLE_CLASS", () => {
  const uiSrc = readSrc(PUBLIC_UI);
  assert.match(
    uiSrc,
    /export const PUB_SCREEN_TITLE_CLASS = "[^"]+"/,
    "public-ui.ts must export PUB_SCREEN_TITLE_CLASS as a whole hand-written literal (Tailwind JIT cannot see a built string)",
  );
  assert.match(
    uiSrc,
    /export const PUB_PILL_BUTTON_CLASS = "[^"]+"/,
    "public-ui.ts must export PUB_PILL_BUTTON_CLASS as a whole hand-written literal",
  );
  mustInclude(stripComments(readSrc(ORDERS_TAB)), "PUB_SCREEN_TITLE_CLASS", "PublicMyOrdersTab.tsx using PUB_SCREEN_TITLE_CLASS for its own title");
  mustInclude(stripComments(readSrc(REWARDS_TAB)), "PUB_SCREEN_TITLE_CLASS", "PublicRewardsTab.tsx using PUB_SCREEN_TITLE_CLASS for its own title");
});

// ── (2) Orders tab — MOVED to lib/public-orders-premium-pins.test.ts ───────
// (the four PIN tests for PublicMyOrdersTab / PublicOrderBillView /
// PublicOrderRow / PublicStatusTimeline now live there, byte-for-byte, plus
// the new F3/F8 pins — see that file's header comment).

// ── (3) Rewards tab ──────────────────────────────────────────────────────

test("PIN: PublicStampCard.tsx renders on PUB_HERO_LG_CLASS with the 5xl number and <PublicStampTrack for the ladder mode, and keeps MAX_DRAWN_STAMPS", () => {
  const src = stripComments(readSrc(STAMP_CARD));
  mustInclude(src, "export function PublicStampCard", "PublicStampCard.tsx still exporting its component (positive landmark)");
  mustInclude(src, "PUB_HERO_LG_CLASS", "rendering on the large hero surface, matching Home's accepted stamp card");
  mustInclude(src, "text-5xl", "the big stamp-count number");
  mustInclude(src, "<PublicStampTrack", "rendering the horizontal bar for a ladder cafe");
  mustInclude(src, "MAX_DRAWN_STAMPS", "keeping the flat-mode dot ceiling");
});

test("PIN: PublicStampTrack.tsx computes its geometry via trackGeometry(, applies it through style={{ width / style={{ left (never a computed className), and never fetches", () => {
  const src = stripComments(readSrc(STAMP_TRACK));
  mustInclude(src, "export function PublicStampTrack", "PublicStampTrack.tsx still exporting its component (positive landmark)");
  mustInclude(src, "trackGeometry(", "delegating all geometry math to the pure trackGeometry helper");
  mustInclude(src, "style={{ width", "applying fill percent via inline style (Tailwind JIT cannot see a runtime percentage)");
  mustInclude(src, "style={{ left", "applying each marker's offset via inline style");
  assert.ok(!src.includes("fetch("), "PublicStampTrack.tsx must be presentational only — no fetch(");
});

test("PIN: PublicRewardLadder.tsx renders \"What you can unlock\", states toNext, uses PUB_PILL_BUTTON_CLASS, keeps the four claim-control copy literals, and no longer declares rewardWorth or LadderStep", () => {
  const src = stripComments(readSrc(REWARD_LADDER));
  mustInclude(src, "export function PublicRewardLadder", "PublicRewardLadder.tsx still exporting its component (positive landmark)");
  mustInclude(src, "What you can unlock", "the rewards-list section heading");
  // F7c — the old bare "toNext" needle matched the substring inside
  // card.toNextReward too (a different field), so it would still pass even
  // if the ladder's own toNext distance line were deleted. Tightened to the
  // exact copy + the exact declaration.
  mustInclude(src, "more to go", "stating the distance to the next milestone");
  assert.match(src, /const toNext = milestone\.at - cyclePosition/, "toNext must be declared as milestone.at - cyclePosition, not reused from an unrelated field");
  mustInclude(src, "PUB_PILL_BUTTON_CLASS", "the claim button composed on the shared pill class");

  // The four RewardClaimControl copy literals — byte-kept per the contract.
  mustInclude(src, "Not enough stamps yet.", "the not-affordable copy");
  mustInclude(src, "Remove your promo code in the cart to claim this reward.", "the promo-blocks-claim copy");
  mustInclude(src, "Claim with this order", "the unselected claim-button copy");
  mustInclude(src, "Selected for this order", "the selected claim-button copy");

  // Mutation caught: a local `function rewardWorth` re-declared here instead
  // of importing the single home in public-rewards-view.ts (the MOVE the
  // contract requires), or the deleted vertical-step LadderStep component
  // creeping back in alongside the new card-list layout.
  assert.ok(!src.includes("function rewardWorth"), "must NOT locally declare rewardWorth — it moved to public-rewards-view.ts");
  assert.ok(!/\bLadderStep\b/.test(src), "the deleted vertical-connector LadderStep component must not reappear");
});

// F1 (CB-6D-B review fix, HIGH) — PublicRewardLadder gated the claim on
// milestone.at <= cyclePosition (the CURRENT cycle) while the server decides
// on the customer's TOTAL stamps; and the hero was fed the showFull-adjusted
// `position` while the list was fed the raw card.cyclePosition. Fix:
// PublicRewardLadder gets a NEW `stamps` prop and gates the claim control via
// ladderRungAffordable(stamps, milestone.at) (the server's own balance test)
// while KEEPING milestone.at <= cyclePosition for the display tick/isNext —
// they now deliberately differ. RED now: the file still writes the literal
// `affordable={reached}` and has no ladderRungAffordable( call at all.
test("PIN (F1): PublicRewardLadder.tsx gates the claim control on ladderRungAffordable(, not the display tick, and keeps milestone.at <= cyclePosition for the tick", () => {
  const src = stripComments(readSrc(REWARD_LADDER));
  mustInclude(src, "milestone.at <= cyclePosition", "the display tick (reached-this-cycle) must still compare against cyclePosition");

  // affordable={reached} would silently re-couple the claim gate to the
  // display tick — exactly the bug F1 fixes — so it must be gone, and in its
  // place `affordable={` must resolve through ladderRungAffordable(.
  assert.ok(!src.includes("affordable={reached}"), "the claim control must NOT gate on the display tick (affordable={reached} is the F1 bug)");
  const affordableMatch = src.match(/affordable=\{([^}]*)\}/);
  assert.ok(affordableMatch, "expected to find an affordable={...} prop on the claim control");
  assert.match(affordableMatch![1], /ladderRungAffordable\(/, "affordable={...} must resolve through ladderRungAffordable( — the server's TOTAL-stamps balance test");
});

// F1 — PublicRewardsTab must derive filled/position via the new
// cardProgress( helper (replacing the inline filled/showFull/position
// derivation) and feed the SAME `position` to both the hero
// (cyclePosition={position} on PublicStampCard) and the list
// (cyclePosition={position} on PublicRewardLadder, plus a NEW stamps prop) —
// the hero/list parity the contract requires. `cyclePosition={position}`
// must appear EXACTLY twice and `card.cyclePosition` must no longer appear
// anywhere in the file (both call sites now read the derived `position`).
test("PIN (F1): PublicRewardsTab.tsx derives filled/position via cardProgress(, feeds cyclePosition={position} to BOTH the hero and the list (exactly twice), passes stamps={card.stamps}, and no longer reads card.cyclePosition directly", () => {
  const src = stripComments(readSrc(REWARDS_TAB));
  mustInclude(src, "cardProgress(", "deriving { filled, position } via the single-homed cardProgress helper");
  mustInclude(src, "stamps={card.stamps}", "passing the diner's TOTAL stamps down to PublicRewardLadder for the server-parity claim gate");

  const POSITION_NEEDLE = "cyclePosition={position}";
  const occurrences = src.split(POSITION_NEEDLE).length - 1;
  assert.equal(occurrences, 2, `cyclePosition={position} must appear EXACTLY twice (hero + list), found ${occurrences}`);

  assert.ok(!src.includes("card.cyclePosition"), "must no longer read card.cyclePosition directly — both the hero and the list now read the derived position");
});

test("PIN: PublicRewardsTab.tsx renders <PublicRewardsHowItWorks at least TWICE (signed-out and signed-in), calls nextRewardLine(, titles itself \"Rewards\", keeps the four store-bridge imports, and keeps the empty-ladder + lifetime-total branches", () => {
  const src = stripComments(readSrc(REWARDS_TAB));
  mustInclude(src, "export function PublicRewardsTab", "PublicRewardsTab.tsx still exporting its component (positive landmark)");

  // Count assertion: rendered in BOTH the signed-out/no-card branch and the
  // signed-in branch — a component that only renders it in ONE branch would
  // still satisfy an "at least once" check but fail the contract's "renders
  // in BOTH signed-out and signed-in" requirement for PublicRewardsHowItWorks.
  const HOW_IT_WORKS_NEEDLE = "<PublicRewardsHowItWorks";
  const occurrences = src.split(HOW_IT_WORKS_NEEDLE).length - 1;
  assert.ok(occurrences >= 2, `<PublicRewardsHowItWorks must render at least TWICE (signed-out + signed-in), found ${occurrences}`);

  mustInclude(src, "nextRewardLine(", "deriving the hero's one footer line via the single-homed nextRewardLine helper");
  mustInclude(src, ">Rewards<", "the tab's own screen title (JSX text, both branches)");
  mustInclude(src, "readRequestedRewardAt", "the store-bridge read of a previously-selected reward");
  mustInclude(src, "writeRequestedRewardAt", "the store-bridge write of a newly-selected reward");
  mustInclude(src, "clearRequestedRewardAt", "the store-bridge clear of a de-selected reward");
  mustInclude(src, "readAppliedPromoCode", "the store-bridge read of the cart's applied promo code");
  mustInclude(src, "card.ladder.length === 0", "the explicit empty-ladder branch (FIX C)");
  mustInclude(src, "here in total", "the lifetime-stamps closing line");
});

// F7a (CB-6D-B review fix) — the old "at least TWICE" check above counts
// <PublicRewardsHowItWorks file-wide, so it would still pass even if BOTH
// renders sat inside the same branch (e.g. two copies stacked in the
// signed-in body, with the signed-out branch's copy silently deleted). Fix:
// slice the stripped source at the two landmarks the contract names — the
// guard `if (!signedIn || !card) {` (start of the signed-out branch) and
// `const { filled, position } = cardProgress(card);` (F1's new landmark,
// start of the signed-in body) — assert both landmarks exist, are ordered,
// and mustInclude the how-it-works needle in EACH slice independently.
test("PIN (F7a): <PublicRewardsHowItWorks renders in BOTH the signed-out slice and the signed-in slice, not twice in one branch", () => {
  const src = stripComments(readSrc(REWARDS_TAB));

  const GUARD_NEEDLE = "if (!signedIn || !card) {";
  const SIGNED_IN_NEEDLE = "const { filled, position } = cardProgress(card);";
  const guardIdx = src.indexOf(GUARD_NEEDLE);
  const signedInIdx = src.indexOf(SIGNED_IN_NEEDLE);

  assert.notEqual(guardIdx, -1, "expected to find the signed-out/no-card guard landmark");
  assert.notEqual(signedInIdx, -1, "expected to find the F1 cardProgress( landmark marking the signed-in body's start");
  assert.ok(guardIdx < signedInIdx, "the guard branch must appear BEFORE the signed-in body in source order");

  const HOW_IT_WORKS_NEEDLE = "<PublicRewardsHowItWorks";
  const signedOutSlice = src.slice(guardIdx, signedInIdx);
  const signedInSlice = src.slice(signedInIdx);

  mustInclude(signedOutSlice, HOW_IT_WORKS_NEEDLE, "the signed-out/no-card branch rendering PublicRewardsHowItWorks on its own");
  mustInclude(signedInSlice, HOW_IT_WORKS_NEEDLE, "the signed-in branch rendering PublicRewardsHowItWorks on its own, not just the signed-out one");
});

test("PIN: PublicRewardCodes.tsx renders \"Your reward codes\" and \"Apply it in your cart at checkout\"", () => {
  const src = stripComments(readSrc(REWARD_CODES));
  mustInclude(src, "export function PublicRewardCodes", "PublicRewardCodes.tsx still exporting its component (positive landmark)");
  mustInclude(src, "Your reward codes", "the section heading");
  mustInclude(src, "Apply it in your cart at checkout", "the checkout instruction line");
});

// unitWord must be declared in EXACTLY public-rewards-view.ts among the
// Rewards files — never redeclared locally in any of the five consuming
// files (PublicStampCard/PublicRewardLadder/PublicRewardsTab/
// PublicRewardCodes/PublicStampTrack). Mutation caught: any one of those
// five re-growing its own `function unitWord`/`const unitWord` instead of
// importing the shared helper.
test("PIN: function unitWord is declared in public-rewards-view.ts and in NO other Rewards file", () => {
  const viewSrc = stripComments(readSrc(REWARDS_VIEW));
  mustInclude(viewSrc, "export function unitWord", "public-rewards-view.ts must be unitWord's one declaring home");

  const DECL_RE = /\b(function|const)\s+unitWord\b/;
  for (const rel of [STAMP_CARD, REWARD_LADDER, REWARDS_TAB, REWARD_CODES, STAMP_TRACK]) {
    const src = stripComments(readSrc(rel));
    assert.ok(!DECL_RE.test(src), `${rel} must NOT declare its own unitWord — it must import the single home in public-rewards-view.ts`);
  }
});

test("PIN: HOW_IT_WORKS_STEPS has 3 entries and PublicRewardsHowItWorks.tsx maps it", () => {
  const viewSrc = readSrc(REWARDS_VIEW);
  const match = viewSrc.match(/export const HOW_IT_WORKS_STEPS = \[([\s\S]*?)\] as const/);
  assert.ok(match, "public-rewards-view.ts must export HOW_IT_WORKS_STEPS as a const array");
  const entryCount = (match![1].match(/"/g) ?? []).length / 2;
  assert.equal(entryCount, 3, "HOW_IT_WORKS_STEPS must have exactly 3 step strings — the owner's quiet 3-step strip");

  const stepsSrc = stripComments(readSrc("apps/cafe/components/public/PublicRewardsHowItWorks.tsx"));
  mustInclude(stepsSrc, "export function PublicRewardsHowItWorks", "PublicRewardsHowItWorks.tsx still exporting its component (positive landmark)");
  mustInclude(stepsSrc, "HOW_IT_WORKS_STEPS", "mapping over the shared steps array rather than hardcoding its own copy");
});

// ── (5) touch floor — MOVED to lib/public-orders-premium-pins.test.ts ──────
// (extractOpeningTags + the touch-floor walk over TOUCH_FLOOR_FILES, which
// spans both the Orders and Rewards A/B files, now live there byte-for-byte
// to make room for this file's new F1/F7a/F7c pins under the 300-line cap.)

// ── (6) Account tab untouched + shell wiring unchanged ──────────────────────

test("PIN: PublicAccountTab.tsx is untouched by this slice — still renders the two-tap sign-out copy (\"Really sign out?\" / \"Never mind\")", () => {
  const src = readSrc(ACCOUNT_TAB);
  mustInclude(src, "Really sign out?", "the sign-out confirmation copy");
  mustInclude(src, "Never mind", "the sign-out cancel copy");
});

test("PIN: PublicDinerShell.tsx still wires <PublicMyOrdersTab and <PublicRewardsTab — the props contract of both tabs is unchanged by this slice", () => {
  const src = stripComments(readSrc(SHELL));
  mustInclude(src, "<PublicMyOrdersTab", "the shell still rendering the Orders tab");
  mustInclude(src, "<PublicRewardsTab", "the shell still rendering the Rewards tab");
});
