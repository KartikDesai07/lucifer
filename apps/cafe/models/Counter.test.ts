import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose, { type Connection, type Model } from "mongoose";
import {
  Counter,
  counterModelFor,
  nextOrderSequence,
  nextSlipSequence,
  bumpOrderSequenceTo,
  __setCounterModelResolverForTests,
} from "./Counter";
import { cafeDateString } from "@/lib/utils";

// F2 Step F2.3 — the connection-aware atomic order-sequence allocator, proven
// DB-FREE. The selection logic (`counterModelFor`) is asserted directly against a
// real (unconnected) `createConnection`; the allocator behaviour (IST cafe-day key,
// the single atomic `$inc`/`$max` op shape, the `?? 1` fallback, and the
// connection pass-through) is asserted via an injected fake counter-model resolver.
// The LIVE $inc concurrency race + socket round-trip run against a seeded M0 in F2's
// integration pass (the same static-now / live-later split as order.ledger.test).

interface ICounter {
  _id: string;
  seq: number;
}
interface RecordedCall {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
  options: Record<string, unknown>;
}

// A fake Counter model recording every findOneAndUpdate call and returning a
// controllable result. The return value is a Promise (so `bumpOrderSequenceTo`'s
// `$max` path can `await` it directly) that also carries a `.lean()` (so
// `nextOrderSequence`'s `.findOneAndUpdate(...).lean()` chain resolves).
function makeFakeCounter(result: ICounter | null): {
  model: Model<ICounter>;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const model = {
    findOneAndUpdate(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options: Record<string, unknown>,
    ) {
      calls.push({ filter, update, options });
      const p = Promise.resolve(result) as Promise<ICounter | null> & {
        lean: () => Promise<ICounter | null>;
      };
      p.lean = () => Promise.resolve(result);
      return p;
    },
  } as unknown as Model<ICounter>;
  return { model, calls };
}

const dayKey = (d: Date) => `order-${cafeDateString(d).replace(/-/g, "")}`;
const slipKey = (series: "kot" | "bill", d: Date) => `${series}-${cafeDateString(d).replace(/-/g, "")}`;
const FIXED = new Date("2026-07-15T10:00:00Z");

const openedConns: Connection[] = [];
function freshConn(): Connection {
  const c = mongoose.createConnection(); // unconnected — binds models offline
  openedConns.push(c);
  return c;
}

beforeEach(() => {
  __setCounterModelResolverForTests(null);
});
afterEach(async () => {
  __setCounterModelResolverForTests(null);
  await Promise.all(openedConns.splice(0).map((c) => c.close().catch(() => {})));
});

// ── counterModelFor — model selection (default vs routed) ─────────────────────
test("counterModelFor(null/undefined) returns the v1 default-bound Counter", () => {
  assert.equal(counterModelFor(), Counter);
  assert.equal(counterModelFor(null), Counter);
  assert.equal(counterModelFor(undefined), Counter);
});

test("counterModelFor(conn) binds the Counter on the routed ledger connection, not the default", () => {
  const conn = freshConn();
  const bound = counterModelFor(conn);
  assert.equal(bound.modelName, "Counter");
  assert.notEqual(bound, Counter, "a routed connection gets its OWN Counter binding");
  assert.equal(bound.db, conn, "bound on the ledger connection's pool (#21 schemas-not-models)");
  assert.equal(counterModelFor(conn), bound, "idempotent per connection — no recompile / OverwriteModelError");
});

// ── nextOrderSequence — atomic $inc on the cafe-day key ───────────────────────
test("nextOrderSequence: single atomic $inc on the IST cafe-day key; passes the routed connection through", async () => {
  const fake = makeFakeCounter({ _id: dayKey(FIXED), seq: 7 });
  let seenConn: unknown = "unset";
  __setCounterModelResolverForTests((conn) => {
    seenConn = conn;
    return fake.model;
  });
  const conn = freshConn();
  const seq = await nextOrderSequence(conn, FIXED);

  assert.equal(seq, 7, "returns the counter's incremented seq");
  assert.equal(seenConn, conn, "resolved the Counter on the routed ledger connection");
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].filter, { _id: dayKey(FIXED) }, "IST cafe-day key");
  assert.deepEqual(fake.calls[0].update, { $inc: { seq: 1 } }, "ONE atomic increment — no read-then-write race");
  assert.deepEqual(fake.calls[0].options, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
});

test("nextOrderSequence falls back to seq 1 when the upsert returns no doc", async () => {
  const fake = makeFakeCounter(null);
  __setCounterModelResolverForTests(() => fake.model);
  assert.equal(await nextOrderSequence(null), 1);
});

test("nextOrderSequence() (v1 form, no connection) forwards no connection → default-bound Counter", async () => {
  const fake = makeFakeCounter({ _id: dayKey(new Date()), seq: 3 });
  let seenConn: unknown = "unset";
  __setCounterModelResolverForTests((conn) => {
    seenConn = conn;
    return fake.model;
  });
  await nextOrderSequence();
  assert.equal(seenConn, undefined, "v1 nextOrderSequence() passes no connection (resolver falls back to default)");
});

// ── bumpOrderSequenceTo — $max floor then allocate (both call forms) ──────────
test("bumpOrderSequenceTo(conn, floor, date): raises the day counter to the floor, then allocates — on the routed connection", async () => {
  const fake = makeFakeCounter({ _id: dayKey(FIXED), seq: 51 });
  const seen: (Connection | null | undefined)[] = [];
  __setCounterModelResolverForTests((conn) => {
    seen.push(conn);
    return fake.model;
  });
  const conn = freshConn();
  const seq = await bumpOrderSequenceTo(conn, 50, FIXED);

  assert.equal(seq, 51, "allocates the next seq after raising the floor");
  assert.equal(fake.calls.length, 2, "two ops: $max then $inc");
  assert.deepEqual(fake.calls[0].update, { $max: { seq: 50 } }, "raise the day counter to at least the floor");
  assert.deepEqual(fake.calls[0].options, { upsert: true, setDefaultsOnInsert: true });
  assert.deepEqual(fake.calls[1].update, { $inc: { seq: 1 } }, "then the normal atomic allocate");
  assert.equal(fake.calls[0].filter._id, dayKey(FIXED));
  assert.equal(fake.calls[1].filter._id, dayKey(FIXED));
  assert.deepEqual(seen, [conn, conn], "BOTH ops routed to the same ledger connection");
});

test("bumpOrderSequenceTo(floor) — the legacy v1 form — routes to the default Counter (no connection), keeping v1's call site green", async () => {
  const fake = makeFakeCounter({ _id: dayKey(new Date()), seq: 9 });
  const seen: (Connection | null | undefined)[] = [];
  __setCounterModelResolverForTests((conn) => {
    seen.push(conn);
    return fake.model;
  });
  const seq = await bumpOrderSequenceTo(8); // v1 positional call: floor only

  assert.equal(seq, 9);
  assert.deepEqual(fake.calls[0].update, { $max: { seq: 8 } });
  assert.deepEqual(seen, [null, null], "legacy form passes conn=null (falsy) → default-bound Counter, both ops");
});

// ── nextSlipSequence — the printed-slip series (CR1.7 print customization) ──
// Mirrors nextOrderSequence's own tests above: DB-free via the same injected
// fake counter-model resolver, proving the atomic op shape, the IST cafe-day
// key (per series prefix), and the seq fallback — never the live $inc race
// itself (that stays in the M0 live leg, same static-now/live-later split).

test("nextSlipSequence('kot'): single atomic $inc on the kot-<cafe-day> key; passes the routed connection through", async () => {
  const fake = makeFakeCounter({ _id: slipKey("kot", FIXED), seq: 4 });
  let seenConn: unknown = "unset";
  __setCounterModelResolverForTests((conn) => {
    seenConn = conn;
    return fake.model;
  });
  const conn = freshConn();
  const seq = await nextSlipSequence("kot", conn, FIXED);

  assert.equal(seq, 4, "returns the counter's incremented seq");
  assert.equal(seenConn, conn, "resolved the Counter on the routed ledger connection");
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].filter, { _id: slipKey("kot", FIXED) }, "IST cafe-day key, kot- prefixed");
  assert.deepEqual(fake.calls[0].update, { $inc: { seq: 1 } }, "ONE atomic increment — no read-then-write race");
  assert.deepEqual(fake.calls[0].options, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
});

test("nextSlipSequence('bill'): same atomic op shape, keyed bill-<cafe-day>", async () => {
  const fake = makeFakeCounter({ _id: slipKey("bill", FIXED), seq: 1 });
  __setCounterModelResolverForTests(() => fake.model);
  const seq = await nextSlipSequence("bill", null, FIXED);

  assert.equal(seq, 1);
  assert.deepEqual(fake.calls[0].filter, { _id: slipKey("bill", FIXED) });
  assert.deepEqual(fake.calls[0].update, { $inc: { seq: 1 } });
  assert.deepEqual(fake.calls[0].options, { upsert: true, new: true, setDefaultsOnInsert: true });
});

test("nextSlipSequence: 'kot' and 'bill' produce DIFFERENT keys for the SAME date — a shared key would make one tab's kitchen ticket and its bill fight over the same number", async () => {
  const kotFake = makeFakeCounter({ _id: slipKey("kot", FIXED), seq: 1 });
  __setCounterModelResolverForTests(() => kotFake.model);
  await nextSlipSequence("kot", null, FIXED);
  const kotFilterKey = kotFake.calls[0].filter._id;

  const billFake = makeFakeCounter({ _id: slipKey("bill", FIXED), seq: 1 });
  __setCounterModelResolverForTests(() => billFake.model);
  await nextSlipSequence("bill", null, FIXED);
  const billFilterKey = billFake.calls[0].filter._id;

  assert.notEqual(kotFilterKey, billFilterKey, "kot and bill must never share a counter document");
  assert.equal(kotFilterKey, "kot-20260715");
  assert.equal(billFilterKey, "bill-20260715");
});

test("nextSlipSequence: neither 'kot' nor 'bill' collides with the order counter's order-<date> key", () => {
  const kot = slipKey("kot", FIXED);
  const bill = slipKey("bill", FIXED);
  const order = dayKey(FIXED);
  assert.notEqual(kot, order);
  assert.notEqual(bill, order);
  assert.notEqual(kot, bill);
});

test("nextSlipSequence: the day key comes from the IST cafe-day — two instants either side of IST midnight (UTC 18:30) produce different keys", async () => {
  // 18:29:59.999Z is still 23:59:59.999 IST on the 15th; 18:30:00.000Z is
  // exactly 00:00:00.000 IST on the 16th — the boundary itself, not just
  // "some time before/after".
  const justBeforeMidnightIst = new Date("2026-07-15T18:29:59.999Z");
  const justAfterMidnightIst = new Date("2026-07-15T18:30:00.000Z");

  const fakeBefore = makeFakeCounter({ _id: "irrelevant", seq: 1 });
  __setCounterModelResolverForTests(() => fakeBefore.model);
  await nextSlipSequence("kot", null, justBeforeMidnightIst);

  const fakeAfter = makeFakeCounter({ _id: "irrelevant", seq: 1 });
  __setCounterModelResolverForTests(() => fakeAfter.model);
  await nextSlipSequence("kot", null, justAfterMidnightIst);

  assert.equal(fakeBefore.calls[0].filter._id, "kot-20260715");
  assert.equal(fakeAfter.calls[0].filter._id, "kot-20260716");
  assert.notEqual(fakeBefore.calls[0].filter._id, fakeAfter.calls[0].filter._id);
});

test("nextSlipSequence falls back to seq 1 when the upsert returns no doc (same as the order sequence)", async () => {
  const fake = makeFakeCounter(null);
  __setCounterModelResolverForTests(() => fake.model);
  assert.equal(await nextSlipSequence("kot", null), 1);
  assert.equal(await nextSlipSequence("bill", null), 1);
});
