# Printing Phase 4: text KOTs, network printer discovery, setup polish (design)

- **Date:** 2026-10-15
- **Status:** approved section by section by the owner on 2026-10-15; this document for the owner's review
- **Scope:** `apps/cafe` (the page: the text KOT renderer, the switch, the bridge hook, the discovery UI, the toast words),
  `apps/mobile` (the Android app 2.0.2: LAN discovery, the network printer's name), `apps/desktop` (the Windows app
  2.0.2: LAN discovery, raw bytes to a Windows printer)
- **Builds on:** [2026-10-02-printing-reliability-design.md](2026-10-02-printing-reliability-design.md) §14 (the Phase 4
  row) and §15 ("Large raster jobs over BLE"); the Phase 2 and Phase 3 plans' deferred items (m-2, the not-routed
  toast); [2026-10-12-native-apps-2-design.md](2026-10-12-native-apps-2-design.md) (how an app change ships)

## 1. Summary

Every slip prints today as a picture: the page draws the slip, turns it into a 1-bit raster and sends ESC/POS `GS v 0`
bands (a typical KOT is about 44 KB). Over Bluetooth that is slow, and over BLE with a small MTU it can approach the
app's 60 s job watchdog. Phase 4 adds three things:

1. **Fast text KOTs.** A kitchen ticket whose every printed character is plain English text can print as ESC/POS text
   in the printer's own font (about 0.5–1.5 KB). It is a switch per printer, off by default, turned on only after a
   text test slip printed well on that very printer. Anything the text renderer cannot print exactly (Indian scripts,
   a logo, a QR code, a design or line it does not know) prints as a picture, as today.
2. **Network printer discovery.** The Android and Windows apps (2.0.2) can list the network printers on their own
   Wi-Fi or LAN when staff tap "Find network printers", so nobody has to know a printer's IP address.
3. **Setup polish.** The Android notification names two network printers on one address apart (Phase 2's m-2), and
   the "not routed" toast says the right thing for a KOT round with nothing left to print.

## 2. The owner's rules for this phase (2026-10-15)

- "Abhi KOT and print proper nikal rahi hai … current perfect working hai, so very very very careful." Printing works
  in the field today; Phase 4 must not change one slip that nobody asked to change.
- Any cafe may use any printer, and may write its menu in Hindi, Gujarati or any script; new designs and
  multi-language slips are coming. So text mode must decide safely on its own, for any printer and any text.
- Nothing unused: no feature the client does not need (the owner declined a "last slip" diagnostic line).
- Free tier, ₹0 forever: no new request or cost on any cafe's Vercel, Atlas or Worker.

### 2.1 Safety rules (each one is pinned by a test)

| # | Rule |
|---|---|
| S1 | **A deploy changes no paper.** Every text switch starts off. With every switch off, every slip's bytes are byte-for-byte today's: the picture code (`lib/printer/escpos.ts`, `lib/printer/raster.ts`, `lib/printer/lane-print.ts`'s raster path, the React slips, the apps' raster and raw paths) is not changed, which a source pin holds (each file's hash as of the spec commit); the bridge's text step answers nothing and calls no writer for a printer whose switch is off (unit tests); and an end-to-end run prints the same orders with every switch off on a build of today's code and on the new one, comparing the bytes file for file. |
| S2 | **A printer goes to text only after it proved it.** Turning the switch on first prints a text test slip on that printer; the switch turns on only when staff answer "Yes, it printed clearly". |
| S3 | **Text never loses a slip.** The decision and the text bytes are made before a single byte is sent. When the gate says no, or the text renderer throws for any reason, that same slip prints as a picture at once: never a failed slip, never a second paper. |
| S4 | **The same write, the same rules.** Text bytes go through the same writer the picture goes through (the POS app's `printer.print`, v1 or v2; the Windows app's `printRaw`; a browser's serial or Bluetooth printer; for a Windows printer the new `printRawOn`), so the lease, the ack, REPRINT / DUPLICATE / BACKUP PRINTER, copies and the network job's DLE EOT check are exactly as today. |
| S5 | **The apps' printing code stays.** In 2.0.2 the Android printer manager, pool and transports and the Windows raw spool and raw TCP printing are not changed. New, separate code only: LAN discovery in both apps, `printRawOn` on Windows (calling the existing raw spool function), and the network printer's display name on Android. |
| S6 | **A release gate.** The text switch is turned on for a client only after every test, the emulator and fake-printer runs and the owner's real-printer checks pass, and after some days on the demo cafe. |

## 3. Owner decisions (2026-10-15)

| # | Question | Decision |
|---|---|---|
| P4-1 | Which slips may print as text? | **The KOT family** (the kitchen surface): KOT, VOID, TABLE MOVED and the cancel notice. Bills, token slips, End of day and the setup page's Test print stay pictures (logo, UPI pay QR, GST lines; the customer sees a bill). |
| P4-2 | How is text turned on? | **A switch per printer, off by default**, like the paper width: "Fast text KOTs (English only)". |
| P4-3 | Where is the switch kept? | **Only on the device that prints that printer** (its page's storage), never on the server: no model, API or request change, and any loss of it (app data cleared, a new device, a failover writer) means pictures, i.e. today. |
| P4-4 | The ₹ sign (no standard ESC/POS code page has it) | **"Rs 240"**, Indian grouping kept ("Rs 1,23,456"); only on text KOTs (pictures and bills keep ₹). |
| P4-5 | Characters per line | **From the paper, with a 42 choice:** 58 mm → 32, 80 mm → 48; on 80 mm a choice "Characters per line: Automatic / 42" for a printer whose 48-character ruler wraps. |
| P4-6 | Windows printers (the spooler, e.g. the counter PC's USB POS80) | **Included from the Windows app 2.0.2:** a new `printRawOn(printerName, bytes)` (the raw spool path the Direct method already uses). On an older Windows app, or with "Through the Windows driver", that printer prints pictures and its switch is not offered. |
| P4-7 | How the text bytes are made | **Approach A: from the slip's own data, not from the drawn slip.** The same KOT data and template the picture uses go through one text renderer per design (Classic, Kitchen Bold) to text lines, then to ESC/POS. Pure functions, tested with node:test. (Not taken: reading the drawn slip's DOM, fragile and untestable without a browser; making text on the server, which costs Active CPU and does not know the printer.) |
| P4-8 | Discovery method | **A connect-only scan of TCP port 9100** on the device's own /24 network, only when staff tap; no byte is sent to anything found. (Not taken: mDNS, which few cheap printers answer and which can raise a Windows Firewall prompt; a DLE EOT probe, which could put a blank or garbled page out of an office printer that listens on 9100.) |
| P4-9 | Setup polish | **m-2:** a network printer on a port other than 9100 is named "Network printer ‹host›:‹port›" (9100 keeps today's "Network printer ‹host›"). **The not-routed toast:** a KOT round with nothing to print says so; a notice keeps today's words. Nothing else was reported from the field. |
| P4-10 | A lighter printers-mode wake for three printing devices | **Not in Phase 4** (no wake, lease or lifecycle change). See §10. |
| P4-11 | How it ships | The web part by the owner's deploy; the app part as **2.0.2 of both apps**. Either order is safe (each side feature-detects the other). Recommended order and the release gate in §9. |

## 4. Text KOTs: what prints

### 4.1 The gate (the whole slip, or a picture)

A slip prints as text only when every condition holds; otherwise the whole slip prints as a picture, exactly as today:

1. It is a job slip on the kitchen surface whose kind is `kot`, `void`, `moved` or `cancel-notice` (never `test`, a
   bill, a token or End of day).
2. The printer it prints on has its text switch on, on this device (§5.1), and that printer's writer can take raw
   bytes on this device (§5.4).
3. Its template is known to the text renderer: the stored kitchen-ticket template (`kotTemplateOf`), or, when there is
   none or it cannot be read, the legacy ticket's own Classic template (`classicKotTemplate`, exactly what the picture
   path uses). The design is `classic` or `kitchenBold`. A design the text renderer does not know → picture.
4. Every block that prints is one the design's text renderer knows (every block type in `KOT_BLOCK_TYPES` today). A
   block type added later is unknown until its text renderer is written → picture.
5. No picture-only content prints: a logo (the logo block on while the cafe has a logo) or a QR code (a QR block whose
   link is a valid https link, `isSafeHttpsLink`, so the picture prints a code) → picture. An ornament divider has a text
   form (§4.3); a QR block whose link is not valid prints nothing in the picture and nothing in text.
6. Every character of every printed string is printable ASCII (0x20–0x7E) after the fixed map in §4.2. Any other
   character (Devanagari, Gujarati, any Indian script, an accented letter, an emoji, a symbol not in the map) → picture.
7. The text renderer returned without an error, and its bytes are smaller than the picture's limit (they always are).

The check runs on the strings the slip would print, after the same transforms the picture uses: the kitchen view of
the order (`kitchenOrderOf`, `kitchenLinesOf`), the printer's paper (`settingsForPaper`), the job's banner and station
line. A future translation of a printed label into another script trips rule 6 by itself.

### 4.2 Characters

The printer gets printable ASCII only, so no code page command is sent and every printer prints the same characters in
every code page. A fixed map, applied before the check:

| From | To | Where it appears today |
|---|---|---|
| `₹` (U+20B9) | `Rs ` (then the number, Indian grouping as `inr()` prints it) | prices, round total |
| `×` (U+00D7) | `x` | "2 × Paneer Tikka" |
| `→` (U+2192) | `->` | a moved table "T-1 → T-4" |
| `—` (U+2014), `–` (U+2013) | `-` | "FOOD ALREADY ORDERED — DO NOT MAKE AGAIN" |
| `▸` (U+25B8) | `>` | Classic's instruction line |
| `»` (U+00BB) | `>>` | Kitchen Bold's instruction prefix |
| `·` (U+00B7) | `-` | joined labels ("BACKUP PRINTER · REPRINT") |
| `‘` `’` (U+2018/9) | `'` | typed text |
| `“` `”` (U+201C/D) | `"` | typed text |
| `…` (U+2026) | `...` | typed text |
| U+00A0, U+202F (no-break spaces) | a space | time strings on newer ICU ("02:35 pm") |

Tabs and line breaks in typed text follow the picture's rules (custom text keeps its line breaks; elsewhere a line
break is a space; a tab or a carriage return is a space, as the picture shows it: the 4A gate's m-1). Nothing else is
mapped.

### 4.3 Layout

- **Font and width.** The printer's built-in Font A (12 × 24 dots), selected by `ESC M 0` at the start of every job
  (a memory switch can make Font B a printer's default after `ESC @`: the owner's ruling at the 4A gate, 2026-10-16).
  Columns: 58 mm → 32; 80 mm → 48, or 42 when the printer's switch says so (P4-5). A line holds at most one character
  less than the columns (47 on 48), so a printer that moves to the next line by itself when a line is exactly full
  never adds a blank line; a double-width line holds half of that (23 on 48).
- **Sizes.** Each line's size is its block's size in the picture: the template's base size (small 12 px, normal 14 px,
  large 16 px, relative to 14 px) × the line's own em in the design × the block's size choice (xs 0.75, sm 0.875,
  md 1, lg 1.25, xl 1.5). That ratio maps to the printer's character size: below 1.2 → normal; 1.2 up to 1.5 → double
  height (columns unchanged); 1.5 and above → double width and height. On Classic at the normal base this makes the
  title, station, token and restaurant name double height, the ticket number double size, and the rest normal.
- **Weight and alignment.** Bold (and semibold) → `ESC E 1`; a design's regular or medium weight → not bold; a block's
  own bold choice wins, as in the picture. Left / centre / right → `ESC a`; a block's own alignment wins.
- **White on black.** The REPRINT / DUPLICATE / BACKUP PRINTER banner and Kitchen Bold's bands (VOID, TABLE MOVED, the
  note) → `GS B 1`, each line padded to the full width so the band spans the paper. Two things are expected, not
  defects: a band leaves the line's last column white (the columns-less-one rule), and two band lines in a row may
  show a thin white gap between them on a printer that does not print white on black across its line spacing.
- **Rules.** A dashed divider → `- - - -` across the width; solid → `------`; double → `======`; blank → an empty line;
  ornament → a centred `* * * * *`. A design's default divider is its own (Classic dashed, Kitchen Bold double).
- **Rows.** A label / value row (Order, Table, Time, Staff) prints the label left and the value right; when the pair does
  not fit, the value goes to the next line, right-aligned (the picture's wrap). A block aligned centre or left places the
  value as the picture's row does: centred in the room after the label and its space, or right after it (on its own
  line: centred, or at the line's start); the owner's ruling at the 4A gate (m-3). An item line prints `‹qty› x ‹name›`
  left and its amount right; a long name wraps (Classic from the line's start, as the picture does; Kitchen Bold under
  the name, after its quantity); modifier lines are indented four spaces; an
  instruction is indented, bold, with `> ` (Classic) or `>> ` (Kitchen Bold). Words wrap at spaces; a word longer than a
  line is split.
- **Spacing.** A small feed between items (`ESC J 12`: twelve of the printer's vertical motion units, a dot on most
  receipt printers and finer on some, so about the picture's gap); a blank line where
  the picture has a divider's margin is not added (the rule line itself separates).
- **Kitchen Bold specifics.** Upper-case restaurant name and item names; the KOT number's box prints as a white-on-black
  `KOT 12` line at double size (the box cannot float beside the meta lines in text; the lines follow under it); the
  table line double size; items `[2] PANEER TIKKA` double height and bold; modifier and instruction lines bold.
- **The job's bytes.** `ESC @`, `ESC R 0` (the USA international character set, so `#`, `[`, `]`, `@`, `{`, `}`, `~` and
  the rest print as themselves whatever set a printer starts in) and `ESC M 0` (Font A): the owner's rulings at the 4A
  gate, 2026-10-16; both are cleared again by `ESC @` and a power-off, and a picture sends neither. Then each line as only
  the state changes it needs (`ESC a`, `ESC E`, `GS !`, `GS B`)
  and its text and `LF`; then every style reset (`GS B 0`, `GS ! 0`, `ESC E 0`, `ESC a 0`, never a second `ESC @`, which
  on some printers discards buffered text); then `ESC J 16` (about the picture's 16-row bottom pad) and the picture's own cut
  `GS V 66 0`.
- **Size.** A typical KOT is about 0.5–1.5 KB, against about 44 KB as a picture.

### 4.4 Words

The text renderer prints the same words, in the same order, as the design's React renderer for the same data: the
titles, "Order", "Table", "Time", "Staff", "Reason:", "Note:", "‹n› item(s)", " VOIDED", "Round total:", "TOKEN ‹n›",
the station line, the round label, `#‹number›` (Classic) / `KOT` (Kitchen Bold). A parity test renders each design's
React slip for a set of fixture orders (every variant, a banner, a station line, prices on and off, modifiers,
instructions, notes, a token, a moved and a void slip, each block's size / align / bold choices, the ticket number's
block off and "Show ticket number" off) and compares its text
words with the text renderer's words after the §4.2 map; any change on one side without the other fails it.

## 5. Text KOTs: the switch and where it plugs in

### 5.1 The switch

- **Where staff see it:** a section "Fast text KOTs (English only)" in the printer panel of the device that prints,
  listing each printer this device prints KOTs on: in simple mode this device's own printer; in printers mode each
  printer of the setup this device writes that takes KOTs (its stations, a full copy or notices). Each printer: the
  switch and, on 80 mm, "Characters per line: Automatic / 42". A short line says what text mode is: "Prints English-only
  kitchen tickets as text in the printer's own font: much faster on Bluetooth. Tickets with Hindi, Gujarati or any other
  script, a logo or a QR code still print as now."
- **Where it is kept:** the page's storage on that device, under its own key `pos.text-kot.v1` (never inside
  `pos.device-printer.v1`, whose strict schema an open older page would then fail to read), keyed by the printer and
  how this device reaches it, lower-cased: `printer:‹setup printer id›:‹reach›` for a printers-mode printer and
  `device:‹reach›` for this device's own printer in simple mode, where ‹reach› is the writer the picture takes there
  (`app:‹the POS app's printer id›`, `lan:‹host›:‹port›` for the Windows app's network printer, `windows:‹name›`, or this
  device's own printer: `native:‹id›`, `serial:‹USB ids, or the name›`, `ble:‹device id›`). The 4A gate chose the reach
  over the setup's connection (the owner's OK, 2026-10-16): the print bridge holds no printer setup, while the route is
  in hand at each print. A printer changed in either place (another printer, another address) is a new key, so its
  switch is off until its own text test printed. The store keeps only whether the 80 mm "42" choice is made; the
  columns themselves come from the printer's paper at each print (Printer setup's paper for a printers-mode printer,
  the device printer's paper in simple mode, the kitchen ticket's paper setting for the Windows app's chosen printer,
  which Direct mode draws at), so a printer whose paper is changed later prints at its new width. An
  unreadable store reads as every switch off.
- **Turning it on (S2):** the switch's tap prints a text test slip on that printer (no job, no server request; the
  bridge's busy window is respected, so it never interleaves with a slip): the cafe's name, "TEXT TEST", a sample
  kitchen ticket with a price in `Rs`, Classic's `#12` and Kitchen Bold's `[1]` (Session 4A's review, I-2), double-height
  and white-on-black lines, and a ruler as long as a text line may be (the columns less one). Then: "Did it print clearly, with the ruler on one line?" **Yes** → on; **No** → stays off (with "Keep it off,
  or try Characters per line: 42" on 80 mm). A failed print says the printer's own error and stays off.
- **Turning it off** is immediate.

### 5.2 Where the decision is made

The page's one print bridge (`hooks/use-print-host-bridge.ts`) prints each slip of a leased job through a React surface
and react-to-print. Right before it fires the kitchen surface, it asks the text side for the slip's bytes; with bytes it
writes them through the printer's writer (§5.4) and settles the slip with that write's outcome; with none (the gate, or
an error: S3) it fires the kitchen surface exactly as today. The bridge's busy window, watchdog and outcome order are
unchanged; a copy (`PrintJob.copies`) is one more pass through the bridge, so each copy decides the same way.

The text step runs only for a job's slip on the kitchen surface: never for the attestation slip or a printer's Test
print, which also ride that surface. It keeps the picture path's own rules before a write (a printer another tab of
this browser owns says so, as today; an app with no printer prints nothing as text). And it answers nothing when the
slip's design needs the lazy slip code that is not loaded on this device (a Kitchen Bold ticket, or one with a QR
line, right after a deploy while offline): the picture then prints the legacy ticket, and text must not print
something else.

Printing that does not go through the bridge (a device with no identity printing its own slip) stays a picture.

### 5.3 Old and new together

- **The POS app (Android).** Text bytes are bytes: the release APK, 2.0.0 and 2.0.1 print them through the same
  `printer.print` (v1 and v2). No app update is needed for text on any Android printer.
- **The Windows app.** Its network printers take the page's bytes through `printRaw` (1.12.0 and later). A Windows
  printer needs `printRawOn` (2.0.2); on an older app the page never offers that printer's switch and prints it as a
  picture. With "Through the Windows driver" chosen the switch is not offered either (that method exists for printers
  whose raw path misbehaves).
- **A browser tab** with a serial or Bluetooth printer: the page alone.
- **An older page** knows nothing of text and prints pictures; it never reads `pos.text-kot.v1`.
- **A failover writer** (Phase 3) that took a printer over has no switch for it → pictures. A switch this device stored
  for that printer while it was this device's own counts only while it is again (the 4A gate: a slip of one of the
  agent's taken-over printers is marked, and the text step answers nothing for it).

### 5.4 The writers

| The slip's printer | Writer (unchanged unless noted) |
|---|---|
| This device's own printer (simple mode): the POS app's printer, a serial or Bluetooth printer in a browser | `devicePrinter().write(bytes)` |
| One of the POS app's printers by id (printers mode, bridge v2) | `printerWriter(nativeId)(bytes)` |
| A network printer the Windows app writes (1.12.0+) | `desktopLan().write(target, bytes)` (`printRaw`) |
| A Windows printer: this PC's chosen printer (simple mode) or a named one (printers mode) | **new** `printRawOn(printerName, bytes)` (2.0.2, Direct method only) |

## 6. The Windows app's `printRawOn` (2.0.2)

- Preload: `printRawOn(printerName: string, data: Uint8Array) → Promise<void>`; IPC `pos-desktop:print-raw-on`.
- Main process: the same caller gate as every print channel (the main window, the saved origin), the printer name one
  Windows reports now (as `printHtmlOn`), `data` a `Uint8Array` of 1 byte to `RAW_TCP_DATA_MAX_BYTES`, the print method
  Direct; then the existing `writeRawJob(name, "POS slip", data)` on the existing print queue. A printer Windows does
  not report answers the shell's "That printer is not on this PC…" sentence (as `printHtmlOn`); every other failure
  answers the existing raw spool sentences, which the page already classifies (spec §7.5).
- The page feature-detects `typeof printRawOn === "function"`.

## 7. Network printer discovery

### 7.1 Android (2.0.2)

- A bridge method `network.findPrinters` (no params) → `{ found: [{ host, port: 9100 }], subnet: "192.168.1.0/24" }` or
  `{ found: [], reason: "no-network" }`; the app's `features` gains `lanScan`, so a page shows the button only on an app
  that has it (an older app is never asked; an older page never asks).
- A new `LanScan.kt`, apart from the printer manager: it looks through every network the phone has
  (`ACCESS_NETWORK_STATE`, already granted) for the Wi-Fi or Ethernet one that is not a VPN (Wi-Fi first when both are
  there), whether or not it is the default (a cafe Wi-Fi with no internet leaves mobile data as the default, and the
  printer is still on the Wi-Fi);
  that network's private IPv4 addresses (10/8, 172.16/12, 192.168/16); the /24 around each (inside the network's own
  prefix when it is longer; at most two, 508 addresses), never its own address; a TCP connect to port 9100 through a
  socket bound to that network, with a 500 ms timeout, 32 at a time on the scan's own threads (never a printer's io
  thread), at most 10 s in all; **no byte is sent**; each socket is closed at once. The list is sorted by address and
  holds at most 64.
- No new Android permission. JUnit covers the subnet arithmetic, the limits and the answer.

### 7.2 Windows (2.0.2)

- `findLanPrinters() → { found, subnet } | { found: [], reason }` over IPC `pos-desktop:find-lan-printers`, in a new
  `lan-scan.ts` (the raw TCP printing module is not changed): `os.networkInterfaces()`'s non-internal private IPv4
  addresses, leaving out link-local 169.254/16 and virtual adapters (WSL, Hyper-V's vEthernet, VirtualBox, VMware, VPN
  and TAP adapters, Tailscale, ZeroTier), 192.168 networks first; the same /24, limits and connect-only rule; the same
  caller gate as the print channels. Outgoing TCP only, so no firewall prompt. Unit tests inject the interface list
  (with such adapters among them) and the connector.

A connect-only probe holds a printer that takes one connection at a time for a moment; another device's print in that
instant is refused and asked again a second later (both apps already retry a refused connect). Accepted.

### 7.3 The page

- "Find network printers" beside the network printer address in two places, only when this device's app can scan:
  the POS app's printer panel ("Add a network printer") and the printer setup form's "Network (LAN)" address (on the
  POS app or the Windows app 2.0.2).
- While it scans (up to about 10 s): "Looking for printers on this Wi-Fi…". Then a list: `192.168.1.50 · port 9100`,
  and "Already added: Kitchen" for one the setup or the app already has. A tap fills the address (and port 9100); staff
  then go on exactly as today (Use or Save, then Test print). Nothing is added by itself.
- Nothing found: "No network printer found on this Wi-Fi. Check that the printer is on and on the same Wi-Fi, or type
  its address." Not on Wi-Fi or a LAN: "This device is not on a Wi-Fi or wired network." The existing tip to give the
  printer a fixed address (a DHCP reservation in the router) stays.

## 8. Setup polish

- **m-2 (Android 2.0.2).** A network printer's display name is made from its id (`tcp:host:port`) wherever the app
  shows it (the printer list, the print-host notification): "Network printer ‹host›" for port 9100, "Network printer
  ‹host›:‹port›" for any other port. Printers saved before keep their saved name in storage; the shown name comes from
  the id, so they are named apart too, with no migration. `PoolStatusTest`'s three network fixtures get names of their
  own, so each assertion tells them apart.
- **The not-routed toast (web).** The answer "not-routed" for a KOT means its round has nothing left to print (every
  line cancelled): "Nothing to print: every item in this round was cancelled." A notice no printer takes keeps today's
  words ("No printer takes this slip. To print notices, switch Notices on for a printer in Printer setup."). The toast
  is chosen by the slip's kind, on both call sites.

## 9. How it ships

- **The web** (the owner's deploy, the go-live run per cafe; no Worker change, no data migration, no env var): the text
  renderer, the switch and its test print, the bridge's text step, the discovery UI (shown only on an app that can
  scan), the toast words. On the day of the deploy no paper changes (S1).
- **The apps 2.0.2** (both, one version): Android `network.findPrinters` and the network printer's name; Windows
  `findLanPrinters` and `printRawOn`. Built and packaged by `scripts/release-native.mjs` into
  `D:\kd\pos-apk-release\Sandbee-POS-2.0.2\`; the owner uploads (versioned files first, `latest.json` / `latest.yml`
  last); the apps update themselves (spec of native apps 2.0).
- **Order.** Either order is safe. Recommended: the web; then 2.0.2; then on the demo cafe turn the switch on for the
  owner's Bluetooth printer and run the measurement (§11); after some days on the demo, the clients, printer by printer
  (S6). GO-LIVE-CHECKLIST gets "Existing cafes: the printing Phase 4 release" with these steps and "turn Fast text KOTs
  on, on each printing device whose printer is Bluetooth, after its text test printed clearly".

## 10. Not in Phase 4

- A lighter printers-mode wake for three printing devices (Phase 3's final gate: a busy day with three printing devices
  sits near 15 % of the free Active CPU). No wake, lease or lifecycle change in Phase 4; a cafe with three printing
  devices is measured first and gets its own phase if needed.
- Text bills, tokens and End of day; native ESC/POS QR codes; a logo inside a text slip.
- mDNS discovery; probing found addresses with any byte; a scan in the background.
- A server-side copy of the text switch; a "last slip" diagnostic line (the owner: nothing unused).

## 11. Measurement and exit criteria

1. **Size.** For every fixture KOT (both designs, 58 mm and 80 mm) the text bytes are at least 10× smaller than the
   picture bytes of the same slip (the picture's size measured by the fake printer on the emulator; the text's by the
   unit tests and the fake printer).
2. **Bluetooth time (the owner, on his Bluetooth printer):** one fixed order (6 items with modifiers and one
   instruction), the same phone, printer and app; five "Send to Kitchen" with the switch off, then five with it on,
   each filmed from the tap to the cut; the record is the median of each and their ratio, written into the plan's
   Results by the next session.
3. **No paper changes with the switch off** (S1): the source pin, the bridge's unit tests, the end-to-end byte
   comparison against today's build, and the emulator's picture KOT byte count equal to before.
4. **Fallbacks:** a KOT with a Hindi or Gujarati item, with the logo on, with a QR line, prints as a picture with the
   switch on (unit tests and the emulator).
5. **Discovery:** the emulator app finds a fake printer on the host (`10.0.2.2:9100`); the Windows scan's unit tests.
6. **The owner's real-printer checks** (TEST-CHECKLIST "Phase 4 checks"): the text test and the switch on a Bluetooth,
   a USB and a network printer; KOT, VOID, TABLE MOVED, cancel notice and a REPRINT on each; Kitchen Bold; 58 mm and
   80 mm; Characters per line 42; a Windows printer on 2.0.2; discovery on a phone and on the counter PC; the m-2 name;
   the measurement in item 2.

## 12. Free-tier budget

No new request of any kind: the text decision, the bytes, the switch and its test print are on the device; discovery
talks only to the local network; no field is added to any server document. `print-budget.test.ts` is unchanged.

## 13. Sessions (the plan)

| Session | Delivers |
|---|---|
| 4A | The text renderer as pure code with its tests, wired to nothing: the character map and gate, the line model and its ESC/POS encoder, the Classic and Kitchen Bold text renderers, the parity test against the React slips, the golden bytes, the size test. No behaviour change. |
| 4B | The page: the store and the switch section with its test print, the bridge's text step and the writers (the Windows printer side feature-detected), the not-routed words; the fake-printer end-to-end runs (a fake POS app in headless Chrome, the emulator). |
| 4C | The apps 2.0.2 (Android discovery and the name; Windows discovery and `printRawOn`) and the page's discovery UI; JUnit, desktop tests, pins; the emulator finding a fake printer. |
| 4D | The exit: every suite, the release set 2.0.2, GO-LIVE and TEST-CHECKLIST, the final review. |

Each session is followed by a review gate that makes the next one exact.

## 14. Risks

| Risk | Mitigation |
|---|---|
| A printer prints text badly (its firmware, a 42-column head) | Off by default; on only after its own text test printed clearly (S2); the 42 choice; off again in one tap |
| A design, block or label changes and the text no longer matches | The parity test fails; an unknown design or block is a picture by rule (§4.1) |
| A KOT in Hindi or Gujarati | Rule 6: a picture, as today |
| The text path itself fails | S3: that slip prints as a picture at once, before any byte left |
| An older page or app in the mix | §5.3: every combination prints, at worst as a picture |
| A scan on a network that blocks client-to-client traffic | Nothing found; the message says to type the address |
