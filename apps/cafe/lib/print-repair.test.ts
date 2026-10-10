import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { PRINT_BUDGET_BUSY_DAY } from "@pos/shared/print-budget";
import { PRINT_REPAIR_WINDOW_MS } from "@pos/shared/print-lifecycle";
import { PRINT_REPAIR_BATCH, expectedKotJobs, kotRoundKeyOf, presentKotRoundsFilter } from "@/lib/print-repair";
import { printJobKeyOf } from "@/lib/print-queue";
import { kotPrintJob } from "@/lib/print-routing";
import type { Order } from "@/types";

// Printing redesign Phase 1, Session 1B: the repair sweep and where a waiting job prints after a host
// change (1A review I1 part 2). Live: npm run verify:print:live, legs z and aa.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
function inOrder(text: string, needles: string[], label: string): void {
  let at = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, at + 1);
    assert.ok(next > at, `${label}: "${needle}" must come after the step before it`);
    at = next;
  }
}

const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const MIN = 60 * 1000;

test("expectedKotJobs: only server-owned rounds fired in the last 30 min that still have lines", () => {
  const order = {
    _id: "64b7f0c2a1b2c3d4e5f60718",
    createdAt: new Date(NOW - 60 * MIN),
    kotRounds: 4,
    kotFiredAt: [new Date(NOW - 60 * MIN), new Date(NOW - 10 * MIN), new Date(NOW - 5 * MIN), new Date(NOW - MIN)],
    kotPrintDevices: ["dev-1", "", "dev-1", "dev-2"],
    items: [{ kotRound: 1 }, { kotRound: 2 }, { kotRound: 4 }],
  };
  assert.deepEqual(
    expectedKotJobs([order], NOW).map((job) => [job.round, job.deviceId]),
    [[4, "dev-2"]],
    "round 1 is too old, round 2 was printed by its tab, round 3 was wholly voided",
  );
  const fresh = { ...order, kotRounds: 1, kotFiredAt: undefined, kotPrintDevices: ["dev-1"], createdAt: new Date(NOW - MIN), items: [{ kotRound: 1 }] };
  assert.deepEqual(expectedKotJobs([fresh], NOW).map((job) => job.round), [1], "a new order's round 1 fired when it was created");
  assert.deepEqual(expectedKotJobs([{ ...fresh, kotPrintDevices: undefined }], NOW), [], "no marker: every round was printed by its tab");
  assert.deepEqual(expectedKotJobs([{ ...fresh, createdAt: new Date(NOW - 31 * MIN) }], NOW), [], "older than the stale window");
});

test("expectedKotJobs: a round whose every line skips the kitchen is never repaired; a mixed round is; a legacy line without the flag is", () => {
  const base = { _id: "64b7f0c2a1b2c3d4e5f60718", createdAt: new Date(NOW - MIN), kotRounds: 3, kotPrintDevices: ["dev-1", "dev-1", "dev-1"] };
  const order = {
    ...base,
    kotFiredAt: [new Date(NOW - MIN), new Date(NOW - MIN), new Date(NOW - MIN)],
    items: [
      { kotRound: 1, noKot: true }, // round 1: water only, no ticket was ever made
      { kotRound: 2, noKot: true },
      { kotRound: 2 }, // round 2: mixed, the kitchen got the burger
      { kotRound: 3 }, // round 3: a line from before the flag existed
    ],
  };
  assert.deepEqual(expectedKotJobs([order], NOW).map((job) => job.round), [2, 3]);
  const vision = { ...order, items: [{ kotRound: 1 }], kotRounds: 1, kotPrintDevices: ["dev-1"] };
  assert.deepEqual(expectedKotJobs([vision], NOW).map((job) => job.round), [1], "vision guard: with no skip line the round is expected, as before");
});

test("PIN: the repair selects the flag it reads", () => {
  assert.match(src("apps/cafe/lib/print-repair.ts"), /items.kotRound items.noKot/);
});

test("expectedKotJobs: the key it looks for is the one a created job carries (printJobKeyOf)", () => {
  const id = "64b7f0c2a1b2c3d4e5f60719";
  const wire = {
    _id: id, orderId: "ORD-1", customerName: "Walk-in",
    items: [{ productId: "p1", name: "Tea", price: 100, qty: 1, modifiers: [], instructions: "", kotRound: 1 }],
    subtotal: 100, discount: 0, total: 100, paidAmount: 0, payment: "Unpaid", status: "Pending", receiver: "Staff",
    kotRounds: 1, createdAt: "2026-10-02T11:59:00.000Z", updatedAt: "2026-10-02T11:59:00.000Z",
  } as unknown as Order;
  const [job] = expectedKotJobs([{ _id: id, createdAt: new Date(NOW - MIN), kotRounds: 1, kotPrintDevices: ["dev-1"], items: [{ kotRound: 1 }] }], NOW);
  assert.equal(job?.jobKey, printJobKeyOf(kotPrintJob(wire, 1).payload));
});

test("PIN: the repair reads a bounded, indexed window, skips cancelled orders, and creates only through createOrderPrintJobs", () => {
  const s = src("apps/cafe/lib/print-repair.ts");
  assert.match(s, /createdAt: \{ \$gte: new Date\(nowMs - PRINT_REPAIR_ORDER_MAX_AGE_MS\) \},/, "its own 12 h order window, never the 3 h queued retention (1D gate)");
  assert.match(s, /status: \{ \$ne: "Cancelled" \},/);
  assert.match(s, /\.limit\(PRINT_REPAIR_BATCH\)/);
  assert.match(s, /if \(deviceId === ""\) continue;/, "a round its tab printed is never re-created");
  assert.match(s, /await createOrderPrintJobs\(\{/);
  assert.ok(!/PrintJob\.(create|updateOne|updateMany|findOneAndUpdate|deleteMany)\(/.test(s), "no direct PrintJob write");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});

test("PIN: clearing the host dismisses only jobs no device asked for; the rest go back to their device, never a leased one", () => {
  const queue = src("apps/cafe/lib/print-queue.ts");
  const bulk = queue.slice(queue.indexOf("export async function dismissQueuedPrintJobsForClearedHost("), queue.indexOf("export async function prunePrintJobs("));
  assert.match(bulk, /claimedAt: \{ \$exists: false \}, originDeviceId: \{ \$exists: false \} \}/);
  const route = src("apps/cafe/app/api/print-host/route.ts");
  inOrder(route, ["await clearPrintHost()", "await dismissQueuedPrintJobsForClearedHost(dismissedBy)", "await returnPrintJobsToOrigins(nowMs);"], "DELETE /api/print-host");
  const sweep = src("apps/cafe/lib/print-sweep.ts");
  assert.match(sweep, /const WAITING: readonly string\[\] = \["queued", "needs-confirm", "failed"\];/);
  assert.match(sweep, /\$expr: \{ \$ne: \["\$targetDeviceId", "\$originDeviceId"\] \}/);
  assert.match(sweep, /originDeviceId: \{ \$exists: false \}, claimedAt: \{ \$exists: false \}/, "the no-host dismissal keeps the claim guard");
});

// Session 1B final review I1: each sweep reads the NEWEST candidates first, and most of them already
// have their jobs, so a batch smaller than a rush's half hour of active orders never reaches an older
// tab's missing round before it leaves the 30-min window. Live: leg (ac).
test("the repair batch covers a rush: a busy day's half hour at four times the average, with margin, and stays bounded", () => {
  const perWindow = (PRINT_BUDGET_BUSY_DAY.orders / PRINT_BUDGET_BUSY_DAY.openHours) * (PRINT_REPAIR_WINDOW_MS / 3_600_000);
  assert.ok(PRINT_REPAIR_BATCH >= 2 * 4 * perWindow, `batch ${PRINT_REPAIR_BATCH} vs a rush half hour of ${4 * perWindow} orders`);
  assert.ok(PRINT_REPAIR_BATCH <= 100, `batch ${PRINT_REPAIR_BATCH}: one small indexed read per sweep (spec §17)`);
});

// Session 2C (printers mode): a routed round's jobs carry `kot:<order>:<round>:<printer>:<part>`. A round with
// none of them is routed again with today's setup; a round with some is left alone (one request made them).
test("2C: the repair sees a round's jobs under today's key or any routed key, and only that round's", () => {
  assert.equal(kotRoundKeyOf("kot:o1:2"), "kot:o1:2", "simple mode");
  assert.equal(kotRoundKeyOf("kot:o1:2:p1:st-kitchen"), "kot:o1:2", "a routed station slip");
  assert.equal(kotRoundKeyOf("kot:o1:2:none:all"), "kot:o1:2", "a routed job no printer took");
  assert.equal(kotRoundKeyOf(undefined), undefined);
  const filter = presentKotRoundsFilter(["kot:o1:1", "kot:o1:2"]);
  assert.deepEqual(filter, { $or: [{ jobKey: { $regex: "^kot:o1:1(:|$)" } }, { jobKey: { $regex: "^kot:o1:2(:|$)" } }] }, "anchored prefixes on the jobKey index");
  const re = new RegExp(filter.$or[0]?.jobKey.$regex ?? "");
  assert.equal(re.test("kot:o1:10"), false, "round 1 never finds round 10's jobs");
  assert.equal(re.test("kot:o1:1:p1:all"), true);
});
