# Printing Phase 5 Implementation Plan (offline KOTs and the calm pulse)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task, each task test first
> (superpowers:test-driven-development). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a device cannot reach the server, Send to Kitchen and Pay Now keep the round on the device and print its
KOT at once on the printers this device prints, marked `OFFLINE · O-3`; when the server answers again the round sends
itself under its own key and the server saves the lines printed offline as printed, so nothing prints twice. The 20 s
pulse slows to 60 s on a device while nothing needs it.

**Architecture:** Pure modules in the page (`lib/offline-*.ts`, `lib/pos-pulse-cadence.ts`) decide the offline state,
keep the outbox in localStorage, plan which routed lines print here, and choose the pulse's interval; the page wires
them into the send controller, the print bridge (`queueSlip`) and the pulse (Session 5B). The server learns one optional
body field `offline` on the two order routes and makes a printed or REPRINT job per line from it; the pulse answer says
`offlineReplay: true`; the printers read can carry the stations.

**Tech Stack:** TypeScript (Next.js 15 App Router page + API routes), React 19, TanStack Query v5, zod, Mongoose
(MongoDB Atlas M0), node:test with tsx, the print-host live legs (`npm run verify:print:live`), ESC/POS.

**Spec:** `docs/superpowers/specs/2026-11-03-printing-phase-5-offline-design.md` (approved by the owner on
2026-11-03). Section numbers below (§n, S1–S7, P5-n) are the spec's. Phase 6 has its own spec
(`2026-11-03-printing-phase-6-parallel-design.md`) and no plan yet.

## How this plan runs

The owner's workflow (one phase per session) on the **fast path** (the owner, 2026-11-02: "thoda fast forward karna
hai, but proper smooth and fast working software, without any issue"): three implementation sessions on the branch
`feat/printing-phase-5`, each built test first, one commit per task, a fresh review at its end, then the orchestrator's
check before the next prompt. No gold worktree (none of the risks needs one; the owner is asked before one is made).

| Session | Delivers | Before the next |
|---|---|---|
| 5A | **Exact below.** The server half (the field, the printed / REPRINT / no-token jobs, the replay CAS, `offlineReplay`, the stations read) and every pure page module, wired to nothing on the page. No behaviour a cafe can see changes: no page sends the field yet. | the orchestrator's check; 5B made exact if needed |
| 5B | The page (spec below, fixed interfaces): the send's offline branch, the offline KOT through the bridge, Pay Now, the half-way send, the replay runner, Open tabs, Offline orders, the guards, the header, the kept acks, the calm pulse. | the orchestrator's check |
| 5C | The exit (spec below): fake printers, the emulator, the Windows smoke, the measured pulse, the docs, the final review; then the owner's merge OK. | the owner's merge OK |

Each session ends with: every suite green, a fresh Claude Fable 5.1 review of its range (read-only; on an HTTP 429 wait
for the reset and say so; never switch models silently; resume a cut reviewer with SendMessage), one fix wave, and its
"Session 5X Results" section at the end of this file (commits, RED → GREEN per task, counts before → after, the review
and its rulings, any difference from this plan and why).

## Global Constraints

- Branch `feat/printing-phase-5` from `main` 96520d6. Never on `main`; merge only on the owner's explicit OK; push only
  when the owner says, only with the token store (`GIT_TERMINAL_PROMPT=0`), `origin/main` fetched first.
- **S1:** with the device online every slip's bytes are today's; no file under the S1 43-file pin
  (`PIN (S1)` in `apps/cafe/lib/printer/kot-text/text-kot-print.test.ts`) changes in Phase 5; the slip renderers
  (`components/pos/KOTReceipt.tsx`, `OrderReceipt.tsx`, `components/print/slip/*`, `lib/printer/*`) are not edited.
- **The offline paper (P5-5):** banner exactly `OFFLINE · O-<n>` (the text KOT prints `OFFLINE - O-<n>`), the snapshot's
  `orderId` = `O-<n>`, no `kotNumbers`, no `tokenNumber`; `O-<n>` counts per device per cafe day from 1, `n` ≤ 9999.
- **S3:** only a send made while the state is already offline prints by itself; a half-way send prints only on
  "Print KOT here"; every path that prints without the server has its own test.
- **The field:** `offline: { ref, takenAt, total?, lines: [{ printerId: string | null, part, outcome: "printed" |
  "maybe" | "later" }] }`, at most 24 lines, strict; refused (400) without the request's device id; the answer echoes
  `offline: { ref, takenAtKept }`. The taken time is kept only inside 12 h back / 5 min ahead **and** on the arrival's
  cafe day and slip day (the planning review's C1).
- **The routes stay small:** `app/api/orders/route.ts` (624 lines) and `app/api/orders/[id]/items/route.ts` gain at most
  about ten lines each; every rule lives in `lib/print-offline-*.ts` (files ≤ 300 lines).
- **The pulse (P5-6):** `POS_PULSE` 20 s unchanged; `POS_PULSE_CALM` 60 s; lively on any of the spec §5.11 conditions;
  `PULSE_OWN_SLIP_WINDOW_MS` = 120 000.
- **Storage:** `pos.offline-outbox.v1` (localStorage), at most 300 entries, every write under the Web Lock
  `pos-offline-outbox`; a record that cannot be read is moved to `pos.offline-outbox.v1.bad-<ms>`, never overwritten.
- **Free tier:** no new recurring request; `packages/shared/src/print-budget.test.ts` unchanged; the pulse's own pin is
  `lib/pos-pulse-cadence.test.ts`.
- **Tests:** every new cafe test file goes into `apps/cafe/package.json` `testChain` (one entry per file); every new
  shared test file into `packages/shared/package.json`'s `test` list; every assertion carries a message (a failing
  `assert.ok(x)` without one hangs a big tsx file); live legs in `apps/cafe/scripts/print-host-live/*.ts`, wired in
  `scripts/verify-print-host-live.ts`, run on a fresh `pos_scratch_print_host_5<x>` database (dropped at the session's
  end). Files ≤ 300 lines, tests too.
- **UI (5B):** the owner's HTML language and the U0–U6 rules (WebView 109 safe CSS: no `light-dark()`, no runtime
  `color-mix()`, no `in oklab` gradients, no `mask-image`; the postcss fallbacks; flex buttons `w-full` /
  `items-stretch`; WebView 154's inset; never a native `<select>`; below 1280 px a right panel opens full screen from the
  bottom; 44 px touch; 16 px inputs below 720 px); P1's (no `:has()` on html / body / a page-wide box, no page fade, no
  new poll or `router.refresh` unless designed here).
- **Environment:** `df -h /c /d` first (stop and ask if D: < 1.5 GB); mongod 127.0.0.1:27017 is shared: only
  `pos_scratch_*` databases this session makes; only this project's processes (by PID after checking the command line);
  `NODE_OPTIONS=--max-old-space-size=6144 npx eslint .` for lint; long runs in the background with an until-loop wait.
- Local only: no connector, Artifact or Docs tool, no upload, no deploy, no tunnel. Repo text in English; messages to
  the owner in Hinglish. Commit messages through a scratch file and `git commit -F`, ending with the session's
  Co-Authored-By line.

## Review Focus

1. **A round the server already had prints twice** (the internet drops while the answer is on its way). Pinned in
   Task 4 (`a write with no answer is not offline until the check fails too`), Task 3 (`the replay CAS moves only an
   untried queued job`) and 5B Task 12 (`a half-way send never prints by itself`).
2. **An older server drops the field and prints every line again** (a rollback or an older standby). Pinned in Task 3
   (`the pulse answer says offlineReplay`) and 5B Task 13 (`the runner waits without offlineReplay`).
3. **The setup changed during the outage** (a station moved to another printer, or two printers take one station by
   design). Pinned in Task 2 (`a station printed elsewhere is a REPRINT; a second printer of the same station is new`).
4. **The outbox cannot be read or written** (cleared storage, a full quota, a hand-edited value, a second tab). Pinned
   in Task 5 (`an unreadable record is reported, never overwritten`; `a failed write says so`) and 5B Task 11 (`a send
   whose entry could not be kept prints nothing`).
5. **A calm device misses something that needs it** (a stuck slip, a QR request, its own slip, a realtime drop).
   Pinned in Task 7 (one test per lively condition) and 5C Task 23 (the alarm's measured time on both devices).

## The design round's builder check and the planning review (2026-11-03/04)

**The builder check** (a fresh engineer reading the spec alone) asked six questions. Two were the owner's and he
answered them (P5-9 the taken time, P5-10 O-3 per device); four were ruled by the orchestrator and written into the spec
(§13 rulings 9–12: Fix and send, offline sales Cash / Online / Split only, the session's person, the tab's own number on
a round's Order row).

**The planning review (Claude Fable 5.1, read-only, no HTTP 429):** "Ready to run Session 5A as written: With fixes",
every cited file:line checked against `main` 96520d6 and found right. Every finding was folded in before the spec and
plan commit:

| Finding | Ruling (where) |
|---|---|
| C1 the taken time across the cafe-day boundary carries the next day's numbers (they are drawn at arrival) | Kept only on the arrival's cafe day and slip day, else the server's time + a note (spec §5.9, ruling 13; Task 2 `offlineKeptTime`) |
| C2 a station covered by a printed full copy would print again unlabelled after a setup change | REPRINT (spec §5.9; Task 2's test) |
| I1 a creation that threw left no row; the repair sweep would re-create the KOT unlabelled | No repair marker for an offline round; 503 when no job was made; the replay ensures the round's jobs, then CAS (spec §5.9, ruling 14; Tasks 2–3, BI) |
| I2 the Android app's `app.wake` refreshes the pulse after 20 s, so app devices never go calm | `use-native-host` compares with the current interval (spec §5.11; 5B Task 16; 5C Task 23 measures app devices) |
| I3 the job key holds the order's `_id`, not its `orderId` | `orderObjectId` (Task 3) |
| I4 the create route writes no `kotFiredAt` | Only `createdAt` for a new order; `kotFiredAt[round − 1]` for a round; the timestamps plugin pinned (Task 2) |
| I5 the kitchen order needs `categoryRanks` | Added to `offlineKotOrder` (Task 6) |
| I6 a kept ack retried every 5 s for hours would cost requests | The timer waits while offline (spec §5.10; 5B Task 15) |
| I7 Discard's words were false for a half-way send | Today's "may already have reached" words; Fix and send only after a definite refusal (spec §5.8; 5B Task 14) |
| I8 a printed job could take the line's one direct lease | The verdict before `askingTabOf`; `seen` untouched (spec §5.9; Task 2) |
| I9 the routes are over 300 lines | The routes gain about ten lines; rules in `lib/print-offline-*.ts` (Global Constraints; Task 2 `offlineAskOf`) |
| I10 End of day on another device during an outage closes the day short | The runbook's rule and a warning on the device that holds entries (spec §5.10, §7; 5B Task 15; 5C Task 24) |
| I11 "the network printers its app lists" vs the writer list | Both: `offlineHereIds` (spec §5.3, ruling 15; Task 6) |
| m1 Global Constraints lacked `takenAt` | Aligned |
| m2 notes keyed by a ref that restarts each day | Keyed by the entry's key (Task 5) |
| m3 the check is up to two requests | Said (spec §10) |
| m4 a rollback between the pulse and the send | The answer echoes `offline`; no echo stops the run (spec §5.8–5.9; Tasks 2–3; 5B Task 13) |
| m5 a calm simple-mode host may see a lost nudge's slip 60 s later | Listed (spec §5.11) |
| m6 an offline round's label may be off by one | Runbook note (spec §7; 5C Task 24) |
| m7 the bridge's result type | `printWriteOutcomeOf`; a watchdog abandon is "maybe" (5B Task 11) |
| m8 a sale's replay needs the bill header | `printAgentRequestOptions(true)` (5B Task 13) |
| m9 the printers GET takes no `req` | Added (Task 3) |

Declined to judge by the reviewer (ruled "stands"): Task 0's expected counts (re-measured by Task 0 itself); WebView 109
/ 154 and the Windows `printHtmlOn` offline (5C Tasks 21–22).

**The re-check** (the same reviewer, of the folded rulings): every ruling implemented as the table says and correct
against the code; names consistent across tasks. Verdict "With fixes" for seven new points, all folded before the
commit: N1 the 503 only when creation threw (a rethrow switch with `offline`), never for a round that wants no job;
N2 the runner waits a pulse tick after a miss or a 503; N3 `ensureOfflineRoundJobs` takes the slips (a sale's bill
too); N4 the kept time checks every numbered series' reset; N5 the pins and the file-structure rows; N6 the echo is
stripped before any cache; N7 `our 503 is unreached` in Task 4's test.

## File structure

| File | Session | Responsibility |
|---|---|---|
| `packages/shared/src/offline-kot.ts` (+ test) | 5A | the field's schema and types, `offlineRefOf`, `offlineBannerOf`, the limits |
| `packages/shared/src/schemas/order.schema.ts` (+ its test) | 5A | `offline` on `orderObject` and `addItemsSchema` |
| `packages/shared/src/print-lifecycle.ts` (+ its test) | 5A | `printJobPrintedAtCreation`, `printJobReprintAtCreation` |
| `packages/shared/src/api-client.ts` (+ its test) | 5A | `ApiError.enveloped` |
| `packages/shared/src/query.ts`, `self-order-alert.ts` | 5A | `POS_PULSE_CALM`; `offlineReplay?: true` on the pulse data |
| `apps/cafe/lib/print-offline-jobs.ts` (+ test) | 5A | `offlineVerdictOf`, `offlineLineOfJobKey`, `offlineAskOf`, `offlineKeptTime`, `offlineSaleTotalRefusal` (pure, but `offlineAskOf` reads the request) |
| `apps/cafe/lib/print-offline-replay.ts` | 5A | `ensureOfflineRoundJobs`, `markOfflineRoundPrinted` (the replay) |
| `apps/cafe/lib/print-job-insert.ts`, `print-printer-jobs.ts`, `print-order-jobs.ts`, `slip-numbers.ts` | 5A | the verdict threaded into job creation; no token draw for an offline order |
| `apps/cafe/app/api/orders/route.ts`, `app/api/orders/[id]/items/route.ts` | 5A | read `offline`, pass it on, the replay CAS |
| `apps/cafe/app/api/order-requests/pulse/route.ts`, `app/api/printers/route.ts` | 5A | `offlineReplay: true`; `?stations=1` |
| `apps/cafe/scripts/print-host-live/offline.ts`, `scripts/verify-print-host-live.ts` | 5A | live legs BH, BI |
| `apps/cafe/lib/offline-state.ts` (+ test) | 5A | `reachOf`, `nextOfflineState` |
| `apps/cafe/lib/offline-outbox.ts`, `offline-outbox-schema.ts` (+ tests) | 5A | the outbox record and its operations |
| `apps/cafe/lib/offline-kot-order.ts`, `offline-lines.ts` (+ tests) | 5A | the offline KOT's order; the routed lines and which print here |
| `apps/cafe/lib/pos-pulse-cadence.ts` (+ test) | 5A | `pulseIntervalMs` |
| `apps/cafe/hooks/use-server-reach.ts`, `hooks/use-offline-outbox.ts`, `hooks/use-offline-replay.ts` | 5B | the state, the store under the Web Lock, the runner |
| `apps/cafe/lib/pos-send.ts`, `hooks/use-pos-send.ts`, `hooks/use-pos-tab.ts`, `hooks/use-offline-send.ts` | 5B | the send's offline branch, Pay Now, the half-way send |
| `apps/cafe/components/layout/PrintHostProvider.tsx` | 5B | `queueOfflineSlip` |
| `apps/cafe/components/pos/OfflineOrdersSheet.tsx`, the POS open tabs and table choice | 5B | the list, the chips |
| `apps/cafe/lib/printer/printer-dot.ts`, `components/print/PrinterStatusButton.tsx` | 5B | the offline header |
| `apps/cafe/app/(dashboard)/error.tsx`, `app/global-error.tsx`, `components/lock/ScreenLock.tsx`, `lib/print-ack-store.ts` | 5B | the guards, the kept acks |
| `apps/cafe/hooks/use-pos-pulse.ts`, `components/layout/PosPulseProvider.tsx`, `lib/warm-routes.ts` | 5B | the calm pulse wired |
| `docs/GO-LIVE-CHECKLIST.md`, `apps/mobile/TEST-CHECKLIST.md`, `apps/cafe/lib/go-live-runbook.test.ts` | 5C | the release and the owner's checks |

---

# Session 5A (exact): the server half and the pure modules, wired to nothing

Acceptance: an order request with `offline` makes printed / REPRINT / normal jobs per §5.9 and no token; a replay with
it moves untried queued lines to printed; the pulse answer says `offlineReplay: true`; `GET /api/printers?stations=1`
answers `{ printers, stations }` and the plain read is unchanged; the pure modules pass their tests. No page sends the
field and no page module imports the new files, so nothing a cafe sees changes (S1). Work in `D:\kd\lucifer` on
`feat/printing-phase-5`; single cafe test file: `node --import tsx --test lib/<name>.test.ts` from `apps/cafe`;
single shared file: `node --import tsx --test src/<name>.test.ts` from `packages/shared`.

### Task 0: Baseline

- [ ] `df -h /c /d`; `git status` clean; `git log --oneline -1` = the plan's commit on `feat/printing-phase-5`.
- [ ] Record: cafe `npm test` (chain; expected at 21df25c: 7413 / 7412 pass / 0 fail / 1 skip), cafe `npm run typecheck`
  (0), lint (0 errors), shared `npm test` (expected 1051), and the live legs on a fresh database:
  `MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host_5a npm run verify:print:live` (from `apps/cafe`; expected
  all passed, 0 failed; write the count down). These are the "before" of the Results.

### Task 1: The field and the offline words (shared)

**Files:**
- Create: `packages/shared/src/offline-kot.ts`, `packages/shared/src/offline-kot.test.ts`
- Modify: `packages/shared/src/schemas/order.schema.ts` (`orderObject` :69, `addItemsSchema` :174),
  `packages/shared/src/schemas/order.schema.test.ts`, `packages/shared/package.json` (`test` list)

**Interfaces:**
- Produces: `OFFLINE_LABEL = "OFFLINE"`; `OFFLINE_REF_RE = /^O-[1-9][0-9]{0,3}$/`; `OFFLINE_LINES_MAX = 24`;
  `OFFLINE_TAKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000`; `OFFLINE_TAKEN_MAX_AHEAD_MS = 5 * 60 * 1000`;
  `offlineLineSchema` (strict: `printerId: string(1–64) | null`, `part: string(1–64)`, `outcome: "printed" | "maybe" | "later"`);
  `offlineRoundSchema` (strict: `ref` matching `OFFLINE_REF_RE`, `takenAt` a positive integer (ms), `total` an optional
  number ≥ 0, `lines` ≤ 24); types `OfflineLine`, `OfflineRound`, `OfflineOutcome`; `offlineRefOf(n: number): string`;
  `offlineBannerOf(ref: string): string`; `keptTakenAt(takenAt: number, nowMs: number): number | null` (the taken time
  when inside the window, else null).

- [ ] **Step 1: Write the failing tests** in `offline-kot.test.ts`:
  - `offlineRefOf counts from O-1 to O-9999` — `offlineRefOf(1) === "O-1"`, `offlineRefOf(9999) === "O-9999"`, `0`, `10000`,
    `1.5` and `NaN` throw `RangeError`.
  - `offlineBannerOf joins the word and the number` — `offlineBannerOf("O-3") === "OFFLINE · O-3"`.
  - `the round schema takes printed, maybe and later lines` — a round with `{ printerId: null, part: "-", outcome: "printed" }`,
    `{ printerId: "p1", part: "s1", outcome: "maybe" }`, `{ printerId: "p2", part: "all", outcome: "later" }` parses.
  - `the round schema refuses what it does not know` — refuses `ref: "O-0"`, `"O-10000"`, `"X-3"`, an unknown key on the
    round or a line, `outcome: "no"`, `part: ""`, 25 lines, a missing or non-integer `takenAt`, a negative `total`.
  - `keptTakenAt keeps a time inside the last 12 hours and up to 5 minutes ahead` — now − 12 h → kept; now − 12 h − 1 →
    null; now + 5 min → kept; now + 5 min + 1 → null.
  In `order.schema.test.ts`: `createOrderSchema and addItemsSchema accept an optional offline round` (with and without
  it; the parsed value keeps it) and `addItemsSchema still refuses unknown keys` (a key `offlin` → refused).
- [ ] **Step 2: Run** `node --import tsx --test src/offline-kot.test.ts src/schemas/order.schema.test.ts` from
  `packages/shared` → FAIL (module not found; the schema strips or refuses `offline`).
- [ ] **Step 3: Implement** `offline-kot.ts` (zod, no other import) and add `offline: offlineRoundSchema.optional()` to
  `orderObject` (beside `idemKey`, with a comment: declared because this object is not strict) and to `addItemsSchema`
  (inside the strict object). Add the test file to the `test` list.
- [ ] **Step 4: Run** the two files → PASS; shared `npm test` → 1051 + the new tests, 0 fail.
- [ ] **Step 5: Commit** `feat(print): the offline round field (Phase 5 Task 1)`.

### Task 2: Jobs from an offline round (server)

**Files:**
- Create: `apps/cafe/lib/print-offline-jobs.ts`, `apps/cafe/lib/print-offline-jobs.test.ts`,
  `apps/cafe/scripts/print-host-live/offline.ts`
- Modify: `packages/shared/src/print-lifecycle.ts` (beside `printJobFailedAtCreation` :382) and its test;
  `apps/cafe/lib/print-job-insert.ts:33-105`; `apps/cafe/lib/print-printer-jobs.ts:56-102`;
  `apps/cafe/lib/print-order-jobs.ts:170-238`; `apps/cafe/lib/slip-numbers.ts:111-124`;
  `apps/cafe/app/api/orders/route.ts` (:69, :495, :608-619); `apps/cafe/app/api/orders/[id]/items/route.ts` (:83, :355-366);
  `apps/cafe/scripts/verify-print-host-live.ts`; `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Consumes: Task 1's `OfflineRound`, `OfflineLine`.
- Produces:
  - `type OfflineAsk = { round: OfflineRound; deviceId: string }`
  - `type OfflineVerdict = "printed" | "reprint" | "new"`
  - `offlineVerdictOf(line: { printerId: string | null; part: string; targetDeviceId: string }, ask: OfflineAsk | undefined): OfflineVerdict`
    — `undefined` → `"new"`; the rules of spec §5.9 (exact match printed → printed; exact match maybe → reprint;
    exact match later → new; no exact match while a line with the same station `part` is printed or maybe, or while a
    full copy (`part: "all"`) is printed or maybe → reprint; simple mode `{ printerId: null, part: "-" }` printed or
    maybe with `targetDeviceId !== ask.deviceId` → reprint; otherwise new)
  - `offlineAskOf(req: Request, offline: OfflineRound | undefined): { ask: OfflineAsk | undefined } | { error: Response }`
    — the 400 when the field comes without a device id (the review's I9: the routes call one helper)
  - `offlineKeptTime(takenAt: number, nowMs: number, resetMinutesOf: readonly number[]): number | null` — Task 1's window
    **and** the same `cafeDateString` day and, for **every** numbered series (the bill's, the KOT's and the token's reset
    minutes, `PrintConfig.bill / .kot / .token`, `slip-numbers.ts:16, :49`), the same slip day as `nowMs` (the review's
    C1; the re-check's N4)
  - [shared] `printJobPrintedAtCreation(input: { labels: PrintJobLabel[]; deviceId: string; detail: string; originDeviceId?: string; nowMs: number })`
    → the create fields of a job born `printed` (`status: "printed"`, `printedAt`, `printedBy: deviceId`, the
    `printJobLifecycleInit` fields, `log: [created, printed with detail]`)
  - [shared] `printJobReprintAtCreation(input: { labels: PrintJobLabel[]; originDeviceId?: string; nowMs: number })` → the
    create fields of a queued job with `REPRINT` added to its labels and `uncertainAttempts: 1`
  - `insertPrintJob` input gains `offline?: { verdict: "printed"; deviceId: string; detail: string } | { verdict: "reprint" }`;
    a printed job's ref has `status: "printed"`; neither is ever made leased at creation
  - `createRoutedPrintJobs` and `createOrderPrintJobs` inputs gain `offline?: OfflineAsk`, applied to `kot` requests only;
    in `createRoutedPrintJobs` the verdict is computed **before** `askingTabOf`, and a printed or reprint job never
    touches the per-printer `seen` set (the review's I8: the device's own `later` job on that printer still gets the
    line's direct lease, as today)
  - `allocateOpeningSlips(cfg, round, deps?, opts?: { token?: boolean })` — `token: false` draws no token number
  - the create route: with `offline`, `createdAt` = `offlineKeptTime(...)` when not null (no `kotFiredAt` is written:
    the create route writes none and round 1's fire time is `createdAt` everywhere, the review's I4); a sale (`status:
    "Completed"`) with `offline.total` whose server total differs → 409 "The total is now ₹<server>; this device took
    ₹<device>." (before any number is drawn); the order is not entered in the repair marker (`kotPrintDevices`, :410);
    with `offline`, `createOrderPrintJobs` **rethrows** a creation error instead of swallowing it (today's swallow stays
    for every online request) and the route answers **503** "Saved; its slips are not made yet." (the device sends it
    again and the replay makes them); a round that wants no job (skip-KOT, or nothing routes) answers 200 with no job
    (the re-check's N1: never a 503 loop); the answer echoes
    `offline: { ref, takenAtKept }`. The items route: `kotFiredAt[round − 1]` = the kept time, no repair marker
    (:279), the same 503 and echo. The Mongoose `timestamps: true` of `Order` (and of any model the create writes with
    the order's time, e.g. the ledger) keeps a supplied `createdAt`: pinned by BH.
- [ ] **Step 1: Write the failing tests** in `print-offline-jobs.test.ts`:
  - `no offline round means a new job` — every line → `"new"`.
  - `a line printed offline is printed; maybe is a reprint; later is new` — exact matches for printers mode.
  - `a station printed elsewhere is a REPRINT; a second printer of the same station is new` — offline lines
    `{p1, s1, printed}` + `{p2, s1, later}`: server line `{p2, s1}` → new; offline lines `{p1, s1, printed}` only:
    server line `{p3, s1}` → reprint; server line `{p1, all}` (a full copy) with offline `{p1, s1, printed}` → new.
  - `a station covered by a printed full copy is a REPRINT` — offline `{p2, all, printed}` only: server line `{p1, s1}`
    → reprint (the review's C2).
  - `the kept time is the taken time only on the arrival's day` — `offlineKeptTime`: 3 h back on the same day → kept;
    23:50 taken, 00:10 arrival (another cafe day) → null; across one series' reset minutes while the others agree (a KOT
    series resetting at 06:00, bills at 00:00) → null; 13 h back → null.
  - `a skip-KOT offline round answers 200 and makes no job` and `an offline round whose job creation throws answers 503`
    (a source pin on both routes and a unit test of the rethrow switch in `createOrderPrintJobs`).
  - `a printed job never takes the line's direct lease` — a pure helper or a source pin on `createRoutedPrintJobs`
    (the verdict before `askingTabOf`; `seen` untouched for printed and reprint jobs).
  - `simple mode prints on the asking device only` — `{null, "-", printed}` with target = asking device → printed;
    target another device → reprint; maybe → reprint.
  - `the routes pass the offline round to job creation and refuse it without a device id` — source pins on both
    routes (stripComments): the route reads `data.offline`, answers 400 when it is present and `printIntentOf(req)` is
    null, passes `offline:` into `createOrderPrintJobs`, and the create calls `allocateOpeningSlips` with
    `{ token: data.offline === undefined }`.
  - `an offline sale whose total changed is refused before any number` (a pure `offlineSaleTotalRefusal(serverTotal,
    offline, status): string | null` in `print-offline-jobs.ts`: `null` online, for a round, or when equal to the
    paisa; the sentence otherwise) and a source pin that the create route calls it before `allocateOpeningSlips`.
  - Live leg **BH** also: an order created with a kept `takenAt` 3 hours back has that `createdAt` (Mongoose kept it)
    and no `kotFiredAt`; one 13 hours back gets the server's time; an offline order has no `kotPrintDevices` entry for
    its round, and a sweep (`repairMissingKotJobs`) run on a round whose jobs were removed re-creates nothing.
  - In [shared] `print-lifecycle.test.ts`: `a job born printed carries its printer, time and log` and
    `a reprint at creation adds REPRINT once and counts one uncertain attempt`.
  - Live leg **BH** (`print-host-live/offline.ts`, printers mode with two stations on two network printers and a full
    copy, then simple mode): `createOrderPrintJobs` with `offline` makes printed rows (status, printedBy, log detail
    `offline O-3`, no lease, epoch 0), a REPRINT row (labels, uncertainAttempts 1, queued), normal rows for later
    lines; the repair sweep (`print-repair`) then creates nothing; an order made with `{ token: false }` has no
    `tokenNumber` and its opening slips hold no token.
- [ ] **Step 2: Run** the unit file and shared's lifecycle test → FAIL; the live legs → BH fails (not wired yet: wire it
  first, then it fails on the missing behaviour).
- [ ] **Step 3: Implement** `print-offline-jobs.ts`; the two shared helpers; the `offline` input through
  `insertPrintJob` (the lifecycle spread becomes `failed ?? offlinePrinted ?? offlineReprint ?? direct ?? queued`, with
  `direct` computed only when there is no offline verdict), `createRoutedPrintJobs` (verdict per routed line from the
  line's `printerId`, `part` and writer) and the simple-mode loop in `createOrderPrintJobs` (`printerId: null`,
  `part: "-"`, its `targetDeviceId`); `allocateOpeningSlips`' `opts`; both routes (the 400 sentence: "An offline round
  needs this device's id.").
- [ ] **Step 4: Run** → PASS; cafe chain and shared green; live legs all passed.
- [ ] **Step 5: Commit** `feat(print): jobs from an offline round: printed, REPRINT, no token (Phase 5 Task 2)`.

### Task 3: The replay CAS, `offlineReplay`, the stations read (server)

**Files:**
- Create: `apps/cafe/lib/print-offline-replay.ts`
- Modify: `apps/cafe/lib/print-offline-jobs.ts` (+ test), `apps/cafe/app/api/orders/route.ts` (the replay branch :83-99),
  `apps/cafe/app/api/orders/[id]/items/route.ts` (:107-109), `apps/cafe/app/api/order-requests/pulse/route.ts:66-70`,
  `packages/shared/src/self-order-alert.ts:72-105`, `apps/cafe/app/api/printers/route.ts:13-23`,
  `apps/cafe/scripts/print-host-live/offline.ts`

**Interfaces:**
- Consumes: Task 2's `OfflineAsk`, `offlineVerdictOf`; [shared] `printJobPrintedAtCreation`'s printed fields.
- Produces:
  - `offlineLineOfJobKey(jobKey: string, orderObjectId: string, round: number): { printerId: string | null; part: string } | null`
    — `kot:<orderObjectId>:<round>` → `{ null, "-" }`; `kot:<orderObjectId>:<round>:<printerId>:<part>` → those; anything
    else → null. `orderObjectId` is the order's Mongo `_id` (what `print-queue.ts:41` puts in the key and
    `PrintJob.orderId` holds), never the human `orderId` (the review's I3)
  - `markOfflineRoundPrinted(input: { orderObjectId: string; round: number; ask: OfflineAsk; nowMs: number }): Promise<number>`
    — one `updateOne` per matching job on `{ _id, status: "queued", attempts: 0, epoch }`; returns how many moved; never throws
  - `ensureOfflineRoundJobs(input: { order: unknown; slips: OrderPrintSlip[]; ask: OfflineAsk; intent: NonNullable<ReturnType<typeof printIntentOf>>; queuedBy: string; nowMs: number }): Promise<PrintJobRef[]>`
    — runs Task 2's creation for those slips with the verdicts (existing rows collide on their keys and stay): the
    round's KOT, plus the bill when the request asks to print it and the order is Completed (exactly the create route's
    `printsBillNow`, :349; the re-check's N3); the replay branch calls it, then `markOfflineRoundPrinted` (the review's I1)
  - `PosPulseData.offlineReplay?: true`; the pulse route always answers `offlineReplay: true`
  - `GET /api/printers?stations=1` → `{ printers: PrinterConfig[]; stations: StationConfig[] }`; without it, today's
    array (the handler gains its `req: Request` parameter, the review's m9)
  - a replay answer with the field echoes `offline: { ref, takenAtKept }` as a first answer does
- [ ] **Step 1: Write the failing tests:** `offlineLineOfJobKey reads both key shapes and refuses others` (incl. another
  order's or round's key, a `reprint:` key); source pins `the replay branches call ensureOfflineRoundJobs then
  markOfflineRoundPrinted, only with an offline round` (both routes; the re-check's N5), `the pulse answer says offlineReplay`, `the printers read answers the stations only when
  asked`; live leg **BI**: a round created online-queued, then a replay with `offline` naming its line printed → the
  untried queued job becomes printed (log detail `offline O-3`), a leased one, a printed one and one with an attempt
  stay; a second replay moves nothing; **a round with no jobs is made with its verdicts on the replay, and the sweep
  then makes nothing** (the review's I1).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** The round of a create replay is 1; of a round replay, the index of the key in the order's
  `kotIdemKeys` plus one. The printers route reads the stations with the existing station read (`Station.find`,
  `stationWireOf`).
- [ ] **Step 4: Run** → PASS; every suite green; live legs all passed.
- [ ] **Step 5: Commit** `feat(print): the offline replay CAS, offlineReplay, stations on request (Phase 5 Task 3)`.

### Task 4: The offline state (page, pure)

**Files:**
- Create: `apps/cafe/lib/offline-state.ts`, `apps/cafe/lib/offline-state.test.ts`
- Modify: `packages/shared/src/api-client.ts:22-43` (+ `api-client.test.ts`), `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces:
  - [shared] `ApiError.enveloped: boolean` — true when the answer was the app's JSON envelope; the constructor's fourth
    parameter (default `false`); the helpers set it
  - `type ServerReach = "reached" | "unreached"`; `reachOf(error: unknown): ServerReach` — an `ApiError` of kind
    `"http"`, status < 500 and `enveloped` → reached; anything else → unreached
  - `interface OfflineState { offline: boolean; pulseMisses: number; writeMissed: boolean }`; `ONLINE_STATE`
  - `type OfflineEvent = { type: "browser"; online: boolean } | { type: "pulse" | "write" | "check"; reach: ServerReach }`
  - `nextOfflineState(state: OfflineState, event: OfflineEvent): OfflineState`; `OFFLINE_PULSE_MISSES = 2`
- [ ] **Step 1: Write the failing tests:** `reachOf: our 4xx is reached; a 5xx, a timeout, a network error and a host
  page are not` (incl. a 402 with `enveloped: false`, and `our 503 is unreached` even with our envelope: the re-check's
  N7, which is why the runner backs off, 5B Task 13); `the browser going offline is offline at once`; `two pulses with
  no answer are offline, one is not`; `a write with no answer is not offline until the check fails too`; `any answer
  that reached us is online again`; `the browser coming online stays offline until an answer reaches us`; in
  [shared] `api-client.test.ts`: `an error answer says whether it was our envelope`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; suites green.
- [ ] **Step 5: Commit** `feat(pos): the offline state (Phase 5 Task 4)`.

### Task 5: The outbox (page, pure)

**Files:**
- Create: `apps/cafe/lib/offline-outbox-schema.ts`, `apps/cafe/lib/offline-outbox.ts`,
  `apps/cafe/lib/offline-outbox.test.ts`, `apps/cafe/lib/offline-outbox-order.test.ts`
- Modify: `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Consumes: Task 1's `OfflineLine`, `offlineRefOf`.
- Produces (`offline-outbox-schema.ts`: the zod schema and types; `offline-outbox.ts`: the operations):
  - `OUTBOX_KEY = "pos.offline-outbox.v1"`, `OUTBOX_MAX_ENTRIES = 300`, `outboxBadKey(nowMs: number): string`
  - `interface OutboxEntry { key: string; ref: string; at: number; kind: "create" | "round"; sale: boolean; uncertain: boolean; local: string; orderId: string | null; table: string; body: unknown; shownTotal: number; lines: OfflineLine[]; state: "waiting" | "sending" | "needs-staff"; message?: string }`
  - `interface OutboxNote { key: string; ref: string; text: string; at: number }` — keyed by the entry's `key` (refs
    restart at O-1 each cafe day, so a ref is not unique: the review's m2)
  - `interface OutboxRecord { v: 1; day: string; next: number; entries: OutboxEntry[]; notes: OutboxNote[] }`
  - `emptyOutbox(day: string): OutboxRecord`
  - `readOutbox(storage: Pick<Storage, "getItem">, day: string): { ok: true; record: OutboxRecord } | { ok: false; raw: string }`
    — no value → `ok` with an empty record; a new cafe day → `next` back to 1 (entries kept)
  - `writeOutbox(storage: Pick<Storage, "setItem">, record: OutboxRecord): boolean` — false when `setItem` throws
  - `takeOfflineRef(record: OutboxRecord): { record: OutboxRecord; ref: string }`
  - `addEntry(record, entry): { ok: true; record: OutboxRecord } | { ok: false; reason: "full" }`
  - `patchEntry(record, key, patch: Partial<Pick<OutboxEntry, "state" | "message" | "orderId" | "lines" | "uncertain">>): OutboxRecord`
  - `removeEntry(record, key): OutboxRecord`; `settleCreate(record, local: string, orderId: string): OutboxRecord`
    (every entry of that local order gets the server id)
  - `nextSendable(record): OutboxEntry | null` — the oldest `waiting` entry that is a create, or a round whose
    `orderId` is known
  - `addNote(record, note)`, `removeNote(record, key)`; `offlineRoundsOf(record, local: string): number`
- [ ] **Step 1: Write the failing tests** (`offline-outbox.test.ts`): `an empty storage reads as an empty record`;
  `an unreadable record is reported, never overwritten` (bad JSON, a wrong `v`, an unknown key → `{ ok: false, raw }`);
  `a failed write says so`; `offline numbers count per cafe day` (O-1, O-2, a new day → O-1 again, entries kept);
  `the outbox holds at most 300 entries` (the 301st → `full`, the record unchanged); `patch, remove and notes`.
  (`offline-outbox-order.test.ts`): `rounds of an order made offline wait for its create`; `a create saved fills its
  rounds' order id`; `oldest first`; `a round on a server tab is sendable at once`; `an entry that needs staff is
  skipped, and so are the rounds of its order`; `offlineRoundsOf counts an order's offline rounds`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (pure; no `window`, no lock: the lock is 5B's). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(pos): the offline outbox (Phase 5 Task 5)`.

### Task 6: The offline KOT and its lines (page, pure)

**Files:**
- Create: `apps/cafe/lib/offline-kot-order.ts`, `apps/cafe/lib/offline-lines.ts`, `apps/cafe/lib/offline-kot-order.test.ts`,
  `apps/cafe/lib/offline-lines.test.ts`
- Modify: `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Consumes: Task 1's `offlineBannerOf`, `OfflineLine`; `stampKitchenFlags` (`lib/kitchen-lines.ts:140`), `kotPrintJob`
  (`lib/print-routing.ts:145`), `kotRoundSlip` (`lib/print-host-slips.ts:161`), `routePrintRequest`
  (`lib/print-printer-routing.ts:164`), `printersModeOn` and `resolveStationId` ([shared] `print-printers.ts`).
- Produces:
  - `offlineRoundOf(base: Order | null, earlierOfflineRounds: number): number` — 1 for a new order; else
    `base.kotRounds + earlierOfflineRounds + 1`
  - `offlineKotOrder(input: { key: string; ref: string; round: number; nowIso: string; base: Order | null; body: { customerName: string; tableNo?: string; receiver?: string; notes?: string; items: CreateOrderInput["items"] }; products: ReadonlyMap<string, ProductKitchenFacts>; skipCategoryIds: ReadonlySet<string>; categoryRanks: ReadonlyMap<string, number> }): Order`
    — `categoryRanks` from the categories' `kotOrder`, passed as `stampKitchenFlags`' fourth argument exactly as
    `lib/kitchen-lines-server.ts:58-62` does (the review's I5)
    — `_id: "offline-<key>"`, `orderId`: the base's when there is a base with a server id, else `ref`; the base's lines
    (if any) plus the body's lines at `kotRound = round`,
    stamped by `stampKitchenFlags`, `kotRounds: round`, no `kotNumbers`, no `tokenNumber`; the item mapping as
    `optimisticOrder` (`hooks/use-orders.ts:196-207`) maps a `CreateOrderInput` (that hook file is not changed)
  - `offlineRoutingOf(input: { printers: readonly PrinterConfig[]; stations: readonly StationConfig[]; products: readonly { _id: string; categoryId: string; stationId?: string }[]; categories: readonly { _id: string; stationId?: string }[]; billPrinterId?: string }): PrintRouting | null`
    — null when `printersModeOn(printers)` is false; `itemStations` built with `resolveStationId` exactly as
    `lib/print-routing-context.ts:44-55` builds it
  - `interface OfflineLinePlan { printerId: string | null; part: string; copies: number; request: PrintJobRequest; here: boolean }`
  - `offlineKotPlan(input: { order: Order; round: number; routing: PrintRouting | null; hereIds: readonly string[]; simple: { printsOwnSlips: boolean; canPrintNow: boolean } }): OfflineLinePlan[]`
    — printers mode: every routed line of `kotPrintJob(order, round)`, `here` when its printer is in `hereIds`; simple
    mode: one line `{ printerId: null, part: "-", copies: 1, here: printsOwnSlips && canPrintNow }`
  - `offlineHereIds(input: { ready: readonly string[]; setupNetworkIds: readonly string[]; appConnectedNetworkIds: readonly string[] | null; windowsRaw: boolean }): string[]`
    — spec §5.3 (the review's I11): `ready` ∪ the setup's network printers the POS app reports connected
    (`appConnectedNetworkIds`, bridge v2; null elsewhere) ∪ every setup network printer when `windowsRaw` (the Windows
    app 1.12+); no duplicates
  - `offlineLinesOf(plan: readonly OfflineLinePlan[], outcomes: ReadonlyMap<number, "printed" | "maybe" | "no">): OfflineLine[]`
    — by plan index; `here` and printed → printed, maybe → maybe, `no` or not `here` → later
  - `offlineKotSlip(order: Order, round: number, ref: string): HostKotSlip` — `kotRoundSlip(order, round)` with
    `banner: offlineBannerOf(ref)` and no `kotRoundNumber`
- [ ] **Step 1: Write the failing tests:** (`offline-kot-order.test.ts`) `a new order's offline KOT is round 1 with the
  offline number as its order id`; `a round on a tab counts the tab's rounds and the earlier offline ones`; `skip-KOT and
  the kitchen order are stamped as the server stamps them` (a no-kitchen line is dropped from `kitchenOrderOf`; ranks
  sort); `the slip carries the OFFLINE banner and no ticket number` (`banner === "OFFLINE · O-3"`,
  `kotRoundNumber === undefined`); `the snapshot of an offline KOT passes the strict print schema`
  (`printJobPayloadSchema.safeParse(kotPrintJob(order, round).payload).success`). (`offline-lines.test.ts`)
  `simple mode prints here only when this device prints its own slips and can print now`; `printers mode prints here the
  lines of the printers this device can print now`; `here means the printers it writes and the network printers its
  app reaches` (`offlineHereIds`: a Bar network printer the app lists connected but another device writes → here; one
  it lists disconnected → not; the Windows app → every setup network printer; no duplicates); `the item stations are resolved as the server resolves them`
  (product override, category station, the default); `a station with no printer rides the full copy or the bill
  printer as the server routes it`; `outcomes become printed, maybe and later`; `copies come from the printer's KOT
  copies`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(pos): the offline KOT and its lines (Phase 5 Task 6)`.

### Task 7: The calm pulse's cadence (page, pure)

**Files:**
- Create: `apps/cafe/lib/pos-pulse-cadence.ts`, `apps/cafe/lib/pos-pulse-cadence.test.ts`
- Modify: `packages/shared/src/query.ts:60` (`POS_PULSE_CALM: 60 * 1000` beside `POS_PULSE`), `apps/cafe/package.json`

**Interfaces:**
- Produces: `PULSE_OWN_SLIP_WINDOW_MS = 120_000`;
  `pulseIntervalMs(input: { realtimeTrusted: boolean; offline: boolean; outboxEntries: number; printAttention: number; printJobsForMe: number; openRequests: number; lastOwnSlipAt: number | null; nowMs: number }): number`
  — `REFETCH_INTERVALS.POS_PULSE` (20 s) when any condition of spec §5.11 holds, else `REFETCH_INTERVALS.POS_PULSE_CALM`.
- [ ] **Step 1: Write the failing tests:** `quiet with realtime proven is calm (60 s)`; one test per lively condition
  (`realtime not proven`, `offline`, `an entry waits in the outbox`, `a slip waits`, `a job for this device`, `an open
  QR request`, `this device made a slip 119 s ago` → 20 s, `121 s ago` → 60 s); `the two intervals are 20 s and 60 s`
  (pins the constants).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** PASS. Nothing imports it yet (the pulse is unchanged
  until 5B Task 16; the existing pins that say the pulse never changes stay green in 5A).
- [ ] **Step 5: Commit** `feat(pos): the calm pulse's cadence (Phase 5 Task 7)`.

### Task 8: Verification, the fresh review, the Results

- [ ] Every suite: cafe chain, typecheck, lint; shared; the live legs on a fresh `pos_scratch_print_host_5a2`
  (all passed); `git diff 96520d6..HEAD --stat -- apps/mobile apps/desktop workers` empty; the S1 pin green;
  `print-budget.test.ts` unchanged (`git diff 96520d6..HEAD -- packages/shared/src/print-budget*` empty);
  `grep -rn "offline-outbox\|offline-lines\|offline-kot-order\|pos-pulse-cadence\|offline-state" apps/cafe/{app,components,hooks}`
  empty (nothing on the page imports the new modules yet).
- [ ] A fresh Claude Fable 5.1 review of `<plan commit>..HEAD` (read-only), against this plan and the spec; one fix
  wave (test first); a re-check of the fixes only.
- [ ] Drop this session's scratch databases. Write "Session 5A Results" at the end of this file; commit
  `docs(print): Session 5A Results`. No push unless the owner says.

---

# Session 5B (spec, fixed interfaces): the page

Made exact at the orchestrator's check after 5A if 5A's interfaces moved. Acceptance: on fake printers (headless, the
fake POS app v2) a send while offline prints `OFFLINE · O-1` at once on the printers of §5.3, the cart clears, Open
tabs shows the order, a second round prints `O-2` on the same order; after the server is back the outbox empties by
itself, the server's jobs say printed for those lines, and nothing prints twice. Online, every request and every byte is
today's (the counting proxy and the S1 bytes).

- **Task 10: The state and the store.** `hooks/use-server-reach.ts`: `useServerReach(): { offline: boolean; report(event: OfflineEvent): void }`
  over `nextOfflineState`, fed by the browser's online/offline events (TanStack `onlineManager`), every pulse result
  (`reachOf` of its error, or reached), and the send path (Task 11). `hooks/use-offline-outbox.ts`:
  `useOfflineOutbox(): { record: OutboxRecord | null; unreadable: boolean; update(fn: (r: OutboxRecord) => OutboxRecord): Promise<boolean> }`
  — every read-modify-write under `navigator.locks.request("pos-offline-outbox", …)`, re-read on the `storage` event; an
  unreadable record moved to `outboxBadKey` once and reported ("Some offline orders could not be read: check Open
  tabs"). Tests: the hook's pure parts in `lib/`; source pins for the lock and the event.
- **Task 11: Send to Kitchen and Pay Now offline.** `createPosSend`'s ports gain
  `offline?: () => boolean` and `keepOffline?: (job: SendJob & { key: string }) => Promise<"kept" | "not-kept">`;
  `SendJob` gains `body: unknown` and `shownTotal: number`. In `run`, after the key (pos-send.ts:171): offline →
  `keepOffline` (no request); `"kept"` → the job's `offlineDone` (the cart clears, the toast) ; `"not-kept"` → the cart
  stays and "Could not keep this order on the device." `hooks/use-offline-send.ts` implements `keepOffline`: take the
  number, plan the lines (`offlineKotPlan` over `usePrintersRead` with `?stations=1`, the POS's products and categories,
  `readyPrinterIds()` / `canPrintNow()` / the last pulse's host), **write the entry first**, then print each `here` line
  (`queueOfflineSlip(offlineKotSlip(...))` × copies, from `PrintHostProvider`, which now exposes `queueSlip` as
  `queueOfflineSlip(slip): Promise<"printed" | "maybe" | "no">`, the outcome classified by `printWriteOutcomeOf`
  (`lib/print-write-outcome.ts:103`) from the bridge's `HostPrintResult`; a watchdog abandon is "maybe": the review's
  m7), then store the outcomes (`offlineLinesOf`). `hereIds` = `offlineHereIds(...)` over `readyPrinterIds()`, the
  setup's network printers, the POS app's v2 printer list (connected) and the Windows app's `printRaw` feature. Pay Now:
  the sale body, KOT only, `offline.total` = the total the device took; offline the payment sheet offers Cash, Online
  and Split only and shows promo, reward, points, card, Due, Credit and the customer field as "Needs the internet"
  (spec §5.6); the sheet closes with spec §5.6's words. Every entry carries `takenAt` = the tap's time. Toasts exactly
  spec §5.5. An online send that gets
  no answer reports `{ type: "write", reach: "unreached" }` and refetches the pulse once; that result is reported as the
  `check` (one request, only on a failure). Tests: `a send whose entry
  could not be kept prints nothing`; `the entry is written before the first slip`; `only here lines print`; `Pay Now
  offline prints no bill and no token`; the words.
- **Task 12: The half-way send.** When `useServerReach` turns offline while `PosSend` holds an uncertain send, the held
  send becomes an entry with `uncertain: true` and its lines all `later` (no paper), the notice shows spec §5.7's words
  and the cart is freed. "Print KOT here" (Offline orders, Task 14) prints it with the banner and records its outcomes.
  Tests: `a half-way send never prints by itself`; `Print KOT here records its lines`.
- **Task 13: The replay runner.** `hooks/use-offline-replay.ts`: while online and the last pulse says `offlineReplay`,
  under the Web Lock, `nextSendable` → `sending` → the stored request with its key, `offline: { ref, takenAt, total?,
  lines }` and the print headers of an online send (`printAgentRequestOptions(sale)`: a sale carries the bill header,
  the review's m8) → an answer without the `offline` echo stops the run with spec §5.8's sentence (the review's m4) →
  saved: `removeEntry` (`settleCreate` for a create),
  `followPrintJob` for the answer's refs, a note when a round's answered total ≠ `shownTotal` or the answer says
  `takenAtKept: false` (the answer's `offline` echo is stripped before the order reaches any query cache: the
  re-check's N6); after any miss or a 503 the entry goes back to `waiting` and the runner sends nothing more before the
  next pulse tick (≥ `POS_PULSE`; the re-check's N2: never a tight loop); no answer: stop, report a
  `write` miss; refused (`classifyFailure` definite or conflict): `needs-staff` with the server's message. Never
  `POST /api/print-jobs`. The end toast "Offline orders sent: n". Without `offlineReplay`: entries wait with spec §6's
  sentence. Tests: `the runner waits without offlineReplay`; `oldest first, rounds after their create`; `a refused entry
  waits and the others go on`; `no answer stops the run`; `a replay answer prints nothing on the device`; `a total
  difference becomes a note`.
- **Task 14: The POS shows offline orders.** Open tabs lists each local order with an "Offline · O-n" chip (adding to
  it makes a chained round); the POS's table choice reads its table taken; `components/pos/OfflineOrdersSheet.tsx`
  lists entries and notes (waiting / sending / needs staff + the message; Fix and send: the entry opens in the cart with
  its lines, table and payment, and its send goes under a new key with the entry's `offline` lines and the original
  `takenAt`, then the old entry leaves (an uncertain entry gets Fix and send only after a definite refusal); Send again;
  Discard with spec §5.8's confirm (an uncertain entry not yet answered: today's "may already have reached" words, the
  review's I7); Print KOT here for an uncertain entry; dismiss a note), opened from the chip "Offline orders · n" beside
  the printer
  button. The owner's HTML language and the UI constraints above. Tests: pure view helpers in `lib/offline-orders-view.ts`
  (+ test); a11y with the local `a11y-check.mjs`.
- **Task 15: The guards.** Offline, settle / void / move / cancel / QR accept and reject / reprints / Print bill / End of
  day / setup saves answer "Offline: this needs the internet. Try again once it is back." and send nothing (a void
  dialog stays open); `error.tsx:28` and `global-error.tsx:23` reload only while online; the idle lock check
  (`ScreenLock.tsx:172`) skips while offline; `printerDotOf` gains an `offline-printing` / `offline-keeping` reason before
  `device-offline` with spec §5.10's words (amber); the slip design code is loaded at start on a printing device; the
  ack store (`lib/print-ack-store.ts`) counts its 10-minute window only while online (at most 3 h) and keeps an ack a
  402 refused, and while offline its 5 s retry timer (`lib/print-agent-acks.ts:54-60`) is suspended until the first
  answer that reaches us (the review's I6); End of day on a device whose outbox holds entries shows spec §5.10's
  sentence (the review's I10). Tests per guard (source pins + the pure dot and ack-window functions).
- **Task 16: The calm pulse wired.** `usePosPulse`'s `refetchInterval` becomes `() => pulseIntervalMs({...})` over
  `realtimeTrusted()`, `useServerReach().offline`, the outbox size, the last answer and `lastOwnSlipAt` (set by every
  slip-making write's success and every replay); a change of a local input re-renders `PosPulseProvider` (no request).
  `WARM_LINE_PROOF_MS = 2 * REFETCH_INTERVALS.POS_PULSE_CALM`. The Android app's `app.wake` refresh
  (`hooks/use-native-host.ts:43-47`) compares the pulse's age with the current `pulseIntervalMs` instead of `POS_PULSE`
  (the review's I2: else an app device stays near 30 s). The pins that change on purpose, each with its reason in
  the commit body: `live-poll.test.ts:26, 88-92`, `order-request-paths.test.ts:964-987`, `warm-routes.test.ts:73-75`;
  every other pulse pin stays. The printers read asks `?stations=1` (`use-agent-printers.ts`).
- **Task 17: Verification, the fresh review, the Results** (as Task 8), plus the S1 byte comparison and a first
  headless offline run (Task 20's harness) on this head.

# Session 5C (spec): the exit

- **Task 20: End to end on fake printers** (the measurement harness of the design session,
  `D:\kd\pos-dev-keep\phase5\design-harness\` (README.txt): headless Chrome as the POS app v1 and v2, fake printers
  9101–9104, a counting proxy): every scenario of spec §9 item 2 in both variants (`setOffline`; the server stopped), with the paper,
  the banners, the jobs after the replay, the numbers, the totals and the outbox at the end; and S1: the same online
  orders on a `main` build and on this head, bytes per printer equal (both modes, v1 and v2).
- **Task 21: The emulator** (WebView 109 and 154; the app as found, checked first; Play Store paused; put back as found):
  the server stopped mid-shift, two offline KOTs on the fake printer at 10.0.2.2:9100 (`OFFLINE · O-1`, `O-2`), the
  server back, the replay, the jobs; a page reload while offline shows the app's "Could not open the POS" and the outbox
  is sent once the page opens again.
- **Task 22: The Windows app smoke** (unpackaged, scratch userData): an offline KOT on a Windows printer through
  `printHtmlOn` (fonts) and on a network printer through `printRaw`.
- **Task 23: The calm pulse measured:** 8 devices (headless pages, at least two of them fake POS apps whose `app.wake`
  ticks every 15 s as the print service does) with the fake realtime room, a quiet 30 minutes and a 15-minute rush,
  through the counting proxy: pulses per device per minute, the alarm's time for a stuck slip on the
  device that made it (20–40 s) and on another (≤ 80 s), the projection for 8 devices 12 h (target ≤ 0.35 M pulse
  invocations a month), written into the Results.
- **Task 24: The docs.** GO-LIVE "Existing cafes: the printing Phase 5 release" (spec §7, with its End of day, staff
  and round-label sentences), TEST-CHECKLIST "Phase 5 checks (offline KOTs)" (spec §9 item 6), `go-live-runbook.test.ts`
  pins for both (and the 20-second wording's new sentence).
- **Task 25: Verification, the final fresh review of `96520d6..HEAD`, the Results;** then the owner's merge OK.

---

# Session 5A Results (2026-11-04)

Run on `feat/printing-phase-5` from the plan commit 1608983 (main 96520d6 = origin/main, fetched at the start: not moved).
Not pushed, not merged. Nothing a cafe sees changes: no page sends the field and no page module imports the new files.

## Commits

| Commit | Task |
|---|---|
| 1cf2564 | Task 1 the offline round field (shared) |
| ea0f27a | Task 2 jobs from an offline round: printed, REPRINT, no token; live leg BH |
| c139f95 | Task 3 the replay CAS, `offlineReplay`, `?stations=1`; live leg BI |
| 09cf206 | Task 4 the offline state (+ [shared] `ApiError.enveloped`) |
| abf1e46 | Task 5 the outbox |
| 18e35c9 | Task 6 the offline KOT and its lines |
| c753e7a | Task 7 the calm pulse's cadence (+ [shared] `POS_PULSE_CALM`) |
| 406786c | the review's fix wave (I1, I2, m4) |
| (this) | docs: these Results |

Tasks 1–3 were built by the session itself; Tasks 4, 5, 7 (one implementer) and 6 (another) were written by implementers
told the plan's task text and Global Constraints (no servers, no network, no git writes), then reviewed line by line and
committed one per task; the changes made at that review are listed per task.

## RED → GREEN per task

| Task | RED (seen first) | GREEN |
|---|---|---|
| 1 | `offline-kot.test.ts`: module not found | 7 new shared tests (the two order-schema tests live here: `order.schema.test.ts` is already 374 lines) |
| 2 | `print-offline-jobs.test.ts`: module not found, then the route pins; `print-lifecycle-offline.test.ts`: no export; the token test failed with `slip-numbers.ts` stashed | 13 cafe + 2 shared; BH 15/15 — and BH with every verdict forced to "new" failed 7 of its checks |
| 3 | `print-offline-replay.test.ts`: no export (6 fail); `planOfflinePrinted`: no export | 6 cafe + 1 shared; BI 11/11 — and BI with the CAS returning 0 and a pass-through answer failed 6 |
| 4 | module not found; `enveloped` undefined | 6 + 1 shared; at review, a reached write or pulse resets the whole state (test changed first: RED 1, then GREEN) |
| 5 | module not found | 13; at review, `.bad-<ms>` (RED 1 → GREEN) and `offlineRoundsOf` counts rounds only (RED 1 → GREEN) |
| 6 | modules not found | 14; at review, `offlineLineSlip` (RED 1 → GREEN) and a round keeps its tab's `createdAt` (RED 1 → GREEN) |
| 7 | module not found | 9 |
| fix wave | 3 RED (I1, I2, m4) | 3 GREEN |

## Counts (before at 1608983 → after)

| Suite | Before | After the 7 tasks (c753e7a) | After the fix wave |
|---|---|---|---|
| cafe `npm test` (chain) | 7413 / 7412 pass / 0 fail / 1 skip | 7474 / 7473 / 0 / 1 | 7477 / 7476 / 0 / 1 |
| cafe typecheck | 0 | 0 | 0 |
| lint (`npx eslint .`) | 0 errors, 2 warnings | 0 errors, the same 2 warnings | 0 errors, the same 2 warnings |
| shared `npm test` | 1051 | 1062 | 1062 |
| shared typecheck | 0 | 0 | 0 |
| live legs (`verify:print:live`) | 473 / 0 (`pos_scratch_print_host_5a`) | 499 / 0 (`pos_scratch_print_host_5a2`) | 499 / 0 (`pos_scratch_print_host_5a3`) |

Scope at c753e7a: `git diff 96520d6..HEAD --stat -- apps/mobile apps/desktop workers` empty; `packages/shared/src/print-budget*`
empty; `apps/cafe/components` and `apps/cafe/lib/printer` empty (no slip file; the S1 43-file pin green); the grep for the new
page modules under `apps/cafe/{app,components,hooks}` empty. Every new code file ≤ 300 lines (`print-order-jobs.ts` is at 300).

## Differences from the plan, and why

1. **`offlineAskOf` lives in `lib/print-offline-replay.ts`**, not `print-offline-jobs.ts`: job creation imports
   `print-offline-jobs.ts`, and `offlineAskOf` needs `printIntentOf` from `print-order-jobs.ts`; one file each way avoids an
   import cycle. `print-offline-replay.ts` also holds `offlineSlipsUnmade` (the 503) and `offlineReplayAnswer`.
2. **The replay runs the CAS before `ensureOfflineRoundJobs`** (the plan said ensure, then CAS): the answer's jobs then say
   each row's real state (with ensure first, a collided row reads "queued" and the CAS then moves it, so the answer would
   name a printed job as queued), and a row moved to printed no longer holds its printer's line for the direct lease. Both
   orders converge on the same rows.
3. **`markOfflineRoundPrinted` throws a DB error** (the plan said "never throws"): the replay then answers 503 and the
   device sends again. A swallowed error would let an untried queued job of a line printed offline print again,
   unlabelled (S3).
4. **Every 200 replay answer to a request with the field** goes through `offlineReplayAnswer`, the twins' late replays
   too (the create route's `lateReplay`, the items route's new `lateRound`), so no answer from this server lacks the echo
   (m4). The replay answer carries `printJobs` (a job made leased to the asking tab must be named, or it waits for its lease
   to expire).
5. **Coverage rules beyond the plan's list** (all pinned): simple mode's whole ticket (`"-"`) printed or maybe covers every
   station line and every full copy; any line printed or maybe makes a server simple-mode ticket a REPRINT; a full copy
   printed or maybe on another printer makes a server full copy a REPRINT (the review's I1). A full copy stays its own
   paper after station lines (the plan's test). A setup switched during an outage never prints unlabelled twice.
6. **`offlineLineSlip(line, ref, todayKey)`** (Task 6, new): each printers-mode line prints its own routed station slip
   through `hostPrintSlipOf` (spec §5.4), with the banner and no number box; `offlineKotSlip` alone would print the
   whole round on every station's printer. Simple mode's one line gives today's round KOT.
7. **`offlineKotOrder` keeps the tab's `createdAt` for a round** (every KOT prints `order.createdAt` as its Time; an
   online round's KOT prints the tab's open time). A new order is taken now.
8. **`offlineRoundsOf` counts rounds only** (the create is round 1 of the order the next round is built on), so
   `offlineRoundOf(base, offlineRoundsOf(record, local))` numbers the next round as the server will for a server tab and for
   an order made offline alike.
9. **`nextOfflineState`: any answer that reached us resets the whole state** (a pulse miss, then a write that reached
   us, then a miss is not "two in a row").
10. **`outboxBadKey` = `pos.offline-outbox.v1.bad-<ms>`** (the Global Constraints).
11. **The lifecycle tests are in `print-lifecycle-offline.test.ts`** (`print-lifecycle.test.ts` is 407 lines).
12. **Pins changed on purpose** (each with its reason in its commit): the opening slip draw call (order-availability-paths,
    skip-kot-paths, write-route-paths), `createOrderPrintJobs`' catch / first slip / insert spread (print-order-jobs.test,
    print-printer-jobs.test), the `kotPrintDevices` pins, the replay / late replay needles (order-availability-paths,
    write-route-paths, reward-card-paths), the opening-slip sites (print-token-jobs: + `print-offline-replay.ts`), and the
    create route's line cap (reward-points-paths: 627 → 635; the route grew 624 → 634 lines, the plan's "about ten").

## The review (Claude Fable 5.1, read-only, no HTTP 429)

Range 1608983..c753e7a, against this plan and the spec. Verdict **"With fixes"**: 0 Critical; online behaviour traced
line by line and found unchanged without the field; S3/S4 guarded on every path traced; rulings 1–12 and 14 of the ledger
agreed, ruling 13 "mildly disagree".

| Finding | Ruling |
|---|---|
| I1 a full copy printed offline did not cover a server full copy on another printer (the pass printer moved) | **Fixed** test first (406786c): REPRINT; two full-copy printers by design stay new (the device names both) |
| I2 an entry left "sending" by a page that died was never sent again | **Fixed**: `resumeSending(record)`; 5B's runner applies it when it takes the lock, before `nextSendable` |
| m1 a "maybe" line's untried queued job on a replay prints unlabelled | **Not taken in 5A** — spec §5.9 moves only printed lines and a relabel needs a log event the lifecycle has not got; open for the orchestrator / owner (the case is spec §5.7's warned one: the OFFLINE copy is the labelled paper) |
| m2 `takenAtKept: false` on a half-way send's replay is a misleading note | 5B: no taken-time note for an `uncertain` entry |
| m3 `OFFLINE_LINES_MAX` 24 is below what the setup caps allow | Kept (the plan's constant; real cafes route ≤ 6 lines); 5B refuses an offline send whose plan has more lines, before any paper |
| m4 `addEntry` kept a duplicate key | **Fixed**: `{ ok: false, reason: "duplicate" }` |
| m5 `offlineAskOf` re-reads the headers | Stands (the plan's interface; pure header reads) |
| m6 two spellings of "has the field" in the create route | Stands (equivalent by the 400; changing it re-touches three pinned call texts) |
| m7 the plan is stale for 5B in places | The 5B amendments below and the 5B prompt |
| m8 the route-level offline answers are pinned by source only | 5C Task 20 drives them over HTTP on fake printers |
| Ruling 13: a round on an order made offline prints its own O-n in the Order row | **The owner's call** (it is the paper): the reviewer recommends the create's O-n (the banner keeps the round's own); one line and one assertion |

Re-check of the fix wave (406786c) by the same reviewer: I1, I2 and m4 **ADDRESSED**, no new breakage, none of the
rulings above unsafe; verdict **"Ready to merge: Yes"** for 5A's range, with two notes for 5B (both in the amendments
below): `resumeSending` under the lock before `nextSendable`, and `addEntry`'s "duplicate" handled as "already kept".

## 5B amendments (where 5A's interfaces moved; the 5B prompt carries them)

- Task 11 prints each `here` line with `offlineLineSlip(line, ref, cafeDateString())` × `line.copies` (not
  `offlineKotSlip`); an offline send whose plan has more than `OFFLINE_LINES_MAX` lines is refused before any paper; a
  `takeOfflineRef` throw (past O-9999) must not crash the page; `addEntry`'s "duplicate" means "already kept" (no second
  paper, no second toast), never a storage failure.
- Task 13: under the lock, `resumeSending` first, then `nextSendable`; the replay answer carries `printJobs` (follow
  them) and `offline: { ref, takenAtKept }` (strip it before any cache; no taken-time note for an `uncertain` entry); our
  503 (`Saved; its slips are not made yet.`, or a replay that could not finish) is unreached: back off a pulse tick.
- Task 10 / 14: `offlineRoundOf(base, offlineRoundsOf(record, local))` — for an order made offline, `base` is its create's
  offline order (kotRounds 1); Open tabs shows a new offline order's total from its entry's `shownTotal` (its order object
  carries placeholder money).
- `nextOfflineState` ends offline on any reached answer (pulse, write or check).
- The server: `offlineAskOf`, `offlineSlipsUnmade`, `offlineReplayAnswer`, `markOfflineRoundPrinted` (throws),
  `ensureOfflineRoundJobs` in `lib/print-offline-replay.ts`; `offlineKeptAt`, `withOfflineEcho`, `offlineInsertOf`,
  `offlineDetailOf`, `offlineTakenAtKept`, `offlineLineOfJobKey` beside the plan's names in `lib/print-offline-jobs.ts`.

## Scratch databases

Every live run of this session dropped its own database (the runner drops at its start and end): `pos_scratch_print_host_5a`,
`_5a_t2`, `_5a_red`, `_5a_t3`, `_5a_t3b`, `_5a_red2`, `_5a_t3c`, `_5a2`, `_5a3`. None of them is left (checked). The design session's `pos_scratch_e2e_4g_p5m`
is still there: its drop was refused by this PC's permission system again (the owner may drop it).

---

# Session 5B Results (2026-11-04)

Run on `feat/printing-phase-5` from 5ce04ee (5A's Results). `origin/main` had moved to 3ec96f1 (the owner's T1 table
charge after a move + C1 copy an item, 5 commits); on the owner's OK at the start it was merged first (c41dc30, clean).
Not pushed, not merged. The owner's answers at the start: ruling 13 = (b) (a later round on an order made offline prints
its create's O-n in the Order row; the banner keeps the round's own O-n: built in Task 11); 5A review m1 = no (spec as
written).

## Commits

| Commit | Task |
|---|---|
| c41dc30 | merge of origin/main 3ec96f1 (the owner's OK) |
| 55d00bf | Task 10 the offline state and the outbox store on the page |
| b828ec1 | Task 11 Send to Kitchen and Pay Now offline (+ ruling 13 (b), the printers read with `?stations=1`) |
| 9ab5e2e | Task 12 the half-way send parked once offline, Print KOT here |
| fb51993 | Task 13 the offline replay runner |
| bbbc331 | Task 14 the POS shows offline orders, Offline orders, Fix and send |
| 3bdc019 | Task 15 what waits offline, the reload and the idle lock, the kept acks |
| 901bb2d | Task 16 the calm pulse wired |
| 2b73005 | the review's fix wave (C1, I1, I2, I3 + minors) |
| (this) | docs: these Results |

Every task was built by the session itself (no implementer subagents: each task wires page code that needed the whole
picture), test first; each commit body lists its RED, its GREEN and every pin changed on purpose with its reason.

## RED → GREEN per task

| Task | RED (seen first) | GREEN |
|---|---|---|
| 10 | both modules not found; the 3 wiring pins failed | 14 tests |
| 11 | offline-send / offline-keep / offline-here not found; 5 controller tests and the ruling 13 assertion failed; the wiring pins failed | cafe 7538 (0 fail) |
| 12 | 3 controller park tests, the uncertain plan test and both Print KOT here tests failed | 62 related tests |
| 13 | tsc "Cannot find module '@/lib/offline-replay'"; mutation runs (no echo check, no resumeSending, a refusal that stops the run, a time note for a held order, a printing entry sent): each failed 1 | 8 runner tests + pins |
| 14 | the view / fix modules written with their tests: mutation runs (the taken table, Print KOT here, the held-send discard words, a sale listed as a tab, Discard without its rounds): each failed 1; the full suite caught 2 inventory pins (fixed without touching them) | 17 + the full suite |
| 15 | print-ack-offline 3 of 4 failed; guard rules by mutation (4 runs, each failed 1) | the full suite |
| 16 | tsc "Cannot find module '@/lib/pulse-cadence-now'" | cafe 7580 (0 fail), live 499/0 |
| fix wave | 9 new tests failed first (C1 2, I1 1, I2 1, I3 2, minors 3) | cafe 7590 (0 fail), live 499/0 |

## Counts (before at c41dc30 → after)

| Suite | Before (c41dc30) | After Task 16 (901bb2d) | After the fix wave |
|---|---|---|---|
| cafe `npm test` (chain) | 7496 / 7495 pass / 0 fail / 1 skip | 7580 / 7579 / 0 / 1 | 7590 / 7589 / 0 / 1 |
| cafe typecheck | 0 | 0 | 0 |
| lint (`npx eslint .`) | 0 errors, 2 warnings | 0 errors, the same 2 warnings | 0 errors, the same 2 warnings |
| shared `npm test` | 1062 | 1062 | 1062 |
| shared typecheck | 0 | 0 | 0 |
| live legs (`verify:print:live`) | 499 / 0 (`pos_scratch_print_host_5b0`) | 499 / 0 (`_5b16`) | 499 / 0 (`_5bfw`) |

Scope: no diff under `apps/mobile`, `apps/desktop`, `workers`, `packages/shared` (5B changed no shared file),
`print-budget*`; no slip file (`components/pos/KOTReceipt.tsx`, `OrderReceipt.tsx`, `components/print/slip/*`,
`lib/printer/*` except one test pin, `lib/printer/print-gating-paths.test.ts`); the S1 43-file pin green.
`hooks/use-pos-tab.ts` stays 546 (its budget pin), `app/(dashboard)/pos/page.tsx` untouched (299).

## Differences from the plan, and why (the session's rulings)

1. **The offline state and the outbox are module-level stores** (`lib/server-reach.ts`, `lib/offline-outbox-store.ts`)
   with thin hooks: one page per tab, every reader (the send, the pulse, the header, the runner, the sheet) shares one
   state, and no provider has to sit above all of them.
2. **Pulse misses are counted once per tick** (`errorUpdateCount` / `dataUpdatedAt`), not per retry attempt (spec 5.1's
   "two pulses in a row"); the null error after a recovery is no miss (the review's I1).
3. **An offline entry keeps its here lines as "maybe" until their paper is known**, then stores printed / maybe / later:
   a page that dies mid-print leaves a labelled REPRINT, never an unlabelled second KOT; the replay waits for an entry whose
   paper is still printing (`offlinePrinting`).
4. **Without Web Locks** (an http page that is not a secure context, e.g. the emulator's 10.0.2.2) the outbox's
   read-modify-writes run on an in-page queue (one tab), and the replay on the runner's own guard.
5. **The printers read moved to `?stations=1` in Task 11** (the plan's Task 16 line; Task 11 needs the stations): the cache
   entry is `{ printers, stations }`; an older server's array answer reads as no stations; the two direct cache readers use
   `printersOfRead`.
6. **`SendJob.offline` is one facts object** `{ body, shownTotal, base, done }` (the plan's `body`, `shownTotal`,
   `offlineDone`). The controller also gets `onAnswer` (each online answer feeds the state; a miss is checked once by a
   pulse refetch: `reportWriteAnswer`).
7. **A round on an order made offline is kept even online**, with no paper ("Round O-n is kept on this device. It is sent
   with its order."): it is never posted to an id the server does not know. One whose order is no longer in the outbox is
   refused ("This order is no longer on this device. Open it again from Open tabs.").
8. **New sentences beyond the spec's** (all plain, all pinned): a plan with no kitchen line ("Offline: order O-n is kept on
   this device. It is sent when the internet is back."), Pay Now with nothing printing here ("… The sale is saved and its KOT
   and bill print when the internet is back."), a here line that did not print ("Offline: KOT O-n did not print on Bar. It
   prints there when the internet is back.", the review's I3), the parked send's notice is spec 5.7's, an order made offline
   waiting ("This order is still waiting to be sent. Try again once it is sent."), Fix and send over an open send ("A send is
   still open on this POS. Tap Send again or Discard first, then Fix and send.", the review's I2), the sheet's sub line and
   row statuses, "Nothing to print here for this order.", End of day's singular form.
9. **Pay Now offline**: Cash / Online / Split; the points row locked; no customer picker; a note; a mode chosen before the
   outage blocks the confirm (no second `setMode`: the pin "reset only as it opens" kept). A promo, reward or card chosen
   online rides the sale body and the server decides at the replay (a refusal → Fix and send): the cart's promo / reward /
   card controls are unchanged in 5B (a narrowing of spec 5.6's "shown as Needs the internet"; the review agreed).
10. **The replay holds a second Web Lock, "pos-offline-replay"** (taken only if free), across the send; the outbox lock is
    taken per read-modify-write, so an offline keep never waits behind a replay request.
11. **The runner follows the answer's refs** (`deliverLeasedJob` / `kickPrintAgent`) without the readback chip, and reads the
    pulse from the query cache at each tick (no new `usePosPulseContext` reader: the inventory pin stays eight).
12. **Server tabs with pending offline rounds are not overlaid in Open tabs** (their rounds show in Offline orders); an
    order made offline is listed (its rounds' lines, the total it showed last) and its table reads taken. A parked (uncertain)
    create is listed too (spec 5.7 warns; a "may be on the server" chip is left for 5C to judge).
13. **Discard of an order made offline takes its rounds**; Fix and send opens the entry in the cart (a round on a tab the POS
    still lists opens on that tab, otherwise as a new order with its table) and arms the next send in the send hook (online
    only, a new key, the entry's offline lines and taken time; a reset disarms; never kept or parked while armed; refused
    while a send is flying or held).
14. **The guards are each write's `onMutate`** (settle, move, cancel, QR accept / reject, every client-started slip,
    printer / station saves and deletes, a test print): TanStack never calls the mutationFn, each mutation's own error path
    says spec 5.10's words; the refusal is an un-enveloped 400 (definite, never read as reached). The void refuses in its
    confirm (its dialog stays open).
15. **End of day is blocked, not only warned, while the outbox holds entries** (its figures would miss them; the review
    agreed).
16. **The offline header**: the button's name says "Offline — KOTs print here" / "Offline — orders are kept on this device"
    with the warn dot (the tone value "red" draws the warn, amber, class: `PrinterDotTone` has no amber and
    `lib/printer/*` is not edited); spec 5.10's longer sentence is the Offline orders line. The panel's status card is
    unchanged.
17. **The slip design code is already loaded at start on every device** (the one bridge in the shell starts its fetch on
    mount): pinned, no code change.
18. **Kept acks**: a 402 keeps an ack online too (the spec's rule); the outage is not counted from whichever comes first,
    the first offline flush or the first offline retry (the review's minor).
19. **Line budgets**: `use-pos-tab.ts` held at 546 (4 comment blocks rewrapped), `pos/page.tsx` untouched at 299,
    `lib/pos-send.ts` at 300, `PaymentModal.tsx` 297. Pre-existing files already over 300 grew by their guard lines only:
    `ScreenLock.tsx` 427 → 429, `hooks/use-orders.ts` 394 → 398, `hooks/use-print-agent.ts` 335 → 337 (and two test files).
20. **No implementer subagents**: every task wires page code across the send, the bridge, the pulse and the shell; the
    session built each itself, test first, and the review was the fresh eye.

## The S1 byte comparison and the first headless offline run

**S1, end to end** (the 4B gate's tools: fixed payloads posted as this device's own slips, printed by the page's agent
on the fake printer 9100; `D:\kd\pos-dev-keep\phase5\session-5b\s1.sh`, `s1.log`): the base build `D:\kd\u6b`
(21df25c = main 96520d6 before Phase 5) against a build of 901bb2d (a worktree `D:\kd\u5b`, its build-only cache-off
edit uncommitted, removed junction-safe afterwards), fresh databases, port 3171. **Simple mode on bridge v1: 9/9 slips
byte for byte equal; printers mode on bridge v2: 9/9 byte for byte equal** (KOT round 1 56,414 B, round 2 46,686 B, the
whole tab 60,662 B, VOID 53,310 B, TABLE MOVED 34,150 B, the cancel notice 61,022 B, the bill 51,654 B, the token 31,414
B, the Hindi KOT 56,414 B; the same hashes on both builds). The fix wave (2b73005) touched no online print path.

**The first headless offline run** (the design harness, `pw-5b.mjs` = `pw-5m.mjs` + an `m3` step; `o1.sh`, `o2.sh`,
`o1b.log`, `o2.log` in `D:\kd\pos-dev-keep\phase5\session-5b\`): headless Chrome as the POS app (bridge v2), printers
mode with Kitchen / Bar / Desserts on network printers 9101–9103 and a bill printer 9104, all on this device, against the
901bb2d build:
- **m3 (the plan's acceptance)**: offline (`setOffline`), a new order on T-8: "Offline: KOT O-3 printed here. It is sent
  when the internet is back.", the Kitchen slip at +667 ms, the cart cleared; Open tabs listed "Table T-8 … ₹200 · Offline ·
  O-3"; a second round on it from Open tabs: "Offline: KOT O-4 printed here.", the Bar slip at +620 ms. Back online the
  outbox emptied by itself in 1.0 s; the server holds ONE order on T-8 with 2 rounds (KOT numbers 3, 4; its createdAt the
  tap's time); both KOT jobs were made printed ("printed (offline O-3)", "(offline O-4)"); **no paper after the
  reconnect** (2 slips in all).
- **m2 route (the server down mid-send: a half-way send)**: "Couldn't confirm" at once, parked within 2 s ("Saved on this
  device. It is sent by itself when the internet is back — it can never go through twice."), the header "Offline — KOTs
  print here", **no paper while down**; healed: "Offline orders sent: 1" at +3.1 s, the KOT printed once on Kitchen and
  Bar (the first try had never reached the server), no duplicate KOT number.
- **m2 pay (Pay Now offline)**: "Offline: KOT O-2 printed. The sale is saved and its bill prints when the internet is
  back.", Kitchen +669 ms, Bar +1,231 ms; healed: "Offline orders sent: 1" at +1.0 s, the sale Completed (order number 1),
  its two KOT jobs made printed (no second paper), the bill printed at +660 ms on the bill printer; no duplicate.
- Not run in 5B (5C Task 20): the server-stopped variant, a waiter phone, a refused entry and Fix and send, a reload while
  offline, bridge v1, and the a11y check of the sheet.

## The review (Claude Fable 5.1, read-only)

Range c41dc30..901bb2d, against the spec, this plan (5B + the 5A amendments) and the session's 15 rulings (all judged
sound). Read in four passes; nothing run. Verdict **"With fixes"**: S3 held on every path traced; online behaviour traced
unchanged at every touched site.

| Finding | Ruling |
|---|---|
| C1 a lone entry a dead page left "sending" never woke the runner (the hook's gate saw waiting entries only), so no Discard, End of day blocked | **Fixed** test first (2b73005): `replaySendable` = `nextSendable(resumeSending(record))` |
| I1 after a recovery the null error counted as a pulse miss (the next single miss went offline) | **Fixed**: `pulseErrorReach` (null for a cleared error) |
| I2 Fix and send replaced a send flying or held on the POS without its confirm | **Fixed**: refused while `send.isLocked()`, with its words |
| I3 "KOT O-n printed here" was said before the paper and a line that did not print was never named | **Fixed**: the missed lines named once the paper is done (keep and Print KOT here) |
| m the "red" tone value for amber; the unused header detail | The detail dropped (the sentence is the Offline orders line); "red" draws the warn (amber) class: stands (no `lib/printer/*` edit) |
| m pre-existing >300-line files grew | Stands: guard lines only (Differences item 19) |
| m the sheet mounted the menu / printers observers on every page | **Fixed**: the list mounts with the open panel only |
| m the total note compared floats | **Fixed**: in paise |
| m an ack first kept offline counted the outage | **Fixed**: `retryLater`'s offline branch |
| m a waiter phone's Pay Now words; "sent already" for a discarded order | **Fixed**: the sale's words; "no longer on this device" |
| m a parked create listed while it may be on the server | For 5C (a chip variant to judge on the emulator) |
| m Print KOT here of a round whose tab is not listed lost its table | **Fixed**: the entry's table |

Declined to judge by the reviewer (ruled "stands"): the 5A server half (reviewed in 5A); WebView 109 / 154 and the
Windows app (5C Tasks 21–22); the S1 and offline runs (done here, above); the measured pulse (5C Task 23); the sheet's
visual values and the a11y run (5C Task 20); suite counts (run here); the slip day of the outbox's number reset (5A).

**The re-check** (the same reviewer, of 2b73005): C1, I1, I2, I3 **ADDRESSED**, the minors taken all correct, the three
not taken fine; no new Critical or Important; verdict **"Ready to merge: Yes"** for c41dc30..2b73005. Its three one-line
minors: the panel fragment's indentation (cosmetic, lint clean: stands); "did not print on X" is also said for a "maybe"
line, whose server copy is a REPRINT (wording: for 5C to judge with the owner's eye); without Web Locks a second tab could
resume a lone "sending" entry while the first tab's request is on the wire (the same key: the server answers a replay,
never a second order; stands).

## For 5C

- Task 20: start from `D:\kd\pos-dev-keep\phase5\session-5b\` (README.txt): the S1 run is done for v1/v2 on fixed
  payloads (repeat it on 5C's head); the offline scenarios left: the server stopped (not `route`), a waiter phone with no
  printer, a refused entry with Fix and send / Send again / Discard, Print KOT here after a half-way send, a reload while
  offline then online, bridge v1, two tabs (Web Locks), the local `a11y-check.mjs` on the Offline orders sheet and the
  payment sheet's offline note.
- Judge on the emulator: the parked create listed in Open tabs while it may also be on the server (a "may be on the
  server" chip?), and whether the amber dot reads right on the warn class.
- The owner's pending words: none of 5B's new sentences changes the paper; they are listed in "Differences" item 8.

## Scratch databases

Every live run dropped its own database (the runner: `pos_scratch_print_host_5b0`, `_5b16`, `_5bfw`). The e2e databases
`pos_scratch_e2e_4g_5ba1`, `5bb1`, `5bpa`, `5bpb`, `5bo`, `5bo2` are LEFT: their drop was refused by this PC's permission
system (as the design session's `pos_scratch_e2e_4g_p5m`); the owner may drop them. The build worktree `D:\kd\u5b` is
removed (384 junctions deleted first; the real `node_modules` unchanged).

---

# Session 5C Results (2026-11-04)

Run on `feat/printing-phase-5` from 528cd46 (5B's Results); `origin/main` still 3ec96f1 at the start (nothing to merge).
Not pushed, not merged. Tools and logs (scratch, never in the repo): `D:\kd\pos-dev-keep\phase5\session-5c\` (r1–r5.log,
s1.log, out5c-results\, emu\, win\, pulse-run.sh / pulse-5c.mjs).

## Commits

| Commit | Task |
|---|---|
| 5085d53 | Task 24 GO-LIVE "Existing cafes: the printing Phase 5 release", TEST-CHECKLIST "Phase 5 checks (offline KOTs)", the pins (`lib/go-live-runbook-phase5.test.ts`) |
| 93c2383 | Task 20 fix: while the browser says offline, a late answer keeps the device offline |
| cf113d4 | Task 20 fix: a refused replay reads the POS's lists again, so Fix and send opens a closed tab's round as a new order |
| 84ec1e2 | the review's fix wave (I1 a Discard racing a send, I2 Fix and send over unsent lines, m3's doc part) |
| (this) | docs: these Results |

## RED → GREEN per task

| Task | RED (seen first) | GREEN |
|---|---|---|
| 20 fix 1 (93c2383) | 6 failed (offline-state 5: the shape and the new rule; server-reach 1); a mutation dropping the flag from the store's change check failed 2 | the offline tests 65/0; cafe 7598/7597/0/1 |
| 20 fix 2 (cf113d4) | 3 failed (the refusal count, the new rule test, the Task 13 pin) | 21/0; tsc 0; lint clean on the four files |
| 24 (5085d53) | 6 of 6 failed (the heading, the Phase 5 checks, the calm sentence missing) | 6/6; with the old runbook pins 136/0 |
| fix wave (84ec1e2) | 3 failed (the two new tests, the page pin), then 2 (the docs pins) | 23/0 and 113/0; tsc 0; the whole chain below |

Tasks 21–23 changed no code (measurements). Two existing pins changed on purpose in 93c2383 (feedBrowserOnline's middle step,
the automatic reload's test): each now brings the browser back before the answer that ends offline (the same intent).

## Counts (before at 528cd46 → after)

| Suite | Before (528cd46) | After (84ec1e2) |
|---|---|---|
| cafe `npm test` (chain) | 7590 / 7589 pass / 0 fail / 1 skip | 7601 / 7600 / 0 / 1 |
| cafe typecheck | 0 | 0 |
| lint (`npx eslint .`) | 0 errors, 2 warnings | 0 errors, the same 2 warnings |
| shared `npm test` | 1062 | 1062 |
| shared typecheck | 0 | 0 |
| live legs (`verify:print:live`) | 499 / 0 (`pos_scratch_print_host_5c0`) | 499 / 0 (`_5cf`) |

The 11 new cafe tests: 6 runbook pins (Task 24), 2 (93c2383), 1 (cf113d4), 2 (the fix wave). The fix wave touched no
online print path (the S1 run on cf113d4 stands).

Scope (`git diff 3ec96f1..HEAD`): no diff under `apps/desktop`, `workers`, `print-budget*`, the slip renderers
(`KOTReceipt.tsx`, `OrderReceipt.tsx`, `components/print/slip/*`); `apps/mobile` only `TEST-CHECKLIST.md`; `lib/printer/*`
only 5B's test pin; budgets held: `use-pos-tab.ts` 546, `pos/page.tsx` 299, `lib/pos-send.ts` 300, `PaymentModal.tsx` 297,
`printer-dot.ts` 300; `usePosPulseContext` 8 readers; no new file over 300 lines.

## Task 20: end to end on fake printers

Headless Chrome as the POS app (a fake `window.PosNative`: bridge v2 with a printer pool, bridge v1 with one printer, or
none = a waiter phone's browser), the 5C builds in a worktree `D:\kd\u5c` (cache-off edit uncommitted), port 3171, printers
mode with Kitchen / Bar / Desserts on network printers 9101–9103 and a bill printer 9104, all written by the POS device;
both outage variants: the browser offline (`setOffline`) and **the server process stopped** (the realistic one: the
router's internet down, the browser still online; the page goes offline by its pulse, 23–34 s). Every run read the paper
(slip pictures turned into PNGs: `OFFLINE · O-n` banners, the create's O-n in a later round's Order row per ruling 13 (b)),
the toasts, the outbox, and after the replay the orders, KOT numbers and every job's log. Across all runs: **no duplicate
order id, KOT number or KOT job key, no unlabelled second slip, the outbox empty at the end.**

| Scenario | Result |
|---|---|
| New order + a second round on it (offline; stopped) | O-1 Kitchen +0.65 s, O-2 Bar; back: the outbox empty in 0.5 s (offline) / 16 s (stopped: the next 20 s pulse); one order, 2 rounds, its taken time kept; both jobs `printed (offline O-n)`; nothing printed after |
| A round on a server tab (offline; stopped) | round 1 online as today; round 2 offline O-5 / O-6 on Bar; back: the round saved, its job `printed (offline O-n)`; no paper after |
| Pay Now (offline; stopped) | the sheet's note "Offline: Cash, Online or Split only…"; the KOT O-7 / O-8 at once on Kitchen and Bar; back: the sale Completed, its KOT jobs printed (offline), the bill printed once 0.6–4.5 s after |
| A half-way send, the server stopped just before the tap (± Print KOT here) | "Couldn't confirm" then parked within 2 s ("Saved on this device…"), no paper; back: printed once (normal). With Print KOT here: the confirm's words, the OFFLINE copy; back: the jobs `printed (offline O-10)`, no second paper |
| **The lost answer** (Review Focus 1, `lost-proxy.mjs`: the server takes the send, its answer is lost and the internet goes) ± Print KOT here | the server has the order (one KOT number); the page parks it as uncertain, no paper; back: the replay is answered as a replay (no second order). With Print KOT here: the OFFLINE copy, and the replay's CAS made the server's untried queued jobs printed: no second slip |
| A refused round (two server tabs settled elsewhere during the outage; offline; stopped) | both refused "Can only add items to an open tab" (needs staff); Send again refused again; Fix and send opens a new order on that table and sends it online, its job `printed (offline O-n)`: no second slip; Discard: "Its KOT is already in the kitchen. Nothing is saved for it." With the server stopped this found **fix 2** (before it, Fix and send reopened the closed tab: 409 again) |
| A reload while cut, then the connection back (offline; stopped) | Chrome's own error page while cut; the page opened again with the connection and sent the kept order at once; printed (offline) |
| A waiter phone with no printer (offline; stopped) | "Offline: order O-1 is kept on this device. It prints when the internet is back."; no paper; back: the jobs queued for the printing device, which printed each once (normal KOT) when it opened |
| Two tabs of one device (offline; stopped) | sends at the same moment in both: distinct O-17 / O-18 under the lock, both kept; back: one tab replayed both (the Web Lock), two orders |
| Bridge v1, simple mode (the POS app 1.x shape; fresh: offline and stopped; Pay Now) | each KOT on the device's own printer with the banner; back: the whole-ticket jobs `printed (offline O-n)`, the bill once |
| The browser cut 30 ms after a tap (the answer lands after the browser's offline event) | found **fix 1**: before it the page stayed "online" for 150 s (no offline path); after it the header says Offline at once and stays so until a pulse reaches the server |
| a11y (the local axe-core 4.12.1 run, WCAG 2.2 AA tags) | the pay sheet's offline note, Offline orders at 1280 px (the 420 px aside) and at 390 px (full screen from the bottom, 390×844): **0 violations** |

**S1 again on 5C's head** (cf113d4, the 4B gate's tools, `s1.log`): the base build `D:\kd\u6b` (21df25c = main 96520d6
before Phase 5) against `D:\kd\u5c`: **simple mode on bridge v1 9/9 and printers mode on bridge v2 9/9 slips byte for byte
equal.**

## Task 21: the emulator

Pixel_7_API_33, the app as found = 1.0 (versionCode 1, installed 2026-10-17: bridge v1), WebView 154.0.8037.106, Play Store
paused for the run; simple mode with the app's own network printer at 10.0.2.2:9100 (a fake printer), the 5C build on
:3100 (`adb reverse`), build 93c2383 (cf113d4 changes only the list read after a refused replay, covered above).
- **WebView 154:** the server stopped mid-shift → the header "Offline — KOTs print here" (amber dot) in ~50 s; two KOTs:
  O-1 (T-1) on paper 0.8 s after the tap, O-2 (T-2), the toast "Offline: KOT O-2 printed here. It is sent when the internet
  is back.", "Offline orders · 2"; the slip's banner `OFFLINE · O-1` read from the paper; the server back → the outbox empty
  in 15 s, 2 orders (KOT 1, 2; their taken times), both jobs `printed (offline O-n)`, no slip after. **A reload while
  offline** (the app closed and opened): "Could not open the POS … The app is trying again by itself."; the server back →
  the page open 14 s later → O-3 sent within 2 s, saved, printed (offline).
- **WebView 109** (the factory one): the same (T-4 / T-5 → KOT 4 / 5 printed (offline); the reload → O-3 on T-6 sent 3 s
  after the page opened). The switch reset the WebView's storage, so its O-n started again at O-1 (as a new device would).
- Put back as found: the test printer removed ("No printer set up"), WebView 154 reinstalled, Play Store enabled, the reverse
  removed, `sync`, `emu kill`. The WebView switches cleared its cookies: the app stays at its sign-in page on
  localhost:3100.

## Task 22: the Windows app smoke

The Windows app's built main process (`apps/desktop/out`, the 2.0.2 build) unpackaged with a scratch userData; a boot
shim fakes only the OS printing endpoints (the printer list reports one thermal printer; `print()` saves the page as a PDF
and records its text and fonts) — nothing was added to this PC's printers; "Through the Windows driver"; printers mode:
Kitchen on that Windows printer (`printHtmlOn`), Bar on a network printer at 127.0.0.1:9102 (`printRaw`, real TCP to a fake
printer). The server stopped → "Offline — KOTs print here"; one Send: the Windows printer at +0.73 s ("OFFLINE · O-1 /
KITCHEN ORDER / … / Round total: ₹200", the default system font, nothing to load), the network printer at +1.42 s
(43,530 B); back: both jobs `printed (offline O-1)`, no second slip. **With a KOT template on a downloaded slip font
(POS Print Sans)**: the font fails to load while the server is down, the Windows printer prints at +3.06 s (the app's 3 s
fonts rule) in the fallback sans-serif, legible and complete; the network printer at +3.77 s; the replay as above.

## Task 23: the calm pulse measured

A build of cf113d4 in a worktree `D:\kd\u5p` with the local stand-in for the realtime room's URL inlined
(`D:\kd\pos-dev-keep\perf\fake-realtime.mjs`, 127.0.0.1:8787), behind the counting proxy (`p3a-proxy.mjs`, :3172 →
:3173), printers mode, database `pos_scratch_e2e_4g_5cp2`. One headless Chrome with 8 devices (contexts): **app1 and app2
= fake POS apps** (bridge v2, each the writer of two network printers on fake printers 9101–9104, `app.wake` every 15 s as
the print service ticks: 231 ticks each, the hook registered on both), pos3 (/pos laptop), waiter (/pos at 390 px),
kitchen (/kitchen), floor (/tables at 390 px), orders (/orders), dash (/). A 3-minute warm-up, then (`pulse-full.json`,
`proxy-full.jsonl`; the proxy's pulse counts equal the pages' own, 240 and 178):

| Window | Pulses per device per minute | Per device-hour | All `/api` requests, 8 devices |
|---|---|---|---|
| Quiet, 30 min | every device 1.00 (the two app devices too) | 60 | 19.8 / min |
| Rush, 15 min (a Pay Now every 30 s, alternating app1 and pos3: 30 sales, 93 jobs, all printed, 0 failed) | app1 2.93, pos3 2.93 (their own sales: lively 2 min), the six others 1.00 (app2 prints Bar and Desserts: their jobs printed at the realtime nudge, so no pulse answer held one waiting) | 89 | 70.9 / min |

**The alarm** (a stuck slip: the Desserts printer off for both apps, as paper out; pos3 sends a Cheesecake on a fresh
table; three trials): on the device that asked for it (pos3, lively) **20.0, 20.0, 20.0 s**; on the device that prints it
(app2, calm) **36.8, 42.5, 43.1 s** (spec: 20–40 s on the device that made it, ≤ 80 s on another: both held). By design
the alarm rings only on those two devices (`printAlarmWanted`, `lib/print-waiting.ts`). Each slip printed once within about
a second of the printer coming back.

**The projection** (8 devices, 12 h a day, 30 days, at the measured rates): all hours calm 0.17 M; 80 % calm 0.19 M;
**60 % calm 0.21 M**; 40 % calm 0.22 M; every hour a rush like this one 0.26 M pulse invocations a month, against today's
0.52 M (20 s always) and the target ≤ 0.35 M: **about −0.31 M a month at 60 % calm** (the cafe's projection ≈ 1.23 M →
≈ 0.92 M invocations). The rush here has two devices taking orders; each device that sends is lively for 2 minutes after
its send (up to today's 3 a minute on it), so a rush with every device sending costs more, never more than today's 0.52 M.
The first, short trial run found two harness faults (the fake app answered a print with the base64 length, and the printer
was off on one app only, so the slip failed over to the other app), fixed before this run; neither was an app fault.

## Task 24: the docs

GO-LIVE gains "Existing cafes: the printing Phase 5 release" (spec §7: the web first, every screen reloaded, the demo
cafe for some days with the Phase 5 checks, then the clients; the rules: no refresh during an outage, End of day only when
every device's Offline orders list is empty, the rollback only after every list is empty; what staff see in the page's
own words; the half-way send and Print KOT here; a refused order; what may differ after an outage; the calm check's
numbers) and the §7 device step's sentence "That refresh slows to once a minute while the cafe is quiet and the live
connection is proven (printing Phase 5)."; TEST-CHECKLIST gains "Phase 5 checks (offline KOTs)" (spec §9 item 6). Pinned
in `lib/go-live-runbook-phase5.test.ts` against the code's own constants.

## Differences from the plan, and why (the session's rulings)

1. **The runbook pins live in a new file** (`lib/go-live-runbook-phase5.test.ts`), not `lib/go-live-runbook.test.ts`
   (1706 lines, past the 300-line rule; 5A's precedent).
2. **Task 20 added the lost answer** (`lost-proxy.mjs`): the plan's half-way send stops the server before the tap (the
   server never has it); Review Focus 1 needs the server to have it, so a proxy forwards the send, drops its answer and goes
   down.
3. **Two fixes inside Task 20** (93c2383, cf113d4), each test first, found by the fake-printer runs (above).
4. **The emulator ran on 93c2383's build**; cf113d4 changes only the list read after a refused replay (no refusal on the
   emulator), checked on fake printers on its own build.
5. **The Windows smoke fakes the OS printer list and `print()`** instead of adding a printer to this PC (that would change
   the owner's PC); everything else is the app's own code. The network printer is on loopback without the test LAN setting
   (with it, the app's status check reports every other host down).
6. **The stuck slip of Task 23** is a printer that is off for every device (the paper out), so no device can take it
   over; the alarm by design rings on the device that asked for the slip and the one that prints it (`printAlarmWanted`).
7. **GO-LIVE's calm-check sentence corrected after Task 23** (in this Results commit, its pin first): "up to about 80
   seconds after it on the others" → "… on the device that prints it (measured: 20 s and 37–43 s)" (the alarm never rings
   on the other devices).

## Open points for the owner's eye (none changes the paper)

- **5B's three:** (a) a parked (uncertain) create listed in Open tabs as "Offline · O-n" while it may be on the server: judged
  on the emulator and the lost-answer runs — keep as is (during an outage no device sees the server's copy; the Offline
  orders row already says "May already be on the server: it is sent by itself to check"; the replay never makes a second
  order); (b) "did not print on X" is also said for a "maybe" line (its server copy prints as REPRINT): a suggested wording
  "may not have printed on X" — the owner's word; (c) the amber dot drawn by the warn class reads amber on WebView 154,
  WebView 109 and desktop Chrome: stands.
- **New (minor, not fixed):** the offline header's printsHere reads only the printers the device writes, so a device whose
  POS app lists a connected network printer it does not write says "Offline — orders are kept on this device" while a send
  prints there (spec 5.3 prints on it; the toast says "printed here"); at 390 px the phone header's open-tabs control reads
  "2 ope" (cut) beside the "Offline orders · n" chip (WebView 154 and 109).
- **Offline paper with a downloaded slip font** prints in the fallback font after 3 s on the Windows app (above), as spec §12
  says.
- Environment: the first `next build` attempt ran ~1 min without `NEXT_TELEMETRY_DISABLED` and was stopped before it
  finished (every later build had it); the Android emulator's crash reporter is set to upload crash reports (only on a
  crash; none happened; its usage analytics are opted out). Later emulator boots should pass `-no-metrics`.

## The review (Claude Fable 5.1, read-only)

Range 3ec96f1..cf113d4 (what a merge brings; the owner's own main commits out of scope), against the spec, this plan,
the 5A/5B Results and 5C's ledger. It stopped once on an HTTP 429 (the 5-hour limit) right after loading its context and
was resumed with SendMessage after the 17:10 reset (no model switch). Read in three passes (the server half and shared;
the page half; the 5C commits and docs) and six test files run read-only (60/60). Verdict **"With fixes"**: online paper
and behaviour traced unchanged at every touched server site (the S1 runs agree); S3 held on every path; the older-server
risk closed twice; the two 5C fixes judged correct and minimal.

| Finding | Ruling |
|---|---|
| I1 Discard could remove an entry the runner was sending (its button hides only at render time): the server saves the order while staff are told "Nothing is saved for it", so they ring it again | **Fixed** test first (84ec1e2): `offlineDiscardRefusal` read inside the outbox lock; `offlineDiscard` / `offlineSendAgain` leave a "sending" entry (or a create whose round is sending); the sheet says "This order is being sent now: it cannot be discarded." |
| I2 Fix and send replaced the cart with no word (unsent lines lost; Resume asks first) | **Fixed**: refused with "The cart has items not sent yet. Send or clear them first, then Fix and send." (`hasUnsent` on the same line of `use-pos-tab.ts`, 546 held) |
| m3 an idle calm screen notices a real outage at its second missed pulse, up to about three minutes; TEST-CHECKLIST said "about a minute" | Doc part re-graded **Important** (the demo-cafe check would fail as written) and **fixed**: TEST-CHECKLIST and GO-LIVE state the three minutes and that an order sent before the screen noticed is kept as a half-way send. The code option (a counted miss makes the pulse lively; one input, no new request) is **for the owner** (beyond spec 5.11's conditions) |
| m4 a parked create that never landed replays with the field, so the server draws no token for it (a token cafe's customer has nothing to be called by) | **For the owner** (P5-5 decided "no token" for orders made offline; a held send is a grey case; the reviewer's option: omit the field for an uncertain entry whose lines are all "later") |
| m5 Fix and send while offline ends in "Couldn't confirm" (no loss) | Deferred (suggestion: hide it while offline) |
| m6 the offline header's "KOTs print here" reads only the writer list | Deferred (wording only; the toast is exact) |
| m7 two tabs: `offlinePrinting` is per tab, so the other tab can replay a line still printing and the server labels it REPRINT | Deferred (needs the state to flip online inside a ~1 s print; the paper is labelled) |
| m8 the 390 px header cut ("2 ope") beside the chip | Deferred (suggestion: "Offline · n" below 720 px) |

Declined to judge by the reviewer (ruled "stands"): the measured pulse, alarm, emulator and Windows runs (5C measured
them); suite counts; the realtime heartbeat and `retry: 1` (pre-existing); everything spec §8 / P5-2 leaves out; the 24-line
cap (5A m3); a "maybe" line's untried job unlabelled (5A m1, the owner said no); rulings 11 and 13 (b) (the owner's);
pre-existing files over 300 lines growing by guard lines (5B); two tabs without Web Locks (5B re-check); storage cleared
by the user or the OS (device storage is the only store, spec 5.2); End of day seeing only this device's outbox (the
runbook's rule).

No re-review was dispatched (one fix wave, each fix verified by a test that failed first and the whole suite).

## Scratch databases

Every live run dropped its own database (the runner: `pos_scratch_print_host_5c0`, `_5cf`). This session's e2e databases
are LEFT: `pos_scratch_e2e_4g_5ca`, `5cv`, `5ca1`, `5cb1`, `5cpa`, `5cpb`, `5cw`, `5cw2`–`5cw6`, `5cemu`, `5cp`, `5cp2`: the
drop was refused by this PC's permission system (as 5B's and the design session's); the owner may run
`node D:/kd/pos-dev-keep/phase5/session-5c/drop-5c-dbs.mjs` from `D:\kd\lucifer\apps\cafe` (it drops exactly that list and
names what is left). The build worktrees `D:\kd\u5c` and `D:\kd\u5p` are removed (384 junctions each deleted first; the real
`node_modules` unchanged, its bins intact); no process of this session is left running.

---

# Follow-ups after 5C (2026-11-04, the owner's answers)

Phase 5 was merged into `main` as fffa248 (`--no-ff`, on the owner's conditional OK; every suite green on main) and
pushed (3ec96f1..fffa248, the token store) on his word. His answers to the open points of the 5C Results were built on
`feat/printing-phase-5-followups` (from main), test first, and recorded in the spec as P5-11..P5-13:

| Point | The owner's answer | Built (fb450d6, faf3c5d) |
|---|---|---|
| m3: an idle calm screen finds a real outage at its second missed pulse, 60 s after the first | "the server smooth and the process fast" | **P5-11:** one missed pulse keeps the pulse at 20 s until one reaches the server (`pulseMissed` in `lib/pos-pulse-cadence.ts`, read from the offline state's `pulseMisses`); never more often than the pre-Phase-5 20 s; GO-LIVE and TEST-CHECKLIST: about two and a half minutes |
| m4: a half-way send that never landed (or a waiter phone's order) drew no token | "the standard, proper decision" | **P5-12:** no token only when a line of the round printed, or may have printed, offline (`offlinePaperOut`); an order kept offline that printed nothing is saved with its token, as online; the replay still sends the field (its job refs let a lost answer's KOT print at once) |
| "did not print on X" for a maybe line | "ok, everything accurate" | **P5-13:** "may not have printed on X. It prints there, marked REPRINT, when the internet is back." (and the mixed form) |
| m5, m6, m8 | "manage everything properly" | Fix and send not offered offline; the header's "KOTs print here" follows the send's own rule (`offlinePrintsHere`, `useOfflinePrintsHere`: no menu read, no new request); below 720 px the chip reads "Offline · n" |
| m7 (two tabs: a line still printing in one tab, replayed from the other, prints a labelled REPRINT) | — | Left: closing it needs a new outbox field, which an older page's strict schema would read as an unreadable record during a deploy; the paper is labelled |

**Tests:** cafe 7601 → 7607 (7606 / 0 / 1 skip); tsc 0; lint 0 errors (the 2 old warnings); shared 1062. Pins changed on
purpose: the create route's token argument in `order-availability-paths`, `skip-kot-paths`, `write-route-paths` (×2) and
`print-offline-jobs` (their intent, the draws' order and gate, unchanged); `offline-send`'s two-name case now uses two "no"
lines (the maybe shapes have their own test).

**End to end** (a build of fb450d6, `D:\kd\u5f`, fake printers, tokens on, `r6.log`): a half-way send that never landed →
saved with **token 1**, its token slip printed once; an order printed offline (O-2, O-3) → no token; a waiter phone's order →
**token 2**, the printing device printed its KOT lines and token slip once each; a device that writes no printer but whose
POS app lists the network printers → the header says "Offline — KOTs print here" (m6); a11y (axe) 0 violations; no
duplicate order, KOT number or job key. **The 390 px header** (`probe390`): tokens off — online the open-tabs control is
216 px, offline with the chip 115 px and its "1 open" pill whole (the 5C emulator's "2 ope" cut is gone); tokens on (the
Tokens button too) — offline the control shrinks to 58 px and the pill is hidden while the chip shows (the control still
opens Open tabs, which lists the offline orders).

**P5-11 measured** (a build of fb450d6 with the realtime stand-in, `D:\kd\u5r`, `m3-5c.mjs`): one dashboard page left alone until its pulse was calm (60 s apart: measured gaps 60, 60 s), the server stopped at a random moment, three rounds: the page said Offline **73, 60 and 75 s** after the stop; each time the first failing pulse (+51, +38, +53 s) was followed by the next **20 s later**, not 60 (before P5-11 the second miss would have come about 60 s later: about 110 s). With the server stopped a pulse fails at once; with the cafe's internet down each failing tick waits for its 15 s timeout and one retry, hence "about two and a half minutes" in the docs.

**The review** (Claude Fable 5.1, read-only, fb450d6): **"Ready to merge? Yes"**, 0 Critical, 0 Important; it traced every
caller of the token rule (the send, the replay, Fix and send, Pay Now, simple mode, maybe lines) and the token job on both
the first answer and a replay, and confirmed the pulse can never ask more often than the pre-Phase-5 POS. Minor 1 (two
spec lines still said every order made offline has no token) fixed in faf3c5d; minor 2 (a printer named in both sets is
said "may not have printed" only: the weaker claim is still true), minor 3 (`readDevicePrefs()` read at the header's
render, as `readyPrinterIds()` / `canPrintNow()` already were) and minor 4 (the chip's visible text vs its name, already so
before) stand.

**Scratch databases** added and left (the drop is refused here): `pos_scratch_e2e_4g_5cf1`, `5cf2`, `5cp3`; the live run's
`pos_scratch_print_host_5cu` was dropped by its runner. The build worktrees `D:\kd\u5f` and `D:\kd\u5r` are removed after
the run.
