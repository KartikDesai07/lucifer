# Printer UX: a simple printer panel, a clear "printer stopped" path, a list that really clears (design)

Date: 2026-11-05. Branch `feat/printer-ux` (from main `82e3321`). Status: **APPROVED by the owner 2026-11-05** (one
question round, every recommended option; "Design approve: Haan"). Builds in Sessions PX-2 and PX-3 (§12).

Paths: C/ = `apps/cafe/`, S/ = `packages/shared/src/`. Evidence: the review `D:\kd\pos-dev-keep\printer-ux\review-2026-11-05.md`
(local, measured on a build of 82e3321 with a fake Android app and a fake printer), re-checked in PX-1 (§5), and the
mockups `D:\kd\pos-dev-keep\printer-ux\mockups\index.html` (`out\<screen>-<width>.png`; local only, never in the repo).

## 1. Summary

The client's printer stopped and the staff did not know where to go or what to do. The panel behind the top-bar printer
button is long (556–1,435 px of scroll on a phone), puts setup choices above the printer, hides the real fix (Reconnect)
under the waiting list, and two of its list buttons fail silently: **Print now** on a slip younger than 30 min is refused
by the server and the row stays; **Clear** on a slip that is being printed at that moment is refused (`raced`, no word),
the row vanishes and comes back after the failed try. In printers mode (the client's setup: an Android tablet with two
Bluetooth printers) the card names and reconnects the WRONG printer, and a waiter phone shows a green dot while the
kitchen printer is down.

The design:
1. **Two views in the one sheet.** The panel opens on **STATUS**: one card that says in one line whether printing works
   here and, when it does not, at most 3 numbered steps and ONE button that fixes it. Below it, only when slips wait, a
   short **Not printed** card. Then one row, **Printer settings ›**, that opens the **SETTINGS** view in the same sheet
   (back arrow). Everything about connecting, changing, removing, paper width, "one device prints for all", fast text
   KOTs and the rest lives there.
2. **The Not printed list:** a summary line + compact rows (newest problem first), a button only where it works, a
   Clear that always removes the row for good (the server clears a slip that is printing at that moment once that try
   ends), **Clear all** with a confirm, 5 rows shown and the rest one tap away.
3. **Printers mode first-class:** the card names the printer that is down and Reconnect reconnects THAT printer (every
   printer of this device that is down); a device that prints nothing turns amber and names a printer whose slips wait.
4. **Behaviour fixes** the owner approved: no red ↔ "Checking…" flicker during the app's own retries, a printed slip
   leaves the list at once on the device that printed it, the 20 s alarm toast never covers the open panel, the /pos
   toast never says "print the slip again" for a slip that prints by itself, a retry of a slip that is gone says so.
5. **PX-3:** the settings view redesigned as cards, a guided **Connect a printer** (type → found list → connecting →
   test slip yes/no → 3 tips), the words everywhere, one row per physical printer, an Allow button for Android's
   Location ask (web side). Native items (Windows / Android 2.0.3) are later, separately.

Web only. No new recurring request. The paper never changes. The lifecycle keeps every guarantee; its one change
(clear after this try) is pinned by tests (§3).

## 2. The owner's words and rules

2026-11-05 (Hinglish, in short): the printer UI must be easy to use and to understand; the client could not tell how to
do what; show simply where to go and what to do, how to reconnect a printer or connect a new one; the top-bar printer
panel with not much content, normal and easy; Print now / Clear in the "not printed" list do not remove the slip; with a
long list the scrolling is not nice; the client's printer stopped and they did not know where to go; nothing long that
nobody reads; every change smooth on mobile, tablet and laptop; review everything, skip nothing.

Standing rules: "current perfect working hai, so very very very careful" (printing works in the field: nothing that
works changes unasked); smooth, fast and accurate in a rush; nothing unused; ₹0 forever on each cafe's own free
accounts; few rounds with the owner, never a skipped check; local only; branch only, merge and push only on his word.

## 3. Safety rules (each pinned by a test; a PX session that cannot keep one stops and asks)

| # | Rule | Pinned by |
|---|---|---|
| SR-1 | **The paper never changes.** No slip renderer, KOT text, bill layout or label word changes. | `PIN (S1)` in C/lib/printer/kot-text/text-kot-print.test.ts stays green, unchanged; every file under C/lib/printer/kot-text/, the slip components and S/print-design* untouched (a path test in PX-2 Task 8). |
| SR-2 | **Print-budget ceilings never loosen; no new recurring request.** No new poll, `refetchInterval`, `router.refresh` or timer that calls the server. Every new request is a staff tap, counted in §7. | S/print-budget.test.ts unchanged and green + one new test (PX-2 Task 2): the panel adds 0 recurring requests; Clear all = 1 request for up to 20 slips. |
| SR-3 | **No slip lost silently.** A slip leaves the list only by printing, by staff (Clear, Clear all, It printed) or by retention (3 h). A clear asked while the slip is printing ends as `dismissed` only when that try did not print; a printed ack still wins. | S/print-lifecycle tests (PX-2 Task 1): every exit from `leased` with and without the request. |
| SR-4 | **No unlabelled duplicate.** The clear request never puts a slip back in line; Print now / Try again / Print again keep `planRetry` / `planConfirm` exactly. | Task 1 tests + the existing planRetry / planConfirm tests unchanged. |
| SR-5 | **Two attempts.** `uncertainAttempts` and `PRINT_MAX_PAPER_ATTEMPTS` logic unchanged. | Existing lifecycle tests unchanged. |
| SR-6 | **No attempt while a printer is off.** The agent's lease gates unchanged; Reconnect only reconnects (it never leases). | Existing agent tests unchanged (print-agent.test.ts, readyPrinterIdsOf). |
| SR-7 | **Retention unchanged.** `prunePrintJobs` filters unchanged; a leased slip with a clear request is kept and pruned by the same rules. | Existing retention tests unchanged + one Task 2 case. |
| SR-8 | **Every old app and page keeps printing.** Apps 2.0.0–2.0.2, bridge v1 and v2, an open old page: the lease, ack, wake and pulse wire shapes are unchanged (only optional fields are added). | Task 1/2 tests: an ack answer `status: "dismissed"` read by today's agent code (print-agent-acks) ends that job's tries. |
| SR-9 | **One waiting panel.** The list stays in the printer panel (and inline on /printers); the dashboard band's own rows keep their buttons. | printer-panel-layout.test.ts (changed on purpose, PX-2 Task 6). |
| SR-10 | **The clear request is part of the CAS.** An ack or an expiry that read the slip before the request was written re-reads it, so the request is never lost. | Task 1: `printJobCasFilter` includes it; an interleaving test (Task 2). |
| SR-11 | **Accuracy is never traded for speed.** Money, stock, KOT numbers, open tabs: untouched. Offline (Phase 5) words and rules: untouched. | No file under C/lib/offline-*, C/lib/pos-send*, C/hooks/use-offline-send* changes (Task 8 path test). |

## 4. Decisions (the owner, 2026-11-05)

| # | Question | Answer |
|---|---|---|
| F-1 | Web deployed with Phase 5 (82e3321)? | **Not yet.** Clients run the older main. |
| F-2 | The client with the stopped printer uses | **Android app + Bluetooth, several printers mode** (Kitchen + Bill printers). |
| F-3 | 2.0.2 apps uploaded? | **Yes.** |
| F-4 | Is that client's printing blocked today? | **No, it works now** (no hotfix first). |
| PX-D1 | Layout | **One sheet, two views** (status first; "Printer settings ›" opens settings in the same sheet, back arrow). Not a settings page. |
| PX-D2 | Clear on a slip that is printing at that moment | **Clear after this try** on the server: the try fails → dismissed, never back in the list; the paper came out → printed. |
| PX-D3 | Print now | **Buttons only where they work:** no print button on a slip that prints by itself (the status card's one Reconnect is the fix); "Try again" on one that could not print; "Print now" on one waiting over 30 min; "Print again" / "It printed" on a bill to check. |
| PX-D4 | Clear all | **Yes, with a confirm.** One request, only the slips the list holds. |
| PX-D5 | "One device prints for all" | **In the settings view** (a card "Print for other devices"; not on the status view). |
| PX-D6 | Printers mode, a device that prints nothing | **Amber dot + the printer's name** when a printer's slips wait (no new request). |
| PX-D7 | Native items (Windows / Android 2.0.3) | **Later, separately.** Web-side parts (Allow button, words) in PX-3. |
| PX-D8 | Design approve (with the fixes listed in §6.9) | **Yes.** PX-2 = status + list + behaviour; PX-3 = settings + guided connect + words. |

## 5. Current state (main 82e3321; measured in the review, re-checked in PX-1)

Re-run in PX-1 on a fresh scratch DB (`pos_scratch_e2e_4g_px1`, log `D:\kd\pos-dev-keep\printer-ux\px1\probes.log`):
- **Print now** on a 1-min queued KOT: `POST …/retry` 200 `{"applied":false,"status":"queued","reason":"wrong-status"}`; the
  row stayed 40 s; only a 6 s toast. Cause: `planRetry` (S/print-lifecycle.ts:512-537) takes a failed slip or a queued
  slip older than `PRINT_HOST_MAX_AGE_MS` (30 min) not tapped before; the button shows on every queued row
  (C/components/print/WaitingSlipsCard.tsx:78-86).
- **Clear** while the slip was leased (the app's reconnect loop said "connected", a 25 s write then failed):
  `POST …/dismiss` 200 `{"dismissed":false,"reason":"raced"}`, no toast (C/hooks/use-print-host.ts:108-115 has no success
  handler); the row left on the refetch (a leased slip is not in the feed, C/lib/print-attention.ts:24-34), the slip went
  back to `queued` at +26.8 s (it returns to the list on the next pulse). Cause: `dismissPrintJob`'s CAS never takes
  `leased` (C/lib/print-queue.ts:251-275).

From the review (file:line verified there or in PX-1):
- Panel order (C/components/print/PrinterPanel.tsx:48-53, PrinterSetupCard.tsx:204-248): waiting list → status banner →
  Where slips print (blue "Print all slips on this device") → Printer on this device (a second Reconnect) → Fast text
  KOTs → Test print → More options → Bill printer. Extra scroll phone/tablet/laptop: none 556/66/527, connected
  641/178/624, off 698/—/681, 6 waiting 1,435/955/1,418 px.
- The copy: `printerHeadlineOf` (C/lib/printer/printer-dot.ts:200-300); the dot rules `printerDotOf` (:140-148).
- After Reconnect the waiting slips print by themselves (no duplicate) but stay listed ~11 s (nothing refreshes the
  feed on an ack; the pulse does).
- The alarm toast (C/hooks/use-print-slip-alarm.ts:52-63, Infinity, "Show") sits over the open panel's list on a phone;
  the hook never checks whether the panel is open.
- /pos toast `PRINTER_NOT_CONNECTED_MESSAGE` "…reconnect it, then print the slip again." (C/lib/printer/web-printer-types.ts:99-100)
  for a slip that prints by itself after the reconnect.
- A 404 on a retry says "That did not go through. Check the connection and try again." (C/hooks/use-print-job-actions.ts:23).
- An accepted Retry says nothing; the slip is back at once ("Waiting to print again, marked REPRINT.").
- Out of paper: "Printer needs attention / RPP02N is out of paper." — no button, no word that slips print by themselves.
- During the app's auto-retries the dot and the banner flip red ↔ "Checking the printer…" (`localRaster`
  connecting → checking, printer-dot.ts:101-107; `STATUS_WORSE` ranks connecting better than disconnected,
  C/lib/print-agent-printers.ts:199).

Verified in PX-1 (read-only survey, file:line):
- **A. Printers mode names and reconnects the wrong printer — confirmed.** `printersRow` reads `printers.worst ?? local`
  (printer-dot.ts:133-137), the worst link among the app printers this device writes; the copy's name is
  `snapshot.printer?.name`, the device's DEFAULT printer (PrinterPanel.tsx:38); Reconnect calls
  `devicePrinter().reconnect()` (PrinterStatusBanner.tsx:79-83) = the app's default printer (bridge v1
  `printer.reconnect`). A fine default + a dropped Kitchen printer: "Printer connected." while the dot stays red.
- **B. Android 7–11 Location: no Allow button and no settings link — confirmed.** On API ≤ 30 `hasConnect` is always true
  (mobile BtAccess.kt:24-26), the state never becomes `unauthorized`; a scan without Location fails UNAUTHORIZED →
  toast "Allow Bluetooth for the POS app, then reconnect the printer." (NativePrinterPicker.tsx:109: says Bluetooth,
  means Location, no button); no `openSettings` anywhere in the app.
- **C. One printer listed twice — confirmed for a dual-mode printer:** `bt-classic:MAC` and `ble:MAC` are different ids
  (PrinterDiscovery.kt:71-74, ScanSession.kt:118,139-145), the page lists every entry (NativePrinterPicker.tsx:197-200):
  "Bluetooth" + "Bluetooth (nearby)".
- Messages outside the panel (toasts, alarm, offline, header, Windows, Android): the survey's table is kept in
  `D:\kd\pos-dev-keep\printer-ux\px1\` notes; the ones this design changes are in §6.4 and §6.9. "Printer setup"
  pointers reach staff in 11 places (print-agent-printers.ts:22,24; OtherDevicePrinters.tsx:21; PrintWhereSection.tsx:29;
  printer-dot.ts:285,289 and the button names :153-157; print-lane.ts:32; print-routing.ts:31; desktop-shell-messages.ts:16;
  token-settings-notes.ts:14; print-design-labels.ts:194). The Windows app's "Open Settings, then Printing" points
  nowhere (apps/desktop/src/print-messages.ts:26,28; printer-check.ts:33): native, later (PX-D7); its web copies in
  C/lib/desktop-shell-messages.ts:10-16 change in PX-3.

## 6. The design

### 6.1 Frame and views

- The frame stays (owner rule 2026-10-22, U5): ONE Radix dialog, a 420 px aside over its scrim from 1280 px, the
  full-screen bottom sheet below; head, one scroller, the fixed Done foot (C/components/print/PrinterPanelFrame.tsx,
  C/components/print/printer-classes.ts). The panel keeps mounting only while open.
- **Views** (panel-local state, never a route): `status` (default on every open), `settings`, and in PX-3 `connect`
  (the guided connect). Switching views keeps the dialog, its scroll position resets to the top, focus moves to the new
  view's heading (the dialog title is focusable, `tabIndex={-1}`); when the Not printed card leaves (Clear all, the
  last Clear) focus moves to the status card's headline (F-M6). The view resets to `status` when the sheet closes.
- **Head:** status view: title "Printer" only (one line, 62 px tall; the old sub "Printer status and setup for this
  device" goes; the Radix Description stays for screen readers, visually hidden: "Printing on this device"). Settings
  view: a 34 px back button (chevron, `aria-label="Back to printer status"`) + "Printer settings". Connect view: back +
  "Connect a printer" + a 12.5 px sub "Step n of 3 · Bluetooth". The close (34 px) stays at the end.
- **Body:** padding 16 px 20 px, parts 12 px apart (today's values). Below 1280 px the sheet is the full window; from
  720 px the body's content is a centered column `max-width: 640px` (the head and foot contents too), so a tablet does
  not stretch a card to 780 px.
- **Foot:** "Done" (44 px, today's) on status and settings; "Cancel" (44 px, outline) on the connect view (back to
  settings).
- **/printers** (admin, inline, no frame): the status view's parts, then the settings view's parts below it, then the
  page's own Printers / Kitchen stations / Devices / apps sections, as today; no "Printer settings ›" row and no back.

### 6.2 The status view

Top to bottom: the status card (always) → the Not printed card (only when slips wait) → "On this device" (printers mode
writer only) → the "Printer settings ›" row. Nothing else. Measured on the mockups, extra scroll phone / tablet / laptop:
every single state 0 / 0 / 0 px; printer off + 5 slips 63 / 0 / 107 px; 20 slips (collapsed) 63 / 0 / 107 px
(today 641–1,435 px).

**The status card** (mockup values): radius 14, 1 px border, padding 16, gap 12. A 40 px circle (ok: --status-ok with a
white check; bad: --status-warn with a "!" in --foreground; checking: --surface-3 with a spinner). Headline 17 px / 600
(ok in --status-ok-ink, bad in --status-warn-ink), detail 13.5 px --muted-foreground. Steps (only on a bad state, at most
3): 22 px numbered circles (--card, 1 px #a6c8ff, --status-info-ink 12 px bold) + 14 px / 1.45 text, indented 52 px under
the headline. One primary button (44 px, full width of the card, radius 10, 15 px / 600) when a tap fixes it; one quiet
link (13 px / 500, --primary, a chevron) under it for the next step. A one-line note (13 px) where nothing can be tapped
(out of paper). The card keeps `role="status"` `aria-live="polite"`. ok tint `--status-ok-tint` / border
rgba(36,161,72,.3); bad tint `--status-warn-tint` / border rgba(255,131,43,.45); checking `--card` / `--border`.

**On this device** (printers mode, this device writes ≥ 1 printer): a card listing each printer this device prints:
a 9 px dot (ok green / bad amber), the setup's name (14 px / 500) over "RPP02N · Bluetooth" (12.5 px), and its state word
on the right ("Ready" / "Not connected" / "Out of paper" / "Cover open" / "Error" / "Connecting…"). No buttons here (the
card's one Reconnect does it; per-printer buttons are in settings).

**Printer settings ›**: a 60 px card row, 34 px tile (sliders icon), "Printer settings" 14.5 px / 600 over a 12.5 px sub
"Connect, change or remove a printer · paper size" (a phone in printers mode that writes nothing: "This phone has no
printer · Slips print at the cafe's printers"; the device noun as in §6.4), a chevron.

### 6.3 The Not printed card (replaces "Slips waiting")

- Card: --card, 1 px rgba(255,131,43,.45), radius 12. Head: "Not printed" 15 px / 600 + the count bubble (22 px, #da1e28,
  white 12 px / 700; the same text as the header badge: "5", "20+"), a 13 px summary line under it, and a 36 px "Clear all"
  outline button on the right.
- **Summary line:** only queued slips → "They print by themselves when the printer is ready."; any bill to check or slip
  that could not print → "Tap a button on the ones that need you."; prefixed "The newest 20. " when the feed was cut.
- **Order:** bills to check, then could not print, then waiting; newest first inside each (the feed hands rows oldest
  first: reversed per group). Today's group headings ("Waiting for the printer (6)") go; the reason line carries it.
- **Rows** (`ul`, one `li` each): min-height 56 px, padding 9 / 14 / 9 / 16, a 1 px --border-2 rule between rows. Left:
  the slip's label (14 px / 500) over "{age} · {reason}" (12.5 px). Right: small buttons (36 px, radius 8, 13 px / 500;
  the touch target 44 px via a transparent `before:` inset on coarse pointers). A row with 3 buttons wraps them onto
  a second line (the bill row).
- **Rows shown:** 5; more than 5 → a centered "Show all {n} ⌄" link (44 px tall, `aria-expanded`); expanded → every row and
  "Show fewer ⌃" at the end. No scroller inside the sheet's scroller (the sheet scrolls once).
- **Each row's words and buttons** (pure: `notPrintedViewOf`, PX-2 Task 3; the gone-printer row is checked first, then
  the table from the top, first match wins):

| The slip | Reason (meta) | Buttons |
|---|---|---|
| needs-confirm (a bill that may have printed) | "**May have printed.** Check the printer." (--status-warn-ink) | Print again · It printed · Clear |
| failed | "**Could not print.**" + the row's own safe words when it has them (today's `printWaitingReason` failed branch) (--status-bad-ink) | Try again · Clear |
| queued, not tapped, older than 30 min | "Waiting over 30 min." | Print now · Clear |
| queued, the slip itself refused once (`isSlipRefusal`) | "Could not be prepared. Tries once more by itself." | Clear |
| queued, its printer has a problem (`row.problem`, printers mode) | `printerProblemText(name, problem)` ("Kitchen printer is out of paper.") | Clear |
| queued, marked REPRINT / DUPLICATE | "Prints again, marked {REPRINT \| DUPLICATE}." (the row's own label, R6) | Clear |
| queued, the last try sent nothing (`printWriteOutcomeOf(lastError).sent === "no"`; today's words kept, R5) | "The printer is off or not connected." — or, from the Windows app, its own sentence (`isDesktopShellRefusal`) | Clear |
| failed or needs-confirm on a printer that is gone (`printerId === PRINT_JOB_NO_PRINTER` or `lastError === PRINTER_GONE_MESSAGE`; server facts only, R3) | "No printer takes it now. Print it again from its order." | It printed (a bill) · Clear |
| queued, otherwise | "Waits for the printer." / "Waits for {printer name}." (printers mode) | Clear |

- **Taps:** a tapped row's buttons are disabled until its own answer (today's per-tap promise, the 1D gate). Clear →
  the row leaves at once on `dismissed: true` (the pulse cache edited in place, then the existing one refetch) and never
  comes back (PX-D2, §6.9 B1). Try again / Print now applied → info toast "It prints as soon as the printer is ready."; the
  row's new words come from the next pulse answer (no optimistic rewrite, R6) and it shows Clear only. A 404 from the app's own API (an enveloped answer,
  `ApiError.enveloped`; never a host-level 404 during a deploy, F-M2) on any row action → the row leaves at once and an
  info toast "This slip is no longer waiting." `raced` (a slip an old print host claimed) → info toast "This slip is
  printing right now."
- **Clear all** (PX-D4): the head's button turns into an inline confirm (--status-bad-tint, radius 10): "Clear all {n}
  slips? They will not print." with "Clear all" (solid --status-bad, white) and "Cancel" (40 px each, side by side);
  focus moves to Cancel. Clear all sends ONE `POST /api/print-jobs/dismiss` with every id the list holds (shown or
  folded, at most 20: the feed's limit), removes them from the cache at once, refetches the pulse once. A 404 (an older server after a
  rollback) → error toast "Could not clear all. Clear them one by one."

### 6.4 Every state → words → button (the status card; replaces `printerHeadlineOf`'s copy for the panel)

`{printer}` = the printer's name (printers mode: the setup's name, e.g. "Kitchen printer"; simple mode: the saved
printer's name, else "The printer"); `{conn}` = "RPP02N · Bluetooth" (the app's name and the transport word; USB "USB",
network "Wi-Fi or network", a Windows printer "Windows printer", the Windows app's network printer "network"); `{host}` = the printing device's label (fallback "The printing device"). The device noun:
inside the Android app (bridge present or `inAppWebView()`) "this phone" when the screen's shorter side is under 600 px
(`Math.min(screen.width, screen.height) < 600`) and "this tablet" otherwise (R13); "this PC" in the Windows app; "this
device" otherwise. Steps for a printer that is not connected, by transport: Bluetooth "Turn the printer on." / "Keep it close
to {noun}." / "Tap **Reconnect**."; USB "Turn the printer on." / "Check the USB cable." / "Tap **Reconnect**."; network
"Turn the printer on." / "Check it is on the cafe's network." / "Tap **Reconnect**." (= `OFF_STEPS[transport]`).

| Dot reason (when) | Tone | Headline | Detail | Steps | Button | Link / note |
|---|---|---|---|---|---|---|
| no dot (lane pending / pulse loading) | checking | "Checking the printer…" | — | — | — | — |
| `checking` | checking | "Checking the printer…" | — | — | — | — |
| `ok`, this device prints (own printer) | ok | "Printer ready" | `{conn}` | — | — | — |
| `ok`, another device prints all | ok | "Printing is on" | "Slips print at **{host}**." | — | — | — |
| `ok`, the Windows app with a printer chosen | ok | "Printer ready" | the chosen printer's name | — | — | — |
| `printers-elsewhere` (printers mode, writes nothing, no slip waits on a printer) | ok | "Printing is on" | "Slips print at the cafe's printers." | — | — | — |
| **`printer-waiting`** (NEW, printers mode: a printer this device does not print has a fresh slip waiting in the feed: queued, ≤ 30 min old or tapped, not a slip refusal; R1), stuck: a row on it carries `problem`, or its oldest fresh row waited over 60 s (F-I2) | bad | "{printer} is not printing" | the row's problem text when it has one ("Kitchen printer is out of paper."), else "{n} slip(s) waiting for it." | "Check it is on and has paper." / "On the device it is connected to, open Printer and tap **Reconnect**." | — | — |
| `printer-waiting`, not stuck (a busy printer in a rush: no problem, every fresh row ≤ 60 s) | bad | "Slips are waiting for {printer}" | "{n} slip(s) waiting." | — | — | note "If they do not print soon, check it is on and has paper." |
| `device-offline` | bad | "This device is offline" | "Printer status updates when the internet is back." | — | — | — |
| `no-printer` (Android app / browser) | bad | "No printer on {noun}" | "Connect one to print slips here." | — | **Connect a printer** → settings (PX-3: the guided connect) | "Or print everything on one device ›" → settings, "Print for other devices" |
| `no-printer` (Windows app, none chosen) | bad | "No printer chosen on this PC" | "Choose this PC's printer so slips can print." | — | **Choose a printer** → settings | — |
| `printer-off` (simple mode) | bad | "Printer not connected" | `{conn}` | `OFF_STEPS` | **Reconnect** ("Reconnecting…" + spinner while it runs) | "Still not working? Connect it again ›" → settings (PX-3: guided connect, Bluetooth list) |
| `printer-off` (printers mode, one printer of this device down) | bad | "{printer} is not connected" | `{conn}` | `OFF_STEPS` | **Reconnect** (every printer of this device that is down, §6.5) | — |
| `printer-off`, two or more down | bad | "{n} printers are not connected" | the names joined ("Kitchen printer, Bill printer") | `OFF_STEPS` | **Reconnect** | — |
| `printer-off` on the Windows app (a network printer the app writes, `desktopLan`; F-I3) | bad | "{printer} is not connected" | "{name} · network" | "Turn the printer on." / "Check it is on the cafe's network." | — (the app has no reconnect) | note "This PC checks it again every minute." |
| `printer-needs-tap` (browser) | bad | "Printer needs a tap" | `{conn}` | — | **Reconnect** | — |
| `printer-elsewhere` (another tab owns it) | bad | "Printer in another tab" | "Print from that tab, or close it." | — | — | — |
| `printer-problem` paper-out | bad | "{printer} is out of paper" | `{conn}` | "Put in a new paper roll." / "Close the cover." | — | note "Waiting slips print by themselves after that." |
| `printer-problem` cover-open | bad | "{printer} has its cover open" | `{conn}` | "Close the printer's cover." | — | the same note |
| `printer-problem` error | bad | "{printer} reports an error" | `{conn}` | "Switch the printer off and on." / "Check the paper is not stuck." | — | the same note |
| `host-offline`, this device is the host | bad | "{host} is offline" | "Slips wait and print when this device is back online." | — | — | — |
| `host-offline`, can print here | bad | "{host} is offline" | "Slips wait and print when it is back." | — | **Print on this device** → settings, "Print for other devices" | — |
| `host-offline`, cannot print here (each of today's three cases) | bad | "{host} is offline" | "Slips wait and print when it is back." | — | Reconnect / Connect a printer as today's fix | — |
| `host-printer-off` | bad | "{host}'s printer is not connected" | "Slips wait and print when it is back." | "On {host}, open Printer and tap **Reconnect**." | — | — |
| `host-print-window` | bad | "Slips need a tap to print" | "{host} opens a print window for every slip." | — | **Set up the printer** → settings (only on the host itself) | — |
| `printer-not-here` (printers mode) | bad | "{printer} is not on {noun}" | "Connect it here, or ask your manager to change Printer setup." | — | **Connect a printer** → settings | admins: "Open Printer setup ›" (/printers) |

- The header button keeps its size, place, dot and count (mockup `out\header.png`). Its accessible name keeps today's
  strings (pinned) and adds one for the new reason: `printer-waiting` → "Printer not printing — open printer setup";
  PX-3 may re-word the five names together (§6.8).
- `printerHeadlineOf` and its copy are deleted in PX-2: the panel was their only reader (R11); the panel reads the new
  `printerStatusViewOf` (§12, Task 5). The button names stay in printer-dot.ts.

### 6.5 Printers mode (the client's setup)

- `dotPrintersOf` (C/lib/print-agent-printers.ts:208+) also returns `here`: every printer this device prints now, in the
  setup's display order: `{ id, name (setup), appName, transport, nativeId?, status (held, §6.9 B6), problem? }`, and
  `notHere`: the setup names of printers it writes that are not its own. `worst` stays (the dot's rule order is unchanged).
- The status card's subject is the worst of `here` (rank: problem paper-out/cover/error after disconnected; ties by
  display order); 2+ down → the "{n} printers" row.
- **Reconnect** in printers mode reconnects every printer of `here` that is not connected, in display order, one after
  the other: `nativePool().reconnect(nativeId)` for an app printer, `devicePrinter().reconnect()` for this device's own
  one; the first call runs inside the click (user activation, as today). A `cancelled` outcome (the browser's chooser closed) counts as neither
  and says nothing, as today's `toastConnectOutcome` (F-M5). One toast at the end: all connected →
  "{names} connected." (success); any failed → "Could not connect {names}. Check it is on, then tap Reconnect again."
- **A device that prints nothing** (PX-D6): `printers-elsewhere` turns into the new bad reason `printer-waiting` when the
  pulse feed holds a FRESH queued row on a printer this device does not print (≤ 30 min old or tapped, not a slip
  refusal: an untapped stale slip stays in the feed for hours while its printer prints new slips, R1). The words say
  "{printer} is not printing" (with the 2 steps) only when it is stuck: a row on it carries `problem` (the server's word
  from the writer's beat) or its oldest fresh row waited over 60 s (`PRINTER_WAITING_STUCK_MS = 60_000`); a printer that
  is merely busy in a rush says "Slips are waiting for {printer}" with one note and no steps (F-I2). The dot is amber in
  both (PX-D6). The data rides the pulse already read: a new
  narrow context value derived once in `PosPulseProvider` beside the waiting count (`printWaitingPrintersOf(pulse)` →
  a stable string "id:count:problem:stuck|…", "" when none), so the header button still never reads the wide pulse. The
  subject is the printer with the most waiting slips (ties: display order); its name from the printers read already
  cached (no request). A writer whose own printers are fine shows the same amber for another device's printer (R1).
- `here` (R9): a network printer this device only MAY take over counts only while it is taken over (as the dot's
  `counted` today); a Windows printer chosen by name is listed with no state word (the app reports none: native, later);
  no printer of the Windows app (named or network) is ever in Reconnect's subject (F-I3); the desktop dot rule is
  unchanged.

### 6.6 The settings view

PX-2 (behaviour first, look later): the settings view holds today's setup exactly as it renders today below the banner
(`PrinterSetupCard` + `BillPrinterSection`, same components, same words, same pins), so connecting, changing, removing,
paper width, Fast text KOTs, Test print, More options and "Where slips print" all keep working and only MOVE behind
"Printer settings ›". The status card's fixes that pointed at those parts (`setup` → the device section, `print-here` →
the designate button) now switch to the settings view, then focus that part (today's `focusAndShow`).

PX-3 (the new cards, mockups `t-settings-*`, `t-host-*`): each part a card (today's U5 card values: --card, radius 12,
head 12 / 16 with a 34 px tile, 14 px / 600 title, 12.5 px sub; body 0 16 14, gap 10):
1. **This device's printer** (simple mode): the printer row (9 px dot, name, "Bluetooth · 80 mm paper", state word),
   then "Test print" · "Change" · "Remove" (36 px; Remove in --status-bad-ink with the bad border), then "Paper width"
   with today's 58 / 80 mm segmented toggle. None → "No printer on {noun}." + **Connect a printer** (40 px primary).
   The Windows app: "This PC's printer" with today's DesktopPrinterPicker + DesktopPrintMethod inside. Chrome: today's
   BrowserPrinterConnect inside.
2. **Printers on this device** (printers mode writer): one block per printer of `here`: the row, then "Reconnect" (only
   when down) and "Test print"; "Remove" only where today's OtherDevicePrinters allows it (not for a printer the setup
   names for this device: the note "Set by your manager in Printer setup."); then "Connect another printer" (the guided
   connect in add mode). Card sub: "Which slips each one prints: set by your manager." Admins also get "Printer setup ›".
3. **Print for other devices** (simple mode only; PX-D5): sub "Phones and tablets without a printer can send their slips
   here."; not the host and none set → "Print all slips on this device" (36 px outline; tap → the name field "Name for
   this device" (44 px, 16 px text below 720 px) + "Print all slips here" (40 px primary) + "Cancel"); the host →
   "This device prints slips for **all devices**." + "Stop printing here" (today's confirm words, the untrue printers-mode
   sentence removed: §6.9 B10); another device is the host → "Slips print at **{host}**." + "Print here instead" (today's
   move confirm). Printers mode: hidden, except on a former host ("Stop printing here").
4. **Faster KOTs** (today's TextKotSection, when the device has a text-capable printer): title "Faster KOTs", one
   switch row per printer "Print KOTs as plain text" / "English only. Prints in about 1 second." (the row's own words
   for a printer that cannot).
5. **Bill printer for this device** (printers mode, today's BillPrinterSection), restyled as a card.
6. **More** (a list card, 52 px rows): "Change POS address" (Android app), "Battery settings" (the printing device in the
   app), "Remove the printing device" (simple mode, not the host, a host set; red; today's confirm), and for admins
   "Printer setup ›" (/printers). Rows that do not apply are not drawn; an empty card is not drawn.

### 6.7 The guided connect (PX-3; mockups `g1`–`g6`)

A third view in the same sheet. Modes: **replace** (Connect a printer / Change: the device's own printer, today's
`setPrinter` paths) and **add** (printers mode "Connect another printer": joins the app's printers, today's
`nativePool().add`). Back always returns to settings; Cancel too.
1. **What kind of printer?** (Android app) three 72 px choice rows with a 44 px tinted tile: "Bluetooth — Most receipt
   printers", "USB cable — Plugged into this tablet", "Wi-Fi or network — On the cafe's network". Chrome: Bluetooth /
   USB (each opens the browser's own chooser, today's BrowserPrinterConnect calls). The Windows app skips this step (its
   list of the PC's printers is step 2).
2. **Found list:** Bluetooth: paired printers at once, then the scan starts by itself (today's 8 s Find printers) with
   "Looking for more printers…"; one row per physical printer (§6.9 B9); each row "Connect" (the first paired one primary).
   Below: "Not in the list?" 1 "Turn the printer on." 2 "Pair it in Android's Bluetooth settings (PIN is often 0000 or
   1234)." 3 "Then tap **Search again**." + "Search again". A scan refused for permission → "Allow" (§6.9 B11). USB: the
   USB list + "Refresh". Wi-Fi: "Printer address" (44 px, 16 px text) + "Connect", and today's FindNetworkPrinters.
3. **Connecting:** a 48 px spinner, "Connecting to {name}…", "This can take up to 30 seconds. If Android asks to pair, tap
   **Pair**." A failure → back to the list with an inline line "Could not connect to {name}. Check it is on, then try again."
4. **Connected:** a 64 px green check, "{name} is connected", "Paper width" 58 / 80 mm, **Print a test slip** (44 px
   primary), a "Skip" link (back to status).
5. **Did the test slip come out?** "Yes" / "No" (48 px each). Yes → toast "Printing works on {noun}." and back to status.
6. **No → "Let's fix it":** 1 "Paper roll: the shiny side faces the print head." 2 "Switch the printer off and on." 3 "Try
   the other paper width." (with the toggle) + **Print the test slip again** + "Choose another printer ›" (step 1/2).
   On the printing device (host) the yes/no also files today's attestation (`useBeatPrintHost`) exactly as the old Test print.

### 6.8 The header button

Unchanged: 36 px outline square, 17 px printer glyph, the 10 px dot (green ok / --status-warn otherwise / none while
checking) with its 2 px ring, the red count bubble (C/components/print/PrinterStatusButton.tsx:185-217). The new
`printer-waiting` reason draws the warn dot. PX-3 may re-word the five button names ("— open printer setup" → "— open
printer") with their pins.

### 6.9 Behaviour fixes (each approved in PX-D8; each with a test)

- **B1 Clear after this try (PX-D2).** A new `dismissPrintJobByStaff` (C/lib/print-dismiss.ts), called only by the
  single and the bulk staff routes; `dismissPrintJob` (C/lib/print-queue.ts:251) and its eight server call sites
  (print-lease.ts:154,159,165; print-queue-claim.ts:151,156,174,183; print-queue.ts:208: invalid payload, order
  cancelled, the claim path, the orphan dismiss) stay exactly as today (R2). It runs today's CAS; when it
  misses, a second CAS `{_id, status: "leased", claimedAt: {$exists: false}}` → `$set {dismissRequestedAt,
  dismissRequestedBy}` (only the request: the slip may still end `printed`; a second Clear on an already-requested slip
  sets it again and also answers dismissed, F-M3) → answer `{dismissed: true}` (the client type unchanged). The shared lifecycle reads `dismissRequestedAt` (`PrintJobLifecycle.dismissRequested?: true`, in
  `lifecycleOf` and `PRINT_LIFECYCLE_SELECT`); `planAck` and `planExpiry` turn every outcome that would leave `leased` for
  `queued`, `needs-confirm` or `failed` into `dismissed` (`dismissedAt`, `dismissReason: "staff"`, `dismissedBy`,
  `unset: ["lease"]`, log "dismissed: cleared while printing") when the request is set; a printed ack stays `printed`.
  `printJobCasFilter` (C/lib/print-lease.ts:71) adds `dismissRequestedAt: {$exists: Boolean(job.dismissRequested)}`
  (SR-10); every select that feeds `applyPrintJobPlan` reads the two fields (`PRINT_LIFECYCLE_SELECT`, and the offline
  replay's own select, C/lib/print-offline-replay.ts:44, R7). A printed ack that arrives late (same epoch) on a slip the
  request ended as dismissed turns it `printed` (late-ack), so paper on the counter is never recorded as cleared (R8).
  A queued slip that still carries the field (a rollout race with an old server) is dismissable as today; a staff Try
  again / Print again on it unsets the request (the later tap wins, R7); a lease leaves it.
- **B2 Clear all (PX-D4).** New route `POST /api/print-jobs/dismiss` body `{ ids: string[], reason: "staff" }` (1–20 valid ObjectIds, zod
  strict), auth as the single route; `dismissPrintJobs(ids, by)`: one `updateMany` with the single dismiss's filter, one
  `updateMany` setting the request on leased ones (B1's filter), the first once more; answer `{ dismissed: number }`. No realtime publish
  (as the single dismiss).
- **B3 Row buttons only where they work (PX-D3)** — §6.3's table.
- **B4 A printed slip leaves the list at once on the device that printed it.** When this page's agent gets an applied
  "printed" ack answer (C/lib/print-agent-acks.ts), it removes that id from the cached pulse (`printAttention`), with
  `queryClient.setQueryData(POS_PULSE_KEYS.all, …)`; no request. Other devices update on their next pulse (lively 20 s
  while slips wait). The alarm's cache listener sees the slip leave (its notice goes). The page agent's own pulse
  listener (C/hooks/use-print-agent.ts:319-326) ignores this manual cache write (`event.action.manual === true`, as
  `use-print-host-beat` does), so it never kicks a trailing lease after a printed ack (SR-2; F-I1).
- **B5 The alarm toast never covers the open panel.** `C/lib/printer-panel-open.ts` (today: the open event) also keeps the panel's open state
  (`setPrinterPanelOpen`, `printerPanelIsOpen`, a listener); while open, `usePrintSlipAlarm` shows no toast (the step's
  memory marks those slips `shown: false`, so none pops after the close), takes down the ones up at the open, and still
  plays the ping for a slip that newly waits. A slip recorded quietly that leaves the feed for a moment (a refused
  lease) and comes back gets no notice either: nothing pops after the close for a slip staff saw (F-M8).
- **B6 No flicker during the app's own retries.** A pure memory `heldPrinterStatusOf(memory, key, status)`: "connecting"
  right after a settled "disconnected" / "needs-tap" stays that until "connected" (or another settled state); applied to
  this device's printer status and to each pool printer's status before `printerDotOf` / `dotPrintersOf` (the button and
  the panel read the same held value; one module memory per page). A manual Reconnect shows "Reconnecting…" on its button.
- **B7 Toast words for a slip that prints by itself.** The one toast a failed write raises is the print bridge's
  (C/hooks/use-print-host-bridge.ts:100 `settle`, :118 the watchdog). A slip printed for a print JOB (the agent's
  path) now carries `jobId` (an optional field on `HostPrintSlip`, C/lib/print-host-slips.ts:131, set where the agent
  turns a leased job into a slip); for such a slip the toast follows the job, not the lane: not connected (nothing was
  sent, the job waits and never counts) → "The printer is not connected. The slip waits and prints by itself once it is
  back: tap the printer icon to reconnect."; anything that may have reached paper (KOT or bill; the next state depends
  on the attempt: a labelled retry, a bill to check, or could not print) → "The printer stopped answering. Check the
  paper: the printer icon shows what still waits." Slips with no job (a test slip, End of day, a direct reprint) keep
  today's words. The lane constants (`PRINTER_NOT_CONNECTED_MESSAGE` …) stay byte-identical: they are also a job's
  `lastError` and `printWriteOutcomeOf` reads them (C/lib/print-waiting.ts:46-52).
- **B8 A row action on a slip that is gone** → §6.3 (404 → "This slip is no longer waiting.", the row leaves).
- **B9 One row per physical printer** (PX-3): the guided Bluetooth list merges `bt-classic:MAC` and `ble:MAC` with the same
  MAC into one row (the classic, paired entry wins; "Paired" / "Nearby" as its sub).
- **B10 Words that send staff to the wrong place** (PX-3): "Printer setup" pointers in staff text → for staff "Ask your
  manager to change it in Printer setup." and for admins a link; the "Removing the printing device cancels every waiting
  slip." confirm is said only in simple mode (in printers mode printer slips are not cancelled, print-queue.ts:291);
  the web copies of "Open Settings, then Printing" (C/lib/desktop-shell-messages.ts) → "Open the printer icon, then
  Printer settings, and choose the printer."
- **B11 Android's Location ask** (PX-3, web side; PX-D7): a scan refused for permission shows "Android needs Location to
  find Bluetooth printers." + **Allow** (the bridge's `permissions.request`, today's call) and, when still refused, 3 steps
  "Open Android Settings → Apps → Sandbee POS → Permissions." / "Allow Location (or Nearby devices)." / "Come back and tap
  **Search again**." The app's own settings link is native (later).

### 6.10 Screen sizes

| | 390×844 phone | 820×1180 tablet | 1280×800 laptop |
|---|---|---|---|
| Frame | full-screen sheet | full-screen sheet, content column 640 px centered | 420 px side panel over the scrim |
| Status card button | full card width | full card width (≤ 608 px) | full card width (346 px) |
| Not printed rows | 3-button rows wrap | one line | 3-button rows wrap |
| Mockups | `out\*-390.png` | `out\*-820.png` | `out\*-1280.png` |

Every U0–U6 rule holds: WebView 109 safe CSS (no `:has()` on html/body/a page-wide box, no light-dark(), no runtime
color-mix(), no `in oklab`, no mask-image; flex buttons `w-full` / `items-stretch`), WebView 154's bottom inset (the foot
keeps `env(safe-area-inset-bottom)`), never a native `<select>`, 44 px touch, 16 px inputs below 720 px, the HTML tokens.

## 7. Requests and budget (every one counted)

| Action | Requests | Today |
|---|---|---|
| Open the panel, status view | 0 new (the pulse and the printers read are already cached) | same |
| Open the settings view | the reads today's setup card makes on mount (unchanged components) | same (they mounted with the panel) |
| Clear (one row) | 1 POST + the existing 1 pulse refetch | same |
| Clear all | **1 POST** (new route) + 1 pulse refetch, for up to 20 slips | n × 2 |
| Try again / Print now / Print again / It printed | 1 POST + 1 refetch | same |
| Reconnect | 0 server requests (bridge calls only) | same |
| A printed ack on this device | 0 extra (cache edit) | same |
| The amber dot on a device that prints nothing | 0 (the pulse it already reads) | — |
| Clear after this try | 0 extra (the ack / expiry write that already happens) | — |
| The alarm while the panel is open | 0 | — |

Server CPU: the leased branch of a single Clear is one more `findOneAndUpdate` only when the first misses; Clear all
is three `updateMany` on ≤ 20 ids. No new poll, interval, refresh, realtime message or cron. print-budget.test.ts unchanged;
a new test pins "the panel adds no recurring request" (Task 2).

## 8. Old and new together (a deploy)

- **An open old page + the new server:** its Clear on a leased slip now answers `{dismissed: true}` (the request is set)
  → its refetch drops the row and the row never returns (better than today). Its agent's ack of a flagged slip gets
  `applied: true, status: "dismissed"`, `nextAttemptAt: null`: today's agent re-leases only on a non-null
  `nextAttemptAt` (C/lib/print-agent-acks.ts:89-92) and reads `more` as for a printed or failed answer, so the job's
  tries end (read in PX-1; pinned in PX-2 Task 2). Its list keeps today's look and buttons (Print now still
  refused on fresh slips, as today).
- **The new page + an old server** (a rollback): the bulk route 404s → "Could not clear all. Clear them one by one.";
  a single Clear on a leased slip answers `raced` → "This slip is printing right now."; everything else as today.
- **A slip flagged by the new server and acked by an old server instance** (seconds of rollout): it goes back to
  `queued` with the field still set; it shows again and a Clear dismisses it (queued branch); the next exit from leased
  under the new code ends it as dismissed.
- **Old apps 2.0.0–2.0.2, bridge v1/v2:** no native change; the status view reads the same bridge calls (pool status,
  reconnect); a v1 app (no pool) has no `here` list: the card falls back to this device's printer, as today.
- **Old rows** without the new field: unchanged behaviour.

## 9. How it ships

Web only (Vercel deploy by the owner; demo cafe first as in GO-LIVE). No native build, no 2.0.3. No schema migration:
two optional PrintJob fields (`dismissRequestedAt`, `dismissRequestedBy`). PX-2 can ship alone (the client's pain);
PX-3 ships after.

## 10. Not in this phase

Native (PX-D7, later): the Windows app's printer status (green dot on an unplugged printer), its "Open Settings, then
Printing" notifications, a Windows Reconnect / Remove; Android's settings link for a permanently denied permission, the
notification opening the panel, the notification's words. Also: Phase 6 (parallel printing); the picture KOT's last
line (4A note); /orders "Print bill" printing DUPLICATE (U2 note); m7 (two tabs: a labelled REPRINT); the dashboard band
(RequestAlertBar / PrintHostBandSection) look and words; any slip / paper change; the offline (Phase 5) words.

## 11. Measurement and exit

- **Harness** (`D:\kd\pos-dev-keep\printer-ux\tools`, :3175, fake Android app bridge v2 + fake ESC/POS printer :9111):
  Print now / Try again / Clear / Clear-while-leased (FLIP=1 SLOW_MS=25000) / Clear all / Reconnect → no row comes back,
  the paper count exact, no duplicate; printers mode with two fake printers (:9111 Kitchen, :9112 Bill): Kitchen off →
  the card names Kitchen, Reconnect brings Kitchen back, Bill untouched; a second browser as a waiter phone (APP=none)
  → amber "Kitchen printer is not printing"; the alarm toast absent while the panel is open; extra scroll per state at
  390 / 820 / 1280 ≤ the mockups' + 24 px.
- **Suites:** cafe chain, shared, typecheck, lint, live legs that touch printing, S1 pin, print-budget; a11y-check.mjs
  0 violations on both views.
- **Emulator** Pixel_7_API_33, WebView 109 and 154: the status view, the Not printed list, Show all, Clear all confirm,
  the settings view (and PX-3 the guided connect) on the local harness only (never posdemo or a client for a write).
- **Windows app smoke** (PX-2 and PX-3): the status view in the desktop lane ("Printer ready" / "No printer chosen on this
  PC"), the settings view's DesktopPrinterPicker.
- **The owner's real-printer checks** (after the deploy, demo cafe first): Android tablet + two Bluetooth printers in
  printers mode: switch the Kitchen printer off → its name on the card, 3 steps, Reconnect brings it back and the slips
  print by themselves (once each); Clear while the app retries → the row never returns; Clear all; a waiter phone shows
  amber with the printer's name; paper out → "out of paper" + the note; simple mode: one printer off / on.

## 12. Sessions

- **PX-2 (build 1, the client's pain first):** Task 1 the lifecycle's clear request (shared) · Task 2 the server: dismiss
  of a leased slip + Clear all route + budget test · Task 3 the Not printed view model (pure) · Task 4 the Not printed card
  + its actions · Task 5 the status view model + the dot (here / worst / printer-waiting / held statuses) · Task 6 the
  two views (status + settings housing today's setup) + /printers · Task 7 alarm quiet while open + printed-ack removal +
  the job toast words · Task 8 verification + Results. Exact in the plan.
- **PX-3 (build 2):** Task 10 the settings view cards · Task 11 the guided connect · Task 12 the words (B10, button names,
  Faster KOTs) · Task 13 one row per printer + the Location Allow · Task 14 responsive polish + verification + Results.
  Specified in the plan with fixed interfaces.
- Native (2.0.3): a later, separate piece of work (PX-D7).

## 13. Risks

| Risk | Guard |
|---|---|
| The clear request loses a slip that was about to print | A printed ack still wins (planAck); only staff can set it; SR-3 tests on every exit. |
| A race between the request and an ack | The CAS includes the field (SR-10); an interleaving test. |
| Old agent code reads `status: "dismissed"` in an ack answer | Task 1 checks print-agent-acks / print-agent; the answer shape is unchanged. |
| Reconnect in printers mode wakes a printer staff did not mean | It only reconnects printers of this device that are down; never one that is connected; never a lease. |
| The amber dot on every phone in a rush (slips wait 20 s while a printer is busy) | The same 20 s the feed and the count badge already use; it clears with the feed. |
| Moving the setup behind a tap hides something staff need in an emergency | The status card's button and link go straight to the right part; the settings row is always on the status view. |
| Pins fail on purpose | Each changed pin named in the plan (printer-panel-layout, printer-ui-paths, printer-dot-ui-paths, print-host-card-paths, print-waiting, printer-dot); no pin is deleted to pass. |
| Files grow past 300 lines | New pure files per view model; WaitingSlipsCard replaced, not grown; PrinterSetupCard untouched in PX-2. |

## 14. Builder-check rulings (2026-11-05)

A fresh engineer read this spec and the code alone and asked ten questions. None changes what the owner approved;
each is settled here as a ruling (the owner was not asked again).

| # | Question | Ruling |
|---|---|---|
| R1 | Which waiting rows turn a device amber? An untapped stale slip stays in the feed 3 h while its printer prints new ones. | Only FRESH queued rows: ≤ 30 min old or tapped, not a slip refusal. Writers get the amber too for a printer they do not print. |
| R2 | `dismissPrintJob` has eight server call sites (invalid payload, order cancelled, the claim path, the orphan dismiss). | The leased branch lives in a new `dismissPrintJobByStaff`, called only by the two staff routes; `dismissPrintJob` is unchanged. |
| R3 | Try again / Print again on a slip whose printer is gone are refused (`printer-gone`). | Such rows show Clear (and It printed on a bill) with "No printer takes it now. Print it again from its order."; decided by server facts only (`printerId === PRINT_JOB_NO_PRINTER` or `lastError === PRINTER_GONE_MESSAGE`), never by the cached printers list. |
| R4 | B7's KOT words were false on a second try. | B7 now says only what is always true ("Check the paper: the printer icon shows what still waits."). |
| R5 | §6.3 dropped today's "The printer is off or not connected." and the Windows app's own refusal sentence. | Both kept as a row of §6.3. |
| R6 | After Try again / Print now the row's words. | From the next pulse answer, no optimistic rewrite; "Prints again, marked {the row's label}." (REPRINT or DUPLICATE); an unlabelled tapped slip says "Waits for the printer." |
| R7 | The offline replay selects its own fields before its CAS; a leftover request on a queued slip. | The replay's select (C/lib/print-offline-replay.ts:44) reads the two fields; a staff Try again / Print again unsets a leftover request; a lease leaves it. |
| R8 | A late printed ack after a request ended the slip as dismissed. | It turns the slip `printed` (late-ack, same epoch only). |
| R9 | `here`: takeover printers; Windows printers chosen by name. | Takeover printers only while taken over; Windows printers listed with no state word, never reconnected; the desktop dot unchanged. |
| R10 | The dashboard band shares `usePrintJobActions` / `useDismissPrintJob`. | The panel gets its own hook (`useNotPrintedActions`); the band's hooks, toasts and behaviour stay as today. |
| R11 | `printerHeadlineOf` has no reader besides the panel. | Deleted in PX-2 with its tests (their cases move to `printerStatusViewOf`'s); no copy file is needed. |
| R12 | `printer-panel-open.ts` already exists. | B5 extends it. |
| R13 | "This phone" vs "this tablet". | By the screen's shorter side (< 600 px: phone), inside the app only. |
| R14 | Mockup `s-wait5`'s summary contradicted §6.3. | The mockup follows §6.3 ("Tap a button on the ones that need you."), re-rendered. |
| R15 | Clear all's limit. | 20 (the feed's limit), `PRINT_DISMISS_MANY_MAX = PRINT_ATTENTION_LIMIT`. |

## 15. The planning review (Claude Fable 5.1, 2026-11-05): With fixes, 0 C / 6 I / 8 M — all folded in

| # | Finding | Folded in |
|---|---|---|
| F-I1 | B4's cache write would kick the printing device's agent into a trailing lease per printed slip. | B4: the agent's listener ignores manual cache writes; a Task 7 pin. |
| F-I2 | "{printer} is not printing" + "tap Reconnect" on a printer that is only busy in a rush. | §6.4 / §6.5: the amber dot stays (PX-D6); "is not printing" + steps only when stuck (a `problem`, or > 60 s); else "Slips are waiting for {printer}". A word refinement of PX-D6's example, told to the owner. |
| F-I3 | The Windows app's network printer off would get a Reconnect that cannot work. | §6.4 row; no Windows printer in Reconnect's subject. |
| F-I4 | Task 2's budget test read files Task 4/6 create. | The file scan moves to a cafe pin in Task 6. |
| F-I5 | print-lifecycle.ts (546), use-print-agent.ts (337), PosPulseProvider.tsx (298, pinned ≤ 300) would grow. | Plan: helpers in new files, one-line call sites, a stated net growth per file. |
| F-I6 | Three pins not named (print-lease.test.ts:73-76, print-setup-ui-paths.test.ts:148-151, print-waiting.test.ts:239-265). | Named in Tasks 2 and 4. |
| F-M1–M8 | B1's `$set` vs the plan; B2's body; a host-level 404; a second Clear; "seven" callers; `cancelled`; focus after a view switch / an emptied list; the quiet alarm's `left`; mockup `s-pm-phone`. | Each aligned above (B1, B2, §6.3, §6.5, §6.1, B5) and the mockup re-rendered. |
