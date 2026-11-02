# P1 Smooth + fast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the measured causes of the slow app (the start screen's server round trip, the `:has()` style cost,
the page fade, the phone bars' blur, the per-navigation tab icon, full-rate safety-net polls and the doubled tables
read) and keep test files out of the deploy, with no change to printing, money paths, APIs or the approved look beyond
the owner's answers.

**Architecture:** Client-side only, except one branding-route branch: CSS mechanism swaps (`html[data-html-rules]`),
two shell removals (the fade, the blur), the router cache's dynamic window, a version-stamped default tab icon, poll
intervals that read the existing `isRealtimeHealthy()` (the print host's idiom), a catch-up refetch on a dropped
socket, and a one-shot fresh tables read after a realtime nudge. Plus deploy scope files and dead-file removal.

**Tech Stack:** Next.js 15.5 (App Router), React 19, TanStack Query v5, Tailwind 4, node:test + tsx path pins.

**Spec:** `docs/superpowers/specs/2026-11-02-perf-smooth-design.md` (approved by the owner 2026-11-02, F1–F9, P1 not
taken). Numbers: `docs/perf/2026-11-02-p1-measurements.md`.

## Global Constraints

- Branch `feat/perf-smooth` only; never main. Commit with `git commit -F <file>`; message ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Printing and the paper never change: no file under `lib/printer/`, `lib/print*.ts`, `components/print/`, no slip,
  the S1 43-file pin and `lib/print-budget.test.ts` stay green and untouched. The pulse (`REFETCH_INTERVALS.POS_PULSE`,
  20 s, `refetchIntervalInBackground: true`) never changes.
- No API meaning, model or data change. The only route change is Task 2's branding branch (an extra cache answer for
  one exact URL).
- The look changes only where the owner answered: D1 the page fade off, D2 the phone tab bar and the POS order bar
  solid `bg-card` (same colours as `--glass` without its 10% see-through: `#ffffff` / `#17171a`), no backdrop filter.
  The /m diner flow (`components/public/*`) and `SettingsSaveBar` keep theirs.
- WebView 109-safe CSS (no `light-dark()`, no runtime `color-mix()`, no `:has()` added anywhere).
- Files ≤ 300 lines; line budgets and request budgets never loosen; a test pin moves only on purpose, its meaning kept,
  and its message says the owner's answer or the ruling (D1–D5 / F1–F9).
- A new test file is added to `apps/cafe/package.json` `testChain` (an array, one entry per file).
- Run a single test file from `apps/cafe`: `node --import tsx --test lib/<name>.test.ts`; the whole cafe chain:
  `cd apps/cafe && npm test`; types: `npm run typecheck`; lint: `NODE_OPTIONS=--max-old-space-size=6144 npx eslint .`.
- Never run a build or server on ports 3110/3130 (the owner's preview); never touch another project's process.
- Write any script with backslashes with the Write tool, never a Bash heredoc.

## Review Focus

- Realtime flag off / Worker unreachable (`NEXT_PUBLIC_REALTIME_URL` unset): every poll is exactly today's interval —
  pinned in Task 3 (`livePollMs(normal, false) === normal` for each interval, and the hooks read `isRealtimeHealthy()`
  through `livePoll`).
- A socket that drops in a rush and reconnects with backoff: ONE catch-up round per healthy→down transition, not one
  per reconnect attempt — Task 3's `realtime-down` test drives two failed reconnects and counts one event.
- Client navigation dashboard → /m, and the lock screen closing over the dashboard: `data-html-rules` leaves `<html>`
  only when the last scope unmounts — Task 1's ref-count test.
- A person switch on a shared counter device (PIN): no page shell of the last person is reused — Task 2 pins
  `router.refresh()` on `plan.switched`.
- A cafe that saves (or clears) a product logo later: the tab icon follows it (saved → its own versioned URL; none →
  the built-in mark's versioned URL) — Task 2's layout and route tests.

---

### Task 1: The staff CSS without `:has()`, no page fade, solid phone bars (F1, F2, F3)

**Files:**
- Create: `apps/cafe/lib/html-rules-scope.ts`
- Modify: `apps/cafe/components/layout/HtmlRulesScope.tsx`, `apps/cafe/app/globals.css:692-708`,
  `apps/cafe/app/(dashboard)/layout.tsx` (scripts + `<main>`), `apps/cafe/app/(auth)/login/page.tsx`,
  `apps/cafe/components/layout/TabBar.tsx:73`, `apps/cafe/lib/pos-layout.ts:186-187` (`POS_MOBILE_BAR_CLASS`),
  `apps/cafe/lib/shell-layout.ts:14-22`
- Delete: `apps/cafe/components/layout/PageFade.tsx`
- Test: `apps/cafe/lib/html-global-rules.test.ts`, `apps/cafe/lib/html-motion-paths.test.ts`,
  `apps/cafe/lib/tab-bar-paths.test.ts:165-172`, `apps/cafe/lib/pos-layout.test.ts:418-440`,
  `apps/cafe/lib/pos-layout-compile.test.ts:160-191`

**Interfaces:**
- Produces (`lib/html-rules-scope.ts`, dependency-free like `lib/nav-state-script.ts`):
  - `export const HTML_RULES_ATTR = "data-html-rules";`
  - `export const HTML_RULES_SCRIPT: string` — `try{document.documentElement.setAttribute("data-html-rules","")}catch(e){}`
  - `export function acquireHtmlRules(root: { setAttribute(n: string, v: string): void; removeAttribute(n: string): void }): () => void`
    — module-level count; the first acquire sets the attribute, the release that brings the count to 0 removes it;
    a release called twice is a no-op.

- [ ] **Step 1: Write the failing tests** in `lib/html-global-rules.test.ts`: change `SCOPE` to
  `"html[data-html-rules]"` (both rules found top-level / in `@layer base` exactly as now); add
  `test("F1: no :has([data-html-rules]) is left in globals.css", …)` asserting `!CSS.includes(":has([data-html-rules])")`;
  replace the span pin with: `renderToStaticMarkup(createElement(HtmlRulesScope)) === ""`, the dashboard layout source
  contains `<script>{HTML_RULES_SCRIPT}</script>` and `<HtmlRulesScope />`, the login page source contains
  `<script>{HTML_RULES_SCRIPT}</script>`, `AuthShell.tsx` still renders `<HtmlRulesScope />`; the /m and root-layout
  negative pins stay; add the ref-count test:

```ts
test("F1: the scope is ref-counted — the lock closing over the dashboard keeps the rules; the last one out removes them", () => {
  const attrs = new Set<string>();
  const root = { setAttribute: (n: string) => void attrs.add(n), removeAttribute: (n: string) => void attrs.delete(n) };
  const shell = acquireHtmlRules(root);
  const lock = acquireHtmlRules(root);
  assert.ok(attrs.has(HTML_RULES_ATTR), "set on the first acquire");
  lock(); lock();
  assert.ok(attrs.has(HTML_RULES_ATTR), "a release (even twice) while another scope is mounted keeps it");
  shell();
  assert.ok(!attrs.has(HTML_RULES_ATTR), "removed when the last scope unmounts (dashboard → /m)");
});
```

- [ ] **Step 2: Run** `node --import tsx --test lib/html-global-rules.test.ts` — expected FAIL (module missing, SCOPE
  not found).
- [ ] **Step 3: Implement F1:** `lib/html-rules-scope.ts` as in Interfaces; `HtmlRulesScope` becomes a `"use client"`
  component returning `null` whose `useLayoutEffect` calls `acquireHtmlRules(document.documentElement)` and returns the
  release; the dashboard layout renders `<script>{HTML_RULES_SCRIPT}</script>` next to `<script>{NAV_STATE_SCRIPT}</script>`;
  the login page renders the same script before its content; `globals.css` selectors become `html[data-html-rules]`
  and `html[data-html-rules] :is(button, input)` with the comment rewritten (same values, same layering; why: F1 /
  report §3).
- [ ] **Step 4: Run** the same file — PASS.
- [ ] **Step 5: Update the motion pin (D1)** in `lib/html-motion-paths.test.ts`: replace the "ruling R11" test with
  `test("owner D1 (2026-11-02): no page fade on a screen change — <main> holds only the page", …)` asserting the layout
  matches `/<main className="flex-1 p-4 pb-\[92px\] tab:pb-4 md:p-6">\s*\{children\}\s*<\/main>/`, that
  `components/layout/PageFade.tsx` does not exist, and that `lib/shell-layout.ts` exports neither `PAGE_IN_KEYFRAMES` nor
  `PAGE_IN_TIMING`. Run it — FAIL. Then delete `PageFade.tsx`, its import and `<PageFade />` in the layout, and the two
  constants and their comment in `lib/shell-layout.ts`. Run — PASS.
- [ ] **Step 6: Update the bar pins (D2)**: `tab-bar-paths.test.ts` — the class list has `bg-card` instead of
  `bg-glass`, and `assert.ok(!nav.includes("backdrop-filter"), "owner D2: solid, no blur")`; `pos-layout.test.ts` —
  same for `POS_MOBILE_BAR_CLASS` (`bg-card`, no `backdrop-filter` either form); `pos-layout-compile.test.ts` — the
  compiled bar rule has no `backdrop-filter` and its background is `var(--card)`. Run the three — FAIL. Change the two
  class strings (`bg-glass` → `bg-card`, drop both `[backdrop-filter:…]` / `[-webkit-backdrop-filter:…]` utilities) and
  their comments. Run — PASS.
- [ ] **Step 7: Run** `npm test`, `npm run typecheck` and the lint command (Global Constraints) — all green; `grep -c ":has(\[data-html-rules\])" app/globals.css` → 0.
- [ ] **Step 8: Commit** `perf(ui): staff rules on <html> without :has(), no page fade, solid phone bars (F1, D1, D2)`.

### Task 2: Visited screens reuse the router cache; the tab icon without a call per screen (F4, F5)

**Files:**
- Modify: `apps/cafe/next.config.ts` (the `PREFETCH_REUSE_SECONDS` comment and `staleTimes`),
  `apps/cafe/components/lock/ScreenLock.tsx:209-230` (`unlocked`), `apps/cafe/lib/branding-default-logo.ts`,
  `apps/cafe/app/api/branding/[slot]/route.ts` (the `wantsVersion` branch), `apps/cafe/app/layout.tsx:30-47`,
  `apps/cafe/app/(dashboard)/layout.tsx:43-64`
- Test: `apps/cafe/lib/sidebar-paths.test.ts:266-274`, `apps/cafe/lib/warm-routes.test.ts:130-140`, `apps/cafe/lib/screen-lock-paths.test.ts`,
  `apps/cafe/lib/branding-paths.test.ts`

**Interfaces:**
- Produces: `export const DEFAULT_PRODUCT_LOGO_URL: string` in `lib/branding-default-logo.ts` =
  `` `${brandingUrl("productLogo")}?v=${DEFAULT_PRODUCT_LOGO.version}` `` (server-only module, as today).

- [ ] **Step 1: Write the failing pins:** `sidebar-paths.test.ts` — rename to
  `"PIN (F4): staleTimes reuses visited screens for the same window as prefetched ones"`, assert the block matches
  `static:\s*PREFETCH_REUSE_SECONDS` AND `dynamic:\s*PREFETCH_REUSE_SECONDS` (the mutation it now catches: dropping
  `dynamic` brings back the start screen's round trip, report §4); `warm-routes.test.ts:138` — the same block shape;
  keep the line-134 pin on Next's shared default. Screen lock: `assert.match(src, /if \(plan\.switched\) \{[\s\S]*router\.refresh\(\);/, "F4: a person switch drops the router cache — no shell of the last person is reused")`.
  Branding: a test that `GET` with `?v=<DEFAULT_PRODUCT_LOGO.version>` on `productLogo` answers 200, `Cache-Control`
  `public, max-age=31536000, immutable`, the built-in bytes, and reads no Settings/branding store (the route's existing
  test seam, or a source pin that the branch returns before `getBrandingMeta`); and layout pins that both layouts use
  `productImageUrl(...) ?? DEFAULT_PRODUCT_LOGO_URL` (root layout's DB-down fallback too).
- [ ] **Step 2: Run** those files — FAIL.
- [ ] **Step 3: Implement:** `staleTimes: { static: PREFETCH_REUSE_SECONDS, dynamic: PREFETCH_REUSE_SECONDS }` with the
  comment rewritten (every staff page is a client page; reuse carries only the shell; same tab-title / deploy
  trade-off; F4); in `unlocked`, `router.refresh()` inside `if (plan.switched)` after the query clearing; the branding
  route answers `imageResponse(DEFAULT_PRODUCT_LOGO, IMMUTABLE_CACHE, ifNoneMatch)` when `slot === "productLogo" &&
  requested === DEFAULT_PRODUCT_LOGO.version`, before any store read (that URL names exactly the built-in bytes);
  both layouts fall back to `DEFAULT_PRODUCT_LOGO_URL`.
- [ ] **Step 4: Run** the files — PASS; then `npm test`, typecheck, lint — green.
- [ ] **Step 5: Commit** `perf(nav): visited screens reuse the router cache; a version-stamped default tab icon (F4, F5)`.

### Task 3: Safety-net polls step back while the room is up; a catch-up on a drop; one fresh floor read per nudge (F6, F7)

**Files:**
- Create: `apps/cafe/lib/live-poll.ts`, `apps/cafe/lib/tables-fresh-read.ts`, `apps/cafe/lib/live-poll.test.ts`,
  `apps/cafe/lib/realtime-down.test.ts` (a fake `globalThis.WebSocket`, `NEXT_PUBLIC_REALTIME_URL` set in the test)
- Modify: `apps/cafe/lib/realtime-client.ts` (down event), `apps/cafe/lib/realtime-invalidate.ts` (`onRound`),
  `apps/cafe/hooks/use-realtime.ts` (LIVE_STATE spec, catch-up hook, header comment),
  `apps/cafe/components/layout/PosPulseProvider.tsx` (mount the catch-up), `apps/cafe/hooks/use-tables.ts:37` + its
  queryFn, `apps/cafe/hooks/use-orders.ts:75,112,151`, `apps/cafe/hooks/use-dashboard.ts:28,39`,
  `apps/cafe/hooks/use-kitchen.ts:43`, `apps/cafe/hooks/use-tokens.ts:33`, `apps/cafe/package.json` (testChain)
- Test: `lib/live-poll.test.ts` (new), `lib/realtime-nudge-fetch.test.ts`, `lib/realtime-visible-recheck.test.ts`,
  `lib/realtime-paths.test.ts` (header-comment / interval pins), `lib/realtime-live-state.test.ts`

**Interfaces:**
- Produces (`lib/live-poll.ts`): `export const REALTIME_RELAXED_POLL_MS = 120_000;`
  `export function livePollMs(normalMs: number, healthy: boolean): number` (healthy → `Math.max(normalMs, 120_000)`,
  else `normalMs`); `export function livePoll(normalMs: number): () => number` (reads `isRealtimeHealthy()` on every call).
- Produces (`lib/tables-fresh-read.ts`): `markTablesFreshRead(): void`, `takeTablesFreshRead(): boolean` (one-shot flag).
- Produces (`lib/realtime-client.ts`): `export function subscribeRealtimeDown(listener: () => void): () => void` —
  fired from `dropAndReconnect()` only when the socket being torn down had proof of life (`lastSeenAt > 0` before the
  reset), i.e. once per healthy→down transition.
- Produces (`lib/realtime-invalidate.ts`): `RealtimeInvalidateSpec.onRound?: () => void` — called at the start of every
  refresh on a VISIBLE tab (never on a hidden-tab "mark stale" round).
- Produces (`hooks/use-realtime.ts`): `export const CATCH_UP_REALTIME: RealtimeInvalidateSpec` (targets: order lists,
  tables, the one-page infinite list, kitchen, dashboard, tokens; `coalesceMs: REALTIME_NUDGE_COALESCE_MS`,
  `holdWhileMutating: ORDER_KEYS.mutation`, `staleOnlyWhenHidden: true`, `onRound: markTablesFreshRead`) and
  `export function useRealtimeCatchUp(): void` (an invalidator fed the synthetic kind `"lane-down"` by
  `subscribeRealtimeDown`). `LIVE_STATE_REALTIME` loses `lateRefetch` and gains `onRound: markTablesFreshRead`;
  `TABLES_LATE_REFETCH_MS` is removed.

- [ ] **Step 1: Write `lib/live-poll.test.ts`** (add to `testChain`):

```ts
test("D3: with the room proven up every safety-net poll steps back to 120 s; otherwise it is exactly today's", () => {
  for (const ms of [REFETCH_INTERVALS.LIVE_LISTS, REFETCH_INTERVALS.TABLES, REFETCH_INTERVALS.SUMMARY, REFETCH_INTERVALS.KITCHEN]) {
    assert.equal(livePollMs(ms, false), ms, `room down / flag off: today's ${ms} ms`);
    assert.equal(livePollMs(ms, true), 120_000, `room up: ${ms} ms → 120 s`);
  }
  assert.equal(REFETCH_INTERVALS.POS_PULSE, 20_000, "the pulse is not a safety-net poll and never changes");
});
test("D3: tables-fresh-read is one-shot", () => {
  assert.equal(takeTablesFreshRead(), false);
  markTablesFreshRead(); markTablesFreshRead();
  assert.equal(takeTablesFreshRead(), true, "the next tables fetch after a nudge reads past the 5 s instance cache");
  assert.equal(takeTablesFreshRead(), false, "only that one");
});
```
  plus source pins: each of `use-tables.ts`, `use-orders.ts` (three sites), `use-dashboard.ts` (two),
  `use-kitchen.ts`, `use-tokens.ts` passes its interval through `livePoll(` and keeps `isMutating ? false` where it has
  it; `use-pos-pulse.ts` does NOT contain `livePoll`; `use-tables.ts`'s queryFn reads
  `` `/api/tables?${TABLES_FRESH_PARAM}=1` `` when `takeTablesFreshRead()`.
- [ ] **Step 2: Run** `node --import tsx --test lib/live-poll.test.ts` — FAIL (modules missing).
- [ ] **Step 3: Implement** `lib/live-poll.ts`, `lib/tables-fresh-read.ts` and the hook sites (`refetchInterval:
  isMutating ? false : livePoll(REFETCH_INTERVALS.X)`; in `useOrders` wrap `options.refetchInterval` when it is a
  number). Run — PASS.
- [ ] **Step 4: Write the failing realtime tests:** in `lib/realtime-down.test.ts` (add to testChain), a fake WebSocket that opens, then
  misses a pong → `subscribeRealtimeDown` listener called once; two further failed reconnects (close before open) → still
  once; open again, then close → twice. In `realtime-nudge-fetch.test.ts` / `realtime-visible-recheck.test.ts`: replace
  the late-refetch expectations for `LIVE_STATE_REALTIME` with: a visible round calls `onRound` once before it
  invalidates, a hidden round never calls it, and no second tables invalidation 6 s later; `realtime-paths.test.ts`:
  `TABLES_LATE_REFETCH_MS` is gone, `useRealtimeCatchUp()` is mounted in `PosPulseProvider` next to
  `useLiveStateRealtime()`, and the header comment says the polls step back to 120 s only while the room is proven up.
  Run them — FAIL.
- [ ] **Step 5: Implement** the down event, `onRound`, `CATCH_UP_REALTIME`, `useRealtimeCatchUp`, the LIVE_STATE spec
  change, the provider mount, and rewrite the "A SUPPLEMENT TO THE POLL" comment (still a supplement: the poll keeps
  running, at 120 s only while `isRealtimeHealthy()`; D3). Run — PASS.
- [ ] **Step 6: Run** `npm test`, typecheck, lint — green.
- [ ] **Step 7: Commit** `perf(live): safety-net polls step back while the room is up, catch up on a drop, one fresh floor read per nudge (F6, F7, D3)`.

### Task 4: Tests out of the deploy; unused files and packages out (F8, F9)

**Files:**
- Create: `apps/cafe/tsconfig.build.json`, `apps/cafe/lib/deploy-scope-paths.test.ts`
- Modify: `.vercelignore`, `apps/cafe/next.config.ts` (`typescript.tsconfigPath`), `apps/cafe/eslint.config.mjs`,
  `apps/cafe/package.json` (17 dependencies, testChain), `package-lock.json`
- Delete: `apps/cafe/components/ui/{accordion,alert,aspect-ratio,avatar,breadcrumb,carousel,command,context-menu,form,hover-card,input-otp,menubar,navigation-menu,pagination,progress,radio-group,resizable,scroll-area,slider,toggle,toggle-group}.tsx`

**Interfaces:** none consumed or produced.

- [ ] **Step 1: Write `lib/deploy-scope-paths.test.ts`** (add to testChain): `.vercelignore` has the lines
  `**/*.test.ts`, `**/*.test.tsx`, `**/*.test.mjs`, `**/*.fixtures.ts` (D4) and still every line it has today;
  `tsconfig.build.json` extends `./tsconfig.json` and excludes `node_modules`, those four globs and `scripts/**`;
  `next.config.ts` sets `typescript: { tsconfigPath: "tsconfig.build.json" }`; `eslint.config.mjs` adds the same test
  globs to `ignores` only when `process.env.NEXT_PHASE === "phase-production-build"`; no non-test source under
  `app/ components/ hooks/ lib/` imports a `*.test.*` or `*.fixtures` module (scan, so the upload can drop them);
  none of the 21 kit files exists and `package.json` lists none of the 17 packages (D5).
- [ ] **Step 2: Run** it — FAIL.
- [ ] **Step 3: Implement F8** (the four files). Check `npm run typecheck` (the full `tsconfig.json`) and the full lint
  still cover the tests (counts unchanged: `npx tsc --noEmit -p tsconfig.json --listFiles | grep -c test.ts`).
- [ ] **Step 4: Implement F9:** delete the 21 files; run
  `npm uninstall --package-lock-only --ignore-scripts -w apps/cafe <the 17 names>` from the repo root; then restore
  every `"libc"` field the rewrite dropped from entries that remain (a Write-tool Python script comparing
  `git show HEAD:package-lock.json`); `git diff --stat package-lock.json` shows only removals of those packages'
  entries and their now-unused dependencies; `node_modules` is not touched (other worktrees share it).
- [ ] **Step 5: Run** the new test, `npm test`, typecheck, lint, and `npx next build` in a perf worktree at this
  commit (the controller measures its time against B) — all green.
- [ ] **Step 6: Commit** `chore(deploy): tests out of the upload and the build check; unused kit files and packages out (F8, F9, D4, D5)`.

## Results

Executed 2026-11-02 (subagent-driven, fast path). Commits on `feat/perf-smooth` from e877f7a: docs 4d7da80, a3852f5,
9f8fa6a; Task 1 8fd2616; Task 2 a47054c; Task 3 2e7d739 + fix round d52d122 (I1 stale follows the live poll, C2
superseded-socket guard, M1 today's summary in the catch-up); Task 4 69bc1f8; final-review fix wave 5438964 (I1 the
build lint carve-out keys on NODE_ENV, M1 tsconfig.build include), b30eb56 (M4 pin), 4c49293 (M3 open/message guard),
e3fcf4d (I2 the echo-of-own-write guard).

- **Reviews:** every task reviewed (sonnet); Task 3 one fix round; whole-branch review Claude Fable 5.1 "With fixes"
  (0 Critical, 2 Important, 6 Minor) → one fix wave → Fable re-review: all five ADDRESSED, no new Critical/Important.
  Rulings and parked minors: `.superpowers/sdd/2026-11-02-perf-smooth/progress.md` (copied into the hand-over).
- **Suites (final HEAD 9f8fa6a):** cafe 7192 tests, 7191 pass, 0 fail, 1 skipped (the pre-existing go-live-dl planning
  file skip); `npm run typecheck` clean; `eslint .` 0 errors (2 old warnings); packages/shared 1020/1020 (incl.
  `print-budget.test.ts`); the S1 pin `text-kot-print.test.ts` 16/16 (43 picture files). No file under printing,
  packages/shared, apps/mobile, apps/desktop, apps/hub or workers changed.
- **I1 proven on a build:** an `any` planted in `lib/live-poll.ts` fails `next build`; the same in
  `lib/live-poll.test.ts` passes; `tsconfig.build.json` untouched by the build.
- **Before / after:** `docs/perf/2026-11-02-p1-measurements.md` §10 — the return to `/pos` 1.3–1.5 s → 0.6–0.9 s on a
  low-end phone on slow 4G and 0.8–1.3 s → 0.39–0.47 s on Android Chrome 109 (0 server trips, was 1); style recalc
  per screen change −53% to −85% on a CPU 6× phone with photos; idle requests per page −35% to −55% (never higher);
  the 8-device rush 132 → 97 requests / min; projected 1.95 M → 1.23 M invocations and 5.2 h → 3.7 h Active CPU a month
  for a busy 8-device cafe; the deploy build ~82 s → ~64 s; the look identical except D2.
- **Left for the owner (design §9):** the pulse (≈ 0.52 M invocations a month for 8 devices; printing), the write chain
  (7–28 sequential DB trips), a first open on a low-end phone on slow 4G (8–10 s, unchanged; a service worker only with
  the owner's OK).
