import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ApiError } from "@/lib/api-client";
import { stripComments } from "@/lib/source-pin-utils";
import { ACTION_ERROR, CLEAR_ALL_FAILED, clearAllErrorOf, rowAnswerNoticeOf, rowErrorNoticeOf } from "@/lib/print-job-notices";

// PX-2 Task 4 (spec §6.3, §6.9 B8, F-M2): what the Not printed card says after a tap, pure. The card's own hook toasts
// these; the dashboard band keeps its own words (R10).

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const READY = "It prints as soon as the printer is ready.";
const CONNECTION = "That did not go through. Check the connection and try again.";

test("Try again / Print now applied: it prints as soon as the printer is ready", () => {
  for (const action of ["try-again", "print-now"] as const) {
    assert.deepEqual(rowAnswerNoticeOf(action, { applied: true, status: "queued" }), { text: READY, tone: "info", drop: false }, `${action} applied`);
  }
});

test("a tap the server did not apply keeps today's words (printRetryNotice)", () => {
  assert.deepEqual(
    rowAnswerNoticeOf("print-now", { applied: false, status: "queued", reason: "wrong-status" }),
    { text: "It prints by itself as soon as the printer is ready.", tone: "info", drop: false },
    "already waiting for its printer",
  );
  assert.deepEqual(
    rowAnswerNoticeOf("try-again", { applied: false, status: "failed", reason: "printer-gone" }),
    { text: "No printer takes this slip now (removed, switched off, or none set up). Print it again from its order.", tone: "info", drop: false },
    "never guessed onto another printer",
  );
  assert.deepEqual(rowAnswerNoticeOf("print-again", { applied: false, status: "printed", reason: "wrong-status" }), { text: "Already handled.", tone: "info", drop: false }, "a bill someone else settled");
});

test("a confirm's answer says nothing when it applied", () => {
  assert.equal(rowAnswerNoticeOf("print-again", { applied: true, status: "queued" }), null, "Print again applied: the row's new words come from the next pulse");
  assert.equal(rowAnswerNoticeOf("it-printed", { applied: true, status: "printed" }), null, "It printed applied: the row leaves on the next pulse");
});

test("Clear: the row just leaves; a slip an old print host already took says it is printing", () => {
  assert.equal(rowAnswerNoticeOf("clear", { dismissed: true }), null, "cleared: no words, the row leaves at once");
  assert.deepEqual(rowAnswerNoticeOf("clear", { dismissed: false, reason: "raced" }), { text: "This slip is printing right now.", tone: "info", drop: false }, "raced: it stays");
});

test("an enveloped 404 on any row action: the slip is gone, the row leaves", () => {
  const gone = new ApiError("Print job not found", "http", 404, true);
  assert.deepEqual(rowErrorNoticeOf(gone), { text: "This slip is no longer waiting.", tone: "info", drop: true }, "the app's own 404");
});

test("a host-level 404 (enveloped false) or any other error: the connection words, the row stays (F-M2)", () => {
  const expected = { text: CONNECTION, tone: "error", drop: false };
  assert.deepEqual(rowErrorNoticeOf(new ApiError("Request failed", "http", 404, false)), expected, "a deploy's 404 page proves nothing about the slip");
  assert.deepEqual(rowErrorNoticeOf(new ApiError("Failed to dismiss print job", "http", 500, true)), expected, "a server error");
  assert.deepEqual(rowErrorNoticeOf(new ApiError("Could not reach the server.", "network", null)), expected, "no answer");
  assert.deepEqual(rowErrorNoticeOf(new Error("boom")), expected, "anything else");
  assert.deepEqual(rowErrorNoticeOf(undefined), expected, "even nothing at all");
});

test("Clear all: a 404 (an older server) says clear them one by one; anything else, the connection words", () => {
  assert.equal(CLEAR_ALL_FAILED, "Could not clear all. Clear them one by one.", "the spec's words");
  assert.equal(clearAllErrorOf(new ApiError("Request failed", "http", 404, false)), CLEAR_ALL_FAILED, "an older server has no such route");
  assert.equal(clearAllErrorOf(new ApiError("Print job not found", "http", 404, true)), CLEAR_ALL_FAILED, "any 404");
  assert.equal(clearAllErrorOf(new ApiError("Print job not found", "http", 400, true)), CONNECTION, "a 400 is not an older server");
  assert.equal(clearAllErrorOf(new Error("boom")), CONNECTION, "anything else");
});

test("the connection words are the band's, word for word (R10: the band's hook keeps its own copy)", () => {
  assert.equal(ACTION_ERROR, CONNECTION, "the panel's words");
  const band = readFileSync(path.join(CAFE, "hooks/use-print-job-actions.ts"), "utf8");
  assert.ok(band.includes(`const ACTION_ERROR = "${CONNECTION}";`), "the band still says the same");
});

test("PIN: the panel's own hook: one request per tap, then the agent's kick and one pulse read; a Clear edits the cache first (R10)", () => {
  const hook = stripComments(readFileSync(path.join(CAFE, "hooks/use-not-printed-actions.ts"), "utf8"));
  assert.match(hook, /kickPrintAgent\(\);\s*void qc\.invalidateQueries\(\{ queryKey: POS_PULSE_KEYS\.all \}\);/, "today's settled: the agent woken, the pulse read once");
  assert.ok(!/useMutation|usePrintJobActions|useDismissPrintJob|refetchInterval|setInterval|router\.refresh/.test(hook), "apiSend itself: no hook-level toast, no poll");
  assert.ok(hook.includes("qc.setQueryData<PosPulseData>(POS_PULSE_KEYS.all, (data) => withoutAttentionRows(data, gone));"), "the row leaves the cache at once");
  assert.ok(hook.includes('apiSend<{ dismissed: number }>("/api/print-jobs/dismiss", "POST", { ids: [...ids], reason: STAFF })'), "Clear all is ONE request");
  assert.match(hook, /\.then\(\s*\(\) => drop\(ids\),[\s\S]*?\.finally\(settled\)/, "Clear all: the cache first, then the one read");
  const section = stripComments(readFileSync(path.join(CAFE, "components/print/NotPrintedSection.tsx"), "utf8"));
  assert.ok(section.includes("useNotPrintedActions()") && !section.includes("usePrintJobActions"), "the panel uses its own hook; the band keeps its");
});
