# Kitchen: Paid Walk-In or Parcel Stays Until Ready — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paid Walk-In (no table) or parcel order of the business day stays on the Kitchen board until the kitchen
taps Ready, or for 2 hours after its newest kitchen round. Its tick, Ready and Undo work. Nothing else changes.

**Architecture:** The new rule is a third kitchen arm beside the open-tab arm and the paid-token arm.
- Pure Mongo filter builders go in a new `lib/kitchen-walkin.ts`.
- A two-phase read that mirrors `readKitchenTokenArm` goes in a new `lib/kitchen-walkin-server.ts`. It reuses the
  same `pendingTokenIds` (Ready comparison plus the 120-minute stale-out).
- The Kitchen GET merges the three arms. The Kitchen POST gates on one `kitchenGateFilter`.
- `kitchenOrderFilter`, `tokenOrderFilter`, the token routes and the token board are not touched.

**Tech Stack:** Next.js 15 route handlers, mongoose 8.24, node:test via `node --import tsx --test` (the package.json
`testChain`), live legs as `node --import tsx scripts/*.ts` against the local mongod.

**Spec:** `docs/superpowers/specs/2026-11-13-kitchen-paid-parcel-design.md` (owner-approved 2026-11-13, commit 2f4de7c).

## Global Constraints

- **Walk-In or parcel order:** `tableNo` absent or null (`{ tableNo: null }` matches both), OR `parcel: true`.
- **Paid:** `status: "Completed"`, the paid-token rule (`PAID_STATUS`).
- **Business day:** `mode.dayStart` from `tokenModeOf(await getSettings(), new Date())`, that is
  `slipDayStart(now, token.resetMinutes)`. It applies with tokens on or off.
- **Stale-out:** `TOKEN_STALE_MINUTES` (120), through `pendingTokenIds`. No new constant.
- **Tokens on:** the Walk-In arm skips orders that have a token number (`tokenNumber: { $exists: false }`). The token
  arm already shows those with the same Ready and 2-hour rules, so there is one card and no doubled reads.
- **Untouched code:**
  - `kitchenOrderFilter`, `OPEN_TAB_FILTER`, `paidTokenFilter`, `tokenOrderFilter`, `readKitchenTokenArm`,
    `readTokenBoard` and `buildKitchenCards` keep their code;
  - `app/api/tokens/**` is byte-identical;
  - the only line that changes in `lib/token-board.ts` is `const PAID_STATUS` becoming `export const PAID_STATUS`.
- **₹0:**
  - no new HTTP request kind, write, timer or index;
  - the Walk-In arm is bounded by today's `createdAt`, by `TOKEN_DAY_SCAN_LIMIT` and by `pendingTokenIds`'s cap;
  - `print-budget.test.ts` is unchanged.
- **Untouched areas:** nothing in `apps/mobile`, `apps/desktop`, `workers`, the printing renderers or the S1 43-file pin.
- **House rules:**
  - every file stays at 300 lines or fewer;
  - test first, and the controller sees RED by copy-aside before GREEN;
  - one commit per task;
  - code, comments, docs and commit messages are in English;
  - commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Test wiring:** every new test file is added to `apps/cafe/package.json` `testChain`, right after
  `lib/token-routes-paths.test.ts`.

## Review Focus

1. **A seated tab that was UNSEATed** (`$unset tableNo`, the guest took it away) and then paid is a Walk-In, so it
   stays. The Task 3 live leg pins it.
2. **A Walk-In tab that was given a table** (ASSIGN) and then paid is a table order, so it leaves on payment as today.
   The Task 3 live leg pins it.
3. **Ready tapped while the tab was still open, then payment:** the card must NOT come back (`isHiddenByReady`, G4).
   The Task 3 live leg pins it.
4. **Yesterday's paid Walk-In** (`createdAt` before `dayStart`), even with a round under 2 hours old, is excluded. The
   Task 3 live leg pins it.
5. **Tokens on, a paid Walk-In WITHOUT a token** (made before tokens were switched on) still shows, through the
   Walk-In arm. The Task 3 live leg pins it.

---

### Task 1: The Walk-In filters (pure)

**Files:**
- Create: `apps/cafe/lib/kitchen-walkin.ts`
- Modify: `apps/cafe/lib/token-board.ts:46` (`const PAID_STATUS` → `export const PAID_STATUS`, nothing else)
- Test: `apps/cafe/lib/kitchen-walkin.test.ts` (new; add to `testChain`)

**Interfaces:**
- Consumes:
  - `PAID_STATUS`, `OPEN_TAB_FILTER`, `paidTokenFilter(dayStart: Date)`, `type TokenMode` (`{ enabled: boolean;
    dayStart: Date; clearMinutes: number }`), all from `@/lib/token-board`;
  - `pendingTokenIds` (test only).
- Produces:
  - `paidWalkInFilter(dayStart: Date)` → `{ status: "Completed", createdAt: { $gte: Date }, $or: [{ tableNo: null },
    { parcel: true }] }`;
  - `walkInArmFilter(mode: TokenMode)` → tokens off: `paidWalkInFilter(mode.dayStart)`; tokens on:
    `{ ...paidWalkInFilter(mode.dayStart), tokenNumber: { $exists: false } }`;
  - `kitchenGateFilter(mode: TokenMode)` → `{ $or: [{ ...OPEN_TAB_FILTER }, ...(mode.enabled ?
    [paidTokenFilter(mode.dayStart)] : []), paidWalkInFilter(mode.dayStart)] }`.
  - Every call returns a FRESH object (no shared nested arrays or objects).

- [ ] **Step 1: Write the failing tests** in `lib/kitchen-walkin.test.ts`. Use `DAY = new Date("2026-11-13T00:30:00.000Z")`.
  - `paidWalkInFilter: status Completed, today, no table OR parcel`
    - `deepStrictEqual(paidWalkInFilter(DAY), { status: "Completed", createdAt: { $gte: DAY }, $or: [{ tableNo: null }, { parcel: true }] })`;
    - `JSON.stringify` key order is `status, createdAt, $or`;
    - `.status === PAID_STATUS`;
    - `.createdAt.$gte === DAY`, the same instance.
  - `walkInArmFilter: tokens off is the paid Walk-In filter; tokens on skips token orders (the token arm owns them)`
    - off (`{ enabled: false, dayStart: DAY, clearMinutes: 10 }`): deepStrictEqual to `paidWalkInFilter(DAY)`;
    - on: deepStrictEqual to `{ ...paidWalkInFilter(DAY), tokenNumber: { $exists: false } }`.
  - `kitchenGateFilter: tokens off = open tab OR paid Walk-In; tokens on adds the paid-token filter in between`
    - off: deepStrictEqual to `{ $or: [{ status: "Pending", payment: "Unpaid" }, paidWalkInFilter(DAY)] }`;
    - on: deepStrictEqual to `{ $or: [{ status: "Pending", payment: "Unpaid" }, paidTokenFilter(DAY), paidWalkInFilter(DAY)] }`.
  - `fresh objects: mutating one result changes neither the next call nor OPEN_TAB_FILTER`
    - push onto `paidWalkInFilter(DAY).$or`, then the next call's `$or.length === 2`;
    - mutate `kitchenGateFilter(off).$or[0].status`, then `OPEN_TAB_FILTER.status === "Pending"`.
  - `the token pins stand`
    - `kitchenOrderFilter(TOKENS_OFF)` still deepStrictEquals `{ status: "Pending", payment: "Unpaid" }`;
    - `kitchenOrderFilter({ tokenMode: true, dayStart: DAY })` still deepStrictEquals
      `{ $or: [{ status: "Pending", payment: "Unpaid" }, paidTokenFilter(DAY)] }`.
  - `pendingTokenIds serves the Walk-In arm unchanged` (documents the reuse)
    - Two candidates fired at `now - 10 min`: one with `readyAt = its fire time`, which is dropped; one with no tick,
      which is kept.
    - One candidate fired at `now - 120 min`, which is dropped (the stale-out).
    - One candidate with `readyAt` older than a second round, which is kept (the lost-ticket rule).
    - Candidates use `{ _id, createdAt, kotFiredAt }`.

- [ ] **Step 2: Run to verify RED.**
  Run (from `apps/cafe`): `node --import tsx --test lib/kitchen-walkin.test.ts`
  Expected: FAIL, the module `@/lib/kitchen-walkin` is not found (or `PAID_STATUS` is not exported).

- [ ] **Step 3: Implement** `lib/kitchen-walkin.ts` with the three functions from the Interfaces block.
  - It has a header comment naming the spec and the owner's rules O3/O4.
  - It imports from `@/lib/token-board` only. No mongoose, no React.
  - In `lib/token-board.ts`, export `PAID_STATUS`.

- [ ] **Step 4: Run to verify GREEN.**
  - `node --import tsx --test lib/kitchen-walkin.test.ts lib/token-board.test.ts`: all pass.
  - `npm run typecheck`: rc 0.

- [ ] **Step 5: Commit**
  `feat(kitchen): the paid Walk-In filters and the kitchen gate filter (pure)`.

### Task 2: The Walk-In arm and the Kitchen route

**Files:**
- Create: `apps/cafe/lib/kitchen-walkin-server.ts`
- Modify: `apps/cafe/app/api/kitchen/route.ts`:
  - GET, lines 84-85: add the arm and the 3-way merge;
  - POST, line 135: the gate;
  - the comment at line 134.
- Modify: `apps/cafe/lib/token-routes-paths.test.ts:62-64` (the POST gate pin, rewritten to the new gate; see Step 1)
- Test: `apps/cafe/lib/kitchen-walkin-paths.test.ts` (new; add to `testChain`)

**Interfaces:**
- Consumes:
  - from Task 1: `walkInArmFilter(mode)` and `kitchenGateFilter(mode)`;
  - from `@/lib/token-board`: `TOKEN_DAY_SCAN_LIMIT`, `pendingTokenIds`, `kitchenSelectOf`, `filterModeOf`,
    `mergeKitchenArms` and `type TokenMode`.
- Produces: `readKitchenWalkInArm(mode: TokenMode): Promise<KitchenOrderInput[]>`, which the Task 3 live leg calls
  through the real route.

- [ ] **Step 1: Write the failing pins** in `lib/kitchen-walkin-paths.test.ts`.
  - Setup: comment-stripped source via `stripComments` from `@/lib/source-pin-utils`, and the `handlerOf` idiom of
    `token-routes-paths.test.ts`.
  - `readKitchenWalkInArm: the token arm's two-phase shape over walkInArmFilter(mode)`:
    - candidates: `Order.find({ ...walkInArmFilter(mode), kotRounds: { $gte: 1 } })`, then
      `.select("kotFiredAt createdAt items.kotRound items.noKot")`, `.sort({ createdAt: -1 })`,
      `.limit(TOKEN_DAY_SCAN_LIMIT)` and `.lean()`;
    - an early `return []` when there are no candidates;
    - ticks: `KotTick.find({ _id: { $in: ids } }).select("readyAt")`;
    - `pendingTokenIds(candidates, readyAtById, Date.now())`;
    - an early `return []` when nothing is pending;
    - the full read: `Order.find({ _id: { $in: pending }, ...walkInArmFilter(mode) })` with
      `.select(kitchenSelectOf(filterModeOf(mode)))` and `.sort({ createdAt: 1 })`;
    - no `connectDB(`, `.updateOne(`, `.create(`, `$set` or `setTimeout`/`setInterval` in the file (read only, ₹0).
  - `kitchen GET: the Walk-In arm runs once, after the token arm, and merges last`:
    - `count(get, "readKitchenWalkInArm(mode)") === 1`, and 0 in POST;
    - `get` matches `/mergeKitchenArms\(mergeKitchenArms\(open as unknown as KitchenOrderInput\[\],\s*tokenArm\),\s*walkInArm\)/`;
    - the index of `readKitchenTokenArm(` is less than the index of `readKitchenWalkInArm(`;
    - `count(get, "Order.find(") === 1`, still;
    - `tabCount: open.length` is unchanged.
  - `kitchen POST: the gate is kitchenGateFilter(mode), before every writer`:
    - matches `/Order\.exists\(\{\s*_id:\s*orderId,\s*\.\.\.kitchenGateFilter\(mode\)\s*\}\)/`;
    - `kitchenOrderFilter(` is no longer in POST;
    - every writer comes after the gate, as in the existing test;
    - the three refusal messages are byte-identical (copy them from route.ts:139-142 as literals).
  - (The token routes and `lib/token-board-server.ts` are checked byte-identical by the controller's `git diff` in Task 4,
    not by a permanent hash pin, which would break on every later legitimate edit.)
  - In `lib/token-routes-paths.test.ts`, replace the regex at line 64 with the `kitchenGateFilter(mode)` regex above.
    Rename the test title from "the gate is kitchenOrderFilter(filterModeOf(mode))" to "the gate is
    kitchenGateFilter(mode)". Leave every other assertion in that file as it is.

- [ ] **Step 2: Run to verify RED.**
  Run: `node --import tsx --test lib/kitchen-walkin-paths.test.ts lib/token-routes-paths.test.ts`
  Expected: FAIL on the missing file, call and gate.

- [ ] **Step 3: Implement.**
  - `lib/kitchen-walkin-server.ts` mirrors `readKitchenTokenArm` with `walkInArmFilter(mode)` in both reads. Its
    header says why the full read re-applies the filter: a cancel between the reads drops out.
  - In the route GET, after `tokenArm`:

    ```ts
    const walkInArm = await readKitchenWalkInArm(mode);
    const orders = mergeKitchenArms(mergeKitchenArms(open as unknown as KitchenOrderInput[], tokenArm), walkInArm);
    ```

  - In the route POST:

    ```ts
    const open = await Order.exists({ _id: orderId, ...kitchenGateFilter(mode) });
    ```

  - Update the comment above the POST gate: with tokens on it also covers today's paid token orders, and always
    today's paid Walk-In or parcel orders (spec 2026-11-13).
  - Drop now-unused imports only if tsc or lint says so. `kitchenOrderFilter` and `TOKENS_OFF` stay used by GET's arm 1.

- [ ] **Step 4: Run to verify GREEN.**
  - `node --import tsx --test lib/kitchen-walkin-paths.test.ts lib/token-routes-paths.test.ts lib/kitchen-paths.test.ts lib/token-board.test.ts`:
    all pass.
  - `npm run typecheck`: rc 0. `npm run lint`: 0 errors.
  - `npm test`: 0 fail.

- [ ] **Step 5: Commit**
  `feat(kitchen): a paid Walk-In or parcel order stays on the Kitchen board until Ready (GET arm + POST gate)`.

### Task 3: The live leg

**Files:**
- Create: `apps/cafe/scripts/verify-kitchen-walkin-live.ts`, at 300 lines or fewer.
- Modify: `apps/cafe/package.json`. Add `"verify:kitchen:walkin:live": "node --import tsx scripts/verify-kitchen-walkin-live.ts"`
  after `verify:kitchen:ready:live`.

**Interfaces:**
- Consumes: the real `GET` and `POST` of `@/app/api/kitchen/route` behind the `stubAuth()` idiom of
  `scripts/verify-kitchen-live.ts:45-61`; the `Order`, `KotTick` and `Settings` models; `cache.del(SETTINGS_CACHE_KEY)`
  to switch tokens.
- Produces: `N passed, 0 failed` on stdout, and exit 1 on any failure.

- [ ] **Step 1: Write the leg.**
  - Safety: it refuses any database except exactly `pos_scratch_kitchen_walkin` on 127.0.0.1 or localhost, and drops
    that database at the start and in `finally`.
  - Seeding: orders are seeded with `Order.create` in the shapes the create and settle routes write:
    - `status` and `payment`;
    - `kotRounds: 1`, `kotFiredAt: [t]`;
    - one kitchen line with `kotRound: 1`;
    - `tableNo` only when the case needs it, `parcel` only for the QR case.
    - `Settings` is created with `tokenEnabled: false` first.
    - `Settings.numberResetMinutes` is set so that today's `dayStart` falls 3 to 12 hours before the run. Read
      `slipDayStart` in `packages/shared/src/slip-day.ts` for its clock and compute the value at run time. Then
      "now − N min" orders are inside today at any hour of the day. Print the computed `dayStart` once.
  - Helper `board()` runs `GET()` and returns `cards`. Helper `post(body)` runs `POST(new Request(..., { method:
    "POST", body: JSON.stringify(body) }))` and returns the status.
  - Checks. Each check is `PASS`/`FAIL` with the counts printed at the end.
    1. A paid Pay Now Walk-In (`status "Completed"`, `payment "Cash"`, no `tableNo`, fired now − 5 min) is on the board.
    2. Ready (POST `{ action: "ready", orderId, ready: true, seenFiredAt: card.newestFiredAt }`) answers 200, and the
       card is gone.
    3. Undo (`ready: false`) answers 200, and the card is back.
    4. A line tick on it (`{ action: "tick", orderId, ref: card.lines[0].ref, done: true }`) answers 200.
    5. A KOT-first Walk-In seeded open (`Pending`/`Unpaid`) is on the board. After `updateOne` to `Completed`/`Cash`
       (the settle's status write) it is still on the board.
    6. A QR parcel (`parcel: true`, no table), paid, is on the board.
    7. A paid table order (`tableNo: "T-1"`) is NOT on the board, and a tick on it answers 404.
    8. A paid Walk-In fired 121 minutes ago is NOT on the board.
    9. Review Focus 1: an UNSEATed tab (seeded with `tableNo`, then `$unset tableNo`) paid is on the board.
    10. Review Focus 2: a Walk-In given `tableNo: "T-2"`, then paid, is NOT on the board.
    11. Review Focus 3: an open Walk-In marked Ready (KotTick `readyAt` = its fire time), then paid, is NOT on the board.
    12. Review Focus 4: a Walk-In created 25 hours before now (before today's `dayStart`), with `kotFiredAt` 30
        minutes ago, paid, is NOT on the board.
    13. Cancelled (`status "Cancelled"`): the case-1 order is set to Cancelled and is gone.
    14. Tokens on (`Settings.updateOne({}, { $set: { tokenEnabled: true } })`, then `cache.del(SETTINGS_CACHE_KEY)`):
        - a paid Walk-In WITH `tokenNumber: 7` is exactly ONE card;
        - Review Focus 5: a paid Walk-In WITHOUT a token is on the board.
    15. Skip-KOT: a paid Walk-In whose only line has `noKot: true` has no card.

- [ ] **Step 2: Run it against the Task 2 code.**
  Run (from `apps/cafe`):
  `MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_kitchen_walkin npm run verify:kitchen:walkin:live`
  Expected: every check PASS, `N passed, 0 failed`, rc 0.
  Then run it with `app/api/kitchen/route.ts` copied aside to its `f1d09d5` version. Expected: checks 1-6, 9, 14b
  (and 4's 200) FAIL, which proves the leg bites. Restore the file.

- [ ] **Step 3: Commit**
  `test(kitchen): verify:kitchen:walkin:live, the paid Walk-In rules on a real mongod`.

### Task 4: GO-LIVE note, verification and Results (controller)

**Files:**
- Modify: `docs/GO-LIVE-CHECKLIST.md`. Add the section `### Existing cafes: the Kitchen paid Walk-In release` right
  after the Phase 6 release section (before `## §2`). It has:
  - one paragraph on what changes;
  - checkboxes: deploy, reload every POS and Kitchen screen, the demo cafe first, and the one-time appearance of
    today's unready paid Walk-Ins from the last 2 hours;
  - "rollback: deploy the build before; nothing is stored differently".
- Modify: this plan, a `## Results` section.

- [ ] **Step 0:** Run `git diff f1d09d5 -- apps/cafe/app/api/tokens apps/cafe/lib/token-board-server.ts`. Expected: empty.
  Run `git diff f1d09d5 -- apps/cafe/lib/token-board.ts`. Expected: only `export ` added to `const PAID_STATUS`.
  Run `git diff --name-only f1d09d5`. Expected: nothing outside `apps/cafe/` and `docs/`.
- [ ] **Step 1:** Run every suite (cafe, tsc, lint, shared, mobile, desktop) and every live leg with
  `D:\kd\pos-dev-keep\hotfix\model-init\run-all-main.sh <label>`, which picks up the new leg by name; add
  `pos_scratch_kitchen_walkin` to its exact-name map. Expected: 0 failed anywhere; the go-live tests stay green after
  the doc edit.
- [ ] **Step 2:** Make a production build of the branch in a junction-safe worktree, run `next start` on a free
  127.0.0.1 port (never 3110), on a fresh `pos_scratch_*` DB, signed in on a local browser (playwright-core). Then:
  - POS: a Walk-In order paid with Pay Now shows on `/kitchen`;
  - POS: a Walk-In KOT sent, then settled, stays on `/kitchen`;
  - Ready removes it;
  - a table order paid leaves.
  Take screenshots into the pos-dev-keep run folder, then remove the worktree junction-safe.
- [ ] **Step 3:** Run the final whole-branch review on the most capable model. If it says "With fixes", run one fix
  wave, then a scoped re-check.
- [ ] **Step 4:** Write the Results (commits, RED→GREEN per task, counts, browser check, review verdict, residuals),
  then commit as `docs(kitchen): the paid Walk-In results` together with the GO-LIVE section.

## Results (2026-11-13)

Branch `feat/kitchen-paid-parcel` from main `f1d09d5`. Not merged, not pushed, not deployed.

### Commits

| Commit | What |
|---|---|
| `2f4de7c` | spec |
| `e563c9f` | plan |
| `16c252b` | Task 1, the pure filters |
| `cf0697a` | Task 2, the arm + the route |
| `ba90111` | Task 3, the live leg |
| `ed54a60` | Task 3 fix round: the create route's shape |
| `8e71296` | the GO-LIVE section |
| `b796d26` | the final-review fix wave |

These Results come in the next commit. Implementers wrote files only. The controller saw RED by moving files aside,
ran GREEN and the suites, and made every commit. Three implementer writes came out CRLF; they were normalised to LF.

### RED → GREEN

| Task | RED | GREEN |
|---|---|---|
| 1 | `lib/kitchen-walkin.ts` moved aside: "Cannot find module", 1 fail | 70/70, with `token-board.test.ts` |
| 2 | route at `16c252b` and the server file aside: exactly the 4 new pins fail (13 pass) | 101/101 over 5 files |
| 3 | `app/api/kitchen/route.ts` at `f1d09d5`: 8 of 17 fail (1-6, 9, 14b), the 9 negatives pass | 17/0 |
| 3 fix | (none) | 20/0 |
| Fix wave | the arm at `8e71296`: 2 pins fail, and leg check 18 fails ("61 older noKot-only paid Walk-Ins do not push a real paid Walk-In off the board", 23/1) | 102/102 focused, leg 24/0, `verify:tokens:live` 58/0 |

Task 3's fix round added the create route's real shape: no `kotFiredAt`.

### Counts, `f1d09d5` → `b796d26`

| Suite | `f1d09d5` | `b796d26` |
|---|---|---|
| cafe | 8641 / 0 / 1 | 8651 / 0 / 1 |
| tsc | 0 | 0 |
| lint | 0 errors / 2 warnings | 0 errors / 2 warnings |
| shared | 1119 | 1119 |
| mobile | 173 | 173 |
| desktop | 224 | 224 |
| live legs | 54, every one 0 failed | 55 (the new `verify:kitchen:walkin:live` 24/0), every one 0 failed |
| `verify:tokens:live` | 56/0 | 58/0 (T7/T10 rewritten, ruling R3) |

The branch counts are from `run-all-kw.sh kw2`, run from an uppercase `D:\` cwd.

Checks against `f1d09d5`:
- `git diff f1d09d5` on `app/api/tokens/**` and `lib/token-board-server.ts`: empty.
- `lib/token-board.ts`: only `export ` on `PAID_STATUS`.
- Nothing outside `apps/cafe/` and `docs/`.
- `print-budget.test.ts`, the S1 pin, the printing renderers, mobile, desktop and workers: untouched.
- No new request kind, write kind, timer or index.
- The Walk-In candidate query runs on `createdAt_-1`: `LIMIT > FETCH > IXSCAN`, no `COLLSCAN`, no `SORT`.

### Browser check

A production build of the branch was served from `next start` on 127.0.0.1:3171, on fresh `pos_scratch_e2e_kw*` DBs,
and driven with headless Chrome. It ran twice, on `ba90111` and on `b796d26`, and passed 17/17 both times with no page
errors:
- **Walk-In, Pay Now:** the card shows on `/kitchen`, and the card's Ready removes it.
- **Walk-In, Send KOT then Pay:** the card is on `/kitchen` while open and after the payment, and Ready removes it.
- **Table T-3, Send KOT then Pay:** the card leaves `/kitchen` on payment, as before.

The tools, runs, screenshots and logs are in `D:\kd\pos-dev-keep\kitchen-walkin`. The worktree was removed
junction-safe.

### Reviews

- **Builder check of the spec.** It found that the POS has no Parcel control: a counter parcel is a Walk-In with no
  table. That led to the owner's O3 (every Walk-In) and O4 (2 hours).
- **Task reviews.** All approved. Task 3 had one plan-mandated Important finding, fixed by R2.
- **Final review (fable): "With fixes".** 0 Critical, and 1 Important, I-1: noKot-only paid Walk-Ins held arm slots
  with no card, and 60 of them would hide real ones. The one fix wave also handled M-1 to M-4, F7 and R3. Its scoped
  re-review found every item addressed and no new Critical or Important finding.

### Rulings

- **R1:** keep a test of the reused `pendingTokenIds`.
- **R2:** seed the create route's shape (no `kotFiredAt`).
- **R3:** rewrite `verify-token-live-legs` T7/T10 to the approved rule. With tokens off, a Pay Now order with no table
  is a paid Walk-In and stays on the board. The open-tab query and "no token arm with tokens off" stay pinned.

### Known residuals (accepted)

- **Comment wording (parked).**
  - `kitchen-walkin-server.ts:9` says a whole-skip order is "never a token-arm candidate". A token tab voided to
    whole-skip before payment can be one. The token arm's own rare slot hole is pre-existing, and its file is frozen.
  - The route comments say "a paid TABLE tab leaves the board". With tokens on, a paid table order with a token stays,
    on the token arm, which is unchanged.
- **T10 coverage.** It no longer proves live that, with tokens off, a paid table order WITH a token is refused. The pure
  pin and the walk-in leg's check 7 cover the gate's shape.
- **"Business day" in GO-LIVE.** The new bullet uses it to mean restart time to restart time. §11 uses it for the sales
  and reports day, IST midnight.
- **Midnight cut (owner-approved C1).** Paid Walk-In cards leave at the daily restart time.
- **Never-Ready kitchens (C4).** A kitchen that never taps Ready shows old paid cards first for up to 2 hours.
- **Kitchen header numbers.** "Average wait" and the Late band include unready paid Walk-Ins.
- **Cost.** Each Kitchen GET makes 1 to 3 more sequential reads (M-5). Each Ready or tick on a paid Walk-In leaves a
  small `KotTick` doc (M-6, the same as token cafes).

### Left for the owner

- The merge OK, then a separate push word.
- The deploy, demo cafe first. Follow GO-LIVE "Existing cafes: the Kitchen paid Walk-In release", including telling the
  kitchen to tap Ready.
- Scratch DBs, run from `apps/cafe`:
  - this session's 35: `node D:\kd\pos-dev-keep\kitchen-walkin\drop-kw.mjs` (`--dry` lists them);
  - the pull check's 15 `pos_scratch_mi_main2_*`: `D:\kd\pos-dev-keep\hotfix\model-init\drop-mi.mjs`.
