# Device test checklist: POS Software Android app

Run this on a **real phone or tablet** and a **real receipt printer** before
giving an APK to a client. Tick each line; write down anything odd.

Things to have: the app installed (see README), the POS web app deployed with
the printing update, a thermal printer (ideally one Bluetooth and one with a
network port), a PC with Chrome for the debug part.

## Regression checks added 2026-10-02

- [ ] Deploy the updated cafe web build as well as the APK. The color fallback
      ships in the website's CSS; replacing only the APK does not update it.
- [ ] Check login, POS, printer panel and dark mode on WebView 109 and a current
      WebView. Backgrounds, muted text and border colors must be visible. This
      fallback covers colors, not all future Tailwind features on old engines.
- [ ] On a tablet without Bluetooth (or with its permission denied), attach a
      USB printer through a powered OTG connection. **Refresh USB / paired
      printers** must show it without requiring Bluetooth.
- [ ] Deny USB access. There must be no repeating permission popup. Tap
      **Reconnect** explicitly, grant access, and print a test slip.
- [ ] With a USB permission dialog pending, change/forget the printer. The old
      request must not hold up the new printer for the full 60-second timeout.
- [ ] Unplug/replug USB; turn Bluetooth off/on in Android settings; revoke and
      restore permission. The connection status must follow the real adapter
      state and recover. Test with the app foregrounded and backgrounded.
- [ ] Attach two USB printers with identical VID/PID. Selection must fail
      without printing on an arbitrary one. Remove one, then reconnect.
- [ ] Interrupt Bluetooth/USB/LAN during a long slip. An uncertain/partial
      write must show an error without automatically replaying the whole slip.
      Check the paper before manually reprinting. A new job should reconnect.
- [ ] Test 58mm and 80mm bills/KOTs, long orders, paper-out, lid-open and power
      cycles on each client's actual ESC/POS model. A successful byte transfer
      does not prove that paper physically came out.
- [ ] For a printer cabled to Windows, select it in the desktop POS, designate
      that PC as the printing device, and test orders sent from the mobile POS.
      Test both the direct ESC/POS method and the driver method where required.
- [ ] Chrome on a PC or Android phone with a Web Serial or Web Bluetooth printer: unplug or
      power-cycle the printer, then print. A slip refused before anything was sent prints
      once after the automatic reconnect; a slip cut off mid-way is NOT reprinted by itself
      and the message says to check the paper.
- [ ] Android app with a USB printer: put the app in the background, unplug and replug the
      printer, then open the app. The USB permission prompt appears once; allow it and the
      printer connects. Deny it: no further prompts until you tap Reconnect.
- [ ] Old tablet (WebView 109 or older): light highlights, red error tints, borders and the
      dark overlay behind dialogs look like tints (not solid colour blocks), in light and
      dark mode.
- [ ] Android app with Wi-Fi off (or a wrong POS address): wait on "Could not open the POS"
      while it retries by itself, then tap Try again several times, and on the loading
      screen tap its Try again too. The app never closes by itself.

## Printing lifecycle checks (Phase 1, added 2026-10-03)

Every slip is now printed through the server: it counts as printed only when the device
that printed it says so, a slip that may have printed is repeated with a black **REPRINT**
banner (a KOT) or asks the cashier first (a bill, **DUPLICATE** banner), and every slip
that did not print within 20 seconds shows in the printer panel on every device. Use one
device as **Print all slips on this device** and a second device (phone or PC) to order.

- [ ] **Nothing waits.** The printer button shows no number and the panel shows no
      **Slips waiting** section.
- [ ] **Printer off.** Switch the printer off and send a KOT from the second device.
      Within 20–40 seconds both devices show "KOT round 1 · T-n has not printed yet."
      with a **Show** button (the printing device rings once); the printer button shows
      **1**. Show opens the panel: **Waiting for the printer**, "The printer is off or not
      connected." Switch the printer on: the slip prints **once, without a banner**, and
      the number and the notice go within about 20 seconds.
- [ ] **Print now.** With the printer still off, tap **Print now** on the waiting slip:
      "It prints by itself as soon as the printer is ready." stays readable for a few
      seconds, and the row's buttons work again at once.
- [ ] **A KOT cut mid-slip** (pull the LAN cable or switch the printer off while a long
      KOT is printing). On USB, Bluetooth and the Windows app a **REPRINT** copy prints
      by itself when the printer is back. On the Android app's network (LAN) lane the cut
      may not be seen and nothing repeats (known limit, fixed in Phase 3): check the paper
      and use **Reprint** in Orders if needed. Note which lane you tested.
- [ ] **A bill cut mid-slip** (same way, on a bill): no second copy prints by itself; the
      cashier sees "Bill · ORD-… may not have printed." and **Check the bill** in the
      panel. **Print again** prints one copy with the black **DUPLICATE** banner; on a
      second bill, **It printed** prints nothing and the row leaves.
- [ ] **The printing device is killed mid-slip** (Settings → Apps → Force stop while a
      slip prints). Open the app again after 2 minutes: the KOT prints once more with
      **REPRINT** (a bill asks the cashier instead). Nothing prints a third time.
- [ ] **Couldn't print.** A KOT whose two tries may both have printed (cut it twice) shows
      under **Couldn't print** with a reason: "Tried twice. Check the printer, then retry.",
      or the printer's own sentence (on USB, Bluetooth and the Windows app it may say what
      failed). **Retry** prints exactly one **REPRINT** copy.
- [ ] **An old slip from the dashboard.** With a KOT waiting over 30 minutes, tap **Print**
      on it in the dashboard's "older slips" line (on the printing device) instead of the
      panel: it prints once, through the same path as the panel's **Print now** (a slip
      that was marked **REPRINT** keeps its banner).
- [ ] **Windows app: no printer chosen.** In the Windows app, choose no printer (Settings →
      Printing) or rename the chosen one in Windows, then send a KOT: it waits under
      **Waiting for the printer** with "No printer is chosen for this PC…" (or "The chosen
      printer was not found…"), and nothing is marked REPRINT. Choose the printer again:
      the KOT prints once, **without a banner**.
- [ ] **The alarm after a restart, untouched.** Restart the printing phone or tablet (and,
      separately, the Windows app's PC), open the POS app and do **not** touch the screen.
      Switch the printer off and send a KOT from the second device: within 20–40 seconds
      the printing device **rings**. (The POS in a plain browser tab still needs one tap
      after it opens before it can ring.)
- [ ] **Clear from another device.** A waiting slip cleared on the second device leaves
      the first device's panel within about 20 seconds and never prints.
- [ ] **Two rows at once.** With two slips waiting, tap **Print now** on one and at once on
      the other: both rows' buttons work again within a few seconds.
- [ ] **A reload while slips wait** (or open the POS on a new device): one notice, "N slips
      still waiting. Open the printer panel to check.", not one per slip.
- [ ] **Screen off.** Repeat the 30-minute screen-off test below: no alarm for slips that
      printed, and a slip that did not print still shows in the panel.
- [ ] **Clean-up.** A slip nobody acts on disappears from the panel after 3 hours (a
      Friday KOT never prints on Monday). Nothing to tap.

## Part A. Debug build, talking to the app directly (about 15 minutes)

Build and install a **debug** build (`npx react-native run-android --active-arch-only`),
open the POS in the app, then on the PC open Chrome at `chrome://inspect`, find
the POS page and click **inspect**. In the Console:

- [ ] `PosNative.version` shows `1` and `PosNative.platform` shows `"android"`.
- [ ] `await PosNative.request('app.info')` returns `app: "pos-mobile"`, an app
      version, `platform: "android"` and a list of transports.
- [ ] `await PosNative.request('printer.status')` returns a state and a
      `bluetooth` value (`on`, `off`, `unauthorized` or `unsupported`).
- [ ] `await PosNative.request('permissions.request', { kind: 'bluetooth' })`
      shows the Android permission prompt; after you allow it, it returns
      `granted: true`.
- [ ] `await PosNative.request('printer.list', { scan: false })` lists the printers
      already paired in Android Settings.
- [ ] `await PosNative.request('printer.list', { scan: true })` takes about 8
      seconds and also lists nearby unpaired printers.
- [ ] `await PosNative.request('printer.select', { id: '<an id from the list>' })`
      returns a status that becomes `connected` (the printer's light changes).
- [ ] Print a test slip. In the Console run this (the text is wrapped in the
      printer's start and cut commands; the escapes are written out so you do
      not type hidden characters):

      ```js
      const bytes = new Uint8Array([0x1b, 0x40, ...new TextEncoder().encode('Hello from POS\n\n\n'), 0x1d, 0x56, 0x42, 0x00]);
      await PosNative.request('printer.print', { data: btoa(String.fromCharCode(...bytes)) });
      ```

      - [ ] The printer prints "Hello from POS" and cuts. The call returns `{ bytes: N }`.
- [ ] Ask for something that must fail: `await PosNative.request('printer.print', { data: '!!' })`
      is rejected with code `BAD_REQUEST` and a plain-English message.
- [ ] Switch the printer off, then repeat the print: it is rejected with
      `NOT_CONNECTED` (or `WRITE_FAILED`) and a plain-English message.

## Part B. Release build with the real POS (about 1 hour plus the 30-minute test)

Install the **release** APK (`app-arm64-v8a-release.apk` on almost every phone;
`app-armeabi-v7a-release.apk` only on an old 32-bit phone). Use a fresh install
(uninstall any older one). This build is shrunk and obfuscated (R8), which the
debug build of Part A is not: if anything works in Part A but fails here, note
exactly what — it points at a shrinker rule, not at the printer.

### Start-up and address

- [ ] First start shows the **POS address** screen.
- [ ] Typing nothing and pressing **Open POS** shows a clear error.
- [ ] `http://example.com` is refused with a plain message; `ftp://x` is refused.
- [ ] A wrong but valid address (for example `https://does-not-exist.example.com`)
      shows **Could not open the POS** with **Try again** and **Change address**.
- [ ] **Change address** returns to the address screen with the old address filled in.
- [ ] The real POS address opens the POS login page. Close and reopen the app:
      it goes straight to the POS (no address screen).
- [ ] If your POS is on a local network: `http://192.168.x.x:PORT` also opens.

### Navigation and back button

- [ ] A link to another website (for example a help link) opens the phone's
      browser, not inside the app.
- [ ] Back goes through the POS pages. On the first page, Back sends the app to
      the home screen **without closing it** (reopen it from recent apps: you are
      still logged in).
- [ ] Rotate the screen and open the keyboard in a text field: the field stays
      visible and nothing is cut off.

### Printer setup (use the printer icon in the POS)

- [ ] The printer panel shows the paired Bluetooth printers. Pick one: the dot
      turns green and **Print test slip** prints and cuts.
- [ ] **Find printers** takes about 8 seconds and shows an unpaired printer.
      Selecting it asks for the pairing PIN (usually `0000` or `1234`); after that it connects.
- [ ] Network printer: enter the printer's IP address and port `9100`; it
      connects and prints a test slip.
- [ ] USB printer (phone with a USB OTG cable): plugging it in shows the Android
      permission prompt; after allowing, it connects and prints.
- [ ] Turn Bluetooth off in Android: the POS shows a "Bluetooth is off" state
      with a button; the button turns it on and the printer reconnects by itself.
- [ ] Deny the Bluetooth permission once: the POS explains what to do. Allow it
      later and it works.
- [ ] Print a real order slip, a KOT and a bill. Layout and cut look right on
      both 58 mm and 80 mm paper settings.
- [ ] Long bill (15 or more items) on every printer type you have. On a
      **Bluetooth LE only** printer note whether it finishes; if it stops halfway,
      that printer is too slow over Bluetooth LE — use its classic Bluetooth, USB
      or network connection instead, and tell the developer the printer model.
- [ ] Network printer: always enter the **IP address** (for example
      `192.168.1.50`), not a name. If you test a name too, note whether it connects.
- [ ] Network printer: switch the printer off **while** a slip is printing, then
      on again. Note whether that slip came out, came out twice, or was lost.
- [ ] Android 11 or older tablet only: switch **Location** off in Android, then tap
      **Find printers**: the POS says to turn on Location. Switch it on: the scan works.

### Printing in the background

- [ ] Turn on **Print all slips on this device**. A **Printing is on** notification
      appears, and Android asks once to let the app run without battery limits
      (choose **Allow**).
- [ ] **30-minute screen-off test.** With a connected printer: press Home, then
      switch the screen off and leave the device for 30 minutes (on charge or
      not: do it both ways on different days). From another device, place 3
      test orders about 10 minutes apart. Write down for each order how long
      after placing it the slip printed.
      - [ ] Every order printed **exactly once** (no missing slip, no duplicate).
      - [ ] Latency noted: ________ , ________ , ________ seconds.
- [ ] Switch the printer off, place two orders: nothing prints, the dot turns
      red and the orders stay waiting. Switch the printer on: within about 30
      seconds it reconnects and each waiting order prints **once**.
- [ ] Swipe the app away from recent apps: the notification disappears. Open the
      app again: printing is switched back on by itself.
- [ ] Force stop the app in Android Settings, then open it again: it comes back
      to the POS and reconnects to the saved printer.
- [ ] Restart the device. The app does **not** start by itself (by design). Open it
      once: it reconnects and prints again.

### Recovery

- [ ] Debug build only: open the dev menu and choose **Crash web page**. The POS
      reloads by itself and printing still works afterwards.
- [ ] Debug build only, background: with **Print all slips on this device** on,
      choose **Crash web page** and press Home at once. Within about a minute a
      **Printing stopped — tap to open the app** notification appears. Tap it: the
      POS opens, the normal **Printing is on** notification comes back, and orders print.
- [ ] Start the app with Wi-Fi off: the error screen shows and says it is trying
      again. Switch Wi-Fi on: the POS opens by itself within about 15 seconds.
- [ ] Turn Wi-Fi off and on during use: the POS recovers without reinstalling.
- [ ] **Change POS address** (printer panel, More options) returns to the address screen.

## Part C. The POS in a browser (no app needed)

Chrome or Edge on a PC, or Chrome on an Android phone (Android Chrome 138 or newer).
Pair the Bluetooth printer in the device's own Bluetooth settings first.

- [ ] Printer icon (top right) → **Connect printer** → the browser's list shows the
      paired printer → pick it → **Print test slip** prints and cuts; the dot is green.
- [ ] **Connect printer**, then close the list without picking: the card says
      "Did not see your printer?…" and what to do next.
- [ ] Reload the page: the dot turns green again by itself, or after one
      **Reconnect** tap (a browser security rule).
- [ ] A printer that needs no pairing (often a small one): **Search nearby printers** →
      pick it → test slip.
      After a reload it always needs one **Reconnect** tap (browser rule).
- [ ] Open the POS in a second tab on the same device: that tab says the printer is
      in use in another tab, and the first tab keeps printing.
- [ ] Windows desktop app (PC clients): with a printer chosen the dot is green as
      before; choose **Not chosen — slips will not print** in the picker: the dot
      turns red with "No printer chosen"; choose the printer again: green.

## Stations and printers checks (Phase 2, added 2026-10-05)

Needs the Phase 2 APK on a phone or tablet, the POS with Phase 2 (the go-live run: the Worker first, then the web,
then every POS screen reloaded), two Bluetooth printers paired with that phone or tablet, one network (LAN) printer
with a fixed address (a DHCP reservation in the router), and a second device to order from. Do the Phase 1 checks
above first. The Windows counter PC has its own section below.

- [ ] **The new APK over the old one.** On a device that already prints, install the Phase 2 APK over the installed
      one (no uninstall): it opens on the POS with **Printer connected** at once, no re-pairing, and **Send to
      Kitchen** prints one KOT exactly as before. Do this once before the web update reaches that device too: the
      new APK prints the old POS's slips exactly as before.
- [ ] **Set up printers.** On the device that prints today: Printer setup → **Set up printers**. Printer 1 is that
      device's printer with Bill, Full KOT copy, Notices and End of day; **Send to Kitchen** still prints one KOT,
      exactly as before.
- [ ] **A LAN kitchen printer.** **Add printer** → Network (LAN) → its address and port, printed by the phone or
      tablet → **Kitchen KOTs**. A round with food: the KITCHEN slip at the LAN printer and the full copy (ALL
      STATIONS) at Printer 1, once each.
- [ ] **Two Bluetooth printers on one phone or tablet.** Printer panel → **Other printers on this device** → **Add
      another printer** → the second paired printer. Add a station **Bar**, put the drinks category on it, then
      **Add printer** → Device printer → that printer → **Bar KOTs**, 58 mm if it is a 58 mm printer. A round with
      food and drinks: the BAR slip on the second Bluetooth printer, the full copy on Printer 1, each as wide as its
      own roll, nothing on the wrong printer. Note the phone model (two Bluetooth links at once depend on the phone).
- [ ] **A station with no printer.** Add a station **Desserts** with no printer and put the desserts category on it:
      a dessert round prints only inside the full copy at Printer 1 (no slip of its own).
- [ ] **Copies.** Set Printer 1's bill copies to 2: **Pay Now** prints the bill twice, back to back; nothing else
      prints twice.
- [ ] **A deleted station.** Delete **Desserts** while the desserts category uses it: the category goes back to the
      default station, and the next dessert round prints as a kitchen item.
- [ ] **A printer switched off in the setup.** Switch the bar printer off in Printer setup: the next drinks round
      prints only in the full copy. Switch it on again: BAR slips print again.
- [ ] **A printer powered off.** Power the second Bluetooth printer off and send a round with drinks: the full copy
      prints at once; the BAR slip waits in the printer panel under **Waiting for the printer**, naming the bar
      printer; other slips keep printing. Power it on: the BAR slip prints **once, without a banner**.
- [ ] **The notification** (simple mode, **Print all slips on this device**, notifications allowed for the POS app,
      two printers in the app): "Printing is on — 2 printers"; with one printer off, "Printing is on — ‹name› not
      connected".
- [ ] **An order lost in the network on the device that prints it.** On the tablet that prints its own KOTs, switch
      Wi-Fi off just as you tap **Send to Kitchen**, then on again: the POS sends it again by itself (or offers Send
      again); the KOT prints **once, without a banner**, never twice. (A device killed mid-print gives one
      **REPRINT** copy, as in Phase 1.)
- [ ] **A printer Printer setup prints through this device.** In the printer panel it shows "Printer setup prints
      slips here: to remove it, change or delete that printer in Printer setup first." instead of **Remove** (as this
      device's printer and under Other printers). **Change printer** on it adds the new printer and keeps the old one
      under Other printers, and the old one's slips still print.
- [ ] **A network printer moved to a new address.** Change the LAN printer's address in Printer setup: the tablet
      adds the new address to Other printers on this device by itself, prints the next kitchen slip there, and drops
      the old address from the list. If the old address was this device's own printer (the one at the top), the panel
      now offers **Remove** on it: remove it there, and the new address becomes this device's printer.
- [ ] **Two USB printers asking for permission at once** (a USB hub with two printers, plugged in together): allow
      each prompt; both printers connect. If only one prompt shows, tap **Reconnect** on the other and note it.

## Several printers on one Windows PC (Phase 2, added 2026-10-05)

Needs the Windows app 1.11.0 or later on the counter PC, two thermal printers installed in Windows, and the
POS with Phase 2. An older Windows app prints one printer, the one chosen for the PC: the printer form says so.

- [ ] Printer setup in the Windows app: **Set up printers** makes Printer 1 from the printer chosen for this PC,
      on the cafe's KOT paper. **Send to Kitchen**: one KOT on it, exactly as before.
- [ ] Add a station **Bar** and put the drinks category on it. **Add printer** → **Device printer** → choose the
      second printer under **Windows printer** → tick **Bar KOTs** → save. The same Windows printer as Printer 1 is
      refused: "… already prints on that Windows printer."
- [ ] A round with food and drinks: the full copy (ALL STATIONS) at Printer 1 and the BAR slip at the second printer,
      once each, each as wide as its own roll (try one 58 mm and one 80 mm printer if you have them).
- [ ] **Test print** on each printer: each slip comes out of its own printer.
- [ ] Rename the second printer in Windows (Settings → Printers): its next slip waits under the printer icon with
      "That printer is not on this PC…", while Printer 1 keeps printing at once. Edit the printer in Printer setup,
      choose it again under **Windows printer**: the waiting slip prints once.
- [ ] An unplugged printer: Windows keeps its slips in its own print queue and prints them when it is back; the POS
      cannot see that queue (spec §9.6), so check the paper.

## Result

Date: ________  Device and Android version: ________________________
Printer model(s): ________________________  Build: ________
Passed / failed lines and notes:
