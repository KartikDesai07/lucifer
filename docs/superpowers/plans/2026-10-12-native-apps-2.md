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

# Session N3: the Windows app (spec; made exact at the N2 gate)

Acceptance: the address window looks and behaves like the Android start screen and accepts a bare name; the app updates
itself from a fake files server on this PC, installing when it quits or on "Restart to update".

Tasks are numbered 31–36 (the N1 review gate: `task-brief` collects every "Task N" heading in this plan). Every suite
run in this session includes the cafe chain (`cd apps/cafe && npm test`; 5656 at the N1 gate).

### Task 31: The Android address rules on Windows (`src/pos-url.ts`)

- A port of `apps/mobile/src/url.ts`'s `normalizePosUrl` and the helpers it needs (`parseUrlParts`, `isValidHost`, `isPrivateIpv4`, `expandWorkspaceName`, the error strings, `SANDBEE_DOMAIN`), with a header naming the source; `NormalizeResult` as on Android.
- `src/pos-url.test.ts` (added to the desktop `test` script): one table of at least 40 inputs, run through the desktop function and through `apps/mobile/src/url.ts` (dynamic `import()` by relative path: it has no imports, so node can load it). Results must be deeply equal. The table includes: `mycafe`, `MyCafe `, `  mycafe  `, `mycafe/pos`, `mycafe?x=1`, `mycafe.sandbee.in`, `https://mycafe.sandbee.in/pos`, `HTTPS://MyCafe.Sandbee.in`, `http://mycafe.sandbee.in`, `http://localhost:3000`, `http://127.0.0.1:3110`, `http://192.168.1.20:3000`, `http://10.0.0.5`, `http://172.16.0.1`, `http://172.32.0.1`, `http://8.8.8.8`, `https://8.8.8.8`, `1234`, `192.168.1.20`, `localhost`, `https://user:pw@mycafe.sandbee.in`, `https://mycafe.sandbee.in:0`, `:65536`, `:443`, `:8443`, `ftp://mycafe.sandbee.in`, `my_cafe`, `-mycafe`, `mycafe-`, a 64-character label, a 253+ character host, `[::1]`, `https://[::1]`, `mycafé`, an empty string, spaces only, a tab inside, `https://mycafe.sandbee.in#x`, `mycafe.sandbee.in/`, `https://mycafe.sandbee.in./`.
- Seven fixed expectations besides parity (e.g. `MyCafe ` → `https://mycafe.sandbee.in`; `http://8.8.8.8` → the http error) so both cannot drift together.
- `url-window.ts`'s save handler uses `normalizePosUrl`; `normalizeServerUrl` and its tests go if nothing else uses them (the gate checks `store.ts` and `main.ts`).

### Task 32: The one health check (`src/pos-health.ts`)

- `type PosCheck = { ok: true } | { ok: false; error: string }`; `checkPos(origin: string, fetcher: typeof fetch, timeoutMs = 5000): Promise<PosCheck>`.
- `GET <origin>/api/health` once, no redirects to another origin. Found = a JSON body with a string `tenant` and a boolean `ok`, at status 200 **or 503** (refinement of §9 recorded here: 503 is a POS whose database is down; the address is right, so it is saved, and the POS page shows its own error). Anything else (404, an HTML page, other JSON) → "We couldn't find a POS at <host>. Check the name." A network error or the timeout → "Couldn't reach <host>. Check the internet connection."
- Tests with a fake fetcher: 200 found; 503 found; 404; 200 HTML; 200 JSON without `tenant`; a thrown `TypeError`; a timeout (an `AbortSignal` that fires); exactly one request per call.
- The main process passes Electron's `net.fetch` (system proxy); the gate confirms the import.

### Task 33: The window

- `assets/url-window.html` + `assets/url-window.js` redesigned per §9: 480 × 640, not resizable; background `#f5f7fb`, a white card, the red Sandbee icon (`assets/app-icon.png`), "Connect to your workspace", "Your cafe, orders and printers. All in one place.", label "POS address", the field with an icon and a clear button, placeholder "yourcafe or yourcafe.sandbee.in", the info box "Your workspace" / "Type your workspace name, or the full address shared by your administrator. We'll remember it for next time." (red "Check the address" with the error text), a full-width **Open POS** (`#2f6fed`, "Connecting…" while checking), **Cancel** only from "Change POS address…", footer "Windows printers · USB · Wi-Fi / LAN" and "POS Software by sandbee · <version>". Enter submits; Esc cancels when Cancel is shown. The window title "POS address". The CSP stays as strict as today.
- `url-preload.ts` adds the app version (an additional argument, like `shell-window.ts`'s `VERSION_ARG_PREFIX`); the save IPC becomes normalize → `checkPos` → save, returning the error text to the page.
- `desktop-paths.test.ts`: pins (8)/(9) change deliberately to the new copy, size and the Cancel rule; a new pin that the window makes no request itself (only the main process's one `checkPos`).
- A visual check: headless desktop Chrome (`npx playwright-core`) loads the page with a stub `posDesktopSetup`; screenshots at 480 × 640 of empty, typing, error, connecting and the Cancel variant, kept in the scratchpad and looked at.

### Task 34: "Change POS address…" everywhere

- `menu.ts` (Help menu and tray), the comments in `main.ts`, `shell-window.ts`, `url-window.ts`; `docs/GO-LIVE-CHECKLIST.md` (line 817 and any other), `apps/cafe/DEPLOY.md` (line 169), `apps/cafe/lib/go-live-runbook.test.ts` (line 1321: the menu pin). A grep for "Change server address" returns only history (plans, specs).

### Task 35: The Windows updater

- `electron-updater` as a dependency, pinned exact to the version `npm view electron-builder@26.16.0` pairs it with (recorded).
- `package.json` `build.publish`: `[{ "provider": "generic", "url": "https://files.sandbee.in/pos/windows" }]`; `dist` keeps `--publish never`. A test build overrides it on the command line (`-c.publish.url=http://127.0.0.1:8766/pos/windows -c.extraMetadata.version=2.0.1`): electron-updater reads the base from the installed `resources/app-update.yml`, so this is the one setting (it replaces the spec's "extraMetadata base" idea; same rule: the packaging refuses any other base).
- `src/update-plan.ts` (pure, tested): `FIRST_CHECK_MS = 60_000`, `CHECK_EVERY_MS = 86_400_000`; `readyNotice(version)` → title "Update ready", body "POS Software <version> is ready. It installs when you close the app."; `trayUpdateItem(state)` → nothing until downloaded, then "Restart to update".
- `src/updater.ts`: `autoUpdater` with `autoDownload = true`, `autoInstallOnAppQuit = true`, `allowDowngrade = false`, `allowPrerelease = false`, the logger → `log.ts`; checks at 1 minute and every 24 hours; only when `app.isPackaged`; errors logged only; on `update-downloaded` one notification per version and the tray rebuilt with **Restart to update**, which runs the tray Quit's own path and then `autoUpdater.quitAndInstall(true, true)`. No `dialog`, no automatic restart.
- `desktop-paths.test.ts` pins: the publish config; the four updater settings; no `dialog` in `updater.ts`; `quitAndInstall` only from the tray item; the menu text.

### Task 36: Windows end to end on this PC (D8)

- Check first: the app is not installed here, and its user-data folder (`%APPDATA%\POS Software by sandbee` or as `app.getPath('userData')` says) does not exist; if either exists, stop and ask.
- Fake files server (`$SP/n3-files.mjs`, port 8766). Builds A = 2.0.0-test and B = 2.0.1-test (test publish url); B's `latest.yml`, installer and blockmap served.
- Install A silently per-user into `D:\kd\pos-dev-keep\win-test\` (`/S /D=…`), start it: the address window (screenshots): `localhost:3110`-style local address works; a bare name typed with spaces and capitals; a wrong name → "We couldn't find a POS at …"; no network → "Couldn't reach …"; `posdemo` → only the one read-only health GET (the demo rule: no login).
- The updater: within about a minute B downloads → one notification (screenshot) → the tray shows **Restart to update** → click → it installs and reopens as 2.0.1 (version in the window footer), the saved address and printers kept. Then a 2.0.2-test build: **Quit** from the tray → the next start is 2.0.2.
- Uninstall silently, remove the test folder and the test's user data, `adb`-free. Record every step in the Results.

---

# Session N4: release folder, docs, the 2.0.0 set and the final review (spec; made exact at the N3 gate)

### Task 41: `scripts/release-native.mjs`

- Run: `node scripts/release-native.mjs --arm64 <apk> --armv7 <apk> --windows apps/desktop/dist --notes "<text>" [--released YYYY-MM-DD]`. It builds nothing.
- Checks, refusing with a clear line on the first failure: each APK's signer SHA-256 (`apksigner verify --print-certs`) equals `EXPECTED_CERT_SHA256` (N1's fingerprint, a constant in the script); `aapt2 dump badging`: package `com.possoftware.pos`, versionName = `apps/desktop/package.json` version, versionCode = its code, not debuggable, the right native-code ABI per file; `aapt2 dump resources`: `pos_update_base` = `https://files.sandbee.in/pos`, check 720, reopen 30; Windows: `dist/latest.yml` version = the version, its file = `POS-Software-Setup-<version>.exe`, its sha512 = the installer's, the blockmap present, `dist/win-unpacked/resources/app-update.yml` url = `https://files.sandbee.in/pos/windows`; notes ≤ 300 characters; the release folder does not exist yet.
- Writes `D:\kd\pos-apk-release\Sandbee-POS-<version>\upload\pos\android\{latest.json, Sandbee-POS-<version>-arm64-v8a.apk, Sandbee-POS-<version>-armeabi-v7a.apk}` and `upload\pos\windows\{latest.yml, POS-Software-Setup-<version>.exe, POS-Software-Setup-<version>.exe.blockmap}`, `SHA256SUMS.txt` (every file) and `UPLOAD-STEPS.txt` (the S3 keys, the order: APKs + installer + blockmap first, `latest.json` + `latest.yml` last; `Cache-Control: max-age=60` for `latest.*`, `max-age=31536000, immutable` for versioned files; how to check from a phone).
- `scripts/release-native.test.mjs` (root script `test:release-native`): the pure parts — the manifest writer checked by the same rules as `UpdateManifest` (a JS validator with the JUnit cases' table), the version code, the file names, the `latest.yml` reader, the steps text, refusal of an existing folder.
- (The N1 review gate.) apksigner from build-tools 37 prints `V2 Signer: certificate SHA-256 digest: <hex>` (a v2-only APK,
  minSdk 24), not `Signer #1 …`; `EXPECTED_CERT_SHA256` = `5bd06ef3e9a78efcb0dfbd1ff102de932c581a78034d93ef7572f5373b5b3e40`.

### Task 42: Docs

- `docs/GO-LIVE-CHECKLIST.md`: a new section "Existing cafes: the native apps 2.0 release" (each printing phone or tablet once: uninstall, install 2.0.0, open, type the cafe's name, sign in, set this device's printer, Admin → Printer setup → choose this device again; Windows installs over 1.x; what staff see from then on: the card at an app open, Install or Later; Windows installs at closing or on "Restart to update"; nothing ever blocks work; a device whose screen never turns off and whose app never leaves the screen has no app open, so it updates after its next restart, or when it is away from the app for 30 minutes); §7's install lines point at `files.sandbee.in` once the owner has set it up; §A pinned facts. Pins in `go-live-runbook.test.ts`.
- (The N1 review gate.) The section also says: the first update on each phone asks once to allow installs from Sandbee
  POS ("Install unknown apps"); Google Play Protect may show "App scan recommended" at the first install and at an
  update (Sandbee POS is not from the Play Store): **More details → Install without scanning** installs at once, and
  **Scan app** also works on the cafe's own phone (it sends the app to Google and takes a while); on Samsung (One UI 6+)
  Auto Blocker must be off before "Install unknown apps" can be allowed; after **Update** there is no Open button (the
  app updated itself): open it from its icon, or tap "POS printing is off. Tap to start." on a printing device.
- `apps/mobile/README.md` and `apps/desktop/README.md`: building a release and running the packaging; the upload order. `apps/cafe/DEPLOY.md`: the line about the native apps.

### Task 43: Full verification

- Every suite equal to the expected counts (mobile, desktop, JUnit, Jest, `test:release-native`, the cafe chain with the go-live runbook test, the cafe typecheck), lint and typecheck clean.

### Task 44: The 2.0.0 release set

- Build the APK pair (private key, real base; `:app:compileReleaseKotlin --rerun` first) and the Windows installer (`npm run dist`); run the packaging into `D:\kd\pos-apk-release\Sandbee-POS-2.0.0\`; an x86_64 build of the same commit installed on the emulator for a smoke test (open, sign in, print); the emulator holds the debug-key 1.0 again after N2, so this rehearses the one-time move.
- Nothing is uploaded. The owner gets the folder path, `UPLOAD-STEPS.txt`, and (later, with the owner) the S3 + domain steps.

### Task 45: The final review

- A fresh review of the whole branch (spec, plan, diff, Results) on Claude Fable 5.1 (on a 429 limit: wait for the reset, never switch silently). Fixes by TDD; Results; the owner's merge OK.

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
