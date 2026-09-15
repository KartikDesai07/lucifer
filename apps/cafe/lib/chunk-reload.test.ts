// Deploy-skew recovery (2026-09-11, owner: "the app sometimes does not load
// properly") — lib/chunk-reload.ts is pure and node-testable: no React, no
// DOM beyond the injected store. This suite drives the REAL module (not a
// re-implementation) over a fake store, and pins the two error boundaries
// (app/(dashboard)/error.tsx, app/global-error.tsx) that call it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  armChunkReload,
  chunkReloadStore,
  CHUNK_RELOAD_COOLDOWN_MS,
  isChunkLoadError,
  type ChunkReloadStore,
} from "@/lib/chunk-reload";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const DASHBOARD_ERROR = "apps/cafe/app/(dashboard)/error.tsx";
const GLOBAL_ERROR = "apps/cafe/app/global-error.tsx";

// ── isChunkLoadError ─────────────────────────────────────────────────────────

test("chunk-reload: isChunkLoadError is true for a ChunkLoadError-named error and for every documented message shape", () => {
  assert.ok(isChunkLoadError({ name: "ChunkLoadError" }), "an error whose name is exactly ChunkLoadError must match");

  const messages = [
    "Loading chunk 123 failed",
    "Failed to fetch dynamically imported module",
    "Importing a module script failed",
    "error loading dynamically imported module",
  ];
  for (const message of messages) {
    assert.ok(
      isChunkLoadError({ message }),
      `an error with message ${JSON.stringify(message)} must be treated as a chunk-load error`,
    );
  }
});

test("chunk-reload: isChunkLoadError is false for a plain Error, null, a string, and an object with a non-matching message", () => {
  assert.equal(isChunkLoadError(new Error("something else broke")), false, "a plain Error with an unrelated message must not match");
  assert.equal(isChunkLoadError(null), false, "null must not match");
  assert.equal(isChunkLoadError("ChunkLoadError"), false, "a bare string must not match — only an object shape is inspected");
  assert.equal(
    isChunkLoadError({ name: "TypeError", message: "cannot read properties of undefined" }),
    false,
    "an object whose name/message match neither pattern must not match",
  );
});

// ── armChunkReload ───────────────────────────────────────────────────────────

function fakeChunkStore(opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}): ChunkReloadStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => {
      if (opts.throwOnGet) throw new Error("storage disabled");
      return map.has(k) ? (map.get(k) as string) : null;
    },
    setItem: (k: string, v: string) => {
      if (opts.throwOnSet) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
  };
}

test("chunk-reload: armChunkReload returns false for a null store, without touching anything", () => {
  assert.equal(armChunkReload(null, Date.now()), false, "a null store must never permit a reload");
});

test("chunk-reload: armChunkReload on an empty store returns true and records the current time", () => {
  const store = fakeChunkStore();
  const now = Date.now();
  assert.equal(armChunkReload(store, now), true, "a store with no recorded reload must permit exactly one");
  assert.equal(store.map.get("pos.chunk-reload.v1"), String(now), "the decision must be recorded under the flag key with the given `now`");
});

test("chunk-reload: a second call within CHUNK_RELOAD_COOLDOWN_MS returns false; a call after the cooldown returns true again", () => {
  const store = fakeChunkStore();
  const first = Date.now();
  assert.equal(armChunkReload(store, first), true, "the first call must permit a reload");

  const withinCooldown = first + CHUNK_RELOAD_COOLDOWN_MS - 1;
  assert.equal(
    armChunkReload(store, withinCooldown),
    false,
    "a second failure inside the cooldown window must NOT permit another reload — the first reload did not help",
  );

  const afterCooldown = first + CHUNK_RELOAD_COOLDOWN_MS + 1;
  assert.equal(
    armChunkReload(store, afterCooldown),
    true,
    "a failure after the cooldown has elapsed must permit a reload again",
  );
  assert.equal(store.map.get("pos.chunk-reload.v1"), String(afterCooldown), "the later timestamp must overwrite the recorded one");
});

test("chunk-reload: armChunkReload returns false when the store's getItem throws", () => {
  const store = fakeChunkStore({ throwOnGet: true });
  assert.equal(armChunkReload(store, Date.now()), false, "a throwing getItem must never permit a reload — a loop is worse than a manual reload button");
});

test("chunk-reload: armChunkReload returns false when the store's setItem throws", () => {
  const store = fakeChunkStore({ throwOnSet: true });
  assert.equal(armChunkReload(store, Date.now()), false, "a throwing setItem must never permit a reload");
});

// ── chunkReloadStore ─────────────────────────────────────────────────────────

test("chunk-reload: chunkReloadStore is null with no window (server render) and reaches window.sessionStorage when present", () => {
  assert.equal(typeof globalThis.window, "undefined", "precondition: this test env has no window");
  assert.equal(chunkReloadStore(), null, "with no window, chunkReloadStore must return null");

  const store = fakeChunkStore();
  (globalThis as { window?: unknown }).window = { sessionStorage: store } as unknown as Window & typeof globalThis;
  try {
    assert.equal(chunkReloadStore(), store, "chunkReloadStore must reach window.sessionStorage specifically — the flag is per-TAB, unlike the device-scoped masters blob");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
  assert.equal(typeof globalThis.window, "undefined", "window must be restored for the suites that follow");
});

// ── CHUNK_RELOAD_COOLDOWN_MS sanity ─────────────────────────────────────────

test("chunk-reload: CHUNK_RELOAD_COOLDOWN_MS is a sane integer between 10s and 5min", () => {
  assert.ok(Number.isInteger(CHUNK_RELOAD_COOLDOWN_MS), "CHUNK_RELOAD_COOLDOWN_MS must be an integer");
  assert.ok(
    CHUNK_RELOAD_COOLDOWN_MS >= 10_000 && CHUNK_RELOAD_COOLDOWN_MS <= 5 * 60 * 1000,
    `CHUNK_RELOAD_COOLDOWN_MS must be between 10s and 5min, got ${CHUNK_RELOAD_COOLDOWN_MS}`,
  );
});

// ── source pins: both error boundaries wire the module correctly ───────────

test("PIN: app/(dashboard)/error.tsx and app/global-error.tsx each import armChunkReload/chunkReloadStore/isChunkLoadError from @/lib/chunk-reload, call armChunkReload(chunkReloadStore(), Date.now()) inside a useEffect(, and call window.location.reload()", () => {
  for (const rel of [DASHBOARD_ERROR, GLOBAL_ERROR]) {
    const src = stripComments(readSrc(rel));

    assert.match(
      src,
      /import \{ armChunkReload, chunkReloadStore, isChunkLoadError \} from "@\/lib\/chunk-reload";/,
      `${rel} must import armChunkReload, chunkReloadStore and isChunkLoadError from @/lib/chunk-reload`,
    );

    const effectIdx = src.indexOf("useEffect(");
    assert.ok(effectIdx >= 0, `${rel} must contain a useEffect(`);
    const armIdx = mustIndexOf(src, "armChunkReload(chunkReloadStore(), Date.now())", rel);
    assert.ok(
      armIdx > effectIdx,
      `${rel} must call armChunkReload(chunkReloadStore(), Date.now()) INSIDE a useEffect( — calling it during render would re-run on every re-render`,
    );

    assert.match(src, /window\.location\.reload\(\)/, `${rel} must call window.location.reload() when armed`);
  }
});

test("PIN: global-error.tsx still contains min-h-screen (positive landmark shared with another suite's layout pin)", () => {
  const src = readSrc(GLOBAL_ERROR);
  assert.ok(src.length > 300, `positive landmark: ${GLOBAL_ERROR} must have been read (got ${src.length} bytes)`);
  assert.ok(
    src.includes("min-h-screen"),
    `${GLOBAL_ERROR} must still contain min-h-screen — this file replaces the root layout entirely, so it must re-establish full-viewport sizing itself`,
  );
});

function mustIndexOf(src: string, needle: string, label: string): number {
  const idx = src.indexOf(needle);
  assert.ok(idx >= 0, `${label}: could not find ${JSON.stringify(needle)}`);
  return idx;
}
