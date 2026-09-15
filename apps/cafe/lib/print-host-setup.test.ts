import { test } from "node:test";
import assert from "node:assert/strict";

import {
  KIOSK_ARGS,
  kioskShortcutBat,
  shortcutTargetString,
  WIZARD_STEPS,
  WIZARD_TROUBLESHOOTING,
} from "./print-host-setup";

// Print-standardization plan (.claude/plan/v2/print-standardization-plan.md
// §B3, slice A1) — DB-free, DOM-free unit tests for the pure kiosk-shortcut
// template + wizard copy constants, mirroring lib/print-routing.test.ts's
// header/import idiom. No mongod, no connectDB, no DOM anywhere in this file.

const ORIGIN = "https://example-cafe.example.com";

// The banned cafe-name literal is built from split fragments so this test
// file itself never contains the contiguous word (spec requirement, and the
// same discipline appearance-paths-2.test.ts documents for banned strings
// scanned by OTHER gates walking this file).
const BANNED_CAFE_NAME = ["L", "u", "c", "i", "f", "e", "r"].join("");

// ── KIOSK_ARGS / shortcutTargetString ───────────────────────────────────────

test("KIOSK_ARGS: embeds the origin exactly once via --app=<origin>/requests, carries --user-data-dir=, and --kiosk-printing exactly once", () => {
  const args = KIOSK_ARGS(ORIGIN);
  assert.ok(args.includes(`--app=${ORIGIN}/requests`), "must carry --app=<origin>/requests");
  assert.ok(args.includes("--user-data-dir="), "must carry --user-data-dir=");
  const kioskCount = args.split("--kiosk-printing").length - 1;
  assert.equal(kioskCount, 1, `expected --kiosk-printing exactly once, found ${kioskCount}`);
});

test("shortcutTargetString: quoted browser path + one space + KIOSK_ARGS(origin) — single source, never a re-typed literal", () => {
  const browserPath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const target = shortcutTargetString(ORIGIN, browserPath);
  assert.equal(target, `"${browserPath}" ${KIOSK_ARGS(ORIGIN)}`);
  assert.ok(target.startsWith(`"${browserPath}"`), "the browser path must be quoted");
});

// ── kioskShortcutBat ─────────────────────────────────────────────────────

test("kioskShortcutBat: CRLF-joined — every line separator is \\r\\n, no bare \\n anywhere", () => {
  const bat = kioskShortcutBat(ORIGIN);
  const crlfCount = bat.split("\r\n").length - 1;
  assert.ok(crlfCount > 0, "expected at least one \\r\\n separator");
  const strippedOfCrlf = bat.split("\r\n").join("");
  assert.ok(!strippedOfCrlf.includes("\n"), "must never contain a bare \\n not preceded by \\r");
});

test("kioskShortcutBat: locates chrome.exe at the 3 standard install paths", () => {
  const bat = kioskShortcutBat(ORIGIN);
  assert.ok(bat.includes("%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"), "Program Files chrome.exe path");
  assert.ok(bat.includes("%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"), "Program Files (x86) chrome.exe path");
  assert.ok(bat.includes("%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"), "LOCALAPPDATA chrome.exe path");
});

test("kioskShortcutBat: msedge.exe fallback branch is present at the 2 standard Edge paths, gated on chrome not being found", () => {
  const bat = kioskShortcutBat(ORIGIN);
  assert.ok(bat.includes("%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"), "Program Files msedge.exe fallback path");
  assert.ok(bat.includes("%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"), "Program Files (x86) msedge.exe fallback path");
  // positive landmark: the fallback lines are all gated on BROWSER still
  // being undefined, i.e. chrome not having matched yet.
  assert.match(bat, /if not defined BROWSER if exist "%CAND3%" set "BROWSER=%CAND3%"/, "the msedge fallback must be gated on `if not defined BROWSER`");
});

test("kioskShortcutBat: echoes an install-Chrome-or-Edge message inside the not-defined-BROWSER branch, then exits", () => {
  const bat = kioskShortcutBat(ORIGIN);
  const start = bat.indexOf("if not defined BROWSER (");
  assert.ok(start >= 0, "positive landmark: the not-defined-BROWSER branch must exist");
  const end = bat.indexOf(")", start);
  const block = bat.slice(start, end);
  assert.match(block, /echo .*Chrome/i, "must mention Chrome in the fallback message");
  assert.match(block, /echo .*Edge/i, "must mention Edge in the fallback message");
  assert.match(block, /exit \/b 1/, "must exit non-zero when no browser is found");
});

test("kioskShortcutBat: creates the Desktop shortcut via [Environment]::GetFolderPath('Desktop') — never a hardcoded C:\\Users path", () => {
  const bat = kioskShortcutBat(ORIGIN);
  assert.ok(bat.includes("[Environment]::GetFolderPath('Desktop')"), "must resolve Desktop via GetFolderPath");
  assert.ok(bat.includes("POS Printer.lnk"), "positive landmark: the shortcut must be named POS Printer.lnk");
  assert.ok(!bat.includes("C:\\Users"), "must never hardcode a C:\\Users path anywhere in the emitted .bat");
});

test("kioskShortcutBat: --kiosk-printing appears exactly once on every line that carries the kiosk args (never duplicated on one line)", () => {
  const bat = kioskShortcutBat(ORIGIN);
  const lines = bat.split("\r\n");
  const flaggedLines = lines.filter((l) => l.includes("--kiosk-printing"));
  assert.ok(flaggedLines.length >= 2, `expected at least 2 lines carrying the kiosk args (shortcut Arguments + launch), found ${flaggedLines.length}`);
  for (const line of flaggedLines) {
    const count = line.split("--kiosk-printing").length - 1;
    assert.equal(count, 1, `line "${line}" must contain --kiosk-printing exactly once, found ${count}`);
  }
});

test("kioskShortcutBat: then launches the browser once — the final `start` line's argument portion is exactly KIOSK_ARGS(origin)", () => {
  const bat = kioskShortcutBat(ORIGIN);
  const args = KIOSK_ARGS(ORIGIN);
  const lines = bat.split("\r\n");
  const launchLine = lines.find((l) => l.trim().startsWith("start "));
  assert.ok(launchLine, "positive landmark: a `start` launch line must exist");
  assert.ok(launchLine!.includes('"%BROWSER%"'), "the launch line must invoke the resolved, quoted %BROWSER% path");
  assert.ok(launchLine!.endsWith(args), "the launch line must end with exactly KIOSK_ARGS(origin), not a re-typed copy");
});

test("SINGLE-SOURCE: shortcutTargetString's argument portion equals the .bat launch line's argument portion — both derive from KIOSK_ARGS, never independently typed", () => {
  const bat = kioskShortcutBat(ORIGIN);
  const args = KIOSK_ARGS(ORIGIN);
  const lines = bat.split("\r\n");
  const launchLine = lines.find((l) => l.trim().startsWith("start "))!;
  const batArgPortion = launchLine.slice(launchLine.length - args.length);

  const target = shortcutTargetString(ORIGIN, "chrome.exe");
  const targetArgPortion = target.slice(target.indexOf(" ") + 1);

  assert.equal(batArgPortion, args, "the .bat launch line's trailing argument portion must equal KIOSK_ARGS(origin)");
  assert.equal(targetArgPortion, args, "shortcutTargetString's argument portion must equal KIOSK_ARGS(origin)");
  assert.equal(batArgPortion, targetArgPortion, "the .bat and the manual Target string must carry the IDENTICAL argument string");
});

test("kioskShortcutBat: no cafe-name literal anywhere in the emitted .bat (generic product voice)", () => {
  const bat = kioskShortcutBat(ORIGIN);
  assert.ok(!bat.toLowerCase().includes(BANNED_CAFE_NAME.toLowerCase()), `the .bat must never mention "${BANNED_CAFE_NAME}"`);
});

// ── Wizard copy (§B2) ────────────────────────────────────────────────────

test("WIZARD_STEPS: exactly 5 steps (§B2), each with a non-empty title and body", () => {
  assert.equal(WIZARD_STEPS.length, 5, `expected 5 wizard steps, found ${WIZARD_STEPS.length}`);
  for (const step of WIZARD_STEPS) {
    assert.ok(step.title.length > 0, "every step title must be non-empty");
    assert.ok(step.body.length > 0, "every step body must be non-empty");
  }
});

test("WIZARD_TROUBLESHOOTING: carries exactly the 5 required staff-language points (4 from §B2 + the first-run kiosk login note)", () => {
  assert.equal(WIZARD_TROUBLESHOOTING.length, 5, `expected exactly 5 troubleshooting points, found ${WIZARD_TROUBLESHOOTING.length}`);
  // PH-10b re-point: the copy table's English rewrite spells this "log in"
  // (two words), never the contiguous "login" the old Hinglish-adjacent
  // needle assumed — re-anchor on the actual mandated phrase.
  assert.match(WIZARD_TROUBLESHOOTING[0], /log ?in/i, "point 1 must cover the fresh kiosk profile needing a one-time login");
  assert.match(WIZARD_TROUBLESHOOTING[0], /separate browser profile/i, "point 1 must mention the separate browser profile");
  assert.match(WIZARD_TROUBLESHOOTING[1], /chrome/i, "point 2 must mention Chrome");
  assert.match(WIZARD_TROUBLESHOOTING[1], /edge/i, "point 2 must mention Edge");
  assert.match(WIZARD_TROUBLESHOOTING[1], /test print/i, "point 2 must mention re-running the test print");
  assert.match(WIZARD_TROUBLESHOOTING[2], /window/i, "point 3 must mention the POS Printer window");
  assert.match(WIZARD_TROUBLESHOOTING[2], /slow/i, "point 3 must mention prints going slow");
  assert.match(WIZARD_TROUBLESHOOTING[3], /internet/i, "point 4 must mention internet being down");
  assert.match(WIZARD_TROUBLESHOOTING[3], /reprint/i, "point 4 must mention reprinting later");
  // PH-10b re-point: the copy table's mandated English says "older slip"
  // (singular), not "older slips" — re-anchor on the actual source text.
  assert.match(WIZARD_TROUBLESHOOTING[4], /older slip/i, "point 5 must explain what 'older slip' clearing means");
});

// ── Regression pins for the arbitrated review fixes (2026-09-03) ────────────

test("REGRESSION M1: the profile-dir VALUE is quoted — %LOCALAPPDATA% can expand to a path with a space (username), and an unquoted space splits the argument", () => {
  const args = KIOSK_ARGS(ORIGIN);
  assert.ok(args.includes('--user-data-dir="%LOCALAPPDATA%\\pos-print-host"'), "the --user-data-dir value must be double-quoted");
});

test("REGRESSION C19: plain `setlocal` — delayed expansion eats `!` inside expanded values (probed: Rock!Star -> RockStar) and no !var! is used", () => {
  const bat = kioskShortcutBat(ORIGIN);
  assert.ok(!bat.includes("enabledelayedexpansion"), "must never enable delayed expansion");
  assert.ok(bat.split("\r\n").includes("setlocal"), "positive landmark: a plain setlocal line must exist");
});

test("REGRESSION: the powershell -Command line rides the quoted profile dir as \\\" so cmd's outer double quotes stay balanced", () => {
  const bat = kioskShortcutBat(ORIGIN);
  const psLine = bat.split("\r\n").find((l) => l.includes("powershell -NoProfile"));
  assert.ok(psLine, "positive landmark: the powershell shortcut-creation line must exist");
  assert.ok(psLine!.includes('\\"%LOCALAPPDATA%\\pos-print-host\\"'), "the Arguments string must carry backslash-escaped quotes around the profile dir");
  const bareQuotes = psLine!.split('\\"').join("").split('"').length - 1;
  assert.equal(bareQuotes, 2, "exactly the two cmd-level outer quotes may remain unescaped on the powershell line");
});

test("Wizard copy: no step title/body or troubleshooting line ever names a cafe (generic product voice, CLAUDE.md)", () => {
  const allText = [...WIZARD_STEPS.flatMap((s) => [s.title, s.body]), ...WIZARD_TROUBLESHOOTING];
  assert.ok(allText.length > 0, "positive landmark: there must be copy to check");
  for (const text of allText) {
    assert.ok(!text.toLowerCase().includes(BANNED_CAFE_NAME.toLowerCase()), `copy must never mention "${BANNED_CAFE_NAME}": "${text}"`);
  }
});
