import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ledgerContribution, type LedgerContribution } from "./order";
import { ORDER_STATUSES, type PaymentMode } from "@/lib/constants";
import { cancelOrderSchema, voidItemSchema, createOrderSchema } from "@/schemas";

// CR1.3 — order integrity: the money-reversal contract a cancel relies on, the
// append-only status list, the two new admin/staff input schemas, and a set of
// SOURCE PINS over the routes that cannot be exercised here without a session
// (same precedent as settle-money.test.ts's collectedAmount() grep-pin). None of
// this touches a DB — everything is either a pure function or a static parse.

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

// ── ledgerContribution — the money-reversal contract ─────────────────────────
// A cancel is "the same delta a delete used, without destroying the row": it
// works ONLY because contribution(Cancelled) is zero for every payment mode, so
// reconcileLedger(old, updated) — which applies contribution(updated) minus
// contribution(old) — subtracts out exactly what a Completed sale had added.

type Scenario = {
  name: string;
  order: { payment: PaymentMode; total: number; paidAmount: number };
  expectedCompleted: LedgerContribution;
};

const SCENARIOS: Scenario[] = [
  {
    name: "Cash paid in full",
    order: { payment: "Cash", total: 500, paidAmount: 500 },
    expectedCompleted: { visits: 1, spend: 500, due: 0 },
  },
  {
    name: "partial Cash leaving a due",
    order: { payment: "Cash", total: 500, paidAmount: 400 },
    expectedCompleted: { visits: 1, spend: 500, due: 100 },
  },
  {
    name: "Due (nothing collected, full total due)",
    order: { payment: "Due", total: 500, paidAmount: 0 },
    expectedCompleted: { visits: 1, spend: 500, due: 500 },
  },
  {
    name: "Credit (nothing collected, full total due)",
    order: { payment: "Credit", total: 500, paidAmount: 0 },
    expectedCompleted: { visits: 1, spend: 500, due: 500 },
  },
  {
    name: "Split, collected in full",
    order: { payment: "Split", total: 500, paidAmount: 500 },
    expectedCompleted: { visits: 1, spend: 500, due: 0 },
  },
  {
    name: "Unpaid (held open tab — already zero even while Completed)",
    order: { payment: "Unpaid", total: 500, paidAmount: 0 },
    expectedCompleted: { visits: 0, spend: 0, due: 0 },
  },
];

for (const { name, order, expectedCompleted } of SCENARIOS) {
  test(`ledgerContribution: a Cancelled order contributes zero for every field — ${name}`, () => {
    const cancelled = ledgerContribution({ ...order, status: "Cancelled" });
    assert.deepEqual(
      cancelled,
      { visits: 0, spend: 0, due: 0 },
      "a cancelled order is not a sale — it must never add a visit, spend, or due",
    );
  });

  test(`ledgerContribution: a Completed order is unchanged from today's semantics — ${name}`, () => {
    const completed = ledgerContribution({ ...order, status: "Completed" });
    assert.deepEqual(completed, expectedCompleted, "CR1.3 must not alter the Completed contribution formula");
  });

  test(`ledgerContribution: cancelled minus completed exactly negates each field (the reversal reconcileLedger applies) — ${name}`, () => {
    const cancelled = ledgerContribution({ ...order, status: "Cancelled" });
    const completed = ledgerContribution({ ...order, status: "Completed" });
    const delta = {
      visits: cancelled.visits - completed.visits,
      spend: cancelled.spend - completed.spend,
      due: cancelled.due - completed.due,
    };
    assert.deepEqual(
      // `0 - x` rather than `-x`: unary negation of 0 produces -0, which
      // deepStrictEqual (SameValue) treats as distinct from the actual 0 the
      // subtraction above naturally yields for an already-zero field.
      delta,
      { visits: 0 - completed.visits, spend: 0 - completed.spend, due: 0 - completed.due },
      "reconcileLedger(old=Completed, updated=Cancelled) applies contribution(updated)-contribution(old); " +
        "since contribution(Cancelled) is always zero, that delta must exactly negate the settled contribution",
    );
  });
}

// ── ORDER_STATUSES — append-only, "Cancelled" must stay LAST ─────────────────

test("ORDER_STATUSES is exactly [Pending, Completed, Cancelled], with Cancelled LAST — the codec stores status as a string, but a future writer must never start encoding an ordinal off this array's position", () => {
  assert.deepEqual(
    ORDER_STATUSES,
    ["Pending", "Completed", "Cancelled"],
    "the status enum is append-only; reordering it is a silent contract break for anything that might index into it",
  );
  assert.equal(
    ORDER_STATUSES[ORDER_STATUSES.length - 1],
    "Cancelled",
    "Cancelled must be the last-appended status",
  );
});

// ── cancelOrderSchema ─────────────────────────────────────────────────────────

test("cancelOrderSchema rejects a missing reason", () => {
  const parsed = cancelOrderSchema.safeParse({});
  assert.equal(parsed.success, false, "reason is required — it IS the audit trail");
});

test("cancelOrderSchema rejects an empty-string reason", () => {
  const parsed = cancelOrderSchema.safeParse({ reason: "" });
  assert.equal(parsed.success, false);
});

test("cancelOrderSchema rejects a whitespace-only reason (trim runs before the length check)", () => {
  const parsed = cancelOrderSchema.safeParse({ reason: "    " });
  assert.equal(parsed.success, false, "whitespace must not be able to satisfy the minimum length");
});

test("cancelOrderSchema rejects a reason shorter than ORDER_REASON_MIN_LEN (2 chars)", () => {
  const parsed = cancelOrderSchema.safeParse({ reason: "ab" });
  assert.equal(parsed.success, false);
});

test("cancelOrderSchema rejects a reason longer than ORDER_REASON_MAX_LEN (201 chars)", () => {
  const parsed = cancelOrderSchema.safeParse({ reason: "a".repeat(201) });
  assert.equal(parsed.success, false);
});

test("cancelOrderSchema rejects an unknown extra key (.strict())", () => {
  const parsed = cancelOrderSchema.safeParse({ reason: "Wrong order placed", tableNo: "T-1" });
  assert.equal(parsed.success, false, ".strict() must reject any key beyond reason");
});

test("cancelOrderSchema accepts a normal reason and TRIMS it", () => {
  const parsed = cancelOrderSchema.safeParse({ reason: "  Customer walked out  " });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.reason, "Customer walked out", "leading/trailing whitespace must be trimmed");
});

// ── voidItemSchema ────────────────────────────────────────────────────────────
// Payload is now { index, lineKey, qty, expectedVoids, reason } — the old
// `productId` echo is GONE (CR1.3 review: it couldn't tell apart two lines of
// the same product with different prep, so a stale index could void the wrong
// one). `lineKey` is the orderLineKey of the line the operator saw; `expectedVoids`
// is the trail length their view was built on (the CLIENT-anchored CAS term).

const LINE_KEY = "p111"; // a well-formed orderLineKey shape; the schema doesn't parse it, just requires non-empty

test("voidItemSchema rejects a negative index", () => {
  const parsed = voidItemSchema.safeParse({ index: -1, lineKey: LINE_KEY, qty: 1, expectedVoids: 0, reason: "Wrong item" });
  assert.equal(parsed.success, false);
});

test("voidItemSchema rejects a fractional index", () => {
  const parsed = voidItemSchema.safeParse({ index: 1.5, lineKey: LINE_KEY, qty: 1, expectedVoids: 0, reason: "Wrong item" });
  assert.equal(parsed.success, false);
});

test("voidItemSchema rejects qty 0", () => {
  const parsed = voidItemSchema.safeParse({ index: 0, lineKey: LINE_KEY, qty: 0, expectedVoids: 0, reason: "Wrong item" });
  assert.equal(parsed.success, false, "voiding zero items off a line is not a request");
});

test("voidItemSchema rejects a fractional qty", () => {
  const parsed = voidItemSchema.safeParse({ index: 0, lineKey: LINE_KEY, qty: 1.5, expectedVoids: 0, reason: "Wrong item" });
  assert.equal(parsed.success, false);
});

test("voidItemSchema rejects a missing lineKey", () => {
  const parsed = voidItemSchema.safeParse({ index: 0, qty: 1, expectedVoids: 0, reason: "Wrong item" });
  assert.equal(parsed.success, false);
});

test("voidItemSchema rejects an empty-string lineKey", () => {
  const parsed = voidItemSchema.safeParse({ index: 0, lineKey: "", qty: 1, expectedVoids: 0, reason: "Wrong item" });
  assert.equal(parsed.success, false, "an empty lineKey can never match a real orderLineKey");
});

test("voidItemSchema rejects a missing expectedVoids", () => {
  const parsed = voidItemSchema.safeParse({ index: 0, lineKey: LINE_KEY, qty: 1, reason: "Wrong item" });
  assert.equal(parsed.success, false, "expectedVoids is the client-anchored CAS term — it must be required, not optional");
});

test("voidItemSchema rejects a negative or fractional expectedVoids", () => {
  assert.equal(
    voidItemSchema.safeParse({ index: 0, lineKey: LINE_KEY, qty: 1, expectedVoids: -1, reason: "Wrong item" }).success,
    false,
  );
  assert.equal(
    voidItemSchema.safeParse({ index: 0, lineKey: LINE_KEY, qty: 1, expectedVoids: 0.5, reason: "Wrong item" }).success,
    false,
  );
});

test("voidItemSchema accepts expectedVoids 0 (a tab with no prior void is a valid starting view)", () => {
  const parsed = voidItemSchema.safeParse({ index: 0, lineKey: LINE_KEY, qty: 1, expectedVoids: 0, reason: "Wrong item" });
  assert.equal(parsed.success, true);
});

test("voidItemSchema no longer accepts a productId field at all — it must be rejected as an unknown key (.strict())", () => {
  const parsed = voidItemSchema.safeParse({
    index: 0,
    lineKey: LINE_KEY,
    qty: 1,
    expectedVoids: 0,
    reason: "Wrong item",
    productId: "p1", // the OLD field — must not silently pass through
  });
  assert.equal(parsed.success, false, "productId is gone from this contract; a stale client sending it must fail loudly");
});

test("voidItemSchema rejects a short/blank reason", () => {
  assert.equal(
    voidItemSchema.safeParse({ index: 0, lineKey: LINE_KEY, qty: 1, expectedVoids: 0, reason: "" }).success,
    false,
  );
  assert.equal(
    voidItemSchema.safeParse({ index: 0, lineKey: LINE_KEY, qty: 1, expectedVoids: 0, reason: "  " }).success,
    false,
  );
  assert.equal(
    voidItemSchema.safeParse({ index: 0, lineKey: LINE_KEY, qty: 1, expectedVoids: 0, reason: "ok" }).success,
    false,
  );
});

test("voidItemSchema rejects unknown keys (.strict())", () => {
  const parsed = voidItemSchema.safeParse({
    index: 0,
    lineKey: LINE_KEY,
    qty: 1,
    expectedVoids: 0,
    reason: "Wrong item",
    voidedBy: "Asha", // server-resolved from the session, never client input
  });
  assert.equal(parsed.success, false, ".strict() must reject a client-supplied voidedBy/at/anything else");
});

test("voidItemSchema accepts index 0 (the first line is a valid target, not falsy-rejected)", () => {
  const parsed = voidItemSchema.safeParse({ index: 0, lineKey: LINE_KEY, qty: 1, expectedVoids: 0, reason: "Wrong item" });
  assert.equal(parsed.success, true);
});

// ── createOrderSchema — a born-cancelled order is impossible ─────────────────

function orderBase(over: Record<string, unknown> = {}) {
  return {
    customerName: "Walk-In",
    items: [{ productId: "p1", name: "Tea", price: 20, qty: 1, modifiers: [] }],
    subtotal: 20,
    total: 20,
    payment: "Cash" as const,
    receiver: "Staff",
    ...over,
  };
}

test("createOrderSchema rejects status Cancelled — an order cannot be born cancelled", () => {
  const parsed = createOrderSchema.safeParse(orderBase({ status: "Cancelled" }));
  assert.equal(parsed.success, false, "cancelling requires the audited POST /cancel route, which stamps who/when/why");
});

test("createOrderSchema still accepts status Pending", () => {
  const parsed = createOrderSchema.safeParse(orderBase({ status: "Pending", payment: "Unpaid" }));
  assert.equal(parsed.success, true);
});

test("createOrderSchema still accepts status Completed", () => {
  const parsed = createOrderSchema.safeParse(orderBase({ status: "Completed" }));
  assert.equal(parsed.success, true);
});

test("createOrderSchema (CR1.2 guarantee, re-pinned here): paidAmount omitted still parses — omit means pay in full", () => {
  const parsed = createOrderSchema.safeParse(orderBase());
  assert.equal(parsed.success, true, "paidAmount must stay optional so a client can express full payment without asserting a number");
});

// ── SOURCE PINS ───────────────────────────────────────────────────────────────
// Auth + route wiring cannot be exercised without a session (same limitation
// settle-money.test.ts's collectedAmount() pin works around) — these read the
// real route source so a regression fails the suite instead of shipping silent.

function readSource(relFromRepoRoot: string): string {
  return readFileSync(path.join(repoRoot, relFromRepoRoot), "utf8");
}

test("PIN: app/api/reports/route.ts still restricts its aggregation match to status Completed", () => {
  const src = readSource("apps/cafe/app/api/reports/route.ts");
  assert.match(
    src,
    /status:\s*"Completed"/,
    "reports/route.ts must match only Completed orders, or a cancelled sale would inflate the report totals",
  );
});

test("PIN: app/api/orders/summary/route.ts buckets on Completed/Pending only, so a Cancelled order lands in neither sales nor in-progress", () => {
  const src = readSource("apps/cafe/app/api/orders/summary/route.ts");
  assert.match(
    src,
    /\.status\s*===\s*"Completed"/,
    "the dashboard's realized-sales bucket must still be status === Completed",
  );
  assert.match(
    src,
    /\.status\s*===\s*"Pending"/,
    "the dashboard's in-progress bucket must still be status === Pending",
  );
});

test("PIN: app/api/orders/[id]/cancel/route.ts calls requireAdmin — cancelling is admin-only", () => {
  const src = readSource("apps/cafe/app/api/orders/[id]/cancel/route.ts");
  assert.match(src, /requireAdmin\s*\(/, "the cancel route must gate on requireAdmin(), not requireAuth()");
});

test("PIN: the DELETE handler in app/api/orders/[id]/route.ts calls requireAdmin — hard delete is break-glass only", () => {
  const src = readSource("apps/cafe/app/api/orders/[id]/route.ts");
  const deleteHandlerStart = src.indexOf("export async function DELETE");
  assert.ok(deleteHandlerStart !== -1, "DELETE handler must exist in app/api/orders/[id]/route.ts");
  const deleteHandlerSrc = src.slice(deleteHandlerStart);
  assert.match(
    deleteHandlerSrc,
    /requireAdmin\s*\(/,
    "DELETE must gate on requireAdmin() now that it is break-glass, not the cashier path",
  );
});

test("PIN: app/api/orders/[id]/items/void/route.ts guards on status Pending AND payment Unpaid, and uses voidGuardFilter rather than hand-rolling the concurrency term", () => {
  const src = readSource("apps/cafe/app/api/orders/[id]/items/void/route.ts");
  assert.match(
    src,
    /status\s*!==\s*"Pending"/,
    "a void must only be allowed on an open (Pending) tab",
  );
  assert.match(
    src,
    /payment\s*!==\s*"Unpaid"/,
    "a void must only be allowed while the tab is still held (Unpaid) — never after settlement",
  );
  assert.match(
    src,
    /voidGuardFilter\s*\(/,
    "the CAS term must come from the shared voidGuardFilter helper, not a hand-rolled { voids: { $size: ... } }",
  );
  assert.ok(
    !src.includes("$size"),
    "the route must not hand-roll the $size concurrency term itself — voidGuardFilter is the only place that constructs it",
  );
});

test("PIN: the void route guards on the CLIENT's expectedVoids (voidGuardFilter(parsed.data.expectedVoids)), NOT a server re-read — anchoring to what the operator saw is what makes a retry idempotent", () => {
  const src = readSource("apps/cafe/app/api/orders/[id]/items/void/route.ts");
  assert.match(
    src,
    /voidGuardFilter\(\s*parsed\.data\.expectedVoids\s*\)/,
    "a resend of a request whose first attempt already landed must carry the OLD count and 409, not silently re-derive " +
      "the current count from a fresh read and void a second unit off the line",
  );
  assert.ok(
    !/voidGuardFilter\(\s*old\.voids/.test(src),
    "the void route specifically must not fall back to a server-read voidGuardFilter(old.voids...) — that is the " +
      "server-anchored form used by /items and /settle (pinned below), which would defeat retry idempotency here",
  );
});

test("PIN: app/api/orders/[id]/items/route.ts (round-fire) guards its conditional update on voidGuardFilter(old.voids...) — without it a round-fire built from a stale read resurrects a voided line and re-bills it", () => {
  const src = readSource("apps/cafe/app/api/orders/[id]/items/route.ts");
  assert.match(
    src,
    /voidGuardFilter\(\s*old\.voids\?\.length\s*\?\?\s*0\s*\)/,
    "a void changes neither status nor kotRounds, so without this term a concurrent void inside the read-modify-write " +
      "window is silently undone by the round-fire's re-appended stale items (arbiter live-probe, CR1.3 review)",
  );
});

test("PIN: app/api/orders/[id]/settle/route.ts guards its conditional update on voidGuardFilter(old.voids...) — the total-CAS alone can't see a void on an already-fully-comped (total 0) tab", () => {
  const src = readSource("apps/cafe/app/api/orders/[id]/settle/route.ts");
  assert.match(
    src,
    /voidGuardFilter\(\s*old\.voids\?\.length\s*\?\?\s*0\s*\)/,
    "on a fully comped tab a void leaves total at 0 both before and after, so `total: old.total` alone would pass while " +
      "settling a bill that still charges the voided line",
  );
});

test("PIN: PUT app/api/orders/[id]/route.ts writes conditionally on the status it READ (findOneAndUpdate keyed on old.status), never an unconditional findByIdAndUpdate", () => {
  const src = readSource("apps/cafe/app/api/orders/[id]/route.ts");
  // The CAS terms live in a hoisted `filter` object since the table-move work
  // added a second, conditional term (tableNo) to it — so this pin asserts the
  // object still opens with the status CAS AND that the write is the one that
  // uses it. Splitting it that way keeps a dead `filter` const from passing while
  // the actual write goes out unconditional.
  assert.match(
    src,
    /const\s+filter\s*=\s*{\s*_id:\s*id,\s*status:\s*old\.status,/,
    "a cancel landing between PUT's read and write must make this filter miss — an unconditional write would let PUT's " +
      "own edit re-open a just-cancelled order and let reconcileLedger double-reverse it (arbiter live-probe, CR1.3 review)",
  );
  assert.match(
    src,
    /Order\.findOneAndUpdate\(\s*filter\s*,/,
    "the status-guarded filter must be the filter the write actually sends",
  );
  assert.ok(
    !src.includes("Order.findByIdAndUpdate("),
    "no code path may update the Order by bare _id without the status CAS term",
  );
});

test("PIN: DELETE app/api/orders/[id]/route.ts reverses the ledger ONLY when its own delete actually matched a row", () => {
  const src = readSource("apps/cafe/app/api/orders/[id]/route.ts");
  const deleteHandlerStart = src.indexOf("export async function DELETE");
  assert.ok(deleteHandlerStart !== -1, "DELETE handler must exist");
  const deleteSrc = src.slice(deleteHandlerStart);
  assert.match(
    deleteSrc,
    /const\s+deleted\s*=\s*await\s+Order\.findByIdAndDelete\(id\)/,
    "the atomic findByIdAndDelete result must be captured — two racing deletes only ever let ONE of them actually match",
  );
  const guardIdx = deleteSrc.search(/if\s*\(\s*!deleted\s*\)\s*return\s+notFound/);
  assert.ok(guardIdx !== -1, "the loser of a delete race must return early, not fall through to reconcileLedger");
  const reconcileIdx = deleteSrc.indexOf("reconcileLedger(");
  assert.ok(reconcileIdx !== -1, "the winner must still reverse the ledger");
  assert.ok(
    guardIdx < reconcileIdx,
    "the !deleted early-return must appear BEFORE reconcileLedger, so a losing/retried delete never reverses twice",
  );
});

test("PIN: across apps/cafe/app/api/**, the cancel route is the ONLY file that WRITES status Cancelled (comparisons like `status === \"Cancelled\"` or `$ne` are fine — only an assignment counts)", () => {
  // Deliberately narrow: matches `status: "Cancelled"` as an object-literal VALUE
  // (a $set / update / schema-default assignment), not `status === "Cancelled"`
  // or `{ $ne: "Cancelled" }` comparisons/exclusions elsewhere in the API surface
  // (e.g. the customer reconcile route's `status: { $ne: "Cancelled" }` filter,
  // which excludes cancelled orders rather than writing the status). A future
  // route/badge/label that merely MENTIONS the word must not trip this pin.
  const WRITE_PATTERN = /status:\s*"Cancelled"/;
  const apiRoot = path.join(repoRoot, "apps/cafe/app/api");
  const offenders: string[] = [];

  function walk(dirAbs: string): void {
    for (const entry of readdirSync(dirAbs)) {
      const abs = path.join(dirAbs, entry);
      if (statSync(abs).isDirectory()) {
        walk(abs);
      } else if (entry.endsWith(".ts")) {
        const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
        const src = readFileSync(abs, "utf8");
        if (WRITE_PATTERN.test(src)) offenders.push(rel);
      }
    }
  }
  walk(apiRoot);

  assert.deepEqual(
    offenders,
    ["apps/cafe/app/api/orders/[id]/cancel/route.ts"],
    "exactly one route may WRITE status Cancelled — a second writer would bypass the admin-only, reason-required, " +
      "ledger-reversing cancel path this step exists to centralize",
  );
});

test("PIN: across apps/cafe/app/api/**, `voids` is written ONLY by the void route, and ONLY via $push (never a $set/plain-object overwrite, which would replace or truncate the trail)", () => {
  // Every occurrence of the literal key `voids:` (a write site — property READS
  // like `old.voids?.length` have no colon directly after `voids` and so never
  // match) must be immediately inside a `$push: { voids: ... }` block. A bare
  // `voids: [...]` (whether under `$set` or as a plain replacement field) would
  // overwrite or truncate the append-only trail instead of appending to it. This
  // is deliberately narrow the same way the Cancelled-write pin above is: a
  // comment mentioning "voids[]" or a read-side `old.voids?.length` guard must
  // not trip it — only an actual write of the key does.
  const VOIDS_KEY_PATTERN = /\bvoids:/g;
  const VOIDS_PUSH_PATTERN = /\$push:\s*{\s*voids:/g;
  const apiRoot = path.join(repoRoot, "apps/cafe/app/api");
  const writers: string[] = [];
  const overwriters: string[] = [];

  function walk(dirAbs: string): void {
    for (const entry of readdirSync(dirAbs)) {
      const abs = path.join(dirAbs, entry);
      if (statSync(abs).isDirectory()) {
        walk(abs);
      } else if (entry.endsWith(".ts")) {
        const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
        const src = readFileSync(abs, "utf8");
        const totalKeyHits = (src.match(VOIDS_KEY_PATTERN) ?? []).length;
        if (totalKeyHits === 0) continue;
        const pushHits = (src.match(VOIDS_PUSH_PATTERN) ?? []).length;
        writers.push(rel);
        if (pushHits !== totalKeyHits) overwriters.push(rel);
      }
    }
  }
  walk(apiRoot);

  assert.deepEqual(
    writers,
    ["apps/cafe/app/api/orders/[id]/items/void/route.ts"],
    "exactly one route may write the `voids` key at all",
  );
  assert.deepEqual(
    overwriters,
    [],
    "every `voids:` write site must be wrapped in $push — a $set or plain-object assignment would overwrite/truncate " +
      "the append-only void trail instead of appending to it",
  );
});
