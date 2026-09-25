// Realtime socket slice 1 — pins over lib/realtime-publish.ts (the server-only
// publish helper), hooks/use-realtime.ts (the client hook), and their contract
// with workers/realtime/src/index.ts (outside the npm workspace, cannot
// import either). Same readSrc + stripComments idiom as kitchen-paths.test.ts;
// same Worker-parity + grep-gate idiom as apps/hub/lib/heartbeat-hmac.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import path from "node:path";

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

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const REALTIME_PUBLISH = "apps/cafe/lib/realtime-publish.ts";
const USE_REALTIME = "apps/cafe/hooks/use-realtime.ts";
const WORKER_SRC = "workers/realtime/src/index.ts";
const WRANGLER_JSONC = "workers/realtime/wrangler.jsonc";
const KITCHEN_PAGE = "apps/cafe/app/(dashboard)/kitchen/page.tsx";
const USE_KITCHEN = "apps/cafe/hooks/use-kitchen.ts";

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
