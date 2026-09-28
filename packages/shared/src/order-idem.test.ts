import { test } from "node:test";
import assert from "node:assert/strict";
import type { Order, OrderItem, OrderVoid } from "./types";
import {
  KOT_IDEM_KEY_NONE,
  IDEM_KEY_MISMATCH_ERROR,
  IDEM_REPLAY_CANCELLED_ERROR,
  buildKotIdemKeys,
  kotRoundOfIdemKey,
  sameRoundItems,
  idemReplayVerdict,
} from "./order-idem";
import { addItemsSchema, createOrderSchema, idemKeySchema, updateOrderSchema } from "./schemas/order.schema";

// F5 S3 — the pure half of the send idempotency contract. The server routes
// (apps/cafe/lib/order-idem.ts) and the POS send controller both call these,
// so a replay is decided by ONE rule on both sides.

const KEY_A = "3f1c2a9e-7b4d-4c8a-9e21-5d6f7a8b9c0d";
const KEY_B = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const CHAI = "64b7f0c2a1d2e3f4a5b6c7d8";
const BUN = "64b7f0c2a1d2e3f4a5b6c7d9";

function line(productId: string, qty: number, kotRound: number, extra: Partial<OrderItem> = {}): OrderItem {
  return { productId, name: "x", price: 20, qty, modifiers: [], instructions: "", kotRound, ...extra };
}

function voided(productId: string, qty: number, kotRound: number, extra: Partial<OrderVoid> = {}): OrderVoid {
  return { productId, name: "x", price: 20, qty, kotRound, reason: "guest changed mind", voidedBy: "a", at: "t", ...extra };
}

function order(extra: Partial<Order> = {}): Order {
  return {
    _id: "o1", orderId: "ORD-1", customerName: "Walk-In", items: [], subtotal: 0, discount: 0,
    total: 0, paidAmount: 0, payment: "Unpaid", status: "Pending", receiver: "a", kotRounds: 1,
    createdAt: "t", updatedAt: "t", ...extra,
  };
}

// ── F5 — the send idempotency key (`idemKey`). One UUID the POS mints per Send
// to Kitchen / Pay Now attempt, so a re-send after "Couldn't confirm" replays
// the order or round that already landed instead of making a second one.
// createOrderSchema is NOT .strict(): an undeclared key is silently STRIPPED,
// so without the declaration the route never sees the key and the dedupe is
// dead with every other test still green. addItemsSchema IS .strict(), so an
// undeclared key there is a 400 on every round the new client sends.

const sampleItems = [{ productId: CHAI, name: "Chai", price: 20, qty: 1 }];
const sampleOrder = {
  customerName: "Walk-in",
  items: sampleItems,
  subtotal: 20,
  total: 20,
  paidAmount: 20,
  payment: "Cash",
  receiver: "cashier",
};
// mintDeviceId's no-randomUUID fallback shape (32 hex, no dashes) — NOT a UUID,
// so the client must never send it as a key (integrated plan M1).
const HEX32_NOT_A_UUID = "0123456789abcdef0123456789abcdef";

test("createOrderSchema KEEPS idemKey — it must not be stripped as an unknown key", () => {
  const r = createOrderSchema.safeParse({ ...sampleOrder, idemKey: KEY_A });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.idemKey, KEY_A);
});

test("createOrderSchema: idemKey stays optional — a keyless (older) client still parses, with no key", () => {
  const r = createOrderSchema.safeParse(sampleOrder);
  assert.equal(r.success, true);
  assert.equal(r.success && "idemKey" in r.data, false);
});

test("addItemsSchema accepts idemKey (strict payload) and still rejects an unknown key beside it", () => {
  const r = addItemsSchema.safeParse({ items: sampleItems, idemKey: KEY_A });
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.idemKey, KEY_A);
  assert.equal(
    addItemsSchema.safeParse({ items: sampleItems, idemKey: KEY_A, bogus: 1 }).success,
    false,
  );
});

test("idemKey rejects a non-UUID on both payloads — including the 32-hex device-id fallback", () => {
  for (const bad of ["not-a-uuid", "", HEX32_NOT_A_UUID]) {
    assert.equal(createOrderSchema.safeParse({ ...sampleOrder, idemKey: bad }).success, false, bad);
    assert.equal(addItemsSchema.safeParse({ items: sampleItems, idemKey: bad }).success, false, bad);
    assert.equal(idemKeySchema.safeParse(bad).success, false, bad);
  }
});

test("idemKeySchema accepts what the client mints: crypto.randomUUID() output (RFC-4122 v4)", () => {
  for (let i = 0; i < 20; i++) {
    const k = crypto.randomUUID();
    assert.equal(idemKeySchema.safeParse(k).success, true, k);
  }
  assert.equal(idemKeySchema.safeParse(KEY_A).success, true);
});

test("updateOrderSchema stays keyless — idemKey is a send key, not editable metadata", () => {
  assert.equal(updateOrderSchema.safeParse({ idemKey: KEY_A }).success, false);
});

// ── buildKotIdemKeys — positional, the same idiom as the kotNumbers build ────

test("buildKotIdemKeys: no key → undefined (the round writes nothing; a keyless client is unchanged)", () => {
  assert.equal(buildKotIdemKeys(undefined, 1, undefined), undefined);
  assert.equal(buildKotIdemKeys([KEY_A], 2, undefined), undefined);
});

test("buildKotIdemKeys: round N's key lands at index N-1, earlier slots keep their keys", () => {
  assert.deepEqual(buildKotIdemKeys(undefined, 1, KEY_A), [KEY_A]);
  assert.deepEqual(buildKotIdemKeys([KEY_A], 2, KEY_B), [KEY_A, KEY_B]);
});

test("buildKotIdemKeys: a short array (keyless rounds) backfills the sentinel, never appends into the wrong slot", () => {
  assert.deepEqual(buildKotIdemKeys(undefined, 3, KEY_A), [KOT_IDEM_KEY_NONE, KOT_IDEM_KEY_NONE, KEY_A]);
  assert.deepEqual(buildKotIdemKeys([KEY_A], 3, KEY_B), [KEY_A, KOT_IDEM_KEY_NONE, KEY_B]);
});

test("buildKotIdemKeys: never mutates the stored array", () => {
  const old = [KEY_A];
  buildKotIdemKeys(old, 2, KEY_B);
  assert.deepEqual(old, [KEY_A]);
});

// ── kotRoundOfIdemKey ───────────────────────────────────────────────────────

test("kotRoundOfIdemKey: the round the key was fired as (index + 1)", () => {
  const o = order({ kotRounds: 3, kotIdemKeys: [KEY_A, KOT_IDEM_KEY_NONE, KEY_B] });
  assert.equal(kotRoundOfIdemKey(o, KEY_A), 1);
  assert.equal(kotRoundOfIdemKey(o, KEY_B), 3);
});

test("kotRoundOfIdemKey: an unknown key, or a tab with no keys at all, is undefined", () => {
  assert.equal(kotRoundOfIdemKey(order({ kotIdemKeys: [KEY_A] }), KEY_B), undefined);
  assert.equal(kotRoundOfIdemKey(order(), KEY_A), undefined);
});

test("kotRoundOfIdemKey: the backfill sentinel never matches, even though the array holds it", () => {
  const o = order({ kotRounds: 2, kotIdemKeys: [KOT_IDEM_KEY_NONE, KEY_A] });
  assert.equal(kotRoundOfIdemKey(o, KOT_IDEM_KEY_NONE), undefined);
});

// ── sameRoundItems ──────────────────────────────────────────────────────────

test("sameRoundItems: the round's stored lines match what was sent", () => {
  const sent = [{ productId: CHAI, qty: 2 }, { productId: BUN, qty: 1 }];
  assert.equal(sameRoundItems(sent, [line(CHAI, 2, 1), line(BUN, 1, 1)], [], 1), true);
});

test("sameRoundItems: a qty, product or missing-line difference is a mismatch", () => {
  const stored = [line(CHAI, 2, 1)];
  assert.equal(sameRoundItems([{ productId: CHAI, qty: 3 }], stored, [], 1), false);
  assert.equal(sameRoundItems([{ productId: BUN, qty: 2 }], stored, [], 1), false);
  assert.equal(sameRoundItems([{ productId: CHAI, qty: 2 }, { productId: BUN, qty: 1 }], stored, [], 1), false);
  assert.equal(sameRoundItems([], stored, [], 1), false);
});

test("sameRoundItems: a void between landing and the re-send is added back — still the same round", () => {
  const sent = [{ productId: CHAI, qty: 2 }];
  assert.equal(sameRoundItems(sent, [line(CHAI, 1, 1)], [voided(CHAI, 1, 1)], 1), true);
  // A whole line voided away (spliced out of items[]) is added back too.
  assert.equal(sameRoundItems(sent, [], [voided(CHAI, 2, 1)], 1), true);
});

test("sameRoundItems: only THIS round's lines and voids count", () => {
  const sent = [{ productId: CHAI, qty: 1 }];
  const stored = [line(CHAI, 5, 1), line(CHAI, 1, 2)];
  assert.equal(sameRoundItems(sent, stored, [], 2), true);
  assert.equal(sameRoundItems(sent, stored, [voided(CHAI, 1, 1)], 2), true);
  assert.equal(sameRoundItems(sent, stored, [voided(CHAI, 1, 2)], 2), false);
});

test("sameRoundItems: the server's own reward line (and its void) is not something the client sent", () => {
  const sent = [{ productId: CHAI, qty: 1 }];
  const stored = [line(CHAI, 1, 1), line(BUN, 1, 1, { reward: true })];
  assert.equal(sameRoundItems(sent, stored, [voided(BUN, 1, 1, { reward: true })], 1), true);
});

test("sameRoundItems: a variation is its own line — a Small is not a Large", () => {
  const stored = [line(CHAI, 1, 1, { variation: "Large" })];
  assert.equal(sameRoundItems([{ productId: CHAI, qty: 1, variation: "Large" }], stored, [], 1), true);
  assert.equal(sameRoundItems([{ productId: CHAI, qty: 1, variation: "Small" }], stored, [], 1), false);
  assert.equal(sameRoundItems([{ productId: CHAI, qty: 1 }], stored, [], 1), false);
});

test("sameRoundItems: lines of one dish are summed on both sides (modifier splits, cart duplicates)", () => {
  const sent = [{ productId: CHAI, qty: 1 }, { productId: CHAI, qty: 1 }];
  assert.equal(sameRoundItems(sent, [line(CHAI, 2, 1)], [], 1), true);
});

test("sameRoundItems: a stored ObjectId productId (lean doc) matches the sent hex string", () => {
  const objectIdLike = { toString: () => CHAI };
  const stored = [{ productId: objectIdLike, qty: 1, kotRound: 1 }];
  assert.equal(sameRoundItems([{ productId: CHAI, qty: 1 }], stored, [], 1), true);
});

// ── idemReplayVerdict ───────────────────────────────────────────────────────

test("idemReplayVerdict: the same round landed → replay (open tab or a completed Pay Now)", () => {
  const sent = [{ productId: CHAI, qty: 1 }];
  assert.deepEqual(idemReplayVerdict(order({ items: [line(CHAI, 1, 1)] }), sent, 1), { kind: "replay" });
  assert.deepEqual(
    idemReplayVerdict(order({ status: "Completed", items: [line(CHAI, 1, 1)] }), sent, 1),
    { kind: "replay" },
  );
});

test("idemReplayVerdict: a cancelled order refuses even when its items match (no KOT for a cancelled order)", () => {
  const o = order({ status: "Cancelled", items: [line(CHAI, 1, 1)] });
  assert.deepEqual(idemReplayVerdict(o, [{ productId: CHAI, qty: 1 }], 1), {
    kind: "refuse",
    error: IDEM_REPLAY_CANCELLED_ERROR,
  });
});

test("idemReplayVerdict: a key re-used for different items refuses — never a silent partial replay", () => {
  const o = order({ items: [line(CHAI, 1, 1)] });
  assert.deepEqual(idemReplayVerdict(o, [{ productId: CHAI, qty: 2 }], 1), {
    kind: "refuse",
    error: IDEM_KEY_MISMATCH_ERROR,
  });
});
