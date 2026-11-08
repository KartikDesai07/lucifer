import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  REFRESH_PRINTING_MESSAGE,
  REFRESH_PRINT_CANCEL,
  REFRESH_PRINT_CONFIRM,
  REFRESH_PRINT_QUESTION,
  REFRESH_PRINT_TITLE,
  printHoldOf,
  reloadStep,
} from "@/lib/page-refresh";
import { PRINT_STUCK_MS } from "@/lib/print-host-busy";

// P2 follow-ups R72 (finishing R67): a slip that has been printing for over 30 s is a stuck printer; Refresh then offers
// "Refresh anyway" instead of refusing for as long as it hangs.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

test("printHoldOf: free, young, stuck (older than PRINT_STUCK_MS) and waived are told apart", () => {
  assert.deepEqual(printHoldOf(null, 99_999, null), { printing: false, stuck: false, waived: false }, "no hold: free");
  assert.deepEqual(printHoldOf(1000, 1000 + PRINT_STUCK_MS - 1, null), { printing: true, stuck: false, waived: false }, "just under 30 s: young");
  assert.deepEqual(printHoldOf(1000, 1000 + PRINT_STUCK_MS, null), { printing: true, stuck: true, waived: false }, "30 s exactly: stuck");
  assert.deepEqual(printHoldOf(1000, 1000 + PRINT_STUCK_MS + 5, 1000), { printing: true, stuck: true, waived: true }, "the same hold that was confirmed: waived");
  assert.equal(printHoldOf(2000, 2000 + PRINT_STUCK_MS + 5, 1000).waived, false, "a newer hold is not covered by the older confirm");
  assert.equal(printHoldOf(null, 5, 1000).waived, false, "free: nothing to waive");
});

test("reloadStep: a young hold keeps today's toast, a stuck one asks the print question", () => {
  assert.deepEqual(reloadStep(true, null, true, false, false), { kind: "printing" }, "young hold: the toast step");
  assert.deepEqual(reloadStep(true, null, true, true, false), { kind: "ask-print" }, "stuck hold: the print question");
  assert.deepEqual(reloadStep(true, "changes", true, true, false), { kind: "ask-print" }, "the print question comes before the work question");
});

test("reloadStep: offline beats everything, even a waived stuck hold", () => {
  assert.deepEqual(reloadStep(false, "changes", true, true, false), { kind: "offline" }, "offline before the print question");
  assert.deepEqual(reloadStep(false, null, true, true, true), { kind: "offline" }, "offline after the print waiver");
});

test("reloadStep: a waived hold goes on to the work question, or the reload; unsent work still asks", () => {
  assert.deepEqual(reloadStep(true, null, true, true, true), { kind: "reload" }, "waived, nothing unsent: reload");
  assert.deepEqual(reloadStep(true, "changes", true, true, true), { kind: "ask", work: "changes" }, "waived: unsent work asks its own question");
  assert.deepEqual(reloadStep(true, "unconfirmed", true, true, true), { kind: "ask", work: "unconfirmed" }, "waived: an unconfirmed order asks with its own words");
  assert.deepEqual(reloadStep(true, null, true, false, true), { kind: "printing" }, "a young hold is never waived by the flag alone");
});

test("the print question's words are plain and true to the lifecycle", () => {
  assert.equal(REFRESH_PRINTING_MESSAGE, "A slip is printing. Refresh once it is done.", "the young-hold toast is unchanged");
  assert.equal(REFRESH_PRINT_TITLE, "Printing is taking long", "title");
  assert.equal(REFRESH_PRINT_CONFIRM, "Refresh anyway", "confirm button");
  assert.equal(REFRESH_PRINT_CANCEL, "Wait", "cancel button");
  assert.match(REFRESH_PRINT_QUESTION, /over 30 seconds/, "says how long");
  assert.match(REFRESH_PRINT_QUESTION, /marked REPRINT or DUPLICATE/, "the labels a repeat carries (printRepeatLabel)");
  assert.match(REFRESH_PRINT_QUESTION, /A bill is never printed again by itself: it waits in the Printer panel\./, "a bill waits for the cashier (needs-confirm)");
});

test("PIN: the hook reads the hold through the pure rule, so the button and the chip cannot drift", () => {
  const hook = src("apps/cafe/hooks/use-ask-first-reload.ts");
  assert.match(hook, /const since = printHostBusySince\(\);\s*const hold = printHoldOf\(since, Date\.now\(\), waived\.current\);/, "since, the clock and the waived hold go to the pure rule");
  assert.match(hook, /reloadStep\(!offline, confirmWork \? null : unsentWork\(\), hold\.printing, hold\.stuck, hold\.waived\)/, "the step is the rule's");
  assert.ok(!hook.includes("PRINT_STUCK_MS"), "the 30 s threshold lives in the pure rule alone");
  assert.ok(src("apps/cafe/lib/page-refresh.ts").includes("PRINT_STUCK_MS"), "and the pure rule uses it");
  assert.match(hook, /if \(step\.kind === "ask-print"\) \{\s*asked\.current = since;\s*setAsking\("print"\);\s*return;\s*\}/, "the stuck hold is remembered when its question opens");
  assert.match(hook, /if \(confirmPrint\) waived\.current = asked\.current;/, "confirming waives the hold the question was about, not a newer one");
  assert.match(hook, /const press = \(\) => decide\(false, false\);/, "the tap judges from scratch");
  assert.match(hook, /onConfirm: \(\) => \(asking === "print" \? decide\(false, true\) : decide\(true, false\)\),/, "each question confirms its own");
  assert.match(hook, /confirmLabel: asking === "print" \? REFRESH_PRINT_CONFIRM : "Refresh",\s*cancelLabel: asking === "print" \? REFRESH_PRINT_CANCEL : "Stay",/, "its own buttons");
  assert.match(hook, /if \(!open\) \{\s*waived\.current = null;\s*asked\.current = null;\s*setAsking\(null\);\s*\}/, "Wait / Stay closes it and forgets the waiver");
});
