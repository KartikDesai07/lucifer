import { test } from "node:test";
import assert from "node:assert/strict";
import { Order } from "@/models/Order";
import { orderSchema as ledgerOrderSchema } from "@/models/order.ledger";
import { IDEM_KEY_MISMATCH_ERROR, IDEM_REPLAY_CANCELLED_ERROR } from "@pos/shared/order-idem";
import { BILL_NUMBER_UNCONFIRMED } from "./slip-numbers";
import type { BillNumberingPlan } from "./gst-invoice";
import {
  BILL_NUMBER_PENDING_ERROR,
  BILL_NUMBER_SETTLE_MS,
  createReplayVerdict,
  idemGuardFilter,
  isIdemKeyDuplicate,
  roundReplayResponse,
} from "./order-idem";

// DB-free half of the F5 send idempotency key on the cafe side: the model
// declares both paths (strict mode silently drops an undeclared one), the
// unique index is byte-identical to the ledger's, and the pure replay helpers
// answer exactly the envelope the routes return.

const KEY = "2f1c7d0a-8b4e-4c3a-9d6f-1e2a3b4c5d6e";
const OTHER = "7a9b8c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const TEA = "665f000000000000000000a1";
const CAKE = "665f000000000000000000a2";

type IndexSpec = [Record<string, unknown>, Record<string, unknown>];
function indexOn(schema: { indexes(): IndexSpec[] }, field: string): IndexSpec | undefined {
  return schema.indexes().find(([fields]) => Object.keys(fields).length === 1 && field in fields);
}

test("Order carries the idemKey unique PARTIAL index, deep-equal to the ledger's own", () => {
  const mine = indexOn(Order.schema, "idemKey");
  const ledger = indexOn(ledgerOrderSchema, "idemKey");
  assert.ok(ledger, "landmark: the ledger schema still reserves the index");
  assert.ok(mine, "models/Order.ts must declare the idemKey index");
  assert.deepEqual(mine, ledger);
  // Mongoose stamps `background: true` on every schema index; not ours to pin.
  const { background: _background, ...options } = mine[1];
  assert.deepEqual(options, {
    unique: true,
    partialFilterExpression: { idemKey: { $exists: true } },
    name: "idemKey_unique_partial",
  });
  assert.equal(indexOn(Order.schema, "kotIdemKeys"), undefined, "no index on the positional array (the CAS is by _id)");
});

test("both paths are declared, omit-empty: a keyless order stores neither key; a keyed one keeps both", () => {
  const idem = Order.schema.path("idemKey");
  const kot = Order.schema.path("kotIdemKeys");
  assert.equal(idem?.instance, "String");
  assert.equal(kot?.instance, "Array");
  assert.equal(idem.options.default, undefined);
  assert.ok("default" in kot.options && kot.options.default === undefined, "the array must be default: undefined, never []");

  const base = { orderId: "ORD-X", customerName: "Walk-in", items: [], subtotal: 0, total: 0, paidAmount: 0, payment: "Cash", receiver: "Staff" };
  const keyless = new Order(base).toObject();
  assert.ok(!("idemKey" in keyless) && !("kotIdemKeys" in keyless), "omit-empty: no key, no empty array");
  const keyed = new Order({ ...base, idemKey: KEY, kotIdemKeys: [KEY] }).toObject();
  assert.equal(keyed.idemKey, KEY, "strict mode must not strip the key");
  assert.deepEqual(keyed.kotIdemKeys, [KEY]);
});

test("isIdemKeyDuplicate: only an E11000 on the idemKey index", () => {
  assert.equal(isIdemKeyDuplicate({ code: 11000, keyPattern: { idemKey: 1 } }), true);
  assert.equal(isIdemKeyDuplicate({ code: 11000, keyPattern: { orderId: 1 } }), false, "an orderId collision is the renumber path");
  assert.equal(isIdemKeyDuplicate({ code: 11000 }), false);
  assert.equal(isIdemKeyDuplicate({ keyPattern: { idemKey: 1 } }), false, "not a duplicate-key error at all");
  for (const v of [null, undefined, "E11000", 11000]) assert.equal(isIdemKeyDuplicate(v), false);
});

test("idemGuardFilter: nothing without a key; with one, the CAS refuses a tab that already holds it", () => {
  assert.deepEqual(idemGuardFilter(undefined), {});
  assert.deepEqual(idemGuardFilter(KEY), { kotIdemKeys: { $ne: KEY } });
});

const tab = {
  status: "Pending",
  kotIdemKeys: ["", KEY],
  items: [
    { productId: TEA, qty: 1, kotRound: 1 },
    { productId: CAKE, qty: 2, kotRound: 2 },
  ],
  voids: [],
};

test("roundReplayResponse: a key this tab never fired → null (a normal send follows)", () => {
  assert.equal(roundReplayResponse(tab, OTHER, [{ productId: CAKE, qty: 2 }]), null);
  assert.equal(roundReplayResponse({ ...tab, kotIdemKeys: undefined }, KEY, [{ productId: CAKE, qty: 2 }]), null);
  assert.equal(roundReplayResponse(tab, "", [{ productId: TEA, qty: 1 }]), null, "the keyless sentinel never matches");
});

test("roundReplayResponse: the landed round replays as 200 with the tab; a mismatch or a cancel is a 409", async () => {
  const replay = roundReplayResponse(tab, KEY, [{ productId: CAKE, qty: 2 }]);
  assert.equal(replay?.status, 200);
  const body = (await replay?.json()) as { success: boolean; data: { kotIdemKeys: string[] } };
  assert.equal(body.success, true);
  assert.deepEqual(body.data.kotIdemKeys, ["", KEY]);

  const mismatch = roundReplayResponse(tab, KEY, [{ productId: CAKE, qty: 3 }]);
  assert.equal(mismatch?.status, 409);
  assert.deepEqual(await mismatch?.json(), { success: false, error: IDEM_KEY_MISMATCH_ERROR });

  const cancelled = roundReplayResponse({ ...tab, status: "Cancelled" }, KEY, [{ productId: CAKE, qty: 2 }]);
  assert.equal(cancelled?.status, 409);
  assert.deepEqual(await cancelled?.json(), { success: false, error: IDEM_REPLAY_CANCELLED_ERROR });
});

// ── S1: a numbered cafe's Pay Now sale is not replayable until it holds its number ──

const T0 = Date.UTC(2026, 8, 29, 12, 0, 0);
const at = (ageMs: number) => new Date(T0 - ageMs);
const SALE = { _id: "665f0000000000000000ab01", status: "Completed", total: 100, items: [{ productId: TEA, qty: 1, kotRound: 1 }], voids: [], createdAt: at(0) };
const SENT = [{ productId: TEA, qty: 1 }];
const BILL_NO = 42;
const NUMBERING = { showNumber: true, numberStart: 1, resetMinutes: 0 };
const UNNUMBERED = { showNumber: false, numberStart: 1, resetMinutes: 0 };

/** Fake numbering deps on a fixed server clock; records every issueBillNumbers call. */
function numberingDeps(result: "numbered" | "null" | "throw" = "numbered") {
  const calls: Array<[unknown, BillNumberingPlan]> = [];
  return {
    calls,
    deps: {
      now: () => T0,
      issueBillNumbers: async (id: unknown, plan: BillNumberingPlan) => {
        calls.push([id, plan]);
        if (result === "throw") throw new Error("counter down");
        return result === "null" ? null : { ...SALE, billNumber: BILL_NO };
      },
    },
  };
}

test("BILL_NUMBER_SETTLE_MS is 30 s, well past the winner's own <8 s numbering", () => {
  assert.equal(BILL_NUMBER_SETTLE_MS, 30 * 1000);
  assert.equal(BILL_NUMBER_PENDING_ERROR, "The sale is still being saved. Tap Send again in a moment.");
});

test("createReplayVerdict: a YOUNG unnumbered Completed sale answers the retryable 503 and never numbers it", async () => {
  for (const age of [0, BILL_NUMBER_SETTLE_MS - 1]) {
    const { calls, deps } = numberingDeps();
    const pending = await createReplayVerdict({ ...SALE, createdAt: at(age) }, SENT, NUMBERING, deps);
    assert.equal(pending.status, 503, `age ${age}ms`);
    assert.deepEqual(await pending.json(), { success: false, error: BILL_NUMBER_PENDING_ERROR });
    assert.equal(calls.length, 0, "a young order is the concurrent winner's window: no second draw");
  }
  for (const createdAt of [undefined, "not a date"]) {
    const { calls, deps } = numberingDeps();
    const unknown = await createReplayVerdict({ ...SALE, createdAt }, SENT, NUMBERING, deps);
    assert.equal(unknown.status, 503, "an unknown age is treated as young");
    assert.equal(calls.length, 0);
  }
});

test("createReplayVerdict: an OLD unnumbered Completed sale is numbered by the replay — exactly once — and answers 200", async () => {
  for (const age of [BILL_NUMBER_SETTLE_MS, BILL_NUMBER_SETTLE_MS * 10]) {
    const { calls, deps } = numberingDeps();
    const old = { ...SALE, createdAt: at(age) };
    const reply = await createReplayVerdict(old, SENT, { showNumber: true, numberStart: 500, resetMinutes: 240 }, deps);
    assert.equal(reply.status, 200, `age ${age}ms`);
    const body = (await reply.json()) as { success: boolean; data: { billNumber?: number } };
    assert.equal(body.success, true);
    assert.equal(body.data.billNumber, BILL_NO, "the answer is the NUMBERED order");
    assert.deepEqual(
      calls,
      [[old._id, { bill: { numberStart: 500, resetMinutes: 240 } }]],
      "one guarded issueBillNumbers on this order, handed the cafe's start AND its restart time (a non-GST sale: no invoice)",
    );
  }
});

test("createReplayVerdict: an old sale whose numbering fails is a 500 with the unconfirmed copy; one that vanished is the 503", async () => {
  const old = { ...SALE, createdAt: at(BILL_NUMBER_SETTLE_MS) };
  const failed = numberingDeps("throw");
  const unconfirmed = await createReplayVerdict(old, SENT, NUMBERING, failed.deps);
  assert.equal(unconfirmed.status, 500);
  assert.deepEqual(await unconfirmed.json(), { success: false, error: BILL_NUMBER_UNCONFIRMED });
  const gone = numberingDeps("null");
  const pending = await createReplayVerdict(old, SENT, NUMBERING, gone.deps);
  assert.equal(pending.status, 503, "never a 200 without the number");
  assert.equal(gone.calls.length, 1);
});

test("createReplayVerdict: a numbered sale, an unnumbered cafe, or a Pending tab replays as 200 as stored — nothing is numbered", async () => {
  const old = at(BILL_NUMBER_SETTLE_MS * 2);
  for (const [order, bill, why] of [
    [{ ...SALE, billNumber: BILL_NO }, NUMBERING, "the sale already holds its number"],
    [{ ...SALE, createdAt: old, billNumber: BILL_NO }, NUMBERING, "an old numbered sale"],
    [SALE, UNNUMBERED, "the cafe does not number its bills"],
    [{ ...SALE, createdAt: old }, UNNUMBERED, "an old sale in a cafe that does not number"],
    [{ ...SALE, status: "Pending" }, NUMBERING, "a Send to Kitchen tab has no bill number by design"],
    [{ ...SALE, status: "Pending", createdAt: old }, NUMBERING, "an old tab is not a bill either"],
  ] as const) {
    const { calls, deps } = numberingDeps();
    const reply = await createReplayVerdict(order, SENT, bill, deps);
    assert.equal(reply.status, 200, why);
    const body = (await reply.json()) as { success: boolean; data: { status: string; billNumber?: number } };
    assert.equal(body.success, true, why);
    assert.equal(body.data.status, order.status, why);
    assert.equal(body.data.billNumber, "billNumber" in order ? BILL_NO : undefined, why);
    assert.equal(calls.length, 0, why);
  }
});

test("createReplayVerdict: a refusal still wins, young or old (a mismatch or a cancel stays 409, nothing numbered)", async () => {
  for (const createdAt of [at(0), at(BILL_NUMBER_SETTLE_MS * 2)]) {
    const { calls, deps } = numberingDeps();
    const mismatch = await createReplayVerdict({ ...SALE, createdAt }, [{ productId: TEA, qty: 2 }], NUMBERING, deps);
    assert.equal(mismatch.status, 409);
    assert.deepEqual(await mismatch.json(), { success: false, error: IDEM_KEY_MISMATCH_ERROR });
    const cancelled = await createReplayVerdict({ ...SALE, createdAt, status: "Cancelled" }, SENT, NUMBERING, deps);
    assert.equal(cancelled.status, 409);
    assert.deepEqual(await cancelled.json(), { success: false, error: IDEM_REPLAY_CANCELLED_ERROR });
    assert.equal(calls.length, 0);
  }
});

// ── S10: a GST sale also waits for its invoice serial, whatever "Show bill number" says ──

test("createReplayVerdict (S10): an old GST sale without its invoice serial is numbered by the replay in the FY of its createdAt; young = 503; a held serial = nothing", async () => {
  const GST_SALE = { ...SALE, gstMode: "exclusive" as const, gstRate: 5, gstAmount: 5, total: 105 };
  const old = { ...GST_SALE, createdAt: at(BILL_NUMBER_SETTLE_MS) };
  const numbered = numberingDeps();
  assert.equal((await createReplayVerdict(old, SENT, UNNUMBERED, numbered.deps)).status, 200);
  assert.deepEqual(numbered.calls, [[old._id, { invoiceAt: old.createdAt }]], "the invoice alone: the cafe prints no daily number");
  const both = numberingDeps();
  await createReplayVerdict(old, SENT, NUMBERING, both.deps);
  assert.deepEqual(both.calls, [[old._id, { bill: { numberStart: 1, resetMinutes: 0 }, invoiceAt: old.createdAt }]], "both numbers in one call");
  const young = numberingDeps();
  assert.equal((await createReplayVerdict({ ...GST_SALE, createdAt: at(0) }, SENT, UNNUMBERED, young.deps)).status, 503, "the winner may still be numbering it");
  assert.equal(young.calls.length, 0);
  const held = numberingDeps();
  const reply = await createReplayVerdict({ ...old, invoiceNumber: 7, invoiceFy: 2026 }, SENT, UNNUMBERED, held.deps);
  assert.equal(reply.status, 200);
  assert.equal(held.calls.length, 0, "a sale that holds its serial is replayed as stored");
  const inclusive = numberingDeps();
  await createReplayVerdict({ ...old, gstMode: "inclusive" as const, gstAmount: undefined, total: 105 }, SENT, UNNUMBERED, inclusive.deps);
  assert.equal(inclusive.calls.length, 1, "landmark: an inclusive-GST sale is a tax invoice too");
});

test("createReplayVerdict (S10 review M1): an old tab that a settle JUST landed on is still young (its updatedAt) — no second draw races the settle's own numbering", async () => {
  const GST_TAB = { ...SALE, gstMode: "exclusive" as const, gstRate: 5, gstAmount: 5, total: 105 };
  const justSettled = { ...GST_TAB, createdAt: at(BILL_NUMBER_SETTLE_MS * 80), updatedAt: at(0) };
  const racing = numberingDeps();
  const reply = await createReplayVerdict(justSettled, SENT, NUMBERING, racing.deps);
  assert.equal(reply.status, 503, "the settle may still be numbering it: the retryable answer");
  assert.equal(racing.calls.length, 0, "no replay draw while the settle's numbering may be in flight");
  const stale = { ...justSettled, updatedAt: at(BILL_NUMBER_SETTLE_MS) };
  const healed = numberingDeps();
  assert.equal((await createReplayVerdict(stale, SENT, NUMBERING, healed.deps)).status, 200, "landmark: a settle long over is healed by the replay");
  assert.equal(healed.calls.length, 1);
  const garbled = numberingDeps();
  assert.equal((await createReplayVerdict({ ...justSettled, updatedAt: "not a date" }, SENT, NUMBERING, garbled.deps)).status, 503, "an unreadable write time counts as young");
  assert.equal(garbled.calls.length, 0);
});
