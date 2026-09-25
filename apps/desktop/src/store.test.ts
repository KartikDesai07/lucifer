// Pins for src/store.ts -- pure module (node:fs + node:path only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_STORE,
  STORE_FILE_NAME,
  normalizeStore,
  readStore,
  writeStore,
  type ShellStore,
} from "./store";

const DEFAULT_KEYS = ["serverOrigin", "deviceName", "autoStart", "windowBounds", "printMode"] as const;

test("DEFAULT_STORE: all five fields are null", () => {
  assert.deepEqual(DEFAULT_STORE, {
    serverOrigin: null,
    deviceName: null,
    autoStart: null,
    windowBounds: null,
    printMode: null,
  });
});

test("STORE_FILE_NAME landmark", () => {
  assert.equal(STORE_FILE_NAME, "pos-desktop.json");
});

for (const bad of [null, undefined, 42, "x", []]) {
  test(`normalizeStore: ${JSON.stringify(bad)} -> DEFAULT_STORE`, () => {
    assert.deepEqual(normalizeStore(bad), DEFAULT_STORE);
  });
}

test("normalizeStore: unknown keys are dropped, output keys deep-equal the five", () => {
  const result = normalizeStore({
    serverOrigin: null,
    deviceName: null,
    autoStart: null,
    windowBounds: null,
    printMode: null,
    extraJunkKey: "should not survive",
    another: { nested: true },
  });
  assert.deepEqual(Object.keys(result).sort(), [...DEFAULT_KEYS].sort());
  assert.equal(Object.prototype.hasOwnProperty.call(result, "extraJunkKey"), false);
});

test("normalizeStore: __proto__ in JSON.parse input produces a clean object", () => {
  // JSON.parse("{\"__proto__\": ...}") creates an own enumerable "__proto__"
  // data property (it does NOT poison the prototype) -- normalizeStore must
  // not copy it through, and the result must not have gained anything on
  // its actual prototype chain either.
  const raw = JSON.parse('{"__proto__": {"polluted": true}, "serverOrigin": null}') as unknown;
  const result = normalizeStore(raw);
  assert.deepEqual(Object.keys(result).sort(), [...DEFAULT_KEYS].sort());
  assert.equal((result as unknown as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
});

test("normalizeStore: wrong-typed fields fall back to DEFAULT per-field (not whole-object)", () => {
  const result = normalizeStore({
    serverOrigin: 123,
    deviceName: 456,
    autoStart: "yes",
    windowBounds: "nope",
    printMode: 7,
  });
  assert.deepEqual(result, DEFAULT_STORE);
});

// The print method (2026-09-19): only the two known lanes are stored; a typo,
// a different case, or a value from a newer/older build reads as "never
// chosen" so the shell's default ("direct") applies.
for (const mode of ["direct", "driver"]) {
  test(`normalizeStore: printMode ${JSON.stringify(mode)} survives`, () => {
    assert.equal(normalizeStore({ printMode: mode }).printMode, mode);
  });
}
for (const bad of ["DIRECT", "raster", "", " direct", true, 1]) {
  test(`normalizeStore: printMode ${JSON.stringify(bad)} -> null`, () => {
    assert.equal(normalizeStore({ printMode: bad }).printMode, null);
  });
}

test("normalizeStore: serverOrigin is re-validated -- http remote host -> null", () => {
  const result = normalizeStore({ serverOrigin: "http://my-pos.example.com" });
  assert.equal(result.serverOrigin, null);
});

test("normalizeStore: serverOrigin is re-validated -- https with a path -> stored origin only", () => {
  const result = normalizeStore({ serverOrigin: "https://my-pos.example.com/pos?x=1" });
  assert.equal(result.serverOrigin, "https://my-pos.example.com");
});

test("normalizeStore: autoStart false survives (not coerced to null)", () => {
  const result = normalizeStore({ autoStart: false });
  assert.equal(result.autoStart, false);
});

test("normalizeStore: autoStart true survives", () => {
  const result = normalizeStore({ autoStart: true });
  assert.equal(result.autoStart, true);
});

test("normalizeStore: partial windowBounds (missing a key) -> null", () => {
  const result = normalizeStore({ windowBounds: { x: 0, y: 0, width: 800 } });
  assert.equal(result.windowBounds, null);
});

test("normalizeStore: NaN in windowBounds -> null", () => {
  const result = normalizeStore({ windowBounds: { x: 0, y: 0, width: NaN, height: 600 } });
  assert.equal(result.windowBounds, null);
});

test("normalizeStore: non-integer (fractional) windowBounds -> null", () => {
  const result = normalizeStore({ windowBounds: { x: 0, y: 0, width: 800.5, height: 600 } });
  assert.equal(result.windowBounds, null);
});

test("normalizeStore: Infinity in windowBounds -> null", () => {
  const result = normalizeStore({ windowBounds: { x: 0, y: 0, width: Infinity, height: 600 } });
  assert.equal(result.windowBounds, null);
});

test("normalizeStore: valid integer windowBounds survive intact", () => {
  const bounds = { x: 10, y: 20, width: 800, height: 600 };
  const result = normalizeStore({ windowBounds: bounds });
  assert.deepEqual(result.windowBounds, bounds);
});

test("normalizeStore: deviceName empty string -> null", () => {
  const result = normalizeStore({ deviceName: "" });
  assert.equal(result.deviceName, null);
});

test("normalizeStore: deviceName non-empty string survives", () => {
  const result = normalizeStore({ deviceName: "Kitchen Printer" });
  assert.equal(result.deviceName, "Kitchen Printer");
});

// --- tmp-dir round trip (readStore/writeStore against a real filesystem) ---

test("readStore/writeStore round trip via a tmp dir", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "pos-desktop-store-test-"));
  const file = path.join(dir, STORE_FILE_NAME);

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  await t.test("missing file -> DEFAULT_STORE", () => {
    assert.deepEqual(readStore(file), DEFAULT_STORE);
  });

  await t.test("write then read returns an equal store", () => {
    const store: ShellStore = {
      serverOrigin: "https://my-pos.example.com",
      deviceName: "Kitchen Printer",
      autoStart: true,
      windowBounds: { x: 10, y: 20, width: 800, height: 600 },
      printMode: "driver",
    };
    writeStore(file, store);
    const readBack = readStore(file);
    assert.deepEqual(readBack, store);
  });

  await t.test("corrupt JSON on disk -> DEFAULT_STORE", () => {
    writeFileSync(file, "{ this is not valid JSON");
    assert.deepEqual(readStore(file), DEFAULT_STORE);
  });

  await t.test("no leftover .tmp file after a successful write", () => {
    const store: ShellStore = { ...DEFAULT_STORE, deviceName: "Final Write" };
    writeStore(file, store);
    const leftoverTmp = readdirSync(dir).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftoverTmp, []);
    assert.equal(existsSync(file), true);
    // Landmark: the file really was rewritten (vision-guard for the "no .tmp
    // left" negative pin above -- prove the positive write succeeded too).
    assert.equal(JSON.parse(readFileSync(file, "utf8")).deviceName, "Final Write");
  });
});
