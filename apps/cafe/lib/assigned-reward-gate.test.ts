import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { assignedRewardRefusalOf } from "./assigned-reward-gate";
import { stripComments } from "@/lib/source-pin-utils";
import { PROMO_EXPIRED } from "@pos/shared/public-promo";

// CB-5D part 2 DEFECT FIX — assignedRewardRefusalOf is PURE and DB-free (no
// Mongo import), so this suite covers the full decision table with no live
// DB, mirroring reward-redemption.test.ts's own split (decideRedemption is
// tested directly; the Mongo-touching wrapper around it is covered by source
// pins, not a live connection). assignedRewardRefusal (the thin async
// Customer.findOne wrapper) is covered below by a source pin asserting its
// exact-match resolution shape and that it delegates to the SAME pure
// predicate tested here — the DB round-trip itself is a later live-leg's job,
// same as claimRewardStamps/returnRewardStamps.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

const NOW = 1_000_000;
const DAY = 24 * 60 * 60 * 1000;

function reward(code: string, expiresAtMs?: number): { code: string; expiresAt?: Date } {
  return expiresAtMs === undefined ? { code } : { code, expiresAt: new Date(expiresAtMs) };
}

// ── assignedRewardRefusalOf: decision table ─────────────────────────────────

test("assignedRewardRefusalOf: no rewards array at all -> undefined (ordinary Settings code)", () => {
  assert.equal(assignedRewardRefusalOf(undefined, "SAVE10", NOW), undefined);
});

test("assignedRewardRefusalOf: empty rewards array -> undefined", () => {
  assert.equal(assignedRewardRefusalOf([], "SAVE10", NOW), undefined);
});

test("assignedRewardRefusalOf: code not present in rewards -> undefined (THE most important case: an ordinary Settings code must pass)", () => {
  const rewards = [reward("FREECOFFEE", NOW + DAY)];
  assert.equal(assignedRewardRefusalOf(rewards, "SAVE10", NOW), undefined);
});

test("assignedRewardRefusalOf: assigned + unexpired -> undefined", () => {
  const rewards = [reward("FREECOFFEE", NOW + DAY)];
  assert.equal(assignedRewardRefusalOf(rewards, "FREECOFFEE", NOW), undefined);
});

test("assignedRewardRefusalOf: assigned + expired -> PROMO_EXPIRED", () => {
  const rewards = [reward("FREECOFFEE", NOW - DAY)];
  assert.equal(assignedRewardRefusalOf(rewards, "FREECOFFEE", NOW), PROMO_EXPIRED);
});

test("assignedRewardRefusalOf: assigned with NO expiresAt -> undefined (never expires)", () => {
  const rewards = [reward("FREECOFFEE")];
  assert.equal(assignedRewardRefusalOf(rewards, "FREECOFFEE", NOW), undefined);
});

test("assignedRewardRefusalOf: boundary — expiring exactly NOW is still usable (isAssignedRewardExpired's own boundary)", () => {
  const rewards = [reward("FREECOFFEE", NOW)];
  assert.equal(assignedRewardRefusalOf(rewards, "FREECOFFEE", NOW), undefined);
});

test("assignedRewardRefusalOf: two entries, one expired one live -> undefined (any unexpired grant makes the code usable)", () => {
  const rewards = [reward("FREECOFFEE", NOW - DAY), reward("FREECOFFEE", NOW + DAY)];
  assert.equal(assignedRewardRefusalOf(rewards, "FREECOFFEE", NOW), undefined);
});

test("assignedRewardRefusalOf: two entries, BOTH expired -> PROMO_EXPIRED", () => {
  const rewards = [reward("FREECOFFEE", NOW - DAY), reward("FREECOFFEE", NOW - 2 * DAY)];
  assert.equal(assignedRewardRefusalOf(rewards, "FREECOFFEE", NOW), PROMO_EXPIRED);
});

test("assignedRewardRefusalOf: a DIFFERENT code's expiry never leaks onto this one", () => {
  const rewards = [reward("SAVE10", NOW - DAY)];
  assert.equal(assignedRewardRefusalOf(rewards, "FREECOFFEE", NOW), undefined);
});

// ── assignedRewardRefusal (the DB-touching wrapper): shape pins ─────────────
// Mirrors resolveRequestPromo/resolveAcceptPromo's own no-Mongo-wrapper-test
// discipline: the wrapper is one line of glue around a documented, pinned
// resolution shape. Vision-guarded with a positive landmark per the negative-
// pins rule (raw source, not a parsed view).

// RE-POINTED (CB-5D part 2, review-found defect). The ORIGINAL pin here
// asserted an EXACT-match `Customer.findOne({ mobile })` and the ABSENCE of
// canonicalPromoMobile "on the query". Its stated reason was right —
// Customer.mobile is stored AS TYPED, so canonicalising the FILTER would match
// nothing — but the shape it locked in was an EXPIRY BYPASS, live-probed:
// a diner holding an expired assigned code typed `+919876543210` instead of
// `9876543210`, findOne matched nothing, and the `!customer` arm read that as
// "an ordinary Settings code, allow". The code applied at full value.
// The DECISION the old pin protected is preserved below and re-stated: the
// FILTER is still never canonicalised. What changed is that the CANDIDATES are
// widened and identity is then decided canonically in JS.
test("assignedRewardRefusal: matches the customer by ANY SPELLING of the mobile, and still never canonicalises the stored field in the FILTER", () => {
  const src = stripComments(readSrc("./assigned-reward-gate.ts"));
  // Positive landmark: the widened candidate query exists at all.
  assert.match(src, /Customer\.find\(\{\s*\$or:/, "the lookup must widen the candidate spellings via $or");
  // The three Indian-format spellings of one number must all be candidates.
  assert.match(src, /mobile: canonical/, "the bare canonical form must be a candidate");
  assert.match(src, /mobile: `\+91\$\{canonical\}`/, "the +91 form must be a candidate");
  assert.match(src, /mobile: `0\$\{canonical\}`/, "the leading-0 form must be a candidate");
  // The ORIGINAL decision, still enforced: the stored value is compared
  // canonically in JS, never transformed inside the query itself.
  assert.match(
    src,
    /canonicalPromoMobile\(r\.mobile\) === canonical/,
    "identity must be decided by comparing canonical forms in JS — the stored as-typed field is never canonicalised inside the filter",
  );
});

test("assignedRewardRefusal: projects only mobile+rewards (never over-fetches the customer document)", () => {
  const src = stripComments(readSrc("./assigned-reward-gate.ts"));
  // `mobile` joined `rewards` in the projection because identity is now
  // decided from the stored value; it is still a two-field projection.
  assert.match(src, /\.select\("mobile rewards"\)/);
});

test("assignedRewardRefusal: delegates to assignedRewardRefusalOf — the SAME predicate this suite pins above, not a second copy", () => {
  const src = stripComments(readSrc("./assigned-reward-gate.ts"));
  assert.match(
    src,
    /return assignedRewardRefusalOf\(mine\.flatMap\(\(r\) => r\.rewards \?\? \[\]\), code, now\);/,
    "the DB half must still delegate to the one pure predicate — a human split across two rows holds ONE pooled inventory",
  );
});

test("assignedRewardRefusal: no matching customer -> undefined, before the predicate ever runs (the load-bearing walk-in default)", () => {
  const src = stripComments(readSrc("./assigned-reward-gate.ts"));
  assert.match(
    src,
    /if \(mine\.length === 0\) return undefined;/,
    "a code never assigned to anyone is an ORDINARY Settings code and must pass untouched",
  );
});

// The same exact-match flaw existed in the mark-used writer: it silently
// matched nothing when the spelling differed, leaving a SPENT code in the
// diner's list forever (never a double-spend — the PromoRedemption fence is
// canonical — but a code that would always 409).
test("markAssignedRewardUsed: also matches the mobile by ANY SPELLING", () => {
  const src = stripComments(readSrc("./assigned-reward-gate.ts"));
  const fnIdx = src.indexOf("export async function markAssignedRewardUsed");
  assert.ok(fnIdx > -1, "landmark: markAssignedRewardUsed must exist");
  const body = src.slice(fnIdx);
  assert.match(body, /\$or: \[\{ mobile \}/, "the writer must widen spellings the same way the reader does");
  assert.match(body, /usedAt: \{ \$exists: false \}/, "and must still only mark an UNSPENT grant (idempotency)");
});

// ── Call-site wiring: all three consumers actually call the gate ───────────
// Grep-verified reachability (this repo's own rule: a new lib is not done
// until it has a real call site), and that each site places the check AFTER
// its own resolvePromoDiscount/resolveAcceptPromo success — an invalid code
// must still say "invalid", never "expired".

test("wiring: resolveRequestPromo (order-request-create.ts) calls assignedRewardRefusal after resolvePromoDiscount succeeds", () => {
  const src = stripComments(readSrc("./order-request-create.ts"));
  assert.match(
    src,
    /import \{[^}]*assignedRewardRefusal[^}]*\} from "@\/lib\/assigned-reward-gate";/,
    "the gate must be imported from its single home — the brace-list may carry siblings (markAssignedRewardUsed), but assignedRewardRefusal itself must be there",
  );
  const resolvedIdx = src.indexOf('if ("error" in resolved) return { error: resolved.error };');
  const gateIdx = src.indexOf("await assignedRewardRefusal(resolved.code, data.mobile, Date.now());");
  assert.ok(resolvedIdx > -1 && gateIdx > -1, "both anchors must be present");
  assert.ok(gateIdx > resolvedIdx, "the gate must run AFTER the code resolves successfully");
});

test("wiring: resolveEditPromo (order-request-edit.ts) calls assignedRewardRefusal after resolvePromoDiscount succeeds, keyed on the STORED mobile", () => {
  const src = stripComments(readSrc("./order-request-edit.ts"));
  assert.match(
    src,
    /import \{[^}]*assignedRewardRefusal[^}]*\} from "@\/lib\/assigned-reward-gate";/,
    "the gate must be imported from its single home — the brace-list may carry siblings (markAssignedRewardUsed), but assignedRewardRefusal itself must be there",
  );
  const resolvedIdx = src.indexOf('if ("error" in resolved) return { error: resolved.error };');
  const gateIdx = src.indexOf("await assignedRewardRefusal(resolved.code, stored.mobile, Date.now());");
  assert.ok(resolvedIdx > -1 && gateIdx > -1, "both anchors must be present");
  assert.ok(gateIdx > resolvedIdx, "the gate must run AFTER the code resolves successfully");
});

test("wiring: order-request-accept.ts (create/parcel branch) calls assignedRewardRefusal after resolveAcceptPromo succeeds, BEFORE the promo fence is claimed", () => {
  const src = stripComments(readSrc("./order-request-accept.ts"));
  assert.match(
    src,
    /import \{[^}]*assignedRewardRefusal[^}]*\} from "@\/lib\/assigned-reward-gate";/,
    "the gate must be imported from its single home — the brace-list may carry siblings (markAssignedRewardUsed), but assignedRewardRefusal itself must be there",
  );
  const promoIdx = src.indexOf('if ("error" in promo) return guardedReject(requestId, ctx.actor, promo.error);');
  const gateIdx = src.indexOf("await assignedRewardRefusal(request.promoCode, request.mobile, Date.now());");
  const claimIdx = src.indexOf("await claimPromoRedemption(request.promoCode, request.mobile,");
  assert.ok(promoIdx > -1 && gateIdx > -1 && claimIdx > -1, "all three anchors must be present");
  assert.ok(gateIdx > promoIdx, "the gate must run AFTER resolveAcceptPromo succeeds");
  assert.ok(claimIdx > gateIdx, "the gate must run BEFORE the once-per-customer fence is claimed");
});

test("wiring: order-request-accept-addround.ts (add-round branch) calls assignedRewardRefusal after resolveAcceptPromo succeeds, BEFORE the promo fence is claimed", () => {
  const src = stripComments(readSrc("./order-request-accept-addround.ts"));
  assert.match(
    src,
    /import \{[^}]*assignedRewardRefusal[^}]*\} from "@\/lib\/assigned-reward-gate";/,
    "the gate must be imported from its single home — the brace-list may carry siblings (markAssignedRewardUsed), but assignedRewardRefusal itself must be there",
  );
  const promoIdx = src.indexOf('if ("error" in promo) return guardedReject(requestId, ctx.actor, promo.error);');
  const gateIdx = src.indexOf("await assignedRewardRefusal(request.promoCode, request.mobile, Date.now());");
  const claimIdx = src.indexOf("await claimPromoRedemption(request.promoCode, request.mobile,");
  assert.ok(promoIdx > -1 && gateIdx > -1 && claimIdx > -1, "all three anchors must be present");
  assert.ok(gateIdx > promoIdx, "the gate must run AFTER resolveAcceptPromo succeeds");
  assert.ok(claimIdx > gateIdx, "the gate must run BEFORE the once-per-customer fence is claimed");
});

test("wiring (real defect fix): app/api/orders/route.ts (the counter) calls assignedRewardRefusal after resolveAcceptPromo succeeds, BEFORE any fence claim", () => {
  const src = stripComments(readSrc("../app/api/orders/route.ts"));
  assert.match(
    src,
    /import \{[^}]*assignedRewardRefusal[^}]*\} from "@\/lib\/assigned-reward-gate";/,
    "the gate must be imported alongside markAssignedRewardUsed from its single home",
  );
  const promoIdx = src.indexOf('if ("error" in promo) return failure(promo.error, 400);');
  const gateIdx = src.indexOf("await assignedRewardRefusal(data.promoCode, promoMobile, Date.now());");
  const fenceIdx = src.indexOf("if (!(await fencePromoFor(orderId))) {");
  assert.ok(promoIdx > -1 && gateIdx > -1 && fenceIdx > -1, "all three anchors must be present");
  assert.ok(gateIdx > promoIdx, "the gate must run AFTER resolveAcceptPromo succeeds — an invalid/drifted code must still report THAT, never \"expired\"");
  assert.ok(fenceIdx > gateIdx, "the gate must run BEFORE any fence claim — an expired code must be refused before anything is claimed");
});

test("wiring (real defect fix): the counter resolves the promo mobile whenever a customer is attached (not only when oncePerCustomer's fence needs it) — an ASSIGNED code is always attached to a customer", () => {
  const src = stripComments(readSrc("../app/api/orders/route.ts"));
  const promoMobileDeclIdx = src.indexOf("let promoMobile: string | undefined;");
  const gateIdx = src.indexOf("await assignedRewardRefusal(data.promoCode, promoMobile, Date.now());");
  const fenceAssignIdx = src.indexOf("promoFenceMobile = promoMobile;");
  assert.ok(
    promoMobileDeclIdx > -1 && gateIdx > -1 && fenceAssignIdx > -1,
    "the hoisted promoMobile lookup, the expiry gate, and the fence's reuse of it must all be present",
  );
  assert.ok(promoMobileDeclIdx < gateIdx, "promoMobile must be resolved before the expiry gate reads it");
  assert.ok(gateIdx < fenceAssignIdx, "the expiry gate must run before the fence reuses the SAME promoMobile lookup");
});

// ── resolveAcceptPromo itself: NOT made async (owner-flagged constraint) ────
// app/api/orders/route.ts (the counter path, NOT owned by this fix) calls
// resolveAcceptPromo SYNCHRONOUSLY — making it async would require editing
// that file. Pinned here so a future edit that tries to award-ify the
// signature gets caught rather than silently breaking the counter route.

test("resolveAcceptPromo stays SYNCHRONOUS (the counter route app/api/orders/route.ts calls it without await, and is not owned by this fix)", () => {
  const src = stripComments(readSrc("./order-request-accept-promo.ts"));
  assert.match(src, /export function resolveAcceptPromo\(/);
  assert.doesNotMatch(src, /export async function resolveAcceptPromo\(/);
});

// CB-5D part 2 FINAL — REACHABILITY of the counter promo control.
// The server half shipped fully tested while the POS had no field to type a
// code into: compiling, green, and unusable. This repo has paid for that exact
// shape before ("a new hook/route/page is not done until it has a real call
// site"), so the whole chain is pinned, not just the component.
test("wiring: the counter promo code reaches the server — hook state -> payload -> cart props -> rendered control", () => {
  const hook = stripComments(readSrc("../hooks/use-pos-tab.ts"));
  const props = stripComments(readSrc("./pos-cart-props.ts"));
  const cart = stripComments(readSrc("../components/pos/Cart.tsx"));

  // 1. the hook owns the state and SENDS it as intent (omit, never null).
  assert.match(hook, /setPromoCode/, "use-pos-tab must own the promo code state");
  assert.match(
    hook,
    /promoCode: promoCode \?\? undefined,/,
    "buildCreatePayload must send promoCode as OMIT-when-absent — the schema field is .optional(), not nullable, so null would fail validation",
  );
  // 2. it is CLEARED on the same lifecycle edges rewardAt is, or a stale code
  //    rides silently onto the next customer's bill.
  assert.equal(
    (hook.match(/setPromoCode\(null\)/g) ?? []).length,
    (hook.match(/setRewardAt\(null\)/g) ?? []).length,
    "promoCode must be cleared at exactly the same lifecycle points as rewardAt (new sale + resume) — a stale promo on the next bill is a money defect",
  );
  // 3. the props builder BOTH cart mounts share actually forwards it.
  assert.match(props, /promoCode: pos\.promoCode/, "pos-cart-props must forward the promo code to both cart mounts");
  assert.match(props, /onApplyPromo:/, "pos-cart-props must forward the apply handler");
  // 4. and the cart really RENDERS it (a type-only import must not satisfy this).
  // Bounded by what may legally follow the tag name (whitespace, `/`, or
  // `>`): a bare substring needle passed against a RENAMED component
  // (<CartPromoXX), which is a real way for this chain to go dead.
  assert.match(
    cart,
    /<CartPromo[\s/>]/,
    "Cart.tsx must render <CartPromo — without a render call site the whole chain is dead code",
  );
  assert.match(props, /onRemovePromo:/, "pos-cart-props must forward the remove handler too");
});
