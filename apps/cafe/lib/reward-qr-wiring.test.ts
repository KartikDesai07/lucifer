import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";
import { resolveAddRoundKind } from "./order-request-accept-addround";

// CB-5B S7 + S8 — the QR/diner money path's own pins. Kept out of
// reward-wiring.test.ts (732 lines, at the budget) as its own file: these
// cover the PUBLIC ordering surface, where the caller is an unauthenticated
// phone rather than a staff session.
//
// Pin discipline this file follows throughout (the documented local lessons):
//  - an ordering pin needs an UPPER BOUND and an occurrence COUNT, never just
//    a relative comparison — relative order alone passes dead code AND
//    duplicates;
//  - an absence claim bars a SHAPE, not a NAME (a hand-rolled equivalent
//    slips past a list of literal names);
//  - every absence assert is paired with a POSITIVE landmark, so it can never
//    pass vacuously against an empty, renamed, or moved file.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, "..", rel), "utf8");

const ADDROUND = "lib/order-request-accept-addround.ts";
const ACCEPT = "lib/order-request-accept.ts";
const ACCEPT_REWARD = "lib/order-request-accept-reward.ts";
const ACCEPT_WRITE = "lib/order-request-accept-write.ts";
const REQUEST_REWARD = "lib/order-request-reward.ts";
const PUBLIC_ROUTE = "app/api/public/order-request/route.ts";
const INTAKE = "lib/order-request-intake.ts";
const ORDER_REQUEST_MODEL = "models/OrderRequest.ts";

function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `expected to find ${label} (searched for ${JSON.stringify(needle)})`);
  return idx;
}

function countOf(src: string, re: RegExp): number {
  return (src.match(re) ?? []).length;
}

// ── S7 · resolveAddRoundKind — the three-kind decision table ────────────────

test("S7: resolveAddRoundKind keeps a reward tab's kind when no promo applies — the QR reward-drop bug", () => {
  // THE BUG THIS PINS: the shipped `keepGstKind` knew only "gst", so a
  // "reward" tab fell through to undefined — the kind was $unset and the tab
  // re-billed at FULL price while the diner's stamps stayed spent.
  assert.equal(resolveAddRoundKind("reward", 0, false), "reward");
});

test("S7: resolveAddRoundKind REFUSES a promo onto a reward tab (A2/D6 mutual exclusion)", () => {
  assert.equal(resolveAddRoundKind("reward", 1, true), "conflict");
  assert.equal(resolveAddRoundKind("reward", 500, true), "conflict");
});

test("CB-5D: a 0-VALUE item promo onto a reward tab is still a CONFLICT (the amount-keyed fence missed it)", () => {
  // THE BUG THIS PINS: PROMO_KINDS gained "item", whose money value is 0 BY
  // CONSTRUCTION (the benefit is the free LINE, not rupees off). The fence used
  // to key on `promoDiscount > 0`, so a free-item promo read as "no promo at
  // all" and composed onto a reward-carrying tab — the exact pair D6 exists to
  // keep apart, and the diner would get a reward AND a free dish.
  assert.equal(resolveAddRoundKind("reward", 0, true), "conflict");
  // The complement still holds: no code present means no conflict, so a reward
  // tab with no promo keeps its kind (the QR reward-drop bug stays closed).
  assert.equal(resolveAddRoundKind("reward", 0, false), "reward");
});

test("CB-5D: the gst arm stays AMOUNT-keyed — a 0-value item promo COMPOSES with a gst tab", () => {
  // Deliberately NOT widened: gst and a free-item promo are not a mutually
  // exclusive pair, so refusing them together would break a legal combination.
  assert.equal(resolveAddRoundKind("gst", 0, true), "gst");
});

test("S7: resolveAddRoundKind preserves the shipped gst behaviour byte-for-byte", () => {
  // The C5 meaning, unchanged by the widening: gst alone survives; gst + a
  // promo collapses to one plain manual discount the receipt labels "Discount".
  assert.equal(resolveAddRoundKind("gst", 0, false), "gst");
  assert.equal(resolveAddRoundKind("gst", 1, true), undefined);
  assert.equal(resolveAddRoundKind("gst", 250, true), undefined);
});

test("S7: resolveAddRoundKind never ORIGINATES a kind on a tab that carries none", () => {
  // A diner add-round may PRESERVE a staff kind, never invent one.
  assert.equal(resolveAddRoundKind(undefined, 0, false), undefined);
  assert.equal(resolveAddRoundKind(undefined, 100, true), undefined);
});

test("S7: the add-round branch prices a reward tab from the ORDER SNAPSHOT, not the live ladder", () => {
  const src = stripComments(readSrc(ADDROUND));
  assert.match(src, /export async function acceptAddRoundBranch/, "landmark: the branch must live here");
  // rewardFromOrderSnapshot is the ONLY sanctioned rebuild: it reads the five
  // fields stored on the Order, so an owner retuning a rung mid-service cannot
  // re-price an already-issued reward.
  assert.match(
    src,
    /rewardFromOrderSnapshot\(openTab\)/,
    "the add-round branch must rebuild the reward from the Order's own snapshot",
  );
  assert.equal(
    countOf(src, /rewardFromOrderSnapshot\(/g),
    1,
    "exactly ONE rebuild — a second call site means two sources of truth for one bill's reward",
  );
  // SHAPE-based absence (never a list of names): nothing here may re-read the
  // live loyalty ladder to price an issued reward.
  assert.ok(
    !/resolveLoyaltyConfig|ladderOf|loyaltyRules\s*[?.]/.test(src),
    "the add-round branch must never re-read the live loyalty ladder — an issued reward prices from its stored snapshot",
  );
});

test("S7: a reward round never carries the stored discount scalar in as a manual figure (double-count fence)", () => {
  const src = stripComments(readSrc(ADDROUND));
  assert.match(src, /const totals = computeOrderTotals\(\{/, "landmark: the branch must compute totals");
  // The reward branch passes 0 and lets rewardDiscountAmount derive; every
  // other kind keeps the shipped composition. Carrying openTab.discount in on
  // the reward arm would count the reward twice.
  assert.match(
    src,
    /resolvedKind === "reward"\s*\n?\s*\?\s*0/,
    "the reward arm must pass discount 0 and let the server re-derive from the snapshot",
  );
});

test("S7: the kind-removal gate goes through shouldStoreDiscountKind, so a Rs 0 item reward keeps its provenance", () => {
  const src = stripComments(readSrc(ADDROUND));
  assert.match(
    src,
    /!shouldStoreDiscountKind\(totals\.discount,\s*resolvedKind\)/,
    "the $unset gate must call the shared amount-gates-kind predicate",
  );
  // THE BUG THIS BARS, by SHAPE not by name: an amount-only gate. An item
  // reward's derived amount is Rs 0 by construction, so `totals.discount > 0`
  // as the gate would $unset the kind on exactly the orders that spent stamps.
  const gateLine = src.match(/if \(openTab\.discountKind !== undefined[^\n]*\n?[^\n]*/)?.[0] ?? "";
  assert.ok(gateLine.length > 0, "landmark: the discountKind $unset gate must be found");
  assert.ok(
    !/totals\.discount\s*>\s*0/.test(gateLine),
    "the kind-removal gate must not be keyed on the discount AMOUNT — an item reward is worth Rs 0 and would lose its snapshot",
  );
});

test("S7: the A2 conflict refusal runs BEFORE the promo fence claim and before the write (bounded + counted)", () => {
  const src = stripComments(readSrc(ADDROUND));
  const conflictIdx = mustIndexOf(src, "REWARD_PROMO_CONFLICT_ERROR", "the A2 conflict refusal");
  const fenceIdx = mustIndexOf(src, "claimPromoRedemption(", "the promo fence claim");
  const writeIdx = mustIndexOf(src, "applyAddRound(openTab, update", "the add-round write");
  // A rejected request must never claim a once-per-customer fence it will not
  // use, and must never reach the write at all.
  assert.ok(conflictIdx < fenceIdx, "the conflict refusal must precede claimPromoRedemption");
  assert.ok(fenceIdx < writeIdx, "claimPromoRedemption must precede the write (SPEC P4, unchanged)");
  // UPPER BOUND + COUNT, not just relative order: without these, moving the
  // whole block below the write — dead code — still passes a relative pin.
  assert.equal(
    countOf(src, /REWARD_PROMO_CONFLICT_ERROR/g),
    2,
    "REWARD_PROMO_CONFLICT_ERROR must appear exactly twice: its declaration and its ONE use",
  );
  assert.equal(countOf(src, /applyAddRound\(openTab, update/g), 1, "exactly one add-round write");
});

// ── S8 · the diner-originated claim ────────────────────────────────────────

test("S8: the public submit gate REQUIRES a diner session — the body's mobile is never an identity", () => {
  const src = stripComments(readSrc(REQUEST_REWARD));
  assert.match(src, /export async function resolveRequestReward/, "landmark: the gate must live here");
  assert.match(src, /await readDinerSession\(\)/, "a reward claim must resolve the diner's own session");
  assert.match(
    src,
    /if \(!session\) return \{ error: REWARD_NEEDS_SIGN_IN \}/,
    "no session must refuse the claim outright — an anonymous QR order can never spend stamps",
  );
  // THE ATTACK THIS BARS, by SHAPE: spending a stranger's stamps by typing
  // their number. The balance must be read from the SESSION's customerId,
  // never from anything the body carried.
  assert.match(
    src,
    /Customer\.findById\(session\.customerId\)/,
    "the balance must be read from the SESSION's own customerId",
  );
  assert.ok(
    !/findOne\(\s*\{\s*mobile/.test(src),
    "the gate must never look a customer up by a body-supplied mobile — that would let anyone spend a stranger's stamps",
  );
});

test("S8: reward and promo are mutually exclusive from the SUBMIT side too (reciprocal guard)", () => {
  const src = stripComments(readSrc(REQUEST_REWARD));
  assert.match(
    src,
    /if \(data\.promoCode\) return \{ error: REWARD_PROMO_EXCLUSIVE \}/,
    "a reward claim arriving with a promo code must be refused at submit",
  );
  // The reciprocal half lives in the add-round branch. Both directions must
  // exist, or the pair only holds from one side.
  const addRoundSrc = stripComments(readSrc(ADDROUND));
  assert.match(
    addRoundSrc,
    /resolvedKind === "conflict"/,
    "the reciprocal fence (a promo arriving onto a reward tab) must exist in the accept path",
  );
});

test("S8: the claim happens at ACCEPT, never at request-submit — a rejected request costs no stamps", () => {
  const submitSrc = stripComments(readSrc(REQUEST_REWARD));
  // SHAPE-based absence: no spend of any form may happen on the submit path.
  assert.match(submitSrc, /decideRedemption\(/, "landmark: the submit gate does resolve affordability");
  assert.ok(
    !/claimRewardStamps|\$inc[^\n]*stamps|updateOne|findOneAndUpdate|findByIdAndUpdate/.test(submitSrc),
    "the submit-time gate must never WRITE — a request is pre-money and a rejected one must cost no stamps",
  );
  // And the accept path is where the spend actually is.
  const acceptSrc = stripComments(readSrc(ACCEPT));
  assert.match(acceptSrc, /claimAcceptReward\(rewardResolution, firstOrderId\)/, "the accept must spend the stamps");
});

test("S8: the accept claims BEFORE Order.create, and re-keys the claim when the order is re-numbered", () => {
  const src = stripComments(readSrc(ACCEPT));
  const claimIdx = mustIndexOf(src, "claimAcceptReward(rewardResolution, firstOrderId)", "the pre-create claim");
  const createIdx = mustIndexOf(src, "Order.create({ ...doc, orderId: firstOrderId })", "the create call");
  assert.ok(claimIdx < createIdx, "the stamps must be spent BEFORE the order is written");
  // THE ORPHAN BUG THIS BARS: recoverOrderCreate RE-NUMBERS the order, so a
  // claim left on the first id sits where no order carries it — unrefundable
  // by the cancel path, and no longer fencing the real order.
  assert.match(src, /onRekey:/, "the recovery must be handed a re-key callback");
  assert.match(
    src,
    /await returnAcceptReward\(rewardResolution, firstOrderId\);\s*\n?\s*return claimAcceptReward\(rewardResolution, retryOrderId\)/,
    "the re-key must hand back the first id's claim and re-claim against the RE-NUMBERED order",
  );
  // COUNT: exactly one pre-create claim. A duplicate would spend twice.
  assert.equal(
    countOf(src, /claimAcceptReward\(/g),
    2,
    "claimAcceptReward must appear exactly twice: the first attempt and the re-key",
  );
});

test("S8: only a DEFINITE no-write reverses a claim (never-revert-on-write-throw, directional)", () => {
  const src = stripComments(readSrc(ACCEPT_WRITE));
  assert.match(src, /export async function recoverOrderCreate/, "landmark: recoverOrderCreate must live here");
  // The function rethrows anything that is not a duplicate key BEFORE the
  // re-key can run, so onRekey is reachable only on a server-proved no-write.
  const fnStart = mustIndexOf(src, "export async function recoverOrderCreate", "recoverOrderCreate");
  const body = src.slice(fnStart);
  const rethrowIdx = mustIndexOf(body, "if (!isDuplicateKeyError(e)) throw e;", "the non-dup-key rethrow");
  const rekeyIdx = mustIndexOf(body, "hooks.onRekey(", "the re-key call");
  assert.ok(
    rethrowIdx < rekeyIdx,
    "a non-duplicate-key throw must rethrow BEFORE any compensating re-key — it may accompany an insert that COMMITTED",
  );
  // The re-key must precede the retry insert: the claim has to already sit on
  // the number the order is about to carry.
  const retryIdx = mustIndexOf(body, "Order.create({ ...doc, orderId: retryOrderId })", "the retry insert");
  assert.ok(rekeyIdx < retryIdx, "the re-key must run BEFORE the retry insert");
});

test("S8: a resolved-but-unspendable claim REJECTS — it never writes a discounted bill nothing funded", () => {
  const src = stripComments(readSrc(ACCEPT));
  assert.equal(
    countOf(src, /REWARD_UNFUNDED_ERROR/g),
    3,
    "REWARD_UNFUNDED_ERROR must appear exactly 3 times: the import and BOTH failure arms (first attempt + re-key)",
  );
  // Bounded: both refusals must precede the order actually being finalized, or
  // they are dead code that still passes a relative ordering pin.
  const finalizeIdx = mustIndexOf(src, "return finalizeAccept(order, requestId, ctx.actor, false)", "the success return");
  const lastRefusal = src.lastIndexOf("REWARD_UNFUNDED_ERROR");
  assert.ok(lastRefusal < finalizeIdx, "every unfunded refusal must sit ABOVE the success return, never below it");
});

test("S8: the stored request carries INTENT ONLY — never an amount, kind, or dish", () => {
  const model = stripComments(readSrc(ORDER_REQUEST_MODEL));
  assert.match(model, /requestedRewardAt\?: number;/, "the interface must carry the intent");
  assert.match(model, /requestedRewardAt: \{ type: Number \}/, "the schema path must exist (or strict:true drops it)");
  // THE MONEY FENCE, by SHAPE: no reward VALUE/KIND/DISH may ever be storable
  // from a diner submission.
  assert.ok(
    !/requestedRewardValue|requestedRewardKind|requestedRewardItem|quotedRewardDiscount/.test(model),
    "an OrderRequest must never carry a reward amount, kind or dish — a client that could send one could grant itself an unfunded discount",
  );
  const intake = stripComments(readSrc(INTAKE));
  assert.match(
    intake,
    /if \(requestedRewardAt !== undefined\) doc\.requestedRewardAt = requestedRewardAt;/,
    "the builder must carry the intent onto the draft, omit-empty",
  );
  // The intent must NOT move the quote: a quote that changed because of a
  // reward would be one the server could not re-verify when it spends.
  const quoteFn = intake.slice(
    mustIndexOf(intake, "export function quoteRequestTotals", "quoteRequestTotals"),
    mustIndexOf(intake, "export function buildRequestDoc", "buildRequestDoc"),
  );
  assert.ok(
    !/reward/i.test(quoteFn),
    "quoteRequestTotals must never see a reward — the quote is the pre-reward bill the drift fence re-verifies",
  );
});

test("S8: the public route refunds the metered slot on every reward 422 (own-fact, not an oracle)", () => {
  const src = stripComments(readSrc(PUBLIC_ROUTE));
  assert.match(src, /const reward = await resolveRequestReward\(/, "landmark: the route must run the reward gate");
  assert.match(
    src,
    /if \("error" in reward\) \{\s*\n?[^}]*await refundRateLimit\(bucket, now\);\s*\n?\s*return noStore\(failure\(reward\.error, 422\)\)/,
    "a reward refusal must refund the slot and answer 422 — every reason is the caller's OWN fact, not a cross-customer oracle",
  );
  // The PROMO rule must stay exactly as shipped: the usage oracle stays metered.
  assert.match(
    src,
    /if \(promo\.error !== PROMO_ALREADY_USED\) await refundRateLimit\(bucket, now\)/,
    "the promo metering rule must be unchanged",
  );
});

test("S8: the honeypot answers a reward refusal the same way the real path does (no one-probe tell)", () => {
  const src = stripComments(readSrc("lib/order-request-create.ts"));
  assert.match(src, /export async function buildHoneypotResponse/, "landmark: the mimic must live here");
  const mimicStart = mustIndexOf(src, "export async function buildHoneypotResponse", "buildHoneypotResponse");
  const mimic = src.slice(mimicStart);
  assert.match(mimic, /resolveRequestReward\(/, "the honeypot must run the same reward gate");
  assert.match(
    mimic,
    /if \("error" in reward\) return \{ promoError: reward\.error \}/,
    "a rejected reward must surface as the same 422 the real path returns — otherwise a filled hp is one probe away from being told apart",
  );
});

test("S8: the D4 policy comment states the NEW policy and still fences the GST preset", () => {
  // A behaviour change whose comment asserts the old fence is a trap for the
  // next reader. Read from the RAW source (comments intact), scoped to the
  // create branch's own totals block.
  const raw = readSrc(ACCEPT);
  assert.match(raw, /CB-5B D4/, "the comment must name the owner decision that changed the policy");
  assert.match(
    raw,
    /"gst" preset stays STAFF-ONLY/,
    "the comment must still state that the GST preset remains staff-only",
  );
  assert.match(
    raw,
    /REWARD claim, by contrast, IS diner-originatable by design/,
    "the comment must state the NEW policy: a reward claim IS diner-originatable",
  );
  // The OLD sentence must be gone — a stale absolute claim beside the new
  // behaviour is exactly the trap this pin exists for.
  assert.ok(
    !/the kind is\s*\n?\s*\/\/ staff-only intent, so this stays `undefined` unconditionally/.test(raw),
    "the superseded 'stays undefined unconditionally' sentence must be gone",
  );
});

test("S8: the accept-side claim routes through the ONE shared claim lib, never its own copy", () => {
  const src = stripComments(readSrc(ACCEPT_REWARD));
  assert.match(src, /from "@\/lib\/reward-claim"/, "landmark: the claim must come from the shared lib");
  // SHAPE-based absence: no hand-rolled stamp arithmetic anywhere on this path.
  assert.ok(
    !/\$inc[^\n]*stamps|stamps:\s*\{\s*\$gte|updateOne\(|findOneAndUpdate\(/.test(src),
    "the QR claim must never hand-roll a stamp write — the fence lives in reward-redemption.ts exactly once",
  );
  // And the earn side must stay untouchable from here.
  assert.ok(
    !/stampsLifetime/.test(src),
    "the redemption path must never touch stampsLifetime (earn-side is unchanged — D2)",
  );
});

test("S8: the diner-facing reward copy is SINGLE-HOMED — server and client compare the same strings", () => {
  // THE DRIFT THIS BARS: the client reverts a rejected reward selection by
  // EXACT-STRING-matching the 422 it got back. Two hand-copied sets of the
  // same money-path copy means a reworded server message silently stops the
  // cart reverting — the diner keeps a selection the server already refused.
  const server = stripComments(readSrc(REQUEST_REWARD));
  const client = stripComments(readSrc("components/public/public-submit.ts"));
  for (const [label, src] of [["the server gate", server], ["the client classifier", client]] as const) {
    assert.match(
      src,
      /REWARD_NEEDS_SIGN_IN[\s\S]*?from "@pos\/shared\/public"/,
      `${label} must IMPORT the reward copy from @pos/shared/public, never re-declare it`,
    );
    // SHAPE-based absence: no local re-declaration of any of them.
    assert.ok(
      !/const REWARD_(NEEDS_SIGN_IN|NOT_ON_CARD|NOT_ENOUGH_STAMPS|BILL_TOO_SMALL|PROMO_EXCLUSIVE)\s*=/.test(src),
      `${label} must not re-declare the shared reward copy — one home, two importers`,
    );
  }
});

test("S8 SECURITY: the submit gate binds the claim to the SESSION's own mobile — a diner cannot spend a stranger's stamps", () => {
  // THE DEFECT THIS PINS (found in review of this slice, fixed here):
  // the gate validated the balance on `session.customerId`, but the ACCEPT
  // bridge attaches the order's customer by looking up `request.mobile`
  // (order-request-accept.ts step 5) — a body-supplied, UNAUTHENTICATED
  // value. A signed-in diner submitting a STRANGER'S mobile therefore passed
  // this gate against their OWN balance and then spent the stranger's stamps.
  // The two identities must be the same person or the claim is refused.
  const src = stripComments(readSrc(REQUEST_REWARD));
  assert.match(src, /await readDinerSession\(\)/, "landmark: the gate must still read the session");
  assert.match(
    src,
    /canonicalPromoMobile\(data\.mobile\) !== canonicalPromoMobile\(session\.mobile\)/,
    "the submitted mobile must be compared against the SESSION's own, canonicalised on BOTH sides",
  );
  // Ordering: the binding must gate the BALANCE READ, not merely sit in the
  // file — an identity check below the spend decision is decoration.
  const bindIdx = mustIndexOf(src, "canonicalPromoMobile(data.mobile)", "the identity binding");
  const balanceIdx = mustIndexOf(src, "Customer.findById(session.customerId)", "the balance read");
  const decideIdx = mustIndexOf(src, "decideRedemption(", "the affordability decision");
  assert.ok(bindIdx < balanceIdx, "the identity binding must run BEFORE the balance is read");
  assert.ok(balanceIdx < decideIdx, "the balance read must precede the decision");
});

test("S7 ARBITRATED: a stored 'reward' kind can never carry a partial snapshot — the three load-bearing fields are REQUIRED by type", () => {
  // ARBITRATION RECORD (review of this slice, finding 1 — REFUTED as a live
  // defect, PINNED as the invariant it rests on). The review argued that a tab
  // with discountKind:"reward" but a missing rewardValue would re-price at
  // FULL price, because rewardFromOrderSnapshot fails closed to undefined and
  // rewardDiscountAmount then derives Rs 0.
  //
  // The re-pricing behaviour is real. The REACHABILITY is not: every writer of
  // discountKind:"reward" pairs it with rewardSnapshotFields, and that
  // function reads `at`/`kind`/`value` off a RedeemedReward where all three
  // are REQUIRED (packages/shared/src/reward-redemption.ts) — so the type
  // checker, not a convention, is what guarantees the snapshot is complete.
  // This pins exactly that guarantee, because it is the only thing standing
  // between the shipped code and the reviewer's scenario.
  const shared = stripComments(readSrc("../../packages/shared/src/reward-redemption.ts"));
  const iface = shared.slice(
    mustIndexOf(shared, "export interface RedeemedReward {", "the RedeemedReward interface"),
    mustIndexOf(shared, "export function redemptionSnapshotOf", "the snapshot builder"),
  );
  for (const field of ["at: number;", "kind: LoyaltyRewardKind;", "value: number;"]) {
    assert.ok(
      iface.includes(field),
      `RedeemedReward.${field.split(":")[0]} must stay REQUIRED — making it optional lets a writer store a reward kind with a partial snapshot, which re-prices the tab at full price while the stamps stay spent`,
    );
  }
  // And the builder must write all three unconditionally (never omit-empty):
  // the omit-empty discipline applies to the DISH fields only.
  const claimSrc = stripComments(readSrc("lib/reward-claim.ts"));
  const builder = claimSrc.slice(
    mustIndexOf(claimSrc, "export function rewardSnapshotFields", "rewardSnapshotFields"),
    mustIndexOf(claimSrc, "export { claimRewardStamps", "the re-export that closes the builder"),
  );
  // Anchored to the start of the property (after `{` or a newline+indent), so
  // wrapping the write in a conditional spread — `...(x ? { rewardValue: ... }`
  // — no longer satisfies it. A bare includes() passes that mutant, because
  // the conditional form still CONTAINS the same substring (verified by
  // mutation: it escaped before this anchoring was added).
  // Anchored on the ENCLOSING BRACE/COMMA structure, not a bare includes():
  // wrapping a write in a conditional spread — `...(x ? { rewardValue: ... })`
  // — still CONTAINS the plain substring, so includes() passes that mutant
  // (verified: it escaped before this was tightened). Requiring the property
  // to be preceded by `{` or `,` and NOT by `? {` is what separates the two.
  for (const key of ["rewardAt", "rewardKind", "rewardValue"]) {
    const plain = new RegExp("[{,]\\s*" + key + ":\\s*reward\\.");
    assert.match(
      builder,
      plain,
      `rewardSnapshotFields must write ${key} from the reward`,
    );
    const conditional = new RegExp("\\?\\s*\\{\\s*" + key + ":");
    assert.ok(
      !conditional.test(builder),
      `rewardSnapshotFields must write ${key} UNCONDITIONALLY — a conditional spread lets a reward kind store a PARTIAL snapshot, which re-prices the tab at full price while the stamps stay spent`,
    );
  }
});

test("S8 REVIEW-CONFIRMED: a reward claim onto a table with a RUNNING BILL is refused at submit, not silently dropped at accept", () => {
  // THE DEFECT THIS PINS (found by adversarial review of this slice, fixed
  // here). resolveAcceptReward is reached ONLY on the accept bridge's
  // create/parcel branch; the ADD-ROUND branch never reads requestedRewardAt
  // (it re-derives the tab's existing reward from the Order snapshot, which is
  // correct — an Order carries ONE scalar and ONE kind). So a diner ordering
  // onto a table that already has a bill running was shown "Reward selected —
  // applied when the cafe accepts this order", had the claim silently
  // dropped, and was billed FULL price with no message to anyone.
  const src = stripComments(readSrc(REQUEST_REWARD));
  assert.match(src, /hasOpenTabNow\(/, "the gate must consult the ONE shared open-tab predicate");
  assert.match(
    src,
    /return \{ error: REWARD_ON_OPEN_TAB \}/,
    "a claim that would land on an add-round must be REFUSED at submit, while the diner can still be told",
  );
  // The add-round branch genuinely does not read the intent — pinned so the
  // refusal above cannot later be "fixed" by half-wiring the other side.
  const addRoundSrc = stripComments(readSrc(ADDROUND));
  assert.match(addRoundSrc, /export async function acceptAddRoundBranch/, "landmark");
  assert.ok(
    !/requestedRewardAt/.test(addRoundSrc),
    "the add-round branch must NOT claim a second reward onto a tab — refuse at submit instead",
  );
});

test("S8 REVIEW-CONFIRMED: an ambiguous create throw RESOLVES whether an order landed before leaving stamps spent", () => {
  // THE DEFECT THIS PINS (adversarial review of this slice; two HIGH findings,
  // one root cause). The claim marker is keyed on the ORDER ID, but this
  // bridge is RE-ENTERABLE and nextOrderSequence burns a fresh number per
  // attempt — so stamps spent against an orderId no order carries are
  // unreachable by EVERY recovery path: the resumed accept re-claims under a
  // new id (two spends, one order), and a staff reject of the stranded
  // "accepting" row returns nothing (reject() knows only the requestId).
  //
  // The fix does not weaken never-revert-on-write-throw — it RESOLVES the
  // ambiguity the rule is about, by asking the DB whether any order carries
  // this requestId, and reverses only when the answer is definitively "none".
  const src = stripComments(readSrc(ACCEPT));
  assert.match(src, /catch \(fatal\)/, "landmark: the ambiguous-throw arm must exist");
  assert.match(
    src,
    /if \(!landed\) await returnAcceptReward\(rewardResolution, firstOrderId\)/,
    "the return must fire ONLY when no order carries this requestId — a definite no-write",
  );
  assert.match(
    src,
    /const landed = await findByRequestId\(requestId\)/,
    "the landed-order question must be asked of the DB, never assumed",
  );
  assert.match(src, /throw fatal;/, "the ambiguous throw must still propagate — it is not swallowed");
  // The resolving read must itself be swallowed: if IT throws, the claim
  // STAYS. Returning stamps for an order that DID land is a double-spend, so
  // "keep the claim" is the safe side of an unresolvable ambiguity.
  const arm = src.slice(mustIndexOf(src, "catch (fatal)", "the ambiguous arm"));
  const guardIdx = mustIndexOf(arm, "findByRequestId(requestId)", "the resolving read");
  const swallowIdx = arm.indexOf("catch {", guardIdx);
  assert.ok(swallowIdx > guardIdx, "the resolving read must be wrapped in its own swallowing catch");
  assert.ok(
    swallowIdx < mustIndexOf(arm, "throw fatal;", "the rethrow"),
    "that swallow must close BEFORE the rethrow — it must not swallow the original error",
  );
});
