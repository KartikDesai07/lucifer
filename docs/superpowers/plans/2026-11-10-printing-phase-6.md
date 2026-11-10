# Printing Phase 6 Implementation Plan (parallel printing on one device)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task, each task test first
> (superpowers:test-driven-development). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A device that prints several printers draws its slips one at a time on its one surface, as today, but writes
each printer on that printer's own lane: the next slip draws while the previous one is written, and one printer's
write, ack or hang never holds another printer. A printer still prints its own slips one at a time and in order.

**Architecture:** The host bridge (`hooks/use-print-host-bridge.ts`) splits a two-step slip into "make the bytes" (the
surface, one at a time) and "write the bytes" (the printer's own queue): it arms a one-shot hand-off by lane key
(`lib/printer/lane-writes.ts`) that the printer writers honour, so the pinned drawing files stay byte for byte; a ticket
per slip (`lib/print-host-tickets.ts`) tells each caller its own result. The print agent (`lib/print-agent.ts`, split
into `lib/print-lines.ts` and `lib/print-line-job.ts`) runs one job per printer line instead of one per device. No
server, app, paper or request change.

**Tech Stack:** TypeScript (Next.js 15 page), React 19, TanStack Query v5, node:test with tsx, the hook harness
(`lib/hook-harness.ts`), ESC/POS fake printers (`scripts/fake-escpos-printer.mjs`), headless Chrome as the POS app.

**Spec:** `docs/superpowers/specs/2026-11-03-printing-phase-6-parallel-design.md` (approved 2026-11-03; planning
rulings §9, the owner's P6-3 and P6-4 of 2026-11-09). Section numbers below (§n, S1–S5, P6-n, "ruling n") are the
spec's.

## How this plan runs

The owner's workflow on the **fast path** ("thoda fast forward karna hai, but proper smooth and fast working software,
without any issue"): two implementation sessions on the branch `feat/printing-phase-6`, each built test first, one
commit per task, a fresh review at its end, then the orchestrator's check before the next prompt.

| Session | Delivers | Before the next |
|---|---|---|
| 6A | **Exact below.** The lane hand-off, the slip tickets, the bridge's two steps, the agent's cycle per line, the wiring, the copies, every S-rule's test. Every cafe sees the change once deployed, so 6A ends with every suite green and the S1 pin untouched. | the orchestrator's check |
| 6B | The exit (spec below, fixed interfaces): fake printers against the "before" numbers, the S1 bytes old vs new, the lifecycle paths end to end, the Windows app, the emulator on WebView 109 and 154, the soak, GO-LIVE and TEST-CHECKLIST, the final review; then the owner's merge OK. | the owner's merge OK |

Each session ends with: every suite green, a fresh Claude Fable 5.1 review of its range (read-only; on an HTTP 429 wait
for the reset and say so; never switch models silently; resume a cut reviewer with SendMessage), one fix wave, and its
"Session 6X Results" section at the end of this file (commits, RED → GREEN per task, counts before → after, the review
and its rulings, any difference from this plan and why).

## Global Constraints

- Branch `feat/printing-phase-6` from `main` 0c794d6. Never on `main`; merge only on the owner's explicit OK; push only
  when the owner says, only with the token store (`GIT_TERMINAL_PROMPT=0`), `origin/main` fetched first.
- **S1, no paper change:** no file under the S1 43-file pin (`PIN (S1)` in
  `apps/cafe/lib/printer/kot-text/text-kot-print.test.ts`; it includes `lib/printer/lane-print.ts` and
  `lib/desktop-shell.ts`) changes; the slip renderers are not edited.
- **S2:** one job in flight per printer line on this device; a line's next job starts only after its previous job's
  write and ack; the device line (`PRINT_DEVICE_LINE`) runs alone (ruling 16).
- **S3:** lease, epoch, ack, `more`, REPRINT / DUPLICATE / BACKUP PRINTER, at most two paper attempts, no attempt while
  a printer is off, `PRINT_DIRECT_HOLD_MS` (60 s) per job, the hand-back (`sent: "no"`), the `(id, epoch)` dedupe, the
  pending-ack store, "clear after this try", offline KOTs: per line exactly as today. A slip never drawn is never
  "maybe"; a slip drawn is waited for (ruling 12).
- **S4 / P6-3:** no new kind of request, no new write, no realtime message, no new timer; a line's `more` leases at
  once (ruling 25); `packages/shared/src/print-budget.test.ts` unchanged; `printAgentMayLease` unchanged.
- **S5:** nothing in `apps/mobile` or `apps/desktop` changes; one-step lanes (ruling 8) stay one at a time.
- **Values:** `PRINT_AGENT_SLIP_DEADLINE_MS` 140 000, `PRINT_HOST_DISPATCH_TIMEOUT_MS` 90 000,
  `PRINT_DIRECT_HOLD_MS` 60 000, `PRINT_AGENT_QUIET_AFTER_ACK_MS` 500, `PRINT_AGENT_REFUSED_RECHECK_MS` 30 000: unchanged.
  New: `PRINT_HOST_NOT_DRAWN_MESSAGE = "waited too long to be drawn on this device"`; lane keys `native:<app id>`
  (the id as the app lists it) and `lan:<host lower-cased>:<port>`.
- **Files ≤ 300 lines, tests too.** Over the cap today and never growing: `lib/print-agent.ts` (301),
  `lib/print-agent-printers.ts` (357), `hooks/use-print-agent.ts` (340), `lib/print-agent.test.ts` (1,423),
  `lib/print-host-paths.test.ts` (696), `lib/print-agent-printers.test.ts` (593). `lib/printer/desktop-lan.ts` (299)
  ends ≤ 300 (`wc -l` in Task 2); `hooks/use-print-host-bridge.ts` (270) ends ≤ 300 (its two 270-line caps move to
  300 in Task 4, on purpose).
- **Tests:** every new cafe test file goes into `apps/cafe/package.json` `testChain` (one entry per file); every
  assertion carries a message (a failing `assert.ok(x)` without one hangs a big tsx file); a pin moves only on purpose,
  with its reason in the commit and the Results, and is shown to bite (break the line, watch it fail, put it back).
- **Environment:** `df -h /c /d` first (stop and ask if D: < 1.5 GB); mongod 127.0.0.1:27017 is shared: only
  `pos_scratch_*` databases this session makes, dropped at its end; only this project's processes (by PID after
  checking the command line); another project's vite holds 127.0.0.1:3110 (never use it);
  `NODE_OPTIONS=--max-old-space-size=6144 npx eslint .` for lint; long runs in the background.
- Local only: no connector, Artifact or Docs tool, no upload, no deploy, no tunnel, nothing to files.sandbee.in; the
  live demo read-only and without login. Repo text in English; messages to the owner in Hinglish. Commit messages
  through a scratch file and `git commit -F`, ending with the session's Co-Authored-By line.

## Review Focus

1. **A write ends before an earlier slip's** (Bar's fast printer finishes while Kitchen's slow one still writes): each
   caller must hear its own result, never its neighbour's. Pinned in Task 3 (`each slip hears its own result, whatever
   order the writes end in`) and Task 4 (`each slip's caller hears its own write's result`).
2. **A slip waits to be drawn while its bound runs out** (several lines, a Windows printer holding the surface): it must
   go back unprinted, never "maybe" and then print. Pinned in Task 3 (`withdraw`), Task 6 (`the 140 s bound withdraws
   a slip still waiting`, `an offline slip still waiting at its bound is withdrawn`).
3. **The page reloads or the provider unmounts while lines write** (a deploy's quiet reload, a navigation): the gate
   must wait for the last line; slips not drawn go back, writes in flight settle. Pinned in Task 4 (`busy covers every
   write in flight, drawing only the surface`, `unmount answers waiting slips no and the slip on the surface maybe at
   once, ...`) and Task 6 (`leaveWhenPrintFree waits for the last line`).
4. **One printer hangs or refuses** while others print: only its own line waits; no other line's wish, quiet or held
   job is lost. Pinned in Task 5 (`a stuck line holds only itself`, `a failure's backoff holds only its line`).
5. **The device's own printer is also a setup printer** (a v1 device-line slip and a v2 printer-line slip aimed at one
   physical printer): never two writes at once. Pinned in Task 5 (`the device line runs alone`).

## The planning round (2026-11-09/10)

**Field and owner:** no field printing or app-update problem since 2026-11-08 (owner); a deploy after aab2a63 was made
(owner; the demo's build id `local-mw96i59l` = 2026-11-09 16:59 IST, after 0bb44de); no real printers for the check now
(P6-4). Lease question answered "at once, per printer" (P6-3).

**Survey** (read-only, `main` 0c794d6): one slip's path, every "one at a time" assumption, the copies question. Folded
into spec §9 rulings 1–28. The two that would break outright with two slips in flight: the outcomes FIFO
(`lib/print-host-outcomes.ts`) and the 140 s bound counted from queueing (a "maybe" for a slip still queued that then
prints). The finding that shaped the design: `lib/printer/lane-print.ts` and `lib/desktop-shell.ts` are S1-pinned, so
the split lives in the writers (ruling 9).

**Baseline** (spec §5): M1 649 / 1,222 / 1,796 ms; M1-slow last cut 7,860 ms; M1-stuck Bar 63,308 / Desserts 63,893 ms
with 5 acks + 2 leases a round. Harness `D:\kd\pos-dev-keep\phase6\design-harness\` (README.txt). Suites at 0c794d6:
cafe chain 8219 (8218 pass / 0 fail / 1 skip), shared 1079 (0 fail).

**The builder check** (a fresh engineer, read-only, the spec and this plan against the code; it traced Task 1's five
scenarios by hand through `main`'s agent and agreed with `TODAY`): 2 blockers, 6 important, 6 minor, all folded. The
blockers: (1) the lease gate is the surface, so a backlog's `more` that lands while the next slip draws waits for the
opening and shares its lease: with fast writes a backlog costs today's leases (the test now has a fast and a slow
backlog; ruling 25 says "at once when the surface is free"); (2) a hand-back made no wish to lease, so on a one-step
device the handed-back jobs waited for the pulse: a hand-back is a wish (ruling 17). The important ones: withdrawing a
current slip not yet dispatched (the ticket stays waiting until the dispatch effect fires; Tasks 3–4); the 140 s bound
on a slip already writing (waited for, never answered early: ruling 12, Task 6); the quiet stays device-wide (ruling
19); a held device-line job must not starve (ruling 16); the full list of pins that move (Tasks 4, 6, 7; the bridge's
270-line cap); the world's start-up (Task 1). The minor ones: `writes` on the slip from Task 4; `ready()` is
`localIds`; the moved `printJobCopies` cases; no line hold for a slip withdrawn undrawn (ruling 20); the late guard and
`dispatched()` order (Task 4); the device line always one step in the world; the timer pin on non-test files; two more
stale comments (ruling 28).

**The planning review** (Claude Fable 5.1, read-only, no HTTP 429): "Ready to run Session 6A as written: With fixes",
0 critical, 3 important, 5 minor; every file:line of ruling 5 and the tasks checked against the code and found right;
the hand-off sound (the only callers of the two writers are `lane-print.ts:147-148` and `text-kot-print.ts:61-63`, both
reached only from the host bridge; react-to-print 3.3.0 calls `onAfterPrint` only after the print promise resolves);
the six scenarios traced through today's agent and the plan's and every count agreed; no two-paper or lost-slip path.
Folded: I-1 a named kick for a busy line becomes that line's `more` and an unnamed kick while a line is busy is
deferred (ruling 25; scenarios `frameBusy` / `frameFree`; Task 5 tests); I-2 the soak runs in its `neither` mode with
the page as the writer (6B Task 14); I-3 Task 5's moved pins named (the 2E world now parallel: lists re-derived, never
loosened); m-4 the offline pin (Task 6); m-5 the bridge's caps move to 300 (Task 4), `desktop-lan.ts` checked at 300
(Task 2); m-6 the no-clock pin covers a designed KOT's blocks and 6B copies a designed KOT (Tasks 7, 11); m-7 the
gate's render lag accepted and pinned (ruling 14; Task 4's `two slips queued in one tick draw in order`); m-8 the docs
are committed before Task 0; the fake printer's path from `apps/cafe` (6B).

**The re-check** (the same reviewer): every fold confirmed against the code, every scenario re-traced through both
agents and both worlds. "With fixes" for 1 important and 4 minor, all folded: frames landing after the lease answered
would each leave a want and buy an empty lease (`framesLate`): a `print-status` frame carries its job id and a frame
for a job this tab holds or prints is no reason to lease, while any other want is cleared only by a lease naming its
line (so a job queued while its line was busy is never left to the pulse); a decided lease counts as in flight before
its kept-acks flush; the deferred wish leases by itself at the first pump after a line frees; a hand-back is a named
kick for its own line; ruling 19's "never held back" means by the quiet (rulings 17, 19, 25; Tasks 1, 5).

**The final narrow re-check** (the same reviewer, of the job-id rule): `frames`, `framesLate`, `frameBusy`,
`frameFree`, one-step `stuck` and the `more: false` race traced in both worlds and found right; the order-answer kicks
carry no job id and need none (they fire only for a job not leased to this tab). Two last points folded as the
reviewer gave them: the held-list scan hands back every stale job before one lease step (else two hand-backs in one
scan made two leases: one-step `stuck` would read {3, 5}), the lease's free lines read after its flush (Task 5 steps
2–3); `framesLate` and `stuck` are named as deliberate downward differences (ruling 26). Verdict after the folds: no
open point.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `apps/cafe/lib/print-lines-world.ts` (test support) | 1 | a fake server with lines, a fake surface (one step or two), a hand-cranked clock, the nine scenarios, `TODAY` |
| `apps/cafe/lib/print-lines-today.test.ts` | 1 | the scenarios on a one-step device = today's counts (S4, S5) |
| `apps/cafe/lib/printer/lane-writes.ts` (+ test) | 2 | the one-shot hand-off by lane key; `withLaneWrites` |
| `apps/cafe/lib/printer/printer-registry.ts`, `lib/printer/desktop-lan.ts` | 2 | the writers pass through `laneWrite` |
| `apps/cafe/lib/print-host-tickets.ts` (+ test) | 3 | a ticket per slip: drawn, written N times, withdrawn; replaces `lib/print-host-outcomes.ts` (deleted) |
| `apps/cafe/hooks/use-print-host-bridge.ts` | 4 | the two steps, `drawing` / `busy`, `queueSlip` → `{ withdraw }`, unmount |
| `apps/cafe/components/layout/PrintHostProvider.tsx`, `components/print/PrintHostDrain.tsx` | 4, 6 | `printing` in the context; `drawing` to the agent; the offline bound |
| `apps/cafe/hooks/use-test-print.ts`, `components/print/TextKotSection.tsx` | 4 | the Test buttons read `printing` |
| `apps/cafe/lib/print-host-bridge-lanes.test.ts` | 4 | the bridge's two steps through the real hook body |
| `apps/cafe/lib/print-lines.ts`, `lib/print-line-job.ts`, `lib/print-agent.ts` | 5 | the agent: one job per line (scheduler; one job's print and ack; the factory) |
| `apps/cafe/lib/print-lines.test.ts`, `lib/print-lines-rules.test.ts` | 5 | Phase 6 counts vs `TODAY`; the per-line S2/S3 rules |
| `apps/cafe/lib/print-agent-print.ts` (+ test), `hooks/use-print-agent.ts` | 6 | the hook's print step (the bound, withdraw, markPrinterWriting) |
| `apps/cafe/lib/offline-send.ts` | 6 | `offlineSlipWithBound` (the offline slip's bound with withdraw) |
| `apps/cafe/lib/print-host-slips.ts` | 4 | `writes?: number` on `HostPrintSlip` |
| `apps/cafe/lib/print-copies.ts` (+ test), `lib/print-agent-printers.ts` | 7 | copies: KOT bytes once on a two-step lane |
| `apps/cafe/lib/print-phase6-pins.test.ts` | 8 | S1 / S4 / S5 scope pins, the comments |
| `docs/GO-LIVE-CHECKLIST.md`, `apps/mobile/TEST-CHECKLIST.md`, `apps/cafe/lib/go-live-runbook-phase6.test.ts` | 6B | the release and the owner's checks |

---

# Session 6A (exact): the two steps and the cycle per line

Acceptance: on a device that prints several printers on two-step lanes, slips draw one at a time in arrival order and
write in parallel, one per line; every caller hears its own result; one-step lanes behave as today; every suite green,
the S1 pin untouched, `print-budget.test.ts` untouched, no diff in `apps/mobile`, `apps/desktop`, `packages/shared`,
`workers`, `app/api`, `models`. Work in `D:\kd\lucifer` on `feat/printing-phase-6`; one cafe test file:
`node --import tsx --test lib/<name>.test.ts` from `apps/cafe`.

### Task 0: Baseline

- [ ] `df -h /c /d`; `git status` clean; `git log --oneline -1` = the plan's commit on `feat/printing-phase-6`.
- [ ] Record (the "before" of the Results): cafe `npm test` (expected 8219 / 8218 pass / 0 fail / 1 skip), cafe
  `npm run typecheck` (0), lint (0 errors, 2 old warnings), shared `npm test` (1079), and the live legs on a fresh
  database `MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host_6a npm run verify:print:live` (from
  `apps/cafe`; all passed; write the count down; the runner drops it).

### Task 1: The scenario world and today's numbers

**Files:**
- Create: `apps/cafe/lib/print-lines-world.ts` (test support: never imported by app code), `apps/cafe/lib/print-lines-today.test.ts`
- Modify: `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces:
  - `type ScenarioName = "direct" | "frames" | "framesLate" | "frameBusy" | "frameFree" | "backlog" | "backlogSlow" | "stuck" | "simple"`
  - `interface WorldOptions { twoStep: boolean; drawMs?: number /* 550 */; writeMs?: Record<string, number> /* per line, default 5 */ }`
  - `interface WorldCounts { leases: number; emptyLeases: number; acks: number; printedAcks: number; handBacks: number }`
  - `interface PaperRecord { id: string; line: string; drawnAt: number; firstByteAt: number; cutAt: number }`
  - `interface LinesWorld { agent: PrintAgent; queue(line: string, ...ids: string[]): void; deliver(...jobs: Array<{ id: string; line: string }>): void; frame(line?: string, jobId?: string): void; settle(maxMs?: number): Promise<void>; counts(): WorldCounts; paper(): PaperRecord[]; now(): number }`
  - `function createLinesWorld(options: WorldOptions): LinesWorld` (builds the agent with the real `createPrintAgent`)
  - `const SCENARIOS: Record<ScenarioName, (world: LinesWorld) => Promise<void>>`
  - `const TODAY: Record<ScenarioName, { leases: number; acks: number }>`

The world's rules (it models the server and the bridge, nothing more):
- **Server:** jobs wait on lines (a printer id, or `""` = `PRINT_DEVICE_LINE`). `lease(printerIds)` answers the head of
  each named line and of the device line whose head is not leased (one job per line, §7.6), each at epoch e+1 with a
  90 s lease; `ack(id, printed)` removes the job and answers `{ applied: true, more }` with `more` = its line still holds
  a queued job; a `sent: "no"` ack puts the job back at the head of its line, due `printBackoffMs(attempts)` later
  (`@pos/shared/print-lifecycle`, 2 s after the first attempt), and answers that `nextAttemptAt` (as `planAck` does,
  `packages/shared/src/print-lifecycle.ts:459-466`); a lease skips a head not yet due and answers `retryAt` = the soonest
  such time (`lib/print-lease.ts:214`); an ack answers after 20 ms, a lease after 30 ms. `deliver` makes jobs already leased to
  this tab (direct print) and hands them to `agent.take`.
- **Surface:** `print(job)` queues a draw (FIFO, `drawMs` each). One step (`twoStep: false`): the surface is held from the
  draw's start until the write's end and the gate's `busy` is true all that time (today's bridge). Two steps: the
  surface is held only while drawing, the write then runs on its line for `writeMs[line]` and `busy` is true only while
  drawing. The world calls `agent.setGate({ enabled: true, busy })` whenever `busy` changes (as the page's effect does).
  `print` resolves `{ ok: true }` at the write's end. A paper record per write.
- **Clock:** one hand-cranked clock for the agent's `setTimer`/`now` and the world's own events; `settle(maxMs = 200 000)`
  advances it event by event until nothing is pending.
- **The agent's other deps:** a station line's jobs carry `printerId: <line>` (a device-line job none);
  `readyPrinters()` = the station lines (simple mode: `[]`); `lineOf` = `job.printerId ?? PRINT_DEVICE_LINE` (the
  page's); `printerReady()` true; the pending-ack store in memory; `offline()` false.
- **Start-up and signals:** `createLinesWorld` opens the gate (`setGate({ enabled: true, busy: false })`, as the page's
  mount does), settles the mount's lease (empty), then zeroes every count; a lease answers `retryAt: null` unless a
  head is not yet due; `frame(line, jobId)` is a `print-status` frame: `agent.kick(line)` (Task 5 adds the job id:
  `agent.kick(line, jobId)`), `frame()` is `agent.kick()`. A device-line job is always one step (ruling 8: this
  device's own printer), in both modes.
- **Scenarios** (three station lines `K`, `B`, `D` unless said): `direct` = deliver K1, B1, D1; `frames` = queue K1, B1,
  D1, then `frame("K", "K1")`, `frame("B", "B1")`, `frame("D", "D1")` 5 ms apart (B's and D's land while the lease is on
  its way); `framesLate` = the same 130 ms apart (they land after the lease answered, while B1 and D1 are held);
  `backlog` = queue K1, K2, B1, B2, D1, then `frame()`;
  `backlogSlow` = `backlog` with `writeMs` 2 000 on every line; `frameBusy` = `writeMs.K = 2 000`, deliver K1, then
  at 600 ms queue K2 and `frame("K", "K2")` (a frame for the line that is writing; B and D idle); `frameFree` = the
  same but at 600 ms queue B1 and `frame("B", "B1")` (a frame for an idle line while K writes); `stuck` = `writeMs.K = 60 000`,
  deliver K1, B1, D1; `simple` = device line only, queue J1, J2, then `frame()`.

- [ ] **Step 1: Write the test** `print-lines-today.test.ts`: for each scenario, `createLinesWorld({ twoStep: false })`,
  run it, `await world.settle()`, and assert `{ leases, acks }` equals `TODAY[name]` (message: the scenario name and
  both values), every job printed exactly once (`paper()` ids unique, one per job), and in `stuck` that B1 and D1 were
  handed back once each (`handBacks === 2`). `TODAY` (traced by hand through `main`'s agent; `stuck` = the e2e
  "before": the lease right after the two hand-backs finds them not due, the timer's lease 2 s later prints them):
  `direct {0, 3}`, `frames {2, 3}`, `framesLate {2, 3}`, `frameBusy {1, 2}`, `frameFree {1, 2}` (today a frame during
  a cycle waits for it and leases once after it), `backlog {2, 5}`, `backlogSlow {2, 5}`, `stuck {2, 5}`,
  `simple {2, 2}`. (The
  planning session's builder check traced `frames` and `stuck` by hand through `main`'s agent and agreed, `stuck` then
  without the backoff: {1, 5}; with the backoff the lease right after the hand-backs is the empty one.)
- [ ] **Step 2: Run** `node --import tsx --test lib/print-lines-today.test.ts` → PASS on today's agent. If a count
  differs from the reasoned value, do not change the world to fit: check the world against the rules above, then record
  the measured number in `TODAY` with a comment saying why, and report it in the Results (it is the "before" of S4).
- [ ] **Step 3: Commit** `test(print): the scenario world and today's lease and ack counts (Phase 6 Task 1)`.

### Task 2: The lane hand-off

**Files:**
- Create: `apps/cafe/lib/printer/lane-writes.ts`, `apps/cafe/lib/printer/lane-writes.test.ts`
- Modify: `apps/cafe/lib/printer/printer-registry.ts:12-14`, `apps/cafe/lib/printer/desktop-lan.ts:271-283` (+ one
  import; the file ends ≤ 300 lines), `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces:
  - `type LaneKey = string`; `nativeLaneKey(nativeId: string): LaneKey` (`native:<id>`, case kept);
    `lanLaneKey(target: { host: string; port: number }): LaneKey` (`lan:<host lower-cased>:<port>`);
    `laneKeyOfTarget(target: SlipPrintTarget | undefined): LaneKey | null` (nativeId first, then lan, else null)
  - `type LaneTake = (write: () => Promise<void>) => void`
  - `armLaneWrite(key: LaneKey, take: LaneTake): () => void` — one arm at a time (arming replaces an earlier arm); the
    returned disarm clears only its own arm and is harmless twice
  - `laneWrite(key: LaneKey, write: () => Promise<void>): Promise<void>` — armed for this key: disarm, `take(write)`,
    resolve at once; otherwise `return write()` (today's behaviour, its rejection included)
  - `withLaneWrites<L extends { write(target: { host: string; port: number }, bytes: Uint8Array): Promise<void> }>(lan: L): L`
    — the same object's members with `write` passing through `laneWrite(lanLaneKey(target), () => lan.write(target, bytes))`
- `printerWriter(nativeId)` becomes `(bytes) => laneWrite(nativeLaneKey(nativeId), () => nativePool().write(nativeId, bytes))`;
  `desktopLan()` creates `withLaneWrites(createDesktopLan({ … }))`; `setDesktopLanInstance` stays as is (a test seam).

- [ ] **Step 1: Write the failing tests** in `lane-writes.test.ts`:
  - `an unarmed write is written as today` — `laneWrite(k, w)` calls `w` once and returns its promise (resolve and reject
    both pass through).
  - `an armed write of its key is handed off and answers at once` — arm `native:tcp:127.0.0.1:9101`; `laneWrite` of that
    key resolves before `w` runs; `take` got a function that runs `w` when called.
  - `a write of another key, or the second write of the armed key, is written as today` — two cases.
  - `disarm clears its own arm only, and twice is harmless`; `arming again replaces the earlier arm`.
  - `the lan key lower-cases the host` — `lanLaneKey({ host: "Printer.LAN", port: 9100 }) === "lan:printer.lan:9100"`;
    `laneKeyOfTarget({ paper: "80mm", nativeId: "x", lan: {…} })` is the native key; with neither, null.
  - `printerWriter and the desktop store go through the hand-off` — with `setNativePoolInstance` and
    `setDesktopLanInstance(withLaneWrites(fake))` fakes: armed, `printerWriter(id)(bytes)` and
    `desktopLan().write(target, bytes)` resolve without calling the fakes' `write`; the taken function then calls each
    exactly once with the same bytes; unarmed, the fakes are called at once. Plus a source pin that `desktopLan()` wraps
    the store it creates in `withLaneWrites(`.
- [ ] **Step 2: Run** `node --import tsx --test lib/printer/lane-writes.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `lane-writes.ts` (module state: the one arm) and the two call sites. The S1 pin stays green:
  `lane-print.ts` still calls `printerWriter(...)` and `desktopLan().write(...)`, which now honour an arm.
- [ ] **Step 4: Run** the file → PASS; `node --import tsx --test lib/printer/kot-text/text-kot-print.test.ts` → the PIN (S1)
  passes; cafe `npm run typecheck` → 0; `wc -l lib/printer/desktop-lan.ts` ≤ 300 (keep `withLaneWrites(createDesktopLan({`
  on the existing line).
- [ ] **Step 5: Commit** `feat(print): the lane hand-off by printer key (Phase 6 Task 2)`.

### Task 3: A ticket per slip

**Files:**
- Create: `apps/cafe/lib/print-host-tickets.ts`, `apps/cafe/lib/print-host-tickets.test.ts` (nothing imports the new
  module yet; Task 4 swaps the bridge to it and deletes `lib/print-host-outcomes.ts`)
- Modify: `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces:
  - `type HostPrintResult = { ok: true; written?: number } | { ok: false; error: unknown }` (`written` absent = 1)
  - `type HostPrintDone = (result: HostPrintResult) => void`
  - `const PRINT_HOST_NOT_DRAWN_MESSAGE = "waited too long to be drawn on this device"`
  - `interface HostSlipTicket { readonly seq: number; readonly jobId: string | undefined }`
  - `interface HostSlipTickets {
      add(done: HostPrintDone | null, jobId?: string): HostSlipTicket;
      dispatched(ticket: HostSlipTicket): void;
      handOff(ticket: HostSlipTicket, write: () => Promise<void>, writes: number, onEnd: (ticket: HostSlipTicket, result: HostPrintResult) => void): void;
      handedOff(ticket: HostSlipTicket): boolean;
      settle(ticket: HostSlipTicket, result: HostPrintResult): void;
      withdraw(ticket: HostSlipTicket): boolean;
      unmount(): { withdrawn: number; maybe: number };
      writing(): number;
    }`
  - `createHostSlipTickets(): HostSlipTickets`
- Rules: a ticket is waiting → drawing (`dispatched`, called by the bridge's dispatch effect right before it arms and
  fires the surface or the text write, never at `setCurrent`) → finished, or drawing → writing (`handOff`) → finished.
  `handOff` of a ticket that is not drawing is a programming error: it throws. `settle` finishes a waiting or drawing
  ticket and is ignored for a writing or finished one. `handOff` runs `write` `writes` times in order (each awaited);
  the first failure ends it: on write 1 `{ ok: false, error: new Error(hostPrintFailureMessage(e)) }`, on a later write
  `{ ok: false, error: new PrintWriteError(hostPrintFailureMessage(e), "maybe") }`; all done `{ ok: true, written: writes }`;
  then `onEnd`. `withdraw` finishes only a waiting ticket, with `{ ok: false, error: new PrintWriteError(PRINT_HOST_NOT_DRAWN_MESSAGE, "no") }`,
  and returns whether it did. `unmount` finishes every waiting ticket that way and every drawing ticket with
  `{ ok: false, error: new Error(PRINT_HOST_PRINT_FAILED_MESSAGE) }` ("maybe": it may still reach paper, today's answer),
  and leaves writing tickets to their writes. Every `done` runs at most once; one that throws never stops the others.
  `writing()` counts tickets in the writing state.

- [ ] **Step 1: Write the failing tests** in `print-host-tickets.test.ts`:
  - `each slip hears its own result, whatever order the writes end in` — A and B handed off; B's write resolves first →
    B's done `{ ok: true, written: 1 }` while A's has not run; then A's.
  - `a one-step slip is settled by the surface` — `settle(t, { ok: true })` → done once; a second `settle` is ignored.
  - `a handed-off slip ignores the surface's settle and is settled by its write`.
  - `writes run in order; the first failure is its own, a later one is maybe` — 3 writes: ok → `written: 3`; a throw on
    write 1 → not a `PrintWriteError` with "maybe"; on write 2 → `printWriteOutcomeOf(error).sent === "maybe"`; the
    remaining writes never run.
  - `withdraw answers a waiting slip sent no; a drawing or writing one stays` — `printWriteOutcomeOf(error)` is
    `{ sent: "no", permanent: false, message: PRINT_HOST_NOT_DRAWN_MESSAGE }`; `withdraw` after `dispatched` → false.
  - `unmount answers waiting slips no and drawing slips maybe, and leaves writes in flight` (the counts returned,
    `writing()` unchanged, the writing slip's done only at its write's end).
  - `a hand-off before the dispatch throws` (a waiting ticket).
  - `a throwing listener never stops the next one`; `writing() counts until each write settles`.
- [ ] **Step 2: Run** → FAIL (module not found).
- [ ] **Step 3: Implement** `print-host-tickets.ts` (pure, no React, no timer; it imports `PrintWriteError`,
  `hostPrintFailureMessage` from `lib/print-write-outcome.ts`).
- [ ] **Step 4: Run** the file → PASS; `npm run typecheck` → 0.
- [ ] **Step 5: Commit** `feat(print): a ticket per slip instead of the outcomes FIFO (Phase 6 Task 3)`.

### Task 4: The bridge's two steps

**Files:**
- Create: `apps/cafe/lib/print-host-bridge-lanes.test.ts`
- Modify: `apps/cafe/hooks/use-print-host-bridge.ts` (it ends ≤ 300 lines; two pins cap it at 270 today,
  `lib/print-host-paths.test.ts:663-666` PIN (P) and `lib/printer/print-gating-fx-paths.test.ts:79`: both move to 300
  in this task, on purpose, with the reason "Phase 6's two steps"; the pending queue, withdraw and write bookkeeping
  live in `lib/print-host-tickets.ts`, so the hook keeps only its React wiring),
  `apps/cafe/lib/print-host-slips.ts` (`writes?: number` on `HostPrintSlip`: how many times a two-step slip's bytes are
  written, absent = 1; set by Task 7), `apps/cafe/components/layout/PrintHostProvider.tsx` (`PrintHostContextValue`,
  the drain's props), `apps/cafe/components/print/PrintHostDrain.tsx` (a `drawing` prop),
  `apps/cafe/hooks/use-test-print.ts:120-122`, `apps/cafe/components/print/TextKotSection.tsx:126`,
  `apps/cafe/package.json` (`testChain`). The pins whose subject changes here, each moved on purpose with its reason
  (big files only shrink or keep their length): `lib/print-host-paths.test.ts` (`busy: current !== null`, the FIFO, the
  test refusal), `lib/print-agent-paths.test.ts:85-88` (the `outcomesRef` counts), the Test buttons'
  `current !== null` in `lib/print-host-card-paths.test.ts:193`, `lib/printer/settings-view.test.ts:173`,
  `lib/print-text-kot-paths.test.ts:51`. The surface's settle keeps today's toast (`jobIdRef`), so `SETTLE_TOAST`
  (`lib/printer/print-gating-fx-paths.test.ts:44`) and `lib/print-job-toast.test.ts:142-150` stay as they are.
- Delete: `apps/cafe/lib/print-host-outcomes.ts` (its two types now come from `lib/print-host-tickets.ts`; every
  importer — `hooks/use-print-host-bridge.ts`, `hooks/use-print-agent.ts`, `components/print/PrintHostDrain.tsx`,
  `lib/offline-send.ts`, `lib/print-host-text-kot.test.ts`, `lib/print-agent.test.ts` — imports from there; the FIFO
  test in `lib/print-agent.test.ts` ("outcomes in print order", about :466) is removed with its reason, so that file
  shrinks)

**Interfaces:**
- Consumes: Task 2 (`armLaneWrite`, `laneKeyOfTarget`), Task 3 (`createHostSlipTickets`, `HostPrintDone`).
- Produces (the bridge's return): `{ current, busy, drawing, kotRef, receiptRef, eodRef, setEodReady, queueSlip,
  queueKotRound, queueTestSlip }` where `drawing = current !== null` (the surface, its waiting slips included) and
  `busy = drawing || tickets.writing() > 0`; `queueSlip(slip: HostPrintSlip, done?: HostPrintDone): { withdraw(): boolean }`.
  `PrintHostContextValue` gains `printing: boolean` (= `busy`); `queueOfflineSlip` is unchanged in shape.
  `PrintHostDrain` gains `drawing: boolean` (to the agent; the self-order lane keeps `busy`).
- Rules (spec rulings 8–13):
  - The dispatch effect keeps today's guards in today's order (mounted, eod ready / slip code, node, text); right
    after them it calls `tickets.dispatched(ticket)`, then, for a slip with `laneKeyOfTarget(slip.target) !== null` and
    `slip.surface !== "test"`, arms that key with `take = (write) => tickets.handOff(ticket, write, slip.writes ?? 1, onWriteEnd)`,
    then fires the surface or the text write (whose synchronous `write()` may hand off at once); the picture and the
    text step hand their write off by themselves (ruling 9).
  - The surface's settle (onAfterPrint, onPrintError, the text write's own promise, the empty or missing node, the eod
    timeout) disarms first and consumes the late guard exactly as today (`take()`, `graceRanOut()`, whatever the
    ticket's state); a handed-off ticket then only frees the surface; any other is settled as today (the toast with
    `jobIdRef`, unchanged).
  - The watchdog disarms too, then abandons as today (ruling 11).
  - `onWriteEnd`: a failure toasts `slipToastOf(hostPrintFailureMessage(error), ticket.jobId)` (once); a state bump
    re-renders `busy`.
  - `queueSlip(...).withdraw()`: a waiting slip in the queue is removed; the current slip not yet dispatched (waiting
    for the surfaces to mount, a design's code, End of day's figures) is dropped and the next one promoted; either way
    `tickets.withdraw` answers it; a dispatched one is not withdrawn (false).
  - `queueTestSlip` refuses (`PRINT_HOST_BUSY_MESSAGE`) while the surface is occupied or any write is in flight.
  - Unmount: disarm, `tickets.unmount()`.
  - `PrintHostProvider`: `holdPrintBusy(busyToken, busy)` unchanged (busy now covers writes); `printing: busy` in the
    context; `drawing` to `PrintHostDrain`. `use-test-print.ts` and `TextKotSection.tsx` read `printing` where they read
    `current !== null`.

- [ ] **Step 1: Write the failing tests** in `print-host-bridge-lanes.test.ts` (the hook harness as in
  `lib/print-host-bridge-late.test.ts`; a slip `{ surface: "kot", target: { paper: "80mm", nativeId: "tcp:127.0.0.1:910x" }, jobId }`;
  a "draw" = the test calls `laneWrite(nativeLaneKey(id), () => writePromise)` and then the KOT surface's
  `stubs.options[0].onAfterPrint()`):
  - `a slip for one of the app's printers frees the surface once its bytes are handed off` — after the draw,
    `current` moves to the next slip (or null), `drawing` false with nothing queued, `busy` true until the write
    resolves, then false.
  - `the next slip draws while the previous one is written` — A drawn (write pending), B queued → B is dispatched at once
    (`stubs.printed` `["kot","kot"]`) while A writes.
  - `each slip's caller hears its own write's result` — B's write resolves before A's: B's done first, then A's; a
    failing A toasts with A's job id only.
  - `a slip with no lane target holds the surface through its write` — target `{ printerName }`, none, `lan` on a
    `test` surface: nothing is armed (`laneWrite` of their key writes at once), the slip settles at onAfterPrint as today.
  - `a draw that fails before any byte settles the slip with that failure and disarms` — `onPrintError`; a later
    `laneWrite` of that key writes at once.
  - `the watchdog disarms the lane` — after `PRINT_HOST_DISPATCH_TIMEOUT_MS`, a `laneWrite` of the slip's key writes at
    once (not handed off); the late rules of `print-host-bridge-late.test.ts` still hold (that file passes unchanged).
  - `withdraw takes a waiting slip off the queue, sent no; the slip being drawn stays` — the withdrawn slip is never
    dispatched.
  - `withdraw drops the current slip while its dispatch still waits` — `surfacesMounted: false`: the current slip is
    withdrawn (sent no), the next is promoted, and once the surfaces mount only the next one is dispatched.
  - `unmount answers waiting slips no and the slip on the surface maybe at once, and lets a write in flight settle by
    itself`.
  - `a test slip is refused while a write is in flight`.
  - `two slips queued in one tick draw in order` (the page's gate lags a render, spec ruling 14: A and B queued before
    any re-render: A dispatched, B waits; after A's hand-off B is dispatched; each caller hears its own result; B stays
    withdrawable until its dispatch).
  - `busy covers every write in flight, drawing only the surface` — two lanes writing, surface idle: `busy` true,
    `drawing` false; after the second write ends, both false.
- [ ] **Step 2: Run** → FAIL (no `drawing`, `queueSlip` returns nothing, nothing armed).
- [ ] **Step 3: Implement** in the bridge and the provider as the rules say; keep the dispatch effect's order of
  guards (mounted, eod ready / slip code, node, text) exactly as today. If the bridge would pass 300 lines, move the
  ticket bookkeeping helpers (settle-or-release, the write end) into `lib/print-host-tickets.ts`.
- [ ] **Step 4: Run** the new file, `lib/print-host-bridge-late.test.ts`, `lib/print-host-paths.test.ts`,
  `lib/print-host-text-kot.test.ts`, `lib/offline-page-paths.test.ts` → PASS (each pin that moved: its reason in the
  commit); cafe `npm test` → 0 fail.
- [ ] **Step 5: Commit** `feat(print): the bridge draws one slip and writes each printer on its lane (Phase 6 Task 4)`.

### Task 5: The agent's cycle per line

**Files:**
- Create: `apps/cafe/lib/print-lines.ts`, `apps/cafe/lib/print-line-job.ts`, `apps/cafe/lib/print-lines.test.ts`,
  `apps/cafe/lib/print-lines-rules.test.ts`
- Modify: `apps/cafe/lib/print-agent.ts` (ends well under 300; the header comment says one job per line),
  `apps/cafe/package.json` (`testChain`), and the pins whose subject changes (each moved on purpose with its new text
  and reason; the big files shrink or keep their length): `lib/print-agent.test.ts` — its fake world (:60-100,
  `printersWorld` :1052) now runs lines in parallel, so every 2E test's expected lists are re-derived from the rules,
  never loosened (e.g. :1142-1160, the bill's lease names `["p-counter"]` when p-bar is still in flight; :1207 "several
  lines' jobs print one by one" becomes "one per line, as the surface frees"); `lib/print-agent-paths.test.ts:130-132`
  (`if (held.length > 0 && enabled && !busy) return void cycle(true);`, `if (deps.now() - next.at < PRINT_DIRECT_HOLD_MS) return next.job;`,
  `again = answers.get(key)?.more !== false;`) and `:186` (`failedAckBody(...)` now in `lib/print-line-job.ts`);
  `lib/print-agent-printers.test.ts:543` (`const data = await deps.lease(holds.open(ready()));`).

**Interfaces:**
- `PrintAgentDeps` (`lib/print-agent-types.ts`) is unchanged. `PrintAgent` changes in one place:
  `kick(printerId?: string, jobId?: string): void` (a `print-status` frame's job id; `hooks/use-print-agent.ts:308`
  passes `typeof job.id === "string" ? job.id : undefined` on the same line; `job`'s cast there gains `id?: unknown`;
  the world's `frame` passes it from now on). `setGate({ busy })` now means "the surface is drawing" (the caller passes
  `drawing`, Task 6).
- Produces:
  - `lib/print-line-job.ts`: `type LineJobEnd = { kind: "printed"; more: boolean } | { kind: "back"; at: number; local: boolean } | { kind: "failed"; more: boolean } | { kind: "unanswered" }`;
    `runLineJob(job: LeasedPrintJob, ctx: LineJobContext): Promise<LineJobEnd>` — today's cycle body after a job is
    taken (`lib/print-agent.ts:157-209`: print, the printed ack kept then flushed and its `more`; the slip-refusal count;
    the line's hold on a `sent: "no"`; the failed ack; `nextAttemptAt` → `back` with the hold's end when its line is
    held), with no lease and no device-wide flag.
  - `lib/print-lines.ts`: `createLineState()` → `{ occupy(line, key), release(line), inFlight(): string[], occupied(line): boolean, mayStart(line): boolean /* ruling 16 */, wantMore(line), takeMore(lines): boolean }`
    (pure; the held list, the wish and the device-wide quiet stay in the agent).
  - `runLineJob`'s failure branch (today's `:179-188`): a slip withdrawn undrawn (`printWriteOutcomeOf(error).message === PRINT_HOST_NOT_DRAWN_MESSAGE`)
    is acked `sent: "no"` like any refusal but never holds its line and never counts as a slip refusal (ruling 20).
- The agent's algorithm (one `pump()` called on every signal and every line's end; rulings 14–20, 25). `pump()` always
  tries both steps below; signals only decide whether a wish is added:
  1. Stopped or disabled: nothing.
  2. Held jobs: first the scan hands back every held job older than `PRINT_DIRECT_HOLD_MS` (as today's `nextHeld()`
     loop, `lib/print-agent.ts:80-86`), each one only marking its own line's kick (ruling 17), with no nested pump;
     then, if the gate is open (`!busy`), start the first held job (oldest first) whose line `mayStart` and is not in
     flight (at most one start per pump: the next comes with the next opening of the surface or a line's end); a line
     with a held job is occupied; while a device-line job is held, no printer-line job starts (ruling 16). Step 3 runs
     once per pump, after the scan.
  3. Lease: (a lease counts as in flight from the moment this step decides to lease, before the kept-acks flush, as
     today's `running = true` precedes `await flushAcks()`; a pump meanwhile only adds wishes) when no lease is in
     flight, the gate is open, the printer is ready, no refusal holds every line, no device-line job is held, and the
     free lines (`holds.open(ready())` minus occupied lines; in simple mode the device
     line when free and nothing is in flight; none while the device line is in flight) are not empty, and there is a
     wish or a free line wants more: flush the kept acks first (as today, the hand-back flush included), then read the
     free lines again (a line that freed during the flush is named, as today's lease names every open line), take the
     wish and those lines' wants, lease the free lines; the first job that may start starts at once, the rest are held;
     `retryAt` sets the timer.
  4. A started job occupies its line until `runLineJob` ends; then: `printed` with `more` → that line wants more;
     without → the device-wide quiet until now + 500 ms (as today's `quietUntil`); `back` → the timer for `at`; `failed`
     with `more` → wants more; `unanswered` → `acks.retryLater()` and the timer in `PRINT_AGENT_REFUSED_RECHECK_MS`;
     then `pump()`.
  5. `kick(printerId, jobId?)` (named): the M-1 filter as today; a `jobId` this tab holds or prints right now (held or
     in flight) → nothing (the frame came after its lease); else its line occupied → that line wants (cleared only by a
     lease that names the line; its ack's `more` merges into it and never clears it); free → a wish and `pump()`.
     `kick()` (unnamed): no line occupied → a wish and `pump()`; else a deferred wish that itself leases at the first
     pump after a line frees (today's "leases once after the running cycle"), naming the free lines then (ruling 25).
     A hand-back is a named kick for its own line (ruling 17). `nudge()`: a wish
     only when no line is in flight and the quiet is over (today's rule), then `pump()` either way (held jobs start).
     `take(job)`: the dedupe as today, held, `pump()` (no wish). `setGate`: as today, an opening nudges. The one timer:
     the agent remembers which lines' backoff (`back`) or refusal-hold end set it and on its fire kicks each of them by
     name; a lease's `retryAt` alone makes an unnamed kick. `stop()`: as today; jobs in flight finish and ack.

- [ ] **Step 1: Write the failing tests.**
  - `print-lines.test.ts` (`createLinesWorld({ twoStep: true })`, the nine scenarios), each against `TODAY` side by side:
    `direct: 0 leases, 3 acks (= TODAY)`; `frames: 2 leases, 3 acks (= TODAY)`; `framesLate: 1 lease, 3 acks (TODAY − 1
    lease: the late frames name jobs this tab already holds)`; `frameBusy: 1 lease, 2 acks (= TODAY:
    the frame becomes K's more, leased when K1 ends)`; `frameFree: 1 lease, 2 acks (= TODAY), B1's first byte before
    K1's cut (leased at once)`; `backlog: 2 leases, 5 acks (= TODAY: K's
    and B's more land while the next slip draws and share the lease at the surface's opening)`; `backlogSlow: 3 leases,
    5 acks (TODAY + 1 lease, P6-3: K's more lands with the surface free)`; `stuck: 0 leases, 3 acks (TODAY − 2 leases −
    2 acks), no hand-back` (the test named `a stuck line holds only itself`); `simple: 2 leases, 2 acks (= TODAY)`; every scenario `leases ≤ TODAY.leases + 1` and every
    job printed once; and the paper times: `direct` with `writeMs` 2 000: B1 drawn after K1's draw and before K1's cut,
    D1 likewise, the last cut ≤ 3 × 550 + 2 000 + 100 ms; `stuck` B1 and D1 cut before 3 × 550 + 100 ms, K1 at 60 000 +.
  - `print-lines-rules.test.ts`:
    `a line holds one slip in flight; its next starts only after its write and ack` (K1, K2 delivered: K2's draw starts
    after K1's ack answered);
    `the device line runs alone` (a device-line job and a printer-line job: never both in flight; each waits for the
    other);
    `a held device-line job never starves` (held behind a K job in flight while B and D jobs keep arriving: no B or D
    job starts and nothing is leased until it has started; it starts when K ends);
    `a hand-back is a wish to lease` (one step, `stuck`: the two hand-backs lead to a lease; B1 and D1 print once);
    `a slip withdrawn undrawn holds no line` (an answer `PRINT_HOST_NOT_DRAWN_MESSAGE` with sent no: acked failed sent no,
    no hold on its line, a lease follows the wish);
    `a line's ack with more leases at once, naming every free open line` (the lease's printer ids);
    `a kick while no open line is free leases once, when a line frees` (no lease while all are busy; exactly one after);
    `a named kick for a busy line waits for that line; for a free line it leases at once`;
    `a frame for a job this tab holds costs no lease` (`framesLate` in both worlds; and a frame for K2 while K1 is in
    flight and K's ack answers `more: false` still leases K once K frees: never left to the pulse);
    `a lease decided waits for nothing new` (a line's end and a hand-back pumping during the lease's kept-acks flush:
    one lease, not two; two hand-backs in one scan make one lease);
    `an unnamed kick while a line is busy leases once, after a line frees` (the pulse's and the wake's kicks);
    `the timer kicks the lines whose backoff set it by name` (K backed off, B writing: K leased at its time, not after B);
    `a line with a held job is never leased`;
    `a failure's backoff holds only its line; another line's kick is kept` (K refused with `nextAttemptAt`, a B kick
    meanwhile → B leased at once);
    `the quiet after an empty ack stays device-wide; a nudge while a line is in flight leases nothing` (K's empty ack,
    then a status nudge within 500 ms while B is idle: no lease; a kick within it: a lease);
    `a held job older than PRINT_DIRECT_HOLD_MS is handed back, per line`;
    `stop hands back every line's held jobs; jobs in flight finish and ack`;
    `a job delivered twice prints once, whichever line's turn it is`;
    `a refusal holds its own line only; the device line's hold stops every line`;
    `a cleared slip's answer on one line changes nothing on another` (K's ack answered `{ applied: true, status:
    "dismissed", more: false }` while B writes: B's ack and lease as without it);
    `a printed ack is kept before it is sent, per line` (the pending store holds K's and B's entries while both acks are
    unanswered; a new agent on the same store sends both first).
- [ ] **Step 2: Run** both files → FAIL (today's agent prints one slip at a time: `stuck` hands B1 and D1 back, the
  `direct` paper is serial).
- [ ] **Step 3: Implement** the split and the algorithm; `print-lines-today.test.ts` (Task 1) stays green with one
  change made in this task: its expectation for `framesLate` becomes {1, 3} (ruling 25: a frame for a job this tab
  holds costs no lease); every other scenario keeps `TODAY` exactly, so on a one-step device the new agent makes
  today's counts (S5). `TODAY` itself stays the recorded "before".
- [ ] **Step 4: Run** the new files, `print-lines-today.test.ts`, `lib/print-agent.test.ts`, `lib/print-agent-hold.test.ts`,
  `lib/print-agent-health.test.ts`, `lib/print-agent-paths.test.ts`, `lib/print-ack-offline.test.ts` → PASS; cafe
  `npm test` → 0 fail; `wc -l lib/print-agent.ts lib/print-lines.ts lib/print-line-job.ts` each ≤ 300.
- [ ] **Step 5: Commit** `feat(print): the print agent runs one job per printer line (Phase 6 Task 5)`.

### Task 6: The wiring: the gate, the bound, the offline slip

**Files:**
- Create: `apps/cafe/lib/print-agent-print.ts`, `apps/cafe/lib/print-agent-print.test.ts`
- Modify: `apps/cafe/hooks/use-print-agent.ts` (its `printOnce` / `print` move out; it shrinks), `apps/cafe/components/print/PrintHostDrain.tsx`
  (`busy: drawing` to `usePrintAgent`), `apps/cafe/components/layout/PrintHostProvider.tsx` (`queueOfflineSlip` through
  `offlineSlipWithBound`), `apps/cafe/lib/offline-send.ts`, `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Consumes: Task 4's `queueSlip(...) → { withdraw }`.
- Produces:
  - `interface AgentPrintSeams { queueSlip(slip: HostPrintSlip, done: HostPrintDone): { withdraw(): boolean }; targets(): Record<string, SlipPrintTarget>; takeovers(): readonly string[]; ready(): readonly string[]; today(): string; setTimer(fn: () => void, ms: number): unknown; clearTimer(handle: unknown): void }`
    — `ready()` is the printers this device prints here (`readyRef.current`, today's `printJobCopies` argument
    `localIds`), not `readyNow`.
  - `printSlipOnce(seams: AgentPrintSeams, job: LeasedPrintJob, writes: number): Promise<PrintAgentResult>` — today's
    `printOnce` (`hooks/use-print-agent.ts:160-178`) plus `writes` on the slip; at `PRINT_AGENT_SLIP_DEADLINE_MS` it
    calls `withdraw()`: when that withdrew, the answer is the ticket's own (`sent: "no"`); when it did not (the slip is
    on the surface or on its lane), it keeps waiting for the ticket's own end, which is bounded already (spec ruling 12:
    the watchdog and grace on the surface, each writer's deadline on the lane). No other early answer remains.
  - `agentPrint(seams: AgentPrintSeams): (job: LeasedPrintJob) => Promise<PrintAgentResult>` — today's `print`
    (`:183-193`: `markPrinterWriting` over the whole job, `printJobCopies`, the Windows printer re-read on a failure).
  - `offlineSlipWithBound(queueSlip: AgentPrintSeams["queueSlip"], slip: HostPrintSlip, timers: Pick<AgentPrintSeams, "setTimer" | "clearTimer">): Promise<OfflineSlipOutcome>`
    in `lib/offline-send.ts` — today's `queueOfflineSlip` body with the same rule ("no" when withdrawn at the bound;
    a slip on the surface or its lane is waited for and answered by its own end).
- The pins whose subject changes here, each moved on purpose with its reason: `lib/print-host-paths.test.ts:320` PIN (D)
  (`busy` → `drawing` to the agent), `lib/offline-page-paths.test.ts:59` (the provider's
  `const deadline = window.setTimeout(() => resolve("maybe"), PRINT_AGENT_SLIP_DEADLINE_MS);` → a pin on
  `offlineSlipWithBound` in `lib/offline-send.ts`: "no" when withdrawn, waited for otherwise),
  `lib/print-windows-printers.test.ts:62,97`, `lib/print-agent-printers.test.ts:428,590`,
  `lib/print-agent-paths.test.ts:112`, and `lib/printer/kot-text/text-kot-print.test.ts:223-224` (that file holds the
  PIN (S1): its other pins may move on purpose; its `PICTURE_FILES` table and the PIN (S1) test never change).
- `PrintAgentResult` (`lib/print-agent-types.ts`) gains `written?: number` on its ok branch (Task 7 reads it).

- [ ] **Step 1: Write the failing tests** in `print-agent-print.test.ts`:
  - `the 140 s bound withdraws a slip still waiting: sent no, never maybe`.
  - `a slip on its lane at the bound is waited for` (a fake queueSlip whose ticket is writing: no answer at 140 s; the
    write's own result 30 s later is the answer, so the line never frees under a write).
  - `a job on a printer this device does not print is refused sent no` (unchanged).
  - `markPrinterWriting spans the whole job` (on before the first write, off after the last copy).
  - `a takeover printer's slip is marked takeover` (pictures, Phase 4 §5.3).
  - `an offline slip still waiting at its bound is withdrawn: no` and `one on its lane is answered by its write` (via
    `offlineSlipWithBound`).
  - `the agent's gate is the surface` — a source pin: `PrintHostDrain.tsx` passes `busy: drawing` to `usePrintAgent`
    and `busy` to `useSelfOrderAutoPrint`.
  - `leaveWhenPrintFree waits for the last line` — two tracked prints (`trackPrintBusy`) ending 1 s apart: the gate's
    `go` runs once, after the second; `printHostBusySince()` stays the first one's start while they overlap (one hold,
    as a serial chain today) and is null after the last (spec ruling 3).
- [ ] **Step 2: Run** → FAIL (module not found).
- [ ] **Step 3: Implement**; `use-print-agent.ts` builds its seams from its refs and calls `agentPrint(seams)`.
- [ ] **Step 4: Run** the file, `lib/offline-page-paths.test.ts`, `lib/offline-send.test.ts`, `lib/print-agent-paths.test.ts`
  → PASS (moved pins with reasons); cafe `npm test` → 0 fail; typecheck 0.
- [ ] **Step 5: Commit** `feat(print): the agent waits on the drawing only; a slip never drawn goes back unprinted (Phase 6 Task 6)`.

### Task 7: Copies

**Files:**
- Create: `apps/cafe/lib/print-copies.ts`, `apps/cafe/lib/print-copies.test.ts`
- Modify: `apps/cafe/lib/print-agent-printers.ts` (`printJobCopies` moves out: −17 lines; the "2C" pins of
  `lib/print-agent-printers.test.ts` that read it point at the new file, with reasons; its `printJobCopies({ printerId })`
  cases (:410-420) move into `print-copies.test.ts` with the new `kind` field, so that file shrinks),
  `apps/cafe/lib/print-agent-print.ts`, `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces: `printJobCopies(job: Pick<LeasedPrintJob, "printerId" | "copies" | "kind">, localIds: readonly string[], printOnce: (writes: number) => Promise<PrintAgentResult>, bytesOnce: boolean): Promise<PrintAgentResult>`;
  `copiesDrawnOnce(job: Pick<LeasedPrintJob, "kind" | "copies">, target: SlipPrintTarget | undefined): boolean` = kind
  `"kot"`, copies > 1 and `laneKeyOfTarget(target) !== null` (ruling 24).
- Rules: not a local printer → refused `sent: "no"` (today). `bytesOnce`: ask for all remaining copies in one
  `printOnce(left)`; it answers `written` (1 when absent); ask again for what is left (one draw each) until none is left.
  Otherwise one `printOnce(1)` per copy (today's loop). Any failure after a copy is written → "maybe" (today's rule);
  a failure before any copy → that failure.

- [ ] **Step 1: Write the failing tests** in `print-copies.test.ts`:
  - `a KOT on a two-step lane draws once and writes N times` — `printOnce` called once with 3; result ok.
  - `a bill draws every copy` — 2 copies → `printOnce(1)` twice.
  - `a KOT that was not handed off prints the rest one draw each` — the first answer `written: 1` → then `printOnce(1)`
    twice more (3 copies); never fewer copies than asked, never more.
  - `the first failure before any copy is its own; after a copy it is maybe`.
  - `a job not on this device's printers is refused sent no`.
  - `copiesDrawnOnce` — kot/2/native → true; kot/1 → false; bill/2/native → false; kot/2/printerName → false;
    kot/2/lan → true.
  - `the KOT renderers read no clock` — a source pin over `components/pos/KOTReceipt.tsx`,
    `components/print/slip/kot-classic-blocks.tsx`, `components/print/slip/kot-bold-blocks.tsx` and every non-test file
    of `lib/printer/kot-text/`: no `new Date()` without an argument, no `Date.now()`, no `performance.now()`; and the two
    KOT block files read no `now` / `nowMs` from the slip context (the engine's render clock, `SlipEngine.tsx:46` /
    `slip-context.ts:51`, serves bill blocks only).
  - `the text KOT's bytes are the same twice` — slips built with `slipOf` (`lib/printer/kot-text/kot-text.fixtures.ts`):
    a plain KOT, a REPRINT banner, a VOID, a MOVED, a cancel notice, an `OFFLINE · O-3` banner, a QR round; each
    through `kotTextJob` twice: equal bytes.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; `agentPrint` passes `copiesDrawnOnce(job, target)`; the bridge's `take` uses `slip.writes`.
- [ ] **Step 4: Run** the file, `lib/print-agent-printers.test.ts`, `lib/print-host-bridge-lanes.test.ts` (add one
  case: `a slip asked for 2 writes writes the same bytes twice on its lane`) → PASS; cafe `npm test` → 0 fail.
- [ ] **Step 5: Commit** `feat(print): a kitchen slip's copies are drawn once on a printer's lane (Phase 6 Task 7)`.

### Task 8: The scope pins, verification, the fresh review, the Results

**Files:**
- Create: `apps/cafe/lib/print-phase6-pins.test.ts`
- Modify: the comments of ruling 28 (`lib/print-agent.ts` header, `hooks/use-print-host-bridge.ts:8`,
  `lib/print-agent-acks.ts:11`, `lib/print-write-outcome.ts:25-26`, `lib/print-agent-slip.ts:12-14`),
  `apps/cafe/package.json` (`testChain`), this plan (Results)

- [ ] **Step 1: Write the pins** in `print-phase6-pins.test.ts`: `nothing imports the scenario world but tests`;
  `lane-print.ts and desktop-shell.ts are untouched` (their sha256 equal the PIN (S1) entries, read from that test's
  table, not copied); `print-budget.test.ts is untouched` (its sha256 at 0c794d6, written in the test);
  `the agent makes no new kind of request` (the only `apiSend` URLs in `lib/print-agent*.ts`, `lib/print-line*.ts`,
  `lib/print-lines.ts`, `hooks/use-print-agent.ts` are the lease, the ack and the existing calls of `main`);
  `no new timer` (`setTimeout` / `setInterval` appear in none of the new non-test files; the agent's one timer is its
  deps').
- [ ] **Step 2: Run everything:** cafe `npm test` (expected 8219 + the new tests − the removed FIFO test, 0 fail, 1
  skip), `npm run typecheck` 0, lint 0 errors, shared `npm test` 1079 (unchanged), the live legs on a fresh
  `pos_scratch_print_host_6a2` (all passed, the count of Task 0), `git diff --stat 0c794d6 -- apps/mobile apps/desktop packages workers apps/cafe/app/api apps/cafe/models`
  empty, the PIN (S1) green.
- [ ] **Step 3: The fresh review:** a Claude Fable 5.1 reviewer, read-only, on `0c794d6..HEAD` with the spec and this
  plan; one fix wave, test first; record its verdict, findings and rulings in the Results.
- [ ] **Step 4: Results** ("Session 6A Results": commits, RED → GREEN per task, counts before → after, the line counts
  of every file the plan budgets, the review, differences from the plan and why, what 6B must know).
- [ ] **Step 5: Commit** `docs(print): Phase 6 Session 6A Results`.

---

# Session 6B (spec, fixed interfaces): the exit

Start: verify 6A (every task's commit, the counts of its Results, `wc -l` of the budgeted files). Tools in
`D:\kd\pos-dev-keep\phase6\session-6b\` (copied from `..\design-harness\`; every run its own long-path `--out` with a
keep.txt; count `bytes>0` lines from the current total; a fresh `pos_scratch_e2e_4g_p6b*` database per run, dropped at
the end; the fake printer is the repo root's `scripts/fake-escpos-printer.mjs`, `../../scripts/` from `apps/cafe`).
Builds: the "before" = `main` 0c794d6, the "after" = the 6A head, each a worktree on `D:\kd\` with
`link-modules.ps1`, the nocache edit and `NEXT_TELEMETRY_DISABLED=1` (check `df -h /d` first), served on free ports of
ours; never measure while a build, a suite or a subagent runs.

### Task 10: Speed, the stuck printer and the requests on fake printers

The design harness (`pw-6m.mjs`: headless Chrome as the POS app on bridge v2, four fake printers 9101–9104, the page's
request log grouped by path) on the 6A build, 5 rounds each, `FAKE_WAIT_CLOSE=1` for the slow and stuck runs. Expected
against spec §5's "before": M1 each median within +50 ms of 649 / 1,222 / 1,796; M1-slow last cut ≤ 4,500 ms (before
7,860) with Bar and Desserts drawn while Kitchen writes; M1-stuck Bar and Desserts first byte ≤ 2,500 ms (before
63,308 / 63,893), Kitchen's cut at its 60 s; per round 3 KOT acks and 0 leases in all three runs (stuck before: 5 + 2),
the bill 1 ack; `check6m.mjs`: every job printed once, no label, no duplicate key or KOT number.

### Task 11: The paper (S1) and the copies

The 4B gate's S1 tools (`D:\kd\pos-dev-keep\phase4\gate-4a\e2e\`: `pw-4b.mjs`, `payloads.json`, `e2e-final.sh`, as
5B's `s1.sh`) on both builds: simple mode on bridge v1 9/9 and printers mode on bridge v2 9/9 slips byte for byte
equal. Then per printer on the four-printer setup: each printer's files of the same rounds equal between the builds
(Task 10's M1 bytes: Kitchen 48,342, Bar and Desserts 44,382, bill 47,838); a KOT with `copies.kot = 2` on Kitchen,
once with the classic ticket and once with a saved KOT design (the 4B gate's `kot-template-qr.json`): two files each
time, equal to each other and to the "before" build's two; a bill with `copies.bill = 2`: two files, each equal to the
"before" build's (the same minute).

### Task 12: The lifecycle paths end to end (printers mode, three station printers and a bill)

Each a headless run with its expected result: an offline KOT (`context.setOffline`) prints `OFFLINE · O-n` on every
station printer at once and replays once, nothing twice (5B/5C's `m3`); "clear after this try" on Kitchen's slip while
Kitchen writes (`--delay 20000`) and Bar prints: Kitchen's slip ends dismissed after its try, Bar's prints and acks
untouched; a deploy's quiet reload and a navigation while two lines write wait until the last write ends (the page
loads once, no REPRINT); a stuck printer past 30 s offers "Refresh anyway" as today; a refused printer (`--refuse` on
Bar): Bar's line held, Kitchen and Desserts print; a lost ack on one line while another prints (5C's
`D:\kd\pos-dev-keep\phase5\session-5c\lost-proxy.mjs` pattern): one REPRINT copy on that printer, nothing else twice.
After each: `check6m.mjs` clean.

### Task 13: The Windows app and the emulator

The Windows app smoke (5C's `win\smoke-5c.mjs` + `boot5c.js` pattern, out = 2.0.2): two network printers (`printRaw`)
print in parallel (the second's first byte about one draw after the first); a Windows printer (`printHtmlOn`) and a
network printer in one round: the Windows printer one at a time as today. The emulator (Pixel_7_API_33,
`-no-snapshot -no-metrics -memory 4096`, background, 2 h): `pm path com.possoftware.pos` first and what it shows (never
posdemo or a real cafe for a write); uninstall the as-found `29115bdf`, install
`D:\kd\pos-dev-keep\phase4\session-4c\pos-x86_64-4c-99b5b763.apk`, point it at the local harness, two network printers
10.0.2.2:9101 and :9102, on WebView 154 and on the factory 109: a two-station round prints both, the second about one
draw after the first; one printer at `--delay 60000` does not hold the other; crash buffer empty. Put back: remove the
printers, `29115bdf` reinstalled (empty start screen), WebView 154 back from `D:\kd\pos-dev-keep\webview-154\base.apk`,
reverse off, `adb shell sync`, `adb emu kill`.

### Task 14: The soak

`apps/cafe/scripts/print-soak.ts` in its `neither` mode (`:35-36`: another device prints, the soak only orders and
waits; in printers mode the soak's own agent is the writer, which would not exercise the page), with the design
harness's headless POS app (bridge v2, the page's agent) as the printing device for three station printers and a bill
printer, one of them `--drop-after … --drop-every`; the same orders on both builds: every job checked on paper (no
missing, no duplicate, labels only where a drop made a REPRINT); leases and acks counted from the page's own request
log (or 5C's `lost-proxy.mjs` in front of the server); leases per printed slip on the 6A build ≤ 1 plus one trailing
lease per burst (P6-3), and the ratio against the "before" build reported.

### Task 15: The docs

`docs/GO-LIVE-CHECKLIST.md` "Existing cafes: the printing Phase 6 release" (web only, no app; demo cafe first; P6-4:
a cafe where one phone prints two Bluetooth printers only after the owner's check on such a phone; the rollback is the
build before Phase 6 from the admin panel); `apps/mobile/TEST-CHECKLIST.md` "Phase 6 checks (parallel printing)" (a
three-station round on one phone with two Bluetooth printers and a network printer; one printer off mid-round; a
two-copy KOT; the owner's notes); pins in a new `apps/cafe/lib/go-live-runbook-phase6.test.ts` (its own file: the old
runbook test is over 1,700 lines). `apps/mobile`'s own tests read its docs: run them when TEST-CHECKLIST changes.

### Task 16: The final review and the Results

A fresh Claude Fable 5.1 review of `0c794d6..HEAD` (read-only); one fix wave; "Session 6B Results" (every expected
above with its measured value); then the owner's merge OK.
