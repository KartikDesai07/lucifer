import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CB-6D-B — Orders-side source pins for the Orders + Rewards premium
// rebuild (.claude/plan/v2/cb6d-b-orders-rewards-plan.md, "PINS (slice C)"),
// SPLIT OUT of lib/public-orders-rewards-premium-pins.test.ts (which stayed
// at 292 lines pre-review) to keep both files under the 300-line budget once
// the CB-6D-B review fixes (.claude/plan/v2/cb6d-b-review-fixes.md) added
// their own pins. Every assertion below was moved byte-for-byte from that
// file; the Rewards-side pins and the shared touch-floor/account/shell pins
// stayed there. Same readSrc/mustInclude technique as
// lib/public-home-premium-pins.test.ts and lib/public-diner-panel-pins.test.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

function mustInclude(haystack: string, needle: string, what: string): void {
  assert.ok(haystack.includes(needle), `expected to find ${what}`);
}

const ORDERS_TAB = "apps/cafe/components/public/PublicMyOrdersTab.tsx";
const ORDER_BILL_VIEW = "apps/cafe/components/public/PublicOrderBillView.tsx";
const ORDER_ROW = "apps/cafe/components/public/PublicOrderRow.tsx";
const STATUS_TIMELINE = "apps/cafe/components/public/PublicStatusTimeline.tsx";
const USE_MY_ORDERS = "apps/cafe/components/public/use-my-orders.ts";
const REWARDS_TAB = "apps/cafe/components/public/PublicRewardsTab.tsx";
const STAMP_CARD = "apps/cafe/components/public/PublicStampCard.tsx";
const STAMP_TRACK = "apps/cafe/components/public/PublicStampTrack.tsx";
const REWARD_LADDER = "apps/cafe/components/public/PublicRewardLadder.tsx";
const REWARD_CODES = "apps/cafe/components/public/PublicRewardCodes.tsx";

// Every file this slice's touch-floor walk scans — the A/B rewrite/new files
// named in the contract, not every /m component (PublicActiveOrderCard is
// reused unchanged from CB-6D-A and is out of THIS slice's scope). MOVED here
// byte-for-byte from lib/public-orders-rewards-premium-pins.test.ts (review
// fixes made that file's own pin budget too tight to keep it there).
const TOUCH_FLOOR_FILES = [
  ORDERS_TAB,
  ORDER_ROW,
  ORDER_BILL_VIEW,
  STATUS_TIMELINE,
  REWARDS_TAB,
  STAMP_CARD,
  STAMP_TRACK,
  REWARD_LADDER,
  REWARD_CODES,
];

test("PIN: PublicMyOrdersTab.tsx renders the Live now section via splitLiveOrders/pickActiveOrders/PublicActiveOrderCard, titles itself \"Your orders\" on PUB_HOME_STACK_CLASS, and no longer imports EmptyState", () => {
  const src = stripComments(readSrc(ORDERS_TAB));
  mustInclude(src, "export function PublicMyOrdersTab", "PublicMyOrdersTab.tsx still exporting its component (positive landmark)");
  mustInclude(src, "Live now", "the Live now section heading");
  mustInclude(src, "<PublicActiveOrderCard", "rendering the live-order card component");
  mustInclude(src, "splitLiveOrders(", "calling splitLiveOrders to separate live orders from the day-grouped rest");
  mustInclude(src, "pickActiveOrders(", "calling pickActiveOrders to shape the live cards");
  mustInclude(src, "Your orders", "the tab's own screen title");
  mustInclude(src, "PUB_HOME_STACK_CLASS", "the Home-vocabulary outer stack class");
  // Mutation caught: EmptyState creeping back into the empty-orders branch
  // instead of the tonal-card guided empty state the contract specifies.
  assert.ok(!src.includes("EmptyState"), "must no longer import/render the dashed admin EmptyState — replaced by the tonal-card guided empty state");
});

test("PIN: PublicOrderBillView.tsx renders the ONE primary action per status (Track this order / Order this again), the rejected-reason branch, the bill section, and calls publicOrderStatusPath( EXACTLY once, never \"Open live status\"", () => {
  const src = stripComments(readSrc(ORDER_BILL_VIEW));
  mustInclude(src, "export function PublicOrderBillView", "PublicOrderBillView.tsx still exporting its component (positive landmark)");
  mustInclude(src, "Track this order", "the active-order primary action");
  mustInclude(src, "Order this again", "the settled-order primary action");
  mustInclude(src, "isActiveOrderStatus(", "deriving `active` via the single-homed isActiveOrderStatus helper");
  mustInclude(src, "DINER_CANCELLED_REASON", "importing the shared diner-cancelled sentinel for the rejected branch");
  mustInclude(src, "You cancelled this order", "the diner-initiated rejection copy");
  mustInclude(src, "Your bill", "the bill section heading");
  mustInclude(src, "PUB_TONAL_CARD_CLASS", "using the shared tonal card surface for status/bill/note sections");

  // Count assertion: publicOrderStatusPath( must appear EXACTLY once — the
  // receipt IS the settled order's page; a second link would duplicate the
  // one primary action the contract calls for. Mutation caught: a second
  // "Open live status" link (or any second call site) creeping back in.
  const NEEDLE = "publicOrderStatusPath" + "(";
  const occurrences = src.split(NEEDLE).length - 1;
  assert.equal(occurrences, 1, `publicOrderStatusPath( must appear EXACTLY once in PublicOrderBillView.tsx, found ${occurrences}`);

  assert.ok(!src.includes("Open live status"), 'must not render the old "Open live status" text link — the receipt is the settled order\'s own page now');
});

// F5 (CB-6D-B review fix) — the receipt timestamp used a bare toLocaleString()
// ("22/9/2026, 2:32:05 am": seconds + a slash date). Fix: a named
// ORDER_DATE_TIME_FORMAT Intl.DateTimeFormatOptions consumed by
// toLocaleString([], ORDER_DATE_TIME_FORMAT). RED now: the current file still
// calls the bare toLocaleString() with no format object.
test("PIN (F5): PublicOrderBillView.tsx names ORDER_DATE_TIME_FORMAT and never calls the bare toLocaleString()", () => {
  const src = stripComments(readSrc(ORDER_BILL_VIEW));
  mustInclude(src, "ORDER_DATE_TIME_FORMAT", "a named Intl.DateTimeFormatOptions constant for the receipt timestamp (no seconds, no slash date)");
  assert.ok(!src.includes("toLocaleString()"), "must not call the bare toLocaleString() — it prints seconds and a slash-style date");
});

test("PIN: PublicOrderRow.tsx renders itemNamesPreview(, <PublicStatusChip and publicOrderStatusPath(", () => {
  const src = stripComments(readSrc(ORDER_ROW));
  mustInclude(src, "export function PublicOrderRow", "PublicOrderRow.tsx still exporting its component (positive landmark)");
  mustInclude(src, "itemNamesPreview(", "using itemNamesPreview for the resolved row's item-line preview");
  mustInclude(src, "<PublicStatusChip", "rendering the single-homed status chip, never colour alone");
  mustInclude(src, "publicOrderStatusPath(", "the unresolved row's Link target");
});

// F3 (CB-6D-B review fix) — order-row line 2 packed time + "Order #CODE" +
// the status chip into one flex line with no nowrap/shrink guard, wrapping
// the "Waiting for the counter" pill into a blob at 320-360px. Fix (exact
// markup, per the spec): the time/code span becomes its own block line
// ("mt-0.5 block text-sm text-muted-foreground"), and the chip gets its own
// line with a whitespace-nowrap className. Mutation caught: the old
// single-flex-line className ("mt-0.5 flex items-center gap-2
// text-sm text-muted-foreground") creeping back in instead of the split.
test("PIN (F3): PublicOrderRow.tsx splits line 2 into its own time/code block and a nowrap-guarded status chip line", () => {
  const src = stripComments(readSrc(ORDER_ROW));
  mustInclude(src, "mt-0.5 block text-sm text-muted-foreground", "the time/code line as its own block (never sharing a flex row with the chip)");
  mustInclude(src, 'className="whitespace-nowrap"', "the status chip guarded against wrapping mid-word at narrow widths");
  assert.ok(
    !src.includes("mt-0.5 flex items-center gap-2 text-sm text-muted-foreground"),
    "must not keep the old single-flex-line className that packed time + code + chip together with no wrap guard",
  );
});

test("PIN: PublicStatusTimeline.tsx accepts an optional className and composes it with cn(\"rounded-lg border p-4\", className); the three step labels are unchanged", () => {
  const src = stripComments(readSrc(STATUS_TIMELINE));
  mustInclude(src, "export function PublicStatusTimeline", "PublicStatusTimeline.tsx still exporting its component (positive landmark)");
  mustInclude(src, "className?: string", "the ONE contract change: an optional className prop");
  mustInclude(src, 'cn("rounded-lg border p-4", className)', "composing the caller's className into the wrapper via cn, default render unchanged");
  mustInclude(src, '"Order sent"', "step label 1 unchanged");
  mustInclude(src, '"Cafe is confirming…"', "step label 2 unchanged");
  mustInclude(src, '"Being prepared"', "step label 3 unchanged");
});

// F8 (CB-6D-B review fix) — the first painted frame seeded every order row
// { code, data: null } before any fetch settled, and the tab's only skeleton
// gate was `orders === null`, so every order (even a diner's ONLY order)
// briefly rendered as an unresolved Link under "More orders". Fix: PastOrder
// gains an optional `pending` flag; use-my-orders.ts seeds it true and clears
// it in a .finally() on every fetch outcome (success, non-ok, bad envelope,
// network reject); PublicMyOrdersTab.tsx skeletons while orders is null OR
// every row is still pending, AND groups only the settled rows via the new
// partitionPending helper, rendering `pendingCount` trailing skeleton rows.
test("PIN (F8): use-my-orders.ts seeds rows pending: true and clears it in a .finally( on every fetch outcome", () => {
  const src = stripComments(readSrc(USE_MY_ORDERS));
  mustInclude(src, "export function useMyOrders", "use-my-orders.ts still exporting its hook (positive landmark)");
  mustInclude(src, "pending: true", "seeding every row pending before any fetch settles");
  mustInclude(src, ".finally(", "clearing pending in a .finally( so success, non-ok, bad envelope AND network reject all clear it");
});

test("PIN (F8): PublicMyOrdersTab.tsx skeletons while orders === null OR every row is still pending (length > 0 guarded), and groups via partitionPending(", () => {
  const src = stripComments(readSrc(ORDERS_TAB));
  mustInclude(src, "partitionPending(", "deriving the settled/pending split via the single-homed partitionPending helper");
  // The length > 0 guard is MANDATORY per the spec: `[].every(...)` is
  // vacuously true, so without this guard a diner with NO orders at all
  // would skeleton forever instead of reaching the guided empty state.
  mustInclude(src, "orders.length > 0 && orders.every(", "the mandatory length > 0 guard — [].every() is vacuously true and must not skeleton a diner with zero orders forever");
  mustInclude(src, "orders === null ||", "the existing null-loading gate widened rather than replaced");
});

// Positive landmark for the Rewards-side split: proves this file's sibling
// (lib/public-orders-rewards-premium-pins.test.ts) still owns the Rewards
// pins rather than both files silently losing the same coverage — read here
// rather than there so a future edit to either file's scope comment can't
// silently drop the cross-reference.
test("PIN: PublicRewardsTab.tsx is still exported (sanity landmark for the Rewards-side split file)", () => {
  const src = stripComments(readSrc(REWARDS_TAB));
  mustInclude(src, "export function PublicRewardsTab", "PublicRewardsTab.tsx still exporting its component");
});

// ── touch floor — MOVED byte-for-byte from public-orders-rewards-premium-pins.test.ts ──

// Extracts every "<button" / "<Button" OPENING tag, scanning forward to the
// tag's OWN closing `>` while tracking {..} brace depth — a bare regex
// stopping at the first literal `>` would mis-close on a JSX expression
// containing one (an arrow function's `=>`, a comparison), as `<button
// onClick={() => ...}>` demonstrates. Multi-line by construction (scans the
// raw string, not per-line).
function extractOpeningTags(src: string): string[] {
  const tags: string[] = [];
  const OPEN_RE = /<(button|Button)\b/g;
  let m: RegExpExecArray | null;
  while ((m = OPEN_RE.exec(src)) !== null) {
    const start = m.index;
    let depth = 0;
    let end = -1;
    for (let i = start; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) break;
    tags.push(src.slice(start, end + 1));
    OPEN_RE.lastIndex = end + 1;
  }
  return tags;
}

const TOUCH_FLOOR_TOKENS = ["h-11", "min-h-11", "PUBLIC_TOUCH_TARGET_CLASS", "PUB_ROW_BUTTON_CLASS", "PUB_PILL_BUTTON_CLASS"];

test("PIN: every <button/<Button opening tag in the Orders + Rewards A/B files carries a 44px touch-floor class", () => {
  let totalTagsSeen = 0;
  for (const rel of TOUCH_FLOOR_FILES) {
    const src = stripComments(readSrc(rel));
    const tags = extractOpeningTags(src);
    for (const tag of tags) {
      totalTagsSeen++;
      const flooredCorrectly = TOUCH_FLOOR_TOKENS.some((token) => tag.includes(token));
      assert.ok(
        flooredCorrectly,
        `${rel}: a <button/<Button tag is missing a touch-floor class (h-11 / min-h-11 / PUBLIC_TOUCH_TARGET_CLASS / PUB_ROW_BUTTON_CLASS / PUB_PILL_BUTTON_CLASS) — tag: ${tag.replace(/\s+/g, " ").slice(0, 120)}`,
      );
    }
  }
  // Positive landmark for the walk itself: prove the extraction actually
  // found real tags to check, so the loop above isn't vacuously passing
  // against files that render no buttons at all (mutation caught: the
  // extractOpeningTags regex breaking silently and finding 0 tags everywhere).
  assert.ok(totalTagsSeen >= 5, `expected to find several <button/<Button tags across the A/B files, found ${totalTagsSeen}`);
});
