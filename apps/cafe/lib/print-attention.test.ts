import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PRINT_KOT_ALARM_MS } from "@pos/shared/print-lifecycle";
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS } from "@pos/shared/print-agent-wire";
import { PRINT_JOB_QUEUED_RETENTION_MS } from "@pos/shared/print-job";
import { stripComments } from "@/lib/source-pin-utils";
import { printAttentionFilter, printAttentionRowOf } from "@/lib/print-attention";

// Printing Phase 1 Session 1D (spec §10): the waiting-slips feed on the existing 20 s pulse (one bounded
// read), the pulse sweep (D2), and staff Retry / Print again aimed at the printing device (D7). DB
// behaviour is proven live (npm run verify:print:live, legs af–ag); these are the pure parts and pins.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const T0 = Date.parse("2026-10-03T12:00:00.000Z");
const at = (ms: number): Date => new Date(ms);

test("printAttentionFilter: bills to check and failed slips from the last 3 h, and every slip still queued 20 s after it was made", () => {
  assert.deepEqual(printAttentionFilter(T0), {
    $or: [
      { status: { $in: ["needs-confirm", "failed"] }, createdAt: { $gte: at(T0 - PRINT_ATTENTION_WINDOW_MS) } },
      { status: "queued", createdAt: { $gte: at(T0 - PRINT_ATTENTION_WINDOW_MS), $lte: at(T0 - PRINT_KOT_ALARM_MS) } },
    ],
  });
  assert.equal(PRINT_ATTENTION_WINDOW_MS, PRINT_JOB_QUEUED_RETENTION_MS, "the queued retention (§7.8, 3 h): nothing older is still waiting");
  assert.equal(PRINT_ATTENTION_LIMIT, 20, "a bounded read on the hottest poll");
});

test("PIN (owner, after Session 1D: I-1 option A): the feed reads the NEWEST rows on the same index and shows them oldest first", () => {
  const lib = src("apps/cafe/lib/print-attention.ts");
  assert.match(lib, /\.sort\(\{ createdAt: -1, _id: -1 \}\)/, "newest first: a new problem is never cut off by an old backlog");
  assert.ok(!lib.includes("sort({ createdAt: 1"), "never the oldest rows (they kept every new failure out once 20 waited)");
  assert.match(lib, /const rows = docs\s*\.reverse\(\)/, "shown oldest first");
  assert.match(lib, /approvedAt"\)/, "the row says when staff already tapped it");
});

test("printAttentionRowOf: a slip staff already tapped says so (it waits for its printer, not for a tap)", () => {
  const row = printAttentionRowOf({ _id: "j5", kind: "kot", label: "KOT round 1 · T-1", status: "queued", createdAt: at(T0), approvedAt: at(T0 + 60_000) });
  assert.equal(row?.approved, true, "approvedAt becomes approved: true");
  const plain = printAttentionRowOf({ _id: "j6", kind: "kot", label: "KOT round 1 · T-1", status: "queued", createdAt: at(T0) });
  assert.equal(plain !== null && "approved" in plain, false, "omit-empty");
});

test("printAttentionRowOf: a panel row says what, when, why, who asked and where it prints; nothing else reaches the wire", () => {
  const row = printAttentionRowOf({
    _id: "j1",
    kind: "kot",
    label: "KOT round 1 · T-4",
    status: "queued",
    labels: ["REPRINT"],
    createdAt: at(T0),
    lastError: "The printer is not connected.",
    originDeviceId: "dev-2",
    targetDeviceId: "dev-1",
  });
  assert.deepEqual(row, {
    id: "j1",
    kind: "kot",
    label: "KOT round 1 · T-4",
    status: "queued",
    labels: ["REPRINT"],
    createdAt: "2026-10-03T12:00:00.000Z",
    lastError: "The printer is not connected.",
    originDeviceId: "dev-2",
    targetDeviceId: "dev-1",
  });
  const bare = printAttentionRowOf({ _id: "j2", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", createdAt: at(T0) });
  assert.deepEqual(bare, { id: "j2", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", labels: [], createdAt: "2026-10-03T12:00:00.000Z" }, "omit-empty");
  assert.equal(printAttentionRowOf({ _id: "j3", kind: "kot", label: "x", status: "printed", createdAt: at(T0) }), null, "a status the panel never shows is dropped, never thrown");
  assert.equal(printAttentionRowOf({ _id: "j4", kind: "kot", label: "x", status: "leased", createdAt: at(T0) }), null, "a slip printing right now waits for nobody");
});

test("PIN: the pulse reads the waiting-slips feed for every tab, fail-soft; printJobsForMe stays the named agent's", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /readPrintAttention\(nowMs\)\.catch\(\(\) => null\)/, "every device shows the panel and its count");
  assert.match(s, /device === null \? Promise\.resolve\(null\) : readJobsForDevice\(device, nowMs\)\.catch\(\(\) => null\)/, "1C's printJobsForMe is kept");
  assert.ok(s.includes("...(printJobsForMe === null ? {} : { printJobsForMe }),"), "printJobsForMe is omitted on a failed read");
  assert.ok(
    s.includes("...(attention === null ? {} : { printAttention: attention.rows, printAttentionTruncated: attention.truncated }),"),
    "the feed is omitted on a failed read",
  );
  assert.equal(s.split("readPrintAttention(").length - 1, 1, "one read per pulse, not one per device or per row");
});

test("PIN (D2): the pulse sweeps after its answer, throttled, and the route itself writes nothing", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /after\(\(\) => sweepPrintJobsThrottled\(nowMs\)\);/, "with no host the pulse is the only request that runs the sweep");
  assert.ok(s.indexOf("after(() => sweepPrintJobsThrottled(nowMs));") > s.indexOf("readPosPulse()"), "the sweep runs after the reads it must never delay");
  for (const write of ["updateOne(", "updateMany(", "create(", "findOneAndUpdate(", "prunePrintJobs", "pruneOrderRequests", "sweepPrintJobs("]) {
    assert.ok(!s.includes(write), `the pulse route itself writes nothing: no ${write}`);
  }
  const lib = src("apps/cafe/lib/print-attention.ts");
  for (const write of ["updateOne(", "updateMany(", ".create(", "findOneAndUpdate(", "connectDB("]) {
    assert.ok(!lib.includes(write), `print-attention.ts only reads: no ${write}`);
  }
  assert.match(lib, /\.limit\(PRINT_ATTENTION_LIMIT\)/, "bounded by a named constant");
});

test("PIN (D7): a staff Retry or Print again announces its job to the device that prints it", () => {
  const s = src("apps/cafe/lib/print-job-actions.ts");
  assert.match(s, /\.select\(`\$\{PRINT_LIFECYCLE_SELECT\} targetDeviceId`\)/, "the row says where it prints");
  assert.match(s, /if \(plan\.patch\.status === "queued"\) publishCafeEvent\("print-job"\);/, "the host still hears the broadcast nudge");
  assert.match(
    s,
    /if \(plan\.patch\.status === "queued"\) publishPrintStatus\(\{ id, status: "queued", \.\.\.\(row\.targetDeviceId \? \{ target: row\.targetDeviceId \} : \{\}\) \}\);/,
    "aimed: with no host only that device's agent leases on it (it ignores the broadcast)",
  );
});
