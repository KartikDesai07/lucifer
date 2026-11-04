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
| PX-3 | Spec with fixed interfaces (Tasks 10–14): the settings cards, the guided connect, the words everywhere, one row per printer, the Location Allow, responsive polish. | the owner's merge OK |

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

# Session PX-3 (spec, fixed interfaces): the settings view, the guided connect, the words

Acceptance: §6.6–§6.9 (B9–B11) as drawn in the mockups `t-settings-*`, `t-host-*`, `g1`–`g6`; every setup action of today
still reachable and working (connect, change, remove, paper width, test print + attestation, one device for all, stop,
move, fast text KOTs, bill printer, change POS address, battery settings, remove the printing device); the extra scroll of
the settings view at 390 ≤ 64 px. PX-2's Task 0 / Task 8 shape (baseline, verification, review, Results).

### Task 10: The settings view as cards

- Create `apps/cafe/components/print/settings/` `PrinterSettingsView.tsx` (`({ home }: { home: "sheet" | "page" })`),
  `ThisDevicePrinterCard.tsx`, `PrintersHereSettingsCard.tsx`, `PrintForOthersCard.tsx`, `FasterKotsCard.tsx`,
  `MoreCard.tsx`. They reuse, never fork, today's logic: `DevicePrinterSection`'s state, `NativePrinterPicker`,
  `BrowserPrinterConnect`, `DesktopPrinterPicker` + `DesktopPrintMethod`, `PaperSizeToggle`, `OtherDevicePrinters`' pool
  calls, `PrintWhereSection`'s designate / move / stop and `PrinterSetupCard`'s handlers (move them into a hook
  `hooks/use-printer-setup-actions.ts` exposing `{ designate(label), clear(), testPrint(), attest(yes) }` with today's
  toasts), `TextKotSection`'s rows, `BillPrinterSection`, `PrinterAdvanced`'s items.
- `PrinterSetupCard.tsx`, `PrintWhereSection.tsx`, `PrinterAdvanced.tsx` are deleted once every reader moved (or kept
  only where `/printers` still needs them; nothing unused stays). The focus targets `data-printer-target="device"` and
  `data-action="designate"` move with their controls (the status card's links use them).
- Tests: `renderToStaticMarkup` per card (each state of §6.6 with its exact words); the pins of PX-2 Task 6 updated for
  the settings view's new children.

### Task 11: The guided connect

- Create `apps/cafe/lib/printer/connect-flow.ts` (pure):
  `type ConnectStep = "type" | "list" | "connecting" | "connected" | "question" | "tips"`;
  `interface ConnectState { step: ConnectStep; mode: "replace" | "add"; transport: TransportWord | null; target: { id: string; name: string } | null; error: string | null }`;
  `connectFlowReducer(state: ConnectState, event: ConnectEvent): ConnectState` with events `choose(transport)`,
  `pick(target)`, `connected()`, `failed(message)`, `test()`, `answer(yes: boolean)`, `again()`, `back()`; and
  `connectStepsOf(lane): ConnectStep[]` (the Windows app starts at `list`).
- Create `apps/cafe/components/print/connect/` `ConnectFlow.tsx` (the third view; head "Connect a printer" + "Step n of
  3 · {type}"; foot Cancel), `ConnectType.tsx`, `ConnectList.tsx` (paired at once, the 8 s scan started on mount, "Search
  again", the not-in-list steps; USB list + Refresh; network address + FindNetworkPrinters), `ConnectProgress.tsx`,
  `ConnectTest.tsx` (paper width, test slip, yes / no, tips; the host's attestation exactly as today's Test print).
- Entry points: the status card's "Connect a printer" / "Still not working? Connect it again" (Bluetooth list, replace),
  settings' "Change" (replace) and "Connect another printer" (add, printers mode).
- Tests: the reducer (every step and back), `renderToStaticMarkup` of each step's words (§6.7 exact).

### Task 12: The words everywhere (B10, the button names, Faster KOTs)

- `printerButtonName`'s five names: "— open printer setup" → "— open printer" (pins in `lib/printer/printer-dot.test.ts`,
  `lib/printer-dot-ui-paths.test.ts` changed on purpose).
- "Printer setup" pointers in staff text (spec §5's list): a staff reader gets "Ask your manager to change it in
  Printer setup."; an admin gets a link to `/printers`; the printers-mode "cancels every waiting slip" confirm only in
  simple mode; `lib/desktop-shell-messages.ts`'s "Open Settings, then Printing" web copies → "Open the printer icon,
  then Printer settings, and choose the printer." (the Windows app's own words are native, later).

### Task 13: One row per printer, the Location Allow

- `apps/cafe/lib/printer/native-picker-state.ts`: `mergeBluetoothRows(entries: readonly NativePrinterEntry[]):
  NativePrinterEntry[]` — one row per MAC (the `bt-classic` / paired entry wins; its sub "Paired", a BLE-only one
  "Nearby").
- `scanRefusalOf(error: unknown, sdk: number | null): "allow" | "settings-steps" | null` → the list shows "Android needs
  Location to find Bluetooth printers." + **Allow** (the bridge's `permissions.request`), then the 3 settings steps of §6.9
  B11 when still refused.

### Task 14: Responsive polish, verification, the Results

- The three sizes against the mockups (`out\*-390/820/1280.png`), WebView 109 + 154 on the emulator (the guided
  connect included, the Android pairing pop-up seen on the emulator's Bluetooth stub only as far as it goes), the Windows
  app smoke, a11y 0, the harness flows of PX-2 again, the review, the fix wave, the Results, the owner's real-printer
  check list (spec §11) handed over.

---

# Session PX-2 Results

(Filled by Session PX-2.)

# Session PX-3 Results

(Filled by Session PX-3.)
