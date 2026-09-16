import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

import {
  readCart,
  writeCart,
  clearCart,
  readIdentity,
  writeIdentity,
  clearIdentity,
  pushMyCode,
  readMyCodes,
  readLastMenuPath,
  writeLastMenuPath,
  readRefreshAt,
  writeRefreshAt,
  readTheme,
  writeTheme,
  readMenuCache,
  writeMenuCache,
  clearDinerData,
  DINER_OWNED_KEYS,
  type CartLine,
} from "@/components/public/public-cart-store";

// public-cart-store.ts is SSR-safe (typeof window === "undefined" guards
// every read/write) — a node:test process has no window at all, so these
// tests stub the minimal Web Storage surface the module actually calls.
class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  // FIX5 — clearIdentity's safeRemove calls this; without it the call would
  // throw (swallowed by safeRemove's own try/catch), silently no-op-ing every
  // clearIdentity test rather than actually exercising the removal.
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

function withWindow(fn: (storage: FakeStorage) => void): void {
  const storage = new FakeStorage();
  (globalThis as unknown as Record<string, unknown>).window = { localStorage: storage };
  try {
    fn(storage);
  } finally {
    delete (globalThis as unknown as Record<string, unknown>).window;
  }
}

const LINE: CartLine = {
  lineId: "p1|Small|,|",
  productId: "p1",
  name: "Tea",
  price: 20,
  qty: 2,
  modifiers: [],
};

test("readCart returns [] when nothing has been written yet", () => {
  withWindow(() => {
    assert.deepEqual(readCart(), []);
  });
});

test("writeCart then readCart round-trips exactly", () => {
  withWindow(() => {
    writeCart([LINE]);
    assert.deepEqual(readCart(), [LINE]);
  });
});

test("readCart tolerates corrupt JSON — returns [] rather than throwing", () => {
  withWindow((storage) => {
    storage.setItem("pos.public.cart.v1", "{not json");
    assert.doesNotThrow(() => readCart());
    assert.deepEqual(readCart(), []);
  });
});

test("clearCart empties a previously-written cart", () => {
  withWindow(() => {
    writeCart([LINE]);
    clearCart();
    assert.deepEqual(readCart(), []);
  });
});

test("readIdentity returns null when absent, and round-trips writeIdentity", () => {
  withWindow(() => {
    assert.equal(readIdentity(), null);
    writeIdentity({ mobile: "9876543210", name: "Asha" });
    assert.deepEqual(readIdentity(), { mobile: "9876543210", name: "Asha" });
  });
});

test("readIdentity tolerates corrupt JSON — returns null rather than throwing", () => {
  withWindow((storage) => {
    storage.setItem("pos.public.me.v1", "]]]not json");
    assert.doesNotThrow(() => readIdentity());
    assert.equal(readIdentity(), null);
  });
});

// FIX5 — the "Not you? Clear" affordance's storage half.
test("clearIdentity wipes a previously-written identity — readIdentity returns null again", () => {
  withWindow(() => {
    writeIdentity({ mobile: "9876543210", name: "Asha" });
    clearIdentity();
    assert.equal(readIdentity(), null);
  });
});

test("clearIdentity on an already-empty store is a no-op, not a throw", () => {
  withWindow(() => {
    assert.doesNotThrow(() => clearIdentity());
    assert.equal(readIdentity(), null);
  });
});

test("pushMyCode is most-recent-first", () => {
  withWindow(() => {
    pushMyCode("AAAAAAAAA1");
    pushMyCode("BBBBBBBBB2");
    assert.deepEqual(readMyCodes(), ["BBBBBBBBB2", "AAAAAAAAA1"]);
  });
});

// CR2.6 — the "Order more" link's stored menu path.
test("readLastMenuPath returns null when nothing has been written yet", () => {
  withWindow(() => {
    assert.equal(readLastMenuPath(), null);
  });
});

test("writeLastMenuPath then readLastMenuPath round-trips exactly", () => {
  withWindow(() => {
    writeLastMenuPath("/m/0123456789ABCD");
    assert.equal(readLastMenuPath(), "/m/0123456789ABCD");
  });
});

test("pushMyCode caps the history at 20, most-recent-first, dropping the oldest", () => {
  withWindow(() => {
    for (let i = 0; i < 25; i++) {
      pushMyCode(`CODE${i.toString().padStart(5, "0")}`);
    }
    const codes = readMyCodes();
    assert.equal(codes.length, 20);
    assert.equal(codes[0], "CODE00024"); // most recently pushed
    assert.equal(codes[19], "CODE00005"); // oldest kept (00000-00004 dropped)
  });
});

// SLICE 10 — refresh timestamps.
test("readRefreshAt returns null when nothing has been written yet", () => {
  withWindow(() => {
    assert.equal(readRefreshAt("AAAAAAAAA1"), null);
  });
});

test("writeRefreshAt then readRefreshAt round-trips exactly", () => {
  withWindow(() => {
    writeRefreshAt("AAAAAAAAA1", 12345);
    assert.equal(readRefreshAt("AAAAAAAAA1"), 12345);
  });
});

test("readRefreshAt tolerates corrupt JSON — returns null rather than throwing", () => {
  withWindow((storage) => {
    storage.setItem("pos.public.refresh.v1", "{not json");
    assert.doesNotThrow(() => readRefreshAt("AAAAAAAAA1"));
    assert.equal(readRefreshAt("AAAAAAAAA1"), null);
  });
});

test("readRefreshAt tolerates a wrong-typed stored value — returns null", () => {
  withWindow((storage) => {
    storage.setItem("pos.public.refresh.v1", JSON.stringify(["not", "a", "map"]));
    assert.equal(readRefreshAt("AAAAAAAAA1"), null);
  });
});

test("writeRefreshAt prunes to the cap, keeping the NEWEST entries", () => {
  withWindow(() => {
    // 20 is the cap (mirrors MY_CODES_MAX); write cap+5 codes with strictly
    // increasing timestamps so "oldest" is unambiguous.
    for (let i = 0; i < 25; i++) {
      writeRefreshAt(`CODE${i.toString().padStart(5, "0")}`, 1000 + i);
    }
    // The oldest 5 (00000-00004) must have been dropped.
    for (let i = 0; i < 5; i++) {
      assert.equal(readRefreshAt(`CODE${i.toString().padStart(5, "0")}`), null);
    }
    // A recently written one survives.
    assert.equal(readRefreshAt("CODE00024"), 1024);
  });
});

// SLICE 10 — theme.
test("readTheme returns null when nothing has been written yet", () => {
  withWindow(() => {
    assert.equal(readTheme(), null);
  });
});

test("writeTheme then readTheme round-trips exactly", () => {
  withWindow(() => {
    writeTheme("dark");
    assert.equal(readTheme(), "dark");
  });
});

test("readTheme rejects an unknown string value — returns null", () => {
  withWindow((storage) => {
    storage.setItem("pos.public.theme.v1", JSON.stringify("solarized"));
    assert.equal(readTheme(), null);
  });
});

test("readTheme tolerates corrupt JSON — returns null rather than throwing", () => {
  withWindow((storage) => {
    storage.setItem("pos.public.theme.v1", "{not json");
    assert.doesNotThrow(() => readTheme());
    assert.equal(readTheme(), null);
  });
});

// SLICE 10 — public menu cache.
test("readMenuCache returns null when nothing has been written yet", () => {
  withWindow(() => {
    assert.equal(readMenuCache(), null);
  });
});

test("writeMenuCache then readMenuCache round-trips the payload with a timestamp", () => {
  withWindow(() => {
    writeMenuCache({ categories: [] });
    const cached = readMenuCache();
    assert.ok(cached !== null);
    assert.equal(typeof cached.at, "number");
    assert.deepEqual(cached.payload, { categories: [] });
  });
});

test("readMenuCache tolerates corrupt JSON — returns null rather than throwing", () => {
  withWindow((storage) => {
    storage.setItem("pos.public.menucache.v1", "{not json");
    assert.doesNotThrow(() => readMenuCache());
    assert.equal(readMenuCache(), null);
  });
});

test("readMenuCache returns null for a payload that fails its type guard", () => {
  withWindow((storage) => {
    // Missing `at` entirely — fails the envelope guard even though it's
    // valid JSON.
    storage.setItem("pos.public.menucache.v1", JSON.stringify({ payload: {} }));
    assert.equal(readMenuCache(), null);
  });
});

// SLICE 10 — logout-wide clear.
test("DINER_OWNED_KEYS contains the identity key (positive landmark) but not the cart key (negative pin)", () => {
  const keys: readonly string[] = DINER_OWNED_KEYS;
  assert.ok(keys.includes("pos.public.me.v1"), "expected identity key to be diner-owned");
  assert.ok(!keys.includes("pos.public.cart.v1"), "cart key must not be diner-owned");
});

test("clearDinerData removes exactly DINER_OWNED_KEYS and leaves cart, theme and menu-cache intact", () => {
  withWindow(() => {
    writeCart([LINE]);
    writeIdentity({ mobile: "9876543210", name: "Asha" });
    pushMyCode("AAAAAAAAA1");
    writeLastMenuPath("/m/0123456789ABCD");
    writeRefreshAt("AAAAAAAAA1", 12345);
    writeTheme("dark");
    writeMenuCache({ categories: [] });

    clearDinerData();

    // Removed set: every diner-owned key reads back as empty/null again.
    assert.equal(readIdentity(), null);
    assert.deepEqual(readMyCodes(), []);
    assert.equal(readLastMenuPath(), null);
    assert.equal(readRefreshAt("AAAAAAAAA1"), null);

    // Survivor set: cart, theme and menu-cache are untouched.
    assert.deepEqual(readCart(), [LINE]);
    assert.equal(readTheme(), "dark");
    const cached = readMenuCache();
    assert.ok(cached !== null);
    assert.deepEqual(cached.payload, { categories: [] });
  });
});

// SLICE 10 — every localStorage key literal in the module must be `.v1`
// versioned, so a future shape change can never ship unversioned. Paired
// with a positive landmark (a known key IS present) so the pin cannot pass
// on an empty/mis-scoped read.
test("every localStorage key literal in public-cart-store.ts ends in .v1", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const srcPath = path.join(repoRoot, "apps/cafe/components/public/public-cart-store.ts");
  const raw = readFileSync(srcPath, "utf8");
  const keyLiterals = [...raw.matchAll(/"pos\.public\.[a-zA-Z0-9.]*"/g)].map((m) => m[0]);
  assert.ok(keyLiterals.length > 0, "expected at least one pos.public.* key literal");
  assert.ok(
    keyLiterals.includes('"pos.public.me.v1"'),
    "positive landmark: known identity key must be present",
  );
  for (const literal of keyLiterals) {
    assert.ok(literal.endsWith('.v1"'), `key literal ${literal} is not .v1-versioned`);
  }
});

// ── Reachability (review 2026-09-13, CONFIRMED dead) ───────────────────────
// readMenuCache/writeMenuCache/MENU_CACHE_TTL_MS shipped with a complete
// key-ownership policy and a full test suite — and ZERO production call
// sites. The cache-first paint that scope item 9 ("a QR menu must paint in
// under 3s") depends on was never wired. This repo's own rule: "A new
// hook/route/page is not done until it has a real call site — grep-verify
// reachability, not just that it compiles."
test("PIN: the menu cache has a REAL call site — PublicMenu paints from it and writes it back", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  // stripComments FIRST: a raw-source read would let a COMMENTED-OUT call
  // site satisfy this pin, which is exactly the dead-code state it exists to
  // catch (verified by mutation — the raw-read version passed with the write
  // commented out).
  const src = stripComments(
    readFileSync(path.join(repoRoot, "apps/cafe/components/public/PublicMenu.tsx"), "utf8"),
  );
  assert.match(src, /readMenuCache\(\)/, "PublicMenu must READ the cache (the fast-paint half)");
  assert.match(src, /writeMenuCache\(/, "PublicMenu must WRITE the cache, or it can never be warm");
  assert.match(
    src,
    /MENU_CACHE_TTL_MS/,
    "the cached payload must be age-checked against the shared TTL, never painted unconditionally",
  );
  // Vision guard: a cached blob is `unknown` by contract, so it MUST be
  // validated before painting rather than cast.
  assert.match(
    src,
    /isPublicMenuData\(/,
    "the cached payload must go through a type guard — public-cart-store stores it as `unknown` on purpose",
  );
});
