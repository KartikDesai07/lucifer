import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CB-6C S9 — diner panel (/m) overhaul: the surface-wide source pins that
// scan across components/public/** + app/m/** rather than a single file.
// Shell-scoped reachability/gating pins for the SAME slice live alongside the
// existing S12 reachability pins in lib/public-shell-layout.test.ts; this file
// holds the ones whose scope is the whole /m surface: the orders fan-out
// consolidation, the owner-banner prop chain, the dir-wide no-emoji walk, the
// component file-size budget, the single-homed STATUS_CHIP_META map, and its
// colour-alone guard.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Existence-asserting index lookup — a bare .includes()/match() check without
// this wrapper's message would still fail loud, but this keeps every
// assertion below phrased the same way as the sibling *-paths.test.ts files.
function mustInclude(haystack: string, needle: string, what: string): void {
  assert.ok(haystack.includes(needle), `expected to find ${what}`);
}

const SHELL = "apps/cafe/components/public/PublicDinerShell.tsx";
const USE_MY_ORDERS = "apps/cafe/components/public/use-my-orders.ts";
const ORDERS_TAB = "apps/cafe/components/public/PublicMyOrdersTab.tsx";
const HOME_TAB = "apps/cafe/components/public/PublicHomeTab.tsx";
const ORDER_ROW = "apps/cafe/components/public/PublicOrderRow.tsx";
const ORDER_BILL_VIEW = "apps/cafe/components/public/PublicOrderBillView.tsx";
const HOME_HERO = "apps/cafe/components/public/PublicHomeHero.tsx";
const DINER_BANNERS = "apps/cafe/components/public/PublicDinerBanners.tsx";
const ACTIVE_ORDER_CARD = "apps/cafe/components/public/PublicActiveOrderCard.tsx";
const LOYALTY_GLANCE = "apps/cafe/components/public/PublicLoyaltyGlance.tsx";
const POPULAR_ROW = "apps/cafe/components/public/PublicPopularRow.tsx";
const STATUS_CHIP = "apps/cafe/components/public/PublicStatusChip.tsx";
const M_PAGE = "apps/cafe/app/m/page.tsx";
const M_TOKEN_PAGE = "apps/cafe/app/m/[token]/page.tsx";
const DINER_CONFIG = "apps/cafe/lib/public-diner-config.ts";
const REWARDS_TAB = "apps/cafe/components/public/PublicRewardsTab.tsx";
const STAMP_CARD = "apps/cafe/components/public/PublicStampCard.tsx";
const STAMP_TRACK = "apps/cafe/components/public/PublicStampTrack.tsx";
const REWARD_LADDER = "apps/cafe/components/public/PublicRewardLadder.tsx";
const REWARD_CODES = "apps/cafe/components/public/PublicRewardCodes.tsx";
const REWARDS_HOW_IT_WORKS = "apps/cafe/components/public/PublicRewardsHowItWorks.tsx";

// ── (a) the orders fan-out lives in ONE file ────────────────────────────────

test("PIN: the orders fan-out lives in ONE file — use-my-orders.ts contains fetch( and MY_ORDERS_MAX_SHOWN — while PublicMyOrdersTab.tsx, PublicHomeTab.tsx, PublicOrderRow.tsx and PublicOrderBillView.tsx contain no fetch(", () => {
  const hookSrc = stripComments(readSrc(USE_MY_ORDERS));
  // Positive landmark first: the hook actually owns the fan-out (a gutted
  // hook file would make the "no fetch elsewhere" checks below meaningless —
  // the fetch would just be MISSING everywhere, not consolidated). Word-
  // boundary matched: a plain .includes("MY_ORDERS_MAX_SHOWN") would still
  // pass against a renamed MY_ORDERS_MAX_SHOWN_FOO (mutation-tested — see
  // the session record), since the original name is a prefix of the rename.
  assert.match(hookSrc, /\bMY_ORDERS_MAX_SHOWN\b/, "expected to find use-my-orders.ts declaring MY_ORDERS_MAX_SHOWN");
  mustInclude(hookSrc, "fetch(", "use-my-orders.ts owning the fetch( call");

  const FETCH_NEEDLE = "fetch" + "(";
  for (const rel of [ORDERS_TAB, HOME_TAB, ORDER_ROW, ORDER_BILL_VIEW]) {
    const src = stripComments(readSrc(rel));
    // Positive landmark per file — proves each is still the real component,
    // not an emptied stub that would make the negative check vacuous.
    mustInclude(src, "export function Public", `${rel} still exporting its component`);
    assert.ok(!src.includes(FETCH_NEEDLE), `${rel} must not call fetch( — the fan-out is owned solely by use-my-orders.ts`);
  }
});

test("PIN: every new S3 Home sub-component (PublicHomeHero, PublicDinerBanners, PublicActiveOrderCard, PublicLoyaltyGlance, PublicPopularRow) contains no fetch( either", () => {
  const FETCH_NEEDLE = "fetch" + "(";
  for (const rel of [HOME_HERO, DINER_BANNERS, ACTIVE_ORDER_CARD, LOYALTY_GLANCE, POPULAR_ROW]) {
    const src = stripComments(readSrc(rel));
    mustInclude(src, "export function Public", `${rel} still exporting its component`);
    assert.ok(!src.includes(FETCH_NEEDLE), `${rel} must not call fetch( — Home renders from props only`);
  }
});

// F7b (CB-6D-B review fix, MEDIUM) — no no-fetch pin covered the Rewards
// files (only Home's sub-components were scanned above). Mirrors that pin
// exactly for the Rewards tab's own six files.
test("PIN (F7b): every Rewards-tab file (PublicRewardsTab, PublicStampCard, PublicStampTrack, PublicRewardLadder, PublicRewardCodes, PublicRewardsHowItWorks) contains no fetch( either", () => {
  const FETCH_NEEDLE = "fetch" + "(";
  for (const rel of [REWARDS_TAB, STAMP_CARD, STAMP_TRACK, REWARD_LADDER, REWARD_CODES, REWARDS_HOW_IT_WORKS]) {
    const src = stripComments(readSrc(rel));
    mustInclude(src, "export function Public", `${rel} still exporting its component`);
    assert.ok(!src.includes(FETCH_NEEDLE), `${rel} must not call fetch( — the Rewards tab renders from props only`);
  }
});

// ── (b) banner chain (A1-style) ─────────────────────────────────────────────

test("PIN (banner chain): both /m pages pass banners={diner.banners}; the shell declares banners: readonly PublicDinerBanner[] and forwards banners={banners} into PublicHomeTab; public-diner-config.ts calls publicDinerBanners(settings?.dinerBanners) and DINER_FEATURES_OFF carries banners: []", () => {
  const pageSrc = stripComments(readSrc(M_PAGE));
  mustInclude(pageSrc, "<PublicDinerShell", "app/m/page.tsx rendering PublicDinerShell (positive landmark)");
  mustInclude(pageSrc, "banners={diner.banners}", "app/m/page.tsx passing banners={diner.banners}");

  const tokenPageSrc = stripComments(readSrc(M_TOKEN_PAGE));
  mustInclude(tokenPageSrc, "<PublicDinerShell", "app/m/[token]/page.tsx rendering PublicDinerShell (positive landmark)");
  mustInclude(tokenPageSrc, "banners={diner.banners}", "app/m/[token]/page.tsx passing banners={diner.banners}");

  const shellSrc = stripComments(readSrc(SHELL));
  mustInclude(shellSrc, "banners: readonly PublicDinerBanner[]", "the shell declaring a typed banners prop");
  mustInclude(shellSrc, "banners={banners}", "the shell forwarding banners={banners} into PublicHomeTab");
  mustInclude(shellSrc, "<PublicHomeTab", "the shell rendering PublicHomeTab (positive landmark)");

  const configSrc = stripComments(readSrc(DINER_CONFIG));
  mustInclude(
    configSrc,
    "publicDinerBanners(settings?.dinerBanners)",
    "public-diner-config.ts calling publicDinerBanners(settings?.dinerBanners)",
  );
  mustInclude(configSrc, "banners: []", "DINER_FEATURES_OFF carrying banners: []");
});

// ── (c)/(d) dir-wide walk: NO-EMOJI + file budget ───────────────────────────
// Same directory-walker convention as lib/appearance-paths-2.test.ts and
// lib/category-readers-pins.test.ts, so a file added later is scanned
// automatically rather than by a hardcoded list.

const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE_PATTERN = /\.test\.ts$/;

function walkCodeFiles(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) walkCodeFiles(abs, out);
    else if (CODE_FILE_PATTERN.test(entry) && !TEST_FILE_PATTERN.test(entry)) out.push(abs);
  }
}

// Astral-range emoji plus the common BMP pictograph/symbol blocks — same
// pattern lib/public-home-tab.test.ts already pins PublicHomeTab.tsx with.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test("PIN: dir-wide NO-EMOJI walk over components/public/** and app/m/** (code files, comment-stripped) — Lucide icons only", () => {
  const dirs = ["apps/cafe/components/public", "apps/cafe/app/m"];
  const files: string[] = [];
  for (const dir of dirs) walkCodeFiles(path.join(REPO_ROOT, dir), files);
  assert.ok(files.length >= 40, `expected to scan at least 40 files, found ${files.length} — the walk must not be silently narrowed`);

  // Positive landmark: PublicHomeTab.tsx must still import from lucide-react
  // — proves the scan is reading real, non-gutted source.
  const homeSrc = stripComments(readSrc(HOME_TAB));
  mustInclude(homeSrc, "lucide-react", "PublicHomeTab.tsx importing from lucide-react (positive landmark)");

  for (const fileAbs of files) {
    const src = stripComments(readFileSync(fileAbs, "utf8"));
    assert.ok(
      !EMOJI_PATTERN.test(src),
      `${path.relative(REPO_ROOT, fileAbs)} must contain no emoji — Lucide icons only under the /m surface`,
    );
  }
});

test("PIN: file budget — every code file under components/public/** is <= 300 lines, except the recorded allow-list (public-cart-store.ts, pre-existing 351 lines)", () => {
  const ALLOW_LIST = new Set(["apps/cafe/components/public/public-cart-store.ts"]);
  const files: string[] = [];
  walkCodeFiles(path.join(REPO_ROOT, "apps/cafe/components/public"), files);
  assert.ok(files.length >= 40, `expected to scan at least 40 files, found ${files.length}`);

  // Vision guard: the allow-listed file must still exist, or this pin would
  // silently stop checking anything without failing loud.
  for (const rel of ALLOW_LIST) {
    assert.ok(existsSync(path.join(REPO_ROOT, rel)), `allow-listed file ${rel} must still exist`);
  }

  let overBudget = 0;
  for (const fileAbs of files) {
    const rel = path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
    const lineCount = readFileSync(fileAbs, "utf8").split("\n").length;
    if (ALLOW_LIST.has(rel)) continue;
    if (lineCount > 300) overBudget += 1;
    assert.ok(
      lineCount <= 300,
      `${rel} is ${lineCount} lines — components/public/** files must stay <= 300 lines (split before you exceed)`,
    );
  }
  assert.equal(overBudget, 0, "no file outside the allow-list may exceed the 300-line budget");
});

// ── (e) STATUS_CHIP_META single-home + (f is in public-shell-layout.test.ts) ─

test("PIN: STATUS_CHIP_META is the single home for status->word mapping — no OTHER file under components/public declares a Record<PublicOrderStatus,...>-shaped map, a Record<..[\"status\"], string>, or a STATUS_WORDS/LAST_ORDER_STATUS_WORDS constant", () => {
  const chipSrc = stripComments(readSrc(STATUS_CHIP));
  mustInclude(
    chipSrc,
    "export const STATUS_CHIP_META: Record<PublicOrderStatus,",
    "PublicStatusChip.tsx declaring the single-homed STATUS_CHIP_META",
  );

  // Positive landmark: the consumers actually import from PublicStatusChip,
  // proving this isn't just an unread definition sitting next to dead copies.
  // PublicMyOrdersTab.tsx renders the chip only INDIRECTLY, through
  // PublicOrderRow/PublicOrderBillView — it never imports PublicStatusChip
  // itself, so it is deliberately not in this list.
  const consumers = [ORDER_ROW, ORDER_BILL_VIEW, ACTIVE_ORDER_CARD];
  for (const rel of consumers) {
    const src = stripComments(readSrc(rel));
    assert.match(
      src,
      /from\s+"@\/components\/public\/PublicStatusChip"/,
      `${rel} must import from PublicStatusChip rather than re-declaring status word/colour mapping`,
    );
  }

  // Needles built by concatenation (testing.md rule): a literal Record<...>
  // shape or STATUS_WORDS spelling here could otherwise trip a sibling
  // banned-string scan, or make this file's own declaration above collide
  // with the negative check below.
  const RECORD_STATUS_NEEDLE = "Record" + "<PublicOrderStatus,";
  const RECORD_STATUS_FIELD_NEEDLE = "Record<PublicOrderRequestStatusData[" + '"status"' + "], string>";
  const STATUS_WORDS_NEEDLE = "STATUS" + "_WORDS";
  const LAST_ORDER_STATUS_WORDS_NEEDLE = "LAST_ORDER_STATUS" + "_WORDS";

  const files: string[] = [];
  walkCodeFiles(path.join(REPO_ROOT, "apps/cafe/components/public"), files);
  assert.ok(files.length >= 40, `expected to scan at least 40 files, found ${files.length}`);

  for (const fileAbs of files) {
    const rel = path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
    if (rel === STATUS_CHIP) continue;
    const src = stripComments(readFileSync(fileAbs, "utf8"));
    assert.ok(!src.includes(RECORD_STATUS_NEEDLE), `${rel} must not declare its own Record<PublicOrderStatus, ...> map`);
    assert.ok(
      !src.includes(RECORD_STATUS_FIELD_NEEDLE),
      `${rel} must not declare its own Record<PublicOrderRequestStatusData["status"], string> map`,
    );
    assert.ok(!src.includes(STATUS_WORDS_NEEDLE), `${rel} must not declare a STATUS_WORDS constant — use statusWord() from PublicStatusChip`);
    assert.ok(!src.includes(LAST_ORDER_STATUS_WORDS_NEEDLE), `${rel} must not declare a LAST_ORDER_STATUS_WORDS constant`);
  }
});

// ── (h) colour-alone guard for the status chip ──────────────────────────────

test("PIN: colour-alone guard — every STATUS_CHIP_META entry has a non-empty word and a defined Icon", async () => {
  const { STATUS_CHIP_META } = await import("../components/public/PublicStatusChip");
  const entries = Object.entries(STATUS_CHIP_META as Record<string, { word: string; Icon: unknown }>);
  assert.ok(entries.length > 0, "STATUS_CHIP_META must not be empty");
  for (const [status, meta] of entries) {
    assert.ok(meta.word.length > 0, `STATUS_CHIP_META["${status}"].word must be non-empty`);
    assert.ok(meta.Icon, `STATUS_CHIP_META["${status}"].Icon must be defined`);
  }
});

// F2 (CB-6D-B review fix, MEDIUM) — PublicStatusChip.tsx gave "accepting" the
// word "Being prepared" (ChefHat, solid primary) while packages/shared's
// public.ts and PublicStatusTimeline render "accepting" IDENTICALLY to
// "pending" — on the new receipt the chip and the timeline said opposite
// things 60px apart. Fix: `accepting`'s entry must equal `pending`'s word/
// className/Icon exactly (a shared WAITING_META object used by both keys).
test("PIN (F2): STATUS_CHIP_META['accepting'] reads IDENTICALLY to STATUS_CHIP_META['pending'] — same word, className and Icon", async () => {
  const { STATUS_CHIP_META } = await import("../components/public/PublicStatusChip");
  const meta = STATUS_CHIP_META as Record<string, { word: string; className: string; Icon: unknown }>;
  assert.equal(meta.accepting.word, meta.pending.word, "accepting must speak the SAME word as pending — the timeline already renders them identically");
  assert.equal(meta.accepting.className, meta.pending.className, "accepting must carry the SAME chip colour class as pending");
  assert.equal(meta.accepting.Icon, meta.pending.Icon, "accepting must render the SAME icon as pending");
});

// F2 — vision guard: the fix drops the now-unused ChefHat import and keeps
// Clock (pending/accepting's shared icon). Paired with the positive landmark
// (Clock present) so a gutted import block can't pass the negative check
// vacuously.
test("PIN (F2): PublicStatusChip.tsx source no longer imports ChefHat, and still imports Clock", () => {
  const src = stripComments(readSrc(STATUS_CHIP));
  mustInclude(src, "Clock", "PublicStatusChip.tsx must still import the Clock icon shared by pending/accepting (positive landmark)");
  assert.ok(!src.includes("ChefHat"), "PublicStatusChip.tsx must no longer import/reference ChefHat — accepting now shares pending's Clock icon");
});

// CB-6D-A's new Home-premium pins (offers chain, label, design tokens, touch
// floor) live in the NEW lib/public-home-premium-pins.test.ts — this file
// was already at the 300-line budget the plan sets for new-pin placement.
