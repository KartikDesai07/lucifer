import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";
import { resolveCreateReward } from "./order-create-reward";
import { resolveSettleReward, type ResolveSettleRewardArgs } from "./settle-reward";
import { POINTS_AT_PAYMENT, POINTS_REWARD_EXCLUSIVE } from "@pos/shared/reward-points";

// CB-7 S6 slice B - pins for the staff order writers that SPEND reward points: create (Pay Now), settle and cancel.
// Source pins (stripComments + ordered needles) for claim-before-write, return-only-on-a-definite-non-write and the
// fence wiring, plus DB-free behavioural legs for the two resolve libs' refusals (each answers BEFORE any read).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..");
const REPO = path.join(APP, "..", "..");
const readRaw = (rel: string) => readFileSync(path.join(APP, rel), "utf8").replace(/\r\n/g, "\n");
const read = (rel: string) => stripComments(readRaw(rel));
const CREATE = "app/api/orders/route.ts";
const SETTLE = "app/api/orders/[id]/settle/route.ts";
const CANCEL = "app/api/orders/[id]/cancel/route.ts";

function at(src: string, needle: string, label: string, from = 0): number {
  const idx = src.indexOf(needle, from);
  assert.ok(idx !== -1, `expected to find ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
}
const count = (src: string, needle: string): number => src.split(needle).length - 1;
function span(src: string, start: string, end: string, label: string): string {
  const from = at(src, start, label);
  return src.slice(from, at(src, end, `the end of ${label}`, from));
}
const lines = (rel: string): number => readRaw(rel).split("\n").length;

// ── Settle ───────────────────────────────────────────────────────────────────

test("PIN (settle): the points spend sits after the card claim and BEFORE the CAS; a refused spend answers POINTS_CHANGED 409", () => {
  const src = read(SETTLE);
  const resolve = at(src, "resolveSettleReward(", "the resolve call");
  const card = at(src, "claimRewardCard(", "the card claim");
  const spend = at(src, "spendPoints(", "the points spend");
  const cas = at(src, "Order.findOneAndUpdate(", "the CAS");
  assert.ok(resolve < card && card < spend && spend < cas, "resolve -> card claim -> points spend -> CAS");
  assert.equal(count(src, "spendPoints("), 1, "the spend is called from exactly one place");
  assert.match(
    src.slice(spend, cas),
    /spendPoints\(String\(old\.customerId\), old\.orderId, points\.n, points\.now\)\)\) \{\s*return failure\(POINTS_CHANGED, 409\);/,
    "the spend uses the ONE captured clock reading and a miss answers 409 before the CAS",
  );
  assert.ok(!/catch\s*\(/.test(src.slice(spend, cas)), "no catch between the spend and the CAS that could return points on an unknown throw");
});

test("PIN (settle): points are returned ONLY in the CAS-miss branch (the one definite no-write), never on a throw", () => {
  const src = read(SETTLE);
  assert.equal(count(src, "returnPoints("), 1, "exactly one return in the route");
  const miss = at(src, "if (!updated) {", "the CAS miss branch");
  const ret = at(src, "returnPoints(String(old.customerId), old.orderId)", "the return");
  assert.ok(ret > miss, "the return is inside the miss branch");
  assert.ok(ret < at(src, "return failure(", "the miss answer", ret), "...before the miss answer");
  assert.ok(src.includes("if (points) await returnPoints("), "gated on a points claim");
});

test("PIN (settle): the claiming CAS fence and the reward chain include points; the Order stores only rewardPoints", () => {
  const src = read(SETTLE);
  const filter = span(src, "const filter: FilterQuery<IOrder> = {", "\n    };", "the CAS filter");
  assert.ok(filter.includes("...(claim || card || points ? rewardClaimOrderFence(old) : {}),"), "stamp, card OR points spreads the shared fence");
  assert.equal(count(src, "rewardClaimOrderFence("), 1);
  assert.ok(src.includes('discountKind: claim || card || points ? "reward" : data.discountKind,'), "a points claim prices as a reward");
  assert.ok(src.includes("reward: claim?.reward ?? card?.reward ?? points?.reward ?? rewardFromOrderSnapshot(old),"), "the reward chain carries points, then the order's own snapshot");
  assert.equal(count(src, "if (points) set.rewardPoints = points.n;"), 1, "the snapshot is the cost alone");
  assert.ok(!src.includes("rewardSnapshotFields(points") && !src.includes("cardSnapshotFields(points"), "a points order never takes the stamp or card snapshot");
  assert.ok(src.includes("rewardPoints: data.rewardPoints,"), "the intent reaches the resolve");
});

test("PIN (settle lib): points + another reward is 400 BEFORE the 409 fence, which now covers points; the subtotal comes from the plain bill", () => {
  const src = read("lib/settle-reward.ts");
  const exclusive = at(src, "message: POINTS_REWARD_EXCLUSIVE, status: 400", "the points-exclusive 400");
  const refusal = at(src, "const refusal = rewardClaimRefusal(old);", "the shared refusal");
  const resolve = at(src, "resolvePointsSpend({", "the points resolve");
  assert.ok(exclusive < refusal && refusal < resolve, "400 exclusivity, then the 409 fence, then any wallet read");
  assert.match(src.slice(refusal, refusal + 120), /status: 409/, "the fence answers 409");
  assert.ok(src.includes("rewardPoints !== undefined"), "a points intent passes through the one-reward fence");
  const call = src.slice(resolve, at(src, "});", "the call's end", resolve));
  assert.match(call, /subtotal: plainTotals\(\)\.subtotal,/, "the ceiling is the FOOD total of the bill without any reward");
  assert.match(call, /points: rewardPoints,/, "exactly what the client asked for");
  assert.match(src, /status: resolved\.status/, "the resolve's own 400 / 409 is carried through");
});

// ── Create ───────────────────────────────────────────────────────────────────

test("PIN (create lib): the pay-time and exclusivity refusals answer before anything is read; points resolve against the plain food total", () => {
  const src = read("lib/order-create-reward.ts");
  const atPayment = at(src, "message: POINTS_AT_PAYMENT", "the not-completed refusal");
  const exclusive = at(src, "message: POINTS_REWARD_EXCLUSIVE", "the exclusivity refusal");
  const resolve = at(src, "resolvePointsSpend({", "the points resolve");
  assert.ok(atPayment < resolve && exclusive < resolve, "both refusals precede the wallet read");
  assert.ok(exclusive < at(src, "resolveCardClaim({", "the card resolve"), "and every card / stamp read");
  assert.match(src.slice(atPayment - 80, atPayment), /status !== "Completed"/, "points are spent only on a bill that is paid now");
  const call = src.slice(resolve, at(src, "});", "the call's end", resolve));
  assert.match(call, /subtotal,/, "the gate reads the plain food total passed in");
  assert.ok(src.includes("resolvedPoints"), "the resolution is returned for the route to claim");
  assert.equal(count(src, "rewardSnapshotFields"), 0, "a points order never builds the stamp snapshot");
});

test("PIN (create route): the claim sits before Order.create; points are spent / returned ONLY in claimFor / unclaimFor", () => {
  const src = read(CREATE);
  assert.ok(at(src, "if (!(await claimFor(orderId))) {", "the first claim") < at(src, "Order.create({ ...doc, orderId });", "the insert"), "the claim precedes the insert");
  const claimFor = span(src, "const claimFor = async", "const unclaimFor =", "claimFor");
  assert.ok(claimFor.includes("spendPoints(customerId!, oid, resolvedPoints.n, resolvedPoints.now)"), "claimFor spends with the ONE captured clock reading");
  assert.ok(!/new Date\(/.test(claimFor), "no fresh clock inside the closure (the renumber retry's re-spend reuses the first reading)");
  const unclaimFor = span(src, "const unclaimFor =", "};", "unclaimFor");
  assert.ok(unclaimFor.includes("returnPoints(customerId!, oid)"), "unclaimFor returns against the SAME orderId it spent for");
  assert.equal(count(src, "spendPoints("), 1, "spent from exactly one place");
  assert.equal(count(src, "returnPoints("), 1, "returned from exactly one place: slip failure, E11000 and the renumber retry all go through unclaimFor");
  assert.ok(src.includes("if (!(await claimFor(retryOrderId))) {"), "the renumber retry re-spends against the new orderId");
});

test("PIN (create route): the doc stores only the cost; the promo block refuses points; the miss copy is three-way; claims include points", () => {
  const src = read(CREATE);
  const doc = span(src, "const unnumberedDoc = {", "const claimFor = async", "the doc literal");
  assert.ok(doc.includes("...(resolvedPoints ? { rewardPoints: resolvedPoints.n } : {}),"), "a points order stores rewardPoints");
  assert.ok(!/rewardCardId|rewardAt\s*:|rewardStamps/.test(doc), "and never rewardAt / rewardStamps / a card id");
  assert.match(src, /if \(resolvedPoints\) return failure\(PROMO_BLOCKS_REWARD, 400\);/, "points plus a promo code is refused 400");
  assert.ok(
    src.includes('const claimMiss = resolvedCard ? CARD_NOT_USABLE : resolvedPoints ? POINTS_CHANGED : "Not enough stamps for that reward";'),
    "claimMiss: card copy, points copy, then the stamps copy verbatim",
  );
  assert.match(src, /const claims =[^;]*data\.rewardPoints !== undefined;/, "a points request prices the plain bill undiscounted, like any claim");
  assert.ok(src.includes("resolvedClaim?.reward ?? resolvedCard?.reward ?? resolvedPoints?.reward"), "totals price with the points reward");
});

// ── Cancel ───────────────────────────────────────────────────────────────────

test("PIN (cancel): points go back AFTER the cancel CAS landed, swallowed like the card, and the customers cache is dropped", () => {
  const src = read(CANCEL);
  const cas = at(src, "if (!updated) return failure(", "the cancel CAS miss");
  const ret = at(src, "returnPoints(rewardCustomer, updated.orderId)", "the return");
  assert.ok(cas < ret, "the return follows the landed cancel");
  assert.equal(count(src, "returnPoints("), 1);
  const block = span(src, "if (rewardCustomer && updated.rewardPoints !== undefined) {", "if (updated.tableNo) {", "the points block");
  assert.match(block, /try \{\s*if \(await returnPoints\(rewardCustomer, updated\.orderId\)\) cache\.del\("customers"\);\s*\} catch \{/, "a failed return never turns a landed cancel into a 500");
});

// ── Gates, intake fences and the no-new-print-field rule ─────────────────────

test("PIN: the points libs gate on dinerAccountsOn ONLY - never rewardLevelsEarning / scratchCardsBlockedFor / the TN block", () => {
  for (const rel of ["lib/reward-points-spend.ts", "lib/reward-points-cas.ts", "lib/settle-reward.ts", "lib/order-create-reward.ts"]) {
    const src = read(rel);
    assert.ok(!src.includes("rewardLevelsEarning") && !src.includes("scratchCardsBlockedFor") && !src.includes("scratchEnvBlocks"), `${rel} must not gate points on the levels / scratch switches`);
  }
  const spend = read("lib/reward-points-spend.ts");
  assert.ok(spend.includes("dinerAccountsOn(input.settings)"), "landmark: the one gate is diner accounts");
  assert.equal(count(spend, "dinerAccountsOn("), 1);
});

test("PIN: rewardPoints never reaches the add-round schema or the QR intake (staff-only at create and settle)", () => {
  const shared = readFileSync(path.join(REPO, "packages/shared/src/schemas/order.schema.ts"), "utf8");
  const addItems = span(shared, "export const addItemsSchema", "\n  .strict()", "addItemsSchema");
  assert.ok(addItems.includes("rewardAt:") || addItems.includes("rewardAtSchema"), "landmark: this is the add-round schema with its reward intent");
  assert.ok(!/rewardPoints|settleRewardIntentShape|orderRewardIntentShape/.test(addItems), "addItemsSchema names no points intent (.strict() answers 400)");
  const qrFiles = [
    path.join(REPO, "packages/shared/src/schemas/public-order.schema.ts"),
    ...walk(path.join(APP, "app/api/public")),
  ];
  assert.ok(qrFiles.length > 10, `landmark: the QR walk saw the public surface (${qrFiles.length} files)`);
  for (const f of qrFiles) assert.ok(!readFileSync(f, "utf8").includes("rewardPoints"), `${path.relative(REPO, f)} must not name rewardPoints`);
  // The QR add-round only RE-PRICES a tab that already carries points (a hand-listed Pick); it never takes the intent.
  const accept = read("lib/order-request-accept-addround.ts");
  assert.equal(count(accept, "rewardPoints"), 1, "the only mention is the snapshot Pick the re-price reads");
  assert.match(accept, /\| "rewardCardId"\s*\| "rewardPoints"/, "...listed beside the other snapshot keys");
});

test("PIN: the print order snapshot carries no points field (the bill prints Reward -Rs N, owner O1)", () => {
  const files = [
    ...readdirSync(path.join(APP, "lib")).filter((f) => /^print.*\.tsx?$/.test(f) && !f.endsWith(".test.ts")).map((f) => path.join(APP, "lib", f)),
    ...readdirSync(path.join(REPO, "packages/shared/src")).filter((f) => /^print.*\.tsx?$/.test(f) && !f.endsWith(".test.ts")).map((f) => path.join(REPO, "packages/shared/src", f)),
  ];
  assert.ok(files.length > 15, `landmark: the scan saw the print modules (${files.length})`);
  for (const f of files) assert.ok(!readFileSync(f, "utf8").includes("rewardPoints"), `${path.basename(f)} must not name rewardPoints`);
});

test("PIN (line cap): settle / orders routes did not grow past their pre-session size; the new libs stay under 300", () => {
  assert.ok(lines(SETTLE) <= 330, `settle route ${lines(SETTLE)} lines (was 329 + the trailing newline)`);
  assert.ok(lines(CREATE) <= 627, `orders route ${lines(CREATE)} lines (was 626 + the trailing newline)`);
  for (const rel of ["lib/reward-points-spend.ts", "lib/reward-points-cas.ts", "lib/settle-reward.ts", "lib/order-create-reward.ts", "lib/reward-cards-read.ts"]) {
    assert.ok(lines(rel) <= 300, `${rel} is ${lines(rel)} lines`);
  }
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

// ── Behavioural legs: both resolve libs refuse BEFORE any read or claim ──────

test("create lib: points on a Pending (held) tab -> POINTS_AT_PAYMENT, before any read", async () => {
  const r = await resolveCreateReward({
    settings: null, customerId: undefined, items: [], discountKind: undefined, rewardAt: undefined,
    rewardPoints: 10, status: "Pending", subtotal: 100, billTotal: 100,
  });
  assert.deepEqual(r, { ok: false, message: POINTS_AT_PAYMENT });
});

test("create lib: points with a stamp rung, a card or the GST preset -> POINTS_REWARD_EXCLUSIVE", async () => {
  const base = { settings: null, customerId: undefined, items: [], rewardAt: undefined as number | undefined, rewardPoints: 10, status: "Completed" as const, subtotal: 100, billTotal: 100 };
  for (const extra of [{ rewardAt: 8, discountKind: undefined }, { rewardCardId: "a1b2c3d4e5f6", discountKind: undefined }, { discountKind: "gst" as const }]) {
    const r = await resolveCreateReward({ ...base, ...extra });
    assert.deepEqual(r, { ok: false, message: POINTS_REWARD_EXCLUSIVE }, JSON.stringify(extra));
  }
});

test("settle lib: points with a rung or a card -> 400 exclusive; a bill that already carries a reward -> 409; no customer -> 400", async () => {
  const old = { items: [], discount: 0, chargeAmount: 0, charges: [], chargeLabel: undefined, customerId: undefined, rewardAt: undefined, rewardCardId: undefined, rewardPoints: undefined, promoCode: undefined, discountKind: undefined, gstRate: 0, gstMode: "inclusive" } as unknown as ResolveSettleRewardArgs["old"];
  const settings = { dinerAccountsEnabled: true } as unknown as ResolveSettleRewardArgs["settings"];
  const args = { old, settings, rewardAt: undefined, chargeAmount: undefined };
  const both = await resolveSettleReward({ ...args, rewardPoints: 10, rewardAt: 8 });
  assert.deepEqual(both, { ok: false, message: POINTS_REWARD_EXCLUSIVE, status: 400 });
  const rewarded = await resolveSettleReward({ ...args, old: { ...old, discountKind: "reward" } as typeof old, rewardPoints: 10 });
  assert.equal(rewarded.ok, false);
  assert.ok(!rewarded.ok && rewarded.status === 409, "one reward per bill");
  const walkIn = await resolveSettleReward({ ...args, rewardPoints: 10 });
  assert.ok(!walkIn.ok && walkIn.status === 400, "no customer on the tab -> 400");
});

test("settle lib: points with the GST preset -> 400 POINTS_REWARD_EXCLUSIVE before anything is read or spent (create parity)", async () => {
  const old = { items: [], discount: 0, chargeAmount: 0, charges: [], chargeLabel: undefined, customerId: undefined, rewardAt: undefined, rewardCardId: undefined, rewardPoints: undefined, promoCode: undefined, discountKind: undefined, gstRate: 0, gstMode: "inclusive" } as unknown as ResolveSettleRewardArgs["old"];
  const settings = { dinerAccountsEnabled: true } as unknown as ResolveSettleRewardArgs["settings"];
  const r = await resolveSettleReward({ old, settings, rewardAt: undefined, chargeAmount: undefined, rewardPoints: 10, discountKind: "gst" });
  assert.deepEqual(r, { ok: false, message: POINTS_REWARD_EXCLUSIVE, status: 400 });
  const ok = await resolveSettleReward({ old, settings, rewardAt: undefined, chargeAmount: undefined, rewardPoints: 10, discountKind: "reward" });
  assert.ok(!ok.ok && ok.message !== POINTS_REWARD_EXCLUSIVE, "only the gst preset is the exclusive pair (reward kind passes through to the customer gate)");
});

test("PIN (settle route): the body's discountKind reaches the settle reward resolve", () => {
  const call = span(read(SETTLE), "resolveSettleReward({", "});", "the settle reward resolve call");
  assert.match(call, /discountKind: data\.discountKind,/);
});

test("PIN (create): a short balance carries the points resolve's own 409 through lib and route; every other refusal stays 400", () => {
  const lib = read("lib/order-create-reward.ts");
  assert.match(lib, /if \(!points\.ok\) return \{ ok: false, message: points\.message, status: points\.status \};/, "the points refusal keeps its status");
  assert.equal(count(lib, "status: points.status"), 1);
  assert.ok(read(CREATE).includes("failure(rewardR.message, rewardR.status ?? 400)"), "the route answers the carried status, 400 by default");
  assert.equal(count(read(CREATE), "failure(rewardR.message"), 1);
});
