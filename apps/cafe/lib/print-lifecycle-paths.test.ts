import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { ackBodySchema, confirmBodySchema, leaseBodySchema, wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";

// Printing redesign Phase 1 (plan docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md, Session 1A):
// source pins over the DB-touching lifecycle libs and routes. Behaviour is proven by the pure plans'
// tests (packages/shared/src/print-lifecycle.test.ts) and live (npm run verify:print:live, legs q–x).
// Every pin pairs its absence checks with a positive landmark, so a blinded file cannot pass.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const count = (text: string, needle: string): number => text.split(needle).length - 1;
function inOrder(text: string, needles: string[], label: string): void {
  let at = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, at + 1);
    assert.ok(next > at, `${label}: "${needle}" must come after the step before it`);
    at = next;
  }
}

const LEASE = "apps/cafe/lib/print-lease.ts";
const DEVICE = "apps/cafe/lib/print-device.ts";
const ACTIONS = "apps/cafe/lib/print-job-actions.ts";
const SWEEP = "apps/cafe/lib/print-sweep.ts";

test("PIN: every lifecycle transition is ONE compare-and-set on {_id, status, epoch}, and a lease call is bounded", () => {
  const s = src(LEASE);
  // Session 1B: the CAS may carry an extra fence (a lease: still this device's job, 1A review M5).
  // The Phase 2B gate (G-1) deliberately changed the rest: a landed transition publishes nothing, since no
  // device listened for a final state.
  assert.match(s, /PrintJob\.updateOne\(\{ \.\.\.printJobCasFilter\(id, job\), \.\.\.fence \}, printJobUpdateOf\(patch\)/);
  assert.match(s, /return res\.modifiedCount === 1;/);
  assert.ok(!s.includes("publishPrintStatus") && !s.includes("realtime-publish"), "the lifecycle's transitions publish nothing");
  // Session 2C deliberately moved the fence into each line: the device's own line is fenced on the device; a
  // printer line on its printer, and the lease claims the job for its verified writer (the 2C lease pin below).
  assert.match(s, /applyPrintJobPlan\(head\._id, job, claimed, fence\)/, "the lease CAS is fenced on its line");
  assert.match(s, /for \(let step = 0; step < LEASE_MAX_STEPS; step\+\+\)/);
  assert.match(s, /printJobEligibility\(payload, order\)/, "the claim path's live-order gate still applies to a lease");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});

test("PIN: the heartbeat writes at most once per 30 s per device, swallows only the fresh-row E11000, and a lease never creates a device", () => {
  const s = src(DEVICE);
  assert.match(s, /lastSeenAt: \{ \$lt: new Date\(nowMs - PRINT_DEVICE_HEARTBEAT_WRITE_MS\) \}/);
  assert.equal(count(s, "upsert: true"), 1, "only the wake heartbeat upserts; touchPrintDevice never does");
  assert.match(s, /if \(!isDuplicateKeyError\(error\)\) throw error;/);
  assert.match(s, /return Math\.max\(1, online\);/, "the agent count divides the wake cap, so it is never 0");
});

test("PIN: staff actions go through applyPrintJobPlan and nudge the printer only when the job is back in the queue", () => {
  const s = src(ACTIONS);
  assert.match(s, /planConfirm\(job, input\.decision, input\.staff, input\.nowMs\)/);
  assert.match(s, /planRetry\(job, input\.nowMs\)/);
  // Session 2C: the plan, plus a printer job's current writer (the R2 pin below).
  assert.match(s, /await applyPrintJobPlan\(row\._id, job, patch\)/);
  assert.equal(count(s, 'publishCafeEvent("print-job")'), 1);
  assert.match(s, /if \(plan\.patch\.status === "queued"\) publishCafeEvent\("print-job"\);/);
  assert.ok(!/PrintJob\.(create|updateOne|findOneAndUpdate|updateMany|deleteMany)\(/.test(s), "no direct PrintJob write");
});

test("PIN: the sweep's throttle claims its slot BEFORE awaiting, so two overlapping requests never both sweep", () => {
  const s = src(SWEEP);
  assert.match(s, /if \(nowMs - lastSweepAtMs < PRINT_SWEEP_MIN_INTERVAL_MS\) return;/);
  inOrder(s, ["lastSweepAtMs = nowMs;", "await sweepPrintJobs(nowMs);"], "throttle");
});

test("PIN: the sweep expires leases, routes waiting jobs to the device that prints them now, repairs, applies limits, then prunes — and nudges only when a job went back to the queue", () => {
  const s = src(SWEEP);
  // Session 1B: step 2 covers parked and failed jobs and the no-host case (1A review I1 part 2),
  // and step 2b repairs missing KOT jobs (spec §7.4).
  inOrder(
    s,
    ["planExpiry(", "await routeWaitingPrintJobs(host?.deviceId ?? null, nowMs);", "await repairMissingKotJobs(nowMs);", "planLimits(", "await prunePrintJobsThrottled(nowMs);"],
    "sweep order",
  );
  assert.equal(count(s, 'publishCafeEvent("print-job")'), 2, "the sweep's own nudge, and the host teardown's");
  assert.match(s, /if \(result\.requeued > 0 \|\| result\.retargeted > 0\) publishCafeEvent\("print-job"\);/);
  assert.equal(count(s, ".limit(PRINT_SWEEP_BATCH)"), 2, "both sweep reads are bounded");
  assert.ok(!s.includes("console."));
});

// Session 2C (printers mode): a printer job waits on its printer's line. Simple mode's moves (to the host, or
// back to the asking device) and the host teardown's dismissal never touch it; it follows its printer's writer,
// and fails visibly when its printer is gone (deleted, switched off, no writer), never guessed onto another.
test("PIN (2C): the sweep moves a waiting printer job only with its printer, and fails it when its printer is gone", () => {
  const s = src(SWEEP);
  inOrder(s, ["await routeWaitingPrintJobs(host?.deviceId ?? null, nowMs);", "routePrinterJobs(nowMs)", "await repairMissingKotJobs(nowMs);"], "sweep order");
  const simple = s.slice(s.indexOf("export async function routeWaitingPrintJobs("), s.indexOf("export async function returnPrintJobsToOrigins("));
  assert.equal(count(simple, "printerId: { $exists: false }"), 3, "neither move nor the dismissal reaches a printer job");
  const printers = s.slice(s.indexOf("export async function routePrinterJobs("), s.indexOf("export async function sweepPrintJobs("));
  inOrder(
    printers,
    [
      'status: { $in: ["queued", "needs-confirm"] } })',
      "if (waiting === null) return { retargeted: 0, failed: 0 };",
      "const printers = routablePrinters(await listPrinters());",
      "{ printerId: printer.id, status: { $in: WAITING }, targetDeviceId: { $ne: writer } }",
      "{ printerId: { $exists: true, $nin: [...printers.map((printer) => printer.id), PRINT_JOB_NO_PRINTER] }, status: \"queued\" }",
      "$set: { status: \"failed\", lastError: PRINTER_GONE_MESSAGE }",
    ],
    "routePrinterJobs",
  );
  const queue = src("apps/cafe/lib/print-queue.ts");
  const bulk = queue.slice(queue.indexOf("export async function dismissQueuedPrintJobsForClearedHost("), queue.indexOf("export async function prunePrintJobs("));
  assert.match(bulk, /printerId: \{ \$exists: false \},/, "Stop printing here never cancels a printer's slips");
});

test("PIN (2C ruling R2): Retry or Print again on a job whose printer is gone is refused; on a printer that still takes slips it goes to its current writer", () => {
  const s = src(ACTIONS);
  assert.match(s, /\.select\(`\$\{PRINT_LIFECYCLE_SELECT\} targetDeviceId printerId`\)/, "the row says which printer it is for");
  inOrder(
    s,
    [
      'if (plan.patch.status === "queued" && row.printerId !== undefined) {',
      "const printer = routablePrinterOf(await listPrinters(), row.printerId);",
      'if (printer === null) return { applied: false, status: job.status, reason: "printer-gone" };',
      "target = printerWriterDeviceId(printer) ?? target;",
      "patch = { ...plan.patch, set: { ...plan.patch.set, ...(target !== undefined ? { targetDeviceId: target } : {}) } };",
      "if (await applyPrintJobPlan(row._id, job, patch)) {",
    ],
    "the retry (the 2C gate's review, I-3: retargeted in the same write)",
  );
});

// ── Task 6: request bodies and routes ────────────────────────────────────────

test("ackBodySchema: a printed ack carries no failure fields; a failed one must say whether anything was sent", () => {
  const ok = (body: unknown): boolean => ackBodySchema.safeParse(body).success;
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed" }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", sent: "no" }), false);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed" }), false, "sent is required on a failure (spec §7.5)");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "maybe", error: "WRITE_FAILED" }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", permanent: true }), true);
  assert.equal(ok({ deviceId: "d", epoch: 0, outcome: "printed" }), false, "epoch 0 was never leased");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", extra: 1 }), false, "strict");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "maybe", error: "x".repeat(201) }), false);
  assert.equal(ok({ deviceId: "", epoch: 1, outcome: "printed" }), false);
});

test("lease, confirm and wake bodies: required fields, enums and strictness", () => {
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d", tabId: "t" }).success, true);
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d" }).success, false, "a tab id makes two windows on one PC distinguishable");
  // Session 2C: the printers this tab can print on now; at most a cafe's twelve (the lib drops anything else).
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d", tabId: "t", printerIds: ["a".repeat(24)] }).success, true);
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d", tabId: "t", printerIds: Array.from({ length: 13 }, () => "a".repeat(24)) }).success, false, "never more than a cafe can have");
  for (const decision of ["reprint", "printed", "dismiss"]) assert.equal(confirmBodySchema.safeParse({ decision }).success, true, decision);
  assert.equal(confirmBodySchema.safeParse({ decision: "maybe" }).success, false);
  const beat = {
    deviceId: "d",
    label: "Counter PC",
    shell: "windows",
    capabilities: { lan: true, bluetooth: false, usb: false, windowsPrinters: true, webSerial: false, webBluetooth: false },
  };
  assert.equal(wakeBeatBodySchema.safeParse(beat).success, true);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, appVersion: "1.2.0", nativeProtocol: 1 }).success, true);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, shell: "ios" }).success, false);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, capabilities: { ...beat.capabilities, fax: true } }).success, false, "strict capabilities");
});

const ROUTES = {
  lease: "apps/cafe/app/api/print-jobs/lease/route.ts",
  ack: "apps/cafe/app/api/print-jobs/[id]/ack/route.ts",
  confirm: "apps/cafe/app/api/print-jobs/[id]/confirm/route.ts",
  retry: "apps/cafe/app/api/print-jobs/[id]/retry/route.ts",
} as const;

test("PIN: every Phase 1 print route authenticates, is force-dynamic and no-store, and writes only through the lifecycle libs", () => {
  for (const [name, rel] of Object.entries(ROUTES)) {
    const s = src(rel);
    assert.match(s, /export const dynamic = "force-dynamic";/, name);
    assert.match(s, /const authed = await requireAuth\(\);\s*if \("error" in authed\) return authed\.error;/, name);
    assert.match(s, /await connectDB\(\);/, name);
    assert.match(s, /return noStore\(success\(/, name);
    assert.match(s, /noStore\(serverError\(/, name);
    assert.ok(!/PrintJob\./.test(s), `${name}: no model call in a route`);
    assert.ok(!s.includes("publishCafeEvent"), `${name}: nudges live in the libs (realtime-paths' print-route pin)`);
  }
  for (const name of ["ack", "confirm", "retry"] as const) {
    assert.match(src(ROUTES[name]), /if \(!mongoose\.isValidObjectId\(id\)\) return noStore\(failure\("Print job not found", 404\)\);/, name);
  }
});

test("PIN: each route calls its one lib, and a staff decision is stamped with the SESSION name, never a body field", () => {
  assert.match(src(ROUTES.lease), /leasePrintJobs\(\{/);
  assert.match(src(ROUTES.lease), /touchPrintDevice\(parsed\.data\.deviceId, nowMs\)/);
  assert.match(src(ROUTES.ack), /ackPrintJob\(\{ id, \.\.\.parsed\.data, nowMs: Date\.now\(\) \}\)/);
  assert.match(src(ROUTES.confirm), /staff: authed\.session\.user\.name \?\? UNNAMED_STAFF/);
  assert.match(src(ROUTES.retry), /retryPrintJob\(\{ id, nowMs: Date\.now\(\) \}\)/);
});

// ── Task 7: enqueue, dismiss, prune, the wake POST ───────────────────────────

const QUEUE = "apps/cafe/lib/print-queue.ts";
const ENQUEUE_ROUTE = "apps/cafe/app/api/print-jobs/route.ts";
const WAKE_ROUTE = "apps/cafe/app/api/print-jobs/wake/route.ts";

test("PIN: enqueue stamps the host target, the lifecycle fields, the initial labels and the created log; a deliberate repeat dedupes on the client's Idempotency-Key", () => {
  const s = src(QUEUE);
  assert.match(s, /PrintHost\.findOne\(\{ key: PRINT_HOST_KEY \}\)\.select\("deviceId"\)\.lean\(\);\s*if \(!host\) return \{ outcome: "no-host" \};/);
  assert.match(s, /targetDeviceId: host\.deviceId,/);
  assert.match(s, /\.\.\.printJobLifecycleInit\(nowMs, printJobInitialLabels\(input\.payload\)\),/);
  assert.match(s, /log: \[printJobCreatedLog\(nowMs, input\.originDeviceId\)\],/);
  assert.match(s, /printJobKeyOf\(input\.payload\) \?\? \(input\.idempotencyKey !== undefined \? `reprint:\$\{input\.idempotencyKey\}` : undefined\)/);
});

test("PIN: dismiss never touches a leased job (its writer may be printing it); prune reaps every unresolved state after 3 h, unless staff acted on it lately or it is still leased (a lease that runs, or ran out lately)", () => {
  const s = src(QUEUE);
  assert.match(s, /status: \{ \$in: \["queued", "needs-confirm", "failed"\] \},/);
  assert.match(s, /status: \{ \$in: \[\.\.\.PRINT_JOB_UNRESOLVED_STATUSES\] \}, createdAt: \{ \$lt: queuedPruneCutoff\(nowMs\) \}/);
  assert.match(s, /approvedAt: \{ \$not: \{ \$gte: acted \} \},/, "a slip staff tapped lately gets its try (the 1D gate)");
  assert.match(s, /"lease\.expiresAt": \{ \$not: \{ \$gte: acted \} \},/, "never deleted while its lease may still be printing");
  assert.match(s, /await prunePrintDevices\(nowMs\);/, "stale device rows go on the same throttled prune (owner, after Session 1D)");
  const device = src(DEVICE);
  assert.match(device, /PrintDevice\.deleteMany\(\{ lastSeenAt: \{ \$lt: new Date\(nowMs - PRINT_DEVICE_PRUNE_MS\) \} \}\);/, "only a device not seen for 7 days");
});

test("PIN: the enqueue route takes both Phase 1 headers as OPTIONAL (a tab from before Phase 1 sends neither) and validates each", () => {
  const s = src(ENQUEUE_ROUTE);
  assert.match(s, /const idempotencyKey = optionalHeader\(req, PRINT_IDEMPOTENCY_HEADER\);/);
  assert.match(s, /if \(idempotencyKey !== undefined && !PRINT_IDEMPOTENCY_KEY_PATTERN\.test\(idempotencyKey\)\)/);
  assert.match(s, /const originDeviceId = optionalHeader\(req, PRINT_DEVICE_ID_HEADER\);/);
  assert.match(s, /if \(originDeviceId !== undefined && originDeviceId\.length > PRINT_HOST_DEVICE_ID_MAX_CHARS\)/);
});

test("PIN: POST /api/print-jobs/wake beats, reads the device's line and the agent count, and sweeps AFTER the response", () => {
  const s = src(WAKE_ROUTE);
  const getAt = s.indexOf("export async function GET(");
  const postAt = s.indexOf("export async function POST(");
  assert.ok(getAt >= 0 && postAt > getAt, "GET first and unchanged, POST after it");
  inOrder(
    s.slice(postAt),
    [
      "validateBody(req, wakeBeatBodySchema)",
      "await connectDB();",
      "await beatPrintDevice(parsed.data, nowMs);",
      "readJobsForDevice(parsed.data.deviceId, nowMs)",
      "countOnlineAgents(nowMs)",
      "after(() => sweepPrintJobsThrottled(nowMs))",
      "return noStore(success(data));",
    ],
    "wake POST",
  );
  assert.ok(!/PrintJob\.|PrintDevice\./.test(s), "the route writes only through the libs");
});

// Session 1A final-review fixes (plan "Session 1A Results", findings I1 and I4).
test("PIN: clearing the host dismisses every unresolved job but a leased one (spec §7.1; its writer may be printing it)", () => {
  const s = src(QUEUE);
  const start = s.indexOf("export async function dismissQueuedPrintJobsForClearedHost(");
  const end = s.indexOf("export async function prunePrintJobs(");
  assert.ok(start >= 0 && end > start, "the bulk teardown is declared before prunePrintJobs");
  const bulk = s.slice(start, end);
  assert.match(bulk, /status: \{ \$in: \["queued", "needs-confirm", "failed"\] \}, claimedAt: \{ \$exists: false \}/);
  assert.ok(!bulk.includes('"leased"'), "a leased job is never torn down under its writer");
});

test("PIN: the heartbeat awaits the PrintDevice unique-index build before its first upsert (the house init() rule)", () => {
  const s = src(DEVICE);
  const start = s.indexOf("export async function beatPrintDevice(");
  const end = s.indexOf("export async function touchPrintDevice(");
  assert.ok(start >= 0 && end > start, "beatPrintDevice is declared before touchPrintDevice");
  inOrder(s.slice(start, end), ["await PrintDevice.init();", "PrintDevice.updateOne("], "beatPrintDevice");
});

// ── Session 1B: the 1A review's lease rulings and the print-status publishes ───────────────────────

test("PIN: the lease route's heartbeat is best-effort (M1), and a lease call that cleared four bad heads says when to look again (M2)", () => {
  assert.match(src("apps/cafe/app/api/print-jobs/lease/route.ts"), /touchPrintDevice\(parsed\.data\.deviceId, nowMs\)\.catch\(\(\) => undefined\),/);
  // Session 2C: per line now (leaseLineHead), so a line that cleared four bad heads gives no job and a retry time.
  assert.match(src(LEASE), /return \{ job: null, retryAt: new Date\(input\.nowMs \+ PRINT_BACKOFF_MS\[0\]\)\.toISOString\(\) \};/);
});

// The Phase 2B gate (G-1, deliberate change): a final state ("printed", "needs-confirm", "failed",
// "dismissed") had no listener on any device, so it is no longer published. Only "queued", aimed at the
// device that prints, is: the one frame an agent leases on.
test("PIN (G-1): no final state is published, from the lifecycle or a dismiss; only a queued job is announced to its printer", () => {
  assert.ok(!src(LEASE).includes("PRINT_STATUS_PUBLISHED"), "no final-status set");
  const queue = src("apps/cafe/lib/print-queue.ts");
  const single = queue.slice(queue.indexOf("export async function dismissPrintJob("), queue.indexOf("export async function dismissQueuedPrintJobsForClearedHost("));
  assert.match(single, /if \(dismissed\) \{\s*return \{ dismissed: true \};\s*\}/);
  for (const rel of ["apps/cafe/lib/print-queue.ts", "apps/cafe/lib/print-order-jobs.ts", "apps/cafe/lib/print-job-actions.ts"]) {
    for (const call of src(rel).match(/publishPrintStatus\(\{[^}]*\}\)/g) ?? []) {
      assert.match(call, /status: "queued"/, `${rel}: ${call} announces a queued job only`);
    }
  }
});

// Session 2B (plan decision 9): the ack answers whether the acking device's line holds more, so a burst ends
// with no empty lease. The hint never costs the ack itself.
test("PIN (2B): an ack that takes a job off the line answers `more` from one read of the acking device's line", () => {
  const s = src(LEASE);
  const ack = s.slice(s.indexOf("export async function ackPrintJob("), s.indexOf("export async function readJobsForDevice("));
  inOrder(
    ack,
    [
      "if (await applyPrintJobPlan(row._id, job, plan.patch)) {",
      'if (plan.patch.status === "queued") return { applied: true, status: plan.patch.status, nextAttemptAt };',
      "const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs) : printLineHasMore(input.deviceId, input.nowMs)).catch(",
      "() => undefined,",
      "...(more !== undefined ? { more } : {})",
    ],
    "the ack",
  );
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printJobLineFilter\(deviceId, nowMs\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "one read on the line index");
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printerLineFilter\(printerId, nowMs\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "Session 2C: a printer job asks its own printer's line");
});

// Session 2C (spec §7.6, §9.3; plan decision 1): a device leases its simple line and the line of each printer it
// names that it really writes (one read of the printers: routable, this device its writer), each fenced on its
// line, so a printer never has two writers and a stuck bar job never blocks the kitchen. A printer line's lease
// claims the job for its verified writer (the 2C gate's review, I-3: a re-saved printer's new writer takes its
// waiting job at once).
test("PIN (2C): a lease takes the head of the device's line and of each printer line it writes, one job per line", () => {
  const s = src(LEASE);
  const lease = s.slice(s.indexOf("export async function leasePrintJobs("), s.indexOf("export async function ackPrintJob("));
  inOrder(
    lease,
    [
      "[{ line: printJobLineFilter(input.deviceId, input.nowMs), fence: { targetDeviceId: input.deviceId } }];",
      "for (const printer of routablePrinters(await listPrinters())) {",
      "if (input.printerIds.includes(printer.id) && printerWriterDeviceId(printer) === input.deviceId) {",
      "lines.push({ line: printerLineFilter(printer.id, input.nowMs), fence: { printerId: printer.id }, claim: { targetDeviceId: input.deviceId } });",
      "const result = await leaseLineHead(line, fence, input, claim);",
    ],
    "the lease",
  );
  assert.match(src(ROUTES.lease), /printerIds: printerIdsOf\(parsed\.data\.printerIds\),/, "the route passes only real printer ids");
});

test("PIN (the Phase 1 final gate, M8): the soak drives only a local POS on a local scratch database, and stops after its first order unless that order is in its own database", () => {
  const soak = src("apps/cafe/scripts/print-soak.ts");
  assert.ok(soak.includes(String.raw`if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/pos_scratch_[a-z0-9_]+$/.test(uri)) throw new Error("refusing: not a local pos_scratch_* database");`), "a local pos_scratch_* database only");
  assert.ok(soak.includes('throw new Error("refusing: the POS at --base writes to another database than MONGODB_URI");'), "the first order must be in the soak's own database");
  assert.ok(soak.indexOf("refusing: the POS at --base writes") < soak.indexOf("await drainLine(args, cookie);"), "checked before anything else is driven");
});
