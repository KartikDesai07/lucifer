import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";

// Smooth-writes Slice B — source pins for the three order write routes
// (settle / create / add-round): a bill number is taken only by the request
// that WON its write, a landed settle never answers 500 over a follow-up,
// independent reads run in one parallel wave (same refusal order as before),
// and a re-send with the same idemKey replays instead of writing twice.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAFE_ROOT = path.join(HERE, "..");
const SETTLE_ROUTE = "app/api/orders/[id]/settle/route.ts";
const ORDERS_ROUTE = "app/api/orders/route.ts";
const ITEMS_ROUTE = "app/api/orders/[id]/items/route.ts";
const read = (rel: string) => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const count = (src: string, needle: string) => src.split(needle).length - 1;

function mustIndexOf(src: string, needle: string, label: string, from = 0): number {
  const idx = src.indexOf(needle, from);
  assert.ok(idx !== -1, `expected to find ${label} (needle: ${JSON.stringify(needle)})`);
  return idx;
}

/** Every needle present, each strictly after the one before it. */
function assertChain(src: string, chain: ReadonlyArray<[string, string]>, why: string): void {
  let prev = -1;
  let prevLabel = "(start)";
  for (const [needle, label] of chain) {
    const at = mustIndexOf(src, needle, label);
    assert.ok(at > prev, `${label} must come after ${prevLabel} — ${why}`);
    prev = at;
    prevLabel = label;
  }
}

/** The block a `{` at `open` starts, braces balanced (on comment-stripped source). */
function blockFrom(src: string, open: number, label: string): string {
  assert.equal(src[open], "{", `${label} must start at a "{"`);
  for (let i = open, depth = 0; i < src.length; i++) {
    depth += src[i] === "{" ? 1 : src[i] === "}" ? -1 : 0;
    if (depth === 0) return src.slice(open, i + 1);
  }
  assert.fail(`${label} never closes`);
}

// ── Settle ───────────────────────────────────────────────────────────────────

test("PIN (settle): reads run in one wave, then 404 → settleRefusal → settings, in today's order", () => {
  const src = read(SETTLE_ROUTE);
  assert.match(
    src,
    /const \[oldR, settingsR\] = await Promise\.allSettled\(\[Order\.findById\(id\)\.lean\(\), getSettings\(\)\]\);/,
    "the order read and the settings read must start together",
  );
  assertChain(
    src,
    [
      ["const old = settledValue(oldR);", "the order unwrap"],
      ['if (!old) return notFound("Order not found");', "the 404"],
      ["const refusal = settleRefusal(old, data);", "the settle refusal"],
      ["if (refusal) return failure(refusal, 409);", "the refusal 409"],
      ["const settings = settledValue(settingsR);", "the settings unwrap"],
      ["resolveSettleMoney({", "the pricing"],
    ],
    "a missing or refused tab must answer as before, whatever the settings read did",
  );
});

test("PIN (settle): no bill number before the CAS — no counter call in the route, none in the CAS $set", () => {
  const src = read(SETTLE_ROUTE);
  mustIndexOf(src, "issueBillNumber(", "landmark: the post-CAS numbering call");
  assert.equal(count(src, "nextSlipSequence("), 0, "the route must never draw a slip number itself");
  const setStart = mustIndexOf(src, "const set: Record<string, unknown> = {", "the CAS $set literal");
  const unsetStart = mustIndexOf(src, "const unset: Record<string, \"\"> = {};", "the $unset literal", setStart);
  assert.ok(!src.slice(setStart, unsetStart).includes("billNumber"), "the CAS $set must not carry a bill number");
});

test("PIN (settle): exactly one issueBillNumber, after the CAS-miss 409, gated on a tab with no number yet", () => {
  const src = read(SETTLE_ROUTE);
  assert.equal(count(src, "issueBillNumber("), 1, "exactly one numbering call site");
  assertChain(
    src,
    [
      ["await Order.findOneAndUpdate(filter, update, {", "the settle CAS"],
      ['return failure("Tab changed or already settled — reopen it and try again", 409);', "the CAS-miss 409"],
      ["const numbering = printCfg.bill.showNumber && updated.billNumber === undefined;", "the no-renumber gate"],
      ["numbering ? issueBillNumber(id, printCfg.bill.numberStart) : Promise.resolve(updated),", "the numbering call"],
      ["return success(", "the success return"],
    ],
    "only a settle that WON its CAS may take a number, and a held bill is never renumbered",
  );
});

test("PIN (settle): follow-ups live in lib/settle-followups.ts and run alongside the numbering; one publish before both returns", () => {
  const src = read(SETTLE_ROUTE);
  for (const gone of ["reconcileLedger(", "Table.findOneAndUpdate(", "grantStampForSettledOrder"]) {
    assert.ok(!src.includes(gone), `the settle route must not call ${gone} itself — it lives in runSettleFollowUps`);
  }
  assert.match(
    src,
    /const \[numbered, followUps\] = await Promise\.allSettled\(\[\s*numbering \? issueBillNumber\([^)]*\) : Promise\.resolve\(updated\),\s*runSettleFollowUps\(old, updated, settings\),\s*\]\);/,
    "numbering and follow-ups settle together: neither can turn a landed settle into a throw",
  );
  assert.equal(count(src, "publishCafeEvent("), 1, "exactly one publish");
  const wave = mustIndexOf(src, "await Promise.allSettled([\n      numbering", "the post-CAS wave");
  const publish = mustIndexOf(src, 'publishCafeEvent("order-changed");', "the publish");
  const unconfirmed = mustIndexOf(src, "return serverError(BILL_NUMBER_UNCONFIRMED, numbered.reason);", "the numbering-failure answer");
  const ok = mustIndexOf(src, "return success(numbered.value ?? updated);", "the success answer");
  assert.ok(wave < publish && publish < unconfirmed && publish < ok, "the tab changed either way: publish before both answers");
});

// ── Create (new tab / Pay Now) ───────────────────────────────────────────────

test("PIN (create): one read wave with the replay lookup; the replay answers before any 400, sequence or claim", () => {
  const src = read(ORDERS_ROUTE);
  const post = mustIndexOf(src, "export async function POST(req: Request) {", "POST");
  const body = src.slice(post);
  assert.match(
    body,
    /await Promise\.allSettled\(\[\s*data\.idemKey \? findCreateReplay\(data\.idemKey\) : Promise\.resolve\(null\),/,
    "the replay lookup is the first read of the wave",
  );
  assertChain(
    body,
    [
      ["const replayed = settledValue(replayR);", "the replay unwrap"],
      [
        "if (replayed) return await createReplayVerdict(replayed, data.items, printConfigOf(settledValue(settingsR)).bill);",
        "the replay answer, AWAITED inside the try (a young unnumbered sale is a 503; an old one is numbered)",
      ],
      ["checkItemVariations(", "the variation check"],
      ["if (bad) return failure(bad, 400);", "the variation 400"],
      ["const table = settledValue(tableR);", "the table unwrap"],
      ['if ("error" in table) return failure(table.error, 400);', "the table 400"],
      ["const settings = settledValue(settingsR);", "the settings unwrap"],
      ["await nextOrderSequence();", "the order sequence"],
    ],
    "a re-send whose first try landed must never 400 on a since-edited product, burn a sequence or re-claim",
  );
});

test("PIN (create): every replay asks the insert winner's own numbering check, bound before a replay can run", () => {
  const src = read(ORDERS_ROUTE);
  const body = src.slice(mustIndexOf(src, "export async function POST(req: Request) {", "POST"));
  assert.equal(count(body, "const printCfg = printConfigOf(settings);"), 1, "one print config for the whole create");
  assert.equal(count(body, "printConfigOf("), 2, "the replay answer and printCfg — no third derivation");
  assertChain(
    body,
    [
      ["const settings = settledValue(settingsR);", "the settings unwrap"],
      ["const printCfg = printConfigOf(settings);", "the print config"],
      [
        "const lateReplay = async () => (data.idemKey ? createReplayResponse(data.idemKey, data.items, printCfg.bill) : null);",
        "the late replay, numbering-aware",
      ],
      ["await lateReplay()", "the first late replay call"],
      ['const issuesBill = printCfg.bill.showNumber && data.status === "Completed";', "the insert winner's numbering gate"],
    ],
    "printCfg must be bound before lateReplay first runs (a const read in its TDZ would throw), and all three read one check",
  );
  assert.equal(count(body, "createReplayResponse("), 1, "only lateReplay re-reads by key");
  assert.equal(count(body, "createReplayVerdict("), 1, "only the top-of-route replay answers from the wave's read");
});

test("PIN (create): the KOT number is taken after every refusal and the fence, and a slip failure undoes both claims", () => {
  const src = read(ORDERS_ROUTE);
  assertChain(
    src,
    [
      ['if ("error" in pay) return failure(pay.error, 400);', "the payment 400"],
      ['"Select a customer — the unpaid remainder becomes their due"', "the carrier refusal"],
      ["if (!(await fencePromoFor(orderId))) {", "the promo fence"],
      ["slips = await allocateOpeningKot(printCfg);", "the KOT allocation"],
      ["} catch (slipError) {", "the slip catch"],
      ["const doc = { ...unnumberedDoc, ...slips };", "the numbered doc"],
      ["Order.create({ ...doc, orderId });", "the insert"],
    ],
    "a refused create must cost the ticket series nothing",
  );
  const slipCatch = mustIndexOf(src, "} catch (slipError) {", "the slip catch");
  const slipEnd = mustIndexOf(src, "throw slipError;", "the slip rethrow", slipCatch);
  const block = src.slice(slipCatch, slipEnd);
  assert.match(block, /await Promise\.allSettled\(\[unclaimFor\(orderId\), unfencePromoFor\(orderId\)\]\);/, "no insert ran: return the stamps AND release the fence");
  const firstCatchE = mustIndexOf(src, "} catch (e) {", "the create catch");
  assert.ok(firstCatchE > mustIndexOf(src, "Order.create({ ...doc, orderId });", "the insert"), "the first catch (e) stays the create catch");
  assert.equal(count(src, "nextSlipSequence("), 0, "the route draws no slip number itself");
  assert.equal(count(src, "allocateOpeningKot("), 1, "exactly one KOT allocation — a second, earlier one would burn a ticket on every refusal");
});

test("PIN (create): the insert carries no bill number; only the winner numbers it, after the insert, once", () => {
  const src = read(ORDERS_ROUTE);
  const docStart = mustIndexOf(src, "const unnumberedDoc = {", "the unnumbered doc literal");
  const docEnd = mustIndexOf(src, "const claimFor = async", "the end of the doc literal", docStart);
  const doc = src.slice(docStart, docEnd);
  assert.ok(!/\bbillNumber\b/.test(doc) && !/\bkotNumbers\b/.test(doc), "the doc literal carries no slip numbers");
  assert.match(doc, /\.\.\.\(data\.idemKey \? \{ idemKey: data\.idemKey \} : \{\}\),/, "the key is stored, omit-empty (never null)");
  assert.equal(count(src, "issueBillNumber("), 1, "exactly one bill numbering call");
  assertChain(
    src,
    [
      ["order = await Order.create({ ...doc, orderId: retryOrderId });", "the retry insert"],
      ["issuesBill ? issueBillNumber(landed._id, printCfg.bill.numberStart) : Promise.resolve(null),", "the winner's numbering"],
      ['publishCafeEvent("order-changed");', "the publish"],
      ["return serverError(BILL_NUMBER_UNCONFIRMED, numbered.reason);", "the numbering-failure answer"],
      ["return created(numbered.value ?? landed);", "the created answer"],
    ],
    "a Pay Now twin that lost the insert must never draw a bill number",
  );
  assert.equal(count(src, "publishCafeEvent("), 1, "exactly one publish — replays return before it");
});

test("PIN (create): a duplicate idemKey adopts the landed order — after the claims come back, before any renumber", () => {
  const src = read(ORDERS_ROUTE);
  const createCatch = mustIndexOf(src, "} catch (e) {", "the create catch");
  // The adopt BODY, inside the FIRST catch's own block: the bare `if` needle
  // alone would pass an empty body that falls through into the renumber.
  const firstCatch = blockFrom(src, createCatch + "} catch (e) ".length, "the create catch block");
  const ADOPT = /if \(isIdemKeyDuplicate\(e\)\) \{\s*const won = await lateReplay\(\);\s*if \(won\) return won;\s*throw e;\s*\}/g;
  const adopts = [...firstCatch.matchAll(ADOPT)];
  assert.equal(adopts.length, 1, "the first catch adopts the landed twin (lateReplay → return it, else rethrow) exactly once");
  assert.ok(adopts[0].index! < firstCatch.indexOf("bumpOrderSequenceTo("), "the adopt returns before any renumber");
  assertChain(
    src.slice(createCatch),
    [
      ["if (!isDuplicateKeyError(e)) throw e;", "the definite-no-write guard"],
      ["await unclaimFor(orderId);", "the stamp return"],
      ["await unfencePromoFor(orderId);", "the fence release"],
      ["if (isIdemKeyDuplicate(e)) {", "the idem adopt"],
      ["bumpOrderSequenceTo(", "the renumber"],
    ],
    "an idemKey collision is our own twin: adopt it, never renumber into a second order",
  );
  const retryCatch = mustIndexOf(src, "} catch (retryError) {", "the retry catch");
  assertChain(
    src.slice(retryCatch),
    [
      ["await unfencePromoFor(retryOrderId);", "the retry fence release"],
      ["isIdemKeyDuplicate(retryError)", "the retry adopt"],
      ["throw retryError;", "the retry rethrow"],
    ],
    "the retry insert adopts the same way",
  );
  for (const refusal of ['failure("Not enough stamps for that reward", 409)', "failure(PROMO_USED_ERROR, 409)"]) {
    assert.ok(
      src.includes(`return (await lateReplay()) ?? ${refusal};`),
      `the ${refusal} refusal checks for a landed twin first`,
    );
  }
});

// ── Add-round ────────────────────────────────────────────────────────────────

test("PIN (items): read wave, then old → 404 → replay → variation 400 → the 409s → settings", () => {
  const src = read(ITEMS_ROUTE);
  assert.match(src, /await Promise\.allSettled\(\[\s*Order\.findById\(id\)\.lean\(\),/, "the tab read starts the wave");
  assertChain(
    src,
    [
      ["const old = settledValue(oldR);", "the tab unwrap"],
      ['if (!old) return notFound("Order not found");', "the 404"],
      ["const replay = key ? roundReplayResponse(old, key, parsed.data.items) : null;", "the replay check"],
      ["if (replay) return replay;", "the replay answer"],
      ["checkItemVariations(", "the variation check"],
      ["if (bad) return failure(bad, 400);", "the variation 400"],
      ['"Can only add items to an open tab"', "the open-tab 409"],
      ["const settings = settledValue(settingsR);", "the settings unwrap"],
      ["nextSlipSequence(", "the KOT number"],
    ],
    "a landed round must replay even if a product was edited since, and never draw a ticket",
  );
});

test("PIN (items): the key is fenced in the CAS, stored positionally, and a CAS miss checks for our own landed round", () => {
  const src = read(ITEMS_ROUTE);
  const filter = mustIndexOf(src, "const filter: FilterQuery<IOrder> = {", "the CAS filter");
  const filterEnd = mustIndexOf(src, "};", "the filter end", filter);
  assert.ok(src.slice(filter, filterEnd).includes("...idemGuardFilter(key),"), "the CAS refuses a second landing of the same key");
  assert.match(src, /const kotIdemKeys = buildKotIdemKeys\(old\.kotIdemKeys, round, key\);/);
  assert.match(src, /\.\.\.\(kotIdemKeys \? \{ kotIdemKeys \} : \{\}\),/, "stored in the round's $set, omit-empty");
  assertChain(
    src,
    [
      ["if (!updated) {", "the CAS-miss branch"],
      ["await returnRewardStamps(String(old.customerId), old.orderId, resolvedClaim.cost, rewardAssignment);", "the stamp return"],
      ["const late = key ? await roundReplayAfterMiss(id, key, parsed.data.items) : null;", "the late replay"],
      ["if (late) return late;", "the late replay answer"],
      ['return failure("Tab changed or already settled — reopen it and try again", 409);', "the 409"],
    ],
    "the overlap twin that lost the CAS answers with the round that landed",
  );
  assert.equal(count(src, "publishCafeEvent("), 1, "exactly one publish — replays return before it");
  assert.ok(
    mustIndexOf(src, "if (late) return late;", "late") < mustIndexOf(src, 'publishCafeEvent("kot-fired");', "publish"),
    "a replay never publishes",
  );
});

// ── Registry ─────────────────────────────────────────────────────────────────

test('PIN (registry): only lib/slip-numbers.ts (and the script-only lib/order-create.ts) draw a BILL number', () => {
  // The needle is split so this file never matches itself.
  const needle = "nextSlipSequence(" + '"bill"';
  mustIndexOf(read("lib/slip-numbers.ts"), 'await deps.nextSequence("bill")', "landmark: issueBillNumber draws the bill sequence");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(path.join(CAFE_ROOT, "app"));
  for (const name of readdirSync(path.join(CAFE_ROOT, "lib"))) {
    if (/\.ts$/.test(name) && !name.endsWith(".test.ts")) files.push(path.join(CAFE_ROOT, "lib", name));
  }
  assert.ok(files.length >= 100, `vision guard: the scan must read the tree (read ${files.length})`);
  const holders = files
    .filter((f) => readFileSync(f, "utf8").includes(needle))
    .map((f) => path.relative(CAFE_ROOT, f).split(path.sep).join("/"))
    .sort();
  assert.deepEqual(holders, ["lib/order-create.ts"], "no route or other lib may call the bill sequence directly");
});
