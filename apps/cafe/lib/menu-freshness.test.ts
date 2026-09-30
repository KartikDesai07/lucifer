import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, onlineManager } from "@tanstack/react-query";

import {
  MENU_REFRESH_MIN_GAP_MS,
  getLastMenuRefreshAt,
  menuRefreshDue,
  setLastMenuRefreshAt,
  type MenuFreshnessFacts,
} from "./menu-freshness";
import { refreshMenuNow } from "./menu-refresh";
import { refreshMenuIfDue } from "@/hooks/use-menu-freshness";
import { BOOTSTRAP_QUERY_KEY } from "@/components/layout/MasterDataProvider";

// Menu B2 - the gap rule (pure), then the refresh against a real QueryClient and a stubbed fetch.
const NOW = 1_000_000;
const facts = (over: Partial<MenuFreshnessFacts> = {}): MenuFreshnessFacts => ({
  now: NOW,
  lastRefreshAt: null,
  bootstrapFetching: false,
  bootstrapFetchedAt: null,
  menuFetching: false,
  online: true,
  ...over,
});

test("the gap is 30 seconds, and a refresh is due when nothing has refreshed and nothing is running", () => {
  assert.equal(MENU_REFRESH_MIN_GAP_MS, 30_000);
  assert.equal(menuRefreshDue(facts()), true);
});

test("not due inside the gap after the last refresh; due exactly at the gap", () => {
  assert.equal(menuRefreshDue(facts({ lastRefreshAt: NOW - 1 })), false);
  assert.equal(menuRefreshDue(facts({ lastRefreshAt: NOW - (MENU_REFRESH_MIN_GAP_MS - 1) })), false);
  assert.equal(menuRefreshDue(facts({ lastRefreshAt: NOW - MENU_REFRESH_MIN_GAP_MS })), true);
});

test("a negative age (a stamp from the future - clock skew) counts as due, never as recent", () => {
  assert.equal(menuRefreshDue(facts({ lastRefreshAt: NOW + 5_000 })), true);
  assert.equal(menuRefreshDue(facts({ bootstrapFetchedAt: NOW + 5_000 })), true);
});

test("not due while a products/categories fetch is in flight, even with an old stamp", () => {
  assert.equal(menuRefreshDue(facts({ menuFetching: true })), false);
  assert.equal(menuRefreshDue(facts({ menuFetching: true, lastRefreshAt: 1 })), false);
});

test("not due while the bootstrap is fetching, and not right after its real fetch", () => {
  assert.equal(menuRefreshDue(facts({ bootstrapFetching: true })), false);
  assert.equal(menuRefreshDue(facts({ bootstrapFetchedAt: NOW - 1_000 })), false);
  assert.equal(menuRefreshDue(facts({ bootstrapFetchedAt: NOW - MENU_REFRESH_MIN_GAP_MS - 1 })), true);
});

test("not due offline (a paused fetch would hang)", () => {
  assert.equal(menuRefreshDue(facts({ online: false })), false);
});

test("Try again (manual) always refreshes: gap, offline and a read already running never swallow the tap", () => {
  assert.equal(menuRefreshDue(facts({ lastRefreshAt: NOW - 1 }), true), true);
  assert.equal(menuRefreshDue(facts({ bootstrapFetchedAt: NOW - 1 }), true), true);
  assert.equal(menuRefreshDue(facts({ online: false }), true), true);
  // Browser smoke (s59): a tap while TanStack's own focus refetch was running did nothing.
  // refreshMenuNow cancels that read first, so the tap replaces it.
  assert.equal(menuRefreshDue(facts({ menuFetching: true }), true), true);
  assert.equal(menuRefreshDue(facts({ bootstrapFetching: true }), true), true);
  assert.equal(menuRefreshDue(facts({ menuFetching: true })), false, "an automatic trigger still waits");
});

// ── the refresh against a real QueryClient ───────────────────────────────────

function stubFetch(urls: string[], body: (url: string) => unknown = () => []): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json({ success: true, data: body(String(input)) });
  }) as typeof fetch;
  return () => void (globalThis.fetch = real);
}

function clock(start: number) {
  const real = Date.now;
  let t = start;
  Date.now = () => t;
  return { advance: (ms: number) => (t += ms), restore: () => (Date.now = real) };
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const boom = (() => Response.json({ success: false, error: "boom" }, { status: 500 })) as unknown as typeof fetch;

test("refreshMenuNow reads both lists uncached, commits them and stamps the client clock", async () => {
  const urls: string[] = [];
  const restoreFetch = stubFetch(urls, (u) => (u.includes("products") ? [{ _id: "p1" }] : [{ _id: "c1" }]));
  const c = clock(5_000_000);
  setLastMenuRefreshAt(null);
  try {
    const qc = newClient();
    await refreshMenuNow(qc);
    assert.deepEqual([...urls].sort(), ["/api/categories?fresh=1", "/api/products?fresh=1"]);
    assert.deepEqual(qc.getQueryData(["products"]), [{ _id: "p1" }]);
    assert.deepEqual(qc.getQueryData(["categories"]), [{ _id: "c1" }]);
    assert.equal(getLastMenuRefreshAt(), 5_000_000);
  } finally {
    c.restore();
    restoreFetch();
    setLastMenuRefreshAt(null);
  }
});

test("refreshMenuIfDue: the second call inside the gap does nothing; after the gap it reads again", async () => {
  const urls: string[] = [];
  const restoreFetch = stubFetch(urls);
  const c = clock(6_000_000);
  setLastMenuRefreshAt(null);
  try {
    const qc = newClient();
    refreshMenuIfDue(qc);
    await settle();
    assert.equal(urls.length, 2);
    refreshMenuIfDue(qc);
    await settle();
    assert.equal(urls.length, 2, "inside the gap: no new read");
    c.advance(MENU_REFRESH_MIN_GAP_MS + 1);
    refreshMenuIfDue(qc);
    await settle();
    assert.equal(urls.length, 4, "after the gap: read again");
    refreshMenuIfDue(qc, true);
    await settle();
    assert.equal(urls.length, 6, "Try again ignores the gap");
  } finally {
    c.restore();
    restoreFetch();
    setLastMenuRefreshAt(null);
  }
});

test("refreshMenuIfDue: nothing while the bootstrap is in flight, nothing right after it lands, then due", async () => {
  const urls: string[] = [];
  const restoreFetch = stubFetch(urls);
  const c = clock(7_000_000);
  setLastMenuRefreshAt(null);
  try {
    const qc = newClient();
    let land: (v: unknown) => void = () => undefined;
    const bootstrap = qc.fetchQuery({
      queryKey: BOOTSTRAP_QUERY_KEY,
      queryFn: () => new Promise((resolve) => (land = resolve)),
    });
    refreshMenuIfDue(qc);
    await settle();
    assert.equal(urls.length, 0, "the page-load bootstrap is still running");
    land({ at: "2020-01-01T00:00:00.000Z" }); // the server's `at` - a different clock
    await bootstrap;
    refreshMenuIfDue(qc);
    await settle();
    assert.equal(urls.length, 0, "just after the bootstrap's real fetch");
    c.advance(MENU_REFRESH_MIN_GAP_MS + 1);
    refreshMenuIfDue(qc);
    await settle();
    assert.equal(urls.length, 2);
  } finally {
    c.restore();
    restoreFetch();
    setLastMenuRefreshAt(null);
  }
});

test("a stored-copy seed carrying an old or future server `at` never makes a refresh look recent", async () => {
  const urls: string[] = [];
  const restoreFetch = stubFetch(urls);
  const c = clock(8_000_000);
  setLastMenuRefreshAt(null);
  try {
    for (const updatedAt of [1_000, 8_000_000 + 60_000, 8_000_000 - 1_000]) { // ancient, future, and 1 s ago (inside the gap)
      const qc = newClient();
      qc.setQueryData(["products"], [{ _id: "old" }], { updatedAt });
      qc.setQueryData(["categories"], [], { updatedAt });
      urls.length = 0;
      setLastMenuRefreshAt(null);
      refreshMenuIfDue(qc);
      await settle();
      assert.equal(urls.length, 2, `seed stamped ${updatedAt}`);
    }
  } finally {
    c.restore();
    restoreFetch();
    setLastMenuRefreshAt(null);
  }
});

test("refreshMenuIfDue: an automatic trigger waits for a running products read; Try again replaces it", async () => {
  const urls: string[] = [];
  const restoreFetch = stubFetch(urls);
  setLastMenuRefreshAt(null);
  try {
    const qc = newClient();
    let land: (v: unknown) => void = () => undefined;
    const running = qc
      .fetchQuery({ queryKey: ["products"], queryFn: () => new Promise((r) => (land = r)) })
      .catch(() => undefined); // cancelled by the tap
    refreshMenuIfDue(qc);
    await settle();
    assert.equal(urls.length, 0, "no automatic refresh on top of a running read");
    refreshMenuIfDue(qc, true);
    await settle();
    assert.equal(urls.length, 2, "the tap re-reads products and categories uncached");
    land([{ _id: "late" }]); // the replaced read answers late
    await running;
    assert.notDeepEqual(qc.getQueryData(["products"]), [{ _id: "late" }], "the cancelled read never lands");
  } finally {
    restoreFetch();
    setLastMenuRefreshAt(null);
  }
});

test("a failed refresh keeps the list on screen and does not throw out of refreshMenuIfDue", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = boom;
  setLastMenuRefreshAt(null);
  try {
    const qc = newClient();
    qc.setQueryData(["products"], [{ _id: "keep" }]);
    refreshMenuIfDue(qc);
    await settle();
    const state = qc.getQueryState(["products"]);
    assert.equal(state?.status, "error");
    assert.deepEqual(state?.data, [{ _id: "keep" }], "the last good list is kept");
  } finally {
    globalThis.fetch = real;
    setLastMenuRefreshAt(null);
  }
});

test("refreshMenuIfDue: nothing while the device is offline (Try again still asks)", async () => {
  const urls: string[] = [];
  const restoreFetch = stubFetch(urls);
  setLastMenuRefreshAt(null);
  onlineManager.setOnline(false);
  try {
    const qc = newClient();
    refreshMenuIfDue(qc);
    await settle();
    assert.equal(urls.length, 0);
    // An offline fetch parks as "paused" without calling fetch - so check no query was even started.
    assert.equal(qc.getQueryState(["products"]), undefined, "no paused fetch left hanging");
  } finally {
    onlineManager.setOnline(true);
    restoreFetch();
    setLastMenuRefreshAt(null);
  }
});

test("refreshMenuNow cancels a slower cached refetch already in flight, so the older list cannot land after the fresh one", async () => {
  const urls: string[] = [];
  const restoreFetch = stubFetch(urls, (u) => (u.includes("products") ? [{ _id: "fresh" }] : []));
  setLastMenuRefreshAt(null);
  try {
    const qc = newClient();
    let land: (v: unknown) => void = () => undefined;
    void qc
      .fetchQuery({ queryKey: ["products"], queryFn: () => new Promise((r) => (land = r)) })
      .catch(() => undefined);
    const refreshed = refreshMenuNow(qc);
    await settle();
    land([{ _id: "stale" }]);
    await refreshed;
    await settle();
    assert.deepEqual(qc.getQueryData(["products"]), [{ _id: "fresh" }]);
  } finally {
    restoreFetch();
    setLastMenuRefreshAt(null);
  }
});
