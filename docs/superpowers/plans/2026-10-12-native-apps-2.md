# Sandbee native apps 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both native apps (Android `com.possoftware.pos`, Windows "POS Software by sandbee") update themselves from
`https://files.sandbee.in/pos/…` without ever blocking or interrupting a cafe's work. Release 2.0.0 also brings a private
Android signing key, the Sandbee launcher icon, and a Windows address window that matches the Android start screen and
accepts a bare workspace name.

**Architecture:** Each app has its own updater and reads static files only (spec D1). Android: a 12-hour check at an
"app open", a background download checked by SHA-256, package, version and signer, and a card with Install/Later offered
once per open. Windows: electron-updater's generic provider downloads in the background and installs when the app quits.
A packaging script turns the built APKs and installer into a release folder that the owner uploads by hand.

**Tech Stack:** Kotlin (Android, minSdk 24, JUnit 4 on the JVM), React Native 0.87 + TypeScript (node:test), Gradle
(AGP via the RN plugin), Electron 44 + electron-builder 26.16.0 + electron-updater (generic provider), Node ESM scripts.

**Spec:** `docs/superpowers/specs/2026-10-12-native-apps-2-design.md` (approved by the owner on 2026-10-12). Read it with
this plan; section numbers below (§n) are the spec's.

## How this plan runs

The owner's workflow (one phase per session): four sessions, **N1 → N2 → N3 → N4**, each started from a prompt the
orchestrator gives, each followed by a review gate. **Session N1 is exact below** (code, commands, expected output).
Sessions N2–N4 are task specs with fixed interfaces, test lists and acceptance checks; each is made exact (full code,
pre-validated where possible) at the gate before it, as in printing Phases 2 and 3. A gate may change a later session's
spec; it records why.

| Session | Delivers | Gate before the next |
|---|---|---|
| N1 | One version 2.0.0; the private key + release-key guard; the update base/times as build settings; `UpdateManifest` + `UpdateSchedule` (pure, JUnit) | the owner confirms the key backup; a fresh review of N1; N2 made exact |
| N2 | The Android updater at run time (store, download + checks, installer, native module, the card) + emulator end to end | review; N3 made exact |
| N3 | The Windows address window (Android design, bare name, health check), "Change POS address…", electron-updater + tray + notification, Windows end to end on this PC | review; N4 made exact |
| N4 | `scripts/release-native.mjs`, GO-LIVE + READMEs, full verification, the 2.0.0 release folder, the final Fable 5.1 review | the owner's merge OK |

After N4 (not in this plan): the S3 bucket and HTTPS on `files.sandbee.in`, set up with the owner step by step (§10).

## Global Constraints

- Base URL in both apps: `https://files.sandbee.in/pos`. Keys: `android/latest.json`, `android/Sandbee-POS-<version>-arm64-v8a.apk`, `android/Sandbee-POS-<version>-armeabi-v7a.apk`, `windows/latest.yml`, `windows/POS-Software-Setup-<version>.exe`, `windows/POS-Software-Setup-<version>.exe.blockmap`.
- **Never block (D3):** no force update, no blocking screen, no Android install without a tap, no automatic restart of a running Windows app. "Show that an update has come, once, when the app is opened; nothing else."
- Android **app open** = the first view after the app's process started, or back in view after at least 30 minutes away. A check runs at an open when the last one is at least 12 hours old. The card shows once per open, only for an APK verified before that open; **Later** hides it until the next open.
- Windows: check 1 minute after start and every 24 hours; `autoDownload: true`, `autoInstallOnAppQuit: true`, `allowDowngrade: false`, `allowPrerelease: false`; one notification "POS Software <version> is ready. It installs when you close the app." and a tray item **Restart to update** (also in the Help menu: the N2 gate); no dialog; Start with Windows survives every update (the N2 gate's G-1).
- One version for both apps; 2.0.0 is the first managed release. `versionCode = major × 10000 + minor × 100 + patch` (2.0.0 → 20000; minor and patch below 100). Versions only go up.
- Manifest (§4): `schema` 1, `package` = the app's, `versionCode` an integer greater than the installed one, `version` `x.y.z`, an APK for one of `Build.SUPPORTED_ABIS`, `file` a plain file name, `sha256` 64 hex, `size` a positive integer ≤ 100 MB, `notes` optional ≤ 300 characters, `released` `YYYY-MM-DD`. The APK URL is always `<base>/android/<file>`. Anything else is ignored silently.
- Integrity: Android uses a file only when its SHA-256 and size equal the manifest's **and** the APK's package, versionCode and signing certificate equal the installed app's. Windows: electron-updater's SHA-512.
- Key: `D:\kd\pos-signing\sandbee-pos-release.jks`; its passwords only in `D:\gradle-home\gradle.properties` as `POS_RELEASE_STORE_FILE`, `POS_RELEASE_STORE_PASSWORD`, `POS_RELEASE_KEY_ALIAS`, `POS_RELEASE_KEY_PASSWORD`. **Never printed, never in the repo, a log, a commit, a report or a chat message.**
- Free-tier rule: no new request to any cafe's Vercel, Atlas or Worker. The only cafe request is the Windows address window's one `GET /api/health` per typed address.
- Local only: Claude never uploads, publishes, deploys or uses a connector. The owner uploads by hand; `latest.json` and `latest.yml` go **last**. Claude pushes only when the owner's session prompt says so, and only with the token store (`GIT_TERMINAL_PROMPT=0 git push`).
- Branch `feat/native-apps-2` (it holds the launcher icon fix `57f93be`). Merge into `main` only with the owner's explicit OK.
- Gradle: always `GRADLE_USER_HOME='D:\gradle-home'`. JUnit: `:app:testDebugUnitTest --rerun`. Before a release APK after a Kotlin change: `:app:compileReleaseKotlin --rerun`. Builds longer than a few minutes run in the background (a foreground wait stops at 600 s).
- Emulator (N2, N4): check `adb shell pm path com.possoftware.pos` and whether the app is signed in to the live demo before any write; `adb shell sync` before `adb emu kill`; check C: free space right before a boot (≥ 3 GB, `-no-snapshot -memory 2048`); never kill another program's server; check `:27017` clients before measured runs.
- Windows install on this PC: only in N3's end-to-end test (D8): per-user, a test folder, uninstalled afterwards, the app's user data checked before and removed after.
- App and repo text in English. Messages to the owner in Hinglish.

## Review Focus

1. **A card in the middle of work.** A download that finishes while staff work, an app hidden and shown again within 30 minutes, or a card not taken before the app went away: no card until the next open. Pinned in N1 Task 5 (`aDownloadThatEndsDuringWorkWaitsForTheNextOpen`, `aCardNotTakenBeforeTheAppWentAwayWaitsForTheNextOpen`, `backAfterThirtyMinutesAwayIsAnOpenSoonerIsNot`).
2. **Typing the address on Windows the way people type.** `MyCafe `, `mycafe/pos`, `mycafe.sandbee.in`, `http://192.168.1.20:3000`, a pasted full URL: the same origin, or the same error, as the Android app. Pinned in N3 Task 1 (the parity table runs every input through both apps' functions).
3. **An interrupted or wrong download.** The network drops mid-file, a CDN error page arrives instead of the APK, the file is longer than the manifest says, or the APK is signed by another key: it is never installed, it is deleted, and the next check tries again. Pinned in N2 Task 2 (`UpdateFiles.copyVerified` JUnit cases: truncated, longer, one byte changed) and N2 Task 6 (emulator E2: a wrong hash shows no card and leaves no file).
4. **A release built the wrong way.** No key on the build PC, an `aR` build (no "release" in its task name), a missing key file, a test base or shortened times left in: the build stops or the packaging refuses. Never a debug-key or test-base release. Pinned in N1 Task 2 (pin 28 + three Gradle dry runs), N1 Task 3 (pin 29 + Gradle refusals) and N4 Task 41 (the packaging refuses a non-default base, another signer or mismatched versions).
5. **A manifest that parses but is wrong.** A file name that is a path or an address, numbers written as strings or decimals, a version and versionCode that disagree, an oversized APK, no APK for the device's CPU type: ignored silently, the app unchanged. Pinned in N1 Task 4 (`anApkFileIsAPlainNameNeverAPathOrAnAddress`, `everyTopLevelFieldIsChecked`, `hashAndSizeRules`, `aDeviceWithoutAnApkForItsCpuTypeIsNotOffered`).

## File structure

| File | Session | Responsibility |
|---|---|---|
| `apps/mobile/android/app/build.gradle` | N1 | one version and its versionCode; the release-key guard; the update base and times as build settings; `org.json` for JVM tests |
| `apps/mobile/android/app/src/main/res/raw/pos_update_keep.xml` | N1 | keeps the update settings through the resource shrinker |
| `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateManifest.kt` | N1 | pure: reads and validates `latest.json`, chooses the APK |
| `…/update/UpdateSchedule.kt` | N1 | pure: app opens, the 12-hour check, the card once per open |
| `…/update/UpdateStore.kt`, `UpdateFiles.kt`, `UpdateDownloader.kt`, `ApkCheck.kt`, `UpdateInstaller.kt`, `UpdateInstallReceiver.kt`, `PosUpdateModule.kt`, `PosUpdatePackage.kt` | N2 | the updater at run time |
| `apps/mobile/android/app/src/test/java/com/possoftware/pos/update/*Test.kt` | N1, N2 | JUnit for the pure parts |
| `apps/mobile/src/native/PosUpdate.ts`, `src/update-card.ts` (+ `.test.ts`), `src/screens/UpdateCard.tsx` | N2 | the JS side and the card |
| `apps/mobile/src/mobile-paths.test.ts` | N1, N2 | pins 27–29 (N1) and the updater pins 30–32 (N2) |
| `apps/mobile/__tests__/UpdateCard.test.tsx` | N2 | Jest: the card over the POS screen, Later, the app going away |
| `apps/mobile/README.md` | N1, N4 | the key (N1); building and packaging a release (N4) |
| `apps/desktop/package.json` | N1, N3 | version 2.0.0 (N1); electron-updater and `build.publish` (N3) |
| `apps/desktop/src/pos-url.ts` (+ test), `src/pos-health.ts` (+ test), `assets/url-window.html`, `assets/url-window.js`, `src/url-window.ts`, `src/url-preload.ts` | N3 | the address window |
| `apps/desktop/src/updater.ts`, `src/update-plan.ts` (+ test), `src/menu.ts`, `src/main.ts` | N3 | the Windows updater, tray item and notification |
| `scripts/release-native.mjs` (+ `.test.mjs`), root `package.json` | N4 | the release folder |
| `docs/GO-LIVE-CHECKLIST.md`, `apps/cafe/DEPLOY.md`, `apps/cafe/lib/go-live-runbook.test.ts` | N3, N4 | "Change POS address…" (N3); "Existing cafes: the native apps 2.0 release" (N4) |

---

# Session N1 (exact)

Work in `D:\kd\lucifer` on `feat/native-apps-2`. `$SP` below is the session's scratchpad directory. Bash commands use Git
Bash; the key commands use PowerShell.

### Task 0: Baseline

**Files:** none (Results only).

- [ ] **Step 1: Check the branch and the disks**

Run:
```bash
cd /d/kd/lucifer && git status --short && git branch --show-current && git log --oneline -3 && df -h /c /d
```
Expected: clean, `feat/native-apps-2`, the plan commit on top of `73cb8b0`. Note free space; a release build needs about 3 GB on D:.

- [ ] **Step 2: Record every suite's baseline**

Run (each from its folder):
```bash
cd /d/kd/lucifer/apps/mobile && npm test 2>&1 | tail -8 && npm run typecheck && npm run lint
cd /d/kd/lucifer/apps/desktop && npm test 2>&1 | tail -8 && npm run typecheck && npm run lint
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --rerun --console=plain > "$SP/junit-base.log" 2>&1; tail -3 "$SP/junit-base.log"
cat app/build/test-results/testDebugUnitTest/*.xml | grep -o '<testsuite [^>]*' | sed -E 's/.*tests="([0-9]+)".*failures="([0-9]+)".*errors="([0-9]+)".*/\1 \2 \3/' | awk '{t+=$1; f+=$2; e+=$3} END {print "tests="t" failures="f" errors="e}'
```
Expected: everything passes; record the counts (last known: mobile 143, desktop 205, JUnit 65). Every later "Expected" is
"baseline + the tests this session adds".

### Task 1: One version, 2.0.0, for both apps (§5)

**Files:**
- Modify: `apps/mobile/android/app/build.gradle` (a block after `def jscFlavor …`; `defaultConfig` versionCode/versionName)
- Modify: `apps/desktop/package.json` (`"version"`)
- Test: `apps/mobile/src/mobile-paths.test.ts` (pin 27, appended at the end of the file)

**Interfaces:**
- Produces: Gradle values `posVersionRelease` (the release version string), `posVersionName` (it, or `-PposVersion` for a test build), `posVersionCode` (int). N4's packaging compares the APK's versionName with `apps/desktop/package.json` `version`.

- [ ] **Step 1: Write the failing test.** Append to `apps/mobile/src/mobile-paths.test.ts`:

```ts
// ── pin 27: native apps 2.0, one version for both apps (2026-10-12) ─────────
// spec §5: the Android app and the Windows app carry the same version. Android's versionCode is major × 10000 +
// minor × 100 + patch, computed in build.gradle from the one version string (never a literal), so the updater can
// compare versions as numbers. A test build may override the version with -PposVersion.
const DESKTOP_PKG = join(ROOT, '..', 'desktop', 'package.json');
interface VersionSources {
  gradle: string;
  desktop: string;
}
function versionProblems(s: VersionSources): string[] {
  const out: string[] = [];
  const g = strip(s.gradle);
  const android = /^def posVersionRelease = "(\d{1,3}\.\d{1,2}\.\d{1,2})"$/m.exec(g)?.[1];
  if (android === undefined) {
    out.push('build.gradle has no def posVersionRelease = "x.y.z" (minor and patch below 100)');
  }
  let desktop: string | undefined;
  try {
    desktop = (JSON.parse(s.desktop) as { version?: string }).version;
  } catch {
    out.push('apps/desktop/package.json is not JSON');
  }
  if (android !== undefined && desktop !== android) {
    out.push('the Windows app is ' + String(desktop) + ', the Android app ' + android);
  }
  const need = (needle: string, why: string) => {
    if (!g.includes(needle)) {
      out.push(why);
    }
  };
  need("def posVersionName = (findProperty('posVersion') ?: posVersionRelease).toString()", 'the version is not posVersionRelease (or a test build\'s -PposVersion)');
  need('if (!(posVersionName ==~ /\\d{1,3}\\.\\d{1,2}\\.\\d{1,2}/))', 'a version with minor or patch above 99 is not refused');
  need('def posVersionCode = posVersionParts[0] * 10000 + posVersionParts[1] * 100 + posVersionParts[2]', 'versionCode is not major × 10000 + minor × 100 + patch');
  need('versionCode posVersionCode\n        versionName posVersionName', 'defaultConfig does not use the computed version');
  if (/versionCode\s+\d/.test(g)) {
    out.push('a literal versionCode is back');
  }
  return out;
}
const versionSources = (): VersionSources => ({
  gradle: read(GRADLE_APP),
  desktop: read(DESKTOP_PKG),
});

test('pin 27: one version for both apps, the Android versionCode computed from it', () => {
  assert.deepEqual(versionProblems(versionSources()), []);
});

test('pin 27 mutation: either version drifting or a literal versionCode is caught', () => {
  const base = versionSources();
  const run = (key: keyof VersionSources) => (text: string) => versionProblems({ ...base, [key]: text });
  everyMutationCaught(run('gradle'), base.gradle, [
    ['def posVersionRelease = "2.0.0"', 'def posVersionRelease = "2.0.1"'],
    ['def posVersionRelease = "2.0.0"', 'def posVersionRelease = "2.100.0"'],
    ["(findProperty('posVersion') ?: posVersionRelease)", '(posVersionRelease)'],
    ['\\d{1,3}\\.\\d{1,2}\\.\\d{1,2}/))', '.+/))'],
    ['posVersionParts[1] * 100', 'posVersionParts[1] * 1000'],
    ['versionCode posVersionCode', 'versionCode 20000'],
  ]);
  everyMutationCaught(run('desktop'), base.desktop, [['"version": "2.0.0"', '"version": "2.0.1"']]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin 27" src/mobile-paths.test.ts`
Expected: FAIL. `pin 27` lists "build.gradle has no def posVersionRelease…"; the mutation test fails on "mutation target not found".

- [ ] **Step 3: Implement.** In `apps/mobile/android/app/build.gradle`, after the line
`def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'` insert:

```groovy

/**
 * Native apps 2.0 (spec §5): one version for the Android app and the Windows app (apps/desktop/package.json; a test pins
 * the two equal). The updater compares versionCode = major × 10000 + minor × 100 + patch (2.0.0 → 20000), so minor and
 * patch stay below 100 and a version only ever goes up. A test build may pass -PposVersion=2.0.1; the release packaging
 * (scripts/release-native.mjs) refuses an APK whose version is not the Windows app's.
 */
def posVersionRelease = "2.0.0"
def posVersionName = (findProperty('posVersion') ?: posVersionRelease).toString()
if (!(posVersionName ==~ /\d{1,3}\.\d{1,2}\.\d{1,2}/)) {
    throw new GradleException("posVersion must look like 2.0.0, minor and patch below 100: ${posVersionName}")
}
def posVersionParts = posVersionName.tokenize('.').collect { it as int }
def posVersionCode = posVersionParts[0] * 10000 + posVersionParts[1] * 100 + posVersionParts[2]
```

In `defaultConfig` replace
```groovy
        versionCode 1
        versionName "1.0"
```
with
```groovy
        versionCode posVersionCode
        versionName posVersionName
```

In `apps/desktop/package.json` replace `"version": "1.12.0",` with `"version": "2.0.0",`. (Leave
`apps/desktop/package-lock.json` alone: its root version was already stale at 1.9.0, and npm 11 rewrites the whole file.)

- [ ] **Step 4: Run the pin, the suite and two Gradle configurations**

Run:
```bash
cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin 27" src/mobile-paths.test.ts && npm test 2>&1 | tail -6
cd /d/kd/lucifer/apps/desktop && npm test 2>&1 | tail -4
cd /d/kd/lucifer/apps/mobile/android
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:help --console=plain 2>&1 | grep -E "^BUILD"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:help -PposVersion=2.0 --console=plain 2>&1 | grep -E "posVersion must|^BUILD"
```
Expected: pin 27 PASS (2 tests); mobile = baseline + 2, all pass; desktop = baseline, all pass; `BUILD SUCCESSFUL`; then
`posVersion must look like 2.0.0, minor and patch below 100: 2.0` and `BUILD FAILED`.

- [ ] **Step 5: Commit.** Write the message to `$SP/msg-n1-1.txt`, then `git add apps/mobile/android/app/build.gradle apps/desktop/package.json apps/mobile/src/mobile-paths.test.ts && git commit -F "$SP/msg-n1-1.txt"`:

```text
feat(apps): one version for both native apps, 2.0.0, the first managed release: Android's versionCode is computed from it (major × 10000 + minor × 100 + patch, 2.0.0 → 20000) so the updater can compare versions as numbers, a test build may override it with -PposVersion, and pin 27 keeps the Windows app's package.json version equal (native apps 2.0, Session N1, spec §5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 2: The private key and the release-key guard (§8)

**Files:**
- Create (outside the repo, never committed): `D:\kd\pos-signing\sandbee-pos-release.jks`; four lines in `D:\gradle-home\gradle.properties` (the file does not exist yet)
- Modify: `apps/mobile/android/app/build.gradle` (the signing comment and properties; `buildTypes.release`)
- Modify: `apps/mobile/README.md` (section "### 1. Create the signing key once, BEFORE the first client install")
- Test: `apps/mobile/src/mobile-paths.test.ts` (pin 28)

**Interfaces:**
- Produces: the key's certificate SHA-256 fingerprint, recorded in the Results. N4 puts it into `scripts/release-native.mjs` as `EXPECTED_CERT_SHA256`; N2's `ApkCheck` compares an update's signer with the installed app's, so it needs no constant.

- [ ] **Step 1: Write the failing test.** Append to `apps/mobile/src/mobile-paths.test.ts`:

```ts
// ── pin 28: native apps 2.0, the private release key (2026-10-12) ───────────
// spec §8: a release APK is signed with the app's private key or not built at all. Before 2.0.0 it fell back to React
// Native's public debug key, which anyone can sign with. The guard looks at the task graph (an `aR` build has no
// "release" in its task name), and without the key the release build type has no signing config: unsigned, never
// debug-signed.
function releaseKeyProblems(gradle: string, readme: string): string[] {
  const out: string[] = [];
  const g = strip(gradle);
  const need = (needle: string, why: string) => {
    if (!g.includes(needle)) {
      out.push(why);
    }
  };
  need('signingConfig hasPosReleaseKey ? signingConfigs.release : null', 'a release build without the key falls back to another key');
  need('gradle.taskGraph.whenReady { graph ->', 'the release-key guard does not look at the task graph');
  need("graph.allTasks.any { it.path in [':app:packageRelease', ':app:packageReleaseBundle'] }", 'the guard misses a release APK or bundle');
  need("def posReleaseKeyProps = ['POS_RELEASE_STORE_FILE', 'POS_RELEASE_STORE_PASSWORD', 'POS_RELEASE_KEY_ALIAS', 'POS_RELEASE_KEY_PASSWORD']", 'the guard does not check all four key properties');
  need('throw new GradleException("A release build needs the private Sandbee POS key', 'a release build without the key does not stop');
  need('if (!file(posReleaseStoreFile).isFile())', 'a missing key file is not caught before the build');
  const types = g.slice(Math.max(0, g.indexOf('buildTypes {')));
  const release = /release \{([\s\S]*?)\n {8}\}/.exec(types)?.[1] ?? '';
  if (release === '') {
    out.push('landmark: buildTypes.release not found');
  } else if (release.includes('signingConfigs.debug')) {
    out.push('the release build type can still sign with the debug key');
  }
  if (!readme.includes('A release build stops when these four properties are missing')) {
    out.push('README does not say a release build stops without the key');
  }
  if (readme.includes('the release build is signed with the debug key')) {
    out.push('README still says the release build falls back to the debug key');
  }
  return out;
}

test('pin 28: a release APK is signed with the private key or not built', () => {
  assert.deepEqual(releaseKeyProblems(read(GRADLE_APP), read(join(ROOT, 'README.md'))), []);
});

test('pin 28 mutation: every key-guard needle can fail', () => {
  const gradle = read(GRADLE_APP);
  const readme = read(join(ROOT, 'README.md'));
  everyMutationCaught(s => releaseKeyProblems(s, readme), gradle, [
    ['signingConfigs.release : null', 'signingConfigs.release : signingConfigs.debug'],
    ['gradle.taskGraph.whenReady { graph ->', 'gradle.projectsEvaluated { graph ->'],
    ["':app:packageRelease', ':app:packageReleaseBundle'", "':app:packageReleaseBundle'"],
    ["'POS_RELEASE_KEY_ALIAS', 'POS_RELEASE_KEY_PASSWORD']", "'POS_RELEASE_KEY_ALIAS']"],
    ['throw new GradleException("A release build needs', 'logger.warn("A release build needs'],
    ['if (!file(posReleaseStoreFile).isFile())', 'if (false)'],
  ]);
  everyMutationCaught(s => releaseKeyProblems(gradle, s), readme, [
    ['A release build stops when these four properties are missing', 'A release build may use these four properties'],
  ]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin 28" src/mobile-paths.test.ts`
Expected: FAIL ("a release build without the key falls back to another key", …).

- [ ] **Step 3: Implement the guard.** In `apps/mobile/android/app/build.gradle` replace

```groovy
/**
 * Release signing comes from four Gradle properties (put them in ~/.gradle/gradle.properties, never
 * in the repo): POS_RELEASE_STORE_FILE, POS_RELEASE_STORE_PASSWORD, POS_RELEASE_KEY_ALIAS,
 * POS_RELEASE_KEY_PASSWORD. Without them the release build is signed with the debug key.
 */
def posReleaseStoreFile = findProperty('POS_RELEASE_STORE_FILE')
def hasPosReleaseKey = posReleaseStoreFile != null
```
with
```groovy
/**
 * Release signing comes from four Gradle properties (in D:\gradle-home\gradle.properties on the build PC, never in the
 * repo): POS_RELEASE_STORE_FILE, POS_RELEASE_STORE_PASSWORD, POS_RELEASE_KEY_ALIAS, POS_RELEASE_KEY_PASSWORD.
 *
 * Native apps 2.0 (spec §8): they name the app's private key, and a release APK is signed with it or not built at all.
 * Before 2.0.0 a release fell back to React Native's public debug key, which anyone can sign with, and an installed app
 * only ever updates from APKs signed with its own key. The guard looks at the task graph, so an `aR` build (no
 * "release" in its task name) is caught too; without the key the release build type has no signing config, so a build
 * that somehow slips past the guard comes out unsigned (not installable), never debug-signed.
 */
def posReleaseStoreFile = findProperty('POS_RELEASE_STORE_FILE')
def hasPosReleaseKey = posReleaseStoreFile != null
def posReleaseKeyProps = ['POS_RELEASE_STORE_FILE', 'POS_RELEASE_STORE_PASSWORD', 'POS_RELEASE_KEY_ALIAS', 'POS_RELEASE_KEY_PASSWORD']
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.path in [':app:packageRelease', ':app:packageReleaseBundle'] }) {
        def missing = posReleaseKeyProps.findAll { !findProperty(it) }
        if (!missing.isEmpty()) {
            throw new GradleException("A release build needs the private Sandbee POS key: set ${missing.join(', ')} in D:\\gradle-home\\gradle.properties (apps/mobile/README.md). It never signs with the debug key.")
        }
        if (!file(posReleaseStoreFile).isFile()) {
            throw new GradleException("The release key file is missing: ${posReleaseStoreFile}")
        }
    }
}
```

In `buildTypes` replace
```groovy
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig hasPosReleaseKey ? signingConfigs.release : signingConfigs.debug
```
with
```groovy
        release {
            signingConfig hasPosReleaseKey ? signingConfigs.release : null
```

- [ ] **Step 4: Update the README.** In `apps/mobile/README.md` replace everything from
`### 1. Create the signing key once, BEFORE the first client install` up to (not including) `### 2. Build and install`
with:

~~~~markdown
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

~~~~

- [ ] **Step 5: Run the pin**

Run: `cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin 28" src/mobile-paths.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Create the key** (PowerShell, one command, run once; it prints no password):

```powershell
$ErrorActionPreference = 'Stop'
$jks = 'D:\kd\pos-signing\sandbee-pos-release.jks'
$props = 'D:\gradle-home\gradle.properties'
if (Test-Path -LiteralPath $jks) { throw 'the key exists already: never overwrite it; stop and ask the owner' }
if ((Test-Path -LiteralPath $props) -and (Select-String -LiteralPath $props -Pattern '^POS_RELEASE_' -Quiet)) { throw 'POS_RELEASE_ lines exist already: stop and ask the owner' }
New-Item -ItemType Directory -Force -Path 'D:\kd\pos-signing' | Out-Null
$bytes = New-Object byte[] 24
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$env:POS_KS_PASS = [Convert]::ToBase64String($bytes).Replace('+', 'x').Replace('/', 'y').Replace('=', '')
& 'C:\Program Files\Microsoft\jdk-17.0.13.11-hotspot\bin\keytool.exe' -genkeypair -keystore $jks -storetype PKCS12 -alias sandbee-pos -keyalg RSA -keysize 4096 -validity 14610 -dname 'CN=Sandbee POS, O=sandbee, C=IN' -storepass:env POS_KS_PASS -keypass:env POS_KS_PASS
if ($LASTEXITCODE -ne 0) { throw "keytool failed: $LASTEXITCODE" }
$lines = @('POS_RELEASE_STORE_FILE=D:/kd/pos-signing/sandbee-pos-release.jks', "POS_RELEASE_STORE_PASSWORD=$env:POS_KS_PASS", 'POS_RELEASE_KEY_ALIAS=sandbee-pos', "POS_RELEASE_KEY_PASSWORD=$env:POS_KS_PASS")
if ((Test-Path -LiteralPath $props) -and (Get-Item -LiteralPath $props).Length -gt 0 -and -not ((Get-Content -LiteralPath $props -Raw).EndsWith("`n"))) { Add-Content -LiteralPath $props -Value '' -Encoding ascii }
Add-Content -LiteralPath $props -Value $lines -Encoding ascii
Remove-Item Env:POS_KS_PASS
'key file bytes: ' + (Get-Item -LiteralPath $jks).Length + '; POS_RELEASE_ lines: ' + (Select-String -LiteralPath $props -Pattern '^POS_RELEASE_').Count
```
Expected: `key file bytes: <about 4–5 thousand>; POS_RELEASE_ lines: 4`. The password is 32 characters of `A–Z a–z 0–9 x y`
(safe in a properties file).

- [ ] **Step 7: Record the certificate fingerprint** (not secret):

```powershell
$env:POS_KS_PASS = (Select-String -LiteralPath 'D:\gradle-home\gradle.properties' -Pattern '^POS_RELEASE_STORE_PASSWORD=(.*)$').Matches[0].Groups[1].Value
& 'C:\Program Files\Microsoft\jdk-17.0.13.11-hotspot\bin\keytool.exe' -list -v -keystore 'D:\kd\pos-signing\sandbee-pos-release.jks' -storepass:env POS_KS_PASS | Select-String -Pattern 'Alias name|SHA256:|Valid from|Signature algorithm|Subject Public Key'
Remove-Item Env:POS_KS_PASS
```
Expected: alias `sandbee-pos`, `SHA256: XX:XX:…` (record it in the Results; it is NOT the debug key's `FA:C6:17:45:…`),
valid until about 2066, `SHA384withRSA` or `SHA256withRSA`, `4096-bit RSA key`.

- [ ] **Step 8: Prove the guard** (three dry runs; `-P` on the command line overrides gradle.properties):

```bash
cd /d/kd/lucifer/apps/mobile/android
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat assembleRelease --dry-run -PPOS_RELEASE_KEY_ALIAS= --console=plain 2>&1 | grep -E "needs the private Sandbee POS key|^BUILD"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat aR --dry-run -PPOS_RELEASE_STORE_FILE=D:/kd/pos-signing/no-such.jks --console=plain 2>&1 | grep -E "release key file is missing|^BUILD"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat assembleRelease --dry-run --console=plain 2>&1 | grep -E "^BUILD"
```
Expected: (1) `A release build needs the private Sandbee POS key: set POS_RELEASE_KEY_ALIAS in …` + `BUILD FAILED`;
(2) `The release key file is missing: D:/kd/pos-signing/no-such.jks` + `BUILD FAILED` (an `aR` build is caught);
(3) `BUILD SUCCESSFUL`. If (1) or (2) passes, stop: the guard does not see the graph; report it.

- [ ] **Step 9: Commit** (the key and gradle.properties are outside the repo; `git status` must show only the three files):

```bash
cd /d/kd/lucifer && git status --short && git add apps/mobile/android/app/build.gradle apps/mobile/README.md apps/mobile/src/mobile-paths.test.ts && git commit -F "$SP/msg-n1-2.txt"
```
`$SP/msg-n1-2.txt`:
```text
feat(app): the Android app's private signing key: a release APK is signed with it or not built at all (a Gradle guard on the task graph catches assembleRelease and aR alike, and without the key the release build type has no signing config, so never React Native's public debug key again); the README names the key file, the four properties and the owner's two backups; pin 28 (native apps 2.0, Session N1, spec §8)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

- [ ] **Step 10: The owner's backup (gate item, not skipped).** In the session report ask the owner, in Hinglish, to copy
`D:\kd\pos-signing\sandbee-pos-release.jks` and the four `POS_RELEASE_` lines of `D:\gradle-home\gradle.properties`
(open it in Notepad themselves; Claude never shows the passwords) to two safe places, e.g. a USB drive kept at home and a
password manager. N2's prompt is given only after the owner confirms. No APK signed with this key leaves this PC before then.

### Task 3: The update base and times as build settings (§4, §11)

**Files:**
- Modify: `apps/mobile/android/app/build.gradle` (a block before `android {`; three `resValue` lines in `defaultConfig`)
- Create: `apps/mobile/android/app/src/main/res/raw/pos_update_keep.xml`
- Test: `apps/mobile/src/mobile-paths.test.ts` (pin 29)

**Interfaces:**
- Produces (for N2): `R.string.pos_update_base` (no trailing slash; default `https://files.sandbee.in/pos`), `R.integer.pos_update_check_minutes` (default 720), `R.integer.pos_update_reopen_minutes` (default 30). Gradle properties `posUpdateBase`, `posUpdateCheckMinutes`, `posUpdateReopenMinutes` (the last two only with a test base).
- Produces (for N4): the base is readable from an APK with `aapt2 dump resources` (`string/pos_update_base`).

- [ ] **Step 1: Write the failing test.** Append to `apps/mobile/src/mobile-paths.test.ts`:

```ts
// ── pin 29: native apps 2.0, the update base and times are build settings (2026-10-12) ───────
// spec §4, §11: the base is https://files.sandbee.in/pos unless a test build passes a 127.0.0.1 base; only a test base
// may shorten the times (12 hours between checks, an app open after 30 minutes away). They live in resources that the
// shrinker keeps, so the release packaging can read the base back out of the APK.
function updateBaseProblems(gradle: string, keep: string): string[] {
  const out: string[] = [];
  const g = strip(gradle);
  const need = (needle: string, why: string) => {
    if (!g.includes(needle)) {
      out.push(why);
    }
  };
  need('def posUpdateBaseDefault = "https://files.sandbee.in/pos"', 'the release base is not https://files.sandbee.in/pos');
  need("def posUpdateBase = (findProperty('posUpdateBase') ?: posUpdateBaseDefault).toString()", 'the base is not a build setting with the release default');
  need('posUpdateBase ==~ /http:\\/\\/127\\.0\\.0\\.1:\\d{1,5}(\\/[A-Za-z0-9._-]+)*/', 'a test base may be any http address');
  need('if (posUpdateBase == posUpdateBaseDefault && (posUpdateCheckMinutes != 720 || posUpdateReopenMinutes != 30))', 'a build with the real base can carry test times');
  need('resValue "string", "pos_update_base", posUpdateBase', 'the base is not in the APK for the updater and the packaging');
  need('resValue "integer", "pos_update_check_minutes", posUpdateCheckMinutes.toString()', 'the check gap is not a resource');
  need('resValue "integer", "pos_update_reopen_minutes", posUpdateReopenMinutes.toString()', 'the app-open gap is not a resource');
  if (!keep.includes('tools:keep="@string/pos_update_base,@integer/pos_update_check_minutes,@integer/pos_update_reopen_minutes"')) {
    out.push('the resource shrinker may drop the update settings');
  }
  return out;
}
const UPDATE_KEEP = join(MAIN, 'res', 'raw', 'pos_update_keep.xml');

test('pin 29: the update base and times are build settings with the release defaults', () => {
  assert.deepEqual(updateBaseProblems(read(GRADLE_APP), read(UPDATE_KEEP)), []);
});

test('pin 29 mutation: every update-setting needle can fail', () => {
  const gradle = read(GRADLE_APP);
  const keep = read(UPDATE_KEEP);
  everyMutationCaught(s => updateBaseProblems(s, keep), gradle, [
    ['"https://files.sandbee.in/pos"', '"https://files.sandbee.in/other"'],
    ["(findProperty('posUpdateBase') ?: posUpdateBaseDefault)", '(posUpdateBaseDefault)'],
    ['http:\\/\\/127\\.0\\.0\\.1:', 'http:\\/\\/[a-z0-9.-]+:'],
    ['posUpdateCheckMinutes != 720 ||', 'false ||'],
    ['"pos_update_base", posUpdateBase', '"pos_update_base", posUpdateBaseDefault'],
    ['"pos_update_check_minutes", posUpdateCheckMinutes', '"pos_update_check_minutes", 720'],
    ['"pos_update_reopen_minutes", posUpdateReopenMinutes', '"pos_update_reopen_minutes", 30'],
  ]);
  everyMutationCaught(s => updateBaseProblems(gradle, s), keep, [['@integer/pos_update_reopen_minutes"', '"']]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin 29" src/mobile-paths.test.ts`
Expected: FAIL (`missing file: …pos_update_keep.xml`).

- [ ] **Step 3: Implement.** In `apps/mobile/android/app/build.gradle`, directly before the line `android {`, insert:

```groovy
/**
 * Native apps 2.0 (spec §4, §11): where the app looks for its updates, and how often. Resources the updater reads
 * (R.string.pos_update_base, R.integer.pos_update_check_minutes, R.integer.pos_update_reopen_minutes;
 * res/raw/pos_update_keep.xml keeps them through the resource shrinker), so the release packaging can read the base back
 * out of an APK with aapt2 and refuse any other (scripts/release-native.mjs). A test build passes
 * -PposUpdateBase=http://127.0.0.1:<port>/pos (the emulator reaches it through adb reverse) and may shorten the times;
 * a build with the real base always has the real ones (12 hours between checks, an app open after 30 minutes away).
 */
def posUpdateBaseDefault = "https://files.sandbee.in/pos"
def posUpdateBase = (findProperty('posUpdateBase') ?: posUpdateBaseDefault).toString()
if (!(posUpdateBase ==~ /https:\/\/[a-z0-9.-]+(\/[A-Za-z0-9._-]+)*/ || posUpdateBase ==~ /http:\/\/127\.0\.0\.1:\d{1,5}(\/[A-Za-z0-9._-]+)*/)) {
    throw new GradleException("posUpdateBase must be https://<host>/<path>, or http://127.0.0.1:<port>/<path> for a test build: ${posUpdateBase}")
}
def posUpdateCheckMinutes = (findProperty('posUpdateCheckMinutes') ?: '720').toString() as int
def posUpdateReopenMinutes = (findProperty('posUpdateReopenMinutes') ?: '30').toString() as int
if (posUpdateBase == posUpdateBaseDefault && (posUpdateCheckMinutes != 720 || posUpdateReopenMinutes != 30)) {
    throw new GradleException("posUpdateCheckMinutes and posUpdateReopenMinutes are for test builds only (with a test posUpdateBase)")
}
if (posUpdateCheckMinutes < 1 || posUpdateReopenMinutes < 1) {
    throw new GradleException("posUpdateCheckMinutes and posUpdateReopenMinutes must be at least 1")
}

```

In `defaultConfig` replace
```groovy
        versionName posVersionName
    }
```
with
```groovy
        versionName posVersionName
        resValue "string", "pos_update_base", posUpdateBase
        resValue "integer", "pos_update_check_minutes", posUpdateCheckMinutes.toString()
        resValue "integer", "pos_update_reopen_minutes", posUpdateReopenMinutes.toString()
    }
```

Create `apps/mobile/android/app/src/main/res/raw/pos_update_keep.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Native apps 2.0 (spec §4): the updater's settings stay in every release APK (build.gradle, posUpdateBase), so the
     release packaging can read the base back with aapt2. The build does not package this file itself. -->
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@string/pos_update_base,@integer/pos_update_check_minutes,@integer/pos_update_reopen_minutes" />
```

- [ ] **Step 4: Run the pin and four Gradle configurations**

```bash
cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin 29" src/mobile-paths.test.ts
cd /d/kd/lucifer/apps/mobile/android
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:help -PposUpdateBase=http://example.com/pos --console=plain 2>&1 | grep -E "posUpdateBase must|^BUILD"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:help -PposUpdateCheckMinutes=1 --console=plain 2>&1 | grep -E "for test builds only|^BUILD"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:generateDebugResValues -PposUpdateBase=http://127.0.0.1:8765/pos -PposUpdateCheckMinutes=1 -PposUpdateReopenMinutes=1 --console=plain 2>&1 | grep -E "^BUILD"
grep -h "pos_update" $(find app/build/generated -name gradleResValues.xml -path '*debug*')
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:generateDebugResValues --console=plain 2>&1 | grep -E "^BUILD"
grep -h "pos_update" $(find app/build/generated -name gradleResValues.xml -path '*debug*')
```
Expected: pin 29 PASS (2 tests); `posUpdateBase must be https://…` + `BUILD FAILED`; `… are for test builds only …` +
`BUILD FAILED`; `BUILD SUCCESSFUL` and the three test values (`http://127.0.0.1:8765/pos`, `1`, `1`); `BUILD SUCCESSFUL`
and the defaults (`https://files.sandbee.in/pos`, `720`, `30`). If this AGP names the task differently,
`./gradlew.bat :app:tasks --all | grep -i resvalues` finds it; record the name used.

- [ ] **Step 5: Commit** (`$SP/msg-n1-3.txt`; `git add` the gradle file, the keep file and the test file):
```text
feat(app): the updater's base address and times are build settings: https://files.sandbee.in/pos, 12 hours between checks and an app open after 30 minutes away in every release; a test build may point at http://127.0.0.1:<port>/pos and shorten the times, a build with the real base never can; resources kept through the shrinker so the release packaging can read the base back out of an APK; pin 29 (native apps 2.0, Session N1, spec §4, §11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 4: `UpdateManifest`, reading `latest.json` (§4)

**Files:**
- Modify: `apps/mobile/android/app/build.gradle` (`dependencies`: the real `org.json` for JVM tests)
- Create: `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateManifest.kt`
- Test: `apps/mobile/android/app/src/test/java/com/possoftware/pos/update/UpdateManifestTest.kt`

**Interfaces:**
- Produces (for N2):
  - `UpdateManifest.read(json: String, packageName: String, installedCode: Int, deviceAbis: List<String>): UpdateManifest.Result`
  - `sealed interface Result`; `data class Accepted(val offer: Offer)`; `data class Ignored(val reason: String)`
  - `data class Offer(val version: String, val versionCode: Int, val notes: String, val abi: String, val file: String, val sha256: String, val size: Int)` (`sha256` lower case, `notes` trimmed, `""` when absent)
  - `UpdateManifest.codeOf(version: String): Int?`; constants `SCHEMA = 1`, `MAX_APK_BYTES = 104857600`, `MAX_NOTES_CHARS = 300`, `MAX_JSON_CHARS = 16384`, `ABIS = [arm64-v8a, armeabi-v7a, x86_64, x86]`

- [ ] **Step 1: Add the test dependency.** In `apps/mobile/android/app/build.gradle` replace
```groovy
    testImplementation "junit:junit:4.13.2"
```
with
```groovy
    testImplementation "junit:junit:4.13.2"
    // Native apps 2.0 (Session N1): the real org.json for the updater's JVM tests (Android's own is only a stub there).
    // 20180813 reads numbers as Android does (an integer as Int, a decimal as Double) and is in D:\gradle-home already.
    testImplementation "org.json:json:20180813"
```

- [ ] **Step 2: Write the failing test.** Create `apps/mobile/android/app/src/test/java/com/possoftware/pos/update/UpdateManifestTest.kt`:

```kotlin
package com.possoftware.pos.update

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Native apps 2.0 (spec §4): every rule of the update manifest. Each rejection is checked by its own reason, so a test
 * proves the rule it names fired, not an earlier one.
 */
class UpdateManifestTest {
  private val pkg = "com.possoftware.pos"
  private val phone = listOf("arm64-v8a", "armeabi-v7a")
  private val sha = "ab".repeat(32)

  /** A valid 2.1.0 manifest; [edit] changes it before it is written out. */
  private fun manifest(edit: (JSONObject) -> Unit = {}): String {
    val root = JSONObject()
        .put("schema", 1)
        .put("package", pkg)
        .put("version", "2.1.0")
        .put("versionCode", 20100)
        .put("released", "2026-11-02")
        .put("notes", "Faster printing.")
        .put("apks", JSONObject()
            .put("arm64-v8a", apk("Sandbee-POS-2.1.0-arm64-v8a.apk", 7_320_758))
            .put("armeabi-v7a", apk("Sandbee-POS-2.1.0-armeabi-v7a.apk", 6_728_592)))
    edit(root)
    return root.toString()
  }

  private fun apk(file: String, size: Int): JSONObject = JSONObject().put("file", file).put("sha256", sha).put("size", size)

  private fun apkOf(root: JSONObject, abi: String = "arm64-v8a"): JSONObject = root.getJSONObject("apks").getJSONObject(abi)

  private fun read(json: String, installed: Int = 20000, abis: List<String> = phone) =
      UpdateManifest.read(json, pkg, installed, abis)

  private fun offer(json: String, installed: Int = 20000, abis: List<String> = phone): UpdateManifest.Offer {
    val result = read(json, installed, abis)
    if (result !is UpdateManifest.Accepted) throw AssertionError("expected an offer, got $result")
    return result.offer
  }

  private fun ignored(reason: String, json: String, installed: Int = 20000, abis: List<String> = phone) =
      assertEquals(UpdateManifest.Ignored(reason), read(json, installed, abis))

  @Test
  fun aNewerManifestOffersTheApkForTheDevicesPreferredCpuType() {
    assertEquals(
        UpdateManifest.Offer("2.1.0", 20100, "Faster printing.", "arm64-v8a", "Sandbee-POS-2.1.0-arm64-v8a.apk", sha, 7_320_758),
        offer(manifest()))
    assertEquals("a 32-bit phone gets its own APK", "armeabi-v7a", offer(manifest(), abis = listOf("armeabi-v7a")).abi)
  }

  @Test
  fun theSameOrAnOlderVersionIsNeverOffered() {
    ignored("not newer", manifest(), installed = 20100)
    ignored("not newer", manifest(), installed = 20200)
    assertEquals(20100, offer(manifest(), installed = 20099).versionCode)
  }

  @Test
  fun everyTopLevelFieldIsChecked() {
    ignored("schema", manifest { it.remove("schema") })
    ignored("schema", manifest { it.put("schema", 2) })
    ignored("schema", manifest { it.put("schema", "1") })
    ignored("package", manifest { it.put("package", "com.example.other") })
    ignored("version", manifest { it.remove("version") })
    ignored("version", manifest { it.put("version", "2.1") })
    ignored("version", manifest { it.put("version", "2.100.0") })
    ignored("version", manifest { it.put("version", "2.1.1") }) // the versionCode says 2.1.0
    ignored("versionCode", manifest { it.put("versionCode", "20100") })
    ignored("versionCode", manifest { it.put("versionCode", 20100.5) })
    ignored("versionCode", manifest().replace("\"versionCode\":20100", "\"versionCode\":20100.0"))
    ignored("released", manifest { it.remove("released") })
    ignored("released", manifest { it.put("released", "02/11/2026") })
    ignored("apks", manifest { it.remove("apks") })
    ignored("apks", manifest { it.put("apks", "Sandbee-POS-2.1.0-arm64-v8a.apk") })
  }

  @Test
  fun anApkFileIsAPlainNameNeverAPathOrAnAddress() {
    val bad = listOf("../Sandbee.apk", "a/b.apk", "a\\b.apk", "https://evil.example/x.apk", "x.apk.exe", ".apk", "-x.apk",
        "x..apk", "", "x".repeat(100) + ".apk")
    for (file in bad) ignored("file arm64-v8a", manifest { apkOf(it).put("file", file) })
    ignored("file arm64-v8a", manifest { apkOf(it).remove("file") })
  }

  @Test
  fun hashAndSizeRules() {
    ignored("sha256 arm64-v8a", manifest { apkOf(it).put("sha256", "ab".repeat(31) + "a") })
    ignored("sha256 arm64-v8a", manifest { apkOf(it).put("sha256", "zz".repeat(32)) })
    ignored("sha256 arm64-v8a", manifest { apkOf(it).remove("sha256") })
    assertEquals("an upper-case hash is read in lower case", sha, offer(manifest { apkOf(it).put("sha256", sha.uppercase()) }).sha256)
    ignored("size arm64-v8a", manifest { apkOf(it).put("size", 0) })
    ignored("size arm64-v8a", manifest { apkOf(it).put("size", -1) })
    ignored("size arm64-v8a", manifest { apkOf(it).put("size", UpdateManifest.MAX_APK_BYTES + 1) })
    ignored("size arm64-v8a", manifest { apkOf(it).put("size", "7320758") })
    assertEquals("100 MB is allowed", UpdateManifest.MAX_APK_BYTES,
        offer(manifest { apkOf(it).put("size", UpdateManifest.MAX_APK_BYTES) }).size)
  }

  @Test
  fun notesAreOptionalAndShort() {
    assertEquals("", offer(manifest { it.remove("notes") }).notes)
    assertEquals("x".repeat(300), offer(manifest { it.put("notes", "x".repeat(300)) }).notes)
    ignored("notes", manifest { it.put("notes", "x".repeat(301)) })
    ignored("notes", manifest { it.put("notes", 5) })
  }

  @Test
  fun aDeviceWithoutAnApkForItsCpuTypeIsNotOffered() {
    ignored("no APK for this device", manifest(), abis = listOf("x86_64"))
    assertEquals("an emulator test build's own APK", "x86_64",
        offer(manifest { it.getJSONObject("apks").put("x86_64", apk("Sandbee-POS-2.1.0-x86_64.apk", 7_000_000)) },
            abis = listOf("x86_64", "arm64-v8a")).abi)
    assertEquals("a CPU type the app never ships for is not judged", "arm64-v8a",
        offer(manifest { it.getJSONObject("apks").put("mips", "anything") }).abi)
  }

  @Test
  fun anythingThatIsNotAManifestIsIgnored() {
    ignored("not JSON", "")
    ignored("not JSON", "<html>Not found</html>")
    ignored("not JSON", "[1, 2]")
    ignored("too large", " ".repeat(UpdateManifest.MAX_JSON_CHARS + 1))
  }

  @Test
  fun aVersionCodeIsMajorMinorPatch() {
    assertEquals(20000, UpdateManifest.codeOf("2.0.0"))
    assertEquals(20100, UpdateManifest.codeOf("2.1.0"))
    assertEquals(109999, UpdateManifest.codeOf("10.99.99"))
    assertNull(UpdateManifest.codeOf("2.100.0"))
    assertNull(UpdateManifest.codeOf("2.0"))
    assertNull(UpdateManifest.codeOf("v2.0.0"))
  }
}
```

- [ ] **Step 3: Run it and see it fail**

Run: `cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --tests 'com.possoftware.pos.update.*' --console=plain 2>&1 | grep -E "Unresolved reference|^BUILD"`
Expected: `Unresolved reference 'UpdateManifest'` and `BUILD FAILED`.

- [ ] **Step 4: Implement.** Create `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateManifest.kt`:

```kotlin
package com.possoftware.pos.update

import org.json.JSONException
import org.json.JSONObject

/**
 * Native apps 2.0 (spec §4): the update manifest, `<base>/android/latest.json`, read against the installed app. It is
 * accepted only when every rule holds; anything else is ignored silently (the app stays as it is and looks again at a
 * later app open). The APK's address never comes from the manifest: [Offer.file] is a plain file name the updater puts
 * after `<base>/android/`. Pure, so the JVM tests (src/test) pin every rule.
 */
object UpdateManifest {
  const val SCHEMA = 1
  const val MAX_APK_BYTES = 100 * 1024 * 1024
  const val MAX_NOTES_CHARS = 300
  /** A manifest is a few hundred bytes; anything far larger is not one. */
  const val MAX_JSON_CHARS = 16 * 1024

  /** The CPU types an APK may be named for (the release ships the first two; an emulator test build adds x86_64). */
  val ABIS = listOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86")

  private val VERSION = Regex("""(\d{1,3})\.(\d{1,2})\.(\d{1,2})""")
  private val DATE = Regex("""\d{4}-\d{2}-\d{2}""")
  private val FILE = Regex("""[A-Za-z0-9][A-Za-z0-9._-]{0,98}\.apk""")
  private val SHA256 = Regex("""[0-9a-fA-F]{64}""")

  /** The newer release this device can install: the APK for its preferred CPU type. */
  data class Offer(
      val version: String,
      val versionCode: Int,
      val notes: String,
      val abi: String,
      val file: String,
      val sha256: String,
      val size: Int,
  )

  sealed interface Result

  data class Accepted(val offer: Offer) : Result

  data class Ignored(val reason: String) : Result

  /** spec §5: versionCode = major × 10000 + minor × 100 + patch; null when [version] is not x.y.z with minor and patch
   *  below 100. */
  fun codeOf(version: String): Int? {
    val match = VERSION.matchEntire(version) ?: return null
    val (major, minor, patch) = match.destructured
    return major.toInt() * 10_000 + minor.toInt() * 100 + patch.toInt()
  }

  /** [deviceAbis]: Build.SUPPORTED_ABIS, the device's preferred CPU type first. */
  fun read(json: String, packageName: String, installedCode: Int, deviceAbis: List<String>): Result {
    if (json.length > MAX_JSON_CHARS) return Ignored("too large")
    val root = try {
      JSONObject(json)
    } catch (e: JSONException) {
      return Ignored("not JSON")
    }
    if (root.opt("schema") != SCHEMA) return Ignored("schema")
    if (root.opt("package") != packageName) return Ignored("package")
    val version = root.opt("version") as? String ?: return Ignored("version")
    val code = root.opt("versionCode") as? Int ?: return Ignored("versionCode")
    if (codeOf(version) != code) return Ignored("version")
    if (code <= installedCode) return Ignored("not newer")
    val released = root.opt("released") as? String
    if (released == null || !DATE.matches(released)) return Ignored("released")
    val notes = when (val n = root.opt("notes")) {
      null -> ""
      is String -> if (n.length <= MAX_NOTES_CHARS) n.trim() else return Ignored("notes")
      else -> return Ignored("notes")
    }
    val apks = root.opt("apks") as? JSONObject ?: return Ignored("apks")
    val offers = HashMap<String, Offer>()
    for (abi in apks.keys()) {
      if (abi !in ABIS) continue
      val apk = apks.opt(abi) as? JSONObject ?: return Ignored("apk $abi")
      val file = apk.opt("file") as? String
      if (file == null || !FILE.matches(file) || file.contains("..")) return Ignored("file $abi")
      val sha256 = apk.opt("sha256") as? String
      if (sha256 == null || !SHA256.matches(sha256)) return Ignored("sha256 $abi")
      val size = apk.opt("size") as? Int
      if (size == null || size <= 0 || size > MAX_APK_BYTES) return Ignored("size $abi")
      offers[abi] = Offer(version, code, notes, abi, file, sha256.lowercase(), size)
    }
    val abi = deviceAbis.firstOrNull { it in offers } ?: return Ignored("no APK for this device")
    return Accepted(offers.getValue(abi))
  }
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --tests 'com.possoftware.pos.update.*' --console=plain 2>&1 | grep -E "FAILED|^BUILD"; grep -o 'tests="[0-9]*"[^>]*failures="[0-9]*"' app/build/test-results/testDebugUnitTest/TEST-com.possoftware.pos.update.UpdateManifestTest.xml`
Expected: `BUILD SUCCESSFUL`, `tests="9" … failures="0"`. If a case fails only on the JVM because of how `org.json`
20180813 reads a number, fix the test input, never loosen a rule; note it in the Results.

- [ ] **Step 6: Commit** (`$SP/msg-n1-4.txt`; add the gradle file, the Kotlin file and the test):
```text
feat(app): the updater reads latest.json by every rule of the spec and ignores anything else silently: schema 1, this package, an x.y.z version that equals its versionCode and is newer than the installed app, a release date, short optional notes, and for the device's preferred CPU type a plain .apk file name (never a path or an address), a 64-hex SHA-256 and a size up to 100 MB; nine JVM tests, one per rule and rejection; org.json 20180813 for the JVM tests (native apps 2.0, Session N1, spec §4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 5: `UpdateSchedule`, the app open and the card (§6.2, §6.3)

**Files:**
- Create: `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateSchedule.kt`
- Test: `apps/mobile/android/app/src/test/java/com/possoftware/pos/update/UpdateScheduleTest.kt`

**Interfaces:**
- Produces (for N2): `class UpdateSchedule(installedCode: Int, checkEveryMs: Long = CHECK_EVERY_MS, reopenAfterMs: Long = REOPEN_AFTER_MS)` with
  - `fun shown(elapsedMs: Long, verifiedCode: Int?): Boolean` (true = this is an app open)
  - `fun hidden(elapsedMs: Long)`
  - `fun checkDue(nowMs: Long, lastCheckMs: Long): Boolean` (wall clock; `lastCheckMs` 0 = never)
  - `fun takeCard(): Int?` (the version code to offer, once per open)
  - `companion object { const val CHECK_EVERY_MS = 43_200_000L; const val REOPEN_AFTER_MS = 1_800_000L }`. N2 builds it from `R.integer.pos_update_check_minutes` / `pos_update_reopen_minutes` × 60 000.

- [ ] **Step 1: Write the failing test.** Create `apps/mobile/android/app/src/test/java/com/possoftware/pos/update/UpdateScheduleTest.kt`:

```kotlin
package com.possoftware.pos.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Native apps 2.0 (spec §6.2, §6.3): the updater acts only at an app open (the first view after the process started, or
 * back after 30 minutes away), looks at most every 12 hours, and offers the card once per open, only for an APK verified
 * before that open: never in the middle of work.
 */
class UpdateScheduleTest {
  private val min = 60_000L
  private val hour = 60 * min

  private fun schedule() = UpdateSchedule(installedCode = 20000)

  @Test
  fun theFirstViewAfterTheProcessStartedIsAnOpen() {
    val s = schedule()
    assertTrue(s.shown(5_000L, null))
    s.hidden(10_000L)
    assertFalse("back after a few seconds: the same open", s.shown(15_000L, null))
  }

  @Test
  fun backAfterThirtyMinutesAwayIsAnOpenSoonerIsNot() {
    val s = schedule()
    s.shown(0L, null)
    s.hidden(1 * min)
    assertFalse("29:59 away", s.shown(1 * min + 30 * min - 1, null))
    s.hidden(40 * min)
    assertTrue("30:00 away", s.shown(70 * min, null))
  }

  @Test
  fun theFirstMomentAwayCounts() {
    // onPause, then onStop later: the app went away at the first.
    val s = schedule()
    s.shown(0L, null)
    s.hidden(1 * min)
    s.hidden(20 * min)
    assertTrue(s.shown(31 * min, null))
  }

  @Test
  fun aCheckRunsAtAnOpenWhenTheLastIsTwelveHoursOld() {
    val s = schedule()
    val last = 1_760_000_000_000L
    assertTrue("never looked", s.checkDue(last, 0L))
    assertFalse("11:59 later", s.checkDue(last + 12 * hour - 1, last))
    assertTrue("12:00 later", s.checkDue(last + 12 * hour, last))
    assertTrue("a clock set back still looks, never stuck until the clock catches up", s.checkDue(last - hour, last))
  }

  @Test
  fun theCardIsOfferedOncePerOpenAndAgainAtTheNextOpen() {
    val s = schedule()
    s.shown(0L, 20100)
    assertEquals(20100, s.takeCard())
    assertNull("once per open", s.takeCard())
    s.hidden(1 * min)
    s.shown(31 * min, 20100)
    assertEquals("Later: the next open offers it again", 20100, s.takeCard())
  }

  @Test
  fun aDownloadThatEndsDuringWorkWaitsForTheNextOpen() {
    val s = schedule()
    s.shown(0L, null)
    assertNull(s.takeCard())
    // The download is verified a few minutes in; staff keep working, step away for 5 minutes and come back.
    s.hidden(10 * min)
    assertFalse(s.shown(15 * min, 20100))
    assertNull("not an open: no card in the middle of work", s.takeCard())
    s.hidden(60 * min)
    assertTrue(s.shown(120 * min, 20100))
    assertEquals(20100, s.takeCard())
  }

  @Test
  fun aCardNotTakenBeforeTheAppWentAwayWaitsForTheNextOpen() {
    val s = schedule()
    s.shown(0L, 20100)
    s.hidden(1_000L)
    assertFalse(s.shown(2 * min, 20100))
    assertNull("never later in a session", s.takeCard())
  }

  @Test
  fun anUpdateNoNewerThanTheInstalledAppIsNeverACard() {
    val s = schedule()
    s.shown(0L, 20000)
    assertNull(s.takeCard())
  }
}
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --tests 'com.possoftware.pos.update.UpdateScheduleTest' --console=plain 2>&1 | grep -E "Unresolved reference|^BUILD"`
Expected: `Unresolved reference 'UpdateSchedule'`, `BUILD FAILED`.

- [ ] **Step 3: Implement.** Create `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateSchedule.kt`:

```kotlin
package com.possoftware.pos.update

/**
 * Native apps 2.0 (spec §6.2, §6.3): when the updater may look for an update and when the card may show. Both happen only
 * at an **app open**: the first time the app is seen after its process started, or when it comes back after at least
 * [reopenAfterMs] out of view (30 minutes). At an open the updater looks for an update when its last look is
 * [checkEveryMs] old (12 hours). The card shows at most once per open, and only for an APK verified **before** that
 * open: a download that ends while staff are working waits for the next open, and an open's card not taken before the
 * app went out of view is dropped, so the card never appears in the middle of work. "Later" needs no state: the next
 * open offers the card again.
 *
 * Pure: the caller passes the clocks (SystemClock.elapsedRealtime() for [shown] and [hidden]; wall time for [checkDue],
 * because the last check is kept across restarts). Main thread only. The JVM tests (src/test) pin it.
 */
class UpdateSchedule(
    private val installedCode: Int,
    private val checkEveryMs: Long = CHECK_EVERY_MS,
    private val reopenAfterMs: Long = REOPEN_AFTER_MS,
) {
  companion object {
    const val CHECK_EVERY_MS = 12 * 60 * 60 * 1000L
    const val REOPEN_AFTER_MS = 30 * 60 * 1000L
  }

  private var seen = false
  private var hiddenAt: Long? = null
  private var cardCode: Int? = null

  /** The app came into view at [elapsedMs]. [verifiedCode]: the version code of the update downloaded and verified so
   *  far (null: none). True when this is an app open. */
  fun shown(elapsedMs: Long, verifiedCode: Int?): Boolean {
    val away = hiddenAt
    val open = !seen || (away != null && elapsedMs - away >= reopenAfterMs)
    seen = true
    hiddenAt = null
    if (open) cardCode = verifiedCode?.takeIf { it > installedCode }
    return open
  }

  /** The app went out of view at [elapsedMs] (the first of onPause and onStop counts). An open's card not taken by now
   *  waits for the next open. */
  fun hidden(elapsedMs: Long) {
    if (hiddenAt == null) hiddenAt = elapsedMs
    cardCode = null
  }

  /** At an open: look for an update now? [lastCheckMs] is wall time, 0 when never. A clock set back counts as due. */
  fun checkDue(nowMs: Long, lastCheckMs: Long): Boolean =
      lastCheckMs <= 0L || nowMs - lastCheckMs >= checkEveryMs || nowMs < lastCheckMs

  /** The card for this open, handed out once: the version code to offer, or null. */
  fun takeCard(): Int? {
    val code = cardCode
    cardCode = null
    return code
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --tests 'com.possoftware.pos.update.*' --console=plain 2>&1 | grep -E "FAILED|^BUILD"`
Expected: `BUILD SUCCESSFUL`; `UpdateScheduleTest` 8 tests, `UpdateManifestTest` 9 tests, 0 failures.

- [ ] **Step 5: Commit** (`$SP/msg-n1-5.txt`):
```text
feat(app): the updater's schedule: it acts only at an app open (the first view after the app's process started, or back after 30 minutes away), looks at most every 12 hours (a clock set back still looks), and offers the card once per open and only for an APK verified before that open, so a download that ends during work, or a card not taken before the app went away, waits for the next open; eight JVM tests (native apps 2.0, Session N1, spec §6.2, §6.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 6: A release build read back, every suite, and the Results

**Files:**
- Create (scratch, not committed): `$SP/n1-release.sh`
- Modify: this plan (append "## Session N1 Results")

- [ ] **Step 1: Write `$SP/n1-release.sh`** (one release pair, private key, real base; recorded locally and released to nobody):

```bash
#!/bin/bash
# Session N1: one release APK pair built with the private key and the real update base, read back. usage: n1-release.sh <out>
OUT="$1"; mkdir -p "$OUT"; S="$OUT/summary.txt"; : > "$S"
BT="/c/Users/kartik.desai/AppData/Local/Android/Sdk/build-tools/37.0.0"
cd /d/kd/lucifer/apps/mobile/android || exit 2
echo "start $(date -Is) head $(git rev-parse --short HEAD)" >> "$S"; df -h /d >> "$S"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:compileReleaseKotlin --rerun --console=plain > "$OUT/kotlin.log" 2>&1
echo "compileReleaseKotlin --rerun exit=$?" >> "$S"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --console=plain > "$OUT/pair.log" 2>&1
echo "pair exit=$? $(grep -E '^BUILD' "$OUT/pair.log")" >> "$S"
for abi in arm64-v8a armeabi-v7a; do
  apk="app/build/outputs/apk/release/app-$abi-release.apk"
  cp "$apk" "$OUT/" && sha256sum "$apk" >> "$S"
  "$BT/apksigner.bat" verify --print-certs "$apk" 2>&1 | grep -E "certificate DN|certificate SHA-256" >> "$S"
  "$BT/aapt2.exe" dump badging "$apk" | grep -E "^package:|application-debuggable" >> "$S"
  "$BT/aapt2.exe" dump resources "$apk" | grep -A1 -E "(string/pos_update_base|integer/pos_update_(check|reopen)_minutes)" >> "$S"
done
df -h /d >> "$S"; echo "DONE $(date -Is)" >> "$S"
```

- [ ] **Step 2: Run it in the background** (`run_in_background: true`): `bash "$SP/n1-release.sh" "$SP/n1-release"`, then wait
for `DONE` in `summary.txt` with a background until-loop. Expected in `summary.txt`:
  - `compileReleaseKotlin --rerun exit=0`, `pair exit=0 BUILD SUCCESSFUL`;
  - for each APK: `Signer #1 certificate DN: CN=Sandbee POS, O=sandbee, C=IN`; `Signer #1 certificate SHA-256 digest:` equal
    to the Task 2 Step 7 fingerprint (lower case, no colons) and **not** starting `fac61745`;
  - `package: name='com.possoftware.pos' versionCode='20000' versionName='2.0.0'`; no `application-debuggable`;
  - `string/pos_update_base` → `"https://files.sandbee.in/pos"`; the check minutes 720 and the reopen minutes 30.

If the resources are not found by name (a shrinker that renames them), record it; N4's packaging then reads the value
from `aapt2 dump strings` instead, and the gate decides.

- [ ] **Step 3: Every suite**

```bash
cd /d/kd/lucifer/apps/mobile && npm test 2>&1 | tail -8 && npm run typecheck && npm run lint
cd /d/kd/lucifer/apps/desktop && npm test 2>&1 | tail -6 && npm run typecheck && npm run lint
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --rerun --console=plain > "$SP/junit-n1.log" 2>&1; tail -3 "$SP/junit-n1.log"
cat app/build/test-results/testDebugUnitTest/*.xml | grep -o '<testsuite [^>]*' | sed -E 's/.*tests="([0-9]+)".*failures="([0-9]+)".*errors="([0-9]+)".*/\1 \2 \3/' | awk '{t+=$1; f+=$2; e+=$3} END {print "tests="t" failures="f" errors="e}'
```
Expected: mobile = baseline + 6 (pins 27–29 and their mutations), typecheck and lint clean; desktop = baseline; JUnit =
baseline + 17, 0 failures, 0 errors.

- [ ] **Step 4: Results and commit.** Append `## Session N1 Results` to this plan: the baseline and final counts, the
commits, the key's certificate SHA-256 fingerprint and validity (never a password), the three guard dry runs, the release
read-back (APK sizes and SHA-256s, signer, version, base), anything that differed from this plan and why. Then
`git add docs/superpowers/plans/2026-10-12-native-apps-2.md && git commit -F "$SP/msg-n1-6.txt"`:
```text
docs(apps): native apps 2.0 Session N1 results: one version 2.0.0, the private key and its guard, the update settings, UpdateManifest and UpdateSchedule; suites and a release read-back recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
No push unless the owner's prompt says so. Update the project memory (`native-apps-2-2026-10.md`): N1 done, the commit, the
fingerprint, the backup still to confirm.

- [ ] **Step 5: Report to the owner** (Hinglish): what was done, the counts, and the backup request of Task 2 Step 10.

---

# Session N2 (exact): the Android updater at run time

Made exact at the N1 review gate (2026-10-12, section "N1 review gate" at the end of this plan). Every code block below
was written and run in a gold worktree (`D:\kd\n2g`, detached from `6da60fa`): tasks 20–25 as six commits, tree
`b27e0720af2534ee0545b49a40e795ca42f0192f`; the blocks were generated from those commits (each find matches exactly once
when it runs, in order). Test APKs built from it passed E1–E7, a cold start and Android's Cancel on the emulator, and the gate's own review of
this section was folded in (Android 9's archive signers, the card kept from the tap on Install).

Acceptance: an installed 2.0.0 (private key) finds 2.0.1 on a fake files server, downloads it in the background, shows
the card at the next app open, installs on a tap and comes back as 2.0.1; every failure path stays silent and leaves the
app as it was.

**Changes from the spec version of N2** (the gate's rulings; reasons in the gate section):
- Task 20 is new: the N1 review's minors m-3 to m-7 (three JVM tests, a pin 28 needle). The review's I-2 (the schedule's
  thread) is settled in the module: `takeCard` runs on the main thread (pin 32), the schedule stays single-threaded.
- `UpdateFiles` (pure, JVM) comes first (Task 21); the store, the downloader and `ApkCheck` follow (Task 22, pin 30).
- Install answers `"started" | "permission" | "missing" | "failed"` (a session that cannot be written is "failed").
- The card stays while Android's own screens are up for an install it started ("Install unknown apps", the installer's
  dialog): the reducer's `waiting` state (the N1 review's E5 finding). The card's state is a hook, `useUpdateCard`, in
  `UpdateCard.tsx`; `PosScreen` renders the card over the POS (not over the load-error screen).
- `ApkCheck` reads a downloaded APK with `GET_SIGNING_CERTIFICATES` and `GET_SIGNATURES` (Android 9 reads an archive's
  certificates only for the second) and falls back to `PackageInfo.signatures` (the N2 review's I-1).
- A tap on Install marks the card as waiting for Android at once (`installing`), so Android's screens arriving before
  the app's answer cannot close it (the N2 review's #3).
- Tests: three pins (30–32), a node test of the reducer, a Jest test of the POS screen with the card.
- E8 (a print in flight) is pinned, not run on the emulator; E2's "no file left" is shown by the log (no root on this
  emulator image). Android's Play Protect may ask to scan the update: always **Install without scanning**, never
  **Scan app** (that sends the APK to Google).

**Expected counts** (baseline = N1's end): mobile `npm test` 154 → **167** (+6 pins 30–32 and their mutations, +7 the
reducer), Jest 5 → **7**, JUnit 82 → **92** (+3 Task 20, +7 Task 21), desktop 205 → 205, the cafe chain 5656 (5655 pass,
0 fail, 1 skipped) → unchanged, typecheck and lint clean in both apps.

Work in `D:\kd\lucifer` on `feat/native-apps-2`; `$SP` is the session's scratchpad. Always `GRADLE_USER_HOME='D:\gradle-home'`.
Tasks are numbered 20–26 (Session N2 = 2x), so `task-start <plan> 21` brings only this session's task. Every commit message goes in a scratch file and is committed with `git commit -F`, ending with the session prompt's
Co-Authored-By line.

### Task 20: Baseline, and the N1 review's fixes

**Files:**
- Modify: `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateManifest.kt` (m-3, m-4, m-5)
- Modify: `apps/mobile/android/app/build.gradle` (m-6: the guard's message), `apps/mobile/android/app/src/main/res/raw/pos_update_keep.xml` (m-7: its comment)
- Test: `apps/mobile/android/app/src/test/java/com/possoftware/pos/update/UpdateManifestTest.kt` (3 tests), `apps/mobile/src/mobile-paths.test.ts` (pin 28: one needle)

- [ ] **Step 1: Check the branch, the disks and every suite**

```bash
cd /d/kd/lucifer && git status --short && git branch --show-current && git log --oneline -3 && df -h /c /d
cd /d/kd/lucifer/apps/mobile && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck && npm run lint && npx jest 2>&1 | grep -E "^Tests:"
cd /d/kd/lucifer/apps/desktop && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck && npm run lint
cd /d/kd/lucifer/apps/cafe && npm test > "$SP/cafe-base.log" 2>&1; grep -E "^# (tests|pass|fail|skipped)" "$SP/cafe-base.log"
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --rerun --console=plain > "$SP/junit-base.log" 2>&1; tail -3 "$SP/junit-base.log"
cat app/build/test-results/testDebugUnitTest/*.xml | grep -o '<testsuite [^>]*' | sed -E 's/.*tests="([0-9]+)".*failures="([0-9]+)".*errors="([0-9]+)".*/\1 \2 \3/' | awk '{t+=$1; f+=$2; e+=$3} END {print "tests="t" failures="f" errors="e}'
```
Expected: clean, `feat/native-apps-2`, this gate's plan commit on top; mobile 154/154, typecheck and lint clean, Jest
`Tests: 5 passed`; desktop 205/205; cafe `# tests 5656`, `# pass 5655`, `# fail 0`, `# skipped 1`; JUnit
`tests=82 failures=0 errors=0`. The cafe chain takes several minutes: run that line in the background and wait
for its log with an until-loop (a foreground wait stops at 600 s).

- [ ] **Step 2: Write the failing tests**

In `apps/mobile/android/app/src/test/java/com/possoftware/pos/update/UpdateManifestTest.kt`, find:

```kotlin
    assertNull(UpdateManifest.codeOf("v2.0.0"))
  }
}

```

Replace it with:

```kotlin
    assertNull(UpdateManifest.codeOf("v2.0.0"))
  }

  // The N1 review gate (native apps 2.0, Session N2 Task 0): the review's m-3, m-4 and m-5.

  @Test
  fun aByteOrderMarkBeforeTheManifestIsRead() {
    // m-5: a file re-saved by an editor that writes a UTF-8 byte order mark is still the manifest.
    assertEquals(20100, offer("\uFEFF" + manifest()).versionCode)
  }

  @Test
  fun aNullNoteIsNoNote() {
    // m-4: notes are optional, and null says "none" as a missing field does.
    assertEquals("", offer(manifest { it.put("notes", JSONObject.NULL) }).notes)
  }

  @Test
  fun aFileNestedTooDeepIsIgnoredNeverACrash() {
    // m-3: the parser goes one call deeper per bracket, so a small file nested deep enough overflows the stack, an Error
    // (not a JSONException) that would end the updater's thread.
    ignored("not JSON", "{\"a\":" + "[".repeat(UpdateManifest.MAX_JSON_CHARS - 10))
  }
}

```

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
  need("def posReleaseKeyProps = ['POS_RELEASE_STORE_FILE', 'POS_RELEASE_STORE_PASSWORD', 'POS_RELEASE_KEY_ALIAS', 'POS_RELEASE_KEY_PASSWORD']", 'the guard does not check all four key properties');
  need('throw new GradleException("A release build needs the private Sandbee POS key', 'a release build without the key does not stop');
  need('if (!file(posReleaseStoreFile).isFile())', 'a missing key file is not caught before the build');
  const types = g.slice(Math.max(0, g.indexOf('buildTypes {')));
```

Replace it with:

```ts
  need("def posReleaseKeyProps = ['POS_RELEASE_STORE_FILE', 'POS_RELEASE_STORE_PASSWORD', 'POS_RELEASE_KEY_ALIAS', 'POS_RELEASE_KEY_PASSWORD']", 'the guard does not check all four key properties');
  need('throw new GradleException("A release build needs the private Sandbee POS key', 'a release build without the key does not stop');
  // The N1 review gate (m-6): the guard names the Gradle user home, not only this PC's folder.
  need('in gradle.properties in the Gradle user home (D:\\\\gradle-home on the build PC;', 'the guard sends another build PC to a folder it may not have');
  need('if (!file(posReleaseStoreFile).isFile())', 'a missing key file is not caught before the build');
  const types = g.slice(Math.max(0, g.indexOf('buildTypes {')));
```

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
    ["'POS_RELEASE_KEY_ALIAS', 'POS_RELEASE_KEY_PASSWORD']", "'POS_RELEASE_KEY_ALIAS']"],
    ['throw new GradleException("A release build needs', 'logger.warn("A release build needs'],
    ['if (!file(posReleaseStoreFile).isFile())', 'if (false)'],
  ]);
```

Replace it with:

```ts
    ["'POS_RELEASE_KEY_ALIAS', 'POS_RELEASE_KEY_PASSWORD']", "'POS_RELEASE_KEY_ALIAS']"],
    ['throw new GradleException("A release build needs', 'logger.warn("A release build needs'],
    ['in gradle.properties in the Gradle user home (', 'in ('],
    ['if (!file(posReleaseStoreFile).isFile())', 'if (false)'],
  ]);
```

- [ ] **Step 3: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin 28" src/mobile-paths.test.ts 2>&1 | grep -E "^not ok|^    0:|# (pass|fail)"
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --tests 'com.possoftware.pos.update.*' --console=plain 2>&1 | grep -E "FAILED|StackOverflowError|AssertionError|tests completed|^BUILD"
```
Expected: pin 28 and its mutation fail with `'the guard sends another build PC to a folder it may not have'`; JUnit
`20 tests completed, 3 failed`: `aByteOrderMarkBeforeTheManifestIsRead` and `aNullNoteIsNoNote` (AssertionError, no
offer), `aFileNestedTooDeepIsIgnoredNeverACrash` (`java.lang.StackOverflowError`), `BUILD FAILED`.

- [ ] **Step 4: Implement**

In `apps/mobile/android/app/build.gradle`, find:

```groovy
        def missing = posReleaseKeyProps.findAll { !findProperty(it) }
        if (!missing.isEmpty()) {
            throw new GradleException("A release build needs the private Sandbee POS key: set ${missing.join(', ')} in D:\\gradle-home\\gradle.properties (apps/mobile/README.md). It never signs with the debug key.")
        }
        if (!file(posReleaseStoreFile).isFile()) {
```

Replace it with:

```groovy
        def missing = posReleaseKeyProps.findAll { !findProperty(it) }
        if (!missing.isEmpty()) {
            throw new GradleException("A release build needs the private Sandbee POS key: set ${missing.join(', ')} in gradle.properties in the Gradle user home (D:\\gradle-home on the build PC; apps/mobile/README.md). It never signs with the debug key.")
        }
        if (!file(posReleaseStoreFile).isFile()) {
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateManifest.kt`, find:

```kotlin
  private val FILE = Regex("""[A-Za-z0-9][A-Za-z0-9._-]{0,98}\.apk""")
  private val SHA256 = Regex("""[0-9a-fA-F]{64}""")

  /** The newer release this device can install: the APK for its preferred CPU type. */
```

Replace it with:

```kotlin
  private val FILE = Regex("""[A-Za-z0-9][A-Za-z0-9._-]{0,98}\.apk""")
  private val SHA256 = Regex("""[0-9a-fA-F]{64}""")

  /** A UTF-8 byte order mark an editor may write before the text (the N1 review gate, m-5). */
  private const val BOM = "\uFEFF"

  /** The newer release this device can install: the APK for its preferred CPU type. */
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateManifest.kt`, find:

```kotlin
    if (json.length > MAX_JSON_CHARS) return Ignored("too large")
    val root = try {
      JSONObject(json)
    } catch (e: JSONException) {
      return Ignored("not JSON")
    }
```

Replace it with:

```kotlin
    if (json.length > MAX_JSON_CHARS) return Ignored("too large")
    val root = try {
      JSONObject(json.removePrefix(BOM))
    } catch (e: JSONException) {
      return Ignored("not JSON")
    } catch (e: StackOverflowError) {
      // The N1 review gate (m-3): the parser goes one call deeper per bracket; a file nested deep enough is not a
      // manifest, and must never end the updater's thread.
      return Ignored("not JSON")
    }
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateManifest.kt`, find:

```kotlin
    if (released == null || !DATE.matches(released)) return Ignored("released")
    val notes = when (val n = root.opt("notes")) {
      null -> ""
      is String -> if (n.length <= MAX_NOTES_CHARS) n.trim() else return Ignored("notes")
      else -> return Ignored("notes")
```

Replace it with:

```kotlin
    if (released == null || !DATE.matches(released)) return Ignored("released")
    val notes = when (val n = root.opt("notes")) {
      // The N1 review gate (m-4): null says "no notes", as a missing field does.
      null, JSONObject.NULL -> ""
      is String -> if (n.length <= MAX_NOTES_CHARS) n.trim() else return Ignored("notes")
      else -> return Ignored("notes")
```

In `apps/mobile/android/app/src/main/res/raw/pos_update_keep.xml`, find:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Native apps 2.0 (spec §4): the updater's settings stay in every release APK (build.gradle, posUpdateBase), so the
     release packaging can read the base back with aapt2. The build does not package this file itself. -->
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@string/pos_update_base,@integer/pos_update_check_minutes,@integer/pos_update_reopen_minutes" />
```

Replace it with:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Native apps 2.0 (spec §4): the updater's settings stay in every release APK (build.gradle, posUpdateBase), so the
     release packaging can read the base back with aapt2. A release build drops this file itself (the resource shrinker);
     a debug build carries it as R.raw.pos_update_keep. -->
<resources xmlns:tools="http://schemas.android.com/tools"
    tools:keep="@string/pos_update_base,@integer/pos_update_check_minutes,@integer/pos_update_reopen_minutes" />
```

- [ ] **Step 5: Run them and see them pass**

```bash
cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin 2[89]" src/mobile-paths.test.ts 2>&1 | grep -E "^not ok|^ok|# (pass|fail)"
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --tests 'com.possoftware.pos.update.*' --console=plain 2>&1 | grep -E "FAILED|^BUILD"
grep -o 'tests="[0-9]*" skipped="[0-9]*" failures="[0-9]*" errors="[0-9]*"' app/build/test-results/testDebugUnitTest/TEST-com.possoftware.pos.update.UpdateManifestTest.xml
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat assembleRelease --dry-run -PPOS_RELEASE_KEY_ALIAS= --console=plain 2>&1 | grep -E "needs the private Sandbee POS key|^BUILD"
```
Expected: pins 28 and 29 pass (4 tests); `BUILD SUCCESSFUL`; `tests="12" skipped="0" failures="0" errors="0"`; then
`A release build needs the private Sandbee POS key: set POS_RELEASE_KEY_ALIAS in gradle.properties in the Gradle user
home (D:\gradle-home on the build PC; apps/mobile/README.md). It never signs with the debug key.` and `BUILD FAILED`.

- [ ] **Step 6: Commit** (`git add` the five files; `$SP/msg-n2-0.txt`):

```text
fix(app): the N1 review's minors: a manifest with a byte order mark is read, a null note is no note, a manifest nested deep enough to overflow the parser's stack is ignored instead of ending the updater's thread (three JVM tests); the release-key guard names the Gradle user home, not only this PC's folder (a pin 28 needle); the keep file's comment says what a debug build carries (native apps 2.0, Session N2, the N1 review gate)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 21: `UpdateFiles`, the pure file rules (§4, §6.2)

**Files:**
- Create: `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateFiles.kt`
- Test: `apps/mobile/android/app/src/test/java/com/possoftware/pos/update/UpdateFilesTest.kt` (7 tests)

**Interfaces:** `UpdateFiles.manifestUrl(base)`, `apkUrl(base, file)`, `staleAfterUpdate(storedCode: Int?, installedCode: Int, fileExists: Boolean)`, `copyVerified(input, out, size, sha256): Boolean` (reads at most `size + 1` bytes).

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/android/app/src/test/java/com/possoftware/pos/update/UpdateFilesTest.kt`:

```kotlin
package com.possoftware.pos.update

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.MessageDigest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Native apps 2.0 (spec §4, §6.2): where the updater looks, when a kept download is stale, and the one copy that decides
 * whether a download is the manifest's APK: exactly its size, then its SHA-256. A dropped connection, a longer file or a
 * CDN's error page is never kept.
 */
class UpdateFilesTest {
  private val apk = ByteArray(200_000) { (it * 31 + 7).toByte() }
  private val sha = sha256(apk)

  private fun sha256(bytes: ByteArray): String =
      MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 0xFF) }

  /** Counts the bytes handed out, to prove the copy never reads far past the expected size. */
  private class Counting(bytes: ByteArray) : InputStream() {
    private val inner = ByteArrayInputStream(bytes)
    var count = 0
      private set

    override fun read(): Int = inner.read().also { if (it >= 0) count++ }

    override fun read(b: ByteArray, off: Int, len: Int): Int = inner.read(b, off, len).also { if (it > 0) count += it }
  }

  @Test
  fun theManifestAndAnApkAreAlwaysUnderTheBase() {
    assertEquals("https://files.sandbee.in/pos/android/latest.json", UpdateFiles.manifestUrl("https://files.sandbee.in/pos"))
    assertEquals("https://files.sandbee.in/pos/android/latest.json", UpdateFiles.manifestUrl("https://files.sandbee.in/pos/"))
    assertEquals(
        "http://127.0.0.1:8765/pos/android/Sandbee-POS-2.0.1-x86_64.apk",
        UpdateFiles.apkUrl("http://127.0.0.1:8765/pos", "Sandbee-POS-2.0.1-x86_64.apk"))
  }

  @Test
  fun aKeptDownloadIsStaleOnceTheAppIsThatVersionOrItsFileIsGone() {
    assertTrue("updated to it", UpdateFiles.staleAfterUpdate(20001, 20001, true))
    assertTrue("updated past it", UpdateFiles.staleAfterUpdate(20001, 20100, true))
    assertTrue("its file is gone", UpdateFiles.staleAfterUpdate(20100, 20001, false))
    assertFalse("newer and there: kept for the next open", UpdateFiles.staleAfterUpdate(20100, 20001, true))
    assertFalse("nothing kept: nothing to do", UpdateFiles.staleAfterUpdate(null, 20001, false))
  }

  @Test
  fun theManifestsBytesAreKept() {
    val out = ByteArrayOutputStream()
    assertTrue(UpdateFiles.copyVerified(ByteArrayInputStream(apk), out, apk.size, sha))
    assertArrayEquals(apk, out.toByteArray())
  }

  @Test
  fun oneByteChangedIsRefused() {
    val changed = apk.copyOf().also { it[123_456] = (it[123_456] + 1).toByte() }
    assertFalse(UpdateFiles.copyVerified(ByteArrayInputStream(changed), ByteArrayOutputStream(), apk.size, sha))
  }

  @Test
  fun aDroppedConnectionIsRefused() {
    val short = apk.copyOf(apk.size - 1)
    assertFalse(UpdateFiles.copyVerified(ByteArrayInputStream(short), ByteArrayOutputStream(), apk.size, sha))
  }

  @Test
  fun aLongerFileIsRefusedAfterOneByteMore() {
    val input = Counting(apk + ByteArray(50_000))
    assertFalse(UpdateFiles.copyVerified(input, ByteArrayOutputStream(), apk.size, sha))
    assertTrue("read at most size + 1 bytes, read " + input.count, input.count <= apk.size + 1)
  }

  @Test
  fun anErrorPageInsteadOfTheApkIsRefused() {
    val page = "<html><body>404 Not Found</body></html>".toByteArray()
    assertFalse(UpdateFiles.copyVerified(ByteArrayInputStream(page), ByteArrayOutputStream(), apk.size, sha))
  }
}
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --tests 'com.possoftware.pos.update.UpdateFilesTest' --console=plain 2>&1 | grep -E "Unresolved reference|^BUILD" | sed -E 's/.*(Unresolved reference [^.]*).*/\1/' | sort | uniq -c`
Expected: `Unresolved reference 'UpdateFiles'` (13 times) and `BUILD FAILED`.

- [ ] **Step 3: Implement**

Create `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateFiles.kt`:

```kotlin
package com.possoftware.pos.update

import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.Locale

/**
 * Native apps 2.0 (spec §4, §6.2): the updater's pure file rules. The manifest and every APK are under
 * `<base>/android/`, never at an address the manifest names; a kept download is stale once the app is that version, or
 * its file is gone; and a download is kept only when exactly the manifest's size came with the manifest's SHA-256.
 * Pure, so the JVM tests (src/test) pin each rule.
 */
object UpdateFiles {
  private const val BUFFER_BYTES = 64 * 1024
  private const val BYTE_MASK = 0xFF

  fun manifestUrl(base: String): String = base.trimEnd('/') + "/android/latest.json"

  /** [file] already passed [UpdateManifest]'s plain-name rule. */
  fun apkUrl(base: String, file: String): String = base.trimEnd('/') + "/android/" + file

  /** spec §6.2.6: a kept download goes at start-up once the app is that version (or newer), or once its file is gone.
   *  Nothing kept: nothing to do. */
  fun staleAfterUpdate(storedCode: Int?, installedCode: Int, fileExists: Boolean): Boolean =
      storedCode != null && (storedCode <= installedCode || !fileExists)

  /**
   * Copies [input] to [out] and reads at most [size] + 1 bytes: true only when exactly [size] bytes came and their
   * SHA-256 (lower-case hex) is [sha256]. A dropped connection (fewer), a longer file or an error page is false; the
   * caller then deletes what was written.
   */
  fun copyVerified(input: InputStream, out: OutputStream, size: Int, sha256: String): Boolean {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(BUFFER_BYTES)
    val limit = size.toLong() + 1
    var total = 0L
    while (total < limit) {
      val read = input.read(buffer, 0, minOf(buffer.size.toLong(), limit - total).toInt())
      if (read < 0) break
      total += read
      if (total > size) return false
      digest.update(buffer, 0, read)
      out.write(buffer, 0, read)
    }
    return total == size.toLong() && hex(digest.digest()) == sha256
  }

  private fun hex(bytes: ByteArray): String {
    val out = StringBuilder(bytes.size * 2)
    for (b in bytes) out.append(String.format(Locale.ROOT, "%02x", b.toInt() and BYTE_MASK))
    return out.toString()
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --tests 'com.possoftware.pos.update.*' --console=plain 2>&1 | grep -E "FAILED|^BUILD"; for f in app/build/test-results/testDebugUnitTest/TEST-com.possoftware.pos.update.*.xml; do grep -o 'name="[^"]*" tests="[0-9]*" skipped="[0-9]*" failures="[0-9]*" errors="[0-9]*"' "$f" | head -1; done`
Expected: `BUILD SUCCESSFUL`; `UpdateFilesTest` 7, `UpdateManifestTest` 12, `UpdateScheduleTest` 8, 0 failures, 0 errors.

- [ ] **Step 5: Commit** (`$SP/msg-n2-1.txt`):

```text
feat(app): the updater's pure file rules: the manifest and every APK only under <base>/android/ (never an address from the manifest), a kept download stale once the app is that version or its file is gone, and the one copy that keeps a download only when exactly the manifest's size came with the manifest's SHA-256, reading at most one byte more (a dropped connection, a longer file and an error page are refused); seven JVM tests (native apps 2.0, Session N2, spec §4, §6.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 22: `UpdateStore`, `UpdateDownloader`, `ApkCheck` (§6.1, §6.2)

**Files:**
- Create: `…/update/UpdateStore.kt`, `…/update/UpdateDownloader.kt`, `…/update/ApkCheck.kt`
- Test: `apps/mobile/src/mobile-paths.test.ts` (pin 30; these run on Android, so the emulator cases of Task 26 test them)

**Interfaces:** `UpdateStore` (preferences file `pos_update`: `lastCheckAt`/`setLastCheckAt`, `Verified`, `verified`/`saveVerified`/`clearVerified`, `updatesDir`, `deleteFilesExcept`, `startUp(ctx, installedCode)`); `UpdateDownloader.TAG = "PosUpdate"`, `fetchManifest(base): Fetched?` (`Fetched(status, body)`; null = no HTTP answer), `download(ctx, base, offer): File?`; `ApkCheck.matches(ctx, apk, offer)` (package, versionCode, the APK contents signers equal the installed app's; the archive is read with both signing flags for Android 9).

- [ ] **Step 1: Write the failing pin**

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
  everyMutationCaught(s => updateBaseProblems(gradle, s), keep, [['@integer/pos_update_reopen_minutes"', '"']]);
});

```

Replace it with:

```ts
  everyMutationCaught(s => updateBaseProblems(gradle, s), keep, [['@integer/pos_update_reopen_minutes"', '"']]);
});

// ── pin 30: native apps 2.0, the download path (Session N2) ─────────────────
// spec §4, §6.1, §6.2: the manifest and the APK come only from <base>/android/ (UpdateFiles), a download is kept only
// when its size and SHA-256 are the manifest's and then its package, version and signer are the installed app's
// (ApkCheck), and the updater keeps its own preferences file; a kept download is dropped once the app is that version.
const UPDATE_DIR = join(JAVA, 'com', 'possoftware', 'pos', 'update');
const upd = (name: string) => read(join(UPDATE_DIR, name));
interface DownloadSources {
  downloader: string;
  check: string;
  store: string;
}
function downloadProblems(s: DownloadSources): string[] {
  const out: string[] = [];
  const d = strip(s.downloader);
  const c = strip(s.check);
  const st = strip(s.store);
  const need = (text: string, needle: string, why: string) => {
    if (!text.includes(needle)) {
      out.push(why);
    }
  };
  need(d, 'URL(UpdateFiles.manifestUrl(base)).openConnection()', 'the manifest is not read from <base>/android/latest.json');
  need(d, 'URL(UpdateFiles.apkUrl(base, offer.file)).openConnection()', 'the APK is not read from <base>/android/<file>');
  need(d, 'private const val TIMEOUT_MS = 10_000', 'the requests do not time out after 10 s');
  need(d, 'UpdateStore.deleteFilesExcept(ctx, null)', 'a download does not start from an empty updates folder');
  need(d, 'UpdateFiles.copyVerified(input, out, offer.size, offer.sha256)', 'a download is not checked by size and SHA-256');
  const renamed = d.indexOf('if (!part.renameTo(apk))');
  const checked = d.indexOf('if (!ApkCheck.matches(ctx, apk, offer))');
  if (renamed < 0 || checked < 0 || checked < renamed) {
    out.push('the APK is not checked (package, version, signer) once complete');
  }
  need(c, 'if (archive.packageName != ctx.packageName) return false', 'an APK of another package is not refused');
  need(c, 'if (PackageInfoCompat.getLongVersionCode(archive) != offer.versionCode.toLong()) return false', 'an APK of another version is not refused');
  need(c, 'return theirs.isNotEmpty() && theirs == ours', 'an APK signed by another key is not refused');
  need(c, '.apkContentsSigners', 'the signers compared are not the APK contents signers');
  // The N1 review gate (the N2 review's I-1): Android 9 reads a downloaded APK's certificates only for GET_SIGNATURES.
  need(c, 'pm.getPackageArchiveInfo(apk.path, archiveFlags())', 'the downloaded APK is not read with the archive flags');
  need(c, 'private fun archiveFlags(): Int = signingFlags() or PackageManager.GET_SIGNATURES', 'Android 9 reads no certificates from a downloaded APK');
  need(c, 'info.signingInfo?.apkContentsSigners ?: info.signatures', 'an APK whose signing info is missing has no signers to compare');
  need(st, 'private const val FILE = "pos_update"', 'the updater does not keep its own preferences file');
  need(st, 'if (!File(updatesDir(ctx), file).isFile) return null', 'a kept update whose file is gone is still offered');
  need(st, 'if (UpdateFiles.staleAfterUpdate(code, installedCode, exists))', 'a kept download is not dropped once the app is that version');
  return out;
}
const downloadSources = (): DownloadSources => ({
  downloader: upd('UpdateDownloader.kt'),
  check: upd('ApkCheck.kt'),
  store: upd('UpdateStore.kt'),
});

test('pin 30: the download path: <base>/android/ only, size and SHA-256, then package, version and signer', () => {
  assert.deepEqual(downloadProblems(downloadSources()), []);
});

test('pin 30 mutation: every download needle can fail', () => {
  const base = downloadSources();
  const run = (key: keyof DownloadSources) => (text: string) => downloadProblems({ ...base, [key]: text });
  everyMutationCaught(run('downloader'), base.downloader, [
    ['URL(UpdateFiles.manifestUrl(base))', 'URL(base)'],
    ['URL(UpdateFiles.apkUrl(base, offer.file))', 'URL(offer.file)'],
    ['TIMEOUT_MS = 10_000', 'TIMEOUT_MS = 0'],
    ['UpdateStore.deleteFilesExcept(ctx, null)', 'dir.mkdirs()'],
    ['UpdateFiles.copyVerified(input, out, offer.size, offer.sha256)', 'input.copyTo(out) > 0'],
    ['if (!ApkCheck.matches(ctx, apk, offer))', 'if (false)'],
  ]);
  everyMutationCaught(run('check'), base.check, [
    ['if (archive.packageName != ctx.packageName) return false', ''],
    ['!= offer.versionCode.toLong()) return false', '== -1L) return false'],
    ['theirs.isNotEmpty() && theirs == ours', 'theirs.isNotEmpty()'],
    ['.apkContentsSigners', '.signingCertificateHistory'],
    ['getPackageArchiveInfo(apk.path, archiveFlags())', 'getPackageArchiveInfo(apk.path, signingFlags())'],
    ['signingFlags() or PackageManager.GET_SIGNATURES', 'signingFlags()'],
    ['?.apkContentsSigners ?: info.signatures', '?.apkContentsSigners'],
  ]);
  everyMutationCaught(run('store'), base.store, [
    ['FILE = "pos_update"', 'FILE = "pos_printer"'],
    ['if (!File(updatesDir(ctx), file).isFile) return null', ''],
    ['if (UpdateFiles.staleAfterUpdate(code, installedCode, exists))', 'if (false)'],
  ]);
});

```

- [ ] **Step 2: Run it and see it fail**

Run: `cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin 30" src/mobile-paths.test.ts 2>&1 | grep -E "^not ok|missing file|# (pass|fail)"`
Expected: both tests fail with `missing file: …\update\UpdateDownloader.kt`.

- [ ] **Step 3: Implement**

Create `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/ApkCheck.kt`:

```kotlin
package com.possoftware.pos.update

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import java.io.File

/**
 * Native apps 2.0 (spec §3, §6.1): a downloaded APK reaches the card only when it is this app (its package), the
 * manifest's version (its versionCode) and signed by the installed app's own key. Android would refuse an update signed
 * by another key anyway, but only after the user tapped Install; this check keeps such a file from ever being offered.
 */
object ApkCheck {
  fun matches(ctx: Context, apk: File, offer: UpdateManifest.Offer): Boolean {
    val pm = ctx.packageManager
    val archive = pm.getPackageArchiveInfo(apk.path, archiveFlags()) ?: return false
    if (archive.packageName != ctx.packageName) return false
    if (PackageInfoCompat.getLongVersionCode(archive) != offer.versionCode.toLong()) return false
    val installed =
        try {
          pm.getPackageInfo(ctx.packageName, signingFlags())
        } catch (e: PackageManager.NameNotFoundException) {
          return false
        }
    val theirs = signers(archive)
    val ours = signers(installed)
    return theirs.isNotEmpty() && theirs == ours
  }

  @Suppress("DEPRECATION") // GET_SIGNATURES is the only way below API 28
  private fun signingFlags(): Int =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
      else PackageManager.GET_SIGNATURES

  /** A downloaded APK: Android 9 reads an archive's certificates only when GET_SIGNATURES is asked for (Android 10 and
   *  later for either flag), so both are (the N1 review gate, the N2 review's I-1). */
  @Suppress("DEPRECATION")
  private fun archiveFlags(): Int = signingFlags() or PackageManager.GET_SIGNATURES

  /** The certificates the APK's contents are signed with now (not the past ones of a key rotation); the older field
   *  when the signing info is missing. */
  @Suppress("DEPRECATION") // PackageInfo.signatures is the only way below API 28
  private fun signers(info: PackageInfo): Set<String> {
    val certs: Array<Signature>? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.signingInfo?.apkContentsSigners ?: info.signatures
        else info.signatures
    return certs?.map { it.toCharsString() }?.toSet() ?: emptySet()
  }
}
```

Create `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateDownloader.kt`:

```kotlin
package com.possoftware.pos.update

import android.content.Context
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Native apps 2.0 (spec §6.1, §6.2): the updater's two requests, made on its own background thread ([PosUpdateModule];
 * never the main thread, never a printer's): `<base>/android/latest.json`, and the APK it names, streamed into
 * `filesDir/updates/<file>.part` and renamed only when its size and SHA-256 are the manifest's ([UpdateFiles]), then
 * kept only when [ApkCheck] agrees. Any failure leaves nothing behind; the next check tries again.
 */
object UpdateDownloader {
  const val TAG = "PosUpdate"
  private const val TIMEOUT_MS = 10_000
  private const val PART = ".part"

  /** The manifest request's answer: its HTTP status, and for a 200 its text (at most one character past a manifest's
   *  limit, so [UpdateManifest] can say "too large"). */
  data class Fetched(val status: Int, val body: String?)

  /** GET `<base>/android/latest.json`; null when no HTTP answer came (no network, a timeout, a refused connection). */
  fun fetchManifest(base: String): Fetched? {
    var conn: HttpURLConnection? = null
    return try {
      conn = URL(UpdateFiles.manifestUrl(base)).openConnection() as HttpURLConnection
      conn.connectTimeout = TIMEOUT_MS
      conn.readTimeout = TIMEOUT_MS
      conn.useCaches = false
      conn.setRequestProperty("Accept", "application/json")
      val status = conn.responseCode
      Fetched(status, if (status == HttpURLConnection.HTTP_OK) readCapped(conn) else null)
    } catch (e: IOException) {
      null
    } finally {
      conn?.disconnect()
    }
  }

  private fun readCapped(conn: HttpURLConnection): String {
    InputStreamReader(conn.inputStream, Charsets.UTF_8).use { reader ->
      val buffer = CharArray(UpdateManifest.MAX_JSON_CHARS + 1)
      var total = 0
      while (total < buffer.size) {
        val read = reader.read(buffer, total, buffer.size - total)
        if (read < 0) break
        total += read
      }
      return String(buffer, 0, total)
    }
  }

  /** Downloads [offer]'s APK into `updates/` and returns it once verified; null (nothing left behind) otherwise. */
  fun download(ctx: Context, base: String, offer: UpdateManifest.Offer): File? {
    val dir = UpdateStore.updatesDir(ctx)
    if (!dir.isDirectory && !dir.mkdirs()) return null
    UpdateStore.deleteFilesExcept(ctx, null)
    val part = File(dir, offer.file + PART)
    val apk = File(dir, offer.file)
    var conn: HttpURLConnection? = null
    try {
      conn = URL(UpdateFiles.apkUrl(base, offer.file)).openConnection() as HttpURLConnection
      conn.connectTimeout = TIMEOUT_MS
      conn.readTimeout = TIMEOUT_MS
      conn.useCaches = false
      val status = conn.responseCode
      if (status != HttpURLConnection.HTTP_OK) return failed(part, apk, "download: HTTP $status")
      val copied =
          conn.inputStream.use { input ->
            FileOutputStream(part).use { out -> UpdateFiles.copyVerified(input, out, offer.size, offer.sha256) }
          }
      if (!copied) return failed(part, apk, "download: the size or SHA-256 is not the manifest's")
      if (!part.renameTo(apk)) return failed(part, apk, "download: could not keep the file")
      if (!ApkCheck.matches(ctx, apk, offer)) return failed(part, apk, "download: the package, version or signer is not this app's")
      Log.i(TAG, "download: " + offer.version + " verified (" + offer.size + " bytes)")
      return apk
    } catch (e: IOException) {
      return failed(part, apk, "download: " + e.javaClass.simpleName)
    } finally {
      conn?.disconnect()
    }
  }

  private fun failed(part: File, apk: File, why: String): File? {
    part.delete()
    apk.delete()
    Log.i(TAG, why)
    return null
  }
}
```

Create `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateStore.kt`:

```kotlin
package com.possoftware.pos.update

import android.content.Context
import java.io.File

/**
 * Native apps 2.0 (spec §6.1): the updater's own memory, in its own private preferences file (never the printer's
 * Prefs): when it last looked, and the update downloaded and verified so far, whose file is in `filesDir/updates/`.
 * Thread-safe (SharedPreferences); the rules are [UpdateFiles]'.
 */
object UpdateStore {
  private const val FILE = "pos_update"
  private const val DIR = "updates"
  private const val KEY_LAST_CHECK = "last_check_at"
  private const val KEY_CODE = "verified_code"
  private const val KEY_VERSION = "verified_version"
  private const val KEY_NOTES = "verified_notes"
  private const val KEY_FILE = "verified_file"
  private const val KEY_SHA256 = "verified_sha256"

  /** An update downloaded and checked (size, SHA-256, package, version, signer), waiting for an app open. */
  data class Verified(val versionCode: Int, val version: String, val notes: String, val file: String, val sha256: String)

  private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun updatesDir(ctx: Context): File = File(ctx.applicationContext.filesDir, DIR)

  /** Wall time of the last manifest request that got an HTTP answer; 0 when never. */
  fun lastCheckAt(ctx: Context): Long = prefs(ctx).getLong(KEY_LAST_CHECK, 0L)

  fun setLastCheckAt(ctx: Context, wallMs: Long) {
    prefs(ctx).edit().putLong(KEY_LAST_CHECK, wallMs).apply()
  }

  /** The verified update, or null unless every field is there and its file still is. */
  fun verified(ctx: Context): Verified? {
    val p = prefs(ctx)
    val code = p.getInt(KEY_CODE, 0)
    val version = p.getString(KEY_VERSION, null)
    val notes = p.getString(KEY_NOTES, null)
    val file = p.getString(KEY_FILE, null)
    val sha256 = p.getString(KEY_SHA256, null)
    if (code <= 0 || version == null || notes == null || file == null || sha256 == null) return null
    if (!File(updatesDir(ctx), file).isFile) return null
    return Verified(code, version, notes, file, sha256)
  }

  fun saveVerified(ctx: Context, v: Verified) {
    prefs(ctx)
        .edit()
        .putInt(KEY_CODE, v.versionCode)
        .putString(KEY_VERSION, v.version)
        .putString(KEY_NOTES, v.notes)
        .putString(KEY_FILE, v.file)
        .putString(KEY_SHA256, v.sha256)
        .apply()
  }

  fun clearVerified(ctx: Context) {
    prefs(ctx).edit().remove(KEY_CODE).remove(KEY_VERSION).remove(KEY_NOTES).remove(KEY_FILE).remove(KEY_SHA256).apply()
  }

  /** Deletes every file in `updates/` but [keep]. */
  fun deleteFilesExcept(ctx: Context, keep: String?) {
    updatesDir(ctx).listFiles()?.forEach { if (it.name != keep) it.delete() }
  }

  /**
   * spec §6.2.6, once per process: a kept update the app now is (or is past), or whose file is gone, goes with its
   * entry; anything else in `updates/` (a download cut short by the process ending) goes too.
   */
  fun startUp(ctx: Context, installedCode: Int) {
    val p = prefs(ctx)
    val code = if (p.contains(KEY_CODE)) p.getInt(KEY_CODE, 0) else null
    val file = p.getString(KEY_FILE, null)
    val exists = file != null && File(updatesDir(ctx), file).isFile
    if (UpdateFiles.staleAfterUpdate(code, installedCode, exists)) {
      clearVerified(ctx)
      deleteFilesExcept(ctx, null)
    } else {
      deleteFilesExcept(ctx, if (code != null) file else null)
    }
  }
}
```

- [ ] **Step 4: Run the pin and compile**

```bash
cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin 30" src/mobile-paths.test.ts 2>&1 | grep -E "^not ok|^ok|# (pass|fail)"
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:compileDebugKotlin --rerun --console=plain 2>&1 | grep -E "^e:|^w:.*/update/|^BUILD"
```
Expected: pin 30 PASS (2 tests); `BUILD SUCCESSFUL`, no `e:` line and no warning in `update/`.

- [ ] **Step 5: Commit** (`$SP/msg-n2-2.txt`):

```text
feat(app): the updater's store, download and APK check: its own preferences file (the last look, the update verified so far), a download into filesDir/updates/ as a .part file kept only when its size and SHA-256 are the manifest's and then its package, versionCode and signing certificate are the installed app's, anything else deleted at once (Android 9 reads the downloaded APK's certificates only with GET_SIGNATURES, so both flags are asked), and a kept update dropped at start-up once the app is that version; 10-second timeouts, one log line per result (tag PosUpdate); pin 30 (native apps 2.0, Session N2, spec §6.1, §6.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 23: `UpdateInstaller`, `UpdateInstallReceiver`, the manifest (§6.2, §6.4)

**Files:**
- Create: `…/update/UpdateInstaller.kt`, `…/update/UpdateInstallReceiver.kt`
- Modify: `apps/mobile/android/app/src/main/AndroidManifest.xml` (`REQUEST_INSTALL_PACKAGES`; the receiver, after `PrintingOffReceiver`, self-closing: pin 6 reads receivers in order)
- Test: `apps/mobile/src/mobile-paths.test.ts` (pin 6 deliberately changed: two receivers; pin 31)

**Interfaces:** `UpdateInstaller.install(ctx, apk): InstallStart` with `enum class InstallStart(val answer: String) { STARTED("started"), NEEDS_PERMISSION("permission"), MISSING("missing"), FAILED("failed") }`; `UpdateInstallReceiver.onFailed: (() -> Unit)?`.

- [ ] **Step 1: Write the failing pins**

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
  // Session 3D (spec §9.5) deliberately changed: one receiver, the reboot and update notice ("POS printing is off. Tap to
  // start."), which hears only those two system broadcasts and never starts the app.
  const receivers = [
    ...x.matchAll(/<receiver\b[\s\S]*?<\/receiver>|<receiver\b[^>]*\/>/g),
  ].map(m => m[0]);
  if (
    receivers.length !== 1 ||
    !receivers[0].includes('android:name=".printer.PrintingOffReceiver"')
  ) {
    out.push('the one <receiver> is not PrintingOffReceiver');
  } else {
    for (const need of [
```

Replace it with:

```ts
  // Session 3D (spec §9.5) deliberately changed: one receiver, the reboot and update notice ("POS printing is off. Tap to
  // start."), which hears only those two system broadcasts and never starts the app.
  // Native apps 2.0 (Session N2) deliberately changed: a second receiver after it, Android's answer to an update install
  // the card started (never exported, no intent filter; pin 31).
  const receivers = [
    ...x.matchAll(/<receiver\b[\s\S]*?<\/receiver>|<receiver\b[^>]*\/>/g),
  ].map(m => m[0]);
  if (
    receivers.length !== 2 ||
    !receivers[0].includes('android:name=".printer.PrintingOffReceiver"') ||
    !receivers[1].includes('android:name=".update.UpdateInstallReceiver"')
  ) {
    out.push('the <receiver>s are not PrintingOffReceiver and UpdateInstallReceiver');
  } else {
    for (const need of [
```

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
const manifest = () => read(join(MAIN, 'AndroidManifest.xml'));

test('pin 6: AndroidManifest permissions, service, USB and one receiver (Session 3D)', () => {
  assert.deepEqual(manifestProblems(manifest()), []);
  const raw = manifest();
```

Replace it with:

```ts
const manifest = () => read(join(MAIN, 'AndroidManifest.xml'));

test('pin 6: AndroidManifest permissions, service, USB and two receivers (Session 3D, native apps 2.0)', () => {
  assert.deepEqual(manifestProblems(manifest()), []);
  const raw = manifest();
```

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
    ['if (UpdateFiles.staleAfterUpdate(code, installedCode, exists))', 'if (false)'],
  ]);
});

```

Replace it with:

```ts
    ['if (UpdateFiles.staleAfterUpdate(code, installedCode, exists))', 'if (false)'],
  ]);
});

// ── pin 31: native apps 2.0, the install path (Session N2) ──────────────────
// spec §6.2, §6.4, D3: an install starts only from the card's Install: the first time Android's "Install unknown apps"
// page for this app, then a PackageInstaller session that always asks in Android's own dialog, whose answer comes back
// to a receiver nobody else can reach.
interface InstallSources {
  installer: string;
  receiver: string;
  manifest: string;
}
function installProblems(s: InstallSources): string[] {
  const out: string[] = [];
  const i = strip(s.installer);
  const r = strip(s.receiver);
  const m = strip(s.manifest);
  const need = (text: string, needle: string, why: string) => {
    if (!text.includes(needle)) {
      out.push(why);
    }
  };
  need(i, 'if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !app.packageManager.canRequestPackageInstalls())', 'Android 8+ is not asked to allow installs first');
  need(i, 'Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + app.packageName))', 'the permission page is not this app\'s');
  need(i, 'params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)', 'an install may run without Android\'s own dialog');
  need(i, 'Intent(app, UpdateInstallReceiver::class.java)', 'the installer\'s answer does not come to this app\'s receiver');
  need(i, 'PendingIntent.FLAG_MUTABLE', 'the installer cannot add its answer on Android 12+');
  need(r, 'PackageInstaller.STATUS_PENDING_USER_ACTION ->', 'Android\'s install dialog is never shown');
  need(r, 'context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))', 'Android\'s install dialog is never shown');
  need(r, 'onFailed?.invoke()', 'a failed or cancelled install never reaches the card');
  need(m, '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />', 'REQUEST_INSTALL_PACKAGES missing');
  const receiver = /<receiver\b[^>]*android:name="\.update\.UpdateInstallReceiver"[^>]*\/>/.exec(m)?.[0];
  if (receiver === undefined || !receiver.includes('android:exported="false"')) {
    out.push('the install receiver is missing, has an intent filter, or is exported');
  }
  return out;
}
const installSources = (): InstallSources => ({
  installer: upd('UpdateInstaller.kt'),
  receiver: upd('UpdateInstallReceiver.kt'),
  manifest: read(join(MAIN, 'AndroidManifest.xml')),
});

test('pin 31: the install path: the permission page, Android\'s own dialog, a private answer', () => {
  assert.deepEqual(installProblems(installSources()), []);
});

test('pin 31 mutation: every install needle can fail', () => {
  const base = installSources();
  const run = (key: keyof InstallSources) => (text: string) => installProblems({ ...base, [key]: text });
  everyMutationCaught(run('installer'), base.installer, [
    ['&& !app.packageManager.canRequestPackageInstalls()', '&& false'],
    ['Uri.parse("package:" + app.packageName)', 'Uri.parse("package:com.example")'],
    ['USER_ACTION_REQUIRED)', 'USER_ACTION_NOT_REQUIRED)'],
    ['Intent(app, UpdateInstallReceiver::class.java)', 'Intent("com.possoftware.pos.UPDATE_STATUS")'],
    ['PendingIntent.FLAG_MUTABLE', 'PendingIntent.FLAG_IMMUTABLE'],
  ]);
  everyMutationCaught(run('receiver'), base.receiver, [
    ['PackageInstaller.STATUS_PENDING_USER_ACTION ->', 'PackageInstaller.STATUS_SUCCESS + 99 ->'],
    ['context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))', 'Unit'],
    ['onFailed?.invoke()', 'Unit'],
  ]);
  everyMutationCaught(run('manifest'), base.manifest, [
    ['android.permission.REQUEST_INSTALL_PACKAGES', 'android.permission.REQUEST_DELETE_PACKAGES'],
    ['android:name=".update.UpdateInstallReceiver"\n        android:exported="false"', 'android:name=".update.UpdateInstallReceiver"\n        android:exported="true"'],
  ]);
});

```

- [ ] **Step 2: Run them and see them fail**

Run: `cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin (6|31)" src/mobile-paths.test.ts 2>&1 | grep -E "^not ok|^    0:|missing file|# (pass|fail)"`
Expected: pin 6 and its mutation fail with `'the <receiver>s are not PrintingOffReceiver and UpdateInstallReceiver'`;
pin 31 and its mutation fail with `missing file: …\update\UpdateInstaller.kt`; `# fail 4`.

- [ ] **Step 3: Implement**

In `apps/mobile/android/app/src/main/AndroidManifest.xml`, find:

```xml
        android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"
        tools:ignore="BatteryLife" />

    <uses-feature android:name="android.hardware.bluetooth" android:required="false" />
```

Replace it with:

```xml
        android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"
        tools:ignore="BatteryLife" />
    <!-- Native apps 2.0 (spec §6.4): the app installs its own verified update, only after a tap on the update card. -->
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />

    <uses-feature android:name="android.hardware.bluetooth" android:required="false" />
```

In `apps/mobile/android/app/src/main/AndroidManifest.xml`, find:

```xml
        </intent-filter>
      </receiver>
    </application>
</manifest>
```

Replace it with:

```xml
        </intent-filter>
      </receiver>
      <!-- Native apps 2.0 (spec §6.2): Android's answer to an update install the card started; never exported. -->
      <receiver
        android:name=".update.UpdateInstallReceiver"
        android:exported="false" />
    </application>
</manifest>
```

Create `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateInstallReceiver.kt`:

```kotlin
package com.possoftware.pos.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log

/**
 * Native apps 2.0 (spec §6.2): Android's answer to the install the card started. Not exported: only the installer's
 * PendingIntent ([UpdateInstaller]) reaches it. "The user must confirm" opens Android's own install dialog; success
 * needs nothing (the update is replacing this app); a failure, or Cancel in that dialog, tells the card ([onFailed]) and
 * keeps the file, so the next app open offers the card again.
 */
class UpdateInstallReceiver : BroadcastReceiver() {
  companion object {
    /** Set by [PosUpdateModule] while React runs. */
    @Volatile var onFailed: (() -> Unit)? = null
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        val confirm = confirmIntent(intent)
        if (confirm == null) {
          failed("install: no confirm screen")
          return
        }
        try {
          context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: RuntimeException) {
          failed("install: the confirm screen did not open")
        }
      }
      PackageInstaller.STATUS_SUCCESS -> Log.i(UpdateDownloader.TAG, "install: done")
      else -> failed("install: status $status")
    }
  }

  private fun failed(why: String) {
    Log.i(UpdateDownloader.TAG, why)
    onFailed?.invoke()
  }

  @Suppress("DEPRECATION") // the typed overload exists from API 33
  private fun confirmIntent(intent: Intent): Intent? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
      } else {
        intent.getParcelableExtra(Intent.EXTRA_INTENT)
      }
}
```

Create `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateInstaller.kt`:

```kotlin
package com.possoftware.pos.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import java.io.File
import java.io.FileInputStream
import java.io.IOException

/**
 * Native apps 2.0 (spec §6.1, §6.2, §6.4): installs the verified update, only ever from a tap on the card's Install
 * ([PosUpdateModule.install]). The first time, Android must let this app install apps, so its "Install unknown apps"
 * page opens; then a PackageInstaller session hands the file to Android, whose own dialog asks once more
 * ([UpdateInstallReceiver] shows it). The update ends the running app, as every app update does.
 */
object UpdateInstaller {
  /** What a tap on Install started; [answer] is what the card hears. */
  enum class InstallStart(val answer: String) {
    STARTED("started"),
    NEEDS_PERMISSION("permission"),
    MISSING("missing"),
    FAILED("failed"),
  }

  private const val SESSION_FILE = "update.apk"
  private const val STATUS_REQUEST = 4104

  fun install(ctx: Context, apk: File): InstallStart {
    val app = ctx.applicationContext
    if (!apk.isFile) return InstallStart.MISSING
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !app.packageManager.canRequestPackageInstalls()) {
      val settings =
          Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + app.packageName))
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      app.startActivity(settings)
      return InstallStart.NEEDS_PERMISSION
    }
    val installer = app.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
    params.setAppPackageName(app.packageName)
    params.setSize(apk.length())
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // Always Android's own dialog, never an install without the user's tap there (spec D3).
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
    }
    val id = installer.createSession(params)
    return try {
      installer.openSession(id).use { session ->
        FileInputStream(apk).use { input ->
          session.openWrite(SESSION_FILE, 0, apk.length()).use { out ->
            input.copyTo(out)
            session.fsync(out)
          }
        }
        session.commit(statusIntent(app).intentSender)
      }
      InstallStart.STARTED
    } catch (e: IOException) {
      installer.abandonSession(id)
      InstallStart.FAILED
    } catch (e: SecurityException) {
      installer.abandonSession(id)
      InstallStart.FAILED
    }
  }

  /** The installer adds its answer to this intent, so it is mutable on Android 12+; it names this app's own receiver,
   *  as Android 14 requires of a mutable PendingIntent. */
  private fun statusIntent(app: Context): PendingIntent {
    val intent = Intent(app, UpdateInstallReceiver::class.java)
    val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    return PendingIntent.getBroadcast(app, STATUS_REQUEST, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutable)
  }
}
```

- [ ] **Step 4: Run the pins and compile**

```bash
cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin (6|31)" src/mobile-paths.test.ts 2>&1 | grep -E "^not ok|^ok|# (pass|fail)"
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:compileDebugKotlin --rerun --console=plain 2>&1 | grep -E "^e:|^w:.*/update/|^BUILD"
```
Expected: 4 PASS; `BUILD SUCCESSFUL`, no `e:` line and no warning in `update/`.

- [ ] **Step 5: Commit** (`$SP/msg-n2-3.txt`):

```text
feat(app): installing a verified update, only from a tap on the card: the first time Android's "Install unknown apps" page for this app, then a PackageInstaller session that always asks in Android's own dialog (USER_ACTION_REQUIRED), whose answer comes back to a receiver no other app can reach (a cancel or a failure tells the card, success needs nothing); REQUEST_INSTALL_PACKAGES; pin 6 deliberately changed (two receivers) and pin 31 (native apps 2.0, Session N2, spec §6.2, §6.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 24: `PosUpdateModule`, its package and its JS wrapper (§6)

**Files:**
- Create: `…/update/PosUpdateModule.kt`, `…/update/PosUpdatePackage.kt`, `apps/mobile/src/native/PosUpdate.ts`
- Modify: `apps/mobile/android/app/src/main/java/com/possoftware/pos/MainApplication.kt` (`add(PosUpdatePackage())`), `…/printer/PrinterManager.kt` (`isPrinting()`), `…/printer/PrinterPool.kt` (`anyPrinting()`)
- Test: `apps/mobile/src/mobile-paths.test.ts` (pin 32)

**Interfaces:** NativeModules.PosUpdate: `takeCard(): Promise<{ version, notes } | null>` (main thread; at most once per open; while a printer has a job in flight it resolves null and the card follows as the event `PosUpdateCard` once the printers are idle, while the app stays in view), `install(): Promise<"started" | "permission" | "missing" | "failed">` (waits up to 30 s for the printers), `later(): void`; event `PosUpdateResult` `{ ok: false }` (a failed or cancelled install). JS: `PosUpdate`, `UpdateCardInfo`, `InstallAnswer`, `UPDATE_CARD_EVENT`, `UPDATE_RESULT_EVENT`. Log tag `PosUpdate`: `open`, `check: …`, `download: …`, `card: …`, `install: …`.

- [ ] **Step 1: Write the failing pin**

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
    ['android:name=".update.UpdateInstallReceiver"\n        android:exported="false"', 'android:name=".update.UpdateInstallReceiver"\n        android:exported="true"'],
  ]);
});

```

Replace it with:

```ts
    ['android:name=".update.UpdateInstallReceiver"\n        android:exported="false"', 'android:name=".update.UpdateInstallReceiver"\n        android:exported="true"'],
  ]);
});

// ── pin 32: native apps 2.0, the updater module (Session N2) ────────────────
// spec §6, D3: NativeModules.PosUpdate offers the card at most once per app open and only while no printer of this app
// has a job in flight; it looks for an update only at an open; its base comes only from the build setting
// (R.string.pos_update_base, pin 29); its schedule is touched on the main thread only (the N1 review's I-2), with the
// clock that counts deep sleep; and MainApplication registers it next to the printer module.
const UPDATE_METHOD_ORACLE = ['takeCard', 'install', 'later'];
interface UpdateModuleSources {
  module: string;
  js: string;
  app: string;
  pool: string;
  manager: string;
  updateKt: string;
}
function updateModuleProblems(s: UpdateModuleSources): string[] {
  const out: string[] = [];
  const k = strip(s.module);
  const j = strip(s.js);
  const need = (text: string, needle: string, why: string) => {
    if (!text.includes(needle)) {
      out.push(why);
    }
  };
  const kotlin = [...k.matchAll(/@ReactMethod\s+fun\s+(\w+)\s*\(/g)].map(m => m[1]);
  const calls = [...j.matchAll(/\bcall\(\s*'(\w+)'/g)].map(m => m[1]);
  const iface = /export interface PosUpdateModule\s*\{([\s\S]*?)\n\}/.exec(j);
  const declared = iface ? [...iface[1].matchAll(/^ {2}(\w+)\(/gm)].map(m => m[1]) : [];
  out.push(...setProblems('kotlin vs update oracle', kotlin, UPDATE_METHOD_ORACLE));
  out.push(...setProblems('js calls vs update oracle', calls, UPDATE_METHOD_ORACLE));
  out.push(...setProblems('js interface vs update oracle', declared, UPDATE_METHOD_ORACLE));
  need(k, 'const val NAME = "PosUpdate"', 'the Kotlin module is not PosUpdate');
  need(j, 'NativeModules as { PosUpdate?:', 'the JS wrapper does not look up PosUpdate');
  need(k, 'reactContext.getString(R.string.pos_update_base)', 'the base is not the build setting');
  if (/"https?:\/\//.test(strip(s.updateKt))) {
    out.push('an address literal in the updater');
  }
  need(k, 'if (open && schedule.checkDue(System.currentTimeMillis(), UpdateStore.lastCheckAt(reactContext))) check()', 'a look is not tied to an app open');
  if ((k.match(/[^\w.]check\(\)/g) ?? []).length !== 2) {
    out.push('check() is called from somewhere other than an app open');
  }
  need(k, 'schedule.shown(SystemClock.elapsedRealtime(), ', 'an open is not timed with elapsedRealtime');
  need(k, 'schedule.hidden(SystemClock.elapsedRealtime())', 'going away is not timed with elapsedRealtime');
  need(k, 'fun takeCard(promise: Promise) {\n    UiThreadUtil.runOnUiThread(', 'takeCard touches the schedule off the main thread');
  need(k, 'PrinterPool.anyPrinting() -> {', 'the card does not wait for a print in flight');
  need(k, 'while (PrinterPool.anyPrinting() && waited < INSTALL_IDLE_WAIT_MS)', 'Install does not wait for a print in flight');
  need(k, '} catch (t: Throwable) {\n        Log.i(TAG, "check: "', 'a failed look can end the updater thread');
  need(strip(s.pool), 'fun anyPrinting(): Boolean = managers().any { it.isPrinting() }', 'the printers cannot say a job is in flight');
  need(strip(s.manager), 'fun isPrinting(): Boolean = printing.get()', 'a printer cannot say a job is in flight');
  const app = strip(s.app);
  if (!/^\s*add\(PosUpdatePackage\(\)\)\s*$/m.test(app) || !/^import com\.possoftware\.pos\.update\.PosUpdatePackage\s*$/m.test(app)) {
    out.push('MainApplication does not register PosUpdatePackage');
  }
  return out;
}
const updateModuleSources = (): UpdateModuleSources => ({
  module: upd('PosUpdateModule.kt'),
  js: read(join(SRC, 'native', 'PosUpdate.ts')),
  app: read(join(JAVA, 'com', 'possoftware', 'pos', 'MainApplication.kt')),
  pool: kt('PrinterPool.kt'),
  manager: kt('PrinterManager.kt'),
  updateKt: Object.values(loadAll(listFiles(UPDATE_DIR, isKt))).join('\n'),
});

test('pin 32: the updater module: once per open, after a print, looks only at an open, the main thread, registered', () => {
  assert.deepEqual(updateModuleProblems(updateModuleSources()), []);
});

test('pin 32 mutation: every module needle can fail', () => {
  const base = updateModuleSources();
  const run = (key: keyof UpdateModuleSources) => (text: string) => updateModuleProblems({ ...base, [key]: text });
  everyMutationCaught(run('module'), base.module, [
    ['@ReactMethod\n  fun later(', 'fun later('],
    ['const val NAME = "PosUpdate"', 'const val NAME = "PosUpdates"'],
    ['reactContext.getString(R.string.pos_update_base)', '"https://files.sandbee.in/pos"'],
    ['if (open && schedule.checkDue(', 'if (schedule.checkDue('],
    ['    schedule.hidden(SystemClock.elapsedRealtime())\n', '    schedule.hidden(SystemClock.elapsedRealtime())\n    check()\n'],
    ['schedule.shown(SystemClock.elapsedRealtime(), ', 'schedule.shown(System.currentTimeMillis(), '],
    ['schedule.hidden(SystemClock.elapsedRealtime())', 'schedule.hidden(System.currentTimeMillis())'],
    ['fun takeCard(promise: Promise) {\n    UiThreadUtil.runOnUiThread(', 'fun takeCard(promise: Promise) {\n    worker.execute('],
    ['PrinterPool.anyPrinting() -> {', 'false -> {'],
    ['while (PrinterPool.anyPrinting() && waited', 'while (false && waited'],
    ['} catch (t: Throwable) {\n        Log.i(TAG, "check: "', '} catch (t: Exception) {\n        Log.i(TAG, "check: "'],
  ]);
  everyMutationCaught(run('js'), base.js, [
    ["call('install')", "call('installNow')"],
    ['NativeModules as { PosUpdate?:', 'NativeModules as { PosUpdater?:'],
  ]);
  everyMutationCaught(run('app'), base.app, [['add(PosUpdatePackage())', '// add(PosUpdatePackage())']]);
  everyMutationCaught(run('pool'), base.pool, [['managers().any { it.isPrinting() }', 'false']]);
  everyMutationCaught(run('manager'), base.manager, [['= printing.get()', '= false']]);
  everyMutationCaught(run('updateKt'), base.updateKt, [['const val TAG = "PosUpdate"', 'const val TAG = "PosUpdate"\n  const val HOST = "https://files.sandbee.in"']]);
});

```

- [ ] **Step 2: Run it and see it fail**

Run: `cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin 32" src/mobile-paths.test.ts 2>&1 | grep -E "^not ok|missing file|# (pass|fail)"`
Expected: both tests fail with `missing file: …\update\PosUpdateModule.kt`.

- [ ] **Step 3: Implement**

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/MainApplication.kt`, find:

```kotlin
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.possoftware.pos.printer.PosPrinterPackage

class MainApplication : Application(), ReactApplication {
```

Replace it with:

```kotlin
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.possoftware.pos.printer.PosPrinterPackage
import com.possoftware.pos.update.PosUpdatePackage

class MainApplication : Application(), ReactApplication {
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/MainApplication.kt`, find:

```kotlin
          // add(MyReactNativePackage())
          add(PosPrinterPackage())
        },
    )
```

Replace it with:

```kotlin
          // add(MyReactNativePackage())
          add(PosPrinterPackage())
          // Native apps 2.0 (spec §6): the updater.
          add(PosUpdatePackage())
        },
    )
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/PrinterManager.kt`, find:

```kotlin
  /** This printer's state as the page reads it ("none" only once it left the list). */
  fun state(): String = synchronized(lock) { state }

  /** The transport of a CONNECTED printer, else null. */
```

Replace it with:

```kotlin
  /** This printer's state as the page reads it ("none" only once it left the list). */
  fun state(): String = synchronized(lock) { state }

  /** Native apps 2.0 (spec §6.3): a job is being sent to this printer now (the update card and its install wait). */
  fun isPrinting(): Boolean = printing.get()

  /** The transport of a CONNECTED printer, else null. */
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/printer/PrinterPool.kt`, find:

```kotlin
  fun managers(): List<PrinterManager> = synchronized(poolLock) { list.all() }

  /** v2 select: [info] joins the list, its printer started anew (a listed one is replaced in its place). */
  fun add(info: PrinterInfo): PrinterManager {
```

Replace it with:

```kotlin
  fun managers(): List<PrinterManager> = synchronized(poolLock) { list.all() }

  /** Native apps 2.0 (spec §6.3): any printer of this app has a job in flight (the update card and its install wait). */
  fun anyPrinting(): Boolean = managers().any { it.isPrinting() }

  /** v2 select: [info] joins the list, its printer started anew (a listed one is replaced in its place). */
  fun add(info: PrinterInfo): PrinterManager {
```

Create `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`:

```kotlin
package com.possoftware.pos.update

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.possoftware.pos.BuildConfig
import com.possoftware.pos.R
import com.possoftware.pos.printer.PrinterPool
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * NativeModules.PosUpdate (spec §6): the Android updater at run time. At an app open ([UpdateSchedule]: the first view
 * after the process started, or back after 30 minutes away) it looks for an update when its last look is 12 hours old,
 * on its own background thread: `latest.json` ([UpdateManifest]), then the APK it names ([UpdateDownloader], [ApkCheck]).
 * The card ([takeCard]) goes to the POS screen at most once per open, only for an update verified before that open, and
 * only while no printer of this app has a job in flight (otherwise it follows as [CARD_EVENT] once they are idle, while
 * the app stays in view). [install] starts Android's installer only from a tap on the card. Never a blocking screen,
 * never an install without a tap (spec D3).
 *
 * Threads: the lifecycle callbacks and [takeCard] run on the main thread, the only one that touches [schedule] and
 * [waiting] (the N1 review's I-2); the requests and the install run on [worker].
 */
class PosUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

  companion object {
    const val NAME = "PosUpdate"
    const val CARD_EVENT = "PosUpdateCard"
    const val RESULT_EVENT = "PosUpdateResult"
    private const val TAG = UpdateDownloader.TAG
    private const val MINUTE_MS = 60_000L
    private const val IDLE_POLL_MS = 2_000L
    private const val INSTALL_IDLE_WAIT_MS = 30_000L
    private const val INSTALL_IDLE_POLL_MS = 500L
  }

  private val installedCode = BuildConfig.VERSION_CODE
  private val base = reactContext.getString(R.string.pos_update_base)
  private val schedule =
      UpdateSchedule(
          installedCode,
          reactContext.resources.getInteger(R.integer.pos_update_check_minutes) * MINUTE_MS,
          reactContext.resources.getInteger(R.integer.pos_update_reopen_minutes) * MINUTE_MS,
      )
  private val worker: ExecutorService =
      Executors.newSingleThreadExecutor { r -> Thread(r, "pos-update").apply { isDaemon = true } }
  private val checking = AtomicBoolean(false)
  private val main = Handler(Looper.getMainLooper())
  private var waiting: UpdateStore.Verified? = null

  override fun getName(): String = NAME

  override fun initialize() {
    UpdateStore.startUp(reactContext, installedCode)
    UpdateInstallReceiver.onFailed = { emitResult(false) }
    reactContext.addLifecycleEventListener(this)
  }

  override fun invalidate() {
    UpdateInstallReceiver.onFailed = null
    reactContext.removeLifecycleEventListener(this)
    main.removeCallbacksAndMessages(null)
    worker.shutdown()
  }

  override fun onHostResume() {
    val open = schedule.shown(SystemClock.elapsedRealtime(), UpdateStore.verified(reactContext)?.versionCode)
    if (open) Log.i(TAG, "open")
    if (open && schedule.checkDue(System.currentTimeMillis(), UpdateStore.lastCheckAt(reactContext))) check()
  }

  override fun onHostPause() {
    schedule.hidden(SystemClock.elapsedRealtime())
    waiting = null
    main.removeCallbacksAndMessages(null)
  }

  override fun onHostDestroy() {
    onHostPause()
  }

  /** One look at a time, on [worker]. Any failure (no network, a bad file, an Error) only logs; the next open tries
   *  again. */
  private fun check() {
    if (!checking.compareAndSet(false, true)) return
    worker.execute {
      try {
        lookAndDownload()
      } catch (t: Throwable) {
        Log.i(TAG, "check: " + t.javaClass.simpleName)
      } finally {
        checking.set(false)
      }
    }
  }

  private fun lookAndDownload() {
    val fetched = UpdateDownloader.fetchManifest(base)
    if (fetched == null) {
      Log.i(TAG, "check: no answer")
      return
    }
    // Any HTTP answer counts as a look (a network error looks again at the next open).
    UpdateStore.setLastCheckAt(reactContext, System.currentTimeMillis())
    val body = fetched.body
    if (body == null) {
      Log.i(TAG, "check: HTTP " + fetched.status)
      return
    }
    when (val result = UpdateManifest.read(body, reactContext.packageName, installedCode, Build.SUPPORTED_ABIS.toList())) {
      is UpdateManifest.Ignored -> Log.i(TAG, "check: ignored (" + result.reason + ")")
      is UpdateManifest.Accepted -> {
        val offer = result.offer
        val kept = UpdateStore.verified(reactContext)
        if (kept != null && kept.versionCode == offer.versionCode && kept.sha256 == offer.sha256) {
          Log.i(TAG, "check: " + offer.version + " is ready")
          return
        }
        UpdateStore.clearVerified(reactContext)
        val apk = UpdateDownloader.download(reactContext, base, offer) ?: return
        UpdateStore.saveVerified(
            reactContext,
            UpdateStore.Verified(offer.versionCode, offer.version, offer.notes, apk.name, offer.sha256),
        )
      }
    }
  }

  /** spec §6.3: the card for this app open, at most once; null when there is none. While a printer of this app has a
   *  job in flight the card waits, and follows as [CARD_EVENT] once every printer is idle, if the app is still in view
   *  (going away drops it). */
  @ReactMethod
  fun takeCard(promise: Promise) {
    UiThreadUtil.runOnUiThread(
        Runnable {
          val code = schedule.takeCard()
          val update = UpdateStore.verified(reactContext)?.takeIf { it.versionCode == code }
          when {
            update == null -> promise.resolve(null)
            PrinterPool.anyPrinting() -> {
              Log.i(TAG, "card: waits for a print")
              waiting = update
              main.postDelayed({ offerWhenIdle() }, IDLE_POLL_MS)
              promise.resolve(null)
            }
            else -> {
              Log.i(TAG, "card: " + update.version)
              promise.resolve(cardOf(update))
            }
          }
        }
    )
  }

  private fun offerWhenIdle() {
    val update = waiting ?: return
    if (PrinterPool.anyPrinting()) {
      main.postDelayed({ offerWhenIdle() }, IDLE_POLL_MS)
      return
    }
    waiting = null
    Log.i(TAG, "card: " + update.version + " after the print")
    reactContext.emitDeviceEvent(CARD_EVENT, cardOf(update))
  }

  /** Only from a tap on the card's Install: waits up to 30 s for the printers to be idle, then hands the verified file
   *  to Android's installer. Resolves "started", "permission", "missing" or "failed". */
  @ReactMethod
  fun install(promise: Promise) {
    worker.execute {
      val start =
          try {
            var waited = 0L
            while (PrinterPool.anyPrinting() && waited < INSTALL_IDLE_WAIT_MS) {
              Thread.sleep(INSTALL_IDLE_POLL_MS)
              waited += INSTALL_IDLE_POLL_MS
            }
            val update = UpdateStore.verified(reactContext)
            if (update == null) {
              UpdateInstaller.InstallStart.MISSING
            } else {
              UpdateInstaller.install(reactContext, File(UpdateStore.updatesDir(reactContext), update.file))
            }
          } catch (t: Throwable) {
            UpdateInstaller.InstallStart.FAILED
          }
      Log.i(TAG, "install: " + start.answer)
      promise.resolve(start.answer)
    }
  }

  /** Later on the card: nothing to keep (the next app open offers it again). */
  @ReactMethod
  fun later() {
    Log.i(TAG, "card: later")
  }

  private fun cardOf(update: UpdateStore.Verified): WritableMap =
      Arguments.createMap().apply {
        putString("version", update.version)
        putString("notes", update.notes)
      }

  private fun emitResult(ok: Boolean) {
    reactContext.emitDeviceEvent(RESULT_EVENT, Arguments.createMap().apply { putBoolean("ok", ok) })
  }
}
```

Create `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdatePackage.kt`:

```kotlin
package com.possoftware.pos.update

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Native apps 2.0 (spec §6): registers the legacy (non-Turbo) PosUpdate module; the interop layer serves it under
 *  Fabric, as PosPrinterPackage does. */
class PosUpdatePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == PosUpdateModule.NAME) PosUpdateModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
      ReactModuleInfoProvider {
        mapOf(
            PosUpdateModule.NAME to
                ReactModuleInfo(
                    PosUpdateModule.NAME,
                    PosUpdateModule::class.java.name,
                    false, // canOverrideExistingModule
                    false, // needsEagerInit
                    false, // isCxxModule
                    false, // isTurboModule: legacy module through the interop layer
                )
        )
      }
}
```

Create `apps/mobile/src/native/PosUpdate.ts`:

```ts
// Typed wrapper around the Kotlin module NativeModules.PosUpdate (native apps 2.0, spec §6): the update card offered at
// an app open. When the module is missing (iOS, tests) nothing is offered: no card, nothing to install. A call never
// rejects: a failed takeCard is no card, a failed install is "failed".

import { NativeModules } from 'react-native';

/** What the card shows: the verified update's version and its notes ("" when none). */
export type UpdateCardInfo = { version: string; notes: string };

/** What a tap on Install started (Kotlin's UpdateInstaller.InstallStart). */
export type InstallAnswer = 'started' | 'permission' | 'missing' | 'failed';

export interface PosUpdateModule {
  takeCard(): Promise<UpdateCardInfo | null>;
  install(): Promise<InstallAnswer>;
  later(): void;
}

/** Kotlin's PosUpdateModule.CARD_EVENT: a card that waited for a print to finish. */
export const UPDATE_CARD_EVENT = 'PosUpdateCard';
/** Kotlin's PosUpdateModule.RESULT_EVENT: Android's installer failed, or the user cancelled its dialog. */
export const UPDATE_RESULT_EVENT = 'PosUpdateResult';

type MethodName = keyof PosUpdateModule;

// Looked up per call so a late-registered or test-stubbed module is found.
function call<M extends MethodName>(
  name: M,
): ReturnType<PosUpdateModule[M]> | undefined {
  const module = (NativeModules as { PosUpdate?: Partial<PosUpdateModule> })
    .PosUpdate;
  const fn = module?.[name] as
    | (() => ReturnType<PosUpdateModule[M]>)
    | undefined;
  if (typeof fn !== 'function') {
    return undefined;
  }
  try {
    return fn.apply(module);
  } catch {
    return undefined;
  }
}

export const PosUpdate: PosUpdateModule = {
  takeCard: () => (call('takeCard') ?? Promise.resolve(null)).catch(() => null),
  install: () =>
    (call('install') ?? Promise.resolve<InstallAnswer>('missing')).catch(
      (): InstallAnswer => 'failed',
    ),
  later: () => {
    call('later');
  },
};
```

- [ ] **Step 4: Run the pins, the suite, typecheck, lint and compile**

```bash
cd /d/kd/lucifer/apps/mobile && node --import tsx --test --test-name-pattern "pin (4|5|19|32)" src/mobile-paths.test.ts 2>&1 | grep -E "^not ok|^ok|# (pass|fail)"
npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck && npm run lint
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:compileDebugKotlin --rerun --console=plain 2>&1 | grep -E "^e:|^w:.*/(update|printer/Printer(Pool|Manager))|^BUILD"
```
Expected: pins 4, 5, 19, 32 PASS (8 tests); mobile `# tests 160`, `# fail 0`; typecheck and lint clean; `BUILD SUCCESSFUL`, no `e:` line and no warning in those files.

- [ ] **Step 5: Commit** (`$SP/msg-n2-4.txt`):

```text
feat(app): the updater at run time, NativeModules.PosUpdate: at an app open it looks for an update when its last look is 12 hours old, on its own thread (latest.json, then the APK it names, verified); the card goes to the POS screen at most once per open, only for an update verified before that open, on the main thread, and while a printer of this app has a job in flight it waits until the printers are idle; Install waits up to 30 s for them, then starts Android's installer; the base only from the build setting; registered next to the printer module; pin 32 (native apps 2.0, Session N2, spec §6, the N1 review's I-2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 25: The card (§6.3)

**Files:**
- Create: `apps/mobile/src/update-card.ts`, `apps/mobile/src/screens/UpdateCard.tsx`
- Modify: `apps/mobile/src/screens/PosScreen.tsx` (the hook and the card), `apps/mobile/package.json` (the test script lists `src/update-card.test.ts`: pin 8)
- Test: `apps/mobile/src/update-card.test.ts` (7 node tests), `apps/mobile/__tests__/UpdateCard.test.tsx` (2 Jest tests)

**Interfaces:** `reduceCard(state, event)`, `CARD_START`, `asCardInfo(value)`; `CardState { card, note: 'none' | 'permission' | 'failed', waiting: 'none' | 'permission' | 'installer', active }`; `useUpdateCard()` → `{ state, installing, install, later }`; `UpdateCard` props `{ info, note, busy, onInstall, onLater }`; the words `UPDATE_FIRST_TIME_NOTE`, `UPDATE_PERMISSION_NOTE`, `UPDATE_FAILED_NOTE`.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/__tests__/UpdateCard.test.tsx`:

```tsx
/**
 * @format
 */

import React from 'react';
import { AccessibilityInfo, AppState, NativeModules, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { PosScreen } from '../src/screens/PosScreen';

// Native apps 2.0 (spec §6.3): the POS screen takes the update card at an app open and shows it over the POS; Later
// closes it and tells the app; the app going to the background drops a card nobody took. The WebView needs a native
// view: a stand-in that renders nothing.
jest.mock('react-native-webview', () => {
  const ReactActual = jest.requireActual('react');
  return {
    WebView: ReactActual.forwardRef(function FakeWebView() {
      return null;
    }),
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

const COLD_START_TIMEOUT_MS = 60_000;

function textOf(screen: ReactTestRenderer.ReactTestRenderer): string {
  return screen.root
    .findAllByType(Text)
    .map(t => [t.props.children].flat().join(''))
    .join('\n');
}

/** The nearest pressable around the text [label]. */
function pressableWith(
  screen: ReactTestRenderer.ReactTestRenderer,
  label: string,
): ReactTestRenderer.ReactTestInstance | null {
  const text = screen.root
    .findAllByType(Text)
    .find(t => t.props.children === label);
  let node = text?.parent ?? null;
  while (node !== null && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node;
}

function stubs() {
  // The bridge token never arrives: the page itself is not needed for the card.
  (NativeModules as { PosPrinter?: unknown }).PosPrinter = {
    newToken: jest.fn(() => new Promise(() => undefined)),
  };
  const update = {
    takeCard: jest
      .fn()
      .mockResolvedValue({ version: '2.0.1', notes: 'Faster printing.' }),
    install: jest.fn().mockResolvedValue('started'),
    later: jest.fn(),
  };
  (NativeModules as { PosUpdate?: unknown }).PosUpdate = update;
  (AppState as { currentState: unknown }).currentState = 'active';
  return update;
}

test(
  'the update card shows at an app open over the POS, and Later closes it',
  async () => {
    const update = stubs();
    let screen!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      screen = ReactTestRenderer.create(
        <PosScreen origin="https://cafe.example.com" onChangeUrl={() => undefined} />,
      );
    });
    expect(update.takeCard).toHaveBeenCalledTimes(1);
    expect(textOf(screen)).toContain('Update available');
    expect(textOf(screen)).toContain('Sandbee POS 2.0.1 is ready to install.');
    expect(textOf(screen)).toContain('Faster printing.');
    const later = pressableWith(screen, 'Later');
    expect(later).not.toBeNull();
    await ReactTestRenderer.act(async () => {
      later?.props.onPress();
    });
    expect(update.later).toHaveBeenCalledTimes(1);
    expect(textOf(screen)).not.toContain('Update available');
    await ReactTestRenderer.act(async () => {
      screen.unmount();
    });
  },
  COLD_START_TIMEOUT_MS,
);

test(
  'the app going to the background drops the card',
  async () => {
    stubs();
    let screen!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      screen = ReactTestRenderer.create(
        <PosScreen origin="https://cafe.example.com" onChangeUrl={() => undefined} />,
      );
    });
    expect(textOf(screen)).toContain('Update available');
    const listen = AppState.addEventListener as jest.Mock;
    const onChange = listen.mock.calls[listen.mock.calls.length - 1][1] as (
      state: string,
    ) => void;
    await ReactTestRenderer.act(async () => {
      onChange('background');
    });
    expect(textOf(screen)).not.toContain('Update available');
    await ReactTestRenderer.act(async () => {
      screen.unmount();
    });
  },
  COLD_START_TIMEOUT_MS,
);
```

In `apps/mobile/package.json`, find:

```json
    "start": "react-native start",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/url.test.ts src/bridge/protocol.test.ts src/bridge/injected.test.ts src/bridge/router.test.ts src/screens/auto-retry.test.ts src/battery-steps.test.ts src/mobile-paths.test.ts src/app-icon.test.ts",
    "test:app": "jest"
  },
```

Replace it with:

```json
    "start": "react-native start",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test src/url.test.ts src/bridge/protocol.test.ts src/bridge/injected.test.ts src/bridge/router.test.ts src/screens/auto-retry.test.ts src/battery-steps.test.ts src/mobile-paths.test.ts src/app-icon.test.ts src/update-card.test.ts",
    "test:app": "jest"
  },
```

Create `apps/mobile/src/update-card.test.ts`:

```ts
// Native apps 2.0 (spec §6.2, §6.3): the update card's rules, as the POS screen applies them to what the app hands out
// at an app open. Never in the middle of work: a card that arrives while the app is hidden is dropped, and going to the
// background drops it, except while Android's own screens are up for an install the card started.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asCardInfo, CARD_START, reduceCard, type CardState } from './update-card';

const info = { version: '2.0.1', notes: 'Faster printing.' };
const shown = (state: CardState = CARD_START) => reduceCard(state, { type: 'card', info });

test('a card that arrives while the app is in view shows; while the app is hidden it is dropped', () => {
  assert.deepEqual(shown().card, info);
  const hidden = reduceCard(CARD_START, { type: 'appState', state: 'background' });
  assert.equal(shown(hidden).card, null, 'never shown later, when the app comes back');
  assert.equal(reduceCard(shown(hidden), { type: 'appState', state: 'active' }).card, null);
});

test('going to the background drops the card: never later in a session', () => {
  const away = reduceCard(shown(), { type: 'appState', state: 'background' });
  assert.equal(away.card, null);
  assert.equal(reduceCard(away, { type: 'appState', state: 'active' }).card, null);
});

test('Install the first time: the card stays across the "Install unknown apps" page, with what to do next', () => {
  const asked = reduceCard(shown(), { type: 'install', answer: 'permission' });
  assert.equal(asked.note, 'permission');
  const settings = reduceCard(asked, { type: 'appState', state: 'background' });
  assert.deepEqual(settings.card, info, "Android's settings page is not the app going away");
  const back = reduceCard(settings, { type: 'appState', state: 'active' });
  assert.deepEqual(back.card, info);
  assert.equal(back.note, 'permission');
  assert.equal(back.waiting, 'none', 'back on the card: going away now drops it again');
  assert.equal(reduceCard(back, { type: 'appState', state: 'background' }).card, null);
});

test("Install started: the card stays while Android's dialog is up; a failed or cancelled install says so", () => {
  const started = reduceCard(shown(), { type: 'install', answer: 'started' });
  const dialog = reduceCard(started, { type: 'appState', state: 'background' });
  assert.deepEqual(dialog.card, info, "Android's install dialog is not the app going away");
  const cancelled = reduceCard(reduceCard(dialog, { type: 'appState', state: 'active' }), { type: 'installFailed' });
  assert.deepEqual(cancelled.card, info);
  assert.equal(cancelled.note, 'failed');
  assert.equal(reduceCard(shown(), { type: 'install', answer: 'failed' }).note, 'failed');
  assert.equal(reduceCard(CARD_START, { type: 'installFailed' }).card, null, 'no card, nothing to say');
});

test('Later, or an update whose file is gone, closes the card', () => {
  assert.equal(reduceCard(shown(), { type: 'later' }).card, null);
  assert.equal(reduceCard(shown(), { type: 'install', answer: 'missing' }).card, null);
  const later = reduceCard(reduceCard(shown(), { type: 'install', answer: 'permission' }), { type: 'later' });
  assert.equal(later.note, 'none');
  assert.equal(later.waiting, 'none');
});

test("Install tapped: Android's screens may come before the app's answer, and the card stays", () => {
  // The N2 review's #3: on a slow phone the app can go to the background before install() answers.
  const tapped = reduceCard(shown(), { type: 'installing' });
  const settings = reduceCard(tapped, { type: 'appState', state: 'background' });
  assert.deepEqual(settings.card, info, 'the app going away right after Install is Android asking');
  const asked = reduceCard(settings, { type: 'install', answer: 'permission' });
  assert.equal(asked.note, 'permission');
  assert.deepEqual(reduceCard(asked, { type: 'appState', state: 'active' }).card, info);
  assert.equal(reduceCard(CARD_START, { type: 'installing' }).card, null, 'no card, nothing to wait for');
});

test('only a well-formed card is shown', () => {
  assert.deepEqual(asCardInfo({ version: '2.0.1', notes: '' }), { version: '2.0.1', notes: '' });
  for (const bad of [null, 'x', { version: '2.0', notes: '' }, { version: '2.0.1' }, { version: 2, notes: '' }, { version: '2.0.1', notes: 'x'.repeat(301) }]) {
    assert.equal(asCardInfo(bad), null, JSON.stringify(bad));
  }
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/mobile && node --import tsx --test src/update-card.test.ts 2>&1 | grep -E "Cannot find module|# (tests|pass|fail)"
npx jest __tests__/UpdateCard.test.tsx 2>&1 | grep -E "^Tests:|Expected number of calls|Received number of calls"
```
Expected: `Cannot find module './update-card'`, `# fail 1`; Jest `Tests: 2 failed, 2 total` (`takeCard` expected 1
call, received 0).

- [ ] **Step 3: Implement**

In `apps/mobile/src/screens/PosScreen.tsx`, find:

```tsx
import { LoadErrorScreen } from './LoadErrorScreen';
import { colors } from './theme';
import { useLoadGuards } from './use-load-guards';
import { WorkspaceCover } from './WorkspaceCover';
```

Replace it with:

```tsx
import { LoadErrorScreen } from './LoadErrorScreen';
import { colors } from './theme';
import { UpdateCard, useUpdateCard } from './UpdateCard';
import { useLoadGuards } from './use-load-guards';
import { WorkspaceCover } from './WorkspaceCover';
```

In `apps/mobile/src/screens/PosScreen.tsx`, find:

```tsx
  const openBattery = useCallback(() => setBattery(true), []);
  const closeBattery = useCallback(() => setBattery(false), []);

  if (failed) {
```

Replace it with:

```tsx
  const openBattery = useCallback(() => setBattery(true), []);
  const closeBattery = useCallback(() => setBattery(false), []);
  // Native apps 2.0 (spec §6.3): the update card, offered by the app only at an app open; it shows over the POS.
  const update = useUpdateCard();

  if (failed) {
```

In `apps/mobile/src/screens/PosScreen.tsx`, find:

```tsx
      />
      {battery && <BatteryScreen onDone={closeBattery} />}
    </View>
  );
```

Replace it with:

```tsx
      />
      {battery && <BatteryScreen onDone={closeBattery} />}
      {update.state.card !== null && update.state.active ? (
        <UpdateCard
          info={update.state.card}
          note={update.state.note}
          busy={update.installing}
          onInstall={update.install}
          onLater={update.later}
        />
      ) : null}
    </View>
  );
```

Create `apps/mobile/src/screens/UpdateCard.tsx`:

```tsx
// Native apps 2.0 (spec §6.3): the update card, a sheet over the POS shown only at an app open (the Kotlin module
// decides when; update-card.ts keeps what it shows). Install starts Android's installer; Later, or Back, closes it until
// the next open. The POS keeps working and printing underneath.

import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  AppState,
  BackHandler,
  DeviceEventEmitter,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  PosUpdate,
  UPDATE_CARD_EVENT,
  UPDATE_RESULT_EVENT,
  type UpdateCardInfo,
} from '../native/PosUpdate';
import {
  asCardInfo,
  CARD_START,
  reduceCard,
  type CardState,
} from '../update-card';
import { PrimaryButton, SandbeeLogo } from './Brand';
import { colors, MIN_TOUCH_TARGET, SCREEN_PADDING } from './theme';

const noop = () => undefined;

/**
 * The POS screen's update card: asked for when the screen mounts in view and each time the app comes back into view
 * (the app hands a card out at most once per open, so asking again is harmless); a card that waited for a print
 * arrives as an event, and a failed or cancelled install as another.
 */
export function useUpdateCard() {
  const [state, dispatch] = useReducer(reduceCard, CARD_START, start => ({
    ...start,
    active: AppState.currentState === 'active',
  }));
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let live = true;
    const offer = (value: unknown) => {
      const info = asCardInfo(value);
      if (live && info !== null) {
        dispatch({ type: 'card', info });
      }
    };
    const take = () => {
      PosUpdate.takeCard().then(offer, noop);
    };
    if (AppState.currentState === 'active') {
      take();
    }
    const appState = AppState.addEventListener('change', next => {
      dispatch({ type: 'appState', state: next });
      if (next === 'active') {
        take();
      }
    });
    const card = DeviceEventEmitter.addListener(UPDATE_CARD_EVENT, offer);
    const result = DeviceEventEmitter.addListener(UPDATE_RESULT_EVENT, () =>
      dispatch({ type: 'installFailed' }),
    );
    return () => {
      live = false;
      appState.remove();
      card.remove();
      result.remove();
    };
  }, []);

  const install = useCallback(() => {
    dispatch({ type: 'installing' });
    setInstalling(true);
    PosUpdate.install().then(answer => {
      setInstalling(false);
      dispatch({ type: 'install', answer });
    });
  }, []);
  const later = useCallback(() => {
    PosUpdate.later();
    dispatch({ type: 'later' });
  }, []);

  return { state, installing, install, later };
}

export const UPDATE_FIRST_TIME_NOTE =
  'The first time, Android asks you to allow installs from Sandbee POS.';
export const UPDATE_PERMISSION_NOTE =
  'Allow Sandbee POS to install apps, then tap Install again.';
export const UPDATE_FAILED_NOTE =
  'The update could not be installed. It will be offered again next time.';

type Props = {
  info: UpdateCardInfo;
  note: CardState['note'];
  busy: boolean;
  onInstall: () => void;
  onLater: () => void;
};

function noteText(note: CardState['note']): string {
  if (note === 'permission') {
    return UPDATE_PERMISSION_NOTE;
  }
  if (note === 'failed') {
    return UPDATE_FAILED_NOTE;
  }
  return UPDATE_FIRST_TIME_NOTE;
}

export function UpdateCard({ info, note, busy, onInstall, onLater }: Props) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onLater();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onLater]);

  return (
    <View style={styles.scrim}>
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View accessibilityViewIsModal style={styles.content}>
          <SandbeeLogo size={56} />
          <Text style={styles.title} accessibilityRole="header">
            Update available
          </Text>
          <Text style={styles.body}>
            {'Sandbee POS ' + info.version + ' is ready to install.'}
          </Text>
          {info.notes !== '' ? (
            <Text style={styles.notes}>{info.notes}</Text>
          ) : null}
          <Text style={note === 'none' ? styles.hint : styles.warn}>
            {noteText(note)}
          </Text>
          <PrimaryButton title="Install" onPress={onInstall} busy={busy} />
          <Pressable
            style={styles.later}
            onPress={onLater}
            accessibilityRole="button"
          >
            <Text style={styles.laterText}>Later</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(11, 18, 32, 0.45)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  content: { padding: SCREEN_PADDING, gap: 12 },
  title: { fontSize: 22, fontWeight: '600', color: colors.text },
  body: { fontSize: 16, lineHeight: 22, color: colors.text },
  notes: { fontSize: 15, lineHeight: 22, color: colors.muted },
  hint: { fontSize: 14, lineHeight: 20, color: colors.muted },
  warn: { fontSize: 14, lineHeight: 20, color: colors.error },
  later: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterText: { fontSize: 16, fontWeight: '600', color: colors.primary },
});
```

Create `apps/mobile/src/update-card.ts`:

```ts
// Native apps 2.0 (spec §6.2, §6.3): what the update card shows, as a pure reducer (node tests in update-card.test.ts).
// The app hands a card out only at an app open (Kotlin's UpdateSchedule); here it shows while the app is in view and
// goes when the app goes to the background (never later in a session), except while Android's own screens are up for
// an install the card started ("Install unknown apps", the installer's dialog). Later closes it until the next open.

import type { InstallAnswer, UpdateCardInfo } from './native/PosUpdate';

export type CardState = {
  card: UpdateCardInfo | null;
  note: 'none' | 'permission' | 'failed';
  waiting: 'none' | 'permission' | 'installer';
  active: boolean;
};

export type CardEvent =
  | { type: 'card'; info: UpdateCardInfo }
  | { type: 'appState'; state: string }
  | { type: 'installing' }
  | { type: 'install'; answer: InstallAnswer }
  | { type: 'later' }
  | { type: 'installFailed' };

export const CARD_START: CardState = {
  card: null,
  note: 'none',
  waiting: 'none',
  active: true,
};

const VERSION = /^\d{1,3}\.\d{1,2}\.\d{1,2}$/;
const MAX_NOTES_CHARS = 300;

/** A card from the app (its answer or its event), or null when it is not one. */
export function asCardInfo(value: unknown): UpdateCardInfo | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { version, notes } = value as { version?: unknown; notes?: unknown };
  if (typeof version !== 'string' || !VERSION.test(version)) {
    return null;
  }
  if (typeof notes !== 'string' || notes.length > MAX_NOTES_CHARS) {
    return null;
  }
  return { version, notes };
}

function closed(state: CardState): CardState {
  return { ...state, card: null, note: 'none', waiting: 'none' };
}

function installed(state: CardState, answer: InstallAnswer): CardState {
  switch (answer) {
    case 'started':
      return { ...state, note: 'none', waiting: 'installer' };
    case 'permission':
      return { ...state, note: 'permission', waiting: 'permission' };
    case 'failed':
      return { ...state, note: 'failed', waiting: 'none' };
    case 'missing':
      return closed(state);
  }
}

export function reduceCard(state: CardState, event: CardEvent): CardState {
  switch (event.type) {
    case 'card':
      return state.active
        ? { ...state, card: event.info, note: 'none', waiting: 'none' }
        : state;
    case 'appState': {
      const active = event.state === 'active';
      if (active) {
        // Back from "Install unknown apps": the note says what to do next.
        const waiting = state.waiting === 'permission' ? 'none' : state.waiting;
        return { ...state, active, waiting };
      }
      if (event.state === 'background' && state.waiting === 'none') {
        return { ...closed(state), active };
      }
      return { ...state, active };
    }
    case 'installing':
      // Install was tapped: Android's own screens may come before the app's answer.
      return state.card === null
        ? state
        : { ...state, note: 'none', waiting: 'installer' };
    case 'install':
      return state.card === null ? state : installed(state, event.answer);
    case 'later':
      return closed(state);
    case 'installFailed':
      return state.card === null
        ? state
        : { ...state, note: 'failed', waiting: 'none' };
  }
}
```

- [ ] **Step 4: Run them and see them pass, with the suites**

```bash
cd /d/kd/lucifer/apps/mobile && node --import tsx --test src/update-card.test.ts 2>&1 | grep -E "^not ok|# (tests|pass|fail)"
npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck && npm run lint && npx jest 2>&1 | grep -E "^Tests:|^Test Suites:"
```
Expected: 7/7; mobile `# tests 167`, `# fail 0`; typecheck and lint clean; Jest `Test Suites: 4 passed`, `Tests: 7 passed`.

- [ ] **Step 5: Commit** (`$SP/msg-n2-5.txt`):

```text
feat(app): the update card over the POS: "Update available", "Sandbee POS <version> is ready to install.", the notes and one line on the first install, Install and Later; asked for when the POS screen mounts in view and each time the app comes back into view (the app hands it out at most once per open), dropped when the app goes to the background, kept from the tap on Install while Android's own screens are up for that install, with what to do after "Install unknown apps" and a line when an install failed or was cancelled; Back is Later; a pure reducer with seven node tests and two Jest tests of the POS screen (native apps 2.0, Session N2, spec §6.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 26: Emulator end to end, a release read-back, every suite, the Results

**Files:** scratch only (`$SP`), nothing committed but this plan's Results.

- [ ] **Step 1: The scratch tools.** Copy `D:\kd\pos-dev-keep\phase3-final-gate\ui.py` and `type-secret.py` into `$SP`
(ui.py: `dump [filter]`, `shot <name>`, `tap <text>`; type-secret.py types the e2e admin's password into a focused
password field and prints only its length). A uiautomator dump can miss the card (a React Native overlay): read it from
a screenshot (`ui.py shot`) and tap by coordinates.

Write `$SP/n2-files.mjs` (the fake files.sandbee.in):

```js
// Native apps 2.0, Session N2 (emulator end to end): a fake files.sandbee.in on 127.0.0.1:8765 (the emulator reaches it
// through `adb reverse tcp:8765 tcp:8765`). It serves /pos/android/latest.json for the update APK given on the command
// line, and that APK, and logs every request. Switch answers with GET /__mode?manifest=404|ok|wronghash&apk=fast|slow;
// read the log with GET /__log. Local only; scratch, never committed.
// usage: node n2-files.mjs <path to the 2.0.1 APK> <log file>
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename } from 'node:path';

const [apkPath, logPath] = process.argv.slice(2);
const apk = readFileSync(apkPath);
const file = 'Sandbee-POS-2.0.1-x86_64.apk';
const sha256 = createHash('sha256').update(apk).digest('hex');
const size = statSync(apkPath).size;
const mode = { manifest: '404', apk: 'fast' };
const lines = [];

function log(text) {
  const line = new Date().toISOString() + ' ' + text;
  lines.push(line);
  appendFileSync(logPath, line + '\n');
}

function manifest() {
  return JSON.stringify({
    schema: 1,
    package: 'com.possoftware.pos',
    version: '2.0.1',
    versionCode: 20001,
    released: '2026-10-12',
    notes: 'A test update from the fake files server.',
    apks: { x86_64: { file, sha256: mode.manifest === 'wronghash' ? '0'.repeat(64) : sha256, size } },
  });
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8765');
  if (url.pathname === '/__mode') {
    for (const key of ['manifest', 'apk']) {
      const value = url.searchParams.get(key);
      if (value) mode[key] = value;
    }
    log('MODE ' + JSON.stringify(mode));
    res.end(JSON.stringify(mode) + '\n');
    return;
  }
  if (url.pathname === '/__log') {
    res.end(lines.join('\n') + '\n');
    return;
  }
  log(req.method + ' ' + url.pathname + ' (manifest=' + mode.manifest + ', apk=' + mode.apk + ')');
  if (url.pathname === '/pos/android/latest.json') {
    if (mode.manifest === '404') {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html><body>404 Not Found</body></html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(manifest());
    return;
  }
  if (url.pathname === '/pos/android/' + file) {
    res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-length': String(size) });
    if (mode.apk !== 'slow') {
      res.end(apk);
      log('sent ' + file + ' (' + size + ' bytes)');
      return;
    }
    // slow: 64 KB every 250 ms (about 256 KB/s), so a test can hide the app while the download runs.
    let at = 0;
    const timer = setInterval(() => {
      const next = Math.min(at + 65536, size);
      res.write(apk.subarray(at, next));
      at = next;
      if (at >= size) {
        clearInterval(timer);
        res.end();
        log('sent ' + file + ' slowly (' + size + ' bytes)');
      }
    }, 250);
    req.on('close', () => clearInterval(timer));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(8765, '127.0.0.1', () => log('listening for ' + basename(apkPath) + ' sha256 ' + sha256 + ' size ' + size));
```

Write `$SP/mkenv.py` (the local POS env, a fresh database, port 3110; prints no value):

```python
# Session N2: copies the kept e2e.env into <dir> (type-secret.py reads it there) and writes <dir>/n2.env for the local
# POS: a fresh database (pos_scratch_e2e_n2s) and port 3110. Prints no value. usage: python mkenv.py <dir>
import io
import os
import sys

out_dir = sys.argv[1]
src = io.open(r"D:\kd\pos-dev-keep\env\e2e.env", encoding="utf-8").read()
io.open(os.path.join(out_dir, "e2e.env"), "w", encoding="utf-8", newline="\n").write(src if src.endswith("\n") else src + "\n")
out = []
for line in src.splitlines():
    if line.startswith("MONGODB_URI="):
        line = "MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_e2e_n2s"
    elif line.startswith("NEXTAUTH_URL="):
        line = "NEXTAUTH_URL=http://localhost:3110"
    out.append(line)
io.open(os.path.join(out_dir, "n2.env"), "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
print("n2.env keys:", ", ".join(l.split("=", 1)[0] for l in out if "=" in l))
```

Write `$SP/n2-ab.sh` (test APKs A = 2.0.0 and B = 2.0.1: x86_64, private key, the test base, 1-minute times):

```bash
#!/bin/bash
# Session N2: test APKs A (2.0.0) and B (2.0.1): x86_64 (an `aR` build: one APK), the private key, the test base
# http://127.0.0.1:8765/pos, 1-minute times; each read back. Local only, released to nobody. usage: n2-ab.sh <out>
OUT="$1"; mkdir -p "$OUT"; S="$OUT/build.txt"; : > "$S"
BT="/c/Users/kartik.desai/AppData/Local/Android/Sdk/build-tools/37.0.0"
cd /d/kd/lucifer/apps/mobile/android || exit 2
echo "start $(date -Is) head $(git rev-parse --short HEAD)" >> "$S"; df -h /d >> "$S"
T="-PreactNativeArchitectures=x86_64 -PposUpdateBase=http://127.0.0.1:8765/pos -PposUpdateCheckMinutes=1 -PposUpdateReopenMinutes=1"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:compileReleaseKotlin --rerun $T --console=plain > "$OUT/kotlin-a.log" 2>&1; echo "kotlin A exit=$?" >> "$S"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat aR $T --console=plain > "$OUT/a.log" 2>&1; echo "A exit=$? $(grep -E '^BUILD' "$OUT/a.log")" >> "$S"
cp app/build/outputs/apk/release/app-release.apk "$OUT/A-2.0.0-x86_64.apk" && sha256sum "$OUT/A-2.0.0-x86_64.apk" >> "$S"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:compileReleaseKotlin --rerun $T -PposVersion=2.0.1 --console=plain > "$OUT/kotlin-b.log" 2>&1; echo "kotlin B exit=$?" >> "$S"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat aR $T -PposVersion=2.0.1 --console=plain > "$OUT/b.log" 2>&1; echo "B exit=$? $(grep -E '^BUILD' "$OUT/b.log")" >> "$S"
cp app/build/outputs/apk/release/app-release.apk "$OUT/Sandbee-POS-2.0.1-x86_64.apk" && sha256sum "$OUT/Sandbee-POS-2.0.1-x86_64.apk" >> "$S"
for f in "$OUT/A-2.0.0-x86_64.apk" "$OUT/Sandbee-POS-2.0.1-x86_64.apk"; do
  echo "== $f $(stat -c %s "$f")" >> "$S"
  "$BT/apksigner.bat" verify --print-certs "$f" 2>&1 | grep -E "certificate SHA-256" >> "$S"
  "$BT/aapt2.exe" dump badging "$f" | grep -E "^package:|native-code|uses-permission: name='android.permission.REQUEST_INSTALL" >> "$S"
  "$BT/aapt2.exe" dump resources "$f" | grep -A1 -E "(string/pos_update_base|integer/pos_update_(check|reopen)_minutes)" >> "$S"
done
df -h /d >> "$S"; echo "DONE $(date -Is)" >> "$S"
```

- [ ] **Step 2: Build A and B** (background; wait for `DONE` in `$SP/n2-apk/build.txt` with an until-loop): `bash "$SP/n2-ab.sh" "$SP/n2-apk"`.
Expected in `build.txt`: `kotlin A exit=0`, `A exit=0 BUILD SUCCESSFUL`, `kotlin B exit=0`, `B exit=0 BUILD SUCCESSFUL`;
for each APK about 7.5 MB, `certificate SHA-256 digest: 5bd06ef3e9a78efcb0dfbd1ff102de932c581a78034d93ef7572f5373b5b3e40`,
`versionCode='20000' versionName='2.0.0'` (A) and `versionCode='20001' versionName='2.0.1'` (B),
`uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'`, `native-code: 'x86_64'`,
`string/pos_update_base` → `"http://127.0.0.1:8765/pos"`, both integers `1`.

- [ ] **Step 3: The local POS and the fake files server**

```bash
python -X utf8 "$SP/mkenv.py" "$SP"
cd /d/kd/lucifer/apps/cafe && node /d/kd/pos-dev-keep/phase3-final-gate/dbs.cjs pos_scratch_e2e_n2s
MSYS_NO_PATHCONV=1 node --env-file="$(cygpath -w "$SP")/n2.env" --import tsx scripts/seed-admin.ts 2>&1 | grep -E "created|exists"
netstat -ano | grep LISTEN | grep -E ":(3110|8765) "
```
Expected: `n2.env keys: MONGODB_URI, NEXTAUTH_SECRET, AUTH_SECRET, NEXTAUTH_URL, AUTH_TRUST_HOST, SEED_ADMIN_USERNAME,
SEED_ADMIN_PASSWORD`; `(none with pos_scratch_e2e_n2s)`; `Admin account created.`; nothing listening on 3110 or 8765.
Then, each in the background: `cd /d/kd/lucifer/apps/cafe && MSYS_NO_PATHCONV=1 node --env-file="$(cygpath -w "$SP")/n2.env" ../../node_modules/next/dist/bin/next start -p 3110 > "$SP/next.log" 2>&1`
and `node "$SP/n2-files.mjs" "$(cygpath -w "$SP")/n2-apk/Sandbee-POS-2.0.1-x86_64.apk" "$(cygpath -w "$SP")/files.log"`.
Expected: `curl -s http://localhost:3110/api/health` → `{"ok":true,"db":"up","tenant":"dev",…}`; `files.log` says
`listening for Sandbee-POS-2.0.1-x86_64.apk sha256 <B's>`; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8765/pos/android/latest.json` → `404`.
(`apps/cafe/.next` must exist; it did at the gate. If it does not, stop and report: building the cafe app is not part of N2.)

- [ ] **Step 4: The emulator and the one-time move.** `df -h /c` (≥ 3 GB free), then in the background
`/c/Users/kartik.desai/AppData/Local/Android/Sdk/emulator/emulator.exe -avd Pixel_7_API_33 -no-snapshot -memory 2048 -no-boot-anim -no-audio`;
wait for `adb shell getprop sys.boot_completed` = 1. Then:

```bash
adb shell pm path com.possoftware.pos && adb shell dumpsys package com.possoftware.pos | grep -E "versionName|versionCode" | head -2
adb shell pm uninstall com.possoftware.pos
adb reverse tcp:8765 tcp:8765 && adb reverse tcp:3110 tcp:3110 && adb reverse --list
adb install "$SP/n2-apk/A-2.0.0-x86_64.apk" && adb logcat -c && adb shell monkey -p com.possoftware.pos -c android.intent.category.LAUNCHER 1
```
Expected: the gate left the debug-key release 1.0 (`versionCode=1`, the app's data empty); `Success`; both reverses
listed; `Success`. On the start
screen tap the field, type `http://localhost:3110` (the scheme matters: without it the app opens https), Back to close
the keyboard, tap **Open POS**. Sign in as `e2eadmin`: tap the username field; if Gboard pasted its clipboard into it,
`KEYCODE_MOVE_END` and 30 × `keyevent 67` first; type the name, `keyevent 61` (TAB) to the password, `type-secret.py`,
`keyevent 66`. Expected: the Dashboard; `adb logcat -d -s PosUpdate` shows `open` and `check: HTTP 404`.

- [ ] **Step 5: The cases** (each: `adb logcat -c` first; "away N s" = `adb shell input keyevent 3`, `sleep N`, then
`adb shell monkey -p com.possoftware.pos -c android.intent.category.LAUNCHER 1`; mode switches with
`curl -s "http://127.0.0.1:8765/__mode?manifest=…&apk=…"`; evidence: `adb logcat -d -s PosUpdate`, `files.log`, a
screenshot per card). Expected, as on the gate's run:
  - **E1** (`manifest=404`): away 70 s → `open`, `check: HTTP 404`, one `GET /pos/android/latest.json`; then away 15 s → no line, no request.
  - **E2** (`manifest=wronghash&apk=fast`): away 70 s → `open`, `download: the size or SHA-256 is not the manifest's` (the APK fetched once, then deleted); no card.
  - **E7** (`manifest=ok&apk=slow`, about 30 s per download): away 70 s, back, HOME within 3 s; `download: 2.0.1 verified (<B's size> bytes)` arrives while hidden; back within 60 s of that HOME → no `open`, no card.
  - **E4** (`apk=fast`): away 70 s → `open`, `check: 2.0.1 is ready`, `card: 2.0.1` and the card on screen (the logo, "Update available", "Sandbee POS 2.0.1 is ready to install.", "A test update from the fake files server.", the first-install line, Install, Later); **Later** → `card: later`, the card gone; away 70 s → the card again.
  - **Cold start**: `adb shell am force-stop com.possoftware.pos`, launch → `open`, `card: 2.0.1`, the card.
  - **E5**: **Install** → `install: permission`, Android's "Install unknown apps" page for Sandbee POS 2.0.0; turn on **Allow from this source**, Back → the card again with "Allow Sandbee POS to install apps, then tap Install again." (the app's process stays); **Install** → `install: started`, Android's "Do you want to update this app?"; **Cancel** → `install: status 3` and the card says "The update could not be installed. It will be offered again next time."; **Install** → **Update**. If Google Play Protect asks "App scan recommended": **More details** → **Install without scanning**. Never tap **Scan app** (it sends the APK to Google). Then `dumpsys package` → `versionCode=20001`, `versionName=2.0.1`; logcat has `Force stopping com.possoftware.pos … installPackageLI`, `Start proc … for broadcast {com.possoftware.pos/com.possoftware.pos.printer.PrintingOffReceiver}` and `install: done`; launch → still signed in, `open`, `check: ignored (not newer)`, no card.
  - **E6**: `adb reverse --remove tcp:8765`, away 70 s → `open`, `check: no answer`, the same app process (`adb shell pidof com.possoftware.pos` unchanged); `adb reverse tcp:8765 tcp:8765`, away 70 s → `open`, `check: ignored (not newer)`.
  - **E3**: `adb shell pm uninstall com.possoftware.pos`, install A, type the address, **Open POS** → `open` and `download: 2.0.1 verified` within seconds while the app is in view; sign in and stay in view 2 minutes → no `card:` line, no card; away 70 s → the card.
  - **E8** (a print in flight) is not run on the emulator (the gate's ruling): pin 32 holds it (`PrinterPool.anyPrinting() -> {` in `takeCard`, the 30-second wait in `install`).

- [ ] **Step 6: Put the emulator back**: `adb shell pm uninstall com.possoftware.pos`, `adb install D:/kd/pos-dev-keep/apk-release/pos-emulator-x86_64-release.apk` (the debug-key 1.0, sha256 `29115bdf…`), `adb reverse --remove-all`, `adb shell sync`, `adb emu kill`. Stop this session's next server and fake files server by their PIDs (`netstat -ano | grep LISTEN | grep -E ":(3110|8765) "`, check the command line, then `Stop-Process -Id`); never another program's. The scratch database `pos_scratch_e2e_n2s` stays (no drop on this PC); name it in the Results.

- [ ] **Step 7: A release pair read back** (the real base; Kotlin changed, so `:app:compileReleaseKotlin --rerun` first). Write `$SP/n2-release.sh`:

```bash
#!/bin/bash
# Session N2: one release APK pair with the private key and the real update base, read back (Session N1's n1-release.sh
# with the install permission). Local only, released to nobody. usage: n2-release.sh <out>
OUT="$1"; mkdir -p "$OUT"; S="$OUT/summary.txt"; : > "$S"
BT="/c/Users/kartik.desai/AppData/Local/Android/Sdk/build-tools/37.0.0"
cd /d/kd/lucifer/apps/mobile/android || exit 2
echo "start $(date -Is) head $(git rev-parse --short HEAD)" >> "$S"; df -h /d >> "$S"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:compileReleaseKotlin --rerun --console=plain > "$OUT/kotlin.log" 2>&1
echo "compileReleaseKotlin --rerun exit=$?" >> "$S"
GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --console=plain > "$OUT/pair.log" 2>&1
echo "pair exit=$? $(grep -E '^BUILD' "$OUT/pair.log")" >> "$S"
for abi in arm64-v8a armeabi-v7a; do
  apk="app/build/outputs/apk/release/app-$abi-release.apk"
  cp "$apk" "$OUT/" && sha256sum "$apk" >> "$S"
  "$BT/apksigner.bat" verify --print-certs "$apk" 2>&1 | grep -E "certificate DN|certificate SHA-256" >> "$S"
  "$BT/aapt2.exe" dump badging "$apk" | grep -E "^package:|application-debuggable|REQUEST_INSTALL_PACKAGES" >> "$S"
  "$BT/aapt2.exe" dump resources "$apk" | grep -A1 -E "(string/pos_update_base|integer/pos_update_(check|reopen)_minutes)" >> "$S"
done
df -h /d >> "$S"; echo "DONE $(date -Is)" >> "$S"
```

Run it in the background, `bash "$SP/n2-release.sh" "$SP/n2-release"`, and wait for `DONE` in `summary.txt`. Expected: `compileReleaseKotlin --rerun exit=0`, `pair exit=0 BUILD SUCCESSFUL`; for each APK `certificate DN: CN=Sandbee POS, O=sandbee, C=IN`, `certificate SHA-256 digest: 5bd06ef3e9a78efcb0dfbd1ff102de932c581a78034d93ef7572f5373b5b3e40`, `versionCode='20000' versionName='2.0.0'`, `uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'`, no `application-debuggable`, `"https://files.sandbee.in/pos"`, 720 and 30.

- [ ] **Step 8: Every suite** (as Task 20 Step 1). Expected: mobile 167, typecheck and lint clean, Jest 7 (4 suites);
desktop 205; cafe 5656 (5655 pass, 0 fail, 1 skipped); JUnit `tests=92 failures=0 errors=0`.

- [ ] **Step 9: Results and commit.** Append `## Session N2 Results` to this plan (the counts, the commits, each case's
evidence, the APK hashes, anything that differed and why) and commit (`$SP/msg-n2-6.txt`):

```text
docs(apps): native apps 2.0 Session N2 results: the Android updater at run time, its emulator end to end (E1-E7, a cold start, Android's Cancel), a release read-back and every suite recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
Update the project memory (`native-apps-2-2026-10.md` and its MEMORY.md line). No push unless the session prompt says so.
Report to the owner in Hinglish.

---

# Session N3 (exact): the Windows app, and the N2 review's minors

Made exact at the N2 review gate (2026-10-13, section "N2 review gate" at the end of this plan). Every code block below
was written and run in a gold worktree (`D:\kd\n2g`, reused from the N1 gate, detached from `8bcd4a6`): tasks 30–35 as
six commits (`a86ccd0` … `2c40140`), apps tree `16d4bc930bec6f8e64d09233bfa94f6ba54b2392`, docs tree
`389363ff58ade2e1c7924d9ead97b14f22977f0c`; the blocks were generated from those commits, then applied step by step on
the gold worktree reset to `8bcd4a6` (each find matched exactly once, every task's trees came out identical, and every
Expected below is that run's output). The gate pre-ran Task 30 on the emulator (Cancel in Android's dialog closes the
card) and Task 36 on this PC (the move from 1.12.0, the address window, Restart to update, install on quit, the
uninstall).

Acceptance: the address window looks and behaves like the Android start screen and accepts a bare name; the app updates
itself from a fake files server on this PC, installing when it quits or on "Restart to update"; start with Windows
survives every update; the N2 review's minors are fixed as the owner ruled.

**Changes from the spec version of N3** (the gate's rulings; reasons in the gate section):
- Task 30 is new: the N2 review's minors m-1, m-2, m-4, m-5, m-7, and m-3 with the owner's two rulings of 2026-10-13:
  Cancel in Android's install dialog closes the card like Later (offered again at the next open), and the card waits at
  most 2 minutes for idle printers.
- Task 31: the saved address is read back by the same rules (`store.ts`), so a private-network `http://` address saved
  by the window survives a restart; `normalizeServerUrl`, its error words and its 16 tests go; `startUrl`,
  `isSameOrigin` and `isExternalHttpUrl` stay in `server-url.ts`; `apps/mobile/src/url.ts`'s header names the port.
- Task 32: the check takes a narrow `HealthFetch` (the part of `fetch` it uses), so `url-window.ts` passes
  `(url, init) => net.fetch(url, init)`.
- Task 33: GO-LIVE §7's first-run line and its runbook pin move here with the window's words (the cafe chain stays green
  after every task); the window asks for 480 × 640 of content (`useContentSize`; the page measured 480 × 666 on this PC);
  the version comes as an additional argument; the save handler logs "address check: found / not saved".
- Task 34: also the About dialog ("POS address: …") and a pin (A3).
- Task 35: `electron-updater` 6.8.9 (released with electron-builder 26.15.0, the newest before 26.16.0, the same
  `builder-util-runtime` 9.7.0); `build.publish` is an object (so `-c.publish.url` overrides it); test builds are
  2.0.0, 2.0.1 and 2.0.2 (a `-test` suffix is a prerelease, which `allowPrerelease: false` never offers); **Restart to
  update is in the tray and in the Help menu**; the gate's finding G-1 is fixed here: an update (and the move from 1.x)
  ran the old uninstaller, which removed the start-with-Windows entry, so `installer.nsh` keeps it on `--updated` and
  the app puts the entry back at start when it is missing and the operator chose it (a disable made in Windows, which
  keeps the entry, is left alone: the N3 review's m-1).
- Task 36: `posdemo` is not typed (a found address is saved and opens that POS, the live demo); a bare name is checked
  with `--host-resolver-rules` (no request leaves the PC); the 1.12.0 → 2.0.0 move comes first (G-1); the app is driven
  by playwright-core's Electron support (no global keys or clicks); the owner's two leftover folders are renamed for the
  test and renamed back (the owner's OK of 2026-10-13).

**Expected counts** (baseline = N2's end): mobile `npm test` 167 → **168** (+1 reducer test), Jest 7 → **8**, JUnit 92 →
**94**, desktop 205 → **211** (−16 `normalizeServerUrl`, +3 parity, +1 store, +7 health, +4 update plan, +2 (A1)/(A2),
+1 (A3), +4 (U1)–(U4)), the cafe chain 5656 (5655 pass, 0 fail, 1 skipped) → unchanged, typecheck and lint clean in both
apps.

Work in `D:\kd\lucifer` on `feat/native-apps-2`; `$SP` is the session's scratchpad. Always
`GRADLE_USER_HOME='D:\gradle-home'`. Tasks are numbered 30–36 (Session N3 = 3x), so `task-start <plan> 31` brings only
this session's task. Every commit message goes in a scratch file and is committed with `git commit -F`; the messages below
end with the Co-Authored-By line the N3 prompt gives (Claude Opus 5.5); if a session's prompt gives another, its line
wins. Desktop pin runs carry `timeout`: a failing `assert.ok` without a message can hang
`desktop-paths.test.ts` under tsx (every new assertion here has one).

### Task 30: The N2 review's minors (Android)

**Files:**
- Modify: `…/update/UpdateFiles.kt` (`sha256Of`), `UpdateDownloader.kt` (sync before the rename), `UpdateInstaller.kt` (`CANCELLED`; a `RuntimeException` abandons the session), `UpdateInstallReceiver.kt` (`STATUS_FAILURE_ABORTED` → `onCancelled`), `PosUpdateModule.kt` (the install ticket, the re-hash, the 2-minute bound, the Cancel event)
- Modify: `apps/mobile/src/native/PosUpdate.ts` (`'cancelled'`), `src/update-card.ts` (`cardResultEvent`), `src/screens/UpdateCard.tsx`
- Test: `UpdateFilesTest.kt` (2 tests), `src/update-card.test.ts` (1 test, one title), `__tests__/UpdateCard.test.tsx` (every AppState listener; 1 test), `src/mobile-paths.test.ts` (pins 30–32: needles)

**Interfaces:** `UpdateFiles.sha256Of(input): String`; `UpdateInstaller.InstallStart.CANCELLED("cancelled")`; `UpdateInstallReceiver.onCancelled`; `PosUpdateModule.RESULT_EVENT` payload `{ ok: false, cancelled: Boolean }`; JS `InstallAnswer` adds `'cancelled'`; `cardResultEvent(value): CardEvent` (`later` for a Cancel, else `installFailed`). Log lines: `install: cancelled`, `install: the kept file changed on disk`, `card: printing for 2 minutes; the next open offers it`.

- [ ] **Step 1: Check the branch, the disks and every suite**

```bash
cd /d/kd/lucifer && git status --short && git branch --show-current && git log --oneline -3 && df -h /c /d
cd /d/kd/lucifer/apps/mobile && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck && npm run lint && npx jest 2>&1 | grep -E "^Tests:"
cd /d/kd/lucifer/apps/desktop && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck && npm run lint
cd /d/kd/lucifer/apps/cafe && npm test > "$SP/cafe-base.log" 2>&1; grep -E "^# (tests|pass|fail|skipped)" "$SP/cafe-base.log"
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --rerun --console=plain > "$SP/junit-base.log" 2>&1; tail -3 "$SP/junit-base.log"
cat app/build/test-results/testDebugUnitTest/*.xml | grep -o '<testsuite [^>]*' | sed -E 's/.*tests="([0-9]+)".*failures="([0-9]+)".*errors="([0-9]+)".*/\1 \2 \3/' | awk '{t+=$1; f+=$2; e+=$3} END {print "tests="t" failures="f" errors="e}'
```
Expected: clean, `feat/native-apps-2`, this gate's plan commit on top; mobile 167/167, typecheck and lint clean, Jest
`Tests: 7 passed`; desktop 205/205; cafe `# tests 5656`, `# pass 5655`, `# fail 0`, `# skipped 1`; JUnit
`tests=92 failures=0 errors=0`. The cafe chain takes a few minutes: run that line in the background and wait for its log
with an until-loop. D: needs about 1 GB free for this session's builds (the installers go to C:).

- [ ] **Step 2: Write the failing tests**

In `apps/mobile/__tests__/UpdateCard.test.tsx`, find:

```tsx

import React from 'react';
import { AccessibilityInfo, AppState, NativeModules, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { PosScreen } from '../src/screens/PosScreen';
```

Replace it with:

```tsx

import React from 'react';
import {
  AccessibilityInfo,
  AppState,
  DeviceEventEmitter,
  NativeModules,
  Text,
} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { PosScreen } from '../src/screens/PosScreen';
```

In `apps/mobile/__tests__/UpdateCard.test.tsx`, find:

```tsx
  (NativeModules as { PosUpdate?: unknown }).PosUpdate = update;
  (AppState as { currentState: unknown }).currentState = 'active';
  return update;
}
```

Replace it with:

```tsx
  (NativeModules as { PosUpdate?: unknown }).PosUpdate = update;
  (AppState as { currentState: unknown }).currentState = 'active';
  // Each test's screen registers its own listeners; an earlier test's are not this screen's.
  (AppState.addEventListener as jest.Mock).mockClear();
  return update;
}
```

In `apps/mobile/__tests__/UpdateCard.test.tsx`, find:

```tsx
    });
    expect(textOf(screen)).toContain('Update available');
    const listen = AppState.addEventListener as jest.Mock;
    const onChange = listen.mock.calls[listen.mock.calls.length - 1][1] as (
      state: string,
    ) => void;
    await ReactTestRenderer.act(async () => {
      onChange('background');
    });
    expect(textOf(screen)).not.toContain('Update available');
```

Replace it with:

```tsx
    });
    expect(textOf(screen)).toContain('Update available');
    // The N2 review gate (the review's m-7): every AppState listener of this screen hears the change, as on a phone,
    // so the test does not depend on which listener was added last.
    const listen = AppState.addEventListener as jest.Mock;
    const onChanges = listen.mock.calls
      .filter(call => call[0] === 'change')
      .map(call => call[1] as (state: string) => void);
    expect(onChanges.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => {
      for (const onChange of onChanges) {
        onChange('background');
      }
    });
    expect(textOf(screen)).not.toContain('Update available');
```

In `apps/mobile/__tests__/UpdateCard.test.tsx`, find:

```tsx
    });
    expect(textOf(screen)).not.toContain('Update available');
    await ReactTestRenderer.act(async () => {
      screen.unmount();
    });
  },
  COLD_START_TIMEOUT_MS,
);

```

Replace it with:

```tsx
    });
    expect(textOf(screen)).not.toContain('Update available');
    await ReactTestRenderer.act(async () => {
      screen.unmount();
    });
  },
  COLD_START_TIMEOUT_MS,
);

test(
  "Cancel in Android's install dialog closes the card like Later",
  async () => {
    // The N2 review gate (the review's m-4, the owner's ruling of 2026-10-13): the app's answer to a Cancel.
    stubs();
    let screen!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      screen = ReactTestRenderer.create(
        <PosScreen origin="https://cafe.example.com" onChangeUrl={() => undefined} />,
      );
    });
    expect(textOf(screen)).toContain('Update available');
    await ReactTestRenderer.act(async () => {
      DeviceEventEmitter.emit('PosUpdateResult', { ok: false, cancelled: true });
    });
    expect(textOf(screen)).not.toContain('Update available');
    expect(textOf(screen)).not.toContain('could not be installed');
    await ReactTestRenderer.act(async () => {
      screen.unmount();
    });
  },
  COLD_START_TIMEOUT_MS,
);

```

In `apps/mobile/android/app/src/test/java/com/possoftware/pos/update/UpdateFilesTest.kt`, find:

```kotlin
    assertFalse(UpdateFiles.copyVerified(ByteArrayInputStream(page), ByteArrayOutputStream(), apk.size, sha))
  }
}

```

Replace it with:

```kotlin
    assertFalse(UpdateFiles.copyVerified(ByteArrayInputStream(page), ByteArrayOutputStream(), apk.size, sha))
  }

  // The N2 review gate (native apps 2.0, Session N3 Task 30): the review's m-2. A kept file is hashed again before it is
  // offered as ready or handed to Android's installer, so a file damaged on disk is downloaded again, never offered.

  @Test
  fun aKeptFileHashesToTheManifestsSha256() {
    assertEquals(sha, UpdateFiles.sha256Of(ByteArrayInputStream(apk)))
  }

  @Test
  fun aKeptFileDamagedOnDiskHashesToSomethingElse() {
    val changed = apk.copyOf().also { it[7] = (it[7] + 1).toByte() }
    assertFalse("one byte changed", UpdateFiles.sha256Of(ByteArrayInputStream(changed)) == sha)
    assertFalse("cut short", UpdateFiles.sha256Of(ByteArrayInputStream(apk.copyOf(1000))) == sha)
    assertEquals(
        "empty: the SHA-256 of nothing",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        UpdateFiles.sha256Of(ByteArrayInputStream(ByteArray(0))))
  }
}

```

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
  need(d, 'UpdateStore.deleteFilesExcept(ctx, null)', 'a download does not start from an empty updates folder');
  need(d, 'UpdateFiles.copyVerified(input, out, offer.size, offer.sha256)', 'a download is not checked by size and SHA-256');
  const renamed = d.indexOf('if (!part.renameTo(apk))');
  const checked = d.indexOf('if (!ApkCheck.matches(ctx, apk, offer))');
```

Replace it with:

```ts
  need(d, 'UpdateStore.deleteFilesExcept(ctx, null)', 'a download does not start from an empty updates folder');
  need(d, 'UpdateFiles.copyVerified(input, out, offer.size, offer.sha256)', 'a download is not checked by size and SHA-256');
  // The N2 review gate (the review's m-2): the bytes are on disk before the rename.
  need(d, 'UpdateFiles.copyVerified(input, out, offer.size, offer.sha256).also { if (it) out.fd.sync() }', 'a download is renamed before its bytes are on disk');
  const renamed = d.indexOf('if (!part.renameTo(apk))');
  const checked = d.indexOf('if (!ApkCheck.matches(ctx, apk, offer))');
```

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
    ['UpdateStore.deleteFilesExcept(ctx, null)', 'dir.mkdirs()'],
    ['UpdateFiles.copyVerified(input, out, offer.size, offer.sha256)', 'input.copyTo(out) > 0'],
    ['if (!ApkCheck.matches(ctx, apk, offer))', 'if (false)'],
  ]);
```

Replace it with:

```ts
    ['UpdateStore.deleteFilesExcept(ctx, null)', 'dir.mkdirs()'],
    ['UpdateFiles.copyVerified(input, out, offer.size, offer.sha256)', 'input.copyTo(out) > 0'],
    ['.also { if (it) out.fd.sync() }', ''],
    ['if (!ApkCheck.matches(ctx, apk, offer))', 'if (false)'],
  ]);
```

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
  need(r, 'PackageInstaller.STATUS_PENDING_USER_ACTION ->', 'Android\'s install dialog is never shown');
  need(r, 'context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))', 'Android\'s install dialog is never shown');
  need(r, 'onFailed?.invoke()', 'a failed or cancelled install never reaches the card');
  need(m, '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />', 'REQUEST_INSTALL_PACKAGES missing');
  const receiver = /<receiver\b[^>]*android:name="\.update\.UpdateInstallReceiver"[^>]*\/>/.exec(m)?.[0];
```

Replace it with:

```ts
  need(r, 'PackageInstaller.STATUS_PENDING_USER_ACTION ->', 'Android\'s install dialog is never shown');
  need(r, 'context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))', 'Android\'s install dialog is never shown');
  need(r, 'onFailed?.invoke()', 'a failed install never reaches the card');
  // The N2 review gate: a session that cannot be written is abandoned (the review's m-5), and a Cancel in Android's
  // dialog is Later, not a failure (the review's m-4, the owner's ruling of 2026-10-13).
  need(i, '} catch (e: RuntimeException) {\n      installer.abandonSession(id)', 'a session that cannot be written stays open');
  need(r, 'PackageInstaller.STATUS_FAILURE_ABORTED -> {', 'a Cancel in Android\'s dialog reads as a failure');
  need(r, 'onCancelled?.invoke()', 'a Cancel in Android\'s dialog never reaches the card');
  need(m, '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />', 'REQUEST_INSTALL_PACKAGES missing');
  const receiver = /<receiver\b[^>]*android:name="\.update\.UpdateInstallReceiver"[^>]*\/>/.exec(m)?.[0];
```

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
    ['Intent(app, UpdateInstallReceiver::class.java)', 'Intent("com.possoftware.pos.UPDATE_STATUS")'],
    ['PendingIntent.FLAG_MUTABLE', 'PendingIntent.FLAG_IMMUTABLE'],
  ]);
  everyMutationCaught(run('receiver'), base.receiver, [
```

Replace it with:

```ts
    ['Intent(app, UpdateInstallReceiver::class.java)', 'Intent("com.possoftware.pos.UPDATE_STATUS")'],
    ['PendingIntent.FLAG_MUTABLE', 'PendingIntent.FLAG_IMMUTABLE'],
    ['catch (e: RuntimeException)', 'catch (e: SecurityException)'],
  ]);
  everyMutationCaught(run('receiver'), base.receiver, [
```

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
    ['context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))', 'Unit'],
    ['onFailed?.invoke()', 'Unit'],
  ]);
  everyMutationCaught(run('manifest'), base.manifest, [
```

Replace it with:

```ts
    ['context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))', 'Unit'],
    ['onFailed?.invoke()', 'Unit'],
    ['PackageInstaller.STATUS_FAILURE_ABORTED -> {', 'PackageInstaller.STATUS_SUCCESS + 98 -> {'],
    ['onCancelled?.invoke()', 'Unit'],
  ]);
  everyMutationCaught(run('manifest'), base.manifest, [
```

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
  need(k, 'while (PrinterPool.anyPrinting() && waited < INSTALL_IDLE_WAIT_MS)', 'Install does not wait for a print in flight');
  need(k, '} catch (t: Throwable) {\n        Log.i(TAG, "check: "', 'a failed look can end the updater thread');
  need(strip(s.pool), 'fun anyPrinting(): Boolean = managers().any { it.isPrinting() }', 'the printers cannot say a job is in flight');
  need(strip(s.manager), 'fun isPrinting(): Boolean = printing.get()', 'a printer cannot say a job is in flight');
```

Replace it with:

```ts
  need(k, 'while (PrinterPool.anyPrinting() && waited < INSTALL_IDLE_WAIT_MS)', 'Install does not wait for a print in flight');
  need(k, '} catch (t: Throwable) {\n        Log.i(TAG, "check: "', 'a failed look can end the updater thread');
  // The N2 review gate: the card waits at most 2 minutes for idle printers (the review's m-3, the owner's ruling of
  // 2026-10-13); Later stops an Install still waiting for them (m-1); a kept file is hashed again before it is called
  // ready or handed to the installer (m-2); a Cancel in Android's dialog reaches the card as Later (m-4).
  need(k, 'private const val CARD_IDLE_WAIT_MS = 120_000L', 'the card waits for idle printers without a bound');
  need(k, 'if (SystemClock.elapsedRealtime() - waitingSince >= CARD_IDLE_WAIT_MS) {', 'the card waits for idle printers without a bound');
  need(k, 'fun later() {\n    installTicket.incrementAndGet()', 'Later does not stop an Install still waiting for the printers');
  need(k, 'ticket != installTicket.get() -> UpdateInstaller.InstallStart.CANCELLED', 'Later does not stop an Install still waiting for the printers');
  need(k, '!keptIntact(update) -> {', 'a kept file is handed to the installer without its hash checked again');
  need(k, '&& keptIntact(kept)', 'a kept file is called ready without its hash checked again');
  need(k, 'UpdateInstallReceiver.onCancelled = { emitResult(ok = false, cancelled = true) }', 'a Cancel in Android\'s dialog never reaches the card');
  need(strip(s.pool), 'fun anyPrinting(): Boolean = managers().any { it.isPrinting() }', 'the printers cannot say a job is in flight');
  need(strip(s.manager), 'fun isPrinting(): Boolean = printing.get()', 'a printer cannot say a job is in flight');
```

In `apps/mobile/src/mobile-paths.test.ts`, find:

```ts
    ['while (PrinterPool.anyPrinting() && waited', 'while (false && waited'],
    ['} catch (t: Throwable) {\n        Log.i(TAG, "check: "', '} catch (t: Exception) {\n        Log.i(TAG, "check: "'],
  ]);
  everyMutationCaught(run('js'), base.js, [
```

Replace it with:

```ts
    ['while (PrinterPool.anyPrinting() && waited', 'while (false && waited'],
    ['} catch (t: Throwable) {\n        Log.i(TAG, "check: "', '} catch (t: Exception) {\n        Log.i(TAG, "check: "'],
    ['CARD_IDLE_WAIT_MS = 120_000L', 'CARD_IDLE_WAIT_MS = Long.MAX_VALUE'],
    ['if (SystemClock.elapsedRealtime() - waitingSince >= CARD_IDLE_WAIT_MS) {', 'if (false) {'],
    ['fun later() {\n    installTicket.incrementAndGet()', 'fun later() {\n    Unit'],
    ['ticket != installTicket.get() -> ', 'false -> '],
    ['!keptIntact(update) -> {', 'false -> {'],
    ['&& keptIntact(kept)', ''],
    ['emitResult(ok = false, cancelled = true) }', 'emitResult(ok = false, cancelled = false) }'],
  ]);
  everyMutationCaught(run('js'), base.js, [
```

In `apps/mobile/src/update-card.test.ts`, find:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asCardInfo, CARD_START, reduceCard, type CardState } from './update-card';

const info = { version: '2.0.1', notes: 'Faster printing.' };
```

Replace it with:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asCardInfo, CARD_START, cardResultEvent, reduceCard, type CardState } from './update-card';

const info = { version: '2.0.1', notes: 'Faster printing.' };
```

In `apps/mobile/src/update-card.test.ts`, find:

```ts
});

test("Install started: the card stays while Android's dialog is up; a failed or cancelled install says so", () => {
  const started = reduceCard(shown(), { type: 'install', answer: 'started' });
  const dialog = reduceCard(started, { type: 'appState', state: 'background' });
  assert.deepEqual(dialog.card, info, "Android's install dialog is not the app going away");
  const cancelled = reduceCard(reduceCard(dialog, { type: 'appState', state: 'active' }), { type: 'installFailed' });
  assert.deepEqual(cancelled.card, info);
  assert.equal(cancelled.note, 'failed');
  assert.equal(reduceCard(shown(), { type: 'install', answer: 'failed' }).note, 'failed');
  assert.equal(reduceCard(CARD_START, { type: 'installFailed' }).card, null, 'no card, nothing to say');
});

```

Replace it with:

```ts
});

test("Install started: the card stays while Android's dialog is up; a failed install says so", () => {
  const started = reduceCard(shown(), { type: 'install', answer: 'started' });
  const dialog = reduceCard(started, { type: 'appState', state: 'background' });
  assert.deepEqual(dialog.card, info, "Android's install dialog is not the app going away");
  const failed = reduceCard(reduceCard(dialog, { type: 'appState', state: 'active' }), { type: 'installFailed' });
  assert.deepEqual(failed.card, info);
  assert.equal(failed.note, 'failed');
  assert.equal(reduceCard(shown(), { type: 'install', answer: 'failed' }).note, 'failed');
  assert.equal(reduceCard(CARD_START, { type: 'installFailed' }).card, null, 'no card, nothing to say');
});

test("Cancel in Android's dialog closes the card like Later; the next app open offers it again", () => {
  // The N2 review gate (the owner, 2026-10-13): the review's m-4. A Cancel is the staff's own choice, not a failure.
  const started = reduceCard(shown(), { type: 'install', answer: 'started' });
  const back = reduceCard(reduceCard(started, { type: 'appState', state: 'background' }), { type: 'appState', state: 'active' });
  const cancelled = reduceCard(back, cardResultEvent({ ok: false, cancelled: true }));
  assert.equal(cancelled.card, null);
  assert.equal(cancelled.note, 'none');
  assert.equal(cardResultEvent({ ok: false }).type, 'installFailed', 'a failure keeps the card, with its line');
  assert.equal(cardResultEvent('x').type, 'installFailed');
  // The review's m-1: Later during Install's wait for the printers; the app answers "cancelled" and starts nothing.
  assert.equal(reduceCard(shown(), { type: 'install', answer: 'cancelled' }).card, null);
});

```

- [ ] **Step 3: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/mobile && node --import tsx --test src/update-card.test.ts 2>&1 | grep -E "^not ok|cardResultEvent|# (pass|fail)"
node --import tsx --test --test-name-pattern "pin 3[012]" src/mobile-paths.test.ts 2>&1 | grep -E "^not ok|^    [0-9]+:|# (pass|fail)"
npx jest __tests__/UpdateCard.test.tsx 2>&1 | grep -E "^Tests:"
cd android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --tests 'com.possoftware.pos.update.*' --console=plain 2>&1 | grep -E "Unresolved reference|^BUILD" | sed -E 's/.*(Unresolved reference [^.]*).*/\1/; s/ in [0-9hms ]+$//' | sort | uniq -c
```
Expected: `not ok … Cancel in Android's dialog closes the card like Later; the next app open offers it again` with
`(0 , import_update_card.cardResultEvent) is not a function`, `# pass 7`, `# fail 1`; pins 30, 31, 32 and their mutations
fail (`# pass 0`, `# fail 6`): pin 30 `'a download is renamed before its bytes are on disk'`; pin 31 `'a session that
cannot be written stays open'`, `"a Cancel in Android's dialog reads as a failure"`, `"a Cancel in Android's dialog never
reaches the card"`; pin 32 `'the card waits for idle printers without a bound'` (twice), `'Later does not stop an Install
still waiting for the printers'` (twice), `'a kept file is handed to the installer without its hash checked again'`, `'a
kept file is called ready without its hash checked again'`, `"a Cancel in Android's dialog never reaches the card"`; Jest
`Tests: 1 failed, 2 passed, 3 total`; JUnit `4 Unresolved reference 'sha256Of'` and `1 BUILD FAILED`.

- [ ] **Step 4: Implement**

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
import com.possoftware.pos.printer.PrinterPool
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
```

Replace it with:

```kotlin
import com.possoftware.pos.printer.PrinterPool
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
    private const val INSTALL_IDLE_WAIT_MS = 30_000L
    private const val INSTALL_IDLE_POLL_MS = 500L
  }

```

Replace it with:

```kotlin
    private const val INSTALL_IDLE_WAIT_MS = 30_000L
    private const val INSTALL_IDLE_POLL_MS = 500L
    /** The N2 review gate (the review's m-3, the owner's ruling of 2026-10-13): a card waits at most 2 minutes for idle
     *  printers; after that this open offers nothing and the next open offers it again. */
    private const val CARD_IDLE_WAIT_MS = 120_000L
  }

```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
  private val main = Handler(Looper.getMainLooper())
  private var waiting: UpdateStore.Verified? = null

  override fun getName(): String = NAME
```

Replace it with:

```kotlin
  private val main = Handler(Looper.getMainLooper())
  private var waiting: UpdateStore.Verified? = null
  private var waitingSince = 0L
  /** Each tap on Install takes a ticket; Later takes the next one, so an Install still waiting for the printers starts
   *  nothing (the N2 review gate, the review's m-1). */
  private val installTicket = AtomicInteger(0)

  override fun getName(): String = NAME
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
  override fun initialize() {
    UpdateStore.startUp(reactContext, installedCode)
    UpdateInstallReceiver.onFailed = { emitResult(false) }
    reactContext.addLifecycleEventListener(this)
  }
```

Replace it with:

```kotlin
  override fun initialize() {
    UpdateStore.startUp(reactContext, installedCode)
    UpdateInstallReceiver.onFailed = { emitResult(ok = false, cancelled = false) }
    UpdateInstallReceiver.onCancelled = { emitResult(ok = false, cancelled = true) }
    reactContext.addLifecycleEventListener(this)
  }
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
  override fun invalidate() {
    UpdateInstallReceiver.onFailed = null
    reactContext.removeLifecycleEventListener(this)
    main.removeCallbacksAndMessages(null)
```

Replace it with:

```kotlin
  override fun invalidate() {
    UpdateInstallReceiver.onFailed = null
    UpdateInstallReceiver.onCancelled = null
    reactContext.removeLifecycleEventListener(this)
    main.removeCallbacksAndMessages(null)
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
        val offer = result.offer
        val kept = UpdateStore.verified(reactContext)
        if (kept != null && kept.versionCode == offer.versionCode && kept.sha256 == offer.sha256) {
          Log.i(TAG, "check: " + offer.version + " is ready")
          return
```

Replace it with:

```kotlin
        val offer = result.offer
        val kept = UpdateStore.verified(reactContext)
        if (kept != null && kept.versionCode == offer.versionCode && kept.sha256 == offer.sha256 && keptIntact(kept)) {
          Log.i(TAG, "check: " + offer.version + " is ready")
          return
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
  }

  /** spec §6.3: the card for this app open, at most once; null when there is none. While a printer of this app has a
   *  job in flight the card waits, and follows as [CARD_EVENT] once every printer is idle, if the app is still in view
   *  (going away drops it). */
  @ReactMethod
  fun takeCard(promise: Promise) {
```

Replace it with:

```kotlin
  }

  /** The kept file still hashes to the verified SHA-256 (the N2 review gate, the review's m-2): a file damaged on disk is
   *  downloaded again, never offered or installed. Worker thread only. */
  private fun keptIntact(v: UpdateStore.Verified): Boolean =
      try {
        FileInputStream(File(UpdateStore.updatesDir(reactContext), v.file)).use { UpdateFiles.sha256Of(it) } == v.sha256
      } catch (e: IOException) {
        false
      }

  /** spec §6.3: the card for this app open, at most once; null when there is none. While a printer of this app has a
   *  job in flight the card waits, and follows as [CARD_EVENT] once every printer is idle, if the app is still in view
   *  (going away drops it) and within [CARD_IDLE_WAIT_MS]. */
  @ReactMethod
  fun takeCard(promise: Promise) {
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
              Log.i(TAG, "card: waits for a print")
              waiting = update
              main.postDelayed({ offerWhenIdle() }, IDLE_POLL_MS)
              promise.resolve(null)
```

Replace it with:

```kotlin
              Log.i(TAG, "card: waits for a print")
              waiting = update
              waitingSince = SystemClock.elapsedRealtime()
              main.postDelayed({ offerWhenIdle() }, IDLE_POLL_MS)
              promise.resolve(null)
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
    val update = waiting ?: return
    if (PrinterPool.anyPrinting()) {
      main.postDelayed({ offerWhenIdle() }, IDLE_POLL_MS)
      return
```

Replace it with:

```kotlin
    val update = waiting ?: return
    if (PrinterPool.anyPrinting()) {
      if (SystemClock.elapsedRealtime() - waitingSince >= CARD_IDLE_WAIT_MS) {
        waiting = null
        Log.i(TAG, "card: printing for 2 minutes; the next open offers it")
        return
      }
      main.postDelayed({ offerWhenIdle() }, IDLE_POLL_MS)
      return
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin

  /** Only from a tap on the card's Install: waits up to 30 s for the printers to be idle, then hands the verified file
   *  to Android's installer. Resolves "started", "permission", "missing" or "failed". */
  @ReactMethod
  fun install(promise: Promise) {
    worker.execute {
      val start =
```

Replace it with:

```kotlin

  /** Only from a tap on the card's Install: waits up to 30 s for the printers to be idle, then hands the verified file
   *  to Android's installer. Resolves "started", "permission", "missing", "failed" or "cancelled" (Later came first). */
  @ReactMethod
  fun install(promise: Promise) {
    val ticket = installTicket.incrementAndGet()
    worker.execute {
      val start =
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
            }
            val update = UpdateStore.verified(reactContext)
            if (update == null) {
              UpdateInstaller.InstallStart.MISSING
            } else {
              UpdateInstaller.install(reactContext, File(UpdateStore.updatesDir(reactContext), update.file))
            }
          } catch (t: Throwable) {
```

Replace it with:

```kotlin
            }
            val update = UpdateStore.verified(reactContext)
            when {
              ticket != installTicket.get() -> UpdateInstaller.InstallStart.CANCELLED
              update == null -> UpdateInstaller.InstallStart.MISSING
              !keptIntact(update) -> {
                // Damaged on disk: dropped, and the next app open looks and downloads it again.
                UpdateStore.clearVerified(reactContext)
                UpdateStore.deleteFilesExcept(reactContext, null)
                UpdateStore.setLastCheckAt(reactContext, 0L)
                Log.i(TAG, "install: the kept file changed on disk")
                UpdateInstaller.InstallStart.FAILED
              }
              else -> UpdateInstaller.install(reactContext, File(UpdateStore.updatesDir(reactContext), update.file))
            }
          } catch (t: Throwable) {
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
  }

  /** Later on the card: nothing to keep (the next app open offers it again). */
  @ReactMethod
  fun later() {
    Log.i(TAG, "card: later")
  }
```

Replace it with:

```kotlin
  }

  /** Later (or Back) on the card: nothing to keep (the next app open offers it again), and an Install still waiting for
   *  the printers starts nothing. */
  @ReactMethod
  fun later() {
    installTicket.incrementAndGet()
    Log.i(TAG, "card: later")
  }
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt`, find:

```kotlin
      }

  private fun emitResult(ok: Boolean) {
    reactContext.emitDeviceEvent(RESULT_EVENT, Arguments.createMap().apply { putBoolean("ok", ok) })
  }
}
```

Replace it with:

```kotlin
      }

  private fun emitResult(ok: Boolean, cancelled: Boolean) {
    reactContext.emitDeviceEvent(
        RESULT_EVENT,
        Arguments.createMap().apply {
          putBoolean("ok", ok)
          putBoolean("cancelled", cancelled)
        },
    )
  }
}
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateDownloader.kt`, find:

```kotlin
      val copied =
          conn.inputStream.use { input ->
            FileOutputStream(part).use { out -> UpdateFiles.copyVerified(input, out, offer.size, offer.sha256) }
          }
      if (!copied) return failed(part, apk, "download: the size or SHA-256 is not the manifest's")
```

Replace it with:

```kotlin
      val copied =
          conn.inputStream.use { input ->
            FileOutputStream(part).use { out ->
              // The N2 review gate (the review's m-2): on disk before the rename, so a power cut cannot keep a short file.
              UpdateFiles.copyVerified(input, out, offer.size, offer.sha256).also { if (it) out.fd.sync() }
            }
          }
      if (!copied) return failed(part, apk, "download: the size or SHA-256 is not the manifest's")
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateFiles.kt`, find:

```kotlin
  }

  private fun hex(bytes: ByteArray): String {
    val out = StringBuilder(bytes.size * 2)
```

Replace it with:

```kotlin
  }

  /** The SHA-256 (lower-case hex) of everything [input] holds: a kept file is hashed again before it is called ready or
   *  handed to the installer (the N2 review gate, the review's m-2), so a file damaged on disk is never offered. */
  fun sha256Of(input: InputStream): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(BUFFER_BYTES)
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      digest.update(buffer, 0, read)
    }
    return hex(digest.digest())
  }

  private fun hex(bytes: ByteArray): String {
    val out = StringBuilder(bytes.size * 2)
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateInstallReceiver.kt`, find:

```kotlin
 * Native apps 2.0 (spec §6.2): Android's answer to the install the card started. Not exported: only the installer's
 * PendingIntent ([UpdateInstaller]) reaches it. "The user must confirm" opens Android's own install dialog; success
 * needs nothing (the update is replacing this app); a failure, or Cancel in that dialog, tells the card ([onFailed]) and
 * keeps the file, so the next app open offers the card again.
 */
class UpdateInstallReceiver : BroadcastReceiver() {
```

Replace it with:

```kotlin
 * Native apps 2.0 (spec §6.2): Android's answer to the install the card started. Not exported: only the installer's
 * PendingIntent ([UpdateInstaller]) reaches it. "The user must confirm" opens Android's own install dialog; success
 * needs nothing (the update is replacing this app); a failure tells the card ([onFailed]), and Cancel in that dialog
 * closes it as Later does ([onCancelled]; the N2 review gate, the owner's ruling of 2026-10-13); either way the file is
 * kept, so the next app open offers the card again.
 */
class UpdateInstallReceiver : BroadcastReceiver() {
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateInstallReceiver.kt`, find:

```kotlin
    /** Set by [PosUpdateModule] while React runs. */
    @Volatile var onFailed: (() -> Unit)? = null
  }

```

Replace it with:

```kotlin
    /** Set by [PosUpdateModule] while React runs. */
    @Volatile var onFailed: (() -> Unit)? = null
    @Volatile var onCancelled: (() -> Unit)? = null
  }

```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateInstallReceiver.kt`, find:

```kotlin
      }
      PackageInstaller.STATUS_SUCCESS -> Log.i(UpdateDownloader.TAG, "install: done")
      else -> failed("install: status $status")
    }
```

Replace it with:

```kotlin
      }
      PackageInstaller.STATUS_SUCCESS -> Log.i(UpdateDownloader.TAG, "install: done")
      PackageInstaller.STATUS_FAILURE_ABORTED -> {
        Log.i(UpdateDownloader.TAG, "install: cancelled")
        onCancelled?.invoke()
      }
      else -> failed("install: status $status")
    }
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateInstaller.kt`, find:

```kotlin
    MISSING("missing"),
    FAILED("failed"),
  }

```

Replace it with:

```kotlin
    MISSING("missing"),
    FAILED("failed"),
    /** Later (or Back) on the card while Install still waited for the printers: nothing started (the N2 review gate,
     *  the review's m-1). */
    CANCELLED("cancelled"),
  }

```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateInstaller.kt`, find:

```kotlin
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
    }
    val id = installer.createSession(params)
    return try {
```

Replace it with:

```kotlin
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED)
    }
    // A session that cannot be written or committed is abandoned, never left open: an IOException, or a RuntimeException
    // such as SecurityException (the N2 review gate, the review's m-5).
    val id = installer.createSession(params)
    return try {
```

In `apps/mobile/android/app/src/main/java/com/possoftware/pos/update/UpdateInstaller.kt`, find:

```kotlin
      installer.abandonSession(id)
      InstallStart.FAILED
    } catch (e: SecurityException) {
      installer.abandonSession(id)
      InstallStart.FAILED
```

Replace it with:

```kotlin
      installer.abandonSession(id)
      InstallStart.FAILED
    } catch (e: RuntimeException) {
      installer.abandonSession(id)
      InstallStart.FAILED
```

In `apps/mobile/src/native/PosUpdate.ts`, find:

```ts
export type UpdateCardInfo = { version: string; notes: string };

/** What a tap on Install started (Kotlin's UpdateInstaller.InstallStart). */
export type InstallAnswer = 'started' | 'permission' | 'missing' | 'failed';

export interface PosUpdateModule {
```

Replace it with:

```ts
export type UpdateCardInfo = { version: string; notes: string };

/** What a tap on Install started (Kotlin's UpdateInstaller.InstallStart); "cancelled": Later came while Install still
 *  waited for the printers, so nothing started. */
export type InstallAnswer =
  | 'started'
  | 'permission'
  | 'missing'
  | 'failed'
  | 'cancelled';

export interface PosUpdateModule {
```

In `apps/mobile/src/native/PosUpdate.ts`, find:

```ts
/** Kotlin's PosUpdateModule.CARD_EVENT: a card that waited for a print to finish. */
export const UPDATE_CARD_EVENT = 'PosUpdateCard';
/** Kotlin's PosUpdateModule.RESULT_EVENT: Android's installer failed, or the user cancelled its dialog. */
export const UPDATE_RESULT_EVENT = 'PosUpdateResult';

```

Replace it with:

```ts
/** Kotlin's PosUpdateModule.CARD_EVENT: a card that waited for a print to finish. */
export const UPDATE_CARD_EVENT = 'PosUpdateCard';
/** Kotlin's PosUpdateModule.RESULT_EVENT, `{ ok: false, cancelled }`: Android's installer failed, or the user cancelled
 *  its dialog (`cancelled: true`). */
export const UPDATE_RESULT_EVENT = 'PosUpdateResult';

```

In `apps/mobile/src/screens/UpdateCard.tsx`, find:

```tsx
  asCardInfo,
  CARD_START,
  reduceCard,
  type CardState,
```

Replace it with:

```tsx
  asCardInfo,
  CARD_START,
  cardResultEvent,
  reduceCard,
  type CardState,
```

In `apps/mobile/src/screens/UpdateCard.tsx`, find:

```tsx
 * The POS screen's update card: asked for when the screen mounts in view and each time the app comes back into view
 * (the app hands a card out at most once per open, so asking again is harmless); a card that waited for a print
 * arrives as an event, and a failed or cancelled install as another.
 */
export function useUpdateCard() {
```

Replace it with:

```tsx
 * The POS screen's update card: asked for when the screen mounts in view and each time the app comes back into view
 * (the app hands a card out at most once per open, so asking again is harmless); a card that waited for a print
 * arrives as an event, and Android's answer to an install as another (a Cancel closes the card as Later does).
 */
export function useUpdateCard() {
```

In `apps/mobile/src/screens/UpdateCard.tsx`, find:

```tsx
    });
    const card = DeviceEventEmitter.addListener(UPDATE_CARD_EVENT, offer);
    const result = DeviceEventEmitter.addListener(UPDATE_RESULT_EVENT, () =>
      dispatch({ type: 'installFailed' }),
    );
    return () => {
```

Replace it with:

```tsx
    });
    const card = DeviceEventEmitter.addListener(UPDATE_CARD_EVENT, offer);
    const result = DeviceEventEmitter.addListener(UPDATE_RESULT_EVENT, value =>
      dispatch(cardResultEvent(value)),
    );
    return () => {
```

In `apps/mobile/src/update-card.ts`, find:

```ts
      return { ...state, note: 'failed', waiting: 'none' };
    case 'missing':
      return closed(state);
  }
}

```

Replace it with:

```ts
      return { ...state, note: 'failed', waiting: 'none' };
    case 'missing':
    case 'cancelled':
      return closed(state);
  }
}

/** The app's answer after Android's installer (Kotlin's RESULT_EVENT): a Cancel in its dialog closes the card as Later
 *  does (the N2 review gate, the owner's ruling of 2026-10-13); anything else is a failure the card says. */
export function cardResultEvent(value: unknown): CardEvent {
  const cancelled =
    typeof value === 'object' &&
    value !== null &&
    (value as { cancelled?: unknown }).cancelled === true;
  return cancelled ? { type: 'later' } : { type: 'installFailed' };
}

```

- [ ] **Step 5: Run them and see them pass, with the suites**

```bash
cd /d/kd/lucifer/apps/mobile && node --import tsx --test src/update-card.test.ts 2>&1 | grep -E "^not ok|# (tests|pass|fail)"
npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)" && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "typecheck and lint clean"
npx jest 2>&1 | grep -E "^Tests:|^Test Suites:"
cd android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --rerun --console=plain 2>&1 | grep -E "^e:|^w:.*/update/|FAILED|^BUILD" | sed -E 's/ in [0-9hms ]+$//'
for f in app/build/test-results/testDebugUnitTest/TEST-com.possoftware.pos.update.*.xml; do grep -o 'name="[^"]*" tests="[0-9]*" skipped="[0-9]*" failures="[0-9]*" errors="[0-9]*"' "$f" | head -1; done
```
Expected: `# tests 8`, `# pass 8`, `# fail 0`; mobile `# tests 168`, `# pass 168`, `# fail 0`, `typecheck and lint
clean`; `Test Suites: 4 passed, 4 total`, `Tests: 8 passed, 8 total`; `BUILD SUCCESSFUL`, no `e:` line and no warning in
`update/`; `UpdateFilesTest` `tests="9"`, `UpdateManifestTest` `tests="12"`, `UpdateScheduleTest` `tests="8"`, each
`failures="0" errors="0"`.

- [ ] **Step 6: Commit** (`git add` the twelve files; `$SP/msg-n3-0.txt`):

```text
fix(app): the N2 review's minors and the owner's two rulings: Cancel in Android's install dialog closes the update card like Later (offered again at the next app open), the card waits at most 2 minutes for idle printers, Later stops an Install still waiting for them, a download is on disk before its rename and a kept file is hashed again before it is called ready or installed (a damaged one downloads again), a session that cannot be written is always abandoned, and the Jest test hears every AppState listener; two JVM tests, a reducer test, a Jest test, pins 30-32 needles (native apps 2.0, Session N3, the N2 review gate)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 31: The Android address rules on Windows (`src/pos-url.ts`)

**Files:**
- Create: `apps/desktop/src/pos-url.ts`; Test: `apps/desktop/src/pos-url.test.ts` (3 tests)
- Modify: `apps/desktop/src/store.ts`, `src/url-window.ts` (`normalizePosUrl`), `src/server-url.ts` (the address rules go), `apps/mobile/src/url.ts` (header comment)
- Test: `src/server-url.test.ts` (the 16 `normalizeServerUrl` tests go), `src/store.test.ts` (1 test), `src/desktop-paths.test.ts` (pins (11)/(12) read `pos-url.ts`), `apps/desktop/package.json` (the test script)

**Interfaces:** `normalizePosUrl(input): NormalizeResult` and the six error words, `parseUrlParts`, `isValidHost`, `isPrivateIpv4`, `SANDBEE_DOMAIN`, as in `apps/mobile/src/url.ts`; `server-url.ts` keeps `START_PATH`, `startUrl`, `isSameOrigin`, `isExternalHttpUrl`.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/package.json`, find:

```json
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "test": "node --import tsx --test src/server-url.test.ts src/store.test.ts src/window-state.test.ts src/escpos.test.ts src/raw-spool.test.ts src/raw-tcp.test.ts src/printer-check.test.ts src/desktop-paths.test.ts",
    "start": "npm run build && electron .",
    "dist": "npm run build && electron-builder --win nsis --publish never"
```

Replace it with:

```json
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "test": "node --import tsx --test src/server-url.test.ts src/pos-url.test.ts src/store.test.ts src/window-state.test.ts src/escpos.test.ts src/raw-spool.test.ts src/raw-tcp.test.ts src/printer-check.test.ts src/desktop-paths.test.ts",
    "start": "npm run build && electron .",
    "dist": "npm run build && electron-builder --win nsis --publish never"
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
    "log.ts",
    "server-url.ts",
    "store.ts",
    "window-state.ts",
```

Replace it with:

```ts
    "log.ts",
    "server-url.ts",
    "pos-url.ts",
    "store.ts",
    "window-state.ts",
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
    ["src/log.ts", read("src/log.ts")],
    ["src/server-url.ts", read("src/server-url.ts")],
    ["src/store.ts", read("src/store.ts")],
    ["src/window-state.ts", read("src/window-state.ts")],
```

Replace it with:

```ts
    ["src/log.ts", read("src/log.ts")],
    ["src/server-url.ts", read("src/server-url.ts")],
    ["src/pos-url.ts", read("src/pos-url.ts")],
    ["src/store.ts", read("src/store.ts")],
    ["src/window-state.ts", read("src/window-state.ts")],
```

Create `apps/desktop/src/pos-url.test.ts`:

```ts
// Native apps 2.0 (spec §9): the Windows address window reads an address exactly as the Android start screen does. One
// table of inputs, the way people type them, runs through this app's normalizePosUrl and through the Android app's own
// (apps/mobile/src/url.ts, loaded by path: it has no imports); the results must be equal. A few fixed expectations keep
// both from drifting together.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  normalizePosUrl,
  URL_CREDENTIALS_ERROR,
  URL_EMPTY_ERROR,
  URL_HTTP_ERROR,
  URL_INVALID_ERROR,
  URL_PORT_ERROR,
  URL_SCHEME_ERROR,
  type NormalizeResult,
} from "./pos-url";

type AndroidUrl = {
  normalizePosUrl(input: string): NormalizeResult;
  URL_EMPTY_ERROR: string;
  URL_INVALID_ERROR: string;
  URL_SCHEME_ERROR: string;
  URL_HTTP_ERROR: string;
  URL_CREDENTIALS_ERROR: string;
  URL_PORT_ERROR: string;
};

const ANDROID_URL = path.join(__dirname, "..", "..", "mobile", "src", "url.ts");

async function android(): Promise<AndroidUrl> {
  return (await import(pathToFileURL(ANDROID_URL).href)) as AndroidUrl;
}

const LONG_LABEL = "a".repeat(64);
const LONG_HOST = Array.from({ length: 64 }, () => "abc").join(".") + ".in";

const INPUTS = [
  "mycafe",
  "MyCafe ",
  "  mycafe  ",
  "mycafe/pos",
  "mycafe?x=1",
  "mycafe.sandbee.in",
  "https://mycafe.sandbee.in/pos",
  "HTTPS://MyCafe.Sandbee.in",
  "http://mycafe.sandbee.in",
  "http://localhost:3000",
  "HTTP://LOCALHOST:3110",
  "http://127.0.0.1:3110",
  "http://192.168.1.20:3000",
  "http://192.168.1.20:3000/pos?x=1",
  "http://10.0.0.5",
  "http://172.16.0.1",
  "http://172.32.0.1",
  "http://8.8.8.8",
  "https://8.8.8.8",
  "1234",
  "192.168.1.20",
  "localhost",
  "https://user:pw@mycafe.sandbee.in",
  "https://mycafe.sandbee.in:0",
  "https://mycafe.sandbee.in:65536",
  "https://mycafe.sandbee.in:443",
  "https://mycafe.sandbee.in:8443",
  "mycafe.sandbee.in:8443",
  "ftp://mycafe.sandbee.in",
  "javascript:alert(1)",
  "my_cafe",
  "-mycafe",
  "mycafe-",
  LONG_LABEL,
  "https://" + LONG_HOST,
  "[::1]",
  "https://[::1]",
  "mycafé",
  "",
  "   ",
  "my\tcafe",
  "https://mycafe.sandbee.in#x",
  "mycafe.sandbee.in/",
  "https://mycafe.sandbee.in./",
  "https://pos.mycafe.example.com",
];

test("parity: every input gives the Android app's result, origin or error", async () => {
  assert.ok(INPUTS.length >= 40, "at least 40 inputs");
  assert.ok(LONG_HOST.length > 253, "the long host is over 253 characters");
  const { normalizePosUrl: onAndroid } = await android();
  for (const input of INPUTS) {
    assert.deepEqual(normalizePosUrl(input), onAndroid(input), JSON.stringify(input));
  }
});

test("the rules themselves, so both apps cannot drift together", () => {
  const ok = (origin: string): NormalizeResult => ({ ok: true, origin });
  const no = (error: string): NormalizeResult => ({ ok: false, error });
  assert.deepEqual(normalizePosUrl("MyCafe "), ok("https://mycafe.sandbee.in"));
  assert.deepEqual(normalizePosUrl("mycafe/pos"), ok("https://mycafe.sandbee.in"));
  assert.deepEqual(normalizePosUrl("http://192.168.1.20:3000"), ok("http://192.168.1.20:3000"));
  assert.deepEqual(normalizePosUrl("https://mycafe.sandbee.in:443"), ok("https://mycafe.sandbee.in"));
  assert.deepEqual(normalizePosUrl("http://8.8.8.8"), no(URL_HTTP_ERROR));
  assert.deepEqual(normalizePosUrl("1234"), no(URL_INVALID_ERROR));
  assert.deepEqual(normalizePosUrl("https://user:pw@mycafe.sandbee.in"), no(URL_CREDENTIALS_ERROR));
  assert.deepEqual(normalizePosUrl("https://mycafe.sandbee.in:65536"), no(URL_PORT_ERROR));
  assert.deepEqual(normalizePosUrl("ftp://mycafe.sandbee.in"), no(URL_SCHEME_ERROR));
  assert.deepEqual(normalizePosUrl("   "), no(URL_EMPTY_ERROR));
});

test("the error words are the Android app's, and all different", async () => {
  const a = await android();
  const ours = [URL_EMPTY_ERROR, URL_INVALID_ERROR, URL_SCHEME_ERROR, URL_HTTP_ERROR, URL_CREDENTIALS_ERROR, URL_PORT_ERROR];
  const theirs = [a.URL_EMPTY_ERROR, a.URL_INVALID_ERROR, a.URL_SCHEME_ERROR, a.URL_HTTP_ERROR, a.URL_CREDENTIALS_ERROR, a.URL_PORT_ERROR];
  assert.deepEqual(ours, theirs);
  assert.equal(new Set(ours).size, ours.length);
});
```

Replace the whole of `apps/desktop/src/server-url.test.ts` with:

```ts
// Pins for src/server-url.ts -- pure module, no electron import. The saved address itself is read by pos-url.ts (the
// Android app's rules, native apps 2.0); pos-url.test.ts pins those.
import { test } from "node:test";
import assert from "node:assert/strict";
import { START_PATH, startUrl, isSameOrigin, isExternalHttpUrl } from "./server-url";

test("startUrl: appends START_PATH to the origin", () => {
  assert.equal(START_PATH, "/pos");
  assert.equal(startUrl("https://my-pos.example.com"), "https://my-pos.example.com/pos");
});

test("isSameOrigin: identical origin -> true", () => {
  assert.equal(
    isSameOrigin("https://my-pos.example.com/pos", "https://my-pos.example.com"),
    true,
  );
});

test("isSameOrigin: different host -> false", () => {
  assert.equal(
    isSameOrigin("https://evil.example.com/pos", "https://my-pos.example.com"),
    false,
  );
});

test("isSameOrigin: different port -> false", () => {
  assert.equal(
    isSameOrigin("https://my-pos.example.com:8080/pos", "https://my-pos.example.com"),
    false,
  );
});

test("isSameOrigin: different scheme -> false", () => {
  assert.equal(
    isSameOrigin("http://my-pos.example.com/pos", "https://my-pos.example.com"),
    false,
  );
});

test("isSameOrigin: garbage url -> false, does not throw", () => {
  assert.doesNotThrow(() => {
    assert.equal(isSameOrigin("not a url", "https://my-pos.example.com"), false);
  });
});

test("isExternalHttpUrl: http -> true", () => {
  assert.equal(isExternalHttpUrl("http://example.com"), true);
});

test("isExternalHttpUrl: https -> true", () => {
  assert.equal(isExternalHttpUrl("https://example.com"), true);
});

test("isExternalHttpUrl: file: -> false", () => {
  assert.equal(isExternalHttpUrl("file:///etc/passwd"), false);
});

test("isExternalHttpUrl: javascript: -> false", () => {
  assert.equal(isExternalHttpUrl("javascript:alert(1)"), false);
});

test("isExternalHttpUrl: about: -> false", () => {
  assert.equal(isExternalHttpUrl("about:blank"), false);
});

test("isExternalHttpUrl: mailto: -> false", () => {
  assert.equal(isExternalHttpUrl("mailto:someone@example.com"), false);
});

test("isExternalHttpUrl: garbage -> false, does not throw", () => {
  assert.doesNotThrow(() => {
    assert.equal(isExternalHttpUrl("not a url"), false);
  });
});
```

In `apps/desktop/src/store.test.ts`, find:

```ts
});

test("normalizeStore: autoStart false survives (not coerced to null)", () => {
  const result = normalizeStore({ autoStart: false });
```

Replace it with:

```ts
});

test("normalizeStore: serverOrigin is re-validated by the Android app's rules -- a private-network http address stays", () => {
  // Native apps 2.0 (spec §9): the address window saves what normalizePosUrl accepts; the next start must read it back.
  assert.equal(normalizeStore({ serverOrigin: "http://192.168.1.20:3000" }).serverOrigin, "http://192.168.1.20:3000");
  assert.equal(normalizeStore({ serverOrigin: "http://localhost:3110" }).serverOrigin, "http://localhost:3110");
});

test("normalizeStore: autoStart false survives (not coerced to null)", () => {
  const result = normalizeStore({ autoStart: false });
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/desktop && timeout 250 node --import tsx --test src/pos-url.test.ts src/store.test.ts src/server-url.test.ts src/desktop-paths.test.ts 2>&1 | grep -E "^not ok|Cannot find module|^# (tests|pass|fail)"
```
Expected: `# Error: Cannot find module './pos-url'` (the file `src\\pos-url.test.ts` fails), `not ok … normalizeStore:
serverOrigin is re-validated by the Android app's rules -- a private-network http address stays`, and pins `(11)` and
`(12)` (they read `pos-url.ts`); `# tests 117`, `# pass 113`, `# fail 4`.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/pos-url.ts`:

```ts
// The POS address rules of the Android app, ported from apps/mobile/src/url.ts (native apps 2.0, spec §9): a bare
// workspace name means <name>.sandbee.in, an address without a scheme gets https://, http:// works only for this PC or a
// private network address, a port from 1 to 65535, no user name or password, and the same error words. pos-url.test.ts
// runs one table of inputs through both apps' functions and requires equal results. Pure (no electron import, no global
// URL): safe for node:test.

export const MIN_PORT = 1;
export const MAX_PORT = 65535;
export const MAX_HOST_CHARS = 253;
export const MAX_LABEL_CHARS = 63;

export const URL_EMPTY_ERROR = "Enter the address of your POS.";
export const URL_INVALID_ERROR =
  "That is not a valid address. Type your workspace name (like yourcafe) or the full address (like https://yourcafe.sandbee.in).";
export const URL_SCHEME_ERROR = "The address must start with https://";
export const URL_HTTP_ERROR =
  "http:// only works for this device or a computer on your own network. Use https:// for any other address.";
export const URL_CREDENTIALS_ERROR = "Remove the user name and password from the address.";
export const URL_PORT_ERROR = "The port number must be between 1 and 65535.";

const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443 };
const SCHEME_PREFIX = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/;
const PORT_DIGITS = /^\d{1,5}$/;
const NUMERIC_HOST = /^[0-9.]+$/;
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const OCTET = /^(0|[1-9]\d{0,2})$/;

export type UrlParts = {
  scheme: string;
  userinfo: string | null;
  host: string;
  port: string | null;
};

export type NormalizeResult = { ok: true; origin: string } | { ok: false; error: string };

// Splits "scheme://[user@]host[:port]" without interpreting the host.
export function parseUrlParts(input: string): UrlParts | null {
  const match = SCHEME_PREFIX.exec(input);
  if (match === null) {
    return null;
  }
  const authority = match[2]!;
  const at = authority.lastIndexOf("@");
  const userinfo = at >= 0 ? authority.slice(0, at) : null;
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  const bracketEnd = hostPort.startsWith("[") ? hostPort.indexOf("]") : -1;
  const colon = hostPort.lastIndexOf(":");
  if (colon > bracketEnd) {
    return {
      scheme: match[1]!.toLowerCase(),
      userinfo,
      host: hostPort.slice(0, colon).toLowerCase(),
      port: hostPort.slice(colon + 1),
    };
  }
  return { scheme: match[1]!.toLowerCase(), userinfo, host: hostPort.toLowerCase(), port: null };
}

function octetsOf(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => OCTET.test(part))) {
    return null;
  }
  const octets = parts.map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

// A DNS-style name or a dotted IPv4. IPv6 literals and anything with an odd character (backslash, space, tab...) are
// rejected on purpose.
export function isValidHost(host: string): boolean {
  if (host.length === 0 || host.length > MAX_HOST_CHARS) {
    return false;
  }
  if (NUMERIC_HOST.test(host)) {
    return octetsOf(host) !== null;
  }
  return host.split(".").every((label) => label.length <= MAX_LABEL_CHARS && LABEL.test(label));
}

export function isPrivateIpv4(host: string): boolean {
  const octets = octetsOf(host);
  if (octets === null) {
    return false;
  }
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// null = no port written; NaN = written but malformed.
function portNumber(port: string | null): number | null {
  if (port === null) {
    return null;
  }
  if (!PORT_DIGITS.test(port)) {
    return Number.NaN;
  }
  const value = Number(port);
  return value >= MIN_PORT && value <= MAX_PORT ? value : Number.NaN;
}

function buildOrigin(parts: UrlParts, port: number | null): string {
  const keep = port !== null && port !== DEFAULT_PORTS[parts.scheme];
  return parts.scheme + "://" + parts.host + (keep ? ":" + port : "");
}

// The Sandbee apps' rule: a bare workspace name (one DNS label with a letter in it, no dot, scheme or port; a path,
// query or hash after it is dropped later with the rest of the address) means <name>.sandbee.in. A digits-only label is
// a mistyped IP, never a name. Every full address is taken as written.
export const SANDBEE_DOMAIN = "sandbee.in";
const HAS_LETTER = /[a-z]/;
const PATH_START = /[/?#]/;

function expandWorkspaceName(input: string): string {
  const cut = input.search(PATH_START);
  const name = (cut < 0 ? input : input.slice(0, cut)).toLowerCase();
  const rest = cut < 0 ? "" : input.slice(cut);
  return name !== "localhost" && name.length <= MAX_LABEL_CHARS && LABEL.test(name) && HAS_LETTER.test(name)
    ? name + "." + SANDBEE_DOMAIN + rest
    : input;
}

export function normalizePosUrl(input: string): NormalizeResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: URL_EMPTY_ERROR };
  }
  const withScheme = SCHEME_PREFIX.test(trimmed) ? trimmed : "https://" + expandWorkspaceName(trimmed);
  const parts = parseUrlParts(withScheme);
  if (parts === null) {
    return { ok: false, error: URL_INVALID_ERROR };
  }
  if (parts.userinfo !== null) {
    return { ok: false, error: URL_CREDENTIALS_ERROR };
  }
  if (parts.scheme !== "https" && parts.scheme !== "http") {
    return { ok: false, error: URL_SCHEME_ERROR };
  }
  const port = portNumber(parts.port);
  if (port !== null && Number.isNaN(port)) {
    return { ok: false, error: URL_PORT_ERROR };
  }
  if (!isValidHost(parts.host)) {
    return { ok: false, error: URL_INVALID_ERROR };
  }
  if (parts.scheme === "http" && parts.host !== "localhost" && !isPrivateIpv4(parts.host)) {
    return { ok: false, error: URL_HTTP_ERROR };
  }
  return { ok: true, origin: buildOrigin(parts, port) };
}
```

In `apps/desktop/src/server-url.ts`, find:

```ts
// Pure URL validation/normalization for the desktop shell's saved server address.
// No electron imports — safe for node:test.

export const START_PATH = "/pos";
export const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"] as const;

export const URL_EMPTY_ERROR = "Enter the address of your POS.";
export const URL_INVALID_ERROR =
  "That is not a valid web address. It should look like https://your-pos.example.com";
export const URL_SCHEME_ERROR = "The address must start with https://";
export const URL_CREDENTIALS_ERROR = "Remove the user name and password from the address.";

export function startUrl(origin: string): string {
  return origin + START_PATH;
}

export type NormalizeResult = { ok: true; origin: string } | { ok: false; error: string };

export function normalizeServerUrl(input: string): NormalizeResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: URL_EMPTY_ERROR };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: URL_INVALID_ERROR };
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, error: URL_CREDENTIALS_ERROR };
  }

  if (url.protocol === "https:") {
    return { ok: true, origin: url.origin };
  }

  if (url.protocol === "http:" && LOCAL_HOSTNAMES.includes(url.hostname as (typeof LOCAL_HOSTNAMES)[number])) {
    return { ok: true, origin: url.origin };
  }

  return { ok: false, error: URL_SCHEME_ERROR };
}

```

Replace it with:

```ts
// The start path and the origin checks for the desktop shell's saved POS address. The address itself is read by
// pos-url.ts (the Android app's rules, native apps 2.0). No electron imports — safe for node:test.

export const START_PATH = "/pos";

export function startUrl(origin: string): string {
  return origin + START_PATH;
}

```

In `apps/desktop/src/store.ts`, find:

```ts
// (no electron imports) — safe for node:test.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { normalizeServerUrl } from "./server-url";
import { isPrintMode, type PrintMode } from "./shared";

```

Replace it with:

```ts
// (no electron imports) — safe for node:test.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { normalizePosUrl } from "./pos-url";
import { isPrintMode, type PrintMode } from "./shared";

```

In `apps/desktop/src/store.ts`, find:

```ts
  let serverOrigin: string | null = null;
  if (Object.hasOwn(source, "serverOrigin") && typeof source.serverOrigin === "string") {
    const normalized = normalizeServerUrl(source.serverOrigin);
    serverOrigin = normalized.ok ? normalized.origin : null;
  }
```

Replace it with:

```ts
  let serverOrigin: string | null = null;
  if (Object.hasOwn(source, "serverOrigin") && typeof source.serverOrigin === "string") {
    const normalized = normalizePosUrl(source.serverOrigin);
    serverOrigin = normalized.ok ? normalized.origin : null;
  }
```

In `apps/desktop/src/url-window.ts`, find:

```ts
// The first-run/"Change server address…" window: a small, non-resizable
// prompt for the saved server origin. No preload state beyond three IPC
// channels; the actual validation lives in server-url.ts.
import path from "node:path";
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
```

Replace it with:

```ts
// The first-run/"Change server address…" window: a small, non-resizable
// prompt for the saved server origin. No preload state beyond three IPC
// channels; the address rules live in pos-url.ts (the Android app's).
import path from "node:path";
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
```

In `apps/desktop/src/url-window.ts`, find:

```ts
  URL_SAVE_CHANNEL,
} from "./shared";
import { normalizeServerUrl } from "./server-url";
import type { Logger } from "./log";

```

Replace it with:

```ts
  URL_SAVE_CHANNEL,
} from "./shared";
import { normalizePosUrl, URL_EMPTY_ERROR } from "./pos-url";
import type { Logger } from "./log";

```

In `apps/desktop/src/url-window.ts`, find:

```ts
  ipcMain.handle(URL_SAVE_CHANNEL, (_event: IpcMainInvokeEvent, input: unknown) => {
    if (typeof input !== "string") {
      return { ok: false, error: "Enter the address of your POS." };
    }
    const result = normalizeServerUrl(input);
    if (result.ok) {
      deps.onSaved(result.origin);
```

Replace it with:

```ts
  ipcMain.handle(URL_SAVE_CHANNEL, (_event: IpcMainInvokeEvent, input: unknown) => {
    if (typeof input !== "string") {
      return { ok: false, error: URL_EMPTY_ERROR };
    }
    const result = normalizePosUrl(input);
    if (result.ok) {
      deps.onSaved(result.origin);
```

In `apps/mobile/src/url.ts`, find:

```ts
// Pure URL validation for the saved POS address. No global URL (React Native's
// polyfill is partial), no react-native import: safe for node:test.
// Mirrors apps/desktop/src/server-url.ts, plus the private-network http rule and
// the Sandbee app's bare workspace name (the Windows app does not expand one).

export const START_PATH = '/pos';
```

Replace it with:

```ts
// Pure URL validation for the saved POS address. No global URL (React Native's
// polyfill is partial), no react-native import: safe for node:test.
// The Windows app reads an address by the same rules (apps/desktop/src/pos-url.ts;
// its parity test runs one table of inputs through both).

export const START_PATH = '/pos';
```

- [ ] **Step 4: Run them and see them pass, with the suites**

```bash
cd /d/kd/lucifer/apps/desktop && timeout 250 npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)" && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "typecheck and lint clean"
cd ../mobile && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
```
Expected: desktop `# tests 193`, `# pass 193`, `# fail 0`, `typecheck and lint clean`; mobile `# tests 168`, `# fail 0`.

- [ ] **Step 5: Commit** (`$SP/msg-n3-1.txt`):

```text
feat(desktop): the Windows app reads a POS address by the Android app's rules (pos-url.ts, ported from apps/mobile/src/url.ts): a bare workspace name means <name>.sandbee.in, http:// only for this PC or a private network address, a port from 1 to 65535, no user name or password, the same error words; a parity test runs 45 inputs through both apps; the saved address is read back by the same rules; normalizeServerUrl and its tests go (native apps 2.0, Session N3, spec §9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 32: The one health check (`src/pos-health.ts`)

**Files:**
- Create: `apps/desktop/src/pos-health.ts`; Test: `apps/desktop/src/pos-health.test.ts` (7 tests)
- Test: `src/desktop-paths.test.ts` (pins (11)/(12) read `pos-health.ts`), `apps/desktop/package.json` (the test script)

**Interfaces:** `checkPos(origin, fetcher: HealthFetch, timeoutMs = HEALTH_TIMEOUT_MS): Promise<PosCheck>`; `PosCheck = { ok: true } | { ok: false; error }`; `HealthInit` (GET, `redirect: "manual"`, `cache: "no-store"`, an `accept` header, the abort signal); `HEALTH_PATH = "/api/health"`, `HEALTH_TIMEOUT_MS = 5_000`; words "We couldn't find a POS at <host>. Check the name." and "Couldn't reach <host>. Check the internet connection."

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/package.json`, find:

```json
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "test": "node --import tsx --test src/server-url.test.ts src/pos-url.test.ts src/store.test.ts src/window-state.test.ts src/escpos.test.ts src/raw-spool.test.ts src/raw-tcp.test.ts src/printer-check.test.ts src/desktop-paths.test.ts",
    "start": "npm run build && electron .",
    "dist": "npm run build && electron-builder --win nsis --publish never"
```

Replace it with:

```json
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "test": "node --import tsx --test src/server-url.test.ts src/pos-url.test.ts src/pos-health.test.ts src/store.test.ts src/window-state.test.ts src/escpos.test.ts src/raw-spool.test.ts src/raw-tcp.test.ts src/printer-check.test.ts src/desktop-paths.test.ts",
    "start": "npm run build && electron .",
    "dist": "npm run build && electron-builder --win nsis --publish never"
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
    "server-url.ts",
    "pos-url.ts",
    "store.ts",
    "window-state.ts",
```

Replace it with:

```ts
    "server-url.ts",
    "pos-url.ts",
    "pos-health.ts",
    "store.ts",
    "window-state.ts",
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
    ["src/server-url.ts", read("src/server-url.ts")],
    ["src/pos-url.ts", read("src/pos-url.ts")],
    ["src/store.ts", read("src/store.ts")],
    ["src/window-state.ts", read("src/window-state.ts")],
```

Replace it with:

```ts
    ["src/server-url.ts", read("src/server-url.ts")],
    ["src/pos-url.ts", read("src/pos-url.ts")],
    ["src/pos-health.ts", read("src/pos-health.ts")],
    ["src/store.ts", read("src/store.ts")],
    ["src/window-state.ts", read("src/window-state.ts")],
```

Create `apps/desktop/src/pos-health.test.ts`:

```ts
// Native apps 2.0 (spec §9): the address window checks a typed address once before saving it. A fake fetch stands in for
// Electron's net.fetch: what the POS answers decides found, not found or not reached, always in one request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPos, HEALTH_PATH, HEALTH_TIMEOUT_MS, type HealthFetch, type HealthInit } from "./pos-health";

type Call = { url: string; init: HealthInit };

function answering(status: number, body: () => Promise<unknown>): { fetch: HealthFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: HealthFetch = async (url, init) => {
    calls.push({ url, init });
    return { status, json: body };
  };
  return { fetch, calls };
}

const json = (value: unknown) => () => Promise.resolve(value);
const NOT_FOUND = "We couldn't find a POS at mycafe.sandbee.in. Check the name.";
const UNREACHABLE = "Couldn't reach mycafe.sandbee.in. Check the internet connection.";

test("a POS whose database is up (200, its tenant named) is found, in one GET of /api/health that follows no redirect", async () => {
  const { fetch, calls } = answering(200, json({ ok: true, db: "up", tenant: "dev", ts: 1 }));
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://mycafe.sandbee.in" + HEALTH_PATH);
  assert.equal(HEALTH_PATH, "/api/health");
  assert.equal(calls[0]!.init.method, "GET");
  assert.equal(calls[0]!.init.redirect, "manual");
  assert.equal(HEALTH_TIMEOUT_MS, 5_000);
});

test("a POS whose database is down (503, its tenant named) is found: the address is right, the POS page shows its own error", async () => {
  const { fetch, calls } = answering(503, json({ ok: false, db: "down", tenant: "mycafe", ts: 1 }));
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: true });
  assert.equal(calls.length, 1);
});

test("no POS at the address (404) is not found, and the message names the host", async () => {
  const { fetch, calls } = answering(404, json({ error: "not found" }));
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: false, error: NOT_FOUND });
  assert.equal(calls.length, 1);
  const local = answering(404, json({}));
  assert.deepEqual(await checkPos("http://127.0.0.1:8766", local.fetch), {
    ok: false,
    error: "We couldn't find a POS at 127.0.0.1:8766. Check the name.",
  });
});

test("another site's page (200 HTML) is not found", async () => {
  const { fetch, calls } = answering(200, () => Promise.reject(new SyntaxError("Unexpected token <")));
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: false, error: NOT_FOUND });
  assert.equal(calls.length, 1);
});

test("other JSON (200 without a tenant, or a redirect) is not found", async () => {
  for (const [status, body] of [
    [200, { ok: true }],
    [200, { tenant: 7, ok: true }],
    [200, null],
    [302, { tenant: "dev", ok: true }],
  ] as const) {
    const { fetch, calls } = answering(status, json(body));
    assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: false, error: NOT_FOUND }, JSON.stringify(body));
    assert.equal(calls.length, 1);
  }
});

test("no answer at all (a network error) is not reached", async () => {
  let calls = 0;
  const fetch: HealthFetch = async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  };
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch), { ok: false, error: UNREACHABLE });
  assert.equal(calls, 1);
});

test("no answer in time is not reached, and the request is aborted", async () => {
  let calls = 0;
  let aborted = false;
  const fetch: HealthFetch = (_url, init) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  };
  const started = Date.now();
  assert.deepEqual(await checkPos("https://mycafe.sandbee.in", fetch, 30), { ok: false, error: UNREACHABLE });
  assert.ok(Date.now() - started < 2_000, "the timeout ended the wait");
  assert.equal(aborted, true);
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/desktop && timeout 250 node --import tsx --test src/pos-health.test.ts src/desktop-paths.test.ts 2>&1 | grep -E "^not ok|Cannot find module|^# (tests|pass|fail)"
```
Expected: `# Error: Cannot find module './pos-health'` (the file `src\\pos-health.test.ts` fails) and pins `(11)` and
`(12)`; `# tests 69`, `# pass 66`, `# fail 3`.

- [ ] **Step 3: Implement**

Create `apps/desktop/src/pos-health.ts`:

```ts
// Native apps 2.0 (spec §9): the address window's one check before it saves an address. GET <origin>/api/health once,
// following no redirect. A POS answers with JSON that names its tenant: 200 when its database is up, 503 when it is down
// (the address is right either way, so it is saved and the POS page shows its own error). Any other answer is not a POS
// at that address; no answer at all, or none within 5 seconds, is a network problem. One request per typed address,
// nothing recurring (the free-tier rule). Pure: the fetch is passed in (Electron's net.fetch from url-window.ts), so
// node:test drives it with a fake.

export const HEALTH_PATH = "/api/health";
export const HEALTH_TIMEOUT_MS = 5_000;

export type PosCheck = { ok: true } | { ok: false; error: string };

export interface HealthInit {
  method: "GET";
  redirect: "manual";
  cache: "no-store";
  headers: Record<string, string>;
  signal: AbortSignal;
}

/** The part of fetch this check uses (Electron's net.fetch in the app, a fake in the tests). */
export type HealthFetch = (url: string, init: HealthInit) => Promise<{ status: number; json(): Promise<unknown> }>;

const FOUND_STATUSES = [200, 503];

export function notFoundError(host: string): string {
  return `We couldn't find a POS at ${host}. Check the name.`;
}

export function unreachableError(host: string): string {
  return `Couldn't reach ${host}. Check the internet connection.`;
}

/** The host (and port) of an origin normalizePosUrl made: "scheme://host[:port]". */
function hostOf(origin: string): string {
  return origin.replace(/^[a-z]+:\/\//, "");
}

function isPosHealth(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { tenant, ok } = body as { tenant?: unknown; ok?: unknown };
  return typeof tenant === "string" && typeof ok === "boolean";
}

export async function checkPos(origin: string, fetcher: HealthFetch, timeoutMs = HEALTH_TIMEOUT_MS): Promise<PosCheck> {
  const host = hostOf(origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Awaited<ReturnType<HealthFetch>>;
    try {
      response = await fetcher(origin + HEALTH_PATH, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch {
      return { ok: false, error: unreachableError(host) };
    }
    if (!FOUND_STATUSES.includes(response.status)) {
      return { ok: false, error: notFoundError(host) };
    }
    try {
      return isPosHealth(await response.json()) ? { ok: true } : { ok: false, error: notFoundError(host) };
    } catch {
      // Not JSON: another site's page.
      return { ok: false, error: notFoundError(host) };
    }
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run them and see them pass, with the suite**

```bash
cd /d/kd/lucifer/apps/desktop && node --import tsx --test src/pos-health.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"
timeout 250 npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)" && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "typecheck and lint clean"
```
Expected: `# tests 7`, `# pass 7`, `# fail 0`; desktop `# tests 200`, `# pass 200`, `# fail 0`, `typecheck and lint
clean`.

- [ ] **Step 5: Commit** (`$SP/msg-n3-2.txt`):

```text
feat(desktop): the address window's one check: GET <origin>/api/health once, no redirect, 5 seconds; a POS naming its tenant at 200 (its database up) or 503 (down: the address is right) is found, any other answer is not a POS at that address, no answer is a network problem; seven tests with a fake fetch, one request each (native apps 2.0, Session N3, spec §9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 33: The window

**Files:**
- Replace: `apps/desktop/assets/url-window.html` (the inline logo kept byte for byte), `assets/url-window.js`
- Modify: `src/url-window.ts` (480 × 640 of content, "POS address", the version, normalize → `checkPos` → save), `src/url-preload.ts` (`version`), `src/main.ts` (the logger to the URL handlers), `docs/GO-LIVE-CHECKLIST.md` (§7's first-run line)
- Test: `src/desktop-paths.test.ts` (pins (8), (9), (R5) deliberately changed; (A1), (A2)), `apps/cafe/lib/go-live-runbook.test.ts` (the window's words)

**Interfaces:** `posDesktopSetup` = `{ version, current(), save(input), cancel() }`; `save` answers `{ ok: true }` or `{ ok: false, error }` with pos-url's or pos-health's words.

- [ ] **Step 1: Write the failing tests**

In `apps/cafe/lib/go-live-runbook.test.ts`, find:

```ts
    ["Start with Windows", menuSrc, "menu.ts"],
    ["Change server address…", menuSrc, "menu.ts"],
    ["Use this address", urlHtml, "url-window.html"],
    ["Server address", urlHtml, "url-window.html"],
  ] as const) {
    assert.ok(section.includes(label), `§7 desktop sub-section must quote "${label}"`);
```

Replace it with:

```ts
    ["Start with Windows", menuSrc, "menu.ts"],
    ["Change server address…", menuSrc, "menu.ts"],
    // Native apps 2.0 Session N3 deliberately changed: the address window's words (spec §9).
    ["POS address", urlHtml, "url-window.html"],
  ] as const) {
    assert.ok(section.includes(label), `§7 desktop sub-section must quote "${label}"`);
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
```

Replace it with:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
});

test("(8) url-preload.ts duplicated literals equal shared.ts (URL_*_CHANNEL, SETUP_BRIDGE_KEY)", () => {
  assert.ok(urlPreloadSrc.includes(JSON.stringify(URL_CURRENT_CHANNEL)));
  assert.ok(urlPreloadSrc.includes(JSON.stringify(URL_SAVE_CHANNEL)));
  assert.ok(urlPreloadSrc.includes(JSON.stringify(URL_CANCEL_CHANNEL)));
  assert.ok(urlPreloadSrc.includes(JSON.stringify(SETUP_BRIDGE_KEY)));
});

test("(8) url-preload.ts exposes exactly ['current', 'save', 'cancel'] on posDesktopSetup", () => {
  const keys = extractExposedKeys(urlPreloadSrc, '"posDesktopSetup"');
  assert.deepEqual(keys.sort(), ["cancel", "current", "save"]);
});

```

Replace it with:

```ts
});

test("(8) url-preload.ts duplicated literals equal shared.ts (URL_*_CHANNEL, SETUP_BRIDGE_KEY, VERSION_ARG_PREFIX)", () => {
  assert.ok(urlPreloadSrc.includes(JSON.stringify(URL_CURRENT_CHANNEL)));
  assert.ok(urlPreloadSrc.includes(JSON.stringify(URL_SAVE_CHANNEL)));
  assert.ok(urlPreloadSrc.includes(JSON.stringify(URL_CANCEL_CHANNEL)));
  assert.ok(urlPreloadSrc.includes(JSON.stringify(SETUP_BRIDGE_KEY)));
  // Native apps 2.0 (spec §9): the window's footer shows the app's version, passed as preload.ts gets it.
  assert.ok(urlPreloadSrc.includes(JSON.stringify(VERSION_ARG_PREFIX)), "url-preload.ts must carry VERSION_ARG_PREFIX");
});

// Native apps 2.0 Session N3 deliberately changed: the version joins the three calls.
test("(8) url-preload.ts exposes exactly ['cancel', 'current', 'save', 'version'] on posDesktopSetup", () => {
  const keys = extractExposedKeys(urlPreloadSrc, '"posDesktopSetup"');
  assert.deepEqual(keys.sort(), ["cancel", "current", "save", "version"]);
});

```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
    assert.ok(!source.includes("url("), `${name} must not use a CSS url()`);
  }
  // Landmark: the placeholder copy legitimately contains "https://" as text,
  // not a loaded resource -- proves the scan actually read real content and
  // the negatives above aren't vacuous from an empty/blinded read.
  assert.ok(urlWindowHtml.includes('placeholder="https://your-pos.example.com"'));
});

test("(9) url-window.html: the five copy strings from plan A.12 are present (landmark id=\"error\")", () => {
  assert.ok(urlWindowHtml.includes('id="error"'));
  assert.match(urlWindowHtml, /Server address/);
  assert.ok(urlWindowHtml.includes('placeholder="https://your-pos.example.com"'));
  assert.match(urlWindowHtml, /Ask the person who set up your POS/);
  assert.match(urlWindowHtml, /Use this address/);
  assert.match(urlWindowHtml, />Cancel</);
});

```

Replace it with:

```ts
    assert.ok(!source.includes("url("), `${name} must not use a CSS url()`);
  }
  // Landmarks: the scan actually read real content, so the negatives above aren't vacuous from an empty/blinded read.
  assert.ok(urlWindowHtml.includes('placeholder="yourcafe or yourcafe.sandbee.in"'), "landmark: the placeholder");
  assert.ok(urlWindowJs.includes("posDesktopSetup.save("), "landmark: the script saves through the bridge");
});

// Native apps 2.0 Session N3 deliberately changed (spec §9): the Android start screen's words replace plan A.12's.
test("(9) url-window: the Android start screen's words, the help text the same in the page and the script (landmark id=\"error\")", () => {
  assert.ok(urlWindowHtml.includes('id="error"'), "landmark: id=error");
  for (const text of [
    "<title>POS address</title>",
    ">Connect to your workspace<",
    ">Your cafe, orders and printers. All in one place.<",
    ">POS address<",
    'placeholder="yourcafe or yourcafe.sandbee.in"',
    ">Your workspace<",
    ">Open POS<",
    ">Cancel<",
    ">Windows printers · USB · Wi-Fi / LAN<",
    `>${PRODUCT_NAME}<`,
  ]) {
    assert.ok(urlWindowHtml.includes(text), `url-window.html must carry ${text}`);
  }
  const help = "Type your workspace name, or the full address shared by your administrator. We’ll remember it for next time.";
  assert.ok(urlWindowHtml.includes(`>${help}<`) && urlWindowJs.includes(`"${help}"`), "the help words are the same in the page and the script");
  for (const text of ['"Check the address"', '"Connecting…"', '"Open POS"', `"${PRODUCT_NAME} · "`]) {
    assert.ok(urlWindowJs.includes(text), `url-window.js must carry ${text}`);
  }
  assert.ok(urlWindowHtml.includes('<button id="cancel" class="cancel" type="button" hidden>Cancel</button>'), "Cancel starts hidden (the first run)");
  assert.ok(urlWindowJs.includes('event.key === "Escape" && !cancelButton.hidden'), "Esc cancels only when Cancel is shown");
});

```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
});

test("(R5) url-window assets: inline data: logo under a data:-only img-src, a real form (Enter submits), product name in the header", () => {
  assert.ok(urlWindowHtml.includes("img-src data:"), "CSP must allow only data: images (the logo is inlined; file:// 'self' is not relied on)");
  assert.ok(urlWindowHtml.includes('src="data:image/png;base64,'), "the header logo must be inlined");
```

Replace it with:

```ts
});

// -- (A) native apps 2.0 (spec §9): the address window ----------------------
test("(A1) url-window.ts: 480 x 640 of content, not resizable, titled POS address, the version passed to the page", () => {
  assert.ok(urlWindowSrc.includes("export const URL_WINDOW_WIDTH = 480;"), "the window is 480 wide");
  assert.ok(urlWindowSrc.includes("export const URL_WINDOW_HEIGHT = 640;"), "the window is 640 high");
  assert.match(urlWindowSrc, /useContentSize: true,\s*resizable: false,/, "480 x 640 of content, not resizable");
  assert.ok(urlWindowSrc.includes('title: "POS address",'), "the window is titled POS address");
  assert.ok(urlWindowSrc.includes("additionalArguments: [`${VERSION_ARG_PREFIX}${app.getVersion()}`]"), "the version is passed to the page");
});

test("(A2) the address window makes no request itself: the main process reads the address by the Android rules, checks it once through net.fetch, then saves", () => {
  for (const needle of ["fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "import("]) {
    assert.ok(!urlWindowJs.includes(needle), `url-window.js must not use ${needle}`);
  }
  assert.ok(!urlWindowHtml.includes("connect-src"), "default-src 'none' must keep blocking every request from the page");
  const save = urlWindowSrc.slice(urlWindowSrc.indexOf("ipcMain.handle(URL_SAVE_CHANNEL"), urlWindowSrc.indexOf("ipcMain.handle(URL_CANCEL_CHANNEL"));
  const normalized = save.indexOf("normalizePosUrl(input)");
  const checked = save.indexOf("await checkPos(result.origin, (url, init) => net.fetch(url, init))");
  const saved = save.indexOf("deps.onSaved(result.origin)");
  assert.ok(normalized >= 0 && checked > normalized && saved > checked, "normalize, then the one check, then save");
  assert.ok(save.includes("if (!check.ok) return check;"), "an address that failed its check is never saved");
  const callers = readdirSync(SRC).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && read(`src/${name}`).includes("checkPos("));
  assert.deepEqual(callers.sort(), ["pos-health.ts", "url-window.ts"], "the one check is made only from the address window's save");
});

test("(R5) url-window assets: inline data: logo under a data:-only img-src, a real form (Enter submits), the product name on the page", () => {
  assert.ok(urlWindowHtml.includes("img-src data:"), "CSP must allow only data: images (the logo is inlined; file:// 'self' is not relied on)");
  assert.ok(urlWindowHtml.includes('src="data:image/png;base64,'), "the header logo must be inlined");
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
  assert.ok(urlWindowHtml.includes('<form id="address-form"') && urlWindowHtml.includes('type="submit"'), "the address entry must be a form so Enter submits (C27)");
  assert.ok(urlWindowJs.includes('addEventListener("submit"'), "the script must handle the form submit");
  assert.ok(urlWindowHtml.includes(PRODUCT_NAME), "the header must carry the product name (C13)");
  assert.ok(!existsSync(path.join(ROOT, "assets", "logo.png")), "assets/logo.png must not exist (it is inlined)");
});
```

Replace it with:

```ts
  assert.ok(urlWindowHtml.includes('<form id="address-form"') && urlWindowHtml.includes('type="submit"'), "the address entry must be a form so Enter submits (C27)");
  assert.ok(urlWindowJs.includes('addEventListener("submit"'), "the script must handle the form submit");
  assert.ok(urlWindowHtml.includes(PRODUCT_NAME), "the page must carry the product name (C13; the footer since native apps 2.0)");
  assert.ok(!existsSync(path.join(ROOT, "assets", "logo.png")), "assets/logo.png must not exist (it is inlined)");
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/desktop && timeout 250 node --import tsx --test src/desktop-paths.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"
cd ../cafe && timeout 300 node --import tsx --test lib/go-live-runbook.test.ts 2>&1 | grep -E "^not ok|^  error:|^# (tests|pass|fail)"
```
Expected: six pins fail (`# tests 70`, `# pass 64`, `# fail 6`): both `(8)` pins, `(9) vision-guard: …` (its landmark is
the new placeholder), `(9) url-window: the Android start screen's words, …`, `(A1)`, `(A2)`; the runbook's `PIN §7
desktop app: …` fails with `'§7 desktop sub-section must quote "POS address"'` (`# tests 97`, `# pass 96`, `# fail 1`).

- [ ] **Step 3: Implement**

Replace the whole of `apps/desktop/assets/url-window.html` with:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src data:" />
  <title>POS address</title>
  <!-- Native apps 2.0 (spec §9): the Android start screen (apps/mobile/src/screens/UrlScreen.tsx), its colours and words. -->
  <style>
    * {
      box-sizing: border-box;
    }
    html,
    body {
      height: 100%;
    }
    body {
      margin: 0;
      padding: 16px;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: #f5f7fb;
      color: #0f172a;
      user-select: none;
    }
    .card {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 22px 26px 16px;
      background: #ffffff;
      border: 1px solid #e1e7f0;
      border-radius: 20px;
    }
    .logo {
      display: block;
      width: 64px;
      height: 64px;
      margin: 2px auto 16px;
      border-radius: 16px;
    }
    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 32px;
      font-weight: 600;
      text-align: center;
    }
    .subtitle {
      margin: 6px 0 20px;
      font-size: 14px;
      line-height: 20px;
      color: #526179;
      text-align: center;
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 500;
      color: #526179;
    }
    .field {
      display: flex;
      align-items: center;
      min-height: 52px;
      padding-left: 12px;
      background: #ffffff;
      border: 1.5px solid #e1e7f0;
      border-radius: 14px;
    }
    .field:focus-within {
      border-color: #2f6fed;
    }
    .field.error {
      border-color: #b91c1c;
    }
    .badge {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      margin-right: 10px;
      border-radius: 15px;
      background: #eaf1ff;
      color: #2f6fed;
    }
    .field.error .badge {
      background: #fdecec;
      color: #b91c1c;
    }
    input {
      flex: 1;
      min-width: 0;
      height: 48px;
      padding: 0 4px;
      border: 0;
      outline: none;
      background: transparent;
      font: inherit;
      font-size: 15px;
      color: #0f172a;
      user-select: text;
    }
    input::placeholder {
      color: #526179;
    }
    .clear {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 48px;
      padding: 0;
      border: 0;
      background: transparent;
      color: #526179;
      cursor: pointer;
    }
    .clear[hidden] {
      display: none;
    }
    .field.error .clear {
      color: #b91c1c;
    }
    .hint {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 80px;
      margin-top: 12px;
      padding: 12px 14px;
      border-radius: 14px;
      background: #eaf1ff;
    }
    .hint.error {
      background: #fdecec;
    }
    .hint-badge {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 13px;
      background: #2f6fed;
      color: #ffffff;
    }
    .hint.error .hint-badge {
      background: #b91c1c;
    }
    .hint .icon-error,
    .hint.error .icon-info {
      display: none;
    }
    .hint.error .icon-error {
      display: block;
    }
    .hint-title {
      margin: 0 0 2px;
      font-size: 14px;
      font-weight: 600;
    }
    .hint-body {
      margin: 0;
      font-size: 13px;
      line-height: 19px;
      color: #526179;
    }
    .hint.error .hint-title,
    .hint.error .hint-body {
      color: #b91c1c;
    }
    .open {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      min-height: 52px;
      margin-top: 20px;
      border: 0;
      border-radius: 28px;
      background: #2f6fed;
      color: #ffffff;
      font: inherit;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
    }
    .open:hover {
      background: #1e56c9;
    }
    .open:disabled {
      background: #c9d2df;
      cursor: default;
    }
    .open:disabled .arrow {
      display: none;
    }
    .cancel {
      display: block;
      width: 100%;
      min-height: 40px;
      margin-top: 6px;
      border: 0;
      border-radius: 20px;
      background: transparent;
      color: #2f6fed;
      font: inherit;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
    }
    .cancel[hidden] {
      display: none;
    }
    .footer {
      margin-top: auto;
      padding-top: 10px;
      font-size: 12px;
      line-height: 18px;
      color: #526179;
      text-align: center;
    }
    .footer p {
      margin: 0;
    }
  </style>
</head>
<body>
  <main class="card">
    <img class="logo" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAQAElEQVR4nGx8CZxcZZXvObduL9XpLaSTQAjZ2XQQnSGEJTiiiCKKYVMHZBsccBwFnyjqCO+NP0UZg8vA88kyCD4iArK4jUxEJIIg4gIqEwmQBZIQCEm6k04vVV33nvnu/c52i2lCd9Vdvu985/zP/yzfrUqfSqcjAIH8UPxFCFj+5mNY/lecCAcR9crwE94RFW/Ko8Vl5fVuTDdy+w9PQFCOSeWLYuLqbX72eDTh6/UiFrU6NMmrKBUR+VnjnDJCXIIeimtGTFk2kqXaQlgt5Y2iNn5BxCLzG4paAlMcgf3moVRwUajpIo4VX5kWbIXUpgG+Jpqw/M+dJdMBX0BxJERWctQ2mX6xoie0IwRpNEMchmFAPHe8pISSiMKnTRvhMCHxtLYokmlR5FVdoepOBy1eCohUeaAndeHFtAigS5CZiG1phhC98wsSC1aUWN7Gc6LYTYYtFZIjpTq+w6/atYRKdTnkdc2ml2V43yjRIfopxMhFA3FsFO2bOsnWVRUjos7dbIsE00pUnnNOLLFCHtKm0DglyjKocgGUqCtvTgE8oRCjhzWiNnCQcQKAehtfg2wnb7o4HakmqmaU+RBFLGCYloCJx9EQWS7YeyxW6C6ShL03b3VXof6yW8wo4pDs1Cn/LdGLylvE7BMdqFw7r1p1wAOTzkwRNMqnFRJ3IrAlVEfsO7wOVRgKOyoQiVDoEsnWSWRvSGYERVa5QKFg54JtehWNqpgRepiW0yZ5SURRm6oFRT94FzfPxZI5zO9EUmFgfqHXm4sRVAOhrEtuiGZEdShkyMerUOKG4163bLE3uNgicBcTsfwaLgja4I1iwVRAHJlWPdwcygwIoPYs0RZ+CUGrGoHsFlmKxA6ZFLz5Hd5lElTvwwrdOL04n0G7XqNTJeS1MwN4zaE5LvrbSAyTqB5ikFI7GRXxQUSmPRGWyMDUNix410djMaVs9HPGoYic4hBeQ3l2Aan9CDzZVSTBSpLzGu2QjRoVSlVy1JsT4gn54ooQCldHiYp6Z9U2HRkqCBmW5FVDXpMAhAQVClchkDUhHohmPAnJqELIfSwoaa7lBfRYtxfiBiQ2JDmHkPB9wq8GFw5zYjkFgCyF0yIEhVdVAIoCo2EM/dL56ghRPUSqgAhWVAcAVTUPFyO/CMUBBh1WIsMb79hI7hpTm6wCJf7EpSfRhyTURdqNZ7EdmgotktWDe2/pmqxR3btQP4qKWWbzCTGfJec8PZmOwdJL8LOLoYnIHTTlS1bAYnozgOQEMqHZsOJibBkyt4rmV5io1Mz8CrKoYyDHigjmoYVwkcrLRRI4r3JZlUjt8EdtljEuZn16RRpqSIVkN49OrmSEym/suhTdtrwCDcheBoTUMT8It3lPVZvIGgir3OALWq0XxDW06tVRKqTOApflnBCBxRXVj3i2GZbAmYLnRT2mxuPMTDkPFWVqKNG+D5i2bKLEic7jEVVsJ/YkUKBU3hvJEGOPuOgl1TsrGCWc6v2RJ1BSDYOrzUQVbYIsnTM5ZJc1emWfd+wOAnq2H8og5kqmeFNzmXxhUv5GCeIspfMGl9GRjVxlHHIxGc0urBR9JwE18kJZAnOiEBWJFbIng4NRddQF34EyMwIriggrRlWziaHKd6ROyGfRWcX7a3FTKi6jRZG7ACtFkLMG8USkFKLRQl1KBbIqXfoNpvM4McZMWcixjTl1beI8/D+BriyCSRN1M6r4vDviLVmhl8qPqixh1cu0xD8sPFjRZIFDec6nwdV8n6lRwEZCEuj51e6jyklNNKK20PxCwCUuBOZYXBipm7vRfTIbkwPlVHKG13pQ2br4l5KkHDx6JYeVokL91iovKU1YeCIOGEga9k1E9hS3LkIwXXji85SsOrEA4RflXmii4tSP6geaV4DIr2yNzpWtFlLHCAiy1zHesd2IA7g4GYkxxYWZ1AVL2tMj/cVj8Xq5nYSV9aPKbdh35ldQ6ZRUoWzJN9px4kAR1+KFUM0R+4WC9TUAL5aUCsFVHRE9FYFEK1dD2EQEIM0xtb9E1+IKtBV78cDMZrPIPUymws2seiSN/TGyWywAwwj4nrhojhWiTORyTw6tYG14QykVHMTAcW4n/8BIzfRFSrJk5iT1LHEZNEe38WQ5CEbcgkawtFaQgZZf6kqMiKEtJaDKNIQ6Srk4zuLNBQjQHED1pCBTgVKr6ZSYeYExg0cDk1Rs5FCCYvmIVTWRNbfEjWQBROZZEWJ8h7EVylSCbeYvqVc8IaqLq2rMuGIDVrpIg3rGFqEaElFZEEh1QUq4cW3qLA6TNj8J1xBi5a84VVwKAnM3ua6hmdQJC6AhjAUkc1PRgGMBYyxS26JjYon84DyYT8VxHXErI8h0MbePy0xEgYYhhYE5vLGuvVFfk0VH7fIE4o6S3YmWyUyq9EucFSjZ8MqtzFQHlHQcnd+Su089ECSvqG6NWFKE1crYtsWcKxXHUi5QDPQMH6zsIiBwTENVGHrjs+wY9i6IQURgfOmIkkD7zrFDTlApqkVksolAPUvYms2lyOU0iB04SYr3vCj0EgLTMViGCwqEUirn+vFPYjEFvVV5emkiVNJFlz+LtcOtQTVTU5DWsKJW0LFA6djGjYxAvtENpGo1FiXrIOqpeCkCVRJQTFMIYuR50Q8mczpQenGhz5xE60TlSdFHwoklSqko70C8xdILkLxDTCxVZpAlw2k96cwZWWNXcTBJbHqXM1bpEwQfSBW0R+8gX8WZC4NZDt3WW0GhtSIiZ42d6eyZybRpQUeGbDBFq6qM3SL0kPdgeUWScScGEWJCkD8OaubtYAfYXUs5s6zW37fk0QeG/uEf86nRbGq8sKTl4AjK4mA1B1oO/dq/KJxDMgYJgsBQKMkGph15cyyf2jv7on9a8sjPkr4+ylveJJpOMPLictS5SEjFqiwePeG7OFpFAUUmsztK1UxmfF1s1FazWZs1a96N/3fJT35UP/SQqcaOYo5azcAtuFVsKgegJrOooktZohHJBbyK5Wq18KrVeLXn9a9b/NMfz73hutrsmdRsVoOis7KRYtVl0JORBhZMUAVlHEtg97AXWkLrm6N3mKgrajayLOs7+Z0H/eaROZd/DjDLmnuwluqAvBepbk4CRHNc1hyvwe18k0uUSaNEmoYpAFtzPn3FgY8/3HfSiUEAmmxoFhVzFvFQKVMRFAcGLxVI/zBJS/3OcYWnRqMOYkwyvwKbVIWWvbecWllgnyzIN61nzr9+8aBHHuw7dnnW3BHoIKnVmFvARxjdanS4VSw52R11MWEFFw5+nTV2hCmW/OrB/a7+AvTUw9RBAArsQ7lahSxdEB9x7krQxkqCoujVJQcxS7hLSDHE5UPMKHgN5mW8zHJBreBPgwMRq0HEVqPRc9TSJb98YN41/1brq2fNEail/uYIQQaVaEF6I9HU5KzDMOe8s1bLGsNpX/2Aa76+eM0DPcuWhukosjJiOn2QjAscc1m4I6EM9XVeu/ogB5lA/Rdjt4RUEPiAX4VxgyVRoMGN84xaAs2JWk992jFHJR0dId6HNVCrFa7qXX70wKmnTG3aPPHMU5AnSWdn0J/JI6BHZyZhZgQTnR0/CcCZalC2Z/q7Vyz4/u0D7zk5Dz+tVsFEIVB0dWGeb1/5jdGfrcZyV12SUGMGAlsOyRGnLIvUERm1i5NujjFcTZHTaeVHtI1SgNhYxfschh/4j7E1j/Yc9ldd8w5gIIT0aGoq3Xf29LPe3zV/0fgTT0yNbEvSaWV6kVuRTJpsaI1pAODZkyKK581d3XP2n3vttXO+clUyFLKKBqeFSZJ2dEw88bsXzj5/xy03IXUjV3QsX6SitoTDF3Ic38yZeZ21D9fq3G0ym5KZ1uEO4z6OMhgIf8SMpaMjoY6JTWtHvnsPTTV7jzk66erKI5QCceZ579+8afAD78t37B7/w28pz7CzXuiIVUOKTqyEHA4eZRQfp3xy6LwL5t+5qve4Y1vNZuFTQTslcGhy8pXPf2nzxR8bW/9faW2w1tmRZ5lmaTqyIQj8wxBYAYEEj3hfEg9YalJBjHS5NHEiUGoWHJaXZVnnQN+Cu27tO+r41vjOrZ+/8vk3nzD28KNpV1exhiKtxUAT6f77zf/OTYt/cE/3QQdmjVd9fW5ZkGx6ROYvC10KUbz7oCWLfnjfvFtvqs3ZrxWBU3J/mGLvgw89t/xtW6/6l9bErsGjj19w72040A9ZS5dLMrJ4By/DIoGtFyV14Uhf+zB2czWr6ZNFeq8tX8hpVSCKykP7P93/upWzLroggY7J3/15/IVndn/37mz37t6jltWm9eRTrVJTgS+y+usPnXHu2dCg0d//PjFma9vVQKUmrMHsSy+Zv+rW+uGHZY1mDAtB/KCabGTkpU9/bsuln5p8aUNX38z9rrhi3revTw+Yu33lv0EZ0Rjq5SM+gk7DghIUWk5LlTWH+56sTTdHtEzJY6kKeU4wKnVACPC1wf6D//hYx7wDgiBjv39y6yc/s2fNA+Gqnte9ae5Xruo/+aQsvAmWLz0uBOlarbbjtts3nXtB2tGHJW0rMQt6QlxM8+ae+bfcPOP8DxYJTmD9koyD84ZZdv/gR1s/c+X4uj+FhQy+/V1zVn6pfvgbwkDNzZufe8Mx2cjuYDNubbDVyXErVXhWnCOqHkAILBarmihoWlxt/qJiPhaY5E6gBqFikcVIrYnJnr9504EP3j/vq9/omj5nbO2T6999xosf+sf85VeCzQNxRO/IpqYG33d6feHBNDVBPF8SyCufmuRgHzKa5kR93uKB95+elfUnlHwcBmltfemF8z60/tQPBO10DR0w/7r/t+hnP+k6/A1has4a8hwsqnCIrgZ+7wNkm1YELlUuSw1BGKrXxbwe24bTaKnJlg9hUNaGoUQMdydJ3mwGZ5r1iUuWPPqLoXeflkHjlZuvf/aovx2+/c60sxNDHhCq7TwPSx18/4oWjEOQIg1pwfD0vzszEHkrG6GkVowDY33vPTmt1ykrrq91dIRQtes7q8JQr/7/mwGmhla878BfPzT00Q8HDVJzqsg2QubS1wc+FWT7o+USVduj4ZY5g90iGo0DkcMZKA8rKaBRsxGfeHNxMCSBk2N7fvzTJPx0dcahA5V2HXrwgh/fs/CGG7tnzx9/Yd2ms8/dcOZZU+s3FOQdYnaWDX7gzKTWR63ATU2sD8751y/sv/KL0D1IWQODUqA+8HdnUBmPwi2NZ9atf++Zm87/+8ktz9f3X7zwllvm33dn55LFYaKyLMlDkhXm3333ffnEaFEtgxoXnAZ0pbr1BBKkFFORtpDzIE0UNXny8a4MieQzBSJXpIrCw7GR++5pPPNsz9IjOmfMiFG2gHqeTzvyiMHTV2SbX5n4y9qxtX8cuf1eqHf3Hb2sSF5mzBh/6JHJTc8jTe13zcqBE9+a9veng4N7fvqjcG/fXx8x+4rLA+LCbNu/du0L5180+scnQhAYOvuc+Xfc1vvmipwY/gAAEABJREFU5XlzqvDZUrCAzeb6jVs+9OFXVq6EpMvyBtRSQ73C91ciP/BqoAoULEoNQqzux3n1QFkvxr6f7nvHG8xTBY1pZ9+OO7+7bumxO2+8ObhDSKlLxysCfMfCBQvv+d78W2+pz108sWPLlksuef6Ek8ae+F3SkfafdEIGk+ncRb1vPGz45w/tfnDNtMMPS+cdlMPEwLtPDDnO2GOPP/eWEzd/6rLG8LbehYcsuGPV/FW31ObuXwAn+GYI9p0dYbod37zh2SOX77zv7qRzANXSqJUTWkRHXjybX1AWz5FlMKUmn6wNotWo/wM3u4TTdhHkCnIt85K50loeyiLYO/COk+dcc3X9r17fylrBWaISg5EbW1966fLP7bx9VQatrvrM/tNP2fPzX9KOV6nWETokPbMWhsHGtm/s7hrCkMjMnjXwt8t33/3DZnNnDbpmnn/evl/+Que+s7Jmk4WtFT/jT/1p22Wf3v2L1Qn2YWdnLHFk50CFJXLJp/shDxmoxOzyRakg2xqQMY2Uoqa5iVeeirpEnwfp5nvZEw6+02oOJz0Dc6787KzLPg4daSYBvqAJxJGfrt760f81senFnCYT7CWa7IBkn4svnHPV50PndtuVn991/c0tyGpJPc/3QtLdvWD+vOuv7X/7W7PA7iE7L0v2IoFuNLZ/5WuvfHllNjFa6xqMHu3yHSYBe4AVnaJeox3pe6MCJNyYAPqteeLUWdiXUx5NOwFInswk+RCLicNRMMTwVq1zOkxmWz77qWePe9vYo78uWLkMMTGDoJGR4CBBWWlHP9Lu3iOXLl6zet711+GMfWpDM+Z/69pFD/1n37JlkO9OOvqL6rc52dq1q5iliPRFryMMOLbm4eePOX7r//5nalKtc7AATm6PGvGyOY67FbE9ybsSM1FsWoC6V/FfmUmD17Cpz70G56rAzu00Y300TlKLmBIWk6S9jRfXj3zn9mx0dNqyI9Pe3smn/2vTuRduW/kl2JtlrdG0r3/uVVfNv+GbnYsWBpQV9s+yUJ3XlywaOv+cWv8+Y48/no8N56NTu+5eNfHbp6a96Y2d++2b7RouEuiPfryx7aVa1z6F95ZkV7q8rQLbnAekShAP0DAf0QJW5OuaEP9QG0ysTUO2bKy4oxK/CwoAnvQcXP374Fl5WHI23HfYUb0nvGXnjbdMjQ0jdAFM7HP6Gft9+YvdBy4OqgqRPtwSUoTwO7BYcX+os9K08fyGoIud996TQD3Qdkff0NDfn7N39c/3PvOHWrpPQdJZJoSrQrItNdlDrHKMlPga5thH2AMRnEOWHOSrM4OPsjxA1Q6qOsZd+/wS7ECjRNHiCk31EK1q0Ecw1rX44LlXf3HwjFOL7Lsg9XBBEvQxuX5jGLO+eFFW+EteJLKhxQMwctc9Wz5zRXPjcwjTchgNykq6egrVkLe2wcRxkHY4OMvx+hLhGTzWw5dN93BByIPqaO6DAkusYMYBr8J/bhZ0uBZ3BgDdhs5Dqpd29iRdtZn/9JGFt3+n/tdvDAk3FfaHQLfhip3fvH792RcO//utSb2758gjCuop+yThd88bDptxztk0OTX59NNJrQeTGgNHqwDwIQOk3hYgaGlVaoJTwFJMIrMxIlRXF/tBRcNMVsNawbgd54oJ3ew1oyTA2aXDn6pPHsvi56+KX6E10WrsHLrwHw647quheRRaRcWJrq7gR+OP/XrT2Rdsv/F6mhjLJsZG7r9/8hcPdx9ycPfCBVB2Jotkuqc++K53Tq7ftPe3v6qlPVHSckWc6dkjOI4pXXA1oKHzhagHBZ0r7Ll+S3jJDEAUAi+1ggYT2RKLZ1ikttlQkinxPlJcS2Ak6O6iuPEQGDzE6Z27Nl9y2bPHnzT66JrQau8/+s09y5aHQLXnV7985viTtl76yXznzthUCrcUaio8Lgf3YxFWH4n2jxQyKMCdIHIbxjEeS/pCvhqJgyRcdLFOFDXImw48pOobeJdRlSliovxytO1iQkwAwgxlQycJ27Ch7PzuHc8ceezL1319qjnaNbT/gq9+bfHDqw9+ZPX8ldekQ3OwOfrKtV9fu/S44e/dVeTl0wrUhPoNNKS4LobogJkPeKnkqElCOImhXW1KxL0y0Mpe0uoEUS0c3SQqDLR/xUd47ah+Zysn04MpTM9Vqv6iiRGymMaf/rzhlNM3fvC88Q3ralCf/cHzDnri4VmfuDQCceiTHz/4Nw8PnXM+Yb21cd2ms87bcMoZjT8/HW4MPUTpX/P4Cm3STido3NbXzpjoPE2MGRMgZD/Qh8GKc9y0F8VX3VOgk8idbvESI6Atp9YR5BODciT09EKN3vO6wybWb9h0zgVjTz8Zbuk7fOm8b39r9qcvS6YPFnlQKVjIM9OZQ2EvpHfZ0ubaZydf3tx4du3O2+6sddebm7dM/vGpJK2DffDaxROw+VAWrpmR0K8YjZUFElXkwTjhVkZj7CjmLvK73yDg1SjI9tJ8VZMHJ4Foi8A9fIJxlhDLpxp7c5jsHJi972WXzrzs42GzqFXsFBcX1jqLPKgotcqbwttsYnLH1699eeU3GiPbatCddvVqqWXPbrABhG982K4Yj9HtLSz3VqKLewgGikSRA5U9dwLQ5jEAaFQPknlLjiHUqNcaPYAqTra6Wo0EWr2nrphz1b+ELfxYWxUgLbuoe+5fHaqJ/ne+PZd0MTZnJ/6ybtvn/s/IffcBdARuL3bWNG02gXU6ahecsAJ8oXZRkp1F1x+PsEuELjyCpLsq7Ie266DXuD1SMO9FTdlc8QHG4FPp3DkL7r5j8b13dB96SLEdWu4LFV3UzVtfuPDi59912nMnrXjhoo+0Xno5HAz5TohcsfG26N47Ft71vdr++xIVxSoSeXKTWE7VnS+MD9NJ+OL4YqvipdtjHpGtwUgNE0c7Yn+qULSSs3qyC2DuCgmGVgQSUyiDvajmx/qPO27g9BWtycnoRyFFDPnRq9+6Yd2y5du/fXMGUwRT22+6MXR2dtz0bexIo9OFlLI12Zh+5mn9xy7Ps71F1DcqJWuqmuNooIvPKnJqp2FVS3aGt1EwtfWPEpeNVmIAK0r1QqDw8blCpH8U9vdEJum1CBRnnmqWZXceEuWAkfHHn3j+re/Y9JGPTW7bWoN05gfPm3H2uQnUJre+uOGiize87aSJ3/0hXBZ7b0XGWKgVHQ5AnkTg6rwt+0DjVpdNezQwayop68VRb8UWsCQMVs9o/9XrmWRKO8g4i1oQZIr7kkNxHLQcpVYraKWnJx/ZHbaG1r3lHcNr1oTcr+fgQxffd9eC225asOrfF3//ju7FB9VCU+QXD/7luBNeuvyfafeewOXhxqIfBgIWyQt1MY6KDU2SLHLCQ7Yiz1Z6q7id6Kr8UK+gFRkUpNYxTWtoQ3VvdIMh2V0KUc+WMWGtZdt35OPjw9/7/rojjtn21WuoMdbZNW3fT15+yG8e6V9xSghnwfUGzjg1vJ31sUsxrePk2LaVX1l7xDEjd92bjY21XtkeBiketRGuBHkWR20Alr4BMw9HPHUMl86SQoeq62XK4pYrVMibqkC1JJLPo/GSbm+4GfWZ/vb5YtnTuXDe2PrnyrOtvuXHzb3m6p5lSzmchX3B8BNKis7OGuLYr3695VOf3fP4Y0n5FRr1RYubG18sdsfAPjBAoJAlq6rsKLTFFqjWBVSNYnpE3SmGebQnssTg4FrQwk+S/RA4hWq8t2lUa/KL/GMTxZZO8eRCY87VX5r9iY9xRA+uF2NOtEjZPK2VG407vnbtls9eiUlX6CsWMR5yl4ABy0VGTaiwdtNDxVpEQg2CM58XO1jIh1mqKQXwqvnRQHsOXfQtIkjSoJLEYNs+FumnDOKlHd3FsVY2+fTaUNMXx5KEA3JMRIoiusjei4dDQmPtT2uLZnaItx1dIqgZEartGJFNlQcOHVBBCpFr0UQ9o10iS0xNeU6JOpmvsfxHGcDHK3F+TRxFL1XT6qc3ii8KoSTt2X7L9dmuXQu/vyoUaHnckuaN8eJxkaR44rm18Yyzhn9yT9oxA7IcnPP4ZZN8KYUl0+pN9uxPJcbpnocvlNwTkTwyouysxjxBaIbncTyETHSI5MpDdSmNcK6WjVZFyRkAwT12G/7Ps46umbt+eNfG088KikjKPY+YaUbtUKO54dT3B+10dM8s99e0hCIXLlgX8fMhktyKy7D6oqxoimPuQF4XaIZLwrWg+zcJBx0P3agwlK4Zr10FQ0VxnBLJcktyIQItmsRBYgeKK6Ri5NZUGnT047s3rngfTUxibCEG7YQX4xMb33vmyP0/CBcUrTURnkc1zQBYCCKLpCwFWayVU2W0lhfA12iqCbw+6xBKooj6GJzDMPoZtU8pw5JKwTJL8LOLoP2HEzBVGbWmAo6GV/9o43tOg9G9Sbkfm+8Z3XjyaXse+Ek4VdQi7iMUKI0bT2riDYpWf0L/KXQrXIyuF+hCDYHoEZ+Kzwc5m7iyq539IcoqbUZs0wF7PWi/UkMgohfLmJLnTDtajVcHjn3rov/8YRhg44nvGX384VrXEJUU7qnUdi7LQ9UmRFwuCjr4OGrj11GYz0JQ0S/9WTCKLRWkqybRAZij24rI58XuwUuneCTP72j80JZY6S8C+UqstCNr7BhY/vbA1qOPPZgG7bSmlEvgNcNWwWkju86CSYXGf+gpyr+WJYILAmW19GT5PYpRfeBjkpuehJSiyYkqVrVJK3mXVyZUYyeAq2sUs0nxPNlYEeA6eyHslJko6BQhgwvhobGvn08VpgvwQllbQ0XXOxy4ir9pbPyR9tAUOVVPZRq0qh7bpwcJ6+hSzKhaLdScasiTVXlDaCRi2BcKb7IWGMuIBwC6B3riBKiZIYm7yohCiaoG8Eoj8kyLbAiKxS2BS6SL7+4QrJN4CWj7QNlQ9mF5AjYagZE/CEFIc0YxahYhp250xjByzUMUy9EzBg/sEBelFJJ01TP6v2SwkEe/Ge5xoeicyu8s6BQxAmIicvg+CGez5NoXJDZD56Yut5d9Xom3IEEOyRRjeYyC0Iku8kp3SwTloMU7XxpjpM9FLnMxK4pdXK4BYHEhjkfKhDILCRGr4JJJM161JkNX9SoerXdpzR9XxQpDmGlkyd4ygJVve4PKB6tNaY7TSCxlBRCv0NQcjRozAs2rYwxwrCscywdcpStyCA3wcPF7FCVXQqX/Yg25nEB9GEmkr6YCSGCpuxjJslzS7rrWHeRMitUMwGmKPF1UNpNNixxEJURxv4CEt7FSqJLKSs4c2l/XAhjNyKWLAVY5TAwovEOW8LSHV1mjuIQVb8Qf1pDkIJaxWL0t4o68+BTTfrDYK+xH4LI1cD0c0omj30VzSN9DkW6yCVEimdmlGlBelXUl6AhAWNVXDOZjpJmQ5RTAzEXR1Uh8WWmZyUz2NHg3HySRB9DFRj3Ej4MwjYu9UGspFAfBKipi1wE4h+WUX6Q0eoxVkat4CCrlIwouSTNbZCwAAARhSURBVMGQlKIoK8qDY5rYqBz2na3EyGYWQGYxtaiQHkkfl1yHSJ0hqk3JXiWSzF+TB5FcmoISvc0veXImyLaCleQ8x2TUMEaqXJtH59PBU7CS3zJBNHQovthy5PhIO5zyNQkiosLC/hrNyYVKT2Jnh0v7iljUDUDQooz4+R1QI2ru6sSKQUWdyGuBWQ3UrL6uluw+nou7yqB5IuMB3TjieqQcTpY16VR6h7oQw1mlldCiBE5gPXQuecEevOD1ywMZoJoESeWQjGlRkYRKI8JGSknyFW2oU4oNzM850CvPpazpiCv3NBFUai+yZhJzorqg+o2EGXEHV1UTVD0z0rFzSgO1thVYTRpYyNIca7QYdZswolnxavM1/lYImdHxWDQFGMCEqyhxKo2CKyOqZah6KypfOm4DA6p9Y5D6jLGyJJTofddJh0yBpdWF72NU47xeMvNqAQNtjMV3oHMiAEvegOdkjwClSMEcawyLPKh0M/eUlXvmkcjsYGxJlZIHtNFucjhGk3USuL1826lh+X2uaPCOfiqZIbF5yKpTsSGpM0pbXE0rX4+GplMt5VF1BTY7SgxLyjlTa7QrLZLoxkCiHEwxi7SrAJ0mTLXeKUtsC8uCtb+gyuMKU82CCKwdwtmYmhyrENZygz+EYhkvW98Vuo6G+L1ZVugHY6QoHsFTdxGUCaO56U3xlWH8OUIXG8nJjApAhbTXR5WB7IeE+lUcUv4go2QpyFACogAZbQkoFRIJhKvakdFBEh7HlVqsVmnFQZeHknAW16QBG8HokfGhPS2Ju5Y3imvIklRfkTGqynPJjnkkpy9k4zDtMc9p1ufNLnmP2N+MIMRoOhOUcGZLMYqxvQz5lsGDJCLmqCKVaIYMaagpviQWRNI3KI7logBSf2PCUpuo3tXI1bkJfZtEDIbVF95yjAsZG+0KXoRAEM0WMRKXtyVCLiBoVBG9EtRibEjvJKiMrhTr6h4ucshnnVIIGDlyKu2m1EJHZQPFBHp0kD5aIEIwxkjDk8gvMQJQilwzpa1OapbotIl3JAD9MIiAVqe1qeJruwldOQeujGe6IpIlKUIpTkR+DBlW/U6NwpWe8afNRsJxPo0GHZm8R3ElqJ6LQnDENYd9yweZAYqdVXD4lCRVyAHsqwurPuZ6t6osqXPV9chpTBqx8BpdOiC1XUfm4Kxf9DW5uSSrWD3JAQ5FMJCBq9Y021vtYiRKZR4U14uaSTPSOTP2c+hSjdj5wuglJCtBHUWTsUjFkpho9i6TKPTEslz/QBtrkCydnNeY+gA0ehqWuckgHxvjXSiNDfIgufBB3IVhdaVShyk8Lbo4K6lePXUw07qvCotfiYbWaXBixTuQV2As4OEiSyfXhPNz+mvMXEpdehTRFCXANDOjHBHzOxMY6/GoqVxuIgCaeYm0oajDiTLQ7KoepQ1dk1jivzM+eIGEzEGEk+VaHATpKKKFW6yIwVtfzmeVtaHqflVl2gJFPbwYwQz9NwAAAP//w9s+ewAAAAZJREFUAwDcX1VoOaVEuQAAAABJRU5ErkJggg==" alt="" />
    <h1>Connect to your workspace</h1>
    <p class="subtitle">Your cafe, orders and printers. All in one place.</p>
    <form id="address-form" novalidate>
      <label for="address">POS address</label>
      <div class="field" id="field">
        <span class="badge" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z" /></svg>
        </span>
        <input id="address" type="text" placeholder="yourcafe or yourcafe.sandbee.in" autocomplete="off" spellcheck="false" maxlength="2048" autofocus />
        <button id="clear" class="clear" type="button" aria-label="Clear POS address" hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" /></svg>
        </button>
      </div>
      <div class="hint" id="hint" role="status" aria-live="polite">
        <span class="hint-badge" aria-hidden="true">
          <svg class="icon-info" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" /></svg>
          <svg class="icon-error" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>
        </span>
        <div>
          <p class="hint-title" id="hint-title">Your workspace</p>
          <p class="hint-body" id="error">Type your workspace name, or the full address shared by your administrator. We’ll remember it for next time.</p>
        </div>
      </div>
      <button id="save" class="open" type="submit">
        <span id="save-label">Open POS</span>
        <svg class="arrow" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" /></svg>
      </button>
      <button id="cancel" class="cancel" type="button" hidden>Cancel</button>
    </form>
    <footer class="footer">
      <p>Windows printers · USB · Wi-Fi / LAN</p>
      <p id="product">POS Software by sandbee</p>
    </footer>
  </main>
  <script src="url-window.js"></script>
</body>
</html>
```

Replace the whole of `apps/desktop/assets/url-window.js` with:

```js
// Plain browser script for the POS address window (no bundler, no framework): the Android start screen's look and words
// (native apps 2.0, spec §9). Talks only to window.posDesktopSetup, exposed by url-preload.ts. The main process reads the
// address by the Android app's rules, checks it once and saves it, and answers with the words to show.
/* global posDesktopSetup */
(function () {
  "use strict";

  var HELP_TITLE = "Your workspace";
  var HELP_BODY =
    "Type your workspace name, or the full address shared by your administrator. We’ll remember it for next time.";
  var ERROR_TITLE = "Check the address";
  var SAVE_FAILED = "The address could not be saved. Close the app and try again.";

  var form = document.getElementById("address-form");
  var field = document.getElementById("field");
  var addressInput = document.getElementById("address");
  var clearButton = document.getElementById("clear");
  var hint = document.getElementById("hint");
  var hintTitle = document.getElementById("hint-title");
  var hintBody = document.getElementById("error");
  var saveButton = document.getElementById("save");
  var saveLabel = document.getElementById("save-label");
  var cancelButton = document.getElementById("cancel");
  var product = document.getElementById("product");
  var busy = false;

  if (posDesktopSetup.version) {
    product.textContent = "POS Software by sandbee · " + posDesktopSetup.version;
  }

  function showError(message) {
    var hasError = Boolean(message);
    field.classList.toggle("error", hasError);
    hint.classList.toggle("error", hasError);
    hintTitle.textContent = hasError ? ERROR_TITLE : HELP_TITLE;
    hintBody.textContent = hasError ? message : HELP_BODY;
  }

  function updateClear() {
    clearButton.hidden = busy || addressInput.value.length === 0;
  }

  // While the address is checked (at most 5 seconds) the form waits: "Connecting…".
  function setBusy(on) {
    busy = on;
    addressInput.readOnly = on;
    saveButton.disabled = on;
    saveLabel.textContent = on ? "Connecting…" : "Open POS";
    updateClear();
  }

  // A saved address means "Change POS address…": the window may be cancelled (the main process checks it too).
  posDesktopSetup.current().then(function (origin) {
    if (origin) {
      addressInput.value = origin;
      cancelButton.hidden = false;
    }
    updateClear();
  });

  addressInput.addEventListener("input", function () {
    showError("");
    updateClear();
  });

  clearButton.addEventListener("click", function () {
    addressInput.value = "";
    showError("");
    updateClear();
    addressInput.focus();
  });

  // Submit = Open POS OR Enter in the field.
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy) {
      return;
    }
    showError("");
    setBusy(true);
    posDesktopSetup.save(addressInput.value).then(
      function (result) {
        setBusy(false);
        if (!result.ok) {
          showError(result.error);
          addressInput.focus();
        }
      },
      function () {
        setBusy(false);
        showError(SAVE_FAILED);
      },
    );
  });

  cancelButton.addEventListener("click", function () {
    if (!cancelButton.hidden && !busy) {
      posDesktopSetup.cancel();
    }
  });

  // Esc cancels, only when Cancel is shown.
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !cancelButton.hidden && !busy) {
      posDesktopSetup.cancel();
    }
  });
})();
```

In `apps/desktop/src/main.ts`, find:

```ts
      allowCancel: () => urlWindowAllowsCancel,
      closeUrlWindow,
    });

```

Replace it with:

```ts
      allowCancel: () => urlWindowAllowsCancel,
      closeUrlWindow,
      log,
    });

```

In `apps/desktop/src/url-preload.ts`, find:

```ts
const URL_SAVE_CHANNEL = "pos-desktop:url-save";
const URL_CANCEL_CHANNEL = "pos-desktop:url-cancel";

contextBridge.exposeInMainWorld("posDesktopSetup", {
  current: (): Promise<string | null> => electron.ipcRenderer.invoke(URL_CURRENT_CHANNEL),
  save: (input: string): Promise<{ ok: true } | { ok: false; error: string }> =>
```

Replace it with:

```ts
const URL_SAVE_CHANNEL = "pos-desktop:url-save";
const URL_CANCEL_CHANNEL = "pos-desktop:url-cancel";
// Native apps 2.0 (spec §9): the window's footer shows the app's version, passed as the main window's preload gets it.
const VERSION_ARG_PREFIX = "--pos-desktop-version=";

const versionArg = process.argv.find((arg: string) => arg.startsWith(VERSION_ARG_PREFIX));
const version = versionArg ? versionArg.slice(VERSION_ARG_PREFIX.length) : "";

contextBridge.exposeInMainWorld("posDesktopSetup", {
  version,
  current: (): Promise<string | null> => electron.ipcRenderer.invoke(URL_CURRENT_CHANNEL),
  save: (input: string): Promise<{ ok: true } | { ok: false; error: string }> =>
```

In `apps/desktop/src/url-window.ts`, find:

```ts
// channels; the address rules live in pos-url.ts (the Android app's).
import path from "node:path";
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  APP_ICON_FILE,
```

Replace it with:

```ts
// channels; the address rules live in pos-url.ts (the Android app's).
import path from "node:path";
import { app, BrowserWindow, ipcMain, net, type IpcMainInvokeEvent } from "electron";
import {
  APP_ICON_FILE,
```

In `apps/desktop/src/url-window.ts`, find:

```ts
  URL_CURRENT_CHANNEL,
  URL_SAVE_CHANNEL,
} from "./shared";
import { normalizePosUrl, URL_EMPTY_ERROR } from "./pos-url";
import type { Logger } from "./log";

export const URL_WINDOW_WIDTH = 520;
export const URL_WINDOW_HEIGHT = 360;

interface OpenUrlWindowDeps {
```

Replace it with:

```ts
  URL_CURRENT_CHANNEL,
  URL_SAVE_CHANNEL,
  VERSION_ARG_PREFIX,
} from "./shared";
import { normalizePosUrl, URL_EMPTY_ERROR } from "./pos-url";
import { checkPos } from "./pos-health";
import type { Logger } from "./log";

// Native apps 2.0 (spec §9): the Android start screen's size on a PC, of content (the menu bar comes on top).
export const URL_WINDOW_WIDTH = 480;
export const URL_WINDOW_HEIGHT = 640;

interface OpenUrlWindowDeps {
```

In `apps/desktop/src/url-window.ts`, find:

```ts
    width: URL_WINDOW_WIDTH,
    height: URL_WINDOW_HEIGHT,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "Server address",
    icon: path.join(__dirname, "../assets", APP_ICON_FILE),
    webPreferences: {
```

Replace it with:

```ts
    width: URL_WINDOW_WIDTH,
    height: URL_WINDOW_HEIGHT,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: "POS address",
    backgroundColor: "#f5f7fb",
    icon: path.join(__dirname, "../assets", APP_ICON_FILE),
    webPreferences: {
```

In `apps/desktop/src/url-window.ts`, find:

```ts
      nodeIntegration: false,
      devTools: false,
    },
  });
```

Replace it with:

```ts
      nodeIntegration: false,
      devTools: false,
      additionalArguments: [`${VERSION_ARG_PREFIX}${app.getVersion()}`],
    },
  });
```

In `apps/desktop/src/url-window.ts`, find:

```ts
  allowCancel(): boolean;
  closeUrlWindow(): void;
}

```

Replace it with:

```ts
  allowCancel(): boolean;
  closeUrlWindow(): void;
  log: Logger;
}

```

In `apps/desktop/src/url-window.ts`, find:

```ts
  });

  ipcMain.handle(URL_SAVE_CHANNEL, (_event: IpcMainInvokeEvent, input: unknown) => {
    if (typeof input !== "string") {
      return { ok: false, error: URL_EMPTY_ERROR };
    }
    const result = normalizePosUrl(input);
    if (result.ok) {
      deps.onSaved(result.origin);
      return { ok: true };
    }
    return { ok: false, error: result.error };
  });

```

Replace it with:

```ts
  });

  ipcMain.handle(URL_SAVE_CHANNEL, async (_event: IpcMainInvokeEvent, input: unknown) => {
    if (typeof input !== "string") {
      return { ok: false, error: URL_EMPTY_ERROR };
    }
    const result = normalizePosUrl(input);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    // Native apps 2.0 (spec §9): one GET <origin>/api/health before saving, through the system proxy (net.fetch); the
    // page itself makes no request.
    const check = await checkPos(result.origin, (url, init) => net.fetch(url, init));
    deps.log.info(`address check: ${check.ok ? "found" : "not saved"}`);
    if (!check.ok) return check;
    deps.onSaved(result.origin);
    return { ok: true };
  });

```

In `docs/GO-LIVE-CHECKLIST.md`, find:

```markdown
- [ ] Run it. Windows SmartScreen says the publisher is unknown: **More info →
      Run anyway**, once. Installs for this Windows user only, no admin rights.
- [ ] First run asks for the **Server address** — type the app's address (for
      example `https://your-pos.example.com`) and choose **Use this address**.
- [ ] Log in once as a real staff account. The sign-in lasts 30 days and renews
      with use, so the PC stays signed in.
```

Replace it with:

```markdown
- [ ] Run it. Windows SmartScreen says the publisher is unknown: **More info →
      Run anyway**, once. Installs for this Windows user only, no admin rights.
- [ ] First run asks for the **POS address** — type the cafe's workspace name
      (for example `yourcafe`) or the full address, and choose **Open POS**. The
      app checks the address once before saving it.
- [ ] Log in once as a real staff account. The sign-in lasts 30 days and renews
      with use, so the PC stays signed in.
```

- [ ] **Step 4: Run them and see them pass, with the suites**

```bash
cd /d/kd/lucifer/apps/desktop && timeout 250 npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)" && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "typecheck and lint clean"
cd ../cafe && timeout 300 node --import tsx --test lib/go-live-runbook.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"
```
Expected: desktop `# tests 202`, `# pass 202`, `# fail 0`, `typecheck and lint clean`; the runbook `# tests 97`,
`# pass 97`, `# fail 0`.

- [ ] **Step 5: A visual check** of the page in headless desktop Chrome with a stub `posDesktopSetup` (no request: a
`file://` page). Write `$SP/url-window-shots.cjs`:

```js
// Native apps 2.0 (Session N3 Task 33 / the N2 gate): the address window's page in headless desktop Chrome with a stub
// posDesktopSetup, screenshots at 480 x 640. Local only: a file:// page, no request. usage: node url-window-shots.cjs <html> <out dir>
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const pw = createRequire("C:/Users/Kartik.desai/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright-core/package.json")("playwright-core");

const [html, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const url = "file:///" + path.resolve(html).replace(/\\/g, "/");

// mode: "none" | "saved"; save: "error" | "hang"
function stub(mode, save) {
  return `window.posDesktopSetup = {
    version: "2.0.0",
    current: () => Promise.resolve(${mode === "saved" ? '"https://mycafe.sandbee.in"' : "null"}),
    save: (input) => { window.__saved = input; return ${save === "hang" ? "new Promise(() => {})" : 'Promise.resolve({ ok: false, error: "We couldn\'t find a POS at mycafe.sandbee.in. Check the name." })'}; },
    cancel: () => { window.__cancelled = true; return Promise.resolve(); },
  };`;
}

(async () => {
  const browser = await pw.chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const report = [];
  async function page(mode, save) {
    const context = await browser.newContext({ viewport: { width: 480, height: 640 }, deviceScaleFactor: 1 });
    await context.addInitScript(stub(mode, save));
    const p = await context.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await p.goto(url);
    await p.waitForTimeout(300);
    return { context, p, errors };
  }
  const shot = async (p, name) => { await p.screenshot({ path: path.join(out, name + ".png") }); report.push(name); };

  let { context, p, errors } = await page("none", "error");
  await shot(p, "1-empty");
  report.push("empty: cancel hidden=" + (await p.locator("#cancel").isHidden()) + " clear hidden=" + (await p.locator("#clear").isHidden()) + " footer=" + (await p.locator("#product").textContent()));
  await p.locator("#address").type("MyCafe ");
  await shot(p, "2-typing");
  report.push("typing: clear visible=" + (await p.locator("#clear").isVisible()));
  await p.keyboard.press("Enter");
  await p.waitForTimeout(200);
  await shot(p, "3-error");
  report.push("error: saved=" + JSON.stringify(await p.evaluate(() => window.__saved)) + " title=" + (await p.locator("#hint-title").textContent()) + " body=" + (await p.locator("#error").textContent()));
  await p.locator("#address").type("x");
  report.push("typing clears the error: title=" + (await p.locator("#hint-title").textContent()));
  await p.keyboard.press("Escape");
  report.push("first run: Esc does not cancel: " + !(await p.evaluate(() => window.__cancelled === true)));
  report.push("errors: " + JSON.stringify(errors));
  await context.close();

  ({ context, p, errors } = await page("none", "hang"));
  await p.locator("#address").type("mycafe");
  await p.locator("#save").click();
  await p.waitForTimeout(200);
  await shot(p, "4-connecting");
  report.push("connecting: label=" + (await p.locator("#save-label").textContent()) + " disabled=" + (await p.locator("#save").isDisabled()) + " readonly=" + (await p.locator("#address").getAttribute("readonly")));
  await context.close();

  ({ context, p, errors } = await page("saved", "error"));
  await shot(p, "5-change-address");
  report.push("change: value=" + (await p.locator("#address").inputValue()) + " cancel visible=" + (await p.locator("#cancel").isVisible()));
  await p.keyboard.press("Escape");
  report.push("change: Esc cancels: " + (await p.evaluate(() => window.__cancelled === true)));
  report.push("errors: " + JSON.stringify(errors));
  await context.close();
  await browser.close();
  fs.writeFileSync(path.join(out, "report.txt"), report.join("\n") + "\n");
  console.log(report.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
```

(It loads playwright-core from this PC's npx cache, `_npx/9833c18b2d85bc59` (1.64.0-alpha, present at the gate); if
that folder is gone, run `npx -y playwright-core --version` once and put the new `_npx/<hash>` path into the script.)

Run `cd "$SP" && node url-window-shots.cjs D:/kd/lucifer/apps/desktop/assets/url-window.html "$(cygpath -w "$SP")/shots-url"` and look at the five
screenshots (`1-empty`, `2-typing`, `3-error`, `4-connecting`, `5-change-address`). Expected, as at the gate:
```text
empty: cancel hidden=true clear hidden=true footer=POS Software by sandbee · 2.0.0
typing: clear visible=true
error: saved="MyCafe " title=Check the address body=We couldn't find a POS at mycafe.sandbee.in. Check the name.
typing clears the error: title=Your workspace
first run: Esc does not cancel: true
errors: []
connecting: label=Connecting… disabled=true readonly=
change: value=https://mycafe.sandbee.in cancel visible=true
change: Esc cancels: true
errors: []
```
and screenshots like the Android start screen: the red icon, "Connect to your workspace" and its subtitle, "POS
address" over the field with its blue badge (a clear button once something is typed), the blue "Your workspace" hint
(red "Check the address" with the error), the blue Open POS with its arrow (grey "Connecting…" while checking), Cancel
only in `5-change-address`, the two footer lines with `· 2.0.0`.

- [ ] **Step 6: Commit** (`$SP/msg-n3-3.txt`):

```text
feat(desktop): the address window looks and reads like the Android start screen: 480 x 640, the red Sandbee icon, "Connect to your workspace", the field with its icon and clear button, the workspace hint that turns into "Check the address", Open POS ("Connecting..." while checking), Cancel and Esc only from Change POS address, the version in the footer; the main process normalizes, checks once through net.fetch, then saves, and the page makes no request; pins (8), (9), (R5) deliberately changed, (A1), (A2); GO-LIVE's first-run line and its runbook pin (native apps 2.0, Session N3, spec §9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 34: "Change POS address…" everywhere

**Files:**
- Modify: `apps/desktop/src/menu.ts` (the Help menu, the tray, the About dialog), the comments in `src/main.ts`, `src/shell-window.ts`, `src/url-window.ts`; `docs/GO-LIVE-CHECKLIST.md` (§7), `apps/cafe/DEPLOY.md`
- Test: `apps/cafe/lib/go-live-runbook.test.ts` (the menu label), `apps/desktop/src/desktop-paths.test.ts` ((A3))

- [ ] **Step 1: Write the failing tests**

In `apps/cafe/lib/go-live-runbook.test.ts`, find:

```ts
    ["Quit", menuSrc, "menu.ts"],
    ["Start with Windows", menuSrc, "menu.ts"],
    ["Change server address…", menuSrc, "menu.ts"],
    // Native apps 2.0 Session N3 deliberately changed: the address window's words (spec §9).
    ["POS address", urlHtml, "url-window.html"],
```

Replace it with:

```ts
    ["Quit", menuSrc, "menu.ts"],
    ["Start with Windows", menuSrc, "menu.ts"],
    ["Change POS address…", menuSrc, "menu.ts"],
    // Native apps 2.0 Session N3 deliberately changed: the address window's words (spec §9).
    ["POS address", urlHtml, "url-window.html"],
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
});

test("(R5) url-window assets: inline data: logo under a data:-only img-src, a real form (Enter submits), the product name on the page", () => {
  assert.ok(urlWindowHtml.includes("img-src data:"), "CSP must allow only data: images (the logo is inlined; file:// 'self' is not relied on)");
```

Replace it with:

```ts
});

test("(A3) the menu and the tray say Change POS address…, the About dialog names the POS address", () => {
  const menuSrc = read("src/menu.ts");
  assert.equal((menuSrc.match(/label: "Change POS address…"/g) ?? []).length, 2, "the Help menu and the tray");
  assert.ok(!menuSrc.includes("server address") && !menuSrc.includes("Server address"), "no server address left in the menu");
  assert.ok(menuSrc.includes("`POS address: ${details.serverOrigin ?? \"not set\"}`"), "the About dialog names the POS address");
});

test("(R5) url-window assets: inline data: logo under a data:-only img-src, a real form (Enter submits), the product name on the page", () => {
  assert.ok(urlWindowHtml.includes("img-src data:"), "CSP must allow only data: images (the logo is inlined; file:// 'self' is not relied on)");
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/desktop && timeout 250 node --import tsx --test src/desktop-paths.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"
cd ../cafe && timeout 300 node --import tsx --test lib/go-live-runbook.test.ts 2>&1 | grep -E "^not ok|^  error:|^# (tests|pass|fail)"
```
Expected: `(A3)` fails (`# tests 71`, `# pass 70`, `# fail 1`); the runbook's `PIN §7 desktop app: …` fails with `'§7
desktop sub-section must quote "Change POS address…"'` (`# tests 97`, `# fail 1`).

- [ ] **Step 3: Implement**

In `apps/cafe/DEPLOY.md`, find:

```markdown
and the console shows **HOLD**. On a real switch the old `*.vercel.app` address (and, after
a rename, the old `<sub>.<apex>` name) is left **redirecting** to the new one (so old printed QR codes and bookmarks keep working) and the after-switch
checklist appears: staff sign in again, counter PC → "Change server address…", Settings →
Telegram → Repair webhook, R2 bucket CORS → add the new origin. **More ▾ → Revert web
address…** removes the redirects first, then goes back to the `*.vercel.app` address (the
```

Replace it with:

```markdown
and the console shows **HOLD**. On a real switch the old `*.vercel.app` address (and, after
a rename, the old `<sub>.<apex>` name) is left **redirecting** to the new one (so old printed QR codes and bookmarks keep working) and the after-switch
checklist appears: staff sign in again, counter PC → "Change POS address…", Settings →
Telegram → Repair webhook, R2 bucket CORS → add the new origin. **More ▾ → Revert web
address…** removes the redirects first, then goes back to the `*.vercel.app` address (the
```

In `apps/desktop/src/main.ts`, find:

```ts

    // Mutable so the currently-open window's Cancel button reflects how it
    // was opened (first run: no cancel; "Change server address…": cancel ok).
    let urlWindowAllowsCancel = false;

```

Replace it with:

```ts

    // Mutable so the currently-open window's Cancel button reflects how it
    // was opened (first run: no cancel; "Change POS address…": cancel ok).
    let urlWindowAllowsCancel = false;

```

In `apps/desktop/src/menu.ts`, find:

```ts
        { label: "Reload", click: () => actions.reload() },
        { type: "separator" },
        { label: "Change server address…", click: () => actions.changeServerAddress() },
        {
          label: "Start with Windows",
```

Replace it with:

```ts
        { label: "Reload", click: () => actions.reload() },
        { type: "separator" },
        { label: "Change POS address…", click: () => actions.changeServerAddress() },
        {
          label: "Start with Windows",
```

In `apps/desktop/src/menu.ts`, find:

```ts
    Menu.buildFromTemplate([
      { label: "Open POS", click: () => actions.openPos() },
      { label: "Change server address…", click: () => actions.changeServerAddress() },
      { type: "separator" },
      { label: "Quit", click: () => actions.quit() },
```

Replace it with:

```ts
    Menu.buildFromTemplate([
      { label: "Open POS", click: () => actions.openPos() },
      { label: "Change POS address…", click: () => actions.changeServerAddress() },
      { type: "separator" },
      { label: "Quit", click: () => actions.quit() },
```

In `apps/desktop/src/menu.ts`, find:

```ts
      `Version ${details.version}\n` +
      `Electron ${details.electronVersion}\n` +
      `Server address: ${details.serverOrigin ?? "not set"}`,
  });
}
```

Replace it with:

```ts
      `Version ${details.version}\n` +
      `Electron ${details.electronVersion}\n` +
      `POS address: ${details.serverOrigin ?? "not set"}`,
  });
}
```

In `apps/desktop/src/shell-window.ts`, find:

```ts

interface CreateMainWindowDeps {
  // A getter, not a value: "Change server address…" re-points the SAME window,
  // so the navigation guards and the retry must always read the current origin.
  getOrigin(): string;
```

Replace it with:

```ts

interface CreateMainWindowDeps {
  // A getter, not a value: "Change POS address…" re-points the SAME window,
  // so the navigation guards and the retry must always read the current origin.
  getOrigin(): string;
```

In `apps/desktop/src/url-window.ts`, find:

```ts
// The first-run/"Change server address…" window: a small, non-resizable
// prompt for the saved server origin. No preload state beyond three IPC
// channels; the address rules live in pos-url.ts (the Android app's).
import path from "node:path";
import { app, BrowserWindow, ipcMain, net, type IpcMainInvokeEvent } from "electron";
```

Replace it with:

```ts
// The first-run/"Change POS address…" window (native apps 2.0: the Android
// start screen's look): a non-resizable prompt for the saved POS origin. The
// preload exposes three IPC calls and the app's version; the address rules
// live in pos-url.ts (the Android app's), the one check in pos-health.ts.
import path from "node:path";
import { app, BrowserWindow, ipcMain, net, type IpcMainInvokeEvent } from "electron";
```

In `apps/desktop/src/url-window.ts`, find:

```ts
  // Read at cancel-time, not registration-time: the same handlers serve
  // both the first-run window (allowCancel false) and every later
  // "Change server address…" window (allowCancel true) — ipcMain.handle
  // can only be bound once per channel for the app's lifetime.
  allowCancel(): boolean;
```

Replace it with:

```ts
  // Read at cancel-time, not registration-time: the same handlers serve
  // both the first-run window (allowCancel false) and every later
  // "Change POS address…" window (allowCancel true) — ipcMain.handle
  // can only be bound once per channel for the app's lifetime.
  allowCancel(): boolean;
```

In `docs/GO-LIVE-CHECKLIST.md`, find:

```markdown
- [ ] After the first successful load the app starts hidden with Windows.
      **Help → Start with Windows** turns that off and on.
- [ ] **Help → Change server address…** if the address ever changes.
- [ ] Uninstall from Windows **Settings → Apps → POS Software by sandbee** (this
      also removes the app's start-with-Windows entry).
```

Replace it with:

```markdown
- [ ] After the first successful load the app starts hidden with Windows.
      **Help → Start with Windows** turns that off and on.
- [ ] **Help → Change POS address…** if the address ever changes.
- [ ] Uninstall from Windows **Settings → Apps → POS Software by sandbee** (this
      also removes the app's start-with-Windows entry).
```

- [ ] **Step 4: Run them and see them pass, and the grep**

```bash
cd /d/kd/lucifer/apps/desktop && timeout 250 npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)" && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "typecheck and lint clean"
cd ../cafe && timeout 300 node --import tsx --test lib/go-live-runbook.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"
cd /d/kd/lucifer && git grep -n "Change server address\|Server address" -- apps docs ":!docs/superpowers" ":!*/out/*"
```
Expected: desktop `# tests 203`, `# pass 203`, `# fail 0`, `typecheck and lint clean`; the runbook `# tests 97`,
`# pass 97`, `# fail 0`; the grep finds only `(A3)`'s own negative needle
(`apps/desktop/src/desktop-paths.test.ts:…:  assert.ok(!menuSrc.includes("server address") && …`).

- [ ] **Step 5: Commit** (`$SP/msg-n3-4.txt`):

```text
feat(desktop): "Change POS address..." everywhere: the Help menu, the tray, the About dialog (POS address), the code comments, GO-LIVE, DEPLOY.md and the go-live runbook pin; pin (A3) (native apps 2.0, Session N3, spec §9)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 35: The Windows updater

**Files:**
- Create: `apps/desktop/src/update-plan.ts`, `src/updater.ts`; Test: `src/update-plan.test.ts` (4 tests)
- Modify: `apps/desktop/package.json` (`electron-updater` 6.8.9, `build.publish`), `package-lock.json` (as `npm install` writes it), `src/menu.ts` (Restart to update in the Help menu and the tray), `src/main.ts` (the updater; start with Windows put back at start when its entry is missing), `resources/installer.nsh` (the entries kept on `--updated`)
- Test: `src/desktop-paths.test.ts` (pins (3), (10) deliberately changed; (R7); (U1)–(U4); (11)/(12) read the two files), `package.json` (the test script)

**Interfaces:** `startUpdater({ log, onStateChange }): () => void` (a packaged app only), `restartToUpdate()`; `update-plan.ts`: `FIRST_CHECK_MS = 60_000`, `CHECK_EVERY_MS = 86_400_000`, `UpdateState`, `UPDATE_IDLE`, `RESTART_TO_UPDATE`, `readyNotice(version)` → "Update ready" / "POS Software <version> is ready. It installs when you close the app.", `noticeFor(lastNotified, version)`, `trayUpdateItem(state)`; `menu.ts`: `AppMenuActions.updateItem`/`restartToUpdate`, `TrayActions.restartToUpdate`, `setTrayUpdateItem(item)`. Log lines: `updater: …` (electron-updater's own), `updater: <version> is ready; notified`.

- [ ] **Step 1: Write the failing tests**

In `apps/desktop/package.json`, find:

```json
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "test": "node --import tsx --test src/server-url.test.ts src/pos-url.test.ts src/pos-health.test.ts src/store.test.ts src/window-state.test.ts src/escpos.test.ts src/raw-spool.test.ts src/raw-tcp.test.ts src/printer-check.test.ts src/desktop-paths.test.ts",
    "start": "npm run build && electron .",
    "dist": "npm run build && electron-builder --win nsis --publish never"
```

Replace it with:

```json
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "test": "node --import tsx --test src/server-url.test.ts src/pos-url.test.ts src/pos-health.test.ts src/update-plan.test.ts src/store.test.ts src/window-state.test.ts src/escpos.test.ts src/raw-spool.test.ts src/raw-tcp.test.ts src/printer-check.test.ts src/desktop-paths.test.ts",
    "start": "npm run build && electron .",
    "dist": "npm run build && electron-builder --win nsis --publish never"
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
});

test("(3) main.ts: setLoginItemSettings called exactly twice, both with args: [HIDDEN_FLAG]", () => {
  const calls = mainSrc.match(/setLoginItemSettings\(/g) ?? [];
  assert.equal(calls.length, 2, "expected exactly two setLoginItemSettings call sites");
  const argsMatches = mainSrc.match(/args:\s*\[HIDDEN_FLAG\]/g) ?? [];
  assert.equal(argsMatches.length, 2, "both setLoginItemSettings calls must pass args: [HIDDEN_FLAG]");
});

```

Replace it with:

```ts
});

// Native apps 2.0 Session N3 deliberately changed: a third call sets start-with-Windows again at every start (U4).
test("(3) main.ts: setLoginItemSettings called exactly three times, all with args: [HIDDEN_FLAG]", () => {
  const calls = mainSrc.match(/setLoginItemSettings\(/g) ?? [];
  assert.equal(calls.length, 3, "expected exactly three setLoginItemSettings call sites");
  const argsMatches = mainSrc.match(/args:\s*\[HIDDEN_FLAG\]/g) ?? [];
  assert.equal(argsMatches.length, 3, "every setLoginItemSettings call must pass args: [HIDDEN_FLAG]");
});

```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
});

test("(10) package.json build block: no publish key, no sign/cert key anywhere under build", () => {
  assert.equal(Object.prototype.hasOwnProperty.call(typedPkg.build, "publish"), false);

  function scanForSignOrCert(value: unknown, keyPath: string): void {
```

Replace it with:

```ts
});

// Native apps 2.0 Session N3 deliberately changed (spec §7): build.publish is the generic provider at the owner's files
// address, so electron-builder writes latest.yml, the blockmap and resources/app-update.yml; `dist` still publishes
// nothing (--publish never), and the owner uploads by hand.
test("(10) package.json build block: publish is the generic provider at files.sandbee.in/pos/windows, no sign/cert key anywhere under build", () => {
  assert.deepEqual(typedPkg.build.publish, { provider: "generic", url: "https://files.sandbee.in/pos/windows" });

  function scanForSignOrCert(value: unknown, keyPath: string): void {
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
    "pos-url.ts",
    "pos-health.ts",
    "store.ts",
    "window-state.ts",
```

Replace it with:

```ts
    "pos-url.ts",
    "pos-health.ts",
    "update-plan.ts",
    "updater.ts",
    "store.ts",
    "window-state.ts",
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
    ["src/pos-url.ts", read("src/pos-url.ts")],
    ["src/pos-health.ts", read("src/pos-health.ts")],
    ["src/store.ts", read("src/store.ts")],
    ["src/window-state.ts", read("src/window-state.ts")],
```

Replace it with:

```ts
    ["src/pos-url.ts", read("src/pos-url.ts")],
    ["src/pos-health.ts", read("src/pos-health.ts")],
    ["src/update-plan.ts", read("src/update-plan.ts")],
    ["src/updater.ts", read("src/updater.ts")],
    ["src/store.ts", read("src/store.ts")],
    ["src/window-state.ts", read("src/window-state.ts")],
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
  assert.equal((installerNsh.match(new RegExp(JSON.stringify(APP_ID), "g")) ?? []).length, 2, "both values must be named by the AppUserModelId (= build.appId) — a rename here strands the entry (C13)");
  assert.ok(installerNsh.includes("StartupApproved"));
});

```

Replace it with:

```ts
  assert.equal((installerNsh.match(new RegExp(JSON.stringify(APP_ID), "g")) ?? []).length, 2, "both values must be named by the AppUserModelId (= build.appId) — a rename here strands the entry (C13)");
  assert.ok(installerNsh.includes("StartupApproved"));
  // Native apps 2.0 (the N2 review gate, G-1): an install over an older version runs the old uninstaller with --updated;
  // the start-with-Windows entries stay then (U4).
  assert.match(installerNsh, /\$\{ifNot\} \$\{isUpdated\}\s+DeleteRegValue HKCU[^\n]+\n\s+DeleteRegValue HKCU[^\n]+\n\s+\$\{endIf\}/, "the entries are removed only by a real uninstall");
});

// -- (U) native apps 2.0 (spec §7): the Windows updater ----------------------
const updaterSrc = existsSync(path.join(SRC, "updater.ts")) ? read("src/updater.ts") : "";

test("(U1) package.json: electron-updater is a runtime dependency, an exact pin of the version paired with electron-builder 26.16.0", () => {
  const typed = pkg as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  assert.equal(typed.dependencies["electron-updater"], "6.8.9", "6.8.9 shares builder-util-runtime 9.7.0 with electron-builder 26.16.0");
  assert.equal(typed.devDependencies["electron-builder"], "26.16.0", "the builder it is paired with");
});

test("(U2) updater.ts: download in the background, install when the app quits, never down, never a prerelease, only a packaged app, errors only logged, no dialog", () => {
  for (const line of [
    "autoUpdater.autoDownload = true;",
    "autoUpdater.autoInstallOnAppQuit = true;",
    "autoUpdater.allowDowngrade = false;",
    "autoUpdater.allowPrerelease = false;",
    "if (!app.isPackaged) return () => undefined;",
    "const first = setTimeout(check, FIRST_CHECK_MS);",
    "const every = setInterval(check, CHECK_EVERY_MS);",
    'autoUpdater.on("error", (error) => deps.log.error(`updater: ${error.name}`));',
    "const notice = noticeFor(notified, info.version);",
  ]) {
    assert.ok(updaterSrc.includes(line), `updater.ts must carry: ${line}`);
  }
  const code = (src: string) => src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\bdialog\b/.test(code(updaterSrc)), "no dialog in the updater's code (spec D3)");
  assert.ok(!/\bdialog\b/.test(code(mainSrc)), "no dialog in main.ts's code either");
  assert.ok(updaterSrc.includes("Never a dialog"), "landmark: the comments were stripped, not the code");
});

test("(U3) quitAndInstall runs only from Restart to update, which the tray and the Help menu offer once an update is downloaded", () => {
  const all = readdirSync(SRC).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
  const quitters = all.filter((name) => read(`src/${name}`).includes("quitAndInstall("));
  assert.deepEqual(quitters, ["updater.ts"], "only updater.ts calls quitAndInstall");
  assert.equal((updaterSrc.match(/quitAndInstall\(/g) ?? []).length, 1, "one call");
  assert.ok(updaterSrc.includes("autoUpdater.quitAndInstall(true, true);"), "silent, and the app starts again");
  const importers = all.filter((name) => read(`src/${name}`).includes('from "electron-updater"'));
  assert.deepEqual(importers, ["updater.ts"], "only updater.ts talks to electron-updater");
  const menuSrc = read("src/menu.ts");
  assert.equal((menuSrc.match(/click: \(\) => actions\.restartToUpdate\(\)/g) ?? []).length, 2, "the Help menu and the tray");
  assert.equal((menuSrc.match(/\.\.\.\(update \? \[\{ label: update\.label, click: \(\) => actions\.restartToUpdate\(\) \}/g) ?? []).length, 2, "only when an update is downloaded");
  assert.ok(mainSrc.includes("restartToUpdate: () => restartToUpdate(),"), "main.ts wires the item to the updater");
});

test("(U4) start with Windows survives an update: the uninstaller keeps it on --updated, and the app puts the entry back at start when it is missing", () => {
  assert.ok(mainSrc.includes("const loginItem = { path: process.execPath, args: [HIDDEN_FLAG] };"), "the entry: this exe with --hidden, as the first arming");
  const at = mainSrc.indexOf("if (store.autoStart === true && app.isPackaged && !app.getLoginItemSettings(loginItem).openAtLogin) {");
  assert.ok(at >= 0, "main.ts puts it back only when the operator chose it and the entry is missing (a Windows-side disable is left alone)");
  const body = mainSrc.slice(at, mainSrc.indexOf("\n    }", at));
  assert.ok(body.includes("app.setLoginItemSettings({ openAtLogin: true, ...loginItem });"), "the same entry as the first arming");
});

```

Create `apps/desktop/src/update-plan.test.ts`:

```ts
// Native apps 2.0 (spec §7): what the Windows updater does when. It looks one minute after start and then every 24
// hours; a downloaded update is announced once per version and the tray offers Restart to update; it installs when the
// app quits. Never a dialog, never an automatic restart (spec D3).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_EVERY_MS,
  FIRST_CHECK_MS,
  noticeFor,
  readyNotice,
  RESTART_TO_UPDATE,
  trayUpdateItem,
  UPDATE_IDLE,
} from "./update-plan";

test("the updater looks one minute after start, then every 24 hours", () => {
  assert.equal(FIRST_CHECK_MS, 60_000);
  assert.equal(CHECK_EVERY_MS, 24 * 60 * 60 * 1000);
});

test("the ready notice names the version and says it installs when the app is closed", () => {
  assert.deepEqual(readyNotice("2.0.1"), {
    title: "Update ready",
    body: "POS Software 2.0.1 is ready. It installs when you close the app.",
  });
});

test("one notice per version: the same version again is quiet, a newer one is announced", () => {
  assert.deepEqual(noticeFor(null, "2.0.1"), readyNotice("2.0.1"));
  assert.equal(noticeFor("2.0.1", "2.0.1"), null);
  assert.deepEqual(noticeFor("2.0.1", "2.0.2"), readyNotice("2.0.2"));
});

test("the tray offers Restart to update only once an update is downloaded", () => {
  assert.equal(trayUpdateItem(UPDATE_IDLE), null);
  assert.deepEqual(trayUpdateItem({ kind: "downloaded", version: "2.0.1" }), { label: "Restart to update" });
  assert.equal(RESTART_TO_UPDATE, "Restart to update");
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/desktop && timeout 250 npm test 2>&1 | grep -E "^not ok|Cannot find module|^# (tests|pass|fail)"
```
Expected: ten fail (`# tests 208`, `# pass 198`, `# fail 10`): `(3) …exactly three times…`, `(10) …publish is the
generic provider…`, `(11)`, `(12)`, `(R7)`, `(U1)`, `(U2)`, `(U3)`, `(U4)`, and `src\\update-plan.test.ts`
(`# Error: Cannot find module './update-plan'`).

- [ ] **Step 3: Implement** (then `npm install` writes nothing new: the lock below is what it writes)

In `apps/desktop/package-lock.json`, find:

```json
{
  "name": "pos-desktop",
  "version": "1.9.0",
  "lockfileVersion": 3,
  "requires": true,
```

Replace it with:

```json
{
  "name": "pos-desktop",
  "version": "2.0.0",
  "lockfileVersion": 3,
  "requires": true,
```

In `apps/desktop/package-lock.json`, find:

```json
    "": {
      "name": "pos-desktop",
      "version": "1.9.0",
      "dependencies": {
        "koffi": "3.3.1"
      },
```

Replace it with:

```json
    "": {
      "name": "pos-desktop",
      "version": "2.0.0",
      "dependencies": {
        "electron-updater": "6.8.9",
        "koffi": "3.3.1"
      },
```

In `apps/desktop/package-lock.json`, find:

```json
      "resolved": "https://registry.npmjs.org/argparse/-/argparse-2.0.1.tgz",
      "integrity": "sha512-8+9WqebbFzpX9OR+Wa6O29asIogeRMzcGtAINdpMHHyAg10f05aSFVBbcEqGf/PXw1EjAZ+q2/bEBg3DvurK3Q==",
      "dev": true,
      "license": "Python-2.0"
    },
```

Replace it with:

```json
      "resolved": "https://registry.npmjs.org/argparse/-/argparse-2.0.1.tgz",
      "integrity": "sha512-8+9WqebbFzpX9OR+Wa6O29asIogeRMzcGtAINdpMHHyAg10f05aSFVBbcEqGf/PXw1EjAZ+q2/bEBg3DvurK3Q==",
      "license": "Python-2.0"
    },
```

In `apps/desktop/package-lock.json`, find:

```json
      "resolved": "https://registry.npmjs.org/builder-util-runtime/-/builder-util-runtime-9.7.0.tgz",
      "integrity": "sha512-g/kR520giAFYkSXTzcmF3kqQq7wi8F6N6SzeDgZrqTBN+VHdmgWOyTdD1yD7AATDId/yXLvuP34CxW46/BwCdw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
```

Replace it with:

```json
      "resolved": "https://registry.npmjs.org/builder-util-runtime/-/builder-util-runtime-9.7.0.tgz",
      "integrity": "sha512-g/kR520giAFYkSXTzcmF3kqQq7wi8F6N6SzeDgZrqTBN+VHdmgWOyTdD1yD7AATDId/yXLvuP34CxW46/BwCdw==",
      "license": "MIT",
      "dependencies": {
```

In `apps/desktop/package-lock.json`, find:

```json
      "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.3.tgz",
      "integrity": "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
```

Replace it with:

```json
      "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.3.tgz",
      "integrity": "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==",
      "license": "MIT",
      "dependencies": {
```

In `apps/desktop/package-lock.json`, find:

```json
        "lazy-val": "^1.0.5",
        "mime": "^2.5.2"
      }
    },
```

Replace it with:

```json
        "lazy-val": "^1.0.5",
        "mime": "^2.5.2"
      }
    },
    "node_modules/electron-updater": {
      "version": "6.8.9",
      "resolved": "https://registry.npmjs.org/electron-updater/-/electron-updater-6.8.9.tgz",
      "integrity": "sha512-ZhVxM9iGONUpZGI1FxdMRgJjUFXi7AYGVa5PwKlO1tV1/4zDxQmfKpXOHVztKrd6L9rLcFjERvi1Mf2vxyTkig==",
      "license": "MIT",
      "dependencies": {
        "builder-util-runtime": "9.7.0",
        "fs-extra": "^10.1.0",
        "js-yaml": "^4.1.0",
        "lazy-val": "^1.0.5",
        "lodash.escaperegexp": "^4.1.2",
        "lodash.isequal": "^4.5.0",
        "semver": "~7.7.3",
        "tiny-typed-emitter": "^2.1.0"
      }
    },
    "node_modules/electron-updater/node_modules/semver": {
      "version": "7.7.4",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.7.4.tgz",
      "integrity": "sha512-vFKC2IEtQnVhpT78h1Yp8wzwrf8CM+MzKMHGJZfBtzhZNycRFnXsHk6E5TxIkkMsgNS7mdX3AGB7x2QM2di4lA==",
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
```

In `apps/desktop/package-lock.json`, find:

```json
      "resolved": "https://registry.npmjs.org/fs-extra/-/fs-extra-10.1.0.tgz",
      "integrity": "sha512-oRXApq54ETRj4eMiFzGnHWGy+zo5raudjuxN0b8H7s/RU2oW0Wvsx9O0ACRN/kRq9E8Vu/ReskGB5o3ji+FzHQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
```

Replace it with:

```json
      "resolved": "https://registry.npmjs.org/fs-extra/-/fs-extra-10.1.0.tgz",
      "integrity": "sha512-oRXApq54ETRj4eMiFzGnHWGy+zo5raudjuxN0b8H7s/RU2oW0Wvsx9O0ACRN/kRq9E8Vu/ReskGB5o3ji+FzHQ==",
      "license": "MIT",
      "dependencies": {
```

In `apps/desktop/package-lock.json`, find:

```json
      "resolved": "https://registry.npmjs.org/graceful-fs/-/graceful-fs-4.2.11.tgz",
      "integrity": "sha512-RbJ5/jmFcNNCcDV5o9eTnBLJ/HszWV0P73bc+Ff4nS/rJj+YaS6IGyiOL0VoBYX+l1Wrl3k63h/KrH+nhJ0XvQ==",
      "dev": true,
      "license": "ISC"
    },
```

Replace it with:

```json
      "resolved": "https://registry.npmjs.org/graceful-fs/-/graceful-fs-4.2.11.tgz",
      "integrity": "sha512-RbJ5/jmFcNNCcDV5o9eTnBLJ/HszWV0P73bc+Ff4nS/rJj+YaS6IGyiOL0VoBYX+l1Wrl3k63h/KrH+nhJ0XvQ==",
      "license": "ISC"
    },
```

In `apps/desktop/package-lock.json`, find:

```json
      "resolved": "https://registry.npmjs.org/js-yaml/-/js-yaml-4.3.2.tgz",
      "integrity": "sha512-SFNOvSJ+Dgf/9An904Yx+CgSlIPCkIpao4qo51lpee25TIRejdH3rhR4EZMGoNx3/TP3O+wzWuiTFl4sqbltzA==",
      "dev": true,
      "funding": [
        {
```

Replace it with:

```json
      "resolved": "https://registry.npmjs.org/js-yaml/-/js-yaml-4.3.2.tgz",
      "integrity": "sha512-SFNOvSJ+Dgf/9An904Yx+CgSlIPCkIpao4qo51lpee25TIRejdH3rhR4EZMGoNx3/TP3O+wzWuiTFl4sqbltzA==",
      "funding": [
        {
```

In `apps/desktop/package-lock.json`, find:

```json
      "resolved": "https://registry.npmjs.org/jsonfile/-/jsonfile-6.2.1.tgz",
      "integrity": "sha512-zwOTdL3rFQ/lRdBnntKVOX6k5cKJwEc1HdilT71BWEu7J41gXIB2MRp+vxduPSwZJPWBxEzv4yH1wYLJGUHX4Q==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
```

Replace it with:

```json
      "resolved": "https://registry.npmjs.org/jsonfile/-/jsonfile-6.2.1.tgz",
      "integrity": "sha512-zwOTdL3rFQ/lRdBnntKVOX6k5cKJwEc1HdilT71BWEu7J41gXIB2MRp+vxduPSwZJPWBxEzv4yH1wYLJGUHX4Q==",
      "license": "MIT",
      "dependencies": {
```

In `apps/desktop/package-lock.json`, find:

```json
      "resolved": "https://registry.npmjs.org/lazy-val/-/lazy-val-1.0.5.tgz",
      "integrity": "sha512-0/BnGCCfyUMkBpeDgWihanIAF9JmZhHBgUhEqzvf+adhNGLoP6TaiI5oF8oyb3I45P+PcnrqihSf01M0l0G5+Q==",
      "dev": true,
      "license": "MIT"
    },
```

Replace it with:

```json
      "resolved": "https://registry.npmjs.org/lazy-val/-/lazy-val-1.0.5.tgz",
      "integrity": "sha512-0/BnGCCfyUMkBpeDgWihanIAF9JmZhHBgUhEqzvf+adhNGLoP6TaiI5oF8oyb3I45P+PcnrqihSf01M0l0G5+Q==",
      "license": "MIT"
    },
```

In `apps/desktop/package-lock.json`, find:

```json
      "integrity": "sha512-dMInicTPVE8d1e5otfwmmjlxkZoUpiVLwyeTdUsi/Caj/gfzzblBcCE5sRHV/AsjuCmxWrte2TNGSYuCeCq+0Q==",
      "dev": true,
      "license": "MIT"
    },
```

Replace it with:

```json
      "integrity": "sha512-dMInicTPVE8d1e5otfwmmjlxkZoUpiVLwyeTdUsi/Caj/gfzzblBcCE5sRHV/AsjuCmxWrte2TNGSYuCeCq+0Q==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/lodash.escaperegexp": {
      "version": "4.1.2",
      "resolved": "https://registry.npmjs.org/lodash.escaperegexp/-/lodash.escaperegexp-4.1.2.tgz",
      "integrity": "sha512-TM9YBvyC84ZxE3rgfefxUWiQKLilstD6k7PTGt6wfbtXF8ixIJLOL3VYyV/z+ZiPLsVxAsKAFVwWlWeb2Y8Yyw==",
      "license": "MIT"
    },
    "node_modules/lodash.isequal": {
      "version": "4.5.0",
      "resolved": "https://registry.npmjs.org/lodash.isequal/-/lodash.isequal-4.5.0.tgz",
      "integrity": "sha512-pDo3lu8Jhfjqls6GkMgpahsF9kCyayhgykjyLMNFTKWrpVdAQtYyB4muAMWozBB4ig/dtWAmsMxLEI8wuz+DYQ==",
      "deprecated": "This package is deprecated. Use require('node:util').isDeepStrictEqual instead.",
      "license": "MIT"
    },
```

In `apps/desktop/package-lock.json`, find:

```json
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "dev": true,
      "license": "MIT"
    },
```

Replace it with:

```json
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "license": "MIT"
    },
```

In `apps/desktop/package-lock.json`, find:

```json
      "resolved": "https://registry.npmjs.org/sax/-/sax-1.6.1.tgz",
      "integrity": "sha512-42tBVwLWnaQvW5zc4HbZrTuWccECCZfBi92FDuwtqxasH+JbPB3/FOKb1m222K42R4WxuxzzMsTswfzgtSu64Q==",
      "dev": true,
      "license": "BlueOak-1.0.0",
      "engines": {
```

Replace it with:

```json
      "resolved": "https://registry.npmjs.org/sax/-/sax-1.6.1.tgz",
      "integrity": "sha512-42tBVwLWnaQvW5zc4HbZrTuWccECCZfBi92FDuwtqxasH+JbPB3/FOKb1m222K42R4WxuxzzMsTswfzgtSu64Q==",
      "license": "BlueOak-1.0.0",
      "engines": {
```

In `apps/desktop/package-lock.json`, find:

```json
      }
    },
    "node_modules/tinyglobby": {
      "version": "0.2.17",
```

Replace it with:

```json
      }
    },
    "node_modules/tiny-typed-emitter": {
      "version": "2.1.0",
      "resolved": "https://registry.npmjs.org/tiny-typed-emitter/-/tiny-typed-emitter-2.1.0.tgz",
      "integrity": "sha512-qVtvMxeXbVej0cQWKqVSSAHmKZEHAvxdF8HEUBFWts8h+xEo5m/lEiPakuyZ3BnCBjOD8i24kzNOiOLLgsSxhA==",
      "license": "MIT"
    },
    "node_modules/tinyglobby": {
      "version": "0.2.17",
```

In `apps/desktop/package-lock.json`, find:

```json
      "resolved": "https://registry.npmjs.org/universalify/-/universalify-2.0.1.tgz",
      "integrity": "sha512-gptHNQghINnc/vTGIk0SOFGFNXw7JVrlRUtConJRlvaw6DuX0wO5Jeko9sWrMBhh+PsYAZ7oXAiOnf/UKogyiw==",
      "dev": true,
      "license": "MIT",
      "engines": {
```

Replace it with:

```json
      "resolved": "https://registry.npmjs.org/universalify/-/universalify-2.0.1.tgz",
      "integrity": "sha512-gptHNQghINnc/vTGIk0SOFGFNXw7JVrlRUtConJRlvaw6DuX0wO5Jeko9sWrMBhh+PsYAZ7oXAiOnf/UKogyiw==",
      "license": "MIT",
      "engines": {
```

In `apps/desktop/package.json`, find:

```json
      "shortcutName": "POS Software by sandbee",
      "include": "resources/installer.nsh"
    }
  },
  "dependencies": {
    "koffi": "3.3.1"
  },
```

Replace it with:

```json
      "shortcutName": "POS Software by sandbee",
      "include": "resources/installer.nsh"
    },
    "publish": { "provider": "generic", "url": "https://files.sandbee.in/pos/windows" }
  },
  "dependencies": {
    "electron-updater": "6.8.9",
    "koffi": "3.3.1"
  },
```

In `apps/desktop/resources/installer.nsh`, find:

```nsis
; uninstaller does not know about that registry value, so remove it here — a
; dangling Run entry would otherwise point at the deleted exe after uninstall.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.possoftware.pos-desktop"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.possoftware.pos-desktop"
!macroend

```

Replace it with:

```nsis
; uninstaller does not know about that registry value, so remove it here — a
; dangling Run entry would otherwise point at the deleted exe after uninstall.
;
; Native apps 2.0 (the N2 review gate, G-1): an install over an older version, and every update, runs the old
; uninstaller with --updated first; the start-with-Windows entries stay then (the app is still installed).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.possoftware.pos-desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.possoftware.pos-desktop"
  ${endIf}
!macroend

```

In `apps/desktop/src/main.ts`, find:

```ts
import { createMainWindow } from "./shell-window";
import { openUrlWindow, registerUrlHandlers } from "./url-window";
import { buildAppMenu, createTray, showAboutDialog } from "./menu";
import type { BrowserWindow } from "electron";

```

Replace it with:

```ts
import { createMainWindow } from "./shell-window";
import { openUrlWindow, registerUrlHandlers } from "./url-window";
import { buildAppMenu, createTray, setTrayUpdateItem, showAboutDialog } from "./menu";
import { restartToUpdate, startUpdater } from "./updater";
import { trayUpdateItem, UPDATE_IDLE, type UpdateState } from "./update-plan";
import type { BrowserWindow } from "electron";

```

In `apps/desktop/src/main.ts`, find:

```ts
  // Cancels the one-shot startup printer check if the app quits before it runs.
  let cancelPrinterCheck: (() => void) | null = null;

  void app.whenReady().then(() => {
```

Replace it with:

```ts
  // Cancels the one-shot startup printer check if the app quits before it runs.
  let cancelPrinterCheck: (() => void) | null = null;
  // Stops the updater's checks when the app quits (native apps 2.0).
  let stopUpdater: (() => void) | null = null;

  void app.whenReady().then(() => {
```

In `apps/desktop/src/main.ts`, find:

```ts
    const log = createLogger(logFile);
    store = readStore(storeFile);

    // The single writer. deviceName and printMode are written by the web
```

Replace it with:

```ts
    const log = createLogger(logFile);
    store = readStore(storeFile);

    // Native apps 2.0 (the N2 review gate, G-1): an install over an older version runs the old uninstaller, and a 1.x
    // uninstaller removes the start-with-Windows entry. An app the operator set to start with Windows puts the entry
    // back at start when it is missing (the same entry as the first arming below); a disable made in Windows (Task
    // Manager, Settings > Startup) keeps the entry, and is left alone.
    const loginItem = { path: process.execPath, args: [HIDDEN_FLAG] };
    if (store.autoStart === true && app.isPackaged && !app.getLoginItemSettings(loginItem).openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true, ...loginItem });
    }

    // The single writer. deviceName and printMode are written by the web
```

In `apps/desktop/src/main.ts`, find:

```ts
    };

    function rebuildMenu(): void {
      const menu = buildAppMenu({
```

Replace it with:

```ts
    };

    // Native apps 2.0 (spec §7): an update downloaded in the background adds Restart to update to both menus.
    let update: UpdateState = UPDATE_IDLE;

    function rebuildMenu(): void {
      const menu = buildAppMenu({
```

In `apps/desktop/src/main.ts`, find:

```ts
          });
        },
        quit: () => app.quit(),
      });
```

Replace it with:

```ts
          });
        },
        updateItem: trayUpdateItem(update),
        restartToUpdate: () => restartToUpdate(),
        quit: () => app.quit(),
      });
```

In `apps/desktop/src/main.ts`, find:

```ts
      openPos: () => openMain(),
      changeServerAddress: () => openSetupWindow(true),
      quit: () => app.quit(),
    });

```

Replace it with:

```ts
      openPos: () => openMain(),
      changeServerAddress: () => openSetupWindow(true),
      restartToUpdate: () => restartToUpdate(),
      quit: () => app.quit(),
    });

    // Native apps 2.0 (spec §7): the Windows updater (a packaged app only): one minute after start, then every 24 hours.
    stopUpdater = startUpdater({
      log,
      onStateChange: (state: UpdateState) => {
        update = state;
        rebuildMenu();
        setTrayUpdateItem(trayUpdateItem(state));
      },
    });

```

In `apps/desktop/src/main.ts`, find:

```ts
    cancelPrinterCheck?.();
    cancelPrinterCheck = null;
  });
}
```

Replace it with:

```ts
    cancelPrinterCheck?.();
    cancelPrinterCheck = null;
    stopUpdater?.();
    stopUpdater = null;
  });
}
```

In `apps/desktop/src/menu.ts`, find:

```ts
  setAutoStart(on: boolean): void;
  showAbout(): void;
  quit(): void;
}

export function buildAppMenu(actions: AppMenuActions): Menu {
  return Menu.buildFromTemplate([
    {
```

Replace it with:

```ts
  setAutoStart(on: boolean): void;
  showAbout(): void;
  // Native apps 2.0 (spec §7): Restart to update, once an update is downloaded (update-plan.ts's trayUpdateItem).
  updateItem: { label: string } | null;
  restartToUpdate(): void;
  quit(): void;
}

export function buildAppMenu(actions: AppMenuActions): Menu {
  const update = actions.updateItem;
  return Menu.buildFromTemplate([
    {
```

In `apps/desktop/src/menu.ts`, find:

```ts
        { label: `About ${PRODUCT_NAME}`, click: () => actions.showAbout() },
        { type: "separator" },
        { label: "Quit", click: () => actions.quit() },
      ],
```

Replace it with:

```ts
        { label: `About ${PRODUCT_NAME}`, click: () => actions.showAbout() },
        { type: "separator" },
        ...(update ? [{ label: update.label, click: () => actions.restartToUpdate() }] : []),
        { label: "Quit", click: () => actions.quit() },
      ],
```

In `apps/desktop/src/menu.ts`, find:

```ts
  openPos(): void;
  changeServerAddress(): void;
  quit(): void;
}
```

Replace it with:

```ts
  openPos(): void;
  changeServerAddress(): void;
  restartToUpdate(): void;
  quit(): void;
}
```

In `apps/desktop/src/menu.ts`, find:

```ts
// the tray icon if its object is garbage-collected.
let tray: Tray | null = null;

export function createTray(actions: TrayActions): Tray {
```

Replace it with:

```ts
// the tray icon if its object is garbage-collected.
let tray: Tray | null = null;
let trayActions: TrayActions | null = null;

function trayMenu(actions: TrayActions, update: { label: string } | null): Menu {
  return Menu.buildFromTemplate([
    { label: "Open POS", click: () => actions.openPos() },
    { label: "Change POS address…", click: () => actions.changeServerAddress() },
    { type: "separator" },
    ...(update ? [{ label: update.label, click: () => actions.restartToUpdate() }] : []),
    { label: "Quit", click: () => actions.quit() },
  ]);
}

/** Native apps 2.0 (spec §7): the tray's menu with Restart to update once an update is downloaded. */
export function setTrayUpdateItem(update: { label: string } | null): void {
  if (tray && trayActions) tray.setContextMenu(trayMenu(trayActions, update));
}

export function createTray(actions: TrayActions): Tray {
```

In `apps/desktop/src/menu.ts`, find:

```ts
  const icon = nativeImage.createFromPath(path.join(__dirname, "../assets/tray.png"));
  tray = new Tray(icon);
  tray.setToolTip(PRODUCT_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open POS", click: () => actions.openPos() },
      { label: "Change POS address…", click: () => actions.changeServerAddress() },
      { type: "separator" },
      { label: "Quit", click: () => actions.quit() },
    ]),
  );
  // M6: both click and double-click open the POS window.
  tray.on("click", () => actions.openPos());
```

Replace it with:

```ts
  const icon = nativeImage.createFromPath(path.join(__dirname, "../assets/tray.png"));
  tray = new Tray(icon);
  trayActions = actions;
  tray.setToolTip(PRODUCT_NAME);
  tray.setContextMenu(trayMenu(actions, null));
  // M6: both click and double-click open the POS window.
  tray.on("click", () => actions.openPos());
```

Create `apps/desktop/src/update-plan.ts`:

```ts
// Native apps 2.0 (spec §7): what the Windows updater does when, as pure values (update-plan.test.ts). It looks one
// minute after start and then every 24 hours; a downloaded update is announced once per version (one Windows
// notification) and the tray and the Help menu offer Restart to update; otherwise it installs when the app quits. Never a
// dialog, never an automatic restart (spec D3).

export const FIRST_CHECK_MS = 60_000;
export const CHECK_EVERY_MS = 86_400_000;

export type UpdateState = { kind: "idle" } | { kind: "downloaded"; version: string };
export const UPDATE_IDLE: UpdateState = { kind: "idle" };

export const RESTART_TO_UPDATE = "Restart to update";

export interface ReadyNotice {
  title: string;
  body: string;
}

export function readyNotice(version: string): ReadyNotice {
  return { title: "Update ready", body: `POS Software ${version} is ready. It installs when you close the app.` };
}

/** The notice for a downloaded [version], or null when that version was already announced. */
export function noticeFor(lastNotified: string | null, version: string): ReadyNotice | null {
  return version === lastNotified ? null : readyNotice(version);
}

/** The menu item a downloaded update adds; nothing until then. */
export function trayUpdateItem(state: UpdateState): { label: string } | null {
  return state.kind === "downloaded" ? { label: RESTART_TO_UPDATE } : null;
}
```

Create `apps/desktop/src/updater.ts`:

```ts
// Native apps 2.0 (spec §7): the Windows updater. electron-updater's generic provider reads <base>/latest.yml (the base
// is package.json's build.publish url, written into resources/app-update.yml by electron-builder), downloads the new
// installer in the background, checks its SHA-512, and installs it when the app quits. Never a dialog, never an automatic
// restart (spec D3): one Windows notification per version, and Restart to update in the tray and the Help menu. Only a
// packaged app looks; errors (no network, a missing file) go to the log only.
import { app, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import { CHECK_EVERY_MS, FIRST_CHECK_MS, noticeFor, type UpdateState } from "./update-plan";
import type { Logger } from "./log";

interface UpdaterDeps {
  log: Logger;
  onStateChange(state: UpdateState): void;
}

/** Starts the checks; returns what stops them (the app's before-quit). */
export function startUpdater(deps: UpdaterDeps): () => void {
  if (!app.isPackaged) return () => undefined;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: (message?: unknown) => deps.log.info(`updater: ${String(message)}`),
    warn: (message?: unknown) => deps.log.info(`updater: warn: ${String(message)}`),
    error: (message?: unknown) => deps.log.error(`updater: ${String(message)}`),
  };
  let notified: string | null = null;
  autoUpdater.on("update-downloaded", (info) => {
    deps.onStateChange({ kind: "downloaded", version: info.version });
    const notice = noticeFor(notified, info.version);
    if (notice === null || !Notification.isSupported()) return;
    notified = info.version;
    deps.log.info(`updater: ${info.version} is ready; notified`);
    new Notification({ title: notice.title, body: notice.body }).show();
  });
  autoUpdater.on("error", (error) => deps.log.error(`updater: ${error.name}`));
  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => undefined);
  };
  const first = setTimeout(check, FIRST_CHECK_MS);
  const every = setInterval(check, CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

/** Restart to update (the tray and the Help menu): the app quits as the tray's Quit does (before-quit), the installer
 *  runs silently, and the app starts again. */
export function restartToUpdate(): void {
  autoUpdater.quitAndInstall(true, true);
}
```

- [ ] **Step 4: Install, run the tests, build**

```bash
cd /d/kd/lucifer/apps/desktop && npm install --no-audit --no-fund 2>&1 | grep -E "^(added|up to date|changed|removed)" | sed -E "s/ in [0-9.]+m?s$//"
sha256sum package.json package-lock.json
grep '"version"' node_modules/electron-updater/package.json node_modules/builder-util-runtime/package.json
timeout 250 npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)" && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "typecheck and lint clean"
npm run build > /dev/null && ls out/updater.js out/update-plan.js out/pos-url.js out/pos-health.js
```
Expected: `added 5 packages` (the gate's copy already had them: `up to date`); `64de4af9f7f2799eb5cf0679368c60ca55bb932e180fb8dc51ff5382528b2701 *package.json` and
`72ab12d8ee9060d9d52dd88caffad6614bee2f9db4a6c0ef7fb1624eb9aa3677 *package-lock.json` (npm wrote nothing more);
electron-updater `"version": "6.8.9"`, builder-util-runtime `"version": "9.7.0"`; desktop `# tests 211`, `# pass 211`,
`# fail 0`, `typecheck and lint clean`; `out/pos-health.js`, `out/pos-url.js`, `out/update-plan.js`, `out/updater.js`.

- [ ] **Step 5: Commit** (`$SP/msg-n3-5.txt`):

```text
feat(desktop): the Windows updater: electron-updater 6.8.9 (the version paired with electron-builder 26.16.0) on the generic provider at https://files.sandbee.in/pos/windows (build.publish; dist still publishes nothing), a look one minute after start and every 24 hours, download in the background, install when the app quits, never down, never a prerelease, no dialog: one notification per version and Restart to update in the tray and the Help menu; start with Windows now survives an update and the move from 1.x (the uninstaller keeps it on --updated, and the app puts the entry back at start when it is missing, leaving a disable made in Windows alone: the N2 review gate's G-1); pins (3), (10) deliberately changed, (R7), (U1)-(U4), update-plan tests (native apps 2.0, Session N3, spec §7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 36: Windows end to end on this PC (D8), every suite, the Results

**Files:** scratch only (`$SP`), nothing committed but this plan's Results.

- [ ] **Step 1: The scratch tools.** Write each into `$SP` as below.

`$SP/mkenv3.py` (the local POS env, a fresh database, port 3110; prints no value):

```python
# Session N3: writes <dir>/n3.env for the local POS the Windows app opens: a fresh database (pos_scratch_e2e_n3s) and
# port 3110, from the kept e2e.env. Prints no value. usage: python mkenv3.py <dir>
import io
import os
import sys

out_dir = sys.argv[1]
src = io.open(r"D:\kd\pos-dev-keep\env\e2e.env", encoding="utf-8").read()
out = []
for line in src.splitlines():
    if line.startswith("MONGODB_URI="):
        line = "MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_e2e_n3s"
    elif line.startswith("NEXTAUTH_URL="):
        line = "NEXTAUTH_URL=http://localhost:3110"
    out.append(line)
io.open(os.path.join(out_dir, "n3.env"), "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
print("n3.env keys:", ", ".join(l.split("=", 1)[0] for l in out if "=" in l))
```

`$SP/n3-files.mjs` (the fake files.sandbee.in on 127.0.0.1:8766):

```js
// Native apps 2.0, Session N3 (Windows end to end): a fake files.sandbee.in on 127.0.0.1:8766. It serves
// /pos/windows/latest.yml, the installer and its blockmap from one electron-builder output folder at a time, answers
// /api/health with 404 (a server that is not a POS), and logs every request. Switch the folder with
// GET /__serve?dir=<absolute folder>; serve nothing with GET /__serve?dir=none. Local only; scratch, never committed.
// usage: node n3-files.mjs <log file>
import { appendFileSync, createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join } from "node:path";

const [logPath] = process.argv.slice(2);
let dir = null;

function log(text) {
  appendFileSync(logPath, new Date().toISOString() + " " + text + "\n");
}

createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:8766");
  if (url.pathname === "/__serve") {
    const next = url.searchParams.get("dir");
    dir = next && next !== "none" ? next : null;
    log("SERVE " + (dir ?? "none"));
    res.end((dir ?? "none") + "\n");
    return;
  }
  log(req.method + " " + url.pathname + (req.headers.range ? " range " + req.headers.range : ""));
  const prefix = "/pos/windows/";
  if (dir !== null && url.pathname.startsWith(prefix)) {
    const name = decodeURIComponent(url.pathname.slice(prefix.length));
    const file = join(dir, name);
    if (name === basename(name) && existsSync(file) && statSync(file).isFile()) {
      const size = statSync(file).size;
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : size - 1;
        res.writeHead(206, { "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1), "accept-ranges": "bytes" });
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { "content-length": String(size), "accept-ranges": "bytes" });
      createReadStream(file).pipe(res).on("finish", () => log("sent " + name + " (" + size + " bytes)"));
      return;
    }
  }
  res.writeHead(404, { "content-type": "text/html" });
  res.end("<html><body>404 Not Found</body></html>");
}).listen(8766, "127.0.0.1", () => log("listening"));
```

`$SP/n3-builds.sh` (three test installers, 2.0.0 / 2.0.1 / 2.0.2, the test publish url, output in `$SP`):

```bash
#!/bin/bash
# The N2 gate (Session N3 Task 36 pre-run): three test installers of the gold desktop app, 2.0.0 / 2.0.1 / 2.0.2, each
# with the test publish url http://127.0.0.1:8766/pos/windows; output outside apps/desktop/dist. Local only, released to
# nobody. usage: n3-builds.sh <desktop dir> <out dir>
DESK="$1"; OUT="$2"; mkdir -p "$OUT"; S="$OUT/build.txt"; : > "$S"
cd "$DESK" || exit 2
echo "start $(date -Is) head $(git rev-parse --short HEAD)" >> "$S"
npm run build > "$OUT/tsc.log" 2>&1; echo "tsc exit=$?" >> "$S"
OUTW="$(cygpath -w "$OUT")"
for v in 2.0.0 2.0.1 2.0.2; do
  env -u ELECTRON_RUN_AS_NODE npx electron-builder --win nsis --publish never "-c.directories.output=$OUTW\\$v" \
    "-c.publish.url=http://127.0.0.1:8766/pos/windows" "-c.extraMetadata.version=$v" > "$OUT/eb-$v.log" 2>&1
  echo "$v exit=$?" >> "$S"
  ls -la "$OUT/$v" >> "$S" 2>&1
  cat "$OUT/$v/win-unpacked/resources/app-update.yml" >> "$S" 2>&1
  cat "$OUT/$v/latest.yml" >> "$S" 2>&1
done
echo "DONE $(date -Is)" >> "$S"
```

`$SP/n3-e2e.mjs` (drives the installed app with playwright-core's Electron support, one step per run):

```js
// Native apps 2.0, Session N3 Task 36 (the N2 gate's pre-run): drives the INSTALLED Windows app with playwright-core's
// Electron support (no global keys or clicks on the desktop), one step per run. Local only: the app points at the local
// POS (http://localhost:3110) or at local test addresses; bare names resolve nowhere (--host-resolver-rules).
// usage: node n3-e2e.mjs <exe> <shots dir> <step> [args]
//   steps: first-run-old <address>   (1.x window: type, "Use this address", wait for the POS page, quit)
//          start                     (launch, wait for the POS page, print version + menu labels, quit)
//          address                   (Change POS address…: the cases, screenshots, then http://localhost:3110)
//          wait-update <version> <log file>  (launch, wait for "<version> is ready" in the app log, print menu, keep running
//                                     until <action>: restart | quit)
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const require = createRequire("C:/Users/Kartik.desai/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright-core/package.json");
const { _electron } = require("playwright-core");

const [exe, shots, step, ...rest] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const RESOLVER = "--host-resolver-rules=MAP *.sandbee.in ~NOTFOUND";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const app = await _electron.launch({ executablePath: exe, args: [RESOLVER], env, timeout: 60_000 });
  app.process().stderr?.on("data", () => undefined);
  return app;
}

async function windowWith(app, test, ms = 30_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    for (const w of app.windows()) {
      if (test(w.url())) return w;
    }
    await sleep(250);
  }
  throw new Error("no window: " + app.windows().map((w) => w.url()).join(", "));
}

const isUrlWindow = (u) => u.startsWith("file:") && u.includes("url-window.html");
const isPos = (u) => u.startsWith("http://localhost:3110/");

async function menuLabels(app) {
  return app.evaluate(({ Menu }) => {
    const out = [];
    const walk = (items) => items.forEach((i) => { if (i.label) out.push(i.label); if (i.submenu) walk(i.submenu.items); });
    walk(Menu.getApplicationMenu()?.items ?? []);
    return out;
  });
}

async function clickMenu(app, label) {
  const ok = await app.evaluate(({ Menu }, wanted) => {
    const find = (items) => { for (const i of items) { if (i.label === wanted) return i; if (i.submenu) { const f = find(i.submenu.items); if (f) return f; } } return null; };
    const item = find(Menu.getApplicationMenu()?.items ?? []);
    if (!item) return false;
    item.click();
    return true;
  }, label);
  if (!ok) throw new Error("no menu item " + label);
}

async function quit(app) {
  const exited = new Promise((r) => app.process().once("exit", r));
  await app.evaluate(({ app: a }) => a.quit()).catch(() => undefined);
  await Promise.race([exited, sleep(20_000)]);
}

async function tryAddress(win, value, name) {
  await win.fill("#address", value);
  await win.click("#save");
  // "Connecting…" while checked, then the answer (or the window closes when saved).
  const answer = await win.waitForFunction(() => document.getElementById("save-label")?.textContent === "Open POS" && document.getElementById("hint-title")?.textContent === "Check the address", null, { timeout: 15_000 }).then(() => "error", () => "no error");
  const text = answer === "error" ? await win.textContent("#error") : "";
  await win.screenshot({ path: path.join(shots, name + ".png") });
  console.log(`${name}: typed ${JSON.stringify(value)} -> ${answer}: ${text}`);
}

if (step === "first-run-old") {
  const app = await launch();
  const win = await windowWith(app, isUrlWindow);
  await win.screenshot({ path: path.join(shots, "old-first-run.png") });
  await win.fill("#address", rest[0]);
  await win.click("#save");
  const pos = await windowWith(app, isPos);
  await pos.waitForLoadState("load");
  await sleep(3000);
  console.log("POS page: " + pos.url() + " version " + (await app.evaluate(({ app: a }) => a.getVersion())));
  await quit(app);
} else if (step === "start") {
  const app = await launch();
  const pos = await windowWith(app, isPos);
  await pos.waitForLoadState("load");
  await sleep(3000);
  console.log("version " + (await app.evaluate(({ app: a }) => a.getVersion())) + "; POS page " + pos.url());
  console.log("menu: " + JSON.stringify(await menuLabels(app)));
  await quit(app);
} else if (step === "address") {
  const app = await launch();
  const pos = await windowWith(app, isPos);
  await pos.waitForLoadState("load");
  await clickMenu(app, "Change POS address…");
  const win = await windowWith(app, isUrlWindow);
  await win.waitForLoadState("load");
  await sleep(500);
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.getTitle() === "POS address").map((w) => ({ content: w.getContentSize(), resizable: w.isResizable() })));
  console.log("window: " + JSON.stringify(size) + " footer: " + (await win.textContent("#product")) + " cancel visible: " + (await win.isVisible("#cancel")) + " value: " + (await win.inputValue("#address")));
  await win.screenshot({ path: path.join(shots, "a0-change.png") });
  await tryAddress(win, " MyCafe ", "a1-bare-name");
  await tryAddress(win, "http://127.0.0.1:8766", "a2-not-a-pos");
  await tryAddress(win, "http://127.0.0.1:9", "a3-no-answer");
  await tryAddress(win, "http://8.8.8.8", "a4-http-rule");
  await win.press("#address", "Escape").catch(() => undefined); // the window closes under the key
  await sleep(1000);
  console.log("Esc closed the window: " + !app.windows().some((w) => isUrlWindow(w.url())));
  await clickMenu(app, "Change POS address…");
  const again = await windowWith(app, isUrlWindow);
  await again.waitForLoadState("load");
  await again.fill("#address", "http://localhost:3110");
  await again.click("#save");
  await sleep(4000);
  console.log("saved http://localhost:3110: window closed " + !app.windows().some((w) => isUrlWindow(w.url())) + "; POS " + (await windowWith(app, isPos)).url());
  await quit(app);
} else if (step === "wait-update") {
  const [version, logFile, action] = rest;
  const app = await launch();
  const pos = await windowWith(app, isPos);
  await pos.waitForLoadState("load");
  const started = Date.now();
  const needle = `updater: ${version} is ready; notified`;
  while (!(existsSync(logFile) && readFileSync(logFile, "utf8").includes(needle))) {
    if (Date.now() - started > 240_000) throw new Error("no " + needle);
    await sleep(1000);
  }
  console.log(`"${needle}" after ${Math.round((Date.now() - started) / 1000)} s`);
  try {
    execFileSync("powershell", ["-NoProfile", "-File", path.join(HERE, "corner-shot.ps1"), path.join(shots, `toast-${version}.png`)], { stdio: "inherit" });
  } catch {
    console.log("corner screenshot failed");
  }
  console.log("menu: " + JSON.stringify(await menuLabels(app)));
  if (action === "restart") {
    const exited = new Promise((r) => app.process().once("exit", r));
    await clickMenu(app, "Restart to update");
    await Promise.race([exited, sleep(30_000)]);
    console.log("Restart to update: the app exited");
  } else {
    await quit(app);
    console.log("Quit: the app exited");
  }
} else {
  throw new Error("unknown step " + step);
}
```

(It loads playwright-core from this PC's npx cache, `_npx/9833c18b2d85bc59` (1.64.0-alpha, present at the gate); if
that folder is gone, run `npx -y playwright-core --version` once and put the new `_npx/<hash>` path into the script.)

`$SP/corner-shot.ps1` (a screenshot of the notification corner only):

```powershell
# The N2 gate (Session N3 Task 36): a screenshot of the bottom-right corner of the primary screen only, where Windows
# shows a notification; nothing else of the desktop is kept. usage: corner-shot.ps1 <png>
param([Parameter(Mandatory = $true)][string]$Out)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$w = 520; $h = 360
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Right - $w, $screen.Bottom - $h, 0, 0, (New-Object System.Drawing.Size $w, $h))
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "corner shot: $Out"
```

- [ ] **Step 2: Check first, and the owner's leftovers** (PowerShell):

```powershell
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'POS Software*' } | Select-Object DisplayName, DisplayVersion
'Run: [' + (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -ErrorAction SilentlyContinue).'com.possoftware.pos-desktop' + ']'
foreach ($p in @((Join-Path $env:APPDATA 'POS Software by sandbee'), (Join-Path $env:LOCALAPPDATA 'pos-desktop-updater'), 'D:\kd\pos-dev-keep\win-test')) { $p + ' exists=' + (Test-Path -LiteralPath $p) }
```
Expected, as at the gate: no "POS Software" uninstall entry, `Run: []`, no `win-test`; **the two folders exist** (the
owner's own leftovers of 12 Oct: user data whose address is the live demo, and a 1.12.0 `installer.exe` of 10 Oct). The
owner allowed (2026-10-13) renaming them for this test and renaming them back after it: `Rename-Item` each to
`<name>.n3-backup` (PowerShell, `-LiteralPath`), list both backups. If they are absent, skip the rename here and the
rename back in Step 8. If anything else is found (an installed app, a Run value), stop and ask.

- [ ] **Step 3: Build the three installers** (background; wait for `DONE` in `$SP/n3-dist/build.txt`):
`bash "$SP/n3-builds.sh" /d/kd/lucifer/apps/desktop "$SP/n3-dist"`. Expected: `tsc exit=0`, then for each of 2.0.0,
2.0.1, 2.0.2 `exit=0`, `POS-Software-Setup-<v>.exe` (about 112.5 MB), its `.blockmap`, `latest.yml` (`version: <v>`), and
`win-unpacked/resources/app-update.yml` with `provider: generic`, `url: http://127.0.0.1:8766/pos/windows`,
`updaterCacheDirName: pos-desktop-updater`.

- [ ] **Step 4: The local POS and the fake files server**

```bash
python -X utf8 "$SP/mkenv3.py" "$(cygpath -w "$SP")"
netstat -ano | grep LISTEN | grep -E ":(3110|8766) "
```
Expected: `n3.env keys: MONGODB_URI, NEXTAUTH_SECRET, AUTH_SECRET, NEXTAUTH_URL, AUTH_TRUST_HOST, SEED_ADMIN_USERNAME,
SEED_ADMIN_PASSWORD`; nothing listening. Then, each in the background: `cd /d/kd/lucifer/apps/cafe && MSYS_NO_PATHCONV=1 node --env-file="$(cygpath -w "$SP")/n3.env" ../../node_modules/next/dist/bin/next start -p 3110 > "$SP/next-n3.log" 2>&1`
and `node "$SP/n3-files.mjs" "$(cygpath -w "$SP")/files-n3.log"`. Expected: `curl -s http://localhost:3110/api/health` →
`{"ok":true,"db":"up","tenant":"dev",…}`; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8766/api/health` → `404`.
(`apps/cafe/.next` must exist; if it does not, stop and report: building the cafe app is not part of N3. The local
mongod must be running: a stopped one makes the POS answer 503, still "found" by the window's check but not this
Expected. If 3110 or 8766 already listen, stop and report; never stop another program's process.)

- [ ] **Step 5: The move from 1.12.0** (PowerShell for the installers; `E2E=$SP/n3-e2e.mjs`, `EXE="D:/kd/pos-dev-keep/win-test/POS Software by sandbee.exe"`, `SHOTS="$(cygpath -w "$SP")/shots-win"`):
1. Hash `D:\kd\pos-apk-release\Sandbee-POS-phase3\POS-Software-Setup-1.12.0.exe` against its `SHA256SUMS.txt`
   (`060d8d84…`), then `Start-Process <it> -ArgumentList '/S','/D=D:\kd\pos-dev-keep\win-test' -Wait -PassThru` → exit 0,
   the exe's `VersionInfo.FileVersion` 1.12.0.
2. `node "$E2E" "$EXE" "$SHOTS" first-run-old http://localhost:3110` → `POS page: http://localhost:3110/login version 1.12.0`;
   the Run value `"D:\kd\pos-dev-keep\win-test\POS Software by sandbee.exe" --hidden`.
3. Install `$SP\n3-dist\2.0.0\POS-Software-Setup-2.0.0.exe` the same way → exit 0, FileVersion 2.0.0, **the Run value
   gone** (1.12.0's uninstaller ran with `--updated`), `resources\app-update.yml` the test url.
4. `node "$E2E" "$EXE" "$SHOTS" start` → `version 2.0.0; POS page http://localhost:3110/login`, the menu `["Help","Open POS","Reload","Change POS address…","Start with Windows","About POS Software by sandbee","Quit"]`; **the Run value back**.

- [ ] **Step 6: The address window:** `node "$E2E" "$EXE" "$SHOTS" address`. Expected, as at the gate:
```text
window: [{"content":[480,666],"resizable":false}] footer: POS Software by sandbee · 2.0.0 cancel visible: true value: http://localhost:3110
a1-bare-name: typed " MyCafe " -> error: Couldn't reach mycafe.sandbee.in. Check the internet connection.
a2-not-a-pos: typed "http://127.0.0.1:8766" -> error: We couldn't find a POS at 127.0.0.1:8766. Check the name.
a3-no-answer: typed "http://127.0.0.1:9" -> error: Couldn't reach 127.0.0.1:9. Check the internet connection.
a4-http-rule: typed "http://8.8.8.8" -> error: http:// only works for this device or a computer on your own network. Use https:// for any other address.
Esc closed the window: true
saved http://localhost:3110: window closed true; POS http://localhost:3110/login
```
(The window's content measured 480 × 666 on this PC; a different display may give a few pixels more or less.)
`files-n3.log` gets exactly one `GET /api/health` (the 127.0.0.1:8766 case); the app log
(`%APPDATA%\POS Software by sandbee\pos-desktop.log`) three "address check: not saved" lines, then "address check:
found" (the http://8.8.8.8 case is refused before any check). Look at `a0-change`, `a1-bare-name`, `a2-not-a-pos`,
`a3-no-answer`.

- [ ] **Step 7: The updater.** `LOG="$(cygpath -w "$APPDATA/POS Software by sandbee/pos-desktop.log")"`.
1. `curl -s "http://127.0.0.1:8766/__serve?dir=$(cygpath -m "$SP/n3-dist/2.0.1")"`, then
   `node "$E2E" "$EXE" "$SHOTS" wait-update 2.0.1 "$LOG" restart`. Expected: `"updater: 2.0.1 is ready; notified" after
   61 s` (the look one minute after start), the corner shot shows the notification "Update ready" / "POS Software 2.0.1
   is ready. It installs when you close the app.", the menu with `"Restart to update"` before `"Quit"`, `Restart to
   update: the app exited`; the app log: `Install on explicit quitAndInstall`, `isSilent: true, isForceRunAfter: true`,
   `--updated,/S,--force-run`. About 20 s later: FileVersion 2.0.1, the app running again with `--updated` (its
   renderer has `--pos-desktop-version=2.0.1`), the Run value kept, the store's address and `autoStart` kept. Stop that
   process by its PID (PowerShell, after checking its path is `win-test`).
2. Serve `2.0.2` the same way, then `… wait-update 2.0.2 "$LOG" quit`. Expected: `2.0.2 is ready; notified after 61 s`,
   `Quit: the app exited`; the app log `Auto install update on quit`, `isForceRunAfter: false`, `--updated,/S`; about
   15 s later FileVersion 2.0.2 and **no process running** (no restart); the Run value kept.
3. `curl -s "http://127.0.0.1:8766/__serve?dir=none"`, then `node "$E2E" "$EXE" "$SHOTS" start` → `version 2.0.2`, the
   menu without Restart to update.
(electron-updater tries a differential download first; the fake server does not serve the old blockmap or multi-range
requests, so it falls back to the full installer: an `ERROR updater: Cannot download differentially, fallback to full
download` line is expected.)

- [ ] **Step 8: Uninstall and put everything back.** `Start-Process 'D:\kd\pos-dev-keep\win-test\Uninstall POS Software by sandbee.exe' -ArgumentList '/S' -Wait`
→ exit 0; the NSIS uninstaller re-launches itself from `%TEMP%`, so poll up to 30 s until `win-test` and the uninstall
entry are gone; the Run value gone (a real uninstall removes it). Then remove the test's
own `%LOCALAPPDATA%\pos-desktop-updater` and `%APPDATA%\POS Software by sandbee` (`Remove-Item -LiteralPath '<literal
path>' -Recurse -Force`, one per command), rename both `.n3-backup` folders back, and check: the user data's
`pos-desktop.json` address is the owner's again (the live demo; read only), `installer.exe` 10/10/2026 112,216,876 B, no
Run value. Stop this session's `next start` and fake server by their PIDs after checking their command lines; the
scratch database `pos_scratch_e2e_n3s` stays.

- [ ] **Step 9: Every suite** (as Task 30 Step 1). Expected: mobile 168, typecheck and lint clean, Jest 8 (4 suites);
desktop 211; cafe 5656 (5655 pass, 0 fail, 1 skipped); JUnit `tests=94 failures=0 errors=0`.

- [ ] **Step 10: Results and commit.** Append `## Session N3 Results` to this plan (the counts, the commits, each step's
evidence, the installer hashes, anything that differed and why) and commit (`$SP/msg-n3-6.txt`):

```text
docs(apps): native apps 2.0 Session N3 results: the Windows app's address window and updater, its end to end on this PC (the move from 1.12.0, Restart to update, install on quit, the uninstall) and every suite recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
Update the project memory (`native-apps-2-2026-10.md` and its MEMORY.md line). No push unless the session prompt says so.
Report to the owner in Hinglish.

---

# Session N4 (exact): the N3 review's minors, the release folder, the docs, the 2.0.0 set and the final review

Made exact at the N3 review gate (2026-10-13, section "N3 review gate" at the end of this plan). Sessions N1–N3 are in
`main` since `543b193` (the owner's merge OK of 2026-10-13, pushed); this branch was fast-forwarded to it, so Session N4
starts from `543b193`. Every code and doc block below was written and run in the gold worktree (`D:\kd\n2g`, detached
at `543b193`): tasks 40–42 as three commits (`2e16409`, `0b2c4ad`, `8f6652f`; branch `gold-n4`; Tasks 41 and 42
amended with the gate review's findings, first `94c0866`, `8c6661b`), the last whole tree
`43524fee05e94b6ecbfc37d73216560482f1ddfc`; the blocks were generated from those commits, then applied step by step on
the gold worktree reset to `543b193` (each find matched exactly once, every task's whole tree came out identical, and
every Expected below is that run's output). The gate pre-ran Task 44: the builds (the private key, the real base), the
packaging into a scratch folder (and its refusals on real wrong files), and the emulator smoke (the one-time move from
the debug-key 1.0 to 2.0.0, sign-in, a test print, then Cancel in Android's dialog with test APKs).

Acceptance: `node scripts/release-native.mjs` turns the built APK pair and the Windows installer into
`D:\kd\pos-apk-release\Sandbee-POS-2.0.0\` (the bucket's keys, `SHA256SUMS.txt`, `UPLOAD-STEPS.txt`) and refuses a
release built the wrong way; GO-LIVE says how each cafe moves to 2.0.0 once and what staff see from then on; the 2.0.0
set is built and smoke-tested; a fresh review passes; nothing is uploaded or released (the owner uploads by hand).

**Changes from the spec version of N4** (the gate's rulings; reasons in the gate section):
- Task 40 is new: the N3 review's minors as ruled. m-2: the owner's words (2026-10-13) for no answer, "Couldn't reach
  <host>. Check the name and the internet connection." (spec §9 amended at the gate); m-4 pin (3)'s comment; m-5 a JUnit
  message; m-6 the updater's one error line names electron-updater's code; m-1 a note at `allowPrerelease` (the
  generic provider ignores it; Task 41 refuses a prerelease version). m-3 and m-7 stand.
- Task 41: `--out` (default `D:\kd\pos-apk-release`) so a test can write elsewhere; apksigner runs as
  `java -jar <build-tools>\lib\apksigner.jar` (no `.bat` from Node); every check runs before anything is written; the
  version is `apps/desktop/package.json`'s and must equal `posVersionRelease`; a version with a prerelease part is
  refused (m-1); `SHA256SUMS.txt` lists the files under `upload\` in `sha256sum --binary` format; 12 tests, among them the
  whole folder from fake APKs and a fake installer with fake tools, and 24 refusals that write nothing. The gate's review
  added: the folder is written as `Sandbee-POS-<version>.partial` and renamed when complete (a leftover `.partial` is
  refused); a version lower than an already packaged `Sandbee-POS-x.y.z` is refused (spec §5); a missing tool is named
  (java from `JAVA_HOME` when set), never read as a bad signature; two signers, a missing `app-update.yml` and a
  `latest.yml` naming another file are refusal rows; `UPLOAD-STEPS.txt` also says how to check a hash in PowerShell.
- Task 42: no fenced code blocks inside the new README text (the block applier ends a block at a fence line), so the
  commands are inline code; a new `apps/desktop/README.md`; §A gets four update facts; five new runbook pins and the §7
  desktop pin quotes "Restart to update".
- Task 44: the release notes are the owner's (2026-10-13): "Sandbee POS now updates itself. You will see a card like
  this when a new version is ready."; `files.sandbee.in` has no DNS record yet (NXDOMAIN at the gate), so the release
  APK's look logs `check: no answer` and no request reaches anyone; the smoke's Cancel uses test APKs A/B.

**Expected counts** (baseline = `543b193`): mobile `npm test` 168 → **168**, Jest **8**, JUnit 94 → **94**, desktop
211 → **211**, `npm run test:release-native` (new) → **12**, the cafe chain 5802 (5801 pass, 0 fail, 1 skipped) →
**5807** (5806 pass, 0 fail, 1 skipped; the go-live runbook 97 → 102), typecheck and lint clean in mobile, desktop and
cafe.

Work in `D:\kd\lucifer` on `feat/native-apps-2`; `$SP` is the session's scratchpad. Always
`GRADLE_USER_HOME='D:\gradle-home'`. Tasks are numbered 40–45 (Session N4 = 4x), so `task-start <plan> 41` brings only
this session's task. Apply a step's blocks with `D:\kd\pos-dev-keep\phase3-final-gate\apply_blocks_clone.py` (a dry run
first). Every commit message goes in a scratch file and is committed with `git commit -F`; the messages below end with
the Co-Authored-By line the N4 prompt gives (Claude Opus 5.5); if a session's prompt gives another, its line wins. Desktop
pin runs carry `timeout`.

### Task 40: The N3 review's minors

**Files:**
- Modify: `apps/desktop/src/pos-health.ts` (`unreachableError`), `apps/desktop/src/updater.ts` (`errorCode`, the `allowPrerelease` note)
- Test: `apps/desktop/src/pos-health.test.ts` (the words), `src/desktop-paths.test.ts` ((U2)'s error line; pin (3)'s comment), `UpdateFilesTest.kt` (a message)

**Interfaces:** `unreachableError(host)` → `Couldn't reach <host>. Check the name and the internet connection.`; `updater.ts` `errorCode(error): string` (electron-updater's `code`, else the error's name).

- [ ] **Step 1: Check the branch, the disks and every suite**

```bash
cd /d/kd/lucifer && git status --short && git branch --show-current && git log --oneline -3 && df -h /c /d
cd /d/kd/lucifer/apps/mobile && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "mobile typecheck and lint clean" && npx jest 2>&1 | grep -E "^Tests:"
cd /d/kd/lucifer/apps/desktop && timeout 250 npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "desktop typecheck and lint clean"
cd /d/kd/lucifer/apps/cafe && npm test > "$SP/cafe-base.log" 2>&1; grep -E "^# (tests|pass|fail|skipped)" "$SP/cafe-base.log"
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --rerun --console=plain > "$SP/junit-base.log" 2>&1; tail -3 "$SP/junit-base.log"
cat app/build/test-results/testDebugUnitTest/*.xml | grep -o '<testsuite [^>]*' | sed -E 's/.*tests="([0-9]+)".*failures="([0-9]+)".*errors="([0-9]+)".*/\1 \2 \3/' | awk '{t+=$1; f+=$2; e+=$3} END {print "tests="t" failures="f" errors="e}'
```
Expected: clean, `feat/native-apps-2`, this gate's plan commit on top of `543b193`; mobile 168/168, typecheck and lint
clean, Jest `Tests: 8 passed`; desktop 211/211, typecheck and lint clean; cafe `# tests 5802`, `# pass 5801`, `# fail 0`,
`# skipped 1`; JUnit `tests=94 failures=0 errors=0`. The cafe chain takes a few minutes: run it in the background and
wait for its log with an until-loop. D: needs about 1 GB free for this session's builds and the release folder.

- [ ] **Step 2: Write the failing tests**

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
});

// Native apps 2.0 Session N3 deliberately changed: a third call sets start-with-Windows again at every start (U4).
test("(3) main.ts: setLoginItemSettings called exactly three times, all with args: [HIDDEN_FLAG]", () => {
  const calls = mainSrc.match(/setLoginItemSettings\(/g) ?? [];
```

Replace it with:

```ts
});

// Native apps 2.0 Session N3 deliberately changed: a third call puts start-with-Windows back at a start when its entry
// is missing and the operator chose it (U4; the N3 review's m-4).
test("(3) main.ts: setLoginItemSettings called exactly three times, all with args: [HIDDEN_FLAG]", () => {
  const calls = mainSrc.match(/setLoginItemSettings\(/g) ?? [];
```

In `apps/desktop/src/desktop-paths.test.ts`, find:

```ts
    "const first = setTimeout(check, FIRST_CHECK_MS);",
    "const every = setInterval(check, CHECK_EVERY_MS);",
    'autoUpdater.on("error", (error) => deps.log.error(`updater: ${error.name}`));',
    "const notice = noticeFor(notified, info.version);",
  ]) {
```

Replace it with:

```ts
    "const first = setTimeout(check, FIRST_CHECK_MS);",
    "const every = setInterval(check, CHECK_EVERY_MS);",
    // The N3 review gate (the review's m-6): the one error line names electron-updater's code (ERR_UPDATER_…).
    'autoUpdater.on("error", (error) => deps.log.error(`updater: ${errorCode(error)}`));',
    'return typeof code === "string" ? code : error.name;',
    "const notice = noticeFor(notified, info.version);",
  ]) {
```

In `apps/desktop/src/pos-health.test.ts`, find:

```ts
const json = (value: unknown) => () => Promise.resolve(value);
const NOT_FOUND = "We couldn't find a POS at mycafe.sandbee.in. Check the name.";
const UNREACHABLE = "Couldn't reach mycafe.sandbee.in. Check the internet connection.";

test("a POS whose database is up (200, its tenant named) is found, in one GET of /api/health that follows no redirect", async () => {
```

Replace it with:

```ts
const json = (value: unknown) => () => Promise.resolve(value);
const NOT_FOUND = "We couldn't find a POS at mycafe.sandbee.in. Check the name.";
// The N3 review gate (the review's m-2, the owner's ruling of 2026-10-13): a mistyped workspace name has no answer
// either, so the words name both causes.
const UNREACHABLE = "Couldn't reach mycafe.sandbee.in. Check the name and the internet connection.";

test("a POS whose database is up (200, its tenant named) is found, in one GET of /api/health that follows no redirect", async () => {
```

In `apps/mobile/android/app/src/test/java/com/possoftware/pos/update/UpdateFilesTest.kt`, find:

```kotlin
  @Test
  fun aKeptFileHashesToTheManifestsSha256() {
    assertEquals(sha, UpdateFiles.sha256Of(ByteArrayInputStream(apk)))
  }

```

Replace it with:

```kotlin
  @Test
  fun aKeptFileHashesToTheManifestsSha256() {
    assertEquals("the manifest's SHA-256", sha, UpdateFiles.sha256Of(ByteArrayInputStream(apk)))
  }

```

- [ ] **Step 3: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/desktop && timeout 250 node --import tsx --test src/pos-health.test.ts src/desktop-paths.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"
```
Expected: `not ok … (U2) updater.ts: download in the background, …`, `not ok … no answer at all (a network error) is not
reached`, `not ok … no answer in time is not reached, and the request is aborted`; `# tests 82`, `# pass 79`, `# fail 3`.
(The JUnit message and the comment change nothing that runs.)

- [ ] **Step 4: Implement**

In `apps/desktop/src/pos-health.ts`, find:

```ts
}

export function unreachableError(host: string): string {
  return `Couldn't reach ${host}. Check the internet connection.`;
}

```

Replace it with:

```ts
}

/** No answer: the internet, or a mistyped workspace name (no such name answers either; the N3 review gate, the owner's
 *  ruling of 2026-10-13). */
export function unreachableError(host: string): string {
  return `Couldn't reach ${host}. Check the name and the internet connection.`;
}

```

In `apps/desktop/src/updater.ts`, find:

```ts
}

/** Starts the checks; returns what stops them (the app's before-quit). */
export function startUpdater(deps: UpdaterDeps): () => void {
```

Replace it with:

```ts
}

/** electron-updater's errors carry a code (ERR_UPDATER_…): the one log line names it, the logger has the detail (the N3
 *  review's m-6). */
function errorCode(error: Error): string {
  const { code } = error as Error & { code?: unknown };
  return typeof code === "string" ? code : error.name;
}

/** Starts the checks; returns what stops them (the app's before-quit). */
export function startUpdater(deps: UpdaterDeps): () => void {
```

In `apps/desktop/src/updater.ts`, find:

```ts
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
```

Replace it with:

```ts
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  // The generic provider does not read allowPrerelease (only the GitHub ones do): the release packaging refuses a
  // version with a prerelease part instead (scripts/release-native.mjs; the N3 review's m-1).
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
```

In `apps/desktop/src/updater.ts`, find:

```ts
    new Notification({ title: notice.title, body: notice.body }).show();
  });
  autoUpdater.on("error", (error) => deps.log.error(`updater: ${error.name}`));
  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => undefined);
```

Replace it with:

```ts
    new Notification({ title: notice.title, body: notice.body }).show();
  });
  autoUpdater.on("error", (error) => deps.log.error(`updater: ${errorCode(error)}`));
  const check = (): void => {
    autoUpdater.checkForUpdates().catch(() => undefined);
```

- [ ] **Step 5: Run them and see them pass, with JUnit**

```bash
cd /d/kd/lucifer/apps/desktop && timeout 250 npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)" && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "typecheck and lint clean"
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --rerun --console=plain 2>&1 | grep -E "^BUILD|FAILED" | sed -E 's/ in [0-9hms ]+$//'
cat app/build/test-results/testDebugUnitTest/*.xml | grep -o '<testsuite [^>]*' | sed -E 's/.*tests="([0-9]+)".*failures="([0-9]+)".*errors="([0-9]+)".*/\1 \2 \3/' | awk '{t+=$1; f+=$2; e+=$3} END {print "tests="t" failures="f" errors="e}'
```
Expected: `# tests 211`, `# pass 211`, `# fail 0`, `typecheck and lint clean`; `BUILD SUCCESSFUL`;
`tests=94 failures=0 errors=0`.

- [ ] **Step 6: Commit** (`$SP/msg-n4-0.txt`):

```text
fix(apps): the N3 review's minors as ruled at its gate: the address window's no-answer words name both causes ("Couldn't reach <host>. Check the name and the internet connection.", the owner's ruling of 2026-10-13), the updater's one error line names electron-updater's code, a note that the generic provider ignores allowPrerelease (the packaging refuses a prerelease instead), pin (3)'s comment and a JUnit message (native apps 2.0, Session N4, the N3 review gate)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 41: `scripts/release-native.mjs`

**Files:**
- Create: `scripts/release-native.mjs`; Test: `scripts/release-native.test.mjs` (12 tests)
- Modify: `package.json` (root script `test:release-native`)

**Interfaces:** `node scripts/release-native.mjs --arm64 <apk> --armv7 <apk> --windows <folder> --notes "<text>" [--released YYYY-MM-DD] [--out <folder>]`; exports `packageRelease(opts, tools)` (throws `Refused` before writing anything), `versionCode`, `apkName`, `installerName`, `buildManifest`, `manifestProblems`, `readLatestYml`, `readAppUpdateYml`, `signerDigests`, `readBadging`, `resourceValue`, `uploadSteps`, `repoVersion`, `parseArgs`, `realTools`, `EXPECTED_CERT_SHA256`.

- [ ] **Step 1: Write the failing tests**

In `package.json`, find:

```json
    "test:go-live": "node --test scripts/go-live/lib.test.mjs scripts/go-live/run.test.mjs scripts/go-live/ui.test.mjs scripts/go-live/ui-pure.test.mjs scripts/go-live/rollout.test.mjs scripts/go-live/dns-check.test.mjs scripts/go-live/lock.test.mjs scripts/go-live/deploy-lock.test.mjs scripts/go-live/deploy-profile.test.mjs scripts/go-live/realtime.test.mjs",
    "test:print-tools": "node --test scripts/fake-escpos-printer.test.mjs",
    "deploy": "node scripts/deploy.mjs",
    "go-live": "node scripts/go-live/index.mjs",
```

Replace it with:

```json
    "test:go-live": "node --test scripts/go-live/lib.test.mjs scripts/go-live/run.test.mjs scripts/go-live/ui.test.mjs scripts/go-live/ui-pure.test.mjs scripts/go-live/rollout.test.mjs scripts/go-live/dns-check.test.mjs scripts/go-live/lock.test.mjs scripts/go-live/deploy-lock.test.mjs scripts/go-live/deploy-profile.test.mjs scripts/go-live/realtime.test.mjs",
    "test:print-tools": "node --test scripts/fake-escpos-printer.test.mjs",
    "test:release-native": "node --test scripts/release-native.test.mjs",
    "deploy": "node scripts/deploy.mjs",
    "go-live": "node scripts/go-live/index.mjs",
```

Create `scripts/release-native.test.mjs`:

```js
// Native apps 2.0 (spec §10, Session N4): the release folder. The pure parts on their own (the manifest by the app's
// rules, the version code, the names, electron-builder's files, the Android tools' outputs as this PC's build-tools 37
// print them, the upload steps), then the whole folder written from fake APKs and a fake installer with fake tools, and
// every way a release built wrong is refused before anything is written (Review Focus 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  apkName,
  buildManifest,
  EXPECTED_CERT_SHA256,
  installerName,
  manifestProblems,
  MAX_APK_BYTES,
  packageRelease,
  parseArgs,
  readAppUpdateYml,
  readBadging,
  readLatestYml,
  Refused,
  repoVersion,
  resourceValue,
  signerDigests,
  uploadSteps,
  versionCode,
} from "./release-native.mjs";

const SHA = "ab".repeat(32);

function scratch() {
  return mkdtempSync(path.join(os.tmpdir(), "release-native-test-"));
}

/** A valid 2.1.0 manifest as the script writes it; [edit] changes it. */
function manifest(edit = () => undefined) {
  const m = buildManifest({
    version: "2.1.0",
    released: "2026-11-02",
    notes: "Faster printing.",
    apks: {
      "arm64-v8a": { file: "Sandbee-POS-2.1.0-arm64-v8a.apk", sha256: SHA, size: 7_320_758 },
      "armeabi-v7a": { file: "Sandbee-POS-2.1.0-armeabi-v7a.apk", sha256: SHA, size: 6_728_592 },
    },
  });
  edit(m);
  return m;
}

test("a version code is major × 10000 + minor × 100 + patch; a prerelease or anything else is no version", () => {
  assert.equal(versionCode("2.0.0"), 20000, "2.0.0");
  assert.equal(versionCode("2.1.0"), 20100, "2.1.0");
  assert.equal(versionCode("10.99.99"), 109999, "10.99.99");
  for (const bad of ["2.100.0", "2.0", "v2.0.0", "2.1.0-rc.1", "2.0.0-test", "2.0.0 ", "", undefined]) {
    assert.equal(versionCode(bad), null, `no version: ${JSON.stringify(bad)}`);
  }
});

test("the files are named as the bucket's keys say (spec §4)", () => {
  assert.equal(apkName("2.0.0", "arm64-v8a"), "Sandbee-POS-2.0.0-arm64-v8a.apk", "the 64-bit APK");
  assert.equal(apkName("2.0.0", "armeabi-v7a"), "Sandbee-POS-2.0.0-armeabi-v7a.apk", "the 32-bit APK");
  assert.equal(installerName("2.0.0"), "POS-Software-Setup-2.0.0.exe", "the installer, as electron-builder names it");
});

test("the manifest the script writes is one the app accepts, in the spec's field order, with no notes field when there are none", () => {
  assert.deepEqual(manifestProblems(manifest()), [], "a release's manifest");
  assert.deepEqual(
    Object.keys(manifest()),
    ["schema", "package", "version", "versionCode", "released", "notes", "apks"],
    "the spec's order",
  );
  assert.equal(manifest().versionCode, 20100, "the code comes from the version");
  const none = buildManifest({ version: "2.1.0", released: "2026-11-02", notes: "", apks: manifest().apks });
  assert.equal("notes" in none, false, "empty notes are no field");
  assert.deepEqual(manifestProblems(none), [], "notes are optional");
});

test("every rule of the app's manifest reader (UpdateManifestTest's table) is a problem, by its own reason", () => {
  const cases = [
    ["schema", (m) => delete m.schema],
    ["schema", (m) => (m.schema = 2)],
    ["schema", (m) => (m.schema = "1")],
    ["package", (m) => (m.package = "com.example.other")],
    ["version", (m) => delete m.version],
    ["version", (m) => (m.version = "2.1")],
    ["version", (m) => (m.version = "2.100.0")],
    ["version", (m) => (m.version = "2.1.1")],
    ["versionCode", (m) => (m.versionCode = "20100")],
    ["versionCode", (m) => (m.versionCode = 20100.5)],
    ["released", (m) => delete m.released],
    ["released", (m) => (m.released = "02/11/2026")],
    ["notes", (m) => (m.notes = "x".repeat(301))],
    ["notes", (m) => (m.notes = 5)],
    ["apks", (m) => delete m.apks],
    ["apks", (m) => (m.apks = "Sandbee-POS-2.1.0-arm64-v8a.apk")],
    ["sha256 arm64-v8a", (m) => (m.apks["arm64-v8a"].sha256 = "ab".repeat(31) + "a")],
    ["sha256 arm64-v8a", (m) => (m.apks["arm64-v8a"].sha256 = "zz".repeat(32))],
    ["sha256 arm64-v8a", (m) => delete m.apks["arm64-v8a"].sha256],
    ["size arm64-v8a", (m) => (m.apks["arm64-v8a"].size = 0)],
    ["size arm64-v8a", (m) => (m.apks["arm64-v8a"].size = -1)],
    ["size arm64-v8a", (m) => (m.apks["arm64-v8a"].size = MAX_APK_BYTES + 1)],
    ["size arm64-v8a", (m) => (m.apks["arm64-v8a"].size = "7320758")],
    // The release's own rules: both CPU types, each file named for its version and CPU type.
    ["apk armeabi-v7a", (m) => delete m.apks["armeabi-v7a"]],
    ["file arm64-v8a", (m) => (m.apks["arm64-v8a"].file = "Sandbee-POS-2.0.0-arm64-v8a.apk")],
  ];
  for (const [reason, edit] of cases) {
    assert.deepEqual(manifestProblems(manifest(edit)), [reason], `${reason}: ${edit.toString()}`);
  }
  for (const file of ["../Sandbee.apk", "a/b.apk", "a\\b.apk", "https://evil.example/x.apk", "x.apk.exe", ".apk", "-x.apk", "x..apk", "", "x".repeat(100) + ".apk"]) {
    assert.deepEqual(manifestProblems(manifest((m) => (m.apks["arm64-v8a"].file = file))), ["file arm64-v8a"], `file ${file}`);
  }
  assert.deepEqual(manifestProblems(manifest((m) => (m.apks["arm64-v8a"].size = MAX_APK_BYTES))), [], "100 MB is allowed");
  assert.deepEqual(manifestProblems(manifest((m) => (m.notes = "x".repeat(300)))), [], "300 characters of notes are allowed");
  assert.deepEqual(manifestProblems(manifest((m) => (m.apks["arm64-v8a"].sha256 = SHA.toUpperCase()))), [], "the app reads an upper-case hash");
  assert.deepEqual(manifestProblems([1, 2]), ["not JSON"], "not a manifest");
});

// electron-builder 26.16.0's files for a 2.0.0 build (Session N3's test build, the release url).
const LATEST_YML = [
  "version: 2.0.0",
  "files:",
  "  - url: POS-Software-Setup-2.0.0.exe",
  "    sha512: Xo8ur19P7cVXc7K7kbnrZ/Bu4j6NAXrLQEUESJWHH9WUyKkYjiZpn3BUSFVKaL+/9atj2taJgNDsqWlOPC/7oA==",
  "    size: 112542296",
  "path: POS-Software-Setup-2.0.0.exe",
  "sha512: Xo8ur19P7cVXc7K7kbnrZ/Bu4j6NAXrLQEUESJWHH9WUyKkYjiZpn3BUSFVKaL+/9atj2taJgNDsqWlOPC/7oA==",
  "releaseDate: '2026-10-13T10:51:14.926Z'",
  "",
].join("\n");

test("electron-builder's latest.yml and app-update.yml are read as it writes them", () => {
  const sha512 = "Xo8ur19P7cVXc7K7kbnrZ/Bu4j6NAXrLQEUESJWHH9WUyKkYjiZpn3BUSFVKaL+/9atj2taJgNDsqWlOPC/7oA==";
  assert.deepEqual(
    readLatestYml(LATEST_YML),
    {
      version: "2.0.0",
      files: [{ url: "POS-Software-Setup-2.0.0.exe", sha512, size: 112542296 }],
      path: "POS-Software-Setup-2.0.0.exe",
      sha512,
      releaseDate: "2026-10-13T10:51:14.926Z",
    },
    "latest.yml",
  );
  assert.equal(readLatestYml(LATEST_YML.replace(/\n/g, "\r\n")).version, "2.0.0", "CRLF lines too");
  assert.deepEqual(
    readAppUpdateYml("provider: generic\nurl: https://files.sandbee.in/pos/windows\nupdaterCacheDirName: pos-desktop-updater\n"),
    { provider: "generic", url: "https://files.sandbee.in/pos/windows", updaterCacheDirName: "pos-desktop-updater" },
    "app-update.yml",
  );
});

// What build-tools 37 printed for the N3 gate's release APKs (excerpts).
const APKSIGNER_OUT = [
  "V2 Signer: certificate DN: CN=Sandbee POS, O=sandbee, C=IN",
  `V2 Signer: certificate SHA-256 digest: ${EXPECTED_CERT_SHA256}`,
  "V2 Signer: certificate SHA-1 digest: a690cc2614d486327962ed6f72f05605b4dc831c",
  "V2 Signer: certificate MD5 digest: 57b7122c5291362b5514c130594d682c",
  "",
].join("\n");

function badgingOut({ name = "com.possoftware.pos", code = 20000, version = "2.0.0", native = "'arm64-v8a'", debuggable = false } = {}) {
  return [
    `package: name='${name}' versionCode='${code}' versionName='${version}' platformBuildVersionName='17' platformBuildVersionCode='37' compileSdkVersion='37' compileSdkVersionCodename='17'`,
    "minSdkVersion:'24'",
    "targetSdkVersion:'36'",
    "uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'",
    "application-label:'Sandbee POS'",
    ...(debuggable ? ["application-debuggable"] : []),
    "densities: '160' '240' '320' '480' '640' '65534'",
    `native-code: ${native}`,
    "",
  ].join("\n");
}

function resourcesOut({ base = "https://files.sandbee.in/pos", check = 720, reopen = 30 } = {}) {
  return [
    "    resource 0x7f090004 integer/pos_update_check_minutes",
    `      () ${check}`,
    "    resource 0x7f090005 integer/pos_update_reopen_minutes",
    `      () ${reopen}`,
    "    resource 0x7f0e0051 string/pos_update_base_label",
    '      () "a neighbour that is not it"',
    "    resource 0x7f0e0052 string/pos_update_base",
    `      () "${base}"`,
    "    resource 0x7f0e0053 string/print_host_alert_channel_name",
    '      () "POS printing"',
    "",
  ].join("\n");
}

test("the Android tools' outputs are read: the signer's certificate, the package line, debuggable, the CPU type, the update settings", () => {
  assert.deepEqual(signerDigests(APKSIGNER_OUT), [EXPECTED_CERT_SHA256], "build-tools 37's V2 Signer line");
  assert.deepEqual(signerDigests(`Signer #1 certificate SHA-256 digest: ${SHA}\n`), [SHA], "an older build-tools' line");
  assert.deepEqual(
    readBadging(badgingOut()),
    { package: "com.possoftware.pos", versionCode: 20000, versionName: "2.0.0", debuggable: false, nativeCode: ["arm64-v8a"] },
    "a release APK",
  );
  assert.equal(readBadging(badgingOut({ debuggable: true })).debuggable, true, "a debug build says so");
  assert.deepEqual(readBadging(badgingOut({ native: "'arm64-v8a' 'x86_64'" })).nativeCode, ["arm64-v8a", "x86_64"], "two CPU types");
  assert.equal(resourceValue(resourcesOut(), "string/pos_update_base"), "https://files.sandbee.in/pos", "the base, not its neighbour");
  assert.equal(resourceValue(resourcesOut(), "integer/pos_update_check_minutes"), 720, "the check");
  assert.equal(resourceValue(resourcesOut(), "integer/pos_update_reopen_minutes"), 30, "the reopen time");
  assert.equal(resourceValue(resourcesOut(), "string/missing"), null, "no such resource");
});

test("the upload steps put the versioned files first and latest.json and latest.yml last, with the cache headers", () => {
  const steps = uploadSteps("2.0.0");
  const at = (text, from = 0) => {
    const index = steps.indexOf(text, from);
    assert.ok(index >= 0, `the steps name ${text}`);
    return index;
  };
  const first = at("2. Upload these first");
  const last = at("3. Then, LAST");
  const check = at("4. Check from a phone");
  for (const file of ["Sandbee-POS-2.0.0-arm64-v8a.apk", "Sandbee-POS-2.0.0-armeabi-v7a.apk", "POS-Software-Setup-2.0.0.exe", "POS-Software-Setup-2.0.0.exe.blockmap"]) {
    const index = at(`/${file}`, first);
    assert.ok(index < last, `${file} in the first step`);
  }
  for (const file of ["pos/android/latest.json", "pos/windows/latest.yml"]) {
    const index = at(file, last);
    assert.ok(index < check, `${file} in the last step`);
  }
  assert.ok(at("max-age=31536000, immutable", first) < last, "the versioned files' cache header");
  assert.ok(at("max-age=60", last) < check, "the latest files' cache header");
  assert.ok(at("sha256sum -c SHA256SUMS.txt") < first, "check the files first");
  assert.ok(at("Get-FileHash -Algorithm SHA256") < first, "... in PowerShell too (the N3 gate's review, m-5)");
  assert.ok(at("https://files.sandbee.in/pos/android/latest.json", check) > check, "the check from a phone");
});

test("the one version is the Windows app's, and the Android build setting must say the same (spec §5)", () => {
  const root = scratch();
  try {
    mkdirSync(path.join(root, "apps", "desktop"), { recursive: true });
    mkdirSync(path.join(root, "apps", "mobile", "android", "app"), { recursive: true });
    writeFileSync(path.join(root, "apps", "desktop", "package.json"), JSON.stringify({ version: "2.0.1" }));
    const gradle = path.join(root, "apps", "mobile", "android", "app", "build.gradle");
    writeFileSync(gradle, 'def posVersionRelease = "2.0.1"\n');
    assert.equal(repoVersion(root), "2.0.1", "both say 2.0.1");
    writeFileSync(gradle, 'def posVersionRelease = "2.0.0"\n');
    assert.throws(() => repoVersion(root), (e) => e instanceof Refused && /one version for both/.test(e.message), "they differ");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the flags: the four the release needs, two optional, and the usage line for anything else", () => {
  assert.deepEqual(
    parseArgs(["--arm64", "a.apk", "--armv7", "b.apk", "--windows", "dist", "--notes", "Faster.", "--released", "2026-10-20", "--out", "o"]),
    { arm64: "a.apk", armv7: "b.apk", windows: "dist", notes: "Faster.", released: "2026-10-20", out: "o" },
    "every flag",
  );
  assert.throws(() => parseArgs(["--arm64", "a.apk", "--armv7", "b.apk", "--windows", "dist"]), Refused, "no --notes");
  assert.throws(() => parseArgs(["--arm64", "a.apk", "--armv7", "b.apk", "--windows", "dist", "--notes", "x", "--force", "1"]), Refused, "an unknown flag");
  assert.throws(() => parseArgs(["--arm64"]), Refused, "a flag without its value");
});

const sha512 = (bytes) => createHash("sha512").update(bytes).digest("base64");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A built release on disk (two fake APKs, a fake installer with electron-builder's files) and fake tools that answer
 *  as build-tools 37 does for a correct release; [edit] breaks one thing. */
function release(edit = {}) {
  const root = scratch();
  const apk64 = path.join(root, "apk", "app-arm64-v8a-release.apk");
  const apk32 = path.join(root, "apk", "app-armeabi-v7a-release.apk");
  mkdirSync(path.dirname(apk64), { recursive: true });
  writeFileSync(apk64, randomBytes(4096));
  writeFileSync(apk32, randomBytes(3072));
  const dist = path.join(root, "dist");
  mkdirSync(path.join(dist, "win-unpacked", "resources"), { recursive: true });
  const installer = randomBytes(8192);
  writeFileSync(path.join(dist, "POS-Software-Setup-2.0.0.exe"), installer);
  writeFileSync(path.join(dist, "POS-Software-Setup-2.0.0.exe.blockmap"), randomBytes(256));
  writeFileSync(
    path.join(dist, "latest.yml"),
    LATEST_YML.replaceAll("Xo8ur19P7cVXc7K7kbnrZ/Bu4j6NAXrLQEUESJWHH9WUyKkYjiZpn3BUSFVKaL+/9atj2taJgNDsqWlOPC/7oA==", sha512(installer)).replace("112542296", String(installer.length)),
  );
  writeFileSync(
    path.join(dist, "win-unpacked", "resources", "app-update.yml"),
    "provider: generic\nurl: https://files.sandbee.in/pos/windows\nupdaterCacheDirName: pos-desktop-updater\n",
  );
  const abiOf = (apk) => (apk === apk64 ? "arm64-v8a" : "armeabi-v7a");
  const tools = {
    apksigner: () => APKSIGNER_OUT,
    badging: (apk) => badgingOut({ native: `'${abiOf(apk)}'` }),
    resources: () => resourcesOut(),
  };
  const opts = { version: "2.0.0", arm64: apk64, armv7: apk32, windows: dist, notes: "Sandbee POS now updates itself.", released: "2026-10-20", out: path.join(root, "out") };
  const r = { root, apk64, apk32, dist, installer, tools, opts };
  edit.run?.(r);
  return r;
}

test("a release folder: the APKs and the installer under the bucket's keys, latest.json by the app's rules, SHA256SUMS.txt for every file, the upload steps", () => {
  const r = release();
  try {
    const { dir, files, manifest: written } = packageRelease(r.opts, r.tools);
    assert.equal(dir, path.join(r.opts.out, "Sandbee-POS-2.0.0"), "the folder is named for the version");
    assert.deepEqual(
      files,
      [
        "upload/pos/android/Sandbee-POS-2.0.0-arm64-v8a.apk",
        "upload/pos/android/Sandbee-POS-2.0.0-armeabi-v7a.apk",
        "upload/pos/android/latest.json",
        "upload/pos/windows/POS-Software-Setup-2.0.0.exe",
        "upload/pos/windows/POS-Software-Setup-2.0.0.exe.blockmap",
        "upload/pos/windows/latest.yml",
      ],
      "the bucket's keys",
    );
    const latest = JSON.parse(readFileSync(path.join(dir, "upload", "pos", "android", "latest.json"), "utf8"));
    assert.deepEqual(latest, written, "latest.json is what was checked");
    assert.deepEqual(manifestProblems(latest), [], "the app accepts it");
    assert.deepEqual(
      latest,
      {
        schema: 1,
        package: "com.possoftware.pos",
        version: "2.0.0",
        versionCode: 20000,
        released: "2026-10-20",
        notes: "Sandbee POS now updates itself.",
        apks: {
          "arm64-v8a": { file: "Sandbee-POS-2.0.0-arm64-v8a.apk", sha256: sha256(readFileSync(r.apk64)), size: 4096 },
          "armeabi-v7a": { file: "Sandbee-POS-2.0.0-armeabi-v7a.apk", sha256: sha256(readFileSync(r.apk32)), size: 3072 },
        },
      },
      "the hashes and sizes are the built APKs'",
    );
    const sums = readFileSync(path.join(dir, "SHA256SUMS.txt"), "utf8").trimEnd().split("\n");
    assert.equal(sums.length, files.length, "one line per file");
    for (const [i, file] of files.entries()) {
      assert.equal(sums[i], `${sha256(readFileSync(path.join(dir, file)))} *${file}`, `sha256sum's line for ${file}`);
    }
    assert.ok(readFileSync(path.join(dir, "upload", "pos", "windows", "POS-Software-Setup-2.0.0.exe")).equals(r.installer), "the installer, byte for byte");
    assert.equal(readFileSync(path.join(dir, "upload", "pos", "windows", "latest.yml"), "utf8"), readFileSync(path.join(r.dist, "latest.yml"), "utf8"), "electron-builder's latest.yml as it is");
    assert.equal(readFileSync(path.join(dir, "UPLOAD-STEPS.txt"), "utf8"), uploadSteps("2.0.0"), "the upload steps");
    assert.equal(existsSync(dir + ".partial"), false, "written in a .partial folder and renamed at the end");
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test("a release built the wrong way is refused with one clear line, and nothing is written (Review Focus 4)", () => {
  const cases = [
    ["not signed with the private key", (r) => (r.tools.apksigner = () => `V2 Signer: certificate SHA-256 digest: ${SHA}\n`)],
    ["apksigner says its signature does not verify", (r) => (r.tools.apksigner = () => { throw new Error("DOES NOT VERIFY"); })],
    ["a debuggable build is not a release", (r) => (r.tools.badging = (apk) => badgingOut({ debuggable: true, native: apk === r.apk64 ? "'arm64-v8a'" : "'armeabi-v7a'" }))],
    ["package com.example.other", (r) => (r.tools.badging = () => badgingOut({ name: "com.example.other" }))],
    ["version 2.0.1 (20001), not 2.0.0 (20000)", (r) => (r.tools.badging = () => badgingOut({ code: 20001, version: "2.0.1" }))],
    ["native code armeabi-v7a, not arm64-v8a alone", (r) => ([r.opts.arm64, r.opts.armv7] = [r.apk32, r.apk64])],
    ["native code arm64-v8a, x86_64, not arm64-v8a alone", (r) => (r.tools.badging = () => badgingOut({ native: "'arm64-v8a' 'x86_64'" }))],
    ["update base http://127.0.0.1:8765/pos", (r) => (r.tools.resources = () => resourcesOut({ base: "http://127.0.0.1:8765/pos" }))],
    ["update times 1/1 minutes", (r) => (r.tools.resources = () => resourcesOut({ check: 1, reopen: 1 }))],
    ["no such APK", (r) => (r.opts.arm64 = path.join(r.root, "apk", "missing.apk"))],
    ["no latest.yml", (r) => rmSync(path.join(r.dist, "latest.yml"))],
    ["latest.yml: version 2.0.1", (r) => writeFileSync(path.join(r.dist, "latest.yml"), readFileSync(path.join(r.dist, "latest.yml"), "utf8").replace("version: 2.0.0", "version: 2.0.1"))],
    ["its SHA-512 or size is not", (r) => writeFileSync(path.join(r.dist, "POS-Software-Setup-2.0.0.exe"), randomBytes(8192))],
    ["POS-Software-Setup-2.0.0.exe.blockmap: missing", (r) => rmSync(path.join(r.dist, "POS-Software-Setup-2.0.0.exe.blockmap"))],
    ["not generic https://files.sandbee.in/pos/windows", (r) => writeFileSync(path.join(r.dist, "win-unpacked", "resources", "app-update.yml"), "provider: generic\nurl: http://127.0.0.1:8766/pos/windows\nupdaterCacheDirName: pos-desktop-updater\n")],
    ["no prerelease part", (r) => (r.opts.version = "2.0.1-rc.1")],
    ["notes: 301 characters", (r) => (r.opts.notes = "x".repeat(301))],
    ["released 20/10/2026", (r) => (r.opts.released = "20/10/2026")],
    // The N3 gate's review of N4 (its m-1, m-2, m-3, m-7).
    ["not signed with the private key", (r) => (r.tools.apksigner = () => APKSIGNER_OUT + `V2 Signer: certificate SHA-256 digest: ${SHA}\n`)],
    ["cannot run java", (r) => (r.tools.apksigner = () => { throw Object.assign(new Error("spawn java ENOENT"), { code: "ENOENT", path: "java" }); })],
    ["no win-unpacked", (r) => rmSync(path.join(r.dist, "win-unpacked", "resources", "app-update.yml"))],
    ["latest.yml: names POS-Software-Setup-2.0.1.exe", (r) => writeFileSync(path.join(r.dist, "latest.yml"), readFileSync(path.join(r.dist, "latest.yml"), "utf8").replace("path: POS-Software-Setup-2.0.0.exe", "path: POS-Software-Setup-2.0.1.exe"))],
    ["left from an incomplete run", (r) => mkdirSync(path.join(r.opts.out, "Sandbee-POS-2.0.0.partial"), { recursive: true })],
    ["Sandbee-POS-2.0.1 is newer than 2.0.0", (r) => mkdirSync(path.join(r.opts.out, "Sandbee-POS-2.0.1"), { recursive: true })],
  ];
  const listing = (folder) => (existsSync(folder) ? readdirSync(folder, { recursive: true }).map(String).sort() : null);
  for (const [message, run] of cases) {
    const r = release({ run });
    try {
      const before = listing(r.opts.out);
      assert.throws(() => packageRelease(r.opts, r.tools), (e) => e instanceof Refused && e.message.includes(message), `refused: ${message}`);
      assert.deepEqual(listing(r.opts.out), before, `nothing written: ${message}`);
    } finally {
      rmSync(r.root, { recursive: true, force: true });
    }
  }
});

test("a release folder is written once: an existing one is refused and left as it is", () => {
  const r = release();
  try {
    const dir = path.join(r.opts.out, "Sandbee-POS-2.0.0");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "keep.txt"), "the owner's");
    assert.throws(() => packageRelease(r.opts, r.tools), (e) => e instanceof Refused && /already exists/.test(e.message), "refused");
    assert.equal(readFileSync(path.join(dir, "keep.txt"), "utf8"), "the owner's", "untouched");
    assert.equal(existsSync(path.join(dir, "upload")), false, "nothing added");
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer && npm run test:release-native 2>&1 | grep -E "^not ok|Cannot find module|^# (tests|pass|fail)" | sed -E 's/ from .*//'
```
Expected: `# Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\\kd\\lucifer\\scripts\\release-native.mjs' imported`,
`not ok 1 - scripts\\release-native.test.mjs`, `# tests 1`, `# pass 0`, `# fail 1`.

- [ ] **Step 3: Implement**

Create `scripts/release-native.mjs`:

```js
#!/usr/bin/env node
// Native apps 2.0 (spec §10): the release folder for one version of both native apps. It builds nothing: it takes the
// release APK pair and the Windows installer that the usual commands built, checks them, and writes
//
//   <out>\Sandbee-POS-<version>\upload\pos\android\{latest.json, Sandbee-POS-<version>-arm64-v8a.apk, …-armeabi-v7a.apk}
//   <out>\Sandbee-POS-<version>\upload\pos\windows\{latest.yml, POS-Software-Setup-<version>.exe, ….exe.blockmap}
//   <out>\Sandbee-POS-<version>\SHA256SUMS.txt and UPLOAD-STEPS.txt
//
// laid out exactly as the bucket's keys. Nothing is uploaded: the owner uploads by hand, latest.json and latest.yml last.
//
//   node scripts/release-native.mjs --arm64 <apk> --armv7 <apk> --windows <electron-builder output folder>
//                                   --notes "<text>" [--released YYYY-MM-DD] [--out <folder>]
//
// It refuses, with one clear line and before writing anything, a release built the wrong way (spec §4, Review Focus 4):
// an APK not signed with the private key, a debug build, another package, version or CPU type, a test update base or
// shortened times, an installer whose latest.yml or app-update.yml is not the release's, a version with a prerelease
// part (electron-updater's generic provider would offer it: the N3 review's m-1), notes over 300 characters, or a
// release folder that already exists. The tools: apksigner (build-tools' lib/apksigner.jar, run with java) and aapt2,
// from ANDROID_HOME (default %LOCALAPPDATA%\Android\Sdk). The pure parts are exported for release-native.test.mjs.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PACKAGE = "com.possoftware.pos";
/** The private key's certificate (Session N1; apksigner prints it as "certificate SHA-256 digest"). */
export const EXPECTED_CERT_SHA256 = "5bd06ef3e9a78efcb0dfbd1ff102de932c581a78034d93ef7572f5373b5b3e40";
export const UPDATE_BASE = "https://files.sandbee.in/pos";
export const WINDOWS_FEED = UPDATE_BASE + "/windows";
export const UPDATER_CACHE_DIR = "pos-desktop-updater";
export const CHECK_MINUTES = 720;
export const REOPEN_MINUTES = 30;
export const MAX_APK_BYTES = 100 * 1024 * 1024;
export const MAX_NOTES_CHARS = 300;
/** The release's two CPU types, by this script's flag. */
export const RELEASE_ABIS = { arm64: "arm64-v8a", armv7: "armeabi-v7a" };
export const DEFAULT_OUT = "D:\\kd\\pos-apk-release";
export const BUILD_TOOLS = "37.0.0";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = /^(\d{1,3})\.(\d{1,2})\.(\d{1,2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const APK_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}\.apk$/;
const SHA256 = /^[0-9a-fA-F]{64}$/;

/** A refusal: the release is not written. */
export class Refused extends Error {}

/** spec §5: major × 10000 + minor × 100 + patch; null for anything but x.y.z with minor and patch below 100 (so a
 *  prerelease such as 2.1.0-rc.1 is no version here). */
export function versionCode(version) {
  const m = typeof version === "string" ? VERSION.exec(version) : null;
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : null;
}

export const apkName = (version, abi) => `Sandbee-POS-${version}-${abi}.apk`;
export const installerName = (version) => `POS-Software-Setup-${version}.exe`;
export const folderName = (version) => `Sandbee-POS-${version}`;

/** android/latest.json in the spec's field order; no notes field when the notes are empty. */
export function buildManifest({ version, released, notes, apks }) {
  const manifest = { schema: 1, package: PACKAGE, version, versionCode: versionCode(version), released };
  if (notes !== "") manifest.notes = notes;
  manifest.apks = {};
  for (const [abi, apk] of Object.entries(apks)) manifest.apks[abi] = { file: apk.file, sha256: apk.sha256, size: apk.size };
  return manifest;
}

/** The app's manifest rules (UpdateManifest.kt, spec §4) as reasons, in its order, plus the release's own: both release
 *  CPU types, each file named for its version and CPU type. [] when an older app accepts it. */
export function manifestProblems(m) {
  if (typeof m !== "object" || m === null || Array.isArray(m)) return ["not JSON"];
  if (m.schema !== 1) return ["schema"];
  if (m.package !== PACKAGE) return ["package"];
  if (typeof m.version !== "string") return ["version"];
  if (!Number.isInteger(m.versionCode)) return ["versionCode"];
  if (versionCode(m.version) !== m.versionCode) return ["version"];
  if (typeof m.released !== "string" || !DATE.test(m.released)) return ["released"];
  if (m.notes !== undefined && m.notes !== null && (typeof m.notes !== "string" || m.notes.length > MAX_NOTES_CHARS)) {
    return ["notes"];
  }
  if (typeof m.apks !== "object" || m.apks === null || Array.isArray(m.apks)) return ["apks"];
  const problems = [];
  for (const abi of Object.values(RELEASE_ABIS)) {
    const apk = m.apks[abi];
    if (typeof apk !== "object" || apk === null) {
      problems.push(`apk ${abi}`);
      continue;
    }
    if (typeof apk.file !== "string" || !APK_FILE.test(apk.file) || apk.file.includes("..") || apk.file !== apkName(m.version, abi)) {
      problems.push(`file ${abi}`);
    } else if (typeof apk.sha256 !== "string" || !SHA256.test(apk.sha256)) {
      problems.push(`sha256 ${abi}`);
    } else if (!Number.isInteger(apk.size) || apk.size <= 0 || apk.size > MAX_APK_BYTES) {
      problems.push(`size ${abi}`);
    }
  }
  return problems;
}

function unquote(value) {
  const v = value.trim();
  return /^'.*'$|^".*"$/.test(v) ? v.slice(1, -1) : v;
}

/** electron-builder's latest.yml: version, path, sha512, releaseDate and the files list (url, sha512, size). */
export function readLatestYml(text) {
  const out = { files: [] };
  let file = null;
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = /^(version|path|sha512|releaseDate): (.+)$/.exec(line))) {
      out[m[1]] = unquote(m[2]);
    } else if ((m = /^ {2}- url: (.+)$/.exec(line))) {
      file = { url: unquote(m[1]) };
      out.files.push(file);
    } else if ((m = /^ {4}(sha512|size): (.+)$/.exec(line)) && file !== null) {
      file[m[1]] = m[1] === "size" ? Number(m[2]) : unquote(m[2]);
    }
  }
  return out;
}

/** win-unpacked\resources\app-update.yml: flat "key: value" lines. */
export function readAppUpdateYml(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z]+): (.+)$/.exec(line);
    if (m) out[m[1]] = unquote(m[2]);
  }
  return out;
}

/** apksigner verify --print-certs: every signer's certificate SHA-256 (build-tools 37 prints "V2 Signer: certificate
 *  SHA-256 digest: <hex>"; older ones "Signer #1 certificate SHA-256 digest: <hex>"). */
export function signerDigests(text) {
  return [...text.matchAll(/certificate SHA-256 digest: ([0-9a-f]{64})/g)].map((m) => m[1]);
}

/** aapt2 dump badging: the package line, debuggable or not, the native code's CPU types. */
export function readBadging(text) {
  const pkg = /^package: name='([^']*)' versionCode='([^']*)' versionName='([^']*)'/m.exec(text);
  const native = /^native-code: (.+)$/m.exec(text);
  return {
    package: pkg?.[1] ?? null,
    versionCode: pkg ? Number(pkg[2]) : null,
    versionName: pkg?.[3] ?? null,
    debuggable: /^application-debuggable$/m.test(text),
    nativeCode: native ? [...native[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [],
  };
}

/** aapt2 dump resources: the value under a resource's line ("() "text"" for a string, "() 720" for an integer). */
export function resourceValue(text, name) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => new RegExp(`\\s${name.replace("/", "\\/")}$`).test(line.trimEnd()));
  if (at < 0 || at + 1 >= lines.length) return null;
  const m = /^\s*\(\)\s+(?:"(.*)"|(-?\d+))\s*$/.exec(lines[at + 1]);
  if (!m) return null;
  return m[1] !== undefined ? m[1] : Number(m[2]);
}

export function sha256Of(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sha512Base64(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

/** The upload steps for the owner (spec §10): the bucket keys, versioned files first, latest.* last, the cache headers,
 *  the check from a phone. */
export function uploadSteps(version) {
  const a64 = apkName(version, RELEASE_ABIS.arm64);
  const a32 = apkName(version, RELEASE_ABIS.armv7);
  const exe = installerName(version);
  return [
    `Sandbee POS ${version}: how to upload this release (native apps 2.0, spec §10)`,
    "",
    "Nothing in this folder has been uploaded. Every file under upload\\ goes to the bucket under the same path:",
    "upload\\pos\\android\\latest.json becomes the key pos/android/latest.json, and so on.",
    "",
    "1. Check the files first: in this folder, `sha256sum -c SHA256SUMS.txt` (Git Bash) says OK for every line; in",
    "   PowerShell, `Get-FileHash -Algorithm SHA256 <file>` gives the hash on that file's line.",
    "",
    "2. Upload these first, with Cache-Control: max-age=31536000, immutable",
    `   pos/android/${a64}    Content-Type: application/vnd.android.package-archive`,
    `   pos/android/${a32}    Content-Type: application/vnd.android.package-archive`,
    `   pos/windows/${exe}    Content-Type: application/octet-stream`,
    `   pos/windows/${exe}.blockmap    Content-Type: application/octet-stream`,
    "",
    "3. Then, LAST, with Cache-Control: max-age=60",
    "   pos/android/latest.json    Content-Type: application/json",
    "   pos/windows/latest.yml    Content-Type: text/yaml",
    "   (never before the files they name: a device would see an update it cannot download yet)",
    "",
    "4. Check from a phone's browser:",
    `   ${UPDATE_BASE}/android/latest.json shows "version": "${version}"`,
    `   ${WINDOWS_FEED}/latest.yml shows version: ${version}`,
    "",
    "5. What happens next: an Android device offers the update at an app open after its next look (at most every 12",
    "   hours); a Windows PC downloads it a minute after the app starts (or at its daily look) and installs it when the",
    "   app is closed, or at once with Restart to update. Nothing ever blocks work.",
    "",
    "A release is never taken back: a bad one is fixed by a newer version. Devices still on a 1.x app never update",
    "themselves: they move to 2.0.0 by hand once (GO-LIVE-CHECKLIST, \"Existing cafes: the native apps 2.0 release\").",
    "",
  ].join("\n");
}

/** The one version: apps/desktop/package.json's, which the Android build setting must equal (pin 27). */
export function repoVersion(root = ROOT) {
  const desktop = JSON.parse(readFileSync(path.join(root, "apps", "desktop", "package.json"), "utf8")).version;
  const gradle = /def posVersionRelease = "([^"]*)"/.exec(
    readFileSync(path.join(root, "apps", "mobile", "android", "app", "build.gradle"), "utf8"),
  )?.[1];
  if (desktop !== gradle) {
    throw new Refused(`the Windows app is ${desktop} and the Android app ${gradle}: one version for both (spec §5)`);
  }
  return desktop;
}

export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** apksigner and aapt2 from the Android SDK on this PC; java from JAVA_HOME when it is set (the N3 gate's review, m-1:
 *  a missing tool is named, never read as a bad signature). */
export function realTools(sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk")) {
  const bt = path.join(sdk, "build-tools", BUILD_TOOLS);
  const jar = path.join(bt, "lib", "apksigner.jar");
  const aapt2 = path.join(bt, "aapt2.exe");
  for (const tool of [jar, aapt2]) {
    if (!existsSync(tool)) throw new Refused(`cannot run ${tool}: no build-tools ${BUILD_TOOLS} there (set ANDROID_HOME)`);
  }
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : "java";
  const run = (file, args) =>
    execFileSync(file, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return {
    apksigner: (apk) => run(java, ["-jar", jar, "verify", "--print-certs", apk]),
    badging: (apk) => run(aapt2, ["dump", "badging", apk]),
    resources: (apk) => run(aapt2, ["dump", "resources", apk]),
  };
}

function read(name, what, run) {
  try {
    return run();
  } catch (error) {
    if (error?.code === "ENOENT") throw new Refused(`cannot run ${error.path ?? "a tool"} (set JAVA_HOME and ANDROID_HOME)`);
    throw new Refused(`${name}: ${what}`);
  }
}

function checkApk(file, abi, version, tools) {
  const name = path.basename(file);
  if (!existsSync(file) || !statSync(file).isFile()) throw new Refused(`${name}: no such APK`);
  const size = statSync(file).size;
  if (size <= 0 || size > MAX_APK_BYTES) throw new Refused(`${name}: ${size} bytes is not an APK of at most 100 MB`);
  const signers = signerDigests(read(name, "apksigner says its signature does not verify", () => tools.apksigner(file)));
  if (signers.length === 0 || signers.some((digest) => digest !== EXPECTED_CERT_SHA256)) {
    throw new Refused(`${name}: not signed with the private key (certificate ${signers.join(", ") || "none"})`);
  }
  const badging = readBadging(read(name, "aapt2 cannot read it", () => tools.badging(file)));
  if (badging.package !== PACKAGE) throw new Refused(`${name}: package ${badging.package}, not ${PACKAGE}`);
  if (badging.versionName !== version || badging.versionCode !== versionCode(version)) {
    throw new Refused(`${name}: version ${badging.versionName} (${badging.versionCode}), not ${version} (${versionCode(version)})`);
  }
  if (badging.debuggable) throw new Refused(`${name}: a debuggable build is not a release`);
  if (badging.nativeCode.length !== 1 || badging.nativeCode[0] !== abi) {
    throw new Refused(`${name}: native code ${badging.nativeCode.join(", ") || "none"}, not ${abi} alone`);
  }
  const resources = read(name, "aapt2 cannot read its resources", () => tools.resources(file));
  const base = resourceValue(resources, "string/pos_update_base");
  const check = resourceValue(resources, "integer/pos_update_check_minutes");
  const reopen = resourceValue(resources, "integer/pos_update_reopen_minutes");
  if (base !== UPDATE_BASE) throw new Refused(`${name}: update base ${base}, not ${UPDATE_BASE}`);
  if (check !== CHECK_MINUTES || reopen !== REOPEN_MINUTES) {
    throw new Refused(`${name}: update times ${check}/${reopen} minutes, not ${CHECK_MINUTES}/${REOPEN_MINUTES}`);
  }
  return { file, size };
}

function checkWindows(dir, version) {
  const exe = installerName(version);
  const latestPath = path.join(dir, "latest.yml");
  if (!existsSync(latestPath)) throw new Refused(`${dir}: no latest.yml (build the installer with npm run dist)`);
  const latest = readLatestYml(readFileSync(latestPath, "utf8"));
  if (latest.version !== version) throw new Refused(`latest.yml: version ${latest.version}, not ${version}`);
  if (latest.path !== exe || latest.files.length !== 1 || latest.files[0].url !== exe) {
    throw new Refused(`latest.yml: names ${latest.path}, not ${exe} alone`);
  }
  const installer = path.join(dir, exe);
  if (!existsSync(installer)) throw new Refused(`${exe}: no such installer in ${dir}`);
  const sha512 = sha512Base64(installer);
  if (latest.sha512 !== sha512 || latest.files[0].sha512 !== sha512 || latest.files[0].size !== statSync(installer).size) {
    throw new Refused(`latest.yml: its SHA-512 or size is not ${exe}'s (an installer from another build)`);
  }
  const blockmap = installer + ".blockmap";
  if (!existsSync(blockmap)) throw new Refused(`${exe}.blockmap: missing`);
  const feedPath = path.join(dir, "win-unpacked", "resources", "app-update.yml");
  if (!existsSync(feedPath)) throw new Refused(`${dir}: no win-unpacked\\resources\\app-update.yml`);
  const feed = readAppUpdateYml(readFileSync(feedPath, "utf8"));
  if (feed.provider !== "generic" || feed.url !== WINDOWS_FEED || feed.updaterCacheDirName !== UPDATER_CACHE_DIR) {
    throw new Refused(`app-update.yml: ${feed.provider} ${feed.url}, not generic ${WINDOWS_FEED} (a test build?)`);
  }
  return { installer, blockmap, latestPath };
}

/** Checks everything, then writes the release folder; returns its path and its files (relative, "/"). Throws
 *  [Refused] before writing anything. */
export function packageRelease(opts, tools = realTools()) {
  const version = opts.version ?? repoVersion();
  if (versionCode(version) === null) {
    throw new Refused(`version ${version}: a release is x.y.z, minor and patch below 100, no prerelease part`);
  }
  const notes = (opts.notes ?? "").trim();
  if (notes.length > MAX_NOTES_CHARS) throw new Refused(`notes: ${notes.length} characters, at most ${MAX_NOTES_CHARS}`);
  const released = opts.released ?? today();
  if (!DATE.test(released)) throw new Refused(`released ${released}: YYYY-MM-DD`);
  const out = opts.out ?? DEFAULT_OUT;
  const dir = path.join(out, folderName(version));
  if (existsSync(dir)) throw new Refused(`${dir} already exists: a release folder is written once`);
  // Written into <dir>.partial and renamed at the end, so a failed copy never leaves a folder that looks finished (the
  // N3 gate's review, m-2).
  const partial = dir + ".partial";
  if (existsSync(partial)) throw new Refused(`${partial} is left from an incomplete run: delete it, then run again`);
  // spec §5: versions only go up (the N3 gate's review, m-7).
  const newer = (existsSync(out) ? readdirSync(out) : [])
    .map((name) => /^Sandbee-POS-(\d+\.\d+\.\d+)$/.exec(name)?.[1])
    .filter((v) => v !== undefined && versionCode(v) !== null && versionCode(v) > versionCode(version));
  if (newer.length > 0) throw new Refused(`Sandbee-POS-${newer[0]} is newer than ${version}: a release only goes up (spec §5)`);
  const arm64 = checkApk(opts.arm64, RELEASE_ABIS.arm64, version, tools);
  const armv7 = checkApk(opts.armv7, RELEASE_ABIS.armv7, version, tools);
  const win = checkWindows(opts.windows, version);

  const apks = {};
  for (const [abi, apk] of [[RELEASE_ABIS.arm64, arm64], [RELEASE_ABIS.armv7, armv7]]) {
    apks[abi] = { file: apkName(version, abi), sha256: sha256Of(apk.file), size: apk.size, from: apk.file };
  }
  const manifest = buildManifest({ version, released, notes, apks });
  const problems = manifestProblems(manifest);
  if (problems.length > 0) throw new Refused(`latest.json: ${problems.join(", ")}`);

  const android = path.join(partial, "upload", "pos", "android");
  const windows = path.join(partial, "upload", "pos", "windows");
  mkdirSync(android, { recursive: true });
  mkdirSync(windows, { recursive: true });
  for (const apk of Object.values(apks)) {
    const target = path.join(android, apk.file);
    copyFileSync(apk.from, target);
    if (sha256Of(target) !== apk.sha256) throw new Refused(`${apk.file}: the copy differs from the built APK`);
  }
  writeFileSync(path.join(android, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");
  copyFileSync(win.installer, path.join(windows, installerName(version)));
  copyFileSync(win.blockmap, path.join(windows, installerName(version) + ".blockmap"));
  copyFileSync(win.latestPath, path.join(windows, "latest.yml"));

  const files = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(partial, full).split(path.sep).join("/"));
    }
  };
  walk(path.join(partial, "upload"));
  writeFileSync(path.join(partial, "SHA256SUMS.txt"), files.map((f) => `${sha256Of(path.join(partial, f))} *${f}`).join("\n") + "\n");
  writeFileSync(path.join(partial, "UPLOAD-STEPS.txt"), uploadSteps(version));
  renameSync(partial, dir);
  return { dir, version, files, manifest };
}

const USAGE =
  'usage: node scripts/release-native.mjs --arm64 <apk> --armv7 <apk> --windows <folder> --notes "<text>" [--released YYYY-MM-DD] [--out <folder>]';

export function parseArgs(argv) {
  const flags = { "--arm64": "arm64", "--armv7": "armv7", "--windows": "windows", "--notes": "notes", "--released": "released", "--out": "out" };
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = flags[argv[i]];
    if (key === undefined || argv[i + 1] === undefined) throw new Refused(USAGE);
    opts[key] = argv[i + 1];
  }
  for (const key of ["arm64", "armv7", "windows", "notes"]) {
    if (opts[key] === undefined) throw new Refused(USAGE);
  }
  return opts;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { dir, version, files, manifest } = packageRelease(parseArgs(process.argv.slice(2)));
    console.log(`Sandbee POS ${version} (versionCode ${manifest.versionCode}): ${dir}`);
    for (const file of files) console.log(`  ${file}`);
    console.log("  SHA256SUMS.txt, UPLOAD-STEPS.txt (nothing uploaded; latest.json and latest.yml go last)");
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    console.error(`release-native: refused: ${error.message}`);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 4: Run them and see them pass**

```bash
cd /d/kd/lucifer && npm run test:release-native 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"
```
Expected: `# tests 12`, `# pass 12`, `# fail 0`.

- [ ] **Step 5: Commit** (`$SP/msg-n4-1.txt`):

```text
feat(apps): the release folder, scripts/release-native.mjs: it builds nothing; it checks the built APK pair (the private key's certificate, the package, the one version, not debuggable, one CPU type each, the real update base and times) and the Windows installer (latest.yml's version, file and SHA-512, the blockmap, app-update.yml's feed), refuses a prerelease or lower version, long notes, an existing or half-written folder and a missing tool before writing anything, and writes D:\kd\pos-apk-release\Sandbee-POS-<version>\ (through a .partial folder) with upload\pos\... as the bucket's keys, latest.json by the app's rules, SHA256SUMS.txt and UPLOAD-STEPS.txt (latest.json and latest.yml last); 12 tests (native apps 2.0, Session N4, spec §10)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 42: Docs

**Files:**
- Modify: `docs/GO-LIVE-CHECKLIST.md` (§1 "Existing cafes: the native apps 2.0 release", §7's install line, four §A rows), `apps/mobile/README.md` ("Release a new version (both apps)"), `apps/cafe/DEPLOY.md` (the native apps line)
- Create: `apps/desktop/README.md`
- Test: `apps/cafe/lib/go-live-runbook.test.ts` (five pins; the §7 desktop pin quotes "Restart to update" and files.sandbee.in)

- [ ] **Step 1: Write the failing pins**

In `apps/cafe/lib/go-live-runbook.test.ts`, find:

```ts
  const urlHtml = readFileSync(path.join(REPO_ROOT, "apps/desktop/assets/url-window.html"), "utf8");
  const sharedSrc = readFileSync(path.join(REPO_ROOT, "apps/desktop/src/shared.ts"), "utf8");
  for (const [label, src, where] of [
    ["Open POS", menuSrc, "menu.ts"],
```

Replace it with:

```ts
  const urlHtml = readFileSync(path.join(REPO_ROOT, "apps/desktop/assets/url-window.html"), "utf8");
  const sharedSrc = readFileSync(path.join(REPO_ROOT, "apps/desktop/src/shared.ts"), "utf8");
  const updatePlanSrc = readFileSync(path.join(REPO_ROOT, "apps/desktop/src/update-plan.ts"), "utf8");
  for (const [label, src, where] of [
    ["Open POS", menuSrc, "menu.ts"],
```

In `apps/cafe/lib/go-live-runbook.test.ts`, find:

```ts
    // Native apps 2.0 Session N3 deliberately changed: the address window's words (spec §9).
    ["POS address", urlHtml, "url-window.html"],
  ] as const) {
    assert.ok(section.includes(label), `§7 desktop sub-section must quote "${label}"`);
```

Replace it with:

```ts
    // Native apps 2.0 Session N3 deliberately changed: the address window's words (spec §9).
    ["POS address", urlHtml, "url-window.html"],
    // Native apps 2.0 Session N4 deliberately changed: the app updates itself (spec §7).
    ["Restart to update", updatePlanSrc, "update-plan.ts"],
  ] as const) {
    assert.ok(section.includes(label), `§7 desktop sub-section must quote "${label}"`);
```

In `apps/cafe/lib/go-live-runbook.test.ts`, find:

```ts
  assert.ok(section.includes("pos-desktop.log") && sharedSrc.includes('LOG_FILE_NAME = "pos-desktop.log"'), "the section must name the log file support will ask for");
  assert.ok(/notification/i.test(section), "the section must say a failed print raises a Windows notification");
});

```

Replace it with:

```ts
  assert.ok(section.includes("pos-desktop.log") && sharedSrc.includes('LOG_FILE_NAME = "pos-desktop.log"'), "the section must name the log file support will ask for");
  assert.ok(/notification/i.test(section), "the section must say a failed print raises a Windows notification");
  assert.ok(
    !section.includes("never downloaded from anywhere") && section.includes("files.sandbee.in"),
    "from 2.0.0 the app updates itself from files.sandbee.in (native apps 2.0)",
  );
});

```

In `apps/cafe/lib/go-live-runbook.test.ts`, find:

```ts
  assert.ok(open.includes("open the app from its icon"), "... so the deployer opens the app either way");
});

```

Replace it with:

```ts
  assert.ok(open.includes("open the app from its icon"), "... so the deployer opens the app either way");
});

// ── Native apps 2.0 (Session N4): the release step, the update facts, the address window's words ─────────────────
// apps/mobile, apps/desktop and scripts/ are outside this workspace: their files are read as text (rule 3 above).

const NATIVE_STEP = "### Existing cafes: the native apps 2.0 release";

test("PIN §1 (native apps 2.0): the release step keeps its order (the owner's upload first, each printing device moved once, then the Windows app over 1.x), names the packaging script's files and their hashes, and changes no web or Worker", () => {
  const step = norm(sectionSlice(NATIVE_STEP));
  let at = -1;
  for (const landmark of [
    "**First, the owner's upload.**",
    "UPLOAD-STEPS.txt",
    "**Each printing phone or tablet, once:**",
    "uninstall the old POS app",
    "Sandbee-POS-2.0.0-arm64-v8a.apk",
    "**Admin → Printer setup**",
    "choose this device again",
    "**The Windows counter PC:**",
    "POS-Software-Setup-2.0.0.exe",
  ]) {
    const next = step.indexOf(landmark);
    assert.ok(next > at, `the native apps 2.0 step names "${landmark}" after the one before it`);
    at = next;
  }
  assert.ok(step.includes("SHA256SUMS.txt"), "each file's hash is checked before it is sent");
  assert.ok(step.includes("No web change and no Worker change"), "this release changes neither");
  const script = readFileSync(path.join(REPO_ROOT, "scripts/release-native.mjs"), "utf8");
  assert.ok(script.includes("`Sandbee-POS-${version}-${abi}.apk`"), "the packaging script names the APKs as the step does");
  assert.ok(script.includes("`POS-Software-Setup-${version}.exe`"), "... and the installer");
});

test("PIN §1 (native apps 2.0): what staff see from then on, in the apps' own words: the card at an app open, Android's one-time questions, Cancel and no Open button; the Windows notice, Restart to update, install at closing; nothing ever blocks work", () => {
  const step = norm(sectionSlice(NATIVE_STEP));
  for (const phrase of [
    "Nothing ever blocks work",
    "**Install**",
    "**Later**",
    "after 30 minutes away",
    "Install unknown apps",
    "Auto Blocker",
    "Unknown sources",
    "**More details → Install without scanning**",
    "Cancel in Android's update dialog just closes the card until the next app open",
    "there is no Open button",
    "**Restart to update**",
    "installs when the app is closed",
  ]) {
    assert.ok(step.includes(phrase), `the step tells the staff: ${phrase}`);
  }
  const card = readFileSync(path.join(REPO_ROOT, "apps/mobile/src/screens/UpdateCard.tsx"), "utf8");
  assert.ok(step.includes('"Update available"') && card.includes("Update available"), "the card's title, as the app shows it");
  const strings = readFileSync(path.join(REPO_ROOT, "apps/mobile/android/app/src/main/res/values/strings.xml"), "utf8");
  assert.ok(step.includes('"POS printing is off. Tap to start."') && strings.includes(">POS printing is off. Tap to start.<"), "the printing device's notice");
  const plan = readFileSync(path.join(REPO_ROOT, "apps/desktop/src/update-plan.ts"), "utf8");
  assert.ok(step.includes("is ready. It installs when you close the app.") && plan.includes("is ready. It installs when you close the app."), "the Windows notice, as update-plan.ts says it");
  assert.ok(plan.includes('RESTART_TO_UPDATE = "Restart to update"'), "the menu item's label");
});

test("PIN §1 (native apps 2.0, the N3 review's m-2): the address window's no-answer words are quoted as pos-health.ts says them, with the spelling to check first", () => {
  const step = norm(sectionSlice(NATIVE_STEP));
  const health = readFileSync(path.join(REPO_ROOT, "apps/desktop/src/pos-health.ts"), "utf8");
  assert.ok(health.includes("Check the name and the internet connection."), "pos-health.ts's words (the owner's ruling of 2026-10-13)");
  assert.ok(step.includes("Check the name and the internet connection."), "the step quotes them");
  assert.ok(step.includes("check the spelling of the workspace name first"), "a mistyped name is the likely cause on a working connection");
  assert.ok(step.includes("**Open POS** once more"), "a POS that was asleep may need a second try (the N2 gate's review of N3, m-2)");
});

test("PIN §A (native apps 2.0): the update base, the POS app's look, the Windows app's look and the card's wait for idle printers match the code", () => {
  const gradle = readFileSync(path.join(REPO_ROOT, "apps/mobile/android/app/build.gradle"), "utf8");
  const desktop = JSON.parse(readFileSync(path.join(REPO_ROOT, "apps/desktop/package.json"), "utf8")) as {
    build: { publish: { provider: string; url: string } };
  };
  const plan = readFileSync(path.join(REPO_ROOT, "apps/desktop/src/update-plan.ts"), "utf8");
  const moduleKt = readFileSync(path.join(REPO_ROOT, "apps/mobile/android/app/src/main/java/com/possoftware/pos/update/PosUpdateModule.kt"), "utf8");
  const base = backtickTokens(factRowIn(SECTION_A_HEADING, "Update files base (both native apps)"))[0];
  assert.equal(base, "https://files.sandbee.in/pos", "the doc's base");
  assert.ok(gradle.includes(`def posUpdateBaseDefault = "${base}"`), "the POS app's default base");
  assert.equal(desktop.build.publish.provider, "generic", "the Windows app's provider");
  assert.equal(desktop.build.publish.url, `${base}/windows`, "the Windows app's feed");
  const look = factRowIn(SECTION_A_HEADING, "POS app update look");
  assert.ok(look.includes("12 hours") && gradle.includes("(findProperty('posUpdateCheckMinutes') ?: '720')"), "12 hours = 720 minutes");
  assert.ok(look.includes("30 minutes") && gradle.includes("(findProperty('posUpdateReopenMinutes') ?: '30')"), "an app open after 30 minutes away");
  const windows = factRowIn(SECTION_A_HEADING, "Windows app update look");
  assert.ok(windows.includes("1 minute") && plan.includes("FIRST_CHECK_MS = 60_000"), "1 minute after start");
  assert.ok(windows.includes("24 hours") && plan.includes("CHECK_EVERY_MS = 86_400_000"), "then every 24 hours");
  const wait = factRowIn(SECTION_A_HEADING, "Update card wait for idle printers");
  assert.ok(wait.includes("2 minutes") && moduleKt.includes("CARD_IDLE_WAIT_MS = 120_000L"), "at most 2 minutes (the owner's ruling of 2026-10-13)");
});

test("PIN (native apps 2.0): the READMEs say how a release is built and packaged, latest.* uploaded last, and DEPLOY.md says a web deploy does not update the native apps", () => {
  const mobile = norm(readFileSync(path.join(REPO_ROOT, "apps/mobile/README.md"), "utf8"));
  const release = mobile.slice(mobile.indexOf("## Release a new version (both apps)"));
  assert.ok(release.length > 0 && mobile.includes("## Release a new version (both apps)"), "the mobile README's release section");
  for (const phrase of [
    "posVersionRelease",
    ":app:compileReleaseKotlin --rerun",
    "assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a",
    "npm run dist",
    "node scripts/release-native.mjs",
    "UPLOAD-STEPS.txt",
    "`latest.json` and `latest.yml` last",
    "minSdkVersion",
  ]) {
    assert.ok(release.includes(phrase), `the release section names ${phrase}`);
  }
  const desktopReadme = norm(readFileSync(path.join(REPO_ROOT, "apps/desktop/README.md"), "utf8"));
  for (const phrase of ["npm run dist", "https://files.sandbee.in/pos/windows/", "**Restart to update**", "scripts/release-native.mjs", "`latest.yml` last"]) {
    assert.ok(desktopReadme.includes(phrase), `the desktop README names ${phrase}`);
  }
  const deploy = norm(readFileSync(path.join(REPO_ROOT, "apps/cafe/DEPLOY.md"), "utf8"));
  assert.ok(deploy.includes("The native apps are not part of a web deploy.") && deploy.includes("files.sandbee.in"), "DEPLOY.md's native apps line");
});

```

- [ ] **Step 2: Run them and see them fail**

```bash
cd /d/kd/lucifer/apps/cafe && timeout 300 node --import tsx --test lib/go-live-runbook.test.ts 2>&1 | grep -E "^not ok|^  error:|^# (tests|pass|fail)"
```
Expected: six fail (`# tests 102`, `# pass 96`, `# fail 6`): `PIN §7 desktop app: …` with `'§7 desktop sub-section must
quote "Restart to update"'`; the three `PIN §1 (native apps 2.0…)` pins with `could not find the heading "### Existing
cafes: the native apps 2.0 release"`; `PIN §A (native apps 2.0)` with `could not find the row "Update files base (both
native apps)"`; `PIN (native apps 2.0): the READMEs …` with `"the mobile README's release section"`.

- [ ] **Step 3: Implement**

In `apps/cafe/DEPLOY.md`, find:

```markdown
- [ ] Reports load with data

## 3. Backups

```

Replace it with:

```markdown
- [ ] Reports load with data

> **The native apps are not part of a web deploy.** The POS app (Android) and the
> Windows app update themselves from `files.sandbee.in` (native apps 2.0): a new
> version is built and packaged on the build PC (`apps/mobile/README.md` →
> "Release a new version (both apps)") and uploaded by the owner. When a web
> release needs a new app, its "Existing cafes" step in
> `docs/GO-LIVE-CHECKLIST.md` says so.

## 3. Backups

```

Create `apps/desktop/README.md`:

```markdown
# POS Software by sandbee: Windows app

The counter PC's Windows app (Electron 44). It opens the cafe's POS from one
saved address, stays in the tray, starts with Windows, and prints slips
silently. It sits outside the npm workspace, with its own `node_modules`.

## Checks

`npm test` (the node:test suites in `src/`, with the source pins),
`npm run typecheck` and `npm run lint`.

## The address window

At the first start, and from **Help → Change POS address…**, the app asks for the
POS address in a window that looks like the Android app's start screen. It reads
the address by the Android app's rules (`src/pos-url.ts`: a bare workspace name
means `<name>.sandbee.in`) and checks it once with `GET /api/health`
(`src/pos-health.ts`) before it saves it.

## Updates

The app updates itself with electron-updater's generic provider from
`https://files.sandbee.in/pos/windows/` (`build.publish` in `package.json`;
electron-builder writes it into `resources\app-update.yml`). It looks one minute
after it starts and then every 24 hours, downloads a new version in the
background, shows one notification, and installs it when the app is closed, or
at once with **Restart to update** in the tray and the Help menu. Never a dialog,
never an automatic restart. Errors go to the app's log,
`%APPDATA%\POS Software by sandbee\pos-desktop.log`.

## Build the installer

`npm run dist` writes `dist\POS-Software-Setup-<version>.exe`, its `.blockmap` and
`latest.yml`, and publishes nothing. A release is packaged with
`scripts/release-native.mjs` (`apps/mobile/README.md` → "Release a new version
(both apps)"), and the owner uploads it, `latest.yml` last.

A test build for this PC only takes another feed and version, for example
`npx electron-builder --win nsis --publish never "-c.publish.url=http://127.0.0.1:8766/pos/windows" "-c.extraMetadata.version=2.0.1"`;
the packaging refuses such a build. Where `ELECTRON_RUN_AS_NODE` is set in the
environment, unset it before building or starting the app.
```

In `apps/mobile/README.md`, find:

```markdown

Or copy the file to the device and open it there (allow "install unknown
apps" for the file manager). The APK is handed to clients directly; it is not
uploaded anywhere.

Before you hand the APK to a client, run the checks in
[TEST-CHECKLIST.md](./TEST-CHECKLIST.md) on a real device.

## Checks (no device needed)
```

Replace it with:

```markdown

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
```

In `docs/GO-LIVE-CHECKLIST.md`, find:

```markdown
      health, the service)" on the cafe's real printers, with the earlier checks and "Network printers on the
      Windows app (Phase 3)" on a counter PC with the 1.12.0 app.

---
```

Replace it with:

```markdown
      health, the service)" on the cafe's real printers, with the earlier checks and "Network printers on the
      Windows app (Phase 3)" on a counter PC with the 1.12.0 app.

### Existing cafes: the native apps 2.0 release

Native apps 2.0 makes the POS app (Android) and the Windows app update themselves from `files.sandbee.in`. Nothing
ever blocks work: the POS app offers a new version on a card when it is opened, and the Windows app downloads it in
the background and installs it when it is closed. Release 2.0.0 also signs the POS app with its own private key (every
earlier APK carried React Native's public test key), so each printing phone or tablet moves to 2.0.0 by hand once;
every later version arrives by itself. **No web change and no Worker change.**

- [ ] **First, the owner's upload.** The release folder `D:\kd\pos-apk-release\Sandbee-POS-2.0.0\` is uploaded as its
      `UPLOAD-STEPS.txt` says (the APKs, the installer and its blockmap first, `latest.json` and `latest.yml` last),
      and `https://files.sandbee.in/pos/android/latest.json` opens from a phone.
- [ ] **Each printing phone or tablet, once:** uninstall the old POS app (Android puts no app over one signed with
      another key), install `Sandbee-POS-2.0.0-arm64-v8a.apk` (`Sandbee-POS-2.0.0-armeabi-v7a.apk` for an old 32-bit
      phone; check its SHA-256 against the release's `SHA256SUMS.txt` before you send it), open it, type the cafe's
      name, sign in, and set this device's printer. Then **Admin → Printer setup**: choose this device again for its
      printers (an app installed again is a new device). A phone that only takes orders moves the same way when
      convenient; until then its old app keeps working and never updates itself.
- [ ] **The Windows counter PC:** `POS-Software-Setup-2.0.0.exe` installs over 1.x with no uninstall (check its
      SHA-256 against `SHA256SUMS.txt`). It keeps the POS address, the printers and Start with Windows (the first
      2.0.0 start sets Start with Windows again). From 2.0.0 the address window checks a typed address once: if it
      says "Couldn't reach <name>.sandbee.in. Check the name and the internet connection.", check the spelling of the
      workspace name first; a POS that was asleep may need **Open POS** once more.
- [ ] **Tell the staff what they will see from now on.** Nothing ever blocks work.
  - **The POS app:** when a new version is ready, a card "Update available" when the app is opened, with
    **Install** and **Later** (Later hides it until the next app open). An app open is a start, or coming back to the
    app after 30 minutes away: a device whose screen never turns off and whose app never leaves the screen updates
    after its next restart. The first update on each phone asks once to allow installs from Sandbee POS ("Install
    unknown apps"); on a Samsung (One UI 6 and later) Auto Blocker must be off first, and Android 7 has one "Unknown
    sources" switch instead. Google Play Protect may say "App scan recommended" (Sandbee POS is not from the Play
    Store): **More details → Install without scanning** installs at once (**Scan app** also works; it sends the app to
    Google and takes a while). Cancel in Android's update dialog just closes the card until the next app open. After
    **Update** there is no Open button: open the app from its icon, or tap "POS printing is off. Tap to start." on a
    printing device.
  - **The Windows app:** it downloads a new version in the background and shows one notification "POS Software
    <version> is ready. It installs when you close the app."; it installs when the app is closed (at closing time),
    or at once with **Restart to update** in the tray or the Help menu.
- [ ] **Whoever builds a release:** `apps/mobile/README.md` → "Release a new version (both apps)". Never raise the POS
      app's `minSdkVersion` while older devices are in use: the manifest names no minimum Android version, so such a
      device would download every new version and fail to install it.

---
```

In `docs/GO-LIVE-CHECKLIST.md`, find:

```markdown

- [ ] Copy `POS-Software-Setup-<version>.exe` to the counter PC by hand (USB or
      the local network). It is never downloaded from anywhere.
- [ ] Run it. Windows SmartScreen says the publisher is unknown: **More info →
      Run anyway**, once. Installs for this Windows user only, no admin rights.
```

Replace it with:

```markdown

- [ ] Copy `POS-Software-Setup-<version>.exe` to the counter PC by hand (USB or
      the local network), or download it from
      `https://files.sandbee.in/pos/windows/POS-Software-Setup-<version>.exe` once
      the owner has set that up. From then on the app updates itself: it
      downloads a new version in the background and installs it when the app
      is closed, or at once with **Restart to update** (the tray and the Help
      menu, once an update is ready).
- [ ] Run it. Windows SmartScreen says the publisher is unknown: **More info →
      Run anyway**, once. Installs for this Windows user only, no admin rights.
```

In `docs/GO-LIVE-CHECKLIST.md`, find:

```markdown
| Kitchen stations per cafe | 20 | `STATIONS_MAX` |
| Copies per printer (KOT, bill) | 1–3 | `PRINTER_COPIES_MIN` / `PRINTER_COPIES_MAX` |

---
```

Replace it with:

```markdown
| Kitchen stations per cafe | 20 | `STATIONS_MAX` |
| Copies per printer (KOT, bill) | 1–3 | `PRINTER_COPIES_MIN` / `PRINTER_COPIES_MAX` |
| Update files base (both native apps) | `https://files.sandbee.in/pos` | `posUpdateBaseDefault` (`app/build.gradle`), `build.publish.url` (`apps/desktop/package.json`) |
| POS app update look | at an app open, at most every 12 hours; an app open is a start, or back after 30 minutes away | `posUpdateCheckMinutes` / `posUpdateReopenMinutes` (`app/build.gradle`) |
| Windows app update look | 1 minute after the app starts, then every 24 hours | `FIRST_CHECK_MS` / `CHECK_EVERY_MS` |
| Update card wait for idle printers | at most 2 minutes, then the next app open | `CARD_IDLE_WAIT_MS` |

---
```

- [ ] **Step 4: Run them and see them pass, with the suites the new files touch**

```bash
cd /d/kd/lucifer/apps/cafe && timeout 300 node --import tsx --test lib/go-live-runbook.test.ts 2>&1 | grep -E "^not ok|^# (tests|pass|fail)" && npm run typecheck > /dev/null && echo "cafe typecheck clean"
cd /d/kd/lucifer/apps/desktop && timeout 250 npm test 2>&1 | grep -E "^# (tests|pass|fail)"
cd /d/kd/lucifer/apps/mobile && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
```
Expected: the runbook `# tests 102`, `# pass 102`, `# fail 0`, `cafe typecheck clean`; desktop `# tests 211`, `# fail 0`
(the new README breaks no desktop pin); mobile `# tests 168`, `# fail 0`.

- [ ] **Step 5: Commit** (`$SP/msg-n4-2.txt`):

```text
docs(apps): native apps 2.0 for the people who run it: GO-LIVE's "Existing cafes: the native apps 2.0 release" (the owner's upload first, each printing device moved to 2.0.0 once, the Windows app over 1.x, what staff see from then on in the apps' own words), §7's install line (the app updates itself), four §A update facts, the mobile README's "Release a new version (both apps)", a Windows app README and DEPLOY.md's native apps line; five runbook pins against the code (native apps 2.0, Session N4, spec §8, §10)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

### Task 43: Full verification

- [ ] **Step 1: Every suite**

```bash
cd /d/kd/lucifer/apps/mobile && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "mobile typecheck and lint clean" && npx jest 2>&1 | grep -E "^Tests:|^Test Suites:"
cd /d/kd/lucifer/apps/desktop && timeout 250 npm test 2>&1 | grep -E "^# (tests|pass|fail)" && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "desktop typecheck and lint clean"
cd /d/kd/lucifer && npm run test:release-native 2>&1 | grep -E "^# (tests|pass|fail)"
cd /d/kd/lucifer/apps/cafe && npm run typecheck > /dev/null && npm run lint > /dev/null && echo "cafe typecheck and lint clean"
cd /d/kd/lucifer/apps/cafe && npm test > "$SP/cafe-n4.log" 2>&1; grep -E "^# (tests|pass|fail|skipped)" "$SP/cafe-n4.log"
cd /d/kd/lucifer/apps/mobile/android && GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat :app:testDebugUnitTest --rerun --console=plain > "$SP/junit-n4.log" 2>&1; tail -3 "$SP/junit-n4.log"
cat app/build/test-results/testDebugUnitTest/*.xml | grep -o '<testsuite [^>]*' | sed -E 's/.*tests="([0-9]+)".*failures="([0-9]+)".*errors="([0-9]+)".*/\1 \2 \3/' | awk '{t+=$1; f+=$2; e+=$3} END {print "tests="t" failures="f" errors="e}'
```
Expected: mobile 168/168, typecheck and lint clean, `Test Suites: 4 passed`, `Tests: 8 passed`; desktop 211/211,
typecheck and lint clean; `# tests 12`, `# pass 12`; cafe typecheck and lint clean; cafe `# tests 5807`,
`# pass 5806`, `# fail 0`, `# skipped 1`; JUnit `tests=94 failures=0 errors=0`. (The cafe chain in the background.)

### Task 44: The 2.0.0 release set

**Files:** scratch only (`$SP`) and the release folder `D:\kd\pos-apk-release\Sandbee-POS-2.0.0\` (outside the repo);
nothing committed. Nothing is uploaded: the owner gets the folder's path and its `UPLOAD-STEPS.txt`.

- [ ] **Step 1: The scratch tools.** Copy `D:\kd\pos-dev-keep\phase3-final-gate\ui.py` and `type-secret.py` into `$SP`
(ui.py: `dump [filter]`, `shot <name>`; type-secret.py types the e2e admin's password into a focused password field and
prints only its length). Write these into `$SP`:

`$SP/n4-builds.sh` (every artifact, read back in full):

```bash
#!/bin/bash
# Session N4 (Task 44): every artifact of the 2.0.0 set, from the repo at its head, read back in full. The release pair
# and the Windows installer (npm run dist: apps/desktop/dist) are the release; the x86_64 APK (the real base) and the
# test APKs A (2.0.0) and B (2.0.1) (the test base http://127.0.0.1:8765/pos, 1-minute times) are for the emulator smoke
# only. Local only, released to nobody. usage: n4-builds.sh <out>
OUT="$1"; mkdir -p "$OUT/pair" "$OUT/x86" "$OUT/ab" "$OUT/readback"; S="$OUT/build.txt"; : > "$S"
BT="/c/Users/kartik.desai/AppData/Local/Android/Sdk/build-tools/37.0.0"
cd /d/kd/lucifer/apps/mobile/android || exit 2
echo "start $(date -Is) head $(git rev-parse --short HEAD)" >> "$S"; df -h /c /d >> "$S"
G() { GRADLE_USER_HOME='D:\gradle-home' ./gradlew.bat "$@" --console=plain; }
G :app:compileReleaseKotlin --rerun > "$OUT/kotlin-pair.log" 2>&1; echo "kotlin pair exit=$?" >> "$S"
G assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a > "$OUT/pair.log" 2>&1; echo "pair exit=$? $(grep -E '^BUILD' "$OUT/pair.log")" >> "$S"
cp app/build/outputs/apk/release/app-arm64-v8a-release.apk app/build/outputs/apk/release/app-armeabi-v7a-release.apk "$OUT/pair/"
G aR -PreactNativeArchitectures=x86_64 > "$OUT/x86.log" 2>&1; echo "x86_64 exit=$? $(grep -E '^BUILD' "$OUT/x86.log")" >> "$S"
cp app/build/outputs/apk/release/app-release.apk "$OUT/x86/Sandbee-POS-2.0.0-x86_64.apk"
T="-PreactNativeArchitectures=x86_64 -PposUpdateBase=http://127.0.0.1:8765/pos -PposUpdateCheckMinutes=1 -PposUpdateReopenMinutes=1"
G :app:compileReleaseKotlin --rerun $T > "$OUT/kotlin-a.log" 2>&1; echo "kotlin A exit=$?" >> "$S"
G aR $T > "$OUT/a.log" 2>&1; echo "A exit=$? $(grep -E '^BUILD' "$OUT/a.log")" >> "$S"
cp app/build/outputs/apk/release/app-release.apk "$OUT/ab/A-2.0.0-x86_64.apk"
G :app:compileReleaseKotlin --rerun $T -PposVersion=2.0.1 > "$OUT/kotlin-b.log" 2>&1; echo "kotlin B exit=$?" >> "$S"
G aR $T -PposVersion=2.0.1 > "$OUT/b.log" 2>&1; echo "B exit=$? $(grep -E '^BUILD' "$OUT/b.log")" >> "$S"
cp app/build/outputs/apk/release/app-release.apk "$OUT/ab/Sandbee-POS-2.0.1-x86_64.apk"
# The repo's last release classes back to the real base (a later plain aR must not reuse the test base).
G :app:compileReleaseKotlin --rerun > "$OUT/kotlin-reset.log" 2>&1; echo "kotlin reset exit=$?" >> "$S"
for f in "$OUT"/pair/*.apk "$OUT"/x86/*.apk "$OUT"/ab/*.apk; do
  b=$(basename "$f" .apk)
  echo "== $b $(stat -c %s "$f") $(sha256sum "$f" | cut -c1-64)" >> "$S"
  java -jar "$BT/lib/apksigner.jar" verify --print-certs "$f" > "$OUT/readback/$b.apksigner.txt" 2>&1; echo "apksigner exit=$?" >> "$S"
  "$BT/aapt2.exe" dump badging "$f" > "$OUT/readback/$b.badging.txt" 2>&1
  "$BT/aapt2.exe" dump resources "$f" > "$OUT/readback/$b.resources.txt" 2>&1
  grep -E "certificate SHA-256" "$OUT/readback/$b.apksigner.txt" >> "$S"
  grep -E "^package:|native-code|application-debuggable" "$OUT/readback/$b.badging.txt" >> "$S"
  grep -A1 -E "(string/pos_update_base|integer/pos_update_(check|reopen)_minutes)" "$OUT/readback/$b.resources.txt" >> "$S"
done
cd /d/kd/lucifer/apps/desktop || exit 3
env -u ELECTRON_RUN_AS_NODE npm run dist > "$OUT/dist.log" 2>&1; echo "installer exit=$?" >> "$S"
ls -la dist >> "$S"; cat dist/latest.yml dist/win-unpacked/resources/app-update.yml >> "$S" 2>&1
df -h /c /d >> "$S"; echo "DONE $(date -Is)" >> "$S"
```

`$SP/mkenv4.py` (the local POS env, a fresh database, port 3110; prints no value):

```python
# Session N4: copies the kept e2e.env into <dir> (type-secret.py reads it there) and writes <dir>/n4.env for the local
# POS: a fresh database (pos_scratch_e2e_n4s) and port 3110. Prints no value. usage: python mkenv4.py <dir>
import io
import os
import sys

out_dir = sys.argv[1]
src = io.open(r"D:\kd\pos-dev-keep\env\e2e.env", encoding="utf-8").read()
io.open(os.path.join(out_dir, "e2e.env"), "w", encoding="utf-8", newline="\n").write(src if src.endswith("\n") else src + "\n")
out = []
for line in src.splitlines():
    if line.startswith("MONGODB_URI="):
        line = "MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_e2e_n4s"
    elif line.startswith("NEXTAUTH_URL="):
        line = "NEXTAUTH_URL=http://localhost:3110"
    out.append(line)
io.open(os.path.join(out_dir, "n4.env"), "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
print("n4.env keys:", ", ".join(l.split("=", 1)[0] for l in out if "=" in l))
```

`$SP/n2-files.mjs` (Session N2's fake files.sandbee.in, unchanged):

```js
// Native apps 2.0, Session N2 (emulator end to end): a fake files.sandbee.in on 127.0.0.1:8765 (the emulator reaches it
// through `adb reverse tcp:8765 tcp:8765`). It serves /pos/android/latest.json for the update APK given on the command
// line, and that APK, and logs every request. Switch answers with GET /__mode?manifest=404|ok|wronghash&apk=fast|slow;
// read the log with GET /__log. Local only; scratch, never committed.
// usage: node n2-files.mjs <path to the 2.0.1 APK> <log file>
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename } from 'node:path';

const [apkPath, logPath] = process.argv.slice(2);
const apk = readFileSync(apkPath);
const file = 'Sandbee-POS-2.0.1-x86_64.apk';
const sha256 = createHash('sha256').update(apk).digest('hex');
const size = statSync(apkPath).size;
const mode = { manifest: '404', apk: 'fast' };
const lines = [];

function log(text) {
  const line = new Date().toISOString() + ' ' + text;
  lines.push(line);
  appendFileSync(logPath, line + '\n');
}

function manifest() {
  return JSON.stringify({
    schema: 1,
    package: 'com.possoftware.pos',
    version: '2.0.1',
    versionCode: 20001,
    released: '2026-10-12',
    notes: 'A test update from the fake files server.',
    apks: { x86_64: { file, sha256: mode.manifest === 'wronghash' ? '0'.repeat(64) : sha256, size } },
  });
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:8765');
  if (url.pathname === '/__mode') {
    for (const key of ['manifest', 'apk']) {
      const value = url.searchParams.get(key);
      if (value) mode[key] = value;
    }
    log('MODE ' + JSON.stringify(mode));
    res.end(JSON.stringify(mode) + '\n');
    return;
  }
  if (url.pathname === '/__log') {
    res.end(lines.join('\n') + '\n');
    return;
  }
  log(req.method + ' ' + url.pathname + ' (manifest=' + mode.manifest + ', apk=' + mode.apk + ')');
  if (url.pathname === '/pos/android/latest.json') {
    if (mode.manifest === '404') {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<html><body>404 Not Found</body></html>');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(manifest());
    return;
  }
  if (url.pathname === '/pos/android/' + file) {
    res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-length': String(size) });
    if (mode.apk !== 'slow') {
      res.end(apk);
      log('sent ' + file + ' (' + size + ' bytes)');
      return;
    }
    // slow: 64 KB every 250 ms (about 256 KB/s), so a test can hide the app while the download runs.
    let at = 0;
    const timer = setInterval(() => {
      const next = Math.min(at + 65536, size);
      res.write(apk.subarray(at, next));
      at = next;
      if (at >= size) {
        clearInterval(timer);
        res.end();
        log('sent ' + file + ' slowly (' + size + ' bytes)');
      }
    }, 250);
    req.on('close', () => clearInterval(timer));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(8765, '127.0.0.1', () => log('listening for ' + basename(apkPath) + ' sha256 ' + sha256 + ' size ' + size));
```

- [ ] **Step 2: Build** (background; wait for `DONE` in `$SP/n4-apk/build.txt` with an until-loop):
`bash "$SP/n4-builds.sh" "$SP/n4-apk"`. Expected, as at the gate (about 4 minutes): `kotlin pair exit=0`,
`pair exit=0 BUILD SUCCESSFUL`, `x86_64 exit=0 BUILD SUCCESSFUL`, `kotlin A exit=0`, `A exit=0 BUILD SUCCESSFUL`,
`kotlin B exit=0`, `B exit=0 BUILD SUCCESSFUL`, `kotlin reset exit=0`; every APK `apksigner exit=0` and
`V2 Signer: certificate SHA-256 digest: 5bd06ef3e9a78efcb0dfbd1ff102de932c581a78034d93ef7572f5373b5b3e40`; the pair
`versionCode='20000' versionName='2.0.0'`, `native-code: 'arm64-v8a'` / `'armeabi-v7a'`, `() 720`, `() 30`,
`() "https://files.sandbee.in/pos"` (the gate's pair at `543b193`: arm64 7,362,354 B `0dc49fc6…`, armv7 6,770,188 B
`86c88741…`; Task 40 changes only a test in `apps/mobile`, so equal hashes are likely, not required); the x86_64 APK the
same with `native-code: 'x86_64'`; A `2.0.0` and B `versionCode='20001' versionName='2.0.1'`, both `() 1`, `() 1`,
`() "http://127.0.0.1:8765/pos"`; `installer exit=0`, `dist\POS-Software-Setup-2.0.0.exe` (about 112.5 MB), its
`.blockmap`, `latest.yml` `version: 2.0.0`, and `provider: generic`, `url: https://files.sandbee.in/pos/windows`,
`updaterCacheDirName: pos-desktop-updater`.

- [ ] **Step 3: The release folder.** From `/d/kd/lucifer`, with `A="$(cygpath -w "$SP")\\n4-apk"`:

```bash
node scripts/release-native.mjs --arm64 "$A\\pair\\app-arm64-v8a-release.apk" --armv7 "$A\\pair\\app-armeabi-v7a-release.apk" --windows "apps\\desktop\\dist" --notes "Sandbee POS now updates itself. You will see a card like this when a new version is ready."
cd /d/kd/pos-apk-release/Sandbee-POS-2.0.0 && sha256sum -c SHA256SUMS.txt && cat upload/pos/android/latest.json && cd /d/kd/lucifer
node scripts/release-native.mjs --arm64 "$A\\ab\\A-2.0.0-x86_64.apk" --armv7 "$A\\pair\\app-armeabi-v7a-release.apk" --windows "apps\\desktop\\dist" --notes "x" --out "$(cygpath -w "$SP")\\refused"; echo "exit=$?"
node scripts/release-native.mjs --arm64 "$A\\pair\\app-arm64-v8a-release.apk" --armv7 "$A\\pair\\app-armeabi-v7a-release.apk" --windows "apps\\desktop\\dist" --notes "x"; echo "exit=$?"
```
Expected, as at the gate (it wrote into a scratch folder): `Sandbee POS 2.0.0 (versionCode 20000): D:\kd\pos-apk-release\Sandbee-POS-2.0.0`
and the six files `upload/pos/android/Sandbee-POS-2.0.0-arm64-v8a.apk`, `…-armeabi-v7a.apk`, `upload/pos/android/latest.json`,
`upload/pos/windows/POS-Software-Setup-2.0.0.exe`, `….exe.blockmap`, `upload/pos/windows/latest.yml`; `sha256sum -c` says
`OK` six times; `latest.json` with `"version": "2.0.0"`, `"versionCode": 20000`, today's `"released"`, the notes, and
both APKs with the pair's hashes and sizes; `release-native: refused: A-2.0.0-x86_64.apk: native code x86_64, not
arm64-v8a alone`, `exit=1`; `release-native: refused: D:\kd\pos-apk-release\Sandbee-POS-2.0.0 already exists: a
release folder is written once`, `exit=1`; no `Sandbee-POS-2.0.0.partial` is left. If `D:\kd\pos-apk-release\Sandbee-POS-2.0.0`
(or a `.partial` of it) exists before the first command, stop and ask the owner (never delete or overwrite it).

- [ ] **Step 4: The local POS, the fake files server and the fake printer**

```bash
python -X utf8 "$SP/mkenv4.py" "$(cygpath -w "$SP")"
cd /d/kd/lucifer/apps/cafe && node /d/kd/pos-dev-keep/phase3-final-gate/dbs.cjs pos_scratch_e2e_n4s
MSYS_NO_PATHCONV=1 node --env-file="$(cygpath -w "$SP")/n4.env" --import tsx scripts/seed-admin.ts 2>&1 | grep -E "created|exists"
netstat -ano | grep LISTEN | grep -E ":(3110|8765|9100) "
```
Expected: `n4.env keys: MONGODB_URI, NEXTAUTH_SECRET, AUTH_SECRET, NEXTAUTH_URL, AUTH_TRUST_HOST, SEED_ADMIN_USERNAME,
SEED_ADMIN_PASSWORD`; `(none with pos_scratch_e2e_n4s)`; `Admin account created.`; nothing listening. Then, each in the
background: `cd /d/kd/lucifer/apps/cafe && MSYS_NO_PATHCONV=1 node --env-file="$(cygpath -w "$SP")/n4.env" ../../node_modules/next/dist/bin/next start -p 3110 > "$SP/next.log" 2>&1`,
`node "$SP/n2-files.mjs" "$(cygpath -w "$SP")\\n4-apk\\ab\\Sandbee-POS-2.0.1-x86_64.apk" "$(cygpath -w "$SP")\\files.log"`
and `cd /d/kd/lucifer && node scripts/fake-escpos-printer.mjs --port 9100 --out "$(cygpath -w "$SP")\\printer-out"`
(then `keep.txt` in `printer-out`). Expected: `curl -s http://localhost:3110/api/health` → `{"ok":true,"db":"up","tenant":"dev",…}`;
`files.log` says `listening for Sandbee-POS-2.0.1-x86_64.apk sha256 <B's> size <B's>`; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8765/pos/android/latest.json` → `404`.
(`apps/cafe/.next` must exist; it did at the gate. If it does not, stop and report. If a port already listens, stop and
report; never stop another program's process.)

- [ ] **Step 5: The emulator and the one-time move.** `df -h /c` (≥ 3 GB free), then in the background (timeout 2 h)
`/c/Users/kartik.desai/AppData/Local/Android/Sdk/emulator/emulator.exe -avd Pixel_7_API_33 -no-snapshot -memory 2048 -no-boot-anim -no-audio`;
wait for `adb shell getprop sys.boot_completed` = 1. Then:

```bash
adb shell pm path com.possoftware.pos && adb shell dumpsys package com.possoftware.pos | grep -E "versionName|versionCode" | head -2
adb shell pm uninstall com.possoftware.pos
adb reverse tcp:3110 tcp:3110 && adb reverse tcp:8765 tcp:8765 && adb reverse tcp:9100 tcp:9100 && adb reverse --list
adb install "$SP/n4-apk/x86/Sandbee-POS-2.0.0-x86_64.apk" && adb logcat -c && adb logcat -b crash -c && adb shell monkey -p com.possoftware.pos -c android.intent.category.LAUNCHER 1
```
Expected: the gate left the debug-key release 1.0 (`versionCode=1`); `Success`; three reverses listed; `Success`. This
is the one-time move of GO-LIVE's new section (uninstall, install 2.0.0). Then, as at the gate: `adb logcat -d -s PosUpdate`
→ `open`, `check: no answer` (the release APK looks at `https://files.sandbee.in/pos`, which has no DNS record yet). On
the start screen tap the field (`ui.py dump EditText`), `adb shell input text "http://localhost:3110"` (with
`MSYS_NO_PATHCONV=1`), Back, tap **Open POS**. The sign-in page loads in the WebView (a dump may still show the start
screen's nodes: use `ui.py shot`; the username field was at about 540,1392 and the password at 540,1632 on the
1080 × 2400 screen): tap the username field, `adb shell input text e2eadmin`, `keyevent 61`, `type-secret.py`,
`keyevent 66`. Expected: the Dashboard, and `adb logcat -b crash -d` empty.

- [ ] **Step 6: A print.** Tap the top bar's printer button ("Printer not connected — open printer set…", about
980,208), swipe up once (`input swipe 540 2000 540 600 600`), tap the **Printer address** field, `input text 127.0.0.1`,
Back, tap **Use this network printer** (port 9100 is the default). Expected: "Network printer 127.0.0.1 is connected.".
Then **Print test slip** → `printer-out/jobs.log` gets a job with `"bytes":` about 13,700 and `"statusOnly":false` (the
gate's: 13,706 bytes); answer **Yes** to "Did the test slip print?", then **Done**. No crash.

- [ ] **Step 7: Cancel in Android's dialog** (the N2 gate's ruling for N4: the card closes and comes back at the next
open). `curl -s "http://127.0.0.1:8765/__mode?manifest=ok&apk=fast"`, then `adb install -r "$SP/n4-apk/ab/A-2.0.0-x86_64.apk"`
(the same key and version: it keeps the sign-in), `adb logcat -c`, launch. Expected, as at the gate: `open`, `download:
2.0.1 verified (<B's size> bytes)` (no card in this open). HOME, wait 70 s, launch → `open`, `check: 2.0.1 is ready`,
`card: 2.0.1` and the card ("Update available", "Sandbee POS 2.0.1 is ready to install.", "A test update from the fake
files server.", the first-install line, Install, Later). **Install** → `install: permission`, "Install unknown apps" for
Sandbee POS 2.0.0 → **Allow from this source** (`adb shell appops get com.possoftware.pos REQUEST_INSTALL_PACKAGES` →
`allow`) → Back → the card with "Allow Sandbee POS to install apps, then tap Install again." (the same process: `adb
shell pidof com.possoftware.pos` unchanged) → **Install** → `install: started`, "Do you want to update this app?" →
**Cancel** → `install: cancelled`, the card gone with no line, the same process. HOME, wait 70 s, launch → `open`,
`check: 2.0.1 is ready`, `card: 2.0.1`. No crash (`adb logcat -b crash -d` empty).

- [ ] **Step 8: Put the emulator back**: `adb shell pm uninstall com.possoftware.pos`, `adb install D:/kd/pos-dev-keep/apk-release/pos-emulator-x86_64-release.apk` (the debug-key 1.0, sha256 `29115bdf…`), `adb reverse --remove-all`, `adb shell sync`, `adb emu kill`. Stop this session's `next start`, fake files server and fake printer by their PIDs (`netstat -ano | grep LISTEN | grep -E ":(3110|8765|9100) "`, check each command line, then `Stop-Process -Id`); never another program's. The scratch database `pos_scratch_e2e_n4s` stays; name it in the Results.

### Task 45: The final review, the Results, the owner's merge OK

- [ ] **Step 1: A fresh review of the whole native apps 2.0 work** on Claude Fable 5.1 (on a 429 limit: wait for the
reset and say so; never switch models silently): the spec, this plan, the diff `1672a85..HEAD` (everything native apps
2.0 brought on top of the owner's last main before the N3 merge: Sessions N1–N4), the Results sections and the release
folder's files (read only). Read-only for the reviewer: no Gradle, no npm install, no emulator, no servers, no network,
no file written (save its report into `$SP` yourself). Critical and Important findings: one fix pass, each by TDD (RED
first), the suites again; minors to the Results for the owner. **If the fix pass changes `apps/mobile`, `apps/desktop`
or `scripts/release-native.mjs`**, the release folder from Task 44 no longer matches the head (the gate review's I-1):
stop and ask the owner first; with the owner's OK rename the earlier folder to
`D:\kd\pos-apk-release\Sandbee-POS-2.0.0.superseded-<its head>` (never delete it), then repeat Task 44 Steps 2–3
(and Steps 4–8 when the Android updater changed); the Results name both folders and why.

- [ ] **Step 2: Every suite** (as Task 43, after any fix).

- [ ] **Step 3: Results and commit.** Append `## Session N4 Results` to this plan (the counts, the commits, each step's
evidence, the APK and installer hashes, the release folder's `SHA256SUMS.txt`, the review, anything that differed and
why) and commit (`$SP/msg-n4-5.txt`):

```text
docs(apps): native apps 2.0 Session N4 results: the release folder for 2.0.0 (built, packaged and read back), the docs, the emulator smoke (the one-time move, a print, Cancel in Android's dialog), the final review and every suite recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
Update the project memory (`native-apps-2-2026-10.md` and its MEMORY.md line). No push and no merge in this session:
report to the owner in Hinglish (the release folder's path, `UPLOAD-STEPS.txt`, the review) and ask for the merge OK; the
S3 bucket and `files.sandbee.in` are set up with the owner, step by step, after that (spec §10).

---

## Session N1 Results

Run on 2026-10-12 in one session (superpowers:executing-plans, inline), Tasks 0–6 in order, code copied verbatim from
this plan. Nothing pushed, merged, uploaded or released.

### Commits (branch `feat/native-apps-2`, from `8588479`)

| Task | Commit | What |
|---|---|---|
| 1 | `0fc281c` | one version 2.0.0, versionCode computed, pin 27 |
| 2 | `5db3ca2` | the release-key guard, no debug-key fallback, README "### 1. The signing key", pin 28 |
| 3 | `c8568e4` | update base and times as build settings, `res/raw/pos_update_keep.xml`, pin 29 |
| 4 | `865a9ec` | `UpdateManifest` + 9 JUnit, `org.json:json:20180813` (test only) |
| 5 | `8f3d44a` | `UpdateSchedule` + 8 JUnit |
| review | `443df45` | the cafe go-live runbook's Windows-app version pin follows 2.0.0 (the review's I-1) |
| 6 | this commit | these Results |

### Counts

| Suite | Baseline | After N1 | Expected |
|---|---|---|---|
| mobile (`npm test`) | 148 | 154, 0 fail | baseline + 6 |
| desktop (`npm test`) | 205 | 205, 0 fail | baseline |
| JUnit (`:app:testDebugUnitTest --rerun`) | 65 | 82, 0 failures, 0 errors | baseline + 17 |
| typecheck + lint (mobile, desktop) | clean | clean | clean |
| cafe chain (`apps/cafe`, `npm test`) | not in this plan's list (see I-1) | 5656: 5655 pass, 0 fail, 1 skipped; typecheck clean | — |

The plan's "last known" mobile count was 143; the launcher icon fix `57f93be` (on this branch) added
`src/app-icon.test.ts` (5 tests), so the baseline is 148.

### The key (Task 2)

- `D:\kd\pos-signing\sandbee-pos-release.jks`, made once with Step 6's command on 2026-10-12 14:17 IST: 4322 bytes,
  PKCS12, alias `sandbee-pos`, RSA 4096, `SHA384withRSA`, `CN=Sandbee POS, O=sandbee, C=IN`.
- Valid from 2026-10-12 until 2066-10-12.
- Certificate SHA-256: `5B:D0:6E:F3:E9:A7:8E:FC:B0:DF:BD:1F:F1:02:DE:93:2C:58:1A:78:03:4D:93:EF:75:72:F5:37:3B:5B:3E:40`
  (apksigner: `5bd06ef3e9a78efcb0dfbd1ff102de932c581a78034d93ef7572f5373b5b3e40`; N4's `EXPECTED_CERT_SHA256`). Not the
  React Native debug key (`FA:C6:17:45:…`).
- Four `POS_RELEASE_` lines in `D:\gradle-home\gradle.properties` (the file did not exist before). No password was
  printed, logged, committed or reported.
- **The owner's backup (Step 10): pending.** N2's prompt waits for the owner's confirmation.

### Guard dry runs (Task 2 Step 8)

1. `assembleRelease --dry-run -PPOS_RELEASE_KEY_ALIAS=` → `A release build needs the private Sandbee POS key: set
   POS_RELEASE_KEY_ALIAS in D:\gradle-home\gradle.properties (apps/mobile/README.md). It never signs with the debug key.`,
   `BUILD FAILED`.
2. `aR --dry-run -PPOS_RELEASE_STORE_FILE=D:/kd/pos-signing/no-such.jks` → `The release key file is missing:
   D:/kd/pos-signing/no-such.jks`, `BUILD FAILED` (an `aR` build is caught).
3. `assembleRelease --dry-run` with the key → `BUILD SUCCESSFUL`.

### Gradle settings checks (Tasks 1 and 3)

- `:app:help` → `BUILD SUCCESSFUL`; `-PposVersion=2.0` → `posVersion must look like 2.0.0, minor and patch below 100: 2.0`,
  `BUILD FAILED`.
- `-PposUpdateBase=http://example.com/pos` → `posUpdateBase must be https://<host>/<path>, or
  http://127.0.0.1:<port>/<path> for a test build: …`, `BUILD FAILED`; `-PposUpdateCheckMinutes=1` (real base) → `… are for
  test builds only …`, `BUILD FAILED`.
- `:app:generateDebugResValues` (the task name as in the plan) with the test base and times → `http://127.0.0.1:8765/pos`,
  `1`, `1`; without them → `https://files.sandbee.in/pos`, `720`, `30`.

### Release read-back (Task 6)

One release pair from `8f3d44a` (`:app:compileReleaseKotlin --rerun` exit 0, then `assembleRelease
-PreactNativeArchitectures=arm64-v8a,armeabi-v7a`, `BUILD SUCCESSFUL`), kept in the session scratchpad only, released to
nobody:

| APK | Bytes | SHA-256 |
|---|---|---|
| `app-arm64-v8a-release.apk` | 7,347,394 | `5cae6c908757aee393986ce257c6f42c6752d8d44bb30f941ca1a6a173760a1f` |
| `app-armeabi-v7a-release.apk` | 6,755,228 | `ebb77ae2521567909d3e83c0542735bb90689df046928ac6bab403091aa6ec53` |

Both: one signer, APK Signature Scheme v2 only (minSdk 24), `CN=Sandbee POS, O=sandbee, C=IN`, certificate SHA-256
`5bd06ef3…3e40` (the key above, not `fac61745…`); `package: name='com.possoftware.pos' versionCode='20000'
versionName='2.0.0'`; no `application-debuggable`; `string/pos_update_base` → `"https://files.sandbee.in/pos"`,
`integer/pos_update_check_minutes` → 720, `integer/pos_update_reopen_minutes` → 30, all found by name (the shrinker kept
them). D: had 13 GB free before and after.

### Differences from this plan, and why

1. **Pin 29's base needle (Task 3).** The plan's needle `resValue "string", "pos_update_base", posUpdateBase` is a prefix
   of its own mutation's result (`… posUpdateBaseDefault`), so `pin 29 mutation` failed ("mutation not caught") on the
   correct code, and a real regression to the default base would have passed the pin. The one needle now ends at the
   line end (`… posUpdateBase\n`); the mutation table is unchanged. Stricter, not looser; the repo is LF-only
   (`.gitattributes`), as pin 27's `\n` needles already assume.
2. **Task 1's RED wording.** `pin 27 mutation` failed on `everyMutationCaught`'s "baseline must be clean", which the helper
   checks before any mutation target; the plan expected "mutation target not found". Same cause (nothing implemented).
3. **apksigner's output (Task 6).** build-tools 37's apksigner prints `V2 Signer: certificate DN: …` and `V2 Signer:
   certificate SHA-256 digest: …`, not `Signer #1 certificate …`. Same facts. N4's packaging must read this form.

### The session's fresh review (Claude Fable 5.1, `8588479..8f3d44a`)

Verdict "with fixes": 0 Critical, 2 Important, 5 Minor. The reviewer diffed every block of this plan against the commits
(identical, except the pin 29 needle above) and found no other needle in pins 27–29 that is a prefix of its mutation.

- **I-1, fixed (`443df45`).** `apps/cafe/lib/go-live-runbook.test.ts` pins `apps/desktop/package.json`'s version
  (`"1.12.0"`, "the Windows app of Phase 3"); Task 1's 2.0.0 turned it red (96/97). This session's suite list never ran
  the cafe chain. The pin now says `"2.0.0"`, with a "Native apps 2.0 Session N1 deliberately changed" comment, as
  Session 3E did for 1.12.0; the Phase 2 and Phase 3 steps' installer names are unchanged. RED → GREEN 97/97; the whole
  cafe chain passes: 5656 tests, 5655 pass, 0 fail, 1 skipped; cafe typecheck clean. **N2–N4's "every suite" steps must include the cafe chain (`apps/cafe`: `npm test`).**
- **I-2, not changed here (for the N1 gate).** `UpdateSchedule`'s KDoc says "Main thread only", but N2 Task 4's
  `@ReactMethod takeCard` runs on the NativeModules thread while `shown`/`hidden` run on the UI thread. N1 has no caller
  and its code is this plan's, so the gate decides when it makes N2 exact: `@Synchronized` on `shown`, `hidden` and
  `takeCard` (tests unchanged), or a `UiThreadUtil` hop in `PosUpdateModule` and a pin.
- **Minors, for the gate:** m-3 `UpdateManifest` catches only `JSONException`; a deeply nested ≤ 16 KB body can throw
  `StackOverflowError`, so N2's check thread needs a catch-all (or catch `Throwable` around the parse, with a JUnit case);
  m-4 `"notes": null` ignores the whole manifest (treat `JSONObject.NULL` as absent, or N4's writer omits the key);
  m-5 a UTF-8 BOM makes `latest.json` "not JSON" silently (N2 strips a leading U+FEFF and/or N4 refuses it); m-6 the
  guard's message names `D:\gradle-home\gradle.properties` only (another build PC uses `%USERPROFILE%\.gradle`); m-7
  `pos_update_keep.xml` says the build does not package it, but a debug build does (release drops it).
- **The reviewer's notes for N2/N4:** N2 Task 5's "going to the background drops a card" conflicts with E5 (the "Install
  unknown apps" setting and the installer's confirm screen put the app in the background mid-install): a
  `waitingFor: 'permission' | 'installer'` state should survive one background round trip; N2's pins should require
  `SystemClock.elapsedRealtime()` for `shown`/`hidden`; a system dialog at start (Bluetooth enable) pauses the activity
  between `shown()` and `takeCard()` and drops that open's card (the next open offers it again); N4's packaging must read
  apksigner's `V2 Signer: certificate SHA-256 digest:` line.

---

## N1 review gate (2026-10-12)

Run right after Session N1, in the same Claude session, once the owner confirmed the key backup ("done dono le li hai,
safe jagah add kar di hai", 2026-10-12: the key file and the four `POS_RELEASE_` lines, in two safe places). The fresh
eyes were the N1 review (Claude Fable 5.1, a fresh context, before the Results commit) and this gate's own review of
Session N2's exact code (below). Nothing pushed, merged, uploaded or released.

### N1 re-verified

- Commits `0fc281c`, `5db3ca2`, `c8568e4`, `865a9ec`, `8f3d44a`, `443df45`, `6da60fa` read; every N1 code block is this
  plan's, but pin 29's ruled needle (the N1 review diffed each block).
- Suites at `6da60fa`: mobile 154, Jest 5, desktop 205, JUnit 82 (0 failures, 0 errors), the cafe chain 5656 (5655 pass,
  0 fail, 1 skipped), typecheck and lint clean in both apps.
- The key: certificate SHA-256 `5B:D0:6E:F3:…:3B:5B:3E:40`, valid to 2066-10-12; the release read-back as in the N1
  Results. The owner's two backups: confirmed.

### Rulings on the N1 review

| Finding | Ruling |
|---|---|
| I-1 the cafe runbook pin on the desktop version | Fixed in N1 (`443df45`). Every later session's suites include the cafe chain (N2 Tasks 20/26; N3 and N4 below). |
| I-2 `UpdateSchedule` "main thread only" vs a `takeCard` off it | The schedule stays single-threaded; `PosUpdateModule.takeCard` runs on the main thread (`UiThreadUtil.runOnUiThread`), pinned by pin 32. |
| m-3 a deeply nested body overflows the parser | N2 Task 20: caught as "not JSON" (JUnit `aFileNestedTooDeepIsIgnoredNeverACrash`); the module's look also catches any `Throwable` (pin 32). |
| m-4 `"notes": null` | N2 Task 20: null is no notes (JUnit `aNullNoteIsNoNote`). |
| m-5 a byte order mark | N2 Task 20: removed before parsing (JUnit `aByteOrderMarkBeforeTheManifestIsRead`). |
| m-6 the guard's message names this PC's folder only | N2 Task 20: "gradle.properties in the Gradle user home (D:\gradle-home on the build PC; …)", a pin 28 needle. |
| m-7 the keep file's comment | N2 Task 20: says what a debug build carries. |
| The reducer would drop the card on Android's own screens (E5) | N2 Task 25: `waiting: 'permission' \| 'installer'` survives one background round trip; proven on the emulator (the card came back after "Install unknown apps" and after Cancel in Android's dialog). |
| `elapsedRealtime` for `shown`/`hidden` | Pin 32. |
| A start-up system dialog (Bluetooth) drops that open's card | Stands: the next app open offers it again (spec §6.3, once per open); cost if wrong: a device that always shows a dialog at start sees the card only after 30 minutes away or a restart. |
| apksigner 37 prints `V2 Signer: …` | N4 Task 41 below reads that form. |

### Session N2 made exact and pre-validated

- Gold worktree `D:\kd\n2g` (detached from `6da60fa`): commits `8a49c73` (Task 20) … `a8abc8a` (Task 25), tree
  `b27e0720af2534ee0545b49a40e795ca42f0192f`; the N2 section's blocks were generated from those commits. Applied to a
  fresh worktree at `6da60fa`, they give the same `apps/` tree (checked before this commit).
- Gold suites: mobile 167, Jest 7 (4 suites), JUnit 92, typecheck and lint clean (N2 touches no desktop or cafe file).
- First test APKs from gold (x86_64, the private key, `http://127.0.0.1:8765/pos`, 1-minute times; 7,492,529 bytes each;
  A `58d71fd7…`, B `f76bcd04…`): on the emulator (API 33, WebView 109) **E1, E2, E7, E4 (Later, the next open), a cold
  start, E5 (the permission page, Cancel in Android's dialog, Update, Play Protect, back as 2.0.1 and still signed in), E6
  and E3 passed** with the logcat lines Task 26 expects; screenshots in `D:\kd\n2g-apk\shots\`.
- After the review's fixes (below), second test APKs from the final gold (A `d685d33a…`, B `8f8d01c3…`, 7,492,605 bytes):
  the first open's download `verified` (ApkCheck with both signing flags), the card at the next open, Install →
  "Install unknown apps" → back → the card with the permission note, Install → Update → Play Protect (Install without
  scanning) → 2.0.1, `install: done`, then `check: ignored (not newer)`. Passed.
- The emulator was put back to the debug-key release 1.0 (`29115bdf…`) both times, so N2 rehearses the one-time move.
- Leftover: the scratch database `pos_scratch_e2e_n2g` (one admin; this PC does not drop databases).

### What making N2 exact found

1. **Google Play Protect at the update.** After Android's "Do you want to update this app?" → Update, Play Protect said
   "App scan recommended: Play Protect hasn't seen this app before…" with **Scan app** (sends the APK to Google) and
   **Don't install app**; **More details** shows **Install without scanning**, which installed it. Tests never tap Scan
   app (the local-only rule). A cafe's own phone may show this at the first install and at updates: N4's GO-LIVE text
   says what it is and that either way is fine on the cafe's own device.
2. "Install unknown apps" turned on did not end the app's process on API 33: the card was still there on return.
3. The module is created lazily (at the POS screen's first `takeCard`); React Native posts `onHostResume` for an
   already-resumed screen before that call runs, so the cold-start card works (seen: `open` and `card: 2.0.1` in the same
   millisecond).
4. `getPackageArchiveInfo(…, GET_SIGNING_CERTIFICATES)` gave the APK's signers on API 33; `ApkCheck` matched them.
5. Test procedure: the start screen turns `localhost:3110` into https, so local tests type `http://localhost:3110`;
   Gboard may paste its clipboard into the sign-in field; a uiautomator dump can miss the card (a React Native overlay),
   so cards are read from screenshots and tapped by coordinates.
6. The gate's editing tool wrote a literal U+FEFF where `"\uFEFF"` was meant (in `UpdateManifest.kt` and its test); the
   gold chain was rebuilt with the escape folded into Task 20's commit, the tests re-run (12/12).

### The gate's review of Session N2 (Claude Fable 5.1, a fresh context)

Verdict "ship with fixes": 0 Critical, 1 Important, 9 Minor. It confirmed the lazy-module ordering in React Native's
source, that the card's scrim takes the touches before the WebView and that Back reaches the card first, that every pin
needle catches its mutation (no needle a prefix of its mutation's result), and that Task 26 can be followed on this PC.

- **I-1, fixed: Android 9 would refuse every update.** Android 9 reads a downloaded APK's certificates only when
  `GET_SIGNATURES` is asked for (Android 10 and later for either flag), so `ApkCheck` found no signers, deleted the APK
  and downloaded it again at every check. `ApkCheck` now reads the archive with both flags and falls back to
  `PackageInfo.signatures`; three pin 30 needles (RED, then GREEN); the second emulator run above. Not runnable on this
  PC (the only image is API 33); cost if wrong: Android 9 devices never update and download about 7 MB at each check.
- **#3, folded: the card closed on a slow phone.** If the app's "background" reached the page before `install()`
  answered, the card closed. A tap on Install now dispatches `installing` first (a seventh reducer test, RED then GREEN;
  mobile 166 → 167).
- **#8, folded:** Task 26 Step 4's `pm uninstall && adb reverse …` skipped the reverses when the app was absent; they are
  on their own line now.
- **Deferred to the N2 gate (minors):** #2 two releases between two app opens (the card names 2.0.1, a newer download
  replaces its file, Install waits for it or answers "missing"; rare, nothing breaks); #4 after Home on Android's dialog
  the card stays waiting for the rest of that open; #5 TalkBack can still reach the page behind the card
  (`accessibilityViewIsModal` is iOS-only); #6 the first-install line shows on every card; #7 a call after the module's
  `invalidate()` would throw (unreachable in practice); #10 redirects are followed (TLS and the hash still hold).
- **#9 for N4:** with a PackageInstaller session there is no **Open** button after Update (spec §6.2.4 says "Android's
  dialog then offers Open"): staff open the app from its icon or from "POS printing is off. Tap to start."; and Samsung's
  Auto Blocker (One UI 6+) greys out "Install unknown apps" until it is turned off. N4's GO-LIVE text says both. The
  spec's sentence is a description of Android, not a rule; the behaviour does not change.
- It agreed with the gate's rulings below (E8, E2, the task numbers).

### Gate rulings

- **E8 (a print in flight) is pinned, not run on the emulator.** A TCP job is in flight for at most about 31 s (the
  after-job status wait), while the earliest app open is 1 minute away (the test reopen minimum), so the open cannot be
  made to land on a job without a printers-mode setup and a timed order burst. Pin 32 holds `PrinterPool.anyPrinting()`
  in `takeCard` and in `install`; the event path the waiting card uses (`emitDeviceEvent`) is the one Cancel proved.
  Cost if wrong: a card could cover a print that is running; the print itself is never stopped by a card (only Install's
  confirmation in Android's dialog ends the app, after up to 30 s of waiting).
- **E2's "no file left" is shown by the log** (`download: the size or SHA-256 is not the manifest's`, and the code
  deletes both files on that path): the emulator image has no root and a release app has no `run-as`. Cost if wrong: a
  leftover file is deleted at the next download or start-up anyway.
- **N2's tasks are numbered 20–26**: `task-brief` collects every heading "Task N" in this plan, and N1 already used 0–6.
  N3 becomes 31–36 and N4 41–45 below for the same reason.
- N2 does not build the cafe app; it uses `apps/cafe/.next` as it is (it was there at the gate) and stops if it is not.

### Changes to later sessions

- N3 and N4: every suite includes the cafe chain (`cd apps/cafe && npm test`, 5656 at the gate).
- N4 Task 41: apksigner (build-tools 37) prints `V2 Signer: certificate SHA-256 digest: <hex>`; `EXPECTED_CERT_SHA256` is
  `5bd06ef3e9a78efcb0dfbd1ff102de932c581a78034d93ef7572f5373b5b3e40`.
- N4 Task 42: GO-LIVE says what Play Protect's "App scan recommended" is, that the first update asks once to allow
  installs from Sandbee POS (Samsung: Auto Blocker off first), and that after Update the app is opened from its icon or
  the "POS printing is off" notice (no Open button).
- N4 Task 44: the emulator holds the debug-key 1.0 again after N2, so the smoke test rehearses the one-time move.

## Session N2 Results

Run on 2026-10-12 in one session (superpowers:executing-plans, inline), Tasks 20–26 in order. Every code block was
applied verbatim with the gate's block applier (`apply_blocks_clone.py`, a dry run first, per step range, so each RED
was seen before its code went in). After each task the `apps/` tree equals the gold commit's: Task 20 `17b22860` (gold
`8a49c73`), 21 `af389a48` (`40e8674`), 22 `17a47738` (`bc73ad8`), 23 `96261f28` (`eb8124c`), 24 `fe04ac3f` (`1c6f294`),
25 `32ce7447` (`a8abc8a`). Nothing pushed, merged, uploaded or released.

### Commits (branch `feat/native-apps-2`, from `c1db099`)

| Task | Commit | What |
|---|---|---|
| 20 | `32b988e` | the N1 review's minors m-3 to m-7: three JVM tests, a pin 28 needle |
| 21 | `ecefcae` | `UpdateFiles` + 7 JVM tests |
| 22 | `59e031c` | `UpdateStore`, `UpdateDownloader`, `ApkCheck`, pin 30 |
| 23 | `268955d` | `UpdateInstaller`, `UpdateInstallReceiver`, `REQUEST_INSTALL_PACKAGES`, pin 6 (two receivers), pin 31 |
| 24 | `1186761` | `PosUpdateModule`, `PosUpdatePackage`, `isPrinting`/`anyPrinting`, `src/native/PosUpdate.ts`, pin 32 |
| 25 | `30e0302` | `update-card.ts` (7 node tests), `UpdateCard.tsx`, the card over the POS (2 Jest tests) |
| 26 | this commit | these Results |

### Counts

| Suite | Baseline (`c1db099`) | After N2 (`30e0302`) | Expected |
|---|---|---|---|
| mobile (`npm test`) | 154 | 167, 0 fail | 167 |
| Jest (`npx jest`) | 5 | 7, 4 suites | 7 |
| JUnit (`:app:testDebugUnitTest --rerun`) | 82 | 92, 0 failures, 0 errors | 92 |
| desktop (`npm test`) | 205 | 205, 0 fail | 205 |
| cafe chain (`apps/cafe`, `npm test`) | 5656: 5655 pass, 0 fail, 1 skipped | 5656: 5655 pass, 0 fail, 1 skipped | unchanged |
| typecheck + lint (mobile, desktop) | clean | clean | clean |

Per task: mobile 154 → 154 (20: a needle) → 154 (21) → 156 (22) → 158 (23) → 160 (24) → 167 (25); JUnit 82 → 85 → 92.

### RED, then GREEN (each as the plan's Expected)

- Task 20: pin 28 and its mutation failed with `'the guard sends another build PC to a folder it may not have'`; JUnit
  `20 tests completed, 3 failed` (`aByteOrderMarkBeforeTheManifestIsRead` and `aNullNoteIsNoNote` AssertionError,
  `aFileNestedTooDeepIsIgnoredNeverACrash` `java.lang.StackOverflowError at JSONTokener.java:208`), `BUILD FAILED`. GREEN:
  pins 28–29 4/4, `UpdateManifestTest` 12/12, and the guard dry run printed `… set POS_RELEASE_KEY_ALIAS in
  gradle.properties in the Gradle user home (D:\gradle-home on the build PC; apps/mobile/README.md). It never signs with
  the debug key.`, `BUILD FAILED`. The `\uFEFF` escapes are text in both files (no literal U+FEFF; checked byte-wise).
- Task 21: `13 Unresolved reference 'UpdateFiles'`, `BUILD FAILED`; GREEN `UpdateFilesTest` 7, `UpdateManifestTest` 12,
  `UpdateScheduleTest` 8.
- Task 22: pin 30 both `missing file: …\update\UpdateDownloader.kt`; GREEN 2/2, `compileDebugKotlin --rerun` clean.
- Task 23: pin 6 and its mutation `'the <receiver>s are not PrintingOffReceiver and UpdateInstallReceiver'`, pin 31 both
  `missing file: …\update\UpdateInstaller.kt`, `# fail 4`; GREEN 4/4, compile clean.
- Task 24: pin 32 both `missing file: …\update\PosUpdateModule.kt`; GREEN pins 4, 5, 19, 32 8/8, mobile 160, typecheck and
  lint exit 0, compile clean.
- Task 25: `Cannot find module './update-card'`, `# fail 1`; Jest `Tests: 2 failed, 2 total` (`takeCard` expected 1 call,
  received 0); GREEN 7/7, mobile 167, Jest `Test Suites: 4 passed`, `Tests: 7 passed`.

### Test APKs (Task 26 Step 2, `n2-ab.sh`, head `30e0302`)

x86_64 `aR` builds after `:app:compileReleaseKotlin --rerun` (exit 0 both), the private key, the test base
`http://127.0.0.1:8765/pos`, 1-minute times; kept in the session scratchpad only, released to nobody:

| APK | Bytes | SHA-256 | Read back |
|---|---|---|---|
| A `A-2.0.0-x86_64.apk` | 7,492,605 | `f22e20b87eedcd17d47c2531d6705bf120611d6d745ab0d57a5961aa4f09bb35` | `versionCode='20000' versionName='2.0.0'` |
| B `Sandbee-POS-2.0.1-x86_64.apk` | 7,492,609 | `f704e1eca4f3d10160ae32b7e0949a438a35f2c17c1edb0225b4582dda199331` | `versionCode='20001' versionName='2.0.1'` |

Both: `V2 Signer: certificate SHA-256 digest: 5bd06ef3e9a78efcb0dfbd1ff102de932c581a78034d93ef7572f5373b5b3e40`,
`uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'`, `native-code: 'x86_64'`, `string/pos_update_base`
→ `"http://127.0.0.1:8765/pos"`, both integers `1`. (The hashes differ from the gate's gold-worktree APKs, as builds from
another checkout always have; A's size equals the gate's second A.)

### Emulator end to end (Task 26 Steps 3–6)

Local POS `next start -p 3110` on a fresh database `pos_scratch_e2e_n2s` (`Admin account created.`; health
`{"ok":true,"db":"up","tenant":"dev",…}`), the fake files server `n2-files.mjs` on 127.0.0.1:8765 (`listening for
Sandbee-POS-2.0.1-x86_64.apk sha256 f704e1ec… size 7492609`; the first `GET /pos/android/latest.json` in its log is Step
3's own `curl`, which answered 404). The AVD `Pixel_7_API_33` (API 33, WebView 109) booted `-no-snapshot -memory 2048`
with C: at 79 GB free. Times below are the emulator's logcat (IST); `files.log` is UTC. Screenshots in the session
scratchpad's `shots/`.

- **One-time move (Step 4): PASS.** Found the gate's debug-key release 1.0 (`versionCode=1`); `pm uninstall` Success; both
  reverses listed; A installed (Success, no crash). Typed `http://localhost:3110`, Open POS, signed in as `e2eadmin`
  (password by `type-secret.py`, 23 characters, never shown) → the Dashboard; `19:18:27.991 open`,
  `19:18:28.029 check: HTTP 404`.
- **E1 (`manifest=404`): PASS.** Away 70 s → `open`, `check: HTTP 404`, one `GET /pos/android/latest.json`; away 15 s → no
  line, no request.
- **E2 (`manifest=wronghash&apk=fast`): PASS.** Away 70 s → `open`, `download: the size or SHA-256 is not the manifest's`;
  `files.log`: the manifest, the APK once (`sent … 7492609 bytes`); no card (`e2-no-card`). "No file left" is shown by
  the log line (the gate's ruling: no root, no `run-as` on a release app).
- **E7 (`manifest=ok&apk=slow`): PASS.** Away 70 s → `open` at 19:24:20.206, HOME again at 19:24:22; `19:24:50.052 download:
  2.0.1 verified (7492609 bytes)` while the launcher was the top resumed activity; back at 19:24:52 (30 s after that
  HOME) → no `open`, no `card:` line, no card (`e7-back-no-card`).
- **E4 (`apk=fast`): PASS.** Away 70 s → `open`, `check: 2.0.1 is ready`, `card: 2.0.1`; the card (`e4-card`): the logo,
  "Update available", "Sandbee POS 2.0.1 is ready to install.", "A test update from the fake files server.", "The first
  time, Android asks you to allow installs from Sandbee POS.", Install, Later. **Later** → `card: later`, the card gone
  (`e4-after-later`); away 70 s → `open`, `check: 2.0.1 is ready`, `card: 2.0.1`, the card again (`e4-card-again`).
- **Cold start: PASS.** `am force-stop`, launch → `19:28:07.254 open`, `19:28:07.255 card: 2.0.1` (no look: the last was
  21 s earlier), the card over New Order (`cold-card`).
- **E5: PASS.** Install → `install: permission`, Android's "Install unknown apps" for Sandbee POS 2.0.0; Allow from this
  source (`appops … REQUEST_INSTALL_PACKAGES: allow`); Back → the same process (pid 5314), the card with "Allow Sandbee POS
  to install apps, then tap Install again." (`e5-back-card-permission`). Install → `install: started`, "Do you want to
  update this app?"; **Cancel** → `install: status 3`, still pid 5314, the card with "The update could not be installed.
  It will be offered again next time." (`e5-cancelled-card`). Install → `install: started` → **Update** → Google Play
  Protect "App scan recommended" (`e5-play-protect`) → **More details** → **Install without scanning** (`e5-more-details`;
  **Scan app was never tapped**). Logcat: `Force stopping com.possoftware.pos appid=10183 user=-1: installPackageLI`,
  `Start proc 5927:com.possoftware.pos/u0a183 for broadcast
  {com.possoftware.pos/com.possoftware.pos.printer.PrintingOffReceiver}`, `install: done`; `dumpsys package` →
  `versionCode=20001`, `versionName=2.0.1`; no crash. Launch → still signed in (`e5-201-open`), `open`, `check: ignored
  (not newer)`, no card.
- **E6: PASS.** `adb reverse --remove tcp:8765`, away 70 s → `open`, `check: no answer`, pid 5927 unchanged, no request
  reached the files server; the reverse back, away 70 s → `open`, `check: ignored (not newer)`, pid 5927.
- **E3: PASS.** Uninstall, install A, type the address, Open POS → `19:34:07.889 open`, `19:34:08.111 download: 2.0.1
  verified (7492609 bytes)` while the app was in view; signed in at 19:34:48 and stayed in view (MainActivity top
  resumed) until 19:36:53 → no `card:` line, no card (`e3-in-view-2min`); away 70 s → `open`, `check: 2.0.1 is ready`,
  `card: 2.0.1`, the card (`e3-card-next-open`).
- **E8: not run** (the gate's ruling); pin 32 holds `PrinterPool.anyPrinting() -> {` in `takeCard` and the 30-second
  wait in `install`.
- **Put back (Step 6):** A uninstalled; the debug-key release 1.0 installed from
  `D:\kd\pos-dev-keep\apk-release\pos-emulator-x86_64-release.apk` (sha256 `29115bdf…`, `versionCode=1`); `adb reverse
  --remove-all`; `adb shell sync`; `adb emu kill` (graceful shutdown). This session's `next start` (3110) and fake files
  server (8765) stopped by PID after checking their command lines. The scratch database `pos_scratch_e2e_n2s` stays (one
  admin; this PC does not drop databases).

### Release read-back (Task 26 Step 7, `n2-release.sh`, head `30e0302`)

`:app:compileReleaseKotlin --rerun` exit 0, then `assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a`
`BUILD SUCCESSFUL in 43s`; kept in the session scratchpad only, released to nobody:

| APK | Bytes | SHA-256 |
|---|---|---|
| `app-arm64-v8a-release.apk` | 7,360,886 | `6c62b11048619785d96b62f71ccd93705b9608d7addf5bc0dcdc97e5fc5df2e9` |
| `app-armeabi-v7a-release.apk` | 6,768,720 | `a95c29283b99657dd7ad5c6e21bce8dfbae18fa38d547abcf6024e39621e4c63` |

Both: `V2 Signer: certificate DN: CN=Sandbee POS, O=sandbee, C=IN`, `V2 Signer: certificate SHA-256 digest:
5bd06ef3e9a78efcb0dfbd1ff102de932c581a78034d93ef7572f5373b5b3e40`, `versionCode='20000' versionName='2.0.0'`,
`uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'`, no `application-debuggable`,
`string/pos_update_base` → `"https://files.sandbee.in/pos"`, `integer/pos_update_check_minutes` → 720,
`integer/pos_update_reopen_minutes` → 30. D: had 5.6 GB free before and 5.5 GB after.

### Differences from this plan, and why

None in code or behaviour: every block applied as written, every Expected matched. Notes only:
1. Step 3's own `curl` of `latest.json` is the first GET in `files.log` (it answered 404 as expected); the app's requests
   are the ones after it.
2. The emulator's background command ended with exit 1 after `adb emu kill`: its log says it waited for a graceful
   shutdown ("Not saving state: RAM not mapped as shared"); `adb devices` was empty afterwards.

### The session's fresh review (Claude Fable 5.1, `c1db099..30e0302`)

Verdict **"Ready to merge: Yes"**: 0 Critical, 0 Important, 8 Minor. The reviewer read the whole range with the code around
it (read-only; nothing run or sent) and found no drift from this plan's blocks; it confirmed the threading (the schedule
and `waiting` only on the main thread, the requests and the install on one worker), React Native's lazy-module ordering,
that every download failure path deletes both files and `copyVerified` reads at most `size + 1` bytes (Review Focus 3),
that a card never surfaces mid-work in Kotlin or in the reducer (Review Focus 1), the install path's safety (only
`<base>/android/<plain name>`, `USER_ACTION_REQUIRED`, an explicit non-exported receiver, no install without a tap), and
that no pin 30–32 needle is a prefix of its mutation's result. The re-grade by effect kept all eight at Minor (narrow
windows, wording or robustness; none changes an outcome for staff on a normal day), so there was no fix pass; they are
for the N2 gate:

1. **Later or Back during Install's wait for the printers** (`UpdateCard.tsx` `later`; `PosUpdateModule.install`): the
   worker still opens "Install unknown apps" or Android's dialog up to 30 s after the card was dismissed (only when a
   print started between the card and the tap). Fix idea: a cancel flag set by `later()` and checked after the wait.
2. **A kept file corrupted by a power loss right after its download** (`UpdateDownloader`: no `fsync` before the rename;
   `check: … is ready` and `install()` do not re-hash): the card would come at every open and Android's installer fail
   each time, until a newer release. Fix idea: sync before the rename, and re-hash in `install()` (on a mismatch delete,
   `clearVerified`, answer "failed").
3. **The card's wait for an idle printer is unbounded** (`offerWhenIdle` every 2 s): in a busy printers-mode cafe the card
   could come minutes into the open at the first lull. The gate accepted the design; a bound (about 2 minutes, then the
   next open) would keep §6.3's "never later in a session" too.
4. **Cancel in Android's dialog reads as a failure** (`UpdateInstallReceiver`: `STATUS_FAILURE_ABORTED` = 3 falls into
   `else`): the card says "The update could not be installed." after a deliberate Cancel (as E5 shows). Fix idea: a
   distinct answer for 3.
5. **A RuntimeException from `openWrite`/`commit` leaves the session open** (`UpdateInstaller`: only `IOException` and
   `SecurityException` abandon it); the module still answers "failed". Fix idea: one `catch (e: Exception)` that abandons.
6. **Android 7.x has no per-app "Install unknown apps"**: below Android 8 the session fails when the global "Unknown
   sources" is off, and the failed note does not say what to turn on. For N4's GO-LIVE text.
7. **The Jest background test takes the last `AppState.addEventListener` call** (`__tests__/UpdateCard.test.tsx`): right
   today only because the hook's effect runs last; another AppState listener added later in `PosScreen` would redirect
   the test. Fix idea: assert the call count or find the card's own listener.
8. `verified()` reads the preferences and stats the file on the main thread at an open and in `takeCard` (a one-time
   millisecond read; StrictMode would flag it).

Set aside by the reviewer, with this session's rulings: Play Protect, Samsung's Auto Blocker and the missing Open button
(already N4's GO-LIVE text); Android 9's archive signers (fixed and pinned at the gate; no API 28 image here); API 34–36
run-time behaviour of the mutable PendingIntent, the receiver's `startActivity` and `USER_ACTION_REQUIRED` (the code reads
right; only an API 33 image exists: repeat E5 once on API 34/35 when an image is available); spec §6.1's
`UpdateStore`/`status()` wording (superseded by N1's approved `UpdateSchedule`/`takeCard` design); a 404 or failed
download not retried for 12 hours (the plan's rule, "any HTTP answer counts as a look"; §6.2.2's "retried at the next
check" holds); the deferred minors #2, #4–#7, #10 (re-read, still Minor); a future `minSdkVersion` raise (the manifest has
no `minSdk` field: N4's GO-LIVE text or a later schema); Task 26 itself (outside the range); N3 and N4; the 12 h, 30 min
and once-per-open values (the owner's decisions).

## N2 review gate (2026-10-13)

Run right after Session N2, in the same Claude session (the owner: "go"). The fresh eyes were the N2 review (Claude Fable
5.1, before the N2 Results commit) and this gate's own review of Session N3's exact section (below). Nothing pushed,
merged, uploaded or released.

### N2 re-verified

- Commits `32b988e`, `ecefcae`, `59e031c`, `268955d`, `1186761`, `30e0302`, `8bcd4a6` read; after each task the `apps/`
  tree equalled the N1 gate's gold commit (checked in Session N2; N2 applied every block with the gate's applier).
- Suites at this gate's commit (code as at `8bcd4a6`): mobile 167, Jest 7 (4 suites), desktop 205, JUnit 92 (0 failures, 0 errors), the cafe chain 5656 (5655
  pass, 0 fail, 1 skipped), typecheck and lint clean in both apps.
- The Results' evidence (E1–E7, the cold start, Cancel, Play Protect's Install without scanning, the release read-back)
  is in the session scratchpad named there.

### Rulings on the N2 review

| Finding | Ruling |
|---|---|
| m-1 Later during Install's wait for the printers still starts Android's screens | N3 Task 30: each Install takes a ticket, Later takes the next; a waiting Install answers `cancelled` and starts nothing (pin 32). Not runnable on the emulator (it needs a print in flight). |
| m-2 a kept file damaged on disk is offered at every open | N3 Task 30: `out.fd.sync()` before the rename (pin 30); `check: … is ready` and `install()` hash the kept file again (`UpdateFiles.sha256Of`, two JVM tests); a damaged one is dropped and `lastCheckAt` reset, so the next open downloads it again (pin 32). |
| m-3 the card's wait for idle printers is unbounded | **The owner (2026-10-13): at most 2 minutes**, then this open offers nothing and the next open does (`CARD_IDLE_WAIT_MS`, pin 32). |
| m-4 Cancel in Android's dialog reads as a failure | **The owner (2026-10-13): Cancel closes the card like Later.** `STATUS_FAILURE_ABORTED` → `install: cancelled` → `RESULT_EVENT { ok: false, cancelled: true }` → the reducer's `later` (a node test, a Jest test, pin 31); proven on the emulator (below). |
| m-5 a `RuntimeException` from the session leaves it open | N3 Task 30: one `catch (e: RuntimeException)` abandons it (pin 31). |
| m-6 Android 7 has only the global "Unknown sources" | N4 Task 42's GO-LIVE text. |
| m-7 the Jest test takes the last AppState listener | N3 Task 30: every `change` listener of the screen hears the change; the mock's calls are cleared per test. |
| m-8 the preferences read on the main thread | Stands: one millisecond read at an open; the app runs no StrictMode. |
| The N1 gate's deferred #2, #4, #5, #6, #7, #10 | Stand, as recorded at the N1 gate (re-read by the N2 review, still Minor). |
| E5 on API 34/35 | N4 Task 44, when such an image is on this PC (only API 33 is). |
| A future `minSdkVersion` raise | N4 Task 42's GO-LIVE text: never raise it while older devices are in use, or add a `minSdk` field to a later manifest schema first. |

### Session N3 made exact and pre-validated

- Gold worktree `D:\kd\n2g` (the N1 gate's, reused; detached at `8bcd4a6`, its Gradle and CMake caches kept;
  `apps/desktop/node_modules` a real copy so `electron-updater` landed only there): commits `a86ccd0` (Task 30),
  `171cd66`, `0699819`, `e480583`, `e658887`, `2c40140` (Task 35 with the review's m-1; first `ae53f5f`), apps tree
  `16d4bc93…`, docs tree `389363ff…`; a bundle of them in `D:\kd\n2g-apk\n2-gate\gold-n3.bundle`. Written test first
  in each task (RED seen, then GREEN).
- The N3 section's blocks were generated from those commits (`gate/gen3_ops.py`: whole-file blocks for the rewritten
  `url-window.html`, `url-window.js` and `server-url.test.ts`; `package.json`'s test-script hunks with the tests) and
  applied step by step on the gold worktree reset to `8bcd4a6` (`gate/val3.py`): every task's apps and docs trees came out
  **identical** to gold, and every RED/GREEN Expected in the section is that run's output. A dry run of the whole section
  on the base: 127 ops OK.
- Gold suites: mobile 168, Jest 8, JUnit 94, desktop 211, typecheck and lint clean in both apps; the go-live runbook 97/97
  after Tasks 33 and 34.
- **Task 30 on the emulator** (API 33, gold test APKs A `329b0531…` / B `0a788507…`, the private key, the test base):
  the one-time move from the debug-key 1.0, sign-in, `download: 2.0.1 verified`, `check: 2.0.1 is ready` (the kept file
  hashed again), the card; Install → "Install unknown apps" → Allow → back → Install → Android's dialog → **Cancel →
  `install: cancelled`, the card closed with no line, same process**; away 70 s → the card again → Install → Update →
  Play Protect (More details → Install without scanning; Scan app never tapped) → 2.0.1, `install: done`. Put back to the
  debug-key 1.0 (`29115bdf…`), `sync`, `emu kill`.
- **Task 36 on this PC** (installers 2.0.0 / 2.0.1 / 2.0.2 from gold with the test publish url): the owner's two leftover
  folders renamed (the owner's OK); 1.12.0 (`060d8d84…`, the release set's) installed per-user into
  `D:\kd\pos-dev-keep\win-test`, first run on `http://localhost:3110`, Start with Windows armed; **2.0.0 over it removed
  the Run value (G-1), and 2.0.0's first start set it again**; the address window: a bare " MyCafe " → "Couldn't reach
  mycafe.sandbee.in…" (no request left the PC), `http://127.0.0.1:8766` → "We couldn't find a POS at 127.0.0.1:8766…"
  (one `GET /api/health`), `http://127.0.0.1:9` → "Couldn't reach…", `http://8.8.8.8` → the http rule, Esc closed it,
  `http://localhost:3110` found and saved; serving nothing: the look at 1 minute logged a 404 and showed nothing; serving
  2.0.1: notified after 61 s (the corner screenshot shows "Update ready"), Restart to update → installed and started
  again as 2.0.1 (`--updated`), the Run value, the address and `autoStart` kept; serving 2.0.2: Quit → "Auto install
  update on quit", installed with no restart, next start 2.0.2; uninstall → the Run value removed; the test's data
  removed and the owner's two folders renamed back (the address and `installer.exe` as they were).
- The page in headless desktop Chrome: five screenshots at 480 × 640 (empty, typing, error, connecting, change) and the
  behaviour lines Task 33 Step 5 expects.

### What making N3 exact found

1. **G-1, Start with Windows lost at every update.** electron-builder's installer always runs the old uninstaller with
   `--updated` (`installUtil.nsh`), and our `customUnInstall` deleted both Run values unconditionally; `main.ts` arms
   Start with Windows only while `autoStart` is never decided. So every update, and the 1.x → 2.0.0 move, silently
   turned it off on the counter PC. Fixed in Task 35 (the `${ifNot} ${isUpdated}` guard, and the app puts the entry back
   at start when it is missing and the operator chose it); both halves proven on this PC. A 1.x uninstaller still removes
   it during the move: the 2.0.0 app's first start puts it back.
2. **electron-updater 6.8.9** is the version paired with electron-builder 26.16.0 (published with 26.15.0, the newest
   before 26.16.0, the same `builder-util-runtime` 9.7.0; 6.8.10 came with 26.17.0).
3. `npm install <package>` on this PC reformats `package.json` (it expands the compact arrays): the plan edits
   `package.json` and the lock by blocks and runs a plain `npm install`, which writes nothing more (hashes pinned).
4. `build.publish` is an object, so `-c.publish.url=http://127.0.0.1:8766/pos/windows` overrides it for test builds;
   `-c.extraMetadata.version` sets the version. A `-test` suffix would be a prerelease, never offered
   (`allowPrerelease: false`): the test versions are 2.0.0, 2.0.1, 2.0.2.
5. Restart to update is also in the Help menu: the tray's menu cannot be reached by a test, and the operator at the
   window sees the Help menu first. Same action, same rule (only once an update is downloaded).
6. `posdemo` is not typed in the test: a found address is saved and the window opens that POS (the live demo). A bare
   name is proven with Chromium's `--host-resolver-rules=MAP *.sandbee.in ~NOTFOUND` (no request leaves the PC).
7. The window asks for 480 × 640 of content (`useContentSize`); the page measured 480 × 666 on this PC (the spec says
   about 480 × 640). Recorded, not pinned.
8. electron-updater first tries a differential download (the installed version's blockmap and multi-range requests);
   the fake server serves neither, so it fell back to the full 112 MB installer. N4's release folder carries the
   blockmap; S3 answers range requests one range at a time, so the fallback is the expected path there too.
9. The mobile pins' `strip()` turns a whole comment line into an empty line, so a needle cannot span one (a comment was
   moved above the code); a failing message-less `assert.ok` hung `desktop-paths.test.ts` again (every new assertion has
   a message; the plan's desktop pin runs carry `timeout`).
10. D: had about 1.3–2 GB free during the gate: the gate's installers and screenshots stayed on C:, and the repo's
    `apps/mobile/android/app/build` (Sessions N1–N2's outputs, git-ignored) was emptied to make room (N3's first JUnit
    run rebuilds it).

### The gate's review of Session N3 (Claude Fable 5.1, a fresh context)

Verdict "Ready to run as written: Yes": 0 Critical, 0 Important, 7 Minor. It confirmed the G-1 diagnosis and the scope
of `${isUpdated}` inside `customUnInstall`, that the window makes no request (pin (A2) finds every caller of `checkPos`),
the parity table, Task 30's threads (the ticket read on the worker after the wait, `waiting` on the main thread,
`keptIntact` on the worker only), that no new pin passes vacuously or asserts without a message, the plan's commands on
this PC and the count arithmetic.

- **m-1, folded** (gold Task 35 amended to `2c40140`; Task 35 re-validated, trees identical): the start-up re-assert
  re-enabled a startup entry disabled in Task Manager (Electron's `enabled` defaults to true). The app now puts the
  entry back only when it is missing (`getLoginItemSettings(…).openAtLogin`), which still repairs the 1.x move; pin (U4)
  follows. The gate's pre-run proved the missing-entry path with the first version; Session N3's Task 36 runs it again.
- **m-2, ruled:** the 5-second check (spec §9) can time out on a cold free-tier POS; it stays 5 s (the spec), and N4's
  GO-LIVE text says to press Open POS once more when the first try says "Couldn't reach".
- **m-3, ruled:** a redirecting address is not tried against the real `net.fetch` (Electron cancels a manual redirect,
  so the words may be "Couldn't reach…" rather than "We couldn't find a POS…"); either way nothing is saved and no
  redirect is followed. Recorded.
- **m-4 to m-7, folded into the section's text:** which Co-Authored-By line wins; where playwright-core comes from and
  what to do if that npx folder is gone; Task 36 Step 4's prerequisites (mongod up; a port in use: stop and report);
  Step 8 polls for the self-relaunching uninstaller; Step 2 when the owner's folders are absent.
- **Declined to judge, ruled to stand:** a 1.x saved origin the Android rules reject is asked for again (rare); a
  scheme-less local address becomes https (parity with Android); a hosting error page reads as "couldn't find" (spec
  §9); a printer address typed as the POS gets one GET (a confusion of fields); N2's deferred #4 and #8; the ticket's
  millisecond race; a second `update-downloaded` at the 24-hour look (still one notification); errors logged twice;
  install on Windows shutdown (electron-updater's own); 480 × 666; `isUpdated`'s define generated at build time (its
  scope proven by the built installers); the 6.8.9 pairing (the gate read npm's metadata); Restart to update in the
  global menu above the address window.


### Changes to later sessions

- N4 Task 41: the packaging also reads `dist/win-unpacked/resources/app-update.yml` (`provider: generic`,
  `url: https://files.sandbee.in/pos/windows`, `updaterCacheDirName: pos-desktop-updater`) and refuses any other url.
- N4 Task 42 GO-LIVE: Android 7's global "Unknown sources" (m-6); never raise `minSdkVersion` while older devices are in
  use; the Windows app: "Restart to update" in the tray and the Help menu once an update is downloaded, otherwise it
  installs when the app is closed; the move from 1.x keeps Start with Windows (the first 2.0.0 start sets it again);
  Cancel in Android's update dialog simply closes the card until the next open; if the address window says "Couldn't
  reach" on the first try (a POS waking up), press Open POS once more (the N3 review's m-2).
- N4 Task 44: on the emulator, the smoke test also runs E5's Cancel (the card closes, offered again at the next open);
  E5 once more on an API 34/35 image if one is on the PC.

## Session N3 Results

Run on 2026-10-13 (superpowers:executing-plans, inline), Tasks 30–36 in order. Every code block was applied verbatim with
the gate's block applier (`apply_blocks_clone.py`, a dry run first, per step range, so each RED was seen before its code
went in). After each task the `apps/` tree (and `docs/GO-LIVE-CHECKLIST.md`) equals the gold commit's: Task 30 `6e172337`
(gold `a86ccd0`), 31 `3e4cd74d` (`171cd66`), 32 `7fb203ae` (`0699819`), 33 `c2756536` (`e480583`), 34 `f956a39e`
(`e658887`), 35 `16d4bc93` (`2c40140`). Nothing pushed, merged, uploaded or released; no emulator (the owner's N3 prompt).
The one download was Task 35's `npm install` (electron-updater 6.8.9 and its four packages from the npm registry).

### Commits (branch `feat/native-apps-2`, from `4c1be70`)

| Task | Commit | What |
|---|---|---|
| 30 | `da3747a` | the N2 review's Android minors and the owner's two rulings: 2 JVM tests, a reducer test, a Jest test, pins 30–32 needles |
| 31 | `e017496` | `src/pos-url.ts` (the Android rules, 45-input parity), `store.ts` re-validates, `normalizeServerUrl` gone |
| 32 | `25a1c6b` | `src/pos-health.ts` (one `GET /api/health`, 7 tests) |
| 33 | `d84ac90` | the address window like the Android start screen; GO-LIVE §7 + its runbook pin; pins (8), (9), (R5) changed, (A1), (A2) |
| 34 | `12a7826` | "Change POS address…" in the Help menu, the tray, the About dialog, GO-LIVE, DEPLOY.md; pin (A3) |
| 35 | `ed721ec` | the Windows updater (electron-updater 6.8.9, `build.publish`, Restart to update in the tray and the Help menu), G-1 fixed; pins (3), (10) changed, (R7), (U1)–(U4) |
| 36 | this commit | these Results |

### Counts

| Suite | Baseline (`4c1be70`) | After N3 (`ed721ec`) | Expected |
|---|---|---|---|
| mobile (`npm test`) | 167 | 168, 0 fail | 168 |
| Jest (`npx jest`) | 7 | 8, 4 suites | 8 |
| JUnit (`:app:testDebugUnitTest --rerun`) | 92 | 94, 0 failures, 0 errors | 94 |
| desktop (`npm test`) | 205 | 211, 0 fail | 211 |
| cafe chain (`apps/cafe`, `npm test`) | 5656: 5655 pass, 0 fail, 1 skipped | 5656: 5655 pass, 0 fail, 1 skipped | unchanged |
| typecheck + lint (mobile, desktop) | clean | clean | clean |

Per task: desktop 205 (30) → 193 (31) → 200 (32) → 202 (33) → 203 (34) → 211 (35); mobile 167 → 168, Jest 7 → 8 and
JUnit 92 → 94 in Task 30; the go-live runbook 97/97 after Tasks 33 and 34.

### RED, then GREEN (each as the plan's Expected)

- Task 30: `not ok … Cancel in Android's dialog closes the card like Later; the next app open offers it again` with
  `(0 , import_update_card.cardResultEvent) is not a function` (`# pass 7`, `# fail 1`); pins 30–32 and their mutations
  `# pass 0`, `# fail 6` with exactly the plan's messages; Jest `Tests: 1 failed, 2 passed, 3 total`; JUnit `4 Unresolved
  reference 'sha256Of'`, `1 BUILD FAILED`. GREEN: reducer 8/8, mobile 168, typecheck and lint clean, Jest `4 passed` /
  `8 passed`, `BUILD SUCCESSFUL` with no `e:` and no `update/` warning, `UpdateFilesTest` 9, `UpdateManifestTest` 12,
  `UpdateScheduleTest` 8 (0 failures, 0 errors).
- Task 31: `Cannot find module './pos-url'`, pins (11) and (12), `normalizeStore: serverOrigin is re-validated by the
  Android app's rules -- a private-network http address stays` (`# tests 117`, `# pass 113`, `# fail 4`); GREEN desktop
  193, typecheck and lint clean, mobile 168.
- Task 32: `Cannot find module './pos-health'`, pins (11) and (12) (`# tests 69`, `# fail 3`); GREEN 7/7, desktop 200.
- Task 33: (8) ×2, (9) ×2, (A1), (A2) (`# tests 70`, `# pass 64`, `# fail 6`); the runbook's `PIN §7 desktop app` with
  `'§7 desktop sub-section must quote "POS address"'` (96/97); GREEN desktop 202, runbook 97/97. The page in headless
  desktop Chrome (`url-window-shots.cjs`, a `file://` page, no request) printed the plan's ten behaviour lines exactly
  (`footer=POS Software by sandbee · 2.0.0`, `saved="MyCafe "`, `Esc does not cancel: true`, `label=Connecting…
  disabled=true`, `change: Esc cancels: true`, `errors: []` twice); the five screenshots look like the Android start
  screen.
- Task 34: (A3) (`# tests 71`, `# fail 1`); the runbook with `'§7 desktop sub-section must quote "Change POS address…"'`;
  GREEN desktop 203, runbook 97/97; the grep finds only (A3)'s own negative needle
  (`apps/desktop/src/desktop-paths.test.ts:1025`).
- Task 35: ten fail (`# tests 208`, `# pass 198`, `# fail 10`): (3), (10), (11), (12), (R7), (U1)–(U4) and
  `Cannot find module './update-plan'`. `package.json` and the lock hashed `64de4af9…2701` and `72ab12d8…3677` right after
  the blocks; `npm install` → `added 5 packages`, the same two hashes (npm wrote nothing more); electron-updater
  `6.8.9`, builder-util-runtime `9.7.0`; GREEN desktop 211, typecheck and lint clean, `npm run build` wrote
  `out/pos-health.js`, `out/pos-url.js`, `out/update-plan.js`, `out/updater.js`.

### Windows end to end on this PC (Task 36)

Disk at the start of Task 36: C: 78 GB, D: 23 GB free. Evidence in the session scratchpad
(`C:\Users\Kartik.desai\AppData\Local\Temp\claude\d--kd-lucifer\8350f3dd-…\scratchpad`): `n3-dist/build.txt` +
`hashes.txt`, `e2e-*.txt`, `shots-win/`, `shots-url/`, `files-n3.log`, `pos-desktop-n3.log` (the test app's own log),
`owner-folders-before.txt` / `-after.txt`.

- **Step 2: PASS.** No "POS Software" uninstall entry (HKCU or HKLM), `Run: []`, no `win-test`; the owner's two leftover
  folders present → renamed to `POS Software by sandbee.n3-backup` and `pos-desktop-updater.n3-backup` (the owner's OK);
  their metadata (295 entries: names, sizes, times; no file opened) recorded first.
- **Step 3: PASS.** `tsc exit=0`; 2.0.0, 2.0.1, 2.0.2 each `exit=0`, `app-update.yml` `provider: generic`,
  `url: http://127.0.0.1:8766/pos/windows`, `updaterCacheDirName: pos-desktop-updater`, `latest.yml` `version: <v>`.
  Test installers (scratchpad only, released to nobody):

  | Installer | Bytes | SHA-256 | Blockmap |
  |---|---|---|---|
  | `POS-Software-Setup-2.0.0.exe` | 112,542,296 | `2a6de1241f3307f70ee386bf0d7c20a3b8267bf1b787cc579a18ed44f40aa5d1` | 119,945 |
  | `POS-Software-Setup-2.0.1.exe` | 112,542,345 | `8190656389ff1787a27a3f992e50a13949204d72c007812c2fdf24660b708ca9` | 119,912 |
  | `POS-Software-Setup-2.0.2.exe` | 112,542,329 | `e3d79f68b93552fbef0bada18194fa77ab965e14548dcb96fd6bbac63e59c8bd` | 119,851 |

- **Step 4: PASS.** `n3.env keys: MONGODB_URI, NEXTAUTH_SECRET, AUTH_SECRET, NEXTAUTH_URL, AUTH_TRUST_HOST,
  SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD` (no value printed); 3110 and 8766 free; `next start -p 3110` on
  `pos_scratch_e2e_n3s` → `{"ok":true,"db":"up","tenant":"dev",…}`; the fake files server → `404` for `/api/health`.
- **Step 5, the move from 1.12.0: PASS.** 1.12.0 `060d8d84…` = `SHA256SUMS.txt`; installed per-user into
  `D:\kd\pos-dev-keep\win-test` (exit 0, FileVersion 1.12.0); `first-run-old` → `POS page: http://localhost:3110/login
  version 1.12.0`, the Run value `"D:\kd\pos-dev-keep\win-test\POS Software by sandbee.exe" --hidden`. 2.0.0 over it →
  exit 0, FileVersion 2.0.0, **the Run value gone** (1.12.0's uninstaller ran with `--updated`: G-1), `app-update.yml` the
  test url; `start` → `version 2.0.0; POS page http://localhost:3110/login`, the menu `["Help","Open POS","Reload","Change
  POS address…","Start with Windows","About POS Software by sandbee","Quit"]`, **the Run value back** (the start-up
  repair).
- **Step 6, the address window: PASS**, every line as the plan's Expected: `window: [{"content":[480,666],
  "resizable":false}] footer: POS Software by sandbee · 2.0.0 cancel visible: true value: http://localhost:3110`;
  `" MyCafe "` → `Couldn't reach mycafe.sandbee.in. Check the internet connection.`; `http://127.0.0.1:8766` → `We
  couldn't find a POS at 127.0.0.1:8766. Check the name.`; `http://127.0.0.1:9` → `Couldn't reach 127.0.0.1:9. Check the
  internet connection.`; `http://8.8.8.8` → `http:// only works for this device or a computer on your own network. Use
  https:// for any other address.`; `Esc closed the window: true`; `saved http://localhost:3110: window closed true; POS
  http://localhost:3110/login`. `files-n3.log`: exactly one `GET /api/health` from the app (10:54:19Z; the one before it is
  Step 4's own `curl`); the app log: three `address check: not saved`, then `address check: found`. The screenshots
  `a0-change`, `a1-bare-name`, `a2-not-a-pos`, `a3-no-answer` match the page check.
- **Step 7, the updater: PASS.**
  1. Serving 2.0.1: `"updater: 2.0.1 is ready; notified" after 61 s`; the corner shot shows "POS Software by sandbee",
     "Update ready", "POS Software 2.0.1 is ready. It installs when you close the app."; the menu with `"Restart to
     update"` before `"Quit"`; `Restart to update: the app exited`; the app log `Install on explicit quitAndInstall`,
     `isSilent: true, isForceRunAfter: true`, `--updated,/S,--force-run` (10:56:03Z). About 18 s later the app started
     again (its first log line at 10:56:22Z): FileVersion 2.0.1, the main process with `--updated`, the renderer with
     `--pos-desktop-version=2.0.1`, the Run value kept, the store
     `serverOrigin: http://localhost:3110`, `autoStart: true`. Stopped by its PID after checking its path (`win-test`).
  2. Serving 2.0.2: `2.0.2 is ready; notified" after 61 s`, the same notification for 2.0.2, `Quit: the app exited`; the
     app log `Auto install update on quit`, `isForceRunAfter: false`, `--updated,/S` (10:58:04Z); at the first look 25 s
     after the quit FileVersion 2.0.2, and 40 s after it still **no process running** (no restart); the Run value kept.
  3. Serving nothing: `start` → `version 2.0.2`, the menu without Restart to update.
  Both downloads tried the differential path first and fell back to the full installer (`Cannot download
  differentially, fallback to full download`: 2.0.0's blockmap is not in the 2.0.1 folder; the fake server answers a
  multi-range request with the whole file), as the plan expects.
- **Step 8, uninstall and put back: PASS.** The uninstaller exit 0; `win-test` and the uninstall entry gone within the
  poll; `Run: []`. The test's own `%LOCALAPPDATA%\pos-desktop-updater` and `%APPDATA%\POS Software by sandbee` (both
  created at 16:22 IST today, no reparse points, the store's address `http://localhost:3110`) removed; the owner's two
  folders renamed back; their metadata: 295 entries, the same names, every file's size and time unchanged; 15
  directories' times differ by milliseconds to minutes, all still on 2026-10-12 (none today: NTFS refreshing the
  directory-index copy of their times after the first recursive listing); `installer.exe` 10/10/2026 112,216,876 B; no
  Run value. This session's `next start` and fake files server stopped by PID after checking their command lines; the
  scratch database `pos_scratch_e2e_n3s` stays.
- **Step 9, every suite: PASS** (the Counts above; the cafe chain `rc=0`).

### Differences from this plan, and why

No difference in code or behaviour: every block applied as written, every Expected matched. Notes:
1. The session first stopped before Task 30 Step 1: D: was under 1 GB (965 MiB, falling ~140 MB a minute while another
   project's `mongod` on port 27034 wrote to D:), the owner's rule. The owner made room (23 GB free) and said continue.
2. Task 36 Step 8 asks to read the owner's `pos-desktop.json` address after the rename back; the owner's N3 prompt says
   never to open anything inside those two folders, so they were checked by metadata only (above).
3. The local POS logged `[cluster-registry] connection error on core: MongoServerSelectionError` once at start (this PC's
   env has no core cluster); `/api/health` answered `db: up`, `tenant: dev` throughout.

### The session's fresh review (Claude Fable 5.1, `4c1be70..ed721ec`)

Verdict **"Ready to merge: Yes"**: 0 Critical, 0 Important, 7 Minor. The reviewer read the whole range read-only (no
writes, no network), checked every commit's `apps/` tree against the gold chain, re-ran desktop 211, mobile 168 and Jest
8, and read electron-updater 6.8.9 and app-builder-lib's NSIS templates on disk. It confirmed Review Focus 2 (a
line-for-line port, the 45-input parity table loading the Android module by path, absolute expectations and the error
words pinned), that the window makes no request itself (CSP `default-src 'none'`, pin (A2)), that `pos-health.ts` matches
the real `/api/health`, Task 30's threads and the 2-minute bound, Cancel end to end, G-1 proven on both halves (Step 7's
install on quit with no process running isolates the uninstaller's guard; Step 5 isolates the start-up repair), and the
never-block rule on Windows (`quitAndInstall` only behind Restart to update; install on quit without `--force-run`; no
dialog). The re-grade by effect kept all seven at Minor (none changes the 2.0.0 release path or a normal day at the
counter), so there was no fix pass; they are for the N3 gate:

1. `allowPrerelease = false` (`updater.ts`) is inert on electron-updater's generic provider (only the GitHub providers
   read it; the update check is a plain semver comparison): the N2 gate's point 4 ("a `-test` suffix would be a
   prerelease, never offered") does not hold, and a prerelease version in `latest.yml` would be offered. No effect on N3
   (plain versions). Idea: N4 Task 41's packaging refuses a prerelease version.
2. A typo in a bare workspace name (no such name in DNS) reads "Couldn't reach <name>.sandbee.in. Check the internet
   connection." (spec §9's words; the owner's call): "Check the name and the internet connection.", or map Electron's
   `ERR_NAME_NOT_RESOLVED` to the "Check the name" sentence; at least N4's GO-LIVE: check the spelling first.
3. `takeCard` still offers one card for a kept file damaged on disk (it only checks the file exists on the main thread,
   m-8); Install hashes it again, says it could not be installed, removes it and resets `lastCheckAt`, so the next open
   downloads it again. Self-healing, as the plan words it.
4. Pin (3)'s comment (`desktop-paths.test.ts:119`) says Start with Windows is set again at every start; the code (and
   (U4)) puts it back only when it is missing.
5. `UpdateFilesTest.aKeptFileHashesToTheManifestsSha256` asserts without a message (JUnit cannot hang on it).
6. The updater's `error` handler logs `error.name` only ("Error"); the detail still reaches the log through
   `autoUpdater.logger` (`error.code ?? error.name` would help).
7. The page shows Cancel when a saved address exists, not when the main process allows a cancel (they coincide today; the
   main process is the real gate).

Set aside by the reviewer, with this session's rulings (all stand): Quit or Restart to update during a Windows print (the
tray's Quit path, spec §7); GO-LIVE's "the installer is never downloaded from anywhere" (N4 Task 42 rewrites GO-LIVE for
2.0); the first-run window closed with its X (pre-existing, C17); `mycafe:3000` → `https://mycafe:3000` (the Android rule;
parity); the health-check words only on Windows (spec §9); one invocation and one database ping per typed address (the
spec's free-tier sentence); the desktop lock's root version 2.0.0 (as `npm install` writes it); the Co-Authored-By line
(the N3 prompt's); the N2 gate's own ruled list, m-2 and m-3 (nothing new).

## N3 review gate (2026-10-13)

Run right after Session N3, in the same Claude session (the owner: "merge safe ho to merge karo and next work continue
karo"). The fresh eyes were the N3 review (Claude Fable 5.1, before the N3 Results commit) and this gate's own review of
Session N4's exact section (below). Nothing uploaded or released.

### N3 re-verified, merged and pushed

- Commits `da3747a`, `e017496`, `25a1c6b`, `d84ac90`, `12a7826`, `ed721ec`, `e88a331`; after each task the `apps/` tree
  equalled the N2 gate's gold (Session N3 Results); the N3 review: "Ready to merge: Yes", 0 Critical, 0 Important.
- **The merge (the owner's OK of 2026-10-13, "merge safe ho to merge karo"), judged safe:** the branch changes no cafe
  code that runs (only `DEPLOY.md`, the runbook test and GO-LIVE text); `origin/main`'s two newer commits (`1d30ac6`,
  `1672a85`, the owner's CB-7 S5a/S5) touch no file of the branch; no dependency changed; three Fable reviews (N1–N3)
  passed. Local `main` was fast-forwarded to `origin/main` `1672a85` and `feat/native-apps-2` merged with `--no-ff`:
  **`543b193`**. Verified on it: shared 964 and typecheck, the cafe typecheck, lint, chain 5802 (5801 pass, 0 fail,
  1 skipped) and build (144 routes), mobile 168, Jest 8, JUnit 94, desktop 211. Fetched again (`origin/main` still
  `1672a85`) and **pushed with the token** (the owner: "Haan, push karo"): `origin/main` = `543b193`. Not deployed (no
  web change). The native apps on `main` are 2.0.0 in progress: nothing is built or handed out from `main` until N4's
  release set. This branch was fast-forwarded to `543b193`; Session N4 continues here and merges again after its review.

### Rulings on the N3 review

| Finding | Ruling |
|---|---|
| m-1 `allowPrerelease = false` is inert on electron-updater's generic provider | Correct (6.8.9 reads it only in the GitHub providers; `isUpdateAvailable` is a plain semver comparison), so **the N2 gate's point 4 above is wrong**: a version with a prerelease part in `latest.yml` would be offered. Task 41's packaging refuses such a version; Task 40 notes it at the line. N3's test versions were plain, so N3's run stands. |
| m-2 a mistyped bare name reads "Check the internet connection." | **The owner (2026-10-13): "Couldn't reach <host>. Check the name and the internet connection."** for every no-answer case (Task 40; spec §9 amended); GO-LIVE says to check the spelling first and to press Open POS once more for a POS that was asleep (Task 42). |
| m-3 `takeCard` offers one card for a kept file damaged on disk | Stands: Install hashes it again, says it could not be installed, drops it and resets `lastCheckAt`, so the next open downloads it again; hashing ~7 MB on the main thread at every open would cost more. |
| m-4 pin (3)'s comment | Task 40. |
| m-5 a JUnit assertion without a message | Task 40. |
| m-6 the updater's error line names only `error.name` | Task 40: `errorCode(error)` (electron-updater's `code`, else the name), pinned in (U2). |
| m-7 Cancel shown by a saved address, not by the main process's allow | Stands: the main process decides; the two coincide (the first run has no address, "Change POS address…" always has one). |
| The review's declined-to-judge lines | Stand as the session ledgered them; GO-LIVE's "It is never downloaded from anywhere." is rewritten in Task 42. |
| The 2.0.0 release notes | **The owner (2026-10-13):** "Sandbee POS now updates itself. You will see a card like this when a new version is ready." (Task 44). |

### Session N4 made exact and pre-validated

- Gold worktree `D:\kd\n2g` (reused; its Gradle caches kept), detached at `543b193`: commits `2e16409` (Task 40),
  `0b2c4ad` (Task 41), `8f6652f` (Task 42; branch `gold-n4`, and a bundle in `D:\kd\n2g-apk\n3-gate\gold-n4.bundle`),
  whole tree `43524fee05e94b6ecbfc37d73216560482f1ddfc` (Tasks 41 and 42 amended with this gate's review, below; first
  `94c0866`, `8c6661b`). Written test first in each task (RED seen, then GREEN).
- The section's blocks were generated from those commits (`gen4_ops.py`: the N2 gate's generator; a `.test.mjs` file and a
  root `"test…"` script are test ops) and applied step by step on the gold worktree reset to `543b193` (`val4.py`): every
  task's **whole tree** came out identical to gold, and every RED/GREEN Expected in the section is that run's output. The
  cafe chain on the gold tree: 5807 (5806 pass, 0 fail, 1 skipped). A dry run of the section's 21 ops on the repo: OK.
- **Task 44 pre-run** (builds at `543b193` from the repo, scratchpad only, released to nobody): the pair (arm64 7,362,354
  B `0dc49fc68569c5bd…`, armv7 6,770,188 B `86c88741785b5b7d…`), the x86_64 APK (7,494,077 B `39ab511f…`) and the test
  APKs A (7,494,073 B `60e10533…`) and B 2.0.1 (7,494,081 B `42729a59…`), every one signed `5bd06ef3…`, the right
  versions, CPU types, bases and times; the installer 2.0.0 (112,542,298 B) with `url: https://files.sandbee.in/pos/windows`.
  The packaging into a scratch folder: the six files, `sha256sum -c` OK six times, `latest.json` with the owner's notes;
  refused on real wrong files: the x86_64 test APK as `--arm64` ("native code x86_64, not arm64-v8a alone"), N3's test
  installer ("app-update.yml: generic http://127.0.0.1:8766/pos/windows, …"), the Phase 3 debug-key APK ("not signed with
  the private key (certificate fac61745…)"), an existing folder ("already exists").
- **The emulator smoke** (API 33, `-no-snapshot -memory 2048`, C: 72 GB free): the debug-key 1.0 the N2 gate left →
  uninstalled → the real-base 2.0.0 x86_64 → `open`, `check: no answer` → `http://localhost:3110`, signed in (`e2eadmin`,
  database `pos_scratch_e2e_n4g`) → the printer panel → network printer `127.0.0.1:9100` (adb reverse to a fake printer)
  "Network printer 127.0.0.1 is connected." → Print test slip → the fake printer's job of 13,706 bytes → Yes, Done; then
  A over it (`install -r`, still signed in) → `download: 2.0.1 verified (7494081 bytes)`; away 70 s → `check: 2.0.1 is
  ready`, `card: 2.0.1`, the card → Install → `install: permission` → Allow from this source → Back → the card with "Allow
  Sandbee POS to install apps, then tap Install again." (same process) → Install → `install: started` → **Cancel** →
  `install: cancelled`, the card gone with no line, the same process → away 70 s → `card: 2.0.1` again; no crash. Put back
  to the debug-key 1.0 (`29115bdf…`), reverses removed, `sync`, `emu kill`; the gate's servers stopped by PID; the scratch
  database `pos_scratch_e2e_n4g` stays. Evidence in the session scratchpad `8350f3dd…/n3-gate/` (copied to
  `D:\kd\n2g-apk\n3-gate\`).

### What making N4 exact found

1. **`files.sandbee.in` has no DNS record** (NXDOMAIN on 2026-10-13), and `*.sandbee.in` has no wildcard (a random name
   is NXDOMAIN; `posdemo` resolves to Vercel): until the owner's bucket and domain exist, the apps' looks get no answer
   and no request reaches any cafe. GO-LIVE's new step puts the owner's upload before any device moves.
2. The block applier ends a block at a line holding only a fence, so a doc block cannot carry a fenced code block: the
   new README text uses inline code.
3. A `localeCompare` sort listed `latest.json` before the APKs; the folder test caught it (code-unit order, as
   `sha256sum` lists files).
4. apksigner runs as `java -jar <build-tools>\lib\apksigner.jar` (Node cannot spawn a `.bat` without a shell); build-tools
   37 prints `V2 Signer: certificate SHA-256 digest: <hex>`; aapt2's resource dump prints the value on the line after
   the resource's name (`() "https://…"`, `() 720`).
5. The packaging checks everything before it writes; `latest.json`'s hashes come from the built APKs and each copy is
   hashed again; `SHA256SUMS.txt` lists the files under `upload\` in `sha256sum --binary` format.
6. The x86_64 APK is for the emulator only: the release is the pair (the packaging takes no third APK).

### The gate's review of Session N4 (Claude Fable 5.1, a fresh context)

Verdict "Ready to run as written: With fixes": 0 Critical, 1 Important, 7 Minor. It confirmed that the packaging is
fail-closed (every check before the first write; every printed certificate must be the private key's, so a second
signer refuses; package, versions, debuggable, one CPU type, the base and both times read back from the APK; the
installer tied to `latest.yml` by SHA-512 and size; a prerelease refused, the N3 review's m-1 closed), that the manifest
it writes is always one `UpdateManifest.kt` accepts, the Windows specifics (no `.bat` spawned, arrays of arguments,
`sha256sum --binary` lines), that every refusal row asserts its own words and that nothing was written, that every
claim in the new docs is true of the code, that Task 44 is safe (write-once, `--out` for the refusal demos, no request to
anyone, the emulator put back), and the counts. It re-ran release-native 12/12, the runbook 102/102 and desktop 211/211
on the gold worktree. Everything was folded in before this commit (gold Tasks 41 and 42 amended, the section
re-generated and re-validated: every task's whole tree identical again):

| Finding | Ruling |
|---|---|
| I-1 Task 45 names a fix pass but not what happens to the write-once release folder if a fix changes the apps or the script | Folded into Task 45 Step 1: stop and ask the owner; with the OK rename the earlier folder `….superseded-<head>` (never delete), repeat Task 44's builds and packaging (and the smoke if the Android updater changed); the Results name both folders. |
| m-1 a missing java/aapt2/build-tools reads as "signature does not verify" | Folded: `realTools` names a missing build-tools folder, java comes from `JAVA_HOME` when set, and a spawn `ENOENT` is "cannot run <tool>" (a refusal row). |
| m-2 an I/O failure mid-copy leaves a folder that looks finished | Folded: written into `Sandbee-POS-<version>.partial`, renamed when complete; a leftover `.partial` is refused (a refusal row; the folder test checks none remains). |
| m-3 refusal rows missing: two signers, no `app-update.yml`, `latest.yml` naming another file | Folded (three rows). An APK over 100 MB is not a row (a 100 MB temporary file per test run); the size rule is pinned by the manifest table. |
| m-4 §7's download line points at a folder the bucket will not list | Folded: it names `https://files.sandbee.in/pos/windows/POS-Software-Setup-<version>.exe`. |
| m-5 the upload steps assume `sha256sum` | Folded: `Get-FileHash -Algorithm SHA256` for PowerShell (pinned in the steps test). |
| m-6 Review Focus 4 says "N4 Task 1"; Task 40's scope `fix(desktop)` also touches a Kotlin test | Folded: "N4 Task 41"; `fix(apps)`. |
| m-7 spec §5 "versions only go up" is not enforced by the packaging | Folded: a version lower than an existing `Sandbee-POS-x.y.z` in `--out` is refused (a refusal row; the owner's `Sandbee-POS-phase2-…` and `-phase3` folders are not versions and are ignored). |
| Declined to judge (aapt2/apksigner formats taken from the gate's read-back; the emulator's 1.0 uninstalled without the demo check; `released` = packaging day; CloudFront and the listing block; differential downloads; a hand-mixed `dist/`; `$SP` path forms; the old device's printer rows; x86 devices; PowerShell vs Git Bash README commands; `lastCheckAt` after the release APK's run; the Co-Authored-By line) | Stand: each is either proven by the gate's runs, set up with the owner after N4 (spec §10), or harmless as the reviewer says. |

Real files after the fold: the packaging wrote the folder through `.partial` (six files, `sha256sum -c` OK), refused a
folder next to a `Sandbee-POS-2.0.1` ("is newer than 2.0.0: a release only goes up") and an `ANDROID_HOME` without
build-tools ("cannot run …\apksigner.jar: no build-tools 37.0.0 there").

### Changes to later sessions

- None: N4 is the last session of this plan. After it: the owner's merge OK, then the S3 bucket and HTTPS on
  `files.sandbee.in` with the owner, step by step (spec §10), then the owner's upload and GO-LIVE's "Existing cafes: the
  native apps 2.0 release".

## Session N4 Results

Run on 2026-10-13 (superpowers:executing-plans, inline), Tasks 40–45 in order. Every code and doc block was applied
verbatim with the gate's block applier (`apply_blocks_clone.py`, a dry run first, per step range, so each RED was seen
before its code went in). After each task the `apps/` and `scripts/` trees, the root `package.json` and
`docs/GO-LIVE-CHECKLIST.md` equal the gold commit's: Task 40 `apps` `282e02d3` (gold `2e16409`), 41 `scripts`
`ae89bc04` (`0b2c4ad`), 42 `apps` `c18a0001`, GO-LIVE `b53347b6` (`8f6652f`); at Task 42 the whole tree outside
`docs/superpowers/` equals gold's `43524fee`. Nothing pushed, merged, uploaded or released; no download and no web
request (the release APK's own look got no answer: `files.sandbee.in` has no DNS record). Disk: C: 72 GB, D: 15 → 14 GB
free.

### Commits (branch `feat/native-apps-2`, from `4ee022e`)

| Task | Commit | What |
|---|---|---|
| 40 | `08c5fd9` | the N3 review's minors as ruled: the no-answer words (the owner's), `errorCode` in the updater's error line, the `allowPrerelease` note, pin (3)'s comment, a JUnit message |
| 41 | `acd19cc` | `scripts/release-native.mjs` + `scripts/release-native.test.mjs` (12 tests), root `test:release-native` |
| 42 | `9424c70` | GO-LIVE "Existing cafes: the native apps 2.0 release", §7's install line, four §A rows; mobile README "Release a new version (both apps)"; `apps/desktop/README.md`; DEPLOY.md's native apps line; five runbook pins |
| 43 | (none) | every suite |
| 44 | (none) | the 2.0.0 set and the release folder (outside the repo), the emulator smoke |
| 45 | this commit | these Results |

### Counts

| Suite | Baseline (`4ee022e`) | After N4 (`9424c70`) | Expected |
|---|---|---|---|
| mobile (`npm test`) | 168 | 168, 0 fail | 168 |
| Jest (`npx jest`) | 8 | 8, 4 suites | 8 |
| JUnit (`:app:testDebugUnitTest --rerun`) | 94 | 94, 0 failures, 0 errors | 94 |
| desktop (`npm test`) | 211 | 211, 0 fail | 211 |
| `npm run test:release-native` | (none) | 12, 0 fail | 12 |
| cafe chain (`apps/cafe`, `npm test`) | 5802: 5801 pass, 0 fail, 1 skipped | 5807: 5806 pass, 0 fail, 1 skipped | 5807 |
| the go-live runbook | 97 | 102 | 102 |
| typecheck + lint (mobile, desktop, cafe) | clean | clean | clean |

### RED, then GREEN (each as the plan's Expected)

- Task 40: `not ok … (U2) updater.ts: download in the background, …`, `not ok … no answer at all (a network error) is not
  reached`, `not ok … no answer in time is not reached, and the request is aborted` (`# tests 82`, `# pass 79`,
  `# fail 3`). GREEN: desktop 211/211, typecheck and lint clean, `BUILD SUCCESSFUL`, JUnit `tests=94 failures=0 errors=0`.
- Task 41: `Cannot find module 'D:\\kd\\lucifer\\scripts\\release-native.mjs'`, `not ok 1 - scripts\\release-native.test.mjs`
  (`# tests 1`, `# fail 1`). GREEN: `# tests 12`, `# pass 12`, `# fail 0`.
- Task 42: six fail (`# tests 102`, `# pass 96`, `# fail 6`) with exactly the plan's messages (`§7 desktop sub-section
  must quote "Restart to update"`, three × `could not find the heading "### Existing cafes: the native apps 2.0
  release"`, `could not find the row "Update files base (both native apps)"`, `the mobile README's release section`).
  GREEN: runbook 102/102, cafe typecheck clean, desktop 211, mobile 168.
- Task 43: every count in the table above (the cafe chain `rc=0`).

### The 2.0.0 set (Task 44)

Evidence in the session scratchpad
(`C:\Users\Kartik.desai\AppData\Local\Temp\claude\d--kd-lucifer\00f0ea58-…\scratchpad`): `n4-apk/build.txt` (with
`readback/` for every APK and the logs), `shots/`, `files.log`, `printer-out/jobs.log`, `posupdate-step7.log`,
`crash-step7.log`.

- **Step 2, the builds (head `9424c70`): PASS**, about 3 minutes: `kotlin pair exit=0`, `pair exit=0 BUILD SUCCESSFUL`,
  `x86_64 exit=0`, `kotlin A exit=0`, `A exit=0`, `kotlin B exit=0`, `B exit=0`, `kotlin reset exit=0`, `installer
  exit=0`. Every APK `apksigner exit=0` and `V2 Signer: certificate SHA-256 digest:
  5bd06ef3e9a78efcb0dfbd1ff102de932c581a78034d93ef7572f5373b5b3e40`; every hash equals the gate's pre-run at `543b193`:

  | APK | Bytes | SHA-256 | Version, CPU, base, times |
  |---|---|---|---|
  | release arm64-v8a | 7,362,354 | `0dc49fc68569c5bd265f94b9878f2080ac901cbffec4e42e0fd95fac8d5284e1` | 20000 / 2.0.0, `'arm64-v8a'`, `https://files.sandbee.in/pos`, 720 / 30 |
  | release armeabi-v7a | 6,770,188 | `86c88741785b5b7db6bca5436308203ad02fd79e0dcdd7931654784ad209923e` | 20000 / 2.0.0, `'armeabi-v7a'`, the real base, 720 / 30 |
  | x86_64 (emulator only) | 7,494,077 | `39ab511f64250c6038de8bf83bafe004e00baf4179eac6d35de5937a5084a32f` | 20000 / 2.0.0, `'x86_64'`, the real base, 720 / 30 |
  | test A (emulator only) | 7,494,073 | `60e10533bd20140218b9f6f8f9a147cf6f09e7950c08532585f9f30b53b07c66` | 20000 / 2.0.0, `'x86_64'`, `http://127.0.0.1:8765/pos`, 1 / 1 |
  | test B (emulator only) | 7,494,081 | `42729a596cd17e0aade8e45bd12da32cbd11f842995eb674ff966ce05b5e66dd` | 20001 / 2.0.1, `'x86_64'`, the test base, 1 / 1 |

  The installer `apps/desktop/dist/POS-Software-Setup-2.0.0.exe` 112,542,431 B (electron-builder's hash differs per
  build), its blockmap 119,862 B, `latest.yml` `version: 2.0.0` with its SHA-512, `app-update.yml` `provider: generic`,
  `url: https://files.sandbee.in/pos/windows`, `updaterCacheDirName: pos-desktop-updater`.
- **Step 3, the release folder: PASS.** `D:\kd\pos-apk-release\Sandbee-POS-2.0.0` did not exist before (nor a
  `.partial`); the script printed `Sandbee POS 2.0.0 (versionCode 20000): D:\kd\pos-apk-release\Sandbee-POS-2.0.0` and
  the six files; `sha256sum -c SHA256SUMS.txt` OK six times; `latest.json` `"version": "2.0.0"`, `"versionCode": 20000`,
  `"released": "2026-10-13"`, the owner's notes, both APKs with the pair's hashes and sizes; no `.partial` left. The two
  refusals: `release-native: refused: A-2.0.0-x86_64.apk: native code x86_64, not arm64-v8a alone`, `exit=1` (nothing
  written in its `--out`); `release-native: refused: D:\kd\pos-apk-release\Sandbee-POS-2.0.0 already exists: a release
  folder is written once`, `exit=1`. Its `SHA256SUMS.txt`:

  ```text
  0dc49fc68569c5bd265f94b9878f2080ac901cbffec4e42e0fd95fac8d5284e1 *upload/pos/android/Sandbee-POS-2.0.0-arm64-v8a.apk
  86c88741785b5b7db6bca5436308203ad02fd79e0dcdd7931654784ad209923e *upload/pos/android/Sandbee-POS-2.0.0-armeabi-v7a.apk
  1f3398953cbbe326ff27660775d6a1a8da62ef6a9027cae56f1a00f4788b22d4 *upload/pos/android/latest.json
  29b6eb9c47675ae9337943ed20c611475d6ccb3a5ebb327900f7733285992f11 *upload/pos/windows/POS-Software-Setup-2.0.0.exe
  99306917a562d0e3a6fc9f7272ff96b0f4384153914a07da45cc6b65ca27f357 *upload/pos/windows/POS-Software-Setup-2.0.0.exe.blockmap
  4fc15fa75f810d44e0873c7a65488b7505277ea612b419a8ad43ee21de5785e4 *upload/pos/windows/latest.yml
  ```
- **Step 4: PASS.** `n4.env keys: MONGODB_URI, NEXTAUTH_SECRET, AUTH_SECRET, NEXTAUTH_URL, AUTH_TRUST_HOST,
  SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD` (no value printed); `(none with pos_scratch_e2e_n4s)`; `Admin account
  created.`; 3110, 8765 and 9100 free; `next start -p 3110` → `{"ok":true,"db":"up","tenant":"dev",…}`; `files.log`
  `listening for Sandbee-POS-2.0.1-x86_64.apk sha256 42729a59… size 7494081`; `latest.json` → `404`; the fake printer
  on 9100 (`keep.txt` in `printer-out`).
- **Step 5, the one-time move: PASS.** C: 72 GB free; `-no-snapshot -memory 2048` booted. As found: the debug-key
  release 1.0 (`versionCode=1`) on its start screen with an empty address. `pm uninstall` → `Success`; the three
  reverses; `adb install` of the x86_64 2.0.0 → `Success`, `versionCode=20000`, `versionName=2.0.0`. The start screen;
  `http://localhost:3110`, Back, Open POS → `PosUpdate: open`, `check: no answer` (the real base, no DNS record); the
  sign-in page; `e2eadmin`, the password by `type-secret.py` (23 characters), Enter → the Dashboard; the crash buffer
  empty.
- **Step 6, a print: PASS.** The printer button → the panel; `127.0.0.1` in Printer address, Use this network printer →
  "Network printer 127.0.0.1 is connected."; Print test slip → `jobs.log` job 3 `"bytes":13706`, `"statusOnly":false`
  (the gate's 13,706 bytes; jobs 1–2 are the connect probe and the status check); Yes ("Printing works on this
  device."), Done; the top bar's dot green; no crash.
- **Step 7, Cancel in Android's dialog: PASS.** `__mode` → `{"manifest":"ok","apk":"fast"}`; A over 2.0.0 with
  `install -r` (still signed in); launch → `open`, `download: 2.0.1 verified (7494081 bytes)`, no card (`files.log`:
  one `latest.json`, one APK, `sent … (7494081 bytes)`). HOME, 70 s, launch → `open`, `check: 2.0.1 is ready`,
  `card: 2.0.1`: "Update available", "Sandbee POS 2.0.1 is ready to install.", "A test update from the fake files
  server.", the first-install line, Install, Later. Install → `install: permission`, "Install unknown apps" for Sandbee
  POS 2.0.0 → Allow from this source (`REQUEST_INSTALL_PACKAGES: allow`) → Back → the card with "Allow Sandbee POS to
  install apps, then tap Install again." (pid 5158 unchanged) → Install → `install: started`, "Do you want to update this
  app?" → Cancel → `install: cancelled`, the card gone with no line, pid 5158, still 2.0.0. HOME, 70 s, launch → `open`,
  `check: 2.0.1 is ready`, `card: 2.0.1`. The crash buffer empty throughout.
- **Step 8, put back: PASS.** `pm uninstall` → `Success`; `pos-emulator-x86_64-release.apk` (`29115bdf…`) → `Success`,
  `versionCode=1`, `versionName=1.0`; `adb reverse --remove-all` (none listed after); `adb shell sync`; `adb emu kill`.
  This session's `next start` (PID 17700), fake files server (51600) and fake printer (54116) stopped by PID after
  checking their command lines; nothing listens on 3110, 8765 or 9100. The scratch database `pos_scratch_e2e_n4s`
  stays.

### Differences from this plan, and why

No difference in code or behaviour: every block applied as written, every Expected matched. Notes:
1. Task 44 Step 5: the release APK's `open` / `check: no answer` lines appear when Open POS shows the POS screen, not on
   the start screen: the updater's native module loads with the POS screen (`useUpdateCard` in `PosScreen.tsx`), as
   designed (no look before an address is set). The lines and their order are the plan's.
2. Task 44 Step 5: the first `type-secret.py` refused ("the focused field is not a password field": the dump right after
   TAB still showed the username field focused) and the following Enter submitted the form with no password ("Password
   is required", the local POS only); the second run typed it into the focused password field and signed in.
3. The final review ran in the background during Task 44 Steps 4–8, read-only and told to stay off Gradle, npm, adb,
   the servers and the network.

### The final review (Claude Fable 5.1, a fresh context, `1672a85..9424c70`)

Verdict **"Ready to merge: Yes"**: 0 Critical, 0 Important, 5 Minor. The reviewer read the whole native apps 2.0 range
statically (the Kotlin updater, the React Native side, the desktop app, the packaging script and its tests, the docs,
every Results and gate section, the ledger, the release folder's `UPLOAD-STEPS.txt`, `SHA256SUMS.txt`, `latest.json`
and `latest.yml`, and Task 44's build read-back), during Task 44 Steps 4–8, with no build, no test run, no device, no
server and no network. It confirmed each Review Focus item in code and in a test that would catch its loss, the Android
integrity chain (the plain file name under the base, size and SHA-256, then package, versionCode and an identical
signer set, `USER_ACTION_REQUIRED`, a private receiver, no install without a tap), the never-block rule on both apps,
the free-tier rule (one `GET /api/health` from the main process only), that the release folder was built from the head
(`9424c70`) and that its `latest.json` passes every rule of `UpdateManifest.read`, that `UPLOAD-STEPS.txt` is spec §10,
and that every claim in the new docs is true of the code. The re-grade by effect kept all five at Minor (none changes a
staff member's day or the 2.0.0 release path), so there was no fix pass and the release folder stays matched to the
head. The minors, for the owner:

1. The runbook pin `apps/cafe/lib/go-live-runbook.test.ts:1406` asserts the Windows app's version `"2.0.0"` literally,
   and the mobile README's "Release a new version (both apps)" step 1 names only pin 27: the next version bump turns
   the cafe chain red in a workspace the builder did not touch. Make the pin compare with `posVersionRelease` (as pin 27
   does), or name it in the README, before 2.0.1.
2. GO-LIVE §7 (`docs/GO-LIVE-CHECKLIST.md:860`) "The tray icon has **Open POS** and **Quit**." misses "Change POS
   address…" and, once an update is downloaded, "Restart to update".
3. GO-LIVE's "First, the owner's upload" presumes the bucket and HTTPS on `files.sandbee.in` exist; the checklist does
   not point at spec §10's set-up (the phone check at the end of the step is the only gate).
4. `PosUpdateModule.install()` runs on the same single worker as the look and installs the kept verified file, not the
   card's version: only when two releases fall within one check cycle and Install is tapped in the open whose look
   started the newer download (the button waits for that download, then installs the newer version, or answers
   "missing" mid-swap). The N1/N2 gates' deferred "two releases between opens" stands; this is its new nuance.
5. `PosScreen.tsx` takes the open's card (`useUpdateCard`) before the load-error early return, so a card is used up while
   the load-error screen shows; the next open offers it again.

Set aside by the reviewer, with this session's rulings (all stand): the unsigned Windows installer (spec §12; the
bucket's write access is the root of trust); a 1.x address the stricter rules reject is asked again (the N3 gate); a
503 naming a tenant counts as found (the N3 review); a system dialog between `shown` and `takeCard` (the N1 gate);
`lastCheckAt` on any HTTP answer (N2); a redirect read as no answer (the N3 gate's m-3); API 34/35 (only an API 33 image
here: repeat E5 when one exists); cleartext allowed at the OS level for LAN POS addresses (pre-existing; the update base
admits only `https://` or `127.0.0.1`); the smoke and these Results (recorded above, database `pos_scratch_e2e_n4s`);
`x86`/`x86_64` in the manifest reader (emulator test manifests; the packaging writes only the pair); the old device's
printer rows (the N3 gate); the Co-Authored-By line (the owner's N4 prompt).

The reviewer's recommendations for the owner: treat the S3 bucket's write credentials as the root of trust for every
Windows PC (owner-only, with MFA; public read only on `pos/*`, listing blocked); once `files.sandbee.in` answers, one
real check before any cafe moves (a 2.0.0 phone logs `check: ignored (not newer)`, a 2.0.0 PC's log shows its look at
`latest.yml`), then GO-LIVE's step; take minor 1 before the next version bump.

### What is next

The owner's merge OK (this branch: `main` `543b193` + `4ee022e` + this session's four commits). Then, with the owner,
step by step: the S3 bucket and HTTPS on `files.sandbee.in` (spec §10), the owner's upload of
`D:\kd\pos-apk-release\Sandbee-POS-2.0.0\` as its `UPLOAD-STEPS.txt` says (`latest.json` and `latest.yml` last), the
real check from a phone and a PC, and then GO-LIVE's "Existing cafes: the native apps 2.0 release".
