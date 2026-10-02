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
| 1B | Server-side job creation in the order routes (header-gated, so tabs from before Phase 1 never duplicate a slip); the repair sweep; the `print-status` realtime kind (+ Worker parity) | Still none until 1C's clients send the header |
| 1C | The agent: coded write outcome (`sent: "no" \| "maybe"`), lease/ack loop, pending-ack store, local retry timers, the §9.1 poll cadence and shared cap; the REPRINT/DUPLICATE banner; order call sites hand `printJobs` to the agent | Slips print through lease → write → ack |
| 1D | Readback (Queued → Printing → Printed / Failed per slip, on `/pos` too), the 20 s alarm, the failed / needs-confirm list on every device, the pulse sweep | Staff see every slip's fate |
| 1E | The Phase 1 exit scenarios with the fake printer, the 200-order soak, TEST-CHECKLIST, and **the owner's measured free-tier check (§17.3 item 5)** | Release candidate |

**Gate rule** ([[phase-per-session-workflow]]):
- After each session, the orchestrating review session deep-reviews it.
- It then writes the next session's exact code into this plan, against the code that actually landed, and commits it before handing over that session's prompt.
- Sessions 1B–1E below are therefore task specifications with their interfaces, tests and exit checks. Their code blocks are filled in at their gate.
- Session 1A is complete, exact code.

---

## Global Constraints

- **Branch:** `feat/printing-reliability` only. Check with `git branch --show-current`. Never commit to `main`, never merge, never push. The owner decides merges.
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
  - D: has about 6.7 GB free.
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

**Gate decisions to confirm first.** The plan's recommendation comes first in each item:

1. **How a request opts in.** Use request headers: `x-pos-device-id` plus `x-pos-print-agent: 1`. This needs an optional `headers` option on `apiSend` (`packages/shared/src/api-client.ts`, shared with the Hub, so the change must be backward compatible).
   - Without the header, the route creates nothing, and a tab from before Phase 1 keeps its client-side printing. Nothing can duplicate.
   - Headers are chosen over a body field because accept has no body and the order schemas are `.strict()`.
2. **The repair marker.** The order CAS records which rounds the server owns, as an omit-empty `kotServerRounds: number[]` (`$addToSet`) and `billServerPrint: true`. The sweep repairs only those, so it never re-creates a slip an old tab printed client-side.
3. **Settle print intent.** Settle prints only when the POS settle sends `x-pos-print-bill: 1`. The Orders-sheet settle never printed, and still doesn't.
4. **Notify Kitchen** stays client-started (decision 9).
5. **Self-order auto-accept.**
   - With a host: create the KOT job for the host and stamp `kotPrintedAt` in the same request, so `/kot-claim` and old tabs never print it again.
   - Without a host: the `/kot-claim` lane stays until Phase 2.

**Tasks:**
- **B1 `lib/print-order-jobs.ts`:** `createOrderPrintJobs(input: { order; event; originDeviceId?; queuedBy; nowMs }, deps?): Promise<PrintJobRef[]>`.
  - Targeting: `host?.deviceId ?? originDeviceId`; no job when both are absent.
  - Keys: v2 jobKeys `<kind>:<orderId>:<round|at>:<targetDeviceId>:<copyIndex>`.
  - Ordering: creates run sequentially in kind order (KOT before bill), so `createdAt` increases (§7.6).
  - Inputs: a JSON round-trip of the lean or hydrated Order into the wire `Order`, and a Zod check of each payload.
  - Never throws. On failure it returns what it made, and the sweep repairs the rest.
  - It publishes `print-status` "created", plus one `print-job` nudge.
  - `PrintJobRef = { id; targetDeviceId; label; kind }`.
- **B2:** wire it into
  - `POST /api/orders` (round 1, plus the bill when Pay Now's numbering is fulfilled);
  - `orders/[id]/items` (the round);
  - `settle` (the bill, header-gated);
  - `items/void` (the void notice from `updated.voids.at(-1)`);
  - `orders/[id]/table` (the moved notice, with `from`, `movedBy` and `movedAt` minted on the server);
  - `order-requests/[id]/accept` (`!replayed`);
  - the public auto-accept (inside the library).

  The response becomes `{ ...order, printJobs }` inside `data`. Update the exact-success-string pins (`write-route-paths.test.ts`) and the 14-site publish pin deliberately; the publish lives in the lib. Replays create nothing.
- **B3:** the repair sweep step 2b. For orders updated in the last 30 min with `kotServerRounds` or `billServerPrint`, recompute the expected v2 keys and insert any that are missing. A duplicate key is a no-op. It stays bounded by `PRINT_SWEEP_BATCH`.
- **B4:** the `print-status` kind.
  - Add it to `CAFE_EVENT_KINDS` and the Worker's `EVENT_KINDS`, with the parity pins.
  - The envelope gains `job: { id, status }` (no order content).
  - `lib/realtime-client.ts` hands listeners the parsed message.
  - Publish on created and on every terminal transition: printed, needs-confirm, failed, dismissed (spec §17.2: 2 per slip).
  - Document the Worker redeploy in `docs/GO-LIVE-CHECKLIST.md`. An old Worker 400s the new kind, the publish is swallowed, and the readback falls back to the pulse.
- **B5:** live legs y–z.
  - The sweep repairs a missing KOT job, and never one for an old-tab round.
  - Creation is idempotent across a route replay.
  - The self-order with a host produces one job plus `kotPrintedAt`.

**Exit:**
- all suites;
- the build;
- both APKs;
- an emulator check that a tab without the header still prints exactly once through today's path, and `curl` with the header creates jobs.

### Session 1C: the agent

- **C1:** a coded write outcome that survives the write queue. Today `device-printer-write.ts` rethrows a bare message (agent finding 2).
  - Define `PrintWriteError { sent: "no" | "maybe"; permanent: boolean }`.
  - The native mapping per §7.5: `NOT_CONNECTED`, `UNAUTHORIZED`, `UNSUPPORTED`, `BUSY` and `BLUETOOTH_OFF` are "no"; `WRITE_FAILED` and `TIMEOUT` are "maybe"; `BAD_REQUEST` and `TOO_LARGE` are permanent.
  - A deadline before the job started is "no". A raster failure is "no".
  - Desktop: blank, too large or before send is "no"; no reply is "maybe".
  - `window.print()` is acked as printed on afterprint; it cannot know more, and the readback says "sent to system print".
- **C2 `hooks/use-print-agent.ts`** replaces the claim drain (`use-print-host-drain.ts` stays for one release, unused).
  - Who runs it: in host mode, only the host device; in no-host mode, every device, for its own line.
  - The device holds a Web Lock, and processes one job at a time.
  - It leases on its own order response's `printJobs`, on a `print-job` nudge, on the wake POST (cadence from `printAgentWakeIntervalMs`, cap from `printWakeAgentCap(agents)`), and on pulse D1 changes once the cap is spent.
  - After a write it acks. A "printed" ack waiting for an answer is kept in `pos.print-ack-pending.v1` and retried every 5 s for 10 min.
  - Local retry timers come from `nextAttemptAt` / `retryAt`.
  - Bridge slips carry `{ jobId, epoch, labels }`.
  - Split the files already at their line budget (`PrintHostProvider.tsx` 200/200, `use-print-host-bridge.ts` 250/250) instead of raising the pins.
- **C3:** a `banner` prop on `KOTReceipt` and `OrderReceipt`: one large inverted block with `printBannerText(labels)` (§7.7).
- **C4:** the order call sites send the 1B headers and hand `printJobs` to the agent; they stop printing locally for server-created kinds. Reprints, EOD and cancel notices `POST /api/print-jobs` with `Idempotency-Key` + `x-pos-device-id`.
- **Exit:**
  - On the E2E harness with the fake printer, a KOT prints through lease → write → ack and the row is `printed` with `printedAt`.
  - `--drop-after 2000` on a KOT prints a REPRINT copy.
  - A mid-bill drop leaves the bill `needs-confirm`.

### Session 1D: readback, alarm, attention list

- **D1:** the pulse adds `myRecentJobs` (`?device=<id>`, the origin index, the last 15 min, limit 30) and `attentionPrintJobs` (needs-confirm, failed, and stale; within 12 h; limit 20). Its read-only pins are amended deliberately.
- **D2:** the pulse runs `sweepPrintJobsThrottled` through `after()`. No-host mode needs lease expiry even when nobody polls wake.
- **D3:** readback states Queued → Printing → Printed ✓ / Failed ⚠ / Waiting for cashier.
  - Sources: the `print-status` event, falling back to `myRecentJobs`.
  - It is visible on `/pos` (amend the `alert-bar-scope` rule) and on the dashboard.
  - It survives a reload, because the server is the source.
- **D4:** the 20 s KOT alarm (`PRINT_KOT_ALARM_MS`, `lib/alert-sound.ts`) on the ordering device and on the printing device, plus a banner.
- **D5:** the attention list on every device, with Print again (retry), It printed / Print again / Dismiss (confirm), and Dismiss. The host-only gate in `PrintHostBandSection.tsx` goes.
- **Exit:** emulator plus fake printer.
  - Pull the printer mid-job: the waiter's screen shows Failed or Waiting for cashier within one pulse.
  - The alarm sounds at 20 s.
  - Each list action works from a second device (a desktop Chrome tab on the local POS is fine).

### Session 1E: Phase 1 exit (spec §14) and the free-tier measurement

**E1** runs the exit scenarios on the harness, with the emulator app as host and the fake printer:
1. A dropped connection mid-KOT prints a REPRINT copy.
2. A mid-bill drop raises the cashier prompt.
3. Killing the host mid-job (`am force-stop`) re-queues it after 90 s, and it prints when the app is back.
4. A deleted job is repaired by the sweep.
5. A 200-order soak loses nothing silently.
   - `apps/cafe/scripts/print-soak.ts` drives the real HTTP API with the agent header against the local POS.
   - The fake printer randomly drops connections.
   - At the end, every job is `printed`, or visibly `failed` / `needs-confirm`.
   - The fake printer's `jobs.log` count matches the printed rows plus the labelled repeats.

**E2** updates TEST-CHECKLIST.md with the new states, labels and exit scenarios for real printers.

**E3 — OWNER STEP (cannot be done by a session): the measured free-tier check, spec §17.3 item 5.**
- **Where:** on a scratch deployment in the owner's own free accounts: Vercel Hobby, Atlas M0, and Cloudflare if realtime is on.
- **Run:** a 2-hour simulated rush with the soak script, against the scratch URL, with fake printers.
- **Read:**
  - Vercel → Usage: invocations, Active CPU, provisioned memory;
  - the Atlas metrics: ops/s peak, and the network.
- **Extrapolate** to a busy day. Pass means:
  - printing uses **≤ 15 % of Active CPU** and **≤ 20 % of invocations** on a normal day;
  - Atlas stays **under 10 ops/s at peak**.
- **If not:** lower the cadences before release.
- **Session help:** the session prepares the scratch-deploy checklist and the soak command. The owner runs the deploy and reads the dashboards. No connector and no upload is involved.

**Exit:** all of §14's Phase 1 criteria, with the measured numbers in Results.

---

## Phase 1 exit criteria (spec §14)

| Criterion | Proven in |
|---|---|
| A dropped connection mid-KOT prints a REPRINT copy | 1C exit, 1E scenario 1 |
| A mid-bill drop raises the cashier prompt | 1C exit, 1E scenario 2 |
| Killing the host mid-job re-queues it after 90 s | 1A leg (r) (server), 1E scenario 3 (end to end) |
| A missing job is repaired by the sweep | 1B legs, 1E scenario 4 |
| No silent loss in a 200-order soak | 1E scenario 5 |
| The measured free-tier budget (§17.3) passes | 1A budget test (estimate), 1E E3 (owner, measured) |

---

## Session 1A Results (filled in by the implementer)

_Not started._
