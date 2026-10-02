# Device test checklist: POS Software Android app

Run this on a **real phone or tablet** and a **real receipt printer** before
giving an APK to a client. Tick each line; write down anything odd.

Things to have: the app installed (see README), the POS web app deployed with
the printing update, a thermal printer (ideally one Bluetooth and one with a
network port), a PC with Chrome for the debug part.

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

## Result

Date: ________  Device and Android version: ________________________
Printer model(s): ________________________  Build: ________
Passed / failed lines and notes:
