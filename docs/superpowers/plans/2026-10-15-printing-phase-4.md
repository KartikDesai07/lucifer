# Printing Phase 4 Implementation Plan (text KOTs, network printer discovery, setup polish)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A kitchen ticket whose every printed character is plain English text prints as ESC/POS text (about 30× fewer
bytes than today's picture, far faster over Bluetooth), on a printer whose own switch staff turned on after a text test;
the Android and Windows apps (2.0.2) list the network printers on their own network when asked; the app names two network
printers on one address apart, and the not-routed toast says the right thing. With every switch off, nothing on paper
changes.

**Architecture:** A pure text renderer in the page (`apps/cafe/lib/printer/kot-text/`) reads a kitchen-surface slip
exactly as the picture does (the kitchen view of the order, the stored or legacy Classic template, SlipEngine's visible
blocks) and answers ESC/POS text bytes or why the slip must print as a picture. The print bridge asks it right before
the picture path, only for a printer whose switch is on in this device's storage, and writes its bytes through the same
writer the picture uses. Discovery is new, separate code in each app behind one new bridge method each; the page shows
a button only where the app has it.

**Tech Stack:** TypeScript (Next.js 15 page, node:test with tsx), React 19 (`renderToStaticMarkup` for the parity
test), Kotlin (Android, JUnit 4 on the JVM), React Native 0.87, Electron 44 + Node `net`, ESC/POS.

**Spec:** `docs/superpowers/specs/2026-10-15-printing-phase-4-design.md` (approved by the owner on 2026-10-15, section by
section). Read it with this plan; section numbers below (§n, S1–S6, P4-n) are the spec's.

## How this plan runs

The owner's workflow (one phase per session): four sessions, **4A → 4B → 4C → 4D**, each started from a prompt the
orchestrator gives and each followed by a review gate. **Session 4A is exact below** (code, commands, expected output),
pre-validated in the planning session, and so is **Session 4B** (made exact at the 4A review gate, 2026-10-16). Sessions
4C–4D are task specs with fixed interfaces, test lists and acceptance checks; each is made exact (full code,
pre-validated) at the gate before it, as in printing Phases 2 and 3 and native apps 2.0. A gate may change a later
session's spec; it records why.

| Session | Delivers | Gate before the next |
|---|---|---|
| 4A | The text renderer as pure code with its tests, wired to nothing: the characters, the lines and their bytes, Classic and Kitchen Bold as text, the text test slip, the parity with the picture. No behaviour change. | review; 4B made exact |
| 4B | The page: the switch per printer (its store, its section, the text test and confirm), the bridge's text step and the writers (a Windows printer's side feature-detected), the not-routed words; the fake-printer end-to-end runs (headless Chrome with a fake POS app, the emulator) | review; 4C made exact |
| 4C | The apps 2.0.2 code: Android `network.findPrinters` and the network printer's name (m-2); Windows `findLanPrinters` and `printRawOn`; the page's "Find network printers"; JUnit, desktop tests, pins; the emulator finding a fake printer | review; 4D made exact |
| 4D | The exit: both apps 2.0.2, GO-LIVE and TEST-CHECKLIST (with the owner's Bluetooth measurement), every suite, the release set `Sandbee-POS-2.0.2`, the final review | the owner's merge OK |

**The owner's decision of 2026-10-16 (after 4B): two sessions instead of four.** Session 1 verified 4B and built 4C
directly on the branch (test first, one commit per task; the 4B gate's rulings as Task 19; no gold worktree, no
generated blocks, no separate execution session; one fresh review at the end): see "The 4B review gate (fast)" and
"Session 4C Results" at the end. Session 2 verifies 4C independently, then runs 4D from its spec below, then asks the
owner for the merge OK. No rule is loosened by the speed.

**How a session's exact code was made (the native apps N3/N4 gate method):** the code is written test first in a gold
worktree, one commit per task; the plan's blocks are generated from those commits (whole files as `Create`, every other
change as an exact `find` / `Replace it with`, tests first); the blocks are then applied step by step on a fresh worktree
at the session's base with `apply_blocks_clone.py`, running every RED and GREEN command, and every task's whole tree must
come out identical to gold. Every Expected line in an exact section is that run's output.

## Global Constraints

- Spec `docs/superpowers/specs/2026-10-15-printing-phase-4-design.md`; branch `feat/printing-phase-4` (from `main`
  `3fe1439`). Merge into `main` only with the owner's explicit OK; push only when the owner says, only with the token
  store (`GIT_TERMINAL_PROMPT=0 git push`).
- **S1, a deploy changes no paper:** every text switch starts off; with every switch off every slip prints through
  today's code, byte for byte. The picture code is not changed in Phase 4: `apps/cafe/lib/printer/escpos.ts`,
  `lib/printer/raster.ts`, `lib/printer/raster-assets.ts`, `lib/printer/lane-print.ts`, `lib/desktop-shell.ts`'s
  print path, `components/pos/KOTReceipt.tsx`, `OrderReceipt.tsx`, `components/print/slip/*`, `apps/desktop/src/print-direct.ts`,
  `escpos.ts`, `raw-spool.ts`, `raw-tcp.ts`, `print-job.ts`, and the Android `printer/` package's managers, pool and
  transports (only `PrinterDiscovery.kt`'s display name changes in 4C).
- **Text KOTs only for the kitchen surface** (kinds `kot`, `void`, `moved`, `cancel-notice`): never a bill, token, End
  of day or the setup page's Test print (P4-1).
- **Characters:** only printable ASCII 0x20–0x7E reaches a printer; the fifteen mapped characters of §4.2 (`₹` → `Rs `);
  any other character makes the whole slip a picture.
- **Columns:** 58 mm → 32, 80 mm → 48 or 42 (P4-5); a line holds at most columns − 1 characters (double width: half).
- **Commands:** `ESC @` once at the start, then `ESC R 0` and `ESC M 0` once (the owner's rulings at the 4A gate,
  2026-10-16), `ESC a`, `ESC E`, `GS !`, `GS B`, `LF`, `ESC J`, and the picture's `GS V 66 0`; no code page or Kanji
  command, never a second `ESC @`.
- **S3:** a refusal or any error in the text path is decided before a byte is sent and prints the slip as a picture;
  `kotTextJob` never throws.
- **The switch** lives only in the printing device's storage (`pos.text-kot.v1`, never inside `pos.device-printer.v1`),
  keyed `printer:<setup printer id>:<how this device reaches it>` or `device:<how it reaches its own printer>` (the 4A
  gate, spec §5.1); on only after the printer's text test printed and staff answered Yes (S2); a printer this device only
  takes over for another device prints pictures (spec §5.3).
- **Discovery:** TCP port 9100 connect-only on the device's own private IPv4 /24 (at most two), 500 ms per address, 32 at
  a time, at most 10 s, at most 64 results, no byte sent, only on a tap; Wi-Fi or Ethernet only on Android; no new
  Android permission.
- **Free tier:** no new request of any kind to a cafe's Vercel, Atlas or Worker; `packages/shared/src/print-budget.test.ts`
  unchanged.
- **Apps:** one version 2.0.2 for both (4D); the release through `scripts/release-native.mjs`; the key
  `D:\kd\pos-signing\sandbee-pos-release.jks` and the four `POS_RELEASE_` lines are never printed, copied or shown.
- **Tests:** every new cafe test file goes into `apps/cafe/package.json`'s `testChain` (one entry per file); every new
  assertion carries a message.
- **Environment:** `GRADLE_USER_HOME='D:\gradle-home'`; JUnit `:app:testDebugUnitTest --rerun`; `:app:compileReleaseKotlin
  --rerun` before a release APK after a Kotlin change; `ELECTRON_RUN_AS_NODE` unset for Electron and `npm run dist`;
  `df -h /c /d` first (stop if D: is under 1 GB; the emulator needs C: ≥ 3 GB); long runs in the background with an
  until-loop wait (a foreground wait stops at 600 s).
- **Emulator:** check `adb shell pm path com.possoftware.pos` and what the app shows before any write; the app only ever
  points at `http://localhost:3110` (adb reverse) or local test addresses, never posdemo or a cafe; Play Protect only
  "More details → Install without scanning"; put it back as found (`adb reverse --remove-all`, `adb shell sync`,
  `adb emu kill`); stop only this session's processes, by PID after checking the command line.
- Local only: no connector, Artifact or Docs tool, no upload anywhere, no deploy. Repo text in English; messages to the
  owner in Hinglish.

## Review Focus

1. **A KOT with one character text cannot print** (a Hindi or Gujarati dish, a staff name in Gujarati, an emoji in a
   note, "Crème brûlée"): the whole slip prints as today's picture, never a `?` or a garbled line. Pinned in Task 1
   (`any other character means the slip cannot be text`) and Task 3 (`a slip text cannot print exactly prints as a
   picture`).
2. **Long text on 58 mm** (a long dish name, a long staff name, `T-1 → T-4`): wrapped inside 31 characters, no word or
   character lost, the amount on the item's first line. Pinned in Task 2 (the layout tests) and Task 6 (the laid-out
   characters equal the rows' at 32 and 48 columns, over 8,800 cells).
3. **A cafe that customised its ticket** (a block at xl or xs, centred or right, bold off, a small or large base size,
   Kitchen Bold): the size map and every word in the picture's order. Pinned in Task 3 (`a block's own size, alignment
   and weight`) and Task 6 (the styled, small and large variants).
4. **A printer that moves to the next line by itself when a line is exactly full:** no line is ever full. Pinned in
   Task 2 (`a line holds one character less than the columns`; the encoder refuses a longer line) and Task 5 (the ruler).
5. **A ticket that would draw a logo or a QR code:** a picture. Pinned in Task 3 (the logo on with a logo, a QR code
   with a usable link; a QR line with no usable link prints nothing either way).

## The planning review (Claude Fable 5.1, 2026-10-15)

A fresh reviewer on Claude Fable 5.1 (read-only; its probes in the planning session's scratchpad) reviewed the spec, this
plan and Session 4A's code. **Verdict: "Ready to run as written: With fixes"; 0 Critical.** It replayed every 4A block
on its own applier (27 ops, the tree identical to gold), ran the seven kot-text test files (35/35), the typecheck and
the lint, checked the bytes against Epson ESC/POS and both text renderers block by block against their React twins, and
ran nine mutation probes (eight caught; I-3 below was the ninth). Every finding was ruled before this commit; the 4A
fixes were folded into the gold commits and the whole session validated again (every task's tree identical).

| Finding | Ruling |
|---|---|
| I-1 the switch stored `columns`; a printer's paper changed later would keep 48 on a 58 mm head | **4B Task 10/11:** the store keeps only the 80 mm "42" choice; the columns come from the printer's paper at each print (spec §5.1 amended) |
| I-2 a setup printer's key survived a change of its connection, so an unproven printer could print text | **4B Task 10:** the key carries the connection (`printer:<id>:<connection>`); a changed printer reads off (spec §5.1) |
| I-3 "Show ticket number" was never exercised: removing 4A's one mirrored visibility rule failed no test | **Folded into 4A:** Task 3 gains a golden test of the number (the setting off, the block on or off); Task 6's parity adds a "Show ticket number" off settings variant and the number's block off in both designs: 8,800 cells. Removing the rule now fails both (re-probed) |
| I-4 the lazy slip chunk: with it not loaded the picture prints the legacy ticket | **4B Task 11:** the text step answers nothing while the slip's design needs the chunk and it is not ready (spec §5.2) |
| I-5 Windows interfaces: virtual adapters can come before the real LAN | **4C Task 22:** link-local and virtual adapters left out, 192.168 first (spec §7.2) |
| I-6 Android: the default network may be mobile data while the printer is on a Wi-Fi with no internet; sockets not bound | **4C Task 20:** every network searched for the Wi-Fi or Ethernet one (no VPN), its prefix respected, each probe socket bound to it (spec §7.1) |
| m-1 `PRINTABLE_MIN/MAX` declared twice | Folded into 4A (Task 1 exports them, Task 2 imports them) |
| m-2 `KOT_TEXT_DESIGNS` is a mutable export the test reassigns | Not taken: production code never writes it; the test restores it in `finally` |
| m-3 which Co-Authored-By line wins | The session prompt's line wins; the blocks show Claude Opus 5.5 |
| m-4 the spec said "Text test", the slip prints "TEXT TEST" | Spec §5.1 amended |
| m-5 ESC J's unit is the printer's motion unit, not always a dot | Folded into 4A's comments (Task 2, Task 3) and spec §4.3 |
| m-6 a band's last column stays white; two band lines may show a gap | Spec §4.3 says both are expected (and 4D's TEST-CHECKLIST will) |
| m-7 custom text loses leading spaces | Not taken: cosmetic (custom text prints centred) |
| m-8 a serial printer with no USB ids | 4B Task 10 defines the key without them |
| m-9 the text step must keep the picture path's pre-write rules and run for job slips only | 4B Task 11 says so (spec §5.2) |
| m-10 `printRawOn` for a printer Windows does not report | 4C Task 23: the shell's "That printer is not on this PC…" (spec §6) |
| m-11 a probe briefly holds a one-connection printer | Accepted, recorded in spec §7 |
| m-12 the em ratios are not pinned to the React classes | Not taken: words are pinned (parity) and the text sizes by the goldens; a size change in a React class changes the picture, never a word; the owner's real-printer run checks the look |

**The re-check** (the same reviewer, of the folded fixes only): **"Ready to run as written: Yes"**. Every ruling is
implemented as stated and nothing else changed (`3dca961..892ba66`: 7 files, +35/−16, the only production edit the
moved constants); the plan's blocks replay to the new tree (27 ops, identical); the seven suites 36/36; the I-3
mutation now fails both its tests, the other eight as before. Its four wording nits were folded: m-A (spec §5.1 names
the Windows chosen printer's paper source), m-B (Task 11: one refusal path), m-C (Task 20: Wi-Fi first when both, the
API 31 deprecation), m-D (Task 22: a renamed VPN adapter is an accepted residual); and the interface lines of Tasks 1–2
name `PRINTABLE_MIN/MAX`.

## File structure

| File | Session | Responsibility |
|---|---|---|
| `apps/cafe/lib/printer/kot-text/text-chars.ts` | 4A | printable ASCII and the fifteen mapped characters (§4.2) |
| `apps/cafe/lib/printer/kot-text/text-layout.ts` | 4A | sizes, columns, rows → wrapped lines (§4.3) |
| `apps/cafe/lib/printer/kot-text/text-escpos.ts` | 4A | lines → ESC/POS bytes (§4.3) |
| `apps/cafe/lib/printer/kot-text/kot-text-design.ts` | 4A | a design's text renderer contract, ratios, row helpers |
| `apps/cafe/lib/printer/kot-text/kot-text-classic.ts`, `kot-text-bold.ts` | 4A | Classic and Kitchen Bold as text |
| `apps/cafe/lib/printer/kot-text/kot-text.ts` | 4A | the gate and the entry: `kotTextRows`, `kotTextPlan`, `kotTextJob` (§4.1, S3) |
| `apps/cafe/lib/printer/kot-text/text-test-slip.ts` | 4A | the text test slip (§5.1, S2) |
| `apps/cafe/lib/printer/kot-text/*.test.ts`, `kot-text.fixtures.ts` | 4A | unit, golden and parity tests |
| `apps/cafe/lib/printer/kot-text/text-kot-store.ts` | 4B | the switch's storage (`pos.text-kot.v1`) and its keys |
| `apps/cafe/lib/printer/kot-text/text-kot-print.ts` | 4B | the bridge's text step: the route the picture takes, the switch, the bytes or none; the real env |
| `apps/cafe/lib/printer/kot-text/text-kot-printers.ts`, `hooks/use-text-kot-printers.ts` | 4B | the printers the panel lists, each by its route; `useTextKot` |
| `apps/cafe/lib/desktop-shell-printer.ts`, `lib/printer/desktop-printer-state.ts` | 4B | `printRawOn` (feature-detected), `desktopPrintRawOn`, the Windows app's print method |
| `apps/cafe/hooks/use-print-host-bridge.ts`, `lib/print-host-slips.ts`, `lib/print-agent-slip.ts` | 4B | asks the text step before the kitchen surface; `queueTestSlip(write)`; a job slip's `printerId` |
| `apps/cafe/components/print/TextKotSection.tsx`, `PrinterSetupCard.tsx`, `components/layout/PrintHostProvider.tsx` | 4B | "Fast text KOTs (English only)" in the printer panel |
| `apps/cafe/lib/print-routing.ts`, `hooks/use-host-routing.ts` | 4B | the not-routed words by kind |
| `apps/mobile/android/.../printer/LanScan.kt`, `PosPrinterModule.kt`, `apps/mobile/src/bridge/*` | 4C | `network.findPrinters` |
| `apps/mobile/android/.../printer/PrinterDiscovery.kt` | 4C | the network printer's display name (m-2) |
| `apps/desktop/src/lan-scan.ts`, `print-raw-on.ts`, `preload.ts`, `shared.ts`, `main.ts` | 4C | `findLanPrinters`, `printRawOn` |
| `apps/cafe/lib/printer/lan-discovery.ts`, `components/print/FindNetworkPrinters.tsx` | 4C | the page's "Find network printers" |
| `apps/mobile/android/app/build.gradle`, `apps/desktop/package.json` | 4D | 2.0.2 |
| `docs/GO-LIVE-CHECKLIST.md`, `apps/mobile/TEST-CHECKLIST.md`, `apps/cafe/lib/go-live-runbook.test.ts` | 4D | the release steps and the owner's checks |

---

# Session 4A (exact): the text renderer, wired to nothing

Made exact in the planning session (2026-10-15). Every code block below was written and run in the gold worktree
`D:\kd\p4g` (branch `g4a-v2` from `d21ee37`, the spec commit): Tasks 1–6 as six commits (`684223d`, `107c8ff`,
`e636523`, `5dfc872`, `48a9608`, `892ba66`; the planning review's fixes folded in; first `888e4e0` … `3dca961`), the last
whole tree `33375e2db8a22e265e21d49356d720726da888b5`; the blocks were generated from those commits,
then applied step by step on a fresh worktree `D:\kd\p4v` at `d21ee37` (each find matched exactly once, every task's
whole tree came out identical to gold, and every Expected below is that run's output).

Acceptance: `kotTextJob` turns any kitchen-surface slip into ESC/POS text bytes or a refusal, never throwing; Classic
(and the legacy ticket) and Kitchen Bold print the picture's words in its order (8,800 cells); a KOT is about 1 KB; no
file outside `apps/cafe/lib/printer/kot-text/` and the cafe test chain changes, and nothing imports the new code yet, so
nothing a cafe sees changes.

**Expected counts** (baseline = `d21ee37`): the cafe chain 5984 (5983 pass, 0 fail, 1 skipped) → **6020** (6019 pass,
0 fail, 1 skipped); cafe typecheck clean; cafe lint 0 errors (the 2 old warnings). No other workspace changes (mobile,
desktop, shared, hub: not run in 4A beyond the baseline).

Work in `D:\kd\lucifer` on `feat/printing-phase-4`; `$SP` is the session's scratchpad. Tasks are numbered 0–7, so
`task-start <plan> 3` brings only that task. Apply a step's blocks with `D:\kd\pos-dev-keep\phase3-final-gate\apply_blocks_clone.py`
(first argument the repo, then the plan, the first and the last line of the step; a `--dry` run first). Every commit
message goes in a scratch file and is committed with `git commit -F`; the messages below end with Claude Opus 5.5's
Co-Authored-By line; if the session's prompt gives another, its line wins (the review's m-3).

### Task 0: Baseline

**Files:** none (Results only).

- [ ] **Step 1: Check the branch, the disks and the cafe chain**

```bash
cd /d/kd/lucifer && git status --short && git branch --show-current && git log --oneline -3 && df -h /c /d
cd /d/kd/lucifer/apps/cafe && npm test > "$SP/cafe-base.log" 2>&1; grep -E "^# (tests|pass|fail|skipped)" "$SP/cafe-base.log"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npm run lint 2>&1 | tail -2
```
Expected: clean, `feat/printing-phase-4`, the plan commit on top of `d21ee37`; cafe `# tests 5984`, `# pass 5983`,
`# fail 0`, `# skipped 1` (about 70 s: run it in the background and wait for its log with an until-loop); typecheck
clean; `✖ 2 problems (0 errors, 2 warnings)`.

### Task 1: The characters a text KOT may send (§4.2)

**Files:**
- Create: `apps/cafe/lib/printer/kot-text/text-chars.ts`
- Test: `apps/cafe/lib/printer/kot-text/text-chars.test.ts`; `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces: `PRINTABLE_MIN = 0x20`, `PRINTABLE_MAX = 0x7e`; `TEXT_CHAR_MAP: ReadonlyMap<string, string>` (the fifteen
  characters); `asciiText(text: string): string | null`
  (printable ASCII with the map applied, LF kept, CR dropped, a tab a space; null for any other character).

- [ ] **Step 1: Write the failing test**

Create `apps/cafe/lib/printer/kot-text/text-chars.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { TEXT_CHAR_MAP, asciiText } from "./text-chars";

// Printing Phase 4 (spec 2026-10-15 §4.2): only printable ASCII reaches a printer in text mode; a few characters today's
// kitchen tickets print are mapped first, and anything else makes the slip a picture (asciiText answers null).

const ch = (code: number): string => String.fromCharCode(code);

test("printable ASCII passes through unchanged", () => {
  const all = Array.from({ length: 0x7f - 0x20 }, (_, i) => ch(0x20 + i)).join("");
  assert.equal(asciiText(all), all, "every character from space to tilde is kept");
  assert.equal(asciiText(""), "", "an empty string stays empty");
});

test("the mapped characters become their ASCII text", () => {
  const cases: Array<[string, string]> = [
    [`${ch(0x20b9)}240`, "Rs 240"],
    [`${ch(0x20b9)}1,23,456`, "Rs 1,23,456"],
    [`2 ${ch(0x00d7)} Masala Chai`, "2 x Masala Chai"],
    [`T-1 ${ch(0x2192)} T-4`, "T-1 -> T-4"],
    [`ORDERED ${ch(0x2014)} DO NOT`, "ORDERED - DO NOT"],
    [`a ${ch(0x2013)} b`, "a - b"],
    [`${ch(0x25b8)} no onion`, "> no onion"],
    [`${ch(0x00bb)} no onion`, ">> no onion"],
    [`BACKUP PRINTER ${ch(0x00b7)} REPRINT`, "BACKUP PRINTER - REPRINT"],
    [`${ch(0x2018)}hot${ch(0x2019)}`, "'hot'"],
    [`${ch(0x201c)}hot${ch(0x201d)}`, '"hot"'],
    [`wait${ch(0x2026)}`, "wait..."],
    [`02:35${ch(0x202f)}pm`, "02:35 pm"],
    [`02:35${ch(0x00a0)}pm`, "02:35 pm"],
  ];
  for (const [from, to] of cases) assert.equal(asciiText(from), to, `maps ${JSON.stringify(from)}`);
  assert.equal(TEXT_CHAR_MAP.size, 15, "the map holds exactly the fifteen characters of spec §4.2");
});

test("line breaks are kept, a carriage return is dropped and a tab is a space", () => {
  assert.equal(asciiText("one\r\ntwo\nthree"), "one\ntwo\nthree", "CRLF and LF become LF");
  assert.equal(asciiText("a\tb"), "a b", "a tab is one space");
});

test("any other character means the slip cannot be text", () => {
  const refused = [
    "पनीर टिक्का", // Hindi (Devanagari)
    "ખમણ ઢોકળા", // Gujarati
    "பனீர்", // Tamil
    "Café", // an accented Latin letter
    "Chai " + String.fromCodePoint(0x1f375), // an emoji
    "Pizza" + ch(0x2122), // a trademark sign, not in the map
    "€5", // a currency sign not in the map
    "a" + ch(0x7f), // DEL is not printable
    "a" + ch(0x1b) + "@", // a control character (ESC) typed into a name never reaches the printer
  ];
  for (const text of refused) assert.equal(asciiText(text), null, `refuses ${JSON.stringify(text)}`);
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/printer/escpos-parity.test.ts",
    "lib/printer/raster.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

Replace it with:

```json
    "lib/printer/escpos-parity.test.ts",
    "lib/printer/raster.test.ts",
    "lib/printer/kot-text/text-chars.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-chars.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
# Error: Cannot find module './text-chars'
not ok 1 - lib\\printer\\kot-text\\text-chars.test.ts
# tests 1
# pass 0
# fail 1
```

- [ ] **Step 3: Implement**

Create `apps/cafe/lib/printer/kot-text/text-chars.ts`:

```ts
// Printing Phase 4 (spec 2026-10-15 §4.2): the characters a text KOT may send. Only printable ASCII (0x20-0x7E) reaches
// the printer, so no code page command is sent and every ESC/POS printer prints the same characters in every code page.
// A few characters today's kitchen tickets print are mapped to ASCII first; any other character makes the whole slip a
// picture (spec §4.1 rule 6), so a Hindi or Gujarati menu, an accented letter or an emoji never prints as text.
// Characters are named by code point (never typed into this file), so an invisible one cannot slip in unseen.

/** The printable ASCII range: the only bytes a text KOT's characters become. */
export const PRINTABLE_MIN = 0x20;
export const PRINTABLE_MAX = 0x7e;

const MAPPED: ReadonlyArray<readonly [number, string]> = [
  [0x20b9, "Rs "], // the rupee sign: "Rs 240" (owner, 2026-10-15)
  [0x00d7, "x"], // the multiplication sign: "2 x Masala Chai"
  [0x2192, "->"], // the arrow of a moved table: "T-1 -> T-4"
  [0x2014, "-"], // the em dash: "FOOD ALREADY ORDERED - DO NOT MAKE AGAIN"
  [0x2013, "-"], // the en dash
  [0x25b8, ">"], // Classic's instruction mark
  [0x00bb, ">>"], // Kitchen Bold's instruction mark
  [0x00b7, "-"], // the middle dot between joined labels: "BACKUP PRINTER - REPRINT"
  [0x2018, "'"], // curly single quotes
  [0x2019, "'"],
  [0x201c, '"'], // curly double quotes
  [0x201d, '"'],
  [0x2026, "..."], // the ellipsis
  [0x00a0, " "], // the no-break space
  [0x202f, " "], // the narrow no-break space (a time on newer ICU: "02:35 pm")
];

/** Each mapped character and its ASCII text. Nothing else is mapped. */
export const TEXT_CHAR_MAP: ReadonlyMap<string, string> = new Map(MAPPED.map(([code, to]) => [String.fromCharCode(code), to]));

/** The text as printable ASCII, or null when it holds a character text mode cannot print. Line breaks are kept (as
 *  LF) for the caller to decide on; a carriage return is dropped and a tab is a space. */
export function asciiText(text: string): string | null {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (code >= PRINTABLE_MIN && code <= PRINTABLE_MAX) out += char;
    else if (char === "\n") out += "\n";
    else if (char === "\t") out += " ";
    else if (char !== "\r") {
      const mapped = TEXT_CHAR_MAP.get(char);
      if (mapped === undefined) return null;
      out += mapped;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-chars.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint lib/printer/kot-text && echo "typecheck and lint clean"
```
Expected:
```text
# tests 4
# pass 4
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4a-1.txt`, then `git add apps/cafe/lib/printer/kot-text apps/cafe/package.json && git commit -F "$SP/msg-4a-1.txt"`:

```text
feat(cafe): printing Phase 4 Session 4A, the characters a text KOT may send: printable ASCII only, so no code page command is needed and every printer prints the same; the fifteen mapped characters (the rupee sign as "Rs ", the multiplication sign, the arrow, the dashes, the instruction marks, the middle dot, curly quotes, the ellipsis, the no-break spaces); any other character answers null, so a Hindi or Gujarati menu prints as a picture (spec §4.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 2: Lines and their ESC/POS bytes (§4.3)

**Files:**
- Create: `apps/cafe/lib/printer/kot-text/text-layout.ts`, `apps/cafe/lib/printer/kot-text/text-escpos.ts`
- Test: `text-layout.test.ts`, `text-escpos.test.ts` (same folder); `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Consumes: `asciiText`, `PRINTABLE_MIN`, `PRINTABLE_MAX` (Task 1); `ESC_INIT`, `RASTER_BOTTOM_PAD_ROWS`,
  `CUT_PARTIAL_WITH_FEED` from `lib/printer/escpos.ts` (read only).
- Produces: `type TextSize = "normal" | "tall" | "big"`; `TEXT_TALL_MIN_RATIO = 1.2`, `TEXT_BIG_MIN_RATIO = 1.5`;
  `textSizeOf(ratio)`; `TEXT_COLUMNS_58MM = 32`, `TEXT_COLUMNS_80MM = 48`, `TEXT_COLUMNS_80MM_NARROW = 42`,
  `type TextColumns`, `TEXT_COLUMN_CHOICES`; `textColumnsOf(paper: PaperWidth, narrow80: boolean): TextColumns`;
  `lineWidth(columns, size)` (columns − 1; double width half of that); `interface TextLine { text; align; bold; size;
  invert }`; `interface TextFeed { feedDots }`; `type TextPiece`; `interface RowStyle { align; bold; ratio; invert?;
  upper?; indent? }`; `type TextRow` (`text` with `keepBreaks?`, `split`, `item` with `hang`, `rule`, `feed`);
  `wrapWords(text, width, firstWidth?)`; `layoutRows(rows, columns): TextPiece[] | null`;
  `escposTextJob(pieces, columns): Uint8Array` (throws on a blank slip, a line too long, a non-ASCII character, a bad feed).

- [ ] **Step 1: Write the failing tests**

Create `apps/cafe/lib/printer/kot-text/text-escpos.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { CUT_PARTIAL_WITH_FEED, ESC_INIT, RASTER_BOTTOM_PAD_ROWS } from "../escpos";
import { escposTextJob } from "./text-escpos";
import type { TextLine, TextPiece } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.3): the bytes of a text job. ESC @ first; each line sends only the state changes
// it needs (ESC a, ESC E, GS !, GS B), its ASCII and LF; then every style reset (never a second ESC @), ESC J 16 for the
// picture's 16-row bottom pad and the picture's own cut.

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));
const line = (text: string, over: Partial<TextLine> = {}): TextLine => ({ text, align: "left", bold: false, size: "normal", invert: false, ...over });
const END = [0x1b, 0x4a, RASTER_BOTTOM_PAD_ROWS, ...CUT_PARTIAL_WITH_FEED];

test("a plain line: init, its text, LF, the pad and the cut", () => {
  assert.deepEqual(Array.from(escposTextJob([line("Order 42")], 48)), [...ESC_INIT, ...ascii("Order 42"), 0x0a, ...END], "the smallest job");
});

test("each style is sent when it changes, and reset once at the end", () => {
  const pieces: TextPiece[] = [
    line("KITCHEN ORDER", { align: "center", bold: true, size: "tall" }),
    line("#12", { align: "center", bold: true, size: "big" }),
    { feedDots: 12 },
    line("Order", {}),
    line("REPRINT", { bold: true, invert: true }),
  ];
  const expected = [
    ...ESC_INIT,
    0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x01, ...ascii("KITCHEN ORDER"), 0x0a,
    0x1d, 0x21, 0x11, ...ascii("#12"), 0x0a,
    0x1b, 0x4a, 12,
    0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0x00, ...ascii("Order"), 0x0a,
    0x1b, 0x45, 1, 0x1d, 0x42, 1, ...ascii("REPRINT"), 0x0a,
    0x1d, 0x42, 0, 0x1b, 0x45, 0,
    ...END,
  ];
  assert.deepEqual(Array.from(escposTextJob(pieces, 48)), expected, "only the changes, then the resets");
  const bytes = Array.from(escposTextJob(pieces, 48));
  assert.equal(bytes.filter((b, i) => b === 0x1b && bytes[i + 1] === 0x40).length, 1, "ESC @ is sent once, at the start");
});

test("an empty line is a bare LF", () => {
  assert.deepEqual(Array.from(escposTextJob([line("Note"), line("")], 32)), [...ESC_INIT, ...ascii("Note"), 0x0a, 0x0a, ...END], "LF alone");
});

test("a blank slip, a line too long for its size, a character outside ASCII and a bad feed are refused", () => {
  assert.throws(() => escposTextJob([line(""), line("   ")], 48), /blank slip/, "nothing to print");
  assert.throws(() => escposTextJob([line("x".repeat(48))], 48), /longer than 47/, "48 characters on 48 columns");
  assert.throws(() => escposTextJob([line("x".repeat(24), { size: "big" })], 48), /longer than 23/, "24 double-width characters");
  assert.doesNotThrow(() => escposTextJob([line("x".repeat(47)), line("y".repeat(23), { size: "big" })], 48), "the widest lines pass");
  assert.throws(() => escposTextJob([line("Café")], 48), /not printable ASCII/, "a mapped layout never sends é");
  assert.throws(() => escposTextJob([line("a"), { feedDots: 0 }], 48), /feed/, "a zero feed");
  assert.throws(() => escposTextJob([line("a"), { feedDots: 256 }], 48), /feed/, "a feed past ESC J's 255");
});
```

Create `apps/cafe/lib/printer/kot-text/text-layout.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutRows, lineWidth, textColumnsOf, textSizeOf, wrapWords, type RowStyle, type TextLine, type TextPiece } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.3): a design's rows become printed lines: sizes from the picture's em ratio,
// at most one character less than the columns per line, words wrapped, label / value and item rows, rules and bands.

const plain: RowStyle = { align: "left", bold: false, ratio: 1 };
const textsOf = (pieces: TextPiece[] | null): string[] => {
  assert.ok(pieces !== null, "the rows are printable");
  return pieces.map((piece) => ("text" in piece ? piece.text : `<feed ${piece.feedDots}>`));
};
const lineOf = (pieces: TextPiece[] | null, i: number): TextLine => {
  assert.ok(pieces !== null, "the rows are printable");
  const piece = pieces[i];
  assert.ok(piece !== undefined && "text" in piece, `piece ${i} is a line`);
  return piece;
};

test("a line's size follows the picture's em ratio", () => {
  assert.equal(textSizeOf(0.86), "normal", "a small line is normal");
  assert.equal(textSizeOf(1.19), "normal", "below 1.2 is normal");
  assert.equal(textSizeOf(1.2), "tall", "1.2 is double height");
  assert.equal(textSizeOf(1.29), "tall", "Classic's title is double height");
  assert.equal(textSizeOf(1.49), "tall", "below 1.5 is double height");
  assert.equal(textSizeOf(1.5), "big", "1.5 is double width and height");
  assert.equal(textSizeOf(2.2), "big", "Kitchen Bold's ticket number is double size");
});

test("columns come from the paper, with the 42 choice on 80 mm only", () => {
  assert.equal(textColumnsOf("58mm", false), 32, "58 mm prints 32 columns");
  assert.equal(textColumnsOf("58mm", true), 32, "the 42 choice does not apply to 58 mm");
  assert.equal(textColumnsOf("80mm", false), 48, "80 mm prints 48 columns");
  assert.equal(textColumnsOf("80mm", true), 42, "an 80 mm printer set to 42");
});

test("a line holds one character less than the columns, half of that at double width", () => {
  assert.equal(lineWidth(48, "normal"), 47, "48 columns: 47 characters");
  assert.equal(lineWidth(48, "tall"), 47, "double height keeps the width");
  assert.equal(lineWidth(48, "big"), 23, "double width: 23");
  assert.equal(lineWidth(42, "big"), 20, "42 columns at double width: 20");
  assert.equal(lineWidth(32, "normal"), 31, "32 columns: 31");
  assert.equal(lineWidth(32, "big"), 15, "32 columns at double width: 15");
});

test("words wrap greedily, a word longer than the line is split, and the first line may be shorter", () => {
  assert.deepEqual(wrapWords("Paneer Tikka Masala", 12), ["Paneer Tikka", "Masala"], "greedy at spaces");
  assert.deepEqual(wrapWords("Supercalifragilistic", 8), ["Supercal", "ifragili", "stic"], "a long word is split");
  assert.deepEqual(wrapWords("a b c d e f", 5, 3), ["a b", "c d e", "f"], "the first line has its own width");
  assert.deepEqual(wrapWords("  spaced   out  ", 20), ["spaced out"], "runs of spaces are one");
  assert.deepEqual(wrapWords("", 10), [""], "an empty text is one empty line");
});

test("a text row is mapped, wrapped and styled; a band is padded to the full width", () => {
  const centred = layoutRows([{ kind: "text", text: "KITCHEN ORDER", style: { align: "center", bold: true, ratio: 1.29 } }], 48);
  assert.deepEqual(lineOf(centred, 0), { text: "KITCHEN ORDER", align: "center", bold: true, size: "tall", invert: false }, "a tall bold centred title");
  const band = layoutRows([{ kind: "text", text: "REPRINT", style: { align: "center", bold: true, ratio: 1.29, invert: true } }], 48);
  assert.equal(lineOf(band, 0).text, `${" ".repeat(20)}REPRINT${" ".repeat(20)}`, "the band spans 47 characters, the word centred");
  assert.equal(lineOf(band, 0).align, "left", "a padded band needs no alignment command");
  const bigBand = layoutRows([{ kind: "text", text: "KOT 12", style: { align: "left", bold: true, ratio: 2.2, invert: true } }], 48);
  assert.equal(lineOf(bigBand, 0).text, `KOT 12${" ".repeat(17)}`, "a double-size band spans 23 characters");
  const indented = layoutRows([{ kind: "text", text: "Less sugar and extra ginger please", style: { ...plain, ratio: 0.86, indent: 4 } }], 32);
  assert.deepEqual(textsOf(indented), ["    Less sugar and extra ginger", "    please"], "an indented line wraps inside its indent");
  const upper = layoutRows([{ kind: "text", text: "Test Cafe", style: { ...plain, upper: true } }], 48);
  assert.deepEqual(textsOf(upper), ["TEST CAFE"], "upper case on request");
  const kept = layoutRows([{ kind: "text", text: "Line one\n\nLine three", style: plain, keepBreaks: true }], 48);
  assert.deepEqual(textsOf(kept), ["Line one", "", "Line three"], "custom text keeps its line breaks");
  const joined = layoutRows([{ kind: "text", text: "Line one\nLine two", style: plain }], 48);
  assert.deepEqual(textsOf(joined), ["Line one Line two"], "elsewhere a line break is a space");
  assert.deepEqual(textsOf(layoutRows([{ kind: "text", text: "   ", style: plain }], 48)), [], "a blank text prints nothing");
});

test("a label / value row keeps its ends, and moves the value under the label when they do not fit", () => {
  const fits = layoutRows([{ kind: "split", label: "Table", value: "T-4", style: plain }], 32);
  assert.deepEqual(textsOf(fits), [`Table${" ".repeat(23)}T-4`], "label left, value right in 31 characters");
  const long = layoutRows([{ kind: "split", label: "Staff", value: "Aishwarya Ramachandran Iyer", style: plain }], 32);
  assert.deepEqual(textsOf(long), ["Staff", "    Aishwarya Ramachandran Iyer"], "the value drops to its own line, right-aligned");
});

test("an item row keeps the amount on its first line; the name wraps from the start or under its hang", () => {
  const short = layoutRows([{ kind: "item", name: "2 × Masala Chai", amount: "₹80", style: { ...plain, bold: true }, hang: 0 }], 48);
  assert.deepEqual(textsOf(short), [`2 x Masala Chai${" ".repeat(27)}Rs 80`], "mapped, the amount flush right");
  const classic = layoutRows([{ kind: "item", name: "1 × Paneer Butter Masala With Extra Gravy", amount: "₹1,240", style: plain, hang: 0 }], 32);
  assert.deepEqual(textsOf(classic), [`${"1 x Paneer Butter".padEnd(23)}Rs 1,240`, "Masala With Extra Gravy"], "Classic wraps from the line's start");
  const bold = layoutRows([{ kind: "item", name: "[1] Paneer Butter Masala With Extra Gravy", amount: "", style: { ...plain, upper: true }, hang: 4 }], 32);
  assert.deepEqual(textsOf(bold), ["[1] PANEER BUTTER MASALA WITH", "    EXTRA GRAVY"], "Kitchen Bold wraps under the name");
});

test("rules span the line; a blank rule is an empty line and an ornament is centred", () => {
  const rules = layoutRows(
    [{ kind: "rule", rule: "dashed" }, { kind: "rule", rule: "solid" }, { kind: "rule", rule: "double" }, { kind: "rule", rule: "blank" }, { kind: "rule", rule: "ornament" }],
    32,
  );
  assert.deepEqual(
    textsOf(rules),
    ["- - - - - - - - - - - - - - - -", "-".repeat(31), "=".repeat(31), "", "* * * * *"],
    "dashed, solid, double, blank, ornament",
  );
  assert.equal(lineOf(rules, 4).align, "center", "the ornament is centred");
});

test("a feed row is a feed; any character text cannot print makes the whole layout null", () => {
  assert.deepEqual(textsOf(layoutRows([{ kind: "feed", dots: 12 }], 48)), ["<feed 12>"], "a feed passes through");
  assert.equal(layoutRows([{ kind: "text", text: "Paneer Tikka", style: plain }, { kind: "text", text: "पनीर", style: plain }], 48), null, "Hindi anywhere: null");
  assert.equal(layoutRows([{ kind: "split", label: "Staff", value: "Ramesh ભાઈ", style: plain }], 48), null, "Gujarati in a value: null");
  assert.equal(layoutRows([{ kind: "item", name: "1 × Crème brûlée", amount: "₹200", style: plain, hang: 0 }], 48), null, "an accented name: null");
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/printer/raster.test.ts",
    "lib/printer/kot-text/text-chars.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

Replace it with:

```json
    "lib/printer/raster.test.ts",
    "lib/printer/kot-text/text-chars.test.ts",
    "lib/printer/kot-text/text-layout.test.ts",
    "lib/printer/kot-text/text-escpos.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-layout.test.ts lib/printer/kot-text/text-escpos.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
# Error: Cannot find module './text-escpos'
not ok 1 - lib\\printer\\kot-text\\text-escpos.test.ts
# Error: Cannot find module './text-layout'
not ok 2 - lib\\printer\\kot-text\\text-layout.test.ts
# tests 2
# pass 0
# fail 2
```

- [ ] **Step 3: Implement**

Create `apps/cafe/lib/printer/kot-text/text-escpos.ts`:

```ts
import type { BlockAlign } from "@pos/shared/print-template";
import { CUT_PARTIAL_WITH_FEED, ESC_INIT, RASTER_BOTTOM_PAD_ROWS } from "../escpos";
import { PRINTABLE_MAX, PRINTABLE_MIN } from "./text-chars";
import { lineWidth, type TextPiece, type TextSize } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.3): a text job's bytes. Only standard ESC/POS commands every receipt printer
// knows: ESC @ (once, first), ESC a (alignment), ESC E (bold), GS ! (character size), GS B (white on black), LF, ESC J
// (a feed) and the picture's own cut. ESC J n feeds n of the printer's vertical motion units: a dot (1/203 inch) on most
// receipt printers, finer on some (1/360 inch on Epson TM), so a feed is about, not exactly, the picture's gap. No code page command: the text is printable ASCII (text-chars.ts). The
// raster encoder (escpos.ts) is only read from, for the init, the bottom pad and the cut, so both kinds of slip begin
// and end the same way.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const ALIGN_BYTE: Record<BlockAlign, number> = { left: 0, center: 1, right: 2 };
// GS ! n: width multiplier - 1 in the high nibble, height multiplier - 1 in the low one.
const SIZE_BYTE: Record<TextSize, number> = { normal: 0x00, tall: 0x01, big: 0x11 };
/** ESC J n takes one byte. */
const FEED_DOTS_MAX = 255;

/** The bytes for the pieces at `columns`. Throws on a blank slip, a line longer than its size allows, a character outside
 *  printable ASCII or a bad feed: the caller then prints the slip as a picture (spec S3), never these bytes. */
export function escposTextJob(pieces: readonly TextPiece[], columns: number): Uint8Array {
  if (!pieces.some((piece) => "text" in piece && piece.text.trim() !== "")) {
    throw new RangeError("escposTextJob: a blank slip is never sent");
  }
  const out: number[] = Array.from(ESC_INIT);
  let align = ALIGN_BYTE.left;
  let bold = false;
  let size = SIZE_BYTE.normal;
  let invert = false;
  for (const piece of pieces) {
    if ("feedDots" in piece) {
      if (!Number.isInteger(piece.feedDots) || piece.feedDots < 1 || piece.feedDots > FEED_DOTS_MAX) {
        throw new RangeError(`escposTextJob: a feed of ${piece.feedDots} dots`);
      }
      out.push(ESC, 0x4a, piece.feedDots);
      continue;
    }
    const most = lineWidth(columns, piece.size);
    if (piece.text.length > most) throw new RangeError(`escposTextJob: a ${piece.size} line longer than ${most}`);
    if (ALIGN_BYTE[piece.align] !== align) {
      align = ALIGN_BYTE[piece.align];
      out.push(ESC, 0x61, align);
    }
    if (piece.bold !== bold) {
      bold = piece.bold;
      out.push(ESC, 0x45, bold ? 1 : 0);
    }
    if (SIZE_BYTE[piece.size] !== size) {
      size = SIZE_BYTE[piece.size];
      out.push(GS, 0x21, size);
    }
    if (piece.invert !== invert) {
      invert = piece.invert;
      out.push(GS, 0x42, invert ? 1 : 0);
    }
    for (let i = 0; i < piece.text.length; i++) {
      const code = piece.text.charCodeAt(i);
      if (code < PRINTABLE_MIN || code > PRINTABLE_MAX) throw new RangeError("escposTextJob: a character that is not printable ASCII");
      out.push(code);
    }
    out.push(LF);
  }
  // Every style back to the power-on state, without ESC @ (some printers drop buffered text on it).
  if (invert) out.push(GS, 0x42, 0);
  if (size !== SIZE_BYTE.normal) out.push(GS, 0x21, SIZE_BYTE.normal);
  if (bold) out.push(ESC, 0x45, 0);
  if (align !== ALIGN_BYTE.left) out.push(ESC, 0x61, ALIGN_BYTE.left);
  out.push(ESC, 0x4a, RASTER_BOTTOM_PAD_ROWS, ...CUT_PARTIAL_WITH_FEED);
  return Uint8Array.from(out);
}
```

Create `apps/cafe/lib/printer/kot-text/text-layout.ts`:

```ts
import type { BlockAlign, DividerStyle } from "@pos/shared/print-template";
import type { PaperWidth } from "@/lib/constants";
import { asciiText } from "./text-chars";

// Printing Phase 4 (spec 2026-10-15 §4.3): the rows a design's text renderer says a block prints become the lines a
// printer prints in its own Font A. Pure: no React, no DOM, no printer. A row's characters are mapped and checked here
// (text-chars.ts); one character text cannot print makes the whole layout null, and the slip prints as a picture.

/** The printer's character sizes text mode uses: normal, double height, double width and height. */
export type TextSize = "normal" | "tall" | "big";

/** A line whose size in the picture is at least this many times the base prints double height (spec §4.3). */
export const TEXT_TALL_MIN_RATIO = 1.2;
/** …and at least this many times, double width and height. */
export const TEXT_BIG_MIN_RATIO = 1.5;

/** Font A's columns per paper (spec P4-5): 32 on 58 mm, 48 on 80 mm, or 42 for an 80 mm printer with a narrower head. */
export const TEXT_COLUMNS_58MM = 32;
export const TEXT_COLUMNS_80MM = 48;
export const TEXT_COLUMNS_80MM_NARROW = 42;
export type TextColumns = typeof TEXT_COLUMNS_58MM | typeof TEXT_COLUMNS_80MM | typeof TEXT_COLUMNS_80MM_NARROW;
export const TEXT_COLUMN_CHOICES: readonly TextColumns[] = [TEXT_COLUMNS_58MM, TEXT_COLUMNS_80MM_NARROW, TEXT_COLUMNS_80MM];

/** A line leaves its last column empty: a printer that moves to the next line by itself when a line is exactly full
 *  would otherwise add a blank line (spec §4.3). */
const SPARE_COLUMNS = 1;

export function textSizeOf(ratio: number): TextSize {
  if (ratio >= TEXT_BIG_MIN_RATIO) return "big";
  return ratio >= TEXT_TALL_MIN_RATIO ? "tall" : "normal";
}

export function textColumnsOf(paper: PaperWidth, narrow80: boolean): TextColumns {
  if (paper === "58mm") return TEXT_COLUMNS_58MM;
  return narrow80 ? TEXT_COLUMNS_80MM_NARROW : TEXT_COLUMNS_80MM;
}

/** The most characters one line holds at a size. */
export function lineWidth(columns: number, size: TextSize): number {
  const usable = columns - SPARE_COLUMNS;
  return size === "big" ? Math.floor(usable / 2) : usable;
}

/** One printed line: printable ASCII, never longer than lineWidth at its size. */
export interface TextLine {
  text: string;
  align: BlockAlign;
  bold: boolean;
  size: TextSize;
  invert: boolean;
}

/** A paper feed, ESC J n: n of the printer's vertical motion units (a dot on most receipt printers, finer on some). */
export interface TextFeed {
  feedDots: number;
}

export type TextPiece = TextLine | TextFeed;

/** How a row prints. `ratio` is the line's size in the picture relative to the 14 px base (spec §4.3). */
export interface RowStyle {
  align: BlockAlign;
  bold: boolean;
  ratio: number;
  invert?: boolean;
  /** Upper case, as the design's CSS `uppercase` shows it (a row's text; an item's name, never its amount). */
  upper?: boolean;
  /** Spaces before each line of a left-aligned row. */
  indent?: number;
}

/** What a design's text renderer says a block prints, before the characters are checked and the lines wrapped. */
export type TextRow =
  /** Free text; `keepBreaks` keeps its line breaks (custom text), elsewhere a break is a space. */
  | { kind: "text"; text: string; style: RowStyle; keepBreaks?: boolean }
  /** A label left and its value right; a pair that does not fit puts the value under the label, right-aligned. */
  | { kind: "split"; label: string; value: string; style: RowStyle }
  /** An item: its name left and its amount ("" for none) right on the first line; the name wraps, its later lines
   *  starting `hang` columns in. */
  | { kind: "item"; name: string; amount: string; style: RowStyle; hang: number }
  | { kind: "rule"; rule: DividerStyle }
  | { kind: "feed"; dots: number };

/** An item's first line keeps at least this much room for its name; a longer amount goes to a line of its own. */
const ITEM_NAME_MIN_COLUMNS = 6;
const ORNAMENT_TEXT = "* * * * *";

/** Greedy word wrap at spaces; a word longer than a line is split. The first line may have its own width. Always at
 *  least one line (an empty text is one empty line). */
export function wrapWords(text: string, width: number, firstWidth: number = width): string[] {
  const words = text.split(" ").filter((word) => word !== "");
  const lines: string[] = [];
  let line = "";
  const room = (): number => Math.max(1, lines.length === 0 ? firstWidth : width);
  for (const whole of words) {
    let word = whole;
    while (word.length > 0) {
      const cap = room();
      if (line === "") {
        const part = word.slice(0, cap);
        word = word.slice(part.length);
        if (word.length > 0) lines.push(part);
        else line = part;
      } else if (line.length + 1 + word.length <= cap) {
        line = `${line} ${word}`;
        word = "";
      } else {
        lines.push(line);
        line = "";
      }
    }
  }
  if (line !== "" || lines.length === 0) lines.push(line);
  return lines;
}

function bandOf(text: string, width: number, align: BlockAlign): string {
  const pad = Math.max(0, width - text.length);
  if (align === "right") return " ".repeat(pad) + text;
  if (align === "center") return " ".repeat(Math.floor(pad / 2)) + text + " ".repeat(pad - Math.floor(pad / 2));
  return text + " ".repeat(pad);
}

function lineOf(text: string, style: RowStyle, size: TextSize, width: number): TextLine {
  const invert = style.invert === true;
  return {
    text: invert ? bandOf(text, width, style.align) : text,
    // A band carries its own placement in its spaces.
    align: invert ? "left" : style.align,
    bold: style.bold,
    size,
    invert,
  };
}

function textLines(row: Extract<TextRow, { kind: "text" }>, columns: number): TextLine[] | null {
  const mapped = asciiText(row.text);
  if (mapped === null) return null;
  const cased = row.style.upper === true ? mapped.toUpperCase() : mapped;
  const segments = row.keepBreaks === true ? cased.split("\n").map((s) => s.trimEnd()) : [cased.replace(/\s+/g, " ").trim()];
  if (segments.length === 1 && segments[0] === "") return [];
  const size = textSizeOf(row.style.ratio);
  const width = lineWidth(columns, size);
  const indent = row.style.indent ?? 0;
  const margin = " ".repeat(indent);
  return segments.flatMap((segment) => wrapWords(segment, width - indent).map((part) => lineOf(margin + part, row.style, size, width)));
}

function splitLines(row: Extract<TextRow, { kind: "split" }>, columns: number): TextLine[] | null {
  const label = asciiText(row.label);
  const value = asciiText(row.value);
  if (label === null || value === null) return null;
  const l = label.replace(/\s+/g, " ").trim();
  const v = value.replace(/\s+/g, " ").trim();
  const size = textSizeOf(row.style.ratio);
  const width = lineWidth(columns, size);
  const left: RowStyle = { ...row.style, align: "left" };
  if (v === "") return wrapWords(l, width).map((part) => lineOf(part, left, size, width));
  if (l.length + 1 + v.length <= width) return [lineOf(l + " ".repeat(width - l.length - v.length) + v, left, size, width)];
  return [
    ...wrapWords(l, width).map((part) => lineOf(part, left, size, width)),
    ...wrapWords(v, width).map((part) => lineOf(part.padStart(width), left, size, width)),
  ];
}

function itemLines(row: Extract<TextRow, { kind: "item" }>, columns: number): TextLine[] | null {
  const name = asciiText(row.name);
  const amount = asciiText(row.amount);
  if (name === null || amount === null) return null;
  const n = (row.style.upper === true ? name.toUpperCase() : name).replace(/\s+/g, " ").trim();
  const a = amount.replace(/\s+/g, " ").trim();
  const size = textSizeOf(row.style.ratio);
  const width = lineWidth(columns, size);
  const left: RowStyle = { ...row.style, align: "left" };
  const hang = " ".repeat(row.hang);
  const rest = width - row.hang;
  const firstWidth = a === "" ? width : width - a.length - 1;
  if (firstWidth < ITEM_NAME_MIN_COLUMNS) {
    const named = wrapWords(n, rest, width).map((part, i) => lineOf(i === 0 ? part : hang + part, left, size, width));
    return [...named, lineOf(a.padStart(width), left, size, width)];
  }
  return wrapWords(n, rest, firstWidth).map((part, i) => {
    if (i > 0) return lineOf(hang + part, left, size, width);
    return lineOf(a === "" ? part : part.padEnd(width - a.length) + a, left, size, width);
  });
}

function ruleLine(rule: DividerStyle, columns: number): TextLine {
  const width = lineWidth(columns, "normal");
  const plain = { align: "left" as const, bold: false, size: "normal" as const, invert: false };
  switch (rule) {
    case "dashed":
      return { ...plain, text: "- ".repeat(Math.ceil(width / 2)).slice(0, width).trimEnd() };
    case "solid":
      return { ...plain, text: "-".repeat(width) };
    case "double":
      return { ...plain, text: "=".repeat(width) };
    case "blank":
      return { ...plain, text: "" };
    case "ornament":
      return { ...plain, text: ORNAMENT_TEXT, align: "center" };
  }
}

/** Every row as printed pieces, or null when any of them holds a character text cannot print. */
export function layoutRows(rows: readonly TextRow[], columns: number): TextPiece[] | null {
  const pieces: TextPiece[] = [];
  for (const row of rows) {
    if (row.kind === "feed") {
      pieces.push({ feedDots: row.dots });
      continue;
    }
    if (row.kind === "rule") {
      pieces.push(ruleLine(row.rule, columns));
      continue;
    }
    const lines = row.kind === "text" ? textLines(row, columns) : row.kind === "split" ? splitLines(row, columns) : itemLines(row, columns);
    if (lines === null) return null;
    pieces.push(...lines);
  }
  return pieces;
}
```

- [ ] **Step 4: Run them, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-layout.test.ts lib/printer/kot-text/text-escpos.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint lib/printer/kot-text && echo "typecheck and lint clean"
```
Expected:
```text
# tests 13
# pass 13
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4a-2.txt`, then `git add apps/cafe/lib/printer/kot-text apps/cafe/package.json && git commit -F "$SP/msg-4a-2.txt"`:

```text
feat(cafe): printing Phase 4 Session 4A, text KOT lines and their ESC/POS bytes: the size from the picture's em ratio (normal, double height, double size), a line one character short of the columns (32, 42 or 48), word wrap, label / value and item rows, rules and white-on-black bands; the job is ESC @, the state changes each line needs, LF, every style reset, the picture's bottom pad and cut (spec §4.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 3: Classic as text, and the gate (§4.1, §4.3, S3)

**Files:**
- Create: `apps/cafe/lib/printer/kot-text/kot-text-design.ts`, `kot-text-classic.ts`, `kot-text.ts`
- Test: `kot-text.fixtures.ts`, `kot-text.test.ts` (same folder); `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Consumes: Tasks 1–2; `kotSlipContext`, `kotLockContext` (`components/print/slip/slip-context.ts`); `kitchenOrderOf`,
  `kitchenLinesOf` (`lib/kitchen-lines.ts`); `kotTemplateOf` (`lib/print-template-resolve.ts`); `classicKotTemplate`
  (`lib/print-template-legacy.ts`); `printConfigOf`; `kotBlockLocked`; `HostKotSlip` (`lib/print-host-slips.ts`); the
  golden fixtures (`lib/print-template-golden.fixtures.ts`: `KOT_PROP_SETS`, `settingsOf`, `LOGO_REF`).
- Produces: `PICTURE_ONLY`; `interface KotTextContext extends KotSlipContext { showsPrices }`; `type KotTextRenderers`;
  `interface KotTextDesign { rows; groupRatio }`; `TEXT_BASE_RATIO`, `TEXT_BLOCK_SIZE_RATIO`, `TEXT_LOCKED_MIN_SIZE`,
  `TEXT_ITEM_GAP_DOTS = 12`, `TEXT_SUB_LINE_INDENT = 4`; `textRow`, `keptTextRow`, `splitRow`, `ITEM_GAP`;
  `KOT_TEXT_CLASSIC`; `KOT_TEXT_DESIGNS: Partial<Record<KotDesign, KotTextDesign>>`;
  `type KotTextRefusal = "design" | "block" | "picture" | "characters" | "empty" | "error"`;
  `interface KotTextInput { slip: HostKotSlip; settings; columns: TextColumns }`; `kotTextPlan(input): KotTextPlan`;
  `kotTextJob(input): { ok: true; bytes } | { ok: false; refusal }` (never throws). Fixtures: `slipOf(id, over?)`,
  `shownPieces(pieces)`. **Session 4B calls `kotTextJob`.**

- [ ] **Step 1: Write the failing test**

Create `apps/cafe/lib/printer/kot-text/kot-text.fixtures.ts`:

```ts
import { KOT_PROP_SETS } from "../../print-template-golden.fixtures"; // FIRST: React's production build
import type { HostKotSlip } from "@/lib/print-host-slips";

// The text KOT tests' slips (printing Phase 4): the Classic golden's KOT prop sets as the print bridge hands them over
// (print-host-slips.ts HostKotSlip), so the text side and the picture side read the same orders.

/** A golden prop set as the print bridge's slip. Throws for a set with no order (the bridge never has one). */
export function slipOf(id: string, over: Partial<HostKotSlip> = {}): HostKotSlip {
  const set = KOT_PROP_SETS.find((s) => s.id === id);
  if (set === undefined || set.order === null) throw new Error(`prop set ${id} has no order`);
  const e = set.extra;
  return {
    surface: "kot",
    order: set.order,
    kotRoundItems: e.roundItems,
    kotRoundLabel: e.roundLabel,
    kotRoundNumber: e.roundNumber,
    kotVariant: e.variant ?? "kot",
    voidReason: e.reason,
    voidedBy: e.voidedBy,
    voidedAt: e.voidedAt,
    movedFrom: e.movedFrom,
    movedBy: e.movedBy,
    movedAt: e.movedAt,
    banner: e.banner,
    documentTitle: `kot-${set.order.orderId}`,
    ...over,
  };
}

/** Each printed piece as `<size><B><I><align>|text|`, or `feed n`: a golden line list. */
export function shownPieces(pieces: ReadonlyArray<{ text: string; size: string; bold: boolean; invert: boolean; align: string } | { feedDots: number }>): string[] {
  return pieces.map((p) =>
    "text" in p ? `${p.size.padEnd(6)}${p.bold ? "B" : " "}${p.invert ? "I" : " "}${p.align[0]}|${p.text}|` : `feed ${p.feedDots}`,
  );
}
```

Create `apps/cafe/lib/printer/kot-text/kot-text.test.ts`:

```ts
import { LOGO_REF, settingsOf } from "../../print-template-golden.fixtures"; // FIRST: React's production build
import { test } from "node:test";
import assert from "node:assert/strict";

import type { KotBlock, KotTemplate } from "@pos/shared/print-template";
import { CUT_PARTIAL_WITH_FEED, ESC_INIT } from "@/lib/printer/escpos";
import type { HostKotSlip } from "@/lib/print-host-slips";
import { classicKotTemplate } from "@/lib/print-template-legacy";
import type { Settings } from "@/types";
import { KOT_TEXT_CLASSIC } from "./kot-text-classic";
import { KOT_TEXT_DESIGNS, kotTextJob, kotTextPlan, type KotTextPlan } from "./kot-text";
import { shownPieces, slipOf } from "./kot-text.fixtures";
import type { TextColumns } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.1, §4.3): a kitchen-surface slip as text, with Classic's look, or the reason it
// prints as a picture. The golden lines were read against the picture (the parity test pins the words).

function shown(plan: KotTextPlan): string[] {
  assert.ok(plan.ok, `the slip prints as text (${plan.ok ? "" : plan.refusal})`);
  return shownPieces(plan.pieces);
}

const plain = settingsOf({ logo: "" });
const planOf = (slip: HostKotSlip, settings: Settings = plain, columns: TextColumns = 48) => kotTextPlan({ slip, settings, columns });
const withTemplate = (blocks: (template: KotTemplate) => KotBlock[], over: Partial<Settings> = {}): Settings => {
  const settings = settingsOf({ logo: "", ...over });
  const template = classicKotTemplate(settings);
  return { ...settings, kotTemplate: { ...template, blocks: blocks(template) } } as Settings;
};

test("a round's KOT on 80 mm, as Classic prints it", () => {
  assert.deepEqual(shown(planOf(slipOf("round-label-number"))), [
    "tall  B c|KITCHEN ORDER|",
    "big   B c|#7|",
    "normalB c|Round 1|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    "normal  l|Order                          ORD-20261004-042|",
    "normal  l|Table                                        T4|",
    "normal  l|Time                                   10:45 am|",
    "normal  l|Staff                                      Asha|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    "normalB l|2 x Masala Chai                           Rs 80|",
    "normal  l|    + Less sugar, Extra ginger|",
    "normalB l|    > Hot please|",
    "feed 12",
    "normalB l|1 x Pizza (Large)                        Rs 300|",
    "normal  l|    NO Onion|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    "normalB l|Note: Birthday table, no peanuts|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    "normal  c|3 item(s)|",
    "normalB c|Round total: Rs 380|",
  ], "Classic's round KOT, line for line");
});

test("the same KOT on 58 mm wraps inside 31 characters", () => {
  const lines = shown(planOf(slipOf("round-label-number"), plain, 32));
  assert.ok(lines.includes("normal  l|Order          ORD-20261004-042|"), "the meta row fits 31");
  assert.ok(lines.includes("normalB l|2 x Masala Chai           Rs 80|"), "the item row fits 31");
  assert.ok(lines.includes("normalB l|Note: Birthday table, no|") && lines.includes("normalB l|peanuts|"), "the note wraps");
});

test("a VOID, a cancel notice and a TABLE MOVED slip keep their loud titles and their rules", () => {
  const voided = shown(planOf(slipOf("void-reason-by-at")));
  assert.deepEqual(voided.slice(0, 2), ["tall  B c|*** VOID ***|", "normalB c|CANCELLED ITEMS - DO NOT MAKE|"], "the void title");
  assert.ok(voided.includes("normal  l|Staff                                     Owner|"), "the voider, not the tab's opener");
  assert.ok(voided.includes("normalB l|Reason: Guest changed mind|"), "the reason");
  assert.equal(voided.at(-2), "normal  c|1 item(s) VOIDED|", "the voided count");
  const cancelled = shown(planOf(slipOf("cancel-notice-reason")));
  assert.ok(cancelled.includes("normalB l|3 x Cold Coffee                          Rs 360|"), "a cancel notice lists every item");
  const moved = shown(planOf(slipOf("moved-from-by-at")));
  assert.deepEqual(moved.slice(0, 2), ["tall  B c|*** TABLE MOVED ***|", "normalB c|FOOD ALREADY ORDERED - DO NOT MAKE AGAIN|"], "the moved title");
  assert.ok(moved.includes("normal  l|Table                                  T2 -> T4|"), "from -> to");
  assert.ok(!moved.some((line) => line.includes(" x ")), "a moved slip lists no items");
});

test("the job's banner is a white-on-black band; a station line prints under the title", () => {
  const lines = shown(planOf(slipOf("round-banner-reprint", { banner: "BACKUP PRINTER · REPRINT", stationLine: "BAR" })));
  assert.equal(lines[0], `tall  BIl|${"BACKUP PRINTER - REPRINT".padStart(35).padEnd(47)}|`, "the band spans the line, centred");
  assert.deepEqual(lines.slice(1, 3), ["tall  B c|KITCHEN ORDER|", "tall  B c|BAR|"], "title, then the station");
});

test("a block's own size, alignment and weight, and the template's base size", () => {
  const big = withTemplate((t) => t.blocks.map((b) => (b.type === "title" ? { ...b, size: "xl", align: "left", bold: false } : b)));
  assert.equal(shown(planOf(slipOf("round-label-number"), big))[0], "big     l|KITCHEN ORDER|", "1.29em x 1.5: double size, left, regular");
  const small = withTemplate((t) => t.blocks, { kotFontSize: "small" });
  assert.equal(shown(planOf(slipOf("round-label-number"), small))[0], "normalB c|KITCHEN ORDER|", "1.29em at 12 px is normal size");
  const locked = withTemplate((t) => t.blocks.map((b) => (b.type === "title" ? { ...b, size: "xs" } : b)));
  assert.equal(shown(planOf(slipOf("void-reason-by-at"), locked))[0], "normalB c|*** VOID ***|", "a locked title shrinks to sm, never xs");
});

test("Show ticket number alone decides the number, on the legacy ticket and on a saved template (SlipEngine)", () => {
  const numbered = (settings: Settings): boolean => shown(planOf(slipOf("round-label-number"), settings)).includes("big   B c|#7|");
  assert.equal(numbered(settingsOf({ logo: "", kotShowNumber: false })), false, "the setting off: no number on the legacy ticket");
  const blockOn = withTemplate((t) => t.blocks.map((b) => (b.type === "kotNo" ? { ...b, on: true } : b)), { kotShowNumber: false });
  assert.equal(numbered(blockOn), false, "the setting off: no number even with the number's block on");
  const blockOff = withTemplate((t) => t.blocks.map((b) => (b.type === "kotNo" ? { ...b, on: false } : b)));
  assert.equal(numbered(blockOff), true, "the setting on: the number prints even with its block off");
});

test("custom text keeps its line breaks; a QR line with no usable link prints nothing", () => {
  const settings = withTemplate((t) => [
    ...t.blocks,
    { id: "customText-1", type: "customText", on: true, options: { text: "Thank you\nCome again" } },
    { id: "qr-1", type: "qr", on: true, options: { content: "link", url: "http://not-https.example" } },
  ]);
  const lines = shown(planOf(slipOf("round-label-number"), settings));
  assert.deepEqual(lines.slice(-2), ["normal  c|Thank you|", "normal  c|Come again|"], "two lines, centred, nothing for the QR");
});

test("a slip text cannot print exactly prints as a picture", () => {
  const refusal = (plan: KotTextPlan): string => (plan.ok ? "ok" : plan.refusal);
  const hindi = slipOf("round-label-number");
  hindi.order = { ...hindi.order, items: hindi.order.items.map((it, i) => (i === 0 ? { ...it, name: "मसाला चाय" } : it)) };
  hindi.kotRoundItems = hindi.order.items.filter((it) => it.kotRound === 1);
  assert.equal(refusal(planOf(hindi)), "characters", "a Hindi item");
  assert.equal(refusal(planOf(slipOf("round-label-number", { order: { ...slipOf("round-label-number").order, receiver: "ભાવેશ" } }))), "characters", "a Gujarati staff name");
  assert.equal(refusal(planOf(slipOf("round-label-number"), settingsOf({ logo: LOGO_REF, kotShowLogo: true }))), "picture", "the logo on, with a logo");
  assert.equal(refusal(planOf(slipOf("round-label-number"), settingsOf({ logo: "", kotShowLogo: true }))), "ok", "the logo on, with no logo: nothing to draw");
  const qr = withTemplate((t) => [...t.blocks, { id: "qr-1", type: "qr", on: true, options: { content: "link", url: "https://menu.example.com" } }]);
  assert.equal(refusal(planOf(slipOf("round-label-number"), qr)), "picture", "a QR code that would print");
});

test("a design or block with no text renderer, or a renderer that throws, is a refusal, never a throw", () => {
  const saved = KOT_TEXT_DESIGNS.classic;
  try {
    KOT_TEXT_DESIGNS.classic = undefined;
    assert.deepEqual(kotTextJob({ slip: slipOf("round-label-number"), settings: plain, columns: 48 }), { ok: false, refusal: "design" }, "no design");
    const { items: _items, ...rest } = KOT_TEXT_CLASSIC.rows;
    KOT_TEXT_DESIGNS.classic = { ...KOT_TEXT_CLASSIC, rows: rest as typeof KOT_TEXT_CLASSIC.rows };
    assert.deepEqual(kotTextJob({ slip: slipOf("round-label-number"), settings: plain, columns: 48 }), { ok: false, refusal: "block" }, "no items renderer");
    KOT_TEXT_DESIGNS.classic = { ...KOT_TEXT_CLASSIC, rows: { ...KOT_TEXT_CLASSIC.rows, items: () => { throw new Error("boom"); } } };
    assert.deepEqual(kotTextJob({ slip: slipOf("round-label-number"), settings: plain, columns: 48 }), { ok: false, refusal: "error" }, "a throwing renderer");
  } finally {
    KOT_TEXT_DESIGNS.classic = saved;
  }
});

test("the job's bytes begin and end as a picture's, and are far smaller", () => {
  const job = kotTextJob({ slip: slipOf("cancel-notice-reason"), settings: plain, columns: 48 });
  assert.ok(job.ok, "the cancel notice prints as text");
  const bytes = Array.from(job.bytes);
  assert.deepEqual(bytes.slice(0, 2), Array.from(ESC_INIT), "ESC @ first");
  assert.deepEqual(bytes.slice(-4), Array.from(CUT_PARTIAL_WITH_FEED), "the picture's cut last");
  assert.ok(bytes.length < 1_500, `a whole-order cancel notice is ${bytes.length} bytes (a picture KOT is about 44,000)`);
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/printer/kot-text/text-layout.test.ts",
    "lib/printer/kot-text/text-escpos.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

Replace it with:

```json
    "lib/printer/kot-text/text-layout.test.ts",
    "lib/printer/kot-text/text-escpos.test.ts",
    "lib/printer/kot-text/kot-text.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/kot-text.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
# Error: Cannot find module './kot-text-classic'
not ok 1 - lib\\printer\\kot-text\\kot-text.test.ts
# tests 1
# pass 0
# fail 1
```

- [ ] **Step 3: Implement**

Create `apps/cafe/lib/printer/kot-text/kot-text-classic.ts`:

```ts
import { orderItemLabel, orderItemModifierLines } from "@pos/shared/utils";
import { isSafeHttpsLink } from "@pos/shared/print-qr";
import { inr } from "@/lib/utils";
import { fmtTime } from "@/components/print/slip/slip-format";
import {
  ITEM_GAP,
  PICTURE_ONLY,
  TEXT_SUB_LINE_INDENT,
  keptTextRow,
  splitRow,
  textRow,
  type KotTextDesign,
} from "./kot-text-design";
import type { TextRow } from "./text-layout";

// Classic's kitchen ticket as text (printing Phase 4, spec 2026-10-15 §4.3): the twin of
// components/print/slip/kot-classic-blocks.tsx (and of the legacy KOTReceipt, whose Classic template is the same
// list). Each block prints the same words in the same order as there (kot-text-parity.test.ts); the sizes are that
// file's em classes: 1.29em lines double height, the ticket number (1.6em) double size, the rest normal.

const MOVED_TITLE = "*** TABLE MOVED ***";
const MOVED_SUBTITLE = "FOOD ALREADY ORDERED — DO NOT MAKE AGAIN";
const VOID_TITLE = "*** VOID ***";
const VOID_SUBTITLE = "CANCELLED ITEMS — DO NOT MAKE";
const KOT_TITLE = "KITCHEN ORDER";

/** Classic's meta wrapper (slip-groups.ts kotMeta: "space-y-0.5 text-[0.93em]"). */
const META_RATIO = 0.93;

export const KOT_TEXT_CLASSIC: KotTextDesign = {
  groupRatio: { orderId: META_RATIO, table: META_RATIO, time: META_RATIO, staff: META_RATIO, voidReason: META_RATIO },
  rows: {
    logo: (_block, { logoUrl }) => (logoUrl ? PICTURE_ONLY : []),
    name: (_block, { restaurantName }) => (restaurantName ? [textRow(restaurantName, 1.29, true, "center")] : []),
    title: (_block, { isMoved, isVoid }) => {
      if (isMoved) return [textRow(MOVED_TITLE, 1.29, true, "center"), textRow(MOVED_SUBTITLE, 0.93, true, "center")];
      if (isVoid) return [textRow(VOID_TITLE, 1.29, true, "center"), textRow(VOID_SUBTITLE, 0.93, true, "center")];
      return [textRow(KOT_TITLE, 1.29, true, "center")];
    },
    kotNo: (_block, { isMoved, roundNumber }) => (!isMoved && roundNumber !== undefined ? [textRow(`#${roundNumber}`, 1.6, true, "center")] : []),
    roundLabel: (_block, { roundLabel }) => (roundLabel ? [textRow(roundLabel, 0.93, true, "center")] : []),
    divider: (block) => [{ kind: "rule", rule: block.options?.style ?? "dashed" }],
    orderId: (_block, { order }) => [splitRow("Order", order.orderId)],
    table: (_block, { order, movedFrom }) => [
      splitRow("Table", movedFrom ? `${movedFrom} → ${order.tableNo ?? "Walk-In"}` : order.tableNo ?? "Walk-In"),
    ],
    time: (_block, { order, movedMeta, voidMeta }) => [splitRow("Time", fmtTime(movedMeta?.at ?? voidMeta?.at ?? order.createdAt))],
    staff: (_block, { order, movedMeta, voidMeta }) => [splitRow("Staff", movedMeta?.by ?? voidMeta?.by ?? order.receiver)],
    voidReason: (_block, { isVoid, reason }) => (isVoid && reason ? [textRow(`Reason: ${reason}`, 1, true, "left")] : []),
    items: (block, { isMoved, items }) => {
      if (isMoved) return [];
      return items.flatMap((item, i): TextRow[] => [
        ...(i > 0 ? [ITEM_GAP] : []),
        {
          kind: "item",
          name: `${item.qty} × ${orderItemLabel(item)}`,
          amount: block.options.prices ? inr(item.price * item.qty) : "",
          style: { align: "left", bold: true, ratio: 1 },
          hang: 0,
        },
        ...orderItemModifierLines(item).map((line) => textRow(line, 0.86, false, "left", { indent: TEXT_SUB_LINE_INDENT })),
        ...(item.instructions ? [textRow(`▸ ${item.instructions}`, 0.86, true, "left", { indent: TEXT_SUB_LINE_INDENT })] : []),
      ]);
    },
    notes: (_block, { order }) => (order.notes ? [{ kind: "rule", rule: "dashed" }, textRow(`Note: ${order.notes}`, 0.86, true, "left")] : []),
    itemCount: (_block, { isMoved, isVoid, items }) =>
      isMoved ? [] : [textRow(`${items.reduce((n, it) => n + it.qty, 0)} item(s)${isVoid ? " VOIDED" : ""}`, 0.86, false, "center")],
    roundTotal: (_block, { isMoved, showsPrices, roundTotal }) =>
      !isMoved && showsPrices ? [textRow(`Round total: ${inr(roundTotal)}`, 0.86, true, "center")] : [],
    station: (_block, { stationLine }) => (stationLine ? [textRow(stationLine, 1.29, true, "center")] : []),
    token: (_block, { order }) => (order.tokenNumber !== undefined ? [textRow(`TOKEN ${order.tokenNumber}`, 1.29, true, "center")] : []),
    // A link the picture would draw as a QR code has no text form; one it would not draw prints nothing either way.
    qr: (block) => (isSafeHttpsLink(block.options.url.trim()) ? PICTURE_ONLY : []),
    customText: (block) => {
      const text = block.options.text.trim();
      return text === "" ? [] : [keptTextRow(text, 0.86, false, "center")];
    },
  },
};
```

Create `apps/cafe/lib/printer/kot-text/kot-text-design.ts`:

```ts
import type { BlockAlign, BlockSize, KotBlockOf, KotBlockType } from "@pos/shared/print-template";
import type { PrintFontSize } from "@pos/shared/constants";
import type { KotSlipContext } from "@/components/print/slip/slip-context";
import type { RowStyle, TextRow } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.3, §4.4): the contract of a kitchen-ticket design's TEXT renderer, the twin of
// its React renderer (components/print/slip/slip-designs.ts). Each block type says what text rows it prints, in the
// same words and order as the picture (pinned by kot-text-parity.test.ts), or that it has no text form (a logo or a QR
// code that would print), which makes the whole slip a picture. Sizes are the picture's em ratios.

/** A block that would print something text cannot (a logo, a QR code): the slip prints as a picture. */
export const PICTURE_ONLY = "picture-only";
export type PictureOnly = typeof PICTURE_ONLY;

/** What a text renderer reads: the picture's own context (kotSlipContext) plus SlipEngine's one whole-slip fact. */
export interface KotTextContext extends KotSlipContext {
  /** The visible items block shows prices (the round total prints only then). */
  showsPrices: boolean;
}

export type KotTextRenderers = {
  [T in KotBlockType]: (block: KotBlockOf<T>, ctx: KotTextContext) => TextRow[] | PictureOnly;
};

export interface KotTextDesign {
  rows: KotTextRenderers;
  /** A block's extra size from its design's group wrapper in the picture (Classic's meta lines are 0.93em). */
  groupRatio: Partial<Record<KotBlockType, number>>;
}

/** The template's base size against the 14 px a ratio is measured from (lib/print.ts PRINT_FONT_CLASS). */
export const TEXT_BASE_RATIO: Record<PrintFontSize, number> = { small: 12 / 14, normal: 1, large: 16 / 14 };

/** A block's own size choice (components/print/slip/slip-style.ts BLOCK_SIZE_CLASS). */
export const TEXT_BLOCK_SIZE_RATIO: Record<BlockSize, number> = { xs: 0.75, sm: 0.875, md: 1, lg: 1.25, xl: 1.5 };

/** A locked line never shrinks below "sm" (slip-style.ts LOCKED_MIN_SIZE). */
export const TEXT_LOCKED_MIN_SIZE: BlockSize = "sm";

/** The feed between two items (ESC J 12): about the picture's gap, in the printer's motion units (text-escpos.ts). */
export const TEXT_ITEM_GAP_DOTS = 12;

/** Modifier and instruction lines sit this many spaces in (the picture's pl-4). */
export const TEXT_SUB_LINE_INDENT = 4;

/** One text row. */
export function textRow(text: string, ratio: number, bold: boolean, align: BlockAlign, more: Partial<RowStyle> = {}): TextRow {
  return { kind: "text", text, style: { align, bold, ratio, ...more } };
}

/** Free text that keeps its line breaks (custom text, whitespace-pre-wrap in the picture). */
export function keptTextRow(text: string, ratio: number, bold: boolean, align: BlockAlign): TextRow {
  return { kind: "text", text, style: { align, bold, ratio }, keepBreaks: true };
}

/** A label / value row at the body's size, regular weight. */
export function splitRow(label: string, value: string): TextRow {
  return { kind: "split", label, value, style: { align: "left", bold: false, ratio: 1 } };
}

export const ITEM_GAP: TextRow = { kind: "feed", dots: TEXT_ITEM_GAP_DOTS };
```

Create `apps/cafe/lib/printer/kot-text/kot-text.ts`:

```ts
import { kotBlockLocked, type KotBlock, type KotDesign } from "@pos/shared/print-template";
import { kotLockContext, kotSlipContext } from "@/components/print/slip/slip-context";
import { kitchenLinesOf, kitchenOrderOf } from "@/lib/kitchen-lines";
import { printConfigOf } from "@/lib/print";
import type { HostKotSlip } from "@/lib/print-host-slips";
import { kotTemplateOf } from "@/lib/print-template-resolve";
import { classicKotTemplate } from "@/lib/print-template-legacy";
import type { Settings } from "@/types";
import { KOT_TEXT_CLASSIC } from "./kot-text-classic";
import {
  PICTURE_ONLY,
  TEXT_BASE_RATIO,
  TEXT_BLOCK_SIZE_RATIO,
  TEXT_LOCKED_MIN_SIZE,
  textRow,
  type KotTextContext,
  type KotTextDesign,
  type PictureOnly,
} from "./kot-text-design";
import { escposTextJob } from "./text-escpos";
import { layoutRows, type TextColumns, type TextPiece, type TextRow } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.1, S3): a kitchen-surface slip as ESC/POS text, or the reason it must print as
// a picture. Pure; the print bridge (Session 4B) calls it right before the picture path and uses its bytes only when it
// answers ok. It reads the slip exactly as the picture does: the kitchen view of the order (PrintSources.tsx), the stored
// template or the legacy ticket's own Classic template (KOTReceipt.tsx), the blocks SlipEngine shows and the banner.

/** The text renderer of each design it knows. A design not listed prints as a picture. */
export const KOT_TEXT_DESIGNS: Partial<Record<KotDesign, KotTextDesign>> = {
  classic: KOT_TEXT_CLASSIC,
};

/** Why a slip prints as a picture: an unknown design or block, a logo or QR code, a character text cannot print, nothing
 *  to print (the picture path then says so itself), or an error in this code. */
export type KotTextRefusal = "design" | "block" | "picture" | "characters" | "empty" | "error";

export interface KotTextInput {
  slip: HostKotSlip;
  settings: Settings | null | undefined;
  columns: TextColumns;
}

export type KotTextPlan = { ok: true; pieces: TextPiece[] } | { ok: false; refusal: KotTextRefusal };
export type KotTextResult = { ok: true; bytes: Uint8Array } | { ok: false; refusal: KotTextRefusal };

/** The banner's look (components/pos/PrintBanner.tsx: 1.29em, bold, centred, white on black). */
const BANNER_RATIO = 1.29;

// SlipEngine's kotBlockVisible: "Show ticket number" alone decides the number; every other block prints when it is on
// or its lock forces it.
function blockVisible(block: KotBlock, ctx: ReturnType<typeof kotLockContext>, showNumber: boolean): boolean {
  if (block.type === "kotNo") return showNumber;
  return block.on || kotBlockLocked(block.type, ctx);
}

// A block's own size / alignment / weight (slip-style.ts), on top of its design's group size and the template's base
// size. A rule keeps its line; a feed is a feed.
function styled(rows: TextRow[], block: KotBlock, locked: boolean, groupRatio: number, baseRatio: number): TextRow[] {
  const size = locked && block.size === "xs" ? TEXT_LOCKED_MIN_SIZE : block.size;
  const factor = baseRatio * groupRatio * (size === undefined ? 1 : TEXT_BLOCK_SIZE_RATIO[size]);
  return rows.map((row) => {
    if (row.kind === "rule" || row.kind === "feed") return row;
    return {
      ...row,
      style: { ...row.style, ratio: row.style.ratio * factor, align: block.align ?? row.style.align, bold: block.bold ?? row.style.bold },
    };
  });
}

/** The slip's printed pieces, or why it prints as a picture. Throws only on a bug (kotTextJob catches it). */
export function kotTextPlan({ slip, settings, columns }: KotTextInput): KotTextPlan {
  const template = kotTemplateOf(settings) ?? classicKotTemplate(settings);
  const design = Object.hasOwn(KOT_TEXT_DESIGNS, template.design) ? KOT_TEXT_DESIGNS[template.design] : undefined;
  if (design === undefined) return { ok: false, refusal: "design" };
  const base = kotSlipContext(kitchenOrderOf(slip.order), settings, {
    roundItems: slip.kotRoundItems ? [...kitchenLinesOf(slip.kotRoundItems)] : undefined,
    roundLabel: slip.kotRoundLabel,
    roundNumber: slip.kotRoundNumber,
    variant: slip.kotVariant,
    reason: slip.voidReason,
    voidedBy: slip.voidedBy,
    voidedAt: slip.voidedAt,
    movedFrom: slip.movedFrom,
    movedBy: slip.movedBy,
    movedAt: slip.movedAt,
    stationLine: slip.stationLine,
  });
  const lockCtx = kotLockContext(base);
  const visible = template.blocks.filter((block) => blockVisible(block, lockCtx, printConfigOf(settings).kot.showNumber));
  const ctx: KotTextContext = { ...base, showsPrices: visible.some((block) => block.type === "items" && block.options.prices) };
  const baseRatio = TEXT_BASE_RATIO[template.size];
  const rows: TextRow[] = slip.banner ? [textRow(slip.banner, BANNER_RATIO * baseRatio, true, "center", { invert: true })] : [];
  for (const block of visible) {
    if (!Object.hasOwn(design.rows, block.type)) return { ok: false, refusal: "block" };
    // One correlated-union step TypeScript cannot follow (as in SlipEngine): the renderer is keyed by block.type.
    const render = design.rows[block.type] as (b: KotBlock, c: KotTextContext) => TextRow[] | PictureOnly;
    const out = render(block, ctx);
    if (out === PICTURE_ONLY) return { ok: false, refusal: "picture" };
    rows.push(...styled(out, block, kotBlockLocked(block.type, lockCtx), design.groupRatio[block.type] ?? 1, baseRatio));
  }
  const pieces = layoutRows(rows, columns);
  if (pieces === null) return { ok: false, refusal: "characters" };
  if (!pieces.some((piece) => "text" in piece && piece.text.trim() !== "")) return { ok: false, refusal: "empty" };
  return { ok: true, pieces };
}

/** The slip as ESC/POS text bytes, or why it prints as a picture. Never throws (spec S3): any error is a refusal, and a
 *  refusal is decided before a single byte is sent. */
export function kotTextJob(input: KotTextInput): KotTextResult {
  try {
    const plan = kotTextPlan(input);
    return plan.ok ? { ok: true, bytes: escposTextJob(plan.pieces, input.columns) } : plan;
  } catch {
    return { ok: false, refusal: "error" };
  }
}
```

- [ ] **Step 4: Run it, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/kot-text.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint lib/printer/kot-text && echo "typecheck and lint clean"
```
Expected:
```text
# tests 10
# pass 10
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4a-3.txt`, then `git add apps/cafe/lib/printer/kot-text apps/cafe/package.json && git commit -F "$SP/msg-4a-3.txt"`:

```text
feat(cafe): printing Phase 4 Session 4A, Classic's kitchen ticket as text, and the gate: kotTextJob reads a kitchen-surface slip as the picture does (the kitchen view, the stored or legacy Classic template, SlipEngine's visible blocks with "Show ticket number" alone deciding the number, a block's size, alignment and weight, the banner) and answers ESC/POS bytes or why it must print as a picture (an unknown design or block, a logo or QR code, a character text cannot print, an error); it never throws (spec §4.1, S3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 4: Kitchen Bold as text (§4.3)

**Files:**
- Create: `apps/cafe/lib/printer/kot-text/kot-text-bold.ts`
- Modify: `apps/cafe/lib/printer/kot-text/kot-text.ts` (`KOT_TEXT_DESIGNS` gains `kitchenBold`)
- Test: `kot-text-bold.test.ts`; `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Consumes: Task 3; `defaultKotTemplate` (`lib/print-template-designs.ts`).
- Produces: `KOT_TEXT_BOLD`.

- [ ] **Step 1: Write the failing test**

Create `apps/cafe/lib/printer/kot-text/kot-text-bold.test.ts`:

```ts
import { settingsOf } from "../../print-template-golden.fixtures"; // FIRST: React's production build
import { test } from "node:test";
import assert from "node:assert/strict";

import type { KotBlock } from "@pos/shared/print-template";
import { defaultKotTemplate } from "@/lib/print-template-designs";
import type { Settings } from "@/types";
import { kotTextPlan, type KotTextPlan } from "./kot-text";
import { shownPieces, slipOf } from "./kot-text.fixtures";
import type { TextColumns } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.3): Kitchen Bold as text. The golden lines were read against the picture
// (components/print/slip/kot-bold-blocks.tsx; the parity test pins the words).

function shown(plan: KotTextPlan): string[] {
  assert.ok(plan.ok, `the slip prints as text (${plan.ok ? "" : plan.refusal})`);
  return shownPieces(plan.pieces);
}

function boldSettings(blocks: (blocks: KotBlock[]) => KotBlock[] = (b) => b): Settings {
  const settings = settingsOf({ logo: "" });
  const template = defaultKotTemplate("kitchenBold", settings);
  return { ...settings, kotTemplate: { ...template, blocks: blocks(template.blocks) } } as Settings;
}

const planOf = (id: string, settings: Settings, columns: TextColumns, over = {}) => kotTextPlan({ slip: slipOf(id, over), settings, columns });

test("a round's KOT in Kitchen Bold on 80 mm: the band, the station, the number box, the big table and items", () => {
  assert.deepEqual(shown(planOf("round-label-number", boldSettings(), 48, { banner: "REPRINT", stationLine: "BAR" })), [
    "tall  BIl|                    REPRINT                    |",
    "tall  B c|BAR|",
    "big   BIl|KOT 7                  |",
    "big   B l|Table T4|",
    "normalB l|Round 1|",
    "normal  l|Time 10:45 am|",
    "normal  l|Staff Asha|",
    "normal  l|Order ORD-20261004-042|",
    "normal  l|===============================================|",
    "tall  B l|[2] MASALA CHAI|",
    "normalB l|    + Less sugar, Extra ginger|",
    "normalB l|    >> Hot please|",
    "feed 12",
    "tall  B l|[1] PIZZA (LARGE)|",
    "normalB l|    NO Onion|",
    "normal  l|===============================================|",
    "normalBIl|NOTE: BIRTHDAY TABLE, NO PEANUTS               |",
    "normalB l|3 item(s)|",
  ], "Kitchen Bold's round KOT, line for line");
});

test("a VOID on 58 mm: white-on-black title bands; a moved slip names from -> to and lists no items", () => {
  const voided = shown(planOf("void-reason-by-at", boldSettings(), 32));
  assert.deepEqual(voided.slice(0, 3), [
    "tall  BIl|         *** VOID ***          |",
    "normalBIl| CANCELLED ITEMS - DO NOT MAKE |",
    "big   BIl|KOT 9          |",
  ], "the void bands, then the number box");
  assert.deepEqual(voided.slice(-3), ["normalBIl|NOTE: BIRTHDAY TABLE, NO       |", "normalBIl|PEANUTS                        |", "normalB l|1 item(s) VOIDED|"], "the note band wraps");
  const moved = shown(planOf("moved-from-by-at", boldSettings(), 48));
  assert.ok(moved.includes("big   B l|Table T2 -> T4|"), "the table, from -> to, at double size");
  assert.ok(!moved.some((line) => line.includes("[")), "no items on a moved slip");
});

test("with prices the amount stays as written beside the upper-case name, and the round total prints", () => {
  const priced = boldSettings((blocks) =>
    blocks.map((b) => (b.type === "items" ? { ...b, options: { ...b.options, prices: true } } : b.type === "roundTotal" ? { ...b, on: true } : b)),
  );
  const lines = shown(planOf("round-label-number", priced, 48));
  assert.ok(lines.includes(`tall  B l|${"[2] MASALA CHAI".padEnd(42)}Rs 80|`), "the amount flush right on the tall line, never upper-cased");
  assert.equal(lines.at(-1), "normalB l|Round total: Rs 380|", "the round total, left, bold");
});

test("a long item name wraps under the name, after its quantity", () => {
  const slip = slipOf("round-label-number");
  const long = { ...slip.order.items[0], name: "Masala Chai With Extra Ginger And Cardamom" };
  const plan = kotTextPlan({ slip: { ...slip, kotRoundItems: [long] }, settings: boldSettings(), columns: 32 });
  const lines = shown(plan).filter((line) => line.startsWith("tall"));
  assert.deepEqual(lines, ["tall  B l|[2] MASALA CHAI WITH EXTRA|", "tall  B l|    GINGER AND CARDAMOM|"], "continued four spaces in");
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/printer/kot-text/text-escpos.test.ts",
    "lib/printer/kot-text/kot-text.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

Replace it with:

```json
    "lib/printer/kot-text/text-escpos.test.ts",
    "lib/printer/kot-text/kot-text.test.ts",
    "lib/printer/kot-text/kot-text-bold.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

- [ ] **Step 2: Run it and see it fail** (Kitchen Bold is still refused as an unknown design)

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/kot-text-bold.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
not ok 1 - a round's KOT in Kitchen Bold on 80 mm: the band, the station, the number box, the big table and items
not ok 2 - a VOID on 58 mm: white-on-black title bands; a moved slip names from -> to and lists no items
not ok 3 - with prices the amount stays as written beside the upper-case name, and the round total prints
not ok 4 - a long item name wraps under the name, after its quantity
# tests 4
# pass 0
# fail 4
```

- [ ] **Step 3: Implement**

Create `apps/cafe/lib/printer/kot-text/kot-text-bold.ts`:

```ts
import { orderItemLabel, orderItemModifierLines } from "@pos/shared/utils";
import { isSafeHttpsLink } from "@pos/shared/print-qr";
import { inr } from "@/lib/utils";
import { fmtTime } from "@/components/print/slip/slip-format";
import {
  ITEM_GAP,
  PICTURE_ONLY,
  TEXT_SUB_LINE_INDENT,
  keptTextRow,
  textRow,
  type KotTextDesign,
} from "./kot-text-design";
import type { TextRow } from "./text-layout";

// Kitchen Bold's kitchen ticket as text (printing Phase 4, spec 2026-10-15 §4.3): the twin of
// components/print/slip/kot-bold-blocks.tsx, the same words in the same order (kot-text-parity.test.ts). Its look in
// the printer's font: the restaurant name, item names and the note upper case; VOID, TABLE MOVED and the note as
// white-on-black bands; the ticket number's box as a white-on-black "KOT 12" at double size (the box cannot float
// beside the meta lines in text: they follow under it); the table and the items large; its regular weight not bold.

const MOVED_TITLE = "*** TABLE MOVED ***";
const MOVED_SUBTITLE = "FOOD ALREADY ORDERED — DO NOT MAKE AGAIN";
const VOID_TITLE = "*** VOID ***";
const VOID_SUBTITLE = "CANCELLED ITEMS — DO NOT MAKE";
const KOT_TITLE = "KITCHEN ORDER";
const INSTRUCTION_PREFIX = "» ";
/** META_LINE_CLASS / SUB_LINE_CLASS: text-[0.9em]. */
const META_RATIO = 0.9;

export const KOT_TEXT_BOLD: KotTextDesign = {
  groupRatio: {},
  rows: {
    logo: (_block, { logoUrl }) => (logoUrl ? PICTURE_ONLY : []),
    name: (_block, { restaurantName }) => (restaurantName ? [textRow(restaurantName, 1.2, true, "center", { upper: true })] : []),
    title: (_block, { isMoved, isVoid }) => {
      const band = { invert: true };
      if (isMoved) return [textRow(MOVED_TITLE, 1.4, true, "center", band), textRow(MOVED_SUBTITLE, 0.95, true, "center", band)];
      if (isVoid) return [textRow(VOID_TITLE, 1.4, true, "center", band), textRow(VOID_SUBTITLE, 0.95, true, "center", band)];
      return [textRow(KOT_TITLE, 1.1, true, "center")];
    },
    station: (_block, { stationLine }) => (stationLine ? [textRow(stationLine, 1.4, true, "center")] : []),
    token: (_block, { order }) => (order.tokenNumber !== undefined ? [textRow(`TOKEN ${order.tokenNumber}`, 1.25, true, "left")] : []),
    kotNo: (_block, { isMoved, roundNumber }) =>
      !isMoved && roundNumber !== undefined ? [textRow(`KOT ${roundNumber}`, 2.2, true, "left", { invert: true })] : [],
    roundLabel: (_block, { roundLabel }) => (roundLabel ? [textRow(roundLabel, 1, true, "left")] : []),
    orderId: (_block, { order }) => [textRow(`Order ${order.orderId}`, META_RATIO, false, "left")],
    table: (_block, { order, movedFrom }) => [
      textRow(`Table ${movedFrom ? `${movedFrom} → ${order.tableNo ?? "Walk-In"}` : (order.tableNo ?? "Walk-In")}`, 1.7, true, "left"),
    ],
    time: (_block, { order, movedMeta, voidMeta }) => [
      textRow(`Time ${fmtTime(movedMeta?.at ?? voidMeta?.at ?? order.createdAt)}`, META_RATIO, false, "left"),
    ],
    staff: (_block, { order, movedMeta, voidMeta }) => [textRow(`Staff ${movedMeta?.by ?? voidMeta?.by ?? order.receiver}`, META_RATIO, false, "left")],
    voidReason: (_block, { isVoid, reason }) => (isVoid && reason ? [textRow(`Reason: ${reason}`, 1, true, "left")] : []),
    items: (block, { isMoved, items }) => {
      if (isMoved) return [];
      return items.flatMap((item, i): TextRow[] => {
        const qty = `[${item.qty}] `;
        return [
          ...(i > 0 ? [ITEM_GAP] : []),
          {
            kind: "item",
            name: `${qty}${orderItemLabel(item)}`,
            amount: block.options.prices ? inr(item.price * item.qty) : "",
            style: { align: "left", bold: true, ratio: 1.25, upper: true },
            hang: qty.length,
          },
          ...orderItemModifierLines(item).map((line) => textRow(line, META_RATIO, true, "left", { indent: TEXT_SUB_LINE_INDENT })),
          ...(item.instructions ? [textRow(`${INSTRUCTION_PREFIX}${item.instructions}`, META_RATIO, true, "left", { indent: TEXT_SUB_LINE_INDENT })] : []),
        ];
      });
    },
    notes: (_block, { order }) => (order.notes ? [textRow(`Note: ${order.notes}`, 1, true, "left", { invert: true, upper: true })] : []),
    itemCount: (_block, { isMoved, isVoid, items }) =>
      isMoved ? [] : [textRow(`${items.reduce((n, it) => n + it.qty, 0)} item(s)${isVoid ? " VOIDED" : ""}`, META_RATIO, true, "left")],
    roundTotal: (_block, { isMoved, showsPrices, roundTotal }) =>
      !isMoved && showsPrices ? [textRow(`Round total: ${inr(roundTotal)}`, META_RATIO, true, "left")] : [],
    qr: (block) => (isSafeHttpsLink(block.options.url.trim()) ? PICTURE_ONLY : []),
    divider: (block) => [{ kind: "rule", rule: block.options?.style ?? "double" }],
    customText: (block) => {
      const text = block.options.text.trim();
      return text === "" ? [] : [keptTextRow(text, 1, true, "center")];
    },
  },
};
```

In `apps/cafe/lib/printer/kot-text/kot-text.ts`, find:

```ts
import { classicKotTemplate } from "@/lib/print-template-legacy";
import type { Settings } from "@/types";
import { KOT_TEXT_CLASSIC } from "./kot-text-classic";
import {
```

Replace it with:

```ts
import { classicKotTemplate } from "@/lib/print-template-legacy";
import type { Settings } from "@/types";
import { KOT_TEXT_BOLD } from "./kot-text-bold";
import { KOT_TEXT_CLASSIC } from "./kot-text-classic";
import {
```

In `apps/cafe/lib/printer/kot-text/kot-text.ts`, find:

```ts
export const KOT_TEXT_DESIGNS: Partial<Record<KotDesign, KotTextDesign>> = {
  classic: KOT_TEXT_CLASSIC,
};

```

Replace it with:

```ts
export const KOT_TEXT_DESIGNS: Partial<Record<KotDesign, KotTextDesign>> = {
  classic: KOT_TEXT_CLASSIC,
  kitchenBold: KOT_TEXT_BOLD,
};

```

- [ ] **Step 4: Run both KOT suites, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/kot-text.test.ts lib/printer/kot-text/kot-text-bold.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint lib/printer/kot-text && echo "typecheck and lint clean"
```
Expected:
```text
# tests 14
# pass 14
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4a-4.txt`, then `git add apps/cafe/lib/printer/kot-text apps/cafe/package.json && git commit -F "$SP/msg-4a-4.txt"`:

```text
feat(cafe): printing Phase 4 Session 4A, Kitchen Bold's kitchen ticket as text: upper-case names, the white-on-black VOID, TABLE MOVED and note bands, the ticket number's box as a double-size band, the large table and items (spec §4.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 5: The text test slip (§5.1, S2)

**Files:**
- Create: `apps/cafe/lib/printer/kot-text/text-test-slip.ts`
- Test: `text-test-slip.test.ts`; `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces: `TEXT_TEST_RULER_DIGITS`, `TEXT_TEST_TITLE`, `TEXT_TEST_CHECK`; `interface TextTestInput { cafeName: string |
  undefined; columns: TextColumns }`; `textTestPieces(input): TextPiece[]`; `textTestJob(input): Uint8Array`. **Session
  4B prints `textTestJob` before a switch turns on.**

- [ ] **Step 1: Write the failing test**

Create `apps/cafe/lib/printer/kot-text/text-test-slip.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { CUT_PARTIAL_WITH_FEED, ESC_INIT } from "@/lib/printer/escpos";
import { shownPieces } from "./kot-text.fixtures";
import { TEXT_TEST_RULER_DIGITS, textTestJob, textTestPieces } from "./text-test-slip";

// Printing Phase 4 (spec 2026-10-15 §5.1, S2): the slip a printer prints before its text switch turns on: a sample
// kitchen ticket with a price in Rs, double-height and white-on-black lines, and a ruler as long as a text line may be.

test("the text test slip on 80 mm, line for line", () => {
  assert.deepEqual(shownPieces(textTestPieces({ cafeName: "Test Cafe", columns: 48 })), [
    "tall  B c|Test Cafe|",
    "big   B c|TEXT TEST|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    "tall  B c|KITCHEN ORDER|",
    "normalB l|2 x Masala Chai                           Rs 80|",
    "normal  l|    + Less sugar|",
    "normalB l|    > Hot please|",
    "feed 12",
    "normalB l|1 x Paneer Tikka                         Rs 240|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    `tall  BIl|${" ".repeat(16)}WHITE ON BLACK${" ".repeat(17)}|`,
    "normal  l|12345678901234567890123456789012345678901234567|",
    "normal  c|The numbers above fit on one line.|",
  ], "the whole sample");
});

test("the ruler is exactly one text line long at each width", () => {
  for (const columns of [32, 42, 48] as const) {
    const lines = shownPieces(textTestPieces({ cafeName: "Cafe", columns }));
    const ruler = lines.find((line) => line.includes("|123"));
    assert.ok(ruler !== undefined, `a ruler at ${columns}`);
    const digits = ruler.slice(ruler.indexOf("|") + 1, -1);
    assert.equal(digits.length, columns - 1, `${columns} columns: a ruler of ${columns - 1}`);
    assert.ok(TEXT_TEST_RULER_DIGITS.startsWith(digits.slice(0, 10)), "it counts 1 to 0");
  }
});

test("a cafe name text cannot print is left off; a blank one too", () => {
  assert.equal(shownPieces(textTestPieces({ cafeName: "स्वाद कैफ़े", columns: 48 }))[0], "big   B c|TEXT TEST|", "a Hindi name is left off");
  assert.equal(shownPieces(textTestPieces({ cafeName: "   ", columns: 32 }))[0], "big   B c|TEXT TEST|", "a blank name is left off");
  assert.equal(shownPieces(textTestPieces({ cafeName: undefined, columns: 32 }))[0], "big   B c|TEXT TEST|", "no name");
});

test("the job begins and ends like any slip", () => {
  const bytes = Array.from(textTestJob({ cafeName: "Test Cafe", columns: 32 }));
  assert.deepEqual(bytes.slice(0, 2), Array.from(ESC_INIT), "ESC @ first");
  assert.deepEqual(bytes.slice(-4), Array.from(CUT_PARTIAL_WITH_FEED), "the cut last");
  assert.ok(bytes.length < 800, `${bytes.length} bytes`);
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/printer/kot-text/kot-text.test.ts",
    "lib/printer/kot-text/kot-text-bold.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

Replace it with:

```json
    "lib/printer/kot-text/kot-text.test.ts",
    "lib/printer/kot-text/kot-text-bold.test.ts",
    "lib/printer/kot-text/text-test-slip.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-test-slip.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
# Error: Cannot find module './text-test-slip'
not ok 1 - lib\\printer\\kot-text\\text-test-slip.test.ts
# tests 1
# pass 0
# fail 1
```

- [ ] **Step 3: Implement**

Create `apps/cafe/lib/printer/kot-text/text-test-slip.ts`:

```ts
import { asciiText } from "./text-chars";
import { ITEM_GAP, TEXT_SUB_LINE_INDENT, textRow } from "./kot-text-design";
import { escposTextJob } from "./text-escpos";
import { layoutRows, lineWidth, type TextColumns, type TextPiece, type TextRow } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §5.1, S2): the slip a printer prints before its "Fast text KOTs" switch turns on.
// Staff check it on the paper: a sample kitchen ticket with a price in Rs, a double-height and a white-on-black line,
// and a ruler as long as a text line may be (the columns less one). If the ruler breaks onto a second line the printer
// has fewer columns (on 80 mm, try 42); if anything prints garbled, keep the switch off.

/** The ruler counts 1 to 0 again and again. */
export const TEXT_TEST_RULER_DIGITS = "1234567890".repeat(7);
export const TEXT_TEST_TITLE = "TEXT TEST";
export const TEXT_TEST_CHECK = "The numbers above fit on one line.";

export interface TextTestInput {
  /** The cafe's name; left off when text cannot print it. */
  cafeName: string | undefined;
  columns: TextColumns;
}

export function textTestPieces({ cafeName, columns }: TextTestInput): TextPiece[] {
  const name = asciiText(cafeName ?? "")?.trim() ?? "";
  const rows: TextRow[] = [
    ...(name === "" ? [] : [textRow(name, 1.29, true, "center")]),
    textRow(TEXT_TEST_TITLE, 1.6, true, "center"),
    { kind: "rule", rule: "dashed" },
    textRow("KITCHEN ORDER", 1.29, true, "center"),
    { kind: "item", name: "2 x Masala Chai", amount: "Rs 80", style: { align: "left", bold: true, ratio: 1 }, hang: 0 },
    textRow("+ Less sugar", 0.86, false, "left", { indent: TEXT_SUB_LINE_INDENT }),
    textRow("> Hot please", 0.86, true, "left", { indent: TEXT_SUB_LINE_INDENT }),
    ITEM_GAP,
    { kind: "item", name: "1 x Paneer Tikka", amount: "Rs 240", style: { align: "left", bold: true, ratio: 1 }, hang: 0 },
    { kind: "rule", rule: "dashed" },
    textRow("WHITE ON BLACK", 1.29, true, "center", { invert: true }),
    textRow(TEXT_TEST_RULER_DIGITS.slice(0, lineWidth(columns, "normal")), 1, false, "left"),
    textRow(TEXT_TEST_CHECK, 0.86, false, "center"),
  ];
  const pieces = layoutRows(rows, columns);
  // Every row above is ASCII and the name was checked: a null here is a bug, never a printer's state.
  if (pieces === null) throw new Error("textTestPieces: the sample does not lay out");
  return pieces;
}

export function textTestJob(input: TextTestInput): Uint8Array {
  return escposTextJob(textTestPieces(input), input.columns);
}
```

- [ ] **Step 4: Run it, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-test-slip.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint lib/printer/kot-text && echo "typecheck and lint clean"
```
Expected:
```text
# tests 4
# pass 4
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4a-5.txt`, then `git add apps/cafe/lib/printer/kot-text apps/cafe/package.json && git commit -F "$SP/msg-4a-5.txt"`:

```text
feat(cafe): printing Phase 4 Session 4A, the text test slip a printer prints before its Fast text KOTs switch turns on: a sample ticket with an Rs price, a double-height and a white-on-black line, and a ruler one text line long (spec §5.1, S2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 6: The picture's words, in the picture's order (§4.4)

**Files:**
- Modify: `apps/cafe/lib/printer/kot-text/kot-text.ts` (`kotTextRows` split out of `kotTextPlan`, exported)
- Test: `kot-text-parity.test.ts`; `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces: `kotTextRows({ slip, settings }): { ok: true; rows: TextRow[] } | { ok: false; refusal }` (the rows in the
  picture's order, before layout).

The parity test renders `KOTReceipt` as `PrintSources` does (the kitchen view of the order and of the round's lines)
for every golden KOT shape × five settings variants (the golden's four and "Show ticket number" off) × eleven designs
(the legacy ticket; Classic with every block on but the logo, with custom text and an ornament, without prices, with a
size / alignment / weight on every block, at the small base, with the number's block off; Kitchen Bold as it comes, with
every block on and prices, styled, at the large base, with the number's block off) × a banner and a station line or none
× a token or none, and checks: the rows' words, in order, equal the picture's words (`renderToStaticMarkup`, tags
dropped, the §4.2 map applied, case and the `[ ]` of Kitchen Bold's quantity ignored); and at 32 and 48 columns the laid
out characters equal the rows' (nothing lost or added by wrapping). The logo stays off: a logo is a picture by rule (Task
3 pins that refusal). Measured in the planning session: changing one word on either side fails it, and so does removing
the "Show ticket number" rule (the review's I-3).

- [ ] **Step 1: Write the failing test**

Create `apps/cafe/lib/printer/kot-text/kot-text-parity.test.ts`:

```ts
import { KOT_PROP_SETS, KOT_SETTINGS_VARIANTS, settingsOf } from "../../print-template-golden.fixtures"; // FIRST: React's production build
import { before, test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BLOCK_ALIGNS, BLOCK_SIZES, type KotBlock, type KotTemplate } from "@pos/shared/print-template";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { loadSlipCode } from "@/components/print/slip/slip-code";
import { kitchenLinesOf, kitchenOrderOf } from "@/lib/kitchen-lines";
import type { HostKotSlip } from "@/lib/print-host-slips";
import { defaultKotTemplate } from "@/lib/print-template-designs";
import { classicKotTemplate } from "@/lib/print-template-legacy";
import type { Settings } from "@/types";
import { kotTextPlan, kotTextRows } from "./kot-text";
import { slipOf } from "./kot-text.fixtures";
import { asciiText } from "./text-chars";
import { layoutRows, type TextColumns, type TextRow } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.4): a text KOT prints the picture's words, in the picture's order. For every
// golden KOT shape, through the legacy ticket, Classic and Kitchen Bold (with every block on, prices on and off, a block
// in each size / alignment / weight, the number's block off, "Show ticket number" off, a banner, a station line and a
// token), the React slip's words (what the picture prints, as PrintSources renders it) equal the text renderer's words
// after the §4.2 map. A change on one side without the other fails here.

// jsx:"preserve" -> React.createElement, so a global React is needed at render time.
(globalThis as { React?: typeof React }).React = React;
before(() => loadSlipCode()); // R6: Kitchen Bold is in the lazy slip chunk

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };

function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(/[[\]]/g, ""))
    .filter((word) => word !== "");
}

function pictureWords(slip: HostKotSlip, settings: Settings): string[] {
  // PrintSources.tsx: the kitchen view of the order and of the round's lines.
  const html = renderToStaticMarkup(
    createElement(KOTReceipt, {
      order: kitchenOrderOf(slip.order),
      settings,
      roundItems: slip.kotRoundItems ? [...kitchenLinesOf(slip.kotRoundItems)] : undefined,
      roundLabel: slip.kotRoundLabel,
      roundNumber: slip.kotRoundNumber,
      variant: slip.kotVariant,
      reason: slip.voidReason,
      voidedBy: slip.voidedBy,
      voidedAt: slip.voidedAt,
      movedFrom: slip.movedFrom,
      movedBy: slip.movedBy,
      movedAt: slip.movedAt,
      stationLine: slip.stationLine,
      banner: slip.banner,
    }),
  );
  const text = html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&(amp|lt|gt|quot|#x27|#39);/g, (e) => ENTITIES[e] ?? e);
  const mapped = asciiText(text);
  assert.ok(mapped !== null, "the fixtures print only characters text knows");
  return words(mapped);
}

function mappedWords(text: string): string[] {
  const mapped = asciiText(text);
  assert.ok(mapped !== null, `the text renderer's ${JSON.stringify(text)} maps`);
  return words(mapped);
}

/** The words of the design's rows, in their order: what the slip says, before the lines are laid out. */
function rowWords(rows: TextRow[]): string[] {
  return rows.flatMap((row) => {
    if (row.kind === "text") return mappedWords(row.text);
    if (row.kind === "split") return [...mappedWords(row.label), ...mappedWords(row.value)];
    if (row.kind === "item") return [...mappedWords(row.name), ...mappedWords(row.amount)];
    return [];
  });
}

/** Every character the rows print but their rules (the picture's borders and ornaments, not words) and spaces, laid out
 *  at the columns, sorted: the layout loses and adds nothing. */
function printedChars(rows: TextRow[], columns: TextColumns): string {
  const laid = layoutRows(rows.filter((row) => row.kind !== "rule"), columns);
  assert.ok(laid !== null, "the rows lay out");
  return laid
    .flatMap((piece) => ("text" in piece ? [...piece.text.toLowerCase().replace(/[\s[\]]/g, "")] : []))
    .sort()
    .join("");
}

const withKot = (settings: Settings, template: KotTemplate): Settings => ({ ...settings, kotTemplate: template }) as Settings;
// Every block on but the logo, which is a picture by rule (kot-text.test.ts pins that refusal).
const allOn = (template: KotTemplate): KotTemplate => ({ ...template, blocks: template.blocks.map((b) => ({ ...b, on: b.type !== "logo" })) });
const priced = (template: KotTemplate, prices: boolean): KotTemplate => ({
  ...template,
  blocks: template.blocks.map((b) => (b.type === "items" ? ({ ...b, options: { ...b.options, prices } } as KotBlock) : b)),
});
const extras = (template: KotTemplate): KotTemplate => ({
  ...template,
  blocks: [
    ...template.blocks,
    { id: "customText-1", type: "customText", on: true, options: { text: "Thank you\nCome again" } },
    { id: "divider-9", type: "divider", on: true, options: { style: "ornament" } },
  ],
});
// "Show ticket number" alone decides the number (SlipEngine): a number block that is off still prints while it is on.
const numberBlockOff = (template: KotTemplate): KotTemplate => ({
  ...template,
  blocks: template.blocks.map((b) => (b.type === "kotNo" ? { ...b, on: false } : b)),
});
// Every block in one size / alignment / weight, cycling through them.
const styled = (template: KotTemplate): KotTemplate => ({
  ...template,
  blocks: template.blocks.map((b, i) => ({
    ...b,
    size: BLOCK_SIZES[i % BLOCK_SIZES.length],
    align: BLOCK_ALIGNS[i % BLOCK_ALIGNS.length],
    bold: i % 2 === 0,
  })),
});

function templatesFor(settings: Settings): Array<[string, Settings]> {
  const classic = classicKotTemplate(settings);
  const bold = defaultKotTemplate("kitchenBold", settings);
  return [
    ["legacy", settings],
    ["classic all on", withKot(settings, extras(allOn(classic)))],
    ["classic no prices", withKot(settings, priced(allOn(classic), false))],
    ["classic styled", withKot(settings, styled(allOn(classic)))],
    ["classic small", withKot(settings, { ...allOn(classic), size: "small" })],
    ["classic number block off", withKot(settings, numberBlockOff(allOn(classic)))],
    ["bold default", withKot(settings, bold)],
    ["bold all on", withKot(settings, extras(priced(allOn(bold), true)))],
    ["bold styled", withKot(settings, styled(allOn(bold)))],
    ["bold large", withKot(settings, { ...allOn(bold), size: "large" })],
    ["bold number block off", withKot(settings, numberBlockOff(allOn(bold)))],
  ];
}

const SLIP_EXTRAS: Array<[string, Partial<HostKotSlip>]> = [
  ["plain", {}],
  ["banner and station", { banner: "BACKUP PRINTER · REPRINT", stationLine: "ALL STATIONS" }],
];

test("every golden KOT shape prints the picture's words, in its order, in every design", () => {
  let compared = 0;
  // The golden's four settings, and "Show ticket number" off (the number must vanish on every path).
  const variants = [...KOT_SETTINGS_VARIANTS, { id: "number-off", settings: settingsOf({ logo: "", restaurantName: "", kotShowNumber: false }) }];
  for (const { id: variant, settings: base } of variants) {
    // The logo is a picture: a variant whose logo would print is refused, so the logo flag stays off here.
    const settings = { ...base, kotShowLogo: false } as Settings;
    for (const [design, designSettings] of templatesFor(settings)) {
      for (const set of KOT_PROP_SETS) {
        if (set.order === null) continue;
        for (const [extraId, over] of SLIP_EXTRAS) {
          for (const token of [undefined, 23]) {
            const slip = slipOf(set.id, over);
            const withToken: HostKotSlip = token === undefined ? slip : { ...slip, order: { ...slip.order, tokenNumber: token } };
            const cell = `${variant} / ${design} / ${set.id} / ${extraId} / token ${token ?? "none"}`;
            for (const columns of [32, 48] as const satisfies readonly TextColumns[]) {
              const plan = kotTextPlan({ slip: withToken, settings: designSettings, columns });
              assert.ok(plan.ok, `[${cell} / ${columns}] prints as text (${plan.ok ? "" : plan.refusal})`);
              const rows = kotTextRows({ slip: withToken, settings: designSettings });
              assert.ok(rows.ok, `[${cell}] has rows`);
              const said = rowWords(rows.rows);
              assert.deepEqual(said, pictureWords(withToken, designSettings), `[${cell}] the picture's words, in its order`);
              assert.equal(printedChars(rows.rows, columns), [...said.join("").replace(/[[\]]/g, "")].sort().join(""), `[${cell} / ${columns}] every character laid out`);
              compared++;
            }
          }
        }
      }
    }
  }
  // 5 settings x 11 designs x 20 slips x 2 extras x 2 tokens x 2 widths.
  assert.equal(compared, 5 * 11 * 20 * 2 * 2 * 2, `${compared} cells compared`);
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/printer/kot-text/kot-text-bold.test.ts",
    "lib/printer/kot-text/text-test-slip.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

Replace it with:

```json
    "lib/printer/kot-text/kot-text-bold.test.ts",
    "lib/printer/kot-text/text-test-slip.test.ts",
    "lib/printer/kot-text/kot-text-parity.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/kot-text-parity.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
not ok 1 - every golden KOT shape prints the picture's words, in its order, in every design
# tests 1
# pass 0
# fail 1
```

- [ ] **Step 3: Implement**

In `apps/cafe/lib/printer/kot-text/kot-text.ts`, find:

```ts
}

export type KotTextPlan = { ok: true; pieces: TextPiece[] } | { ok: false; refusal: KotTextRefusal };
export type KotTextResult = { ok: true; bytes: Uint8Array } | { ok: false; refusal: KotTextRefusal };
```

Replace it with:

```ts
}

export type KotTextRows = { ok: true; rows: TextRow[] } | { ok: false; refusal: KotTextRefusal };
export type KotTextPlan = { ok: true; pieces: TextPiece[] } | { ok: false; refusal: KotTextRefusal };
export type KotTextResult = { ok: true; bytes: Uint8Array } | { ok: false; refusal: KotTextRefusal };
```

In `apps/cafe/lib/printer/kot-text/kot-text.ts`, find:

```ts
}

/** The slip's printed pieces, or why it prints as a picture. Throws only on a bug (kotTextJob catches it). */
export function kotTextPlan({ slip, settings, columns }: KotTextInput): KotTextPlan {
  const template = kotTemplateOf(settings) ?? classicKotTemplate(settings);
  const design = Object.hasOwn(KOT_TEXT_DESIGNS, template.design) ? KOT_TEXT_DESIGNS[template.design] : undefined;
```

Replace it with:

```ts
}

/** The rows the slip's design prints, in the picture's order, before their characters are checked and their lines
 *  laid out; or why it prints as a picture. Throws only on a bug (kotTextJob catches it). */
export function kotTextRows({ slip, settings }: Pick<KotTextInput, "slip" | "settings">): KotTextRows {
  const template = kotTemplateOf(settings) ?? classicKotTemplate(settings);
  const design = Object.hasOwn(KOT_TEXT_DESIGNS, template.design) ? KOT_TEXT_DESIGNS[template.design] : undefined;
```

In `apps/cafe/lib/printer/kot-text/kot-text.ts`, find:

```ts
    rows.push(...styled(out, block, kotBlockLocked(block.type, lockCtx), design.groupRatio[block.type] ?? 1, baseRatio));
  }
  const pieces = layoutRows(rows, columns);
  if (pieces === null) return { ok: false, refusal: "characters" };
  if (!pieces.some((piece) => "text" in piece && piece.text.trim() !== "")) return { ok: false, refusal: "empty" };
```

Replace it with:

```ts
    rows.push(...styled(out, block, kotBlockLocked(block.type, lockCtx), design.groupRatio[block.type] ?? 1, baseRatio));
  }
  return { ok: true, rows };
}

/** The slip's printed pieces, or why it prints as a picture. Throws only on a bug (kotTextJob catches it). */
export function kotTextPlan({ slip, settings, columns }: KotTextInput): KotTextPlan {
  const planned = kotTextRows({ slip, settings });
  if (!planned.ok) return planned;
  const pieces = layoutRows(planned.rows, columns);
  if (pieces === null) return { ok: false, refusal: "characters" };
  if (!pieces.some((piece) => "text" in piece && piece.text.trim() !== "")) return { ok: false, refusal: "empty" };
```

- [ ] **Step 4: Run it, the KOT suite, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/kot-text-parity.test.ts lib/printer/kot-text/kot-text.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint lib/printer/kot-text && echo "typecheck and lint clean"
```
Expected:
```text
# tests 11
# pass 11
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4a-6.txt`, then `git add apps/cafe/lib/printer/kot-text apps/cafe/package.json && git commit -F "$SP/msg-4a-6.txt"`:

```text
test(cafe): printing Phase 4 Session 4A, a text KOT says the picture's words in the picture's order: 8,800 cells over every golden KOT shape, the legacy ticket, Classic and Kitchen Bold with every block on, prices on and off, each size, alignment and weight, the number's block off and "Show ticket number" off, a banner, a station line and a token, at 32 and 48 columns; kotTextRows gives the rows before layout (spec §4.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 7: Verification, the fresh review and the Results

**Files:** this plan's "Session 4A Results" section (append).

- [ ] **Step 1: Nothing else changed, and nothing uses the new code yet**

```bash
cd /d/kd/lucifer && git diff --stat d21ee37..HEAD -- . ':!docs' | tail -3
git diff --name-only d21ee37..HEAD -- . ':!docs' | grep -v -E '^apps/cafe/(lib/printer/kot-text/|package\.json$)' || echo "only kot-text and the test chain"
grep -rl "printer/kot-text" apps/cafe --include=*.ts --include=*.tsx | grep -v "^apps/cafe/lib/printer/kot-text/" || echo "nothing imports kot-text"
```
Expected: `17 files changed, 1458 insertions(+)`; `only kot-text and the test chain`; `nothing imports kot-text`.

- [ ] **Step 2: Every cafe check**

```bash
cd /d/kd/lucifer/apps/cafe && npm test > "$SP/cafe-4a.log" 2>&1; grep -E "^# (tests|pass|fail|skipped)" "$SP/cafe-4a.log"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo "typecheck clean" && npm run lint 2>&1 | tail -2
```
Expected: `# tests 6020`, `# pass 6019`, `# fail 0`, `# skipped 1` (in the background, with an until-loop); `typecheck
clean`; `✖ 2 problems (0 errors, 2 warnings)`.

- [ ] **Step 3: A fresh review.** A fresh reviewer on **Claude Fable 5.1** (read-only; scratch only in `$SP`; on an HTTP
429 limit wait for the reset and tell the owner, never switch models silently) reviews `d21ee37..HEAD` against spec
§4 and this section: the gate's rules, the map, the layout's widths, the bytes, the two designs against their React
twins, the parity test's strength. Fix a Critical or Important finding by TDD (RED seen first) in its own commit, re-run
Steps 1–2; record every finding and its ruling in the Results.

- [ ] **Step 4: The Results.** Append "## Session 4A Results" at the end of this plan: the commits, the counts (Steps
1–2), every RED and GREEN as seen, differences from this plan and why, the review and its rulings. Commit it
(`docs(printing): Session 4A Results …`). No push unless the session's prompt says so.

---

# Session 4B (exact): the page: the switch, the bridge's text step, the not-routed words

Made exact at the 4A review gate (2026-10-16), against the code 4A landed (`f46600e`, apps/cafe tree `a5a2516`). Every
code block below was written and run in the gold worktree `D:\kd\p4g` (branch `g4b-v5` from `f46600e`, the section
review's fixes and its re-check's folded in): Tasks 9–14 as
six commits (`3205036`, `86a4b5f`, `8f6dac0`, `3589c08`, `4c2f359`, `f4ef670`), the last whole tree `a792641851e439a4d1b772ed454573dd3b7337e4`; the
blocks were generated from those commits, then applied step by step on a fresh worktree `D:\kd\p4v` at `f46600e` (each
find matched exactly once, every task's whole tree came out identical to gold, and every Expected below is that run's
output). Task 15 was pre-run end to end on builds of `d21ee37` and of the gold head (headless Chrome as the POS app, and
the emulator with the release APK); its Expected lines are that run's.

Acceptance: with a printer's switch on (after its text test printed and staff said Yes), a kitchen-surface slip that
passes the gate prints as text through that printer's own writer, and every other slip exactly as today; with every
switch off the page prints byte for byte as before (S1: the source pin, the bridge's tests, the end-to-end comparison);
the not-routed toast says the right thing by kind. No app, Worker, model or API change.

**What the gate changed in this session's spec** (the owner approved the rulings and the interface changes on 2026-10-16;
the last row carries out spec §5.3 as approved; spec amended in the gate's commit):

| Was (4B spec) | Now | Why |
|---|---|---|
| Tasks 10–16 | **Task 9** first: the 4A gate's rulings in the 4A files | The owner's rulings (`ESC R 0`, `ESC M 0`, m-3) and the gate's (m-1, m-2, m-4, the review's I-1, m-5) change 4A's code and tests; a task of its own, as earlier gates did |
| Task 11 the bridge's step, Task 12 the Windows page side | **Task 11** the Windows printer's raw write (page side), **Task 12** the bridge's text step | The step's writers need `desktopPrintsRaw()`, `desktopPrintRawOn` and the print method first |
| key `printer:<id>:<connection>` | `printer:<setup printer id>:<how this device reaches it>`: `app:<the POS app's printer id>`, `lan:<host>:<port>` (the Windows app's network printer), `windows:<name>`, or this device's own printer (`native:<id>`, `serial:<usb ids or name>`, `ble:<device id>`); `device:<the same>` in simple mode | The bridge holds no printer setup (and the hook harness has no React Query); the route the picture takes is in hand at print time, and a printer pointed elsewhere still reads off (I-2 holds) |
| `textKotKeyForPrinter(printer: PrinterConfig)` | `textKotKeyForPrinter(printerId, reach)`, `textKotKeyForDevice(reach)`, `type TextKotReach` | the same |
| `queueTextTest(key, bytes)` | `queueTestSlip(write?)`: with `write`, the bridge writes those bytes in the test slip's own busy window (watchdog, settle, outcome) instead of firing the KOT surface | One busy window, no second copy of the test-slip rules |
| `useTextKot(key)` in the store | in `hooks/use-text-kot-printers.ts` | The store stays React-free (the hook harness loads it under a fake React) |
| the paper of a Windows chosen printer | the kitchen ticket's paper setting, and only with the app's print method Direct, now kept in `DesktopPrinterSnapshot.printMode` (re-read after a save) | The text step decides synchronously, before any byte |
| rule 7 "smaller than the picture's limit" | `textKotFitsPicture(length, paper)`: at most `dotsForPaper(paper) / 8 × RASTER_MAX_ROWS` bytes | The picture's own ceiling at that paper |
| the S1 pin: the Global Constraints' files | those 41 plus `components/pos/PrintSources.tsx` and `PrintBanner.tsx` (43 files) | Both draw every kitchen picture |
| the bridge's line budget 255 | 265 (262 after Task 12, 263 after Task 13) | The text step and the text test's write |
| (not in the 4B spec) | a slip of a printer this device only takes over for another device carries `takeover: true` (`hooks/use-print-agent.ts`) and prints a picture | Spec §5.3 says a failover writer has no switch; a switch stored on this device for a printer later re-pointed to another device would otherwise print text during a takeover, and its panel no longer lists that printer to turn it off (the section review's I-2); spec §5.3 now says how |

**Expected counts** (baseline = `f46600e`): the cafe chain 6022 (6021 pass, 0 fail, 1 skipped) → **6080** (6079 pass,
0 fail, 1 skipped); cafe typecheck clean; cafe lint 0 errors (the 2 old warnings). No other workspace changes.

Work in `D:\kd\lucifer` on `feat/printing-phase-4`; `$SP` is the session's scratchpad. Tasks are numbered 0 and 9–16, so
`task-start <plan> 12` brings only that task. Apply a step's blocks with `D:\kd\pos-dev-keep\phase3-final-gate\apply_blocks_clone.py`
(first argument the repo, then the plan, the first and the last line of the step; a `--dry` run first). Every commit
message goes in a scratch file and is committed with `git commit -F`; the messages below end with Claude Opus 5.5's
Co-Authored-By line; if the session's prompt gives another, its line wins. The harness refuses `bash -c` inside
`task-done`: run test commands through a wrapper script in `$SP`.

### Task 0: Baseline

**Files:** none (Results only).

- [ ] **Step 1: Check the branch, the disks and the cafe chain**

```bash
cd /d/kd/lucifer && git status --short && git branch --show-current && git log --oneline -3 && df -h /c /d
for b in tsc eslint next tsx; do test -f /d/kd/lucifer/node_modules/.bin/$b && echo $b; done | wc -l
cd /d/kd/lucifer/apps/cafe && npm test > "$SP/cafe-base.log" 2>&1; grep -E "^# (tests|pass|fail|skipped)" "$SP/cafe-base.log"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npm run lint 2>&1 | tail -2
```
Expected: clean, `feat/printing-phase-4`, the 4A gate's commit on top of `f46600e`; `4` (the `.bin` shims are there;
if not, `npm rebuild --ignore-scripts` at the root, offline; a bare `ls` in this Bash is `ls -F`, which prints `tsc*`);
cafe `# tests 6022`, `# pass 6021`, `# fail 0`, `# skipped 1` (about 60 s: run it in the background and wait for its
log with an until-loop); typecheck clean; `✖ 2 problems (0 errors, 2 warnings)`.

### Task 9: The 4A gate's rulings (§4.2, §4.3)

**Files:**
- Modify: `apps/cafe/lib/printer/kot-text/text-chars.ts`, `text-layout.ts`, `text-escpos.ts`, `kot-text.ts`
- Test: `text-chars.test.ts`, `text-layout.test.ts`, `text-escpos.test.ts`, `kot-text.test.ts`, `kot-text-bold.test.ts`,
  `kot-text-parity.test.ts` (same folder)

**Interfaces:**
- Produces: `escposTextJob` starts every job `ESC @`, `ESC R 0`, `ESC M 0` (the owner's rulings, 2026-10-16);
  `asciiText` maps a carriage return to a space (m-1); `TextRow`'s `split` gains `valueAlign?: BlockAlign`, set by
  `kotTextRows` from the block's alignment (m-3: centred in the room after the label, or right after it; none = right).
- Tests only: a skip-KOT line on neither side, Classic's meta size, Kitchen Bold's upper-case name (m-2); an over-wide
  amount is a picture (m-4); a long Classic item, a pair exactly one line long (the gate review's m-5); the locked-size
  floor at the large base and the engine's locks on a stored template in the parity (the gate review's I-1: 13 designs,
  10,400 cells).

- [ ] **Step 1: Write the failing tests**

In `apps/cafe/lib/printer/kot-text/kot-text-bold.test.ts`, find:

```ts
});

test("a long item name wraps under the name, after its quantity", () => {
  const slip = slipOf("round-label-number");
```

Replace it with:

```ts
});

test("Kitchen Bold prints the restaurant's name upper case, as its CSS shows it (the 4A gate's m-2)", () => {
  const named = boldSettings((blocks) => blocks.map((b) => (b.type === "name" ? { ...b, on: true } : b)));
  assert.equal(shown(planOf("round-label-number", named, 48))[0], "tall  B c|TEST CAFE|", "upper case, double height, bold, centred");
});

test("a long item name wraps under the name, after its quantity", () => {
  const slip = slipOf("round-label-number");
```

In `apps/cafe/lib/printer/kot-text/kot-text-parity.test.ts`, find:

```ts
  blocks: template.blocks.map((b) => (b.type === "kotNo" ? { ...b, on: false } : b)),
});
// Every block in one size / alignment / weight, cycling through them.
const styled = (template: KotTemplate): KotTemplate => ({
```

Replace it with:

```ts
  blocks: template.blocks.map((b) => (b.type === "kotNo" ? { ...b, on: false } : b)),
});
// The engine's locks on a stored template (the 4A gate's review, I-1): title, table and items off, so a void or moved slip
// prints them by their locks and a plain KOT leaves them off.
const lockedOff = (template: KotTemplate): KotTemplate => ({
  ...template,
  blocks: template.blocks.map((b) => (b.type === "title" || b.type === "table" || b.type === "items" ? { ...b, on: false } : b)),
});
// Every block in one size / alignment / weight, cycling through them.
const styled = (template: KotTemplate): KotTemplate => ({
```

In `apps/cafe/lib/printer/kot-text/kot-text-parity.test.ts`, find:

```ts
    ["classic small", withKot(settings, { ...allOn(classic), size: "small" })],
    ["classic number block off", withKot(settings, numberBlockOff(allOn(classic)))],
    ["bold default", withKot(settings, bold)],
    ["bold all on", withKot(settings, extras(priced(allOn(bold), true)))],
```

Replace it with:

```ts
    ["classic small", withKot(settings, { ...allOn(classic), size: "small" })],
    ["classic number block off", withKot(settings, numberBlockOff(allOn(classic)))],
    ["classic locked off", withKot(settings, lockedOff(allOn(classic)))],
    ["bold default", withKot(settings, bold)],
    ["bold all on", withKot(settings, extras(priced(allOn(bold), true)))],
```

In `apps/cafe/lib/printer/kot-text/kot-text-parity.test.ts`, find:

```ts
    ["bold large", withKot(settings, { ...allOn(bold), size: "large" })],
    ["bold number block off", withKot(settings, numberBlockOff(allOn(bold)))],
  ];
}
```

Replace it with:

```ts
    ["bold large", withKot(settings, { ...allOn(bold), size: "large" })],
    ["bold number block off", withKot(settings, numberBlockOff(allOn(bold)))],
    ["bold locked off", withKot(settings, lockedOff(allOn(bold)))],
  ];
}
```

In `apps/cafe/lib/printer/kot-text/kot-text-parity.test.ts`, find:

```ts
    }
  }
  // 5 settings x 11 designs x 20 slips x 2 extras x 2 tokens x 2 widths.
  assert.equal(compared, 5 * 11 * 20 * 2 * 2 * 2, `${compared} cells compared`);
});

```

Replace it with:

```ts
    }
  }
  // 5 settings x 13 designs x 20 slips x 2 extras x 2 tokens x 2 widths.
  assert.equal(compared, 5 * 13 * 20 * 2 * 2 * 2, `${compared} cells compared`);
});

test("a line the kitchen never sees (skip-KOT) prints on neither (the 4A gate's m-2)", () => {
  // PrintSources shows the kitchen view of the order and of the round (kitchenOrderOf, kitchenLinesOf): a water bottle
  // marked "no kitchen ticket" is on neither the picture nor the text, in a round and on the whole tab.
  const slip = slipOf("round-label-number");
  const water = { ...slip.order.items[0], productId: "p-water", name: "Water Bottle", noKot: true as const, kotRound: 1 };
  const order = { ...slip.order, items: [...slip.order.items, water] };
  const round: HostKotSlip = { ...slip, order, kotRoundItems: [...(slip.kotRoundItems ?? []), water] };
  const tab: HostKotSlip = { ...slip, order, kotRoundItems: undefined, kotRoundLabel: undefined, kotRoundNumber: undefined };
  const settings = settingsOf({ logo: "" });
  for (const [cell, which] of [["round", round], ["whole tab", tab]] as const) {
    for (const [design, designSettings] of templatesFor(settings)) {
      const rows = kotTextRows({ slip: which, settings: designSettings });
      assert.ok(rows.ok, `[${cell} / ${design}] has rows`);
      const said = rowWords(rows.rows);
      assert.ok(!said.includes("water"), `[${cell} / ${design}] no skip-KOT line in the text`);
      assert.deepEqual(said, pictureWords(which, designSettings), `[${cell} / ${design}] the picture's words, in its order`);
    }
  }
});

```

In `apps/cafe/lib/printer/kot-text/kot-text.test.ts`, find:

```ts
});

test("the same KOT on 58 mm wraps inside 31 characters", () => {
  const lines = shown(planOf(slipOf("round-label-number"), plain, 32));
```

Replace it with:

```ts
});

test("a long Classic item wraps from the line's start, its amount on the first line (the 4A gate's review, m-5)", () => {
  const slip = slipOf("round-label-number");
  const long = { ...slip.order.items[0], qty: 1, name: "Paneer Butter Masala With Extra Gravy", price: 1240, modifiers: [], instructions: "" };
  const priced = withTemplate((t) => t.blocks.map((b) => (b.type === "items" ? ({ ...b, options: { ...b.options, prices: true } } as KotBlock) : b)));
  const lines = shown(kotTextPlan({ slip: { ...slip, kotRoundItems: [long] }, settings: priced, columns: 32 })).filter((line) => line.startsWith("normalB l|"));
  assert.deepEqual(lines.slice(0, 2), [`normalB l|${"1 x Paneer Butter".padEnd(23)}Rs 1,240|`, "normalB l|Masala With Extra Gravy|"], "the name wraps from the start, never under the quantity");
});

test("the same KOT on 58 mm wraps inside 31 characters", () => {
  const lines = shown(planOf(slipOf("round-label-number"), plain, 32));
```

In `apps/cafe/lib/printer/kot-text/kot-text.test.ts`, find:

```ts
  const small = withTemplate((t) => t.blocks, { kotFontSize: "small" });
  assert.equal(shown(planOf(slipOf("round-label-number"), small))[0], "normalB c|KITCHEN ORDER|", "1.29em at 12 px is normal size");
  const locked = withTemplate((t) => t.blocks.map((b) => (b.type === "title" ? { ...b, size: "xs" } : b)));
  assert.equal(shown(planOf(slipOf("void-reason-by-at"), locked))[0], "normalB c|*** VOID ***|", "a locked title shrinks to sm, never xs");
});

```

Replace it with:

```ts
  const small = withTemplate((t) => t.blocks, { kotFontSize: "small" });
  assert.equal(shown(planOf(slipOf("round-label-number"), small))[0], "normalB c|KITCHEN ORDER|", "1.29em at 12 px is normal size");
  // At the large base the floor shows (the 4A gate's review, I-1): 16/14 x 1.29 x 0.875 = 1.29 is double height, while
  // xs (x 0.75 = 1.106) would be normal.
  const locked = withTemplate((t) => t.blocks.map((b) => (b.type === "title" ? { ...b, size: "xs" } : b)), { kotFontSize: "large" });
  assert.equal(shown(planOf(slipOf("void-reason-by-at"), locked))[0], "tall  B c|*** VOID ***|", "a locked title shrinks to sm, never xs");
});

test("Classic's meta lines are 0.93em in the picture, so a block's own size grows them less (the 4A gate's m-2)", () => {
  const sized = (size: "lg" | "xl") => withTemplate((t) => t.blocks.map((b) => (b.type === "orderId" ? { ...b, size } : b)));
  const orderLine = (settings: Settings) => shown(planOf(slipOf("round-label-number"), settings)).find((line) => line.includes("Order"));
  assert.equal(orderLine(sized("xl")), `tall    l|Order${" ".repeat(26)}ORD-20261004-042|`, "xl: 0.93 x 1.5 is double height, never double size");
  assert.equal(orderLine(sized("lg")), `normal  l|Order${" ".repeat(26)}ORD-20261004-042|`, "lg: 0.93 x 1.25 stays normal");
});

test("a label / value row's block alignment places its value as the picture does (the 4A gate's m-3)", () => {
  const aligned = (align: "left" | "center") =>
    withTemplate((t) => t.blocks.map((b) => (b.type === "orderId" || b.type === "table" ? { ...b, align } : b)));
  const lines = (settings: Settings) => shown(planOf(slipOf("round-label-number"), settings)).filter((line) => /\|(Order|Table) /.test(line));
  assert.deepEqual(lines(aligned("center")), [`normal  l|Order${" ".repeat(13)}ORD-20261004-042|`, `normal  l|Table${" ".repeat(20)}T4|`], "centred in the room after the label");
  assert.deepEqual(lines(aligned("left")), ["normal  l|Order ORD-20261004-042|", "normal  l|Table T4|"], "right after the label");
  assert.deepEqual(lines(withTemplate((t) => t.blocks)), [`normal  l|Order${" ".repeat(26)}ORD-20261004-042|`, `normal  l|Table${" ".repeat(40)}T4|`], "no alignment: the value right, as before");
});

test("an amount wider than a line prints as a picture: never cut, never a throw (the 4A gate's m-4)", () => {
  const xl = withTemplate((t) => t.blocks.map((b) => (b.type === "items" ? ({ ...b, size: "xl", options: { ...b.options, prices: true } } as KotBlock) : b)));
  const slip = slipOf("round-label-number");
  const dear = { ...slip, kotRoundItems: (slip.kotRoundItems ?? []).map((item) => ({ ...item, price: 1_00_00_00_000 })) };
  assert.deepEqual(kotTextJob({ slip: dear, settings: xl, columns: 32 }), { ok: false, refusal: "error" }, "Rs 2,00,00,00,000 at double size on 58 mm: no room, so the picture");
  assert.ok(kotTextJob({ slip: dear, settings: xl, columns: 48 }).ok, "landmark: on 80 mm the amount fits");
});

```

In `apps/cafe/lib/printer/kot-text/kot-text.test.ts`, find:

```ts
  const bytes = Array.from(job.bytes);
  assert.deepEqual(bytes.slice(0, 2), Array.from(ESC_INIT), "ESC @ first");
  assert.deepEqual(bytes.slice(-4), Array.from(CUT_PARTIAL_WITH_FEED), "the picture's cut last");
  assert.ok(bytes.length < 1_500, `a whole-order cancel notice is ${bytes.length} bytes (a picture KOT is about 44,000)`);
```

Replace it with:

```ts
  const bytes = Array.from(job.bytes);
  assert.deepEqual(bytes.slice(0, 2), Array.from(ESC_INIT), "ESC @ first");
  assert.deepEqual(bytes.slice(2, 5), [0x1b, 0x52, 0x00], "then ESC R 0: # [ ] @ print as themselves whatever the printer's own set");
  assert.deepEqual(bytes.slice(5, 8), [0x1b, 0x4d, 0x00], "then ESC M 0: Font A, whatever font the printer starts in");
  assert.deepEqual(bytes.slice(-4), Array.from(CUT_PARTIAL_WITH_FEED), "the picture's cut last");
  assert.ok(bytes.length < 1_500, `a whole-order cancel notice is ${bytes.length} bytes (a picture KOT is about 44,000)`);
```

In `apps/cafe/lib/printer/kot-text/text-chars.test.ts`, find:

```ts
});

test("line breaks are kept, a carriage return is dropped and a tab is a space", () => {
  assert.equal(asciiText("one\r\ntwo\nthree"), "one\ntwo\nthree", "CRLF and LF become LF");
  assert.equal(asciiText("a\tb"), "a b", "a tab is one space");
});
```

Replace it with:

```ts
});

test("line breaks are kept; a carriage return and a tab are spaces, as the picture shows them (the 4A gate's m-1)", () => {
  assert.equal(asciiText("one\r\ntwo\nthree"), "one \ntwo\nthree", "CRLF: a space, then the line break (the layout trims it)");
  assert.equal(asciiText("no onion\rno garlic"), "no onion no garlic", "a lone carriage return is a space, never two words run together");
  assert.equal(asciiText("a\tb"), "a b", "a tab is one space");
});
```

In `apps/cafe/lib/printer/kot-text/text-escpos.test.ts`, find:

```ts
const line = (text: string, over: Partial<TextLine> = {}): TextLine => ({ text, align: "left", bold: false, size: "normal", invert: false, ...over });
const END = [0x1b, 0x4a, RASTER_BOTTOM_PAD_ROWS, ...CUT_PARTIAL_WITH_FEED];

test("a plain line: init, its text, LF, the pad and the cut", () => {
  assert.deepEqual(Array.from(escposTextJob([line("Order 42")], 48)), [...ESC_INIT, ...ascii("Order 42"), 0x0a, ...END], "the smallest job");
});

```

Replace it with:

```ts
const line = (text: string, over: Partial<TextLine> = {}): TextLine => ({ text, align: "left", bold: false, size: "normal", invert: false, ...over });
const END = [0x1b, 0x4a, RASTER_BOTTOM_PAD_ROWS, ...CUT_PARTIAL_WITH_FEED];
/** ESC R 0 (the USA international character set) and ESC M 0 (Font A), right after ESC @ (the owner's rulings at the
 *  4A gate). */
const START = [...ESC_INIT, 0x1b, 0x52, 0x00, 0x1b, 0x4d, 0x00];

test("a plain line: init, its text, LF, the pad and the cut", () => {
  assert.deepEqual(Array.from(escposTextJob([line("Order 42")], 48)), [...START, ...ascii("Order 42"), 0x0a, ...END], "the smallest job");
});

```

In `apps/cafe/lib/printer/kot-text/text-escpos.test.ts`, find:

```ts
  ];
  const expected = [
    ...ESC_INIT,
    0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x01, ...ascii("KITCHEN ORDER"), 0x0a,
    0x1d, 0x21, 0x11, ...ascii("#12"), 0x0a,
```

Replace it with:

```ts
  ];
  const expected = [
    ...START,
    0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x01, ...ascii("KITCHEN ORDER"), 0x0a,
    0x1d, 0x21, 0x11, ...ascii("#12"), 0x0a,
```

In `apps/cafe/lib/printer/kot-text/text-escpos.test.ts`, find:

```ts
  const bytes = Array.from(escposTextJob(pieces, 48));
  assert.equal(bytes.filter((b, i) => b === 0x1b && bytes[i + 1] === 0x40).length, 1, "ESC @ is sent once, at the start");
});

test("an empty line is a bare LF", () => {
  assert.deepEqual(Array.from(escposTextJob([line("Note"), line("")], 32)), [...ESC_INIT, ...ascii("Note"), 0x0a, 0x0a, ...END], "LF alone");
});

```

Replace it with:

```ts
  const bytes = Array.from(escposTextJob(pieces, 48));
  assert.equal(bytes.filter((b, i) => b === 0x1b && bytes[i + 1] === 0x40).length, 1, "ESC @ is sent once, at the start");
  assert.equal(bytes.filter((b, i) => b === 0x1b && bytes[i + 1] === 0x52).length, 1, "ESC R is sent once, right after it");
  assert.equal(bytes.filter((b, i) => b === 0x1b && bytes[i + 1] === 0x4d).length, 1, "ESC M is sent once, right after that");
});

test("an empty line is a bare LF", () => {
  assert.deepEqual(Array.from(escposTextJob([line("Note"), line("")], 32)), [...START, ...ascii("Note"), 0x0a, 0x0a, ...END], "LF alone");
});

```

In `apps/cafe/lib/printer/kot-text/text-layout.test.ts`, find:

```ts
  const joined = layoutRows([{ kind: "text", text: "Line one\nLine two", style: plain }], 48);
  assert.deepEqual(textsOf(joined), ["Line one Line two"], "elsewhere a line break is a space");
  assert.deepEqual(textsOf(layoutRows([{ kind: "text", text: "   ", style: plain }], 48)), [], "a blank text prints nothing");
});
```

Replace it with:

```ts
  const joined = layoutRows([{ kind: "text", text: "Line one\nLine two", style: plain }], 48);
  assert.deepEqual(textsOf(joined), ["Line one Line two"], "elsewhere a line break is a space");
  const crlf = layoutRows([{ kind: "text", text: "Thank you\r\nCome again", style: plain, keepBreaks: true }], 48);
  assert.deepEqual(textsOf(crlf), ["Thank you", "Come again"], "custom text typed with CRLF keeps two clean lines");
  const lone = layoutRows([{ kind: "text", text: "no onion\rno garlic", style: plain }], 48);
  assert.deepEqual(textsOf(lone), ["no onion no garlic"], "a lone carriage return is a space (the 4A gate's m-1)");
  assert.deepEqual(textsOf(layoutRows([{ kind: "text", text: "   ", style: plain }], 48)), [], "a blank text prints nothing");
});
```

In `apps/cafe/lib/printer/kot-text/text-layout.test.ts`, find:

```ts
  const long = layoutRows([{ kind: "split", label: "Staff", value: "Aishwarya Ramachandran Iyer", style: plain }], 32);
  assert.deepEqual(textsOf(long), ["Staff", "    Aishwarya Ramachandran Iyer"], "the value drops to its own line, right-aligned");
});

```

Replace it with:

```ts
  const long = layoutRows([{ kind: "split", label: "Staff", value: "Aishwarya Ramachandran Iyer", style: plain }], 32);
  assert.deepEqual(textsOf(long), ["Staff", "    Aishwarya Ramachandran Iyer"], "the value drops to its own line, right-aligned");
});

test("a label / value pair exactly one line long stays on one line; one character more moves the value (the 4A gate's review, m-5)", () => {
  const exact = layoutRows([{ kind: "split", label: "Order", value: "x".repeat(41), style: plain }], 48);
  assert.deepEqual(textsOf(exact), [`Order ${"x".repeat(41)}`], "5 + 1 + 41 = 47 on 48 columns: one line");
  const over = layoutRows([{ kind: "split", label: "Order", value: "x".repeat(42), style: plain }], 48);
  assert.deepEqual(textsOf(over), ["Order", ` ${"x".repeat(42)}`.padStart(47)], "48: the value on its own line, right-aligned");
});

test("a label / value row whose block is aligned places its value as the picture's row does (the 4A gate's m-3)", () => {
  const row = (valueAlign: "left" | "center" | "right", value = "T-4") => layoutRows([{ kind: "split", label: "Table", value, style: plain, valueAlign }], 32);
  assert.deepEqual(textsOf(row("right")), [`Table${" ".repeat(23)}T-4`], "right: as with no alignment");
  assert.deepEqual(textsOf(row("center")), [`Table${" ".repeat(12)}T-4`], "centre: in the room after the label and its space (25 - 3 = 22, 11 before it)");
  assert.deepEqual(textsOf(row("left")), ["Table T-4"], "left: right after the label");
  const long = "Aishwarya Ramachandran Iyer";
  assert.deepEqual(textsOf(row("center", long)), ["Table", `  ${long}`], "a value on its own line, centred across it");
  assert.deepEqual(textsOf(row("left", long)), ["Table", long], "a value on its own line, at its start");
});

```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-chars.test.ts lib/printer/kot-text/text-layout.test.ts lib/printer/kot-text/text-escpos.test.ts lib/printer/kot-text/kot-text.test.ts lib/printer/kot-text/kot-text-bold.test.ts lib/printer/kot-text/text-test-slip.test.ts lib/printer/kot-text/kot-text-parity.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
not ok 16 - a label / value row's block alignment places its value as the picture does (the 4A gate's m-3)
not ok 22 - the job's bytes begin and end as a picture's, and are far smaller
not ok 25 - line breaks are kept; a carriage return and a tab are spaces, as the picture shows them (the 4A gate's m-1)
not ok 27 - a plain line: init, its text, LF, the pad and the cut
not ok 28 - each style is sent when it changes, and reset once at the end
not ok 29 - an empty line is a bare LF
not ok 35 - a text row is mapped, wrapped and styled; a band is padded to the full width
not ok 38 - a label / value row whose block is aligned places its value as the picture's row does (the 4A gate's m-3)
# tests 46
# pass 38
# fail 8
```

- [ ] **Step 3: Implement**

In `apps/cafe/lib/printer/kot-text/kot-text.ts`, find:

```ts

// A block's own size / alignment / weight (slip-style.ts), on top of its design's group size and the template's base
// size. A rule keeps its line; a feed is a feed.
function styled(rows: TextRow[], block: KotBlock, locked: boolean, groupRatio: number, baseRatio: number): TextRow[] {
  const size = locked && block.size === "xs" ? TEXT_LOCKED_MIN_SIZE : block.size;
```

Replace it with:

```ts

// A block's own size / alignment / weight (slip-style.ts), on top of its design's group size and the template's base
// size. A rule keeps its line; a feed is a feed. A label / value row's alignment places its value, as the picture's row
// does (the 4A gate's m-3); with none it stays right.
function styled(rows: TextRow[], block: KotBlock, locked: boolean, groupRatio: number, baseRatio: number): TextRow[] {
  const size = locked && block.size === "xs" ? TEXT_LOCKED_MIN_SIZE : block.size;
```

In `apps/cafe/lib/printer/kot-text/kot-text.ts`, find:

```ts
  return rows.map((row) => {
    if (row.kind === "rule" || row.kind === "feed") return row;
    return {
      ...row,
      style: { ...row.style, ratio: row.style.ratio * factor, align: block.align ?? row.style.align, bold: block.bold ?? row.style.bold },
    };
  });
}
```

Replace it with:

```ts
  return rows.map((row) => {
    if (row.kind === "rule" || row.kind === "feed") return row;
    const style = { ...row.style, ratio: row.style.ratio * factor, align: block.align ?? row.style.align, bold: block.bold ?? row.style.bold };
    return row.kind === "split" && block.align !== undefined ? { ...row, style, valueAlign: block.align } : { ...row, style };
  });
}
```

In `apps/cafe/lib/printer/kot-text/text-chars.ts`, find:

```ts

/** The text as printable ASCII, or null when it holds a character text mode cannot print. Line breaks are kept (as
 *  LF) for the caller to decide on; a carriage return is dropped and a tab is a space. */
export function asciiText(text: string): string | null {
  let out = "";
```

Replace it with:

```ts

/** The text as printable ASCII, or null when it holds a character text mode cannot print. Line breaks are kept (as
 *  LF) for the caller to decide on; a carriage return and a tab are spaces, as the picture shows them (a CRLF's space
 *  ends its line, where the layout trims it; a lone CR never runs two words together: the 4A gate's m-1). */
export function asciiText(text: string): string | null {
  let out = "";
```

In `apps/cafe/lib/printer/kot-text/text-chars.ts`, find:

```ts
    if (code >= PRINTABLE_MIN && code <= PRINTABLE_MAX) out += char;
    else if (char === "\n") out += "\n";
    else if (char === "\t") out += " ";
    else if (char !== "\r") {
      const mapped = TEXT_CHAR_MAP.get(char);
      if (mapped === undefined) return null;
```

Replace it with:

```ts
    if (code >= PRINTABLE_MIN && code <= PRINTABLE_MAX) out += char;
    else if (char === "\n") out += "\n";
    else if (char === "\t" || char === "\r") out += " ";
    else {
      const mapped = TEXT_CHAR_MAP.get(char);
      if (mapped === undefined) return null;
```

In `apps/cafe/lib/printer/kot-text/text-escpos.ts`, find:

```ts

// Printing Phase 4 (spec 2026-10-15 §4.3): a text job's bytes. Only standard ESC/POS commands every receipt printer
// knows: ESC @ (once, first), ESC a (alignment), ESC E (bold), GS ! (character size), GS B (white on black), LF, ESC J
// (a feed) and the picture's own cut. ESC J n feeds n of the printer's vertical motion units: a dot (1/203 inch) on most
// receipt printers, finer on some (1/360 inch on Epson TM), so a feed is about, not exactly, the picture's gap. No code page command: the text is printable ASCII (text-chars.ts). The
```

Replace it with:

```ts

// Printing Phase 4 (spec 2026-10-15 §4.3): a text job's bytes. Only standard ESC/POS commands every receipt printer
// knows: ESC @ (once, first), then ESC R 0 (the USA international character set) and ESC M 0 (Font A), the owner's
// rulings at the 4A gate: # [ ] @ { } ~ print as themselves and lines keep their columns whatever set or font the printer
// starts in (a memory switch can change both); ESC @ and a power-off clear them again, and a picture uses neither. Then
// ESC a (alignment), ESC E (bold), GS ! (character size), GS B (white on black), LF, ESC J
// (a feed) and the picture's own cut. ESC J n feeds n of the printer's vertical motion units: a dot (1/203 inch) on most
// receipt printers, finer on some (1/360 inch on Epson TM), so a feed is about, not exactly, the picture's gap. No code page command: the text is printable ASCII (text-chars.ts). The
```

In `apps/cafe/lib/printer/kot-text/text-escpos.ts`, find:

```ts
const LF = 0x0a;
const ALIGN_BYTE: Record<BlockAlign, number> = { left: 0, center: 1, right: 2 };
// GS ! n: width multiplier - 1 in the high nibble, height multiplier - 1 in the low one.
const SIZE_BYTE: Record<TextSize, number> = { normal: 0x00, tall: 0x01, big: 0x11 };
```

Replace it with:

```ts
const LF = 0x0a;
const ALIGN_BYTE: Record<BlockAlign, number> = { left: 0, center: 1, right: 2 };
/** ESC R 0: the USA international character set; ESC M 0: Font A. */
const SETUP = [ESC, 0x52, 0x00, ESC, 0x4d, 0x00];
// GS ! n: width multiplier - 1 in the high nibble, height multiplier - 1 in the low one.
const SIZE_BYTE: Record<TextSize, number> = { normal: 0x00, tall: 0x01, big: 0x11 };
```

In `apps/cafe/lib/printer/kot-text/text-escpos.ts`, find:

```ts
    throw new RangeError("escposTextJob: a blank slip is never sent");
  }
  const out: number[] = Array.from(ESC_INIT);
  let align = ALIGN_BYTE.left;
  let bold = false;
```

Replace it with:

```ts
    throw new RangeError("escposTextJob: a blank slip is never sent");
  }
  const out: number[] = [...ESC_INIT, ...SETUP];
  let align = ALIGN_BYTE.left;
  let bold = false;
```

In `apps/cafe/lib/printer/kot-text/text-layout.ts`, find:

```ts
  /** Free text; `keepBreaks` keeps its line breaks (custom text), elsewhere a break is a space. */
  | { kind: "text"; text: string; style: RowStyle; keepBreaks?: boolean }
  /** A label left and its value right; a pair that does not fit puts the value under the label, right-aligned. */
  | { kind: "split"; label: string; value: string; style: RowStyle }
  /** An item: its name left and its amount ("" for none) right on the first line; the name wraps, its later lines
   *  starting `hang` columns in. */
```

Replace it with:

```ts
  /** Free text; `keepBreaks` keeps its line breaks (custom text), elsewhere a break is a space. */
  | { kind: "text"; text: string; style: RowStyle; keepBreaks?: boolean }
  /** A label left and its value right; a pair that does not fit puts the value under the label, right-aligned. With
   *  its block's alignment (`valueAlign`) the value sits where the picture's row puts it: centred in the room after the
   *  label, or right after it (the 4A gate's m-3). */
  | { kind: "split"; label: string; value: string; style: RowStyle; valueAlign?: BlockAlign }
  /** An item: its name left and its amount ("" for none) right on the first line; the name wraps, its later lines
   *  starting `hang` columns in. */
```

In `apps/cafe/lib/printer/kot-text/text-layout.ts`, find:

```ts
  const width = lineWidth(columns, size);
  const left: RowStyle = { ...row.style, align: "left" };
  if (v === "") return wrapWords(l, width).map((part) => lineOf(part, left, size, width));
  if (l.length + 1 + v.length <= width) return [lineOf(l + " ".repeat(width - l.length - v.length) + v, left, size, width)];
  return [
    ...wrapWords(l, width).map((part) => lineOf(part, left, size, width)),
    ...wrapWords(v, width).map((part) => lineOf(part.padStart(width), left, size, width)),
  ];
}
```

Replace it with:

```ts
  const width = lineWidth(columns, size);
  const left: RowStyle = { ...row.style, align: "left" };
  const at = row.valueAlign ?? "right";
  // The spaces before a value in `room` columns: the picture's value fills the rest of its row, aligned in it.
  const before = (room: number, text: string): string => " ".repeat(at === "left" ? 0 : at === "center" ? Math.floor((room - text.length) / 2) : room - text.length);
  if (v === "") return wrapWords(l, width).map((part) => lineOf(part, left, size, width));
  if (l.length + 1 + v.length <= width) return [lineOf(`${l} ${before(width - l.length - 1, v)}${v}`, left, size, width)];
  return [
    ...wrapWords(l, width).map((part) => lineOf(part, left, size, width)),
    ...wrapWords(v, width).map((part) => lineOf(before(width, part) + part, left, size, width)),
  ];
}
```

- [ ] **Step 4: Run them, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-chars.test.ts lib/printer/kot-text/text-layout.test.ts lib/printer/kot-text/text-escpos.test.ts lib/printer/kot-text/kot-text.test.ts lib/printer/kot-text/kot-text-bold.test.ts lib/printer/kot-text/text-test-slip.test.ts lib/printer/kot-text/kot-text-parity.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint lib/printer/kot-text && echo "typecheck and lint clean"
```
Expected:
```text
# tests 46
# pass 46
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4b-9.txt`, then `git add apps/cafe/lib/printer/kot-text && git commit -F "$SP/msg-4b-9.txt"`:

```text
fix(cafe): printing Phase 4 Session 4B, the 4A review gate's rulings in the text renderer: every text job starts ESC @, ESC R 0 (the USA international character set) and ESC M 0 (Font A), the owner's rulings, so # [ ] @ { } ~ print as themselves and lines keep their columns whatever a printer's memory switches say; a carriage return is a space, as the picture shows it (m-1); a Classic label / value row whose block is aligned centre or left places its value as the picture's row does (m-3, the owner's ruling); tests for a skip-KOT line, Classic's meta size, Kitchen Bold's upper-case name, an over-wide amount, a long Classic item, a pair exactly one line long, the locked-size floor and the engine's locks on a stored template (the gate review's I-1, m-2, m-4, m-5) (spec §4.2, §4.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 10: The switch's storage (§5.1)

**Files:**
- Create: `apps/cafe/lib/printer/kot-text/text-kot-store.ts`
- Test: `apps/cafe/lib/printer/kot-text/text-kot-store.test.ts`; `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces: `TEXT_KOT_KEY = "pos.text-kot.v1"`; `interface TextKotChoice { narrow80: boolean }`; the record
  `{ v: 1, printers: Record<key, { narrow80 }> }` (zod-strict; anything else reads as every switch off; every access in
  try/catch); `type TextKotReach = DevicePrinter | { kind: "app"; nativeId } | { kind: "lan"; host; port } | { kind:
  "windows"; name }`; `textKotKeyForPrinter(printerId, reach)` → `printer:<id>:<reach>` and `textKotKeyForDevice(reach)`
  → `device:<reach>`, lower-cased; `readTextKot(key)`, `writeTextKot(key, choice | null)`, `subscribeTextKot(onChange)`.
  The store never reads or writes `pos.device-printer.v1`.

- [ ] **Step 1: Write the failing test**

Create `apps/cafe/lib/printer/kot-text/text-kot-store.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DEVICE_PRINTER_KEY } from "@/lib/printer/device-printer-store";
import {
  TEXT_KOT_KEY,
  readTextKot,
  subscribeTextKot,
  textKotKeyForDevice,
  textKotKeyForPrinter,
  writeTextKot,
} from "./text-kot-store";

// Printing Phase 4 (spec 2026-10-15 §5.1, S1, S2): the "Fast text KOTs" switch per printer, kept only in this device's
// storage under its own key. Anything absent, unreadable or foreign reads as every switch off (today's pictures).

type FakeStorage = { map: Map<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

function memoryStorage(): FakeStorage {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function installWindow(t: { after(fn: () => void): void }, win: unknown): void {
  const holder = globalThis as unknown as { window?: unknown };
  const had = Object.prototype.hasOwnProperty.call(holder, "window");
  const before = holder.window;
  holder.window = win;
  t.after(() => {
    if (had) holder.window = before;
    else delete holder.window;
  });
}

const KITCHEN = "printer:6710aa00000000000000000a:app:tcp:192.168.1.50:9100";
const BAR = "device:native:bt-classic:aa:bb:cc:dd:ee:ff";

test("the switch's own storage key, never the device printer's", () => {
  assert.equal(TEXT_KOT_KEY, "pos.text-kot.v1", "the documented key");
  assert.notEqual(TEXT_KOT_KEY, DEVICE_PRINTER_KEY, "a key of its own");
  const source = readFileSync(path.join(process.cwd(), "lib/printer/kot-text/text-kot-store.ts"), "utf8");
  for (const name of ["pos.device-printer", "DEVICE_PRINTER_KEY", "readDevicePrinter", "writeDevicePrinter", "watchDevicePrinter"]) {
    assert.ok(!source.includes(name), `the store never reads or writes the device printer's record (${name})`);
  }
});

test("an absent, unreadable or foreign record reads as every switch off", (t) => {
  const storage = memoryStorage();
  installWindow(t, { localStorage: storage });
  assert.equal(readTextKot(KITCHEN), null, "absent");
  for (const raw of ["", "{", "null", "[]", '"on"', "{}", '{"v":2,"printers":{}}', '{"v":1}', `{"v":1,"printers":{"${KITCHEN}":true}}`, `{"v":1,"printers":{"${KITCHEN}":{"narrow80":"yes"}}}`, `{"v":1,"printers":{"${KITCHEN}":{"narrow80":false,"columns":48}}}`, `{"v":1,"printers":{"${KITCHEN}":{"narrow80":false}},"extra":1}`]) {
    storage.map.set(TEXT_KOT_KEY, raw);
    assert.equal(readTextKot(KITCHEN), null, `unreadable: ${raw}`);
  }
});

test("a storage that throws reads as off, and a write does not throw", (t) => {
  const blocked = (): never => {
    throw new Error("blocked");
  };
  installWindow(t, { localStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
  assert.equal(readTextKot(KITCHEN), null, "a blocked read is off");
  assert.doesNotThrow(() => writeTextKot(KITCHEN, { narrow80: false }), "a blocked write is swallowed");
});

test("with no window at all (the server render) every switch is off", (t) => {
  installWindow(t, undefined);
  assert.equal(readTextKot(KITCHEN), null, "no window is off");
  assert.doesNotThrow(() => writeTextKot(KITCHEN, null), "no window: nothing to write");
});

test("a write round-trips; null removes that printer only; the last one gone removes the record", (t) => {
  const storage = memoryStorage();
  installWindow(t, { localStorage: storage });
  writeTextKot(KITCHEN, { narrow80: false });
  writeTextKot(BAR, { narrow80: true });
  assert.deepEqual(readTextKot(KITCHEN), { narrow80: false }, "the kitchen printer is on, Automatic");
  assert.deepEqual(readTextKot(BAR), { narrow80: true }, "the bar printer is on, 42 characters");
  assert.deepEqual(JSON.parse(storage.map.get(TEXT_KOT_KEY) ?? ""), { v: 1, printers: { [KITCHEN]: { narrow80: false }, [BAR]: { narrow80: true } } }, "only the 42 choice is kept, never the columns");
  writeTextKot(KITCHEN, null);
  assert.equal(readTextKot(KITCHEN), null, "the kitchen printer is off");
  assert.deepEqual(readTextKot(BAR), { narrow80: true }, "the bar printer stays on");
  writeTextKot(BAR, null);
  assert.equal(storage.map.has(TEXT_KOT_KEY), false, "no printer on: no record at all");
});

test("a write never touches the device printer's record", (t) => {
  const storage = memoryStorage();
  installWindow(t, { localStorage: storage });
  const device = '{"kind":"native","name":"Counter","paper":"80mm","printerId":"AA:BB","transport":"bt-classic"}';
  storage.map.set(DEVICE_PRINTER_KEY, device);
  writeTextKot(BAR, { narrow80: false });
  writeTextKot(BAR, null);
  assert.equal(storage.map.get(DEVICE_PRINTER_KEY), device, "pos.device-printer.v1 is exactly as it was");
});

const ID = "6710AA00000000000000000A";

test("a setup printer's key: its id and how this device reaches it, lower-cased", () => {
  assert.equal(textKotKeyForPrinter(ID, { kind: "app", nativeId: "tcp:192.168.1.50:9100" }), "printer:6710aa00000000000000000a:app:tcp:192.168.1.50:9100", "one of the POS app's printers, by the app's id");
  assert.equal(textKotKeyForPrinter(ID, { kind: "app", nativeId: "bt-classic:AA:BB:CC:DD:EE:FF" }), "printer:6710aa00000000000000000a:app:bt-classic:aa:bb:cc:dd:ee:ff", "a Bluetooth printer of the app");
  assert.equal(textKotKeyForPrinter(ID, { kind: "lan", host: "192.168.1.50", port: 9100 }), "printer:6710aa00000000000000000a:lan:192.168.1.50:9100", "a network printer of the Windows app");
  assert.equal(textKotKeyForPrinter(ID, { kind: "windows", name: "POS-80 Printer" }), "printer:6710aa00000000000000000a:windows:pos-80 printer", "a Windows printer by name");
  assert.equal(
    textKotKeyForPrinter(ID, { kind: "native", name: "Counter", paper: "80mm", printerId: "bt-classic:AA:BB:CC:DD:EE:FF", transport: "bt-classic" }),
    "printer:6710aa00000000000000000a:native:bt-classic:aa:bb:cc:dd:ee:ff",
    "printed on this device's own printer (an app on bridge v1)",
  );
});

test("a setup printer reached another way has a new key, so its switch reads off until its own text test", () => {
  const base = textKotKeyForPrinter(ID, { kind: "app", nativeId: "tcp:192.168.1.50:9100" });
  assert.equal(textKotKeyForPrinter(ID.toLowerCase(), { kind: "app", nativeId: "TCP:192.168.1.50:9100" }), base, "the same printer: the same key, whatever the case");
  for (const [why, key] of [
    ["another address", textKotKeyForPrinter(ID, { kind: "app", nativeId: "tcp:192.168.1.51:9100" })],
    ["another port", textKotKeyForPrinter(ID, { kind: "app", nativeId: "tcp:192.168.1.50:9101" })],
    ["another Bluetooth printer", textKotKeyForPrinter(ID, { kind: "app", nativeId: "bt-classic:aa:bb:cc:dd:ee:01" })],
    ["reached as the Windows app's network printer", textKotKeyForPrinter(ID, { kind: "lan", host: "192.168.1.50", port: 9100 })],
    ["another setup printer", textKotKeyForPrinter("6710aa00000000000000000b", { kind: "app", nativeId: "tcp:192.168.1.50:9100" })],
    ["this device's own printer in simple mode", textKotKeyForDevice({ kind: "native", name: "N", paper: "80mm", printerId: "tcp:192.168.1.50:9100", transport: "tcp" })],
  ] as const) {
    assert.notEqual(key, base, why);
  }
});

test("this device's own printer's key, per kind", () => {
  assert.equal(textKotKeyForDevice({ kind: "native", name: "Counter", paper: "80mm", printerId: "bt-classic:AA:BB:CC:DD:EE:FF", transport: "bt-classic" }), BAR, "the POS app's printer, by the app's id");
  assert.equal(textKotKeyForDevice({ kind: "native", name: "Network printer 10.0.2.2", paper: "58mm", printerId: "tcp:10.0.2.2:9100", transport: "tcp" }), "device:native:tcp:10.0.2.2:9100", "the POS app's network printer");
  assert.equal(textKotKeyForDevice({ kind: "serial", name: "USB printer", paper: "58mm", usbVendorId: 1208, usbProductId: 514 }), "device:serial:1208:514", "a USB serial printer by its ids");
  assert.equal(textKotKeyForDevice({ kind: "serial", name: "Bluetooth Printer", paper: "80mm", bluetoothServiceClassId: "00001101-0000-1000-8000-00805f9b34fb" }), "device:serial:bluetooth printer", "a serial printer with no USB ids, by its name (the planning review's m-8)");
  assert.equal(textKotKeyForDevice({ kind: "ble", name: "Kitchen", paper: "58mm", deviceId: "Abc123==", serviceUuid: "s", characteristicUuid: "c" }), "device:ble:abc123==", "a Bluetooth LE printer by its device id");
  assert.equal(textKotKeyForDevice({ kind: "windows", name: "POS-80 Printer" }), "device:windows:pos-80 printer", "the Windows app's chosen printer, by its name");
  assert.notEqual(textKotKeyForDevice({ kind: "windows", name: "POS-58" }), textKotKeyForDevice({ kind: "windows", name: "POS-80 Printer" }), "another Windows printer");
});

test("a change in this page or another tab tells the subscribers; another key does not", (t) => {
  const storage = memoryStorage();
  const handlers: Array<(event: { key: string | null }) => void> = [];
  installWindow(t, {
    localStorage: storage,
    addEventListener: (type: string, fn: (event: { key: string | null }) => void) => {
      if (type === "storage") handlers.push(fn);
    },
    removeEventListener: (type: string, fn: (event: { key: string | null }) => void) => {
      if (type === "storage") handlers.splice(handlers.indexOf(fn), 1);
    },
  });
  let heard = 0;
  const stop = subscribeTextKot(() => heard++);
  writeTextKot(KITCHEN, { narrow80: false });
  assert.equal(heard, 1, "an in-page write");
  for (const fn of [...handlers]) fn({ key: TEXT_KOT_KEY });
  assert.equal(heard, 2, "another tab's write");
  for (const fn of [...handlers]) fn({ key: DEVICE_PRINTER_KEY });
  assert.equal(heard, 2, "another record's change is not this one");
  for (const fn of [...handlers]) fn({ key: null });
  assert.equal(heard, 3, "storage cleared");
  stop();
  writeTextKot(KITCHEN, null);
  assert.equal(heard, 3, "unsubscribed");
  assert.equal(handlers.length, 0, "the storage listener is removed");
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/printer/kot-text/text-test-slip.test.ts",
    "lib/printer/kot-text/kot-text-parity.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

Replace it with:

```json
    "lib/printer/kot-text/text-test-slip.test.ts",
    "lib/printer/kot-text/kot-text-parity.test.ts",
    "lib/printer/kot-text/text-kot-store.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-kot-store.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
# Error: Cannot find module './text-kot-store'
not ok 1 - lib\\printer\\kot-text\\text-kot-store.test.ts
# tests 1
# pass 0
# fail 1
```

- [ ] **Step 3: Implement**

Create `apps/cafe/lib/printer/kot-text/text-kot-store.ts`:

```ts
import { z } from "zod";

import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Printing Phase 4 (spec 2026-10-15 §5.1, P4-3, S1, S2): the "Fast text KOTs" switch of each printer this device prints,
// kept only in this device's storage, under its own key (never inside the device printer's strict record, which an open
// older page would then fail to read). A printer is on when its key is here; only the 80 mm "42 characters per line"
// choice is kept, never the columns (they come from the printer's paper at each print). Like the device printer's store,
// every access is try/caught and anything absent, unreadable or foreign reads as every switch off: today's pictures.

export const TEXT_KOT_KEY = "pos.text-kot.v1";

/** A printer whose switch is on: whether its 80 mm paper prints 42 characters per line instead of 48. */
export interface TextKotChoice {
  narrow80: boolean;
}

const KEY_MAX_CHARS = 400;
const choiceSchema = z.object({ narrow80: z.boolean() }).strict();
const recordSchema = z.object({ v: z.literal(1), printers: z.record(z.string().min(1).max(KEY_MAX_CHARS), choiceSchema) }).strict();
type TextKotRecord = z.infer<typeof recordSchema>;

/** How this device reaches a printer, exactly as the picture's writer does: this device's own printer (the POS app's, a
 *  serial or a Bluetooth LE printer), one of the POS app's printers by the app's id (bridge v2), a network printer of the
 *  Windows app by its address, or a Windows printer by its name. */
export type TextKotReach =
  | DevicePrinter
  | { kind: "app"; nativeId: string }
  | { kind: "lan"; host: string; port: number }
  | { kind: "windows"; name: string };

function reachOf(reach: TextKotReach): string {
  switch (reach.kind) {
    case "native":
      return `native:${reach.printerId}`;
    case "serial":
      // A serial printer with no USB ids (a Bluetooth serial port) by its name: the planning review's m-8.
      return reach.usbVendorId !== undefined && reach.usbProductId !== undefined ? `serial:${reach.usbVendorId}:${reach.usbProductId}` : `serial:${reach.name}`;
    case "ble":
      return `ble:${reach.deviceId}`;
    case "app":
      return `app:${reach.nativeId}`;
    case "lan":
      return `lan:${reach.host}:${reach.port}`;
    case "windows":
      return `windows:${reach.name}`;
  }
}

/** A setup printer's key (printers mode): its id and how this device reaches it, so a printer pointed elsewhere in Printer
 *  setup, or reached here through another printer, is a new key, off until its own text test printed (the planning
 *  review's I-2). Lower-cased: the app spells a MAC upper-case, the setup may not. */
export function textKotKeyForPrinter(printerId: string, reach: TextKotReach): string {
  return `printer:${printerId}:${reachOf(reach)}`.toLowerCase();
}

/** This device's own printer's key (simple mode). */
export function textKotKeyForDevice(reach: TextKotReach): string {
  return `device:${reachOf(reach)}`.toLowerCase();
}

function readRecord(): TextKotRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TEXT_KOT_KEY);
    if (raw === null) return null;
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** That printer's switch: its choice when on, null when off (or when nothing can be read). */
export function readTextKot(key: string): TextKotChoice | null {
  const record = readRecord();
  return record !== null && Object.hasOwn(record.printers, key) ? { narrow80: record.printers[key].narrow80 } : null;
}

const listeners = new Set<() => void>();
let unwatch: (() => void) | null = null;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Turns that printer on (with its choice) or off (null); every other printer's switch stays as it is. A blocked storage
 *  keeps nothing: the printer then prints pictures. */
export function writeTextKot(key: string, choice: TextKotChoice | null): void {
  if (typeof window === "undefined") return;
  try {
    const printers = { ...(readRecord()?.printers ?? {}) };
    if (choice === null) delete printers[key];
    else printers[key] = { narrow80: choice.narrow80 };
    if (Object.keys(printers).length === 0) window.localStorage.removeItem(TEXT_KOT_KEY);
    else window.localStorage.setItem(TEXT_KOT_KEY, JSON.stringify({ v: 1, printers }));
  } catch {
    // Nothing kept, nothing crashed.
  }
  notify();
}

/** A switch changed on this page or in another tab of this browser (the `storage` event never fires in the tab that
 *  wrote). Returns the remover. */
export function subscribeTextKot(onChange: () => void): () => void {
  listeners.add(onChange);
  if (unwatch === null && typeof window !== "undefined" && typeof window.addEventListener === "function") {
    const handler = (event: StorageEvent): void => {
      if (event.key === null || event.key === TEXT_KOT_KEY) notify();
    };
    window.addEventListener("storage", handler);
    unwatch = () => window.removeEventListener("storage", handler);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && unwatch !== null) {
      unwatch();
      unwatch = null;
    }
  };
}
```

- [ ] **Step 4: Run it, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-kot-store.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint lib/printer/kot-text && echo "typecheck and lint clean"
```
Expected:
```text
# tests 10
# pass 10
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4b-10.txt`, then `git add apps/cafe/lib/printer/kot-text apps/cafe/package.json && git commit -F "$SP/msg-4b-10.txt"`:

```text
feat(cafe): printing Phase 4 Session 4B, the Fast text KOTs switch's storage: pos.text-kot.v1 on this device only, never inside the device printer's record; a printer is on when its key is there, and only its 80 mm 42-characters choice is kept; a key names the printer and how this device reaches it (the POS app's printer id, the Windows app's network address, a Windows printer's name, or this device's own printer), so a printer pointed elsewhere reads off until its own text test; anything unreadable reads as every switch off (spec §5.1, S1, S2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 11: The Windows printer's raw write, page side (§5.3, §6)

**Files:**
- Modify: `apps/cafe/lib/desktop-shell-printer.ts`, `apps/cafe/lib/printer/desktop-printer-state.ts`,
  `apps/cafe/components/print/DesktopPrintMethod.tsx`
- Test: `apps/cafe/lib/desktop-shell-raw-on.test.ts`; `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces: `DesktopLanBridge.printRawOn?(printerName: string, data: Uint8Array): Promise<void>` (on `window.posDesktop`:
  the Windows app 2.0.2, Session 4C); `desktopPrintsRaw()` (`typeof printRawOn === "function"`);
  `desktopPrintRawOn(printerName, data)` (the app's own sentences on a refusal, the picture's `DESKTOP_PRINT_TIMEOUT_MS`
  no-reply bound); `DesktopPrinterSnapshot.printMode?: DesktopPrintMode` (from `listPrinters`, absent when the app does
  not say); `DesktopPrintMethod` reads the store again after a save. `lib/desktop-shell.ts` is not changed (S1 pin).

- [ ] **Step 1: Write the failing test**

Create `apps/cafe/lib/desktop-shell-raw-on.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DESKTOP_PRINT_NO_REPLY_MESSAGE, DESKTOP_PRINT_TIMEOUT_MS, shellErrorMessage, type PosDesktopBridge } from "@/lib/desktop-shell";
import { desktopPrintRawOn, desktopPrintsRaw } from "@/lib/desktop-shell-printer";
import { desktopPrinterSnapshot, refreshDesktopPrinterChosen, resetDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";
import { stripComments } from "@/lib/source-pin-utils";

// Printing Phase 4 (spec 2026-10-15 §6, §5.3, §5.4): the page side of the Windows app's raw write to a Windows printer
// (printRawOn, the app 2.0.2): feature-detected, its refusals the app's own sentences, the picture's no-reply bound; and
// the app's print method kept with its printers, since text goes to a Windows printer only with "Direct to printer".

type FakeWindow = { posDesktop?: PosDesktopBridge };
function installWindow(t: { after(fn: () => void): void }, win: FakeWindow): void {
  (globalThis as unknown as { window: FakeWindow }).window = win;
  t.after(() => delete (globalThis as unknown as { window?: unknown }).window);
}

const SLIP = Uint8Array.from([0x1b, 0x40, 0x41, 0x0a]);

test("printRawOn is feature-detected: only an app that has it writes raw bytes to a Windows printer", (t) => {
  installWindow(t, { posDesktop: { version: "2.0.1", printHtml: async () => undefined, printHtmlOn: async () => undefined } });
  assert.equal(desktopPrintsRaw(), false, "an app before 2.0.2: its Windows printers print pictures");
  installWindow(t, { posDesktop: { version: "2.0.2", printHtml: async () => undefined, printRawOn: async () => undefined } });
  assert.equal(desktopPrintsRaw(), true, "the app 2.0.2");
  installWindow(t, {});
  assert.equal(desktopPrintsRaw(), false, "not the Windows app");
});

test("the bytes go to the named Windows printer, unchanged", async (t) => {
  const calls: Array<[string, number[]]> = [];
  installWindow(t, {
    posDesktop: {
      version: "2.0.2",
      printHtml: async () => undefined,
      printRawOn: async (name: string, data: Uint8Array) => void calls.push([name, [...data]]),
    },
  });
  await desktopPrintRawOn("POS-80 Printer", SLIP);
  assert.deepEqual(calls, [["POS-80 Printer", [...SLIP]]], "one call, the printer's name and the slip's bytes");
});

test("a refusal carries the app's own sentence, which the bridge reads as it reads a picture's", async (t) => {
  const sentence = "That printer is not on this PC. Choose it again in printer setup.";
  installWindow(t, {
    posDesktop: {
      version: "2.0.2",
      printHtml: async () => undefined,
      printRawOn: async () => {
        throw new Error(`Error invoking remote method 'pos-desktop:print-raw-on': Error: ${sentence}`);
      },
    },
  });
  await assert.rejects(desktopPrintRawOn("Gone", SLIP), (error: unknown) => {
    assert.equal(shellErrorMessage(error), sentence, "the shell's sentence, unwrapped");
    return true;
  });
});

test("an app that never answers is given up after the picture's own bound", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  installWindow(t, { posDesktop: { version: "2.0.2", printHtml: async () => undefined, printRawOn: () => new Promise<void>(() => undefined) } });
  const pending = desktopPrintRawOn("POS-80 Printer", SLIP);
  t.mock.timers.tick(DESKTOP_PRINT_TIMEOUT_MS);
  await assert.rejects(pending, new Error(DESKTOP_PRINT_NO_REPLY_MESSAGE), "the no-reply sentence, as a picture's");
});

test("the Windows printers' store keeps the app's print method; an app that does not say leaves it out", async (t) => {
  resetDesktopPrinterChosen();
  t.after(resetDesktopPrinterChosen);
  let mode: string | undefined = "direct";
  installWindow(t, {
    posDesktop: {
      version: "2.0.2",
      printHtml: async () => undefined,
      listPrinters: async () => ({ selected: "POS-80", printers: [{ name: "POS-80", displayName: "POS-80" }], ...(mode === undefined ? {} : { printMode: mode as "direct" }) }),
      savePrinter: async (name: string | null) => ({ selected: name }),
    },
  });
  await refreshDesktopPrinterChosen();
  assert.deepEqual(desktopPrinterSnapshot(), { chosen: "chosen", selected: "POS-80", names: ["POS-80"], printMode: "direct" }, "Direct to printer");
  mode = "driver";
  await refreshDesktopPrinterChosen();
  assert.equal(desktopPrinterSnapshot().printMode, "driver", "Through the Windows driver: a change of method is a change of the store");
  mode = undefined;
  await refreshDesktopPrinterChosen();
  assert.equal("printMode" in desktopPrinterSnapshot(), false, "an app that does not say: no method");
  mode = "sideways";
  await refreshDesktopPrinterChosen();
  assert.equal("printMode" in desktopPrinterSnapshot(), false, "a method the page does not know: none");
});

test("PIN: a saved print method is read back into the store at once, so the next slip follows it", () => {
  const method = stripComments(readFileSync(path.join(process.cwd(), "components/print/DesktopPrintMethod.tsx"), "utf8"));
  const save = method.indexOf("const result = await savePrintMode(next);");
  const refresh = method.indexOf("void refreshDesktopPrinterChosen();");
  assert.ok(save >= 0 && refresh > save, "after the save, the store reads the app's printers and method again");
  assert.ok(method.includes('import { refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";'), "from the Windows printers' store");
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/session-rolling.test.ts",
    "lib/desktop-shell.test.ts",
    "lib/desktop-shell-paths.test.ts",
    "lib/gst-discount.test.ts",
```

Replace it with:

```json
    "lib/session-rolling.test.ts",
    "lib/desktop-shell.test.ts",
    "lib/desktop-shell-raw-on.test.ts",
    "lib/desktop-shell-paths.test.ts",
    "lib/gst-discount.test.ts",
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/desktop-shell-raw-on.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
not ok 1 - printRawOn is feature-detected: only an app that has it writes raw bytes to a Windows printer
not ok 2 - the bytes go to the named Windows printer, unchanged
not ok 3 - a refusal carries the app's own sentence, which the bridge reads as it reads a picture's
not ok 4 - an app that never answers is given up after the picture's own bound
not ok 5 - the Windows printers' store keeps the app's print method; an app that does not say leaves it out
not ok 6 - PIN: a saved print method is read back into the store at once, so the next slip follows it
# tests 6
# pass 0
# fail 6
```

- [ ] **Step 3: Implement**

In `apps/cafe/components/print/DesktopPrintMethod.tsx`, find:

```tsx
  type DesktopPrinterApi,
} from "@/lib/desktop-shell-printer";

const SAVE_MODE_FAILED_MESSAGE = "Could not save the print method — try again.";
```

Replace it with:

```tsx
  type DesktopPrinterApi,
} from "@/lib/desktop-shell-printer";
import { refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";

const SAVE_MODE_FAILED_MESSAGE = "Could not save the print method — try again.";
```

In `apps/cafe/components/print/DesktopPrintMethod.tsx`, find:

```tsx
      const result = await savePrintMode(next);
      setMode(result.printMode);
      toast.success(SAVE_MODE_SUCCESS_MESSAGE);
    } catch {
```

Replace it with:

```tsx
      const result = await savePrintMode(next);
      setMode(result.printMode);
      // Printing Phase 4 (spec §5.3): the next slip follows the new method (text KOTs only with Direct).
      void refreshDesktopPrinterChosen();
      toast.success(SAVE_MODE_SUCCESS_MESSAGE);
    } catch {
```

In `apps/cafe/lib/desktop-shell-printer.ts`, find:

```ts
// the browser print dialog kept working, because the operator picks the
// printer there. This is that choice, made once and stored by the shell.
import { desktopShell } from "@/lib/desktop-shell";
import type { PaperWidth } from "@/lib/constants";

```

Replace it with:

```ts
// the browser print dialog kept working, because the operator picks the
// printer there. This is that choice, made once and stored by the shell.
import { DESKTOP_PRINT_FAILED_MESSAGE, DESKTOP_PRINT_NO_REPLY_MESSAGE, DESKTOP_PRINT_TIMEOUT_MS, desktopShell } from "@/lib/desktop-shell";
import type { PaperWidth } from "@/lib/constants";

```

In `apps/cafe/lib/desktop-shell-printer.ts`, find:

```ts
  printRaw?(printer: { host: string; port: number }, data: Uint8Array): Promise<unknown>;
  lanStatus?(printers: { host: string; port: number }[]): Promise<unknown>;
}

```

Replace it with:

```ts
  printRaw?(printer: { host: string; port: number }, data: Uint8Array): Promise<unknown>;
  lanStatus?(printers: { host: string; port: number }[]): Promise<unknown>;
  /** Printing Phase 4 (spec §6): the Windows app 2.0.2 writes a slip's ESC/POS bytes to a Windows printer by its name,
   *  through the raw spool its Direct method already uses. Optional and feature-detected like the rest: an older app has
   *  none, so its Windows printers print pictures. */
  printRawOn?(printerName: string, data: Uint8Array): Promise<void>;
}

/** Printing Phase 4 (spec §5.3, §6): the Windows app writes raw bytes to a Windows printer (printRawOn, 2.0.2). */
export function desktopPrintsRaw(): boolean {
  return typeof desktopShell()?.printRawOn === "function";
}

/** Printing Phase 4 (spec §5.4): one text slip's bytes to a Windows printer. A refusal carries the app's own sentence (the
 *  bridge reads it with shellErrorMessage, as a picture's), and an app that never answers is given up after the picture's
 *  own bound (DESKTOP_PRINT_TIMEOUT_MS). */
export async function desktopPrintRawOn(printerName: string, data: Uint8Array): Promise<void> {
  const shell = desktopShell();
  if (typeof shell?.printRawOn !== "function") throw new Error(DESKTOP_PRINT_FAILED_MESSAGE);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const noReply = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(DESKTOP_PRINT_NO_REPLY_MESSAGE)), DESKTOP_PRINT_TIMEOUT_MS);
  });
  try {
    await Promise.race([shell.printRawOn(printerName, data), noReply]);
  } finally {
    clearTimeout(timer);
  }
}

```

In `apps/cafe/lib/printer/desktop-printer-state.ts`, find:

```ts
import { desktopPrinterApi } from "@/lib/desktop-shell-printer";

// Whether the Windows desktop shell has a printer CHOSEN. The shell refuses
```

Replace it with:

```ts
import { DESKTOP_PRINT_MODES, desktopPrinterApi, type DesktopPrintMode } from "@/lib/desktop-shell-printer";

// Whether the Windows desktop shell has a printer CHOSEN. The shell refuses
```

In `apps/cafe/lib/printer/desktop-printer-state.ts`, find:

```ts
  /** Every printer Windows reports on this PC, by name; null until read. */
  names: readonly string[] | null;
}

```

Replace it with:

```ts
  /** Every printer Windows reports on this PC, by name; null until read. */
  names: readonly string[] | null;
  /** Printing Phase 4 (spec §5.3): the app's print method as it last said; absent before a read and on an app that does
   *  not say. Text KOTs go to a Windows printer only with "direct". */
  printMode?: DesktopPrintMode;
}

```

In `apps/cafe/lib/printer/desktop-printer-state.ts`, find:

```ts
}

function sameNames(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
```

Replace it with:

```ts
}

function printModeOf(mode: unknown): { printMode?: DesktopPrintMode } {
  return DESKTOP_PRINT_MODES.find((known) => known === mode) === undefined ? {} : { printMode: mode as DesktopPrintMode };
}

function sameNames(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
```

In `apps/cafe/lib/printer/desktop-printer-state.ts`, find:

```ts

function publish(next: DesktopPrinterSnapshot): void {
  if (next.chosen === current.chosen && next.selected === current.selected && sameNames(next.names, current.names)) return;
  current = next;
  for (const listener of [...listeners]) listener();
```

Replace it with:

```ts

function publish(next: DesktopPrinterSnapshot): void {
  if (next.chosen === current.chosen && next.selected === current.selected && sameNames(next.names, current.names) && next.printMode === current.printMode) return;
  current = next;
  for (const listener of [...listeners]) listener();
```

In `apps/cafe/lib/printer/desktop-printer-state.ts`, find:

```ts
  }
  try {
    const { selected, printers } = await api.listPrinters();
    if (ticket !== readTicket) return current.chosen;
    publish({ chosen: chosenOf(selected), selected: selectedOf(selected), names: namesOf(printers) });
  } catch {
    // Unreadable right now: keep what we knew rather than flip the dot.
```

Replace it with:

```ts
  }
  try {
    const { selected, printers, printMode } = await api.listPrinters();
    if (ticket !== readTicket) return current.chosen;
    publish({ chosen: chosenOf(selected), selected: selectedOf(selected), names: namesOf(printers), ...printModeOf(printMode) });
  } catch {
    // Unreadable right now: keep what we knew rather than flip the dot.
```

- [ ] **Step 4: Run it with the Windows suites, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/desktop-shell-raw-on.test.ts lib/printer/print-lane.test.ts lib/desktop-shell.test.ts lib/desktop-shell-paths.test.ts lib/print-windows-printers.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint lib/desktop-shell-printer.ts lib/printer/desktop-printer-state.ts components/print/DesktopPrintMethod.tsx lib/desktop-shell-raw-on.test.ts && echo "typecheck and lint clean"
```
Expected:
```text
# tests 77
# pass 77
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4b-11.txt`, then `git add apps/cafe && git commit -F "$SP/msg-4b-11.txt"`:

```text
feat(cafe): printing Phase 4 Session 4B, the Windows printer's raw write, page side: printRawOn on window.posDesktop (the Windows app 2.0.2), feature-detected; one text slip to a Windows printer with the picture's no-reply bound and the app's own sentences; the app's print method kept in the Windows printers' store and read again after a save, since text goes to a Windows printer only with Direct to printer (spec §5.3, §6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 12: The bridge's text step (§5.2, §5.4, S1, S3, S4)

**Files:**
- Create: `apps/cafe/lib/printer/kot-text/text-kot-print.ts`
- Modify: `apps/cafe/hooks/use-print-host-bridge.ts`, `apps/cafe/lib/print-host-slips.ts` (`HostPrintSlip.printerId`,
  `takeover`), `apps/cafe/lib/print-agent-slip.ts`, `apps/cafe/hooks/use-print-agent.ts` (a takeover's slip)
- Test: `apps/cafe/lib/printer/kot-text/text-kot-print.test.ts` (with the S1 source pin), `apps/cafe/lib/print-host-text-kot.test.ts`
  (the real bridge under the hook harness); `lib/print-host-paths.test.ts` and `lib/printer/print-gating-fx-paths.test.ts`
  (the bridge's line budget 255 → 265); `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces: `interface TextKotEnv` (the device printer's snapshot; the Windows app's chosen printer and print method;
  `desktopPrintsRaw()`; `rasterCapable()`; `readTextKot`; `slipCodeStatus`; the writers `writeDevice`, `writeNative`,
  `writeLan`, `writeRawOn`) and `textKotEnv()` (the real ones); `interface TextKotRoute { key; paper; write(bytes) }` and
  `textKotRouteOf({ printerId, target, settings, env })`: the writer the picture takes (a Windows app network printer by
  its raw TCP; on the Windows app a Windows printer only with `printRawOn` and Direct, the job's or, in simple mode, the
  chosen one at the kitchen ticket's paper; one of the POS app's printers by its id; else this device's own printer,
  never on a plain browser, never with none saved or another tab owning it); `textKotFitsPicture(length, paper)`;
  `textKotWriteFor({ slip, settings, target, env }): { bytes; write() } | null`: null unless the slip is a job's
  kitchen slip (`surface === "kot"`), not a takeover (`slip.takeover`, spec §5.3), its route exists, its switch is on, its design needs no lazy code that is not
  `"ready"` (I-4), `kotTextJob` answers ok at `textColumnsOf(route.paper, narrow80)` with the picture's own settings
  (`settingsForPaper` with a target) and the bytes fit (rule 7); never throws.
- The bridge: for the KOT surface, `textKotWriteFor` right before `printKot()`; with an answer it writes under the same
  watchdog and settles with `null` or `hostPrintFailureMessage(error)`; with none it calls `printKot()` exactly as before.

- [ ] **Step 1: Write the failing tests**

In `apps/cafe/lib/print-host-paths.test.ts`, find:

```ts
// onHost hook that lets a host answer trigger the offline follow-up (W-O) are 7 unavoidable lines.
// Phase 2 Session 2E: use-print-host-bridge.ts 250 -> 255 (measured 252): a slip's own Windows printer and paper.
test("PIN (P): line budgets — PrintHostProvider.tsx <= 200, use-print-host-bridge.ts <= 255, use-print-host-drain.ts <= 150, use-print-host-beat.ts <= 90, PrintHostPrintSources.tsx <= 110, PrintHostEodSource.tsx <= 90, PosPulseProvider.tsx <= 300, use-self-order-auto-print.ts <= 300", () => {
  const budgets: [string, number][] = [
    [PRINT_HOST_PROVIDER, 200],
    [USE_PRINT_HOST_BRIDGE, 255],
    [USE_PRINT_HOST_DRAIN, 150],
    [USE_PRINT_HOST_BEAT, 90],
```

Replace it with:

```ts
// onHost hook that lets a host answer trigger the offline follow-up (W-O) are 7 unavoidable lines.
// Phase 2 Session 2E: use-print-host-bridge.ts 250 -> 255 (measured 252): a slip's own Windows printer and paper.
// Printing Phase 4 Session 4B: use-print-host-bridge.ts 255 -> 265 (measured 262): the text step before the KOT surface.
test("PIN (P): line budgets — PrintHostProvider.tsx <= 200, use-print-host-bridge.ts <= 265, use-print-host-drain.ts <= 150, use-print-host-beat.ts <= 90, PrintHostPrintSources.tsx <= 110, PrintHostEodSource.tsx <= 90, PosPulseProvider.tsx <= 300, use-self-order-auto-print.ts <= 300", () => {
  const budgets: [string, number][] = [
    [PRINT_HOST_PROVIDER, 200],
    [USE_PRINT_HOST_BRIDGE, 265],
    [USE_PRINT_HOST_DRAIN, 150],
    [USE_PRINT_HOST_BEAT, 90],
```

Create `apps/cafe/lib/print-host-text-kot.test.ts`:

```ts
import "@/lib/hook-harness"; // installs the react / react-to-print / sonner stubs: MUST stay the first import
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mountHook, resetStubs, stubModule, stubs, type MountedHook } from "@/lib/hook-harness";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_DISPATCH_TIMEOUT_MS, PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
import type { TextKotWrite, TextKotWriteInput } from "@/lib/printer/kot-text/text-kot-print";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing Phase 4 (spec 2026-10-15 §5.2, S1, S3, S4): the print bridge's text step, driven through the REAL hook body
// (lib/hook-harness.ts) with the text step stubbed. A kitchen slip the text step answers goes through that write, never
// the picture, under the same busy window, watchdog and outcome; one it answers null for fires the picture as before.

const world: { answer: (input: TextKotWriteInput) => TextKotWrite | null; asked: string[] } = { answer: () => null, asked: [] };
stubModule("@/lib/printer/kot-text/text-kot-print", {
  textKotEnv: () => ({}),
  textKotWriteFor: (input: TextKotWriteInput) => {
    world.asked.push(input.slip.documentTitle);
    return world.answer(input);
  },
}); // BEFORE the bridge loads
const load = createRequire(__filename);
const { usePrintHostBridge } = load("@/hooks/use-print-host-bridge") as typeof import("@/hooks/use-print-host-bridge");

type Bridge = ReturnType<typeof usePrintHostBridge>;
const BYTES = Uint8Array.from([0x1b, 0x40, 0x41, 0x0a]);
const slipOf = (surface: HostPrintSlip["surface"], title: string): HostPrintSlip => ({ surface, documentTitle: title, kotVariant: "kot", order: {} }) as unknown as HostPrintSlip;

interface Held {
  calls: number;
  resolve(): void;
  reject(error: Error): void;
}
/** A text write the test settles by hand. */
function heldWrite(): Held & { answer: TextKotWrite } {
  const held = { calls: 0, resolve: () => undefined, reject: (_error: Error) => undefined } as Held;
  const answer: TextKotWrite = {
    bytes: BYTES,
    write: () => {
      held.calls += 1;
      return new Promise<void>((resolve, reject) => {
        held.resolve = resolve;
        held.reject = reject;
      });
    },
  };
  return Object.assign(held, { answer });
}

function scene(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  resetStubs();
  world.asked = [];
  world.answer = () => null;
  const hook: MountedHook<Bridge> = mountHook(() => usePrintHostBridge({ surfacesMounted: true }));
  for (const ref of [hook.result().kotRef, hook.result().receiptRef, hook.result().eodRef]) ref.current = { textContent: "A SLIP" } as HTMLDivElement;
  const outcomes: string[] = [];
  const done: HostPrintDone = (result) => void outcomes.push(result.ok ? "printed" : `failed: ${result.error instanceof Error ? result.error.message : String(result.error)}`);
  return {
    hook,
    outcomes,
    queue: (surface: HostPrintSlip["surface"], title: string) => hook.act(() => hook.result().queueSlip(slipOf(surface, title), done)),
    /** react-to-print reports the picture done (the KOT surface's onAfterPrint). */
    finish: () => hook.act(() => stubs.options[0]?.onAfterPrint?.()),
    settled: async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
      hook.rerender();
    },
  };
}

test("S1: a kitchen slip the text step answers nothing for fires the picture, exactly as before", async (t) => {
  const s = scene(t);
  s.queue("kot", "KOT-1");
  assert.deepEqual(world.asked, ["KOT-1"], "the text step was asked, once");
  assert.deepEqual(stubs.printed, ["kot"], "the picture: the KOT surface fired");
  s.finish();
  assert.deepEqual(s.outcomes, ["printed"], "the picture's own outcome");
  assert.equal(s.hook.result().current, null, "the bridge is free");
});

test("text: the slip's bytes go through its printer's writer, never the picture, and the slip settles with the write", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  world.answer = () => held.answer;
  s.queue("kot", "KOT-1");
  assert.equal(held.calls, 1, "one write");
  assert.deepEqual(stubs.printed, [], "the KOT surface never fired");
  assert.equal(s.hook.result().busy, true, "the busy window holds while the write is out");
  held.resolve();
  await s.settled();
  assert.deepEqual(s.outcomes, ["printed"], "printed when the write is done");
  assert.equal(s.hook.result().current, null, "the bridge is free");
  assert.deepEqual(stubs.toasts, [], "no message");
});

test("a text write that fails settles with the writer's own sentence, as the picture's failure does", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  world.answer = () => held.answer;
  s.queue("kot", "KOT-1");
  held.reject(new Error(PRINTER_NOT_CONNECTED_MESSAGE));
  await s.settled();
  assert.deepEqual(s.outcomes, [`failed: ${PRINTER_NOT_CONNECTED_MESSAGE}`], "the agent hears the printer's sentence (sent: no, never counted)");
  assert.deepEqual(stubs.toasts, [PRINTER_NOT_CONNECTED_MESSAGE], "and staff see it, as for a picture");
});

test("the watchdog bounds a text write as it bounds a picture", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  world.answer = () => held.answer;
  s.queue("kot", "KOT-1");
  s.hook.act(() => t.mock.timers.tick(PRINT_HOST_DISPATCH_TIMEOUT_MS));
  assert.deepEqual(stubs.toasts, [PRINT_HOST_PRINT_FAILED_MESSAGE], "given up and said so");
  s.queue("kot", "KOT-2");
  assert.equal(held.calls, 1, "the next slip waits while the abandoned write may still be printing");
  held.resolve();
  await s.settled();
  assert.equal(held.calls, 2, "the late completion released the bridge: the next slip went (as text: the same answer)");
});

test("slips print in order: the next waits for the text write", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  world.answer = (input) => (input.slip.documentTitle === "KOT-1" ? held.answer : null);
  s.queue("kot", "KOT-1");
  s.queue("kot", "KOT-2");
  assert.deepEqual(world.asked, ["KOT-1"], "the second slip waits");
  assert.deepEqual(stubs.printed, [], "nothing fired yet");
  held.resolve();
  await s.settled();
  assert.deepEqual(world.asked, ["KOT-1", "KOT-2"], "then the second is asked");
  assert.deepEqual(stubs.printed, ["kot"], "and prints as a picture (its answer was null)");
  s.finish();
  assert.deepEqual(s.outcomes, ["printed", "printed"], "each slip's own outcome, in order");
});

test("a bill, a token, End of day and the attestation test slip never ask the text step", async (t) => {
  const s = scene(t);
  world.answer = () => {
    throw new Error("never asked");
  };
  s.queue("receipt", "BILL-1");
  assert.deepEqual(stubs.printed, ["receipt"], "the bill's picture");
  s.hook.act(() => stubs.options[1]?.onAfterPrint?.());
  s.queue("token", "TOKEN-1");
  assert.deepEqual(stubs.printed, ["receipt", "receipt"], "the token's picture");
  s.hook.act(() => stubs.options[1]?.onAfterPrint?.());
  const test = s.hook.result().queueTestSlip();
  assert.deepEqual(stubs.printed, ["receipt", "receipt", "kot"], "the attestation test slip's picture");
  s.finish();
  await test;
  assert.deepEqual(world.asked, [], "the text step was never asked");
});
```

Create `apps/cafe/lib/printer/kot-text/text-kot-print.test.ts`:

```ts
import { settingsOf } from "../../print-template-golden.fixtures"; // FIRST: React's production build
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { KotBlock, KotTemplate } from "@pos/shared/print-template";
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import type { SlipCodeStatus } from "@/components/print/slip/slip-code";
import { printAgentSlipOf } from "@/lib/print-agent-slip";
import type { HostPrintSlip, SlipPrintTarget } from "@/lib/print-host-slips";
import { defaultKotTemplate } from "@/lib/print-template-designs";
import { classicKotTemplate } from "@/lib/print-template-legacy";
import { DOTS_58MM, DOTS_80MM, RASTER_MAX_ROWS } from "@/lib/printer/escpos";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import type { PrinterSnapshot } from "@/lib/printer/web-printer-types";
import type { Settings } from "@/types";
import { kotTextJob } from "./kot-text";
import { slipOf } from "./kot-text.fixtures";
import { textKotFitsPicture, textKotRouteOf, textKotWriteFor, type TextKotEnv } from "./text-kot-print";
import { textKotKeyForDevice, textKotKeyForPrinter, type TextKotChoice } from "./text-kot-store";

// Printing Phase 4 (spec 2026-10-15 §5.2, §5.4, S1, S3, S4): the print bridge's text step. With a printer's switch off,
// or anything text cannot print exactly, it answers null and calls no writer: the bridge then fires the picture as today.

const APP_80: DevicePrinter = { kind: "native", name: "Counter", paper: "80mm", printerId: "bt-classic:AA:BB:CC:DD:EE:FF", transport: "bt-classic" };
const APP_58: DevicePrinter = { kind: "native", name: "Kitchen 58", paper: "58mm", printerId: "tcp:10.0.2.2:9100", transport: "tcp" };
const PLAIN = settingsOf({ logo: "" });
const PRINTER = "6710aa00000000000000000a";

function fakeEnv(over: Partial<TextKotEnv> = {}) {
  const writes: string[] = [];
  const on = new Map<string, TextKotChoice>();
  let device: PrinterSnapshot = { status: "connected", printer: APP_80, message: null };
  const env: TextKotEnv = {
    devicePrinter: () => device,
    desktop: () => null,
    desktopPrintsRaw: () => false,
    rasterCapable: () => true,
    readTextKot: (key) => on.get(key) ?? null,
    slipCodeStatus: () => "idle",
    writeDevice: async (bytes) => void writes.push(`device ${bytes.length}`),
    writeNative: async (nativeId, bytes) => void writes.push(`app ${nativeId} ${bytes.length}`),
    writeLan: async (target, bytes) => void writes.push(`lan ${target.host}:${target.port} ${bytes.length}`),
    writeRawOn: async (name, bytes) => void writes.push(`windows ${name} ${bytes.length}`),
    ...over,
  };
  return {
    env,
    writes,
    on: (key: string, narrow80 = false) => on.set(key, { narrow80 }),
    setDevice: (next: PrinterSnapshot) => void (device = next),
  };
}

const KOTS = ["round-label-number", "void-reason-by-at", "moved-from-by-at", "cancel-notice-reason"] as const;
const ask = (env: TextKotEnv, slip: HostPrintSlip, target?: SlipPrintTarget, settings: Settings = PLAIN) => textKotWriteFor({ slip, settings, target, env });
const columnsJob = (slip: HostPrintSlip, columns: 32 | 42 | 48, settings: Settings = PLAIN) => {
  const job = kotTextJob({ slip: slip as Parameters<typeof kotTextJob>[0]["slip"], settings, columns });
  assert.ok(job.ok, "the slip prints as text");
  return job.bytes;
};

test("S1: with every switch off no slip answers text and no writer is called, on every route", async () => {
  const routes: Array<[string, Partial<TextKotEnv>, SlipPrintTarget | undefined, string | undefined]> = [
    ["the POS app's own printer", {}, undefined, undefined],
    ["one of the app's printers", {}, { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" }, PRINTER],
    ["a network printer of the Windows app", { desktop: () => ({ chosen: "POS-80", printMode: "direct" }) }, { lan: { host: "192.168.1.50", port: 9100 }, paper: "80mm" }, PRINTER],
    ["a Windows printer", { desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, { printerName: "Kitchen TVS", paper: "80mm" }, PRINTER],
    ["the Windows app's chosen printer", { desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, undefined, undefined],
  ];
  for (const [name, over, target, printerId] of routes) {
    const f = fakeEnv(over);
    for (const id of KOTS) {
      const slip: HostPrintSlip = { ...slipOf(id), ...(printerId === undefined ? {} : { printerId }) };
      assert.equal(ask(f.env, slip, target), null, `${name} / ${id}: off is a picture`);
    }
    assert.deepEqual(f.writes, [], `${name}: no writer called`);
  }
});

test("only a job's kitchen slip: a bill, a token, End of day and a printer's Test print answer nothing with the switch on", () => {
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  const order = slipOf("round-label-number").order;
  const others: HostPrintSlip[] = [
    { surface: "receipt", order, documentTitle: "bill" },
    { surface: "token", order, documentTitle: "token" },
    { surface: "eod", dateKey: "2026-10-15", dateLabel: "15 Oct", isToday: true, documentTitle: "eod" },
    { surface: "test", printerName: "Kitchen", lines: ["Kitchen"], requestedBy: "Asha", requestedAt: "2026-10-15T10:00:00.000Z", documentTitle: "test" },
  ];
  for (const slip of others) assert.equal(ask(f.env, slip), null, `${slip.surface}: a picture`);
  assert.notEqual(ask(f.env, slipOf("round-label-number")), null, "landmark: the KOT itself prints as text");
  assert.deepEqual(f.writes, [], "asking writes nothing");
});

test("S3: a slip text cannot print exactly answers nothing, so the picture prints it", () => {
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  const kot = slipOf("round-label-number");
  const items = kot.kotRoundItems ?? [];
  const hindi = { ...kot, kotRoundItems: items.map((item, i) => (i === 0 ? { ...item, name: "पनीर टिक्का" } : item)) };
  assert.equal(ask(f.env, hindi), null, "a Hindi dish");
  assert.equal(ask(f.env, { ...kot, order: { ...kot.order, receiver: "આશા" } }), null, "a staff name in Gujarati");
  assert.equal(ask(f.env, kot, undefined, settingsOf({ kotShowLogo: true })), null, "the logo on, with a logo");
  assert.notEqual(ask(f.env, kot, undefined, settingsOf({ logo: "", kotShowLogo: true })), null, "landmark: the logo on with no logo prints text");
  const qr = (template: KotTemplate): KotBlock[] => [...template.blocks, { id: "qr-1", type: "qr", on: true, options: { content: "link", url: "https://example.com/menu" } } as KotBlock];
  const withQr = { ...PLAIN, kotTemplate: { ...classicKotTemplate(PLAIN), blocks: qr(classicKotTemplate(PLAIN)) } } as Settings;
  assert.equal(ask({ ...f.env, slipCodeStatus: () => "ready" }, kot, undefined, withQr), null, "a QR line with a usable link");
  assert.equal(ask(f.env, { ...kot, order: { ...kot.order, items: undefined } as never, kotRoundItems: undefined }), null, "an error in the text renderer");
  const throwing = { ...f.env, readTextKot: (): never => { throw new Error("storage"); } };
  assert.equal(ask(throwing, kot), null, "an error anywhere in the step");
  assert.deepEqual(f.writes, [], "no writer called");
});

test("the planning review's I-4: a design whose lazy code is not loaded answers nothing (the picture prints the legacy ticket)", () => {
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  const bold = { ...PLAIN, kotTemplate: defaultKotTemplate("kitchenBold", PLAIN) } as Settings;
  const kot = slipOf("round-label-number");
  for (const status of ["idle", "loading", "failed"] as const satisfies readonly SlipCodeStatus[]) {
    assert.equal(ask({ ...f.env, slipCodeStatus: () => status }, kot, undefined, bold), null, `Kitchen Bold while the code is ${status}`);
  }
  assert.notEqual(ask({ ...f.env, slipCodeStatus: () => "ready" }, kot, undefined, bold), null, "Kitchen Bold once the code is in");
  const classic = { ...PLAIN, kotTemplate: classicKotTemplate(PLAIN) } as Settings;
  assert.notEqual(ask({ ...f.env, slipCodeStatus: () => "failed" }, kot, undefined, classic), null, "a stored Classic ticket needs no lazy code");
});

test("the columns come from the printer's paper at each print: 80 mm 48 or the 42 choice, 58 mm 32 whatever is stored", () => {
  const kot = slipOf("round-label-number");
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  assert.deepEqual(ask(f.env, kot)?.bytes, columnsJob(kot, 48), "80 mm, Automatic: 48");
  f.on(textKotKeyForDevice(APP_80), true);
  assert.deepEqual(ask(f.env, kot)?.bytes, columnsJob(kot, 42), "80 mm, 42 chosen: 42");
  f.on(textKotKeyForDevice(APP_58), true);
  f.setDevice({ status: "connected", printer: APP_58, message: null });
  assert.deepEqual(ask(f.env, kot)?.bytes, columnsJob(kot, 32), "the paper changed to 58 mm: 32, the stored 42 choice does not apply");
  const target: SlipPrintTarget = { nativeId: "tcp:192.168.1.50:9100", paper: "58mm" };
  f.on(textKotKeyForPrinter(PRINTER, { kind: "app", nativeId: target.nativeId ?? "" }));
  assert.deepEqual(ask(f.env, { ...kot, printerId: PRINTER }, target)?.bytes, columnsJob(kot, 32), "a printer job: its printer's paper");
});

test("spec §5.4: each writer gets the text bytes, through the route the picture takes", async () => {
  const kot = slipOf("round-label-number");
  const bytes = columnsJob(kot, 48);
  const cases: Array<[string, Partial<TextKotEnv>, SlipPrintTarget | undefined, string | undefined, string, string]> = [
    ["this device's own printer (simple mode)", {}, undefined, undefined, textKotKeyForDevice(APP_80), `device ${bytes.length}`],
    ["a printer job on the device's one printer (an app on bridge v1, a browser's printer)", {}, undefined, PRINTER, textKotKeyForPrinter(PRINTER, APP_80), `device ${bytes.length}`],
    ["one of the POS app's printers (bridge v2)", {}, { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" }, PRINTER, textKotKeyForPrinter(PRINTER, { kind: "app", nativeId: "tcp:192.168.1.50:9100" }), `app tcp:192.168.1.50:9100 ${bytes.length}`],
    ["a network printer of the Windows app (1.12.0)", { desktop: () => ({ chosen: null, printMode: undefined }) }, { lan: { host: "192.168.1.50", port: 9100 }, paper: "80mm" }, PRINTER, textKotKeyForPrinter(PRINTER, { kind: "lan", host: "192.168.1.50", port: 9100 }), `lan 192.168.1.50:9100 ${bytes.length}`],
    ["a Windows printer of the setup (2.0.2, Direct)", { desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, { printerName: "Kitchen TVS", paper: "80mm" }, PRINTER, textKotKeyForPrinter(PRINTER, { kind: "windows", name: "Kitchen TVS" }), `windows Kitchen TVS ${bytes.length}`],
    ["the Windows app's chosen printer (simple mode, 2.0.2, Direct)", { desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, undefined, undefined, textKotKeyForDevice({ kind: "windows", name: "POS-80" }), `windows POS-80 ${bytes.length}`],
  ];
  for (const [name, over, target, printerId, key, wrote] of cases) {
    const f = fakeEnv(over);
    f.on(key);
    const text = ask(f.env, { ...kot, ...(printerId === undefined ? {} : { printerId }) }, target);
    assert.ok(text !== null, `${name}: text`);
    assert.deepEqual(text.bytes, bytes, `${name}: the slip's text bytes`);
    assert.deepEqual(f.writes, [], `${name}: nothing written before the bridge writes`);
    await text.write();
    assert.deepEqual(f.writes, [wrote], `${name}: one write, through its own writer`);
  }
});

test("a Windows printer prints text only through printRawOn and the Direct method, and only a printer it names", () => {
  const kot = { ...slipOf("round-label-number"), printerId: PRINTER };
  const target: SlipPrintTarget = { printerName: "Kitchen TVS", paper: "80mm" };
  const key = textKotKeyForPrinter(PRINTER, { kind: "windows", name: "Kitchen TVS" });
  const answer = (over: Partial<TextKotEnv>, slip: HostPrintSlip, to: SlipPrintTarget | undefined) => {
    const f = fakeEnv(over);
    f.on(key);
    f.on(textKotKeyForDevice({ kind: "windows", name: "POS-80" }));
    return ask(f.env, slip, to);
  };
  assert.equal(answer({ desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => false }, kot, target), null, "an app before 2.0.2 (no printRawOn)");
  assert.equal(answer({ desktop: () => ({ chosen: "POS-80", printMode: "driver" }), desktopPrintsRaw: () => true }, kot, target), null, "Through the Windows driver");
  assert.equal(answer({ desktop: () => ({ chosen: "POS-80", printMode: undefined }), desktopPrintsRaw: () => true }, kot, target), null, "an app that does not say its method");
  assert.equal(answer({ desktop: () => ({ chosen: null, printMode: "direct" }), desktopPrintsRaw: () => true }, slipOf("round-label-number"), undefined), null, "simple mode with no printer chosen (the Windows default)");
  assert.equal(answer({ desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, kot, undefined), null, "a printer job with no Windows printer named (an older app prints its chosen one)");
  assert.notEqual(answer({ desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true }, kot, target), null, "landmark: 2.0.2 and Direct");
});

test("this device's own printer as the picture's lane: none saved, another tab's, or a plain browser answer nothing", () => {
  const kot = slipOf("round-label-number");
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  f.setDevice({ status: "none", printer: null, message: null });
  assert.equal(ask(f.env, kot), null, "no printer on this device");
  f.setDevice({ status: "elsewhere", printer: APP_80, message: "another tab" });
  assert.equal(ask(f.env, kot), null, "another tab of this browser owns it (the picture refuses with its own sentence)");
  f.setDevice({ status: "connected", printer: APP_80, message: null });
  assert.equal(ask({ ...f.env, rasterCapable: () => false }, kot), null, "a plain browser: the print window");
  assert.notEqual(ask(f.env, kot), null, "landmark: the printer, connected");
  f.setDevice({ status: "connecting", printer: APP_80, message: null });
  assert.notEqual(ask(f.env, kot), null, "a printer still connecting is written as the picture is (the write reconnects once)");
});

test("a printer pointed elsewhere, or another printer, reads off until its own text test", () => {
  const kot = { ...slipOf("round-label-number"), printerId: PRINTER };
  const f = fakeEnv();
  f.on(textKotKeyForPrinter(PRINTER, { kind: "app", nativeId: "tcp:192.168.1.50:9100" }));
  assert.notEqual(ask(f.env, kot, { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" }), null, "landmark: the printer that passed its test");
  assert.equal(ask(f.env, kot, { nativeId: "tcp:192.168.1.51:9100", paper: "80mm" }), null, "re-pointed to another address");
  assert.equal(ask(f.env, { ...kot, printerId: "6710aa00000000000000000b" }, { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" }), null, "another setup printer at that address");
  assert.equal(ask(f.env, slipOf("round-label-number")), null, "this device's own printer in simple mode");
});

test("spec §5.3: a printer this device only takes over for another device prints pictures, its stored switch or not", () => {
  const target: SlipPrintTarget = { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" };
  const f = fakeEnv();
  f.on(textKotKeyForPrinter(PRINTER, { kind: "app", nativeId: "tcp:192.168.1.50:9100" }));
  const kot: HostPrintSlip = { ...slipOf("round-label-number"), printerId: PRINTER };
  assert.notEqual(ask(f.env, kot, target), null, "landmark: its own printer, switch on: text");
  assert.equal(ask(f.env, { ...kot, takeover: true }, target), null, "taken over for another device: a picture");
  assert.deepEqual(f.writes, [], "no writer called");
});

test("PIN (spec §5.3): the agent marks a slip of a printer it only takes over", () => {
  const agent = readFileSync(path.join(process.cwd(), "hooks/use-print-agent.ts"), "utf8");
  assert.ok(agent.includes("const takeoverRef = useRef(printers.takeoverIds);"), "the printers it may take over, read at print time");
  assert.ok(agent.includes("job.printerId !== undefined && takeoverRef.current.includes(job.printerId) ? { ...slip, takeover: true } : slip"), "such a job's slip says so");
});

test("spec §4.1 rule 7 in the step: a slip whose text would pass the picture's limit at its paper prints as a picture", () => {
  // The review's m-1 (M5): the same slip fits 80 mm's limit and passes 58 mm's.
  const kot = slipOf("round-label-number");
  const line = { ...(kot.kotRoundItems ?? [])[0], qty: 1, name: "Masala Chai", modifiers: [], instructions: "" };
  const big: HostPrintSlip = { ...kot, kotRoundItems: Array.from({ length: 22_300 }, () => line) };
  const narrow = kotTextJob({ slip: big as Parameters<typeof kotTextJob>[0]["slip"], settings: PLAIN, columns: 32 });
  const wide = kotTextJob({ slip: big as Parameters<typeof kotTextJob>[0]["slip"], settings: PLAIN, columns: 48 });
  assert.ok(narrow.ok && narrow.bytes.length > (DOTS_58MM / 8) * RASTER_MAX_ROWS, "landmark: on 58 mm the text is past the picture's limit");
  assert.ok(wide.ok && wide.bytes.length <= (DOTS_80MM / 8) * RASTER_MAX_ROWS, "landmark: on 80 mm it is within it");
  const f58 = fakeEnv();
  f58.setDevice({ status: "connected", printer: APP_58, message: null });
  f58.on(textKotKeyForDevice(APP_58));
  // A boolean, not the answer: a failing equal would diff a ~780 KB job and run node out of memory (the review's m-9).
  assert.equal(ask(f58.env, big) === null, true, "58 mm: a picture (rule 7)");
  const f80 = fakeEnv();
  f80.on(textKotKeyForDevice(APP_80));
  assert.equal(ask(f80.env, big) !== null, true, "80 mm: text");
});

test("spec §4.1 rule 7: text larger than the largest picture of that paper answers nothing", () => {
  assert.equal(textKotFitsPicture((DOTS_80MM / 8) * RASTER_MAX_ROWS, "80mm"), true, "80 mm: up to the picture's own limit");
  assert.equal(textKotFitsPicture((DOTS_80MM / 8) * RASTER_MAX_ROWS + 1, "80mm"), false, "80 mm: one byte more");
  assert.equal(textKotFitsPicture((DOTS_58MM / 8) * RASTER_MAX_ROWS + 1, "58mm"), false, "58 mm: one byte more");
  assert.equal(textKotFitsPicture(1200, "58mm"), true, "a real kitchen ticket");
  const route = textKotRouteOf({ printerId: undefined, target: undefined, settings: PLAIN, env: fakeEnv().env });
  assert.equal(route?.paper, "80mm", "landmark: the route names the paper the limit is measured at");
});

test("copies: each pass through the bridge decides alike and writes once", async () => {
  const f = fakeEnv();
  f.on(textKotKeyForDevice(APP_80));
  const kot = slipOf("round-label-number");
  const first = ask(f.env, kot);
  const second = ask(f.env, kot);
  assert.ok(first !== null && second !== null, "both copies are text");
  assert.deepEqual(first.bytes, second.bytes, "the same bytes");
  await first.write();
  await second.write();
  assert.equal(f.writes.length, 2, "one write per copy");
});

test("a printer job's slip names its printer; a simple-mode job's slip names none", () => {
  const base = { id: "j1", kind: "kot", labels: [], copies: 1, payload: { kind: "kot", snapshot: slipOf("round-label-number").order, round: 1 } } as unknown as LeasedPrintJob;
  assert.equal(printAgentSlipOf({ ...base, printerId: PRINTER } as LeasedPrintJob, "2026-10-15").printerId, PRINTER, "the job's printer");
  assert.equal("printerId" in printAgentSlipOf(base, "2026-10-15"), false, "no printer: as before");
});

// S1's source pin: the picture's code is not changed in Phase 4 (spec §2.1 S1, the plan's Global Constraints). Each file's
// SHA-256 as of the spec commit d21ee37 (the repo checks out LF everywhere: .gitattributes).
const PICTURE_FILES: ReadonlyArray<readonly [string, string]> = [
  ["apps/cafe/lib/printer/escpos.ts", "a0ebdf99560951b26ab030fe2c063e32c39e2348b8267dea4ca630aa98bbacb7"],
  ["apps/cafe/lib/printer/raster.ts", "a8e28e7255671fde55fc67bcbfcfc4179a356190ff52d42db48403f4c9917a55"],
  ["apps/cafe/lib/printer/raster-assets.ts", "890fa950970a301991f5e6cad7a4c8ac944d86640242f162d69cce11df3c5282"],
  ["apps/cafe/lib/printer/lane-print.ts", "85c2fbfe90c4ace49714f4eca7dab38ea71f518aa2e85c046f7411eab041f631"],
  ["apps/cafe/lib/desktop-shell.ts", "6500105e629eab187c941973bdf2efefb9527a864ed3c7a4344ec31ff65002a9"],
  ["apps/cafe/components/pos/KOTReceipt.tsx", "8cf5b916d92dfb849cebfc706e5092ae64a32f5543c32c3881280b75a2cc6a6c"],
  ["apps/cafe/components/pos/OrderReceipt.tsx", "0b5403aae20c88068bad01301de7f252110e34c249a390be0927d8b9ef2a27b0"],
  ["apps/cafe/components/pos/PrintSources.tsx", "9e48741a302e346676ab3d5743f33b71186f2ab263ada641486713e562391626"],
  ["apps/cafe/components/pos/PrintBanner.tsx", "ae64381a09a8756e96e5a8ff354dd30929ffe69157023b88d5eff34d7ac8adbb"],
  ["apps/cafe/components/print/slip/SlipEngine.tsx", "7dadadca482d807afe61af08fa5251fe6700c10b44d5e0742441c8532d0efa48"],
  ["apps/cafe/components/print/slip/SlipSkeleton.tsx", "f611392cca061ecbd578917e498bc6c2b22f9b6d82574d47377d28fee4065350"],
  ["apps/cafe/components/print/slip/TokenSlip.tsx", "dc61cf11886300c5fb1f67e25633fa81c56526944936445e12685019c8194e14"],
  ["apps/cafe/components/print/slip/bill-cafe-blocks.tsx", "52bfa8cdd7d34e936f07afe17c952417eb9cb101dc760b1d1e72b7aa0afb4edf"],
  ["apps/cafe/components/print/slip/bill-classic-blocks.tsx", "e65be3f269183afd0ced7d2f18fb7b445d7f59c460aaa095fe8d33405739c203"],
  ["apps/cafe/components/print/slip/bill-express-blocks.tsx", "cea92172ce8a542c8caec96488124b3f55a0df52bae05e273e2bb65522f5268f"],
  ["apps/cafe/components/print/slip/bill-modern-blocks.tsx", "309fba301f66402263b8495772b4f7577b70effb097718ba1f0bfb873c7e1f2c"],
  ["apps/cafe/components/print/slip/bill-themed-blocks.tsx", "acf359519cb9d63beb624fa18be9d9b1b88ce1a460bd8f682e6a43e034f675cd"],
  ["apps/cafe/components/print/slip/generic-blocks.tsx", "caf0b117be2497bb9b089ec0f2f890e1b182d84a9d828a94ea27c752fc32b5ab"],
  ["apps/cafe/components/print/slip/kot-bold-blocks.tsx", "f8cf55c4e5ad8d3b38a13ff09f79921d6954c948374c9c9ff584f80815db4957"],
  ["apps/cafe/components/print/slip/kot-classic-blocks.tsx", "398dcaff958c617b564ff4f31f10bab9722bcd5345bcd3db17610d18b9d22c9f"],
  ["apps/cafe/components/print/slip/slip-code-lazy.ts", "c9b5ee58ab7c1b4b7667286f5a0f004f8a771d12b00c731801c401a0763e1082"],
  ["apps/cafe/components/print/slip/slip-code.ts", "57233d57b60d16bf006e708456ddbcdd5ffbca6a949c94ec8cfa8ea49355e857"],
  ["apps/cafe/components/print/slip/slip-context.ts", "4877169aca7bff0e6e709d5ea1ddfcd449e39e78dd8fa417492da37a8ba28ccd"],
  ["apps/cafe/components/print/slip/slip-designs.ts", "de65eccd2cdfa92760c785c7759c720acc02d51858c09e707c18fffafaea8c87"],
  ["apps/cafe/components/print/slip/slip-format.ts", "0d2a327a80178b1aa4f76f3ed49915499bfa19f4a630183e8e5ec33972534263"],
  ["apps/cafe/components/print/slip/slip-groups.ts", "326e115f246eacb022d19da2613f9d7f4e430e6f3df6a522155daf6ce908c0ea"],
  ["apps/cafe/components/print/slip/slip-rows.tsx", "b50c240dd1e57a5a314a8da3fe52edaea9cbc66ce7bbf99ed21dbd3a3b2f0da2"],
  ["apps/cafe/components/print/slip/slip-style.ts", "e6d4fcf11a7e054694526589dcce269a2e2fe1162deca18505faf64c51d5a626"],
  ["apps/cafe/components/print/slip/slip-view.ts", "c0820bb0952f8e2cfb65edb7870fc5913bd2a84e88b5c0c075ebd4f85cec18d3"],
  ["apps/cafe/components/print/slip/token-blocks.tsx", "9784facf66ec6774eda7234384407dcf8c0f35d6d5f6ca5e6fab0a63e53ee875"],
  ["apps/cafe/components/print/slip/token-designs.tsx", "c79f13e5dca0e26b327f028338315945794f7f6fa7c190f56dc4377931906ed4"],
  ["apps/desktop/src/print-direct.ts", "2b0c34fac5bad5fa9f4feb685505e1655eb23d3ba8a409fb1dc2c555630e7db0"],
  ["apps/desktop/src/escpos.ts", "d4e61dc6ad244e3fe7dc6881e9608ab966af0eee64b40be74e428330e57e4a62"],
  ["apps/desktop/src/raw-spool.ts", "f9f30989801d1404435160e34c1f9cac30cad05f0d1599fe4b48870150630267"],
  ["apps/desktop/src/raw-tcp.ts", "0e393ddc0cd0f39e875f55c1168cfd78b572101dade45eeed4f250e9554d13e0"],
  ["apps/desktop/src/print-job.ts", "aa8784291abf6da80efcad1ac0b5a494a3055f301b696c59a22729000e4107d2"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/PrinterManager.kt", "2528f235b7b1d29ecd81ac9645d232b628348855a0ef05c5a29a4b39928cd635"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/PrinterPool.kt", "d17d127edcbdfdfd707cdaf63f4d49e242cc781d05e0d67ee6d98a6fd647d179"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/BleTransport.kt", "c672736fdfc7a01e8042b16c29de8e90425672d1fcdba055dc6178e84c490e66"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/ClassicTransport.kt", "6c433670f0eb600d176a3a42811b522ab254e8da53bed24ac074c575bea34661"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/TcpTransport.kt", "907f9360cc400bef578b390950ef58aaf4179cf5fa090521ad50a33b7afcf059"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/UsbTransport.kt", "2b72a9b30b55d0ba30ef5ad7fe8a77bc28a0a8a3fd39d47aca925f70d534a297"],
  ["apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/TransportFactory.kt", "b64898010ea7b10b94911b367659b1b61d077d06309072f8fda5462da908c4bc"],
];

test("PIN (S1): the picture's files are byte for byte as at the spec commit d21ee37", () => {
  const root = path.join(process.cwd(), "..", "..");
  for (const [file, sha256] of PICTURE_FILES) {
    const actual = createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex");
    assert.equal(actual, sha256, `${file} is unchanged`);
  }
  assert.equal(PICTURE_FILES.length, 43, "every picture file is pinned");
});
```

In `apps/cafe/lib/printer/print-gating-fx-paths.test.ts`, find:

```ts
      check(p, s.includes("window.setTimeout(abandon, PRINT_HOST_DISPATCH_TIMEOUT_MS)"), "the watchdog abandons (it no longer settles)");
      check(p, !abandon.includes("occupiedRef") && !abandon.includes("setCurrent"), "abandon must NOT free the slot itself");
      check(p, lines(r) <= 255, "stays <= 255 lines (Phase 2 Session 2E: a slip's own Windows printer and paper)");
      return p;
    },
```

Replace it with:

```ts
      check(p, s.includes("window.setTimeout(abandon, PRINT_HOST_DISPATCH_TIMEOUT_MS)"), "the watchdog abandons (it no longer settles)");
      check(p, !abandon.includes("occupiedRef") && !abandon.includes("setCurrent"), "abandon must NOT free the slot itself");
      check(p, lines(r) <= 265, "stays <= 265 lines (Phase 2 Session 2E: a slip's own Windows printer and paper; printing Phase 4 Session 4B: the text step)");
      return p;
    },
```

In `apps/cafe/package.json`, find:

```json
    "lib/printer/kot-text/kot-text-parity.test.ts",
    "lib/printer/kot-text/text-kot-store.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

Replace it with:

```json
    "lib/printer/kot-text/kot-text-parity.test.ts",
    "lib/printer/kot-text/text-kot-store.test.ts",
    "lib/printer/kot-text/text-kot-print.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

In `apps/cafe/package.json`, find:

```json
    "lib/printer-ui-paths.test.ts",
    "lib/print-host-bridge-late.test.ts",
    "lib/print-host-hooks.test.ts",
    "lib/printer/device-printer-deadline.test.ts",
```

Replace it with:

```json
    "lib/printer-ui-paths.test.ts",
    "lib/print-host-bridge-late.test.ts",
    "lib/print-host-text-kot.test.ts",
    "lib/print-host-hooks.test.ts",
    "lib/printer/device-printer-deadline.test.ts",
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-kot-print.test.ts lib/print-host-text-kot.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
not ok 1 - S1: a kitchen slip the text step answers nothing for fires the picture, exactly as before
not ok 2 - text: the slip's bytes go through its printer's writer, never the picture, and the slip settles with the write
not ok 3 - a text write that fails settles with the writer's own sentence, as the picture's failure does
not ok 4 - the watchdog bounds a text write as it bounds a picture
not ok 5 - slips print in order: the next waits for the text write
# Error: Cannot find module './text-kot-print'
not ok 2 - lib\\printer\\kot-text\\text-kot-print.test.ts
# tests 7
# pass 1
# fail 6
```

- [ ] **Step 3: Implement**

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
    targetsRef.current = printers.targets;
  }, [printers.targets]);
  // Session 2C (the 2C gate's review, I-2): a printer job aimed at this device that it does not print on means its
  // printer list is stale (a missed print-setup frame, a printer just re-saved onto it): read it again, at most once
```

Replace it with:

```ts
    targetsRef.current = printers.targets;
  }, [printers.targets]);
  // Printing Phase 4 (spec §5.3): the network printers it prints only for another device (a takeover) print pictures.
  const takeoverRef = useRef(printers.takeoverIds);
  useEffect(() => {
    takeoverRef.current = printers.takeoverIds;
  }, [printers.takeoverIds]);
  // Session 2C (the 2C gate's review, I-2): a printer job aimed at this device that it does not print on means its
  // printer list is stale (a missed print-setup frame, a printer just re-saved onto it): read it again, at most once
```

In `apps/cafe/hooks/use-print-agent.ts`, find:

```ts
        };
        try {
          queueRef.current(printAgentSlipOf(job, cafeDateString(), job.printerId === undefined ? undefined : targetsRef.current[job.printerId]), done);
        } catch {
          // A payload this page cannot turn into a slip (deploy skew): nothing was sent, and never will be.
```

Replace it with:

```ts
        };
        try {
          const slip = printAgentSlipOf(job, cafeDateString(), job.printerId === undefined ? undefined : targetsRef.current[job.printerId]);
          queueRef.current(job.printerId !== undefined && takeoverRef.current.includes(job.printerId) ? { ...slip, takeover: true } : slip, done);
        } catch {
          // A payload this page cannot turn into a slip (deploy skew): nothing was sent, and never will be.
```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts
import { hostPrintFailureMessage } from "@/lib/print-write-outcome";
import { createHostSlipOutcomes, type HostPrintDone } from "@/lib/print-host-outcomes";
import type { Order } from "@/types";

```

Replace it with:

```ts
import { hostPrintFailureMessage } from "@/lib/print-write-outcome";
import { createHostSlipOutcomes, type HostPrintDone } from "@/lib/print-host-outcomes";
import { textKotEnv, textKotWriteFor } from "@/lib/printer/kot-text/text-kot-print";
import type { Order } from "@/types";

```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts
    if (surface === "receipt" || surface === "token") printReceipt();
    else if (surface === "eod") printEod();
    else printKot();
  }, [current, eodReady, slipCodePending, surfacesMounted, printKot, printReceipt, printEod, settle, abandon]);

  // The eod wait is bounded: an aggregate that never loads (host offline from
```

Replace it with:

```ts
    if (surface === "receipt" || surface === "token") printReceipt();
    else if (surface === "eod") printEod();
    else {
      // Printing Phase 4 (spec §5.2, S1, S3, S4): a job's kitchen slip whose printer's text switch is on, and that text
      // can print exactly, goes as text through that printer's own writer, under the same watchdog and outcome; else the
      // picture, exactly as before.
      const text = current.kind === "slip" ? textKotWriteFor({ slip: current.slip, settings: settings.data, target, env: textKotEnv() }) : null;
      if (text === null) printKot();
      else void text.write().then(finish, (error: unknown) => settle(hostPrintFailureMessage(error)));
    }
  }, [current, eodReady, slipCodePending, surfacesMounted, printKot, printReceipt, printEod, settle, abandon, settings.data, target, finish]);

  // The eod wait is bounded: an aggregate that never loads (host offline from
```

In `apps/cafe/lib/print-agent-slip.ts`, find:

```ts
 *  plus the job's labels as the one banner on top (spec §7.7). An end-of-day summary takes none. Session 2E: a job
 *  on a Windows printer this PC prints by name carries that printer's target; Session 2F1: one on one of the POS app's
 *  printers (bridge v2) carries that printer's id. */
export function printAgentSlipOf(job: LeasedPrintJob, todayKey: string, target?: SlipPrintTarget): HostPrintSlip {
  const slip = hostPrintSlipOf(job.payload, todayKey);
  const banner = printBannerText(job.labels);
  const labelled: HostPrintSlip = banner === "" || slip.surface === "eod" ? slip : { ...slip, banner };
  return target === undefined ? labelled : { ...labelled, target };
}

```

Replace it with:

```ts
 *  plus the job's labels as the one banner on top (spec §7.7). An end-of-day summary takes none. Session 2E: a job
 *  on a Windows printer this PC prints by name carries that printer's target; Session 2F1: one on one of the POS app's
 *  printers (bridge v2) carries that printer's id. Printing Phase 4: a printer job carries its printer's id. */
export function printAgentSlipOf(job: LeasedPrintJob, todayKey: string, target?: SlipPrintTarget): HostPrintSlip {
  const slip = hostPrintSlipOf(job.payload, todayKey);
  const banner = printBannerText(job.labels);
  const labelled: HostPrintSlip = banner === "" || slip.surface === "eod" ? slip : { ...slip, banner };
  // Printing Phase 4 (spec §5.2): a printer job names its printer, whose text switch the bridge reads.
  const named: HostPrintSlip = job.printerId === undefined ? labelled : { ...labelled, printerId: job.printerId };
  return target === undefined ? named : { ...named, target };
}

```

In `apps/cafe/lib/print-host-slips.ts`, find:

```ts
}

export type HostPrintSlip = (HostKotSlip | HostReceiptSlip | HostTokenSlip | HostEodSlip | HostTestSlip) & { target?: SlipPrintTarget };

export const ROUND_LABEL_PREFIX = "Round ";
```

Replace it with:

```ts
}

/** Printing Phase 4 (spec §5.2): a printer job's slip also names its printer (`printerId`), whose text switch the bridge's
 *  text step reads (lib/printer/kot-text/text-kot-print.ts); absent in simple mode and on every other slip. `takeover`:
 *  this device prints that printer only for another device (Phase 3's failover), so it prints pictures (spec §5.3). */
export type HostPrintSlip = (HostKotSlip | HostReceiptSlip | HostTokenSlip | HostEodSlip | HostTestSlip) & {
  target?: SlipPrintTarget;
  printerId?: string;
  takeover?: true;
};

export const ROUND_LABEL_PREFIX = "Round ";
```

Create `apps/cafe/lib/printer/kot-text/text-kot-print.ts`:

```ts
import { slipCodeStatus, templateNeedsSlipCode, type SlipCodeStatus } from "@/components/print/slip/slip-code";
import type { PaperWidth } from "@/lib/constants";
import { desktopShell } from "@/lib/desktop-shell";
import { desktopPrintRawOn, desktopPrintsRaw, type DesktopPrintMode } from "@/lib/desktop-shell-printer";
import { printConfigOf, settingsForPaper } from "@/lib/print";
import type { HostPrintSlip, SlipPrintTarget } from "@/lib/print-host-slips";
import { kotTemplateOf } from "@/lib/print-template-resolve";
import { rasterCapable } from "@/lib/printer/capabilities";
import { desktopLan, type DesktopLanTarget } from "@/lib/printer/desktop-lan";
import { desktopPrinterSnapshot } from "@/lib/printer/desktop-printer-state";
import { devicePrinter } from "@/lib/printer/device-printer";
import { RASTER_MAX_ROWS, dotsForPaper } from "@/lib/printer/escpos";
import { printerWriter } from "@/lib/printer/printer-registry";
import type { PrinterSnapshot } from "@/lib/printer/web-printer-types";
import type { Settings } from "@/types";
import { kotTextJob } from "./kot-text";
import { textColumnsOf } from "./text-layout";
import { readTextKot, textKotKeyForDevice, textKotKeyForPrinter, type TextKotChoice, type TextKotReach } from "./text-kot-store";

// Printing Phase 4 (spec 2026-10-15 §5.2, §5.4, S1, S3, S4): the print bridge's text step. Right before the bridge fires
// its kitchen surface it asks here; the answer is the slip's text bytes and the write that sends them through the very
// writer the picture would use, or null, and then the picture prints exactly as today. Null unless all of these hold: a
// job's slip on the kitchen surface; a printer this device reaches the way the picture would, which can take raw bytes;
// that printer's switch on in this device's storage; no lazy slip code missing (the picture would print the legacy ticket);
// and the text renderer answering at the printer's columns, within the picture's own size limit. Never throws: any error
// is a null, decided before a single byte is sent.

/** What the text step reads and writes through: the real device (textKotEnv) or a test's fakes. */
export interface TextKotEnv {
  /** This device's own printer (lib/printer/device-printer.ts). */
  devicePrinter(): PrinterSnapshot;
  /** The Windows app: null on any other runtime; else its chosen printer (null: none) and its print method (undefined: the
   *  app does not say). */
  desktop(): { chosen: string | null; printMode: DesktopPrintMode | undefined } | null;
  /** The Windows app writes raw bytes to a Windows printer (printRawOn, 2.0.2). */
  desktopPrintsRaw(): boolean;
  /** This runtime reaches a printer of its own (the POS app, Web Serial, Web Bluetooth); else the picture opens the
   *  browser's print window. */
  rasterCapable(): boolean;
  readTextKot(key: string): TextKotChoice | null;
  slipCodeStatus(): SlipCodeStatus;
  writeDevice(bytes: Uint8Array): Promise<void>;
  writeNative(nativeId: string, bytes: Uint8Array): Promise<void>;
  writeLan(target: DesktopLanTarget, bytes: Uint8Array): Promise<void>;
  writeRawOn(printerName: string, bytes: Uint8Array): Promise<void>;
}

/** The real device. */
export function textKotEnv(): TextKotEnv {
  return {
    devicePrinter: () => devicePrinter().getSnapshot(),
    desktop: () => {
      if (desktopShell() === null) return null;
      const snapshot = desktopPrinterSnapshot();
      return { chosen: snapshot.selected, printMode: snapshot.printMode };
    },
    desktopPrintsRaw,
    rasterCapable,
    readTextKot,
    slipCodeStatus,
    writeDevice: (bytes) => devicePrinter().write(bytes),
    writeNative: (nativeId, bytes) => printerWriter(nativeId)(bytes),
    writeLan: (target, bytes) => desktopLan().write(target, bytes),
    writeRawOn: desktopPrintRawOn,
  };
}

/** Where a printer's text goes on this device: its switch's key, the paper its columns come from, and its writer. */
export interface TextKotRoute {
  key: string;
  paper: PaperWidth;
  write(bytes: Uint8Array): Promise<void>;
}

interface RouteInput {
  /** The job's printer (printers mode); undefined for this device's own printer (simple mode). */
  printerId: string | undefined;
  target: SlipPrintTarget | undefined;
  settings: Settings | null | undefined;
  env: TextKotEnv;
}

/** The writer the picture would use for this printer here (lib/desktop-shell.ts slipPrintOptions, lib/printer/lane-print.ts),
 *  when it can take raw bytes; null where the picture prints another way (the browser's print window, the Windows driver,
 *  an app before 2.0.2's printRawOn) or would refuse (no printer, another tab owns it). */
export function textKotRouteOf({ printerId, target, settings, env }: RouteInput): TextKotRoute | null {
  const keyOf = (reach: TextKotReach): string => (printerId === undefined ? textKotKeyForDevice(reach) : textKotKeyForPrinter(printerId, reach));
  // A network printer of the Windows app 1.12.0: its raw TCP, whatever else this runtime has.
  if (target?.lan !== undefined) {
    const lan = target.lan;
    return { key: keyOf({ kind: "lan", host: lan.host, port: lan.port }), paper: target.paper, write: (bytes) => env.writeLan(lan, bytes) };
  }
  const desktop = env.desktop();
  if (desktop !== null) {
    // Every other slip of the Windows app goes to a Windows printer: the job's, or this PC's chosen one (simple mode, drawn
    // at the kitchen ticket's paper setting); as text only through printRawOn and the Direct method (spec §5.3).
    const name = target?.printerName ?? (printerId === undefined ? desktop.chosen : null);
    if (name === null || !env.desktopPrintsRaw() || desktop.printMode !== "direct") return null;
    return { key: keyOf({ kind: "windows", name }), paper: target?.paper ?? printConfigOf(settings).kot.paperWidth, write: (bytes) => env.writeRawOn(name, bytes) };
  }
  // One of the POS app's printers on bridge v2, by the app's id.
  if (target?.nativeId !== undefined) {
    const nativeId = target.nativeId;
    return { key: keyOf({ kind: "app", nativeId }), paper: target.paper, write: (bytes) => env.writeNative(nativeId, bytes) };
  }
  // This device's own printer, as the picture's lane: none on a plain browser (the print window), none while no printer is
  // saved or another tab of this browser owns it (the picture then refuses with its own sentence, as today).
  if (!env.rasterCapable()) return null;
  const snapshot = env.devicePrinter();
  if (snapshot.printer === null || snapshot.status === "elsewhere") return null;
  return { key: keyOf(snapshot.printer), paper: snapshot.printer.paper, write: (bytes) => env.writeDevice(bytes) };
}

/** Spec §4.1 rule 7: text is never larger than the largest picture the same paper may print (RASTER_MAX_ROWS rows of
 *  the paper's dots). A kitchen ticket's text is about 1 KB; this only bounds a pathological one. */
export function textKotFitsPicture(length: number, paper: PaperWidth): boolean {
  return length <= (dotsForPaper(paper) / 8) * RASTER_MAX_ROWS;
}

export interface TextKotWrite {
  bytes: Uint8Array;
  write(): Promise<void>;
}

export interface TextKotWriteInput {
  slip: HostPrintSlip;
  settings: Settings | null | undefined;
  target: SlipPrintTarget | undefined;
  env: TextKotEnv;
}

/** The slip's text bytes and their write, or null: the bridge then fires the picture exactly as before (S1, S3). */
export function textKotWriteFor({ slip, settings, target, env }: TextKotWriteInput): TextKotWrite | null {
  try {
    // Only a job's slip on the kitchen surface (spec P4-1): never a bill, a token, End of day or a printer's Test print.
    if (slip.surface !== "kot") return null;
    // Spec §5.3: a printer this device only takes over for another device has no switch here (the panel never lists it,
    // so staff could not turn it off from here): pictures, whatever this device's storage holds for it.
    if (slip.takeover === true) return null;
    const route = textKotRouteOf({ printerId: slip.printerId, target, settings, env });
    if (route === null) return null;
    const choice = env.readTextKot(route.key);
    if (choice === null) return null;
    // The slip as the picture draws it: for the printer's own paper when the job has a target (PrintHostPrintSources).
    const printSettings = target === undefined ? settings : settingsForPaper(settings, target.paper);
    // The planning review's I-4: while the design's lazy code is not loaded the picture prints the legacy ticket instead,
    // and text must not print something else.
    const template = kotTemplateOf(printSettings);
    if (template !== null && templateNeedsSlipCode(template) && env.slipCodeStatus() !== "ready") return null;
    const job = kotTextJob({ slip, settings: printSettings, columns: textColumnsOf(route.paper, choice.narrow80) });
    if (!job.ok || !textKotFitsPicture(job.bytes.length, route.paper)) return null;
    const bytes = job.bytes;
    return { bytes, write: () => route.write(bytes) };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run them with the bridge's suites, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-kot-print.test.ts lib/print-host-text-kot.test.ts lib/print-host-paths.test.ts lib/print-slip-host.test.ts lib/print-host-bridge-late.test.ts lib/print-slip-code-pins.test.ts lib/print-windows-printers.test.ts lib/print-agent-paths.test.ts lib/print-write-outcome.test.ts lib/print-token-lanes-paths.test.ts lib/print-printer-test.test.ts lib/print-agent.test.ts lib/desktop-shell-paths.test.ts lib/printer/print-gating-paths.test.ts lib/printer/print-gating-fx-paths.test.ts lib/print-paths.test.ts lib/print-design-editor-paths.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint hooks/use-print-host-bridge.ts hooks/use-print-agent.ts lib/printer/kot-text lib/print-agent-slip.ts lib/print-host-slips.ts lib/print-host-text-kot.test.ts && echo "typecheck and lint clean"
```
Expected:
```text
# tests 243
# pass 243
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4b-12.txt`, then `git add apps/cafe && git commit -F "$SP/msg-4b-12.txt"`:

```text
feat(cafe): printing Phase 4 Session 4B, the bridge's text step: right before the kitchen surface fires, a job's kitchen slip whose printer's switch is on in this device's storage, that this device reaches the way the picture would with a writer that takes raw bytes, whose design needs no lazy code that is missing, and that text prints exactly within the picture's size limit, goes as ESC/POS text through that same writer under the same watchdog and outcome; anything else, any error, and every slip with every switch off fires the picture exactly as before; a printer job's slip names its printer, and a slip this device prints only while it takes over for another device stays a picture; the picture's 43 files pinned by their SHA-256 as at d21ee37 (spec §5.2, §5.4, S1, S3, S4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 13: "Fast text KOTs (English only)" in the printer panel (§5.1, S2)

**Files:**
- Create: `apps/cafe/lib/printer/kot-text/text-kot-printers.ts`, `apps/cafe/hooks/use-text-kot-printers.ts`,
  `apps/cafe/components/print/TextKotSection.tsx`
- Modify: `apps/cafe/hooks/use-print-host-bridge.ts` (`queueTestSlip(write?)`), `apps/cafe/components/layout/PrintHostProvider.tsx`
  (its type), `apps/cafe/components/print/PrinterSetupCard.tsx` (the section after `DevicePrinterSection`)
- Test: `apps/cafe/lib/printer/kot-text/text-kot-printers.test.ts`, `apps/cafe/lib/print-text-kot-paths.test.ts`,
  `apps/cafe/lib/print-host-text-kot.test.ts` (the text test's window); `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces: `printerTakesKots(printer)`; `interface TextKotPrinter extends TextKotRoute { name }`;
  `textKotPrintersOf({ printers, agent, settings, env })`: simple mode this device's own printer, printers mode each
  printer of the setup it writes that takes kitchen slips (stations, a full copy or notices), never one it only takes
  over, each by its route here; `useTextKotPrinters()`, `useTextKot(key)`; the section; `HostPrintCurrent`'s `test` gains
  `write?: () => Promise<void>`.
- Behaviour: the switch's tap makes the text test slip (`textTestJob` inside a try: a slip that cannot be made leaves it
  off), writes it through `queueTestSlip(() => printer.write(bytes))`, then asks "Did it print clearly, with the ruler on
  one line?"; Yes → `writeTextKot(key, { narrow80 })`; No → off ("Keep it off, or try Characters per line: 42" on 80 mm
  Automatic); a failed print → off with the printer's own sentence; off is immediate; the 80 mm choice is made while the
  switch is off (and off keeps the choice the printer was proven at); a test the bridge's watchdog gave up on says the
  section's own words; the whole row is the switch's label (a 44 px tap target).

- [ ] **Step 1: Write the failing tests**

In `apps/cafe/lib/print-host-text-kot.test.ts`, find:

```ts
import { mountHook, resetStubs, stubModule, stubs, type MountedHook } from "@/lib/hook-harness";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_DISPATCH_TIMEOUT_MS, PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
import type { TextKotWrite, TextKotWriteInput } from "@/lib/printer/kot-text/text-kot-print";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";
```

Replace it with:

```ts
import { mountHook, resetStubs, stubModule, stubs, type MountedHook } from "@/lib/hook-harness";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_BUSY_MESSAGE, PRINT_HOST_DISPATCH_TIMEOUT_MS, PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
import type { TextKotWrite, TextKotWriteInput } from "@/lib/printer/kot-text/text-kot-print";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";
```

In `apps/cafe/lib/print-host-text-kot.test.ts`, find:

```ts
  assert.deepEqual(world.asked, [], "the text step was never asked");
});

```

Replace it with:

```ts
  assert.deepEqual(world.asked, [], "the text step was never asked");
});

test("spec §5.1: a printer's text test rides the test slip's busy window, written through its own writer", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  let answered: string | null = null;
  void s.hook.result().queueTestSlip(held.answer.write).then(
    () => (answered = "printed"),
    (error: Error) => (answered = error.message),
  );
  assert.equal(held.calls, 1, "the test's bytes went to the printer's writer");
  assert.deepEqual(stubs.printed, [], "the attestation slip's picture never fired");
  assert.deepEqual(world.asked, [], "a test is not a job's slip: the text step is not asked");
  s.queue("kot", "KOT-1");
  assert.deepEqual(world.asked, [], "a slip that arrives meanwhile waits");
  held.resolve();
  await s.settled();
  assert.equal(answered, "printed", "the section hears it printed");
  assert.deepEqual(world.asked, ["KOT-1"], "then the waiting slip goes");
  assert.deepEqual(s.outcomes, [], "the test's end is never the waiting slip's outcome (the review's m-1)");
  s.finish();
  assert.deepEqual(s.outcomes, ["printed"], "the slip's own outcome when its picture is done");
});

test("a text test that fails, or a busy device, leaves the section the printer's own sentence", async (t) => {
  const s = scene(t);
  const held = heldWrite();
  const failed = s.hook.result().queueTestSlip(held.answer.write).catch((error: Error) => error.message);
  const busy = s.hook.result().queueTestSlip(held.answer.write).catch((error: Error) => error.message);
  assert.equal(await busy, PRINT_HOST_BUSY_MESSAGE, "a second test is refused, never queued");
  held.reject(new Error(PRINTER_NOT_CONNECTED_MESSAGE));
  await s.settled();
  assert.equal(await failed, PRINTER_NOT_CONNECTED_MESSAGE, "the printer's sentence");
  assert.equal(s.hook.result().current, null, "the bridge is free");
});

```

Create `apps/cafe/lib/print-text-kot-paths.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Printing Phase 4 (spec 2026-10-15 §5.1, S2, §12): "Fast text KOTs (English only)" in the printer panel. Its words, its
// confirm states, the rule that only "Yes" after a printed text test turns a printer on, and that it reads nothing new
// from the server.

const CAFE = process.cwd();
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));
const SECTION = "components/print/TextKotSection.tsx";

test("PIN: the section's words, as the spec says them", () => {
  const section = src(SECTION);
  for (const words of [
    'const TITLE = "Fast text KOTs (English only)";',
    "\"Prints English-only kitchen tickets as text in the printer's own font: much faster on Bluetooth. Tickets with Hindi, Gujarati or any other script, a logo or a QR code still print as now.\";",
    'const QUESTION = "Did it print clearly, with the ruler on one line?";',
    'const TRY_42 = "Keep it off, or try Characters per line: 42";',
    'const COLUMNS_LABEL = "Characters per line";',
  ]) {
    assert.ok(section.includes(words), `the section says: ${words}`);
  }
  assert.ok(section.includes('{narrow ? "42" : "Automatic"}'), "the 80 mm choice: Automatic or 42");
});

test("PIN (S2): turning a printer on prints its text test first; only Yes keeps it on; No and a failure leave it off", () => {
  const section = src(SECTION);
  const turnOn = section.slice(section.indexOf("const turnOn = async () => {"), section.indexOf("const answer = (clear: boolean) => {"));
  const made = turnOn.indexOf("bytes = textTestJob({ cafeName: settings.data?.restaurantName, columns: textColumnsOf(printer.paper, narrow80) });");
  const queued = turnOn.indexOf("await queueTestSlip(() => printer.write(bytes));");
  assert.ok(made > 0 && queued > made, "the test slip is made, then written to that printer inside the bridge's busy window");
  assert.ok(turnOn.indexOf("try {") < made && turnOn.indexOf("} catch {") > made && turnOn.indexOf("} catch {") < queued, "a test slip that cannot be made leaves the switch off (the 4A gate's note)");
  assert.ok(!turnOn.includes("writeTextKot("), "printing the test never turns the switch on by itself");
  const answer = section.slice(section.indexOf("const answer = (clear: boolean) => {"), section.indexOf("const turnOff = () => {"));
  assert.ok(answer.includes("if (clear) {\n      writeTextKot(printer.key, { narrow80: wide && narrow80 });"), "Yes turns it on, with the 42 choice on 80 mm only");
  assert.ok(answer.includes('} else setPhase("kept-off");'), "No keeps it off");
  assert.equal((section.match(/writeTextKot\(/g) ?? []).length, 2, "the switch is written in two places only: Yes, and Off");
  assert.ok(section.includes("writeTextKot(printer.key, null);"), "turning it off is immediate");
  assert.ok(section.includes("if (choice !== null) setNarrow80(choice.narrow80);"), "off keeps the 42 choice it was proven at for its next test");
  assert.ok(section.includes("message === PRINT_HOST_PRINT_FAILED_MESSAGE ? TEST_FAILED_MESSAGE : message"), "a test the watchdog gave up on says the section's own words");
  assert.ok(section.includes("disabled={on || busy}"), "the characters per line are chosen while the switch is off, before its test");
  assert.ok(section.includes("disabled={!on && (busy || current !== null)}"), "turning on waits for a free bridge; turning off never waits");
  assert.ok(section.includes("if (printers.length === 0) return null;"), "hidden on a device with no printer it can write text to");
  assert.ok(section.includes("<label htmlFor={switchId}") && section.includes("id={switchId}"), "the printer's whole row is the switch's label: a 44 px tap target on a phone");
});

test("PIN: the section sits right after this device's printer, in every printer panel", () => {
  const card = src("components/print/PrinterSetupCard.tsx");
  assert.ok(card.includes("      <DevicePrinterSection />\n      <TextKotSection />\n"), "after DevicePrinterSection");
  const provider = src("components/layout/PrintHostProvider.tsx");
  assert.ok(provider.includes("queueTestSlip: (write?: () => Promise<void>) => Promise<number>;"), "the provider hands the section the bridge's test window");
});

test("PIN (spec §12): the switch costs no request: its reads are this device's and the agent's one printers read", () => {
  const hook = src("hooks/use-text-kot-printers.ts");
  assert.ok(hook.includes('const { printers } = usePrintersRead(deviceId !== "");'), "the agent's printers read (one cache entry)");
  for (const file of [SECTION, "hooks/use-text-kot-printers.ts", "lib/printer/kot-text/text-kot-store.ts", "lib/printer/kot-text/text-kot-print.ts", "lib/printer/kot-text/text-kot-printers.ts"]) {
    const text = src(file);
    for (const needle of ["api-client", "apiGet", "apiSend", "fetch(", "useQuery("]) assert.ok(!text.includes(needle), `${file} makes no request (${needle})`);
  }
});
```

Create `apps/cafe/lib/printer/kot-text/text-kot-printers.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrinterConfig, PrinterSlips } from "@pos/shared/print-printers";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import type { Settings } from "@/types";
import type { TextKotEnv } from "./text-kot-print";
import { printerTakesKots, textKotPrintersOf } from "./text-kot-printers";
import { textKotKeyForDevice, textKotKeyForPrinter } from "./text-kot-store";

// Printing Phase 4 (spec 2026-10-15 §5.1): the printers the "Fast text KOTs" section lists on this device: in simple mode
// this device's own printer; in printers mode each printer of the setup it writes that takes kitchen slips. Only one that
// can take raw bytes here is listed, with the same key, paper and writer its slips use (text-kot-print.ts).

const APP: DevicePrinter = { kind: "native", name: "Counter BT", paper: "58mm", printerId: "bt-classic:AA:BB:CC:DD:EE:FF", transport: "bt-classic" };
const SETTINGS = { kotPaperWidth: "80mm" } as unknown as Settings;
const NONE: PrinterSlips = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };

function env(over: Partial<TextKotEnv> = {}): TextKotEnv {
  return {
    devicePrinter: () => ({ status: "connected", printer: APP, message: null }),
    desktop: () => null,
    desktopPrintsRaw: () => false,
    rasterCapable: () => true,
    readTextKot: () => null,
    slipCodeStatus: () => "idle",
    writeDevice: async () => undefined,
    writeNative: async () => undefined,
    writeLan: async () => undefined,
    writeRawOn: async () => undefined,
    ...over,
  };
}

const printer = (id: string, name: string, slips: Partial<PrinterSlips>, connection: PrinterConfig["connection"] = { kind: "lan", host: "192.168.1.50", port: 9100 }): PrinterConfig =>
  ({ id, name, connection, order: 0, paper: 80, slips: { ...NONE, ...slips }, copies: { kot: 1, bill: 1 }, enabled: true, primaryDeviceId: "dev-a" }) as PrinterConfig;

const shown = (list: ReturnType<typeof textKotPrintersOf>) => list.map((p) => `${p.name} ${p.paper} ${p.key}`);
const SIMPLE = { printersMode: false, localIds: [], takeoverIds: [], targets: {} };

test("a printer takes kitchen slips through its stations, a full copy or the notices", () => {
  assert.equal(printerTakesKots(printer("a", "A", { kotStations: ["s1"] })), true, "its stations' KOTs");
  assert.equal(printerTakesKots(printer("a", "A", { kotAll: true })), true, "a full copy");
  assert.equal(printerTakesKots(printer("a", "A", { notices: true })), true, "the notices (void, moved, cancel)");
  assert.equal(printerTakesKots(printer("a", "A", { bill: true, eod: true })), false, "bills and End of day only");
});

test("simple mode: this device's own printer, as its slips print", () => {
  assert.deepEqual(shown(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: env() })), [`Counter BT 58mm ${textKotKeyForDevice(APP)}`], "the POS app's printer, at its paper");
  assert.deepEqual(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: env({ devicePrinter: () => ({ status: "none", printer: null, message: null }) }) }), [], "no printer: no section");
  assert.deepEqual(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: env({ rasterCapable: () => false }) }), [], "a plain browser (the print window): no section");
  const windows = env({ desktop: () => ({ chosen: "POS-80", printMode: "direct" }), desktopPrintsRaw: () => true });
  assert.deepEqual(shown(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: windows })), [`POS-80 80mm ${textKotKeyForDevice({ kind: "windows", name: "POS-80" })}`], "the Windows app's chosen printer, at the kitchen ticket's paper");
  assert.deepEqual(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: { ...windows, desktop: () => ({ chosen: "POS-80", printMode: "driver" }) } }), [], "Through the Windows driver: not offered");
  assert.deepEqual(textKotPrintersOf({ printers: [], agent: SIMPLE, settings: SETTINGS, env: { ...windows, desktopPrintsRaw: () => false } }), [], "an app before 2.0.2: not offered");
});

test("printers mode: each printer of the setup this device writes that takes kitchen slips, by its route here", () => {
  const kitchen = printer("p-kitchen", "Kitchen", { kotStations: ["s1"] });
  const bar = printer("p-bar", "Bar", { kotAll: true }, { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB:CC:DD:EE:01" });
  const notices = printer("p-notices", "Pass", { notices: true });
  const counter = printer("p-counter", "Counter", { bill: true, eod: true });
  const taken = printer("p-taken", "Upstairs", { kotStations: ["s2"] });
  const agent = {
    printersMode: true,
    localIds: ["p-kitchen", "p-bar", "p-notices", "p-counter", "p-taken"],
    takeoverIds: ["p-taken"],
    targets: {
      "p-kitchen": { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" as const },
      "p-bar": { nativeId: "bt-classic:AA:BB:CC:DD:EE:01", paper: "58mm" as const },
      "p-notices": { nativeId: "tcp:192.168.1.50:9100", paper: "80mm" as const },
      "p-counter": { nativeId: "tcp:192.168.1.60:9100", paper: "80mm" as const },
      "p-taken": { nativeId: "tcp:192.168.1.70:9100", paper: "80mm" as const },
    },
  };
  assert.deepEqual(shown(textKotPrintersOf({ printers: [kitchen, bar, notices, counter, taken], agent, settings: SETTINGS, env: env() })), [
    `Kitchen 80mm ${textKotKeyForPrinter("p-kitchen", { kind: "app", nativeId: "tcp:192.168.1.50:9100" })}`,
    `Bar 58mm ${textKotKeyForPrinter("p-bar", { kind: "app", nativeId: "bt-classic:AA:BB:CC:DD:EE:01" })}`,
    `Pass 80mm ${textKotKeyForPrinter("p-notices", { kind: "app", nativeId: "tcp:192.168.1.50:9100" })}`,
  ], "the KOT printers, not the bill-only one, not one it only takes over for another device (spec §5.3)");
  const none = { printersMode: true, localIds: [], takeoverIds: [], targets: {} };
  assert.deepEqual(textKotPrintersOf({ printers: [kitchen], agent: none, settings: SETTINGS, env: env() }), [], "printers mode with no printer of its own here: none, never this device's own printer (the review's m-1)");
});

test("printers mode: a printer whose slips print as pictures here is not offered", () => {
  const win = printer("p-win", "Kitchen TVS", { kotAll: true }, { kind: "device", deviceId: "dev-a", transport: "windows", address: "Kitchen TVS" });
  const agent = { printersMode: true, localIds: ["p-win"], takeoverIds: [], targets: { "p-win": { printerName: "Kitchen TVS", paper: "80mm" as const } } };
  const windows = (printMode: "direct" | "driver", raw: boolean) => env({ desktop: () => ({ chosen: "POS-80", printMode }), desktopPrintsRaw: () => raw });
  assert.equal(textKotPrintersOf({ printers: [win], agent, settings: SETTINGS, env: windows("direct", true) }).length, 1, "landmark: 2.0.2 and Direct");
  assert.deepEqual(textKotPrintersOf({ printers: [win], agent, settings: SETTINGS, env: windows("driver", true) }), [], "the Windows driver");
  assert.deepEqual(textKotPrintersOf({ printers: [win], agent, settings: SETTINGS, env: windows("direct", false) }), [], "an app before 2.0.2");
  assert.deepEqual(textKotPrintersOf({ printers: [], agent, settings: SETTINGS, env: windows("direct", true) }), [], "a printer the read does not have (yet)");
});

test("printers mode on an app on bridge v1 or a browser: the job prints on the device's one printer, so its route does", () => {
  const kitchen = printer("p-kitchen", "Kitchen", { kotStations: ["s1"] }, { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB:CC:DD:EE:FF" });
  const agent = { printersMode: true, localIds: ["p-kitchen"], takeoverIds: [], targets: {} };
  assert.deepEqual(shown(textKotPrintersOf({ printers: [kitchen], agent, settings: SETTINGS, env: env() })), [`Kitchen 58mm ${textKotKeyForPrinter("p-kitchen", APP)}`], "its key and paper are the device printer's");
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/printer/kot-text/text-kot-store.test.ts",
    "lib/printer/kot-text/text-kot-print.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

Replace it with:

```json
    "lib/printer/kot-text/text-kot-store.test.ts",
    "lib/printer/kot-text/text-kot-print.test.ts",
    "lib/printer/kot-text/text-kot-printers.test.ts",
    "lib/print-text-kot-paths.test.ts",
    "lib/printer/device-printer-store.test.ts",
    "lib/printer/device-printer.test.ts",
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-kot-printers.test.ts lib/print-text-kot-paths.test.ts lib/print-host-text-kot.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
not ok 7 - spec §5.1: a printer's text test rides the test slip's busy window, written through its own writer
not ok 8 - a text test that fails, or a busy device, leaves the section the printer's own sentence
not ok 9 - PIN: the section's words, as the spec says them
not ok 10 - PIN (S2): turning a printer on prints its text test first; only Yes keeps it on; No and a failure leave it off
not ok 11 - PIN: the section sits right after this device's printer, in every printer panel
not ok 12 - PIN (spec §12): the switch costs no request: its reads are this device's and the agent's one printers read
# Error: Cannot find module './text-kot-printers'
not ok 3 - lib\\printer\\kot-text\\text-kot-printers.test.ts
# tests 13
# pass 6
# fail 6
```

- [ ] **Step 3: Implement**

In `apps/cafe/components/layout/PrintHostProvider.tsx`, find:

```tsx
  /** PrintHostEodSource's readiness report for the current eod slip. */
  setEodReady: (ready: boolean) => void;
  /** PH-7's "Test print": resolves with trigger→onAfterPrint ms (§B7). */
  queueTestSlip: () => Promise<number>;
  /** PH-7 calls this after writing the `printHost` pref so the lanes arm
   *  without a reload; the beat's demotion path clears it the same way. */
```

Replace it with:

```tsx
  /** PrintHostEodSource's readiness report for the current eod slip. */
  setEodReady: (ready: boolean) => void;
  /** PH-7's "Test print": resolves with trigger→onAfterPrint ms (§B7). Printing Phase 4: with `write`, a printer's text
   *  test, written in the same busy window (components/print/TextKotSection.tsx). */
  queueTestSlip: (write?: () => Promise<void>) => Promise<number>;
  /** PH-7 calls this after writing the `printHost` pref so the lanes arm
   *  without a reload; the beat's demotion path clears it the same way. */
```

In `apps/cafe/components/print/PrinterSetupCard.tsx`, find:

```tsx
import { PrinterAdvanced } from "@/components/print/PrinterAdvanced";
import { PrinterTestTips } from "@/components/print/PrinterTestTips";
import { printersModeOn } from "@pos/shared/print-printers";
import { usePrintersRead } from "@/hooks/use-agent-printers";
```

Replace it with:

```tsx
import { PrinterAdvanced } from "@/components/print/PrinterAdvanced";
import { PrinterTestTips } from "@/components/print/PrinterTestTips";
import { TextKotSection } from "@/components/print/TextKotSection";
import { printersModeOn } from "@pos/shared/print-printers";
import { usePrintersRead } from "@/hooks/use-agent-printers";
```

In `apps/cafe/components/print/PrinterSetupCard.tsx`, find:

```tsx
      />
      <DevicePrinterSection />

      {testable && (
```

Replace it with:

```tsx
      />
      <DevicePrinterSection />
      <TextKotSection />

      {testable && (
```

Create `apps/cafe/components/print/TextKotSection.tsx`:

```tsx
"use client";

// Printing Phase 4 (spec 2026-10-15 §5.1, S2): "Fast text KOTs (English only)" in the printer panel of the device that
// prints. One row per printer this device prints kitchen slips on (hooks/use-text-kot-printers.ts), each with its switch.
// Turning it on prints the text test slip on that very printer, through the bridge's busy window (never between two
// slips), then asks staff; only "Yes" turns it on, kept in this device's storage. Turning it off is immediate. The 80 mm
// "Characters per line" choice is made while the switch is off, so the printer proves the width it will print at.
import { useId, useState } from "react";
import { Zap } from "lucide-react";

import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import { PrinterSection } from "@/components/print/PrinterSection";
import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { useTextKot, useTextKotPrinters } from "@/hooks/use-text-kot-printers";
import { PRINT_HOST_BUSY_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { textColumnsOf } from "@/lib/printer/kot-text/text-layout";
import type { TextKotPrinter } from "@/lib/printer/kot-text/text-kot-printers";
import { writeTextKot } from "@/lib/printer/kot-text/text-kot-store";
import { textTestJob } from "@/lib/printer/kot-text/text-test-slip";

const TITLE = "Fast text KOTs (English only)";
const DESCRIPTION =
  "Prints English-only kitchen tickets as text in the printer's own font: much faster on Bluetooth. Tickets with Hindi, Gujarati or any other script, a logo or a QR code still print as now.";
const SWITCH_LABEL = "Fast text KOTs";
const COLUMNS_LABEL = "Characters per line";
const QUESTION = "Did it print clearly, with the ruler on one line?";
const KEPT_OFF = "Kept off: kitchen tickets print as now.";
const TRY_42 = "Keep it off, or try Characters per line: 42";
const ON_MESSAGE = "On: English-only kitchen tickets print as text on this printer.";
const PRINTING = "Printing the text test…";
const BUSY_MESSAGE = "This device is busy with another slip — try again in a moment.";
const TEST_FAILED_MESSAGE = "Could not print the text test. The switch stays off.";

type Phase = "idle" | "printing" | "confirm" | "kept-off";

export function TextKotSection() {
  const printers = useTextKotPrinters();
  if (printers.length === 0) return null;
  return (
    <PrinterSection icon={Zap} title={TITLE} description={DESCRIPTION}>
      {printers.map((printer) => (
        <TextKotRow key={printer.key} printer={printer} />
      ))}
    </PrinterSection>
  );
}

function TextKotRow({ printer }: { printer: TextKotPrinter }) {
  const { queueTestSlip, current } = usePrintHostContext();
  const settings = useSettings();
  const choice = useTextKot(printer.key);
  const switchId = useId();
  const [narrow80, setNarrow80] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const on = choice !== null;
  const wide = printer.paper === "80mm";

  const turnOn = async () => {
    setError(null);
    // The test slip is made before anything is queued: a slip that cannot be made leaves the switch off (never a throw).
    let bytes: Uint8Array;
    try {
      bytes = textTestJob({ cafeName: settings.data?.restaurantName, columns: textColumnsOf(printer.paper, narrow80) });
    } catch {
      setError(TEST_FAILED_MESSAGE);
      return;
    }
    setPhase("printing");
    try {
      await queueTestSlip(() => printer.write(bytes));
      setPhase("confirm");
    } catch (err) {
      // The printer's own sentence (the bridge also shows it); a busy device is a refusal, never a queue; a test the
      // bridge gave up on (its watchdog) is this section's own sentence, never "reprint it from Orders" (the review's m-4).
      const message = err instanceof Error ? err.message : TEST_FAILED_MESSAGE;
      setError(message === PRINT_HOST_BUSY_MESSAGE ? BUSY_MESSAGE : message === PRINT_HOST_PRINT_FAILED_MESSAGE ? TEST_FAILED_MESSAGE : message);
      setPhase("idle");
    }
  };

  const answer = (clear: boolean) => {
    if (clear) {
      writeTextKot(printer.key, { narrow80: wide && narrow80 });
      setPhase("idle");
    } else setPhase("kept-off");
  };

  const turnOff = () => {
    // The choice it was proven at stays chosen for its next test (the review's m-3).
    if (choice !== null) setNarrow80(choice.narrow80);
    writeTextKot(printer.key, null);
    setPhase("idle");
    setError(null);
  };

  const busy = phase === "printing" || phase === "confirm";
  return (
    <div className="space-y-2 rounded-md border border-brand-rule p-3">
      <div className="flex min-h-11 items-center gap-3">
        <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
          <span className="block font-medium text-brand-ink">{printer.name}</span>
          <span className="block text-xs text-brand-muted">{printer.paper === "80mm" ? "80 mm" : "58 mm"}</span>
        </label>
        <Switch
          id={switchId}
          checked={on}
          aria-label={`${SWITCH_LABEL}: ${printer.name}`}
          disabled={!on && (busy || current !== null)}
          onCheckedChange={(next) => (next ? void turnOn() : turnOff())}
        />
      </div>
      {wide && (
        <div role="group" aria-label={COLUMNS_LABEL} className="space-y-1">
          <p className="text-xs font-medium text-brand-ink">{COLUMNS_LABEL}</p>
          <div className="grid grid-cols-2 gap-2">
            {[false, true].map((narrow) => {
              const chosen = choice !== null ? choice.narrow80 === narrow : narrow80 === narrow;
              return (
                <Button
                  key={narrow ? "42" : "auto"}
                  type="button"
                  variant={chosen ? "default" : "outline"}
                  aria-pressed={chosen}
                  disabled={on || busy}
                  onClick={() => setNarrow80(narrow)}
                  className={PRINTER_ACTION_CLASS}
                >
                  {narrow ? "42" : "Automatic"}
                </Button>
              );
            })}
          </div>
        </div>
      )}
      {phase === "printing" && <p className="text-xs text-brand-muted">{PRINTING}</p>}
      {phase === "confirm" && <InlineConfirm question={QUESTION} yes="Yes" no="No" disabled={false} onYes={() => answer(true)} onNo={() => answer(false)} />}
      {phase === "kept-off" && <p className="text-xs text-brand-muted">{wide && !narrow80 ? TRY_42 : KEPT_OFF}</p>}
      {on && phase === "idle" && <p className="text-xs text-brand-muted">{ON_MESSAGE}</p>}
      {error !== null && <p role="alert" className="text-xs text-brand-danger">{error}</p>}
    </div>
  );
}
```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts

/** What the bridge is printing: a claimed job's slip, or PH-7's attestation test slip
 *  (`PrintHostTestSlip`); it and a printer's Test print (Session 2D) use the KOT surface. */
export type HostPrintCurrent = { kind: "slip"; slip: HostPrintSlip } | { kind: "test" };

interface TestSlipWaiter {
```

Replace it with:

```ts

/** What the bridge is printing: a claimed job's slip, or PH-7's attestation test slip
 *  (`PrintHostTestSlip`); it and a printer's Test print (Session 2D) use the KOT surface. Printing Phase 4 (spec §5.1):
 *  a printer's text test rides the test slip's window, its bytes written by `write` instead of the KOT surface. */
export type HostPrintCurrent = { kind: "slip"; slip: HostPrintSlip } | { kind: "test"; write?: () => Promise<void> };

interface TestSlipWaiter {
```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts
    else {
      // Printing Phase 4 (spec §5.2, S1, S3, S4): a job's kitchen slip whose printer's text switch is on, and that text
      // can print exactly, goes as text through that printer's own writer, under the same watchdog and outcome; else the
      // picture, exactly as before.
      const text = current.kind === "slip" ? textKotWriteFor({ slip: current.slip, settings: settings.data, target, env: textKotEnv() }) : null;
      if (text === null) printKot();
      else void text.write().then(finish, (error: unknown) => settle(hostPrintFailureMessage(error)));
    }
  }, [current, eodReady, slipCodePending, surfacesMounted, printKot, printReceipt, printEod, settle, abandon, settings.data, target, finish]);
```

Replace it with:

```ts
    else {
      // Printing Phase 4 (spec §5.2, S1, S3, S4): a job's kitchen slip whose printer's text switch is on, and that text
      // can print exactly, goes as text through that printer's own writer, under the same watchdog and outcome; so does a
      // printer's text test (§5.1); else the picture, exactly as before.
      const write = current.kind === "test" ? current.write : textKotWriteFor({ slip: current.slip, settings: settings.data, target, env: textKotEnv() })?.write;
      if (write === undefined) printKot();
      else void write().then(finish, (error: unknown) => settle(hostPrintFailureMessage(error)));
    }
  }, [current, eodReady, slipCodePending, surfacesMounted, printKot, printReceipt, printEod, settle, abandon, settings.data, target, finish]);
```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts
  // that waited on a KOT would measure the wrong thing).
  const queueTestSlip = useCallback(
    () =>
      new Promise<number>((resolve, reject) => {
        if (occupiedRef.current) {
```

Replace it with:

```ts
  // that waited on a KOT would measure the wrong thing).
  const queueTestSlip = useCallback(
    (write?: () => Promise<void>) =>
      new Promise<number>((resolve, reject) => {
        if (occupiedRef.current) {
```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts
        outcomesRef.current.track(null);
        testRef.current = { resolve, reject, startedAt: performance.now() };
        setCurrent({ kind: "test" });
      }),
    [],
```

Replace it with:

```ts
        outcomesRef.current.track(null);
        testRef.current = { resolve, reject, startedAt: performance.now() };
        setCurrent({ kind: "test", write });
      }),
    [],
```

Create `apps/cafe/hooks/use-text-kot-printers.ts`:

```ts
"use client";

import { useMemo, useSyncExternalStore } from "react";

import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { useDesktopPrinters, usePoolView, usePrintersRead } from "@/hooks/use-agent-printers";
import { useDevicePrinter } from "@/hooks/use-device-printer";
import { useSettings } from "@/hooks/use-settings";
import { agentPrintersOf } from "@/lib/print-agent-printers";
import { textKotEnv } from "@/lib/printer/kot-text/text-kot-print";
import { textKotPrintersOf, type TextKotPrinter } from "@/lib/printer/kot-text/text-kot-printers";
import { readTextKot, subscribeTextKot, type TextKotChoice } from "@/lib/printer/kot-text/text-kot-store";

// Printing Phase 4 (spec 2026-10-15 §5.1): the "Fast text KOTs" section's reads. The printers come from the same printers
// read as the agent's (one cache entry, no request of its own) and this device's printers' live state; a switch from this
// device's storage, followed across tabs.

/** The printers this device prints kitchen slips on, each with its text key, paper and writer. */
export function useTextKotPrinters(): TextKotPrinter[] {
  const { deviceId } = usePrintHostContext();
  const { printers } = usePrintersRead(deviceId !== "");
  const local = useDevicePrinter();
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
  const settings = useSettings().data;
  return useMemo(
    () => textKotPrintersOf({ printers, agent: agentPrintersOf(printers, deviceId, local.printer, desktop, pool), settings, env: textKotEnv() }),
    [printers, deviceId, local, desktop, pool, settings],
  );
}

type TextKotState = "off" | "auto" | "narrow";

function stateOf(key: string): TextKotState {
  const choice = readTextKot(key);
  return choice === null ? "off" : choice.narrow80 ? "narrow" : "auto";
}

/** That printer's switch: its choice when on, null when off. */
export function useTextKot(key: string): TextKotChoice | null {
  const state = useSyncExternalStore(subscribeTextKot, () => stateOf(key), (): TextKotState => "off");
  return useMemo(() => (state === "off" ? null : { narrow80: state === "narrow" }), [state]);
}
```

Create `apps/cafe/lib/printer/kot-text/text-kot-printers.ts`:

```ts
import type { PrinterConfig } from "@pos/shared/print-printers";
import type { AgentPrinters } from "@/lib/print-agent-printers";
import type { Settings } from "@/types";
import { textKotRouteOf, type TextKotEnv, type TextKotRoute } from "./text-kot-print";

// Printing Phase 4 (spec 2026-10-15 §5.1): the printers the "Fast text KOTs (English only)" section lists on this device,
// each with the same key, paper and writer its kitchen slips use (text-kot-print.ts), so the text test prints where the
// slips will. In simple mode: this device's own printer. In printers mode: each printer of the setup this device writes
// that takes kitchen slips (its stations, a full copy or the notices); never one it only takes over for another device
// (spec §5.3: a failover writer prints pictures). A printer whose slips print here another way (the browser's print
// window, the Windows driver, an app before 2.0.2) is not listed; with none, the section is not shown.

export interface TextKotPrinter extends TextKotRoute {
  /** The printer's name as staff know it. */
  name: string;
}

/** The printer takes kitchen slips: its stations' KOTs, a full copy of every KOT, or the void, moved and cancel notices. */
export function printerTakesKots(printer: Pick<PrinterConfig, "slips">): boolean {
  return printer.slips.kotAll || printer.slips.kotStations.length > 0 || printer.slips.notices;
}

export interface TextKotPrintersInput {
  printers: readonly PrinterConfig[];
  agent: Pick<AgentPrinters, "printersMode" | "localIds" | "takeoverIds" | "targets">;
  settings: Settings | null | undefined;
  env: TextKotEnv;
}

export function textKotPrintersOf({ printers, agent, settings, env }: TextKotPrintersInput): TextKotPrinter[] {
  if (!agent.printersMode) {
    const route = textKotRouteOf({ printerId: undefined, target: undefined, settings, env });
    if (route === null) return [];
    return [{ ...route, name: env.desktop()?.chosen ?? env.devicePrinter().printer?.name ?? "" }];
  }
  const out: TextKotPrinter[] = [];
  for (const id of agent.localIds) {
    const printer = printers.find((entry) => entry.id === id);
    if (printer === undefined || agent.takeoverIds.includes(id) || !printerTakesKots(printer)) continue;
    const route = textKotRouteOf({ printerId: id, target: agent.targets[id], settings, env });
    if (route !== null) out.push({ ...route, name: printer.name });
  }
  return out;
}
```

- [ ] **Step 4: Run them with the panel's and the bridge's suites, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/printer/kot-text/text-kot-printers.test.ts lib/print-text-kot-paths.test.ts lib/print-host-text-kot.test.ts lib/print-host-card-paths.test.ts lib/printer-ui-paths.test.ts lib/print-host-paths.test.ts lib/print-slip-host.test.ts lib/print-host-bridge-late.test.ts lib/print-slip-code-pins.test.ts lib/print-windows-printers.test.ts lib/print-agent-paths.test.ts lib/print-write-outcome.test.ts lib/print-token-lanes-paths.test.ts lib/print-printer-test.test.ts lib/print-agent.test.ts lib/desktop-shell-paths.test.ts lib/printer/print-gating-paths.test.ts lib/printer/print-gating-fx-paths.test.ts lib/print-paths.test.ts lib/print-design-editor-paths.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint components/print/TextKotSection.tsx components/print/PrinterSetupCard.tsx components/layout/PrintHostProvider.tsx hooks/use-text-kot-printers.ts hooks/use-print-host-bridge.ts lib/printer/kot-text lib/print-text-kot-paths.test.ts lib/print-host-text-kot.test.ts && echo "typecheck and lint clean"
```
Expected:
```text
# tests 280
# pass 280
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4b-13.txt`, then `git add apps/cafe && git commit -F "$SP/msg-4b-13.txt"`:

```text
feat(cafe): printing Phase 4 Session 4B, Fast text KOTs (English only) in the printer panel: each printer this device prints kitchen slips on, with its paper and, on 80 mm, Characters per line Automatic or 42; turning it on prints the text test slip on that very printer inside the bridge's test window, then asks Did it print clearly, with the ruler on one line?; only Yes turns it on; No or a failed print leaves it off, with the printer's own words (the section's own when the bridge gives up on the test); off is immediate and keeps the characters per line the printer was proven at; the whole row is the switch's label (spec §5.1, S2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 14: The not-routed words (§8, P4-9)

**Files:**
- Modify: `apps/cafe/lib/print-routing.ts`, `apps/cafe/hooks/use-host-routing.ts`
- Test: `apps/cafe/lib/print-bill-printer.test.ts` (the pin, changed deliberately)

**Interfaces:**
- Produces: `PRINT_JOB_NOT_ROUTED_KOT_MESSAGE = "Nothing to print: every item in this round was cancelled."`;
  `notRoutedMessageOf(kind)`; both call sites toast `notRoutedMessageOf(job.payload.kind)`.

- [ ] **Step 1: Write the failing tests**

In `apps/cafe/lib/print-bill-printer.test.ts`, find:

```ts
import { routablePrinterOf, type PrinterConfig } from "@pos/shared/print-printers";
import { BILL_PRINTER_DEFAULT, BILL_PRINTER_KEY, billPrinterChoiceOf, billPrinterIdOf, readBillPrinterId, writeBillPrinterId } from "@/lib/print-bill-printer";

// Printing redesign, Phase 2 Session 2D (plan decision 7): this device's own bill printer, kept on the device and
```

Replace it with:

```ts
import { routablePrinterOf, type PrinterConfig } from "@pos/shared/print-printers";
import { BILL_PRINTER_DEFAULT, BILL_PRINTER_KEY, billPrinterChoiceOf, billPrinterIdOf, readBillPrinterId, writeBillPrinterId } from "@/lib/print-bill-printer";
import { PRINT_JOB_NOT_ROUTED_KOT_MESSAGE, PRINT_JOB_NOT_ROUTED_MESSAGE, notRoutedMessageOf } from "@/lib/print-routing";

// Printing redesign, Phase 2 Session 2D (plan decision 7): this device's own bill printer, kept on the device and
```

In `apps/cafe/lib/print-bill-printer.test.ts`, find:

```ts
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

test("PIN (2D, the 2C review gate's M-5): a slip no printer takes says so instead of doing nothing", () => {
  const hook = src("hooks/use-host-routing.ts");
  assert.equal((hook.match(/if \(result\.outcome === "not-routed"\) toast\(PRINT_JOB_NOT_ROUTED_MESSAGE\);/g) ?? []).length, 2, "the routed print and the moved slip both say it");
  assert.match(src("lib/print-routing.ts"), /export const PRINT_JOB_NOT_ROUTED_MESSAGE =\s*"No printer takes this slip\. To print notices, switch Notices on for a printer in Printer setup\.";/);
});

```

Replace it with:

```ts
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

// Printing Phase 4 (spec 2026-10-15 §8, P4-9), a deliberate change: the words follow the slip's kind. A KOT round with
// nothing left to print (every line cancelled) says so; a notice no printer takes keeps the 2D words.
test("PIN (2D, the 2C review gate's M-5): a slip no printer takes says so instead of doing nothing", () => {
  const hook = src("hooks/use-host-routing.ts");
  assert.equal((hook.match(/if \(result\.outcome === "not-routed"\) toast\(notRoutedMessageOf\(job\.payload\.kind\)\);/g) ?? []).length, 2, "the routed print and the moved slip both say it, by the slip's kind");
  assert.ok(!hook.includes("toast(PRINT_JOB_NOT_ROUTED_MESSAGE)"), "no call site says the notice words whatever the slip");
  assert.match(src("lib/print-routing.ts"), /export const PRINT_JOB_NOT_ROUTED_MESSAGE =\s*"No printer takes this slip\. To print notices, switch Notices on for a printer in Printer setup\.";/);
  assert.match(src("lib/print-routing.ts"), /export const PRINT_JOB_NOT_ROUTED_KOT_MESSAGE =\s*"Nothing to print: every item in this round was cancelled\.";/);
});

test("Phase 4 (spec §8): a KOT that routes nowhere has nothing left to print; any other slip keeps the notice words", () => {
  assert.equal(notRoutedMessageOf("kot"), PRINT_JOB_NOT_ROUTED_KOT_MESSAGE, "a KOT round with every item cancelled");
  for (const kind of ["void", "moved", "cancel-notice", "bill", "token", "eod"] as const) {
    assert.equal(notRoutedMessageOf(kind), PRINT_JOB_NOT_ROUTED_MESSAGE, `${kind}: today's words`);
  }
});

```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-bill-printer.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
```
Expected:
```text
not ok 4 - PIN (2D, the 2C review gate's M-5): a slip no printer takes says so instead of doing nothing
not ok 5 - Phase 4 (spec §8): a KOT that routes nowhere has nothing left to print; any other slip keeps the notice words
# tests 8
# pass 6
# fail 2
```

- [ ] **Step 3: Implement**

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
  shouldRoutePrint,
  PRINT_JOB_BUILD_FAILED_MESSAGE,
  PRINT_JOB_NOT_ROUTED_MESSAGE,
  PRINT_JOB_TOO_LARGE_MESSAGE,
  type PrintHostRouting,
  type PrintJobRequest,
```

Replace it with:

```ts
  shouldRoutePrint,
  PRINT_JOB_BUILD_FAILED_MESSAGE,
  PRINT_JOB_TOO_LARGE_MESSAGE,
  notRoutedMessageOf,
  type PrintHostRouting,
  type PrintJobRequest,
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
            // is reachable only if that edge check ever goes away.
            else if (result.outcome === "too-large") toast.error(PRINT_JOB_TOO_LARGE_MESSAGE);
            if (result.outcome === "not-routed") toast(PRINT_JOB_NOT_ROUTED_MESSAGE);
          } finally {
            setRoutedInFlight((count) => count - 1);
```

Replace it with:

```ts
            // is reachable only if that edge check ever goes away.
            else if (result.outcome === "too-large") toast.error(PRINT_JOB_TOO_LARGE_MESSAGE);
            if (result.outcome === "not-routed") toast(notRoutedMessageOf(job.payload.kind));
          } finally {
            setRoutedInFlight((count) => count - 1);
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
      if (result === null) return true;
      if (result.outcome === "too-large") toast.error(PRINT_JOB_TOO_LARGE_MESSAGE);
      if (result.outcome === "not-routed") toast(PRINT_JOB_NOT_ROUTED_MESSAGE);
      return !printJobEnqueueAllowsLocalPrint(result.outcome);
    },
```

Replace it with:

```ts
      if (result === null) return true;
      if (result.outcome === "too-large") toast.error(PRINT_JOB_TOO_LARGE_MESSAGE);
      if (result.outcome === "not-routed") toast(notRoutedMessageOf(job.payload.kind));
      return !printJobEnqueueAllowsLocalPrint(result.outcome);
    },
```

In `apps/cafe/lib/print-routing.ts`, find:

```ts
export const PRINT_JOB_NOT_ROUTED_MESSAGE =
  "No printer takes this slip. To print notices, switch Notices on for a printer in Printer setup.";

/** A payload the renderer's own snapshot could not be built from. Nothing was
```

Replace it with:

```ts
export const PRINT_JOB_NOT_ROUTED_MESSAGE =
  "No printer takes this slip. To print notices, switch Notices on for a printer in Printer setup.";

/** Printing Phase 4 (spec §8, P4-9): a KOT that routes nowhere has nothing left to print: the server routes a round's
 *  kitchen lines, and a round whose every line was cancelled has none. */
export const PRINT_JOB_NOT_ROUTED_KOT_MESSAGE = "Nothing to print: every item in this round was cancelled.";

/** The not-routed notice by the slip's kind: a KOT has nothing left to print; any other slip keeps the 2D words. */
export function notRoutedMessageOf(kind: PrintJobPayload["kind"]): string {
  return kind === "kot" ? PRINT_JOB_NOT_ROUTED_KOT_MESSAGE : PRINT_JOB_NOT_ROUTED_MESSAGE;
}

/** A payload the renderer's own snapshot could not be built from. Nothing was
```

- [ ] **Step 4: Run them, the typecheck and the lint**

```bash
cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-bill-printer.test.ts lib/print-routing.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)|Cannot find module|does not provide an export"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint lib/print-routing.ts hooks/use-host-routing.ts lib/print-bill-printer.test.ts && echo "typecheck and lint clean"
```
Expected:
```text
# tests 77
# pass 77
# fail 0
typecheck and lint clean
```

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-4b-14.txt`, then `git add apps/cafe && git commit -F "$SP/msg-4b-14.txt"`:

```text
feat(cafe): printing Phase 4 Session 4B, the not-routed words by kind: a KOT that routes nowhere says "Nothing to print: every item in this round was cancelled."; a notice no printer takes keeps today's words, on both call sites (spec §8, P4-9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 15: End to end on fakes and the emulator (S1, S2, S3, spec §11 items 1, 3, 4)

**Files:** none in the repo (the tools are the gate's, in `D:\kd\pos-dev-keep\phase4\gate-4a\e2e\`; outputs in `$SP/e2e`).

The tools (scratch only, never in the repo): `pw-4b.mjs` (headless desktop Chrome AS the POS app: a fake
`window.PosNative`, v1 like the release APK or v2 like the app 2.0.x, whose prints go over real TCP to the repo's
`scripts/fake-escpos-printer.mjs` on 127.0.0.1:9100, so its `.bin` files are the paper; slips come from fixed payloads
posted to `POST /api/print-jobs` as the page's own, so every build prints the very same slips), `payloads.json` (made
once by `mkpayloads.ts` from the repo's own builders over the golden orders), `e2e-final.sh` (the whole headless run),
`serve.sh`, `pw.sh`, `stop3110.ps1`, `mkenv4.py`, `nocache4.py`, `kot-template-qr.json`, `dec.cjs` (a text slip's
lines), `raster2png.mjs` (a picture slip as a PNG), `ui.py`, `type-secret.py`. Databases are fresh
`pos_scratch_e2e_4g*` ones (the tools refuse any other); the server is `next start` on :3110, stopped by
`stop3110.ps1` (only this run's server, by its command line).

- [ ] **Step 1: Tools, ports, disks**

```bash
mkdir -p "$SP/e2e" && cp -r /d/kd/pos-dev-keep/phase4/gate-4a/e2e/. "$SP/e2e/" && ls "$SP/e2e" | wc -l
netstat -ano | grep LISTENING | grep -E ":(3110|9100) " || echo "3110 and 9100 free"
df -h /c /d | tail -2
```
Expected: the tools are there; `3110 and 9100 free`; D: at least 1.5 GB free for the build.

- [ ] **Step 2: The two builds.** Today's code is `D:\kd\p4b-base` (a worktree at `d21ee37` the gate built: its
`apps/cafe/.next/BUILD_ID` exists; if it does not, `git worktree add --detach D:/kd/p4b-base d21ee37`, then
`powershell -File D:\kd\pos-dev-keep\phase3-final-gate\link-modules.ps1 -Copy D:\kd\p4b-base`, `python "$SP/e2e/nocache4.py"
D:/kd/p4b-base` and `npm run build` in its `apps/cafe`). This session's code is `D:\kd\p4b-new` moved to this branch's
head (its `next.config.ts` keeps the gate's uncommitted cache-off line; nothing serves from it while it builds):

```bash
ls /d/kd/p4b-base/apps/cafe/.next/BUILD_ID && git -C /d/kd/p4b-base log --oneline -1 | cut -c1-8
git -C /d/kd/p4b-new checkout -q --detach "$(git -C /d/kd/lucifer rev-parse HEAD)" && git -C /d/kd/p4b-new status --short
cd /d/kd/p4b-new/apps/cafe && npm run build > "$SP/e2e/build-new.log" 2>&1; echo "EXIT $?" >> "$SP/e2e/build-new.log"
```
Expected: `d21ee37`; ` M apps/cafe/next.config.ts` only; the build's `EXIT 0` (about 2–4 min: in the background, an
until-loop on `^EXIT`).

- [ ] **Step 3: The headless run** (about 25 min; in the background, an until-loop on `^EXIT` in its log):

```bash
cd "$SP/e2e" && bash e2e-final.sh s > e2e-s.log 2>&1; echo "EXIT $?" >> e2e-s.log
sed -E 's/^\[[0-9.]+s\] //' "$SP/e2e/e2e-s.log" | awk '/^#### Text on/{t=1} /^(SAME|DIFF)|byte for byte|^####|^the text test|^after (Yes|off)|^storage|^reprint of/ || (t && /^(kot-|void|moved|cancel|bill|token)/)'
```
Expected (the gate's final run on 2026-10-16, `D:\kd\pos-dev-keep\phase4\gate-4a\evidence\e2e-final-h.log` with its prefix `h` read as `s`; the picture
bytes and their hashes are this PC's Chrome, so they must equal between the two builds, not necessarily these numbers;
the text bytes and their hashes are the code's own and must be exactly these; the saved printer's id is new in each run):
```text
#### S1, simple mode, the POS app on bridge v1
SAME kot-round-1      sa1: picture 56414 B d1dcb3087eec  sb1: picture 56414 B d1dcb3087eec
SAME kot-round-2      sa1: picture 46686 B 3be67aaa1276  sb1: picture 46686 B 3be67aaa1276
SAME kot-whole-tab    sa1: picture 60662 B b5da9a285c66  sb1: picture 60662 B b5da9a285c66
SAME void             sa1: picture 53310 B f2b6a8aa0144  sb1: picture 53310 B f2b6a8aa0144
SAME moved            sa1: picture 34150 B a615fd4e605a  sb1: picture 34150 B a615fd4e605a
SAME cancel-notice    sa1: picture 61022 B 201164c6a846  sb1: picture 61022 B 201164c6a846
SAME bill             sa1: picture 51654 B 5da0fda3c625  sb1: picture 51654 B 5da0fda3c625
SAME token            sa1: picture 31414 B 1a0124b759e6  sb1: picture 31414 B 1a0124b759e6
SAME kot-hindi        sa1: picture 56414 B cfdf526ec41f  sb1: picture 56414 B cfdf526ec41f
9/9 slips byte for byte equal (sa1 vs sb1); counts 9/9
#### S1, printers mode, the POS app on bridge v2 (a network printer of the setup on this device)
SAME kot-round-1      spa: picture 56414 B d1dcb3087eec  spb: picture 56414 B d1dcb3087eec
SAME kot-round-2      spa: picture 46686 B 3be67aaa1276  spb: picture 46686 B 3be67aaa1276
SAME kot-whole-tab    spa: picture 60662 B b5da9a285c66  spb: picture 60662 B b5da9a285c66
SAME void             spa: picture 53310 B f2b6a8aa0144  spb: picture 53310 B f2b6a8aa0144
SAME moved            spa: picture 34150 B a615fd4e605a  spb: picture 34150 B a615fd4e605a
SAME cancel-notice    spa: picture 61022 B 201164c6a846  spb: picture 61022 B 201164c6a846
SAME bill             spa: picture 51654 B 5da0fda3c625  spb: picture 51654 B 5da0fda3c625
SAME token            spa: picture 31414 B 1a0124b759e6  spb: picture 31414 B 1a0124b759e6
SAME kot-hindi        spa: picture 56414 B cfdf526ec41f  spb: picture 56414 B cfdf526ec41f
9/9 slips byte for byte equal (spa vs spb); counts 9/9
#### Text on, simple mode (bridge v1), the new build
the text test: text 472 B; says TEXT TEST: true; ruler: 12345678901234567890123456789012345678901234567
after Yes: checked=true; on line shown: 1
storage pos.text-kot.v1: {"v":1,"printers":{"device:native:tcp:127.0.0.1:9100":{"narrow80":false}}}
kot-round-1      text        698 B  9a1f3f65951f
kot-round-2      text        596 B  d81b147e4985
kot-whole-tab    text        811 B  c76c15a895a3
void             text        668 B  72d2c3407b11
moved            text        517 B  9b56db6bbfbd
cancel-notice    text        800 B  36fa96505dac
bill             picture   51654 B  5da0fda3c625
token            picture   31414 B  1a0124b759e6
kot-hindi        picture   56414 B  cfdf526ec41f
reprint of kot-round-1: text 752 B; first line: "                    REPRINT                    "; job printed
reprint of kot-hindi: picture 62030 B; first line: ""; job printed
kot-logo         picture   61382 B  565c31181ded
kot-qr-only      picture   65486 B  88ace052aa07
kot-text-again   text        698 B  eff0b165ec1c
after off: checked=false; storage text=null
kot-off          picture   56414 B  e85b31ac9116
#### Text on, printers mode (bridge v2), the new build
the text test: text 472 B; says TEXT TEST: true; ruler: 12345678901234567890123456789012345678901234567
after Yes: checked=true; on line shown: 1
storage pos.text-kot.v1: {"v":1,"printers":{"printer:<the saved printer's id>:app:tcp:127.0.0.1:9100":{"narrow80":false}}}
kot-printers     text        698 B  167437195b96
void-printers    text        647 B  b01a607c9384
after off: checked=false; storage text=null
kot-printers-off picture   56414 B  9028873d2801
#### done
```
The size ratio (spec §11 item 1, the same slip as a picture over text, this run): KOT round 1 56,414 / 698 = **80.8×**,
round 2 78.3×, whole tab 74.8×, VOID 79.8×, TABLE MOVED 66.1×, cancel notice 76.3× (all ≥ 10×). Known and not this
session's: headless desktop Chrome draws a picture slip's last lines below its measured height (the KOT's "3 item(s)"
and round total are cut); it is the same in both builds (the comparison above), so the picture bytes are a lower bound.

- [ ] **Step 4: The emulator** (the release APK `29115bdf`, bridge v1, WebView 109). `adb reverse tcp:9100` loses a
small job's bytes when the app half-closes right after writing (the gate measured it: a 30-byte `nc` through the reverse
arrived as 0 bytes, the same through `10.0.2.2` all 18 of 18), so the app's network printer is the host's fake printer
at **`10.0.2.2:9100`**, and only the page goes through `adb reverse tcp:3110 tcp:3110`.

```bash
df -h /c | tail -1   # C: at least 3 GB, or boot -no-snapshot -memory 2048
"/c/Users/Kartik.desai/AppData/Local/Android/Sdk/emulator/emulator.exe" -avd Pixel_7_API_33 -no-snapshot -memory 4096 -no-audio   # background, timeout 2 h
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 3; done
MSYS_NO_PATHCONV=1 adb shell pm path com.possoftware.pos
MSYS_NO_PATHCONV=1 adb shell sha256sum <that path> | cut -c1-8
cd "$SP/e2e" && python mkenv4.py pos_scratch_e2e_4g_semu "$SP/e2e/e2e4g-semu.env" && cp e2e4g-semu.env e2e.env
cd /d/kd/lucifer/apps/cafe && for s in seed-admin seed-tables seed-menu; do npx tsx --env-file="$SP/e2e/e2e4g-semu.env" scripts/$s.ts | tail -1; done
bash "$SP/e2e/serve.sh" /d/kd/p4b-new semu   # background, timeout 2 h
mkdir -p "$SP/e2e/fp-emu" && cd /d/kd/lucifer && node scripts/fake-escpos-printer.mjs --port 9100 --out "$SP/e2e/fp-emu"   # background
adb reverse tcp:3110 tcp:3110
```
Expected: the app's `base.apk` path; `29115bdf`; the three seed lines. Then, on the app (`python -X utf8 ui.py dump`
before every tap; tap by text with `ui.py tap <text>` or by a dump's coordinates; never on the live demo: the start
screen must be the app's own):
1. The start screen (empty POS address, as the gate left it): tap the address, `adb shell input text "http://localhost:3110"`,
   Back, Open POS; sign in: the username `e2eadmin`, TAB (`keyevent 61`), `python -X utf8 type-secret.py`, Enter.
   Expected: the dashboard of "POS Software".
2. The printer icon (top bar) → swipe up → "Network printer (Wi-Fi or Ethernet)": address `10.0.2.2`, port 9100, "Use
   this network printer". Expected: `Network printer 10.0.2.2 is connected.`; the panel lists "Fast text KOTs (English
   only)" with `Network printer 10.0.2.2`, `80 mm`, its switch off.
3. Close the panel; New Order → Masala Chai, Cheesecake → View cart → Send to Kitchen. Expected: one slip in
   `fp-emu/jobs.log` with bytes, a picture (`GS v 0`), about 40–45 KB (the app's own idle check adds 0-byte lines once a
   minute: count only `"bytes":` above 0).
4. The panel → tap the printer's row (the whole row is the switch's label). Expected: a 472-byte slip whose first bytes
   are `1b 40 1b 52 00 1b 4d 00` (`od -An -tx1 -N8`), and "Did it print clearly, with the ruler on one line?"; Yes →
   "On: English-only kitchen tickets print as text on this printer."
5. Close; New Order → Masala Chai, Cheesecake → Send to Kitchen. Expected: a text slip, `node dec.cjs <its file>` shows
   `KITCHEN ORDER`, `#2`, `Round 1`, the Order / Table / Time / Staff rows, `1 x Masala Chai  Rs 40`,
   `1 x Cheesecake  Rs 220`, `2 item(s)`, `Round total: Rs 260` (the gate's: 544 B).
6. `cd "$SP/e2e" && FAKE_APP=v1 bash pw.sh /d/kd/p4b-new semu reprint-latest` (that KOT may have printed: failed with one
   uncertain attempt, then Print again). Expected: `labels ["REPRINT"]`; within ~25 s a text slip whose first line is the
   centred `REPRINT` band (`GS B 1`), no raster (the gate's: 598 B).
7. The panel → the switch off → New Order → Masala Chai → Send to Kitchen. Expected: a picture again (the gate's:
   40,494 B).
8. Put it back as found: the panel → Remove → "Yes, remove" (`Printer removed from this device.`); More options →
   Change POS address → "Clear POS address" → Back: the empty start screen. Then:
```bash
adb reverse --remove-all; MSYS_NO_PATHCONV=1 adb shell sync; MSYS_NO_PATHCONV=1 adb logcat -b crash -d | tail -3; adb emu kill
powershell -NoProfile -File "$SP/e2e/stop3110.ps1"
```
and stop this run's fake printer by its PID (its command line names `fp-emu`). Expected: no crash lines; `stopped <pid>`.

**The app 2.0.1 is not run** (the gate's decision): its printing is the 2.0.0 code (2.0.1 changed only the version), and
a text slip is bytes through the same `printer.print` v1/v2 as a picture (spec §5.3); bridge v2 is covered by the
headless run's printers mode, and installing 2.0.1 would replace the emulator's as-found debug-key 1.0 (a new signing
key: an uninstall). The owner's real devices run 2.0.1, and 4D's exit smoke runs the release build.

### Task 16: Verification, the fresh review and the Results

**Files:** this plan's "Session 4B Results" section (append).

- [ ] **Step 1: Only the page changed, and the picture's files did not**

```bash
cd /d/kd/lucifer && git diff --stat f46600e..HEAD -- . ':!docs' | tail -1
git diff d21ee37..HEAD -- apps/mobile apps/desktop workers apps/cafe/models apps/cafe/app/api packages | wc -c
git diff --name-only d21ee37..HEAD -- . ':!docs' | grep -v -E '^apps/cafe/(lib|hooks|components)/' || echo "only the page"
cd /d/kd/lucifer/apps/cafe && node --import tsx --test --test-name-pattern="PIN \(S1\)" lib/printer/kot-text/text-kot-print.test.ts 2>&1 | grep -E "^not ok|^# (pass|fail)"
```
Expected: `36 files changed, 1704 insertions(+), 47 deletions(-)`; `0`; `apps/cafe/package.json` only (the test chain); `# pass 1`, `# fail 0`.

- [ ] **Step 2: Every cafe check**

```bash
cd /d/kd/lucifer/apps/cafe && npm test > "$SP/cafe-4b.log" 2>&1; grep -E "^# (tests|pass|fail|skipped)" "$SP/cafe-4b.log"
cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo "typecheck clean" && npm run lint 2>&1 | tail -2
```
Expected: `# tests 6080`, `# pass 6079`, `# fail 0`, `# skipped 1` (in the background, with an until-loop); `typecheck
clean`; `✖ 2 problems (0 errors, 2 warnings)`.

- [ ] **Step 3: A fresh review.** A fresh reviewer on **Claude Fable 5.1** (read-only; scratch only in `$SP`; on an HTTP
429 limit wait for the reset and tell the owner, never switch models silently) reviews `f46600e..HEAD` against spec
§4–§5, §8 and this section: the gate's rules in the text step (S1, S3, I-4, rule 7), the routes against the picture's
writers, the store and its keys, the bridge's window and outcomes, the panel's states, the words. If it makes a probe
worktree: before `git worktree remove`, remove every junction in it first, **dot-entries included** (`node_modules/.bin`):
Git for Windows deletes through a junction and emptied the real repo's `.bin` at the 4A gate. Fix a Critical or
Important finding by TDD (RED seen first) in its own commit, re-run Steps 1–2 (and Task 15's S1 comparison if the fix
touches the bridge or a writer); record every finding and its ruling in the Results.

- [ ] **Step 4: The Results.** Append "## Session 4B Results" at the end of this plan: the commits, the counts (Steps
1–2), every RED and GREEN as seen, Task 15's runs (every line compared with its Expected), differences from this plan and
why, the review and its rulings. Commit it (`docs(printing): Session 4B Results …`). No push unless the session's prompt
says so.

---

# Session 4C (spec): the apps 2.0.2 code, and "Find network printers"

Made exact at the 4B review gate. Tasks are numbered 20–27. Acceptance: on an Android app and a Windows app built from
this branch, "Find network printers" lists the fake printer; the Android notification names two network printers on one
address apart; the Windows app writes raw bytes to a Windows printer when asked; no printing code of either app changed
(S5); an app without the new methods and a page without the new button go on as today.

### Task 20: Android `network.findPrinters` (§7.1)

- **Files:** Create `apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/LanScan.kt` (a pure `LanScanPlan`:
  the /24s around the private IPv4 addresses, at most two, never the device's own address, then the connects) and its
  JUnit `LanScanTest.kt`; Modify `PosPrinterModule.kt` (`@ReactMethod findNetworkPrinters(promise)`), `apps/mobile/src/bridge/protocol.ts`
  (method `network.findPrinters`, feature `lanScan` in `NATIVE_FEATURES`), `router.ts`, `validate.ts`,
  `apps/cafe/lib/printer/native-bridge-protocol.ts` (the parity), `apps/mobile/src/mobile-paths.test.ts` (pins 2–4 lists; a new pin 33).
- **Interfaces (fixed):** answer `{ found: Array<{ host: string; port: 9100 }>, subnet?: string, reason?: "no-network" }`;
  constants `LAN_SCAN_PORT = 9100`, `LAN_SCAN_CONNECT_MS = 500`, `LAN_SCAN_PARALLEL = 32`, `LAN_SCAN_MAX_MS = 10_000`,
  `LAN_SCAN_MAX_FOUND = 64`, `LAN_SCAN_MAX_SUBNETS = 2`; the network is found among `ConnectivityManager.allNetworks`:
  the one with `TRANSPORT_WIFI` or `TRANSPORT_ETHERNET` and without `TRANSPORT_VPN` (Wi-Fi first when both are there),
  whether or not it is the default (the review's I-6; `allNetworks` is deprecated since API 31 but works: a
  `@Suppress("DEPRECATION")` at the one call, the re-check's m-C); its `LinkProperties` (each `LinkAddress`'s prefix bounds the /24); every probe socket from that
  network's `socketFactory`; its own executor.
- **Tests:** JUnit for the plan (10.x, 172.16–31.x, 192.168.x; a public address skipped; the own address skipped; two
  networks; the limits) and the connects against a fake listener on the loopback; pin 6 unchanged (no new permission).

### Task 21: The network printer's name (m-2, §8)

- **Files:** Modify `PrinterDiscovery.kt` (`PrinterNames.network(ctx, host, port)`: the port only when not 9100) and the
  place the notification and the list read a printer's name, so a `tcp:host:port` printer's shown name comes from its id;
  `PoolStatusTest.kt` (the three network fixtures named apart; the assertions that could not tell them apart now can);
  `PrinterFakes.kt`.
- **Tests:** JUnit: `Network printer 10.0.2.2` for 9100, `Network printer 10.0.2.2:9101` for 9101; a printer saved with
  the old name shows the new one; the notification's OneDown / PaperOut titles name the right printer.

### Task 22: Windows `findLanPrinters` (§7.2)

- **Files:** Create `apps/desktop/src/lan-scan.ts` (+ `lan-scan.test.ts`, injected interface list and connector); Modify
  `shared.ts` (channel `pos-desktop:find-lan-printers`), `preload.ts`, `main.ts` (the handler behind the print channels'
  caller gate), `desktop-paths.test.ts` (pins (6), (7), L2 widened: `raw-tcp.ts` keeps its one `net.createConnection`),
  `package.json` (the test list).
- **Interfaces (fixed):** `findLanPrinters(): Promise<{ found: Array<{ host: string; port: 9100 }>; subnet?: string;
  reason?: "no-network" }>`; the same constants as Android; `os.networkInterfaces()`'s non-internal private IPv4, leaving
  out 169.254/16 and adapters named like WSL, vEthernet (Hyper-V), VirtualBox, VMware, VPN, TAP, Tailscale or ZeroTier,
  192.168 networks first (the review's I-5); the tests include such an interface list. Accepted residual (the re-check's
  m-D): a VPN adapter renamed by hand is not recognised; "type its address" still works.

### Task 23: Windows `printRawOn` (§6)

- **Files:** Create `apps/desktop/src/print-raw-on.ts` (+ test); Modify `shared.ts` (`pos-desktop:print-raw-on`),
  `preload.ts`, `main.ts`, pins, `apps/cafe/lib/desktop-shell-messages.ts` if a new sentence is needed (parity-pinned).
- **Behaviour (fixed):** the caller gate; the name one Windows reports now (else the shell's "That printer is not on this
  PC…", `PRINT_PRINTER_NOT_HERE_MESSAGE`, as `printHtmlOn`: the review's m-10); `data` a `Uint8Array` of 1 to
  `RAW_TCP_DATA_MAX_BYTES`; the Direct print method; then the existing `writeRawJob(name, "POS slip", data)` on the
  existing print queue; its failures in the existing raw spool sentences.

### Task 24: "Find network printers" on the page (§7.3)

- **Files:** Create `apps/cafe/lib/printer/lan-discovery.ts` (+ test: the app's answer normalised, sorted, "Already
  added" by host and port), `apps/cafe/components/print/FindNetworkPrinters.tsx`; Modify `NativePrinterPicker.tsx` (the
  network form) and `components/print/setup/PrinterFormDialog.tsx` (the LAN address); UI pins.
- **Words (fixed):** "Find network printers"; "Looking for printers on this Wi-Fi…"; "No network printer found on this
  Wi-Fi. Check that the printer is on and on the same Wi-Fi, or type its address."; "This device is not on a Wi-Fi or
  wired network."; "Already added: ‹name›".

### Task 25: The emulator

- Discovery on the app's network panel and in the setup form finds the fake printer at `10.0.2.2:9100` (the host's
  loopback as the emulator sees it) and nothing else; a tap fills the address; the m-2 notification with two network
  printers on one host (`10.0.2.2:9100` and `:9101`, one switched off) names the right one; put back as found.

### Task 26: A Windows build's IPC smoke

- Playwright `_electron` on a test build (as in the native apps N3 gate): `findLanPrinters` and `printRawOn` answer through
  the bridge; the scan's interfaces come from a test-only build setting decided at the 4B gate, never the owner's real
  network; `printRawOn` to a printer Windows does not report is refused with the shell's own sentence.

### Task 27: Verification, the fresh review, the Results

- Every suite (mobile, Jest, JUnit `--rerun`, desktop, cafe, typecheck and lint in each), the fresh review (Claude Fable
  5.1) of the session's range, the Results.

---

# Session 4D (spec): the exit and the release set 2.0.2

Made exact at the 4C review gate. Tasks are numbered 30–34.

- **Task 30:** the 4C gate's rulings (a gate may add fixes here).
- **Task 31:** both apps 2.0.2 (`posVersionRelease` in `apps/mobile/android/app/build.gradle`, `apps/desktop/package.json`
  and its lock's root version; pin 27 and the cafe runbook pin move with them); the release notes are the owner's words,
  asked at the 4C gate.
- **Task 32:** docs: GO-LIVE-CHECKLIST "Existing cafes: the printing Phase 4 release" (the web first; then the 2.0.2
  upload; then on the demo cafe the switch on the owner's Bluetooth printer and the measurement; then the clients,
  printer by printer, each after its text test; the switch is per device, so a new or reset device starts off), and
  TEST-CHECKLIST "Phase 4 checks" (spec §11 item 6, with the measurement steps of item 2 and what to record); new
  runbook pins.
- **Task 33:** every suite; `:app:compileReleaseKotlin --rerun`, the APK pair and `npm run dist`; `scripts/release-native.mjs`
  into `D:\kd\pos-apk-release\Sandbee-POS-2.0.2\` (written once; never over an existing folder); the emulator smoke of the
  release APK (the one-time update card from 2.0.1 to 2.0.2 with a test base, as N4's smoke; a text KOT to the fake printer).
- **Task 34:** the final review (Claude Fable 5.1) of `3fe1439..HEAD`; the Results; the owner's merge OK (then `--no-ff`,
  every suite on `main`, a push only on the owner's word, with the token). Then the owner's deploy, upload and the
  measurement.

## Session 4A Results (filled in by the implementer)

Executed on 2026-10-15 with superpowers:executing-plans, task by task, Tasks 0 → 7, in `D:\kd\lucifer` on
`feat/printing-phase-4` (start `3083eff`). No push, no merge, no deploy, no download, no web request.

### Commits (`3083eff..HEAD`)

| Commit | Task |
|---|---|
| `6d4d12b` | 1: the characters a text KOT may send (`text-chars.ts`) |
| `f655c19` | 2: lines and their ESC/POS bytes (`text-layout.ts`, `text-escpos.ts`) |
| `cab1ecd` | 3: Classic as text, and the gate (`kot-text-design.ts`, `kot-text-classic.ts`, `kot-text.ts`, the fixtures) |
| `9987965` | 4: Kitchen Bold as text (`kot-text-bold.ts`) |
| `e92c64b` | 5: the text test slip (`text-test-slip.ts`) |
| `dee2640` | 6: the parity test (8,800 cells) and `kotTextRows` |
| `85d6124` | 7, the review's I-1 by TDD: the legacy ticket has no locks; the parity test sweeps the legacy ticket over every `kot*` flag combination (20,480 cells) |
| `8770645` | 7, the review's I-2 by TDD: the text test slip shows Classic's `#12` and Kitchen Bold's `[1]` |
| (this commit) | 7: Results |

### Start

- Branch `feat/printing-phase-4` at `3083eff`, working tree clean; disks: D: 9.7 GB free, C: 75 GB free.
- Baseline (Task 0): the cafe chain `# tests 5984`, `# pass 5983`, `# fail 0`, `# skipped 1` (54 s); `npx tsc --noEmit`
  clean; lint `✖ 2 problems (0 errors, 2 warnings)`. All as Expected.

### How the code was applied

Every block went verbatim into the real repo through `D:\kd\pos-dev-keep\phase3-final-gate\apply_blocks_clone.py`
(`--dry` first, then for real), one step range at a time, so each RED was seen before its code went in: Task 1 2 + 1
ops, Task 2 3 + 2, Task 3 3 + 3, Task 4 2 + 3, Task 5 2 + 1, Task 6 2 + 3 (**27**). Each find matched exactly once.
After every task, `git rev-parse HEAD:apps/cafe` equalled the gold commit's: Task 1 `585796b` = `684223d`, Task 2
`56c926f` = `107c8ff`, Task 3 `b682846` = `e636523`, Task 4 `3521010` = `5dfc872`, Task 5 `4da996c` = `48a9608`,
Task 6 `dd67217` = `892ba66`. The whole tree after Task 6 differed from the gold tree `33375e2` only in the two docs the
plan commit `3083eff` carries (this plan and the spec's amendment): `git diff --name-only 892ba66 dee2640` listed only
those two files. Every commit message of Tasks 1–6 came from the plan's block, written to a scratch file and committed
with `git commit -F`. After the review's two fixes `apps/cafe`'s tree is `a5a2516` (gold + 4 files, +51 −12).

### Per-task RED → GREEN (every Expected line compared; all matched)

| Task | RED (as seen) | GREEN (as seen) |
|---|---|---|
| 1 | `# Error: Cannot find module './text-chars'`; tests 1, pass 0, **fail 1** | **4/4**; typecheck and lint clean |
| 2 | `Cannot find module './text-escpos'` and `'./text-layout'`; tests 2, pass 0, **fail 2** | **13/13**; typecheck and lint clean |
| 3 | `# Error: Cannot find module './kot-text-classic'`; tests 1, pass 0, **fail 1** | **10/10**; typecheck and lint clean |
| 4 | `not ok 1`–`4`, each on `the slip prints as text (design)` (Kitchen Bold was still an unknown design); tests 4, pass 0, **fail 4** | both KOT suites **14/14**; typecheck and lint clean |
| 5 | `# Error: Cannot find module './text-test-slip'`; tests 1, pass 0, **fail 1** | **4/4**; typecheck and lint clean |
| 6 | `not ok 1 - every golden KOT shape prints the picture's words, in its order, in every design` (`TypeError: kotTextRows is not a function`: not exported yet); tests 1, pass 0, **fail 1** | parity + KOT **11/11**; typecheck and lint clean |

### Task 7: verification

At `dee2640` (before the review):
- Step 1: `17 files changed, 1458 insertions(+)` outside `docs/`; `only kot-text and the test chain`; `nothing imports
  kot-text` (and no file in `apps/` or `packages/` outside the folder names `kot-text` at all).
- Step 2: the cafe chain `# tests 6020`, `# pass 6019`, `# fail 0`, `# skipped 1`; `typecheck clean`;
  `✖ 2 problems (0 errors, 2 warnings)`. All as Expected.

At `8770645` (after the review's fix pass; Steps 1–2 again):
- Step 1: `17 files changed, 1497 insertions(+)` (the 1458 and the fixes' net 39); `only kot-text and the test chain`;
  `nothing imports kot-text`.
- Step 2: the cafe chain **`# tests 6022`, `# pass 6021`, `# fail 0`, `# skipped 1`** (57 s; the two new tests of the
  fixes); `typecheck clean`; `✖ 2 problems (0 errors, 2 warnings)`. The seven kot-text files: **38/38**.

### Step 3: the fresh review (Claude Fable 5.1)

A fresh reviewer on Claude Fable 5.1 (read-only on the repo; its probes in a detached worktree in this session's
scratchpad, removed afterwards; no 429) reviewed `d21ee37..dee2640` against spec §2.1, §4, §5.1–5.2 and this section. It
ran the seven suites (36/36), the typecheck, 13 real-input probes, a byte-grammar validator over 6,000 jobs (only `ESC @`
once, `ESC a`, `ESC E`, `GS ! 00/01/11`, `GS B`, `LF`, `ESC J`, printable ASCII and the exact tail `ESC J 16, GS V 66 0`;
no line ever reached the columns: at most 47/41/31, 46/40/30 double width), a legacy-ticket sweep over every `kot*` flag
mask (20,480 cells) and 8 mutation probes (6 caught). **Verdict: "With fixes"; 0 Critical, 2 Important, 4 Minor.**

| Finding | Ruling |
|---|---|
| **I-1** With no stored kitchen-ticket template the picture is `KOTReceipt`'s own legacy ticket, which has no locks (`cfg.showTable && <Line Table>`), but the text applied the engine's banner-slip locks (title, table, items) there too: a cafe with "Show table" off got a `Table` line on every text VOID, TABLE MOVED and cancel notice that today's picture does not print (6,144 of 20,480 cells; the parity test's settings never turned the table off) | **Fixed by TDD, `85d6124`.** RED: a new parity test, "the legacy ticket prints the picture's words under every combination of its settings" (every `kot*` flag mask × the 20 golden slips, the cafe without a logo), failed at `[flags=0 / void-reason-by-at]` with the text's extra `'table', 't4'`; GREEN after locks bite only when a template is stored (`kot-text.ts`: `locked(block)` is false on the legacy path, for visibility and for the locked-size rule alike); the seven suites 37/37. A mutation that drops the lock on the stored path (`return block.on;`) still fails two tests. |
| **I-2** The S2 text test slip printed none of `#`, `[`, `]`, the characters a printer's own international character set changes (`ESC @` keeps the printer's default; UK prints `#` as a pound sign, the European sets print `[ ]` as letters), while every Classic ticket prints `#7` and every Kitchen Bold item `[2]`: such a printer would pass its text test and garble every ticket | **Fixed by TDD, `8770645`.** RED: a new test ("the sample prints the characters a printer's international set can change…") and the 80 mm line-for-line golden failed (`32 columns: the sample prints #`); GREEN after the sample gained `#12` (big, bold, centred, under KITCHEN ORDER, as Classic prints its number) and its second item became `[1] Paneer Tikka` (hang 4, as Kitchen Bold); the seven suites 38/38. Content only: no command is added. **Not taken:** the reviewer's stronger option `ESC R 0` after `ESC @` adds a command to the plan's fixed list, which is the owner's call (Global Constraints, "Commands"). |
| m-1 a lone carriage return is dropped, so `"no onion\rno garlic"` prints `no onionno garlic` (the picture shows a space; CRLF is fine) | Deferred to the 4A gate (a textarea's value is LF-normalised, so a lone CR is rare) |
| m-2 test strength: no fixture has a no-KOT line (dropping `kitchenOrderOf`/`kitchenLinesOf` fails nothing; production is correct), and Classic's meta `groupRatio` and Kitchen Bold's upper-case restaurant name are unpinned (cosmetic) | Deferred to the 4A gate |
| m-3 a Classic label / value row whose block is aligned centre or left keeps the value flush right in text; the picture centres it | Deferred to the 4A gate (spec §4.3 defines the split row's shape; a spec note would close it) |
| m-4 an amount or value wider than the line (`Rs 1,00,00,00,000` at xl on 58 mm) refuses as `"error"` instead of wrapping | Deferred to the 4A gate (harmless by S3; unrealistic; 4B should not read `"error"` as a bug alone) |

What the reviewer set aside, and the ruling on each:
- Classic's italic instruction has no text form: stands (no portable ESC/POS italic; spec §4.3 lists bold, size and
  alignment; the words match).
- Invisible characters (U+200B/200C/200D/FEFF, the soft hyphen) make a slip a picture: stands (rule 6's safe direction).
- A 58 mm printer with fewer than 32 columns has no narrower choice: stands (P4-5; its ruler wraps, staff answer No).
- The planning review's m-5, m-6, m-7 and m-12: stand as ruled there (no new evidence).
- Rule 7 (the bytes under the picture's limit) is not checked in 4A: stands; the 4A gate puts it in Task 11's code.
- I-4 (the lazy slip chunk) and the gate's rules 1–2 (kind, switch, writer): stand for 4B Task 11.
- `textTestJob` throws on a bug (documented): stands in 4A; **4B's caller must catch it** and keep the switch off with the
  printer's message (a note for the gate).
- Kitchen Bold's KOT band (big and white on black at once) is not on the test slip as one line: stands (each is shown;
  a printer failing only the pair is exotic).
- A centred block over indented modifier lines centres their four leading spaces too: stands (cosmetic).

### Differences from this plan

1. **The review's two fixes** (above) add two commits after Task 6: the counts at the end are the cafe chain **6022**
   (6021 pass, 0 fail, 1 skipped) instead of 6020, and `17 files changed, 1497 insertions(+)` instead of 1458. The
   parity file now holds two tests (8,800 + 20,480 cells, about 10 s with the KOT suite). The text test slip's content
   differs from Task 5's block (the `#12` line and `[1] Paneer Tikka`): **the 4A gate makes 4B exact against
   `8770645`, not against the gold tree `33375e2`**.
2. Process only: the harness refused one `bash -c` test command given to `task-done` (as noted in the memory), so the
   kot-text suites ran through a wrapper script in the scratchpad; Task 2's commit was then made once, separately.
## The 4A review gate (2026-10-15/16)

Its own session (`d0437015…`), from the owner's prompt `D:\kd\pos-dev-keep\phase4\prompt-4a-gate.md`. No push, no merge,
no deploy, no upload. Tools and evidence: `D:\kd\pos-dev-keep\phase4\gate-4a\` (`e2e\` the end-to-end tools Task 15 uses,
`gen4b\` the generator, `evidence\` the logs, mutation runs and screenshots, `gold-4b-v5.bundle` the gold, with the
drafts' `gold-4b-v3.bundle` and `gold-4b-v4.bundle`).

### Session 4A, verified

- Disks: D: 9.7 GB, C: 75 GB free. Every commit `d21ee37..f46600e` read (the spec, the plan, Tasks 1–6, the two fixes, the
  Results).
- Each task's `apps/cafe` tree equals its gold commit's: Task 1 `585796b` = `684223d`, Task 2 `56c926f` = `107c8ff`,
  Task 3 `b682846` = `e636523`, Task 4 `3521010` = `5dfc872`, Task 5 `4da996c` = `48a9608`, Task 6 `dd67217` =
  `892ba66`; after the fixes `a5a2516`. `git diff --name-only 892ba66 dee2640`: only the plan and the spec.
- The fixes against the spec: **I-1** (`85d6124`) is spec §4.1 rule 3 exactly: with no stored template the picture is
  `KOTReceipt`'s own legacy branch, where each line follows its own setting, so the engine's locks bite only on a stored
  template, for visibility and for the locked-size floor. **I-2** (`8770645`) adds content only (Classic's `#12`, Kitchen
  Bold's `[1]`) within §5.1's test slip; spec §5.1 now names them.
- Each fix's RED reproduced in `D:\kd\p4v` at `f46600e`, putting back only its production file: I-1 (`kot-text.ts` as
  at `dee2640`): `not ok 2 - the legacy ticket prints the picture's words under every combination of its settings`,
  `[flags=0 / void-reason-by-at] the picture's words, in its order` with `+ 'table', + 't4'`; `# tests 2`, `# pass 1`,
  `# fail 1`. I-2 (`text-test-slip.ts` as at `dee2640`): `not ok 1 - the text test slip on 80 mm, line for line`,
  `not ok 2 - the sample prints the characters a printer's international set can change…` (`'32 columns: the sample
  prints #'`); `# tests 5`, `# pass 3`, `# fail 2`. Both files restored.
- Re-runs at `f46600e`: the seven kot-text suites **38/38**; the cafe chain **`# tests 6022`, `# pass 6021`, `# fail 0`,
  `# skipped 1`** (52.8 s); typecheck clean; `✖ 2 problems (0 errors, 2 warnings)`; Task 7 Step 1: `17 files changed,
  1497 insertions(+)`, `only kot-text and the test chain`, `nothing imports kot-text`; `git diff d21ee37..HEAD -- apps/mobile
  apps/desktop workers apps/cafe/models apps/cafe/app/api packages`: empty (0 bytes); `print-budget.test.ts` unchanged.

Verdict: Session 4A landed as the plan and its Results say.

### The fresh review of 4A (Claude Fable 5.1)

Read-only, no 429. It ran the suites, a byte-grammar validator over 2,400 jobs and the three test slips (only the fixed
commands, no line reaching its columns), ten real-input probes, 18 mutations (11 caught) and a public look at Epson's
`ESC R` entry. **Verdict: "Ready for 4B: With fixes"; 0 Critical, 1 Important (test strength), 7 Minor.** No wrong
line, lost line or wrong byte on any real input; the 4B interfaces hold.

| Finding | Ruling |
|---|---|
| **I-1** two goldens do not pin their rule: the locked-size floor (`xs` → `sm`) cannot show at the normal base (both `normal`); the locks' scope is exercised only for Kitchen Bold's title | **4B Task 9:** the locked-title golden at the large base (`tall`, vs `normal` without the floor); parity designs "classic locked off" and "bold locked off" (title, table and items off on a stored template): 13 designs, 10,400 cells |
| m-1 a lone CR is dropped (`no onionno garlic`) | **Task 9:** a CR is a space, as CSS shows it (spec §4.2) |
| m-2 a skip-KOT line, Classic's meta ratio and Kitchen Bold's upper-case name unpinned (M6, M7, M8) | **Task 9:** a parity test with a `noKot` line (in a round and on the whole tab), a Classic meta block at `lg`/`xl`, a Kitchen Bold name golden |
| m-3 a Classic label / value row ignores its block's alignment | **The owner: follow the picture** (2026-10-16). Task 9: `valueAlign`: centred in the room after the label and its space, or right after it; on its own line centred or at its start (spec §4.3) |
| m-4 an over-wide amount refuses as `"error"` | Stands (S3 prints it as a picture; only an `xl` items block on 58 mm with an amount of Rs 10 crore or more); Task 9 pins the refusal; 4B reads no refusal reason |
| m-5 a long Classic item and a pair exactly one line long unpinned (M9, M15) | **Task 9:** both goldens |
| `ESC R 0` (the reviewer's evidence: `ESC @` returns a printer to its memory-switch set, not to USA; every ESC/POS family knows `ESC R`; volatile; a printer that ignores it shows the stray byte on the test slip) | **The owner: yes** (2026-10-16). Task 9 |
| `ESC M 0` (optional: a Font-B default prints smaller text the ruler cannot catch) | **The owner: yes** (2026-10-16). Task 9; spec §4.3, Global Constraints |
| Rule 7: the real caps (the app bridge 1,500,000 bytes, `printRaw` 1,500,000, the picture 16,000 rows) | **Task 12:** `textKotFitsPicture` (the picture's own ceiling at the paper) |
| `textTestJob` throws only on a bug | **Task 13:** made inside a try before anything is queued; the switch stays off |
| `useSlipCodePending` gives up after 8 s while the chunk may still be loading | **Task 12:** only `"ready"` counts |
| `TEXT_TEST_CHECK` wraps at 32 columns | Stands (cosmetic) |

After Task 9, the gate re-ran the review's seven uncaught mutations (and M6b, the round's kitchen lines): **all 8 caught**
(`evidence\mutate9.log`).

**A side effect of the review:** its `git worktree remove --force` deleted through the one junction its own cleanup missed
(`node_modules/.bin`, a dot-entry) and emptied `D:\kd\lucifer\node_modules\.bin` (every package intact). Restored
offline with `npm rebuild --ignore-scripts` at the root: 17 bins, exactly the top-level `bin` entries of
`package-lock.json` (the apps' own `node_modules` were untouched); the lock unchanged, `git status` clean, typecheck and
lint run again. Task 16 Step 3 tells the next reviewer; the gate's 4B reviewer worked in a prepared worktree and removed
nothing.

### The owner's rulings (2026-10-16)

1. `ESC R 0` right after `ESC @` in every text job: **yes**.
2. m-3: **follow the picture**.
3. The 4B interface changes (the key by the route, `queueTestSlip(write)`, Tasks 11 and 12 swapped): **OK**.
4. `ESC M 0` (Font A) as well: **yes**.

### Session 4B made exact

Gold `D:\kd\p4g`, branch `g4b-v5` from `f46600e` (the drafts `g4b-v1`..`g4b-v4` kept; v4 = v3 with the section review's
fixes folded into Tasks 10, 12 and 13, v5 = v4 with its re-check's m-9 in Task 12's tests; below):

| Task | Commit | Whole tree (`apps/cafe`) | Ops (tests + code) |
|---|---|---|---|
| 9 the 4A gate's rulings | `3205036` | `2630b79` (`f585076`) | 14 + 9 |
| 10 the switch's storage | `86a4b5f` | `8aa060e` (`dd4dca1`) | 2 + 1 |
| 11 the Windows printer's raw write, page side | `8f6dac0` | `ca9ff34` (`3f74d9d`) | 2 + 9 |
| 12 the bridge's text step | `3589c08` | `1737273` (`f6c682b`) | 6 + 7 |
| 13 the panel's section | `4c2f359` | `302ac29` (`cefd5b6`) | 5 + 10 |
| 14 the not-routed words | `f4ef670` | `a792641` (`49db995`) | 2 + 4 |

The blocks were generated from these commits (`gen4b\gen_ops.py`) and applied step by step
on `D:\kd\p4v` at `f46600e` (`gen4b\val.py`): every find matched once, every RED and GREEN ran (`gen4b\val6b\t9.txt` …
`t14.txt`), and **every task's whole tree came out identical to gold** (the column above). Then the plan file's own
Session 4B section (its 71 ops, applied at once on a reset `D:\kd\p4v`) rebuilt the gold tree `a7926418` exactly.
There: the cafe chain **6080** (6079 pass, 0 fail, 1 skipped), typecheck clean, lint 0 errors (2 old warnings).

### The end-to-end pre-run (Task 15)

On builds of `d21ee37` (`D:\kd\p4b-base`) and of the gold head (`D:\kd\p4b-new` at `7f3f723`; v5 differs only in a
test file, which no build includes), each with webpack's cache off, fresh `pos_scratch_e2e_4g_h*` databases
(`evidence\e2e-final-h.log`):
- **S1, simple mode (the POS app v1):** the same nine slips (KOT rounds 1 and 2, the whole tab, VOID, TABLE MOVED, cancel
  notice, bill, token, a Hindi KOT) with every switch off: **9/9 byte for byte equal**; the base build against itself
  9/9 too (the comparison is deterministic). **S1, printers mode (v2, a network printer of the setup): 9/9 equal.**
- **Text on** (the panel's switch, the text test 472 B with `#12` and `[1]`, the ruler 47 characters, Yes): KOT 698 B,
  round 2 596 B, the whole tab 811 B, VOID 668 B, TABLE MOVED 517 B, cancel notice 800 B, all text; the bill, the token
  and the Hindi KOT the very S1 picture bytes; a REPRINT 752 B text with its band; the Hindi REPRINT a picture; the logo
  on, a QR line: pictures; the switch off: the picture again. Printers mode (v2): the printer's own switch, KOT 698 B and
  VOID 647 B as text through the app's printer by its id, off: a picture. **Ratio 66–81×** (KOT 56,414 / 698 = 80.8×).
- **The emulator** (the release APK `29115bdf`, WebView 109, the page on `http://localhost:3110`): the panel's section on
  the real app; the text test 472 B (`1b 40 1b 52 00 1b 4d 00`); Yes; a KOT as text (544 B); "Print again" on it: REPRINT
  as text (598 B, `GS B 1`); the switch off: a picture (40,494 B); put back as found (printer removed, the empty start
  screen, reverses removed, `sync`, `emu kill`; crash buffer empty). The 2.0.1 APK not run (Task 15 says why).
- **Found on the way (harness):** `adb reverse tcp:9100` loses a small job's bytes when the app half-closes at once: a
  30-byte `nc` through it arrived as 0 bytes, through `10.0.2.2:9100` 18 of 18; the app's own picture "Print test slip"
  arrived empty too, and the app read every such write as printed. A real printer is reached directly, never through
  adb: Task 15 uses `10.0.2.2:9100`.
- **Found on the way (today's picture, not Phase 4):** a picture KOT's last line is cut at its bottom: on the emulator's
  WebView the round total's lower half (`evidence\shots\emu-kot-picture.png`), in headless Chrome its last two lines. The
  same bytes come from `d21ee37`, so Phase 4 leaves it alone (S1); reported to the owner (a fix would be its own branch
  from `main`, after a look at a real printer's paper).

### The fresh review of Session 4B's exact section (Claude Fable 5.1)

Read-only, no 429; its probes in a worktree the gate prepared (`D:\kd\p4r`), which it left clean (no worktree made or
removed). It replayed the plan's blocks on an export of `f46600e` (69 ops, identical to gold), ran the 4B suites
(130/130), the typecheck and the lint, recomputed the 43 pinned hashes at both commits, checked the routes against
`slipPrintOptions` and the lane on every runtime, rendered the aligned Classic row, and ran 20 mutations (14 caught).
**Verdict: "Ready to run as written: With fixes"; 0 Critical, 2 Important, 8 Minor.** With every switch off the picture
path is byte for byte today's; the routes mirror the picture's writers; the store and the bridge's test window hold.

| Finding | Ruling |
|---|---|
| **I-1** Task 15's two reprint Expected lines were not the kept log's (that log's `reprint` picked the job by its label, which several payloads share, and so reprinted the Hindi KOT, a picture: correct behaviour, a harness bug) | **Fixed in the harness:** `reprint` picks the job by its job key (a KOT's order and round: an order also has its whole-tab KOT, which a pick by order and kind took in a later run), and the Hindi reprint is its own line; the whole headless run was made again on the final gold and its log kept (`evidence\e2e-final-h.log`); every Expected line of Task 15 is that log's |
| **I-2** a switch stored on device A for printer P outlives P's re-assignment to device B: during a takeover A would print P's KOTs as text, against spec §5.3, and A's panel no longer lists P to turn it off | **Fixed in gold Task 12:** `printOnce` marks a slip whose printer is one of the agent's `takeoverIds` (`takeover: true`), and the text step answers null for it; a unit test (RED without the fix: `not ok … taken over for another device: a picture`) and a source pin |
| m-1 four mutations not caught: the step's rule-7 call, the record-level strictness, the test window's `track(null)`, the printers-mode-with-no-printer branch | **Folded:** a 22,300-item slip that fits 80 mm's limit and passes 58 mm's (a picture on 58 mm, text on 80 mm); the strict record with a printer that would read on; the waiting slip's outcome after the text test; `textKotPrintersOf` in printers mode with no printer of its own |
| m-2 the Global Constraints' key bullet still read `printer:<setup printer id>` | Fixed (the reach, and a takeover prints pictures) |
| m-3 off left the row's choice at Automatic, so a printer proven at 42 would print its next test at 48 | **Folded (Task 13):** off seeds the choice it was proven at; pinned |
| m-4 a text test the watchdog gave up on showed "reprint it from Orders" under the switch | **Folded (Task 13):** the section's own "Could not print the text test. The switch stays off."; pinned |
| m-5 the step reads the device printer's state at dispatch, the lane after its raster | Stands: S3-safe (a printer null or in another tab for a moment prints a picture, never a lost slip) |
| m-6 keys of printers no longer on this device are never removed | Stands: bounded by staff taps; a printer re-pointed away prints pictures (I-2) |
| m-7 Task 0 expects the gate's commit, the edits were uncommitted | Committed before the prompt was given |
| m-8 the budget comment says 262, the table 263 | The table names both (262 after Task 12, 263 after Task 13) |

The section after the fixes: gold `g4b-v4` (`3205036` `86a4b5f` `8f6dac0` `9a3aef2` `2d94e9e` `7f3f723`, the drafts
`g4b-v1`..`g4b-v3` kept); the blocks generated again (71 ops) and validated on a reset `D:\kd\p4v` (`gen4b\val4\`: every
task's whole tree identical to gold); the headless run again on a build of `7f3f723` (`evidence\e2e-final-h.log`: S1 9/9
in both modes; every text slip, its size and its hash as Task 15 says).

**The reviewer's re-check of v4** (the same Claude Fable 5.1 reviewer, read-only, `D:\kd\p4r` at `7f3f723`, left clean;
no 429): **"v4 ready to run as written: Yes"**, 0 Critical, 0 Important. The diff from v3 is 9 files, +65 −7, and the
bridge is byte for byte v3's. A slip that is no takeover reaches the bridge as the very same object; a takeover slip is
that slip plus `takeover: true`, which only the text step reads, so it takes the very path a slip with its switch off
takes (S1, S3). The 43 pinned hashes equal `d21ee37`'s; the print suites 235/235, typecheck and lint clean; 8 mutations
(the four v3 left, the takeover guard, the agent's mark, the m-3 seed, the m-4 mapping), all caught. A residual it
accepts: `takeoverIds` is this device's own setup read, as stale as every other list the agent uses. Two new minors:

| Finding | Ruling |
|---|---|
| m-9 the rule-7 step test compares the whole answer (a job of about 780 KB) with null: if rule 7 broke, the failing assertion's diff would run node out of memory and take the whole file, the S1 pin with it, down with no name | **Folded (Task 12's tests, gold `g4b-v5`):** both checks compare a boolean; with the rule-7 call removed the file reads `not ok 12 - spec §4.1 rule 7 in the step …` with `58 mm: a picture (rule 7)` |
| m-10 the plan file still held the v3 section when it re-checked | The plan's Session 4B section is generated from `g4b-v5` (Files, blocks, lint lists, messages, counts, the line budget, the key bullet) and replayed from the plan file itself |

Gold `g4b-v5` is v4 with m-9: Task 12 `3589c08`, Task 13 `4c2f359`, Task 14 `f4ef670`. Only a test file differs from
v4, and no build includes it, so the builds Task 15 ran are this code. The blocks were generated again (71 ops; only
Task 12's test ops changed, and its lint list gained `hooks/use-print-agent.ts`) and validated again on a reset
`D:\kd\p4v` (`gen4b\val6b\`: every RED and GREEN as written, every task's whole tree identical to gold);
the plan file's own section rebuilt the gold tree `a7926418`; the cafe chain there **6080** (6079 pass, 0 fail,
1 skipped).

## Session 4B Results (filled in by the implementer)

Executed on 2026-10-16 with superpowers:executing-plans, task by task, Tasks 0 and 9 → 16, in `D:\kd\lucifer` on
`feat/printing-phase-4` (start `c6f3f2a`, the 4A gate's commit). No push, no merge, no deploy, no download, no web
request, no upload.

### Commits (`c6f3f2a..HEAD`)

| Commit | Task | `apps/cafe` tree | Gold (`D:\kd\p4g`, `g4b-v5`) |
|---|---|---|---|
| `c4964b3` | 9: the 4A gate's rulings in the text renderer | `f585076` | `3205036` → `f585076` |
| `35e7920` | 10: the switch's storage (`text-kot-store.ts`) | `dd4dca1` | `86a4b5f` → `dd4dca1` |
| `f42c830` | 11: the Windows printer's raw write, page side | `3f74d9d` | `8f6dac0` → `3f74d9d` |
| `f3931fb` | 12: the bridge's text step (`text-kot-print.ts`) | `f6c682b` | `3589c08` → `f6c682b` |
| `928c065` | 13: "Fast text KOTs (English only)" in the printer panel | `cefd5b6` | `4c2f359` → `cefd5b6` |
| `2e3fa26` | 14: the not-routed words by kind | `49db995` | `f4ef670` → `49db995` |
| (this commit) | 16: Results | | |

Every task's `apps/cafe` tree equals its gold commit's. After Task 14, `git diff --stat f4ef670 HEAD` lists only this plan
and the spec (the gate's own commit `c6f3f2a` carries them); the code is the gold tree `a7926418` exactly.

### Start (Task 0)

- Branch `feat/printing-phase-4` at `c6f3f2a` on top of `f46600e`, working tree clean; D: 9.5 GB free, C: 74 GB free; the
  `.bin` check `4`.
- The cafe chain `# tests 6022`, `# pass 6021`, `# fail 0`, `# skipped 1` (65 s, in the background); `npx tsc --noEmit`
  clean; lint `✖ 2 problems (0 errors, 2 warnings)`. All as Expected.

### How the code was applied

Every block went verbatim into the real repo through `D:\kd\pos-dev-keep\phase3-final-gate\apply_blocks_clone.py`, a
`--dry` run first, then for real, one step's line range at a time, so each RED was seen before its code went in:
Task 9 14 + 9 ops, Task 10 2 + 1, Task 11 2 + 9, Task 12 6 + 7, Task 13 5 + 10, Task 14 2 + 4 (**71**). Each find
matched exactly once. Every commit message was copied from the plan's block (its lines, by `sed -n`) into a scratch file
and committed with `git commit -F`. The test commands for `task-done` ran through scratchpad wrapper scripts.

### Per-task RED → GREEN (every Expected line compared; all matched)

| Task | RED (as seen) | GREEN (as seen) |
|---|---|---|
| 9 | `not ok 16, 22, 25, 27, 28, 29, 35, 38` (the eight the plan names); tests 46, pass 38, **fail 8** | **46/46**; typecheck and lint clean |
| 10 | `# Error: Cannot find module './text-kot-store'`, `not ok 1 - lib\\printer\\kot-text\\text-kot-store.test.ts`; tests 1, pass 0, **fail 1** | **10/10**; typecheck and lint clean |
| 11 | `not ok 1`–`6` (the six the plan names); tests 6, pass 0, **fail 6** | with the Windows suites **77/77**; typecheck and lint clean |
| 12 | `not ok 1`–`5` of `print-host-text-kot.test.ts`, `# Error: Cannot find module './text-kot-print'`, `not ok 2 - lib\\printer\\kot-text\\text-kot-print.test.ts`; tests 7, pass 1, **fail 6** | with the bridge's suites **243/243**; typecheck and lint clean |
| 13 | `not ok 7`–`12`, `# Error: Cannot find module './text-kot-printers'`, `not ok 3 - lib\\printer\\kot-text\\text-kot-printers.test.ts`; tests 13, pass 6, **fail 6** | with the panel's and the bridge's suites **280/280**; typecheck and lint clean |
| 14 | `not ok 4`, `not ok 5`; tests 8, pass 6, **fail 2** | **77/77**; typecheck and lint clean |

### Task 15: end to end

- **Step 1:** the gate's tools copied from `D:\kd\pos-dev-keep\phase4\gate-4a\e2e\` into the scratchpad (15 files);
  `3110 and 9100 free`; D: 9.5 GB free.
- **Step 2:** `D:\kd\p4b-base` at `d21ee37` with its `BUILD_ID` (not rebuilt); `D:\kd\p4b-new` moved with
  `git checkout --detach` to `2e3fa26` (` M apps/cafe/next.config.ts` only, the gate's cache-off line; its `apps/cafe`
  tree `49db995`); its build `EXIT 0` (compiled in 42 s, the 2 old lint warnings; `.next` 26 MB).
- **Step 3, the headless run** (`e2e-final.sh s`, fresh databases `pos_scratch_e2e_4g_sa1`, `sb1`, `spa`, `spb`, `st`;
  `EXIT 0`): the filtered output is **identical, line for line, to the plan's Expected** (51 lines; only the saved
  printer's id differs, as the plan says): **S1 simple mode 9/9 byte for byte equal (sa1 vs sb1); S1 printers mode 9/9
  (spa vs spb)**, with the very picture sizes and hashes the gate recorded (this PC's Chrome); text on: the text test
  472 B with TEXT TEST and the 47-character ruler; KOT 698 B, round 2 596 B, the whole tab 811 B, VOID 668 B, TABLE MOVED
  517 B, cancel notice 800 B, each with the plan's hash; the bill, the token and the Hindi KOT their S1 picture bytes; the
  REPRINT 752 B text with its centred band, the Hindi REPRINT a 62,030 B picture; the logo on and the QR line pictures;
  text again 698 B; off: a picture. Printers mode (v2): KOT 698 B and VOID 647 B text by the printer's own switch
  (`printer:6ad1d98d6f22a1712cde51f1:app:tcp:127.0.0.1:9100`), off: a picture. **The ratio** (spec §11 item 1): KOT round 1
  56,414 / 698 = 80.8×, round 2 78.3×, whole tab 74.8×, VOID 79.8×, TABLE MOVED 66.1×, cancel notice 76.3×.
- **Step 4, the emulator** (C: 74 GB free; `-no-snapshot -memory 4096 -no-audio`; the app `base.apk` `29115bdf`, the
  release APK; the crash buffer empty at boot; the app on its own empty start screen; database `pos_scratch_e2e_4g_semu`,
  the three seed lines; `next start` of `p4b-new` on 3110 through `adb reverse tcp:3110 tcp:3110` only; the fake printer
  on the host, the app's network printer at `10.0.2.2:9100`):
  1. `http://localhost:3110` typed on the start screen, Open POS. The app opened signed in with a session cookie left by
     an earlier run (the menu looked right); to be sure it was this database's, Account → Sign out, then sign in as
     `e2eadmin` (TAB, `type-secret.py`, Enter): the dashboard of "POS Software".
  2. "Network printer (Wi-Fi or Ethernet)" `10.0.2.2`, 9100, "Use this network printer": `Network printer 10.0.2.2 is
     connected.`; the panel lists "Fast text KOTs (English only)" with `Network printer 10.0.2.2`, `80 mm`, the switch off.
  3. Masala Chai + Cheesecake → Send to Kitchen: one slip of **44,454 B**, a picture (`1b 40 1d 76 30 …`).
  4. A tap on the printer's row: a **472-byte** slip starting **`1b 40 1b 52 00 1b 4d 00`** (TEXT TEST, the sample with
     `#12` and `[1] Paneer Tikka`, the white-on-black line, the 47-character ruler), then "Did it print clearly, with the
     ruler on one line?"; Yes → "On: English-only kitchen tickets print as text on this printer."
  5. Masala Chai + Cheesecake → Send to Kitchen: a **544 B** text slip (`KITCHEN ORDER`, `#2`, `Round 1`, Order / Table /
     Time / Staff, `1 x Masala Chai  Rs 40`, `1 x Cheesecake  Rs 220`, `2 item(s)`, `Round total: Rs 260`).
  6. `reprint-latest`: `labels ["REPRINT"]`; 13 s later a **598 B** text slip, its first line the centred `REPRINT`
     band (`GS B 1` once), no raster.
  7. The switch off (immediate, no slip) → Masala Chai → Send to Kitchen: a **40,494 B** picture again.
  8. Put back as found: Remove → "Yes, remove" (`Printer removed from this device.`; the section is gone with the
     printer); More options → Change POS address → "Clear POS address" → Back: the empty start screen.
     `adb reverse --remove-all`, `adb shell sync`, the crash buffer **0 lines**, `adb emu kill`; `stopped 22076` (the
     3110 server, by `stop3110.ps1`); the fake printer `stopped 11708` (its command line names `fp-emu`).
  Every emulator size equals the gate's pre-run (472, 544, 598, 40,494 B).
- **The app 2.0.1 was not run** (the plan's reason).

### Task 16: verification

- **Step 1:** `36 files changed, 1704 insertions(+), 47 deletions(-)`; `0`; `apps/cafe/package.json` (the only path
  outside `apps/cafe/{lib,hooks,components}`); the S1 pin `# pass 1`, `# fail 0`. `print-budget.test.ts` unchanged.
- **Step 2:** the cafe chain **`# tests 6080`, `# pass 6079`, `# fail 0`, `# skipped 1`** (61 s); `typecheck clean`;
  `✖ 2 problems (0 errors, 2 warnings)`. All as Expected.

### Step 3: the fresh review (Claude Fable 5.1)

A fresh reviewer on Claude Fable 5.1 (no 429), read-only on the repo, its probes in a worktree this session prepared
(`D:\kd\p4rv4b` at `2e3fa26`, junctioned `node_modules`), which it left clean (no worktree made or removed). It read the
spec, the plan's Session 4B and the 4A gate, every production diff and test, and the picture's writers; ran the cafe
chain (6080/6079/0/1) and the seven 4B files (57/57); four hook-harness probes through the real bridge body; three
mutations (two caught). **Verdict: "Ready to merge: Yes"; 0 Critical, 0 Important, 3 Minor.** With every switch off the
bridge takes exactly today's path and calls no writer; with a switch on, text goes through the very writer and window the
picture would use; the routes, keys, panel states and not-routed words check out against the picture's code and the
router. No fix pass was needed.

| Finding | Ruling |
|---|---|
| m-1 `hooks/use-text-kot-printers.ts` decides simple vs printers mode from a printers read that has not answered yet (`NO_PRINTERS` → `printersModeOn([])` false): on a printers-mode cafe the section can list this device's own printer for a moment under a `device:` key no printers-mode job uses; a tap then prints a test slip and shows "On", and the row goes when the read lands | Deferred to the 4B gate (no wrong paper: a printer job's key is `printer:…`, off → picture; the reviewer's fix: return `[]` while the read has not answered) |
| m-2 `hooks/use-print-host-bridge.ts`: `void write().then(…)` lets a writer that throws synchronously escape the dispatch effect (the bridge would stay busy) | Deferred to the 4B gate (not reachable: every writer the routes use returns a promise before doing anything; the hardening is `Promise.resolve().then(write)`) |
| m-3 `settingsForPaper(settings, target.paper)` in `textKotWriteFor` is inert for text (the columns come from the route's paper) | Deferred to the 4B gate (harmless and faithful to `PrintHostPrintSources`; a comment would say so) |

What the reviewer set aside, and the ruling on each (each stands, as it reasoned: none changes paper with every switch
off, and each is the picture's own behaviour or an owner ruling): the picture KOT's bottom cut (pre-existing, reported
at the gate); a bill-only printer that takes a station's KOT as the no-printer fallback is not listed (pictures there);
the late-completion window (the picture's, unreachable for text since every writer's deadline is under the watchdog);
the m-3 centring rounding (the owner's "follow the picture"); the microtask between the lazy slip code turning "ready"
and the dispatch (both the order's correct content); a whole-tab KOT routed nowhere also says "every item in this round
was cancelled" (the owner's P4-9 words); a BLE device id lower-cased in its key (a case-only collision is not real);
`desktopPrintRawOn`'s constant timeout (the picture's test seam only); the text renderer in the page bundle (a few KB,
no request); `printRawOn` itself and the real-printer run (4C, 4D).

### Differences from this plan

1. **None in the code or the counts.** Every block, RED, GREEN, count and size is the plan's.
2. **Task 15 Step 4, item 1:** the app opened already signed in (a session cookie from an earlier run with the same
   test secret); the session signed out and in again so the run used this database's own admin, as the plan's sign-in
   step intends.
3. **Task 15 Step 4 (harness):** uiautomator reports the panel's switch as `checkable="false" checked="false"` even when
   it is on (WebView 109's accessibility tree); the switch's state was read from screenshots (on after Yes, off after
   the tap) and from the "On: …" line; the headless run reads the DOM (`checked=true` / `false`).
4. **Order of work (process only):** Task 16 Step 1 and the fresh review ran while Task 15's headless run was in the
   background (the reviewer kept off ports 3110 and 9100, mongod, adb and builds); Steps 1–2 were run again at the end
   on the same `HEAD` (no code changed after Task 14).

## The 4B review gate (fast, 2026-10-16)

The owner's decisions (2026-10-16): Phase 4 is finished fast, so it runs in **two sessions instead of four**: session 1
verifies 4B and builds 4C directly on `feat/printing-phase-4` (test first, one commit per task; no gold worktree, no
generated blocks, no separate execution session; one fresh review at the end); session 2 verifies 4C independently, then
4D. Speed loosens no rule (S1–S6, TDD with RED seen first, the pins, the emulator and Windows checks, the put-back). The
4B minors: **m-1 fix** (the "Fast text KOTs" section shows nothing until the printers read has answered), **m-2 harden**
(a writer that throws synchronously settles the slip as a normal failure), **m-3** a comment.

4B verified (session 1 of the fast path, Part A):
- Disks: D: 9.5 GB, C: 73 GB free; the `.bin` check `4`.
- Each 4B task's `apps/cafe` tree equals gold: `c4964b3` = `3205036` (`f585076`), `35e7920` = `86a4b5f` (`dd4dca1`),
  `f42c830` = `8f6dac0` (`3f74d9d`), `f3931fb` = `3589c08` (`f6c682b`), `928c065` = `4c2f359` (`cefd5b6`), `2e3fa26` =
  `f4ef670` (`49db995`).
- The cafe chain `6080` (`6079` pass, `0` fail, `1` skipped); typecheck clean; lint `✖ 2 problems (0 errors, 2 warnings)`;
  Task 16 Step 1: `36 files changed, 1704 insertions(+), 47 deletions(-)`, `0`, `apps/cafe/package.json`.
- The S1 end-to-end comparison was run once, on a build of session 1's final page code (below), since the rulings touch
  the bridge.

## Session 4C Results (fast path, session 1 of 2)

Executed on 2026-10-16 in `D:\kd\lucifer` on `feat/printing-phase-4` (start `5743907`), test first, one commit per task.
No push, no merge, no deploy, no upload, no download, no web request; no real network was scanned and no real printer
printed to.

### Commits (`5743907..HEAD`)

| Commit | Task |
|---|---|
| `73cb2f7` | 19: the 4B gate's rulings: m-1 (the section waits for the printers read), m-2 (a sync writer throw settles as a failure), m-3 (a comment) |
| `02b6df1` | 20: Android `network.findPrinters` (`LanScan.kt`, feature `lanScan`), the RN bridge, the page's protocol copy, pins 4 and 33 |
| `8d918f2` | 21: the network printer's name (m-2): "Network printer ‹host›:‹port›" off 9100; saved printers shown by their id |
| `751a064` | 22: Windows `findLanPrinters` (`lan-scan.ts`), behind the print channels' gate; the test-only interface list |
| `7da0d1e` | 23: Windows `printRawOn` (`print-raw-on.ts`, `print.ts` on the one queue) |
| `c4a2426` | 24: "Find network printers" on the page (`lan-discovery.ts`, `FindNetworkPrinters.tsx`, both forms) |
| `4207a7c` | 24 fix: the page reaches the Windows scan through the desktop printer seam (the print lane's pin) |
| `a6c4778` | the review's m-1 (graded Important by its effect): the scan thread answers on any failure, never ends the app |
| (this commit) | the gate section, these Results, "How this plan runs" |

### Counts (before → after)

| Suite | `5743907` (the apps: native apps N3's counts; no app file changed since) | `HEAD` |
|---|---|---|
| cafe chain | 6080 (6079 pass, 0 fail, 1 skipped) | **6095 (6094 pass, 0 fail, 1 skipped)** |
| cafe typecheck / lint | clean / 0 errors (2 old warnings) | clean / 0 errors (2 old warnings) |
| mobile `npm test` / Jest / typecheck / lint | 168 / 8 / clean / clean | **173** / 8 / clean / clean |
| JUnit (`:app:testDebugUnitTest --rerun`) | 94 | **109** (LanScanTest 11, PrinterNamesTest 4) |
| desktop `npm test` / typecheck / lint | 211 / clean / clean | **223** / clean / clean |

Scope: `git diff --stat 5743907..HEAD -- . ':!docs'` = `45 files changed, 1734 insertions(+), 37 deletions(-)`
(`f46600e..HEAD`: 74 files, +3431 −77); the diff from `d21ee37` to `workers`, `apps/cafe/models`, `apps/cafe/app/api` and
`packages` is empty (0 bytes); `print-budget.test.ts` unchanged; the S1 pin (43 files) passes unchanged, so S5 holds: the
Android printer manager, pool, transports and TransportFactory and the Windows print-direct, escpos, raw-spool, raw-tcp
and print-job are byte for byte `d21ee37`'s. Production files changed in the apps: Android `LanScan.kt` (new),
`PosPrinterModule.kt`, `Prefs.kt` (one line), `PrinterDiscovery.kt`; Windows `lan-scan.ts`, `print-raw-on.ts` (new),
`print.ts`, `print-raw.ts`, `main.ts`, `preload.ts`, `shared.ts`.

### Per-task RED → GREEN

| Task | RED (as seen) | GREEN |
|---|---|---|
| 19 | 4 fail: m-2 a sync throw escaped the dispatch effect; the text test left the bridge busy; m-1 an unanswered read listed `device:native:bt-classic:…`; the m-1 pin | the bridge and section suites 160/160 |
| 20 | mobile 8 fail (protocol, injected, router, pins 4 and 33), cafe 6 fail (protocol, parity, timeouts, schemas), JUnit `compileDebugUnitTestKotlin FAILED` (`Unresolved reference 'LanScanPlan'`) | mobile 124/124, cafe 54/54, JUnit 104 |
| 21 | JUnit `compileDebugUnitTestKotlin FAILED` (`Unresolved reference 'shown'`), pin 34 | JUnit 108, mobile 126/126 |
| 22 | desktop 5 fail (pins (6), (7), L1, W1; `Cannot find module './lan-scan'`) | desktop 220/220 |
| 23 | desktop 4 fail (pins (6), (7), W2; `Cannot find module './print-raw-on'`) | desktop 223/223 |
| 24 | 4 fail (`Cannot find module './lan-discovery'`, the component missing); then the full chain's print-lane seam pin (1 fail) | 107/107, the chain 6095/6094/0/1 |
| review m-1 | JUnit `Unresolved reference 'answerOrNone'`, pin 33 | JUnit 109, mobile 70/70 |

### Task 25: the emulator

- As found: `pm path` `…/base.apk`, `29115bdf`, versionName 1.0, the crash buffer empty, the app's own empty start screen.
- The branch's x86_64 release APK (`:app:compileReleaseKotlin --rerun`, then `aR -PreactNativeArchitectures=x86_64`) is
  signed with the release key, unlike the as-found app (the debug key), so: `adb uninstall`, `adb install` of the branch
  APK `22a2057a` (versionName 2.0.1; `adb install` answered Success), the crash buffer 0 lines after the launch; after the
  review's fix the rebuilt APK `99b5b763` went on with `install -r` (crash buffer 0).
- The page from a build of `4207a7c` on `http://localhost:3110` (`adb reverse tcp:3110 tcp:3110`; fresh database
  `pos_scratch_e2e_4g_vemu`, signed in as `e2eadmin`); fake printers on the PC at 9100 and 9101.
- **The panel's network form:** "Find network printers" → "Looking for printers on this Wi-Fi…" → after about 6 s one row,
  `10.0.2.2 · port 9100` (the host's loopback as the emulator sees it; nothing else on the emulator's virtual network, and
  9101 not asked); the fake printer at 9100 logged one connection of **0 bytes**. A tap filled the address `10.0.2.2` and
  the port `9100`; nothing was added until "Use this network printer" (`Network printer 10.0.2.2 is connected.`).
- **Already added:** the "Add another printer" form's scan listed `10.0.2.2 · port 9100 Already added: Network printer
  10.0.2.2`; the setup form (Printer setup → Set up printers → Add printer → Network (LAN)) listed `10.0.2.2 · port 9100
  Already added: Printer 1` (Set up printers had made this device's printer the setup's "Printer 1" in the test
  database); a tap filled `10.0.2.2` / `9100`; the form was closed without saving.
- **m-2:** a second network printer `10.0.2.2:9101` (typed) is listed as `Network printer 10.0.2.2:9101`, the first as
  `Network printer 10.0.2.2`. With this device printing all slips and notifications granted (`pm grant`), the host
  notification read "Printing is on — 2 printers"; the 9101 fake stopped, about 35 s later it read **"Printing is on —
  Network printer 10.0.2.2:9101 not connected"**: the right printer, by its port.
- On the fixed APK `99b5b763`: the scan again (`10.0.2.2 · port 9100 Already added: Printer 1`, one 0-byte connection),
  the crash buffer 0.
- **Put back as found:** `adb reverse --remove-all`; `adb uninstall` of the branch app; `adb install` of
  `D:\kd\pos-dev-keep\apk-release\pos-emulator-x86_64-release.apk` (`29115bdf`, versionName 1.0); the app's empty start
  screen (no address, so no printer); the crash buffer 0; `adb shell sync` (`pm path` still there); `adb emu kill`. The
  server (`stop3110.ps1`: `stopped 1212`) and both fake printers stopped by PID.

### Task 26: the Windows app's IPC smoke

The built main process (`apps/desktop/out`, `npm run build`) ran **unpackaged** through a scratch bootstrap that sets
`userData` to a scratch folder before the app's code loads (so the owner's installed app, running on this PC since
2026-10-15 16:18 with its data in `%APPDATA%\POS Software by sandbee`, was never read, written or signalled: a separate
single-instance lock), with a scratch store whose saved address is `http://localhost:3110`, and
`POS_DESKTOP_TEST_LAN` = an interface `192.168.77.10/24` and the fake printer address `192.168.77.50` (mapped to this PC's
loopback, where the fake printer listened on 9100). Playwright `_electron`, `ELECTRON_RUN_AS_NODE` unset:
- the window on `http://localhost:3110/login`; `posDesktop` = `findLanPrinters, lanStatus, listPrinters, printHtml,
  printHtmlOn, printRaw, printRawOn, savePrintMode, savePrinter, version`;
- `findLanPrinters()` → `{"found":[{"host":"192.168.77.50","port":9100}],"subnet":"192.168.77.0/24"}` in 15 ms; the fake
  printer logged exactly one connection of 0 bytes (every other test address answered no without a socket);
- `printRawOn("Sandbee Smoke No Such Printer", …)` → `That printer is not on this PC. Open Printer setup in the POS and
  choose a printer this PC has.`; `printRawOn("", …)` → `This print request was refused.`

### S1 end to end on the final page code

`D:\kd\p4b-new` moved to `4207a7c` (its cache-off line kept) and rebuilt (`EXIT 0`); the gate's `e2e-final.sh v` (fresh
databases `pos_scratch_e2e_4g_v*`): **identical, line for line, to Task 15's Expected** (51 lines; only the database
prefix and the saved printer's id differ): S1 **9/9** byte for byte equal in simple mode (va1 vs vb1) and **9/9** in
printers mode (vpa vs vpb); the text test 472 B; KOT 698 B (`9a1f3f65951f`), round 2 596, whole tab 811, VOID 668, TABLE
MOVED 517, cancel notice 800, REPRINT 752 B; printers mode 698/647 B. The later review fix changes only the Android app.

### The fresh review (Claude Fable 5.1)

Read-only on the repo; its probes in a prepared worktree `D:\kd\p4rv4c` (left clean; this session removed it after
deleting its 383 junctions, `.bin` included); no 429. It reviewed `f46600e..4207a7c` (4B and 4C), checked S5 by git blob
ids, ran the suites (cafe chain 6095/6094/0/1, desktop 223, mobile 126), four Windows scan probes (508 hosts at the
500 ms worst case in 7.5–10 s; nothing probed after the deadline; public, CGNAT and link-local addresses plan nothing)
and 13 mutations (all caught; one only by its own probe). **Verdict: "Ready to merge: Yes"; 0 Critical, 0 Important,
4 Minor.**

| Finding | Ruling |
|---|---|
| m-1 the Android scan thread had no catch-all: an unexpected exception would end the whole app (the print host with it) and leave the page's request unanswered | **Re-graded Important by its effect and fixed by TDD, `a6c4778`:** `LanScanRun.answerOrNone` (any failure answers no network) and a refusal when the answer cannot be sent; RED `Unresolved reference 'answerOrNone'` + pin 33, GREEN JUnit 109, pins 70/70; the emulator checked on the rebuilt APK |
| m-2 `Prefs.kt`'s comment and Task 21's message say storage is not rewritten, but `PrinterPool.init` (unchanged) saves right after the load, so 2.0.2's first start persists the shown names | Deferred to session 2 (harmless: ids drive every route, key and lease; the comment should say so) |
| m-3 the page's Windows scan has no page-side time bound (the POS app path has 20 s) | Deferred to session 2 (the app's own scan always answers within about 10.5 s) |
| m-4 no test pins that no host is probed after the Windows deadline (removing `open = false` passes the suite) | Deferred to session 2 (a test-strength gap; the code is right) |

What the reviewer set aside, ruled "stands" as it reasoned: a renamed VPN adapter (the accepted residual m-D); "Already
added" by hostname vs IP (the spec says by address and port); the button for a LAN printer another device prints (spec
§7.3); a probe briefly holding a one-connection printer and an isolated Wi-Fi (spec §7, §14); hooks before the early
return (no request); the driver-mode refusal's sentence (the page never offers text there); the failure log without the
printer name (as `printOn`); the `allNetworks` deprecation (m-C); the page's stored device-printer name following the app;
`writeRawJob` blocking (as the Direct lane).

### Differences from the plan's 4C spec, and why

1. **The fast path** (the owner's decision): built directly on the branch, no gold or blocks; the rulings task is Task 19.
2. **m-2's form:** `new Promise<void>((resolve) => resolve(write()))` rather than `Promise.resolve().then(write)`: the same
   effect for a synchronous throw, while the write still starts at once (the existing order and busy-window tests check a
   write right after a queue).
3. **The m-1 pin** (`print-text-kot-paths.test.ts`) now names the read's `answered` flag too: the same one cache entry.
4. **Task 20:** `validate.ts` is not changed: its default branch already refuses any parameter for a method that takes
   none (the router test covers `network.findPrinters`).
5. **Task 21:** the shown name is applied when the saved printers load (`Prefs.savedPrinters`), not at each display, so
   `PrinterPool`, `PrinterManager` (S5) and `StatusJson` stay unchanged; pin 19's restore needle moved deliberately.
6. **Task 22:** the handler sits in `print-raw.ts` (the print channels' gate), wired in `main.ts`; the test-only setting is
   `POS_DESKTOP_TEST_LAN` (an interface list and one fake printer address mapped to the loopback), read once, only when
   `!app.isPackaged`; pins (6), (7), L1 (widened) and the new W1.
7. **Task 23:** `printRawOn` lives in `print.ts` on its one print queue; its log lines say "raw slip" (the older pins tie
   every "print job" log line to `html.length`); a driver-method request is refused with the shell's "This print request
   was refused." (no new sentence).
8. **Task 24:** the page's Windows call goes through `lib/desktop-shell-printer.ts` (`desktopFindsLanPrinters`,
   `desktopFindLanPrinters`), as the print lane's source pin requires; a failed scan reads as "none found" (the spec's own
   words tell staff to type the address).
9. **Task 25** ran on the branch build after an uninstall (the release key) and put the as-found app back by a fresh
   install of `29115bdf`; **Task 26** ran on the built main process unpackaged with a scratch `userData` (not a packaged
   test build), so the owner's installed app was not touched.
