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
  same line (Pay Now's bill) is not announced either, exactly as before the fix. A realtime frame to yourself would
  only cost a Worker request and, arriving mid-cycle, one more lease.
- **The enqueue** (a token reprint, or a token slip an order answer did not name) skips `enqueueDirectPrintJob`
  for a token and takes the Phase 1 lanes (made queued for the host, or the device's own). Rare, so it keeps
  Phase 1's announce there.
- **Budget.** The S7 token pins already price a token at a lease and an ack (2 requests); only printers mode, on
  the device that writes the bill printer, moves from 1 request to 2. No existing pin changes; a new pin prices
  that day.
- **T3** shows its warning from the printers list (the same cached read as the agent's: no new request), whatever
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

(Written when the work is done.)
