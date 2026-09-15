import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ladderOf, LOYALTY_CARD_SIZE_DEFAULT } from "@pos/shared/loyalty-rules";
import { loyaltyRulesFormDefaults } from "./loyalty-rules-form";
import { stripComments } from "./source-pin-utils";

// CB-5C — the stamp card: a row of numbered boxes, tap one to set the reward
// that lands there. Pins the two things that decide real money/behaviour (the
// card's cycle length, and what a pre-CB-5C cafe's card becomes) plus the
// surface itself.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(HERE, "..", rel), "utf8");

const GRID_PATH = "components/settings/LoyaltyStampGrid.tsx";
const PAGE_PATH = "app/(dashboard)/settings/loyalty/page.tsx";

// ── cycleLength: ONE source, with the rows as the authority ─────────────────

test("ladderOf: cardSize sets the cycle length, so a card can run PAST its last reward", () => {
  // The whole point of a stored size: a card of 8 whose only rewards sit at 3
  // and 5 still takes 8 stamps to come round. Without the override the cycle
  // would end at 5 and the last three boxes would never exist.
  const ladder = ladderOf([{ at: 3, kind: "flat", value: 50, item: "" }, { at: 5, kind: "flat", value: 99, item: "" }], 8);
  assert.equal(ladder.cycleLength, 8);
  assert.equal(ladder.milestones.length, 2);
});

test("ladderOf: with no cardSize the cycle is still the LAST reward's at (every pre-CB-5C doc)", () => {
  const rows = [{ at: 3, kind: "flat" as const, value: 50, item: "" }, { at: 8, kind: "flat" as const, value: 99, item: "" }];
  assert.equal(ladderOf(rows).cycleLength, 8);
  assert.equal(ladderOf(rows, undefined).cycleLength, 8);
  assert.equal(ladderOf(rows, null).cycleLength, 8);
});

test("ladderOf: a cardSize BELOW the last reward is ignored — that reward must stay reachable", () => {
  // A stale or hand-edited size must never be able to strand a reward above
  // the end of the card: the stored rows win.
  const rows = [{ at: 10, kind: "flat" as const, value: 50, item: "" }];
  assert.equal(ladderOf(rows, 4).cycleLength, 10, "a size under the last reward must not shrink the cycle");
  assert.equal(ladderOf(rows, 10).cycleLength, 10, "a size EQUAL to the last reward is fine");
  assert.equal(ladderOf(rows, 12).cycleLength, 12, "a size above it is what actually overrides");
});

test("ladderOf: a junk cardSize falls back to the derived cycle rather than producing NaN", () => {
  const rows = [{ at: 6, kind: "flat" as const, value: 50, item: "" }];
  for (const junk of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
    assert.equal(ladderOf(rows, junk).cycleLength, 6, `cardSize ${junk} must fall back, never divide the progress math by it`);
  }
});

test("ladderOf: an empty ladder still has no cycle, cardSize or not", () => {
  assert.equal(ladderOf([]).cycleLength, 0);
  assert.equal(ladderOf([], 8).cycleLength, 0, "boxes with no rewards on them are not a cycle to divide by");
});

// ── the migration-free upgrade: an existing cafe's card must not resize ─────

test("loyaltyRulesFormDefaults: a stored pre-CB-5C ladder DERIVES its cardSize from the rows, never a constant", () => {
  // The silent-resize hazard: defaulting to 8 would change the cycle every
  // existing diner is mid-way through the first time settings are saved.
  const defaults = loyaltyRulesFormDefaults({
    loyaltyRules: {
      v: 1,
      unitLabel: "stamps",
      milestones: [
        { at: 4, kind: "flat", value: 25, item: "" },
        { at: 10, kind: "flat", value: 99, item: "" },
      ],
    },
  } as unknown as Parameters<typeof loyaltyRulesFormDefaults>[0]);

  assert.equal(defaults.cardSize, 10, "the card must keep the cycle the ladder already had");
  assert.notEqual(defaults.cardSize, LOYALTY_CARD_SIZE_DEFAULT, "it must be DERIVED, not the constant");
});

test("loyaltyRulesFormDefaults: a stored ladder with NO rows falls back to the default size", () => {
  const defaults = loyaltyRulesFormDefaults({
    loyaltyRules: {
      v: 1,
      unitLabel: "stamps",
      milestones: [],
    },
  } as unknown as Parameters<typeof loyaltyRulesFormDefaults>[0]);
  assert.equal(defaults.cardSize, LOYALTY_CARD_SIZE_DEFAULT, "there is no cycle to preserve, so the default applies");
});

test("loyaltyRulesFormDefaults: a stored cardSize is carried through untouched", () => {
  const defaults = loyaltyRulesFormDefaults({
    loyaltyRules: {
      v: 1,
      unitLabel: "stamps",
      milestones: [{ at: 3, kind: "flat", value: 25, item: "" }],
      cardSize: 12,
    },
  } as unknown as Parameters<typeof loyaltyRulesFormDefaults>[0]);
  assert.equal(defaults.cardSize, 12);
});

test("loyaltyRulesFormDefaults: a brand-new cafe's card is never smaller than its seeded reward", () => {
  // The seeded reward sits at loyaltyStampsPerReward; a card shorter than that
  // would put the only reward off the end of the card.
  const defaults = loyaltyRulesFormDefaults({ loyaltyStampsPerReward: 12 } as unknown as Parameters<typeof loyaltyRulesFormDefaults>[0]);
  assert.ok(
    defaults.cardSize !== undefined && defaults.cardSize >= 12,
    `a new card must cover its own seeded reward, got ${String(defaults.cardSize)}`,
  );
});

// ── the surface ────────────────────────────────────────────────────────────

test("SOURCE PIN: the grid draws one box per stamp and opens a per-box editor", () => {
  const src = stripComments(readSrc(GRID_PATH));
  assert.match(src, /useFieldArray\(\{[\s\S]{0,80}name:\s*"loyaltyRules\.milestones"/, "landmark: the grid owns the milestones array");
  assert.match(src, /Array\.from\(\{ length: boxes \}/, "it must draw one box per stamp on the card");
  // SheetContent, not <Sheet>: the outer wrapper survives swapping the actual
  // panel for a plain div, so a needle on it proved nothing (measured escape).
  assert.match(src, /<SheetContent\b/, "tapping a box must open a side PANEL, not an inline row");
  assert.match(src, /open=\{openAt !== null\}/, "the panel must be driven by which box was tapped");
  assert.match(src, /MilestoneRewardFields/, "the panel must reuse the shared reward controls, never a second copy");
});

test("SOURCE PIN: the grid never draws fewer boxes than the ladder already uses", () => {
  // A reward above the card's size would otherwise be invisible AND unreachable.
  const src = stripComments(readSrc(GRID_PATH));
  assert.match(src, /Math\.max\(size, highestAt\)/, "boxes must cover the highest reward even if cardSize is smaller");
});

test("SOURCE PIN: the loyalty page renders the stamp card, is WIDE, and no longer offers templates", () => {
  const src = stripComments(readSrc(PAGE_PATH));
  assert.match(src, /LoyaltyStampGrid/, "landmark: the page must render the stamp card");
  assert.match(src, /slug="loyalty" wide/, "the grid needs the wide shell — at max-w-3xl the boxes wrapped early");
  assert.ok(!/LoyaltyTemplateCard/.test(src), "the template picker was removed from this page (owner, 2026-09-14)");
});
