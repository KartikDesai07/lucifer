import { test } from "node:test";
import assert from "node:assert/strict";
import {
  issueBillNumber,
  nextPrintedNumber,
  allocateOpeningSlips,
  BILL_NUMBER_SET_ATTEMPTS,
  BILL_NUMBER_UNCONFIRMED,
  SLIP_NUMBER_DEPS,
  type SeriesNumbering,
  type SlipNumberDeps,
} from "./slip-numbers";
import { printConfigOf, printedSlipNumber } from "./print";
import type { SlipSeries } from "@/models/Counter";

// DB-free: every counter/Order call goes through injected fakes, so each case
// states exactly which writes ran and with which number.

type Doc = { _id: string; billNumber?: number };
const ID = "665f00000000000000000001";
const START = 100;
const BILL: SeriesNumbering = { numberStart: START, resetMinutes: 0 };

interface Recorded {
  series: SlipSeries[];
  resets: number[];
  sets: number[];
  reads: number;
}

function fakeDeps(opts: {
  seq?: (series: SlipSeries) => Promise<number>;
  set?: (n: number, attempt: number) => Promise<Doc | null>;
  read?: () => Promise<Doc | null>;
}): { deps: SlipNumberDeps<Doc>; rec: Recorded } {
  const rec: Recorded = { series: [], resets: [], sets: [], reads: 0 };
  const deps: SlipNumberDeps<Doc> = {
    nextSequence: async (series, resetMinutes) => {
      rec.series.push(series);
      rec.resets.push(resetMinutes);
      return opts.seq ? opts.seq(series) : 7;
    },
    setIfAbsent: async (_id, n) => {
      rec.sets.push(n);
      return opts.set ? opts.set(n, rec.sets.length) : { _id: ID, billNumber: n };
    },
    readOrder: async () => {
      rec.reads += 1;
      return opts.read ? opts.read() : null;
    },
  };
  return { deps, rec };
}

test("issueBillNumber: one bill sequence, the printed number is set and returned", async () => {
  const { deps, rec } = fakeDeps({});
  const doc = await issueBillNumber(ID, BILL, deps);
  assert.deepEqual(rec.series, ["bill"]);
  assert.deepEqual(rec.sets, [printedSlipNumber(7, START)]);
  assert.equal(doc?.billNumber, printedSlipNumber(7, START));
  assert.equal(rec.reads, 0, "a set that matched needs no re-read");
});

test("issueBillNumber: the bill's restart time reaches the counter draw", async () => {
  const { deps, rec } = fakeDeps({});
  await issueBillNumber(ID, { numberStart: START, resetMinutes: 240 }, deps);
  assert.deepEqual(rec.resets, [240]);
  assert.deepEqual(rec.series, ["bill"], "vision guard: it was the bill series that carried it");
});

test("issueBillNumber: a throwing set is retried with the SAME number — never a second sequence", async () => {
  const { deps, rec } = fakeDeps({
    set: async (n, attempt) => {
      if (attempt === 1) throw new Error("socket closed");
      return { _id: ID, billNumber: n };
    },
  });
  const doc = await issueBillNumber(ID, BILL, deps);
  assert.deepEqual(rec.series, ["bill"], "the counter moves once");
  assert.equal(rec.sets.length, 2);
  assert.equal(rec.sets[0], rec.sets[1], "the retry must reuse the number the counter already gave out");
  assert.equal(doc?.billNumber, rec.sets[0]);
});

test("issueBillNumber: every set attempt throwing rejects (the caller answers 'could not be confirmed')", async () => {
  const { deps, rec } = fakeDeps({
    set: async (_n, attempt) => {
      throw new Error(`down ${attempt}`);
    },
  });
  await assert.rejects(issueBillNumber(ID, BILL, deps), /down 2/);
  assert.equal(rec.sets.length, BILL_NUMBER_SET_ATTEMPTS);
  assert.equal(BILL_NUMBER_SET_ATTEMPTS, 2);
  assert.deepEqual(rec.series, ["bill"]);
});

test("issueBillNumber: a guard miss (the bill already holds another number) falls back to the stored doc", async () => {
  const stored: Doc = { _id: ID, billNumber: 42 };
  const { deps, rec } = fakeDeps({ set: async () => null, read: async () => stored });
  const doc = await issueBillNumber(ID, BILL, deps);
  assert.equal(rec.reads, 1);
  assert.equal(doc, stored, "the number the customer already holds wins");
});

test("issueBillNumber: a sequence throw rejects before any set", async () => {
  const { deps, rec } = fakeDeps({
    seq: async () => {
      throw new Error("counter down");
    },
  });
  await assert.rejects(issueBillNumber(ID, BILL, deps), /counter down/);
  assert.equal(rec.sets.length, 0);
});

test("nextPrintedNumber: one draw of the named series, the start number applied exactly once, resetMinutes forwarded", async () => {
  for (const series of ["kot", "bill", "token"] as const) {
    const { deps, rec } = fakeDeps({ seq: async () => 3 });
    const n = await nextPrintedNumber(series, { numberStart: 50, resetMinutes: 90 }, deps);
    assert.equal(n, printedSlipNumber(3, 50), series);
    assert.equal(n, 52, "3rd draw from start 50 is 52 — the start is added once, not twice");
    assert.deepEqual(rec.series, [series]);
    assert.deepEqual(rec.resets, [90]);
  }
  const first = await nextPrintedNumber("token", { numberStart: 101, resetMinutes: 0 }, fakeDeps({ seq: async () => 1 }).deps);
  assert.equal(first, 101, "the first draw of the day IS the start number");
});

test("nextPrintedNumber: a rejecting draw rejects (nothing swallowed)", async () => {
  const { deps } = fakeDeps({
    seq: async () => {
      throw new Error("counter down");
    },
  });
  await assert.rejects(nextPrintedNumber("kot", BILL, deps), /counter down/);
});

// allocateOpeningSlips — the four kot/token on/off combinations.
const ALLOCATE_CASES: Array<{ kot: boolean; token: boolean; series: SlipSeries[] }> = [
  { kot: false, token: false, series: [] },
  { kot: true, token: false, series: ["kot"] },
  { kot: false, token: true, series: ["token"] },
  { kot: true, token: true, series: ["kot", "token"] },
];

test("allocateOpeningSlips: the 4 kot/token combinations draw only what is on and return omit-empty keys; neither on is {} with ZERO draws", async () => {
  for (const c of ALLOCATE_CASES) {
    const { deps, rec } = fakeDeps({ seq: async (series) => (series === "kot" ? 3 : 9) });
    const cfg = printConfigOf({ kotShowNumber: c.kot, kotNumberStart: 50, tokenEnabled: c.token, tokenNumberStart: 200 });
    const got = await allocateOpeningSlips(cfg, deps);
    const label = `kot=${c.kot} token=${c.token}`;
    const expected = {
      ...(c.kot ? { kotNumbers: [printedSlipNumber(3, 50)] } : {}),
      ...(c.token ? { tokenNumber: printedSlipNumber(9, 200) } : {}),
    };
    assert.deepEqual(got, expected, label);
    assert.deepEqual([...rec.series].sort(), [...c.series].sort(), `${label}: exactly the series that are on were drawn`);
    assert.equal("kotNumbers" in got, c.kot, `${label}: no kotNumbers key when off`);
    assert.equal("tokenNumber" in got, c.token, `${label}: no tokenNumber key when off`);
    assert.equal(rec.series.includes("bill"), false, `${label}: the bill number is never allocated here`);
  }
  const zero = fakeDeps({});
  assert.deepEqual(await allocateOpeningSlips(printConfigOf({ kotShowNumber: false }), zero.deps), {});
  assert.equal(zero.rec.series.length, 0, "{} means ZERO counter draws");
});

test("allocateOpeningSlips: the token is drawn only with token.enabled — the default config never draws one", async () => {
  const { deps, rec } = fakeDeps({});
  const got = await allocateOpeningSlips(printConfigOf({}), deps);
  assert.equal(rec.series.includes("token"), false);
  assert.equal("tokenNumber" in got, false);
  assert.deepEqual(rec.series, ["kot"], "vision guard: the default cafe still draws its opening KOT number");
});

test("allocateOpeningSlips: each series gets its OWN config's numberStart; the one restart time reaches both draws", async () => {
  const { deps, rec } = fakeDeps({ seq: async () => 1 });
  const cfg = printConfigOf({
    kotShowNumber: true,
    kotNumberStart: 10,
    tokenEnabled: true,
    tokenNumberStart: 500,
    billNumberStart: 7000,
    numberResetMinutes: 240,
  });
  const got = await allocateOpeningSlips(cfg, deps);
  assert.deepEqual(got, { kotNumbers: [10], tokenNumber: 500 }, "kot starts at 10, token at 500 — never each other's, never the bill's 7000");
  const byKey = new Map(rec.series.map((s, i) => [s, rec.resets[i]]));
  assert.equal(byKey.get("kot"), 240);
  assert.equal(byKey.get("token"), 240);
});

test("allocateOpeningSlips: separate per-series restart times are forwarded as configured (a hand-built config)", async () => {
  const { deps, rec } = fakeDeps({});
  const base = printConfigOf({ kotShowNumber: true, tokenEnabled: true });
  const cfg = { ...base, kot: { ...base.kot, resetMinutes: 60 }, token: { ...base.token, resetMinutes: 120 } };
  await allocateOpeningSlips(cfg, deps);
  const byKey = new Map(rec.series.map((s, i) => [s, rec.resets[i]]));
  assert.equal(byKey.get("kot"), 60, "kot reads kot.resetMinutes");
  assert.equal(byKey.get("token"), 120, "token reads token.resetMinutes");
});

test("allocateOpeningSlips: a rejecting draw rejects the allocation (the route answers 500, nothing half-numbered)", async () => {
  const { deps } = fakeDeps({
    seq: async (series) => {
      if (series === "token") throw new Error("token counter down");
      return 1;
    },
  });
  await assert.rejects(allocateOpeningSlips(printConfigOf({ kotShowNumber: true, tokenEnabled: true }), deps), /token counter down/);
});

test("BILL_NUMBER_UNCONFIRMED is neutral, plain-English copy (the client shows its own copy for a 5xx)", () => {
  assert.equal(BILL_NUMBER_UNCONFIRMED, "Saved, but the bill number could not be confirmed.");
});

// ── S6 model fields: stored omit-empty (a pre-S6 document reads back with NO key, never a default) ──

test("Order.tokenNumber is an optional Number with no default, so an order without a token stores no key", async () => {
  const { Order } = await import("@/models/Order");
  const path = Order.schema.path("tokenNumber");
  assert.ok(path, "landmark: the schema knows tokenNumber");
  assert.equal(path.instance, "Number");
  assert.equal(path.options.default, undefined);
  assert.ok(!path.isRequired, "optional, never required");
  const doc = new Order({});
  assert.equal(doc.get("tokenNumber"), undefined, "a fresh order carries no token");
});

test("Settings token fields: no schema defaults (omit-empty); numberResetMinutes and tokenNumberStart validate their ranges", async () => {
  const { settingsSchema } = await import("@/models/Settings");
  for (const key of ["tokenEnabled", "tokenNumberStart", "numberResetMinutes"]) {
    const path = settingsSchema.path(key);
    assert.ok(path, `landmark: the schema knows ${key}`);
    assert.equal(path.options.default, undefined, `${key}: a default would make every pre-S6 document read as set`);
  }
  const { Settings } = await import("@/models/Settings");
  const problem = (field: string, value: unknown) => new Settings({ [field]: value }).validateSync([field]);
  for (const ok of [0, 240, 1439]) assert.ok(!problem("numberResetMinutes", ok), `${ok} is a valid restart time`);
  for (const bad of [-1, 1440, 1.5]) assert.ok(problem("numberResetMinutes", bad), `${bad} is refused`);
  assert.ok(!problem("tokenNumberStart", 101), "101 is a valid start");
  assert.ok(problem("tokenNumberStart", 0), "a start below the minimum is refused");
});

test("Settings.tokenReadyClearMinutes (S8): a Number path with NO default (omit-empty), validating 1..120 whole minutes", async () => {
  const { settingsSchema, Settings } = await import("@/models/Settings");
  const path = settingsSchema.path("tokenReadyClearMinutes");
  assert.ok(path, "landmark: the schema knows tokenReadyClearMinutes");
  assert.equal(path.instance, "Number");
  assert.equal(path.options.default, undefined, "a default would make every pre-S8 document read as set (and could not be told from the owner choosing 10)");
  assert.ok(!path.isRequired, "optional, never required");
  assert.equal(new Settings({}).get("tokenReadyClearMinutes"), undefined, "a fresh Settings document carries none");
  const problem = (value: unknown) => new Settings({ tokenReadyClearMinutes: value }).validateSync(["tokenReadyClearMinutes"]);
  for (const ok of [1, 10, 25, 120]) assert.ok(!problem(ok), `${ok} is a valid clear time`);
  for (const bad of [0, -1, 121, 1.5]) assert.ok(problem(bad), `${bad} is refused`);
});

test("SLIP_NUMBER_DEPS.nextSequence draws on the cafe's restart-time key, not the midnight one (mutation M3, s80)", async () => {
  const { __setCounterModelResolverForTests, slipCounterKey } = await import("@/models/Counter");
  const filters: Array<Record<string, unknown>> = [];
  const result = { _id: "x", seq: 9 };
  const fake = {
    findOneAndUpdate(filter: Record<string, unknown>) {
      filters.push(filter);
      return { lean: () => Promise.resolve(result) };
    },
  };
  __setCounterModelResolverForTests(() => fake as never);
  try {
    const RESET = 1439; // 23:59: the shifted day differs from the calendar day at every instant but the last minute
    const before = new Date();
    const seq = await SLIP_NUMBER_DEPS.nextSequence("token", RESET);
    const after = new Date();
    assert.equal(seq, 9, "returns the counter's seq");
    assert.equal(filters.length, 1, "one atomic draw");
    const keys = new Set([slipCounterKey("token", before, RESET), slipCounterKey("token", after, RESET)]);
    assert.ok(keys.has(String(filters[0]._id)), `drew ${String(filters[0]._id)}, wanted one of ${[...keys].join(", ")}`);
  } finally {
    __setCounterModelResolverForTests(null);
  }
});
