# Printing Phase 6: parallel printing on one device (design)

- **Date:** 2026-11-03
- **Status:** approved by the owner on 2026-11-03 in the Phase 5 design round ("Approve both"); built after Phase 5
  (the owner: "Offline first"). This spec has no plan yet: the Phase 6 planning session writes it.
- **Scope:** `apps/cafe` only (the page's print agent and print bridge). No app release, no server change, no paper
  change.
- **Builds on:** [2026-10-02-printing-reliability-design.md](2026-10-02-printing-reliability-design.md) §7.6 (one
  writer per printer, head of line), §9.1 ("Different printers can run in parallel", deferred since Phase 2), §9.2;
  [2026-10-15-printing-phase-4-design.md](2026-10-15-printing-phase-4-design.md) §5.2 (the bridge's text step).

## 1. Summary

A device that writes several printers prints them **strictly one slip after another** today: the agent runs one cycle at
a time (print, then wait for the server's ack, then the next slip), and the page has one print surface. A 3-station
round measured on this PC's fake printers (2026-11-03, `main` 96520d6, pictures): Kitchen starts 652 ms after the tap,
Bar 1,222 ms, Desserts 1,797 ms (medians of 5); each slip is about 550 ms of drawing plus a 1–7 ms write plus its ack.
On a phone with Bluetooth printers each slip is a 2–4 s write and a real ack round trip, so the same round takes about
10–25 s, the last station waiting for every earlier one; and one printer that hangs holds every other printer of the
device for up to 70–140 s.

Phase 6 keeps the drawing one at a time (one surface) but lets each printer **write on its own lane**: the next slip
draws while the previous one is being written, and the ack of one printer's slip never holds another printer. A
printer still prints its own slips one at a time and in order.

## 2. The owner's rules

- "Current perfect working hai, so very very very careful": no slip changes, no lifecycle rule changes.
- Smooth, fast and accurate in a rush; ₹0 forever; nothing unused.

### 2.1 Safety rules (each pinned by a test)

| # | Rule |
|---|---|
| S1 | **No paper changes.** Every slip's bytes are today's: the S1 43-file pin stays green, and an end-to-end run prints the same orders on a build of `main` and on the Phase 6 build and compares the bytes per printer, file for file. |
| S2 | **One writer per printer, in order.** A printer line holds at most one slip in flight on this device; its next slip starts only after its previous slip's write and ack (§7.6's head of line and "KOT before bill" on one printer are kept). |
| S3 | **The lifecycle is today's.** Lease, epoch, ack, `more`, REPRINT / DUPLICATE / BACKUP PRINTER, at most two paper attempts, no attempt while a printer is off, the 60 s hold bound of a held job, the hand-back of a dropped job (`sent:"no"`), the (id, epoch) dedupe, the late-ack store: unchanged per line. |
| S4 | **No new request.** The same leases and acks as today, per slip; `print-budget.test.ts` unchanged; measured with the counting proxy. |
| S5 | **Old and new together.** Bridge v1 (the release APK, one printer), a browser printer (one printer), the Windows app's Windows printers (one main-process queue): one at a time as today (they gain only that another printer's ack never holds them). Nothing of the apps changes. |

## 3. Decisions (the owner, 2026-11-03)

| # | Decision |
|---|---|
| P6-1 | Parallel printing is the missing piece of multiple-printer printing (not backup-on-paper-out, a per-printer Windows method or a faster failover: not asked). |
| P6-2 | It is built after Phase 5 (offline KOTs). |

## 4. Design

### 4.1 Two steps per slip: make the bytes, then write them

Today the bridge (`hooks/use-print-host-bridge.ts`) holds its one slot (`occupiedRef` / `pendingRef`, :69-74, :216-224)
from the render until the write has settled. Phase 6 splits a slip into:

1. **Make the bytes** on the one surface (React render, react-to-print's iframe, `rasterPrint`, or the Phase 4 text
   step), one slip at a time, in arrival order. The slot is released as soon as the bytes exist.
2. **Write the bytes** on the printer's lane: the POS app's `printer.print { printerId }` (bridge v2: the app has one io
   thread per printer, `PrinterThreads.kt`, and the page's `nativePool` a write queue per printer,
   `native-pool.ts:192-210`), or the Windows app's `printRaw` for a network printer (one chain per printer,
   `raw-tcp.ts:326-351`). The write's outcome settles the slip exactly as today (printed / `sent:"no"` / `"maybe"`).

A lane that cannot take bytes from the page keeps today's single step: a Windows printer (`printHtmlOn`, which renders
inside the Windows app and runs on its one queue, `print.ts:58-62`), the browser's window.print fallback. Such a slip
holds the surface until its write settles, as today.

### 4.2 One cycle per printer line

The agent (`lib/print-agent.ts`) runs one cycle per printer line instead of one for the device: lease or held job →
print → ack, per line. Lines share only the drawing queue of §4.1. A line's ack (and its `more`) leads only that line's
next lease; a kick or a timer still leases once after running cycles. The simple-mode device line is one line.
Direct-print jobs leased at creation (one per printer line, §7.11) enter their lines at once: a 3-station round starts
drawing the second slip while the first is being written.

### 4.3 Copies

All copies of a job are written in one lease today, each drawn again (`print-agent-printers.ts:346-358`). When a slip's
bytes do not depend on the copy (no slip prints a copy number), the bytes made once are written N times. A test draws
every fixture slip twice and compares the bytes; a design whose two draws differ (a time printed to the second) keeps a
draw per copy.

### 4.4 A stuck printer

A write that hangs holds only its own line, up to today's deadlines (the 70 s device write deadline, the 65 s native
timeout, the 90 s watchdog). Other lines keep drawing and writing. The 60 s bound of a held job (`PRINT_DIRECT_HOLD_MS`)
applies per line.

### 4.5 What does not change

The server, the routing, the slips, the labels, the text KOT decision (Phase 4), the apps, the attestation and Test
print slips (one at a time on the surface), the waiting-slips panel and the alarm.

## 5. Measurement and exit

1. **Paper:** S1 above (old vs new build, bytes per printer, both modes, bridge v1 and v2).
2. **Speed (fake printers):** one device, three station printers and a bill printer, 5 rounds: today's medians
   652 / 1,222 / 1,797 ms; with `--delay 2000` on each fake printer (a slow Bluetooth-like write) the last cut goes
   from about 3 × (draw + 2 s) to about 3 draws + 2 s. The emulator (WebView 109 and 154) the same with two printers.
3. **Requests:** the counting proxy: the same leases and acks per round as `main`.
4. **A stuck printer:** one fake printer with `--delay 60000`: the other printers' slips print at their normal times.
5. **The owner's real-printer check:** two Bluetooth printers on one phone (vendor dependent, spec §15), a network
   kitchen printer, a 3-station round with a bill.

## 6. Free-tier budget

No new request, no new write, no new realtime message. Faster acks change nothing in the counts.

## 7. Sessions (for the Phase 6 plan)

| Session | Delivers |
|---|---|
| 6A | Test first: the bridge's two steps (§4.1) and the agent's cycle per line (§4.2) behind today's interfaces; copies (§4.3); every S-rule's unit test. |
| 6B | The exit: fake printers and the emulator (S1 bytes, the speed and stuck-printer runs, the counting proxy), docs, the fresh review. |

## 8. Risks

| Risk | Mitigation |
|---|---|
| Two writes to one printer at once | S2: one slip in flight per line; the app's BUSY per printer still refuses a second (before any byte) |
| A page unmount while several lines write | Each line hands back or keeps its ack exactly as one line does today (S3); tests per line |
| Bluetooth Classic with several links on one phone | Vendor dependent as today (spec §15); parallel writes may be slower than expected on some phones: measured on the owner's phone before release |
| A bug in the new cycle | The fake-printer soak (`scripts/print-soak.ts`) in printers mode with several printers per device, every job checked on paper |
