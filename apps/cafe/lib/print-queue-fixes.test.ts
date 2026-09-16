import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

import { printJobKeyOf } from "./print-queue";
import { printJobEligibility } from "./print-queue-claim";
import { printJobResolvedRowOf } from "./print-queue-feeds";
import { printHostStateOf } from "./print-host";
import { printJobEnqueueAllowsLocalPrint, type PrintJobEnqueueResult } from "@pos/shared/print-job";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";

// Print-host plan (.claude/plan/v2/print-host-plan.md §C PH-3) — regression
// pins for the 10 arbitrated adversarial-review findings that were just
// FIXED, plus two coverage gaps (A/B) a review lens flagged as missing.
// DB-free: pure helpers exercised directly, everything else is a SOURCE-TEXT
// pin (readFileSync + stripComments), mirroring lib/print-queue.test.ts. Every
// test names the MUTATION it catches in its own title/assert message. No
// mongod, no connectDB, no mongoose connection anywhere in this file.
//
// NOTE ON THE FEED-MODULE SPLIT: print-queue.ts's FEED half
// (printJobFeedRowOf/printJobResolvedRowOf/PrintJobFeeds/readPrintJobFeeds)
// moved into lib/print-queue-feeds.ts (verified by grep before finalizing
// this file — printJobResolvedRowOf is imported from there below). The
// writes (enqueuePrintJob/dismissPrintJob/prunePrintJobs*) stay in
// print-queue.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `expected to find ${label} (searched for ${JSON.stringify(needle)})`);
  return idx;
}

const PRINT_QUEUE_LIB = "apps/cafe/lib/print-queue.ts";
const PRINT_QUEUE_CLAIM_LIB = "apps/cafe/lib/print-queue-claim.ts";
const POS_PULSE_LIB = "apps/cafe/lib/pos-pulse.ts";
const PRINT_HOST_ROUTE = "apps/cafe/app/api/print-host/route.ts";
const ENQUEUE_ROUTE = "apps/cafe/app/api/print-jobs/route.ts";
const CLAIM_ROUTE = "apps/cafe/app/api/print-jobs/[id]/claim/route.ts";
const SHARED_PRINT_JOB = "packages/shared/src/print-job.ts";
const SHARED_SELF_ORDER_ALERT_TEST = "packages/shared/src/self-order-alert.test.ts";

// ── payload() factory — minimal valid printOrderSnapshot-shaped payloads,
// verified to PARSE against the real printJobPayloadSchema so a factory that
// drifts from the contract fails loudly instead of testing a fiction ──

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

function payload(kind: "kot" | "bill" | "void" | "moved", overrides: PayloadOverrides = {}): PrintJobPayload {
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
  }
  const result = printJobPayloadSchema.safeParse(draft);
  if (!result.success) {
    throw new Error(`payload(${kind}) factory drifted from printJobPayloadSchema: ${JSON.stringify(result.error.issues)}`);
  }
  return result.data;
}

// ═════════════════════════════════════════════════════════════════════════
// FIX 1 — reprint discriminator (bill/void/moved gained reprint: z.literal(true).optional())
// ═════════════════════════════════════════════════════════════════════════

test('printJobKeyOf: bill — reprint:true -> undefined, reprint ABSENT -> the normal derived key, and the two productions of the SAME order DIFFER in dedupe outcome (MUTATION this catches: reverting the reprint discriminator makes an ordinary bill reprint collide E11000 with the already-"printed" original and answer already-resolved, which forbids a local fallback — the slip prints nowhere for 2h)', () => {
  const original = payload("bill");
  const reprint = payload("bill", { reprint: true });
  assert.notEqual(printJobKeyOf(original), undefined, "the ORIGINAL bill must still get a real dedupe key");
  assert.equal(printJobKeyOf(reprint), undefined, "a reprint bill must get NO dedupe key");
  assert.notEqual(printJobKeyOf(original), printJobKeyOf(reprint), "original and reprint must produce DIFFERENT dedupe outcomes");
});

test('printJobKeyOf: void — reprint:true -> undefined, reprint ABSENT -> the normal derived key, and original vs reprint DIFFER in dedupe outcome', () => {
  const original = payload("void");
  const reprint = payload("void", { reprint: true });
  assert.notEqual(printJobKeyOf(original), undefined);
  assert.equal(printJobKeyOf(reprint), undefined);
  assert.notEqual(printJobKeyOf(original), printJobKeyOf(reprint));
});

test('printJobKeyOf: moved — reprint:true -> undefined, reprint ABSENT -> the normal derived key, and original vs reprint DIFFER in dedupe outcome', () => {
  const original = payload("moved");
  const reprint = payload("moved", { reprint: true });
  assert.notEqual(printJobKeyOf(original), undefined);
  assert.equal(printJobKeyOf(reprint), undefined);
  assert.notEqual(printJobKeyOf(original), printJobKeyOf(reprint));
});

test('printJobPayloadSchema: bill/void/moved REJECT reprint:false and reprint:"yes" (z.literal(true) leaves no representable third state), and ACCEPT its absence — paired positive-landmark parses prove the schema itself still works', () => {
  const billFalse = printJobPayloadSchema.safeParse({ kind: "bill", snapshot: BASE_SNAPSHOT, reprint: false });
  assert.equal(billFalse.success, false, "reprint:false must be REJECTED for bill");
  const billYes = printJobPayloadSchema.safeParse({ kind: "bill", snapshot: BASE_SNAPSHOT, reprint: "yes" });
  assert.equal(billYes.success, false, 'reprint:"yes" must be REJECTED for bill');
  const billAbsent = printJobPayloadSchema.safeParse({ kind: "bill", snapshot: BASE_SNAPSHOT });
  assert.equal(billAbsent.success, true, "positive landmark: reprint ABSENT must still parse for bill");

  const voidFalse = printJobPayloadSchema.safeParse({
    kind: "void",
    snapshot: BASE_SNAPSHOT,
    line: { ...BASE_ITEM },
    reason: "x",
    voidedBy: "Staff",
    voidedAt: "2026-01-01T00:00:00.000Z",
    reprint: false,
  });
  assert.equal(voidFalse.success, false, "reprint:false must be REJECTED for void");

  const movedFalse = printJobPayloadSchema.safeParse({
    kind: "moved",
    snapshot: BASE_SNAPSHOT,
    from: "T-1",
    movedBy: "Staff",
    movedAt: "2026-01-01T00:00:00.000Z",
    reprint: false,
  });
  assert.equal(movedFalse.success, false, "reprint:false must be REJECTED for moved");
});

test('printJobPayloadSchema: "kot" is UNAFFECTED by the reprint discriminator — round:null remains its OWN reprint-equivalent, and a "reprint" key on a kot payload is REJECTED (.strict() extra-key), proving kind:"kot" never gained the field; paired positive landmark that a normal kot payload still parses', () => {
  const withReprint = printJobPayloadSchema.safeParse({ kind: "kot", snapshot: BASE_SNAPSHOT, round: null, reprint: true });
  assert.equal(withReprint.success, false, 'a "reprint" key on a kot payload must be rejected');

  const ok = printJobPayloadSchema.safeParse({ kind: "kot", snapshot: BASE_SNAPSHOT, round: null });
  assert.equal(ok.success, true, "positive landmark: a normal kot payload (no reprint key) still parses");
});

// ═════════════════════════════════════════════════════════════════════════
// FIX 2 — uncastable orderId must be DISMISSED, not thrown (live-probe fact:
// Order.findById on an uncastable id rejects at await, escaping a closed
// try/catch)
// ═════════════════════════════════════════════════════════════════════════

test("PIN: print-queue-claim.ts gates Order.findById(job.orderId) behind isValidObjectId FIRST (index order), the guarded branch dismisses with invalid-payload, printJobNeedsOrderRead is consulted (positive landmark), and the Order.findById( call itself is NOT wrapped in a NEW try/catch — a genuine DB error there must still surface as a 500 (MUTATION: without this gate a malformed orderId 500s the claim route, stranding the row 'queued' at the drain head)", () => {
  const claimSrc = stripComments(readSrc(PRINT_QUEUE_CLAIM_LIB));
  const fnStart = mustIndexOf(claimSrc, "export async function claimPrintJob", "claimPrintJob");
  const fnBody = claimSrc.slice(fnStart);

  assert.match(fnBody, /printJobNeedsOrderRead\(parsedPayload\)/, "positive landmark: printJobNeedsOrderRead must gate whether the Order read happens at all");

  const gateIdx = mustIndexOf(fnBody, "!mongoose.isValidObjectId(job.orderId)", "the isValidObjectId gate");
  const findByIdIdx = mustIndexOf(fnBody, "await Order.findById(job.orderId)", "the Order.findById read");
  assert.ok(gateIdx < findByIdIdx, "the isValidObjectId gate must run STRICTLY BEFORE Order.findById(");

  const gateBlockEnd = mustIndexOf(fnBody, "const order =", "the order-read assignment following the gate");
  const gateBlock = fnBody.slice(gateIdx, gateBlockEnd);
  assert.match(gateBlock, /reason:\s*"invalid-payload"/, "the isValidObjectId-gate branch must dismiss with invalid-payload");

  // No NEW try opens between the gate's guard block and the read itself.
  const noTryZone = fnBody.slice(gateBlockEnd, findByIdIdx + "await Order.findById(job.orderId)".length);
  assert.ok(!/\btry\b/.test(noTryZone), "Order.findById( must not be wrapped in a try — a genuine DB error below it must still surface as an honest 500, per the live-probe finding");
});

// ═════════════════════════════════════════════════════════════════════════
// FIX 3 — enqueue/teardown reciprocal fence (a second PrintHost.findOne(
// AFTER PrintJob.create() closes the DELETE-teardown race window)
// ═════════════════════════════════════════════════════════════════════════

test("PIN: enqueuePrintJob reads PrintHost.findOne( exactly TWICE — once before PrintJob.create(, once after (the reciprocal re-read) — and the post-create miss branch dismisses host-cleared and returns no-host (MUTATION: without the re-read, an enqueue that passed its host check before a concurrent DELETE /api/print-host creates a row the teardown's bulk dismiss already swept past — orphaned queued forever, and the caller was told it was queued, so no local print either)", () => {
  const src = stripComments(readSrc(PRINT_QUEUE_LIB));
  const fnStart = mustIndexOf(src, "export async function enqueuePrintJob", "enqueuePrintJob");
  const fnEnd = mustIndexOf(src, "export type DismissPrintJobResult", "the boundary after enqueuePrintJob");
  const fnBody = src.slice(fnStart, fnEnd);

  const hostReadIndices = [...fnBody.matchAll(/PrintHost\.findOne\(/g)].map((m) => m.index as number);
  assert.equal(hostReadIndices.length, 2, "enqueuePrintJob must call PrintHost.findOne( exactly twice");

  const createIdx = mustIndexOf(fnBody, "PrintJob.create(", "the write point");
  assert.ok(hostReadIndices[0] < createIdx, "the FIRST host read must precede PrintJob.create(");
  assert.ok(createIdx < hostReadIndices[1], "the SECOND host read (reciprocal re-read) must come AFTER PrintJob.create(");

  const missBranch = fnBody.slice(hostReadIndices[1]);
  assert.match(missBranch, /reason:\s*"host-cleared"/, "the post-create miss branch must dismiss with host-cleared");
  assert.match(missBranch, /outcome:\s*"no-host"/, "the post-create miss branch must return the no-host outcome");
});

// ═════════════════════════════════════════════════════════════════════════
// FIX 4 — dismissedBy is the session staff name (never claimedByOf's device pair)
// ═════════════════════════════════════════════════════════════════════════

test("PIN: claimPrintJob's input type carries dismissedBy, and EVERY auto-dismiss call site in print-queue-claim.ts passes dismissedBy: input.dismissedBy — count MEASURED at 4 (three invalid-payload sites: safeParse failure, JSON.parse throw, isValidObjectId gate; one not-eligible site), asserted by name so a future dismiss site that reverts to claimedByOf fails here; claimedByOf( is NEVER passed as dismissedBy anywhere, but IS still used for claimedBy in the CAS (positive landmark)", () => {
  const claimSrc = stripComments(readSrc(PRINT_QUEUE_CLAIM_LIB));

  assert.match(claimSrc, /dismissedBy:\s*string;/, "claimPrintJob's input type must declare dismissedBy: string");

  const dismissedBySites = claimSrc.match(/dismissedBy:\s*input\.dismissedBy/g) ?? [];
  assert.equal(dismissedBySites.length, 4, "every auto-dismiss call site must pass dismissedBy: input.dismissedBy — measured count is 4 (see test title)");

  assert.ok(!/dismissedBy:\s*claimedByOf\(/.test(claimSrc), "claimedByOf( must NEVER be passed as dismissedBy — it is the deviceId:tabId pair, not the session staff name");
  assert.match(claimSrc, /claimedBy:\s*claimedByOf\(/, "positive landmark: claimedByOf( must still be used for claimedBy in the claim CAS");
});

test("PIN: POST /api/print-jobs/[id]/claim derives dismissedBy from the SESSION (authed.session.user.name), never the request body", () => {
  const routeSrc = stripComments(readSrc(CLAIM_ROUTE));
  assert.match(routeSrc, /const dismissedBy = authed\.session\.user\.name/, "dismissedBy must be derived from the session inside the claim route");
});

// ═════════════════════════════════════════════════════════════════════════
// FIX 5 — printJobEnqueueAllowsLocalPrint discriminant + single-homing in shared
// ═════════════════════════════════════════════════════════════════════════

test('printJobEnqueueAllowsLocalPrint: true ONLY for "no-host" — false for queued/already-resolved/too-large. THE LOAD-BEARING PIN: a caller branching on "not queued ⇒ print locally" would print a DUPLICATE slip for already-resolved — the exact shape of two past local bugs', () => {
  assert.equal(printJobEnqueueAllowsLocalPrint("no-host"), true);
  assert.equal(printJobEnqueueAllowsLocalPrint("queued"), false);
  assert.equal(printJobEnqueueAllowsLocalPrint("already-resolved"), false);
  assert.equal(printJobEnqueueAllowsLocalPrint("too-large"), false);
});

test("PrintJobEnqueueResult's already-resolved member carries an id — type-level pin: this literal only compiles if the field is part of the shape", () => {
  const result: PrintJobEnqueueResult = { outcome: "already-resolved", id: "job-1" };
  assert.equal(result.outcome, "already-resolved");
  if (result.outcome === "already-resolved") {
    assert.equal(result.id, "job-1", "the already-resolved outcome must carry the EXISTING row's id so PH-8's readback can still track the job");
  }
});

test("PIN: PrintJobEnqueueResult and printJobEnqueueAllowsLocalPrint are declared in @pos/shared/print-job (single-homed) — apps/cafe/lib/print-queue.ts must IMPORT the type from shared, never redeclare its own union", () => {
  const sharedSrc = stripComments(readSrc(SHARED_PRINT_JOB));
  assert.match(sharedSrc, /export type PrintJobEnqueueResult\s*=/, "positive landmark: PrintJobEnqueueResult must be declared in shared");
  assert.match(sharedSrc, /export function printJobEnqueueAllowsLocalPrint/, "positive landmark: the helper must be declared in shared");

  const cafeQueueSrc = stripComments(readSrc(PRINT_QUEUE_LIB));
  assert.ok(!/type PrintJobEnqueueResult\s*=/.test(cafeQueueSrc), "the cafe lib must never redeclare PrintJobEnqueueResult locally");
  assert.match(
    cafeQueueSrc,
    /import\s*\{[^}]*PrintJobEnqueueResult[^}]*\}\s*from\s*"@pos\/shared\/print-job"/,
    "the cafe lib must import PrintJobEnqueueResult FROM shared, not define its own",
  );
});

// ═════════════════════════════════════════════════════════════════════════
// FIX 6 — the pulse fails soft ONLY on the print-job read (PosPulseData.printHost
// is now PrintHostState | null)
// ═════════════════════════════════════════════════════════════════════════

test("PIN: readPosPulse's two OrderRequest reads (openRows/selfRows) run BEFORE the print-read try/catch (index order) — a real OrderRequest outage must still 500. The print-read try/catch's catch serves printHost:null + empty feeds (MUTATION: without this fail-soft boundary, one failing PrintJob read 500s the WHOLE pulse — TanStack serves stale data, and the QR self-order auto-print lane silently stops forever); positive landmark: readPrintHostState( and readPrintJobFeeds( are still called inside the try", () => {
  const src = stripComments(readSrc(POS_PULSE_LIB));
  const fnStart = mustIndexOf(src, "export async function readPosPulse", "readPosPulse");
  const fnEnd = mustIndexOf(src, "export type ClaimKotPrintResult", "the boundary after readPosPulse");
  const fnBody = src.slice(fnStart, fnEnd);

  const openIdx = mustIndexOf(fnBody, "const openRows = await OrderRequest.find(", "the open-rows read");
  const selfIdx = mustIndexOf(fnBody, "const selfRows = await OrderRequest.find(", "the self-rows read");
  const tryIdx = mustIndexOf(fnBody, "try {", "the print-read try block");
  assert.ok(openIdx < tryIdx, "the openRows OrderRequest read must run before the print-read try block");
  assert.ok(selfIdx < tryIdx, "the selfRows OrderRequest read must run before the print-read try block");

  const catchIdx = mustIndexOf(fnBody, "} catch {", "the catch block");
  const tryBlock = fnBody.slice(tryIdx, catchIdx);
  assert.match(tryBlock, /readPrintHostState\(/, "positive landmark: readPrintHostState( must still be called inside the try");
  assert.match(tryBlock, /readPrintJobFeeds\(/, "positive landmark: readPrintJobFeeds( must still be called inside the try");

  const returnIdx = mustIndexOf(fnBody, "return {", "the pulse's own return statement");
  const catchBlock = fnBody.slice(catchIdx, returnIdx);
  assert.match(catchBlock, /printHost\s*=\s*null/, "the catch must serve printHost: null");
  assert.match(catchBlock, /printJobs:\s*\[\]/, "the catch must serve an empty printJobs feed");
  assert.match(catchBlock, /stalePrintJobs:\s*\[\]/, "the catch must serve an empty stalePrintJobs feed");
  assert.match(catchBlock, /resolvedPrintJobs:\s*\[\]/, "the catch must serve an empty resolvedPrintJobs feed");
});

test("PosPulseData.printHost is nullable (PrintHostState | null) in the shared contract — the type this fail-soft catch branch depends on", () => {
  const sharedSrc = stripComments(readSrc("packages/shared/src/self-order-alert.ts"));
  assert.match(sharedSrc, /printHost:\s*PrintHostState\s*\|\s*null;/, "PosPulseData.printHost must be typed PrintHostState | null");
});

// ═════════════════════════════════════════════════════════════════════════
// FIX 7 — fixture/server parity on offline:true for an unconfigured host
// ═════════════════════════════════════════════════════════════════════════

test("printHostStateOf(null, nowMs) -> offline:true, configured:false, silentMode:false, and NO silentProbeMs key — the server-side authority this fixture parity pin below is checked against", () => {
  const state = printHostStateOf(null, 1_700_000_000_000);
  assert.equal(state.configured, false);
  assert.equal(state.offline, true);
  assert.equal(state.silentMode, false);
  assert.ok(!("silentProbeMs" in state), "silentProbeMs must never appear on the unconfigured wire state");
});

test("CROSS-PACKAGE PARITY PIN: packages/shared/src/self-order-alert.test.ts's pulse() fixture factory states printHost: { configured:false, ..., offline:true, ... } — matching printHostStateOf(null, …) above, VERBATIM as SOURCE TEXT (MUTATION this catches: a PH-8 band test written against a factory saying offline:false would pass green while production shows the offline warning on every phone in a host-less cafe)", () => {
  const fixtureSrc = stripComments(readSrc(SHARED_SELF_ORDER_ALERT_TEST));
  const pulseFnStart = mustIndexOf(fixtureSrc, "function pulse(", "the pulse() fixture factory");
  const fnBody = fixtureSrc.slice(pulseFnStart);
  const printHostKeyIdx = mustIndexOf(fnBody, "printHost:", "the printHost literal inside pulse()");
  const printHostBlockEnd = mustIndexOf(fnBody.slice(printHostKeyIdx), "},", "the close of the printHost literal") + printHostKeyIdx;
  const printHostBlock = fnBody.slice(printHostKeyIdx, printHostBlockEnd);

  assert.match(printHostBlock, /configured:\s*false/, "positive landmark: pulse()'s printHost literal must state configured: false — proves this is reading the real unconfigured-host object, not a blinded region");
  assert.match(printHostBlock, /offline:\s*true/, "pulse()'s printHost fixture must say offline: true, matching printHostStateOf(null, …) — the production shape for an unconfigured host");
});

// ═════════════════════════════════════════════════════════════════════════
// FIX 8 — PUT/DELETE /api/print-host prune UNTHROTTLED; POST /api/print-jobs
// prunes THROTTLED (the converse)
// ═════════════════════════════════════════════════════════════════════════

test("PIN: PUT and DELETE /api/print-host each call prunePrintJobs( and NEITHER calls prunePrintJobsThrottled( (a low-frequency staff action must not silently no-op by sharing the hot enqueue-POST's module-level throttle clock) — positive landmark that a prune call exists inside EACH handler's own region", () => {
  const hostRouteSrc = stripComments(readSrc(PRINT_HOST_ROUTE));
  assert.ok(!/prunePrintJobsThrottled\(/.test(hostRouteSrc), "PUT/DELETE /api/print-host must never call the THROTTLED wrapper");

  const putStart = mustIndexOf(hostRouteSrc, "export async function PUT", "the PUT handler");
  const deleteStart = mustIndexOf(hostRouteSrc, "export async function DELETE", "the DELETE handler");
  assert.ok(putStart < deleteStart, "sanity: PUT must be declared before DELETE in this file");

  const putBody = hostRouteSrc.slice(putStart, deleteStart);
  const deleteBody = hostRouteSrc.slice(deleteStart);
  assert.match(putBody, /prunePrintJobs\(/, "positive landmark: PUT must call prunePrintJobs(");
  assert.match(deleteBody, /prunePrintJobs\(/, "positive landmark: DELETE must call prunePrintJobs(");
});

test("PIN: the enqueue POST /api/print-jobs DOES use prunePrintJobsThrottled( — the converse of FIX 8 (this route IS the hot poll the throttle clock exists to protect)", () => {
  const enqueueRouteSrc = stripComments(readSrc(ENQUEUE_ROUTE));
  assert.match(enqueueRouteSrc, /prunePrintJobsThrottled\(/, "the enqueue POST must use the THROTTLED wrapper");
});

// ═════════════════════════════════════════════════════════════════════════
// FIX 9 (as amended by fix round 2, F-2) — DELETE ordering: clear, then prune, then dismiss
// ═════════════════════════════════════════════════════════════════════════

test("PIN: DELETE /api/print-host's internal ordering is clearPrintHost( < prunePrintJobs( < dismissQueuedPrintJobsForClearedHost( — strictly index-ordered, and each position carries its own reason. CLEAR FIRST: while the host doc still exists a concurrent enqueue passes BOTH its host checks (including the post-create re-read), is told outcome:\"queued\", and is then killed by the bulk dismiss — a kitchen ticket that exists nowhere while staff saw success; fix round 1 put the prune first and widened that window by two unthrottled deleteMany round trips. PRUNE BEFORE DISMISS: the resolved sweep filters createdAt, so running it AFTER the dismiss deletes the very rows the dismiss just stamped, destroying the SEC-7 actor trail inside one request. DISMISS LAST: its trail then survives to at least the next sweep. MUTATION: any reorder reopens one of the two", () => {
  const hostRouteSrc = stripComments(readSrc(PRINT_HOST_ROUTE));
  const deleteStart = mustIndexOf(hostRouteSrc, "export async function DELETE", "the DELETE handler");
  const deleteBody = hostRouteSrc.slice(deleteStart);

  const pruneIdx = mustIndexOf(deleteBody, "await prunePrintJobs(nowMs)", "the prune call");
  const clearIdx = mustIndexOf(deleteBody, "await clearPrintHost()", "the clearPrintHost call");
  const dismissIdx = mustIndexOf(deleteBody, "await dismissQueuedPrintJobsForClearedHost(dismissedBy)", "the bulk dismiss call");

  assert.ok(clearIdx < pruneIdx, "clearPrintHost( must run FIRST — with the host doc gone, a further enqueue answers no-host and an in-flight one's post-create re-read sees the absence");
  assert.ok(pruneIdx < dismissIdx, "prunePrintJobs( must run BEFORE dismissQueuedPrintJobsForClearedHost( — the resolved sweep filters createdAt, so sweeping after the dismiss destroys the actor trail it just wrote");
});

// ═════════════════════════════════════════════════════════════════════════
// FIX 10 — dismissReason narrowed on the wire, DEGRADING not throwing
// ═════════════════════════════════════════════════════════════════════════

test("printJobResolvedRowOf: a recognised dismissReason survives untouched; an UNRECOGNISED dismissReason is OMITTED (not present, never thrown) so a stale value from an older deploy degrades the 20s pulse readback instead of 500ing it; an out-of-range STATUS is likewise OMITTED (returns null), never thrown. DELIBERATE POLICY CHANGE from fix round 1 (F-5), not a weakened assertion: this row feeds pos-pulse.ts's hottest-path 20s readback behind a Promise.all — a throw there rejected the WHOLE Promise.all, so one bad D3 row inside the 2h createdAt window took D1/D2 down too, silently, on every tick for the full 2h window; omitting the one row instead degrades one row, never a whole tick", () => {
  const known = printJobResolvedRowOf({ _id: "j1", status: "dismissed", dismissReason: "host-cleared" });
  assert.ok(known !== null, "positive landmark: a recognised row is still built, never omitted");
  assert.equal(known.dismissReason, "host-cleared");
  assert.equal(known.status, "dismissed", "positive landmark: the row was really built from the real doc");

  const unknown = printJobResolvedRowOf({ _id: "j2", status: "dismissed", dismissReason: "some-future-reason-not-yet-deployed" });
  assert.ok(unknown !== null, "positive landmark: an unrecognised dismissReason omits only the FIELD, not the whole row");
  assert.ok(!("dismissReason" in unknown), "an unrecognised dismissReason must be OMITTED from the row, never thrown on");
  assert.equal(unknown.id, "j2", "positive landmark: the row is still built — the omission is targeted, not a blinded/degenerate object");

  const badStatus = printJobResolvedRowOf({ _id: "j3", status: "queued" });
  assert.equal(badStatus, null, "an out-of-range status must be OMITTED (return null), never thrown — the mutation this catches: reverting to a throw takes the whole 20s pulse feed down for the row's full 2h retention window");
});

// ═════════════════════════════════════════════════════════════════════════
// COVERAGE A — prunePrintJobs' two deleteMany filters, per-term
// ═════════════════════════════════════════════════════════════════════════

test("PIN: prunePrintJobs calls PrintJob.deleteMany( exactly twice. Filter #1 (queued) fences on status:\"queued\" (dropping it would delete LIVE queued jobs on every enqueue) with a $lt cutoff (never $gt — a flipped operator deletes everything NEWER than the cutoff) filtering createdAt, never updatedAt. Filter #2 (resolved) fences on status:{$in:[\"printed\",\"dismissed\"]}, same $lt/createdAt discipline", () => {
  const src = stripComments(readSrc(PRINT_QUEUE_LIB));
  const fnStart = mustIndexOf(src, "export async function prunePrintJobs(", "prunePrintJobs");
  const fnEnd = mustIndexOf(src, "let lastPruneAtMs = 0;", "the boundary after prunePrintJobs");
  const fnBody = src.slice(fnStart, fnEnd);

  const deleteCalls = [...fnBody.matchAll(/PrintJob\.deleteMany\(/g)].map((m) => m.index as number);
  assert.equal(deleteCalls.length, 2, "prunePrintJobs must call PrintJob.deleteMany( exactly twice — filter #1 (queued) and filter #2 (resolved)");

  const filter1End = mustIndexOf(fnBody.slice(deleteCalls[0]), "});", "the close of filter #1's call") + deleteCalls[0] + 3;
  const filter1 = fnBody.slice(deleteCalls[0], filter1End);
  assert.match(filter1, /status:\s*"queued"/, 'filter #1 must fence on status:"queued" — dropping it deletes live queued jobs on every enqueue');
  assert.match(filter1, /\$lt:/, "filter #1's cutoff comparison must be $lt");
  assert.ok(!/\$gt:/.test(filter1), "filter #1 must never use $gt — a flipped operator deletes everything NEWER than the cutoff");
  assert.match(filter1, /createdAt:/, "filter #1 must filter createdAt");
  assert.ok(!/updatedAt/.test(filter1), "filter #1 must never filter updatedAt — no index exists on it");

  const filter2End = mustIndexOf(fnBody.slice(deleteCalls[1]), "});", "the close of filter #2's call") + deleteCalls[1] + 3;
  const filter2 = fnBody.slice(deleteCalls[1], filter2End);
  assert.match(filter2, /status:\s*\{\s*\$in:\s*\[\s*"printed",\s*"dismissed"\s*\]\s*\}/, 'filter #2 must fence on status:{$in:["printed","dismissed"]}');
  assert.match(filter2, /\$lt:/, "filter #2's cutoff comparison must be $lt");
  assert.ok(!/\$gt:/.test(filter2), "filter #2 must never use $gt");
  assert.match(filter2, /createdAt:/, "filter #2 must filter createdAt");
  assert.ok(!/updatedAt/.test(filter2), "filter #2 must never filter updatedAt");
});

// ═════════════════════════════════════════════════════════════════════════
// COVERAGE B — prunePrintJobsThrottled's assign-before-await ordering
// ═════════════════════════════════════════════════════════════════════════

test("PIN: prunePrintJobsThrottled's early-return compares against the IMPORTED PRINT_JOB_PRUNE_MIN_INTERVAL_MS constant (never a re-typed literal), and the module-level lastPruneAtMs assignment happens BEFORE the await prunePrintJobs( call — assigning first closes the two-concurrent-invocations race (both would otherwise pass the throttle check and both sweep at once)", () => {
  const src = stripComments(readSrc(PRINT_QUEUE_LIB));
  const fnStart = mustIndexOf(src, "export async function prunePrintJobsThrottled", "prunePrintJobsThrottled");
  const fnBody = src.slice(fnStart);

  const earlyReturnIdx = mustIndexOf(
    fnBody,
    "if (nowMs - lastPruneAtMs < PRINT_JOB_PRUNE_MIN_INTERVAL_MS) return;",
    "the early-return throttle check against the IMPORTED constant",
  );
  const assignIdx = mustIndexOf(fnBody, "lastPruneAtMs = nowMs;", "the assign-before-await");
  const awaitIdx = mustIndexOf(fnBody, "await prunePrintJobs(nowMs);", "the prune call");
  assert.ok(earlyReturnIdx < assignIdx, "the throttle check must run before the assignment");
  assert.ok(assignIdx < awaitIdx, "lastPruneAtMs must be assigned BEFORE the await — assigning after would let two concurrent calls both pass the check and both sweep");

  assert.match(src, /import\s*\{[^}]*PRINT_JOB_PRUNE_MIN_INTERVAL_MS[^}]*\}\s*from\s*"@pos\/shared\/print-job"/, "positive landmark: PRINT_JOB_PRUNE_MIN_INTERVAL_MS must be an IMPORTED shared constant, not a locally re-typed number");
});

// ═════════════════════════════════════════════════════════════════════════
// FIX ROUND 2 — F-1 (printJobEligibility never learned about `reprint`, so a
// cancelled order's bill reprint got a fresh queued job and was then
// dismissed at claim time — it printed nowhere)
// ═════════════════════════════════════════════════════════════════════════

test('printJobEligibility: bill reprint:true is ELIGIBLE against a Cancelled order AND against order===null — §B2 routes the cancelled-bill recovery through exactly this reprint, and the reprint carries a FRESH snapshot whose status is "Cancelled", so OrderReceipt\'s *** CANCELLED *** banner fires on the paper; order===null is equally eligible because the reprint renders from its own frozen snapshot and never needs the live Order at all (MUTATION this catches: fix round 1 added the reprint discriminator to printJobKeyOf but never taught printJobEligibility about it, so a cancelled order\'s bill reprint got a fresh queued job and was then DISMISSED at claim time by the plain order-cancelled gate — it printed nowhere)', () => {
  const reprint = payload("bill", { reprint: true });
  const cancelledOrder = { status: "Cancelled", items: [] };
  assert.deepEqual(printJobEligibility(reprint, cancelledOrder), { eligible: true }, "a bill reprint against a Cancelled order must be eligible");
  assert.deepEqual(printJobEligibility(reprint, null), { eligible: true }, "a bill reprint against order===null must be eligible — it does not need the live Order at all");
});

test('printJobEligibility: bill WITHOUT reprint is still gated — {eligible:false, reason:"order-cancelled"} against a Cancelled order, {eligible:true} against a live "Completed" order — the pairing that proves the F-1 fix is TARGETED (only reprint:true bypasses the gate), never a blanket bypass of the MERGED-02 first-time-bill rule', () => {
  const original = payload("bill");
  const cancelledOrder = { status: "Cancelled", items: [] };
  const liveOrder = { status: "Completed", items: [] };
  assert.deepEqual(
    printJobEligibility(original, cancelledOrder),
    { eligible: false, reason: "order-cancelled" },
    "a first-time (non-reprint) bill must still be dismissed for a Cancelled order — the F-1 fix must not have weakened this",
  );
  assert.deepEqual(printJobEligibility(original, liveOrder), { eligible: true }, "a first-time bill against a live open order remains eligible");
});

test('PIN: print-queue-claim.ts\'s printJobEligibility bill branch checks payload.reprint === true STRICTLY BEFORE the order === null || order.status === "Cancelled" gate (index order) — reordering these two silently restores the F-1 bug (a cancelled-order bill reprint dismissed as order-cancelled, printing nowhere); positive landmark that the ordinary cancelled-order gate is still present in the SAME case for the no-reprint path', () => {
  const claimSrc = stripComments(readSrc(PRINT_QUEUE_CLAIM_LIB));
  const fnStart = mustIndexOf(claimSrc, "export function printJobEligibility", "printJobEligibility");
  const fnEnd = mustIndexOf(claimSrc, "export interface ClaimedPrintJob", "the boundary after printJobEligibility");
  const fnBody = claimSrc.slice(fnStart, fnEnd);

  const billCaseStart = mustIndexOf(fnBody, 'case "bill":', "the bill case");
  const voidCaseStart = mustIndexOf(fnBody, 'case "void":', "the void case (marks the end of the bill case)");
  const billBody = fnBody.slice(billCaseStart, voidCaseStart);

  const reprintCheckIdx = mustIndexOf(billBody, "payload.reprint === true", "the reprint early-return check");
  const cancelledGateIdx = mustIndexOf(billBody, 'order === null || order.status === "Cancelled"', "the cancelled-order gate");
  assert.ok(
    reprintCheckIdx < cancelledGateIdx,
    "the reprint early-return must run STRICTLY BEFORE the cancelled-order gate inside the bill branch — reordering these silently restores the F-1 bug",
  );

  assert.match(billBody, /reason:\s*"order-cancelled"/, "positive landmark: the ordinary cancelled-order gate must still dismiss with order-cancelled for the no-reprint path");
});

// ═════════════════════════════════════════════════════════════════════════
// FIX ROUND 2 — F-3 + F-4 (enqueuePrintJob's post-create host re-read moved
// inside its own try/catch, and the orphan-dismiss CAS-miss path re-reads
// the row's status to avoid double-printing; F-8's ORPHAN_DISMISS_ACTOR)
// ═════════════════════════════════════════════════════════════════════════

test('PIN: enqueuePrintJob\'s post-create host re-read sits INSIDE a try { that opens AFTER PrintJob.create( (index order: PrintJob.create( < the post-create try { < the SECOND PrintHost.findOne(), and that try\'s own catch returns the "queued" outcome (duplicate:false) — MUTATION: an unguarded read after a committed write turns a successful enqueue into a 500 over a row a host will still drain; the caller gets an error instead of an outcome, and for the four keyless kinds (kot-with-round, void, moved, eod) a staff re-tap then creates a SECOND row (duplicate slip)', () => {
  const src = stripComments(readSrc(PRINT_QUEUE_LIB));
  const fnStart = mustIndexOf(src, "export async function enqueuePrintJob", "enqueuePrintJob");
  const fnEnd = mustIndexOf(src, "export type DismissPrintJobResult", "the boundary after enqueuePrintJob");
  const fnBody = src.slice(fnStart, fnEnd);

  const createIdx = mustIndexOf(fnBody, "PrintJob.create(", "the write point");
  const postCreateTryIdx = fnBody.indexOf("try {", createIdx);
  assert.ok(postCreateTryIdx >= 0, "expected a second try { AFTER PrintJob.create(");

  const hostReadIndices = [...fnBody.matchAll(/PrintHost\.findOne\(/g)].map((m) => m.index as number);
  assert.equal(hostReadIndices.length, 2, "enqueuePrintJob must call PrintHost.findOne( exactly twice");
  const secondHostReadIdx = hostReadIndices[1];

  assert.ok(createIdx < postCreateTryIdx, "the post-create try { must open AFTER PrintJob.create(");
  assert.ok(postCreateTryIdx < secondHostReadIdx, "the second PrintHost.findOne( (the post-create re-read) must sit INSIDE the post-create try block");

  const catchIdx = mustIndexOf(fnBody, "} catch {", "the post-create catch block (unparameterised, distinct from the create's own } catch (error) {)");
  assert.ok(secondHostReadIdx < catchIdx, "sanity: the re-read must textually precede its own catch");
  const catchBlock = fnBody.slice(catchIdx, catchIdx + 120);
  assert.match(catchBlock, /outcome:\s*"queued"/, 'the post-create catch must return the "queued" outcome — a transient failure here must never report the already-committed create as a failure');
  assert.match(catchBlock, /duplicate:\s*false/, "positive landmark: the catch's queued outcome carries duplicate:false");
});

test('PIN: enqueuePrintJob\'s orphan-dismiss CAS-miss path re-reads the row\'s status and returns {outcome:"already-resolved", id} only when it is "printed" — MUTATION: answering "no-host" after the HOST already claimed and printed the row authorizes a local fallback print (printJobEnqueueAllowsLocalPrint returns true ONLY for "no-host") — the same slip prints twice; positive landmark that the ordinary orphan branch (row not printed) still returns the "no-host" outcome', () => {
  const src = stripComments(readSrc(PRINT_QUEUE_LIB));
  const fnStart = mustIndexOf(src, "export async function enqueuePrintJob", "enqueuePrintJob");
  const fnEnd = mustIndexOf(src, "export type DismissPrintJobResult", "the boundary after enqueuePrintJob");
  const fnBody = src.slice(fnStart, fnEnd);

  const catchIdx = mustIndexOf(fnBody, "} catch {", "the post-create catch block (marks the end of the orphan-branch region)");
  const orphanIfIdx = mustIndexOf(fnBody, "if (!hostStillThere) {", "the orphan branch");
  assert.ok(orphanIfIdx < catchIdx, "sanity: the orphan branch must precede its enclosing try's catch");
  const orphanBlock = fnBody.slice(orphanIfIdx, catchIdx);

  assert.match(orphanBlock, /const row = await PrintJob\.findById\(createdId\)\.select\("status"\)\.lean\(\)/, "the orphan path must re-read the row's own status by id");
  assert.match(orphanBlock, /outcome:\s*"already-resolved"/, '"already-resolved" must appear in the orphan-path region');
  assert.match(orphanBlock, /id:\s*createdId/, "sanity: the already-resolved outcome carries the created row's own id, not some other job's");
  assert.match(orphanBlock, /outcome:\s*"no-host"/, 'positive landmark: the ordinary orphan branch (row not "printed") must still return the "no-host" outcome');
});

test('PIN (F-8): enqueuePrintJob\'s orphan dismiss stamps dismissedBy: ORPHAN_DISMISS_ACTOR (the neutral "system" actor), and dismissedBy: input.queuedBy is ABSENT anywhere in the file — the orphan dismiss is SERVER-INITIATED (a DELETE /api/print-host teardown racing the create), so stamping the enqueuing staff member\'s own name would falsely record them as the person who cleared the host, corrupting the SEC-7 actor trail; positive landmark that queuedBy: input.queuedBy IS still used on the PrintJob.create( call itself, proving this is a targeted pin, not a blinded region', () => {
  const src = stripComments(readSrc(PRINT_QUEUE_LIB));
  assert.ok(!/dismissedBy:\s*input\.queuedBy/.test(src), "dismissedBy must NEVER be input.queuedBy — the orphan dismiss is server-initiated, not a staff decision");
  assert.match(src, /dismissedBy:\s*ORPHAN_DISMISS_ACTOR/, "the orphan dismiss must stamp the neutral ORPHAN_DISMISS_ACTOR constant");
  assert.match(src, /queuedBy:\s*input\.queuedBy/, "positive landmark: queuedBy: input.queuedBy must still be used on PrintJob.create( — proves this isn't a blinded region");
});
