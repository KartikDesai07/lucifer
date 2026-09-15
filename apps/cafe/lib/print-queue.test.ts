import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

import {
  printJobOrderIdOf,
  printJobKeyOf,
  queuedPruneCutoff,
  resolvedPruneCutoff,
  drainAgeCutoff,
} from "./print-queue";
import { printJobFeedRowOf, printJobResolvedRowOf, printJobDrainFilter } from "./print-queue-feeds";
import { PRINT_HOST_TAB_ID_MAX_CHARS, claimedByOf, printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";
import { printHostStateOf } from "./print-host";
import {
  PRINT_JOB_KINDS,
  PRINT_JOB_QUEUED_RETENTION_MS,
  PRINT_JOB_RESOLVED_RETENTION_MS,
  PRINT_HOST_MAX_AGE_MS,
  PRINT_HOST_OFFLINE_MS,
  printJobDrainCandidate,
  type PrintJobFeedRow,
} from "@pos/shared/print-job";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";

// Print-host plan (.claude/plan/v2/print-host-plan.md §C PH-3) — DB-free unit
// tests for the pure print-queue.ts / print-queue-claim.ts / print-host.ts
// helpers, plus SOURCE-TEXT PINS (readFileSync + stripComments, mirroring
// lib/self-order-alert-review-pins.test.ts and lib/self-order-alert-paths.test.ts)
// over the DB-touching functions and the five print-jobs/print-host routes.
// Every test's own name/assert-message states the MUTATION it catches. No
// mongod, no connectDB, no mongoose connection anywhere in this file.

// ── payload() factory — a minimal valid printOrderSnapshot-shaped payload per
// kind, verified to PARSE against the real printJobPayloadSchema so a factory
// that drifts from the contract fails loudly instead of testing a fiction ──

const BASE_ITEM = {
  productId: "p1",
  name: "Filter Coffee",
  price: 4000,
  qty: 2,
  modifiers: [],
  instructions: "",
  kotRound: 1,
};

const BASE_SNAPSHOT = {
  _id: "665f0a0000000000000000a1",
  orderId: "ORD-0001",
  customerName: "Walk-in",
  items: [BASE_ITEM],
  subtotal: 8000,
  discount: 0,
  total: 8000,
  paidAmount: 8000,
  payment: "Cash",
  status: "Completed",
  receiver: "Staff",
  kotRounds: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
};

type PayloadOverrides = Record<string, unknown>;

function payload(kind: PrintJobPayload["kind"], overrides: PayloadOverrides = {}): PrintJobPayload {
  let draft: Record<string, unknown>;
  switch (kind) {
    case "kot":
      draft = { kind, snapshot: BASE_SNAPSHOT, round: 1, ...overrides };
      break;
    case "bill":
      draft = { kind, snapshot: BASE_SNAPSHOT, ...overrides };
      break;
    case "void":
      draft = {
        kind,
        snapshot: BASE_SNAPSHOT,
        line: { ...BASE_ITEM },
        reason: "Wrong order",
        voidedBy: "Staff",
        voidedAt: "2026-01-01T00:01:00.000Z",
        ...overrides,
      };
      break;
    case "moved":
      draft = {
        kind,
        snapshot: BASE_SNAPSHOT,
        from: "T-1",
        movedBy: "Staff",
        movedAt: "2026-01-01T00:02:00.000Z",
        ...overrides,
      };
      break;
    case "eod":
      // The ONE payload with no snapshot (§B1) — never inherit BASE_SNAPSHOT here.
      draft = { kind, dateKey: "2026-01-01", dateLabel: "1 Jan 2026", ...overrides };
      break;
    case "cancel-notice":
      draft = { kind, snapshot: BASE_SNAPSHOT, reason: "Customer left", ...overrides };
      break;
  }
  const result = printJobPayloadSchema.safeParse(draft);
  if (!result.success) {
    throw new Error(`payload(${kind}) factory drifted from printJobPayloadSchema: ${JSON.stringify(result.error.issues)}`);
  }
  return result.data;
}

test("payload() factory: a minimal payload for every PRINT_JOB_KINDS entry PARSES cleanly against printJobPayloadSchema — a factory that drifts from the real contract must fail here, loudly, before it can poison any test below", () => {
  for (const kind of PRINT_JOB_KINDS) {
    const built = payload(kind);
    const result = printJobPayloadSchema.safeParse(built);
    assert.equal(result.success, true, `payload(${kind}) must parse`);
    assert.equal(built.kind, kind);
  }
});

// ── 1. printJobKeyOf ─────────────────────────────────────────────────────────

test("printJobKeyOf: kot round 2 -> kot:<snapshot._id>:2", () => {
  const p = payload("kot", { round: 2 });
  assert.equal(printJobKeyOf(p), `kot:${BASE_SNAPSHOT._id}:2`);
});

test("printJobKeyOf: kot round:null -> undefined (a whole-tab REPRINT is a staff-requested duplicate, not a fresh kitchen instruction — deliberately repeatable, never deduped)", () => {
  const p = payload("kot", { round: null });
  assert.equal(printJobKeyOf(p), undefined);
});

test("printJobKeyOf: bill -> bill:<snapshot._id>", () => {
  const p = payload("bill");
  assert.equal(printJobKeyOf(p), `bill:${BASE_SNAPSHOT._id}`);
});

test("printJobKeyOf: void -> void:<_id>:<voidedAt>:<line.productId>, and the key CHANGES when line.productId changes while voidedAt is held fixed (the dedupe-poisoning fence: two different lines voided in the same instant must never collapse to one print job)", () => {
  const voidedAt = "2026-01-01T00:01:00.000Z";
  const p1 = payload("void", { voidedAt, line: { ...BASE_ITEM, productId: "p1" } });
  const p2 = payload("void", { voidedAt, line: { ...BASE_ITEM, productId: "p2" } });
  assert.equal(printJobKeyOf(p1), `void:${BASE_SNAPSHOT._id}:${voidedAt}:p1`);
  assert.equal(printJobKeyOf(p2), `void:${BASE_SNAPSHOT._id}:${voidedAt}:p2`);
  assert.notEqual(printJobKeyOf(p1), printJobKeyOf(p2));
});

test("printJobKeyOf: void -> IDENTICAL key for a byte-identical retry (a retry of the SAME void must collapse into one job, not fan out into two slips)", () => {
  const voidedAt = "2026-01-01T00:01:00.000Z";
  const line = { ...BASE_ITEM, productId: "p7" };
  const p1 = payload("void", { voidedAt, line: { ...line } });
  const p2 = payload("void", { voidedAt, line: { ...line } });
  assert.equal(printJobKeyOf(p1), printJobKeyOf(p2));
});

test("printJobKeyOf: moved -> moved:<_id>:<movedAt>", () => {
  const p = payload("moved", { movedAt: "2026-01-01T00:02:00.000Z" });
  assert.equal(printJobKeyOf(p), `moved:${BASE_SNAPSHOT._id}:2026-01-01T00:02:00.000Z`);
});

test("printJobKeyOf: eod -> undefined (a live aggregate, never a repeat-poisoned event)", () => {
  assert.equal(printJobKeyOf(payload("eod")), undefined);
});

test("printJobKeyOf: cancel-notice -> undefined (the stop-instruction itself — a re-notify is deliberately repeatable)", () => {
  assert.equal(printJobKeyOf(payload("cancel-notice")), undefined);
});

// ── 2. printJobOrderIdOf ─────────────────────────────────────────────────────

test("printJobOrderIdOf: eod -> undefined (no order to point at)", () => {
  assert.equal(printJobOrderIdOf(payload("eod")), undefined);
});

test("printJobOrderIdOf: every non-eod kind returns snapshot._id EXACTLY — never snapshot.orderId (the claim looks the live Order up by _id; returning the human order number would break every eligibility read)", () => {
  for (const kind of ["kot", "bill", "void", "moved", "cancel-notice"] as const) {
    const p = payload(kind);
    assert.equal(printJobOrderIdOf(p), BASE_SNAPSHOT._id);
    assert.notEqual(printJobOrderIdOf(p), BASE_SNAPSHOT.orderId);
  }
});

// ── 3. Cutoffs ───────────────────────────────────────────────────────────────

test("queuedPruneCutoff / resolvedPruneCutoff / drainAgeCutoff: each is nowMs minus the IMPORTED shared constant — never a re-typed number", () => {
  const now = 1_700_000_000_000;
  assert.equal(queuedPruneCutoff(now).getTime(), now - PRINT_JOB_QUEUED_RETENTION_MS);
  assert.equal(resolvedPruneCutoff(now).getTime(), now - PRINT_JOB_RESOLVED_RETENTION_MS);
  assert.equal(drainAgeCutoff(now).getTime(), now - PRINT_HOST_MAX_AGE_MS);
});

test("drainAgeCutoff / printJobDrainCandidate boundary agreement (D1/D2 split): a row created EXACTLY PRINT_HOST_MAX_AGE_MS ago is >= drainAgeCutoff (still D1, not stale), matching printJobDrainCandidate's own age===maxAgeMs-is-still-eligible boundary — a disagreement here would strand a job in neither band", () => {
  const now = 1_700_000_000_000;
  const cutoff = drainAgeCutoff(now);
  const rowCreatedMs = now - PRINT_HOST_MAX_AGE_MS;
  assert.ok(rowCreatedMs >= cutoff.getTime(), "a row exactly PRINT_HOST_MAX_AGE_MS old must satisfy the D1 query's $gte cutoff");

  const row: PrintJobFeedRow = { id: "j1", kind: "kot", label: "KOT round 1 · T-4", createdAt: new Date(rowCreatedMs).toISOString() };
  const candidate = printJobDrainCandidate([row], now, PRINT_HOST_MAX_AGE_MS);
  assert.equal(candidate, row, "printJobDrainCandidate must still consider a row exactly maxAgeMs old eligible to drain");
});

// ── 4. printJobFeedRowOf / printJobResolvedRowOf ────────────────────────────

test("printJobFeedRowOf: id is the stringified _id, createdAt is an ISO string, and orderId is OMITTED (never present-and-undefined) when the doc carries none", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const row = printJobFeedRowOf({ _id: "abc123", kind: "eod", label: "EOD summary", createdAt });
  assert.equal(row.id, "abc123");
  assert.equal(row.createdAt, "2026-01-01T00:00:00.000Z");
  // positive landmark first — the row really was built with real fields, so
  // the negative check below isn't vacuously true over an empty/blinded object
  assert.equal(row.kind, "eod");
  assert.equal(row.label, "EOD summary");
  assert.ok(!("orderId" in row), "orderId must be OMITTED from the object, not present as undefined");
});

test("printJobFeedRowOf: orderId IS included, verbatim, when the doc carries one", () => {
  const row = printJobFeedRowOf({ _id: "abc123", kind: "kot", label: "KOT round 1 · T-4", orderId: "order-1", createdAt: new Date() });
  assert.equal(row.orderId, "order-1");
});

test("printJobResolvedRowOf: id is the stringified _id, and dismissReason is OMITTED (never present-and-undefined) for a resolved-by-print row", () => {
  const row = printJobResolvedRowOf({ _id: "xyz789", status: "printed" });
  assert.ok(row !== null, "positive landmark: a recognised status is never omitted");
  // positive landmark before the negative check
  assert.equal(row.id, "xyz789");
  assert.equal(row.status, "printed");
  assert.ok(!("dismissReason" in row), "dismissReason must be OMITTED, not present as undefined");
});

test("printJobResolvedRowOf: dismissReason IS included when present, and the function returns null (never throws) on a status outside {printed,dismissed} — F-5 policy: this row feeds pos-pulse.ts's 20s Promise.all readback, so a THROW there took the whole feed down for the row's 2h retention window; omitting the one row degrades one row instead (DELIBERATE POLICY CHANGE from an earlier fix round, not a weakened assertion — companion pin to the one in print-queue-fixes.test.ts)", () => {
  const row = printJobResolvedRowOf({ _id: "xyz789", status: "dismissed", dismissReason: "staff" });
  assert.ok(row !== null, "positive landmark: a recognised status is never omitted");
  assert.equal(row.dismissReason, "staff");
  assert.equal(printJobResolvedRowOf({ _id: "xyz789", status: "queued" }), null, "an out-of-range status must be OMITTED (null), never thrown");
});

// ── 5. printJobEligibility ───────────────────────────────────────────────────

test("printJobEligibility: kot round:null -> eligible regardless of order (a reprint is a staff-requested duplicate)", () => {
  assert.deepEqual(printJobEligibility(payload("kot", { round: null }), null), { eligible: true });
});

test("printJobEligibility: kot round N, order null -> order-cancelled", () => {
  assert.deepEqual(printJobEligibility(payload("kot", { round: 1 }), null), { eligible: false, reason: "order-cancelled" });
});

test('printJobEligibility: kot round N, order.status === "Cancelled" -> order-cancelled', () => {
  const order = { status: "Cancelled", items: [{ kotRound: 1 }] };
  assert.deepEqual(printJobEligibility(payload("kot", { round: 1 }), order), { eligible: false, reason: "order-cancelled" });
});

test("printJobEligibility: kot round N whose round has no surviving line (fully voided) -> round-voided", () => {
  const order = { status: "Pending", items: [{ kotRound: 1 }] }; // round 2 has no lines left
  assert.deepEqual(printJobEligibility(payload("kot", { round: 2 }), order), { eligible: false, reason: "round-voided" });
});

test("printJobEligibility: kot round N with a live line still in that round -> eligible", () => {
  const order = { status: "Pending", items: [{ kotRound: 1 }] };
  assert.deepEqual(printJobEligibility(payload("kot", { round: 1 }), order), { eligible: true });
});

test("printJobEligibility: bill, order null -> order-cancelled", () => {
  assert.deepEqual(printJobEligibility(payload("bill"), null), { eligible: false, reason: "order-cancelled" });
});

test('printJobEligibility: bill, order.status === "Cancelled" -> order-cancelled (unlike a void, a bill must NOT print regardless — the FROZEN snapshot still says "Completed", so the receipt\'s *** CANCELLED *** banner could never fire on the paper)', () => {
  const order = { status: "Cancelled", items: [] };
  assert.deepEqual(printJobEligibility(payload("bill"), order), { eligible: false, reason: "order-cancelled" });
});

test("printJobEligibility: bill, order live and not cancelled -> eligible", () => {
  const order = { status: "Completed", items: [] };
  assert.deepEqual(printJobEligibility(payload("bill"), order), { eligible: true });
});

test("printJobEligibility: void -> ALWAYS eligible, even on a Cancelled order (a void slip IS a stop-instruction, unlike a bill)", () => {
  assert.deepEqual(printJobEligibility(payload("void"), { status: "Cancelled", items: [] }), { eligible: true });
  assert.deepEqual(printJobEligibility(payload("void"), null), { eligible: true });
});

test("printJobEligibility: moved -> always eligible (an audit artifact)", () => {
  assert.deepEqual(printJobEligibility(payload("moved"), null), { eligible: true });
});

test("printJobEligibility: cancel-notice -> always eligible (it IS the stop-instruction; there is no round to be empty)", () => {
  assert.deepEqual(printJobEligibility(payload("cancel-notice"), null), { eligible: true });
});

test("printJobEligibility: eod -> always eligible (the CAS runs unconditionally here; the readiness skip-predicate is client-side TanStack state, not server eligibility)", () => {
  assert.deepEqual(printJobEligibility(payload("eod"), null), { eligible: true });
});

// ── 6. printJobNeedsOrderRead ────────────────────────────────────────────────

test("printJobNeedsOrderRead: true ONLY for bill and kot(round non-null); false for kot(round:null), void, moved, eod, cancel-notice", () => {
  assert.equal(printJobNeedsOrderRead(payload("bill")), true);
  assert.equal(printJobNeedsOrderRead(payload("kot", { round: 2 })), true);
  assert.equal(printJobNeedsOrderRead(payload("kot", { round: null })), false);
  assert.equal(printJobNeedsOrderRead(payload("void")), false);
  assert.equal(printJobNeedsOrderRead(payload("moved")), false);
  assert.equal(printJobNeedsOrderRead(payload("eod")), false);
  assert.equal(printJobNeedsOrderRead(payload("cancel-notice")), false);
});

// ── 7. claimedByOf ────────────────────────────────────────────────────────────

test("claimedByOf: the exact deviceId:tabId pair, and it DIFFERS for two tabIds on the SAME deviceId (two windows on one host PC must be distinguishable — MERGED-23)", () => {
  assert.equal(claimedByOf("dev-1", "tab-1"), "dev-1:tab-1");
  assert.notEqual(claimedByOf("dev-1", "tab-1"), claimedByOf("dev-1", "tab-2"));
});

test("PRINT_HOST_TAB_ID_MAX_CHARS is 64 (generously above a crypto.randomUUID's 36 chars)", () => {
  assert.equal(PRINT_HOST_TAB_ID_MAX_CHARS, 64);
});

// ── 8. printHostStateOf ───────────────────────────────────────────────────────

test("printHostStateOf(null, now) -> the fixed unconfigured shape (configured derives from document ABSENCE only)", () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(printHostStateOf(null, now), {
    configured: false,
    deviceId: null,
    label: null,
    lastSeenAt: null,
    offline: true,
    silentMode: false,
  });
});

test("printHostStateOf: a configured host maps to configured:true, an ISO lastSeenAt, and NEVER carries a silentProbeMs key (server-side only, §B4) — paired with the positive landmark that the state DOES carry silentMode", () => {
  const now = 1_700_000_000_000;
  const host = { deviceId: "dev-1", label: "Counter PC", lastSeenAt: new Date(now - 1000) };
  const state = printHostStateOf(host, now);
  assert.equal(state.configured, true);
  assert.equal(state.deviceId, "dev-1");
  assert.equal(state.label, "Counter PC");
  assert.equal(state.lastSeenAt, new Date(now - 1000).toISOString());
  assert.ok("silentMode" in state, "positive landmark: the state must carry silentMode");
  assert.ok(!("silentProbeMs" in state), "silentProbeMs must never ride the wire state — it is server-side only");
});

test("printHostStateOf: offline is true for a lastSeenAt older than PRINT_HOST_OFFLINE_MS and false for a fresh one — both measured against the IMPORTED constant", () => {
  const now = 1_700_000_000_000;
  const stale = printHostStateOf({ deviceId: "d", label: "L", lastSeenAt: new Date(now - PRINT_HOST_OFFLINE_MS - 1) }, now);
  assert.equal(stale.offline, true);
  const fresh = printHostStateOf({ deviceId: "d", label: "L", lastSeenAt: new Date(now - 1000) }, now);
  assert.equal(fresh.offline, false);
});

test("printHostStateOf: silentMode is false for undefined, false for a truthy-but-not-strictly-true value (=== true, not merely truthy — the object-literal-allow-list-prototype-key lesson), and true for a real true", () => {
  const now = 1_700_000_000_000;
  const undef = printHostStateOf({ deviceId: "d", label: "L", lastSeenAt: new Date(now) }, now);
  assert.equal(undef.silentMode, false);
  const truthyNotTrue = printHostStateOf(
    { deviceId: "d", label: "L", lastSeenAt: new Date(now), silentMode: 1 as unknown as boolean },
    now,
  );
  assert.equal(truthyNotTrue.silentMode, false);
  const real = printHostStateOf({ deviceId: "d", label: "L", lastSeenAt: new Date(now), silentMode: true }, now);
  assert.equal(real.silentMode, true);
});

// ── Source pins ──────────────────────────────────────────────────────────────

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `expected to find ${label} (searched for ${JSON.stringify(needle)})`);
  return idx;
}

const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) walk(abs, out);
    else if (CODE_FILE_PATTERN.test(entry)) out.push(abs);
  }
}

function relPath(fileAbs: string): string {
  return path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
}

const PRINT_QUEUE_LIB = "apps/cafe/lib/print-queue.ts";
const PRINT_QUEUE_FEEDS_LIB = "apps/cafe/lib/print-queue-feeds.ts";
const PRINT_QUEUE_CLAIM_LIB = "apps/cafe/lib/print-queue-claim.ts";
const PRINT_HOST_LIB = "apps/cafe/lib/print-host.ts";
const POS_PULSE_LIB = "apps/cafe/lib/pos-pulse.ts";
const PULSE_ROUTE = "apps/cafe/app/api/order-requests/pulse/route.ts";
const ENQUEUE_ROUTE = "apps/cafe/app/api/print-jobs/route.ts";
const CLAIM_ROUTE = "apps/cafe/app/api/print-jobs/[id]/claim/route.ts";
const DISMISS_ROUTE = "apps/cafe/app/api/print-jobs/[id]/dismiss/route.ts";
const PRINT_HOST_ROUTE = "apps/cafe/app/api/print-host/route.ts";
const BEAT_ROUTE = "apps/cafe/app/api/print-host/beat/route.ts";
const ROUTE_FILES = [ENQUEUE_ROUTE, CLAIM_ROUTE, DISMISS_ROUTE, PRINT_HOST_ROUTE, BEAT_ROUTE];

// ── 9. Oversize rejection — double fence ────────────────────────────────────

test("PIN: enqueuePrintJob's source checks printJobPayloadWithinCap and returns too-large BEFORE any PrintJob.create( (fence #1, the single write point)", () => {
  const src = stripComments(readSrc(PRINT_QUEUE_LIB));
  const fnStart = mustIndexOf(src, "export async function enqueuePrintJob", "enqueuePrintJob");
  const fnBody = src.slice(fnStart);
  const capIdx = mustIndexOf(fnBody, "printJobPayloadWithinCap(payloadJson)", "the cap check");
  const tooLargeIdx = mustIndexOf(fnBody, 'outcome: "too-large"', "the too-large return");
  const createIdx = mustIndexOf(fnBody, "PrintJob.create(", "the write point");
  assert.ok(capIdx < tooLargeIdx && tooLargeIdx < createIdx, "the cap check and its too-large return must both precede PrintJob.create(");
});

test("PIN: the enqueue ROUTE also checks printJobPayloadWithinCap( BEFORE calling enqueuePrintJob( (fence #2, independent of the lib's own fence)", () => {
  const src = stripComments(readSrc(ENQUEUE_ROUTE));
  const capIdx = mustIndexOf(src, "printJobPayloadWithinCap(", "the route's own cap check");
  const enqueueIdx = mustIndexOf(src, "enqueuePrintJob(", "the enqueuePrintJob call");
  assert.ok(capIdx < enqueueIdx, "the route's cap check must run before it calls enqueuePrintJob(");
});

// ── 10. The claim CAS ────────────────────────────────────────────────────────

test('PIN: claimPrintJob\'s CAS carries ALL THREE terms (_id, status:"queued", claimedAt:{$exists:false}) per-term, its result is CHECKED, and both the host-binding read and the eligibility gate run STRICTLY BEFORE the CAS — dropping any one term reopens the duplicate-print race', () => {
  const src = stripComments(readSrc(PRINT_QUEUE_CLAIM_LIB));
  const fnStart = mustIndexOf(src, "export async function claimPrintJob", "claimPrintJob");
  const fnBody = src.slice(fnStart);

  const hostReadIdx = mustIndexOf(fnBody, "await PrintHost.findOne(", "the host-binding read");
  const eligibilityIdx = mustIndexOf(fnBody, "printJobEligibility(parsedPayload, order)", "the eligibility gate");
  const casIdx = mustIndexOf(fnBody, "await PrintJob.findOneAndUpdate(", "the claim CAS");
  assert.ok(hostReadIdx < casIdx, "the host-binding read must run before the claim CAS");
  assert.ok(eligibilityIdx < casIdx, "the eligibility gate must run before the claim CAS");

  const casEnd = fnBody.indexOf(");", casIdx);
  const casBlock = fnBody.slice(casIdx, casEnd);
  assert.match(casBlock, /_id:\s*input\.id/, "the CAS must match on _id: input.id");
  assert.match(casBlock, /status:\s*"queued"/, 'the CAS must guard status: "queued"');
  assert.match(casBlock, /claimedAt:\s*\{\s*\$exists:\s*false\s*\}/, "the CAS must guard claimedAt: { $exists: false }");

  assert.match(fnBody, /if \(!claimed\) return \{ claimed: false, reason: "raced" \};/, "a lost CAS race must be CHECKED, never assumed to have succeeded");
});

// ── 11. No writer ever $unsets claimedAt ────────────────────────────────────

test("PIN: no file under apps/cafe's app/lib/hooks trees ever $unsets claimedAt (walked like self-order-alert-paths.test.ts's own $unset sweep; *.test.ts excluded), paired with the positive landmark that the claim CAS DOES $set it", () => {
  const dirs = ["apps/cafe/app", "apps/cafe/lib", "apps/cafe/hooks"];
  const files: string[] = [];
  for (const dir of dirs) walk(path.join(REPO_ROOT, dir), files);
  assert.ok(files.length > 0, "the app/lib/hooks trees must contain files to check");

  for (const fileAbs of files) {
    const rel = relPath(fileAbs);
    if (rel.endsWith(".test.ts")) continue;
    const src = stripComments(readFileSync(fileAbs, "utf8"));
    assert.ok(
      !/unset(?:\.claimedAt\b|\[["']claimedAt["']\])/.test(src),
      `${rel} must never assign unset.claimedAt (or unset["claimedAt"]) — that is how the claim would get reopened to a second racer`,
    );
    const unsetLiteralRe = /\$unset:\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = unsetLiteralRe.exec(src))) {
      assert.ok(!/\bclaimedAt\b/.test(m[1]), `${rel} declares a literal $unset block naming claimedAt`);
    }
  }

  const claimSrc = stripComments(readSrc(PRINT_QUEUE_CLAIM_LIB));
  assert.match(
    claimSrc,
    /\$set:\s*\{\s*status:\s*"printed",\s*claimedAt:\s*new Date\(\)/,
    "positive landmark: the claim CAS must $set claimedAt — proves the sweep above is reading real code, not a blinded file",
  );
});

// ── 12. pos-pulse.ts stays read-only ────────────────────────────────────────

test("PIN: lib/pos-pulse.ts never imports or calls prunePrintJobs/prunePrintJobsThrottled, and neither does the pulse route — the 20s hot path stays read-only; paired with the positive landmark that pos-pulse DOES call readPrintJobFeeds( and readPrintHostState(", () => {
  const pulseLibSrc = stripComments(readSrc(POS_PULSE_LIB));
  // "prunePrintJobs" is a substring of "prunePrintJobsThrottled" too, so this
  // one check bans both the bare fn and the throttled wrapper, import or call.
  assert.ok(!/prunePrintJobs/.test(pulseLibSrc), "pos-pulse.ts must never import or call prunePrintJobs/prunePrintJobsThrottled");
  assert.match(pulseLibSrc, /readPrintJobFeeds\(/, "positive landmark: pos-pulse.ts must call readPrintJobFeeds(");
  assert.match(pulseLibSrc, /readPrintHostState\(/, "positive landmark: pos-pulse.ts must call readPrintHostState(");

  const pulseRouteSrc = stripComments(readSrc(PULSE_ROUTE));
  assert.ok(!/prunePrintJobs/.test(pulseRouteSrc), "the pulse route must never import or call prunePrintJobs/prunePrintJobsThrottled");
});

// ── 13. No hand-rolled numeric .limit( — D1/D2/D3 caps are named constants ──

test("PIN: pos-pulse.ts contains no .limit( with a numeric literal (the D1/D2/D3 print-job reads are homed in print-queue-feeds.ts), and print-queue-feeds.ts's three feed reads each .limit( an IMPORTED shared constant by NAME — the no-raw-numeric fence covers BOTH print-queue.ts and print-queue-feeds.ts, so the split cannot become a loophole", () => {
  const pulseLibSrc = stripComments(readSrc(POS_PULSE_LIB));
  assert.match(pulseLibSrc, /\.limit\(PULSE_OPEN_SCAN_LIMIT\)/, "positive landmark: pos-pulse.ts must still .limit() its own OrderRequest query via an imported constant");
  assert.ok(!/\.limit\(\d/.test(pulseLibSrc), "pos-pulse.ts must never pass a raw numeric literal to .limit(");

  const queueSrc = stripComments(readSrc(PRINT_QUEUE_LIB));
  assert.ok(!/\.limit\(\d/.test(queueSrc), "print-queue.ts must never pass a raw numeric literal to .limit(");

  const feedsSrc = stripComments(readSrc(PRINT_QUEUE_FEEDS_LIB));
  assert.match(feedsSrc, /\.limit\(PRINT_JOB_PULSE_LIMIT\)/, "the D1 drain read must .limit(PRINT_JOB_PULSE_LIMIT)");
  assert.match(feedsSrc, /\.limit\(PRINT_JOB_STALE_LIMIT\)/, "the D2 stale read must .limit(PRINT_JOB_STALE_LIMIT)");
  assert.match(feedsSrc, /\.limit\(PRINT_JOB_RESOLVED_LIMIT\)/, "the D3 resolved read must .limit(PRINT_JOB_RESOLVED_LIMIT)");
  assert.ok(!/\.limit\(\d/.test(feedsSrc), "print-queue-feeds.ts must never pass a raw numeric literal to .limit( either");
});

// ── 13b. All three print-queue-feeds.ts openers carry .lean() ──────────────
//
// CB-U1 moved the D1 filter OUT of its inline literal and into ONE exported
// builder, printJobDrainFilter(nowMs) — on purpose, so the new wake probe
// (printJobDrainHead, GET /api/print-jobs/wake) can share the identical
// predicate with readPrintJobFeeds's own D1 read: two call sites computing
// "is a job pending" from two hand-typed literals could disagree the moment
// either drifted, producing a wake poll that fires forever (the probe says
// pending:true for a row the feed never actually carries) or never (the
// reverse) — a parity-by-construction fix, not a refactor of convenience.
// D2 (the stale band) intentionally stays an inline literal: it has no
// second caller to stay in sync with.

test("PIN: readPrintJobFeeds's D1 opener calls PrintJob.find(printJobDrainFilter(nowMs)) — the drain filter is a single exported builder now (CB-U1), shared with the wake probe's printJobDrainHead; D2/D3 keep their own openers, and all three carry .lean()", () => {
  const src = stripComments(readSrc(PRINT_QUEUE_FEEDS_LIB));
  const d1Start = src.search(/PrintJob\.find\(\s*printJobDrainFilter\(nowMs\)\s*\)/);
  assert.ok(d1Start >= 0, 'expected to find the D1 drain opener (searched for /PrintJob\\.find\\(\\s*printJobDrainFilter\\(nowMs\\)\\s*\\)/)');
  const d2Start = mustIndexOf(src, 'PrintJob.find({ status: "queued", createdAt: { $lt: cutoff } })', "the D2 stale opener");
  const d3Start = mustIndexOf(src, 'PrintJob.find({ status: { $in: ["printed", "dismissed"] }', "the D3 resolved opener");
  assert.ok(d1Start < d2Start && d2Start < d3Start, "the three openers must appear in D1, D2, D3 order");

  const d1Block = src.slice(d1Start, d2Start);
  const d2Block = src.slice(d2Start, d3Start);
  // D3's own block runs to the end of the Promise.all array — the existing
  // per-feed .limit( asserts at :504-507 already bound this the same way.
  const d3Block = src.slice(d3Start);

  assert.match(d1Block, /\.lean\(\)/, "the D1 drain read must carry .lean()");
  assert.match(d2Block, /\.lean\(\)/, "the D2 stale read must carry .lean()");
  assert.match(d3Block, /\.lean\(\)/, "the D3 resolved read must carry .lean()");
  // Positive landmark (this file's own existing per-feed cap asserts, at
  // :504-507): re-confirm alongside .lean() so a stripComments regression
  // that blinded the whole block would fail BOTH here and there, not just
  // silently pass an empty-looking slice.
  assert.match(d1Block, /\.limit\(PRINT_JOB_PULSE_LIMIT\)/, "landmark: the D1 block must still carry its own .limit(PRINT_JOB_PULSE_LIMIT)");
});

// ── 13c. printJobDrainFilter — the single builder's own shape ──────────────

test('PIN: printJobDrainFilter\'s source body carries status: "queued" and createdAt: { $gte: drainAgeCutoff(nowMs) } verbatim (the function\'s own FilterQuery<IPrintJob> return type already narrows the string literal — no separate "as const" is needed or present), AND a DB-free unit call deep-equals the exact object for a fixed nowMs — this is the parity-by-construction contract the wake probe depends on', () => {
  const src = stripComments(readSrc(PRINT_QUEUE_FEEDS_LIB));
  const fnStart = mustIndexOf(src, "export function printJobDrainFilter(nowMs: number): FilterQuery<IPrintJob>", "the printJobDrainFilter declaration");
  const fnEnd = src.indexOf("\n}", fnStart);
  assert.ok(fnEnd > fnStart, "expected to find the end of printJobDrainFilter's body");
  const fnBody = src.slice(fnStart, fnEnd);

  assert.match(fnBody, /return \{ status: "queued", createdAt: \{ \$gte: drainAgeCutoff\(nowMs\) \} \};/, 'printJobDrainFilter must return { status: "queued", createdAt: { $gte: drainAgeCutoff(nowMs) } };');

  // DB-free unit: importing print-queue-feeds.ts pulls in the PrintJob model
  // module (it imports { PrintJob } from "@/models/PrintJob"), but merely
  // IMPORTING a Mongoose model registers a schema — it opens no connection
  // and touches no DB, matching this file's own existing imports of
  // printJobFeedRowOf/printJobResolvedRowOf above (already DB-free per the
  // header comment). Calling the pure printJobDrainFilter(t) function itself
  // never touches Mongoose at all.
  const t = 1_700_000_000_000;
  assert.deepEqual(printJobDrainFilter(t), { status: "queued", createdAt: { $gte: drainAgeCutoff(t) } });
});

// ── 13d. printJobDrainHead — the wake probe's own change-signal read ───────
//
// CB-U1 review round 1 (F-A): a bare pending:true answer invalidated the pulse
// EVERY tick while the host was busy printing (live-probed against
// @tanstack/query-core 5.101.0), so the probe was widened from a boolean
// existence check (printJobDrainPending) to a CHANGE SIGNAL — the newest
// drain-eligible job's own id — sharing printJobDrainFilter exactly as before.

test('PIN: printJobDrainHead\'s source calls PrintJob.findOne(printJobDrainFilter(nowMs)), sorted {createdAt:-1,_id:-1} (newest first) and .select("_id") (id only, no payload), and its return maps head===null to {pending:false,newestId:null} and a real head to {pending:true,newestId:String(head._id)} — the exact change-signal shape use-print-host-wake.ts\'s lastNewestIdRef compares against', () => {
  const src = stripComments(readSrc(PRINT_QUEUE_FEEDS_LIB));
  const fnStart = mustIndexOf(src, "export async function printJobDrainHead(nowMs: number)", "the printJobDrainHead declaration");
  const fnBody = src.slice(fnStart);

  assert.match(
    fnBody,
    /PrintJob\s*\.\s*findOne\(\s*printJobDrainFilter\(nowMs\)\s*\)/,
    "printJobDrainHead must call PrintJob.findOne(printJobDrainFilter(nowMs))",
  );
  assert.match(
    fnBody,
    /\.\s*sort\(\s*\{\s*createdAt:\s*-1,\s*_id:\s*-1\s*\}\s*\)/,
    "printJobDrainHead must sort { createdAt: -1, _id: -1 } — newest drain-eligible job first",
  );
  assert.match(fnBody, /\.\s*select\(\s*"_id"\s*\)/, 'printJobDrainHead must .select("_id") — no payload, id only');
  assert.match(
    fnBody,
    /head\s*===\s*null\s*\?\s*\{\s*pending:\s*false,\s*newestId:\s*null\s*\}\s*:\s*\{\s*pending:\s*true,\s*newestId:\s*String\(head\._id\)\s*\}/,
    'printJobDrainHead must return head === null ? { pending: false, newestId: null } : { pending: true, newestId: String(head._id) }',
  );
});

// ── 14. D1/D2 disjoint at the SAME cutoff, both deterministically sorted ───

test("PIN: D1 and D2 are disjoint at the SAME cutoff expression (printJobDrainFilter's $gte vs D2's own $lt, both against one drainAgeCutoff( call), and BOTH sort {createdAt:1,_id:1} — the _id tie-break makes same-millisecond drain order deterministic (MERGED-16)", () => {
  const src = stripComments(readSrc(PRINT_QUEUE_FEEDS_LIB));
  const cutoffDeclIdx = mustIndexOf(src, "const cutoff = drainAgeCutoff(nowMs);", "the shared cutoff declaration");
  const d1Idx = src.search(/PrintJob\.find\(\s*printJobDrainFilter\(nowMs\)\s*\)/);
  assert.ok(d1Idx >= 0, "expected to find the D1 drain filter call (PrintJob.find(printJobDrainFilter(nowMs)))");
  const d2Idx = mustIndexOf(src, 'status: "queued", createdAt: { $lt: cutoff }', "the D2 stale filter");
  assert.ok(cutoffDeclIdx < d1Idx && d1Idx < d2Idx, "the cutoff must be computed once, then D1 (drain), then D2 (stale)");

  // printJobDrainFilter itself (declared earlier in the same file, above
  // readPrintJobFeeds) builds createdAt: { $gte: drainAgeCutoff(nowMs) } —
  // NOT against the local `cutoff` variable, but against the SAME
  // drainAgeCutoff(nowMs) call that produced it, so the two remain the same
  // instant. D2's $lt: cutoff reads the local variable directly.
  assert.match(src, /createdAt:\s*\{\s*\$gte:\s*drainAgeCutoff\(nowMs\)\s*\}/, "the D1 builder's filter must gate on $gte: drainAgeCutoff(nowMs)");

  const sortHits = (src.match(/\.sort\(\{\s*createdAt:\s*1,\s*_id:\s*1\s*\}\)/g) ?? []).length;
  assert.equal(sortHits, 2, "both the D1 and D2 reads must sort {createdAt:1,_id:1}");
});

// ── 15. Dismiss route: reason narrowed to z.literal("staff") ───────────────

test('PIN: the dismiss ROUTE\'s Zod narrows reason to z.literal("staff") ONLY — a client must never be able to stamp order-cancelled/round-voided/host-cleared/invalid-payload (the Mongoose enum is no runtime fence for update writers); paired with the positive landmark that dismissedBy is derived from the session', () => {
  const src = stripComments(readSrc(DISMISS_ROUTE));
  assert.match(src, /reason:\s*z\.literal\("staff"\)/, 'the dismiss body schema must be reason: z.literal("staff")');
  assert.match(src, /const dismissedBy = authed\.session\.user\.name/, "dismissedBy must be derived from the session, not the request body");
});

// ── 16. PUT /api/print-host: .min(1) on both fields, setBy from session ────

test("PIN: PUT /api/print-host's Zod puts .min(1) on BOTH deviceId and label (an empty string would 500 against required:true + runValidators:true), and setBy is read from the session, never the parsed body", () => {
  const src = stripComments(readSrc(PRINT_HOST_ROUTE));
  const putStart = mustIndexOf(src, "export async function PUT", "the PUT handler");
  const schemaBlock = src.slice(0, putStart);
  assert.match(schemaBlock, /deviceId:\s*z\.string\(\)\.trim\(\)\.min\(1\)/, "deviceId must carry .min(1)");
  assert.match(schemaBlock, /label:\s*z\.string\(\)\.trim\(\)\.min\(1\)/, "label must carry .min(1)");
  assert.match(src.slice(putStart), /const setBy = authed\.session\.user\.name/, "setBy must be derived from the session inside PUT");
  assert.ok(!/setBy:\s*parsed\.data/.test(src), "setBy must never be read off the parsed request body");
});

// ── 16b. Rollout fence on PUT /api/print-host (CB-1d.1 close-out, 2026-09-03; OPENED by PH-8 2026-09-06) ─

test("PIN: rollout fence — lib/print-host.ts exports PRINT_HOST_DESIGNATION_ENABLED = true (PH-8 flipped it AND this pin in one edit; the branch is KEPT so re-closing is one literal) plus a named PRINT_HOST_DESIGNATION_CLOSED_ERROR; the PUT handler still branches on it AFTER requireAuth() but BEFORE validateBody( and connectDB(), returning failure(PRINT_HOST_DESIGNATION_CLOSED_ERROR, …); DELETE never consults the fence (clearing a host stays reachable from any device)", () => {
  const libSrc = stripComments(readSrc(PRINT_HOST_LIB));
  assert.match(
    libSrc,
    /export const PRINT_HOST_DESIGNATION_ENABLED = true;/,
    "the fence must be exported from lib/print-host.ts as the literal `true` since PH-8 (designation LIVE) — re-closing it means flipping this pin in the same edit",
  );
  assert.match(
    libSrc,
    /export const PRINT_HOST_DESIGNATION_CLOSED_ERROR =\s*"[^"]+";/,
    "the refusal copy must be a named, exported, non-empty string constant",
  );

  const routeSrc = stripComments(readSrc(PRINT_HOST_ROUTE));
  const putStart = mustIndexOf(routeSrc, "export async function PUT", "the PUT handler");
  const deleteStart = mustIndexOf(routeSrc, "export async function DELETE", "the DELETE handler");
  assert.ok(putStart < deleteStart, "PUT must be declared before DELETE (the slice below relies on it)");
  const putBody = routeSrc.slice(putStart, deleteStart);

  const authAt = mustIndexOf(putBody, "requireAuth()", "PUT's requireAuth call");
  const fenceAt = putBody.search(/if \(!PRINT_HOST_DESIGNATION_ENABLED\)/);
  assert.ok(fenceAt >= 0, "PUT must branch on !PRINT_HOST_DESIGNATION_ENABLED");
  const validateAt = mustIndexOf(putBody, "validateBody(", "PUT's validateBody call");
  const connectAt = mustIndexOf(putBody, "connectDB()", "PUT's connectDB call");
  assert.ok(authAt < fenceAt, "the fence must run AFTER requireAuth() — anonymous callers get the plain 401, never product state");
  assert.ok(fenceAt < validateAt, "the fence must run BEFORE body validation");
  assert.ok(fenceAt < connectAt, "the fence must run BEFORE connectDB()");
  assert.match(
    putBody.slice(fenceAt),
    /^[^}]*return noStore\(failure\(PRINT_HOST_DESIGNATION_CLOSED_ERROR,/,
    "the fence branch must return noStore(failure(PRINT_HOST_DESIGNATION_CLOSED_ERROR, …)) as its refusal",
  );
  assert.ok(!routeSrc.slice(deleteStart).includes("PRINT_HOST_DESIGNATION_ENABLED"), "DELETE must never consult the fence");
});

// ── 17. Beat route: no prune, deviceId-bound CAS ────────────────────────────

test("PIN: the beat route's POST handler runs NO prune (neither branch), and beatPrintHost's CAS filter carries deviceId alongside key — a demoted device's stale beat must not resurrect the silentMode/silentProbeMs a designation's $unset already cleared; paired with the positive landmark that designatePrintHost's update DOES $unset both fields", () => {
  const routeSrc = stripComments(readSrc(BEAT_ROUTE));
  assert.ok(!/prunePrintJobs/.test(routeSrc), "the beat route must never call prunePrintJobs/prunePrintJobsThrottled — it fires every 20s");

  const hostLibSrc = stripComments(readSrc(PRINT_HOST_LIB));
  const beatStart = mustIndexOf(hostLibSrc, "export async function beatPrintHost", "beatPrintHost");
  const beatBody = hostLibSrc.slice(beatStart);
  assert.match(beatBody, /\{\s*key:\s*PRINT_HOST_KEY,\s*deviceId:\s*input\.deviceId\s*\}/, "the beat CAS filter must carry BOTH key and deviceId");

  assert.match(
    hostLibSrc,
    /\$unset:\s*\{\s*silentMode:\s*"",\s*silentProbeMs:\s*""\s*\}/,
    "positive landmark: designatePrintHost's update must $unset both silentMode and silentProbeMs",
  );
});

// ── 18. DELETE /api/print-host: clear-then-dismiss order, matching guard ───

test("PIN: DELETE /api/print-host clears the host BEFORE the bulk dismiss (index order — a job must never be createable/claimable mid-teardown), and dismissQueuedPrintJobsForClearedHost carries the SAME claimedAt:{$exists:false} guard as the single dismiss", () => {
  const routeSrc = stripComments(readSrc(PRINT_HOST_ROUTE));
  const deleteStart = mustIndexOf(routeSrc, "export async function DELETE", "the DELETE handler");
  const deleteBody = routeSrc.slice(deleteStart);
  const clearIdx = mustIndexOf(deleteBody, "await clearPrintHost()", "the clearPrintHost call");
  const dismissIdx = mustIndexOf(deleteBody, "await dismissQueuedPrintJobsForClearedHost(dismissedBy)", "the bulk dismiss call");
  assert.ok(clearIdx < dismissIdx, "clearPrintHost() must run before dismissQueuedPrintJobsForClearedHost(");

  const queueSrc = stripComments(readSrc(PRINT_QUEUE_LIB));
  const singleStart = mustIndexOf(queueSrc, "export async function dismissPrintJob", "dismissPrintJob");
  const bulkStart = mustIndexOf(queueSrc, "export async function dismissQueuedPrintJobsForClearedHost", "dismissQueuedPrintJobsForClearedHost");
  assert.ok(singleStart < bulkStart, "dismissPrintJob must be declared before the bulk dismiss (sanity for the slice below)");
  const singleBody = queueSrc.slice(singleStart, bulkStart);
  const bulkBody = queueSrc.slice(bulkStart);
  assert.match(singleBody, /claimedAt:\s*\{\s*\$exists:\s*false\s*\}/, "the single dismiss must carry claimedAt: { $exists: false }");
  assert.match(bulkBody, /claimedAt:\s*\{\s*\$exists:\s*false\s*\}/, "the bulk dismiss must carry the SAME claimedAt: { $exists: false } guard");
});

// ── 19. All five routes: auth-before-db, noStore(, force-dynamic ───────────

test('PIN: every one of the five print-jobs/print-host route files calls requireAuth() before connectDB() in EVERY handler, every non-exempt return goes through noStore(, and each declares export const dynamic = "force-dynamic"', () => {
  for (const rel of ROUTE_FILES) {
    const src = stripComments(readSrc(rel));
    assert.match(src, /export const dynamic = "force-dynamic";/, `${rel} must declare dynamic = "force-dynamic"`);

    const handlerSplits = src.split(/(?=export async function )/).filter((s) => s.startsWith("export async function"));
    assert.ok(handlerSplits.length > 0, `${rel} must declare at least one handler`);
    for (const handler of handlerSplits) {
      const authIdx = handler.indexOf("requireAuth()");
      const dbIdx = handler.indexOf("connectDB()");
      assert.ok(authIdx >= 0, `${rel}: a handler is missing requireAuth()`);
      assert.ok(dbIdx >= 0, `${rel}: a handler is missing connectDB()`);
      assert.ok(authIdx < dbIdx, `${rel}: requireAuth() must run before connectDB() in every handler`);
    }

    // Every `return` other than the two established pre-body-parse
    // short-circuits (`authed.error` / `parsed.error` — themselves already-
    // built failure() Responses; a repo-wide convention, not special to these
    // routes: grep shows dozens of sibling routes doing the exact same thing)
    // must wrap its Response in noStore(.
    const nonExemptReturns = src.match(/return (?!authed\.error;|parsed\.error;)[^\n]*?;/g) ?? [];
    assert.ok(nonExemptReturns.length > 0, `${rel}: expected at least one non-exempt return to check`);
    for (const ret of nonExemptReturns) {
      assert.match(ret, /noStore\(/, `${rel}: return statement "${ret.trim()}" must go through noStore(`);
    }
  }
});
