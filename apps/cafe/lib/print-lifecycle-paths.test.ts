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
      // Phase 3 (§9.3) deliberately changed the move: the writer now (failover), through print-failover.ts's one write.
      "const failover = await readPrinterFailover(printers, nowMs, true);",
      // Phase 3 (§9.4): first the slips of a printer whose device is offline go to its backup.
      "let retargeted = failover === null ? 0 : await moveToBackupPrinters(printers, failover, nowMs);",
      'retargeted += await retargetPrinterJobs(printer.id, printerActiveWriter(printer, failover) ?? "", nowMs);',
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
      "const printers = await listPrinters();",
      "const printer = routablePrinterOf(printers, row.printerId);",
      'if (printer === null) return { applied: false, status: job.status, reason: "printer-gone" };',
      // Phase 3 (§9.3) deliberately changed it: the printer's writer now (a network printer taken over).
      "target = printerActiveWriter(printer, await readPrinterFailover([printer], nowMs)) ?? target;",
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
  // Phase 3 (the token fix's M-2): a page that prints token slips says so; only true is a word.
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", tokenSlips: true }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", tokenSlips: true }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", tokenSlips: false }), false, "absent, never false");
  // Phase 3 (§9.3): "unreachable" is only a refusal before any byte (a failed connect).
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", reason: "unreachable" }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "maybe", reason: "unreachable" }), false, "a byte may have gone: not unreachable");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", permanent: true, reason: "unreachable" }), false, "a permanent failure is not about reaching it");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", reason: "unreachable" }), false);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", reason: "offline" }), false, "the one reason only");
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
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: true }).success, true, "Phase 3 (M-2): a page that prints token slips");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, tokenSlips: false }).success, false, "absent, never false");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, capabilities: { ...beat.capabilities, lanFailover: true } }).success, true, "Phase 3 (§9.3): it may take a network printer over");
  // Phase 3 (§10): the health of the printers it writes rides the heartbeat.
  const health = { printerId: "a".repeat(24), link: "connected", paper: "out", cover: "open", error: true };
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, printers: [health] }).success, true);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, printers: [{ ...health, paper: "empty" }] }).success, false, "known paper states only");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, printers: [{ ...health, error: false }] }).success, false, "an error is said, never denied");
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, printers: Array.from({ length: 13 }, () => health) }).success, false, "never more than a cafe can have");
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
  assert.match(src(ROUTES.lease), /touchPrintDevice\(parsed\.data\.deviceId, nowMs, parsed\.data\.tokenSlips === true\)/);
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
      "const tokens = parsed.data.tokenSlips === true || (await printDeviceDrawsTokens(parsed.data.deviceId));",
      "readJobsForDevice(parsed.data.deviceId, nowMs, tokens)",
      // Phase 3 (§9.3, §10) deliberately changed the count: who is online, read once, counts the agents and says who
      // writes each printer now for the health this device reports (kept only on a change).
      "readOnlinePrintDevices(nowMs)",
      "await recordPrinterHealth({ deviceId: parsed.data.deviceId, reports: parsed.data.printers, printers, failover: { online, nowMs }, nowMs }).catch(() => 0);",
      // Session 3B (the 3A review gate, M-8 d) deliberately added: a beat that says this device cannot reach a network
      // printer it writes now skips it, as an "unreachable" ack does; and the answer says which printers it took over.
      // Session 3C (the 3B review's m-2) deliberately added: the beat says whether this device may take a printer over,
      // so a candidate that cannot reach one is skipped ahead of time.
      "await skipUnreachableFromBeat({ deviceId: parsed.data.deviceId, lanFailover: parsed.data.capabilities.lanFailover === true, reports: parsed.data.printers, printers, failover: { online, nowMs }, nowMs }).catch(() => 0);",
      "const agents = Math.max(1, online.length);",
      "after(() => sweepPrintJobsThrottled(nowMs))",
      "const takenOver = printersTakenOverBy(printers, parsed.data.deviceId, { online, nowMs });",
      "...(takenOver.length > 0 ? { takenOver } : {}),",
      "return noStore(success(data));",
    ],
    "wake POST",
  );
  assert.ok(!/PrintJob\.|PrintDevice\./.test(s), "the route writes only through the libs");
});

// Session 3B (the 3A review gate, M-8 d): the beat's link is the signal for a printer a device cannot reach without a
// print; only the writer now, only a network printer, and once per skip.
test("PIN (3B): a beat's settled link starts its device's skip for a network printer it writes now and cannot reach, once, and ends it once it reaches it again", () => {
  const s = src("apps/cafe/lib/print-failover.ts");
  const start = s.indexOf("export async function skipUnreachableFromBeat(");
  assert.ok(start >= 0, "declared in lib/print-failover.ts");
  inOrder(
    s.slice(start),
    [
      "const printer = routablePrinterOf(input.printers, report.printerId);",
      'if (printer === null || printer.connection.kind !== "lan") continue;',
      'if (report.link === "connected") {',
      "if (!printerSkipEndsFor(printer, input.deviceId, input.nowMs)) continue;",
      "await endPrinterSkipOf(printer, input.deviceId, input.nowMs);",
      'if (report.link !== "disconnected") continue;',
      // Session 3C (the 3B review's m-2) deliberately changed: a device that may take the printer over is skipped ahead
      // of time too; otherwise only the printer's writer now.
      "const candidate = input.lanFailover === true && printerWriterDeviceId(printer) !== input.deviceId;",
      "if (!candidate && printerActiveWriter(printer, input.failover) !== input.deviceId) continue;",
      "if (printerSkippedWriters(printer, input.nowMs).includes(input.deviceId)) continue;",
      "await recordPrinterUnreachable({ printerId: printer.id, deviceId: input.deviceId, nowMs: input.nowMs, candidate });",
    ],
    "skipUnreachableFromBeat",
  );
  // The 3A review gate (m-D): a network printer every writer is skipped for moves its slips to its backup.
  assert.ok(s.includes("if (backup === null || printerWriterCanPrint(printer, failover) || !printerWriterCanPrint(backup, failover)) continue;"), "the backup move asks who can print, not only who is online");
  // The devices read says which device can take a network printer over (the setup page's words); Session 3C (G-1): only
  // while its own wake is fresh.
  assert.ok(src(DEVICE).includes("...(lanFailoverNow(row, nowMs) ? { lanFailover: true as const } : {}),"), "the devices read carries lanFailover");
  // Phase 3 Session 3E (spec §9.6): and whether a device writes network printers (the Windows app 1.12.0), for the form.
  assert.ok(src(DEVICE).includes("...(row.capabilities?.lan === true ? { lan: true as const } : {}),"), "the devices read carries lan");
  const form = src("apps/cafe/components/print/setup/PrinterFormDialog.tsx");
  assert.ok(form.includes("const choices = lanPrintingDevicesOf(devices, { deviceId, lan: caps.native || desktopLanApi() !== null }, draft.primaryDeviceId);"), "the form offers them as a network printer's printing device");
  assert.ok(form.includes("or the Windows app 1.12 or later on a PC, prints to a network printer."), "and says which devices can");
});

// Session 3C (G-1, the 3A review gate's exit pre-run): a lease refreshes lastSeenAt, but only the wake says lanFailover. A
// device counts as able to take a printer over only while its own wake is fresh (PrintDevice.beatAt, written in the wake's
// heartbeat write), and that write is due whenever beatAt is 30 s old, even right after a lease touched the device.
test("PIN (3C, G-1): only a device whose own wake is fresh may take a printer over; the wake's write is never starved by a lease's touch", () => {
  const s = src(DEVICE);
  const beat = s.slice(s.indexOf("export async function beatPrintDevice("), s.indexOf("export async function touchPrintDevice("));
  assert.ok(beat.includes("{ deviceId: beat.deviceId, $or: [{ lastSeenAt: { $lt: new Date(nowMs - PRINT_DEVICE_HEARTBEAT_WRITE_MS) } }, { beatAt: { $not: { $gte: due } } }] },"), "the wake's write is due on either clock");
  assert.ok(beat.includes("beatAt: new Date(nowMs),"), "the wake's write stamps beatAt");
  const touch = s.slice(s.indexOf("export async function touchPrintDevice("), s.indexOf("export async function printDeviceDrawsTokens("));
  assert.ok(touch.includes("lastSeenAt: new Date(nowMs)") && !touch.includes("beatAt"), "a lease's touch refreshes lastSeenAt, never beatAt");
  assert.ok(s.includes('.select("deviceId capabilities.lanFailover beatAt")'), "who is online reads beatAt");
  assert.ok(s.includes("lanFailover: lanFailoverNow(row, nowMs)"), "who is online counts lanFailover only from a fresh wake");
  assert.ok(s.includes("return row.capabilities?.lanFailover === true && row.beatAt !== undefined && row.beatAt.getTime() >= nowMs - PRINT_DEVICE_ONLINE_MS;"), "fresh = within the online window");
  assert.ok(src("apps/cafe/models/PrintDevice.ts").includes("beatAt: { type: Date },"), "the model keeps beatAt");
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
  assert.match(src("apps/cafe/app/api/print-jobs/lease/route.ts"), /touchPrintDevice\(parsed\.data\.deviceId, nowMs, parsed\.data\.tokenSlips === true\)\.catch\(\(\) => undefined\),/);
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
      'if (plan.patch.status === "queued") {',
      "if (input.reason === PRINT_ACK_UNREACHABLE && input.sent === \"no\" && row.printerId !== undefined) {",
      "await recordPrinterUnreachable({ printerId: row.printerId, deviceId: input.deviceId, nowMs: input.nowMs }).catch(() => null);",
      "return { applied: true, status: plan.patch.status, nextAttemptAt };",
      "const tokens = input.tokenSlips === true || (await printDeviceDrawsTokens(input.deviceId).catch(() => true));",
      "const more = await (row.printerId !== undefined ? printerLineHasMore(row.printerId, input.nowMs, tokens) : printLineHasMore(input.deviceId, input.nowMs, tokens)).catch(",
      "() => undefined,",
      "...(more !== undefined ? { more } : {})",
    ],
    "the ack",
  );
  // Phase 3 (the token fix's M-2) deliberately added the lease's kind fence to both reads.
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printJobLineFilter\(deviceId, nowMs\), \.\.\.leaseKindFence\(tokens\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "one read on the line index");
  assert.match(s, /return \(await PrintJob\.findOne\(\{ \.\.\.printerLineFilter\(printerId, nowMs\), \.\.\.leaseKindFence\(tokens\), status: "queued" \}\)\.select\("_id"\)\.lean\(\)\) !== null;/, "Session 2C: a printer job asks its own printer's line");
});

// Phase 3 Session 3A (spec §10): a printer's health is kept only from the device that writes it now, and written only
// when it says something new (or a steady one is due its 5-minute refresh): no request of its own, few writes.
test("PIN (Phase 3, §10): health is kept only from the printer's writer now, and only on a change or a due refresh", () => {
  const s = src("apps/cafe/lib/print-health.ts");
  inOrder(
    s,
    [
      "const printer = routablePrinterOf(input.printers, report.printerId);",
      "if (printer === null || printerActiveWriter(printer, input.failover) !== input.deviceId) return [];",
      "if (!printerHealthNeedsWrite(printer.health, input.deviceId, report, input.nowMs)) return [];",
      "return [Printer.updateOne(printerHealthChangedFilter(printer.id, input.deviceId, report, input.nowMs), { $set: { health } })];",
      "const results = await Promise.all(writes);",
    ],
    "the health write",
  );
  assert.match(s, /\{ "health\.at": \{ \$lt: new Date\(nowMs - PRINTER_HEALTH_REFRESH_MS\) \} \},/, "a steady state is refreshed every 5 minutes, never more often");
  assert.ok(!s.includes("connectDB(") && !s.includes("console."), "never connects, never logs");
});

// Phase 3 Session 3A (spec §9.4): only a slip that never reached paper moves to the backup printer, labelled; a slip that
// may have printed, a bill waiting for the cashier and a slip being printed stay with their own printer.
test("PIN (Phase 3, §9.4): the backup move takes only queued slips with no uncertain attempt, puts BACKUP PRINTER first, logs it, and tells the backup's writer", () => {
  const s = src("apps/cafe/lib/print-failover.ts");
  const move = s.slice(s.indexOf("export async function moveToBackupPrinters("));
  inOrder(
    move,
    [
      "const backup = printerBackupOf(printers, printer);",
      // The 3A review gate (m-D) deliberately changed the test: who can print it (online, and not skipped for it).
      "if (backup === null || printerWriterCanPrint(printer, failover) || !printerWriterCanPrint(backup, failover)) continue;",
      '{ printerId: printer.id, status: "queued", uncertainAttempts: { $in: [0, null] } }',
      "printerId: backup.id,",
      "labels: { $concatArrays: [[BACKUP_LABEL], { $filter:",
      'event: "retargeted"',
      "if (count > 0) await announcePrinterHead(backup.id, writer);",
    ],
    "the backup move",
  );
  assert.ok(!move.includes('"needs-confirm"') && !move.includes('"leased"'), "a bill waiting for the cashier and a slip being printed never move");
  assert.match(src("apps/cafe/lib/print-printers.ts"), /await Printer\.updateMany\(\{ backupPrinterId: id \}, \{ \$unset: \{ backupPrinterId: 1 \} \}\);/, "a deleted printer is nobody's backup");
});

// Phase 3 (the token fix's review, M-2): a page from before print-customization S7 cannot print a token job and its lease
// steps over one, so neither the ack's `more` nor the jobs-for-me count of the pulse and the wake may count one for it,
// or it pays an empty lease per ack and per pulse until the token goes stale. A page says so itself (Phase 3's page);
// one that does not say is answered from its device's last lease, kept on the device row by the lease's own touch.
test("PIN (Phase 3, M-2): the ack, the pulse and the wake count a token job only for a page that prints them, by its word or its device's last lease", () => {
  const device = src(DEVICE);
  assert.match(device, /tokenSlips === undefined \? \{ deviceId, \.\.\.due \} : \{ deviceId, \$or: \[due, \{ tokenSlips: \{ \$ne: tokenSlips \} \}\] \}/, "the touch writes the word only when it changed, in the one write it already makes");
  assert.match(device, /return row\?\.tokenSlips !== false;/, "unknown counts tokens, as before");
  const lease = src(LEASE);
  assert.match(lease, /\.\.\.lineJobs\(nowMs\),\s*\.\.\.leaseKindFence\(tokens\),/, "jobs-for-me: the lease's own kind fence");
  const server = src("apps/cafe/lib/print-agent-server.ts");
  assert.match(server, /return readJobsForDevice\(deviceId, nowMs, saysTokens \|\| \(await printDeviceDrawsTokens\(deviceId\)\)\);/, "the pulse reads the device row only when the page did not say");
  assert.match(src("apps/cafe/app/api/order-requests/pulse/route.ts"), /device === null \? Promise\.resolve\(null\) : readPulseJobsForDevice\(device, saysTokens, nowMs\)\.catch\(\(\) => null\)/);
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
      "[{ line: { ...printJobLineFilter(input.deviceId, input.nowMs), ...kindFence }, fence: { targetDeviceId: input.deviceId } }];",
      // Phase 3 (§9.3) deliberately changed the writer check: the device that writes it now, with one read of who is
      // online only when this device names a network printer it is not the primary of, or one a writer could not reach.
      "const printers = routablePrinters(await listPrinters());",
      // Session 3A's final review (I-1): a lease that names a network printer its device was skipped for ends that skip
      // (once its first 5 minutes are up): a page never names a printer it cannot reach.
      "const asked = await Promise.all(printers.filter((printer) => named.includes(printer.id)).map((printer) => endPrinterSkipOf(printer, input.deviceId, input.nowMs)));",
      'printer.connection.kind === "lan" && (printer.primaryDeviceId !== input.deviceId || printerSkippedWriters(printer, input.nowMs).length > 0),',
      "? await readPrinterFailover(printers, input.nowMs)",
      ": null;",
      "if (printerActiveWriter(printer, failover) === input.deviceId) {",
      "lines.push({ line: { ...printerLineFilter(printer.id, input.nowMs), ...kindFence }, fence: { printerId: printer.id }, claim: { targetDeviceId: input.deviceId } });",
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
  // Session 2G (the 2F2 review gate): the first print or lease after an order is the soak agent's (scripts/print-soak-agent.ts).
  assert.ok(soak.indexOf("refusing: the POS at --base writes") < soak.indexOf("if (await printLeased(agent, soakCall, created)) await leaseLines(agent, soakCall);"), "checked before anything else is driven");
});

test("PIN (the final Phase 3 gate, the 3G review's m-1): the soak tells its agent and both writers which printers are network printers, as a Phase 3 page knows them (a page from before Phase 3, --tokens lease, names none)", () => {
  const soak = src("apps/cafe/scripts/print-soak.ts");
  assert.ok(soak.includes('const network: ReadonlySet<string> = new Set(args.tokens === "lease" ? [] : routable.filter((p) => p.connection.kind === "lan").map((p) => p.id));'), "the setup's network printers, none for an older page");
  assert.equal(count(soak, "candidates: networkBut(lines), ...tokens, network,"), 1, "the soak's writer knows them");
  assert.equal(count(soak, "candidates: networkBut(own), ...tokens, network,"), 1, "... and the second writer");
  assert.ok(soak.includes("direct: args.direct, ...tokens, timerAt: null, network };"), "... and the soak's own agent");
  assert.ok(src("apps/cafe/scripts/print-soak-writer.ts").includes("...(w.network !== undefined ? { network: w.network } : {})"), "a writer's agent takes them");
});

test("PIN (the final Phase 3 gate, the 3G review's m-3): in printers mode the soak counts a job of its orders that no answer named (a repair or a duplicate), beside the slips with no job", () => {
  const soak = src("apps/cafe/scripts/print-soak.ts");
  inOrder(
    soak,
    [
      "const unmade = missingSlips(made, jobs);",
      "const unnamed = printersMode ? unnamedJobs(jobs, named) : [];",
      "if (unnamed.length > 0) problems.push(`${unnamed.length} job(s) no answer named (a repair or a duplicate: ${unnamed.slice(0, 3).join(\", \")})`);",
      "if (!printersMode && jobs.length !== made.length)",
    ],
    "the soak's job checks",
  );
});

test("PIN (the final Phase 3 gate, the 3G review's m-6): leg bf says its write counter is mongoose's process-wide debug hook, so the legs run one after another", () => {
  const LEG = "apps/cafe/scripts/print-host-live/skip-interplay.ts";
  const comments = readFileSync(path.join(REPO_ROOT, LEG), "utf8").replace(/\s*(\/\/|\*)\s*/g, " ").replace(/\s+/g, " ");
  assert.ok(comments.includes("mongoose's debug hook is process-wide"), "the comment says the hook is the whole process's");
  assert.ok(comments.includes("never run legs in parallel in one process"), "... and what that forbids");
  assert.ok(src(LEG).includes('mongoose.set("debug", (collection: string, method: string) => {'), "landmark: the hook it describes");
  assert.match(src("apps/cafe/scripts/verify-print-host-live.ts"), /await legBF\(/, "landmark: the runner awaits the leg");
});
