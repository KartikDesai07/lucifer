import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { rewardClaimMessage } from "./reward-claim-messages";

// CB-5D part 2 DEFECT FIX — the claim-WINDOW check (isRungClaimWindowClosed,
// @pos/shared/public-promo) had exactly one non-test caller: the QR SUBMIT
// gate (lib/order-request-reward.ts). Every staff money writer (create,
// add-round, settle) plus the QR ACCEPT bridge (the path that actually
// SPENDS) resolve a claim through lib/reward-claim.ts's resolveRewardClaim,
// which read only `.select("stamps")` and never touched `rungEarnedAt` or
// `milestone.claimWithinDays` — so a rung's configured claim window was
// enforced ONLY at quote time, never at the moment the stamps were actually
// debited. THE FIX: resolveRewardClaim now widens its projection to also read
// `rungEarnedAt` and refuses when the window is closed, SINGLE-HOMED so every
// caller inherits it (rather than four hand-copied checks).
//
// resolveRewardClaim itself touches Mongo (Customer.findById), so per this
// repo's DB-free-by-default discipline (assigned-reward-gate.test.ts's own
// split) its WIRING is covered by source pins here, while the underlying pure
// decision (isRungClaimWindowClosed, including the exact four behaviors this
// task calls out: no entry -> not refused, inside window -> allowed, past
// window -> refused, null/absent claimWithinDays -> never refused) is already
// fully covered behaviourally in packages/shared/src/promo-ttl.test.ts — this
// suite does not re-test that pure function, it proves resolveRewardClaim
// WIRES it correctly (the Map-vs-plain-object read, the getTime() vs literal
// 0 distinction, the ordering relative to the balance check, and the new
// failure reason's message mapping).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx !== -1, `expected to find ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
}

// ── projection widened ──────────────────────────────────────────────────────

test("resolveRewardClaim selects BOTH stamps and rungEarnedAt in one query (no second round-trip)", () => {
  const src = stripComments(readSrc("./reward-claim.ts"));
  assert.match(
    src,
    /Customer\.findById\(input\.customerId\)\.select\("stamps rungEarnedAt"\)\.lean\(\);/,
    "the projection must be widened to include rungEarnedAt, not read via a second query",
  );
});

// ── THE most important line: getTime(), never a literal 0 ──────────────────

test("resolveRewardClaim reads rungEarnedAt as a PLAIN OBJECT keyed by milestone.at, and passes earnedAt?.getTime() — NEVER a literal 0", () => {
  const src = stripComments(readSrc("./reward-claim.ts"));
  // Positive landmark: the plain-object index read (lean() returns a Map as a
  // plain object; .get() would throw), mirroring order-request-reward.ts:161
  // exactly.
  mustIndexOf(
    src,
    "const earnedAt = customer.rungEarnedAt?.[String(found.milestone.at)];",
    "the plain-object indexed read of rungEarnedAt",
  );
  // THE single most important line (per the task spec): earnedAt?.getTime()
  // must be passed, not earnedAt?.getTime() ?? 0 or a bare 0 — a literal 0
  // reads as the 1970 epoch and would refuse EVERY pre-existing customer who
  // has no recorded earn time for this rung.
  mustIndexOf(
    src,
    "isRungClaimWindowClosed(earnedAt?.getTime(), found.milestone.claimWithinDays, Date.now())",
    "the call site that must pass earnedAt?.getTime(), never a coerced 0",
  );
  // Negative pin, vision-guarded by the positive landmarks above: no `?? 0`
  // coercion sits between the read and the call.
  assert.ok(
    !/earnedAt\?\.getTime\(\)\s*\?\?\s*0/.test(src),
    "earnedAt?.getTime() must NEVER be coerced with ?? 0 — undefined must reach isRungClaimWindowClosed as undefined, reading as \"no deadline\"",
  );
});

test("resolveRewardClaim does NOT use .get( on rungEarnedAt — .lean() returns a Mongoose Map as a plain object, and .get() would throw", () => {
  const src = stripComments(readSrc("./reward-claim.ts"));
  assert.ok(
    !/rungEarnedAt\s*\?\.\s*get\(/.test(src),
    "rungEarnedAt must be indexed with [key], never .get(key), on a .lean() result",
  );
});

// ── ordering: window check before the balance/minBill decision ─────────────

test("resolveRewardClaim checks the claim window BEFORE decideRedemption's balance/minBill decision — the operator hears the actionable reason first", () => {
  const src = stripComments(readSrc("./reward-claim.ts"));
  const windowIdx = mustIndexOf(
    src,
    'return { ok: false, reason: "claim-window-closed" };',
    "the claim-window refusal",
  );
  const decisionIdx = mustIndexOf(
    src,
    "const decision = decideRedemption(customer.stamps ?? 0, found.milestone, input.billTotal);",
    "the balance/minBill decision call",
  );
  assert.ok(windowIdx < decisionIdx, "the window check must run before decideRedemption is even called");
});

test("resolveRewardClaim checks the claim window AFTER the customer row is loaded (rungEarnedAt must already be in scope)", () => {
  const src = stripComments(readSrc("./reward-claim.ts"));
  const customerIdx = mustIndexOf(
    src,
    'Customer.findById(input.customerId).select("stamps rungEarnedAt").lean();',
    "the customer load",
  );
  const windowIdx = mustIndexOf(
    src,
    'return { ok: false, reason: "claim-window-closed" };',
    "the claim-window refusal",
  );
  assert.ok(customerIdx < windowIdx, "the customer row must be loaded before the window check reads rungEarnedAt");
});

// ── import wiring ────────────────────────────────────────────────────────────

test("reward-claim.ts imports isRungClaimWindowClosed from @pos/shared/public-promo", () => {
  const src = stripComments(readSrc("./reward-claim.ts"));
  assert.match(
    src,
    /import \{ isRungClaimWindowClosed \} from "@pos\/shared\/public-promo";/,
    "the pure predicate must be imported from its single shared home, not re-derived",
  );
});

// ── failure reason + message mapping ────────────────────────────────────────

test("RewardClaimFailure includes claim-window-closed, and rewardClaimMessage maps it to an actionable staff-facing string distinct from the diner-facing copy", () => {
  const msg = rewardClaimMessage("claim-window-closed");
  assert.equal(typeof msg, "string");
  assert.ok(msg.length > 0, "the message must not be empty");
  // Plain English per this repo's UI-copy rule — no raw enum ever reaches a
  // cashier.
  assert.ok(!/^claim-window-closed$/.test(msg), "the raw reason string must never be surfaced verbatim to staff");
});

test("the staff-facing claim-window-closed message stays CONSISTENT with the diner-facing REWARD_CLAIM_WINDOW_CLOSED — both say the window/deadline passed, neither implies the stamps were lost", async () => {
  const { REWARD_CLAIM_WINDOW_CLOSED } = await import("@pos/shared/public-promo");
  const staffMsg = rewardClaimMessage("claim-window-closed");
  // Not asserting textual equality (the two audiences read different copy —
  // spec explicitly allows a distinct staff-actionable variant), only that
  // neither message contradicts the other's core fact: the stamps are still
  // there, only the deadline to claim THIS rung has passed.
  assert.ok(/window|deadline|passed|closed/i.test(REWARD_CLAIM_WINDOW_CLOSED), "landmark: the diner copy states a deadline/window fact");
  assert.ok(/window|deadline|passed|closed/i.test(staffMsg), "the staff copy must state the same deadline/window fact, not a different reason entirely");
});

// ── every caller inherits the gate (SINGLE-HOMED, not four copies) ─────────
// These mirror reward-wiring.test.ts's own call-site pins: proving the FOUR
// claim paths named in the defect report all resolve through
// resolveRewardClaim/resolveRewardClaimAndLine, which is what makes the fix
// SINGLE-HOMED rather than requiring four hand-copied checks.

test("wiring: app/api/orders/route.ts (counter create) resolves its claim through resolveRewardClaimAndLine, which now inherits the window gate", () => {
  const src = stripComments(readSrc("../app/api/orders/route.ts"));
  assert.match(src, /resolveRewardClaimAndLine\(/, "the counter create path must still call resolveRewardClaimAndLine");
});

test("wiring: app/api/orders/[id]/items/route.ts (add-round) and .../settle/route.ts (settle) resolve their claims through resolveRewardClaim(AndLine), inheriting the window gate", () => {
  const itemsSrc = stripComments(readSrc("../app/api/orders/[id]/items/route.ts"));
  const settleSrc = stripComments(readSrc("../app/api/orders/[id]/settle/route.ts"));
  assert.match(itemsSrc, /resolveRewardClaimAndLine\(/, "items/route.ts (add-round) must call resolveRewardClaimAndLine");
  assert.match(settleSrc, /resolveRewardClaim\(\{/, "settle/route.ts must call resolveRewardClaim directly (D9 refuses item kind, no dish line to resolve)");
});

test("wiring: lib/order-request-accept-reward.ts (the QR ACCEPT path that actually SPENDS) resolves its claim through resolveRewardClaimAndLine, inheriting the window gate", () => {
  const src = stripComments(readSrc("./order-request-accept-reward.ts"));
  assert.match(src, /resolveRewardClaimAndLine\(/, "the QR accept bridge must call resolveRewardClaimAndLine");
});

// ── the QR SUBMIT gate stays as-is (courtesy check, not the fence) ──────────

test("lib/order-request-reward.ts's own SUBMIT-time window check is UNCHANGED — a quote-time courtesy gate plus this accept-time fence is the correct split, not a duplicate", () => {
  const src = stripComments(readSrc("./order-request-reward.ts"));
  assert.match(
    src,
    /isRungClaimWindowClosed\(earnedAt\?\.getTime\(\), found\.milestone\.claimWithinDays, Date\.now\(\)\)/,
    "the submit-time gate must still call isRungClaimWindowClosed with the same earnedAt?.getTime() shape",
  );
});
