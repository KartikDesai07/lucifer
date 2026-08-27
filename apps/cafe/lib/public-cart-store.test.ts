import { test } from "node:test";
import assert from "node:assert/strict";

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
