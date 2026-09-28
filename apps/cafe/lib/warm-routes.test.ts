import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { WARM_ROUTES_INTERVAL_MS, warmRoutes } from "./warm-routes";

const LIVE = { visible: true, online: true };

test("warmRoutes offers every route once, in order, when the tab is visible and online", () => {
  const seen: string[] = [];
  const offered = warmRoutes(["/", "/pos", "/orders", "/pos"], (h) => seen.push(h), LIVE);
  assert.deepEqual(seen, ["/", "/pos", "/orders"], "a repeated href is offered once");
  assert.deepEqual(offered, seen);
});

test("warmRoutes sends nothing from a hidden tab or while offline", () => {
  const seen: string[] = [];
  assert.deepEqual(warmRoutes(["/pos"], (h) => seen.push(h), { visible: false, online: true }), []);
  assert.deepEqual(warmRoutes(["/pos"], (h) => seen.push(h), { visible: true, online: false }), []);
  assert.deepEqual(seen, [], "no prefetch may be issued in either state");
});

test("a prefetch that throws skips only itself — the rest are still offered", () => {
  const seen: string[] = [];
  const offered = warmRoutes(
    ["/", "/pos", "/orders"],
    (h) => {
      if (h === "/pos") throw new Error("router mid-teardown");
      seen.push(h);
    },
    LIVE,
  );
  assert.deepEqual(seen, ["/", "/orders"]);
  assert.deepEqual(offered, ["/", "/orders"], "the thrown route is not reported as offered");
});

test("the beat is short against next.config's reuse window, so an expired entry is refilled long before most clicks", () => {
  const config = readFileSync(fileURLToPath(new URL("../next.config.ts", import.meta.url)), "utf8");
  const m = config.match(/const PREFETCH_REUSE_SECONDS = (\d+) \* (\d+);/);
  assert.ok(m, "next.config.ts must declare PREFETCH_REUSE_SECONDS as <a> * <b>");
  const reuseMs = Number(m![1]) * Number(m![2]) * 1000;
  // At most a thirtieth of the window: an entry that just expired waits no
  // longer than one beat for its refill, which is ≤ ~3% of the time.
  assert.ok(
    WARM_ROUTES_INTERVAL_MS * 30 <= reuseMs,
    `beat ${WARM_ROUTES_INTERVAL_MS}ms vs reuse window ${reuseMs}ms`,
  );
});
