import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ApiError } from "@pos/shared/api-client";
import { REFETCH_INTERVALS } from "@/lib/query";
import { stripComments } from "@/lib/source-pin-utils";

import {
  WARM_LINE_PROOF_MS,
  WARM_ROUTES_INTERVAL_MS,
  WARM_ROUTES_STAGGER_MS,
  isLineFailure,
  lineProven,
  staggerPlan,
  warmRoutes,
} from "./warm-routes";

const LIVE = { visible: true, online: true, lineProven: true };
const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const readCafe = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8");

test("warmRoutes offers every route once, in order, when the tab is visible and online", () => {
  const seen: string[] = [];
  const offered = warmRoutes(["/", "/pos", "/orders", "/pos"], (h) => seen.push(h), LIVE);
  assert.deepEqual(seen, ["/", "/pos", "/orders"], "a repeated href is offered once");
  assert.deepEqual(offered, seen);
});

test("warmRoutes sends nothing from a hidden tab, while offline, or before the line has answered", () => {
  const seen: string[] = [];
  assert.deepEqual(warmRoutes(["/pos"], (h) => seen.push(h), { ...LIVE, visible: false }), []);
  assert.deepEqual(warmRoutes(["/pos"], (h) => seen.push(h), { ...LIVE, online: false }), []);
  assert.deepEqual(warmRoutes(["/pos"], (h) => seen.push(h), { ...LIVE, lineProven: false }), []);
  assert.deepEqual(seen, [], "no prefetch may be issued in any of these states");
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

test("lineProven: only an answer within WARM_LINE_PROOF_MS proves the line; none yet never does", () => {
  const now = 1_000_000;
  assert.equal(lineProven(null, now), false, "no answer yet");
  assert.equal(lineProven(now - WARM_LINE_PROOF_MS, now), true, "exactly at the edge still counts");
  assert.equal(lineProven(now - WARM_LINE_PROOF_MS - 1, now), false, "one ms older does not");
  // The pulse answers every POS_PULSE on a healthy page, so it keeps the line
  // proven with room for one slow beat.
  assert.ok(WARM_LINE_PROOF_MS > REFETCH_INTERVALS.POS_PULSE);
});

test("staggerPlan offers each href once, in order, one gap apart; a full pass fits well inside one beat", () => {
  assert.deepEqual(staggerPlan(["/", "/pos", "/", "/orders"], 1500), [
    { href: "/", delayMs: 0 },
    { href: "/pos", delayMs: 1500 },
    { href: "/orders", delayMs: 3000 },
  ]);
  assert.ok(WARM_ROUTES_STAGGER_MS * 10 < WARM_ROUTES_INTERVAL_MS);
});

test("isLineFailure: a transport failure or a 5xx is the line; our own server's 4xx is not", () => {
  assert.equal(isLineFailure(new ApiError("offline", "network", null)), true);
  assert.equal(isLineFailure(new ApiError("slow", "timeout", null)), true);
  assert.equal(isLineFailure(new ApiError("down", "http", 503)), true);
  assert.equal(isLineFailure(new TypeError("Failed to fetch")), true);
  assert.equal(isLineFailure(new ApiError("not found", "http", 404)), false);
});

// VENDOR PIN — fails ON PURPOSE on any Next upgrade beyond 15.5.x. The hook's
// "wait for a working line" rule exists because of exactly this old-router-
// cache behaviour: a prefetch that fails keeps a string entry for the whole
// static window, a re-prefetch returns it unchanged, and a click on it does a
// full page load. Re-read these files before bumping the pin.
test("PIN (vendor): Next 15.5 keeps a failed prefetch as a reusable string entry that a click turns into a full page load", () => {
  const req = createRequire(path.join(CAFE_ROOT, "package.json"));
  const nextPkg = req.resolve("next/package.json");
  const version = (JSON.parse(readFileSync(nextPkg, "utf8")) as { version: string }).version;
  assert.match(version, /^15\.5\./, "re-verify use-warm-routes on upgrade");
  const dist = (rel: string): string => readFileSync(path.join(path.dirname(nextPkg), "dist", rel), "utf8");
  const rr = "client/components/router-reducer/";

  const fetchSrc = dist(rr + "fetch-server-response.js");
  assert.match(fetchSrc, /function doMpaNavigation\(url\) \{\s*return \{\s*flightData: [^\n]*\.toString\(\),/);
  assert.match(fetchSrc, /if \(!isFlightResponse \|\| !res\.ok \|\| !res\.body\) \{[\s\S]{0,300}?return doMpaNavigation\(/);
  assert.match(fetchSrc, /\} catch \(err\) \{[\s\S]{0,700}?return \{\s*flightData: url\.toString\(\),/);

  const cacheSrc = dist(rr + "prefetch-cache-utils.js");
  assert.match(cacheSrc, /prefetchTime: Date\.now\(\),\s*lastUsedTime: null,/);
  assert.match(
    cacheSrc,
    /if \(kind === _routerreducertypes\.PrefetchKind\.FULL\) \{\s*if \(Date\.now\(\) < prefetchTime \+ STATIC_STALETIME_MS\) \{\s*return _routerreducertypes\.PrefetchCacheEntryStatus\.reusable;/,
  );
  assert.match(
    cacheSrc,
    /function prunePrefetchCache\(prefetchCache\) \{\s*for \(const \[href, prefetchCacheEntry\] of prefetchCache\)\s*\{\s*if \(getPrefetchEntryCacheStatus\(prefetchCacheEntry\) === _routerreducertypes\.PrefetchCacheEntryStatus\.expired\) \{\s*prefetchCache\.delete\(href\);\s*\}\s*\}\s*\}/,
  );

  const external = /if \(typeof flightData === 'string'\) \{\s*return (?:\(0, _navigatereducer\.handleExternalUrl\)|handleExternalUrl)\(state, mutable, flightData,/;
  assert.match(dist(rr + "reducers/navigate-reducer.js"), external);
  assert.match(dist(rr + "reducers/refresh-reducer.js"), external);

  assert.match(
    dist("client/components/app-router-instance.js"),
    /Use the old prefetch implementation\.[\s\S]{0,900}?kind: \(_options_kind = options == null \? void 0 : options\.kind\) != null \? _options_kind : _routerreducertypes\.PrefetchKind\.FULL/,
  );
  const configShared = dist("server/config-shared.js");
  assert.match(configShared, /clientSegmentCache: false,/);
  assert.match(configShared, /staleTimes: \{\s*dynamic: 0,/);
  // ...and this app does not opt into the new segment cache (landmark: the
  // staleTimes block the reuse window lives in).
  const ourConfig = stripComments(readCafe("next.config.ts"));
  assert.match(ourConfig, /staleTimes: \{ static: PREFETCH_REUSE_SECONDS \}/);
  assert.doesNotMatch(ourConfig, /clientSegmentCache/);
});

test("PIN: the hook warms only after a real answer, staggers the offers, drops the line on failure, and cleans up", () => {
  const src = stripComments(readCafe("hooks/use-warm-routes.ts"));
  assert.ok(src.includes("qc.getQueryCache().subscribe("), "proof comes from the page's own queries");
  // A setQueryData write proves nothing, and neither does a query that can
  // answer without the network (review 2026-09-28: the print host's wake query
  // does once its daily budget is spent) — only the POS pulse is proof.
  assert.ok(
    src.includes("if (action.manual === true || event.query.queryKey[0] !== POS_PULSE_KEYS.all[0]) return;"),
    "only a network answer from the POS pulse proves the line",
  );
  assert.match(src, /import \{ POS_PULSE_KEYS \} from "@\/hooks\/use-pos-pulse";/);
  assert.match(src, /const wasProven = lineProven\(answeredAt, now\);\s*answeredAt = now;\s*if \(!wasProven\) pass\(\);/);
  assert.match(src, /action\.type === "pause"/);
  assert.match(src, /\(action\.type === "failed" \|\| action\.type === "error"\) && isLineFailure\(action\.error\)/);
  assert.match(src, /const lineDown = \(\) => \{\s*answeredAt = null;\s*cancelPass\(\);\s*\};/);
  assert.match(
    src,
    /const beat = window\.setInterval\(\(\) => \{\s*if \(lineProven\(answeredAt, Date\.now\(\)\)\) pass\(\);\s*\}, WARM_ROUTES_INTERVAL_MS\);/,
  );
  assert.match(src, /document\.visibilityState === "visible" && lineProven\(answeredAt, Date\.now\(\)\)\) pass\(\);/);
  assert.ok(src.includes("staggerPlan(list, WARM_ROUTES_STAGGER_MS)"));
  assert.ok(src.includes("warmRoutes([href], prefetch, env())"), "each offer re-checks the line when it fires");

  const cleanupAt = src.lastIndexOf("return () => {");
  assert.ok(cleanupAt > 0, "the effect has a cleanup");
  const cleanup = src.slice(cleanupAt);
  for (const call of ["unsubscribe();", "cancelPass();", "window.clearInterval(beat);", 'window.removeEventListener("offline", lineDown);']) {
    assert.ok(cleanup.includes(call), `cleanup must call ${call}`);
  }

  // Negatives, each with a landmark: no router.refresh "repair" (it reloads
  // the CURRENT screen on a failed fetch), and no "online" listener
  // (TanStack's refetch-on-reconnect supplies the proof instead).
  assert.ok(src.includes("router.prefetch("), "landmark: the hook still prefetches");
  assert.ok(!src.includes("router.refresh"), "router.refresh must never be used here");
  assert.ok(src.includes('addEventListener("offline", lineDown)'), "landmark: the offline listener");
  assert.doesNotMatch(src, /addEventListener\(\s*["']online["']/);
});
