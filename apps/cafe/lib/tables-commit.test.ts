// Tables redesign Step 0 — the Tables list write seam (hooks/use-tables.ts):
// the pure row helpers and RUNTIME proofs for commitTables / commitTableChange,
// mirroring lib/category-arrange-hook-paths.test.ts. The hook module imports
// under node as-is (the "use client" directive is a plain string statement;
// sonner and react-query load fine), and the REAL api-client runs over a fake
// globalThis.fetch — nothing in the read path is stubbed out.

import { test } from "node:test";
import assert from "node:assert/strict";

import { QueryClient } from "@tanstack/react-query";
import { TABLES_FRESH_PARAM } from "@/lib/table-order";
import {
  TABLE_KEYS,
  commitTableChange,
  commitTables,
  refreshTablesNow,
  withTableRow,
  withoutTableRow,
} from "@/hooks/use-tables";
import type { Table } from "@/types";

const CLOCK_SKEW_MS = 5 * 60 * 1000;

const tbl = (id: string, tableNo: string, extra: Partial<Table> = {}): Table => ({
  _id: id,
  tableNo,
  status: "Available",
  capacity: 4,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
  ...extra,
});

// -- pure helpers -----------------------------------------------------------
test("withTableRow: an existing _id is replaced IN PLACE (position kept, others untouched)", () => {
  const list = [tbl("a", "T1"), tbl("b", "T2"), tbl("c", "T3")];
  const saved = tbl("b", "T2-renamed", { capacity: 8 });
  const next = withTableRow(list, saved);
  assert.deepEqual(next.map((t) => t._id), ["a", "b", "c"]);
  assert.equal(next[1], saved);
  assert.equal(next[0], list[0]);
  assert.equal(next[2], list[2]);
  assert.notEqual(next, list, "returns a new array");
  assert.equal(list[1].tableNo, "T2", "input list is not mutated");
});

test("withTableRow: an unknown _id is appended last", () => {
  const list = [tbl("a", "T1"), tbl("b", "T2")];
  const created = tbl("z", "T9");
  const next = withTableRow(list, created);
  assert.deepEqual(next.map((t) => t._id), ["a", "b", "z"]);
  assert.equal(next[2], created);
  assert.equal(list.length, 2, "input list is not mutated");
  assert.deepEqual(withTableRow([], created), [created], "into an empty list");
});

test("withoutTableRow: removes by tableNo; an unknown tableNo is a no-op copy", () => {
  const list = [tbl("a", "T1"), tbl("b", "T2"), tbl("c", "T3")];
  assert.deepEqual(withoutTableRow(list, "T2").map((t) => t.tableNo), ["T1", "T3"]);
  assert.deepEqual(withoutTableRow(list, "nope").map((t) => t.tableNo), ["T1", "T2", "T3"]);
  assert.equal(list.length, 3, "input list is not mutated");
});

// -- runtime: commitTables --------------------------------------------------
test("RUNTIME: commitTables lands even when the cached list carries a FUTURE dataUpdatedAt (device clock behind the server)", async () => {
  const qc = new QueryClient();
  const seeded = [tbl("a", "T1"), tbl("b", "T2")];
  const reordered = [tbl("b", "T2"), tbl("a", "T1")];
  qc.setQueryData(TABLE_KEYS.all, seeded, { updatedAt: Date.now() + CLOCK_SKEW_MS });
  assert.ok((qc.getQueryState(TABLE_KEYS.all)?.dataUpdatedAt ?? 0) > Date.now(), "landmark: the seed really is future-stamped");
  await commitTables(qc, reordered);
  assert.deepEqual(qc.getQueryData(TABLE_KEYS.all), reordered);
  qc.clear();
});

test("RUNTIME: commitTables replaces a tables read already in flight instead of joining it (the read would land its older list)", async () => {
  const qc = new QueryClient();
  const before = [tbl("a", "T1"), tbl("b", "T2")];
  const saved = [tbl("b", "T2"), tbl("a", "T1")];
  qc.setQueryData(TABLE_KEYS.all, before);
  let release: (list: Table[]) => void = () => undefined;
  const inFlight = qc
    .fetchQuery({ queryKey: TABLE_KEYS.all, queryFn: () => new Promise<Table[]>((r) => { release = r; }), staleTime: 0 })
    .catch(() => undefined);
  const commit = commitTables(qc, saved);
  release(before); // the older read answers while the commit is running
  await Promise.all([commit, inFlight]);
  assert.deepEqual(qc.getQueryData(TABLE_KEYS.all), saved);
  qc.clear();
});

// -- runtime: commitTableChange --------------------------------------------
interface FetchCall {
  url: string;
}

/** Installs a fake fetch answering with the API envelope; always restored. */
async function withFakeFetch(data: Table[], body: (calls: FetchCall[]) => Promise<void>): Promise<void> {
  const realFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: unknown) => {
    calls.push({ url: String(input) });
    return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await body(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("RUNTIME: commitTableChange with NO cached list reads the fresh list and never commits a one-row floor", async () => {
  const qc = new QueryClient();
  const live = [tbl("a", "T1"), tbl("b", "T2"), tbl("c", "T3")];
  const created = tbl("z", "T9");
  let changeCalled = false;
  await withFakeFetch(live, async (calls) => {
    assert.equal(qc.getQueryData(TABLE_KEYS.all), undefined, "landmark: nothing cached");
    await commitTableChange(qc, (list) => {
      changeCalled = true;
      return withTableRow(list, created);
    });
    assert.equal(calls.length, 1, "exactly one read");
    assert.equal(calls[0].url, `/api/tables?${TABLES_FRESH_PARAM}=1`, "the read skips the serving instance's list cache");
  });
  assert.equal(changeCalled, false, "the change is not applied to a missing list");
  assert.deepEqual(qc.getQueryData(TABLE_KEYS.all), live, "the live list is committed, not [created]");
  qc.clear();
});

test("RUNTIME: commitTableChange WITH a cached list applies the change and does not touch the network", async () => {
  const qc = new QueryClient();
  const cached = [tbl("a", "T1"), tbl("b", "T2")];
  const created = tbl("z", "T9");
  qc.setQueryData(TABLE_KEYS.all, cached);
  await withFakeFetch([], async (calls) => {
    await commitTableChange(qc, (list) => withTableRow(list, created));
    assert.equal(calls.length, 0, "no read when the list is cached");
  });
  assert.deepEqual(qc.getQueryData<Table[]>(TABLE_KEYS.all)?.map((t) => t._id), ["a", "b", "z"]);
  qc.clear();
});

test("RUNTIME: commitTableChange swallows an offline read failure (cache stays as it was)", async () => {
  const qc = new QueryClient();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  try {
    await assert.doesNotReject(commitTableChange(qc, (list) => [...list]));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(qc.getQueryData(TABLE_KEYS.all), undefined);
  qc.clear();
});

test("RUNTIME: refreshTablesNow re-reads once when a newer commit lands while its read is in flight (never commits the older floor over it)", async () => {
  const qc = new QueryClient();
  const older = [tbl("a", "T1"), tbl("b", "T2")];
  const newer = [tbl("a", "T1", { status: "Reserved" }), tbl("b", "T2")];
  const realFetch = globalThis.fetch;
  let calls = 0;
  let releaseFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  globalThis.fetch = (async () => {
    calls += 1;
    // The first read was answered BEFORE the newer save reached the server.
    if (calls === 1) {
      await firstGate;
      return new Response(JSON.stringify({ success: true, data: older }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ success: true, data: newer }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const pending = refreshTablesNow(qc);
    await commitTables(qc, newer); // another write commits while the read is in flight
    releaseFirst();
    await pending;
    assert.equal(calls, 2, "the in-flight read is repeated once");
    assert.equal(qc.getQueryData<Table[]>(TABLE_KEYS.all)?.[0].status, "Reserved", "the newer floor survives");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("RUNTIME: refreshTablesNow with no commit meanwhile reads exactly once", async () => {
  const qc = new QueryClient();
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ success: true, data: [tbl("a", "T1")] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await refreshTablesNow(qc);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
