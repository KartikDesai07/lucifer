// Tables redesign Step 0 — the one-shot Tables floor -> New Order hand-off
// (lib/pos-table-handoff). The parser is pure; offer/take are exercised
// against a Map-backed fake sessionStorage installed on globalThis.window.

import { test } from "node:test";
import assert from "node:assert/strict";

import { TABLE_NO_MAX_LEN } from "@/lib/constants";
import {
  POS_TABLE_HANDOFF_KEY,
  POS_TABLE_HANDOFF_TTL_MS,
  offerPosTable,
  parsePosTableHandoff,
  takePosTableHandoff,
} from "@/lib/pos-table-handoff";

const NOW = 1_800_000_000_000;
const stamp = (tableNo: unknown, at: unknown): string => JSON.stringify({ tableNo, at });

// -- parsePosTableHandoff ---------------------------------------------------
test("parsePosTableHandoff: missing / empty / garbage / non-object input is null", () => {
  assert.equal(parsePosTableHandoff(null, NOW), null);
  assert.equal(parsePosTableHandoff("", NOW), null);
  assert.equal(parsePosTableHandoff("{not json", NOW), null);
  assert.equal(parsePosTableHandoff("undefined", NOW), null);
  assert.equal(parsePosTableHandoff('"T1"', NOW), null);
  assert.equal(parsePosTableHandoff("42", NOW), null);
  assert.equal(parsePosTableHandoff("true", NOW), null);
  assert.equal(parsePosTableHandoff("null", NOW), null);
  assert.equal(parsePosTableHandoff("{}", NOW), null);
  assert.equal(parsePosTableHandoff("[]", NOW), null);
});

test("parsePosTableHandoff: a valid entry inside the TTL returns the name (TTL bound inclusive, TTL+1 expired)", () => {
  assert.equal(POS_TABLE_HANDOFF_TTL_MS, 15_000, "landmark: TTL is 15s (review C-6: shorter window for an abandoned tap)");
  assert.equal(parsePosTableHandoff(stamp("T1", NOW), NOW), "T1", "age 0");
  assert.equal(parsePosTableHandoff(stamp("Window 2", NOW - 1000), NOW), "Window 2", "name with a space");
  assert.equal(parsePosTableHandoff(stamp("T1", NOW - POS_TABLE_HANDOFF_TTL_MS), NOW), "T1", "exactly the TTL");
  assert.equal(parsePosTableHandoff(stamp("T1", NOW - POS_TABLE_HANDOFF_TTL_MS - 1), NOW), null, "TTL + 1");
});

test("parsePosTableHandoff: a stamp from the future is rejected", () => {
  assert.equal(parsePosTableHandoff(stamp("T1", NOW + 1), NOW), null);
  assert.equal(parsePosTableHandoff(stamp("T1", NOW + POS_TABLE_HANDOFF_TTL_MS), NOW), null);
});

test("parsePosTableHandoff: invalid table names are rejected", () => {
  assert.equal(parsePosTableHandoff(stamp("", NOW), NOW), null, "empty");
  assert.equal(parsePosTableHandoff(stamp("a/b", NOW), NOW), null, "slash");
  assert.equal(parsePosTableHandoff(stamp("x".repeat(TABLE_NO_MAX_LEN + 1), NOW), NOW), null, "over the max length");
  assert.equal(parsePosTableHandoff(stamp(" T1", NOW), NOW), null, "leading space");
  assert.equal(parsePosTableHandoff(stamp(5, NOW), NOW), null, "non-string name");
  assert.equal(parsePosTableHandoff(stamp(null, NOW), NOW), null, "null name");
  // Vision guard: the same shape with a valid name of the max length IS accepted.
  assert.equal(TABLE_NO_MAX_LEN, 24, "landmark: max length is 24");
  assert.equal(parsePosTableHandoff(stamp("x".repeat(TABLE_NO_MAX_LEN), NOW), NOW), "x".repeat(TABLE_NO_MAX_LEN));
});

test("parsePosTableHandoff: a non-number / NaN / Infinity stamp is rejected", () => {
  assert.equal(parsePosTableHandoff(stamp("T1", String(NOW)), NOW), null, "numeric string");
  assert.equal(parsePosTableHandoff(stamp("T1", null), NOW), null, "null (how JSON stores NaN / Infinity)");
  assert.equal(parsePosTableHandoff('{"tableNo":"T1"}', NOW), null, "absent");
  assert.equal(parsePosTableHandoff(stamp("T1", true), NOW), null, "boolean");
  // JSON.stringify writes NaN / Infinity as null; a hand-written literal is invalid JSON.
  assert.equal(parsePosTableHandoff('{"tableNo":"T1","at":NaN}', NOW), null, "NaN literal");
  assert.equal(parsePosTableHandoff('{"tableNo":"T1","at":1e999}', NOW), null, "1e999 parses to Infinity");
  assert.equal(parsePosTableHandoff('{"tableNo":"T1","at":-1e999}', NOW), null, "-Infinity");
});

// -- offer / take over a fake window.sessionStorage ------------------------
interface FakeStore {
  map: Map<string, string>;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

function fakeStore(): FakeStore {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    },
  };
}

const globalWithWindow = globalThis as { window?: unknown };

/** Installs a fake window for the body and ALWAYS restores the previous one. */
function withWindow(storage: unknown, body: () => void): void {
  const had = "window" in globalWithWindow;
  const previous = globalWithWindow.window;
  globalWithWindow.window = { sessionStorage: storage };
  try {
    body();
  } finally {
    if (had) globalWithWindow.window = previous;
    else delete globalWithWindow.window;
  }
}

test("offer then take returns the name, and the key is removed after take (second take is null)", () => {
  const { map, storage } = fakeStore();
  withWindow(storage, () => {
    offerPosTable("T1", NOW);
    assert.ok(map.has(POS_TABLE_HANDOFF_KEY), "landmark: offer wrote the key");
    assert.equal(takePosTableHandoff(NOW + 1000), "T1");
    assert.equal(map.has(POS_TABLE_HANDOFF_KEY), false, "removed by take");
    assert.equal(takePosTableHandoff(NOW + 1000), null, "a refresh / second mount never re-applies it");
  });
});

test("take of an expired entry returns null AND removes it", () => {
  const { map, storage } = fakeStore();
  withWindow(storage, () => {
    offerPosTable("T1", NOW);
    assert.ok(map.has(POS_TABLE_HANDOFF_KEY), "landmark: offer wrote the key");
    assert.equal(takePosTableHandoff(NOW + POS_TABLE_HANDOFF_TTL_MS + 1), null);
    assert.equal(map.has(POS_TABLE_HANDOFF_KEY), false, "expired entry is still removed");
  });
});

test("take of a garbage entry returns null and removes it", () => {
  const { map, storage } = fakeStore();
  withWindow(storage, () => {
    map.set(POS_TABLE_HANDOFF_KEY, "{oops");
    assert.equal(takePosTableHandoff(NOW), null);
    assert.equal(map.has(POS_TABLE_HANDOFF_KEY), false);
  });
});

test("take with nothing offered is null", () => {
  const { storage } = fakeStore();
  withWindow(storage, () => assert.equal(takePosTableHandoff(NOW), null));
});

test("offer of an invalid name writes nothing", () => {
  const { map, storage } = fakeStore();
  withWindow(storage, () => {
    offerPosTable("", NOW);
    offerPosTable("a/b", NOW);
    offerPosTable("x".repeat(TABLE_NO_MAX_LEN + 1), NOW);
    offerPosTable(" T1", NOW);
    assert.equal(map.size, 0);
    // Vision guard: a valid name through the same fake DOES write.
    offerPosTable("T1", NOW);
    assert.equal(map.size, 1);
  });
});

test("a sessionStorage whose methods throw: offer does not throw, take returns null", () => {
  const boom = (): never => {
    throw new Error("blocked");
  };
  const throwing = { getItem: boom, setItem: boom, removeItem: boom };
  withWindow(throwing, () => {
    assert.doesNotThrow(() => offerPosTable("T1", NOW));
    assert.equal(takePosTableHandoff(NOW), null);
  });
});

test("no window at all (server render / blocked storage): offer does not throw, take returns null", () => {
  const had = "window" in globalWithWindow;
  const previous = globalWithWindow.window;
  delete globalWithWindow.window;
  try {
    assert.doesNotThrow(() => offerPosTable("T1", NOW));
    assert.equal(takePosTableHandoff(NOW), null);
  } finally {
    if (had) globalWithWindow.window = previous;
  }
});
