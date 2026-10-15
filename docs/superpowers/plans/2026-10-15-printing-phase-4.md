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
pre-validated in the planning session. Sessions 4B–4D are task specs with fixed interfaces, test lists and acceptance
checks; each is made exact (full code, pre-validated) at the gate before it, as in printing Phases 2 and 3 and native
apps 2.0. A gate may change a later session's spec; it records why.

| Session | Delivers | Gate before the next |
|---|---|---|
| 4A | The text renderer as pure code with its tests, wired to nothing: the characters, the lines and their bytes, Classic and Kitchen Bold as text, the text test slip, the parity with the picture. No behaviour change. | review; 4B made exact |
| 4B | The page: the switch per printer (its store, its section, the text test and confirm), the bridge's text step and the writers (a Windows printer's side feature-detected), the not-routed words; the fake-printer end-to-end runs (headless Chrome with a fake POS app, the emulator) | review; 4C made exact |
| 4C | The apps 2.0.2 code: Android `network.findPrinters` and the network printer's name (m-2); Windows `findLanPrinters` and `printRawOn`; the page's "Find network printers"; JUnit, desktop tests, pins; the emulator finding a fake printer | review; 4D made exact |
| 4D | The exit: both apps 2.0.2, GO-LIVE and TEST-CHECKLIST (with the owner's Bluetooth measurement), every suite, the release set `Sandbee-POS-2.0.2`, the final review | the owner's merge OK |

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
- **Commands:** `ESC @` once at the start, `ESC a`, `ESC E`, `GS !`, `GS B`, `LF`, `ESC J`, and the picture's
  `GS V 66 0`; no code page or Kanji command, never a second `ESC @`.
- **S3:** a refusal or any error in the text path is decided before a byte is sent and prints the slip as a picture;
  `kotTextJob` never throws.
- **The switch** lives only in the printing device's storage (`pos.text-kot.v1`, never inside `pos.device-printer.v1`),
  keyed `printer:<setup printer id>` or `device:<this device's printer identity>`; on only after the printer's text test
  printed and staff answered Yes (S2).
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
| `apps/cafe/lib/printer/kot-text/text-kot-store.ts` | 4B | the switch's storage (`pos.text-kot.v1`) |
| `apps/cafe/lib/printer/kot-text/text-kot-print.ts` | 4B | the bridge's text step: the key, the writer, the bytes or none |
| `apps/cafe/hooks/use-print-host-bridge.ts` | 4B | asks the text step before the kitchen surface; the text test |
| `apps/cafe/components/print/TextKotSection.tsx` | 4B | "Fast text KOTs (English only)" in the printer panel |
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

# Session 4B (spec): the page: the switch, the bridge's text step, the not-routed words

Made exact at the 4A review gate, against the code 4A landed. Tasks are numbered 10–16. Acceptance: with a printer's
switch on (after its text test printed and staff said Yes), a kitchen-surface slip that passes the gate prints as text
through that printer's own writer, and every other slip exactly as today; with every switch off the page prints byte
for byte as before (S1); the not-routed toast says the right thing by kind. Expected: the cafe chain grows by this
session's tests; no app, Worker, model or API change (`git diff -- apps/mobile apps/desktop workers apps/cafe/models apps/cafe/app/api` empty).

### Task 10: The switch's storage (§5.1)

- **Files:** Create `apps/cafe/lib/printer/kot-text/text-kot-store.ts` (+ `text-kot-store.test.ts`).
- **Interfaces (fixed):** `TEXT_KOT_KEY = "pos.text-kot.v1"`; a stored record `{ v: 1, printers: Record<string, {
  narrow80: boolean }> }` (a key present = on; only the 80 mm "42" choice is kept, never the columns: the review's I-1;
  zod-checked on read, anything else reads as every switch off; every access in try/catch, as `device-printer-store.ts`);
  `textKotKeyForPrinter(printer: PrinterConfig): string` → `printer:<id>:<connection>` with the connection's kind,
  transport and address or host:port lower-cased, so a printer re-pointed in Printer setup reads off (I-2);
  `textKotKeyForDevice(printer: DevicePrinter | { kind: "windows"; name: string }): string` → `device:native:<printerId>`,
  `device:serial:<vendor>:<product>` (or `device:serial:<name>` with no USB ids: m-8), `device:ble:<deviceId>`,
  `device:windows:<name lower-cased>`; `readTextKot(key): { narrow80: boolean } | null`; `writeTextKot(key, value | null)`;
  `subscribeTextKot(onChange)` (the `storage` event and in-page writes); a hook `useTextKot(key)`.
- **Tests:** an absent, unreadable or foreign record reads off; a write round-trips; `null` removes one key only; the v1
  device-printer record is never read or written (a pin over the file's text); keys per printer kind; a printer whose
  connection changed has a new key.

### Task 11: The bridge's text step (§5.2, §5.4, S1, S3, S4)

- **Files:** Create `apps/cafe/lib/printer/kot-text/text-kot-print.ts` (+ test); Modify `apps/cafe/hooks/use-print-host-bridge.ts`.
- **Interfaces (fixed):** `textKotWriteFor(input: { slip: HostPrintSlip; settings; target: SlipPrintTarget | undefined;
  env: TextKotEnv }): { bytes: Uint8Array; write: () => Promise<void> } | null`, where `TextKotEnv` gives (as seams for
  tests) the device printer snapshot, the desktop chosen printer and print mode, `desktopPrintsRaw()`, the store's
  `readTextKot`, and the writers (`devicePrinter().write`, `printerWriter(nativeId)`, `desktopLan().write`,
  `printRawOn`, `slipCodeStatus`). Null unless: the bridge's current item is a job slip (`current.kind === "slip"`, never
  the attestation or a printer's Test print, which `surfaceOf` also puts on the kitchen surface) whose `surface === "kot"`;
  the printer's key resolves (the job's printer → `printer:<id>:<connection>`, else this device's own printer →
  `device:…`); that key is on; the writer exists for that printer here (a Windows printer only with `printRawOn` and the
  Direct method) and the picture path's pre-write rules allow it (a printer another tab owns, or an app with no printer:
  null, and the picture path then refuses with its own sentence, as today: no second refusal path); the slip's template needs no lazy slip code, or it is ready
  (`templateNeedsSlipCode`, `slipCodeStatus() === "ready"`: else the picture prints the legacy ticket and text must not
  differ, the review's I-4); and `kotTextJob` answered ok at `textColumnsOf(paper, narrow80)`, the paper being the job
  target's (printers mode), else the device printer's (simple mode on the app or a browser), else the KOT's paper setting
  (the Windows chosen printer, as Direct mode draws it) (I-1). The bridge's dispatch effect, for a `kot` surface, calls it before `printKot()`; with a result
  it arms the same watchdog, awaits `write()` and settles with `null` or `hostPrintFailureMessage(error)`; with null it
  calls `printKot()` exactly as before. A job slip carries its printer's id: `HostPrintSlip` gains `printerId?: string`,
  set by `printAgentSlipOf` from the leased job (a printers-mode job printed on a bridge v1 app or a browser's printer
  has a printer but no target).
- **Tests:** a slip with its switch off, an unknown key, a bill, a token, a test slip, the attestation slip, an End of
  day, a refused gate, a renderer error and a Kitchen Bold slip while the slip code is not ready all answer null and call
  no writer (S1, S3); the columns follow the paper (80 → 48, the 42 choice, 58 → 32 even with the 42 choice stored); each writer row of §5.4 is called with the text bytes;
  a Windows printer without `printRawOn`, or with the driver method, answers null; a write that rejects settles with the
  same message the picture path would show; copies print text each time. A source pin: the picture files of the Global
  Constraints are byte-identical to `d21ee37` (their SHA-256 pinned).

### Task 12: The Windows printer's raw write, page side (§6)

- **Files:** Modify `apps/cafe/lib/desktop-shell-printer.ts` (`desktopPrintsRaw()`, the `printRawOn` type), its tests.
- **Interfaces (fixed):** `printRawOn(printerName: string, data: Uint8Array): Promise<void>` on `window.posDesktop`
  (2.0.2, Session 4C); feature-detected by `typeof printRawOn === "function"`; its refusals are the shell's own sentences
  (`lib/desktop-shell-messages.ts`, parity-pinned in 4C).

### Task 13: "Fast text KOTs (English only)" in the printer panel (§5.1)

- **Files:** Create `apps/cafe/components/print/TextKotSection.tsx`, `apps/cafe/hooks/use-text-kot-printers.ts`
  (+ a pure `lib/printer/kot-text/text-kot-printers.ts` with its test); Modify `components/print/PrinterSetupCard.tsx`
  (the section after `DevicePrinterSection`), `hooks/use-print-host-bridge.ts` (`queueTextTest(key, bytes)`: the text
  test rides the bridge's busy window like `queueTestSlip`).
- **Behaviour (fixed):** lists each printer this device prints KOTs on (simple mode: its own printer; printers mode: each
  routable printer of the setup this device writes that takes KOTs: stations, a full copy or notices), with its name and
  paper; a switch; on 80 mm "Characters per line: Automatic / 42". Turning on prints `textTestJob` on that printer and
  asks "Did it print clearly, with the ruler on one line?" (Yes → on; No → stays off, with "Keep it off, or try
  Characters per line: 42" on 80 mm); a failed print shows the printer's own error and stays off; turning off is
  immediate. The section's words: the spec §5.1 line. Hidden on a device with no printer it could write raw bytes to.
- **Tests:** the pure list (modes, KOT-taking printers only, a Windows printer only with `printRawOn` and Direct); the
  section's pins (words, the confirm states) in a `*-paths.test.ts` like the other print UI pins.

### Task 14: The not-routed words (§8)

- **Files:** Modify `apps/cafe/lib/print-routing.ts` (`PRINT_JOB_NOT_ROUTED_KOT_MESSAGE = "Nothing to print: every item
  in this round was cancelled."`, `notRoutedMessageOf(kind)`), `hooks/use-host-routing.ts` (both call sites),
  `lib/print-bill-printer.test.ts` (the pin).

### Task 15: End to end on fakes and the emulator

- Headless Chrome with a fake POS app (the Phase 3 harness `pw-3g.mjs` adapted, from `D:\kd\pos-dev-keep`) and the fake
  printer on 9100: (1) every switch off: the same orders print the same bytes as a build of `d21ee37` (the `.bin` files
  compared byte for byte; S1); (2) the switch on through the panel (the text test printed, Yes): a round's KOT, a VOID,
  a TABLE MOVED and a cancel notice arrive as text (`ESC @`, the words, the cut; about 1 KB each); a Hindi item, the logo
  on, a QR line: the same slip as a picture; (3) the size ratio of the same KOT, picture over text, recorded (≥ 10×).
- The emulator (the release APK `29115bdf` from `D:\kd\pos-dev-keep\apk-release`, bridge v1, and the 2.0.1 APK if the
  gate decides): the page on `http://localhost:3110`, the fake printer through `adb reverse tcp:9100 tcp:9100`: the
  switch on, a KOT as text, a reprint labelled REPRINT as text, then off: a picture again; put back as found.

### Task 16: Verification, the fresh review, the Results

As 4A's Task 7, plus: `git diff d21ee37..HEAD -- apps/mobile apps/desktop workers apps/cafe/models apps/cafe/app/api` empty.

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
