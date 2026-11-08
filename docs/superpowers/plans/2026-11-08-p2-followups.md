# P2 follow-ups: no document load cuts a print job; "Refresh anyway" (implementation plan)

- **Date:** 2026-11-08. **Branch:** `feat/p2-followups` from `main` aab2a63 (P2 Parts B–D merged, pushed and deployed
  by the owner on 2026-11-08). One small session. Merge and push only on the owner's word.
- **Authority:** the P2 spec `docs/superpowers/specs/2026-11-06-perf-nav-design.md` N4 (a reload never happens during a
  sale, a payment, a typed form, an unsent order or a leased print job) and the parked rulings in
  `docs/superpowers/plans/2026-11-06-perf-nav.md` "Results (Part D)": **R67** (Refresh refused through a hung printer)
  and **R69** (a staff tap does not see a self-order claim or an offline replay already in flight). The owner chose
  this work on 2026-11-08 ("first 3 number wala ... one small session me proper complete").
- **Order after this session (the owner, 2026-11-08):** clean-up (merged branches, old worktrees, scratch), then
  Printing Phase 6 (parallel printing) planning.

## 1. What is wrong today (verified in the code on aab2a63)

1. **In-flight requests that name this tab are invisible to the reload rules.** A request made with the print headers
   carries `PRINT_LEASE_HEADER` while this tab drains the device's slips (`lib/print-agent-calls.ts` `printAgentHeaders`,
   `directPrintTab()`), so the server can lease the slips it makes to this tab in its answer. If the page unloads
   before that answer, those jobs are leased to a dead tab: they wait out the 90 s lease (`PRINT_LEASE_MS`) and come
   back marked REPRINT (bill / token: DUPLICATE). `printHostBusy()` (`lib/print-host-busy.ts`) only counts the agent's
   lease + print and the token holders. The 11 call sites that send the print headers:
   - automatic (staff cannot know): `hooks/use-self-order-auto-print.ts:88` (kot-claim), `hooks/use-offline-replay.ts:121`;
   - staff actions: `hooks/use-orders.ts:237` (create), `:317` (add items), `:344` (settle, bill), `:366` (table move),
     `hooks/use-item-void.ts:37`, `hooks/use-order-requests.ts:141` (accept), `hooks/use-offline-fix.ts:37`,
     `hooks/use-print-setup.ts:92` (test print: `{ headers: printAgentHeaders(readDeviceId()) }`),
     `hooks/use-host-routing.ts:137` → `hooks/use-print-host.ts:65` (enqueue: the headers ride in the job).
2. **Four document loads skip the print rule and the closing gate** (`closePrintHost`, R60):
   - `lib/navigate.ts` `applyNavAction` "full-load" (a staff tap on a screen this page does not hold while a newer build
     is pending, Part D) and `retryNavigation` ("Try again" under "Still opening…", Part C: always a full load);
   - `app/(dashboard)/error.tsx`: the automatic chunk-error reload (line 31), the "Reload" button (64) and "Go to
     dashboard" (68). The dashboard layout (print agent, print host) stays mounted under this error boundary.
3. **R67:** Refresh and the "Update ready · Reload" chip (`hooks/use-ask-first-reload.ts`) refuse with a toast for as
   long as a slip is printing; with a stuck printer that is up to the write deadline (35–75 s by transport) plus the
   agent's grace, and staff have no way to go ahead.

Already right, keep: the quiet self-reload (`components/layout/UpdateWhenQuiet.tsx`: print hold, `isMutating`, the
outbox and the fresh pulse all block it); requests started during the 8 s closing window name no tab (`directPrintTab`
returns null, R65); the self-order claim does not start while closing.

## 2. The design (the orchestrator's rulings; record each in the ledger with its cost if wrong)

- **R70: count every request that names this tab as print work while it is in flight.** The shared `apiSend`
  (`packages/shared/src/api-client.ts`) gains one generic, optional option `track?: <R>(work: Promise<R>) => Promise<R>`
  next to `headers` (applied around the whole fetch + unwrap, so the outcome is handed back unchanged; every other
  caller, the Hub included, is unaffected). In the cafe, one helper in `lib/print-agent-calls.ts` turns print headers into
  apiSend options: `{ headers, track: trackPrintBusy }` exactly when the headers carry `PRINT_LEASE_HEADER`, else
  `{ headers }` as today. `printAgentRequestOptions` uses it (9 call sites covered with no line change); the two other
  shapes (`use-print-setup.ts:92`, `use-print-host.ts:65`) use it too, each a same-length edit. A request with no lease
  header is not counted (its slips go to the line, not this tab). Bound: `REQUEST_TIMEOUT_MS` (15 s) aborts any request.
  Effect staff can see: Refresh / the chip during any such request (normally under a second) says "A slip is printing.
  Refresh once it is done." instead of asking about the unsent order. Cost if wrong: one more toast in a rare second.
- **R71: one gate for every other document load the staff app starts.** `lib/print-host-busy.ts` gains
  `leaveWhenPrintFree(go): () => void` (returns a cancel): print free → `closePrintHost()` then `go()` at once; busy →
  re-check on a local timer (`PRINT_FREE_CHECK_MS` = 250 ms; no request, no new recurring request) until free, then the
  same. Users: the navigation full load and "Try again" (`lib/navigate.ts`, through `NavDeps` so tests inject it), and
  the three loads in `app/(dashboard)/error.tsx`. A waiting navigation load is cancelled by everything that ends that
  navigation (Back = `abandonNavigation`, a same-path tap, a newer tap, popstate / pageshow cancels in
  `NavProgressView`): never a late load after Back. While it waits the cover shows as for any slow navigation ("Still
  opening…" at 8 s). The error buttons show they are waiting (disabled, words of the session's choice). Cost if wrong:
  with a stuck printer a pending full load waits up to the write deadline; Back keeps the POS; the Printer panel
  frees the printer.
- **R72: "Refresh anyway" (R67).** `print-host-busy.ts` also keeps when the current continuous hold began
  (`printHostBusySince(): number | null`). Refresh / the chip: a hold younger than `PRINT_STUCK_MS` = 30 s keeps
  today's toast; an older one opens a question instead. Draft words (verify against the real lease-expiry behaviour in
  `packages/shared/src/print-lifecycle.ts` and keep them true; show the final words to the owner): title "Printing is
  taking long"; body "A slip has been printing on this device for over 30 seconds. If the printer is stuck, stop it
  in the Printer panel. If you refresh now, that slip prints later and may come out twice (marked REPRINT or
  DUPLICATE)."; buttons "Wait" (cancel) and "Refresh anyway" (confirm). Confirming waives only the print hold:
  offline still refuses; unsent work still asks its own question (`decide(confirmWork, confirmPrint)`, extending
  R66's `decide(confirmed)`); then `closePrintHost()` and the reload. Why 30 s: a 3-station Bluetooth round holds
  10–25 s (Phase 6 spec §1), so 30 s is past any normal round. Cost if wrong: a staff member waits up to 30 s
  before the choice appears.
- **R73: left as they are, on purpose** (documented with a comment where one is missing, no behaviour change):
  `app/global-error.tsx` (the whole tree is gone, nothing prints), `DeviceSessionGate`'s `/login` (signed out: no
  lease can be granted), sign-out (`hooks/use-auth.ts`, staff's choice, ends the device's printing role),
  `components/public/PublicMenu.tsx` (the diner page has no print host).
- **R74: still parked:** the sub-frame gaps between a request's answer and the agent / bridge taking the job (R56,
  R64); R68 (a tap within ~2 min of an internet drop behind working Wi-Fi). R39 stays not built (the owner).

## 3. Tasks (test-first; every new assert with a message; source pins move only on purpose and are proven to bite)

**Task 1: the busy state and the gate** (`lib/print-host-busy.ts`, `lib/print-host-busy.test.ts`).
`printHostBusySince()` (set when the hold starts, null when it ends, across holders and in-flight work);
`PRINT_FREE_CHECK_MS`; `PRINT_STUCK_MS`; `leaveWhenPrintFree` with an injectable timer for tests: free → closes then
goes once; busy → never goes while busy, goes once on the first free check, closes right before going; cancel stops it
for good; two gates in a row do not double-go.

**Task 2: R70** (`packages/shared/src/api-client.ts` + its test; `lib/print-agent-calls.ts`; `hooks/use-print-setup.ts`;
`hooks/use-print-host.ts`). Shared: `track` wraps the request and returns its exact outcome (value and error, the
timeout included); omitted = today. Cafe: lease header → tracked, none → not tracked; a pin that every call site
sending the print headers goes through the helper (the 11 sites above, by file) and that `printHostBusy()` is true
while a tracked request is pending. Run `packages/shared` tests and the Hub's typecheck if it imports `apiSend`.

**Task 3: R71 in navigation** (`lib/navigate.ts`, `components/layout/NavProgressView.tsx` if needed, `lib/navigate.test.ts`,
`lib/app-link-paths.test.ts` and the other pins that read these lines). The full-load branch and `retryNavigation` go
through the gate; offline "Try again" keeps its toast; the cancel paths above stop a waiting load; `lib/navigate.ts`
stays the one decision.

**Task 4: R71 on the error screen** (`app/(dashboard)/error.tsx`, `lib/chunk-reload.test.ts`, `lib/offline-page-paths.test.ts`).
The chunk-error reload keeps its loop guard (`armChunkReload`) and goes through the gate; the two buttons too.

**Task 5: R72** (`lib/page-refresh.ts`, `hooks/use-ask-first-reload.ts`, `lib/page-refresh.test.ts`,
`lib/update-paths.test.ts`). `reloadStep` learns the stuck hold; the question; `decide(confirmWork, confirmPrint)`;
the chip and the POS Refresh button both get it (one hook). WebView 109-safe; the dialog is the shared ConfirmDialog.

**Task 6: verification and close.**
- Every suite on the head: cafe (`npm test` in apps/cafe), tsc, eslint, `packages/shared`, apps/mobile, apps/desktop,
  root go-live / hygiene / print-tools / release-native, the paper pin (`lib/print-budget.test.ts`, unchanged), the
  print-host live legs on a fresh `pos_scratch_*` DB (dropped), `next build` (NEXT_TELEMETRY_DISABLED=1) +
  `scripts/static-routes-check.mjs`.
- Local e2e on a production build (any free port except 3110 / 3130 / 3140), Playwright, the request delayed with
  `page.route` so the window is certain: (a) a kot-claim in flight → Refresh shows the printing toast, after the answer
  Refresh reloads; the same for an offline replay send; (b) a build pending (the D3 twin-build "deploy") + a print
  request in flight → a tap on an unheld screen shows the cover, no document until the request settles, then one
  document; Back during the wait → no document at all; (c) a hold older than 30 s → the question; "Wait" keeps the
  page; "Refresh anyway" reloads once; (d) the error screen's chunk reload waits for a hold. Local axe: 0 on the question.
- Devices: the Windows app (unpackaged `apps/desktop/out`, a network printer on `scripts/fake-escpos-printer.mjs
  --delay 60000` = a stuck printer): a slip on the stuck printer, Refresh at under 30 s → toast, after 30 s → the
  question, "Refresh anyway" → reload. The Android emulator, WebView 109 and 154: the question renders and both buttons
  work. Put the emulator back as found.
- A Claude Fable 5.1 review of the whole branch, one fix wave, then an adversarial verifier whose only question is
  "can any document load or reload still cut a print job leased to this tab, or reload while offline?"
- Results below; memory; the owner's merge / push word.

## Global constraints (from the P2 sessions; all of them, always)

Local only (never deploy, publish, upload; no connectors; the live demo read-only and without login; Playwright / local
a11y tools, not chrome-devtools-mcp; `next build` with NEXT_TELEMETRY_DISABLED=1); only this project's processes and
ports, never :3110 / :3130 / :3140; only `pos_scratch_*` DBs the session creates, dropped at the end, never
`pos_scratch_e2e_4g_uibase` / `_uimatch`; never `rm -rf` a worktree or anything with junctions; never run a script the
session did not write; no test deleted; source pins move only on purpose and are proven to bite; every new assert with
a message; files <= 300 lines and a file over 300 never grows (`hooks/use-orders.ts` is 398: same-length edits only;
`hooks/use-host-routing.ts` is 294); WebView 109-safe CSS; no new recurring request; accuracy never traded for speed;
the paper never changes; offline KOTs untouched; printing's safety rules hold.

## Results

(The session fills this in: commits, suites, the e2e and device runs, the review chain, rulings R70+ as built.)
