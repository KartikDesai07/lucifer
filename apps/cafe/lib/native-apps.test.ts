import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";
import {
  ANDROID_MANIFEST_URL,
  NATIVE_APPS_BASE,
  NATIVE_APPS_REVALIDATE_S,
  WINDOWS_FEED_URL,
  androidRelease,
  readNativeApps,
  windowsRelease,
} from "./native-apps";

// Native apps 2.0, the owner's ask of 2026-10-15: Admin → Printer setup offers the latest Android and Windows app
// from files.sandbee.in, so a cafe downloads a first install (or a newer version by hand) from the POS itself. The
// links are always <base>/<platform>/<plain file name> (as the apps' own updaters do), the two small manifests are read
// on the server and cached, and nothing here ever throws.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..");
const REPO = path.join(APP, "..", "..");
const read = (rel: string) => stripComments(readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n"));

// What scripts/release-native.mjs wrote for 2.0.0 (files.sandbee.in/pos/android/latest.json).
const MANIFEST = {
  schema: 1,
  package: "com.possoftware.pos",
  version: "2.0.0",
  versionCode: 20000,
  released: "2026-10-13",
  notes: "Sandbee POS now updates itself. You will see a card like this when a new version is ready.",
  apks: {
    "arm64-v8a": { file: "Sandbee-POS-2.0.0-arm64-v8a.apk", sha256: "0dc49fc68569c5bd265f94b9878f2080ac901cbffec4e42e0fd95fac8d5284e1", size: 7362354 },
    "armeabi-v7a": { file: "Sandbee-POS-2.0.0-armeabi-v7a.apk", sha256: "86c88741785b5b7db6bca5436308203ad02fd79e0dcdd7931654784ad209923e", size: 6770188 },
  },
};
type Apk = { file: unknown; sha256: string; size: number };
type EditableManifest = Record<string, unknown> & { apks: Record<string, Apk> };
const manifest = (edit: (m: EditableManifest) => void = () => undefined): Record<string, unknown> => {
  const m = structuredClone(MANIFEST) as unknown as EditableManifest;
  edit(m);
  return m;
};

// electron-builder 26's latest.yml for 2.0.0 (files.sandbee.in/pos/windows/latest.yml).
const LATEST_YML = [
  "version: 2.0.0",
  "files:",
  "  - url: POS-Software-Setup-2.0.0.exe",
  "    sha512: VachJpmXlqNfblIyqzHJihVrD2MH5C1kqkCRgZ0fzgsxm2TWCjUcAbHCLNSYBW2GS48QliW715CZT+m09WZfWw==",
  "    size: 112542431",
  "path: POS-Software-Setup-2.0.0.exe",
  "sha512: VachJpmXlqNfblIyqzHJihVrD2MH5C1kqkCRgZ0fzgsxm2TWCjUcAbHCLNSYBW2GS48QliW715CZT+m09WZfWw==",
  "releaseDate: '2026-10-13T13:40:22.992Z'",
  "",
].join("\n");

test("the Android release: the version and both APK links under the base, from the manifest the release wrote", () => {
  assert.deepEqual(
    androidRelease(manifest()),
    {
      version: "2.0.0",
      arm64Url: "https://files.sandbee.in/pos/android/Sandbee-POS-2.0.0-arm64-v8a.apk",
      armv7Url: "https://files.sandbee.in/pos/android/Sandbee-POS-2.0.0-armeabi-v7a.apk",
    },
    "the 2.0.0 manifest",
  );
  assert.deepEqual(
    androidRelease(manifest((m) => delete m.apks["armeabi-v7a"])),
    { version: "2.0.0", arm64Url: "https://files.sandbee.in/pos/android/Sandbee-POS-2.0.0-arm64-v8a.apk", armv7Url: null },
    "no 32-bit APK: only the 64-bit link",
  );
});

test("an Android manifest that is not the POS app's release offers no link: never a path, an address or another app", () => {
  const cases: [string, unknown][] = [
    ["not an object", [1, 2]],
    ["null", null],
    ["another app", manifest((m) => (m.package = "com.example.other"))],
    ["a prerelease", manifest((m) => (m.version = "2.0.1-rc.1"))],
    ["no version", manifest((m) => delete m.version)],
    ["no apks", manifest((m) => delete (m as Record<string, unknown>).apks)],
    ["no 64-bit APK", manifest((m) => delete m.apks["arm64-v8a"])],
  ];
  for (const file of ["../Sandbee.apk", "a/b.apk", "a\\b.apk", "https://evil.example/x.apk", "x.exe", ".apk", "x..apk", "", 5]) {
    cases.push([`64-bit file ${JSON.stringify(file)}`, manifest((m) => (m.apks["arm64-v8a"].file = file))]);
  }
  for (const [label, value] of cases) {
    assert.equal(androidRelease(value), null, label);
  }
  assert.equal(
    androidRelease(manifest((m) => (m.apks["armeabi-v7a"].file = "../x.apk")))?.armv7Url,
    null,
    "a bad 32-bit file name drops only that link",
  );
});

test("the Windows release: the version and the installer link under the base, from electron-builder's latest.yml", () => {
  const want = { version: "2.0.0", installerUrl: "https://files.sandbee.in/pos/windows/POS-Software-Setup-2.0.0.exe" };
  assert.deepEqual(windowsRelease(LATEST_YML), want, "latest.yml");
  assert.deepEqual(windowsRelease(LATEST_YML.replace(/\n/g, "\r\n")), want, "CRLF lines too");
  const cases: [string, string][] = [
    ["empty", ""],
    ["a prerelease", LATEST_YML.replace("version: 2.0.0", "version: 2.0.1-rc.1")],
    ["no path", LATEST_YML.replace("path: POS-Software-Setup-2.0.0.exe\n", "")],
    ["a path in a folder", LATEST_YML.replace("path: POS-Software-Setup-2.0.0.exe", "path: x/POS-Software-Setup-2.0.0.exe")],
    ["an address", LATEST_YML.replace("path: POS-Software-Setup-2.0.0.exe", "path: https://evil.example/x.exe")],
    ["not an installer", LATEST_YML.replace("path: POS-Software-Setup-2.0.0.exe", "path: POS-Software-Setup-2.0.0.zip")],
  ];
  for (const [label, text] of cases) {
    assert.equal(windowsRelease(text), null, label);
  }
});

function fakeFetch(answers: Record<string, () => Response | Promise<Response>>) {
  const calls: { url: string; init: RequestInit & { next?: { revalidate?: number } } }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: (init ?? {}) as RequestInit & { next?: { revalidate?: number } } });
    const answer = answers[url];
    if (answer === undefined) throw new Error(`unexpected fetch ${url}`);
    return answer();
  }) as typeof fetch;
  return { impl, calls };
}

test("both manifests are read once each, cached on the server for 10 minutes, with a time limit", async () => {
  const { impl, calls } = fakeFetch({
    [ANDROID_MANIFEST_URL]: () => new Response(JSON.stringify(MANIFEST), { status: 200 }),
    [WINDOWS_FEED_URL]: () => new Response(LATEST_YML, { status: 200 }),
  });
  const apps = await readNativeApps(impl);
  assert.equal(apps.android?.version, "2.0.0", "the Android app");
  assert.equal(apps.windows?.installerUrl, "https://files.sandbee.in/pos/windows/POS-Software-Setup-2.0.0.exe", "the Windows app");
  assert.deepEqual(calls.map((c) => c.url).sort(), [ANDROID_MANIFEST_URL, WINDOWS_FEED_URL].sort(), "one request each");
  for (const call of calls) {
    assert.equal(call.init.next?.revalidate, NATIVE_APPS_REVALIDATE_S, `${call.url}: cached`);
    assert.ok(call.init.signal instanceof AbortSignal, `${call.url}: a time limit`);
  }
  assert.equal(NATIVE_APPS_REVALIDATE_S, 600, "10 minutes");
});

test("a missing, broken or unreachable manifest is no release for that app, and the page never fails", async () => {
  const { impl } = fakeFetch({
    [ANDROID_MANIFEST_URL]: () => new Response("<Error>AccessDenied</Error>", { status: 403 }),
    [WINDOWS_FEED_URL]: () => new Response(LATEST_YML, { status: 200 }),
  });
  const apps = await readNativeApps(impl);
  assert.equal(apps.android, null, "403: no Android release");
  assert.equal(apps.windows?.version, "2.0.0", "the Windows app still shows");

  const broken = fakeFetch({
    [ANDROID_MANIFEST_URL]: () => new Response("{not json", { status: 200 }),
    [WINDOWS_FEED_URL]: () => Promise.reject(new Error("getaddrinfo ENOTFOUND files.sandbee.in")),
  });
  assert.deepEqual(await readNativeApps(broken.impl), { android: null, windows: null }, "bad JSON and no answer");
});

test("PIN (native apps 2.0): the base is the apps' own, and Printer setup shows the apps under the setup, streamed, with links that open outside the POS", () => {
  assert.equal(NATIVE_APPS_BASE, "https://files.sandbee.in/pos", "the base");
  assert.equal(ANDROID_MANIFEST_URL, `${NATIVE_APPS_BASE}/android/latest.json`, "the Android manifest");
  assert.equal(WINDOWS_FEED_URL, `${NATIVE_APPS_BASE}/windows/latest.yml`, "the Windows feed");
  const gradle = readFileSync(path.join(REPO, "apps/mobile/android/app/build.gradle"), "utf8");
  assert.ok(gradle.includes(`def posUpdateBaseDefault = "${NATIVE_APPS_BASE}"`), "the POS app's update base");
  const desktop = JSON.parse(readFileSync(path.join(REPO, "apps/desktop/package.json"), "utf8")) as { build: { publish: { url: string } } };
  assert.equal(desktop.build.publish.url, `${NATIVE_APPS_BASE}/windows`, "the Windows app's feed");

  const page = read("apps/cafe/app/(dashboard)/printers/page.tsx");
  const setup = page.indexOf("<PrintSetupSections />");
  const suspense = page.indexOf("<Suspense", setup);
  const section = page.indexOf("<NativeAppsSection />", suspense);
  assert.ok(setup >= 0 && suspense > setup && section > suspense, "the apps section comes after the setup, inside Suspense");

  const ui = read("apps/cafe/components/print/setup/NativeAppsSection.tsx");
  assert.ok(ui.includes("await readNativeApps()"), "the section reads the manifests on the server");
  const links = ui.match(/<a\b[^>]*>/g) ?? [];
  assert.ok(links.length >= 3, "the Android, 32-bit Android and Windows links");
  for (const link of links) {
    assert.ok(link.includes('target="_blank"') && link.includes('rel="noopener noreferrer"'), `opens outside the POS: ${link}`);
  }
});
