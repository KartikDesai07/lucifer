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
