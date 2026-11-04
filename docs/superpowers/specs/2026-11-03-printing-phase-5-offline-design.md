# Printing Phase 5: offline KOTs and the calm pulse (design)

- **Date:** 2026-11-03
- **Status:** approved by the owner on 2026-11-03 (one round of questions: every Recommended option, "Approve both");
  this document for the owner's review
- **Scope:** `apps/cafe` (the POS page: offline state, the outbox, the offline KOT, the replay, the calm pulse; the
  order routes: an optional `offline` field), `packages/shared` (the field's schema, the pulse's cadence constants). No
  app release (the apps print the offline slip as they print any slip), no Worker change, no data migration.
- **Builds on:** [2026-10-02-printing-reliability-design.md](2026-10-02-printing-reliability-design.md) §2 (non-goals:
  "Offline billing … The design must not block adding it later"), D4, §7 (the lifecycle), §7.11 (direct print), §8
  (routing), §14's "Later" row, §17 (budget); [2026-10-15-printing-phase-4-design.md](2026-10-15-printing-phase-4-design.md)
  §2.1 (S1–S6), §5.2 (the bridge's text step); [2026-11-02-perf-smooth-design.md](2026-11-02-perf-smooth-design.md) §9
  (the pulse left for this phase). Phase 6 (parallel printing) has its own spec:
  [2026-11-03-printing-phase-6-parallel-design.md](2026-11-03-printing-phase-6-parallel-design.md).

## 1. Summary

When a cafe's internet goes (or its server is down or over its free allowance), nothing prints today: every slip is
made by the server first, so the kitchen gets no KOT, the POS shows "Couldn't confirm", the round lives only in the
page's memory, and even after the internet is back nothing happens until staff tap Send again. Phase 5 adds two things:

1. **Offline KOTs.** While a device cannot reach the server, Send to Kitchen (and Pay Now) does not send: the round is
   kept on the device (its outbox, which survives a reload) and its KOT prints at once on the printers this device
   prints, marked **OFFLINE** with this device's offline number (**O-3**). When the server answers again, the outbox
   sends itself, oldest first, under the same keys (never twice); the server saves the lines printed offline as
   printed (no second paper), prints the rest, and gives the real numbers. Money, stock, numbers and open tabs are
   decided by the server at that moment, as for any order.
2. **The calm pulse.** The 20 s pulse (`/api/order-requests/pulse`, every device, ≈ 0.52 M of an 8-device cafe's
   ≈ 1.23 M invocations a month against Hobby's 1 M) slows to 60 s on a device while nothing is waiting and realtime is
   proven, and returns to 20 s the moment anything needs it.

## 2. The owner's rules

- "Current perfect working hai, so very very very careful": printing works in the field; nothing that works today may
  change unasked. Online, every slip prints exactly as today.
- Smooth, fast and accurate in a rush; accuracy is never traded for speed on money, stock, KOT, numbers or open tabs.
- "Extra koi bhi data db me pada nahi rehna chahiye"; nothing unused.
- ₹0 forever on each cafe's own free accounts: no paid service, no new recurring request, no Vercel Cron; every budget
  ceiling stays.
- "Thoda fast forward karna hai, but proper smooth and fast working software, without any issue": few rounds with the
  owner, never a skipped check.

### 2.1 Safety rules (each one is pinned by a test)

| # | Rule |
|---|---|
| S1 | **A deploy changes no online paper.** With the device online, every slip's bytes are today's: the S1 43-file pin (`PIN (S1)` in `lib/printer/kot-text/text-kot-print.test.ts`) stays green, and the end-to-end run prints the same orders on a `main` build and on the Phase 5 build and compares the bytes file for file (simple mode and printers mode, bridge v1 and v2). The offline slip is the only new paper: today's KOT with the label `OFFLINE` (the existing banner) and its number shown as `O-<n>`. |
| S2 | **No slip lost.** A round taken offline is in the device's outbox before its KOT prints and before the cart clears; it leaves the outbox only when the server has answered it (saved, or refused and then discarded by staff on purpose). A page reload, an app restart or a closed tab keeps it (device storage). |
| S3 | **No unlabelled duplicate.** A line printed offline is saved by the server as printed and never printed again; a line whose offline write may have put paper out is saved as a REPRINT retry; a send that may already have reached the server never prints offline unless staff tap "Print KOT here", and that paper says OFFLINE. Every path that prints without the server has its own test. |
| S4 | **Numbers, money, stock and open tabs exact after any outage.** The server assigns the order, KOT and bill numbers, computes every total and checks stock when the round arrives, exactly as for an online send under the same key (a replay can never create a second order or round). A difference from what the device showed is shown to staff. |
| S5 | **Every mix prints.** Old pages with the new server, the new page with every app (the release APK, 2.0.0–2.0.2 on bridge v1 and v2, the Windows app 1.12+), and a browser tab: online exactly as today; offline as §6 says. No app change. |
| S6 | **No budget loosens.** `print-budget.test.ts` unchanged; no new recurring request; the calm pulse is pinned by its own test and measured locally (§11). |
| S7 | **Nothing lies in the database.** The outbox is on the device and empty once its entries are answered; the server stores nothing new beyond the order and its jobs (retention as today). |

## 3. Owner decisions (2026-11-03)

| # | Question | Decision |
|---|---|---|
| P5-1 | Field status | No printing or app-update problem since 2026-10-16. The 2.0.2 upload, the demo cafe's Bluetooth measurement and text KOTs at a client are not done yet (the owner's open Phase 4 steps). |
| P5-2 | What must keep working without the server | **KOTs now, the rest later:** Send to Kitchen prints the KOT at once on the printers this device can reach, marked OFFLINE; the round is kept on the device and sent by itself when the server is back. Pay Now: the KOT now; the sale is saved and its bill prints when back. Settle, void, move wait. (Not taken: an offline bill with no number; auto-send only; full offline billing.) |
| P5-3 | What is missing in multiple-printer printing | **Parallel printing** (Phase 6 spec). Not asked: backup on paper out, a print method per Windows printer, faster failover. |
| P5-4 | Which comes first | **Offline first** (Phase 5); parallel printing is Phase 6, its design approved in the same round. |
| P5-5 | The offline paper | **OFFLINE + O-3:** today's KOT design with the white-on-black banner OFFLINE and, where the KOT number goes, this device's offline count `O-3`. The real numbers come when the server is back and are never printed again. An order made offline prints no token slip (staff call it by O-3); P5-12: only when its KOT printed, or may have printed, offline. |
| P5-6 | The pulse | **Calm when quiet:** 20 s while anything waits, a QR request is open, this device made a slip in the last 2 minutes, the device is offline, or realtime is not proven; 60 s otherwise. |
| P5-7 | Which devices print offline | **Devices that print:** web only, no app update. A device prints offline on its own printer and on the network printers its app already lists (every printing device's app since Phase 3) or the Windows app's network printers. A waiter phone with no printer keeps its rounds; they print when the server is back. Bluetooth/USB printers attached to another device print when back. (Not taken: a one-time network print in app 2.0.3; a Wi-Fi relay between apps, a later phase.) |
| P5-8 | The design | **Approved** (Phase 5 and Phase 6). |
| P5-9 | (the builder check) Which time an order or round taken offline keeps | **The taken time:** the time it was taken on the device, accepted only when it lies within the last 12 hours and not in the future (5 minutes of clock difference allowed); otherwise the server's time and a note. End of day, the cafe day, the bill and GST invoice dates and the Kitchen screen's age stay right. |
| P5-10 | (the builder check) Two devices printing offline on one day can both print O-3 | **Keep O-3 per device:** offline KOTs usually come from one counter; the KOT's table, time and staff lines tell two O-3 apart. No new data. |
| P5-11 | (2026-11-04, after the 5C review) A calm screen finds a real outage at its second missed pulse (up to about 3 min) | **Find it sooner** ("the server smooth and the process fast"): one missed pulse keeps the pulse at 20 s until one reaches the server (no request while the server answers); up to about 2½ min on a screen left alone. |
| P5-12 | (2026-11-04) A send cut half-way that never landed, or a waiter phone's order, printed no OFFLINE paper but drew no token | **The standard rule:** the server draws no token only for an order whose KOT printed, or may have printed, offline (the customer holds O-n paper, P5-5); an order kept offline that printed nothing is saved with its token as an online order. |
| P5-13 | (2026-11-04) The toast for a KOT line whose paper may be out said "did not print" | **Say it accurately:** "may not have printed on X. It prints there, marked REPRINT, when the internet is back." |

## 4. Current state (`main` 96520d6, read 2026-11-03; paths under `apps/cafe/` unless marked [shared] = `packages/shared/src/`)

### 4.1 An ordering device without the server

- **Send to Kitchen** is `sendToKitchen` (`hooks/use-pos-tab.ts:295-320`): `POST /api/orders` (a new order) or
  `POST /api/orders/:id/items` (a round), each with a body `idemKey` minted by `mintAttemptId` (`lib/pos-device-id.ts:99`)
  inside `createPosSend(...).run` (`lib/pos-send.ts:150`, the key at :171) and held only in memory (`Held`, :142-148).
  **Pay Now** is `confirmPayment` (:358-396): `POST /api/orders` with `status: "Completed"`.
- Every request aborts after 15 s ([shared] `api-client.ts:9`); writes never retry by themselves
  (`components/providers.tsx:35-40`, `lib/pos-send.ts:15-18`).
- A failure with no answer, a timeout, a 5xx, 408 or 429 is "uncertain" (`classifyFailure`, `lib/pending-writes.ts:40-47`):
  the cart freezes under **"Couldn't confirm"** — "The kitchen may not have this order yet. Tap Send again — it can never
  go through twice." (`lib/pos-send.ts:82-83`) — with **Send again** and **Discard**. A 402 or any other 4xx is "definite".
- **Nothing prints before the server answers:** every print call runs in the send's `confirm` (use-pos-tab.ts:313-318,
  :381-393). Measured on fake printers (2026-11-03, `setOffline` and a "server down" variant): no paper offline, and
  after the internet returned the page did nothing for 120 s until staff tapped Send again (then one KOT per station,
  unlabelled, numbers 1–10 unique).
- **Nothing is stored on the device:** no cart, round or order in localStorage or IndexedDB; a reload forgets a frozen
  send (`lib/page-refresh.ts:49-52`). There is no service worker and no offline shell (`public/` has svg files and icons
  only); a reload or a lazy chunk while offline cannot load the page (`lib/chunk-reload.ts:52-63`,
  `app/(dashboard)/error.tsx:28`, `app/global-error.tsx:23`).
- **Settle** (`POST /api/orders/:id/settle`, guarded by `expectedTotal`) offers "Check" after a failure
  (`lib/settle-flow.ts:186-211`); **void** shows "Could not reach the server…" and its dialog closes, losing the void
  (`hooks/use-item-void.ts:48-53`); **Move table** and **QR accept** show the network toast.
- **Duplicates are prevented by the key:** a create with a used key is answered before any number is drawn
  (`app/api/orders/route.ts:74-99`, the unique `idemKey` index `models/Order.ts:378-386`); a round by `kotIdemKeys`
  (items route :107-109). A replay answer carries no `printJobs` and makes no job (`lib/order-idem.ts:170-198`); the
  page then enqueues the slips under the same job keys (`hooks/use-host-routing.ts:218-251`). Numbers come from
  `Counter` (`models/Counter.ts:71-125`): a lost write burns a number, never repeats one.
- **The header printer button follows the internet, not the printer:** offline it says "Printer not connected — open
  printer setup" in red (`lib/printer/printer-dot.ts:140-167`), though the printers were reachable.
- **The screen lock** auto-locks after idle (`components/lock/ScreenLock.tsx:169-175`), and unlocking needs the server
  ("No internet. Sign-in can't be checked right now.").

### 4.2 Printing devices, the server down, a page that dies

- A printing device that loses the server prints nothing, even its own slips: the agent prints only what it leased
  (`lib/print-agent.ts:20`). The apps keep no queue of their own (`PrinterManager.kt:141-157`; the Windows app's
  one-job chain `print.ts:57-62`).
- A kept ack is retried every 5 s for at most 10 minutes ([shared] `print-lifecycle.ts:43-44`) and an ack refused with
  402 (Vercel over its allowance) counts as answered (`lib/print-ack-store.ts:40-45`); either way the lease expires and
  the slip prints again later, labelled REPRINT.
- Phase 3's failover and backup printer move slips only between devices the server can reach (§9.3–9.4 of the
  reliability spec); in a cafe-wide outage nobody reaches it.

### 4.3 The pulse

- `GET /api/order-requests/pulse` every 20 s on every staff page of every device, in the background too
  (`hooks/use-pos-pulse.ts:28-36`, [shared] `query.ts:60`; Android printing devices tick it through the print service,
  `use-native-host.ts:43-47`). Server: 7 DB reads, p50 7 ms, 1 KB (P1 report §5), then the throttled sweep in `after()`.
- It feeds the QR request count and ring, the self-order auto-print, the host lane and dot, the host heartbeat (one
  beat per pulse on the print host), the agent's jobs-for-me kick, the waiting-slips panel, the 20 s slip alarm (fires
  at the first pulse after the 20 s mark), the readback, the sweep and the warm-routes line proof
  (`WARM_LINE_PROOF_MS = 2 × POS_PULSE`, `lib/warm-routes.ts:43`). Realtime covers only a new QR request
  (`PULSE_EVENT_KINDS = ["self-order"]`); no final print state is published.
- Cost: 3 requests a minute per device, 55–60 % of a quiet page's requests (P1 report §10); ≈ 0.52 M invocations a
  month for 8 devices open 12 h (of ≈ 1.23 M; Hobby allows 1 M). `print-budget.test.ts` does not count it.

## 5. Design

### 5.1 When a device is offline

A small state per page (`lib/offline-state.ts`, pure, with a hook) says **online** or **offline**:

- **An answer reached us:** an HTTP answer carrying the app's JSON envelope with a status below 500 (a 4xx included).
- **No answer:** a network error, the 15 s timeout, a 5xx, or an answer that is not the app's envelope (a host's error
  or "paused" page, e.g. Vercel's 402).
- **Offline starts** when the browser says offline; or two pulses in a row got no answer; or an order write got no
  answer and one immediate pulse refetch got none either.
- **Offline ends** at the first pulse that reached us. While offline the pulse runs at 20 s (TanStack pauses it while
  the browser says offline and refetches when it is back).

Only a send made while the state is already **offline** prints offline (§5.4): such a send is never attempted, so the
server certainly does not have it.

### 5.2 The outbox

- One record in the device's storage, `pos.offline-outbox.v1` (localStorage), with a strict schema; every write under
  the Web Lock `pos-offline-outbox` (two tabs never overwrite each other). A record that cannot be read is kept under a
  dated key, never overwritten, and the page says "Some offline orders could not be read: check Open tabs".
- An **entry** is one round: its key (the `idemKey`), its offline number (`O-<n>`), when, the request body exactly as
  the online send would post it (create or round), the order it belongs to (a server order id, or the local id of an
  order made offline), the table, whether it is a sale (Pay Now), the total the device showed, every routed line
  with its outcome (§5.3), and its state: waiting, sending, or needs staff (with the server's words).
- **The offline number** counts per device per cafe day (`cafeDateString()`), kept in the same record: O-1, O-2, …
- **At most 300 entries** (about 300 KB). Past that, Send to Kitchen offline says "Too many orders are waiting on this
  device. Connect to the internet to send them." and nothing is lost.
- An entry leaves the outbox only when the server answered it (saved) or staff discarded it on purpose (S2, S7).

### 5.3 Which printers print offline

The device prints offline only what it would print itself (P5-7):

- **Printers mode:** the round's KOT is routed on the device with the server's own pure routing
  (`routePrintRequest(kotPrintJob(order, round), routing)`, `lib/print-printer-routing.ts:164`) over the device's last
  printers read (`usePrintersRead`), the stations (my ruling: the new page reads `GET /api/printers?stations=1`, which
  answers `{ printers, stations }`; without the parameter the route answers today's list, so an older page is
  unchanged and no request is added), and the products and categories it holds (their `stationId`, and the
  categories' kitchen order). A line prints here when its printer is one this device can print now (my ruling, the
  planning review's I11, as P5-7 says): the printers it writes (`readyPrinterIds()`, `lib/print-agent-seams.ts:115`),
  plus every network printer of the setup that its POS app (bridge v2) lists and reports connected now, plus, on the
  Windows app 1.12+, every network printer of the setup (it connects per job; a write that reaches nothing says "no" and
  the line waits). Every other line waits for the server. Bills and tokens never print offline.
- **Simple mode:** the KOT prints here only when this device prints its own slips (no print host in the last pulse, or
  this device is the host) and its printer can print now (`canPrintNow()`, `lib/printer/print-lane.ts:52-57`).
- **Copies:** as many as the line's KOT copies, each a write.
- Every routed line is kept in the entry with its outcome: **printed**; **maybe** (paper may be out); or **later**
  (not printed here: another device's printer, a printer that cannot print now, or a write that sent nothing). The
  server reads all of them (§5.9), so it can tell a setup that changed in between from two printers that take one
  station by design.

### 5.4 The offline KOT

- **Made on the device from the cart** (`offlineKotOrder`, `lib/offline-kot-order.ts`, mapping the request body to an
  order as `optimisticOrder` does in `hooks/use-orders.ts:196-207`): an order-shaped object with `_id`
  `offline-<key>`, `orderId` = the offline number (a round on a tab the server already has keeps the tab's own
  `orderId`), the cart's lines stamped with the kitchen flags the server
  would stamp (`stampKitchenFlags`, `lib/kitchen-lines.ts:140`: skip-KOT and the kitchen order), the round (1 for a new
  order; for a round, the tab's `kotRounds` plus the earlier offline rounds of that tab, plus one), the table, the
  customer, the staff member and now. No `kotNumbers` and no token.
- **The paper (P5-5):** today's KOT, through today's renderers, with the banner **`OFFLINE · O-3`** (white on black,
  like REPRINT) and the Order row reading `O-3` for an order made offline, or the tab's own order number for a round on
  a tab the server already has (my ruling, the builder check's 6: the kitchen already holds that tab's first KOT under
  its number); the number box, which needs a server number, is left out (every
  renderer already leaves it out when there is no number: `KOTReceipt.tsx:206`, `kot-classic-blocks.tsx:121`,
  `kot-bold-blocks.tsx:80`). *My ruling:* O-3 goes into the banner and the Order row rather than into the number box,
  so no slip file changes and the online paper's 43-file pin stays exactly as it is. A text KOT (Phase 4) prints
  `OFFLINE - O-3` the same way.
- **Printed through the page's one bridge** (`queueSlip`, `hooks/use-print-host-bridge.ts:216-224`, exposed by
  `PrintHostProvider` as `queueOfflineSlip`), for each line: `hostPrintSlipOf(line.payload, cafeDateString())` with the
  banner, the line's printer and its target (`AgentPrinters.targets`), behind any slip already printing. No lease, no
  ack, no server request.

### 5.5 Send to Kitchen while offline

1. The page decides at `createPosSend.run` (`lib/pos-send.ts:171`), after the key exists: with the state offline it
   calls the offline port instead of `request(key)`.
2. The entry is written to the outbox (S2) **before** any paper and before the cart clears.
3. The KOT prints on the lines of §5.3; the outcomes go into the entry.
4. The cart clears. A toast: "Offline: KOT O-3 printed here. It is sent when the internet is back." When a line cannot
   print here: "… Bar prints when the internet is back." When none can (a waiter phone): "Offline: order O-3 is kept on
   this device. It prints when the internet is back."
5. **The order stays usable:** Open tabs on the POS lists an offline order with an "Offline · O-3" chip, its table
   reads taken on the POS's table choice, and staff can add rounds to it (each round its own entry, chained to the
   order). A round on a tab the server already has works the same way. Settle, void, move and cancel wait (§5.9).

### 5.6 Pay Now while offline

The sale (the Pay Now body: status Completed, the payment) becomes one entry marked as a sale; only its KOT prints
offline. The payment sheet closes with "Offline: KOT O-4 printed. The sale is saved and its bill prints when the
internet is back." When it is sent, the server saves the sale, numbers it and prints its bill on the bill printer as
for any Pay Now; no token slip is made (P5-5).

*My rulings (the builder check's 1 and 3):* offline, a sale takes **Cash, Online or Split** only; a promo code, a
reward, points, a scratch card, Due or Credit and attaching a customer need the server's checks, so the POS shows them
as "Needs the internet" while offline. The total the device took travels with the sale (`offline.total`, §5.9); the
server refuses the sale when its own total differs, so a paid amount is never recorded that the drawer does not hold
(§5.8's Fix and send then lets staff save it at the server's total).

### 5.7 A send that failed half-way

A send that started online and got no answer may already be on the server. It keeps today's "Couldn't confirm" notice.
Once the device is offline (§5.1), that send moves into the outbox as an entry marked **uncertain** (my ruling): the
notice says "Saved on this device. It is sent by itself when the internet is back — it can never go through twice.",
and the cart is free again. Its KOT does not print offline by itself; the Offline orders list offers **Print KOT here**
for it, with "If this order reached the server before the internet went, the kitchen may get it twice. This copy says
OFFLINE." (S3).

### 5.8 Back online: the replay

- **When:** the state is online and the last pulse answer says the server knows offline replays (`offlineReplay: true`,
  a constant in the pulse answer; my ruling, because an older server would drop the new field silently and print every
  line again: `orderObject` is not `.strict()`, [shared] `schemas/order.schema.ts:69-123`). One tab sends (the Web Lock).
- **How:** oldest first, one at a time, each entry's own body and key, the `offline` field (§5.9) and the print headers
  an online send carries (so this device's own lines are made leased to it and print at once, as today). A round of an
  order made offline waits for that order's create, then takes its server id.
- **Saved:** the entry leaves; the page follows the answer's print jobs as an online send does
  (`followPrintJob`, `hooks/use-host-routing.ts:170-183`) and **never enqueues** a slip for an entry
  (`POST /api/print-jobs`); a replay answer (the key was used) prints nothing on the device. When the server's total
  differs from the one the device showed, Offline orders keeps a note ("O-4 saved at ₹260; this device showed ₹240")
  until staff dismiss it (my ruling: the server's total stands, as for any online sale; staff see the difference).
- **No answer again:** the run stops and the state goes back to §5.1; the entry is sent again later under its key.
- **Refused** (a 4xx with the app's envelope: a closed tab, an item no longer sold or out of stock, a changed price,
  a sale whose total changed): the entry waits as "needs staff" with the server's words; the run goes on with the
  entries not chained to it. Staff: **Fix and send** (my ruling, the builder check's 1): the entry opens in the cart
  (its lines, its table, its payment), staff change what the server refused, and it is sent under a **new key** with the
  entry's offline lines, so the lines already printed stay printed and no second KOT prints (a sale whose total changed
  opens the payment sheet at the server's total); **Send again** (the same key, for a refusal that may have cleared);
  or **Discard** ("Its KOT is already in the kitchen. Nothing is saved for it."). A discarded sale also says "The money
  taken for it is not recorded." An **uncertain** entry (§5.7) not yet answered may already be on the server: its
  Discard uses today's words ("The order may already have reached the kitchen. Check Open tabs before sending it
  again.") and it has no Fix and send until the server has refused it definitely (the review's I7; a definite refusal
  of its key means it never landed).
- **A replay answer that lacks the `offline` echo** (§5.9) stops the run: "This POS's server did not take the offline
  note. Nothing more is sent until it is updated." (the review's m4).
- **A sale's replay** carries the bill-print header of an online Pay Now (`printAgentRequestOptions(true)`), so its
  bill is made (the review's m8).
- **Who it is saved for** (my ruling, the builder check's 4): the order's staff is the person signed in on the device
  when it is sent (the server trusts only the session); the KOT printed offline already names who took it. The runbook
  says so.
- **The end:** "Offline orders sent: 5"; the lists refetch. The header chip "Offline orders · n" opens the list while
  any entry or note remains.

### 5.9 The server: the `offline` field

- **Schema** ([shared] `offline-kot.ts`, used by `schemas/order.schema.ts`): optional `offline` on `orderObject` and
  `addItemsSchema`: `{ ref: "O-<1–9999>", takenAt: <ms>, total?: <₹, a sale only>, lines: [{ printerId: string |
  null, part: string, outcome: "printed" | "maybe" | "later" }] }` (at most 24 lines; `printerId: null` with
  `part: "-"` is the simple-mode device line). It needs the request's device id header; without one the request is
  refused (400).
- **The taken time (P5-9):** `takenAt` is kept when it lies within the last 12 hours, at most 5 minutes ahead of the
  server's clock, **and on the same cafe day and the same slip day (the numbers' reset time) as the request's arrival**
  (my ruling, the planning review's C1: every number is drawn when the request arrives, by today's atomic counters, and
  a time from the day before would carry the next day's numbers and land on a closed End of day). Kept: a new order's
  `createdAt` is `takenAt` (round 1's fire time everywhere: the create route writes no `kotFiredAt`), and a round's
  `kotFiredAt[round − 1]` (which the Kitchen screen ages a round by) is `takenAt`. Not kept: the server's time, and the
  answer says so (§ below). An outage that runs past closing therefore books its orders on the day they reach the
  server, with a note on the device; the runbook says End of day waits until every device's Offline orders list is
  empty (§7).
- **The answer of a request with the field** carries `offline: { ref, takenAtKept }` (the review's m4): a replay
  answer without it came from a server that dropped the field, and the device stops its run (§5.8).
- **Its jobs are always made, never repaired** (the review's I1): an offline round is not entered in the repair marker
  (`Order.kotPrintDevices`, `orders/route.ts:410`, items route :279), so the sweep never re-creates its KOT unlabelled;
  with the field, a job creation that throws is not swallowed (`createOrderPrintJobs` swallows it for every other
  request) and the answer is 503 so the device sends it again, while a round that wants no job (skip-KOT, nothing
  routes) answers 200 (the re-check's N1); and a replay with the field (§ below) first makes any of the round's missing
  jobs with their verdicts, and a sale's bill (the job keys collide on the rows that exist; the re-check's N3), then
  moves untried ones to printed. The device waits a pulse tick after a 503 or a miss before it sends again (N2).
- **The sale's total:** a sale with `offline.total` is refused (409, "The total is now ₹260; this device took ₹240.")
  when the server's total differs; an online sale and an offline round are never checked this way.
- **Job creation** (`lib/print-order-jobs.ts:170-238`, `lib/print-printer-jobs.ts:56-102`, `lib/print-job-insert.ts:33-105`):
  for the round's KOT lines only, each line the server routes gets a verdict (`offlineVerdictOf`):
  - the field names the same line (printers mode: the same `printerId` and `part`; simple mode: the device line, and
    its job's target is the asking device) as **printed** → inserted **printed**: `printedAt` now, `printedBy` the
    device, the lifecycle's init fields, the log `created` + `printed` with the detail `offline O-3`; never leased,
    never announced;
  - the field names it as **maybe**; or the field does not name it while another of its lines with the same station
    (`part` a station id) was printed or maybe, or while a full copy (`part` `"all"`) was printed or maybe (it covered
    every station: the planning review's C2) — the setup changed in between; or simple mode's device line was printed
    on the asking device while the server's job now targets another device → inserted **queued with REPRINT** and one
    uncertain attempt, never leased at creation (S3);
  - the field names it as **later**, or names nothing that covers it → as today (queued, or leased to the asking tab);
    the verdict is decided before the direct-print choice, and a printed or REPRINT job never takes a printer line's
    one direct lease (the review's I8);
  - the bill of a sale, as today.
- **No token** for an order made offline: the create leaves the token out of its opening slips (`orders/route.ts:611`)
  and draws no token number (`allocateOpeningSlips`, :495). (P5-12, after 5C: only when a line printed, or may have
  printed, offline: `offlinePaperOut`; an order kept offline that printed nothing draws its token as usual.)
- **A replay with the field** (the key already used; the first send landed but its answer was lost): each KOT job of
  that round that is still `queued` with no attempt, on a line the field names as printed, is moved to printed (one
  CAS per job on `{ status: "queued", attempts: 0, epoch }`, log `printed` "offline O-3"); a job printed, leased or
  retried stays as it is.
- **The pulse answer** gains `offlineReplay: true`.
- The repair sweep (`lib/print-repair.ts:43-60`) finds the printed rows and re-creates nothing; retention as today.

### 5.10 What waits while offline, and the page's guards

- Settle, void, move table, cancel, QR accept and reject, reprints, Print bill, End of day and setup saves: a tap says
  "Offline: this needs the internet. Try again once it is back." and sends nothing (my ruling; a void dialog no longer
  closes and loses the void).
- **No reload while offline:** the error boundaries' automatic reload (`error.tsx:28`, `global-error.tsx:23`) waits
  for the connection (their own button stays); Refresh already refuses offline.
- **The idle screen lock waits** while offline (`ScreenLock.tsx:172`; my ruling: unlocking needs the server); a lock
  staff choose still works.
- **The header printer button** (`lib/printer/printer-dot.ts:140`): offline with a printer this device can print now →
  amber, "Offline — KOTs print here" ("This device is offline. KOTs print here and are sent when the internet is
  back."); offline with none → "Offline — orders are kept on this device". The chip "Offline orders · n" beside it.
- **The slip code is loaded at start** on a printing device, so an offline KOT draws in the cafe's design (Phase 4
  §5.2: with the lazy design code missing the picture prints the legacy ticket).
- **A kept ack waits while offline** (my ruling): its 10-minute window counts only time online (at most 3 h, the waiting
  slips' retention), and a 402 keeps it; so a slip printed just before an outage is not printed again as REPRINT when
  the server is back (the agent already sends kept acks before it leases again, `lib/print-agent.ts:126-128`). While
  the state is offline the ack store's 5 s retry timer (`lib/print-agent-acks.ts:54-60`) is suspended and the kept acks
  are sent at the first answer that reaches us (the review's I6: no request every 5 s during a long outage).
- **End of day** on a device whose outbox holds entries shows "n offline orders are still on this device: send them
  before End of day." (the review's I10); the runbook says End of day waits until every device's list is empty.

### 5.11 The calm pulse (P5-6)

- `POS_PULSE` stays 20 s; a new `POS_PULSE_CALM` is 60 s ([shared] `query.ts`).
- `pulseIntervalMs(input)` (pure, `lib/pos-pulse-cadence.ts`) answers 20 s when any of: realtime is not proven
  (`realtimeTrusted()`, `lib/live-poll.ts:136-138`); the device is offline; a pulse got no answer and none has reached
  the server since (P5-11, after 5C); the outbox holds an entry; the last answer
  shows a waiting slip (`printAttention`), a job for this device (`printJobsForMe`) or an open QR request
  (`openCount`); this device made a slip-making write (send, Pay Now, settle, void, move, reprint, a replay) in the last
  2 minutes. Otherwise 60 s.
- `usePosPulse` uses it as its `refetchInterval` function; a local change (an own write, a realtime drop, an outbox
  change) re-renders the provider so TanStack re-reads it, with no request (TanStack re-reads it only on a query update
  or a render).
- **The Android app's tick** (the review's I2): the print service's `app.wake` every 15 s refetches the pulse when its
  data is older than `POS_PULSE` (`hooks/use-native-host.ts:43-47`), which would keep an app device at about 30 s;
  it compares against the current `pulseIntervalMs` instead, so an app device goes calm too.
- `WARM_LINE_PROOF_MS` becomes `2 × POS_PULSE_CALM` (120 s): the warm-up's line proof must survive a calm minute.
- The print host's beat rides each pulse: at 60 s it stays inside the 180 s offline window, which was sized for 60 s
  beats ([shared] `print-job.ts:67-71`).
- What may come later than today: on a device that did not make the slip and saw nothing waiting, a stuck slip's alarm
  rings 20–80 s after the slip instead of 20–40 s (the device that made it keeps 20–40 s, P5-6); and on a calm
  simple-mode print host, a slip whose realtime nudge was lost reaches it at its next pulse or wake, up to 60 s instead
  of 20 s (the review's m5).

## 6. Old and new together

- **An old page on the new server:** no `offline` field, no use of `offlineReplay`: today exactly.
- **The new page on an old server** (a rollback, or a standby deployment on an older build): the pulse answer lacks
  `offlineReplay`, so the outbox waits and says "Waiting: this POS's server must be updated before these orders can be
  sent."; online sends carry no field and work as today. The runbook: before a rollback, every device's Offline orders
  list is empty.
- **The apps:** every app prints the offline slip through the writer it uses today (bytes are bytes): the release APK
  and 2.0.0–2.0.2 on bridge v1 (one printer) and v2 (several), the Windows app 1.12+ (network printers by `printRaw`,
  Windows printers by `printHtmlOn`). No app change.
- **A browser tab:** its own serial or Bluetooth printer only.
- **Text KOTs (Phase 4):** the offline slip takes the text path exactly as an online KOT on a printer whose switch is on.

## 7. How it ships

The web only (the owner's go-live run per cafe; no Worker change, no data migration, no env var), then reload every
POS screen. On the day of the deploy no paper changes online (S1); the offline path is used only during an outage.
GO-LIVE-CHECKLIST gains "Existing cafes: the printing Phase 5 release" (the reload, what staff see during an outage,
"do not refresh or close the POS app during an outage: a page that reloads without the internet cannot open until it
is back", the rollback rule of §6, "End of day only when every device's Offline orders list is empty", "an order sent
after the outage is saved for the person signed in then", "a round added offline to a tab may be printed as Round n and
saved as Round n + 1 when another device added one meanwhile"), and TEST-CHECKLIST "Phase 5 checks (offline KOTs)"
(§9 item 6). Recommended: the demo cafe first for some days, then the clients.

## 8. Not in Phase 5

- Bills, settle, void, move, cancel, QR orders and reprints offline; token slips offline; offline bill numbers (P5-2).
- A waiter phone printing on a network printer its app does not list (a one-time network print in app 2.0.3), and a
  Wi-Fi relay to Bluetooth/USB printers on another device (P5-7).
- A service worker or offline shell (needs the owner's explicit OK; perf design §9): a page that reloads while offline
  cannot open until the internet is back; its outbox is kept and sent then.
- Signing in or unlocking offline; the Kitchen screen offline (it shows its stale chip, as today).
- Parallel printing (Phase 6); backup on paper out, a print method per Windows printer, faster failover (P5-3).

## 9. Measurement and exit

1. **Online paper (S1):** the 43-file pin; the end-to-end byte comparison of `main` and the Phase 5 build (every slip
   kind, simple and printers mode, bridge v1 and v2).
2. **Offline on fake printers** (headless Chrome as the POS app, v1 and v2, a counting proxy): a new order, a second
   round on it, a round on a server tab, a Pay Now, a waiter phone with no printer, a half-way send (with and without
   Print KOT here), a refused entry, a reload while offline then online; each with what printed, when, its banner, and
   after the replay the jobs (printed / queued / REPRINT), the numbers and the totals; no duplicate order, round, number
   or unlabelled paper; the outbox empty at the end. Both the "no internet" (`setOffline`) and the "server down" (the
   server stopped) variants.
3. **The emulator** (WebView 109 and 154, the release-key app as found): the server stopped mid-shift, two offline
   KOTs on the fake printer (10.0.2.2:9100), the server back, the replay; put back as found.
4. **The calm pulse:** with a local stand-in for the realtime room (`perf\fake-realtime.mjs`), a quiet hour and a rush
   on 8 devices through the counting proxy: pulses per device per minute (calm ≈ 1, lively 3), the alarm's time on the
   device that made a stuck slip (20–40 s) and on another (≤ 80 s), the projection for 8 devices 12 h.
5. **Every suite** and the fresh review (Claude Fable 5.1).
6. **The owner's real-printer checks** (TEST-CHECKLIST "Phase 5 checks"): the router's internet unplugged mid-service
   on the demo cafe; three orders (a new table, a round, a Pay Now) on the counter and on a printing phone; the paper
   (OFFLINE · O-n); the internet back; the orders, numbers, bills and totals; no second KOT.

## 10. Free-tier budget

- **Offline:** no new recurring request. A replay is the request the online send would have made (one per round); the
  check after a failed write is one pulse refetch per failure (two requests at most: queries retry once); while the cafe's internet is down nothing reaches
  Vercel. The server adds no write per job (a printed row is one insert, as a queued one) and one CAS per job only on
  the rare replay with the field.
- **The calm pulse:** per device 180 pulses an hour lively, 60 calm (the Android app's 15 s tick follows the same
  interval, §5.11; without that an app device would stay near 120 an hour). For 8 devices 12 h a day the pulse is ≈ 0.52 M a
  month today; with an estimated 60 % of device-hours calm it is ≈ 0.31 M (−0.21 M), and the cafe's projection
  ≈ 1.23 M → ≈ 1.02 M (5 devices ≈ 0.75 M → ≈ 0.62 M). The real figure is measured (§9 item 4) and written into the
  plan's Results before release. Active CPU drops with it (≈ 7 ms per pulse).
- `print-budget.test.ts` is unchanged; `pos-pulse-cadence.test.ts` pins the two intervals and every condition.

## 11. Sessions (the plan)

| Session | Delivers |
|---|---|
| 5A | Test first, wired to nothing on the page: the `offline` field (schema), the server's printed / REPRINT / no-token job creation and the replay CAS, `offlineReplay` in the pulse answer, `GET /api/printers?stations=1`; the pure offline state, outbox store, offline lines and number, and the pulse cadence. |
| 5B | The page: the send's offline branch, the offline KOT through the bridge, Pay Now, the half-way send, the replay runner, Open tabs and the table, the Offline orders list, the guards, the header, the kept acks, the calm pulse wired. |
| 5C | The exit: fake printers and the emulator (§9), the measured pulse, GO-LIVE and TEST-CHECKLIST, the final review. |

## 12. Risks

| Risk | Mitigation |
|---|---|
| A second KOT for a round the server already had | Only a send never attempted prints offline (§5.1); a half-way send prints only on a staff tap, labelled; the replay marks queued lines printed (§5.9); every path tested (S3) |
| An older server drops the field and prints every line again | The replay waits for `offlineReplay` in the pulse answer (§5.8) |
| The page reloads during an outage (no service worker) | The outbox survives in storage and is sent when the page opens again; the runbook says not to refresh or close the app during an outage; the automatic reloads wait (§5.10) |
| Two devices open the same table offline | Each order is its own entry; the create route has no occupied-table refusal (`orders/route.ts`), so both are saved as two orders on that table and staff see both in Open tabs once back (5A pins what the server does) |
| A price, stock or promo changed during the outage | The server decides at the replay; a refusal waits for staff, a total difference is shown (§5.8) |
| The setup changed during the outage | Lines are matched by printer and station; a station printed elsewhere prints REPRINT (§5.9) |
| A Windows printer drawn by the Windows app offline (`printHtmlOn` loads fonts) | Checked in the 5C Windows smoke; a font that cannot load falls back as today's 3 s rule says |
| localStorage cleared or full | Writes are checked; a failed write refuses the offline send before any paper ("Could not keep this order on the device") |
| A long outage (a server paused for days over its allowance) | The outbox keeps up to 300 rounds; past 12 hours an entry is saved at the server's time with a note (P5-9); the GO-LIVE steps for an exhausted allowance stay the owner's |

## 13. My rulings for the owner to check

1. O-3 prints in the banner (`OFFLINE · O-3`) and the Order row, not in the number box (no slip file changes; §5.4).
2. The stations ride the existing printers read (`?stations=1`; no new request; §5.3).
3. A half-way send moves into the outbox once the device is offline, and frees the cart; its offline paper only on
   "Print KOT here" (§5.7).
4. The replay waits for the server's `offlineReplay` flag (§5.8).
5. An order made offline has no token number (§5.9); P5-12 (after 5C): only when its KOT printed, or may have printed, offline.
6. A round's total that differs at the replay is shown as a note; a sale's is refused and fixed by staff (§5.6, §5.8).
7. Actions that need the server say so offline instead of failing; the idle lock waits; kept acks wait (§5.10).
8. The outbox holds at most 300 rounds (§5.2).
9. A refused entry is fixed in the cart and sent under a new key with its offline lines, so nothing prints twice
   (Fix and send, §5.8).
10. Offline sales take Cash, Online or Split; promo, reward, points, card, Due, Credit and a customer need the internet
    (§5.6).
11. The order is saved for the person signed in when it is sent (§5.8).
12. A round on a tab the server already has shows the tab's own order number in the Order row (§5.4).
13. The taken time is kept only on the same cafe day and slip day as the request's arrival; else the server's time and
    a note (§5.9; the planning review's C1 — numbers are drawn at arrival).
14. An offline round never enters the repair sweep; a round whose jobs could not be made is answered 503 and sent again,
    and a replay first makes any missing job (§5.9).
15. "Here" means the printers this device writes plus the setup's network printers its app reaches now (§5.3).
16. While offline the kept acks wait without a 5 s timer; End of day warns while offline orders remain (§5.10).
