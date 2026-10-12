import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Types } from "mongoose";

import {
  CARD_BILL_TOO_SMALL,
  CARD_CATEGORY_TOO_BIG,
  CARD_ITEM_NOT_AT_SETTLE,
  CARD_NOTHING_TO_DISCOUNT,
  CARD_NOT_USABLE,
  REWARD_SCOPE_PRODUCTS_MAX,
} from "@pos/shared/reward-card-use";
import type { RewardCardSnapshot, RewardOptionKind } from "@pos/shared/reward-levels";
import { REWARD_ITEM_LINE_NOTE, type RedeemedReward } from "@pos/shared/reward-redemption";
import type { ISettings } from "@/models/Settings";
import { stripComments } from "@/lib/source-pin-utils";
import { cardClaimFilter, cardClaimUpdate, cardReleaseFilter, cardReleaseUpdate } from "@/lib/reward-card-cas";
import {
  claimRewardCard,
  releaseRewardCard,
  resolveCardClaim,
  type CardClaimResolution,
  type ResolveCardClaimInput,
  type RewardCardClaimDeps,
} from "@/lib/reward-card-claim";
import type { ResolveRewardItemResult } from "@/lib/reward-item-line";

// CB-7 S5 slice B: claim resolution order + claim / release CAS over fake ports (DB-free; the live leg proves the DB side).
const NOW = new Date("2026-10-12T06:00:00.000Z");
const HOUR = 3_600_000;
const VALID_UNTIL = new Date(NOW.getTime() + 48 * HOUR);
const CID = "64b000000000000000000001";
const CARD = "0123456789ab";
const ORDER = "A-1007";

const settingsOf = (o: Record<string, unknown>): ISettings => o as unknown as ISettings;
const ON = settingsOf({ dinerAccountsEnabled: true });
// Levels switched off: a revealed card must still be usable (predicate 3).
const LEVELS_OFF = settingsOf({ dinerAccountsEnabled: true, rewardLevels: { v: 1, enabled: false, levels: [] } });

function card(kind: RewardOptionKind, o: Partial<RewardCardSnapshot> = {}): RewardCardSnapshot {
  return {
    id: CARD,
    issueKey: "step:3",
    source: "level",
    optionId: "opt1",
    kind,
    value: 10,
    pool: [],
    issuedAt: new Date(NOW.getTime() - 24 * HOUR),
    scratchBy: new Date(NOW.getTime() - 12 * HOUR),
    useDays: 14,
    keepUntil: VALID_UNTIL,
    status: "revealed",
    revealedAt: new Date(NOW.getTime() - 6 * HOUR),
    validUntil: VALID_UNTIL,
    ...o,
  };
}

const LINE_OK: ResolveRewardItemResult = {
  ok: true,
  line: {
    productId: new Types.ObjectId("64b0000000000000000000a1"),
    name: "Cold Coffee",
    price: 120,
    qty: 1,
    reward: true,
    note: REWARD_ITEM_LINE_NOTE,
  },
};

interface Fake {
  deps: RewardCardClaimDeps;
  calls: {
    read: Array<[string, string]>;
    category: Array<[string, number]>;
    item: RedeemedReward[];
    update: Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }>;
  };
}

function fake(
  stored: RewardCardSnapshot | null,
  o: { categoryIds?: string[]; matchedCount?: number; item?: ResolveRewardItemResult } = {},
): Fake {
  const calls: Fake["calls"] = { read: [], category: [], item: [], update: [] };
  const deps: RewardCardClaimDeps = {
    readCard: async (c, id) => {
      calls.read.push([c, id]);
      return stored;
    },
    categoryProductIds: async (id, limit) => {
      calls.category.push([id, limit]);
      return (o.categoryIds ?? []).slice(0, limit);
    },
    itemLine: async (reward) => {
      calls.item.push(reward);
      return o.item ?? LINE_OK;
    },
    updateCard: async (filter, update) => {
      calls.update.push({ filter, update });
      return { matchedCount: o.matchedCount ?? 1 };
    },
  };
  return { deps, calls };
}

const ITEMS = [{ productId: "p1" }, { productId: "p2" }];
function input(o: Partial<ResolveCardClaimInput> = {}): ResolveCardClaimInput {
  return {
    settings: ON,
    customerId: CID,
    cardId: CARD,
    billTotal: 500,
    items: ITEMS,
    refuseItemKind: false,
    kotRound: 1,
    now: NOW,
    ...o,
  };
}
const message = (r: CardClaimResolution): string | null => (r.ok ? null : r.message);

test("resolve: diner accounts off -> refused before ANY read", async () => {
  const f = fake(card("bill-percent"));
  const r = await resolveCardClaim(input({ settings: settingsOf({ dinerAccountsEnabled: false }) }), f.deps);
  assert.equal(message(r), CARD_NOT_USABLE);
  assert.equal((await resolveCardClaim(input({ settings: null }), f.deps)).ok, false);
  assert.deepEqual(f.calls.read, []);
});

test("resolve: no customer -> refused before any read", async () => {
  const f = fake(card("bill-percent"));
  const r = await resolveCardClaim(input({ customerId: undefined }), f.deps);
  assert.equal(r.ok, false);
  assert.deepEqual(f.calls.read, []);
});

test("resolve: levels switched off does NOT block a revealed card (predicate 3)", async () => {
  assert.equal((await resolveCardClaim(input({ settings: LEVELS_OFF }), fake(card("bill-percent")).deps)).ok, true);
});

test("resolve: a bill card prices as a percent / flat reward with the card id, no scope", async () => {
  const pct = await resolveCardClaim(input(), fake(card("bill-percent", { value: 12 })).deps);
  assert.deepEqual(pct, { ok: true, reward: { at: 0, kind: "percent", value: 12, item: "", cardId: CARD } });
  const flat = await resolveCardClaim(input(), fake(card("bill-flat", { value: 50 })).deps);
  assert.equal(flat.ok && flat.reward.kind, "flat");
  assert.equal(flat.ok && flat.reward.scope, undefined, "an unscoped card needs no matching line");
  assert.equal((await resolveCardClaim(input({ items: [] }), fake(card("bill-flat", { value: 50 })).deps)).ok, true);
});

test("resolve: the card is read through the diner id and the asked card id", async () => {
  const f = fake(card("bill-percent"));
  await resolveCardClaim(input(), f.deps);
  assert.deepEqual(f.calls.read, [[CID, CARD]]);
});

test("resolve: absent / ready / used / points / none -> CARD_NOT_USABLE", async () => {
  assert.equal(message(await resolveCardClaim(input(), fake(null).deps)), CARD_NOT_USABLE);
  for (const status of ["ready", "used"] as const) {
    assert.equal(message(await resolveCardClaim(input(), fake(card("bill-percent", { status })).deps)), CARD_NOT_USABLE, status);
  }
  for (const kind of ["points", "none"] as const) {
    assert.equal(message(await resolveCardClaim(input(), fake(card(kind)).deps)), CARD_NOT_USABLE, kind);
  }
});

test("resolve: expiry is strict - the deadline instant is usable, +1 ms is not", async () => {
  const atDeadline = await resolveCardClaim(input({ now: VALID_UNTIL }), fake(card("bill-percent")).deps);
  assert.equal(atDeadline.ok, true);
  const after = await resolveCardClaim(input({ now: new Date(VALID_UNTIL.getTime() + 1) }), fake(card("bill-percent")).deps);
  assert.equal(message(after), CARD_NOT_USABLE);
});

test("resolve: minBill - below refuses, equal passes, none set passes", async () => {
  const c = card("bill-percent", { minBill: 300 });
  assert.equal(message(await resolveCardClaim(input({ billTotal: 299.99 }), fake(c).deps)), CARD_BILL_TOO_SMALL);
  assert.equal((await resolveCardClaim(input({ billTotal: 300 }), fake(c).deps)).ok, true);
  assert.equal((await resolveCardClaim(input({ billTotal: 1 }), fake(card("bill-percent")).deps)).ok, true);
});

test("resolve: a free-item card is refused at settle (before the dish is looked up), usable otherwise", async () => {
  const c = card("free-item", { productId: "p1", productName: "Cold Coffee", qty: 1, value: 0 });
  const f = fake(c);
  assert.equal(message(await resolveCardClaim(input({ refuseItemKind: true }), f.deps)), CARD_ITEM_NOT_AT_SETTLE);
  assert.deepEqual(f.calls.item, []);
  const ok = await resolveCardClaim(input(), fake(c).deps);
  assert.equal(ok.ok, true);
});

test("resolve: a free-item card builds the dish line with the kotRound; a bill percent returns no line", async () => {
  const c = card("free-item", { productId: "p1", productName: "Cold Coffee", qty: 2, value: 0 });
  const f = fake(c);
  const r = await resolveCardClaim(input({ kotRound: 3, items: [] }), f.deps);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.reward, { at: 0, kind: "item", value: 0, item: "Cold Coffee", cardId: CARD, itemProductId: "p1", qty: 2 });
  assert.deepEqual(r.line, { ...(LINE_OK.ok ? LINE_OK.line : {}), modifiers: [], instructions: "", kotRound: 3 });
  assert.equal(f.calls.item.length, 1);
  assert.equal(f.calls.item[0]?.itemProductId, "p1");
  const bill = await resolveCardClaim(input(), fake(card("bill-percent")).deps);
  assert.ok(bill.ok && bill.line === undefined);
});

test("resolve: a free-item dish that cannot be built refuses with the dish message", async () => {
  const c = card("free-item", { productId: "p1", productName: "Cold Coffee", qty: 1, value: 0 });
  const r = await resolveCardClaim(input(), fake(c, { item: { ok: false, reason: "product-unavailable" } }).deps);
  assert.equal(message(r), "The reward dish is marked unavailable right now");
});

test("resolve: product-percent snapshots a one-unit scope; zero-match -> CARD_NOTHING_TO_DISCOUNT", async () => {
  const c = card("product-percent", { value: 20, productId: "p1", productName: "Cold Coffee", capRupees: 60 });
  const ok = await resolveCardClaim(input(), fake(c).deps);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.reward.scope, { productIds: ["p1"], maxUnits: 1, label: "Cold Coffee" });
    assert.equal(ok.reward.capRupees, 60);
  }
  const none = await resolveCardClaim(input({ items: [{ productId: "p9" }] }), fake(c).deps);
  assert.equal(message(none), CARD_NOTHING_TO_DISCOUNT);
  const rewardOnly = await resolveCardClaim(input({ items: [{ productId: "p1", reward: true }] }), fake(c).deps);
  assert.equal(message(rewardOnly), CARD_NOTHING_TO_DISCOUNT);
  assert.equal(message(await resolveCardClaim(input({ items: [] }), fake(c).deps)), CARD_NOTHING_TO_DISCOUNT);
});

test("resolve: product-percent with no product ref fails closed", async () => {
  const r = await resolveCardClaim(input(), fake(card("product-percent", { value: 20 })).deps);
  assert.equal(message(r), CARD_NOT_USABLE);
});

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${i}`);
test("resolve: a category card asks for MAX + 1 ids, snapshots them, accepts exactly MAX and refuses above", async () => {
  const c = card("category-percent", { value: 15, categoryId: "c1", categoryName: "Desserts" });
  const atMax = fake(c, { categoryIds: ids(REWARD_SCOPE_PRODUCTS_MAX) });
  const ok = await resolveCardClaim(input({ items: [{ productId: "p0" }] }), atMax.deps);
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.reward.scope?.productIds.length, REWARD_SCOPE_PRODUCTS_MAX);
  assert.deepEqual(atMax.calls.category, [["c1", REWARD_SCOPE_PRODUCTS_MAX + 1]]);

  const over = fake(c, { categoryIds: ids(REWARD_SCOPE_PRODUCTS_MAX + 5) });
  assert.equal(message(await resolveCardClaim(input({ items: [{ productId: "p0" }] }), over.deps)), CARD_CATEGORY_TOO_BIG);
});

test("resolve: a category flat card with nothing of its category on the bill is refused; no category ref fails closed", async () => {
  const c = card("category-flat", { value: 40, categoryId: "c1", categoryName: "Desserts" });
  const miss = await resolveCardClaim(input({ items: [{ productId: "p9" }] }), fake(c, { categoryIds: ["p1"] }).deps);
  assert.equal(message(miss), CARD_NOTHING_TO_DISCOUNT);
  const ok = await resolveCardClaim(input({ items: [{ productId: "p1" }] }), fake(c, { categoryIds: ["p1"] }).deps);
  assert.ok(ok.ok && ok.reward.kind === "flat" && ok.reward.capRupees === undefined);
  const noRef = fake(card("category-percent", { value: 15 }));
  assert.equal(message(await resolveCardClaim(input(), noRef.deps)), CARD_NOT_USABLE);
  assert.deepEqual(noRef.calls.category, [], "no categoryId -> no menu read");
});

test("claim: ONE updateOne with the claim filter + update; true on a match, false on matchedCount 0", async () => {
  const hit = fake(null, { matchedCount: 1 });
  assert.equal(await claimRewardCard(CID, CARD, ORDER, NOW, hit.deps), true);
  assert.equal(hit.calls.update.length, 1);
  assert.deepEqual(hit.calls.update[0], { filter: cardClaimFilter(CID, CARD, NOW), update: cardClaimUpdate(ORDER, NOW) });
  assert.deepEqual(hit.calls.read, [], "the claim is the CAS alone - no pre-read");
  const miss = fake(null, { matchedCount: 0 });
  assert.equal(await claimRewardCard(CID, CARD, ORDER, NOW, miss.deps), false);
});

test("release: pre-reads the card and writes back its stored validUntil under the orderId-scoped filter", async () => {
  const f = fake(card("bill-percent", { status: "used", orderId: ORDER, usedAt: NOW }));
  assert.equal(await releaseRewardCard(CID, CARD, ORDER, f.deps), true);
  assert.deepEqual(f.calls.read, [[CID, CARD]]);
  assert.deepEqual(f.calls.update, [{ filter: cardReleaseFilter(CID, CARD, ORDER), update: cardReleaseUpdate(VALID_UNTIL) }]);
});

test("release: a card that is gone (evicted) is a no-op false with NO write; a CAS miss is false", async () => {
  const gone = fake(null);
  assert.equal(await releaseRewardCard(CID, CARD, ORDER, gone.deps), false);
  assert.deepEqual(gone.calls.update, []);
  const other = fake(card("bill-percent", { status: "used", orderId: "A-9" }), { matchedCount: 0 });
  assert.equal(await releaseRewardCard(CID, CARD, ORDER, other.deps), false);
  assert.equal(other.calls.update.length, 1);
});

test("PIN: the card libs never read the earning / scratch-blocked predicates (a revealed card outlives both)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const needles = ["rewardLevels" + "Earning", "scratchCards" + "BlockedFor", "scratchCards" + "Blocked"];
  const hit = (src: string): boolean => needles.some((n) => src.includes(n));
  for (const file of ["reward-card-claim.ts", "reward-card-cas.ts"]) {
    const src = stripComments(readFileSync(path.join(here, file), "utf8"));
    assert.ok(src.includes("export "), `landmark: ${file} is the real module`);
    assert.ok(!hit(src), `${file} names no earning / blocked predicate`);
    assert.ok(hit(`${src}\nrewardLevelsEarning(settings);`), "mutation: a call is caught");
    assert.ok(hit(`import { scratchCardsBlockedFor } from "x";\n${src}`), "mutation: an import is caught");
  }
  const claim = stripComments(readFileSync(path.join(here, "reward-card-claim.ts"), "utf8"));
  assert.ok(claim.includes("dinerAccountsOn(input.settings)"), "landmark: the accounts gate is the one settings check");
});
