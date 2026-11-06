# Printer UX Implementation Plan (a simple panel, a clear "printer stopped" path, a list that really clears)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task, each task test first
> (superpowers:test-driven-development). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The printer panel opens on one status card that says whether printing works and, when it does not, at most 3
steps and the one button that fixes it (the right printer in printers mode); a short "Not printed" list whose every
button works and whose Clear always removes the slip for good; everything to set up a printer one tap away in the
same sheet.

**Architecture:** Pure view models decide every word and button (`lib/printer/printer-status-view.ts`,
`lib/print-waiting-view.ts`); the panel draws them in two views of the one Radix dialog (status, settings; PX-3 adds the
guided connect). The server learns one thing: a staff Clear on a slip that is being printed is kept on the job
(`dismissRequestedAt`) and ends it as `dismissed` when that try ends without paper (inside `planAck` / `planExpiry`, in
the CAS), plus one Clear-all route. Every other change rides data the page already has.

**Tech Stack:** TypeScript, Next.js 15 App Router (page + API routes), React 19, TanStack Query v5, zod, Mongoose
(MongoDB Atlas M0), Radix Dialog, Tailwind v4, node:test with tsx (+ `react-dom/server` renders), the print-host live
legs (`npm run verify:print:live`), the PX harness (`D:\kd\pos-dev-keep\printer-ux\tools`).

**Spec:** `docs/superpowers/specs/2026-11-05-printer-ux-design.md` (approved by the owner on 2026-11-05). Section numbers
(§n), SR-n, PX-Dn and Bn below are the spec's. Mockups (local only): `D:\kd\pos-dev-keep\printer-ux\mockups\index.html`.

## How this plan runs

The owner's workflow (one phase per session) on the fast path: two build sessions on `feat/printer-ux`, each test first,
one commit per task, a fresh review at its end, then the orchestrator's check before the next prompt.

| Session | Delivers | Before the next |
|---|---|---|
| PX-2 | **Exact below (Tasks 0–8).** The client's pain: the clear request (server + lifecycle), Clear all, the Not printed card, the status card and its words, printers mode (the right printer, the amber phone), the two views (settings = today's setup, moved), the alarm, the printed-ack removal, the job toast words, no flicker. | the orchestrator's check; PX-3 made exact if needed |
| PX-3 | **Exact below (Tasks 10, 10b, 11–14).** The settings cards, the guided connect, the words everywhere, one row per printer, the Location Allow, responsive polish. | the owner's merge OK |

Each session ends with every suite green, a fresh Claude Fable 5.1 review of its range (read-only; on an HTTP 429 wait
for the reset and say so; never switch models silently; resume a cut reviewer with SendMessage), one fix wave, and its
"Session PX-n Results" section at the end of this file (commits, RED → GREEN per task, counts before → after, the review
and its rulings, every difference from this plan and why). Native items (2.0.3) are not in this plan (PX-D7).

## Global Constraints

- Branch `feat/printer-ux` from main `82e3321`. Never on `main`; merge only on the owner's explicit OK; push only when the
  owner says, only with the token store (`GIT_TERMINAL_PROMPT=0`), `origin/main` fetched first.
- **SR-1 the paper:** `PIN (S1)` in `apps/cafe/lib/printer/kot-text/text-kot-print.test.ts` green and unchanged; no file
  under `apps/cafe/lib/printer/kot-text/`, `components/print/slip/`, `components/pos/KOTReceipt.tsx`,
  `components/pos/OrderReceipt.tsx`, `packages/shared/src/print-design*` changes (Task 8 checks with `git diff --stat`).
- **SR-2 budget:** `packages/shared/src/print-budget.test.ts` unchanged except the one test Task 2 adds; no new poll,
  `refetchInterval`, `setInterval` that calls the server, `router.refresh`, realtime message or cron.
- **SR-3/4/5/6/7 the lifecycle:** only `planAck`, `planExpiry`, `planRetry` and `planConfirm("reprint")` change, and only
  for a job with `dismissRequest` (the first two end it dismissed unless it printed; a late printed ack still wins; the
  last two unset a leftover request); every other plan, and every plan for a job without the request, is today's for
  every input (Task 1 pins it). `dismissPrintJob` and its seven server callers are unchanged (spec R2).
- **SR-11:** no file under `apps/cafe/lib/offline-*`, `lib/pos-send*`, `hooks/use-offline-send*`, `hooks/use-pos-send*` changes.
- **Words:** exactly the spec's §6.3 / §6.4 / §6.9 strings (copy them; never paraphrase). The lane constants in
  `lib/printer/web-printer-types.ts` and `lib/printer/lane-print.ts` stay byte-identical (they are also `lastError`).
- **UI:** the U0–U6 rules (WebView 109 safe CSS: no `light-dark()`, no runtime `color-mix()`, no `in oklab`, no
  `mask-image`; flex buttons `w-full` / `items-stretch`; WebView 154's inset; never a native `<select>`; below 1280 px the
  panel is the full-screen sheet; 44 px touch; 16 px inputs below 720 px; the tokens of `app/globals.css`); P1's (no
  `:has()` on html / body / a page-wide box, no page fade). The frame (`PrinterPanelFrame`) stays one Radix dialog.
- **Tests:** every new cafe test file into `apps/cafe/package.json` `testChain`; every new shared test file into
  `packages/shared/package.json`'s `test` list; every assertion carries a message; live legs in
  `apps/cafe/scripts/print-host-live/*.ts`, wired in `scripts/verify-print-host-live.ts`, run on a fresh
  `pos_scratch_print_host_px2` database (dropped at the session's end). Files ≤ 300 lines, tests too. Files already
  over (or at) the limit grow only by one-line call sites into new files, at most: `packages/shared/src/print-lifecycle.ts`
  (546) +12, `apps/cafe/hooks/use-print-agent.ts` (337) +3, `apps/cafe/lib/print-agent-printers.ts` (358) +4,
  `apps/cafe/lib/print-lease.ts` (343) +2, `apps/cafe/components/layout/PosPulseProvider.tsx` (298, pinned ≤ 300 by
  `lib/pos-pulse-paths.test.ts:169-175`) net 0.
- **Pins** change only on purpose, each named in its task and in the Results: `lib/printer-panel-layout.test.ts`,
  `lib/printer-ui-paths.test.ts`, `lib/printer-dot-ui-paths.test.ts`, `lib/print-host-card-paths.test.ts`,
  `lib/pos-pulse-paths.test.ts`, `lib/print-waiting.test.ts`, `lib/printer/printer-dot.test.ts`. No pin is deleted to pass.
- **Environment:** `df -h /c /d` first (stop and ask if D: < 1.5 GB); mongod 127.0.0.1:27017 is shared: only
  `pos_scratch_*` databases this session makes; only this project's processes; ports :3175 (harness) and :9111/:9112
  (fake printers) are ours, :3110/:3130/:3140 are not; `NODE_OPTIONS=--max-old-space-size=6144 npx eslint .` for lint;
  long runs in the background; one browser at a time; no build while the chain or a subagent runs.
- Local only: no connector, Artifact or Docs tool, no upload, no deploy, no tunnel. Repo text in English; messages to
  the owner in Hinglish. Commit messages through a scratch file and `git commit -F`, ending with the session's
  Co-Authored-By line.

## Review Focus

1. **A Clear lands while its slip is being printed, and the try then fails, prints, or its lease runs out** → the slip
   never comes back to the list; paper that came out is `printed`. Pinned in Task 1 (every exit) and Task 2 (the live
   leg, incl. the interleaving where the ack read the slip before the Clear).
2. **Printers mode with two printers on one tablet: one down, both down, the default fine but the Kitchen printer down**
   → the card names the printer that is down and Reconnect reconnects exactly the ones down. Pinned in Task 5
   (`printersHereOf`, the subject) and Task 6 (`reconnectDown` calls only those, in order, the first inside the click).
3. **The list changed under the tap** (printed, cleared on another device, pruned) → the row leaves and the words are
   honest ("This slip is no longer waiting."), never "Check the connection". Pinned in Task 4 (`rowActionNoticeOf`).
4. **An open old page during the deploy** (its Clear on a leased slip; its agent reading an ack answer `dismissed`) →
   no row returns, the agent stops trying that job. Pinned in Task 2 (the answer shape, `nextAttemptAt: null`).
5. **The app's own retries flip a printer connected / connecting / disconnected every few seconds** → no red ↔ checking
   flicker, yet a real "connected" shows at once and a first "connecting" with nothing settled is still "Checking…".
   Pinned in Task 5 (`heldPrinterStatusOf`).

## The design round's builder check (2026-11-05)

A fresh engineer read the spec and the code alone; its ten questions and five corrections are settled as rulings R1–R15
in the spec's §14 (none needed the owner). The planning review (Claude Fable 5.1, "With fixes", 0 C / 6 I / 8 M) is
the spec's §15; its fixes are in Tasks 2, 4, 5, 6 and 7 below (F-I1 … F-M8). The plan below already follows them: R1 (fresh rows only) in Task 5, R2
(`dismissPrintJobByStaff`) and R7 (the replay's select) in Task 2, R3 / R5 / R6 in Task 3, R7 / R8 in Task 1, R9 / R11 /
R13 in Task 5, R10 (the panel's own hook; the band untouched) in Task 4, R12 in Task 7, R15 in Task 2.

## File structure

| File | Task | Responsibility |
|---|---|---|
| `packages/shared/src/print-lifecycle-clear.ts` (+ test) | 1 | `clearRequestedOutcome`: a leased job with a clear request ends `dismissed` unless it printed |
| `packages/shared/src/print-lifecycle.ts` | 1 | the doc / lifecycle fields; `planAck`, `planExpiry` call the above |
| `packages/shared/src/print-agent-wire.ts` | 2 | `PRINT_DISMISS_MANY_MAX` |
| `apps/cafe/models/PrintJob.ts`, `lib/print-lease.ts` | 2 | the two fields; the select; the CAS |
| `apps/cafe/lib/print-dismiss.ts` | 2 | `dismissPrintJobByStaff` (today's dismiss, then the leased request), `dismissPrintJobs` |
| `apps/cafe/app/api/print-jobs/[id]/dismiss/route.ts`, `lib/print-offline-replay.ts` | 2 | the single route calls `dismissPrintJobByStaff`; the replay's select reads the request |
| `apps/cafe/app/api/print-jobs/dismiss/route.ts` | 2 | `POST` Clear all |
| `apps/cafe/scripts/print-host-live/clear-while-printing.ts` | 2 | the live legs |
| `apps/cafe/lib/print-waiting-view.ts` (+ test) | 3 | the Not printed card's rows, words, buttons, order; `withoutAttentionRows` |
| `apps/cafe/components/print/NotPrintedCard.tsx`, `NotPrintedSection.tsx` | 4 | the card (props only) and its container (replace `WaitingSlipsCard.tsx`) |
| `apps/cafe/hooks/use-not-printed-actions.ts`, `lib/print-job-notices.ts` (+ test) | 4 | the panel's actions, Clear all, the cache edits, the words of an answer (the band keeps `use-print-job-actions.ts` as today) |
| `apps/cafe/lib/printer/held-status.ts` (+ test) | 5 | B6, no flicker |
| `apps/cafe/lib/print-agent-here.ts` (+ test) | 5 | `printersHereOf`, `printersNotHereOf` |
| `apps/cafe/lib/printer/printer-dot.ts` | 5 | the `printer-waiting` reason; `printerHeadlineOf` and its copy deleted (R11) |
| `apps/cafe/lib/printer/printer-status-view.ts` (+ test) | 5 | §6.4's table |
| `apps/cafe/lib/print-waiting.ts`, `components/layout/print-waiting-context.ts`, `PosPulseProvider.tsx`, `hooks/use-agent-printers.ts` | 5 | the waiting printers' narrow context; `useDotPrinters` with here / held / waiting |
| `apps/cafe/components/print/PrinterStatusCard.tsx`, `PrinterHereCard.tsx`, `PrinterSettingsRow.tsx` | 6 | the status view's parts (the card replaces `PrinterStatusBanner.tsx`) |
| `apps/cafe/components/print/PrinterPanel.tsx`, `PrinterPanelFrame.tsx`, `PrinterStatusButton.tsx`, `app/(dashboard)/printers/page.tsx` | 6 | the two views, the head, the page home |
| `apps/cafe/lib/printer/reconnect-down.ts` (+ test) | 6 | Reconnect the printers that are down |
| `apps/cafe/lib/printer-panel-open.ts`, `lib/print-waiting.ts`, `hooks/use-print-slip-alarm.ts` | 7 | B5 |
| `apps/cafe/hooks/use-print-agent.ts`, `lib/print-pulse-edit.ts` | 7 | B4 (`dropPrintedFromPulse`; the agent's listener ignores manual writes) |
| `apps/cafe/components/layout/PrintWaitingProviders.tsx` | 5 | the count and the waiting printers, derived once, provided together |
| `apps/cafe/lib/print-host-slips.ts`, `lib/print-agent-slip.ts`, `hooks/use-print-host-bridge.ts`, `lib/print-job-toast.ts` (+ test) | 7 | B7 |

---

# Session PX-2 (exact): the status view, the Not printed list, the behaviour fixes

Acceptance: the panel opens on the status view (§6.2) with §6.4's words; the Not printed card (§6.3) with Clear, Clear all
and only the buttons that work; a Clear never lets a slip come back; printers mode names and reconnects the right
printer and a device that prints nothing turns amber; the settings view holds today's setup unchanged; B4–B7 work; every
suite, S1 and the budget green. Work in `D:\kd\lucifer` on `feat/printer-ux`; a single cafe test:
`node --import tsx --test lib/<name>.test.ts` from `apps/cafe`; a single shared test: `node --import tsx --test
src/<name>.test.ts` from `packages/shared`.

### Task 0: Baseline

- [ ] `df -h /c /d`; `git status` clean; `git log --oneline -1` = this plan's commit on `feat/printer-ux`.
- [ ] Record (the Results' "before"): cafe `npm test` (expected at 82e3321: 7607 / 7606 pass / 0 fail / 1 skip), cafe
  `npm run typecheck` (0), lint (0 errors, 2 old warnings), shared `npm test` (1062), and the live legs on a fresh
  database: `MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host_px2 npm run verify:print:live` from `apps/cafe`
  (expected 499 passed, 0 failed).

### Task 1: The clear request in the lifecycle (shared)

**Files:**
- Create: `packages/shared/src/print-lifecycle-clear.ts`, `packages/shared/src/print-lifecycle-clear.test.ts`
- Modify: `packages/shared/src/print-lifecycle.ts` (`PrintJobLifecycle` :93, `PrintJobLifecycleDoc` :106,
  `PrintJobUnsetPath` :139, `lifecycleOf` :197, `planExpiry` :438, `planAck` :445 incl. its resolved branch :465,
  `planConfirm` :479, `planRetry` :512), `packages/shared/package.json` (`test` list)

**Interfaces:**
- Produces: `PrintJobLifecycleDoc.dismissRequestedAt?: Date`, `PrintJobLifecycleDoc.dismissRequestedBy?: string`;
  `PrintJobLifecycle.dismissRequest?: { at: Date; by: string }` (`lifecycleOf` sets it when `dismissRequestedAt` is a
  Date; `by` = `dismissRequestedBy` or `"Staff"`); `PRINT_CLEARED_WHILE_PRINTING = "cleared while printing"`;
  `clearRequestedOutcome(job: PrintJobLifecycle, plan: PrintJobPlan, nowMs: number, deviceId?: string): PrintJobPlan`;
  `dismissRequestOf(doc: PrintJobLifecycleDoc): PrintJobLifecycle["dismissRequest"]` (the normaliser `lifecycleOf` calls
  in one line); `lateAckAfterClear(job, ack, nowMs): PrintJobPlan | null` (R8; `planAck`'s resolved branch calls it in one
  line); all three helpers live in `print-lifecycle-clear.ts` (F-I5: `print-lifecycle.ts` grows ≤ 12 lines);
  `PrintJobUnsetPath` += `"dismissRequestedAt" | "dismissRequestedBy"`; `withoutClearRequest(job, plan): PrintJobPlan`
  (a queued plan for a job with the request gets both paths in `unset`; used by `planRetry` and `planConfirm("reprint")`);
  `planAck`'s resolved branch: a `dismissed` job WITH `dismissRequest`, the same epoch and a printed ack → the late-ack
  printed patch (R8).
  `print-lifecycle-clear.ts` imports only types from `print-lifecycle.ts` (`import type`: no runtime cycle).

- [ ] **Step 1: Write the failing tests** in `print-lifecycle-clear.test.ts` (a leased KOT and a leased bill, epoch 3,
  `dismissRequest: { at, by: "Asha" }`, `nowMs` fixed):
  - `a failed try that sent nothing ends dismissed, not queued` — `planAck(job, { deviceId: "d1", epoch: 3, outcome:
    "failed", sent: "no" }, now)` → `ok`, `patch.status === "dismissed"`, `set.dismissedBy === "Asha"`, `set.dismissReason
    === "staff"`, `set.dismissedAt` = now, `unset` deep-equals `["lease"]`, `log.event === "dismissed"`, `log.detail ===
    "cleared while printing"`.
  - `a maybe try ends dismissed: no REPRINT for a KOT, no check for a bill` — `sent: "maybe"` on the KOT and on the bill
    → `dismissed`; neither `set.labels` nor `needs-confirm`.
  - `a permanent failure and a try over the limits end dismissed` — `permanent: true` → `dismissed`; `uncertainAttempts:
    1` + maybe → `dismissed` (not `failed`).
  - `paper that came out still wins` — `outcome: "printed"` → `status === "printed"`.
  - `a lease that ran out ends dismissed; a held lease is still held` — `planExpiry` after `expiresAt` → `dismissed`;
    before → `{ ok: false, reason: "lease-held" }`.
  - `a stale or late ack is untouched` — epoch 2 failed → today's refusal; a `dismissed` job + printed ack →
    `{ ok: false, reason: "resolved" }`.
  - `without a request every plan is today's` — for each of the cases above, the same job without `dismissRequest`
    deep-equals the plan computed today (build the expectation by calling the function on a copy without the field and
    comparing to a hand-written expectation for 3 of them: sent no → queued, KOT maybe → queued REPRINT, bill maybe →
    needs-confirm).
  - `lifecycleOf reads the request` — `{ dismissRequestedAt: d, dismissRequestedBy: "Asha" }` → `{ at: d, by: "Asha" }`;
    without `dismissRequestedBy` → `by === "Staff"`; without `dismissRequestedAt` → `dismissRequest === undefined`.
  - `a late printed ack on a slip the request ended is printed` — a `dismissed` job with the request, epoch 3, printed
    ack epoch 3 → `printed` (event `late-ack`); epoch 2 → refused; a `dismissed` job WITHOUT the request → `resolved` as
    today.
  - `Try again and Print again unset a leftover request` — a queued / failed job with the request: `planRetry` and
    `planConfirm(job, "reprint", …)` → today's patch plus `unset` containing both paths; without the request → today's
    patch exactly.
  - `lease and limits ignore the request` — `planLease`, `planLimits`, `planConfirm("printed" | "dismiss")` on a job with
    the field deep-equal the same call without it.
- [ ] **Step 2: Run** `node --import tsx --test src/print-lifecycle-clear.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `clearRequestedOutcome` (when `job.dismissRequest` is set, `plan.ok`, and `plan.patch.status`
  is `queued`, `needs-confirm` or `failed`: return the dismissed patch above; otherwise `plan` unchanged) and
  `withoutClearRequest`; the fields and unset paths; `lifecycleOf`; wrap the returns of `planAck`'s leased branch and of
  `planExpiry`, add the late-ack case, wrap `planRetry` and `planConfirm("reprint")`. Add the test file to the `test` list.
  The cafe's `PrintJobUpdate.$unset` type (C/lib/print-lease.ts:77) takes the two new paths in Task 2.
- [ ] **Step 4: Run** the new file and `src/print-lifecycle.test.ts`, `src/print-lifecycle-offline.test.ts` → PASS;
  shared `npm test` → 1062 + the new tests, 0 fail.
- [ ] **Step 5: Commit** `feat(print): a clear asked while a slip prints ends it once that try ends (PX-2 Task 1)`.

### Task 2: The server: Clear while printing, Clear all, the budget line

**Files:**
- Create: `apps/cafe/lib/print-dismiss.ts`, `apps/cafe/app/api/print-jobs/dismiss/route.ts`,
  `apps/cafe/scripts/print-host-live/clear-while-printing.ts`, `apps/cafe/lib/print-dismiss-route.test.ts`
- Modify: `apps/cafe/models/PrintJob.ts` (fields beside `dismissedBy` :50 / :114), `apps/cafe/lib/print-lease.ts`
  (`PRINT_LIFECYCLE_SELECT` :39 + ` dismissRequestedAt dismissRequestedBy`; `printJobCasFilter` :71; `PrintJobUpdate.$unset`
  :77), `apps/cafe/lib/print-offline-replay.ts` (its select :44 + the two fields, R7),
  `apps/cafe/app/api/print-jobs/[id]/dismiss/route.ts` (calls `dismissPrintJobByStaff`), `packages/shared/src/print-agent-wire.ts`,
  `packages/shared/src/print-budget.test.ts` (one new test), `apps/cafe/scripts/verify-print-host-live.ts`,
  `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Consumes: Task 1's fields and `PrintJobLifecycle.dismissRequest`.
- Produces: `printJobCasFilter(id, job: Pick<PrintJobLifecycle, "status" | "epoch" | "dismissRequest">)` adds
  `dismissRequestedAt: { $exists: job.dismissRequest !== undefined }`; `requestDismissWhilePrinting(input: { id: string;
  dismissedBy: string; nowMs: number }): Promise<boolean>` (CAS `{ _id, status: "leased", claimedAt: { $exists: false } }`
  → `$set { dismissRequestedAt, dismissRequestedBy }`); `dismissPrintJobByStaff(input: { id: string; dismissedBy: string;
  nowMs: number }): Promise<DismissPrintJobResult>` = up to 2 rounds of [`dismissPrintJob` (unchanged) → the leased CAS],
  then today's `not-found` / `raced`; `dismissPrintJob` and its server callers untouched (R2);
  `PRINT_DISMISS_MANY_MAX = PRINT_ATTENTION_LIMIT` (20); `dismissPrintJobs(input: { ids: string[]; dismissedBy: string; nowMs: number }): Promise<{ dismissed:
  number }>` (an `updateMany` with the single CAS's filter + `_id: { $in }`, an `updateMany` setting the request on the
  leased ones, the first `updateMany` once more; the count = the three `modifiedCount`s); route `POST
  /api/print-jobs/dismiss` body `z.object({ ids: z.array(z.string()).min(1).max(PRINT_DISMISS_MANY_MAX), reason:
  z.literal("staff") }).strict()`, each id `mongoose.isValidObjectId` (else 400 "Print job not found"), auth and
  `noStore` as the single route; answer `success({ dismissed })`.

- [ ] **Step 1: Write the failing tests:**
  - `lib/print-dismiss-route.test.ts` (source + schema): `the body takes 1–20 ids and the staff reason only` (0 ids,
    21 ids, a missing reason, an unknown key → refused; 20 → accepted), `only the staff routes take a leased slip`
    (`dismissPrintJobByStaff` is imported by the two routes and nothing else; `print-queue.ts`'s `dismissPrintJob` has no
    `"leased"` in its filter, read with comments stripped and only the filter object sliced: its comment at :257 says
    "leased", F-M4), `a second Clear on a requested slip also answers dismissed` (F-M3: the leased CAS has no
    `$exists: false` term), `every select that feeds applyPrintJobPlan reads the request` (the sources of
    `print-job-actions.ts`, `print-lease.ts`, `print-sweep.ts`, `print-offline-replay.ts` select `PRINT_LIFECYCLE_SELECT`
    or both field names), `the route answers no-store and needs a
    session` (the source calls `requireAuth()` before reading the body and wraps every answer in `noStore`), `the CAS
    filter carries the clear request` (`printJobCasFilter("x", { status: "leased", epoch: 3 })` has `dismissRequestedAt:
    { $exists: false }`; with `dismissRequest` → `{ $exists: true }`), `the lifecycle select reads the request`
    (`PRINT_LIFECYCLE_SELECT` contains both field names).
  - `print-budget.test.ts`: `PX: Clear all is one request for up to 20 slips` — `PRINT_DISMISS_MANY_MAX ===
    PRINT_ATTENTION_LIMIT` (the "no recurring request" file scan is a cafe pin in Task 6, F-I4).
  - `lib/print-lease.test.ts:73-76` (changed on purpose, F-I6a): `printJobCasFilter`'s deep-equal now carries
    `dismissRequestedAt: { $exists: false }`, plus a case with the request (`{ $exists: true }`).
  - Live legs in `clear-while-printing.ts` (the existing harness helpers of `scripts/print-host-live/harness.ts`; each
    leg makes its own jobs): **CW1** a leased KOT + `dismissPrintJobByStaff` → `{ dismissed: true }`, the job still `leased`
    with the request; a failed ack `sent: "no"` → `applied: true, status: "dismissed", nextAttemptAt: null`; not in
    `readPrintAttention`. **CW2** the same + a printed ack → `printed`. **CW3** the same + the lease expired and the sweep
    → `dismissed`; then a late printed ack (same epoch) → `printed` (R8). **CW4** the interleave: read the leased row (`lifecycleOf`), set the request, then
    `applyPrintJobPlan(id, staleJob, planAck(staleJob, failedAck).patch)` → `false`; `ackPrintJob` → `dismissed`.
    **CW5** a claimed job (`claimedAt` set) → `{ dismissed: false, reason: "raced" }`. **CW6** `dismissPrintJobs` over 3
    queued + 1 leased + 1 printed + 1 unknown id → `{ dismissed: 4 }`, the printed one untouched, the leased one with the
    request. **CW7** a queued job with a leftover request (set raw) → `dismissPrintJobByStaff` dismisses it; a staff
    `retryPrintJob` on a failed one with a leftover request clears the field. **CW8** the server's own `dismissPrintJob`
    (an order cancelled) on a leased slip → `raced` as today, no request set (R2). **CW9** the offline replay marks a
    queued slip that carries a leftover request printed (its CAS matches).
- [ ] **Step 2: Run** `node --import tsx --test lib/print-dismiss-route.test.ts` (FAIL: module / route not found) and
  shared `npm test` (the budget test FAILs: no `PRINT_DISMISS_MANY_MAX`).
- [ ] **Step 3: Implement** the fields (Mongoose `{ type: Date }`, `{ type: String }`), the select, the CAS filter,
  `print-dismiss.ts`, the single route's call, the replay's select, the new route, the constant; wire the live legs
  (`print-queue.ts` does not change).
- [ ] **Step 4: Run** the new test file → PASS; shared `npm test` → PASS; the live legs on
  `pos_scratch_print_host_px2` → 499 + CW1–CW9, 0 failed; cafe `npm run typecheck` → 0.
- [ ] **Step 5: Commit** `feat(print): Clear takes a slip that is printing, and Clear all (PX-2 Task 2)`.

### Task 3: The Not printed view model (pure)

**Files:**
- Create: `apps/cafe/lib/print-waiting-view.ts`, `apps/cafe/lib/print-waiting-view.test.ts`
- Modify: `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Consumes: `PrintAttentionRow` (`@pos/shared/print-agent-wire`), `printWaitingAge`, `printerNameOf` (`lib/print-waiting.ts`),
  `printerProblemText`, `PRINT_HOST_MAX_AGE_MS`, `isSlipRefusal` / `printWriteOutcomeOf` / `isDesktopShellRefusal`
  (`lib/print-write-outcome.ts`), `PRINT_JOB_NO_PRINTER` (`@pos/shared/print-printers`), `PRINTER_GONE_MESSAGE` (where
  `lib/print-sweep.ts` imports it from).
- Produces:
  ```ts
  export type NotPrintedAction = "print-again" | "it-printed" | "try-again" | "print-now" | "clear";
  export interface NotPrintedRow { id: string; label: string; age: string; strong: string | null; reason: string;
    tone: "warn" | "bad" | null; actions: NotPrintedAction[] }
  export interface NotPrintedView { badge: string; summary: string; rows: NotPrintedRow[]; ids: string[] }
  export const NOT_PRINTED_SHOWN = 5;
  export const NOT_PRINTED_ACTION_WORDS: Record<NotPrintedAction, string>; // "Print again", "It printed", "Try again", "Print now", "Clear"
  export function notPrintedViewOf(rows: readonly PrintAttentionRow[], truncated: boolean, nowMs: number,
    printers: ReadonlyArray<{ id: string; name: string }>): NotPrintedView | null; // null when no row
  export function withoutAttentionRows<T extends { printAttention?: PrintAttentionRow[] }>(data: T | undefined,
    ids: ReadonlySet<string>): T | undefined; // the same object when nothing is removed
  ```

- [ ] **Step 1: Write the failing tests** (`now` fixed; rows built with a helper):
  - `no row, no card` → `null` for `[]`.
  - `the words of each kind of slip` — exactly §6.3's table: needs-confirm → `strong "May have printed."`, `reason "Check
    the printer."`, tone `warn`, actions `["print-again", "it-printed", "clear"]`; failed with no safe words → `strong
    "Could not print."`, reason `""`, tone `bad`, `["try-again", "clear"]`; failed with `lastError "No printer is chosen on
    this PC…"` (a desktop refusal) → that sentence as `reason`; queued 31 min not approved → `"Waiting over 30 min."`,
    `["print-now", "clear"]`; queued 31 min approved → not "over 30" (`"Waits for the printer."`, `["clear"]`); queued
    with a slip refusal `lastError` → `"Could not be prepared. Tries once more by itself."`; queued `problem: "paper-out"`
    on printer `p1` named "Kitchen printer" → `"Kitchen printer is out of paper."`; queued labels `["REPRINT"]` →
    `"Prints again, marked REPRINT."`, labels `["DUPLICATE"]` → `"Prints again, marked DUPLICATE."`; queued with a
    `lastError` that sent nothing (`PRINTER_NOT_CONNECTED_MESSAGE`) → `"The printer is off or not connected."`; queued with
    a Windows refusal → that sentence; queued plain → `"Waits for the printer."`, on `p1` → `"Waits for Kitchen printer."`.
  - `a slip whose printer is gone shows no print button` — failed with `printerId: PRINT_JOB_NO_PRINTER` → reason "No
    printer takes it now. Print it again from its order.", actions `["clear"]`; failed with `lastError ===
    PRINTER_GONE_MESSAGE` → the same; needs-confirm on a gone printer → `["it-printed", "clear"]`; a printer missing only
    from the cached list → today's buttons (server facts only, R3).
  - `no print button on a slip that prints by itself` — every queued row under 30 min (or approved) has actions
    `["clear"]` only.
  - `the ones that need a person first, newest first` — rows given oldest first (queued A 4 min, bill B 2 min, failed C
    14 min, queued D 1 min) → order B, C, D, A.
  - `the summary` — only queued → "They print by themselves when the printer is ready."; with a bill or a failed →
    "Tap a button on the ones that need you."; truncated → prefixed "The newest 20. ".
  - `the badge and the ids` — 7 rows → `badge "7"`, truncated → `"7+"` (as `printWaitingBadgeOf`); `ids` = every row's
    id in the shown order.
  - `withoutAttentionRows` — removes the ids from `printAttention`, keeps the other fields; nothing to remove → the same
    object (`===`); `undefined` → `undefined`.
- [ ] **Step 2: Run** `node --import tsx --test lib/print-waiting-view.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `print-waiting-view.ts` (≤ 300 lines; the rules above, no React).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(print): the Not printed list's rows, words and buttons (PX-2 Task 3)`.

### Task 4: The Not printed card and its actions

**Files:**
- Create: `apps/cafe/components/print/NotPrintedCard.tsx` (props only), `apps/cafe/components/print/NotPrintedSection.tsx`
  (the container: `({ pulse }: { pulse: PosPulseData | undefined })`), `apps/cafe/lib/print-job-notices.ts`,
  `apps/cafe/lib/not-printed-card.test.ts`, `apps/cafe/lib/print-job-notices.test.ts`,
  `apps/cafe/hooks/use-not-printed-actions.ts`
- Modify: `apps/cafe/components/print/printer-classes.ts` (the card's classes,
  §6.3 values), `apps/cafe/components/print/PrinterPanel.tsx` (render `<NotPrintedSection pulse={pulse} />` where
  `<WaitingSlipsCard />` was), `apps/cafe/lib/print-waiting.ts` (remove `printWaitingGroups`, `PRINT_WAITING_TITLES`,
  `PrintWaitingSection`, and `printWaitingReason` if `grep` finds no other reader) and `lib/print-waiting.test.ts` (their
  tests go, on purpose), `apps/cafe/package.json` (`testChain`)
- Delete: `apps/cafe/components/print/WaitingSlipsCard.tsx`
- Pins changed on purpose: `lib/printer-ui-paths.test.ts` (`waiting:` → `NotPrintedSection.tsx`, its landmarks),
  `lib/printer-panel-layout.test.ts` (the file list: `WaitingSlipsCard` → `NotPrintedCard`, `NotPrintedSection`),
  `lib/print-setup-ui-paths.test.ts:148-151` (reads `WaitingSlipsCard.tsx` → `NotPrintedSection.tsx`, F-I6b),
  `lib/print-waiting.test.ts:239-254` and `:263-265` (`<WaitingSlipsCard pulse={pulse} />`, its order before the banner,
  ≤ 120 lines, the `run().finally(release)` idiom → the same pins on `NotPrintedSection.tsx`, F-I6c).

**Interfaces:**
- Consumes: Task 3's `notPrintedViewOf`, `NotPrintedView`, `NotPrintedAction`, `NOT_PRINTED_SHOWN`, `withoutAttentionRows`;
  Task 2's route.
- Produces:
  ```ts
  // NotPrintedCard.tsx
  export interface NotPrintedCardProps { view: NotPrintedView; expanded: boolean; onExpanded(next: boolean): void;
    confirming: boolean; onClearAll(): void; onConfirm(yes: boolean): void; busy: boolean;
    tapped: ReadonlySet<string>; onAction(id: string, action: NotPrintedAction): void }
  // lib/print-job-notices.ts
  export type RowNotice = { text: string; tone: "info" | "error"; drop: boolean } | null;
  export function rowAnswerNoticeOf(action: NotPrintedAction, answer: PrintActionData | { dismissed: boolean; reason?: string }): RowNotice;
  export function rowErrorNoticeOf(error: unknown): RowNotice; // an ApiError 404 with enveloped === true → { "This slip is no longer waiting.", info, drop: true }; a host-level 404 (enveloped false) or anything else → today's ACTION_ERROR, drop false (F-M2)
  export const CLEAR_ALL_FAILED = "Could not clear all. Clear them one by one.";
  // use-not-printed-actions.ts (the panel's own; a promise per tap; `apiSend` directly, so no hook-level toast doubles a
  // notice; `usePrintJobActions` and `useDismissPrintJob` stay exactly as today for the dashboard band, R10)
  useNotPrintedActions(): { retry(id: string): Promise<void>; confirm(id: string, decision: PrintJobDecision): Promise<void>;
    dismiss(id: string): Promise<void>; dismissAll(ids: readonly string[]): Promise<void> }
  ```
  Each call: one request, then `kickPrintAgent()` and one `invalidateQueries(POS_PULSE_KEYS.all)` (today's `settled`).
  `dismiss` on `{ dismissed: true }` and `dismissAll` on success edit the pulse cache at once
  (`qc.setQueryData(POS_PULSE_KEYS.all, (d) => withoutAttentionRows(d, ids))`) before the existing `settled()` refetch; a
  `drop: true` notice drops the row the same way. Answer words: retry / print-now applied → info "It prints as soon as the
  printer is ready."; not applied → today's `printRetryNotice`; dismiss `raced` → info "This slip is printing right now.".

- [ ] **Step 1: Write the failing tests:**
  - `print-job-notices.test.ts`: one test per notice above (exact strings; `drop` true only for an enveloped 404; a
    404 with `enveloped: false` → the connection words, `drop: false`); `a confirm's
    answer says nothing when it applied` (`print-again` / `it-printed` applied → `null`).
  - `not-printed-card.test.ts` (`renderToStaticMarkup`, a global React as in `lib/floor-dialogs.test.ts`): `the head says
    Not printed with the count and Clear all`; `5 rows and Show all 7 when folded` (7 rows → 5 `<li>`, the text "Show all
    7", `aria-expanded="false"`); `every row when expanded, then Show fewer`; `each button names its slip`
    (`aria-label="Clear KOT round 1 · T-1"`, `"Try again Bill · T-3"`, `"Print again Bill · T-5"`); `a fresh waiting row
    has no print button` (no "Print now" / "Try again" in its `li`); `the bill row wraps its three buttons` (its `li`
    carries the wrap class); `the confirm replaces Clear all` (`confirming` → "Clear all 7 slips? They will not print.",
    buttons "Clear all" and "Cancel", no head "Clear all" button); `a tapped row's buttons are disabled`.
- [ ] **Step 2: Run** both files → FAIL (modules not found).
- [ ] **Step 3: Implement** the card (§6.3 values: card radius 12, border rgba(255,131,43,.45); head 15 px / 600 + the
  22 px bubble; summary 13 px; rows min-h 56 px, label 14 px / 500, meta 12.5 px with the strong part 600 in
  `text-status-warn-ink` / `text-status-bad-ink`; buttons 36 px with a 44 px touch target
  (`relative before:absolute before:-inset-1 pointer-coarse:before:content-['']`); "Show all {n}" 44 px; the confirm
  block bad tint, radius 10, two 40 px buttons, focus to Cancel on open), the container (reads `usePrintersRead(true)`,
  keeps today's per-tap `tapped` set and its pruning effect, `expanded` / `confirming` local state), the notices, the
  hook (`dismiss` → `POST /api/print-jobs/{id}/dismiss`, `dismissAll` → `POST /api/print-jobs/dismiss` with `{ ids, reason:
  "staff" }`, a 404 there → error toast `CLEAR_ALL_FAILED`); swap the panel's child; delete `WaitingSlipsCard.tsx`; remove the unused waiting helpers and their
  tests; update the two pins.
- [ ] **Step 4: Run** the two new files, `lib/print-waiting.test.ts`, `lib/printer-ui-paths.test.ts`,
  `lib/printer-panel-layout.test.ts` → PASS; `git diff --stat -- apps/cafe/hooks/use-print-job-actions.ts
  apps/cafe/hooks/use-print-host.ts apps/cafe/components/orders` → empty (the band untouched); `npm run typecheck` → 0.
- [ ] **Step 5: Commit** `feat(print): the Not printed card: Clear for good, Clear all, buttons only where they work (PX-2 Task 4)`.

### Task 5: The status view model and the dot (here, held, printer-waiting)

**Files:**
- Create: `apps/cafe/lib/printer/held-status.ts`, `apps/cafe/lib/print-agent-here.ts`,
  `apps/cafe/lib/printer/printer-status-view.ts`, and tests
  `lib/printer/held-status.test.ts`, `lib/print-agent-here.test.ts`, `lib/printer/printer-status-view.test.ts`
- Modify: `apps/cafe/lib/printer/printer-dot.ts` (add the reason, the three optional fields and the rule; the types
  `PrinterHere` / `WaitingPrinter` live in `print-agent-here.ts` and are imported as types; the file may sit a few
  lines over 300 until Task 6 deletes the old copy, the one allowed transient), `apps/cafe/lib/print-agent-printers.ts`
  (`dotPrintersOf` :208 sets `here`, `notHere` through `print-agent-here.ts`; must not grow past its 358 lines),
  `apps/cafe/lib/print-waiting.ts` (`printWaitingPrintersOf`, `waitingPrintersOf`),
  `apps/cafe/components/layout/print-waiting-context.ts` (`PrintWaitingPrintersContext`, `usePrintWaitingPrinters`),
  a new `apps/cafe/components/layout/PrintWaitingProviders.tsx` (`({ data, children })`: derives the count string and the
  printers string once each and provides both contexts), `apps/cafe/components/layout/PosPulseProvider.tsx` (:279-290:
  its `printWaitingBadgeOf` line and its `PrintWaitingContext.Provider` become `<PrintWaitingProviders data={data}>`, net
  0 lines, F-I5; `lib/pos-pulse-paths.test.ts`'s pins on where the count is derived follow it, on purpose),
  `apps/cafe/hooks/use-agent-printers.ts` (`useDotPrinters` :107), `apps/cafe/hooks/use-device-printer.ts` (a held local
  status for the dot), `lib/printer/printer-dot.test.ts` (new cases), `apps/cafe/package.json` (`testChain`)
- Pins changed on purpose: none in this task (the old copy is deleted in Task 6).

**Interfaces:**
- Produces:
  ```ts
  // held-status.ts
  export type HeldStatusMemory = Map<string, PrinterStatus>;
  export function heldPrinterStatusOf(memory: HeldStatusMemory, key: string, status: PrinterStatus): PrinterStatus;
  export const PAGE_HELD_STATUS: HeldStatusMemory; // one per page
  // print-agent-here.ts
  export type TransportWord = "bluetooth" | "usb" | "network" | "windows" | "browser";
  export interface PrinterHere { id: string; name: string; appName: string; transport: TransportWord; nativeId?: string;
    status: PrinterStatus; problem?: PrinterProblem }
  export function printersHereOf(printers: readonly PrinterConfig[], agent: AgentPrinters, pool: NativePoolView | null,
    lan: readonly DesktopLanPrinter[] | null, local: DevicePrinter | null, localStatus: PrinterStatus,
    held: (key: string, status: PrinterStatus) => PrinterStatus): PrinterHere[]; // the setup's display order
  export function printersNotHereOf(printers: readonly PrinterConfig[], deviceId: string, agent: AgentPrinters): string[];
  // printer-dot.ts
  export type PrinterDotReason = /* today's */ | "printer-waiting";
  export interface WaitingPrinter { printerId: string; name: string; count: number; problem?: PrinterProblem; stuck: boolean }
  // PrinterDotPrinters gains: here?: PrinterHere[]; notHere?: string[]; waiting?: WaitingPrinter
  export const PRINTER_BUTTON_NAME_WAITING = "Printer not printing — open printer setup";
  // print-waiting.ts
  export const PRINTER_WAITING_STUCK_MS = 60_000;
  export function printWaitingPrintersOf(pulse: PosPulseData | undefined, nowMs: number): string; // FRESH queued rows only (≤ 30 min old or approved, not a slip refusal, R1): "id:count:problem:stuck" joined by "|" ("p1:3:paper-out:1|p2:1::0"; stuck = a problem, or the oldest fresh row waited > 60 s, F-I2), sorted by count desc, then id; "" when none
  export function waitingPrintersOf(key: string, printers: ReadonlyArray<{ id: string; name: string }>): WaitingPrinter[];
  // printer-status-view.ts
  export type StatusActionKind = "reconnect" | "connect" | "choose" | "print-here" | "set-up-host";
  export type StatusLinkKind = "connect-again" | "one-device" | "printer-setup";
  export interface PrinterStatusView { tone: "ok" | "bad" | "checking"; headline: string; detail: string;
    steps: string[]; action: { kind: StatusActionKind; label: string } | null;
    link: { kind: StatusLinkKind; label: string } | null; note: string | null; subject: PrinterHere[] }
  export interface PrinterStatusViewInput { dot: PrinterDot; hostLabel: string | null;
    printer: { name: string; transport: TransportWord } | null; noun: "this phone" | "this tablet" | "this PC" | "this device";
    isHostDevice: boolean; canPrintHere: boolean; desktopNoPrinter: boolean; localStatus: PrinterStatus;
    here: readonly PrinterHere[]; waiting: WaitingPrinter | null; notHere: readonly string[]; isAdmin: boolean }
  export function printerStatusViewOf(input: PrinterStatusViewInput): PrinterStatusView;
  export function deviceNounOf(lane: DotLane, inApp: boolean, shortSidePx: number | null): "this phone" | "this tablet" | "this PC" | "this device"; // inApp && shortSidePx < 600 → phone (R13)
  ```
  Steps carry `**word**` for the bold word ("Tap **Reconnect**."); the card renders the marks (Task 6).
- The dot rules: `printersRow` → `!isWriter` → `waiting ? "printer-waiting" : "printers-elsewhere"`; a writer's row that is
  ok, with a `waiting` printer not in `here` → `"printer-waiting"`; tone bad (the warn dot); `printerButtonName` →
  `PRINTER_BUTTON_NAME_WAITING`. `useDotPrinters(deviceId)` builds `here` with held statuses (`PAGE_HELD_STATUS`,
  keys = the native id, `device:<printerId>` for the device's own) and `waiting` = the first of
  `waitingPrintersOf(usePrintWaitingPrinters(), printers)`; `useDevicePrinter()`'s status reaches `printerDotOf` through
  `heldPrinterStatusOf(PAGE_HELD_STATUS, "local", status)` in the button and the panel alike.

- [ ] **Step 1: Write the failing tests:**
  - `held-status.test.ts`: `connecting after a settled disconnected stays disconnected` (disconnected → connecting →
    `"disconnected"`); `the same after needs-tap`; `connected shows at once` (… → connected → `"connected"`; then
    connecting → `"connecting"`); `a first connecting is connecting` (empty memory → `"connecting"`); `keys are separate`.
  - `print-agent-here.test.ts`: two app printers in the setup (Kitchen → `bt-classic:A`, Bill → `bt-classic:B`) on bridge
    v2, Kitchen disconnected → `here` = [Kitchen (status disconnected, appName "RPP02N", transport "bluetooth"), Bill
    (connected)] in the setup's order; `problem` from the pool entry's paper flag; a network printer → transport
    "network"; a network printer this device may only take over is left out until it is taken over (R9); a Windows
    printer chosen by name → transport "windows", `status: "none"` (no state word); no printer of the Windows app (named
    or network) is ever in Reconnect's subject (F-I3);
    `printersNotHereOf` names a written printer that is not this device's.
  - `printer-dot.test.ts` (new cases): `a device that writes nothing turns amber when a printer's slips wait`
    (`isWriter: false, waiting: {…}` → reason `printer-waiting`, `ok: false`, tone red); `stays green with nothing
    waiting`; `a writer whose printers are fine turns amber for another printer that waits`; `a writer's own waiting
    printer keeps its own reason` (waiting printer in `here` → today's row); every existing case unchanged.
  - `print-waiting.test.ts` (new cases): `printWaitingPrintersOf` keys only fresh queued rows with a `printerId` (not
    `PRINT_JOB_NO_PRINTER`), counts, the most first; an untapped 31-min row and a slip-refusal row are left out, a tapped
    31-min row counts (R1); stuck when a row has a `problem` or the oldest fresh row is 61 s old, not stuck at 59 s
    (F-I2); `""` without rows; `waitingPrintersOf` names them (unknown id → the
    name "A printer").
  - `printer-status-view.test.ts`: one test per row of §6.4 with the exact headline, detail, steps, action label, link
    label and note — at least: printer-waiting stuck with a problem (headline "Kitchen printer is not printing",
    detail "Kitchen printer is out of paper.", the 2 steps), stuck by age (detail "3 slips waiting for it."), not stuck
    (headline "Slips are waiting for Kitchen printer", detail "3 slips waiting.", no steps, note "If they do not print
    soon, check it is on and has paper.") (F-I2); the Windows app's network printer off (headline "Kitchen printer is not
    connected", the 2 network steps, no action, note "This PC checks it again every minute.", `subject` empty) (F-I3);
    ok own printer ("Printer ready", "RPP02N · Bluetooth"); ok host ("Printing is on",
    "Slips print at **Counter tablet**."); printers-elsewhere; printer-waiting with and without a problem; no-printer
    (app: "No printer on this tablet", action "Connect a printer", link "Or print everything on one device"; Windows:
    "No printer chosen on this PC", "Choose a printer"); printer-off simple (the 3 Bluetooth steps, "Reconnect", link
    "Still not working? Connect it again"); USB and network steps; printers mode one down ("Kitchen printer is not
    connected", `subject` = [Kitchen]); two down ("2 printers are not connected", detail "Kitchen printer, Bill printer",
    `subject` both); needs-tap; elsewhere; paper-out / cover-open / error (steps + note "Waiting slips print by themselves
    after that."); the host rows; host-print-window (action only on the host); printer-not-here (staff: no link; admin:
    "Open Printer setup"); device-offline; checking.
- [ ] **Step 2: Run** the five files → FAIL.
- [ ] **Step 3: Implement** in the order: held-status, print-agent-here, the reason and fields, `printWaitingPrintersOf` / `waitingPrintersOf`,
  the context + provider, `useDotPrinters` / the held local status, `printerStatusViewOf`.
- [ ] **Step 4: Run** the five files + `lib/printer-dot-ui-paths.test.ts`, `lib/pos-pulse-paths.test.ts` → PASS;
  `npm run typecheck` → 0.
- [ ] **Step 5: Commit** `feat(print): the status card's words, the right printer, the amber phone, no flicker (PX-2 Task 5)`.

### Task 6: Two views in the one sheet

**Files:**
- Create: `apps/cafe/components/print/PrinterStatusCard.tsx`, `apps/cafe/components/print/PrinterHereCard.tsx`,
  `apps/cafe/components/print/PrinterSettingsRow.tsx`, `apps/cafe/lib/printer/reconnect-down.ts`,
  `apps/cafe/lib/printer/reconnect-down.test.ts`, `apps/cafe/lib/printer-status-card.test.ts`
- Modify: `apps/cafe/components/print/PrinterPanel.tsx`, `apps/cafe/components/print/PrinterPanelFrame.tsx`,
  `apps/cafe/components/print/PrinterStatusButton.tsx`, `apps/cafe/app/(dashboard)/printers/page.tsx`,
  `apps/cafe/components/print/printer-classes.ts`, `apps/cafe/package.json` (`testChain`)
- Delete: `apps/cafe/components/print/PrinterStatusBanner.tsx`; in `apps/cafe/lib/printer/printer-dot.ts`
  `printerHeadlineOf`, `copyFor`, `okDetail`, `hostOfflineElsewhere`, `PrinterHeadline`, `PrinterHeadlineInput`,
  `PrinterFix` and their constants (their only reader was the panel, R11; a name something else still imports stays);
  the file ends ≤ 300 lines
- Pins changed on purpose: `lib/printer-panel-layout.test.ts` (the order: status view = `<PrinterStatusCard` <
  `<NotPrintedSection` < `<PrinterHereCard` < `<PrinterSettingsRow`; settings view = `<PrinterSetupCard` <
  `<BillPrinterSection`; `/printers` = `<PrinterPanel home="page" />`, no frame, no Done), `lib/printer-ui-paths.test.ts`
  (the copy comes from `printerStatusViewOf`; the banner → the card; its mutations), `lib/printer-dot-ui-paths.test.ts`
  (the frame's call shape with `title` / `onBack`), `lib/printer/printer-dot.test.ts` (its `printerHeadlineOf` cases go;
  each situation is a case of `printer-status-view.test.ts` with the new words), `lib/print-host-card-paths.test.ts` (`<PrinterPanel home="page" />`
  on /printers; the panel still renders `<PrinterSetupCard />`), `lib/pos-pulse-paths.test.ts` (the panel still reads
  the pulse once).

**Interfaces:**
- Consumes: Task 5's `printerStatusViewOf`, `PrinterHere`, `deviceNounOf`, `useDotPrinters`; Task 4's `NotPrintedSection`.
- Produces:
  ```ts
  export type PrinterPanelView = "status" | "settings";
  export function PrinterPanel(props: { home?: "sheet" | "page"; view?: PrinterPanelView; onView?(next: PrinterPanelView): void }): JSX.Element;
  export function PrinterPanelFrame(props: { open: boolean; onOpenChange(open: boolean): void; trigger?: ReactNode;
    title: string; onBack?: () => void; children: ReactNode }): JSX.Element;
  export function PrinterStatusCard(props: { view: PrinterStatusView; busy: boolean; onAction(kind: StatusActionKind): void;
    onLink(kind: StatusLinkKind): void }): JSX.Element; // role="status" aria-live="polite"
  export function reconnectDown(subject: readonly PrinterHere[], deps: { device(): Promise<ConnectOutcome>;
    native(id: string): Promise<ConnectOutcome> }): Promise<{ connected: string[]; failed: string[] }>;
  export function reconnectToastOf(result: { connected: string[]; failed: string[] }): { tone: "success" | "error"; text: string };
  ```
  `reconnectDown` starts the first reconnect synchronously (before any `await`), then the rest in order; only printers
  whose status is not `connected`; a printer with `nativeId` → `deps.native(nativeId)`, without → `deps.device()`; an
  empty subject (simple mode) → `deps.device()` once. Toast: all connected → success "{names} connected."; any failed →
  error "Could not connect {names}. Check it is on, then tap Reconnect again." (names joined with ", ").
  The status button keeps `view` state (`"status"` on every open; reset on close) and passes `title` ("Printer" /
  "Printer settings") and `onBack` (settings only) to the frame. An action that points at the setup (`connect`,
  `choose`, `print-here`, `set-up-host`, the links) switches to `"settings"`, then focuses `[data-printer-target="device"]`
  (connect / choose / connect-again / set-up-host) or `[data-action="designate"]` (print-here / one-device) inside this
  panel after the view renders; `printer-setup` navigates to `/printers`. `isAdmin` comes from `useAuth()` (the read
  `components/shared/AdminGuard.tsx:14` uses); the noun's short side from `window.screen` (null before mount). On `home="page"` the status parts and the
  settings parts render together, with no settings row and no back.

- [ ] **Step 1: Write the failing tests:**
  - `printer-panel-layout.test.ts` (new case, F-I4): `the panel adds no recurring request` — `components/print/
    {PrinterPanel,NotPrintedSection,NotPrintedCard,PrinterStatusCard,PrinterHereCard,PrinterSettingsRow}.tsx` and
    `hooks/use-not-printed-actions.ts` contain no `refetchInterval`, `setInterval`, `router.refresh` or `useQuery(`.
  - `printer-panel-layout.test.ts` (new case, F-M6): `focus follows the view` — the frame's title carries
    `tabIndex={-1}` and the panel focuses it after a view switch; the status card's headline is focused when the Not
    printed card leaves.
  - `reconnect-down.test.ts`: `a cancelled chooser is neither connected nor failed` (F-M5: no toast for it alone);
    `only the printers that are down, in order` (Kitchen down, Bill up → `native("bt-classic:A")`
    once, Bill never); `two down, one after the other` (the second starts after the first settles); `the first starts
    inside the call` (a spy records the call before the returned promise is awaited); `simple mode reconnects the
    device's printer`; `the toast words` (exact strings above).
  - `printer-status-card.test.ts` (`renderToStaticMarkup`): `a bad card: the headline, the numbered steps with the bold
    word, one Reconnect button and the link`; `an ok card has no button`; `the note shows under the steps`;
    `role="status"` and `aria-live="polite"` on the card; `the panel's status view draws card, list, here, settings row in
    that order` (render `PrinterPanel`'s status-view body helper with fixtures, or assert by source order in the pin).
- [ ] **Step 2: Run** both → FAIL.
- [ ] **Step 3: Implement** the card (§6.2 values: radius 14, padding 16, gap 12; 40 px circle; headline 17 px / 600;
  detail 13.5 px; steps 22 px circles, 14 px / 1.45, indented 52 px; the 44 px full-width primary with "Reconnecting…" +
  spinner while busy; the 13 px link; the 13 px note), the here card and the settings row (§6.2), the frame's head per view
  (back button 34 px `aria-label="Back to printer status"`, the title, the visually hidden description "Printing on this
  device"), the content column (`mx-auto w-full max-w-[640px]` in body, head and foot from 720 px), the panel's views,
  the button's view state, the page home; delete the banner; update the five pins.
- [ ] **Step 4: Run** the new files + the five pins + `lib/css-compat.test.ts` → PASS; `npm run typecheck` → 0; the whole
  cafe chain → 0 fail.
- [ ] **Step 5: Commit** `feat(print): the panel opens on the status view; settings one tap away (PX-2 Task 6)`.

### Task 7: The alarm, the printed ack, the job toast words

**Files:**
- Create: `apps/cafe/lib/print-job-toast.ts`, `apps/cafe/lib/print-job-toast.test.ts`, `apps/cafe/lib/print-alarm-quiet.test.ts`,
  `apps/cafe/lib/print-pulse-edit.ts` (`dropPrintedFromPulse`; its case in `print-job-toast.test.ts`: a printed applied
  answer removes the row, a failed or not-applied one leaves the cache untouched)
- Modify: `apps/cafe/lib/printer-panel-open.ts`, `apps/cafe/lib/print-waiting.ts` (`printAlarmStep` :152),
  `apps/cafe/hooks/use-print-slip-alarm.ts`, `apps/cafe/components/print/PrinterStatusButton.tsx` (report open / closed),
  `apps/cafe/hooks/use-print-agent.ts` (the `ack` dep :203), `apps/cafe/lib/print-host-slips.ts` (`HostPrintSlip` :131),
  `apps/cafe/lib/print-agent-slip.ts` (`printAgentSlipOf` :39), `apps/cafe/hooks/use-print-host-bridge.ts` (`settle` :87,
  `abandon` :116), `apps/cafe/package.json` (`testChain`)

**Interfaces:**
- Produces (added to the existing `lib/printer-panel-open.ts`, whose open event stays, R12): `setPrinterPanelOpen(open:
  boolean): void`, `printerPanelIsOpen(): boolean`,
  `onPrinterPanelOpenChange(listener: (open: boolean) => void): () => void`; `printAlarmStep(memory, feed, deviceId,
  nowMs, first, quiet = false)` — `quiet`: no row goes into `show` (a row that would have is recorded `shown: false`) and
  `summaryWaiting` is 0; `ring` unchanged. `HostPrintSlip.jobId?: string` (set to the leased job's id by
  `printAgentSlipOf`). `JOB_NOT_CONNECTED_TOAST`, `JOB_MAYBE_TOAST` (§6.9 B7 words); `jobPrintToastOf(message: string):
  string` — `PRINTER_NOT_CONNECTED_MESSAGE` → `JOB_NOT_CONNECTED_TOAST`; a message whose `printWriteOutcomeOf(...).sent`
  is `"maybe"` (and `PRINT_HOST_PRINT_FAILED_MESSAGE`) → `JOB_MAYBE_TOAST`; any other message unchanged.
- The hook: while `printerPanelIsOpen()`, `check` passes `quiet = true`; on an open, every alarm toast up is dismissed
  and its memory entry set `shown: false`. The agent's `ack` dep calls one helper,
  `dropPrintedFromPulse(qc, id, body, answer)` (in `lib/print-waiting-view.ts`'s neighbour `lib/print-pulse-edit.ts`):
  when `body.outcome === "printed"`, `answer.applied` and `answer.status === "printed"`, `qc.setQueryData(POS_PULSE_KEYS.all,
  (d) => withoutAttentionRows(d, new Set([id])))`. The agent's own pulse listener (`hooks/use-print-agent.ts:319-326`)
  returns early on `event.action.manual === true` (as `use-print-host-beat` does, pinned at
  `lib/print-host-paths.test.ts:370`), so the cache write never kicks a trailing lease (F-I1). The bridge: `settle` / `abandon` toast `jobPrintToastOf(failure)` when the
  finished slip has a `jobId`, else today's words.

- [ ] **Step 1: Write the failing tests:**
  - `print-alarm-quiet.test.ts`: `quiet shows nothing and remembers it quietly` (a new waiting KOT, `quiet` → `show`
    empty, memory `shown: false`, `ring` true); `after the panel closes the same slip does not pop` (the next step,
    not quiet → `show` empty); `a slip that gets worse after the close rings and shows` (queued → failed); `quiet hides
    the summary` (`first`, quiet → `summaryWaiting` 0).
  - `print-job-toast.test.ts`: the three mappings (exact strings), `a direct slip keeps its words` (any other lane
    message unchanged), `the lane constants are byte-identical` (`PRINTER_NOT_CONNECTED_MESSAGE` === today's sentence).
  - Source pins in `print-job-toast.test.ts`: `printAgentSlipOf sets jobId`, `the bridge maps a job slip's toast`
    (`use-print-host-bridge.ts` calls `jobPrintToastOf` in `settle` and `abandon`), `the agent drops a printed slip from
    the cached feed` (`use-print-agent.ts` calls `dropPrintedFromPulse` inside the `ack` dep), `the agent's pulse
    listener ignores manual cache writes` (its subscriber checks `event.action.manual`, F-I1), `the button reports the
    panel open` (`PrinterStatusButton.tsx` calls `setPrinterPanelOpen`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** as the interfaces say.
- [ ] **Step 4: Run** the new files + `lib/print-waiting.test.ts`, `lib/print-agent.test.ts` → PASS; the cafe chain → 0 fail.
- [ ] **Step 5: Commit** `feat(print): the alarm stays off the open panel; a printed slip leaves the list at once; honest toasts (PX-2 Task 7)`.

### Task 8: Verification, the fresh review, the Results

- [ ] Suites: cafe chain, typecheck, lint, shared, the live legs (fresh `pos_scratch_print_host_px2`), the S1 pin;
  `git diff --stat 82e3321 -- <the SR-1 and SR-11 paths>` → empty.
- [ ] Build `D:\kd\pxr` at the branch head (`git -C D:/kd/pxr checkout --detach <head>`; `next build` from
  `D:\kd\pxr\apps\cafe` with `NEXT_TELEMETRY_DISABLED=1`, `env -u ELECTRON_RUN_AS_NODE`), serve on :3175.
- [ ] Harness (`D:\kd\pos-dev-keep\printer-ux\tools`; extend `pw-px.mjs` with `act Clear_all`, `PRINTERS=2` (a second
  fake printer :9112 "POS-80" and a setup with Kitchen → :9111, Bill → :9112 on the fake app) and `APP=none` as a
  second browser): Print now absent on fresh rows; Clear on a queued and on a leased slip (FLIP=1 SLOW_MS=25000) → the row
  never returns in 90 s; Clear all → 0 rows, one POST; Reconnect → every waiting slip printed once, the rows gone within
  3 s on this device; printers mode Kitchen off → "Kitchen printer is not connected", Reconnect calls only Kitchen; the
  phone → amber "Kitchen printer is not printing"; the alarm toast absent while the panel is open; the extra scroll per
  state at 390 / 820 / 1280 ≤ the mockups' + 24 px. Shots beside the mockups in `D:\kd\pos-dev-keep\printer-ux\px2\`.
- [ ] a11y: `node D:\kd\pos-dev-keep\ui-redesign\tools\a11y-check.mjs` on both views at 390 and 1280 → 0 violations.
- [ ] Emulator Pixel_7_API_33 (background boot, `-no-snapshot -memory 4096 -no-metrics`), the local harness only:
  WebView 109 and 154 — the status view, the Not printed list (Show all, Clear all confirm), the settings view, the 154
  bottom inset; put it back as found.
- [ ] The Windows app smoke (the 5C boot shim): the status view in the desktop lane and the settings view's picker.
- [ ] Fresh Claude Fable 5.1 review of 82e3321..head (read-only); one fix wave; the Results below; drop the session's
  scratch databases (`tools\drop-px-dbs.mjs`, each suffix added).

---

# Session PX-3 (exact): the settings view as cards, the guided connect, the words

Acceptance: §6.6–§6.9 (B9–B11) as drawn in the mockups `t-settings-*`, `t-host-*`, `g1`–`g6`; every setup action of today
still reachable and working in every lane (connect, change, remove, paper width, test print + attestation, one device for
all, stop, move, fast text KOTs, bill printer, change POS address, battery settings, remove the printing device, add
another printer on bridge v2 — the path into printers mode); the extra scroll of the settings view at 390 ≤ 64 px. Work on
`feat/printer-ux` (origin/main a831fd3 merged in as b570c73 first, no file overlap). Live legs on a fresh
`pos_scratch_print_host_px3`. PX-3 changes no server file, no lifecycle, no slip, no native file.

**Baseline (b570c73, the Results' "before"):** cafe `npm test` 7760 / 7759 pass / 0 fail / 1 skip; shared 1076 / 0 fail;
cafe typecheck 0; live legs 524 passed, 0 failed (`pos_scratch_print_host_px3`); lint at Task 14 (PX-2: 0 errors, the 2
old warnings). The builder check is skipped (fast path, the owner's word): the per-task reviewer reads the spec and code.

**The owner's answers (2026-11-05, start of PX-3, both recommended):** Q1 — a printers-mode Not printed row that sent
nothing names its printer: "Kitchen printer is off or not connected." (simple mode / an unknown printer: today's "The
printer is off or not connected."). Q2 — on a device that prints nothing, a STUCK printer is named before a merely busy
one with more slips (then the most slips, then the setup's order). Both in Task 12.

**PX-3 rulings (decided here; none changes what the owner approved):**
- **X1 Wire sentences never change.** `DESKTOP_SHELL_REFUSALS` (lib/desktop-shell-messages.ts) is the list that makes a
  Windows app refusal "nothing sent" (`NOTHING_SENT`, lib/print-write-outcome.ts:54-65) and the shell still sends those
  exact sentences: changing one would turn a refusal into "may have printed" (a REPRINT, a bill to check, a counted
  try). It stays byte-identical (a new pin); B10's words are a display map at the places the web shows a refusal. Same
  for the lane constants (PX-2's rule).
- **X2 The guided connect is the Android app's flow** (`caps.native`; the client's lane; mockups `g1`–`g6` are Android).
  Chrome keeps today's `BrowserPrinterConnect` inside the card (its chooser IS the list) and the Windows app keeps
  `DesktopPrinterPicker` + `DesktopPrintMethod` inside the card (§6.6 item 1). The status card's "Connect a printer" /
  "Still not working? Connect it again" open the guided connect in the app, and go to the card (PX-2's `SETUP_TARGETS`)
  elsewhere.
- **X3 Back and Cancel return to settings** (§6.7); a connect in flight is not aborted (the bridge has none): it finishes
  as today's would. From "connected" on, the foot says **Done** (mockup g4; it closes the sheet, the frame's Done).
- **X4 Add mode ends at "connected"** with "Your manager chooses which slips it prints, in Printer setup." — no test
  slip: a printer the setup does not name yet prints nothing, and a new kind of test slip would be new paper (SR-1). A
  failed add says today's words ("The printer is added, but not connected yet. Check it is on, then tap Reconnect.").
- **X5 Test print per printer (printers mode):** admins get the setup's own test (`useTestPrinter`, hooks/use-print-setup.ts:89,
  `POST /api/printers/:id/test`, admin-only on the server: the whole path, one request per tap) on every printer of the
  card; staff get today's device test (`queueTestSlip`, `isHostDevice || lane === "raster"`) on this device's own printer
  only. No route or auth changes.
- **X6 Reuse by keeping files** where the job stays: `DevicePrinterSection.tsx` becomes the "This device's printer" card
  (and, in printers mode, the "Printers on this device" card with `OtherDevicePrinters.tsx` inside it); `TextKotSection.tsx`
  becomes "Faster KOTs"; `BillPrinterSection.tsx` is already a card (unchanged). New files only for new jobs. On bridge v2
  in simple mode the card keeps "Other printers on this device" and "Connect another printer" (the path into printers mode).
- **X7** Simple mode's card has no Reconnect (§6.6 item 1: the status card's Reconnect is the fix); printers mode shows
  Reconnect only on a printer that is not connected. **X8** "Printer setup ›" once, in More, admins only, never on
  /printers (mockups). **X9** More's "Remove the printing device" loses its help line (its confirm says what it does);
  "Battery settings" keeps today's condition (an app with the `battery` feature). **X10** The USB choice says "Plugged
  into {noun}". **X11** A scan refused for permission is read from the scan's `UNAUTHORIZED` answer (the page has no SDK
  number): the first → **Allow**; after an Allow that was refused → the 3 steps. **X12** `PRINT_JOB_NOT_ROUTED_MESSAGE`
  is a toast only (hooks/use-host-routing.ts:247,287): reworded. **X13** The /pos clock's red word (Ruling M) →
  "needs attention" (true for every red reason).

## Review Focus (PX-3)

1. **Each lane keeps every action:** the app simple / printers mode, Chrome, the Windows app, a host and a non-host:
   Remove of a pool printer the setup does not name, Add another printer in simple mode, Stop / Move / Remove the
   printing device, the host's attestation. Pinned in Task 10 / 10b (`settings-view.test.ts`, the source pins).
2. **Change on a printer the setup prints through this device keeps it in the app** (today's `keepInApp`, the 2F2 M-4
   rule) when it is done through the guided connect. Pinned in Task 11 (`use-connect-attempt` source pin + the moved pin).
3. **A connect that fails, or Back / Cancel mid-way:** the old printer stays as today's failed select leaves it; the list
   says why inline; nothing toasts twice. Pinned in Task 11 (`connect-flow.test.ts`).
4. **Words that are also wire sentences** (X1) stay byte-identical; the display map changes only what staff read.
   Pinned in Task 12.
5. **No new recurring request:** the settings cards and the guided connect read only what is cached; the scan is the
   bridge's 8 s list (no server); the admin Test print is one POST per tap. Pinned in Task 11 (the F-I4 pin extended).

### Task 10: The settings view as cards (simple mode, the frame of the view)

**Files:**
- Create: `apps/cafe/hooks/use-printer-panel-focus.ts`, `apps/cafe/hooks/use-printer-setup-actions.ts`,
  `apps/cafe/hooks/use-test-print.ts`, `apps/cafe/lib/printer/settings-view.ts`, `apps/cafe/lib/printer/settings-view.test.ts`,
  `apps/cafe/components/print/settings/PrinterSettingsView.tsx`, `apps/cafe/components/print/settings/PrintForOthersCard.tsx`,
  `apps/cafe/components/print/settings/MoreCard.tsx`
- Modify: `components/print/PrinterPanel.tsx` (the focus wiring → the hook; the settings view → `<PrinterSettingsView
  home={home} noun={noun} />`), `components/print/DevicePrinterSection.tsx` (the card), `components/print/PrintHostCardParts.tsx`
  (`PrinterRow`'s look), `components/print/TextKotSection.tsx` (Faster KOTs), `components/print/printer-classes.ts`,
  `docs/GO-LIVE-CHECKLIST.md` (the quoted words), `apps/cafe/package.json` (`testChain`)
- Delete: `components/print/PrinterSetupCard.tsx`, `components/print/PrintWhereSection.tsx`, `components/print/PrinterAdvanced.tsx`
- Budgets: PrinterPanel ≤ 220 (pin unchanged), DevicePrinterSection ≤ 260, every new file ≤ 300.

**Interfaces:**
- `usePrinterPanelFocus(input: { home: "sheet" | "page"; view: PrinterPanelView; onView?: (next: "status" | "settings") => void }):
  { rootRef: RefObject<HTMLDivElement | null>; listRef: RefObject<HTMLDivElement | null>; onFocus(event: FocusEvent): void;
  openSetup(selector: string): void }` — PrinterPanel.tsx:56-74, 102-107, 130-165 moved as they are (the view effect,
  the list-left effect, `focusAndShow`, `pendingTarget`, the selectors). No behaviour change.
- `usePrinterSetupActions(): { host: PrintHostState | null; hostLabel: string | null; isHostDevice: boolean; online: boolean;
  printersMode: boolean; label: string; setLabel(next: string): void; designate(): Promise<void>; designating: boolean;
  clear(): Promise<void>; clearing: boolean }` — PrinterSetupCard.tsx:36-56, 60-118, 164-174 as they are (dropHostPref,
  handleDesignate, handleClear, every message and toast, `HOST_LABEL_FALLBACK`, the label default).
- `useTestPrint(): { testable: boolean; raster: boolean; phase: "idle" | "printing" | "confirm"; tips: boolean;
  startDisabled: boolean; deviceBusy: boolean; attesting: boolean; start(): Promise<void>; answer(printed: boolean,
  worksWords?: string): Promise<void> }` — PrinterSetupCard.tsx:39-48, 72-78, 88-95, 120-162 as they are; `startDisabled`
  = today's `current !== null || phase !== "idle" || beat.isPending`; `worksWords` (the guided connect's "Printing works on
  {noun}.") replaces `TEST_WORKS_MESSAGE` and, on the host, `ATTEST_SILENT_MESSAGE` for that one answer.
- `lib/printer/settings-view.ts` (pure):
  ```ts
  export type PrintForOthersView = { kind: "hidden" } | { kind: "checking"; text: string } | { kind: "offer" }
    | { kind: "host"; printersMode: boolean } | { kind: "elsewhere"; host: string; online: boolean };
  export function printForOthersViewOf(i: { printersMode: boolean; isHostDevice: boolean; host: PrintHostState | null;
    hostLabel: string | null; online: boolean }): PrintForOthersView; // printers mode and not the host → hidden
  export function stopQuestionOf(printersMode: boolean): string;
  export type MoreRow = "change-address" | "battery" | "remove-host" | "printer-setup";
  export const MORE_ROW_WORDS: Record<MoreRow, string>;
  export function moreRowsOf(i: { native: boolean; battery: boolean; printersMode: boolean; isHostDevice: boolean;
    hostSet: boolean; isAdmin: boolean; home: "sheet" | "page" }): MoreRow[];
  export function deviceCardTitleOf(lane: PrintLane): string;      // "desktop" → "This PC's printer"; else "This device's printer"
  export function printerSubOf(printer: DevicePrinter): string;     // "Bluetooth · 80 mm paper" (printerTypeLabel · paper)
  export function textKotRowWordsOf(name: string, rows: number): { label: string; sub: string };
  ```
- `PrinterSettingsView({ home, noun }: { home: "sheet" | "page"; noun: DeviceNoun })` draws, in order (§6.6 numbering):
  `<DevicePrinterSection noun={noun} />`, `<PrintForOthersCard />`, `<TextKotSection />`, `<BillPrinterSection />`,
  `<MoreCard home={home} />`. Task 11 adds `onConnect`.

**The words (exact; §6.6, mockups `t-settings`, `t-host`):**
- Card 1 (DevicePrinterSection): title `deviceCardTitleOf(lane)`, no sub (today's "The printer this device prints on."
  goes); the row: 9 px dot (ok green when connected, else `--subtle`), the name (14 px / 500), `printerSubOf` (12.5 px),
  today's state word (`STATUS_LABEL`: "Connected" / "Not connected" / "Connecting…" / "Tap Reconnect" / "In another tab").
  Buttons (36 px, one wrapping row): **Test print** (with the receipt icon; only when `testable`; "Printing…" while it
  prints; disabled by `startDisabled`) · **Change** ("Keep this printer" while the chooser is open; Task 11: the guided
  connect in the app) · **Remove** (`PRINTER_BUTTON_REMOVE_CLASS`; today's rule: `inSetup` → the note
  `PRINTER_IN_SETUP_MESSAGE`, `known` → the button; today's confirm "Remove {name} from this device?" "Yes, remove" / "No").
  The test's answer: today's `InlineConfirm` ("Did the test slip print?" "Yes" / "No — help me"; "Did it print without a
  print window?" "Yes" / "No") and `PrinterTestTips`; "Busy with another slip. Try again in a moment." when `deviceBusy`.
  Then **Paper width** (today's toggle). Kept as today: the elsewhere line, "Keep this tab open, or use the POS app: …"
  for a non-app printer, the snapshot's message line. No printer: the app → "No printer on {noun}." (13.5 px) +
  **Connect a printer** (`PRINTER_BUTTON_PRIMARY_CLASS`; Task 10: opens today's `NativePrinterPicker` inline; Task 11: the
  guided connect); Chrome → today's `BrowserPrinterConnect`; neither → today's `NO_CAPABILITY_MESSAGE`. The Windows app →
  the title "This PC's printer", today's `DesktopPrinterPicker` inside, Test print under it when `testable` (the host's
  attestation). Kept: `data-printer-target="device"` and `tabIndex={-1}` on the section; `<OtherDevicePrinters>` inside on
  the app (Task 10b restyles it). No Reconnect (X7).
- Card 3 (PrintForOthersCard, `data-action="designate"` on the one designate control of each state): title "Print for
  other devices"; sub "Phones and tablets without a printer can send their slips here." in the `offer` and `checking`
  states only. `checking`: today's "Checking where slips print…" / "This device is offline. Where slips print will show here
  when it is back online." `offer`: **Print all slips on this device** (36 px outline) → the label "Name for this device",
  the field (44 px, 16 px text below 720 px, `maxLength` 60, today's default name), **Print all slips here** (40 px
  primary; "Saving…" while it saves) and **Cancel** (40 px outline, closes the form). `host` (simple): "This device prints
  slips for **all devices**." + **Stop printing here** → confirm `stopQuestionOf(false)` = today's "Removing the printing
  device cancels every waiting slip. Continue?" ("Yes, remove" / "No"). `host` (printers mode, a former host): "Printers
  are set up: each slip prints at its own printer." + **Stop printing here** → confirm `stopQuestionOf(true)` = "Stop
  printing here? Each printer keeps printing its own slips." ("Yes, stop" / "No") (B10: the untrue sentence only in simple
  mode). `elsewhere`: "Slips print at **{host}**." + **Print here instead** → online: today's "{host} is printing now.
  Move printing to this device?" ("Yes, move" / "No"); offline: designates at once (today). Bold marks `**…**` drawn as
  `<strong>` (as the status card does). Toasts: the hook's (today's).
- Card 4 (TextKotSection): title "Faster KOTs", no sub (today's long description goes); each row: label "Print KOTs as
  plain text" (13.5 px / 500) over "English only. Prints in about 1 second." (12.5 px); with two or more rows the sub is
  "{printer name} · English only. Prints in about 1 second." (`textKotRowWordsOf`); the switch's `aria-label`
  "Print KOTs as plain text: {printer name}". Unchanged: "Characters per line" with "Automatic" / "42", the question "Did it
  print clearly, with the ruler on one line?", every other line, the switch's logic. No row for a printer that cannot
  (today's `textKotPrintersOf`).
- Card 6 (MoreCard): one list card, 52 px rows (padding 12 / 16, 14 px / 500, a --border-2 rule between rows, a
  chevron on the navigating rows), rows = `moreRowsOf`: "Change POS address" (`native`; `nativeRequest("app.changeUrl")`,
  today's failure toast), "Battery settings" (`native && battery`; `app.battery`, today's toast), "Remove the printing
  device" (`!printersMode && !isHostDevice && hostSet`; --status-bad-ink; tap → today's `InlineConfirm` with
  `stopQuestionOf(false)` "Yes, remove" / "No" in the row's place; `clear()`), "Printer setup" (`isAdmin && home ===
  "sheet"`; closes the sheet, then `/printers`, as the status card's link does). No row → no card.
- Removed words (on purpose): "Where slips print", "Choose which device prints your slips.", "Each device prints its own
  slips.", "Use one device for all printing", "Good for a Counter PC with the printer: …", "Printers are set up: each slip
  prints at its printer (Printer setup → Printers).", "More options", "Battery settings for printing" + its help,
  `CLEAR_HELP`, "Test print" card's sub and notes, "Fast text KOTs (English only)" + its description.

- [ ] **Step 1: Write the failing tests** in `lib/printer/settings-view.test.ts` (every assertion with a message):
  `print for others: each state's view` (printers mode + not host → hidden; printers mode + host → `{ kind: "host",
  printersMode: true }`; host → `{ kind: "host", printersMode: false }`; `host === null` online → checking "Checking where
  slips print…", offline → the offline line; another host → `{ kind: "elsewhere", host: "Counter PC", online: true }`;
  none → offer); `the stop question says the cancel only in simple mode` (exact strings above); `More draws only the rows
  that apply` (the app + battery + a host set + admin + sheet → all four in order; on /printers no "printer-setup"; the
  host → no "remove-host"; printers mode → no "remove-host"; Chrome staff with no host → `[]`); `the words of More's rows`;
  `the device card's title and sub` (desktop → "This PC's printer"; a Bluetooth 80 mm printer → "Bluetooth · 80 mm
  paper"; 58 mm → "… · 58 mm paper"); `Faster KOTs rows name the printer only when there are two` (1 row → sub "English
  only. Prints in about 1 second."; 2 → "Kitchen printer · English only. Prints in about 1 second.").
  Source pins (in the same file, comments stripped): `the settings view draws its cards in §6.6's order` (PrinterSettingsView:
  `<DevicePrinterSection` < `<PrintForOthersCard` < `<TextKotSection` < `<BillPrinterSection` < `<MoreCard`); `the focus
  targets moved with their controls` (`data-printer-target="device"` in DevicePrinterSection, one `data-action="designate"`
  per state in PrintForOthersCard); `the hooks keep today's handlers` (use-test-print.ts: `await queueTestSlip()`,
  `useBeatPrintHost(`, the startDisabled expression; use-printer-setup-actions.ts: "Printing device removed — ",
  `syncHostPref()` after both writes); `no card reads the pulse twice` (`usePosPulseContext(` once in
  use-printer-setup-actions.ts, nowhere else under components/print/settings/).
- [ ] **Step 2: Run** `node --import tsx --test lib/printer/settings-view.test.ts` from `apps/cafe` → FAIL (module not found).
- [ ] **Step 3: Implement** the hooks (moved code first, then the cards), `settings-view.ts`, the three components, the card
  restyles; delete the three files; re-point every pin below (same meaning, new path; none deleted to pass; each listed in
  the Results); update `docs/GO-LIVE-CHECKLIST.md`'s quotes of the Faster KOTs words (`go-live-runbook.test.ts` PIN §1
  follows).
- [ ] **Step 4: Run** the new file + every pin file below + `lib/css-compat.test.ts` → PASS; `npm run typecheck` → 0; the
  cafe chain → 0 fail.
- [ ] **Step 5: Commit** `feat(print): the printer settings as cards (PX-3 Task 10)`.

Pins changed on purpose (re-point each needle at the file that now holds its code, keep its meaning):
`lib/printer-panel-layout.test.ts` (PANEL_FILES; the buttons test's file reads; the views test: `<PrinterSetupCard` →
`<PrinterSettingsView`; the words test's keep-list re-pointed, "More options" / "Where slips print" / "Print test slip"
out on purpose, the Remove note's dash out (X9); the focus test → `hooks/use-printer-panel-focus.ts`),
`lib/printer-ui-paths.test.ts` (the where / card / advanced / device / tips / paper entries and their mutations),
`lib/print-host-card-paths.test.ts` (CARD_TSX → the two hooks; CARD_FILES; PIN b, d, f, g re-pointed; the 2nd hop →
`<PrinterSettingsView`), `lib/print-paths.test.ts` (PRINTER_SETUP_CARD → `hooks/use-test-print.ts`),
`lib/print-text-kot-paths.test.ts` (the order needle → PrinterSettingsView), `lib/print-bill-printer.test.ts:99-103`
(printers mode reaches PrintForOthersCard through the hook), `lib/print-setup-fields.test.ts:46-47` (the panel order →
PrinterSettingsView), `lib/pos-pulse-paths.test.ts:151-162` (the pulse reader `PrinterSetupCard.tsx` →
`hooks/use-printer-setup-actions.ts`), `lib/printer-status-card.test.ts:167` (the order needles), `lib/go-live-runbook.test.ts`
PIN §1 (TextKotSection's quoted words).

### Task 10b: Printers on this device (printers mode)

**Files:**
- Modify: `components/print/DevicePrinterSection.tsx`, `components/print/OtherDevicePrinters.tsx`, `lib/printer/settings-view.ts`
  (+ test), `components/print/printer-classes.ts`
- Budgets: DevicePrinterSection ≤ 260, OtherDevicePrinters ≤ 220.

**Interfaces:**
- `settingsNameOf(here: readonly PrinterHere[], nativeId: string | null): string | null` (settings-view.ts) — the setup's
  name of a printer of this device: the `here` entry whose `nativeId` matches (case-insensitive), or for `null` (this
  device's own printer) the entry with no `nativeId`; `null` when the setup does not name it (the app's own name shows).
- The card in printers mode (`dotPrinters.printersMode && dotPrinters.isWriter`, from `useDotPrinters(deviceId)`):
  title "Printers on this device", sub "Which slips each one prints: set by your manager."; first this device's own
  printer as a block (its setup name, else the app's; sub "{type} · {paper} paper"; the state word; **Reconnect** only
  when not `connected` — today's `settle(devicePrinter().reconnect())`; **Test print** (X5); **Remove** / the note by
  today's rule; no Change), then `<OtherDevicePrinters>`'s blocks in the same card (no title of their own): the setup
  name else the app's, sub "{app name} · {transport label}" (+ the tcp address as today), the state word ("Connected" /
  "Connecting…" / "Not connected", today's `STATUS_WORDS`), **Reconnect** only when not connected (today's call and
  toasts), **Test print** (X5: admins, only for a printer of `here`), **Remove** / the in-setup / takeover notes by today's
  rule; then **Connect another printer** (today's add; Task 11: the guided connect in add mode). Simple mode keeps
  "Other printers on this device" as a 13 px label with the same blocks (Reconnect stays there: no status-card Reconnect
  covers them) and "Connect another printer".
- Words: `OtherDevicePrinters`'s `NOTE` → "Which slips each one prints: set by your manager."; "Add another printer" →
  "Connect another printer"; "Close the printer list" stays for the open chooser.

- [ ] **Step 1: Write the failing tests** (settings-view.test.ts): `the setup names a printer of this device`
  (`settingsNameOf` with Kitchen (no nativeId) and Bill (`bt-classic:BB`): `null` → "Kitchen printer", `"BT-CLASSIC:bb"`
  → "Bill printer", an unknown id → `null`); source pins: `printers mode is one card` (DevicePrinterSection renders the
  title "Printers on this device" and `<OtherDevicePrinters` inside the same `<PanelSection>`); `Reconnect only on a
  printer that is down` (both files gate it on the status); `the setup's test is the admin's` (`useTestPrinter` only under
  `isAdmin`); `staff keep the device test on this device's printer` (`useTestPrint` in DevicePrinterSection).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the file + the pins below → PASS; typecheck 0.
- [ ] **Step 5: Commit** `feat(print): printers mode: one card for the printers on this device (PX-3 Task 10b)`.

Pins changed on purpose: `lib/print-agent-printers.test.ts:306-328, 591` (the moved words; the rules unchanged),
`lib/print-setup-ui-paths.test.ts:165-172`, `lib/printer-ui-paths.test.ts` (others).

### Task 11: The guided connect (the Android app)

**Files:**
- Create: `apps/cafe/lib/printer/connect-flow.ts` + `connect-flow.test.ts`, `apps/cafe/hooks/use-printer-views.ts`,
  `apps/cafe/hooks/use-connect-attempt.ts`, `apps/cafe/hooks/use-native-printer-list.ts`,
  `apps/cafe/components/print/connect/` `ConnectFlow.tsx`, `ConnectType.tsx`, `ConnectList.tsx`, `ConnectProgress.tsx`,
  `ConnectTest.tsx`, `apps/cafe/lib/connect-steps.test.ts` (`renderToStaticMarkup` of the props-only steps)
- Modify: `PrinterPanel.tsx`, `PrinterStatusButton.tsx` (≤ 120, pin unchanged), `PrinterPanelFrame.tsx`,
  `settings/PrinterSettingsView.tsx`, `DevicePrinterSection.tsx`, `OtherDevicePrinters.tsx`, `printer-classes.ts`, `package.json`
- Delete: `components/print/NativePrinterPicker.tsx` (its last readers move to the guided connect; its logic moves to
  `use-native-printer-list.ts`, never forked)

**Interfaces:**
```ts
// lib/printer/connect-flow.ts (pure)
export type ConnectTransport = "bluetooth" | "usb" | "network";
export type ConnectStep = "type" | "list" | "connecting" | "connected" | "question" | "tips";
export interface ConnectEntry { mode: "replace" | "add"; transport: ConnectTransport | null }
export interface ConnectTarget { id: string; name: string }
export interface ConnectState { step: ConnectStep; mode: "replace" | "add"; transport: ConnectTransport | null;
  target: ConnectTarget | null; error: string | null }
export type ConnectEvent = { type: "choose"; transport: ConnectTransport } | { type: "pick"; target: ConnectTarget }
  | { type: "connected" } | { type: "failed" } | { type: "tested" } | { type: "not-printed" } | { type: "other" };
export const CONNECT_TRANSPORT_WORDS: Record<ConnectTransport, string>; // "Bluetooth", "USB", "Wi-Fi or network"
export function connectStartOf(entry: ConnectEntry): ConnectState;        // a transport → "list", else "type"
export function connectFlowReducer(state: ConnectState, event: ConnectEvent): ConnectState;
export function connectHeadOf(state: ConnectState): { sub: string; foot: "cancel" | "done" };
export function connectTransportOf(word: TransportWord | null): ConnectTransport | null; // bluetooth / usb / network, else null
// hooks/use-printer-views.ts — the sheet's views, owned by the button (the panel's own on /printers)
export type PrinterPanelView = "status" | "settings" | "connect";          // moved here from PrinterPanel.tsx (re-exported there)
export interface PrinterViews { view: PrinterPanelView; connect: ConnectState | null; show(next: "status" | "settings"): void;
  startConnect(entry: ConnectEntry): void; send(event: ConnectEvent): void }
export function usePrinterViews(): PrinterViews;
// hooks/use-connect-attempt.ts — today's connect calls, moved from DevicePrinterSection.tsx:56-66 / OtherDevicePrinters.tsx:121
export function useConnectAttempt(): { replace(target: NativeSelectTarget): Promise<ConnectOutcome>;
  add(target: NativeSelectTarget): Promise<ConnectOutcome> }; // replace = keepInApp ?? devicePrinter().selectNative(target, paperDefault)
// hooks/use-native-printer-list.ts — NativePrinterPicker.tsx:47-166 as they are (load on mount + NATIVE_READY_EVENT, the
// pushed status order, scan, refresh, Turn on Bluetooth, Allow Bluetooth, the network form's checks)
export function useNativePrinterList(): { printers: NativePrinter[] | null; bluetooth: NativeBluetoothState | null;
  scanning: boolean; refreshing: boolean; working: boolean; scan(): Promise<unknown>; refresh(): Promise<void>;
  turnOnBluetooth(): Promise<void>; allowBluetooth(): Promise<void> };
// scan() resolves to the scan's error (null when it listed) and does not toast: the list says it inline (Task 13 reads a
// refusal from it). A list load's failure keeps today's toast.
```
- Reducer: type + choose → list (transport, error null); list + pick → connecting (target); connecting + connected →
  connected; connecting + failed → list with `error` = replace: "Could not connect to {name}. Check it is on, then try
  again." / add: "The printer is added, but not connected yet. Check it is on, then tap Reconnect." (X4); connected +
  tested → question (replace only); tips + tested → question; question + not-printed → tips; tips + other → type (target
  and error cleared); every other pair → the same state (`===`). Back / Cancel / Done are not events: they leave the view.
- Head: title "Connect a printer"; sub "Step 1 of 3" (type), "Step 2 of 3 · {CONNECT_TRANSPORT_WORDS[t]}" (list), "Step 3
  of 3" (connecting … tips); foot "cancel" for type / list / connecting, "done" after (X3).
- The frame: `PrinterPanelFrame` + `sub?: string` (under the title, `PRINTER_PANEL_SUB_CLASS`), `backLabel?: string`
  ("Back to printer status" settings; "Back to printer settings" connect), `onCancel?: () => void` (the foot shows
  **Cancel**, 44 px outline, `PRINTER_PANEL_CANCEL_CLASS`, instead of Done). The button: `usePrinterViews()` replaces its
  `useState<PrinterPanelView>`; Ruling Q holds (every open → `show("status")`, nothing on close); titles "Printer" /
  "Printer settings" / "Connect a printer".
- PrinterPanel: `PrinterPanel({ home, view, onView, connect, onConnect, onConnectEvent, onClose })` — `onView(next:
  "status" | "settings")`, `connect: ConnectState | null`, `onConnect(entry: ConnectEntry)`, `onConnectEvent(event)`; on
  `home="page"` it uses its own `usePrinterViews()` and draws the connect view inline in place of both views (a head row
  with the frame's classes: back, "Connect a printer", the sub; then the flow; then the foot's button). Entry points: the
  status card's `connect` (app) → `onConnect({ mode: "replace", transport: null })`; `connect-again` (app) →
  `{ mode: "replace", transport: connectTransportOf(deviceTransportOf(saved)) }`; elsewhere → today's `openSetup` (X2).
  Settings: Change / Connect a printer (app) → replace, null; Connect another printer → `{ mode: "add", transport: null }`.
- ConnectFlow `({ state, send, noun, onLeave }: { …; onLeave(to: "status" | "settings"): void })` draws the step:
  **type** (ConnectType, props only): "What kind of printer?" (16 px / 600), three 72 px rows with a 44 px tile
  (--status-info-tint, --primary icon 22 px), 15 px / 600 title over 13 px sub, a chevron: "Bluetooth" / "Most receipt
  printers", "USB cable" / "Plugged into {noun}" (X10), "Wi-Fi or network" / "On the cafe's network".
  **list** (ConnectList, the container over `useNativePrinterList`): Bluetooth — rows of the bt-classic / ble entries
  (Task 13 merges them), each: a 9 px quiet dot, name (14 px / 500) over "Paired" / "Nearby" (12.5 px), **Connect** (36 px;
  the first paired row's primary); on mount the scan runs once by itself ("Looking for more printers…" with a spinner,
  --border-2 rule above it, 13.5 px); today's Bluetooth notices ("Bluetooth is off on this device." + "Turn on Bluetooth";
  "The POS app needs permission to use Bluetooth." + "Allow Bluetooth"; the unsupported line); then the card "Not in the
  list?" with 1 "Turn the printer on." 2 "Pair it in Android's Bluetooth settings (PIN is often 0000 or 1234)." 3 "Then
  tap **Search again**." + **Search again** (36 px, a refresh icon). USB — the usb entries (sub "USB") + **Refresh**; none:
  "No USB printer found. Connect a powered printer with a USB OTG adapter, then tap Refresh." + today's OTG note. Wi-Fi or
  network — today's form: the label "Network printer (Wi-Fi or Ethernet)", "Printer address" (44 px, 16 px text below 720
  px) + "Port", today's checks and errors, `FindNetworkPrinters`, **Connect** (40 px primary). The row's / form's tap →
  `send(pick)`, then `replace(target)` or `add(target)` → `send(connected | failed)`; the inline `error` (13 px,
  --status-bad-ink, `role="alert"`) above the rows. **connecting** (ConnectProgress): a 48 px spinner, "Connecting to
  {name}…" (18 px / 600), "This can take up to 30 seconds. If Android asks to pair, tap **Pair**." (14 px). **connected /
  question / tips** (ConnectTest, over `useTestPrint`): a 64 px green check, "{name} is connected"; replace: **Paper
  width** (today's toggle, `devicePrinter().setPaper`), **Print a test slip** (44 px primary, only when `testable`; `start()`
  → `send(tested)`), a "Skip" link → `onLeave("status")`; add: "Your manager chooses which slips it prints, in Printer
  setup." **question**: a 64 px neutral circle (receipt icon), "Did the test slip come out?", **Yes** (48 px primary) →
  `answer(true, "Printing works on {noun}.")` then `onLeave("status")`; **No** (48 px outline) → `answer(false)` then
  `send(not-printed)`. **tips**: "Let's fix it" (16 px / 600), 1 "Paper roll: the shiny side faces the print head." 2
  "Switch the printer off and on." 3 "Try the other paper width." with the toggle, **Print the test slip again** (44 px
  primary) and "Choose another printer ›" (`send(other)`).

- [ ] **Step 1: Write the failing tests:** `connect-flow.test.ts`: `a known transport starts at the list`, `each step and
  its next` (the reducer table above, every pair), `a failed connect returns to the list with its words` (replace / add
  exact strings), `add mode has no test step` (connected + tested → unchanged), `anything else changes nothing` (`===`),
  `the head says the step and the foot` (every step), `the saved printer's transport` (`connectTransportOf`).
  `connect-steps.test.ts` (`renderToStaticMarkup`, a global React as lib/floor-dialogs.test.ts): every step's words above,
  exactly; the first paired row's Connect is the primary; the Wi-Fi field is 16 px below 720 px. Source pins (in
  connect-steps.test.ts): `replace keeps a setup printer in the app` (use-connect-attempt.ts holds today's `keepInApp`
  expression; DevicePrinterSection no longer calls `selectNative`), `the list's logic is today's` (use-native-printer-list.ts:
  `loadPicker(`, `createStatusOrder()`, `NATIVE_READY_EVENT`, `listNative(true)`), `the sheet's views` (the button calls
  `usePrinterViews()`; its two opens call `show("status")`; nothing on close), and the F-I4 pin extended to the new
  components and hooks (no `refetchInterval`, `setInterval`, `router.refresh`, `useQuery(`).
- [ ] **Step 2: Run** both files → FAIL (modules not found).
- [ ] **Step 3: Implement**; delete NativePrinterPicker.tsx; re-point the pins below.
- [ ] **Step 4: Run** the two files + the pins + `lib/css-compat.test.ts` → PASS; typecheck 0; the cafe chain → 0 fail.
- [ ] **Step 5: Commit** `feat(print): connect a printer, step by step (PX-3 Task 11)`.

Pins changed on purpose: `lib/printer-panel-layout.test.ts` (the frame's head test: the sub and Cancel; the views test:
the connect view and the button's mount line; Ruling Q → `usePrinterViews`), `lib/printer-dot-ui-paths.test.ts` (the
frame's call shape), `lib/go-live-runbook.test.ts` (NETWORK_TITLE → ConnectList), `lib/print-find-network-paths.test.ts`,
`lib/print-agent-printers.test.ts:320-328` (keepInApp → use-connect-attempt.ts), `lib/print-setup-ui-paths.test.ts:172`,
`lib/print-host-card-paths.test.ts` (CARD_FILES), `lib/printer-ui-paths.test.ts` (native), `lib/printer-panel-layout.test.ts`
(PANEL_FILES + the primary-class pin).

### Task 12: The words everywhere (B10, the button names, the owner's two answers)

**Files:** `lib/printer/printer-dot.ts`, `lib/desktop-shell-messages.ts`, `lib/print-job-toast.ts`,
`hooks/use-print-host-bridge.ts` (net 0 lines), `lib/print-waiting-view.ts`, `lib/print-waiting.ts`, `lib/printer/print-lane.ts`,
`lib/print-routing.ts`, `lib/print-agent-printers.ts`, `components/print/TextKotSection.tsx`,
`components/print/setup/PrintersSetupSection.tsx`, `lib/pos-clock.ts`, and their tests.

- **Button names** (`printerButtonName`): "Printer connected — open printer", "Printer not connected — open printer",
  "Open printer", "Checking the printer — open printer", "Printer needs attention — open printer", "Printer not printing —
  open printer".
- **The Windows app's refusals, shown** (X1): `DESKTOP_SHELL_REFUSAL_WORDS: Readonly<Record<string, string>>` and
  `desktopRefusalWordsOf(message: string): string` in lib/desktop-shell-messages.ts (pure; any other message unchanged):
  "No printer is chosen for this PC. Open the printer icon, then Printer settings, and choose the printer." · "The chosen
  printer saves files instead of printing. Open the printer icon, then Printer settings, and choose the printer." ·
  "Direct printing is not available on this PC. Open the printer icon, then Printer settings, and choose the Windows
  driver method." · "The chosen printer was not found on this PC. Open the printer icon, then Printer settings, and choose
  the printer." · "That printer is not on this PC. Ask your manager to change it in Printer setup." ("No server address is
  set." unchanged). Read at: the Not printed row's refusal and a failed row's own words (lib/print-waiting-view.ts), the
  print bridge's toast (`slipToastOf(failure: string, jobId: string | undefined): string` in lib/print-job-toast.ts =
  `desktopRefusalWordsOf(jobId === undefined ? failure : jobPrintToastOf(failure))`, one call per toast line in
  use-print-host-bridge.ts: net 0 lines), and TextKotSection's error line. The dashboard band keeps its words (§10).
- **Staff pointers** (B10): `DESKTOP_NO_PRINTER_MESSAGE` → "No printer is chosen on this PC. Open the printer icon, then
  Printer settings, and choose the printer."; `PRINT_JOB_NOT_ROUTED_MESSAGE` → "No printer takes this slip. Ask your
  manager to switch Notices on for a printer in Printer setup." (X12); `PRINTER_IN_SETUP_MESSAGE` → "Set by your manager
  in Printer setup." (§6.6 item 2); `PRINTER_TAKEOVER_MESSAGE` → "This device prints it while the device that prints it is
  offline or cannot reach it. Set by your manager in Printer setup."; PrintersSetupSection.tsx:138,147 "… will show under
  Couldn't print." → "… will show under Not printed."; admin-only texts stay (token-settings-notes.ts:14,
  print-design-labels.ts:194 — the Settings and design-editor pages, admins only; the status card's `printer-not-here` row
  already splits staff / admin).
- **Q1:** lib/print-waiting-view.ts's "sent nothing" row → `name === null ? "The printer is off or not connected." :
  "{name} is off or not connected."` (the Windows refusal branch first, as today).
- **Q2:** `waitingPrintersOf`'s order → stuck first, then the most slips, then the setup's order (lib/print-waiting.ts:113);
  `printWaitingPrintersOf`'s key keeps its order (a stable string).
- **X13:** `clockPrinterWords("red")` → "needs attention".

- [ ] **Step 1: Write the failing tests** (exact strings; each in the test file that already holds its neighbours, or a
  new `lib/print-words-px3.test.ts` where a file is at 300): the six button names; `the refusal list is the Windows app's,
  byte for byte` (`DESKTOP_SHELL_REFUSALS` deep-equals today's six sentences; `printWriteOutcomeOf` of each → `sent: "no"`);
  `desktopRefusalWordsOf` maps the five and leaves any other sentence; `slipToastOf` (a job's not-connected → the B7 words;
  a desktop refusal, job or not → the new words; anything else unchanged); the row words (a refusal row shows the new
  words; Q1 named / unnamed); `a stuck printer is named first` (Kitchen 4 slips busy + Bill 1 slip stuck → Bill; two
  stuck → the most slips; a tie → the setup's order); the staff pointers; the clock word.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the files + the pins below → PASS; typecheck 0.
- [ ] **Step 5: Commit** `feat(print): the words point staff where they can go (PX-3 Task 12)`.

Pins changed on purpose: `lib/printer/printer-dot.test.ts:192-202,322`, `lib/printer/printer-dot-waiting.test.ts:30`,
`lib/print-waiting.test.ts:64-67`, `lib/print-setup-ui-paths.test.ts:69,71`, `lib/print-bill-printer.test.ts:87`,
`lib/print-waiting-view.test.ts` (the R5 row), `lib/print-waiting-printers.test.ts` (the order), `lib/print-job-toast.test.ts`
(the bridge's toast needle → `slipToastOf`), the pos-clock test, any test quoting the old pointer words (grep).
`lib/print-write-outcome.test.ts` unchanged.

### Task 13: One row per printer, the Location Allow

**Files:** `lib/printer/native-picker-state.ts` (+ `native-picker-state.test.ts`), `components/print/connect/ConnectList.tsx`,
`lib/connect-steps.test.ts`.

**Interfaces:**
```ts
export interface ConnectRow { id: string; name: string; sub: "Paired" | "Nearby" }
export function bluetoothRowsOf(entries: readonly NativePrinter[]): ConnectRow[];
export type ScanRefusal = "allow" | "settings-steps";
export function scanRefusalOf(error: unknown, asked: boolean): ScanRefusal | null;
```
- `bluetoothRowsOf`: only `bt-classic` / `ble` entries; one row per MAC (`address`, else the id after its first ":",
  upper-cased); the paired entry wins, then `bt-classic` over `ble`; the row keeps the winner's `id` and `name`; sub
  "Paired" when the winner is paired, else "Nearby"; paired rows first, then nearby, each in the list's order.
- `scanRefusalOf`: `nativeErrorCode(error) === "UNAUTHORIZED"` → `asked ? "settings-steps" : "allow"`; anything else → null.
- ConnectList: a scan refused → the notice "Android needs Location to find Bluetooth printers." + **Allow** (40 px primary;
  `nativeRequest("permissions.request", { kind: "bluetooth" })`: granted → scan again; refused → the steps); the steps: 1
  "Open Android Settings → Apps → Sandbee POS → Permissions." 2 "Allow Location (or Nearby devices)." 3 "Come back and tap
  **Search again**."; any other scan error → today's `nativeErrorMessage` as the inline line (a Location that is off keeps
  its own sentence).

- [ ] **Step 1: Write the failing tests:** `one row for a printer seen twice` (`bt-classic:AA:BB` paired + `ble:aa:bb` → one
  row, the classic id, "Paired"); `a BLE-only printer is nearby`; `paired first, in the list's order`; `USB and network
  entries are not Bluetooth rows`; `a scan refused asks to Allow, then shows the steps`; `other errors are not a refusal`;
  render: the notice and Allow, then the three steps.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; typecheck 0.
- [ ] **Step 5: Commit** `feat(print): one row per printer, and Allow for Android's Location ask (PX-3 Task 13)`.

### Task 14: Verification, the review, the Results

- [ ] Suites: cafe chain, typecheck, lint (`NODE_OPTIONS=--max-old-space-size=6144`), shared, the live legs (drop and
  re-make `pos_scratch_print_host_px3`), `PIN (S1)`; `git diff --stat b570c73..HEAD` over the SR-1 paper paths, SR-11's
  offline paths, the lane constants, `lib/print-queue.ts`, `lib/print-lease.ts`, the shared lifecycle, `apps/mobile`,
  `apps/desktop`, `app/api` → empty; `print-budget.test.ts` unchanged.
- [ ] Build `D:\kd\pxr` at the head; serve on :3175. Harness (`D:\kd\pos-dev-keep\printer-ux\tools`, PX2-RUNBOOK.md): PX-2's
  blocks A and B again; then the settings cards (simple, printers mode, host, More) and the guided connect: the fake
  app's `bt-classic` + `ble` entries of one MAC → one row (B9); a scan refused → "Allow", refused again → the steps (B11);
  Connect → connecting → connected → test slip (the fake printer's count +1) → Yes (toast, status) / No (tips, again);
  add mode ends at connected; the extra scroll of the settings view at 390 ≤ 64 px; a11y-check.mjs 0 violations on
  status, settings and connect at 390 and 1280. Shots beside the mockups in `D:\kd\pos-dev-keep\printer-ux\px3\`.
- [ ] Emulator Pixel_7_API_33 (WebView 109 + 154, the local harness only): settings, the guided connect, the 154 inset;
  put it back as found. The Windows app smoke: the settings view's "This PC's printer" card with DesktopPrinterPicker.
- [ ] A fresh Claude Fable 5.1 review of 7518e05..HEAD (read-only); one fix wave; the Results below; the owner's
  real-printer check list (spec §11) handed over; drop this session's scratch databases.

---

# Session PX-2 Results

Done 2026-11-05 on `feat/printer-ux` (from 46dcb61; origin/main = main = 82e3321, fetched first, no move). Not pushed,
not merged. Subagent-driven: one implementer + one reviewer per task, fix rounds where a review asked, then a fresh
Claude Fable 5.1 whole-branch review and one fix wave.

**Commits (13):** `b82c8f4` Task 1 · `99fd756` Task 2 · `ffffb47` Task 3 · `d40b278` Task 4 + `b381571` its review fix ·
`164d3c9` Task 5 + `9aa34b3` its review fix · `b9dcb73` Task 6 + `2594a7a` its review fix · `58ca3a0` Task 7 + `ee22303`
its review fix · `b929db8` the final review's fix wave + `4da1d43` (two comments back to UTF-8).

**Counts, before (46dcb61) → after (4da1d43):** cafe `npm test` 7607 / 7606 pass / 0 fail / 1 skip → 7747 / 7746 / 0 / 1;
shared 1062 → 1074 (0 fail); live legs on a fresh `pos_scratch_print_host_px2` 499 → 524 passed, 0 failed (CW1–CW9 +
CW1b; run at ee22303: no server file changed after it); typecheck 0 → 0; lint 0 errors (the 2 old warnings,
masters-blob.test.ts:331) → the same; `PIN (S1)` 16/16 green. `git diff --stat 82e3321..HEAD` over the SR-1 paper paths,
the SR-11 offline paths, the lane constants (web-printer-types.ts, lane-print.ts), `lib/print-queue.ts` and the dashboard
band hooks: empty. `print-budget.test.ts`: +1 test only.

**RED → GREEN per task (each task's report holds the outputs):** Task 1 module not found → 11/11 (shared 1073);
Task 2 module / route not found + the budget test + the CAS deep-equal → 9/9, shared 1074, live 524/0; Task 3 module
not found → 8/8; Task 4 both files module not found → 9/9 + 9/9 (fix round: 5 of 13 card tests RED → 13/13);
Task 5 five files module not found → 40/40 (fix round: 2 + 3 RED → green); Task 6 both files + the new pins RED → 6/6,
9/9, pins green, chain 7717/0; Task 7 three files RED → green, chain 7742/0 (fix round: 1 RED → 11/11); final fix wave:
3 items RED → green.

**What changed for staff:** the panel opens on one status card (what is wrong, ≤ 3 steps, one button); in printers mode
it names the printer that is down and Reconnect reconnects only that one; a phone that prints nothing turns amber and
names the stuck printer; the "Not printed" card shows a button only where it works, Clear always removes the slip for
good (also while it is printing), Clear all clears only the slips it asked about, in one request; the alarm toast stays
off the open panel; a printed slip leaves the list at once (from a fresh pulse answer); the job toasts no longer say
"print the slip again" for a slip that prints by itself; today's setup is one tap away under "Printer settings ›".

**Pins changed on purpose (none deleted):** `lib/print-lease.test.ts:73-76` (the CAS filter carries the request, F-I6a);
`lib/print-lifecycle-paths.test.ts` PIN (2B) (ack order, Ruling E) and `lib/self-order-alert-paths.test.ts` writer
allow-list (+ `lib/print-dismiss.ts`), Task 2; `lib/print-waiting.test.ts` (348 → 338: the panel / per-tap / 3B pins →
NotPrintedSection, the groups test removed with `printWaitingGroups`), `lib/printer-ui-paths.test.ts`,
`lib/printer-panel-layout.test.ts`, `lib/print-setup-ui-paths.test.ts:148-151`, Task 4; `lib/printer-panel-layout.test.ts`
(the view order, F-I4 no recurring request, F-M6 focus, open-only reset), `lib/printer-ui-paths.test.ts` (panel budget
90 → 220), `lib/printer-dot-ui-paths.test.ts` (frame call shape, simple-mode toast, close before push),
`lib/printer/printer-dot.test.ts` (the `printerHeadlineOf` cases moved to `printer-status-view.test.ts`),
`lib/print-host-card-paths.test.ts`, `lib/print-setup-ui-paths.test.ts`, `lib/print-waiting.test.ts` (one line each),
Task 6; `lib/print-agent-paths.test.ts` PIN (3B) (the ack needle), `lib/print-host-paths.test.ts` PIN (P) and
`lib/print-gating-fx-paths.test.ts` (bridge budget 265 → 270), Task 7. New pin files: `lib/print-dismiss-route.test.ts`,
`lib/printer-status-wiring-paths.test.ts`.

**Differences from this plan (each a ruling, why):**
- `PrintJobLifecycle.dismissRequest?: { at, by }` as the plan's interface (spec prose said `dismissRequested?: true`; A).
- Test files already over 300 lines never grew: Task 5's cases went to new `lib/print-waiting-printers.test.ts` and
  `lib/printer/printer-dot-waiting.test.ts` (B).
- The failover record stays for a slip cleared while printing (`ackPrintJob` records an unreachable network printer on a
  request-dismissed slip as on a queued one; E; print-lease.ts 343 → 344).
- Clear all shows from 2 slips (I); Cancel returns focus to Clear all (J); the confirm sends the ids snapshotted when it
  opened (the Task 4 review: a KOT arriving meanwhile is never cleared unasked).
- Panel taps no longer open the pulse's 2-minute lively window (K: lively anyway while rows wait; fewer reads).
- `waiting` = the first waiting printer this device does not print (N, R1); low paper never makes a printer "stuck" (O:
  it is "a warning only" everywhere else); `subject` = exactly what Reconnect reconnects; `dotPrintersOf` stays as it
  was (its output is pinned) and `useDotPrinters` adds `here` / `notHere`; `printer-dot.ts` 300 → 174 (the transient
  over 300 was not needed: `PrinterDotPrinters` moved to `print-agent-here.ts`).
- Simple-mode Reconnect keeps today's toast (`toastConnectOutcome`: "Printer connected." / the device's own failure
  words); "{names} connected." is printers mode only (P). The view resets on open, not on close (Q; spec §6.1's "resets
  when the sheet closes", same effect, no flash while the sheet slides down). "Open Printer setup" closes the sheet first.
- B4 edits the cached pulse only from a fresh (< 20 s), idle answer (S): every cache write restarts TanStack's interval
  timer, and a drain of listed slips would otherwise starve the host's pulse and beat (other devices would read the host
  offline after 180 s).
- The final review's fix wave: §6.3's first-match order for queued rows (refusal before problem, REPRINT / DUPLICATE
  before "sent nothing"); the summary asks for a tap when a row offers Print now (T); the held status is keyed per printer,
  so a new printer is checked fresh.
- Spec §6.10's 820 px cell: 3-button rows wrap (the mockup `s-wait5-820` and the brief), not one line.

**Reviews:** per task — Task 1 Approved; Task 2 Approved; Task 3 Approved; Task 4 Approved + fix round (5 addressed);
Task 5 Needs fixes (paper-low read as stuck; 6 assertions without a message) → fix round (6 addressed); Task 6 Needs
fixes ("Open Printer setup" under an open sheet) → fix round (4 addressed); Task 7 Needs fixes (B4 could starve the host
beat) → fix round (2 addressed). Final: Claude Fable 5.1, 82e3321..ee22303, **Ready to merge: Yes**, 0 Critical / 0
Important / 6 Minor, Review Focus 1–5 all hold, no deferred minor must be fixed before merge; minors 1, 2, 4 fixed in the
fix wave (scoped re-review: all addressed, no new breakage); minors 3 and 5 change spec words / rules → the owner (below);
minor 6 a note.

**Verification (Task 8):** the harness (`D:\kd\pos-dev-keep\printer-ux\tools`, runbook `PX2-RUNBOOK.md`, build of ee22303,
shots `D:\kd\pos-dev-keep\printer-ux\px2\`): Print now absent on fresh rows; Clear on a queued slip gone in 0.5 s and
never back in 90 s; Clear on a leased slip (FLIP, a 25 s failing write) gone in 0.5 s, never back, the job ended
"dismissed: cleared while printing"; Clear all 18 → 0 rows with exactly one POST; the alarm absent while the panel is
open and not popping after the close; Reconnect (simple) printed each waiting slip once (+5/5), toast "Printer
connected.", rows gone on the printed acks; printers mode Kitchen off → "Kitchen printer is not connected", Reconnect sent
only to the Kitchen printer (:9111 +3, :9112 +0); the waiter phone amber, "Slips are waiting for Kitchen printer" then
"Kitchen printer is not printing"; a11y (local axe) on the status and settings views at 390 and 1280: 0 violations.
Extra scroll vs the mockups + 24 px: every single state 0 / 0 / 0; s-wait5 56 / 0 / 100 (≤); s-wait20 and s-wait20-open
+38 px over the budget = the spec's "Still not working? Connect it again" link (§6.4) that those mockups leave out;
s-clearall 144 / 0 / 188 vs the mockup's 58 / 0 / 102 (the link + the mockup's own number is inconsistent: below its
s-wait5); accepted (V). The Windows app (its built main process unpackaged with scratch user data and a faked printer list,
`tools\smoke-px2.mjs`, build of 4da1d43): "No printer chosen on this PC" + "Choose a printer" → the settings view with
today's picker → "Printer ready" with the chosen printer's name; back and Done; 0 console errors (19/19 checks). The
emulator (Pixel_7_API_33, local harness, build of 4da1d43) on WebView 109 and 154: the status view, the Not printed list
folded (5 + "Show all 6") and expanded, the Clear all confirm, the settings view to its bottom, and Done above the
bottom inset (space below Done 13.3 CSS px on 109, 38.1 on 154 = its 24.8 px inset): all PASS; shots
`D:\kd\pos-dev-keep\printer-ux\px2\emu-*.png`, `win-*.png`. Noted, unconfirmed: on 109 the first tap on the header
button right after signing in only focused it (the second opened the sheet); 154 opened on the first tap.

**Left for PX-3 / the owner:** PX-3 Tasks 10–14 as planned (their interfaces did not move: the status view's settings
links focus `[data-printer-target="device"]` / `[data-action="designate"]`; `PrinterPanel` is 217 / 220 lines — move its
focus / fix wiring into a hook before the connect view); "…will show under Couldn't print." in
`components/print/setup/PrintersSetupSection.tsx:138,147` (Task 12); the /pos clock's screen-reader word "not connected"
on an amber phone (M, Task 12); the inline /printers page is not quieted by B5; owner questions: (1) the printer's name
in a printers-mode row ("Kitchen printer is off or not connected." instead of today's sentence, R5); (2) on a phone,
name a STUCK printer before a merely busy one with more slips (spec §6.5 says "the most slips").

# Session PX-3 Results

Done 2026-11-05/06 on `feat/printer-ux`. origin/main had moved to a831fd3 (T1 echo, offline-round fixes, the pre-deploy
check): merged INTO the branch first (`b570c73`, --no-ff, no file overlap). Not pushed, not merged, not deployed.
Subagent-driven: one implementer + one reviewer per task, fix rounds where a review asked, a fresh Claude Fable 5.1
whole-session review, one fix wave, then the harness / device checks and one harness-found fix.

**The owner's answers (start of PX-3):** Q1 yes (a printers-mode row that sent nothing names its printer); Q2 yes (a stuck
printer is named before a busy one with more slips).

**Commits (13 after the merge):** `646342e` plan (PX-3 exact) · `c6a8e68` Task 10 + `780bbcc` its review fix · `b3e761e`
Task 10b + `10e6f1e` its review fix · `f3f9f65` Task 11 · `11942bd` Task 12 · `51808b7` + `61a0f83` Task 11's review fix
(after Task 12 in history) · `fb61a0f` Task 13 · `2009a14` the final review's fix wave · `ff67d76` the harness's F2 fix.

**Counts, before (b570c73) → after (ff67d76):** cafe `npm test` 7760 / 7759 pass / 0 fail / 1 skip → 7851 / 7850 / 0 / 1;
shared 1076 → 1076 (no shared change); live legs 524 → 524 passed, 0 failed (fresh `pos_scratch_print_host_px3`, at
fb61a0f: no server file changed after); typecheck 0 → 0; lint 0 errors (the 2 old warnings) → the same; `PIN (S1)` 16/16.
`git diff --stat b570c73..HEAD` over the SR-1 paper paths, SR-11's offline paths, the lane constants, print-queue /
print-lease / print-dismiss, the shared lifecycle, `app/api`, `apps/desktop` and `print-budget.test.ts`: empty;
`apps/mobile`: README.md + TEST-CHECKLIST.md only (docs). `DESKTOP_SHELL_REFUSALS` unchanged (pinned byte for byte).

**RED → GREEN per task:** Task 10 settings-view module not found → 13/13 (fix round: 6 items, 34/34); Task 10b 10 RED →
23/23 (fix round: covering 186/186, pins moved to `printers-card-paths.test.ts`); Task 11 connect-flow + connect-steps
modules not found → 25/25 (fix round: 7 RED → 99/99; the T11-C revert); Task 12 print-words-px3 1/9 → 9/9; Task 13 0/7 →
40/40; final fix wave RED seen for I1, I2, m1, m3 → green (chain 7850); F2 fix RED → green (chain 7851).

**What changed for staff:** "Printer settings ›" opens cards instead of today's long setup: "This device's printer" (Test
print · Change · Remove, Paper width), "Print for other devices" (one device prints for all, Stop, Print here instead),
"Faster KOTs" (Print KOTs as plain text), "Bill printer for this device", More (Change POS address, Battery settings,
Remove the printing device, Printer setup for admins); in printers mode one "Printers on this device" card with each
printer, its state and Reconnect, Test print (admins: the setup's own test; staff: this device's printer), and Connect
another printer. In the Android app "Connect a printer" is now step by step: kind of printer → the printers it found (the
search starts by itself; a dual-mode printer is one row) → connecting → connected → a test slip → "Did the test slip come
out?" Yes / No → three tips; a scan Android refused for Location shows Allow, then the three settings steps. The words
send staff where they can go: the header button "— open printer", "Ask your manager…" / "Set by your manager in Printer
setup." instead of pointers to an admin page, the Windows app's refusals shown as "Open the printer icon, then Printer
settings, …", a printers-mode row names its printer, a phone names the stuck printer first. Chrome and the Windows app keep
their own pickers inside the card (X2).

**Pins changed on purpose (none deleted; every test file is A or M in the diff):** Task 10 — printer-panel-layout
(PANEL_FILES, buttons, views, words, focus → the hook, the section card's values: Ruling T10-A), printer-ui-paths (where /
card / advanced / device / tips / paper; partsPin), print-host-card-paths (CARD_TSX → the two hooks; PIN b, d, f, g; the
2nd hop), print-paths (→ use-test-print.ts), print-text-kot-paths (order), print-bill-printer:99-103, print-setup-fields:46-47,
pos-pulse-paths:151-162 (the pulse reader → use-printer-setup-actions.ts), printer-status-card:167, go-live-runbook PIN §1
(the Faster KOTs words; docs/GO-LIVE-CHECKLIST.md follows), printer-dot-ui-paths (focus); Task 10b — printer-panel-layout
(head gap 10), printers-card-paths (new), print-setup-ui-paths (the shared setup test tap), PrinterBlock hygiene budget 80 →
100; Task 11 — printer-panel-layout (frame head sub / Cancel, views, Ruling Q → usePrinterViews), printer-dot-ui-paths
(frame call shape), go-live-runbook (NETWORK_TITLE → ConnectList), print-find-network-paths, print-agent-printers:320-328
(keepInApp → use-connect-attempt.ts), print-setup-ui-paths:172, print-host-card-paths (CARD_FILES), printer-ui-paths
(native; the device lock pin inverted by T11-C), printers-card-paths, print-waiting:296, print-setup-fields:47,
print-text-kot-paths:59, printer-status-card:167; Task 12 — printer-dot:192-202,322, printer-dot-waiting:30,
print-waiting:64-67, print-setup-ui-paths (Not printed), print-bill-printer:87, print-waiting-view (R5 row),
print-waiting-printers (the order), print-job-toast + print-gating-fx-paths (the bridge's toast → slipToastOf),
print-text-kot-paths:49, pos-frame (the clock word); Task 13 — connect-flow (paired rows first); the final wave — the
Task 12 pins' messages and `\.` escapes restored, the X1 guard widened (print-words-px3); F2 — printers-card-paths
(showNames). New pin / test files: settings-view, printers-card-paths, connect-flow, connect-steps, connect-rows,
connect-location, bluetooth-scan, connect-settle-paths, print-words-px3.

**Differences from the plan (each a ruling, why; the SDD ledger holds them all):** S1 PrinterSettingsView takes `onClose`
(More's Printer setup closes the sheet first); S3 each connect step is a props-only view + a container; T10-A the cards take
§6.6's values (head 12/16 gap 10, body 0 16 14 gap 10); T10-B `deviceCardTitleOf(DotLane)`; T10-C/T12-A stale words in the
setup page and `apps/mobile/TEST-CHECKLIST.md` (a doc) follow the UI; T10-D More's "Remove the printing device" simple mode
only (spec §6.6 item 6); T10b-A the Windows app keeps its picker card in printers mode; **T10b-B every app printer keeps
Reconnect (primary when down, outline when connected), overriding X7 for app printers: a stale "Connected" link must stay
reconnectable where the phone's stuck step sends staff**; T10b-C Chrome / bridge v1 printers mode keeps Change; bridge v2
with no own printer shows one connect button; T11-A only BLE rows wait while the app scans (the app's BLE connect does not
stop the scan; Classic does); T11-B / I1 a failed connect says the app's own reason (thrown or not), else the step's words;
T11-C the device card is not locked by "connecting" (the app's own retries would flicker Change / Remove); T13-A one
`ConnectRow` type; T14-A the final review covered b570c73..fb61a0f; **T14-B the settings view's extra scroll at 390 over 64 px
is accepted (as PX-2's V)**: every excess is spec content or a kept action the mockups leave out; **T14-C** printers mode's own
block shows this device's paper (pre-existing; only the device test uses it) — told to the owner.

**Reviews:** per task — Task 10 Approved + a fix round (T10-A + 5 minors); Task 10b Needs fixes (Paper width hidden while the
device test still reads it; the admin's test skipped the setup's rule) → fix round, re-review clean; Task 11 Needs fixes
(a BLE connect during the scan) → fix round + the T11-C revert, re-review clean; Task 12 Approved; Task 13 Approved. Final:
Claude Fable 5.1, b570c73..fb61a0f, **Ready to merge: With fixes**, 0 Critical / 3 Important (a failed replace lost the
printer's reason; Allow had no double-tap guard; edited pins without messages) / 9 Minor; no ruling wrong. One fix wave
(`2009a14`: I1–I3 + minors 1, 3, 8, 9), scoped re-review: all addressed, no new breakage. Deferred, can wait: the "Tap
Reconnect" state word on simple mode's card, prefilling the Wi-Fi form on "Connect it again", settings-view.ts importing a
component file, MoreCard / useDotPrinters instance cost, /printers focus after the inline connect, a thrown plain Error's
raw words, the within-group order of merged rows, simple mode's "set by your manager" sub when another app printer exists.

**Verification (Task 14):** the harness (`D:\kd\pos-dev-keep\printer-ux\tools`, `PX3-RUNBOOK.md`; build of fb61a0f, then of
ff67d76; shots `D:\kd\pos-dev-keep\printer-ux\px3\`): PX-2's blocks A and B again — every behaviour check PASS (Print now
absent on fresh rows, Clear queued / leased never back, Clear all one POST, the alarm quiet, Reconnect once each, printers
mode only Kitchen, the phone amber "Printer not printing — open printer"); the guided connect — B9 one row per MAC
("Paired"), a BLE row held while scanning, connect → connected → test slip (:9111 +1) → Yes (toast "Printing works on this
tablet.", back to status) / No (tips, again +1), add mode ends at connected, Back / Cancel / Skip / Done; B11 — Allow →
one `permissions.request` → the three steps, or a new scan when granted; the fix wave — the app's reason inline ("Bluetooth
is off on this device. Turn it on, then reconnect the printer."), one toast for a connect finishing after the view was left,
one automatic scan after Turn on Bluetooth; a11y (local axe) 0 violations on every view at 390 and 1280. Run 1 (fb61a0f):
296 PASS / 16 FAIL = 7 of PX-2's accepted measures (V), 1 harness race (fixed), F1 ×6, F4 ×2 (fixed in 2009a14); re-run
(ff67d76): 245 PASS / 4 FAIL, all four the 64 px settings budget (T14-B). The settings view's extra scroll at 390 / 820 /
1280 after F2: simple 7 / 0 / –, simple + Battery 59, host 15, host + Battery 67, printers mode 132 (184 with Battery);
820 is 0 everywhere. The Windows app (its built main process unpackaged with scratch user data and a faked printer list, build of ff67d76): 25 PASS / 0 FAIL — "No printer chosen on this PC" → "Choose a printer" → the "This PC's printer" card with today's picker → "Printer ready" with the printer's name; the header name ends "— open printer"; Done closes; 0 console errors. The emulator (Pixel_7_API_33, local harness only, build of ff67d76) on WebView 109 and 154: 13 / 0 each — the status view, the settings cards to the bottom, the connect view (head "Connect a printer" + "Step 1 of 3", the three kinds, the Bluetooth step, the Wi-Fi form: the address field 44 px with 16 px text and no zoom), Cancel back to settings, Back to status; on 154 the foot sits 24.0 CSS px higher (its bottom inset). Not seen on a device: the Bluetooth rows and the scan (the emulator app has no Bluetooth permission: it shows that notice, "Not in the list?" and Search again greyed). Put back: WebView 154, adb reverse removed, the app stopped, the emulator synced and shut down; the Play Store was found disabled (another run) and left enabled. Shots `px3win-*.png`, `px3emu-109-*.png`, `px3emu-154-*.png`; scratch databases dropped; `D:kdpxr` unlinked (384 junctions) and removed.

**Left for the owner:** the merge OK (then the push with the token store, and the deploy per GO-LIVE, demo cafe first); the
real-printer checks below; T14-C (which paper a printers-mode tablet's own printer shows); native 2.0.3 items stay later
(PX-D7).

**The owner's real-printer checks (spec §11, after the deploy, demo cafe first):** Android tablet + two Bluetooth printers
in printers mode: switch the Kitchen printer off → its name on the card, 3 steps, Reconnect brings it back and the slips
print by themselves (once each); Clear while the app retries → the row never returns; Clear all; a waiter phone shows
amber with the printer's name ("Kitchen printer is not printing" once stuck); paper out → "out of paper" + the note;
Printer settings → "Printers on this device" (both printers, Reconnect, Test print as admin); simple mode: one printer off
/ on; **Connect a printer** step by step on a real Bluetooth printer (one row for it, Android's pair pop-up, the test slip,
Yes); on an Android 7–11 tablet with Location not allowed: Allow → the permission pop-up → the list fills.

## Polish after PX-3 (2026-11-06)

**The owner's ask:** after the deploy (fff1e22) and his real-printer checks ("All Done"): "First chhoti clean up karte
hai". Branch `feat/printer-ux-polish` from main f2b30c3. The minors the PX-3 final review left for later, each test-first
(`apps/cafe/lib/printer/printer-ux-polish.test.ts`: pure rules, and source pins each proven to bite by a mutation):

- **"Tap Reconnect" on simple mode's card:** a browser's saved printer that needs a tap (Chrome; the app never reaches
  `needs-tap`) said "Tap Reconnect" in its row and its line on a card with no Reconnect. That card now shows today's
  Reconnect in that state (`DevicePrinterSection.tsx`: `printersCard || status === "needs-tap"`); otherwise simple mode's
  Reconnect stays the status card's (T10b-B).
- **The Wi-Fi form on "Connect it again" (and Change):** a replace starts the form at this device's saved network
  printer's address and port (`networkPrefillOf`: the app id `tcp:<host>:<port>`); an add (Connect another printer)
  starts empty, as before.
- **A thrown plain Error's raw words:** a thrown connect shows inline only a sentence written for staff (this device's,
  the pool's, each of the app's refusals: `ATTEMPT_WORDS`, lane-print's rule); a code error's text falls back to the step's
  own words.
- **The order of merged Bluetooth rows:** a printer the app lists twice sits where the entry it is shown as sits (the app's
  order), not where its first entry was; paired first, then nearby, as before.
- **Simple mode's note under "Other printers on this device":** it said the printers-mode sentence ("Which slips each one
  prints: set by your manager."); simple mode now says "Every slip prints on the printer above. Your manager can give these
  printers their own slips in Printer setup." (`otherPrintersNoteOf`; a printers-mode device the setup names no printer for
  keeps the card's sub).
- **/printers' focus after the connect view:** leaving it (Back, Cancel, Done) focused nothing (the page body); the focus
  now goes to this device's printer card, which shows how it ended. The card's selector lives once, in the focus hook.
- **settings-view.ts imported a component file:** `components/print/printer-type.ts` was pure words plus icons nothing
  used; it moved to `lib/printer/printer-type-label.ts` without the icons. The print-paths test's `PRINTER_SETUP_CARD`
  constant (a hook's path) is now `TEST_PRINT_HOOK`.
- **Not changed (ruled):** MoreCard / useDotPrinters mounted twice: cached reads and memo work only, no request; changing
  the hooks costs more risk than it saves. T14-C (which paper a printers-mode tablet's own printer shows) stays the
  owner's.

Pins moved on purpose (comments in place): `printer-ui-paths.test.ts` and `printers-card-paths.test.ts` (the device
card's Reconnect gate, the note), `printer-dot-ui-paths.test.ts` (the selector's one copy), `print-paths.test.ts` (the
constant's name). No server, model, request, paper or native change.
