import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "@/lib/source-pin-utils";

// CB-7 S6 session 2 slice D2 — the diner's "Use my points" row, the levels-tab points line and the revealed-card detail
// sheet. Source pins read the real files (comments stripped, so a commented-out call site cannot satisfy them).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readRaw = (rel: string): string => readFileSync(path.join(REPO_ROOT, "apps/cafe", rel), "utf8");
const read = (rel: string): string => stripComments(readRaw(rel));

const STORE = "components/public/public-cart-store.ts";
const IO = "components/public/public-store-io.ts";
const SUBMIT = "components/public/public-submit.ts";
const HOOK = "components/public/use-public-cart-submit.ts";
const CART = "components/public/PublicCart.tsx";
const PICKER = "components/public/rewards/PublicPointsPicker.tsx";
const LEVELS = "components/public/rewards/PublicLevelsTab.tsx";
const WALLET = "components/public/rewards/PublicCardWallet.tsx";
const SHEET = "components/public/rewards/PublicCardDetailSheet.tsx";
const VIEW = "components/public/rewards/card-detail-view.ts";

test("picker: reads pointsBalance from the shared wallet query, no fetch, no native pickers, hides at <= 0", () => {
  const picker = read(PICKER);
  assert.match(picker, /useDinerCards\(identity\)/, "reuses the wallet query");
  assert.match(picker, /data\?\.pointsBalance/, "reads the balance off the wallet");
  assert.ok(!/apiGet|useQuery\(|fetch\(/.test(picker), "the picker adds no fetch of its own");
  assert.ok(!/<select|<input|type="date"/.test(picker), "no native pickers");
  assert.match(picker, /balance === undefined \|\| balance <= 0\) return null/, "renders nothing without points");
  assert.match(picker, /aria-pressed=\{selected\}/, "a toggle");
  assert.match(picker, /onSelect\(!selected\)/, "tap again lets the ask go");
  assert.match(picker, /min-h-11/, "44px touch target");
  assert.match(picker, /CART_POINTS_LABEL/);
  assert.match(picker, /cartPointsDetail\(balance\)/);
});

test("cart: the points row follows the card picker's rule and a points ask shows the selected row", () => {
  const cart = read(CART);
  assert.match(cart, /chargeApplies && !promoCode && requestedRewardAt === null && \(\s*<PublicCardPicker/, "landmark");
  assert.match(cart, /chargeApplies && !promoCode && requestedRewardAt === null && \(\s*<PublicPointsPicker/);
  assert.match(cart, /onSelect=\{handlePickPoints\}/);
  assert.match(cart, /requestedRewardAt !== null \|\| requestedCardId !== null \|\| requestedPoints/);
  assert.match(cart, /requestedPoints \? CART_POINTS_SELECTED/);
});

test("store + hook: the ask hydrates when the drawer opens and the pick writes the shared reward key", () => {
  const store = read(STORE);
  assert.match(store, /safeRead\(REQUESTED_REWARD_KEY, isPointsPick\) !== null/);
  assert.match(store, /safeWrite\(REQUESTED_REWARD_KEY, \{ points: true \}\)/);
  assert.equal((store.match(/"pos\.public\.reward\.v1"/g) ?? []).length, 1, "still exactly one reward key literal");
  assert.match(read(IO), /\(v as \{ points\?: unknown \}\)\.points === true/, "strictly true");
  const hook = read(HOOK);
  assert.match(hook, /setRequestedPoints\(readRequestedPoints\(\)\)/, "hydrated in the open effect");
  assert.match(hook, /if \(on\) writeRequestedPoints\(\);\s*else clearRequestedRewardAt\(\)/);
  assert.match(hook, /requestedCardId \?\? requestedRewardAt \?\? \(requestedPoints \? true : null\)/);
  const failBranch = hook.slice(hook.indexOf("if (rewardFailure !== null)"), hook.indexOf("setRewardError(rewardFailure)"));
  assert.match(failBranch, /setRequestedPoints\(false\)/, "a refused ask is dropped");
  assert.match(hook, /requestedPoints,\s*requestedRewardAt,\s*requestedCardId,\s*\}\)/, "the body builder receives it");
  assert.match(read(SUBMIT), /requestedPoints === true && !cardPicked && requestedRewardAt === null/);
});

test("levels tab: the points line shows only when there is no hero (!view.progress) and a balance", () => {
  const levels = read(LEVELS);
  assert.match(levels, /!view\.progress && view\.pointsBalance > 0/);
  assert.match(levels, /\{view\.progress && <PublicLevelHero progress=\{view\.progress\} pointsBalance/, "landmark: the hero");
  assert.match(levels, /POINTS_RULE/);
  // Smoke s93 finding: with Reward Levels switched OFF the tab takes the !levelsChosen branch (stamps + wallet), and a
  // diner holding points must still see their balance there (plan FLAG 6, §2.11 predicate 3). ONE line, both branches.
  assert.equal(levels.split("!view.progress && view.pointsBalance > 0").length - 1, 1, "the line is built once");
  const offBranch = levels.slice(levels.indexOf("if (!levelsChosen) {"), levels.indexOf("if (loading) {"));
  assert.match(offBranch, /<PublicCardWallet cards=\{cards\}/, "landmark: the levels-OFF branch's wallet");
  assert.match(offBranch, /\{pointsLine\}/, "the levels-OFF branch shows the points line");
  const onBranch = levels.slice(levels.indexOf("if (loading) {"));
  assert.match(onBranch, /\{!view\.earning && <p className="text-sm text-muted-foreground">\{SCRATCH_PAUSED\}<\/p>\}\s*\{pointsLine\}/, "and the levels-ON branch, right after the paused line");
});

test("wallet: a revealed tile is a button that opens the card detail sheet; ready tiles still scratch", () => {
  const wallet = read(WALLET);
  assert.match(wallet, /<PublicCardDetailSheet/);
  assert.match(wallet, /See card details/);
  const tile = wallet.slice(wallet.indexOf("function RevealedTile"), wallet.indexOf("function PastTile"));
  assert.match(tile, /<button\s+type="button"/);
  assert.match(tile, /PUB_PRESS_CLASS/);
  assert.match(wallet, /onScratch=\{/, "landmark: the scratch flow is still wired");
  const sheet = read(SHEET);
  assert.match(sheet, /cardDetailView\(card, Date\.now\(\)\)/);
  assert.match(sheet, /\[&>button\]:size-11/, "close X is a 44px target");
  assert.ok(!/apiGet|useQuery\(|fetch\(/.test(sheet), "the sheet never fetches");
  assert.ok(!/<select|<input|type="date"/.test(sheet), "no native pickers");
  assert.match(read(VIEW), /deadlineLine\("use"/);
});

test("file budget: every touched file stays within 300 lines", () => {
  for (const rel of [IO, STORE, SUBMIT, HOOK, CART, PICKER, LEVELS, WALLET, SHEET, VIEW]) {
    const lines = readRaw(rel).split("\n").length;
    assert.ok(lines <= 300, `${rel} is ${lines} lines`);
  }
});
