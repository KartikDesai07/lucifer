import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewardItemQty } from "./reward-item-line";
import type { RedeemedReward } from "@pos/shared/reward-redemption";

// CB-5B S12 — `resolveRewardItemLine` touches Mongo (Product.findById), so its
// verdicts are covered by the live-DB leg plus the source pins below, which
// assert the exact resolution ORDER without needing a database.
// `rewardItemQty` is pure and is covered directly.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");
const SRC = readSrc("reward-item-line.ts");

function reward(over: Partial<RedeemedReward> = {}): RedeemedReward {
  return { at: 8, kind: "item", value: 0, item: "Masala Chai", ...over };
}

// ── rewardItemQty (D11) ─────────────────────────────────────────────────────

test("rewardItemQty: a stored qty is used verbatim", () => {
  assert.equal(rewardItemQty(reward({ qty: 3 })), 3);
});

test("rewardItemQty: an ABSENT qty is 1, never 0 — every pre-D11 claim is absent", () => {
  assert.equal(rewardItemQty(reward()), 1);
});

test("rewardItemQty: a broken stored qty falls back to the identity, not to 0", () => {
  // A reward granting zero dishes is not a reward; a fractional count cannot
  // be put on a bill line.
  for (const qty of [0, -1, 1.5, Number.NaN]) {
    assert.equal(rewardItemQty(reward({ qty })), 1, `qty ${String(qty)} must normalize to 1`);
  }
});

test("rewardItemQty reads the CLAIM, so re-tuning the ladder cannot shrink an issued reward", () => {
  // The issued-at-a-cost contract: the claim stored qty 2, and that is what the
  // diner gets even if the owner has since changed the rung to grant 1.
  const issued = reward({ qty: 2 });
  assert.equal(rewardItemQty(issued), 2);
});

// ── source pins: the resolution order is the contract ───────────────────────

test("PIN: the free dish is resolved from the REFERENCE, never from the name (D8)", () => {
  assert.match(
    SRC,
    /const ref = reward\.itemProductId;/,
    "resolution must read itemProductId",
  );
  assert.ok(
    !/findOne\(\s*\{\s*name\s*:/.test(SRC),
    "a name lookup would reintroduce the exact ambiguity D8 removed",
  );
  // A positive landmark beside the absence assert above: a negative pin alone
  // passes vacuously if the file is ever renamed or emptied.
  assert.match(SRC, /Product\.findById\(ref\)/, "the dish is fetched BY ID");
});

test("PIN: a missing product ref is its own verdict, never a name fallback", () => {
  assert.match(SRC, /reason: "no-product-ref"/);
  assert.match(SRC, /reason: "product-missing"/);
  assert.match(SRC, /reason: "product-unavailable"/);
  assert.match(SRC, /reason: "not-an-item-reward"/);
});

test("PIN: the line is priced through the SHARED helper, not raw product.price", () => {
  // Found in review (2026-09-13): pricing off `product.price` ignored BOTH the
  // product discount and a variation's own price, so a sized or discounted
  // dish was comped at the wrong figure on the bill AND in the void trail.
  assert.match(SRC, /derivedLinePrice\(/, "must reuse the one pricing helper");
  // Scoped to the RETURNED line object, not the whole file: `product.price`
  // legitimately appears as an INPUT to the helper. An unscoped needle here
  // would fail against correct code (and a looser one would pass against the
  // bug), so the pin reads the `line: { … }` literal specifically.
  const lineLiteral = /line:\s*\{[\s\S]*?\n    \},/.exec(SRC);
  assert.ok(lineLiteral, "the returned line literal must be findable");
  assert.ok(
    !/price:\s*product\.price\b/.test(lineLiteral![0]),
    "the LINE must not bill raw product.price — that ignores discount and variations",
  );
  assert.match(lineLiteral![0], /price,/, "the line bills the DERIVED price");
  assert.ok(
    !/price:\s*0\b/.test(SRC),
    "a Rs 0 line would corrupt the void trail and hide the reward's value",
  );
  assert.match(SRC, /reward: true/, "the line must carry the flag the subtotal reducer skips on");
});

test("PIN: the product read SELECTS everything pricing depends on", () => {
  // A .select() that omits `discount` or `variations` silently re-introduces
  // the mispricing above — the fields would simply be undefined.
  const select = /\.select\("([^"]+)"\)/.exec(SRC);
  assert.ok(select, "the product read must name its projection explicitly");
  const fields = select![1]!.split(/\s+/);
  for (const needed of ["name", "price", "discount", "variations", "available", "isActive"]) {
    assert.ok(fields.includes(needed), `the projection must select ${needed}`);
  }
});

test("PIN: a variation that does not match is REJECTED, never priced at base", () => {
  // derivedLinePrice returns null for an unknown variation and its own comment
  // forbids falling back to the base price.
  assert.match(SRC, /price === null/, "the null verdict must be handled");
  assert.match(SRC, /reason: "variation-required"/);
});

test("PIN: an archived product is treated as gone, and '86' is its own reason", () => {
  assert.match(SRC, /product\.isActive === false/);
  assert.match(SRC, /product\.available === false/);
});
