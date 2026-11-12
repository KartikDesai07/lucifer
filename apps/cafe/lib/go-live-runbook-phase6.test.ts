// Printing Phase 6 Session 6B Task 15: the Phase 6 release step in docs/GO-LIVE-CHECKLIST.md (spec 2026-11-03 §5, P6-3,
// P6-4, §9 ruling 27) and the owner's real-printer checks in apps/mobile/TEST-CHECKLIST.md. Its own file:
// lib/go-live-runbook.test.ts is past the 300-line rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const doc = readFileSync(path.join(REPO_ROOT, "docs/GO-LIVE-CHECKLIST.md"), "utf8");
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

function sectionSlice(heading: string): string {
  const start = doc.indexOf(heading);
  assert.ok(start >= 0, `could not find the heading "${heading}" in GO-LIVE-CHECKLIST.md`);
  const next = doc.slice(start + heading.length).match(/\n(#{1,3}\s|---)/);
  return doc.slice(start, next ? start + heading.length + next.index! : doc.length);
}

const PHASE6_STEP = "### Existing cafes: the printing Phase 6 release";
const PHASE6_CHECKS = "## Phase 6 checks (parallel printing)";
const step = () => norm(sectionSlice(PHASE6_STEP));

test("PIN §1 (printing Phase 6): the release step keeps its order (the web first, every screen reloaded, the demo cafe for some days with the Phase 6 checks, two Bluetooth printers on one phone only after the owner's check, then the clients, the rollback) and changes no Worker, no data and no app", () => {
  const text = step();
  let at = -1;
  for (const landmark of [
    "**The web first.**",
    "**Reload every POS screen**",
    "**Then the demo cafe**",
    "for some days",
    "Phase 6 checks (parallel printing)",
    "**A cafe where one phone prints two Bluetooth printers gets Phase 6 only after the owner's check on such a phone**",
    "stays on the build before Phase 6",
    "**Then the clients**",
    "**If you roll the web back:**",
  ]) {
    const next = text.indexOf(landmark, at + 1);
    assert.ok(next > at, `the Phase 6 release step names "${landmark}" after the one before it`);
    at = next;
  }
  for (const phrase of ["**no Worker change**", "no data migration", "no app release", "**The paper does not change**"]) {
    assert.ok(text.includes(phrase), `the Phase 6 release step says ${phrase}`);
  }
});

test("PIN §1 (printing Phase 6, P6-3): the step states the lease cost plainly", () => {
  const text = step();
  for (const phrase of [
    "asks for each printer's next slip as soon as that printer is free",
    "up to about 1.5 times the lease requests",
    "never more than one per slip printed",
  ]) {
    assert.ok(text.includes(phrase), `the Phase 6 release step says "${phrase}"`);
  }
});

test("PIN §1 (printing Phase 6): the step's measured times are the 6B numbers", () => {
  const text = step();
  for (const phrase of ["3.7 s instead of 7.9 s", "at 1.2 s and 1.7 s instead of after 63 s"]) {
    assert.ok(text.includes(phrase), `the Phase 6 release step quotes the measured "${phrase}"`);
  }
});

test("PIN (printing Phase 6, P6-4): TEST-CHECKLIST's Phase 6 checks hold the owner's real-printer checks", () => {
  const checklist = norm(readFileSync(path.join(REPO_ROOT, "apps/mobile/TEST-CHECKLIST.md"), "utf8"));
  const phase5 = checklist.indexOf("## Phase 5 checks (offline KOTs)");
  const start = checklist.indexOf(PHASE6_CHECKS);
  const end = checklist.indexOf("## Result");
  assert.ok(phase5 >= 0, "the Phase 5 checks exist");
  assert.ok(start > phase5, "the Phase 6 checks come after the Phase 5 checks");
  assert.ok(end > start, "the Phase 6 checks come before the Result block");
  const checks = checklist.slice(start, end);
  for (const phrase of [
    "two Bluetooth printers",
    "a network printer",
    "A three-station round from that phone",
    "switched off before Send",
    "with no REPRINT label",
    "two copies",
    "two identical slips",
    "the bill prints once",
    "Ten rounds in a row",
    "The owner's notes",
    "gets Phase 6 only after this passes on such a phone",
  ]) {
    assert.ok(checks.includes(phrase), `the Phase 6 checks name "${phrase}"`);
  }
});
