// Raw-source pins (readFileSync, never import) for the electron-touching
// modules -- these files import "electron" and cannot load under
// `node --import tsx --test`, so every assertion here reads the compiled-
// looking .ts source text directly. Negative pins (something must be ABSENT)
// are paired with a positive landmark per testing.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  APP_ID,
  BRIDGE_KEY,
  PRINT_CHANNEL,
  URL_CURRENT_CHANNEL,
  URL_SAVE_CHANNEL,
  URL_CANCEL_CHANNEL,
  SETUP_BRIDGE_KEY,
  VERSION_ARG_PREFIX,
  POS_PARTITION,
  PRINT_PARTITION,
  PRODUCT_NAME,
  VENDOR_NAME,
  OPEN_EXTERNAL_MIN_INTERVAL_MS,
  PRINT_JOB_TIMEOUT_MS,
  DATA_URL_MAX_CHARS,
  PRINT_HTML_MAX_CHARS,
  FONTS_READY_MAX_MS,
  PAINT_READY_MAX_MS,
} from "./shared";

const SRC = path.join(__dirname); // apps/desktop/src
const ROOT = path.join(__dirname, ".."); // apps/desktop

function read(relFromDesktopRoot: string): string {
  return readFileSync(path.join(ROOT, relFromDesktopRoot), "utf8");
}

const shellWindowSrc = read("src/shell-window.ts");
const mainSrc = read("src/main.ts");
const printSrc = read("src/print.ts");
const preloadSrc = read("src/preload.ts");
const urlPreloadSrc = read("src/url-preload.ts");
const urlWindowHtml = read("assets/url-window.html");
const urlWindowJs = read("assets/url-window.js");
const urlWindowSrc = read("src/url-window.ts");
const installerNsh = read("resources/installer.nsh");
const eslintConfigSrc = read("eslint.config.mjs");
const pkgRaw = read("package.json");
const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;

// -- (1) shell-window.ts webPreferences posture ------------------------------
test("(1) shell-window.ts: exact BrowserWindow security posture", () => {
  assert.match(shellWindowSrc, /partition:\s*POS_PARTITION/);
  assert.match(shellWindowSrc, /contextIsolation:\s*true/);
  assert.match(shellWindowSrc, /sandbox:\s*true/);
  assert.match(shellWindowSrc, /nodeIntegration:\s*false/);
  assert.match(shellWindowSrc, /webSecurity:\s*true/);
  assert.match(shellWindowSrc, /backgroundThrottling:\s*false/);
  assert.match(shellWindowSrc, /devTools:\s*!app\.isPackaged/);
  assert.match(shellWindowSrc, /preload:\s*path\.join\(__dirname,\s*"preload\.js"\)/);
  assert.match(shellWindowSrc, /additionalArguments:/);
});

test("(1) vision-guard: no insecure webPreferences override anywhere in shell-window.ts", () => {
  assert.ok(!shellWindowSrc.includes("nodeIntegration: true"));
  assert.ok(!shellWindowSrc.includes("webSecurity: false"));
  assert.ok(!shellWindowSrc.includes("allowRunningInsecureContent"));
  // Landmark: the file really was scanned (a stripped/empty read would make
  // the negatives above vacuous).
  assert.ok(shellWindowSrc.includes("export function createMainWindow("));
});

// -- (2) navigation guards ----------------------------------------------------
test("(2) shell-window.ts: will-navigate + setWindowOpenHandler + hide/isQuitting wiring", () => {
  assert.match(shellWindowSrc, /will-navigate/);
  assert.match(shellWindowSrc, /event\.preventDefault\(\)/);
  assert.match(shellWindowSrc, /setWindowOpenHandler/);
  assert.match(shellWindowSrc, /action:\s*"deny"/);
  assert.match(shellWindowSrc, /shell\.openExternal/);
  assert.match(shellWindowSrc, /isExternalHttpUrl/);
  assert.match(shellWindowSrc, /win\.hide\(\)/);
  assert.match(shellWindowSrc, /isQuitting\(\)/);
});

// -- (3) main.ts lifecycle wiring --------------------------------------------
test("(3) main.ts: single-instance lock, app lifecycle events, setAppUserModelId", () => {
  assert.match(mainSrc, /requestSingleInstanceLock\(\)/);
  assert.match(mainSrc, /"second-instance"/);
  assert.match(mainSrc, /"window-all-closed"/);
  assert.match(mainSrc, /"before-quit"/);
  assert.match(mainSrc, /setAppUserModelId\(APP_ID\)/);
});

test("(3) main.ts: setLoginItemSettings called exactly twice, both with args: [HIDDEN_FLAG]", () => {
  const calls = mainSrc.match(/setLoginItemSettings\(/g) ?? [];
  assert.equal(calls.length, 2, "expected exactly two setLoginItemSettings call sites");
  const argsMatches = mainSrc.match(/args:\s*\[HIDDEN_FLAG\]/g) ?? [];
  assert.equal(argsMatches.length, 2, "both setLoginItemSettings calls must pass args: [HIDDEN_FLAG]");
});

test("(3) main.ts: auto-start is armed inside did-finish-load and gates on app.isPackaged, the never-decided sentinel, AND a load that reached the saved origin", () => {
  const start = mainSrc.indexOf('webContents.on("did-finish-load"');
  assert.ok(start >= 0, "main.ts must arm auto-start on did-finish-load");
  const end = mainSrc.indexOf("persist({ autoStart: true })", start);
  assert.ok(end > start, "the did-finish-load handler must persist autoStart: true");
  const handler = mainSrc.slice(start, end);
  assert.match(handler, /app\.isPackaged/, "must gate on app.isPackaged (npm start must never register the dev binary)");
  assert.match(handler, /store\.autoStart\s*!==\s*null/, "must gate on the never-decided sentinel (an operator OFF stays OFF)");
  assert.match(handler, /isSameOrigin\(webContents\.getURL\(\)/, "must check the loaded URL reached the saved origin (Chromium error pages also finish loading)");
});

// -- (4) print.ts request validation + job posture ---------------------------
test("(4) print.ts: request validation order (sender id, origin, frame, payload)", () => {
  assert.match(printSrc, /event\.sender\.id\s*!==\s*deps\.getMainWebContentsId\(\)/);
  assert.match(printSrc, /event\.senderFrame/);
  assert.match(printSrc, /isSameOrigin/);
  assert.match(printSrc, /typeof html\s*!==\s*"string"/);
  assert.match(printSrc, /PRINT_HTML_MAX_CHARS/);
});

test("(4) print.ts: offscreen job posture (partition, data URL, print options, timeout, cleanup)", () => {
  assert.match(printSrc, /session\.fromPartition\(PRINT_PARTITION\)/);
  assert.match(printSrc, /baseURLForDataURL/);
  assert.match(printSrc, /encodeURIComponent/);
  assert.match(printSrc, /silent:\s*true/);
  assert.match(printSrc, /printBackground:\s*true/);
  assert.match(printSrc, /PRINT_JOB_TIMEOUT_MS/);
  assert.match(printSrc, /FONTS_READY_MAX_MS/);
  assert.match(printSrc, /finally/);
  assert.match(printSrc, /\.destroy\(\)/);
});

test("(4) vision-guard: print.ts never uses a persist: partition and never logs the HTML", () => {
  assert.ok(!printSrc.includes('"persist:'));
  assert.ok(!printSrc.includes("`persist:"));
  // The log calls must carry html.length, never the html variable itself.
  const logCalls = printSrc.match(/log\.(info|error)\(`[^`]*`\)/g) ?? [];
  assert.ok(logCalls.length >= 2, "expected at least two log.info/log.error call sites");
  for (const call of logCalls) {
    assert.match(call, /html\.length/, `log call must reference html.length, not html: ${call}`);
    assert.ok(!/\$\{html\}/.test(call), `log call must never interpolate the raw html: ${call}`);
  }
  // Landmark: the file was really scanned.
  assert.ok(printSrc.includes("export function registerPrintHandler("));
});

// -- (5) partition constants -------------------------------------------------
test("(5) PRINT_PARTITION is exactly 'print' and POS_PARTITION starts with 'persist:'", () => {
  assert.equal(PRINT_PARTITION, "print");
  assert.equal(POS_PARTITION.startsWith("persist:"), true);
});

// -- (6) preload.ts exposes exactly {version, printHtml} ---------------------
function extractExposedKeys(source: string, bridgeKeyLiteral: string): string[] {
  const callIndex = source.indexOf(`exposeInMainWorld(${bridgeKeyLiteral}`);
  assert.ok(callIndex >= 0, `expected an exposeInMainWorld(${bridgeKeyLiteral} call site`);
  const braceStart = source.indexOf("{", callIndex);
  assert.ok(braceStart >= 0, "expected an object literal after exposeInMainWorld(");
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end > braceStart, "unbalanced braces while scanning the exposeInMainWorld object literal");
  const objectLiteralText = source.slice(braceStart + 1, end);
  // Top-level keys only: split on commas that are at brace/paren depth 0.
  const keys: string[] = [];
  let currentDepth = 0;
  let tokenStart = 0;
  const pushToken = (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;
    // Either `key: value` or a shorthand property `key` (e.g. `{ version, printHtml: ... }`).
    const keyed = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/);
    if (keyed && keyed[1] !== undefined) {
      keys.push(keyed[1]);
      return;
    }
    const shorthand = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (shorthand && shorthand[1] !== undefined) keys.push(shorthand[1]);
  };
  for (let i = 0; i < objectLiteralText.length; i++) {
    const ch = objectLiteralText[i];
    if (ch === "{" || ch === "(" || ch === "[") currentDepth++;
    else if (ch === "}" || ch === ")" || ch === "]") currentDepth--;
    else if (ch === "," && currentDepth === 0) {
      pushToken(objectLiteralText.slice(tokenStart, i));
      tokenStart = i + 1;
    }
  }
  pushToken(objectLiteralText.slice(tokenStart));
  return keys;
}

test("(6) preload.ts exposes exactly ['version', 'printHtml'] on posDesktop", () => {
  const keys = extractExposedKeys(preloadSrc, '"posDesktop"');
  assert.deepEqual(keys.sort(), ["printHtml", "version"]);
});

test("(6) preload.ts: exactly one require('electron'), no other require, no ipcRenderer exposure, no posDesktopSetup", () => {
  const requireCalls = preloadSrc.match(/require\(("|')[^"')]*\1\)/g) ?? [];
  assert.equal(requireCalls.length, 1, `expected exactly one require(...) call, found: ${JSON.stringify(requireCalls)}`);
  assert.match(requireCalls[0]!, /require\(("|')electron\1\)/);
  assert.ok(!preloadSrc.includes("exposeInMainWorld(\"ipcRenderer\""));
  assert.ok(!/\bipcRenderer\s*:/.test(preloadSrc), "ipcRenderer must never be exposed as an object property");
  assert.ok(!preloadSrc.includes("posDesktopSetup"));
  // Landmark: the file really has the bridge call (vision-guard for the
  // "exactly one require" / "no posDesktopSetup" negatives above).
  assert.ok(preloadSrc.includes("contextBridge.exposeInMainWorld"));
});

// -- (7)+(8) channel-literal parity: preload duplicated literals vs shared.ts -
test("(7) preload.ts duplicated literals equal shared.ts (PRINT_CHANNEL, BRIDGE_KEY, VERSION_ARG_PREFIX)", () => {
  assert.ok(preloadSrc.includes(JSON.stringify(PRINT_CHANNEL)));
  assert.ok(preloadSrc.includes(JSON.stringify(BRIDGE_KEY)));
  assert.ok(preloadSrc.includes(JSON.stringify(VERSION_ARG_PREFIX)));
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

// -- (9) url-window.html / url-window.js: no external resource loads ---------
test("(9) url-window.html: CSP meta with default-src 'none' and script-src 'self'", () => {
  assert.match(urlWindowHtml, /Content-Security-Policy/);
  assert.match(urlWindowHtml, /default-src 'none'/);
  assert.match(urlWindowHtml, /script-src 'self'/);
});

test("(9) url-window.html: exactly one <script> tag, and it points at url-window.js", () => {
  const scriptTags = urlWindowHtml.match(/<script\b[^>]*>/g) ?? [];
  assert.equal(scriptTags.length, 1, `expected exactly one <script tag, found: ${JSON.stringify(scriptTags)}`);
  assert.match(scriptTags[0]!, /src="url-window\.js"/);
});

test("(9) vision-guard: no external resource references in url-window.html or url-window.js", () => {
  for (const [name, source] of [
    ["url-window.html", urlWindowHtml],
    ["url-window.js", urlWindowJs],
  ] as const) {
    assert.ok(!source.includes("<link"), `${name} must not include a <link tag`);
    assert.ok(!source.includes('src="http'), `${name} must not reference an http(s) src`);
    assert.ok(!source.includes('href="http'), `${name} must not reference an http(s) href`);
    assert.ok(!source.includes("@import"), `${name} must not use @import`);
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

// -- (10) package.json build config ------------------------------------------
type PackageJsonShape = {
  main: string;
  version: string;
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  build: {
    appId: string;
    productName: string;
    directories: { buildResources: string; output: string };
    files: string[];
    asar: boolean;
    win: { icon: string };
    nsis: {
      oneClick: boolean;
      perMachine: boolean;
      allowToChangeInstallationDirectory: boolean;
      artifactName?: string;
    };
    publish?: unknown;
  };
};
const typedPkg = pkg as unknown as PackageJsonShape;

test("(10) package.json: electron is an exact version pin (no range operators)", () => {
  const electronVersion = typedPkg.devDependencies.electron;
  assert.equal(typeof electronVersion, "string");
  assert.match(electronVersion as string, /^\d+\.\d+\.\d+$/);
});

test("(10) package.json: electron-builder is >= 26.8.0", () => {
  const raw = typedPkg.devDependencies["electron-builder"];
  assert.equal(typeof raw, "string");
  const version = (raw as string).replace(/^[\^~]/, "");
  const [major, minor, patch] = version.split(".").map(Number);
  const meetsMin =
    major! > 26 || (major === 26 && (minor! > 8 || (minor === 8 && patch! >= 0)));
  assert.ok(meetsMin, `electron-builder ${raw} must be >= 26.8.0`);
});

test("(10) package.json build block: appId/productName/buildResources/icon", () => {
  assert.equal(typedPkg.build.appId, APP_ID);
  assert.equal(typedPkg.build.productName, PRODUCT_NAME);
  assert.equal(typedPkg.build.productName, PRODUCT_NAME);
  assert.equal(typedPkg.build.directories.buildResources, "resources");
  assert.equal(typedPkg.build.win.icon, "resources/icon.png");
});

test("(10) package.json build block: nsis installer flags", () => {
  assert.equal(typedPkg.build.nsis.oneClick, false);
  assert.equal(typedPkg.build.nsis.perMachine, false);
  assert.equal(typedPkg.build.nsis.allowToChangeInstallationDirectory, true);
});

test("(10) package.json build block: asar true, files deep-equal the three globs", () => {
  assert.equal(typedPkg.build.asar, true);
  assert.deepEqual(typedPkg.build.files, ["out/**/*", "assets/**/*", "package.json"]);
});

test("(10) package.json: main entry is out/main.js", () => {
  assert.equal(typedPkg.main, "out/main.js");
});

test("(10) package.json build block: no publish key, no sign/cert key anywhere under build", () => {
  assert.equal(Object.prototype.hasOwnProperty.call(typedPkg.build, "publish"), false);

  function scanForSignOrCert(value: unknown, keyPath: string): void {
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assert.ok(
        !/sign|cert/i.test(key),
        `build.${keyPath}${keyPath ? "." : ""}${key} looks like a signing/cert key -- must not exist`,
      );
      scanForSignOrCert(child, `${keyPath}${keyPath ? "." : ""}${key}`);
    }
  }
  scanForSignOrCert(typedPkg.build, "");
});

test("(10) package.json: dist script includes --publish never, build script names tsconfig.build.json", () => {
  assert.match(typedPkg.scripts.dist!, /--publish never/);
  assert.match(typedPkg.scripts.build!, /tsconfig\.build\.json/);
});

// -- (11) no console.* in src/*.ts non-test files ----------------------------
test("(11) no console.* usage in any non-test src/*.ts file", () => {
  // A CALL shape (console.<method>() ), not a bare substring -- log.ts's own
  // header comment legitimately says "No console.* anywhere else" in prose,
  // which contains the substring "console." without being a real call.
  const consoleCallPattern = new RegExp("console" + "\\.[a-zA-Z]+\\s*\\(");
  const fsPathsToScan = [
    "shared.ts",
    "log.ts",
    "server-url.ts",
    "store.ts",
    "window-state.ts",
    "permissions.ts",
    "print.ts",
    "shell-window.ts",
    "preload.ts",
    "url-preload.ts",
    "url-window.ts",
    "menu.ts",
    "main.ts",
  ];
  for (const file of fsPathsToScan) {
    const source = readFileSync(path.join(SRC, file), "utf8");
    assert.ok(!consoleCallPattern.test(source), `${file} must never call console.*`);
  }
  // Landmark: log.ts really is the sink (vision-guard) -- and it legitimately
  // mentions "console." in prose, proving the call-shape pattern above (not
  // a bare substring) is what makes this pin non-vacuous.
  const logSrc = readFileSync(path.join(SRC, "log.ts"), "utf8");
  assert.ok(logSrc.includes("export function createLogger("));
  assert.ok(logSrc.includes("console."), "landmark: log.ts's header comment mentions console. in prose");
});

// -- (12) no cafe name anywhere under apps/desktop ---------------------------
test("(12) no tenant/cafe name anywhere under apps/desktop source/config", () => {
  // Built by concatenation on purpose -- a literal needle here would itself
  // trip a banned-string scan of this very file.
  const bannedNeedle = "Luci" + "fer";
  const filesToScan = [
    ["src/shared.ts", read("src/shared.ts")],
    ["src/log.ts", read("src/log.ts")],
    ["src/server-url.ts", read("src/server-url.ts")],
    ["src/store.ts", read("src/store.ts")],
    ["src/window-state.ts", read("src/window-state.ts")],
    ["src/permissions.ts", read("src/permissions.ts")],
    ["src/print.ts", read("src/print.ts")],
    ["src/shell-window.ts", read("src/shell-window.ts")],
    ["src/preload.ts", read("src/preload.ts")],
    ["src/url-preload.ts", read("src/url-preload.ts")],
    ["src/url-window.ts", read("src/url-window.ts")],
    ["src/menu.ts", read("src/menu.ts")],
    ["src/main.ts", read("src/main.ts")],
    ["assets/url-window.html", urlWindowHtml],
    ["assets/url-window.js", urlWindowJs],
    ["package.json", pkgRaw],
    ["eslint.config.mjs", eslintConfigSrc],
  ] as const;
  for (const [name, source] of filesToScan) {
    assert.ok(!source.includes(bannedNeedle), `${name} must never name the tenant cafe`);
  }
  // Landmark: the generic product voice is actually present, proving these
  // files were really read (not blinded/empty).
  // Vendor branding (owner decision 2026-09-07): "sandbee" is the software
  // vendor, never a cafe — the banned-name scan above is about cafes.
  assert.equal(PRODUCT_NAME, "POS Software by sandbee");
  assert.ok(pkgRaw.includes(PRODUCT_NAME));
});

// -- (13) parity: cafe/lib/desktop-shell.ts ----------------------------------
test("(13) parity: apps/cafe/lib/desktop-shell.ts carries the expected bridge surface", () => {
  const cafeDesktopShellSrc = readFileSync(
    path.join(ROOT, "..", "cafe", "lib", "desktop-shell.ts"),
    "utf8",
  );
  assert.ok(cafeDesktopShellSrc.includes("window.posDesktop"));
  assert.ok(cafeDesktopShellSrc.includes("printHtml"));
  assert.ok(cafeDesktopShellSrc.includes("export function isDesktopShell("));
});

test("(13) vision-guard: cafe/lib/desktop-shell.ts stays capability-keyed (no UA sniffing)", () => {
  const cafeDesktopShellSrc = readFileSync(
    path.join(ROOT, "..", "cafe", "lib", "desktop-shell.ts"),
    "utf8",
  );
  // RAW bytes, comments included (testing.md: a banned literal must not be
  // quoted anywhere in a scanned file, prose included) -- this mirrors the
  // cafe side's own pin in lib/desktop-shell-paths.test.ts so both workspaces
  // agree on the contract. Needles are built by concatenation so this file
  // never carries them whole either.
  const uaNeedle = "navigator." + "userAgent";
  const runtimeNeedle = "Elec" + "tron";
  assert.ok(!cafeDesktopShellSrc.includes(uaNeedle), "the cafe seam must never read the user-agent string");
  assert.ok(!cafeDesktopShellSrc.includes(runtimeNeedle), "the cafe seam must never name the shell runtime");
  // Landmarks: the file was really read with content, and it keys on the
  // bridge's presence (vision-guard for the negatives above).
  assert.ok(cafeDesktopShellSrc.includes("export function slipPrintOptions<"));
  assert.ok(cafeDesktopShellSrc.includes("export function isDesktopShell("));
  assert.ok(cafeDesktopShellSrc.includes("window.posDesktop"));
  assert.ok(cafeDesktopShellSrc.includes('typeof bridge.printHtml !== "function"'));
});

// -- (14) eslint config bans console + any, lints assets/**/*.js -------------
test("(14) eslint.config.mjs: no-console and no-explicit-any are errors, assets/**/*.js is linted", () => {
  assert.match(eslintConfigSrc, /"no-console":\s*"error"/);
  assert.match(eslintConfigSrc, /"@typescript-eslint\/no-explicit-any":\s*"error"/);
  assert.match(eslintConfigSrc, /files:\s*\["assets\/\*\*\/\*\.js"\]/);
  // Vision-guard: assets/**/*.js must not be in the global ignore list.
  const ignoreBlockMatch = eslintConfigSrc.match(/ignores:\s*\[([^\]]*)\]/);
  assert.ok(ignoreBlockMatch, "expected a top-level ignores: [...] block");
  assert.ok(!ignoreBlockMatch![1]!.includes("assets"));
});

// -- icon assets: real PNG dimensions read from the header bytes ------------
function readPngIhdr(file: string): { isPng: boolean; width: number; height: number } {
  const buf = readFileSync(file);
  const isPng = buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { isPng, width, height };
}

test("resources/icon.png is a PNG with width >= 256 (IHDR)", () => {
  const { isPng, width, height } = readPngIhdr(path.join(ROOT, "resources", "icon.png"));
  assert.equal(isPng, true);
  assert.ok(width >= 256, `icon width ${width} must be >= 256`);
  assert.equal(width, height, "icon must be square");
});

test("assets/tray.png is exactly 32x32 (IHDR)", () => {
  const { isPng, width, height } = readPngIhdr(path.join(ROOT, "assets", "tray.png"));
  assert.equal(isPng, true);
  assert.equal(width, 32);
  assert.equal(height, 32);
});

// -- Review fix round (2026-09-08): pins for the arbitrated findings ----------

test("(R1) print.ts: ONE deadline for the whole job (load + fonts + print), both permission handlers denied, sanitized failure reasons, failure hook", () => {
  assert.match(printSrc, /Promise\.race\(\[\s*loadAndPrint\(/, "the job body must be raced as a whole (C1)");
  assert.match(printSrc, /reject\(new Error\(PRINT_TIMEOUT_MESSAGE\)\), PRINT_JOB_TIMEOUT_MS\)/, "the deadline must be PRINT_JOB_TIMEOUT_MS");
  assert.equal(PRINT_JOB_TIMEOUT_MS, 30_000, "the shell job deadline stays 30 s; the cafe seam waits 35 s so the shell's own message wins");
  assert.ok(printSrc.includes("setPermissionRequestHandler("), "print window must deny permission requests");
  assert.ok(printSrc.includes("setPermissionCheckHandler("), "print window must deny permission checks too (C12)");
  assert.ok(printSrc.includes("export function sanitizeFailureReason("), "driver reasons must be sanitized before they leave the module (C8)");
  assert.match(printSrc, /reject\(new Error\(sanitizeFailureReason\(reason\)\)\)/, "the print callback's reason must go through sanitizeFailureReason");
  assert.ok(printSrc.includes("deps.onJobFailed(message)"), "a rejected job must be announced to main.ts (C3)");
  // Landmark for the negative below.
  assert.ok(printSrc.includes("if (!win.isDestroyed()) win.destroy();"));
  assert.ok(!printSrc.includes("deps.log.error(html"), "the HTML must never be logged");
});

test("(R2) shell-window.ts: renderer-crash recovery, retry of the FAILED url, throttled openExternal, fallback cleared on close", () => {
  assert.ok(shellWindowSrc.includes('"render-process-gone"'), "a dead renderer must be reloaded (C2)");
  assert.ok(shellWindowSrc.includes("retryLater(isSameOrigin(validatedURL, origin) ? validatedURL : startUrl(origin))"), "did-fail-load must retry the page that failed (C23)");
  assert.ok(shellWindowSrc.includes("OPEN_EXTERNAL_MIN_INTERVAL_MS"), "openExternal must be throttled (C21)");
  const openExternalCalls = (shellWindowSrc.match(/shell\.openExternal\(/g) ?? []).length;
  assert.equal(openExternalCalls, 1, "shell.openExternal must have exactly one, throttled call site");
  assert.ok((shellWindowSrc.match(/clearTimeout\(showFallback\)/g) ?? []).length >= 2, "the first-paint fallback must be cleared on ready-to-show AND on close (C24)");
  assert.equal(OPEN_EXTERNAL_MIN_INTERVAL_MS, 2_000);
});

test("(R3) main.ts: failure notification, consume-once --hidden, no dead-end windows, closed → null, guarded derefs, menu rebuilt after arming", () => {
  assert.ok(mainSrc.includes("Notification.isSupported()") && mainSrc.includes("new Notification({ title: PRODUCT_NAME"), "a failed print must raise a Windows notification (C3)");
  assert.ok(mainSrc.includes("onJobFailed: notifyPrintFailure"));
  assert.ok(mainSrc.includes("let startHiddenPending") && mainSrc.includes("startHiddenPending = false;"), "--hidden must apply to the first window only (C5)");
  assert.ok(mainSrc.includes('mainWindow.on("closed", () => {'), "mainWindow must be nulled on closed (C25)");
  assert.ok(!mainSrc.includes("mainWindow?.webContents"), "no unguarded optional-chain deref of mainWindow.webContents (C25)");
  const openMainAt = mainSrc.indexOf("const openMain = ");
  const openMainBody = mainSrc.slice(openMainAt, mainSrc.indexOf("\n    };", openMainAt));
  assert.ok(openMainBody.includes("openSetupWindow(false);"), "Open POS with no saved address must open the address window (C17)");
  const armAt = mainSrc.indexOf('webContents.on("did-finish-load"');
  const armBody = mainSrc.slice(armAt, mainSrc.indexOf("\n      });", armAt));
  assert.ok(armBody.includes("rebuildMenu();"), "the Start-with-Windows checkbox must refresh after arming (C6)");
  const secondAt = mainSrc.indexOf('app.on("second-instance"');
  const secondBody = mainSrc.slice(secondAt, mainSrc.indexOf("\n    });", secondAt));
  assert.ok(secondBody.includes("openMain();"), "second-instance must create a window when none exists (C17)");
  assert.ok(mainSrc.includes("const onDisk = readStore(storeFile);") && mainSrc.includes("deviceName: onDisk.deviceName"), "persist must re-read the hand-edited deviceName (C22)");
  assert.match(mainSrc, /try \{\s*writeStore\(storeFile, store\);\s*\} catch/, "a failed store write must be caught and logged (C15)");
  assert.ok(mainSrc.includes("mainWindow.show();\n        mainWindow.focus();\n      } else {\n        openMain();"), "saving a new address re-points AND shows the window (C16)");
});

test("(R4) url-window.ts: the same security posture and navigation guards as every other window", () => {
  assert.match(urlWindowSrc, /contextIsolation: true/);
  assert.match(urlWindowSrc, /sandbox: true/);
  assert.match(urlWindowSrc, /nodeIntegration: false/);
  assert.match(urlWindowSrc, /devTools: false/);
  assert.ok(urlWindowSrc.includes('"will-navigate"') && urlWindowSrc.includes("event.preventDefault()"), "URL window must block navigation (C20)");
  assert.ok(urlWindowSrc.includes("setWindowOpenHandler(() => ({ action: \"deny\" }))"), "URL window must deny popups (C20)");
  assert.ok(!urlWindowSrc.includes("nodeIntegration: true") && !urlWindowSrc.includes("webSecurity: false"));
  assert.ok(urlWindowSrc.includes("export function openUrlWindow("), "landmark");
});

test("(R5) url-window assets: inline data: logo under a data:-only img-src, a real form (Enter submits), product name in the header", () => {
  assert.ok(urlWindowHtml.includes("img-src data:"), "CSP must allow only data: images (the logo is inlined; file:// 'self' is not relied on)");
  assert.ok(urlWindowHtml.includes('src="data:image/png;base64,'), "the header logo must be inlined");
  assert.ok(!urlWindowHtml.includes('src="logo.png"'), "no separate logo file is referenced");
  assert.ok(urlWindowHtml.includes('<form id="address-form"') && urlWindowHtml.includes('type="submit"'), "the address entry must be a form so Enter submits (C27)");
  assert.ok(urlWindowJs.includes('addEventListener("submit"'), "the script must handle the form submit");
  assert.ok(urlWindowHtml.includes(PRODUCT_NAME), "the header must carry the product name (C13)");
  assert.ok(!existsSync(path.join(ROOT, "assets", "logo.png")), "assets/logo.png must not exist (it is inlined)");
});

test("(R6) package.json: vendor author, en-US only, maximum compression, uninstaller include", () => {
  const typed = pkg as { author?: string; build: { electronLanguages?: string[]; compression?: string; nsis: { include?: string } } };
  assert.equal(typed.author, VENDOR_NAME);
  assert.deepEqual(typed.build.electronLanguages, ["en-US"]);
  assert.equal(typed.build.compression, "maximum");
  assert.equal(typed.build.nsis.include, "resources/installer.nsh");
});

test("(R7) resources/installer.nsh: customUnInstall deletes BOTH auto-start registry values named by APP_ID", () => {
  assert.ok(installerNsh.includes("!macro customUnInstall"), "landmark: the uninstall macro");
  assert.equal((installerNsh.match(/DeleteRegValue HKCU/g) ?? []).length, 2, "Run + StartupApproved\\Run");
  assert.equal((installerNsh.match(new RegExp(JSON.stringify(APP_ID), "g")) ?? []).length, 2, "both values must be named by the AppUserModelId (= build.appId) — a rename here strands the entry (C13)");
  assert.ok(installerNsh.includes("StartupApproved"));
});

// -- 2026-09-11 blank-slip fence ---------------------------------------------
// Owner directive 2026-09-11: "a print must NEVER come out blank". print.ts
// now proves a real paint happened (two animation frames, then a direct
// probe) and fences an empty body, an unfinished paint, and an oversized data
// URL before anything reaches webContents.print / loadURL.

test("(B1) print window backgroundThrottling: false (paint frames must not be throttled in a hidden window), and shell-window.ts still sets it too", () => {
  assert.match(printSrc, /backgroundThrottling:\s*false/);
  // Positive landmark pairing the print-window posture above: the same
  // BrowserWindow config block still carries its partition.
  assert.match(printSrc, /session\.fromPartition\(PRINT_PARTITION\)/);
  assert.match(shellWindowSrc, /backgroundThrottling:\s*false/);
});

test("(B1) vision-guard: backgroundThrottling is never re-enabled anywhere under src/", () => {
  const filesToScan = [
    ["print.ts", printSrc],
    ["shell-window.ts", shellWindowSrc],
    ["main.ts", mainSrc],
    ["url-window.ts", urlWindowSrc],
    ["preload.ts", preloadSrc],
    ["url-preload.ts", urlPreloadSrc],
  ] as const;
  for (const [name, source] of filesToScan) {
    assert.ok(!source.includes("backgroundThrottling: true"), `${name} must never set backgroundThrottling: true`);
  }
  // Landmark: the two known-good occurrences are both really there (proves
  // the negative above isn't vacuous from a blinded/empty read).
  const trueCountAcrossAll = filesToScan.filter(([, s]) => s.includes("backgroundThrottling: true")).length;
  assert.equal(trueCountAcrossAll, 0);
  const falseCount =
    (printSrc.match(/backgroundThrottling:\s*false/g) ?? []).length +
    (shellWindowSrc.match(/backgroundThrottling:\s*false/g) ?? []).length;
  assert.equal(falseCount, 2, "expected exactly the print-window and main-window occurrences");
});

test("(B2) paint proof: two requestAnimationFrame calls, a body/scrollHeight/styleSheets probe, and the ready-vs-fallback race", () => {
  const rafCount = (printSrc.match(/requestAnimationFrame/g) ?? []).length;
  assert.ok(rafCount >= 2, `expected at least two requestAnimationFrame occurrences, found ${rafCount}`);
  assert.match(printSrc, /document\.body\.innerText/);
  assert.match(printSrc, /scrollHeight/);
  assert.match(printSrc, /document\.styleSheets\.length/);
  assert.match(printSrc, /Promise\.race\(\[\s*win\.webContents\.executeJavaScript\(PAINT_READY_SCRIPT\)/, "the paint probe must be raced against its own deadline");
  assert.match(printSrc, /delay\(PAINT_READY_MAX_MS,\s*null\)/);
  assert.match(printSrc, /win\.webContents\.executeJavaScript\(PAINT_PROBE_SCRIPT\)/, "a timed-out race must fall back to a direct probe");
  // The fonts race is unchanged by this fence and must still be present.
  assert.match(printSrc, /FONTS_READY_MAX_MS/);
  assert.match(printSrc, /FONTS_READY_SCRIPT/);
});

test("(B2) blank-slip fence: PRINT_NOT_READY_MESSAGE and PRINT_EMPTY_MESSAGE are both thrown BEFORE webContents.print(", () => {
  const notReadyThrowIdx = printSrc.indexOf("throw new Error(PRINT_NOT_READY_MESSAGE)");
  const emptyThrowIdx = printSrc.indexOf("throw new Error(PRINT_EMPTY_MESSAGE)");
  const printCallIdx = printSrc.indexOf("win.webContents.print(");
  assert.ok(notReadyThrowIdx >= 0, "expected a PRINT_NOT_READY_MESSAGE throw site");
  assert.ok(emptyThrowIdx >= 0, "expected a PRINT_EMPTY_MESSAGE throw site");
  assert.ok(printCallIdx >= 0, "expected a webContents.print( call site");
  assert.ok(notReadyThrowIdx < printCallIdx, "the not-ready fence must run before printing");
  assert.ok(emptyThrowIdx < printCallIdx, "the empty-slip fence must run before printing");
  // The guards themselves: an invalid probe shape, then a zero-length body.
  assert.match(printSrc, /if \(!isPaintProbe\(probe\)\) throw new Error\(PRINT_NOT_READY_MESSAGE\)/);
  assert.match(printSrc, /if \(probe\.text === 0\) throw new Error\(PRINT_EMPTY_MESSAGE\)/);
});

test("(B3) data-URL ceiling: DATA_URL_MAX_CHARS is checked and thrown BEFORE win.loadURL(", () => {
  const throwIdx = printSrc.indexOf("throw new Error(PRINT_TOO_LARGE_MESSAGE)");
  const loadUrlIdx = printSrc.indexOf("win.loadURL(");
  assert.ok(throwIdx >= 0, "expected a PRINT_TOO_LARGE_MESSAGE throw site");
  assert.ok(loadUrlIdx >= 0, "expected a win.loadURL( call site");
  assert.ok(throwIdx < loadUrlIdx, "the size fence must run before the data URL is ever loaded");
  assert.match(printSrc, /dataUrl\.length > DATA_URL_MAX_CHARS/);
});

test("(B3) size/timing constants: DATA_URL_MAX_CHARS and PAINT_READY_MAX_MS stay inside their budgets", () => {
  assert.ok(DATA_URL_MAX_CHARS < 2 * 1024 * 1024, "Chromium refuses a data: URL over ~2MB; keep headroom");
  assert.ok(DATA_URL_MAX_CHARS > PRINT_HTML_MAX_CHARS, "the encoded URL is always longer than the raw html it wraps");
  assert.ok(Number.isInteger(PAINT_READY_MAX_MS) && PAINT_READY_MAX_MS > 0, "PAINT_READY_MAX_MS must be a positive integer");
  assert.ok(PAINT_READY_MAX_MS < PRINT_JOB_TIMEOUT_MS, "the paint wait must fit inside the whole-job deadline");
  assert.ok(
    FONTS_READY_MAX_MS + PAINT_READY_MAX_MS < PRINT_JOB_TIMEOUT_MS / 2,
    "fonts + paint waits together must leave the job at least half its deadline for load + print",
  );
});

// print.ts imports "electron" so it cannot be imported here -- the three new
// message constants are parsed straight out of the source text instead.
function extractStringConst(source: string, name: string): string {
  const re = new RegExp(`export const ${name} =\\s*"([^"]*)"\\s*;`);
  const m = source.match(re);
  assert.ok(m, `expected to find "export const ${name} = \\"...\\";" in print.ts`);
  return m![1]!;
}

test("(B4) the three new print.ts messages are distinct, plain-English, period-terminated string constants", () => {
  const empty = extractStringConst(printSrc, "PRINT_EMPTY_MESSAGE");
  const notReady = extractStringConst(printSrc, "PRINT_NOT_READY_MESSAGE");
  const tooLarge = extractStringConst(printSrc, "PRINT_TOO_LARGE_MESSAGE");
  const rejected = extractStringConst(printSrc, "PRINT_REJECTED_MESSAGE");
  const timeout = extractStringConst(printSrc, "PRINT_TIMEOUT_MESSAGE");

  assert.equal(empty, "That slip had nothing to print.");
  assert.equal(notReady, "The slip did not finish drawing. Print it again.");
  assert.equal(tooLarge, "This slip is too large to print.");

  for (const msg of [empty, notReady, tooLarge, rejected, timeout]) {
    assert.ok(msg.endsWith("."), `message must end in a period: ${JSON.stringify(msg)}`);
    assert.ok(/^[A-Za-z0-9 .,'?!()-]+$/.test(msg), `message must be plain English ASCII: ${JSON.stringify(msg)}`);
  }
  const distinctSet = new Set([empty, notReady, tooLarge, rejected, timeout]);
  assert.equal(distinctSet.size, 5, "all five messages must be pairwise distinct");
});

test("(B5) logging: the success line names probe.text/probe.sheets/probe.height/printer=, and the html-length vision-guard still holds with >= 4 log call sites", () => {
  assert.match(printSrc, /\$\{probe\.text\}/);
  assert.match(printSrc, /\$\{probe\.sheets\}/);
  assert.match(printSrc, /\$\{probe\.height\}/);
  assert.match(printSrc, /printer=\$\{deviceName/);

  // A stronger scanner than test (4)'s: that one only matches a
  // log.info(`...`) call closed on the same line, so it misses the
  // multi-line `deps.log.info(\n  \`...\`,\n)` success-log call added here.
  // Walk every `log.(info|error)(` call site and pull out its first
  // backtick-delimited argument regardless of line breaks.
  const callSites = printSrc.match(/\blog\.(info|error)\(/g) ?? [];
  assert.ok(callSites.length >= 4, `expected >= 4 log.info/log.error call sites, found ${callSites.length}`);

  let found = 0;
  const templateLiterals: string[] = [];
  const callRe = /\blog\.(info|error)\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(printSrc)) !== null) {
    const afterParen = printSrc.slice(m.index + m[0].length);
    const backtickMatch = afterParen.match(/^\s*(`[^`]*`)/);
    assert.ok(backtickMatch, `expected a template-literal argument right after ${m[0]}`);
    templateLiterals.push(backtickMatch![1]!);
    found++;
  }
  assert.ok(found >= 4, `expected to parse >= 4 template-literal log arguments, parsed ${found}`);

  for (const literal of templateLiterals) {
    assert.match(literal, /html\.length/, `log call must reference html.length, not html: ${literal}`);
    assert.ok(!/\$\{html\}/.test(literal), `log call must never interpolate the raw html: ${literal}`);
  }
  // Landmark: the success line really is one of the parsed literals (proves
  // the multi-line walk above actually reached it, not just the two
  // single-line info() calls test (4) already covered).
  assert.ok(templateLiterals.some((l) => l.includes("printer=${deviceName")));
});

test("(B6) package.json: version is >= 1.0.1 and the nsis artifactName still carries ${version}", () => {
  const version = typedPkg.version;
  assert.equal(typeof version, "string");
  const [major, minor, patch] = version.split(".").map(Number);
  assert.ok(
    major! > 1 || (major === 1 && (minor! > 0 || (minor === 0 && patch! >= 1))),
    `package.json version ${version} must be >= 1.0.1`,
  );
  assert.ok(typedPkg.build.nsis.artifactName!.includes("${version}"), "artifactName must still interpolate the build version");
});
