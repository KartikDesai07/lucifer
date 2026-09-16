import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DISCOUNT_KINDS } from "@/lib/constants";
import { shouldStoreDiscountKind } from "@pos/shared/reward-redemption";
import { stripComments } from "@/lib/source-pin-utils";

// CB-5B S15 — P-NEW-13, "the exception is single-homed".
//
// The repo-wide rule is "amount gates the kind": a discountKind is stored only
// when the re-derived discount amount is > 0. `shouldStoreDiscountKind` carries
// the ONE named exception — a "reward" kind stores even at ₹0, because a
// reward's derived amount can legitimately be 0 (an item reward ALWAYS, by
// construction: the benefit is a priced-but-untotalled dish on the bill, never
// rupees off; and also a flat reward on a ₹0 subtotal, or a percent reward that
// rounds to 0 on a tiny bill). If a writer keys on the AMOUNT instead, the
// stored kind and the five-field reward snapshot are $unset on exactly the
// orders that spent stamps — the stamps-spent provenance vanishes.
//
// Twelve copies of a three-way boolean IS the CR1.3 reciprocal-guard failure,
// so this file pins that the predicate is single-homed: every gate site routes
// through the shared function, and no site re-inlines an amount-keyed copy.
//
// WHY THIS FILE EXISTS SEPARATELY from gst-discount.test.ts' A7 pins: those pin
// the four PRODUCTION writers. Nothing pinned the ORACLE mirrors — the live-leg
// money builders in scripts/verify-order-integrity-live.ts and the demo seed —
// and that is precisely why all four live-leg mirrors silently drifted away
// from the routes they claim to mirror while every suite stayed green. An
// oracle that enforces a rule production abandoned certifies wrong behaviour.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, "..", rel), "utf8");

const LIVE_LEG = "scripts/verify-order-integrity-live.ts";
const SEED_ASSEMBLE = "scripts/seed-demo/orders-plan-assemble.ts";

// A hand-written amount-keyed gate, in the shapes this repo has actually
// carried. Matching ANY of these in a gate site means the exception was
// re-inlined and a zero-amount reward loses its provenance again.
//
// MEASURED FRAGILITY (session 42, found by running these regexes against the
// real pre-S15 file): shape 0 STILL matches the post-fix live leg — inside the
// COMMENTS that document the old shape for a future reader. Every assertion
// below therefore runs against `stripComments(...)` output, never raw source,
// and `assertNoRawGate` re-asserts that stripping actually happened by
// refusing to run on text that still contains a comment opener. Without that,
// a `stripComments` regression (its own file documents three known mis-lex
// classes) would blind these absence pins rather than fail them — the
// negative-source-pins-need-vision-guards rule applied to the STRIPPER, not
// just to the file under test.
const RAW_GATE_SHAPES: readonly RegExp[] = [
  // `totals.discount > 0 && discountKind === "gst"` and its near variants
  /\.?discount\s*>\s*0\s*&&\s*[A-Za-z.]*[dD]iscountKind\s*===\s*"gst"/,
  // `totals.discount > 0 && discountKind` (truthiness, the seed's old shape)
  /totals\.discount\s*>\s*0\s*&&\s*discountKind\s*\?/,
];

/**
 * Assert no raw amount-keyed gate survives in `stripped` — the COMMENT-FREE
 * text of `rel`. Guards the STRIPPER before trusting the absence: the
 * documented raw shapes legitimately appear in this repo's explanatory
 * comments, so an unstripped input would make these pins vacuous instead of
 * red.
 *
 * The guard is "a known comment sentence from this file is GONE", not "no `//`
 * survives": `//` legitimately survives stripping inside string and template
 * literals (measured — `mongodb://127.0.0.1` in the live leg's DEFAULT_URI),
 * so an opener-count guard fires on correct code. Verified by mutation both
 * ways.
 */
function assertNoRawGate(stripped: string, raw: string, rel: string): void {
  // Every file this helper is called on carries prose in its comments. Pick a
  // phrase that only ever appears in a comment, prove it is in the RAW source,
  // and prove stripping removed it. That is a positive, per-file demonstration
  // that comments were actually stripped out of the text being searched.
  const commentMarker = raw.match(/\/\/[^\n]{20,}/);
  assert.ok(commentMarker, `landmark: ${rel} must still carry explanatory comments for this guard to test`);
  assert.ok(
    !stripped.includes(commentMarker![0]),
    `stripComments did not strip ${rel} — the raw-gate absence assertions below would be vacuous, because the old gate shapes appear verbatim in this repo's explanatory comments`,
  );
  for (const shape of RAW_GATE_SHAPES) {
    assert.ok(
      !shape.test(stripped),
      `${rel} must not carry a hand-written amount-keyed discountKind gate (matched ${shape}) — the exception is single-homed in @pos/shared/reward-redemption`,
    );
  }
}

// ── P-NEW-13a: the predicate itself — both arms, PER KIND ────────────────────
// The spec's rule: "assert both arms PER KIND, never collapse to one loosened
// regex." DISCOUNT_KINDS is the closed enum, so this is exhaustive by
// construction and a future kind added to the enum lands here as a decision to
// make, not a silent inheritance of the escape hatch.

test("P-NEW-13: shouldStoreDiscountKind — both arms asserted PER KIND over the whole DISCOUNT_KINDS enum", () => {
  // The enum must be non-empty, or every per-kind loop below passes vacuously
  // (the ordering-pins-need-existence-asserts lesson).
  assert.ok(DISCOUNT_KINDS.length >= 2, "DISCOUNT_KINDS must carry at least gst + reward");
  assert.deepEqual([...DISCOUNT_KINDS].sort(), ["gst", "reward"], "the closed enum this pin reasons over");

  for (const kind of DISCOUNT_KINDS) {
    // POSITIVE arm: a positive amount always stores, for every kind.
    assert.equal(
      shouldStoreDiscountKind(1, kind),
      true,
      `${kind} at a positive amount must store (the ordinary amount-gates-kind arm)`,
    );
    // ZERO arm: differs PER KIND, and that difference is the whole point.
    const expectedAtZero = kind === "reward";
    assert.equal(
      shouldStoreDiscountKind(0, kind),
      expectedAtZero,
      `${kind} at ₹0 must ${expectedAtZero ? "STILL store (the one named exception)" : "NOT store (amount gates the kind)"}`,
    );
  }

  // No kind at all never stores, at any amount — the kind term is load-bearing
  // and not merely an amount check wearing a kind's clothes.
  assert.equal(shouldStoreDiscountKind(0, undefined), false, "no kind at ₹0 must not store");
  assert.equal(shouldStoreDiscountKind(500, undefined), false, "no kind at a positive amount must not store");
});

test("P-NEW-13: the exception is PER-KIND by name, not an `|| kind === 'reward'` escape hatch a future kind inherits", () => {
  // Written as a ternary on the kind, so a hypothetical third kind gets the
  // ORDINARY rule until it opts in BY NAME. This pin reads the shared source
  // because the behavioural difference only shows up for a kind that does not
  // exist yet — and the whole reason the spec chose the ternary shape was to
  // make that future case safe by default.
  const src = stripComments(readSrc("../../packages/shared/src/reward-redemption.ts"));
  assert.match(
    src,
    /export function shouldStoreDiscountKind\(/,
    "landmark: shouldStoreDiscountKind must still be defined in packages/shared/src/reward-redemption.ts",
  );
  const body = src.match(/export function shouldStoreDiscountKind\([\s\S]*?\n\}/);
  assert.ok(body, "landmark: the predicate must have a readable body");
  assert.match(
    body![0],
    /kind\s*===\s*"reward"\s*\?\s*true\s*:/,
    'the exception must be a per-kind ternary (kind === "reward" ? true : ...)',
  );
  assert.ok(
    !/\|\|\s*kind\s*===\s*"reward"/.test(body![0]),
    'the exception must NOT be an `|| kind === "reward"` disjunction — a future kind compared with || inherits the amount escape hatch by accident',
  );
});

// ── P-NEW-13b: the ORACLE mirrors — the four live-leg money writers ──────────
// Each of these mirrors one production writer. The route side is pinned in
// gst-discount.test.ts; these pin that the MIRROR did not drift. All four were
// raw amount-keyed copies before S15, typed to accept "reward" (DiscountKind is
// "gst" | "reward") but resolving it to `undefined`.

test("P-NEW-13 (ORACLE): the live leg imports the shared predicate and re-inlines NO amount-keyed gate anywhere", () => {
  const src = stripComments(readSrc(LIVE_LEG));
  // Positive landmark first: the file must still be the money-oracle leg, so a
  // rename/gut cannot make the absence assertions below pass vacuously
  // (negative-source-pins-need-vision-guards).
  assert.match(src, /computeOrderTotals\(/, "landmark: the live leg must still compute order totals");
  assert.match(src, /resolveDiscountKind\(/, "landmark: the live leg must still resolve the carried-forward kind");
  assert.match(
    src,
    /import\s*\{[^}]*shouldStoreDiscountKind[^}]*\}\s*from\s*"@pos\/shared\/reward-redemption"/,
    "the live leg must import shouldStoreDiscountKind from @pos/shared/reward-redemption",
  );
  // Guarded absence: `assertNoRawGate` proves the comments were stripped
  // before trusting that the raw shapes are gone. Such a copy would make the
  // ORACLE enforce a rule the routes abandoned, and the leg would then certify
  // the wrong behaviour.
  assertNoRawGate(src, readSrc(LIVE_LEG), LIVE_LEG);
});

test("P-NEW-13 (ORACLE 1/4 — create): resolveOrderCreateTotals gates the stored kind through the predicate and stores the RESOLVED kind", () => {
  const src = stripComments(readSrc(LIVE_LEG));
  const fn = src.match(/function resolveOrderCreateTotals\([\s\S]*?\n\}/);
  assert.ok(fn, "landmark: resolveOrderCreateTotals must still exist in the live leg");
  assert.match(fn![0], /computeOrderTotals\(/, "landmark: it must still derive totals through the real money function");
  assert.match(
    fn![0],
    /shouldStoreDiscountKind\(totals\.discount,\s*resolvedKind\)/,
    "the create oracle must gate storedKind on shouldStoreDiscountKind(totals.discount, resolvedKind)",
  );
  // The stored value must be the RESOLVED kind, never the "gst" literal — a
  // literal would relabel a reward tab as a GST discount.
  assert.ok(
    !/storedKind[^=]*=\s*[\s\S]{0,80}\?\s*"gst"\s*:/.test(fn![0]),
    'the create oracle must store the resolved kind, never a hardcoded "gst" literal',
  );
});

test("P-NEW-13 (ORACLE 2/4 — void): the void oracle keeps its `discount === 0` term AND adds the predicate term", () => {
  const src = stripComments(readSrc(LIVE_LEG));
  // The route's own widening kept `resolved.totals.discount === 0`
  // BYTE-IDENTICAL and only widened the kind term. The mirror must match that
  // shape, not replace the amount term — dropping it would $unset the kind on
  // a void that leaves a positive discount standing.
  assert.match(
    src,
    /old\.discountKind\s*!==\s*undefined\s*&&\s*\n?\s*resolution\.totals\.discount\s*===\s*0\s*&&\s*\n?\s*!shouldStoreDiscountKind\(resolution\.totals\.discount,\s*old\.discountKind\)/,
    "the void oracle must $unset discountKind on exactly all THREE terms: old kind present && re-derived discount === 0 && !shouldStoreDiscountKind(...) — mirroring items/void/route.ts",
  );
});

test("P-NEW-13 (ORACLE 3/4 — add-round): the round-fire oracle gates on the predicate and $sets the RESOLVED kind", () => {
  const src = stripComments(readSrc(LIVE_LEG));
  assert.match(
    src,
    /const storeKind = shouldStoreDiscountKind\(totals\.discount,\s*discountKind\);/,
    "the add-round oracle's storeKind must come from shouldStoreDiscountKind(totals.discount, discountKind)",
  );
  // The $set must carry the resolved `discountKind`, not the "gst" literal.
  assert.match(
    src,
    /\.\.\.\(storeKind\s*\?\s*\{\s*discountKind\s*\}\s*:\s*\{\}\),/,
    'the add-round oracle must $set the resolved kind — `...(storeKind ? { discountKind } : {})`, never `{ discountKind: "gst" }`',
  );
  assert.ok(
    !/storeKind\s*\?\s*\{\s*discountKind:\s*"gst"\s*\}/.test(src),
    'the add-round oracle must not $set a hardcoded "gst" — that relabels a carried-forward reward tab',
  );
  // The $unset arm is the same boolean, negated — both arms of one gate.
  assert.match(
    src,
    /if\s*\(!storeKind\)\s*unset\.discountKind = "";/,
    "the add-round oracle must $unset discountKind on exactly the negation of storeKind (both arms, one boolean)",
  );
});

test("P-NEW-13 (ORACLE 4/4 — settle): the settle oracle gates on the predicate and $sets the RESOLVED kind, else $unsets", () => {
  const src = stripComments(readSrc(LIVE_LEG));
  assert.match(
    src,
    /if\s*\(shouldStoreDiscountKind\(money\.totals\.discount,\s*money\.discountKind\)\)\s*\{\s*set\.discountKind = money\.discountKind;\s*\}\s*else\s*\{\s*unset\.discountKind = "";\s*\}/,
    "the settle oracle must branch on shouldStoreDiscountKind(money.totals.discount, money.discountKind), $set the RESOLVED kind in the true arm and $unset in the false arm (the two arms stay mutually exclusive — Mongo rejects one path in both operators)",
  );
  assert.ok(
    !/set\.discountKind = "gst";/.test(src),
    'the settle oracle must not $set a hardcoded "gst" literal',
  );
});

// ── P-NEW-13c: the SEED mirror ───────────────────────────────────────────────

test("P-NEW-13 (SEED): the demo seed gates the stored kind through the shared predicate", () => {
  const src = stripComments(readSrc(SEED_ASSEMBLE));
  assert.match(src, /computeOrderTotals\(/, "landmark: the seed must still price its orders through the real money function");
  assert.match(
    src,
    /import\s*\{[^}]*shouldStoreDiscountKind[^}]*\}\s*from\s*"@pos\/shared\/reward-redemption"/,
    "the seed must import shouldStoreDiscountKind from @pos/shared/reward-redemption",
  );
  assert.match(
    src,
    /\.\.\.\(shouldStoreDiscountKind\(totals\.discount,\s*discountKind\)\s*\?\s*\{\s*discountKind\s*\}\s*:\s*\{\}\),/,
    "the seeded order must gate discountKind through shouldStoreDiscountKind, not a hand-written amount copy",
  );
  assertNoRawGate(src, readSrc(SEED_ASSEMBLE), SEED_ASSEMBLE);
  // SCOPE, REVISITED IN S16 — this is now a BEHAVIOUR pin, not a drift pin.
  //
  // S15 recorded this as a DRIFT pin with a deliberate landmark: `pickDiscount`
  // then narrowed the seeded kind to `"gst" | undefined`, so the predicate's
  // reward exception was structurally unreachable and the adoption was parity
  // only. That landmark was written to FAIL the moment the seed widened, so
  // this scope note could not be left stale — and in S16 it duly did.
  //
  // S16 made the seed plant real reward orders (loyalty-data.ts's item rung +
  // orders-plan-assemble.ts's REWARD_ORDER_CHANCE), so the exception genuinely
  // FIRES here: a reward order stores `discount: 0` and the predicate stores
  // the kind anyway.
  //
  // WHAT THIS PIN MAY NOT ASSERT (reviewer-found, S16): the reward branch does
  // NOT go through `pickDiscount` — it is a separate arm of the same ternary
  // (`isRewardOrder ? {discountKind: "reward"} : … : pickDiscount(ctx)`). So
  // pinning `pickDiscount`'s RETURN TYPE would be inert: narrowing it back to
  // `"gst"` deletes no reward coverage and still compiles, yet would redden a
  // correct tree. The load-bearing facts are that the reward arm EXISTS and
  // that it feeds the same shared gate — both pinned below, on the runtime
  // shape rather than on a type annotation nothing depends on.
  assert.match(
    src,
    /isRewardOrder\s*\n?\s*\?\s*\{\s*discount:\s*0,\s*discountKind:\s*"reward" as const\s*\}/,
    "the seed must actually PLANT a reward order at discount 0 — the behaviour this pin covers, not merely the ability to type one",
  );
  assert.match(
    src,
    /reward:\s*true,/,
    "the planted reward order must carry the untotalled item line the free dish rides on",
  );
});

// ── P-NEW-13d: no NEW hand-written gate anywhere in the money writers ────────
// A sweep pin. The four production writers are pinned individually in
// gst-discount.test.ts; this asserts the INVARIANT over the whole set at once,
// so a gate added to a writer that has no pin of its own is still caught.

test("P-NEW-13: every discountKind gate in every money writer routes through the shared predicate — no amount-keyed copies survive anywhere", () => {
  const WRITERS: readonly string[] = [
    "app/api/orders/route.ts",
    "app/api/orders/[id]/items/route.ts",
    "app/api/orders/[id]/items/void/route.ts",
    "app/api/orders/[id]/settle/route.ts",
    "lib/order-request-accept.ts",
    "lib/order-request-accept-addround.ts",
    LIVE_LEG,
    SEED_ASSEMBLE,
    // The PAISE-LEDGER encoder. Added after a review pointed out that the
    // spec's own site list names it (`codec.ts:352`) and that it is the ONE
    // gate whose boolean controls the whole nested reward-snapshot block, not
    // just the kind scalar — so reverting it drops rewardAt/rewardKind/
    // rewardValue/rewardItem/rewardItemProductId/rewardQty/rewardStamps on
    // write. Its behaviour is pinned in packages/shared/src/codec.test.ts,
    // but this sweep claims to hold "everywhere", and a claim that broad must
    // actually cover the highest-blast-radius site.
    "../../packages/shared/src/codec.ts",
    // The reward live leg's own create oracle — the second oracle mirror.
    "scripts/verify-reward-redemption-live.ts",
  ];
  // Existence assert: an empty or mistyped list would pass every loop below
  // vacuously (ordering-pins-need-existence-asserts).
  assert.equal(WRITERS.length, 10, "the writer set this invariant sweeps");

  for (const rel of WRITERS) {
    const raw = readSrc(rel);
    const src = stripComments(raw);
    // Vision guard per file: it must actually still be a discountKind writer,
    // or its clean bill of health below means nothing.
    assert.match(src, /discountKind/, `landmark: ${rel} must still mention discountKind`);
    assert.match(
      src,
      /shouldStoreDiscountKind\(/,
      `${rel} must gate its stored discountKind through the shared shouldStoreDiscountKind predicate`,
    );
    assertNoRawGate(src, raw, rel);
  }
});

// A review raised this and it survived arbitration: RAW_GATE_SHAPES requires
// the AMOUNT term to precede the KIND term, so the logically identical gate
// written with the operands swapped (`kind === "gst" && amount > 0`) escapes
// both regexes. MEASURED by mutation on
// lib/order-request-accept-addround.ts:254 — the sweep pin above caught it
// (removing the predicate call leaves the gate without one), but the ABSENCE
// half did not. This pin closes that half order-independently: no money writer
// may compare a discountKind against a kind literal in the same expression as
// an amount comparison, in EITHER order.
test("P-NEW-13: no money writer carries an amount-keyed kind gate with the operands SWAPPED (order-independent absence)", () => {
  const FILES: readonly string[] = [
    "app/api/orders/route.ts",
    "app/api/orders/[id]/items/route.ts",
    "app/api/orders/[id]/items/void/route.ts",
    "app/api/orders/[id]/settle/route.ts",
    "lib/order-request-accept.ts",
    "lib/order-request-accept-addround.ts",
    LIVE_LEG,
    SEED_ASSEMBLE,
  ];
  assert.equal(FILES.length, 8, "the file set this order-independent sweep covers");
  // SCOPED to a STORE gate, not to any kind+amount comparison. Measured false
  // positive that forced this scoping: order-request-accept-addround.ts:185's
  // C5 branch is `openTab.discountKind === "gst" && promo.discount > 0` and is
  // CORRECT — it decides whether to RE-DERIVE a GST discount amount, not
  // whether to store a kind. A pin that reddens on it would be demanding a
  // change to working money code (that file's own header, :52-55, records the
  // store gate it already replaced). So the needle must bind the comparison to
  // a STORE decision: the boolean feeding a `storeKind`/`storedKind` local, a
  // `discountKind` key in an object literal, or an `unset.discountKind`.
  const KIND = '[dD]iscountKind\\s*===\\s*"(?:gst|reward)"';
  const AMOUNT = "[A-Za-z.]*discount\\s*(?:>|===)\\s*0";
  const SWAPPED_STORE_GATES: readonly RegExp[] = [
    // `const storeKind = kind === "gst" && amount > 0`
    new RegExp(`store[dD]?Kind[^;\\n]*=\\s*[^;\\n]*${KIND}\\s*&&\\s*${AMOUNT}`),
    // `...(kind === "gst" && amount > 0 ? { discountKind` — an omit-empty spread
    new RegExp(`${KIND}\\s*&&\\s*${AMOUNT}[^;\\n]*\\?[^;\\n]*\\{\\s*discountKind`),
    // `if (kind === "gst" && amount > 0) { set.discountKind` / `unset.discountKind`
    new RegExp(`${KIND}\\s*&&\\s*${AMOUNT}[\\s\\S]{0,60}?(?:un)?set\\.discountKind`),
  ];
  for (const rel of FILES) {
    const raw = readSrc(rel);
    const src = stripComments(raw);
    assert.match(src, /discountKind/, `landmark: ${rel} must still mention discountKind`);
    assertNoRawGate(src, raw, rel);
    for (const shape of SWAPPED_STORE_GATES) {
      assert.ok(
        !shape.test(src),
        `${rel} must not gate a STORED discountKind on a kind-literal AND an amount comparison (operands swapped, matched ${shape}) — the same amount-keyed bug reads identically in either order`,
      );
    }
  }
});
