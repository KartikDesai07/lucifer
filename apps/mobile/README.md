# POS Software: Android app

A thin Android app that opens your POS web app from one saved address and lets
it print slips to a Bluetooth, network (Wi-Fi/LAN) or USB receipt printer. The
slip layout always comes from the web app; this app only moves the bytes to the
printer and keeps printing alive while the screen is off.

This folder is **outside the npm workspace** (it has its own `package.json` and
`package-lock.json`, like `apps/desktop`). Always run npm commands from
`apps/mobile`, never from the repository root.

Built with React Native 0.87.1 and `react-native-webview` 14.0.1. Android only
for now; the `ios/` folder is the untouched template.

## What you need installed

| Tool | Version |
|---|---|
| Node.js | 22.13 or newer |
| JDK | 17 |
| Android Studio | any current version, with the SDK pieces below |
| Android SDK Platform | 37 |
| Android SDK Build-Tools | 37.0.0 |
| NDK (Side by side) | 27.1.12297006 |
| CMake | the version Android Studio offers |
| Android SDK Platform-Tools | latest (gives you `adb`) |

These match `android/build.gradle` (compileSdk 37, build-tools 37.0.0, NDK
27.1.12297006, Kotlin 2.2.0, minSdk 24, targetSdk 36). Set `ANDROID_HOME` to the
SDK folder and `JAVA_HOME` to the JDK 17 folder.

### Windows: use a short folder

The new-architecture build creates very long file paths. If the repository is
deep inside another folder the build fails with "path too long".

1. Clone or copy the repository to a short path such as `C:\pos`.
2. Run once: `git config --global core.longpaths true`.

## First-time setup

```powershell
cd apps\mobile
npm ci
```

Use `npm ci` (not `npm install`) so you get exactly the versions in
`package-lock.json`.

## Run a debug build on a phone or tablet

1. Turn on **Developer options** and **USB debugging** on the device, connect
   it with a cable, and check `adb devices` lists it.
2. In one terminal start Metro: `npm start`
3. In another terminal install and launch the app:

```powershell
npx react-native run-android --active-arch-only
```

Call `npx` directly here. `npm run android -- --flag` loses the flags on Windows.

## Build the release APK

### 1. The signing key

Android only lets an app update itself if the new APK is signed with the same
key. The app's private key was made on 2026-10-12 for 2.0.0. Every APK before
it was signed with React Native's public debug key, so each device moves to
2.0.0 once by hand (docs/GO-LIVE-CHECKLIST.md, "Existing cafes: the native
apps 2.0 release"). After that, updates arrive by themselves.

- Key file: `D:\kd\pos-signing\sandbee-pos-release.jks` (PKCS12, RSA 4096,
  alias `sandbee-pos`, valid 40 years).
- Its passwords: four lines in `D:\gradle-home\gradle.properties` on the build
  PC (Gradle's user home on this PC; `%USERPROFILE%\.gradle\gradle.properties`
  on a PC without `GRADLE_USER_HOME`):

```properties
POS_RELEASE_STORE_FILE=D:/kd/pos-signing/sandbee-pos-release.jks
POS_RELEASE_STORE_PASSWORD=<the store password>
POS_RELEASE_KEY_ALIAS=sandbee-pos
POS_RELEASE_KEY_PASSWORD=<the same password: a PKCS12 key uses the store's>
```

**Keep two backups of the key file and these four lines, in two safe places.
If they are lost, no update can ever be signed again, and every device must
uninstall the app and install a newly signed one.** Never commit the key or put
the passwords in the repository.

A release build stops when these four properties are missing or the key file
is not there. It never signs with the debug key.

### 2. Build and install

```powershell
cd android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
```

Use exactly this command: the one-APK-per-phone split switches on only for task
names with "release" in them, and both ARM types must be built for both APKs.

For the emulator, `.\gradlew.bat aR -PreactNativeArchitectures=x86_64` builds one
x86_64 `app-release.apk`: `aR` (short for assembleRelease) has no "release" in
its name, so the split stays off. Put no other task with "release" in its name
on that command line, or the split turns on and no x86_64 APK comes out.

A release build always compiles the app's Kotlin in full (`app/build.gradle`):
an incremental release compile once kept a stale class, and that APK crashed on
its printer thread although every test passed.

The release build is made small and hard to read back:

- **One APK per phone CPU type** in `android\app\build\outputs\apk\release\`:
  `app-arm64-v8a-release.apk` fits nearly every phone sold since about 2017;
  `app-armeabi-v7a-release.apk` is only for old 32-bit phones. Not sure? With
  the phone connected, `adb shell getprop ro.product.cpu.abi` prints which one.
- **R8** shrinks and obfuscates the app code (classes and methods get short,
  meaningless names), unused resources are dropped, and native libraries are
  stored compressed.
- The JavaScript ships as **Hermes bytecode**, not readable source.

No app can be made impossible to take apart; this one also holds no secrets
(the POS address is typed in on the phone, and the bridge key is made fresh
every time the app starts).

Debug builds skip R8, so always test the RELEASE APK on a real phone before
giving it to a client. Install it on a connected device with:

```powershell
adb install -r app\build\outputs\apk\release\app-arm64-v8a-release.apk
```

Or copy the file to the device and open it there (allow "install unknown
apps" for the file manager). A device's first 2.0.0 install is handed over
directly; later versions reach it from files.sandbee.in ("Release a new version
(both apps)" below).

Before you hand the APK to a client, run the checks in
[TEST-CHECKLIST.md](./TEST-CHECKLIST.md) on a real device.

## Release a new version (both apps)

The POS app and the Windows app share one version (2.0.0 was the first managed
release), and devices update themselves from `https://files.sandbee.in/pos/`
(the owner's bucket). Nothing is uploaded from this PC: the owner uploads the
release folder by hand.

1. **Raise the version in both places, the same:** `posVersionRelease` in
   `android/app/build.gradle` and `version` in `apps/desktop/package.json` (a
   test pins that they are equal). Only x.y.z, minor and patch below 100, never
   lower than the last release, and no `-rc` part: electron-updater's feed would
   offer a prerelease to every PC, so the packaging refuses one.
2. **Build the APK pair** (the private key and the real update base are the
   defaults; a release never passes `-PposUpdateBase` or the minute settings):
   in `android`, `.\gradlew.bat :app:compileReleaseKotlin --rerun`, then
   `.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a`.
3. **Build the Windows installer:** in `apps/desktop`, `npm run dist` (it
   writes `dist\` and publishes nothing).
4. **Package them** from the repository root, on one line. The script builds
   nothing; it checks every file and writes
   `D:\kd\pos-apk-release\Sandbee-POS-<version>\`:
   `node scripts/release-native.mjs --arm64 apps\mobile\android\app\build\outputs\apk\release\app-arm64-v8a-release.apk --armv7 apps\mobile\android\app\build\outputs\apk\release\app-armeabi-v7a-release.apk --windows apps\desktop\dist --notes "<one short English sentence for the update card>"`.
   It refuses, before writing anything, an APK not signed with the private key,
   a debug build, another package, version or CPU type, a test update base or
   shortened times, an installer built for a test feed or from another build, a
   version with a prerelease part or lower than one already packaged, notes
   over 300 characters, and a release folder that already exists. It writes
   into `Sandbee-POS-<version>.partial` and renames it when it is complete.
5. **The owner uploads** the folder as its `UPLOAD-STEPS.txt` says: the APKs,
   the installer and its blockmap first, `latest.json` and `latest.yml` last,
   then opens `https://files.sandbee.in/pos/android/latest.json` from a phone.

Never raise `minSdkVersion` while older devices are in use: the manifest names no
minimum Android version, so such a device would download every new version and
fail to install it (or add a `minSdk` field to a later manifest schema first).

## Checks (no device needed)

```powershell
npx tsc --noEmit        # types
npm run lint            # code style
npm test                # node:test suites in src/
npm run test:app        # Jest smoke test of the app shell
```

## How it behaves

- **First start** asks for the POS address. `https://` addresses always work.
  `http://` only works for this device (`localhost`) and addresses on your own
  network (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`). Enter the **final**
  address: if the site redirects to a different address, that page opens in the
  phone's browser instead of in the app.
- The app stays on that one address. Links to other websites open in the phone's
  browser. Everything else is blocked.
- **Back** goes back in the POS; at the first page it sends the app to the
  background (it never closes, because closing would stop printing).
- To use a different address, open the printer panel in the POS and choose
  **Change POS address** (under More options).
- When you turn on "Print all slips on this device", or Printer setup names this
  device for a printer, the app shows a **Printing is on** notification and
  keeps running with the screen off. While it is in front its screen stays on
  (the power button still turns it off; printing goes on). Android may also ask
  once to let the app run without battery limits: choose **Allow**. Close the
  app on printing devices at closing time: its notice **POS printing is off.
  Tap to start.** then shows, as expected; tap it when you open.
- The app does not start by itself after the phone restarts. A device that was
  printing shows **POS printing is off. Tap to start.** after a restart, an app
  update, or when Android stopped the app: tap it, and the app prints again.
  Android 13 and newer ask once for notifications when printing first starts:
  choose **Allow**, or that notice cannot show.

## Where things are

| Path | What |
|---|---|
| `App.tsx` | start-up: saved address -> POS, or ask for the address |
| `src/url.ts` | address rules and the navigation lock |
| `src/bridge/` | the contract between the POS page and the app (`protocol.ts` is mirrored by `apps/cafe/lib/printer/native-bridge-protocol.ts`) |
| `src/native/` | typed access to the Kotlin printer module and the permission prompts |
| `src/screens/` | address screen, POS screen, error screen |
| `android/app/src/main/java/com/possoftware/pos/printer/` | the Kotlin printer module and background service |

iOS is not supported yet: it needs its own printer module. The contract already
carries a `platform` field for that day.
