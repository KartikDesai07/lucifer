import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { runCreateFollowUps, type CreateFollowUpDeps, type CreateFollowUpInput } from "./order-create-followups";
import type { ISettings } from "@/models/Settings";
import type { ProgressOrder, ProgressResult } from "@/lib/reward-progress";
import type { BillNumberingPlan } from "@/lib/gst-invoice";
import type { NumberedOrder } from "@/lib/slip-numbers";
import { stripComments } from "./source-pin-utils";

// DB-free: the post-insert follow-ups of a LANDED create, through injected fakes. The insert already won, so no
// follow-up may reject the call (only the bill numbering is handed back, and it keeps its own rejected/fulfilled
// state). CB-7 S2 added the reward-ladder step as the sixth member of the wave; the five writes that were there
// before keep their gates, pinned here so the extraction and the new member cannot loosen any of them.

const SETTINGS = { cafeName: "x" } as unknown as ISettings;
const CUSTOMER = "665f00000000000000000001";
const CREATED_AT = new Date("2026-10-05T10:00:00.000Z");
// issueBillNumbers resolves the stored order document; the fakes answer with a stand-in object cast to that type.
type OrderRef = CreateFollowUpInput["landed"]["_id"];
type Numbered = Awaited<ReturnType<CreateFollowUpDeps["issueBillNumbers"]>>;
type NumbersFake = (id: OrderRef, plan: BillNumberingPlan) => Promise<Numbered>;
const numbered = (v: object): Numbered => v as unknown as Numbered;
type Overrides = Omit<Partial<CreateFollowUpDeps>, "issueBillNumbers"> & { issueBillNumbers?: NumbersFake };
const COUNTED: ProgressResult = { counted: true, cardIssued: true };
const LANDED_ID = "665f00000000000000000099";

const landed = (status: string): CreateFollowUpInput["landed"] => ({ _id: LANDED_ID, orderId: "A-0042", status, createdAt: CREATED_AT, total: 250 });
const input = (over: Partial<CreateFollowUpInput> = {}): CreateFollowUpInput => ({
  landed: landed("Completed"),
  settings: SETTINGS,
  numbering: {},
  customerId: CUSTOMER,
  ledger: { payment: "Cash", total: 250, paidAmount: 250, status: "Completed" },
  promoTrace: null,
  promoSpent: null,
  ...over,
});

interface Calls {
  numbers: unknown[][];
  trace: unknown[][];
  spent: unknown[][];
  progress: Array<[ISettings | null, string | null | undefined, ProgressOrder]>;
  ledger: Array<[string, { visits: number; spend: number; due: number }]>;
  table: Array<[string, string]>;
}

function fakeDeps(over: Overrides = {}): { deps: CreateFollowUpDeps; calls: Calls } {
  const calls: Calls = { numbers: [], trace: [], spent: [], progress: [], ledger: [], table: [] };
  const deps: CreateFollowUpDeps = {
    // The dep type is overloaded (the generic overload answers unknown), so the single-signature fake is cast once.
    issueBillNumbers: (async (id: OrderRef, plan: BillNumberingPlan) => {
      calls.numbers.push([id, plan]);
      return over.issueBillNumbers ? over.issueBillNumbers(id, plan) : numbered({ numbered: true });
    }) as unknown as CreateFollowUpDeps["issueBillNumbers"],
    backfillPromoRedemptionOrderId: async (...args) => {
      calls.trace.push(args);
      if (over.backfillPromoRedemptionOrderId) await over.backfillPromoRedemptionOrderId(...args);
    },
    markAssignedRewardUsed: async (...args) => {
      calls.spent.push(args);
      if (over.markAssignedRewardUsed) await over.markAssignedRewardUsed(...args);
    },
    advanceRewardProgress: async (settings, customerId, order) => {
      calls.progress.push([settings, customerId, order]);
      return over.advanceRewardProgress ? over.advanceRewardProgress(settings, customerId, order) : { counted: false, reason: "levels-off" };
    },
    incCustomerLedger: async (customerId, c) => {
      calls.ledger.push([customerId, c]);
      if (over.incCustomerLedger) await over.incCustomerLedger(customerId, c);
    },
    occupyTable: async (tableNo, orderId) => {
      calls.table.push([tableNo, orderId]);
      if (over.occupyTable) await over.occupyTable(tableNo, orderId);
    },
  };
  return { deps, calls };
}

// ── CB-7 S2: the progress step ──────────────────────────────────────────────────────────────────────────────────

test("a Completed bill with a customer runs the progress step with the settings and {orderId, createdAt, total}", async () => {
  const { deps, calls } = fakeDeps({ advanceRewardProgress: async () => COUNTED });
  await runCreateFollowUps(input(), deps);
  assert.deepEqual(calls.progress, [[SETTINGS, CUSTOMER, { orderId: "A-0042", createdAt: CREATED_AT, total: 250 }]]);
  assert.equal(calls.progress[0][2].createdAt, CREATED_AT, "the landed order's own createdAt");
});

test("an open (Pending) tab does NOT run progress on create - it counts when it is settled", async () => {
  const { deps, calls } = fakeDeps();
  await runCreateFollowUps(input({ landed: landed("Pending"), ledger: { payment: "Unpaid", total: 250, paidAmount: 0, status: "Pending" } }), deps);
  assert.deepEqual(calls.progress, []);
});

test("every non-Completed status stays out; only the exact status 'Completed' runs it", async () => {
  for (const status of ["Pending", "Cancelled", "completed", "", "Held"]) {
    const { deps, calls } = fakeDeps();
    await runCreateFollowUps(input({ landed: landed(status) }), deps);
    assert.equal(calls.progress.length, 0, `status ${JSON.stringify(status)}`);
  }
  const { deps, calls } = fakeDeps();
  await runCreateFollowUps(input(), deps);
  assert.equal(calls.progress.length, 1, "landmark: the same fake DOES record the Completed case");
});

test("a Completed walk-in (no customer id: undefined, null or empty) does not run progress", async () => {
  for (const customerId of [undefined, null, ""]) {
    const { deps, calls } = fakeDeps();
    await runCreateFollowUps(input({ customerId }), deps);
    assert.equal(calls.progress.length, 0, `customerId ${JSON.stringify(customerId)}`);
  }
});

test("a rejecting progress dep is swallowed: the other writes still run and the numbering result is intact", async () => {
  const { deps, calls } = fakeDeps({
    advanceRewardProgress: async () => {
      throw new Error("progress down");
    },
  });
  const out = await runCreateFollowUps(
    input({ numbering: { invoiceAt: CREATED_AT }, tableNo: "T-2", promoTrace: { code: "C1", mobile: "9000000001" } }),
    deps,
  );
  assert.equal(calls.progress.length, 1, "landmark: the dep really ran");
  assert.equal(calls.numbers.length, 1);
  assert.equal(calls.ledger.length, 1);
  assert.deepEqual(calls.table, [["T-2", "A-0042"]]);
  assert.equal(calls.trace.length, 1);
  assert.deepEqual(out.numbered, { status: "fulfilled", value: { numbered: true } });
});

test("a progress dep that throws synchronously is swallowed too", async () => {
  const { deps } = fakeDeps();
  deps.advanceRewardProgress = () => {
    throw new Error("sync boom");
  };
  const out = await runCreateFollowUps(input(), deps);
  assert.equal(out.numbered.status, "fulfilled");
});

test("progress runs in the same wave: it is not held back by a slow bill numbering", async () => {
  let release: (v: unknown) => void = () => {};
  const { deps, calls } = fakeDeps({ issueBillNumbers: () => new Promise<Numbered>((r) => (release = r as (v: unknown) => void)) });
  const run = runCreateFollowUps(input({ numbering: { invoiceAt: CREATED_AT } }), deps);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.progress.length, 1, "progress must not wait for the numbering");
  assert.equal(calls.ledger.length, 1, "nor the ledger");
  release({ numbered: true });
  assert.equal((await run).numbered.status, "fulfilled");
});

// ── the numbering result is unchanged ───────────────────────────────────────────────────────────────────────────

test("numbered carries the issueBillNumbers value when the plan has work, and null when it has none", async () => {
  const worked = fakeDeps({ issueBillNumbers: async () => numbered({ bill: 7 }) });
  const out = await runCreateFollowUps(input({ numbering: { invoiceAt: CREATED_AT } }), worked.deps);
  assert.deepEqual(out.numbered, { status: "fulfilled", value: { bill: 7 } });
  assert.deepEqual(worked.calls.numbers[0], [LANDED_ID, { invoiceAt: CREATED_AT }], "called with the landed _id and the plan");

  const idle = fakeDeps();
  const none = await runCreateFollowUps(input({ numbering: {} }), idle.deps);
  assert.deepEqual(none.numbered, { status: "fulfilled", value: null });
  assert.equal(idle.calls.numbers.length, 0, "an empty plan issues nothing");
});

test("a numbering rejection comes back as rejected (the route answers 503), and does not stop the other writes", async () => {
  const boom = new Error("numbers down");
  const { deps, calls } = fakeDeps({
    issueBillNumbers: async () => {
      throw boom;
    },
  });
  const out = await runCreateFollowUps(input({ numbering: { invoiceAt: CREATED_AT }, tableNo: "T-2" }), deps);
  assert.equal(out.numbered.status, "rejected");
  assert.equal(out.numbered.status === "rejected" && out.numbered.reason, boom);
  assert.equal(calls.progress.length, 1);
  assert.equal(calls.table.length, 1);
});

// ── the five pre-existing writes keep their gates ───────────────────────────────────────────────────────────────

test("the ledger write runs with the contribution for a settled sale, and is skipped when it is all zero", async () => {
  const paid = fakeDeps();
  await runCreateFollowUps(input(), paid.deps);
  assert.deepEqual(paid.calls.ledger, [[CUSTOMER, { visits: 1, spend: 250, due: 0 }]]);

  const partial = fakeDeps();
  await runCreateFollowUps(input({ ledger: { payment: "Cash", total: 250, paidAmount: 100, status: "Completed" } }), partial.deps);
  assert.deepEqual(partial.calls.ledger, [[CUSTOMER, { visits: 1, spend: 250, due: 150 }]], "the unpaid part rides as due");

  const held = fakeDeps();
  await runCreateFollowUps(input({ ledger: { payment: "Unpaid", total: 250, paidAmount: 0, status: "Pending" } }), held.deps);
  assert.deepEqual(held.calls.ledger, [], "a held open tab contributes nothing yet");

  const cancelled = fakeDeps();
  await runCreateFollowUps(input({ ledger: { payment: "Cash", total: 250, paidAmount: 250, status: "Cancelled" } }), cancelled.deps);
  assert.deepEqual(cancelled.calls.ledger, [], "a cancelled order contributes nothing");

  const walkIn = fakeDeps();
  await runCreateFollowUps(input({ customerId: null }), walkIn.deps);
  assert.deepEqual(walkIn.calls.ledger, [], "no customer, no ledger write");
});

test("the table is occupied only when the order has a table, keyed by the order id", async () => {
  const seated = fakeDeps();
  await runCreateFollowUps(input({ tableNo: "T-2" }), seated.deps);
  assert.deepEqual(seated.calls.table, [["T-2", "A-0042"]]);
  for (const tableNo of [undefined, ""]) {
    const none = fakeDeps();
    await runCreateFollowUps(input({ tableNo }), none.deps);
    assert.deepEqual(none.calls.table, [], `tableNo ${JSON.stringify(tableNo)}`);
  }
});

test("the two promo writes run only when the route handed them a code + mobile, each with the landed order id", async () => {
  const both = fakeDeps();
  await runCreateFollowUps(
    input({ promoTrace: { code: "TRACE", mobile: "9000000001" }, promoSpent: { code: "SPENT", mobile: "9000000002" } }),
    both.deps,
  );
  assert.deepEqual(both.calls.trace, [["TRACE", "9000000001", "A-0042"]]);
  assert.equal(both.calls.spent.length, 1);
  assert.deepEqual(both.calls.spent[0].slice(0, 3), ["SPENT", "9000000002", "A-0042"]);
  assert.ok(both.calls.spent[0][3] instanceof Date, "the spent write is stamped with a Date");

  const neither = fakeDeps();
  await runCreateFollowUps(input(), neither.deps);
  assert.deepEqual(neither.calls.trace, []);
  assert.deepEqual(neither.calls.spent, []);
});

test("a throw in any pre-existing write is absorbed: the call resolves and the other writes still run", async () => {
  const { deps, calls } = fakeDeps({
    incCustomerLedger: async () => {
      throw new Error("ledger down");
    },
    occupyTable: async () => {
      throw new Error("table down");
    },
    backfillPromoRedemptionOrderId: async () => {
      throw new Error("trace down");
    },
    markAssignedRewardUsed: async () => {
      throw new Error("spent down");
    },
  });
  const out = await runCreateFollowUps(
    input({ tableNo: "T-2", promoTrace: { code: "A", mobile: "1" }, promoSpent: { code: "B", mobile: "2" } }),
    deps,
  );
  assert.equal(out.numbered.status, "fulfilled");
  assert.equal(calls.progress.length, 1, "the progress step still ran");
});

// s89 review M1 — the runner hands back the FIRST overload's order type. `ReturnType<typeof issueBillNumbers>` reads the
// LAST (generic) overload and collapses to unknown, which silently untyped the route's `numbered.value`. A compile-time
// pin: tsc fails the chain if the hand-back drifts from `NumberedOrder | null` again.
type HandedBack = Extract<Awaited<ReturnType<typeof runCreateFollowUps>>["numbered"], { status: "fulfilled" }>["value"];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const HANDED_BACK_IS_NUMBERED_ORDER: Same<HandedBack, NumberedOrder | null> = true;
// Same<> is true when either side is any, and NumberedOrder could itself degrade to unknown — so the hand-back must
// ALSO be a concrete type on its own (`unknown extends T` holds exactly for unknown and any).
type Concrete<T> = unknown extends T ? false : true;
const HANDED_BACK_IS_CONCRETE: Concrete<HandedBack> = true;

test("PIN (review M1): numbered is typed as the stored order, never the generic overload's unknown", () => {
  assert.equal(HANDED_BACK_IS_NUMBERED_ORDER, true);
  assert.equal(HANDED_BACK_IS_CONCRETE, true);
});

// s89 review M2 — the route computes the two promo gates and the runner only obeys what it is handed, so the gate
// expressions themselves are pinned here: dropping `promoFenceMobile` (a walk-in's undefined mobile) or the claimable
// check would otherwise pass every runner test above.
const ROUTE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "api", "orders", "route.ts");
const squash = (src: string): string => src.replace(/\s+/g, " ");
const swapAll = (src: string, from: string, to: string): string => src.split(from).join(to);
const PROMO_TRACE_GATE =
  "promoTrace: promoFenceMobile && promoIsClaimable(promoDiscount, data.promoCode, promoKind) ? { code: data.promoCode, mobile: promoFenceMobile } : null,";
const PROMO_SPENT_GATE = "promoSpent: data.promoCode && promoFenceMobile ? { code: data.promoCode, mobile: promoFenceMobile } : null,";

function promoGatesPinned(src: string): boolean {
  const call = src.indexOf("runCreateFollowUps({");
  if (call < 0) return false;
  const args = src.slice(call, src.indexOf("});", call));
  return args.includes(PROMO_TRACE_GATE) && args.includes(PROMO_SPENT_GATE);
}

test("PIN (review M2): the create route hands the runner exactly the two promo gates it used inline before the split", () => {
  const src = squash(stripComments(readFileSync(ROUTE, "utf8")));
  assert.equal(promoGatesPinned(src), true, "both gate expressions are passed to runCreateFollowUps verbatim");
  // Vision guard: each loosened gate flips the checker.
  assert.equal(promoGatesPinned(swapAll(src, "promoSpent: data.promoCode && promoFenceMobile ?", "promoSpent: data.promoCode ?")), false);
  assert.equal(promoGatesPinned(swapAll(src, "promoFenceMobile && promoIsClaimable(", "promoIsClaimable(")), false);
});
