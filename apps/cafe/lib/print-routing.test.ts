import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  hostRoutingOf,
  shouldRoutePrint,
  printJobLabel,
  kotPrintJob,
  voidPrintJob,
  billPrintJob,
  movedPrintJob,
  cancelNoticePrintJob,
  eodPrintJob,
  type PrintHostRouting,
} from "@/lib/print-routing";
import { printJobKeyOf, printJobOrderIdOf } from "@/lib/print-queue";
import { PRINT_JOB_LABEL_MAX_CHARS, type PrintHostState } from "@pos/shared/print-job";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { printJobPayloadSchema, printOrderSnapshotSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import type { Order, OrderVoid, OrderItem } from "@/types";

// Print-host plan (.claude/plan/v2/print-host-plan.md §B4/§B5/§B7/§F, slice
// PH-4) — DB-free unit tests for the PURE module lib/print-routing.ts (the
// 3-state lane derivation, the label truncator, and the five payload
// builders), plus SOURCE-TEXT PINS over the hooks/lib files the seam wires
// through (mirroring lib/print-queue.test.ts's split, and — per the test
// spec — lib/print-paths.test.ts's readFileSync idiom with NO stripComments:
// every regex/substring check below also sees comment text, deliberately).
// No mongod, no connectDB, no mongoose connection anywhere in this file.

// ── Fixtures ─────────────────────────────────────────────────────────────

// One item carrying every field a synthesized line / snapshot must survive
// (variation, modifiers, instructions) so item (h)'s snapshot-completeness
// pin has real, non-default values to check for.
const SNAPSHOT_ITEM: OrderItem = {
  productId: "p1",
  name: "Filter Coffee",
  price: 4000,
  qty: 2,
  variation: "Large",
  modifiers: ["Extra shot"],
  instructions: "No sugar",
  kotRound: 1,
};

function orderFixture(overrides: Partial<Order> = {}): Order {
  return {
    _id: "665f0a0000000000000000a1",
    orderId: "ORD-0001",
    customerName: "Walk-in",
    items: [SNAPSHOT_ITEM],
    subtotal: 8000,
    discount: 0,
    total: 8000,
    paidAmount: 8000,
    payment: "Cash",
    status: "Completed",
    receiver: "Staff",
    tableNo: "T-4",
    kotRounds: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function orderVoidFixture(overrides: Partial<OrderVoid> = {}): OrderVoid {
  return {
    productId: "p1",
    name: "Filter Coffee",
    price: 4000,
    qty: 2,
    kotRound: 1,
    reason: "Wrong order",
    voidedBy: "Manager",
    at: "2026-01-02T10:00:00.000Z",
    ...overrides,
  };
}

const BASE_PRINT_HOST_STATE: PrintHostState = {
  configured: true,
  deviceId: "dev-1",
  label: "Counter PC",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  offline: false,
  silentMode: false,
};

function pulseFixture(overrides: Partial<PosPulseData> = {}): PosPulseData {
  return {
    openCount: 0,
    openTruncated: false,
    newestOpenId: null,
    newestOpenAt: null,
    openRev: null,
    selfOrders: [],
    selfOrdersTruncated: false,
    printHost: BASE_PRINT_HOST_STATE,
    printJobs: [],
    printJobsTruncated: false,
    stalePrintJobs: [],
    stalePrintJobsTruncated: false,
    resolvedPrintJobs: [],
    resolvedPrintJobsTruncated: false,
    ...overrides,
  };
}

// A TS assertion function so a discriminated PrintJobPayload can be narrowed
// after checking `.kind` with node:assert (which carries no type predicate of
// its own) — no `any`, no unchecked cast.
function assertKind<K extends PrintJobPayload["kind"]>(
  payload: PrintJobPayload,
  kind: K,
): asserts payload is Extract<PrintJobPayload, { kind: K }> {
  assert.equal(payload.kind, kind, `expected payload.kind === "${kind}"`);
}

// ── (a) hostRoutingOf — the three states ────────────────────────────────

test("hostRoutingOf: pulse undefined -> unknown", () => {
  assert.equal(hostRoutingOf(undefined), "unknown");
});

test("a degraded pulse tick (printHost === null) is UNKNOWN, never no-host", () => {
  assert.equal(hostRoutingOf(pulseFixture({ printHost: null })), "unknown");
});

test("hostRoutingOf: printHost.configured === true -> host", () => {
  assert.equal(
    hostRoutingOf(pulseFixture({ printHost: { ...BASE_PRINT_HOST_STATE, configured: true } })),
    "host",
  );
});

test("hostRoutingOf: printHost.configured === false -> no-host", () => {
  assert.equal(
    hostRoutingOf(pulseFixture({ printHost: { ...BASE_PRINT_HOST_STATE, configured: false } })),
    "no-host",
  );
});

// ── (b) shouldRoutePrint — the FULL 3x2 matrix ──────────────────────────

const ROUTING_STATES: readonly PrintHostRouting[] = ["host", "no-host", "unknown"];
const SEEN_VALUES: readonly boolean[] = [true, false];
// Row-major over ROUTING_STATES x SEEN_VALUES: host/true, host/false,
// no-host/true, no-host/false, unknown/true, unknown/false.
const EXPECTED_MATRIX: readonly boolean[] = [true, true, false, false, true, false];

test("shouldRoutePrint: pins the FULL 3x2 matrix — a happy-path assert alone would miss unknown+false (memory emitted-design-tokens-need-pair-gates)", () => {
  let i = 0;
  for (const routing of ROUTING_STATES) {
    for (const seen of SEEN_VALUES) {
      const expected = EXPECTED_MATRIX[i];
      assert.equal(
        shouldRoutePrint(routing, seen),
        expected,
        `shouldRoutePrint(${routing}, ${seen}) should be ${expected}`,
      );
      i++;
    }
  }
});

test("shouldRoutePrint: the two MERGED-19 sentences in isolation", () => {
  assert.equal(shouldRoutePrint("unknown", true), true, 'an UNKNOWN lane on a device that has seen a host must route');
  assert.equal(shouldRoutePrint("no-host", true), false, "no-host never routes, regardless of printHostSeen");
});

// ── (c) printJobLabel ────────────────────────────────────────────────────

test("printJobLabel: collapses newlines/tabs/runs of spaces to a single space, and trims", () => {
  assert.equal(printJobLabel("  Hello\n\tWorld   ", "fb"), "Hello World");
});

test(`printJobLabel: a 500-char candidate is capped at PRINT_JOB_LABEL_MAX_CHARS (${PRINT_JOB_LABEL_MAX_CHARS})`, () => {
  const label = printJobLabel("x".repeat(500), "fb");
  assert.ok(label.length <= PRINT_JOB_LABEL_MAX_CHARS, `label.length (${label.length}) must be <= PRINT_JOB_LABEL_MAX_CHARS`);
});

test("printJobLabel: an all-whitespace candidate falls back to the (normalized) fallback, non-empty", () => {
  assert.equal(printJobLabel("   ", "Fallback"), "Fallback");
});

test('printJobLabel("", "") never returns "" — falls back to the module\'s own fallback const (the route\'s Zod is .min(1); a "" label would reject the whole slip)', () => {
  const label = printJobLabel("", "");
  assert.notEqual(label, "");
  assert.ok(label.length > 0);
});

test("printJobLabel: a label exactly PRINT_JOB_LABEL_MAX_CHARS long is returned unchanged (boundary)", () => {
  const exact = "A".repeat(PRINT_JOB_LABEL_MAX_CHARS);
  assert.equal(printJobLabel(exact, "fb"), exact);
});

// ── (d) every builder's payload PARSES its own schema ───────────────────

function assertPayloadParses(kind: string, payload: PrintJobPayload): void {
  const result = printJobPayloadSchema.safeParse(payload);
  if (!result.success) {
    assert.fail(`${kind} payload failed to parse printJobPayloadSchema: ${JSON.stringify(result.error.issues)}`);
  }
}

test("kotPrintJob: payload parses printJobPayloadSchema, and label is non-empty and within bound", () => {
  const job = kotPrintJob(orderFixture(), 2);
  assertPayloadParses("kot", job.payload);
  assert.ok(job.label.length > 0);
  assert.ok(job.label.length <= PRINT_JOB_LABEL_MAX_CHARS);
});

test("voidPrintJob: payload parses printJobPayloadSchema, and label is non-empty and within bound", () => {
  const job = voidPrintJob(orderFixture(), orderVoidFixture(), { reprint: false });
  assertPayloadParses("void", job.payload);
  assert.ok(job.label.length > 0);
  assert.ok(job.label.length <= PRINT_JOB_LABEL_MAX_CHARS);
});

test("billPrintJob: payload parses printJobPayloadSchema, and label is non-empty and within bound", () => {
  const job = billPrintJob(orderFixture(), { reprint: false });
  assertPayloadParses("bill", job.payload);
  assert.ok(job.label.length > 0);
  assert.ok(job.label.length <= PRINT_JOB_LABEL_MAX_CHARS);
});

test("movedPrintJob: payload parses printJobPayloadSchema, and label is non-empty and within bound", () => {
  const job = movedPrintJob(orderFixture(), { from: "T-1", movedBy: "Staff", movedAt: "2026-01-02T10:00:00.000Z" }, { reprint: false });
  assertPayloadParses("moved", job.payload);
  assert.ok(job.label.length > 0);
  assert.ok(job.label.length <= PRINT_JOB_LABEL_MAX_CHARS);
});

test("cancelNoticePrintJob: payload parses printJobPayloadSchema, and label is non-empty and within bound", () => {
  const job = cancelNoticePrintJob(orderFixture(), "Customer left");
  assertPayloadParses("cancel-notice", job.payload);
  assert.ok(job.label.length > 0);
  assert.ok(job.label.length <= PRINT_JOB_LABEL_MAX_CHARS);
});

// ── (e) the kot round discriminator (MERGED-04) ─────────────────────────

test("kotPrintJob: round 2 -> payload.round === 2", () => {
  const job = kotPrintJob(orderFixture(), 2);
  assertKind(job.payload, "kot");
  assert.equal(job.payload.round, 2);
});

test("kotPrintJob: round null -> payload.round === null (NOT undefined — the discriminator is nullable, never optional, and must always be stated), and the key is always present", () => {
  const job = kotPrintJob(orderFixture(), null);
  assertKind(job.payload, "kot");
  assert.equal(job.payload.round, null);
  assert.ok("round" in job.payload, '"round" must be present in the payload even when null');
});

// ── (f) the reprint flag (D-10) ──────────────────────────────────────────

test("billPrintJob: reprint:true sets payload.reprint === true; reprint:false OMITS the key entirely (never a literal false — the schema is z.literal(true).optional())", () => {
  const withReprint = billPrintJob(orderFixture(), { reprint: true });
  assertKind(withReprint.payload, "bill");
  assert.equal(withReprint.payload.reprint, true);

  const withoutReprint = billPrintJob(orderFixture(), { reprint: false });
  assertKind(withoutReprint.payload, "bill");
  assert.equal(Object.hasOwn(withoutReprint.payload, "reprint"), false, "reprint must be omitted, not set to false");
});

test("billPrintJob + printJobKeyOf: a reprint has NO jobKey (undefined, can never collide with the resolved original's key); a first-time bill has a non-empty jobKey", () => {
  const reprintKey = printJobKeyOf(billPrintJob(orderFixture(), { reprint: true }).payload);
  assert.equal(reprintKey, undefined);
  const firstKey = printJobKeyOf(billPrintJob(orderFixture(), { reprint: false }).payload);
  assert.equal(typeof firstKey, "string");
  assert.ok(firstKey !== undefined && firstKey.length > 0);
});

test("voidPrintJob: reprint:true sets payload.reprint === true; reprint:false OMITS the key entirely", () => {
  const withReprint = voidPrintJob(orderFixture(), orderVoidFixture(), { reprint: true });
  assertKind(withReprint.payload, "void");
  assert.equal(withReprint.payload.reprint, true);

  const withoutReprint = voidPrintJob(orderFixture(), orderVoidFixture(), { reprint: false });
  assertKind(withoutReprint.payload, "void");
  assert.equal(Object.hasOwn(withoutReprint.payload, "reprint"), false, "reprint must be omitted, not set to false");
});

test("voidPrintJob + printJobKeyOf: a reprint has NO jobKey; a first-time void has a non-empty jobKey", () => {
  const reprintKey = printJobKeyOf(voidPrintJob(orderFixture(), orderVoidFixture(), { reprint: true }).payload);
  assert.equal(reprintKey, undefined);
  const firstKey = printJobKeyOf(voidPrintJob(orderFixture(), orderVoidFixture(), { reprint: false }).payload);
  assert.equal(typeof firstKey, "string");
  assert.ok(firstKey !== undefined && firstKey.length > 0);
});

test("movedPrintJob: reprint:true sets payload.reprint === true; reprint:false OMITS the key entirely", () => {
  const meta = { from: "T-1", movedBy: "Staff", movedAt: "2026-01-02T10:00:00.000Z" };
  const withReprint = movedPrintJob(orderFixture(), meta, { reprint: true });
  assertKind(withReprint.payload, "moved");
  assert.equal(withReprint.payload.reprint, true);

  const withoutReprint = movedPrintJob(orderFixture(), meta, { reprint: false });
  assertKind(withoutReprint.payload, "moved");
  assert.equal(Object.hasOwn(withoutReprint.payload, "reprint"), false, "reprint must be omitted, not set to false");
});

test("movedPrintJob + printJobKeyOf: a reprint has NO jobKey; a first-time moved slip has a non-empty jobKey", () => {
  const meta = { from: "T-1", movedBy: "Staff", movedAt: "2026-01-02T10:00:00.000Z" };
  const reprintKey = printJobKeyOf(movedPrintJob(orderFixture(), meta, { reprint: true }).payload);
  assert.equal(reprintKey, undefined);
  const firstKey = printJobKeyOf(movedPrintJob(orderFixture(), meta, { reprint: false }).payload);
  assert.equal(typeof firstKey, "string");
  assert.ok(firstKey !== undefined && firstKey.length > 0);
});

// ── (g) voidPrintJob's synthesized line — field-for-field, with landmarks ─

const VOID_LINE_SCHEMA_KEYS = ["productId", "name", "variation", "price", "qty", "modifiers", "instructions", "kotRound", "kotNumber"];
// CB-5B S14-remainder — a reward void line ADDS exactly one key (`reward`) on
// top of the ordinary set above. Kept as its OWN exact-key-set constant
// (never spread the ordinary one with a conditional) so a change to either
// list is a deliberate, visible edit — the whole point of an exact-key-set
// pin is that it fails on a SILENTLY added or dropped key, and a shared
// array with a runtime branch would let that drift past the pin itself.
const VOID_LINE_SCHEMA_KEYS_REWARD = [...VOID_LINE_SCHEMA_KEYS, "reward"];

test("voidPrintJob: the synthesized line's key set matches the schema's line sub-schema exactly (with kotNumber present), and carries every landmark field — a NORMAL (non-reward) line carries NO extra keys (the omit-empty fence)", () => {
  const job = voidPrintJob(orderFixture(), orderVoidFixture({ kotNumber: 7 }), { reprint: false });
  assertKind(job.payload, "void");
  const keys = Object.keys(job.payload.line).sort();
  assert.deepEqual(keys, [...VOID_LINE_SCHEMA_KEYS].sort());
  for (const field of ["productId", "name", "variation", "price", "qty", "modifiers", "instructions", "kotRound"]) {
    assert.ok(field in job.payload.line, `line must carry ${field}`);
  }
});

test("voidPrintJob: a REWARD void line's key set is the ordinary set PLUS 'reward' — nothing else silently rides along", () => {
  const job = voidPrintJob(orderFixture(), orderVoidFixture({ kotNumber: 7, reward: true }), { reprint: false });
  assertKind(job.payload, "void");
  const keys = Object.keys(job.payload.line).sort();
  assert.deepEqual(keys, [...VOID_LINE_SCHEMA_KEYS_REWARD].sort());
  assert.equal(job.payload.line.reward, true);
});

test("voidPrintJob: line.qty is the VOIDED qty from the entry, NOT the order line's remaining qty (order line qty:5, void entry qty:2)", () => {
  const ord = orderFixture({ items: [{ ...SNAPSHOT_ITEM, qty: 5 }] });
  const entry = orderVoidFixture({ qty: 2 });
  const job = voidPrintJob(ord, entry, { reprint: false });
  assertKind(job.payload, "void");
  assert.equal(job.payload.line.qty, 2);
});

test("voidPrintJob: line.variation survives verbatim from entry.variation", () => {
  const job = voidPrintJob(orderFixture(), orderVoidFixture({ variation: "Large" }), { reprint: false });
  assertKind(job.payload, "void");
  assert.equal(job.payload.line.variation, "Large");
});

test('voidPrintJob: line.modifiers defaults to [] and line.instructions defaults to "" when the entry omits them', () => {
  const entry = orderVoidFixture();
  delete entry.modifiers;
  delete entry.instructions;
  const job = voidPrintJob(orderFixture(), entry, { reprint: false });
  assertKind(job.payload, "void");
  assert.deepEqual(job.payload.line.modifiers, []);
  assert.equal(job.payload.line.instructions, "");
});

test("voidPrintJob: line.kotNumber is OMITTED when the entry has none, and present when it does", () => {
  const withoutNumber = voidPrintJob(orderFixture(), orderVoidFixture(), { reprint: false });
  assertKind(withoutNumber.payload, "void");
  assert.ok(!("kotNumber" in withoutNumber.payload.line), "kotNumber must be omitted, not present as undefined");
  // positive landmark: the rest of the line still built normally
  assert.equal(withoutNumber.payload.line.productId, "p1");

  const withNumber = voidPrintJob(orderFixture(), orderVoidFixture({ kotNumber: 7 }), { reprint: false });
  assertKind(withNumber.payload, "void");
  assert.ok("kotNumber" in withNumber.payload.line, "kotNumber must be present when the entry carries one");
  assert.equal(withNumber.payload.line.kotNumber, 7);
});

test("voidPrintJob: reason/voidedBy/voidedAt come from the ENTRY, never the order's opener/open-time", () => {
  const ord = orderFixture({ receiver: "Staff", createdAt: "2026-01-01T00:00:00.000Z" });
  const entry = orderVoidFixture({ reason: "Wrong order", voidedBy: "Manager", at: "2026-01-02T10:00:00.000Z" });
  const job = voidPrintJob(ord, entry, { reprint: false });
  assertKind(job.payload, "void");
  assert.equal(job.payload.reason, "Wrong order");
  assert.equal(job.payload.voidedBy, "Manager");
  assert.equal(job.payload.voidedAt, "2026-01-02T10:00:00.000Z");
  assert.notEqual(job.payload.voidedBy, ord.receiver);
  assert.notEqual(job.payload.voidedAt, ord.createdAt);
});

// ── (h) snapshot completeness ────────────────────────────────────────────

test("kotPrintJob: payload.snapshot parses printOrderSnapshotSchema, and items[0] carries modifiers, instructions, variation, name", () => {
  const job = kotPrintJob(orderFixture(), 1);
  assertKind(job.payload, "kot");
  const result = printOrderSnapshotSchema.safeParse(job.payload.snapshot);
  if (!result.success) {
    assert.fail(`snapshot failed to parse printOrderSnapshotSchema: ${JSON.stringify(result.error.issues)}`);
  }
  const item = job.payload.snapshot.items[0];
  assert.ok(item, "snapshot must carry at least one item");
  assert.equal(item.name, SNAPSHOT_ITEM.name);
  assert.equal(item.variation, SNAPSHOT_ITEM.variation);
  assert.deepEqual(item.modifiers, SNAPSHOT_ITEM.modifiers);
  assert.equal(item.instructions, SNAPSHOT_ITEM.instructions);
});

// ── 2. Source pins ───────────────────────────────────────────────────────
// readFileSync + the SAME REPO_ROOT idiom as print-paths.test.ts:28-29 — NO
// stripComments, so every check below also sees comment text (deliberately:
// testing.md's banned-string-scan rule reads raw bytes including comments —
// "never quote a banned literal anywhere in a scanned file, comments
// included"). Every negative assert is paired with a positive landmark in
// the same test so a scan reading the wrong (or an empty) file can't pass
// vacuously.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const USE_PRINT_ROUTING = "apps/cafe/hooks/use-print-routing.ts";
const USE_HOST_ROUTING = "apps/cafe/hooks/use-host-routing.ts";
const POS_PULSE_PROVIDER = "apps/cafe/components/layout/PosPulseProvider.tsx";
const USE_POS_PRINT = "apps/cafe/hooks/use-pos-print.ts";
const USE_POS_TAB = "apps/cafe/hooks/use-pos-tab.ts";
const POS_DEVICE_PREFS = "apps/cafe/lib/pos-device-prefs.ts";
const POS_DEVICE_ID = "apps/cafe/lib/pos-device-id.ts";

test("SOURCE PIN: hooks/use-host-routing.ts carries the routing primitives since CB-1d.3b (moved out of use-print-routing.ts), calls printJobEnqueueAllowsLocalPrint( at least twice (the shared route helper + queueMovedSlip), and never re-derives the routing rule by hand (no bare `?? false` coercion); PosPulseProvider.tsx derives the lane via hostRoutingOf( exactly once and provides it through PrintHostRoutingContext; use-print-routing.ts re-exports useHostRouting but no longer owns any routing primitive itself", () => {
  const hostSrc = readSrc(USE_HOST_ROUTING);
  // positive landmarks on the new home
  assert.match(hostSrc, /usePrintHostRouting\(/, "use-host-routing.ts must call usePrintHostRouting(");
  assert.match(hostSrc, /shouldRoutePrint\(/, "use-host-routing.ts must call shouldRoutePrint(");
  const allowsLocalPrintCalls = countOccurrences(hostSrc, "printJobEnqueueAllowsLocalPrint(");
  assert.ok(
    allowsLocalPrintCalls >= 2,
    `expected printJobEnqueueAllowsLocalPrint( at least twice in use-host-routing.ts (shared route helper + queueMovedSlip), found ${allowsLocalPrintCalls}`,
  );
  // negative: MERGED-19 bans coercing the unknown lane with `?? false`
  assert.ok(!hostSrc.includes("?? false"), "use-host-routing.ts must never coerce a routing decision with `?? false` (MERGED-19)");
  // negative: D-11 — the ONLY sanctioned local-print predicate is
  // printJobEnqueueAllowsLocalPrint(result.outcome); the literal "no-host"
  // string must never appear here (it may live only in @pos/shared/print-job
  // and the server libs), so a hand-rolled `=== "no-host"` branch can never
  // sneak in — including as a comment quoting the banned literal.
  assert.ok(!hostSrc.includes('"no-host"'), 'use-host-routing.ts must never contain the literal "no-host" (D-11) — the routing outcome check goes through printJobEnqueueAllowsLocalPrint( only, never a hand-rolled string compare, not even in a comment');
  // negative: the whole point of CB-1d.3b C1 — this hook must read the
  // NARROW derived-lane context, never the whole pulse context (that is
  // exactly the re-render-everything bug this split fixes).
  assert.ok(!hostSrc.includes("usePosPulseContext("), "use-host-routing.ts must never call usePosPulseContext( — it must read the derived lane via usePrintHostRouting( only (CB-1d.3b C1)");

  // PosPulseProvider.tsx: the lane derivation's new, sole home.
  const providerSrc = readSrc(POS_PULSE_PROVIDER);
  const hostRoutingOfCalls = countOccurrences(providerSrc, "hostRoutingOf(");
  assert.equal(hostRoutingOfCalls, 1, `expected hostRoutingOf( exactly once in PosPulseProvider.tsx, found ${hostRoutingOfCalls}`);
  assert.match(providerSrc, /const routing = hostRoutingOf\(data\);/, "PosPulseProvider.tsx must derive const routing = hostRoutingOf(data);");
  assert.match(
    providerSrc,
    /<PrintHostRoutingContext\.Provider value=\{routing\}>/,
    "PosPulseProvider.tsx must provide the derived lane through <PrintHostRoutingContext.Provider value={routing}>",
  );
  assert.ok(!providerSrc.includes("?? false"), "PosPulseProvider.tsx must never coerce a routing decision with `?? false` (MERGED-19)");
  assert.ok(!providerSrc.includes('"no-host"'), 'PosPulseProvider.tsx must never contain the literal "no-host" (D-11)');

  // use-print-routing.ts: the re-export seam PH-6's imports depend on, and
  // nothing else — the routing primitives themselves moved out.
  const routingSrc = readSrc(USE_PRINT_ROUTING);
  assert.match(
    routingSrc,
    /export \{ useHostRouting, type PrintRoutingHost \};/,
    "use-print-routing.ts must re-export { useHostRouting, type PrintRoutingHost } — the seam PH-6's imports (MoveTableDialog/OrderDetailSheet/EndOfDayButton) depend on",
  );
  const useHostRoutingCalls = countOccurrences(routingSrc, "useHostRouting(");
  assert.equal(useHostRoutingCalls, 1, `expected useHostRouting( exactly once in use-print-routing.ts, found ${useHostRoutingCalls}`);
  assert.ok(!routingSrc.includes("usePosPulseContext("), "use-print-routing.ts must never call usePosPulseContext( — that subscription moved out with the routing primitives");
  assert.ok(!routingSrc.includes('"no-host"'), 'use-print-routing.ts must never contain the literal "no-host" (D-11)');
  assert.ok(!routingSrc.includes("?? false"), "use-print-routing.ts must never coerce a routing decision with `?? false` (MERGED-19)");
});

test("SOURCE PIN: hooks/use-pos-print.ts calls usePrintRouting( exactly once, and its return block names all five routed keys explicitly (a bare ...spread would go undetected here)", () => {
  const src = readSrc(USE_POS_PRINT);
  const usePrintRoutingCalls = countOccurrences(src, "usePrintRouting(");
  assert.equal(usePrintRoutingCalls, 1, `expected usePrintRouting( exactly once, found ${usePrintRoutingCalls}`);
  for (const key of ["queueKotRound:", "queueVoidSlip:", "reprintKot:", "queueReceipt:", "queueMovedSlip:"]) {
    assert.ok(src.includes(key), `the return block must name ${key} explicitly`);
  }
  // positive landmark: the pinned queueKotRound signature (print-paths.test.ts
  // pin §2.1) must still be intact after this slice's edits.
  assert.ok(
    src.includes("const queueKotRound = useCallback((order: Order, round: number = order.kotRounds)"),
    "queueKotRound's byte-for-byte signature must survive",
  );
});

test("SOURCE PIN: hooks/use-pos-tab.ts calls print.queueReceipt( exactly twice (both confirmPayment branches), and NEVER calls print.setShouldPrintReceipt(true) any more (replaced by queueReceipt), paired with the positive landmark that print.queueKotRound(order); is still present", () => {
  const src = readSrc(USE_POS_TAB);
  const queueReceiptCalls = countOccurrences(src, "print.queueReceipt(");
  assert.equal(queueReceiptCalls, 2, `expected print.queueReceipt( exactly twice, found ${queueReceiptCalls}`);
  assert.ok(!src.includes("print.setShouldPrintReceipt(true)"), "print.setShouldPrintReceipt(true) must no longer appear — queueReceipt replaces it");
  assert.ok(src.includes("print.queueKotRound(order);"), "positive landmark: print.queueKotRound(order); must still be present");
});

test("SOURCE PIN: lib/pos-device-prefs.ts reads printHost/printHostSeen via Object.hasOwn( exactly twice (the lenient-validation rule), and both fields appear in the interface AND the defaults; the storage key is unchanged", () => {
  const src = readSrc(POS_DEVICE_PREFS);
  const hasOwnCalls = countOccurrences(src, "Object.hasOwn(");
  assert.equal(hasOwnCalls, 2, `expected Object.hasOwn( exactly twice (printHost + printHostSeen), found ${hasOwnCalls}`);
  assert.match(src, /printHostSeen:\s*boolean;/, "printHostSeen must appear in the PosDevicePrefs interface");
  assert.match(src, /printHostSeen:\s*false,/, "printHostSeen must appear in DEFAULT_DEVICE_PREFS");
  assert.ok(src.includes('"pos.device-prefs.v1"'), "the storage key must be unchanged — a rename would silently reset every device");
});

test('SOURCE PIN: lib/pos-device-id.ts keeps "pos.device-id.v1" and the insecure-context guard (typeof crypto.randomUUID === "function"), and never falls back to Math.random — paired with the positive landmark that getRandomValues is the real fallback', () => {
  const src = readSrc(POS_DEVICE_ID);
  assert.ok(src.includes('"pos.device-id.v1"'), "the device-id storage key must be present");
  assert.ok(src.includes('typeof crypto.randomUUID === "function"'), "the insecure-context guard must gate on the method itself");
  // positive landmark first, so the negative check below can't pass vacuously
  // against a blinded/empty read.
  assert.ok(src.includes("crypto.getRandomValues"), "positive landmark: getRandomValues must be the real fallback");
  assert.ok(!src.includes("Math.random"), "must never contain Math.random — two tablets booted together would collide, not even in a comment describing why");
});

// ── Post-review regression pins (PH-4 fix round) ─────────────────────────
// Each of the five below pins a defect the adversarial pass found and the
// main thread fixed. They exist so the SAME defect cannot return silently.

const DEVICE_ALERT_SETTINGS = "apps/cafe/components/orders/DeviceAlertSettings.tsx";
const ENQUEUE_ROUTE = "apps/cafe/app/api/print-jobs/route.ts";

test("REGRESSION: routed prints serialize through one chain, while the no-host lane stays synchronous (§F) — a concurrent KOT+bill pair must not race", () => {
  // The chain (routedChainRef) moved with useHostRouting into
  // hooks/use-host-routing.ts in CB-1d.3b — read that file now.
  const src = readSrc(USE_HOST_ROUTING);
  // The chain itself: without it confirmPayment's pay-now pair fires two
  // concurrent POSTs, so the drain can print the bill before the kitchen
  // ticket (MERGED-16) and, on a no-host answer, the two local fallbacks
  // commit in HTTP-completion order — react-to-print's ONE fixed-id iframe
  // then means the second trigger kills the first's in-flight job.
  assert.match(src, /routedChainRef/, "routed enqueues must serialize through a chain ref");
  const chained = countOccurrences(src, "routedChainRef.current = routedChainRef.current");
  assert.equal(chained, 1, `expected exactly one chain advance, found ${chained}`);
  // ...and the no-host lane must return BEFORE reaching it, so both print
  // flags still land in one React batch exactly as they did pre-PH-4.
  const fastPath = src.indexOf("if (!shouldRoute) {");
  const chainAt = src.indexOf("routedChainRef.current = routedChainRef.current");
  assert.ok(fastPath > 0, "positive landmark: the !shouldRoute fast path must exist");
  assert.ok(
    fastPath < chainAt,
    "the synchronous !shouldRoute fast path must come BEFORE the chain — deferring it breaks §F byte-identical parity",
  );
});

test("REGRESSION: the routed lane still records lastOrder — otherwise PosHeader's KOT reprint button disappears and reprintKot can never build a payload", () => {
  const routingSrc = readSrc(USE_PRINT_ROUTING);
  // The three order-taking wrappers must record the tab on BOTH lanes: the
  // routed lane runs none of the local queue functions, and `lastOrder` is
  // not a print signal.
  const noted = countOccurrences(routingSrc, "noteOrder(order);");
  assert.equal(noted, 3, `expected noteOrder(order); in all three order-taking wrappers, found ${noted}`);
  assert.match(routingSrc, /setLastOrder:\s*noteOrder/, "the recorder must arrive through the local surface");
  // ...and usePosPrint must actually hand it over.
  const printSrc = readSrc(USE_POS_PRINT);
  assert.match(
    printSrc,
    /local:\s*\{[^}]*setLastOrder[^}]*\}/,
    "usePosPrint must pass setLastOrder into usePrintRouting's local surface",
  );
});

test("PIN: reprintKot captures `const target = lastOrder;` and re-points the recorder at it (noteOrder(target);) BEFORE localReprint() on the routed lane's fallback — reprintKot is the ONE local path carrying no order of its own, so a deferred fallback that read the LIVE `lastOrder` binding (moved on by another tab firing/settling during the round trip) would print a full kitchen ticket for the WRONG tab", () => {
  const src = readSrc(USE_PRINT_ROUTING);
  // positive landmark: the tap-time capture itself.
  assert.match(src, /const target = lastOrder;/, "reprintKot must capture the tap-time lastOrder into `target`");
  // the routed call must build from `target`, and its runLocal must re-point
  // the recorder at `target` BEFORE calling localReprint().
  assert.match(
    src,
    /routePrint\(\(\) => kotPrintJob\(target, null\), \(\) => \{\s*noteOrder\(target\);\s*localReprint\(\);\s*\}\);/,
    "reprintKot's routed call must build kotPrintJob(target, null) and its runLocal must call noteOrder(target); BEFORE localReprint();",
  );
  // negative: kotPrintJob must never be built from the LIVE `lastOrder`
  // binding instead of the captured `target` — a live re-read reopens the
  // exact race this fixes (another tab's note landing between tap and
  // enqueue-answer).
  assert.ok(
    !src.includes("routePrint(() => kotPrintJob(lastOrder, null)"),
    "reprintKot must never build kotPrintJob from the live `lastOrder` binding — only from the captured `target`",
  );
  // the noteOrder(target); call is a DIFFERENT literal from noteOrder(order);
  // (pinned at exactly 3 in the REGRESSION test above) — it must appear
  // exactly once, and must never itself be spelled noteOrder(order); (which
  // would silently inflate that other pin's count and hide a real capture
  // bug behind an unrelated-looking pass).
  assert.equal(
    countOccurrences(src, "noteOrder(target);"),
    1,
    `expected noteOrder(target); exactly once (reprintKot's routed fallback), found ${countOccurrences(src, "noteOrder(target);")}`,
  );
});

test("REGRESSION: DeviceAlertSettings merges over a FRESH prefs read, never a mount-time snapshot (the reciprocal half of the seam's read-modify-write)", () => {
  const src = readSrc(DEVICE_ALERT_SETTINGS);
  assert.match(
    src,
    /\{\s*\.\.\.readDevicePrefs\(\),\s*\.\.\.next\s*\}/,
    "update() must merge over readDevicePrefs(), or a toggle reverts printHost/printHostSeen written by useHostRouting",
  );
  assert.ok(
    !/\{\s*\.\.\.prefs,\s*\.\.\.next\s*\}/.test(src),
    "update() must not merge over the mount-time `prefs` snapshot",
  );
  // positive landmark: it still persists the merged blob.
  assert.match(src, /writeDevicePrefs\(merged\)/, "positive landmark: the merged prefs must still be persisted");
});

test("REGRESSION: readDeviceId memoizes for the session, so a blocked storage write cannot re-mint a different id per call", () => {
  const src = readSrc(POS_DEVICE_ID);
  const memoRefs = countOccurrences(src, "sessionDeviceId");
  assert.ok(
    memoRefs >= 4,
    `expected the session memo to be declared, checked and assigned on BOTH resolution paths (>=4 references), found ${memoRefs}`,
  );
  assert.match(src, /if\s*\(sessionDeviceId\s*!==\s*null\)\s*return sessionDeviceId;/, "the memo must short-circuit every later call");
  assert.match(src, /sessionDeviceId = minted;/, "a minted id must be memoized even when the write fails");
  // positive landmark: the read path is still the first thing tried.
  assert.match(src, /localStorage\.getItem\(DEVICE_ID_KEY\)/, "positive landmark: storage is still read first");
});

test("REGRESSION: the enqueue route's label bound reads the SHARED constant, so the client truncator and the server Zod can never drift", () => {
  const src = readSrc(ENQUEUE_ROUTE);
  assert.match(
    src,
    /import \{[^}]*PRINT_JOB_LABEL_MAX_CHARS[^}]*\} from "@pos\/shared\/print-job";/,
    "the bound must be imported from @pos/shared/print-job (single home)",
  );
  assert.match(src, /\.max\(PRINT_JOB_LABEL_MAX_CHARS\)/, "the label schema must use the shared constant, not a literal");
  assert.ok(
    !/const PRINT_JOB_LABEL_MAX_CHARS\s*=/.test(src),
    "the route must not re-declare its own copy of the bound — a drift there 400s every over-long label and the slip prints nowhere",
  );
});

// ── PH-6 — the three routed print sites wired to useHostRouting/routePrint ──
// (.claude/plan/v2/print-host-plan.md §B5/§B7/§F, slice PH-6). `routePrint`
// itself is the MOVED `route` helper (unit-tested above via `use-print-routing`
// SOURCE PINs is not possible for its runtime branching — no React test
// framework in this repo, per lib/print-paths.test.ts's own header note — so
// every check below is a SOURCE-TEXT pin, same NO-stripComments idiom as the
// rest of this file). `eodPrintJob` alone gets real unit tests first, since it
// is a pure builder just like its four siblings above.

const MOVE_TABLE_DIALOG = "apps/cafe/components/orders/MoveTableDialog.tsx";
const ORDER_DETAIL_SHEET = "apps/cafe/components/orders/OrderDetailSheet.tsx";
const END_OF_DAY_BUTTON = "apps/cafe/components/reports/EndOfDayButton.tsx";
const DASHBOARD_LAYOUT = "apps/cafe/app/(dashboard)/layout.tsx";

// ── eodPrintJob (§B1 — the one payload kind with no order snapshot) ────────

test("eodPrintJob: payload parses printJobPayloadSchema, label is non-empty and within bound, and the label carries the dateLabel", () => {
  const job = eodPrintJob({ dateKey: "2026-09-01", dateLabel: "Tue, 1 Sep 2026" });
  assertPayloadParses("eod", job.payload);
  assert.ok(job.label.length > 0);
  assert.ok(job.label.length <= PRINT_JOB_LABEL_MAX_CHARS);
  assert.ok(job.label.includes("Tue, 1 Sep 2026"), "the label must carry the dateLabel verbatim");
});

test("eodPrintJob: payload.kind is \"eod\", carries dateKey/dateLabel verbatim, and NO snapshot member — the live-aggregate kind (§B1)", () => {
  const job = eodPrintJob({ dateKey: "2026-09-01", dateLabel: "Tue, 1 Sep 2026" });
  assertKind(job.payload, "eod");
  assert.equal(job.payload.dateKey, "2026-09-01");
  assert.equal(job.payload.dateLabel, "Tue, 1 Sep 2026");
  assert.ok(!("snapshot" in job.payload), "an eod payload must carry no order snapshot");
});

test("eodPrintJob: a very long dateLabel is TRUNCATED to PRINT_JOB_LABEL_MAX_CHARS rather than overshooting the bound", () => {
  const job = eodPrintJob({ dateKey: "2026-09-01", dateLabel: "x".repeat(500) });
  assert.ok(
    job.label.length <= PRINT_JOB_LABEL_MAX_CHARS,
    `label.length (${job.label.length}) must be <= PRINT_JOB_LABEL_MAX_CHARS`,
  );
  assertPayloadParses("eod", job.payload);
});

test("eodPrintJob + printJobKeyOf/printJobOrderIdOf: keys to undefined (never repeat-poisoned) and has NO orderId (no order to point at)", () => {
  const job = eodPrintJob({ dateKey: "2026-09-01", dateLabel: "Tue, 1 Sep 2026" });
  assert.equal(printJobKeyOf(job.payload), undefined);
  assert.equal(printJobOrderIdOf(job.payload), undefined);
});

// ── D-10 — the reprint flag at OrderDetailSheet's bill call site ───────────

test("PIN (D-10): OrderDetailSheet's printBill calls billPrintJob(order, { reprint: true }) — with false the job reuses the resolved original's dedupe key, the enqueue answers already-resolved, and the slip prints NOWHERE", () => {
  const src = readSrc(ORDER_DETAIL_SHEET);
  assert.match(
    src,
    /routePrint\(\(\) => billPrintJob\(order, \{ reprint: true \}\), localPrintOf\(order, print\)\);/,
    "printBill's routed call must build billPrintJob with the literal { reprint: true }, guarded through localPrintOf",
  );
  // Mutation this catches directly: reprint:false (or the option dropped) at
  // this one call site — everything else in the file can stay green.
  assert.ok(
    !/billPrintJob\(order, \{ reprint: false \}\)/.test(src),
    "OrderDetailSheet must never call billPrintJob with reprint:false — every tap of its Print button is a staff-requested duplicate",
  );
});

// ── D-11 — the enqueue outcome is read in ONE place only ───────────────────

test("PIN (D-11): printJobEnqueueAllowsLocalPrint( appears ONLY in hooks/use-host-routing.ts (>=2 there, since CB-1d.3b) — use-print-routing.ts itself must carry ZERO occurrences, and none of the three PH-6 components may hand-read the enqueue outcome, nor reference the literal \"no-host\"", () => {
  const hostSrc = readSrc(USE_HOST_ROUTING);
  const hostCalls = countOccurrences(hostSrc, "printJobEnqueueAllowsLocalPrint(");
  assert.ok(hostCalls >= 2, `expected printJobEnqueueAllowsLocalPrint( at least twice in use-host-routing.ts, found ${hostCalls}`);

  // Strictly stronger than the pre-split pin: use-print-routing.ts kept only
  // the LOCAL-queue wrappers and the re-export seam — the enqueue-outcome
  // read must have moved out with the routing primitives entirely.
  assert.equal(
    countOccurrences(readSrc(USE_PRINT_ROUTING), "printJobEnqueueAllowsLocalPrint("),
    0,
    "use-print-routing.ts must carry ZERO occurrences of printJobEnqueueAllowsLocalPrint( — that read belongs to hooks/use-host-routing.ts alone since CB-1d.3b",
  );

  for (const file of [MOVE_TABLE_DIALOG, ORDER_DETAIL_SHEET, END_OF_DAY_BUTTON]) {
    const src = readSrc(file);
    // positive landmark first: each file must still call useHostRouting(),
    // proving this is a real, non-empty read of the actual PH-6 source.
    assert.match(src, /useHostRouting\(/, `${file} must call useHostRouting( — positive landmark before the negative checks below`);
    assert.equal(
      countOccurrences(src, "printJobEnqueueAllowsLocalPrint("),
      0,
      `${file} must never hand-read the enqueue outcome via printJobEnqueueAllowsLocalPrint( — that belongs to hooks/use-print-routing.ts alone (D-11)`,
    );
    assert.ok(
      !src.includes('"no-host"'),
      `${file} must never contain the literal "no-host" (D-11), not even in a comment`,
    );
  }
});

// ── never both lanes — MoveTableDialog ─────────────────────────────────────

test("PIN: MoveTableDialog never fires BOTH lanes — printSlip(); (the actual call, semicolon-terminated so the comments mentioning \"printSlip()\" without one don't inflate the count) appears exactly twice, and the routed occurrence is gated by identity against shownSlipRef, not a bare `if (!routed)`", () => {
  const src = readSrc(MOVE_TABLE_DIALOG);
  // positive landmark: the synchronous no-host fast path is still there.
  assert.match(src, /if \(!shouldRoute\) \{\s*printSlip\(\);\s*\}/, "positive landmark: the synchronous no-host fast path must still call printSlip() directly");
  const calls = countOccurrences(src, "printSlip();");
  assert.equal(calls, 2, `expected printSlip(); exactly twice (the no-host fast path + the routed identity-gated fallback), found ${calls}`);
  // positive landmark: the routed .then must still short-circuit when the
  // host already owns the slip.
  assert.match(src, /if \(routed\) return;/, "the routed .then must still return immediately when the host owns the slip");
  // the routed fallback must be gated on shownSlipRef identity, not a bare
  // `if (!routed)` — a second move inside the enqueue round trip replaces
  // `slip`, and the FIRST move's fallback must not print the SECOND move's
  // paper.
  assert.match(
    src,
    /if \(shownSlipRef\.current === slip\) \{\s*printSlip\(\);\s*return;\s*\}/,
    "the routed lane's local fallback must be gated by `if (shownSlipRef.current === slip)` — the bare `if (!routed)` this replaces would print whatever slip is CURRENTLY on screen, not the one this effect closed over",
  );
  // negative: the bare, pre-fix gate this replaces must never come back.
  assert.ok(
    !src.includes("if (!routed) printSlip();"),
    "the bare `if (!routed) printSlip();` gate must never come back — it let a second move's slip print twice while the first move's printed nothing",
  );
});

test("PIN: MoveTableDialog's shownSlipRef mirrors `slip` via a LAYOUT effect on [slip] (not a passive one — the enqueue's promise continuation can run between the commit that swapped the print DOM and a passive flush), and the routed fallback's guard compares by OBJECT IDENTITY (===), never by a derived _id/from/at field a coincidental second move could share", () => {
  const src = readSrc(MOVE_TABLE_DIALOG);
  // positive landmark: the message this guard falls back to exists, non-empty,
  // at module scope.
  assert.match(
    src,
    /const PRINT_MOVE_SUPERSEDED_MESSAGE =\s*\n\s*"[^"]+";/,
    "PRINT_MOVE_SUPERSEDED_MESSAGE must be declared as a non-empty string at module scope",
  );
  // the ref itself, seeded from the current `slip` state so it is never stale
  // on first render.
  assert.match(
    src,
    /const shownSlipRef = useRef<PendingSlip \| null>\(slip\);/,
    "shownSlipRef must be seeded from the current `slip` state",
  );
  // the keep-current effect must be a LAYOUT effect — a passive one can run
  // AFTER a deferred fallback has already read a stale ref (the same
  // reasoning RequestAlertBar.tsx / pos-layout-paths.test.ts pins).
  assert.match(
    src,
    /useLayoutEffect\(\(\) => \{\s*shownSlipRef\.current = slip;\s*\}, \[slip\]\);/,
    "an effect keyed on [slip] must be useLayoutEffect (not useEffect) to keep shownSlipRef.current in sync BEFORE a deferred fallback can read it",
  );
  // the comparison itself must be plain object identity — swapping it for a
  // derived key (order._id, from, at) would let an UNRELATED move that landed
  // on the same table, or within the same instant, satisfy the guard.
  assert.match(
    src,
    /if \(shownSlipRef\.current === slip\) \{/,
    "the guard must compare shownSlipRef.current to `slip` by identity (===), not by a derived field",
  );
  assert.ok(
    !/shownSlipRef\.current\?\.(order\._id|from|at)/.test(src),
    "the guard must never compare shownSlipRef.current's order._id/from/at fields instead of the object itself — a coincidental match there is not the SAME move",
  );
});

// ── never both lanes — OrderDetailSheet's two buttons ──────────────────────

test("PIN: OrderDetailSheet's printBill never calls print() bare — the `if (!order)` branch now toasts (that window is reachable for ~300ms while the sheet animates out with `order` already null, and OrderReceipt renders its ref'd wrapper UNCONDITIONALLY, so the old bare call emitted a genuine BLANK page), and routePrint still receives the GUARDED localPrintOf(order, print), never the bare `print` reference", () => {
  const src = readSrc(ORDER_DETAIL_SHEET);
  const bareCalls = countOccurrences(src, "print();");
  assert.equal(bareCalls, 0, `expected NO bare print(); call anywhere in this file, found ${bareCalls}`);
  // positive landmark: the !order branch must toast instead of printing.
  assert.match(
    src,
    /if \(!order\) \{\s*toast\.error\(PRINT_ORDER_CHANGED_MESSAGE\);\s*return;\s*\}\s*routePrint\(\(\) => billPrintJob\(order, \{ reprint: true \}\), localPrintOf\(order, print\)\);/,
    "printBill's `if (!order)` branch must toast PRINT_ORDER_CHANGED_MESSAGE and return, and its routed call must still hand routePrint the GUARDED localPrintOf(order, print)",
  );
  // negative: the bare-reference shape this replaces (the confirmed defect)
  // must never come back.
  assert.ok(
    !src.includes("routePrint(() => billPrintJob(order, { reprint: true }), print);"),
    "the bare `print` reference must never be handed to routePrint again as runLocal — a deferred bare trigger can print a BLANK or WRONG-order slip once the sheet has moved on",
  );
  // negative: the old !order branch (a bare local print, once believed
  // harmless) must never come back either.
  assert.ok(
    !src.includes("if (!order) {\n      print();\n      return;\n    }"),
    "the `if (!order)` branch must never go back to printing bare — OrderReceipt's ref'd wrapper renders unconditionally, so that branch emits a real blank page, not a no-op",
  );
});

test("PIN: OrderDetailSheet's printKitchenSlip never calls printKot() bare — the `if (!order)` branch now toasts (KOTReceipt gates the same way as OrderReceipt, so the old bare call emitted a genuine BLANK page in that ~300ms window), and routePrint still receives the GUARDED localPrintOf(order, printKot), never the bare `printKot` reference", () => {
  const src = readSrc(ORDER_DETAIL_SHEET);
  const bareCalls = countOccurrences(src, "printKot();");
  assert.equal(bareCalls, 0, `expected NO bare printKot(); call anywhere in this file, found ${bareCalls}`);
  // positive landmark: the !order branch must toast instead of printing.
  assert.match(
    src,
    /if \(!order\) \{\s*toast\.error\(PRINT_ORDER_CHANGED_MESSAGE\);\s*return;\s*\}\s*routePrint\(\s*\(\) =>\s*isCancelled\s*\?\s*cancelNoticePrintJob\(order, order\.cancelReason \?\? ""\)\s*:\s*kotPrintJob\(order, null\),\s*localPrintOf\(order, printKot\),\s*\);/,
    "printKitchenSlip's `if (!order)` branch must toast PRINT_ORDER_CHANGED_MESSAGE and return, and its routed call must still hand routePrint the GUARDED localPrintOf(order, printKot)",
  );
  // negative: the bare-reference shape this replaces (the confirmed defect)
  // must never come back — a trailing bare `printKot,` immediately before the
  // closing `);` is exactly that shape.
  assert.ok(
    !src.includes("\n      printKot,\n    );"),
    "the bare `printKot` reference must never be handed to routePrint again as runLocal",
  );
  // negative: the old !order branch (a bare local print, once believed
  // harmless) must never come back either.
  assert.ok(
    !src.includes("if (!order) {\n      printKot();\n      return;\n    }"),
    "the `if (!order)` branch must never go back to printing bare — KOTReceipt's ref'd wrapper renders unconditionally, so that branch emits a real blank page, not a no-op",
  );
});

// ── never both lanes — EndOfDayButton ──────────────────────────────────────

test("PIN: EndOfDayButton's print(); call is GUARDED inside localPrint's day-check, exactly once, and routePrint receives the GUARDED `localPrint` function — never the bare `print` reference, which react-to-print would resolve AFTER the enqueue await, once a different day's figures may be on screen", () => {
  const src = readSrc(END_OF_DAY_BUTTON);
  const bareCalls = countOccurrences(src, "print();");
  assert.equal(bareCalls, 1, `expected print(); exactly once (inside localPrint's day-guard), found ${bareCalls}`);
  assert.match(
    src,
    /if \(shown\.dateKey === effectiveDate && shown\.ready\) \{\s*print\(\);\s*return;\s*\}/,
    "print(); must be reachable only through the `if (shown.dateKey === effectiveDate && shown.ready) { print(); return; }` guard inside localPrint",
  );
  // positive landmark first: the corrected, GUARDED call must be present.
  assert.match(
    src,
    /routePrint\(\(\) => eodPrintJob\(\{ dateKey: effectiveDate, dateLabel \}\), localPrint\);/,
    "routePrint must receive the GUARDED `localPrint` function, not the bare `print` reference, as runLocal",
  );
  // negative: the bare-reference shape this replaces (the confirmed defect)
  // must never come back.
  assert.ok(
    !src.includes("routePrint(() => eodPrintJob({ dateKey: effectiveDate, dateLabel }), print);"),
    "the bare `print` reference must never be handed to routePrint again as runLocal — the off-screen summary can show a DIFFERENT day's figures under the tapped day's title by the time a deferred fallback fires",
  );
});

// ── the guard itself: refs must track the CURRENT value, not a stale one ───
// A guard comparing against a ref frozen at mount time would pass trivially
// forever and protect nothing — each ref's own keep-current effect is as much
// the pin as the comparison it feeds.

test("PIN: OrderDetailSheet tracks the CURRENTLY SHOWN order in shownOrderRef (kept current by its own LAYOUT effect, never a passive useEffect, on [order]), and localPrintOf's guard compares the tap-time target's _id against it before firing — a guard reading a stale closure would pass trivially and protect nothing", () => {
  const src = readSrc(ORDER_DETAIL_SHEET);
  // positive landmark: the toast message this guard falls back to exists,
  // non-empty, at module scope.
  assert.match(
    src,
    /const PRINT_ORDER_CHANGED_MESSAGE =\s*\n\s*"[^"]+";/,
    "PRINT_ORDER_CHANGED_MESSAGE must be declared as a non-empty string at module scope",
  );
  // the ref itself, seeded from the current `order` prop so it is never stale
  // on first render.
  assert.match(
    src,
    /const shownOrderRef = useRef<Order \| null>\(order\);/,
    "shownOrderRef must be seeded from the current `order` prop",
  );
  // the keep-current effect — WITHOUT this the ref freezes at mount time and
  // the guard below would compare every later tap against the FIRST order
  // this sheet ever showed, passing trivially forever.
  assert.match(
    src,
    /useLayoutEffect\(\(\) => \{\s*shownOrderRef\.current = order;\s*\}, \[order\]\);/,
    "an effect keyed on [order] must be useLayoutEffect, not useEffect — a passive flush is a scheduler task, so the enqueue's promise continuation can run between the commit that swapped the print DOM and a passive mirror catching up (same precedent as RequestAlertBar.tsx / lib/pos-layout-paths.test.ts)",
  );
  // negative: a downgrade to the passive hook must never come back — this
  // is the silent regression a fresh-eyes review caught.
  assert.ok(
    !src.includes("useEffect(() => {\n    shownOrderRef.current = order;"),
    "shownOrderRef's keep-current effect must never downgrade to a passive useEffect",
  );
  // the guard: fires the trigger ONLY while the target order is still the one
  // on screen; otherwise toasts instead of printing blind.
  assert.match(
    src,
    /const localPrintOf = \(target: Order, trigger: \(\) => void\) => \(\) => \{\s*if \(shownOrderRef\.current\?\._id === target\._id\) \{\s*trigger\(\);\s*return;\s*\}\s*toast\.error\(PRINT_ORDER_CHANGED_MESSAGE\);\s*\};/,
    "localPrintOf must compare shownOrderRef.current's _id against the tap-time target._id, calling trigger() only on a match and toasting PRINT_ORDER_CHANGED_MESSAGE otherwise",
  );
});

test("PIN: EndOfDayButton tracks the CURRENTLY SHOWN day+readiness in shownDayRef (kept current by its own LAYOUT effect, never a passive useEffect, on [effectiveDate, ready]), and localPrint's guard requires BOTH the dateKey match AND ready before firing — a guard reading a stale closure would pass trivially and protect nothing", () => {
  const src = readSrc(END_OF_DAY_BUTTON);
  // positive landmark: the toast message this guard falls back to exists,
  // non-empty, at module scope.
  assert.match(
    src,
    /const PRINT_DAY_CHANGED_MESSAGE =\s*\n\s*"[^"]+";/,
    "PRINT_DAY_CHANGED_MESSAGE must be declared as a non-empty string at module scope",
  );
  // the ref itself, seeded from the CURRENT date+readiness so it is never
  // stale on first render.
  assert.match(
    src,
    /const shownDayRef = useRef\(\{ dateKey: effectiveDate, ready \}\);/,
    "shownDayRef must be seeded from the current effectiveDate and ready",
  );
  // the keep-current effect — WITHOUT this the ref freezes at mount time and
  // a later date pick or data-readiness change would never update what the
  // guard compares against.
  assert.match(
    src,
    /useLayoutEffect\(\(\) => \{\s*shownDayRef\.current = \{ dateKey: effectiveDate, ready \};\s*\}, \[effectiveDate, ready\]\);/,
    "an effect keyed on [effectiveDate, ready] must be useLayoutEffect, not useEffect — a passive flush is a scheduler task, so the enqueue's promise continuation can slip between the commit that put another day's figures in the print DOM and a passive mirror catching up (same precedent as RequestAlertBar.tsx / lib/pos-layout-paths.test.ts)",
  );
  // negative: a downgrade to the passive hook must never come back — this
  // is the silent regression a fresh-eyes review caught.
  assert.ok(
    !src.includes("useEffect(() => {\n    shownDayRef.current = { dateKey: effectiveDate, ready };"),
    "shownDayRef's keep-current effect must never downgrade to a passive useEffect",
  );
  // the guard itself: BOTH members must hold, not just the date — a same-day
  // refetch that flips ready back to false must not let a deferred print
  // through either.
  assert.match(
    src,
    /if \(shown\.dateKey === effectiveDate && shown\.ready\) \{/,
    "localPrint's guard must require BOTH shown.dateKey === effectiveDate AND shown.ready — checking the date alone would let a still-loading day print",
  );
});

// ── the ungated triggers are GONE (vision-guarded negative pins) ───────────

test("PIN: OrderDetailSheet's footer buttons no longer fire the ungated onClick={() => print()} / onClick={() => printKot()} triggers — both now go through the routed handlers", () => {
  const src = readSrc(ORDER_DETAIL_SHEET);
  // positive landmarks FIRST so the negative checks below can't pass vacuously
  // against a blinded or empty read.
  assert.ok(src.includes("onClick={printBill}"), "positive landmark: the Print button must use onClick={printBill}");
  assert.ok(src.includes("onClick={printKitchenSlip}"), "positive landmark: the KOT/Notify button must use onClick={printKitchenSlip}");
  assert.ok(!src.includes("onClick={() => print()}"), "the ungated onClick={() => print()} must be gone, not even as a comment");
  assert.ok(!src.includes("onClick={() => printKot()}"), "the ungated onClick={() => printKot()} must be gone, not even as a comment");
});

test("PIN: EndOfDayButton's End of day button no longer fires the ungated onClick={() => print()} trigger — it now goes through printEod", () => {
  const src = readSrc(END_OF_DAY_BUTTON);
  // positive landmark first.
  assert.ok(src.includes("onClick={printEod}"), "positive landmark: the End of day button must use onClick={printEod}");
  assert.ok(!src.includes("onClick={() => print()}"), "the ungated onClick={() => print()} must be gone, not even as a comment");
});

// ── cancel-notice reachability (PH-4 shipped it with ZERO call sites) ──────

test('REACHABILITY: cancelNoticePrintJob( has EXACTLY ONE call site repo-wide (outside its own lib/print-routing.ts definition and this test file), in OrderDetailSheet.tsx on the cancelled branch — memory "slice-specs-satisfied-feature-still-dead": grep call sites, do not trust compilation', () => {
  const orderDetailSrc = readSrc(ORDER_DETAIL_SHEET);
  // positive landmark: it is imported AND called on the cancelled branch.
  assert.match(orderDetailSrc, /import \{[^}]*cancelNoticePrintJob[^}]*\} from "@\/lib\/print-routing";/, "OrderDetailSheet must import cancelNoticePrintJob from @/lib/print-routing");
  assert.match(
    orderDetailSrc,
    /isCancelled\s*\?\s*cancelNoticePrintJob\(order, order\.cancelReason \?\? ""\)\s*:\s*kotPrintJob\(order, null\)/,
    "cancelNoticePrintJob must be called on the isCancelled branch, alongside kotPrintJob on the other",
  );

  // negative half: no OTHER app/component/hook file calls it. Walk the whole
  // apps/cafe tree's app/hooks/components/lib directories (excluding this
  // test file and the definition site) and assert none of them contain a
  // cancelNoticePrintJob( call.
  const CALL_NEEDLE = "cancelNoticePrintJob" + "(";
  const roots = ["app", "components", "hooks", "lib"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const otherCallSites: string[] = [];
  const DEFINITION_FILE = path.join(REPO_ROOT, "apps/cafe/lib/print-routing.ts");
  const ORDER_DETAIL_FILE = path.join(REPO_ROOT, "apps/cafe/components/orders/OrderDetailSheet.tsx");
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      if (full === DEFINITION_FILE || full === ORDER_DETAIL_FILE) continue;
      const text = readFileSync(full, "utf8");
      if (text.includes(CALL_NEEDLE)) otherCallSites.push(full);
    }
  }
  for (const root of roots) walk(root);
  assert.deepEqual(otherCallSites, [], `cancelNoticePrintJob( must have no OTHER call sites; found: ${otherCallSites.join(", ")}`);
});

// ── provider ancestry / crash fence ─────────────────────────────────────────
// useHostRouting() -> usePrintHostRouting() THROWS with no <PosPulseProvider>
// above it (CB-1d.3b: the routing hook now reads the narrower print-lane
// context, not usePosPulseContext() — see PosPulseProvider.tsx's own crash
// fence). Both halves must hold: the layout still provides it, and the
// three PH-6 components are reachable only from underneath that layout.

test("PIN: app/(dashboard)/layout.tsx still wraps {children} in <PosPulseProvider> — every PH-6 component's useHostRouting()->usePrintHostRouting() would throw otherwise", () => {
  const src = readSrc(DASHBOARD_LAYOUT);
  // positive landmark: the import is still there before checking the JSX shape.
  assert.match(src, /import \{ PosPulseProvider \} from "@\/components\/layout\/PosPulseProvider";/, "positive landmark: PosPulseProvider must still be imported");
  const providerStart = src.indexOf("<PosPulseProvider>");
  assert.ok(providerStart >= 0, "<PosPulseProvider> must open somewhere in the layout");
  const providerEnd = src.indexOf("</PosPulseProvider>", providerStart);
  assert.ok(providerEnd >= 0, "<PosPulseProvider> must close somewhere after it opens");
  const body = src.slice(providerStart, providerEnd);
  assert.match(body, /\{children\}/, "{children} must render BETWEEN <PosPulseProvider> and its closing tag");

  // Both ends of the crash fence, since the split: the hook side reads the
  // lane through usePrintHostRouting(), and the provider side is the ONLY
  // thing that can make that call not throw.
  const hostSrc = readSrc(USE_HOST_ROUTING);
  assert.match(hostSrc, /const routing = usePrintHostRouting\(\);/, "use-host-routing.ts must read the lane via const routing = usePrintHostRouting();");
  const providerSrc = readSrc(POS_PULSE_PROVIDER);
  assert.match(
    providerSrc,
    /throw new Error\("usePrintHostRouting must be used inside <PosPulseProvider>"\);/,
    'PosPulseProvider.tsx must keep the crash fence: throw new Error("usePrintHostRouting must be used inside <PosPulseProvider>"); — the same guarantee this ancestry pin exists to protect',
  );
});

test("REACHABILITY: OrderDetailSheet/MoveTableDialog/EndOfDayButton are imported only from files under app/(dashboard)/ (or from each other) — never from app/m/ or any other route group that renders outside the dashboard layout's <PosPulseProvider>", () => {
  const roots = ["app", "components", "hooks"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const TARGET_MODULES = [
    '"@/components/orders/OrderDetailSheet"',
    '"@/components/orders/MoveTableDialog"',
    '"@/components/reports/EndOfDayButton"',
  ];
  // A file is an ALLOWED importer if it lives under app/(dashboard)/ (any
  // depth), or is one of the three PH-6 components themselves (OrderDetailSheet
  // imports MoveTableDialog).
  const SELF_IMPORTERS = [
    path.join(REPO_ROOT, "apps/cafe/components/orders/OrderDetailSheet.tsx"),
  ];
  const violations: string[] = [];
  function isAllowedImporter(full: string): boolean {
    const normalized = full.split(path.sep).join("/");
    if (normalized.includes("/app/(dashboard)/")) return true;
    return SELF_IMPORTERS.some((allowed) => allowed.split(path.sep).join("/") === normalized);
  }
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      const text = readFileSync(full, "utf8");
      for (const mod of TARGET_MODULES) {
        if (text.includes(`from ${mod}`) && !isAllowedImporter(full)) {
          violations.push(`${full} imports ${mod}`);
        }
      }
    }
  }
  for (const root of roots) walk(root);
  // positive landmark: at least the known-good dashboard call sites must
  // actually be found as allowed importers, so a blinded/empty walk can't
  // pass this test vacuously.
  const dashboardPageSrc = readSrc("apps/cafe/app/(dashboard)/page.tsx");
  assert.match(dashboardPageSrc, /from "@\/components\/reports\/EndOfDayButton";/, "positive landmark: app/(dashboard)/page.tsx must still import EndOfDayButton");
  assert.match(dashboardPageSrc, /from "@\/components\/orders\/OrderDetailSheet";/, "positive landmark: app/(dashboard)/page.tsx must still import OrderDetailSheet");
  assert.deepEqual(violations, [], `these importers render the PH-6 components OUTSIDE app/(dashboard)/'s <PosPulseProvider>: ${violations.join(", ")}`);
});
