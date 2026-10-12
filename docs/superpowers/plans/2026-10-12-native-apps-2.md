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
- Windows: check 1 minute after start and every 24 hours; `autoDownload: true`, `autoInstallOnAppQuit: true`, `allowDowngrade: false`, `allowPrerelease: false`; one notification "POS Software <version> is ready. It installs when you close the app." and a tray item **Restart to update**; no dialog.
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
4. **A release built the wrong way.** No key on the build PC, an `aR` build (no "release" in its task name), a missing key file, a test base or shortened times left in: the build stops or the packaging refuses. Never a debug-key or test-base release. Pinned in N1 Task 2 (pin 28 + three Gradle dry runs), N1 Task 3 (pin 29 + Gradle refusals) and N4 Task 1 (the packaging refuses a non-default base, another signer or mismatched versions).
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
| `apps/mobile/src/mobile-paths.test.ts` | N1, N2 | pins 27–29 (N1) and the updater pins (N2) |
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

# Session N2: the Android updater at run time (spec; made exact at the N1 gate)

Acceptance: an installed 2.0.0 (private key) finds 2.0.1 on a fake files server, downloads it in the background, shows
the card at the next app open, installs on a tap and comes back as 2.0.1, printing; every failure path stays silent and
leaves the app as it was.

### Task 1: `UpdateStore` (private preferences)

- `object UpdateStore` in `com.possoftware.pos.update`, its own preferences file `pos_update` (never the printer `Prefs`).
- `fun lastCheckAt(ctx: Context): Long` / `fun setLastCheckAt(ctx: Context, wallMs: Long)`.
- `data class Verified(val versionCode: Int, val version: String, val notes: String, val file: String, val sha256: String)`; `fun verified(ctx): Verified?` (null unless all fields are present and `updatesDir(ctx)/file` exists); `fun saveVerified(ctx, v: Verified)`; `fun clearVerified(ctx)`.
- `fun updatesDir(ctx): File` = `filesDir/updates`.
- `fun startUp(ctx, installedCode: Int)`: when the stored versionCode ≤ `installedCode`, or the file is gone, delete everything in `updates/` and clear the entry (§6.2.6). Called once per process from the module's init.
- Tests: on the emulator (E-cases below); the store's logic has no branch worth a JVM test beyond `startUp`'s rule, which the gate may move into a pure `UpdateFiles.staleAfterUpdate(storedCode: Int?, installedCode: Int, fileExists: Boolean): Boolean` with JUnit cases (stored ≤ installed → stale; file missing → stale; newer + present → keep; none → nothing to do).

### Task 2: `UpdateFiles` (pure) and `UpdateDownloader`

- `object UpdateFiles` (pure, JUnit):
  - `fun manifestUrl(base: String): String` = `base.trimEnd('/') + "/android/latest.json"`;
  - `fun apkUrl(base: String, file: String): String` = `base.trimEnd('/') + "/android/" + file` (the file already passed `UpdateManifest`'s plain-name rule);
  - `fun copyVerified(input: InputStream, out: OutputStream, size: Int, sha256: String): Boolean`: copies at most `size + 1` bytes, true only when exactly `size` bytes came and their SHA-256 (lower-case hex) equals `sha256`.
  - JUnit cases: exact bytes → true; one byte changed → false; one byte short (a dropped connection) → false; one byte longer → false and at most `size + 1` bytes read; an HTML error page instead of the APK → false.
- `UpdateDownloader` (runs on one background thread owned by the module; never the main thread, never the printer threads):
  - `fun fetchManifest(base: String): String?`: `HttpURLConnection` GET, connect and read timeouts 10 s each, `Accept: application/json`, only HTTP 200, at most `UpdateManifest.MAX_JSON_CHARS + 1` characters read; any error → null.
  - `fun download(ctx: Context, base: String, offer: UpdateManifest.Offer): File?`: deletes every other file in `updates/`, streams into `<file>.part` through `copyVerified`, renames to `<file>` only when it returns true, then `ApkCheck`; any failure deletes the files and returns null (retried at the next check).
- `ApkCheck.matches(ctx, apk: File, offer): Boolean`: `PackageManager.getPackageArchiveInfo` with `GET_SIGNING_CERTIFICATES` (API 28+; `GET_SIGNATURES` below) — package equals ours, `longVersionCode` equals `offer.versionCode`, and the signing certificates equal the installed app's. A mismatch deletes the file.
- Logging: one line per check and per download result to Logcat tag `PosUpdate` (no URLs with secrets exist; the base is public).

### Task 3: `UpdateInstaller` and `UpdateInstallReceiver`

- `UpdateInstaller.install(ctx: Context, apk: File): InstallStart` where `enum class InstallStart { STARTED, NEEDS_PERMISSION, MISSING }`.
  - Android 8+: `packageManager.canRequestPackageInstalls()` false → open `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` with `package:com.possoftware.pos` (NEW_TASK) and return `NEEDS_PERMISSION`.
  - A `PackageInstaller` session (`MODE_FULL_INSTALL`, `setAppPackageName`), the verified file written into it, `commit` with a `PendingIntent` to `UpdateInstallReceiver` (`FLAG_MUTABLE` on Android 12+, required for the installer's extras).
- `UpdateInstallReceiver` (manifest, `exported="false"`): `STATUS_PENDING_USER_ACTION` → start the `EXTRA_INTENT` (Android's own confirm dialog, NEW_TASK); success → nothing (the app is being replaced); any failure → log + the event `PosUpdateResult` `{ ok: false }` to JS when React runs, and the store keeps the file so the next open offers the card again.
- Manifest: `<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />` and the receiver. Pin 6's manifest table changes deliberately (one permission, one receiver more).

### Task 4: `PosUpdateModule` ("PosUpdate") and `PosUpdatePackage`

- Registered in `MainApplication` next to `PosPrinterPackage` (`add(PosUpdatePackage())`); a pin like pin 5.
- Built in `init`: `UpdateStore.startUp`, the installed code from `BuildConfig.VERSION_CODE`, `UpdateSchedule(installedCode, checkMinutes × 60 000, reopenMinutes × 60 000)` from the resources of N1 Task 3, the base from `R.string.pos_update_base` (no URL literal in Kotlin: a pin).
- `LifecycleEventListener`: `onHostResume` → `schedule.shown(SystemClock.elapsedRealtime(), UpdateStore.verified(ctx)?.versionCode)`; on an open, if `schedule.checkDue(System.currentTimeMillis(), UpdateStore.lastCheckAt(ctx))`, the background thread runs: fetch → `UpdateManifest.read(json, packageName, installed, Build.SUPPORTED_ABIS.toList())` → when `Accepted` and not already verified for that code → `download` → `saveVerified`. `lastCheckAt` is set when the manifest request got any HTTP answer (a network error tries again at the next open). `onHostPause` → `schedule.hidden(elapsed)`.
- `@ReactMethod takeCard(promise)`: the spec's `status()`. Resolves `{ version, notes }` from `schedule.takeCard()` + the store, or `null`. The card is handed out only while no printer of this app has a job in flight (the gate names the accessor in `PrinterPool`/`HostController`); while one is printing, the module keeps the card and emits `PosUpdateCard` when the printers are idle, as long as the app stays in view (checked every 2 s; dropped when the app goes away).
- `@ReactMethod install(promise)`: waits up to 30 s for the printers to be idle, then `UpdateInstaller.install` → resolves `"started" | "permission" | "missing"`.
- `@ReactMethod later()`: logs only (the schedule already handed the card out once).
- Pins: the JS wrapper's method list equals the `@ReactMethod` list (like pin 4); `MainApplication` registers the package; the base comes only from `R.string.pos_update_base`; the check runs only from the open path (`if (open && schedule.checkDue(`).

### Task 5: The JS side and the card

- `src/native/PosUpdate.ts`: the wrapper (same `call()` pattern as `PosPrinter.ts`); `type UpdateCardInfo = { version: string; notes: string }`; `takeCard(): Promise<UpdateCardInfo | null>`, `install(): Promise<'started' | 'permission' | 'missing'>`, `later(): void`; event names `PosUpdateCard`, `PosUpdateResult`.
- `src/update-card.ts` (pure, node tests in `src/update-card.test.ts`, added to the `test` script): a reducer over `{ card: UpdateCardInfo | null; visible: boolean; note: 'none' | 'permission' | 'failed' }` with events `card(info)`, `appState('active' | 'background' | 'inactive')`, `install(result)`, `later()`, `installFailed()`. Rules: a card arriving while the app is not active is dropped; going to the background drops a card (never later in a session); `permission` keeps the card with the note; `later` hides it; `installFailed` shows "failed" once.
- `src/screens/UpdateCard.tsx`: a sheet over the POS (only in `PosScreen`, like the battery overlay), the Sandbee logo (`Brand.tsx`), "Update available", "Sandbee POS <version> is ready to install.", the notes, "The first time, Android asks you to allow installs from Sandbee POS.", **Install** (primary) and **Later**. Notes: permission → "Allow Sandbee POS to install apps, then tap Install again."; failed → "The update could not be installed. It will be offered again next time." No network, no timers beyond the reducer.
- `PosScreen.tsx`: on mount `PosUpdate.takeCard()`, listens to `PosUpdateCard`/`PosUpdateResult` and `AppState`.

### Task 6: Emulator end to end (spec §11)

- Fake files server (scratch, `$SP/n2-files.mjs`, port 8765, request log, switchable answers: 404 / a manifest / a wrong hash / slow), `adb reverse tcp:8765 tcp:8765`; the local POS on 3110 (`adb reverse tcp:3110`) and the fake printer on 9100.
- Test APKs (x86_64, private key, `-PposUpdateBase=http://127.0.0.1:8765/pos -PposUpdateCheckMinutes=1 -PposUpdateReopenMinutes=1`): A = 2.0.0, B = 2.0.1 (`-PposVersion=2.0.1`). The fake manifest names B's file under the key `x86_64`.
- Before anything: `pm path` and the demo sign-in check; the emulator's current app is signed with the debug key, so it is uninstalled first (the one-time move, rehearsed: install A, type the cafe name, sign in, set the printer, choose this device again in Admin → Printer setup).
- Cases, each with evidence (screencap, the server log, `logcat -s PosUpdate`):
  - E1: 404 → no card, the app works, exactly one manifest request per open once the check is due.
  - E2: a wrong hash → the APK is downloaded and deleted, no card, nothing left in `updates/` (seen in the log).
  - E3: correct → the download finishes while the app stays in view: no card in this open (3 minutes watched).
  - E4: HOME for ≥ 1 minute, back → the card; **Later** → gone; the next open → the card again.
  - E5: **Install** → the permission page the first time → allow → **Install** → Android's dialog → update → the app ends → **Open** → 2.0.1 (`dumpsys package` versionName) → "POS printing is off. Tap to start." → tap → a test slip prints on the fake printer; the updates folder is cleared at start.
  - E6: no network at an open (`adb reverse --remove tcp:8765`) → nothing, no crash.
  - E7: the app hidden while the download finishes → no card until the next open.
  - E8: a print in flight when the card is due → the card waits until the print is done.
- Then the emulator is put back as the gate needs it, `adb shell sync` before `adb emu kill`.

---

# Session N3: the Windows app (spec; made exact at the N2 gate)

Acceptance: the address window looks and behaves like the Android start screen and accepts a bare name; the app updates
itself from a fake files server on this PC, installing when it quits or on "Restart to update".

### Task 1: The Android address rules on Windows (`src/pos-url.ts`)

- A port of `apps/mobile/src/url.ts`'s `normalizePosUrl` and the helpers it needs (`parseUrlParts`, `isValidHost`, `isPrivateIpv4`, `expandWorkspaceName`, the error strings, `SANDBEE_DOMAIN`), with a header naming the source; `NormalizeResult` as on Android.
- `src/pos-url.test.ts` (added to the desktop `test` script): one table of at least 40 inputs, run through the desktop function and through `apps/mobile/src/url.ts` (dynamic `import()` by relative path: it has no imports, so node can load it). Results must be deeply equal. The table includes: `mycafe`, `MyCafe `, `  mycafe  `, `mycafe/pos`, `mycafe?x=1`, `mycafe.sandbee.in`, `https://mycafe.sandbee.in/pos`, `HTTPS://MyCafe.Sandbee.in`, `http://mycafe.sandbee.in`, `http://localhost:3000`, `http://127.0.0.1:3110`, `http://192.168.1.20:3000`, `http://10.0.0.5`, `http://172.16.0.1`, `http://172.32.0.1`, `http://8.8.8.8`, `https://8.8.8.8`, `1234`, `192.168.1.20`, `localhost`, `https://user:pw@mycafe.sandbee.in`, `https://mycafe.sandbee.in:0`, `:65536`, `:443`, `:8443`, `ftp://mycafe.sandbee.in`, `my_cafe`, `-mycafe`, `mycafe-`, a 64-character label, a 253+ character host, `[::1]`, `https://[::1]`, `mycafé`, an empty string, spaces only, a tab inside, `https://mycafe.sandbee.in#x`, `mycafe.sandbee.in/`, `https://mycafe.sandbee.in./`.
- Seven fixed expectations besides parity (e.g. `MyCafe ` → `https://mycafe.sandbee.in`; `http://8.8.8.8` → the http error) so both cannot drift together.
- `url-window.ts`'s save handler uses `normalizePosUrl`; `normalizeServerUrl` and its tests go if nothing else uses them (the gate checks `store.ts` and `main.ts`).

### Task 2: The one health check (`src/pos-health.ts`)

- `type PosCheck = { ok: true } | { ok: false; error: string }`; `checkPos(origin: string, fetcher: typeof fetch, timeoutMs = 5000): Promise<PosCheck>`.
- `GET <origin>/api/health` once, no redirects to another origin. Found = a JSON body with a string `tenant` and a boolean `ok`, at status 200 **or 503** (refinement of §9 recorded here: 503 is a POS whose database is down; the address is right, so it is saved, and the POS page shows its own error). Anything else (404, an HTML page, other JSON) → "We couldn't find a POS at <host>. Check the name." A network error or the timeout → "Couldn't reach <host>. Check the internet connection."
- Tests with a fake fetcher: 200 found; 503 found; 404; 200 HTML; 200 JSON without `tenant`; a thrown `TypeError`; a timeout (an `AbortSignal` that fires); exactly one request per call.
- The main process passes Electron's `net.fetch` (system proxy); the gate confirms the import.

### Task 3: The window

- `assets/url-window.html` + `assets/url-window.js` redesigned per §9: 480 × 640, not resizable; background `#f5f7fb`, a white card, the red Sandbee icon (`assets/app-icon.png`), "Connect to your workspace", "Your cafe, orders and printers. All in one place.", label "POS address", the field with an icon and a clear button, placeholder "yourcafe or yourcafe.sandbee.in", the info box "Your workspace" / "Type your workspace name, or the full address shared by your administrator. We'll remember it for next time." (red "Check the address" with the error text), a full-width **Open POS** (`#2f6fed`, "Connecting…" while checking), **Cancel** only from "Change POS address…", footer "Windows printers · USB · Wi-Fi / LAN" and "POS Software by sandbee · <version>". Enter submits; Esc cancels when Cancel is shown. The window title "POS address". The CSP stays as strict as today.
- `url-preload.ts` adds the app version (an additional argument, like `shell-window.ts`'s `VERSION_ARG_PREFIX`); the save IPC becomes normalize → `checkPos` → save, returning the error text to the page.
- `desktop-paths.test.ts`: pins (8)/(9) change deliberately to the new copy, size and the Cancel rule; a new pin that the window makes no request itself (only the main process's one `checkPos`).
- A visual check: headless desktop Chrome (`npx playwright-core`) loads the page with a stub `posDesktopSetup`; screenshots at 480 × 640 of empty, typing, error, connecting and the Cancel variant, kept in the scratchpad and looked at.

### Task 4: "Change POS address…" everywhere

- `menu.ts` (Help menu and tray), the comments in `main.ts`, `shell-window.ts`, `url-window.ts`; `docs/GO-LIVE-CHECKLIST.md` (line 817 and any other), `apps/cafe/DEPLOY.md` (line 169), `apps/cafe/lib/go-live-runbook.test.ts` (line 1321: the menu pin). A grep for "Change server address" returns only history (plans, specs).

### Task 5: The Windows updater

- `electron-updater` as a dependency, pinned exact to the version `npm view electron-builder@26.16.0` pairs it with (recorded).
- `package.json` `build.publish`: `[{ "provider": "generic", "url": "https://files.sandbee.in/pos/windows" }]`; `dist` keeps `--publish never`. A test build overrides it on the command line (`-c.publish.url=http://127.0.0.1:8766/pos/windows -c.extraMetadata.version=2.0.1`): electron-updater reads the base from the installed `resources/app-update.yml`, so this is the one setting (it replaces the spec's "extraMetadata base" idea; same rule: the packaging refuses any other base).
- `src/update-plan.ts` (pure, tested): `FIRST_CHECK_MS = 60_000`, `CHECK_EVERY_MS = 86_400_000`; `readyNotice(version)` → title "Update ready", body "POS Software <version> is ready. It installs when you close the app."; `trayUpdateItem(state)` → nothing until downloaded, then "Restart to update".
- `src/updater.ts`: `autoUpdater` with `autoDownload = true`, `autoInstallOnAppQuit = true`, `allowDowngrade = false`, `allowPrerelease = false`, the logger → `log.ts`; checks at 1 minute and every 24 hours; only when `app.isPackaged`; errors logged only; on `update-downloaded` one notification per version and the tray rebuilt with **Restart to update**, which runs the tray Quit's own path and then `autoUpdater.quitAndInstall(true, true)`. No `dialog`, no automatic restart.
- `desktop-paths.test.ts` pins: the publish config; the four updater settings; no `dialog` in `updater.ts`; `quitAndInstall` only from the tray item; the menu text.

### Task 6: Windows end to end on this PC (D8)

- Check first: the app is not installed here, and its user-data folder (`%APPDATA%\POS Software by sandbee` or as `app.getPath('userData')` says) does not exist; if either exists, stop and ask.
- Fake files server (`$SP/n3-files.mjs`, port 8766). Builds A = 2.0.0-test and B = 2.0.1-test (test publish url); B's `latest.yml`, installer and blockmap served.
- Install A silently per-user into `D:\kd\pos-dev-keep\win-test\` (`/S /D=…`), start it: the address window (screenshots): `localhost:3110`-style local address works; a bare name typed with spaces and capitals; a wrong name → "We couldn't find a POS at …"; no network → "Couldn't reach …"; `posdemo` → only the one read-only health GET (the demo rule: no login).
- The updater: within about a minute B downloads → one notification (screenshot) → the tray shows **Restart to update** → click → it installs and reopens as 2.0.1 (version in the window footer), the saved address and printers kept. Then a 2.0.2-test build: **Quit** from the tray → the next start is 2.0.2.
- Uninstall silently, remove the test folder and the test's user data, `adb`-free. Record every step in the Results.

---

# Session N4: release folder, docs, the 2.0.0 set and the final review (spec; made exact at the N3 gate)

### Task 1: `scripts/release-native.mjs`

- Run: `node scripts/release-native.mjs --arm64 <apk> --armv7 <apk> --windows apps/desktop/dist --notes "<text>" [--released YYYY-MM-DD]`. It builds nothing.
- Checks, refusing with a clear line on the first failure: each APK's signer SHA-256 (`apksigner verify --print-certs`) equals `EXPECTED_CERT_SHA256` (N1's fingerprint, a constant in the script); `aapt2 dump badging`: package `com.possoftware.pos`, versionName = `apps/desktop/package.json` version, versionCode = its code, not debuggable, the right native-code ABI per file; `aapt2 dump resources`: `pos_update_base` = `https://files.sandbee.in/pos`, check 720, reopen 30; Windows: `dist/latest.yml` version = the version, its file = `POS-Software-Setup-<version>.exe`, its sha512 = the installer's, the blockmap present, `dist/win-unpacked/resources/app-update.yml` url = `https://files.sandbee.in/pos/windows`; notes ≤ 300 characters; the release folder does not exist yet.
- Writes `D:\kd\pos-apk-release\Sandbee-POS-<version>\upload\pos\android\{latest.json, Sandbee-POS-<version>-arm64-v8a.apk, Sandbee-POS-<version>-armeabi-v7a.apk}` and `upload\pos\windows\{latest.yml, POS-Software-Setup-<version>.exe, POS-Software-Setup-<version>.exe.blockmap}`, `SHA256SUMS.txt` (every file) and `UPLOAD-STEPS.txt` (the S3 keys, the order: APKs + installer + blockmap first, `latest.json` + `latest.yml` last; `Cache-Control: max-age=60` for `latest.*`, `max-age=31536000, immutable` for versioned files; how to check from a phone).
- `scripts/release-native.test.mjs` (root script `test:release-native`): the pure parts — the manifest writer checked by the same rules as `UpdateManifest` (a JS validator with the JUnit cases' table), the version code, the file names, the `latest.yml` reader, the steps text, refusal of an existing folder.

### Task 2: Docs

- `docs/GO-LIVE-CHECKLIST.md`: a new section "Existing cafes: the native apps 2.0 release" (each printing phone or tablet once: uninstall, install 2.0.0, open, type the cafe's name, sign in, set this device's printer, Admin → Printer setup → choose this device again; Windows installs over 1.x; what staff see from then on: the card at an app open, Install or Later; Windows installs at closing or on "Restart to update"; nothing ever blocks work); §7's install lines point at `files.sandbee.in` once the owner has set it up; §A pinned facts. Pins in `go-live-runbook.test.ts`.
- `apps/mobile/README.md` and `apps/desktop/README.md`: building a release and running the packaging; the upload order. `apps/cafe/DEPLOY.md`: the line about the native apps.

### Task 3: Full verification

- Every suite equal to the expected counts (mobile, desktop, JUnit, `test:release-native`, the go-live runbook test, the cafe typecheck), lint and typecheck clean.

### Task 4: The 2.0.0 release set

- Build the APK pair (private key, real base; `:app:compileReleaseKotlin --rerun` first) and the Windows installer (`npm run dist`); run the packaging into `D:\kd\pos-apk-release\Sandbee-POS-2.0.0\`; an x86_64 build of the same commit installed on the emulator for a smoke test (open, sign in, print).
- Nothing is uploaded. The owner gets the folder path, `UPLOAD-STEPS.txt`, and (later, with the owner) the S3 + domain steps.

### Task 5: The final review

- A fresh review of the whole branch (spec, plan, diff, Results) on Claude Fable 5.1 (on a 429 limit: wait for the reset, never switch silently). Fixes by TDD; Results; the owner's merge OK.
