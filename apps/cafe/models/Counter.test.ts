import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose, { type Connection, type Model } from "mongoose";
import {
  Counter,
  counterModelFor,
  nextOrderSequence,
  nextSlipSequence,
  slipCounterKey,
  SLIP_SERIES,
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

// ── Print customization S6: the token series + the daily restart time ───────
// `resetMinutes` shifts the business day the key names; 0 (the default, and what
// every pre-S6 caller passes implicitly) must name byte-identical keys to before.

const IST_OFFSET_MS = 330 * 60_000;
const MS_PER_MINUTE = 60_000;
const SEEDED_INSTANTS = 2_000;
const FIRST_INSTANT_MS = Date.UTC(2020, 0, 1);
const LAST_INSTANT_MS = Date.UTC(2030, 11, 31);

// mulberry32 — a tiny seeded PRNG so a failing instant reproduces.
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randomInstants = (seed: number, n: number): Date[] => {
  const next = seeded(seed);
  return Array.from({ length: n }, () => new Date(FIRST_INSTANT_MS + Math.floor(next() * (LAST_INSTANT_MS - FIRST_INSTANT_MS))));
};

// Independent of slip-day.ts: the IST calendar date by plain arithmetic on the +05:30 offset.
const istDay = (ms: number) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, "");

/** A fake counter collection: ONE atomic find-and-$inc per call, state kept per `_id`, every filter recorded. */
function makeInMemoryCounter(): { model: Model<ICounter>; store: Map<string, number>; filters: string[] } {
  const store = new Map<string, number>();
  const filters: string[] = [];
  const model = {
    findOneAndUpdate(filter: { _id: string }) {
      filters.push(filter._id);
      const seq = (store.get(filter._id) ?? 0) + 1;
      store.set(filter._id, seq);
      const p = Promise.resolve({ _id: filter._id, seq }) as Promise<ICounter> & { lean: () => Promise<ICounter> };
      p.lean = () => Promise.resolve({ _id: filter._id, seq });
      return p;
    },
  } as unknown as Model<ICounter>;
  return { model, store, filters };
}

test("SLIP_SERIES is exactly kot, bill, token (landmark for the key-shape pins below)", () => {
  assert.deepEqual([...SLIP_SERIES], ["kot", "bill", "token"]);
});

test("slipCounterKey: the token series is token-<IST day>, a third distinct prefix next to kot/bill/order", () => {
  assert.equal(slipCounterKey("token", FIXED), "token-20260715");
  const keys = new Set([slipCounterKey("kot", FIXED), slipCounterKey("bill", FIXED), slipCounterKey("token", FIXED), dayKey(FIXED)]);
  assert.equal(keys.size, 4, "token never shares a counter document with kot, bill or the order id");
});

test("slipCounterKey(series, d) === slipCounterKey(series, d, 0) === <series>-<cafeDateString(d)> for all 3 series over seeded instants", () => {
  const instants = [new Date("2026-07-15T18:29:59.999Z"), new Date("2026-07-15T18:30:00.000Z"), ...randomInstants(61, SEEDED_INSTANTS)];
  for (const d of instants) {
    for (const series of SLIP_SERIES) {
      const legacy = `${series}-${cafeDateString(d).replace(/-/g, "")}`;
      assert.equal(slipCounterKey(series, d), legacy, `${series} @ ${d.toISOString()}: the default is the pre-S6 key`);
      assert.equal(slipCounterKey(series, d, 0), legacy, `${series} @ ${d.toISOString()}: an explicit 0 is the same key`);
    }
  }
});

test("slipCounterKey with reset 240: 22:29:59.999Z is still the previous IST day's key, 22:30:00.000Z is the new one", () => {
  const before = new Date("2026-07-15T22:29:59.999Z"); // 03:59:59.999 IST on the 16th
  const after = new Date("2026-07-15T22:30:00.000Z"); // 04:00:00.000 IST on the 16th
  for (const series of SLIP_SERIES) {
    assert.equal(slipCounterKey(series, before, 240), `${series}-20260715`);
    assert.equal(slipCounterKey(series, after, 240), `${series}-20260716`);
    assert.equal(slipCounterKey(series, before, 0), `${series}-20260716`, "vision guard: the SAME instant is the 16th at reset 0");
  }
  for (const d of randomInstants(62, SEEDED_INSTANTS)) {
    assert.equal(slipCounterKey("token", d, 240), `token-${istDay(d.getTime() - 240 * MS_PER_MINUTE)}`, d.toISOString());
  }
});

test("nextSlipSequence: resetMinutes reaches the $inc filter _id (token reset 240 and kot reset 0 name different days)", async () => {
  const instant = new Date("2026-07-15T22:00:00Z"); // 03:30 IST on the 16th
  const fake = makeFakeCounter({ _id: "irrelevant", seq: 5 });
  __setCounterModelResolverForTests(() => fake.model);

  assert.equal(await nextSlipSequence("token", null, instant, 240), 5);
  await nextSlipSequence("kot", null, instant, 0);
  await nextSlipSequence("bill", null, instant);
  assert.deepEqual(
    fake.calls.map((c) => c.filter._id),
    ["token-20260715", "kot-20260716", "bill-20260716"],
    "240 -> the shifted (previous) day; 0 and omitted -> the plain IST day",
  );
  assert.deepEqual(fake.calls[0].update, { $inc: { seq: 1 } }, "restart time changes the key, never the one-$inc op shape");
  assert.deepEqual(fake.calls[0].options, { upsert: true, new: true, setDefaultsOnInsert: true });
});

test("the ORDER id key ignores the restart time: it stays on the IST midnight key while the slip series shift", async () => {
  const instant = new Date("2026-07-15T22:00:00Z"); // 03:30 IST on the 16th: reset-240 slips are still on the 15th
  const fake = makeFakeCounter({ _id: "x", seq: 1 });
  __setCounterModelResolverForTests(() => fake.model);
  await nextOrderSequence(null, instant);
  await nextSlipSequence("kot", null, instant, 240);
  assert.equal(fake.calls[0].filter._id, "order-20260716", "order ids change at midnight whatever the restart time");
  assert.equal(fake.calls[1].filter._id, "kot-20260715", "vision guard: the slip series DID move to the shifted day");
});

// 2026-07-15 is the IST day D below; 01:00 IST on D is 19:30Z the evening before.
const AT_0100_IST = new Date("2026-07-14T19:30:00Z");
const AT_0200_IST = new Date("2026-07-14T20:30:00Z");
const AT_0230_IST = new Date("2026-07-14T21:00:00Z");
const AT_0430_IST = new Date("2026-07-14T23:00:00Z");

function assertNeverRepeats(drawn: Array<{ key: string; seq: number }>): void {
  const seen = new Set<string>();
  for (const { key, seq } of drawn) {
    const pair = `${key}#${seq}`;
    assert.equal(seen.has(pair), false, `(key, seq) pair ${pair} was handed out twice`);
    seen.add(pair);
  }
}

test("restart time changed 00:00 -> 04:00 at 02:00: continues yesterday's key at N+1, then today's key at k+1 after 04:00; no (key, seq) repeats", async () => {
  const fake = makeInMemoryCounter();
  __setCounterModelResolverForTests(() => fake.model);
  const drawn: Array<{ key: string; seq: number }> = [];
  const draw = async (at: Date, reset: number) => {
    const seq = await nextSlipSequence("token", null, at, reset);
    drawn.push({ key: fake.filters[fake.filters.length - 1], seq });
    return seq;
  };
  fake.store.set("token-20260714", 40); // yesterday's day ended on 40 tokens
  const k = 3;
  for (let i = 0; i < k; i += 1) await draw(AT_0100_IST, 0); // 00:00-02:00 under the old midnight restart

  assert.equal(await draw(AT_0230_IST, 240), 41, "after the change, 02:30 is still yesterday's business day: N+1");
  assert.equal(drawn[drawn.length - 1].key, "token-20260714");
  assert.equal(await draw(AT_0430_IST, 240), k + 1, "after 04:00 today's key resumes where the pre-change draws left it: k+1");
  assert.equal(drawn[drawn.length - 1].key, "token-20260715");
  assertNeverRepeats(drawn);
});

test("restart time changed 04:00 -> 00:00 at 02:00: today's key is fresh and starts at 1; no (key, seq) repeats", async () => {
  const fake = makeInMemoryCounter();
  __setCounterModelResolverForTests(() => fake.model);
  const drawn: Array<{ key: string; seq: number }> = [];
  const draw = async (at: Date, reset: number) => {
    const seq = await nextSlipSequence("token", null, at, reset);
    drawn.push({ key: fake.filters[fake.filters.length - 1], seq });
    return seq;
  };
  const before = 3;
  for (let i = 0; i < before; i += 1) assert.equal(await draw(AT_0100_IST, 240), i + 1); // still yesterday's day under 04:00
  assert.deepEqual(drawn.map((d) => d.key), Array(before).fill("token-20260714"));

  assert.equal(await draw(AT_0200_IST, 0), 1, "the change makes 02:00 'today': a day with no counter yet starts at 1");
  assert.equal(drawn[drawn.length - 1].key, "token-20260715");
  assert.equal(await draw(AT_0430_IST, 0), 2);
  assertNeverRepeats(drawn);
});
