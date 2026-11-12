# Hotfix: a model's `init()` that rejects once never recovers (the cold-start `Model.init()` race)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development with
> superpowers:test-driven-development (implementers write files only; the controller runs RED then GREEN and commits;
> a reviewer per task). One session. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a server process never keeps failing a write because of how its first requests raced its database
connection. Every write that awaits a model's index build (the house rule "await `X.init()` before a write whose
correctness is a unique index") keeps that guarantee, still fails closed when the index really cannot be built, and
recovers by itself when the only problem was timing.

**Branch:** `fix/model-init-race` from `main` `4bd357c` (printing Phase 6 merged and pushed). Never on `main`; merge and
push only on the owner's explicit word.

## The bug (found in printing Phase 6 Session 6B, 2026-11-12; reproduced read-only the same day)

**What was seen:** during Session 6B's harness runs (a fresh database, `next start`, the POS page's first requests),
a server process sometimes answered 500 to the first station read ("Failed to load the stations": its default
"Kitchen" seed) and to printer creates ("Failed to add the printer"), and kept answering 500 for as long as that process
lived; roughly one cold start in four to one in three. A fresh process usually worked.

**Root cause (mongoose 8.24.0, `apps/cafe/lib/db.ts`):**
1. `mongoose.model(name, schema)` starts `model.init()` at once (`node_modules/mongoose/lib/mongoose.js:670`, its
   rejection swallowed there) and `Model.init()` memoizes its promise in `model.$init` (`lib/model.js:1078-1150`).
2. `connectDB()` connects with `bufferCommands: false`. A model compiled while the connection is **connecting** (another
   request's `connectDB()` in flight while this request's route module is imported) runs `_createCollection` →
   `conn._waitForConnect()` returns at once (no buffering) → `this.db.createCollection` with `conn.db` still
   `undefined` → `TypeError: Cannot read properties of undefined (reading 'createCollection')`.
3. **Any rejection of a model's first `init()` is kept for the process.** Besides "compiled while connecting", the same
   TypeError comes from a model compiled after a FAILED first connect attempt (`connectDB()` drops its promise and
   retries, `lib/db.ts:62-64`; `conn.db` was never set: verified read-only by the plan review), and any transient
   server error during the first automatic build (a failover while `createCollection` / `createIndex` runs) is
   memoized the same way.
4. Every later `await Model.init()` in that process returns the same rejection: the "house rule" call sites turn a
   one-off timing problem into a 500 for the process's whole life.
5. A model compiled before `connect()` is first called (an ordinary cold start) waits for the connection (buffering is
   still the default then) and is fine; one compiled after the connection opened is fine.

**Read-only reproduction** (2026-11-12, writes nothing): `mongoose.connect(uri, { bufferCommands: false })` not awaited,
then `mongoose.model("ReproDuring", schemaWithUniqueName)` (readyState 2 = connecting), then `await` the connect: the
model's `init()` rejects `Cannot read properties of undefined (reading 'createCollection')`, and again on every later
call; no database is created. Script: `D:\kd\pos-dev-keep\hotfix\model-init\repro-init.mjs` (run from `apps/cafe`).

**Production (every deployed account):** the TypeError is thrown in the client before any server command, so it does
not depend on the database being fresh: an established cafe's server instance whose first requests overlap (two
requests in one instance while its connection opens, or a slow / failed first connect on Atlas) can fail the 12 writes
below until the instance is recycled — creating a category, product, reservation, event, area or expense, recording a
due payment, accepting a QR order with a promo, a printing device's beat, a new cafe's first station, adding a
printer. The harness saw it on fresh databases only because its first requests are creates.

**The affected call sites** (every server `await X.init()`; each guards a unique index):

| File | Line | Model | What fails for the process's life |
|---|---|---|---|
| `lib/crud-route.ts` | 151 | `config.model` | POST of categories, products, reservations, events (`app/api/*/route.ts` via `createCollectionRoute`) |
| `app/api/areas/route.ts` | 64 | `Area` | adding an area |
| `app/api/areas/[id]/route.ts` | 42 | `Area` | renaming an area |
| `app/api/expense-categories/route.ts` | 56 | `ExpenseCategory` | adding an expense category |
| `app/api/expense-categories/[id]/route.ts` | 48 | `ExpenseCategory` | renaming one |
| `lib/expenses/categories.ts` | 59 | `ExpenseCategory` | the first expense categories' seed |
| `lib/expenses/entries-write.ts` | 57 | `ExpenseEntry` | adding an expense |
| `lib/due-payment.ts` | 239 | `DuePayment` | recording a due payment (money path: fails closed, today forever) |
| `lib/order-request-accept-promo.ts` | 193 | `PromoRedemption` | accepting a QR order with a promo |
| `lib/print-device.ts` | 29 | `PrintDevice` | a printing device's beat (printers mode, the wake share) |
| `lib/print-stations.ts` | 54 | `Station` | the default station's seed (a new cafe's first station read) |
| `lib/print-printers.ts` | 108 | `Printer` | adding a printer |

`lib/order-idem.ts` already avoids the trap (`memoizeUntilFailure` around its own `createIndex`, :80-95: "unlike
Model.init(), whose memoized rejection would stand for the instance's life"); it is the precedent for this fix. Test
scripts under `apps/cafe/scripts/verify-*-live.ts` call `init()` too: they connect first and are left as they are
(only the comment at `scripts/verify-dues-live.ts:399`, which names the `.init()` await, is reworded).

**Knowingly NOT fixed here:** a model compiled in the window that no call site guards (`Order`, `Table`, `Staff`, …)
silently skips its automatic index build in that instance (`mongoose.js:670`), as today; its indexes come from any
other instance's build. No model in `apps/cafe/models` sets `autoIndex`, `autoCreate`, `autoSearchIndex`, `capped` or
`timeseries` (checked by the plan review).

## The fix (decided here; the implementers follow it)

One helper beside `connectDB()` in `apps/cafe/lib/db.ts`, used at every call site above instead of `await X.init()`:

```ts
/** A model with an index build to await: structural, so no `Model<any>` (lint). */
export interface ModelLike {
  init(): Promise<unknown>;
  createCollection(): Promise<unknown>;
  createIndexes(): Promise<unknown>;
}
/** The house rule "await the unique index before the write", made safe. Each call: connect, then mongoose's own
 *  init() (mongoose memoizes it, and resets it on dropDatabase / disconnect, as today). If init's memo is a
 *  rejection (its first run began while the connection was connecting, after a failed connect, or hit a transient
 *  error), do init's work again through the public API: createCollection (tolerates "exists", code 48; applies the
 *  schema's collection options) then createIndexes (the schema's own indexes, the same options as init's build).
 *  Only that fallback is memoized per model: a success is kept for the process, a failure is dropped so the next
 *  call tries again, and the caller's write still fails CLOSED. Unlike init, the fallback ignores `autoIndex: false`,
 *  a per-index `_autoIndex: false` and never builds search indexes; no model uses any of them (a GATE test pins it). */
export function createModelReady(connect: () => Promise<unknown>): (model: ModelLike) => Promise<void>;
export const modelReady = createModelReady(connectDB);
```

- Per call: `await connect(); try { await model.init(); return; } catch { await fallbackFor(model)(); }`, where
  `fallbackFor(model)` is a per-model (`WeakMap`) `memoizeUntilFailure(async () => { await model.createCollection();
  await model.createIndexes(); })`. The happy path is literally today's (`init()` awaited, mongoose's own memo).
- `memoizeUntilFailure` moves out of `lib/order-idem.ts` into its own `lib/memoize-until-failure.ts` (no imports, the
  same doc). `lib/order-idem.ts` keeps using it locally (`:104`) and re-exports it, so it must be
  `import { memoizeUntilFailure } from "./memoize-until-failure";` plus `export { memoizeUntilFailure };` (a bare
  `export … from` does not bind it locally); `lib/order-idem-index.test.ts` and its pin (`:110`,
  `memoizeUntilFailure(() => createIdemKeyIndex(Order.collection))`) stand unchanged. `lib/db.ts` imports it from
  the new file (no import cycle).
- Call sites: `await X.init();` → `await modelReady(X);` in the same position. Import `modelReady` from `@/lib/db`:
  add it to the existing `connectDB` import where there is one; four files need a new import line
  (`lib/print-device.ts`, `lib/print-stations.ts`, `lib/print-printers.ts`, `lib/order-request-accept-promo.ts`).
  Their headers that say "Never calls connectDB()" (`print-device.ts:10`, `print-stations.ts:14`,
  `print-printers.ts:13`) become "never calls connectDB() itself" (`modelReady` awaits the already open connection);
  the pins `print-setup-paths.test.ts:131`, `:185` and `print-lifecycle-paths.test.ts:423` (`/connectDB\(/`) stay green
  by letter: check them.
- The long "house rule" comment above each call shrinks to one line pointing at `modelReady` (its doc now carries the
  reason). Files over 300 never grow: `lib/due-payment.ts` 371 (its 8-line comment at :231-238 → one line that keeps
  the words "fails CLOSED on a money path"), `lib/order-request-accept-promo.ts` 302 (+1 import, its 5-line comment at
  :188-192 → one line: net ≤ 302); `lib/crud-route.ts` is at 299 (its 6-line comment at :145-150 shrinks; the import is
  already there). `wc -l` every touched file before and after.
- Unchanged: an `init()` that resolves (one await, mongoose's memo), the order of every call site (still after its
  `connectDB()` / validation, still before its write), the money path's fail-closed rule, every request and response.
  No client change, no new HTTP request, no new timer, no schema or data change.

**Cost if wrong:** a call site where `init()` fails for a real reason (a duplicate row blocks a unique index) now runs
`createCollection` + `createIndexes` again on each call instead of returning the memoized rejection: a few database
commands per failing request on an already broken path; the write still fails closed. Otherwise at most one
`createCollection` + the model's `createIndexes` per affected model per instance. Accepted.

**Rollback:** revert the merge commit; safe both ways (no data or schema change; the fallback builds only each schema's
own indexes).

## Global constraints

- Branch only (`fix/model-init-race`); never merge or push without the owner's explicit word; push only with the token
  store (`GIT_TERMINAL_PROMPT=0`), `origin/main` fetched first.
- Test first for every code change; files ≤ 300 lines (tests too); a file over 300 never grows; every assertion carries
  a message; a new cafe test file goes into `apps/cafe/package.json` `testChain`.
- Exact-line source pins move only on purpose, with their reason, shown to bite: `lib/areas-route-paths.test.ts`
  (titles, landmarks and messages at :80, :88, :96, :101, :123, :132), `lib/order-request-paths.test.ts:1561`
  ("await PromoRedemption.init()"), `lib/print-lifecycle-paths.test.ts:356` ("await PrintDevice.init();" before
  "PrintDevice.updateOne("); `lib/expenses/expenses-pins.test.ts:126` reads the first `"ExpenseCategory."` in each
  handler, which shifts once `ExpenseCategory.init()` is gone (expected still green: check); plus any pin a search for
  `.init()` in `apps/cafe/lib/**/*.test.ts` finds. A GATE test forbids a local `stripComments` (use
  `lib/source-pin-utils.ts`).
- Nothing in `apps/mobile`, `apps/desktop`, `workers`, the printing renderers or the S1 43-file pin changes;
  `packages/shared/src/print-budget.test.ts` unchanged.
- Local only: no connectors, Artifacts, Docs, uploads, deploy or tunnels; the live demo read-only without login.
  mongod 127.0.0.1:27017 is shared: only new `pos_scratch_*` databases, dropped at the end (a repo live script drops
  its own; Claude's own `dropDatabase` one-liners are refused: leave a drop script in `D:\kd\pos-dev-keep\hotfix\`).
- Free tier ₹0: no new HTTP request, write or timer; only the fallback costs database commands.
- Repo text in English; messages to the owner in Hinglish; commit messages through a scratch file + `git commit -F`,
  ending with the session's Co-Authored-By line.

## Tasks

### Task 0: Baseline
- [ ] `df -h /c /d`; `git status` clean; on `fix/model-init-race`; `GIT_TERMINAL_PROMPT=0 git fetch origin` (if
  `origin/main` moved past `4bd357c`, merge it in first, `--no-ff`, and re-run the suites).
- [ ] Record: cafe `npm test` (8387: 8386 / 0 / 1 skip on `4bd357c`), `npm run typecheck` 0, lint 0 errors / 2 old
  warnings, shared 1090, `apps/mobile` 173, and the live legs of the touched paths, each on its own fresh
  `pos_scratch_*` database (each script drops its own): `verify:print:live` (524 / 0), `verify:dues:live` (its G2 leg,
  `scripts/verify-dues-live.ts:391-415`, exercises the `DuePayment` index await), `verify:areas:live`,
  `verify:expenses:live`, `verify:order-request:live`, `verify:menu:live`.
- [ ] Run the read-only reproduction (`D:\kd\pos-dev-keep\hotfix\model-init\repro-init.mjs` from `apps/cafe`): the
  "during" model's `init()` rejects twice with the `createCollection` TypeError, and no database appears.

### Task 1: `memoizeUntilFailure` in its own file, `createModelReady` / `modelReady` in `lib/db.ts`
- Create `apps/cafe/lib/memoize-until-failure.ts` (moved body, same doc); `lib/order-idem.ts` imports and re-exports it
  as said above.
- Add to `lib/db.ts`: `ModelLike`, `createModelReady(connect)`, `modelReady` (the doc above, verbatim in substance).
- Test first, `apps/cafe/lib/model-ready.test.ts` (fake models: `init`, `createCollection`, `createIndexes` as
  counting fakes; a fake `connect`), RED (module/export missing) before any source change:
  1. `init()` resolves → resolves; the fallback never runs; each call awaits `connect` and `init` (mongoose memoizes
     `init`), nothing else.
  2. `init()` rejects (every time, like a memoized rejection) → `createCollection` then `createIndexes`, in that order,
     after `connect`; resolves; a later call awaits `init` (rejects again) but the fallback does not run again.
  3. `createIndexes` rejects (an 11000) → the call rejects with that error (fails closed); the next call runs the
     fallback again.
  4. `createCollection` rejects → `createIndexes` is not called; the call rejects with that error; the next call runs
     the fallback again.
  5. two concurrent calls whose `init` rejects run the fallback once.
  6. two models have separate fallback memos.
  7. `connect` rejects → the call rejects and nothing else runs; the next call tries again.
- `lib/order-idem-index.test.ts` stays green untouched.

### Task 2: every call site uses `modelReady`
- The 12 call sites in the table above, as "The fix" says (same position, imports, headers, shortened comments,
  `wc -l` before and after; no file over 300 grows).
- Test first: a GATE test `apps/cafe/lib/model-ready-pins.test.ts` (with `lib/source-pin-utils.ts`'s `stripComments`):
  (a) no non-test source under `apps/cafe/app`, `apps/cafe/lib`, `apps/cafe/models` calls `.init()` on anything, uses
  `.$init`, `ensureIndexes(` or `syncIndexes(`; (b) no schema in `apps/cafe/models` sets `autoIndex`, `autoCreate` or
  `autoSearchIndex` (the fallback ignores them); (c) each of the 12 sites awaits `modelReady(<its model>)` exactly once,
  before its write (the moved landmarks). RED on `4bd357c`: (a) lists the 12.
- Move the pins named in the Global Constraints on purpose (show each bites on a scratch variant), keeping their
  ordering checks (validate → connect → modelReady → the count / the write). Reword the comment at
  `scripts/verify-dues-live.ts:399`.

### Task 3: the live leg (the real race on the local mongod)
- New `apps/cafe/scripts/verify-model-ready-live.ts` + `"verify:model-ready:live"` in `package.json` (the
  `verify-print-host-live.ts` safety pattern: refuses a database whose name lacks `pos_scratch`; drops its database at
  the start and the end). Steps:
  1. Call the app's own `connectDB()` un-awaited (its real options and cache), compile a fresh model with a unique
     index while connecting, then await the connect. Assert its `init()` rejects (the bug as it is): this assertion is
     the intended tripwire that fails when a mongoose upgrade fixes the race (then revisit the helper).
  2. `await modelReady(Model)` resolves; `listIndexes` shows the unique index; a duplicate insert answers 11000; a
     second `modelReady` call sends no `createIndexes` (count them with the driver's command monitoring or a spy).
  3. Fail closed on the real database: a second fresh model compiled in the window, two rows with the same unique
     value inserted before any index exists → `modelReady` rejects with 11000, rejects again on the next call, and
     resolves once the duplicate row is removed (the index then exists).
- Run it on `pos_scratch_model_ready_live`: all pass; the database dropped by the script.

### Task 4: the cold-start check end to end (before vs after)
- Two builds as in Phase 6 Session 6B (worktrees on `D:\kd`, `link-modules.ps1`, the nocache edit,
  `NEXT_TELEMETRY_DISABLED=1`, `df -h /d` first): before = `main` `4bd357c`, after = this branch's head.
- The 6B harness (`D:\kd\pos-dev-keep\phase6\session-6b\`, copied to `D:\kd\pos-dev-keep\hotfix\model-init\`) WITHOUT
  its two accommodations (no `seed-station.mjs` pre-seed, no `warm6b.mjs`): each cold start = a fresh
  `pos_scratch_e2e_4g_mi*` database + a fresh `next start` + the `setup` step (the page's first requests race the
  connection; stations, categories, 4 printers through the API). Count per cold start: GET `/api/stations` 500s,
  printers created (want 4), the server log's `createCollection` errors.
- Before: 10 cold starts (expected at least one failure; if none, 10 more, and report the counts as they are).
  After: 20 cold starts, expected 20 / 20 with 4 printers each and no 500 (at a one-in-four base rate, 20 clean runs by
  luck ≈ 0.3 %).
- Then one M1 round (`pw-6b.mjs m1 1`) on the after build: prints as in 6B (paper and requests unchanged).

### Task 5: the final review and the Results
- Every suite (cafe, typecheck, lint, shared, mobile) and every live leg of Task 0 plus `verify:model-ready:live`.
- A fresh Claude Fable review of `4bd357c..HEAD` (read-only; on an HTTP 429 wait for the reset and say so; never switch
  models silently): the helper's semantics (happy path identical, fail closed, recovery), every call site's order,
  the pins and the GATE, the live leg, the cold-start counts. One fix wave if "With fixes"; a re-check.
- "Results" at the end of this file (commits, RED → GREEN, counts before → after, the cold-start counts, the review),
  memory updated, then the owner's merge OK (and his push word).

## Review Focus

1. The happy path is literally today's behaviour: `init()` resolving is awaited, nothing else runs.
2. Fail closed: a real index failure still fails the write (the money path in `lib/due-payment.ts` above all), proven
   on the real database (Task 3 step 3).
3. Recovery: after the race, the same process succeeds on the next call; no permanent 500.
4. No call site moved its `modelReady` before its `connectDB()` / validation or after its write.
5. No file over 300 grew; no pin loosened; the GATE test bites.

## The planning check (2026-11-12)

A read-only Claude Fable check of this plan against the code and mongoose's source ("With fixes": 0 Critical,
5 Important, 9 Minor; report `D:\kd\pos-dev-keep\hotfix\model-init\plan-review.md`), all folded above: I1 a structural
`ModelLike` (no `Model<any>`); I2 any first-init rejection is sticky (a failed connect too, verified read-only); I3 the
production impact, the rollback and what is not fixed; I4 the live legs of every touched path and a fail-closed step on
the real database; I5 only the fallback is memoized (mongoose keeps its own `init` memo and its resets); the minors
(the four new imports and "never calls connectDB() itself"; the import + re-export; a wider GATE; the fallback's
differences documented; the `createCollection`-rejects test; the live leg uses `connectDB()` itself as a tripwire;
20 "after" cold starts; the full pin list; the comment shrinks). Confirmed: the call-site table and every line number,
`$init` the only memoized API involved, no model with `autoIndex` / `autoCreate` / `capped` / `timeseries`,
`createCollection` tolerates code 48 and the fallback's index options equal init's, no import cycle, no S1 file, the
`WeakMap` key, the ledger / core connections not exposed.

## Results

Hotfix session 2026-11-12, branch `fix/model-init-race` from `main` `4bd357c` (`origin/main` was still `4bd357c`: no
merge needed). Not pushed, not merged.

**Commits:** `a14ed50` the plan; `b121d51` Task 1 (`lib/memoize-until-failure.ts`, `ModelLike` /
`createModelReady` / `modelReady` in `lib/db.ts`, `lib/model-ready.test.ts`); `bb2b4e2` Task 2 (the 12 call sites,
the moved pins, the GATE `lib/model-ready-pins.test.ts`, two script edits); `050cab3` Task 3
(`scripts/verify-model-ready-live.ts`, `verify:model-ready:live`); this Results commit.

**RED → GREEN** (each checked by the session itself: the old or a naive file put back beside the new test, run,
restored byte-identical):
- Task 1: `lib/db.ts` at `a14ed50` → `model-ready.test.ts` 7 / 7 fail ("createModelReady is not a function") → 7 / 7.
- Task 2: the 12 sources at `b121d51` → GATE (a) fails listing exactly the 12 files, (c) fails, (b) passes → 3 / 3.
  The task review (opus) showed GATE (c)'s first form vacuous for `entries-write.ts` / `print-device.ts` (a landmark
  that recurs later in the file); (c) now anchors each site on its own function (start < its own `connectDB()` <
  `modelReady` < its first write) and bites: a `modelReady` moved after `ExpenseEntry.create(`, and the crud POST's own
  `connectDB()` removed, each fail it. The moved pins (`areas-route-paths`, `order-request-paths:1561`,
  `print-lifecycle-paths:356`) keep their ordering chains and were each shown to bite.
- Task 3: `lib/db.ts` given a naive `modelReady` (connect + `init()` only) → the live leg 6 passed / 8 failed (2a–2d,
  3c, 3d, 3f, 3g) → 14 passed / 0 failed; the database dropped by the script.

**Decisions beyond the plan's text** (each recorded with its reason): the GATE's (a) allows exactly one `.init(` in
non-test sources, `lib/db.ts`'s `model.init()` inside `createModelReady` (the fix itself needs it);
`scripts/verify-reward-assign-live.ts` sets `process.env.MONGODB_URI` before its own bare `mongoose.connect` (it reaches
`claimPromoRedemption` → `modelReady` → `connectDB()`; without the line its no-env default fails 16 / 6, with it
22 / 0, as before the hotfix); `lib/print-printer-test.ts`'s header says "never calls connectDB() itself" like the
three print libs (comment only).

**Counts, `4bd357c` → `050cab3`:** cafe 8387 (8386 / 0 / 1 skip) → 8397 (8396 / 0 / 1: +7 helper, +3 GATE); tsc 0 → 0;
lint 0 errors / 2 old warnings → the same; shared 1090 → 1090; `apps/mobile` 173 → 173. Live legs, each on its own
scratch database: print 524 / 0 → 524 / 0, dues 102 / 0 → 102 / 0 (its G2 leg awaits `modelReady(DuePayment)`), areas
82 / 0 → 82 / 0, expenses 72 / 0 → 72 / 0, order-request 247 / 0 → 247 / 0, menu 51 / 0 → 51 / 0, reward-assign 22 / 0
→ 22 / 0, reward-redeem 26 / 0 → 26 / 0, model-ready (new) 14 / 0. Line counts: `lib/due-payment.ts` 371 → 364,
`lib/order-request-accept-promo.ts` 302 → 299, `lib/crud-route.ts` 299 → 294, `lib/print-printers.ts` 159 → 160; no
file over 300 grew. Nothing outside `apps/cafe` changed (no `apps/mobile`, `apps/desktop`, `workers`, `packages`).

**The cold-start check (Task 4):** two `next build` worktrees (`D:\kd\mi0` = `4bd357c`, `D:\kd\mi1` = `050cab3`,
153 routes each), the Session 6B harness without its two accommodations (no station pre-seed, no warm-up request);
each cold start = a fresh database + a fresh `next start` + the setup (the `/pos` page's first requests race the
connection; GET stations, POST 2 stations, 4 category PUTs, POST 4 printers).
- Before (`4bd357c`): **4 / 10 cold starts failed** (GET `/api/stations` 500, both station POSTs 500, 4 / 4 printer
  POSTs 500, the page's own GET `/api/printers` 500 twice, 11 `createCollection` TypeErrors in the server log each).
- After (`050cab3`): **20 / 20 clean** (stations 200, station POSTs 201 / 201, printer POSTs 4 × 201, 4 printers, no
  5xx, no `createCollection` error); every one of the 20 databases holds the unique `name` index on `stations` and
  `printers`. At the measured 40 % base rate, 20 clean runs by luck ≈ 0.004 %.
- One M1 round on the after build: T-1's 3 KOTs and the bill printed (4 jobs printed, no duplicate); the slips' bytes
  (48 342 / 44 382 / 44 382) and the request counts (send..pay: 3 acks + 1 wake; pay..end: 1 ack + 1 pulse) equal
  Session 6B's `m1-after` run.

**The final review (Claude Fable, read-only, `4bd357c..050cab3`): Ready to merge — Yes; 0 Critical, 0 Important,
5 Minor**, none required before the merge: run the two reward legs (done: 22 / 0 and 26 / 0); a stalled fallback
would be shared by every caller of that model in the instance (a hang, not a 500: the same class as mongoose's own
pending `init()` and `ensureIdemKeyIndex`; no timer added, by the free-tier rule) — a known residual; the
`print-setup-paths` pin title "never connect" is now true by letter (not loosened); a placeholder in the live leg;
the GATE's `.init(` match is broad (fails loudly, the safe direction). It confirmed against mongoose 8.24's source:
the happy path is today's (no new command, request, timer or write), the fallback does init's own work and rejects
with the build's error (fail closed, `lib/due-payment.ts` included), no sticky rejection remains, and the 12 sites
keep their order.

**Known residuals:** models no call site guards (`Order`, `Table`, `Staff`, …) still skip their automatic index build
in a raced instance (as planned); a stalled `createCollection` / `createIndexes` holds that model's callers in that
instance (as above). The live leg's step 1b (a model compiled while connecting: `init()` rejects) is the tripwire: when
a mongoose upgrade makes it fail, revisit `modelReady`.

**Left for the owner:** the merge and the push (on his word only; `origin/main` fetched first); the deploy (his admin
panel; it can go out with printing Phase 6 or after it); the scratch databases this session left on the local mongod
(35: the 31 cold-start `pos_scratch_e2e_4g_mi*`, `pos_scratch_mi_base_dues`, `pos_scratch_mi_final_dues`,
`pos_scratch_assign`, `pos_scratch_reward_redeem`; Claude's own drop is refused) —
`node D:\kd\pos-dev-keep\hotfix\model-init\drop-mi.mjs` from `apps/cafe` (`--dry` lists them). Session tools and
logs: `D:\kd\pos-dev-keep\hotfix\model-init\` (README.txt).
