import { test } from "node:test";
import assert from "node:assert/strict";
import {
  issueBillNumber,
  allocateOpeningKot,
  BILL_NUMBER_SET_ATTEMPTS,
  BILL_NUMBER_UNCONFIRMED,
  type SlipNumberDeps,
} from "./slip-numbers";
import { printConfigOf, printedSlipNumber } from "./print";
import type { SlipSeries } from "@/models/Counter";

// DB-free: every counter/Order call goes through injected fakes, so each case
// states exactly which writes ran and with which number.

type Doc = { _id: string; billNumber?: number };
const ID = "665f00000000000000000001";
const START = 100;

interface Recorded {
  series: SlipSeries[];
  sets: number[];
  reads: number;
}

function fakeDeps(opts: {
  seq?: () => Promise<number>;
  set?: (n: number, attempt: number) => Promise<Doc | null>;
  read?: () => Promise<Doc | null>;
}): { deps: SlipNumberDeps<Doc>; rec: Recorded } {
  const rec: Recorded = { series: [], sets: [], reads: 0 };
  const deps: SlipNumberDeps<Doc> = {
    nextSequence: async (series) => {
      rec.series.push(series);
      return opts.seq ? opts.seq() : 7;
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
  const doc = await issueBillNumber(ID, START, deps);
  assert.deepEqual(rec.series, ["bill"]);
  assert.deepEqual(rec.sets, [printedSlipNumber(7, START)]);
  assert.equal(doc?.billNumber, printedSlipNumber(7, START));
  assert.equal(rec.reads, 0, "a set that matched needs no re-read");
});

test("issueBillNumber: a throwing set is retried with the SAME number — never a second sequence", async () => {
  const { deps, rec } = fakeDeps({
    set: async (n, attempt) => {
      if (attempt === 1) throw new Error("socket closed");
      return { _id: ID, billNumber: n };
    },
  });
  const doc = await issueBillNumber(ID, START, deps);
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
  await assert.rejects(issueBillNumber(ID, START, deps), /down 2/);
  assert.equal(rec.sets.length, BILL_NUMBER_SET_ATTEMPTS);
  assert.equal(BILL_NUMBER_SET_ATTEMPTS, 2);
  assert.deepEqual(rec.series, ["bill"]);
});

test("issueBillNumber: a guard miss (the bill already holds another number) falls back to the stored doc", async () => {
  const stored: Doc = { _id: ID, billNumber: 42 };
  const { deps, rec } = fakeDeps({ set: async () => null, read: async () => stored });
  const doc = await issueBillNumber(ID, START, deps);
  assert.equal(rec.reads, 1);
  assert.equal(doc, stored, "the number the customer already holds wins");
});

test("issueBillNumber: a sequence throw rejects before any set", async () => {
  const { deps, rec } = fakeDeps({
    seq: async () => {
      throw new Error("counter down");
    },
  });
  await assert.rejects(issueBillNumber(ID, START, deps), /counter down/);
  assert.equal(rec.sets.length, 0);
});

test("allocateOpeningKot: numbering off → no key and no counter call; on → one KOT number, never a bill number", async () => {
  const off = fakeDeps({});
  assert.deepEqual(await allocateOpeningKot(printConfigOf({ kotShowNumber: false }), off.deps), {});
  assert.deepEqual(off.rec.series, []);

  const on = fakeDeps({ seq: async () => 3 });
  const cfg = printConfigOf({ kotShowNumber: true, kotNumberStart: 50 });
  assert.deepEqual(await allocateOpeningKot(cfg, on.deps), { kotNumbers: [printedSlipNumber(3, 50)] });
  assert.deepEqual(on.rec.series, ["kot"], "the bill number is the insert winner's job, never allocated here");
});

test("BILL_NUMBER_UNCONFIRMED is neutral, plain-English copy (the client shows its own copy for a 5xx)", () => {
  assert.equal(BILL_NUMBER_UNCONFIRMED, "Saved, but the bill number could not be confirmed.");
});
