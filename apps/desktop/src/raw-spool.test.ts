// Raw-source pins (readFileSync, never import) for raw-spool.ts -- importing
// it would `require("koffi")` on first loadSpooler() call and load the native
// module inside this unit-test process, and this suite must NEVER touch a
// real printer. Negative pins (something must be ABSENT) are paired with a
// positive landmark per testing.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.join(__dirname, "raw-spool.ts"), "utf8");

// -- lazy require, no top-level koffi import ---------------------------------
test("koffi is required lazily inside loadSpooler(), never imported at module top level", () => {
  const requireCalls = src.match(/require\(("|')koffi\1\)/g) ?? [];
  assert.equal(requireCalls.length, 1, `expected exactly one require("koffi"), found: ${JSON.stringify(requireCalls)}`);
  assert.ok(!/^import koffi from "koffi";/m.test(src), 'must not have a top-level "import koffi from "koffi""');
  // A type-only import is fine -- it is erased at runtime.
  assert.match(src, /import type Koffi from "koffi";/);
  // Landmark: the require call is really inside loadSpooler(), not floating.
  const loadFnIdx = src.indexOf("export function loadSpooler(");
  const requireIdx = src.indexOf('require("koffi")');
  assert.ok(loadFnIdx >= 0 && requireIdx > loadFnIdx, "require(\"koffi\") must be inside loadSpooler()");
});

// -- datatype literal ---------------------------------------------------------
test("RAW_SPOOL_DATATYPE is exactly \"RAW\" and reaches StartDocPrinterW via pDatatype", () => {
  assert.match(src, /export const RAW_SPOOL_DATATYPE = "RAW";/);
  assert.match(src, /pDatatype:\s*RAW_SPOOL_DATATYPE/, "the constant must actually be passed as pDatatype, not a re-typed literal");
});

// -- every winspool/kernel32 function is declared AND called ----------------
test("every winspool/kernel32 function is declared (koffi.func) and called at least once", () => {
  const names = [
    "OpenPrinterW",
    "StartDocPrinterW",
    "StartPagePrinter",
    "WritePrinter",
    "EndPagePrinter",
    "EndDocPrinter",
    "ClosePrinter",
    "AbortPrinter",
  ];
  for (const name of names) {
    const declareRe = new RegExp(`${name}:\\s*winspool\\.func\\(`);
    assert.match(src, declareRe, `${name} must be declared via winspool.func(`);
    // "Called" means invoked through the spool.<Name>( handle, i.e. a call
    // site distinct from the declaration inside the spooler object literal.
    const callRe = new RegExp(`spool\\.${name}\\(`);
    assert.match(src, callRe, `${name} must be called as spool.${name}(`);
  }
  assert.match(src, /GetLastError:\s*kernel32\.func\(/);
  assert.match(src, /spool\.GetLastError\(\)/);
});

// -- ClosePrinter in finally, AbortPrinter on the failure path ---------------
test("ClosePrinter( appears inside a finally block", () => {
  const finallyIdx = src.indexOf("} finally {");
  assert.ok(finallyIdx >= 0, "expected a finally block");
  const finallyBody = src.slice(finallyIdx, src.indexOf("\n}", finallyIdx));
  assert.match(finallyBody, /spool\.ClosePrinter\(hPrinter\);/);
  // Landmark: ClosePrinter is declared too (not just called in a stray string).
  assert.match(src, /ClosePrinter:\s*winspool\.func\(/);
});

test("AbortPrinter( is on the failure path -- inside a catch block, before a rethrow", () => {
  const catchIdx = src.indexOf("} catch (error) {");
  assert.ok(catchIdx >= 0, "expected a catch (error) block");
  const catchBody = src.slice(catchIdx, src.indexOf("\n    }", catchIdx));
  const abortIdx = catchBody.indexOf("spool.AbortPrinter(hPrinter);");
  const rethrowIdx = catchBody.indexOf("throw error;");
  assert.ok(abortIdx >= 0, "AbortPrinter must be called inside the catch block");
  assert.ok(rethrowIdx > abortIdx, "AbortPrinter must run BEFORE the rethrow");
});

// -- chunking -----------------------------------------------------------------
test("writes are chunked with RAW_SPOOL_CHUNK_BYTES and the written count is compared to the chunk length", () => {
  assert.match(src, /export const RAW_SPOOL_CHUNK_BYTES = 64 \* 1024;/);
  assert.match(src, /offset \+= RAW_SPOOL_CHUNK_BYTES/, "the write loop must step by RAW_SPOOL_CHUNK_BYTES");
  assert.match(src, /subarray\(offset,\s*offset \+ RAW_SPOOL_CHUNK_BYTES\)/, "each chunk must be sliced to RAW_SPOOL_CHUNK_BYTES");
  assert.match(src, /written\[0\]\s*!==\s*chunk\.length/, "the written count must be compared against the chunk length");
});

// -- GetLastError read immediately after each failing call -------------------
test("GetLastError is read straight after the failing call, once per failure site", () => {
  // Every occurrence of the literal read must be immediately preceded by an
  // `if (` condition (an `if (!spool.X(...))` or `if (jobId === 0)` guard) --
  // i.e. GetLastError is the FIRST statement of the failure branch, not read
  // later after some other FFI call had a chance to overwrite the last error.
  const readLiteral = "const code = spool.GetLastError();";
  const readPattern = new RegExp(readLiteral.replace(/[.()]/g, "\\$&"), "g");
  const sites = src.match(readPattern) ?? [];
  assert.equal(sites.length, 6, `expected exactly 6 GetLastError-read sites, found ${sites.length}`);

  let m: RegExpExecArray | null;
  const scanRe = new RegExp(readPattern.source, "g");
  let checked = 0;
  while ((m = scanRe.exec(src)) !== null) {
    const before = src.slice(Math.max(0, m.index - 80), m.index);
    assert.match(before, /if \([^{]*\)\s*\{\s*$/, `GetLastError read at index ${m.index} must be the first statement right after an if ( guard: ${JSON.stringify(before)}`);
    checked++;
  }
  assert.equal(checked, 6);

  // Landmark: the short-write failure (no Win32 code involved) does NOT read
  // GetLastError -- proves the pattern above isn't matching everything blindly.
  assert.match(src, /if \(written\[0\] !== chunk\.length\) throw new Error\(SPOOL_SHORT_WRITE_MESSAGE\);/);
});

// -- messages: ASCII, period-terminated, no console, no electron -------------
function extractStringConst(source: string, name: string): string {
  const re = new RegExp(`export const ${name} =\\s*\\n?\\s*"([^"]*)"\\s*;`);
  const m = source.match(re);
  assert.ok(m, `expected to find "export const ${name} = \\"...\\";" in raw-spool.ts`);
  return m![1]!;
}

test("every exported *_MESSAGE constant is plain ASCII English ending in a period", () => {
  const names = [
    "SPOOL_UNAVAILABLE_MESSAGE",
    "SPOOL_PRINTER_NOT_FOUND_MESSAGE",
    "SPOOL_ACCESS_DENIED_MESSAGE",
    "SPOOL_SHORT_WRITE_MESSAGE",
  ];
  const messages = names.map((n) => extractStringConst(src, n));
  for (const [i, msg] of messages.entries()) {
    assert.ok(msg.endsWith("."), `${names[i]} must end in a period: ${JSON.stringify(msg)}`);
    assert.ok(/^[A-Za-z0-9 .,:'?!()-]+$/.test(msg), `${names[i]} must be plain ASCII English: ${JSON.stringify(msg)}`);
  }
  const distinctSet = new Set(messages);
  assert.equal(distinctSet.size, messages.length, "all *_MESSAGE constants must be pairwise distinct");
  // SPOOL_FAILED_PREFIX is a prefix, not a full sentence -- checked separately.
  assert.match(src, /export const SPOOL_FAILED_PREFIX = "Printing failed: Windows error ";/);
});

test("the module never logs and never imports electron", () => {
  const consoleCallPattern = new RegExp("console" + "\\.[a-zA-Z]+\\s*\\(");
  assert.ok(!consoleCallPattern.test(src), "raw-spool.ts must never call console.*");
  assert.ok(!src.includes('from "electron"'), 'raw-spool.ts must never import "electron"');
  assert.ok(!src.includes("require(\"electron\")"), 'raw-spool.ts must never require "electron"');
  // Landmarks: the file really was read with real content.
  assert.ok(src.includes("export function writeRawJob("));
  assert.ok(src.includes("export function loadSpooler("));
});

// -- error-code mapping --------------------------------------------------------
test("error codes 1801 and 5 map to their curated messages via messageForWin32", () => {
  assert.match(src, /export const WIN32_ERROR_ACCESS_DENIED = 5;/);
  assert.match(src, /export const WIN32_ERROR_INVALID_PRINTER_NAME = 1801;/);

  const fnIdx = src.indexOf("function messageForWin32(");
  assert.ok(fnIdx >= 0, "expected a messageForWin32 helper");
  const fnBody = src.slice(fnIdx, src.indexOf("\n}", fnIdx));

  assert.match(
    fnBody,
    /if \(code === WIN32_ERROR_INVALID_PRINTER_NAME\) return SPOOL_PRINTER_NOT_FOUND_MESSAGE;/,
    "1801 must map to SPOOL_PRINTER_NOT_FOUND_MESSAGE",
  );
  assert.match(
    fnBody,
    /if \(code === WIN32_ERROR_ACCESS_DENIED\) return SPOOL_ACCESS_DENIED_MESSAGE;/,
    "5 must map to SPOOL_ACCESS_DENIED_MESSAGE",
  );
  // Landmark: a third, fallback case exists too (proves the two cases above
  // are a real branch, not the whole function body).
  assert.match(fnBody, /return `\$\{SPOOL_FAILED_PREFIX\}\$\{code\}`;/);
});

// -- input validation ----------------------------------------------------------
test("writeRawJob validates printerName and data before any FFI call", () => {
  const fnIdx = src.indexOf("export function writeRawJob(");
  const firstFfiCallIdx = src.indexOf("loadSpooler()", fnIdx);
  const validationBlock = src.slice(fnIdx, firstFfiCallIdx);
  assert.match(validationBlock, /throw new RangeError/);
  assert.match(validationBlock, /printerName\.length === 0/);
  assert.match(validationBlock, /data\.length === 0/);
});
