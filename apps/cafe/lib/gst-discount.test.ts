import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  computeOrderTotals,
  receiptGst,
  resolveDiscountKind,
  type GstConfig,
} from "./receipt";
import {
  GST_RATES,
  DISCOUNT_KINDS,
  REWARD_DISCOUNT_LABEL,
  DEFAULT_DISCOUNT_LABEL,
  type DiscountKind,
} from "@/lib/constants";
import { discountLineLabel } from "@pos/shared/utils";
import { stripComments } from "@/lib/source-pin-utils";

// CB-2.7 — pins for the "GST Discount" preset (gstEquivalentDiscount +
// resolveDiscountKind + discountLineLabel + the writer matrix + the client
// mirror). All CB-2 code has already landed; this file is pins only, no
// source edits. Never bend a pin — a pin that fails on real behavior is a
// defect report, not something to weaken.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, "..", rel), "utf8");

function excl(rate: number): GstConfig {
  return { gstEnabled: true, gstRate: rate, gstMode: "exclusive" };
}
function incl(rate: number): GstConfig {
  return { gstEnabled: true, gstRate: rate, gstMode: "inclusive" };
}

const SUBTOTALS = [0, 7, 11, 100, 1000, 1001, 12345];

// ── A1: formula matrix ────────────────────────────────────────────────────────

test("formula matrix: exclusive mode never bills above the pre-tax subtotal, and lands on S or S-1, for every GST_RATES value x every subtotal", () => {
  for (const rate of GST_RATES) {
    if (rate <= 0) continue;
    for (const S of SUBTOTALS) {
      const totals = computeOrderTotals({
        items: [{ price: S, qty: 1 }],
        discount: 0,
        discountKind: "gst",
        charge: 0,
        cfg: excl(rate),
      });
      assert.ok(
        totals.total <= S,
        `rate=${rate} S=${S}: exclusive total ${totals.total} must never exceed the pre-tax subtotal ${S}`,
      );
      assert.ok(
        totals.total === S || totals.total === S - 1,
        `rate=${rate} S=${S}: exclusive total ${totals.total} must be S or S-1, got delta ${totals.total - S}`,
      );
    }
  }
});

test("formula matrix: inclusive mode's total is exactly round(S / (1 + r/100)) for every GST_RATES value x every subtotal", () => {
  for (const rate of GST_RATES) {
    if (rate <= 0) continue;
    for (const S of SUBTOTALS) {
      const totals = computeOrderTotals({
        items: [{ price: S, qty: 1 }],
        discount: 0,
        discountKind: "gst",
        charge: 0,
        cfg: incl(rate),
      });
      const expected = Math.round(S / (1 + rate / 100));
      assert.equal(
        totals.total,
        expected,
        `rate=${rate} S=${S}: inclusive total must equal round(S/(1+r/100)) = ${expected}`,
      );
    }
  }
});

test("formula matrix: gstEnabled false yields a 0 discount and total === subtotal, for every subtotal, both modes", () => {
  const OFF_EXCL: GstConfig = { gstEnabled: false, gstRate: 18, gstMode: "exclusive" };
  const OFF_INCL: GstConfig = { gstEnabled: false, gstRate: 18, gstMode: "inclusive" };
  for (const S of SUBTOTALS) {
    for (const cfg of [OFF_EXCL, OFF_INCL]) {
      const totals = computeOrderTotals({
        items: [{ price: S, qty: 1 }],
        discount: 0,
        discountKind: "gst",
        charge: 0,
        cfg,
      });
      assert.equal(totals.discount, 0, `gstEnabled:false, S=${S}, mode=${cfg.gstMode}: discount must be 0`);
      assert.equal(totals.total, S, `gstEnabled:false, S=${S}, mode=${cfg.gstMode}: total must equal S`);
    }
  }
});

test("formula matrix: rate 0 (GST_RATES[0]) yields a 0 discount and total === subtotal, for every subtotal, both modes", () => {
  assert.equal(GST_RATES[0], 0, "GST_RATES[0] must be 0 for this pin to mean anything");
  for (const S of SUBTOTALS) {
    for (const cfg of [excl(0), incl(0)]) {
      const totals = computeOrderTotals({
        items: [{ price: S, qty: 1 }],
        discount: 0,
        discountKind: "gst",
        charge: 0,
        cfg,
      });
      assert.equal(totals.discount, 0, `rate 0, S=${S}, mode=${cfg.gstMode}: discount must be 0`);
      assert.equal(totals.total, S, `rate 0, S=${S}, mode=${cfg.gstMode}: total must equal S`);
    }
  }
});

// The 12 worked rows from the plan's C1 table, pinned exactly.
test("formula matrix: the 12 worked rows from the plan's C1 table, pinned exactly", () => {
  const rows: Array<{ mode: "exclusive" | "inclusive"; S: number; r: number; total: number }> = [
    { mode: "exclusive", S: 1000, r: 5, total: 1000 },
    { mode: "exclusive", S: 1000, r: 12, total: 1000 },
    { mode: "exclusive", S: 1000, r: 18, total: 999 },
    { mode: "exclusive", S: 1000, r: 28, total: 1000 },
    { mode: "exclusive", S: 1001, r: 5, total: 1001 },
    { mode: "exclusive", S: 1001, r: 18, total: 1001 },
    { mode: "exclusive", S: 7, r: 5, total: 7 },
    { mode: "exclusive", S: 7, r: 28, total: 6 },
    { mode: "exclusive", S: 11, r: 28, total: 10 },
    { mode: "inclusive", S: 1000, r: 5, total: 952 },
    { mode: "inclusive", S: 1000, r: 18, total: 847 },
    { mode: "inclusive", S: 7, r: 28, total: 5 },
  ];
  for (const row of rows) {
    const cfg: GstConfig = { gstEnabled: true, gstRate: row.r, gstMode: row.mode };
    const totals = computeOrderTotals({
      items: [{ price: row.S, qty: 1 }],
      discount: 0,
      discountKind: "gst",
      charge: 0,
      cfg,
    });
    assert.equal(
      totals.total,
      row.total,
      `${row.mode} S=${row.S} r=${row.r}: expected total ${row.total}, got ${totals.total}`,
    );
  }
  // The "any rate 0 -> S" row from the table.
  for (const S of [1000]) {
    const totals = computeOrderTotals({
      items: [{ price: S, qty: 1 }],
      discount: 0,
      discountKind: "gst",
      charge: 0,
      cfg: { gstEnabled: true, gstRate: 0, gstMode: "exclusive" },
    });
    assert.equal(totals.total, S);
  }
});

// ── A2: discountKind:"gst" ignores a supplied bogus discount ─────────────────

test("computeOrderTotals with discountKind:'gst' IGNORES a supplied bogus discount (9999 and 0 both yield the derived figure)", () => {
  const cfg = excl(18);
  const derived = computeOrderTotals({
    items: [{ price: 1000, qty: 1 }],
    discount: 0,
    discountKind: undefined,
    charge: 0,
    cfg,
  });
  // Baseline: with discountKind undefined and discount:0, nothing is discounted.
  assert.equal(derived.discount, 0);

  const withBogus9999 = computeOrderTotals({
    items: [{ price: 1000, qty: 1 }],
    discount: 9999,
    discountKind: "gst",
    charge: 0,
    cfg,
  });
  const withBogus0 = computeOrderTotals({
    items: [{ price: 1000, qty: 1 }],
    discount: 0,
    discountKind: "gst",
    charge: 0,
    cfg,
  });
  assert.equal(withBogus9999.discount, 153, "a bogus discount of 9999 must be ignored under discountKind:'gst'");
  assert.equal(withBogus0.discount, 153, "discount:0 must also be ignored under discountKind:'gst' — same derived figure");
  assert.deepEqual(withBogus9999, withBogus0, "the supplied discount value must have zero effect when discountKind is 'gst'");
});

test("computeOrderTotals with discountKind: undefined uses the supplied discount figure (clamped)", () => {
  const cfg = excl(18);
  const supplied = computeOrderTotals({
    items: [{ price: 1000, qty: 1 }],
    discount: 200,
    discountKind: undefined,
    charge: 0,
    cfg,
  });
  assert.equal(supplied.discount, 200, "discountKind undefined must use the supplied figure verbatim (pre-clamp)");

  const clamped = computeOrderTotals({
    items: [{ price: 1000, qty: 1 }],
    discount: 5000, // above the subtotal
    discountKind: undefined,
    charge: 0,
    cfg,
  });
  assert.equal(clamped.discount, 1000, "a supplied discount above the subtotal must clamp to the subtotal");
});

// ── A3: table charge rides outside the preset ────────────────────────────────

test("the table charge rides OUTSIDE the GST preset: with charge 50, exclusive total - 50 is S or S-1 for every rate", () => {
  for (const rate of GST_RATES) {
    if (rate <= 0) continue;
    for (const S of SUBTOTALS) {
      const totals = computeOrderTotals({
        items: [{ price: S, qty: 1 }],
        discount: 0,
        discountKind: "gst",
        charge: 50,
        cfg: excl(rate),
      });
      const net = totals.total - 50;
      assert.ok(
        net === S || net === S - 1,
        `rate=${rate} S=${S}: total-charge ${net} must be S or S-1`,
      );
    }
  }
});

// ── A4: inclusive receiptGst after the preset — do NOT "correct" to 48 ───────

test("receiptGst after the GST preset (inclusive, S=1000 r=5): gstAmount 45, taxable 907 — NOT the 48 discount figure", () => {
  const breakdown = receiptGst(
    { total: 952, gstRate: 5, gstMode: "inclusive" },
    { gstEnabled: true, gstRate: 5, gstMode: "inclusive" },
  );
  assert.equal(breakdown.gstAmount, 45, "receiptGst back-calculates off the REDUCED total (952), not the original subtotal");
  assert.equal(breakdown.taxable, 907);
  assert.notEqual(breakdown.gstAmount, 48, "48 is the DISCOUNT amount, not the tax on the reduced consideration — must not be 'corrected' to this");
});

// ── A5: resolveDiscountKind ───────────────────────────────────────────────────

test("resolveDiscountKind: the 5 pinned cases", () => {
  assert.equal(resolveDiscountKind(undefined, "gst"), "gst", "supplied undefined (absent) -> leave the stored kind alone");
  assert.equal(resolveDiscountKind(null, "gst"), undefined, "supplied null -> explicit clear, regardless of stored");
  assert.equal(resolveDiscountKind("gst", undefined), "gst", "supplied 'gst' -> set, regardless of stored");
  assert.equal(resolveDiscountKind(undefined, undefined), undefined, "both absent -> stays undefined");
  assert.equal(resolveDiscountKind(null, undefined), undefined, "supplied null with nothing stored -> still undefined");
});

// ── A6: discountLineLabel ────────────────────────────────────────────────────

test("discountLineLabel: undefined/''/null/'promo' -> 'Discount'; 'gst' -> 'GST Discount'", () => {
  assert.equal(discountLineLabel(undefined), "Discount");
  assert.equal(discountLineLabel(""), "Discount");
  assert.equal(discountLineLabel(null), "Discount");
  assert.equal(discountLineLabel("promo"), "Discount");
  assert.equal(discountLineLabel("gst"), "GST Discount");
});

test("discountLineLabel: the two label constants equal the exact strings", () => {
  // GST_DISCOUNT_LABEL / DEFAULT_DISCOUNT_LABEL are re-exported through
  // lib/constants (export * from @pos/shared/constants).
  const src = stripComments(readSrc("../../packages/shared/src/constants.ts"));
  assert.match(src, /GST_DISCOUNT_LABEL\s*=\s*"GST Discount"/, "GST_DISCOUNT_LABEL must equal exactly 'GST Discount'");
  assert.match(src, /DEFAULT_DISCOUNT_LABEL\s*=\s*"Discount"/, "DEFAULT_DISCOUNT_LABEL must equal exactly 'Discount'");
});

// ── A7: source pins — the 6 server writers + client mirror ───────────────────
// Raw source + stripComments + a positive landmark per negative pin, per
// .claude/rules/testing.md. Needles built to avoid matching the pin's OWN
// source line (this file is not itself scanned, but keep the discipline).

test("PIN (WIDENED CB-5B S4): app/api/orders/route.ts passes discountKind into computeOrderTotals, and gates the STORED kind through the shared shouldStoreDiscountKind predicate (not a hand-written totals.discount > 0 && kind === 'gst' copy) — reward's amount-0 exception now applies here too", () => {
  // WHY this widened: CB-5B S4 wired a reward claim through this exact writer.
  // shouldStoreDiscountKind(amount, kind) — imported from @pos/shared/reward-
  // redemption — replaced the old inline "totals.discount > 0 && data.discountKind
  // === 'gst'" gate so that a resolved reward (whose derived amount is ALWAYS 0
  // for an item reward) still stores discountKind:"reward" and its snapshot,
  // instead of being $unset like every other zero-amount kind. The OLD needle
  // (a hand-written gst-only ternary) no longer appears in source — measuring
  // that absence was the point of running this pin before touching it.
  const src = stripComments(readSrc("app/api/orders/route.ts"));
  assert.match(src, /computeOrderTotals\(/, "landmark: route.ts must still call computeOrderTotals");
  assert.match(
    src,
    /discountKind:\s*data\.discountKind\s*\?\?\s*undefined,/,
    "POST /api/orders must pass discountKind: data.discountKind ?? undefined into computeOrderTotals",
  );
  // Positive landmark: the shared predicate must actually be IMPORTED...
  assert.match(
    src,
    /import\s*\{[^}]*shouldStoreDiscountKind[^}]*\}\s*from\s*"@pos\/shared\/reward-redemption"/,
    "route.ts must import shouldStoreDiscountKind from @pos/shared/reward-redemption",
  );
  // ...and actually CALLED to gate the stored discountKind field (not merely
  // imported and unused) — this is the positive landmark pairing the negative
  // pin below per this repo's vision-guard rule.
  assert.match(
    src,
    /discountKind:\s*shouldStoreDiscountKind\(totals\.discount,\s*effectiveDiscountKind\)\s*\?\s*effectiveDiscountKind\s*:\s*undefined,/,
    "the stored doc must gate discountKind behind shouldStoreDiscountKind(totals.discount, effectiveDiscountKind)",
  );
  // Negative pin: the OLD hand-written gst-only gate must be gone — a future
  // edit that re-inlines "totals.discount > 0 && ... === \"gst\"" here would
  // silently reintroduce the reward-at-0 bug this predicate exists to prevent.
  assert.ok(
    !/totals\.discount\s*>\s*0\s*&&\s*(data|effectiveDiscountKind)\.discountKind\s*===\s*"gst"/.test(src) &&
      !/totals\.discount\s*>\s*0\s*&&\s*effectiveDiscountKind\s*===\s*"gst"/.test(src),
    "route.ts must not re-inline a totals.discount > 0 && ... === 'gst' gate — that copy $unsets a reward's 0-amount snapshot",
  );
});

test("PIN: app/api/orders/[id]/items/route.ts passes discountKind via resolveDiscountKind, and $unsets it when the kind is cleared or the derived discount is 0", () => {
  const src = stripComments(readSrc("app/api/orders/[id]/items/route.ts"));
  assert.match(src, /computeOrderTotals\(/, "landmark: items/route.ts must still call computeOrderTotals");
  assert.match(
    src,
    /resolveDiscountKind\(parsed\.data\.discountKind,\s*old\.discountKind\)/,
    "items/route.ts must resolve the effective kind via resolveDiscountKind(parsed.data.discountKind, old.discountKind)",
  );
  assert.match(
    src,
    /if\s*\(!storeKind\)\s*unset\.discountKind\s*=\s*"";/,
    'items/route.ts must $unset discountKind (unset.discountKind = "") gated on !storeKind',
  );
});

test("PIN: lib/order.ts recompute trigger widens to include input.discountKind === undefined", () => {
  const src = stripComments(readSrc("lib/order.ts"));
  assert.match(src, /resolveSettleMoney/, "landmark: lib/order.ts must still export resolveSettleMoney");
  assert.match(
    src,
    /input\.discount\s*===\s*undefined\s*&&\s*input\.chargeAmount\s*===\s*undefined\s*&&\s*input\.discountKind\s*===\s*undefined/,
    "resolveSettleMoney's no-recompute branch must check input.discountKind === undefined alongside discount/chargeAmount",
  );
});

test("PIN (WIDENED CB-5B S5): settle/route.ts $sets discountKind = money.discountKind only behind the shared shouldStoreDiscountKind(money.totals.discount, money.discountKind) predicate, else $unsets it — a reward claimed at settle now stores at ₹0 too", () => {
  // WHY this widened: CB-5B S5 wired a settle-time reward claim through this
  // same gate. The old needle pinned a hand-written "money.totals.discount > 0
  // && money.discountKind === 'gst'" ternary that always set the literal "gst".
  // That shape can no longer be right: money.discountKind may now resolve to
  // "reward" (see the `discountKind: claim ? "reward" : data.discountKind` line
  // feeding resolveSettleMoney above), and an item reward's derived amount is
  // ALWAYS 0 — gating it like "gst" would $unset the snapshot (and the
  // stamps-spent provenance) on exactly the settle-time redemptions that spent
  // them. The shared shouldStoreDiscountKind predicate carries that one named
  // exception, so this route now calls it instead of re-deriving the rule.
  const src = stripComments(readSrc("app/api/orders/[id]/settle/route.ts"));
  assert.match(src, /resolveSettleMoney\(/, "landmark: settle/route.ts must still call resolveSettleMoney");
  // Positive landmark: the shared predicate must be IMPORTED...
  assert.match(
    src,
    /import\s*\{[^}]*shouldStoreDiscountKind[^}]*\}\s*from\s*"@pos\/shared\/reward-redemption"/,
    "settle/route.ts must import shouldStoreDiscountKind from @pos/shared/reward-redemption",
  );
  // ...and actually CALLED to gate the $set/$unset branch (paired positive
  // landmark for the negative pin below, per this repo's vision-guard rule).
  assert.match(
    src,
    /if\s*\(\s*shouldStoreDiscountKind\(money\.totals\.discount,\s*money\.discountKind\)\s*\)\s*\{\s*set\.discountKind\s*=\s*money\.discountKind;/,
    "settle/route.ts must set.discountKind = money.discountKind only when shouldStoreDiscountKind(money.totals.discount, money.discountKind) is true",
  );
  assert.match(src, /unset\.discountKind\s*=\s*"";/, "settle/route.ts must $unset discountKind in the else branch");
  // Negative pin: the OLD hand-written gst-only literal-set gate must be gone
  // — a future edit that re-inlines it would silently break a settle-time
  // reward's ₹0 snapshot.
  assert.ok(
    !/money\.totals\.discount\s*>\s*0\s*&&\s*money\.discountKind\s*===\s*"gst"/.test(src),
    "settle/route.ts must not re-inline a money.totals.discount > 0 && money.discountKind === 'gst' gate — that copy $unsets a settle-time reward's 0-amount snapshot",
  );
});

test("PIN (WIDENED CB-5B S4/S5): items/void/route.ts $unsets discountKind only when old.discountKind !== undefined AND resolved.totals.discount === 0 AND the shared shouldStoreDiscountKind predicate ALSO says no — a void on a reward-bearing order must NOT strip the reward snapshot just because the re-derived discount reads 0", () => {
  // WHY this widened: the OLD needle required only resolved.totals.discount
  // === 0 to $unset — correct back when "gst" was the only kind ever stored,
  // since a gst-derived discount really can settle to 0. But an ITEM reward's
  // derived discount is ALWAYS 0 by construction (CB-5B), so that old rule
  // would $unset a reward's snapshot (and its stamps-spent provenance) on
  // every single voided line of a reward-bearing order — exactly backwards.
  // The route now routes the KIND half of the decision through the shared
  // shouldStoreDiscountKind predicate, which carries the one named "reward"
  // exception. The `resolved.totals.discount === 0` term itself is UNCHANGED
  // — asserted below byte-identical to the original pin — only the kind term
  // widened.
  const src = stripComments(readSrc("app/api/orders/[id]/items/void/route.ts"));
  assert.match(src, /resolveItemVoid\(/, "landmark: void/route.ts must still call resolveItemVoid");
  // Positive landmark: the shared predicate must be IMPORTED...
  assert.match(
    src,
    /import\s*\{[^}]*shouldStoreDiscountKind[^}]*\}\s*from\s*"@pos\/shared\/reward-redemption"/,
    "void/route.ts must import shouldStoreDiscountKind from @pos/shared/reward-redemption",
  );
  // ...and actually CALLED, negated, alongside the UNCHANGED discount===0 term
  // (paired positive landmark for the negative pin below).
  assert.match(
    src,
    /old\.discountKind\s*!==\s*undefined\s*&&\s*resolved\.totals\.discount\s*===\s*0\s*\n?\s*&&\s*!shouldStoreDiscountKind\(resolved\.totals\.discount,\s*old\.discountKind\)\s*\n?\s*\?\s*\{\s*\$unset:\s*\{\s*discountKind:\s*""\s*\}\s*\}/,
    "void/route.ts must $unset discountKind exactly when old.discountKind !== undefined && resolved.totals.discount === 0 && !shouldStoreDiscountKind(resolved.totals.discount, old.discountKind)",
  );
  // The discount===0 term itself, isolated and asserted BYTE-IDENTICAL to the
  // pre-widening pin, per the task's explicit requirement that this term must
  // not move even as the kind term around it widens.
  assert.match(
    src,
    /resolved\.totals\.discount\s*===\s*0/,
    "the resolved.totals.discount === 0 term must survive unchanged",
  );
});

// CB-5B S7 RE-POINTED (never loosened): acceptAddRoundBranch moved OUT of
// lib/order-request-accept-write.ts into its own fifth sibling
// lib/order-request-accept-addround.ts for the ~300-line budget. The path
// changed; every assertion below is byte-identical in meaning, and the
// keepGstKind needle is now the gst ARM of resolveAddRoundKind (S7 widened
// the two-way boolean to a three-kind resolver — the gst behaviour it pinned
// is unchanged, so the pin follows the behaviour, not the old file).
test("PIN: lib/order-request-accept-addround.ts keeps the gst arm (keepGstKind via resolveAddRoundKind) and a second computeOrderTotals probe with discountKind:'gst', and never $sets discountKind", () => {
  const src = stripComments(readSrc("lib/order-request-accept-addround.ts"));
  assert.match(src, /acceptAddRoundBranch/, "landmark: order-request-accept-addround.ts must still export acceptAddRoundBranch");
  // The gst arm, asserted as BEHAVIOUR rather than as the old `keepGstKind`
  // identifier: S7 replaced that two-way boolean with resolveAddRoundKind, and
  // pinning a dead variable name into existence is how a pin starts forcing
  // code to exist for the pin's sake. The arm itself is pinned just below
  // (the "gst" case) and exhaustively in reward-qr-wiring.test.ts.
  assert.match(
    src,
    /storedKind === "gst" && promoDiscount === 0\) return "gst"/,
    "the gst arm must survive: a gst tab with NO promo keeps its kind (shipped C5 behaviour)",
  );
  assert.match(
    src,
    /resolveAddRoundKind\(openTab\.discountKind,\s*promo\.discount,\s*Boolean\(request\.promoCode\)\)/,
    // CB-5D added the third argument: PROMO_KINDS gained "item", whose money
    // value is 0 by construction, so the reward arm had to key on PRESENCE
    // rather than on the amount. The gst arm above is deliberately UNCHANGED
    // (gst and a 0-value item promo legitimately compose), which is why that
    // needle still reads `promoDiscount === 0`.
    "the add-round branch must resolve its kind through resolveAddRoundKind(discountKind, promo.discount, hasPromoCode) — not a two-way gst-only boolean, and not an amount-only reward fence",
  );
  assert.match(
    src,
    /discountKind:\s*"gst",\s*charge:\s*openTab\.chargeAmount\s*\?\?\s*0,\s*cfg:\s*tabGstCfg,/,
    "order-request-accept-addround.ts must probe a second computeOrderTotals call with discountKind: 'gst' (the gstPart probe)",
  );
  const setNeedle = "$set" + ":";
  assert.ok(src.includes(setNeedle), "landmark: the update object must still use $set");
  const setBlockMatch = src.match(/\$set:\s*\{[^}]*\}/);
  assert.ok(setBlockMatch, "landmark: the update object's $set block must be found");
  assert.ok(
    !/\bdiscountKind\b/.test(setBlockMatch![0]),
    "order-request-accept-addround.ts must never $set discountKind directly — only $unset it or omit it, letting the stored value survive unwritten",
  );
  // The OLD home must not silently keep a second copy of the branch (a split
  // that leaves the original behind is how two divergent copies of a money
  // path start). Paired with a POSITIVE landmark so the absence assert can
  // never pass vacuously against an empty or renamed file.
  const writeSrc = stripComments(readSrc("lib/order-request-accept-write.ts"));
  assert.match(writeSrc, /export async function applyAddRound/, "landmark: -write.ts must still own applyAddRound");
  assert.ok(
    !/function acceptAddRoundBranch/.test(writeSrc),
    "acceptAddRoundBranch must live in exactly ONE file (order-request-accept-addround.ts), never a second copy in -write.ts",
  );
});

// CB-5B S8 RE-POINTED (never loosened — the count is KEPT, re-baselined with
// its reason written in). This pinned `discountKind: undefined` EXACTLY TWICE
// (the subtotal probe + the create totals). D4 makes a reward claim
// diner-originatable, so the create branch now carries THREE such probes, and
// each one is named below rather than the count merely being bumped:
//   1. the promo subtotal probe (unchanged);
//   2. the PRE-REWARD bill total, which the per-milestone minBill gate is
//      evaluated against (a reward's own worth must not fund its own gate);
//   3. the PRE-REWARD total the price-drift fence compares to the diner's
//      quote — a reward legitimately lowers the bill, and comparing the
//      post-reward total would reject every rewarded order.
// The GST preset is still never originated here: the positive landmark below
// asserts the ONLY kind this file may ever pass is the server-resolved reward
// one, and that no "gst" literal can reach a totals call.
test("PIN: lib/order-request-accept.ts's three computeOrderTotals probes pass discountKind: undefined (promo subtotal + the two PRE-REWARD totals), and the file never originates a staff GST kind", () => {
  const src = stripComments(readSrc("lib/order-request-accept.ts"));
  assert.match(src, /acceptOrderRequest/, "landmark: order-request-accept.ts must still export acceptOrderRequest");
  const matches = src.match(/discountKind:\s*undefined/g) ?? [];
  assert.equal(
    matches.length,
    3,
    "order-request-accept.ts must pass discountKind: undefined exactly three times (promo subtotal probe + pre-reward minBill total + pre-reward drift-check total)",
  );
  // POSITIVE LANDMARK: the one kind this file may pass is the server-resolved
  // reward kind, and it comes from a resolution, never from a literal.
  assert.match(
    src,
    /const rewardKind = rewardResolution \? \("reward" as const\) : undefined/,
    "the only kind this file may originate is the SERVER-resolved reward kind",
  );
  // And the staff GST preset stays staff-only: no "gst" literal anywhere.
  assert.ok(
    !/"gst"/.test(src),
    "order-request-accept.ts must never name the staff GST preset — a diner order cannot originate it (C4, unchanged by D4)",
  );
});

test("PIN: lib/order-request-intake.ts passes discountKind: undefined — quote paths never originate a staff GST discount", () => {
  const src = stripComments(readSrc("lib/order-request-intake.ts"));
  assert.match(src, /computeOrderTotals\(/, "landmark: order-request-intake.ts must still call computeOrderTotals");
  assert.match(src, /discountKind:\s*undefined,/, "order-request-intake.ts must pass discountKind: undefined");
});

test("PIN: hooks/use-pos-tab.ts restores the discount unit from order.discountKind in BOTH applyTabUpdate and enterResume (count === 2), resetOrder sets '₹' exactly once, and all 3 payloads carry discountKind: discountKind ?? null", () => {
  const src = stripComments(readSrc("hooks/use-pos-tab.ts"));
  assert.match(src, /const applyTabUpdate\s*=/, "landmark: use-pos-tab.ts must still define applyTabUpdate");
  assert.match(src, /const enterResume\s*=/, "landmark: use-pos-tab.ts must still define enterResume");

  const restoreNeedle = /setDiscountUnit\(order\.discountKind\s*===\s*"gst"\s*\?\s*"GST"\s*:\s*"₹"\)/g;
  const restoreMatches = src.match(restoreNeedle) ?? [];
  assert.equal(
    restoreMatches.length,
    2,
    "setDiscountUnit(order.discountKind === 'gst' ? 'GST' : '₹') must appear exactly twice (applyTabUpdate + enterResume)",
  );

  const resetNeedle = /setDiscountUnit\("₹"\);/g;
  const resetMatches = src.match(resetNeedle) ?? [];
  assert.equal(resetMatches.length, 1, "setDiscountUnit(\"₹\") must appear exactly once (resetOrder)");

  const payloadNeedle = /discountKind:\s*discountKind\s*\?\?\s*null/g;
  const payloadMatches = src.match(payloadNeedle) ?? [];
  assert.equal(
    payloadMatches.length,
    3,
    "discountKind: discountKind ?? null must appear exactly 3 times (create payload, add-round payload, settle payload)",
  );
});

test("PIN: components/pos/Cart.tsx's unit toggle array is exactly [\"₹\",\"%\"] (no 'GST' inside it), and DiscountUnit includes 'GST'", () => {
  const raw = readSrc("components/pos/Cart.tsx");
  const src = stripComments(raw);
  assert.match(src, /export type DiscountUnit\s*=/, "landmark: Cart.tsx must still export type DiscountUnit");
  assert.match(
    src,
    /\(\["₹",\s*"%"\]\s*as\s*DiscountUnit\[\]\)/,
    'the unit toggle array literal must be exactly ["₹", "%"] as DiscountUnit[]',
  );
  assert.match(src, /DiscountUnit\s*=\s*"₹"\s*\|\s*"%"\s*\|\s*"GST"/, 'DiscountUnit must include "GST"');
});

test("PIN: the GST button in Cart.tsx is OUTSIDE function CartActions, carries aria-pressed and readOnly={gstActive}, and Cart.tsx still has no bill arithmetic", () => {
  const raw = readSrc("components/pos/Cart.tsx");
  const src = stripComments(raw);

  const actionsStart = src.indexOf("function CartActions");
  assert.ok(actionsStart >= 0, "landmark: Cart.tsx must still define function CartActions");
  const actionsBody = src.slice(actionsStart);
  assert.ok(
    !actionsBody.includes("POS_CART_GST_BUTTON_CLASS"),
    "POS_CART_GST_BUTTON_CLASS must NOT appear inside CartActions's body — the GST toggle is not one of the primary/secondary CTAs",
  );
  const beforeActions = src.slice(0, actionsStart);
  assert.ok(
    beforeActions.includes("POS_CART_GST_BUTTON_CLASS"),
    "POS_CART_GST_BUTTON_CLASS must appear BEFORE function CartActions in Cart.tsx (the GST button is rendered in the Cart footer, above CartActions)",
  );

  assert.match(src, /aria-pressed=\{gstActive\}/, "the GST button must carry aria-pressed={gstActive}");
  assert.match(src, /readOnly=\{gstActive\}/, "the discount Input must carry readOnly={gstActive}");

  assert.ok(!/const\s+total\s*=/.test(src), "Cart.tsx must still not compute its own total");
  assert.ok(!/subtotal\s*-\s*discount/.test(src), "Cart.tsx must still not do bill arithmetic (subtotal - discount)");
});

test("PIN: hooks/use-pos-totals.ts calls gstEquivalentDiscount(subtotal, gstCfg), and the gstCfg memo textually precedes the discount memo", () => {
  const src = stripComments(readSrc("hooks/use-pos-totals.ts"));
  assert.match(src, /export function usePosTotals/, "landmark: use-pos-totals.ts must still export usePosTotals");
  assert.match(
    src,
    /gstEquivalentDiscount\(subtotal,\s*gstCfg\)/,
    "usePosTotals must call gstEquivalentDiscount(subtotal, gstCfg)",
  );
  const gstCfgIdx = src.indexOf("const gstCfg");
  const discountIdx = src.indexOf("const discount");
  assert.ok(gstCfgIdx >= 0, "landmark: use-pos-totals.ts must define const gstCfg");
  assert.ok(discountIdx >= 0, "landmark: use-pos-totals.ts must define const discount");
  assert.ok(gstCfgIdx < discountIdx, "the gstCfg memo must textually precede the discount memo (discount depends on gstCfg)");
});

test("PIN: the three renderers call discountLineLabel(...) and none contains the literal label=\"Discount\" any more", () => {
  const files = [
    "components/pos/OrderReceipt.tsx",
    "components/pos/PaymentModal.tsx",
    "components/orders/OrderDetailSheet.tsx",
  ];
  for (const file of files) {
    const src = stripComments(readSrc(file));
    assert.match(src, /discountLineLabel\(/, `landmark: ${file} must still call discountLineLabel(`);
    assert.ok(
      !src.includes('label="Discount"'),
      `${file} must not contain the literal label="Discount" — it must derive the label from discountLineLabel`,
    );
  }
});

test("PIN: packages/shared print-job schema/pick carry discountKind, and printOrderSnapshot preserves discountKind:'gst' through the pick", () => {
  const schemaSrc = stripComments(readSrc("../../packages/shared/src/schemas/print-job.schema.ts"));
  assert.match(schemaSrc, /export const printOrderSnapshotSchema\s*=\s*z\.object\(/, "landmark: printOrderSnapshotSchema must still be defined");
  assert.match(schemaSrc, /discountKind:\s*z\.enum\(DISCOUNT_KINDS\)\.optional\(\)/, "printOrderSnapshotSchema must carry discountKind: z.enum(DISCOUNT_KINDS).optional()");
});

test("printOrderSnapshot({...order, discountKind:'gst'}).discountKind === 'gst' — the pick preserves the field (import from @pos/shared/print-job, mirrors print-job-payload-parity.test.ts)", async () => {
  const { printOrderSnapshot } = await import("@pos/shared/print-job");
  const order = {
    _id: "1",
    orderId: "ORD-1",
    customerName: "Walk-in",
    subtotal: 1000,
    discount: 152,
    discountKind: "gst" as DiscountKind,
    gstAmount: 152,
    gstRate: 18,
    gstMode: "exclusive" as const,
    total: 999,
    paidAmount: 999,
    payment: "Cash" as const,
    status: "Completed" as const,
    receiver: "Staff",
    createdAt: new Date().toISOString(),
    items: [],
    kotRounds: 1,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshot = printOrderSnapshot(order as any);
  assert.equal(snapshot.discountKind, "gst");
});

test("PIN: apps/cafe/models/Order.ts's discountKind path has enum: [...DISCOUNT_KINDS] and no default:", () => {
  const src = stripComments(readSrc("models/Order.ts"));
  assert.match(src, /discountKind\?:\s*DiscountKind;/, "landmark: the IOrder interface must still declare discountKind?: DiscountKind");
  const schemaLineMatch = src.match(/discountKind:\s*\{\s*type:\s*String,\s*enum:\s*\[\.\.\.DISCOUNT_KINDS\]\s*\},/);
  assert.ok(schemaLineMatch, "models/Order.ts's schema path for discountKind must be exactly { type: String, enum: [...DISCOUNT_KINDS] } with no default:");
  // No default: on the discountKind schema line specifically (the omit-empty
  // discipline chargeAmount/chargeLabel already follow) — check the matched
  // segment itself carries no "default" keyword.
  assert.ok(!schemaLineMatch![0].includes("default"), "the discountKind schema path must carry no default:");
});

test("PIN: lib/pos-layout.ts's POS_CART_GST_BUTTON_CLASS includes POS_PRESS_FEEDBACK_CLASS verbatim, h-9, w-full, xl:pointer-fine:h-8, and no un-gated xl: term", () => {
  const src = stripComments(readSrc("lib/pos-layout.ts"));
  const classMatch = src.match(/export const POS_CART_GST_BUTTON_CLASS\s*=\s*\n?\s*"([^"]+)"/);
  assert.ok(classMatch, "landmark: POS_CART_GST_BUTTON_CLASS must still be exported as a string literal");
  const cls = classMatch![1];
  const feedbackMatch = src.match(/export const POS_PRESS_FEEDBACK_CLASS\s*=\s*\n?\s*"([^"]+)"/);
  assert.ok(feedbackMatch, "landmark: POS_PRESS_FEEDBACK_CLASS must still be exported as a string literal");
  assert.ok(cls.includes(feedbackMatch![1]), "POS_CART_GST_BUTTON_CLASS must include POS_PRESS_FEEDBACK_CLASS verbatim");
  assert.match(cls, /(?:^|\s)h-9(?:\s|$)/, "POS_CART_GST_BUTTON_CLASS must include h-9");
  assert.match(cls, /(?:^|\s)w-full(?:\s|$)/, "POS_CART_GST_BUTTON_CLASS must include w-full");
  assert.ok(cls.includes("xl:pointer-fine:h-8"), "POS_CART_GST_BUTTON_CLASS must include xl:pointer-fine:h-8");
  const xlTerms = (cls.match(/(?:^|\s)(xl:\S+)/g) ?? []).map((s) => s.trim());
  assert.ok(xlTerms.length > 0, "landmark: POS_CART_GST_BUTTON_CLASS must carry at least one xl: term");
  for (const t of xlTerms) {
    assert.ok(t.startsWith("xl:pointer-fine:"), `POS_CART_GST_BUTTON_CLASS's xl: term "${t}" must be gated on xl:pointer-fine:`);
  }
});

// -- A8: the DB-level fence for discountKind is runValidators:true on every
// findOneAndUpdate writer. Live probe 2026-09-08 against the real Order model
// on a scratch mongod: $set {discountKind:"promo"} with runValidators:true ->
// ValidationError; the same $set WITHOUT runValidators is ACCEPTED and stored;
// $unset is unaffected. Zod at the route is the first fence, this is the last.
test("PIN: every findOneAndUpdate writer of discountKind (items / settle / void routes) passes runValidators: true", () => {
  const writers = [
    "app/api/orders/[id]/items/route.ts",
    "app/api/orders/[id]/settle/route.ts",
    "app/api/orders/[id]/items/void/route.ts",
  ];
  for (const rel of writers) {
    const src = stripComments(readSrc(rel));
    assert.ok(src.includes("discountKind"), `landmark: ${rel} must mention discountKind`);
    // Only the ORDER writes count (the settle route also frees the Table with
    // its own findOneAndUpdate, which never touches discountKind).
    const updates = src.split("Order.findOneAndUpdate(").length - 1;
    assert.ok(updates >= 1, `landmark: ${rel} must call Order.findOneAndUpdate at least once`);
    const withValidators = src.split("runValidators: true").length - 1;
    assert.ok(
      withValidators >= updates,
      `${rel}: ${updates} findOneAndUpdate call(s) but only ${withValidators} runValidators: true -- a writer without it stores any string in discountKind`,
    );
  }
  // The create path validates on Order.create (document validators always run).
  const create = stripComments(readSrc("app/api/orders/route.ts"));
  assert.ok(create.includes("Order.create("), "landmark: POST /api/orders must still create via Order.create");
});

test("PIN: Cart.tsx labels the applied row 'GST Discount applied' while the preset is active", () => {
  const src = stripComments(readSrc("components/pos/Cart.tsx"));
  assert.ok(src.includes('gstActive ? "GST Discount applied" : "Discount applied"'), "the applied row must switch its label on gstActive");
});

// ── CB-5B: the "reward" preset — points/stamp redemption as a money path ─────
// These pins exist because widening a CLOSED enum that many writers read is the
// step's central hazard: `discountKind` both labels the bill line and decides
// whether the server re-derives the amount. A kind that reaches
// computeOrderTotals' fallback branch is a client-asserted discount.

test("PIN CB-5B (TAX INVARIANT): a reward discount taxes EXACTLY like a manual discount of the same amount — GST is computed on subtotal MINUS the discount, for every rate and both modes", () => {
  // The CB-6A fix (receipt.ts: base = subtotal - clampedDiscount) is load-bearing
  // for CB-5B. If a reward ever skipped the discount off the taxable base, every
  // redeemed bill would over-charge GST. Proven by equivalence against the
  // already-pinned manual path rather than by re-deriving the arithmetic here.
  const SUBTOTALS = [100, 499, 1000, 2345, 9999];
  for (const gstRate of GST_RATES) {
    for (const gstMode of ["inclusive", "exclusive"] as const) {
      for (const subtotal of SUBTOTALS) {
        const cfg: GstConfig = { gstEnabled: gstRate > 0, gstRate, gstMode };
        const items = [{ price: subtotal, qty: 1 }];
        for (const flat of [1, 50, 250]) {
          const viaReward = computeOrderTotals({
            items,
            discount: 0,
            discountKind: "reward",
            charge: 0,
            cfg,
            reward: { at: 8, kind: "flat", value: flat, item: "" },
          });
          const viaManual = computeOrderTotals({
            items,
            discount: flat,
            discountKind: undefined,
            charge: 0,
            cfg,
          });
          assert.deepEqual(
            viaReward,
            viaManual,
            `reward vs manual drifted at rate=${gstRate} mode=${gstMode} subtotal=${subtotal} flat=${flat}`,
          );
          // The invariant itself, stated directly rather than only by equivalence:
          // re-derive from a bill whose ITEMS already equal the discounted base,
          // so the expected figure never re-uses computeOrderTotals' own discount
          // arithmetic (a bug there would otherwise cancel out on both sides).
          const base = subtotal - viaReward.discount;
          assert.equal(viaReward.discount, Math.min(flat, subtotal), "the reward discount must be clamped to the subtotal");
          assert.equal(
            viaReward.gstAmount,
            computeOrderTotals({ items: [{ price: base, qty: 1 }], discount: 0, discountKind: undefined, charge: 0, cfg }).gstAmount,
            "GST must be computed on the DISCOUNTED base, never the raw subtotal",
          );
        }
      }
    }
  }
});

test("PIN CB-5B: a percent reward is derived from the subtotal and clamped at 100% — a 100% reward zeroes the base, so GST is 0 too", () => {
  const cfg: GstConfig = { gstEnabled: true, gstRate: 18, gstMode: "exclusive" };
  const items = [{ price: 1000, qty: 1 }];
  const ten = computeOrderTotals({ items, discount: 0, discountKind: "reward", charge: 0, cfg, reward: { at: 5, kind: "percent", value: 10, item: "" } });
  assert.equal(ten.discount, 100, "10% of 1000");
  assert.equal(ten.gstAmount, 162, "18% of the 900 base, not of 1000");
  const all = computeOrderTotals({ items, discount: 0, discountKind: "reward", charge: 0, cfg, reward: { at: 5, kind: "percent", value: 100, item: "" } });
  assert.equal(all.discount, 1000, "100% discounts the whole subtotal");
  assert.equal(all.gstAmount, 0, "nothing consumed for money = no tax on it");
  const over = computeOrderTotals({ items, discount: 0, discountKind: "reward", charge: 0, cfg, reward: { at: 5, kind: "percent", value: 900, item: "" } });
  assert.equal(over.discount, 1000, "a nonsense >100% percent must clamp, never exceed the subtotal");
});

test("PIN CB-5B (SERVER-DERIVED): computeOrderTotals with discountKind:'reward' IGNORES the supplied discount — the gst preset's bogus-9999 property, for rewards", () => {
  const cfg: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
  const items = [{ price: 500, qty: 1 }];
  const reward = { at: 8, kind: "flat" as const, value: 50, item: "" };
  const derived = computeOrderTotals({ items, discount: 0, discountKind: "reward", charge: 0, cfg, reward });
  const bogus9999 = computeOrderTotals({ items, discount: 9999, discountKind: "reward", charge: 0, cfg, reward });
  const bogusNegative = computeOrderTotals({ items, discount: -100, discountKind: "reward", charge: 0, cfg, reward });
  assert.equal(derived.discount, 50, "the milestone's own value is the discount");
  assert.deepEqual(bogus9999, derived, "a client-sent 9999 must be ignored for a reward, exactly as it is for gst");
  assert.deepEqual(bogusNegative, derived, "a client-sent negative must be ignored too");
});

test("PIN CB-5B (FAILS CLOSED): discountKind:'reward' with NO reward resolved derives 0 — a writer that forgets to pass `reward` over-charges, never under-charges", () => {
  // `reward` is OPTIONAL on OrderTotalsInput (unlike `charge`, where the type
  // checker is the guard), so this behaviour IS the guard. A fallback to the
  // supplied `discount` here would let any client mint a discount by naming the
  // kind — the exact client-trust hazard the enum exists to prevent.
  const cfg: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
  const items = [{ price: 500, qty: 1 }];
  const missing = computeOrderTotals({ items, discount: 400, discountKind: "reward", charge: 0, cfg });
  assert.equal(missing.discount, 0, "no reward resolved => no discount, NOT the client's 400");
  assert.equal(missing.total, computeOrderTotals({ items, discount: 0, discountKind: undefined, charge: 0, cfg }).total, "the bill must equal an undiscounted bill");
});

test("PIN CB-5B: an 'item' reward derives 0 money — a free dish is honoured at the counter (owner decision D5), never as a discount line", () => {
  const cfg: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
  const items = [{ price: 500, qty: 1 }];
  const totals = computeOrderTotals({ items, discount: 250, discountKind: "reward", charge: 0, cfg, reward: { at: 10, kind: "item", value: 0, item: "Masala Chai" } });
  assert.equal(totals.discount, 0, "an item reward is worth 0 rupees on the bill");
});

test("PIN CB-5B (SOURCE): receipt.ts names EVERY DISCOUNT_KINDS member above the client-trusting fallback", () => {
  // The mutation this catches: adding a third kind to DISCOUNT_KINDS without a
  // branch in computeOrderTotals. Such a kind silently falls through to the
  // supplied `discount`, i.e. the client names its own discount. Scoped to the
  // rawDiscount expression, not the whole file, so it cannot pass on an
  // unrelated mention of the word elsewhere.
  const src = stripComments(readSrc("lib/receipt.ts"));
  assert.match(src, /export function computeOrderTotals\(/, "landmark: computeOrderTotals must still be defined here");
  const exprMatch = src.match(/const rawDiscount =[\s\S]*?;/);
  assert.ok(exprMatch, "landmark: computeOrderTotals must still build a rawDiscount");
  const expr = exprMatch![0];
  for (const kind of DISCOUNT_KINDS) {
    assert.ok(
      expr.includes(`"${kind}"`),
      `the rawDiscount expression must name the "${kind}" kind — an unnamed kind falls through to the client-supplied number`,
    );
  }
  assert.match(expr, /rewardDiscountAmount\(/, "the reward branch must call the shared rewardDiscountAmount derivation");
});

test("PIN CB-5B: discountLineLabel('reward') is its own label — a redeemed bill must not print as a plain 'Discount'", () => {
  assert.equal(discountLineLabel("reward"), REWARD_DISCOUNT_LABEL);
  assert.notEqual(discountLineLabel("reward"), DEFAULT_DISCOUNT_LABEL);
  // The unknown-kind fallback contract stays intact (CB-2 pinned it).
  assert.equal(discountLineLabel("promo"), DEFAULT_DISCOUNT_LABEL);
});

// ── CB-5B D5 REVERSAL: the free-dish line is priced but never totalled ───────

test("PIN CB-5B (P-NEW-11): a reward line's price NEVER enters subtotal, total or GST — the bill is byte-identical to the same order without the free dish, at every rate and both modes", () => {
  // The owner's shape: the dish prints at its REAL price so the customer sees
  // what they got and what it was worth, but it is not money. Proven by
  // EQUIVALENCE against the same bill with the line simply absent — so a bug in
  // the reducer cannot cancel out on both sides of the comparison.
  const SOLD = [{ price: 300, qty: 2 }, { price: 150, qty: 1 }];
  // Deliberately includes a dish worth MORE than the whole rest of the bill:
  // a naive clamp or a sign error would surface here and nowhere else.
  for (const freePrice of [1, 40, 250, 5000]) {
    for (const gstRate of GST_RATES) {
      for (const gstMode of ["inclusive", "exclusive"] as const) {
        const cfg: GstConfig = { gstEnabled: gstRate > 0, gstRate, gstMode };
        const withFree = computeOrderTotals({
          items: [...SOLD, { price: freePrice, qty: 1, reward: true }],
          discount: 0,
          discountKind: undefined,
          charge: 0,
          cfg,
        });
        const without = computeOrderTotals({
          items: SOLD,
          discount: 0,
          discountKind: undefined,
          charge: 0,
          cfg,
        });
        assert.deepEqual(
          withFree,
          without,
          `a reward line changed the money at rate=${gstRate} mode=${gstMode} freePrice=${freePrice}`,
        );
      }
    }
  }
});

test("PIN CB-5B: a reward line rides WITH a discount and a charge without disturbing either — the free dish is outside every money term", () => {
  const cfg: GstConfig = { gstEnabled: true, gstRate: 18, gstMode: "exclusive" };
  const sold = [{ price: 1000, qty: 1 }];
  const withFree = computeOrderTotals({
    items: [...sold, { price: 400, qty: 1, reward: true }],
    discount: 100,
    discountKind: undefined,
    charge: 50,
    cfg,
  });
  assert.equal(withFree.subtotal, 1000, "the free dish is not in the subtotal");
  assert.equal(withFree.discount, 100, "the discount is unchanged by the free dish");
  assert.equal(withFree.gstAmount, 162, "18% of the 900 discounted base — the free dish is untaxed");
  assert.equal(withFree.charge, 50, "the charge is unchanged");
  assert.equal(withFree.total, 1112, "900 + 162 + 50 — the dish's 400 never enters the bill");
});

test("PIN CB-5B: an ALL-reward order is a zero bill — every line free means nothing to pay and nothing to tax", () => {
  const cfg: GstConfig = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" };
  const totals = computeOrderTotals({
    items: [{ price: 200, qty: 1, reward: true }, { price: 99, qty: 3, reward: true }],
    discount: 0,
    discountKind: undefined,
    charge: 0,
    cfg,
  });
  assert.equal(totals.subtotal, 0);
  assert.equal(totals.gstAmount, 0);
  assert.equal(totals.total, 0);
});

test("PIN CB-5B (SOURCE): computeOrderTotals' subtotal reducer skips reward lines", () => {
  // The mutation this catches: dropping the `i.reward ? 0 :` term, which would
  // charge the customer for a dish the bill says is free.
  const src = stripComments(readSrc("lib/receipt.ts"));
  assert.match(src, /export function computeOrderTotals\(/, "landmark: computeOrderTotals must still be defined here");
  const reducer = src.match(/const subtotal = Math\.round\([\s\S]*?\);/);
  assert.ok(reducer, "landmark: computeOrderTotals must still build a rounded subtotal");
  assert.match(
    reducer![0],
    /i\.reward\s*\?\s*0\s*:/,
    "the subtotal reducer must skip reward lines — without it a free dish is billed like any other",
  );
});
