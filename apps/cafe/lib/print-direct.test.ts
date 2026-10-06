import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import mongoose from "mongoose";
import { REQUEST_TIMEOUT_MS } from "@pos/shared/api-client";
import { PRINT_LEASE_MS, directLeaseOf } from "@pos/shared/print-lifecycle";
import { stripComments } from "@/lib/source-pin-utils";
import { PRINT_JOB_KINDS } from "@pos/shared/print-job";
import { announcesQueuedJob, printsDirectAtCreation, redeliveryOf, type PrintRedeliveryRow } from "@/lib/print-direct";

// Phase 2 Session 2B (spec §7.11, plan decisions 15 and 16): direct print on the asking device. The rules are
// pure here; the creation itself is proven live (npm run verify:print:live, legs ak–am).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const T0 = Date.parse("2026-10-04T12:00:00.000Z");
const WHO = { deviceId: "dev-a", tabId: "tab-1" };
const PAYLOAD = { kind: "eod", dateKey: "2026-10-04", dateLabel: "4 Oct" };

function row(over: Partial<PrintRedeliveryRow> = {}): PrintRedeliveryRow {
  const direct = directLeaseOf({ labels: [], who: WHO, originDeviceId: "dev-a", nowMs: T0 });
  return {
    _id: new mongoose.Types.ObjectId(),
    kind: "eod",
    status: direct.status,
    label: "End of day",
    createdAt: new Date(T0),
    targetDeviceId: "dev-a",
    epoch: direct.epoch,
    attempts: direct.attempts,
    uncertainAttempts: direct.uncertainAttempts,
    nextAttemptAt: direct.nextAttemptAt,
    labels: direct.labels,
    lease: direct.lease,
    payload: JSON.stringify(PAYLOAD),
    copyIndex: 0,
    ...over,
  };
}

test("redeliveryOf: a job still leased to the asking tab, its lease running, is handed over again exactly as first sent", () => {
  const leased = row();
  const again = redeliveryOf(leased, WHO, T0 + 10_000);
  assert.ok(again !== null, "the same tab asks again while its lease runs");
  assert.deepEqual(again, {
    id: String(leased._id),
    epoch: 1,
    kind: "eod",
    label: "End of day",
    createdAt: new Date(T0).toISOString(),
    payload: PAYLOAD,
    labels: [],
    copyIndex: 0,
    attempt: 1,
  });
});

test("redeliveryOf: anything but that very lease answers as Phase 1 did (null)", () => {
  const cases: Array<[string, PrintRedeliveryRow, { deviceId: string; tabId: string }, number]> = [
    ["another tab of the device (a reload has a new id; its lease expires)", row(), { deviceId: "dev-a", tabId: "tab-2" }, T0],
    ["another device", row(), { deviceId: "dev-b", tabId: "tab-1" }, T0],
    ["a lease that ran out", row(), WHO, T0 + PRINT_LEASE_MS],
    ["a job already printed", row({ status: "printed" }), WHO, T0],
    ["a queued job (a lease expired into the queue)", row({ status: "queued" }), WHO, T0],
    ["a job sent to another device since", row({ targetDeviceId: "dev-b" }), WHO, T0],
    ["a lease from an older epoch", row({ epoch: 2 }), WHO, T0],
    ["a payload that no longer parses", row({ payload: "{" }), WHO, T0],
    ["a payload that fails the schema", row({ payload: JSON.stringify({ kind: "nope" }) }), WHO, T0],
    ["a row read without its payload", row({ payload: undefined }), WHO, T0],
  ];
  for (const [label, r, who, nowMs] of cases) assert.equal(redeliveryOf(r, who, nowMs), null, label);
});

// The 2B review gate (I-A): a re-send that arrived late could be held by a tab that then lost its drain lock,
// and print after its lease ran out, beside another window's REPRINT. A lease is handed back only within one
// request timeout of its start, so the agent's 60 s hold always starts its print inside the lease.
test("redeliveryOf: a lease is handed back only within one request timeout of its start; an older one is left to expire", () => {
  assert.ok(redeliveryOf(row(), WHO, T0 + REQUEST_TIMEOUT_MS) !== null, "a re-send within one request timeout gets the lease back");
  assert.equal(redeliveryOf(row(), WHO, T0 + REQUEST_TIMEOUT_MS + 1), null, "later: Phase 1's answer, and the lease expires into one REPRINT");
});

test("announcesQueuedJob: a new queued job is announced; never a job made leased, a job found under its key, or one its line's tab is printing past", () => {
  assert.equal(announcesQueuedJob({ created: true, status: "queued" }, false), true, "Phase 1: another device or tab prints it");
  assert.equal(announcesQueuedJob({ created: true, status: "leased" }, true), false, "made leased: the asking tab is printing it now");
  assert.equal(announcesQueuedJob({ created: true, status: "queued" }, true), false, "Pay Now's bill behind its direct KOT: the ack's more brings it");
  assert.equal(announcesQueuedJob({ created: false, status: "queued" }, false), false, "a job found under its key is not new");
});

test("PIN: the line is free only when nothing is leased or waiting on it (the lease's own line filter, one read)", () => {
  const s = src("apps/cafe/lib/print-direct.ts");
  assert.match(s, /return \(await PrintJob\.findOne\(printJobLineFilter\(deviceId, nowMs\)\)\.select\("_id"\)\.lean\(\)\) === null;/);
  assert.ok(!/PrintJob\.(create|updateOne|updateMany|deleteMany|findOneAndUpdate)\(/.test(s), "the rules write nothing");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});

// The token fix (plan 2026-10-06-token-direct-fix.md, T1): the lease fence (leaseKindFence) keeps a page from before
// S7 from leasing a token, but a slip made leased at creation never passes a lease. A token is therefore never made
// leased at creation: it is made queued, and a page that can draw it leases it at once.
test("printsDirectAtCreation: every kind but the token may be made leased at creation; a token never is", () => {
  assert.equal(printsDirectAtCreation("token"), false, "a token is made queued: the asking tab may run a page from before S7");
  for (const kind of PRINT_JOB_KINDS.filter((k) => k !== "token")) {
    assert.equal(printsDirectAtCreation(kind), true, `${kind}: direct print stays exactly as it is`);
  }
  assert.ok(PRINT_JOB_KINDS.includes("kot") && PRINT_JOB_KINDS.includes("bill"), "landmark: the kinds list still holds kot and bill");
});
