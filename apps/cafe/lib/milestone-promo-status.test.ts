import { test } from "node:test";
import assert from "node:assert/strict";

import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";
import type { PromoCodeConfig } from "@pos/shared/public-promo";
import { buildRewardAssignment } from "./reward-assignment";
import { milestonePromoStatus, NO_PROMO_CODE_VALUE, type MilestonePromoStatus } from "./milestone-promo-status";

// Settings pass slice 8 — the reward panel's promo-code warning. The status
// must agree with what a claim really does (buildRewardAssignment), or the
// panel would promise a code the diner never gets.

const LIST: PromoCodeConfig[] = [
  { code: "SAVE10", kind: "percent", value: 10, active: true },
  { code: "OLD20", kind: "flat", value: 20, active: false },
];

interface Fixture {
  name: string;
  code: string | null | undefined;
  list: PromoCodeConfig[] | undefined;
  want: MilestonePromoStatus;
}

const FIXTURES: Fixture[] = [
  { name: "no code (undefined)", code: undefined, list: LIST, want: "none" },
  { name: "no code (null)", code: null, list: LIST, want: "none" },
  { name: "no code (empty)", code: "", list: LIST, want: "none" },
  { name: "a code on the list and on", code: "SAVE10", list: LIST, want: "ok" },
  { name: "a code on the list but switched off", code: "OLD20", list: LIST, want: "off" },
  { name: "a code not on the list", code: "GONE99", list: LIST, want: "missing" },
  { name: "lowercase and spaced input matches the uppercase list code", code: "  save10 ", list: LIST, want: "ok" },
  { name: "a code named CONSTRUCTOR that is not on the list", code: "CONSTRUCTOR", list: LIST, want: "missing" },
  { name: "a code with no promo list at all", code: "SAVE10", list: undefined, want: "missing" },
];

const milestoneWith = (promoCode: string | null | undefined): ResolvedMilestone => ({
  at: 5,
  kind: "flat",
  value: 50,
  item: "",
  itemProductId: null,
  qty: 1,
  minBill: null,
  promoCode: promoCode ?? null,
  claimWithinDays: null,
});

for (const f of FIXTURES) {
  test(`milestonePromoStatus: ${f.name} -> ${f.want}`, () => {
    assert.equal(milestonePromoStatus(f.code, f.list), f.want);
  });
}

test("PARITY: milestonePromoStatus is ok exactly when buildRewardAssignment hands out a code", () => {
  assert.ok(FIXTURES.some((f) => f.want === "ok"), "landmark: at least one fixture hands out a code");
  assert.ok(FIXTURES.some((f) => f.want !== "ok"), "landmark: at least one fixture hands out nothing");
  for (const f of FIXTURES) {
    const handsOut = buildRewardAssignment(milestoneWith(f.code), f.list, new Date()) !== undefined;
    assert.equal(milestonePromoStatus(f.code, f.list) === "ok", handsOut, `parity broke for: ${f.name}`);
  }
});

test("NO_PROMO_CODE_VALUE can never be a real promo code", () => {
  // Codes are 3-16 uppercase letters/digits; the sentinel has lowercase and underscores.
  assert.ok(!/^[A-Z0-9]{3,16}$/.test(NO_PROMO_CODE_VALUE));
});
