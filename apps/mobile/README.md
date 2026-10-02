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

### 1. Create the signing key once, BEFORE the first client install

Android only lets an app update itself if the new APK is signed with the same
key. If you ship a client a debug-signed APK and later switch to a real key,
that client has to **uninstall** the app first (their saved address and printer
choice go with it). Create the key before anyone installs.

Create a keystore outside the repository (keep two backups somewhere safe):

```powershell
keytool -genkeypair -v -keystore C:\keys\pos-release.keystore -alias pos -keyalg RSA -keysize 2048 -validity 10000
```

**If you lose this key or its passwords, every client must uninstall the app
and install a freshly signed one.** Never commit the keystore, and never put the
passwords in the repository.

Add four lines to `%USERPROFILE%\.gradle\gradle.properties` (this file is on
your PC only):

```properties
POS_RELEASE_STORE_FILE=C:/keys/pos-release.keystore
POS_RELEASE_STORE_PASSWORD=your-store-password
POS_RELEASE_KEY_ALIAS=pos
POS_RELEASE_KEY_PASSWORD=your-key-password
```

Without these four properties the release build is signed with the debug key
(fine for your own testing, not for clients).

### 2. Build and install

```powershell
cd android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
```

The APK is written to
`android\app\build\outputs\apk\release\app-release.apk`. Install it on a
connected device with:

```powershell
adb install -r app\build\outputs\apk\release\app-release.apk
```

Or copy the file to the device and open it there (allow "install unknown
apps" for the file manager). The APK is handed to clients directly; it is not
uploaded anywhere.

Before you hand the APK to a client, run the checks in
[TEST-CHECKLIST.md](./TEST-CHECKLIST.md) on a real device.

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
  **Change POS address** (under Advanced).
- When you turn on "Print all slips on this device", the app shows a
  **Printing is on** notification and keeps running with the screen off. Android
  may also ask once to let the app run without battery limits: choose **Allow**.
- The app does not start by itself after the phone restarts. Open it once.

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
