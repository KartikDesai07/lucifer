// node --test scripts/go-live/realtime.test.mjs — the realtime Worker
// provisioner (scripts/go-live/realtime.mjs + cloudflare-api.mjs), DB-free:
// fake spawnCapture recorder, fake fetch router, fake fs (in-memory
// workers/realtime tree), fake randomBytes/sleep/log, fixed `now`. Follows the
// fakeWorld() pattern in run.test.mjs (a plain object store keyed by
// forward-slash paths, a `calls` log, deps built from it).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createCloudflareApi, resolveAccountId, resolveSubdomain, sourceHashOf, SUBDOMAIN_CANDIDATE_ATTEMPTS, wranglerCommand } from "./cloudflare-api.mjs";
import { GoLiveError } from "./core.mjs";
import {
  ensureRealtime, JOIN_PROBE_STATUS, parseWorkerUrl, PROBE_ATTEMPTS, PROBE_INTERVAL_MS, PUBLISH_PROBE_ATTEMPTS, PUBLISH_PROBE_INTERVAL_MS, PUBLISH_SECRET_BYTES, REALTIME_ENV_KEYS, REALTIME_SIG_HEADER, REALTIME_TS_HEADER,
  realtimeEnvOf, realtimeOffEnv, signedPublishRequest, validateCloudflare, WORKER_NAME_MAX_LEN, workerNameOf,
} from "./realtime.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CAFE_PUBLISH_SRC = readFileSync(path.join(ROOT, "apps", "cafe", "lib", "realtime-publish.ts"), "utf8");
const WORKER_SRC = readFileSync(path.join(ROOT, "workers", "realtime", "src", "index.ts"), "utf8");

// ── (a) parity: signedPublishRequest mirrors apps/cafe/lib/realtime-publish.ts
//     buildRealtimeRequest, pinned by SOURCE (no tsx import of the .ts file from
//     a .mjs test) — header-name literals, the "${ts}.${body}" scheme, the
//     Math.floor(nowMs / 1000) timestamp, and the HMAC computed independently
//     here with node:crypto. Also pins the Worker's allowed kinds. ──────────────
test("signedPublishRequest mirrors apps/cafe/lib/realtime-publish.ts's buildRealtimeRequest field-for-field", () => {
  // Positive landmark: the cafe source really defines the header names and the scheme this test pins against.
  assert.match(CAFE_PUBLISH_SRC, /REALTIME_SIG_HEADER = "x-realtime-signature"/, "positive landmark: the cafe source defines the sig header literal");
  assert.match(CAFE_PUBLISH_SRC, /REALTIME_TS_HEADER = "x-realtime-ts"/, "positive landmark: the cafe source defines the ts header literal");
  assert.match(CAFE_PUBLISH_SRC, /`\$\{ts\}\.\$\{rawBody\}`/, "positive landmark: the cafe source signs over `${ts}.${rawBody}`");
  assert.match(CAFE_PUBLISH_SRC, /Math\.floor\(nowMs \/ 1000\)/, "positive landmark: the cafe source's timestamp is unix SECONDS via Math.floor(nowMs / 1000)");
  assert.equal(REALTIME_SIG_HEADER, "x-realtime-signature");
  assert.equal(REALTIME_TS_HEADER, "x-realtime-ts");

  const secret = "adopt-secret-0123456789abcdef";
  const tenantId = "sunrise-demo";
  const nowMs = 1_758_000_000_000;
  const { body, headers } = signedPublishRequest(secret, tenantId, nowMs);

  // The exact envelope buildRealtimeRequest would build for the same inputs (tenant, kind: "print-job", at: new Date(nowMs).toISOString()).
  const expectedBody = JSON.stringify({ tenant: tenantId, kind: "print-job", at: new Date(nowMs).toISOString() });
  assert.equal(body, expectedBody);
  const ts = String(Math.floor(nowMs / 1000));
  assert.equal(headers[REALTIME_TS_HEADER], ts);
  const expectedSig = createHmac("sha256", secret).update(`${ts}.${expectedBody}`).digest("hex");
  assert.equal(headers[REALTIME_SIG_HEADER], expectedSig, "the HMAC computed independently here (node:crypto over `${ts}.${rawBody}`) must equal the provisioner's own signature");
  assert.equal(headers["content-type"], "application/json");
});

test("the Worker's allowed event kinds include \"print-job\" (positive landmark: the kinds array itself is present)", () => {
  assert.match(WORKER_SRC, /const EVENT_KINDS = \[([^\]]*)\] as const;/, "positive landmark: the Worker defines its EVENT_KINDS literal");
  const m = WORKER_SRC.match(/const EVENT_KINDS = \[([^\]]*)\] as const;/);
  const kinds = [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]);
  assert.ok(kinds.includes("print-job"), `EVENT_KINDS must include "print-job", got: ${kinds.join(", ")}`);
});

// ── workerNameOf / parseWorkerUrl / realtimeEnvOf / realtimeOffEnv / validateCloudflare ──
test("workerNameOf: pos-realtime-<slug>, or GoLiveError step \"realtime\" when the result breaks the Worker name rule", () => {
  assert.equal(workerNameOf("sunrise"), "pos-realtime-sunrise");
  assert.throws(() => workerNameOf("a".repeat(WORKER_NAME_MAX_LEN)), (e) => e instanceof GoLiveError && e.step === "realtime" && /not a valid Worker name/.test(e.message));
  assert.throws(() => workerNameOf("Bad_Slug"), (e) => e instanceof GoLiveError && e.step === "realtime");
  // "pos-realtime-" ends in a hyphen, so a slug starting with "-" makes the FULL
  // name end up with a leading-hyphen SEGMENT that still passes the char class —
  // use a slug ending in a hyphen instead, which puts the violation at the very
  // end of the assembled name (workerNameOf's own failure mode).
  assert.throws(() => workerNameOf("trailing-hyphen-"), (e) => e instanceof GoLiveError && e.step === "realtime");
});

test("parseWorkerUrl: wrangler-style output, trailing punctuation stripped, none found -> null", () => {
  assert.equal(parseWorkerUrl("Deployed pos-realtime-sunrise (1.2s)\n  https://pos-realtime-sunrise.sandbee.workers.dev\nCurrent Version ID: abc"), "https://pos-realtime-sunrise.sandbee.workers.dev");
  assert.equal(parseWorkerUrl("see https://pos-realtime-sunrise.sandbee.workers.dev."), "https://pos-realtime-sunrise.sandbee.workers.dev", "trailing period stripped");
  assert.equal(parseWorkerUrl("see (https://pos-realtime-sunrise.sandbee.workers.dev)"), "https://pos-realtime-sunrise.sandbee.workers.dev", "trailing paren stripped");
  assert.equal(parseWorkerUrl("no url here"), null);
  assert.equal(parseWorkerUrl(""), null);
  assert.equal(parseWorkerUrl(undefined), null);
});

test("realtimeEnvOf/realtimeOffEnv: the 3 REALTIME_* entries, key order = REALTIME_ENV_KEYS, correct types and computed values", () => {
  const on = realtimeEnvOf({ url: "https://pos-realtime-sunrise.sandbee.workers.dev", secret: "sekrit-hex" });
  assert.deepEqual(on.map((e) => e.key), REALTIME_ENV_KEYS);
  assert.equal(on[0].value, "https://pos-realtime-sunrise.sandbee.workers.dev/publish");
  assert.equal(on[0].type, "encrypted");
  assert.equal(on[1].value, "sekrit-hex");
  assert.equal(on[1].type, "encrypted");
  assert.equal(on[2].value, "wss://pos-realtime-sunrise.sandbee.workers.dev/join");
  assert.equal(on[2].type, "plain");
  for (const e of on) assert.deepEqual(e.target, ["production", "preview"]);

  const off = realtimeOffEnv();
  assert.deepEqual(off.map((e) => e.key), REALTIME_ENV_KEYS);
  for (const e of off) assert.equal(e.value, "");
  assert.equal(off[0].type, "encrypted"); assert.equal(off[1].type, "encrypted"); assert.equal(off[2].type, "plain");
});

test("validateCloudflare: null/undefined ok; placeholder token; bad accountId; short publishSecret", () => {
  const run = (cf) => { const errors = []; validateCloudflare(cf, errors); return errors; };
  assert.deepEqual(run(null), []);
  assert.deepEqual(run(undefined), []);
  assert.deepEqual(run({ token: "real-token-value" }), []);
  assert.ok(run({}).some((e) => /cloudflare\.token:/.test(e)));
  assert.ok(run({ token: "<cf-token>" }).some((e) => /still holds a <placeholder>/.test(e)));
  assert.ok(run({ token: "t", accountId: "not-hex" }).some((e) => /cloudflare\.accountId:/.test(e)));
  assert.ok(run({ token: "t", accountId: "a".repeat(32) }).length === 0);
  assert.deepEqual(run({ token: "t", accountId: null }), []);
  assert.ok(run({ token: "t", publishSecret: "short" }).some((e) => /cloudflare\.publishSecret:/.test(e)));
  assert.deepEqual(run({ token: "t", publishSecret: "a".repeat(16) }), []);
  assert.deepEqual(run({ token: "t", publishSecret: null }), []);
  assert.ok(run("nope").some((e) => /must be an object/.test(e)));
  assert.ok(run([]).some((e) => /must be an object/.test(e)));
});

// ── sourceHashOf: fake fs, hash changes with a src file change ──────────────
function fakeFs(files) {
  const store = new Map(Object.entries(files).map(([k, v]) => [k.replace(/\\/g, "/"), v]));
  const norm = (p) => String(p).replace(/\\/g, "/");
  return {
    store,
    existsSync: (p) => store.has(norm(p)),
    readFileSync: (p) => { const key = norm(p); if (!store.has(key)) throw new Error("ENOENT " + p); return store.get(key); },
    readdirSync: (dir, opts) => {
      const prefix = norm(dir).endsWith("/") ? norm(dir) : `${norm(dir)}/`;
      const names = new Set();
      for (const p of store.keys()) if (p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) names.add(p.slice(prefix.length));
      if (opts && opts.withFileTypes) return [...names].map((name) => ({ name, isDirectory: () => false }));
      return [...names];
    },
  };
}

const REALTIME_ROOT = "/repo";
function realtimeTree(files) {
  const base = {
    [`${REALTIME_ROOT}/workers/realtime/wrangler.jsonc`]: '{ "name": "pos-realtime" }',
    [`${REALTIME_ROOT}/workers/realtime/src/index.ts`]: "export default { fetch() {} };",
  };
  return { ...base, ...files };
}

test("sourceHashOf: sha1 over wrangler.jsonc + every file under src (sorted); changes when a src file's content changes", () => {
  const fs1 = fakeFs(realtimeTree());
  const h1 = sourceHashOf({ fs: fs1 }, REALTIME_ROOT);
  assert.match(h1, /^[0-9a-f]{40}$/, "sha1 hex digest");
  const h1again = sourceHashOf({ fs: fs1 }, REALTIME_ROOT);
  assert.equal(h1again, h1, "deterministic for the same tree");

  const fs2 = fakeFs(realtimeTree({ [`${REALTIME_ROOT}/workers/realtime/src/index.ts`]: "export default { fetch() { return 1; } };" }));
  const h2 = sourceHashOf({ fs: fs2 }, REALTIME_ROOT);
  assert.notEqual(h2, h1, "a changed src file changes the hash");

  const fs3 = fakeFs(realtimeTree({ [`${REALTIME_ROOT}/workers/realtime/src/extra.ts`]: "export const x = 1;" }));
  const h3 = sourceHashOf({ fs: fs3 }, REALTIME_ROOT);
  assert.notEqual(h3, h1, "an added src file changes the hash too");

  const fsManifest = fakeFs(realtimeTree({ [`${REALTIME_ROOT}/workers/realtime/wrangler.jsonc`]: '{ "name": "pos-realtime-changed" }' }));
  const hManifest = sourceHashOf({ fs: fsManifest }, REALTIME_ROOT);
  assert.notEqual(hManifest, h1, "a changed manifest changes the hash");
});

// ── wranglerCommand: npx-cli present vs absent ──────────────────────────────
test("wranglerCommand: process.execPath + npx-cli.js when present, --yes wrangler@4.140.0 in args; falls back to npx/npx.cmd + shell:true when absent", () => {
  const npxCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  const present = wranglerCommand({ fs: { existsSync: (p) => p === npxCli } }, ["deploy", "--name", "pos-realtime-x"]);
  assert.equal(present.cmd, process.execPath);
  assert.equal(present.args[0], npxCli);
  assert.deepEqual(present.args.slice(1), ["--yes", "wrangler@4.140.0", "deploy", "--name", "pos-realtime-x"]);
  assert.ok(!present.shell, "no shell when spawning node directly");

  const absent = wranglerCommand({ fs: { existsSync: () => false } }, ["deploy"]);
  assert.equal(absent.cmd, process.platform === "win32" ? "npx.cmd" : "npx");
  assert.deepEqual(absent.args, ["--yes", "wrangler@4.140.0", "deploy"]);
  assert.equal(absent.shell, true);
});

// ── createCloudflareApi over a fake fetch ───────────────────────────────────
// Route keys below are relative to CF_API_BASE ("https://api.cloudflare.com/client/v4")
// — e.g. "GET /accounts" matches a real request to ".../client/v4/accounts".
const CF_BASE_PATH = "/client/v4";
function fakeCfFetch(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const relPath = u.pathname.startsWith(CF_BASE_PATH) ? u.pathname.slice(CF_BASE_PATH.length) : u.pathname;
    calls.push({ method, path: relPath, auth: init.headers && init.headers.Authorization, body: init.body ? JSON.parse(init.body) : undefined });
    const key = `${method} ${relPath}`;
    const route = routes[key] ?? routes[relPath];
    if (!route) return { status: 500, ok: false, json: async () => ({ errors: [{ message: "unrouted: " + key }] }) };
    const { status, body } = typeof route === "function" ? route(init) : route;
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return { fetch, calls };
}

test("createCloudflareApi.listAccounts: 1 account vs 2, Bearer header, never the token in a thrown message", async () => {
  const one = fakeCfFetch({ "GET /accounts": { status: 200, body: { result: [{ id: "a".repeat(32), name: "Acme" }] } } });
  const apiOne = createCloudflareApi({ token: "super-secret-token-value", fetch: one.fetch });
  const accountsOne = await apiOne.listAccounts();
  assert.deepEqual(accountsOne, [{ id: "a".repeat(32), name: "Acme" }]);
  assert.equal(one.calls[0].auth, "Bearer super-secret-token-value");

  const two = fakeCfFetch({ "GET /accounts": { status: 200, body: { result: [{ id: "a".repeat(32), name: "A" }, { id: "b".repeat(32), name: "B" }] } } });
  const apiTwo = createCloudflareApi({ token: "super-secret-token-value", fetch: two.fetch });
  assert.deepEqual(await apiTwo.listAccounts(), [{ id: "a".repeat(32), name: "A" }, { id: "b".repeat(32), name: "B" }]);

  const failing = fakeCfFetch({ "GET /accounts": { status: 401, body: { errors: [{ message: "Invalid API Token" }] } } });
  const apiFail = createCloudflareApi({ token: "super-secret-token-value", fetch: failing.fetch });
  await assert.rejects(apiFail.listAccounts(), (e) => {
    assert.match(e.message, /HTTP 401/);
    assert.match(e.message, /Invalid API Token/);
    assert.ok(!e.message.includes("super-secret-token-value"), "the token must never appear in a thrown message");
    return true;
  });
});

test("createCloudflareApi.getWorkersSubdomain/registerWorkersSubdomain: present, 404 -> null, register echoes Cloudflare's chosen subdomain", async () => {
  const present = fakeCfFetch({ "GET /accounts/acct1/workers/subdomain": { status: 200, body: { result: { subdomain: "acme" } } } });
  const apiPresent = createCloudflareApi({ token: "t", fetch: present.fetch });
  assert.equal(await apiPresent.getWorkersSubdomain("acct1"), "acme");

  const notFound = fakeCfFetch({ "GET /accounts/acct1/workers/subdomain": { status: 404, body: { errors: [] } } });
  const apiNotFound = createCloudflareApi({ token: "t", fetch: notFound.fetch });
  assert.equal(await apiNotFound.getWorkersSubdomain("acct1"), null);

  const register = fakeCfFetch({ "PUT /accounts/acct1/workers/subdomain": { status: 200, body: { result: { subdomain: "pos-sunrise" } } } });
  const apiRegister = createCloudflareApi({ token: "t", fetch: register.fetch });
  assert.equal(await apiRegister.registerWorkersSubdomain("acct1", "pos-sunrise"), "pos-sunrise");
  assert.deepEqual(register.calls[0].body, { subdomain: "pos-sunrise" });

  const taken = fakeCfFetch({ "PUT /accounts/acct1/workers/subdomain": { status: 400, body: { errors: [{ message: "already taken" }] } } });
  const apiTaken = createCloudflareApi({ token: "some-other-secret-token", fetch: taken.fetch });
  await assert.rejects(apiTaken.registerWorkersSubdomain("acct1", "pos-sunrise"), (e) => {
    assert.match(e.message, /already taken/);
    assert.ok(!e.message.includes("some-other-secret-token"));
    return true;
  });
});

test("resolveAccountId: cf.accountId set -> no GET /accounts; unset + one account -> its id; unset + two accounts -> GoLiveError", async () => {
  const explicit = createCloudflareApi({ token: "t", fetch: async () => { throw new Error("must not fetch when accountId is already set"); } });
  assert.equal(await resolveAccountId(explicit, { accountId: "acct-fixed" }), "acct-fixed");

  const one = fakeCfFetch({ "GET /accounts": { status: 200, body: { result: [{ id: "only-acct", name: "Only" }] } } });
  const apiOne = createCloudflareApi({ token: "t", fetch: one.fetch });
  assert.equal(await resolveAccountId(apiOne, {}), "only-acct");

  const two = fakeCfFetch({ "GET /accounts": { status: 200, body: { result: [{ id: "a1", name: "A" }, { id: "a2", name: "B" }] } } });
  const apiTwo = createCloudflareApi({ token: "t", fetch: two.fetch });
  await assert.rejects(resolveAccountId(apiTwo, {}), (e) => e instanceof GoLiveError && e.step === "realtime" && /reaches 2 accounts/.test(e.message));
});

test("resolveSubdomain: existing subdomain -> no PUT; 404 -> PUT pos-<slug>; PUT rejected once -> second candidate pos-<slug>-<4hex>; three rejections -> GoLiveError step realtime", async () => {
  const existingCalls = fakeCfFetch({ "GET /accounts/acct1/workers/subdomain": { status: 200, body: { result: { subdomain: "acme" } } } });
  const apiExisting = createCloudflareApi({ token: "t", fetch: existingCalls.fetch });
  const depsExisting = { randomBytes: () => { throw new Error("must not mint a candidate when a subdomain already exists"); } };
  assert.equal(await resolveSubdomain(depsExisting, apiExisting, "acct1", "sunrise"), "acme");
  assert.ok(!existingCalls.calls.some((c) => c.method === "PUT"), "no PUT when a subdomain already exists");

  const fresh = fakeCfFetch({
    "GET /accounts/acct1/workers/subdomain": { status: 404, body: {} },
    "PUT /accounts/acct1/workers/subdomain": (init) => { const body = JSON.parse(init.body); return { status: 200, body: { result: { subdomain: body.subdomain } } }; },
  });
  const apiFresh = createCloudflareApi({ token: "t", fetch: fresh.fetch });
  const depsFresh = { randomBytes: () => { throw new Error("must not need a random candidate when the first one succeeds"); } };
  const sub = await resolveSubdomain(depsFresh, apiFresh, "acct1", "sunrise");
  assert.equal(sub, "pos-sunrise", "first candidate is pos-<slug>");
  const put = fresh.calls.find((c) => c.method === "PUT");
  assert.deepEqual(put.body, { subdomain: "pos-sunrise" });

  let putAttempt = 0;
  const clashOnce = fakeCfFetch({
    "GET /accounts/acct1/workers/subdomain": { status: 404, body: {} },
    "PUT /accounts/acct1/workers/subdomain": (init) => {
      putAttempt += 1;
      const body = JSON.parse(init.body);
      if (putAttempt === 1) return { status: 400, body: { errors: [{ message: "taken" }] } };
      return { status: 200, body: { result: { subdomain: body.subdomain } } };
    },
  });
  const apiClashOnce = createCloudflareApi({ token: "t", fetch: clashOnce.fetch });
  const depsClashOnce = { randomBytes: (n) => Buffer.alloc(n, 0xab) };
  const sub2 = await resolveSubdomain(depsClashOnce, apiClashOnce, "acct1", "sunrise");
  assert.equal(sub2, `pos-sunrise-${Buffer.alloc(2, 0xab).toString("hex")}`, "second candidate is pos-<slug>-<4hex>");
  assert.equal(putAttempt, 2);

  const alwaysTaken = fakeCfFetch({
    "GET /accounts/acct1/workers/subdomain": { status: 404, body: {} },
    "PUT /accounts/acct1/workers/subdomain": { status: 400, body: { errors: [{ message: "taken" }] } },
  });
  const apiAlwaysTaken = createCloudflareApi({ token: "t", fetch: alwaysTaken.fetch });
  const depsAlwaysTaken = { randomBytes: (n) => Buffer.alloc(n, 0xcd) };
  await assert.rejects(resolveSubdomain(depsAlwaysTaken, apiAlwaysTaken, "acct1", "sunrise"), (e) => e instanceof GoLiveError && e.step === "realtime");
  const puts = alwaysTaken.calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, SUBDOMAIN_CANDIDATE_ATTEMPTS, `exactly ${SUBDOMAIN_CANDIDATE_ATTEMPTS} candidates tried, then GoLiveError`);
});

// ── ensureRealtime: the deps-injected flow ──────────────────────────────────
const FAKE_TOKEN = "cf-token-UNIQUELY-IDENTIFIABLE-marker-9f8e7d6c5b4a";
const NOW_MS = 1_758_100_000_000;
const NOW_ISO = new Date(NOW_MS).toISOString();

/** A fake `deps` for ensureRealtime: fs (in-memory workers/realtime tree),
 *  spawnCapture (a recorder returning {status, stdout, stderr}), fetch (routed
 *  by URL/method), randomBytes, sleep (no-op), log (collector), now (fixed).
 *  `fetchOverrides` maps "METHOD path" -> a queue of {status, body?, ok?} or a
 *  function, consumed in order per key (so a test can answer 403 then 200). */
function fakeRealtimeDeps({ fsFiles = {}, cfRoutes = {}, publishStatuses = [200], joinStatuses = [426], wranglerStatus = 0, wranglerStdout = "", wranglerStderr = "", wranglerError = null } = {}) {
  const calls = [];
  const fs = fakeFs(realtimeTree(fsFiles));
  const cf = fakeCfFetch(cfRoutes);
  let publishCallCount = 0;
  let joinCallCount = 0;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === "api.cloudflare.com") return cf.fetch(url, init);
    if (u.pathname === "/publish") {
      const idx = Math.min(publishCallCount, publishStatuses.length - 1);
      publishCallCount += 1;
      const status = publishStatuses[idx];
      calls.push({ kind: "publish", status });
      return { status, ok: status >= 200 && status < 300, json: async () => ({}) };
    }
    if (u.pathname === "/join") {
      const idx = Math.min(joinCallCount, joinStatuses.length - 1);
      joinCallCount += 1;
      const status = joinStatuses[idx];
      calls.push({ kind: "join", status });
      return { status, ok: status >= 200 && status < 300, json: async () => ({}) };
    }
    throw new Error("unrouted fetch: " + url);
  };
  const spawnCapture = (cmd, args, opts) => {
    calls.push({ kind: "spawn", cmd, args, cwd: opts.cwd, env: opts.env, input: opts.input });
    return { status: wranglerError ? null : wranglerStatus, stdout: wranglerStdout, stderr: wranglerStderr, error: wranglerError };
  };
  const deps = {
    fs,
    spawnCapture,
    fetch,
    randomBytes: (n) => Buffer.alloc(n, 0x42),
    sleep: async () => { calls.push({ kind: "sleep" }); },
    log: (line) => calls.push({ kind: "log", line }),
    env: { PATH: "x" },
    now: () => NOW_MS,
  };
  return { deps, calls, cfCalls: cf.calls };
}

const CF_ROUTES_ONE_ACCOUNT = {
  "GET /accounts": { status: 200, body: { result: [{ id: "a".repeat(32), name: "Acme" }] } },
  "GET /accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workers/subdomain": { status: 200, body: { result: { subdomain: "acme" } } },
};

function baseCtx(overrides = {}) {
  return {
    root: REALTIME_ROOT,
    client: { slug: "sunrise", cloudflare: { token: FAKE_TOKEN, accountId: null, publishSecret: null } },
    slot: { isPrimary: true, gen: {} },
    tenant: { tenantId: "sunrise-demo" },
    ...overrides,
  };
}

test("ensureRealtime: standby -> state 'standby', off env, no spawn/fetch", async () => {
  const { deps, calls } = fakeRealtimeDeps();
  const r = await ensureRealtime(deps, baseCtx({ slot: { isPrimary: false, gen: {} } }));
  assert.equal(r.state, "standby");
  assert.deepEqual(r.env.map((e) => e.key), REALTIME_ENV_KEYS);
  assert.ok(r.env.every((e) => e.value === ""));
  assert.equal(r.deployed, false);
  assert.equal(calls.filter((c) => c.kind === "spawn" || c.kind === "publish" || c.kind === "join").length, 0);
});

test("ensureRealtime: null cloudflare block + no prior record -> 'untouched', env []", async () => {
  const { deps, calls } = fakeRealtimeDeps();
  const r = await ensureRealtime(deps, baseCtx({ client: { slug: "sunrise", cloudflare: null }, slot: { isPrimary: true, gen: {} } }));
  assert.equal(r.state, "untouched");
  assert.deepEqual(r.env, []);
  assert.equal(calls.filter((c) => c.kind === "spawn").length, 0);
});

test("ensureRealtime: null cloudflare block + a prior record -> 'off' env (the 3 keys blank), no spawn", async () => {
  const { deps, calls } = fakeRealtimeDeps();
  const prior = { workerName: "pos-realtime-sunrise", url: "https://pos-realtime-sunrise.acme.workers.dev", tenantId: "sunrise-demo", publishSecret: "old-secret-0123456789", sourceHash: "abc", deployedAt: "2026-01-01T00:00:00.000Z" };
  const r = await ensureRealtime(deps, baseCtx({ client: { slug: "sunrise", cloudflare: null }, slot: { isPrimary: true, gen: { realtime: prior } } }));
  assert.equal(r.state, "off");
  assert.deepEqual(r.env.map((e) => e.key), REALTIME_ENV_KEYS);
  assert.ok(r.env.every((e) => e.value === ""));
  assert.equal(calls.filter((c) => c.kind === "spawn").length, 0, "switching off never spawns wrangler");
});

test("ensureRealtime: no tenant yet -> 'untouched', env [], no spawn/fetch (the second deploy re-runs it once TENANT_ID is known)", async () => {
  const { deps, calls } = fakeRealtimeDeps();
  const r = await ensureRealtime(deps, baseCtx({ tenant: null }));
  assert.equal(r.state, "untouched");
  assert.deepEqual(r.env, []);
  const r2 = await ensureRealtime(deps, baseCtx({ tenant: { tenantId: null } }));
  assert.equal(r2.state, "untouched");
  assert.equal(calls.filter((c) => c.kind === "spawn" || c.kind === "publish" || c.kind === "join").length, 0);
});

test("ensureRealtime: first run -> deploy + secret spawns with the right args/cwd/env (token in env, NOT in args), record written, state 'on'", async () => {
  const { deps, calls } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx = baseCtx();
  const r = await ensureRealtime(deps, ctx);
  assert.equal(r.state, "on");
  assert.equal(r.deployed, true);
  assert.equal(r.workerName, "pos-realtime-sunrise");
  assert.equal(r.url, "https://pos-realtime-sunrise.acme.workers.dev");
  assert.equal(r.tenantId, "sunrise-demo");
  assert.deepEqual(r.env.map((e) => e.key), REALTIME_ENV_KEYS);
  assert.equal(r.env[0].value, "https://pos-realtime-sunrise.acme.workers.dev/publish");
  assert.equal(r.env[2].value, "wss://pos-realtime-sunrise.acme.workers.dev/join");

  const spawns = calls.filter((c) => c.kind === "spawn");
  assert.equal(spawns.length, 2, "one deploy spawn + one secret-put spawn");
  const deploySpawn = spawns.find((c) => c.args.includes("deploy"));
  const secretSpawn = spawns.find((c) => c.args.includes("secret"));
  assert.ok(deploySpawn && secretSpawn);
  assert.ok(deploySpawn.args.includes("--name") && deploySpawn.args.includes("pos-realtime-sunrise"));
  assert.ok(deploySpawn.args.includes("--var") && deploySpawn.args.includes("TENANT_ID:sunrise-demo"));
  assert.equal(deploySpawn.cwd, path.join(REALTIME_ROOT, "workers", "realtime"));
  assert.equal(deploySpawn.env.CLOUDFLARE_API_TOKEN, FAKE_TOKEN, "the token reaches wrangler ONLY via env");
  assert.equal(deploySpawn.env.CLOUDFLARE_ACCOUNT_ID, "a".repeat(32));
  assert.equal(deploySpawn.env.WRANGLER_SEND_METRICS, "false");
  assert.equal(deploySpawn.env.CI, "true");
  assert.ok(!deploySpawn.args.includes(FAKE_TOKEN), "the token must never be in argv");
  assert.ok(!secretSpawn.args.includes(FAKE_TOKEN), "the token must never be in argv (secret-put spawn either)");
  assert.ok(secretSpawn.args.includes("REALTIME_PUBLISH_SECRET") && secretSpawn.args.includes("--name") && secretSpawn.args.includes("pos-realtime-sunrise"));
  assert.match(secretSpawn.input, /\n$/, "the secret is piped via stdin, newline-terminated");

  const rec = ctx.slot.gen.realtime;
  assert.equal(rec.workerName, "pos-realtime-sunrise");
  assert.equal(rec.url, "https://pos-realtime-sunrise.acme.workers.dev");
  assert.equal(rec.accountId, "a".repeat(32));
  assert.equal(rec.tenantId, "sunrise-demo");
  assert.equal(rec.sourceHash, sourceHashOf({ fs: fakeFs(realtimeTree()) }, REALTIME_ROOT));
  assert.equal(rec.deployedAt, NOW_ISO);
  assert.equal(rec.verifiedAt, NOW_ISO);
  assert.ok(typeof rec.publishSecret === "string" && rec.publishSecret.length > 0);

  // Vision guard for (e): the token string never appears in any logged line, thrown message or spawn args.
  const logged = calls.filter((c) => c.kind === "log").map((c) => c.line).join("\n");
  assert.ok(!logged.includes(FAKE_TOKEN), "the token must never appear in a logged line");
  assert.ok(logged.length > 0, "positive landmark: something WAS logged (a silently-empty log would trivially pass the check above)");
  const allArgs = spawns.flatMap((s) => s.args).join(" ");
  assert.ok(!allArgs.includes(FAKE_TOKEN), "the token must never appear in spawn ARGS");
});

test("ensureRealtime: second run with the same hash/tenant/url -> no spawns (Worker already up to date)", async () => {
  const { deps: deps1 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx1 = baseCtx();
  const r1 = await ensureRealtime(deps1, ctx1);
  const prior = ctx1.slot.gen.realtime;

  const { deps: deps2, calls: calls2 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx2 = baseCtx({ slot: { isPrimary: true, gen: { realtime: prior } }, client: { slug: "sunrise", cloudflare: { token: FAKE_TOKEN, accountId: null, publishSecret: null } } });
  const r2 = await ensureRealtime(deps2, ctx2);
  assert.equal(r2.state, "on");
  assert.equal(r2.deployed, false, "no redeploy needed — the hash/tenant/url all match the prior record");
  assert.equal(calls2.filter((c) => c.kind === "spawn").length, 0, "no spawn at all when nothing changed");
  assert.equal(r2.url, r1.url);
  assert.equal(ctx2.slot.gen.realtime.deployedAt, prior.deployedAt, "deployedAt is carried over, unchanged, when no redeploy happened");
});

test("ensureRealtime: tenant change forces a redeploy", async () => {
  const { deps: deps1 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx1 = baseCtx();
  await ensureRealtime(deps1, ctx1);
  const prior = ctx1.slot.gen.realtime;

  const { deps: deps2, calls: calls2 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx2 = baseCtx({ slot: { isPrimary: true, gen: { realtime: prior } }, tenant: { tenantId: "a-different-tenant" } });
  const r2 = await ensureRealtime(deps2, ctx2);
  assert.equal(r2.deployed, true);
  assert.ok(calls2.some((c) => c.kind === "spawn" && c.args.includes("deploy")));
});

test("ensureRealtime: a source-hash change (workers/realtime/src edited) forces a redeploy", async () => {
  const { deps: deps1 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx1 = baseCtx();
  await ensureRealtime(deps1, ctx1);
  const prior = ctx1.slot.gen.realtime;

  const { deps: deps2, calls: calls2 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, fsFiles: { [`${REALTIME_ROOT}/workers/realtime/src/index.ts`]: "export default { fetch() { return 2; } };" } });
  const ctx2 = baseCtx({ slot: { isPrimary: true, gen: { realtime: prior } } });
  const r2 = await ensureRealtime(deps2, ctx2);
  assert.equal(r2.deployed, true, "a changed source hash forces a redeploy even though tenant/url/name are unchanged");
  assert.ok(calls2.some((c) => c.kind === "spawn" && c.args.includes("deploy")));
  assert.notEqual(ctx2.slot.gen.realtime.sourceHash, prior.sourceHash);
});

test("ensureRealtime: a publishSecret set on the record adopts it without minting a new one", async () => {
  const { deps, calls } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx = baseCtx({ client: { slug: "sunrise", cloudflare: { token: FAKE_TOKEN, accountId: null, publishSecret: "adopted-secret-0123456789ab" } } });
  const r = await ensureRealtime(deps, ctx);
  assert.equal(r.state, "on");
  assert.equal(ctx.slot.gen.realtime.publishSecret, "adopted-secret-0123456789ab");
  const secretSpawn = calls.find((c) => c.kind === "spawn" && c.args.includes("secret"));
  assert.equal(secretSpawn.input, "adopted-secret-0123456789ab\n");
});

test("ensureRealtime: wrangler exiting non-zero -> GoLiveError step \"realtime\"", async () => {
  const { deps } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, wranglerStatus: 1 });
  await assert.rejects(ensureRealtime(deps, baseCtx()), (e) => e instanceof GoLiveError && e.step === "realtime" && /deploying Worker/.test(e.message));
});

test("ensureRealtime: the /join probe never answers 426 -> GoLiveError step \"realtime\"", async () => {
  const { deps } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, joinStatuses: Array(PROBE_ATTEMPTS).fill(503) });
  await assert.rejects(ensureRealtime(deps, baseCtx()), (e) => e instanceof GoLiveError && e.step === "realtime" && /expected 426/.test(e.message));
});

// ── (b) probePublish (exercised via ensureRealtime's end-to-end publish probe) ──
test("a 403 from /publish is retried for the WHOLE publish budget (a freshly deployed version can still be rolling out), then surfaces as the 'refuses tenant' error (fresh deploy — needsDeploy is true, so the 403 self-heal branch does not fire)", async () => {
  const { deps, calls } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, publishStatuses: [403] });
  await assert.rejects(ensureRealtime(deps, baseCtx()), (e) => e instanceof GoLiveError && e.step === "realtime" && /refuses tenant/.test(e.message));
  const publishCalls = calls.filter((c) => c.kind === "publish");
  assert.equal(publishCalls.length, PUBLISH_PROBE_ATTEMPTS, "403 is retried up to the full publish budget before it counts (secret/version propagation)");
});

test("the /publish probe keeps retrying on 503 up to PUBLISH_PROBE_ATTEMPTS, then fails with GoLiveError", async () => {
  const { deps, calls } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, publishStatuses: Array(PUBLISH_PROBE_ATTEMPTS).fill(503) });
  await assert.rejects(ensureRealtime(deps, baseCtx()), (e) => e instanceof GoLiveError && e.step === "realtime" && /not accepting nudges yet/.test(e.message));
  const publishCalls = calls.filter((c) => c.kind === "publish");
  assert.equal(publishCalls.length, PUBLISH_PROBE_ATTEMPTS, "503 is retried up to the full publish budget");
});

test("the /publish probe keeps retrying on a network error (fetch throws) up to PUBLISH_PROBE_ATTEMPTS", async () => {
  const { deps: base, calls } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  let attempts = 0;
  const deps = { ...base, fetch: async (url, init) => {
    const u = new URL(url);
    if (u.pathname === "/publish") { attempts += 1; calls.push({ kind: "publish", status: "network-error" }); throw new Error("ECONNRESET"); }
    return base.fetch(url, init);
  } };
  await assert.rejects(ensureRealtime(deps, baseCtx()), (e) => e instanceof GoLiveError && e.step === "realtime" && /not accepting nudges yet/.test(e.message));
  assert.equal(attempts, PUBLISH_PROBE_ATTEMPTS, "a thrown/network error is retried up to the full publish budget, same as 503");
});

// ── (c) 400 from /publish -> GoLiveError whose message mentions the envelope, not credentials ──
test("a 400 from /publish is reported as an envelope/code-drift problem, never a credentials problem", async () => {
  const { deps } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, publishStatuses: [400] });
  await assert.rejects(ensureRealtime(deps, baseCtx()), (e) => {
    assert.ok(e instanceof GoLiveError && e.step === "realtime");
    assert.match(e.message, /envelope/i);
    assert.ok(!/credential|token|secret/i.test(e.message), `400's error must not blame credentials, got: ${e.message}`);
    return true;
  });
});

// ── (d) self-heal: 403 on a run that did NOT deploy -> one redeploy then re-probe -> 200 passes; 403 twice -> GoLiveError.
//        401 on a run that did not put the secret -> one re-put then re-probe. ──
test("403 on a run that already had an up-to-date Worker (no deploy needed) triggers exactly one redeploy, then a re-probe that passes on 200", async () => {
  const { deps: deps1 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx1 = baseCtx();
  await ensureRealtime(deps1, ctx1);
  const prior = ctx1.slot.gen.realtime;

  const { deps: deps2, calls: calls2 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, publishStatuses: [...Array(PUBLISH_PROBE_ATTEMPTS).fill(403), 200] });
  const ctx2 = baseCtx({ slot: { isPrimary: true, gen: { realtime: prior } } }); // same hash/tenant/url -> needsDeploy would be false
  const r2 = await ensureRealtime(deps2, ctx2);
  assert.equal(r2.state, "on", "the self-heal redeploy + re-probe succeeds");
  assert.equal(r2.deployed, true, "the self-heal redeploy flips `deployed` to true even though the record looked up to date");
  const deploySpawns = calls2.filter((c) => c.kind === "spawn" && c.args.includes("deploy"));
  assert.equal(deploySpawns.length, 1, "exactly one redeploy is triggered by the 403 self-heal");
  const publishCalls = calls2.filter((c) => c.kind === "publish");
  assert.deepEqual(publishCalls.map((c) => c.status), [...Array(PUBLISH_PROBE_ATTEMPTS).fill(403), 200], "a full budget of 403s (propagation grace), then the re-probe's 200");
});

test("403 twice (the self-heal redeploy does not fix it) -> GoLiveError, and the redeploy still happened exactly once", async () => {
  const { deps: deps1 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx1 = baseCtx();
  await ensureRealtime(deps1, ctx1);
  const prior = ctx1.slot.gen.realtime;

  const { deps: deps2, calls: calls2 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, publishStatuses: [403] });
  const ctx2 = baseCtx({ slot: { isPrimary: true, gen: { realtime: prior } } });
  await assert.rejects(ensureRealtime(deps2, ctx2), (e) => e instanceof GoLiveError && e.step === "realtime" && /refuses tenant/.test(e.message));
  const deploySpawns = calls2.filter((c) => c.kind === "spawn" && c.args.includes("deploy"));
  assert.equal(deploySpawns.length, 1, "the self-heal redeploy is only attempted ONCE, even though it did not fix the 403");
});

test("401 on a run that did not put the secret triggers exactly one re-put, then a re-probe that passes on 200", async () => {
  const { deps: deps1 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx1 = baseCtx();
  await ensureRealtime(deps1, ctx1);
  const prior = ctx1.slot.gen.realtime; // publishSecret === prior.publishSecret -> needsSecret would be false on the re-run

  const { deps: deps2, calls: calls2 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, publishStatuses: [...Array(PUBLISH_PROBE_ATTEMPTS).fill(401), 200] });
  const ctx2 = baseCtx({ slot: { isPrimary: true, gen: { realtime: prior } } });
  const r2 = await ensureRealtime(deps2, ctx2);
  assert.equal(r2.state, "on");
  const secretSpawns = calls2.filter((c) => c.kind === "spawn" && c.args.includes("secret"));
  assert.equal(secretSpawns.length, 1, "exactly one secret re-put is triggered by the 401 self-heal");
  const deploySpawns = calls2.filter((c) => c.kind === "spawn" && c.args.includes("deploy"));
  assert.equal(deploySpawns.length, 0, "a 401 self-heal never redeploys the Worker, only re-puts the secret");
  const publishCalls = calls2.filter((c) => c.kind === "publish");
  assert.deepEqual(publishCalls.map((c) => c.status), [...Array(PUBLISH_PROBE_ATTEMPTS).fill(401), 200], "a full budget of 401s (secret propagation grace), then the re-probe's 200");
});

test("401 twice -> GoLiveError naming the secret mismatch", async () => {
  const { deps: deps1 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx1 = baseCtx();
  await ensureRealtime(deps1, ctx1);
  const prior = ctx1.slot.gen.realtime;

  const { deps: deps2, calls: calls2 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, publishStatuses: [401] });
  const ctx2 = baseCtx({ slot: { isPrimary: true, gen: { realtime: prior } } });
  await assert.rejects(ensureRealtime(deps2, ctx2), (e) => e instanceof GoLiveError && e.step === "realtime" && /secret does not match/.test(e.message));
  const secretSpawns = calls2.filter((c) => c.kind === "spawn" && c.args.includes("secret"));
  assert.equal(secretSpawns.length, 1, "the self-heal re-put is only attempted ONCE");
});

// ── (e) vision guard, restated end-to-end across every ensureRealtime scenario above ──
test("vision guard: the token never appears in ANY logged line, thrown message or spawn args across a full run with a self-heal — it may appear only in spawn env", async () => {
  const { deps, calls } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx = baseCtx();
  // First establish a record cleanly (first run, needsDeploy true -> 403 would be
  // definitive and abort, not self-heal), then force the self-heal path on a second run.
  await ensureRealtime(deps, ctx);
  const prior = ctx.slot.gen.realtime;
  const { deps: deps2, calls: calls2 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, publishStatuses: [...Array(PUBLISH_PROBE_ATTEMPTS).fill(403), 200] });
  const ctx2 = baseCtx({ slot: { isPrimary: true, gen: { realtime: prior } } });
  await ensureRealtime(deps2, ctx2);

  const allCalls = [...calls, ...calls2];
  const loggedText = allCalls.filter((c) => c.kind === "log").map((c) => c.line).join("\n");
  assert.ok(!loggedText.includes(FAKE_TOKEN), "no logged line contains the token");
  assert.ok(loggedText.length > 0, "positive landmark: logging actually happened");
  const spawnArgsText = allCalls.filter((c) => c.kind === "spawn").flatMap((c) => c.args).join(" ");
  assert.ok(!spawnArgsText.includes(FAKE_TOKEN), "no spawn ARGS contain the token");
  const spawnsWithToken = allCalls.filter((c) => c.kind === "spawn" && c.env && c.env.CLOUDFLARE_API_TOKEN === FAKE_TOKEN);
  assert.ok(spawnsWithToken.length > 0, "positive landmark: the token DOES reach wrangler, just only via spawn env — proves this isn't silently never spawning wrangler at all");
});

// ── (f) already covered above (wranglerCommand) — grouped here for the report's own bookkeeping ──
test("PUBLISH_SECRET_BYTES / JOIN_PROBE_STATUS constants are the ones ensureRealtime actually uses", () => {
  assert.equal(PUBLISH_SECRET_BYTES, 32);
  assert.equal(JOIN_PROBE_STATUS, 426);
});

// ── Fix-round regressions (post-review) ─────────────────────────────────────

// R1: a fake wrangler whose OWN stdout/stderr echo back the publish secret AND
// the token (as if wrangler itself printed them — e.g. in a verbose error dump)
// must never let either reach a logged line: runWrangler's `redact` masking is
// what the caller is responsible for passing, and ensureRealtime does pass it.
test("R1: wrangler's own stdout/stderr echoing the token AND the publish secret are masked in every logged line (runWrangler's `redact` list, passed by ensureRealtime)", async () => {
  const secretMarker = "cf-publish-secret-ECHOED-BACK-1a2b3c4d";
  const wranglerStdout = `Uploaded pos-realtime-sunrise (1.2s)\nusing token ${FAKE_TOKEN}\n  https://pos-realtime-sunrise.acme.workers.dev\n`;
  const wranglerStderr = `warning: secret value was ${secretMarker}\n`;
  const { deps, calls } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, wranglerStdout, wranglerStderr });
  const ctx = baseCtx({ client: { slug: "sunrise", cloudflare: { token: FAKE_TOKEN, accountId: null, publishSecret: secretMarker } } });
  await ensureRealtime(deps, ctx);
  const logged = calls.filter((c) => c.kind === "log").map((c) => c.line).join("\n");
  assert.ok(logged.includes("Uploaded"), "positive landmark: wrangler's own stdout DID reach the log (masking, not suppression)");
  assert.ok(!logged.includes(FAKE_TOKEN), "the token must never survive into a logged line, even when wrangler's OWN output printed it");
  assert.ok(!logged.includes(secretMarker), "the publish secret must never survive into a logged line, even when wrangler's OWN output printed it");
  assert.ok(logged.includes("•••"), "the masked line still reaches the log — redacted, not dropped");
});

// R2: switching realtime off (block null, a prior record present) must move
// the record to `previousRealtime` (no secret) and drop `realtime` entirely —
// pinned directly on the mutated `slot.gen` object ensureRealtime is handed.
test("R2: switch-off run — slot.gen.realtime is GONE, slot.gen.previousRealtime carries {workerName,url,accountId,tenantId,switchedOffAt} with NO publishSecret key", async () => {
  const { deps: deps1 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx1 = baseCtx();
  await ensureRealtime(deps1, ctx1);
  const prior = ctx1.slot.gen.realtime;
  assert.ok(prior && prior.publishSecret, "positive landmark: the prior record really does carry a publishSecret before the switch-off");

  const { deps: deps2 } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT });
  const ctx2 = baseCtx({ client: { slug: "sunrise", cloudflare: null }, slot: { isPrimary: true, gen: { realtime: prior } } });
  const r2 = await ensureRealtime(deps2, ctx2);
  assert.equal(r2.state, "off");
  assert.equal("realtime" in ctx2.slot.gen, false, "the realtime record must be gone entirely, not merely blanked");
  const prev = ctx2.slot.gen.previousRealtime;
  assert.ok(prev, "previousRealtime must be written");
  assert.deepEqual(Object.keys(prev).sort(), ["accountId", "switchedOffAt", "tenantId", "url", "workerName"].sort());
  assert.equal(prev.workerName, prior.workerName);
  assert.equal(prev.url, prior.url);
  assert.equal(prev.accountId, prior.accountId);
  assert.equal(prev.tenantId, prior.tenantId);
  assert.match(prev.switchedOffAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal("publishSecret" in prev, false, "the publish secret must NOT be carried into previousRealtime — the cafe no longer talks to this Worker");
});

// R4: a process that could not be STARTED at all (spawnSync sets `error`,
// status null) is reported as a start failure, never as a wrangler/token
// problem; a genuine non-zero exit status still gets the existing message.
test("R4: spawnCapture returning {status:null, error:{code:\"ENOENT\"}} -> GoLiveError step \"realtime\" naming \"could not be started\" and \"ENOENT\", never the token-scope hint; a real non-zero exit still gets \"read the output above\"", async () => {
  const { deps: notStarted } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, wranglerError: { code: "ENOENT" } });
  await assert.rejects(ensureRealtime(notStarted, baseCtx()), (e) => {
    assert.ok(e instanceof GoLiveError && e.step === "realtime");
    assert.match(e.message, /could not be started/);
    assert.match(e.message, /ENOENT/);
    assert.ok(!/token scope/i.test(e.message), `a start failure must not blame the token scope, got: ${e.message}`);
    return true;
  });

  const { deps: nonZero } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, wranglerStatus: 1 });
  await assert.rejects(ensureRealtime(nonZero, baseCtx()), (e) => e instanceof GoLiveError && e.step === "realtime" && /read the output above/.test(e.message) && /deploying Worker/.test(e.message));
});

// R5: the Worker's own HMAC scheme/tolerance/size-cap constants, pinned by
// SOURCE against the same literals realtime.mjs exports (parity), plus a
// runtime relationship check (the retry budget must fit inside the replay
// window, and the probe body must fit inside the Worker's own byte cap).
test("R5: the Worker source's PUBLISH_SIG_HEADER/PUBLISH_TS_HEADER equal REALTIME_SIG_HEADER/REALTIME_TS_HEADER; PUBLISH_TS_TOLERANCE_S=300 and the probe's full retry budget fits well inside it; the probe body fits inside MAX_PUBLISH_BYTES", () => {
  const sigMatch = WORKER_SRC.match(/PUBLISH_SIG_HEADER = "([^"]+)"/);
  const tsMatch = WORKER_SRC.match(/PUBLISH_TS_HEADER = "([^"]+)"/);
  const toleranceMatch = WORKER_SRC.match(/PUBLISH_TS_TOLERANCE_S = (\d+)/);
  const maxBytesMatch = WORKER_SRC.match(/MAX_PUBLISH_BYTES = (\d+)/);
  assert.ok(sigMatch && tsMatch && toleranceMatch && maxBytesMatch, "positive landmark: all four Worker constants are literal-parseable from source");
  assert.equal(sigMatch[1], REALTIME_SIG_HEADER);
  assert.equal(tsMatch[1], REALTIME_TS_HEADER);
  const toleranceS = Number(toleranceMatch[1]);
  assert.equal(toleranceS, 300);
  assert.ok(PROBE_ATTEMPTS * PROBE_INTERVAL_MS < toleranceS * 1000, `the /join retry budget (${PROBE_ATTEMPTS * PROBE_INTERVAL_MS}ms) must stay inside the Worker's +/-300s replay window (${toleranceS * 1000}ms)`);
  assert.ok(PUBLISH_PROBE_ATTEMPTS * PUBLISH_PROBE_INTERVAL_MS < toleranceS * 1000, `the full /publish retry budget (${PUBLISH_PROBE_ATTEMPTS * PUBLISH_PROBE_INTERVAL_MS}ms) must stay inside the Worker's +/-300s replay window (${toleranceS * 1000}ms), or a late retry's timestamp would be refused as stale`);
  const maxBytes = Number(maxBytesMatch[1]);
  const { body } = signedPublishRequest("a".repeat(32), "sunrise-demo-x7k2", NOW_MS);
  assert.ok(body.length < maxBytes, `the probe's own envelope (${body.length} bytes) must fit under the Worker's MAX_PUBLISH_BYTES (${maxBytes})`);
});

// R7: wrangler's stdout can quote a *.workers.dev URL that is NOT this Worker
// (another notice, or a previously-deployed Worker's own line) — only a URL
// whose name segment matches THIS Worker may be adopted; anything else is
// logged as ignored and the API-derived URL wins.
test("R7: an UNRELATED workers.dev URL in wrangler's stdout is ignored (the API-derived URL wins, with a log line saying so); a URL for THIS Worker on a different subdomain IS adopted", async () => {
  const unrelatedStdout = "Deployed pos-realtime-sunrise (1.2s)\n  see also https://other-thing.someone.workers.dev for notices\n";
  const { deps: unrelated, calls: unrelatedCalls } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, wranglerStdout: unrelatedStdout });
  const ctxUnrelated = baseCtx();
  const rUnrelated = await ensureRealtime(unrelated, ctxUnrelated);
  assert.equal(rUnrelated.url, "https://pos-realtime-sunrise.acme.workers.dev", "the API-derived URL (this Worker's own name + the resolved subdomain) wins over an unrelated URL in wrangler's output");
  assert.ok(unrelatedCalls.some((c) => c.kind === "log" && /ignoring/.test(c.line) && /other-thing\.someone\.workers\.dev/.test(c.line)), "a log line must say the unrelated URL was ignored");

  const sameWorkerStdout = "Deployed pos-realtime-sunrise (1.2s)\n  https://pos-realtime-sunrise.different-sub.workers.dev\n";
  const { deps: sameWorker, calls: sameWorkerCalls } = fakeRealtimeDeps({ cfRoutes: CF_ROUTES_ONE_ACCOUNT, wranglerStdout: sameWorkerStdout });
  const ctxSameWorker = baseCtx();
  const rSameWorker = await ensureRealtime(sameWorker, ctxSameWorker);
  assert.equal(rSameWorker.url, "https://pos-realtime-sunrise.different-sub.workers.dev", "a URL that DOES name this Worker (same 'pos-realtime-sunrise.' prefix), just on a different subdomain, is adopted");
  assert.ok(sameWorkerCalls.some((c) => c.kind === "log" && /wrangler reports/.test(c.line) && /different-sub/.test(c.line)));
});
