import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";
import { findMilestoneAt, rewardSnapshotFields } from "./reward-claim";
import type { ISettings } from "@/models/Settings";
import type { LoyaltyMilestoneInput, LoyaltyRulesInput } from "@pos/shared/schemas/settings-loyalty.schema";
import { LOYALTY_RULES_SCHEMA_VERSION } from "@pos/shared/loyalty-rules";
import type { RedeemedReward } from "@pos/shared/reward-redemption";

// CB-5B S4/S5 — pins for the reward-claim WIRING across the four staff money
// writers (create, add-round, settle, void). These are source pins (readSrc +
// stripComments, same discipline as gst-discount.test.ts) for the ordering/
// CAS/fence shapes, plus DB-free behavioural unit tests for the two PURE
// pieces of lib/reward-claim.ts. No source edits — pins only.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, "..", rel), "utf8");

// Same idiom as chunk-reload.test.ts / diner-paths.test.ts / etc: throws
// loudly rather than letting indexOf's -1 pass an ordering comparison
// vacuously (a documented trap in this repo).
function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx !== -1, `expected to find ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
}

// ── 1: CLAIM-BEFORE-WRITE (create) ───────────────────────────────────────────

test("PIN: app/api/orders/route.ts claims reward stamps BEFORE Order.create — the CALL SITE (claimFor(orderId)), not merely the closure definition or the import, appears first", () => {
  const src = stripComments(readSrc("app/api/orders/route.ts"));
  // The call SITE that actually gates the write — claimFor(orderId) — not the
  // bare "claimRewardStamps" identifier (which also appears in the top import
  // and inside claimFor's own closure body, both of which are declared ABOVE
  // Order.create regardless of whether the call site itself ever moved,
  // which would make an ordering check against either of those vacuous).
  const claimIdx = mustIndexOf(src, "if (!(await claimFor(orderId))) {", "the first-attempt claimFor(orderId) call site");
  const createIdx = mustIndexOf(src, "Order.create({ ...doc, orderId });", "the first Order.create call");
  assert.ok(
    claimIdx < createIdx,
    "claimFor(orderId) must be CALLED before Order.create — a bill must never be discounted by stamps that were not actually spent",
  );
});

// ── 2: CLAIM-BEFORE-CAS (items, settle) ──────────────────────────────────────

test("PIN: app/api/orders/[id]/items/route.ts claims reward stamps BEFORE its Order.findOneAndUpdate CAS write", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/items/route.ts"));
  const claimIdx = mustIndexOf(
    src,
    "const claimed = await claimRewardStamps(String(old.customerId), old.orderId, resolvedClaim.cost, rewardAssignment);",
    "the claim-before-write call",
  );
  const casIdx = mustIndexOf(src, "await Order.findOneAndUpdate(filter, update, {", "the CAS write");
  assert.ok(claimIdx < casIdx, "claimRewardStamps must run before Order.findOneAndUpdate in items/route.ts");
});

test("PIN: app/api/orders/[id]/settle/route.ts claims reward stamps BEFORE its Order.findOneAndUpdate CAS write", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/settle/route.ts"));
  const claimIdx = mustIndexOf(
    src,
    "const claimed = await claimRewardStamps(String(old.customerId), old.orderId, claim.cost, rewardAssignment);",
    "the claim-before-write call",
  );
  const casIdx = mustIndexOf(src, "await Order.findOneAndUpdate(filter, update, {", "the CAS write");
  assert.ok(claimIdx < casIdx, "claimRewardStamps must run before Order.findOneAndUpdate in settle/route.ts");
});

// ── 3: REVERSE-ONLY-ON-DEFINITE-NO-WRITE ─────────────────────────────────────

test("PIN: settle/route.ts returns the claimed stamps ONLY inside the if (!updated) CAS-miss branch, before its own 409", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/settle/route.ts"));
  const ifIdx = mustIndexOf(src, "if (!updated) {", "the CAS-miss branch opener");
  const failIdx = mustIndexOf(
    src,
    'return failure("Tab changed or already settled — reopen it and try again", 409);',
    "the CAS-miss 409",
  );
  const returnIdx = mustIndexOf(
    src,
    "await returnRewardStamps(String(old.customerId), old.orderId, claim.cost, rewardAssignment);",
    "the compensating returnRewardStamps call",
  );
  assert.ok(
    ifIdx < returnIdx && returnIdx < failIdx,
    "returnRewardStamps must sit between the if (!updated) opener and the 409 it precedes — never-revert-on-write-throw: only a CONFIRMED non-write may reverse a claim",
  );
});

test("PIN: items/route.ts returns the claimed stamps ONLY inside the if (!updated) CAS-miss branch, before its own 409", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/items/route.ts"));
  const ifIdx = mustIndexOf(src, "if (!updated) {", "the CAS-miss branch opener");
  const failIdx = mustIndexOf(
    src,
    'return failure("Tab changed or already settled — reopen it and try again", 409);',
    "the CAS-miss 409",
  );
  const returnIdx = mustIndexOf(
    src,
    "await returnRewardStamps(String(old.customerId), old.orderId, resolvedClaim.cost, rewardAssignment);",
    "the compensating returnRewardStamps call",
  );
  assert.ok(
    ifIdx < returnIdx && returnIdx < failIdx,
    "returnRewardStamps must sit between the if (!updated) opener and the 409 it precedes in items/route.ts",
  );
});

// ── 4: NOT-FIRE-AND-FORGET ───────────────────────────────────────────────────

test("PIN: settle/route.ts's reward claim is NOT wrapped in the earn-side's empty-catch shape — a failed claim 409s the settle instead of being swallowed", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/settle/route.ts"));
  // Positive landmark: the earn-side grant DOES use the fire-and-forget
  // try/swallow shape (so this pin knows the shape it's checking for exists
  // in this file at all, and isn't just failing to find it anywhere). Scoped
  // to the earn-side's OWN try block — the NEAREST "try {" immediately
  // preceding the grant call — not the outer handler-wide try that wraps the
  // whole POST body (which would trivially "contain" everything including
  // the claim call too, making the check vacuous).
  const grantIdx = mustIndexOf(src, "const granted = await grantStampForSettledOrder(", "the earn-side grant call");
  const earnTryIdx = src.lastIndexOf("try {", grantIdx);
  assert.ok(earnTryIdx !== -1, "landmark: the earn-side grant must be wrapped in its own try {");
  const earnCatchIdx = src.indexOf("} catch {", grantIdx);
  assert.ok(earnCatchIdx !== -1, "landmark: the earn-side grant's try must be followed by its own swallowed catch");
  // The claim call must fall OUTSIDE [earnTryIdx, earnCatchIdx] — proving the
  // "nearest try" really did land on the earn-side's own small block, not the
  // outer handler try (whose start is far earlier in the file).
  const outerTryIdx = mustIndexOf(src, "try {", "the outer handler try block");
  assert.ok(
    earnTryIdx > outerTryIdx,
    "landmark: the earn-side's nearest try { must be a DIFFERENT (later, nested) try than the outer handler's",
  );
  // The claim call itself must NOT sit between the earn-side's OWN try { and
  // its matching catch — i.e. it must not be wrapped in that same
  // swallow-everything block.
  const claimIdx = mustIndexOf(
    src,
    "const claimed = await claimRewardStamps(String(old.customerId), old.orderId, claim.cost, rewardAssignment);",
    "the settle-time claim call",
  );
  assert.ok(
    claimIdx < earnTryIdx || claimIdx > earnCatchIdx,
    "claimRewardStamps must be outside the grantStampForSettledOrder try/catch — the claim itself precedes that try block entirely in this route",
  );
  // Direct shape pin (catches a NEW try/catch introduced around the claim
  // itself, which the two checks above cannot see since they only compare
  // against the EARN-side's own try/catch): the `if (claim) {` guard must be
  // followed IMMEDIATELY (module whitespace only) by the claim's own const
  // declaration — no `try {` may be inserted between them.
  assert.match(
    src,
    /if\s*\(claim\)\s*\{\s*const\s+claimed\s*=\s*await\s+claimRewardStamps\(/,
    "the if (claim) guard must be followed directly by the claim call, with no try { wrapper introduced around it",
  );
  // A failed claim must 409, not be swallowed: the call site immediately
  // gates on its own boolean and fails loud.
  assert.match(
    src,
    /if\s*\(!claimed\)\s*return\s*failure\("Not enough stamps for that reward",\s*409\);/,
    "a failed settle-time claim must return a 409, never be swallowed like the earn-side grant",
  );
  // And the grant call IS swallowed (empty catch), by contrast — proving the
  // two shapes really do differ in this file, not just in the pin's mind.
  // stripComments removes the explanatory comment inside the catch but keeps
  // its line terminator, so the block reads as "} catch {" then only
  // whitespace up to the closing "}".
  const catchBody = src.slice(earnCatchIdx + "} catch {".length, src.indexOf("}", earnCatchIdx + "} catch {".length));
  assert.equal(
    catchBody.trim(),
    "",
    "landmark: the earn-side grant's catch block must still be empty (fire-and-forget) after stripping its comment",
  );
});

// ── 5: D9 ITEM FENCE ──────────────────────────────────────────────────────────

test("PIN: settle/route.ts passes refuseItemKind: true; both order-taking writers (create, items) pass refuseItemKind: false", () => {
  const settleSrc = stripComments(readSrc("app/api/orders/[id]/settle/route.ts"));
  assert.match(
    settleSrc,
    /refuseItemKind:\s*true,/,
    "settle/route.ts must pass refuseItemKind: true — D9: a free dish must reach the kitchen while the order is being taken, never after payment",
  );
  const createSrc = stripComments(readSrc("app/api/orders/route.ts"));
  assert.match(
    createSrc,
    /refuseItemKind:\s*false,/,
    "app/api/orders/route.ts (create) must pass refuseItemKind: false — an item reward IS allowed at order-taking time",
  );
  const itemsSrc = stripComments(readSrc("app/api/orders/[id]/items/route.ts"));
  assert.match(
    itemsSrc,
    /refuseItemKind:\s*false,/,
    "app/api/orders/[id]/items/route.ts (add-round) must pass refuseItemKind: false — an item reward IS allowed on an add-round",
  );
});

// ── 6: RE-CLAIM ON RETRY (real defect fixed here) ────────────────────────────

test("PIN (real defect fix): app/api/orders/route.ts's duplicate-key retry path returns the FIRST claim and re-claims against the RE-NUMBERED orderId — a stamps marker keyed to an orderId no order carries would make cancel-return unfindable and allow a double redemption", () => {
  const src = stripComments(readSrc("app/api/orders/route.ts"));
  // Exact call-site needles, NOT the bare "claimFor(" substring — that
  // substring also matches inside "unclaimFor(", which would make an
  // occurrence-count check pass vacuously against the wrong call.
  const firstClaimIdx = mustIndexOf(src, "if (!(await claimFor(orderId))) {", "the first-attempt claim call site");
  const bumpIdx = mustIndexOf(src, "bumpOrderSequenceTo(", "the re-numbering call");
  const retryClaimIdx = mustIndexOf(
    src,
    "if (!(await claimFor(retryOrderId))) {",
    "the retry-attempt re-claim call site, against the RENUMBERED orderId",
  );
  assert.ok(firstClaimIdx < bumpIdx, "landmark: the first attempt's claim must precede the re-number");
  assert.ok(
    bumpIdx < retryClaimIdx,
    "the retry re-claim (claimFor(retryOrderId)) must appear AFTER bumpOrderSequenceTo( — it must re-claim against the RENUMBERED orderId, not reuse the first attempt's claim",
  );
  // unclaimFor(orderId) must be called BEFORE the re-number (returning the
  // first attempt's claim before generating the retry id), and it must exist
  // as its own call site distinct from its declaration.
  const unclaimForDeclIdx = mustIndexOf(src, "const unclaimFor =", "the unclaimFor declaration");
  const unclaimForCallIdx = mustIndexOf(src, "await unclaimFor(orderId);", "the first-attempt unclaim call");
  assert.ok(unclaimForDeclIdx < unclaimForCallIdx, "landmark: unclaimFor must be declared before it is called");
  assert.ok(
    unclaimForCallIdx < bumpIdx,
    "unclaimFor(orderId) must run BEFORE bumpOrderSequenceTo — the first attempt's claim must be returned before the retry re-numbers, or the diner could be charged for stamps never actually spent on the order that lands",
  );
});

// ── 6b: ASSIGNMENT'S assignedAt CAPTURED ONCE, NOT PER ATTEMPT (CB-5D part 2)
// THE HAZARD: claimRewardStamps de-dupes a retry via $addToSet, whose element
// equality is WHOLE-DOCUMENT. claimFor is called TWICE on a duplicate-key
// retry (once for orderId, once for retryOrderId, pinned in section 6 above)
// — if the RewardAssignment (and the `new Date()` inside it) were built
// INSIDE claimFor's own body, each call would mint a DIFFERENT assignedAt,
// making the two attempts' $addToSet elements unequal and appending the
// reward to Customer.rewards a SECOND time on every renumbered retry. The fix
// is to build the assignment ONCE, above claimFor's declaration, into a
// `rewardAssignment` captured by its closure and passed as claimRewardStamps'
// 4th argument — so both calls reuse the identical assignment object.
test("PIN (CB-5D part 2 regression): app/api/orders/route.ts's claimFor does NOT construct the reward assignment (or a new Date) inside its own body — assignedAt must be captured ONCE, above claimFor, or a duplicate-key retry duplicates the customer's reward", () => {
  const src = stripComments(readSrc("app/api/orders/route.ts"));
  // Positive landmarks first — both must still exist for the negative check
  // below to mean anything (a renamed/deleted claimFor, or a route that
  // stopped passing the 4th arg at all, would make an empty-body check pass
  // vacuously).
  const claimForDeclIdx = mustIndexOf(src, "const claimFor = async (oid: string): Promise<boolean> =>", "the claimFor declaration");
  assert.match(
    src,
    /claimRewardStamps\(customerId!,\s*oid,\s*resolvedClaim\.cost,\s*rewardAssignment\)/,
    "landmark: claimFor's body must still call claimRewardStamps with the 4-arg form, passing the captured rewardAssignment",
  );
  // claimFor is a single-expression arrow function (`=>` body, no braces) —
  // bounded from its own declaration to the very next `const` declaration
  // (unclaimFor's), which is exactly its body's extent.
  const nextConstIdx = mustIndexOf(src, "const unclaimFor =", "the next declaration bounding claimFor's body");
  assert.ok(nextConstIdx > claimForDeclIdx, "landmark: unclaimFor must be declared after claimFor");
  const claimForBody = src.slice(claimForDeclIdx, nextConstIdx);
  // THE ASSERTION: claimFor's own body must reference neither
  // buildRewardAssignment nor `new Date(` — both must be evaluated ABOVE it,
  // once, and merely referenced (as `rewardAssignment`) inside the closure.
  assert.ok(
    !/buildRewardAssignment/.test(claimForBody),
    "claimFor must NOT call buildRewardAssignment inside its own body — that would re-resolve the assignment (and mint a new assignedAt) on EVERY call, duplicating the reward when the duplicate-key retry calls claimFor a second time for retryOrderId",
  );
  assert.ok(
    !/new Date\(/.test(claimForBody),
    "claimFor must NOT construct `new Date()` inside its own body — claimRewardStamps' $addToSet treats the whole RewardAssignment as one element, so a fresh Date per call would make the first attempt's and the retry's elements unequal and append the reward a SECOND time",
  );
  // And the positive half of the fix: `rewardAssignment` must be captured
  // ABOVE claimFor's declaration (built once, alongside resolvedClaim), not
  // merely absent from the body by coincidence of some other refactor.
  const captureIdx = mustIndexOf(
    src,
    "let rewardAssignment: ReturnType<typeof buildRewardAssignment> | undefined;",
    "the single rewardAssignment capture site",
  );
  assert.ok(
    captureIdx < claimForDeclIdx,
    "rewardAssignment must be declared ABOVE claimFor — captured once per request, before either claim attempt, never re-derived per attempt",
  );
});

// ── 7: AMBIGUITY REFUSED ─────────────────────────────────────────────────────

test("PIN: lib/reward-claim.ts's findMilestoneAt REFUSES an ambiguous duplicate `at` rather than taking the first match", () => {
  const src = stripComments(readSrc("lib/reward-claim.ts"));
  assert.match(src, /export function findMilestoneAt\(/, "landmark: findMilestoneAt must still be exported");
  const fnStart = mustIndexOf(src, "export function findMilestoneAt(", "findMilestoneAt");
  const fnEnd = src.indexOf("\nexport interface ResolveRewardClaimInput", fnStart);
  assert.ok(fnEnd !== -1, "landmark: the next export after findMilestoneAt must be found to bound the function body");
  const fnBody = src.slice(fnStart, fnEnd);
  // Positive landmark: the ambiguity branch DOES exist, explicitly on
  // matches.length > 1 — never a bare "first match" shortcut.
  assert.match(
    fnBody,
    /matches\.length\s*>\s*1\)\s*return\s*\{\s*ok:\s*false,\s*reason:\s*"ambiguous-reward"\s*\}/,
    "findMilestoneAt must explicitly refuse when matches.length > 1",
  );
  // Negative pin: no first-match shortcut of the form `matches[0]` used
  // WITHOUT having checked length > 1 immediately above it in this function.
  // Scoped to the function body so this can never match an unrelated [0] in
  // a different function of the same file.
  const zeroIndexCount = (fnBody.match(/matches\[0\]/g) ?? []).length;
  assert.equal(
    zeroIndexCount,
    1,
    "findMilestoneAt must reference matches[0] exactly once — the single return AFTER the ambiguity check has already refused length > 1, never a first-match shortcut taken before that check",
  );
  // And that one reference must come AFTER the ambiguity check, not before.
  const ambiguityCheckIdx = mustIndexOf(fnBody, "matches.length > 1", "the ambiguity length check");
  const zeroIndexIdx = mustIndexOf(fnBody, "matches[0]", "the matches[0] reference");
  assert.ok(
    ambiguityCheckIdx < zeroIndexIdx,
    "the matches.length > 1 ambiguity check must run BEFORE matches[0] is ever read",
  );
});

// ── 8: Behavioural unit tests for the PURE pieces of lib/reward-claim.ts ────

// Same settings-fixture precedent as lib/diner-loyalty.test.ts: ISettings is
// a Mongoose Document type; these tests only ever read the loyaltyRules field,
// so a single cast-once helper stands in for a real document.
function settings(over: Partial<ISettings> = {}): ISettings {
  return over as ISettings;
}

function loyaltyRules(milestones: LoyaltyMilestoneInput[], over: Partial<LoyaltyRulesInput> = {}): LoyaltyRulesInput {
  return {
    v: LOYALTY_RULES_SCHEMA_VERSION,
    unitLabel: "stamp",
    milestones,
    ...over,
  };
}

function milestone(at: number, over: Partial<LoyaltyMilestoneInput> = {}): LoyaltyMilestoneInput {
  return { at, kind: "flat", value: 50, item: "", ...over };
}

test("findMilestoneAt: found — returns the ResolvedMilestone for the matching `at`", () => {
  const s = settings({ loyaltyRules: loyaltyRules([milestone(5), milestone(10, { kind: "percent", value: 20 })]) as unknown as ISettings["loyaltyRules"] });
  const result = findMilestoneAt(s, 10);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.milestone.at, 10);
    assert.equal(result.milestone.kind, "percent");
    assert.equal(result.milestone.value, 20);
  }
});

test("findMilestoneAt: not-found — no milestone at that `at` value", () => {
  const s = settings({ loyaltyRules: loyaltyRules([milestone(5), milestone(10)]) as unknown as ISettings["loyaltyRules"] });
  const result = findMilestoneAt(s, 7);
  assert.deepEqual(result, { ok: false, reason: "no-such-reward" });
});

// PREVIOUSLY: findMilestoneAt read only ladder.milestones from
// resolveLoyaltyConfig(settings), and resolveLoyaltyConfig builds that ladder
// via ladderOf -> normalizeMilestones, which already deduplicates a repeated
// `at` (keeping the first row) before findMilestoneAt's own filter ever ran —
// MEASURED at the time: feeding two milestones with the same `at` through
// that path resolved ok:true with the FIRST milestone, never
// ok:false/"ambiguous-reward", making the ambiguous-reward branch
// unreachable through its only real call path.
//
// FIXED: findMilestoneAt now filters the RAW stored rows
// (settings?.loyaltyRules?.milestones) for a duplicate `at` BEFORE calling
// resolveLoyaltyConfig, so a legacy doc with two rows sharing an `at` is
// caught upstream of the normalizer's dedupe and the ambiguity refusal below
// is reachable again. MEASURED (this task): the fixture below now resolves
// ok:false/"ambiguous-reward", confirmed by running this exact suite.
test("findMilestoneAt: ambiguous — two RAW stored rows sharing the same `at` refuse rather than silently resolving the first", () => {
  const s = settings({
    loyaltyRules: loyaltyRules([
      milestone(10, { kind: "flat", value: 50 }),
      milestone(10, { kind: "percent", value: 20 }),
    ]) as unknown as ISettings["loyaltyRules"],
  });
  const result = findMilestoneAt(s, 10);
  assert.deepEqual(result, { ok: false, reason: "ambiguous-reward" });
});

test("findMilestoneAt: non-duplicate ladder still resolves — positive landmark that the raw-rows ambiguity check does not false-positive on a normal ladder", () => {
  const s = settings({
    loyaltyRules: loyaltyRules([
      milestone(5, { kind: "flat", value: 30 }),
      milestone(10, { kind: "percent", value: 20 }),
      milestone(15, { kind: "item", value: 0, item: "Masala Chai" }),
    ]) as unknown as ISettings["loyaltyRules"],
  });
  const result = findMilestoneAt(s, 15);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.milestone.at, 15);
    assert.equal(result.milestone.kind, "item");
    assert.equal(result.milestone.item, "Masala Chai");
  }
});

test("rewardSnapshotFields: omit-empty — a flat reward writes no rewardItemProductId/rewardQty keys", () => {
  const reward: RedeemedReward = { at: 5, kind: "flat", value: 50, item: "" };
  const fields = rewardSnapshotFields(reward, 5);
  assert.equal(fields.rewardAt, 5);
  assert.equal(fields.rewardKind, "flat");
  assert.equal(fields.rewardValue, 50);
  assert.equal(fields.rewardItem, "");
  assert.equal(fields.rewardStamps, 5);
  assert.ok(!("rewardItemProductId" in fields), "a flat reward must write NO rewardItemProductId key");
  assert.ok(!("rewardQty" in fields), "a flat reward must write NO rewardQty key");
});

test("rewardSnapshotFields: an item reward writes BOTH rewardItemProductId and rewardQty", () => {
  const reward: RedeemedReward = {
    at: 10,
    kind: "item",
    value: 0,
    item: "Masala Chai",
    itemProductId: "64abc0000000000000000001",
    qty: 2,
  };
  const fields = rewardSnapshotFields(reward, 10);
  assert.equal(fields.rewardItemProductId, "64abc0000000000000000001");
  assert.equal(fields.rewardQty, 2);
});

test("rewardSnapshotFields: rewardStamps always records the claim's cost, regardless of kind", () => {
  const flat: RedeemedReward = { at: 5, kind: "flat", value: 50, item: "" };
  const item: RedeemedReward = { at: 10, kind: "item", value: 0, item: "Chai", itemProductId: "x", qty: 1 };
  assert.equal(rewardSnapshotFields(flat, 5).rewardStamps, 5);
  assert.equal(rewardSnapshotFields(item, 10).rewardStamps, 10);
});

// ── 9: CB-5B MONEY-LOSING DEFECT FIX — the reward-fallback source pins ──────
// THE BUG (all three re-pricing writers, same shape): computeOrderTotals's
// rewardDiscountAmount fails CLOSED to 0 when `reward` is undefined, but a
// tab's discountKind carries forward as "reward" on the stored order. A
// writer that recomputed totals with discountKind: "reward" but did NOT pass
// the actual RedeemedReward silently zeroed a discount the diner already
// spent stamps on — the customer is overcharged for something already paid
// for in stamps. THE FIX threads `rewardFromOrderSnapshot(old)` in as the
// fallback at all three sites (rebuilt from the order's OWN stored snapshot,
// never the live ladder). These pins assert the fallback is PRESENT at each
// site — behavioural coverage for the same fix lives in order-void.test.ts
// (resolveItemVoid) and settle-money.test.ts (resolveSettleMoney).

test("PIN (CB-5B fix): app/api/orders/[id]/items/route.ts imports rewardFromOrderSnapshot AND calls it as the fallback into computeOrderTotals's reward", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/items/route.ts"));
  // Positive landmark: the import exists at all (guards against the whole
  // block being renamed/removed out from under the call-site needle below).
  assert.match(
    src,
    /rewardFromOrderSnapshot/,
    "landmark: rewardFromOrderSnapshot must still be referenced somewhere in this file",
  );
  mustIndexOf(
    src,
    "rewardFromOrderSnapshot,",
    "the named import of rewardFromOrderSnapshot from @pos/shared/reward-redemption",
  );
  const fallbackIdx = mustIndexOf(
    src,
    "const rewardForTotals = resolvedClaim?.reward ?? rewardFromOrderSnapshot(old);",
    "the fallback call site that feeds computeOrderTotals's reward",
  );
  const totalsCallIdx = mustIndexOf(
    src,
    "reward: rewardForTotals,",
    "computeOrderTotals being fed the fallback-resolved reward",
  );
  assert.ok(
    fallbackIdx < totalsCallIdx,
    "the fallback must be computed BEFORE it is threaded into computeOrderTotals — deleting either half must fail this pin",
  );
});

test("PIN (CB-5B fix): app/api/orders/[id]/settle/route.ts imports rewardFromOrderSnapshot AND calls it as the fallback into resolveSettleMoney's reward", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/settle/route.ts"));
  assert.match(
    src,
    /rewardFromOrderSnapshot/,
    "landmark: rewardFromOrderSnapshot must still be referenced somewhere in this file",
  );
  mustIndexOf(
    src,
    "import { shouldStoreDiscountKind, rewardFromOrderSnapshot } from \"@pos/shared/reward-redemption\";",
    "the named import of rewardFromOrderSnapshot from @pos/shared/reward-redemption",
  );
  const claimCallIdx = mustIndexOf(src, "const money = resolveSettleMoney({", "the resolveSettleMoney call site");
  const fallbackIdx = mustIndexOf(
    src,
    "reward: claim?.reward ?? rewardFromOrderSnapshot(old),",
    "the fallback passed as resolveSettleMoney's reward argument",
  );
  assert.ok(
    claimCallIdx < fallbackIdx,
    "the reward: claim?.reward ?? rewardFromOrderSnapshot(old) argument must sit INSIDE the resolveSettleMoney({ ... }) call",
  );
});

test("PIN (CB-5B fix): lib/order-void.ts's resolveItemVoid is fed rewardFromOrderSnapshot(old) by app/api/orders/[id]/items/void/route.ts", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/items/void/route.ts"));
  assert.match(
    src,
    /rewardFromOrderSnapshot/,
    "landmark: rewardFromOrderSnapshot must still be referenced somewhere in this file",
  );
  mustIndexOf(
    src,
    "import { rewardFromOrderSnapshot } from \"@pos/shared/reward-redemption\";",
    "the named import of rewardFromOrderSnapshot from @pos/shared/reward-redemption",
  );
  const resolveCallIdx = mustIndexOf(src, "const resolved = resolveItemVoid({", "the resolveItemVoid call site");
  const rewardArgIdx = mustIndexOf(
    src,
    "reward: rewardFromOrderSnapshot(old),",
    "the reward argument fed into resolveItemVoid",
  );
  assert.ok(
    resolveCallIdx < rewardArgIdx,
    "the reward: rewardFromOrderSnapshot(old) argument must sit INSIDE the resolveItemVoid({ ... }) call",
  );
});

// ── 10: ItemVoidInput.reward stays REQUIRED — the type-level guard ──────────
// This requiredness (not `reward?:`) is WHY the type checker caught all six
// call sites when the field was added — an optional field would have let
// every existing caller compile unchanged, silently. If someone "cleans up"
// this field to optional later, the guard dies silently and this pin is the
// only thing standing between that PR and the bug coming back.

// ── 11: NEVER-REVERT-ON-WRITE-THROW (real defect fixed here) ────────────────
// THE BUG: app/api/orders/route.ts called `await unclaimFor(orderId);` BEFORE
// checking the error type in the create catch block, so ANY Order.create
// throw — including a socket timeout or a primary step-down that may
// accompany an insert that actually COMMITTED — returned the claimed stamps.
// That is a silent double-spend: the diner gets their stamps back AND keeps
// an order carrying the reward, and it violates this repo's
// never-revert-on-write-throw rule (only a DEFINITE no-write — a duplicate-key
// rejection, a SERVER response proving nothing was written — may reverse a
// claim). THE FIX: both the first attempt and the retry attempt now check
// `isDuplicateKeyError` BEFORE unclaiming.

test("PIN (real defect fix): app/api/orders/route.ts's create catch checks isDuplicateKeyError BEFORE unclaimFor — an indefinite throw must never revert a claim that may have actually committed", () => {
  const src = stripComments(readSrc("app/api/orders/route.ts"));
  // Positive landmark: the guarded rethrow exists at all, so this pin cannot
  // pass merely because the needle vanished along with the whole catch block.
  assert.match(
    src,
    /if\s*\(!isDuplicateKeyError\(e\)\)\s*throw e;/,
    "landmark: the first-attempt catch must still guard-rethrow on a non-duplicate-key error",
  );
  const guardIdx = mustIndexOf(
    src,
    "if (!isDuplicateKeyError(e)) throw e;",
    "the first-attempt guard that rethrows anything that is NOT a duplicate-key error",
  );
  // SCOPED to the create catch block. CB-5D part 2 added a SECOND, legitimate
  // `await unclaimFor(orderId);` ABOVE this catch — the promo fence refusal
  // path, where nothing was written at all and returning the stamps is
  // unconditionally right. An unscoped indexOf finds that one first and would
  // read a correct file as broken, so the needle is searched from the catch
  // opener onward: this pin is about what the CATCH does, not the route.
  const createCatchIdx = mustIndexOf(src, "} catch (e) {", "the create attempt's catch opener");
  const unclaimIdx = mustIndexOf(
    src.slice(createCatchIdx),
    "await unclaimFor(orderId);",
    "the first-attempt unclaim call inside the create catch",
  ) + createCatchIdx;
  assert.ok(
    guardIdx > createCatchIdx,
    "landmark: the isDuplicateKeyError guard must live INSIDE the create catch, not before it",
  );
  assert.ok(
    guardIdx < unclaimIdx,
    "if (!isDuplicateKeyError(e)) throw e; must appear BEFORE await unclaimFor(orderId); — unclaiming on ANY throw (not just a confirmed duplicate-key no-write) would silently double-spend a claim against an order that may have actually committed",
  );
  // The promo fence release is bound to the SAME definite-no-write outcome.
  const unfenceIdx = mustIndexOf(
    src.slice(createCatchIdx),
    "await unfencePromoFor(orderId);",
    "the create catch's promo fence release",
  ) + createCatchIdx;
  assert.ok(
    guardIdx < unfenceIdx,
    "await unfencePromoFor(orderId); must also sit AFTER the duplicate-key guard — releasing a once-per-customer fence on an indefinite throw would hand the code back while the committed order still carries its discount",
  );
});

test("PIN (real defect fix): app/api/orders/route.ts's RETRY catch guards its unclaim with isDuplicateKeyError(retryError) too — the same fence, not just the first attempt", () => {
  const src = stripComments(readSrc("app/api/orders/route.ts"));
  // Positive landmark: the retry catch's rethrow still exists, so the negative
  // shape below is scoped against a catch block we know is really there.
  assert.match(
    src,
    /catch\s*\(retryError\)\s*\{/,
    "landmark: the retry attempt's own catch (retryError) block must still exist",
  );
  const retryCatchIdx = mustIndexOf(src, "catch (retryError) {", "the retry catch block opener");
  // CB-5D part 2 — the guard's SHAPE moved (a braced block now holds two
  // compensations: the stamp unclaim and the promo fence release), but the
  // DECISION this pin records is unchanged and still enforced: neither
  // compensation may run outside the isDuplicateKeyError(retryError) branch.
  const retryUnclaimGuardIdx = mustIndexOf(
    src,
    "if (isDuplicateKeyError(retryError)) {",
    "the retry attempt's guarded compensation block — the unclaim/unfence only run INSIDE this condition",
  );
  // Both compensations must sit INSIDE that block, not merely after it. The
  // block is bounded by its closing brace so a compensation moved below the
  // guard cannot pass by being "somewhere after the opener".
  const retryGuardEndIdx = src.indexOf("}", mustIndexOf(src, "await unfencePromoFor(retryOrderId);", "the retry attempt's promo fence release"));
  assert.ok(retryGuardEndIdx !== -1, "landmark: the retry guard block must have a closing brace");
  const retryGuardBody = src.slice(retryUnclaimGuardIdx, retryGuardEndIdx);
  assert.match(
    retryGuardBody,
    /await unclaimFor\(retryOrderId\);/,
    "the retry attempt's stamp unclaim must sit INSIDE the isDuplicateKeyError(retryError) guard — an unconditional unclaim would revert a claim whose order may have committed",
  );
  assert.match(
    retryGuardBody,
    /await unfencePromoFor\(retryOrderId\);/,
    "the retry attempt's promo fence release must sit INSIDE the same guard — releasing a fence on an indefinite throw would hand back a once-per-customer code the committed order still carries",
  );
  const retryRethrowIdx = mustIndexOf(
    src,
    "throw retryError;",
    "the retry attempt's unconditional rethrow that follows the guarded unclaim",
  );
  assert.ok(
    retryCatchIdx < retryUnclaimGuardIdx && retryUnclaimGuardIdx < retryRethrowIdx,
    "the retry catch must guard unclaimFor(retryOrderId) behind isDuplicateKeyError(retryError), then always rethrow — never an unconditional unclaim before the guard",
  );
});

test("PIN (CB-5B guard): ItemVoidInput.reward is a REQUIRED field (reward: RedeemedReward | undefined), NOT optional (reward?:)", () => {
  const src = stripComments(readSrc("lib/order-void.ts"));
  // Positive landmark: the interface itself still exists, and still has a
  // `reward` member at all — guards against the whole interface having been
  // renamed/removed out from under the negative check below.
  const ifaceIdx = mustIndexOf(src, "export interface ItemVoidInput<T extends VoidableLine> {", "the ItemVoidInput interface");
  const nextIfaceIdx = src.indexOf("\nexport type ItemVoidResolution", ifaceIdx);
  assert.ok(nextIfaceIdx !== -1, "landmark: the next export after ItemVoidInput must be found to bound the interface body");
  const ifaceBody = src.slice(ifaceIdx, nextIfaceIdx);
  assert.match(
    ifaceBody,
    /reward:\s*RedeemedReward\s*\|\s*undefined;/,
    "ItemVoidInput.reward must be declared REQUIRED as `reward: RedeemedReward | undefined` — required-and-nullable, not optional",
  );
  // Negative pin, vision-guarded by the positive match above: the optional
  // form must not appear anywhere in the interface body.
  assert.ok(
    !/reward\?:/.test(ifaceBody),
    "ItemVoidInput.reward must NOT be declared as `reward?:` — optional would silently let every existing caller skip it again, and the type checker would no longer catch a missing reward",
  );
});

// ── 6: S6 — CANCEL RETURNS THE STAMPS (D2) ───────────────────────────────────
// The cancel route is the mirror image of the reverse-only-on-definite-no-write
// pins above, and the direction is what these pins exist to hold. There the
// claim is reversed ONLY inside a confirmed non-write branch; HERE the cancel
// has certainly landed (the CAS returned a document) and the return is the
// compensating half of that committed write. A future edit that moves this
// return above the CAS, or drops its swallow, breaks a different invariant in
// each direction — so both are pinned explicitly.

test("PIN (S6): cancel/route.ts returns the reward stamps AFTER its cancel CAS has landed — never before, and never inside the CAS-miss 409 branch", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/cancel/route.ts"));
  const casIdx = mustIndexOf(src, "const updated = await Order.findOneAndUpdate(", "the cancel CAS write");
  const casMissIdx = mustIndexOf(
    src,
    'if (!updated) return failure("Order changed — reload and try again", 409);',
    "the CAS-miss 409 guard",
  );
  const returnIdx = mustIndexOf(
    src,
    "const returned = await returnRewardStamps(rewardCustomer, updated.orderId, rewardCost);",
    "the S6 compensating returnRewardStamps call",
  );
  assert.ok(casIdx < returnIdx, "the stamp return must come AFTER the cancel CAS write, never before it");
  assert.ok(
    casMissIdx < returnIdx,
    "the stamp return must sit BELOW the !updated CAS-miss guard — on a CAS miss nothing was cancelled, so nothing may be returned",
  );
  // REACHABILITY. Relative ordering alone is NOT enough: the whole block can be
  // moved BELOW the handler's success return, where it is dead code and no
  // cancel ever refunds anything, while every ordering needle above keeps its
  // relative position and this pin stays green (reproduced by moving the block
  // past `return success(updated);` — 27/27 still passed). That is this repo's
  // "slice specs satisfied, feature still dead" lesson, so the upper bound is
  // pinned too.
  const successIdx = mustIndexOf(src, "return success(updated);", "the handler's success return");
  assert.ok(
    returnIdx < successIdx,
    "the stamp return must sit ABOVE the handler's success return — below it the whole block is unreachable and no cancel ever returns a stamp",
  );
  // EXACTLY ONE call site. indexOf finds only the FIRST occurrence, so a SECOND
  // returnRewardStamps call added BEFORE the CAS would leave every check above
  // satisfied while refunding on a merely-READ status — the reversal-on-an-
  // unconfirmed-outcome that never-revert-on-write-throw forbids (a cancel that
  // then loses its CAS would have already credited the stamps, leaving the diner
  // with both the discount and the stamps).
  // The import is `import { returnRewardStamps } from ...` — no paren — so an
  // occurrence of `returnRewardStamps(` is a CALL, and there must be exactly one.
  assert.equal(
    src.split("returnRewardStamps(").length - 1,
    1,
    "cancel/route.ts must contain EXACTLY ONE returnRewardStamps( call site — a second one (e.g. before the CAS) would refund on a merely-READ status, outside the committed-write branch",
  );
});

test("PIN (S6): cancel/route.ts's stamp return is SWALLOWED — a committed cancel must never 500 on a marker write", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/cancel/route.ts"));
  const returnIdx = mustIndexOf(
    src,
    "const returned = await returnRewardStamps(rewardCustomer, updated.orderId, rewardCost);",
    "the S6 compensating returnRewardStamps call",
  );
  // The NEAREST try { preceding the return call must be a DIFFERENT, later try
  // than the outer handler-wide one — otherwise "it's in a try" would be
  // vacuously true of every line in the handler body.
  const outerTryIdx = mustIndexOf(src, "try {", "the outer handler try block");
  const nearestTryIdx = src.lastIndexOf("try {", returnIdx);
  assert.ok(nearestTryIdx !== -1, "landmark: the stamp return must be wrapped in a try {");
  assert.ok(
    nearestTryIdx > outerTryIdx,
    "the stamp return's nearest try { must be its OWN nested block, not the outer handler try (which would swallow nothing extra and prove nothing)",
  );
  // ...and that nested try must have its own catch, which must be EMPTY after
  // comment-stripping (the deliberate swallow), exactly the shape the earn-side
  // grant uses in settle/route.ts.
  const catchIdx = src.indexOf("} catch {", returnIdx);
  assert.ok(catchIdx !== -1, "the stamp return's try must be closed by its own `} catch {`");
  const catchBody = src.slice(catchIdx + "} catch {".length, src.indexOf("}", catchIdx + "} catch {".length));
  assert.equal(
    catchBody.trim(),
    "",
    "the stamp return's catch must be EMPTY (swallowed) — the cancel is already committed and must not be turned into a 500 the operator would retry into a 409",
  );
  // BOUND WHAT IS SWALLOWED. An empty nested catch proves the shape but not its
  // EXTENT: widening the same try to enclose the table-free write keeps the
  // catch empty and nested while silently swallowing a Table write failure,
  // leaving a cancelled order's table Occupied forever with no 500 and — under
  // this repo's no-console rule — no log anywhere. So the swallow must CLOSE
  // before the table block begins.
  const tableIdx = mustIndexOf(src, "if (updated.tableNo) {", "the table-free block");
  assert.ok(
    tableIdx > catchIdx,
    "the stamp return's try/catch must close BEFORE the table-free write — that write must never be swallowed, or a cancelled order's table stays Occupied silently",
  );
});

test("PIN (S6): cancel/route.ts returns the STORED rewardStamps cost, gated on a valid customer and a non-zero cost — never a cost re-derived from the live ladder", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/cancel/route.ts"));
  // The cost comes from the ORDER's own stored snapshot field. The owner may
  // retune a rung's `at` after the claim, so re-resolving the ladder here would
  // refund the wrong number of stamps.
  assert.match(
    src,
    /const\s+rewardCost\s*=\s*updated\.rewardStamps\s*\?\?\s*0;/,
    "the refunded cost must read updated.rewardStamps (the cost STORED at claim time), never a live ladder lookup",
  );
  // Negative pin, vision-guarded by the positive match above: nothing in this
  // route may resolve a milestone/ladder to compute the refund.
  assert.ok(
    !/findMilestoneAt|resolveLoyaltyConfig|resolveRewardClaim/.test(src),
    "cancel/route.ts must NOT re-resolve the loyalty ladder — the stamp cost is stored provenance, not a live lookup",
  );
  // validCustomer, not a bare String(): an order with no customerId would
  // otherwise stringify to the literal "undefined" and be sent to Mongo as an id.
  assert.match(
    src,
    /const\s+rewardCustomer\s*=\s*validCustomer\(updated\.customerId\);/,
    "the customer must be resolved through validCustomer() — a bare String(undefined) would send the literal \"undefined\" as an _id",
  );
  assert.match(
    src,
    /if\s*\(rewardCustomer\s*&&\s*rewardCost\s*>\s*0\)\s*\{/,
    "the return must be gated on BOTH a valid customer and a non-zero stored cost — an order that never funded a claim has nothing to give back",
  );
});

// CB-5D part 2 — the `if (returned)` arm gained a BRACED BODY: the cancel must
// also un-assign the minted code, not just refund the stamps (a live-probed
// exploit — stamps came back AND the code stayed, repeatably). The DECISION
// this pin records is unchanged and is re-asserted per-statement below: both
// effects stay gated on the boolean the return actually gave back.
test("PIN (S6): cancel/route.ts drops the customers cache AND releases the assigned code ONLY when the return actually fired", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/cancel/route.ts"));
  const gateIdx = src.indexOf("if (returned) {");
  assert.ok(gateIdx > -1, "landmark: the `if (returned)` gate must still exist");
  // Bound the block so a statement moved BELOW the gate cannot satisfy this.
  // The gate's own closing brace sits at EIGHT spaces (it is nested inside the
  // try inside the `if (rewardCustomer && rewardCost > 0)`). Matching a
  // shallower indent would close the block at the INNER `if`'s brace and slice
  // a region too small to notice a statement escaping the gate — mutation-
  // measured: with the 6-space needle, moving the release outside the gate
  // still passed.
  const endIdx = src.indexOf("\n        }", gateIdx);
  assert.ok(endIdx > gateIdx, "landmark: the gated block must have a closing brace");
  const body = src.slice(gateIdx, endIdx);
  assert.match(
    body,
    /cache\.del\("customers"\);/,
    "cache.del(\"customers\") must be gated on the boolean returnRewardStamps actually returned — a refused return (already returned, or a reassigned customer) changed no row",
  );
  assert.match(
    body,
    /releaseAssignedRewardForRung\(rewardCustomer, updated\.rewardAt\)/,
    "the assigned code must be released INSIDE the same gate — a refused return means this order's claim never landed, so its grant is not ours to pull",
  );
});

test("PIN (S6/D2): cancel/route.ts does NOT reverse the EARN side — no stamp grant is clawed back on cancel", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/cancel/route.ts"));
  // Positive landmark first: the REDEEM-side return really is present in this
  // file, so the absence check below is scoped to a file that genuinely wires
  // the reward lifecycle (a negative pin against an empty/renamed file would
  // pass vacuously — the documented trap).
  assert.match(
    src,
    /returnRewardStamps\(/,
    "landmark: the redeem-side return must be wired in this route before asserting the earn side is absent",
  );
  assert.ok(
    !/grantStampForSettledOrder|revokeStamp|stampOrders/.test(src),
    "D2 (binding): a cancel returns what the diner SPENT and must not claw back what they EARNED — the earn-side gap is deliberately kept",
  );
  // A name list is not a shape check: a hand-rolled clawback names none of the
  // three identifiers above and would sail through
  // (`Customer.updateOne({_id}, {$inc: {stamps: -1, stampsLifetime: -1}})`),
  // breaking D2 while the pin defending D2 stayed green — this repo's
  // "absence claims need synonym sweeps" lesson. So bar the SHAPE as well:
  // this route must never decrement a stamp counter by any route, and must
  // never touch stampsLifetime at all (a spend is not an un-earn, and a cancel
  // is not an un-spend of the EARN side).
  assert.ok(
    !/stampsLifetime/.test(src),
    "cancel/route.ts must never reference stampsLifetime — D2 keeps the earned stamp, and lifetime earn is never rewritten by a cancel",
  );
  assert.ok(
    !/\$inc[^}]*stamps\s*:\s*-/.test(src),
    "cancel/route.ts must never DECREMENT stamps — it only returns them via returnRewardStamps; any negative stamps $inc here is an earn-side clawback D2 forbids",
  );
});
