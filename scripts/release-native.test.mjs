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
  assert.ok(at("Properties → Metadata") < first, "how to set the headers in the S3 console (native apps 2.0.1)");
  assert.ok(at("upload each group on its own") < first, "... one upload per group of headers: the console applies one metadata set to a whole upload");
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
