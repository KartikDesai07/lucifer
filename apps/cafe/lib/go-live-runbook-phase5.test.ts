// Printing Phase 5 Session 5C Task 24: the Phase 5 release step in docs/GO-LIVE-CHECKLIST.md (spec 2026-11-03 §7), the
// §7 device step's calm-pulse sentence (spec §5.11) and the owner's real-printer checks in apps/mobile/TEST-CHECKLIST.md
// (spec §9 item 6). Its own file: lib/go-live-runbook.test.ts is past the 300-line rule. Every sentence the page shows is
// quoted from the code's own constant, so a wording change without a doc change fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OFFLINE_LABEL, OFFLINE_TAKEN_MAX_AGE_MS } from "@pos/shared/offline-kot";
import { REFETCH_INTERVALS } from "@pos/shared/query";
import { OFFLINE_HEADER_KEEPING, OFFLINE_HEADER_PRINTING, OFFLINE_NEEDS_INTERNET, offlineEodWarning } from "@/lib/offline-guard";
import type { OfflineLinePlan } from "@/lib/offline-lines";
import { OFFLINE_CHIP_PREFIX, OFFLINE_PRINT_HERE_WARNING } from "@/lib/offline-orders-view";
import { REPLAY_WAITING_MESSAGE, replaySentMessage } from "@/lib/offline-replay";
import { offlineKeptMessage } from "@/lib/offline-send";
import { PAY_OFFLINE_NOTE } from "@/lib/payment-result";
import { SEND_PARKED } from "@/lib/pos-send";
import type { PrintJobRequest } from "@/lib/print-routing";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const doc = readFileSync(path.join(REPO_ROOT, "docs/GO-LIVE-CHECKLIST.md"), "utf8");
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

function sectionSlice(heading: string): string {
  const start = doc.indexOf(heading);
  assert.ok(start >= 0, `could not find the heading "${heading}" in GO-LIVE-CHECKLIST.md`);
  const next = doc.slice(start + heading.length).match(/\n(#{1,3}\s|---)/);
  return doc.slice(start, next ? start + heading.length + next.index! : doc.length);
}

const PHASE5_STEP = "### Existing cafes: the printing Phase 5 release";
const PHASE5_CHECKS = "## Phase 5 checks (offline KOTs)";
const DEVICE_STEP = "### Self-order alerts and auto-print (CR2.3 + print host, per device)";
const step = () => norm(sectionSlice(PHASE5_STEP));
const line = (here: boolean): OfflineLinePlan => ({ printerId: "p1", part: "s1", copies: 1, request: {} as PrintJobRequest, here });

test("PIN §1 (printing Phase 5): the release step keeps its order (the web first with no paper change, every screen reloaded, the demo cafe for some days with the Phase 5 checks, then the clients) and changes no Worker, no data and no app", () => {
  const text = step();
  let at = -1;
  for (const landmark of [
    "**The web first.**",
    "no paper changes online",
    "**Reload every POS screen**",
    "**Then the demo cafe**",
    "for some days",
    "Phase 5 checks (offline KOTs)",
    "**Then the clients**",
    "**Do not refresh or close the POS app during an outage:**",
    "**End of day only when every device's Offline orders list is empty.**",
    "**If you roll the web back**",
  ]) {
    const next = text.indexOf(landmark, at + 1);
    assert.ok(next > at, `the Phase 5 release step names "${landmark}" after the one before it`);
    at = next;
  }
  for (const phrase of ["**no Worker change**", "no data migration", "no app release"]) {
    assert.ok(text.includes(phrase), `the Phase 5 release step says ${phrase}`);
  }
});

test("PIN §1 (printing Phase 5, spec §7): the step states the outage rules: no refresh, End of day, the rollback, the person signed in, the round label, the kept time", () => {
  const text = step();
  for (const phrase of [
    "a page that reloads without the internet cannot open until it is back",
    "Could not open the POS",
    "End of day only when every device's Offline orders list is empty",
    "first make sure every device's Offline orders list is empty",
    "an order sent after the outage is saved for the person signed in then",
    "a round added offline to a tab may be printed as Round n and saved as Round n + 1 when another device added one meanwhile",
    "the first order after the internet goes is often one",
  ]) {
    assert.ok(text.includes(phrase), `the Phase 5 release step says "${phrase}"`);
  }
  assert.equal(OFFLINE_TAKEN_MAX_AGE_MS, 12 * 60 * 60 * 1000, "the kept taken time's limit is still 12 hours");
  assert.ok(text.includes("kept for more than 12 hours, or sent on another day, is saved at the time it is sent"), "the step states the 12-hour limit of the kept taken time");
});

test("PIN §1 (printing Phase 5): the step quotes the page's own words, from the code's constants", () => {
  const text = step();
  const quoted: [string, string][] = [
    ["the paper's banner", `**${OFFLINE_LABEL} · O-1**`],
    ["the printing device's header", OFFLINE_HEADER_PRINTING],
    ["a device with nothing to print's header", OFFLINE_HEADER_KEEPING],
    ["the send's words", offlineKeptMessage({ ref: "O-1", sale: false, plan: [line(true)], print: true, nameOf: () => "Kitchen" })],
    ["a waiter phone's words", offlineKeptMessage({ ref: "O-1", sale: false, plan: [line(false)], print: true, nameOf: () => "Kitchen" })],
    ["the pay sheet's note", PAY_OFFLINE_NOTE],
    ["the Open tabs chip", `${OFFLINE_CHIP_PREFIX}O-1`],
    ["the end of the replay", replaySentMessage(2)],
    ["what waits for the internet", OFFLINE_NEEDS_INTERNET],
    ["End of day's block", offlineEodWarning(1)],
    ["the half-way send's words", SEND_PARKED],
    ["Print KOT here's warning", OFFLINE_PRINT_HERE_WARNING],
    ["an older server", REPLAY_WAITING_MESSAGE],
  ];
  for (const [what, words] of quoted) assert.ok(text.includes(norm(words)), `the step quotes ${what} verbatim: "${words}"`);
});

test("PIN §1 (printing Phase 5, spec §5.11): the calm check's numbers match the pulse's constants (20 s lively, a minute calm, the alarm 20–40 s on the sender and up to about 80 s elsewhere)", () => {
  const text = step();
  const lively = REFETCH_INTERVALS.POS_PULSE / 1000;
  assert.equal(REFETCH_INTERVALS.POS_PULSE_CALM, 60 * 1000, "the calm pulse is still one minute");
  assert.ok(text.includes(`every ${lively} seconds while anything needs it`), "the step states the lively interval");
  assert.ok(text.includes("once a minute when the cafe is quiet"), "the step states the calm interval");
  assert.ok(text.includes(`${lively}–${2 * lively} seconds after it on the device that sent it`), "the alarm on the device that sent the slip");
  assert.ok(text.includes(`up to about ${lively + REFETCH_INTERVALS.POS_PULSE_CALM / 1000} seconds after it on the others`), "the alarm on the other devices");
});

test("PIN §7 (printing Phase 5): the device step's 20-second fallback gains the calm sentence, after it", () => {
  const text = norm(sectionSlice(DEVICE_STEP));
  const fallback = text.indexOf("if the counter is a browser tab and that tab is hidden it falls back to the 20-second refresh.");
  const calm = text.indexOf("That refresh slows to once a minute while the cafe is quiet and the live connection is proven (printing Phase 5).");
  assert.ok(fallback >= 0, "the 20-second fallback sentence stays");
  assert.ok(calm > fallback, "the calm sentence follows it");
  assert.equal(REFETCH_INTERVALS.POS_PULSE_CALM, 60 * 1000, "once a minute is POS_PULSE_CALM");
});

test("PIN (printing Phase 5, spec §9 item 6): TEST-CHECKLIST's Phase 5 checks hold the owner's real-printer checks", () => {
  const checklist = norm(readFileSync(path.join(REPO_ROOT, "apps/mobile/TEST-CHECKLIST.md"), "utf8"));
  const start = checklist.indexOf(PHASE5_CHECKS);
  const end = checklist.indexOf("## Result");
  assert.ok(start >= 0 && end > start, "the Phase 5 checks come before the Result block");
  const checks = checklist.slice(start, end);
  for (const phrase of [
    "the demo cafe",
    "Unplug the router's internet mid-service",
    // 5C review m3: an idle calm screen notices a real outage in up to about three minutes (two missed pulses).
    "within about three minutes on a screen left alone",
    "an order sent before its screen turned amber is kept as a half-way send and does not print by itself",
    "a new table, a round on a tab opened before the outage and a Pay Now",
    "on the counter and on a printing phone",
    `**${OFFLINE_LABEL} · O-1**`,
    "a waiter phone",
    "Plug the internet back",
    replaySentMessage(3),
    "no second KOT",
    "the orders, their KOT numbers, the bills and the totals",
    "End of day only after every device's Offline orders list is empty",
  ]) {
    assert.ok(checks.includes(phrase), `the Phase 5 checks name "${phrase}"`);
  }
});
