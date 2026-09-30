import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";

import { setLastMenuRefreshAt } from "./menu-freshness";
import { refreshMenuNow } from "./menu-refresh";
import { refreshFailedOf } from "@/hooks/use-menu-freshness";

// Menu B2 - the "Couldn't refresh" flag the grid shows, read straight from the query cache.
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const boom = (() => Response.json({ success: false, error: "boom" }, { status: 500 })) as unknown as typeof fetch;

test("refreshFailedOf: true only when a refresh failed while the list on screen is still good", async () => {
  const real = globalThis.fetch;
  setLastMenuRefreshAt(null);
  try {
    const qc = newClient();
    assert.equal(refreshFailedOf(qc), false, "nothing cached");

    // A first load that failed with no data is the page's own error state.
    globalThis.fetch = boom;
    await refreshMenuNow(qc).catch(() => undefined);
    assert.equal(qc.getQueryState(["products"])?.status, "error");
    assert.equal(refreshFailedOf(qc), false, "error without data");

    qc.setQueryData(["products"], [{ _id: "keep" }]);
    assert.equal(refreshFailedOf(qc), false, "good data");
    await refreshMenuNow(qc).catch(() => undefined);
    assert.equal(refreshFailedOf(qc), true, "refresh failed, list kept");
    assert.equal(refreshFailedOf(qc), true, "stable snapshot: the same boolean twice");

    globalThis.fetch = (async () => Response.json({ success: true, data: [] })) as typeof fetch;
    await refreshMenuNow(qc);
    assert.equal(refreshFailedOf(qc), false, "the next good refresh clears it");

    // The categories list counts too.
    qc.setQueryData(["categories"], [{ _id: "c" }]);
    await qc.fetchQuery({ queryKey: ["categories"], queryFn: () => Promise.reject(new Error("x")), staleTime: 0 }).catch(() => undefined);
    assert.equal(refreshFailedOf(qc), true, "categories refresh failed");
  } finally {
    globalThis.fetch = real;
    setLastMenuRefreshAt(null);
  }
});

test("refreshFailedOf is false while a retry is running (query-core keeps status error mid-refetch) and true again if it fails", async () => {
  const qc = newClient();
  qc.setQueryData(["products"], [{ _id: "keep" }]);
  await qc.fetchQuery({ queryKey: ["products"], queryFn: () => Promise.reject(new Error("x")), staleTime: 0 }).catch(() => undefined);
  assert.equal(refreshFailedOf(qc), true, "failed refresh");
  let fail: (e: Error) => void = () => undefined;
  const retry = qc
    .fetchQuery({ queryKey: ["products"], queryFn: () => new Promise((_, reject) => (fail = reject)), staleTime: 0 })
    .catch(() => undefined);
  assert.equal(qc.getQueryState(["products"])?.status, "error", "query-core keeps status error mid-refetch");
  assert.equal(qc.getQueryState(["products"])?.fetchStatus, "fetching");
  assert.equal(refreshFailedOf(qc), false, "the slot shows the count again while retrying");
  fail(new Error("still down"));
  await retry;
  assert.equal(refreshFailedOf(qc), true, "the retry failed too");
});
