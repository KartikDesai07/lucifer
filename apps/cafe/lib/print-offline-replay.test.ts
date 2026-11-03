import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { offlineLineOfJobKey, offlineTakenAtKept, type OfflineAsk } from "@/lib/print-offline-jobs";
import { offlineReplayAnswer } from "@/lib/print-offline-replay";
import type { PrintIntent } from "@/lib/print-order-jobs";

// Printing Phase 5 (spec 2026-11-03 §5.8–5.9; plan Task 3): the replay of a request with the `offline` field, the pulse
// answer's `offlineReplay`, the stations on the printers read. The DB behaviour is proven live (leg BI).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const CREATE = "apps/cafe/app/api/orders/route.ts";
const ROUND = "apps/cafe/app/api/orders/[id]/items/route.ts";
function inOrder(text: string, needles: string[], label: string): void {
  let at = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, at + 1);
    assert.ok(next > at, `${label}: "${needle}" must come after the step before it`);
    at = next;
  }
}

const ID = "64b7f0c2a1d2e3f4a5b6c7d8";

test("offlineLineOfJobKey reads both key shapes and refuses others", () => {
  assert.deepEqual(offlineLineOfJobKey(`kot:${ID}:2`, ID, 2), { printerId: null, part: "-" }, "simple mode's key");
  assert.deepEqual(offlineLineOfJobKey(`kot:${ID}:2:p1:s1`, ID, 2), { printerId: "p1", part: "s1" }, "a routed key");
  assert.deepEqual(offlineLineOfJobKey(`kot:${ID}:2:p1:all`, ID, 2), { printerId: "p1", part: "all" }, "a full copy");
  assert.equal(offlineLineOfJobKey(`kot:${ID}:3:p1:s1`, ID, 2), null, "another round");
  assert.equal(offlineLineOfJobKey(`kot:64b7f0c2a1d2e3f4a5b6c7d9:2:p1:s1`, ID, 2), null, "another order");
  assert.equal(offlineLineOfJobKey(`bill:${ID}:p1:-`, ID, 2), null, "a bill");
  assert.equal(offlineLineOfJobKey(`reprint:${ID}:2`, ID, 2), null, "a reprint key");
  assert.equal(offlineLineOfJobKey(`kot:${ID}:2:p1`, ID, 2), null, "a key cut short");
  assert.equal(offlineLineOfJobKey(`kot:${ID}:2:p1:s1:x`, ID, 2), null, "a key with more parts");
  assert.equal(offlineLineOfJobKey(`kot:ORD-20261104-007:2`, "ORD-20261104-007", 2), null, "never the human orderId shape (the review's I3)");
});

test("offlineTakenAtKept: round 1 by createdAt, a later round by its fire time", () => {
  const t = Date.parse("2026-11-04T08:00:00.000Z");
  assert.equal(offlineTakenAtKept({ createdAt: new Date(t).toISOString() }, 1, t), true, "a new order kept its taken time");
  assert.equal(offlineTakenAtKept({ createdAt: new Date(t + 5).toISOString() }, 1, t), false, "the server's time");
  const fired = [new Date(t - 9).toISOString(), new Date(t).toISOString()];
  assert.equal(offlineTakenAtKept({ createdAt: new Date(t - 9).toISOString(), kotFiredAt: fired }, 2, t), true, "round 2 kept");
  assert.equal(offlineTakenAtKept({ createdAt: new Date(t).toISOString() }, 2, t), false, "no fire time for the round");
});

test("offlineReplayAnswer leaves every answer alone but a 200 replay of a request with the field", async () => {
  const ask: OfflineAsk = { deviceId: "dev-a", round: { ref: "O-3", takenAt: 1, lines: [] } };
  const intent: PrintIntent = { deviceId: "dev-a", bill: false };
  assert.equal(await offlineReplayAnswer(null, ask, intent, "Asha"), null, "no replay: nothing");
  const ok = new Response(JSON.stringify({ success: true, data: { _id: ID } }), { status: 200 });
  assert.equal(await offlineReplayAnswer(ok, undefined, intent, "Asha"), ok, "an online replay is today's answer");
  const refused = new Response(JSON.stringify({ success: false, error: "x" }), { status: 409 });
  assert.equal(await offlineReplayAnswer(refused, ask, intent, "Asha"), refused, "a refusal is passed on");
  const pending = new Response(JSON.stringify({ success: false, error: "x" }), { status: 503 });
  assert.equal(await offlineReplayAnswer(pending, ask, intent, "Asha"), pending, "a pending bill number is passed on");
});

test("the replay branches move untried lines to printed, then make the missing jobs, only with an offline round", () => {
  const lib = src("apps/cafe/lib/print-offline-replay.ts");
  const fn = lib.slice(lib.indexOf("export async function offlineReplayAnswer("));
  inOrder(fn, ["if (response === null || ask === undefined || intent === null || response.status !== 200) return response;", "markOfflineRoundPrinted(", "ensureOfflineRoundJobs(", "withOfflineEcho(", "offlineSlipsUnmade(error)"], "offlineReplayAnswer");
  const ensure = lib.slice(lib.indexOf("export async function ensureOfflineRoundJobs("), lib.indexOf("export async function offlineReplayAnswer("));
  assert.ok(ensure.includes("createOrderPrintJobs({") && ensure.includes("offline: input.ask,"), "the replay makes jobs with their verdicts");
  const mark = lib.slice(lib.indexOf("export async function markOfflineRoundPrinted("), lib.indexOf("export async function ensureOfflineRoundJobs("));
  assert.ok(mark.includes('status: "queued", attempts: 0'), "only a queued job never tried is read");
  assert.ok(mark.includes("applyPrintJobPlan(") && mark.includes("{ attempts: 0 }"), "one CAS per job on status, epoch and attempts 0");
  const create = src(CREATE);
  assert.ok(create.includes("if (replayed) return offlineReplayAnswer(await createReplayVerdict("), "create: the replay answer");
  assert.ok(create.includes("offlineReplayAnswer(await createReplayResponse("), "create: a twin's late replay answer");
  const round = src(ROUND);
  assert.ok(round.includes("if (replay) return offlineReplayAnswer(replay, offline.ask, intent, authed.session.user.name, key);"), "round: the replay answer");
  assert.ok(round.includes("offlineReplayAnswer(await roundReplayAfterMiss(id, key, parsed.data.items), offline.ask, intent, authed.session.user.name, key)"), "round: a twin's late replay answer");
  assert.equal(round.split("roundReplayAfterMiss(").length - 1, 1, "round: every late replay goes through lateRound");
});

test("the pulse answer says offlineReplay", () => {
  assert.ok(src("apps/cafe/app/api/order-requests/pulse/route.ts").includes("offlineReplay: true,"), "the route answers it");
  assert.ok(/offlineReplay\?: true;/.test(src("packages/shared/src/self-order-alert.ts")), "the wire type declares it");
});

test("the printers read answers the stations only when asked", () => {
  const route = src("apps/cafe/app/api/printers/route.ts");
  assert.ok(route.includes("export async function GET(req: Request) {"), "the handler takes the request (the review's m9)");
  assert.ok(route.includes('new URL(req.url).searchParams.get("stations") === "1"'), "only ?stations=1");
  assert.ok(route.includes("success({ printers, stations })"), "the object answer");
  assert.ok(route.includes("success(await listPrinters())"), "the plain read is today's array");
});
