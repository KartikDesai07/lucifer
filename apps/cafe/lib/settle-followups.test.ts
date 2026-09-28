import { test } from "node:test";
import assert from "node:assert/strict";
import { runSettleFollowUps, type SettleFollowUpDeps, type SettledTab } from "./settle-followups";
import { settledValue } from "./settled";
import type { ISettings } from "@/models/Settings";

// DB-free: the three follow-ups of a LANDED settle (ledger, loyalty stamp,
// table free) through injected fakes. The settle is already committed, so no
// follow-up may reject the call, and a ledger throw must not skip the table.

const SETTINGS = { cafeName: "x" } as unknown as ISettings;
const OLD: SettledTab = { orderId: "ORD-1", customerId: "665f00000000000000000001", payment: "Unpaid", total: 300, paidAmount: 0, status: "Pending", tableNo: "T-2" };
const UPDATED: SettledTab = { ...OLD, payment: "Cash", paidAmount: 300, status: "Completed" };

interface Calls {
  ledger: number;
  grant: Array<[ISettings | null, string | null, string, number]>;
  table: Array<[string, string]>;
}

function fakeDeps(over: Partial<SettleFollowUpDeps> = {}): { deps: SettleFollowUpDeps; calls: Calls } {
  const calls: Calls = { ledger: 0, grant: [], table: [] };
  const deps: SettleFollowUpDeps = {
    reconcileLedger: async (...args) => {
      calls.ledger += 1;
      return over.reconcileLedger ? over.reconcileLedger(...args) : new Set<string>();
    },
    grantStampForSettledOrder: async (settings, customerId, orderId, total) => {
      calls.grant.push([settings, customerId ?? null, orderId, total]);
      return over.grantStampForSettledOrder
        ? over.grantStampForSettledOrder(settings, customerId, orderId, total)
        : { granted: false, reason: "loyalty-off" };
    },
    freeTable: async (tableNo, orderId) => {
      calls.table.push([tableNo, orderId]);
      if (over.freeTable) await over.freeTable(tableNo, orderId);
    },
  };
  return { deps, calls };
}

test("a ledger throw still frees the table and grants the stamp, and still reports customers touched", async () => {
  const { deps, calls } = fakeDeps({
    reconcileLedger: async () => {
      throw new Error("ledger down");
    },
  });
  const out = await runSettleFollowUps(OLD, UPDATED, SETTINGS, deps);
  assert.deepEqual(calls.table, [["T-2", "ORD-1"]], "the table is freed whatever the ledger did");
  assert.equal(calls.grant.length, 1);
  assert.equal(out.customersTouched, true, "an unknown ledger outcome must drop the customers cache");
});

test("a table throw and a grant throw are both swallowed — a landed settle never rejects here", async () => {
  const { deps } = fakeDeps({
    freeTable: async () => {
      throw new Error("table down");
    },
    grantStampForSettledOrder: async () => {
      throw new Error("stamp down");
    },
  });
  assert.deepEqual(await runSettleFollowUps(OLD, UPDATED, SETTINGS, deps), { customersTouched: false });
});

test("the three follow-ups run together: the table is freed before a slow ledger answers", async () => {
  let release: (v: Set<string>) => void = () => {};
  const { deps, calls } = fakeDeps({ reconcileLedger: () => new Promise((r) => (release = r)) });
  const run = runSettleFollowUps(OLD, UPDATED, SETTINGS, deps);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.table.length, 1, "freeTable must not wait for the ledger");
  assert.equal(calls.grant.length, 1, "the grant must not wait for the ledger");
  release(new Set(["665f00000000000000000001"]));
  assert.deepEqual(await run, { customersTouched: true });
});

test("the grant gets the settle's settings, the customer id as a string, the orderId and the RUPEE total", async () => {
  const { deps, calls } = fakeDeps({ grantStampForSettledOrder: async () => ({ granted: true }) });
  const out = await runSettleFollowUps(OLD, UPDATED, SETTINGS, deps);
  assert.deepEqual(calls.grant, [[SETTINGS, "665f00000000000000000001", "ORD-1", 300]]);
  assert.equal(out.customersTouched, true, "a granted stamp changes the customer");
});

test("a walk-in with no table: no table write, the grant sees no customer, nothing touched", async () => {
  const walkIn: SettledTab = { ...UPDATED, customerId: undefined, tableNo: undefined };
  const { deps, calls } = fakeDeps();
  const out = await runSettleFollowUps({ ...OLD, customerId: undefined, tableNo: undefined }, walkIn, SETTINGS, deps);
  assert.deepEqual(calls.table, []);
  assert.equal(calls.grant[0]?.[1], null);
  assert.deepEqual(out, { customersTouched: false });
});

test("settledValue: a fulfilled result is returned as-is; a rejected one re-throws the same reason", () => {
  const value = { a: 1 };
  assert.equal(settledValue({ status: "fulfilled", value }), value);
  const reason = new Error("read failed");
  assert.throws(() => settledValue({ status: "rejected", reason }), (e) => e === reason);
});
