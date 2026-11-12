import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stockUsedOf,
  stockUsedFields,
  stockUsedForSale,
  type LinkedProduct,
  type StockLink,
  type StockLinkDeps,
} from "./stock-use";
import { STOCK_TAKE, STOCK_GIVE_BACK } from "./stock-move";
import { runCreateFollowUps, type CreateFollowUpDeps, type CreateFollowUpInput } from "@/lib/order-create-followups";
import type { ISettings } from "@/models/Settings";

// DB-free: the inventory-lite snapshot (pure sums) and its link lookup (cache, then one targeted read) through
// fake deps, plus the Pay Now create runner's stock move. The settle runner's move is in settle-followups.test.ts.
// Quantities are integer milli-units of each stock item's own unit (150 = 150 ml of an L item).

const CHAI = "665f000000000000000000c1";
const CHIPS = "665f000000000000000000c2";
const ARCHIVED = "665f000000000000000000c3";
const MILK = "665f000000000000000000a1";
const SUGAR = "665f000000000000000000a2";
const PACKETS = "665f000000000000000000a3";

const CHAI_USE: StockLink[] = [
  { itemId: MILK, qty: 150, sizes: [{ name: "Large", qty: 250 }, { name: "Cutting", qty: 0 }] },
  { itemId: SUGAR, qty: 10 },
];
const CHIPS_USE: StockLink[] = [{ itemId: PACKETS, qty: 1000 }];
const links = (entries: Array<[string, StockLink[]]>) => new Map(entries);

// ── stockUsedOf (pure) ────────────────────────────────────────────────────────────────────────────────────────

test("sums per stock item across lines, qty times the per-unit amount, sorted by itemId", () => {
  const used = stockUsedOf(
    [
      { productId: CHIPS, qty: 3 },
      { productId: CHAI, qty: 2 },
      { productId: CHAI, qty: 1 },
    ],
    links([[CHAI, CHAI_USE], [CHIPS, CHIPS_USE]]),
  );
  assert.deepEqual(used, [
    { itemId: MILK, qty: 450 },
    { itemId: SUGAR, qty: 30 },
    { itemId: PACKETS, qty: 3000 },
  ]);
});

test("a line sold as a size uses that size's own amount; an unknown size falls back to the link's amount", () => {
  const used = stockUsedOf(
    [
      { productId: CHAI, qty: 1, variation: "Large" },
      { productId: CHAI, qty: 1, variation: "Small" },
    ],
    links([[CHAI, CHAI_USE]]),
  );
  assert.deepEqual(used, [
    { itemId: MILK, qty: 400 },
    { itemId: SUGAR, qty: 20 },
  ]);
});

test("a zero amount is skipped (a size that uses none), never stored as a 0 line", () => {
  const used = stockUsedOf([{ productId: CHAI, qty: 2, variation: "Cutting" }], links([[CHAI, CHAI_USE]]));
  assert.deepEqual(used, [{ itemId: SUGAR, qty: 20 }]);
});

// s112 review LOW (probed: a malformed itemId in the settle $set throws a CastError and the bill stays Pending): a
// link whose stock item id is not an ObjectId is skipped, so bad stored data can never block a sale (owner D3).
test("a link with a missing or malformed stock item id is skipped; the good links still count", () => {
  const bad: StockLink[] = [{ itemId: undefined, qty: 150 }, { itemId: "undefined", qty: 150 }, { itemId: "abc", qty: 5 }];
  const used = stockUsedOf([{ productId: CHAI, qty: 1 }], links([[CHAI, [...bad, ...CHAI_USE]]]));
  assert.deepEqual(used, [
    { itemId: MILK, qty: 150 },
    { itemId: SUGAR, qty: 10 },
  ]);
  assert.equal(stockUsedOf([{ productId: CHAI, qty: 1 }], links([[CHAI, bad]])), undefined);
});

test("unlinked lines take nothing; nothing at all answers undefined, and stockUsedFields stores no key", () => {
  assert.equal(stockUsedOf([{ productId: CHIPS, qty: 1 }], links([[CHAI, CHAI_USE]])), undefined);
  assert.equal(stockUsedOf([], links([[CHAI, CHAI_USE]])), undefined);
  assert.deepEqual(stockUsedFields(undefined), {});
  assert.deepEqual(stockUsedFields([]), {});
  assert.deepEqual(stockUsedFields([{ itemId: MILK, qty: 1 }]), { stockUsed: [{ itemId: MILK, qty: 1 }] });
});

test("a free reward dish line takes stock like any other line", () => {
  const used = stockUsedOf([{ productId: CHIPS, qty: 1, reward: true } as { productId: string; qty: number }], links([[CHIPS, CHIPS_USE]]));
  assert.deepEqual(used, [{ itemId: PACKETS, qty: 1000 }]);
});

// ── stockUsedForSale (fake deps) ──────────────────────────────────────────────────────────────────────────────

interface LinkCalls {
  cache: number;
  reads: string[][];
}

function fakeLinks(cached: readonly LinkedProduct[] | undefined, db: readonly LinkedProduct[] = []): { deps: StockLinkDeps; calls: LinkCalls } {
  const calls: LinkCalls = { cache: 0, reads: [] };
  return {
    calls,
    deps: {
      cachedProducts: () => {
        calls.cache += 1;
        return cached;
      },
      findLinks: async (ids) => {
        calls.reads.push(ids);
        return db.filter((p) => ids.includes(String(p._id)));
      },
    },
  };
}

const SALE = [
  { productId: CHAI, qty: 1 },
  { productId: CHIPS, qty: 2 },
];

test("cache hit: every product is in the cached list, so there is no read", async () => {
  const { deps, calls } = fakeLinks([{ _id: CHAI, stockUse: CHAI_USE }, { _id: CHIPS }]);
  assert.deepEqual(await stockUsedForSale(SALE, undefined, deps), [
    { itemId: MILK, qty: 150 },
    { itemId: SUGAR, qty: 10 },
  ]);
  assert.deepEqual(calls.reads, [], "an unlinked cached product is SEEN, not re-read");
});

test("partial hit: only the ids the cache lacks (an archived item on an open tab) get ONE read", async () => {
  const { deps, calls } = fakeLinks([{ _id: CHAI, stockUse: CHAI_USE }], [{ _id: CHIPS, stockUse: CHIPS_USE }]);
  const used = await stockUsedForSale(SALE, undefined, deps);
  assert.deepEqual(calls.reads, [[CHIPS]]);
  assert.deepEqual(used?.map((u) => u.itemId), [MILK, SUGAR, PACKETS]);
});

test("cold cache: one read of every id; a product the read does not return simply has no link", async () => {
  const { deps, calls } = fakeLinks(undefined, [{ _id: CHIPS, stockUse: CHIPS_USE }]);
  assert.deepEqual(await stockUsedForSale(SALE, undefined, deps), [{ itemId: PACKETS, qty: 2000 }]);
  assert.deepEqual(calls.reads, [[CHAI, CHIPS]]);
});

test("known rows come first: the cache and the read are asked only for what they did not cover", async () => {
  const { deps, calls } = fakeLinks([{ _id: CHIPS, stockUse: [{ itemId: PACKETS, qty: 1 }] }], [{ _id: ARCHIVED, stockUse: CHIPS_USE }]);
  const used = await stockUsedForSale([...SALE, { productId: ARCHIVED, qty: 1 }], [{ _id: CHAI, stockUse: CHAI_USE }, { _id: CHIPS, stockUse: CHIPS_USE }], deps);
  assert.deepEqual(calls.reads, [[ARCHIVED]], "only the reward dish the create read never saw");
  assert.deepEqual(used?.find((u) => u.itemId === PACKETS)?.qty, 3000, "the known row's link wins over the cached one");
  const allKnown = fakeLinks(undefined);
  await stockUsedForSale(SALE, [{ _id: CHAI }, { _id: CHIPS }], allKnown.deps);
  assert.deepEqual([allKnown.calls.cache, allKnown.calls.reads.length], [0, 0], "nothing left: neither is asked");
});

test("a read that throws (or a cache that throws) answers undefined: no deduct, never a refused sale", async () => {
  const reading = fakeLinks(undefined);
  reading.deps.findLinks = async () => {
    throw new Error("db down");
  };
  assert.equal(await stockUsedForSale(SALE, undefined, reading.deps), undefined);
  const caching = fakeLinks(undefined);
  caching.deps.cachedProducts = () => {
    throw new Error("sync boom");
  };
  assert.equal(await stockUsedForSale(SALE, undefined, caching.deps), undefined);
});

test("lines with no usable product id are skipped before any lookup", async () => {
  const { deps, calls } = fakeLinks(undefined);
  assert.equal(await stockUsedForSale([{ productId: "custom", qty: 1 }], undefined, deps), undefined);
  assert.deepEqual([calls.cache, calls.reads.length], [0, 0]);
});

// ── the Pay Now create runner's stock move ────────────────────────────────────────────────────────────────────

const USED = [{ itemId: PACKETS, qty: 3000 }];
const LANDED = { _id: "665f00000000000000000099", orderId: "A-0042", status: "Completed", createdAt: new Date(0), total: 60 };

function createDeps(stock: Array<[unknown, number]>, moveThrows = false): CreateFollowUpDeps {
  return {
    issueBillNumbers: (async () => null) as unknown as CreateFollowUpDeps["issueBillNumbers"],
    backfillPromoRedemptionOrderId: async () => {},
    markAssignedRewardUsed: async () => {},
    advanceRewardProgress: async () => ({ counted: false, reason: "levels-off" }),
    incCustomerLedger: async () => {},
    occupyTable: async () => {},
    moveStock: async (used, sign) => {
      stock.push([used, sign]);
      if (moveThrows) throw new Error("stock down");
    },
  };
}
const createInput = (landed: Partial<CreateFollowUpInput["landed"]>): CreateFollowUpInput => ({
  landed: { ...LANDED, ...landed },
  settings: { cafeName: "x" } as unknown as ISettings,
  numbering: {},
  ledger: { payment: "Cash", total: 60, paidAmount: 60, status: "Completed" },
  promoTrace: null,
  promoSpent: null,
});

test("create: a Completed (Pay Now) insert carrying a snapshot takes exactly it out (sign -1)", async () => {
  const stock: Array<[unknown, number]> = [];
  await runCreateFollowUps(createInput({ stockUsed: USED }), createDeps(stock));
  assert.deepEqual(stock, [[USED, STOCK_TAKE]]);
  assert.deepEqual([STOCK_TAKE, STOCK_GIVE_BACK], [-1, 1], "the signs are the take-out and the put-back");
});

test("create: an open tab (any non-Completed status) or no snapshot moves nothing", async () => {
  for (const landed of [{ status: "Pending", stockUsed: USED }, { status: "completed", stockUsed: USED }, { stockUsed: [] }, {}]) {
    const stock: Array<[unknown, number]> = [];
    await runCreateFollowUps(createInput(landed), createDeps(stock));
    assert.deepEqual(stock, [], JSON.stringify(landed));
  }
});

test("create: a stock move that throws is swallowed; the numbering result is intact", async () => {
  const stock: Array<[unknown, number]> = [];
  const out = await runCreateFollowUps(createInput({ stockUsed: USED }), createDeps(stock, true));
  assert.equal(stock.length, 1, "landmark: the move really ran");
  assert.deepEqual(out.numbered, { status: "fulfilled", value: null });
});
