// Realtime socket slice 1 — pins over lib/realtime-publish.ts (the server-only
// publish helper), hooks/use-realtime.ts (the client hook), and their contract
// with workers/realtime/src/index.ts (outside the npm workspace, cannot
// import either). Same readSrc + stripComments idiom as kitchen-paths.test.ts;
// same Worker-parity + grep-gate idiom as apps/hub/lib/heartbeat-hmac.test.ts.
//
// Socket slice 2 (appended below, § 7 onward) — lib/realtime-client.ts (the
// shared refcounted connection + isRealtimeHealthy), the print-cadence gate in
// hooks/use-print-host-wake.ts, and lib/print-queue.ts's three publish sites.
// realtime-client.ts is a module-level singleton: a dynamic `import(url +
// "?case=N")` was tried first and DOES NOT give a fresh module instance under
// this tsx/Node loader (the query string is ignored for module identity —
// verified: two such imports returned `===` the same module object). Isolation
// instead comes from the module's OWN public teardown: subscribeRealtime's
// returned unsubscribe, once the last listener leaves, resets every piece of
// singleton state (socket→null, lastSeenAt→0, timers cleared, retry→0) — see
// realtime-client.ts's own `subscribeRealtime` doc comment. Each case below
// subscribes, drives the fake socket, asserts, then unsubscribes in a
// `finally` before the next case runs; a same-file leak check (case B) proves
// this actually isolates rather than merely hoping so.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import path from "node:path";
import { mock } from "node:test";

import { stripComments } from "@/lib/source-pin-utils";
import {
  signRealtime,
  buildRealtimeRequest,
  realtimeEnabled,
  broadcastCafeEvent,
  publishCafeEvent,
  CAFE_EVENT_KINDS,
  REALTIME_SIG_HEADER,
  REALTIME_TS_HEADER,
  type CafeEventKind,
} from "./realtime-publish";
import {
  subscribeRealtime,
  isRealtimeHealthy,
  REALTIME_PING_INTERVAL_MS,
  REALTIME_PONG_TIMEOUT_MS,
  REALTIME_HEALTH_TTL_MS,
} from "./realtime-client";
import { PRINT_WAKE_SOCKET_MS, PRINT_WAKE_FAST_MS } from "@pos/shared/print-job";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const REALTIME_PUBLISH = "apps/cafe/lib/realtime-publish.ts";
const USE_REALTIME = "apps/cafe/hooks/use-realtime.ts";
const WORKER_SRC = "workers/realtime/src/index.ts";
const WRANGLER_JSONC = "workers/realtime/wrangler.jsonc";
const KITCHEN_PAGE = "apps/cafe/app/(dashboard)/kitchen/page.tsx";
const USE_KITCHEN = "apps/cafe/hooks/use-kitchen.ts";
const USE_PRINT_HOST_WAKE = "apps/cafe/hooks/use-print-host-wake.ts";
const PRINT_QUEUE = "apps/cafe/lib/print-queue.ts";

const ITEMS_ROUTE = "apps/cafe/app/api/orders/[id]/items/route.ts";
const KITCHEN_ROUTE = "apps/cafe/app/api/kitchen/route.ts";
const ORDERS_ROUTE = "apps/cafe/app/api/orders/route.ts";
const SETTLE_ROUTE = "apps/cafe/app/api/orders/[id]/settle/route.ts";
const CANCEL_ROUTE = "apps/cafe/app/api/orders/[id]/cancel/route.ts";
const VOID_ROUTE = "apps/cafe/app/api/orders/[id]/items/void/route.ts";
const ORDER_REQUEST_ROUTE = "apps/cafe/app/api/public/order-request/route.ts";
const ACCEPT_ROUTE = "apps/cafe/app/api/order-requests/[id]/accept/route.ts";

// ── (1) PURE LOGIC: signRealtime / buildRealtimeRequest ────────────────────

test("signRealtime: stable lowercase-hex 64-char HMAC-SHA256, matching node:crypto computed independently", () => {
  const secret = "test-realtime-secret";
  const ts = "1784000000";
  const body = '{"tenant":"acme","kind":"order-changed","at":"2026-07-14T10:00:00.000Z"}';

  const sig = signRealtime(secret, ts, body);
  assert.match(sig, /^[0-9a-f]{64}$/, "lowercase hex sha256 length");

  const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  assert.equal(sig, expected, "must match an independently-computed HMAC over `${ts}.${body}`");

  // Deterministic: the same triple always produces the same digest.
  assert.equal(signRealtime(secret, ts, body), sig);
});

test("buildRealtimeRequest: signs the EXACT bytes it sends as `body` (mutation-critical)", () => {
  const secret = "another-secret";
  const nowMs = 1_784_000_123_456;
  const envelope = { tenant: "acme", kind: "kot-fired" as CafeEventKind, at: "2026-07-14T10:00:00.000Z" };

  const result = buildRealtimeRequest(secret, envelope, nowMs);

  // Re-derive the signature from the ACTUAL headers + ACTUAL body the function
  // returned, and assert it equals what was sent — if the impl ever signs
  // different bytes than it transmits, this goes red.
  const reSigned = signRealtime(secret, result.headers[REALTIME_TS_HEADER], result.body);
  assert.equal(reSigned, result.headers[REALTIME_SIG_HEADER], "the signature must cover the exact body bytes sent");

  // Body is the JSON-serialized envelope, verbatim.
  assert.equal(result.body, JSON.stringify(envelope));
});

test("buildRealtimeRequest: ts header is unix SECONDS, floor(nowMs/1000), from a fixed clock", () => {
  const secret = "s";
  const envelope = { tenant: "t", kind: "self-order" as CafeEventKind, at: "x" };
  const nowMs = 1_700_000_999_750; // .750s into the second — floor must drop it
  const result = buildRealtimeRequest(secret, envelope, nowMs);
  assert.equal(result.headers[REALTIME_TS_HEADER], String(Math.floor(nowMs / 1000)));
  assert.equal(result.headers[REALTIME_TS_HEADER], "1700000999");
});

test("realtimeEnabled: true ONLY when BOTH REALTIME_PUBLISH_URL and REALTIME_PUBLISH_SECRET are set", () => {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    REALTIME_PUBLISH_URL: undefined,
    REALTIME_PUBLISH_SECRET: undefined,
  };

  assert.equal(realtimeEnabled({ ...base }), false, "neither set");
  assert.equal(
    realtimeEnabled({ ...base, REALTIME_PUBLISH_URL: "https://example.com" }),
    false,
    "URL only",
  );
  assert.equal(
    realtimeEnabled({ ...base, REALTIME_PUBLISH_SECRET: "shh" }),
    false,
    "secret only",
  );
  assert.equal(
    realtimeEnabled({ ...base, REALTIME_PUBLISH_URL: "https://example.com", REALTIME_PUBLISH_SECRET: "shh" }),
    true,
    "both set",
  );
});

// ── (2) FIRE-AND-FORGET GUARD ───────────────────────────────────────────────

test("broadcastCafeEvent: is async/awaitable (a thenable, not sync-void); does not throw synchronously, and the returned promise resolves even when fetch throws synchronously", async () => {
  const savedUrl = process.env.REALTIME_PUBLISH_URL;
  const savedSecret = process.env.REALTIME_PUBLISH_SECRET;
  const savedTenant = process.env.TENANT_ID;
  const savedFetch = globalThis.fetch;
  try {
    process.env.REALTIME_PUBLISH_URL = "https://realtime.example.com/publish";
    process.env.REALTIME_PUBLISH_SECRET = "test-secret";
    process.env.TENANT_ID = "acme";
    let called = false;
    globalThis.fetch = ((..._args: unknown[]) => {
      called = true;
      throw new Error("synchronous network failure");
    }) as typeof fetch;

    let result: Promise<void> | undefined;
    assert.doesNotThrow(() => {
      result = broadcastCafeEvent("order-changed", Date.now());
    });
    assert.ok(result, "must return something synchronously (the call itself must not throw)");
    assert.equal(
      typeof (result as unknown as { then?: unknown }).then,
      "function",
      "must return a thenable/Promise, not void — the waitUntil-registration defect fix",
    );
    // Awaiting must resolve, never reject — even though fetch itself threw.
    await assert.doesNotReject(result!);
    assert.equal(called, true, "fetch must actually have been invoked");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.REALTIME_PUBLISH_URL;
    else process.env.REALTIME_PUBLISH_URL = savedUrl;
    if (savedSecret === undefined) delete process.env.REALTIME_PUBLISH_SECRET;
    else process.env.REALTIME_PUBLISH_SECRET = savedSecret;
    if (savedTenant === undefined) delete process.env.TENANT_ID;
    else process.env.TENANT_ID = savedTenant;
  }
});

test("broadcastCafeEvent: awaited promise resolves / no unhandled rejection when fetch returns a rejected promise", async () => {
  const savedUrl = process.env.REALTIME_PUBLISH_URL;
  const savedSecret = process.env.REALTIME_PUBLISH_SECRET;
  const savedTenant = process.env.TENANT_ID;
  const savedFetch = globalThis.fetch;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    process.env.REALTIME_PUBLISH_URL = "https://realtime.example.com/publish";
    process.env.REALTIME_PUBLISH_SECRET = "test-secret";
    process.env.TENANT_ID = "acme";
    let fetchArgs: [string, RequestInit] | undefined;
    globalThis.fetch = ((url: string, init: RequestInit) => {
      fetchArgs = [url, init];
      return Promise.reject(new Error("network down"));
    }) as typeof fetch;

    const result = broadcastCafeEvent("kot-ticked", Date.now());
    // Awaiting must resolve, never reject — the internal catch swallows it.
    await assert.doesNotReject(result);

    // Give any stray unhandled-rejection machinery a macrotask to surface.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(unhandled.length, 0, "the rejection must be absorbed internally, never surface as unhandled");
    assert.ok(fetchArgs, "fetch must have been called");
    const [, init] = fetchArgs!;
    assert.equal(init.method, "POST");
    assert.ok(
      typeof init.headers === "object" && init.headers !== null,
      "headers must be present",
    );
    const headers = init.headers as Record<string, string>;
    assert.ok(headers[REALTIME_SIG_HEADER], "signature header must be present");
    assert.ok(headers[REALTIME_TS_HEADER], "ts header must be present");
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
    globalThis.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.REALTIME_PUBLISH_URL;
    else process.env.REALTIME_PUBLISH_URL = savedUrl;
    if (savedSecret === undefined) delete process.env.REALTIME_PUBLISH_SECRET;
    else process.env.REALTIME_PUBLISH_SECRET = savedSecret;
    if (savedTenant === undefined) delete process.env.TENANT_ID;
    else process.env.TENANT_ID = savedTenant;
  }
});

test("broadcastCafeEvent: with env UNSET, fetch is never called at all (awaited)", async () => {
  const savedUrl = process.env.REALTIME_PUBLISH_URL;
  const savedSecret = process.env.REALTIME_PUBLISH_SECRET;
  const savedFetch = globalThis.fetch;
  try {
    delete process.env.REALTIME_PUBLISH_URL;
    delete process.env.REALTIME_PUBLISH_SECRET;
    let called = false;
    globalThis.fetch = ((..._args: unknown[]) => {
      called = true;
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch;

    await broadcastCafeEvent("order-changed", Date.now());
    assert.equal(called, false, "fetch must NOT be called when publishing is unconfigured");
  } finally {
    globalThis.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.REALTIME_PUBLISH_URL;
    else process.env.REALTIME_PUBLISH_URL = savedUrl;
    if (savedSecret === undefined) delete process.env.REALTIME_PUBLISH_SECRET;
    else process.env.REALTIME_PUBLISH_SECRET = savedSecret;
  }
});

// ── (2.5) NEW CONTRACT: async return type + publishCafeEvent's own guard ───

test("PIN: broadcastCafeEvent is declared `async function` / returns Promise<void> (source-pinned — the waitUntil-registration fix)", () => {
  const src = readSrc(REALTIME_PUBLISH);
  assert.match(
    src,
    /export\s+async\s+function\s+broadcastCafeEvent\(/,
    "broadcastCafeEvent must be declared `export async function` — a sync-void fn's dropped promise never registers with waitUntil",
  );
  assert.match(
    src,
    /\)\s*:\s*Promise<void>\s*\{/,
    "broadcastCafeEvent must be typed to return Promise<void>",
  );
});

test("PIN: publishCafeEvent wraps after( in try/catch (source-pinned — the after()-throws-synchronously fix)", () => {
  const stripped = stripComments(readSrc(REALTIME_PUBLISH));
  const fnMatch = stripped.match(/export function publishCafeEvent\(kind: CafeEventKind\): void \{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "positive landmark: publishCafeEvent must be declared with this exact signature");
  const body = fnMatch![0];
  assert.match(body, /try\s*\{/, "publishCafeEvent's body must open a try block");
  assert.match(body, /after\(\s*broadcastCafeEvent\(kind\)\s*\)/, "must call after(broadcastCafeEvent(kind)) — the PROMISE, not a thunk, so it registers with waitUntil");
  assert.match(body, /\}\s*catch\s*\{/, "publishCafeEvent must catch after()'s synchronous throw (E468 outside a request scope) so a committed write never becomes a 500");
  // The try must actually wrap the after( call — not sit beside it. Assert
  // the catch appears strictly AFTER the after( call within the same body.
  const tryIdx = body.indexOf("try");
  const afterIdx = body.indexOf("after(");
  const catchIdx = body.indexOf("catch");
  assert.ok(tryIdx >= 0 && afterIdx > tryIdx && catchIdx > afterIdx, "try must precede after( which must precede catch, in that order");
});

test("RUNTIME PIN: publishCafeEvent does not throw when called outside a Next request scope (this node:test run IS that scope — true end-to-end guard for the after()-throws defect)", () => {
  // No stubbing at all: this calls the REAL after() from next/server. Outside
  // an active Next request context, after() throws synchronously (verified
  // against node_modules/next/dist/server/after/after-context.js — "if
  // something is wrong, throw synchronously, bubbling up to the `after`
  // callsite"). A node:test process run is exactly such an out-of-scope
  // context, so this is a real trigger of the defect the try/catch exists to
  // absorb — not a simulated one.
  assert.doesNotThrow(() => {
    publishCafeEvent("kot-fired");
  }, "publishCafeEvent must swallow after()'s synchronous throw outside a request scope — an unguarded throw here would turn a committed write into a 500 (and a 500 on create invites a retry = a duplicate order)");
});

// ── (3) THREE-WAY EVENT-KIND PARITY ─────────────────────────────────────────

test("parity: CAFE_EVENT_KINDS deep-equals the Worker's EVENT_KINDS array (source-pinned)", () => {
  const workerSrc = readSrc(WORKER_SRC);
  const match = workerSrc.match(/const EVENT_KINDS = \[([^\]]*)\] as const;/);
  assert.ok(match, "positive landmark: the Worker must declare `const EVENT_KINDS = [...] as const;`");
  const kinds = Array.from(match![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  assert.ok(kinds.length > 0, "the parsed EVENT_KINDS list must not be empty");
  assert.deepEqual([...CAFE_EVENT_KINDS], kinds, "CAFE_EVENT_KINDS must match the Worker's EVENT_KINDS exactly");
});

test("parity: the Kitchen hook's KITCHEN_EVENT_KINDS is a strict subset of CAFE_EVENT_KINDS and contains the three kitchen kinds", () => {
  const hookSrc = readSrc(USE_REALTIME);
  const match = hookSrc.match(/const KITCHEN_EVENT_KINDS = \[([^\]]*)\] as const;/);
  assert.ok(match, "positive landmark: use-realtime.ts must declare `const KITCHEN_EVENT_KINDS = [...] as const;`");
  const kinds = Array.from(match![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  assert.ok(kinds.length > 0, "the parsed KITCHEN_EVENT_KINDS list must not be empty");

  for (const k of kinds) {
    assert.ok(
      (CAFE_EVENT_KINDS as readonly string[]).includes(k),
      `KITCHEN_EVENT_KINDS entry "${k}" must be one of CAFE_EVENT_KINDS`,
    );
  }
  assert.ok(kinds.length < CAFE_EVENT_KINDS.length, "must be a STRICT subset, not the full set");
  for (const required of ["kot-fired", "kot-ticked", "order-changed"]) {
    assert.ok(kinds.includes(required), `KITCHEN_EVENT_KINDS must contain "${required}"`);
  }
  // Vision guard: self-order must NOT be one the kitchen board reacts to.
  assert.ok(!kinds.includes("self-order"), "the kitchen board must not react to self-order (POS pulse only)");
});

test("parity: the Worker source mirrors the header literals and the ts.body message shape (actual Worker variable names)", () => {
  const workerSrc = readSrc(WORKER_SRC);
  assert.ok(workerSrc.includes(`"${REALTIME_SIG_HEADER}"`), "sig header literal must appear in the Worker source");
  assert.ok(workerSrc.includes(`"${REALTIME_TS_HEADER}"`), "ts header literal must appear in the Worker source");
  // The Worker's own variable names differ from the cafe's (tsHeader/rawBody,
  // not tsSeconds/rawBody) — read from the actual source, not assumed.
  assert.ok(workerSrc.includes("${tsHeader}.${rawBody}"), "the Worker must sign over `${tsHeader}.${rawBody}`");
  // Positive landmark: the Worker really does compute an HMAC (proves this
  // isn't a blinded/empty read).
  assert.match(workerSrc, /HMAC[\s\S]{0,60}SHA-256/, "positive landmark: Worker must use HMAC-SHA256");
});

// ── (4) WORKER SOURCE PINS ──────────────────────────────────────────────────

test("PIN: the Worker uses ctx.acceptWebSocket( for hibernation, and contains NO bare .accept() call", () => {
  const workerSrc = readSrc(WORKER_SRC);
  assert.ok(workerSrc.includes("ctx.acceptWebSocket("), "must call ctx.acceptWebSocket( — hibernation is mandatory");
  // The non-hibernating form bills DO duration for the WHOLE connection, so a
  // wall display's all-shift socket would bill idle time all day on the
  // client's Free plan. The needle must catch the IDIOMATIC shapes Cloudflare's
  // own docs use — `server.accept()` / `ws.accept()` — not just bracket-indexed
  // ones. An earlier `[^A-Za-z]\.accept\(\)` required a NON-letter before the
  // dot, so it matched `pair[1].accept()` but sailed past `server.accept()`:
  // it would have passed on exactly the code it exists to forbid.
  //
  // `.accept(` cannot collide with `.acceptWebSocket(`: in the latter, `accept`
  // is followed by `WebSocket`, never by the `(` this needle requires. The
  // negative assert two lines below pins exactly that, so the needle can never
  // start flagging the CORRECT call.
  const BARE_ACCEPT = /\.accept\s*\(/;
  // Vision guard (paired positive): prove this needle really fires on the
  // forbidden shapes, so a green pin means "absent", never "needle is blind".
  for (const shape of ["server.accept();", "ws.accept();", "pair[1].accept();"]) {
    assert.ok(BARE_ACCEPT.test(shape), `needle must catch ${shape}`);
  }
  assert.ok(!BARE_ACCEPT.test("this.ctx.acceptWebSocket(pair[1]);"), "needle must NOT flag acceptWebSocket");
  // Strip comments first: the Worker's own header documents the rule in prose
  // ("NEVER ws.accept()", "NOT client.accept()"). Matching that prose would fail
  // the pin on correct code — the same trap the console.* gate below avoids.
  assert.ok(
    !BARE_ACCEPT.test(stripComments(workerSrc)),
    "must NOT contain a bare `.accept()` CALL (comments are stripped, so this is a real call site)",
  );
});

test("PIN: wrangler.jsonc uses new_sqlite_classes, not new_classes (Workers Free plan requires SQLite backend)", () => {
  const wranglerSrc = readSrc(WRANGLER_JSONC);
  assert.ok(wranglerSrc.includes("new_sqlite_classes"), "must declare new_sqlite_classes");
  // Vision guard: the needle "new_classes" is a SUBSTRING of "new_sqlite_classes",
  // so a naive `.includes("new_classes")` would false-negative-pass even on a
  // correct file. Assert the bare (non-sqlite) migration key is truly absent
  // by requiring it NOT appear other than as part of new_sqlite_classes.
  const bareNewClasses = wranglerSrc.match(/"new_classes"/);
  assert.equal(bareNewClasses, null, "must NOT use the legacy-kv `new_classes` migration key");
  assert.match(wranglerSrc, /"CafeRoom"/, "positive landmark: CafeRoom must be named in the migration");
});

test("PIN: the room key shape is `cafe:${tenantId}`", () => {
  const workerSrc = readSrc(WORKER_SRC);
  assert.ok(workerSrc.includes("`cafe:${tenantId}`"), "roomName() must build the key as `cafe:${tenantId}`");
});

// ── (5) CALL-SITE PINS ──────────────────────────────────────────────────────

test("PIN: exactly the NINE intended write sites call publishCafeEvent with the right kind (NOT broadcastCafeEvent, NOT wrapped in a route-local after()", () => {
  // Each entry may list MORE THAN ONE expected kind for the same file (the
  // order-request route fires both self-order and, conditionally, kot-fired).
  const expectations: Array<[string, CafeEventKind[]]> = [
    [ITEMS_ROUTE, ["kot-fired"]],
    [KITCHEN_ROUTE, ["kot-ticked"]],
    [ORDERS_ROUTE, ["order-changed"]],
    [SETTLE_ROUTE, ["order-changed"]],
    [CANCEL_ROUTE, ["order-changed"]],
    [VOID_ROUTE, ["order-changed"]],
    [ORDER_REQUEST_ROUTE, ["self-order", "kot-fired"]],
    [ACCEPT_ROUTE, ["kot-fired"]],
  ];

  let totalCalls = 0;
  for (const [rel, kinds] of expectations) {
    const stripped = stripComments(readSrc(rel));
    assert.ok(
      stripped.includes("publishCafeEvent"),
      `${rel} must call publishCafeEvent (positive landmark)`,
    );
    // The OLD entry point must be gone from every route: routes go through
    // publishCafeEvent exclusively now (it owns the after()+try/catch
    // contract). A route calling broadcastCafeEvent directly would skip the
    // waitUntil registration AND the synchronous-throw guard.
    assert.ok(
      !stripped.includes("broadcastCafeEvent"),
      `${rel} must NOT call broadcastCafeEvent directly — only publishCafeEvent may (it is the sole entry point)`,
    );
    for (const kind of kinds) {
      const callRe = new RegExp(`publishCafeEvent\\(\\s*"${kind}"\\s*\\)`);
      assert.match(stripped, callRe, `${rel} must call publishCafeEvent("${kind}")`);
      totalCalls += (stripped.match(new RegExp(callRe.source, "g")) ?? []).length;
    }
  }
  assert.equal(totalCalls, 9, `expected exactly 9 publish calls across the 8 files, counted ${totalCalls}`);

  // The deferral itself has MOVED: it is no longer a per-call-site after(...)
  // wrapper — it now lives ONCE inside publishCafeEvent. Pin that a route file
  // does not hand-roll its own after(() => publishCafeEvent(...)) either,
  // which would double-defer and could re-open the synchronous-throw hazard
  // publishCafeEvent exists to absorb.
  for (const [rel] of expectations) {
    const stripped = stripComments(readSrc(rel));
    assert.ok(
      !/after\(\s*\(\)\s*=>\s*publishCafeEvent/.test(stripped),
      `${rel} must call publishCafeEvent(...) directly — never re-wrap it in a route-local after(() => ...)`,
    );
  }
});

test("NEGATIVE PIN: no file under app/api/print* or lib/print-queue-claim.ts calls broadcastCafeEvent (print lane untouched)", () => {
  const roots = ["app/api/print-host", "app/api/print-jobs"].map((d) =>
    path.join(REPO_ROOT, "apps/cafe", d),
  );
  const printFiles: string[] = [path.join(REPO_ROOT, "apps/cafe/lib/print-queue-claim.ts")];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      printFiles.push(full);
    }
  }
  for (const root of roots) walk(root);

  // Ordering-pins-need-existence-asserts: an empty sweep must not pass
  // vacuously. Assert the sweep actually found files before trusting its
  // absence result.
  assert.ok(printFiles.length > 0, "the print-lane sweep must find at least one file — an empty sweep proves nothing");

  const offenders: string[] = [];
  for (const full of printFiles) {
    const src = readFileSync(full, "utf8");
    if (src.includes("broadcastCafeEvent") || src.includes("publishCafeEvent")) {
      offenders.push(path.relative(REPO_ROOT, full));
    }
  }
  assert.deepEqual(offenders, [], `the print lane must never call broadcastCafeEvent/publishCafeEvent; found in: ${offenders.join(", ")}`);
});

test("PIN: hooks/use-realtime.ts is actually imported by the Kitchen page", () => {
  const pageSrc = readSrc(KITCHEN_PAGE);
  assert.ok(
    /from\s+["']@\/hooks\/use-realtime["']/.test(pageSrc),
    "kitchen/page.tsx must import from @/hooks/use-realtime",
  );
  assert.match(pageSrc, /useKitchenRealtime\(\)/, "kitchen/page.tsx must call useKitchenRealtime()");
});

test("PIN: the Kitchen board's poll is UNCHANGED — use-kitchen.ts still references REFETCH_INTERVALS.KITCHEN", () => {
  const hookSrc = readSrc(USE_KITCHEN);
  assert.match(hookSrc, /REFETCH_INTERVALS\.KITCHEN/, "use-kitchen.ts must still reference REFETCH_INTERVALS.KITCHEN — the socket is a supplement, never a replacement");
  // Positive landmark: the hook is real content, not a blinded/empty read.
  assert.match(hookSrc, /export function useKitchenBoard\(/, "positive landmark: use-kitchen.ts must export useKitchenBoard(");
});

// ── (6) GREP GATE ────────────────────────────────────────────────────────────

test("grep gate: lib/realtime-publish.ts contains no console.* CALL (a secret flows through it)", () => {
  const src = readSrc(REALTIME_PUBLISH);
  // Gate on an actual invocation shape (console.xxx() — a method call), built
  // by concatenation so this needle can never match the gate's own source
  // line. The file legitimately documents the rule in prose ("No console.*
  // either") without invoking it — the gate must catch a real call, not any
  // mention of the word, or it would reject its own compliant documentation.
  const callNeedle = new RegExp("console" + "\\s*\\.\\s*[a-z]+\\s*\\(");
  assert.ok(!callNeedle.test(src), "realtime-publish.ts must NOT contain a console.<method>(...) call anywhere");
  // Positive landmark: real content, not a blinded/empty read. Updated for
  // the new signature (broadcastCafeEvent is now async and returns Promise<void>).
  assert.match(src, /export async function broadcastCafeEvent\(/, "positive landmark: must export async function broadcastCafeEvent(");
  assert.match(src, /export function publishCafeEvent\(/, "positive landmark: must export publishCafeEvent(");
});

// ═══════════════════════════════════════════════════════════════════════════
// SOCKET SLICE 2 — lib/realtime-client.ts, use-print-host-wake.ts's cadence
// gate, print-queue.ts's publish sites, and the four-way EVENT_KINDS parity
// (now including "print-job").
// ═══════════════════════════════════════════════════════════════════════════

// ── (7) FAKE WEBSOCKET + realtime-client.ts DRIVER ─────────────────────────
//
// A minimal fake matching only what realtime-client.ts actually touches:
// `new WebSocket(url)`, `.readyState`, `.addEventListener(type, fn)`,
// `.send(data)` (may throw), `.close()`. Real client/protocol code (the
// module under test) runs unmodified over this fake transport — the fake
// itself contains no realtime-client logic.
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static reset(): void {
    FakeWebSocket.instances = [];
  }

  readyState = FakeWebSocket.CONNECTING;
  readonly url: string;
  readonly sent: unknown[] = [];
  private readonly listeners: Record<string, Array<(arg?: unknown) => void>> = {};
  /** When true, the next .send() call throws (simulates a dead pipe). */
  sendThrows = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (arg?: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }

  send(data: unknown): void {
    if (this.sendThrows) throw new Error("send on a dead pipe");
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close");
  }

  /** Test-only driver: move to OPEN and fire the "open" listeners. */
  triggerOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open");
  }

  /** Test-only driver: fire "message" with a JSON-encoded {kind} envelope,
   *  or a raw string (e.g. "pong") when `raw` is passed. */
  triggerMessage(kindOrRaw: string, opts?: { raw?: boolean }): void {
    const data = opts?.raw ? kindOrRaw : JSON.stringify({ kind: kindOrRaw });
    this.dispatch("message", { data });
  }

  private dispatch(type: string, arg?: unknown): void {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(arg);
  }
}

/** Runs `body` with `globalThis.WebSocket` swapped for the fake and
 *  `NEXT_PUBLIC_REALTIME_URL` set (or deliberately left unset), always
 *  restoring both afterward regardless of how `body` exits. realtime-client.ts
 *  reads `process.env.NEXT_PUBLIC_REALTIME_URL` PER CALL (not at import time),
 *  so this env swap is honoured on every case without needing module reload. */
async function withFakeSocket(
  { url }: { url: string | undefined },
  body: () => void | Promise<void>,
): Promise<void> {
  const savedWs = (globalThis as { WebSocket?: unknown }).WebSocket;
  const savedUrl = process.env.NEXT_PUBLIC_REALTIME_URL;
  FakeWebSocket.reset();
  (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  if (url === undefined) delete process.env.NEXT_PUBLIC_REALTIME_URL;
  else process.env.NEXT_PUBLIC_REALTIME_URL = url;
  try {
    await body();
  } finally {
    (globalThis as { WebSocket: unknown }).WebSocket = savedWs;
    if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_REALTIME_URL;
    else process.env.NEXT_PUBLIC_REALTIME_URL = savedUrl;
  }
}

// ── (8) isRealtimeHealthy() FAILS CLOSED ────────────────────────────────────

test("isRealtimeHealthy: URL unset => false, and subscribing constructs NO WebSocket at all", async () => {
  await withFakeSocket({ url: undefined }, () => {
    assert.equal(isRealtimeHealthy(), false, "no URL configured must read as unhealthy");
    const unsub = subscribeRealtime(() => {});
    try {
      assert.equal(isRealtimeHealthy(), false, "still unhealthy after subscribing with no URL");
      assert.equal(FakeWebSocket.instances.length, 0, "connect() must not construct a WebSocket when the URL is unset");
    } finally {
      unsub();
    }
  });
});

test("isRealtimeHealthy: subscribed but the socket never opened (readyState CONNECTING) => false", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    const unsub = subscribeRealtime(() => {});
    try {
      assert.equal(FakeWebSocket.instances.length, 1, "one socket must have been constructed");
      assert.equal(FakeWebSocket.instances[0].readyState, FakeWebSocket.CONNECTING, "the fake starts CONNECTING, never auto-opens");
      assert.equal(isRealtimeHealthy(), false, "a socket stuck at CONNECTING must read as unhealthy");
    } finally {
      unsub();
    }
  });
});

test("isRealtimeHealthy: socket OPEN and a frame just arrived => true", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    const unsub = subscribeRealtime(() => {});
    try {
      const ws = FakeWebSocket.instances[0];
      ws.triggerOpen();
      // The open handshake alone is proof of life (lastSeenAt = Date.now() on
      // "open" — see realtime-client.ts), so this must already read healthy
      // before any message arrives.
      assert.equal(isRealtimeHealthy(), true, "a completed handshake is itself proof of life");
      ws.triggerMessage("order-changed");
      assert.equal(isRealtimeHealthy(), true, "OPEN + a fresh inbound frame must read as healthy");
    } finally {
      unsub();
    }
  });
});

test("isRealtimeHealthy: socket OPEN but proof-of-life is STALE (older than REALTIME_HEALTH_TTL_MS) => false — the half-open-socket detector", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    mock.timers.enable({ apis: ["Date"] });
    try {
      const unsub = subscribeRealtime(() => {});
      try {
        const ws = FakeWebSocket.instances[0];
        ws.triggerOpen();
        assert.equal(isRealtimeHealthy(), true, "freshly opened must be healthy");
        // Advance the clock past the TTL WITHOUT any inbound frame — this is
        // exactly the half-open case: the OS still reports OPEN, but nothing
        // has proven the pipe carries traffic for longer than the TTL allows.
        mock.timers.tick(REALTIME_HEALTH_TTL_MS + 1);
        assert.equal(ws.readyState, FakeWebSocket.OPEN, "readyState alone stays OPEN — the OS never learns the pipe is dead");
        assert.equal(isRealtimeHealthy(), false, "stale proof-of-life past REALTIME_HEALTH_TTL_MS must read as unhealthy even though readyState is still OPEN");
      } finally {
        unsub();
      }
    } finally {
      mock.timers.reset();
    }
  });
});

test("isRealtimeHealthy: after the socket closes => false", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    const unsub = subscribeRealtime(() => {});
    try {
      const ws = FakeWebSocket.instances[0];
      ws.triggerOpen();
      assert.equal(isRealtimeHealthy(), true, "sanity: healthy before close");
      ws.close();
      assert.equal(isRealtimeHealthy(), false, "a closed socket must read as unhealthy");
    } finally {
      unsub();
    }
  });
});

test("isolation check: subscribe/unsubscribe cycles do not leak state between cases (health starts false and a fresh socket is opened each time)", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    const unsubA = subscribeRealtime(() => {});
    const wsA = FakeWebSocket.instances[0];
    wsA.triggerOpen();
    wsA.triggerMessage("order-changed");
    assert.equal(isRealtimeHealthy(), true, "case A ends healthy");
    unsubA();
    assert.equal(isRealtimeHealthy(), false, "unsubscribing the last listener must reset health to false immediately");

    FakeWebSocket.reset();
    const unsubB = subscribeRealtime(() => {});
    try {
      assert.equal(FakeWebSocket.instances.length, 1, "re-subscribing after the last unsubscribe must open a FRESH socket, not reuse the old one");
      assert.equal(isRealtimeHealthy(), false, "the fresh socket must start unhealthy (CONNECTING) — no leaked proof-of-life from case A");
    } finally {
      unsubB();
    }
  });
});

// ── (9) REFCOUNTING / SINGLE SOCKET ─────────────────────────────────────────

test("refcounting: two subscribers share exactly ONE WebSocket", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    const unsub1 = subscribeRealtime(() => {});
    const unsub2 = subscribeRealtime(() => {});
    try {
      assert.equal(FakeWebSocket.instances.length, 1, "a second subscriber must NOT construct a second WebSocket");
    } finally {
      unsub1();
      unsub2();
    }
  });
});

test("refcounting: unsubscribing one of two keeps the socket open; unsubscribing BOTH closes it", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    const unsub1 = subscribeRealtime(() => {});
    const unsub2 = subscribeRealtime(() => {});
    const ws = FakeWebSocket.instances[0];
    ws.triggerOpen();
    unsub1();
    assert.equal(ws.readyState, FakeWebSocket.OPEN, "one remaining subscriber must keep the socket open");
    assert.equal(isRealtimeHealthy(), true, "still healthy with one subscriber left");
    unsub2();
    assert.equal(ws.readyState, FakeWebSocket.CLOSED, "the LAST unsubscribe must close the socket");
    assert.equal(isRealtimeHealthy(), false, "no subscribers left => unhealthy");
  });
});

test("refcounting: re-subscribing after the last unsubscribe opens a NEW socket (React StrictMode double-mount / remount)", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    const firstUnsub = subscribeRealtime(() => {});
    const firstSocket = FakeWebSocket.instances[0];
    firstUnsub();
    assert.equal(firstSocket.readyState, FakeWebSocket.CLOSED, "sanity: first socket closed on last unsubscribe");

    const secondUnsub = subscribeRealtime(() => {});
    try {
      assert.equal(FakeWebSocket.instances.length, 2, "a remount must construct a second, independent WebSocket instance");
      assert.notEqual(FakeWebSocket.instances[1], firstSocket, "the new socket must not be the same (closed) instance");
    } finally {
      secondUnsub();
    }
  });
});

test("refcounting: a listener that THROWS must not prevent the other listeners from receiving the same frame", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    const received: string[] = [];
    const unsub1 = subscribeRealtime(() => {
      throw new Error("listener 1 is broken");
    });
    const unsub2 = subscribeRealtime((kind) => {
      received.push(kind);
    });
    try {
      const ws = FakeWebSocket.instances[0];
      ws.triggerOpen();
      assert.doesNotThrow(() => ws.triggerMessage("order-changed"), "a throwing listener must not escape the fan-out loop");
      assert.deepEqual(received, ["order-changed"], "the second (well-behaved) listener must still receive the frame");
    } finally {
      unsub1();
      unsub2();
    }
  });
});

// ── (10) PING/PONG HEALTH LOOP ───────────────────────────────────────────────

test("ping/pong: on open, a ping is sent after REALTIME_PING_INTERVAL_MS", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
    try {
      const unsub = subscribeRealtime(() => {});
      try {
        const ws = FakeWebSocket.instances[0];
        ws.triggerOpen();
        assert.deepEqual(ws.sent, [], "no ping before the interval elapses");
        mock.timers.tick(REALTIME_PING_INTERVAL_MS);
        assert.deepEqual(ws.sent, ["ping"], "exactly one ping must be sent once the interval elapses");
      } finally {
        unsub();
      }
    } finally {
      mock.timers.reset();
    }
  });
});

test("ping/pong: a pong (or ANY inbound frame) clears the pending pong deadline and refreshes proof-of-life", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
    try {
      const unsub = subscribeRealtime(() => {});
      try {
        const ws = FakeWebSocket.instances[0];
        ws.triggerOpen();
        mock.timers.tick(REALTIME_PING_INTERVAL_MS); // ping goes out, pong deadline arms
        assert.deepEqual(ws.sent, ["ping"]);
        // A raw "pong" answer (not JSON) — this is the deadline-clearing frame.
        ws.triggerMessage("pong", { raw: true });
        // Advance PAST what would have been the pong timeout — if the pong had
        // NOT cleared the deadline, this tick would have torn the socket down.
        mock.timers.tick(REALTIME_PONG_TIMEOUT_MS + 1);
        assert.equal(ws.readyState, FakeWebSocket.OPEN, "the pong must have cleared the deadline — the socket must still be open");
        assert.equal(isRealtimeHealthy(), true, "and therefore still healthy");
      } finally {
        unsub();
      }
    } finally {
      mock.timers.reset();
    }
  });
});

test("ping/pong: NO pong within REALTIME_PONG_TIMEOUT_MS tears the socket down and isRealtimeHealthy() goes false — the half-open detector", async () => {
  await withFakeSocket({ url: "wss://realtime.example.com/join" }, () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
    try {
      const unsub = subscribeRealtime(() => {});
      try {
        const ws = FakeWebSocket.instances[0];
        ws.triggerOpen();
        mock.timers.tick(REALTIME_PING_INTERVAL_MS); // ping sent, deadline armed
        assert.deepEqual(ws.sent, ["ping"]);
        assert.equal(isRealtimeHealthy(), true, "still healthy immediately after the ping (open proof-of-life not yet stale)");
        // No pong arrives. Advance past the pong timeout.
        mock.timers.tick(REALTIME_PONG_TIMEOUT_MS + 1);
        assert.equal(isRealtimeHealthy(), false, "a missed pong must tear the socket down and read as unhealthy — this is THE half-open-socket detector the whole design exists for");
      } finally {
        unsub();
      }
    } finally {
      mock.timers.reset();
    }
  });
});

// ── (11) PRINT CADENCE GATE (source pins — the hook needs React to run) ─────

test("PIN: use-print-host-wake.ts imports isRealtimeHealthy and PRINT_WAKE_SOCKET_MS", () => {
  const src = readSrc(USE_PRINT_HOST_WAKE);
  assert.match(src, /import\s*\{\s*isRealtimeHealthy\s*\}\s*from\s*["']@\/lib\/realtime-client["']/, "must import isRealtimeHealthy from @/lib/realtime-client");
  assert.match(src, /PRINT_WAKE_SOCKET_MS/, "must reference PRINT_WAKE_SOCKET_MS");
});

test("PIN: refetchInterval returns PRINT_WAKE_SOCKET_MS ONLY when BOTH active AND isRealtimeHealthy() hold; otherwise FAST/SLOW exactly as before (mutation-critical shape)", () => {
  const stripped = stripComments(readSrc(USE_PRINT_HOST_WAKE));
  // Positive landmark: the function must actually exist as a real body, not a
  // blinded/empty read.
  const fnMatch = stripped.match(/refetchInterval:\s*\(\)\s*=>\s*\{[\s\S]*?\n    \},/);
  assert.ok(fnMatch, "positive landmark: refetchInterval must be declared as an arrow function with this exact shape");
  const body = fnMatch![0];

  // The gated branch: BOTH terms present, ANDed, guarding the socket cadence.
  assert.match(
    body,
    /if\s*\(\s*active\s*&&\s*isRealtimeHealthy\(\)\s*\)\s*return\s*PRINT_WAKE_SOCKET_MS;/,
    "removing the isRealtimeHealthy() term (or the `active &&`) from this exact guard must go red — this is the mutation-critical line",
  );
  // The fallback: unchanged FAST/SLOW ternary, exactly as before the socket existed.
  assert.match(
    body,
    /return\s+active\s*\?\s*PRINT_WAKE_FAST_MS\s*:\s*PRINT_WAKE_SLOW_MS;/,
    "the fallback must still be the plain active ? FAST : SLOW ternary — unchanged by the socket gate",
  );
});

test("PIN: PRINT_WAKE_SOCKET_MS is 60000 and is strictly greater than PRINT_WAKE_FAST_MS", () => {
  assert.equal(PRINT_WAKE_SOCKET_MS, 60000, "PRINT_WAKE_SOCKET_MS must be exactly 60000ms (60s)");
  assert.ok(PRINT_WAKE_SOCKET_MS > PRINT_WAKE_FAST_MS, "the socket-healthy cadence must be strictly SLOWER than FAST — it is a safety net, not a replacement for the discovery poll");
});

test("NEGATIVE PIN (vision-guarded): the wake hook's own FAST/SLOW poll constants were NOT deleted — PRINT_WAKE_FAST_MS and PRINT_WAKE_SLOW_MS are still referenced in the file", () => {
  const src = readSrc(USE_PRINT_HOST_WAKE);
  // Positive landmark first: the hook file is real content with its query wired.
  assert.match(src, /export function usePrintHostWake\(/, "positive landmark: usePrintHostWake must still be exported");
  assert.match(src, /PRINT_WAKE_FAST_MS/, "PRINT_WAKE_FAST_MS must still be referenced — the poll is the safety net and must never be removed");
  assert.match(src, /PRINT_WAKE_SLOW_MS/, "PRINT_WAKE_SLOW_MS must still be referenced — the poll is the safety net and must never be removed");
});

// ── (12) EVENT-KIND PARITY, UPDATED FOR "print-job" ─────────────────────────

test("parity: CAFE_EVENT_KINDS deep-equals the Worker's EVENT_KINDS array AND both contain \"print-job\" (socket slice 2)", () => {
  const workerSrc = readSrc(WORKER_SRC);
  const match = workerSrc.match(/const EVENT_KINDS = \[([^\]]*)\] as const;/);
  assert.ok(match, "positive landmark: the Worker must declare `const EVENT_KINDS = [...] as const;`");
  const kinds = Array.from(match![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  assert.ok(kinds.length > 0, "the parsed EVENT_KINDS list must not be empty");
  assert.deepEqual([...CAFE_EVENT_KINDS], kinds, "CAFE_EVENT_KINDS must match the Worker's EVENT_KINDS exactly");
  assert.ok(kinds.includes("print-job"), "the Worker's EVENT_KINDS must include \"print-job\" (socket slice 2)");
  assert.ok((CAFE_EVENT_KINDS as readonly string[]).includes("print-job"), "CAFE_EVENT_KINDS must include \"print-job\"");
});

test("parity: PRINT_EVENT_KINDS is a strict subset of CAFE_EVENT_KINDS, contains \"print-job\", and shares no kind with KITCHEN_EVENT_KINDS", () => {
  const hookSrc = readSrc(USE_REALTIME);
  const printMatch = hookSrc.match(/const PRINT_EVENT_KINDS = \[([^\]]*)\] as const;/);
  assert.ok(printMatch, "positive landmark: use-realtime.ts must declare `const PRINT_EVENT_KINDS = [...] as const;`");
  const printKinds = Array.from(printMatch![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  assert.ok(printKinds.length > 0, "PRINT_EVENT_KINDS must not be empty");

  for (const k of printKinds) {
    assert.ok((CAFE_EVENT_KINDS as readonly string[]).includes(k), `PRINT_EVENT_KINDS entry "${k}" must be one of CAFE_EVENT_KINDS`);
  }
  assert.ok(printKinds.length < CAFE_EVENT_KINDS.length, "PRINT_EVENT_KINDS must be a STRICT subset, not the full set");
  assert.ok(printKinds.includes("print-job"), "PRINT_EVENT_KINDS must contain \"print-job\"");

  const kitchenMatch = hookSrc.match(/const KITCHEN_EVENT_KINDS = \[([^\]]*)\] as const;/);
  assert.ok(kitchenMatch, "positive landmark: use-realtime.ts must declare `const KITCHEN_EVENT_KINDS = [...] as const;`");
  const kitchenKinds = Array.from(kitchenMatch![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  assert.ok(kitchenKinds.length > 0, "KITCHEN_EVENT_KINDS must not be empty");

  assert.ok(!kitchenKinds.includes("print-job"), "KITCHEN_EVENT_KINDS must NOT contain \"print-job\" — the board does not care about print jobs");
  for (const k of kitchenKinds) {
    assert.ok(!printKinds.includes(k), `PRINT_EVENT_KINDS must NOT contain kitchen kind "${k}"`);
  }
});

// ── (13) print-queue.ts PUBLISH SITES ────────────────────────────────────────

test("PIN: print-queue.ts calls publishCafeEvent(\"print-job\") at exactly the THREE queued outcomes, and NOT on the no-host / already-resolved paths", () => {
  const src = readSrc(PRINT_QUEUE);
  const stripped = stripComments(src);

  // Positive landmark: real content.
  assert.match(stripped, /export async function enqueuePrintJob\(/, "positive landmark: enqueuePrintJob must be exported");

  const callRe = /publishCafeEvent\(\s*"print-job"\s*\)/g;
  const calls = stripped.match(callRe) ?? [];
  assert.equal(calls.length, 3, `print-queue.ts must call publishCafeEvent("print-job") exactly 3 times, counted ${calls.length}`);

  // (a) the jobKey-collision race re-nudge — outcome "queued" (duplicate:true).
  const dupBlock = stripped.match(/if \(existing\.status !== "queued"\)[\s\S]*?return \{ outcome: "queued", id: String\(existing\._id\), duplicate: true \};/);
  assert.ok(dupBlock, "positive landmark: the jobKey-collision branch must have this exact shape");
  assert.match(dupBlock![0], /publishCafeEvent\(\s*"print-job"\s*\)/, "the jobKey-collision re-nudge must publish before returning the duplicate-queued outcome");

  // (b) the re-read-failed catch — outcome "queued" (duplicate:false).
  const catchBlock = stripped.match(/\} catch \{\s*publishCafeEvent\(\s*"print-job"\s*\);\s*return \{ outcome: "queued", id: createdId, duplicate: false \};\s*\}/);
  assert.ok(catchBlock, "the re-read-failed catch must publish then return outcome:\"queued\" — a transient re-read failure must not suppress the nudge for a write that already committed");

  // (c) the main success tail — outcome "queued" (duplicate:false), after the
  // host-still-there re-read confirms a host is genuinely waiting.
  const tailBlock = stripped.match(/publishCafeEvent\(\s*"print-job"\s*\);\s*return \{ outcome: "queued", id: createdId, duplicate: false \};\s*\}/);
  assert.ok(tailBlock, "the main success tail must publish immediately before its own return outcome:\"queued\"");

  // NEGATIVE, vision-guarded: neither "no-host" nor "already-resolved" return
  // site may be preceded by a publish call on the same statement/line — those
  // outcomes mean nothing is left waiting for the host (either no host is
  // configured, or the job already resolved under a prior key), so a nudge
  // there would be pointless at best.
  const noHostReturns = [...stripped.matchAll(/return \{ outcome: "no-host" \};/g)];
  assert.ok(noHostReturns.length > 0, "vision guard: the sweep must actually find \"no-host\" return sites — an empty match proves nothing");
  for (const m of noHostReturns) {
    const before = stripped.slice(Math.max(0, m.index! - 200), m.index!);
    assert.ok(!/publishCafeEvent/.test(before.slice(-80)), "a \"no-host\" outcome must not be immediately preceded by a publishCafeEvent call");
  }
  const alreadyResolvedReturns = [...stripped.matchAll(/return \{ outcome: "already-resolved"[^}]*\};/g)];
  assert.ok(alreadyResolvedReturns.length > 0, "vision guard: the sweep must actually find \"already-resolved\" return sites — an empty match proves nothing");
  for (const m of alreadyResolvedReturns) {
    const before = stripped.slice(Math.max(0, m.index! - 200), m.index!);
    assert.ok(!/publishCafeEvent/.test(before.slice(-80)), "an \"already-resolved\" outcome must not be immediately preceded by a publishCafeEvent call");
  }
});
