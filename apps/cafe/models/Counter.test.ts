import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose, { type Connection, type Model } from "mongoose";
import {
  Counter,
  counterModelFor,
  nextOrderSequence,
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
