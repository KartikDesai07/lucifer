import { test } from "node:test";
import assert from "node:assert/strict";

import {
  reduceMerge,
  compareBySortSpec,
  cmpValues,
  type KeyedRow,
} from "./report-merge";

// F2 Step F2.6 — the PURE reduce half, pinned doc-shape by doc-shape (P7-R4's
// five kinds). Everything here is I/O-free; the fan-out/dial/timeout half is
// proven in report-fanout.test.ts against the fixture registry.

// ── sum: scalar totals, key-wise across every doc of every leg ────────────────
test("sum merges key-wise across legs; an absent key contributes 0 (#8); _id is skipped", () => {
  const data = reduceMerge("sum", [
    [{ _id: null, gross: 10000, orders: 2 }],
    [{ _id: null, gross: 5000, orders: 1, discount: 700 }], // discount absent on leg 1
  ]);
  assert.deepEqual(data, { gross: 15000, orders: 3, discount: 700 });
});

test("sum of zero legs / zero docs is the honest empty object", () => {
  assert.deepEqual(reduceMerge("sum", []), {});
  assert.deepEqual(reduceMerge("sum", [[], []]), {});
});

test("sum throws on a PRESENT non-number (garbage never becomes a silent 0)", () => {
  assert.throws(
    () => reduceMerge("sum", [[{ _id: null, gross: "x" }]]),
    /sum merge: field 'gross' is not a finite number/,
  );
  assert.throws(() => reduceMerge("sum", [[{ _id: null, gross: null }]]), /not a finite number/);
  assert.throws(
    () => reduceMerge("sum", [[{ _id: null, gross: Number.NaN }]]),
    /not a finite number/,
  );
});

test("a non-document leg item throws (pipelines must emit docs)", () => {
  assert.throws(() => reduceMerge("sum", [[42]]), /non-document result/);
  assert.throws(() => reduceMerge("sum", [[null]]), /non-document result/);
  assert.throws(() => reduceMerge("sum", [[[1, 2]]]), /non-document result/);
});

// ── byKey: merge buckets by their _id key, sum values ─────────────────────────
test("byKey sums same-key buckets across legs and keeps disjoint keys", () => {
  const data = reduceMerge("byKey", [
    [
      { _id: "Cash", amount: 10000, count: 2 },
      { _id: "Online", amount: 4000, count: 1 },
    ],
    [
      { _id: "Cash", amount: 6000, count: 1 },
      { _id: "Due", amount: 2500, count: 1 },
    ],
  ]) as KeyedRow[];
  assert.deepEqual(data, [
    { _id: "Cash", amount: 16000, count: 3 },
    { _id: "Due", amount: 2500, count: 1 },
    { _id: "Online", amount: 4000, count: 1 },
  ]);
});

test("byKey handles numeric and compound $group keys (same pipeline shape across legs)", () => {
  const data = reduceMerge("byKey", [
    [{ _id: 5, taxable: 10000, gst: 500 }],
    [
      { _id: 5, taxable: 2000, gst: 100 },
      { _id: 18, taxable: 1000, gst: 180 },
    ],
  ]) as KeyedRow[];
  assert.deepEqual(data, [
    { _id: 18, taxable: 1000, gst: 180 },
    { _id: 5, taxable: 12000, gst: 600 },
  ]);

  const compound = reduceMerge("byKey", [
    [{ _id: { rate: 5, mode: "Cash" }, gst: 100 }],
    [{ _id: { rate: 5, mode: "Cash" }, gst: 50 }],
  ]) as KeyedRow[];
  assert.deepEqual(compound, [{ _id: { rate: 5, mode: "Cash" }, gst: 150 }]);
});

test("byKey throws on a present non-number value", () => {
  assert.throws(
    () => reduceMerge("byKey", [[{ _id: "Cash", amount: "10" }]]),
    /byKey merge: field 'amount' is not a finite number/,
  );
});

// ── daySeries: concat + sort by _id — NO collision merge (per spec) ───────────
test("daySeries concats per-day rows across legs, sorted by _id", () => {
  const data = reduceMerge("daySeries", [
    [
      { _id: "20260702", gross: 200 },
      { _id: "20260630", gross: 100 },
    ],
    [{ _id: "20260701", gross: 150 }],
  ]) as KeyedRow[];
  assert.deepEqual(
    data.map((r) => r._id),
    ["20260630", "20260701", "20260702"],
  );
});

test("daySeries keeps BOTH rows on an _id collision (the documented F2.7 flip-day caveat)", () => {
  const data = reduceMerge("daySeries", [
    [{ _id: "20260701", gross: 80 }], // old ledger's flip-day morning
    [{ _id: "20260701", gross: 120 }], // new ledger's flip-day rest
  ]) as KeyedRow[];
  assert.equal(data.length, 2, "concat per spec — the consumer sums on collision (or uses byKey)");
});

// ── topN: the parameterized scatter-gather top-N merge ────────────────────────
test("topN re-sorts the concatenated per-leg tops DESC by the metric and re-limits", () => {
  const data = reduceMerge({ kind: "topN", by: "qty", n: 3 }, [
    [
      { _id: "pizza", qty: 30 },
      { _id: "coffee", qty: 12 },
    ],
    [
      { _id: "fries", qty: 25 },
      { _id: "tea", qty: 40 },
    ],
  ]) as KeyedRow[];
  assert.deepEqual(
    data.map((r) => r._id),
    ["tea", "pizza", "fries"],
  );
});

test("topN treats an absent metric as 0 (#8) and breaks ties by _id for determinism", () => {
  const data = reduceMerge({ kind: "topN", by: "qty", n: 4 }, [
    [
      { _id: "b", qty: 5 },
      { _id: "zero" }, // absent metric — a leg that never sold it
    ],
    [{ _id: "a", qty: 5 }],
  ]) as KeyedRow[];
  assert.deepEqual(
    data.map((r) => r._id),
    ["a", "b", "zero"],
  );
});

test("topN validates its parameters and rejects garbage metrics", () => {
  assert.throws(() => reduceMerge({ kind: "topN", by: "qty", n: 0 }, [[]]), /positive integer/);
  assert.throws(() => reduceMerge({ kind: "topN", by: "qty", n: 2.5 }, [[]]), /positive integer/);
  assert.throws(() => reduceMerge({ kind: "topN", by: "", n: 3 }, [[]]), /metric field required/);
  assert.throws(
    () => reduceMerge({ kind: "topN", by: "qty", n: 3 }, [[{ _id: "x", qty: "many" }]]),
    /topN merge: field 'qty' is not a finite number/,
  );
});

// ── auditEvents: flatten the buckets' events[], sort by at ────────────────────
test("auditEvents flattens bucket events across legs and sorts by at", () => {
  const t1 = new Date("2026-07-01T10:00:00Z");
  const t2 = new Date("2026-07-01T11:00:00Z");
  const t3 = new Date("2026-07-01T12:00:00Z");
  const data = reduceMerge("auditEvents", [
    [{ _id: "b1", events: [{ at: t3, action: "void" }] }],
    [
      { _id: "b2", events: [{ at: t1, action: "discount" }] },
      { _id: "b3", events: [{ at: t2, action: "comp" }] },
    ],
  ]) as Array<{ at: Date; action: string }>;
  assert.deepEqual(
    data.map((e) => e.action),
    ["discount", "comp", "void"],
  );
});

test("auditEvents throws on a doc without events[] (a wrong pipeline, not an empty bucket)", () => {
  assert.throws(
    () => reduceMerge("auditEvents", [[{ _id: "b1" }]]),
    /a doc has no events\[\]/,
  );
  assert.deepEqual(reduceMerge("auditEvents", [[], []]), [], "zero docs is honestly empty");
});

// ── the dispatch + the re-sort comparator ─────────────────────────────────────
test("an unknown merge kind throws", () => {
  assert.throws(
    () => reduceMerge("median" as unknown as "sum", [[]]),
    /unknown merge kind/,
  );
});

test("compareBySortSpec re-sorts a scatter-gather concat exactly like the per-leg spec", () => {
  const rows = [
    { _id: "ORD-A2-20260630-004" },
    { _id: "ORD-A3-20260701-001" },
    { _id: "ORD-A2-20260615-002" },
  ];
  rows.sort(compareBySortSpec({ _id: -1 }));
  assert.deepEqual(
    rows.map((r) => r._id),
    ["ORD-A3-20260701-001", "ORD-A2-20260630-004", "ORD-A2-20260615-002"],
  );

  const multi = [
    { status: "Pending", total: 100 },
    { status: "Completed", total: 300 },
    { status: "Completed", total: 200 },
  ];
  multi.sort(compareBySortSpec({ status: 1, total: -1 }));
  assert.deepEqual(multi, [
    { status: "Completed", total: 300 },
    { status: "Completed", total: 200 },
    { status: "Pending", total: 100 },
  ]);
});

test("cmpValues orders nullish first, then cross-type by rank; Dates by instant", () => {
  assert.ok(cmpValues(undefined, 0) < 0, "missing sorts before numbers (Mongo asc convention)");
  assert.ok(cmpValues(null, "a") < 0);
  assert.ok(cmpValues(3, "a") < 0, "numbers before strings (BSON order)");
  assert.ok(
    cmpValues(new Date("2026-07-01"), new Date("2026-07-02")) < 0,
    "Dates compare by instant",
  );
  assert.equal(cmpValues("x", "x"), 0);
});
