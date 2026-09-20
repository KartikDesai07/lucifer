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
  PRINTERS_CHANNEL,
  PRINTER_SAVE_CHANNEL,
  PRINT_MODE_SAVE_CHANNEL,
  PRINT_MODES,
  DEFAULT_PRINT_MODE,
  isNonPaperPrinter,
  isPrintMode,
} from "./shared";
import { pageWidthMicronsOf, pageHeightMicronsOf } from "./print-driver";
import { SLIP_CSS_PX_DEFAULT_58MM, SLIP_CSS_PX_DEFAULT_80MM, usableSlipCssWidth } from "./print-direct";
import { DOTS_58MM, DOTS_80MM } from "./escpos";

const SRC = path.join(__dirname); // apps/desktop/src
const ROOT = path.join(__dirname, ".."); // apps/desktop

function read(relFromDesktopRoot: string): string {
  return readFileSync(path.join(ROOT, relFromDesktopRoot), "utf8");
}

const shellWindowSrc = read("src/shell-window.ts");
const mainSrc = read("src/main.ts");
const printSrc = read("src/print.ts");
// The 2026-09-19 split of print.ts: job runner, the two lanes, the messages,
// and the two pure helpers the direct lane is built on.
const jobSrc = read("src/print-job.ts");
const driverSrc = read("src/print-driver.ts");
const directSrc = read("src/print-direct.ts");
const messagesSrc = read("src/print-messages.ts");
const escposSrc = read("src/escpos.ts");
const rawSpoolSrc = read("src/raw-spool.ts");
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

// 2026-09-19: print.ts was split. print.ts keeps the IPC handlers, print-job.ts
// owns the offscreen window + load + paint proof, print-driver.ts owns the
// webContents.print lane, print-direct.ts owns the RAW ESC/POS lane and
// print-messages.ts the curated sentences. Every pin below was RE-POINTED at
// the file that now holds the code — none was loosened.
test("(4) print-job.ts / print-driver.ts: offscreen job posture (partition, data URL, print options, timeout, cleanup)", () => {
  assert.match(jobSrc, /session\.fromPartition\(PRINT_PARTITION\)/);
  assert.match(jobSrc, /baseURLForDataURL/);
  assert.match(jobSrc, /encodeURIComponent/);
  assert.match(driverSrc, /silent:\s*true/);
  assert.match(driverSrc, /printBackground:\s*true/);
  // Page geometry (superseded 2026-09-19 — (P4) below owns the full rule).
  // A silent print has no dialog, so nothing asks Windows for the paper. The
  // first attempt asked the DRIVER (`usePrinterDefaultPageSize`), but a
  // thermal driver such as POS80 often reports no default page size and
  // Electron then falls back to A4 — an A4 layout handed to an 80mm roll
  // prints blank while the print call still reports success. The width is now
  // READ from the slip's own @page rule and passed explicitly, with the
  // driver's default kept only as the fallback. Both must stay, as an
  // either/or; removing either one reopens a blank-print path.
  assert.match(driverSrc, /usePrinterDefaultPageSize:\s*true/, "the no-width fallback must remain");
  assert.match(driverSrc, /pageSize:\s*\{/, "the known-width path must pass an explicit pageSize");
  assert.match(jobSrc, /PRINT_JOB_TIMEOUT_MS/);
  assert.match(jobSrc, /FONTS_READY_MAX_MS/);
  assert.match(jobSrc, /finally/);
  assert.match(jobSrc, /\.destroy\(\)/);
});

test("(4) vision-guard: no print file uses a persist: partition, and none logs the HTML", () => {
  // The whole print surface, since the split: handler, job, both lanes.
  const laneSrc = [printSrc, jobSrc, driverSrc, directSrc].join("\n");
  assert.ok(!laneSrc.includes('"persist:'));
  assert.ok(!laneSrc.includes("`persist:"));
  const logCalls = laneSrc.match(/log\.(info|error)\(`[^`]*`\)/g) ?? [];
  assert.ok(logCalls.length >= 2, "expected at least two log.info/log.error call sites");

  // THE SECURITY RULE, applied to EVERY log call without exception: the slip's
  // HTML never reaches the log file.
  for (const call of logCalls) {
    assert.ok(!/\$\{html\}/.test(call), `log call must never interpolate the raw html: ${call}`);
  }

  // The size discipline applies to the log calls that are ABOUT a print job —
  // those must name html.length rather than the payload. Since 2026-09-17 the
  // file also logs the operator's PRINTER CHOICE, which has no html in scope
  // at all; requiring html.length there would be meaningless (and the blanket
  // rule above already proves none of them can leak a slip). Scoped by the
  // presence of "print job" in the message, which is the shape every
  // job-related line already uses.
  const jobLogCalls = logCalls.filter((c) => c.includes("print job"));
  assert.ok(jobLogCalls.length >= 2, "expected at least two 'print job' log call sites");
  for (const call of jobLogCalls) {
    assert.match(call, /html\.length/, `a print-job log call must reference html.length, not html: ${call}`);
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
    // Leading comments must be stripped before the anchored matches below.
    // Without this a property written under a `// ...` line parsed as NOTHING
    // and was SILENTLY DROPPED — which, in a pin whose whole job is to assert
    // the renderer's privileged surface is a closed set, meant a new
    // ipcRenderer-invoking method could be added behind a comment and never
    // be seen (found 2026-09-17, when listPrinters went missing this way).
    const trimmed = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/[^\n]*$/gm, "")
      .trim();
    if (trimmed.length === 0) return;
    // Either `key: value` or a shorthand property `key` (e.g. `{ version, printHtml: ... }`).
    const keyed = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/);
    if (keyed && keyed[1] !== undefined) {
      keys.push(keyed[1]);
      return;
    }
    const shorthand = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (shorthand && shorthand[1] !== undefined) {
      keys.push(shorthand[1]);
      return;
    }
    // Never drop a token quietly: an unparsable member is a hole in the
    // closed-set guarantee, so it fails the pin instead of vanishing.
    assert.fail(`could not extract a property name from an exposed member: ${JSON.stringify(trimmed.slice(0, 120))}`);
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

test("(6) preload.ts exposes exactly ['version', 'printHtml', 'listPrinters', 'savePrinter', 'savePrintMode'] on posDesktop", () => {
  // WIDENED 2026-09-17 and again 2026-09-19, deliberately — this stays a
  // CLOSED set, which is the point of the pin: the renderer's whole privileged
  // surface is these five and nothing else (never ipcRenderer, never a node
  // builtin). savePrintMode carries one of two string literals ("direct" /
  // "driver") that the main process validates; it returns nothing privileged.
  //
  // listPrinters/savePrinter exist because silent printing used to go to the
  // WINDOWS DEFAULT printer: on the counter PC that was a virtual device (a
  // "nul:" port that swallowed every slip, and "PORTPROMPT:" ones that pop a
  // save-file dialog), so nothing ever reached paper and no error appeared.
  // Both new methods are name-only — they return printer NAMES and store one;
  // they never hand the renderer a handle, a driver object, or a file path.
  const keys = extractExposedKeys(preloadSrc, '"posDesktop"');
  assert.deepEqual(keys.sort(), ["listPrinters", "printHtml", "savePrintMode", "savePrinter", "version"]);
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
test("(7) preload.ts duplicated literals equal shared.ts (PRINT_CHANNEL, BRIDGE_KEY, VERSION_ARG_PREFIX, the picker channels)", () => {
  assert.ok(preloadSrc.includes(JSON.stringify(PRINT_CHANNEL)));
  assert.ok(preloadSrc.includes(JSON.stringify(BRIDGE_KEY)));
  assert.ok(preloadSrc.includes(JSON.stringify(VERSION_ARG_PREFIX)));
  assert.ok(preloadSrc.includes(JSON.stringify(PRINTERS_CHANNEL)));
  assert.ok(preloadSrc.includes(JSON.stringify(PRINTER_SAVE_CHANNEL)));
  assert.ok(preloadSrc.includes(JSON.stringify(PRINT_MODE_SAVE_CHANNEL)));
  // And each literal is the one its bridge method invokes.
  assert.match(preloadSrc, /savePrintMode:[\s\S]{0,120}?ipcRenderer\.invoke\(PRINT_MODE_SAVE_CHANNEL, mode\)/);
});

// -- 2026-09-17: no slip may reach a device that writes a FILE -------------
// Owner rule: on the counter PC a save-file window must never appear and a
// slip must never vanish into a virtual device. Two guards, both pinned here:
// the NAME matcher, and the handler ordering that refuses BEFORE any window
// opens while still routing the refusal through the tray notification.

test("(P3) pageWidthMicronsOf reads the slip's real roll width from its own @page rule, and refuses anything that is not a usable roll width", () => {
  // The REAL rules apps/cafe/lib/print.ts emits (RECEIPT_PAGE_STYLE and
  // receiptPageStyle for both configured paper widths).
  assert.equal(
    pageWidthMicronsOf("@page { size: 80mm auto; margin: 4mm; } @media print { body { margin: 0; } }"),
    80_000,
    "an 80mm roll must be passed to the printer as 80000 microns",
  );
  assert.equal(
    pageWidthMicronsOf("@page { size: 58mm auto; margin: 4mm; } @media print { body { margin: 0; } }"),
    58_000,
    "a 58mm roll must be passed as 58000 microns",
  );
  assert.equal(pageWidthMicronsOf("@page { size: 3in auto; }"), 76_200, "inches must convert");

  // The A4 QR sheet prints through the BROWSER dialog and carries a keyword
  // size, not a length — it must fall through to the driver, never be forced.
  assert.equal(pageWidthMicronsOf("@page { size: A4 portrait; margin: 10mm; }"), null);
  assert.equal(pageWidthMicronsOf("<style>body{margin:0}</style>"), null, "no @page rule at all");
  // Out-of-range values are refused rather than handed to a printer: Chromium
  // rejects a tiny page, and an absurd one would compose a giant sheet.
  assert.equal(pageWidthMicronsOf("@page { size: 5mm auto; }"), null, "too narrow");
  assert.equal(pageWidthMicronsOf("@page { size: 5000mm auto; }"), null, "absurdly wide");
});

test("(P7) the printer margin is OFF — Chromium's default ~10mm margin is leading blank paper on a roll", () => {
  // Owner measured ~7cm of blank before the slip on 2026-09-19. `margins`
  // defaults to marginType "default" (Chromium's own page margin), which on a
  // continuous roll is simply paper fed before anything prints. The slip
  // brings its own spacing (the @page 4mm rule plus the receipt's padding).
  assert.match(
    driverSrc,
    /margins:\s*\{\s*marginType:\s*"none"\s*\}/,
    'print-driver.ts must pass margins: { marginType: "none" } — the default margin is fed as blank paper on every slip',
  );
  // Positive landmark so the pin is not vacuous.
  assert.match(driverSrc, /silent:\s*true/, "the silent print call must still exist");
});

test("(P5) pageHeightMicronsOf follows the slip's CONTENT — a fixed height is the runaway-paper-feed bug wearing a different number", () => {
  // 2026-09-17: an explicit 1200mm @page height fed 1.2 METRES per slip and
  // ran a whole thermal roll out. MEASURED again on 2026-09-19 before this
  // shipped: a 31.8mm slip with a "generous" 3000mm composition height still
  // produced a 3000mm page. So the height MUST track the content.
  const mm = (microns: number) => microns / 1000;

  // 120px of content = 31.8mm; expect ~that plus the 10mm margin tail.
  const small = pageHeightMicronsOf(120);
  assert.ok(mm(small) > 35 && mm(small) < 50, `a 31.8mm slip must yield a ~42mm page, got ${mm(small)}mm`);

  // A longer bill gets a taller page — UP TO the driver-safe ceiling. Beyond
  // it the page stops growing and Chromium paginates instead; on a continuous
  // roll those pages come out as one strip, which is what the operator wants.
  // (Before 2026-09-19 this expected ~742mm for a 731.8mm slip. That is now
  // wrong, not because the invariant changed but because a page that long is
  // silently TRUNCATED by the printer — see the ceiling assertion below.)
  const medium = pageHeightMicronsOf(600); // 158.8mm — still under the cap
  assert.ok(mm(medium) > 150 && mm(medium) < 170, `a 158.8mm slip must yield a ~163mm page, got ${mm(medium)}mm`);
  assert.ok(medium > small, "a longer slip must produce a taller page, while it fits");

  const huge = pageHeightMicronsOf(2766); // 731.8mm of content
  assert.equal(mm(huge), 280, "past the ceiling the page stops growing and the bill paginates instead");

  // Hard stop, BOTH ways. MEASURED on the counter PC 2026-09-19: a 317mm page
  // made the POS80 stop after ~225mm and the rest of a 32-item bill was lost
  // silently. The cap keeps every page inside what a thermal driver accepts;
  // a longer bill paginates (verified: 60 items -> 2x200mm pages, capacity
  // 400mm vs 303mm of content, nothing dropped) instead of being truncated.
  // The ceiling tracks the printer's configured roll media (80 x 297mm) with
  // headroom for its unprintable lead-in. It must stay BELOW that media: a
  // page longer than the media is what silently truncated a 32-item bill on
  // 2026-09-19. It must also stay comfortably ABOVE a normal bill, or ordinary
  // orders paginate for no reason (the earlier 200mm split a 20-item bill).
  const ceilingMm = mm(pageHeightMicronsOf(999_999));
  assert.ok(ceilingMm <= 290, `a single page must stay under the 297mm roll media, got ${ceilingMm}mm`);
  assert.ok(ceilingMm >= 250, `the ceiling must not be so tight that ordinary bills paginate, got ${ceilingMm}mm`);
  // And the real failing case must fit in ONE page.
  assert.ok(
    mm(pageHeightMicronsOf(1183)) <= ceilingMm,
    "the owner's 32-item bill (1183px) must fit one page",
  );
  // And a broken/zero measurement must not produce a zero-size page.
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const h = pageHeightMicronsOf(bad);
    assert.ok(h >= 25_000 && h <= 1_500_000, `a bad content height (${bad}) must clamp to a sane page, got ${h}`);
  }
});

test("(P4) print.ts passes an explicit pageSize when the width is known, and only falls back to the driver's default when it is not — the A4-on-an-80mm-roll blank print", () => {
  // Positive landmarks first.
  assert.match(driverSrc, /pageWidthMicronsOf\(html\)/, "the driver lane must read the width from the slip's own document");
  assert.match(driverSrc, /pageHeightMicronsOf\(probe\.height\)/, "the page height must come from the slip's MEASURED content, never a fixed constant");
  assert.ok(
    !/height:\s*\d{5,}/.test(driverSrc),
    "a large hardcoded page height must never be passed — that is the runaway-paper-feed bug (1200mm fed 1.2m per slip)",
  );

  // The either/or: Electron REJECTS pageSize + usePrinterDefaultPageSize
  // together, so they must never both be passed unconditionally.
  assert.match(
    driverSrc,
    /pageWidthMicrons !== null[\s\S]{0,200}?pageSize:\s*\{[\s\S]{0,120}?usePrinterDefaultPageSize:\s*true/,
    "pageSize (known width) and usePrinterDefaultPageSize (fallback) must be a single either/or spread — Electron rejects the pair",
  );

  // The width must never be hardcoded: it comes from the cafe's Settings via
  // the @page rule, so a 58mm cafe is not forced onto 80mm.
  assert.ok(
    !/pageSize:\s*\{\s*width:\s*\d/.test(driverSrc),
    "pageSize.width must be the value read from the document, never a hardcoded number",
  );
  // And the driver lane is the ONLY place webContents.print is ever called.
  assert.equal((driverSrc.match(/webContents\.print\(/g) ?? []).length, 1, "exactly one webContents.print call, in the driver lane");
  for (const [name, src] of [["print.ts", printSrc], ["print-job.ts", jobSrc], ["print-direct.ts", directSrc]] as const) {
    assert.ok(!src.includes("webContents.print("), `${name} must not call webContents.print — the direct lane bypasses the driver entirely`);
  }
});

test("(P1) isNonPaperPrinter matches every known file/virtual device, and no real printer", () => {
  // The exact device names measured on a real Windows counter PC (their ports
  // were "nul:" for OneNote and "PORTPROMPT:" for the two writers — the ones
  // that pop a save dialog). Electron exposes no port, hence name matching.
  for (const name of [
    "Microsoft Print to PDF",
    "Microsoft XPS Document Writer",
    "OneNote (Desktop)",
    "Fax",
    "Send to OneNote 16",
    "Adobe PDF",
    "PDFCreator",
    "MICROSOFT PRINT TO PDF",
  ]) {
    assert.equal(isNonPaperPrinter(name), true, `${name} must be refused — it writes a file, not paper`);
  }
  // Real thermal/laser devices must stay usable. "TVS RP 3230" and "EPSON
  // TM-T82" are the common Indian counter printers.
  for (const name of [
    "TVS RP 3230",
    "EPSON TM-T82 Receipt",
    "POS-80",
    "XP-80C",
    "HP LaserJet Pro M1136",
    "Everycom 80mm Series",
  ]) {
    assert.equal(isNonPaperPrinter(name), false, `${name} is a real printer and must remain selectable`);
  }
});

test("(P2) print.ts refuses an unchosen or file-writing printer BEFORE opening a window, and routes both refusals through the job promise so the tray notification fires", () => {
  // Positive landmarks first (negative-pin discipline).
  assert.match(printSrc, /PRINT_NO_PRINTER_MESSAGE/, "the no-printer refusal constant must exist");
  assert.match(printSrc, /PRINT_NOT_A_PRINTER_MESSAGE/, "the file-writing refusal constant must exist");
  assert.match(printSrc, /isNonPaperPrinter\(/, "print.ts must consult the virtual-printer matcher");

  // The refusal is decided before runJob is ever reached.
  const refusalIdx = printSrc.indexOf("const refusal");
  const runJobCallIdx = printSrc.indexOf("runJob(html, origin, deviceName");
  assert.ok(refusalIdx > 0, "the refusal decision must exist");
  assert.ok(runJobCallIdx > refusalIdx, "the printer must be vetted BEFORE runJob opens an offscreen window");

  // The two refusal CONDITIONS must actually be live, bound to the device
  // name. Asserting only that `const refusal` exists let a mutation that
  // replaced the unchosen-printer test with `false` sail through (measured
  // 2026-09-17) — the implicit-system-default bug would have come straight
  // back. Bind each arm to the variable it must test.
  const refusalBlock = printSrc.slice(refusalIdx, runJobCallIdx);
  assert.match(
    refusalBlock,
    /chosen === null \|\| chosen\.length === 0/,
    "the unchosen-printer arm must test the device name itself — no printer chosen must refuse, never fall back to the Windows default",
  );
  assert.match(
    refusalBlock,
    /isNonPaperPrinter\(chosen\)/,
    "the file-writing arm must test the CHOSEN name (not a coerced/defaulted value)",
  );
  assert.ok(
    !/isNonPaperPrinter\(chosen \?\? ""\)/.test(refusalBlock),
    "coercing the name with ?? \"\" before the virtual-printer check hides the unchosen case behind a passing match",
  );

  // CRITICAL: thrown straight from the handler the refusal would bypass the
  // catch that logs and raises the Windows notification, and the operator
  // would see the same silence this whole fix exists to remove. It must be
  // thrown INSIDE the queued job instead.
  assert.match(
    printSrc,
    /refusal !== null\s*\?\s*queue\.then\(/,
    "a refusal must be thrown inside the queued job promise, not straight from the handler, or onJobFailed never runs",
  );

  // No implicit fallback to the system default may return.
  assert.ok(
    !printSrc.includes('deviceName ?? "system default"'),
    'print.ts must not log a "system default" printer any more — a device is always explicitly chosen',
  );
  assert.ok(
    !/\.\.\.\(deviceName \? \{ deviceName \} : \{\}\)/.test(printSrc),
    "deviceName must be passed unconditionally — the conditional spread was the implicit-default path",
  );
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
    "print-job.ts",
    "print-driver.ts",
    "print-direct.ts",
    "print-messages.ts",
    "escpos.ts",
    "raw-spool.ts",
    "printer-check.ts",
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
    ["src/print-job.ts", jobSrc],
    ["src/print-driver.ts", driverSrc],
    ["src/print-direct.ts", directSrc],
    ["src/print-messages.ts", messagesSrc],
    ["src/escpos.ts", escposSrc],
    ["src/raw-spool.ts", rawSpoolSrc],
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

test("(P6) the product logo is on every surface OUTSIDE the loaded web page — window, setup window, tray and About dialog", () => {
  // Owner 2026-09-19: "bahar sab jagah muje proper mere product ka hi logo
  // chahiye" — inside the page the cafe's own branding still wins, but every
  // piece of app chrome must carry the product mark.
  //
  // assets/ (not resources/) because build.files packages only out/, assets/
  // and package.json — an icon under resources/ would be missing in the
  // INSTALLED app while working fine in dev.
  const iconPath = path.join(ROOT, "assets", "app-icon.png");
  assert.ok(existsSync(iconPath), "assets/app-icon.png must exist — resources/ is not packaged");
  const { isPng, width, height } = readPngIhdr(iconPath);
  assert.ok(isPng, "app-icon.png must be a real PNG");
  assert.ok(width >= 256 && height >= 256, `app icon must be at least 256x256, got ${width}x${height}`);

  const pkgFiles = (typedPkg.build.files ?? []) as string[];
  assert.ok(
    pkgFiles.some((f) => f.startsWith("assets/")),
    "build.files must package assets/ or the window icon is missing from the installed app",
  );

  for (const [file, src] of [
    ["shell-window.ts", shellWindowSrc],
    ["url-window.ts", urlWindowSrc],
    ["menu.ts", read("src/menu.ts")],
  ] as const) {
    assert.match(src, /APP_ICON_FILE/, `${file} must use the shared APP_ICON_FILE constant, never a hardcoded path`);
  }
});

test("assets/tray.png is exactly 32x32 (IHDR)", () => {
  const { isPng, width, height } = readPngIhdr(path.join(ROOT, "assets", "tray.png"));
  assert.equal(isPng, true);
  assert.equal(width, 32);
  assert.equal(height, 32);
});

// -- Review fix round (2026-09-08): pins for the arbitrated findings ----------

test("(R1) print-job.ts / print.ts: ONE deadline for the whole job (load + fonts + print), both permission handlers denied, sanitized failure reasons, failure hook", () => {
  assert.match(jobSrc, /Promise\.race\(\[\s*loadAndPrint\(/, "the job body must be raced as a whole (C1)");
  assert.match(jobSrc, /reject\(new Error\(PRINT_TIMEOUT_MESSAGE\)\), PRINT_JOB_TIMEOUT_MS\)/, "the deadline must be PRINT_JOB_TIMEOUT_MS");
  assert.equal(PRINT_JOB_TIMEOUT_MS, 30_000, "the shell job deadline stays 30 s; the cafe seam waits 35 s so the shell's own message wins");
  assert.ok(jobSrc.includes("setPermissionRequestHandler("), "print window must deny permission requests");
  assert.ok(jobSrc.includes("setPermissionCheckHandler("), "print window must deny permission checks too (C12)");
  assert.ok(messagesSrc.includes("export function sanitizeFailureReason("), "driver reasons must be sanitized before they leave the module (C8)");
  assert.match(driverSrc, /reject\(new Error\(sanitizeFailureReason\(reason\)\)\)/, "the print callback's reason must go through sanitizeFailureReason");
  assert.ok(printSrc.includes("deps.onJobFailed(message)"), "a rejected job must be announced to main.ts (C3)");
  // Landmark for the negative below.
  assert.ok(jobSrc.includes("if (!win.isDestroyed()) win.destroy();"));
  for (const [name, src] of [["print.ts", printSrc], ["print-job.ts", jobSrc], ["print-driver.ts", driverSrc], ["print-direct.ts", directSrc]] as const) {
    assert.ok(!src.includes("log.error(html"), `${name}: the HTML must never be logged`);
    assert.ok(!src.includes("log.info(html"), `${name}: the HTML must never be logged`);
  }
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
  assert.match(jobSrc, /backgroundThrottling:\s*false/);
  // Positive landmark pairing the print-window posture above: the same
  // BrowserWindow config block still carries its partition.
  assert.match(jobSrc, /session\.fromPartition\(PRINT_PARTITION\)/);
  assert.match(shellWindowSrc, /backgroundThrottling:\s*false/);
});

test("(B1) vision-guard: backgroundThrottling is never re-enabled anywhere under src/", () => {
  const filesToScan = [
    ["print.ts", printSrc],
    ["print-job.ts", jobSrc],
    ["print-driver.ts", driverSrc],
    ["print-direct.ts", directSrc],
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
    (jobSrc.match(/backgroundThrottling:\s*false/g) ?? []).length +
    (shellWindowSrc.match(/backgroundThrottling:\s*false/g) ?? []).length;
  assert.equal(falseCount, 2, "expected exactly the print-window and main-window occurrences");
});

test("(B2) paint proof: two requestAnimationFrame calls, a body/scrollHeight/styleSheets probe, and the ready-vs-fallback race", () => {
  const rafCount = (jobSrc.match(/requestAnimationFrame/g) ?? []).length;
  assert.ok(rafCount >= 2, `expected at least two requestAnimationFrame occurrences, found ${rafCount}`);
  assert.match(jobSrc, /document\.body\.innerText/);
  assert.match(jobSrc, /scrollHeight/);
  assert.match(jobSrc, /document\.styleSheets\.length/);
  assert.match(jobSrc, /Promise\.race\(\[\s*win\.webContents\.executeJavaScript\(PAINT_READY_SCRIPT\)/, "the paint probe must be raced against its own deadline");
  assert.match(jobSrc, /delay\(PAINT_READY_MAX_MS,\s*null\)/);
  assert.match(jobSrc, /win\.webContents\.executeJavaScript\(PAINT_PROBE_SCRIPT\)/, "a timed-out race must fall back to a direct probe");
  // The fonts race is unchanged by this fence and must still be present.
  assert.match(jobSrc, /FONTS_READY_MAX_MS/);
  assert.match(jobSrc, /FONTS_READY_SCRIPT/);
});

test("(B2) blank-slip fence: PRINT_NOT_READY_MESSAGE and PRINT_EMPTY_MESSAGE are both thrown BEFORE either lane is entered, and the direct lane fences the pixels again before the spooler", () => {
  const notReadyThrowIdx = jobSrc.indexOf("throw new Error(PRINT_NOT_READY_MESSAGE)");
  const emptyThrowIdx = jobSrc.indexOf("throw new Error(PRINT_EMPTY_MESSAGE)");
  const driverCallIdx = jobSrc.indexOf("printThroughDriver(win,");
  const directCallIdx = jobSrc.indexOf("printDirect(win,");
  assert.ok(notReadyThrowIdx >= 0, "expected a PRINT_NOT_READY_MESSAGE throw site");
  assert.ok(emptyThrowIdx >= 0, "expected a PRINT_EMPTY_MESSAGE throw site");
  assert.ok(driverCallIdx >= 0, "expected the driver-lane call site");
  assert.ok(directCallIdx >= 0, "expected the direct-lane call site");
  for (const laneIdx of [driverCallIdx, directCallIdx]) {
    assert.ok(notReadyThrowIdx < laneIdx, "the not-ready fence must run before either lane prints");
    assert.ok(emptyThrowIdx < laneIdx, "the empty-slip fence must run before either lane prints");
  }
  // The guards themselves: an invalid probe shape, then a zero-length body.
  assert.match(jobSrc, /if \(!isPaintProbe\(probe\)\) throw new Error\(PRINT_NOT_READY_MESSAGE\)/);
  assert.match(jobSrc, /if \(probe\.text === 0\) throw new Error\(PRINT_EMPTY_MESSAGE\)/);
  // The driver lane still owns the one webContents.print( call (P4 counts it).
  assert.ok(driverSrc.includes("win.webContents.print("), "expected the webContents.print( call site in the driver lane");
  // The direct lane fences the PIXELS: no ink (rows === 0) and too tall are
  // both refused before a single byte reaches the Windows queue.
  const rowsZeroIdx = directSrc.indexOf("if (raster.rows === 0) throw new Error(PRINT_EMPTY_MESSAGE)");
  const tooTallIdx = directSrc.indexOf("if (raster.rows > RASTER_MAX_ROWS) throw new Error(PRINT_TOO_LARGE_MESSAGE)");
  const spoolIdx = directSrc.indexOf("writeRawJob(");
  assert.ok(rowsZeroIdx >= 0 && tooTallIdx >= 0 && spoolIdx >= 0, "expected both pixel fences and the spooler call");
  assert.ok(rowsZeroIdx < spoolIdx && tooTallIdx < spoolIdx, "both pixel fences must run before the RAW job is written");
});

test("(B3) data-URL ceiling: DATA_URL_MAX_CHARS is checked and thrown BEFORE win.loadURL(", () => {
  const throwIdx = jobSrc.indexOf("throw new Error(PRINT_TOO_LARGE_MESSAGE)");
  const loadUrlIdx = jobSrc.indexOf("win.loadURL(");
  assert.ok(throwIdx >= 0, "expected a PRINT_TOO_LARGE_MESSAGE throw site");
  assert.ok(loadUrlIdx >= 0, "expected a win.loadURL( call site");
  assert.ok(throwIdx < loadUrlIdx, "the size fence must run before the data URL is ever loaded");
  assert.match(jobSrc, /dataUrl\.length > DATA_URL_MAX_CHARS/);
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

// The message constants live in print-messages.ts (pure) since the 2026-09-19
// split; they are still parsed straight out of the source text so the pin
// reads exactly what ships.
function extractStringConst(source: string, name: string): string {
  const re = new RegExp(`export const ${name} =\\s*"([^"]*)"\\s*;`);
  const m = source.match(re);
  assert.ok(m, `expected to find "export const ${name} = \\"...\\";" in print-messages.ts`);
  return m![1]!;
}

test("(B4) the print messages are distinct, plain-English, period-terminated string constants", () => {
  const empty = extractStringConst(messagesSrc, "PRINT_EMPTY_MESSAGE");
  const notReady = extractStringConst(messagesSrc, "PRINT_NOT_READY_MESSAGE");
  const tooLarge = extractStringConst(messagesSrc, "PRINT_TOO_LARGE_MESSAGE");
  const rejected = extractStringConst(messagesSrc, "PRINT_REJECTED_MESSAGE");
  const timeout = extractStringConst(messagesSrc, "PRINT_TIMEOUT_MESSAGE");

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
  // backtick-delimited argument regardless of line breaks — across the whole
  // print surface (handler, job, both lanes) since the 2026-09-19 split.
  const laneSrc = [printSrc, jobSrc, driverSrc, directSrc].join("\n");
  const callSites = laneSrc.match(/\blog\.(info|error)\(/g) ?? [];
  assert.ok(callSites.length >= 4, `expected >= 4 log.info/log.error call sites, found ${callSites.length}`);

  let found = 0;
  const literals: string[] = [];
  const callRe = /\blog\.(info|error)\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(laneSrc)) !== null) {
    const afterParen = laneSrc.slice(m.index + m[0].length);
    // Since 2026-09-17 the printer-choice lines log a PLAIN string too (one
    // has nothing to interpolate), so a bare "..." argument is accepted here
    // alongside a template literal — both are still scanned below.
    const argMatch = afterParen.match(/^\s*(`[^`]*`|"[^"]*")/);
    assert.ok(argMatch, `expected a string or template-literal argument right after ${m[0]}`);
    literals.push(argMatch![1]!);
    found++;
  }
  assert.ok(found >= 4, `expected to parse >= 4 log arguments, parsed ${found}`);

  // Universal: no log line may ever carry the slip's HTML.
  for (const literal of literals) {
    assert.ok(!/\$\{html\}/.test(literal), `log call must never interpolate the raw html: ${literal}`);
  }
  // Scoped: the lines ABOUT a print job must report its SIZE, not its payload.
  // The printer-choice lines have no html in scope and are excluded by name,
  // not by loosening the rule for everyone.
  const jobLiterals = literals.filter((l) => l.includes("print job"));
  assert.ok(jobLiterals.length >= 3, `expected >= 3 'print job' log lines, found ${jobLiterals.length}`);
  for (const literal of jobLiterals) {
    assert.match(literal, /html\.length/, `a print-job log call must reference html.length: ${literal}`);
  }
  // Landmark: the success line really is one of the parsed literals (proves
  // the multi-line walk above actually reached it, not just the two
  // single-line info() calls test (4) already covered).
  assert.ok(literals.some((l: string) => l.includes("printer=${deviceName")));
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

// -- 2026-09-19 the DIRECT lane: RAW ESC/POS, paper length = content --------
// MEASURED on the counter PC: the POS80 driver ignores the page size the app
// asks for and prints on its own fixed form (a 4cm slip on a 297mm page; a
// 32-item bill cut short on Letter). Chromium overlays DM_PAPERWIDTH/LENGTH
// on the driver's default DEVMODE and leaves dmPaperSize set — Microsoft's
// contract says it "must be zero" then — so the driver's choice is undefined
// and no Electron option changes it. The direct lane bypasses the driver:
// offscreen window -> DevTools screenshot at (dots / slip px) scale -> 1-bit
// raster -> GS v 0 bands -> RAW spooler job. These pins keep that chain whole.

test("(D1) print-job.ts: the lane is an either/or on the stored mode, and only the direct lane's window is offscreen", () => {
  assert.match(jobSrc, /offscreen:\s*mode === "direct"/, "the direct lane needs an offscreen window (a hidden on-screen one never paints the screenshot frame — measured)");
  assert.match(jobSrc, /if \(mode === "driver"\) \{[\s\S]{0,200}?printThroughDriver\(win, html, probe, deviceName, log\)/, "the driver lane runs only when the mode says so");
  assert.match(jobSrc, /const page = await printDirect\(win, html, deviceName, log\)/, "every other mode is the direct lane");
  assert.equal((jobSrc.match(/printThroughDriver\(/g) ?? []).length, 1, "exactly one driver-lane call site");
  assert.equal((jobSrc.match(/printDirect\(/g) ?? []).length, 1, "exactly one direct-lane call site");
  // Both lanes receive the SAME drawn document: the dispatch happens after
  // the paint proof, never before the load.
  assert.ok(jobSrc.indexOf("win.loadURL(") < jobSrc.indexOf('if (mode === "driver")'));
});

test("(D2) print-direct.ts: print media + device-scale emulation, one full-slip screenshot, debugger always detached", () => {
  assert.match(directSrc, /dbg\.attach\(CDP_PROTOCOL_VERSION\)/);
  assert.match(directSrc, /const CDP_PROTOCOL_VERSION = "1\.3"/);
  assert.match(directSrc, /"Emulation\.setEmulatedMedia",\s*\{\s*media:\s*CDP_MEDIA_PRINT\s*\}/, "@media print rules must apply exactly as in a browser print");
  assert.match(directSrc, /const CDP_MEDIA_PRINT = "print"/);
  // The scale IS the dot mapping: dots per CSS px, never a hardcoded factor.
  assert.match(directSrc, /const deviceScaleFactor = dots \/ cssWidth/);
  assert.match(directSrc, /"Emulation\.setDeviceMetricsOverride",\s*\{[\s\S]{0,160}?deviceScaleFactor,/);
  assert.ok(!/deviceScaleFactor:\s*\d/.test(directSrc), "the scale must never be a literal number");
  // One screenshot of the WHOLE slip — no banding, no capturePage.
  assert.match(directSrc, /"Page\.captureScreenshot",\s*\{[\s\S]{0,200}?captureBeyondViewport:\s*true/);
  assert.ok(!directSrc.includes("capturePage("), "capturePage returns DIP x OS scale (720px on a 125% display) — the protocol screenshot is the exact-dots path");
  assert.ok(!directSrc.includes("setZoomFactor("), "zoom does not change capture dimensions (measured) — never used here");
  // The debugger is released whatever happens.
  const finallyIdx = directSrc.indexOf("} finally {");
  const detachIdx = directSrc.indexOf("dbg.detach()");
  assert.ok(finallyIdx >= 0 && detachIdx > finallyIdx, "dbg.detach() must sit in the finally block");
  assert.match(directSrc, /if \(dbg\.isAttached\(\)\) dbg\.detach\(\)/);
  // Landmark: the lane really ends in the spooler with the raster bytes.
  assert.match(directSrc, /writeRawJob\(deviceName, PRINT_DOC_NAME, escposJob\(raster\)\)/);
  assert.match(directSrc, /export const PRINT_DOC_NAME = "POS slip"/);
  assert.match(directSrc, /dotsForPaperWidth\(pageWidthMicronsOf\(html\)\)/, "the dot width follows the slip's own @page width (80mm -> 576, 58mm -> 384)");
  assert.match(directSrc, /rasterizeBgra\(new Uint8Array\(image\.toBitmap\(\)\), width, height, dots\)/);
});

test("(D2) print-direct.ts: a foreign screenshot error never reaches the operator — logged bounded, surfaced as the not-ready sentence", () => {
  assert.match(directSrc, /if \(OWN_MESSAGES\.has\(reason\)\) throw error;/);
  assert.match(directSrc, /sanitizeFailureReason\(reason\)/);
  assert.match(directSrc, /throw new Error\(PRINT_NOT_READY_MESSAGE\);\s*\}\s*const image = nativeImage\.createFromBuffer\(png\)/);
  // The too-tall pre-check happens BEFORE the screenshot is requested.
  const preCheckIdx = directSrc.indexOf("> RASTER_MAX_ROWS) throw new Error(PRINT_TOO_LARGE_MESSAGE)");
  const shotIdx = directSrc.indexOf('"Page.captureScreenshot"');
  assert.ok(preCheckIdx >= 0 && shotIdx > preCheckIdx, "a slip that would outgrow one screenshot is refused before asking the compositor");
});

test("(D3) usableSlipCssWidth: the measured width wins when plausible; otherwise the cafe's own slip widths — parity-pinned to apps/cafe/lib/print.ts PAPER_WIDTH_CLASS", () => {
  assert.equal(usableSlipCssWidth(300, DOTS_80MM), 300);
  assert.equal(usableSlipCssWidth(210, DOTS_58MM), 210);
  assert.equal(usableSlipCssWidth(299.99, DOTS_80MM), 299.99, "a sub-pixel measurement is kept as measured");
  for (const bad of [0, 50, 5000, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.equal(usableSlipCssWidth(bad, DOTS_80MM), SLIP_CSS_PX_DEFAULT_80MM, `implausible ${bad} on 80mm -> the cafe's 80mm width`);
    assert.equal(usableSlipCssWidth(bad, DOTS_58MM), SLIP_CSS_PX_DEFAULT_58MM, `implausible ${bad} on 58mm -> the cafe's 58mm width`);
  }
  // Parity with the web app: its receipt root is `w-[300px]` on 80mm paper
  // and `w-[210px]` on 58mm. If the cafe changes those, the fallback here
  // must follow, or a slip with no measurable root prints at the wrong size.
  const cafePrintSrc = readFileSync(path.join(ROOT, "..", "cafe", "lib", "print.ts"), "utf8");
  const w80 = cafePrintSrc.match(/"80mm":\s*"w-\[(\d+)px\]"/);
  const w58 = cafePrintSrc.match(/"58mm":\s*"w-\[(\d+)px\]"/);
  assert.ok(w80 && w58, "the cafe's PAPER_WIDTH_CLASS must still carry both widths");
  assert.equal(Number(w80![1]), SLIP_CSS_PX_DEFAULT_80MM);
  assert.equal(Number(w58![1]), SLIP_CSS_PX_DEFAULT_58MM);
});

test("(D4) print.ts: the print method is stored, validated, defaulted to direct, echoed to the picker, and recorded on every job line", () => {
  assert.match(printSrc, /ipcMain\.handle\(PRINT_MODE_SAVE_CHANNEL,/);
  assert.match(printSrc, /if \(!isPrintMode\(mode\)\) throw new Error\(PRINT_REJECTED_MESSAGE\)/, "only the two known modes may be stored");
  assert.match(printSrc, /const effectiveMode = \(\): PrintMode => deps\.getPrintMode\(\) \?\? DEFAULT_PRINT_MODE/);
  assert.match(printSrc, /printMode:\s*effectiveMode\(\)/, "listPrinters must report the effective mode so the picker shows the truth");
  assert.match(printSrc, /runJob\(html, origin, deviceName, mode, deps\.log\)/);
  assert.match(printSrc, /mode=\$\{mode\}, page=\$\{page\}/, "the field log must say which lane printed and what page/raster it produced");
  assert.match(printSrc, /warmDirectPrint\(deps\.log\)/, "queue access is loaded at startup so a broken install is logged before the first slip");
  // shared.ts truth the handler leans on.
  assert.equal(DEFAULT_PRINT_MODE, "direct", "direct is the default — the driver lane cannot follow the content on the measured POS80");
  assert.deepEqual([...PRINT_MODES], ["direct", "driver"]);
  for (const ok of ["direct", "driver"]) assert.equal(isPrintMode(ok), true);
  for (const bad of ["DIRECT", "raster", "", null, undefined, 1]) assert.equal(isPrintMode(bad), false);
});

test("(D5) main.ts: the print method has a reader and a writer, and persist() re-reads it from disk like deviceName", () => {
  assert.match(mainSrc, /getPrintMode: \(\) => store\.printMode/);
  assert.match(mainSrc, /setPrintMode: \(mode: PrintMode\) => \{[\s\S]{0,200}?printMode: mode/);
  assert.match(mainSrc, /deviceName: onDisk\.deviceName, printMode: onDisk\.printMode, \.\.\.patch/, "a timer-driven persist() must not clobber a mode the picker just saved");
});

test("(D6) package.json: koffi is an exact pin and its platform binary is unpacked from the asar", () => {
  const deps = (pkg.dependencies ?? {}) as Record<string, string>;
  assert.equal(deps.koffi, "3.3.1", "koffi must be an exact version pin (a native module; no range operators)");
  assert.ok(!/[\^~<>]/.test(deps.koffi ?? "^"), "no range operator on koffi");
  const build = pkg.build as Record<string, unknown>;
  assert.deepEqual(build.asarUnpack, ["node_modules/@koromix/**"], "the prebuilt koffi.node lives in the @koromix platform package and must be a real file on disk, not an asar entry");
  // The binary that ships for the counter PC (x64) is really installed here.
  assert.ok(existsSync(path.join(ROOT, "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node")), "the win32_x64 koffi binary must be installed");
});

test("(D7) purity: escpos.ts and raw-spool.ts never import electron, and koffi is loaded lazily", () => {
  for (const [name, src] of [["escpos.ts", escposSrc], ["raw-spool.ts", rawSpoolSrc]] as const) {
    assert.ok(!/from "electron"/.test(src) && !/require\("electron"\)/.test(src), `${name} must stay electron-free`);
  }
  assert.ok(!/from "node:fs"/.test(escposSrc), "escpos.ts is pure bytes in, bytes out");
  assert.equal((rawSpoolSrc.match(/require\("koffi"\)/g) ?? []).length, 1, "koffi is required exactly once, lazily");
  assert.ok(!/^import koffi from "koffi"/m.test(rawSpoolSrc), "no top-level value import of koffi — the unit suite must never load the native module");
  // Landmarks.
  assert.ok(escposSrc.includes("export function escposJob("));
  assert.ok(rawSpoolSrc.includes("export function writeRawJob("));
});
