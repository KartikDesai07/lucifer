import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { decideRedemption } from "./reward-redemption";
import { stripComments } from "@/lib/source-pin-utils";
import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";

// CB-5B S3 — decideRedemption is PURE and DB-free (no Mongo import), so this
// suite covers the full decision table with no live-DB leg. claimRewardStamps
// / returnRewardStamps are Mongo writers and are covered by the live-DB leg
// (scripts/verify-reward-redemption-live.ts, a later slice) plus the source
// pins below, which assert the exact atomic-filter shape without needing a
// database.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

function milestone(at: number, over: Partial<ResolvedMilestone> = {}): ResolvedMilestone {
  // CB-5B D8/D11 — a RESOLVED milestone always carries both fields (normalize
  // fills them); the default here is the non-item shape: no dish, count 1.
  return {
    at,
    kind: "flat",
    value: 50,
    item: "",
    itemProductId: null,
    qty: 1,
    minBill: null,
    // CB-5D part 2 — a resolved milestone states both promo axes explicitly;
    // the default is the shape of a rung that mints no code and never expires.
    promoCode: null,
    claimWithinDays: null,
    ...over,
  };
}

// ── decideRedemption: decision table ─────────────────────────────────────────

test("decideRedemption: no milestone -> no-milestone, regardless of stamps", () => {
  const result = decideRedemption(100, undefined, 500);
  assert.deepEqual(result, { ok: false, reason: "no-milestone" });
});

test("decideRedemption: kind:'item' with sufficient stamps succeeds — D5 REVERSED 2026-09-13 (Rs 0 BY DESIGN, not by failure)", () => {
  // Pre-reversal, this exact case returned "item-not-redeemable" — the owner
  // reversed that decision: a free dish IS claimable through this route now.
  // cost === at (same as any other kind) and reward.kind === "item"; the
  // money value is 0 because the benefit is a dish on the bill (S12), never
  // rupees off the total — that is a DESIGN fact of rewardDiscountAmount, not
  // a symptom of this decision refusing the kind.
  const result = decideRedemption(10, milestone(5, { kind: "item", item: "Masala Chai" }), 500);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.cost, 5);
    assert.equal(result.reward.kind, "item");
    assert.equal(result.reward.item, "Masala Chai");
  }
});

test("decideRedemption: kind:'item' with 0 stamps -> insufficient-stamps (item rungs went from INVISIBLE to NORMALLY GATED)", () => {
  // Carries forward the OLD test's reasoning, negated: pre-reversal, 0 stamps
  // against an item milestone read "item-not-redeemable" — the kind itself
  // was invisible to this path regardless of balance. Post-reversal, an item
  // rung is judged by the SAME stamp-balance gate as flat/percent, so 0
  // stamps against a cost-5 item rung must now read "insufficient-stamps",
  // proving the kind is no longer special-cased away before the balance check.
  const result = decideRedemption(0, milestone(5, { kind: "item", item: "Masala Chai" }), 500);
  assert.deepEqual(result, { ok: false, reason: "insufficient-stamps" });
});

test("decideRedemption: stamps < cost -> insufficient-stamps", () => {
  const result = decideRedemption(7, milestone(8), 500);
  assert.deepEqual(result, { ok: false, reason: "insufficient-stamps" });
});

test("decideRedemption: stamps === cost - 1 fails (boundary)", () => {
  const result = decideRedemption(7, milestone(8), 0);
  assert.equal(result.ok, false);
});

test("decideRedemption: stamps === cost succeeds (boundary)", () => {
  const result = decideRedemption(8, milestone(8), 0);
  assert.equal(result.ok, true);
  assert.equal((result as { cost: number }).cost, 8);
});

test("decideRedemption: billTotal < minBill -> below-min-bill", () => {
  const result = decideRedemption(10, milestone(5, { minBill: 200 }), 199);
  assert.deepEqual(result, { ok: false, reason: "below-min-bill" });
});

test("decideRedemption: billTotal === minBill succeeds (boundary)", () => {
  const result = decideRedemption(10, milestone(5, { minBill: 200 }), 200);
  assert.equal(result.ok, true);
});

test("decideRedemption: milestone with no minBill (null) never gates on bill size", () => {
  const result = decideRedemption(10, milestone(5, { minBill: null }), 0);
  assert.equal(result.ok, true);
});

test("decideRedemption: insufficient-stamps is checked before below-min-bill (most specific/actionable reason)", () => {
  // Both conditions are true here (3 < 5 cost, and 0 < 200 minBill) — the
  // diner's own balance is the more actionable/specific problem, so that
  // reason must win over the bill-size gate.
  const result = decideRedemption(3, milestone(5, { minBill: 200 }), 0);
  assert.deepEqual(result, { ok: false, reason: "insufficient-stamps" });
});

test("decideRedemption: ok result carries the reward snapshot with the milestone's own fields", () => {
  const result = decideRedemption(10, milestone(5, { kind: "percent", value: 20, item: "" }), 500);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.cost, 5);
    assert.deepEqual(result.reward, { at: 5, kind: "percent", value: 20, item: "" });
  }
});

test("decideRedemption: kind:'flat', kind:'percent', AND kind:'item' are all redeemable (D5 REVERSED — positive landmark)", () => {
  assert.equal(decideRedemption(10, milestone(5, { kind: "flat" }), 0).ok, true);
  assert.equal(decideRedemption(10, milestone(5, { kind: "percent" }), 0).ok, true);
  assert.equal(decideRedemption(10, milestone(5, { kind: "item", item: "Masala Chai" }), 0).ok, true);
});

// ── Source pins (P-NEW-4 IDEMPOTENCY) ────────────────────────────────────────
// Each pin below was mutation-tested per the source-pins-must-be-mutation-
// tested lesson: the mutation was applied to a backed-up copy of
// lib/reward-redemption.ts, the suite re-run to confirm the pin FAILS, then
// the file was restored and the suite re-run to confirm green again. Results
// are reported alongside the verify output, not encoded here.

const SRC = stripComments(readSrc("reward-redemption.ts"));

test("PIN: claimRewardStamps is still exported (positive landmark) and its filter carries BOTH redeemedOrders:{$ne:...} and stamps:{$gte:...}", () => {
  assert.match(SRC, /export async function claimRewardStamps\(/, "landmark: claimRewardStamps must still be exported");
  const fnMatch = SRC.match(/export async function claimRewardStamps\([\s\S]*?\n}/);
  assert.ok(fnMatch, "claimRewardStamps body must be found");
  const body = fnMatch![0];
  assert.match(body, /redeemedOrders:\s*\{\s*\$ne:\s*orderId\s*\}/, "claim filter must exclude an orderId already in redeemedOrders");
  assert.match(body, /stamps:\s*\{\s*\$gte:\s*cost\s*\}/, "claim filter must gate on stamps>=cost IN THE FILTER, not a JS check");
});

test("PIN: returnRewardStamps is still exported (positive landmark) and its filter carries redeemedOrders:orderId (positive) AND returnedOrders:{$ne:...}", () => {
  assert.match(SRC, /export async function returnRewardStamps\(/, "landmark: returnRewardStamps must still be exported");
  const fnMatch = SRC.match(/export async function returnRewardStamps\([\s\S]*?\n}/);
  assert.ok(fnMatch, "returnRewardStamps body must be found");
  const body = fnMatch![0];
  assert.match(body, /redeemedOrders:\s*orderId\b/, "return filter must positively require orderId to already be in redeemedOrders");
  assert.match(body, /returnedOrders:\s*\{\s*\$ne:\s*orderId\s*\}/, "return filter must exclude an orderId already in returnedOrders");
});

// WIDENED (CB-5B S4/S5), not loosened. The original pin banned `$addToSet`
// ANYWHERE in this file, guarding the documented double-credit bug: an
// `$addToSet` whose array-uniqueness is the ONLY thing fencing a sibling
// `$inc` de-dups the array element while the `$inc` still fires on a retry.
//
// `claimRewardStamps` now legitimately needs `$addToSet` on redeemedOrders: its
// filter admits an orderId that may ALREADY be in that array (the returned
// case, so a CAS-miss retry is not locked out forever), and Mongo rejects
// `$pull` + `$push` on one path in a single update (live-probed: "Updating the
// path 'redeemedOrders' would create a conflict"). Crucially the FENCE there is
// the filter's `$or` + `returnedOrders`, evaluated before any write — NOT the
// array's uniqueness — so the double-credit mechanism cannot occur.
//
// `returnRewardStamps` has no such filter-level re-entry allowance, so for IT
// the original ban still holds exactly: that is what this pin now asserts,
// per-function instead of per-file. The invariant is narrowed in SCOPE but
// unchanged in STRENGTH — and the claim side gains its own positive assertions
// that the fence it relies on is actually present.
test("PIN: returnRewardStamps still uses $push+$slice and NEVER $addToSet (the documented double-credit bug); claimRewardStamps may use $addToSet ONLY because its FILTER is the fence", () => {
  assert.match(SRC, /export async function claimRewardStamps\(/, "landmark: the file must still define claimRewardStamps");

  const ret = SRC.match(/export async function returnRewardStamps\([\s\S]*?\n}/);
  assert.ok(ret, "returnRewardStamps body must be found");
  assert.ok(
    !ret![0].includes("$addToSet"),
    "returnRewardStamps must use $push+$slice, never $addToSet, beside its $inc — its filter has no re-entry arm, so the array IS its only guard",
  );
  assert.match(ret![0], /\$push:\s*\{\s*returnedOrders:\s*orderId\s*\}/, "returnRewardStamps must $push the orderId onto returnedOrders");
  // RE-POINTED (session 35), never loosened — this pin used to require a
  // `$slice: -LOYALTY_STAMP_ORDERS_MAX` bound here. That bound WAS the bug, and
  // it is now asserted ABSENT. Reasoning, from this same pin's own premise: the
  // filter has no re-entry arm, so this array is the ONLY guard against a second
  // refund — while its partner `redeemedOrders` is uncapped (the claim side's
  // $addToSet). A capped guard against an uncapped partner forgets: once an
  // orderId aged out of returnedOrders, `redeemedOrders: orderId` still matched
  // AND `returnedOrders: {$ne: orderId}` matched again, so a repeat return
  // credited the stamps a second time. LIVE-PROBED against real mongod at
  // $slice:-200 — the 201st distinct return evicted ORD-1 and a repeat return of
  // ORD-1 then matched and paid out +8. The two marker arrays are a matched pair
  // and must have the same memory.
  assert.ok(
    !/\$slice/.test(ret![0]),
    "returnRewardStamps must NOT bound returnedOrders with $slice — it is the only guard against a double refund, and its partner redeemedOrders is uncapped, so a cap makes the guard forget and re-opens the double refund (live-probed)",
  );

  // The claim side: if it uses $addToSet it MUST carry the filter fence that
  // makes that safe. This is the assertion that would trip if someone copied
  // the $addToSet across without the $or — the actual double-credit shape.
  const claim = SRC.match(/export async function claimRewardStamps\([\s\S]*?\n}/);
  assert.ok(claim, "claimRewardStamps body must be found");
  if (claim![0].includes("$addToSet")) {
    assert.match(
      claim![0],
      /\$or:\s*\[\s*\{\s*redeemedOrders:\s*\{\s*\$ne:\s*orderId\s*\}\s*\}\s*,\s*\{\s*returnedOrders:\s*orderId\s*\}\s*\]/,
      "an $addToSet in claimRewardStamps is only safe while the FILTER fences the $inc — the $or re-entry arm must be present",
    );
    assert.match(claim![0], /stamps:\s*\{\s*\$gte:\s*cost\s*\}/, "and the balance check must stay in the filter");
  }
});

test("PIN: stampsLifetime appears in NO $inc in lib/reward-redemption.ts (redemption never touches lifetime earn count)", () => {
  assert.match(SRC, /export async function claimRewardStamps\(/, "landmark: the file must still define claimRewardStamps");
  assert.ok(!SRC.includes("stampsLifetime"), "reward-redemption.ts must never reference stampsLifetime — a spend is not an un-earn");
});

test("PIN: redeemedOrders/returnedOrders are used, not stampOrders/appliedOrders (distinct marker arrays)", () => {
  assert.match(SRC, /redeemedOrders/, "landmark: redeemedOrders must appear");
  assert.match(SRC, /returnedOrders/, "landmark: returnedOrders must appear");
  assert.ok(!SRC.includes("stampOrders"), "reward-redemption.ts must not reuse the earn-side stampOrders marker");
  assert.ok(!SRC.includes("appliedOrders"), "reward-redemption.ts must not reuse the rollup's appliedOrders marker");
});
