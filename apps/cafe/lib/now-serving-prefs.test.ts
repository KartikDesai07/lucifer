import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NOW_SERVING_PREFS_KEY,
  NOW_SERVING_PREFS_DEFAULTS,
  parseNowServingPrefs,
  readNowServingPrefs,
  writeNowServingPrefs,
  type NowServingPrefs,
} from "./now-serving-prefs";

// Print customization S9 — the Now Serving device preferences (language + voice on/off), driven from the plan's §2 B.
// Per-field fallback, never an object lookup (prototype keys), unknown keys dropped, storage failures swallowed.

const DEFAULTS = { language: "en", voice: true };

test("S9 prefs: the key and the defaults have the contract's values", () => {
  assert.equal(NOW_SERVING_PREFS_KEY, "pos.now-serving.v1");
  assert.deepEqual(NOW_SERVING_PREFS_DEFAULTS, DEFAULTS);
});

test("S9 prefs: a valid stored value is read back (landmark for every default case below)", () => {
  assert.deepEqual(parseNowServingPrefs('{"language":"hi","voice":false}'), { language: "hi", voice: false });
  assert.deepEqual(parseNowServingPrefs('{"language":"en","voice":true}'), { language: "en", voice: true });
});

test("S9 prefs: null, empty, bad JSON, array, number and JSON null all give the defaults", () => {
  for (const raw of [null, "", "not json", "[]", "42", "null", '"hi"', "true", "{"]) {
    assert.deepEqual(parseNowServingPrefs(raw), NOW_SERVING_PREFS_DEFAULTS, `raw ${String(raw)}`);
  }
});

test("S9 prefs: a bad language falls back to en while a valid voice:false survives", () => {
  for (const language of ["__proto__", "constructor", "toString", "hasOwnProperty", "fr", "EN", "", 5, null, ["hi"]]) {
    const out = parseNowServingPrefs(JSON.stringify({ language, voice: false }));
    assert.deepEqual(out, { language: "en", voice: false }, `language ${JSON.stringify(language)}`);
  }
});

test("S9 prefs: a bad voice falls back to true while a valid language hi survives", () => {
  for (const voice of ["true", "false", 1, 0, null, {}, []]) {
    const out = parseNowServingPrefs(JSON.stringify({ language: "hi", voice }));
    assert.deepEqual(out, { language: "hi", voice: true }, `voice ${JSON.stringify(voice)}`);
  }
  // Missing fields fall back per field too.
  assert.deepEqual(parseNowServingPrefs('{"language":"hi"}'), { language: "hi", voice: true });
  assert.deepEqual(parseNowServingPrefs('{"voice":false}'), { language: "en", voice: false });
  assert.deepEqual(parseNowServingPrefs("{}"), DEFAULTS);
});

test("S9 prefs: a literal __proto__ key in the JSON cannot smuggle a language in", () => {
  assert.deepEqual(parseNowServingPrefs('{"__proto__":{"language":"hi","voice":false}}'), DEFAULTS);
  assert.deepEqual(parseNowServingPrefs('{"constructor":{"language":"hi"},"language":"hi"}'), { language: "hi", voice: true });
});

test("S9 prefs: unknown keys are dropped - the result has exactly language and voice", () => {
  const out = parseNowServingPrefs('{"language":"hi","voice":false,"extra":1,"printerId":"abc","__proto__":{"x":1}}');
  assert.deepEqual(out, { language: "hi", voice: false });
  assert.deepEqual(Object.keys(out).sort(), ["language", "voice"]);
  assert.deepEqual(Object.keys(parseNowServingPrefs('{"junk":true}')).sort(), ["language", "voice"]);
});

// ---- localStorage access: a fake window installed per test and removed (or restored) after ----

type GlobalWithWindow = { window?: unknown };

function withWindow(win: unknown, run: () => void): void {
  const g = globalThis as unknown as GlobalWithWindow;
  const had = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: win, configurable: true, writable: true, enumerable: true });
  try {
    run();
  } finally {
    if (had) Object.defineProperty(globalThis, "window", had);
    else delete g.window;
  }
}

function withoutWindow(run: () => void): void {
  const had = Object.getOwnPropertyDescriptor(globalThis, "window");
  delete (globalThis as unknown as GlobalWithWindow).window;
  try {
    run();
  } finally {
    if (had) Object.defineProperty(globalThis, "window", had);
  }
}

interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function memoryStorage(initial: Record<string, string> = {}): FakeStorage & { calls: Array<[string, string]>; reads: string[] } {
  const data = new Map(Object.entries(initial));
  const calls: Array<[string, string]> = [];
  const reads: string[] = [];
  return {
    calls,
    reads,
    getItem(key) {
      reads.push(key);
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      calls.push([key, value]);
      data.set(key, value);
    },
  };
}

test("S9 prefs: readNowServingPrefs reads exactly the prefs key, and write then read round-trips", () => {
  const storage = memoryStorage({ [NOW_SERVING_PREFS_KEY]: '{"language":"hi","voice":false}', other: '{"language":"en","voice":true}' });
  withWindow({ localStorage: storage }, () => {
    assert.deepEqual(readNowServingPrefs(), { language: "hi", voice: false });
    assert.deepEqual(storage.reads, [NOW_SERVING_PREFS_KEY]);

    writeNowServingPrefs({ language: "en", voice: true });
    assert.deepEqual(readNowServingPrefs(), { language: "en", voice: true });
  });
});

test("S9 prefs: read gives the defaults when nothing is stored or the stored value is junk", () => {
  withWindow({ localStorage: memoryStorage() }, () => {
    assert.deepEqual(readNowServingPrefs(), NOW_SERVING_PREFS_DEFAULTS);
  });
  withWindow({ localStorage: memoryStorage({ [NOW_SERVING_PREFS_KEY]: "not json" }) }, () => {
    assert.deepEqual(readNowServingPrefs(), NOW_SERVING_PREFS_DEFAULTS);
  });
});

test("S9 prefs: a throwing getItem (or localStorage getter) gives the defaults", () => {
  const boom = { getItem: () => { throw new Error("denied"); }, setItem: () => undefined };
  withWindow({ localStorage: boom }, () => {
    assert.deepEqual(readNowServingPrefs(), NOW_SERVING_PREFS_DEFAULTS);
  });
  const blocked = {
    get localStorage(): FakeStorage {
      throw new Error("blocked");
    },
  };
  withWindow(blocked, () => {
    assert.deepEqual(readNowServingPrefs(), NOW_SERVING_PREFS_DEFAULTS);
    assert.doesNotThrow(() => writeNowServingPrefs({ language: "hi", voice: false }));
  });
});

test("S9 prefs: a throwing setItem does not make writeNowServingPrefs throw", () => {
  let attempted = 0;
  const full = {
    getItem: () => null,
    setItem: () => {
      attempted += 1;
      throw new Error("QuotaExceededError");
    },
  };
  withWindow({ localStorage: full }, () => {
    assert.doesNotThrow(() => writeNowServingPrefs({ language: "hi", voice: false }));
  });
  assert.equal(attempted, 1, "landmark: the write was really attempted");
});

test("S9 prefs: write stores JSON under exactly the key with exactly {language, voice}, even from an object with extra props", () => {
  const storage = memoryStorage();
  const sneaky = { language: "hi", voice: false, printerId: "abc", token: "secret" } as unknown as NowServingPrefs;
  withWindow({ localStorage: storage }, () => {
    writeNowServingPrefs(sneaky);
  });
  assert.equal(storage.calls.length, 1);
  const [key, value] = storage.calls[0];
  assert.equal(key, NOW_SERVING_PREFS_KEY);
  assert.deepEqual(JSON.parse(value), { language: "hi", voice: false });
  assert.deepEqual(Object.keys(JSON.parse(value) as object).sort(), ["language", "voice"]);
});

test("S9 prefs: with no window at all, read gives the defaults and write is a no-op", () => {
  withoutWindow(() => {
    assert.equal(typeof (globalThis as unknown as GlobalWithWindow).window, "undefined", "landmark: really no window");
    assert.deepEqual(readNowServingPrefs(), NOW_SERVING_PREFS_DEFAULTS);
    assert.doesNotThrow(() => writeNowServingPrefs({ language: "hi", voice: false }));
  });
});

test("S9 prefs: the test harness restored window (nothing leaks between tests)", () => {
  assert.equal(typeof (globalThis as unknown as GlobalWithWindow).window, "undefined");
});
