# Token slips and direct print — fix after the print-customization merge

Branch `fix/token-direct-print` from `main` at `1fad8b9`. Not merged, not deployed.

## The finding

A fresh review of the print-customization merge (`03887b2`, `1fad8b9`) found that the token kind fence
(`leaseKindFence`, `lib/print-lease.ts`) guards only the lease call. Direct print at creation has no kind check:
`askingTabOf` in printers mode, the simple-mode `tab` in `createOrderPrintJobs`, and the POST `/api/print-jobs`
enqueue (`enqueueDirectPrintJob`). With tokens ON and an older page (from before S7) still open:

- printers mode: a token is made leased to a page that cannot draw it; it fails as "maybe" and prints late with a
  DUPLICATE banner;
- simple mode: an old host never prints tokens (they wait in the panel).

No paper is lost or doubled.

## Decisions

- **One rule, `printsDirectAtCreation(kind)`** in `lib/print-direct.ts` (the server's rules for direct print): a
  `"token"` job is never made leased at creation; every other kind keeps direct print exactly as it is.
- **A token on the asking tab's own line is the asking tab's to lease.** It is made queued and, like a slip made
  leased to that tab (decision 16), it is not announced to the device that asked: the answer names it (a queued
  ref, which `followPrintJob` turns into `kickPrintAgent`), or the KOT's ack says `more`. So a slip behind it on the
  same line (Pay Now's bill) is not announced either, as before the fix on a free line. (On a busy line, a request
  whose first slip there is a token now announces nothing, where its first slip used to be announced: not a strand,
  the answer's refs kick the agent; the review's M-1.) A realtime frame to yourself would only cost a Worker request
  and, arriving mid-cycle, one more lease.
- **The enqueue** (a token reprint, or a token slip an order answer did not name) skips `enqueueDirectPrintJob`
  for a token and takes the Phase 1 lanes (made queued for the host, or the device's own). Rare, so it keeps
  Phase 1's announce there.
- **Budget.** The S7 token pins already price a token at a lease and an ack (2 requests); only printers mode, on a
  counter that writes the bill printer but no full copy, moves from 1 request to 2. No existing pin changes; new pins
  price that day and (after the review) hold the printers-mode token days S7 never priced, as OPEN for the owner.
- **T3** shows its warning from the printers list (the agent's cached query: at most one read when a tab opens the
  page without it, never recurring), whatever
  the tokens switch says: `tokens-settings-paths.test.ts` pins that the page reads no other field (`useWatch`).

## Tasks (TDD: every RED seen before its GREEN; every new assert has a message)

- **T1** never leased at creation: unit tests on the real `createRoutedPrintJobs` and `createOrderPrintJobs` over
  fake models (with the realtime publish captured), a source pin on the route; live leg (ay) extended: printers
  mode with a separate bill printer and the request's `x-pos-print-lease` + `x-pos-print-ready` for it (token
  `queued`, not `leased(direct)`; it leases next, prints once, unlabelled; the bill behind it), and a simple-mode
  case where the token is the request's first slip. Budget re-check.
- **T2** `docs/GO-LIVE-CHECKLIST.md` step for turning tokens on, and the one-line hint under the tokens switch,
  pinned verbatim (doc ↔ constant ↔ component), go-live-runbook.test.ts pattern.
- **T3** the no-bill-printer warning on the Tokens page: a pure helper plus its test, the component pinned.
- **T4** the restart-time note ("change it outside service hours"), pinned.
- **T5** the repair comment (a missing token is re-created only by the client lane's enqueue, `token:<id>`),
  legAY's check labels "(ah)" → "(ay)", both pinned.

Not in scope: Phase 3, the design engine and editors, the chunk wait toast.

## Verification

`df -h /d` first; each suite once, in the background, one after another: shared; cafe; tsc + lint for cafe, hub,
mobile and desktop; mobile + Jest; desktop; `npm run test:print-tools`; live legs
(`MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_host npm run verify:print:live`); the Next build.
`git diff --stat main..HEAD -- apps/mobile apps/desktop workers` must be empty (no APK or desktop rebuild).

Baseline at `1fad8b9`: shared 800/800; cafe 4967 / 4966 pass / 0 fail / 1 skipped (go-live-dl); tsc 0 and lint 0
errors (+2 old warnings) for cafe, hub, mobile and desktop; mobile 125 + Jest 3; desktop 192; print tools 8; live
legs 350/0; Next build 132 routes.

Then a fresh reviewer on Claude Fable 5.1 (read-only; scratch tests only in the session scratchpad).

## Results

Branch `fix/token-direct-print` from `main` `1fad8b9`. Not merged, not deployed. Commits: `8df1b48` (this plan),
`904c670` (T1, T5), `e7f8e60` (T2–T4), `aaf5242` (the review's I-1: honest budget pins; decision texts corrected),
then this Results commit.

### What changed

- **T1.** `printsDirectAtCreation(kind)` (`lib/print-direct.ts`) is false only for `"token"`. It is applied on every
  creation path: `createRoutedPrintJobs` (printers mode, right after `askingTabOf`), the simple-mode loop of
  `createOrderPrintJobs`, and `enqueueDirectPrintJob` (POST `/api/print-jobs`). For a token the enqueue answers null,
  so the route's Phase 1 lanes make it queued, for the host or else for the asking device. A token on the asking
  tab's own line still belongs to that tab (`tokenForTab`): nothing on that line is announced to it, as for a slip made
  leased (decision 16). The tab leases it from the answer's queued ref, or after the KOT's ack (`more`). KOT and bill
  direct print are unchanged; landmark tests and live checks show it.
- **T2.** `TOKENS_RELOAD_HINT` (`lib/token-settings-notes.ts`) sits under the tokens switch, word for word as asked.
  The runbook's new step "Existing cafes: turning token slips on" quotes it verbatim.
- **T3.** `tokensHaveNoBillPrinter(printers)` is true when printers mode is on and no routable printer takes bills.
  Then the Tokens page shows `TOKENS_NO_BILL_PRINTER_WARNING` with a link to Printer setup, read with
  `usePrintersRead` (the agent's cached printers query). The warning shows whatever the switch says, because
  `tokens-settings-paths.test.ts` pins that the page reads no other field (no `useWatch`).
- **T4.** `NUMBER_RESET_HINT` on the restart time: a change during service can repeat or skip tonight's token,
  kitchen ticket and bill numbers, so change it outside service hours. `slip-day.ts` shifts the day key either way.
- **T5.** `lib/print-repair.ts` now says a missing token is re-created only by the client lane's enqueue
  (`token:<id>`), never by the repair. Leg (ay)'s 19 "(ah)" labels and its header now say "(ay)".

### TDD record (each RED seen before its GREEN)

| Test | RED | GREEN |
|---|---|---|
| `printsDirectAtCreation` (print-direct.test.ts) | not a function | 6/6 |
| printers mode, the real `createRoutedPrintJobs` over a fake PrintJob, publish captured by its fetch (print-printer-jobs.test.ts) | `token@counter:leased` | 9/9 |
| simple mode, the real `createOrderPrintJobs`, token as the first slip (print-token-jobs.test.ts) | `token:leased` | 12/12 |
| `enqueueDirectPrintJob` with a token | answered `leased` | null, nothing written |
| live leg (ay), 12 new checks, run alone against the pre-fix lib files (stashed, then restored) | 7 FAIL | 30/30 |
| budget pin | missing export `PRINT_REQUESTS_PER_TOKEN_SLIP` | 34/34 |
| T2–T4 pins | module missing, then the component and runbook pins | 13/13, 94/94 |
| T5 pins | both failed | 21/21 |
| review I-1 budget pins | missing export `printTokenRequestsPerDay` | 36/36 |

### Pins changed on purpose

- `print-order-jobs.test.ts`, "PIN: createOrderPrintJobs never throws, announces each new job…": the simple-mode
  `const tab = …` line now ends `|| tokenForTab ? {} : …`, plus two asserts that name the token rule.
- `tokens-settings-paths.test.ts`, "fields: registers the three names…": the restart hint's old words ("On the day you
  change it, a few numbers can repeat.") left its copy list. The T4 test pins `NUMBER_RESET_HINT` and checks that the
  old words are gone.
- No budget pin changed or loosened. New: `PRINT_REQUESTS_PER_TOKEN_SLIP`, `printTokenRequestsPerDay()`, and three
  pins (below).

### Budget, honestly

The S7 pins already price every token slip at a lease and an ack (2 requests), and no pin priced a token as made
leased, so none changes. The fix moves one day only. In printers mode, a counter writes the bill printer but no full
copy and takes every order. There a token was 1 request (made leased) and is now 2. That day goes from **5,160 to
5,460** requests (**5,652** with every printer-list read), inside the 6,000 normal ceiling. Realtime is at most one
Worker request per token (none when the asking tab prints it): 2,285 on a heavy day.

**OPEN for the owner.** These are pre-existing since S7, never priced by the merge, and not moved by this fix. They
are pinned as OPEN in `print-budget.test.ts`:

- The 2C heavy counter day with a token per order is **6,000**, and **6,192** with the printer-list reads, over the
  normal ceiling. The counter writes the full copy too, so the token always waited behind it.
- Printers mode's heavy setup with a token per order, taken on devices that print nothing, is **6,450** a day on a
  healthy socket (**6,642** with reads) and **18,288** at worst (**18,480**). Both are over their ceilings.

### Numbers

Verification at `e7f8e60` ran each suite once, in the background, one after another (D: 13 GB free). The review fix
(`aaf5242`, the budget test and module only) re-ran the suites it touches.

| Suite | Baseline `1fad8b9` | Here |
|---|---|---|
| shared | 800/800 | 801/801 at `e7f8e60`; **803/803** at `aaf5242`; tsc 0 |
| cafe | 4967 / 4966 / 0 / 1 skipped | **4981 / 4980 / 0 fail / 1 skipped** (go-live-dl), +14 |
| tsc + lint for cafe, hub, mobile, desktop | 0, 0 errors (+2 old warnings) | the same at `e7f8e60` and `aaf5242`; the 2 warnings are in `lib/masters-blob.test.ts` |
| mobile + Jest | 125 + 3 | 125 + 3 |
| desktop | 192 | 192 |
| print tools | 8 | 8 |
| live legs | 350/0 | **362/0**, +12 in (ay) |
| Next build | 132 routes | 132 routes |

`git diff --stat main..HEAD -- apps/mobile apps/desktop workers` is empty, so no APK or desktop rebuild is needed.

### Review

A fresh reviewer on **Claude Fable 5.1** (no 429) worked read-only, with scratch probes only in the session
scratchpad (`review-fable/`: 6/6 real-code probes plus a budget probe). Verdict: ship the code as is, and fix the
budget pin first.

- **Critical:** none.
- **Important I-1 (fixed, `aaf5242`):** the token pin's narrative was wrong, because the 2C counter day does not move,
  and the honest printers-mode token days were missing. It is now three pins, as above.
- **Minor, listed and not fixed:**
  - **M-1.** On a *busy* line, a request whose first slip there is a token now announces nothing, where the first
    slip used to be announced to its own device. Nothing is stranded: the answer's refs kick the agent, the running
    cycle's ack `more` leases again, and the 20 s pulse kicks. A kick while `busy && !running` is dropped
    (`lib/print-agent.ts`), and `setGate` → `nudge` or the pulse recover it, the same as the old self-frame. The plan's
    decision text is corrected.
  - **M-2.** An older page as the asking counter: while a token waits on its line, every ack answers `more:true` and
    every 20 s pulse counts it (`printLineHasMore` and jobs-for-me have no kind fence). That is an empty lease each
    time until the token is 30 min old. After that, a reloaded page's lease no longer sees it, and staff tap Print now
    in the panel. This is pre-existing S7 behaviour. Suggested fixes: the runbook's "until a reloaded page prints it"
    should add "within 30 minutes; after that, Print now in the panel"; and a kind fence on `more` and jobs-for-me
    (Phase 3).
  - **M-3.** T3's "no new request" was slightly overstated: there is at most one GET `/api/printers` when a tab opens
    the page without the cached list, and it never recurs. The plan text is corrected; the component's comment still
    says "(no new request)".
- **Checked and sound:** the rule is consulted on all three `tab` passers. `insertPrintJob` is the only writer.
  `redeliveryOf` needs a tab, which a token never passes, so a token is never handed back leased. The kot-claim lane,
  the repair and the test slip are covered. The enqueue makes one job with the right target. Both client sites follow
  the token ref. A lost answer is covered by the pulse, which is better than before (no lease expiry, no DUPLICATE).
  KOT direct print is unchanged on free and busy lines. T3's rule equals the routing. The test stubs are restored, and
  the fetch capture is reliable. T4's wording matches `slip-day.ts`.
