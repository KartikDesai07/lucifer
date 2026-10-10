import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billPayloadWithInvoice,
  issueBillNumber,
  issueBillNumbers,
  issueInvoiceNumber,
  nextPrintedNumber,
  allocateOpeningSlips,
  BILL_NUMBER_SET_ATTEMPTS,
  BILL_NUMBER_UNCONFIRMED,
  SLIP_NUMBER_DEPS,
  type InvoiceNumberDeps,
  type InvoiceReadDeps,
  type SeriesNumbering,
  type SlipNumberDeps,
} from "./slip-numbers";
import { printConfigOf, printedSlipNumber } from "./print";
import type { SlipSeries } from "@/models/Counter";
import type { BillNumberingPlan } from "./gst-invoice";
import { printOrderSnapshot } from "@pos/shared/print-job";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import type { Order as SharedOrder } from "@pos/shared/types";

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

// A round with at least one kitchen line (every order without a no-KOT line).
const KITCHEN_ROUND = { kitchen: true };

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
    const got = await allocateOpeningSlips(cfg, KITCHEN_ROUND, deps);
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
  assert.deepEqual(await allocateOpeningSlips(printConfigOf({ kotShowNumber: false }), KITCHEN_ROUND, zero.deps), {});
  assert.equal(zero.rec.series.length, 0, "{} means ZERO counter draws");
});

test("allocateOpeningSlips: the token is drawn only with token.enabled — the default config never draws one", async () => {
  const { deps, rec } = fakeDeps({});
  const got = await allocateOpeningSlips(printConfigOf({}), KITCHEN_ROUND, deps);
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
  const got = await allocateOpeningSlips(cfg, KITCHEN_ROUND, deps);
  assert.deepEqual(got, { kotNumbers: [10], tokenNumber: 500 }, "kot starts at 10, token at 500 — never each other's, never the bill's 7000");
  const byKey = new Map(rec.series.map((s, i) => [s, rec.resets[i]]));
  assert.equal(byKey.get("kot"), 240);
  assert.equal(byKey.get("token"), 240);
});

test("allocateOpeningSlips: separate per-series restart times are forwarded as configured (a hand-built config)", async () => {
  const { deps, rec } = fakeDeps({});
  const base = printConfigOf({ kotShowNumber: true, tokenEnabled: true });
  const cfg = { ...base, kot: { ...base.kot, resetMinutes: 60 }, token: { ...base.token, resetMinutes: 120 } };
  await allocateOpeningSlips(cfg, KITCHEN_ROUND, deps);
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
  await assert.rejects(allocateOpeningSlips(printConfigOf({ kotShowNumber: true, tokenEnabled: true }), KITCHEN_ROUND, deps), /token counter down/);
});

test("allocateOpeningSlips: a round with NO kitchen line draws no KOT number AND no token, even with both on (F3a) — {} and ZERO draws", async () => {
  const { deps, rec } = fakeDeps({});
  const cfg = printConfigOf({ kotShowNumber: true, tokenEnabled: true });
  assert.deepEqual(await allocateOpeningSlips(cfg, { kitchen: false }, deps), {});
  assert.equal(rec.series.length, 0, "an all-skip opening round takes nothing from any counter");
});

test("allocateOpeningSlips: kitchen:true is today's draw — vision guard for the no-kitchen case above", async () => {
  const { deps, rec } = fakeDeps({ seq: async (series) => (series === "kot" ? 4 : 8) });
  const cfg = printConfigOf({ kotShowNumber: true, kotNumberStart: 1, tokenEnabled: true, tokenNumberStart: 1 });
  assert.deepEqual(await allocateOpeningSlips(cfg, { kitchen: true }, deps), { kotNumbers: [4], tokenNumber: 8 });
  assert.deepEqual([...rec.series].sort(), ["kot", "token"]);
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

// ── S10: the GST invoice serial (issueInvoiceNumber / issueBillNumbers / billPayloadWithInvoice) ──

type InvDoc = { _id: string; billNumber?: number; invoiceNumber?: number; invoiceFy?: number };
const IST_LAST_SECOND_OF_FY = new Date("2027-03-31T18:29:59.000Z"); // 23:59:59 IST on 31 March: FY 2026
const IST_FIRST_SECOND_OF_FY = new Date("2027-03-31T18:30:00.000Z"); // 00:00:00 IST on 1 April: FY 2027
const INVOICE_SEQ = 41;

interface InvoiceRecorded {
  log: string[]; // every call in order: "invoice:draw:2026", "invoice:set:41", "bill:draw", "bill:set:<n>", "read"
  draws: Array<{ fy: number; args: number }>;
  sets: Array<{ fy: number; n: number }>;
  reads: number;
}

function invoiceDeps(opts: {
  invoiceSeq?: () => Promise<number>;
  invoiceSet?: (n: number, attempt: number) => Promise<InvDoc | null>;
  billSeq?: () => Promise<number>;
  billSet?: (n: number, attempt: number) => Promise<InvDoc | null>;
  read?: () => Promise<InvDoc | null>;
}): { deps: SlipNumberDeps<InvDoc> & InvoiceNumberDeps<InvDoc>; rec: InvoiceRecorded } {
  const rec: InvoiceRecorded = { log: [], draws: [], sets: [], reads: 0 };
  let invoiceSets = 0;
  let billSets = 0;
  const deps: SlipNumberDeps<InvDoc> & InvoiceNumberDeps<InvDoc> = {
    // The invoice draw takes the FY alone: a restart time can never reach it (args.length is the proof).
    nextInvoice: async (...args: [number]) => {
      rec.draws.push({ fy: args[0], args: args.length });
      rec.log.push(`invoice:draw:${args[0]}`);
      return opts.invoiceSeq ? opts.invoiceSeq() : INVOICE_SEQ;
    },
    setInvoiceIfAbsent: async (_id, fy, n) => {
      invoiceSets += 1;
      rec.sets.push({ fy, n });
      rec.log.push(`invoice:set:${n}`);
      return opts.invoiceSet ? opts.invoiceSet(n, invoiceSets) : { _id: ID, invoiceNumber: n, invoiceFy: fy };
    },
    nextSequence: async () => {
      rec.log.push("bill:draw");
      return opts.billSeq ? opts.billSeq() : 7;
    },
    setIfAbsent: async (_id, n) => {
      billSets += 1;
      rec.log.push(`bill:set:${n}`);
      return opts.billSet ? opts.billSet(n, billSets) : { _id: ID, billNumber: n };
    },
    readOrder: async () => {
      rec.reads += 1;
      rec.log.push("read");
      return opts.read ? opts.read() : null;
    },
  };
  return { deps, rec };
}

test("issueInvoiceNumber: the FY comes from `at` in IST — 18:29:59Z draws FY 2026, 18:30:00Z draws FY 2027; one draw, one set, the doc returned", async () => {
  const last = invoiceDeps({});
  const lastDoc = await issueInvoiceNumber(ID, IST_LAST_SECOND_OF_FY, last.deps);
  assert.deepEqual(last.rec.draws, [{ fy: 2026, args: 1 }], "one draw, in FY 2026, handed the FY and nothing else");
  assert.deepEqual(last.rec.sets, [{ fy: 2026, n: INVOICE_SEQ }], "the set carries the same FY and the drawn number");
  assert.deepEqual(lastDoc, { _id: ID, invoiceNumber: INVOICE_SEQ, invoiceFy: 2026 });
  assert.equal(last.rec.reads, 0, "a set that matched needs no re-read");

  const first = invoiceDeps({});
  await issueInvoiceNumber(ID, IST_FIRST_SECOND_OF_FY, first.deps);
  assert.deepEqual(first.rec.draws, [{ fy: 2027, args: 1 }]);
  assert.deepEqual(first.rec.sets, [{ fy: 2027, n: INVOICE_SEQ }]);
});

test("issueInvoiceNumber: a throwing set is retried with the SAME number — never a second draw", async () => {
  const { deps, rec } = invoiceDeps({
    invoiceSet: async (n, attempt) => {
      if (attempt === 1) throw new Error("socket closed after commit");
      return { _id: ID, invoiceNumber: n, invoiceFy: 2026 };
    },
  });
  const doc = await issueInvoiceNumber(ID, IST_LAST_SECOND_OF_FY, deps);
  assert.equal(rec.draws.length, 1, "the invoice counter moves once");
  assert.equal(rec.sets.length, 2);
  assert.equal(rec.sets[0].n, rec.sets[1].n, "the retry reuses the serial the counter already gave out");
  assert.equal(rec.sets[0].fy, rec.sets[1].fy);
  assert.equal(doc?.invoiceNumber, INVOICE_SEQ);
});

test("issueInvoiceNumber: every set attempt throwing rejects with the last error (BILL_NUMBER_SET_ATTEMPTS tries, one draw)", async () => {
  const { deps, rec } = invoiceDeps({
    invoiceSet: async (_n, attempt) => {
      throw new Error(`down ${attempt}`);
    },
  });
  await assert.rejects(issueInvoiceNumber(ID, IST_LAST_SECOND_OF_FY, deps), /down 2/);
  assert.equal(rec.sets.length, BILL_NUMBER_SET_ATTEMPTS);
  assert.equal(rec.draws.length, 1);
});

test("issueInvoiceNumber: a guard miss (the bill already holds a serial) returns the doc readOrder finds, so the paper matches what the customer holds", async () => {
  const stored: InvDoc = { _id: ID, invoiceNumber: 9, invoiceFy: 2026 };
  const { deps, rec } = invoiceDeps({ invoiceSet: async () => null, read: async () => stored });
  const doc = await issueInvoiceNumber(ID, IST_LAST_SECOND_OF_FY, deps);
  assert.equal(doc, stored, "the very doc readOrder returned");
  assert.equal(rec.reads, 1);
  assert.equal(rec.sets.length, 1, "a miss is not an error: no second set attempt");
});

test("issueInvoiceNumber: a draw failure rejects with NO set attempted", async () => {
  const { deps, rec } = invoiceDeps({
    invoiceSeq: async () => {
      throw new Error("invoice counter down");
    },
  });
  await assert.rejects(issueInvoiceNumber(ID, IST_LAST_SECOND_OF_FY, deps), /invoice counter down/);
  assert.equal(rec.sets.length, 0);
  assert.equal(rec.reads, 0);
});

const BOTH_PLAN: BillNumberingPlan = { invoiceAt: IST_LAST_SECOND_OF_FY, bill: { numberStart: START, resetMinutes: 240 } };

test("issueBillNumbers: the invoice is drawn and set BEFORE the daily bill number, one after the other", async () => {
  const { deps, rec } = invoiceDeps({});
  await issueBillNumbers(ID, BOTH_PLAN, deps);
  assert.deepEqual(rec.log, ["invoice:draw:2026", `invoice:set:${INVOICE_SEQ}`, "bill:draw", `bill:set:${printedSlipNumber(7, START)}`]);
});

test("issueBillNumbers: returns the LAST doc (the bill's set), so a both-numbers plan answers with the doc written last", async () => {
  const invoiceDoc: InvDoc = { _id: ID, invoiceNumber: INVOICE_SEQ, invoiceFy: 2026 };
  const billDoc: InvDoc = { _id: ID, invoiceNumber: INVOICE_SEQ, invoiceFy: 2026, billNumber: 107 };
  const both = invoiceDeps({ invoiceSet: async () => invoiceDoc, billSet: async () => billDoc });
  assert.equal(await issueBillNumbers(ID, BOTH_PLAN, both.deps), billDoc);
  // Landmark: a plan with only the invoice answers with the invoice doc, so the two docs really are told apart above.
  const only = invoiceDeps({ invoiceSet: async () => invoiceDoc, billSet: async () => billDoc });
  assert.equal(await issueBillNumbers(ID, { invoiceAt: IST_LAST_SECOND_OF_FY }, only.deps), invoiceDoc);
});

test("issueBillNumbers: a plan with one half draws only that half (invoice only: no bill draw; bill only: no invoice draw)", async () => {
  const invoiceOnly = invoiceDeps({});
  await issueBillNumbers(ID, { invoiceAt: IST_LAST_SECOND_OF_FY }, invoiceOnly.deps);
  assert.deepEqual(invoiceOnly.rec.log, ["invoice:draw:2026", `invoice:set:${INVOICE_SEQ}`]);

  const billOnly = invoiceDeps({});
  await issueBillNumbers(ID, { bill: { numberStart: START, resetMinutes: 0 } }, billOnly.deps);
  assert.deepEqual(billOnly.rec.log, ["bill:draw", `bill:set:${printedSlipNumber(7, START)}`]);
  assert.equal(billOnly.rec.draws.length, 0);
});

test("issueBillNumbers: an empty plan returns null and makes ZERO calls (no draw, no set, no read)", async () => {
  const { deps, rec } = invoiceDeps({});
  assert.equal(await issueBillNumbers(ID, {}, deps), null);
  assert.deepEqual(rec.log, []);
});

test("issueBillNumbers: when the INVOICE fails the daily bill number is still drawn and set; it rejects with the invoice error", async () => {
  const { deps, rec } = invoiceDeps({
    invoiceSeq: async () => {
      throw new Error("invoice counter down");
    },
  });
  await assert.rejects(issueBillNumbers(ID, BOTH_PLAN, deps), /invoice counter down/);
  assert.deepEqual(rec.log, ["invoice:draw:2026", "bill:draw", `bill:set:${printedSlipNumber(7, START)}`], "the bill number is not left undrawn for the invoice's sake");
});

test("issueBillNumbers: when the BILL number fails the invoice that came first is already set; it rejects with the bill error", async () => {
  const { deps, rec } = invoiceDeps({
    billSeq: async () => {
      throw new Error("bill counter down");
    },
  });
  await assert.rejects(issueBillNumbers(ID, BOTH_PLAN, deps), /bill counter down/);
  assert.deepEqual(rec.log, ["invoice:draw:2026", `invoice:set:${INVOICE_SEQ}`, "bill:draw"]);
});

test("issueBillNumbers: when BOTH fail it rejects with the FIRST error (the invoice one), after trying both", async () => {
  const { deps, rec } = invoiceDeps({
    invoiceSeq: async () => {
      throw new Error("invoice counter down");
    },
    billSeq: async () => {
      throw new Error("bill counter down");
    },
  });
  await assert.rejects(issueBillNumbers(ID, BOTH_PLAN, deps), /invoice counter down/);
  assert.deepEqual(rec.log, ["invoice:draw:2026", "bill:draw"], "both were attempted");
});

test("issueBillNumbers: an invoice set that throws on every attempt still lets the bill number run, and rejects", async () => {
  const { deps, rec } = invoiceDeps({
    invoiceSet: async (_n, attempt) => {
      throw new Error(`invoice set down ${attempt}`);
    },
  });
  await assert.rejects(issueBillNumbers(ID, BOTH_PLAN, deps), /invoice set down 2/);
  assert.equal(rec.sets.length, BILL_NUMBER_SET_ATTEMPTS);
  assert.ok(rec.log.includes(`bill:set:${printedSlipNumber(7, START)}`), "landmark: the bill number was still set");
});

test("issueBillNumbers: the bill half still draws with the plan's own start and restart time; the invoice half takes no restart time", async () => {
  const resets: number[] = [];
  const { deps, rec } = invoiceDeps({});
  const spy: SlipNumberDeps<InvDoc> & InvoiceNumberDeps<InvDoc> = {
    ...deps,
    nextSequence: async (series, resetMinutes) => {
      assert.equal(series, "bill");
      resets.push(resetMinutes);
      return 3;
    },
  };
  await issueBillNumbers(ID, { invoiceAt: IST_LAST_SECOND_OF_FY, bill: { numberStart: 50, resetMinutes: 240 } }, spy);
  assert.deepEqual(resets, [240]);
  assert.ok(rec.log.includes(`bill:set:${printedSlipNumber(3, 50)}`), "the start number applied once: 3rd from 50 is 52");
  assert.deepEqual(rec.draws, [{ fy: 2026, args: 1 }]);
});

// ── billPayloadWithInvoice ──

const SNAPSHOT_ORDER: SharedOrder = {
  _id: ID,
  orderId: "ORD-20270331-001",
  customerName: "Walk-In",
  items: [{ productId: "p1", name: "Tea", price: 100, qty: 1, modifiers: [], instructions: "", kotRound: 1 }],
  subtotal: 100,
  discount: 0,
  total: 105,
  paidAmount: 105,
  payment: "Cash",
  status: "Completed",
  receiver: "Staff A",
  kotRounds: 1,
  gstMode: "exclusive",
  gstRate: 5,
  gstAmount: 5,
  createdAt: "2027-03-31T18:29:59.000Z",
  updatedAt: "2027-03-31T18:29:59.000Z",
};

function billPayload(over: Partial<SharedOrder> = {}): PrintJobPayload {
  return { kind: "bill", snapshot: printOrderSnapshot({ ...SNAPSHOT_ORDER, ...over }) } as PrintJobPayload;
}
const snapshotOf = (p: PrintJobPayload) => (p.kind === "bill" ? p.snapshot : null);
const hasInvoiceKey = (snap: { invoiceNumber?: number; invoiceFy?: number } | null): boolean =>
  snap !== null && ("invoiceNumber" in snap || "invoiceFy" in snap);

function readDeps(read: (id: string) => Promise<{ invoiceNumber?: number; invoiceFy?: number } | null>): { deps: InvoiceReadDeps; ids: string[] } {
  const ids: string[] = [];
  return {
    deps: {
      readInvoice: async (id) => {
        ids.push(id);
        return read(id);
      },
    },
    ids,
  };
}

test("billPayloadWithInvoice: every non-bill kind comes back as the SAME object, with no read", async () => {
  const snapshot = printOrderSnapshot(SNAPSHOT_ORDER);
  const others = [
    { kind: "kot", snapshot, round: 1 },
    { kind: "token", snapshot },
    { kind: "eod", dateKey: "2027-03-31", dateLabel: "31 Mar 2027" },
    { kind: "cancel-notice", snapshot, reason: "left" },
  ] as PrintJobPayload[];
  const { deps, ids } = readDeps(async () => ({ invoiceNumber: 5, invoiceFy: 2026 }));
  for (const payload of others) assert.equal(await billPayloadWithInvoice(payload, deps), payload, payload.kind);
  assert.deepEqual(ids, [], "no read for any of them");
  // Landmark: a bill payload through the same deps DOES read, so the zero above is the kind gate.
  await billPayloadWithInvoice(billPayload(), deps);
  assert.deepEqual(ids, [ID]);
});

test("billPayloadWithInvoice: the stored pair is injected into a payload that carried none (an old tab's bill)", async () => {
  const { deps, ids } = readDeps(async () => ({ invoiceNumber: 123, invoiceFy: 2026 }));
  const out = snapshotOf(await billPayloadWithInvoice(billPayload(), deps));
  assert.equal(out?.invoiceNumber, 123);
  assert.equal(out?.invoiceFy, 2026);
  assert.deepEqual(ids, [ID], "the read is by the snapshot's own order id");
  assert.equal(out?.orderId, SNAPSHOT_ORDER.orderId, "landmark: the rest of the snapshot rides through");
});

test("billPayloadWithInvoice: a client-sent pair is DROPPED when the order holds none (a forged serial never prints)", async () => {
  const forged = billPayload({ invoiceNumber: 999, invoiceFy: 2031 });
  assert.equal(snapshotOf(forged)?.invoiceNumber, 999, "landmark: the input really carries the forged pair");
  const none = snapshotOf(await billPayloadWithInvoice(forged, readDeps(async () => ({})).deps));
  assert.equal(hasInvoiceKey(none), false);
  const missing = snapshotOf(await billPayloadWithInvoice(forged, readDeps(async () => null).deps));
  assert.equal(hasInvoiceKey(missing), false, "an order the read cannot find: none either");
  assert.equal(missing?.orderId, SNAPSHOT_ORDER.orderId, "landmark: the bill itself still comes back");
});

test("billPayloadWithInvoice: a client-sent pair is REPLACED by the stored one (the server value wins, a forged value never survives)", async () => {
  const { deps } = readDeps(async () => ({ invoiceNumber: 123, invoiceFy: 2026 }));
  const out = snapshotOf(await billPayloadWithInvoice(billPayload({ invoiceNumber: 999, invoiceFy: 2031 }), deps));
  assert.equal(out?.invoiceNumber, 123);
  assert.equal(out?.invoiceFy, 2026);
});

test("billPayloadWithInvoice: a stored half-pair injects nothing, and drops the client pair too", async () => {
  for (const half of [{ invoiceNumber: 5 }, { invoiceFy: 2026 }]) {
    const out = snapshotOf(await billPayloadWithInvoice(billPayload({ invoiceNumber: 999, invoiceFy: 2031 }), readDeps(async () => half).deps));
    assert.equal(hasInvoiceKey(out), false, JSON.stringify(half));
  }
  // Landmark: the full pair is injected through the very same path.
  const full = snapshotOf(await billPayloadWithInvoice(billPayload(), readDeps(async () => ({ invoiceNumber: 5, invoiceFy: 2026 })).deps));
  assert.equal(full?.invoiceNumber, 5);
});

test("billPayloadWithInvoice: a read that THROWS leaves no pair (the client pair dropped too) and never throws", async () => {
  const { deps, ids } = readDeps(async () => {
    throw new Error("mongo down");
  });
  const out = await billPayloadWithInvoice(billPayload({ invoiceNumber: 999, invoiceFy: 2031 }), deps);
  assert.equal(ids.length, 1, "landmark: the read really ran and threw");
  assert.equal(out.kind, "bill");
  const snap = snapshotOf(out);
  assert.equal(hasInvoiceKey(snap), false);
  assert.equal(snap?.orderId, SNAPSHOT_ORDER.orderId, "the bill still prints, minus the serial");
});

test("billPayloadWithInvoice: a snapshot _id that is not an ObjectId reads nothing and carries no pair", async () => {
  const { deps, ids } = readDeps(async () => ({ invoiceNumber: 5, invoiceFy: 2026 }));
  const out = snapshotOf(await billPayloadWithInvoice(billPayload({ _id: "not-an-id", invoiceNumber: 999, invoiceFy: 2031 }), deps));
  assert.deepEqual(ids, [], "no read");
  assert.equal(hasInvoiceKey(out), false);
  // Landmark: a valid id on the same fixture reads.
  await billPayloadWithInvoice(billPayload(), deps);
  assert.deepEqual(ids, [ID]);
});

test("billPayloadWithInvoice: a cancelled-after-payment bill keeps its stored serial (the read is by id, whatever the status)", async () => {
  const { deps } = readDeps(async () => ({ invoiceNumber: 77, invoiceFy: 2026 }));
  const out = snapshotOf(await billPayloadWithInvoice(billPayload({ status: "Cancelled", cancelReason: "customer left" }), deps));
  assert.equal(out?.status, "Cancelled", "landmark: the slip really is a cancelled one");
  assert.equal(out?.invoiceNumber, 77);
  assert.equal(out?.invoiceFy, 2026);
});

test("billPayloadWithInvoice: never mutates its input (payload and snapshot objects, and their keys, are untouched)", async () => {
  const input = billPayload({ invoiceNumber: 999, invoiceFy: 2031 });
  const before = JSON.stringify(input);
  const snapshotRef = snapshotOf(input);
  const out = await billPayloadWithInvoice(input, readDeps(async () => ({ invoiceNumber: 123, invoiceFy: 2026 })).deps);
  assert.equal(JSON.stringify(input), before, "the input is byte-identical afterwards");
  assert.equal(snapshotOf(input), snapshotRef);
  assert.notEqual(out, input, "a bill payload comes back as a NEW object");
  assert.notEqual(snapshotOf(out), snapshotRef, "with a NEW snapshot");
  assert.equal(snapshotRef?.invoiceNumber, 999, "the forged value is still on the original");
});

// ── S10 model fields: stored omit-empty, validated ──

test("Order.invoiceNumber / invoiceFy are optional Numbers with no default; 0, 1.5 and a too-long serial are refused, a whole serial from 1 is accepted", async () => {
  const { Order } = await import("@/models/Order");
  for (const key of ["invoiceNumber", "invoiceFy"]) {
    const path = Order.schema.path(key);
    assert.ok(path, `landmark: the schema knows ${key}`);
    assert.equal(path.instance, "Number");
    assert.equal(path.options.default, undefined, `${key}: a default would make every pre-S10 bill look numbered`);
    assert.ok(!path.isRequired, `${key}: optional`);
    assert.equal(new Order({}).get(key), undefined);
  }
  const problem = (field: string, value: unknown) => new Order({ [field]: value }).validateSync([field]);
  for (const ok of [1, 123, 99999999999]) assert.ok(!problem("invoiceNumber", ok), `${ok} is a valid serial`);
  for (const bad of [0, -1, 1.5, 100000000000]) assert.ok(problem("invoiceNumber", bad), `${bad} is refused`);
  for (const ok of [2026, 1000, 9998]) assert.ok(!problem("invoiceFy", ok), `${ok} is a valid FY`);
  for (const bad of [0, 999, 2026.5, 9999]) assert.ok(problem("invoiceFy", bad), `${bad} is refused`);
});
