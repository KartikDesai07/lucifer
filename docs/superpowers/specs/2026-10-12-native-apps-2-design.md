# Sandbee native apps 2.0: updates from files.sandbee.in, a private Android signing key, and the Windows address window

Status: design approved in conversation with the owner on 2026-10-12 (brainstorming, section by section). This spec is
the written form for the owner's review; the implementation plan follows it.

## 1. Goal

Both native apps (the Android POS app `com.possoftware.pos` and the Windows app "POS Software by sandbee") update
themselves from release files the owner hosts at `https://files.sandbee.in/pos/…`, without ever disturbing a cafe's
work. The release that brings this, **2.0.0**, also gives the Android app a private signing key and the Sandbee launcher
icon, and gives the Windows app an address window that matches the Android start screen and accepts a bare workspace name.

## 2. The owner's decisions (2026-10-12)

| # | Decision |
|---|---|
| D1 | Approach A: each app has its own updater and reads static files on `files.sandbee.in`. No cafe's Vercel, Atlas or Worker is involved. |
| D2 | Normal update: the app downloads the update in the background and offers a one-tap install when the app is opened (Android); the Windows app downloads in the background and installs when the app is closed. |
| D3 | **Never block.** No force update, no blocking screen, no install without a tap on Android, no automatic restart of a running Windows app. "Show that an update has come, once, when the app is opened; nothing else." Nobody's work may be affected. |
| D4 | The Android app moves to a **private signing key now** (the current key is React Native's public debug key). One manual reinstall per printing device is accepted. |
| D5 | The owner uploads every release to S3 **by hand**; Claude builds the files and the manifests into a local release folder and never uploads anything. |
| D6 | Files are served from the owner's domain: `files.sandbee.in/{product}/…` (POS now; future products under their own prefix). The S3 bucket and the domain are set up after the apps are ready, step by step with the owner. |
| D7 | The Windows address window gets the Android start screen's design and rules, including a bare workspace name. |
| D8 | The Windows install step of the updater may be tested on this PC (per-user, a test folder, uninstalled afterwards). |
| D9 | The launcher icon is the Sandbee mark on the Windows app's red (branch `fix/android-app-icon`, `57f93be`), part of 2.0.0. |

## 3. Constraints

- Free-tier rule: no new request to any cafe's free accounts. The update traffic goes to the owner's `files.sandbee.in`
  only. The address window's one health check (section 9) is made once, when an address is typed.
- Never disturb service (D3): no modal during work, no restart of a running Windows app, the Android print service keeps
  running while an update downloads, and an install only ever starts from a tap (Android) or an app quit (Windows).
- Integrity: a downloaded file is used only when its hash equals the manifest's (SHA-256 on Android, SHA-512 by
  electron-updater on Windows). Android additionally refuses an APK not signed by the installed app's key.
- Branch work only; merge into `main` only with the owner's OK; Claude never deploys, uploads or releases.
- Old and new mix: a 1.x app never updates itself (it has no updater); it is moved to 2.0.0 by hand once.

## 4. Release files and manifests

Base URL baked into both apps: `https://files.sandbee.in/pos`. A test build may set another base (section 11); the
release packaging refuses any build whose base is not the default.

```
files.sandbee.in/pos/android/latest.json
files.sandbee.in/pos/android/Sandbee-POS-<version>-arm64-v8a.apk
files.sandbee.in/pos/android/Sandbee-POS-<version>-armeabi-v7a.apk
files.sandbee.in/pos/windows/latest.yml                      (written by electron-builder)
files.sandbee.in/pos/windows/POS-Software-Setup-<version>.exe
files.sandbee.in/pos/windows/POS-Software-Setup-<version>.exe.blockmap
```

`android/latest.json` (all fields required unless marked):

```json
{
  "schema": 1,
  "package": "com.possoftware.pos",
  "version": "2.1.0",
  "versionCode": 20100,
  "released": "2026-11-02",
  "notes": "Short English text shown on the update card (optional, at most 300 characters).",
  "apks": {
    "arm64-v8a": { "file": "Sandbee-POS-2.1.0-arm64-v8a.apk", "sha256": "<64 hex>", "size": 7320758 },
    "armeabi-v7a": { "file": "Sandbee-POS-2.1.0-armeabi-v7a.apk", "sha256": "<64 hex>", "size": 6728592 }
  }
}
```

The app accepts a manifest only when: `schema` is 1, `package` equals its own, `versionCode` is an integer greater than
its own, `version` matches `^\d+\.\d+\.\d+$`, the APK for one of the device's `Build.SUPPORTED_ABIS` exists, `file` is a
plain file name (no `/`, `\`, `..`, scheme), `sha256` is 64 hex characters and `size` is a positive integer of at most
100 MB. The APK URL is always `<base>/android/<file>` (never a URL from the manifest). Anything else is ignored silently.

## 5. Versioning

- One version for both apps. 2.0.0 is the first managed release (the Windows app is 1.12.0 today; the Android app has
  versionName 1.0 and versionCode 1).
- Android `versionCode = major × 10000 + minor × 100 + patch` (2.0.0 → 20000; minor and patch below 100), set from one
  place in `app/build.gradle` with `versionName`; Windows `package.json` `version`. A test pins that both carry the same
  version.
- The updaters only move up: a lower or equal version is never offered. A bad release is fixed by a newer one.

## 6. Android updater

### 6.1 Units (Kotlin, `com.possoftware.pos.update`; each pure part JVM-tested like `PageWatch`)

| Unit | Does | Depends on |
|---|---|---|
| `UpdateManifest` (pure) | Parses and validates `latest.json` (section 4) for a given installed versionCode, package and ABI list; returns the chosen APK or a reason it was ignored. | nothing |
| `UpdateSchedule` (pure) | Decides when to check (an app open, at most once per 12 hours) and when to show the card (an app open, the APK verified, not already shown in this open). | a clock |
| `UpdateStore` | Keeps, in the app's private preferences: last check time, the downloaded version, its file and hash, the last version a card was shown for and when. | SharedPreferences |
| `UpdateDownloader` | Downloads `<base>/android/<file>` over HTTPS into `filesDir/updates/` (a `.part` file renamed when complete), checks size and SHA-256, deletes anything else in that folder. | HttpURLConnection |
| `UpdateInstaller` | Starts a `PackageInstaller` session for the verified file; on Android 8+ first checks `canRequestPackageInstalls()` and, if not allowed, opens the "Install unknown apps" setting for this app; reports the session's result. | PackageInstaller |
| `UpdateModule` (React Native bridge) | Exposes `status()` (the verified update, if any, with version and notes), `install()`, `later()`. | the units above |
| `UpdateCard` (React Native) | The card shown on an app open (section 6.3). | `UpdateModule` |

### 6.2 Flow

1. **App open** = `MainActivity` created (cold start) or resumed after at least 30 minutes in the background. On an app
   open, if the last check is older than 12 hours, the app fetches `<base>/android/latest.json` (10 s timeout) on a
   background thread. (12 hours, not 24: a cafe that opens the app a little earlier each morning still checks daily.)
2. A valid, newer manifest whose APK is not already downloaded starts the download (any network; a few MB). A failed or
   mismatched download is deleted and retried at the next check.
3. When a verified APK is ready and the app is opened (this open or a later one), the card shows once for that open.
4. **Install** starts the installer (one tap in Android's dialog). The update ends the running app, as any app update
   does; Android's dialog then offers **Open**, and a device that prints gets Session 3D's "POS printing is off. Tap to
   start." notice (`MY_PACKAGE_REPLACED`), so printing resumes when the app is opened. Because the card appears only at
   an app open, this happens before work, never in the middle of it.
5. **Later** hides the card for this open; the next app open shows it again. Nothing else ever reminds.
6. On the next start with the new version the app deletes `filesDir/updates/`.

### 6.3 The card

A sheet over the POS (the app's own React Native layer, not the web page), only on an app open: the Sandbee icon,
"Update available", "Sandbee POS <version> is ready to install." and the notes, buttons **Install** and **Later**. While a
print job is in progress it waits until the job finishes (never covers an in-flight print). It appears only at an app
open (6.2), never later in a session and never while the app is hidden.

### 6.4 Permissions

`REQUEST_INSTALL_PACKAGES` in the manifest (sideloaded app; no store policy applies). No storage permission (private
`filesDir`). The first install asks the user once to allow installs from Sandbee POS; the card explains it in one line.

## 7. Windows updater

- `electron-updater` (the same major as `electron-builder` 26) with the generic provider at `<base>/windows/`.
  `autoDownload: true`, `autoInstallOnAppQuit: true`, `allowDowngrade: false`, `allowPrerelease: false` (the generic
  provider ignores the last one, so the release packaging refuses a version with a prerelease part: the N3 gate).
- Checks one minute after start and every 24 hours. Errors (no network, missing file) are logged to the app's log only.
- On `update-downloaded`: one Windows notification "POS Software <version> is ready. It installs when you close the
  app.", and a tray menu item **Restart to update** (calls `quitAndInstall` after the same quit path the tray's Quit
  uses). No dialog, no automatic restart.
- The install runs on quit: NSIS per-user, silent, keeps the desktop shortcut, the saved address and printers.
- `build.publish` gets the generic provider so electron-builder writes `latest.yml` and the blockmap; the `dist` script
  keeps `--publish never` (nothing is uploaded by the build).

## 8. Android signing key and the move to 2.0.0

- A new RSA 4096 keystore, valid for 40 years, at `D:\kd\pos-signing\sandbee-pos-release.jks`, with random passwords
  written into `D:\gradle-home\gradle.properties` as `POS_RELEASE_STORE_FILE`, `POS_RELEASE_STORE_PASSWORD`,
  `POS_RELEASE_KEY_ALIAS`, `POS_RELEASE_KEY_PASSWORD` (the names `app/build.gradle` already reads). Never in the repo,
  never printed.
- A release build refuses to run without them (today it silently falls back to the debug key): the release packaging
  checks the APK's certificate is the private one, and a test pins the guard.
- The owner backs up the keystore and its passwords in two safe places. Without them no update can ever be signed.
- **One-time move, each printing phone or tablet** (a new GO-LIVE section, "Existing cafes: the native apps 2.0
  release"): uninstall the old app, install 2.0.0, open it, type the cafe's name, sign in, set this device's printer, then
  in Admin → Printer setup choose this device again for its printers (its device id is new). The Windows app needs no
  uninstall: 2.0.0 installs over 1.x.

## 9. Windows address window

- **Look** (matches the Android start screen, `UrlScreen.tsx`; colours from its theme): light background `#f5f7fb`, a
  white card, the red Sandbee icon, "Connect to your workspace", "Your cafe, orders and printers. All in one place.",
  label "POS address", a field with an icon and a clear button, placeholder "yourcafe or yourcafe.sandbee.in", the info
  box "Your workspace" / "Type your workspace name, or the full address shared by your administrator. We'll remember it
  for next time." (red "Check the address" with the error), a full-width primary **Open POS** button (`#2f6fed`;
  "Connecting…" while checking), Cancel only when opened from "Change POS address…", footer "Windows printers · USB ·
  Wi-Fi / LAN" and "POS Software by sandbee · <version>". Enter submits; Esc cancels when Cancel is shown. Window about
  480 × 640, not resizable.
- **Rules**: the Android app's `normalizePosUrl` exactly (a bare name → `https://<name>.sandbee.in`; a host without a
  scheme gets `https://`; `http://` only for localhost and private IPv4; port range; no credentials), with the same error
  words. A parity test runs one table of inputs through both apps' functions and requires equal results.
- **Check before saving**: `GET <origin>/api/health` (5 s timeout). 200 with `ok: true` → save and open the POS. A 404 or
  any other answer → stay on the form: "We couldn't find a POS at <host>. Check the name." No answer → "Couldn't reach
  <host>. Check the name and the internet connection." (the owner's words of 2026-10-13: a mistyped workspace name has
  no answer either). One request per typed address, nothing recurring.
- "Change server address…" becomes **"Change POS address…"** everywhere (the menu, the shell, GO-LIVE, DEPLOY.md and the
  runbook pin).

## 10. The release folder and the upload

- Each release: `D:\kd\pos-apk-release\Sandbee-POS-<version>\` with `upload\pos\android\…` and `upload\pos\windows\…`
  laid out exactly as the bucket's keys, `SHA256SUMS.txt` for every file, and `UPLOAD-STEPS.txt`.
- **Upload order**: the APKs, the installer and its blockmap first; `latest.json` and `latest.yml` **last**, so no device
  sees a manifest whose file is not there yet. Cache: the two `latest.*` files short (60 s), the versioned files long.
- A packaging script in the repo (`scripts/release-native.mjs`) builds nothing; it takes the built APKs and installer,
  checks the APK certificate, the versions, the base URL, writes `latest.json`, copies `latest.yml` and the blockmap, and
  writes the folder and the hashes. Building stays the existing commands.
- **Later, with the owner, step by step**: the S3 bucket (block public listing; public read only for `pos/*`), HTTPS on
  `files.sandbee.in` (CloudFront with a free ACM certificate, or Cloudflare in front of S3), the cache headers, and a
  check that `latest.json` loads from a phone. Cost: S3 storage of a few hundred MB (a few rupees a month); downloads
  through CloudFront's always-free tier (1 TB a month).

## 11. Testing

- **Unit (TDD, RED first)**: `UpdateManifest` (every rule of section 4, each rejection), `UpdateSchedule` (app-open
  rules, 12 h, once per open, never while hidden), version compare, ABI choice, SHA-256 check (JUnit); the card's JS
  logic (mobile node tests); the version pin across both apps; the release-key guard; the address normalizer parity
  table and the health-check outcomes (desktop tests); the updater wiring and the tray item (desktop pins).
- **Test builds**: the base URL comes from a build setting (`posUpdateBase` for Gradle, an `extraMetadata` field for
  electron-builder) whose default is `https://files.sandbee.in/pos`; tests use `http://127.0.0.1:<port>/pos` served by a
  scratch fake files server; the packaging script refuses non-default builds.
- **Emulator end to end**: install 2.0.0 (private key) → the fake server announces 2.0.1 → download → card on the next
  open → Install → the app returns as 2.0.1 and prints; "Later"; a wrong hash (no card); no network (nothing); a hidden
  app during the download (no card until an open).
- **Windows end to end on this PC (D8)**: install 2.0.0 per-user into a test folder → 2.0.1 announced → download,
  notification, tray item → quit → installed → reopens as 2.0.1; then uninstall.
- A fresh review on Claude Fable 5.1 at the end; sessions and gates as in the printing phases.

## 12. Out of scope

Force or blocking updates (D3), silent Android installs (impossible without device-owner mode), the Play Store or any
store, Windows code signing (unchanged from today), a web or server change, Telegram, uploading anything (D5).

## 13. Risks

| Risk | Handling |
|---|---|
| The keystore or its passwords are lost | The owner's two backups (section 8); the plan stops until the owner confirms the backup exists. |
| A bad release reaches devices | Never downgrade; publish a fixed higher version; `latest.json` last in the upload order. |
| `files.sandbee.in` down or misconfigured | The apps stay silent and keep working; checks retry at the next open or in 24 h. |
| A device on an old 1.x app | It never updates itself; the one-time move (section 8) is the only way. |
| The card covering work | Only on an app open, waits for an in-flight print, Later is always there. |
