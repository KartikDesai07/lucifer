# Phase 1: print-job lifecycle, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the owner's choice) to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A print job counts as printed only when the device that wrote it acknowledges the write. Failures retry by themselves and are labelled (REPRINT / DUPLICATE). Nothing is lost silently (spec §7), and existing outlets keep working with no new setup (simple mode, §6.6).

**Architecture:** Every lifecycle transition is a pure plan in `packages/shared/src/print-lifecycle.ts`, unit-tested row by row against spec §7.2. The server applies a plan with one compare-and-set on `{_id, status, epoch}`, so a racing writer misses instead of double-transitioning.

The server API (lease, ack, confirm, retry, wake POST) is agent-agnostic. Jobs move to server-side creation inside the order request. Agents in the web page lease, write, then ack. The repair sweep rides wake/pulse at most once per 60 s, never Vercel Cron.

**Tech stack:**
- `packages/shared` (TS, node:test via `tsx`);
- `apps/cafe` (Next.js 15.5, Mongoose 8, Zod 3, node:test via `tsx`, live-Mongo legs);
- `apps/mobile` (React Native 0.87 + Kotlin);
- a dependency-free Node tool, `scripts/fake-escpos-printer.mjs`.

**Spec:** [docs/superpowers/specs/2026-10-02-printing-reliability-design.md](../specs/2026-10-02-printing-reliability-design.md). Read these sections before starting: §5, §6.4–6.6, §7 (all), §9.1, §10, §13, §14 and §17.

**Phase 0 review:** passed on 2026-10-02 (see the Review section at the end of [2026-10-02-phase-0-review-fixes.md](2026-10-02-phase-0-review-fixes.md)). Its three cheap follow-ups are Task 0 below.

---

## How Phase 1 is split

Phase 1 is too big for one session. It runs as **five sessions, 1A → 1E**, each on `feat/printing-reliability`. Each session ends with:
- all suites green;
- the Next build;
- both APK builds;
- an emulator check;
- a filled-in Results section for that session.

| Session | Delivers | Behaviour change for a cafe |
|---|---|---|
| **1A (this prompt)** | The lifecycle core, dormant: shared state machine and budget test; `PrintJob` lifecycle fields; the `PrintDevice` model; lease, ack, confirm, retry and wake-POST routes; the sweep (expire, retarget, limits, prune); the live-Mongo legs; the fake ESC/POS printer; the E2E harness bring-up | **None.** No client calls the new routes yet. Jobs enqueued by today's tabs gain lifecycle fields and a `targetDeviceId`, and today's claim path keeps working unchanged. |
| 1B | Server-side job creation in the order routes (header-gated, so tabs from before Phase 1 never duplicate a slip); the repair sweep; the `print-status` realtime kind (+ Worker parity). **Exact code at the end of this plan** (written at the 1A review gate) | None until 1C's clients send the header (the auto-accept's job was reverted at 1B's final review; R4 became 1C's job-aware lane) |
| 1C | The agent: the owner's two-attempt rule; a failure's class (`sent: "no" \| "maybe"`); lease/ack loop, never while the printer is off; pending-ack store, local timers, the host's wake; the REPRINT/DUPLICATE banner; every call site prints through the agent; the job-aware self-order lane. **Exact code at the end of this plan** (written at the 1B review gate) | Slips print through lease → write → ack (released only together with 1D) |
| 1D | The 1C gate's agent rulings (the owner's I3; F1, M4–M6); **the one waiting-slips panel** on every device with its count on the printer button (`/pos` too), the 20 s alarm, the pulse sweep, aimed retries. **Exact code at the end of this plan** (written at the 1C review gate) | Staff see every slip that did not print, and act on it |
| 1E | The Phase 1 exit scenarios with the fake printer, the 200-order soak, TEST-CHECKLIST, and **the local free-tier measurement (§17.3 item 5; nothing is deployed until every phase is done)** | Release candidate |

**Gate rule** ([[phase-per-session-workflow]]):
- After each session, the orchestrating review session deep-reviews it.
- It then writes the next session's exact code into this plan, against the code that actually landed, and commits it before handing over that session's prompt.
- Sessions 1B–1E below are therefore task specifications with their interfaces, tests and exit checks. Their code blocks are filled in at their gate.
- Session 1A is complete, exact code. Session 1B's exact code was written at the 1A review gate and is near the end of this plan, after the 1A review and its rulings.

---

## Global Constraints

- **Branch:** `feat/printing-reliability` only. Check with `git branch --show-current`. Never commit to `main` and never merge; the owner decides merges. Push the feature branch only at a session's end and only with the repo's token credential (`GIT_TERMINAL_PROMPT=0 git push origin feat/printing-reliability`; never Git Credential Manager or the owner's main account; never print the token).
- **Free tier forever** (spec §2, §17):
  - Each cafe runs on its own Vercel Hobby + Atlas M0 + Cloudflare free accounts.
  - No paid service, no Vercel Cron, no new recurring request on ordering devices.
  - Every new recurring request must fit §17, and `packages/shared/src/print-budget.test.ts` pins it.
  - Mongo writes stay at ≤ 3 per slip, plus ≤ 1 device upsert per 30 s.
- **No connectors and no uploads.** No claude.ai connector, ever. Nothing from this repo (code, diffs, plans, reports, screenshots, test pages, logs) goes to Artifacts, Claude Docs or any other external service, even if a tool or skill suggests it. Reports go in the chat (Hinglish) and in English repo docs on the branch.
- **House rules for models** (spec §6):
  - plain default-bound models, not in the federated registry;
  - no TTL index (ttl-guard);
  - omit-empty optional fields, with no `default:` (arrays say `default: undefined`).
- **Server libs:**
  - never call `connectDB()` (routes do);
  - no `console.*`;
  - strict TS, no `any`;
  - a file stays under ~300 lines.
- **Routes:**
  - Use `requireAuth()` or `requireAdmin()`.
  - Validate with Zod schemas kept in a lib file (a route file cannot export extra names). Validate `[id]` with `mongoose.isValidObjectId`.
  - Wrap every response in `noStore(success(...))` and every 500 in `noStore(serverError(...))`.
  - Staff names fall back to `"Staff"` (a Mongoose `required` string refuses `""`).
- **Old tabs keep working for one release** (spec §15):
  - `/claim` and `/kot-claim` stay.
  - `GET /api/print-jobs/wake` stays exactly as it is.
  - Optional headers stay optional.
- **Tests:**
  - cafe: a new test file is appended to `testChain` in `apps/cafe/package.json`.
  - shared: a new test file is added to the `test` script in `packages/shared/package.json`.
  - DB-touching code is tested three ways: pure helpers (unit), source pins (`readFileSync` + `stripComments`), and live legs (`npm run verify:print:live`, local mongod, `pos_scratch_*` databases only).
  - Changing an existing pin is allowed only to follow a deliberate change in this plan. Keep the pin's intent and name each changed pin in Results.
- **Windows + Git Bash:**
  - Set `GRADLE_USER_HOME='D:\gradle-home'` for every Gradle command.
  - Set `MSYS_NO_PATHCONV=1` and use Windows-style paths for adb.
  - Run npm for the mobile app only inside `apps/mobile`.
  - Heredocs in the Bash tool collapse `\\` to `\`. Write code with backslashes using the Write/Edit tools.
  - Docker holds `127.0.0.1:8080`, `8090`, `8094–8096`, `8098` and `8099`. Check `netstat -ano | grep LISTEN` before serving. Free ports were 8097, 8110–8114, 3100 and 9100.
  - D: has about 5.8 GB free (2026-10-03).
- **No temp files inside the repo.** Use the session scratchpad. Never delete files you did not create. Do not revert or "clean up" changes you did not make. Also leave the git-ignored `.superpowers/sdd/` alone.
- **Demo POS** `https://posdemo.sandbee.in` runs `main`. Use it only for read-only load checks; never sign in.
- **Known unrelated failure:** `lib/go-live-dl.test.ts` → "PIN: cb-dl2-decisions.md D-C's archive-path clause…" fails with ENOENT on this PC (a local planning file is missing). Leave it and report it. The cafe chain is otherwise green.
- **Language:** talk to the owner in Hinglish. Repo docs and code comments stay in English, and comments say *why*.

---

## Decisions this plan makes (spec deviations, each deliberate)

1. **`printerIds` / `jobIds` on lease, and the `printerId` field and index, wait for Phase 2.** In simple mode a device's line holds only jobs targeted at it, so the call itself is the "lease mine now". Phase 2 adds printers.
2. **The `{status, nextAttemptAt, createdAt, _id}` index is not created.** No Phase 1 query uses it. On M0 every index costs storage and write amplification.
3. **`myRecentJobs` rides the 20 s pulse (Session 1D), not the wake.** Only agents poll wake. Every device already polls the pulse, including the host when it also takes orders. Keeping wake lean saves Active CPU, the tightest limit.
4. **A new log event, `"retried"`** (Print again / Print now), joins the spec §6.5 list.
5. **Confirm "print again" also resets the counters and sets `approvedAt`.** Without that, a bill that waited 40 min for the cashier would be parked as stale, or would hit the uncertain limit on the cashier's own tap.
6. **Past its daily wake cap, an agent stops polling until the next cafe-day.** This is today's behaviour, used instead of spec §9.1's "every 30 s". Leasing then rides realtime nudges and the pulse, which already run. The cap therefore really bounds the cafe's total (17,040/day worst case).
7. **Dismiss covers `queued`, `needs-confirm` and `failed` but never `leased`**, because the writer may be printing right now. A dead writer's lease expires in 90 s, and the job can be dismissed after that.
8. **Simple mode with a host prints everything at the current host.** The sweep retargets any queued job aimed elsewhere: rows from before Phase 1, and jobs from before a re-designation.
9. **The "Notify kitchen" cancel notice stays a client-started print** (`POST /api/print-jobs` + `Idempotency-Key`). Cancel has no notify flag, and the notice is a separate later tap (Session 1B confirms this at its gate).
10. **`--refuse` on the fake printer resets each connection as it opens.** To test "cannot connect", stop the fake printer.

Task 10 writes decisions 1–6 into the spec's §7 as "Phase 1 decisions" so the spec stays the source of truth.

---

## Review Focus

These are the five input classes most likely to bite a cafe in Session 1A's code that unit tests alone would not exercise. Each has a live leg in Task 8.

1. **Two tabs of the host race for the same head** (a reload loses the Web Lock for a moment, or the band's Print button meets the drain): exactly one lease wins. The other tab is told when the lease ends. → leg (q).
2. **The host is killed mid-job** (app swiped away, power cut): after 90 s the KOT is queued again with REPRINT, and the bill waits for the cashier (`needs-confirm`). A "printed" ack that arrives late (the write did finish) still resolves it. → leg (r).
3. **A late "printed" ack after the job was leased again**: it is ignored (but logged). The new attempt carries REPRINT, the job never flips back, and a duplicate ack of a printed job is answered as already printed. → leg (s).
4. **The head of the line is parked** (a bill waiting for the cashier, or a 31-minute-old stale KOT): fresher slips still print. A KOT in backoff after a refusal *does* hold the line, so kitchen order is kept. Print now on the stale one makes it leasable. → leg (t).
5. **The host is re-designated to another device while slips are queued**, or rows from before Phase 1 are still queued: within one sweep (≤ 60 s) every queued job targets the current host and prints there. A job over its limits is failed, never retried forever. → leg (u).

---

## File map (Session 1A)

| File | Change | Responsibility |
|---|---|---|
| `apps/mobile/src/mobile-paths.test.ts` | modify | Task 0: pin 16 also pins the `usbWaitingForeground` resets |
| `apps/cafe/lib/css-compat.test.ts` | modify | Task 0: pin the PostCSS plugin order; only `--border` tints stay solid |
| `docs/superpowers/specs/2026-10-02-printing-reliability-design.md` | modify | Task 0: F0.8 wording. Task 10: Phase 1 decisions |
| `packages/shared/src/print-job.ts` | modify | Phase 1 statuses, unresolved set, `"cashier"` dismiss reason |
| `packages/shared/src/print-lifecycle.ts` | create | constants, labels, log entries, pure transition plans |
| `packages/shared/src/print-lifecycle.test.ts` | create | every §7.2 row, epoch fencing, late acks, backoff, labels, limits |
| `packages/shared/src/print-agent-wire.ts` | create | wire types, headers, shells, agent cadence and shared cap |
| `packages/shared/src/print-budget.ts` | create | §17.2 busy-day assumptions |
| `packages/shared/src/print-budget.test.ts` | create | §17.3 item 4 budget test |
| `packages/shared/src/print-job.test.ts` | modify | the dismiss-reason list gains `"cashier"` |
| `packages/shared/package.json` | modify | add the two new test files |
| `apps/cafe/models/PrintJob.ts` | modify | lifecycle fields, lease and log subschemas, two indexes |
| `apps/cafe/models/PrintDevice.ts` | create | the heartbeat record (spec §6.4) |
| `apps/cafe/lib/print-job-model.test.ts` | modify | new fields, indexes, PrintDevice |
| `apps/cafe/lib/print-lease.ts` | create | the line filter, CAS fence, plan application, lease, ack, jobs-for-me |
| `apps/cafe/lib/print-lease.test.ts` | create | DB-free tests of the pure exports |
| `apps/cafe/lib/print-job-actions.ts` | create | confirm and retry (staff decisions) |
| `apps/cafe/lib/print-device.ts` | create | heartbeat upsert (≤ 1 per 30 s), lease touch, online agent count |
| `apps/cafe/lib/print-sweep.ts` | create | expire, retarget, limits, prune; 60 s throttle |
| `apps/cafe/lib/print-lifecycle-schemas.ts` | create | Zod bodies for wake POST, lease, ack, confirm |
| `apps/cafe/lib/print-lifecycle-paths.test.ts` | create | schema tests and source pins for the new routes and libs |
| `apps/cafe/lib/print-queue.ts` | modify | enqueue gains lifecycle fields, host target, origin, labels and Idempotency-Key; dismiss and prune cover the new statuses |
| `apps/cafe/app/api/print-jobs/route.ts` | modify | optional `Idempotency-Key` and `x-pos-device-id` headers |
| `apps/cafe/app/api/print-jobs/wake/route.ts` | modify | adds POST (heartbeat, jobs for me, agents, sweep); GET unchanged |
| `apps/cafe/app/api/print-jobs/lease/route.ts` | create | POST lease |
| `apps/cafe/app/api/print-jobs/[id]/ack/route.ts` | create | POST ack |
| `apps/cafe/app/api/print-jobs/[id]/confirm/route.ts` | create | POST confirm |
| `apps/cafe/app/api/print-jobs/[id]/retry/route.ts` | create | POST retry |
| `apps/cafe/lib/print-wake.test.ts`, `lib/self-order-alert-paths.test.ts`, `lib/print-queue-fixes.test.ts` | modify | deliberate pin updates (Tasks 4, 5, 7) |
| `apps/cafe/scripts/print-host-live/lifecycle.ts`, `lifecycle-actions.ts` | create | live legs q–x |
| `apps/cafe/scripts/verify-print-host-live.ts` | modify | run legs q–x after n; create PrintDevice indexes |
| `apps/cafe/package.json` | modify | `testChain` gains `lib/print-lease.test.ts` and `lib/print-lifecycle-paths.test.ts` |
| `scripts/fake-escpos-printer.mjs`, `scripts/fake-escpos-printer.test.mjs` | create | the fake LAN printer (spec §13) |
| `package.json` (root) | modify | `test:print-tools` script |
| this plan | modify | Session 1A Results |

---

## Session 1A

**Pre-validated.** On 2026-10-02 the review session ran this session's code on a scratchpad copy of the repo, with every "Create" block and every "Modify" anchor applied verbatim. Each anchor matched exactly once. Results:
- shared: 28/28 new tests, tsc 0;
- cafe: tsc 0, eslint clean on the new files;
- cafe chain: the only existing pins that broke are the two this plan updates (`print-wake`, `print-queue-fixes`);
- live legs: `157 passed, 0 failed` against local mongod;
- fake printer: 7/7;
- mobile pin 16: 37/37.

A failure while executing therefore points to drift since then, or to a typo while copying. Compare with the plan first.

### Task 0: Phase 0 follow-ups (review rulings 1, 6, 7)

**Files:**
- Modify: `apps/mobile/src/mobile-paths.test.ts` (`usbPermissionProblems`, around line 1990; `pin 16 mutation`, around line 2029)
- Modify: `apps/cafe/lib/css-compat.test.ts` (append two tests)
- Modify: `docs/superpowers/specs/2026-10-02-printing-reliability-design.md` (§12 row F0.8)

**Interfaces:** none.

- [ ] **Step 1: Pin the `usbWaitingForeground` resets**

In `apps/mobile/src/mobile-paths.test.ts`, inside `usbPermissionProblems`, add this directly before `return out;`:

```ts
  // begin() and halt() both clear the flag (a bare-assignment line; the field's own declaration
  // starts with "private var", so it never matches).
  if ((manager.match(/^\s+usbWaitingForeground = false$/gm) ?? []).length < 2) {
    out.push('begin() and halt() must both clear usbWaitingForeground');
  }
```

In `test('pin 16 mutation: …')`, add these two rows to the `run('manager')` table:

```ts
    ['usbWaitingForeground = false\n          ++generation', '++generation'],
    ['usbWaitingForeground = false\n      generation++', 'generation++'],
```

- [ ] **Step 2: Run the mobile pins**

Run: `cd /d/kd/lucifer/apps/mobile && node --import tsx --test src/mobile-paths.test.ts`
Expected: all pass, including `pin 16` and `pin 16 mutation`. The new mutations are caught, because removing either reset leaves one assignment line.

- [ ] **Step 3: Pin the PostCSS order and the solid-tint allow-list**

Append to `apps/cafe/lib/css-compat.test.ts`:

```ts
test("old-WebView tints: postcss.config.mjs runs the tint step last, after Tailwind and both colour fallbacks", () => {
  const config = readFileSync(path.resolve(__dirname, "../postcss.config.mjs"), "utf8");
  const order = [
    '"@tailwindcss/postcss"',
    '"@csstools/postcss-color-mix-function"',
    '"@csstools/postcss-oklab-function"',
    '"./postcss-tint-fallback.cjs"',
  ].map((key) => config.indexOf(key));
  assert.ok(order.every((index) => index >= 0), "every plugin of the production pipeline is configured");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "the plugins run in exactly this order");
});

test("old-WebView tints: every tint's old-engine fallback carries alpha, except the allow-listed --border", async () => {
  const root = await compileCss();
  const solid: string[] = [];
  let checked = 0;
  root.walkAtRules("supports", (supports) => {
    if (!/color-mix\(in lab/.test(supports.params)) return;
    supports.walkDecls((modern) => {
      const m = MIX.exec(modern.value);
      if (!m) return;
      checked++;
      const value = tintFallback.findFallback(supports, modern)?.value ?? "";
      // Ours (rgb(var(--x-rgb) / N%)) or Tailwind's own alpha hex for a palette colour (#000c, #00a54466).
      const tinted = value === `rgb(var(${m[1]}-rgb) / ${m[2]}%)` || /^#(?:[\da-f]{4}|[\da-f]{8})$/i.test(value);
      if (!tinted) solid.push(`${m[1]}: ${value || "no fallback"}`);
    });
  });
  assert.ok(checked > 50, `the POS uses dozens of tints; only ${checked} were checked`);
  // Dark --border has its own alpha, so it is never twinned (postcss-tint-fallback.cjs) and its tints stay solid.
  assert.deepEqual(solid, ["--border: var(--border)"]);
});
```

- [ ] **Step 4: Run the CSS tests**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/css-compat.test.ts`
Expected: 7 pass. The review session measured 63 tints. Only `--border` is solid; `--color-black`, `--color-green-600` and `--color-amber-950` already fall back to alpha hex.

- [ ] **Step 5: Fix the F0.8 wording in the spec**

In spec §12, replace the whole F0.8 row with:

```markdown
| F0.8 | Medium (UI) | `postcss.config.mjs`, `postcss-tint-fallback.cjs`, `lib/css-compat.test.ts`, `packages/shared/src/appearance*.ts` | Done in Phase 0. A PostCSS step rewrites Tailwind's solid fallback for each tint to `rgb(var(--x-rgb) / N%)`, with per-theme channel twins (`--x-rgb`). Runtime theme tokens (diner menu, appearance preview) carry their own twins. Tests cover the tints, both themes, the plugin order, and the one allow-listed solid token (`--border`). Verified on the emulator's WebView 109. |
```

- [ ] **Step 6: Commit**

```bash
cd /d/kd/lucifer
git add apps/mobile/src/mobile-paths.test.ts apps/cafe/lib/css-compat.test.ts docs/superpowers/specs/2026-10-02-printing-reliability-design.md
git commit -m "test(print): pin the USB flag resets, the PostCSS order and the one solid tint; record F0.8 as built"
```

---

### Task 1: The shared lifecycle state machine

**Files:**
- Modify: `packages/shared/src/print-job.ts:15-42` (statuses, dismiss reasons)
- Create: `packages/shared/src/print-lifecycle.ts`
- Create: `packages/shared/src/print-lifecycle.test.ts`
- Modify: `packages/shared/src/print-job.test.ts:62-70` (the dismiss-reason pin)
- Modify: `packages/shared/package.json` (`test` script)

**Interfaces:**
- Produces, from `@pos/shared/print-job`:
  - `PRINT_JOB_STATUSES = ["queued","leased","printed","needs-confirm","failed","dismissed"]`
  - `PRINT_JOB_UNRESOLVED_STATUSES = ["queued","leased","needs-confirm","failed"]`
  - `PRINT_JOB_DISMISS_REASONS` gains `"cashier"`
- Produces, from `@pos/shared/print-lifecycle`:
  - Constants: `PRINT_LEASE_MS`, `PRINT_BACKOFF_MS`, `PRINT_MAX_UNCERTAIN_ATTEMPTS`, `PRINT_MAX_ATTEMPTS`, `PRINT_KOT_ALARM_MS`, `PRINT_DEVICE_ONLINE_MS`, `PRINT_DEVICE_HEARTBEAT_WRITE_MS`, `PRINT_SWEEP_MIN_INTERVAL_MS`, `PRINT_ACK_RETRY_MS`, `PRINT_ACK_PENDING_MAX_MS`, `PRINT_MY_RECENT_WINDOW_MS`, `PRINT_JOB_LOG_MAX`, `PRINT_ACK_ERROR_MAX_CHARS`, `PRINT_JOB_LABELS`, `PRINT_JOB_LOG_EVENTS`
  - Types: `PrintJobLabel`, `PrintJobLogEvent`, `PrintJobLogEntry`, `PrintJobLease`, `PrintJobLifecycle`, `PrintJobLifecycleDoc`, `PrintJobSet`, `PrintJobUnsetPath`, `PrintJobPatch`, `PrintJobRefusal`, `PrintJobPlan`, `PrintJobAck`, `PrintJobDecision`
  - Helpers:
    - `lifecycleOf(doc: PrintJobLifecycleDoc): PrintJobLifecycle`
    - `printJobLifecycleInit(nowMs, labels?)`
    - `printJobCreatedLog(nowMs, deviceId?)`
    - `printBackoffMs(attempts)`
    - `addPrintLabel(labels, label)`
    - `printBannerText(labels)`
    - `printRepeatLabel(kind)`
    - `printJobInitialLabels(payload)`
    - `printJobOverLimits(attempts, uncertain)`
    - `printJobStale(job, nowMs)`
  - Plans:
    - `planLease(job, {deviceId, tabId}, nowMs)`
    - `planExpiry(job, nowMs)`
    - `planAck(job, ack, nowMs)`
    - `planConfirm(job, decision, staff, nowMs)`
    - `planRetry(job, nowMs)`
    - `planLimits(job, nowMs)`
    - Each returns a `PrintJobPlan`.

- [ ] **Step 1: Widen the shared status and reason lists**

In `packages/shared/src/print-job.ts`, replace:

```ts
/** `"printed"` means claim won / host accepted — NOT proof paper exists (§B2).
 *  `"dismissed"` covers staff dismiss, a cancelled order/round, and the
 *  host-cleared bulk dismiss. */
export const PRINT_JOB_STATUSES = ["queued", "printed", "dismissed"] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];
```

with:

```ts
/** Phase 1 lifecycle (docs/superpowers/specs/2026-10-02-printing-reliability-design.md §7.1).
 *  `"printed"` on a row with `printedAt` means its writer ACKNOWLEDGED the write; on an older row
 *  without `printedAt` it still means only "claim won" (the legacy /claim path, kept one release).
 *  `"leased"`: one device is writing it now. `"needs-confirm"`: a bill that may already be on
 *  paper, waiting for the cashier. `"failed"`: retries stopped, staff decide.
 *  `"dismissed"` covers staff dismiss, a cancelled order/round, the host-cleared bulk dismiss and
 *  the cashier's "dismiss". */
export const PRINT_JOB_STATUSES = ["queued", "leased", "printed", "needs-confirm", "failed", "dismissed"] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

/** Statuses that still need a writer or a decision; retention prunes them after 12 h. */
export const PRINT_JOB_UNRESOLVED_STATUSES = ["queued", "leased", "needs-confirm", "failed"] as const;
```

In the same file, change `PRINT_JOB_DISMISS_REASONS` to:

```ts
export const PRINT_JOB_DISMISS_REASONS = [
  "order-cancelled",
  "round-voided",
  "staff",
  "host-cleared",
  "invalid-payload",
  // Phase 1: the cashier dismissed a bill that was waiting for a "print again?" decision.
  "cashier",
] as const;
```

In `packages/shared/src/print-job.test.ts`, the test `PRINT_JOB_DISMISS_REASONS pins five §B1 values …` deep-equals the list. Rename it to `PRINT_JOB_DISMISS_REASONS pins six values (four §B1, the PH-3 claim-path invalid-payload, and the Phase 1 cashier dismiss) verbatim …`. Append `"cashier"` to its expected array.

- [ ] **Step 2: Write the failing lifecycle tests**

Create `packages/shared/src/print-lifecycle.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINT_HOST_MAX_AGE_MS, PRINT_JOB_KINDS } from "./print-job";
import {
  PRINT_BACKOFF_MS,
  PRINT_LEASE_MS,
  PRINT_MAX_ATTEMPTS,
  addPrintLabel,
  lifecycleOf,
  planAck,
  planConfirm,
  planExpiry,
  planLease,
  planLimits,
  planRetry,
  printBackoffMs,
  printBannerText,
  printJobInitialLabels,
  printJobLifecycleInit,
  printJobStale,
  type PrintJobLifecycle,
  type PrintJobLogEntry,
  type PrintJobPatch,
  type PrintJobPlan,
} from "./print-lifecycle";
import type { PrintJobPayload } from "./schemas/print-job.schema";

// Spec §7.2, row by row. T0 is "now"; every job below was created at T0 unless it says otherwise.
const T0 = Date.parse("2026-10-02T12:00:00.000Z");
const WHO = { deviceId: "dev-a", tabId: "tab-1" };

function job(over: Partial<PrintJobLifecycle> = {}): PrintJobLifecycle {
  return {
    kind: "kot",
    status: "queued",
    epoch: 0,
    attempts: 0,
    uncertainAttempts: 0,
    nextAttemptAt: new Date(T0),
    labels: [],
    createdAt: new Date(T0),
    ...over,
  };
}
function leased(over: Partial<PrintJobLifecycle> = {}): PrintJobLifecycle {
  return job({
    status: "leased",
    epoch: 1,
    attempts: 1,
    lease: { deviceId: "dev-a", tabId: "tab-1", epoch: 1, expiresAt: new Date(T0 + PRINT_LEASE_MS) },
    ...over,
  });
}
function patchOf(plan: PrintJobPlan): PrintJobPatch {
  if (!plan.ok) throw new assert.AssertionError({ message: `expected a plan, got the refusal "${plan.reason}"` });
  return plan.patch;
}
function refusalOf(plan: PrintJobPlan): { reason: string; log?: PrintJobLogEntry } {
  if (plan.ok) throw new assert.AssertionError({ message: `expected a refusal, got status "${plan.patch.status}"` });
  return plan;
}

test("create: a new job starts queued with zero counters, due now, epoch 0", () => {
  assert.deepEqual(printJobLifecycleInit(T0), { epoch: 0, attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(T0), labels: [] });
  assert.deepEqual(printJobLifecycleInit(T0, ["DUPLICATE"]).labels, ["DUPLICATE"]);
});

test("lease: a due queued job is leased for 90 s; epoch and attempts both step up", () => {
  const patch = patchOf(planLease(job({ epoch: 4, attempts: 2 }), WHO, T0));
  assert.equal(patch.status, "leased");
  assert.deepEqual(patch.set, {
    status: "leased",
    epoch: 5,
    attempts: 3,
    lease: { deviceId: "dev-a", tabId: "tab-1", epoch: 5, expiresAt: new Date(T0 + PRINT_LEASE_MS) },
  });
  assert.deepEqual(patch.unset, []);
  assert.equal(patch.log.event, "leased");
  assert.equal(patch.log.deviceId, "dev-a");
});

test("lease: refused while in backoff, when stale, when over limits, and for every other status", () => {
  assert.equal(refusalOf(planLease(job({ nextAttemptAt: new Date(T0 + 1) }), WHO, T0)).reason, "not-due");
  const old = job({ createdAt: new Date(T0 - PRINT_HOST_MAX_AGE_MS - 1) });
  assert.equal(refusalOf(planLease(old, WHO, T0)).reason, "stale");
  assert.equal(refusalOf(planLease(job({ attempts: PRINT_MAX_ATTEMPTS }), WHO, T0)).reason, "over-limits");
  for (const status of ["leased", "printed", "needs-confirm", "failed", "dismissed"] as const) {
    assert.equal(refusalOf(planLease(job({ status }), WHO, T0)).reason, "wrong-status", status);
  }
});

test("lease: exactly 30 minutes old is still leasable; a stale job staff approved is leasable", () => {
  assert.ok(planLease(job({ createdAt: new Date(T0 - PRINT_HOST_MAX_AGE_MS) }), WHO, T0).ok, "the boundary is still fresh");
  const approved = job({ createdAt: new Date(T0 - 2 * PRINT_HOST_MAX_AGE_MS), approvedAt: new Date(T0 - 1) });
  assert.ok(planLease(approved, WHO, T0).ok);
  assert.equal(printJobStale(approved, T0), false);
});

test("expiry: a KOT, notice or EOD whose lease ran out is queued again with REPRINT (it may have printed)", () => {
  const after = T0 + PRINT_LEASE_MS + 1;
  for (const kind of PRINT_JOB_KINDS.filter((k) => k !== "bill")) {
    const patch = patchOf(planExpiry(leased({ kind }), after));
    assert.equal(patch.status, "queued", kind);
    assert.deepEqual(patch.set.labels, ["REPRINT"], kind);
    assert.equal(patch.set.uncertainAttempts, 1, kind);
    assert.deepEqual(patch.set.nextAttemptAt, new Date(after + printBackoffMs(1)), kind);
    assert.deepEqual(patch.unset, ["lease"], kind);
    assert.equal(patch.log.event, "expired");
    assert.equal(patch.log.deviceId, "dev-a", "the log names the writer that went quiet");
  }
});

test("expiry: a bill whose lease ran out waits for the cashier (needs-confirm), never reprinted by itself", () => {
  const patch = patchOf(planExpiry(leased({ kind: "bill" }), T0 + PRINT_LEASE_MS + 1));
  assert.equal(patch.status, "needs-confirm");
  assert.equal(patch.set.labels, undefined, "DUPLICATE is added only when the cashier says print again");
  assert.equal(patch.set.uncertainAttempts, 1);
});

test("expiry: a live lease is held; only a leased job can expire", () => {
  assert.equal(refusalOf(planExpiry(leased(), T0 + PRINT_LEASE_MS)).reason, "lease-held", "expiresAt itself is still held");
  assert.equal(refusalOf(planExpiry(job(), T0 + PRINT_LEASE_MS + 1)).reason, "wrong-status");
});

test("ack printed with the lease's epoch: printed, stamped with the writer, lease and error cleared", () => {
  const patch = patchOf(planAck(leased(), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0 + 5_000));
  assert.equal(patch.status, "printed");
  assert.deepEqual(patch.set, { status: "printed", printedAt: new Date(T0 + 5_000), printedBy: "dev-a" });
  assert.deepEqual(patch.unset, ["lease", "lastError"]);
  assert.equal(patch.log.event, "printed");
});

test("ack failed, nothing sent: queued again after the backoff, no label, no uncertain attempt", () => {
  const patch = patchOf(planAck(leased({ attempts: 3 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no", error: "NOT_CONNECTED" }, T0));
  assert.equal(patch.status, "queued");
  assert.deepEqual(patch.set.nextAttemptAt, new Date(T0 + 10_000), "the third attempt waits 10 s");
  assert.equal(patch.set.labels, undefined);
  assert.equal(patch.set.uncertainAttempts, undefined);
  assert.equal(patch.set.lastError, "NOT_CONNECTED");
});

test("backoff after a refusal: 2 s, 5 s, 10 s, then every 30 s", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(printBackoffMs), [2_000, 5_000, 10_000, 30_000, 30_000, 30_000]);
  assert.equal(printBackoffMs(0), PRINT_BACKOFF_MS[0], "a job never leased waits the shortest step");
});

test("ack failed, maybe sent: a KOT is queued again with REPRINT; a bill waits for the cashier", () => {
  const kot = patchOf(planAck(leased(), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(kot.status, "queued");
  assert.deepEqual(kot.set.labels, ["REPRINT"]);
  assert.equal(kot.set.uncertainAttempts, 1);
  assert.equal(kot.set.lastError, "may have printed", "a failure with no text still says why");
  const bill = patchOf(planAck(leased({ kind: "bill" }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(bill.status, "needs-confirm");
});

test("ack failed with a permanent error: failed at once, no retry", () => {
  const patch = patchOf(planAck(leased(), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no", permanent: true, error: "TOO_LARGE" }, T0));
  assert.equal(patch.status, "failed");
  assert.equal(patch.set.lastError, "TOO_LARGE");
  assert.equal(patch.set.uncertainAttempts, 0, "nothing was sent, so no uncertain attempt");
  const maybe = patchOf(planAck(leased(), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe", permanent: true }, T0));
  assert.equal(maybe.set.uncertainAttempts, 1, "a permanent error after a byte left still counts as maybe printed");
});

test("limits: the third uncertain attempt or the eighth lease ends in failed, never another retry", () => {
  const third = patchOf(planAck(leased({ uncertainAttempts: 2 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(third.status, "failed");
  const eighth = patchOf(planAck(leased({ attempts: PRINT_MAX_ATTEMPTS }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no" }, T0));
  assert.equal(eighth.status, "failed");
  const swept = patchOf(planLimits(job({ uncertainAttempts: 3 }), T0));
  assert.equal(swept.status, "failed");
  assert.equal(refusalOf(planLimits(job({ uncertainAttempts: 2, attempts: 7 }), T0)).reason, "wrong-status");
  assert.equal(refusalOf(planLimits(leased({ uncertainAttempts: 3 }), T0)).reason, "wrong-status", "only a queued job is failed by the sweep");
});

test("late ack (spec §7.9): a printed ack for the epoch that expired still resolves the job", () => {
  for (const status of ["queued", "needs-confirm", "failed"] as const) {
    const patch = patchOf(planAck(job({ status, epoch: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0));
    assert.equal(patch.status, "printed", status);
    assert.equal(patch.log.event, "late-ack", status);
  }
});

test("stale epoch: an ack from an attempt that was leased again is logged and otherwise ignored", () => {
  const releasedAgain = refusalOf(planAck(leased({ epoch: 2 }), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0));
  assert.equal(releasedAgain.reason, "stale-epoch");
  assert.equal(releasedAgain.log?.event, "late-ack");
  assert.match(releasedAgain.log?.detail ?? "", /ignored/);
  const expiredAgain = refusalOf(planAck(job({ epoch: 2 }), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0));
  assert.equal(expiredAgain.reason, "stale-epoch", "leased again and expired again: still not this attempt's job");
  const oldFailure = refusalOf(planAck(leased({ epoch: 2 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(oldFailure.reason, "stale-epoch");
  assert.equal(oldFailure.log, undefined, "a stale failure report changes nothing and is not worth a write");
});

test("idempotent acks: a repeated printed ack of a printed job is 'resolved'; a failed ack outside its lease is 'not-leased'", () => {
  assert.equal(refusalOf(planAck(job({ status: "printed", epoch: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0)).reason, "resolved");
  assert.equal(refusalOf(planAck(job({ status: "dismissed", epoch: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "printed" }, T0)).reason, "resolved");
  assert.equal(refusalOf(planAck(job({ epoch: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no" }, T0)).reason, "not-leased");
});

test("needs-confirm, print again: queued with DUPLICATE, counters reset, approved now (never parked as stale)", () => {
  const waiting = job({ kind: "bill", status: "needs-confirm", epoch: 1, attempts: 1, uncertainAttempts: 1, createdAt: new Date(T0 - 2 * PRINT_HOST_MAX_AGE_MS) });
  const patch = patchOf(planConfirm(waiting, "reprint", "Asha", T0));
  assert.equal(patch.status, "queued");
  assert.deepEqual(patch.set, { status: "queued", labels: ["DUPLICATE"], attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(T0), approvedAt: new Date(T0) });
  assert.equal(patch.log.event, "confirmed");
  assert.ok(planLease(lifecycleOf({ ...waiting, ...patch.set }), WHO, T0).ok, "the cashier's reprint is leasable at once");
});

test("needs-confirm, it printed / dismiss: printed by the cashier, or dismissed as 'cashier'", () => {
  const waiting = job({ kind: "bill", status: "needs-confirm", epoch: 1 });
  const said = patchOf(planConfirm(waiting, "printed", "Asha", T0));
  assert.deepEqual(said.set, { status: "printed", printedAt: new Date(T0), printedBy: "Asha" });
  const dropped = patchOf(planConfirm(waiting, "dismiss", "Asha", T0));
  assert.deepEqual(dropped.set, { status: "dismissed", dismissedAt: new Date(T0), dismissReason: "cashier", dismissedBy: "Asha" });
  assert.equal(dropped.log.event, "dismissed");
  assert.equal(refusalOf(planConfirm(job(), "printed", "Asha", T0)).reason, "wrong-status", "only a job waiting for a decision takes one");
});

test("failed, print again: labelled when it may have printed, counters reset, approved now", () => {
  const kot = patchOf(planRetry(job({ status: "failed", attempts: 8, uncertainAttempts: 1 }), T0));
  assert.deepEqual(kot.set, { status: "queued", labels: ["REPRINT"], attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(T0), approvedAt: new Date(T0) });
  assert.deepEqual(kot.unset, ["lastError"]);
  const bill = patchOf(planRetry(job({ kind: "bill", status: "failed", uncertainAttempts: 2 }), T0));
  assert.deepEqual(bill.set.labels, ["DUPLICATE"]);
  const never = patchOf(planRetry(job({ status: "failed", attempts: 8 }), T0));
  assert.deepEqual(never.set.labels, [], "nothing ever reached paper: no label");
  assert.equal(kot.log.event, "retried");
});

test("stale, print now: a 30-minute-old queued job becomes leasable; a fresh one needs no tap", () => {
  const old = job({ createdAt: new Date(T0 - PRINT_HOST_MAX_AGE_MS - 1) });
  const patch = patchOf(planRetry(old, T0));
  assert.deepEqual(patch.set, { approvedAt: new Date(T0), nextAttemptAt: new Date(T0) });
  assert.equal(patch.status, "queued");
  assert.ok(planLease(lifecycleOf({ ...old, ...patch.set }), WHO, T0).ok);
  assert.equal(refusalOf(planRetry(job(), T0)).reason, "wrong-status");
});

test("labels: only ever added, kept in banner order, and printed as one banner", () => {
  assert.deepEqual(addPrintLabel(["REPRINT"], "BACKUP PRINTER"), ["BACKUP PRINTER", "REPRINT"]);
  assert.deepEqual(addPrintLabel(["REPRINT"], "REPRINT"), ["REPRINT"], "no duplicate label");
  assert.equal(printBannerText(["REPRINT", "BACKUP PRINTER"]), "BACKUP PRINTER · REPRINT");
  assert.equal(printBannerText([]), "");
});

test("a client-started repeat carries its label from the start (spec §7.7)", () => {
  const snapshot = {} as never;
  const cases: Array<[PrintJobPayload, string[]]> = [
    [{ kind: "kot", snapshot, round: null }, ["REPRINT"]],
    [{ kind: "kot", snapshot, round: 2 }, []],
    [{ kind: "bill", snapshot, reprint: true }, ["DUPLICATE"]],
    [{ kind: "bill", snapshot }, []],
    [{ kind: "eod", dateKey: "2026-10-02", dateLabel: "2 Oct" }, []],
  ];
  for (const [payload, labels] of cases) assert.deepEqual(printJobInitialLabels(payload), labels, JSON.stringify(payload).slice(0, 40));
});

test("lifecycleOf: a row from before Phase 1 reads as a fresh job due since it was created", () => {
  const legacy = lifecycleOf({ kind: "kot", status: "queued", createdAt: new Date(T0 - 1_000), labels: ["REPRINT", "BOGUS"] });
  assert.equal(legacy.epoch, 0);
  assert.equal(legacy.attempts, 0);
  assert.equal(legacy.uncertainAttempts, 0);
  assert.deepEqual(legacy.nextAttemptAt, new Date(T0 - 1_000));
  assert.deepEqual(legacy.labels, ["REPRINT"], "an unknown label is dropped, never printed");
  assert.ok(planLease(legacy, WHO, T0).ok);
});
```

Add `src/print-lifecycle.test.ts` to the end of the `test` script in `packages/shared/package.json`, after `src/print-host-printer.test.ts`.

- [ ] **Step 3: Run the tests and see them fail**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-lifecycle.test.ts`
Expected: FAIL with `Cannot find module './print-lifecycle'`.

- [ ] **Step 4: Implement the state machine**

Create `packages/shared/src/print-lifecycle.ts`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Printing redesign, Phase 1 (docs/superpowers/specs/2026-10-02-printing-
// reliability-design.md §7): the print-job lifecycle. A job counts as printed
// only when the device that wrote it acknowledges the write. Each transition is
// a PURE plan here, unit-tested row by row against spec §7.2; the server applies
// a plan with ONE compare-and-set on {_id, status, epoch} (apps/cafe/lib/
// print-lease.ts), so a racing writer makes the CAS miss instead of causing a
// second transition. Pure and client-safe: no Node, DB or zod imports.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PRINT_HOST_MAX_AGE_MS,
  type PrintJobDismissReason,
  type PrintJobKind,
  type PrintJobStatus,
} from "./print-job";
import type { PrintJobPayload } from "./schemas/print-job.schema";

/** A lease covers rendering (the 12 s raster deadline) plus the device write deadline (70 s). */
export const PRINT_LEASE_MS = 90_000;
/** The wait after a refusal made before any byte was sent: 2 s, 5 s, 10 s, then every 30 s. */
export const PRINT_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000] as const;
/** Retries stop once a job may have printed this many times, or was leased this many times (§7.8). */
export const PRINT_MAX_UNCERTAIN_ATTEMPTS = 3;
export const PRINT_MAX_ATTEMPTS = 8;
/** A KOT still not printed this long after it was created sounds the alarm (§10). */
export const PRINT_KOT_ALARM_MS = 20_000;
/** A device whose last heartbeat is older than this is offline (§6.4). */
export const PRINT_DEVICE_ONLINE_MS = 90_000;
/** The heartbeat writes a device's PrintDevice row at most this often (the Atlas M0 write budget, §10). */
export const PRINT_DEVICE_HEARTBEAT_WRITE_MS = 30_000;
/** The sweep runs at most this often per server instance, riding requests that already exist (§17.3: never Vercel Cron). */
export const PRINT_SWEEP_MIN_INTERVAL_MS = 60_000;
/** An agent retries an unanswered "printed" ack this often, for at most PRINT_ACK_PENDING_MAX_MS (§7.9). */
export const PRINT_ACK_RETRY_MS = 5_000;
export const PRINT_ACK_PENDING_MAX_MS = 10 * 60 * 1000;
/** The window of its own jobs an ordering device's readback follows (§7.3 myRecentJobs). */
export const PRINT_MY_RECENT_WINDOW_MS = 15 * 60 * 1000;
/** PrintJob.log keeps only the newest entries (M0 storage). */
export const PRINT_JOB_LOG_MAX = 20;
/** An agent's failure text, stored for staff, is cut to this. */
export const PRINT_ACK_ERROR_MAX_CHARS = 200;

/** Banner labels in print order ("BACKUP PRINTER · REPRINT", §7.7). Labels are only ever added. */
export const PRINT_JOB_LABELS = ["BACKUP PRINTER", "REPRINT", "DUPLICATE"] as const;
export type PrintJobLabel = (typeof PRINT_JOB_LABELS)[number];

/** PrintJob.log events: spec §6.5, plus "retried" for Print again / Print now. */
export const PRINT_JOB_LOG_EVENTS = [
  "created",
  "leased",
  "printed",
  "failed",
  "expired",
  "retargeted",
  "confirmed",
  "dismissed",
  "late-ack",
  "retried",
] as const;
export type PrintJobLogEvent = (typeof PRINT_JOB_LOG_EVENTS)[number];

export interface PrintJobLogEntry {
  at: Date;
  event: PrintJobLogEvent;
  deviceId?: string;
  detail?: string;
}

export interface PrintJobLease {
  deviceId: string;
  tabId: string;
  epoch: number;
  expiresAt: Date;
}

/** A job's lifecycle fields, normalised by lifecycleOf. */
export interface PrintJobLifecycle {
  kind: PrintJobKind;
  status: PrintJobStatus;
  epoch: number;
  attempts: number;
  uncertainAttempts: number;
  nextAttemptAt: Date;
  labels: PrintJobLabel[];
  createdAt: Date;
  approvedAt?: Date;
  lease?: PrintJobLease;
}

/** What a lean PrintJob read returns. A row written before Phase 1 has no counters at all. */
export interface PrintJobLifecycleDoc {
  kind: PrintJobKind;
  status: PrintJobStatus;
  createdAt: Date;
  epoch?: number;
  attempts?: number;
  uncertainAttempts?: number;
  nextAttemptAt?: Date;
  labels?: string[];
  approvedAt?: Date;
  lease?: PrintJobLease;
}

/** The fields a transition may $set. */
export interface PrintJobSet {
  status?: PrintJobStatus;
  epoch?: number;
  attempts?: number;
  uncertainAttempts?: number;
  nextAttemptAt?: Date;
  labels?: PrintJobLabel[];
  lease?: PrintJobLease;
  approvedAt?: Date;
  printedAt?: Date;
  printedBy?: string;
  lastError?: string;
  dismissedAt?: Date;
  dismissReason?: PrintJobDismissReason;
  dismissedBy?: string;
}
export type PrintJobUnsetPath = "lease" | "lastError";

/** One transition: what it writes, its one log entry, and the status it ends in. */
export interface PrintJobPatch {
  status: PrintJobStatus;
  set: PrintJobSet;
  unset: PrintJobUnsetPath[];
  log: PrintJobLogEntry;
}

/** Why a transition was refused. Every refusal is a normal outcome, never an error. */
export type PrintJobRefusal =
  | "wrong-status"
  | "stale"
  | "not-due"
  | "over-limits"
  | "lease-held"
  | "not-leased"
  | "stale-epoch"
  | "resolved";
export type PrintJobPlan =
  | { ok: true; patch: PrintJobPatch }
  | { ok: false; reason: PrintJobRefusal; log?: PrintJobLogEntry };

/** An agent's report on one leased attempt (POST /api/print-jobs/[id]/ack, §7.3). */
export interface PrintJobAck {
  deviceId: string;
  epoch: number;
  outcome: "printed" | "failed";
  /** "no" only when the writer KNOWS no byte reached the printer (§7.5); anything else is "maybe". */
  sent?: "no" | "maybe";
  /** BAD_REQUEST, TOO_LARGE, a payload that cannot render: retrying cannot help. */
  permanent?: boolean;
  error?: string;
}

/** The cashier's answer to "Print the bill again?" (§7.2 needs-confirm). */
export type PrintJobDecision = "reprint" | "printed" | "dismiss";

function isPrintJobLabel(value: string): value is PrintJobLabel {
  return (PRINT_JOB_LABELS as readonly string[]).includes(value);
}

function logEntry(nowMs: number, event: PrintJobLogEvent, deviceId?: string, detail?: string): PrintJobLogEntry {
  return {
    at: new Date(nowMs),
    event,
    ...(deviceId !== undefined && deviceId !== "" ? { deviceId } : {}),
    ...(detail !== undefined && detail !== "" ? { detail } : {}),
  };
}

function planned(patch: PrintJobPatch): PrintJobPlan {
  return { ok: true, patch };
}

/** Normalises a lean read: a missing counter is 0, a legacy row is due from when it was created,
 *  and an unknown label is dropped (it would otherwise print on paper). */
export function lifecycleOf(doc: PrintJobLifecycleDoc): PrintJobLifecycle {
  return {
    kind: doc.kind,
    status: doc.status,
    epoch: doc.epoch ?? 0,
    attempts: doc.attempts ?? 0,
    uncertainAttempts: doc.uncertainAttempts ?? 0,
    nextAttemptAt: doc.nextAttemptAt ?? doc.createdAt,
    labels: (doc.labels ?? []).filter(isPrintJobLabel),
    createdAt: doc.createdAt,
    ...(doc.approvedAt !== undefined ? { approvedAt: doc.approvedAt } : {}),
    ...(doc.lease !== undefined ? { lease: doc.lease } : {}),
  };
}

/** The lifecycle fields a new job starts with (§7.2 "create"). */
export function printJobLifecycleInit(
  nowMs: number,
  labels: readonly PrintJobLabel[] = [],
): { epoch: number; attempts: number; uncertainAttempts: number; nextAttemptAt: Date; labels: PrintJobLabel[] } {
  return { epoch: 0, attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(nowMs), labels: [...labels] };
}

export function printJobCreatedLog(nowMs: number, deviceId?: string): PrintJobLogEntry {
  return logEntry(nowMs, "created", deviceId);
}

/** The wait after the attempts-th lease was refused before writing (§7.2 backoff). */
export function printBackoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts - 1, 0), PRINT_BACKOFF_MS.length - 1);
  return PRINT_BACKOFF_MS[index];
}

export function addPrintLabel(labels: readonly PrintJobLabel[], label: PrintJobLabel): PrintJobLabel[] {
  return PRINT_JOB_LABELS.filter((known) => known === label || labels.includes(known));
}

/** The one inverted banner a slip prints at its top (§7.7), "" for none. */
export function printBannerText(labels: readonly string[]): string {
  return PRINT_JOB_LABELS.filter((known) => labels.includes(known)).join(" · ");
}

/** A repeat of a bill says DUPLICATE; a repeat of anything else says REPRINT (§7.7). */
export function printRepeatLabel(kind: PrintJobKind): PrintJobLabel {
  return kind === "bill" ? "DUPLICATE" : "REPRINT";
}

/** A client-started print that repeats paper carries its label from the start (§7.7): a whole-tab
 *  KOT reprint (round null), and every reprint:true bill, void or moved slip. */
export function printJobInitialLabels(payload: PrintJobPayload): PrintJobLabel[] {
  switch (payload.kind) {
    case "kot":
      return payload.round === null ? ["REPRINT"] : [];
    case "bill":
      return payload.reprint === true ? ["DUPLICATE"] : [];
    case "void":
    case "moved":
      return payload.reprint === true ? ["REPRINT"] : [];
    case "eod":
    case "cancel-notice":
      return [];
  }
}

export function printJobOverLimits(attempts: number, uncertainAttempts: number): boolean {
  return uncertainAttempts >= PRINT_MAX_UNCERTAIN_ATTEMPTS || attempts >= PRINT_MAX_ATTEMPTS;
}

/** Stale is derived, never stored (§7.2): a queued job over 30 minutes old that staff never
 *  approved. Exactly 30 minutes is still fresh (the D1/D2 boundary rule). */
export function printJobStale(job: Pick<PrintJobLifecycle, "status" | "createdAt" | "approvedAt">, nowMs: number): boolean {
  return job.status === "queued" && job.approvedAt === undefined && nowMs - job.createdAt.getTime() > PRINT_HOST_MAX_AGE_MS;
}

function failed(nowMs: number, set: PrintJobSet, deviceId: string | undefined, detail: string): PrintJobPatch {
  return { status: "failed", set: { status: "failed", ...set }, unset: ["lease"], log: logEntry(nowMs, "failed", deviceId, detail) };
}

/** An attempt that may have reached paper (a "maybe" failure, or an expired lease). */
function afterUncertain(
  job: PrintJobLifecycle,
  nowMs: number,
  event: "failed" | "expired",
  deviceId: string | undefined,
  detail: string,
): PrintJobPatch {
  const uncertainAttempts = job.uncertainAttempts + 1;
  if (printJobOverLimits(job.attempts, uncertainAttempts)) {
    return failed(nowMs, { uncertainAttempts, lastError: detail }, deviceId, `limits: ${detail}`);
  }
  const log = logEntry(nowMs, event, deviceId, detail);
  if (job.kind === "bill") {
    // A bill that may already be on paper is never reprinted by itself: the cashier decides (D3).
    return { status: "needs-confirm", set: { status: "needs-confirm", uncertainAttempts, lastError: detail }, unset: ["lease"], log };
  }
  return {
    status: "queued",
    set: {
      status: "queued",
      uncertainAttempts,
      labels: addPrintLabel(job.labels, "REPRINT"),
      nextAttemptAt: new Date(nowMs + printBackoffMs(job.attempts)),
      lastError: detail,
    },
    unset: ["lease"],
    log,
  };
}

function printedPatch(nowMs: number, by: string, event: "printed" | "late-ack" | "confirmed", detail?: string): PrintJobPatch {
  return {
    status: "printed",
    set: { status: "printed", printedAt: new Date(nowMs), printedBy: by },
    unset: ["lease", "lastError"],
    log: logEntry(nowMs, event, event === "confirmed" ? undefined : by, detail),
  };
}

/** queued → leased (§7.2). The caller has already put this job at the head of its line (§7.6). */
export function planLease(job: PrintJobLifecycle, who: { deviceId: string; tabId: string }, nowMs: number): PrintJobPlan {
  if (job.status !== "queued") return { ok: false, reason: "wrong-status" };
  if (printJobStale(job, nowMs)) return { ok: false, reason: "stale" };
  if (printJobOverLimits(job.attempts, job.uncertainAttempts)) return { ok: false, reason: "over-limits" };
  if (job.nextAttemptAt.getTime() > nowMs) return { ok: false, reason: "not-due" };
  const epoch = job.epoch + 1;
  return planned({
    status: "leased",
    set: {
      status: "leased",
      epoch,
      attempts: job.attempts + 1,
      lease: { deviceId: who.deviceId, tabId: who.tabId, epoch, expiresAt: new Date(nowMs + PRINT_LEASE_MS) },
    },
    unset: [],
    log: logEntry(nowMs, "leased", who.deviceId),
  });
}

/** leased → (lease ran out) the same as a "maybe sent" failure (§7.2). */
export function planExpiry(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status !== "leased" || job.lease === undefined) return { ok: false, reason: "wrong-status" };
  if (job.lease.expiresAt.getTime() >= nowMs) return { ok: false, reason: "lease-held" };
  return planned(afterUncertain(job, nowMs, "expired", job.lease.deviceId, "lease expired: may have printed"));
}

/** The writer's report (§7.2 ack rows, §7.9 late acks). Idempotent per (job, epoch). */
export function planAck(job: PrintJobLifecycle, ack: PrintJobAck, nowMs: number): PrintJobPlan {
  if (job.status === "leased" && job.epoch === ack.epoch) {
    if (ack.outcome === "printed") return planned(printedPatch(nowMs, ack.deviceId, "printed"));
    const error = (ack.error ?? "").trim().slice(0, PRINT_ACK_ERROR_MAX_CHARS) || (ack.sent === "no" ? "nothing was sent" : "may have printed");
    if (ack.permanent === true) {
      const uncertainAttempts = job.uncertainAttempts + (ack.sent === "maybe" ? 1 : 0);
      return planned(failed(nowMs, { uncertainAttempts, lastError: error }, ack.deviceId, `permanent: ${error}`));
    }
    if (ack.sent === "no") {
      if (printJobOverLimits(job.attempts, job.uncertainAttempts)) {
        return planned(failed(nowMs, { lastError: error }, ack.deviceId, `limits: ${error}`));
      }
      return planned({
        status: "queued",
        set: { status: "queued", nextAttemptAt: new Date(nowMs + printBackoffMs(job.attempts)), lastError: error },
        unset: ["lease"],
        log: logEntry(nowMs, "failed", ack.deviceId, `not sent: ${error}`),
      });
    }
    return planned(afterUncertain(job, nowMs, "failed", ack.deviceId, error));
  }
  if (job.status === "printed" || job.status === "dismissed") return { ok: false, reason: "resolved" };
  if (ack.outcome === "printed") {
    // The write succeeded after the lease ran out, and nobody leased the job since (§7.9).
    if (job.epoch === ack.epoch) return planned(printedPatch(nowMs, ack.deviceId, "late-ack"));
    return {
      ok: false,
      reason: "stale-epoch",
      log: logEntry(nowMs, "late-ack", ack.deviceId, `ignored: epoch ${ack.epoch}, job at ${job.epoch}`),
    };
  }
  return { ok: false, reason: job.status === "leased" ? "stale-epoch" : "not-leased" };
}

/** needs-confirm → the cashier's decision (§7.2). */
export function planConfirm(job: PrintJobLifecycle, decision: PrintJobDecision, staff: string, nowMs: number): PrintJobPlan {
  if (job.status !== "needs-confirm") return { ok: false, reason: "wrong-status" };
  switch (decision) {
    case "reprint":
      // Counters reset and approvedAt set: the cashier's tap is a fresh, approved attempt, so the
      // copy is neither parked as stale nor failed by the uncertain limit it came from.
      return planned({
        status: "queued",
        set: {
          status: "queued",
          labels: addPrintLabel(job.labels, "DUPLICATE"),
          attempts: 0,
          uncertainAttempts: 0,
          nextAttemptAt: new Date(nowMs),
          approvedAt: new Date(nowMs),
        },
        unset: ["lastError"],
        log: logEntry(nowMs, "confirmed", undefined, `print again: ${staff}`),
      });
    case "printed":
      return planned(printedPatch(nowMs, staff, "confirmed", `it printed: ${staff}`));
    case "dismiss":
      return planned({
        status: "dismissed",
        set: { status: "dismissed", dismissedAt: new Date(nowMs), dismissReason: "cashier", dismissedBy: staff },
        unset: [],
        log: logEntry(nowMs, "dismissed", undefined, staff),
      });
  }
}

/** failed → queued ("Print again"), or a stale queued job → leasable ("Print now") (§7.2). */
export function planRetry(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status === "failed") {
    const labels = job.uncertainAttempts > 0 ? addPrintLabel(job.labels, printRepeatLabel(job.kind)) : job.labels;
    return planned({
      status: "queued",
      set: { status: "queued", labels, attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(nowMs), approvedAt: new Date(nowMs) },
      unset: ["lastError"],
      log: logEntry(nowMs, "retried", undefined, "print again"),
    });
  }
  if (printJobStale(job, nowMs)) {
    return planned({
      status: "queued",
      set: { approvedAt: new Date(nowMs), nextAttemptAt: new Date(nowMs) },
      unset: [],
      log: logEntry(nowMs, "retried", undefined, "print now"),
    });
  }
  return { ok: false, reason: "wrong-status" };
}

/** The sweep's limits check (§7.2): a queued job over its limits stops retrying. */
export function planLimits(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status !== "queued" || !printJobOverLimits(job.attempts, job.uncertainAttempts)) {
    return { ok: false, reason: "wrong-status" };
  }
  return planned({ status: "failed", set: { status: "failed", lastError: "too many attempts" }, unset: [], log: logEntry(nowMs, "failed", undefined, "limits") });
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-lifecycle.test.ts src/print-job.test.ts && npx tsc --noEmit -p .`
Expected: every lifecycle test passes (23 tests), `print-job.test.ts` passes with the six-value pin, and tsc reports 0 errors.

A note on `planLimits`: when a failure in the ack path already ended in `failed`, the "limits" log detail comes from `failed()`, and `planLimits` is only the sweep's safety net. Do not remove either one.

- [ ] **Step 6: Commit**

```bash
cd /d/kd/lucifer
git add packages/shared/src/print-job.ts packages/shared/src/print-job.test.ts packages/shared/src/print-lifecycle.ts packages/shared/src/print-lifecycle.test.ts packages/shared/package.json
git commit -m "feat(print): the shared print-job lifecycle: lease, ack, expiry, late acks, labels and limits as pure plans"
```

---

### Task 2: Agent wire types, cadence and the free-tier budget test

**Files:**
- Create: `packages/shared/src/print-agent-wire.ts`
- Create: `packages/shared/src/print-budget.ts`
- Create: `packages/shared/src/print-budget.test.ts`
- Modify: `packages/shared/package.json` (`test` script)

**Interfaces:**
- Produces, from `@pos/shared/print-agent-wire`:
  - Headers: `PRINT_DEVICE_ID_HEADER = "x-pos-device-id"`, `PRINT_IDEMPOTENCY_HEADER = "idempotency-key"`, `PRINT_IDEMPOTENCY_KEY_PATTERN`
  - Devices: `PRINT_DEVICE_SHELLS`, `PrintDeviceShell`, `PrintDeviceCapabilities`
  - Cadence: `PRINT_AGENT_ACTIVE_WINDOW_MS`, `printWakeAgentCap(agents)`, `printAgentWakeIntervalMs({socketHealthy, msSinceLastJob, capSpent}): number | false`
  - Wire types: `LeasedPrintJob`, `PrintLeaseData`, `PrintJobActionRefusal`, `PrintAckData`, `PrintActionData`, `PrintWakeBeatData`
- Produces, from `@pos/shared/print-budget`: `PRINT_BUDGET_BUSY_DAY`, `PRINT_REQUESTS_PER_SLIP`, `PRINT_BUDGET_NORMAL_MAX_PER_DAY`, `PRINT_BUDGET_WORST_MAX_PER_DAY`, `PRINT_AGENT_MIN_CADENCE_MS`, `printSlipRequestsPerDay(day?)`
- Session 1C's agent hook MUST take its wake interval from `printAgentWakeIntervalMs` and its cap from `printWakeAgentCap`. Its source pin will check that, so this test pins the real cadence.

- [ ] **Step 1: Write the failing budget test**

Create `packages/shared/src/print-budget.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINT_WAKE_DAILY_CAP } from "./print-job";
import { printAgentWakeIntervalMs, printWakeAgentCap } from "./print-agent-wire";
import {
  PRINT_AGENT_MIN_CADENCE_MS,
  PRINT_BUDGET_BUSY_DAY,
  PRINT_BUDGET_NORMAL_MAX_PER_DAY,
  PRINT_BUDGET_WORST_MAX_PER_DAY,
  printSlipRequestsPerDay,
} from "./print-budget";

// Spec §17.3 item 4: recompute §17.2's two "Vercel invocations" totals from the exported constants
// and the agents' REAL cadence function. A cadence or cap change that could outgrow a cafe's free
// Vercel Hobby allowance fails here, before it ships.
const OPEN_MS = PRINT_BUDGET_BUSY_DAY.openHours * 60 * 60 * 1000;

function cadence(input: { socketHealthy: boolean; msSinceLastJob: number | null; capSpent: boolean }): number {
  const ms = printAgentWakeIntervalMs(input);
  assert.notEqual(ms, false, "this case polls");
  return ms as number;
}

test("normal busy day (socket healthy): printing stays under 6,000 invocations (spec §17.2: 4,800)", () => {
  const wakePerAgent = OPEN_MS / cadence({ socketHealthy: true, msSinceLastJob: 0, capSpent: false });
  const total = printSlipRequestsPerDay() + PRINT_BUDGET_BUSY_DAY.agents * wakePerAgent;
  assert.equal(total, 4_800);
  assert.ok(total <= PRINT_BUDGET_NORMAL_MAX_PER_DAY);
});

test("worst case (socket down all day, every agent always busy): the shared cap holds the cafe under 18,000", () => {
  const fastest = cadence({ socketHealthy: false, msSinceLastJob: 0, capSpent: false });
  for (const agents of [1, 2, 3, 5, 8, 16]) {
    const perAgent = Math.min(OPEN_MS / fastest, printWakeAgentCap(agents));
    const total = printSlipRequestsPerDay() + agents * perAgent;
    assert.ok(total <= PRINT_BUDGET_WORST_MAX_PER_DAY, `${agents} agents: ${total}/day`);
  }
  const three = printSlipRequestsPerDay() + 3 * Math.min(OPEN_MS / fastest, printWakeAgentCap(3));
  assert.equal(three, 17_040, "spec §17.2's worst-case figure");
});

test("more printer devices never raise the cafe's wake total (spec §9.1 shared cap)", () => {
  for (let agents = 0; agents <= 64; agents++) {
    assert.ok(Math.max(1, agents) * printWakeAgentCap(agents) <= PRINT_WAKE_DAILY_CAP, `${agents} agents`);
  }
  assert.equal(printWakeAgentCap(1), PRINT_WAKE_DAILY_CAP);
  assert.equal(printWakeAgentCap(3), 4_800);
});

test("no agent poll runs faster than 3 s, and a spent cap stops the poll", () => {
  for (const socketHealthy of [true, false]) {
    for (const msSinceLastJob of [null, 0, 119_999, 120_000, 3_600_000]) {
      const ms = cadence({ socketHealthy, msSinceLastJob, capSpent: false });
      assert.ok(ms >= PRINT_AGENT_MIN_CADENCE_MS, `${socketHealthy}/${msSinceLastJob}: ${ms} ms`);
    }
    assert.equal(printAgentWakeIntervalMs({ socketHealthy, msSinceLastJob: 0, capSpent: true }), false);
  }
});

test("spec §9.1 cadences: 60 s on a healthy socket; 3 s while busy without one; 15 s when idle", () => {
  assert.equal(cadence({ socketHealthy: true, msSinceLastJob: 0, capSpent: false }), 60_000);
  assert.equal(cadence({ socketHealthy: false, msSinceLastJob: 119_999, capSpent: false }), 3_000);
  assert.equal(cadence({ socketHealthy: false, msSinceLastJob: 120_000, capSpent: false }), 15_000);
  assert.equal(cadence({ socketHealthy: false, msSinceLastJob: null, capSpent: false }), 15_000);
});
```

Add `src/print-budget.test.ts` to the end of the `test` script in `packages/shared/package.json`.

- [ ] **Step 2: Run it and see it fail**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts`
Expected: FAIL with `Cannot find module './print-agent-wire'`.

- [ ] **Step 3: Implement the two modules**

Create `packages/shared/src/print-agent-wire.ts`:

```ts
// Printing redesign, Phase 1: the agent's wire contract (spec §7.3, §9.1, §10). Shared by the cafe
// server routes and the in-page agent; pure and client-safe.

import {
  PRINT_WAKE_DAILY_CAP,
  PRINT_WAKE_FAST_MS,
  PRINT_WAKE_SLOW_MS,
  PRINT_WAKE_SOCKET_MS,
  type PrintJobKind,
  type PrintJobStatus,
} from "./print-job";
import type { PrintJobLabel, PrintJobRefusal } from "./print-lifecycle";
import type { PrintJobPayload } from "./schemas/print-job.schema";

/** The header a device names itself with on print requests (spec §6.5 originDeviceId). */
export const PRINT_DEVICE_ID_HEADER = "x-pos-device-id";
/** A print the client starts (reprint, EOD, cancel notice) carries this key (spec §7.3). */
export const PRINT_IDEMPOTENCY_HEADER = "idempotency-key";
export const PRINT_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export const PRINT_DEVICE_SHELLS = ["android", "windows", "browser"] as const;
export type PrintDeviceShell = (typeof PRINT_DEVICE_SHELLS)[number];
export interface PrintDeviceCapabilities {
  lan: boolean;
  bluetooth: boolean;
  usb: boolean;
  windowsPrinters: boolean;
  webSerial: boolean;
  webBluetooth: boolean;
}

/** Without a healthy socket an agent polls fast only this long after it last saw a job (spec §9.1). */
export const PRINT_AGENT_ACTIVE_WINDOW_MS = 2 * 60 * 1000;

/** Each agent's share of the cafe's one daily wake cap (spec §9.1): more agents never mean more hits. */
export function printWakeAgentCap(agents: number): number {
  return Math.floor(PRINT_WAKE_DAILY_CAP / Math.max(1, Math.floor(agents)));
}

/** The agent's wake cadence (spec §9.1). false: the daily share is spent, so stop polling until the
 *  next cafe-day; leasing then rides realtime nudges and the pulse, which already run. */
export function printAgentWakeIntervalMs(input: {
  socketHealthy: boolean;
  msSinceLastJob: number | null;
  capSpent: boolean;
}): number | false {
  if (input.capSpent) return false;
  if (input.socketHealthy) return PRINT_WAKE_SOCKET_MS;
  if (input.msSinceLastJob !== null && input.msSinceLastJob < PRINT_AGENT_ACTIVE_WINDOW_MS) return PRINT_WAKE_FAST_MS;
  return PRINT_WAKE_SLOW_MS;
}

/** One leased job (POST /api/print-jobs/lease). The payload rides the lease, so feeds stay metadata only. */
export interface LeasedPrintJob {
  id: string;
  epoch: number;
  kind: PrintJobKind;
  label: string;
  orderId?: string;
  createdAt: string;
  payload: PrintJobPayload;
  labels: PrintJobLabel[];
  copyIndex: number;
  /** 1 for the first lease of this job. */
  attempt: number;
}

/** retryAt: when the head of this device's line can next be leased (backoff, or another tab's live
 *  lease), so the agent sets one local timer instead of polling. */
export interface PrintLeaseData {
  jobs: LeasedPrintJob[];
  retryAt: string | null;
}

export type PrintJobActionRefusal = PrintJobRefusal | "not-found" | "raced";

export interface PrintAckData {
  applied: boolean;
  status: PrintJobStatus | null;
  /** Set when the job went back to the queue: the agent's local retry timer. */
  nextAttemptAt: string | null;
  reason?: PrintJobActionRefusal;
}

export interface PrintActionData {
  applied: boolean;
  status: PrintJobStatus | null;
  reason?: PrintJobActionRefusal;
}

/** POST /api/print-jobs/wake. serverNow lets an agent run timers on server time (spec §15 clock skew). */
export interface PrintWakeBeatData {
  jobsForMe: { count: number; oldestCreatedAt: string | null };
  agents: number;
  agentDailyCap: number;
  serverNow: string;
}
```

Create `packages/shared/src/print-budget.ts`:

```ts
// Printing redesign, spec §17.2: the busy day the printing budget is sized for. print-budget.test.ts
// recomputes the "Vercel invocations" totals from these and from the agents' real cadence function
// (print-agent-wire.ts), and fails when printing could outgrow a cafe's free Vercel Hobby allowance.

export const PRINT_BUDGET_BUSY_DAY = {
  openHours: 12,
  orders: 300,
  /** 1.5 KOT rounds × 2 stations + 1 bill per order. */
  slips: 1_200,
  agents: 3,
  orderingDevices: 5,
  /** Share of slips that need a second lease + ack. */
  retryShare: 0.1,
} as const;

/** Requests one slip costs: a lease and an ack. Job creation rides the order request (spec §7.4). */
export const PRINT_REQUESTS_PER_SLIP = 2;
/** Spec §17.3 item 4. */
export const PRINT_BUDGET_NORMAL_MAX_PER_DAY = 6_000;
export const PRINT_BUDGET_WORST_MAX_PER_DAY = 18_000;
/** No recurring agent poll may run faster than this. */
export const PRINT_AGENT_MIN_CADENCE_MS = 3_000;

/** Lease + ack for every slip, plus the retried share (spec §17.2: 2,400 + 240). */
export function printSlipRequestsPerDay(day: typeof PRINT_BUDGET_BUSY_DAY = PRINT_BUDGET_BUSY_DAY): number {
  return Math.round(day.slips * PRINT_REQUESTS_PER_SLIP * (1 + day.retryShare));
}
```

- [ ] **Step 4: Run the shared suite and the type check**

Run: `cd /d/kd/lucifer/packages/shared && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p .`
Expected: `# fail 0`, `# pass 625` (Phase 0's 597 + 23 lifecycle + 5 budget). tsc 0.

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add packages/shared/src/print-agent-wire.ts packages/shared/src/print-budget.ts packages/shared/src/print-budget.test.ts packages/shared/package.json
git commit -m "feat(print): agent wire contract, the shared wake cadence and cap, and the free-tier budget test"
```

---

### Task 3: `PrintJob` lifecycle fields and the `PrintDevice` model

**Files:**
- Modify: `apps/cafe/models/PrintJob.ts` (imports, `IPrintJob`, two subschemas, the schema fields, two indexes)
- Create: `apps/cafe/models/PrintDevice.ts`
- Modify: `apps/cafe/lib/print-job-model.test.ts` (imports; append tests)

**Interfaces:**
- Consumes: `PRINT_JOB_LABELS`, `PRINT_JOB_LOG_EVENTS`, `PrintJobLabel`, `PrintJobLease`, `PrintJobLogEntry` (Task 1); `PRINT_DEVICE_SHELLS`, `PrintDeviceShell`, `PrintDeviceCapabilities` (Task 2).
- Produces:
  - `IPrintJob` gains `targetDeviceId?`, `originDeviceId?`, `copyIndex?`, `epoch?`, `lease?`, `attempts?`, `uncertainAttempts?`, `nextAttemptAt?`, `labels?`, `approvedAt?`, `printedAt?`, `printedBy?`, `lastError?`, `log?`.
  - `PrintDevice` / `printDeviceSchema` / `IPrintDevice` from `@/models/PrintDevice`.

- [ ] **Step 1: Write the failing model tests**

In `apps/cafe/lib/print-job-model.test.ts`, change the imports to:

```ts
import { PRINT_JOB_DISMISS_REASONS, PRINT_JOB_STATUSES } from "@pos/shared/print-job";
import { printJobSchema, PrintJob } from "../models/PrintJob";
import { printHostSchema, PrintHost } from "../models/PrintHost";
import { printDeviceSchema, PrintDevice } from "../models/PrintDevice";
import { assertSchemaTtlAllowed } from "./ttl-guard";
```

Keep any other import the file already has. Then append:

```ts
// ── Phase 1 lifecycle (plan 2026-10-02-phase-1-lifecycle.md, Task 3) ─────────

const MIN_JOB = { kind: "kot", payload: "{}", label: "KOT round 1 · T-4", queuedBy: "Staff" } as const;
const LIFECYCLE_PATHS = [
  "targetDeviceId", "originDeviceId", "copyIndex", "epoch", "lease", "attempts", "uncertainAttempts",
  "nextAttemptAt", "labels", "approvedAt", "printedAt", "printedBy", "lastError", "log",
] as const;

test("PrintJob: Phase 1 indexes — one device's line, and an ordering device's recent jobs", () => {
  const keys = printJobSchema.indexes().map(([fields]) => JSON.stringify(fields));
  assert.ok(keys.includes(JSON.stringify({ targetDeviceId: 1, status: 1, createdAt: 1, _id: 1 })), "the line index, in exactly that key order");
  assert.ok(keys.includes(JSON.stringify({ originDeviceId: 1, createdAt: -1 })), "the readback index");
  assert.ok(keys.includes(JSON.stringify({ status: 1, createdAt: 1, _id: 1 })), "landmark: the prune/feed index stays");
});

test("PrintJob: every Phase 1 lifecycle field is absent on a minimal doc (omit-empty, the arrays included)", () => {
  const doc = new PrintJob({ ...MIN_JOB });
  assert.equal(doc.validateSync(), undefined);
  for (const p of LIFECYCLE_PATHS) assert.equal(doc.get(p), undefined, `${p} must not default (a pre-Phase-1 row has none of them)`);
});

test("PrintJob: status accepts every Phase 1 state; labels, log events and the lease are validated", () => {
  for (const status of PRINT_JOB_STATUSES) {
    assert.equal(new PrintJob({ ...MIN_JOB, status }).validateSync(), undefined, status);
  }
  const badLabel = new PrintJob({ ...MIN_JOB, labels: ["REPRNT"] }).validateSync();
  assert.ok(Object.keys(badLabel?.errors ?? {}).some((k) => k.startsWith("labels")), "an unknown label is refused");
  const badEvent = new PrintJob({ ...MIN_JOB, log: [{ at: new Date(), event: "teleported" }] }).validateSync();
  assert.ok(Object.keys(badEvent?.errors ?? {}).some((k) => k.startsWith("log")), "an unknown log event is refused");
  const noExpiry = new PrintJob({ ...MIN_JOB, lease: { deviceId: "d", tabId: "t", epoch: 1 } }).validateSync();
  assert.ok(noExpiry?.errors["lease.expiresAt"], "a lease always carries its expiry");
  const full = new PrintJob({
    ...MIN_JOB,
    status: "leased",
    targetDeviceId: "dev-a",
    epoch: 1,
    attempts: 1,
    uncertainAttempts: 0,
    nextAttemptAt: new Date(),
    labels: ["REPRINT"],
    lease: { deviceId: "dev-a", tabId: "t", epoch: 1, expiresAt: new Date() },
    log: [{ at: new Date(), event: "leased", deviceId: "dev-a" }],
  });
  assert.equal(full.validateSync(), undefined, "a real leased row validates");
});

const BEAT_ROW = {
  deviceId: "dev-1",
  label: "Counter PC",
  shell: "windows",
  capabilities: { lan: true, bluetooth: false, usb: false, windowsPrinters: true, webSerial: false, webBluetooth: false },
  lastSeenAt: new Date(),
} as const;

test("PrintDevice: a heartbeat row validates; appVersion and nativeProtocol stay absent unless sent", () => {
  const doc = new PrintDevice({ ...BEAT_ROW });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.get("appVersion"), undefined);
  assert.equal(doc.get("nativeProtocol"), undefined);
});

test("PrintDevice: deviceId is required and unique; shell is an enum; capabilities and lastSeenAt are required", () => {
  assert.equal(printDeviceSchema.path("deviceId").options.unique, true);
  const err = new PrintDevice({}).validateSync();
  for (const p of ["deviceId", "label", "shell", "capabilities", "lastSeenAt"]) assert.ok(err?.errors[p], `${p} is required`);
  assert.ok(new PrintDevice({ ...BEAT_ROW, shell: "ios" }).validateSync()?.errors.shell, "an unknown shell is refused");
});

test("assertSchemaTtlAllowed(PrintDevice) does not throw — there is no TTL index", () => {
  assert.doesNotThrow(() => assertSchemaTtlAllowed("PrintDevice", printDeviceSchema));
  assert.ok(printDeviceSchema.indexes().every(([, options]) => options?.expireAfterSeconds === undefined));
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-job-model.test.ts`
Expected: FAIL with `Cannot find module '../models/PrintDevice'`.

- [ ] **Step 3: Add the PrintJob lifecycle fields**

In `apps/cafe/models/PrintJob.ts`, add this import below the existing `@pos/shared/print-job` import:

```ts
import {
  PRINT_JOB_LABELS,
  PRINT_JOB_LOG_EVENTS,
  type PrintJobLabel,
  type PrintJobLease,
  type PrintJobLogEntry,
} from "@pos/shared/print-lifecycle";
```

In `interface IPrintJob`, directly after `dismissedBy?: string; // staff name from session, mirrors queuedBy`, add:

```ts
  // Phase 1 lifecycle (spec §6.5). All omit-empty: a row written before Phase 1 carries none of
  // them, and lifecycleOf (@pos/shared/print-lifecycle) reads a missing counter as 0.
  targetDeviceId?: string; // simple mode (§6.6): the one device that may lease it
  originDeviceId?: string; // the device that asked; its readback follows the job
  copyIndex?: number; // 0-based (copies arrive in Phase 2)
  epoch?: number; // +1 on every lease; an ack must name the lease's epoch
  lease?: PrintJobLease;
  attempts?: number; // leases granted
  uncertainAttempts?: number; // attempts that may have reached paper
  nextAttemptAt?: Date; // the backoff gate
  labels?: PrintJobLabel[]; // one printed banner; only ever added
  approvedAt?: Date; // staff tapped Print now / Print again
  printedAt?: Date; // set ONLY by an acknowledged write (or the cashier's "it printed")
  printedBy?: string; // the writing device's id, or the staff name
  lastError?: string;
  log?: PrintJobLogEntry[]; // the newest PRINT_JOB_LOG_MAX entries
```

Directly above `export const printJobSchema = new Schema<IPrintJob>(`, add:

```ts
// Phase 1 subdocuments. No _id: they are values, not entities.
const printJobLeaseSchema = new Schema<PrintJobLease>(
  {
    deviceId: { type: String, required: true },
    tabId: { type: String, required: true },
    epoch: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { _id: false },
);
const printJobLogSchema = new Schema<PrintJobLogEntry>(
  {
    at: { type: Date, required: true },
    event: { type: String, enum: [...PRINT_JOB_LOG_EVENTS], required: true },
    deviceId: { type: String },
    detail: { type: String },
  },
  { _id: false },
);
```

In the schema definition, directly after `dismissedBy: { type: String },`, add:

```ts
    // Phase 1 lifecycle (spec §6.5). Omit-empty with NO defaults, for the same reason as above: a row
    // from before Phase 1 must stay exactly as it was. The arrays say `default: undefined` because
    // Mongoose would otherwise write [] onto every row.
    targetDeviceId: { type: String },
    originDeviceId: { type: String },
    copyIndex: { type: Number },
    epoch: { type: Number },
    lease: { type: printJobLeaseSchema },
    attempts: { type: Number },
    uncertainAttempts: { type: Number },
    nextAttemptAt: { type: Date },
    labels: { type: [{ type: String, enum: [...PRINT_JOB_LABELS] }], default: undefined },
    approvedAt: { type: Date },
    printedAt: { type: Date },
    printedBy: { type: String },
    lastError: { type: String },
    log: { type: [printJobLogSchema], default: undefined },
```

Directly after the `jobKey` index line, add:

```ts
// Phase 1: one device's line, oldest first (lib/print-lease.ts printJobLineFilter, and the wake's
// jobsForMe read). The {status, nextAttemptAt, …} index in spec §6.5 is NOT created: no Phase 1
// query uses it, and on M0 every index costs storage and write amplification.
printJobSchema.index({ targetDeviceId: 1, status: 1, createdAt: 1, _id: 1 });
// Phase 1: an ordering device's own recent jobs (its readback, Session 1D).
printJobSchema.index({ originDeviceId: 1, createdAt: -1 });
```

- [ ] **Step 4: Create the PrintDevice model**

Create `apps/cafe/models/PrintDevice.ts`:

```ts
import mongoose, { Schema, type Document, type Model } from "mongoose";
import { PRINT_DEVICE_SHELLS, type PrintDeviceCapabilities, type PrintDeviceShell } from "@pos/shared/print-agent-wire";

// Printing redesign, Phase 1 (spec §6.4): one row per device that prints or leases. The heartbeat
// rides the agent's existing wake poll (POST /api/print-jobs/wake) and writes this row at most every
// 30 s (lib/print-device.ts), so it adds no request. A device is online while lastSeenAt is within
// 90 s. Phase 2 adds billPrinterId.
//
// Deliberately NOT in the federated registry, like models/PrintJob.ts and models/PrintHost.ts: this is
// operational state (which device is alive), not money or tenant data.

export interface IPrintDevice extends Document {
  deviceId: string; // the device's pos.device-id.v1 value; unique
  label: string;
  shell: PrintDeviceShell;
  capabilities: PrintDeviceCapabilities;
  lastSeenAt: Date;
  appVersion?: string;
  nativeProtocol?: number; // the Android bridge version; 1 = one printer only
  createdAt: Date;
  updatedAt: Date;
}

const capabilitiesSchema = new Schema<PrintDeviceCapabilities>(
  {
    lan: { type: Boolean, required: true },
    bluetooth: { type: Boolean, required: true },
    usb: { type: Boolean, required: true },
    windowsPrinters: { type: Boolean, required: true },
    webSerial: { type: Boolean, required: true },
    webBluetooth: { type: Boolean, required: true },
  },
  { _id: false },
);

export const printDeviceSchema = new Schema<IPrintDevice>(
  {
    // unique:true creates the index — the heartbeat's upsert relies on it (an E11000 means the row
    // exists and is fresh).
    deviceId: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    shell: { type: String, enum: [...PRINT_DEVICE_SHELLS], required: true },
    capabilities: { type: capabilitiesSchema, required: true },
    lastSeenAt: { type: Date, required: true },
    // Omit-empty: absent until a shell reports it.
    appVersion: { type: String },
    nativeProtocol: { type: Number },
  },
  { timestamps: true },
);

// NO TTL index (ttl-guard default-deny): a device row is tiny, one per device, and stays.

export const PrintDevice: Model<IPrintDevice> =
  (mongoose.models.PrintDevice as Model<IPrintDevice>) ??
  mongoose.model<IPrintDevice>("PrintDevice", printDeviceSchema);
```

- [ ] **Step 5: Run the model tests and the type check**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-job-model.test.ts && npx tsc --noEmit`
Expected: every model test passes, the 18 old ones and the 6 new ones, and tsc reports 0 errors.

If Mongoose reports an enum error under a different path than `labels…` or `log…`, keep the assertion's intent: an unknown label and an unknown event are each refused. Change only the path prefix to the one Mongoose reports.

- [ ] **Step 6: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/models/PrintJob.ts apps/cafe/models/PrintDevice.ts apps/cafe/lib/print-job-model.test.ts
git commit -m "feat(print): PrintJob lifecycle fields (omit-empty) and the PrintDevice heartbeat model"
```

---

### Task 4: Lease and ack on the server

**Files:**
- Create: `apps/cafe/lib/print-lease.ts`
- Create: `apps/cafe/lib/print-lease.test.ts`
- Modify: `apps/cafe/lib/self-order-alert-paths.test.ts` (test `e2`, the PrintJob writer allow-list, around line 219)
- Modify: `apps/cafe/package.json` (`testChain`: add `"lib/print-lease.test.ts"` directly after `"lib/print-queue-fixes.test.ts"`)

**Interfaces:**
- Consumes: Task 1's plans and `lifecycleOf`; Task 2's `LeasedPrintJob`, `PrintLeaseData`, `PrintAckData`. From existing code: `dismissPrintJob` and `drainAgeCutoff` (`lib/print-queue.ts`), `printJobEligibility` and `printJobNeedsOrderRead` (`lib/print-queue-claim.ts`), `printJobPayloadSchema`.
- Produces, from `@/lib/print-lease`:
  - Constants: `PRINT_LIFECYCLE_SELECT: string`, `PRINT_JOBS_FOR_ME_LIMIT = 20`
  - Types: `PrintLifecycleRow`, `PrintJobUpdate`
  - Pure: `printJobLineFilter(deviceId, nowMs)`, `printJobCasFilter(id, job)`, `printJobUpdateOf(patch)`, `leasedPrintJobOf(head, patch, payload, labels): LeasedPrintJob`
  - DB:
    - `applyPrintJobPlan(id: Types.ObjectId, job: PrintJobLifecycle, patch: PrintJobPatch): Promise<boolean>`
    - `leasePrintJobs(input: { deviceId; tabId; dismissedBy; nowMs }): Promise<PrintLeaseData>`
    - `ackPrintJob(input: PrintJobAck & { id: string; nowMs: number }): Promise<PrintAckData>`
    - `readJobsForDevice(deviceId, nowMs): Promise<{ count: number; oldestCreatedAt: string | null }>`

- [ ] **Step 1: Write the failing unit tests**

Create `apps/cafe/lib/print-lease.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { PRINT_JOB_LOG_MAX, PRINT_LEASE_MS, lifecycleOf, planExpiry, planLease, type PrintJobPlan, type PrintJobPatch } from "@pos/shared/print-lifecycle";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { leasedPrintJobOf, printJobCasFilter, printJobLineFilter, printJobUpdateOf } from "./print-lease";

// Phase 1 Session 1A — DB-free tests of print-lease.ts's pure exports. The DB paths are proven live
// (npm run verify:print:live, legs q–x) and pinned in print-lifecycle-paths.test.ts.

const T0 = Date.parse("2026-10-02T12:00:00.000Z");
const WHO = { deviceId: "dev-a", tabId: "tab-1" };

function patchOf(plan: PrintJobPlan): PrintJobPatch {
  if (!plan.ok) throw new assert.AssertionError({ message: `expected a plan, got "${plan.reason}"` });
  return plan.patch;
}

test("printJobLineFilter: this device's leased job, plus its queued jobs that are fresh or approved", () => {
  assert.deepEqual(printJobLineFilter("dev-a", T0), {
    targetDeviceId: "dev-a",
    status: { $in: ["queued", "leased"] },
    $or: [{ status: "leased" }, { createdAt: { $gte: new Date(T0 - PRINT_HOST_MAX_AGE_MS) } }, { approvedAt: { $exists: true } }],
  });
});

test("printJobCasFilter: fences on the status and epoch the plan read; epoch 0 also matches a row with no epoch", () => {
  const id = new mongoose.Types.ObjectId();
  assert.deepEqual(printJobCasFilter(id, { status: "queued", epoch: 0 }), { _id: id, status: "queued", epoch: { $in: [0, null] } });
  assert.deepEqual(printJobCasFilter(id, { status: "leased", epoch: 3 }), { _id: id, status: "leased", epoch: 3 });
});

test("printJobUpdateOf: $set as planned, $unset only when asked, and the log capped at the newest entries", () => {
  const queued = lifecycleOf({ kind: "kot", status: "queued", createdAt: new Date(T0) });
  const lease = patchOf(planLease(queued, WHO, T0));
  const update = printJobUpdateOf(lease);
  assert.deepEqual(update.$set, lease.set);
  assert.equal("$unset" in update, false, "nothing to unset: no $unset key at all");
  assert.deepEqual(update.$push, { log: { $each: [lease.log], $slice: -PRINT_JOB_LOG_MAX } });
  const leased = lifecycleOf({
    kind: "kot",
    status: "leased",
    createdAt: new Date(T0),
    epoch: 1,
    attempts: 1,
    lease: { deviceId: "dev-a", tabId: "tab-1", epoch: 1, expiresAt: new Date(T0 + PRINT_LEASE_MS) },
  });
  const expired = patchOf(planExpiry(leased, T0 + PRINT_LEASE_MS + 1));
  assert.deepEqual(printJobUpdateOf(expired).$unset, { lease: 1 });
});

test("leasedPrintJobOf: the wire job carries the new epoch, the attempt number, the labels and the parsed payload", () => {
  const id = new mongoose.Types.ObjectId();
  const queued = lifecycleOf({ kind: "eod", status: "queued", createdAt: new Date(T0), epoch: 2, attempts: 2 });
  const lease = patchOf(planLease(queued, WHO, T0));
  const payload: PrintJobPayload = { kind: "eod", dateKey: "2026-10-02", dateLabel: "2 Oct 2026" };
  const head = { _id: id, kind: "eod" as const, label: "End of day · 2 Oct", createdAt: new Date(T0) };
  assert.deepEqual(leasedPrintJobOf(head, lease, payload, ["REPRINT"]), {
    id: String(id),
    epoch: 3,
    kind: "eod",
    label: "End of day · 2 Oct",
    createdAt: new Date(T0).toISOString(),
    payload,
    labels: ["REPRINT"],
    copyIndex: 0,
    attempt: 3,
  });
});
```

Add `"lib/print-lease.test.ts",` to `testChain` in `apps/cafe/package.json`, directly after `"lib/print-queue-fixes.test.ts",`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lease.test.ts`
Expected: FAIL with `Cannot find module './print-lease'`.

- [ ] **Step 3: Implement `lib/print-lease.ts`**

Create `apps/cafe/lib/print-lease.ts`:

```ts
import mongoose, { type FilterQuery, type Types, type UpdateQuery } from "mongoose";
import type { PrintJobKind } from "@pos/shared/print-job";
import type { LeasedPrintJob, PrintAckData, PrintLeaseData } from "@pos/shared/print-agent-wire";
import {
  PRINT_JOB_LOG_MAX,
  lifecycleOf,
  planAck,
  planExpiry,
  planLease,
  planLimits,
  type PrintJobAck,
  type PrintJobLabel,
  type PrintJobLifecycle,
  type PrintJobLifecycleDoc,
  type PrintJobLogEntry,
  type PrintJobPatch,
  type PrintJobSet,
} from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { Order } from "@/models/Order";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
import { printJobEligibility, printJobNeedsOrderRead } from "./print-queue-claim";

// Printing redesign, Phase 1 (spec §7.2–7.6, §7.9): lease → write → ack. Every transition is a pure
// plan from @pos/shared/print-lifecycle, applied with ONE compare-and-set on {_id, status, epoch}.
// A racing writer (another tab, the sweep, a staff tap) makes the CAS miss: the caller re-reads and
// re-plans, never transitions twice. Never calls connectDB() (the route does that first). No
// console.*, strict TS, no `any`.

/** The fields every lifecycle read selects; lifecycleOf reads exactly these. */
export const PRINT_LIFECYCLE_SELECT = "kind status createdAt epoch attempts uncertainAttempts nextAttemptAt labels approvedAt lease";
const LEASE_SELECT = `${PRINT_LIFECYCLE_SELECT} label orderId payload copyIndex`;
/** Bounds one lease call: each step expires, fails or dismisses one bad head, or loses one race. */
const LEASE_MAX_STEPS = 4;
const ACK_MAX_STEPS = 2;
/** The wake's jobsForMe counts up to this many: the agent only needs "some" and the oldest age. */
export const PRINT_JOBS_FOR_ME_LIMIT = 20;

export type PrintLifecycleRow = PrintJobLifecycleDoc & { _id: Types.ObjectId };
type LeaseHead = PrintLifecycleRow & { label: string; orderId?: string; payload: string; copyIndex?: number };

/** One device's line (simple mode, spec §6.6/§7.6): its leased job, plus each queued job that is
 *  not parked as stale. needs-confirm and failed jobs are parked and never block the line. */
export function printJobLineFilter(deviceId: string, nowMs: number): FilterQuery<IPrintJob> {
  return {
    targetDeviceId: deviceId,
    status: { $in: ["queued", "leased"] },
    // A leased job stays at the head whatever its age, so a line never has two writers.
    $or: [{ status: "leased" }, { createdAt: { $gte: drainAgeCutoff(nowMs) } }, { approvedAt: { $exists: true } }],
  };
}

/** The CAS fence: the status and epoch the plan was computed from. A row from before Phase 1 has no
 *  epoch field at all, and lifecycleOf reads that as 0. */
export function printJobCasFilter(id: unknown, job: Pick<PrintJobLifecycle, "status" | "epoch">): FilterQuery<IPrintJob> {
  return { _id: id, status: job.status, epoch: job.epoch === 0 ? { $in: [0, null] } : job.epoch } as FilterQuery<IPrintJob>;
}

export interface PrintJobUpdate {
  $set: PrintJobSet;
  $unset?: Partial<Record<"lease" | "lastError", 1>>;
  $push: { log: { $each: PrintJobLogEntry[]; $slice: number } };
}

export function printJobUpdateOf(patch: PrintJobPatch): PrintJobUpdate {
  const update: PrintJobUpdate = { $set: patch.set, $push: { log: { $each: [patch.log], $slice: -PRINT_JOB_LOG_MAX } } };
  if (patch.unset.length > 0) {
    update.$unset = Object.fromEntries(patch.unset.map((p) => [p, 1])) as PrintJobUpdate["$unset"];
  }
  return update;
}

/** Applies a plan. false: another writer moved the job first, so re-read and re-plan. */
export async function applyPrintJobPlan(id: Types.ObjectId, job: PrintJobLifecycle, patch: PrintJobPatch): Promise<boolean> {
  const res = await PrintJob.updateOne(printJobCasFilter(id, job), printJobUpdateOf(patch) as UpdateQuery<IPrintJob>);
  return res.modifiedCount === 1;
}

export function leasedPrintJobOf(
  head: { _id: unknown; kind: PrintJobKind; label: string; orderId?: string; createdAt: Date; copyIndex?: number },
  patch: PrintJobPatch,
  payload: PrintJobPayload,
  labels: PrintJobLabel[],
): LeasedPrintJob {
  return {
    id: String(head._id),
    epoch: patch.set.epoch ?? 0,
    kind: head.kind,
    label: head.label,
    ...(head.orderId !== undefined ? { orderId: head.orderId } : {}),
    createdAt: head.createdAt.toISOString(),
    payload,
    labels,
    copyIndex: head.copyIndex ?? 0,
    attempt: patch.set.attempts ?? 1,
  };
}

/** The claim path's gates, unchanged (print-queue-claim.ts): a payload that no longer parses, or a
 *  KOT/bill whose order was cancelled (or whose round was voided), is dismissed and never printed.
 *  null: the head was dismissed; take the next one. */
async function leaseEligibility(head: LeaseHead, dismissedBy: string): Promise<PrintJobPayload | null> {
  const id = String(head._id);
  let payload: PrintJobPayload;
  try {
    const parsed = printJobPayloadSchema.safeParse(JSON.parse(head.payload) as unknown);
    if (!parsed.success) throw new Error("invalid payload");
    payload = parsed.data;
  } catch {
    await dismissPrintJob({ id, reason: "invalid-payload", dismissedBy });
    return null;
  }
  if (printJobNeedsOrderRead(payload) && head.orderId !== undefined) {
    if (!mongoose.isValidObjectId(head.orderId)) {
      await dismissPrintJob({ id, reason: "invalid-payload", dismissedBy });
      return null;
    }
    const order = await Order.findById(head.orderId).select("status items.kotRound").lean();
    const verdict = printJobEligibility(payload, order);
    if (!verdict.eligible) {
      await dismissPrintJob({ id, reason: verdict.reason, dismissedBy });
      return null;
    }
  }
  return payload;
}

/** Leases the head of this device's line (spec §7.6: at most one job per printer). An expired lease
 *  at the head is applied lazily here, so a dead writer never blocks the line past 90 s. */
export async function leasePrintJobs(input: { deviceId: string; tabId: string; dismissedBy: string; nowMs: number }): Promise<PrintLeaseData> {
  for (let step = 0; step < LEASE_MAX_STEPS; step++) {
    const head = await PrintJob.findOne(printJobLineFilter(input.deviceId, input.nowMs))
      .sort({ createdAt: 1, _id: 1 })
      .select(LEASE_SELECT)
      .lean<LeaseHead>();
    if (head === null) return { jobs: [], retryAt: null };
    const job = lifecycleOf(head);
    if (job.status === "leased") {
      const expiry = planExpiry(job, input.nowMs);
      // A live lease (another tab of this device is writing it): the line waits for that ack.
      if (!expiry.ok) return { jobs: [], retryAt: job.lease?.expiresAt.toISOString() ?? null };
      await applyPrintJobPlan(head._id, job, expiry.patch);
      continue;
    }
    const limits = planLimits(job, input.nowMs);
    if (limits.ok) {
      await applyPrintJobPlan(head._id, job, limits.patch);
      continue;
    }
    const plan = planLease(job, input, input.nowMs);
    // In backoff, the head HOLDS the line (kitchen order is kept); the agent sets one timer.
    if (!plan.ok) return { jobs: [], retryAt: plan.reason === "not-due" ? job.nextAttemptAt.toISOString() : null };
    const payload = await leaseEligibility(head, input.dismissedBy);
    if (payload === null) continue;
    if (!(await applyPrintJobPlan(head._id, job, plan.patch))) continue;
    return { jobs: [leasedPrintJobOf(head, plan.patch, payload, job.labels)], retryAt: null };
  }
  return { jobs: [], retryAt: null };
}

/** The writer's report on one attempt (spec §7.2, §7.9). Idempotent per (job, epoch): a repeat of
 *  an applied "printed" ack answers status "printed", applied:false, reason "resolved". */
export async function ackPrintJob(input: PrintJobAck & { id: string; nowMs: number }): Promise<PrintAckData> {
  for (let step = 0; step < ACK_MAX_STEPS; step++) {
    const row = await PrintJob.findById(input.id).select(PRINT_LIFECYCLE_SELECT).lean<PrintLifecycleRow>();
    if (row === null) return { applied: false, status: null, nextAttemptAt: null, reason: "not-found" };
    const job = lifecycleOf(row);
    const plan = planAck(job, input, input.nowMs);
    if (!plan.ok) {
      // An ack from an attempt that was leased again: kept in the log, otherwise ignored (§7.9).
      if (plan.log !== undefined) {
        await PrintJob.updateOne({ _id: row._id }, { $push: { log: { $each: [plan.log], $slice: -PRINT_JOB_LOG_MAX } } });
      }
      return { applied: false, status: job.status, nextAttemptAt: null, reason: plan.reason };
    }
    if (await applyPrintJobPlan(row._id, job, plan.patch)) {
      return { applied: true, status: plan.patch.status, nextAttemptAt: plan.patch.set.nextAttemptAt?.toISOString() ?? null };
    }
  }
  return { applied: false, status: null, nextAttemptAt: null, reason: "raced" };
}

/** The wake's "jobs for me" (spec §7.3): how many jobs wait in this device's line, and the oldest. */
export async function readJobsForDevice(deviceId: string, nowMs: number): Promise<{ count: number; oldestCreatedAt: string | null }> {
  const rows = await PrintJob.find(printJobLineFilter(deviceId, nowMs))
    .sort({ createdAt: 1, _id: 1 })
    .select("createdAt")
    .limit(PRINT_JOBS_FOR_ME_LIMIT)
    .lean<{ createdAt: Date }[]>();
  return { count: rows.length, oldestCreatedAt: rows[0]?.createdAt.toISOString() ?? null };
}
```

- [ ] **Step 4: Admit the new writer to the PrintJob writer allow-list**

In `apps/cafe/lib/self-order-alert-paths.test.ts`, test `e2` (`PIN: the exact set of apps/cafe production files that write PrintJob …`), replace:

```ts
  const EXPECTED_PRINT_JOB_WRITERS = ["apps/cafe/lib/print-queue-claim.ts", "apps/cafe/lib/print-queue.ts"].sort();
```

with:

```ts
  // Phase 1 adds print-lease.ts: every lifecycle transition is ONE CAS on {_id, status, epoch}
  // (printJobCasFilter), re-audited against the claimedAt guards above — the legacy claim CAS and
  // the lease CAS both fence on status:"queued", so exactly one of them wins a job.
  const EXPECTED_PRINT_JOB_WRITERS = ["apps/cafe/lib/print-lease.ts", "apps/cafe/lib/print-queue-claim.ts", "apps/cafe/lib/print-queue.ts"].sort();
```

- [ ] **Step 5: Run the tests and the type check**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lease.test.ts lib/self-order-alert-paths.test.ts && npx tsc --noEmit && npx eslint lib/print-lease.ts lib/print-lease.test.ts`
Expected: 4 + every `self-order-alert-paths` test pass; tsc 0; eslint 0 problems.

- [ ] **Step 6: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-lease.ts apps/cafe/lib/print-lease.test.ts apps/cafe/lib/self-order-alert-paths.test.ts apps/cafe/package.json
git commit -m "feat(print): lease the head of a device's line and acknowledge attempts with one epoch-fenced CAS"
```

---

### Task 5: Device heartbeat, staff actions and the sweep

**Files:**
- Create: `apps/cafe/lib/print-device.ts`
- Create: `apps/cafe/lib/print-job-actions.ts`
- Create: `apps/cafe/lib/print-sweep.ts`
- Create: `apps/cafe/lib/print-lifecycle-paths.test.ts`
- Modify: `apps/cafe/lib/self-order-alert-paths.test.ts` (test `e2` again: the sweep is a writer)
- Modify: `apps/cafe/package.json` (`testChain`: add `"lib/print-lifecycle-paths.test.ts"` directly after `"lib/print-lease.test.ts"`)

**Interfaces:**
- Consumes:
  - Task 4: `applyPrintJobPlan`, `PRINT_LIFECYCLE_SELECT`, `PrintLifecycleRow`.
  - Task 1: `planConfirm`, `planRetry`, `planExpiry`, `planLimits`, `lifecycleOf`, the constants.
  - Existing: `prunePrintJobsThrottled` (`lib/print-queue.ts`), `publishCafeEvent` (`lib/realtime-publish.ts`), `PrintHost`, `PRINT_HOST_KEY`, `isDuplicateKeyError`.
- Produces:
  - `@/lib/print-device`:
    - `interface PrintDeviceBeat { deviceId; label; shell; capabilities; appVersion?; nativeProtocol? }`
    - `beatPrintDevice(beat, nowMs): Promise<void>`
    - `touchPrintDevice(deviceId, nowMs): Promise<void>`
    - `countOnlineAgents(nowMs): Promise<number>` (≥ 1)
  - `@/lib/print-job-actions`:
    - `confirmPrintJob({ id, decision, staff, nowMs }): Promise<PrintActionData>`
    - `retryPrintJob({ id, nowMs }): Promise<PrintActionData>`
  - `@/lib/print-sweep`:
    - `PRINT_SWEEP_BATCH = 20`
    - `interface PrintSweepResult { expired; requeued; retargeted; failed }`
    - `sweepPrintJobs(nowMs): Promise<PrintSweepResult>`
    - `sweepPrintJobsThrottled(nowMs): Promise<void>` (never throws)

- [ ] **Step 1: Write the failing source pins**

Create `apps/cafe/lib/print-lifecycle-paths.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";

// Printing redesign Phase 1 (plan docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md, Session 1A):
// source pins over the DB-touching lifecycle libs and routes. Behaviour is proven by the pure plans'
// tests (packages/shared/src/print-lifecycle.test.ts) and live (npm run verify:print:live, legs q–x).
// Every pin pairs its absence checks with a positive landmark, so a blinded file cannot pass.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const count = (text: string, needle: string): number => text.split(needle).length - 1;
function inOrder(text: string, needles: string[], label: string): void {
  let at = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, at + 1);
    assert.ok(next > at, `${label}: "${needle}" must come after the step before it`);
    at = next;
  }
}

const LEASE = "apps/cafe/lib/print-lease.ts";
const DEVICE = "apps/cafe/lib/print-device.ts";
const ACTIONS = "apps/cafe/lib/print-job-actions.ts";
const SWEEP = "apps/cafe/lib/print-sweep.ts";

test("PIN: every lifecycle transition is ONE compare-and-set on {_id, status, epoch}, and a lease call is bounded", () => {
  const s = src(LEASE);
  assert.match(s, /PrintJob\.updateOne\(printJobCasFilter\(id, job\), printJobUpdateOf\(patch\)/);
  assert.match(s, /return res\.modifiedCount === 1;/);
  assert.match(s, /for \(let step = 0; step < LEASE_MAX_STEPS; step\+\+\)/);
  assert.match(s, /printJobEligibility\(payload, order\)/, "the claim path's live-order gate still applies to a lease");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});

test("PIN: the heartbeat writes at most once per 30 s per device, swallows only the fresh-row E11000, and a lease never creates a device", () => {
  const s = src(DEVICE);
  assert.match(s, /lastSeenAt: \{ \$lt: new Date\(nowMs - PRINT_DEVICE_HEARTBEAT_WRITE_MS\) \}/);
  assert.equal(count(s, "upsert: true"), 1, "only the wake heartbeat upserts; touchPrintDevice never does");
  assert.match(s, /if \(!isDuplicateKeyError\(error\)\) throw error;/);
  assert.match(s, /return Math\.max\(1, online\);/, "the agent count divides the wake cap, so it is never 0");
});

test("PIN: staff actions go through applyPrintJobPlan and nudge the printer only when the job is back in the queue", () => {
  const s = src(ACTIONS);
  assert.match(s, /planConfirm\(job, input\.decision, input\.staff, input\.nowMs\)/);
  assert.match(s, /planRetry\(job, input\.nowMs\)/);
  assert.match(s, /await applyPrintJobPlan\(row\._id, job, plan\.patch\)/);
  assert.equal(count(s, 'publishCafeEvent("print-job")'), 1);
  assert.match(s, /if \(plan\.patch\.status === "queued"\) publishCafeEvent\("print-job"\);/);
  assert.ok(!/PrintJob\.(create|updateOne|findOneAndUpdate|updateMany|deleteMany)\(/.test(s), "no direct PrintJob write");
});

test("PIN: the sweep's throttle claims its slot BEFORE awaiting, so two overlapping requests never both sweep", () => {
  const s = src(SWEEP);
  assert.match(s, /if \(nowMs - lastSweepAtMs < PRINT_SWEEP_MIN_INTERVAL_MS\) return;/);
  inOrder(s, ["lastSweepAtMs = nowMs;", "await sweepPrintJobs(nowMs);"], "throttle");
});

test("PIN: the sweep expires leases, retargets queued jobs to the current host, applies limits, then prunes — and nudges only when a job went back to the queue", () => {
  const s = src(SWEEP);
  inOrder(s, ["planExpiry(", "targetDeviceId: { $ne: host.deviceId }", "planLimits(", "await prunePrintJobsThrottled(nowMs);"], "sweep order");
  assert.equal(count(s, 'publishCafeEvent("print-job")'), 1);
  assert.match(s, /if \(result\.requeued > 0 \|\| result\.retargeted > 0\) publishCafeEvent\("print-job"\);/);
  assert.equal(count(s, ".limit(PRINT_SWEEP_BATCH)"), 2, "both sweep reads are bounded");
  assert.ok(!s.includes("console."));
});
```

Add `"lib/print-lifecycle-paths.test.ts",` to `testChain` directly after `"lib/print-lease.test.ts",`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts`
Expected: the first pin passes (Task 4's file exists). The other four FAIL with `ENOENT` for `print-device.ts`, `print-job-actions.ts` and `print-sweep.ts`.

- [ ] **Step 3: Implement the three libs**

Create `apps/cafe/lib/print-device.ts`:

```ts
import { isDuplicateKeyError } from "@pos/shared/api";
import type { PrintDeviceCapabilities, PrintDeviceShell } from "@pos/shared/print-agent-wire";
import { PRINT_DEVICE_HEARTBEAT_WRITE_MS, PRINT_DEVICE_ONLINE_MS } from "@pos/shared/print-lifecycle";
import { PrintDevice } from "@/models/PrintDevice";

// Printing redesign, Phase 1 (spec §6.4, §10): the device heartbeat. It rides the agent's existing
// wake poll, and lease calls refresh it too, so it adds no request. Atlas M0 budget: at most ONE
// write per device per 30 s, however often the agent polls. Never calls connectDB(). No console.*.

export interface PrintDeviceBeat {
  deviceId: string;
  label: string;
  shell: PrintDeviceShell;
  capabilities: PrintDeviceCapabilities;
  appVersion?: string;
  nativeProtocol?: number;
}

/** The wake's heartbeat: creates the row on first sight, refreshes it at most every 30 s. */
export async function beatPrintDevice(beat: PrintDeviceBeat, nowMs: number): Promise<void> {
  try {
    await PrintDevice.updateOne(
      { deviceId: beat.deviceId, lastSeenAt: { $lt: new Date(nowMs - PRINT_DEVICE_HEARTBEAT_WRITE_MS) } },
      {
        $set: {
          label: beat.label,
          shell: beat.shell,
          capabilities: beat.capabilities,
          lastSeenAt: new Date(nowMs),
          ...(beat.appVersion !== undefined ? { appVersion: beat.appVersion } : {}),
          ...(beat.nativeProtocol !== undefined ? { nativeProtocol: beat.nativeProtocol } : {}),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // A fresh row exists, so the filter missed and the upsert hit the unique deviceId: nothing to write.
    if (!isDuplicateKeyError(error)) throw error;
  }
}

/** A lease counts as a heartbeat (spec §7.3) for a device the wake already knows. It never creates
 *  a row: label, shell and capabilities come only from the wake. */
export async function touchPrintDevice(deviceId: string, nowMs: number): Promise<void> {
  await PrintDevice.updateOne(
    { deviceId, lastSeenAt: { $lt: new Date(nowMs - PRINT_DEVICE_HEARTBEAT_WRITE_MS) } },
    { $set: { lastSeenAt: new Date(nowMs) } },
  );
}

/** Devices seen in the last 90 s. Never 0: it divides the cafe's one daily wake cap (spec §9.1). */
export async function countOnlineAgents(nowMs: number): Promise<number> {
  const online = await PrintDevice.countDocuments({ lastSeenAt: { $gte: new Date(nowMs - PRINT_DEVICE_ONLINE_MS) } });
  return Math.max(1, online);
}
```

Create `apps/cafe/lib/print-job-actions.ts`:

```ts
import type { PrintActionData } from "@pos/shared/print-agent-wire";
import { lifecycleOf, planConfirm, planRetry, type PrintJobDecision, type PrintJobLifecycle, type PrintJobPlan } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";

// Printing redesign, Phase 1 (spec §7.2, §7.3): the staff decisions. "Print again?" on a bill that
// may already be on paper (confirm), and Print again on a failed job or Print now on a stale one
// (retry). Allowed from any device that can see the job. Every write is one CAS through
// print-lease.ts. Never calls connectDB(). No console.*.

const ACTION_MAX_STEPS = 2;

async function act(id: string, decide: (job: PrintJobLifecycle) => PrintJobPlan): Promise<PrintActionData> {
  for (let step = 0; step < ACTION_MAX_STEPS; step++) {
    const row = await PrintJob.findById(id).select(PRINT_LIFECYCLE_SELECT).lean<PrintLifecycleRow>();
    if (row === null) return { applied: false, status: null, reason: "not-found" };
    const job = lifecycleOf(row);
    const plan = decide(job);
    if (!plan.ok) return { applied: false, status: job.status, reason: plan.reason };
    if (await applyPrintJobPlan(row._id, job, plan.patch)) {
      // Back in the queue: nudge the printing device, so it leases now rather than on its next poll.
      // Fire-and-forget; the poll still finds it if the nudge is lost.
      if (plan.patch.status === "queued") publishCafeEvent("print-job");
      return { applied: true, status: plan.patch.status };
    }
  }
  return { applied: false, status: null, reason: "raced" };
}

export function confirmPrintJob(input: { id: string; decision: PrintJobDecision; staff: string; nowMs: number }): Promise<PrintActionData> {
  return act(input.id, (job) => planConfirm(job, input.decision, input.staff, input.nowMs));
}

export function retryPrintJob(input: { id: string; nowMs: number }): Promise<PrintActionData> {
  return act(input.id, (job) => planRetry(job, input.nowMs));
}
```

Create `apps/cafe/lib/print-sweep.ts`:

```ts
import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import {
  PRINT_JOB_LOG_MAX,
  PRINT_MAX_ATTEMPTS,
  PRINT_MAX_UNCERTAIN_ATTEMPTS,
  PRINT_SWEEP_MIN_INTERVAL_MS,
  lifecycleOf,
  planExpiry,
  planLimits,
} from "@pos/shared/print-lifecycle";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { prunePrintJobsThrottled } from "./print-queue";

// Printing redesign, Phase 1 (spec §7.4): the sweep. It rides requests that already exist (the
// agents' wake now; the pulse from Session 1D), at most once per 60 s per server instance — NEVER
// Vercel Cron (Hobby allows one a day). Every step is idempotent, so a second instance sweeping in
// the same minute only repeats no-ops. Session 1B adds step 2b, re-creating missing jobs. Never
// calls connectDB(). No console.*.

/** Each sweep read takes at most this many rows; the rest wait for the next sweep. */
export const PRINT_SWEEP_BATCH = 20;

export interface PrintSweepResult {
  expired: number;
  requeued: number;
  retargeted: number;
  failed: number;
}

export async function sweepPrintJobs(nowMs: number): Promise<PrintSweepResult> {
  const result: PrintSweepResult = { expired: 0, requeued: 0, retargeted: 0, failed: 0 };

  // 1. Expire leases whose writer went quiet: the same as a "maybe sent" failure (§7.2).
  const leased = await PrintJob.find({ status: "leased", "lease.expiresAt": { $lt: new Date(nowMs) } })
    .select(PRINT_LIFECYCLE_SELECT)
    .limit(PRINT_SWEEP_BATCH)
    .lean<PrintLifecycleRow[]>();
  for (const row of leased) {
    const job = lifecycleOf(row);
    const plan = planExpiry(job, nowMs);
    if (plan.ok && (await applyPrintJobPlan(row._id, job, plan.patch))) {
      result.expired += 1;
      if (plan.patch.status === "queued") result.requeued += 1;
    }
  }

  // 2. Simple mode with a host prints everything at the CURRENT host (§6.6): rows from before Phase 1
  //    (no target), and rows aimed at a host that was since replaced.
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
  if (host !== null) {
    const moved = await PrintJob.updateMany(
      { status: "queued", targetDeviceId: { $ne: host.deviceId } },
      {
        $set: { targetDeviceId: host.deviceId },
        $push: { log: { $each: [{ at: new Date(nowMs), event: "retargeted", deviceId: host.deviceId }], $slice: -PRINT_JOB_LOG_MAX } },
      },
    );
    result.retargeted = moved.modifiedCount ?? 0;
  }

  // 3. Limits (§7.8). They are normally applied when acking; this catches anything that slipped past.
  const tired = await PrintJob.find({
    status: "queued",
    $or: [{ uncertainAttempts: { $gte: PRINT_MAX_UNCERTAIN_ATTEMPTS } }, { attempts: { $gte: PRINT_MAX_ATTEMPTS } }],
  })
    .select(PRINT_LIFECYCLE_SELECT)
    .limit(PRINT_SWEEP_BATCH)
    .lean<PrintLifecycleRow[]>();
  for (const row of tired) {
    const job = lifecycleOf(row);
    const plan = planLimits(job, nowMs);
    if (plan.ok && (await applyPrintJobPlan(row._id, job, plan.patch))) result.failed += 1;
  }

  // 4. Retention, unchanged (it keeps its own 5-minute throttle).
  await prunePrintJobsThrottled(nowMs);

  // A job back in the queue gets a nudge, so its device leases now (fire-and-forget; the poll is the safety net).
  if (result.requeued > 0 || result.retargeted > 0) publishCafeEvent("print-job");
  return result;
}

// Per-instance throttle state, like prunePrintJobsThrottled's: a cold start merely re-arms it.
let lastSweepAtMs = 0;

/** At most once per 60 s per instance. Best-effort: it never fails the request it rides on. */
export async function sweepPrintJobsThrottled(nowMs: number): Promise<void> {
  if (nowMs - lastSweepAtMs < PRINT_SWEEP_MIN_INTERVAL_MS) return;
  // Claimed BEFORE awaiting, so two overlapping requests cannot both pass the check.
  lastSweepAtMs = nowMs;
  try {
    await sweepPrintJobs(nowMs);
  } catch {
    // best-effort: the next sweep (≤ 60 s) retries; lazy expiry in the lease path covers the gap
  }
}
```

- [ ] **Step 4: Admit the sweep to the writer allow-list**

In `apps/cafe/lib/self-order-alert-paths.test.ts` test `e2`, change the allow-list line from Task 4 to:

```ts
  const EXPECTED_PRINT_JOB_WRITERS = [
    "apps/cafe/lib/print-lease.ts",
    "apps/cafe/lib/print-queue-claim.ts",
    "apps/cafe/lib/print-queue.ts",
    "apps/cafe/lib/print-sweep.ts",
  ].sort();
```

Then extend the comment above it with:

```ts
  // print-sweep.ts writes only through applyPrintJobPlan's CAS, plus one updateMany that retargets
  // QUEUED rows (never leased ones, so it cannot move a job out from under its writer).
```

- [ ] **Step 5: Run the pins, the type check and lint**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/self-order-alert-paths.test.ts && npx tsc --noEmit && npx eslint lib/print-device.ts lib/print-job-actions.ts lib/print-sweep.ts lib/print-lifecycle-paths.test.ts`
Expected: all pass; tsc 0; eslint 0 problems.

- [ ] **Step 6: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-device.ts apps/cafe/lib/print-job-actions.ts apps/cafe/lib/print-sweep.ts apps/cafe/lib/print-lifecycle-paths.test.ts apps/cafe/lib/self-order-alert-paths.test.ts apps/cafe/package.json
git commit -m "feat(print): device heartbeat, the cashier and Print again decisions, and the 60 s sweep (expire, retarget, limits)"
```

---

### Task 6: Request schemas and the lease / ack / confirm / retry routes

**Files:**
- Create: `apps/cafe/lib/print-lifecycle-schemas.ts`
- Create: `apps/cafe/app/api/print-jobs/lease/route.ts`
- Create: `apps/cafe/app/api/print-jobs/[id]/ack/route.ts`
- Create: `apps/cafe/app/api/print-jobs/[id]/confirm/route.ts`
- Create: `apps/cafe/app/api/print-jobs/[id]/retry/route.ts`
- Modify: `apps/cafe/lib/print-lifecycle-paths.test.ts` (one import; append tests)

**Interfaces:**
- Consumes: Task 4 `leasePrintJobs`, `ackPrintJob`; Task 5 `touchPrintDevice`, `confirmPrintJob`, `retryPrintJob`; `PRINT_HOST_DEVICE_ID_MAX_CHARS`, `PRINT_HOST_LABEL_MAX_CHARS` (`lib/print-host.ts`); `PRINT_HOST_TAB_ID_MAX_CHARS` (`lib/print-queue-claim.ts`).
- Produces: `wakeBeatBodySchema`, `leaseBodySchema`, `ackBodySchema`, `confirmBodySchema` from `@/lib/print-lifecycle-schemas`. Four routes (spec §7.3):

| Route | Body | 200 data |
|---|---|---|
| `POST /api/print-jobs/lease` | `{ deviceId, tabId }` | `PrintLeaseData` |
| `POST /api/print-jobs/[id]/ack` | `{ deviceId, epoch, outcome, sent?, permanent?, error? }` | `PrintAckData` (404 when the job is gone) |
| `POST /api/print-jobs/[id]/confirm` | `{ decision: "reprint" \| "printed" \| "dismiss" }` | `PrintActionData` (404 when gone) |
| `POST /api/print-jobs/[id]/retry` | none | `PrintActionData` (404 when gone) |

- [ ] **Step 1: Write the failing tests**

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, add below the `stripComments` import:

```ts
import { ackBodySchema, confirmBodySchema, leaseBodySchema, wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
```

Append:

```ts
// ── Task 6: request bodies and routes ────────────────────────────────────────

test("ackBodySchema: a printed ack carries no failure fields; a failed one must say whether anything was sent", () => {
  const ok = (body: unknown): boolean => ackBodySchema.safeParse(body).success;
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed" }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", sent: "no" }), false);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed" }), false, "sent is required on a failure (spec §7.5)");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "maybe", error: "WRITE_FAILED" }), true);
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "no", permanent: true }), true);
  assert.equal(ok({ deviceId: "d", epoch: 0, outcome: "printed" }), false, "epoch 0 was never leased");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "printed", extra: 1 }), false, "strict");
  assert.equal(ok({ deviceId: "d", epoch: 1, outcome: "failed", sent: "maybe", error: "x".repeat(201) }), false);
  assert.equal(ok({ deviceId: "", epoch: 1, outcome: "printed" }), false);
});

test("lease, confirm and wake bodies: required fields, enums and strictness", () => {
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d", tabId: "t" }).success, true);
  assert.equal(leaseBodySchema.safeParse({ deviceId: "d" }).success, false, "a tab id makes two windows on one PC distinguishable");
  for (const decision of ["reprint", "printed", "dismiss"]) assert.equal(confirmBodySchema.safeParse({ decision }).success, true, decision);
  assert.equal(confirmBodySchema.safeParse({ decision: "maybe" }).success, false);
  const beat = {
    deviceId: "d",
    label: "Counter PC",
    shell: "windows",
    capabilities: { lan: true, bluetooth: false, usb: false, windowsPrinters: true, webSerial: false, webBluetooth: false },
  };
  assert.equal(wakeBeatBodySchema.safeParse(beat).success, true);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, appVersion: "1.2.0", nativeProtocol: 1 }).success, true);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, shell: "ios" }).success, false);
  assert.equal(wakeBeatBodySchema.safeParse({ ...beat, capabilities: { ...beat.capabilities, fax: true } }).success, false, "strict capabilities");
});

const ROUTES = {
  lease: "apps/cafe/app/api/print-jobs/lease/route.ts",
  ack: "apps/cafe/app/api/print-jobs/[id]/ack/route.ts",
  confirm: "apps/cafe/app/api/print-jobs/[id]/confirm/route.ts",
  retry: "apps/cafe/app/api/print-jobs/[id]/retry/route.ts",
} as const;

test("PIN: every Phase 1 print route authenticates, is force-dynamic and no-store, and writes only through the lifecycle libs", () => {
  for (const [name, rel] of Object.entries(ROUTES)) {
    const s = src(rel);
    assert.match(s, /export const dynamic = "force-dynamic";/, name);
    assert.match(s, /const authed = await requireAuth\(\);\s*if \("error" in authed\) return authed\.error;/, name);
    assert.match(s, /await connectDB\(\);/, name);
    assert.match(s, /return noStore\(success\(/, name);
    assert.match(s, /noStore\(serverError\(/, name);
    assert.ok(!/PrintJob\./.test(s), `${name}: no model call in a route`);
    assert.ok(!s.includes("publishCafeEvent"), `${name}: nudges live in the libs (realtime-paths' print-route pin)`);
  }
  for (const name of ["ack", "confirm", "retry"] as const) {
    assert.match(src(ROUTES[name]), /if \(!mongoose\.isValidObjectId\(id\)\) return noStore\(failure\("Print job not found", 404\)\);/, name);
  }
});

test("PIN: each route calls its one lib, and a staff decision is stamped with the SESSION name, never a body field", () => {
  assert.match(src(ROUTES.lease), /leasePrintJobs\(\{/);
  assert.match(src(ROUTES.lease), /touchPrintDevice\(parsed\.data\.deviceId, nowMs\)/);
  assert.match(src(ROUTES.ack), /ackPrintJob\(\{ id, \.\.\.parsed\.data, nowMs: Date\.now\(\) \}\)/);
  assert.match(src(ROUTES.confirm), /staff: authed\.session\.user\.name \?\? UNNAMED_STAFF/);
  assert.match(src(ROUTES.retry), /retryPrintJob\(\{ id, nowMs: Date\.now\(\) \}\)/);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts`
Expected: FAIL with `Cannot find module '@/lib/print-lifecycle-schemas'`.

- [ ] **Step 3: Implement the schemas and routes**

Create `apps/cafe/lib/print-lifecycle-schemas.ts`:

```ts
import { z } from "zod";
import { PRINT_DEVICE_SHELLS } from "@pos/shared/print-agent-wire";
import { PRINT_ACK_ERROR_MAX_CHARS } from "@pos/shared/print-lifecycle";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS, PRINT_HOST_LABEL_MAX_CHARS } from "@/lib/print-host";
import { PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";

// Printing redesign, Phase 1 (spec §7.3): the agent's request bodies. They live in a lib file
// because a Next route file cannot export extra names, and the tests need them.

const deviceId = z.string().trim().min(1).max(PRINT_HOST_DEVICE_ID_MAX_CHARS);
const tabId = z.string().trim().min(1).max(PRINT_HOST_TAB_ID_MAX_CHARS);

/** POST /api/print-jobs/wake: the heartbeat (spec §10). */
export const wakeBeatBodySchema = z
  .object({
    deviceId,
    label: z.string().trim().min(1).max(PRINT_HOST_LABEL_MAX_CHARS),
    shell: z.enum(PRINT_DEVICE_SHELLS),
    capabilities: z
      .object({
        lan: z.boolean(),
        bluetooth: z.boolean(),
        usb: z.boolean(),
        windowsPrinters: z.boolean(),
        webSerial: z.boolean(),
        webBluetooth: z.boolean(),
      })
      .strict(),
    appVersion: z.string().trim().min(1).max(40).optional(),
    nativeProtocol: z.number().int().min(1).max(99).optional(),
  })
  .strict();

/** POST /api/print-jobs/lease. */
export const leaseBodySchema = z.object({ deviceId, tabId }).strict();

/** POST /api/print-jobs/[id]/ack. A printed ack says nothing else; a failed one must say whether
 *  any byte was sent (spec §7.5: "no" only when the writer KNOWS nothing reached the printer). */
export const ackBodySchema = z
  .object({
    deviceId,
    epoch: z.number().int().min(1),
    outcome: z.enum(["printed", "failed"]),
    sent: z.enum(["no", "maybe"]).optional(),
    permanent: z.literal(true).optional(),
    error: z.string().trim().max(PRINT_ACK_ERROR_MAX_CHARS).optional(),
  })
  .strict()
  .refine(
    (body) => (body.outcome === "printed" ? body.sent === undefined && body.permanent === undefined : body.sent !== undefined),
    { message: "A failed ack must say whether anything was sent; a printed ack carries no failure fields." },
  );

/** POST /api/print-jobs/[id]/confirm: the cashier's answer to "Print the bill again?". */
export const confirmBodySchema = z.object({ decision: z.enum(["reprint", "printed", "dismiss"]) }).strict();
```

Create `apps/cafe/app/api/print-jobs/lease/route.ts`:

```ts
import { connectDB } from "@/lib/db";
import { leasePrintJobs } from "@/lib/print-lease";
import { touchPrintDevice } from "@/lib/print-device";
import { leaseBodySchema } from "@/lib/print-lifecycle-schemas";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// Staff name fallback: a Mongoose required string refuses "" (memory mongoose-required-rejects-empty-string).
const UNNAMED_STAFF = "Staff";

// POST /api/print-jobs/lease (spec §7.3): the printing device leases the head of its own line, at
// most one job, for 90 s, with the payload. It also counts as a heartbeat. "Nothing to lease" is a
// normal 200 ({jobs: [], retryAt}); retryAt says when the head can next be leased.
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, leaseBodySchema);
  if ("error" in parsed) return parsed.error;

  const nowMs = Date.now();
  try {
    await connectDB();
    const [result] = await Promise.all([
      leasePrintJobs({
        deviceId: parsed.data.deviceId,
        tabId: parsed.data.tabId,
        dismissedBy: authed.session.user.name ?? UNNAMED_STAFF,
        nowMs,
      }),
      touchPrintDevice(parsed.data.deviceId, nowMs),
    ]);
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to lease print jobs", error));
  }
}
```

Create `apps/cafe/app/api/print-jobs/[id]/ack/route.ts`:

```ts
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { ackPrintJob } from "@/lib/print-lease";
import { ackBodySchema } from "@/lib/print-lifecycle-schemas";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/print-jobs/[id]/ack (spec §7.3, §7.9): the writer reports one leased attempt. The
// epoch fences it: a late ack still counts if nobody leased the job since, and is logged and
// ignored otherwise. A repeat of an applied ack answers applied:false with the current status, so
// an agent retrying its pending acks can stop as soon as it sees "printed".
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(failure("Print job not found", 404));

  const parsed = await validateBody(req, ackBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await ackPrintJob({ id, ...parsed.data, nowMs: Date.now() });
    if (result.reason === "not-found") return noStore(failure("Print job not found", 404));
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to record the print result", error));
  }
}
```

Create `apps/cafe/app/api/print-jobs/[id]/confirm/route.ts`:

```ts
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { confirmPrintJob } from "@/lib/print-job-actions";
import { confirmBodySchema } from "@/lib/print-lifecycle-schemas";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Staff name fallback: the decision is stamped as printedBy / dismissedBy (required strings).
const UNNAMED_STAFF = "Staff";

// POST /api/print-jobs/[id]/confirm (spec §7.2, §7.3): the cashier answers "Print the bill
// again?" for a bill that may already be on paper. Any logged-in device that sees the job may
// answer. A job not waiting for a decision is a normal 200 ({applied:false, reason:"wrong-status"}).
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(failure("Print job not found", 404));

  const parsed = await validateBody(req, confirmBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await confirmPrintJob({
      id,
      decision: parsed.data.decision,
      staff: authed.session.user.name ?? UNNAMED_STAFF,
      nowMs: Date.now(),
    });
    if (result.reason === "not-found") return noStore(failure("Print job not found", 404));
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to record the decision", error));
  }
}
```

Create `apps/cafe/app/api/print-jobs/[id]/retry/route.ts`:

```ts
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { retryPrintJob } from "@/lib/print-job-actions";
import { success, failure, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/print-jobs/[id]/retry (spec §7.2, §7.3): Print again on a failed job (labelled REPRINT
// or DUPLICATE if it may already have printed), or Print now on a queued job parked as stale.
export async function POST(_req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(failure("Print job not found", 404));

  try {
    await connectDB();
    const result = await retryPrintJob({ id, nowMs: Date.now() });
    if (result.reason === "not-found") return noStore(failure("Print job not found", 404));
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to retry the print job", error));
  }
}
```

- [ ] **Step 4: Run the tests, the type check and lint**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/realtime-paths.test.ts && npx tsc --noEmit && npx eslint lib/print-lifecycle-schemas.ts app/api/print-jobs`
Expected:
- all pass, including `realtime-paths`' "NEGATIVE PIN: no file under app/api/print* … calls broadcastCafeEvent", which now walks the four new routes too;
- tsc 0;
- eslint 0 problems.

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-lifecycle-schemas.ts apps/cafe/app/api/print-jobs/lease apps/cafe/app/api/print-jobs/[id]/ack apps/cafe/app/api/print-jobs/[id]/confirm apps/cafe/app/api/print-jobs/[id]/retry apps/cafe/lib/print-lifecycle-paths.test.ts
git commit -m "feat(print): lease, ack, confirm and retry routes for the print-job lifecycle"
```

---

### Task 7: Enqueue joins the lifecycle; the wake gains a POST heartbeat

**Files:**
- Modify: `apps/cafe/lib/print-queue.ts` (imports; `enqueuePrintJob` input, host read, key, create; `dismissPrintJob` filter; `prunePrintJobs` filter #1)
- Modify: `apps/cafe/app/api/print-jobs/route.ts` (two optional headers)
- Modify: `apps/cafe/app/api/print-jobs/wake/route.ts` (header comment; add POST after GET)
- Modify: `apps/cafe/lib/print-wake.test.ts` (route pin: GET-only body)
- Modify: `apps/cafe/lib/print-queue-fixes.test.ts` (the `prunePrintJobs` filter pin at line 413)
- Modify: `apps/cafe/lib/print-lifecycle-paths.test.ts` (append pins)

**Interfaces:**
- Consumes:
  - Task 1: `printJobLifecycleInit`, `printJobInitialLabels`, `printJobCreatedLog`, `PRINT_JOB_UNRESOLVED_STATUSES`.
  - Task 2: `PRINT_DEVICE_ID_HEADER`, `PRINT_IDEMPOTENCY_HEADER`, `PRINT_IDEMPOTENCY_KEY_PATTERN`, `printWakeAgentCap`, `PrintWakeBeatData`.
  - Task 4: `readJobsForDevice`. Task 5: `beatPrintDevice`, `countOnlineAgents`, `sweepPrintJobsThrottled`. Task 6: `wakeBeatBodySchema`.
- Produces:
  - `enqueuePrintJob(input: { payload; label; queuedBy; idempotencyKey?; originDeviceId?; nowMs? })`. The outcome contract is unchanged.
  - `POST /api/print-jobs/wake` → `PrintWakeBeatData`. `GET` is unchanged byte for byte.

- [ ] **Step 1: Write the failing pins**

Append to `apps/cafe/lib/print-lifecycle-paths.test.ts`:

```ts
// ── Task 7: enqueue, dismiss, prune, the wake POST ───────────────────────────

const QUEUE = "apps/cafe/lib/print-queue.ts";
const ENQUEUE_ROUTE = "apps/cafe/app/api/print-jobs/route.ts";
const WAKE_ROUTE = "apps/cafe/app/api/print-jobs/wake/route.ts";

test("PIN: enqueue stamps the host target, the lifecycle fields, the initial labels and the created log; a deliberate repeat dedupes on the client's Idempotency-Key", () => {
  const s = src(QUEUE);
  assert.match(s, /PrintHost\.findOne\(\{ key: PRINT_HOST_KEY \}\)\.select\("deviceId"\)\.lean\(\);\s*if \(!host\) return \{ outcome: "no-host" \};/);
  assert.match(s, /targetDeviceId: host\.deviceId,/);
  assert.match(s, /\.\.\.printJobLifecycleInit\(nowMs, printJobInitialLabels\(input\.payload\)\),/);
  assert.match(s, /log: \[printJobCreatedLog\(nowMs, input\.originDeviceId\)\],/);
  assert.match(s, /printJobKeyOf\(input\.payload\) \?\? \(input\.idempotencyKey !== undefined \? `reprint:\$\{input\.idempotencyKey\}` : undefined\)/);
});

test("PIN: dismiss never touches a leased job (its writer may be printing it); prune reaps every unresolved state after 12 h", () => {
  const s = src(QUEUE);
  assert.match(s, /status: \{ \$in: \["queued", "needs-confirm", "failed"\] \},/);
  assert.match(s, /status: \{ \$in: \[\.\.\.PRINT_JOB_UNRESOLVED_STATUSES\] \}, createdAt: \{ \$lt: queuedPruneCutoff\(nowMs\) \}/);
});

test("PIN: the enqueue route takes both Phase 1 headers as OPTIONAL (a tab from before Phase 1 sends neither) and validates each", () => {
  const s = src(ENQUEUE_ROUTE);
  assert.match(s, /const idempotencyKey = optionalHeader\(req, PRINT_IDEMPOTENCY_HEADER\);/);
  assert.match(s, /if \(idempotencyKey !== undefined && !PRINT_IDEMPOTENCY_KEY_PATTERN\.test\(idempotencyKey\)\)/);
  assert.match(s, /const originDeviceId = optionalHeader\(req, PRINT_DEVICE_ID_HEADER\);/);
  assert.match(s, /if \(originDeviceId !== undefined && originDeviceId\.length > PRINT_HOST_DEVICE_ID_MAX_CHARS\)/);
});

test("PIN: POST /api/print-jobs/wake beats, reads the device's line and the agent count, and sweeps AFTER the response", () => {
  const s = src(WAKE_ROUTE);
  const getAt = s.indexOf("export async function GET(");
  const postAt = s.indexOf("export async function POST(");
  assert.ok(getAt >= 0 && postAt > getAt, "GET first and unchanged, POST after it");
  inOrder(
    s.slice(postAt),
    [
      "validateBody(req, wakeBeatBodySchema)",
      "await connectDB();",
      "await beatPrintDevice(parsed.data, nowMs);",
      "readJobsForDevice(parsed.data.deviceId, nowMs)",
      "countOnlineAgents(nowMs)",
      "after(() => sweepPrintJobsThrottled(nowMs))",
      "return noStore(success(data));",
    ],
    "wake POST",
  );
  assert.ok(!/PrintJob\.|PrintDevice\./.test(s), "the route writes only through the libs");
});
```

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts`
Expected: the four new pins FAIL; every earlier pin passes.

- [ ] **Step 2: Enqueue, dismiss and prune join the lifecycle**

In `apps/cafe/lib/print-queue.ts`:

1. Add `PRINT_JOB_UNRESOLVED_STATUSES,` to the `@pos/shared/print-job` import list. Below that import, add:

```ts
import { printJobCreatedLog, printJobInitialLabels, printJobLifecycleInit } from "@pos/shared/print-lifecycle";
```

2. Replace the `enqueuePrintJob` signature:

```ts
export async function enqueuePrintJob(input: {
  payload: PrintJobPayload;
  label: string;
  queuedBy: string;
}): Promise<PrintJobEnqueueResult> {
```

with:

```ts
export async function enqueuePrintJob(input: {
  payload: PrintJobPayload;
  label: string;
  queuedBy: string;
  /** The client's Idempotency-Key: a deliberate repeat it starts (reprint, EOD, cancel notice)
   *  dedupes on it, so a retried POST is one job (spec §6.5 `reprint:<key>`). */
  idempotencyKey?: string;
  /** The device that asked (x-pos-device-id); its readback follows the job (spec §6.5). */
  originDeviceId?: string;
  nowMs?: number;
}): Promise<PrintJobEnqueueResult> {
```

3. Replace:

```ts
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("_id").lean();
  if (!host) return { outcome: "no-host" };

  const orderId = printJobOrderIdOf(input.payload);
  const jobKey = printJobKeyOf(input.payload);
```

with:

```ts
  // deviceId too: simple mode with a host (spec §6.6) leases every job to the host.
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
  if (!host) return { outcome: "no-host" };

  const orderId = printJobOrderIdOf(input.payload);
  // A deliberate repeat has no deterministic key; the client's Idempotency-Key collapses its retries.
  const jobKey =
    printJobKeyOf(input.payload) ?? (input.idempotencyKey !== undefined ? `reprint:${input.idempotencyKey}` : undefined);
  const nowMs = input.nowMs ?? Date.now();
```

4. In the `PrintJob.create({ … })` call, replace:

```ts
      ...(orderId !== undefined ? { orderId } : {}),
      ...(jobKey !== undefined ? { jobKey } : {}),
    });
```

with:

```ts
      ...(orderId !== undefined ? { orderId } : {}),
      ...(jobKey !== undefined ? { jobKey } : {}),
      // Phase 1 lifecycle (spec §6.5): leased by the host, acknowledged, retried. The legacy /claim
      // path ignores every one of these fields, so a tab from before Phase 1 still drains it.
      targetDeviceId: host.deviceId,
      ...(input.originDeviceId !== undefined ? { originDeviceId: input.originDeviceId } : {}),
      copyIndex: 0,
      ...printJobLifecycleInit(nowMs, printJobInitialLabels(input.payload)),
      log: [printJobCreatedLog(nowMs, input.originDeviceId)],
    });
```

5. In `dismissPrintJob`, replace:

```ts
      // Dropping this would let a staff dismiss race a resolved job back to
      // "dismissed", overwriting a real print/earlier dismiss.
      status: "queued",
```

with:

```ts
      // Dropping this would let a staff dismiss race a resolved job back to
      // "dismissed", overwriting a real print/earlier dismiss. Phase 1: every
      // parked or waiting state, but never "leased" — its writer may be printing
      // it right now (a dead writer's lease expires in 90 s, then it is dismissable).
      status: { $in: ["queued", "needs-confirm", "failed"] },
```

6. In `prunePrintJobs`, replace:

```ts
    await PrintJob.deleteMany({ status: "queued", createdAt: { $lt: queuedPruneCutoff(nowMs) } });
```

with:

```ts
    // Every unresolved state older than 12 h goes (a Friday KOT must not print Monday).
    await PrintJob.deleteMany({ status: { $in: [...PRINT_JOB_UNRESOLVED_STATUSES] }, createdAt: { $lt: queuedPruneCutoff(nowMs) } });
```

- [ ] **Step 3: The enqueue route reads the two optional headers**

In `apps/cafe/app/api/print-jobs/route.ts`, add these imports:

```ts
import { PRINT_DEVICE_ID_HEADER, PRINT_IDEMPOTENCY_HEADER, PRINT_IDEMPOTENCY_KEY_PATTERN } from "@pos/shared/print-agent-wire";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
```

Below `const UNNAMED_STAFF = "Staff";` add:

```ts
// A header that is absent or blank reads as not sent. An expression body on purpose:
// print-queue.test.ts requires every `return` in this file to go through noStore(.
const optionalHeader = (req: Request, name: string): string | undefined => req.headers.get(name)?.trim() || undefined;
```

Directly after the 64 KB check (`if (!printJobPayloadWithinCap(…)) { return noStore(failure("Print payload too large", 400)); }`), add:

```ts
  // Phase 1 (spec §7.3): a print the client starts carries an Idempotency-Key, so a retried POST is
  // one job; the asking device names itself, so its readback can follow the job. Both stay OPTIONAL
  // for one release: a tab from before Phase 1 sends neither and must keep printing.
  const idempotencyKey = optionalHeader(req, PRINT_IDEMPOTENCY_HEADER);
  if (idempotencyKey !== undefined && !PRINT_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return noStore(failure("Invalid Idempotency-Key", 400));
  }
  const originDeviceId = optionalHeader(req, PRINT_DEVICE_ID_HEADER);
  if (originDeviceId !== undefined && originDeviceId.length > PRINT_HOST_DEVICE_ID_MAX_CHARS) {
    return noStore(failure("Invalid device id", 400));
  }
```

Change the lib call to:

```ts
    const result = await enqueuePrintJob({
      payload: parsed.data.payload,
      label: parsed.data.label,
      queuedBy,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      ...(originDeviceId !== undefined ? { originDeviceId } : {}),
      nowMs,
    });
```

- [ ] **Step 4: The wake gains a POST**

In `apps/cafe/app/api/print-jobs/wake/route.ts`:

1. Replace the paragraph that starts `// READ-ONLY, always: no prune, no beat, no write, ever` with:

```ts
// GET is READ-ONLY, always: no prune, no beat, no write, ever — the same invariant pulse/route.ts
// pins for itself. Tabs from before Phase 1 keep polling it unchanged for one release.
//
// POST (Phase 1, spec §9.1, §10) is the new agent's wake. It carries the device heartbeat (at most one
// PrintDevice write per 30 s), answers jobsForMe + the online agent count (each agent's share of the
// cafe's one daily wake cap), and runs the sweep AFTER the response at most once per 60 s. That is
// the "sweep rides wake/pulse, never Cron" rule of spec §17.3, so it adds no request.
```

2. Replace the import block with:

```ts
import { after } from "next/server";
import { connectDB } from "@/lib/db";
import { printJobDrainHead } from "@/lib/print-queue-feeds";
import { readJobsForDevice } from "@/lib/print-lease";
import { beatPrintDevice, countOnlineAgents } from "@/lib/print-device";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { wakeBeatBodySchema } from "@/lib/print-lifecycle-schemas";
import { printWakeAgentCap, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";
```

3. Leave `export async function GET()` exactly as it is. Append after it:

```ts
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, wakeBeatBodySchema);
  if ("error" in parsed) return parsed.error;

  const nowMs = Date.now();
  try {
    await connectDB();
    await beatPrintDevice(parsed.data, nowMs);
    const [jobsForMe, agents] = await Promise.all([readJobsForDevice(parsed.data.deviceId, nowMs), countOnlineAgents(nowMs)]);
    try {
      after(() => sweepPrintJobsThrottled(nowMs));
    } catch {
      // no after() in this runtime — skip the sweep, keep the wake
    }
    const data: PrintWakeBeatData = {
      jobsForMe,
      agents,
      agentDailyCap: printWakeAgentCap(agents),
      serverNow: new Date(nowMs).toISOString(),
    };
    return noStore(success(data));
  } catch (error) {
    return noStore(serverError("Failed to read print queue state", error));
  }
}
```

- [ ] **Step 5: Update the pins this deliberately changes**

1. `apps/cafe/lib/print-wake.test.ts`, the route pin `PIN: app/api/print-jobs/wake/route.ts contains requireAuth, … (READ-ONLY: no prune, no beat, no write, ever)`. Rename it to `PIN: GET /api/print-jobs/wake stays READ-ONLY (requireAuth, connectDB, noStore(success(, printJobDrainHead(, force-dynamic — and no .find(, .aggregate(, prune, updateOne, findOneAndUpdate, deleteMany, deleteOne, insertMany, create( or beat, ever); the Phase 1 POST beside it is the only part that writes`. Replace its first line:

```ts
  const src = stripComments(readSrc(WAKE_ROUTE));
```

with:

```ts
  // Phase 1 (plan 2026-10-02-phase-1-lifecycle.md Task 7) adds a POST that beats and sweeps; the
  // banned needles below apply to the GET handler's own body, which must never change.
  const full = stripComments(readSrc(WAKE_ROUTE));
  const getAt = full.indexOf("export async function GET(");
  const postAt = full.indexOf("export async function POST(");
  assert.ok(getAt >= 0 && postAt > getAt, "GET is declared before the Phase 1 POST");
  const src = full.slice(getAt, postAt);
```

Then change the `force-dynamic` landmark to test `full` instead of `src`: `assert.match(full, /export const dynamic = "force-dynamic";/, …)`. Every other assertion and banned needle stays exactly as it is.

2. `apps/cafe/lib/print-queue-fixes.test.ts`, the test at line 413 (`PIN: prunePrintJobs calls PrintJob.deleteMany( exactly twice. Filter #1 (queued) fences on status:"queued" …`):
   - In its title, replace `Filter #1 (queued) fences on status:\"queued\" (dropping it would delete LIVE queued jobs on every enqueue)` with `Filter #1 (unresolved, Phase 1) fences on status:{$in:[...PRINT_JOB_UNRESOLVED_STATUSES]} (dropping it would delete LIVE printed jobs inside their 2 h readback window)`.
   - Replace line 424:

   ```ts
  assert.match(filter1, /status:\s*"queued"/, 'filter #1 must fence on status:"queued" — dropping it deletes live queued jobs on every enqueue');
   ```

   with:

   ```ts
  assert.match(filter1, /status:\s*\{\s*\$in:\s*\[\.\.\.PRINT_JOB_UNRESOLVED_STATUSES\]\s*\}/, "filter #1 must fence on the unresolved statuses (Phase 1) — dropping it deletes live printed jobs inside their 2 h readback window");
   ```
   - Every other assertion in the test stays as it is.

The review session ran the whole cafe chain against this plan's Session 1A code. These two pins (`print-wake` and `print-queue-fixes`) are the only existing pins it changes; every `print-queue.test.ts` dismiss pin still passes untouched.

- [ ] **Step 6: Run the print suites, the type check and lint**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-wake.test.ts lib/print-queue.test.ts lib/print-queue-fixes.test.ts lib/realtime-paths.test.ts lib/self-order-alert-paths.test.ts lib/print-routing.test.ts && npx tsc --noEmit && npm run lint 2>&1 | tail -4`
Expected:
- All pass.
- `realtime-paths` (13): `print-queue.ts` still calls `publishCafeEvent("print-job")` exactly 3 times.
- tsc 0.
- lint: 0 errors, plus the 2 old warnings in `lib/masters-blob.test.ts`.

Any other existing pin that fails here was pinning the text this task deliberately changed. Update it to the new text, keep its intent, and name it in Results.

- [ ] **Step 7: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-queue.ts apps/cafe/app/api/print-jobs/route.ts apps/cafe/app/api/print-jobs/wake/route.ts apps/cafe/lib/print-wake.test.ts apps/cafe/lib/print-queue-fixes.test.ts apps/cafe/lib/print-lifecycle-paths.test.ts
git commit -m "feat(print): enqueued jobs join the lifecycle (host target, labels, Idempotency-Key); the wake gains a heartbeat POST"
```

---

### Task 8: Live-Mongo legs q–x

**Files:**
- Create: `apps/cafe/scripts/print-host-live/lifecycle.ts` (helpers; legs q, r, s, t, u)
- Create: `apps/cafe/scripts/print-host-live/lifecycle-actions.ts` (legs v, w, x)
- Modify: `apps/cafe/scripts/verify-print-host-live.ts` (imports; `createIndexes`; run q–x after n)

**Interfaces:**
- Consumes everything from Tasks 3–7. From the harness: `check`, `resetCollections`, `seedPrintHost`, `seedRealOrder`, `baseOrderFields`, `backdatePrintJob`. From `@/lib/print-routing`: `kotPrintJob`, `billPrintJob`.
- Produces: `legQ … legX(nowMs: number): Promise<void>`.

These legs are the failing tests for the DB behaviour. Write them, run them against local mongod, and fix the *code* (never the leg) until they pass.

- [ ] **Step 1: Write the legs**

Create `apps/cafe/scripts/print-host-live/lifecycle.ts`:

```ts
/**
 * Phase 1 live legs (spec §13) — the print-job lifecycle against a REAL MongoDB: two tabs racing for
 * one head (q), lease expiry and late acks (r), stale-epoch acks (s), head-of-line parking (t), and
 * the sweep (u). Run by scripts/verify-print-host-live.ts AFTER legs a–n: the sweep arms
 * prunePrintJobsThrottled, which leg m must fire first.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { PRINT_LEASE_MS, printBackoffMs } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { PrintDevice } from "@/models/PrintDevice";
import { enqueuePrintJob } from "@/lib/print-queue";
import { ackPrintJob, leasePrintJobs } from "@/lib/print-lease";
import { retryPrintJob } from "@/lib/print-job-actions";
import { sweepPrintJobs } from "@/lib/print-sweep";
import { billPrintJob, kotPrintJob } from "@/lib/print-routing";
import { backdatePrintJob, baseOrderFields, check, resetCollections, seedPrintHost, seedRealOrder } from "./harness";

export const HOST = "live-host-device";
export const STAFF = "Live Leg";

export async function freshHost(nowMs: number): Promise<void> {
  await Promise.all([resetCollections(), PrintDevice.deleteMany({})]);
  await seedPrintHost({ deviceId: HOST, label: "Counter PC", setBy: STAFF, nowMs });
}

async function queued(job: { payload: Parameters<typeof enqueuePrintJob>[0]["payload"]; label: string }, nowMs: number): Promise<string> {
  const res = await enqueuePrintJob({ ...job, queuedBy: STAFF, nowMs });
  if (res.outcome !== "queued") throw new Error(`seed enqueue refused: ${res.outcome}`);
  return res.id;
}

export async function queueKot(nowMs: number): Promise<string> {
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  return queued(kotPrintJob(baseOrderFields({ _id: orderId }), 1), nowMs);
}

export async function queueBill(nowMs: number): Promise<string> {
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  return queued(billPrintJob(baseOrderFields({ _id: orderId }), { reprint: false }), nowMs);
}

export function lease(nowMs: number, tabId = "tab-a") {
  return leasePrintJobs({ deviceId: HOST, tabId, dismissedBy: STAFF, nowMs });
}

export function rowOf(id: string) {
  return PrintJob.findById(id).lean();
}

/** Raw driver write: Mongoose's timestamps would re-stamp updatedAt, and some legs fake old state. */
export async function setRaw(id: string, set: Record<string, unknown>): Promise<void> {
  await PrintJob.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: set });
}

const labelsOf = (row: { labels?: string[] } | null): string => JSON.stringify(row?.labels ?? []);

export async function legQ(nowMs: number): Promise<void> {
  console.log("\n(q) two tabs of the host race for the head of its line");
  await freshHost(nowMs);
  const id = await queueKot(nowMs);
  const [a, b] = await Promise.all([lease(nowMs, "tab-a"), lease(nowMs, "tab-b")]);
  const winners = [a, b].filter((r) => r.jobs.length === 1);
  check("(q) exactly one tab wins the lease", winners.length === 1);
  check("(q) the winner holds epoch 1 of that job", winners[0]?.jobs[0]?.id === id && winners[0]?.jobs[0]?.epoch === 1);
  const loser = [a, b].find((r) => r.jobs.length === 0);
  check("(q) the loser is told when the lease ends", loser?.retryAt === new Date(nowMs + PRINT_LEASE_MS).toISOString());
  const row = await rowOf(id);
  check("(q) the job is leased once: attempts 1, epoch 1", row?.status === "leased" && row?.attempts === 1 && row?.epoch === 1);
}

export async function legR(nowMs: number): Promise<void> {
  console.log("\n(r) a host killed mid-job: the lease expires, and a late ack still counts");
  await freshHost(nowMs);
  const kot = await queueKot(nowMs);
  await lease(nowMs);
  const later = nowMs + PRINT_LEASE_MS + 1;
  const again = await lease(later, "tab-b");
  check("(r) the expired KOT waits out its backoff before it is handed out again", again.jobs.length === 0 && again.retryAt === new Date(later + printBackoffMs(1)).toISOString());
  let row = await rowOf(kot);
  check("(r) an expired KOT is queued again with REPRINT", row?.status === "queued" && row?.uncertainAttempts === 1 && labelsOf(row) === '["REPRINT"]' && row?.lease === undefined);
  const late = await ackPrintJob({ id: kot, deviceId: HOST, epoch: 1, outcome: "printed", nowMs: later + 1_000 });
  row = await rowOf(kot);
  check("(r) a late printed ack for epoch 1 still resolves it (nobody leased it since)", late.applied && row?.status === "printed" && (row?.log ?? []).some((e) => e.event === "late-ack"));

  const bill = await queueBill(nowMs);
  await lease(nowMs);
  const swept = await sweepPrintJobs(later);
  let billRow = await rowOf(bill);
  check("(r) the sweep expires a bill lease into needs-confirm, never a silent reprint", swept.expired === 1 && billRow?.status === "needs-confirm");
  const lateBill = await ackPrintJob({ id: bill, deviceId: HOST, epoch: 1, outcome: "printed", nowMs: later + 1_000 });
  billRow = await rowOf(bill);
  check("(r) a late ack resolves the cashier prompt by itself", lateBill.applied && billRow?.status === "printed");
}

export async function legS(nowMs: number): Promise<void> {
  console.log("\n(s) an ack from an attempt that was leased again is ignored, but logged");
  await freshHost(nowMs);
  const id = await queueKot(nowMs);
  await lease(nowMs);
  const t1 = nowMs + PRINT_LEASE_MS + 1;
  await sweepPrintJobs(t1);
  const t2 = t1 + printBackoffMs(1);
  const second = await lease(t2, "tab-b");
  check("(s) the second attempt is epoch 2 and carries REPRINT", second.jobs[0]?.id === id && second.jobs[0]?.epoch === 2 && second.jobs[0]?.labels.includes("REPRINT") === true);
  const stale = await ackPrintJob({ id, deviceId: HOST, epoch: 1, outcome: "printed", nowMs: t2 + 1 });
  let row = await rowOf(id);
  check("(s) the epoch-1 ack changes nothing", !stale.applied && stale.reason === "stale-epoch" && row?.status === "leased" && row?.epoch === 2);
  check("(s) … but it is in the log", (row?.log ?? []).some((e) => e.event === "late-ack" && (e.detail ?? "").startsWith("ignored")));
  const fresh = await ackPrintJob({ id, deviceId: HOST, epoch: 2, outcome: "printed", nowMs: t2 + 2 });
  const dup = await ackPrintJob({ id, deviceId: HOST, epoch: 2, outcome: "printed", nowMs: t2 + 3 });
  row = await rowOf(id);
  check("(s) the epoch-2 ack prints it; a repeat answers 'already printed'", fresh.applied && !dup.applied && dup.reason === "resolved" && dup.status === "printed" && row?.status === "printed");
}

export async function legT(nowMs: number): Promise<void> {
  console.log("\n(t) head of line: parked jobs never block; a job in backoff holds the line");
  await freshHost(nowMs);
  const bill = await queueBill(nowMs);
  const kot = await queueKot(nowMs);
  await lease(nowMs);
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: 1, outcome: "failed", sent: "maybe", nowMs });
  const next = await lease(nowMs);
  check("(t) a bill waiting for the cashier does not block the KOT behind it", (await rowOf(bill))?.status === "needs-confirm" && next.jobs[0]?.id === kot);

  await freshHost(nowMs);
  const first = await queueKot(nowMs);
  await queueKot(nowMs);
  await lease(nowMs);
  const refused = await ackPrintJob({ id: first, deviceId: HOST, epoch: 1, outcome: "failed", sent: "no", error: "NOT_CONNECTED", nowMs });
  const blocked = await lease(nowMs + 1);
  check("(t) a refusal before any byte requeues the same KOT after 2 s", refused.applied && refused.nextAttemptAt === new Date(nowMs + printBackoffMs(1)).toISOString());
  check("(t) … and while it waits, the KOT behind it does not overtake it", blocked.jobs.length === 0 && blocked.retryAt === refused.nextAttemptAt);
  const retried = await lease(nowMs + printBackoffMs(1));
  check("(t) the same KOT is leased again first, epoch 2, with no label (nothing was sent)", retried.jobs[0]?.id === first && retried.jobs[0]?.epoch === 2 && retried.jobs[0]?.labels.length === 0);

  await freshHost(nowMs);
  const old = await queueKot(nowMs);
  await backdatePrintJob(old, new Date(nowMs - PRINT_HOST_MAX_AGE_MS - 60_000));
  const fresh = await queueKot(nowMs);
  const skip = await lease(nowMs);
  check("(t) a 31-minute-old KOT is parked as stale: the fresh one prints", skip.jobs[0]?.id === fresh);
  await ackPrintJob({ id: fresh, deviceId: HOST, epoch: 1, outcome: "printed", nowMs });
  check("(t) the stale KOT stays parked without a tap", (await lease(nowMs)).jobs.length === 0);
  const tapped = await retryPrintJob({ id: old, nowMs });
  const now = await lease(nowMs + 1);
  check("(t) Print now makes it leasable", tapped.applied && now.jobs[0]?.id === old);
}

export async function legU(nowMs: number): Promise<void> {
  console.log("\n(u) the sweep: expiry, retargeting to the current host, limits");
  await freshHost(nowMs);
  const dead = await queueKot(nowMs);
  await lease(nowMs);
  // A row from before Phase 1: no target, no counters, no log.
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const legacy = kotPrintJob(baseOrderFields({ _id: orderId }), 1);
  const inserted = await PrintJob.collection.insertOne({
    kind: "kot",
    status: "queued",
    payload: JSON.stringify(legacy.payload),
    label: legacy.label,
    queuedBy: STAFF,
    orderId,
    jobKey: `kot:${orderId}:1`,
    createdAt: new Date(nowMs - 1_000),
    updatedAt: new Date(nowMs - 1_000),
  });
  const legacyId = String(inserted.insertedId);
  const replaced = await queueKot(nowMs);
  await setRaw(replaced, { targetDeviceId: "replaced-host" });
  const tired = await queueKot(nowMs);
  await setRaw(tired, { uncertainAttempts: 3 });

  const at = nowMs + PRINT_LEASE_MS + 1;
  const swept = await sweepPrintJobs(at);
  check("(u) the dead writer's lease expires", swept.expired === 1 && swept.requeued === 1 && (await rowOf(dead))?.status === "queued");
  const legacyRow = await rowOf(legacyId);
  check("(u) a row from before Phase 1 and a row aimed at a replaced host now target the current host", swept.retargeted === 2 && legacyRow?.targetDeviceId === HOST && (await rowOf(replaced))?.targetDeviceId === HOST);
  check("(u) a job over its limits is failed, never retried forever", swept.failed === 1 && (await rowOf(tired))?.status === "failed");
  const adopted = await lease(at + 1);
  check("(u) the adopted legacy row is leased like any other (it is the oldest)", adopted.jobs[0]?.id === legacyId && adopted.jobs[0]?.epoch === 1);
}
```

Create `apps/cafe/scripts/print-host-live/lifecycle-actions.ts`:

```ts
/**
 * Phase 1 live legs, part 2: the device heartbeat (v), the cashier's and staff decisions (w), and
 * Idempotency-Key enqueues (x). See lifecycle.ts for the run order.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PrintJob } from "@/models/PrintJob";
import { PrintDevice } from "@/models/PrintDevice";
import { enqueuePrintJob } from "@/lib/print-queue";
import { ackPrintJob } from "@/lib/print-lease";
import { confirmPrintJob, retryPrintJob } from "@/lib/print-job-actions";
import { beatPrintDevice, countOnlineAgents, touchPrintDevice } from "@/lib/print-device";
import { billPrintJob, kotPrintJob } from "@/lib/print-routing";
import { baseOrderFields, check, seedRealOrder } from "./harness";
import { HOST, STAFF, freshHost, lease, queueBill, queueKot, rowOf } from "./lifecycle";

export async function legV(nowMs: number): Promise<void> {
  console.log("\n(v) the device heartbeat writes at most once per 30 s");
  await PrintDevice.deleteMany({});
  const beat = {
    deviceId: "live-tablet",
    label: "Kitchen tablet",
    shell: "android" as const,
    capabilities: { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false },
    appVersion: "1.0.0",
    nativeProtocol: 1,
  };
  await beatPrintDevice(beat, nowMs);
  await beatPrintDevice({ ...beat, label: "Renamed" }, nowMs + 1_000);
  let row = await PrintDevice.findOne({ deviceId: "live-tablet" }).lean();
  check("(v) a second beat within 30 s writes nothing, and does not throw", row?.label === "Kitchen tablet" && row?.lastSeenAt.getTime() === nowMs);
  await beatPrintDevice({ ...beat, label: "Renamed" }, nowMs + 31_000);
  row = await PrintDevice.findOne({ deviceId: "live-tablet" }).lean();
  check("(v) a beat after 30 s refreshes the row", row?.label === "Renamed" && row?.lastSeenAt.getTime() === nowMs + 31_000);
  await beatPrintDevice({ ...beat, deviceId: "live-pc", shell: "windows" }, nowMs + 31_000);
  check("(v) two devices seen in the last 90 s count as two agents", (await countOnlineAgents(nowMs + 31_000)) === 2);
  await touchPrintDevice("live-pc", nowMs + 70_000);
  check("(v) a lease refreshes a known device", (await PrintDevice.findOne({ deviceId: "live-pc" }).lean())?.lastSeenAt.getTime() === nowMs + 70_000);
  await touchPrintDevice("live-unknown", nowMs + 70_000);
  check("(v) a lease never creates a device row", (await PrintDevice.countDocuments({ deviceId: "live-unknown" })) === 0);
  check("(v) with nobody online the count is still 1 (it divides the wake cap)", (await countOnlineAgents(nowMs + 600_000)) === 1);
}

export async function legW(nowMs: number): Promise<void> {
  console.log("\n(w) the cashier's decision and Print again");
  await freshHost(nowMs);
  const bill = await queueBill(nowMs);
  await lease(nowMs);
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: 1, outcome: "failed", sent: "maybe", error: "paper jam", nowMs });
  let row = await rowOf(bill);
  check("(w) a bill that may have printed waits for the cashier", row?.status === "needs-confirm" && row?.lastError === "paper jam");
  const again = await confirmPrintJob({ id: bill, decision: "reprint", staff: STAFF, nowMs: nowMs + 1 });
  row = await rowOf(bill);
  check("(w) 'Print again' queues it with DUPLICATE, counters reset, approved", again.applied && row?.status === "queued" && JSON.stringify(row?.labels) === '["DUPLICATE"]' && row?.attempts === 0 && row?.approvedAt !== undefined);
  const second = await lease(nowMs + 2);
  check("(w) the DUPLICATE copy is leased next, epoch 2", second.jobs[0]?.id === bill && second.jobs[0]?.epoch === 2 && second.jobs[0]?.labels.includes("DUPLICATE") === true);
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: 2, outcome: "failed", sent: "maybe", nowMs: nowMs + 3 });
  const said = await confirmPrintJob({ id: bill, decision: "printed", staff: STAFF, nowMs: nowMs + 4 });
  row = await rowOf(bill);
  check("(w) 'It printed' resolves it, stamped with the cashier", said.applied && row?.status === "printed" && row?.printedBy === STAFF);
  const late = await confirmPrintJob({ id: bill, decision: "dismiss", staff: STAFF, nowMs: nowMs + 5 });
  check("(w) a decision on a job that is not waiting for one is refused", !late.applied && late.reason === "wrong-status");

  const other = await queueBill(nowMs);
  await lease(nowMs + 6);
  await ackPrintJob({ id: other, deviceId: HOST, epoch: 1, outcome: "failed", sent: "maybe", nowMs: nowMs + 7 });
  await confirmPrintJob({ id: other, decision: "dismiss", staff: STAFF, nowMs: nowMs + 8 });
  const dropped = await rowOf(other);
  check("(w) 'Dismiss' ends it as the cashier's", dropped?.status === "dismissed" && dropped?.dismissReason === "cashier" && dropped?.dismissedBy === STAFF);

  const kot = await queueKot(nowMs);
  await lease(nowMs + 9);
  await ackPrintJob({ id: kot, deviceId: HOST, epoch: 1, outcome: "failed", sent: "maybe", permanent: true, error: "TOO_LARGE", nowMs: nowMs + 10 });
  check("(w) a permanent error fails the job at once", (await rowOf(kot))?.status === "failed");
  const retried = await retryPrintJob({ id: kot, nowMs: nowMs + 11 });
  row = await rowOf(kot);
  check("(w) Print again requeues it with REPRINT (it may have printed), counters reset", retried.applied && row?.status === "queued" && JSON.stringify(row?.labels) === '["REPRINT"]' && row?.attempts === 0 && row?.uncertainAttempts === 0);
}

export async function legX(nowMs: number): Promise<void> {
  console.log("\n(x) a client-started repeat dedupes on its Idempotency-Key and carries its label");
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const reprint = billPrintJob(baseOrderFields({ _id: orderId }), { reprint: true });
  const key = "live-key-0001-bill";
  const first = await enqueuePrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: key, originDeviceId: "live-order-phone", nowMs });
  const retry = await enqueuePrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: key, originDeviceId: "live-order-phone", nowMs });
  const firstId = first.outcome === "queued" ? first.id : null;
  check("(x) a retried reprint with the same key is one job", firstId !== null && retry.outcome === "queued" && retry.duplicate && retry.id === firstId);
  const row = await PrintJob.findOne({ jobKey: `reprint:${key}` }).lean();
  check("(x) it carries DUPLICATE, the host as target, and the asking device", JSON.stringify(row?.labels) === '["DUPLICATE"]' && row?.targetDeviceId === HOST && row?.originDeviceId === "live-order-phone" && row?.log?.[0]?.event === "created");
  const tapAgain = await enqueuePrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: "live-key-0002-bill", nowMs });
  check("(x) a second tap (a new key) is a second copy", tapAgain.outcome === "queued" && tapAgain.id !== firstId);
  const tab = kotPrintJob(baseOrderFields({ _id: orderId }), null);
  const kotReprint = await enqueuePrintJob({ ...tab, queuedBy: STAFF, idempotencyKey: "live-key-0003-kot", nowMs });
  const kotRow = kotReprint.outcome === "queued" ? await rowOf(kotReprint.id) : null;
  check("(x) a whole-tab KOT reprint carries REPRINT", JSON.stringify(kotRow?.labels) === '["REPRINT"]');
}
```

In `apps/cafe/scripts/verify-print-host-live.ts`:

1. Add the imports:

```ts
import { PrintDevice } from "@/models/PrintDevice";
import { legQ, legR, legS, legT, legU } from "./print-host-live/lifecycle";
import { legV, legW, legX } from "./print-host-live/lifecycle-actions";
```

2. Change the index line to:

```ts
  await Promise.all([PrintJob.createIndexes(), PrintHost.createIndexes(), Order.createIndexes(), PrintDevice.createIndexes()]);
```

3. Directly after `await legN(Date.now());` add:

```ts
    // Phase 1 lifecycle legs (plan 2026-10-02-phase-1-lifecycle.md Task 8). They run AFTER leg m,
    // because the sweep arms the prune throttle that leg m must fire first.
    await legQ(Date.now());
    await legR(Date.now());
    await legS(Date.now());
    await legT(Date.now());
    await legU(Date.now());
    await legV(Date.now());
    await legW(Date.now());
    await legX(Date.now());
```

- [ ] **Step 2: Run the live legs**

Check that the local mongod answers: `netstat -ano | grep LISTEN | grep ":27017 "` (expected: one line, `mongod`).

Run: `cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | tail -60`
Expected:
- every line is `ok`;
- the last line reads `157 passed, 0 failed` (115 checks from legs a–n plus the 42 new ones; the review session ran exactly this code against local mongod on 2026-10-02).

The script drops its own `pos_scratch_print_host` database at start and end.

If a leg fails, read the leg as the specification and fix `lib/` code. Change a leg only if it contradicts spec §7. Record any such change, and why, in Results.

- [ ] **Step 3: Type check and commit**

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint scripts/print-host-live/lifecycle.ts scripts/print-host-live/lifecycle-actions.ts scripts/verify-print-host-live.ts`
Expected: tsc 0; eslint 0 errors (`console.*` is intentional in these ops scripts, exactly as in the existing legs).

```bash
cd /d/kd/lucifer
git add apps/cafe/scripts/print-host-live/lifecycle.ts apps/cafe/scripts/print-host-live/lifecycle-actions.ts apps/cafe/scripts/verify-print-host-live.ts
git commit -m "test(print): live legs for the lifecycle: lease race, expiry, late and stale acks, parking, sweep, heartbeat, decisions"
```

---

### Task 9: The fake ESC/POS LAN printer (spec §13)

**Files:**
- Create: `scripts/fake-escpos-printer.mjs`
- Create: `scripts/fake-escpos-printer.test.mjs`
- Modify: `package.json` (repo root: add the `test:print-tools` script)

**Interfaces:**
- Produces, as exports of the `.mjs` module for its test: `DLE`, `EOT`, `parseArgs(argv)`, `statusByte(n, state)`, `statusRequests(bytes)`, and `startFakePrinter(opts, onJob?): net.Server`.
- The CLI: `node scripts/fake-escpos-printer.mjs [--port 9100] [--host 127.0.0.1] [--out <dir>] [--drop-after <bytes>] [--delay <ms>] [--paper-out] [--cover-open] [--refuse]`.
- The default `--out` is `<os tmpdir>/fake-escpos-printer`, never inside the repo. Sessions 1C–1E pass a scratchpad folder.

- [ ] **Step 1: Write the failing test**

Create `scripts/fake-escpos-printer.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { DLE, EOT, parseArgs, startFakePrinter, statusByte, statusRequests } from "./fake-escpos-printer.mjs";

async function withPrinter(flags, run) {
  const out = mkdtempSync(path.join(os.tmpdir(), "fake-escpos-test-"));
  const waiters = [];
  const server = startFakePrinter({ ...parseArgs(flags), port: 0, out }, (job) => waiters.shift()?.(job));
  await new Promise((resolve) => server.once("listening", resolve));
  const nextJob = () => new Promise((resolve) => waiters.push(resolve));
  try {
    await run({ port: server.address().port, out, nextJob });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(out, { recursive: true, force: true });
  }
}

function send(port, bytes) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    const received = [];
    let failed = false;
    socket.on("data", (d) => received.push(d));
    socket.on("error", () => (failed = true));
    socket.on("close", () => resolve({ received: Buffer.concat(received), failed }));
    socket.on("connect", () => socket.write(bytes, () => socket.end()));
  });
}

test("parseArgs: safe defaults (loopback, a temp folder) and every flag", () => {
  const d = parseArgs([]);
  assert.equal(d.port, 9100);
  assert.equal(d.host, "127.0.0.1", "never listens on the LAN unless asked");
  assert.ok(d.out.startsWith(os.tmpdir()), "jobs never land in the repo by default");
  const f = parseArgs(["--port", "9101", "--drop-after", "100", "--delay", "50", "--paper-out", "--cover-open", "--refuse"]);
  assert.deepEqual([f.port, f.dropAfter, f.delay, f.paperOut, f.coverOpen, f.refuse], [9101, 100, 50, true, true, true]);
  assert.throws(() => parseArgs(["--bogus"]), /unknown option/);
  assert.throws(() => parseArgs(["--drop-after", "-1"]), /whole number/);
});

test("statusByte: a healthy printer answers 0x12; paper-out and cover-open set the Epson DLE EOT bits", () => {
  const ok = { paperOut: false, coverOpen: false };
  assert.deepEqual([1, 2, 3, 4].map((n) => statusByte(n, ok)), [0x12, 0x12, 0x12, 0x12]);
  assert.equal(statusByte(4, { paperOut: true, coverOpen: false }), 0x72, "n=4: roll paper end");
  assert.equal(statusByte(2, { paperOut: false, coverOpen: true }), 0x16, "n=2: cover open");
  assert.equal(statusByte(1, { paperOut: true, coverOpen: false }), 0x1a, "n=1: offline");
  assert.equal(statusByte(9, ok), null);
});

test("statusRequests: finds DLE EOT n, including one split across two chunks", () => {
  const a = statusRequests(Buffer.from([0x41, DLE, EOT, 4, 0x42, DLE]));
  assert.deepEqual(a.requests, [4]);
  const b = statusRequests(Buffer.concat([a.carry, Buffer.from([EOT, 2])]));
  assert.deepEqual(b.requests, [2]);
  assert.equal(b.carry.length, 0);
});

test("a whole job is saved, with a jobs.log line", async () => {
  await withPrinter([], async ({ port, out, nextJob }) => {
    const job = nextJob();
    await send(port, Buffer.alloc(1_000, 0x55));
    const record = await job;
    assert.equal(record.bytes, 1_000);
    assert.equal(record.dropped, false);
    assert.equal(statSync(record.file).size, 1_000);
    const line = JSON.parse(readFileSync(path.join(out, "jobs.log"), "utf8").trim());
    assert.equal(line.bytes, 1_000);
  });
});

test("--drop-after: the connection is cut mid-job and only the first N bytes are on 'paper'", async () => {
  await withPrinter(["--drop-after", "100"], async ({ port, nextJob }) => {
    const job = nextJob();
    await send(port, Buffer.alloc(64_000, 0x55));
    const record = await job;
    assert.equal(record.dropped, true);
    assert.equal(record.bytes, 100);
    assert.equal(statSync(record.file).size, 100);
  });
});

test("--paper-out: DLE EOT 4 is answered at once with 'paper end'", async () => {
  await withPrinter(["--paper-out"], async ({ port, nextJob }) => {
    const job = nextJob();
    const { received } = await send(port, Buffer.from([DLE, EOT, 4]));
    assert.deepEqual([...received], [0x72]);
    assert.equal((await job).statusRequests, 1);
  });
});

test("--refuse: every connection is reset as it opens, and nothing is saved", async () => {
  await withPrinter(["--refuse"], async ({ port, nextJob }) => {
    const job = nextJob();
    await send(port, Buffer.alloc(10, 0x55));
    const record = await job;
    assert.equal(record.refused, true);
    assert.equal(record.file, null);
  });
});
```

In the repo-root `package.json` `scripts`, add this line directly after the `"test:go-live": …` line:

```json
    "test:print-tools": "node --test scripts/fake-escpos-printer.test.mjs",
```

Run: `cd /d/kd/lucifer && npm run test:print-tools`
Expected: FAIL with `Cannot find module …/scripts/fake-escpos-printer.mjs`.

- [ ] **Step 2: Implement the tool**

Create `scripts/fake-escpos-printer.mjs`:

```js
#!/usr/bin/env node
// A fake ESC/POS LAN printer (spec §13), to test the network print path end to end without hardware.
// Node only, no dependencies. A test tool: nothing here ships to a cafe.
//
//   node scripts/fake-escpos-printer.mjs [--port 9100] [--host 127.0.0.1] [--out <dir>]
//                                        [--drop-after <bytes>] [--delay <ms>]
//                                        [--paper-out] [--cover-open] [--refuse]
//
// The Android emulator reaches it at 10.0.2.2:<port>, the Windows app at 127.0.0.1:<port>. A phone on
// the shop Wi-Fi needs --host 0.0.0.0. Every connection is one job: its bytes go to
// <out>/<time>-<n>.bin and one JSON line to <out>/jobs.log. DLE EOT n (0x10 0x04 n) is answered at
// once, as a real printer answers its real-time status command.
//
//   --drop-after N  cut the connection after N bytes of a job (a slip cut off mid-way: "maybe sent")
//   --delay MS      read nothing for MS after a connection opens (a slow or busy printer)
//   --paper-out     DLE EOT reports "paper end"      --cover-open  DLE EOT reports "cover open"
//   --refuse        reset every connection as it opens (the printer accepts nothing)
// To test "cannot connect" (nothing listening at all), stop this script.

import net from "node:net";
import os from "node:os";
import path from "node:path";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DLE = 0x10;
export const EOT = 0x04;

export function parseArgs(argv) {
  const opts = {
    port: 9100,
    host: "127.0.0.1",
    out: path.join(os.tmpdir(), "fake-escpos-printer"),
    dropAfter: null,
    delay: 0,
    paperOut: false,
    coverOpen: false,
    refuse: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    const whole = () => {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} needs a whole number`);
      return n;
    };
    switch (flag) {
      case "--port": opts.port = whole(); break;
      case "--host": opts.host = value(); break;
      case "--out": opts.out = path.resolve(value()); break;
      case "--drop-after": opts.dropAfter = whole(); break;
      case "--delay": opts.delay = whole(); break;
      case "--paper-out": opts.paperOut = true; break;
      case "--cover-open": opts.coverOpen = true; break;
      case "--refuse": opts.refuse = true; break;
      default: throw new Error(`unknown option ${flag}`);
    }
  }
  return opts;
}

/** The byte a printer answers DLE EOT n with (Epson ESC/POS: bits 1 and 4 are always set). */
export function statusByte(n, state) {
  const BASE = 0x12;
  switch (n) {
    case 1: return BASE | (state.paperOut || state.coverOpen ? 0x08 : 0); // bit 3: offline
    case 2: return BASE | (state.coverOpen ? 0x04 : 0) | (state.paperOut ? 0x20 : 0); // bit 2: cover open; bit 5: paper end
    case 3: return BASE; // no error
    case 4: return BASE | (state.paperOut ? 0x60 : 0); // bits 5–6: roll paper end
    default: return null;
  }
}

/** The DLE EOT n requests in `bytes`. A request may straddle two chunks: `carry` is the unfinished
 *  tail (DLE, or DLE EOT) to put in front of the next chunk. */
export function statusRequests(bytes) {
  const requests = [];
  let i = 0;
  let consumed = 0;
  while (i + 2 < bytes.length) {
    if (bytes[i] === DLE && bytes[i + 1] === EOT) {
      requests.push(bytes[i + 2]);
      i += 3;
      consumed = i;
    } else {
      i += 1;
    }
  }
  const n = bytes.length;
  let carry = Buffer.alloc(0);
  if (n - 2 >= consumed && n >= 2 && bytes[n - 2] === DLE && bytes[n - 1] === EOT) carry = bytes.subarray(n - 2);
  else if (n - 1 >= consumed && n >= 1 && bytes[n - 1] === DLE) carry = bytes.subarray(n - 1);
  return { requests, carry };
}

export function startFakePrinter(opts, onJob = () => {}) {
  mkdirSync(opts.out, { recursive: true });
  let seq = 0;
  const server = net.createServer((socket) => {
    const n = ++seq;
    const at = new Date();
    const record = { n, at: at.toISOString(), peer: `${socket.remoteAddress}:${socket.remotePort}`, bytes: 0, dropped: false, refused: false, statusRequests: 0 };
    const chunks = [];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const name = `${at.toISOString().replace(/[:.]/g, "-")}-${n}.bin`;
      const file = record.refused ? null : path.join(opts.out, name);
      if (file !== null) writeFileSync(file, Buffer.concat(chunks));
      appendFileSync(path.join(opts.out, "jobs.log"), `${JSON.stringify({ ...record, file: file === null ? null : name })}\n`);
      console.log(`job ${n}: ${record.bytes} bytes${record.dropped ? " (dropped)" : ""}${record.refused ? " (refused)" : ""}`);
      onJob({ ...record, file });
    };
    socket.on("error", () => {}); // a reset from either side is a normal end of a job here
    socket.on("close", finish);
    if (opts.refuse) {
      record.refused = true;
      socket.resetAndDestroy();
      return;
    }
    let carry = Buffer.alloc(0);
    if (opts.delay > 0) {
      socket.pause();
      setTimeout(() => socket.resume(), opts.delay);
    }
    socket.on("data", (chunk) => {
      if (record.dropped) return;
      let data = chunk;
      if (opts.dropAfter !== null && record.bytes + data.length > opts.dropAfter) {
        data = data.subarray(0, opts.dropAfter - record.bytes);
        record.dropped = true;
      }
      chunks.push(data);
      record.bytes += data.length;
      const scan = statusRequests(Buffer.concat([carry, data]));
      carry = scan.carry;
      for (const request of scan.requests) {
        record.statusRequests += 1;
        const reply = statusByte(request, opts);
        if (reply !== null && !socket.destroyed) socket.write(Buffer.from([reply]));
      }
      if (record.dropped) socket.destroy();
    });
  });
  server.listen(opts.port, opts.host);
  return server;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const opts = parseArgs(process.argv.slice(2));
  const server = startFakePrinter(opts);
  server.on("listening", () => console.log(`fake ESC/POS printer on ${opts.host}:${server.address().port}; jobs in ${opts.out}`));
  server.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Run the tests**

Run: `cd /d/kd/lucifer && npm run test:print-tools`
Expected: 7 pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
cd /d/kd/lucifer
git add scripts/fake-escpos-printer.mjs scripts/fake-escpos-printer.test.mjs package.json
git commit -m "test(print): a dependency-free fake ESC/POS LAN printer (drop, delay, paper-out, cover-open, refuse)"
```

---

### Task 10: Full verification, builds, emulator + E2E harness bring-up, decisions, Results

**Files:**
- Modify: `docs/superpowers/specs/2026-10-02-printing-reliability-design.md` (add §7.10)
- Modify: this plan (fill in **Session 1A Results**)

- [ ] **Step 1: Every suite**

```bash
cd /d/kd/lucifer/packages/shared && npm test 2>&1 | grep -E "^# (tests|pass|fail)"; npx tsc --noEmit -p .
cd /d/kd/lucifer/apps/cafe && npm test 2>&1 | grep -E "^# (tests|pass|fail)|^not ok"; npx tsc --noEmit; npm run lint 2>&1 | tail -4
cd /d/kd/lucifer/apps/mobile && npx tsc --noEmit && npm run lint && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run test:app 2>&1 | grep -E "^Tests:"
cd /d/kd/lucifer/apps/desktop && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
cd /d/kd/lucifer && npm run test:print-tools 2>&1 | grep -E "^# (tests|pass|fail)"
cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | tail -3
```

Expected:
- shared: 625/625, tsc 0.
- cafe: 4001 tests, 4000 pass, 1 fail.
  - The one failure is the known `go-live-dl` ENOENT.
  - The new tests are: css-compat +2, print-job-model +6, print-lease +4, print-lifecycle-paths +13.
  - If the totals differ, account for every difference in Results.
- cafe: tsc 0; lint 0 errors and the 2 old warnings.
- mobile: tsc 0, lint 0, node 114/114, Jest 3/3.
- desktop: 191/191.
- print tools: 7/7.
- live legs: `157 passed, 0 failed`.

- [ ] **Step 2: The Next production build**

Run: `cd /d/kd/lucifer/apps/cafe && npm run build 2>&1 | tail -15 && grep -c "rgb(var(--primary-rgb)/10%)" .next/static/css/*.css`
Expected:
- the build succeeds, and the route list includes `/api/print-jobs/lease`, `/api/print-jobs/[id]/ack`, `/api/print-jobs/[id]/confirm` and `/api/print-jobs/[id]/retry`;
- one CSS file counts ≥ 1.

- [ ] **Step 3: Both APK builds, emulator first**

```bash
cd /d/kd/lucifer/apps/mobile/android
export GRADLE_USER_HOME='D:\gradle-home'
./gradlew.bat aR -PreactNativeArchitectures=x86_64 --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m -XX:MaxMetaspaceSize=512m" -Pkotlin.compiler.execution.strategy=in-process
cp app/build/outputs/apk/release/app-release.apk "<scratchpad>/pos-emulator-x86_64-release.apk"
./gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --no-daemon -Dorg.gradle.jvmargs="-Xmx1536m -XX:MaxMetaspaceSize=512m" -Pkotlin.compiler.execution.strategy=in-process
for a in "<scratchpad>/pos-emulator-x86_64-release.apk" app/build/outputs/apk/release/app-*-release.apk; do echo "$a: $(unzip -l "$a" | grep -oE 'lib/[^/]+/' | sort -u | tr '\n' ' ')"; sha256sum "$a"; done
```

Expected: both builds report `BUILD SUCCESSFUL`, and each APK holds only its own ABI. Session 1A does not touch app code, so the hashes may match Phase 0's. Record them either way.

- [ ] **Step 4: Emulator start-up smoke**

Boot the emulator the usual way (`-memory 4096 -no-snapshot -no-boot-anim`). Then install the x86_64 APK and run the TEST-CHECKLIST "Start-up and address" items 1, 5 and 7:
- 1: the first start shows the address screen;
- 5: `https://does-not-exist.example.com` shows "Could not open the POS", and the app stays in one process for 60 s of retries;
- 7: the loading cover's Try again works against a never-answering server on port 8097.

`adb logcat -b crash` must stay empty.

- [ ] **Step 5: E2E harness bring-up (local POS + emulator app + fake printer)**

Sessions 1C–1E need this harness, so a failure here is a finding. If a step fails for an environmental reason, record exactly where in Results; never fake a result.

1. Check the ports: `netstat -ano | grep LISTEN | grep -E ":(3100|9100) "`. Expected: no output.
2. Write `<scratchpad>/e2e.env` with the Write tool. It holds a random local-only test password. **Never print it, never commit it**, and type it into the app only with `adb shell input text`.
   - Use the database `pos_scratch_e2e_1a`. The review session left its own `pos_scratch_e2e` behind, whose password this session does not have.
   - Contents:

   ```
   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_e2e_1a
   NEXTAUTH_SECRET=<64 random hex chars>
   AUTH_SECRET=<the same value>
   NEXTAUTH_URL=http://localhost:3100
   AUTH_TRUST_HOST=true
   SEED_ADMIN_USERNAME=e2eadmin
   SEED_ADMIN_PASSWORD=<random, letters + digits + "-" only, at least 12 chars>
   ```
3. Seed the admin: `cd /d/kd/lucifer/apps/cafe && node --env-file="<scratchpad>/e2e.env" --import tsx scripts/seed-admin.ts`. Expected: "Admin account created."
4. Start the POS from Step 2's build, in the background: `cd /d/kd/lucifer/apps/cafe && node --env-file="<scratchpad>/e2e.env" ../../node_modules/next/dist/bin/next start -p 3100`. Expected: "Ready", and `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/login` prints `200`. The review session verified this much on 2026-10-02.
5. Start the fake printer, in the background: `cd /d/kd/lucifer && node scripts/fake-escpos-printer.mjs --out "<scratchpad>/fake-jobs"`.
6. Bridge the POS port: `MSYS_NO_PATHCONV=1 adb reverse tcp:3100 tcp:3100`.
   - The middleware's tenant gate (`lib/tenant.ts`) maps only `localhost` / `127.0.0.1` to the local "dev" tenant; `http://10.0.2.2:3100` answers 404 "Not found".
   - So the app opens `http://localhost:3100`, which its address rules allow.
   - The fake printer is still reached at `10.0.2.2:9100`, because the native TCP lane connects directly.
7. In the app: `pm clear`, enter `http://localhost:3100`, sign in as `e2eadmin` with the env password (via `adb shell input text`), and take a screenshot.
8. Open the printer panel (the printer icon). Choose the network printer, host `10.0.2.2`, port `9100`, then Use, then print the test slip. Expected:
   - `<scratchpad>/fake-jobs/jobs.log` gets a line with `bytes > 0`;
   - the screenshot shows the printer connected.
9. Designate this device as the print host (Settings → printing, the print host card). Then fire one KOT from the POS (a table, one item, Send to kitchen). Expected:
   - The fake printer gets a second job; today's claim path is still in charge in Session 1A.
   - The new `PrintJob` row carries the Phase 1 fields. Check it with a scratchpad script run from `apps/cafe`: `node --env-file="<scratchpad>/e2e.env" --import tsx <scratchpad>/last-job.ts`. The script connects and prints only `status`, `targetDeviceId`, `epoch`, `attempts`, `labels` and `log[0].event` of the newest row, never the payload.
   - Expected: `printed`, the host's device id, `0`, `0`, `[]`, `created`.
10. Clean up:
    - `adb reverse --remove-all`;
    - stop the POS and the fake printer (`Stop-Process` by the PID from `netstat`);
    - `pm clear com.possoftware.pos`;
    - `adb emu kill`.
    - Leave `pos_scratch_e2e_1a` and the scratchpad env for 1C. Note both in Results.

`adb logcat -b crash` must stay empty for the whole step.

- [ ] **Step 6: Record the Phase 1 decisions in the spec**

In the spec, directly after §7.9 (before `## 8. Routing (Phase 2)`), add:

```markdown
### 7.10 Phase 1 decisions (implementation plan, 2026-10-02)

The Phase 1 plan ([2026-10-02-phase-1-lifecycle.md](../plans/2026-10-02-phase-1-lifecycle.md)) makes these choices where this spec left room:

- **Phase 2 items.** `printerIds` / `jobIds` on lease, and the `printerId` field and index, arrive with printers in Phase 2. In simple mode a device's line holds only jobs targeted at it, so the lease call itself is "lease mine now".
- **No `{status, nextAttemptAt, createdAt, _id}` index.** No Phase 1 query uses it.
- **`myRecentJobs` rides the 20 s pulse, not the wake.** Only agents poll wake; Active CPU is the tightest limit.
- **A `"retried"` log event** covers Print again and Print now.
- **The cashier's "print again" resets the counters and sets `approvedAt`.** The copy is neither parked as stale nor failed by the uncertain limit it came from.
- **A spent daily wake share stops the agent's polling** until the next cafe-day. Leasing then rides realtime nudges and the pulse, so the shared cap truly bounds the cafe's total.
- **Dismiss covers `queued`, `needs-confirm` and `failed`, never `leased`.**
- **With a host, the sweep retargets every queued job to the current host** (rows from before Phase 1, and rows from before a re-designation).
```

- [ ] **Step 7: Results, memory, commit**

Fill in **Session 1A Results** below:
- every command and its totals;
- each changed existing pin and why;
- the live-leg count;
- the APK paths, sizes and hashes;
- the emulator and E2E findings, with screenshot paths;
- every deviation from this plan and why;
- open issues.

Update the memory file `printing-redesign-2026-10.md`:
- Session 1A is done, with its last commit;
- the E2E harness facts (`adb reverse`, the localhost tenant gate, `pos_scratch_e2e_1a`);
- the next step is the 1A review gate.

```bash
cd /d/kd/lucifer
git add docs/superpowers/specs/2026-10-02-printing-reliability-design.md docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md
git commit -m "docs(print): Phase 1 Session 1A results; record the Phase 1 decisions in the spec"
git log --oneline -14
```

Do **not** push, merge or start Session 1B. Report to the owner in Hinglish, then stop.

---

## Sessions 1B–1E (task specifications; exact code is written at each gate)

Each session below lists its tasks, the interfaces it must produce, the tests that prove it, and its exit check. At the gate before each session, the review session expands every task into Session 1A's step format (failing test → run → code → run → commit), written against the code that actually landed.

### Session 1B: server-side job creation, repair sweep, `print-status` event

**Written as exact code at the 1A review gate:** see "Session 1B (exact code, written and pre-validated at the 1A review gate)" near the end of this plan. Its gate decisions are ruled in "1A review gate: rulings". Three of them changed from the recommendations first written here:
- simple mode keeps today's job keys (R2), not the v2 keys;
- the repair marker is `Order.kotPrintDevices` (R3), not `kotServerRounds` / `billServerPrint`;
- the auto-accept does not stamp `kotPrintedAt` (R4).

`apiSend`'s `headers` option and the `realtime-client` change move to 1C, where they are first used.

### Session 1C: the agent

**Written as exact code at the 1B review gate:** see "Session 1C (exact code, written and pre-validated at the 1B review gate)" near the end of this plan, with its rulings in "1B review gate: rulings". It changed from the specification below in these ways:
- C0 follows the owner's decision after 1B (no attempt while the printer is off; at most two attempts that may print), not option A;
- C1 classifies a failure by its curated sentence and leaves the write queue unchanged;
- C2 runs the agent in `PrintHostDrain` under the drain lock, wakes it on its own order answers, aimed `print-status` frames, (the host) the broadcast nudge and the wake POST, (no host) the pulse's `printJobsForMe`; the old claim drain and GET wake stay one release, uncalled;
- C4 makes every device with an identity route through the agent, and adds the job-aware self-order lane (R4) and 1B's M-a, M-c, M-d, M-e and M-f;
- the exit check proves the maybe path through a lost ack: Android's TCP lane cannot see a mid-slip cut (gate finding G5).

The specification as written at the 1A gate, for the record:

- **C0 (the owner's I2 decision, asked at the 1A gate).** If the owner picks the recommended option A, a `sent:"no"` refusal no longer counts toward the failure limit:
  - `printJobOverLimits` keeps `uncertainAttempts ≥ 3`;
  - the attempts term counts only attempts that may have printed;
  - the 30-minute stale window, measured from `approvedAt ?? createdAt`, bounds how long refusals can repeat.

  The exact code is written at the 1C gate, against the owner's answer.
- **C1:** a coded write outcome that survives the write queue. Today `device-printer-write.ts` rethrows a bare message (agent finding 2).
  - Define `PrintWriteError { sent: "no" | "maybe"; permanent: boolean }`.
  - The native mapping per §7.5: `NOT_CONNECTED`, `UNAUTHORIZED`, `UNSUPPORTED`, `BUSY` and `BLUETOOTH_OFF` are "no"; `WRITE_FAILED` and `TIMEOUT` are "maybe"; `BAD_REQUEST` and `TOO_LARGE` are permanent.
  - A deadline before the job started is "no". A raster failure is "no".
  - Desktop: blank, too large or before send is "no"; no reply is "maybe".
  - `window.print()` is acked as printed on afterprint; it cannot know more, and the readback says "sent to system print".
- **C2 `hooks/use-print-agent.ts`** replaces the claim drain (`use-print-host-drain.ts` stays for one release, unused).
  - Who runs it: in host mode, only the host device; in no-host mode, every device, for its own line.
  - The device holds a Web Lock, and processes one job at a time.
  - **Who polls (R6).** `printAgentPollsWake({ hostConfigured, isHost })`: only the host polls the wake POST, with its cadence from `printAgentWakeIntervalMs` and its cap from `printWakeAgentCap(agents)`. With no host the agent never polls. It leases on:
    - its own order responses' `printJobs`;
    - `print-status` events whose `job.target` is this device;
    - `print-job` nudges (rare: sweep requeues and retargets, staff actions, a host clear);
    - its local timers (`retryAt`, `nextAttemptAt`, and its own lease expiry plus 1 s);
    - the pulse. The 20 s pulse with `?device=<id>` adds `printJobsForMe { count, oldestCreatedAt }` (the line filter, read-only; amend its read-only pins deliberately), so a device whose socket is down still hears about a job the server re-queued within 20 s.
  - **Pending acks (M3).** After a write it acks. A "printed" ack waiting for an answer is kept in `pos.print-ack-pending.v1` and retried every 5 s for 10 min. The entry is cleared on **any** answer from the server, applied or not (`stale-epoch`, `resolved`, `not-found` included). Only a network error or a 5xx retries.
  - Local retry timers come from `nextAttemptAt` / `retryAt`. A lease call that ran out of steps answers `retryAt` = now + 2 s (M2).
  - Bridge slips carry `{ jobId, epoch, labels }`.
  - Split the files already at their line budget (`PrintHostProvider.tsx` 200/200, `use-print-host-bridge.ts` 250/250) instead of raising the pins.
- **C3:** a `banner` prop on `KOTReceipt` and `OrderReceipt`: one large inverted block with `printBannerText(labels)` (§7.7).
- **C4: the call sites.**
  - The order call sites send `x-pos-print-agent: 1` and `x-pos-device-id`, plus `x-pos-print-bill: 1` on Pay Now and the POS settle. They send them through a new optional `headers` option on `apiSend` (`packages/shared/src/api-client.ts`, shared with the Hub, so it must stay backward compatible).
  - They hand `printJobs` to the agent and stop printing locally the kinds the server now creates.
  - **A missing ref falls back to the enqueue.** A slip the call site asked for may have no ref in the answer (a replay, a 5xx, a failed create). The call site then enqueues it through `POST /api/print-jobs` with today's builder (so the same job key), an `Idempotency-Key`, `x-pos-device-id` and `x-pos-print-agent: 1`:
    - an existing job answers `queued` (duplicate) or `already-resolved` with its id (M4: follow that job, never print locally);
    - with no host the server makes it the device's own job (1B `enqueueOwnPrintJob`).
  - Reprints, End of day and cancel notices use the same `POST /api/print-jobs` path.
  - `lib/realtime-client.ts` hands listeners the parsed message, so the agent and the readback can read `job`.
- **Exit:**
  - On the E2E harness with the fake printer, a KOT prints through lease → write → ack and the row is `printed` with `printedAt`.
  - `--drop-after 2000` on a KOT prints a REPRINT copy.
  - A mid-bill drop leaves the bill `needs-confirm`.
  - With no host, an ordering device makes no wake request (the budget test pins `printAgentPollsWake`; the E2E check counts requests in the POS log).

### Session 1D: readback, alarm, attention list

**Written as exact code at the 1C review gate:** see "Session 1D (exact code, written and pre-validated at the 1C review gate)" at the end of this plan, with its rulings in "1C review gate: rulings". It changed from the specification below in these ways:
- D1's `myRecentJobs` is not added: the panel, the count and the alarm read ONE bounded attention feed on the pulse (each row names its asking and printing device), and the readback is by exception;
- the alarm fires at the first pulse after the 20 s mark, with a notice that opens the panel (Show);
- D6: no change (the dashboard band stays one release);
- a new first task (D1) folds the 1C gate's agent rulings: the owner's I3, F1, M4, M5, M6 and two budget pins.

The specification as written at the 1A gate, for the record:

- **D1:** the pulse adds `myRecentJobs` (`?device=<id>`, the origin index, the last 15 min, limit 30) and `attentionPrintJobs` (needs-confirm, failed, and stale; within 12 h; limit 20). Its read-only pins are amended deliberately.
- **D2:** the pulse runs `sweepPrintJobsThrottled` through `after()`. After R6 this is essential: a cafe without a host has no wake poller, so lease expiry, R5's routing and R3's repair run only from the pulse. That is one sweep per 60 s per instance, riding the existing pulse.
- **D3:** readback states Queued → Printing → Printed ✓ / Failed ⚠ / Waiting for cashier.
  - Sources: the `print-status` event, falling back to `myRecentJobs`.
  - It is visible on `/pos` (amend the `alert-bar-scope` rule) and on the dashboard.
  - It survives a reload, because the server is the source.
- **D4:** the 20 s KOT alarm (`PRINT_KOT_ALARM_MS`, `lib/alert-sound.ts`) on the ordering device and on the printing device, plus a banner.
- **D5: the one waiting-slips panel (owner, after Session 1B; spec §10).** One clear, simple panel on every device, opened from the printer dot, which shows the count. Three groups, in plain words: **Waiting for the printer** (queued for a printer that is off or not ready, or stale) with Retry (Print now) and Clear; **Check the bill** (`needs-confirm`) with Print again, It printed and Clear; **Couldn't print** (`failed`) with Retry and Clear. Each row names the slip, its age and why. It replaces the host-only band (`PrintHostBandSection.tsx`'s gate goes). Its rows are D1's feed plus this device's own waiting line. A device that just followed a slip it cannot print (no host, no printer here) opens the dot's count at once, so no slip waits unseen.
- **D7 (gate finding, from 1C's no-host agents).** Retry and confirm announce their job with a `print-status` aimed at its device (`lib/print-job-actions.ts` publishes only the broadcast `print-job` today, which only the host's agent leases on); select `targetDeviceId` with the row.
- **D6 (the 1A reviewer's recommendation 3).** During the rollout window, an old ordering tab treats `leased`, `needs-confirm` and `failed` rows as gone after 60 s. Decide at the 1D gate, with exact code, whether for one release the pulse's D1 feed carries `leased` (shown as printing) and D2 carries `needs-confirm` / `failed`. Do it only if every action the old band offers on those rows is safe: Dismiss is, the claim-based Print now is not.
- **Exit:** emulator plus fake printer.
  - The printer off: the slip shows under "Waiting for the printer" on every device within one pulse, with no attempt burned; back on, it prints once and leaves the panel.
  - A lost ack (as 1C's exit): the KOT's REPRINT copy prints; a bill shows under "Check the bill".
  - The alarm sounds at 20 s.
  - Each panel action works from a second device (a desktop Chrome tab on the local POS is fine).

### Session 1E: Phase 1 exit (spec §14) and the free-tier measurement

**E1** runs the exit scenarios on the harness, with the emulator app as host and the fake printer:
1. An attempt that may have printed prints a REPRINT copy: a lost ack (as 1C's exit), and a mid-job drop on a lane that can see it (Android's TCP lane cannot: gate finding G5).
2. A mid-bill drop raises the cashier prompt.
3. Killing the host mid-job (`am force-stop`) re-queues it after 90 s, and it prints when the app is back.
4. A deleted job is repaired by the sweep.
5. A 200-order soak loses nothing silently.
   - `apps/cafe/scripts/print-soak.ts` drives the real HTTP API with the agent header against the local POS.
   - The fake printer randomly drops connections.
   - At the end, every job is `printed`, or visibly `failed` / `needs-confirm`.
   - The fake printer's `jobs.log` count matches the printed rows plus the labelled repeats.

**E2** updates TEST-CHECKLIST.md with the new states, labels and exit scenarios for real printers.

**E3: the free-tier check, measured locally (spec §17.3 item 5; re-planned at the 1B review gate, because nothing is deployed until every phase is done).** The session runs it; no deployment, no connector, no upload.
- **Set-up:** the local POS (`next start`), the emulator app as host, the fake printer, and a scratchpad counting proxy (Node, no dependencies) in front of the POS that logs every request's method, route, status and duration (`adb reverse` points the app at the proxy).
- **Runs:** the 200-order soak (E1 scenario 5) and a 30-minute idle run with the host designated; then one with no host.
- **Read:** the proxy's counts; the `next start` process's CPU time before and after each run (`Get-Process`); `db.serverStatus().opcounters` before and after, and the peak over any 10 s window.
- **Report:** requests per slip, per order and per minute, by route; CPU ms per request; Mongo operations per slip; the peak ops/s. Extrapolate to the busy day (§17.2).
- **Pass:** printing ≤ **15 % of Active CPU** and ≤ **20 % of invocations** on a normal day; Atlas **under 10 ops/s at peak**. The local CPU per request stands in for Vercel's Active CPU, and the report says so.
- **If not:** lower the cadences before release.

**Exit:** all of §14's Phase 1 criteria, with the measured numbers in Results.

---

## Phase 1 exit criteria (spec §14)

| Criterion | Proven in |
|---|---|
| An attempt that may have printed prints a REPRINT copy | 1C exit (a lost ack), 1E scenario 1 |
| A mid-bill drop raises the cashier prompt | 1C exit, 1E scenario 2 |
| Killing the host mid-job re-queues it after 90 s | 1A leg (r) (server), 1E scenario 3 (end to end) |
| A missing job is repaired by the sweep | 1B legs, 1E scenario 4 |
| No silent loss in a 200-order soak | 1E scenario 5 |
| A printer that is off costs no attempt (owner, after 1B) | 1C live leg (ad), 1C exit, 1D exit |
| The measured free-tier budget (§17.3) passes | 1A/1C budget tests (estimate), 1E E3 (measured locally) |

---

## Session 1A Results (filled in by the implementer)

Executed on 2026-10-02 on `feat/printing-reliability` (inline, superpowers:executing-plans, TDD per task). Not pushed, not merged. `<scratchpad>` below is this session's scratchpad, `C:\Users\KARTIK~1.DES\AppData\Local\Temp\claude\d--kd-lucifer\794cc608-45a8-4769-bcb3-fd3c1910dfef\scratchpad`.

### Commits (cf068e7..HEAD)

| Task | Commit | Subject |
|---|---|---|
| 0 | `d5c323b` | test(print): pin the USB flag resets, the PostCSS order and the one solid tint; record F0.8 as built |
| 1 | `d3537e8` | feat(print): the shared print-job lifecycle … as pure plans |
| 2 | `87945f8` | feat(print): agent wire contract, the shared wake cadence and cap, and the free-tier budget test |
| 3 | `3c629d7` | feat(print): PrintJob lifecycle fields (omit-empty) and the PrintDevice heartbeat model |
| 4 | `eb74fe7` | feat(print): lease the head of a device's line and acknowledge attempts with one epoch-fenced CAS |
| 5 | `e0cbe29` | feat(print): device heartbeat, the cashier and Print again decisions, and the 60 s sweep |
| 6 | `93edb68` | feat(print): lease, ack, confirm and retry routes for the print-job lifecycle |
| 7 | `1159d35` | feat(print): enqueued jobs join the lifecycle …; the wake gains a heartbeat POST |
| 8 | `b9f3e1a` | test(print): live legs for the lifecycle … |
| 9 | `df79930` | test(print): a dependency-free fake ESC/POS LAN printer … |
| Final review | `70a9106` | fix(print): clearing the host also dismisses parked and failed slips; the heartbeat awaits its unique index |
| 10 | this commit | docs(print): Phase 1 Session 1A results; record the Phase 1 decisions in the spec |

Every "Create" block and "Modify" anchor was applied by a scratchpad script that copies the plan's fenced blocks verbatim. Each anchor matched exactly once. The fresh final reviewer independently diffed all 20 created files against the plan blocks and found them byte-identical; the exceptions are `print-lifecycle-paths.test.ts`, which later tasks append to by design, and the review fixes below.

### Per-task RED → GREEN (every Expected line compared)

| Task | RED (as the plan said) | GREEN |
|---|---|---|
| 0 | n/a: the pins cover existing code. The new mutation rows prove the needles can fail | mobile `mobile-paths.test.ts` 37/37; cafe `css-compat.test.ts` 7/7 |
| 1 | `Cannot find module …/print-lifecycle` | `print-lifecycle` 23/23 + `print-job` → 52/52; shared tsc 0 |
| 2 | `Cannot find module …/print-agent-wire` | `print-budget` 5/5; shared `npm test` 625/625; tsc 0 |
| 3 | `Cannot find module '../models/PrintDevice'` | `print-job-model` 24/24 (18 old + 6 new); cafe tsc 0 |
| 4 | `Cannot find module './print-lease'` | `print-lease` 4/4 + `self-order-alert-paths` → 14/14; tsc 0; eslint 0 |
| 5 | pin 1 passed; pins 2–5 ENOENT for the three libs | `print-lifecycle-paths` 5/5 + `self-order-alert-paths` → 15/15; tsc 0; eslint 0 |
| 6 | `Cannot find module '@/lib/print-lifecycle-schemas'` | `print-lifecycle-paths` + `realtime-paths` → 55/55; tsc 0; eslint 0 |
| 7 | the four new pins failed; the 9 earlier pins passed | 7 print suites → 237/237; tsc 0; lint 0 errors + the 2 old warnings |
| 8 | the legs are the DB spec | `verify:print:live` → `157 passed, 0 failed`; tsc 0; eslint 0 |
| 9 | `Cannot find module …/scripts/fake-escpos-printer.mjs` | `test:print-tools` 7/7 |

### Task 10 Step 1: every suite (final HEAD, after the review fixes)

| Suite | Command | Result |
|---|---|---|
| shared | `npm test`; `npx tsc --noEmit -p .` | 625/625; tsc 0 |
| cafe | `npm test` | **4003 tests, 4002 pass, 1 fail**. The fail is the known `go-live-dl` ENOENT (`.claude/plan/v2/_research/cb-dl2-decisions.md` missing on this PC). Before the review fixes it was exactly the plan's 4001 / 4000 / 1. The +2 are the two review-fix pins. |
| cafe | `npx tsc --noEmit`; `npm run lint` | tsc 0; 0 errors, the 2 old warnings in `lib/masters-blob.test.ts` |
| mobile | `npx tsc --noEmit`; `npm run lint`; `npm test`; `npm run test:app` | tsc 0; lint 0; 114/114; Jest 3/3 |
| desktop | `npm test` | 191/191 |
| print tools | `npm run test:print-tools` | 7/7 |
| live legs | `MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live` | **`161 passed, 0 failed`**: the plan's 157, plus 4 checks added to leg (w) by review fix I1. It was exactly `157 passed, 0 failed` at Task 8 and at Step 1 before the fix. |

### Changed existing pins (each follows a deliberate change in this plan)

1. **`apps/mobile/src/mobile-paths.test.ts` pin 16 / pin 16 mutation** (Task 0): adds the `usbWaitingForeground = false` reset check and two mutation rows. This only adds coverage.
2. **`packages/shared/src/print-job.test.ts` dismiss-reason pin** (Task 1): renamed to "six values", and `"cashier"` was appended. It follows the new dismiss reason.
3. **`apps/cafe/lib/self-order-alert-paths.test.ts` e2** (Tasks 4 and 5): the PrintJob writer allow-list gains `print-lease.ts`, then `print-sweep.ts`, with the CAS rationale in the comment.
4. **`apps/cafe/lib/print-wake.test.ts`**, the wake route pin (Task 7): renamed, and its banned-needle check is sliced to the GET handler body. The `force-dynamic` landmark now reads the whole file. The GET must stay read-only, and the new POST writes.
5. **`apps/cafe/lib/print-queue-fixes.test.ts`**, the `prunePrintJobs` filter #1 pin (Task 7): title and assertion follow the move from `status:"queued"` to `{$in:[...PRINT_JOB_UNRESOLVED_STATUSES]}`. The reviewer's minor M9 notes that the new rationale text is inaccurate; the pin's shape is right.
6. **`apps/cafe/scripts/print-host-live/lifecycle-actions.ts` leg (w)** (review fix I1, not in the plan): 4 checks appended. Clearing the host dismisses a `needs-confirm` bill, a `failed` job and a `queued` job, never a `leased` one, and returns 3.

No other existing pin failed at any step. Every `print-queue.test.ts` dismiss pin still passes untouched, including the bulk-dismiss `claimedAt` guard pin.

### Step 2: Next production build

`npm run build`: success, both at Task 10 and again at the final HEAD after the review fixes. The route list includes `/api/print-jobs/lease`, `/api/print-jobs/[id]/ack`, `/api/print-jobs/[id]/confirm` and `/api/print-jobs/[id]/retry`, plus `/api/print-jobs/wake`. `rgb(var(--primary-rgb)/10%)`: 1 in `.next/static/css/22b0ab1b93eaddb4.css`, 0 in the other three CSS files.

### Step 3: APKs (x86_64 first, then ARM; `GRADLE_USER_HOME='D:\gradle-home'`)

Both builds reported `BUILD SUCCESSFUL` (1 m 42 s and 53 s). Each APK holds only its own ABI. **All three are byte-identical to Phase 0's** (Session 1A touches no app code).

| APK | Path | Size | SHA-256 |
|---|---|---|---|
| Emulator only (x86_64) | `<scratchpad>/pos-emulator-x86_64-release.apk` | 7,407,761 B | `fc4181e4f20799576277c7be312316d34d46db23b286bad6b13fec1cad5f13d3` |
| Client, arm64-v8a | `apps/mobile/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk` | 7,276,038 B | `9f89cd9a172b2ab8d5b72872bca947c44ae3c7c74c3a33dfc118e9c00e180ff7` |
| Client, armeabi-v7a | `apps/mobile/android/app/build/outputs/apk/release/app-armeabi-v7a-release.apk` | 6,683,872 B | `f3f6214982c9122dbc7c28f415d7a478a8aef392b834bf8213cb909c73f426cc` |

### Step 4: emulator start-up smoke (AVD `Pixel_7_API_33`, WebView 109, `-memory 4096 -no-snapshot -no-boot-anim`, booted in about 30 s)

Screenshots are in `<scratchpad>/shots/`. `adb logcat -b crash` stayed empty for the whole session.

1. First start shows the address screen ("Connect to your workspace"): `1a-01-first-start.png`. **Pass.**
5. `https://does-not-exist.example.com` shows "Could not open the POS", "The app is trying again by itself.", Try again and Change address. The PID stayed 3630 at 15, 30, 45 and 60 s: `1a-02-bad-address.png`, `1a-03-bad-address-60s.png`. **Pass.**
7. A never-answering server on `127.0.0.1:8097` (a scratchpad Node script; the port was checked free first), opened as `http://10.0.2.2:8097`. "Getting your workspace ready…", then after 12 s "Taking longer than usual. Check your connection." with Try again. Three taps each went back to "Getting your workspace ready…", with the same PID and no crash: `1a-04-cover-slow.png`, `1a-05-cover-after-taps.png`. **Pass.**

### Step 5: E2E harness bring-up (local POS + emulator app + fake printer). Works end to end.

1. Ports 3100 and 9100 were free.
2. `<scratchpad>/e2e.env` (database `pos_scratch_e2e_1a`) was written by a scratchpad Python script using `secrets`, so the random values never appear in a command or log (see deviation 4). It is never printed and never committed.
3. `scripts/seed-admin.ts` → "Admin account created." (user `e2eadmin`).
4. `next start -p 3100` from the Step 2 build, with the env file: Ready, `/login` → 200.
5. Fake printer: `node scripts/fake-escpos-printer.mjs --out "<scratchpad>/fake-jobs"`. It listened on `127.0.0.1:9100`.
6. `adb reverse tcp:3100 tcp:3100`. The app opened `http://localhost:3100` and showed the login page: `1a-06-login.png`.
7. `pm clear`, sign in as `e2eadmin` → Dashboard: `1a-07-signed-in.png`.
8. Printer panel → Network printer `10.0.2.2` : `9100` → "Use this network printer" → "Network printer 10.0.2.2 is connected." (`1a-09-network-printer.png`). Then Print test slip → "Did the test slip print?" → Yes (`1a-10-test-slip.png`). `jobs.log` shows job 1 with `bytes: 0`, the connect probe from "Use", and job 2 with `bytes: 13694`, the test slip.
9. Designated this device in the same panel ("Use one device for all printing" → "Print all slips on this device"). Android asked "Let app always run in background?" → Allow. The panel then read "This device prints all slips." (`1a-11-host-designated.png`).
   - Seeded 8 tables and the sample menu with `seed-tables.ts` and `seed-menu.ts` into `pos_scratch_e2e_1a` (deviation 5).
   - New Order → T-1 → Masala Chai → Send to Kitchen (`1a-12-new-order.png`, `1a-13-kot-sent.png`).
   - The fake printer got job 3 with `bytes: 40494`. Today's claim path is still in charge.
   - `<scratchpad>/last-job.ts` (projection excludes `payload`) on the newest row: `kind: "kot"`, `status: "printed"`, `targetDeviceId` = the PrintHost's `deviceId` (`14284a9d-…`, `targetIsHost: true`), `epoch: 0`, `attempts: 0`, `uncertainAttempts: 0`, `labels: []`, `log[0].event: "created"` (1 entry), `claimedBy` set, `printedAt: null` (legacy "claim won" meaning), `originDeviceId: null` (today's tabs send no header). There are 0 `printdevices` rows, so no client calls the new routes yet. **Exactly as expected.**
   - Extra check: unauthenticated `POST` to `/api/print-jobs/lease`, `/wake`, `/[id]/ack`, `/[id]/confirm` and `/[id]/retry`, and `GET /wake`, all answer 401.
10. Cleanup: `adb reverse --remove-all`; the POS, the fake printer and the 8097 script were stopped by PID (ports confirmed free); `pm clear com.possoftware.pos`; `adb emu kill`.
    - **Left for 1C:** the database `pos_scratch_e2e_1a` holds `e2eadmin`, 8 tables, 4 categories and 8 products, order `ORD-20261002-001`, 1 PrintJob, and a PrintHost pointing at the emulator app's old device id (`pm clear` gave the app a new id, so 1C must clear or re-designate the host).
    - The env file stays at `<scratchpad>/e2e.env`. If 1C cannot read this session's scratchpad, it should use a fresh `pos_scratch_e2e_1c` database and its own env file.

**New harness facts for 1C–1E:**
- On the login page the soft keyboard covers the password field. A tap there lands on the keyboard and the text goes into the username field. Move focus with TAB (`adb shell input keyevent 61`) and check that the focused EditText has `password="true"` (uiautomator dump) before typing the secret.
- Python on this PC breaks under `MSYS_NO_PATHCONV=1` with MSYS paths. Give it Windows paths.
- Print `uiautomator` text with `PYTHONIOENCODING=utf-8` (the ₹ sign).
- The fake printer logs the app's 0-byte connect probe as a job. Count only `bytes > 0` lines as slips.

### Step 6

Spec §7.10 "Phase 1 decisions" was added after §7.9, verbatim from the plan.

### Final whole-branch review (fresh reviewer subagent, cf068e7..df79930 plus the uncommitted §7.10)

**Verdict: "With fixes". Critical 0, Important 4, Minor 10.** The reviewer confirmed:
- the CAS fencing (including `epoch:{$in:[0,null]}` for rows from before Phase 1);
- that the legacy claim and the lease can never both win a job;
- the GET wake is unchanged;
- the late-ack rules (§7.9);
- that every route has auth and Zod validation;
- the house rules;
- that legs q–x test real behaviour.

Re-graded by effect on a cafe:

- **I1, fixed (`70a9106`).** `dismissQueuedPrintJobsForClearedHost` still dismissed only `queued`. Spec §7.1 says "host cleared" dismisses any unresolved job. Once 1C lands, a `needs-confirm` or `failed` slip aimed at a cleared host would survive with no device that may print it.
  - Now: `status: {$in: ["queued","needs-confirm","failed"]}`, never `leased` (decision 7), with the `claimedAt` guard kept.
  - Test: a new pin plus leg (w)'s 4 live checks, RED (3 FAIL, count 1) → GREEN.
- **I4, fixed (`70a9106`).** The heartbeat upsert relied on the unique `deviceId` index without the house `await Model.init()` rule (`due-payment.ts`, `crud-route.ts`, areas). A cold-start race could create duplicate rows for good, inflate `countOnlineAgents`, and shrink every agent's wake share.
  - Now: `await PrintDevice.init()` before the upsert.
  - Test: a new pin, RED → GREEN.
- **I1 part 2, ruled for the 1B gate.** With no host, nothing retargets or dismisses a job whose lease expires after the teardown and that is still aimed at the dead host. `planRetry` / `planConfirm` also never retarget.
  - Fixing it means choosing between dismissing it as `host-cleared` and retargeting it to `originDeviceId`, and 1B owns the repair sweep. It stays dormant until 1C.
- **I2, ruled for the owner at the 1C gate.** `attempts ≥ 8` also counts `sent:"no"` refusals.
  - With 2/5/10/30 s backoff, a printer that is off for about 2.5 minutes fails the head KOT, and every KOT after it fails in turn. That conflicts with G4.
  - Spec §7.2/§7.8 state the rule, so changing it is the owner's decision.
  - The reviewer's suggestion: don't count `sent:"no"` attempts (the 30-minute stale window bounds them), or have the agent hold off leasing while its printer is disconnected.
- **I3, ruled for the 1C gate.** `printWakeAgentCap` divides by devices seen in the last 90 s. An agent that spends its share goes quiet and drops out of the count, so the others' shares grow.
  - Reviewer's worst case (no-host mode, socket down all day, 3 agents): about 21,840 requests/day, above the 18,000 ceiling. Host mode (one agent) is unaffected.
  - Suggested fix: divide by devices seen this cafe-day, and add a join/leave simulation to `print-budget.test.ts`.

**Deferred minors** (none fixed; for the gate):
- M1: `lease/route.ts` runs `Promise.all([lease, touch])`, so a heartbeat failure returns 500 after the lease CAS already committed. That costs a 90 s wait and then a REPRINT, or a false cashier prompt.
- M2: `leasePrintJobs` returns `retryAt: null` after 4 steps even when printable jobs remain.
- M3: every ignored stale-epoch ack writes a log entry, so a 1C pending-ack loop could flood the log and the write budget.
- M4: a duplicate enqueue reports `leased`, `needs-confirm` and `failed` rows as `already-resolved`.
- M5: the lease CAS does not fence `targetDeviceId` (a tiny window during a retarget).
- M6: dismisses push no `dismissed` log entry.
- M7: in a mixed fleet, the legacy claim can print a lifecycle job (epoch ≥ 1) without its banner.
- M8: §7.10 omits two deviations: the agent wake is a new POST beside the GET, and the sweep throttle is per server instance, not per cafe.
- M9: the changed prune pin's rationale text is inaccurate.

**Reviewer recommendations for 1C/1D:**
1. Spec §17.2 says no-host mode adds "no polling", but 1C (C2) puts every device on the wake cadence. Reconcile these, given §17.3 rule 1.
2. Nudge fan-out: every agent leases on every nudge. Carry `targetDeviceId` in the 1B created event, and model empty leases in the budget test.
3. During the rollout window, an old ordering tab treats `leased`, `needs-confirm` and `failed` rows as gone after 60 s. Consider feeding them into D1/D2 for that release.

### Deviations from the plan, each with its reason

1. The ledger was kept in the session scratchpad, and the skill's `task-start` / `task-done` scripts were not used, because both write to `.superpowers/sdd/`, which the owner's rules say to leave alone. Each task's tests were run and recorded by hand instead.
2. In `models/PrintJob.ts`, the two Phase 1 subschemas sit above the existing "Exported as a SCHEMA…" comment, not between it and `printJobSchema`. This keeps that comment next to the schema it describes. Cosmetic only.
3. The two `testChain` entries were each put on their own line, matching the file's one-entry-per-line layout.
4. The E2E env was generated by a script (`secrets` module) instead of being typed with the Write tool, so the random password and secret never appear in the session. During sign-in the password was typed into the visible username field once (the keyboard covered the password field) and showed up in a UI dump. It was **rotated at once**: a scratchpad script re-hashed `e2eadmin` in `pos_scratch_e2e_1a` with a new random password and rewrote the env. The exposed value is dead. It was local only and never committed or uploaded.
5. A fresh database has no tables or products, so Step 9 seeded them with the repo's own `seed-tables.ts` and `seed-menu.ts` (scratch database only).
6. Two final-review fixes (`70a9106`, I1 and I4) went beyond the pre-validated code. Both are TDD-verified. They added 2 pins (cafe 4001 → 4003) and 4 live checks (157 → 161).
7. The Next build was re-run at the final HEAD after the fixes.

### Open issues

- **For the 1B gate:** I1 part 2.
- **For the 1C gate:** I2 (owner decision) and I3; the reviewer's recommendations 1–3.
- **Minors** M1–M9.
- **Known, unrelated:** `lib/go-live-dl.test.ts` ENOENT.
- **Still the owner's call:** the Phase 0 review's recommended hotfix of `7edf7aa` to `main`.

---

## Session 1A review (gate, 2026-10-03)

**Verdict: PASS.** Session 1A (`d5c323b..aeef4b1`, 12 commits on `feat/printing-reliability`) is complete and correct. This review found no new Critical or Important defect in the code that landed. The final review's open items are ruled in the next section.

Nothing below was taken from the Results section; each line was re-run or re-read at the gate.

| Check | Re-run at the gate | Session 1A Results |
|---|---|---|
| shared `npm test`; `tsc` | 625/625; 0 | same |
| cafe `npm test` | 4003 tests, 4002 pass, 1 fail: the known `go-live-dl` ENOENT | same |
| cafe `tsc`; `npm run lint` | 0; 0 errors and the 2 old warnings (`masters-blob.test.ts`) | same |
| mobile `tsc`; lint; `npm test`; `test:app` | 0; 0; 114/114; Jest 3/3 | same |
| desktop `npm test` | 191/191 | same |
| `npm run test:print-tools` | 7/7 | same |
| live legs (local mongod) | `161 passed, 0 failed` | same |
| Next build | success; `/api/print-jobs/lease`, `[id]/ack`, `[id]/confirm`, `[id]/retry` and `wake` listed; `rgb(var(--primary-rgb)/10%)` once, in `22b0ab1b93eaddb4.css` | same |
| APKs (`GRADLE_USER_HOME='D:\gradle-home'`, x86_64 first) | `BUILD SUCCESSFUL` (1 m 25 s, 55 s); one ABI each; x86_64 7,407,761 B `fc4181e4…5f13d3`; arm64-v8a 7,276,038 B `9f89cd9a…0ff7`; armeabi-v7a 6,683,872 B `f3f62149…426cc` | byte-identical |
| Secrets | `git log -p d5c323b~1..aeef4b1`: no env file, no `SEED_ADMIN_*` value, no secret or token. `e2e.env` appears only as a scratchpad path in Results. | — |
| Emulator spot-check (AVD `Pixel_7_API_33`, WebView 109.0.5414.123, the rebuilt x86_64 APK) | item 1: the first start shows "Connect to your workspace"; item 5: `https://does-not-exist.example.com` shows "Could not open the POS" and "The app is trying again by itself.", the same PID (3157) at 15 s and 60 s; `adb logcat -b crash` empty. Screenshots in the gate's scratchpad. Item 7 not re-run (APK byte-identical). | items 1/5/7 pass |

**Code read.** Every commit's diff, including the final-review fix `70a9106` and the docs commit `aeef4b1` (§7.10 matches the plan's block word for word).

**Review Focus classes**, checked against the code and their legs:
1. Two tabs racing for one head: the lease is one CAS on `{_id, status, epoch}` (`epoch: {$in: [0, null]}` for rows from before Phase 1); the loser re-reads, finds a live lease and is told `retryAt` = its expiry. Leg (q).
2. The host killed mid-job: `planExpiry` runs lazily at the head of the line and in the sweep; a KOT goes back to the queue with REPRINT behind its backoff, a bill to `needs-confirm`; a late "printed" ack on the same epoch still resolves both. Leg (r).
3. A late ack after the job was leased again: refused as `stale-epoch` and logged; a repeat of an applied ack answers `resolved` with status `printed`. Leg (s).
4. A parked head: the line filter leaves out `needs-confirm`, `failed` and stale jobs, so fresher slips print; a refused head in backoff holds the line, so kitchen order is kept; Print now makes a stale job leasable. Leg (t).
5. A re-designated host: the sweep retargets queued jobs (including rows with no target) to the current host, and fails a job over its limits. Leg (u).

**Gate findings** (from this review and from pre-validating Session 1B):
- **G1 (I3, design).** The fix the 1A reviewer suggested, dividing the cap by devices seen this cafe-day, does not bound agents that join late either: one agent alone spends 9,600 wake hits before two more arrive, and each of those then spends 4,800. That is 19,200 wake hits plus 2,640 slip requests, 21,840 a day, over the 18,000 ceiling. Ruled as R6.
- **G2 (test hygiene).** A failing `assert.ok(value)` with no message makes Node read and parse the test's own source to build its message. Under `tsx` that blocked the event loop on `realtime-paths.test.ts` (1,200 lines) and hung the run. Every new Session 1B assertion therefore carries a message. This is not a 1A defect.
- **G3 (environment).** During one pre-validation run the scratch clone's `node_modules` (a folder of junctions) disappeared mid-run. It did not recur in three later runs watched by a scratchpad watcher. The real repo's `node_modules` was checked intact (376 entries, `git status` clean).

## 1A review gate: rulings (2026-10-03)

Every ruling that changes the spec is written into spec §7.10 (and §6.5, §7.4, §9.1, §10 and §17.2 where they apply).

**The final review's Important findings**
- **I1 part 2 → R5: retarget, not dismiss.** With no host, every device prints its own slips (§6.6), so a waiting job aimed at a cleared or dead host goes back to the device that asked for it (`originDeviceId`), keeping its state and labels. Dismissing it would silently lose a KOT that may never have printed. Only a job no device asked for (an old tab's enqueue, the auto-accept) is dismissed as `host-cleared`. With a host, parked and failed jobs move to the host too, so `planRetry` and `planConfirm` need no retarget of their own. Never a leased job. Session 1B, Task B6.
- **I2 → the owner's decision, asked at this gate** (see the report). The recommendation is option A: a `sent:"no"` refusal, where no byte reached the printer, no longer counts toward the failure limit. A KOT then waits for its printer, in order, for up to the 30-minute stale window. After that it parks as "stale, Print now", and a tap gives it another 30 minutes. Duplicates stay capped by `uncertainAttempts ≥ 3`, and the 20 s alarm (1D) tells staff the printer is down. The exact code comes at the 1C gate.
- **I3 → R6: one poller.** Only the host polls the wake (`printAgentPollsWake`). With no host, no device polls. Spec §17.2's "no polling" and §17.3 rule 1 then hold, and the 90 s divisor is exact (one agent). Phase 2, when several agents poll, replaces the division with a server-side split of the remaining allowance (G1). The budget test pins it. Session 1B, Task B1; the agent follows it in 1C.

**Minors M1–M9**

| # | Finding | Ruling |
|---|---|---|
| M1 | The lease route's `Promise.all` lets a heartbeat failure 500 after the lease committed | **Fold, 1B Task B3.** `touchPrintDevice(...).catch(() => undefined)`. |
| M2 | `leasePrintJobs` answers `retryAt: null` after its 4 steps | **Fold, 1B Task B3.** `retryAt` = now + 2 s (the shortest backoff). |
| M3 | Every ignored stale-epoch ack writes a log entry | **No server change.** The log is capped at 20 (`$slice`), so storage cannot grow. 1C's agent clears a pending ack on any server answer (spec §7.9), so one ignored ack costs one write. 1C pins it. |
| M4 | A duplicate enqueue reports `leased`, `needs-confirm` and `failed` rows as `already-resolved` | **No change.** It is the safe direction: it never authorizes a local duplicate print. The 1C client follows the job by id, and 1D's attention list shows `needs-confirm` and `failed`. |
| M5 | The lease CAS does not fence `targetDeviceId` | **Fold, 1B Task B3.** Retargets are more common after R5. Leg (ab). |
| M6 | Dismisses push no `dismissed` log entry | **No change.** `dismissedAt`, `dismissReason` and `dismissedBy` already record who, why and when. The readback hears the dismissal through `print-status` (1B Task B3). |
| M7 | In a mixed fleet the legacy claim can print a lifecycle job (epoch ≥ 1) without its banner | **No change.** That is exactly today's behaviour, and only for the rollout window (until the old tab reloads). Fencing the legacy claim on the epoch would strand the slip on a host that never reloads, and a lost KOT is worse than a missing banner. |
| M8 | §7.10 omits two deviations (the wake POST beside the GET; the per-instance sweep throttle) | **Fold now:** spec §7.10. |
| M9 | The changed prune pin's rationale text is inaccurate | **Fold, 1B Task B3** (wording only). |

**The 1A reviewer's recommendations for 1C/1D**
1. **No-host polling** against §17.2 "no polling" and §17.3 rule 1 → R6. In 1C the agent uses `printAgentPollsWake`. The 20 s pulse with `?device=` gains this device's waiting-job count, so a device whose socket is down still hears about a job the server re-queued within 20 s.
2. **Nudge fan-out and empty leases** → R7. A created job's `print-status` names its device, and only that agent leases on it. Server-made jobs publish `print-job` only when a host exists (one agent). The budget test pins 3 Worker requests per slip.
3. **The rollout window**, where old ordering tabs treat `leased`, `needs-confirm` and `failed` rows as gone → **1D task D6.** For one release, the pulse's D1 feed may include `leased` and D2 may include `needs-confirm` / `failed`, but only if every action the old band offers on those rows is safe. Dismiss is; the claim-based Print now is not. Decided with exact code at the 1D gate.

**Other gate decisions** (the Session 1B spec's "confirm first" list, as ruled; each in spec §7.10):
- **R1 Opt-in by header:** confirmed as recommended. `apiSend`'s `headers` option moves to 1C, which first uses it.
- **R2 Today's job keys in simple mode**, instead of the plan's v2 keys. A retarget would otherwise change the key the repair looks for. Today's keys also let a server job and an old tab's enqueue of one slip collide instead of printing twice.
- **R3 The repair marker is `Order.kotPrintDevices`**, positional like `kotIdemKeys`, instead of `kotServerRounds` / `billServerPrint`. With no host the repair must know which device fired the round. Bills are not repaired, because the cashier is at the counter and 1C re-sends a missing ref. The candidate read uses the indexed `createdAt`, not `updatedAt`, which has no index.
- **Settle print intent** (`x-pos-print-bill`) and **Notify Kitchen stays client-started:** confirmed as recommended.
- **R4 The self-order auto-accept** with a host creates the KOT job for the host but does **not** stamp `kotPrintedAt`. The lane stays as the backstop and shares the key. Stamping it would lose the KOT if the host were cleared before it printed.
- **R7 `print-status` carries `{ id, status, target? }`.** It is published on creation and on every final state, from `applyPrintJobPlan` (one place) and the single dismiss.

---

## Session 1B (exact code, written and pre-validated at the 1A review gate)

**Pre-validated** by the review gate on 2026-10-03, on scratchpad clones only (never in the repo):
- every Create, Append and Replace block applied verbatim to a fresh clone of `aeef4b1`, task by task, with each task's own Run lines: every "find" matched exactly once, and each RED and GREEN below is the output seen there;
- the clone came out byte-identical to the development copy (`diff -r`, 33 files);
- shared: `npm test` 628/628, tsc 0;
- cafe: `npm test` 4019 tests, 4018 pass, 1 fail (only the known `go-live-dl` ENOENT; +16 new tests); tsc 0; lint 0 errors and the 2 old warnings;
- live legs: `181 passed, 0 failed` (Session 1A's 161 + 20);
- fake printer: 7/7. Mobile and desktop are untouched by 1B.

A failure while executing therefore points to drift since then, or to a typo while copying. Compare with the plan first.

**What 1B delivers.** Server-side job creation inside the order requests (spec §7.4), opted into per call site with request headers, so a tab from before Phase 1 keeps printing its own slips and nothing can print twice. The repair sweep for server-owned KOT rounds. The `print-status` realtime kind. The 1A review rulings that are server-side (I1 part 2, I3's one-poller rule, M1, M2, M5, M9). **No client sends the headers until Session 1C**, so 1B is dormant for every flow but one: the public auto-accept with a host now queues its KOT for the host at once (see ruling R4 below). It is safe with today's tabs, because the self-order lane builds the same job key.

**Gate rulings this section implements** (each is also in spec §7.10):
- **R1 Opt-in by header.** `x-pos-print-agent: 1` plus `x-pos-device-id` lets the server print a call site's slips; `x-pos-print-bill: 1` adds the bill (Pay Now, the POS settle). Without them the route creates nothing and answers exactly as before. A bad header never refuses an order write.
- **R2 Today's job keys in simple mode.** `printJobKeyOf` (`kot:<orderId>:<round>`, `bill:<orderId>`, …), not spec §6.5's `…:<target>:<copy>`: simple mode has one job per slip, a retarget would otherwise change the key the repair looks for, and a server job and an old tab's enqueue of the same slip collide on the unique key instead of printing twice. Phase 2 printers add the printer and copy parts.
- **R3 The repair marker** is `Order.kotPrintDevices` (positional, the `kotIdemKeys` idiom), written by the same order CAS. Only KOT rounds are repaired; bills, voids and moves are re-sent by the 1C client when its answer lacks their ref. Replays create nothing (the client's own enqueue of a missing ref dedupes on the key).
- **R4 The public auto-accept**, with a host, queues its KOT for the host in the same request, so it prints even with no POS tab open. It does **not** stamp `kotPrintedAt`: the self-order lane stays as the backstop and builds the same key, so whichever creates the job first wins. With no host nothing is made and the lane prints it as today. This is the only flow 1B changes before 1C.
- **R5 I1 part 2: retarget, not dismiss.** With no host a waiting job goes back to its `originDeviceId`; only a job no device asked for is dismissed (`host-cleared`). With a host, parked and failed jobs move to it too (so `planRetry` / `planConfirm` need no retarget of their own).
- **R6 I3 and the reviewer's recommendation 1: one poller.** `printAgentPollsWake`: only the host polls the wake; with no host no device polls (spec §17.2 "no polling", §17.3 rule 1). The 90 s divisor is then exact (one agent). Dividing by agents online, or seen this cafe-day, overshoots when agents join late (19,200 wake hits in the budget test's comment); Phase 2, when several agents poll, replaces it with a server-side split of the cafe's remaining daily allowance reported on the 30 s heartbeat.
- **R7 `print-status`** carries `{ id, status, target? }`: "queued" with its device on creation, then the final state from the lifecycle (printed / needs-confirm / failed / dismissed). Agents lease on events aimed at them (recommendation 2: no fan-out). Realtime cost: 3 Worker requests per slip, 3,935/day on the busy day (3.9 % of the free 100,000), pinned in the budget test.
- **R8 Minors folded:** M1 (the lease heartbeat is best-effort), M2 (a spent lease call answers `retryAt` = now + 2 s), M5 (the lease CAS is fenced on `targetDeviceId`), M9 (the prune pin's wording). M8 goes into spec §7.10 now.

**Not in 1B** (moved to 1C, the session that consumes them): `apiSend` request headers; `lib/realtime-client.ts` handing listeners the parsed message; the agent itself; the client's enqueue of any slip its answer did not name.

### File map (Session 1B)

| File | Change | Task |
|---|---|---|
| `packages/shared/src/print-agent-wire.ts` | modify: the opt-in headers, `PrintJobRef`, `printAgentPollsWake` | B1 |
| `packages/shared/src/print-lifecycle.ts` | modify: `PRINT_REPAIR_WINDOW_MS` | B1 |
| `packages/shared/src/print-budget.ts` | modify: the realtime budget constants | B1 |
| `packages/shared/src/print-budget.test.ts` | modify: one poller, the no-host budget, the realtime budget | B1 |
| `apps/cafe/lib/realtime-publish.ts` | modify: `print-status`, `CafeEventJob`, `publishPrintStatus` | B2 |
| `workers/realtime/src/index.ts` | modify: `EVENT_KINDS` parity, the documented envelope | B2 |
| `docs/GO-LIVE-CHECKLIST.md` | modify: redeploy the Worker for a new kind | B2 |
| `apps/cafe/lib/realtime-paths.test.ts` | modify: append (B2); the move's answer pin (B5) | B2, B5 |
| `apps/cafe/lib/print-lease.ts` | modify: the CAS fence, the final-state publish, the step bound | B3 |
| `apps/cafe/lib/print-queue.ts` | modify: the dismiss publish (B3); the teardown spares jobs with a device (B6) | B3, B6 |
| `apps/cafe/app/api/print-jobs/lease/route.ts` | modify: best-effort heartbeat | B3 |
| `apps/cafe/lib/print-lifecycle-paths.test.ts` | modify: the CAS pin + append (B3); the sweep pin (B6) | B3, B6 |
| `apps/cafe/lib/print-queue-fixes.test.ts` | modify: M9 wording | B3 |
| `apps/cafe/models/Order.ts` | modify: `kotPrintDevices` | B4 |
| `apps/cafe/lib/print-order-jobs.ts` | create: intent, marker, creation, own-device enqueue, the answer | B4 |
| `apps/cafe/lib/print-order-jobs.test.ts` | create (B4); append the route pins (B5) | B4, B5 |
| `apps/cafe/lib/self-order-alert-paths.test.ts` | modify: the PrintJob writer list | B4 |
| `apps/cafe/package.json` | modify: `testChain` (two files) | B4, B6 |
| `apps/cafe/app/api/orders/route.ts` | modify: KOT round 1 + Pay Now bill; the marker | B5 |
| `apps/cafe/app/api/orders/[id]/items/route.ts` | modify: the round's KOT; the marker | B5 |
| `apps/cafe/app/api/orders/[id]/settle/route.ts` | modify: the bill on `x-pos-print-bill` | B5 |
| `apps/cafe/app/api/orders/[id]/items/void/route.ts` | modify: the VOID slip | B5 |
| `apps/cafe/app/api/orders/[id]/table/route.ts` | modify: the moved slip | B5 |
| `apps/cafe/app/api/order-requests/[id]/accept/route.ts` | modify: the accepted round's KOT | B5 |
| `apps/cafe/lib/order-request-create.ts` | modify: the auto-accept's KOT for the host | B5 |
| `apps/cafe/app/api/print-jobs/route.ts` | modify: the no-host agent enqueue | B5 |
| `apps/cafe/lib/write-route-paths.test.ts` | modify: the create and settle answer pins | B5 |
| `apps/cafe/lib/print-repair.ts` | create: the repair | B6 |
| `apps/cafe/lib/print-repair.test.ts` | create | B6 |
| `apps/cafe/lib/print-sweep.ts` | replace: routing waiting jobs, the repair step | B6 |
| `apps/cafe/app/api/print-host/route.ts` | modify: DELETE sends waiting jobs home | B6 |
| `apps/cafe/scripts/print-host-live/order-jobs.ts` | create: legs y–ab | B7 |
| `apps/cafe/scripts/verify-print-host-live.ts` | modify: run legs y–ab | B7 |
| `this plan` | modify: Session 1B Results | B8 |

---

### Task B1: the opt-in headers, the one-poller rule and the realtime budget (shared)

**Files:**
- Modify: `packages/shared/src/print-agent-wire.ts`, `packages/shared/src/print-lifecycle.ts`, `packages/shared/src/print-budget.ts`
- Modify: `packages/shared/src/print-budget.test.ts` (imports; append three tests)

**Interfaces produced:** `PRINT_AGENT_HEADER` (`x-pos-print-agent`), `PRINT_BILL_HEADER` (`x-pos-print-bill`), `PRINT_HEADER_ON` (`"1"`), `PrintJobRef { id; kind; targetDeviceId; label }`, `printAgentPollsWake({ hostConfigured, isHost })`, `PRINT_REPAIR_WINDOW_MS` (30 min), `PRINT_REALTIME_PER_SLIP` (3), `PRINT_REALTIME_BASE_PER_DAY` (335), `REALTIME_FREE_REQUESTS_PER_DAY` (100,000).

- [ ] **Step 1: Write the failing budget tests**

In `packages/shared/src/print-budget.test.ts`, find:

```ts
import { printAgentWakeIntervalMs, printWakeAgentCap } from "./print-agent-wire";
import {
  PRINT_AGENT_MIN_CADENCE_MS,
  PRINT_BUDGET_BUSY_DAY,
  PRINT_BUDGET_NORMAL_MAX_PER_DAY,
  PRINT_BUDGET_WORST_MAX_PER_DAY,
  printSlipRequestsPerDay,
} from "./print-budget";
```

Replace it with:

```ts
import { printAgentPollsWake, printAgentWakeIntervalMs, printWakeAgentCap } from "./print-agent-wire";
import {
  PRINT_AGENT_MIN_CADENCE_MS,
  PRINT_BUDGET_BUSY_DAY,
  PRINT_BUDGET_NORMAL_MAX_PER_DAY,
  PRINT_BUDGET_WORST_MAX_PER_DAY,
  PRINT_REALTIME_BASE_PER_DAY,
  PRINT_REALTIME_PER_SLIP,
  REALTIME_FREE_REQUESTS_PER_DAY,
  printSlipRequestsPerDay,
} from "./print-budget";
```

Append to `packages/shared/src/print-budget.test.ts`:

```ts
// 1A review gate (I3 and the reviewer's recommendation 1). Dividing the cap by the agents online cannot
// bound agents that join late: one agent alone spends 9,600 before two more arrive, then each of them
// spends 4,800, so 19,200 wake hits. Phase 1 therefore lets exactly one device poll the wake.
test("Phase 1: at most one device polls the wake, in either simple mode, so the shared cap is exact", () => {
  const fastest = cadence({ socketHealthy: false, msSinceLastJob: 0, capSpent: false });
  for (const devices of [1, 2, 3, 5, 8, 16]) {
    for (const hostConfigured of [true, false]) {
      const pollers = Array.from({ length: devices }, (_, i) =>
        printAgentPollsWake({ hostConfigured, isHost: hostConfigured && i === 0 }),
      ).filter(Boolean).length;
      assert.ok(pollers <= 1, `${devices} devices, host ${hostConfigured}: ${pollers} pollers`);
      const total = printSlipRequestsPerDay() + pollers * Math.min(OPEN_MS / fastest, printWakeAgentCap(pollers));
      assert.ok(total <= PRINT_BUDGET_WORST_MAX_PER_DAY, `${devices} devices, host ${hostConfigured}: ${total}/day`);
    }
  }
  assert.equal(printAgentPollsWake({ hostConfigured: false, isHost: false }), false, "no host: nobody polls (spec §17.2)");
  assert.equal(printAgentPollsWake({ hostConfigured: true, isHost: false }), false, "a device that is not the host never polls");
  assert.equal(printAgentPollsWake({ hostConfigured: true, isHost: true }), true, "the host polls");
});

test("no host: printing costs only a lease and an ack per slip, never a poll (spec §17.2: 2,640/day)", () => {
  assert.equal(printSlipRequestsPerDay(), 2_640);
  assert.ok(printSlipRequestsPerDay() <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, "inside the normal-day ceiling");
});

test("realtime: three Worker requests per slip stay under 5 % of the free 100,000 a day", () => {
  const perDay = PRINT_BUDGET_BUSY_DAY.slips * PRINT_REALTIME_PER_SLIP + PRINT_REALTIME_BASE_PER_DAY;
  assert.equal(perDay, 3_935);
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});
```

- [ ] **Step 2: Run it**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|does not provide"`
Expected: `SyntaxError: The requested module './print-budget' does not provide an export named 'PRINT_REALTIME_BASE_PER_DAY'`, then `# tests 1`, `# pass 0`, `# fail 1` (the file does not load).

- [ ] **Step 3: The headers, the ref, the one-poller rule**

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
export const PRINT_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
```

Replace it with:

```ts
export const PRINT_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
/** An order request whose call site lets the SERVER create the slips it would otherwise print itself
 *  (spec §7.4). Without it the server creates nothing: a tab from before Phase 1 still prints its own
 *  slips, so no slip can print twice. Needs PRINT_DEVICE_ID_HEADER too. */
export const PRINT_AGENT_HEADER = "x-pos-print-agent";
/** With PRINT_AGENT_HEADER: this call site also prints the customer bill (Pay Now, the POS settle). */
export const PRINT_BILL_HEADER = "x-pos-print-bill";
/** The one value that switches either header on. */
export const PRINT_HEADER_ON = "1";

/** One job the server created for a request (spec §7.4 `printJobs`): the asking device leases the ones
 *  aimed at it straight away and follows each one's readback by id. */
export interface PrintJobRef {
  id: string;
  kind: PrintJobKind;
  targetDeviceId: string;
  label: string;
}
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
/** Each agent's share of the cafe's one daily wake cap (spec §9.1): more agents never mean more hits. */
```

Replace it with:

```ts
/** Whether this device polls the wake at all (spec §9.1, §17.3 rule 1; 1A review gate, I3). In simple
 *  mode only the host polls. With no host every device prints its own slips from its own order
 *  responses, targeted print-status events, local retry timers and the pulse, so no ordering device
 *  adds a recurring request, and one poller keeps the shared daily cap exact. */
export function printAgentPollsWake(input: { hostConfigured: boolean; isHost: boolean }): boolean {
  return input.hostConfigured && input.isHost;
}

/** Each agent's share of the cafe's one daily wake cap (spec §9.1): more agents never mean more hits. */
```

- [ ] **Step 4: The repair window and the realtime budget constants**

In `packages/shared/src/print-lifecycle.ts`, find:

```ts
export const PRINT_ACK_ERROR_MAX_CHARS = 200;
```

Replace it with:

```ts
export const PRINT_ACK_ERROR_MAX_CHARS = 200;
/** The repair sweep re-creates a server-owned KOT round's missing job for this long after the round
 *  fired (§7.4 step 2). It is the stale window, so a repaired slip is never older than one that would
 *  need a staff tap. */
export const PRINT_REPAIR_WINDOW_MS = 30 * 60 * 1000;
```

In `packages/shared/src/print-budget.ts`, find:

```ts
/** No recurring agent poll may run faster than this. */
export const PRINT_AGENT_MIN_CADENCE_MS = 3_000;
```

Replace it with:

```ts
/** No recurring agent poll may run faster than this. */
export const PRINT_AGENT_MIN_CADENCE_MS = 3_000;
/** Realtime Worker requests one slip costs (spec §17.2): its "queued" print-status, its final
 *  print-status, and in host mode the print-job nudge a host from before Phase 1 drains on. */
export const PRINT_REALTIME_PER_SLIP = 3;
/** Today's realtime traffic without printing (spec §17.2). */
export const PRINT_REALTIME_BASE_PER_DAY = 335;
/** Cloudflare Workers Free (spec §17.1); printing may use at most 5 % of it. */
export const REALTIME_FREE_REQUESTS_PER_DAY = 100_000;
```

- [ ] **Step 5: Run the shared suite**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: print-budget `# tests 8` / `# pass 8`; shared `npm test` `# tests 628` / `# pass 628` (625 + 3); `TSC_OK`.

- [ ] **Step 6: Commit**

```bash
cd /d/kd/lucifer
git add packages/shared/src/print-agent-wire.ts packages/shared/src/print-lifecycle.ts packages/shared/src/print-budget.ts packages/shared/src/print-budget.test.ts
git commit -m "feat(print): opt-in headers for server-side printing, the one-poller rule, and the realtime budget"
```

---

### Task B2: the `print-status` realtime kind (cafe + Worker parity)

**Files:**
- Modify: `apps/cafe/lib/realtime-publish.ts`, `workers/realtime/src/index.ts`, `docs/GO-LIVE-CHECKLIST.md`
- Modify: `apps/cafe/lib/realtime-paths.test.ts` (append two tests)

**Interfaces produced:** `CAFE_EVENT_KINDS` gains `"print-status"` (last, so the Worker's list is the same array); `CafeEventJob { id; status; target? }`; `CafeEventEnvelope.job?`; `broadcastCafeEvent(kind, nowMs?, job?)`; `publishPrintStatus(job)` (libs only, never a route).

Why the envelope may carry a job: spec §10 asks for `{ kind: "print-status", jobId, status }`. It names one print job and its device, never order content, so the Worker stays out of the trust path. `target` lets only the agent the job is aimed at lease on it (the 1A reviewer's recommendation 2: no fan-out of empty leases).

- [ ] **Step 1: Write the failing tests**

Append to `apps/cafe/lib/realtime-paths.test.ts`:

```ts
// ── (15) PRINTING PHASE 1 (Session 1B): "print-status" ──────────────────────

test('print-status: a room kind, and only its envelope names a job (id, status, device) — never order content', () => {
  assert.ok((CAFE_EVENT_KINDS as readonly string[]).includes("print-status"), "print-status is one of the room's kinds");
  const plain = buildRealtimeRequest("s", { tenant: "t", kind: "print-job", at: "x" }, 0);
  assert.equal(plain.body, JSON.stringify({ tenant: "t", kind: "print-job", at: "x" }), "every other kind is byte-for-byte as before");
  const status = buildRealtimeRequest("s", { tenant: "t", kind: "print-status", at: "x", job: { id: "j1", status: "queued", target: "dev-1" } }, 0);
  assert.deepEqual(JSON.parse(status.body), { tenant: "t", kind: "print-status", at: "x", job: { id: "j1", status: "queued", target: "dev-1" } });
});

test("PIN: publishPrintStatus keeps publishCafeEvent's after() + try/catch contract, and broadcasts the job only on print-status", () => {
  const s = stripComments(readSrc("apps/cafe/lib/realtime-publish.ts"));
  const fn = s.slice(s.indexOf("export function publishPrintStatus("));
  assert.match(fn, /try \{\s*after\(broadcastCafeEvent\("print-status", Date\.now\(\), job\)\);\s*\} catch \{/);
  assert.match(s, /\{ tenant, kind, at: new Date\(nowMs\)\.toISOString\(\), \.\.\.\(job !== undefined \? \{ job \} : \{\}\) \}/);
});
```

- [ ] **Step 2: Run them**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/realtime-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 48`, `# pass 46`, `# fail 2` (the two new tests). Every new assertion carries a message on purpose (review finding G2): a failing message-less `assert.ok` hangs this file under tsx.

- [ ] **Step 3: The kind, the envelope and `publishPrintStatus`**

In `apps/cafe/lib/realtime-publish.ts`, find:

```ts
import { createHmac } from "node:crypto";
import { after } from "next/server";
```

Replace it with:

```ts
import { createHmac } from "node:crypto";
import { after } from "next/server";
import type { PrintJobStatus } from "@pos/shared/print-job";
```

In `apps/cafe/lib/realtime-publish.ts`, find:

```ts
  "print-job",
] as const;
export type CafeEventKind = (typeof CAFE_EVENT_KINDS)[number];
```

Replace it with:

```ts
  "print-job",
  // Printing Phase 1 (spec §10, §17.2): one print job's new state — created, or final — for the
  // ordering device's readback and the agent the job is aimed at. It names the job, its status and
  // its device; never order content. The readback's pulse fallback stays.
  "print-status",
] as const;
export type CafeEventKind = (typeof CAFE_EVENT_KINDS)[number];

/** The one thing a "print-status" envelope adds: which job, its status, and (on "queued") the device
 *  that must print it, so only that agent leases on it (no fan-out of empty leases). */
export interface CafeEventJob {
  id: string;
  status: PrintJobStatus;
  target?: string;
}
```

In `apps/cafe/lib/realtime-publish.ts`, find:

```ts
export interface CafeEventEnvelope {
  tenant: string;
  kind: CafeEventKind;
  at: string;
}
```

Replace it with:

```ts
export interface CafeEventEnvelope {
  tenant: string;
  kind: CafeEventKind;
  at: string;
  /** "print-status" only. */
  job?: CafeEventJob;
}
```

In `apps/cafe/lib/realtime-publish.ts`, find:

```ts
export async function broadcastCafeEvent(
  kind: CafeEventKind,
  nowMs: number = Date.now(),
): Promise<void> {
```

Replace it with:

```ts
export async function broadcastCafeEvent(
  kind: CafeEventKind,
  nowMs: number = Date.now(),
  job?: CafeEventJob,
): Promise<void> {
```

In `apps/cafe/lib/realtime-publish.ts`, find:

```ts
      { tenant, kind, at: new Date(nowMs).toISOString() },
      nowMs,
    );
```

Replace it with:

```ts
      { tenant, kind, at: new Date(nowMs).toISOString(), ...(job !== undefined ? { job } : {}) },
      nowMs,
    );
```

In `apps/cafe/lib/realtime-publish.ts`, find:

```ts
export function publishCafeEvent(kind: CafeEventKind): void {
  try {
    after(broadcastCafeEvent(kind));
  } catch {
    // No `after()` in this runtime — skip the nudge, keep the write. Devices
    // poll, which is the shipped behaviour and the source of truth anyway.
  }
}
```

Replace it with:

```ts
export function publishCafeEvent(kind: CafeEventKind): void {
  try {
    after(broadcastCafeEvent(kind));
  } catch {
    // No `after()` in this runtime — skip the nudge, keep the write. Devices
    // poll, which is the shipped behaviour and the source of truth anyway.
  }
}

/** Printing Phase 1 (spec §10): one job's new state, under the same two-part safety contract as
 *  publishCafeEvent. Called by the print libs (job creation and the lifecycle's final transitions),
 *  never by a route; a lost frame costs the readback one pulse. */
export function publishPrintStatus(job: CafeEventJob): void {
  try {
    after(broadcastCafeEvent("print-status", Date.now(), job));
  } catch {
    // No `after()` in this runtime — skip the frame, keep the write.
  }
}
```

- [ ] **Step 4: Worker parity** (the Worker relays the raw body, so only its kind list and its documented envelope change)

In `workers/realtime/src/index.ts`, find:

```ts
const EVENT_KINDS = ["kot-fired", "kot-ticked", "order-changed", "self-order", "print-job"] as const;
```

Replace it with:

```ts
const EVENT_KINDS = ["kot-fired", "kot-ticked", "order-changed", "self-order", "print-job", "print-status"] as const;
```

In `workers/realtime/src/index.ts`, find:

```ts
 *  path entirely — it never sees a price, a customer, or a bill. */
interface PublishEnvelope {
  tenant: string;
  kind: EventKind;
  at: string;
}
```

Replace it with:

```ts
 *  path entirely — it never sees a price, a customer, or a bill. A "print-status"
 *  envelope (printing Phase 1) also names one print job: its id, its status and the
 *  device that prints it. That is still no order content; the room relays it as is. */
interface PublishEnvelope {
  tenant: string;
  kind: EventKind;
  at: string;
  job?: { id: string; status: string; target?: string };
}
```

- [ ] **Step 5: The redeploy note** (an older Worker answers 400 to an unknown kind; the cafe swallows it)

In `docs/GO-LIVE-CHECKLIST.md`, find:

```markdown
      its poll. Left empty (the default), the cafe polls exactly as before —
      nothing to verify here.
```

Replace it with:

```markdown
      its poll. Left empty (the default), the cafe polls exactly as before —
      nothing to verify here.
- [ ] **Realtime, existing cafes — redeploy the Worker with each release that adds
      an event kind** (printing Phase 1 adds `print-status`). An older Worker
      answers 400 to a kind it does not know; the cafe swallows that, so nothing
      breaks, but the new frames never arrive and the print readback waits for
      its 20 s pulse instead. Re-run the go-live run for the cafe: its Realtime
      step sees the changed Worker source (`sourceHash`) and redeploys it.
```

- [ ] **Step 6: Run them again**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/realtime-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 48` / `# pass 48` and `TSC_OK`. The parity pins pass: `CAFE_EVENT_KINDS` and the Worker's `EVENT_KINDS` hold the same six kinds in the same order.

- [ ] **Step 7: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/realtime-publish.ts apps/cafe/lib/realtime-paths.test.ts workers/realtime/src/index.ts docs/GO-LIVE-CHECKLIST.md
git commit -m "feat(print): a print-status realtime kind (job id, status, device; no order content) with Worker parity"
```

---

### Task B3: the lease rulings (M1, M2, M5), final states publish, and the M9 pin text

**Files:**
- Modify: `apps/cafe/lib/print-lease.ts`, `apps/cafe/lib/print-queue.ts` (the single dismiss), `apps/cafe/app/api/print-jobs/lease/route.ts`
- Modify: `apps/cafe/lib/print-lifecycle-paths.test.ts` (one pin follows the change; append two), `apps/cafe/lib/print-queue-fixes.test.ts` (M9: wording only)

**Interfaces produced:** `applyPrintJobPlan(id, job, patch, fence = {})` (the extra CAS terms; it publishes `print-status` for printed / needs-confirm / failed / dismissed after the write lands); `leasePrintJobs` answers `retryAt = now + 2 s` when its four steps ran out.

- [ ] **Step 1: Write the failing pins**

The first pin follows the deliberate change of `applyPrintJobPlan` (record it in Results as a changed pin):

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
test("PIN: every lifecycle transition is ONE compare-and-set on {_id, status, epoch}, and a lease call is bounded", () => {
  const s = src(LEASE);
  assert.match(s, /PrintJob\.updateOne\(printJobCasFilter\(id, job\), printJobUpdateOf\(patch\)/);
  assert.match(s, /return res\.modifiedCount === 1;/);
```

Replace it with:

```ts
test("PIN: every lifecycle transition is ONE compare-and-set on {_id, status, epoch}, and a lease call is bounded", () => {
  const s = src(LEASE);
  // Session 1B: the CAS may carry an extra fence (a lease: still this device's job, 1A review M5),
  // and a landed final transition publishes its print-status (spec §10).
  assert.match(s, /PrintJob\.updateOne\(\{ \.\.\.printJobCasFilter\(id, job\), \.\.\.fence \}, printJobUpdateOf\(patch\)/);
  assert.match(s, /const applied = res\.modifiedCount === 1;/);
  assert.match(s, /if \(applied && PRINT_STATUS_PUBLISHED\.has\(patch\.status\)\) publishPrintStatus\(\{ id: String\(id\), status: patch\.status \}\);/);
  assert.match(s, /applyPrintJobPlan\(head\._id, job, plan\.patch, \{ targetDeviceId: input\.deviceId \}\)/, "the lease CAS is fenced on the device");
```

Append to `apps/cafe/lib/print-lifecycle-paths.test.ts`:

```ts
// ── Session 1B: the 1A review's lease rulings and the print-status publishes ───────────────────────

test("PIN: the lease route's heartbeat is best-effort (M1), and a lease call that cleared four bad heads says when to look again (M2)", () => {
  assert.match(src("apps/cafe/app/api/print-jobs/lease/route.ts"), /touchPrintDevice\(parsed\.data\.deviceId, nowMs\)\.catch\(\(\) => undefined\),/);
  assert.match(src(LEASE), /return \{ jobs: \[\], retryAt: new Date\(input\.nowMs \+ PRINT_BACKOFF_MS\[0\]\)\.toISOString\(\) \};/);
});

test("PIN: the lifecycle publishes exactly the final statuses, and a dismissed job announces itself", () => {
  assert.match(src(LEASE), /new Set<PrintJobStatus>\(\["printed", "needs-confirm", "failed", "dismissed"\]\)/);
  const queue = src("apps/cafe/lib/print-queue.ts");
  const single = queue.slice(queue.indexOf("export async function dismissPrintJob("), queue.indexOf("export async function dismissQueuedPrintJobsForClearedHost("));
  assert.match(single, /if \(dismissed\) \{\s*publishPrintStatus\(\{ id: input\.id, status: "dismissed" \}\);\s*return \{ dismissed: true \};\s*\}/);
});
```

M9 (the 1A reviewer): the changed prune pin's rationale was inaccurate. Dropping filter #1's status term would not delete live printed jobs (filter #2 deletes resolved rows after 2 h anyway); the term keeps the two retention clocks apart. Wording only, the assertions stay:

In `apps/cafe/lib/print-queue-fixes.test.ts`, find:

```ts
fences on status:{$in:[...PRINT_JOB_UNRESOLVED_STATUSES]} (dropping it would delete LIVE printed jobs inside their 2 h readback window) with a $lt cutoff
```

Replace it with:

```ts
fences on status:{$in:[...PRINT_JOB_UNRESOLVED_STATUSES]} (the 12 h clock is only for jobs still waiting for a writer or a decision; a resolved row keeps its 2 h clock in filter #2) with a $lt cutoff
```

In `apps/cafe/lib/print-queue-fixes.test.ts`, find:

```ts
  assert.equal(deleteCalls.length, 2, "prunePrintJobs must call PrintJob.deleteMany( exactly twice — filter #1 (queued) and filter #2 (resolved)");
```

Replace it with:

```ts
  assert.equal(deleteCalls.length, 2, "prunePrintJobs must call PrintJob.deleteMany( exactly twice — filter #1 (unresolved) and filter #2 (resolved)");
```

In `apps/cafe/lib/print-queue-fixes.test.ts`, find:

```ts
"filter #1 must fence on the unresolved statuses (Phase 1) — dropping it deletes live printed jobs inside their 2 h readback window");
```

Replace it with:

```ts
"filter #1 must fence on the unresolved statuses (Phase 1) — the 12 h clock is for jobs still waiting; a resolved row keeps its 2 h clock");
```

- [ ] **Step 2: Run them**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-queue-fixes.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|^not ok"`
Expected: three failures, `not ok 1 - PIN: every lifecycle transition is ONE compare-and-set…`, `not ok 16 - PIN: the lease route's heartbeat is best-effort (M1)…` and `not ok 17 - PIN: the lifecycle publishes exactly the final statuses…`; `# tests 46`, `# pass 43`, `# fail 3`. The M9 edits are wording only, so that pin passes before and after.

- [ ] **Step 3: `print-lease.ts`: the fence, the final-state publish, the step bound**

In `apps/cafe/lib/print-lease.ts`, find:

```ts
import mongoose, { type FilterQuery, type Types, type UpdateQuery } from "mongoose";
import type { PrintJobKind } from "@pos/shared/print-job";
import type { LeasedPrintJob, PrintAckData, PrintLeaseData } from "@pos/shared/print-agent-wire";
import {
  PRINT_JOB_LOG_MAX,
```

Replace it with:

```ts
import mongoose, { type FilterQuery, type Types, type UpdateQuery } from "mongoose";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import type { LeasedPrintJob, PrintAckData, PrintLeaseData } from "@pos/shared/print-agent-wire";
import {
  PRINT_BACKOFF_MS,
  PRINT_JOB_LOG_MAX,
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
```

Replace it with:

```ts
import { PrintJob, type IPrintJob } from "@/models/PrintJob";
import { publishPrintStatus } from "@/lib/realtime-publish";
import { dismissPrintJob, drainAgeCutoff } from "./print-queue";
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
/** Applies a plan. false: another writer moved the job first, so re-read and re-plan. */
export async function applyPrintJobPlan(id: Types.ObjectId, job: PrintJobLifecycle, patch: PrintJobPatch): Promise<boolean> {
  const res = await PrintJob.updateOne(printJobCasFilter(id, job), printJobUpdateOf(patch) as UpdateQuery<IPrintJob>);
  return res.modifiedCount === 1;
}
```

Replace it with:

```ts
/** The statuses an ordering device's readback hears about at once (spec §10, §17.2: a job's creation
 *  and its final state); the pulse stays the fallback. */
const PRINT_STATUS_PUBLISHED: ReadonlySet<PrintJobStatus> = new Set<PrintJobStatus>(["printed", "needs-confirm", "failed", "dismissed"]);

/** Applies a plan. false: another writer moved the job first, so re-read and re-plan. `fence` adds
 *  terms the plan depends on but the epoch does not cover (a lease: still this device's job). */
export async function applyPrintJobPlan(
  id: Types.ObjectId,
  job: PrintJobLifecycle,
  patch: PrintJobPatch,
  fence: FilterQuery<IPrintJob> = {},
): Promise<boolean> {
  const res = await PrintJob.updateOne({ ...printJobCasFilter(id, job), ...fence }, printJobUpdateOf(patch) as UpdateQuery<IPrintJob>);
  const applied = res.modifiedCount === 1;
  // Fire-and-forget, after the write: a lost frame costs the readback one pulse, never the transition.
  if (applied && PRINT_STATUS_PUBLISHED.has(patch.status)) publishPrintStatus({ id: String(id), status: patch.status });
  return applied;
}
```

In `apps/cafe/lib/print-lease.ts`, find:

```ts
    const payload = await leaseEligibility(head, input.dismissedBy);
    if (payload === null) continue;
    if (!(await applyPrintJobPlan(head._id, job, plan.patch))) continue;
    return { jobs: [leasedPrintJobOf(head, plan.patch, payload, job.labels)], retryAt: null };
  }
  return { jobs: [], retryAt: null };
}
```

Replace it with:

```ts
    const payload = await leaseEligibility(head, input.dismissedBy);
    if (payload === null) continue;
    // Fenced on the target too: a retarget (the sweep, a host change) between the read and this CAS
    // moves the job to another device's line, and this device must not win it then (1A review M5).
    if (!(await applyPrintJobPlan(head._id, job, plan.patch, { targetDeviceId: input.deviceId }))) continue;
    return { jobs: [leasedPrintJobOf(head, plan.patch, payload, job.labels)], retryAt: null };
  }
  // Every step cleared one bad head or lost one race, so the line may still hold a printable job:
  // look again after the shortest backoff instead of waiting for a nudge (1A review M2).
  return { jobs: [], retryAt: new Date(input.nowMs + PRINT_BACKOFF_MS[0]).toISOString() };
}
```

- [ ] **Step 4: A dismissed job announces itself; the lease heartbeat is best-effort (M1)**

In `apps/cafe/lib/print-queue.ts`, find:

```ts
import { publishCafeEvent } from "@/lib/realtime-publish";
```

Replace it with:

```ts
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
```

In `apps/cafe/lib/print-queue.ts`, find:

```ts
  if (dismissed) return { dismissed: true };

  // A lost race here is a NORMAL 200 outcome
```

Replace it with:

```ts
  if (dismissed) {
    // Phase 1 (spec §10): the ordering device's readback hears it at once; the pulse is the fallback.
    publishPrintStatus({ id: input.id, status: "dismissed" });
    return { dismissed: true };
  }

  // A lost race here is a NORMAL 200 outcome
```

In `apps/cafe/app/api/print-jobs/lease/route.ts`, find:

```ts
      touchPrintDevice(parsed.data.deviceId, nowMs),
    ]);
```

Replace it with:

```ts
      // Best-effort (1A review M1): the lease CAS may already have committed, and a 500 now would
      // strand the job for 90 s and then reprint it. A missed touch only ages lastSeenAt.
      touchPrintDevice(parsed.data.deviceId, nowMs).catch(() => undefined),
    ]);
```

- [ ] **Step 5: Run them again, plus the live legs** (legs q–x must stay exactly as they were)

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-lifecycle-paths.test.ts lib/print-queue-fixes.test.ts lib/print-queue.test.ts lib/print-lease.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | tail -2`
Expected: `# tests 102` / `# pass 102`, `TSC_OK`, then `161 passed, 0 failed` (legs a–x exactly as before).

- [ ] **Step 6: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-lease.ts apps/cafe/lib/print-queue.ts apps/cafe/app/api/print-jobs/lease/route.ts apps/cafe/lib/print-lifecycle-paths.test.ts apps/cafe/lib/print-queue-fixes.test.ts
git commit -m "fix(print): the lease CAS is fenced on its device, a spent lease call says when to look again, the lease heartbeat is best-effort; final states publish print-status"
```

---

### Task B4: server-side job creation (`lib/print-order-jobs.ts`) and the repair marker

**Files:**
- Create: `apps/cafe/lib/print-order-jobs.ts`, `apps/cafe/lib/print-order-jobs.test.ts`
- Modify: `apps/cafe/models/Order.ts` (`kotPrintDevices`), `apps/cafe/package.json` (`testChain`), `apps/cafe/lib/self-order-alert-paths.test.ts` (the PrintJob writer list)

**Interfaces produced** (all in `@/lib/print-order-jobs`):
- `printIntentOf(req): PrintIntent | null`, `PrintIntent { deviceId; bill }`: null unless `x-pos-print-agent: 1` and a usable `x-pos-device-id`. A bad header never refuses the order write.
- `buildKotPrintDevices(old, round, deviceId)`: the positional marker, the `buildKotIdemKeys` idiom.
- `OrderPrintSlip`: `{kind:"kot", round}` | `{kind:"bill"}` | `{kind:"void"}` (the order's newest void entry) | `{kind:"moved", meta}`.
- `createOrderPrintJobs({ order, slips, originDeviceId?, queuedBy, nowMs }): Promise<PrintJobRef[]>`: target = host ?? originDeviceId (none: nothing made); slips in kind order; today's keys (`printJobKeyOf`), so a duplicate key answers the existing job; publishes `print-status` queued per new job and one `print-job` nudge when a host exists; never throws.
- `insertPrintJob(...)`, `enqueueOwnPrintJob(...)` (no-host agent enqueue, used by Task B5), `wireOrderOf(order)`, `withPrintJobs(order, refs | null)`.
- `IOrder.kotPrintDevices?: string[]` (declared, omit-empty).

- [ ] **Step 1: Write the failing tests**

Create `apps/cafe/lib/print-order-jobs.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { buildKotPrintDevices, printIntentOf, wireOrderOf, withPrintJobs } from "@/lib/print-order-jobs";

// Printing redesign Phase 1, Session 1B (plan docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md):
// server-side job creation. DB behaviour is proven live (npm run verify:print:live, legs y–ab); these
// are the pure helpers and the source pins.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const count = (text: string, needle: string): number => text.split(needle).length - 1;
function inOrder(text: string, needles: string[], label: string): void {
  let at = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, at + 1);
    assert.ok(next > at, `${label}: "${needle}" must come after the step before it`);
    at = next;
  }
}

const reqWith = (headers: Record<string, string>): Request => new Request("http://localhost/api/orders", { method: "POST", headers });

test("printIntentOf: only an agent request with a usable device id opts in; a bad header never refuses the order", () => {
  assert.equal(printIntentOf(reqWith({})), null, "a tab from before Phase 1 prints its own slips");
  assert.equal(printIntentOf(reqWith({ "x-pos-device-id": "dev-1" })), null, "the device header alone is not an opt-in");
  assert.equal(printIntentOf(reqWith({ "x-pos-print-agent": "1" })), null, "no device to print at");
  assert.equal(printIntentOf(reqWith({ "x-pos-print-agent": "yes", "x-pos-device-id": "dev-1" })), null, "only the value 1 switches it on");
  assert.equal(printIntentOf(reqWith({ "x-pos-print-agent": "1", "x-pos-device-id": "d".repeat(65) })), null, "an over-long id is ignored, not a 400");
  assert.deepEqual(printIntentOf(reqWith({ "x-pos-print-agent": "1", "x-pos-device-id": " dev-1 " })), { deviceId: "dev-1", bill: false });
  assert.deepEqual(printIntentOf(reqWith({ "x-pos-print-agent": "1", "x-pos-device-id": "dev-1", "x-pos-print-bill": "1" })), { deviceId: "dev-1", bill: true });
});

test("buildKotPrintDevices: positional like kotIdemKeys; a round its tab printed stays empty; no device writes nothing", () => {
  assert.equal(buildKotPrintDevices(undefined, 1, undefined), undefined);
  assert.deepEqual(buildKotPrintDevices(undefined, 1, "dev-1"), ["dev-1"]);
  assert.deepEqual(buildKotPrintDevices(undefined, 3, "dev-1"), ["", "", "dev-1"], "earlier rounds were printed by their tab");
  assert.deepEqual(buildKotPrintDevices(["dev-1"], 2, "dev-2"), ["dev-1", "dev-2"]);
  assert.equal(buildKotPrintDevices(["dev-1"], 2, undefined), undefined, "an old tab's round leaves the marker as it was");
});

test("withPrintJobs: without an opt-in the answer is the very same object; with one it is the wire order plus printJobs", () => {
  const order = { _id: "o1", createdAt: new Date("2026-10-02T10:00:00.000Z") };
  assert.equal(withPrintJobs(order, null), order);
  const refs = [{ id: "j1", kind: "kot" as const, targetDeviceId: "dev-1", label: "KOT round 1 · T-1" }];
  assert.deepEqual(withPrintJobs(order, refs), { _id: "o1", createdAt: "2026-10-02T10:00:00.000Z", printJobs: refs });
  assert.deepEqual(withPrintJobs(order, []), { _id: "o1", createdAt: "2026-10-02T10:00:00.000Z", printJobs: [] });
  const wire = wireOrderOf({ createdAt: new Date("2026-10-02T10:00:00.000Z") });
  assert.equal(wire.createdAt, "2026-10-02T10:00:00.000Z", "Dates reach the builders as the ISO strings the client sees");
});

test("PIN: createOrderPrintJobs never throws, announces each new job to its device, and nudges an old host only when there is one", () => {
  const s = src("apps/cafe/lib/print-order-jobs.ts");
  const fn = s.slice(s.indexOf("export async function createOrderPrintJobs("), s.indexOf("export async function enqueueOwnPrintJob("));
  inOrder(fn, ["try {", "const target = host?.deviceId ?? input.originDeviceId;", "await insertPrintJob({", "} catch {", "return refs;"], "createOrderPrintJobs");
  assert.match(fn, /publishPrintStatus\(\{ id: job\.ref\.id, status: "queued", target \}\);/);
  assert.match(fn, /if \(made > 0 && host !== null\) publishCafeEvent\("print-job"\);/);
  assert.match(s, /const jobKey = input\.jobKey \?\? printJobKeyOf\(payload\);/, "today's keys: a server job and an old tab's enqueue of one slip collide");
  assert.equal(count(s, "PrintJob.create("), 1, "one write point");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});
```

In `apps/cafe/package.json`, add the file to `testChain` directly after `"lib/print-lifecycle-paths.test.ts",` (one entry per line):

In `apps/cafe/package.json`, find:

```json
    "lib/print-lifecycle-paths.test.ts",
```

Replace it with:

```json
    "lib/print-lifecycle-paths.test.ts",
    "lib/print-order-jobs.test.ts",
```

The PrintJob writer allow-list gains the new write point (a deliberate change; name it in Results):

In `apps/cafe/lib/self-order-alert-paths.test.ts`, find:

```ts
  // print-sweep.ts writes only through applyPrintJobPlan's CAS, plus one updateMany that retargets
  // QUEUED rows (never leased ones, so it cannot move a job out from under its writer).
  const EXPECTED_PRINT_JOB_WRITERS = [
    "apps/cafe/lib/print-lease.ts",
    "apps/cafe/lib/print-queue-claim.ts",
```

Replace it with:

```ts
  // print-sweep.ts writes only through applyPrintJobPlan's CAS, plus the updateManys that route
  // waiting rows to the device that prints them now (never leased ones, so it cannot move a job out
  // from under its writer; the host-cleared one keeps the claimedAt guard).
  // Session 1B adds print-order-jobs.ts: server-side creation, one PrintJob.create per slip under
  // today's unique jobKey, so it races the legacy enqueue and the claim exactly as a second enqueue would.
  const EXPECTED_PRINT_JOB_WRITERS = [
    "apps/cafe/lib/print-lease.ts",
    "apps/cafe/lib/print-order-jobs.ts",
    "apps/cafe/lib/print-queue-claim.ts",
```

- [ ] **Step 2: Run them**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-order-jobs.test.ts 2>&1 | grep -E "Cannot find module|^# (tests|pass|fail)" | head -3`
Expected: `# Error: Cannot find module '@/lib/print-order-jobs'`, `# tests 1`, `# pass 0` (the file does not load).

- [ ] **Step 3: The repair marker on Order**

In `apps/cafe/models/Order.ts`, find:

```ts
  idemKey?: string;
  kotIdemKeys?: string[];
  billNumber?: number;
  voids?: IOrderVoid[]; // absent until the first void ($push creates it)
```

Replace it with:

```ts
  idemKey?: string;
  kotIdemKeys?: string[];
  // Printing Phase 1 (lib/print-order-jobs.ts) — positional like kotIdemKeys:
  // `kotPrintDevices[n-1]` is the device whose request had the SERVER print round
  // n's KOT ("" = a round its tab printed itself). The repair sweep re-creates a
  // missing job only for those rounds, so it never re-prints an old tab's round.
  // Absent on every order no agent tab fired.
  kotPrintDevices?: string[];
  billNumber?: number;
  voids?: IOrderVoid[]; // absent until the first void ($push creates it)
```

In `apps/cafe/models/Order.ts`, find:

```ts
    kotIdemKeys: { type: [String], default: undefined },
    billNumber: { type: Number },
```

Replace it with:

```ts
    kotIdemKeys: { type: [String], default: undefined },
    // Printing Phase 1 — declared for the same strict:true reason; omit-empty.
    kotPrintDevices: { type: [String], default: undefined },
    billNumber: { type: Number },
```

- [ ] **Step 4: The creation lib**

Create `apps/cafe/lib/print-order-jobs.ts`:

```ts
import { isDuplicateKeyError } from "@pos/shared/api";
import {
  PRINT_HOST_KEY,
  printJobPayloadWithinCap,
  type PrintJobEnqueueResult,
  type PrintJobStatus,
} from "@pos/shared/print-job";
import {
  PRINT_AGENT_HEADER,
  PRINT_BILL_HEADER,
  PRINT_DEVICE_ID_HEADER,
  PRINT_HEADER_ON,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import { printJobCreatedLog, printJobInitialLabels, printJobLifecycleInit } from "@pos/shared/print-lifecycle";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { printJobKeyOf, printJobOrderIdOf } from "@/lib/print-queue";
import { billPrintJob, kotPrintJob, movedPrintJob, voidPrintJob, type PrintJobRequest } from "@/lib/print-routing";
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
import type { Order } from "@/types";

// Printing redesign, Phase 1 Session 1B (spec §7.4): server-side job creation. An order route whose
// call site opts in (PRINT_AGENT_HEADER) creates, in the same request and right after its order write
// landed, the slips that call site would otherwise print itself. Simple mode (§6.6): the current host
// prints everything; with no host the asking device prints its own.
//
// Keys stay today's (printJobKeyOf): simple mode has one job per slip, so a server-made job and an old
// tab's enqueue of the same slip collide on the unique jobKey instead of printing twice. The printer
// and copy parts of spec §6.5's key arrive with Phase 2 printers.
//
// createOrderPrintJobs NEVER throws: an order that landed must still answer success. A job that did
// not get made is covered by the repair sweep (print-repair.ts) for KOT rounds, and by the client's own
// enqueue of any slip its response did not name (Session 1C). Never calls connectDB(). No console.*.

export interface PrintIntent {
  /** The asking device (x-pos-device-id). With no host it prints its own slips (§6.6). */
  deviceId: string;
  /** PRINT_BILL_HEADER: this call site also prints the bill (Pay Now, the POS settle). */
  bill: boolean;
}

/** null unless the request opted in with a usable device id. A bad print header never refuses the
 *  order write: the server then prints nothing, exactly as for a tab from before Phase 1. */
export function printIntentOf(req: Request): PrintIntent | null {
  if (req.headers.get(PRINT_AGENT_HEADER)?.trim() !== PRINT_HEADER_ON) return null;
  const deviceId = req.headers.get(PRINT_DEVICE_ID_HEADER)?.trim() ?? "";
  if (deviceId === "" || deviceId.length > PRINT_HOST_DEVICE_ID_MAX_CHARS) return null;
  return { deviceId, bill: req.headers.get(PRINT_BILL_HEADER)?.trim() === PRINT_HEADER_ON };
}

/** The tab's kotPrintDevices after firing `round` for `deviceId`. Positional, the kotIdemKeys idiom:
 *  index round-1 gets the device, earlier slots keep their own or "" (printed by its tab). No device →
 *  undefined, so the route writes nothing (omit-empty). */
export function buildKotPrintDevices(
  old: readonly string[] | undefined,
  round: number,
  deviceId: string | undefined,
): string[] | undefined {
  if (!deviceId) return undefined;
  return Array.from({ length: round }, (_, i) => (i === round - 1 ? deviceId : (old?.[i] ?? "")));
}

/** One slip an order request asks for. "void" is the newest entry of the order's void trail, the one
 *  this request pushed. */
export type OrderPrintSlip =
  | { kind: "kot"; round: number }
  | { kind: "bill" }
  | { kind: "void" }
  | { kind: "moved"; meta: { from?: string; movedBy: string; movedAt: string } };

const UNNAMED_STAFF = "Staff";

/** Kind order inside one request (§7.6 "KOT before bill"); creates run in this order, so createdAt does too. */
const SLIP_ORDER: Record<OrderPrintSlip["kind"], number> = { kot: 0, void: 1, moved: 2, bill: 3 };

/** A lean or hydrated Order as the wire Order the client builders read: through JSON, exactly as the
 *  response sends it, so a server-made slip is the slip the device would have built (§7.4). */
export function wireOrderOf(order: unknown): Order {
  return JSON.parse(JSON.stringify(order)) as Order;
}

function requestOf(order: Order, slip: OrderPrintSlip): PrintJobRequest | null {
  try {
    switch (slip.kind) {
      case "kot":
        return kotPrintJob(order, slip.round);
      case "bill":
        return billPrintJob(order, { reprint: false });
      case "void": {
        const entry = order.voids?.at(-1);
        return entry === undefined ? null : voidPrintJob(order, entry, { reprint: false });
      }
      case "moved":
        return movedPrintJob(order, slip.meta, { reprint: false });
    }
  } catch {
    // An order the snapshot cannot read (deploy skew): nothing to create.
    return null;
  }
}

/** One job made, or the one its key already names (a racing replay, an old tab's enqueue, a repair). */
export interface InsertedPrintJob {
  ref: PrintJobRef;
  created: boolean;
  status: PrintJobStatus;
}

/** Inserts one job. null: its payload fails the schema or the 64 KB cap. A DB error throws. */
export async function insertPrintJob(input: {
  request: PrintJobRequest;
  targetDeviceId: string;
  originDeviceId?: string;
  queuedBy: string;
  /** Default printJobKeyOf(payload); a client-started repeat passes its `reprint:<key>`. */
  jobKey?: string;
  nowMs: number;
}): Promise<InsertedPrintJob | null> {
  const parsed = printJobPayloadSchema.safeParse(input.request.payload);
  if (!parsed.success) return null;
  const payload: PrintJobPayload = parsed.data;
  const json = JSON.stringify(payload);
  if (!printJobPayloadWithinCap(json)) return null;
  const jobKey = input.jobKey ?? printJobKeyOf(payload);
  const orderId = printJobOrderIdOf(payload);
  try {
    const created = await PrintJob.create({
      kind: payload.kind,
      payload: json,
      label: input.request.label,
      // A Mongoose required string refuses "" (house rule: staff names fall back to "Staff").
      queuedBy: input.queuedBy.trim() || UNNAMED_STAFF,
      ...(orderId !== undefined ? { orderId } : {}),
      ...(jobKey !== undefined ? { jobKey } : {}),
      targetDeviceId: input.targetDeviceId,
      ...(input.originDeviceId !== undefined ? { originDeviceId: input.originDeviceId } : {}),
      copyIndex: 0,
      ...printJobLifecycleInit(input.nowMs, printJobInitialLabels(payload)),
      log: [printJobCreatedLog(input.nowMs, input.originDeviceId)],
    });
    const ref: PrintJobRef = { id: String(created._id), kind: payload.kind, targetDeviceId: input.targetDeviceId, label: input.request.label };
    return { ref, created: true, status: "queued" };
  } catch (error) {
    if (!isDuplicateKeyError(error) || jobKey === undefined) throw error;
    const existing = await PrintJob.findOne({ jobKey }).select("kind status label targetDeviceId").lean();
    // Pruned in the instant since the collision: report nothing rather than invent a job.
    if (existing === null) return null;
    const ref: PrintJobRef = {
      id: String(existing._id),
      kind: existing.kind,
      targetDeviceId: existing.targetDeviceId ?? input.targetDeviceId,
      label: existing.label,
    };
    return { ref, created: false, status: existing.status };
  }
}

/** Creates the slips one order request asked for (spec §7.4) and returns a ref for each job that
 *  exists for them, made now or before. Publishes "print-status" queued per new job, aimed at its
 *  device, plus one "print-job" nudge for a host from before Phase 1. */
export async function createOrderPrintJobs(input: {
  order: unknown;
  slips: OrderPrintSlip[];
  /** Absent only for the public auto-accept: no device asked. */
  originDeviceId?: string;
  queuedBy: string;
  nowMs: number;
}): Promise<PrintJobRef[]> {
  const refs: PrintJobRef[] = [];
  if (input.slips.length === 0) return refs;
  try {
    const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
    // With neither a host nor an asking device nothing is made: the self-order kot-claim lane prints it.
    const target = host?.deviceId ?? input.originDeviceId;
    if (target === undefined) return refs;
    const order = wireOrderOf(input.order);
    const slips = [...input.slips].sort((a, b) => SLIP_ORDER[a.kind] - SLIP_ORDER[b.kind]);
    let made = 0;
    for (const slip of slips) {
      const request = requestOf(order, slip);
      if (request === null) continue;
      const job = await insertPrintJob({ request, targetDeviceId: target, originDeviceId: input.originDeviceId, queuedBy: input.queuedBy, nowMs: input.nowMs });
      if (job === null) continue;
      refs.push(job.ref);
      if (job.created) {
        made += 1;
        publishPrintStatus({ id: job.ref.id, status: "queued", target });
      }
    }
    if (made > 0 && host !== null) publishCafeEvent("print-job");
  } catch {
    // Never fails the order write that landed: the repair sweep or the client's own enqueue covers it.
  }
  return refs;
}

/** POST /api/print-jobs with no host, from an agent tab (spec §6.6): the asking device prints its own
 *  client-started slip (a reprint, End of day, a cancel notice) through the lifecycle, under the same
 *  key rules as enqueuePrintJob, so a retried POST is one job. */
export async function enqueueOwnPrintJob(input: {
  payload: PrintJobPayload;
  label: string;
  queuedBy: string;
  idempotencyKey?: string;
  originDeviceId: string;
  nowMs: number;
}): Promise<PrintJobEnqueueResult> {
  const jobKey = printJobKeyOf(input.payload) ?? (input.idempotencyKey !== undefined ? `reprint:${input.idempotencyKey}` : undefined);
  const job = await insertPrintJob({
    request: { payload: input.payload, label: input.label },
    targetDeviceId: input.originDeviceId,
    originDeviceId: input.originDeviceId,
    queuedBy: input.queuedBy,
    ...(jobKey !== undefined ? { jobKey } : {}),
    nowMs: input.nowMs,
  });
  if (job === null) return { outcome: "too-large" };
  // A resolved job under this key already printed (or was dismissed): never report it as fresh.
  if (!job.created && job.status !== "queued") return { outcome: "already-resolved", id: job.ref.id };
  if (job.created) publishPrintStatus({ id: job.ref.id, status: "queued", target: input.originDeviceId });
  return { outcome: "queued", id: job.ref.id, duplicate: !job.created };
}

/** A route's answer: the order exactly as before, plus `printJobs` when the request opted in. */
export function withPrintJobs<T>(order: T, printJobs: PrintJobRef[] | null): T | (Order & { printJobs: PrintJobRef[] }) {
  return printJobs === null ? order : { ...wireOrderOf(order), printJobs };
}
```

- [ ] **Step 5: Run them again**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-order-jobs.test.ts lib/self-order-alert-paths.test.ts lib/order-create.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK && npx eslint lib/print-order-jobs.ts lib/print-order-jobs.test.ts models/Order.ts && echo ESLINT_OK`
Expected: `# tests 21` / `# pass 21`, `TSC_OK`, `ESLINT_OK`.

- [ ] **Step 6: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-order-jobs.ts apps/cafe/lib/print-order-jobs.test.ts apps/cafe/models/Order.ts apps/cafe/package.json apps/cafe/lib/self-order-alert-paths.test.ts
git commit -m "feat(print): server-side print-job creation under today's job keys, and the kotPrintDevices repair marker"
```

---

### Task B5: the order routes create their slips when the call site opts in

**Files:**
- Modify: `apps/cafe/app/api/orders/route.ts`, `apps/cafe/app/api/orders/[id]/items/route.ts`, `apps/cafe/app/api/orders/[id]/settle/route.ts`, `apps/cafe/app/api/orders/[id]/items/void/route.ts`, `apps/cafe/app/api/orders/[id]/table/route.ts`, `apps/cafe/app/api/order-requests/[id]/accept/route.ts`, `apps/cafe/lib/order-request-create.ts`, `apps/cafe/app/api/print-jobs/route.ts`
- Modify: `apps/cafe/lib/print-order-jobs.test.ts` (append), `apps/cafe/lib/write-route-paths.test.ts` (two answer pins), `apps/cafe/lib/realtime-paths.test.ts` (the move's answer pin)

**Behaviour, per route** (the slips each call site prints today; the response becomes `{ ...order, printJobs }` only when the request opted in, and is byte-for-byte unchanged otherwise):
- `POST /api/orders`: KOT round 1; Pay Now's bill only with `x-pos-print-bill: 1` and `status: "Completed"`. The insert marks round 1 (`kotPrintDevices: [deviceId]`). A replay, a 409, a 400 and the unconfirmed-bill-number 500 create nothing.
- `orders/[id]/items`: the fired round's KOT; the CAS `$set` marks the round positionally. Replays create nothing.
- `settle`: the bill only with `x-pos-print-bill: 1` (the Orders-sheet settle never printed and sends no header).
- `items/void`: the VOID slip for the entry this request pushed (`voids.at(-1)`).
- `orders/[id]/table`: the moved slip for all three verbs, `from` = the table the tab left (none for an ASSIGN), `movedBy`/`movedAt` from the server.
- `order-requests/[id]/accept`: the accepted round (`order.kotRounds`, exactly what the bridge stamps as `acceptedKotRound`), never on `replayed`.
- Public auto-accept (`resolveAutoAcceptStatus`): no device asked, so only with a host (ruling R4).
- `POST /api/print-jobs`: an agent request that got `no-host` becomes the asking device's own job (`enqueueOwnPrintJob`); a tab without the header still gets `no-host`.

Each creation runs after the route's own landed-path publish (replays and refusals return before it) and never fails the order write.

- [ ] **Step 1: Write the failing pins**

Append to `apps/cafe/lib/print-order-jobs.test.ts`:

```ts
// ── The order routes (Session 1B) ────────────────────────────────────────────

const ROUTES: Array<[string, string]> = [
  ["apps/cafe/app/api/orders/route.ts", 'publishCafeEvent("order-changed");'],
  ["apps/cafe/app/api/orders/[id]/items/route.ts", 'publishCafeEvent("kot-fired");'],
  ["apps/cafe/app/api/orders/[id]/settle/route.ts", 'publishCafeEvent("order-changed");'],
  ["apps/cafe/app/api/orders/[id]/items/void/route.ts", 'publishCafeEvent("order-changed");'],
  ["apps/cafe/app/api/orders/[id]/table/route.ts", 'publishCafeEvent("order-changed");'],
  ["apps/cafe/app/api/order-requests/[id]/accept/route.ts", 'publishCafeEvent("kot-fired");'],
];

test("PIN: every order route opts in only through printIntentOf(req), and creates its slips once, after its landed publish (replays return before it)", () => {
  for (const [rel, publish] of ROUTES) {
    const s = src(rel);
    assert.equal(count(s, "printIntentOf(req)"), 1, `${rel}: one opt-in read`);
    assert.equal(count(s, "await createOrderPrintJobs({"), 1, `${rel}: one creation site`);
    const at = s.lastIndexOf(publish);
    assert.ok(at >= 0 && s.indexOf("await createOrderPrintJobs({") > at, `${rel}: creation follows the landed path's publish`);
    assert.ok(!/PrintJob\./.test(s), `${rel}: no direct PrintJob access`);
  }
  for (const rel of ROUTES.slice(0, 5).map(([r]) => r)) {
    assert.match(src(rel), /return (success|created)\(withPrintJobs\(/, `${rel}: the answer goes through withPrintJobs`);
  }
});

test("PIN: the create and add-round CAS writes mark a round as the server's only when the request opted in", () => {
  const create = src("apps/cafe/app/api/orders/route.ts");
  assert.match(create, /\.\.\.\(intent \? \{ kotPrintDevices: \[intent\.deviceId\] \} : \{\}\),/);
  assert.match(
    create,
    /\[\{ kind: "kot", round: 1 \}, \.\.\.\(intent\.bill && data\.status === "Completed" \? \[\{ kind: "bill" as const \}\] : \[\]\)\]/,
    "Pay Now prints its bill only when asked",
  );
  const items = src("apps/cafe/app/api/orders/[id]/items/route.ts");
  assert.match(items, /const kotPrintDevices = buildKotPrintDevices\(old\.kotPrintDevices, round, intent\?\.deviceId\);/);
  assert.match(items, /\.\.\.\(kotPrintDevices \? \{ kotPrintDevices \} : \{\}\),/);
  assert.match(src("apps/cafe/app/api/orders/[id]/settle/route.ts"), /slips: intent\.bill \? \[\{ kind: "bill" \}\] : \[\],/, "the settle prints the bill only when asked");
  assert.match(src("apps/cafe/models/Order.ts"), /kotPrintDevices: \{ type: \[String\], default: undefined \},/, "declared, omit-empty");
});

test("PIN: the staff accept creates only on a fresh accept; the public auto-accept creates for the host only (no asking device)", () => {
  assert.match(src("apps/cafe/app/api/order-requests/[id]/accept/route.ts"), /intent && !result\.replayed\s*\? await createOrderPrintJobs\(\{/);
  const auto = src("apps/cafe/lib/order-request-create.ts");
  const fn = auto.slice(auto.indexOf("export async function resolveAutoAcceptStatus("));
  inOrder(fn, ['if ("error" in result) return "pending";', "if (!result.replayed) {", "await createOrderPrintJobs({", 'return "accepted";'], "auto-accept");
  const call = fn.slice(fn.indexOf("await createOrderPrintJobs({"), fn.indexOf('return "accepted";'));
  assert.ok(!call.includes("originDeviceId"), "no device asked: with no host nothing is made and kot-claim prints it");
});

test("PIN: POST /api/print-jobs falls back to the asking device only for an agent request that got no-host", () => {
  const s = src("apps/cafe/app/api/print-jobs/route.ts");
  assert.match(s, /if \(result\.outcome === "no-host" && intent !== null\) \{\s*result = await enqueueOwnPrintJob\(\{/);
});
```

Three existing pins follow the answer's deliberate change (name each in Results):

In `apps/cafe/lib/write-route-paths.test.ts`, find:

```ts
  const ok = mustIndexOf(src, "return success(numbered.value ?? updated);", "the success answer");
```

Replace it with:

```ts
  // Printing Phase 1 (Session 1B): the answer carries printJobs when the request opted in.
  const ok = mustIndexOf(src, "return success(withPrintJobs(numbered.value ?? updated, printJobs));", "the success answer");
```

In `apps/cafe/lib/write-route-paths.test.ts`, find:

```ts
      ["return created(numbered.value ?? landed);", "the created answer"],
```

Replace it with:

```ts
      // Printing Phase 1 (Session 1B): the answer carries printJobs when the request opted in.
      ["return created(withPrintJobs(numbered.value ?? landed, printJobs));", "the created answer"],
```

In `apps/cafe/lib/realtime-paths.test.ts`, find:

```ts
      ret: "return success(moved);", publishes: 2,
```

Replace it with:

```ts
      // Printing Phase 1 (Session 1B): the answer carries printJobs when the request opted in.
      ret: "return success(withPrintJobs(moved, printJobs));", publishes: 2,
```

- [ ] **Step 2: Run them**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-order-jobs.test.ts lib/write-route-paths.test.ts lib/realtime-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 68`, `# pass 61`, `# fail 7`: the 4 new route pins, the 2 answer pins in `write-route-paths.test.ts` and the move's answer pin in `realtime-paths.test.ts`.

- [ ] **Step 3: `POST /api/orders`**

In `apps/cafe/app/api/orders/route.ts`, find:

```ts
import { createReplayResponse, createReplayVerdict, findCreateReplay, isIdemKeyDuplicate } from "@/lib/order-idem";
```

Replace it with:

```ts
import { createReplayResponse, createReplayVerdict, findCreateReplay, isIdemKeyDuplicate } from "@/lib/order-idem";
import { createOrderPrintJobs, printIntentOf, withPrintJobs } from "@/lib/print-order-jobs";
```

In `apps/cafe/app/api/orders/route.ts`, find:

```ts
  const parsed = await validateBody(req, createOrderSchema);
  if ("error" in parsed) return parsed.error;
  const data = parsed.data;
```

Replace it with:

```ts
  const parsed = await validateBody(req, createOrderSchema);
  if ("error" in parsed) return parsed.error;
  const data = parsed.data;
  // Printing Phase 1 (lib/print-order-jobs.ts): null for a tab that prints its own slips.
  const intent = printIntentOf(req);
```

In `apps/cafe/app/api/orders/route.ts`, find:

```ts
      ...(data.idemKey ? { idemKey: data.idemKey } : {}),
    };
```

Replace it with:

```ts
      ...(data.idemKey ? { idemKey: data.idemKey } : {}),
      // Printing Phase 1 — round 1 is the server's to print, so the repair sweep may re-create it.
      ...(intent ? { kotPrintDevices: [intent.deviceId] } : {}),
    };
```

In `apps/cafe/app/api/orders/route.ts`, find:

```ts
    if (numbered.status === "rejected") return serverError(BILL_NUMBER_UNCONFIRMED, numbered.reason);
    return created(numbered.value ?? landed);
```

Replace it with:

```ts
    if (numbered.status === "rejected") return serverError(BILL_NUMBER_UNCONFIRMED, numbered.reason);
    // Printing Phase 1 (spec §7.4): the opening round's KOT, and Pay Now's bill when this call site
    // prints it, made from the order exactly as answered. Never throws.
    const printJobs = intent
      ? await createOrderPrintJobs({
          order: numbered.value ?? landed,
          slips: [{ kind: "kot", round: 1 }, ...(intent.bill && data.status === "Completed" ? [{ kind: "bill" as const }] : [])],
          originDeviceId: intent.deviceId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
      : null;
    return created(withPrintJobs(numbered.value ?? landed, printJobs));
```

- [ ] **Step 4: `orders/[id]/items`**

In `apps/cafe/app/api/orders/[id]/items/route.ts`, find:

```ts
import { idemGuardFilter, roundReplayResponse, roundReplayAfterMiss } from "@/lib/order-idem";
import { settledValue } from "@/lib/settled";
```

Replace it with:

```ts
import { idemGuardFilter, roundReplayResponse, roundReplayAfterMiss } from "@/lib/order-idem";
import { settledValue } from "@/lib/settled";
import { buildKotPrintDevices, createOrderPrintJobs, printIntentOf, withPrintJobs } from "@/lib/print-order-jobs";
```

In `apps/cafe/app/api/orders/[id]/items/route.ts`, find:

```ts
  const parsed = await validateBody(req, addItemsSchema);
  if ("error" in parsed) return parsed.error;
```

Replace it with:

```ts
  const parsed = await validateBody(req, addItemsSchema);
  if ("error" in parsed) return parsed.error;
  // Printing Phase 1 (lib/print-order-jobs.ts): null for a tab that prints its own slips.
  const intent = printIntentOf(req);
```

In `apps/cafe/app/api/orders/[id]/items/route.ts`, find:

```ts
    const kotIdemKeys = buildKotIdemKeys(old.kotIdemKeys, round, key);
```

Replace it with:

```ts
    const kotIdemKeys = buildKotIdemKeys(old.kotIdemKeys, round, key);
    // Printing Phase 1 — same positional idiom: this round is the server's to print (and to repair)
    // only when this call site opted in. Undefined (nothing written) otherwise.
    const kotPrintDevices = buildKotPrintDevices(old.kotPrintDevices, round, intent?.deviceId);
```

In `apps/cafe/app/api/orders/[id]/items/route.ts`, find:

```ts
        ...(kotIdemKeys ? { kotIdemKeys } : {}),
```

Replace it with:

```ts
        ...(kotIdemKeys ? { kotIdemKeys } : {}),
        ...(kotPrintDevices ? { kotPrintDevices } : {}),
```

In `apps/cafe/app/api/orders/[id]/items/route.ts`, find:

```ts
    publishCafeEvent("kot-fired");
    return success(updated);
```

Replace it with:

```ts
    publishCafeEvent("kot-fired");
    // Printing Phase 1 (spec §7.4): this round's KOT, when this call site lets the server print it.
    const printJobs = intent
      ? await createOrderPrintJobs({
          order: updated,
          slips: [{ kind: "kot", round }],
          originDeviceId: intent.deviceId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
      : null;
    return success(withPrintJobs(updated, printJobs));
```

- [ ] **Step 5: `settle`**

In `apps/cafe/app/api/orders/[id]/settle/route.ts`, find:

```ts
import { chargeWriteFields } from "@/lib/order-charges-write";

export const dynamic = "force-dynamic";
```

Replace it with:

```ts
import { chargeWriteFields } from "@/lib/order-charges-write";
import { createOrderPrintJobs, printIntentOf, withPrintJobs } from "@/lib/print-order-jobs";

export const dynamic = "force-dynamic";
```

In `apps/cafe/app/api/orders/[id]/settle/route.ts`, find:

```ts
  const parsed = await validateBody(req, settleOrderSchema);
  if ("error" in parsed) return parsed.error;
  const data = parsed.data;
```

Replace it with:

```ts
  const parsed = await validateBody(req, settleOrderSchema);
  if ("error" in parsed) return parsed.error;
  const data = parsed.data;
  // Printing Phase 1 (lib/print-order-jobs.ts): the bill prints from here only when this call site
  // says so (the POS settle does; the Orders-sheet settle never printed).
  const intent = printIntentOf(req);
```

In `apps/cafe/app/api/orders/[id]/settle/route.ts`, find:

```ts
    if (numbered.status === "rejected") return serverError(BILL_NUMBER_UNCONFIRMED, numbered.reason);
    return success(numbered.value ?? updated);
```

Replace it with:

```ts
    if (numbered.status === "rejected") return serverError(BILL_NUMBER_UNCONFIRMED, numbered.reason);
    // Printing Phase 1 (spec §7.4): the numbered bill, made from the order exactly as answered.
    const printJobs = intent
      ? await createOrderPrintJobs({
          order: numbered.value ?? updated,
          slips: intent.bill ? [{ kind: "bill" }] : [],
          originDeviceId: intent.deviceId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
      : null;
    return success(withPrintJobs(numbered.value ?? updated, printJobs));
```

- [ ] **Step 6: `items/void`**

In `apps/cafe/app/api/orders/[id]/items/void/route.ts`, find:

```ts
import { chargesFromOrder, splitChargeTotals } from "@pos/shared/order-charges";

export const dynamic = "force-dynamic";
```

Replace it with:

```ts
import { chargesFromOrder, splitChargeTotals } from "@pos/shared/order-charges";
import { createOrderPrintJobs, printIntentOf, withPrintJobs } from "@/lib/print-order-jobs";

export const dynamic = "force-dynamic";
```

In `apps/cafe/app/api/orders/[id]/items/void/route.ts`, find:

```ts
  const parsed = await validateBody(req, voidItemSchema);
  if ("error" in parsed) return parsed.error;
```

Replace it with:

```ts
  const parsed = await validateBody(req, voidItemSchema);
  if ("error" in parsed) return parsed.error;
  // Printing Phase 1 (lib/print-order-jobs.ts): null for a tab that prints its own slips.
  const intent = printIntentOf(req);
```

In `apps/cafe/app/api/orders/[id]/items/void/route.ts`, find:

```ts
    publishCafeEvent("order-changed");
    return success(updated);
  } catch (error) {
    return serverError("Failed to void item", error);
```

Replace it with:

```ts
    publishCafeEvent("order-changed");
    // Printing Phase 1 (spec §7.4): the VOID slip for the entry this request pushed.
    const printJobs = intent
      ? await createOrderPrintJobs({
          order: updated,
          slips: [{ kind: "void" }],
          originDeviceId: intent.deviceId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
      : null;
    return success(withPrintJobs(updated, printJobs));
  } catch (error) {
    return serverError("Failed to void item", error);
```

- [ ] **Step 7: `orders/[id]/table`**

In `apps/cafe/app/api/orders/[id]/table/route.ts`, find:

```ts
import { chargeWriteFields } from "@/lib/order-charges-write";

export const dynamic = "force-dynamic";
```

Replace it with:

```ts
import { chargeWriteFields } from "@/lib/order-charges-write";
import { createOrderPrintJobs, printIntentOf, withPrintJobs } from "@/lib/print-order-jobs";

export const dynamic = "force-dynamic";
```

In `apps/cafe/app/api/orders/[id]/table/route.ts`, find:

```ts
  const parsed = await validateBody(req, moveOrderTableSchema);
  if ("error" in parsed) return parsed.error;
  const to = parsed.data.tableNo;
```

Replace it with:

```ts
  const parsed = await validateBody(req, moveOrderTableSchema);
  if ("error" in parsed) return parsed.error;
  const to = parsed.data.tableNo;
  // Printing Phase 1 (lib/print-order-jobs.ts): null for a tab that prints its own slips.
  const intent = printIntentOf(req);
```

In `apps/cafe/app/api/orders/[id]/table/route.ts`, find:

```ts
    publishCafeEvent("order-changed");
    return success(moved);
  } catch (error) {
    return serverError("Failed to move the order", error);
  }
}
```

Replace it with:

```ts
    publishCafeEvent("order-changed");
    // Printing Phase 1 (spec §7.4): the table slip for all three verbs, as MoveTableDialog prints it —
    // `from` is the table the tab left (none for an ASSIGN), the actor and the moment are the server's.
    const printJobs = intent
      ? await createOrderPrintJobs({
          order: moved,
          slips: [
            {
              kind: "moved",
              meta: {
                ...(order.tableNo ? { from: order.tableNo } : {}),
                movedBy: authed.session.user.name ?? "Staff",
                movedAt: new Date().toISOString(),
              },
            },
          ],
          originDeviceId: intent.deviceId,
          queuedBy: authed.session.user.name ?? "",
          nowMs: Date.now(),
        })
      : null;
    return success(withPrintJobs(moved, printJobs));
  } catch (error) {
    return serverError("Failed to move the order", error);
  }
}
```

- [ ] **Step 8: the staff accept and the public auto-accept**

In `apps/cafe/app/api/order-requests/[id]/accept/route.ts`, find:

```ts
import { publishCafeEvent } from "@/lib/realtime-publish";
import { success, failure, notFound, requireAuth, serverError } from "@/lib/api-helpers";
```

Replace it with:

```ts
import { publishCafeEvent } from "@/lib/realtime-publish";
import { createOrderPrintJobs, printIntentOf } from "@/lib/print-order-jobs";
import { success, failure, notFound, requireAuth, serverError } from "@/lib/api-helpers";
```

In `apps/cafe/app/api/order-requests/[id]/accept/route.ts`, find:

```ts
export async function POST(_req: Request, { params }: Params) {
```

Replace it with:

```ts
export async function POST(req: Request, { params }: Params) {
```

In `apps/cafe/app/api/order-requests/[id]/accept/route.ts`, find:

```ts
  if (!mongoose.isValidObjectId(id)) return noStore(notFound("Order request not found"));

  try {
```

Replace it with:

```ts
  if (!mongoose.isValidObjectId(id)) return noStore(notFound("Order request not found"));
  // Printing Phase 1 (lib/print-order-jobs.ts): null for a tab that prints its own slips.
  const intent = printIntentOf(req);

  try {
```

In `apps/cafe/app/api/order-requests/[id]/accept/route.ts`, find:

```ts
    publishCafeEvent("kot-fired");

    const role = authed.session.user.role;
    return noStore(
      success({
        order: result.order,
        request: toTrayRequest(result.request, role),
        replayed: result.replayed,
      }),
    );
```

Replace it with:

```ts
    publishCafeEvent("kot-fired");

    // Printing Phase 1 (spec §7.4): the round this accept fired (the order's latest, exactly what the
    // bridge stamps as acceptedKotRound). A replay creates nothing: its round may be several behind,
    // and the device enqueues any slip its answer did not name (the key dedupes).
    const printJobs =
      intent && !result.replayed
        ? await createOrderPrintJobs({
            order: result.order,
            slips: [{ kind: "kot", round: result.order.kotRounds }],
            originDeviceId: intent.deviceId,
            queuedBy: authed.session.user.name ?? "",
            nowMs: Date.now(),
          })
        : null;

    const role = authed.session.user.role;
    return noStore(
      success({
        order: result.order,
        request: toTrayRequest(result.request, role),
        replayed: result.replayed,
        ...(printJobs !== null ? { printJobs } : {}),
      }),
    );
```

In `apps/cafe/lib/order-request-create.ts`, find:

```ts
import { acceptOrderRequest } from "@/lib/order-request-accept";
import { resolveRequestReward } from "@/lib/order-request-reward";
```

Replace it with:

```ts
import { acceptOrderRequest } from "@/lib/order-request-accept";
import { resolveRequestReward } from "@/lib/order-request-reward";
import { createOrderPrintJobs } from "@/lib/print-order-jobs";
```

In `apps/cafe/lib/order-request-create.ts`, find:

```ts
      createCustomer: false,
    });
    return "error" in result ? "pending" : "accepted";
  } catch {
```

Replace it with:

```ts
      createCustomer: false,
    });
    if ("error" in result) return "pending";
    // Printing Phase 1 (spec §7.4): with a host, its KOT is queued for the host now, so it prints even
    // with no POS tab open. The kot-claim lane stays and builds the same job key, so whichever makes the
    // job first wins and the other is a no-op. With no host nothing is made (no device asked), and the
    // lane prints it as today. Never throws.
    if (!result.replayed) {
      await createOrderPrintJobs({
        order: result.order,
        slips: [{ kind: "kot", round: result.order.kotRounds }],
        queuedBy: SELF_ORDER_RECEIVER,
        nowMs: Date.now(),
      });
    }
    return "accepted";
  } catch {
```

- [ ] **Step 9: `POST /api/print-jobs` with no host, from an agent tab**

In `apps/cafe/app/api/print-jobs/route.ts`, find:

```ts
import { enqueuePrintJob, prunePrintJobsThrottled } from "@/lib/print-queue";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
```

Replace it with:

```ts
import { enqueuePrintJob, prunePrintJobsThrottled } from "@/lib/print-queue";
import { enqueueOwnPrintJob, printIntentOf } from "@/lib/print-order-jobs";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
```

In `apps/cafe/app/api/print-jobs/route.ts`, find:

```ts
    await connectDB();
    const result = await enqueuePrintJob({
      payload: parsed.data.payload,
      label: parsed.data.label,
      queuedBy,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      ...(originDeviceId !== undefined ? { originDeviceId } : {}),
      nowMs,
    });
```

Replace it with:

```ts
    await connectDB();
    let result = await enqueuePrintJob({
      payload: parsed.data.payload,
      label: parsed.data.label,
      queuedBy,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
      ...(originDeviceId !== undefined ? { originDeviceId } : {}),
      nowMs,
    });
    // Phase 1 (spec §6.6): with no host, an agent tab prints its own client-started slip through the
    // lifecycle. A tab from before Phase 1 sends no agent header and still gets "no-host" (print here).
    const intent = printIntentOf(req);
    if (result.outcome === "no-host" && intent !== null) {
      result = await enqueueOwnPrintJob({
        payload: parsed.data.payload,
        label: parsed.data.label,
        queuedBy,
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        originDeviceId: intent.deviceId,
        nowMs,
      });
    }
```

- [ ] **Step 10: Run them again**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-order-jobs.test.ts lib/write-route-paths.test.ts lib/realtime-paths.test.ts lib/order-request-paths.test.ts lib/print-queue.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK && npm run lint 2>&1 | tail -3`
Expected: `# tests 171` / `# pass 171`, `TSC_OK`, and lint `✖ 2 problems (0 errors, 2 warnings)`: only the two old `masters-blob.test.ts` warnings.

- [ ] **Step 11: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/app/api/orders/route.ts "apps/cafe/app/api/orders/[id]/items/route.ts" "apps/cafe/app/api/orders/[id]/settle/route.ts" "apps/cafe/app/api/orders/[id]/items/void/route.ts" "apps/cafe/app/api/orders/[id]/table/route.ts" "apps/cafe/app/api/order-requests/[id]/accept/route.ts" apps/cafe/lib/order-request-create.ts apps/cafe/app/api/print-jobs/route.ts apps/cafe/lib/print-order-jobs.test.ts apps/cafe/lib/write-route-paths.test.ts apps/cafe/lib/realtime-paths.test.ts
git commit -m "feat(print): order routes create their slips server-side when the call site opts in; the auto-accept queues its KOT for the host"
```

---

### Task B6: the sweep sends waiting jobs where they print now, and repairs missing KOTs

**Files:**
- Create: `apps/cafe/lib/print-repair.ts`, `apps/cafe/lib/print-repair.test.ts`
- Replace: `apps/cafe/lib/print-sweep.ts` (whole file)
- Modify: `apps/cafe/lib/print-queue.ts` (the host teardown), `apps/cafe/app/api/print-host/route.ts` (DELETE), `apps/cafe/package.json` (`testChain`), `apps/cafe/lib/print-lifecycle-paths.test.ts` (the sweep pin follows the change)

**Interfaces produced:** `routeWaitingPrintJobs(hostDeviceId | null, nowMs)`, `returnPrintJobsToOrigins(nowMs)`, `PrintSweepResult.repaired`; `expectedKotJobs(orders, nowMs)`, `repairMissingKotJobs(nowMs)`, `PRINT_REPAIR_BATCH`, `PRINT_REPAIR_ACTOR`.

**I1 part 2 (ruled at the gate): retarget, not dismiss.** With no host each device prints its own slips (§6.6), so a waiting job aimed at a cleared or dead host goes back to the device that asked for it, keeping its state and labels. Only a job no device asked for (an old tab's enqueue, the auto-accept) is dismissed as `host-cleared`, because no device may print it. Never a leased job. With a host, parked and failed jobs move to the host too, so Print again prints there.

**The repair (spec §7.4 step 2).** Only server-owned KOT rounds (`kotPrintDevices[n-1]` set), fired in the last 30 min, with lines, on orders that are not cancelled, are re-created, under the same key. Bills, voids and moves are not repaired: the cashier is at the counter, and the 1C client re-sends any slip its answer did not name. The candidate read is one indexed query on `createdAt` (the last 12 h), limit 20, and the existence check one `$in` on `jobKey`.

- [ ] **Step 1: Write the failing tests**

Create `apps/cafe/lib/print-repair.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { expectedKotJobs } from "@/lib/print-repair";
import { printJobKeyOf } from "@/lib/print-queue";
import { kotPrintJob } from "@/lib/print-routing";
import type { Order } from "@/types";

// Printing redesign Phase 1, Session 1B: the repair sweep and where a waiting job prints after a host
// change (1A review I1 part 2). Live: npm run verify:print:live, legs z and aa.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
function inOrder(text: string, needles: string[], label: string): void {
  let at = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, at + 1);
    assert.ok(next > at, `${label}: "${needle}" must come after the step before it`);
    at = next;
  }
}

const NOW = Date.parse("2026-10-02T12:00:00.000Z");
const MIN = 60 * 1000;

test("expectedKotJobs: only server-owned rounds fired in the last 30 min that still have lines", () => {
  const order = {
    _id: "64b7f0c2a1b2c3d4e5f60718",
    createdAt: new Date(NOW - 60 * MIN),
    kotRounds: 4,
    kotFiredAt: [new Date(NOW - 60 * MIN), new Date(NOW - 10 * MIN), new Date(NOW - 5 * MIN), new Date(NOW - MIN)],
    kotPrintDevices: ["dev-1", "", "dev-1", "dev-2"],
    items: [{ kotRound: 1 }, { kotRound: 2 }, { kotRound: 4 }],
  };
  assert.deepEqual(
    expectedKotJobs([order], NOW).map((job) => [job.round, job.deviceId]),
    [[4, "dev-2"]],
    "round 1 is too old, round 2 was printed by its tab, round 3 was wholly voided",
  );
  const fresh = { ...order, kotRounds: 1, kotFiredAt: undefined, kotPrintDevices: ["dev-1"], createdAt: new Date(NOW - MIN), items: [{ kotRound: 1 }] };
  assert.deepEqual(expectedKotJobs([fresh], NOW).map((job) => job.round), [1], "a new order's round 1 fired when it was created");
  assert.deepEqual(expectedKotJobs([{ ...fresh, kotPrintDevices: undefined }], NOW), [], "no marker: every round was printed by its tab");
  assert.deepEqual(expectedKotJobs([{ ...fresh, createdAt: new Date(NOW - 31 * MIN) }], NOW), [], "older than the stale window");
});

test("expectedKotJobs: the key it looks for is the one a created job carries (printJobKeyOf)", () => {
  const id = "64b7f0c2a1b2c3d4e5f60719";
  const wire = {
    _id: id, orderId: "ORD-1", customerName: "Walk-in",
    items: [{ productId: "p1", name: "Tea", price: 100, qty: 1, modifiers: [], instructions: "", kotRound: 1 }],
    subtotal: 100, discount: 0, total: 100, paidAmount: 0, payment: "Unpaid", status: "Pending", receiver: "Staff",
    kotRounds: 1, createdAt: "2026-10-02T11:59:00.000Z", updatedAt: "2026-10-02T11:59:00.000Z",
  } as unknown as Order;
  const [job] = expectedKotJobs([{ _id: id, createdAt: new Date(NOW - MIN), kotRounds: 1, kotPrintDevices: ["dev-1"], items: [{ kotRound: 1 }] }], NOW);
  assert.equal(job?.jobKey, printJobKeyOf(kotPrintJob(wire, 1).payload));
});

test("PIN: the repair reads a bounded, indexed window, skips cancelled orders, and creates only through createOrderPrintJobs", () => {
  const s = src("apps/cafe/lib/print-repair.ts");
  assert.match(s, /createdAt: \{ \$gte: new Date\(nowMs - PRINT_JOB_QUEUED_RETENTION_MS\) \},/);
  assert.match(s, /status: \{ \$ne: "Cancelled" \},/);
  assert.match(s, /\.limit\(PRINT_REPAIR_BATCH\)/);
  assert.match(s, /if \(deviceId === ""\) continue;/, "a round its tab printed is never re-created");
  assert.match(s, /await createOrderPrintJobs\(\{/);
  assert.ok(!/PrintJob\.(create|updateOne|updateMany|findOneAndUpdate|deleteMany)\(/.test(s), "no direct PrintJob write");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});

test("PIN: clearing the host dismisses only jobs no device asked for; the rest go back to their device, never a leased one", () => {
  const queue = src("apps/cafe/lib/print-queue.ts");
  const bulk = queue.slice(queue.indexOf("export async function dismissQueuedPrintJobsForClearedHost("), queue.indexOf("export async function prunePrintJobs("));
  assert.match(bulk, /claimedAt: \{ \$exists: false \}, originDeviceId: \{ \$exists: false \} \}/);
  const route = src("apps/cafe/app/api/print-host/route.ts");
  inOrder(route, ["await clearPrintHost()", "await dismissQueuedPrintJobsForClearedHost(dismissedBy)", "await returnPrintJobsToOrigins(nowMs);"], "DELETE /api/print-host");
  const sweep = src("apps/cafe/lib/print-sweep.ts");
  assert.match(sweep, /const WAITING: readonly string\[\] = \["queued", "needs-confirm", "failed"\];/);
  assert.match(sweep, /\$expr: \{ \$ne: \["\$targetDeviceId", "\$originDeviceId"\] \}/);
  assert.match(sweep, /originDeviceId: \{ \$exists: false \}, claimedAt: \{ \$exists: false \}/, "the no-host dismissal keeps the claim guard");
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/print-order-jobs.test.ts",
```

Replace it with:

```json
    "lib/print-order-jobs.test.ts",
    "lib/print-repair.test.ts",
```

The sweep pin follows the deliberate change (name it in Results):

In `apps/cafe/lib/print-lifecycle-paths.test.ts`, find:

```ts
test("PIN: the sweep expires leases, retargets queued jobs to the current host, applies limits, then prunes — and nudges only when a job went back to the queue", () => {
  const s = src(SWEEP);
  inOrder(s, ["planExpiry(", "targetDeviceId: { $ne: host.deviceId }", "planLimits(", "await prunePrintJobsThrottled(nowMs);"], "sweep order");
  assert.equal(count(s, 'publishCafeEvent("print-job")'), 1);
  assert.match(s, /if \(result\.requeued > 0 \|\| result\.retargeted > 0\) publishCafeEvent\("print-job"\);/);
```

Replace it with:

```ts
test("PIN: the sweep expires leases, routes waiting jobs to the device that prints them now, repairs, applies limits, then prunes — and nudges only when a job went back to the queue", () => {
  const s = src(SWEEP);
  // Session 1B: step 2 covers parked and failed jobs and the no-host case (1A review I1 part 2),
  // and step 2b repairs missing KOT jobs (spec §7.4).
  inOrder(
    s,
    ["planExpiry(", "await routeWaitingPrintJobs(host?.deviceId ?? null, nowMs);", "await repairMissingKotJobs(nowMs);", "planLimits(", "await prunePrintJobsThrottled(nowMs);"],
    "sweep order",
  );
  assert.equal(count(s, 'publishCafeEvent("print-job")'), 2, "the sweep's own nudge, and the host teardown's");
  assert.match(s, /if \(result\.requeued > 0 \|\| result\.retargeted > 0\) publishCafeEvent\("print-job"\);/);
```

- [ ] **Step 2: Run them**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-repair.test.ts lib/print-lifecycle-paths.test.ts 2>&1 | grep -E "Cannot find module|^# (tests|pass|fail)" | head -4`
Expected: `# Error: Cannot find module '@/lib/print-repair'`, then `# tests 18`, `# pass 16`, `# fail 2` (the repair file, and the sweep pin).

- [ ] **Step 3: The repair**

Create `apps/cafe/lib/print-repair.ts`:

```ts
import { PRINT_JOB_QUEUED_RETENTION_MS } from "@pos/shared/print-job";
import { PRINT_REPAIR_WINDOW_MS } from "@pos/shared/print-lifecycle";
import { Order } from "@/models/Order";
import { PrintJob } from "@/models/PrintJob";
import { createOrderPrintJobs } from "./print-order-jobs";

// Printing redesign, Phase 1 Session 1B (spec §7.4, sweep step 2): the repair. A request can die
// between its order write and its job create (a timeout, a crash), or its create can fail. For a KOT
// round the SERVER owns (Order.kotPrintDevices, written by the same order CAS), a missing job is
// re-created with the same key, so a racing create is a no-op and the slip never prints twice. A
// round its tab printed itself ("" or no marker) is never touched. Bills, voids and moves are not
// repaired: the cashier is at the counter, and the client re-sends any slip its answer did not name
// (Session 1C). Never calls connectDB(). No console.*.

/** Each sweep reads at most this many orders; the rest wait for the next sweep. */
export const PRINT_REPAIR_BATCH = 20;
/** The name a repaired job is queued under (PrintJob.queuedBy). */
export const PRINT_REPAIR_ACTOR = "Repair";

interface RepairCandidate {
  _id: unknown;
  createdAt: Date;
  kotRounds?: number;
  kotFiredAt?: Date[];
  kotPrintDevices?: string[];
  items: Array<{ kotRound?: number }>;
}

export interface MissingKotJob {
  orderId: string;
  round: number;
  deviceId: string;
  jobKey: string;
}

/** Pure: the server-owned rounds of these orders that fired inside the repair window and still have
 *  lines, each with the jobKey its job carries (printJobKeyOf's KOT key; print-order-jobs.test.ts pins
 *  the two together). A wholly voided round has nothing to print. */
export function expectedKotJobs(orders: readonly RepairCandidate[], nowMs: number): MissingKotJob[] {
  const since = nowMs - PRINT_REPAIR_WINDOW_MS;
  const out: MissingKotJob[] = [];
  for (const order of orders) {
    const orderId = String(order._id);
    for (let round = 1; round <= (order.kotRounds ?? 0); round++) {
      const deviceId = order.kotPrintDevices?.[round - 1] ?? "";
      if (deviceId === "") continue;
      // Round 1 of a new order carries no kotFiredAt slot: it fired when the order was created.
      const firedAt = order.kotFiredAt?.[round - 1] ?? order.createdAt;
      if (firedAt.getTime() < since) continue;
      if (!order.items.some((item) => item.kotRound === round)) continue;
      out.push({ orderId, round, deviceId, jobKey: `kot:${orderId}:${round}` });
    }
  }
  return out;
}

/** Re-creates the missing jobs of server-owned KOT rounds fired in the last 30 min. Returns how many it
 *  made. Indexed on createdAt; a tab older than the queued retention is past saving anyway. */
export async function repairMissingKotJobs(nowMs: number): Promise<number> {
  const since = new Date(nowMs - PRINT_REPAIR_WINDOW_MS);
  const candidates = await Order.find({
    createdAt: { $gte: new Date(nowMs - PRINT_JOB_QUEUED_RETENTION_MS) },
    status: { $ne: "Cancelled" },
    kotPrintDevices: { $exists: true },
    $or: [{ createdAt: { $gte: since } }, { kotFiredAt: { $elemMatch: { $gte: since } } }],
  })
    .select("_id createdAt kotRounds kotFiredAt kotPrintDevices items.kotRound")
    .sort({ createdAt: -1 })
    .limit(PRINT_REPAIR_BATCH)
    .lean<RepairCandidate[]>();
  const expected = expectedKotJobs(candidates, nowMs);
  if (expected.length === 0) return 0;
  const present = await PrintJob.find({ jobKey: { $in: expected.map((job) => job.jobKey) } })
    .select("jobKey")
    .lean<Array<{ jobKey?: string }>>();
  const have = new Set(present.map((row) => row.jobKey));
  let repaired = 0;
  for (const missing of expected) {
    if (have.has(missing.jobKey)) continue;
    const order = await Order.findById(missing.orderId).lean();
    if (order === null) continue;
    const refs = await createOrderPrintJobs({
      order,
      slips: [{ kind: "kot", round: missing.round }],
      originDeviceId: missing.deviceId,
      queuedBy: PRINT_REPAIR_ACTOR,
      nowMs,
    });
    repaired += refs.length;
  }
  return repaired;
}
```

- [ ] **Step 4: The sweep**

Replace the whole of `apps/cafe/lib/print-sweep.ts` with:

```ts
import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import {
  PRINT_JOB_LOG_MAX,
  PRINT_MAX_ATTEMPTS,
  PRINT_MAX_UNCERTAIN_ATTEMPTS,
  PRINT_SWEEP_MIN_INTERVAL_MS,
  lifecycleOf,
  planExpiry,
  planLimits,
} from "@pos/shared/print-lifecycle";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";
import { prunePrintJobsThrottled } from "./print-queue";
import { repairMissingKotJobs } from "./print-repair";

// Printing redesign, Phase 1 (spec §7.4): the sweep. It rides requests that already exist (the
// agents' wake now; the pulse from Session 1D), at most once per 60 s per server instance — NEVER
// Vercel Cron (Hobby allows one a day). Every step is idempotent, so a second instance sweeping in
// the same minute only repeats no-ops. Never calls connectDB(). No console.*.

/** Each sweep read takes at most this many rows; the rest wait for the next sweep. */
export const PRINT_SWEEP_BATCH = 20;

/** Jobs that wait for a writer or a decision and may move to another device. Never "leased": its
 *  writer may be printing it now (its lease expires in 90 s, then it moves). */
const WAITING: readonly string[] = ["queued", "needs-confirm", "failed"];
/** The actor a host-cleared dismissal names when no staff tap caused it. */
const SWEEP_ACTOR = "system";

export interface PrintSweepResult {
  expired: number;
  requeued: number;
  retargeted: number;
  repaired: number;
  failed: number;
}

/** Simple mode (§6.6): every waiting job prints at the device that should print it NOW. With a host,
 *  that is the current host (rows from before Phase 1, rows from before a re-designation). With no
 *  host, it is the device that asked for the job (1A review I1 part 2: a slip aimed at a cleared or
 *  dead host goes back to its ordering device, labelled as it was); a job no device asked for (an old
 *  tab's enqueue, the public auto-accept) has no device left that may print it and is dismissed as
 *  host-cleared. Returns how many jobs moved. Pipeline updates: one write each, however many rows. */
export async function routeWaitingPrintJobs(hostDeviceId: string | null, nowMs: number): Promise<number> {
  const at = new Date(nowMs);
  if (hostDeviceId !== null) {
    const moved = await PrintJob.updateMany(
      { status: { $in: WAITING }, targetDeviceId: { $ne: hostDeviceId } },
      {
        $set: { targetDeviceId: hostDeviceId },
        $push: { log: { $each: [{ at, event: "retargeted", deviceId: hostDeviceId }], $slice: -PRINT_JOB_LOG_MAX } },
      },
    );
    return moved.modifiedCount ?? 0;
  }
  const home = await PrintJob.updateMany(
    { status: { $in: WAITING }, originDeviceId: { $exists: true }, $expr: { $ne: ["$targetDeviceId", "$originDeviceId"] } },
    [
      {
        $set: {
          targetDeviceId: "$originDeviceId",
          log: {
            $slice: [
              { $concatArrays: [{ $ifNull: ["$log", []] }, [{ at, event: "retargeted", deviceId: "$originDeviceId" }]] },
              -PRINT_JOB_LOG_MAX,
            ],
          },
        },
      },
    ],
  );
  await PrintJob.updateMany(
    { status: { $in: WAITING }, originDeviceId: { $exists: false }, claimedAt: { $exists: false } },
    { $set: { status: "dismissed", dismissedAt: at, dismissReason: "host-cleared", dismissedBy: SWEEP_ACTOR } },
  );
  return home.modifiedCount ?? 0;
}

/** DELETE /api/print-host, after its bulk dismiss: with no host now, every waiting job that names the
 *  device that asked for it goes back there, and that device is nudged to lease it (I1 part 2). */
export async function returnPrintJobsToOrigins(nowMs: number): Promise<number> {
  const moved = await routeWaitingPrintJobs(null, nowMs);
  if (moved > 0) publishCafeEvent("print-job");
  return moved;
}

export async function sweepPrintJobs(nowMs: number): Promise<PrintSweepResult> {
  const result: PrintSweepResult = { expired: 0, requeued: 0, retargeted: 0, repaired: 0, failed: 0 };

  // 1. Expire leases whose writer went quiet: the same as a "maybe sent" failure (§7.2).
  const leased = await PrintJob.find({ status: "leased", "lease.expiresAt": { $lt: new Date(nowMs) } })
    .select(PRINT_LIFECYCLE_SELECT)
    .limit(PRINT_SWEEP_BATCH)
    .lean<PrintLifecycleRow[]>();
  for (const row of leased) {
    const job = lifecycleOf(row);
    const plan = planExpiry(job, nowMs);
    if (plan.ok && (await applyPrintJobPlan(row._id, job, plan.patch))) {
      result.expired += 1;
      if (plan.patch.status === "queued") result.requeued += 1;
    }
  }

  // 2. Every waiting job to the device that should print it now (§6.6).
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("deviceId").lean();
  result.retargeted = await routeWaitingPrintJobs(host?.deviceId ?? null, nowMs);

  // 2b. Re-create the missing job of a server-owned KOT round (§7.4; print-repair.ts).
  result.repaired = await repairMissingKotJobs(nowMs);

  // 3. Limits (§7.8). They are normally applied when acking; this catches anything that slipped past.
  const tired = await PrintJob.find({
    status: "queued",
    $or: [{ uncertainAttempts: { $gte: PRINT_MAX_UNCERTAIN_ATTEMPTS } }, { attempts: { $gte: PRINT_MAX_ATTEMPTS } }],
  })
    .select(PRINT_LIFECYCLE_SELECT)
    .limit(PRINT_SWEEP_BATCH)
    .lean<PrintLifecycleRow[]>();
  for (const row of tired) {
    const job = lifecycleOf(row);
    const plan = planLimits(job, nowMs);
    if (plan.ok && (await applyPrintJobPlan(row._id, job, plan.patch))) result.failed += 1;
  }

  // 4. Retention, unchanged (it keeps its own 5-minute throttle).
  await prunePrintJobsThrottled(nowMs);

  // A job back in the queue gets a nudge, so its device leases now (fire-and-forget; the poll is the safety net).
  // A repaired job announces itself (createOrderPrintJobs).
  if (result.requeued > 0 || result.retargeted > 0) publishCafeEvent("print-job");
  return result;
}

// Per-instance throttle state, like prunePrintJobsThrottled's: a cold start merely re-arms it.
let lastSweepAtMs = 0;

/** At most once per 60 s per instance. Best-effort: it never fails the request it rides on. */
export async function sweepPrintJobsThrottled(nowMs: number): Promise<void> {
  if (nowMs - lastSweepAtMs < PRINT_SWEEP_MIN_INTERVAL_MS) return;
  // Claimed BEFORE awaiting, so two overlapping requests cannot both pass the check.
  lastSweepAtMs = nowMs;
  try {
    await sweepPrintJobs(nowMs);
  } catch {
    // best-effort: the next sweep (≤ 60 s) retries; lazy expiry in the lease path covers the gap
  }
}
```

- [ ] **Step 5: The host teardown dismisses only what no device may print, then sends the rest home**

In `apps/cafe/lib/print-queue.ts`, find:

```ts
 *  parked or failed slip aimed at the cleared host is not left behind with no
 *  device that may print it; never "leased" (its writer may be printing it). */
export async function dismissQueuedPrintJobsForClearedHost(dismissedBy: string): Promise<number> {
  const res = await PrintJob.updateMany(
    { status: { $in: ["queued", "needs-confirm", "failed"] }, claimedAt: { $exists: false } },
```

Replace it with:

```ts
 *  parked or failed slip aimed at the cleared host is not left behind with no
 *  device that may print it; never "leased" (its writer may be printing it).
 *  Session 1B (1A review I1 part 2): a job that names the device that asked for
 *  it is NOT dismissed — with no host that device prints its own slips (§6.6),
 *  so routeWaitingPrintJobs (print-sweep.ts) sends it back there instead. */
export async function dismissQueuedPrintJobsForClearedHost(dismissedBy: string): Promise<number> {
  const res = await PrintJob.updateMany(
    { status: { $in: ["queued", "needs-confirm", "failed"] }, claimedAt: { $exists: false }, originDeviceId: { $exists: false } },
```

In `apps/cafe/app/api/print-host/route.ts`, find:

```ts
import { dismissQueuedPrintJobsForClearedHost, prunePrintJobs } from "@/lib/print-queue";
```

Replace it with:

```ts
import { dismissQueuedPrintJobsForClearedHost, prunePrintJobs } from "@/lib/print-queue";
import { returnPrintJobsToOrigins } from "@/lib/print-sweep";
```

In `apps/cafe/app/api/print-host/route.ts`, find:

```ts
    const dismissed = await dismissQueuedPrintJobsForClearedHost(dismissedBy);

    return noStore(success({ cleared, dismissed }));
```

Replace it with:

```ts
    const dismissed = await dismissQueuedPrintJobsForClearedHost(dismissedBy);
    // Phase 1 (1A review I1 part 2): a waiting slip that names the device that asked for it goes back
    // there — with no host each device prints its own (§6.6) — and that device is nudged to lease it.
    await returnPrintJobsToOrigins(nowMs);

    return noStore(success({ cleared, dismissed }));
```

- [ ] **Step 6: Run them again, plus the live legs** (legs a–x unchanged; leg (u)'s two retargets still hold)

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-repair.test.ts lib/print-lifecycle-paths.test.ts lib/print-queue.test.ts lib/realtime-paths.test.ts lib/self-order-alert-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | tail -2`
Expected: `# tests 131` / `# pass 131`, `TSC_OK`, then `161 passed, 0 failed` (leg (u)'s two retargets still hold).

- [ ] **Step 7: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-repair.ts apps/cafe/lib/print-repair.test.ts apps/cafe/lib/print-sweep.ts apps/cafe/lib/print-queue.ts apps/cafe/app/api/print-host/route.ts apps/cafe/package.json apps/cafe/lib/print-lifecycle-paths.test.ts
git commit -m "feat(print): waiting jobs go to the device that prints them now (no host: their own device), and the sweep repairs missing server-owned KOTs"
```

---

### Task B7: live legs y–ab

**Files:** Create `apps/cafe/scripts/print-host-live/order-jobs.ts`; modify `apps/cafe/scripts/verify-print-host-live.ts`.

The legs, each against real Mongo (local mongod, `pos_scratch_*` only):
- **(y)** creation: Pay Now makes the KOT then the bill for the host, KOT first in the line, today's keys, the asking device recorded; a racing second create and an old tab's enqueue of the same KOT land on the same jobs; no host → the asking device; no host and no device (the auto-accept) → nothing; the no-host agent enqueue (DUPLICATE, idempotent).
- **(z)** repair: exactly the server-owned rounds; at the host, naming the firing device, fresh; never an old tab's round, a cancelled order or a round older than 30 min; a second sweep repairs nothing; with no host, at the firing device.
- **(aa)** host changes (I1 part 2): the teardown dismisses only the job no device asked for; with no host, queued / parked / failed go home with their state; a leased job never moves; with a host again, all three move to it.
- **(ab)** M5: a job retargeted between the read and the CAS is not leased by the old device; M2: four bad heads in one call → nothing leased, `retryAt` = now + 2 s, and the next call leases the good job.

- [ ] **Step 1: The legs**

Create `apps/cafe/scripts/print-host-live/order-jobs.ts`:

```ts
/**
 * Phase 1 Session 1B live legs — server-side job creation (y), the repair sweep (z), where a waiting
 * job prints after a host change (aa), and the lease fence and step bound (ab), against a REAL
 * MongoDB. Run by scripts/verify-print-host-live.ts after legs q–x.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { lifecycleOf, planLease } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { Order } from "@/models/Order";
import { createOrderPrintJobs, enqueueOwnPrintJob } from "@/lib/print-order-jobs";
import { dismissQueuedPrintJobsForClearedHost, enqueuePrintJob } from "@/lib/print-queue";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, leasePrintJobs, type PrintLifecycleRow } from "@/lib/print-lease";
import { routeWaitingPrintJobs, sweepPrintJobs } from "@/lib/print-sweep";
import { billPrintJob, kotPrintJob } from "@/lib/print-routing";
import { check, seedRealOrder } from "./harness";
import { HOST, STAFF, freshHost, rowOf, setRaw } from "./lifecycle";

const PHONE = "live-order-phone";
const OLD_HOST = "live-old-host";

async function orderOf(id: string) {
  const order = await Order.findById(id).lean();
  if (order === null) throw new Error("seeded order missing");
  return order;
}

/** Raw driver write on an Order (timestamps would re-stamp updatedAt; some legs fake old rounds). */
async function setOrderRaw(id: string, set: Record<string, unknown>): Promise<void> {
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: set });
}

export async function legY(nowMs: number): Promise<void> {
  console.log("\n(y) server-side creation: host or own device, KOT before bill, one job per slip");
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const order = await orderOf(orderId);
  const refs = await createOrderPrintJobs({ order, slips: [{ kind: "bill" }, { kind: "kot", round: 1 }], originDeviceId: PHONE, queuedBy: STAFF, nowMs });
  const [kot, bill] = await Promise.all([rowOf(refs[0]?.id ?? ""), rowOf(refs[1]?.id ?? "")]);
  check("(y) Pay Now makes the KOT and then the bill, both for the host", refs.length === 2 && refs[0]?.kind === "kot" && refs[1]?.kind === "bill" && refs.every((r) => r.targetDeviceId === HOST));
  check("(y) the KOT is ahead of the bill in the host's line (§7.6)", kot !== null && bill !== null && (kot.createdAt < bill.createdAt || (kot.createdAt.getTime() === bill.createdAt.getTime() && String(kot._id) < String(bill._id))));
  check("(y) each job is queued, keyed as today, and names the asking device", kot?.status === "queued" && kot?.jobKey === `kot:${orderId}:1` && bill?.jobKey === `bill:${orderId}` && kot?.originDeviceId === PHONE && kot?.epoch === 0 && kot?.log?.[0]?.event === "created");
  const again = await createOrderPrintJobs({ order, slips: [{ kind: "kot", round: 1 }, { kind: "bill" }], originDeviceId: PHONE, queuedBy: STAFF, nowMs });
  check("(y) a racing second create answers the same two jobs and makes none", again.map((r) => r.id).join() === refs.map((r) => r.id).join() && (await PrintJob.countDocuments({})) === 2);
  const oldTab = await enqueuePrintJob({ ...kotPrintJob(JSON.parse(JSON.stringify(order)), 1), queuedBy: STAFF, nowMs });
  check("(y) an old tab's enqueue of the same KOT lands on the same job, never a second slip", oldTab.outcome === "queued" && oldTab.duplicate && oldTab.id === refs[0]?.id);

  await PrintHost.deleteMany({});
  const own = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const mine = await createOrderPrintJobs({ order: await orderOf(own), slips: [{ kind: "kot", round: 1 }], originDeviceId: PHONE, queuedBy: STAFF, nowMs });
  check("(y) with no host, the asking device prints its own slip (§6.6)", mine.length === 1 && mine[0]?.targetDeviceId === PHONE && (await rowOf(mine[0].id))?.targetDeviceId === PHONE);
  const selfOrder = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const none = await createOrderPrintJobs({ order: await orderOf(selfOrder), slips: [{ kind: "kot", round: 1 }], queuedBy: STAFF, nowMs });
  check("(y) with no host and no asking device (the auto-accept) nothing is made: kot-claim prints it", none.length === 0 && (await PrintJob.countDocuments({ orderId: selfOrder })) === 0);

  const reprint = billPrintJob(JSON.parse(JSON.stringify(await orderOf(own))), { reprint: true });
  const first = await enqueueOwnPrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: "live-key-0001-own", originDeviceId: PHONE, nowMs });
  const retry = await enqueueOwnPrintJob({ ...reprint, queuedBy: STAFF, idempotencyKey: "live-key-0001-own", originDeviceId: PHONE, nowMs });
  const firstId = first.outcome === "queued" ? first.id : "";
  const ownRow = await rowOf(firstId);
  check("(y) no host: an agent's own reprint is its own job, DUPLICATE, and a retry is the same job", first.outcome === "queued" && !first.duplicate && retry.outcome === "queued" && retry.duplicate && retry.id === firstId && ownRow?.targetDeviceId === PHONE && JSON.stringify(ownRow?.labels) === '["DUPLICATE"]');
}

export async function legZ(nowMs: number): Promise<void> {
  console.log("\n(z) the repair sweep re-creates a server-owned round's missing KOT, and nothing else");
  await freshHost(nowMs);
  const owned = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await setOrderRaw(owned, { kotPrintDevices: [PHONE] });
  const oldTab = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const cancelled = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await setOrderRaw(cancelled, { kotPrintDevices: [PHONE], status: "Cancelled" });
  const late = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await setOrderRaw(late, { kotPrintDevices: [PHONE], createdAt: new Date(nowMs - 31 * 60 * 1000) });
  const mixed = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await Order.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(mixed) },
    {
      $set: { kotRounds: 2, kotPrintDevices: ["", PHONE], kotFiredAt: [new Date(nowMs - 60_000), new Date(nowMs - 30_000)] },
      $push: { items: { productId: "00000000000000000000aaa2", name: "Coffee", price: 120, qty: 1, modifiers: [], instructions: "", kotRound: 2 } },
    } as Record<string, unknown>,
  );

  const swept = await sweepPrintJobs(nowMs);
  const keys = (await PrintJob.find({}).select("jobKey targetDeviceId originDeviceId").lean()).map((r) => r.jobKey).sort();
  check("(z) exactly the two server-owned rounds are repaired", swept.repaired === 2 && keys.join() === [`kot:${mixed}:2`, `kot:${owned}:1`].sort().join());
  const repaired = await PrintJob.findOne({ jobKey: `kot:${owned}:1` }).lean();
  check("(z) a repaired KOT prints at the host, names the device that fired it, and starts fresh", repaired?.targetDeviceId === HOST && repaired?.originDeviceId === PHONE && repaired?.status === "queued" && repaired?.epoch === 0);
  check("(z) never a round its tab printed itself, a cancelled order, or a round older than 30 min", !keys.some((k) => k?.includes(oldTab) || k?.includes(cancelled) || k?.includes(late) || k === `kot:${mixed}:1`));
  const second = await sweepPrintJobs(nowMs + 60_000);
  check("(z) a second sweep repairs nothing (one job per slip, ever)", second.repaired === 0 && (await PrintJob.countDocuments({})) === 2);

  await PrintHost.deleteMany({});
  await PrintJob.deleteMany({});
  const noHost = await sweepPrintJobs(nowMs + 120_000);
  const home = await PrintJob.findOne({ jobKey: `kot:${owned}:1` }).lean();
  check("(z) with no host, a repaired KOT goes to the device that fired the round", noHost.repaired === 2 && home?.targetDeviceId === PHONE);
}

export async function legAA(nowMs: number): Promise<void> {
  console.log("\n(aa) after a host change every waiting job prints where it should (1A review I1 part 2)");
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const order = JSON.parse(JSON.stringify(await orderOf(orderId)));
  const make = async (status: string, origin: boolean, extra: Record<string, unknown> = {}) => {
    const res = await enqueuePrintJob({ ...kotPrintJob(order, null), queuedBy: STAFF, ...(origin ? { originDeviceId: PHONE } : {}), nowMs });
    if (res.outcome !== "queued") throw new Error(`seed refused: ${res.outcome}`);
    await setRaw(res.id, { status, targetDeviceId: OLD_HOST, ...extra });
    return res.id;
  };
  const queued = await make("queued", true);
  const parked = await make("needs-confirm", true, { epoch: 1, attempts: 1, uncertainAttempts: 1 });
  const stopped = await make("failed", true, { epoch: 1, attempts: 8 });
  const writing = await make("leased", true, { epoch: 1, attempts: 1, lease: { deviceId: OLD_HOST, tabId: "t", epoch: 1, expiresAt: new Date(nowMs + 90_000) } });
  const orphan = await make("queued", false);

  const torn = await dismissQueuedPrintJobsForClearedHost(STAFF);
  check("(aa) clearing the host dismisses only the job no device asked for", torn === 1 && (await rowOf(orphan))?.dismissReason === "host-cleared" && (await rowOf(queued))?.status === "queued");
  await PrintHost.deleteMany({});
  const moved = await routeWaitingPrintJobs(null, nowMs);
  const [q, p, f, w] = await Promise.all([rowOf(queued), rowOf(parked), rowOf(stopped), rowOf(writing)]);
  check("(aa) with no host, queued, parked and failed slips go back to their own device", moved === 3 && [q, p, f].every((r) => r?.targetDeviceId === PHONE) && q?.log?.at(-1)?.event === "retargeted");
  check("(aa) … keeping their state, and a leased job is never moved under its writer", p?.status === "needs-confirm" && f?.status === "failed" && w?.targetDeviceId === OLD_HOST);

  // A host is designated again: every waiting job, parked and failed ones too, now prints there.
  await setRaw(parked, { targetDeviceId: OLD_HOST });
  const rehomed = await routeWaitingPrintJobs(HOST, nowMs);
  const after = await Promise.all([rowOf(queued), rowOf(parked), rowOf(stopped), rowOf(writing)]);
  check(
    "(aa) with a host, the queued, parked and failed jobs move to it (Print again then prints there); the leased one stays",
    rehomed === 3 && after.slice(0, 3).every((r) => r?.targetDeviceId === HOST) && after[3]?.targetDeviceId === OLD_HOST,
  );
}

export async function legAB(nowMs: number): Promise<void> {
  console.log("\n(ab) the lease is fenced on the device, and a lease call that clears four bad heads says when to look again");
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const res = await enqueuePrintJob({ ...kotPrintJob(JSON.parse(JSON.stringify(await orderOf(orderId))), 1), queuedBy: STAFF, nowMs });
  const id = res.outcome === "queued" ? res.id : "";
  const row = await PrintJob.findById(id).select(PRINT_LIFECYCLE_SELECT).lean<PrintLifecycleRow>();
  const job = lifecycleOf(row!);
  const plan = planLease(job, { deviceId: HOST, tabId: "tab-a" }, nowMs);
  await setRaw(id, { targetDeviceId: PHONE });
  const won = plan.ok && (await applyPrintJobPlan(row!._id, job, plan.patch, { targetDeviceId: HOST }));
  check("(ab) a job retargeted between the read and the CAS is not leased by the old device (M5)", !won && (await rowOf(id))?.status === "queued");

  await freshHost(nowMs);
  for (let i = 0; i < 4; i++) {
    await PrintJob.collection.insertOne({ kind: "kot", status: "queued", payload: "not json", label: `bad ${i}`, queuedBy: STAFF, targetDeviceId: HOST, createdAt: new Date(nowMs - 10_000 + i), updatedAt: new Date(nowMs) });
  }
  const good = await enqueuePrintJob({ ...kotPrintJob(JSON.parse(JSON.stringify(await orderOf(orderId))), 1), queuedBy: STAFF, nowMs });
  const firstCall = await leasePrintJobs({ deviceId: HOST, tabId: "tab-a", dismissedBy: STAFF, nowMs });
  check("(ab) four bad heads in one call: nothing leased, look again in 2 s (M2)", firstCall.jobs.length === 0 && firstCall.retryAt === new Date(nowMs + 2_000).toISOString());
  const secondCall = await leasePrintJobs({ deviceId: HOST, tabId: "tab-a", dismissedBy: STAFF, nowMs: nowMs + 2_000 });
  check("(ab) … and the next call leases the good job behind them", good.outcome === "queued" && secondCall.jobs[0]?.id === good.id);
}
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
import { legV, legW, legX } from "./print-host-live/lifecycle-actions";
```

Replace it with:

```ts
import { legV, legW, legX } from "./print-host-live/lifecycle-actions";
import { legAA, legAB, legY, legZ } from "./print-host-live/order-jobs";
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
    await legX(Date.now());
  } finally {
```

Replace it with:

```ts
    await legX(Date.now());
    // Phase 1 Session 1B legs (server-side creation, repair, host changes, the lease fence).
    await legY(Date.now());
    await legZ(Date.now());
    await legAA(Date.now());
    await legAB(Date.now());
  } finally {
```

- [ ] **Step 2: Run them**

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && npx eslint scripts/print-host-live/order-jobs.ts scripts/verify-print-host-live.ts && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | tail -2`
Expected: tsc and eslint print nothing, then `181 passed, 0 failed`: Session 1A's 161 plus 20 (y 8, z 5, aa 4, ab 3).

- [ ] **Step 3: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/scripts/print-host-live/order-jobs.ts apps/cafe/scripts/verify-print-host-live.ts
git commit -m "test(print): live legs y-ab: server-side creation, the repair sweep, host changes, the lease fence and step bound"
```

---

### Task B8: full verification, builds, the E2E exit check, Results

**Files:** Modify this plan (fill in **Session 1B Results**) and the memory file `printing-redesign-2026-10.md`.

- [ ] **Step 1: Every suite**

```bash
cd /d/kd/lucifer/packages/shared && npm test 2>&1 | grep -E "^# (tests|pass|fail)"; npx tsc --noEmit -p .
cd /d/kd/lucifer/apps/cafe && npm test 2>&1 | grep -E "^# (tests|pass|fail)|^not ok"; npx tsc --noEmit; npm run lint 2>&1 | tail -4
cd /d/kd/lucifer/apps/mobile && npx tsc --noEmit && npm run lint && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run test:app 2>&1 | grep -E "^Tests:"
cd /d/kd/lucifer/apps/desktop && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
cd /d/kd/lucifer && npm run test:print-tools 2>&1 | grep -E "^# (tests|pass|fail)"
cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | tail -3
```

Expected:
- shared: 628/628, tsc 0.
- cafe: **4019 tests, 4018 pass, 1 fail**, the known `go-live-dl` ENOENT. The 16 new tests: `print-order-jobs` 8, `print-repair` 4, `realtime-paths` +2, `print-lifecycle-paths` +2. Account for any other difference in Results.
- cafe: tsc 0; lint 0 errors and the 2 old warnings.
- mobile: tsc 0, lint 0, node 114/114, Jest 3/3 (untouched). desktop: 191/191 (untouched). print tools: 7/7.
- live legs: `181 passed, 0 failed`.

- [ ] **Step 2: The Next production build**

Run: `cd /d/kd/lucifer/apps/cafe && npm run build 2>&1 | tail -15`
Expected: the build succeeds; the route list is the same as Session 1A's (1B adds no route).

- [ ] **Step 3: Both APKs, x86_64 first** (exactly Session 1A's Task 10 Step 3 commands, `GRADLE_USER_HOME='D:\gradle-home'`)

Expected: `BUILD SUCCESSFUL` twice, each APK holding only its own ABI. Session 1B touches no app code, so the three hashes should equal Session 1A's (`fc4181e4…`, `9f89cd9a…`, `f3f62149…`). Record them either way.

- [ ] **Step 4: The E2E exit check** (spec §14 needs this harness in 1C–1E; a failure here is a finding, never faked)

Bring the harness up exactly as Session 1A's Task 10 Step 5, with these differences:
1. Use a fresh database `pos_scratch_e2e_1b` and a fresh `<scratchpad>/e2e.env`, generated by a scratchpad Python script with `secrets` (the 1A way), so no secret ever appears in a command, a log or this chat. Never print or commit it.
2. Seed the admin, the tables and the menu with the repo's own `seed-admin.ts`, `seed-tables.ts` and `seed-menu.ts` (`--env-file`). Build with Step 2's build, start `next start -p 3100`, the fake printer on 9100, `adb reverse tcp:3100 tcp:3100`, the emulator app on `http://localhost:3100`, sign in (TAB to the password field, check focus in a uiautomator dump first), choose the network printer `10.0.2.2:9100`, and designate the app as the print host.
3. **Old path, no header (must print exactly once):** fire one KOT from the app (a table, one item, Send to kitchen). Expected: the fake printer logs exactly one new job with `bytes > 0`. A scratchpad script (projection without `payload`) shows the newest PrintJob `status: printed`, no `originDeviceId`, `jobKey: kot:<orderId>:1`, and the order has **no** `kotPrintDevices`. The server created nothing, so the old claim path printed the tab's own enqueue once.
4. **New path, with the header (server-side creation):** a scratchpad Node script (run from `apps/cafe` with `--env-file`, `--import tsx`) mints a session cookie instead of typing a password:
   - it reads `AUTH_SECRET` from the env file itself and finds `e2eadmin`'s `_id` and role in `pos_scratch_e2e_1b`;
   - it encodes `{ name, id, role, lastValidated: Date.now() }` with `encode` from `next-auth/jwt` (salt and cookie name `authjs.session-token`, the plain-http name) and sends it as that cookie;
   - it never prints the secret, the token or the env file.
   With it the script `POST`s `/api/orders` (a table, one item, a fresh `idemKey`) with `x-pos-print-agent: 1` and `x-pos-device-id: e2e-script-device`, and prints only: the HTTP status, `printJobs` (expected: one `kot` ref aimed at the host's device id), and the new order's `kotPrintDevices` (expected `["e2e-script-device"]`). Expected at the fake printer: exactly one more job with `bytes > 0`, printed by the app's old claim drain (the host is a tab from before Phase 1, exactly the rollout case).
5. **A replay creates nothing:** the script re-sends the same body and `idemKey`. Expected: 200 with the same order and no `printJobs`, no new PrintJob row, no new paper.
6. **No header on the new routes stays today's behaviour:** the script `POST`s one more order without the headers. Expected: no `printJobs` key in the answer, no PrintJob row, no `kotPrintDevices` (nothing printed: no tab enqueued it, which is exactly what an old tab would have done itself).
7. If the permission layer refuses the script (it reads a secret from a file), stop and record it in Results with the exact refusal; do not work around it.
8. Clean up: `adb reverse --remove-all`; stop the POS and the fake printer by PID (`Stop-Process`); `pm clear com.possoftware.pos`; `adb emu kill`. Leave `pos_scratch_e2e_1b` and its env file for 1C and say so in Results.

`adb logcat -b crash` must stay empty for the whole step.

- [ ] **Step 5: Results, memory, commit**

Fill in **Session 1B Results** below (every command and its totals; each changed existing pin and why; the live-leg count; the APK paths, sizes and hashes; the E2E findings with screenshot paths; every deviation and why; open issues). Update the memory file `printing-redesign-2026-10.md`: Session 1B done with its last commit, and the next step (the 1B review gate).

```bash
cd /d/kd/lucifer
git add docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md
git commit -m "docs(print): Phase 1 Session 1B results"
git log --oneline -12
```

Do **not** push, merge or start Session 1C. Report to the owner in Hinglish, then stop.

---

## Session 1B Results (filled in by the implementer)

Executed on 2026-10-03 on `feat/printing-reliability` (inline, superpowers:executing-plans, TDD per task). Not pushed, not merged. `<scratchpad>` below is this session's scratchpad, `C:\Users\KARTIK~1.DES\AppData\Local\Temp\claude\d--kd-lucifer\f6140a3c-2fb8-4a2f-84d2-32a2924dba6d\scratchpad`.

### Commits (505944b..HEAD)

| Task | Commit | Subject |
|---|---|---|
| B1 | `0197f37` | feat(print): opt-in headers for server-side printing, the one-poller rule, and the realtime budget |
| B2 | `4fbb9fa` | feat(print): a print-status realtime kind (job id, status, device; no order content) with Worker parity |
| B3 | `c14069a` | fix(print): the lease CAS is fenced on its device, a spent lease call says when to look again, the lease heartbeat is best-effort; final states publish print-status |
| B4 | `def3829` | feat(print): server-side print-job creation under today's job keys, and the kotPrintDevices repair marker |
| B5 | `ec81f13` | feat(print): order routes create their slips server-side when the call site opts in; the auto-accept queues its KOT for the host |
| B6 | `1939d8b` | feat(print): waiting jobs go to the device that prints them now (no host: their own device), and the sweep repairs missing server-owned KOTs |
| B7 | `53f8f0b` | test(print): live legs y-ab: server-side creation, the repair sweep, host changes, the lease fence and step bound |
| Final review C1 | `4f2d428` | fix(print): the auto-accept makes no print job until Session 1C, because the host's self-order lane prints its KOT itself |
| Final review I1 | `2f3b971` | fix(print): the repair reads past a rush (batch 100, pinned), so an older tab's missing KOT is not starved |
| B8 | this commit | docs(print): Phase 1 Session 1B results |

Code is unchanged between `aeef4b1` (the pre-validation base) and `505944b`; only docs changed. Every Create, Append, Replace and "Replace the whole of" block of B1–B7 was applied by a scratchpad script (`apply_plan.py`) that copies the plan's fenced blocks verbatim and refuses unless each "find" matches exactly once. Every find matched once. The fresh final reviewer independently checked the four created files line for line against the plan (0 lines missing).

### Per-task RED → GREEN (every Expected line compared)

| Task | RED (as the plan said) | GREEN (as the plan said) |
|---|---|---|
| B1 | `SyntaxError … does not provide an export named 'PRINT_REALTIME_BASE_PER_DAY'`, `# tests 1` / `# pass 0` / `# fail 1` | `print-budget` 8/8; shared `npm test` 628/628; tsc 0 |
| B2 | `realtime-paths` 48 / 46 / 2 | 48/48; cafe tsc 0 |
| B3 | `not ok 1`, `not ok 16`, `not ok 17`; 46 / 43 / 3 | the four files 102/102; tsc 0; live legs `161 passed, 0 failed` |
| B4 | `Cannot find module '@/lib/print-order-jobs'`, 1 / 0 | 21/21; tsc 0; eslint clean |
| B5 | 68 / 61 / 7 (the 4 route pins, the 2 `write-route-paths` answer pins, the move's answer pin) | the five files 171/171; tsc 0; lint `✖ 2 problems (0 errors, 2 warnings)` |
| B6 | `Cannot find module '@/lib/print-repair'`, then 18 / 16 / 2 | the five files 131/131; tsc 0; live legs `161 passed, 0 failed` |
| B7 | n/a: the legs verify the code B3–B6 landed | tsc and eslint silent; live legs `181 passed, 0 failed` (y 8, z 5, aa 4, ab 3) |
| Fix C1 | the rewritten auto-accept pin failed (`not ok 7`) | 64/64 (`print-order-jobs`, `print-repair`, `order-request-paths`) |
| Fix I1 | the new batch pin failed (`not ok 13`); leg (ac) `FAIL`, live legs `182 passed, 1 failed` | live legs `183 passed, 0 failed` |

### Step 1: every suite

| Suite | Command | Result |
|---|---|---|
| shared | `npm test`; `npx tsc --noEmit -p .` | 628/628; tsc 0 |
| cafe | `npm test` | **4020 tests, 4019 pass, 1 fail**: the known `go-live-dl` ENOENT (`.claude/plan/v2/_research/cb-dl2-decisions.md` missing on this PC). At `53f8f0b`, before the review fixes, it was exactly the plan's 4019 / 4018 / 1. The +1 is the I1 batch pin. |
| cafe | `npx tsc --noEmit`; `npm run lint` | tsc 0; 0 errors, the 2 old warnings in `lib/masters-blob.test.ts` |
| mobile | `npx tsc --noEmit`; `npm run lint`; `npm test`; `npm run test:app` | tsc 0; lint 0; 114/114; Jest 3/3 (untouched) |
| desktop | `npm test` | 191/191 (untouched) |
| print tools | `npm run test:print-tools` | 7/7 |
| live legs | `MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live` | **`183 passed, 0 failed`**: the plan's 181 at `53f8f0b`, plus leg (ac)'s 2 checks from fix I1 |

The mobile, desktop and print-tools runs were at `53f8f0b`; the review fixes touch only `apps/cafe` and docs.

### Changed existing pins (each follows a deliberate change in this plan)

1. **`print-lifecycle-paths.test.ts`, "every lifecycle transition is ONE compare-and-set…"** (B3): follows `applyPrintJobPlan`'s optional fence (M5) and its print-status publish after a landed final transition.
2. **`print-queue-fixes.test.ts`, the prune filter #1 pin** (B3, M9): wording only; the assertions are unchanged.
3. **`self-order-alert-paths.test.ts`, `EXPECTED_PRINT_JOB_WRITERS`** (B4): gains `print-order-jobs.ts` (one `PrintJob.create` under today's unique `jobKey`), and the sweep comment covers the routing `updateMany`s.
4. **`write-route-paths.test.ts`, the settle success answer and the create answer** (B5): both answers now go through `withPrintJobs(…, printJobs)`.
5. **`realtime-paths.test.ts`, the move's answer pin** (B5): `return success(withPrintJobs(moved, printJobs));`.
6. **`print-lifecycle-paths.test.ts`, the sweep-order pin** (B6): routing waiting jobs and the repair step; the sweep file now has two `print-job` publishes (its own nudge and the host teardown's).
7. **`print-order-jobs.test.ts`, the auto-accept pin** (fix C1; a pin B5 created): now asserts the host-lane premise and that the auto-accept makes no print job in 1B.

### Step 2: Next production build

`npm run build`: success at `53f8f0b` and again at the final HEAD after the review fixes. Both list 123 routes, including `/api/print-jobs`, `/api/print-jobs/lease`, `/api/print-jobs/wake`, and `/api/print-jobs/[id]/ack`, `/claim`, `/confirm`, `/dismiss`, `/retry`. Session 1B adds no route file, so the route list is Session 1A's.

### Step 3: APKs (x86_64 first, then ARM; `GRADLE_USER_HOME='D:\gradle-home'`)

Both builds reported `BUILD SUCCESSFUL` (1 m 32 s, then 54 s). Each APK holds only its own ABI. **All three are byte-identical to Session 1A's** (1B touches no app code).

| APK | Path | Size | SHA-256 |
|---|---|---|---|
| Emulator only (x86_64) | `<scratchpad>/pos-emulator-x86_64-release.apk` | 7,407,761 B | `fc4181e4f20799576277c7be312316d34d46db23b286bad6b13fec1cad5f13d3` |
| Client, arm64-v8a | `apps/mobile/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk` | 7,276,038 B | `9f89cd9a172b2ab8d5b72872bca947c44ae3c7c74c3a33dfc118e9c00e180ff7` |
| Client, armeabi-v7a | `apps/mobile/android/app/build/outputs/apk/release/app-armeabi-v7a-release.apk` | 6,683,872 B | `f3f6214982c9122dbc7c28f415d7a478a8aef392b834bf8213cb909c73f426cc` |

### Step 4: the E2E exit check (local POS + emulator app + fake printer). Passed.

AVD `Pixel_7_API_33`, WebView 109.0.5414.123, booted in about 15 s with `-memory 4096 -no-snapshot -no-boot-anim`. Screenshots are in `<scratchpad>/shots/`. `adb logcat -b crash` stayed empty for the whole step.

1. **Bring-up.** Ports 3100 and 9100 were free. `<scratchpad>/e2e.env` (database `pos_scratch_e2e_1b`, checked absent first) was written by `<scratchpad>/make-env.py` using `secrets`; it was never printed or committed. `seed-admin.ts` created `e2eadmin`; `seed-tables.ts` seeded T-1…T-8; `seed-menu.ts` seeded 4 categories and 8 products. `next start -p 3100` from the Step 2 build: Ready, `/login` → 200. The fake printer listened on `127.0.0.1:9100`. `adb reverse tcp:3100 tcp:3100`.
2. **App.** `pm clear`, address `http://localhost:3100` → login (`1b-02-login.png`). Username typed, then TAB; a uiautomator dump showed the focused EditText with `password="true"` before `<scratchpad>/type-secret.py` typed the secret (it re-checks the focus itself and prints only the length). Signed in → Dashboard (`1b-03-signed-in.png`). Printer panel → network printer `10.0.2.2` : `9100` → "Network printer 10.0.2.2 is connected." (`1b-04-network-printer.png`; the fake printer logged the 0-byte connect probe). "Print all slips on this device" → "This device prints all slips." (`1b-05-host-designated.png`). Android's "always run in background?" prompt did not appear this time (Session 1A saw it once).
3. **Old path, no header: printed exactly once.** New Order → T-1 → Masala Chai → Send to Kitchen (`1b-07-cart.png`, `1b-08-kot-sent.png`). The fake printer logged exactly one new job, `bytes: 40494`. `<scratchpad>/e2e-state.ts` (projection without `payload`): the only PrintJob is `kind: kot`, `status: printed`, `jobKey: kot:<orderId>:1`, `originDeviceId: null`, target = the host, `epoch 0`, `attempts 0`, `labels []`, log `[created]`, `claimedBy` set, `printedAt: null`. Order `ORD-20261003-001` has **no** `kotPrintDevices`. The server created nothing.
4. **New path, with the header: server-side creation.** `<scratchpad>/e2e-header.ts header` (run from `apps/cafe` with `--env-file` and `--import tsx`) minted the session cookie itself: it read `AUTH_SECRET` from the env, found `e2eadmin` in `pos_scratch_e2e_1b`, encoded `{ name, id, role, lastValidated }` with `next-auth/jwt`'s `encode` (salt and cookie `authjs.session-token`), and printed no secret or token. The permission layer did not refuse it. `POST /api/orders` (T-2, Masala Chai, a fresh `idemKey`) with `x-pos-print-agent: 1` and `x-pos-device-id: e2e-script-device`: **201**, `printJobs: [{ kind: "kot", targetDeviceId: <the host's device id>, label: "KOT round 1 · T-T-2" }]`, and order `ORD-20261003-002` has `kotPrintDevices: ["e2e-script-device"]`. The fake printer logged exactly one more job, `bytes: 40494`, printed by the app's old claim drain (the host is a tab from before Phase 1, exactly the rollout case).
5. **A replay creates nothing.** The same body and `idemKey` again: **200**, the same order, no `printJobs` key, PrintJob rows 2 → 2, no new paper.
6. **No header stays today's behaviour.** One more order (T-3) without the headers: **201**, no `printJobs` key, 0 PrintJob rows for it, no `kotPrintDevices`, no paper.
7. No permission refusal.
8. **Cleanup.** `adb reverse --remove-all`; the POS (PID 14988) and the fake printer (PID 26396) stopped with `Stop-Process` (ports confirmed free); `pm clear com.possoftware.pos`; `adb emu kill`.
   - **Left for 1C:** `pos_scratch_e2e_1b` holds `e2eadmin`, 8 tables, 4 categories and 8 products, orders `ORD-20261003-001` (T-1, the app), `-002` (T-2, header) and `-003` (T-3, no header), 2 PrintJobs, and a PrintHost pointing at the emulator app's old device id (`5e81d019-…`; `pm clear` gave the app a new id, so 1C must clear or re-designate the host).
   - The env file stays at `<scratchpad>/e2e.env`. If 1C cannot read this scratchpad, use a fresh `pos_scratch_e2e_1c` and its own env file.

### Final whole-branch review (fresh reviewer subagent, Opus, `505944b..53f8f0b`)

**Verdict: "With fixes". Critical 1, Important 2, Minor 7, Declined 10.** The reviewer confirmed:
- the header opt-in (no headers: the very same answer object; replays, 409s, 400s and the unconfirmed-bill-number 500 return before any creation);
- creation never fails a landed order;
- today's keys dedupe a server job against an old tab's enqueue, and the legacy claim and the lease exclude each other;
- the repair's bounds and idempotency;
- R5's pipeline routing (never a leased job);
- M1, M2, M5 and M9 as ruled;
- no order content in `print-status`.

Re-graded by effect on a cafe:

- **C1, fixed (`4f2d428`).** Every auto-accepted QR self-order in host mode printed its KOT twice, and this was the one flow 1B made live (R4). The plan's premise holds only for the page lanes, which enqueue to the host under the same key. The print host's own self-order lane (`PrintHostDrain.tsx:67`, `hostLane`) wins `/kot-claim` and prints the KOT locally through its bridge (`use-print-host-bridge.ts:215-217`, `queueSlip(kotRoundSlip(…))`) with no job. The auto-accept leaves `kotPrintedAt` unstamped (by R4's design), so the request stays in the pulse's self-order list (`pos-pulse.ts:94-99`) and the lane claims it after the server's job has already printed.
  - Confirmed by reading the code.
  - **Fix:** the auto-accept block is reverted to its exact `505944b` text, so it answers as before Phase 1. R4 moves to Session 1C, where the host lane becomes job-aware. Spec §7.10 records it under R4.
  - Test: the rewritten auto-accept pin asserts the host-lane premise and that the auto-accept makes no job. RED → GREEN.
  - 1B therefore changes no flow before 1C. The plan's "the only flow 1B changes" no longer applies.
- **I1, fixed (`2f3b971`).** The repair read only the 20 newest candidates each sweep, and most of them already have their jobs. At a rush, an older tab's missing round left the 30-minute window before the repair reached it, a silently lost KOT once 1C writes the marker.
  - **Fix:** `PRINT_REPAIR_BATCH` 20 → 100. That is a busy day's half hour at 4× the average, twice over, capped at 100 for §17. The cost is one indexed read of at most 100 tiny projections per sweep.
  - Tests: a unit pin in `print-repair.test.ts`, and live leg (ac), where an older tab's missing round sits behind 30 newer orders. RED (`182 passed, 1 failed`) → GREEN (`183 passed, 0 failed`).
- **I2** was C1's test gap. It is covered by the C1 pin.

**Deferred minors** (none fixed; for the 1C gate):
- M-a: a host-clear race. `enqueuePrintJob` orphan-dismisses a new keyed row even when it has an `originDeviceId`, then `enqueueOwnPrintJob` collides with that dismissed row and answers `already-resolved`, so the slip prints nowhere. Dormant until 1C sends the header.
- M-b: `DELETE /api/print-host` can answer 500 after it committed if `returnPrintJobsToOrigins` throws. The sweep redoes it.
- M-c: with no host, jobs sent home are announced with a broadcast `print-job`, not a `print-status` aimed at their device (R7).
- M-d: `PrintJobRef` carries no status, so a deduped ref to a printed or dismissed job reads as fresh. This is the safe direction.
- M-e: host-mode `enqueuePrintJob` publishes no `"queued"` `print-status`.
- M-f: staff-accept rounds made by the server never write `kotPrintDevices`, so they are never repaired.
- M-g: the repair counts a duplicate-key collision as repaired (count only).

**Declined to judge, as ruled:**
1. The cancel notice stays client-started (plan decision 9).
2. No-host mode has no sweep until 1D's pulse sweep, because only the host polls (R6). 1C must not reach cafes without 1D; they release together at 1E.
3. Bills, voids and moves are not repaired (R3 by design).
4. The moved slip's key uses the server's `movedAt`, so the 1C client must re-send by ref, not rebuild.
5. `print-status` sends job and device ids over the public `/join` socket. Sanctioned by spec §10 and R7: no order content. For owner awareness.
6. `x-pos-device-id` and the lease `deviceId` are not credentials. This stays within the existing trust model (signed-in staff only).
7. A repaired KOT queues behind newer slips and is rebuilt from the current order. Accepted by design.
8. `PRINT_REALTIME_BASE_PER_DAY` (335) comes from the spec; 1E measures it.
9. The wake POST still returns the divided cap. Harmless; the 1C agent decides.
10. The 1C client behaviours are out of 1B by plan.

### Deviations from the plan, each with its reason

1. The ledger was kept in the session scratchpad, and the skill's `sdd-workspace` / `task-start` / `task-done` scripts were not used. They write to `.superpowers/sdd/`, which the owner's rules say to leave alone. Each task's tests were run and recorded by hand instead.
2. Fix C1 reverts B5's auto-accept block (ruling R4 deferred to 1C), with a note under R4 in spec §7.10. Without it, every auto-accepted QR KOT in host mode prints twice.
3. Fix I1 raises `PRINT_REPAIR_BATCH` from the plan's 20 to 100, pins it, and adds live leg (ac). This adds 1 cafe test and 2 live checks (cafe 4019 → 4020; live 181 → 183).
4. **Test messages.** The diff has no message-less `assert.ok` or `assert(value)`, the class that hangs a big file under tsx (G2), and every assertion written in this session carries a message. The plan's verbatim blocks also hold 38 message-less `assert.equal` / `deepEqual` / `match` calls. They were left as written: those build their failure message from the values and never parse the source.
5. The scratchpad header script failed once before sending any request: `import.meta.url`'s pathname kept `%7E` for the 8.3 path's `~`. It was fixed with `fileURLToPath` plus a `disconnect` in `finally`, and the session's own hung process was stopped by PID.
6. The Next build was re-run at the final HEAD after the fixes.

### Open issues

- **For the 1C gate:**
  - R4: make the host's self-order lane job-aware (or retire it for the agent), then let the auto-accept queue its KOT, with a live leg that runs the auto-accept with a host.
  - M-a, M-c, M-d, M-e and M-f.
  - Declined item 2: 1C ships with 1D.
  - **I2 is still the owner's decision**; nothing was implemented for it.
- **Minors** M-b and M-g.
- **Pre-existing, cosmetic, not 1B, fixed after the owner's answer (see below):** the band label read "KOT round 1 · T-T-2" when a table is named "T-2".
- **Known, unrelated:** `lib/go-live-dl.test.ts` ENOENT.
- **Still the owner's call:** the Phase 0 review's recommended hotfix of `7edf7aa` to `main`.

### Follow-ups after the owner's answers (2026-10-03)

- **Push.** The owner asked for the branch to be pushed, always with the owner's token and never the main account. `origin` now has `feat/printing-reliability`. The token is used through a repo-local credential-store file outside the repo, and the system Git Credential Manager is turned off for this repo. The token is never in the repo.
- **`origin/main` merged into the branch** (`--no-ff`): two Settings commits (`cbcfa99`, `52eaad2`), no conflict. Re-run on the merged tree: shared 629/629, tsc 0; cafe 4045 tests, 4044 pass, 1 known fail; tsc 0; lint 0 errors and the 2 old warnings; live legs `183 passed, 0 failed`; Next build success (123 routes); mobile 114/114; desktop 191/191.
- **The table label (owner answer 3).** The label is UI-only: the stale band rows and the readback chip show it, and paper never does (KOTReceipt prints the raw `tableNo`). `seed-client.ts` names every client's tables `T-1`, `T-2`, …, so live screens read "T-T-1". `printJobOrderRef` now prefixes `T-` only to a bare number ("4" → "T-4") and shows any other name as written.
  - Test: a new `print-readback.test.ts` case, RED → GREEN.
  - Re-run: cafe 4046 tests, 4045 pass, 1 known fail; lint 0 errors; live legs 183/0.

### Owner decisions after Session 1B (2026-10-03, for the 1B review gate; to be written into the spec there)

1. **I2, decided.**
   - While a printer is off or offline, make **no automatic attempts** at all. Every waiting slip shows in one clear panel with **Retry** and **Clear**, with a simple UI that is easy to understand and manage.
   - When the printer is ready, a slip gets **at most 2 attempts**: the first, plus one labelled retry (REPRINT, or for a bill the cashier's DUPLICATE prompt). After that it is Failed and waits in the same panel.
   - This replaces spec §7.2 / §7.8's `attempts ≥ 8` and `uncertainAttempts ≥ 3`. The gate decides the exact counting: refusals while offline must not burn attempts, and the agent must not lease while its printer is known to be disconnected.
2. **R4 and load.** What is live today works, so it must stay that solid. No heavy server load and no continuously running processes. R4 (the auto-accept's job) comes back in 1C only with a job-aware host lane and no added load; otherwise the live lane stays as it is.
3. **The table label:** fixed in `25c5e95` (UI-only; paper was always right).
4. **Nothing is deployed until every phase is done.**
   - Everything is built and verified on the owner's PC (local POS, emulator, fake printer), then deployed to all live clients together.
   - Spec §17.3 item 5 (a measured scratch deployment) therefore becomes a local measurement: request counts per slip and per minute, plus timed handlers, extrapolated to the busy day.
5. **The `7edf7aa` hotfix to `main` is approved** for the next session. It goes on a hotfix branch from `origin/main`, gets the full mobile checks, both APKs and an emulator check, and is then pushed to `main` with the token. Nothing that works today may break.

---

## Session 1B review (gate, 2026-10-03)

**Verdict: PASS.** Session 1B (`505944b..9a09170` on `feat/printing-reliability`, including the merge `cc73817` of `origin/main` `52eaad2`, the C1 fix `4f2d428`, the I1 fix `2f3b971` and the label fix `25c5e95`) is complete and correct. This review found no new Critical or Important defect in the code that landed. Its open items are ruled in the next section, and the owner's decisions after 1B are written into spec §7.2, §7.8, §7.10, §10, §14 and §17.3.

Nothing below was taken from the Results section; each line was re-run or re-read at the gate.

| Check | Re-run at the gate (`9a09170`) | Session 1B Results |
|---|---|---|
| shared `npm test`; `tsc` | 629/629; 0 | same (after the merge) |
| cafe `npm test` | 4046 tests, 4045 pass, 1 fail: the known `go-live-dl` ENOENT | same |
| cafe `tsc`; `npm run lint` | 0; 0 errors and the 2 old warnings (`masters-blob.test.ts`) | same |
| mobile `tsc`; lint; `npm test`; `test:app` | 0; 0; 114/114; Jest 3/3 | same |
| desktop `npm test` | 191/191 | same |
| `npm run test:print-tools` | 7/7 | same |
| live legs (local mongod) | `183 passed, 0 failed` | same |
| Next build | success, 123 routes, every print-jobs route listed | same |
| APKs (`GRADLE_USER_HOME='D:\gradle-home'`, x86_64 first) | `BUILD SUCCESSFUL` (1 m 20 s, 47 s); x86_64 7,407,761 B `fc4181e4…5f13d3`; arm64-v8a 7,276,038 B `9f89cd9a…0ff7`; armeabi-v7a 6,683,872 B `f3f62149…426cc` | byte-identical |
| Emulator spot-check (AVD `Pixel_7_API_33`, WebView 109.0.5414.123) | item 1: "Connect to your workspace"; item 5: `https://does-not-exist.example.com` → "Could not open the POS" / "The app is trying again by itself.", the same PID (2939) at 15 s and 60 s; `adb logcat -b crash` empty | items 1/5/7 pass |
| Secrets | `git log -p 505944b..9a09170` (4,162 lines): no token, `github_pat_`, `AUTH_SECRET=…`, session token or private key; a scratchpad script compared every value of 1B's `e2e.env` against the patch and printed only "absent" for each | — |

**Code read.** Every commit of the range, including the two docs commits. In particular:
- **The merge `cc73817`** is a clean auto-merge: `git merge-tree --write-tree 98e0d50 52eaad2` gives the commit's own tree (`31001bd8…`), so nothing was changed by hand in it.
- **The C1 fix `4f2d428`** reverts the auto-accept to its exact `505944b` text (`git diff 505944b HEAD -- apps/cafe/lib/order-request-create.ts` is empty), so 1B changes no live flow before 1C. Its rewritten pin asserts the host-lane premise.
- **The I1 fix `2f3b971`**: `PRINT_REPAIR_BATCH` 100 is pinned against the busy day (two rushes of four times the average half hour), and leg (ac) repairs an older tab's round behind 30 newer orders.
- **The label fix `25c5e95`** only changes `printJobOrderRef`, which feeds the band rows and the readback chip; paper prints the raw `tableNo` (KOTReceipt), so no slip changed.
- The `print-status` envelope reaches devices unchanged: the Worker relays the signed body as it is (`/publish` → `CAFE_ROOM.publish`), and `job` carries only an id, a status and a device id.

**Gate findings** (from this review, the main hotfix, and pre-validating Session 1C):
- **G4 (found by the gate's own E2E run of the 1C code; fixed in the 1C plan).** The first draft of the agent's `flushAcks` stored an async body's promise after that body had already finished (the page flushes at mount with nothing pending), so every later "printed" ack was silently dropped, every slip's lease expired, and each slip printed a second, REPRINT copy. The emulator showed it exactly: `created → leased → expired → leased (REPRINT) → failed (limits)`, then, after a reload, `late-ack` from the pending store. Fixed with `sendPending().finally(...)`; the regression test was proven RED on the old code (Task C3). This is why the gate now runs a plan's client code end to end before handing it over.
- **G5 (pre-existing, not 1B; owner awareness).** On the Android app's TCP lane, a printer that cuts the connection mid-slip reads as **printed**: the whole raster (about 40 KB) is buffered before the cut, and `TcpTransport.kt` treats a reset after the bytes were flushed as success. The fake printer's `--drop-after 2000` therefore never reaches the "maybe" path on Android, and spec §14's "a dropped connection mid-KOT prints a REPRINT copy" cannot be shown there. It is today's behaviour too (no regression). The 1C exit proves the maybe path through a lost ack instead (Task C6 Step 4, items 4 and 5), and detecting a cut on LAN is the post-job `DLE EOT` check (spec §9.6, §10, Phase 3).
- **G6 (environment).** A Next production build in a scratch clone on C: whose `node_modules` are junctions into D: fails (`Can't resolve './D:/…/next/dist/client/next.js'`). A real copy of `node_modules/next` in the clone fixes it; the other junctions can stay. Written to the build-environment memory.
- **G7 (the main hotfix).** `origin/main` moved during the session (`1579de7`, the owner's Settings › Bill print change, cafe-only). The hotfix was rebased onto it; its mobile tree stayed identical, the mobile checks were re-run, and the rebuilt x86_64 APK came out byte-identical (`beb718db…`). See "Main hotfix" below.

**Pre-validating 1C end to end** (the golden build of the POS on `localhost:3100`, the branch APK on the emulator, the fake printer on 9100, database `pos_scratch_e2e_1cgate`, env generated by `secrets`; screenshots `e2e-01…09` in the gate's scratchpad):
1. No host: a KOT from the app made one job for the app itself, which leased, printed (40,494 bytes) and acked: `created → leased → printed`, `printedAt` set, in about 8 s. No `printdevices` row: nothing polled the wake (R6).
2. The printer off: one lease and one `failed(not sent: …)`; the job stayed `queued`, `uncertainAttempts 0`, unlabelled; 90 s later still `epoch 1, attempts 1` (no lease while the printer was off). The printer back: printed once, unlabelled, within 15 s.
3. A lost ack (G4, before its fix): lease expiry → REPRINT copy (46,110 bytes: the banner) → a second expiry → `failed` (the two-attempt rule) → the reloaded page's pending ack → `late-ack`, `printed`.
4. Host mode, Pay Now: the KOT then the bill, in that order, each `created → leased → printed`; one `printdevices` row (`shell: android`) from the host's wake POST.
5. `--drop-after 2000`: read as printed (G5).
6. `adb logcat -b crash` stayed empty; the POS and the fake printer were stopped by PID; `pm clear`.

### Main hotfix (owner-approved): `7edf7aa` on `main`

- Branch `hotfix/webview-remount-crash` from `origin/main` (`52eaad2`); `git cherry-pick 7edf7aa`. The one conflict, `apps/mobile/src/mobile-paths.test.ts`, held Phase 0's pins 16/17 (not on `main`); only pin 18 was kept, and its added lines are identical to `7edf7aa`'s. The Kotlin diff is identical.
- Checks: mobile tsc 0, lint 0, `npm test` 110/110 (`main`'s 108 + pin 18's 2; without the Kotlin fix those two fail), Jest 1/1.
- APKs: x86_64 7,394,225 B `beb718dbd55f8659015dd81f7b5ea44f72d74c25b09efb8ca7db51a12a3b39b8`; arm64-v8a 7,262,502 B `2bd4d825bd8d313e0ac1cd2e956c8690509008deb7ba8de67b436fc99f443fbd`; armeabi-v7a 6,670,336 B `59829454a74e626cf8de195376603029168f79a0d8ce1f5be6e1285feafb0418`.
- Emulator (`main`'s own TEST-CHECKLIST start-up list): item 1, the POS address screen; a wrong address shows "Could not open the POS" with Try again and Change address, the same PID (5564) at 15 s, 65 s and after three Try again taps (each a WebView remount; Phase 0 saw `main` crash about 17 s after any load error); item 5, Change address keeps the old address; item 7, a local-network address (`http://10.0.2.2:8097`, a scratchpad page) opens, and a reopen goes straight to it. A server swap mid-load remounted the WebView again with no crash. `adb logcat -b crash` empty throughout.
- `origin/main` then moved to `1579de7` (G7). Rebased; re-checked (mobile 110/110, Jest 1/1; x86_64 rebuilt byte-identical).
- **Pushed** with the token, fast-forward only: `1579de7..fa7fab3 main`.
- Merged into the branch: `0158ef3` (`--no-ff`; the duplicate pin-18 conflict resolved by keeping the branch's copy). Re-run on the merged tree: shared 629/629, tsc 0; cafe 4060 tests, 4059 pass, 1 known fail (the +14 are the Bill print commit's own tests); tsc 0; lint 0 errors and the 2 old warnings; live legs `183 passed, 0 failed`; mobile 114/114, Jest 3/3; desktop 191/191; print tools 7/7; Next build 123 routes.

## 1B review gate: rulings (2026-10-03)

Every ruling that changes the spec is written into spec §7.10 ("Rulings at the Session 1B review gate"), and into §7.2, §7.8, §10, §14 and §17.3 where they apply.

**The owner's decisions after 1B**
1. **I2 → the two-attempt rule (Task C0, C3).** No automatic attempt while a printer is off or offline: the agent never leases while its device cannot print (`canPrintNow()` false: no printer, not connected, or open in another tab), and after a refusal (`sent:"no"`) it waits for the printer's state to change, or 30 s. A refusal never counts. When the printer is ready, a slip gets at most two attempts that may reach paper: the first, plus one labelled retry (REPRINT for a KOT; for a bill, the cashier's DUPLICATE prompt). The second "maybe" ends in `failed`. Exact counting: `uncertainAttempts` counts a "maybe" failure, a permanent failure after a byte left, and an expired lease; `PRINT_MAX_PAPER_ATTEMPTS = 2`; `attempts` (leases) only paces the backoff. The cashier's print again and a staff Retry each set `uncertainAttempts = 1`: one tap, one try. Pinned in `print-lifecycle.test.ts`, `print-budget.test.ts`, `print-agent.test.ts` and live leg (ad).
2. **The one waiting-slips panel lands in 1D (task D5), not 1C.** Its rows come from 1D's pulse feed (D1), and with no host only 1D's pulse sweep (D2) moves them; 1C and 1D release together, so no cafe ever runs 1C without it; and 1C is already the largest session (the agent and every call site). The panel's server actions (retry, confirm, dismiss) exist since 1A. Spec §10 now specifies it.
3. **R4 → the job-aware self-order lane (Task C2, C4).** The reviewer's option, made simpler: the agent's `/kot-claim` makes the KOT a job in the same request, instead of the auto-accept making it and the claim re-checking. One creator per KOT (the claim CAS lets exactly one lane win, old or new), so nothing can race the public auto-accept, which stays exactly as live today. A failed create keeps the claim (the D9 marker is never reopened) and names no job; the lane then enqueues the KOT under the same key. No added request or write. Live leg (ae).
4. **Load.** Nothing in 1C runs continuously on the server; no new recurring request on any ordering device: only the host polls (R6), the pulse only gains `?device=` (one more bounded read on a request that already runs), and the agent's other timers are local. Each new cadence is pinned in `print-budget.test.ts`: the 2–30 s clamp, the 30 s refusal recheck (at most one lease and one ack per stuck slip per 30 s, until it is stale), at most two attempts (four requests) per slip, and the 5 s × 10 min ack retry.
5. **Nothing is deployed until every phase is done.** Spec §17.3 item 5 and Session 1E's E3 become a local measurement (below).

**The final review's minors M-a…M-g**

| # | Finding | Ruling |
|---|---|---|
| M-a | A host-clear race orphan-dismisses a new keyed row that has an asking device; that device's own enqueue then collides with the dismissed row | **Fold, Task C2.** Such a row goes home (retargeted to its `originDeviceId`) and the answer is `queued`, so the agent follows it. Only a row no device asked for is still dismissed. |
| M-b | `DELETE /api/print-host` can 500 after it committed if `returnPrintJobsToOrigins` throws | **No change.** The sweep (and in 1D the pulse sweep) redoes the routing, and a re-sent DELETE answers `cleared: false`. Nothing is lost. |
| M-c | With no host, jobs sent home are announced with a broadcast `print-job` | **Ruled, Task C4.** With no host, agents never lease on the broadcast (no fan-out of empty leases); the pulse's `printJobsForMe` brings a job sent home to its device within 20 s, and a `print-status` aimed at a device wakes it at once. |
| M-d | `PrintJobRef` carries no status | **Fold, Task C2/C4.** The ref carries its job's status; a ref to a printed or dismissed job is followed (readback) and never leased. |
| M-e | Host-mode `enqueuePrintJob` publishes no "queued" `print-status` | **Fold, Task C2.** A new enqueued row announces itself to its target. (Not on the transient re-read path: a pin keeps that block as it is, and it still nudges.) |
| M-f | Staff-accept rounds made by the server never write `kotPrintDevices` | **Fold, Task C2.** `AcceptContext.printDeviceId` writes the marker in the same order write, on both writers (a new tab, a round on an open tab). Zero extra writes. |
| M-g | The repair counts a duplicate-key collision as repaired | **No change.** It is a count in the sweep's own result only; no behaviour reads it. |

**The final review's declined items**, ruled:
1. The cancel notice stays client-started: **confirmed.** In 1C it is enqueued as the agent (`routePrint`), so it gets the lifecycle too.
2. No-host mode has no sweep until 1D: **confirmed; 1D's D2 is mandatory**, and 1C must not reach a cafe without 1D (they release together at 1E).
3. Bills, voids and moves are not repaired: **confirmed** (R3); the 1C client enqueues any slip its answer did not name, under the same key.
4. The moved slip's key uses the server's `movedAt`: **handled**: the 1C client follows the move's ref; with no ref there is no server job, so the client's own key cannot print twice.
5. `print-status` sends job and device ids over the public `/join` socket: **accepted** (opaque ids, no order content). For the owner's awareness.
6. `x-pos-device-id` is not a credential: **accepted** (signed-in staff only, as today).
7. A repaired KOT queues behind newer slips and is rebuilt from the current order: **accepted by design.**
8. `PRINT_REALTIME_BASE_PER_DAY` (335) comes from the spec: **1E measures it locally** (E3).
9. The wake POST still returns the divided cap: **harmless.** The 1C agent spends the device's own daily cap (`PRINT_WAKE_DAILY_CAP`), and only the host polls.
10. The 1C client behaviours: **in 1C** (Tasks C3, C4).

**Gate decisions that change the spec's 1C description** (each in spec §7.10):
- The write queue (`device-printer-write.ts`) is unchanged; the agent classifies a failure by its curated sentence (`lib/print-write-outcome.ts`). The agent prints one job at a time, so "a deadline before the job started" cannot occur on its path.
- Every device with an identity prints through the agent; only a device with no identity keeps today's local print.
- The bridge reports each slip's result through a ref-held FIFO, so no pinned shape of `use-print-host-bridge.ts` changes, and the agent bounds its own wait (140 s).

**1E's E3, re-planned (owner decision 4): the free-tier check is a local measurement.** No deployment. On the owner's PC, against the local POS (`next start`) with the emulator app as host and the fake printer:
- A scratchpad counting proxy in front of the POS (Node, no dependencies) logs every request's method, path, status and duration. The soak (`print-soak.ts`, 200 orders) and a 30-minute idle run go through it.
- Server CPU: the `next start` process's CPU time (`Get-Process … CPU`) before and after each run; Mongo: `db.serverStatus().opcounters` before and after, and the peak over any 10 s window.
- Report: requests per slip, per order and per minute, by route; CPU ms per request; Mongo operations per slip and the peak ops/s. Extrapolate to the busy day (§17.2: 300 orders, 1,200 slips, 12 h).
- Pass: printing ≤ 15 % of Vercel Hobby's monthly Active CPU (4 h) and ≤ 20 % of its 1,000,000 invocations on a normal day, and Atlas M0 under 10 ops/s at peak. If not, lower the cadences before release. The local CPU per request is a proxy for Vercel's Active CPU; the report says so.

---

## Session 1C (exact code, written and pre-validated at the 1B review gate)

**Pre-validated** by the review gate on 2026-10-03, on scratchpad clones only (never in the repo):
- The code was developed on a golden copy of `0158ef3` (the merged branch), one commit per task, and this section was generated from those commits: every Create and Replace-the-whole block is the golden file byte for byte, and every find is unique in its file at the moment it is applied.
- A fresh clone of `0158ef3` then got every block of this section applied verbatim, task by task, with each task's own Run lines; each RED and GREEN below is the output seen there. The clone came out byte-identical to the golden copy (53 files).
- Totals on that clone: shared `npm test` 635/635, tsc 0; cafe `npm test` **4091 tests, 4090 pass, 1 fail** (only the known `go-live-dl` ENOENT; +31 over `0158ef3`'s 4060), tsc 0, lint 0 errors and the 2 old warnings; live legs `199 passed, 0 failed` (Session 1B's 183 + 16); the Hub's tsc 0 (`apiSend`'s new option). Mobile and desktop are untouched by 1C.
- **Re-checked after `origin/main` moved to `c05330a`** (the owner's `ebffdb5` Settings leave-guard and `c05330a` Settings > Kitchen ticket; both cafe-only): a fresh clone of `99653ac` merged it `--no-ff` cleanly (`package.json` auto-merges; the one shared file, `lib/print-host-slips.ts`, only gains `export` on `ROUND_LABEL_PREFIX`, far from 1C's anchor), then got every block of Tasks C0–C5 and C5b verbatim. Totals: shared 635/635, tsc 0; cafe **4131 tests, 4130 pass, 0 fail, 1 skipped** (the merge adds 40 tests; the skip is Task C5b's), tsc 0, lint 0 errors and the 2 old warnings; Hub tsc 0; live legs `199 passed, 0 failed`. Before C0, the merged tree reads shared 629/629 and cafe 4100 tests, 4099 pass, 1 fail (the known ENOENT).
- **The agent was run end to end** on the emulator (WebView 109, the branch APK) against the golden build of the POS and the fake printer, before this section was written. It found one real bug (gate finding G4, `flushAcks`; fixed in Task C3 and pinned). What it showed is in "Session 1B review (gate)" → "Pre-validating 1C end to end".

A failure while executing therefore points to drift since then, or to a typo while copying. Compare with the plan first.

**What 1C delivers.** The print agent. Every device with an identity prints every slip through the server's queue: lease → write → ack, retried by the server's rules, labelled when it may repeat paper, and never attempted while its printer is off. The order requests opt in (R1), so the server makes their slips in the same request, and the call sites follow those jobs instead of printing on their page. The host leases for the whole cafe; with no host, every device leases its own slips (§6.6). The owner's two-attempt rule replaces §7.8's limits. The self-order lane becomes job-aware (R4). The banner prints REPRINT / DUPLICATE. **1C must not reach a cafe without 1D:** no device shows a failed or waiting slip until 1D's panel, and with no host nothing sweeps until 1D's pulse sweep. Nothing is deployed until Phase 1 is done (owner decision 4).

**Gate rulings this section implements** (each is also in spec §7.10):
- **The owner's I2 decision (C0, C3).** At most two attempts that may reach paper per slip, the first plus one labelled retry; refusals never count; no lease while the printer is known to be off; one staff tap is one more attempt.
- **R4, replaced by the job-aware lane (C2, C4).** The claim makes the KOT a job; the public auto-accept stays exactly as live.
- **M-a** (C2): an enqueue that finds its host gone sends a row with an asking device home instead of dismissing it. **M-d** (C2): a ref carries its job's status. **M-e** (C2): an enqueued row announces itself with print-status. **M-f** (C2): a staff accept the server prints writes `kotPrintDevices` in the same order write. **M-c** (C4): with no host, agents never lease on the broadcast nudge; the pulse's `printJobsForMe` covers a job sent home.
- **M-b and M-g:** no change (rulings in "1B review gate: rulings").

**Not in 1C** (1D, the session that consumes them): the one waiting-slips panel with Retry and Clear; the pulse sweep; `myRecentJobs` and the readback states; the 20 s alarm; retry / confirm announcing their job with print-status aimed at its device.

### File map (Session 1C)

| File | Change | Task |
|---|---|---|
| `packages/shared/src/print-lifecycle.ts`, `print-lifecycle.test.ts` | the two-attempt rule | C0 |
| `apps/cafe/lib/print-sweep.ts` | the limits query | C0 |
| `apps/cafe/lib/print-write-outcome.ts` (+ test) | create: a failure's class | C1, C4 |
| `apps/cafe/lib/print-agent-server.ts` | create: the job-aware claim, the pulse device | C2 |
| `apps/cafe/app/api/order-requests/[id]/kot-claim/route.ts`, `pulse/route.ts` | the agent claim; `printJobsForMe` | C2 |
| `packages/shared/src/print-agent-wire.ts` | `PrintJobRef.status` (C2); the agent's constants and gate (C3) | C2, C3 |
| `packages/shared/src/self-order-alert.ts` | `PosPulseData.printJobsForMe?` | C2 |
| `apps/cafe/lib/print-order-jobs.ts`, `print-queue.ts` | M-d; M-a, M-e | C2 |
| `apps/cafe/lib/order-request-accept.ts`, `-addround.ts`, `accept/route.ts` | M-f | C2 |
| `apps/cafe/lib/print-agent.ts`, `print-agent-wake.ts` (+ `print-agent.test.ts`) | create: the agent core | C3, C4 |
| `packages/shared/src/api-client.ts`, `apps/cafe/lib/realtime-client.ts` | request headers; the parsed frame | C3 |
| `packages/shared/src/print-budget.test.ts` | five budget pins | C3 |
| `apps/cafe/hooks/use-print-agent.ts`, `lib/print-agent-calls.ts`, `lib/print-host-outcomes.ts`, `components/pos/PrintBanner.tsx` | create | C4 |
| `apps/cafe/components/print/PrintHostDrain.tsx` | replace: the agent | C4 |
| `apps/cafe/components/layout/PrintHostProvider.tsx`, `hooks/use-print-host-bridge.ts`, `lib/print-host-slips.ts` | the bridge reports each slip; the banner field | C4 |
| `apps/cafe/components/pos/KOTReceipt.tsx`, `OrderReceipt.tsx`, `PrintSources.tsx`, `components/print/PrintHostPrintSources.tsx` | the banner | C4 |
| `apps/cafe/hooks/use-host-routing.ts`, `use-print-routing.ts`, `use-print-host.ts`, `use-orders.ts`, `use-item-void.ts`, `use-order-requests.ts`, `use-settle-flow.ts`, `use-pos-tab.ts`, `use-self-order-auto-print.ts`, `use-pos-pulse.ts` | the call sites | C4 |
| `apps/cafe/lib/print-agent-paths.test.ts` | create: the wiring pins | C4 |
| `lib/print-host-paths.test.ts`, `lib/printer/print-gating-paths.test.ts`, `lib/print-wake.test.ts`, `lib/settle-flow-paths.test.ts`, `lib/print-order-jobs.test.ts` | deliberate pin changes | C2, C4 |
| `apps/cafe/scripts/print-host-live/agent.ts`, `lifecycle-actions.ts`, `verify-print-host-live.ts` | legs ad–ae; leg w | C5 |
| `apps/cafe/package.json` | `testChain`: three files | C1, C3, C4 |
| `apps/cafe/lib/go-live-dl.test.ts` | the planning-file pin skips where the file is absent | C5b |
| this plan | Session 1C Results | C6 |

---

### Task C0: the owner's two-attempt rule (shared lifecycle + the sweep)

**Files:**
- Modify: `packages/shared/src/print-lifecycle.ts` (`PRINT_MAX_PAPER_ATTEMPTS` replaces `PRINT_MAX_UNCERTAIN_ATTEMPTS` and `PRINT_MAX_ATTEMPTS`; `printJobOverLimits(uncertainAttempts)`; refusals never fail; the cashier's print again and a staff Retry are one more attempt)
- Modify: `packages/shared/src/print-lifecycle.test.ts` (deliberate pin changes: the limits, the confirm and the retry rows; two new tests)
- Modify: `apps/cafe/lib/print-sweep.ts` (the limits query counts only attempts that may have printed)

**Interfaces produced:** `PRINT_MAX_PAPER_ATTEMPTS = 2`; `printJobOverLimits(uncertainAttempts: number): boolean`. `planAck` with `sent: "no"` always queues (backoff only); `planConfirm("reprint")` and `planRetry` (failed) set `uncertainAttempts = PRINT_MAX_PAPER_ATTEMPTS - 1`, `attempts = 0`.

**The counting, pinned (owner decision 1 after Session 1B).** `uncertainAttempts` counts attempts that may have reached paper: a `sent:"maybe"` failure, a permanent failure after a byte left, or a lease that ran out. The second one ends in `failed`. `attempts` still counts leases, but only for the backoff step and the log; a refusal (`sent:"no"`) never moves `uncertainAttempts`, however often it happens.

A KOT: maybe → queued + REPRINT (1) → maybe → failed (2). A bill: maybe → needs-confirm (1) → the cashier's print again → queued + DUPLICATE, still 1 → maybe → failed, never a second prompt. A staff Retry on a failed slip sets 1: one tap, one try.

Deliberate pin changes (record each in Results): `print-lifecycle.test.ts` "lease: refused … when over limits", "limits: …" (rewritten), "needs-confirm, print again …", "failed, print again …" (renamed "failed, retry …").

- [ ] **Step 1: The failing tests first**

In `packages/shared/src/print-lifecycle.test.ts`, find:

```ts
import {
  PRINT_BACKOFF_MS,
  PRINT_LEASE_MS,
  PRINT_MAX_ATTEMPTS,
  addPrintLabel,
  lifecycleOf,
  planAck,
```

Replace it with:

```ts
import {
  PRINT_BACKOFF_MS,
  PRINT_LEASE_MS,
  PRINT_MAX_PAPER_ATTEMPTS,
  addPrintLabel,
  lifecycleOf,
  planAck,
```

In `packages/shared/src/print-lifecycle.test.ts`, find:

```ts
  assert.equal(refusalOf(planLease(job({ nextAttemptAt: new Date(T0 + 1) }), WHO, T0)).reason, "not-due");
  const old = job({ createdAt: new Date(T0 - PRINT_HOST_MAX_AGE_MS - 1) });
  assert.equal(refusalOf(planLease(old, WHO, T0)).reason, "stale");
  assert.equal(refusalOf(planLease(job({ attempts: PRINT_MAX_ATTEMPTS }), WHO, T0)).reason, "over-limits");
  for (const status of ["leased", "printed", "needs-confirm", "failed", "dismissed"] as const) {
    assert.equal(refusalOf(planLease(job({ status }), WHO, T0)).reason, "wrong-status", status);
  }
```

Replace it with:

```ts
  assert.equal(refusalOf(planLease(job({ nextAttemptAt: new Date(T0 + 1) }), WHO, T0)).reason, "not-due");
  const old = job({ createdAt: new Date(T0 - PRINT_HOST_MAX_AGE_MS - 1) });
  assert.equal(refusalOf(planLease(old, WHO, T0)).reason, "stale");
  assert.equal(refusalOf(planLease(job({ uncertainAttempts: PRINT_MAX_PAPER_ATTEMPTS }), WHO, T0)).reason, "over-limits");
  assert.ok(planLease(job({ attempts: 50 }), WHO, T0).ok, "leases refused before writing never count toward the limit");
  for (const status of ["leased", "printed", "needs-confirm", "failed", "dismissed"] as const) {
    assert.equal(refusalOf(planLease(job({ status }), WHO, T0)).reason, "wrong-status", status);
  }
```

In `packages/shared/src/print-lifecycle.test.ts`, find:

```ts
  assert.equal(maybe.set.uncertainAttempts, 1, "a permanent error after a byte left still counts as maybe printed");
});

test("limits: the third uncertain attempt or the eighth lease ends in failed, never another retry", () => {
  const third = patchOf(planAck(leased({ uncertainAttempts: 2 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(third.status, "failed");
  const eighth = patchOf(planAck(leased({ attempts: PRINT_MAX_ATTEMPTS }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no" }, T0));
  assert.equal(eighth.status, "failed");
  const swept = patchOf(planLimits(job({ uncertainAttempts: 3 }), T0));
  assert.equal(swept.status, "failed");
  assert.equal(refusalOf(planLimits(job({ uncertainAttempts: 2, attempts: 7 }), T0)).reason, "wrong-status");
  assert.equal(refusalOf(planLimits(leased({ uncertainAttempts: 3 }), T0)).reason, "wrong-status", "only a queued job is failed by the sweep");
});

test("late ack (spec §7.9): a printed ack for the epoch that expired still resolves the job", () => {
```

Replace it with:

```ts
  assert.equal(maybe.set.uncertainAttempts, 1, "a permanent error after a byte left still counts as maybe printed");
});

// The owner's rule after Session 1B (2026-10-03): at most two attempts that may reach paper, the first
// plus one labelled retry; refusals made before writing (the printer was off) never count.
test("limits: the second attempt that may have printed ends in failed; a refusal never counts, however often", () => {
  assert.equal(PRINT_MAX_PAPER_ATTEMPTS, 2, "the first attempt plus ONE labelled retry");
  const first = patchOf(planAck(leased(), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(first.status, "queued", "the first maybe is retried once, labelled");
  assert.deepEqual(first.set.labels, ["REPRINT"], "the retry says REPRINT");
  const second = patchOf(planAck(leased({ uncertainAttempts: 1, labels: ["REPRINT"] }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(second.status, "failed", "the second maybe ends in failed");
  assert.equal(second.set.uncertainAttempts, 2, "both attempts are recorded");
  const expired = patchOf(planExpiry(leased({ uncertainAttempts: 1, lease: { deviceId: "dev-a", tabId: "tab-1", epoch: 1, expiresAt: new Date(T0) } }), T0 + 1));
  assert.equal(expired.status, "failed", "a second lease that ran out counts the same as a second maybe");
  const refused = patchOf(planAck(leased({ attempts: 50, uncertainAttempts: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no" }, T0));
  assert.equal(refused.status, "queued", "the 50th refusal still waits in line");
  assert.equal(refused.set.uncertainAttempts, undefined, "a refusal adds no attempt");
  const swept = patchOf(planLimits(job({ uncertainAttempts: PRINT_MAX_PAPER_ATTEMPTS }), T0));
  assert.equal(swept.status, "failed", "the sweep fails a queued job over the limit");
  assert.equal(refusalOf(planLimits(job({ uncertainAttempts: 1, attempts: 50 }), T0)).reason, "wrong-status", "many refused leases are not over the limit");
  assert.equal(refusalOf(planLimits(leased({ uncertainAttempts: 2 }), T0)).reason, "wrong-status", "only a queued job is failed by the sweep");
});

test("a bill: the first maybe asks the cashier; the cashier's print again is the one retry; a second maybe is failed", () => {
  const asked = patchOf(planAck(leased({ kind: "bill" }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(asked.status, "needs-confirm", "the cashier decides after the first maybe");
  const again = patchOf(planConfirm(job({ kind: "bill", status: "needs-confirm", epoch: 1, attempts: 1, uncertainAttempts: 1 }), "reprint", "Asha", T0));
  const retried = lifecycleOf({ ...job({ kind: "bill", epoch: 1 }), ...again.set });
  const leasedAgain = patchOf(planLease(retried, WHO, T0));
  const secondMaybe = patchOf(
    planAck(lifecycleOf({ ...retried, ...leasedAgain.set }), { deviceId: "dev-a", epoch: 2, outcome: "failed", sent: "maybe" }, T0),
  );
  assert.equal(secondMaybe.status, "failed", "never a second cashier prompt: the bill waits in failed");
});

test("late ack (spec §7.9): a printed ack for the epoch that expired still resolves the job", () => {
```

In `packages/shared/src/print-lifecycle.test.ts`, find:

```ts
  assert.equal(refusalOf(planAck(job({ epoch: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no" }, T0)).reason, "not-leased");
});

test("needs-confirm, print again: queued with DUPLICATE, counters reset, approved now (never parked as stale)", () => {
  const waiting = job({ kind: "bill", status: "needs-confirm", epoch: 1, attempts: 1, uncertainAttempts: 1, createdAt: new Date(T0 - 2 * PRINT_HOST_MAX_AGE_MS) });
  const patch = patchOf(planConfirm(waiting, "reprint", "Asha", T0));
  assert.equal(patch.status, "queued");
  assert.deepEqual(patch.set, { status: "queued", labels: ["DUPLICATE"], attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(T0), approvedAt: new Date(T0) });
  assert.equal(patch.log.event, "confirmed");
  assert.ok(planLease(lifecycleOf({ ...waiting, ...patch.set }), WHO, T0).ok, "the cashier's reprint is leasable at once");
});
```

Replace it with:

```ts
  assert.equal(refusalOf(planAck(job({ epoch: 1 }), { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no" }, T0)).reason, "not-leased");
});

test("needs-confirm, print again: queued with DUPLICATE as the bill's one retry, approved now (never parked as stale)", () => {
  const waiting = job({ kind: "bill", status: "needs-confirm", epoch: 1, attempts: 1, uncertainAttempts: 1, createdAt: new Date(T0 - 2 * PRINT_HOST_MAX_AGE_MS) });
  const patch = patchOf(planConfirm(waiting, "reprint", "Asha", T0));
  assert.equal(patch.status, "queued");
  assert.deepEqual(patch.set, { status: "queued", labels: ["DUPLICATE"], attempts: 0, uncertainAttempts: 1, nextAttemptAt: new Date(T0), approvedAt: new Date(T0) });
  assert.equal(patch.log.event, "confirmed");
  assert.ok(planLease(lifecycleOf({ ...waiting, ...patch.set }), WHO, T0).ok, "the cashier's reprint is leasable at once");
});
```

In `packages/shared/src/print-lifecycle.test.ts`, find:

```ts
  assert.equal(refusalOf(planConfirm(job(), "printed", "Asha", T0)).reason, "wrong-status", "only a job waiting for a decision takes one");
});

test("failed, print again: labelled when it may have printed, counters reset, approved now", () => {
  const kot = patchOf(planRetry(job({ status: "failed", attempts: 8, uncertainAttempts: 1 }), T0));
  assert.deepEqual(kot.set, { status: "queued", labels: ["REPRINT"], attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(T0), approvedAt: new Date(T0) });
  assert.deepEqual(kot.unset, ["lastError"]);
  const bill = patchOf(planRetry(job({ kind: "bill", status: "failed", uncertainAttempts: 2 }), T0));
  assert.deepEqual(bill.set.labels, ["DUPLICATE"]);
  const never = patchOf(planRetry(job({ status: "failed", attempts: 8 }), T0));
  assert.deepEqual(never.set.labels, [], "nothing ever reached paper: no label");
  assert.equal(kot.log.event, "retried");
});

test("stale, print now: a 30-minute-old queued job becomes leasable; a fresh one needs no tap", () => {
```

Replace it with:

```ts
  assert.equal(refusalOf(planConfirm(job(), "printed", "Asha", T0)).reason, "wrong-status", "only a job waiting for a decision takes one");
});

test("failed, retry: one staff tap is one more attempt, labelled when it may have printed, approved now", () => {
  const kot = patchOf(planRetry(job({ status: "failed", attempts: 8, uncertainAttempts: 2 }), T0));
  assert.deepEqual(kot.set, { status: "queued", labels: ["REPRINT"], attempts: 0, uncertainAttempts: 1, nextAttemptAt: new Date(T0), approvedAt: new Date(T0) });
  assert.deepEqual(kot.unset, ["lastError"]);
  const bill = patchOf(planRetry(job({ kind: "bill", status: "failed", uncertainAttempts: 2 }), T0));
  assert.deepEqual(bill.set.labels, ["DUPLICATE"]);
  const never = patchOf(planRetry(job({ status: "failed", attempts: 8 }), T0));
  assert.deepEqual(never.set.labels, [], "nothing ever reached paper: no label");
  assert.equal(kot.log.event, "retried");
  const tapped = lifecycleOf({ ...job({ epoch: 3 }), ...kot.set });
  const lease = patchOf(planLease(tapped, WHO, T0));
  const maybe = patchOf(planAck(lifecycleOf({ ...tapped, ...lease.set }), { deviceId: "dev-a", epoch: 4, outcome: "failed", sent: "maybe" }, T0));
  assert.equal(maybe.status, "failed", "one tap, one try: a maybe on the retried slip sends it back to failed");
});

test("stale, print now: a 30-minute-old queued job becomes leasable; a fresh one needs no tap", () => {
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-lifecycle.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|does not provide"`
Expected: `# SyntaxError: The requested module './print-lifecycle' does not provide an export named 'PRINT_MAX_PAPER_ATTEMPTS'`; `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import {
  PRINT_JOB_LOG_MAX,
  PRINT_MAX_ATTEMPTS,
  PRINT_MAX_UNCERTAIN_ATTEMPTS,
  PRINT_SWEEP_MIN_INTERVAL_MS,
  lifecycleOf,
  planExpiry,
```

Replace it with:

```ts
import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import {
  PRINT_JOB_LOG_MAX,
  PRINT_MAX_PAPER_ATTEMPTS,
  PRINT_SWEEP_MIN_INTERVAL_MS,
  lifecycleOf,
  planExpiry,
```

In `apps/cafe/lib/print-sweep.ts`, find:

```ts
  // 2b. Re-create the missing job of a server-owned KOT round (§7.4; print-repair.ts).
  result.repaired = await repairMissingKotJobs(nowMs);

  // 3. Limits (§7.8). They are normally applied when acking; this catches anything that slipped past.
  const tired = await PrintJob.find({
    status: "queued",
    $or: [{ uncertainAttempts: { $gte: PRINT_MAX_UNCERTAIN_ATTEMPTS } }, { attempts: { $gte: PRINT_MAX_ATTEMPTS } }],
  })
    .select(PRINT_LIFECYCLE_SELECT)
    .limit(PRINT_SWEEP_BATCH)
    .lean<PrintLifecycleRow[]>();
```

Replace it with:

```ts
  // 2b. Re-create the missing job of a server-owned KOT round (§7.4; print-repair.ts).
  result.repaired = await repairMissingKotJobs(nowMs);

  // 3. Limits (§7.8, the owner's two-attempt rule). Normally applied when acking; this catches anything
  // that slipped past. Only attempts that may have reached paper count; refused leases never do.
  const tired = await PrintJob.find({ status: "queued", uncertainAttempts: { $gte: PRINT_MAX_PAPER_ATTEMPTS } })
    .select(PRINT_LIFECYCLE_SELECT)
    .limit(PRINT_SWEEP_BATCH)
    .lean<PrintLifecycleRow[]>();
```

In `packages/shared/src/print-lifecycle.ts`, find:

```ts

/** A lease covers rendering (the 12 s raster deadline) plus the device write deadline (70 s). */
export const PRINT_LEASE_MS = 90_000;
/** The wait after a refusal made before any byte was sent: 2 s, 5 s, 10 s, then every 30 s. */
export const PRINT_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000] as const;
/** Retries stop once a job may have printed this many times, or was leased this many times (§7.8). */
export const PRINT_MAX_UNCERTAIN_ATTEMPTS = 3;
export const PRINT_MAX_ATTEMPTS = 8;
/** A KOT still not printed this long after it was created sounds the alarm (§10). */
export const PRINT_KOT_ALARM_MS = 20_000;
/** A device whose last heartbeat is older than this is offline (§6.4). */
```

Replace it with:

```ts

/** A lease covers rendering (the 12 s raster deadline) plus the device write deadline (70 s). */
export const PRINT_LEASE_MS = 90_000;
/** The wait after a refusal made before any byte was sent: 2 s, 5 s, 10 s, then every 30 s. The agent
 *  does not lease at all while its printer is known to be off (owner, after Session 1B), so this only
 *  paces a printer whose link reports ready but keeps refusing. */
export const PRINT_BACKOFF_MS = [2_000, 5_000, 10_000, 30_000] as const;
/** The owner's rule after Session 1B (2026-10-03, replacing §7.8's "3 uncertain or 8 leases"): when the
 *  printer is ready, a slip gets at most TWO attempts that may reach paper, the first plus ONE labelled
 *  retry (REPRINT; for a bill, the cashier's DUPLICATE). The second "maybe" (a failure after a byte left,
 *  or a lease that ran out) ends in failed, and waits for staff. A refusal made before any byte was sent
 *  (sent:"no": the printer was off) never counts, however often it happens. */
export const PRINT_MAX_PAPER_ATTEMPTS = 2;
/** A KOT still not printed this long after it was created sounds the alarm (§10). */
export const PRINT_KOT_ALARM_MS = 20_000;
/** A device whose last heartbeat is older than this is offline (§6.4). */
```

In `packages/shared/src/print-lifecycle.ts`, find:

```ts
  }
}

export function printJobOverLimits(attempts: number, uncertainAttempts: number): boolean {
  return uncertainAttempts >= PRINT_MAX_UNCERTAIN_ATTEMPTS || attempts >= PRINT_MAX_ATTEMPTS;
}

/** Stale is derived, never stored (§7.2): a queued job over 30 minutes old that staff never
```

Replace it with:

```ts
  }
}

/** Only attempts that may have reached paper count (PRINT_MAX_PAPER_ATTEMPTS); leases refused before
 *  writing never do. */
export function printJobOverLimits(uncertainAttempts: number): boolean {
  return uncertainAttempts >= PRINT_MAX_PAPER_ATTEMPTS;
}

/** Stale is derived, never stored (§7.2): a queued job over 30 minutes old that staff never
```

In `packages/shared/src/print-lifecycle.ts`, find:

```ts
  detail: string,
): PrintJobPatch {
  const uncertainAttempts = job.uncertainAttempts + 1;
  if (printJobOverLimits(job.attempts, uncertainAttempts)) {
    return failed(nowMs, { uncertainAttempts, lastError: detail }, deviceId, `limits: ${detail}`);
  }
  const log = logEntry(nowMs, event, deviceId, detail);
```

Replace it with:

```ts
  detail: string,
): PrintJobPatch {
  const uncertainAttempts = job.uncertainAttempts + 1;
  if (printJobOverLimits(uncertainAttempts)) {
    return failed(nowMs, { uncertainAttempts, lastError: detail }, deviceId, `limits: ${detail}`);
  }
  const log = logEntry(nowMs, event, deviceId, detail);
```

In `packages/shared/src/print-lifecycle.ts`, find:

```ts
export function planLease(job: PrintJobLifecycle, who: { deviceId: string; tabId: string }, nowMs: number): PrintJobPlan {
  if (job.status !== "queued") return { ok: false, reason: "wrong-status" };
  if (printJobStale(job, nowMs)) return { ok: false, reason: "stale" };
  if (printJobOverLimits(job.attempts, job.uncertainAttempts)) return { ok: false, reason: "over-limits" };
  if (job.nextAttemptAt.getTime() > nowMs) return { ok: false, reason: "not-due" };
  const epoch = job.epoch + 1;
  return planned({
```

Replace it with:

```ts
export function planLease(job: PrintJobLifecycle, who: { deviceId: string; tabId: string }, nowMs: number): PrintJobPlan {
  if (job.status !== "queued") return { ok: false, reason: "wrong-status" };
  if (printJobStale(job, nowMs)) return { ok: false, reason: "stale" };
  if (printJobOverLimits(job.uncertainAttempts)) return { ok: false, reason: "over-limits" };
  if (job.nextAttemptAt.getTime() > nowMs) return { ok: false, reason: "not-due" };
  const epoch = job.epoch + 1;
  return planned({
```

In `packages/shared/src/print-lifecycle.ts`, find:

```ts
      return planned(failed(nowMs, { uncertainAttempts, lastError: error }, ack.deviceId, `permanent: ${error}`));
    }
    if (ack.sent === "no") {
      if (printJobOverLimits(job.attempts, job.uncertainAttempts)) {
        return planned(failed(nowMs, { lastError: error }, ack.deviceId, `limits: ${error}`));
      }
      return planned({
        status: "queued",
        set: { status: "queued", nextAttemptAt: new Date(nowMs + printBackoffMs(job.attempts)), lastError: error },
```

Replace it with:

```ts
      return planned(failed(nowMs, { uncertainAttempts, lastError: error }, ack.deviceId, `permanent: ${error}`));
    }
    if (ack.sent === "no") {
      // Nothing reached the printer, so this never counts toward the limit (owner, after Session 1B):
      // the job waits in line, and the agent stops leasing until its printer is back.
      return planned({
        status: "queued",
        set: { status: "queued", nextAttemptAt: new Date(nowMs + printBackoffMs(job.attempts)), lastError: error },
```

In `packages/shared/src/print-lifecycle.ts`, find:

```ts
  if (job.status !== "needs-confirm") return { ok: false, reason: "wrong-status" };
  switch (decision) {
    case "reprint":
      // Counters reset and approvedAt set: the cashier's tap is a fresh, approved attempt, so the
      // copy is neither parked as stale nor failed by the uncertain limit it came from.
      return planned({
        status: "queued",
        set: {
          status: "queued",
          labels: addPrintLabel(job.labels, "DUPLICATE"),
          attempts: 0,
          uncertainAttempts: 0,
          nextAttemptAt: new Date(nowMs),
          approvedAt: new Date(nowMs),
        },
```

Replace it with:

```ts
  if (job.status !== "needs-confirm") return { ok: false, reason: "wrong-status" };
  switch (decision) {
    case "reprint":
      // The cashier's tap is the bill's ONE labelled retry (the owner's two-attempt rule): one more
      // attempt, approved now so it is never parked as stale, and a second "maybe" fails it.
      return planned({
        status: "queued",
        set: {
          status: "queued",
          labels: addPrintLabel(job.labels, "DUPLICATE"),
          attempts: 0,
          uncertainAttempts: PRINT_MAX_PAPER_ATTEMPTS - 1,
          nextAttemptAt: new Date(nowMs),
          approvedAt: new Date(nowMs),
        },
```

In `packages/shared/src/print-lifecycle.ts`, find:

```ts
  }
}

/** failed → queued ("Print again"), or a stale queued job → leasable ("Print now") (§7.2). */
export function planRetry(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status === "failed") {
    const labels = job.uncertainAttempts > 0 ? addPrintLabel(job.labels, printRepeatLabel(job.kind)) : job.labels;
    return planned({
      status: "queued",
      set: { status: "queued", labels, attempts: 0, uncertainAttempts: 0, nextAttemptAt: new Date(nowMs), approvedAt: new Date(nowMs) },
      unset: ["lastError"],
      log: logEntry(nowMs, "retried", undefined, "print again"),
    });
```

Replace it with:

```ts
  }
}

/** failed → queued ("Retry"), or a stale queued job → leasable ("Print now") (§7.2). One staff tap is
 *  one more attempt (the owner's rule): a second "maybe" sends the slip back to failed. */
export function planRetry(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status === "failed") {
    const labels = job.uncertainAttempts > 0 ? addPrintLabel(job.labels, printRepeatLabel(job.kind)) : job.labels;
    return planned({
      status: "queued",
      set: {
        status: "queued",
        labels,
        attempts: 0,
        uncertainAttempts: PRINT_MAX_PAPER_ATTEMPTS - 1,
        nextAttemptAt: new Date(nowMs),
        approvedAt: new Date(nowMs),
      },
      unset: ["lastError"],
      log: logEntry(nowMs, "retried", undefined, "print again"),
    });
```

In `packages/shared/src/print-lifecycle.ts`, find:

```ts

/** The sweep's limits check (§7.2): a queued job over its limits stops retrying. */
export function planLimits(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status !== "queued" || !printJobOverLimits(job.attempts, job.uncertainAttempts)) {
    return { ok: false, reason: "wrong-status" };
  }
  return planned({ status: "failed", set: { status: "failed", lastError: "too many attempts" }, unset: [], log: logEntry(nowMs, "failed", undefined, "limits") });
```

Replace it with:

```ts

/** The sweep's limits check (§7.2): a queued job over its limits stops retrying. */
export function planLimits(job: PrintJobLifecycle, nowMs: number): PrintJobPlan {
  if (job.status !== "queued" || !printJobOverLimits(job.uncertainAttempts)) {
    return { ok: false, reason: "wrong-status" };
  }
  return planned({ status: "failed", set: { status: "failed", lastError: "too many attempts" }, unset: [], log: logEntry(nowMs, "failed", undefined, "limits") });
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-lifecycle.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 24`; `# pass 24`; `# fail 0`; `# tests 630`; `# pass 630`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo TSC_OK`
Expected: `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-sweep.ts packages/shared/src/print-lifecycle.test.ts packages/shared/src/print-lifecycle.ts
git commit -m "feat(print): the owner's two-attempt rule: at most two attempts that may print per slip, and a refusal never counts"
```

---

### Task C1: a print failure says whether anything reached the printer

**Files:**
- Create: `apps/cafe/lib/print-write-outcome.ts` (`PrintWriteError`, `printWriteOutcomeOf`)
- Create: `apps/cafe/lib/print-write-outcome.test.ts`
- Modify: `apps/cafe/package.json` (`testChain`)

**Interfaces produced:** `class PrintWriteError extends Error { sent: "no" | "maybe"; permanent: boolean }`; `printWriteOutcomeOf(error: unknown): { sent; permanent; message }`.

Every sentence the print lanes throw is curated (`lane-print.ts` LANE_MESSAGES), so the sentence is the code: refused before any byte left (`sent:"no"`), can never print (`no` + permanent), or anything else (`maybe`, the safe direction). The Android codes map per spec §7.5; `UNSUPPORTED` and `BAD_REQUEST` share the write-failed sentence and read as maybe.

**Deviation from the 1C spec (deliberate):** the write queue (`device-printer-write.ts`) is unchanged. The agent prints one job at a time, so a job never waits behind another there, and "a deadline before the job started" cannot happen on the agent path.

The file lives in `lib/`, not `lib/printer/`: `print-lane.test.ts` forbids any `lib/printer` file but `print-lane.ts` from importing the desktop-shell seam.

- [ ] **Step 1: The failing tests first**

Create `apps/cafe/lib/print-write-outcome.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { DESKTOP_PRINT_EMPTY_MESSAGE, DESKTOP_PRINT_NO_REPLY_MESSAGE, DESKTOP_PRINT_TOO_LARGE_MESSAGE } from "@/lib/desktop-shell";
import { PRINT_HOST_EMPTY_SLIP_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { LANE_PRINT_FAILED_MESSAGE, NO_PRINTER_MESSAGE, laneFailureMessage } from "@/lib/printer/lane-print";
import { nativeError } from "@/lib/printer/native-bridge";
import { NATIVE_ERROR_CODES, type NativeErrorCode } from "@/lib/printer/native-bridge-protocol";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { RASTER_FAILED_MESSAGE, RASTER_TOO_LARGE_MESSAGE } from "@/lib/printer/raster";
import { nativeErrorMessage } from "@/lib/printer/transport-native";
import { PRINTER_ELSEWHERE_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing Phase 1 Session 1C (spec §7.5): the agent says sent:"no" only when nothing can have
// reached the printer. These cases pin every curated sentence the print lanes throw.

function outcome(message: string): string {
  const o = printWriteOutcomeOf(new Error(message));
  return o.permanent ? `${o.sent}+permanent` : o.sent;
}

test("refusals made before any byte left are sent:'no' (no printer, not connected, another tab, could not draw)", () => {
  for (const message of [NO_PRINTER_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_ELSEWHERE_MESSAGE, RASTER_FAILED_MESSAGE]) {
    assert.equal(outcome(message), "no", message);
  }
});

test("a slip that can never print is sent:'no' and permanent (too large, blank)", () => {
  for (const message of [RASTER_TOO_LARGE_MESSAGE, DESKTOP_PRINT_TOO_LARGE_MESSAGE, DESKTOP_PRINT_EMPTY_MESSAGE, PRINT_HOST_EMPTY_SLIP_MESSAGE]) {
    assert.equal(outcome(message), "no+permanent", message);
  }
});

test("anything that may already be on paper is 'maybe': write failed, no reply, the bridge's give-up, unknown text", () => {
  for (const message of [PRINTER_WRITE_FAILED_MESSAGE, DESKTOP_PRINT_NO_REPLY_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE, LANE_PRINT_FAILED_MESSAGE, "socket hang up"]) {
    assert.equal(outcome(message), "maybe", message);
  }
  assert.equal(printWriteOutcomeOf("not an error").sent, "maybe", "a thrown non-Error is maybe");
  assert.equal(printWriteOutcomeOf(new Error("")).message, "may have printed", "an empty message still says why");
  assert.equal(printWriteOutcomeOf(new Error("Error invoking remote method 'print': Error: Paper jam")).sent, "maybe", "a desktop shell failure is maybe");
});

test("the Android bridge's codes (spec §7.5): refusals are 'no', a write that failed is 'maybe', too large is permanent", () => {
  const expected: Record<NativeErrorCode, string> = {
    NOT_CONNECTED: "no",
    BUSY: "no",
    BLUETOOTH_OFF: "no",
    UNAUTHORIZED: "no",
    LOCATION_OFF: "no",
    TOO_LARGE: "no+permanent",
    WRITE_FAILED: "maybe",
    TIMEOUT: "maybe",
    // Their sentence is the write-failed one, so they read as maybe: the safe direction.
    UNSUPPORTED: "maybe",
    BAD_REQUEST: "maybe",
  };
  for (const code of NATIVE_ERROR_CODES) {
    assert.equal(outcome(nativeErrorMessage(nativeError(code, code))), expected[code], code);
  }
});

test("a PrintWriteError keeps its own class and its operator sentence (toasts and laneFailureMessage unchanged)", () => {
  const refused = new PrintWriteError(PRINT_HOST_PRINT_FAILED_MESSAGE, "no", true);
  assert.deepEqual(printWriteOutcomeOf(refused), { sent: "no", permanent: true, message: PRINT_HOST_PRINT_FAILED_MESSAGE });
  assert.ok(refused instanceof Error, "it is still an Error");
  assert.equal(laneFailureMessage(new PrintWriteError(PRINTER_NOT_CONNECTED_MESSAGE, "no")), PRINTER_NOT_CONNECTED_MESSAGE, "the lane toast reads the same sentence");
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/print-lifecycle-paths.test.ts",
    "lib/print-order-jobs.test.ts",
    "lib/print-repair.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
    "lib/pos-install-paths.test.ts",
```

Replace it with:

```json
    "lib/print-lifecycle-paths.test.ts",
    "lib/print-order-jobs.test.ts",
    "lib/print-repair.test.ts",
    "lib/print-write-outcome.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
    "lib/pos-install-paths.test.ts",
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-write-outcome.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|Cannot find module"`
Expected: `# Error: Cannot find module '@/lib/print-write-outcome'`; `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

Create `apps/cafe/lib/print-write-outcome.ts`:

```ts
import { DESKTOP_PRINT_EMPTY_MESSAGE } from "@/lib/desktop-shell-document";
import { DESKTOP_PRINT_TOO_LARGE_MESSAGE } from "@/lib/desktop-shell";
import { PRINT_HOST_EMPTY_SLIP_MESSAGE } from "@/lib/print-host-slips";
import { NO_PRINTER_MESSAGE } from "@/lib/printer/lane-print";
import { RASTER_FAILED_MESSAGE, RASTER_TOO_LARGE_MESSAGE } from "@/lib/printer/raster";
import {
  NATIVE_BLUETOOTH_BLOCKED_MESSAGE,
  NATIVE_BLUETOOTH_OFF_MESSAGE,
  NATIVE_BUSY_MESSAGE,
  NATIVE_LOCATION_OFF_MESSAGE,
} from "@/lib/printer/transport-native";
import {
  PRINTER_ELSEWHERE_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_TOO_LARGE_MESSAGE,
} from "@/lib/printer/web-printer-types";

// Printing redesign, Phase 1 Session 1C (spec §7.5): what one failed print tells the server. The
// agent acks a failure with `sent: "no"` ONLY when nothing can have reached the printer; anything
// else is "maybe" (a KOT then retries once with REPRINT, a bill asks the cashier). Every sentence the
// print lanes throw is curated (lane-print.ts LANE_MESSAGES), so the sentence IS the code: a refusal
// made before any byte left, a payload that can never print, or "it may already be on paper". An
// error this file does not know is "maybe", the safe direction: it never authorizes an unlabelled
// repeat. The write queue is unchanged (device-printer-write.ts): the agent prints one job at a time,
// so a job never waits behind another there, and its "write failed" stays "maybe".

export type PrintWriteSent = "no" | "maybe";

/** A failure whose sender knows its class (the host bridge's own refusals). Keeps its operator
 *  sentence as `message`, so laneFailureMessage and every toast read it exactly as before. */
export class PrintWriteError extends Error {
  readonly sent: PrintWriteSent;
  readonly permanent: boolean;
  constructor(message: string, sent: PrintWriteSent, permanent = false) {
    super(message);
    this.name = "PrintWriteError";
    this.sent = sent;
    this.permanent = permanent;
  }
}

export interface PrintWriteOutcome {
  sent: PrintWriteSent;
  /** Retrying cannot help (too large, blank): the job goes straight to failed. */
  permanent: boolean;
  /** The operator sentence, for the job's lastError (the server cuts it to 200 chars). */
  message: string;
}

/** Refused before any byte left: no printer here, not connected, owned by another tab, Bluetooth
 *  off or blocked, the printer busy, or the slip could not be drawn. */
const NOTHING_SENT: ReadonlySet<string> = new Set([
  NO_PRINTER_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_ELSEWHERE_MESSAGE,
  RASTER_FAILED_MESSAGE,
  NATIVE_BUSY_MESSAGE,
  NATIVE_BLUETOOTH_OFF_MESSAGE,
  NATIVE_BLUETOOTH_BLOCKED_MESSAGE,
  NATIVE_LOCATION_OFF_MESSAGE,
]);

/** Refused before any byte left, and refused again every time: too large, or a blank slip. */
const NEVER_PRINTS: ReadonlySet<string> = new Set([
  PRINTER_TOO_LARGE_MESSAGE,
  RASTER_TOO_LARGE_MESSAGE,
  DESKTOP_PRINT_TOO_LARGE_MESSAGE,
  DESKTOP_PRINT_EMPTY_MESSAGE,
  PRINT_HOST_EMPTY_SLIP_MESSAGE,
]);

const UNKNOWN_FAILURE_MESSAGE = "may have printed";

export function printWriteOutcomeOf(error: unknown): PrintWriteOutcome {
  if (error instanceof PrintWriteError) return { sent: error.sent, permanent: error.permanent, message: error.message };
  const message = error instanceof Error && error.message.trim() !== "" ? error.message : UNKNOWN_FAILURE_MESSAGE;
  if (NEVER_PRINTS.has(message)) return { sent: "no", permanent: true, message };
  if (NOTHING_SENT.has(message)) return { sent: "no", permanent: false, message };
  return { sent: "maybe", permanent: false, message };
}
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-write-outcome.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 5`; `# pass 5`; `# fail 0`; `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-write-outcome.test.ts apps/cafe/lib/print-write-outcome.ts apps/cafe/package.json
git commit -m "feat(print): a print failure says whether anything reached the printer (nothing sent, maybe printed, never prints)"
```

---

### Task C2: the server half: the job-aware self-order claim, ref status, the orphan fix, the pulse's jobs for me, repairable staff accepts

**Files:**
- Create: `apps/cafe/lib/print-agent-server.ts` (`claimKotPrintForAgent`, `printPulseDeviceOf`)
- Modify: `apps/cafe/app/api/order-requests/[id]/kot-claim/route.ts` (an agent's claim makes the KOT a job)
- Modify: `apps/cafe/app/api/order-requests/pulse/route.ts` (`?device=` adds `printJobsForMe`, read-only, fail-soft)
- Modify: `packages/shared/src/self-order-alert.ts` (`PosPulseData.printJobsForMe?`)
- Modify: `packages/shared/src/print-agent-wire.ts` (`PrintJobRef.status`, M-d)
- Modify: `apps/cafe/lib/print-order-jobs.ts` (the ref's status)
- Modify: `apps/cafe/lib/print-queue.ts` (M-a: an orphaned row with an asking device goes home; M-e: a new enqueued row publishes its `queued` print-status)
- Modify: `apps/cafe/lib/order-request-accept.ts`, `apps/cafe/lib/order-request-accept-addround.ts`, `apps/cafe/app/api/order-requests/[id]/accept/route.ts` (M-f: `AcceptContext.printDeviceId` writes `Order.kotPrintDevices` in the same order write)
- Modify: `apps/cafe/lib/print-order-jobs.test.ts` (one deliberate pin change: the `withPrintJobs` fixture gains `status`; six new tests)

**Interfaces produced:** `claimKotPrintForAgent(id, intent, nowMs)` → `{ claimed: false; reason } | { claimed: true; order: Order & { printJobs? }; kotRound }`; `printPulseDeviceOf(url): string | null`; `PrintJobRef.status: PrintJobStatus`; `PosPulseData.printJobsForMe?: { count; oldestCreatedAt }`; `AcceptContext.printDeviceId?`.

**R4, the job-aware lane (gate ruling, replaces the auto-accept job).** The lane that wins `/kot-claim` asks as an agent, and the claim makes the KOT a job (today's key) for whoever prints now. One creator per KOT, because the claim CAS still lets exactly one lane win; the public auto-accept stays exactly as live today. A failed create keeps the claim (the D9 marker is never reopened: `self-order-alert-paths` pins that) and names no job, so the lane enqueues the KOT itself under the same key. No new request; no write beyond the job.

The enqueue's transient re-read catch publishes no print-status: `print-queue-fixes` and `realtime-paths` pin that block's first 120 characters, and the host still hears the old `print-job` nudge there.

The pulse route keeps calling `readPosPulse()` exactly (pinned); the jobs-for-me read runs beside it in the route.

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { buildKotPrintDevices, printIntentOf, wireOrderOf, withPrintJobs } from "@/lib/print-order-jobs";

// Printing redesign Phase 1, Session 1B (plan docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md):
// server-side job creation. DB behaviour is proven live (npm run verify:print:live, legs y–ab); these
```

Replace it with:

```ts
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { buildKotPrintDevices, printIntentOf, wireOrderOf, withPrintJobs } from "@/lib/print-order-jobs";
import { printPulseDeviceOf } from "@/lib/print-agent-server";

// Printing redesign Phase 1, Session 1B (plan docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md):
// server-side job creation. DB behaviour is proven live (npm run verify:print:live, legs y–ab); these
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
test("withPrintJobs: without an opt-in the answer is the very same object; with one it is the wire order plus printJobs", () => {
  const order = { _id: "o1", createdAt: new Date("2026-10-02T10:00:00.000Z") };
  assert.equal(withPrintJobs(order, null), order);
  const refs = [{ id: "j1", kind: "kot" as const, targetDeviceId: "dev-1", label: "KOT round 1 · T-1" }];
  assert.deepEqual(withPrintJobs(order, refs), { _id: "o1", createdAt: "2026-10-02T10:00:00.000Z", printJobs: refs });
  assert.deepEqual(withPrintJobs(order, []), { _id: "o1", createdAt: "2026-10-02T10:00:00.000Z", printJobs: [] });
  const wire = wireOrderOf({ createdAt: new Date("2026-10-02T10:00:00.000Z") });
```

Replace it with:

```ts
test("withPrintJobs: without an opt-in the answer is the very same object; with one it is the wire order plus printJobs", () => {
  const order = { _id: "o1", createdAt: new Date("2026-10-02T10:00:00.000Z") };
  assert.equal(withPrintJobs(order, null), order);
  const refs = [{ id: "j1", kind: "kot" as const, targetDeviceId: "dev-1", label: "KOT round 1 · T-1", status: "queued" as const }];
  assert.deepEqual(withPrintJobs(order, refs), { _id: "o1", createdAt: "2026-10-02T10:00:00.000Z", printJobs: refs });
  assert.deepEqual(withPrintJobs(order, []), { _id: "o1", createdAt: "2026-10-02T10:00:00.000Z", printJobs: [] });
  const wire = wireOrderOf({ createdAt: new Date("2026-10-02T10:00:00.000Z") });
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
  assert.match(s, /if \(result\.outcome === "no-host" && intent !== null\) \{\s*result = await enqueueOwnPrintJob\(\{/);
});

```

Replace it with:

```ts
  assert.match(s, /if \(result\.outcome === "no-host" && intent !== null\) \{\s*result = await enqueueOwnPrintJob\(\{/);
});

// ── Session 1C, the server half (the 1B gate rulings: M-a, M-d, M-e, M-f, R4 job-aware lane, the pulse) ──

test("printPulseDeviceOf: only a usable ?device= names the agent; anything else is ignored, never a 400", () => {
  assert.equal(printPulseDeviceOf("http://localhost/api/order-requests/pulse"), null, "a tab that is not an agent sends none");
  assert.equal(printPulseDeviceOf("http://localhost/api/order-requests/pulse?device="), null, "empty");
  assert.equal(printPulseDeviceOf(`http://localhost/api/order-requests/pulse?device=${"d".repeat(65)}`), null, "too long");
  assert.equal(printPulseDeviceOf("http://localhost/api/order-requests/pulse?device=%20dev-1%20"), "dev-1");
});

test("PIN (M-d): every ref says what state its job is in, made now or found under its key", () => {
  const s = src("apps/cafe/lib/print-order-jobs.ts");
  assert.match(s, /label: input\.request\.label,\s*status: "queued",\s*\};\s*return \{ ref, created: true, status: "queued" \};/, "a new job is queued");
  assert.match(s, /label: existing\.label,\s*status: existing\.status,\s*\};/, "a found job keeps its own state");
  assert.match(src("packages/shared/src/print-agent-wire.ts"), /export interface PrintJobRef \{[^}]*status: PrintJobStatus;/, "the wire type carries it");
});

test("PIN (M-a, M-e): an enqueue whose host vanished sends a row with an asking device home; every new row announces itself", () => {
  const s = src("apps/cafe/lib/print-queue.ts");
  const fn = s.slice(s.indexOf("export async function enqueuePrintJob("), s.indexOf("export type DismissPrintJobResult"));
  inOrder(
    fn,
    [
      "if (!hostStillThere && input.originDeviceId !== undefined) {",
      "$set: { targetDeviceId: input.originDeviceId }",
      'publishPrintStatus({ id: createdId, status: "queued", target: input.originDeviceId });',
      'return { outcome: "queued", id: createdId, duplicate: false };',
      "if (!hostStillThere) {",
      "await dismissPrintJob({",
    ],
    "the orphan check",
  );
  assert.equal(count(fn, 'publishPrintStatus({ id: createdId, status: "queued", target: host.deviceId });'), 1, "a new job for the host announces itself");
  assert.equal(count(fn, "publishPrintStatus("), 2, "no other print-status from the enqueue (a duplicate is not new; a failed re-read keeps the old nudge only)");
});

test("PIN (R4, job-aware lane): an agent's kot-claim makes the KOT a job in the same request; the D9 marker is never reopened", () => {
  const route = src("apps/cafe/app/api/order-requests/[id]/kot-claim/route.ts");
  assert.match(route, /const intent = printIntentOf\(req\);\s*const result = intent \? await claimKotPrintForAgent\(id, intent, Date\.now\(\)\) : await claimKotPrint\(id\);/);
  const lib = src("apps/cafe/lib/print-agent-server.ts");
  inOrder(lib, ["const result = await claimKotPrint(id);", "if (!result.claimed) return result;", "await createOrderPrintJobs({", 'slips: [{ kind: "kot", round: result.kotRound }]'], "the claim, then the job");
  assert.ok(!/\$unset/.test(lib) && !/kotPrintedAt/.test(lib), "a failed create never reopens the claim: the lane enqueues the KOT itself");
  assert.match(lib, /printJobs\.length > 0 \? \{ \.\.\.order, printJobs \} : order/, "no job: the answer names none, so the lane re-sends it under the same key");
  assert.match(src("apps/cafe/lib/order-request-create.ts"), /return "error" in result \? "pending" : "accepted";/, "the public auto-accept stays exactly as live today");
});

test("PIN (M-f): a staff accept the server prints records the asking device in the same order write, on both writers", () => {
  assert.match(src("apps/cafe/app/api/order-requests/[id]/accept/route.ts"), /\.\.\.\(intent \? \{ printDeviceId: intent\.deviceId \} : \{\}\),/);
  assert.match(src("apps/cafe/lib/order-request-accept.ts"), /\.\.\.\(ctx\.printDeviceId \? \{ kotPrintDevices: \[ctx\.printDeviceId\] \} : \{\}\),/, "a new tab: round 1");
  const add = src("apps/cafe/lib/order-request-accept-addround.ts");
  assert.match(add, /const kotPrintDevices = buildKotPrintDevices\(openTab\.kotPrintDevices, round, ctx\.printDeviceId\);/, "an open tab: positional");
  assert.match(add, /\.\.\.\(kotPrintDevices \? \{ kotPrintDevices \} : \{\}\),/);
  assert.ok(!src("apps/cafe/lib/order-request-create.ts").includes("printDeviceId"), "the auto-accept marks nothing");
});

test("PIN: the pulse adds printJobsForMe only for a tab that named itself, read-only and fail-soft", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /const device = printPulseDeviceOf\(req\.url\);/);
  assert.match(s, /device === null \? Promise\.resolve\(null\) : readJobsForDevice\(device, Date\.now\(\)\)\.catch\(\(\) => null\)/);
  assert.match(s, /success\(printJobsForMe === null \? data : \{ \.\.\.data, printJobsForMe \}\)/);
  for (const write of ["updateOne(", "updateMany(", "create(", "findOneAndUpdate(", "sweepPrintJobs"]) {
    assert.ok(!s.includes(write), `the pulse route stays read-only: no ${write}`);
  }
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-order-jobs.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|Cannot find module"`
Expected: `# Error: Cannot find module '@/lib/print-agent-server'`; `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

In `apps/cafe/app/api/order-requests/[id]/accept/route.ts`, find:

```ts
      actor: authed.session.user.name ?? "",
      settings,
      createCustomer: true,
    });
    if ("error" in result) return noStore(failure(result.error, result.status));

```

Replace it with:

```ts
      actor: authed.session.user.name ?? "",
      settings,
      createCustomer: true,
      // 1B final review M-f: the round is marked as the server's, so the repair sweep covers it.
      ...(intent ? { printDeviceId: intent.deviceId } : {}),
    });
    if ("error" in result) return noStore(failure(result.error, result.status));

```

Replace the whole of `apps/cafe/app/api/order-requests/[id]/kot-claim/route.ts` with:

```ts
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { claimKotPrint } from "@/lib/pos-pulse";
import { claimKotPrintForAgent } from "@/lib/print-agent-server";
import { printIntentOf } from "@/lib/print-order-jobs";
import { success, notFound, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// POST /api/order-requests/[id]/kot-claim (CR2.3 D9) — the staff-side claim
// that gates auto-print of a self-order's KOT to exactly one caller. A lost
// race (`claimed:false, reason:"raced"`) is a NORMAL outcome, not an error —
// this always answers 200 so the client's auto-print bridge can just skip a
// lost claim instead of surfacing an error toast for it.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  // Checked BEFORE any query and never echoed back — mirrors every other
  // [id] route's notFound() convention for a malformed id.
  if (!mongoose.isValidObjectId(id)) return noStore(notFound("Order request not found"));

  try {
    await connectDB();
    // Printing Phase 1 Session 1C (ruling R4, job-aware lane; lib/print-agent-server.ts): an agent's
    // claim makes the KOT a print job in this same request. Without the header: exactly as before.
    const intent = printIntentOf(req);
    const result = intent ? await claimKotPrintForAgent(id, intent, Date.now()) : await claimKotPrint(id);
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to claim KOT print", error));
  }
}
```

In `apps/cafe/app/api/order-requests/pulse/route.ts`, find:

```ts
import { connectDB } from "@/lib/db";
import { readPosPulse } from "@/lib/pos-pulse";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

```

Replace it with:

```ts
import { connectDB } from "@/lib/db";
import { readPosPulse } from "@/lib/pos-pulse";
import { printPulseDeviceOf } from "@/lib/print-agent-server";
import { readJobsForDevice } from "@/lib/print-lease";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

```

In `apps/cafe/app/api/order-requests/pulse/route.ts`, find:

```ts
// free tier. The invariant that survives unchanged, and is still pinned, is
// that this route performs NO WRITE (no pruneOrderRequests, no
// prunePrintJobs/prunePrintJobsThrottled) and stays no-store.
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    const data = await readPosPulse();
    return noStore(success(data));
  } catch (error) {
    return noStore(serverError("Failed to fetch pos pulse", error));
  }
```

Replace it with:

```ts
// free tier. The invariant that survives unchanged, and is still pinned, is
// that this route performs NO WRITE (no pruneOrderRequests, no
// prunePrintJobs/prunePrintJobsThrottled) and stays no-store.
//
// Printing Phase 1 Session 1C (spec §9.1): an agent tab names itself (?device=<id>) and the answer adds
// printJobsForMe, the jobs waiting in that device's own line, so a job the server re-queued or sent
// home reaches its agent within one tick even with the socket down. One more bounded, index-backed
// READ on a poll that already runs (no new request), fail-soft: a failed read omits the field.
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const device = printPulseDeviceOf(req.url);

  try {
    await connectDB();
    const [data, printJobsForMe] = await Promise.all([
      readPosPulse(),
      device === null ? Promise.resolve(null) : readJobsForDevice(device, Date.now()).catch(() => null),
    ]);
    return noStore(success(printJobsForMe === null ? data : { ...data, printJobsForMe }));
  } catch (error) {
    return noStore(serverError("Failed to fetch pos pulse", error));
  }
```

In `apps/cafe/lib/order-request-accept-addround.ts`, find:

```ts
import { chargesFromOrder, splitChargeTotals } from "@pos/shared/order-charges";
import { chargeWriteFields } from "@/lib/order-charges-write";
import { buildKotFiredAt, buildKotNumbers, mergedNote } from "@/lib/order-request-accept-core";
import {
  resolveAcceptPromoFor,
  promoNoteLine,
```

Replace it with:

```ts
import { chargesFromOrder, splitChargeTotals } from "@pos/shared/order-charges";
import { chargeWriteFields } from "@/lib/order-charges-write";
import { buildKotFiredAt, buildKotNumbers, mergedNote } from "@/lib/order-request-accept-core";
import { buildKotPrintDevices } from "@/lib/print-order-jobs";
import {
  resolveAcceptPromoFor,
  promoNoteLine,
```

In `apps/cafe/lib/order-request-accept-addround.ts`, find:

```ts
    | "charges"
    | "kotNumbers"
    | "kotFiredAt"
    | "createdAt"
    | "notes"
    | "rewardAt"
```

Replace it with:

```ts
    | "charges"
    | "kotNumbers"
    | "kotFiredAt"
    | "kotPrintDevices"
    | "createdAt"
    | "notes"
    | "rewardAt"
```

In `apps/cafe/lib/order-request-accept-addround.ts`, find:

```ts
  // accepted by staff). It must stamp the fire time too, or the kitchen board
  // ages this round from the tab's open time and shows it "Late" on arrival.
  const kotFiredAt = buildKotFiredAt(openTab.kotFiredAt, round, new Date(), openTab.createdAt);
  // FIX6 — carry the diner's note (and a promo line, when a discount
  // applied — promoNoteLine, order-request-accept-promo.ts) onto the tab,
  // through the EXISTING mergedNote helper both times so it composes with
```

Replace it with:

```ts
  // accepted by staff). It must stamp the fire time too, or the kitchen board
  // ages this round from the tab's open time and shows it "Late" on arrival.
  const kotFiredAt = buildKotFiredAt(openTab.kotFiredAt, round, new Date(), openTab.createdAt);
  // Printing Phase 1 (1B final review M-f): a round the server prints for a staff tab is the server's to
  // repair too, so this same CAS records which device asked (positional, like kotNumbers).
  const kotPrintDevices = buildKotPrintDevices(openTab.kotPrintDevices, round, ctx.printDeviceId);
  // FIX6 — carry the diner's note (and a promo line, when a discount
  // applied — promoNoteLine, order-request-accept-promo.ts) onto the tab,
  // through the EXISTING mergedNote helper both times so it composes with
```

In `apps/cafe/lib/order-request-accept-addround.ts`, find:

```ts
      source: SELF_ORDER_SOURCE,
      ...(chargeFields.set ?? {}),
      ...(kotNumbers ? { kotNumbers } : {}),
      ...(notesChanged ? { notes } : {}),
    },
    $addToSet: { sourceRequestIds: requestId },
```

Replace it with:

```ts
      source: SELF_ORDER_SOURCE,
      ...(chargeFields.set ?? {}),
      ...(kotNumbers ? { kotNumbers } : {}),
      ...(kotPrintDevices ? { kotPrintDevices } : {}),
      ...(notesChanged ? { notes } : {}),
    },
    $addToSet: { sourceRequestIds: requestId },
```

In `apps/cafe/lib/order-request-accept.ts`, find:

```ts
  actor: string;
  settings: ISettings | null; // nullable like readSettings() — degrades to defaults
  createCustomer: boolean;
}

// The bridge itself: resulting Order + resolved OrderRequest, or a rejection.
```

Replace it with:

```ts
  actor: string;
  settings: ISettings | null; // nullable like readSettings() — degrades to defaults
  createCustomer: boolean;
  /** Printing Phase 1 (1B final review M-f): the agent that asked the server to print this round's KOT.
   *  The same order write records it in Order.kotPrintDevices, so the repair sweep covers the round.
   *  Absent (the public auto-accept, a tab that prints its own) writes nothing. */
  printDeviceId?: string;
}

// The bridge itself: resulting Order + resolved OrderRequest, or a rejection.
```

In `apps/cafe/lib/order-request-accept.ts`, find:

```ts
    ...(request.targetKind === PARCEL_SELECTION ? { parcel: true } : {}),
    source: SELF_ORDER_SOURCE,
    sourceRequestIds: [requestId],
  };

  // Same atomic per-day counter as POST /api/orders; the day-rollover retry
```

Replace it with:

```ts
    ...(request.targetKind === PARCEL_SELECTION ? { parcel: true } : {}),
    source: SELF_ORDER_SOURCE,
    sourceRequestIds: [requestId],
    ...(ctx.printDeviceId ? { kotPrintDevices: [ctx.printDeviceId] } : {}),
  };

  // Same atomic per-day counter as POST /api/orders; the day-rollover retry
```

Create `apps/cafe/lib/print-agent-server.ts`:

```ts
import { SELF_ORDER_RECEIVER } from "@pos/shared/public";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { claimKotPrint } from "@/lib/pos-pulse";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { createOrderPrintJobs, wireOrderOf, type PrintIntent } from "@/lib/print-order-jobs";
import type { Order } from "@/types";

// Printing redesign, Phase 1 Session 1C: the server half of the in-page agent that is not a lifecycle
// route. Never calls connectDB() (the routes do). No console.*.
//
// The job-aware self-order lane (ruling R4, after the Session 1B final review's C1). The lane that wins
// /kot-claim no longer prints the KOT on its own page: when it asks as an agent, the SAME request makes
// the KOT a print job (today's key, kot:<orderId>:<round>) for the device that prints now (the host,
// or the claiming device with no host), so the slip gets lease → write → ack, a labelled retry and the
// readback. There is one creator per KOT, because the claim CAS still lets exactly one lane win, so
// nothing can race the public auto-accept: that stays exactly as live today and makes no job.
// A failed create keeps the claim won (the D9 marker is never reopened) and names no job, so the lane
// enqueues the KOT itself under the same key (the 1C client's missing-ref rule). No new request, no new
// write beyond the job itself.

export type AgentKotClaimResult =
  | { claimed: false; reason: "no-order" | "raced" | "not-eligible" }
  | { claimed: true; order: Order & { printJobs?: PrintJobRef[] }; kotRound: number };

export async function claimKotPrintForAgent(id: string, intent: PrintIntent, nowMs: number): Promise<AgentKotClaimResult> {
  const result = await claimKotPrint(id);
  if (!result.claimed) return result;
  const printJobs = await createOrderPrintJobs({
    order: result.order,
    slips: [{ kind: "kot", round: result.kotRound }],
    originDeviceId: intent.deviceId,
    queuedBy: SELF_ORDER_RECEIVER,
    nowMs,
  });
  const order = wireOrderOf(result.order);
  return { claimed: true, order: printJobs.length > 0 ? { ...order, printJobs } : order, kotRound: result.kotRound };
}

/** GET /api/order-requests/pulse?device=<id>: the agent tab that names itself hears how many jobs wait
 *  in its own line (spec §9.1). Anything unusable is ignored, never a 400: the pulse must not fail. */
export function printPulseDeviceOf(url: string): string | null {
  const raw = new URL(url).searchParams.get("device")?.trim() ?? "";
  return raw !== "" && raw.length <= PRINT_HOST_DEVICE_ID_MAX_CHARS ? raw : null;
}
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
      ...printJobLifecycleInit(input.nowMs, printJobInitialLabels(payload)),
      log: [printJobCreatedLog(input.nowMs, input.originDeviceId)],
    });
    const ref: PrintJobRef = { id: String(created._id), kind: payload.kind, targetDeviceId: input.targetDeviceId, label: input.request.label };
    return { ref, created: true, status: "queued" };
  } catch (error) {
    if (!isDuplicateKeyError(error) || jobKey === undefined) throw error;
```

Replace it with:

```ts
      ...printJobLifecycleInit(input.nowMs, printJobInitialLabels(payload)),
      log: [printJobCreatedLog(input.nowMs, input.originDeviceId)],
    });
    const ref: PrintJobRef = {
      id: String(created._id),
      kind: payload.kind,
      targetDeviceId: input.targetDeviceId,
      label: input.request.label,
      status: "queued",
    };
    return { ref, created: true, status: "queued" };
  } catch (error) {
    if (!isDuplicateKeyError(error) || jobKey === undefined) throw error;
```

In `apps/cafe/lib/print-order-jobs.ts`, find:

```ts
      kind: existing.kind,
      targetDeviceId: existing.targetDeviceId ?? input.targetDeviceId,
      label: existing.label,
    };
    return { ref, created: false, status: existing.status };
  }
```

Replace it with:

```ts
      kind: existing.kind,
      targetDeviceId: existing.targetDeviceId ?? input.targetDeviceId,
      label: existing.label,
      status: existing.status,
    };
    return { ref, created: false, status: existing.status };
  }
```

In `apps/cafe/lib/print-queue.ts`, find:

```ts
  type PrintJobDismissReason,
  type PrintJobEnqueueResult,
} from "@pos/shared/print-job";
import { printJobCreatedLog, printJobInitialLabels, printJobLifecycleInit } from "@pos/shared/print-lifecycle";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
```

Replace it with:

```ts
  type PrintJobDismissReason,
  type PrintJobEnqueueResult,
} from "@pos/shared/print-job";
import { PRINT_JOB_LOG_MAX, printJobCreatedLog, printJobInitialLabels, printJobLifecycleInit } from "@pos/shared/print-lifecycle";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
```

In `apps/cafe/lib/print-queue.ts`, find:

```ts
  // the one outcome that does NOT authorize a local duplicate print.
  try {
    const hostStillThere = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("_id").lean();
    if (!hostStillThere) {
      const orphanDismiss = await dismissPrintJob({
        id: createdId,
```

Replace it with:

```ts
  // the one outcome that does NOT authorize a local duplicate print.
  try {
    const hostStillThere = await PrintHost.findOne({ key: PRINT_HOST_KEY }).select("_id").lean();
    if (!hostStillThere && input.originDeviceId !== undefined) {
      // Session 1B final review M-a: a row that names the device that asked for it is not an orphan.
      // With no host that device prints its own slips (§6.6), so the row goes home now, and the asking
      // agent follows it by id. Dismissing it would make the agent's own fallback enqueue collide with
      // a dismissed row under the same key, and the slip would print nowhere.
      await PrintJob.updateOne(
        { _id: createdId, status: "queued" },
        {
          $set: { targetDeviceId: input.originDeviceId },
          $push: { log: { $each: [{ at: new Date(nowMs), event: "retargeted", deviceId: input.originDeviceId }], $slice: -PRINT_JOB_LOG_MAX } },
        },
      );
      publishPrintStatus({ id: createdId, status: "queued", target: input.originDeviceId });
      return { outcome: "queued", id: createdId, duplicate: false };
    }
    if (!hostStillThere) {
      const orphanDismiss = await dismissPrintJob({
        id: createdId,
```

In `apps/cafe/lib/print-queue.ts`, find:

```ts
  // the job is already committed, and the poll still finds it if the nudge is
  // lost. Correctness stays with print-queue-claim.ts's CAS, never with this.
  publishCafeEvent("print-job");
  return { outcome: "queued", id: createdId, duplicate: false };
}

```

Replace it with:

```ts
  // the job is already committed, and the poll still finds it if the nudge is
  // lost. Correctness stays with print-queue-claim.ts's CAS, never with this.
  publishCafeEvent("print-job");
  // Session 1B final review M-e: like a server-made job, an enqueued one announces itself to the
  // agent it is aimed at (R7: that agent leases on it) and to the asking device's readback.
  publishPrintStatus({ id: createdId, status: "queued", target: host.deviceId });
  return { outcome: "queued", id: createdId, duplicate: false };
}

```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  kind: PrintJobKind;
  targetDeviceId: string;
  label: string;
}

export const PRINT_DEVICE_SHELLS = ["android", "windows", "browser"] as const;
```

Replace it with:

```ts
  kind: PrintJobKind;
  targetDeviceId: string;
  label: string;
  /** The job's state when the answer was built (1B final review M-d): a deduped ref to a job that
   *  already printed (or was dismissed) is followed, never leased or re-sent as if it were fresh. */
  status: PrintJobStatus;
}

export const PRINT_DEVICE_SHELLS = ["android", "windows", "browser"] as const;
```

In `packages/shared/src/self-order-alert.ts`, find:

```ts
  // length===limit proxy, so the band can tell "this id is in no feed because
  // the read was cut at PRINT_JOB_RESOLVED_LIMIT" from "genuinely gone".
  resolvedPrintJobsTruncated: boolean;
}

/** What changed between two consecutive polls, for the provider to act on. */
```

Replace it with:

```ts
  // length===limit proxy, so the band can tell "this id is in no feed because
  // the read was cut at PRINT_JOB_RESOLVED_LIMIT" from "genuinely gone".
  resolvedPrintJobsTruncated: boolean;
  // Printing Phase 1 Session 1C (spec §9.1): present only when the tab named itself (?device=): how
  // many jobs wait in this device's own line, and the oldest. Absent on a failed read.
  printJobsForMe?: { count: number; oldestCreatedAt: string | null };
}

/** What changed between two consecutive polls, for the provider to act on. */
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-order-jobs.test.ts lib/print-queue-fixes.test.ts lib/realtime-paths.test.ts lib/self-order-alert-paths.test.ts lib/print-queue.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 153`; `# pass 153`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/packages/shared && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add "apps/cafe/app/api/order-requests/[id]/accept/route.ts" "apps/cafe/app/api/order-requests/[id]/kot-claim/route.ts" apps/cafe/app/api/order-requests/pulse/route.ts apps/cafe/lib/order-request-accept-addround.ts apps/cafe/lib/order-request-accept.ts apps/cafe/lib/print-agent-server.ts apps/cafe/lib/print-order-jobs.test.ts apps/cafe/lib/print-order-jobs.ts apps/cafe/lib/print-queue.ts packages/shared/src/print-agent-wire.ts packages/shared/src/self-order-alert.ts
git commit -m "feat(print): an agent's self-order claim makes its KOT a print job; refs carry their status; an orphaned enqueue goes home; the pulse names an agent's waiting jobs; staff-accepted rounds are repairable"
```

---

### Task C3: the agent core, its wire and the budget pins

**Files:**
- Create: `apps/cafe/lib/print-agent.ts` (`createPrintAgent`, the pending-ack store, the kick bus, the pulse device seam)
- Create: `apps/cafe/lib/print-agent-wake.ts` (`createPrintAgentWake`, the host's wake POST cadence)
- Create: `apps/cafe/lib/print-agent.test.ts`
- Modify: `packages/shared/src/print-agent-wire.ts` (`PRINT_AGENT_REFUSED_RECHECK_MS`, the timer clamp, `printAgentMayLease`)
- Modify: `packages/shared/src/api-client.ts` (`apiSend`'s optional fourth `options.headers`; shared with the Hub, backward compatible)
- Modify: `apps/cafe/lib/realtime-client.ts` (listeners also get the parsed frame)
- Modify: `packages/shared/src/print-budget.test.ts` (five pins), `apps/cafe/package.json` (`testChain`)

**Interfaces produced:** `createPrintAgent(deps): { setGate({ enabled, busy }); kick(); flushAcks(); stop() }`; `createPrintAgentWake(deps): { start(); stop(); sawJob() }`; `kickPrintAgent()` / `onPrintAgentKick(fn)`; `setPulsePrintDevice(id | null)` / `pulsePrintDeviceQuery()`; `readPendingAcks()` / `writePendingAcks()` (`pos.print-ack-pending.v1`); `printAgentMayLease(...)`; `printAgentTimerDelayMs(atMs, nowMs)`; `RealtimeListener = (kind, message) => void`.

**The owner's rule in the agent:** it never leases while `canPrintNow()` is false (the printer is off, not connected, or in another tab), and after a refusal it waits for the printer's state to change, or 30 s. Its only timer is local and clamped to 2–30 s from the server's `retryAt` / `nextAttemptAt` (clock skew). A printed ack is kept before it is sent and re-sent every 5 s for 10 minutes; any server answer clears it (1A review M3).

**Gate finding G4 (found by the gate's own E2E run on the emulator):** the first draft's `flushAcks` stored an async body's promise after that body had already finished (nothing pending at mount), so every later printed ack was silently dropped and every slip expired into a REPRINT. Fixed with `sendPending().finally(...)`; the test "a flush with nothing pending never blocks a later printed ack" was proven RED on the old code.

`print-agent.ts` stays under 300 lines because the host's wake lives in `print-agent-wake.ts`.

- [ ] **Step 1: The failing tests first**

Create `apps/cafe/lib/print-agent.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { ApiError } from "@/lib/api-client";
import { PRINT_ACK_PENDING_MAX_MS, PRINT_ACK_RETRY_MS } from "@pos/shared/print-lifecycle";
import { PRINT_WAKE_FAST_MS, PRINT_WAKE_SLOW_MS, PRINT_WAKE_SOCKET_MS } from "@pos/shared/print-job";
import { PRINT_AGENT_REFUSED_RECHECK_MS, type LeasedPrintJob, type PrintAckData, type PrintLeaseData } from "@pos/shared/print-agent-wire";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import {
  createPrintAgent,
  failedAckBody,
  type PendingPrintAck,
  type PrintAgentAckBody,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_TOO_LARGE_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing Phase 1 Session 1C (spec §9.1, the owner's rules after Session 1B): the agent core, driven
// with fakes and a hand-cranked clock. Every network call it makes is recorded.

const T0 = 1_800_000_000_000;

function job(id: string, epoch = 1): LeasedPrintJob {
  return {
    id,
    epoch,
    kind: "kot",
    label: `KOT ${id}`,
    createdAt: new Date(T0).toISOString(),
    payload: { kind: "eod", dateKey: "2026-10-03", dateLabel: "3 Oct" } as unknown as LeasedPrintJob["payload"],
    labels: [],
    copyIndex: 0,
    attempt: epoch,
  };
}

function world() {
  const w = {
    now: T0,
    timers: [] as { at: number; fn: () => void; id: number }[],
    nextId: 1,
    leases: [] as PrintLeaseData[],
    leaseCalls: 0,
    leaseFails: false,
    acks: [] as { id: string; body: PrintAgentAckBody }[],
    ackAnswers: [] as Array<PrintAckData | Error>,
    prints: [] as string[],
    results: [] as PrintAgentResult[],
    ready: true,
    printer: {} as object,
    pending: [] as PendingPrintAck[],
  };
  const deps = {
    deviceId: "dev-a",
    lease: async (): Promise<PrintLeaseData> => {
      w.leaseCalls += 1;
      if (w.leaseFails) throw new ApiError("offline", "network", null);
      return w.leases.shift() ?? { jobs: [], retryAt: null };
    },
    ack: async (id: string, body: PrintAgentAckBody): Promise<PrintAckData> => {
      w.acks.push({ id, body });
      const answer = w.ackAnswers.shift() ?? { applied: true, status: body.outcome === "printed" ? "printed" : "queued", nextAttemptAt: null };
      if (answer instanceof Error) throw answer;
      return answer;
    },
    print: async (j: LeasedPrintJob): Promise<PrintAgentResult> => {
      w.prints.push(j.id);
      return w.results.shift() ?? { ok: true };
    },
    printerReady: () => w.ready,
    printerState: () => w.printer,
    readPending: () => [...w.pending],
    writePending: (entries: PendingPrintAck[]) => void (w.pending = [...entries]),
    now: () => w.now,
    setTimer: (fn: () => void, ms: number) => {
      const id = w.nextId++;
      w.timers.push({ at: w.now + ms, fn, id });
      return id;
    },
    clearTimer: (handle: unknown) => void (w.timers = w.timers.filter((t) => t.id !== handle)),
  };
  return { w, deps };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function advance(w: ReturnType<typeof world>["w"], ms: number): Promise<void> {
  const end = w.now + ms;
  for (;;) {
    w.timers.sort((a, b) => a.at - b.at);
    const next = w.timers[0];
    if (next === undefined || next.at > end) break;
    w.timers.shift();
    w.now = next.at;
    next.fn();
    await settle();
  }
  w.now = end;
}

test("a leased job is printed, its ack is kept until the server answers, and the next job is leased at once", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null }, { jobs: [job("j2")], retryAt: null });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["j1", "j2"], "both jobs printed, one after the other");
  assert.deepEqual(w.acks.map((a) => [a.id, a.body.outcome]), [["j1", "printed"], ["j2", "printed"]], "each printed job is acked");
  assert.equal(w.leaseCalls, 3, "the third lease finds the line empty and the agent stops");
  assert.deepEqual(w.pending, [], "every answered ack is cleared");
  assert.equal(w.timers.length, 0, "an empty line sets no timer: nothing polls");
  agent.stop();
});

// Found by the 1B review gate's E2E run: the page flushes at mount with nothing pending, and an async
// body with no await then finished before its promise was stored, so every later printed ack was dropped.
test("a flush with nothing pending never blocks a later printed ack", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  const agent = createPrintAgent(deps);
  await agent.flushAcks();
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.acks.map((a) => [a.id, a.body.outcome]), [["j1", "printed"]], "the printed ack is sent after an empty flush");
  assert.deepEqual(w.pending, [], "and cleared on the answer");
  agent.stop();
});

test("the owner's rule: no lease at all while this device's printer can not print", async () => {
  const { w, deps } = world();
  w.ready = false;
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  agent.kick();
  agent.kick();
  await advance(w, 10 * 60_000);
  assert.equal(w.leaseCalls, 0, "a printer that is off is never leased for, so no attempt is burned");
  w.ready = true;
  agent.kick();
  await settle();
  assert.deepEqual(w.prints, ["j1"], "it prints once the printer is back");
  agent.stop();
});

test("a refusal (nothing sent) acks sent:'no' and holds the agent until the printer's state changes", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null }, { jobs: [job("j1", 2)], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.acks[0]?.body, { deviceId: "dev-a", epoch: 1, outcome: "failed", sent: "no", error: PRINTER_NOT_CONNECTED_MESSAGE });
  await advance(w, 10_000);
  agent.kick();
  await settle();
  assert.equal(w.leaseCalls, 1, "no new lease while the printer is the one that refused");
  w.printer = {};
  agent.kick();
  await settle();
  assert.equal(w.leaseCalls, 3, "a changed printer state (it reconnected) leases again, prints, then finds the line empty");
  assert.deepEqual(w.prints, ["j1", "j1"], "the same slip prints, unlabelled: nothing reached paper the first time");
  agent.stop();
});

test("a refusal with no printer change is retried after the recheck window, never sooner", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  await advance(w, PRINT_AGENT_REFUSED_RECHECK_MS - 1);
  assert.equal(w.leaseCalls, 1, "nothing inside the window");
  await advance(w, 2);
  assert.equal(w.leaseCalls, 2, "one lease once the window has passed");
  agent.stop();
});

test("a maybe-printed failure acks sent:'maybe', and the retry waits for the server's nextAttemptAt", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null }, { jobs: [job("j1", 2)], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_WRITE_FAILED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 5_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.acks[0]?.body.sent, "maybe");
  assert.equal(w.leaseCalls, 1, "no lease before nextAttemptAt (no wasted request on a job in backoff)");
  await advance(w, 5_000);
  assert.equal(w.leaseCalls, 3, "the local timer leases the retry, which prints; then the line is empty");
  assert.deepEqual(w.prints, ["j1", "j1"], "the retry is the same slip (the server labels it REPRINT)");
  agent.stop();
});

test("a permanent failure says so; a parked or failed answer frees the line for the next job", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null }, { jobs: [job("j2")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_TOO_LARGE_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "failed", nextAttemptAt: null });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.acks[0]?.body.permanent, true, "too large never prints");
  assert.deepEqual(w.prints, ["j1", "j2"], "the next job prints straight after");
  assert.equal(failedAckBody("d", 1, { sent: "maybe", permanent: false, message: "x".repeat(300) }).error?.length, 200, "the error fits the ack schema");
  agent.stop();
});

test("a printed ack with no answer is retried every 5 s; any server answer clears it; 10 minutes drops it", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.ackAnswers.push(new ApiError("offline", "network", null), new ApiError("server", "http", 503), new ApiError("gone", "http", 409));
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.pending.length, 1, "kept after a network error");
  await advance(w, PRINT_ACK_RETRY_MS);
  assert.equal(w.pending.length, 1, "kept after a 5xx");
  await advance(w, PRINT_ACK_RETRY_MS);
  assert.equal(w.pending.length, 0, "a 409 is an answer: cleared");
  assert.equal(w.acks.length, 3, "three sends, then no more");
  w.pending = [{ id: "old", epoch: 1, at: w.now - PRINT_ACK_PENDING_MAX_MS - 1 }];
  await agent.flushAcks();
  assert.deepEqual(w.pending, [], "an entry older than 10 minutes is dropped unsent");
  assert.equal(w.acks.length, 3, "the expired entry was not sent");
  agent.stop();
});

test("timers from the server's clock are clamped to 2–30 s, and an unreachable lease waits 30 s (no tight loop)", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [], retryAt: new Date(T0 - 60_000).toISOString() });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.timers[0]?.at, T0 + 2_000, "a retryAt in the past waits the shortest step");
  await advance(w, 2_000);
  assert.equal(w.leaseCalls, 2);
  w.leaseFails = true;
  agent.kick();
  await settle();
  await advance(w, PRINT_AGENT_REFUSED_RECHECK_MS - 1);
  assert.equal(w.leaseCalls, 3, "offline: one failed lease, then quiet");
  await advance(w, 1);
  assert.equal(w.leaseCalls, 4, "one more after 30 s");
  agent.stop();
});

test("a closed gate or a busy bridge leases nothing; opening it kicks once; stop clears every timer", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  const agent = createPrintAgent(deps);
  agent.kick();
  agent.setGate({ enabled: true, busy: true });
  agent.kick();
  await settle();
  assert.equal(w.leaseCalls, 0, "not enabled, then busy: nothing");
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["j1"], "the bridge freeing up kicks the agent");
  agent.stop();
  agent.kick();
  await settle();
  assert.equal(w.timers.length, 0, "a stopped agent holds no timer");
});

test("the host's wake polls at the spec §9.1 cadence, never while hidden or past its cap, and kicks only on jobs", async () => {
  const { w } = world();
  let wakes = 0;
  let jobs = 0;
  let healthy = false;
  let visible = true;
  let budget = 3;
  let waiting = 0;
  const wake = createPrintAgentWake({
    wake: async () => {
      wakes += 1;
      return { jobsForMe: { count: waiting, oldestCreatedAt: null }, agents: 1, agentDailyCap: 14_400, serverNow: new Date(w.now).toISOString() };
    },
    socketHealthy: () => healthy,
    mayPoll: () => visible,
    spendOne: () => (budget -= 1) >= 0,
    onJobs: () => void (jobs += 1),
    now: () => w.now,
    setTimer: (fn, ms) => {
      const id = w.nextId++;
      w.timers.push({ at: w.now + ms, fn, id });
      return id;
    },
    clearTimer: (handle) => void (w.timers = w.timers.filter((t) => t.id !== handle)),
  });
  wake.start();
  await settle();
  assert.equal(wakes, 1, "the first wake at once");
  assert.equal(w.timers[0]?.at, T0 + PRINT_WAKE_SLOW_MS, "no job seen: the slow cadence");
  waiting = 1;
  await advance(w, PRINT_WAKE_SLOW_MS);
  assert.equal(jobs, 1, "a job for me kicks the agent");
  assert.equal(w.timers[0]?.at, w.now + PRINT_WAKE_FAST_MS, "a job seen: the fast cadence");
  healthy = true;
  waiting = 0;
  await advance(w, PRINT_WAKE_FAST_MS);
  assert.equal(w.timers[0]?.at, w.now + PRINT_WAKE_SOCKET_MS, "a healthy socket: the 60 s safety net");
  assert.equal(wakes, 3);
  await advance(w, PRINT_WAKE_SOCKET_MS);
  assert.equal(wakes, 3, "the cap is spent: no request");
  visible = false;
  budget = 99;
  await advance(w, 10 * PRINT_WAKE_SLOW_MS);
  assert.equal(wakes, 3, "a hidden tab never polls");
  wake.stop();
});
```

In `apps/cafe/package.json`, find:

```json
    "lib/print-order-jobs.test.ts",
    "lib/print-repair.test.ts",
    "lib/print-write-outcome.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
    "lib/pos-install-paths.test.ts",
```

Replace it with:

```json
    "lib/print-order-jobs.test.ts",
    "lib/print-repair.test.ts",
    "lib/print-write-outcome.test.ts",
    "lib/print-agent.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
    "lib/pos-install-paths.test.ts",
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINT_WAKE_DAILY_CAP } from "./print-job";
import { printAgentPollsWake, printAgentWakeIntervalMs, printWakeAgentCap } from "./print-agent-wire";
import {
  PRINT_AGENT_MIN_CADENCE_MS,
  PRINT_BUDGET_BUSY_DAY,
```

Replace it with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINT_HOST_MAX_AGE_MS, PRINT_WAKE_DAILY_CAP } from "./print-job";
import {
  PRINT_AGENT_REFUSED_RECHECK_MS,
  PRINT_AGENT_TIMER_MAX_MS,
  PRINT_AGENT_TIMER_MIN_MS,
  printAgentMayLease,
  printAgentPollsWake,
  printAgentTimerDelayMs,
  printAgentWakeIntervalMs,
  printWakeAgentCap,
} from "./print-agent-wire";
import { PRINT_ACK_PENDING_MAX_MS, PRINT_ACK_RETRY_MS, PRINT_BACKOFF_MS, PRINT_MAX_PAPER_ATTEMPTS } from "./print-lifecycle";
import {
  PRINT_AGENT_MIN_CADENCE_MS,
  PRINT_BUDGET_BUSY_DAY,
```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});

```

Replace it with:

```ts
  assert.ok(perDay <= REALTIME_FREE_REQUESTS_PER_DAY * 0.05, `${perDay}/day`);
});

// Session 1C (the owner's decisions after Session 1B): no automatic attempt while a printer is off, at
// most two attempts that may reach paper per slip, and nothing the agent adds is a recurring request on
// an ordering device. Every new cadence the agent has is pinned here.
test("1C agent: it never leases while its printer can not print, while a refusal holds, or while busy", () => {
  const open = { enabled: true, busy: false, running: false, printerReady: true, refusalHolds: false };
  assert.equal(printAgentMayLease(open), true, "an open gate leases");
  for (const closed of [{ enabled: false }, { busy: true }, { running: true }, { printerReady: false }, { refusalHolds: true }]) {
    assert.equal(printAgentMayLease({ ...open, ...closed }), false, `closed by ${JSON.stringify(closed)}`);
  }
});

test("1C agent: its one local timer is clamped to 2–30 s from the server's clock, never a tight loop", () => {
  const now = 1_800_000_000_000;
  assert.equal(printAgentTimerDelayMs(now - 60_000, now), PRINT_AGENT_TIMER_MIN_MS, "a time in the past waits the shortest step");
  assert.equal(printAgentTimerDelayMs(now + 10 * 60_000, now), PRINT_AGENT_TIMER_MAX_MS, "a far time is re-checked at the steady step");
  assert.equal(printAgentTimerDelayMs(now + 5_000, now), 5_000);
  assert.ok(PRINT_AGENT_TIMER_MIN_MS >= PRINT_BACKOFF_MS[0], "never sooner than the shortest backoff");
  assert.ok(PRINT_AGENT_TIMER_MAX_MS <= PRINT_BACKOFF_MS[PRINT_BACKOFF_MS.length - 1], "never later than the steady backoff");
});

test("1C agent: a printer that says ready but keeps refusing costs at most one lease and one ack per 30 s per slip, until the slip is stale", () => {
  assert.ok(PRINT_AGENT_REFUSED_RECHECK_MS >= 30_000, "a refusal holds the agent at least 30 s");
  const perStuckSlip = 2 * Math.ceil(PRINT_HOST_MAX_AGE_MS / PRINT_AGENT_REFUSED_RECHECK_MS);
  assert.ok(perStuckSlip <= 120, `${perStuckSlip} requests over the 30-minute stale window, then the slip waits for a tap`);
});

test("1C agent: a ready printer makes at most two attempts per slip (the first plus one labelled retry): at most 4 requests", () => {
  assert.equal(PRINT_MAX_PAPER_ATTEMPTS, 2, "the owner's rule");
  assert.ok(PRINT_MAX_PAPER_ATTEMPTS * 2 <= 4, "a lease and an ack per attempt");
});

test("1C agent: an unanswered printed ack is re-sent every 5 s for at most 10 minutes, only while no answer comes", () => {
  assert.ok(PRINT_ACK_RETRY_MS >= 5_000, "never faster than every 5 s");
  assert.ok(PRINT_ACK_PENDING_MAX_MS / PRINT_ACK_RETRY_MS <= 120, "at most 120 re-sends per lost ack, then it is dropped");
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|does not provide"`
Expected: `# SyntaxError: The requested module './print-agent-wire' does not provide an export named 'PRINT_AGENT_REFUSED_RECHECK_MS'`; `# tests 1`; `# pass 0`; `# fail 1`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|Cannot find module"`
Expected: `# Error: Cannot find module '@/lib/print-agent-wake'`; `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

Create `apps/cafe/lib/print-agent-wake.ts`:

```ts
import { PRINT_WAKE_SLOW_MS } from "@pos/shared/print-job";
import { printAgentWakeIntervalMs, type PrintWakeBeatData } from "@pos/shared/print-agent-wire";

// Printing redesign, Phase 1 Session 1C: the HOST agent's wake poll (spec §9.1, §10). Only the host
// polls (R6, printAgentPollsWake); every other agent hears about its jobs from its own order answers,
// targeted print-status frames and the existing pulse. No React; unit-tested in lib/print-agent.test.ts.

export interface PrintAgentWakeDeps {
  wake(): Promise<PrintWakeBeatData>;
  socketHealthy(): boolean;
  /** A visible tab, or the desktop shell (always on): a hidden browser tab never polls. */
  mayPoll(): boolean;
  /** Spends one hit of today's cap; false once it is spent (spec §9.1, decision 6). */
  spendOne(): boolean;
  onJobs(): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** The host agent's wake poll (spec §9.1; only the host polls, R6): the heartbeat, plus "jobs for me".
 *  Its cadence is printAgentWakeIntervalMs, so the budget test bounds it. */
export function createPrintAgentWake(deps: PrintAgentWakeDeps): { start(): void; stop(): void; sawJob(): void } {
  let timer: unknown = null;
  let stopped = false;
  let lastJobAt: number | null = null;
  let capSpent = false;

  async function tick(): Promise<void> {
    timer = null;
    let delay: number = PRINT_WAKE_SLOW_MS;
    try {
      if (deps.mayPoll()) {
        capSpent = !deps.spendOne();
        if (!capSpent) {
          const data = await deps.wake();
          if (data.jobsForMe.count > 0) {
            lastJobAt = deps.now();
            deps.onJobs();
          }
        }
      }
      const interval = printAgentWakeIntervalMs({
        socketHealthy: deps.socketHealthy(),
        msSinceLastJob: lastJobAt === null ? null : deps.now() - lastJobAt,
        capSpent,
      });
      // Spent: no request until the next cafe-day; the local budget check keeps running (no network).
      delay = interval === false ? PRINT_WAKE_SLOW_MS : interval;
    } catch {
      // A failing wake is retried on the slow cadence, never faster.
    }
    if (!stopped) timer = deps.setTimer(() => void tick(), delay);
  }

  return {
    start() {
      if (timer === null && !stopped) void tick();
    },
    stop() {
      stopped = true;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
    },
    sawJob() {
      lastJobAt = deps.now();
    },
  };
}
```

Create `apps/cafe/lib/print-agent.ts`:

```ts
import { PRINT_ACK_ERROR_MAX_CHARS, PRINT_ACK_PENDING_MAX_MS, PRINT_ACK_RETRY_MS } from "@pos/shared/print-lifecycle";
import {
  PRINT_AGENT_REFUSED_RECHECK_MS,
  printAgentMayLease,
  printAgentTimerDelayMs,
  type LeasedPrintJob,
  type PrintAckData,
  type PrintLeaseData,
} from "@pos/shared/print-agent-wire";
import { ApiError } from "@/lib/api-client";
import { printWriteOutcomeOf, type PrintWriteOutcome } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent's core, with no React and
// no globals except the pending-ack store, so every rule below is unit-tested with fakes
// (lib/print-agent.test.ts). hooks/use-print-agent.ts wires it to the page.
//
// One cycle at a time: lease the head of this device's line → print it through the host bridge → ack.
// It never leases while the printer can not print here (the owner's rule: no automatic attempts while
// a printer is off), and after a refusal (sent:"no") it waits for the printer's state to change, or
// PRINT_AGENT_REFUSED_RECHECK_MS. Its only timer is local, set from the server's retryAt/nextAttemptAt.
// A "printed" ack that got no answer is kept in localStorage and re-sent every 5 s for 10 min, and
// cleared on ANY answer from the server (spec §7.9; 1A review M3).

export type PrintAgentResult = { ok: true } | { ok: false; error: unknown };

export interface PrintAgentAckBody {
  deviceId: string;
  epoch: number;
  outcome: "printed" | "failed";
  sent?: "no" | "maybe";
  permanent?: true;
  error?: string;
}

export interface PendingPrintAck {
  id: string;
  epoch: number;
  at: number;
}

export interface PrintAgentDeps {
  deviceId: string;
  lease(): Promise<PrintLeaseData>;
  ack(id: string, body: PrintAgentAckBody): Promise<PrintAckData>;
  /** Prints one leased job through the host bridge. Never rejects. */
  print(job: LeasedPrintJob): Promise<PrintAgentResult>;
  /** canPrintNow(): a printer here that can print right now. */
  printerReady(): boolean;
  /** Any value whose identity changes when this device's printer changes (its snapshot). */
  printerState(): unknown;
  readPending(): PendingPrintAck[];
  writePending(entries: PendingPrintAck[]): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface PrintAgent {
  setGate(gate: { enabled: boolean; busy: boolean }): void;
  kick(): void;
  flushAcks(): Promise<void>;
  stop(): void;
}

/** The pending-ack store keeps at most this many entries (an agent prints one job at a time). */
export const PRINT_ACK_PENDING_LIMIT = 50;

export function failedAckBody(deviceId: string, epoch: number, outcome: PrintWriteOutcome): PrintAgentAckBody {
  const error = outcome.message.trim().slice(0, PRINT_ACK_ERROR_MAX_CHARS).trim();
  return {
    deviceId,
    epoch,
    outcome: "failed",
    sent: outcome.sent,
    ...(outcome.permanent ? { permanent: true as const } : {}),
    ...(error !== "" ? { error } : {}),
  };
}

/** A server answer of any kind clears a pending ack; only no answer (network, timeout) or a 5xx retries. */
export function ackAnswered(error: unknown): boolean {
  return error instanceof ApiError && error.kind === "http" && error.status !== null && error.status < 500;
}

export function createPrintAgent(deps: PrintAgentDeps): PrintAgent {
  let enabled = false;
  let busy = false;
  let running = false;
  let stopped = false;
  let refused: { state: unknown; at: number } | null = null;
  let timer: unknown = null;
  let timerAt = Number.POSITIVE_INFINITY;
  let ackTimer: unknown = null;
  let flushing: Promise<void> | null = null;

  function refusalHolds(): boolean {
    if (refused === null) return false;
    if (deps.printerState() !== refused.state || deps.now() - refused.at >= PRINT_AGENT_REFUSED_RECHECK_MS) {
      refused = null;
      return false;
    }
    return true;
  }

  function wakeAt(atMs: number): void {
    if (stopped) return;
    const delay = printAgentTimerDelayMs(atMs, deps.now());
    const at = deps.now() + delay;
    if (timer !== null && timerAt <= at) return;
    if (timer !== null) deps.clearTimer(timer);
    timerAt = at;
    timer = deps.setTimer(() => {
      timer = null;
      timerAt = Number.POSITIVE_INFINITY;
      kick();
    }, delay);
  }

  function forget(entry: PendingPrintAck): void {
    deps.writePending(deps.readPending().filter((e) => !(e.id === entry.id && e.epoch === entry.epoch)));
  }

  function scheduleAckRetry(): void {
    if (stopped || ackTimer !== null || deps.readPending().length === 0) return;
    ackTimer = deps.setTimer(() => {
      ackTimer = null;
      void flushAcks();
    }, PRINT_ACK_RETRY_MS);
  }

  async function sendPending(): Promise<void> {
    for (const entry of deps.readPending()) {
      if (deps.now() - entry.at > PRINT_ACK_PENDING_MAX_MS) {
        forget(entry);
        continue;
      }
      try {
        await deps.ack(entry.id, { deviceId: deps.deviceId, epoch: entry.epoch, outcome: "printed" });
        forget(entry);
      } catch (error) {
        if (ackAnswered(error)) forget(entry);
      }
    }
  }

  function flushAcks(): Promise<void> {
    // One flush at a time. The reset is chained AFTER the assignment: with nothing pending, an async
    // body would finish before `flushing` was even set, and every later flush would return that stale,
    // resolved promise without sending its ack.
    if (flushing === null) {
      flushing = sendPending().finally(() => {
        flushing = null;
        scheduleAckRetry();
      });
    }
    return flushing;
  }

  async function cycle(): Promise<void> {
    running = true;
    let again = false;
    try {
      const data = await deps.lease();
      const job = data.jobs[0];
      if (job === undefined) {
        if (data.retryAt !== null) wakeAt(Date.parse(data.retryAt));
        return;
      }
      const result = await deps.print(job);
      if (result.ok) {
        // Kept BEFORE it is sent, so a reload mid-ack still reports the paper (spec §7.9). Awaited, so
        // the next lease does not find this job still leased at the head of the line.
        const kept = deps.readPending().filter((e) => e.id !== job.id);
        deps.writePending([...kept, { id: job.id, epoch: job.epoch, at: deps.now() }].slice(-PRINT_ACK_PENDING_LIMIT));
        await flushAcks();
        again = true;
        return;
      }
      const outcome = printWriteOutcomeOf(result.error);
      // Nothing reached the printer: it is off or unreachable. No automatic attempt until it changes.
      if (outcome.sent === "no" && !outcome.permanent) refused = { state: deps.printerState(), at: deps.now() };
      const answer = await deps.ack(job.id, failedAckBody(deps.deviceId, job.epoch, outcome)).catch(() => null);
      if (answer === null) {
        wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
        return;
      }
      // A job back in line waits for its own nextAttemptAt; a parked or failed one frees the line.
      if (answer.nextAttemptAt !== null) wakeAt(Date.parse(answer.nextAttemptAt));
      else again = refused === null;
    } catch {
      // No answer from the lease (offline, a deploy): look again later, never in a tight loop.
      wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
    } finally {
      running = false;
      if (again) kick();
    }
  }

  function kick(): void {
    if (stopped) return;
    const holds = refusalHolds();
    if (!printAgentMayLease({ enabled, busy, running, printerReady: deps.printerReady(), refusalHolds: holds })) {
      if (holds && refused !== null) wakeAt(refused.at + PRINT_AGENT_REFUSED_RECHECK_MS);
      return;
    }
    void cycle();
  }

  return {
    setGate(gate) {
      const opened = (gate.enabled && !enabled) || (!gate.busy && busy);
      enabled = gate.enabled;
      busy = gate.busy;
      if (opened) kick();
    },
    kick,
    flushAcks,
    stop() {
      stopped = true;
      if (timer !== null) deps.clearTimer(timer);
      if (ackTimer !== null) deps.clearTimer(ackTimer);
      timer = null;
      ackTimer = null;
    },
  };
}

// ── The pending-ack store and the agent's two module seams (client-only, never throws) ──────────────

const PENDING_ACK_KEY = "pos.print-ack-pending.v1";

function isPendingAck(v: unknown): v is PendingPrintAck {
  const o = v as Partial<PendingPrintAck> | null;
  return typeof o === "object" && o !== null && typeof o.id === "string" && Number.isInteger(o.epoch) && Number.isFinite(o.at);
}

export function readPendingAcks(): PendingPrintAck[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PENDING_ACK_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isPendingAck) : [];
  } catch {
    return [];
  }
}

export function writePendingAcks(entries: PendingPrintAck[]): void {
  try {
    if (entries.length === 0) window.localStorage.removeItem(PENDING_ACK_KEY);
    else window.localStorage.setItem(PENDING_ACK_KEY, JSON.stringify(entries));
  } catch {
    // A storage that refuses: the ack is still sent now; only its retry after a reload is lost.
  }
}

const kickListeners = new Set<() => void>();

/** An order answer named a job this device prints: lease it now, no poll (spec §9.1). */
export function kickPrintAgent(): void {
  for (const listener of [...kickListeners]) listener();
}

export function onPrintAgentKick(listener: () => void): () => void {
  kickListeners.add(listener);
  return () => void kickListeners.delete(listener);
}

let pulseDevice: string | null = null;

/** The agent with no host names itself on the existing 20 s pulse (?device=), so a job the server
 *  re-queued or sent home reaches it within one tick even with the socket down. Not the host: it polls
 *  the wake, which answers the same. */
export function setPulsePrintDevice(deviceId: string | null): void {
  pulseDevice = deviceId;
}

export function pulsePrintDeviceQuery(): string {
  return pulseDevice === null ? "" : `?device=${encodeURIComponent(pulseDevice)}`;
}
```

In `apps/cafe/lib/realtime-client.ts`, find:

```ts
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60_000;

export type RealtimeListener = (kind: string) => void;

const listeners = new Set<RealtimeListener>();
let socket: WebSocket | null = null;
```

Replace it with:

```ts
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60_000;

/** `message` (printing Phase 1 Session 1C) is the parsed frame, so the print agent and the readback
 *  can read a "print-status" frame's `job`; every older listener reads only `kind`. */
export type RealtimeListener = (kind: string, message: Readonly<Record<string, unknown>>) => void;

const listeners = new Set<RealtimeListener>();
let socket: WebSocket | null = null;
```

In `apps/cafe/lib/realtime-client.ts`, find:

```ts
      pongTimer = undefined;
    }
    let kind: string;
    try {
      const data: unknown = JSON.parse(String(event.data));
      if (typeof data !== "object" || data === null) return; // "pong" lands here
      const raw = (data as { kind?: unknown }).kind;
      if (typeof raw !== "string") return;
      kind = raw;
    } catch {
      return; // "pong" is not JSON — already counted as proof of life above
    }
    // A throwing listener must not starve the others.
    for (const listener of [...listeners]) {
      try {
        listener(kind);
      } catch {
        // Ignore — one bad subscriber cannot break the fan-out.
      }
```

Replace it with:

```ts
      pongTimer = undefined;
    }
    let kind: string;
    let message: Readonly<Record<string, unknown>>;
    try {
      const data: unknown = JSON.parse(String(event.data));
      if (typeof data !== "object" || data === null) return; // "pong" lands here
      const raw = (data as { kind?: unknown }).kind;
      if (typeof raw !== "string") return;
      kind = raw;
      message = data as Record<string, unknown>;
    } catch {
      return; // "pong" is not JSON — already counted as proof of life above
    }
    // A throwing listener must not starve the others.
    for (const listener of [...listeners]) {
      try {
        listener(kind, message);
      } catch {
        // Ignore — one bad subscriber cannot break the fan-out.
      }
```

In `packages/shared/src/api-client.ts`, find:

```ts
// PUT is this app's update verb almost everywhere; PATCH exists for the few seams
// where an admin-only partial edit is deliberately split from a staff-facing PUT
// so the two can carry different auth guards (tables, CR1.1).
export function apiSend<T>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  payload?: unknown,
): Promise<T> {
  return fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then(
```

Replace it with:

```ts
// PUT is this app's update verb almost everywhere; PATCH exists for the few seams
// where an admin-only partial edit is deliberately split from a staff-facing PUT
// so the two can carry different auth guards (tables, CR1.1).
// `options.headers` (printing Phase 1 Session 1C): extra request headers, e.g. the print-agent opt-in.
// Optional and last, so every existing caller (the cafe and the Hub) is unchanged.
export function apiSend<T>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  payload?: unknown,
  options: { headers?: Record<string, string> } = {},
): Promise<T> {
  return fetch(url, {
    method,
    headers: { ...options.headers, "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then(
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
  return PRINT_WAKE_SLOW_MS;
}

/** One leased job (POST /api/print-jobs/lease). The payload rides the lease, so feeds stay metadata only. */
export interface LeasedPrintJob {
  id: string;
```

Replace it with:

```ts
  return PRINT_WAKE_SLOW_MS;
}

/** After a refusal made before any byte was sent (sent:"no": the printer was off or unreachable), the
 *  agent leases again only once its printer's state changes, or after this long (a printer that says
 *  ready but keeps refusing). The owner's rule after Session 1B: no automatic attempts while a printer
 *  is off. A printer the device KNOWS is not connected is never leased for at all. */
export const PRINT_AGENT_REFUSED_RECHECK_MS = 30_000;
/** The agent's one local timer is set from the server's retryAt / nextAttemptAt (server time), so it is
 *  clamped: never sooner than the shortest backoff, never later than the steady one, whatever the
 *  device's own clock says (spec §15, clock skew). */
export const PRINT_AGENT_TIMER_MIN_MS = 2_000;
export const PRINT_AGENT_TIMER_MAX_MS = 30_000;

export function printAgentTimerDelayMs(atMs: number, nowMs: number): number {
  return Math.min(PRINT_AGENT_TIMER_MAX_MS, Math.max(PRINT_AGENT_TIMER_MIN_MS, atMs - nowMs));
}

/** Whether the agent may ask for a lease right now: its tab drains (the lock), nothing is printing, no
 *  cycle is running, the printer can print here, and a recent refusal does not hold it back. */
export function printAgentMayLease(input: {
  enabled: boolean;
  busy: boolean;
  running: boolean;
  printerReady: boolean;
  refusalHolds: boolean;
}): boolean {
  return input.enabled && !input.busy && !input.running && input.printerReady && !input.refusalHolds;
}

/** One leased job (POST /api/print-jobs/lease). The payload rides the lease, so feeds stay metadata only. */
export interface LeasedPrintJob {
  id: string;
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 13`; `# pass 13`; `# fail 0`; `# tests 635`; `# pass 635`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent.test.ts lib/realtime-paths.test.ts lib/realtime-live-state.test.ts lib/realtime-nudge-fetch.test.ts lib/realtime-visible-recheck.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 84`; `# pass 84`; `# fail 0`; `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-agent-wake.ts apps/cafe/lib/print-agent.test.ts apps/cafe/lib/print-agent.ts apps/cafe/lib/realtime-client.ts apps/cafe/package.json packages/shared/src/api-client.ts packages/shared/src/print-agent-wire.ts packages/shared/src/print-budget.test.ts
git commit -m "feat(print): the print agent's core: lease, print, ack, never while the printer is off; pending acks; the host's wake; the budget pins"
```

---

### Task C4: every device prints through the agent: the hook, the bridge's outcomes, the banner, the call sites

**Files:**
- Create: `apps/cafe/hooks/use-print-agent.ts` (wires the core to the page: bridge, printer, realtime, pulse, the host's wake, `app.wake`)
- Create: `apps/cafe/lib/print-agent-calls.ts` (`printAgentHeaders`, `printAgentRequestOptions`, `printAgentEnqueueHeaders`, `printJobRefOf`)
- Create: `apps/cafe/lib/print-host-outcomes.ts` (the bridge's per-slip result FIFO)
- Create: `apps/cafe/components/pos/PrintBanner.tsx`, `apps/cafe/lib/print-agent-paths.test.ts`
- Replace: `apps/cafe/components/print/PrintHostDrain.tsx` (the agent replaces the claim drain and the GET wake)
- Modify: `apps/cafe/components/layout/PrintHostProvider.tsx` (stays at 200 lines), `apps/cafe/hooks/use-print-host-bridge.ts` (stays under 250), `apps/cafe/lib/print-host-slips.ts`, `apps/cafe/lib/print-agent.ts` (`printAgentSlipOf`, `PRINT_AGENT_SLIP_DEADLINE_MS`), `apps/cafe/lib/print-write-outcome.ts` (+ its test)
- Modify: `apps/cafe/components/pos/KOTReceipt.tsx`, `OrderReceipt.tsx`, `PrintSources.tsx`, `apps/cafe/components/print/PrintHostPrintSources.tsx` (the banner)
- Modify: `apps/cafe/hooks/use-host-routing.ts`, `use-print-routing.ts`, `use-print-host.ts`, `use-orders.ts`, `use-item-void.ts`, `use-order-requests.ts`, `use-settle-flow.ts`, `use-pos-tab.ts`, `use-self-order-auto-print.ts`, `use-pos-pulse.ts` (the call sites)
- Modify (deliberate pin changes): `lib/print-host-paths.test.ts` PIN (D), `lib/printer/print-gating-paths.test.ts` (the drain pin's needles), `lib/print-wake.test.ts` (the `usePrintHostWake(` inventory, and its wiring pin), `lib/settle-flow-paths.test.ts` P2, `lib/print-order-jobs.test.ts` (the 1B C1 pin's premise); plus `lib/print-agent.test.ts` (three tests) and `apps/cafe/package.json`

**Interfaces produced:** `usePrintAgent({ enabled, isHost, deviceId, tabId, busy, queueSlip })`; bridge `queueSlip(slip, done?)`; `HostKotSlip.banner?` / `HostReceiptSlip.banner?`; `KOTReceipt`/`OrderReceipt`/`PrintSources` `banner?: string`; `routePrint(buildJob, runLocal, ref?)`; `useSettleOrder({ printsBill? })`, `useSettleFlow(handlers, { printsBill? })`; `EnqueuePrintJobInput.headers?`.

**Who is an agent.** A device with an identity routes every print (`shouldRoute = agentDeviceId !== "" || shouldRoutePrint(...)`), so no slip is printed outside the queue; only a device with no identity keeps today's local fast path (pinned order kept). The agent runs in `PrintHostDrain` under the drain lock, asked for only while the device can print: the host for the whole cafe, and with no host every device for its own line (§6.6). An unknown lane waits for the pulse.

**The call sites.** Each printing order mutation has exactly one caller, and that caller prints its slips, so those hooks always send R1's headers (the INVENTORY pin guards it); the settle sends the bill header only for the POS (`printsBill`). A wrapper hands the seam the job the order's answer named (`printJobRefOf`): it is followed with no request. A missing ref is enqueued as the agent under today's key (`Idempotency-Key` for a keyless repeat), and a queued answer kicks the local agent.

**The bridge.** Every pinned code shape stays (queueSlip, settle, abandon, onPrintError, the deps arrays); a ref-held FIFO (`print-host-outcomes.ts`) tells each slip's caller its result once, in print order. A slip the watchdog gave up on settles late, so the agent bounds its own wait at `PRINT_AGENT_SLIP_DEADLINE_MS` (140 s) and acks it "maybe".

**M-c, ruled:** with no host, agents never lease on the broadcast `print-job` nudge (no fan-out of empty leases); a job sent home reaches its device through the pulse's `printJobsForMe` within 20 s, or a print-status aimed at it.

The old claim drain (`use-print-host-drain.ts`) and GET wake hook (`use-print-host-wake.ts`) stay in the codebase, uncalled, for one release; a tab from before Phase 1 still runs them itself.

- [ ] **Step 1: The failing tests first**

Create `apps/cafe/lib/print-agent-paths.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";

// Printing redesign Phase 1, Session 1C: the source pins of the agent's wiring. The rules themselves
// are unit-tested (print-agent.test.ts, print-write-outcome.test.ts); these pin that every call site
// reaches them, and that nothing prints a slip outside the queue on a device that has an identity.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CAFE = path.join(REPO_ROOT, "apps/cafe");
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const count = (text: string, needle: string): number => text.split(needle).length - 1;

function callSites(needle: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && readFileSync(full, "utf8").includes(needle)) {
        hits.push(path.relative(CAFE, full).split(path.sep).join("/"));
      }
    }
  };
  for (const root of ["app", "components", "hooks"]) walk(path.join(CAFE, root));
  return hits.sort();
}

// R1: an order request opts in only when its call site prints the slips it makes. Each of these hooks
// has exactly one caller, and that caller prints them; a new caller is a deliberate decision.
test("INVENTORY: each printing order mutation has exactly its one known caller, which prints the slip", () => {
  const known: Record<string, string> = {
    "useCreateOrder(": "hooks/use-pos-tab.ts",
    "useAddOrderItems(": "hooks/use-pos-tab.ts",
    "useItemVoid(": "app/(dashboard)/pos/page.tsx",
    "useMoveOrderTable(": "components/orders/MoveTableDialog.tsx",
    "useAcceptOrderRequest(": "app/(dashboard)/requests/page.tsx",
  };
  for (const [hook, caller] of Object.entries(known)) {
    const sites = callSites(hook).filter((f) => !f.startsWith("hooks/use-orders.ts") && !f.startsWith("hooks/use-item-void.ts") && !f.startsWith("hooks/use-order-requests.ts"));
    assert.deepEqual(sites, [caller], `${hook} must be called only from ${caller}; found ${sites.join(", ")}`);
  }
  assert.ok(src("apps/cafe/hooks/use-pos-tab.ts").includes("}, { printsBill: true });"), "the POS settle prints its bill, so it asks the server to make it");
  assert.ok(!src("apps/cafe/components/orders/OrderDetailSheet.tsx").includes("printsBill"), "the Orders sheet's settle never printed, so it never asks");
});

test("PIN (R1): the order requests send the opt-in through apiSend's headers; only Pay Now and the POS settle add the bill", () => {
  const orders = src("apps/cafe/hooks/use-orders.ts");
  assert.ok(orders.includes('apiSend<Order>("/api/orders", "POST", data, printAgentRequestOptions(data.status === "Completed"))'), "create: the KOT, and Pay Now's bill");
  assert.ok(orders.includes('apiSend<Order>(`/api/orders/${id}/items`, "POST", data, printAgentRequestOptions())'), "a round: its KOT");
  assert.ok(orders.includes('apiSend<Order>(`/api/orders/${id}/settle`, "POST", data, options.printsBill === true ? printAgentRequestOptions(true) : {})'), "a settle: the bill only when asked");
  assert.ok(orders.includes('apiSend<Order>(`/api/orders/${id}/table`, "POST", { tableNo }, printAgentRequestOptions())'), "a move: its slip");
  assert.ok(src("apps/cafe/hooks/use-item-void.ts").includes('"POST", data, printAgentRequestOptions())'), "a void: its slip");
  assert.ok(src("apps/cafe/hooks/use-order-requests.ts").includes('`/api/order-requests/${id}/accept`, "POST", undefined, printAgentRequestOptions())'), "an accept: its KOT");
  assert.ok(src("apps/cafe/hooks/use-order-requests.ts").includes("order: { ...result.order, printJobs: result.printJobs }"), "the accept's job rides on the order the KOT print reads");
  assert.ok(src("apps/cafe/hooks/use-self-order-auto-print.ts").includes('`/api/order-requests/${requestId}/kot-claim`, "POST", undefined, printAgentRequestOptions())'), "a self-order claim: its KOT (R4)");
  const api = src("packages/shared/src/api-client.ts");
  assert.ok(api.includes('headers: { ...options.headers, "Content-Type": "application/json" },'), "apiSend keeps its JSON content type whatever a caller adds");
  assert.ok(api.includes("options: { headers?: Record<string, string> } = {},"), "optional and last: every existing caller (cafe and Hub) is unchanged");
});

test("PIN: every print wrapper follows the job the order's answer made, and a device with an identity never prints locally", () => {
  const wrappers = src("apps/cafe/hooks/use-print-routing.ts");
  for (const kind of ["kot", "void", "bill"]) {
    assert.ok(wrappers.includes(`printJobRefOf(order, "${kind}"))`), `the ${kind} wrapper hands its ref to the seam`);
  }
  const seam = src("apps/cafe/hooks/use-host-routing.ts");
  assert.ok(seam.includes('const shouldRoute = agentDeviceId !== "" || shouldRoutePrint(routing, printHostSeen);'), "an agent always routes: the queue prints, never this page");
  assert.ok(seam.includes("if (ref) {\n        followPrintJob(ref, buildJob);\n        return;\n      }"), "a named job is followed, with no request");
  assert.ok(seam.indexOf("if (!shouldRoute) {") < seam.indexOf("if (ref) {"), "the local fast path stays first (a device with no identity)");
  assert.ok(seam.includes('agentDeviceId === "" ? job : { ...job, headers: printAgentEnqueueHeaders(agentDeviceId) }'), "a missing ref is enqueued as the agent, under today's key");
  assert.ok(seam.includes('if (agentDeviceId !== "" && result.outcome === "queued") kickPrintAgent();'), "an enqueued job is leased now, not on a poll");
  assert.ok(seam.includes('if (ref.status === "queued") kickPrintAgent();'), "a ref to a resolved job is followed, never leased (M-d)");
  assert.ok(seam.includes('const ref = printJobRefOf(order, "moved");'), "the moved slip is followed by ref: its key has the server's movedAt");
  assert.ok(src("apps/cafe/hooks/use-print-host.ts").includes('({ headers, ...input }: EnqueuePrintJobInput) => apiSend<PrintJobEnqueueResult>("/api/print-jobs", "POST", input, { headers })'), "headers are never part of the enqueue body");
});

test("PIN: the provider hands the drain its surfaces, and the bridge's own KOT print no longer reaches a lane", () => {
  const provider = src("apps/cafe/components/layout/PrintHostProvider.tsx");
  assert.ok(provider.includes("surfacesMounted={surfacesMounted}"), "with no host, every device is an agent once its surfaces exist");
  assert.ok(!provider.includes("onKotRound="), "the host lane prints only print jobs");
  const bridge = src("apps/cafe/hooks/use-print-host-bridge.ts");
  assert.equal(count(bridge, "outcomesRef.current.track("), 2, "every slip and the test slip join the outcome line");
  assert.equal(count(bridge, "outcomesRef.current.finish("), 1, "the one settle finishes the slip in front");
  assert.ok(bridge.indexOf("outcomesRef.current.track(done ?? null);") < bridge.indexOf("if (occupiedRef.current) {\n      pendingRef.current.push(slip);"), "a slip is tracked before it waits or prints");
});

test("PIN: the agent leases on events aimed at it, names itself on the pulse only with no host, and only the host polls", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.ok(agent.includes('if (job?.status === "queued" && job.target === deviceId) agent.kick();'), "a print-status frame for another device never leases (R7)");
  assert.ok(agent.includes('} else if (kind === "print-job" && isHost) {'), "the broadcast nudge wakes only the host (no fan-out, M-c)");
  assert.ok(agent.includes("if (agent === null || !enabled || isHost) return;\n    setPulsePrintDevice(deviceId);"), "with no host, the agent names itself on the existing pulse");
  assert.ok(src("apps/cafe/hooks/use-pos-pulse.ts").includes("apiGet<PosPulseData>(`${POS_PULSE_ENDPOINT}${pulsePrintDeviceQuery()}`)"), "the pulse carries it: no new request");
  assert.ok(agent.includes("printerReady: canPrintNow,"), "the agent's gate is the device's own can-print verdict");
  assert.ok(agent.includes("PRINT_AGENT_SLIP_DEADLINE_MS"), "its wait on one slip is bounded");
});

test("PIN (spec §7.7): both receipts print the banner first, and every surface forwards it", () => {
  for (const file of ["apps/cafe/components/pos/KOTReceipt.tsx", "apps/cafe/components/pos/OrderReceipt.tsx"]) {
    const s = src(file);
    assert.ok(s.includes("{order && (\n        <>\n          <PrintBanner text={banner} />"), `${file}: the banner is the first thing on the slip`);
  }
  const sources = src("apps/cafe/components/pos/PrintSources.tsx");
  assert.ok(sources.includes("banner={banner} ref={receiptRef}") && sources.includes("banner={banner}\n        ref={kotRef}"), "PrintSources forwards it to both");
  assert.equal(count(src("apps/cafe/components/print/PrintHostPrintSources.tsx"), "banner={slip.banner}"), 2, "the host surfaces pass the slip's banner");
  const banner = src("apps/cafe/components/pos/PrintBanner.tsx");
  assert.ok(banner.includes("if (!text) return null;"), "no banner on a first print");
  assert.ok(banner.includes('printColorAdjust: "exact"'), "a browser print keeps the black");
});
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
import { PRINT_WAKE_FAST_MS, PRINT_WAKE_SLOW_MS, PRINT_WAKE_SOCKET_MS } from "@pos/shared/print-job";
import { PRINT_AGENT_REFUSED_RECHECK_MS, type LeasedPrintJob, type PrintAckData, type PrintLeaseData } from "@pos/shared/print-agent-wire";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import {
  createPrintAgent,
  failedAckBody,
  type PendingPrintAck,
  type PrintAgentAckBody,
  type PrintAgentResult,
```

Replace it with:

```ts
import { PRINT_WAKE_FAST_MS, PRINT_WAKE_SLOW_MS, PRINT_WAKE_SOCKET_MS } from "@pos/shared/print-job";
import { PRINT_AGENT_REFUSED_RECHECK_MS, type LeasedPrintJob, type PrintAckData, type PrintLeaseData } from "@pos/shared/print-agent-wire";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import { printAgentEnqueueHeaders, printAgentHeaders, printJobRefOf } from "@/lib/print-agent-calls";
import { createHostSlipOutcomes } from "@/lib/print-host-outcomes";
import {
  createPrintAgent,
  failedAckBody,
  printAgentSlipOf,
  type PendingPrintAck,
  type PrintAgentAckBody,
  type PrintAgentResult,
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
  wake.stop();
});

```

Replace it with:

```ts
  wake.stop();
});

test("the slip for a leased job carries its labels as the banner; an end-of-day summary and a first print carry none", () => {
  const kot = { ...job("k1"), kind: "kot" as const, labels: ["REPRINT" as const], payload: { kind: "kot", round: 1, snapshot: { _id: "o1", orderId: "ORD-1", createdAt: new Date(T0).toISOString(), items: [] } } as unknown as LeasedPrintJob["payload"] };
  const slip = printAgentSlipOf(kot, "2026-10-03");
  assert.equal(slip.surface === "eod" ? "eod" : slip.banner, "REPRINT", "a retried KOT prints REPRINT on top");
  assert.equal("banner" in printAgentSlipOf({ ...kot, labels: [] }, "2026-10-03"), false, "a first print has no banner at all");
  const eod = printAgentSlipOf({ ...job("e1"), kind: "eod", labels: ["REPRINT"] }, "2026-10-03");
  assert.equal(eod.surface, "eod");
  assert.equal("banner" in eod, false, "the end-of-day summary takes no banner");
});

test("the call sites' helpers: the opt-in headers, a ref by kind, and nothing for a device with no identity", () => {
  assert.deepEqual(printAgentHeaders(""), {}, "no identity: the server prints nothing for it, the page prints as before");
  assert.deepEqual(printAgentHeaders("dev-a", true), { "x-pos-print-agent": "1", "x-pos-device-id": "dev-a", "x-pos-print-bill": "1" });
  const order = { printJobs: [{ id: "j1", kind: "kot", targetDeviceId: "dev-a", label: "KOT", status: "queued" }, { id: "j2", kind: "bill", targetDeviceId: "dev-a", label: "Bill", status: "printed" }] };
  assert.equal(printJobRefOf(order, "bill")?.id, "j2", "found by kind");
  assert.equal(printJobRefOf(order, "void"), null, "a slip the answer did not name: the call site enqueues it");
  assert.equal(printJobRefOf({ printJobs: [{ id: 1 }] }, "kot"), null, "a malformed ref is ignored");
  assert.equal(printJobRefOf(null, "kot"), null);
  assert.ok(/^[A-Za-z0-9-]{8,64}$/.test(printAgentEnqueueHeaders("dev-a")["idempotency-key"] ?? ""), "an enqueue carries a usable Idempotency-Key");
});

test("the bridge's outcome line: each slip's caller hears once, in print order; the test slip and untracked slips keep their place", () => {
  const outcomes = createHostSlipOutcomes();
  const heard: string[] = [];
  outcomes.track((r) => heard.push(`a:${r.ok}`));
  outcomes.track(null);
  outcomes.track((r) => heard.push(`c:${r.ok}`));
  outcomes.finish({ ok: true });
  outcomes.finish({ ok: true });
  outcomes.finish({ ok: false, error: new Error("x") });
  outcomes.finish({ ok: true });
  assert.deepEqual(heard, ["a:true", "c:false"], "in order, once each, the test slip in between untold");
});

```

In `apps/cafe/lib/print-host-paths.test.ts`, find:

```ts

// ── D. PrintHostDrain.tsx ──────────────────────────────────────────────────

test("PIN (D): PrintHostDrain.tsx calls usePrintJobFeed() (the narrow feed) and does NOT contain usePosPulseContext (the pos-pulse-paths.test.ts inventory pin stays at five); calls usePrintHostDrainLock(/usePrintHostWakeLock(/usePrintHostBeat(/useSelfOrderAutoPrint(/usePrintHostDrain(; passes hostLane containing PRINT_HOST_MAX_AGE_MS; both claiming lanes get enabled: drains where const drains = enabled && holdsLock; returns null; calls cafeDateString() inside onClaimed", () => {
  const src = readSrc(PRINT_HOST_DRAIN);

  assert.match(src, /usePrintJobFeed\(\)/, "must call usePrintJobFeed()");
  assert.ok(!src.includes("usePosPulseContext"), "PrintHostDrain.tsx must never reference usePosPulseContext — the pos-pulse-paths.test.ts inventory of five deliberate consumers must stay unchanged");

  for (const call of [
    "usePrintHostDrainLock(",
    "usePrintHostWakeLock(",
    "usePrintHostBeat(",
    "useSelfOrderAutoPrint(",
    "usePrintHostDrain(",
  ]) {
    assert.ok(src.includes(call), `PrintHostDrain.tsx must call ${call}`);
  }

  assert.match(src, /const drains = enabled && holdsLock;/, "must declare const drains = enabled && holdsLock;");
  const enabledDrainsCount = countOccurrences(src, "enabled: drains");
  assert.equal(enabledDrainsCount, 2, `expected enabled: drains exactly twice (both claiming lanes), found ${enabledDrainsCount}`);

  assert.ok(src.includes("PRINT_HOST_MAX_AGE_MS"), "hostLane must reference PRINT_HOST_MAX_AGE_MS");
  assert.match(src, /return null;/, "PrintHostDrain must return null — a null-rendering child");
  assert.match(src, /cafeDateString\(\)/, "must call cafeDateString() inside onClaimed");
});

// ── E. use-print-host-drain.ts ─────────────────────────────────────────────
```

Replace it with:

```ts

// ── D. PrintHostDrain.tsx ──────────────────────────────────────────────────

// Deliberately changed in printing Phase 1 Session 1C: the claim drain and the GET wake poll are
// replaced by the print agent (hooks/use-print-agent.ts), which leases, prints through this provider's
// bridge, and acks. The old hooks stay in the codebase for one release, uncalled here.
test("PIN (D): PrintHostDrain.tsx runs the print agent (the host for the cafe; with no host, every device for its own line) under the drain lock, keeps the host-only lanes on `enabled`, never reads usePosPulseContext, and returns null", () => {
  const src = readSrc(PRINT_HOST_DRAIN);

  assert.ok(!src.includes("usePosPulseContext"), "PrintHostDrain.tsx must never reference usePosPulseContext — the pos-pulse-paths.test.ts inventory of five deliberate consumers must stay unchanged");
  for (const call of ["usePrintHostDrainLock(", "usePrintHostWakeLock(", "usePrintHostBeat(", "useSelfOrderAutoPrint(", "usePrintAgent("]) {
    assert.ok(src.includes(call), `PrintHostDrain.tsx must call ${call}`);
  }
  assert.ok(!src.includes("usePrintHostDrain(") && !src.includes("usePrintHostWake("), "the claim drain and the GET wake poll are no longer run here (Session 1C)");
  assert.match(
    src,
    /const isAgent = enabled \|\| \(surfacesMounted && deviceId !== "" && routing !== "host" && routing !== "unknown"\);/,
    "the agent: the host, or with no host every device whose surfaces exist; an unknown lane waits",
  );
  assert.match(src, /const drains = isAgent && holdsLock;/, "the agent drains only under the lock");
  assert.match(src, /const hostDrains = enabled && holdsLock;/, "the host's self-order lane keeps the host gate");
  assert.match(src, /usePrintAgent\(\{ enabled: drains, isHost: enabled, deviceId, tabId, busy, queueSlip: onSlip \}\);/, "the agent prints through the provider's bridge");
  assert.match(src, /useSelfOrderAutoPrint\(\{ enabled: hostDrains, busy, queueKotRound, hostLane \}\);/, "the host lane hands a claimed KOT to the agent (job-aware lane)");
  assert.ok(src.includes("PRINT_HOST_MAX_AGE_MS"), "hostLane must reference PRINT_HOST_MAX_AGE_MS");
  assert.match(src, /return null;/, "PrintHostDrain must return null — a null-rendering child");
});

// ── E. use-print-host-drain.ts ─────────────────────────────────────────────
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
// auto-accept leaves kotPrintedAt unstamped. A server-made job for the host would therefore print a
// second, unlabelled KOT for every auto-accepted QR order. Ruling R4 moves to Session 1C, where the
// lane becomes job-aware; until then the auto-accept answers exactly as before Phase 1.
test("PIN: the staff accept creates only on a fresh accept; the public auto-accept creates no print job in 1B (its host lane prints the KOT itself)", () => {
  assert.match(src("apps/cafe/app/api/order-requests/[id]/accept/route.ts"), /intent && !result\.replayed\s*\? await createOrderPrintJobs\(\{/);
  assert.match(
    src("apps/cafe/hooks/use-print-host-bridge.ts"),
    /\(order: Order, round: number = order\.kotRounds\) => queueSlip\(kotRoundSlip\(order, round\)\)/,
    "the premise: the host lane prints a claimed self-order KOT locally, outside the job queue",
  );
  const auto = src("apps/cafe/lib/order-request-create.ts");
  assert.ok(!auto.includes("createOrderPrintJobs"), "the auto-accept makes no print job in 1B (final review C1)");
  const fn = auto.slice(auto.indexOf("export async function resolveAutoAcceptStatus("));
```

Replace it with:

```ts
// auto-accept leaves kotPrintedAt unstamped. A server-made job for the host would therefore print a
// second, unlabelled KOT for every auto-accepted QR order. Ruling R4 moves to Session 1C, where the
// lane becomes job-aware; until then the auto-accept answers exactly as before Phase 1.
test("PIN: the staff accept creates only on a fresh accept; the public auto-accept creates no print job (the self-order lane's claim does, Session 1C)", () => {
  assert.match(src("apps/cafe/app/api/order-requests/[id]/accept/route.ts"), /intent && !result\.replayed\s*\? await createOrderPrintJobs\(\{/);
  // Session 1C (R4, job-aware lane): the host lane hands a claimed KOT to the agent, never to the bridge.
  assert.match(
    src("apps/cafe/components/print/PrintHostDrain.tsx"),
    /routePrint\(\(\) => kotPrintJob\(order, round\), \(\) => undefined, printJobRefOf\(order, "kot"\)\)/,
    "the host lane prints a claimed KOT only as a print job",
  );
  assert.ok(!src("apps/cafe/components/layout/PrintHostProvider.tsx").includes("onKotRound="), "the bridge's own KOT print is no longer handed to the lane");
  const auto = src("apps/cafe/lib/order-request-create.ts");
  assert.ok(!auto.includes("createOrderPrintJobs"), "the auto-accept makes no print job in 1B (final review C1)");
  const fn = auto.slice(auto.indexOf("export async function resolveAutoAcceptStatus("));
```

In `apps/cafe/lib/print-wake.test.ts`, find:

```ts
  for (const root of roots) walk(root);
  hits.sort();

  const expected = ["components/print/PrintHostDrain.tsx", "hooks/use-print-host-wake.ts"].sort();
  assert.deepEqual(hits, expected, `usePrintHostWake( call sites must be exactly these two files; found: ${hits.join(", ")}`);
});

test('PIN: PrintHostDrain.tsx calls usePrintHostWake({ drains, feed }) — the wiring pin that proves reachability, not just that the hook compiles — and "enabled: drains" still occurs exactly twice there (re-asserted here; owned by print-host-paths.test.ts, not touched)', () => {
  const src = readSrc(PRINT_HOST_DRAIN);
  assert.ok(src.includes("usePrintHostWake({ drains, feed });"), "PrintHostDrain.tsx must call usePrintHostWake({ drains, feed });");

  const enabledDrainsCount = src.split("enabled: drains").length - 1;
  assert.equal(enabledDrainsCount, 2, `expected "enabled: drains" exactly twice (both claiming lanes) in PrintHostDrain.tsx, found ${enabledDrainsCount}`);
});

// ── 6. Constants single-homed in print-job.ts ───────────────────────────────
```

Replace it with:

```ts
  for (const root of roots) walk(root);
  hits.sort();

  // Session 1C: the host agent's wake POST (hooks/use-print-agent.ts) replaced the GET poll; the hook stays
  // one release for its own tests, with no call site.
  const expected = ["hooks/use-print-host-wake.ts"];
  assert.deepEqual(hits, expected, `usePrintHostWake( must have no call site any more; found: ${hits.join(", ")}`);
});

test("PIN (Session 1C): only the host agent polls the wake, through the POST beside the unchanged GET, and PrintHostDrain arms it only for the host", () => {
  const drain = readSrc(PRINT_HOST_DRAIN);
  assert.ok(drain.includes("usePrintAgent({ enabled: drains, isHost: enabled,"), "the agent learns whether it is the host");
  const agent = stripComments(readSrc("apps/cafe/hooks/use-print-agent.ts"));
  assert.ok(agent.includes("if (agent === null || !enabled || !isHost) return;"), "the wake poll is armed for the host only (R6)");
  assert.ok(agent.includes('apiSend<PrintWakeBeatData>(WAKE_URL, "POST", wakeBody(deviceId))'), "the agent's wake is the POST heartbeat");
  assert.ok(agent.includes("bumpPrintWakeBudget("), "under the device's one daily cap");
  assert.ok(!agent.includes("apiGet"), "the agent never polls the read-only GET");
});

// ── 6. Constants single-homed in print-job.ts ───────────────────────────────
```

In `apps/cafe/lib/print-write-outcome.test.ts`, find:

```ts
import assert from "node:assert/strict";

import { DESKTOP_PRINT_EMPTY_MESSAGE, DESKTOP_PRINT_NO_REPLY_MESSAGE, DESKTOP_PRINT_TOO_LARGE_MESSAGE } from "@/lib/desktop-shell";
import { PRINT_HOST_EMPTY_SLIP_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { LANE_PRINT_FAILED_MESSAGE, NO_PRINTER_MESSAGE, laneFailureMessage } from "@/lib/printer/lane-print";
import { nativeError } from "@/lib/printer/native-bridge";
import { NATIVE_ERROR_CODES, type NativeErrorCode } from "@/lib/printer/native-bridge-protocol";
```

Replace it with:

```ts
import assert from "node:assert/strict";

import { DESKTOP_PRINT_EMPTY_MESSAGE, DESKTOP_PRINT_NO_REPLY_MESSAGE, DESKTOP_PRINT_TOO_LARGE_MESSAGE } from "@/lib/desktop-shell";
import { PRINT_HOST_EMPTY_SLIP_MESSAGE, PRINT_HOST_EOD_TIMEOUT_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { LANE_PRINT_FAILED_MESSAGE, NO_PRINTER_MESSAGE, laneFailureMessage } from "@/lib/printer/lane-print";
import { nativeError } from "@/lib/printer/native-bridge";
import { NATIVE_ERROR_CODES, type NativeErrorCode } from "@/lib/printer/native-bridge-protocol";
```

In `apps/cafe/lib/print-write-outcome.test.ts`, find:

```ts
}

test("refusals made before any byte left are sent:'no' (no printer, not connected, another tab, could not draw)", () => {
  for (const message of [NO_PRINTER_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_ELSEWHERE_MESSAGE, RASTER_FAILED_MESSAGE]) {
    assert.equal(outcome(message), "no", message);
  }
});
```

Replace it with:

```ts
}

test("refusals made before any byte left are sent:'no' (no printer, not connected, another tab, could not draw)", () => {
  for (const message of [NO_PRINTER_MESSAGE, PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_ELSEWHERE_MESSAGE, RASTER_FAILED_MESSAGE, PRINT_HOST_EOD_TIMEOUT_MESSAGE]) {
    assert.equal(outcome(message), "no", message);
  }
});
```

In `apps/cafe/lib/printer/print-gating-paths.test.ts`, find:

```ts

const DELEGATE = "if (!shell) return laneSlipPrintOptions(options);";
const BEAT_CALL = "beat({ deviceId, printer: beatPrinterReport() });";
const LOCK_CALL = "const holdsLock = usePrintHostDrainLock(enabled && canPrint);";
// s63 INT: the sentence comes from printBlockedMessage() so an app with NO printer says "No printer is set up…"
// instead of "reconnect it" (the three cases are unit-tested in print-lane.test.ts).
const GUARD = 'if (!canPrintNow()) {\n        toast.error(printBlockedMessage());\n        return;\n      }';
```

Replace it with:

```ts

const DELEGATE = "if (!shell) return laneSlipPrintOptions(options);";
const BEAT_CALL = "beat({ deviceId, printer: beatPrinterReport() });";
// Session 1C: the agent (the host, or with no host every device) asks for the lock; still only while it can print.
const LOCK_CALL = "const holdsLock = usePrintHostDrainLock(isAgent && canPrint);";
// s63 INT: the sentence comes from printBlockedMessage() so an app with NO printer says "No printer is set up…"
// instead of "reconnect it" (the three cases are unit-tested in print-lane.test.ts).
const GUARD = 'if (!canPrintNow()) {\n        toast.error(printBlockedMessage());\n        return;\n      }';
```

In `apps/cafe/lib/printer/print-gating-paths.test.ts`, find:

```ts
    file: "components/print/PrintHostDrain.tsx",
    pin: (s) => {
      const p: string[] = [];
      check(p, ordered(s, ["const canPrint = useCanPrintNow();", LOCK_CALL, "const drains = enabled && holdsLock;"]), "canPrint -> gated lock -> drains");
      check(p, count(s, "usePrintHostDrainLock(") === 1 && !s.includes("usePrintHostDrainLock(enabled)"), "no ungated lock call");
      check(p, s.includes("usePrintHostWakeLock(enabled);") && s.includes("usePrintHostBeat({ enabled, deviceId, onDemoted });"), "wake lock and routine beat keep `enabled`");
      check(p, s.includes("usePrintHostPrinterBeat({ enabled, deviceId, onDemoted });"), "printer beat is wired with `enabled`");
```

Replace it with:

```ts
    file: "components/print/PrintHostDrain.tsx",
    pin: (s) => {
      const p: string[] = [];
      check(p, ordered(s, ["const canPrint = useCanPrintNow();", LOCK_CALL, "const drains = isAgent && holdsLock;"]), "canPrint -> gated lock -> drains");
      check(p, count(s, "usePrintHostDrainLock(") === 1 && !s.includes("usePrintHostDrainLock(enabled)"), "no ungated lock call");
      check(p, s.includes("usePrintHostWakeLock(enabled);") && s.includes("usePrintHostBeat({ enabled, deviceId, onDemoted });"), "wake lock and routine beat keep `enabled`");
      check(p, s.includes("usePrintHostPrinterBeat({ enabled, deviceId, onDemoted });"), "printer beat is wired with `enabled`");
```

In `apps/cafe/lib/settle-flow-paths.test.ts`, find:

```ts
  assert.equal(count(src, "createSettleFlow("), 1, "one controller per hook");
  assert.ok(src.includes("const [flow] = useState(() =>"), "created once per mounted hook, never per render");
  // send = the settle mutation's mutateAsync, always the latest commit's.
  assert.ok(src.includes("const settleOrder = useSettleOrder();"));
  assert.ok(src.includes("sendRef.current = settleOrder.mutateAsync;"));
  assert.ok(src.includes("send: (id, data) => sendRef.current({ id, data }),"));
  assert.equal(count(src, "sendRef.current("), 1, "exactly one POST site");
```

Replace it with:

```ts
  assert.equal(count(src, "createSettleFlow("), 1, "one controller per hook");
  assert.ok(src.includes("const [flow] = useState(() =>"), "created once per mounted hook, never per render");
  // send = the settle mutation's mutateAsync, always the latest commit's.
  // Session 1C (R1): the hook passes on whether its caller prints the bill; still one settle mutation.
  assert.ok(src.includes("const settleOrder = useSettleOrder({ printsBill: options.printsBill === true });"), "one settle mutation, told whether the bill prints");
  assert.ok(src.includes("sendRef.current = settleOrder.mutateAsync;"));
  assert.ok(src.includes("send: (id, data) => sendRef.current({ id, data }),"));
  assert.equal(count(src, "sendRef.current("), 1, "exactly one POST site");
```

In `apps/cafe/package.json`, find:

```json
    "lib/print-repair.test.ts",
    "lib/print-write-outcome.test.ts",
    "lib/print-agent.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
    "lib/pos-install-paths.test.ts",
```

Replace it with:

```json
    "lib/print-repair.test.ts",
    "lib/print-write-outcome.test.ts",
    "lib/print-agent.test.ts",
    "lib/print-agent-paths.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
    "lib/pos-install-paths.test.ts",
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent-paths.test.ts lib/print-agent.test.ts lib/print-host-paths.test.ts lib/printer/print-gating-paths.test.ts lib/print-wake.test.ts lib/settle-flow-paths.test.ts lib/print-order-jobs.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|Cannot find module|does not provide"`
Expected: `# Error: Cannot find module '@/lib/print-agent-calls'`; `# tests 91`; `# pass 77`; `# fail 14`

- [ ] **Step 3: The code**

In `apps/cafe/components/layout/PrintHostProvider.tsx`, find:

```tsx
  const reportSurfacesMounted = useCallback((mounted: boolean) => setSurfacesMounted(mounted), []);

  const bridge = usePrintHostBridge({ surfacesMounted });
  const { current, busy, kotRef, receiptRef, eodRef, setEodReady, queueSlip, queueKotRound, queueTestSlip } = bridge;

  // The band's manual print of a stale row lives HERE, not in the band: the
  // band section unmounts the moment its last row leaves the feed, and a
```

Replace it with:

```tsx
  const reportSurfacesMounted = useCallback((mounted: boolean) => setSurfacesMounted(mounted), []);

  const bridge = usePrintHostBridge({ surfacesMounted });
  const { current, busy, kotRef, receiptRef, eodRef, setEodReady, queueSlip, queueTestSlip } = bridge;

  // The band's manual print of a stale row lives HERE, not in the band: the
  // band section unmounts the moment its last row leaves the feed, and a
```

In `apps/cafe/components/layout/PrintHostProvider.tsx`, find:

```tsx
        busy={busy}
        claimLockRef={claimLockRef}
        onSlip={queueSlip}
        onKotRound={queueKotRound}
        onDemoted={demote}
      />
    </PrintHostContext.Provider>
```

Replace it with:

```tsx
        busy={busy}
        claimLockRef={claimLockRef}
        onSlip={queueSlip}
        surfacesMounted={surfacesMounted}
        onDemoted={demote}
      />
    </PrintHostContext.Provider>
```

In `apps/cafe/components/pos/KOTReceipt.tsx`, find:

```tsx
  PRINT_LOGO_CLASS,
} from "@/lib/print";
import { productImageUrl } from "@/lib/images";
import type { Order, OrderItem, Settings } from "@/types";

// A kitchen ticket never needs a large logo — pinned to next/image's intrinsic
```

Replace it with:

```tsx
  PRINT_LOGO_CLASS,
} from "@/lib/print";
import { productImageUrl } from "@/lib/images";
import { PrintBanner } from "@/components/pos/PrintBanner";
import type { Order, OrderItem, Settings } from "@/types";

// A kitchen ticket never needs a large logo — pinned to next/image's intrinsic
```

In `apps/cafe/components/pos/KOTReceipt.tsx`, find:

```tsx
  movedFrom?: string;
  movedBy?: string;
  movedAt?: string | Date;
  ref?: Ref<HTMLDivElement>;
}

```

Replace it with:

```tsx
  movedFrom?: string;
  movedBy?: string;
  movedAt?: string | Date;
  // Session 1C (spec §7.7): the print job's labels as one inverted banner on top ("REPRINT"). Absent on
  // every first print, so every existing call site prints exactly as before.
  banner?: string;
  ref?: Ref<HTMLDivElement>;
}

```

In `apps/cafe/components/pos/KOTReceipt.tsx`, find:

```tsx
  movedFrom,
  movedBy,
  movedAt,
  ref,
}: KOTReceiptProps) {
  const cfg = printConfigOf(settings).kot;
```

Replace it with:

```tsx
  movedFrom,
  movedBy,
  movedAt,
  banner,
  ref,
}: KOTReceiptProps) {
  const cfg = printConfigOf(settings).kot;
```

In `apps/cafe/components/pos/KOTReceipt.tsx`, find:

```tsx
    >
      {order && (
        <>
          {cfg.showLogo && logoUrl && (
            <div className="text-center">
              <Image
```

Replace it with:

```tsx
    >
      {order && (
        <>
          <PrintBanner text={banner} />
          {cfg.showLogo && logoUrl && (
            <div className="text-center">
              <Image
```

In `apps/cafe/components/pos/OrderReceipt.tsx`, find:

```tsx
import { inr } from "@/lib/utils";
import { receiptGst, type GstConfig } from "@/lib/receipt";
import { productImageUrl } from "@/lib/images";
import {
  printConfigOf,
  PAPER_WIDTH_CLASS,
```

Replace it with:

```tsx
import { inr } from "@/lib/utils";
import { receiptGst, type GstConfig } from "@/lib/receipt";
import { productImageUrl } from "@/lib/images";
import { PrintBanner } from "@/components/pos/PrintBanner";
import {
  printConfigOf,
  PAPER_WIDTH_CLASS,
```

In `apps/cafe/components/pos/OrderReceipt.tsx`, find:

```tsx
interface OrderReceiptProps {
  order: Order | null;
  settings?: Settings | null;
  ref?: Ref<HTMLDivElement>;
}

```

Replace it with:

```tsx
interface OrderReceiptProps {
  order: Order | null;
  settings?: Settings | null;
  // Session 1C (spec §7.7): "DUPLICATE" on a bill printed again. Absent on a first print.
  banner?: string;
  ref?: Ref<HTMLDivElement>;
}

```

In `apps/cafe/components/pos/OrderReceipt.tsx`, find:

```tsx
// (printConfigOf(settings).bill); a receipt must never print a fallback brand,
// so the name/footer lines are omitted entirely when Settings hasn't set them
// (CR1.5).
export function OrderReceipt({ order, settings, ref }: OrderReceiptProps) {
  const cfg = printConfigOf(settings).bill;
  const name = settings?.restaurantName?.trim();
  const tagline = settings?.tagline?.trim();
```

Replace it with:

```tsx
// (printConfigOf(settings).bill); a receipt must never print a fallback brand,
// so the name/footer lines are omitted entirely when Settings hasn't set them
// (CR1.5).
export function OrderReceipt({ order, settings, banner, ref }: OrderReceiptProps) {
  const cfg = printConfigOf(settings).bill;
  const name = settings?.restaurantName?.trim();
  const tagline = settings?.tagline?.trim();
```

In `apps/cafe/components/pos/OrderReceipt.tsx`, find:

```tsx
    >
      {order && (
        <>
          <div className="text-center">
            {cfg.showLogo && logoUrl && (
              <Image
```

Replace it with:

```tsx
    >
      {order && (
        <>
          <PrintBanner text={banner} />
          <div className="text-center">
            {cfg.showLogo && logoUrl && (
              <Image
```

Create `apps/cafe/components/pos/PrintBanner.tsx`:

```tsx
// Printing redesign, Phase 1 Session 1C (spec §7.7): the one large inverted banner at the top of a slip
// that repeats paper — "REPRINT", "DUPLICATE", or several joined ("BACKUP PRINTER · REPRINT"). The
// labels live on the print job, never in the payload, so the snapshot a slip prints from is unchanged.
// Thermal printers are monochrome: white on black survives rasterizing, the desktop app prints
// backgrounds, and print-color-adjust keeps a browser's own print dialog from dropping the black.
const BANNER_STYLE = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as const;

export function PrintBanner({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="mb-1.5 bg-black py-1 text-center text-[1.29em] font-bold tracking-widest text-white" style={BANNER_STYLE}>
      {text}
    </div>
  );
}
```

In `apps/cafe/components/pos/PrintSources.tsx`, find:

```tsx
  // Omitted for a KOT-only page (requests/page.tsx) — an accept never
  // collects money, so there is no customer receipt to render off-screen.
  receiptRef?: Ref<HTMLDivElement>;
}

// Off-screen print sources cloned by react-to-print — lifted out of
```

Replace it with:

```tsx
  // Omitted for a KOT-only page (requests/page.tsx) — an accept never
  // collects money, so there is no customer receipt to render off-screen.
  receiptRef?: Ref<HTMLDivElement>;
  // Session 1C (spec §7.7): the print job's banner, set only by the print agent's slips.
  banner?: string;
}

// Off-screen print sources cloned by react-to-print — lifted out of
```

In `apps/cafe/components/pos/PrintSources.tsx`, find:

```tsx
  movedBy,
  movedAt,
  receiptRef,
}: PrintSourcesProps) {
  // "test" is the provider-owned test slip (PH-5), which renders its own
  // component — it never reaches KOTReceipt. Narrowed explicitly rather than
```

Replace it with:

```tsx
  movedBy,
  movedAt,
  receiptRef,
  banner,
}: PrintSourcesProps) {
  // "test" is the provider-owned test slip (PH-5), which renders its own
  // component — it never reaches KOTReceipt. Narrowed explicitly rather than
```

In `apps/cafe/components/pos/PrintSources.tsx`, find:

```tsx
      aria-hidden
    >
      {receiptRef && (
        <OrderReceipt order={order} settings={settings} ref={receiptRef} />
      )}
      <KOTReceipt
        order={order}
```

Replace it with:

```tsx
      aria-hidden
    >
      {receiptRef && (
        <OrderReceipt order={order} settings={settings} banner={banner} ref={receiptRef} />
      )}
      <KOTReceipt
        order={order}
```

In `apps/cafe/components/pos/PrintSources.tsx`, find:

```tsx
        movedFrom={movedFrom}
        movedBy={movedBy}
        movedAt={movedAt}
        ref={kotRef}
      />
    </div>
```

Replace it with:

```tsx
        movedFrom={movedFrom}
        movedBy={movedBy}
        movedAt={movedAt}
        banner={banner}
        ref={kotRef}
      />
    </div>
```

Replace the whole of `apps/cafe/components/print/PrintHostDrain.tsx` with:

```tsx
"use client";

import { useCallback, useMemo, type MutableRefObject } from "react";

import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import { usePrintHostRouting } from "@/components/layout/PosPulseProvider";
import { useCanPrintNow } from "@/hooks/use-device-printer";
import { useHostRouting } from "@/hooks/use-host-routing";
import { useNativeHostBackground } from "@/hooks/use-native-host";
import { usePrintAgent } from "@/hooks/use-print-agent";
import { usePrintHostBeat } from "@/hooks/use-print-host-beat";
import { usePrintHostDrainLock } from "@/hooks/use-print-host-lock";
import { usePrintHostPrinterBeat } from "@/hooks/use-print-host-printer-beat";
import { usePrintHostWakeLock } from "@/hooks/use-print-host-wake-lock";
import { useSelfOrderAutoPrint } from "@/hooks/use-self-order-auto-print";
import { printJobRefOf } from "@/lib/print-agent-calls";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import type { HostPrintSlip } from "@/lib/print-host-slips";
import { kotPrintJob } from "@/lib/print-routing";
import type { Order } from "@/types";

interface PrintHostDrainProps {
  /** `isHostDevice && surfacesMounted` — this device is the print host, and its print surfaces exist. */
  enabled: boolean;
  /** The print surfaces exist. With no host, every device is the agent for its own line (spec §6.6). */
  surfacesMounted: boolean;
  deviceId: string;
  tabId: string;
  busy: boolean;
  claimLockRef: MutableRefObject<boolean>;
  onSlip: (slip: HostPrintSlip, done?: HostPrintDone) => void;
  onDemoted: () => void;
}

// Print-host plan §B5/§B6 (PH-5), Phase 1 Session 1C — the print agent and the host's own lanes in one
// null-rendering child of PrintHostProvider, so a payload-changing tick re-renders THIS and nothing on
// screen. The agent (hooks/use-print-agent.ts) leases this device's line, prints through the provider's
// bridge, then acks: the host leases for the whole cafe, and with no host every device leases its own
// slips (spec §6.6, R6). It replaces the claim drain and the host's GET wake poll, which stay in the
// codebase for one release, unused here (a tab from before Phase 1 still runs them itself). The
// heartbeat, the wake lock, the app's background service and the self-order lane stay host-only.
export function PrintHostDrain({ enabled, surfacesMounted, deviceId, tabId, busy, claimLockRef, onSlip, onDemoted }: PrintHostDrainProps) {
  // Written as host/unknown checks (D-11): an unknown lane waits for the pulse rather than guess.
  const routing = usePrintHostRouting();
  const isAgent = enabled || (surfacesMounted && deviceId !== "" && routing !== "host" && routing !== "unknown");
  // Exactly one draining window per device (MERGED-23), asked for only by a window that can print right
  // now: a printer that is off, or open in another tab, hands the lock on, so a line is never leased
  // for a printer that cannot print (the owner's rule after Session 1B).
  const canPrint = useCanPrintNow();
  const holdsLock = usePrintHostDrainLock(isAgent && canPrint);
  const drains = isAgent && holdsLock;
  const hostDrains = enabled && holdsLock;

  usePrintHostWakeLock(enabled);
  usePrintHostBeat({ enabled, deviceId, onDemoted });
  usePrintHostPrinterBeat({ enabled, deviceId, onDemoted });
  useNativeHostBackground(enabled);

  // The host's self-order lane hands a claimed KOT to the agent (ruling R4, job-aware lane): the claim
  // made it a print job, or, when the answer names none, the routed enqueue makes it one under the
  // same key. Never a local print outside the queue, so it can never print twice.
  const { routePrint } = useHostRouting();
  const queueKotRound = useCallback(
    (order: Order, round: number = order.kotRounds) =>
      routePrint(() => kotPrintJob(order, round), () => undefined, printJobRefOf(order, "kot")),
    [routePrint],
  );
  const hostLane = useMemo(() => ({ claimLock: claimLockRef, maxAgeMs: PRINT_HOST_MAX_AGE_MS }), [claimLockRef]);
  useSelfOrderAutoPrint({ enabled: hostDrains, busy, queueKotRound, hostLane });

  usePrintAgent({ enabled: drains, isHost: enabled, deviceId, tabId, busy, queueSlip: onSlip });

  return null;
}
```

In `apps/cafe/components/print/PrintHostPrintSources.tsx`, find:

```tsx

  if (slip.surface === "receipt") {
    return (
      <PrintSources order={slip.order} settings={settings.data} kotRef={kotRef} kotVariant="kot" receiptRef={receiptRef} />
    );
  }

```

Replace it with:

```tsx

  if (slip.surface === "receipt") {
    return (
      <PrintSources order={slip.order} settings={settings.data} kotRef={kotRef} kotVariant="kot" receiptRef={receiptRef} banner={slip.banner} />
    );
  }

```

In `apps/cafe/components/print/PrintHostPrintSources.tsx`, find:

```tsx
      movedFrom={slip.movedFrom}
      movedBy={slip.movedBy}
      movedAt={slip.movedAt}
    />
  );
}
```

Replace it with:

```tsx
      movedFrom={slip.movedFrom}
      movedBy={slip.movedBy}
      movedAt={slip.movedAt}
      banner={slip.banner}
    />
  );
}
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
import { toast } from "sonner";

import { printJobEnqueueAllowsLocalPrint, type PrintJobEnqueueResult } from "@pos/shared/print-job";
import { usePrintHostRouting, usePrintReadbackRecorder } from "@/components/layout/PosPulseProvider";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { useEnqueuePrintJob } from "@/hooks/use-print-host";
```

Replace it with:

```ts
import { toast } from "sonner";

import { printJobEnqueueAllowsLocalPrint, type PrintJobEnqueueResult } from "@pos/shared/print-job";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { usePrintHostRouting, usePrintReadbackRecorder } from "@/components/layout/PosPulseProvider";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { useEnqueuePrintJob } from "@/hooks/use-print-host";
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
  type PrintJobRequest,
} from "@/lib/print-routing";
import { readDevicePrefs, writeDevicePrefs } from "@/lib/pos-device-prefs";
import type { Order } from "@/types";

export interface PrintRoutingHost {
```

Replace it with:

```ts
  type PrintJobRequest,
} from "@/lib/print-routing";
import { readDevicePrefs, writeDevicePrefs } from "@/lib/pos-device-prefs";
import { readDeviceId } from "@/lib/pos-device-id";
import { kickPrintAgent } from "@/lib/print-agent";
import { printAgentEnqueueHeaders, printJobRefOf } from "@/lib/print-agent-calls";
import type { Order } from "@/types";

export interface PrintRoutingHost {
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
   *  duplicate slip (§B7) or re-read the enqueue outcome itself (D-11).
   *  **`runLocal` may run AFTER an await** on the routed lane (the enqueue round
   *  trip, up to api-client's 15s timeout), so it must NOT assume the screen
   *  still shows what the tap referred to — PH-6's sites guard for exactly that. */
  routePrint: (buildJob: () => PrintJobRequest, runLocal: () => void) => void;
  /** The moved slip's routed path — MoveTableDialog (PH-6) is the caller, and it
   *  keeps its own local `useReactToPrint` for the no-host case (§B5 carve-out).
   *  Resolves TRUE when the host owns the slip (caller must NOT print locally)
```

Replace it with:

```ts
   *  duplicate slip (§B7) or re-read the enqueue outcome itself (D-11).
   *  **`runLocal` may run AFTER an await** on the routed lane (the enqueue round
   *  trip, up to api-client's 15s timeout), so it must NOT assume the screen
   *  still shows what the tap referred to — PH-6's sites guard for exactly that.
   *  Session 1C: `ref` is the job the order's own answer made for this slip; it
   *  is followed, with no request. */
  routePrint: (buildJob: () => PrintJobRequest, runLocal: () => void, ref?: PrintJobRef | null) => void;
  /** The moved slip's routed path — MoveTableDialog (PH-6) is the caller, and it
   *  keeps its own local `useReactToPrint` for the no-host case (§B5 carve-out).
   *  Resolves TRUE when the host owns the slip (caller must NOT print locally)
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
  // `false` a first render sees is the hydration-safe default, and only matters
  // for a print fired in the very tick this mounts.
  const [printHostSeen, setPrintHostSeen] = useState(false);

  useEffect(() => {
    setPrintHostSeen(readDevicePrefs().printHostSeen);
  }, []);

  // The `printHostSeen` writer (PH-4 owns it — the flag had none). Only a
```

Replace it with:

```ts
  // `false` a first render sees is the hydration-safe default, and only matters
  // for a print fired in the very tick this mounts.
  const [printHostSeen, setPrintHostSeen] = useState(false);
  // Session 1C: a device with an identity is a print agent. None of its prints is local any more: the
  // server (or the routed enqueue) makes every slip a job, which an agent prints through lease → ack.
  const [agentDeviceId, setAgentDeviceId] = useState("");

  useEffect(() => {
    setPrintHostSeen(readDevicePrefs().printHostSeen);
    setAgentDeviceId(readDeviceId());
  }, []);

  // The `printHostSeen` writer (PH-4 owns it — the flag had none). Only a
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
    writeDevicePrefs({ ...prefs, printHostSeen: seen });
  }, [routing]);

  const shouldRoute = shouldRoutePrint(routing, printHostSeen);

  // mutateAsync (not mutate) because the CALLER needs the server's answer to
  // decide whether the local path still has to run. The hook-level onError owns
```

Replace it with:

```ts
    writeDevicePrefs({ ...prefs, printHostSeen: seen });
  }, [routing]);

  const shouldRoute = agentDeviceId !== "" || shouldRoutePrint(routing, printHostSeen);

  // mutateAsync (not mutate) because the CALLER needs the server's answer to
  // decide whether the local path still has to run. The hook-level onError owns
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
  const recordReadback = usePrintReadbackRecorder();
  const enqueue = useCallback(async (job: PrintJobRequest) => {
    try {
      const result = await enqueueAsync(job);
      // PH-8 (A-17, §B7): the id the SERVER answered with joins this device's
      // readback set — for "queued" the new row; for "already-resolved" the
      // EXISTING row the tap referred to, so the chip still resolves it to
```

Replace it with:

```ts
  const recordReadback = usePrintReadbackRecorder();
  const enqueue = useCallback(async (job: PrintJobRequest) => {
    try {
      const result = await enqueueAsync(agentDeviceId === "" ? job : { ...job, headers: printAgentEnqueueHeaders(agentDeviceId) });
      // PH-8 (A-17, §B7): the id the SERVER answered with joins this device's
      // readback set — for "queued" the new row; for "already-resolved" the
      // EXISTING row the tap referred to, so the chip still resolves it to
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
      if (result.outcome === "queued" || result.outcome === "already-resolved") {
        recordReadback(printReadbackRecordOf(result.id, job.payload));
      }
      // PH-5 (OPS-7): a job the HOST itself queued should drain on the next
      // microtask, not the next 20s tick — refetch the pulse so the drain's
      // feed sees it now. A handler-time pref read (never during render); a
```

Replace it with:

```ts
      if (result.outcome === "queued" || result.outcome === "already-resolved") {
        recordReadback(printReadbackRecordOf(result.id, job.payload));
      }
      // Session 1C: a queued job is this device's own line (no host), or this host's: lease it now.
      if (agentDeviceId !== "" && result.outcome === "queued") kickPrintAgent();
      // PH-5 (OPS-7): a job the HOST itself queued should drain on the next
      // microtask, not the next 20s tick — refetch the pulse so the drain's
      // feed sees it now. A handler-time pref read (never during render); a
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
    } catch {
      return null;
    }
  }, [enqueueAsync, qc, recordReadback]);

  // Routed prints SERIALIZE through this chain — `confirmPayment`'s pay-now
  // branch fires the KOT and the bill in the SAME tick, and two concurrent
```

Replace it with:

```ts
    } catch {
      return null;
    }
  }, [enqueueAsync, qc, recordReadback, agentDeviceId]);

  // Session 1C: the order's own answer already made this slip a job (spec §7.4): follow it for the
  // readback and, unless it is already resolved (M-d), wake the agent. No request at all.
  const followPrintJob = useCallback(
    (ref: PrintJobRef, buildJob: () => PrintJobRequest) => {
      try {
        recordReadback(printReadbackRecordOf(ref.id, buildJob().payload));
      } catch {
        // A builder throw changes nothing: the job exists and prints; only its chip is missing.
      }
      if (ref.status === "queued") kickPrintAgent();
    },
    [recordReadback],
  );

  // Routed prints SERIALIZE through this chain — `confirmPayment`'s pay-now
  // branch fires the KOT and the bill in the SAME tick, and two concurrent
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
  // `confirmPayment`'s catch, losing a receipt for an order the server had
  // already created.
  const routePrint = useCallback(
    (buildJob: () => PrintJobRequest, runLocal: () => void) => {
      // The no-host lane never touches the chain: it must stay SYNCHRONOUS so
      // both print flags land in ONE React batch, exactly as they did pre-PH-4
      // (§F byte-identical parity — that same-tick batching is the only reason
      // the bridge can sequence KOT before bill).
      if (!shouldRoute) {
        runLocal();
        return;
      }
      // Armed here, in the tap's own event, so the disable is on screen before
```

Replace it with:

```ts
  // `confirmPayment`'s catch, losing a receipt for an order the server had
  // already created.
  const routePrint = useCallback(
    (buildJob: () => PrintJobRequest, runLocal: () => void, ref?: PrintJobRef | null) => {
      // The no-host lane never touches the chain: it must stay SYNCHRONOUS so
      // both print flags land in ONE React batch, exactly as they did pre-PH-4
      // (§F byte-identical parity — that same-tick batching is the only reason
      // the bridge can sequence KOT before bill). Session 1C: only a device with
      // no identity still takes it; every agent routes.
      if (!shouldRoute) {
        runLocal();
        return;
      }
      // Session 1C: the server made this slip with the order, in kind order: follow its job.
      if (ref) {
        followPrintJob(ref, buildJob);
        return;
      }
      // Armed here, in the tap's own event, so the disable is on screen before
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
          // slip queued after it.
        });
    },
    [shouldRoute, enqueue],
  );

  const queueMovedSlip = useCallback(
    async (order: Order, meta: { from?: string; movedBy: string; movedAt: string }) => {
      if (!shouldRoute) return false;
      // Built INSIDE the try for the same reason routePrint does it: a deploy-
      // skew order whose snapshot this builder cannot read would otherwise
      // reject the promise the caller awaits — no enqueue, no local print, no
```

Replace it with:

```ts
          // slip queued after it.
        });
    },
    [shouldRoute, enqueue, followPrintJob],
  );

  const queueMovedSlip = useCallback(
    async (order: Order, meta: { from?: string; movedBy: string; movedAt: string }) => {
      if (!shouldRoute) return false;
      // Session 1C: the move's own answer made the slip a job (with the server's movedAt): follow it.
      const ref = printJobRefOf(order, "moved");
      if (ref) {
        followPrintJob(ref, () => movedPrintJob(order, meta, { reprint: false }));
        return true;
      }
      // Built INSIDE the try for the same reason routePrint does it: a deploy-
      // skew order whose snapshot this builder cannot read would otherwise
      // reject the promise the caller awaits — no enqueue, no local print, no
```

In `apps/cafe/hooks/use-host-routing.ts`, find:

```ts
      if (result.outcome === "too-large") toast.error(PRINT_JOB_TOO_LARGE_MESSAGE);
      return !printJobEnqueueAllowsLocalPrint(result.outcome);
    },
    [shouldRoute, enqueue],
  );

  return { routing, hostConfigured, enqueue, enqueuePending, shouldRoute, routePrint, queueMovedSlip };
```

Replace it with:

```ts
      if (result.outcome === "too-large") toast.error(PRINT_JOB_TOO_LARGE_MESSAGE);
      return !printJobEnqueueAllowsLocalPrint(result.outcome);
    },
    [shouldRoute, enqueue, followPrintJob],
  );

  return { routing, hostConfigured, enqueue, enqueuePending, shouldRoute, routePrint, queueMovedSlip };
```

In `apps/cafe/hooks/use-item-void.ts`, find:

```ts
import { toast } from "sonner";

import { apiSend } from "@/lib/api-client";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { CUSTOMER_KEYS } from "@/hooks/use-customers";
```

Replace it with:

```ts
import { toast } from "sonner";

import { apiSend } from "@/lib/api-client";
import { printAgentRequestOptions } from "@/lib/print-agent-calls";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { CUSTOMER_KEYS } from "@/hooks/use-customers";
```

In `apps/cafe/hooks/use-item-void.ts`, find:

```ts
  const mutation = useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: (data: VoidItemInput) =>
      apiSend<Order>(`/api/orders/${orderId}/items/void`, "POST", data),
    onSuccess: (order) => {
      // The route appends exactly one trail entry per call, so its last row is
      // this void's own snapshot — the authoritative thing to print. Guard the
```

Replace it with:

```ts
  const mutation = useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: (data: VoidItemInput) =>
      apiSend<Order>(`/api/orders/${orderId}/items/void`, "POST", data, printAgentRequestOptions()),
    onSuccess: (order) => {
      // The route appends exactly one trail entry per call, so its last row is
      // this void's own snapshot — the authoritative thing to print. Guard the
```

In `apps/cafe/hooks/use-order-requests.ts`, find:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { STALE_TIMES } from "@/lib/query";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
```

Replace it with:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { printAgentRequestOptions } from "@/lib/print-agent-calls";
import { STALE_TIMES } from "@/lib/query";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { TABLE_KEYS } from "@/hooks/use-tables";
```

In `apps/cafe/hooks/use-order-requests.ts`, find:

```ts
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_REQUEST_KEYS.mutation,
    mutationFn: (id: string) =>
      apiSend<AcceptResult>(`/api/order-requests/${id}/accept`, "POST"),
    // FIX10 — a replayed accept did no new work server-side; say so instead
    // of promising a KOT that was already queued (and printed) the first time.
    onSuccess: (result) => {
```

Replace it with:

```ts
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_REQUEST_KEYS.mutation,
    // Session 1C (R1): this hook's one caller (the requests page) prints the accepted round's KOT. The
    // answer names its job beside the order; it rides ON the order, where the KOT print reads it.
    mutationFn: async (id: string) => {
      const result = await apiSend<AcceptResult & { printJobs?: unknown }>(`/api/order-requests/${id}/accept`, "POST", undefined, printAgentRequestOptions());
      return result.printJobs === undefined ? result : { ...result, order: { ...result.order, printJobs: result.printJobs } };
    },
    // FIX10 — a replayed accept did no new work server-side; say so instead
    // of promising a KOT that was already queued (and printed) the first time.
    onSuccess: (result) => {
```

In `apps/cafe/hooks/use-orders.ts`, find:

```ts
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api-client";
import { cafeDateString } from "@/lib/utils";
import { STALE_TIMES, GC_TIMES, REFETCH_INTERVALS } from "@/lib/query";
import { firstPageOnly, nextOrderCursor, onePageAtMost } from "@/lib/order-query";
```

Replace it with:

```ts
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api-client";
import { printAgentRequestOptions } from "@/lib/print-agent-calls";
import { cafeDateString } from "@/lib/utils";
import { STALE_TIMES, GC_TIMES, REFETCH_INTERVALS } from "@/lib/query";
import { firstPageOnly, nextOrderCursor, onePageAtMost } from "@/lib/order-query";
```

In `apps/cafe/hooks/use-orders.ts`, find:

```ts
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: (data: CreateOrderInput) =>
      apiSend<Order>("/api/orders", "POST", data),
    onMutate: async (newOrder) => {
      // Always cancel in-flight queries before writing the cache (design skill #4).
      await qc.cancelQueries({ queryKey: ORDER_KEYS.all });
```

Replace it with:

```ts
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    // Session 1C (R1): this hook's one caller (the POS) prints the KOT, and Pay Now's bill, so the
    // server makes both in this request (lib/print-order-jobs.ts).
    mutationFn: (data: CreateOrderInput) =>
      apiSend<Order>("/api/orders", "POST", data, printAgentRequestOptions(data.status === "Completed")),
    onMutate: async (newOrder) => {
      // Always cancel in-flight queries before writing the cache (design skill #4).
      await qc.cancelQueries({ queryKey: ORDER_KEYS.all });
```

In `apps/cafe/hooks/use-orders.ts`, find:

```ts
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, data }: { id: string; data: AddItemsInput }) =>
      apiSend<Order>(`/api/orders/${id}/items`, "POST", data),
    // No success toast — the POS's confirm says it once, with the round number.
    onError: (err: Error) => {
      if (toastsFailure(err)) toast.error(err.message || "Could not send to kitchen");
```

Replace it with:

```ts
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, data }: { id: string; data: AddItemsInput }) =>
      apiSend<Order>(`/api/orders/${id}/items`, "POST", data, printAgentRequestOptions()),
    // No success toast — the POS's confirm says it once, with the round number.
    onError: (err: Error) => {
      if (toastsFailure(err)) toast.error(err.message || "Could not send to kitchen");
```

In `apps/cafe/hooks/use-orders.ts`, find:

```ts
// caller (hooks/use-settle-flow.ts) shows every failure inside the payment
// popup, and a toast would say it twice. onSettled stays a block body, so
// mutateAsync never waits on the refetches.
export function useSettleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, data }: { id: string; data: SettleOrderInput }) =>
      apiSend<Order>(`/api/orders/${id}/settle`, "POST", data),
    onSuccess: (order) => toast.success(settledMessage(order)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
```

Replace it with:

```ts
// caller (hooks/use-settle-flow.ts) shows every failure inside the payment
// popup, and a toast would say it twice. onSettled stays a block body, so
// mutateAsync never waits on the refetches.
export function useSettleOrder(options: { printsBill?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, data }: { id: string; data: SettleOrderInput }) =>
      apiSend<Order>(`/api/orders/${id}/settle`, "POST", data, options.printsBill === true ? printAgentRequestOptions(true) : {}),
    onSuccess: (order) => toast.success(settledMessage(order)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ORDER_KEYS.all });
```

In `apps/cafe/hooks/use-orders.ts`, find:

```ts
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, tableNo }: { id: string; tableNo: string | null }) =>
      apiSend<Order>(`/api/orders/${id}/table`, "POST", { tableNo }),
    onError: (err: Error) => toast.error(err.message || "Could not move the table"),
    // No success toast — the caller shows the outcome and prints a slip.
    onSettled: () => {
```

Replace it with:

```ts
  return useMutation({
    mutationKey: ORDER_KEYS.mutation,
    mutationFn: ({ id, tableNo }: { id: string; tableNo: string | null }) =>
      apiSend<Order>(`/api/orders/${id}/table`, "POST", { tableNo }, printAgentRequestOptions()),
    onError: (err: Error) => toast.error(err.message || "Could not move the table"),
    // No success toast — the caller shows the outcome and prints a slip.
    onSettled: () => {
```

In `apps/cafe/hooks/use-pos-pulse.ts`, find:

```ts

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { STALE_TIMES, REFETCH_INTERVALS } from "@/lib/query";
import type { PosPulseData } from "@pos/shared/self-order-alert";

```

Replace it with:

```ts

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { pulsePrintDeviceQuery } from "@/lib/print-agent";
import { STALE_TIMES, REFETCH_INTERVALS } from "@/lib/query";
import type { PosPulseData } from "@pos/shared/self-order-alert";

```

In `apps/cafe/hooks/use-pos-pulse.ts`, find:

```ts
export function usePosPulse() {
  return useQuery({
    queryKey: POS_PULSE_KEYS.all,
    queryFn: () => apiGet<PosPulseData>(POS_PULSE_ENDPOINT),
    staleTime: STALE_TIMES.LIVE,
    refetchInterval: REFETCH_INTERVALS.POS_PULSE,
    refetchIntervalInBackground: true,
```

Replace it with:

```ts
export function usePosPulse() {
  return useQuery({
    queryKey: POS_PULSE_KEYS.all,
    // Session 1C: with no host, the print agent names this device here (?device=) — no new request.
    queryFn: () => apiGet<PosPulseData>(`${POS_PULSE_ENDPOINT}${pulsePrintDeviceQuery()}`),
    staleTime: STALE_TIMES.LIVE,
    refetchInterval: REFETCH_INTERVALS.POS_PULSE,
    refetchIntervalInBackground: true,
```

In `apps/cafe/hooks/use-pos-tab.ts`, find:

```ts
      setPaymentOpen(false);
      resetOrder();
    },
  });

  const isBusy =
    createOrder.isPending || addItems.isPending || settleFlow.busy || send.sending !== null || send.frozen !== null;
```

Replace it with:

```ts
      setPaymentOpen(false);
      resetOrder();
    },
  }, { printsBill: true });

  const isBusy =
    createOrder.isPending || addItems.isPending || settleFlow.busy || send.sending !== null || send.frozen !== null;
```

Create `apps/cafe/hooks/use-print-agent.ts`:

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";

import { PRINT_WAKE_DAILY_CAP } from "@pos/shared/print-job";
import type { LeasedPrintJob, PrintAckData, PrintLeaseData, PrintWakeBeatData } from "@pos/shared/print-agent-wire";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { useCanPrintNow, useDevicePrinter } from "@/hooks/use-device-printer";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { apiSend } from "@/lib/api-client";
import { isDesktopShell } from "@/lib/desktop-shell";
import {
  PRINT_AGENT_SLIP_DEADLINE_MS,
  createPrintAgent,
  onPrintAgentKick,
  printAgentSlipOf,
  readPendingAcks,
  setPulsePrintDevice,
  writePendingAcks,
  type PrintAgent,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { createPrintAgentWake } from "@/lib/print-agent-wake";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
import { PRINT_HOST_PRINT_FAILED_MESSAGE, type HostPrintSlip } from "@/lib/print-host-slips";
import { bumpPrintWakeBudget, mergePrintWakeBudget, readPrintWakeBudget, writePrintWakeBudget, type PrintWakeBudget } from "@/lib/print-wake-budget";
import { PrintWriteError } from "@/lib/print-write-outcome";
import { devicePrinter } from "@/lib/printer/device-printer";
import { nativeBridge, nativeOn } from "@/lib/printer/native-bridge";
import { canPrintNow, currentLane, defaultDeviceLabel, printCapabilities } from "@/lib/printer/print-lane";
import { isRealtimeHealthy, subscribeRealtime } from "@/lib/realtime-client";
import { cafeDateString } from "@/lib/utils";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent, wired to this page. The
// rules live in lib/print-agent.ts (unit-tested); this hook only connects them to the host bridge, the
// device printer and the signals that tell the agent a job is waiting for it:
//   · an order answer that named a job for this device (kickPrintAgent, no request);
//   · a "print-status" frame aimed at this device (R7), or — the host only — the "print-job" nudge;
//   · the existing 20 s pulse: with no host the agent names itself there (?device=) and leases when
//     its own line is not empty; the host instead polls the wake POST at the spec §9.1 cadence (R6);
//   · its printer coming back, the bridge freeing up, the app returning to the screen;
//   · its one local timer (retryAt / nextAttemptAt from the server).
// No ordering device gains a recurring request: only the host polls, and only the wake it always had.

const LEASE_URL = "/api/print-jobs/lease";
const WAKE_URL = "/api/print-jobs/wake";

interface UsePrintAgentOptions {
  /** This tab drains this device's line: it is an agent (the host; with no host, every device), its
   *  print surfaces exist, and it holds the drain lock. */
  enabled: boolean;
  /** This device is the print host: it polls the wake and also leases on the broadcast nudge. */
  isHost: boolean;
  deviceId: string;
  tabId: string;
  /** The host bridge is printing something (a test slip, another slip). */
  busy: boolean;
  queueSlip: (slip: HostPrintSlip, done?: HostPrintDone) => void;
}

/** The heartbeat the host's wake carries (spec §10). */
function wakeBody(deviceId: string) {
  const caps = printCapabilities();
  const desktop = isDesktopShell();
  return {
    deviceId,
    label: defaultDeviceLabel(currentLane()),
    shell: caps.native ? "android" : desktop ? "windows" : "browser",
    capabilities: {
      lan: caps.native,
      bluetooth: caps.native || caps.bluetooth,
      usb: caps.native,
      windowsPrinters: desktop,
      webSerial: caps.serial,
      webBluetooth: caps.bluetooth,
    },
  };
}

function timers() {
  return {
    now: () => Date.now(),
    setTimer: (fn: () => void, ms: number): unknown => window.setTimeout(fn, ms),
    clearTimer: (handle: unknown): void => window.clearTimeout(handle as number),
  };
}

export function usePrintAgent({ enabled, isHost, deviceId, tabId, busy, queueSlip }: UsePrintAgentOptions): void {
  const qc = useQueryClient();
  const printer = useDevicePrinter();
  const canPrint = useCanPrintNow();
  const queueRef = useRef(queueSlip);
  useEffect(() => {
    queueRef.current = queueSlip;
  }, [queueSlip]);
  const [agent, setAgent] = useState<PrintAgent | null>(null);

  // One agent per device identity and tab. A reload re-sends any "printed" ack the last page left.
  useEffect(() => {
    if (deviceId === "") return;
    const print = (job: LeasedPrintJob): Promise<PrintAgentResult> =>
      new Promise((resolve) => {
        // The bridge settles every slip; one its watchdog gave up on settles late, so this wait is bounded.
        const deadline = window.setTimeout(
          () => resolve({ ok: false, error: new Error(PRINT_HOST_PRINT_FAILED_MESSAGE) }),
          PRINT_AGENT_SLIP_DEADLINE_MS,
        );
        const done = (result: PrintAgentResult): void => {
          window.clearTimeout(deadline);
          resolve(result);
        };
        try {
          queueRef.current(printAgentSlipOf(job, cafeDateString()), done);
        } catch {
          // A payload this page cannot turn into a slip (deploy skew): nothing was sent, and never will be.
          done({ ok: false, error: new PrintWriteError(PRINT_HOST_PRINT_FAILED_MESSAGE, "no", true) });
        }
      });
    const created = createPrintAgent({
      deviceId,
      lease: () => apiSend<PrintLeaseData>(LEASE_URL, "POST", { deviceId, tabId }),
      ack: (id, body) => apiSend<PrintAckData>(`/api/print-jobs/${encodeURIComponent(id)}/ack`, "POST", body),
      print,
      printerReady: canPrintNow,
      printerState: () => devicePrinter().getSnapshot(),
      readPending: readPendingAcks,
      writePending: writePendingAcks,
      ...timers(),
    });
    setAgent(created);
    void created.flushAcks();
    return () => {
      created.stop();
      setAgent(null);
    };
  }, [deviceId, tabId]);

  useEffect(() => {
    agent?.setGate({ enabled, busy });
  }, [agent, enabled, busy]);

  // The printer reconnected or changed: look at the line (the gate decides).
  useEffect(() => {
    agent?.kick();
  }, [agent, printer, canPrint]);

  useEffect(() => (agent === null ? undefined : onPrintAgentKick(() => agent.kick())), [agent]);

  useEffect(() => {
    if (agent === null || !enabled) return;
    return subscribeRealtime((kind, message) => {
      if (kind === "print-status") {
        const job = message.job as { status?: unknown; target?: unknown } | undefined;
        if (job?.status === "queued" && job.target === deviceId) agent.kick();
      } else if (kind === "print-job" && isHost) {
        agent.kick();
      }
    });
  }, [agent, enabled, isHost, deviceId]);

  // No host: name this device on the pulse, and lease when its own line holds a job.
  useEffect(() => {
    if (agent === null || !enabled || isHost) return;
    setPulsePrintDevice(deviceId);
    const pulseHash = hashKey(POS_PULSE_KEYS.all);
    const off = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success" || event.query.queryHash !== pulseHash) return;
      const data = event.query.state.data as PosPulseData | undefined;
      if ((data?.printJobsForMe?.count ?? 0) > 0) agent.kick();
    });
    return () => {
      off();
      setPulsePrintDevice(null);
    };
  }, [agent, enabled, isHost, deviceId, qc]);

  // The host: the wake poll (spec §9.1), under the device's one daily cap.
  useEffect(() => {
    if (agent === null || !enabled || !isHost) return;
    let memory: PrintWakeBudget | null = null;
    const wake = createPrintAgentWake({
      wake: () => apiSend<PrintWakeBeatData>(WAKE_URL, "POST", wakeBody(deviceId)),
      socketHealthy: isRealtimeHealthy,
      mayPoll: () => isDesktopShell() || document.visibilityState === "visible",
      spendOne: () => {
        const dayKey = cafeDateString();
        const { record, allowed } = bumpPrintWakeBudget(mergePrintWakeBudget(readPrintWakeBudget(), memory, dayKey), dayKey, PRINT_WAKE_DAILY_CAP);
        memory = record;
        writePrintWakeBudget(record);
        return allowed;
      },
      onJobs: () => agent.kick(),
      ...timers(),
    });
    wake.start();
    return () => wake.stop();
  }, [agent, enabled, isHost, deviceId]);

  // The POS app came back to the screen, or its network returned.
  useEffect(() => {
    if (agent === null || !enabled || nativeBridge() === null) return;
    return nativeOn("app.wake", () => agent.kick());
  }, [agent, enabled]);
}
```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts
"use client";

// Print-host plan §B5 (PH-5) — the host's ONE print bridge: three provider-
// owned react-to-print surfaces (KOT/void/moved · bill · end-of-day), the
// "what is on the paper right now" state, and the dispatch effect that fires
// exactly one surface per claimed job. Split out of PrintHostProvider.tsx for
// the file budget (fresh-eyes F12). react-to-print keeps ONE fixed-id iframe
// (`lib/print.ts` print-chain note), so `busy` here — the whole window from
// claim to onAfterPrint — is the gate every claiming lane respects (§B5,
// design review MERGED-13: the EOD and test slips are inside the same window,
// never a component-owned trigger outside it).

import { useCallback, useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
```

Replace it with:

```ts
"use client";

// Print-host plan §B5 (PH-5) — the host's ONE print bridge: three provider-owned react-to-print
// surfaces (KOT/void/moved · bill · end-of-day), the "what is on the paper right now" state, and the
// dispatch effect that fires exactly one surface per job. react-to-print keeps ONE fixed-id iframe
// (`lib/print.ts` print-chain note), so `busy` — the whole window from claim to onAfterPrint — is the
// gate every lane respects (§B5, MERGED-13: the EOD and test slips ride the same window). Session 1C:
// each slip's caller (the print agent) hears its result once, in print order (print-host-outcomes.ts).

import { useCallback, useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts
} from "@/lib/print-host-slips";
import { createWindowLateCompletionGuard } from "@/lib/print-host-late-completion";
import { laneFailureMessage } from "@/lib/printer/lane-print";
import type { Order } from "@/types";

/** What the bridge is printing: a claimed job's slip, or PH-7's attestation
```

Replace it with:

```ts
} from "@/lib/print-host-slips";
import { createWindowLateCompletionGuard } from "@/lib/print-host-late-completion";
import { laneFailureMessage } from "@/lib/printer/lane-print";
import { createHostSlipOutcomes, type HostPrintDone } from "@/lib/print-host-outcomes";
import type { Order } from "@/types";

/** What the bridge is printing: a claimed job's slip, or PH-7's attestation
```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts
  // Fires each surface at most once per job — the dispatch effect re-runs on
  // eodReady/print-fn identity changes while the same job is still current.
  const dispatchedRef = useRef(false);
  // SYNCHRONOUS occupancy — set the moment a slip is accepted, cleared only
  // when nothing is left to print. Handlers read this, never `current` (state
  // lags a render). The two automatic lanes gate on `busy` and never queue
  // while a slip is in flight, but the band's manual "Print round N" tap does
  // not (its claim resolves whenever the server answers), so a second slip can
  // arrive mid-print: it WAITS here instead of replacing `current` — a second
  // react-to-print call tears down the fixed-id `#printWindow` iframe the first
  // job is still printing from (lib/print.ts print-chain note; review PH-5 L1).
  const occupiedRef = useRef(false);
  const pendingRef = useRef<HostPrintSlip[]>([]);
  const testRef = useRef<TestSlipWaiter | null>(null);
```

Replace it with:

```ts
  // Fires each surface at most once per job — the dispatch effect re-runs on
  // eodReady/print-fn identity changes while the same job is still current.
  const dispatchedRef = useRef(false);
  // SYNCHRONOUS occupancy — set the moment a slip is accepted, cleared only when nothing is left to
  // print; handlers read this, never `current` (state lags a render). A slip that arrives mid-print
  // (the band's manual tap has no busy gate) WAITS here instead of replacing `current`: a second
  // react-to-print call tears down the fixed-id `#printWindow` iframe in use (review PH-5 L1).
  const occupiedRef = useRef(false);
  const pendingRef = useRef<HostPrintSlip[]>([]);
  const testRef = useRef<TestSlipWaiter | null>(null);
```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts
  // A job the watchdog gave up on is ABANDONED, not forgotten: its slot stays occupied
  // until it reports or the grace passes (one shared onAfterPrint would settle the NEXT job).
  const [lateGuard] = useState(createWindowLateCompletionGuard);

  const settle = useCallback((requested: string | null) => {
    const failure = lateGuard.take() ? null : requested; // already announced at the watchdog
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
```

Replace it with:

```ts
  // A job the watchdog gave up on is ABANDONED, not forgotten: its slot stays occupied
  // until it reports or the grace passes (one shared onAfterPrint would settle the NEXT job).
  const [lateGuard] = useState(createWindowLateCompletionGuard);
  const outcomesRef = useRef(createHostSlipOutcomes());

  const settle = useCallback((requested: string | null) => {
    const failure = lateGuard.take() ? null : requested; // already announced at the watchdog
    outcomesRef.current.finish(requested === null ? { ok: true } : { ok: false, error: new Error(requested) });
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts
    return () => window.clearTimeout(id);
  }, [current, settle]);

  const queueSlip = useCallback((slip: HostPrintSlip) => {
    if (occupiedRef.current) {
      pendingRef.current.push(slip);
      return;
```

Replace it with:

```ts
    return () => window.clearTimeout(id);
  }, [current, settle]);

  const queueSlip = useCallback((slip: HostPrintSlip, done?: HostPrintDone) => {
    outcomesRef.current.track(done ?? null);
    if (occupiedRef.current) {
      pendingRef.current.push(slip);
      return;
```

In `apps/cafe/hooks/use-print-host-bridge.ts`, find:

```ts
          return;
        }
        occupiedRef.current = true;
        testRef.current = { resolve, reject, startedAt: performance.now() };
        setCurrent({ kind: "test" });
      }),
```

Replace it with:

```ts
          return;
        }
        occupiedRef.current = true;
        outcomesRef.current.track(null);
        testRef.current = { resolve, reject, startedAt: performance.now() };
        setCurrent({ kind: "test" });
      }),
```

In `apps/cafe/hooks/use-print-host.ts`, find:

```ts
const DESIGNATE_ERROR = "Could not set the print host — try again.";
const CLEAR_ERROR = "Could not clear the print host — try again.";

export interface EnqueuePrintJobInput { payload: PrintJobPayload; label: string }

/** POST /api/print-jobs. Resolves with the server's `outcome` discriminant —
 *  every value, `"too-large"` included, is a NORMAL 200, and the only sanctioned
```

Replace it with:

```ts
const DESIGNATE_ERROR = "Could not set the print host — try again.";
const CLEAR_ERROR = "Could not clear the print host — try again.";

export interface EnqueuePrintJobInput {
  payload: PrintJobPayload;
  label: string;
  /** Session 1C: the agent's opt-in and Idempotency-Key (request headers, never part of the body). */
  headers?: Record<string, string>;
}

/** POST /api/print-jobs. Resolves with the server's `outcome` discriminant —
 *  every value, `"too-large"` included, is a NORMAL 200, and the only sanctioned
```

In `apps/cafe/hooks/use-print-host.ts`, find:

```ts
export function useEnqueuePrintJob() {
  return useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: (input: EnqueuePrintJobInput) => apiSend<PrintJobEnqueueResult>("/api/print-jobs", "POST", input),
    onError: (err: Error) => toast.error(err.message || ENQUEUE_ERROR),
  });
}
```

Replace it with:

```ts
export function useEnqueuePrintJob() {
  return useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: ({ headers, ...input }: EnqueuePrintJobInput) => apiSend<PrintJobEnqueueResult>("/api/print-jobs", "POST", input, { headers }),
    onError: (err: Error) => toast.error(err.message || ENQUEUE_ERROR),
  });
}
```

In `apps/cafe/hooks/use-print-routing.ts`, find:

```ts
import { useCallback } from "react";

import { billPrintJob, kotPrintJob, voidPrintJob, type PrintHostRouting } from "@/lib/print-routing";
import type { Order, OrderVoid } from "@/types";
import { useHostRouting, type PrintRoutingHost } from "@/hooks/use-host-routing";

```

Replace it with:

```ts
import { useCallback } from "react";

import { billPrintJob, kotPrintJob, voidPrintJob, type PrintHostRouting } from "@/lib/print-routing";
import { printJobRefOf } from "@/lib/print-agent-calls";
import type { Order, OrderVoid } from "@/types";
import { useHostRouting, type PrintRoutingHost } from "@/hooks/use-host-routing";

```

In `apps/cafe/hooks/use-print-routing.ts`, find:

```ts
    // lanes so the enqueued job and a local fallback print identical slips.
    const resolved = round ?? order.kotRounds;
    noteOrder(order);
    routePrint(() => kotPrintJob(order, resolved), () => localKot(order, resolved));
  }, [routePrint, localKot, noteOrder]);

  const queueVoidSlip = useCallback((order: Order, entry: OrderVoid) => {
    noteOrder(order);
    routePrint(() => voidPrintJob(order, entry, { reprint: false }), () => localVoid(order, entry));
  }, [routePrint, localVoid, noteOrder]);

  const reprintKot = useCallback(() => {
```

Replace it with:

```ts
    // lanes so the enqueued job and a local fallback print identical slips.
    const resolved = round ?? order.kotRounds;
    noteOrder(order);
    routePrint(() => kotPrintJob(order, resolved), () => localKot(order, resolved), printJobRefOf(order, "kot"));
  }, [routePrint, localKot, noteOrder]);

  const queueVoidSlip = useCallback((order: Order, entry: OrderVoid) => {
    noteOrder(order);
    routePrint(() => voidPrintJob(order, entry, { reprint: false }), () => localVoid(order, entry), printJobRefOf(order, "void"));
  }, [routePrint, localVoid, noteOrder]);

  const reprintKot = useCallback(() => {
```

In `apps/cafe/hooks/use-print-routing.ts`, find:

```ts
    // `bill:<id>` jobKey is what makes a retry idempotent. PH-6's
    // OrderDetailSheet reprint is the `{ reprint: true }` caller.
    noteOrder(order);
    routePrint(() => billPrintJob(order, { reprint: false }), () => localBill(order));
  }, [routePrint, localBill, noteOrder]);

  return {
```

Replace it with:

```ts
    // `bill:<id>` jobKey is what makes a retry idempotent. PH-6's
    // OrderDetailSheet reprint is the `{ reprint: true }` caller.
    noteOrder(order);
    routePrint(() => billPrintJob(order, { reprint: false }), () => localBill(order), printJobRefOf(order, "bill"));
  }, [routePrint, localBill, noteOrder]);

  return {
```

In `apps/cafe/hooks/use-self-order-auto-print.ts`, find:

```ts
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiSend } from "@/lib/api-client";
import { autoPrintCandidate } from "@pos/shared/self-order-alert";
import { usePosPulseContext, usePrintHostRouting } from "@/components/layout/PosPulseProvider";
import { useCanPrintNow } from "@/hooks/use-device-printer";
```

Replace it with:

```ts
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiSend } from "@/lib/api-client";
import { printAgentRequestOptions } from "@/lib/print-agent-calls";
import { autoPrintCandidate } from "@pos/shared/self-order-alert";
import { usePosPulseContext, usePrintHostRouting } from "@/components/layout/PosPulseProvider";
import { useCanPrintNow } from "@/hooks/use-device-printer";
```

In `apps/cafe/hooks/use-self-order-auto-print.ts`, find:

```ts

  const claim = useMutation({
    mutationFn: (requestId: string) =>
      apiSend<KotClaimResult>(`/api/order-requests/${requestId}/kot-claim`, "POST"),
  });
  // useMutation returns a NEW result object every render ({...result, mutate})
  // while `mutate` itself is useCallback-stable — depending on `claim` here
```

Replace it with:

```ts

  const claim = useMutation({
    mutationFn: (requestId: string) =>
      // Session 1C (R4, job-aware lane): the claim makes the KOT a print job; queueKotRound follows it.
      apiSend<KotClaimResult>(`/api/order-requests/${requestId}/kot-claim`, "POST", undefined, printAgentRequestOptions()),
  });
  // useMutation returns a NEW result object every render ({...result, mutate})
  // while `mutate` itself is useCallback-stable — depending on `claim` here
```

In `apps/cafe/hooks/use-settle-flow.ts`, find:

```ts

export type { SettleFlowHandlers };

export function useSettleFlow(handlers: SettleFlowHandlers) {
  const settleOrder = useSettleOrder();
  const qc = useQueryClient();
  const settings = useSettings();
  // Called after awaits: always the handlers, the POST and the settings of the latest commit.
```

Replace it with:

```ts

export type { SettleFlowHandlers };

export function useSettleFlow(handlers: SettleFlowHandlers, options: { printsBill?: boolean } = {}) {
  // Session 1C (R1): only a settle that prints the bill (the POS) lets the server make it.
  const settleOrder = useSettleOrder({ printsBill: options.printsBill === true });
  const qc = useQueryClient();
  const settings = useSettings();
  // Called after awaits: always the handlers, the POST and the settings of the latest commit.
```

Create `apps/cafe/lib/print-agent-calls.ts`:

```ts
import {
  PRINT_AGENT_HEADER,
  PRINT_BILL_HEADER,
  PRINT_DEVICE_ID_HEADER,
  PRINT_HEADER_ON,
  PRINT_IDEMPOTENCY_HEADER,
  PRINT_IDEMPOTENCY_KEY_PATTERN,
  type PrintJobRef,
} from "@pos/shared/print-agent-wire";
import type { PrintJobKind } from "@pos/shared/print-job";
import { mintTabId, readDeviceId } from "@/lib/pos-device-id";

// Printing redesign, Phase 1 Session 1C (spec §7.4, §9.1; rulings R1 and M-d): the call sites' half of
// the agent. An order request whose call site prints its slips says so (R1's headers), and the server
// makes those slips in the same request; the answer names each job (`printJobs`). The call site then
// follows that job and never prints the slip itself. A slip the answer did not name (a replay, a
// failed create) is enqueued by the call site under today's job key, so it is still one job.

/** R1's opt-in. {} for a device with no identity: the server then prints nothing for this request,
 *  and the call site prints exactly as before Phase 1. */
export function printAgentHeaders(deviceId: string, bill = false): Record<string, string> {
  if (deviceId === "") return {};
  return {
    [PRINT_AGENT_HEADER]: PRINT_HEADER_ON,
    [PRINT_DEVICE_ID_HEADER]: deviceId,
    ...(bill ? { [PRINT_BILL_HEADER]: PRINT_HEADER_ON } : {}),
  };
}

/** apiSend's options for an order request whose call site prints the slips it makes. */
export function printAgentRequestOptions(bill = false): { headers?: Record<string, string> } {
  const headers = printAgentHeaders(readDeviceId(), bill);
  return Object.keys(headers).length === 0 ? {} : { headers };
}

/** A client-started print (POST /api/print-jobs) from an agent: the opt-in, so with no host the job is
 *  this device's own (1B enqueueOwnPrintJob), plus an Idempotency-Key, so a keyless repeat (a reprint,
 *  End of day, a cancel notice) is one job even if its POST is sent twice (spec §6.5). */
export function printAgentEnqueueHeaders(deviceId: string): Record<string, string> {
  const key = mintTabId();
  return { ...printAgentHeaders(deviceId), ...(PRINT_IDEMPOTENCY_KEY_PATTERN.test(key) ? { [PRINT_IDEMPOTENCY_HEADER]: key } : {}) };
}

function isPrintJobRef(value: unknown): value is PrintJobRef {
  const ref = value as Partial<PrintJobRef> | null;
  return typeof ref === "object" && ref !== null && typeof ref.id === "string" && typeof ref.kind === "string" && typeof ref.status === "string";
}

/** The job an order answer made for one kind of slip, or null: then the call site enqueues it. */
export function printJobRefOf(order: unknown, kind: PrintJobKind): PrintJobRef | null {
  const refs = (order as { printJobs?: unknown } | null | undefined)?.printJobs;
  if (!Array.isArray(refs)) return null;
  return refs.find((ref): ref is PrintJobRef => isPrintJobRef(ref) && ref.kind === kind) ?? null;
}
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
import { PRINT_ACK_ERROR_MAX_CHARS, PRINT_ACK_PENDING_MAX_MS, PRINT_ACK_RETRY_MS } from "@pos/shared/print-lifecycle";
import {
  PRINT_AGENT_REFUSED_RECHECK_MS,
  printAgentMayLease,
```

Replace it with:

```ts
import { PRINT_ACK_ERROR_MAX_CHARS, PRINT_ACK_PENDING_MAX_MS, PRINT_ACK_RETRY_MS, printBannerText } from "@pos/shared/print-lifecycle";
import {
  PRINT_AGENT_REFUSED_RECHECK_MS,
  printAgentMayLease,
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
  type PrintLeaseData,
} from "@pos/shared/print-agent-wire";
import { ApiError } from "@/lib/api-client";
import { printWriteOutcomeOf, type PrintWriteOutcome } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent's core, with no React and
```

Replace it with:

```ts
  type PrintLeaseData,
} from "@pos/shared/print-agent-wire";
import { ApiError } from "@/lib/api-client";
import {
  PRINT_HOST_DISPATCH_TIMEOUT_MS,
  PRINT_HOST_EOD_READY_TIMEOUT_MS,
  hostPrintSlipOf,
  type HostPrintSlip,
} from "@/lib/print-host-slips";
import { printWriteOutcomeOf, type PrintWriteOutcome } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent's core, with no React and
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
  stop(): void;
}

/** The pending-ack store keeps at most this many entries (an agent prints one job at a time). */
export const PRINT_ACK_PENDING_LIMIT = 50;

```

Replace it with:

```ts
  stop(): void;
}

/** How long the agent waits for the bridge to settle one slip: past the bridge's own bounds (the end-of-day
 *  figures' wait, then the dispatch watchdog), so only a slip the watchdog gave up on reaches it. Such a
 *  slip may have printed, so it is acked "maybe". */
export const PRINT_AGENT_SLIP_DEADLINE_MS = PRINT_HOST_EOD_READY_TIMEOUT_MS + PRINT_HOST_DISPATCH_TIMEOUT_MS + 5_000;

/** The pending-ack store keeps at most this many entries (an agent prints one job at a time). */
export const PRINT_ACK_PENDING_LIMIT = 50;

```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
    ...(outcome.permanent ? { permanent: true as const } : {}),
    ...(error !== "" ? { error } : {}),
  };
}

/** A server answer of any kind clears a pending ack; only no answer (network, timeout) or a 5xx retries. */
```

Replace it with:

```ts
    ...(outcome.permanent ? { permanent: true as const } : {}),
    ...(error !== "" ? { error } : {}),
  };
}

/** The slip the host bridge prints for one leased job: today's renderer props (print-host-slips.ts),
 *  plus the job's labels as the one banner on top (spec §7.7). An end-of-day summary takes none. */
export function printAgentSlipOf(job: LeasedPrintJob, todayKey: string): HostPrintSlip {
  const slip = hostPrintSlipOf(job.payload, todayKey);
  const banner = printBannerText(job.labels);
  return banner === "" || slip.surface === "eod" ? slip : { ...slip, banner };
}

/** A server answer of any kind clears a pending ack; only no answer (network, timeout) or a 5xx retries. */
```

Create `apps/cafe/lib/print-host-outcomes.ts`:

```ts
// Printing redesign, Phase 1 Session 1C: what became of each slip the host bridge printed, told to the
// one caller that wants to know (the print agent, which acks it). The bridge prints strictly in order
// (one current slip, the rest waiting FIFO), so the outcomes are a FIFO too: track() when a slip joins
// the bridge's line, finish() when the bridge settles the slip in front. Every callback runs at most
// once. A slip the watchdog gave up on settles later (its late completion, or the grace), and only then
// is it finished, so a late completion can never be taken for the next slip; the agent bounds its own
// wait (PRINT_AGENT_SLIP_DEADLINE_MS). Pure, no React.

export type HostPrintResult = { ok: true } | { ok: false; error: unknown };
export type HostPrintDone = (result: HostPrintResult) => void;

export interface HostSlipOutcomes {
  /** A slip (or the test slip, `null`) joined the bridge's line. */
  track(done: HostPrintDone | null): void;
  /** The slip in front settled: tell its caller, and let it go. */
  finish(result: HostPrintResult): void;
}

export function createHostSlipOutcomes(): HostSlipOutcomes {
  const line: Array<HostPrintDone | null> = [];
  return {
    track(done) {
      line.push(done);
    },
    finish(result) {
      const done = line.shift();
      if (done === undefined || done === null) return;
      try {
        done(result);
      } catch {
        // A throwing listener must not wedge the bridge.
      }
    },
  };
}
```

In `apps/cafe/lib/print-host-slips.ts`, find:

```ts
  movedBy?: string;
  movedAt?: string;
  documentTitle: string;
}

export interface HostReceiptSlip {
  surface: "receipt";
  order: Order;
  documentTitle: string;
}

/** The one payload exception (§B1): a live aggregate the host recomputes. */
```

Replace it with:

```ts
  movedBy?: string;
  movedAt?: string;
  documentTitle: string;
  /** Session 1C (spec §7.7): the job's labels as one inverted banner ("REPRINT"); absent for none. */
  banner?: string;
}

export interface HostReceiptSlip {
  surface: "receipt";
  order: Order;
  documentTitle: string;
  /** Session 1C (spec §7.7): "DUPLICATE" on a bill printed again; absent for none. */
  banner?: string;
}

/** The one payload exception (§B1): a live aggregate the host recomputes. */
```

In `apps/cafe/lib/print-write-outcome.ts`, find:

```ts
import { DESKTOP_PRINT_EMPTY_MESSAGE } from "@/lib/desktop-shell-document";
import { DESKTOP_PRINT_TOO_LARGE_MESSAGE } from "@/lib/desktop-shell";
import { PRINT_HOST_EMPTY_SLIP_MESSAGE } from "@/lib/print-host-slips";
import { NO_PRINTER_MESSAGE } from "@/lib/printer/lane-print";
import { RASTER_FAILED_MESSAGE, RASTER_TOO_LARGE_MESSAGE } from "@/lib/printer/raster";
import {
```

Replace it with:

```ts
import { DESKTOP_PRINT_EMPTY_MESSAGE } from "@/lib/desktop-shell-document";
import { DESKTOP_PRINT_TOO_LARGE_MESSAGE } from "@/lib/desktop-shell";
import { PRINT_HOST_EMPTY_SLIP_MESSAGE, PRINT_HOST_EOD_TIMEOUT_MESSAGE } from "@/lib/print-host-slips";
import { NO_PRINTER_MESSAGE } from "@/lib/printer/lane-print";
import { RASTER_FAILED_MESSAGE, RASTER_TOO_LARGE_MESSAGE } from "@/lib/printer/raster";
import {
```

In `apps/cafe/lib/print-write-outcome.ts`, find:

```ts
}

/** Refused before any byte left: no printer here, not connected, owned by another tab, Bluetooth
 *  off or blocked, the printer busy, or the slip could not be drawn. */
const NOTHING_SENT: ReadonlySet<string> = new Set([
  NO_PRINTER_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_ELSEWHERE_MESSAGE,
```

Replace it with:

```ts
}

/** Refused before any byte left: no printer here, not connected, owned by another tab, Bluetooth
 *  off or blocked, the printer busy, the slip could not be drawn, or its figures never loaded. */
const NOTHING_SENT: ReadonlySet<string> = new Set([
  PRINT_HOST_EOD_TIMEOUT_MESSAGE,
  NO_PRINTER_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_ELSEWHERE_MESSAGE,
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent-paths.test.ts lib/print-agent.test.ts lib/print-host-paths.test.ts lib/printer/print-gating-paths.test.ts lib/printer/print-gating-fx-paths.test.ts lib/print-wake.test.ts lib/settle-flow-paths.test.ts lib/print-order-jobs.test.ts lib/print-write-outcome.test.ts lib/print-routing.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 180`; `# pass 180`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npm test 2>&1 | grep -E "^# (tests|pass|fail)|^not ok"; npm run lint 2>&1 | tail -2`
Expected: `not ok 705 - PIN: cb-dl2-decisions.md D-C's archive-path clause names the OS temp directory, not <cwd>, and says the path is printed`; `# tests 4091`; `# pass 4090`; `# fail 1`; `✖ 2 problems (0 errors, 2 warnings)`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/components/layout/PrintHostProvider.tsx apps/cafe/components/pos/KOTReceipt.tsx apps/cafe/components/pos/OrderReceipt.tsx apps/cafe/components/pos/PrintBanner.tsx apps/cafe/components/pos/PrintSources.tsx apps/cafe/components/print/PrintHostDrain.tsx apps/cafe/components/print/PrintHostPrintSources.tsx apps/cafe/hooks/use-host-routing.ts apps/cafe/hooks/use-item-void.ts apps/cafe/hooks/use-order-requests.ts apps/cafe/hooks/use-orders.ts apps/cafe/hooks/use-pos-pulse.ts apps/cafe/hooks/use-pos-tab.ts apps/cafe/hooks/use-print-agent.ts apps/cafe/hooks/use-print-host-bridge.ts apps/cafe/hooks/use-print-host.ts apps/cafe/hooks/use-print-routing.ts apps/cafe/hooks/use-self-order-auto-print.ts apps/cafe/hooks/use-settle-flow.ts apps/cafe/lib/print-agent-calls.ts apps/cafe/lib/print-agent-paths.test.ts apps/cafe/lib/print-agent.test.ts apps/cafe/lib/print-agent.ts apps/cafe/lib/print-host-outcomes.ts apps/cafe/lib/print-host-paths.test.ts apps/cafe/lib/print-host-slips.ts apps/cafe/lib/print-order-jobs.test.ts apps/cafe/lib/print-wake.test.ts apps/cafe/lib/print-write-outcome.test.ts apps/cafe/lib/print-write-outcome.ts apps/cafe/lib/printer/print-gating-paths.test.ts apps/cafe/lib/settle-flow-paths.test.ts apps/cafe/package.json
git commit -m "feat(print): every device prints through the agent: order requests opt in, call sites follow their jobs, the bridge reports each slip, a banner says REPRINT or DUPLICATE"
```

---

### Task C5: live legs ad–ae (the two-attempt rule; the job-aware self-order lane)

**Files:**
- Create: `apps/cafe/scripts/print-host-live/agent.ts` (legs ad, ae)
- Modify: `apps/cafe/scripts/verify-print-host-live.ts` (run them after ac)
- Modify (deliberate): `apps/cafe/scripts/print-host-live/lifecycle-actions.ts` leg (w): the cashier's copy is the bill's one retry; a Retry is one more attempt

**Interfaces produced:** none (legs only).

Leg (ad) runs the owner's rule against real Mongo: a KOT's maybe → REPRINT → maybe → failed; a Retry is one try; six refusals leave the slip queued, unlabelled, uncounted, then it prints once; a bill's cashier copy is its one retry. Leg (ae) runs `claimKotPrintForAgent` on raw OrderRequest fixtures: one job with a host, the claimer's own with none, a racing lane (new or old) makes nothing, a cancelled order makes nothing.

- [ ] **Step 1: The legs**

Create `apps/cafe/scripts/print-host-live/agent.ts`:

```ts
/**
 * Phase 1 Session 1C live legs — the owner's two-attempt rule (ad) and the job-aware self-order lane
 * (ae), against a REAL MongoDB. Run by scripts/verify-print-host-live.ts after legs y–ac.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { SELF_ORDER_RECEIVER } from "@pos/shared/public";
import { PRINT_BACKOFF_MS } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { Order } from "@/models/Order";
import { OrderRequest } from "@/models/OrderRequest";
import { claimKotPrint } from "@/lib/pos-pulse";
import { claimKotPrintForAgent } from "@/lib/print-agent-server";
import { ackPrintJob, readJobsForDevice } from "@/lib/print-lease";
import { confirmPrintJob, retryPrintJob } from "@/lib/print-job-actions";
import { check, seedRealOrder } from "./harness";
import { HOST, STAFF, freshHost, lease, queueBill, queueKot, rowOf } from "./lifecycle";

const PHONE = "live-agent-phone";
const STEADY = PRINT_BACKOFF_MS[PRINT_BACKOFF_MS.length - 1];

async function leaseAt(nowMs: number) {
  const res = await lease(nowMs);
  const job = res.jobs[0];
  if (job === undefined) throw new Error(`nothing to lease at +${nowMs}`);
  return job;
}

export async function legAD(nowMs: number): Promise<void> {
  console.log("\n(ad) the owner's rule: at most two attempts that may print; refusals never count");
  await freshHost(nowMs);
  let t = nowMs;

  // A KOT: the first maybe is retried once with REPRINT, the second maybe is failed.
  const kot = await queueKot(t);
  let job = await leaseAt(t);
  await ackPrintJob({ id: kot, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "maybe", nowMs: t });
  let row = await rowOf(kot);
  check("(ad) a KOT's first maybe goes back in line once, labelled REPRINT", row?.status === "queued" && row?.uncertainAttempts === 1 && JSON.stringify(row?.labels) === '["REPRINT"]');
  t += STEADY;
  job = await leaseAt(t);
  await ackPrintJob({ id: kot, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "maybe", nowMs: t });
  row = await rowOf(kot);
  check("(ad) its second maybe ends in failed, waiting for staff", row?.status === "failed" && row?.uncertainAttempts === 2);

  // Staff tap Retry: one tap, one try.
  await retryPrintJob({ id: kot, nowMs: t });
  t += 1;
  job = await leaseAt(t);
  await ackPrintJob({ id: kot, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "maybe", nowMs: t });
  row = await rowOf(kot);
  check("(ad) a Retry is one more attempt: its maybe sends the slip back to failed", row?.status === "failed");
  await PrintJob.deleteMany({});

  // Refusals (the printer was off): any number of them, and the slip still waits in line, unlabelled.
  const refused = await queueKot(t);
  for (let i = 0; i < 6; i++) {
    t += STEADY;
    job = await leaseAt(t);
    await ackPrintJob({ id: refused, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "no", error: "not connected", nowMs: t });
  }
  row = await rowOf(refused);
  check("(ad) six refusals: still queued, no attempt counted, no label", row?.status === "queued" && row?.attempts === 6 && row?.uncertainAttempts === 0 && JSON.stringify(row?.labels) === "[]");
  const mine = await readJobsForDevice(HOST, t);
  check("(ad) the waiting slip shows in the device's own line (the pulse's printJobsForMe)", mine.count === 1);
  t += STEADY;
  job = await leaseAt(t);
  await ackPrintJob({ id: refused, deviceId: HOST, epoch: job.epoch, outcome: "printed", nowMs: t });
  check("(ad) the printer back: it prints once, unlabelled", (await rowOf(refused))?.status === "printed");
  await PrintJob.deleteMany({});

  // A bill: the first maybe asks the cashier; their print again is the one retry; a second maybe is failed.
  const bill = await queueBill(t);
  job = await leaseAt(t);
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "maybe", nowMs: t });
  check("(ad) a bill's first maybe waits for the cashier", (await rowOf(bill))?.status === "needs-confirm");
  await confirmPrintJob({ id: bill, decision: "reprint", staff: STAFF, nowMs: t });
  row = await rowOf(bill);
  check("(ad) the cashier's print again is queued DUPLICATE as the bill's one retry", row?.status === "queued" && JSON.stringify(row?.labels) === '["DUPLICATE"]' && row?.uncertainAttempts === 1);
  t += 1;
  job = await leaseAt(t);
  check("(ad) the retry is leased with its banner label", JSON.stringify(job.labels) === '["DUPLICATE"]');
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: job.epoch, outcome: "failed", sent: "maybe", nowMs: t });
  check("(ad) its second maybe is failed, never a second cashier prompt", (await rowOf(bill))?.status === "failed");
}

async function seedSelfOrderRequest(orderObjectId: string, round: number): Promise<string> {
  const order = await Order.findById(orderObjectId).select("orderId").lean();
  if (order === null) throw new Error("seeded order missing");
  const res = await OrderRequest.collection.insertOne({
    // A raw fixture, unique like every real request's diner code (the shortCode index).
    shortCode: `LIVE-${new mongoose.Types.ObjectId().toHexString()}`,
    status: "accepted",
    actor: SELF_ORDER_RECEIVER,
    acceptedOrderId: order.orderId,
    acceptedKotRound: round,
    acceptedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return String(res.insertedId);
}

export async function legAE(nowMs: number): Promise<void> {
  console.log("\n(ae) the job-aware self-order lane: an agent's claim makes the KOT one print job (ruling R4)");
  await freshHost(nowMs);
  const orderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const requestId = await seedSelfOrderRequest(orderId, 1);
  const claim = await claimKotPrintForAgent(requestId, { deviceId: PHONE, bill: false }, nowMs);
  const refs = claim.claimed ? claim.order.printJobs ?? [] : [];
  const jobs = await PrintJob.find({ jobKey: `kot:${orderId}:1` }).lean();
  check("(ae) with a host: one KOT job for the host, today's key, named in the answer", claim.claimed && refs.length === 1 && jobs.length === 1 && jobs[0]?.targetDeviceId === HOST && refs[0]?.id === String(jobs[0]?._id));
  check("(ae) the claim is stamped as before (the D9 marker)", (await OrderRequest.findById(requestId).lean())?.kotPrintedAt instanceof Date);
  const again = await claimKotPrintForAgent(requestId, { deviceId: "live-other-tab", bill: false }, nowMs);
  const oldLane = await claimKotPrint(requestId);
  check("(ae) a second lane, new or old, loses the claim and makes nothing", !again.claimed && !oldLane.claimed && (await PrintJob.countDocuments({})) === 1);

  await PrintHost.deleteMany({});
  const ownOrder = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const ownRequest = await seedSelfOrderRequest(ownOrder, 1);
  const own = await claimKotPrintForAgent(ownRequest, { deviceId: PHONE, bill: false }, nowMs);
  const ownJob = await PrintJob.findOne({ jobKey: `kot:${ownOrder}:1` }).lean();
  check("(ae) with no host: the claiming device prints its own KOT (§6.6)", own.claimed && ownJob?.targetDeviceId === PHONE && ownJob?.originDeviceId === PHONE);

  const cancelled = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(cancelled) }, { $set: { status: "Cancelled" } });
  const cancelledRequest = await seedSelfOrderRequest(cancelled, 1);
  const refusedClaim = await claimKotPrintForAgent(cancelledRequest, { deviceId: PHONE, bill: false }, nowMs);
  check("(ae) a cancelled order: not eligible, and no job", !refusedClaim.claimed && (await PrintJob.countDocuments({ jobKey: `kot:${cancelled}:1` })) === 0);
  await OrderRequest.deleteMany({});
}
```

In `apps/cafe/scripts/print-host-live/lifecycle-actions.ts`, find:

```ts
 */
import { PrintJob } from "@/models/PrintJob";
import { PrintDevice } from "@/models/PrintDevice";
import { dismissQueuedPrintJobsForClearedHost, enqueuePrintJob } from "@/lib/print-queue";
import { ackPrintJob } from "@/lib/print-lease";
import { confirmPrintJob, retryPrintJob } from "@/lib/print-job-actions";
import { beatPrintDevice, countOnlineAgents, touchPrintDevice } from "@/lib/print-device";
```

Replace it with:

```ts
 */
import { PrintJob } from "@/models/PrintJob";
import { PrintDevice } from "@/models/PrintDevice";
import { dismissPrintJob, dismissQueuedPrintJobsForClearedHost, enqueuePrintJob } from "@/lib/print-queue";
import { ackPrintJob } from "@/lib/print-lease";
import { confirmPrintJob, retryPrintJob } from "@/lib/print-job-actions";
import { beatPrintDevice, countOnlineAgents, touchPrintDevice } from "@/lib/print-device";
```

In `apps/cafe/scripts/print-host-live/lifecycle-actions.ts`, find:

```ts
  const second = await lease(nowMs + 2);
  check("(w) the DUPLICATE copy is leased next, epoch 2", second.jobs[0]?.id === bill && second.jobs[0]?.epoch === 2 && second.jobs[0]?.labels.includes("DUPLICATE") === true);
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: 2, outcome: "failed", sent: "maybe", nowMs: nowMs + 3 });
  const said = await confirmPrintJob({ id: bill, decision: "printed", staff: STAFF, nowMs: nowMs + 4 });
  row = await rowOf(bill);
  check("(w) 'It printed' resolves it, stamped with the cashier", said.applied && row?.status === "printed" && row?.printedBy === STAFF);
  const late = await confirmPrintJob({ id: bill, decision: "dismiss", staff: STAFF, nowMs: nowMs + 5 });
  check("(w) a decision on a job that is not waiting for one is refused", !late.applied && late.reason === "wrong-status");

  const other = await queueBill(nowMs);
```

Replace it with:

```ts
  const second = await lease(nowMs + 2);
  check("(w) the DUPLICATE copy is leased next, epoch 2", second.jobs[0]?.id === bill && second.jobs[0]?.epoch === 2 && second.jobs[0]?.labels.includes("DUPLICATE") === true);
  await ackPrintJob({ id: bill, deviceId: HOST, epoch: 2, outcome: "failed", sent: "maybe", nowMs: nowMs + 3 });
  // Session 1C (the owner's two-attempt rule): the cashier's copy was the bill's one retry, so its maybe is failed.
  check("(w) a maybe on the cashier's copy fails the bill: never a second prompt", (await rowOf(bill))?.status === "failed");
  await dismissPrintJob({ id: bill, reason: "staff", dismissedBy: STAFF });
  const asked = await queueBill(nowMs);
  await lease(nowMs + 3);
  await ackPrintJob({ id: asked, deviceId: HOST, epoch: 1, outcome: "failed", sent: "maybe", nowMs: nowMs + 3 });
  const said = await confirmPrintJob({ id: asked, decision: "printed", staff: STAFF, nowMs: nowMs + 4 });
  row = await rowOf(asked);
  check("(w) 'It printed' resolves it, stamped with the cashier", said.applied && row?.status === "printed" && row?.printedBy === STAFF);
  const late = await confirmPrintJob({ id: asked, decision: "dismiss", staff: STAFF, nowMs: nowMs + 5 });
  check("(w) a decision on a job that is not waiting for one is refused", !late.applied && late.reason === "wrong-status");

  const other = await queueBill(nowMs);
```

In `apps/cafe/scripts/print-host-live/lifecycle-actions.ts`, find:

```ts
  check("(w) a permanent error fails the job at once", (await rowOf(kot))?.status === "failed");
  const retried = await retryPrintJob({ id: kot, nowMs: nowMs + 11 });
  row = await rowOf(kot);
  check("(w) Print again requeues it with REPRINT (it may have printed), counters reset", retried.applied && row?.status === "queued" && JSON.stringify(row?.labels) === '["REPRINT"]' && row?.attempts === 0 && row?.uncertainAttempts === 0);

  // Spec §7.1: clearing the host dismisses every unresolved job, but never a leased one (its writer
  // may be printing it; the lease expires in 90 s). Session 1A final-review fix I1.
```

Replace it with:

```ts
  check("(w) a permanent error fails the job at once", (await rowOf(kot))?.status === "failed");
  const retried = await retryPrintJob({ id: kot, nowMs: nowMs + 11 });
  row = await rowOf(kot);
  // Session 1C: one staff tap is one more attempt (uncertainAttempts 1 of the 2 allowed).
  check("(w) Print again requeues it with REPRINT (it may have printed) as one more attempt", retried.applied && row?.status === "queued" && JSON.stringify(row?.labels) === '["REPRINT"]' && row?.attempts === 0 && row?.uncertainAttempts === 1);

  // Spec §7.1: clearing the host dismisses every unresolved job, but never a leased one (its writer
  // may be printing it; the lease expires in 90 s). Session 1A final-review fix I1.
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
import { legQ, legR, legS, legT, legU } from "./print-host-live/lifecycle";
import { legV, legW, legX } from "./print-host-live/lifecycle-actions";
import { legAA, legAB, legAC, legY, legZ } from "./print-host-live/order-jobs";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

Replace it with:

```ts
import { legQ, legR, legS, legT, legU } from "./print-host-live/lifecycle";
import { legV, legW, legX } from "./print-host-live/lifecycle-actions";
import { legAA, legAB, legAC, legY, legZ } from "./print-host-live/order-jobs";
import { legAD, legAE } from "./print-host-live/agent";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
    await legAB(Date.now());
    // Session 1B final review I1: the repair reads past a rush.
    await legAC(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

Replace it with:

```ts
    await legAB(Date.now());
    // Session 1B final review I1: the repair reads past a rush.
    await legAC(Date.now());
    // Phase 1 Session 1C legs (the owner's two-attempt rule; the job-aware self-order lane).
    await legAD(Date.now());
    await legAE(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

- [ ] **Step 2: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo TSC_OK && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | tail -3`
Expected: `TSC_OK`; `199 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/scripts/print-host-live/agent.ts apps/cafe/scripts/print-host-live/lifecycle-actions.ts apps/cafe/scripts/verify-print-host-live.ts
git commit -m "test(print): live legs ad-ae: the two-attempt rule and the job-aware self-order lane"
```

---

### Task C5b: the go-live-dl pin skips where its planning file is absent (owner decision, 2026-10-03)

The one known cafe failure since Session 1A is `lib/go-live-dl.test.ts`'s pin on `.claude/plan/v2/_research/cb-dl2-decisions.md`. That file sits under the git-ignored `.claude/` folder (`.gitignore`, `/.claude/`), so it exists only on the PC that wrote it; everywhere else the test fails with ENOENT. No credential is involved. The owner's decision after the gate: skip it, with its reason, where the file is absent; it still runs wherever the file is (the owner checks it on their own PC). Pre-validated on the golden copy and on a fresh clone merged with `origin/main` at `c05330a`.

**Files:** Modify `apps/cafe/lib/go-live-dl.test.ts`.

- [ ] **Step 1: The skip**

In `apps/cafe/lib/go-live-dl.test.ts`, find:

```ts
import { readFileSync } from "node:fs";
```

Replace it with:

```ts
import { existsSync, readFileSync } from "node:fs";
```

In `apps/cafe/lib/go-live-dl.test.ts`, find:

```ts
test("PIN: cb-dl2-decisions.md D-C's archive-path clause names the OS temp directory, not <cwd>, and says the path is printed", () => {
  const decisionsPath = path.join(REPO_ROOT, ".claude/plan/v2/_research/cb-dl2-decisions.md");
```

Replace it with:

```ts
// The decisions file lives under the git-ignored .claude/ folder, so it exists only on the PC that wrote
// it. Where it is absent the pin is skipped with that reason instead of failing with ENOENT; it still runs
// wherever the file is.
const CB_DL2_DECISIONS = path.join(REPO_ROOT, ".claude/plan/v2/_research/cb-dl2-decisions.md");
const CB_DL2_DECISIONS_ABSENT = "the git-ignored planning file .claude/plan/v2/_research/cb-dl2-decisions.md is not on this PC";

test("PIN: cb-dl2-decisions.md D-C's archive-path clause names the OS temp directory, not <cwd>, and says the path is printed", { skip: existsSync(CB_DL2_DECISIONS) ? false : CB_DL2_DECISIONS_ABSENT }, () => {
  const decisionsPath = CB_DL2_DECISIONS;
```

- [ ] **Step 2: Run**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/go-live-dl.test.ts 2>&1 | grep -E "^# (tests|pass|fail|skipped)|# SKIP"; npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 24`, `# pass 23`, `# fail 0`, `# skipped 1`, and the `# SKIP` line naming the absent file; `TSC_OK`.

- [ ] **Step 3: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/go-live-dl.test.ts
git commit -m "test(cafe): the go-live-dl decisions pin skips, with its reason, where the git-ignored planning file is absent"
```

From here on the cafe totals read **0 fail, 1 skipped** where earlier sessions read 1 fail.

---

### Task C6: full verification, builds, the E2E exit check, Results

**Files:** Modify this plan (fill in **Session 1C Results**) and the memory file `printing-redesign-2026-10.md`.

- [ ] **Step 1: Every suite**

```bash
cd /d/kd/lucifer/packages/shared && npm test 2>&1 | grep -E "^# (tests|pass|fail)"; npx tsc --noEmit -p .
cd /d/kd/lucifer/apps/cafe && npm test 2>&1 | grep -E "^# (tests|pass|fail)|^not ok"; npx tsc --noEmit; npm run lint 2>&1 | tail -4
cd /d/kd/lucifer/apps/hub && npx tsc --noEmit && echo HUB_TSC_OK
cd /d/kd/lucifer/apps/mobile && npx tsc --noEmit && npm run lint && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run test:app 2>&1 | grep -E "^Tests:"
cd /d/kd/lucifer/apps/desktop && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
cd /d/kd/lucifer && npm run test:print-tools 2>&1 | grep -E "^# (tests|pass|fail)"
cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | tail -3
```

Expected:
- shared: 635/635, tsc 0.
- cafe: **4131 tests, 4130 pass, 0 fail, 1 skipped**: Session 1C's start merge of `origin/main` at `c05330a` adds 40 tests, and the skip is `go-live-dl`'s planning-file pin (Task C5b). Without the merge it is 4091 / 4090 / 0 / 1. Account for any other difference in Results.
- cafe: tsc 0; lint 0 errors and the 2 old warnings. Hub: `HUB_TSC_OK` (`apiSend`'s new option is backward compatible).
- mobile: tsc 0, lint 0, node 114/114, Jest 3/3 (untouched). desktop: 191/191 (untouched). print tools: 7/7.
- live legs: `199 passed, 0 failed` (Session 1B's 183, plus (w)'s one new check, (ad) 10 and (ae) 5).

- [ ] **Step 2: The Next production build**

Run: `cd /d/kd/lucifer/apps/cafe && npm run build 2>&1 | tail -15`
Expected: success, 123 routes (1C adds no route).

- [ ] **Step 3: Both APKs, x86_64 first** (Session 1A's Task 10 Step 3 commands, `GRADLE_USER_HOME='D:\gradle-home'`)

Expected: `BUILD SUCCESSFUL` twice, each APK holding only its own ABI. 1C changes no app code, so the hashes should equal Session 1B's (`fc4181e4…`, `9f89cd9a…`, `f3f62149…`). Record them either way.

- [ ] **Step 4: The E2E exit check** (local POS + emulator app + fake printer; a failure here is a finding, never faked)

Bring the harness up exactly as Session 1B's Task B8 Step 4, with a fresh database `pos_scratch_e2e_1c` and its own script-generated env file (`secrets`; never printed or committed). Sign in with TAB to the password field and check the focus in a uiautomator dump before typing the secret. Choose the network printer `10.0.2.2` : `9100`. Use a scratchpad state script (projection without `payload`) that prints, per job: kind, status, epoch, attempts, uncertainAttempts, labels, lastError, the log events, printedAt. Count only the fake printer's `bytes > 0` jobs.

1. **No host — a KOT prints through the queue, once.** New order on a table, one item, Send to Kitchen. Expected: one job, `created → leased → printed`, `printedAt` set, `uncertainAttempts 0`, no label; exactly one new job at the fake printer. The `printdevices` collection stays empty (with no host nothing polls the wake: R6).
2. **The owner's rule — no attempt while the printer is off.** Stop the fake printer (by PID). Send a KOT. Expected: one lease and one `failed(not sent: …)` log entry, the job `queued`, `uncertainAttempts 0`, no label. Two minutes later: still `epoch 1`, `attempts 1` (no lease while the printer is off). Start the fake printer again. Expected within about a minute: the app's reconnect makes the printer ready, and the slip prints once, unlabelled, `printed`.
3. **Host mode — Pay Now prints the KOT, then the bill.** Printer panel → "Print all slips on this device". Pay Now (Cash) on a new table. Expected: two jobs for the host, KOT before bill, both `printed`; one `printdevices` row (`shell: android`) from the host's wake POST.
4. **A lost ack — the REPRINT copy (the maybe path).** With the host designated, a scratchpad script (cookie minted from the env, as 1B's `e2e-header.ts`; nothing secret printed) creates a KOT through `POST /api/orders` with the agent headers and `x-pos-device-id: e2e-script-device`, then at once leases it through `POST /api/print-jobs/lease` **as the host's device id** (read from the `printhosts` row) with its own `tabId`, and never acks. Expected: the app does not print it while that lease lives; about 90 s later the lease expires, the job is queued again with `REPRINT` (`uncertainAttempts 1`), and the app prints one copy whose bytes are larger than a plain KOT's (the banner). Optional: decode the job's `GS v 0` raster to a PNG in the scratchpad and look at the banner.
5. **The same for a bill — the cashier's prompt, never paper.** As in 4, but a Pay Now order's bill job: lease it as the host and drop it. Expected after about 90 s: `needs-confirm`, `uncertainAttempts 1`, and no new paper (1D's panel will ask the cashier).
6. **A self-order KOT is one job (R4, job-aware lane).** With the host designated, create a QR self-order that the auto-accept accepts (a scratchpad script built on `scripts/verify-self-order-alert-live.ts`'s request seeding plus `acceptOrderRequest` with the `SELF_ORDER_RECEIVER` actor, or the diner page with the cafe's auto-accept on). Expected: within one pulse the host's lane claims it, the claim makes one KOT job (`queuedBy: "Self-order"`), and it prints exactly once; the request's `kotPrintedAt` is set.
7. **Known limitation, recorded, not a failure:** on the Android app's TCP lane, `--drop-after 2000` reads as printed (gate finding G5): the whole raster is buffered before the printer cuts the connection, and a reset after the bytes were flushed is treated as success (`TcpTransport.kt`). The maybe path is proven by 4 and 5; detecting a cut on LAN needs the post-job `DLE EOT` check (spec §9.6, §10, Phase 3).
8. Clean up: `adb reverse --remove-all`; stop the POS and the fake printer by PID (`Stop-Process`, matched by command line); `pm clear com.possoftware.pos`; `adb emu kill`. Leave `pos_scratch_e2e_1c` and its env file for 1D and say so in Results.

`adb logcat -b crash` must stay empty for the whole step.

- [ ] **Step 5: Results, memory, commit, push**

Fill in **Session 1C Results** below: every command and its totals; each changed existing pin and why (the list in Tasks C0, C2 and C4); the live-leg count; the APK paths, sizes and hashes; the E2E findings with screenshot paths; every deviation and why; open issues. Update the memory file `printing-redesign-2026-10.md`: Session 1C done with its last commit, and the next step (the 1C review gate).

```bash
cd /d/kd/lucifer
git add docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md
git commit -m "docs(print): Phase 1 Session 1C results"
git log --oneline -10
GIT_TERMINAL_PROMPT=0 git push origin feat/printing-reliability 2>&1 | sed 's/github_pat_[A-Za-z0-9_]*/[REDACTED]/g'
```

Push only with the repo's token credential (check `git config --local --get-all credential.helper` first: an empty line, then the `store --file=…` line). If authentication fails, stop and tell the owner. Do **not** merge, push `main`, or start Session 1D. Report to the owner in Hinglish, then stop.

---

## Session 1C Results (filled in by the implementer)

Executed on 2026-10-03 with superpowers:executing-plans, inline. Every block of Tasks C0–C5 and C5b was applied verbatim by a scratchpad script (Create / find+Replace / Replace-the-whole, each find unique at its point of application), never retyped. A dry run of all 134 blocks against the merged tree passed before C0. Nothing was deployed anywhere: all checks ran locally (the local POS, the emulator, the fake printer, local mongod).

### Commits (`851c454..HEAD`)

| Commit | What |
|---|---|
| `5b1a6e6` | Step 0: `git merge --no-ff origin/main` (`c05330a`: `ebffdb5` Settings leave-guard, `c05330a` Settings > Kitchen ticket). A clean auto-merge. |
| `16c76b6` | C0: the owner's two-attempt rule |
| `639d0b0` | C1: a print failure says whether anything reached the printer |
| `94fc0a2` | C2: the server half (job-aware claim, ref status, M-a, M-e, M-f, the pulse's jobs for me) |
| `eaefec2` | C3: the agent core, its wire and the budget pins |
| `7b97945` | C4: every device prints through the agent |
| `9860c02` | C5: live legs ad–ae |
| `cb83487` | C5b: the go-live-dl pin skips where its planning file is absent |
| `fec4fd0` | Final-review fix pass: I1 and I2 (below) |
| (this commit) | Results |

### Step 0 (the merged tree, before C0)

shared 629/629, tsc 0; cafe **4100 tests, 4099 pass, 1 fail** (only the known `go-live-dl` ENOENT); cafe tsc 0; lint 0 errors and the 2 old warnings (`masters-blob.test.ts`). As expected.

### Per-task RED → GREEN (every Expected line compared; all matched)

| Task | RED (seen) | GREEN (seen) |
|---|---|---|
| C0 | `does not provide an export named 'PRINT_MAX_PAPER_ATTEMPTS'`; 1/0/1 | print-lifecycle 24/24; shared 630/630; shared tsc 0; cafe tsc 0 |
| C1 | `Cannot find module '@/lib/print-write-outcome'`; 1/0/1 | 5/5; cafe tsc 0 |
| C2 | `Cannot find module '@/lib/print-agent-server'`; 1/0/1 | the five files 153/153; cafe tsc 0; shared tsc 0 |
| C3 | budget: `does not provide an export named 'PRINT_AGENT_REFUSED_RECHECK_MS'` 1/0/1; agent: `Cannot find module '@/lib/print-agent-wake'` 1/0/1 | print-budget 13/13; shared 635/635, tsc 0; the five cafe files 84/84; cafe tsc 0; Hub tsc 0 |
| C4 | `Cannot find module '@/lib/print-agent-calls'`; **91/77/14** | the ten files 180/180; cafe tsc 0; lint 0 errors + 2 old warnings; cafe `npm test` **4131 tests, 4130 pass, 1 fail** (the known ENOENT). The plan's 4091/4090/1 was captured before the merge; the merge adds 40 tests, so 4131 is the expected number. |
| C5 | — (legs only) | cafe tsc 0; live legs `199 passed, 0 failed` |
| C5b | — (skip only) | go-live-dl 24 tests, 23 pass, 0 fail, 1 skipped (`# SKIP the git-ignored planning file .claude/plan/v2/_research/cb-dl2-decisions.md is not on this PC`); cafe tsc 0 |

### Task C6 Step 1: every suite

At `cb83487` (every plan task done, before the fix pass):

| Suite | Result | Expected |
|---|---|---|
| shared `npm test`; tsc | 635/635; 0 | same |
| cafe `npm test` | **4131 tests, 4130 pass, 0 fail, 1 skipped** | same |
| cafe tsc; lint | 0; 0 errors, 2 old warnings | same |
| Hub tsc | `HUB_TSC_OK` | same |
| mobile tsc; lint; `npm test`; `test:app` | 0; 0; 114/114; Jest 3/3 | same |
| desktop `npm test` | 191/191 | same |
| `npm run test:print-tools` | 7/7 | same |
| live legs (`pos_scratch_print_host`) | `199 passed, 0 failed` | same |

At the final code HEAD `fec4fd0` (after the fix pass, which touches only 5 cafe files): cafe **4134 tests, 4133 pass, 0 fail, 1 skipped** (+3: the fix pass's tests); tsc 0; lint 0 errors and the 2 old warnings; live legs `199 passed, 0 failed`. shared, Hub, mobile, desktop and print tools are untouched by the fix pass, so their `cb83487` results stand.

### Changed existing pins (each follows a deliberate change in this plan)

- `packages/shared/src/print-lifecycle.test.ts` (C0, the owner's two-attempt rule): "lease: refused … when over limits" (now `uncertainAttempts: PRINT_MAX_PAPER_ATTEMPTS`, plus "50 refused leases still lease"); "limits: …" (rewritten: the second maybe fails; a refusal never counts); "needs-confirm, print again …" (`uncertainAttempts: 1`, the bill's one retry); "failed, print again …" renamed "failed, retry …" (`uncertainAttempts: 1`: one tap, one try).
- `apps/cafe/lib/print-order-jobs.test.ts` (C2): the `withPrintJobs` fixture gains `status` (M-d). (C4): the 1B C1 pin's premise (the host lane is now job-aware).
- `apps/cafe/lib/print-host-paths.test.ts` (C4): PIN (D) now pins `PrintHostDrain` running the agent under the drain lock.
- `apps/cafe/lib/printer/print-gating-paths.test.ts` (C4): the drain pin's needles.
- `apps/cafe/lib/print-wake.test.ts` (C4): the `usePrintHostWake(` inventory and its wiring pin (the GET wake hook stays, uncalled, for one release).
- `apps/cafe/lib/settle-flow-paths.test.ts` (C4): P2 (`printsBill`).
- `apps/cafe/scripts/print-host-live/lifecycle-actions.ts` leg (w) (C5): the cashier's copy is the bill's one retry; a Retry is one more attempt.
- The fix pass changed **no** existing pin. `print-gating-fx-paths.test.ts`'s bridge pins (the `abandon` shape, the `settle` first line, ≤ 250 lines) and the late-completion pins (grace 30 s, ordered expiry, no imports) all still hold.

### Step 2: the Next production build

`npm run build`: success at `cb83487` and again at `fec4fd0`, **123 routes** both times, including every `/api/print-jobs` route and `/api/order-requests/[id]/kot-claim` and `/pulse`. 1C adds no route.

### Step 3: APKs (x86_64 first, then ARM; `GRADLE_USER_HOME='D:\gradle-home'`)

Both builds reported `BUILD SUCCESSFUL` (2 m 24 s, then 1 m 3 s). Each APK holds only its own ABI. **All three are byte-identical to Session 1B's** (1C touches no app code).

| APK | Path | Size | SHA-256 |
|---|---|---|---|
| Emulator only (x86_64) | `<scratchpad>/pos-emulator-x86_64-release.apk` | 7,407,761 B | `fc4181e4f20799576277c7be312316d34d46db23b286bad6b13fec1cad5f13d3` |
| Client, arm64-v8a | `apps/mobile/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk` | 7,276,038 B | `9f89cd9a172b2ab8d5b72872bca947c44ae3c7c74c3a33dfc118e9c00e180ff7` |
| Client, armeabi-v7a | `apps/mobile/android/app/build/outputs/apk/release/app-armeabi-v7a-release.apk` | 6,683,872 B | `f3f6214982c9122dbc7c28f415d7a478a8aef392b834bf8213cb909c73f426cc` |

### Step 4: the E2E exit check (local POS + emulator app + fake printer). Passed.

AVD `Pixel_7_API_33`, WebView 109.0.5414.123, `-memory 4096 -no-snapshot -no-boot-anim`, booted in about 30 s. Screenshots and decoded rasters are in `<scratchpad>/shots/`. Bring-up: ports 3100 and 9100 checked free; `<scratchpad>/e2e.env` (database `pos_scratch_e2e_1c`, checked absent first) written by `<scratchpad>/make-env.py` with `secrets`, never printed or committed; `seed-admin.ts`, `seed-tables.ts` (T-1…T-8), `seed-menu.ts` (4 categories, 8 products); `next start -p 3100` from the Step 2 build, `/login` 200; fake printer on `127.0.0.1:9100`; `adb reverse tcp:3100 tcp:3100`; `pm clear`; address `http://localhost:3100`; username, then TAB, and a uiautomator dump showed the focused EditText with `password="true"` before `<scratchpad>/type-secret.py` typed the secret (it re-checks the focus itself and prints only the length) (`1c-01-login.png`, `1c-02-signed-in.png`); printer panel → network printer `10.0.2.2` : `9100` → "Network printer 10.0.2.2 is connected." (`1c-03-network-printer.png`; the 0-byte connect probe). State read with `<scratchpad>/e2e-state.ts` (projection without `payload`). Only `bytes > 0` printer jobs counted.

**Run 1, on `cb83487`'s build:**
1. **No host — a KOT through the queue, once. Pass.** T-1, Masala Chai, Send to Kitchen at 00:36:12 (UTC): one job `created → leased → printed`, `epoch 1`, `uncertainAttempts 0`, no label, `printedAt` set, about 3 s; exactly one printer job (40,494 B). `printdevices` empty (R6) (`1c-04-cart-t1.png`, `1c-05-kot-sent.png`).
2. **No attempt while the printer is off. Pass.** Fake printer stopped by PID; T-2 KOT at 00:37:09: one lease and one `failed(not sent: The printer is not connected. …)`, the job `queued`, `uncertainAttempts 0`, no label (`1c-06-kot-printer-off.png`). At 00:39:39 (2.5 min): still `epoch 1`, `attempts 1`. Printer started at 00:39:52; the app's reconnect probe at 00:40:09, and the slip printed once, unlabelled (40,494 B), `epoch 2`, `uncertainAttempts 0`, about 18 s after the printer came back (`1c-07-printer-back.png`).
3. **Host mode — Pay Now prints the KOT, then the bill. Pass.** "Print all slips on this device" → "This device prints all slips." (`1c-08-host-designated.png`; Android's background prompt did not appear). Pay Now (Cash) on T-3: KOT at 00:41:31.4 (40,494 B), then the bill at 00:41:32.1 (36,966 B), both `created → leased → printed`; one `printdevices` row, `shell: android`, from the host's wake POST (`1c-09-paynow-cash.png`, `1c-10-paynow-done.png`).
4. **A lost ack — the REPRINT copy. Pass.** `<scratchpad>/e2e-lostack.ts kot` (cookie minted from the env as 1B's `e2e-header.ts`; nothing secret printed) created a KOT through `POST /api/orders` with the agent headers and `x-pos-device-id: e2e-script-device` (201, `printJobs` named one queued KOT for the host), then at once leased it as the host's device id with its own `tabId` (`epoch 1`, 00:41:55) and never acked. Nothing printed while that lease lived (checked at 00:43:00). At 00:43:29: `expired(lease expired: may have printed)` → `leased` → `printed`, `labels: ["REPRINT"]`, `uncertainAttempts 1`, one copy of **46,110 B** (a plain KOT is 40,494 B). The decoded raster shows the black REPRINT banner above "KITCHEN ORDER #4" (`1c-raster-reprint.png`; plain: `1c-raster-plain-kot.png`; `1c-11-reprint-printed.png`).
5. **The same for a bill — the cashier's prompt, never paper. Pass.** `e2e-lostack.ts bill <order>` settled item 4's open order through `POST /api/orders/[id]/settle` with the agent and bill headers (200, one queued bill for the host) and at once leased the bill as the host (00:44:02), never acking. At 00:45:35: `needs-confirm`, `uncertainAttempts 1`, log `created, leased, expired(lease expired: may have printed)`, and no new paper (deviation 4).
6. **A self-order KOT is one job (R4, job-aware lane). Pass.** `<scratchpad>/e2e-selforder.ts create` seeded a priced table request exactly as the diner intake does (`buildRequestDoc` + `priceRequestItems`) and accepted it with the `SELF_ORDER_RECEIVER` actor, as the public auto-accept does: `accepted`, `acceptedKotRound 1`, **no job** made by the accept. About 4 s later (00:45:51) the host's lane had claimed it: `kotPrintedAt` set, one KOT job `queuedBy: "Self-order"`, today's key, `created → leased → printed`, printed exactly once (40,494 B) (`1c-12-selforder-printed.png`).
7. **G5, the known TCP limit — recorded, not a failure.** With `--drop-after 2000` (host mode, T-5 KOT): the first attempt's cut **was** detected (`failed(The printer stopped answering. … may already have printed …)`, a "maybe"), so the job came back `REPRINT`, `uncertainAttempts 1`; the REPRINT copy was cut at 2,000 bytes too, but read as **printed** (`printed`, `epoch 2`). So on Android TCP a cut mid-slip is detected only sometimes (it depends on whether the reset arrives before the app's write is flushed); when it is missed the slip reads as printed. The maybe path itself is proven by items 4 and 5; the fix is the post-job `DLE EOT` check (spec §9.6, §10, Phase 3). No Kotlin was changed.

**Run 2, on the fixed `fec4fd0` build** (the fix pass changed client code, so the POS was rebuilt and items 1–4 and 6 were run again; item 5's lifecycle is server-side and unchanged): Pay Now on T-6 printed the KOT (40,494 B) then the bill (36,966 B); a lost ack (`ORD-…-008`, leased by the script at 00:55:36) expired into one REPRINT copy (46,110 B, `uncertainAttempts 1`) at 00:57:11; a self-order (T-6) was claimed in about 4 s and printed once, `queuedBy: "Self-order"`; then "Stop printing here" → "Each device prints its own slips", and with no host a T-7 KOT printed once (`created → leased → printed`); with the printer stopped a T-8 KOT got one lease and one `failed(not sent: …)`, and was still `epoch 1, attempts 1` at 2 min, across an emulator restart and an app cold start (deviation 6); the printer back at 01:02:13 → printed once, unlabelled, `epoch 2`, `uncertainAttempts 0`, at 01:02:36 (`1c-13-fix-printer-back.png`). All passed.

8. **Cleanup.** `adb reverse --remove-all`; the POS and the fake printer stopped by PID with `Stop-Process` (command lines checked first; ports 3100 and 9100 confirmed free); `pm clear com.possoftware.pos`; `adb emu kill`.
   - **Left for 1D:** `pos_scratch_e2e_1c` holds `e2eadmin`, 8 tables, 4 categories and 8 products, 11 orders, 14 PrintJobs (13 `printed`, 1 bill `needs-confirm`: item 5's), 2 OrderRequests, 1 `printdevices` row, no PrintHost (cleared in run 2). The env file stays at `<scratchpad>/e2e.env` (this session's scratchpad, `4de5cd03…`); its scripts `e2e-state.ts`, `e2e-lostack.ts`, `e2e-selforder.ts`, `raster2png.py`, `type-secret.py`, `ui.py` are there too.

**`adb logcat -b crash`:** the app never crashed; the buffer stayed empty from the app's first launch to the end of both runs. Before the app was first launched, the emulator's own Bluetooth stack crash-looped at boot (7 entries, all `com.google.android.bluetooth`, `bt_stack_manage` SIGABRT; saved to `<scratchpad>/logs/crash-at-boot.log`, then the buffer was cleared) and showed "Bluetooth keeps stopping", dismissed with Close app (`1c-00-bt-dialog.png`). The second boot logged nothing.

### Final whole-branch review (fresh reviewer subagent, Opus, `5b1a6e6..cb83487`, read-only)

0 Critical, 3 Important, 5 Minor. Each was checked against the code before grading.

- **I1 (fixed, `fec4fd0`).** When the bridge's watchdog gave a slip up and its 30 s grace ran out with no report, `settle(null)` told the slip's caller `{ ok: true }`, so the agent acked **printed** for a slip that may never have reached paper (the agent's own 140 s deadline was never reached first). The late-completion guard now reports `graceRanOut()`, and the bridge finishes such a slip as failed (`PRINT_HOST_PRINT_FAILED_MESSAGE`, which `printWriteOutcomeOf` reads as "maybe": a KOT retries once with REPRINT, a bill asks the cashier). A late completion inside the grace still reports what really happened. Test: `print-host-bridge-late.test.ts` "Session 1C: a slip that never reports …", RED (`'printed'`) → GREEN, through the real hook.
- **I2 (fixed, `fec4fd0`).** (a) `kick()` while a cycle ran was dropped: if that cycle's lease read the line before a new job was in it, the job waited for the next poll (up to 60 s on the host, 20 s with no host). The kick is now remembered and runs once after the cycle. (b) A flush read the pending list once, so a printed ack kept while an earlier flush was on the wire waited for the 5 s retry, and the next lease found its own job still leased. The flush now re-reads until every entry was tried once. Tests: `print-agent.test.ts` "a kick that lands while a lease is on the wire …" and "a printed ack kept while an earlier flush is on the wire …", both RED → GREEN. Budget: a remembered kick adds at most one lease per cycle, and only after a real signal.
- **I3 (ruled, not fixed; for the owner and the 1C review gate).** A refusal caused by the slip itself (`RASTER_FAILED_MESSAGE`, a render timeout or null canvas; `PRINT_HOST_EOD_TIMEOUT_MESSAGE`) is `sent:"no"`, and since C0 a refusal never counts, so a slip that can never be drawn holds its device's line (the head in backoff holds it) until it goes stale after 30 minutes. Fixing it changes the owner's explicit rule ("a refusal never counts") and needs a server-side counter (lifecycle, sweep, live legs), so it goes to the gate together with 1D's panel (Clear / Retry).
- **Minors (deferred to the gate):** M4 a lost *failed* ack is never retried, so a refusal can expire into a counted "maybe" (a labelled REPRINT / a cashier prompt); M5 if `localStorage` refuses the write, the printed ack is never sent (`sendPending` sends only what `readPending` returns; the comment at `print-agent.ts` "the ack is still sent now" is wrong); M6 after a reload the first lease races the mount flush (an expired lease can be re-leased before the late ack lands: a needless labelled REPRINT); M7 a flapping printer restarts the host's wake effect on each flap (bounded by the daily cap); M8 spec §7 still has a bullet saying the cashier's print again resets the counters (ruled: `uncertainAttempts = 1`).
- Declined to judge (reviewer): Windows "no" cases (Phase 3); `ackAnswered` clearing on 401/403/429 (the 1A M3 ruling); no-host devices without a printer (spec §6.6, 1D's panel); Web Serial/BLE mid-write classification (Phase 0 F0.1); a two-tab race on the pending-ack store; the browser print dialog lane; the live-leg scripts and the budget arithmetic were not read line by line.

### Deviations from the plan, each with its reason

1. **The ledger lives in the session scratchpad**, not `.superpowers/sdd/`: the session rules say to leave that folder alone and use no skill script that writes there.
2. **Commit messages** are the plan's, plus the `Co-Authored-By` trailer this environment requires.
3. **One commit beyond the plan, `fec4fd0`**: the final review's I1 and I2, each with a test that failed first. The cafe total is therefore 4134 / 4133 / 0 / 1 at the final HEAD, not the plan's 4131.
4. **E2E item 5 used the POS settle of item 4's open order** (bill header) instead of a Pay Now order. A Pay Now order's KOT is the head of the host's line, so the bill can be leased first only by acking that KOT with no paper; the settle creates the bill as the only job. The bill's lifecycle is the same.
5. **The E2E ran twice**: on `cb83487`'s build, then items 1–4 and 6 again on the fixed `fec4fd0` build.
6. **The emulator was killed mid-run** (at about 01:00 UTC, during run 2's item 2) by this session's 30-minute limit on a background command. It was restarted with a 2-hour limit. Item 2 continued across the restart and the app's cold start, and still made no lease while the printer was off.
7. **`lib/print-agent.ts` is 306 lines** after the fix pass (297 before), slightly over the "~300 lines" guideline.
8. **`printdevices` after run 2's host phase:** the row the host's wake created stays, and with no host each lease touches it (`touchPrintDevice`, as designed). Run 1's item 1, before any host, saw the collection empty, as the plan expects.

### Open issues

- **I3** (above): needs the owner's ruling at the 1C gate, together with 1D's panel.
- **Minors M4–M8** (above), for the 1C gate.
- **G5** (item 7): Android TCP detects a cut mid-slip only sometimes; a missed cut reads as printed. Phase 3 (`DLE EOT`).
- 1C still must not reach a cafe without 1D (the waiting-slips panel, the pulse sweep, readback, the alarm). Nothing was deployed.

---

## Session 1C review (gate, 2026-10-03)

**Verdict: PASS.** Session 1C (`851c454..32f29ca`: the merge `5b1a6e6` of `origin/main` at `c05330a`, Tasks C0–C5b applied verbatim as `16c76b6..cb83487`, the final-review fix `fec4fd0`, and the Results commit `32f29ca`) is complete and correct for its scope. The gate's fresh review found no Critical or Important defect in the code that landed, `fec4fd0` included. Its one new minor (F1), the owner's I3 decision and the first review's minors M4–M6 are fixed in Session 1D's Task D1; M7 and M8 are ruled below.

**How this gate stayed independent.** It ran in the same session that implemented 1C, because the owner asked for the review and the next prompt at once and could not test on their side. So the code was re-read by a fresh-context reviewer subagent (Opus, read-only) that had not written it, every suite and build was re-run on the merged tree, and Session 1D's code was validated on a fresh clone and on the emulator.

Nothing below was taken from the Results section; each line was re-run at the gate.

| Check | Re-run at the gate (`5945f74`, after merging `origin/main` at `22e9999`) | Session 1C Results |
|---|---|---|
| shared `npm test`; `tsc` | 635/635; 0 | same |
| cafe `npm test` | 4153 tests, 4152 pass, 0 fail, 1 skipped (+19: the merge's own tests over 1C's 4134) | 4134/4133/0/1 |
| cafe `tsc`; `npm run lint` | 0; 0 errors and the 2 old warnings | same |
| Hub `tsc` | 0 | same |
| mobile `tsc`; lint; `npm test`; `test:app` | 0; 0; 114/114; Jest 3/3 | same |
| desktop `npm test` | 191/191 | same |
| `npm run test:print-tools` | 7/7 | same |
| live legs (local mongod) | `199 passed, 0 failed` | same |
| Next build | success, 123 routes | same |
| APKs | `git diff 0158ef3..HEAD -- apps/mobile apps/desktop` is empty, so 1C's builds of the same day stand: x86_64 `fc4181e4…`, arm64-v8a `9f89cd9a…`, armeabi-v7a `f3f62149…` | byte-identical to 1B |

**The merge `5945f74`.** A clean `--no-ff` auto-merge of `22e9999` (the owner's Settings > QR ordering: 8 cafe files and one `testChain` entry). It touches no print file.

**Code read (the fresh reviewer, Opus).**
- **`fec4fd0` (1C's I1/I2 fix):** no Critical or Important defect. `graceRanOut()` cannot stay set for a later slip (its only setter is the grace timer, which settles at once and reads it); `sendPending`'s re-read loop is bounded (each `id:epoch` once per flush; expired and refused writes also end it); `kickedWhileRunning` cannot storm (one kick per cycle, every cycle makes a request); `stop()` and StrictMode are safe.
- **F1 (minor, new):** `kickedWhileRunning` also remembered the bridge freeing up from the agent's own slip while its failed ack was on the wire, so every maybe with a `nextAttemptAt` cost one empty lease (about 120 a day at the 10 % retry share). **F2:** the 1C I2(b) test pinned the M6 race as wanted behaviour.
- **Live legs:** (ad) is sound; (ae)'s cancelled case checked only `!claimed`; (w)'s Retry check is weak locally but (ad) covers it.
- **Budget pins:** the arithmetic is right, but two request sources were not summed: one trailing empty lease after every burst (Phase 1's busy day: 750 slips × 2 × 1.1 + 750 bursts = 2,400 ≤ the 2,640 estimate), and the refusal re-check, which is bounded per slip, not per day (a printer that reports ready but keeps refusing: 2 requests per 30 s = 2,880 per device-day). **Phase 2 note:** with stations (1,200 slips, about 1,200 bursts) the normal day reaches the 6,000 ceiling exactly and the worst case 18,240 > 18,000, so Phase 2 must recount (for example, one lease per round).
- **M4, M5, M6 confirmed** with traced scenarios on a scratch copy. **I3:** the server already fails a `sent:"no", permanent:true` ack without counting an attempt, so the owner's rule is client-only.

**Pre-validating 1D end to end** (the golden build of the POS on `localhost:3100`, the branch APK on the emulator (WebView 109), the fake printer on 9100, database `pos_scratch_e2e_1c` (1C's E2E data); screenshots `1d-01…13` and `1d-raster-duplicate.png` in this session's scratchpad `4de5cd03…/scratchpad/shots/`):
1. A bill 1C's E2E had left in `needs-confirm` showed at once: the printer button "1 slip waiting — open printer setup" with a red 1, and the sheet opened on "Slips waiting · Check the bill (1) · Bill · ORD-20261003-004 · 3 h 28 min · It may already have printed. Check the printer." with Print again, It printed and Clear. It printed → `printed`; the section left.
2. Host mode, the printer stopped, KOT round 2 · T-1 sent at 04:15:05 (UTC): one lease and one `failed(not sent: …)`, `uncertainAttempts 0`. At 04:15:40 the notice "KOT round 2 · T-1 has not printed yet." and the count 1; the sheet: "Waiting for the printer · 1 min · The printer is off or not connected." Print now → "It prints by itself as soon as the printer is ready." The printer back at 04:16:40 → printed once (40,494 B) at 04:16:56; the section, the count and the notice were gone by 04:17:07.
3. A failed KOT (set as two expired leases leave it) → the host's notice "… could not print."; the sheet: "Couldn't print · 2 min · Tried twice. Check the printer, then retry." Retry at 04:20:06 → one REPRINT copy (46,110 B) at 04:20:07, `printed`, `uncertainAttempts 1`, log `retried(print again)`, `printed`; the row left at 04:20:29.
4. A bill's lost ack (settled with the bill header, leased as the host at 04:20:42, never acked) → `needs-confirm` and the host's notice "Bill · ORD-20261003-012 may not have printed." at 04:22:28. Print again at 04:24:20 → one DUPLICATE copy (41,718 B; the decoded raster shows the DUPLICATE banner) at 04:24:21, `confirmed(print again: Admin)`, `printed`.
5. No host: a job of `e2e-script-device`, leased at 04:25:17 and never acked, which no device leases again → the pulse sweep alone expired it (`queued`, REPRINT, `expired(lease expired: may have printed)` by 04:27:35). The emulator's sheet listed it (another device's slip), and the script, as a second device, cleared it (`dismiss` → 200); it left the emulator's sheet within one pulse.
6. **Two UI findings, fixed in Task D3 before the section was generated:** (a) on a phone the notice covered the printer button it pointed at (Sonner's top-right toaster is full width there), so the notice now carries its own **Show** button. Verified on the rebuilt golden POS: KOT round 2 · T-2 at 04:33:54 → the notice with Show at 04:34:39 → Show opened the sheet on its row; the printer back → printed once at 04:35:11, cleared by 04:35:18. (b) a REPRINT row waiting over 20 s said "Printing again", now "Waiting to print again, marked REPRINT."
7. `adb logcat -b crash` held no entry for the app (its PID stayed the same through each run). It held one `UiAutomation` "Bad file descriptor" crash of the `uiautomator dump` tool itself; and on the 1C session's first cold boot the emulator's own Bluetooth stack crash-looped. Both are environment, recorded.
8. Clean-up: `adb reverse --remove-all`; the POS and the fake printer stopped by PID; `pm clear`; `adb emu kill`.

## 1C review gate: rulings (2026-10-03)

Every ruling that changes the spec is written into spec §7.10 ("Rulings at the Session 1C review gate"), and §10 where it applies.

**The owner's decision at this gate.** **I3 → option A:** a refusal caused by the slip itself (it could not be drawn, or its end-of-day figures never loaded) counts, and the second one for a slip while its printer is ready sends it to "Couldn't print", freeing its device's line. A refusal because the printer is off still never counts. Implemented in Task D1 (client-only).

| # | Finding | Ruling |
|---|---|---|
| I1, I2 | 1C's final review; fixed in `fec4fd0` | Re-reviewed at the gate: sound. |
| I3 | A slip that can never be drawn held its device's line until it went stale (30 min) | **Owner: option A.** Task D1. |
| F1 | An empty lease after every maybe | **Fold, D1:** cleared where the answer names `nextAttemptAt`. |
| F2 | The I2(b) test pinned the M6 race | **Fold, D1:** rewritten. |
| M4 | A lost failed ack is never re-sent, so a refusal can expire into a counted maybe | **Fold, D1:** kept and re-sent like a printed ack. The `v1` store key stays (it never shipped). |
| M5 | A refusing storage dropped the printed ack | **Fold, D1:** an in-memory copy. |
| M6 | After a reload the first lease raced the mount flush | **Fold, D1:** each cycle waits for a flush on the wire. |
| M7 | A flapping printer restarts the host's wake effect on each flap | **No change.** Bounded by the device's daily wake cap, only the host polls, and a printer that flaps that often is itself what staff must fix (1D's panel shows its waiting slips). |
| M8 | A stale spec bullet ("print again resets the counters") | **Fixed** in spec §7.10 at this gate. |
| Budget | The trailing empty lease per burst and the per-device refusal re-check were not summed | **Pinned, D1** (2,400 ≤ 2,640; 2,880 per device-day). Phase 2 recounts with stations. |
| Leg (ae) | The cancelled case checked only `!claimed` | **Fold, D4:** asserts `reason === "not-eligible"`. |

**Gate decisions that change the spec's 1D description** (each in spec §7.10 and §10):
- **One attention feed, every device; no `myRecentJobs`.** The panel, the button's count and the alarm read ONE bounded, index-backed read on the existing pulse (≤ 20 rows: `queued` 20 s after it was made, `needs-confirm`, `failed`; 12 h). Each row names its asking and printing device, so no per-device read is added. A second read on the hottest poll was not worth it (Active CPU is the tightest limit).
- **Readback by exception.** A slip that prints needs nobody; every slip that has not printed within 20 s shows with its state (waiting, check the bill, couldn't print) on every device, `/pos` included, through the printer button's count.
- **The alarm** fires at the first pulse after the 20 s mark (between 20 s and 40 s), once per slip, on the asking and the printing device, for a KOT and for a bill to check; its notice carries a Show button that opens the sheet.
- **D2:** the pulse runs the sweep after its answer (`after()`, throttled per instance). **D7:** Retry and Print again are aimed at the printing device.
- **D6: no change.** Old tabs keep today's feeds for the release window; the dashboard band stays one release and goes with the old claim drain.
- **The 1D exit's "second device"** is a scratchpad script with a minted session cookie, never a browser tool typing the password.

---

## Session 1D (exact code, written and pre-validated at the 1C review gate)

**Pre-validated** by the 1C review gate on 2026-10-03, on scratchpad clones only (never in the repo):
- The code was developed on a golden copy of `5945f74` (the branch after the gate merged `origin/main` at `22e9999`), one commit per task, and this section was generated from those commits: every Create and Replace-the-whole block is the golden file byte for byte, and every find is unique in its file at the moment it is applied.
- A fresh clone of `5945f74` then got every block of this section applied verbatim, task by task, with each task's own Run lines; each RED and GREEN below is the output seen there. The clone came out byte-identical to the golden copy.
- Totals on that clone: shared `npm test` **637/637**, tsc 0; cafe `npm test` **4173 tests, 4172 pass, 0 fail, 1 skipped** (the skip is 1C's `go-live-dl` pin; +20 over `5945f74`'s 4153), tsc 0, lint 0 errors and the 2 old warnings; Hub tsc 0; live legs **`206 passed, 0 failed`** (1C's 199 + (af)'s 7; (ae) gains a stricter check, not a new one); the Next build lists 123 routes (1D adds none). Mobile and desktop are untouched by 1D.
- **Run end to end on the emulator** (WebView 109, the branch APK) against the golden build of the POS and the fake printer, before this section was written: see "Session 1C review (gate)" → "Pre-validating 1D end to end". It found two UI problems, both fixed in Task D3 before this section was generated: the alarm notice covered the printer button it pointed at (so it now carries its own Show button), and a REPRINT row waiting over 20 s said "Printing again".

A failure while executing therefore points to drift since then, or to a typo while copying. Compare with the plan first.

**What 1D delivers.** What staff see. Every slip that is not printed 20 s after it was made, every bill that may already have printed, and every slip that could not print shows in ONE panel on every device (the printer sheet), in three plain groups with Retry / Print now, Print again / It printed, and Clear; the printer button shows how many wait, on every screen including `/pos`; a KOT that has not printed after 20 s rings once and shows a notice (with Show) on the device that asked for it and on the device that prints it. With no host, the pulse now runs the sweep, so lease expiry, sending jobs home and the KOT repair happen without a wake poller. A staff Retry or Print again is aimed at the device that prints the slip. The agent gains the 1C gate's rulings (I3 and the minors). **1C and 1D release together; nothing is deployed until Phase 1 is done.**

**Gate rulings this section implements** (each is also in spec §7.10, "Rulings at the Session 1C review gate"):
- **I3 (owner, D1).** A refusal caused by the slip itself counts; the second one fails the slip. Printer-off refusals still never count.
- **F1, M4, M5, M6 (D1).** No empty lease after a maybe; unanswered failed acks are kept and re-sent; the store survives a refusing storage; acks go before the next lease.
- **The budget gaps (D1).** The trailing empty lease per burst and the per-device refusal re-check are pinned.
- **One attention feed, no `myRecentJobs` (D2).** The panel, its count and the alarm read one bounded feed on the existing pulse; each row names its asking and printing device.
- **The pulse sweep (D2) and aimed retries (D7, D2).**
- **Readback by exception (D3).** A slip that prints needs nobody; one that does not print within 20 s is shown with its state, everywhere.
- **D6: no change.** Old tabs during the release window keep today's feeds; the dashboard band (its readback chips and the host's legacy stale-row Print, which races the new Retry on the row's CAS, so nothing prints twice) stays one release and goes with the old claim drain.

**Not in 1D** (1E, the session that consumes it): the Phase 1 exit scenarios with the fake printer, the 200-order soak, TEST-CHECKLIST, and the local free-tier measurement (E3). The optional Telegram alerts of spec §10 are not in Phase 1.

### File map (Session 1D)

| File | Change | Task |
|---|---|---|
| `apps/cafe/lib/print-write-outcome.ts` | `isSlipRefusal`, `PRINT_SLIP_REFUSALS_MAX` | D1 |
| `apps/cafe/lib/print-agent.ts`, `lib/print-ack-store.ts` (create) | I3, F1, M4, M5, M6; the store split out | D1 |
| `apps/cafe/lib/print-agent.test.ts`, `packages/shared/src/print-budget.test.ts` | seven tests, two deliberate changes; two budget pins | D1 |
| `packages/shared/src/print-agent-wire.ts`, `self-order-alert.ts` | `PrintAttentionRow`; `PosPulseData.printAttention?` | D2 |
| `apps/cafe/lib/print-attention.ts` (+ test, create) | the feed | D2 |
| `apps/cafe/app/api/order-requests/pulse/route.ts` | the feed; the sweep after the answer | D2 |
| `apps/cafe/lib/print-job-actions.ts` | aimed `print-status` | D2 |
| `apps/cafe/lib/print-order-jobs.test.ts` | 1C's pulse pin (deliberate) | D2 |
| `apps/cafe/lib/print-waiting.ts` (+ test), `lib/printer-panel-open.ts`, `components/print/WaitingSlipsCard.tsx`, `hooks/use-print-job-actions.ts`, `hooks/use-print-slip-alarm.ts`, `components/layout/print-waiting-context.ts` (create) | the panel, the count, the alarm | D3 |
| `apps/cafe/components/print/PrinterPanel.tsx`, `PrinterStatusButton.tsx`, `components/layout/PosPulseProvider.tsx`, `components/print/PrintHostDrain.tsx` | the wiring | D3 |
| `apps/cafe/lib/printer-ui-paths.test.ts` | the card joins the hygiene list | D3 |
| `apps/cafe/scripts/print-host-live/attention.ts` (create), `agent.ts`, `verify-print-host-live.ts` | leg af; leg ae's reason | D4 |
| `apps/cafe/package.json` | `testChain`: two files | D2, D3 |
| this plan | Session 1D Results | D5 |

---

### Task D1: the agent rulings of the 1C gate: a slip that cannot be drawn fails on its second refusal (owner, I3); unanswered failed acks are kept (M4); the store survives a refusing storage (M5); acks go before the next lease (M6); no empty lease after a maybe (F1)

**Files:**
- Modify: `apps/cafe/lib/print-write-outcome.ts` (`isSlipRefusal`, `PRINT_SLIP_REFUSALS_MAX`)
- Modify: `apps/cafe/lib/print-agent.ts` (the slip-refusal count; `keep()`; a kept failed ack; `await flushAcks()` before each lease; F1; the pending-ack store moves out and is re-exported)
- Create: `apps/cafe/lib/print-ack-store.ts` (the pending-ack store, with an in-memory copy when storage refuses)
- Modify: `apps/cafe/lib/print-agent.test.ts` (seven new tests; two deliberate changes: the 1C I2(b) test is rewritten for M6, and "a printed ack with no answer is retried every 5 s …" now expects the re-send before the next lease; the `settle()` helper waits 60 microtask turns instead of 20)
- Modify: `packages/shared/src/print-budget.test.ts` (two pins: the trailing empty lease per burst, the per-device refusal re-check)

**Interfaces produced:** `isSlipRefusal(outcome: PrintWriteOutcome): boolean`; `PRINT_SLIP_REFUSALS_MAX = 2`; `PendingPrintAck.fail?: PrintAgentAckBody`; `readPendingAcks` / `writePendingAcks` now live in `lib/print-ack-store.ts` and are re-exported from `lib/print-agent.ts` (no caller changes).

**I3 (the owner's decision at the 1C gate).** A refusal caused by the slip itself counts: it could not be drawn (`RASTER_FAILED_MESSAGE`, the 12 s drawing deadline or a null canvas) or its end-of-day figures never loaded (`PRINT_HOST_EOD_TIMEOUT_MESSAGE`). The agent counts them per job in memory, only while its printer is ready, and acks the second one `permanent: true`; the server already fails a permanent `sent:"no"` ack with `uncertainAttempts` unchanged, so the line is free and the slip shows under "Couldn't print". A refusal because the printer is off (not connected, Bluetooth off, busy, another tab, no printer) still never counts. A slip refusal does not set the 30 s printer re-check, so its second try comes at the server's 2 s backoff. Client-only; at most 4 requests per such slip.

**F1 (the gate's fresh review).** `kickedWhileRunning` (1C's `fec4fd0`) also remembered the bridge freeing up from the agent's own slip while its failed ack was on the wire, so every maybe with a `nextAttemptAt` cost one empty lease. A job back in line holds the line until then, so the flag is cleared there.

**M4.** A failed ack with no answer is kept (with its body) and re-sent like a printed one, so the lease never expires into a counted maybe (a false REPRINT or cashier prompt). The `v1` store key is kept because it has never shipped. **M5.** A storage that refuses the write keeps the list in memory, so the ack is still sent. **M6.** Each cycle first waits for any flush on the wire, so a reload never re-leases its own just-printed job before the late ack lands.

`lib/print-agent.ts` is 307 lines (was 306): the store moved to `lib/print-ack-store.ts`.

- [ ] **Step 1: The failing tests first**

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
  createPrintAgent,
  failedAckBody,
  printAgentSlipOf,
  type PendingPrintAck,
  type PrintAgentAckBody,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_TOO_LARGE_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing Phase 1 Session 1C (spec §9.1, the owner's rules after Session 1B): the agent core, driven
```

Replace it with:

```ts
  createPrintAgent,
  failedAckBody,
  printAgentSlipOf,
  readPendingAcks,
  writePendingAcks,
  type PendingPrintAck,
  type PrintAgentAckBody,
  type PrintAgentResult,
} from "@/lib/print-agent";
import { PRINT_HOST_EOD_TIMEOUT_MESSAGE } from "@/lib/print-host-slips";
import { PRINT_SLIP_REFUSALS_MAX, isSlipRefusal, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { RASTER_FAILED_MESSAGE } from "@/lib/printer/raster";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_TOO_LARGE_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// Printing Phase 1 Session 1C (spec §9.1, the owner's rules after Session 1B): the agent core, driven
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function advance(w: ReturnType<typeof world>["w"], ms: number): Promise<void> {
  const end = w.now + ms;
```

Replace it with:

```ts
}

const settle = async (): Promise<void> => {
  // 60 turns (was 20): the 1C gate added one await (a cycle first waits for any flush on the wire, M6).
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
async function advance(w: ReturnType<typeof world>["w"], ms: number): Promise<void> {
  const end = w.now + ms;
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.pending.length, 1, "kept after a network error");
  await advance(w, PRINT_ACK_RETRY_MS);
  assert.equal(w.pending.length, 1, "kept after a 5xx");
  await advance(w, PRINT_ACK_RETRY_MS);
  assert.equal(w.pending.length, 0, "a 409 is an answer: cleared");
  assert.equal(w.acks.length, 3, "three sends, then no more");
```

Replace it with:

```ts
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  // The 1C review gate (M6) changed this sequence deliberately: the next cycle re-sends the kept ack
  // before it leases again, so the 5xx answers that re-send, and the 5 s retry carries the third.
  assert.equal(w.pending.length, 1, "kept after a network error, and after the 5xx of its re-send before the next lease");
  assert.equal(w.acks.length, 2, "sent, then sent again before the next lease");
  await advance(w, PRINT_ACK_RETRY_MS);
  assert.equal(w.pending.length, 0, "a 409 is an answer: cleared");
  assert.equal(w.acks.length, 3, "three sends, then no more");
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
  agent.stop();
});

// Session 1C final review I2: a flush reads the pending list once. A printed ack kept while an earlier
// flush was still on the wire waited for the 5 s retry, and the next lease found its own job still leased.
test("a printed ack kept while an earlier flush is on the wire is sent by that flush, before the next lease", async () => {
  const { w, deps } = world();
  let releaseOld: () => void = () => undefined;
  const agent = createPrintAgent({
```

Replace it with:

```ts
  agent.stop();
});

// Session 1C final review I2(b), rewritten at the 1C review gate for M6: the cycle now waits for a flush
// already on the wire before it leases, and a flush re-reads the store until every entry was tried once.
test("a printed ack still on the wire goes first: the next lease waits for its answer, then the new ack goes out at once", async () => {
  const { w, deps } = world();
  let releaseOld: () => void = () => undefined;
  const agent = createPrintAgent({
```

In `apps/cafe/lib/print-agent.test.ts`, find:

```ts
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(w.prints, ["j1"], "j1 printed while the old ack was still on the wire");
  releaseOld();
  await settle();
  assert.deepEqual(w.acks.map((a) => a.id), ["old", "j1"], "the same flush sends j1's ack too, without waiting for the retry timer");
  assert.deepEqual(w.pending, [], "both acks answered and cleared");
  assert.equal(w.leaseCalls, 2, "the next lease runs only after j1's ack was sent");
  agent.stop();
});

```

Replace it with:

```ts
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.leaseCalls, 0, "no lease while an ack from before is unanswered: it could be our own job (M6)");
  releaseOld();
  await settle();
  assert.deepEqual(w.prints, ["j1"], "then j1 prints");
  assert.deepEqual(w.acks.map((a) => a.id), ["old", "j1"], "and its ack goes out without waiting for the retry timer");
  assert.deepEqual(w.pending, [], "both acks answered and cleared");
  assert.equal(w.leaseCalls, 2, "the next lease runs only after j1's ack was sent");
  agent.stop();
});

test("a flush re-reads the store: an ack kept while it was on the wire goes out with it", async () => {
  const { w, deps } = world();
  w.pending = [{ id: "a", epoch: 1, at: T0 }];
  const agent = createPrintAgent({
    ...deps,
    ack: (id: string, body: PrintAgentAckBody) => {
      if (id === "a") w.pending = [...w.pending, { id: "b", epoch: 1, at: T0 }];
      return deps.ack(id, body);
    },
  });
  await agent.flushAcks();
  assert.deepEqual(w.acks.map((a) => a.id), ["a", "b"], "one flush, both acks");
  assert.deepEqual(w.pending, [], "both answered and cleared");
  agent.stop();
});

// ── The 1C review gate (2026-10-03): the owner's I3 decision and the agent minors F1, M4, M5, M6 ──

// I3 (owner): a refusal caused by the slip itself (it could not be drawn, or its figures never loaded)
// counts. The second one for a job while the printer is ready fails it, freeing the line; a refusal
// because the printer is off never counts.
test("I3: the second refusal of a slip that cannot be drawn fails it, and the next slip prints", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null }, { jobs: [job("j1", 2)], retryAt: null }, { jobs: [job("j2")], retryAt: null });
  w.results.push({ ok: false, error: new Error(RASTER_FAILED_MESSAGE) }, { ok: false, error: new Error(RASTER_FAILED_MESSAGE) });
  w.ackAnswers.push(
    { applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() },
    { applied: true, status: "failed", nextAttemptAt: null },
  );
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  await advance(w, 3_000);
  assert.deepEqual(
    w.acks.map((a) => `${a.id}:${a.body.sent}:${a.body.permanent ?? false}`),
    ["j1:no:false", "j1:no:true", "j2:undefined:false"],
    "the first refusal waits for the server's backoff (2 s, not the 30 s printer re-check); the second is permanent",
  );
  assert.deepEqual(w.prints, ["j1", "j1", "j2"], "the line is free again: j2 prints straight away");
  agent.stop();
});

test("I3: printer refusals never count, even between two slip refusals; an end-of-day timeout counts", async () => {
  const { w, deps } = world();
  for (let i = 0; i < 4; i++) {
    w.leases.push({ jobs: [job("j1", i + 1)], retryAt: null });
    w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 2_000).toISOString() });
  }
  w.results.push(
    { ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) },
    { ok: false, error: new Error(PRINT_HOST_EOD_TIMEOUT_MESSAGE) },
    { ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) },
    { ok: false, error: new Error(PRINT_HOST_EOD_TIMEOUT_MESSAGE) },
  );
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  await advance(w, 200_000);
  assert.deepEqual(w.acks.map((a) => a.body.permanent ?? false), [false, false, false, true], "only the second slip refusal is permanent");
  agent.stop();
});

test("I3: a slip refusal after the printer stopped being ready is a printer refusal, never counted", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.results.push({ ok: false, error: new Error(RASTER_FAILED_MESSAGE) }, { ok: false, error: new Error(RASTER_FAILED_MESSAGE) });
  const agent = createPrintAgent({
    ...deps,
    print: async (j: LeasedPrintJob): Promise<PrintAgentResult> => {
      w.prints.push(j.id);
      w.ready = false;
      return w.results.shift() ?? { ok: true };
    },
  });
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.acks[0]?.body.permanent, undefined, "not counted");
  assert.equal(isSlipRefusal(printWriteOutcomeOf(new Error(RASTER_FAILED_MESSAGE))), true, "it is a slip refusal by its sentence");
  assert.equal(isSlipRefusal(printWriteOutcomeOf(new Error(PRINTER_NOT_CONNECTED_MESSAGE))), false, "a printer refusal is not");
  assert.equal(PRINT_SLIP_REFUSALS_MAX, 2, "two refusals of the slip itself, then failed: at most 4 requests (2 leases, 2 acks)");
  agent.stop();
});

// F1 (the gate's fresh review): the bridge freeing up from this very slip lands while its failed ack is
// on the wire. A job back in line holds the line until its nextAttemptAt, so that kick must not cost an
// empty lease.
test("F1: a maybe whose answer names a retry time costs no extra lease, whatever re-renders meanwhile", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_WRITE_FAILED_MESSAGE) });
  w.ackAnswers.push({ applied: true, status: "queued", nextAttemptAt: new Date(T0 + 5_000).toISOString() });
  let agentRef: ReturnType<typeof createPrintAgent> | null = null;
  const agent = createPrintAgent({
    ...deps,
    ack: (id: string, body: PrintAgentAckBody) => {
      agentRef?.setGate({ enabled: true, busy: true });
      agentRef?.setGate({ enabled: true, busy: false }); // the bridge re-renders while the ack is on the wire
      return deps.ack(id, body);
    },
  });
  agentRef = agent;
  agent.setGate({ enabled: true, busy: false });
  await settle();
  assert.equal(w.leaseCalls, 1, "one lease: the retry waits for its own timer");
  assert.equal(w.timers.length, 1, "one timer, at the job's nextAttemptAt");
  agent.stop();
});

// M4: a failed ack that got no answer is kept and re-sent like a printed one, so the lease never expires
// into a counted "maybe" (a false REPRINT, or a false cashier prompt).
test("M4: a failed ack with no answer is kept and re-sent at 5 s, even with the printer off; a 4xx is an answer", async () => {
  const { w, deps } = world();
  w.leases.push({ jobs: [job("j1")], retryAt: null });
  w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  w.ackAnswers.push(new ApiError("offline", "network", null), { applied: true, status: "queued", nextAttemptAt: null });
  const agent = createPrintAgent(deps);
  agent.setGate({ enabled: true, busy: false });
  await settle();
  w.ready = false;
  await advance(w, PRINT_ACK_RETRY_MS + 1_000);
  assert.deepEqual(w.acks.map((a) => `${a.id}:${a.body.outcome}:${a.body.sent}`), ["j1:failed:no", "j1:failed:no"], "re-sent once, as the same failed ack");
  assert.deepEqual(w.pending, [], "answered: cleared");
  agent.stop();

  const second = world();
  second.w.leases.push({ jobs: [job("j2")], retryAt: null });
  second.w.results.push({ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) });
  second.w.ackAnswers.push(new ApiError("gone", "http", 409));
  const other = createPrintAgent(second.deps);
  other.setGate({ enabled: true, busy: false });
  await settle();
  assert.deepEqual(second.w.pending, [], "a server answer of any kind is never kept");
  other.stop();
});

// M5: a storage that refuses the write (full, blocked) used to drop the printed ack before it was sent.
test("M5: the pending-ack store keeps the list in memory when storage refuses it (node has no window)", () => {
  writePendingAcks([{ id: "a", epoch: 1, at: 1 }]);
  assert.deepEqual(readPendingAcks(), [{ id: "a", epoch: 1, at: 1 }], "kept in memory, so it is still sent");
  writePendingAcks([]);
  assert.deepEqual(readPendingAcks(), [], "cleared");
});

```

In `packages/shared/src/print-budget.test.ts`, find:

```ts
  assert.ok(PRINT_ACK_PENDING_MAX_MS / PRINT_ACK_RETRY_MS <= 120, "at most 120 re-sends per lost ack, then it is dropped");
});

```

Replace it with:

```ts
  assert.ok(PRINT_ACK_PENDING_MAX_MS / PRINT_ACK_RETRY_MS <= 120, "at most 120 re-sends per lost ack, then it is dropped");
});

// The 1C review gate (fresh review, 2026-10-03): two request sources the per-event pins above did not add
// up. After every burst of slips the agent leases once more and finds its line empty; and a printer that
// reports ready but keeps refusing costs a lease and an ack per 30 s re-check, all day.
test("1C gate: Phase 1's busy day, with one trailing empty lease per burst, still fits the no-host estimate", () => {
  // Phase 1 has no stations: 1.5 KOT rounds + 1 bill per order. At worst every slip is its own burst.
  const slips = PRINT_BUDGET_BUSY_DAY.orders * 2.5;
  const bursts = slips;
  const perDay = Math.round(slips * 2 * (1 + PRINT_BUDGET_BUSY_DAY.retryShare) + bursts);
  assert.equal(perDay, 2_400);
  assert.ok(perDay <= printSlipRequestsPerDay(), `${perDay}/day within the 2,640 estimate`);
});

test("1C gate: a printer that says ready but keeps refusing costs at most 2 requests per 30 s per device: 2,880 over the day", () => {
  const perDevice = 2 * Math.ceil(OPEN_MS / PRINT_AGENT_REFUSED_RECHECK_MS);
  assert.equal(perDevice, 2_880);
  assert.ok(perDevice <= PRINT_BUDGET_NORMAL_MAX_PER_DAY, "even a whole day of it stays inside the normal-day ceiling");
});

```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent.test.ts 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# tests 23`; `# pass 15`; `# fail 8`

- [ ] **Step 3: The code**

Create `apps/cafe/lib/print-ack-store.ts`:

```ts
import type { PendingPrintAck } from "@/lib/print-agent";

// Printing redesign, Phase 1 (spec §7.9): the agent's pending-ack store, split out of print-agent.ts at
// the 1C review gate to keep that file near its ~300-line budget. An ack the server has not answered
// (a "printed" one, or since the gate a failed one, M4) is kept here and re-sent every 5 s for 10
// minutes, also after a reload. Client-only; never throws.

const PENDING_ACK_KEY = "pos.print-ack-pending.v1";

function isPendingAck(v: unknown): v is PendingPrintAck {
  const o = v as Partial<PendingPrintAck> | null;
  return typeof o === "object" && o !== null && typeof o.id === "string" && Number.isInteger(o.epoch) && Number.isFinite(o.at);
}

// A storage that refuses a write (full, blocked): this page keeps the list itself until a write lands,
// so the ack is still sent and retried; only its retry after a reload is lost (M5).
let unstored: PendingPrintAck[] | null = null;

export function readPendingAcks(): PendingPrintAck[] {
  if (unstored !== null) return [...unstored];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PENDING_ACK_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isPendingAck) : [];
  } catch {
    return [];
  }
}

export function writePendingAcks(entries: PendingPrintAck[]): void {
  try {
    if (entries.length === 0) window.localStorage.removeItem(PENDING_ACK_KEY);
    else window.localStorage.setItem(PENDING_ACK_KEY, JSON.stringify(entries));
    unstored = null;
  } catch {
    unstored = [...entries];
  }
}
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
  hostPrintSlipOf,
  type HostPrintSlip,
} from "@/lib/print-host-slips";
import { printWriteOutcomeOf, type PrintWriteOutcome } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent's core, with no React and
// no globals except the pending-ack store, so every rule below is unit-tested with fakes
```

Replace it with:

```ts
  hostPrintSlipOf,
  type HostPrintSlip,
} from "@/lib/print-host-slips";
import { PRINT_SLIP_REFUSALS_MAX, isSlipRefusal, printWriteOutcomeOf, type PrintWriteOutcome } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent's core, with no React and
// no globals except the pending-ack store, so every rule below is unit-tested with fakes
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
  id: string;
  epoch: number;
  at: number;
}

export interface PrintAgentDeps {
```

Replace it with:

```ts
  id: string;
  epoch: number;
  at: number;
  /** A failed ack that got no answer (M4); absent: a "printed" ack. */
  fail?: PrintAgentAckBody;
}

export interface PrintAgentDeps {
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
  let timerAt = Number.POSITIVE_INFINITY;
  let ackTimer: unknown = null;
  let flushing: Promise<void> | null = null;

  function refusalHolds(): boolean {
    if (refused === null) return false;
```

Replace it with:

```ts
  let timerAt = Number.POSITIVE_INFINITY;
  let ackTimer: unknown = null;
  let flushing: Promise<void> | null = null;
  const slipRefusals = new Map<string, number>();

  function refusalHolds(): boolean {
    if (refused === null) return false;
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
      timerAt = Number.POSITIVE_INFINITY;
      kick();
    }, delay);
  }

  function forget(entry: PendingPrintAck): void {
```

Replace it with:

```ts
      timerAt = Number.POSITIVE_INFINITY;
      kick();
    }, delay);
  }

  function keep(entry: PendingPrintAck): void {
    deps.writePending([...deps.readPending().filter((e) => e.id !== entry.id), entry].slice(-PRINT_ACK_PENDING_LIMIT));
  }

  function forget(entry: PendingPrintAck): void {
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
        continue;
      }
      try {
        await deps.ack(entry.id, { deviceId: deps.deviceId, epoch: entry.epoch, outcome: "printed" });
        forget(entry);
      } catch (error) {
        if (ackAnswered(error)) forget(entry);
```

Replace it with:

```ts
        continue;
      }
      try {
        await deps.ack(entry.id, entry.fail ?? { deviceId: deps.deviceId, epoch: entry.epoch, outcome: "printed" });
        forget(entry);
      } catch (error) {
        if (ackAnswered(error)) forget(entry);
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
    kickedWhileRunning = false;
    let again = false;
    try {
      const data = await deps.lease();
      const job = data.jobs[0];
      if (job === undefined) {
```

Replace it with:

```ts
    kickedWhileRunning = false;
    let again = false;
    try {
      // An ack the last page (or a dropped answer) left goes first: a lease could expire our own job (M6).
      await flushAcks();
      const data = await deps.lease();
      const job = data.jobs[0];
      if (job === undefined) {
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
      if (result.ok) {
        // Kept BEFORE it is sent, so a reload mid-ack still reports the paper (spec §7.9). Awaited, so
        // the next lease does not find this job still leased at the head of the line.
        const kept = deps.readPending().filter((e) => e.id !== job.id);
        deps.writePending([...kept, { id: job.id, epoch: job.epoch, at: deps.now() }].slice(-PRINT_ACK_PENDING_LIMIT));
        await flushAcks();
        again = true;
        return;
      }
      const outcome = printWriteOutcomeOf(result.error);
      // Nothing reached the printer: it is off or unreachable. No automatic attempt until it changes.
      if (outcome.sent === "no" && !outcome.permanent) refused = { state: deps.printerState(), at: deps.now() };
      const answer = await deps.ack(job.id, failedAckBody(deps.deviceId, job.epoch, outcome)).catch(() => null);
      if (answer === null) {
        wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
        return;
      }
      // A job back in line waits for its own nextAttemptAt; a parked or failed one frees the line.
      if (answer.nextAttemptAt !== null) wakeAt(Date.parse(answer.nextAttemptAt));
      else again = refused === null;
    } catch {
      // No answer from the lease (offline, a deploy): look again later, never in a tight loop.
      wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
```

Replace it with:

```ts
      if (result.ok) {
        // Kept BEFORE it is sent, so a reload mid-ack still reports the paper (spec §7.9). Awaited, so
        // the next lease does not find this job still leased at the head of the line.
        keep({ id: job.id, epoch: job.epoch, at: deps.now() });
        await flushAcks();
        again = true;
        return;
      }
      let outcome = printWriteOutcomeOf(result.error);
      if (isSlipRefusal(outcome) && deps.printerReady()) {
        // The slip itself was refused (owner, 1C gate I3): its second refusal fails the job, freeing the line.
        const count = (slipRefusals.get(job.id) ?? 0) + 1;
        slipRefusals.set(job.id, count);
        if (count >= PRINT_SLIP_REFUSALS_MAX) outcome = { ...outcome, permanent: true };
      } else if (outcome.sent === "no" && !outcome.permanent) {
        // Nothing reached the printer: it is off or unreachable. No automatic attempt until it changes.
        refused = { state: deps.printerState(), at: deps.now() };
      }
      const body = failedAckBody(deps.deviceId, job.epoch, outcome);
      const answer = await deps.ack(job.id, body).catch((error: unknown) => {
        // No answer: kept and re-sent like a printed ack, so the lease never expires into a counted "maybe" (M4).
        if (!ackAnswered(error)) keep({ id: job.id, epoch: job.epoch, at: deps.now(), fail: body });
        return null;
      });
      if (answer === null) {
        scheduleAckRetry();
        wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
        return;
      }
      // A job back in line holds the line until its own nextAttemptAt (the timer leases it then), so a
      // kick that landed meanwhile (the bridge freeing up from this very slip) would only find it not due.
      if (answer.nextAttemptAt !== null) {
        kickedWhileRunning = false;
        wakeAt(Date.parse(answer.nextAttemptAt));
      } else again = refused === null;
    } catch {
      // No answer from the lease (offline, a deploy): look again later, never in a tight loop.
      wakeAt(deps.now() + PRINT_AGENT_REFUSED_RECHECK_MS);
```

In `apps/cafe/lib/print-agent.ts`, find:

```ts
  };
}

// ── The pending-ack store and the agent's two module seams (client-only, never throws) ──────────────

const PENDING_ACK_KEY = "pos.print-ack-pending.v1";

function isPendingAck(v: unknown): v is PendingPrintAck {
  const o = v as Partial<PendingPrintAck> | null;
  return typeof o === "object" && o !== null && typeof o.id === "string" && Number.isInteger(o.epoch) && Number.isFinite(o.at);
}

export function readPendingAcks(): PendingPrintAck[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PENDING_ACK_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isPendingAck) : [];
  } catch {
    return [];
  }
}

export function writePendingAcks(entries: PendingPrintAck[]): void {
  try {
    if (entries.length === 0) window.localStorage.removeItem(PENDING_ACK_KEY);
    else window.localStorage.setItem(PENDING_ACK_KEY, JSON.stringify(entries));
  } catch {
    // A storage that refuses: the ack is still sent now; only its retry after a reload is lost.
  }
}

const kickListeners = new Set<() => void>();

```

Replace it with:

```ts
  };
}

// ── The agent's two module seams (client-only, never throws); the pending-ack store is print-ack-store.ts ──

export { readPendingAcks, writePendingAcks } from "@/lib/print-ack-store";

const kickListeners = new Set<() => void>();

```

In `apps/cafe/lib/print-write-outcome.ts`, find:

```ts
  PRINT_HOST_EMPTY_SLIP_MESSAGE,
]);

const UNKNOWN_FAILURE_MESSAGE = "may have printed";

export function printWriteOutcomeOf(error: unknown): PrintWriteOutcome {
```

Replace it with:

```ts
  PRINT_HOST_EMPTY_SLIP_MESSAGE,
]);

/** Refused because of the slip itself, not the printer (owner, 1C gate I3): it could not be drawn, or
 *  its figures never loaded. The second one for a job while the printer is ready fails that job. */
const SLIP_REFUSALS: ReadonlySet<string> = new Set([RASTER_FAILED_MESSAGE, PRINT_HOST_EOD_TIMEOUT_MESSAGE]);
export const PRINT_SLIP_REFUSALS_MAX = 2;

export function isSlipRefusal(outcome: PrintWriteOutcome): boolean {
  return outcome.sent === "no" && !outcome.permanent && SLIP_REFUSALS.has(outcome.message);
}

const UNKNOWN_FAILURE_MESSAGE = "may have printed";

export function printWriteOutcomeOf(error: unknown): PrintWriteOutcome {
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-agent.test.ts lib/print-write-outcome.test.ts lib/print-agent-paths.test.ts lib/print-host-bridge-late.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 44`; `# pass 44`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/print-budget.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `# tests 15`; `# pass 15`; `# fail 0`; `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/lib/print-ack-store.ts apps/cafe/lib/print-agent.test.ts apps/cafe/lib/print-agent.ts apps/cafe/lib/print-write-outcome.ts packages/shared/src/print-budget.test.ts
git commit -m "fix(print): the 1C gate's agent rulings: a slip that cannot be drawn fails on its second refusal; unanswered failed acks are kept; acks go before the next lease; no empty lease after a maybe"
```

---

### Task D2: the server half: the waiting-slips feed on the pulse, the pulse sweep, and staff taps aimed at the printing device

**Files:**
- Modify: `packages/shared/src/print-agent-wire.ts` (`PrintAttentionRow`, `PRINT_ATTENTION_LIMIT`, `PRINT_ATTENTION_WINDOW_MS`)
- Modify: `packages/shared/src/self-order-alert.ts` (`PosPulseData.printAttention?`, `printAttentionTruncated?`)
- Create: `apps/cafe/lib/print-attention.ts` (`printAttentionFilter`, `printAttentionRowOf`, `readPrintAttention`)
- Modify: `apps/cafe/app/api/order-requests/pulse/route.ts` (the feed for every tab; `after(() => sweepPrintJobsThrottled(nowMs))`)
- Modify: `apps/cafe/lib/print-job-actions.ts` (D7: a queued result also publishes `print-status` aimed at the row's `targetDeviceId`)
- Create: `apps/cafe/lib/print-attention.test.ts`; Modify: `apps/cafe/package.json` (`testChain`)
- Modify (deliberate pin change): `apps/cafe/lib/print-order-jobs.test.ts` (1C's pulse pin: the print fields are spread in, and the sweep runs after the answer)

**Interfaces produced:** `PrintAttentionRow { id, kind, label, status: "queued" | "needs-confirm" | "failed", labels, createdAt, lastError?, originDeviceId?, targetDeviceId? }`; `readPrintAttention(nowMs): Promise<{ rows; truncated }>`; `PosPulseData.printAttention?` / `printAttentionTruncated?`.

**One feed, every device (gate ruling).** The panel's rows are every slip that waits for a person, cafe-wide: still `queued` 20 s after it was made (`PRINT_KOT_ALARM_MS`; its printer is off or not ready, or it is stale), `needs-confirm`, or `failed`, within the 12 h queued retention, oldest first, at most 20 (`printAttentionTruncated` says when it was cut). A `leased` slip is printing and waits for nobody. Each row carries its asking and its printing device, so the 20 s alarm needs no per-device read: the spec's `myRecentJobs` (D1) is not added (budget: one bounded read per pulse instead of two), and `PRINT_MY_RECENT_WINDOW_MS` stays unused.

**D2, the pulse sweep.** The pulse runs `sweepPrintJobsThrottled` after its answer (`after()`, at most once per 60 s per instance, §17.3 rule 2). With no host it is the only request that expires leases, sends jobs home and repairs KOT rounds. The route itself still writes nothing (pinned).

**D7.** Retry and Print again also publish `print-status` `queued` aimed at the job's device: with no host, agents never lease on the broadcast `print-job` (1B M-c), so a tap would otherwise wait for that device's next pulse. One Worker request per tap.

- [ ] **Step 1: The failing tests first**

Create `apps/cafe/lib/print-attention.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PRINT_KOT_ALARM_MS } from "@pos/shared/print-lifecycle";
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS } from "@pos/shared/print-agent-wire";
import { stripComments } from "@/lib/source-pin-utils";
import { printAttentionFilter, printAttentionRowOf } from "@/lib/print-attention";

// Printing Phase 1 Session 1D (spec §10): the waiting-slips feed on the existing 20 s pulse (one bounded
// read), the pulse sweep (D2), and staff Retry / Print again aimed at the printing device (D7). DB
// behaviour is proven live (npm run verify:print:live, legs af–ag); these are the pure parts and pins.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const T0 = Date.parse("2026-10-03T12:00:00.000Z");
const at = (ms: number): Date => new Date(ms);

test("printAttentionFilter: bills to check and failed slips from the last 12 h, and every slip still queued 20 s after it was made", () => {
  assert.deepEqual(printAttentionFilter(T0), {
    $or: [
      { status: { $in: ["needs-confirm", "failed"] }, createdAt: { $gte: at(T0 - PRINT_ATTENTION_WINDOW_MS) } },
      { status: "queued", createdAt: { $gte: at(T0 - PRINT_ATTENTION_WINDOW_MS), $lte: at(T0 - PRINT_KOT_ALARM_MS) } },
    ],
  });
  assert.equal(PRINT_ATTENTION_WINDOW_MS, 12 * 60 * 60 * 1000, "the queued retention (§7.8): nothing older is still waiting");
  assert.equal(PRINT_ATTENTION_LIMIT, 20, "a bounded read on the hottest poll");
});

test("printAttentionRowOf: a panel row says what, when, why, who asked and where it prints; nothing else reaches the wire", () => {
  const row = printAttentionRowOf({
    _id: "j1",
    kind: "kot",
    label: "KOT round 1 · T-4",
    status: "queued",
    labels: ["REPRINT"],
    createdAt: at(T0),
    lastError: "The printer is not connected.",
    originDeviceId: "dev-2",
    targetDeviceId: "dev-1",
  });
  assert.deepEqual(row, {
    id: "j1",
    kind: "kot",
    label: "KOT round 1 · T-4",
    status: "queued",
    labels: ["REPRINT"],
    createdAt: "2026-10-03T12:00:00.000Z",
    lastError: "The printer is not connected.",
    originDeviceId: "dev-2",
    targetDeviceId: "dev-1",
  });
  const bare = printAttentionRowOf({ _id: "j2", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", createdAt: at(T0) });
  assert.deepEqual(bare, { id: "j2", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", labels: [], createdAt: "2026-10-03T12:00:00.000Z" }, "omit-empty");
  assert.equal(printAttentionRowOf({ _id: "j3", kind: "kot", label: "x", status: "printed", createdAt: at(T0) }), null, "a status the panel never shows is dropped, never thrown");
  assert.equal(printAttentionRowOf({ _id: "j4", kind: "kot", label: "x", status: "leased", createdAt: at(T0) }), null, "a slip printing right now waits for nobody");
});

test("PIN: the pulse reads the waiting-slips feed for every tab, fail-soft; printJobsForMe stays the named agent's", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /readPrintAttention\(nowMs\)\.catch\(\(\) => null\)/, "every device shows the panel and its count");
  assert.match(s, /device === null \? Promise\.resolve\(null\) : readJobsForDevice\(device, nowMs\)\.catch\(\(\) => null\)/, "1C's printJobsForMe is kept");
  assert.ok(s.includes("...(printJobsForMe === null ? {} : { printJobsForMe }),"), "printJobsForMe is omitted on a failed read");
  assert.ok(
    s.includes("...(attention === null ? {} : { printAttention: attention.rows, printAttentionTruncated: attention.truncated }),"),
    "the feed is omitted on a failed read",
  );
  assert.equal(s.split("readPrintAttention(").length - 1, 1, "one read per pulse, not one per device or per row");
});

test("PIN (D2): the pulse sweeps after its answer, throttled, and the route itself writes nothing", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /after\(\(\) => sweepPrintJobsThrottled\(nowMs\)\);/, "with no host the pulse is the only request that runs the sweep");
  assert.ok(s.indexOf("after(() => sweepPrintJobsThrottled(nowMs));") > s.indexOf("readPosPulse()"), "the sweep runs after the reads it must never delay");
  for (const write of ["updateOne(", "updateMany(", "create(", "findOneAndUpdate(", "prunePrintJobs", "pruneOrderRequests", "sweepPrintJobs("]) {
    assert.ok(!s.includes(write), `the pulse route itself writes nothing: no ${write}`);
  }
  const lib = src("apps/cafe/lib/print-attention.ts");
  for (const write of ["updateOne(", "updateMany(", ".create(", "findOneAndUpdate(", "connectDB("]) {
    assert.ok(!lib.includes(write), `print-attention.ts only reads: no ${write}`);
  }
  assert.match(lib, /\.limit\(PRINT_ATTENTION_LIMIT\)/, "bounded by a named constant");
});

test("PIN (D7): a staff Retry or Print again announces its job to the device that prints it", () => {
  const s = src("apps/cafe/lib/print-job-actions.ts");
  assert.match(s, /\.select\(`\$\{PRINT_LIFECYCLE_SELECT\} targetDeviceId`\)/, "the row says where it prints");
  assert.match(s, /if \(plan\.patch\.status === "queued"\) publishCafeEvent\("print-job"\);/, "the host still hears the broadcast nudge");
  assert.match(
    s,
    /if \(plan\.patch\.status === "queued"\) publishPrintStatus\(\{ id, status: "queued", \.\.\.\(row\.targetDeviceId \? \{ target: row\.targetDeviceId \} : \{\}\) \}\);/,
    "aimed: with no host only that device's agent leases on it (it ignores the broadcast)",
  );
});
```

In `apps/cafe/lib/print-order-jobs.test.ts`, find:

```ts
  assert.ok(!src("apps/cafe/lib/order-request-create.ts").includes("printDeviceId"), "the auto-accept marks nothing");
});

test("PIN: the pulse adds printJobsForMe only for a tab that named itself, read-only and fail-soft", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /const device = printPulseDeviceOf\(req\.url\);/);
  assert.match(s, /device === null \? Promise\.resolve\(null\) : readJobsForDevice\(device, Date\.now\(\)\)\.catch\(\(\) => null\)/);
  assert.match(s, /success\(printJobsForMe === null \? data : \{ \.\.\.data, printJobsForMe \}\)/);
  for (const write of ["updateOne(", "updateMany(", "create(", "findOneAndUpdate(", "sweepPrintJobs"]) {
    assert.ok(!s.includes(write), `the pulse route stays read-only: no ${write}`);
  }
});

```

Replace it with:

```ts
  assert.ok(!src("apps/cafe/lib/order-request-create.ts").includes("printDeviceId"), "the auto-accept marks nothing");
});

// Session 1D deliberately changed this pin: the pulse now also sweeps AFTER its answer (D2; pinned in
// print-attention.test.ts), and its print fields are spread in, each omitted on a failed read.
test("PIN: the pulse adds printJobsForMe only for a tab that named itself, fail-soft, and the route itself writes nothing", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /const device = printPulseDeviceOf\(req\.url\);/);
  assert.match(s, /device === null \? Promise\.resolve\(null\) : readJobsForDevice\(device, nowMs\)\.catch\(\(\) => null\)/);
  assert.ok(s.includes("...(printJobsForMe === null ? {} : { printJobsForMe }),"), "omitted on a failed read");
  for (const write of ["updateOne(", "updateMany(", "create(", "findOneAndUpdate("]) {
    assert.ok(!s.includes(write), `the pulse route itself writes nothing: no ${write}`);
  }
});

```

In `apps/cafe/package.json`, find:

```json
    "lib/print-write-outcome.test.ts",
    "lib/print-agent.test.ts",
    "lib/print-agent-paths.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
    "lib/pos-install-paths.test.ts",
```

Replace it with:

```json
    "lib/print-write-outcome.test.ts",
    "lib/print-agent.test.ts",
    "lib/print-agent-paths.test.ts",
    "lib/print-attention.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
    "lib/pos-install-paths.test.ts",
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-attention.test.ts lib/print-order-jobs.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|Cannot find module"`
Expected: `# Error: Cannot find module '@/lib/print-attention'`; `# tests 15`; `# pass 13`; `# fail 2`

- [ ] **Step 3: The code**

In `apps/cafe/app/api/order-requests/pulse/route.ts`, find:

```ts
import { connectDB } from "@/lib/db";
import { readPosPulse } from "@/lib/pos-pulse";
import { printPulseDeviceOf } from "@/lib/print-agent-server";
import { readJobsForDevice } from "@/lib/print-lease";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

```

Replace it with:

```ts
import { after } from "next/server";
import { connectDB } from "@/lib/db";
import { readPosPulse } from "@/lib/pos-pulse";
import { printPulseDeviceOf } from "@/lib/print-agent-server";
import { readPrintAttention } from "@/lib/print-attention";
import { readJobsForDevice } from "@/lib/print-lease";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

```

In `apps/cafe/app/api/order-requests/pulse/route.ts`, find:

```ts
// printJobsForMe, the jobs waiting in that device's own line, so a job the server re-queued or sent
// home reaches its agent within one tick even with the socket down. One more bounded, index-backed
// READ on a poll that already runs (no new request), fail-soft: a failed read omits the field.
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
```

Replace it with:

```ts
// printJobsForMe, the jobs waiting in that device's own line, so a job the server re-queued or sent
// home reaches its agent within one tick even with the socket down. One more bounded, index-backed
// READ on a poll that already runs (no new request), fail-soft: a failed read omits the field.
//
// Printing Phase 1 Session 1D (spec §10, §17.3 rule 2): every tab also reads the waiting-slips feed (one
// bounded read: the panel, its count, the 20 s alarm), and the pulse runs the print sweep AFTER its
// answer, at most once per 60 s per instance (sweepPrintJobsThrottled). With no host nothing else runs
// it: lease expiry, sending jobs home and the KOT repair would otherwise never happen. The route itself
// still writes nothing; the sweep's writes are the sweep's (lib/print-sweep.ts), never on this answer.
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
```

In `apps/cafe/app/api/order-requests/pulse/route.ts`, find:

```ts

  try {
    await connectDB();
    const [data, printJobsForMe] = await Promise.all([
      readPosPulse(),
      device === null ? Promise.resolve(null) : readJobsForDevice(device, Date.now()).catch(() => null),
    ]);
    return noStore(success(printJobsForMe === null ? data : { ...data, printJobsForMe }));
  } catch (error) {
    return noStore(serverError("Failed to fetch pos pulse", error));
  }
```

Replace it with:

```ts

  try {
    await connectDB();
    const nowMs = Date.now();
    const [data, printJobsForMe, attention] = await Promise.all([
      readPosPulse(),
      device === null ? Promise.resolve(null) : readJobsForDevice(device, nowMs).catch(() => null),
      readPrintAttention(nowMs).catch(() => null),
    ]);
    try {
      after(() => sweepPrintJobsThrottled(nowMs));
    } catch {
      // no after() in this runtime: skip the sweep, keep the pulse
    }
    return noStore(
      success({
        ...data,
        ...(printJobsForMe === null ? {} : { printJobsForMe }),
        ...(attention === null ? {} : { printAttention: attention.rows, printAttentionTruncated: attention.truncated }),
      }),
    );
  } catch (error) {
    return noStore(serverError("Failed to fetch pos pulse", error));
  }
```

Create `apps/cafe/lib/print-attention.ts`:

```ts
import type { FilterQuery } from "mongoose";
import { PRINT_KOT_ALARM_MS, type PrintJobLabel } from "@pos/shared/print-lifecycle";
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS, type PrintAttentionRow } from "@pos/shared/print-agent-wire";
import type { PrintJobKind, PrintJobStatus } from "@pos/shared/print-job";
import { PrintJob, type IPrintJob } from "@/models/PrintJob";

// Printing redesign, Phase 1 Session 1D (spec §10): the one waiting-slips panel's feed. Every device
// reads the same rows on the existing 20 s pulse (one bounded, index-backed read; no new request):
//   · Waiting for the printer: still queued 20 s after it was made (PRINT_KOT_ALARM_MS) — its printer
//     is off or not ready, or the slip is stale and needs a tap;
//   · Check the bill: needs-confirm;
//   · Couldn't print: failed.
// A slip being printed right now (leased) waits for nobody. The rows also carry the asking and the
// printing device, so both can sound the 20 s alarm without a per-device read. Read-only; never calls
// connectDB() (the route does); no console.*.

const ATTENTION_STATUSES: ReadonlySet<PrintJobStatus> = new Set(["queued", "needs-confirm", "failed"]);

export function printAttentionFilter(nowMs: number): FilterQuery<IPrintJob> {
  const since = new Date(nowMs - PRINT_ATTENTION_WINDOW_MS);
  // Two branches, each riding {status:1, createdAt:1, _id:1}.
  return {
    $or: [
      { status: { $in: ["needs-confirm", "failed"] }, createdAt: { $gte: since } },
      { status: "queued", createdAt: { $gte: since, $lte: new Date(nowMs - PRINT_KOT_ALARM_MS) } },
    ],
  };
}

export function printAttentionRowOf(doc: {
  _id: unknown;
  kind: PrintJobKind;
  label: string;
  status: PrintJobStatus;
  labels?: PrintJobLabel[];
  createdAt: Date;
  lastError?: string;
  originDeviceId?: string;
  targetDeviceId?: string;
}): PrintAttentionRow | null {
  // A status this panel never shows (deploy skew, a row that moved mid-read) degrades one row, never the pulse.
  if (!ATTENTION_STATUSES.has(doc.status)) return null;
  return {
    id: String(doc._id),
    kind: doc.kind,
    label: doc.label,
    status: doc.status as PrintAttentionRow["status"],
    labels: doc.labels ?? [],
    createdAt: doc.createdAt.toISOString(),
    ...(doc.lastError ? { lastError: doc.lastError } : {}),
    ...(doc.originDeviceId ? { originDeviceId: doc.originDeviceId } : {}),
    ...(doc.targetDeviceId ? { targetDeviceId: doc.targetDeviceId } : {}),
  };
}

export async function readPrintAttention(nowMs: number): Promise<{ rows: PrintAttentionRow[]; truncated: boolean }> {
  const docs = await PrintJob.find(printAttentionFilter(nowMs))
    .select("kind label status labels createdAt lastError originDeviceId targetDeviceId")
    .sort({ createdAt: 1, _id: 1 })
    .limit(PRINT_ATTENTION_LIMIT)
    .lean();
  const rows = docs.map(printAttentionRowOf).filter((row): row is PrintAttentionRow => row !== null);
  // The same length===limit "at least this many" proxy the other pulse feeds use.
  return { rows, truncated: docs.length === PRINT_ATTENTION_LIMIT };
}
```

In `apps/cafe/lib/print-job-actions.ts`, find:

```ts
import type { PrintActionData } from "@pos/shared/print-agent-wire";
import { lifecycleOf, planConfirm, planRetry, type PrintJobDecision, type PrintJobLifecycle, type PrintJobPlan } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";

// Printing redesign, Phase 1 (spec §7.2, §7.3): the staff decisions. "Print again?" on a bill that
```

Replace it with:

```ts
import type { PrintActionData } from "@pos/shared/print-agent-wire";
import { lifecycleOf, planConfirm, planRetry, type PrintJobDecision, type PrintJobLifecycle, type PrintJobPlan } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { publishCafeEvent, publishPrintStatus } from "@/lib/realtime-publish";
import { PRINT_LIFECYCLE_SELECT, applyPrintJobPlan, type PrintLifecycleRow } from "./print-lease";

// Printing redesign, Phase 1 (spec §7.2, §7.3): the staff decisions. "Print again?" on a bill that
```

In `apps/cafe/lib/print-job-actions.ts`, find:

```ts

async function act(id: string, decide: (job: PrintJobLifecycle) => PrintJobPlan): Promise<PrintActionData> {
  for (let step = 0; step < ACTION_MAX_STEPS; step++) {
    const row = await PrintJob.findById(id).select(PRINT_LIFECYCLE_SELECT).lean<PrintLifecycleRow>();
    if (row === null) return { applied: false, status: null, reason: "not-found" };
    const job = lifecycleOf(row);
    const plan = decide(job);
```

Replace it with:

```ts

async function act(id: string, decide: (job: PrintJobLifecycle) => PrintJobPlan): Promise<PrintActionData> {
  for (let step = 0; step < ACTION_MAX_STEPS; step++) {
    const row = await PrintJob.findById(id).select(`${PRINT_LIFECYCLE_SELECT} targetDeviceId`).lean<PrintLifecycleRow & { targetDeviceId?: string }>();
    if (row === null) return { applied: false, status: null, reason: "not-found" };
    const job = lifecycleOf(row);
    const plan = decide(job);
```

In `apps/cafe/lib/print-job-actions.ts`, find:

```ts
      // Back in the queue: nudge the printing device, so it leases now rather than on its next poll.
      // Fire-and-forget; the poll still finds it if the nudge is lost.
      if (plan.patch.status === "queued") publishCafeEvent("print-job");
      return { applied: true, status: plan.patch.status };
    }
  }
```

Replace it with:

```ts
      // Back in the queue: nudge the printing device, so it leases now rather than on its next poll.
      // Fire-and-forget; the poll still finds it if the nudge is lost.
      if (plan.patch.status === "queued") publishCafeEvent("print-job");
      // Session 1D (D7): also aimed at the device whose line holds it. With no host, agents never lease on
      // the broadcast above (1B M-c), so without this a tap would wait for that device's next pulse.
      if (plan.patch.status === "queued") publishPrintStatus({ id, status: "queued", ...(row.targetDeviceId ? { target: row.targetDeviceId } : {}) });
      return { applied: true, status: plan.patch.status };
    }
  }
```

In `packages/shared/src/print-agent-wire.ts`, find:

```ts
   *  already printed (or was dismissed) is followed, never leased or re-sent as if it were fresh. */
  status: PrintJobStatus;
}

export const PRINT_DEVICE_SHELLS = ["android", "windows", "browser"] as const;
export type PrintDeviceShell = (typeof PRINT_DEVICE_SHELLS)[number];
```

Replace it with:

```ts
   *  already printed (or was dismissed) is followed, never leased or re-sent as if it were fresh. */
  status: PrintJobStatus;
}

/** Session 1D (spec §10): one row of the one waiting-slips panel. Every device reads the same feed on the
 *  existing 20 s pulse: a slip still queued 20 s after it was made (its printer is off or not ready, or the
 *  slip is stale), a bill that may already have printed, or a slip that could not print. */
export interface PrintAttentionRow {
  id: string;
  kind: PrintJobKind;
  label: string;
  status: "queued" | "needs-confirm" | "failed";
  labels: PrintJobLabel[];
  createdAt: string;
  /** The writer's last curated sentence (why it waits, or why it failed); absent when there is none. */
  lastError?: string;
  /** The device that asked for the slip, and the one whose line holds it: both sound the 20 s alarm. */
  originDeviceId?: string;
  targetDeviceId?: string;
}

/** The feed is one bounded read on the hottest poll: the oldest rows first, within the queued retention (§7.8). */
export const PRINT_ATTENTION_LIMIT = 20;
export const PRINT_ATTENTION_WINDOW_MS = 12 * 60 * 60 * 1000;

export const PRINT_DEVICE_SHELLS = ["android", "windows", "browser"] as const;
export type PrintDeviceShell = (typeof PRINT_DEVICE_SHELLS)[number];
```

In `packages/shared/src/self-order-alert.ts`, find:

```ts
// the same predicates run identically wherever the provider mounts.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrintHostState, PrintJobFeedRow, PrintJobResolvedRow } from "./print-job";

/** Server-side scan bound when counting/paging OPEN self-order requests — a
```

Replace it with:

```ts
// the same predicates run identically wherever the provider mounts.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrintAttentionRow } from "./print-agent-wire";
import type { PrintHostState, PrintJobFeedRow, PrintJobResolvedRow } from "./print-job";

/** Server-side scan bound when counting/paging OPEN self-order requests — a
```

In `packages/shared/src/self-order-alert.ts`, find:

```ts
  // Printing Phase 1 Session 1C (spec §9.1): present only when the tab named itself (?device=): how
  // many jobs wait in this device's own line, and the oldest. Absent on a failed read.
  printJobsForMe?: { count: number; oldestCreatedAt: string | null };
}

/** What changed between two consecutive polls, for the provider to act on. */
```

Replace it with:

```ts
  // Printing Phase 1 Session 1C (spec §9.1): present only when the tab named itself (?device=): how
  // many jobs wait in this device's own line, and the oldest. Absent on a failed read.
  printJobsForMe?: { count: number; oldestCreatedAt: string | null };
  // Printing Phase 1 Session 1D (spec §10): every slip that waits for people, cafe-wide: the one
  // waiting-slips panel, its count on the printer button, and the 20 s KOT alarm. Absent on a failed read.
  printAttention?: PrintAttentionRow[];
  printAttentionTruncated?: boolean;
}

/** What changed between two consecutive polls, for the provider to act on. */
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-attention.test.ts lib/print-order-jobs.test.ts lib/self-order-alert-paths.test.ts lib/print-queue.test.ts lib/print-lifecycle-paths.test.ts lib/realtime-paths.test.ts lib/print-queue-fixes.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 175`; `# pass 175`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/packages/shared && npx tsc --noEmit -p . && echo TSC_OK`
Expected: `TSC_OK`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/app/api/order-requests/pulse/route.ts apps/cafe/lib/print-attention.test.ts apps/cafe/lib/print-attention.ts apps/cafe/lib/print-job-actions.ts apps/cafe/lib/print-order-jobs.test.ts apps/cafe/package.json packages/shared/src/print-agent-wire.ts packages/shared/src/self-order-alert.ts
git commit -m "feat(print): the pulse reads the waiting-slips feed and sweeps after its answer; staff retries are aimed at the printing device"
```

---

### Task D3: one waiting-slips panel on every device, its count on the printer button, and the 20 s alarm

**Files:**
- Create: `apps/cafe/lib/print-waiting.ts` (the groups, reasons, ages, the button's count and name, the alarm's rows and words, a tap's notice)
- Create: `apps/cafe/components/print/WaitingSlipsCard.tsx` (the panel section), `apps/cafe/hooks/use-print-job-actions.ts` (retry, confirm, dismiss), `apps/cafe/hooks/use-print-slip-alarm.ts`, `apps/cafe/components/layout/print-waiting-context.ts`, `apps/cafe/lib/printer-panel-open.ts` (the alarm's Show opens the printer sheet)
- Modify: `apps/cafe/components/print/PrinterPanel.tsx` (the card first), `apps/cafe/components/print/PrinterStatusButton.tsx` (the count), `apps/cafe/components/layout/PosPulseProvider.tsx` (the count's narrow context), `apps/cafe/components/print/PrintHostDrain.tsx` (the alarm)
- Create: `apps/cafe/lib/print-waiting.test.ts`; Modify: `apps/cafe/lib/printer-ui-paths.test.ts` (the card joins the 44px / no-jargon hygiene list), `apps/cafe/package.json` (`testChain`)

**Interfaces produced:** `printWaitingGroups(rows, nowMs)`, `printWaitingReason(row, nowMs)`, `printWaitingAge(createdAt, nowMs)`, `printWaitingBadgeOf(pulse)`, `printWaitingName(base, badge)`, `printAlarmRows(rows, deviceId, rung)`, `printAlarmMessage(row)`, `printRetryNotice(answer)`; `usePrintWaitingCount()`; `usePrintJobActions()`; `usePrintSlipAlarm(deviceId)`; `<WaitingSlipsCard pulse />`.

**The panel (D5).** The printer sheet (and /printers) opens with "Slips waiting" when any slip waits: three plain groups, Waiting for the printer (Print now, Clear), Check the bill (Print again, It printed, Clear), Couldn't print (Retry, Clear). Each row names the slip, its age and why, with no server words. A tapped row stays disabled until it leaves the feed. A tap wakes this device's agent (`kickPrintAgent`) and refreshes the pulse once; "Print now" on a slip whose printer is merely off answers "It prints by itself as soon as the printer is ready." The card comes first in the panel (before the printer's status), and the printer button shows the count ("3", "20+") on every screen, `/pos` included, through a narrow context like the dot.

**The alarm (D4).** The first pulse after a KOT has waited 20 s rings once (the cafe's sound setting) and leaves a lasting notice on the device that asked for it and on the device that prints it; a bill to check tells its cashier. It rides the pulse already polled (a query-cache subscription), and the notice goes when the slip leaves the feed. So it fires between 20 s and 40 s. On a phone the notice covers the top bar (the gate's E2E), so it carries its own **Show** button, which opens the printer sheet (`lib/printer-panel-open.ts`, a window event the printer button listens to).

**Readback (D3), ruled at the gate.** A slip that prints needs nobody: the panel, the count and the alarm show every slip that did not print within 20 s, with its state. The dashboard band's readback chips and its host-only stale rows are unchanged for one release (their legacy claim and the panel's retry race on the row's CAS, so nothing prints twice); they go with the old claim drain.

- [ ] **Step 1: The failing tests first**

Create `apps/cafe/lib/print-waiting.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { stripComments } from "@/lib/source-pin-utils";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";
import {
  PRINT_WAITING_TITLES,
  printAlarmMessage,
  printAlarmRows,
  printRetryNotice,
  printWaitingAge,
  printWaitingBadgeOf,
  printWaitingGroups,
  printWaitingName,
  printWaitingReason,
} from "@/lib/print-waiting";

// Printing Phase 1 Session 1D (spec §10, the owner's decision after Session 1B): the one waiting-slips
// panel, its count on the printer button, and the 20 s alarm. Pure rules here; the wiring pins below.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const lines = (s: string): number => s.replace(/\n$/, "").split("\n").length;
const T0 = Date.parse("2026-10-03T12:00:00.000Z");
const ago = (ms: number): string => new Date(T0 - ms).toISOString();

function row(over: Partial<PrintAttentionRow> = {}): PrintAttentionRow {
  return { id: "j1", kind: "kot", label: "KOT round 1 · T-4", status: "queued", labels: [], createdAt: ago(30_000), ...over };
}

test("three groups in plain words, in this order, empty groups left out", () => {
  assert.deepEqual(PRINT_WAITING_TITLES, { printer: "Waiting for the printer", bill: "Check the bill", failed: "Couldn't print" });
  const groups = printWaitingGroups([row({ id: "f", status: "failed" }), row({ id: "q" }), row({ id: "b", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm" })], T0);
  assert.deepEqual(groups.map((g) => [g.group, g.title, g.rows.map((r) => r.row.id)]), [
    ["printer", "Waiting for the printer", ["q"]],
    ["bill", "Check the bill", ["b"]],
    ["failed", "Couldn't print", ["f"]],
  ]);
  assert.deepEqual(printWaitingGroups([], T0), [], "nothing waiting: no panel section");
});

test("each row says how long it has waited and why, without jargon", () => {
  assert.equal(printWaitingAge(ago(30_000), T0), "just now");
  assert.equal(printWaitingAge(ago(5 * 60_000), T0), "5 min");
  assert.equal(printWaitingAge(ago(75 * 60_000), T0), "1 h 15 min");
  assert.equal(printWaitingReason(row({ lastError: PRINTER_NOT_CONNECTED_MESSAGE }), T0), "The printer is off or not connected.");
  assert.equal(printWaitingReason(row({ labels: ["REPRINT"], lastError: PRINTER_NOT_CONNECTED_MESSAGE }), T0), "The printer is off or not connected.", "the printer being off says so first");
  assert.equal(printWaitingReason(row({ status: "failed", lastError: "lease expired: may have printed" }), T0), "Tried twice. Check the printer, then retry.", "server words never reach the screen");
  assert.equal(printWaitingReason(row(), T0), "Not printed yet.");
  assert.equal(printWaitingReason(row({ labels: ["REPRINT"], lastError: "may have printed" }), T0), "Waiting to print again, marked REPRINT.", "after 20 s it is waiting, not printing (gate E2E)");
  assert.equal(printWaitingReason(row({ createdAt: ago(31 * 60_000) }), T0), "Waiting over 30 minutes: print it now, or clear it.");
  assert.equal(printWaitingReason(row({ kind: "bill", status: "needs-confirm" }), T0), "It may already have printed. Check the printer.");
  assert.equal(printWaitingReason(row({ status: "failed", lastError: "This slip is too long to print." }), T0), "This slip is too long to print.");
  assert.equal(printWaitingReason(row({ status: "failed" }), T0), "Tried twice. Check the printer, then retry.");
  for (const r of [row(), row({ status: "failed", lastError: "x" }), row({ kind: "bill", status: "needs-confirm" })]) {
    assert.ok(!/lease|epoch|queue|agent|host/i.test(printWaitingReason(r, T0)), "no jargon on screen");
  }
});

test("the printer button's count: how many slips wait, '20+' when the feed was cut", () => {
  assert.equal(printWaitingBadgeOf(undefined), "", "no pulse yet: no count");
  assert.equal(printWaitingBadgeOf({ printAttention: [] }), "");
  assert.equal(printWaitingBadgeOf({ printAttention: [row(), row({ id: "j2" })] }), "2");
  assert.equal(printWaitingBadgeOf({ printAttention: Array.from({ length: 20 }, (_, i) => row({ id: `j${i}` })), printAttentionTruncated: true }), "20+");
  assert.equal(printWaitingName("Printer connected — open printer setup", ""), "Printer connected — open printer setup", "unchanged with nothing waiting");
  assert.equal(printWaitingName("Printer connected — open printer setup", "1"), "1 slip waiting — open printer setup");
  assert.equal(printWaitingName("Printer connected — open printer setup", "20+"), "20+ slips waiting — open printer setup");
});

test("the 20 s alarm: a KOT this device asked for or prints, and a bill to check; once per slip until it leaves", () => {
  const rows = [
    row({ id: "mine", originDeviceId: "dev-a", targetDeviceId: "host" }),
    row({ id: "printed-here", originDeviceId: "dev-b", targetDeviceId: "dev-a" }),
    row({ id: "other", originDeviceId: "dev-b", targetDeviceId: "host" }),
    row({ id: "bill", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", originDeviceId: "dev-a" }),
    row({ id: "void", kind: "void", originDeviceId: "dev-a" }),
  ];
  assert.deepEqual(printAlarmRows(rows, "dev-a", new Set()).map((r) => r.id), ["mine", "printed-here", "bill"]);
  assert.deepEqual(printAlarmRows(rows, "dev-a", new Set(["mine", "bill"])).map((r) => r.id), ["printed-here"], "rung once per slip");
  assert.deepEqual(printAlarmRows(rows, "", new Set()), [], "no identity: no alarm");
  // The gate's E2E: on a phone the notice covers the top bar, so it carries its own Show button instead of
  // pointing at the printer icon underneath it.
  assert.equal(printAlarmMessage(row()), "KOT round 1 · T-4 has not printed yet.");
  assert.equal(printAlarmMessage(row({ status: "failed" })), "KOT round 1 · T-4 could not print.");
  assert.equal(printAlarmMessage(row({ kind: "bill", label: "Bill · ORD-1", status: "needs-confirm" })), "Bill · ORD-1 may not have printed.");
});

test("a tap's answer in plain words: done, already handled, or it prints by itself when the printer is ready", () => {
  assert.equal(printRetryNotice({ applied: true, status: "queued" }), null, "done: the row leaves on the next tick");
  assert.equal(printRetryNotice({ applied: false, status: "queued", reason: "wrong-status" }), "It prints by itself as soon as the printer is ready.");
  assert.equal(printRetryNotice({ applied: false, status: "printed", reason: "wrong-status" }), "Already handled.");
  assert.equal(printRetryNotice({ applied: false, status: null, reason: "not-found" }), "Already handled.");
});

test("PIN: the panel shows the waiting slips, the button shows their count, and both stay within their budgets", () => {
  const panel = src("apps/cafe/components/print/PrinterPanel.tsx");
  assert.ok(panel.includes("<WaitingSlipsCard pulse={pulse} />"), "the panel lists them");
  assert.ok(panel.indexOf("<WaitingSlipsCard pulse={pulse} />") < panel.indexOf("<PrinterStatusBanner"), "first: what needs a person, before the printer's status and setup");
  const button = src("apps/cafe/components/print/PrinterStatusButton.tsx");
  assert.match(button, /const waiting = usePrintWaitingCount\(\);/, "a narrow context, never the wide pulse");
  assert.match(button, /const name = printWaitingName\(printerButtonName\(dot\), waiting\);/, "the count is part of the button's name");
  assert.match(button, /\{waiting !== "" && \(/, "a count only when slips wait");
  const card = readFileSync(path.join(REPO_ROOT, "apps/cafe/components/print/WaitingSlipsCard.tsx"), "utf8");
  assert.ok(lines(card) <= 120, "WaitingSlipsCard stays <= 120 lines");
  for (const action of ["retry.mutate(", "confirm.mutate(", "dismiss.mutate("]) assert.ok(card.includes(action), `the card offers ${action}`);
  const actions = src("apps/cafe/hooks/use-print-job-actions.ts");
  assert.match(actions, /kickPrintAgent\(\);/, "a tap wakes this device's agent at once (it may be the one that prints)");
  assert.match(actions, /qc\.invalidateQueries\(\{ queryKey: POS_PULSE_KEYS\.all \}\)/, "the panel refreshes after a tap (one request per tap, never a poll)");
});

test("PIN: the alarm rides the pulse already polled (no request), and only the printing lane's drain mounts it", () => {
  const alarm = src("apps/cafe/hooks/use-print-slip-alarm.ts");
  assert.ok(!/apiGet|apiSend|useQuery\(|refetchInterval|setInterval/.test(alarm), "no request and no poll of its own");
  assert.match(alarm, /qc\.getQueryCache\(\)\.subscribe\(/, "it hears each pulse answer");
  assert.match(alarm, /if \(readDevicePrefs\(\)\.alertSound && isAlertSoundUnlocked\(\)\) playAlertPing\(\);/, "the cafe's sound setting decides");
  assert.match(alarm, /action: \{ label: "Show", onClick: openPrinterPanel \}/, "the notice opens the panel itself (it covers the top bar on a phone)");
  assert.match(src("apps/cafe/components/print/PrinterStatusButton.tsx"), /useEffect\(\(\) => onOpenPrinterPanel\(\(\) => setOpen\(true\)\), \[\]\);/, "the printer button opens its sheet when asked");
  assert.match(src("apps/cafe/components/print/PrintHostDrain.tsx"), /usePrintSlipAlarm\(deviceId\);/, "every device with an identity");
});
```

In `apps/cafe/lib/printer-ui-paths.test.ts`, find:

```ts
  connect: `${PRINT}BrowserPrinterConnect.tsx`,
  picker: `${PRINT}DesktopPrinterPicker.tsx`,
  slip: `${PRINT}PrintHostTestSlip.tsx`,
  classes: `${PRINT}printer-classes.ts`,
  page: "apps/cafe/app/(dashboard)/printers/page.tsx",
  hub: `${SETTINGS}page.tsx`,
```

Replace it with:

```ts
  connect: `${PRINT}BrowserPrinterConnect.tsx`,
  picker: `${PRINT}DesktopPrinterPicker.tsx`,
  slip: `${PRINT}PrintHostTestSlip.tsx`,
  waiting: `${PRINT}WaitingSlipsCard.tsx`,
  classes: `${PRINT}printer-classes.ts`,
  page: "apps/cafe/app/(dashboard)/printers/page.tsx",
  hub: `${SETTINGS}page.tsx`,
```

In `apps/cafe/lib/printer-ui-paths.test.ts`, find:

```ts
  [F.panel, 90, true], [F.where, 150, true], [F.device, 220, true], [F.native, 280, true], [F.paper, 60, true],
  [F.tips, 50, false], [F.advanced, 100, true], [F.card, 260, true], [F.parts, 100, true], [F.picker, 160, false],
  [F.connect, 110, true], [F.section, 50, false], [F.type, 60, false],
];
const hygieneMutations = [
  append("a console call", "// " + "console" + ".log(1)"),
```

Replace it with:

```ts
  [F.panel, 90, true], [F.where, 150, true], [F.device, 220, true], [F.native, 280, true], [F.paper, 60, true],
  [F.tips, 50, false], [F.advanced, 100, true], [F.card, 260, true], [F.parts, 100, true], [F.picker, 160, false],
  [F.connect, 110, true], [F.section, 50, false], [F.type, 60, false],
  // Session 1D: the waiting-slips panel follows the same rules (44px controls, no jargon).
  [F.waiting, 120, true],
];
const hygieneMutations = [
  append("a console call", "// " + "console" + ".log(1)"),
```

In `apps/cafe/package.json`, find:

```json
    "lib/print-agent.test.ts",
    "lib/print-agent-paths.test.ts",
    "lib/print-attention.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
    "lib/pos-install-paths.test.ts",
```

Replace it with:

```json
    "lib/print-agent.test.ts",
    "lib/print-agent-paths.test.ts",
    "lib/print-attention.test.ts",
    "lib/print-waiting.test.ts",
    "lib/print-routing.test.ts",
    "lib/pos-install.test.ts",
    "lib/pos-install-paths.test.ts",
```

- [ ] **Step 2: Run them (RED)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-waiting.test.ts 2>&1 | grep -E "^# (tests|pass|fail)|Cannot find module"`
Expected: `# Error: Cannot find module '@/lib/print-waiting'`; `# tests 1`; `# pass 0`; `# fail 1`

- [ ] **Step 3: The code**

In `apps/cafe/components/layout/PosPulseProvider.tsx`, find:

```tsx
import type { PrintJobFeedRow } from "@pos/shared/print-job";
import { hostRoutingOf, type PrintHostRouting } from "@/lib/print-routing";
import { PrintHostDotContext } from "@/components/layout/print-host-dot-context";
import { printHostDotOf } from "@/lib/printer/printer-dot";
import {
  prunePrintReadback,
```

Replace it with:

```tsx
import type { PrintJobFeedRow } from "@pos/shared/print-job";
import { hostRoutingOf, type PrintHostRouting } from "@/lib/print-routing";
import { PrintHostDotContext } from "@/components/layout/print-host-dot-context";
import { PrintWaitingContext } from "@/components/layout/print-waiting-context";
import { printWaitingBadgeOf } from "@/lib/print-waiting";
import { printHostDotOf } from "@/lib/printer/printer-dot";
import {
  prunePrintReadback,
```

In `apps/cafe/components/layout/PosPulseProvider.tsx`, find:

```tsx
  // value moves (components/layout/print-host-dot-context.ts).
  const dot = printHostDotOf(data);
  const printJobs = data?.printJobs ?? EMPTY_PRINT_JOBS;

  return (
    <PrintHostDotContext.Provider value={dot}>
```

Replace it with:

```tsx
  // value moves (components/layout/print-host-dot-context.ts).
  const dot = printHostDotOf(data);
  const printJobs = data?.printJobs ?? EMPTY_PRINT_JOBS;
  // Session 1D: the waiting-slips count for the printer button, a plain string like the dot.
  const waiting = printWaitingBadgeOf(data);

  return (
    <PrintHostDotContext.Provider value={dot}>
```

In `apps/cafe/components/layout/PosPulseProvider.tsx`, find:

```tsx
              <PosPulseContext.Provider
                value={{ pulse: data, soundUnlocked, unlock, printHandler, registerKotPrintHandler }}
              >
                {children}
              </PosPulseContext.Provider>
            </PrintReadbackContext.Provider>
          </PrintReadbackRecordContext.Provider>
```

Replace it with:

```tsx
              <PosPulseContext.Provider
                value={{ pulse: data, soundUnlocked, unlock, printHandler, registerKotPrintHandler }}
              >
                <PrintWaitingContext.Provider value={waiting}>{children}</PrintWaitingContext.Provider>
              </PosPulseContext.Provider>
            </PrintReadbackContext.Provider>
          </PrintReadbackRecordContext.Provider>
```

Create `apps/cafe/components/layout/print-waiting-context.ts`:

```ts
"use client";

import { createContext, useContext } from "react";

// Session 1D (spec §10): how many slips wait for people ("", "3", "20+"), as its OWN narrow context,
// derived ONCE in PosPulseProvider (printWaitingBadgeOf) and served as a plain string, exactly like the
// printer dot: the header button reads this instead of the wide pulse context, so a quiet tick
// re-renders nothing. `null` default = the same crash fence as the other pulse accessors.
export const PrintWaitingContext = createContext<string | null>(null);

export function usePrintWaitingCount(): string {
  const count = useContext(PrintWaitingContext);
  if (count === null) {
    throw new Error("usePrintWaitingCount must be used inside <PosPulseProvider>");
  }
  return count;
}
```

In `apps/cafe/components/print/PrintHostDrain.tsx`, find:

```tsx
import { usePrintHostDrainLock } from "@/hooks/use-print-host-lock";
import { usePrintHostPrinterBeat } from "@/hooks/use-print-host-printer-beat";
import { usePrintHostWakeLock } from "@/hooks/use-print-host-wake-lock";
import { useSelfOrderAutoPrint } from "@/hooks/use-self-order-auto-print";
import { printJobRefOf } from "@/lib/print-agent-calls";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
```

Replace it with:

```tsx
import { usePrintHostDrainLock } from "@/hooks/use-print-host-lock";
import { usePrintHostPrinterBeat } from "@/hooks/use-print-host-printer-beat";
import { usePrintHostWakeLock } from "@/hooks/use-print-host-wake-lock";
import { usePrintSlipAlarm } from "@/hooks/use-print-slip-alarm";
import { useSelfOrderAutoPrint } from "@/hooks/use-self-order-auto-print";
import { printJobRefOf } from "@/lib/print-agent-calls";
import type { HostPrintDone } from "@/lib/print-host-outcomes";
```

In `apps/cafe/components/print/PrintHostDrain.tsx`, find:

```tsx
  useSelfOrderAutoPrint({ enabled: hostDrains, busy, queueKotRound, hostLane });

  usePrintAgent({ enabled: drains, isHost: enabled, deviceId, tabId, busy, queueSlip: onSlip });

  return null;
}
```

Replace it with:

```tsx
  useSelfOrderAutoPrint({ enabled: hostDrains, busy, queueKotRound, hostLane });

  usePrintAgent({ enabled: drains, isHost: enabled, deviceId, tabId, busy, queueSlip: onSlip });
  // Session 1D: the 20 s alarm on every device with an identity (the asking one and the printing one).
  usePrintSlipAlarm(deviceId);

  return null;
}
```

In `apps/cafe/components/print/PrinterPanel.tsx`, find:

```tsx
import { usePrintHostDot } from "@/components/layout/print-host-dot-context";
import { PrinterSetupCard } from "@/components/print/PrinterSetupCard";
import { PrinterStatusBanner } from "@/components/print/PrinterStatusBanner";
import { useCanPrintNow, useDesktopPrinterChosen, useDeviceOnline, useDevicePrinter, usePrintLane } from "@/hooks/use-device-printer";
import { printerDotOf, printerHeadlineOf, type PrinterDot } from "@/lib/printer/printer-dot";

```

Replace it with:

```tsx
import { usePrintHostDot } from "@/components/layout/print-host-dot-context";
import { PrinterSetupCard } from "@/components/print/PrinterSetupCard";
import { PrinterStatusBanner } from "@/components/print/PrinterStatusBanner";
import { WaitingSlipsCard } from "@/components/print/WaitingSlipsCard";
import { useCanPrintNow, useDesktopPrinterChosen, useDeviceOnline, useDevicePrinter, usePrintLane } from "@/hooks/use-device-printer";
import { printerDotOf, printerHeadlineOf, type PrinterDot } from "@/lib/printer/printer-dot";

```

In `apps/cafe/components/print/PrinterPanel.tsx`, find:

```tsx
  // sheet and /printers can both be mounted at once).
  return (
    <div data-printer-panel className="space-y-4">
      <PrinterStatusBanner dot={dot.show ? dot : CHECKING_DOT} copy={copy} />
      <PrinterSetupCard />
      {onDone !== undefined && (
```

Replace it with:

```tsx
  // sheet and /printers can both be mounted at once).
  return (
    <div data-printer-panel className="space-y-4">
      <WaitingSlipsCard pulse={pulse} />
      <PrinterStatusBanner dot={dot.show ? dot : CHECKING_DOT} copy={copy} />
      <PrinterSetupCard />
      {onDone !== undefined && (
```

Replace the whole of `apps/cafe/components/print/PrinterStatusButton.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { usePrintHostDot } from "@/components/layout/print-host-dot-context";
import { usePrintWaitingCount } from "@/components/layout/print-waiting-context";
import { PrinterPanel } from "@/components/print/PrinterPanel";
import {
  PRINTER_DOT_BAD_CLASS,
  PRINTER_DOT_CLASS,
  PRINTER_DOT_OK_CLASS,
  PRINTER_ICON_BUTTON_CLASS,
} from "@/components/print/printer-classes";
import { useDesktopPrinterChosen, useDeviceOnline, useDevicePrinter, usePrintLane } from "@/hooks/use-device-printer";
import { printerButtonName, printerDotOf, printerDotTone } from "@/lib/printer/printer-dot";
import { printWaitingName } from "@/lib/print-waiting";
import { onOpenPrinterPanel } from "@/lib/printer-panel-open";
import { cn } from "@/lib/utils";

// The top-bar printer button (all staff). Reads NARROW inputs only — the dot
// context, this device's host flag, the device printer, the lane and the
// network — never the wide pulse, so a quiet pulse tick re-renders nothing
// here. The sheet's panel (mounted only while open) is the one that reads the
// pulse for the labels.
const SHEET_TITLE = "Printer";
const SHEET_DESCRIPTION = "Printer status and setup for this device.";

export function PrinterStatusButton() {
  const [open, setOpen] = useState(false);
  // Session 1D: the 20 s alarm's Show button opens this sheet.
  useEffect(() => onOpenPrinterPanel(() => setOpen(true)), []);
  const remote = usePrintHostDot();
  const { isHostDevice } = usePrintHostContext();
  const snapshot = useDevicePrinter();
  const lane = usePrintLane();
  const online = useDeviceOnline();
  const desktopChosen = useDesktopPrinterChosen();
  // Session 1D: how many slips wait for people, cafe-wide (the panel inside lists them).
  const waiting = usePrintWaitingCount();
  const dot = printerDotOf({ remote, isHostDevice, lane, local: snapshot.status, deviceOffline: !online, desktopChosen });
  const name = printWaitingName(printerButtonName(dot), waiting);
  // A printer that is only being checked draws no dot (never red while it connects).
  const tone = printerDotTone(dot);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={PRINTER_ICON_BUTTON_CLASS}
          aria-label={name}
          title={name}
          data-printer-dot={tone}
          data-printer-waiting={waiting}
        >
          <Printer />
          {tone !== "none" && (
            <span
              aria-hidden="true"
              className={cn(PRINTER_DOT_CLASS, tone === "green" ? PRINTER_DOT_OK_CLASS : PRINTER_DOT_BAD_CLASS)}
            />
          )}
          {waiting !== "" && (
            <span
              aria-hidden="true"
              className="absolute -left-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-semibold leading-5 text-white"
            >
              {waiting}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{SHEET_TITLE}</SheetTitle>
          <SheetDescription>{SHEET_DESCRIPTION}</SheetDescription>
        </SheetHeader>
        <PrinterPanel onDone={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
```

Create `apps/cafe/components/print/WaitingSlipsCard.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { usePrintJobActions } from "@/hooks/use-print-job-actions";
import { printWaitingGroups, type PrintWaitingGroup } from "@/lib/print-waiting";
import type { PosPulseData } from "@pos/shared/self-order-alert";

// Session 1D (spec §10; the owner's decision after Session 1B): the ONE waiting-slips panel, on every
// device, inside the printer sheet (and /printers). Every slip that is not printed and needs a person,
// in three plain groups, each row with its age, its reason and big buttons: Print now / Retry, Print
// again / It printed (a bill to check), and Clear. Prop-driven: PrinterPanel already reads the pulse,
// so this is not another wide-pulse reader. A tapped row stays disabled until it leaves the feed.

const SECTION_TITLE = "Slips waiting";

export function WaitingSlipsCard({ pulse }: { pulse: PosPulseData | undefined }) {
  const rows = pulse?.printAttention;
  const { retry, confirm, dismiss } = usePrintJobActions();
  const [tapped, setTapped] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    setTapped((prev) => {
      const live = new Set((rows ?? []).map((row) => row.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const groups = printWaitingGroups(rows ?? [], Date.now());
  if (groups.length === 0) return null;
  const tap = (id: string, run: () => void) => {
    setTapped((prev) => new Set(prev).add(id));
    run();
  };

  const actions = (group: PrintWaitingGroup, id: string) => {
    const off = tapped.has(id);
    const clear = (
      <Button variant="outline" className={PRINTER_ACTION_CLASS} disabled={off} onClick={() => tap(id, () => dismiss.mutate(id))}>
        Clear
      </Button>
    );
    if (group === "bill") {
      return (
        <>
          <Button className={PRINTER_ACTION_CLASS} disabled={off} onClick={() => tap(id, () => confirm.mutate({ id, decision: "reprint" }))}>
            Print again
          </Button>
          <Button variant="outline" className={PRINTER_ACTION_CLASS} disabled={off} onClick={() => tap(id, () => confirm.mutate({ id, decision: "printed" }))}>
            It printed
          </Button>
          {clear}
        </>
      );
    }
    return (
      <>
        <Button className={PRINTER_ACTION_CLASS} disabled={off} onClick={() => tap(id, () => retry.mutate(id))}>
          {group === "failed" ? "Retry" : "Print now"}
        </Button>
        {clear}
      </>
    );
  };

  return (
    <section aria-label={SECTION_TITLE} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
      <h3 className="text-base font-semibold">
        {SECTION_TITLE}
        {pulse?.printAttentionTruncated ? " (the oldest 20)" : ""}
      </h3>
      {groups.map((section) => (
        <div key={section.group} className="space-y-2">
          <p className="text-sm font-semibold">
            {section.title} ({section.rows.length})
          </p>
          <ul className="space-y-2">
            {section.rows.map(({ row, reason, age }) => (
              <li key={row.id} className="rounded-md bg-background p-3">
                <p className="text-base font-medium">{row.label}</p>
                <p className="text-sm text-muted-foreground">
                  {age} · {reason}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">{actions(section.group, row.id)}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
```

Create `apps/cafe/hooks/use-print-job-actions.ts`:

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PrintActionData } from "@pos/shared/print-agent-wire";
import type { PrintJobDecision } from "@pos/shared/print-lifecycle";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { PRINT_JOB_KEYS, useDismissPrintJob } from "@/hooks/use-print-host";
import { apiSend } from "@/lib/api-client";
import { kickPrintAgent } from "@/lib/print-agent";
import { printRetryNotice } from "@/lib/print-waiting";

// Session 1D (spec §10): the waiting-slips panel's three actions, on the server routes Phase 1A built
// (retry, confirm, dismiss). After a tap: wake this device's agent at once (it may be the one that
// prints the slip; with no host the server also aims a print-status at the printing device, D7), and
// refresh the panel. One request per tap, never a poll.

const ACTION_ERROR = "That did not go through. Check the connection and try again.";

export function usePrintJobActions() {
  const qc = useQueryClient();
  const settled = () => {
    kickPrintAgent();
    void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
  };
  const noticeOf = (answer: PrintActionData) => {
    const notice = printRetryNotice(answer);
    if (notice !== null) toast.info(notice);
  };
  const retry = useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: (id: string) => apiSend<PrintActionData>(`/api/print-jobs/${encodeURIComponent(id)}/retry`, "POST", {}),
    onSuccess: noticeOf,
    onError: () => toast.error(ACTION_ERROR),
    onSettled: settled,
  });
  const confirm = useMutation({
    mutationKey: PRINT_JOB_KEYS.mutation,
    mutationFn: ({ id, decision }: { id: string; decision: PrintJobDecision }) =>
      apiSend<PrintActionData>(`/api/print-jobs/${encodeURIComponent(id)}/confirm`, "POST", { decision }),
    onSuccess: noticeOf,
    onError: () => toast.error(ACTION_ERROR),
    onSettled: settled,
  });
  const dismissJob = useDismissPrintJob();
  const dismiss = {
    mutate: (id: string) => dismissJob.mutate(id, { onSettled: settled }),
  };
  return { retry, confirm, dismiss };
}
```

Create `apps/cafe/hooks/use-print-slip-alarm.ts`:

```ts
"use client";

import { useEffect } from "react";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { PosPulseData } from "@pos/shared/self-order-alert";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { isAlertSoundUnlocked, playAlertPing } from "@/lib/alert-sound";
import { readDevicePrefs } from "@/lib/pos-device-prefs";
import { printAlarmMessage, printAlarmRows } from "@/lib/print-waiting";
import { openPrinterPanel } from "@/lib/printer-panel-open";

// Session 1D (spec §10): the 20 s alarm. A KOT still not printed 20 s after it was made (it is in the
// waiting-slips feed from then on) sounds once and shows a lasting notice on the device that asked for
// it AND on the device that prints it; a bill that may already have printed tells its cashier. It rides
// the pulse the provider already polls (a query-cache subscription, never a request or a poll of its
// own), so it fires at the first pulse after the 20 s mark. The notice goes away when the slip leaves
// the feed (printed, cleared); a slip that comes back rings again. On a phone it covers the top bar, so
// it carries its own Show button that opens the printer sheet.

export function usePrintSlipAlarm(deviceId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (deviceId === "") return;
    const rung = new Set<string>();
    const check = (data: PosPulseData | undefined): void => {
      const rows = data?.printAttention;
      if (rows === undefined) return; // a failed read says nothing either way
      const live = new Set(rows.map((row) => row.id));
      for (const id of [...rung]) {
        if (live.has(id)) continue;
        rung.delete(id);
        toast.dismiss(`print-alarm-${id}`);
      }
      const fresh = printAlarmRows(rows, deviceId, rung);
      if (fresh.length === 0) return;
      if (readDevicePrefs().alertSound && isAlertSoundUnlocked()) playAlertPing();
      for (const row of fresh) {
        rung.add(row.id);
        toast.warning(printAlarmMessage(row), {
          id: `print-alarm-${row.id}`,
          duration: Number.POSITIVE_INFINITY,
          action: { label: "Show", onClick: openPrinterPanel },
        });
      }
    };
    check(qc.getQueryData<PosPulseData>(POS_PULSE_KEYS.all));
    const pulseHash = hashKey(POS_PULSE_KEYS.all);
    return qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success" || event.query.queryHash !== pulseHash) return;
      check(event.query.state.data as PosPulseData | undefined);
    });
  }, [deviceId, qc]);
}
```

Create `apps/cafe/lib/print-waiting.ts`:

```ts
import type { PrintActionData, PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { PRINT_HOST_MAX_AGE_MS } from "@pos/shared/print-job";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { printWriteOutcomeOf } from "@/lib/print-write-outcome";

// Printing redesign, Phase 1 Session 1D (spec §10; the owner's decision after Session 1B): the one
// waiting-slips panel, its count on the printer button, and the 20 s alarm, as pure rules. Every slip that
// is not printed and needs a person shows in one of three groups, in plain words, with how long it has
// waited and why. No React, no fetch; the server's words (lease, epoch, attempts) never reach the screen.

export type PrintWaitingGroup = "printer" | "bill" | "failed";

export const PRINT_WAITING_TITLES: Record<PrintWaitingGroup, string> = {
  printer: "Waiting for the printer",
  bill: "Check the bill",
  failed: "Couldn't print",
};

const GROUP_ORDER: readonly PrintWaitingGroup[] = ["printer", "bill", "failed"];
const SERVER_WORDS = /lease|epoch|attempt|limits/i;

function groupOf(row: PrintAttentionRow): PrintWaitingGroup {
  return row.status === "needs-confirm" ? "bill" : row.status === "failed" ? "failed" : "printer";
}

export function printWaitingAge(createdAt: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - Date.parse(createdAt)) / 60_000);
  if (!(minutes >= 1)) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

export function printWaitingReason(row: PrintAttentionRow, nowMs: number): string {
  if (row.status === "needs-confirm") return "It may already have printed. Check the printer.";
  if (row.status === "failed") {
    return row.lastError && !SERVER_WORDS.test(row.lastError) ? row.lastError : "Tried twice. Check the printer, then retry.";
  }
  // Queued: a stale slip needs a tap whatever its printer does (the agent never leases it by itself).
  if (nowMs - Date.parse(row.createdAt) > PRINT_HOST_MAX_AGE_MS) return "Waiting over 30 minutes: print it now, or clear it.";
  if (row.lastError && printWriteOutcomeOf(new Error(row.lastError)).sent === "no") return "The printer is off or not connected.";
  const repeat = row.labels.find((label) => label === "REPRINT" || label === "DUPLICATE");
  if (repeat) return `Waiting to print again, marked ${repeat}.`;
  return "Not printed yet.";
}

export interface PrintWaitingSection {
  group: PrintWaitingGroup;
  title: string;
  rows: Array<{ row: PrintAttentionRow; reason: string; age: string }>;
}

export function printWaitingGroups(rows: readonly PrintAttentionRow[], nowMs: number): PrintWaitingSection[] {
  return GROUP_ORDER.map((group) => ({
    group,
    title: PRINT_WAITING_TITLES[group],
    rows: rows.filter((row) => groupOf(row) === group).map((row) => ({ row, reason: printWaitingReason(row, nowMs), age: printWaitingAge(row.createdAt, nowMs) })),
  })).filter((section) => section.rows.length > 0);
}

/** The printer button's count: "" when nothing waits, "20+" when the feed was cut at its limit. */
export function printWaitingBadgeOf(pulse: Pick<PosPulseData, "printAttention" | "printAttentionTruncated"> | undefined): string {
  const count = pulse?.printAttention?.length ?? 0;
  if (count === 0) return "";
  return pulse?.printAttentionTruncated ? `${count}+` : String(count);
}

/** The button's accessible name: the count comes first while slips wait. */
export function printWaitingName(base: string, badge: string): string {
  return badge === "" ? base : `${badge} slip${badge === "1" ? "" : "s"} waiting — open printer setup`;
}

/** The 20 s alarm (spec §10): a KOT this device asked for or prints, or a bill it should check, once per
 *  slip (`rung`) until the slip leaves the feed. A device with no identity hears nothing. */
export function printAlarmRows(rows: readonly PrintAttentionRow[], deviceId: string, rung: ReadonlySet<string>): PrintAttentionRow[] {
  if (deviceId === "") return [];
  return rows.filter(
    (row) =>
      !rung.has(row.id) &&
      (row.originDeviceId === deviceId || row.targetDeviceId === deviceId) &&
      (row.kind === "kot" || (row.kind === "bill" && row.status === "needs-confirm")),
  );
}

export function printAlarmMessage(row: PrintAttentionRow): string {
  if (row.status === "needs-confirm") return `${row.label} may not have printed.`;
  if (row.status === "failed") return `${row.label} could not print.`;
  return `${row.label} has not printed yet.`;
}

/** What a Retry / Print now tap says when the server did not apply it (null: done). */
export function printRetryNotice(answer: PrintActionData): string | null {
  if (answer.applied) return null;
  if (answer.status === "queued" && answer.reason === "wrong-status") return "It prints by itself as soon as the printer is ready.";
  return "Already handled.";
}
```

Create `apps/cafe/lib/printer-panel-open.ts`:

```ts
// Session 1D: open the top-bar printer sheet from anywhere on the page (the 20 s alarm's Show button).
// On a phone the alarm notice covers the top bar, so it cannot point at the printer icon underneath it.
// A window event, so the sheet's own open state stays inside PrinterStatusButton. Client-only.

const OPEN_PRINTER_PANEL_EVENT = "pos:open-printer-panel";

export function openPrinterPanel(): void {
  window.dispatchEvent(new Event(OPEN_PRINTER_PANEL_EVENT));
}

export function onOpenPrinterPanel(listener: () => void): () => void {
  window.addEventListener(OPEN_PRINTER_PANEL_EVENT, listener);
  return () => window.removeEventListener(OPEN_PRINTER_PANEL_EVENT, listener);
}
```

- [ ] **Step 4: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/print-waiting.test.ts lib/printer-ui-paths.test.ts lib/printer-dot-ui-paths.test.ts lib/pos-pulse-paths.test.ts lib/print-host-band-paths.test.ts lib/print-host-paths.test.ts lib/self-order-alert-paths.test.ts lib/print-agent-paths.test.ts lib/printer/print-gating-paths.test.ts 2>&1 | grep -E "^# (tests|pass|fail)" && npx tsc --noEmit && echo TSC_OK`
Expected: `# tests 129`; `# pass 129`; `# fail 0`; `TSC_OK`

Run: `cd /d/kd/lucifer/apps/cafe && npm test 2>&1 | grep -E "^# (tests|pass|fail|skipped)|^not ok"; npm run lint 2>&1 | tail -2`
Expected: `# tests 4173`; `# pass 4172`; `# fail 0`; `# skipped 1`; `✖ 2 problems (0 errors, 2 warnings)`

- [ ] **Step 5: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/components/layout/PosPulseProvider.tsx apps/cafe/components/layout/print-waiting-context.ts apps/cafe/components/print/PrintHostDrain.tsx apps/cafe/components/print/PrinterPanel.tsx apps/cafe/components/print/PrinterStatusButton.tsx apps/cafe/components/print/WaitingSlipsCard.tsx apps/cafe/hooks/use-print-job-actions.ts apps/cafe/hooks/use-print-slip-alarm.ts apps/cafe/lib/print-waiting.test.ts apps/cafe/lib/print-waiting.ts apps/cafe/lib/printer-panel-open.ts apps/cafe/lib/printer-ui-paths.test.ts apps/cafe/package.json
git commit -m "feat(print): one waiting-slips panel on every device, its count on the printer button, and the 20 s alarm"
```

---

### Task D4: live leg af (the waiting-slips feed) and leg ae's reason for a cancelled order

**Files:**
- Create: `apps/cafe/scripts/print-host-live/attention.ts` (leg af)
- Modify: `apps/cafe/scripts/verify-print-host-live.ts` (run it after ae), `apps/cafe/scripts/print-host-live/agent.ts` (leg ae asserts `reason === "not-eligible"`, the gate's fresh review)

**Interfaces produced:** none (legs only).

Leg (af) runs `readPrintAttention` against real Mongo: a slip made just now is not in it; one still queued after 20 s is, with its `lastError` and asking device; a bill to check and a failed slip are, with their printing device; printed and older-than-12-h rows never are; the oldest is first; a leased slip leaves it; a backlog is cut at 20 and says so.

- [ ] **Step 1: The legs**

In `apps/cafe/scripts/print-host-live/agent.ts`, find:

```ts
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(cancelled) }, { $set: { status: "Cancelled" } });
  const cancelledRequest = await seedSelfOrderRequest(cancelled, 1);
  const refusedClaim = await claimKotPrintForAgent(cancelledRequest, { deviceId: PHONE, bill: false }, nowMs);
  check("(ae) a cancelled order: not eligible, and no job", !refusedClaim.claimed && (await PrintJob.countDocuments({ jobKey: `kot:${cancelled}:1` })) === 0);
  await OrderRequest.deleteMany({});
}

```

Replace it with:

```ts
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(cancelled) }, { $set: { status: "Cancelled" } });
  const cancelledRequest = await seedSelfOrderRequest(cancelled, 1);
  const refusedClaim = await claimKotPrintForAgent(cancelledRequest, { deviceId: PHONE, bill: false }, nowMs);
  check("(ae) a cancelled order: not eligible, and no job", !refusedClaim.claimed && refusedClaim.reason === "not-eligible" && (await PrintJob.countDocuments({ jobKey: `kot:${cancelled}:1` })) === 0);
  await OrderRequest.deleteMany({});
}

```

Create `apps/cafe/scripts/print-host-live/attention.ts`:

```ts
/**
 * Phase 1 Session 1D live leg — the one waiting-slips panel's feed (af), against a REAL MongoDB: which
 * rows every device's pulse carries, in what order, and how it is bounded. Run by
 * scripts/verify-print-host-live.ts after legs ad–ae.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINT_ATTENTION_LIMIT, PRINT_ATTENTION_WINDOW_MS } from "@pos/shared/print-agent-wire";
import { PRINT_KOT_ALARM_MS } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { readPrintAttention } from "@/lib/print-attention";
import { backdatePrintJob, check } from "./harness";
import { HOST, freshHost, lease, queueBill, queueKot, setRaw } from "./lifecycle";

export async function legAF(nowMs: number): Promise<void> {
  console.log("\n(af) the waiting-slips feed: what waits for a person, cafe-wide, bounded");
  await freshHost(nowMs);
  const fresh = await queueKot(nowMs);
  const waiting = await queueKot(nowMs);
  await backdatePrintJob(waiting, new Date(nowMs - PRINT_KOT_ALARM_MS - 5_000));
  await setRaw(waiting, { lastError: "The printer is not connected.", originDeviceId: "phone-1" });
  const bill = await queueBill(nowMs);
  await setRaw(bill, { status: "needs-confirm" });
  const failed = await queueKot(nowMs);
  await setRaw(failed, { status: "failed", lastError: "This slip is too long to print." });
  const printed = await queueKot(nowMs);
  await backdatePrintJob(printed, new Date(nowMs - 60_000));
  await setRaw(printed, { status: "printed" });
  const old = await queueKot(nowMs);
  await backdatePrintJob(old, new Date(nowMs - PRINT_ATTENTION_WINDOW_MS - 60_000));
  await setRaw(old, { status: "failed" });

  let feed = await readPrintAttention(nowMs);
  const ids = feed.rows.map((row) => row.id);
  check("(af) a slip made just now is not waiting yet (it has 20 s to print)", !ids.includes(fresh));
  check("(af) a slip still queued after 20 s waits, with why and who asked", ids.includes(waiting) && feed.rows.find((r) => r.id === waiting)?.lastError === "The printer is not connected." && feed.rows.find((r) => r.id === waiting)?.originDeviceId === "phone-1");
  check("(af) a bill to check and a slip that could not print wait too, with where they print", ids.includes(bill) && ids.includes(failed) && feed.rows.find((r) => r.id === failed)?.targetDeviceId === HOST);
  check("(af) a printed slip and one older than the queued retention never show", !ids.includes(printed) && !ids.includes(old));
  check("(af) the oldest waits first", ids[0] === waiting);

  // A slip being printed right now waits for nobody.
  await backdatePrintJob(fresh, new Date(nowMs - PRINT_KOT_ALARM_MS - 1_000));
  await PrintJob.updateMany({ _id: { $in: [waiting] } }, { $set: { status: "dismissed" } });
  const leased = await lease(nowMs);
  feed = await readPrintAttention(nowMs);
  check("(af) a leased slip leaves the feed while it prints", leased.jobs[0]?.id === fresh && !feed.rows.some((r) => r.id === fresh));

  // Bounded: one read of at most PRINT_ATTENTION_LIMIT rows, and it says when it was cut.
  for (let i = 0; i < PRINT_ATTENTION_LIMIT + 1; i++) {
    const id = await queueKot(nowMs);
    await setRaw(id, { status: "failed" });
  }
  feed = await readPrintAttention(nowMs);
  check("(af) a long backlog is cut at the limit and says so", feed.rows.length === PRINT_ATTENTION_LIMIT && feed.truncated);
}
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
import { legV, legW, legX } from "./print-host-live/lifecycle-actions";
import { legAA, legAB, legAC, legY, legZ } from "./print-host-live/order-jobs";
import { legAD, legAE } from "./print-host-live/agent";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

Replace it with:

```ts
import { legV, legW, legX } from "./print-host-live/lifecycle-actions";
import { legAA, legAB, legAC, legY, legZ } from "./print-host-live/order-jobs";
import { legAD, legAE } from "./print-host-live/agent";
import { legAF } from "./print-host-live/attention";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
```

In `apps/cafe/scripts/verify-print-host-live.ts`, find:

```ts
    // Phase 1 Session 1C legs (the owner's two-attempt rule; the job-aware self-order lane).
    await legAD(Date.now());
    await legAE(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

Replace it with:

```ts
    // Phase 1 Session 1C legs (the owner's two-attempt rule; the job-aware self-order lane).
    await legAD(Date.now());
    await legAE(Date.now());
    // Phase 1 Session 1D leg (the waiting-slips feed every device's pulse carries).
    await legAF(Date.now());
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
```

- [ ] **Step 2: Run (GREEN)**

Run: `cd /d/kd/lucifer/apps/cafe && npx tsc --noEmit && echo TSC_OK && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | tail -3`
Expected: `TSC_OK`; `206 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
cd /d/kd/lucifer
git add apps/cafe/scripts/print-host-live/agent.ts apps/cafe/scripts/print-host-live/attention.ts apps/cafe/scripts/verify-print-host-live.ts
git commit -m "test(print): live leg af (the waiting-slips feed) and leg ae's reason for a cancelled order"
```

---

### Task D5: full verification, builds, the E2E exit check, Results

**Files:** Modify this plan (fill in **Session 1D Results**) and the memory file `printing-redesign-2026-10.md`.

- [ ] **Step 1: Every suite**

```bash
cd /d/kd/lucifer/packages/shared && npm test 2>&1 | grep -E "^# (tests|pass|fail)"; npx tsc --noEmit -p .
cd /d/kd/lucifer/apps/cafe && npm test 2>&1 | grep -E "^# (tests|pass|fail|skipped)|^not ok"; npx tsc --noEmit; npm run lint 2>&1 | tail -4
cd /d/kd/lucifer/apps/hub && npx tsc --noEmit && echo HUB_TSC_OK
cd /d/kd/lucifer/apps/mobile && npx tsc --noEmit && npm run lint && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run test:app 2>&1 | grep -E "^Tests:"
cd /d/kd/lucifer/apps/desktop && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
cd /d/kd/lucifer && npm run test:print-tools 2>&1 | grep -E "^# (tests|pass|fail)"
cd /d/kd/lucifer/apps/cafe && MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live 2>&1 | tail -3
```

Expected:
- shared: **637/637**, tsc 0.
- cafe: **4173 tests, 4172 pass, 0 fail, 1 skipped** (the skip is 1C's `go-live-dl` planning-file pin). If the session merged a newer `origin/main` first, add that merge's own tests and say so in Results.
- cafe: tsc 0; lint 0 errors and the 2 old warnings. Hub: `HUB_TSC_OK`.
- mobile: tsc 0, lint 0, node 114/114, Jest 3/3 (untouched). desktop: 191/191 (untouched). print tools: 7/7.
- live legs: **`206 passed, 0 failed`** (1C's 199, plus (af)'s 7).

- [ ] **Step 2: The Next production build**

Run: `cd /d/kd/lucifer/apps/cafe && npm run build 2>&1 | tail -15`
Expected: success, 123 routes (1D adds no route).

- [ ] **Step 3: Both APKs, x86_64 first** (Session 1A's Task 10 Step 3 commands, `GRADLE_USER_HOME='D:\gradle-home'`)

Expected: `BUILD SUCCESSFUL` twice, each APK holding only its own ABI. 1D changes no app code, so the hashes should equal Session 1C's (`fc4181e4…`, `9f89cd9a…`, `f3f62149…`). Record them either way.

- [ ] **Step 4: The E2E exit check** (local POS + emulator app + fake printer; a failure here is a finding, never faked)

Bring the harness up as Session 1C's Task C6 Step 4, with a fresh database `pos_scratch_e2e_1d` and its own script-generated env file (`secrets`; never printed or committed). Start the emulator, the POS and the fake printer as background commands with a 2-hour limit (a shorter limit kills them mid-run). Sign in with TAB to the password field and check the focus in a uiautomator dump before typing the secret. Choose the network printer `10.0.2.2` : `9100`, then "Print all slips on this device". Use a scratchpad state script (projection without `payload`). Count only the fake printer's `bytes > 0` jobs, and give each fake-printer run its own `--out` folder (its `jobs.log` appends across restarts). A slow swipe (≥ 300 ms) dismisses a notice; a tap low on the screen with the keyboard open lands on the keyboard.

1. **Nothing waits: no count, no section.** The printer button reads "Printer connected — open printer setup" and the sheet shows no "Slips waiting".
2. **The printer off: the alarm, the count, the panel; no attempt burned.** Stop the fake printer (by PID). Send a KOT. Expected: within one pulse after 20 s (by 40 s) the device rings once and shows "KOT round 1 · T-n has not printed yet." with a **Show** button, and the printer button reads "1 slip waiting — open printer setup" with a red "1". Show opens the sheet on "Waiting for the printer (1)": the slip, its age, "The printer is off or not connected.", Print now and Clear. Print now answers "It prints by itself as soon as the printer is ready." The job: one lease, one `failed(not sent: …)`, `uncertainAttempts 0`. Start the fake printer: the slip prints once, unlabelled; the row, the count and the notice are gone within one pulse.
3. **Couldn't print → Retry: one tap, one try.** A scratchpad script creates a KOT as `e2e-script-device` with the agent headers, leases it at once as the host (so the app cannot print it), then sets it as two expired leases leave it (`status: failed`, `uncertainAttempts 2`, `labels: ["REPRINT"]`, `lastError: "lease expired: may have printed"`, the lease removed; the two-attempt rule itself is proven by live leg (ad)). Expected: the host rings with "… could not print."; the panel shows "Couldn't print (1)" · "Tried twice. Check the printer, then retry." with Retry and Clear. Retry: one REPRINT copy prints within seconds (larger than a plain KOT: the banner), the job `printed`, `uncertainAttempts 1`, log `retried(print again)`, and the row leaves within one pulse.
4. **Check the bill → Print again; It printed.** As 1C's item 5 (settle an open order with the bill header, lease the bill as the host, never ack): about 90 s later the host rings "Bill · … may not have printed."; the panel shows "Check the bill" · "It may already have printed. Check the printer." Print again prints one DUPLICATE copy (decode its `GS v 0` raster: the DUPLICATE banner), `confirmed(print again: …)`, `printed`. Repeat with a second bill and tap It printed: `printed`, no paper.
5. **No host: the pulse sweep, and a second device clears a slip.** In the sheet, Stop printing here → Yes, remove. The script creates a KOT as `e2e-script-device` (with no host it is that device's own job) and leases it as that device, never acking. No device leases it again, so only the pulse sweep can expire it: within about 150 s it is `queued`, `REPRINT`, `expired(lease expired: may have printed)`. Expected: the emulator's panel shows it under "Waiting for the printer" (every device sees every waiting slip). The script then clears it as a second device (`POST /api/print-jobs/<id>/dismiss` with `{ reason: "staff" }`): 200, and the row leaves the emulator's panel within one pulse.
6. **I3, recorded, not exercised end to end:** a slip that cannot be drawn cannot be forced on the emulator; Task D1's tests prove it (two refusals of the slip itself while the printer is ready → `failed`; printer refusals never count).
7. **G5, the known TCP limit, recorded:** as Session 1C's Results item 7 (a cut mid-slip is detected only sometimes on Android TCP; Phase 3's `DLE EOT`).
8. Clean up: `adb reverse --remove-all`; stop the POS and the fake printer by PID (`Stop-Process`, command lines checked first); `pm clear com.possoftware.pos`; `adb emu kill`. Leave `pos_scratch_e2e_1d` and its env file for 1E and say so in Results.

`adb logcat -b crash` must hold no entry for `com.possoftware.pos` for the whole step. Record any other entry with its process (the emulator's own Bluetooth stack can crash-loop on a cold boot; `uiautomator dump` itself can crash with "Bad file descriptor"); clear the buffer after boot, before launching the app.

- [ ] **Step 5: Results, memory, commit, push**

Fill in **Session 1D Results** below: every command and its totals; each changed existing pin and why (Tasks D1, D2 and D3 list them); the live-leg count; the APK paths, sizes and hashes; the E2E findings with screenshot paths; every deviation and why; open issues. Update the memory file `printing-redesign-2026-10.md`: Session 1D done with its last commit, and the next step (the 1D review gate, which writes Session 1E).

```bash
cd /d/kd/lucifer
git add docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md
git commit -m "docs(print): Phase 1 Session 1D results"
git log --oneline -10
GIT_TERMINAL_PROMPT=0 git push origin feat/printing-reliability 2>&1 | sed 's/github_pat_[A-Za-z0-9_]*/[REDACTED]/g'
```

Push only with the repo's token credential (check `git config --local --get-all credential.helper` first: an empty line, then the `store --file=…` line). If authentication fails, stop and tell the owner. Do **not** merge, push `main`, or start Session 1E. Report to the owner in Hinglish, then stop.

---

## Session 1D Results (filled in by the implementer)

(Empty until Session 1D runs.)
