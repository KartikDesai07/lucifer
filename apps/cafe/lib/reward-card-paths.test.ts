import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";
import { resolveCreateReward } from "./order-create-reward";
import { resolveRoundReward, type ResolveRoundRewardArgs } from "./order-round-reward";
import { resolveSettleReward, type ResolveSettleRewardArgs } from "./settle-reward";
import { PROMO_BLOCKS_REWARD } from "@pos/shared/public-promo";
import { CARD_REWARD_EXCLUSIVE, ONE_REWARD_PER_BILL } from "@pos/shared/reward-card-use";

// CB-7 S5 slice C — pins for the staff order writers that spend a revealed scratch card and honour the P2 promo
// marker / O2 refusal: create, add-round, settle, cancel and PUT. Source pins (stripComments + ordered needles, the
// repo's discipline) for the claim-before-CAS / release-only-on-a-definite-miss shapes and the fence wiring, plus
// DB-free behavioural legs for the three resolve libs' refusals (every one answers BEFORE any read or claim).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..");
const read = (rel: string) => stripComments(readFileSync(path.join(APP, rel), "utf8").replace(/\r\n/g, "\n"));
const CREATE = "app/api/orders/route.ts";
const ITEMS = "app/api/orders/[id]/items/route.ts";
const SETTLE = "app/api/orders/[id]/settle/route.ts";
const CANCEL = "app/api/orders/[id]/cancel/route.ts";
const PUT = "app/api/orders/[id]/route.ts";

function at(src: string, needle: string, label: string, from = 0): number {
  const idx = src.indexOf(needle, from);
  assert.ok(idx !== -1, `expected to find ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
}
const count = (src: string, needle: string): number => src.split(needle).length - 1;
// The text from `start` to the first `end` after it.
function span(src: string, start: string, end: string, label: string): string {
  const from = at(src, start, label);
  return src.slice(from, at(src, end, `the end of ${label}`, from));
}

// ── Create ───────────────────────────────────────────────────────────────────

test("PIN (create lib): both intents refuse before anything is read; the card resolves against the plain bill, free dish allowed, round 1", () => {
  const src = read("lib/order-create-reward.ts");
  const both = at(src, "return { ok: false, message: CARD_REWARD_EXCLUSIVE };", "the both-intents refusal");
  const resolve = at(src, "resolveCardClaim({", "the card resolve");
  assert.ok(both < resolve, "the exclusivity refusal precedes every card read");
  const call = src.slice(resolve, at(src, "});", "the call's end", resolve));
  assert.match(call, /billTotal,/, "the gate reads the plain bill passed in (pre-reward, like the stamps)");
  assert.match(call, /items,/, "the scoped-card gate reads the request lines");
  assert.match(call, /refuseItemKind: false/, "a free-dish card IS allowed at order-taking");
  assert.match(call, /kotRound: 1/, "a dish line is stamped round 1");
  assert.ok(src.includes('effectiveDiscountKind = "reward";'), "a card replaces the discount kind");
  assert.equal(count(src, "rewardSnapshotFields"), 0, "the card branch never builds the stamp snapshot (no rewardAt / rewardStamps)");
});

test("PIN (create route): card claim sits before Order.create; release only in unclaimFor (the definite no-write points); doc carries the card snapshot + marker", () => {
  const src = read(CREATE);
  const claimCall = at(src, "if (!(await claimFor(orderId))) {", "the first claim call site");
  assert.ok(claimCall < at(src, "Order.create({ ...doc, orderId });", "the insert"), "the claim precedes the insert");
  const claimFor = span(src, "const claimFor = async", "const unclaimFor =", "claimFor");
  assert.match(claimFor, /resolvedCard\s*\?\s*claimRewardCard\(customerId!, resolvedCard\.id, oid, resolvedCard\.now\)/, "claimFor claims the card with the ONE captured clock reading");
  assert.ok(!/new Date\(/.test(claimFor), "no fresh clock inside the closure (the retry re-claim must reuse the first reading)");
  const unclaimFor = span(src, "const unclaimFor =", "};", "unclaimFor");
  assert.ok(unclaimFor.includes("releaseRewardCard(customerId!, resolvedCard.id, oid)"), "unclaimFor releases the card against the SAME orderId it claimed for");
  assert.equal(count(src, "releaseRewardCard("), 1, "the card is released from exactly one place: unclaimFor (slip failure, E11000, renumber retry)");
  assert.equal(count(src, "claimRewardCard("), 1, "and claimed from exactly one place: claimFor");
  const doc = span(src, "const unnumberedDoc = {", "const claimFor = async", "the doc literal");
  assert.ok(doc.includes("...(resolvedCard ? cardSnapshotFields(resolvedCard.reward) : {}),"), "a card order stores the card snapshot");
  assert.ok(!/rewardCardId|rewardAt\s*:|rewardStamps/.test(doc), "the doc never names rewardAt / rewardStamps (a card never writes them)");
  assert.ok(
    doc.includes("...promoMarkerFields(promoIsClaimable(promoDiscount, data.promoCode, promoKind) ? data.promoCode : undefined),"),
    "the P2 marker is written through promoMarkerFields, only when the SAME predicate that burns the fence row says so",
  );
  assert.match(src, /if \(resolvedCard\) return failure\(PROMO_BLOCKS_REWARD, 400\);/, "a card plus a promo code is refused 400");
  assert.ok(src.includes('const claimMiss = resolvedCard ? CARD_NOT_USABLE : "Not enough stamps for that reward";'), "a card miss answers CARD_NOT_USABLE; the stamps copy is unchanged");
  assert.ok(src.includes("reward: rewardForTotals,"), "totals price with the card's reward");
});

// ── Add-round + settle ───────────────────────────────────────────────────────

for (const [name, rel, kind] of [
  ["items", ITEMS, "parsed.data.discountKind"],
  ["settle", SETTLE, "data.discountKind"],
] as const) {
  test(`PIN (${name}): O2 sits right after the P4 refusal and before any claim / CAS; the card claim precedes the CAS`, () => {
    const src = read(rel);
    const p4 = at(src, `rewardBlocksDiscountKind(${kind}, old.discountKind)`, "the P4 refusal");
    const o2 = at(src, `promoBlocksDiscountKind(${kind}, old.promoCode, old.discountKind)`, "the O2 refusal");
    assert.ok(o2 > p4, "O2 sits beside (after) the P4 refusal");
    assert.match(src.slice(o2, o2 + 180), /return failure\(PROMO_BLOCKS_GST_DISCOUNT_MESSAGE, 409\)/, "O2 answers 409 with the promo copy");
    const resolve = at(src, name === "items" ? "resolveRoundReward(" : "resolveSettleReward(", "the resolve call");
    const claim = at(src, "claimRewardCard(", "the card claim");
    const cas = at(src, "Order.findOneAndUpdate(", "the CAS");
    assert.ok(o2 < resolve && o2 < claim && o2 < cas, "a refused request resolves, claims and writes nothing");
    assert.ok(claim < cas, "the card is claimed BEFORE the CAS write");
    assert.equal(count(src, "claimRewardCard("), 1);
    assert.match(src, /import \{[^}]*promoBlocksDiscountKind[^}]*\} from "@\/lib\/receipt"/, "O2's predicate comes from the one module that owns it");
  });

  test(`PIN (${name}): the claiming CAS filter spreads rewardClaimOrderFence(old) only when this request claims; the card snapshot rides the $set`, () => {
    const src = read(rel);
    const filter = span(src, "const filter: FilterQuery<IOrder> = {", "\n    };", "the CAS filter");
    assert.ok(filter.includes("...(" + (name === "items" ? "resolvedClaim || card" : "claim || card") + " ? rewardClaimOrderFence(old) : {}),"), "stamp OR card claim spreads the shared fence");
    assert.equal(count(src, "rewardClaimOrderFence("), 1, "one spread, inside the filter");
    assert.equal(count(src, "cardSnapshotFields(card.reward)"), 1, "the card's Order fields are written once");
    assert.ok(!src.includes("rewardSnapshotFields(card"), "a card order never takes the stamp snapshot (no rewardAt / rewardStamps)");
  });

  test(`PIN (${name}): the card is released ONLY in the CAS-miss branch (a definite no-write), never on a throw`, () => {
    const src = read(rel);
    assert.equal(count(src, "releaseRewardCard("), 1, "exactly one release in the route");
    const miss = at(src, "if (!updated) {", "the CAS miss branch");
    const release = at(src, "releaseRewardCard(String(old.customerId), card.id, old.orderId)", "the release");
    assert.ok(release > miss, "the release is inside the miss branch");
    const missBlock = src.slice(miss, at(src, "return failure(", "the miss answer", release));
    assert.ok(missBlock.includes("releaseRewardCard("), "...before the miss answer");
    assert.ok(!/catch\s*\(/.test(src.slice(at(src, "claimRewardCard(", "the claim"), miss)), "no catch between the claim and the CAS that could release on an unknown throw");
    assert.ok(src.includes("failure(CARD_NOT_USABLE, 409)"), "a card claim miss answers CARD_NOT_USABLE 409");
  });
}

test("PIN (round + settle libs): the one-reward / promo fence is rewardClaimRefusal (stamp AND card), both intents are 400, free-dish is refused only at settle", () => {
  for (const rel of ["lib/order-round-reward.ts", "lib/settle-reward.ts"]) {
    const src = read(rel);
    assert.ok(!src.includes("old.rewardAt !== undefined"), `${rel}: the rewardAt-only fence is gone`);
    const both = at(src, "message: CARD_REWARD_EXCLUSIVE, status: 400", "the both-intents 400");
    const refusal = at(src, "const refusal = rewardClaimRefusal(old);", "the shared refusal");
    const card = at(src, "resolveCardClaim({", "the card resolve");
    assert.ok(both < refusal && refusal < card, `${rel}: 400 exclusivity, then the 409 fence, then any card read`);
    assert.match(src.slice(refusal, refusal + 120), /status: 409/, `${rel}: the fence answers 409`);
  }
  const round = read("lib/order-round-reward.ts");
  assert.match(round, /billTotal: plainTotal\(\),\s*items: fullItems,\s*refuseItemKind: false,\s*kotRound: round,/, "add-round: plain bill, full item set, free dish allowed, this round's number");
  assert.match(read("lib/settle-reward.ts"), /refuseItemKind: true,/, "settle refuses a free-dish card");
});

// ── Cancel + PUT ─────────────────────────────────────────────────────────────

test("PIN (cancel): the card is released AFTER the cancel CAS landed, swallowed like the stamp return", () => {
  const src = read(CANCEL);
  const cas = at(src, "if (!updated) return failure(", "the cancel CAS miss");
  const release = at(src, "releaseRewardCard(rewardCustomer, updated.rewardCardId, updated.orderId)", "the card release");
  assert.ok(release > cas, "released only after the CAS landed");
  assert.equal(count(src, "releaseRewardCard("), 1);
  const tryOpen = src.lastIndexOf("try {", release);
  assert.ok(tryOpen > cas && !src.slice(tryOpen, release).includes("}"), "the release sits in its own try");
  const catchAt = at(src, "} catch {", "the swallowing catch", release);
  assert.equal(src.slice(catchAt + "} catch {".length, src.indexOf("}", catchAt + 1)).trim(), "", "the catch is empty: a committed cancel never turns into a 500");
  assert.match(src.slice(release - 40, release + 160), /if \(await releaseRewardCard/, "cache invalidation is gated on the release's own boolean");
});

test("PIN (PUT): a customer change on a rewarded bill is refused 409, and the write repeats the rule as CAS terms", () => {
  const src = read(PUT);
  const put = src.slice(at(src, "export async function PUT", "PUT"));
  const changing = at(put, "const changingCustomer =", "the change detector");
  assert.match(put.slice(changing, changing + 160), /customerId !== String\(old\.customerId \?\? ""\)/, "a change = a supplied id that differs from the stored one");
  const refusal = at(put, "if (changingCustomer && hasOrderReward(old)) return failure(REWARD_REASSIGN_REFUSED, 409);", "the refusal");
  const cas = at(put, "Order.findOneAndUpdate(", "the write");
  assert.ok(changing < refusal && refusal < cas, "refused before the write");
  const filter = put.slice(at(put, "const filter = {", "the filter"), cas);
  assert.match(
    filter,
    /changingCustomer\s*\?\s*\{ discountKind: \{ \$ne: "reward" \}, rewardAt: \{ \$exists: false \}, rewardCardId: \{ \$exists: false \} \}\s*:\s*\{\}/,
    "the reciprocal CAS terms (kind, stamp rung, card id) ride the filter when the customer changes",
  );
  assert.equal(count(put, "promoCode"), 0, "a promo bill may be re-pointed: its fence is keyed on the mobile, not the id");
});

// ── The marker is never removed ──────────────────────────────────────────────

function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return listTs(full);
    return /\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) ? [full] : [];
  });
}

test("PIN (P2): no order writer under app/api/orders or the three reward libs ever $unsets promoCode", () => {
  const files = [
    ...listTs(path.join(APP, "app", "api", "orders")),
    ...["order-create-reward", "order-round-reward", "settle-reward"].map((n) => path.join(APP, "lib", `${n}.ts`)),
  ];
  assert.ok(files.length >= 8, "landmark: the scan covers every order route + the libs");
  let sawUnset = false;
  for (const file of files) {
    const src = stripComments(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
    if (/unset\.discountKind|\$unset/.test(src)) sawUnset = true;
    assert.ok(!/unset\.promoCode|unset\[["']promoCode|\$unset[^;]{0,200}promoCode|promoCode\s*:\s*""/.test(src), `${path.basename(file)} must never $unset promoCode`);
  }
  assert.ok(sawUnset, "landmark: the scan reached real $unset sites (the check is not vacuous)");
});

// ── Behaviour: every refusal answers before any read ─────────────────────────

const CODE = "SAVE50";
const CARD = "a1b2c3d4e5f6";
// A lean tab as the routes hand it. Only the fields the refusals read matter; the cast is the fixture boundary.
const tab = (extra: Record<string, unknown>) => ({ customerId: "665f0000000000000000beef", items: [], discount: 0, ...extra });

test("create lib: rewardAt AND rewardCardId together -> CARD_REWARD_EXCLUSIVE, nothing read", async () => {
  const res = await resolveCreateReward({ settings: null, customerId: undefined, items: [], discountKind: undefined, rewardAt: 8, rewardCardId: CARD, billTotal: 100 });
  assert.deepEqual(res, { ok: false, message: CARD_REWARD_EXCLUSIVE });
});

test("round lib: both intents 400; a promo-marked or already-rewarded tab 409s for a stamp AND a card claim", async () => {
  const run = (old: Record<string, unknown>, extra: Partial<ResolveRoundRewardArgs>) =>
    resolveRoundReward({
      old: tab(old) as unknown as ResolveRoundRewardArgs["old"], settings: null, rewardAt: undefined, fullItems: [],
      discountKind: undefined, charge: 0, extraCharge: 0, cfg: { gstEnabled: false, gstRate: 0, gstMode: "exclusive" }, round: 2, ...extra,
    });
  assert.deepEqual(await run({}, { rewardAt: 8, rewardCardId: CARD }), { ok: false, message: CARD_REWARD_EXCLUSIVE, status: 400 });
  for (const extra of [{ rewardAt: 8 }, { rewardCardId: CARD }]) {
    assert.deepEqual(await run({ promoCode: CODE }, extra), { ok: false, message: PROMO_BLOCKS_REWARD, status: 409 });
    assert.deepEqual(await run({ discountKind: "reward", rewardCardId: CARD }, extra), { ok: false, message: ONE_REWARD_PER_BILL, status: 409 });
    assert.deepEqual(await run({ rewardAt: 8 }, extra), { ok: false, message: ONE_REWARD_PER_BILL, status: 409 });
  }
});

test("settle lib: both intents 400; a promo-marked or already-rewarded tab 409s for a stamp AND a card claim", async () => {
  const run = (old: Record<string, unknown>, extra: Partial<ResolveSettleRewardArgs>) =>
    resolveSettleReward({
      old: tab(old) as unknown as ResolveSettleRewardArgs["old"], settings: {} as ResolveSettleRewardArgs["settings"],
      rewardAt: undefined, chargeAmount: undefined, ...extra,
    });
  assert.deepEqual(await run({}, { rewardAt: 8, rewardCardId: CARD }), { ok: false, message: CARD_REWARD_EXCLUSIVE, status: 400 });
  for (const extra of [{ rewardAt: 8 }, { rewardCardId: CARD }]) {
    assert.deepEqual(await run({ promoCode: CODE }, extra), { ok: false, message: PROMO_BLOCKS_REWARD, status: 409 });
    assert.deepEqual(await run({ rewardCardId: CARD }, extra), { ok: false, message: ONE_REWARD_PER_BILL, status: 409 });
  }
});

// ── Mutation-pass pins (s91): three defects the unit chain let through, killed until now only by live legs ────────────
const SETTLE_LIB = "lib/settle-reward.ts";
const ROUND_LIB = "lib/order-round-reward.ts";

test("PIN (D9/R10): settle's CARD claim itself refuses a free-dish card — refuseItemKind: true INSIDE the resolveCardClaim call", () => {
  const call = span(read(SETTLE_LIB), "resolveCardClaim({", "});", "settle's card claim call");
  assert.match(call, /refuseItemKind: true,/, "a free-dish card is refused at settle");
  assert.doesNotMatch(call, /refuseItemKind: false/);
});

test("PIN (F1): create gates a claim's minimum on the bill BEFORE any discount — the client's discount is the reward preview", () => {
  const src = read(CREATE);
  at(src, "const claims = data.rewardAt !== undefined || data.rewardCardId !== undefined;", "the claims flag");
  const plain = span(src, "const plainTotals = computeOrderTotals({", "});", "the create gate total");
  assert.match(plain, /discount: claims \? 0 : data\.discount,/, "a claiming create prices its gate undiscounted");
  assert.match(plain, /discountKind: claims \? undefined :/, "...and with no preset kind");
  at(span(src, "resolveCreateReward({", "});", "the create reward call"), "billTotal: plainTotals.total,", "the gate total feeding the claim");
});

test("PIN (F1): the add-round and settle gate totals are priced undiscounted (discount 0, no kind)", () => {
  for (const [rel, label] of [[ROUND_LIB, "add-round"], [SETTLE_LIB, "settle"]] as const) {
    const plain = span(read(rel), "const plainTotal = (): number =>", "}).total;", `the ${label} gate total`);
    assert.match(plain, /discount: 0,/, `${label}: gate ignores the client discount`);
    assert.match(plain, /discountKind: undefined,/, `${label}: gate ignores the preset kind`);
  }
});

test("PIN (F3): a reward-resolve refusal answers a landed same-key twin first — create (lateReplay) and add-round (roundReplayAfterMiss)", () => {
  const create = read(CREATE);
  const guarded = "if (!rewardR.ok) return (await lateReplay()) ?? failure(rewardR.message, 400);";
  at(create, guarded, "the guarded create refusal");
  assert.equal(count(create, "failure(rewardR.message"), count(create, guarded), "every create reward refusal is late-replay guarded");
  const items = read(ITEMS);
  const guardedRound = "if (!roundReward.ok) return (key ? await roundReplayAfterMiss(id, key, parsed.data.items) : null) ?? failure(roundReward.message, roundReward.status);";
  at(items, guardedRound, "the guarded add-round refusal");
  assert.equal(count(items, "failure(roundReward.message"), count(items, guardedRound), "every add-round reward refusal is replay guarded");
});
