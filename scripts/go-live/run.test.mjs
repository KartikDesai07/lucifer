// node --test scripts/go-live/run.test.mjs — the whole go-live flow against a fake
// Vercel API, a fake spawn and an in-memory fs. Pins the ORDER (seed before any
// Vercel write), the env set, the profile, the deploy command, the two-deploy
// fallback, the custom-domain shape and the secret-preserving re-run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { REALTIME_ENV_KEYS as REALTIME_ENV_KEYS_FOR_TEST } from "./lib.mjs";
import { GoLiveError, runGoLive, runResetDemo, runSeedDemo } from "./run.mjs";

const INDEX_MJS = fileURLToPath(new URL("./index.mjs", import.meta.url));

const ROOT = "/repo";
const CLIENT_PATH = "/repo/clients/sunrise-demo.json";
const PROFILES_PATH = path.join(ROOT, "deploy.profiles.json");
/** The deploy spawn's first arg is the FULL path to scripts/deploy.mjs (OS-specific separators). */
const isDeploy = (args) => args.some((a) => String(a).endsWith("deploy.mjs"));

function client(overrides = {}) {
  return {
    slug: "sunrise-demo",
    vercel: { token: "tok_secret", project: null, teamId: null },
    subdomain: null,
    mongodbUri: "mongodb+srv://u:p@c.mongodb.net/pos?retryWrites=true",
    admin: { username: "Admin", password: "Strong-Pass-1!" },
    cafe: { name: "Sunrise Café" },
    tables: 8,
    menu: null,
    image: null,
    ...overrides,
  };
}

// Built with path.join (not a literal forward-slash string): run.mjs's readPlatform()
// does `path.join(path.dirname(clientPath), PLATFORM_FILE)`, and on Windows that
// normalizes to backslashes — a literal "/repo/clients/_platform.json" key would
// silently miss the fake fs lookup and read back as "file absent" every time.
const PLATFORM_PATH = path.join(path.dirname(CLIENT_PATH), "_platform.json");

/** A fake Vercel + health server. `domainsAfterDeploy` simulates Vercel listing
 *  the *.vercel.app domain only once a deployment exists.
 *
 *  Web-address additions (platform subdomains): `domains` entries may carry a
 *  `redirect`/`redirectStatusCode`, tracked per-name in `redirectState` so PATCH
 *  updates and GET reflects it (idempotency + revert-order pins need this to be
 *  observable). `domainConfig` parameterises GET /v6/domains/{name}/config
 *  (`misconfigured`, `recommendedCNAME`). `manualRedirects` maps a
 *  "https://<name>/api/health" host to the Location a `redirect:"manual"` fetch
 *  should report. `dnsCheck` is deps.dnsCheck (checkRecords/probeHealth fakes),
 *  parameterised per test scenario. `targets` sets what GET/POST project
 *  responses carry as a `targets` key (Vercel's real shape: an object keyed
 *  by environment, e.g. `{ production: {...} }`, or `{}` for "created, no
 *  prod deploy yet"; omit the option to leave the field OUT of the response
 *  body entirely) — the three shapes vercel-api.mjs's `hasProduction` must
 *  tell apart (true / false / null respectively). */
// Realtime fixtures (opt-in, additive — no existing test passes these): a
// minimal workers/realtime source tree the fake fs needs for sourceHashOf, and
// a Cloudflare REST + /join + /publish fetch responder for ensureRealtime's
// end-to-end flow. `cfAccounts` defaults to exactly one account (the common
// case — no accountId needed on the record).
const REALTIME_SRC_FILES = {
  [path.join(ROOT, "workers", "realtime", "wrangler.jsonc")]: '{ "name": "pos-realtime" }',
  [path.join(ROOT, "workers", "realtime", "src", "index.ts")]: "export default { fetch() {} };",
};
function realtimeFetch(u, method, body, { cfAccounts = [{ id: "a".repeat(32), name: "Acme" }], subdomain = "acme" } = {}) {
  if (u.hostname === "api.cloudflare.com") {
    if (method === "GET" && u.pathname === "/client/v4/accounts") return { status: 200, ok: true, json: async () => ({ result: cfAccounts }) };
    if (method === "GET" && /^\/client\/v4\/accounts\/[^/]+\/workers\/subdomain$/.test(u.pathname)) return { status: 200, ok: true, json: async () => ({ result: { subdomain } }) };
    if (method === "PUT" && /^\/client\/v4\/accounts\/[^/]+\/workers\/subdomain$/.test(u.pathname)) return { status: 200, ok: true, json: async () => ({ result: { subdomain: body.subdomain } }) };
    return { status: 500, ok: false, json: async () => ({ errors: [{ message: "unrouted cf: " + u.pathname }] }) };
  }
  if (u.pathname === "/join") return { status: 426, ok: false, json: async () => ({}) };
  if (u.pathname === "/publish") return { status: 200, ok: true, json: async () => ({ ok: true, delivered: 1 }) };
  return null;
}

function fakeWorld({
  files, projectExists = false, domainsAfterDeploy = false, health = { status: 200, body: { ok: true, db: "up" } }, domainVerified = true, domains,
  domainConfig = { misconfigured: false, configuredBy: "CNAME", recommendedCNAME: [{ rank: 1, value: "abc.vercel-dns-017.com" }] }, domainConfigFails = false,
  manualRedirects = {}, dnsCheck, targets, cloudflare,
} = {}) {
  const calls = [];
  // Normalized on the way in too — a fixture's initial `files` map may use either
  // a literal "/a/b" key or one built with node:path.join (backslash on Windows);
  // both must land on the SAME store entry the runtime fs functions look up.
  const mergedFiles = cloudflare ? { ...REALTIME_SRC_FILES, ...files } : files;
  const store = new Map(Object.entries(mergedFiles).map(([k, v]) => [String(k).replace(/\\/g, "/"), v]));
  let deployed = 0;
  const projectId = "prj_123";
  let createdName = "sunrise-demo"; // the *.vercel.app Vercel hands out follows the project NAME
  const domainList = () => (domainsAfterDeploy && deployed === 0 ? [] : domains ?? [{ name: `${createdName}-x7k2.vercel.app`, apexName: "vercel.app", verified: true }]);
  /** Per-domain-name redirect state, seeded from `domains` and mutated by PATCH. */
  const redirectState = new Map((domains ?? []).map((d) => [d.name, { redirect: d.redirect ?? null, redirectStatusCode: d.redirectStatusCode ?? null }]));
  const domainRecord = (name) => {
    const base = domainList().find((d) => d.name === name) ?? { name, verified: domainVerified };
    const rs = redirectState.get(name) ?? { redirect: null, redirectStatusCode: null };
    return { ...base, ...rs };
  };
  const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (init.redirect === "manual" && u.pathname === "/api/health") {
      calls.push({ kind: "fetch", method, path: u.pathname + u.search, body, auth: init.headers?.Authorization, host: u.hostname, manual: true });
      const location = manualRedirects[u.hostname] ?? null;
      if (!location) return { status: 200, ok: true, headers: { get: () => null }, json: async () => ({ ok: true }) };
      return { status: 308, ok: false, headers: { get: (k) => (k.toLowerCase() === "location" ? location : null) }, json: async () => null };
    }
    calls.push({ kind: "fetch", method, path: u.pathname + u.search, body, auth: init.headers?.Authorization, host: u.hostname });
    if (cloudflare) {
      const rt = realtimeFetch(u, method, body, typeof cloudflare === "object" ? cloudflare : {});
      if (rt) return rt;
    }
    if (u.hostname !== "api.vercel.com") {
      const tenant = store.has("TENANT_ID") ? store.get("TENANT_ID") : "dev";
      return json(health.status, health.body ? { ...health.body, tenant } : null);
    }
    if (u.pathname === "/v2/user") return json(200, { user: { id: "team_owner", username: "sandbee", email: "o@x.in" } });
    if (method === "GET" && u.pathname === "/v9/projects/sunrise-demo") return projectExists ? json(200, { id: projectId, name: "sunrise-demo", accountId: "team_owner", ...(targets !== undefined ? { targets } : {}) }) : json(404, { error: { code: "not_found" } });
    if (method === "GET" && u.pathname === `/v9/projects/${projectId}`) return projectExists ? json(200, { id: projectId, name: "sunrise-demo", accountId: "team_owner", ...(targets !== undefined ? { targets } : {}) }) : json(404, { error: { code: "not_found" } });
    if (method === "GET" && /^\/v6\/domains\/[^/]+\/config$/.test(u.pathname)) return domainConfigFails ? json(500, { error: { code: "internal", message: "config lookup failed" } }) : json(200, domainConfig);
    if (method === "GET" && /^\/v9\/projects\/prj_123\/domains\/[^/]+$/.test(u.pathname)) {
      const name = decodeURIComponent(u.pathname.split("/")[5]);
      const attached = domainList().some((d) => d.name === name) || redirectState.has(name);
      return attached ? json(200, domainRecord(name)) : json(404, { error: { code: "not_found" } });
    }
    if (method === "PATCH" && /^\/v9\/projects\/prj_123\/domains\/[^/]+$/.test(u.pathname)) {
      const name = decodeURIComponent(u.pathname.split("/")[5]);
      if (!redirectState.has(name) && !domainList().some((d) => d.name === name)) return json(404, { error: { code: "not_found" } });
      redirectState.set(name, { redirect: body.redirect ?? null, redirectStatusCode: body.redirectStatusCode ?? null });
      return json(200, domainRecord(name));
    }
    if (method === "GET" && /^\/v9\/projects\/prj_[a-z0-9]+$/.test(u.pathname)) return json(404, { error: { code: "not_found" } });
    if (method === "GET" && /^\/v9\/projects\/[a-z0-9-]+$/.test(u.pathname)) return json(404, { error: { code: "not_found" } });
    if (method === "POST" && u.pathname === "/v11/projects") { projectExists = true; createdName = body.name; return json(200, { id: projectId, name: body.name, accountId: "team_owner", ...(targets !== undefined ? { targets } : {}) }); }
    if (method === "GET" && u.pathname === `/v9/projects/${projectId}/domains`) return json(200, { domains: domainList().map((d) => domainRecord(d.name)) });
    if (method === "POST" && u.pathname === `/v10/projects/${projectId}/domains`) {
      redirectState.set(body.name, redirectState.get(body.name) ?? { redirect: null, redirectStatusCode: null });
      return json(200, { name: body.name, verified: domainVerified, verification: domainVerified ? undefined : [{ type: "TXT", domain: "_vercel." + body.name, value: "vc-domain-verify=abc" }] });
    }
    if (method === "POST" && /^\/v9\/projects\/prj_123\/domains\/[^/]+\/verify$/.test(u.pathname)) return json(200, { name: decodeURIComponent(u.pathname.split("/")[5]), verified: domainVerified, verification: domainVerified ? undefined : [{ type: "TXT", domain: "_vercel.x", value: "vc-domain-verify=abc" }] });
    if (method === "POST" && u.pathname === `/v10/projects/${projectId}/env`) {
      for (const e of body) store.set(e.key, e.value);
      return json(201, { created: body, failed: [] });
    }
    return json(500, { error: { code: "unrouted", message: u.pathname } });
  };

  const spawn = (cmd, args, opts) => {
    calls.push({ kind: "spawn", cmd, args, cwd: opts.cwd, env: opts.env });
    if (isDeploy(args)) deployed += 1;
    return { status: 0 };
  };
  // wrangler always runs through spawnCapture (captured stdio), never spawn —
  // the realtime deploy/secret-put commands land here. The fake stdout echoes
  // back whatever --name wrangler was given, so parseWorkerUrl agrees with the
  // subdomain ensureRealtime itself resolved (a REAL wrangler would too).
  const spawnCapture = (cmd, args, opts) => {
    calls.push({ kind: "spawn", cmd, args, cwd: opts.cwd, env: opts.env, input: opts.input });
    if (args.includes("deploy")) {
      const nameIdx = args.indexOf("--name");
      const name = nameIdx >= 0 ? args[nameIdx + 1] : "pos-realtime-worker";
      return { status: 0, stdout: `Deployed ${name}\n  https://${name}.acme.workers.dev\n`, stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  // The store is keyed by forward-slash paths only. run.mjs sometimes builds a
  // path with node:path.join (readPlatform, siblingSubdomainClash), which on
  // Windows normalizes to backslashes — normalize every incoming path here so a
  // literal "/repo/clients/x.json" fixture key and an internally-joined
  // "\repo\clients\x.json" resolve to the SAME store entry.
  const norm = (p) => String(p).replace(/\\/g, "/");
  // A "directory" exists if any stored file key sits directly under it — the fake
  // store has no real directory entries, so siblingSubdomainClash's existsSync(archiveDir)
  // check needs this to see an "_archive" folder that was only ever populated by writing a file into it.
  const dirExists = (p) => { const prefix = `${norm(p)}/`; for (const k of store.keys()) if (k.startsWith(prefix)) return true; return false; };
  const deps = {
    fs: {
      existsSync: (p) => store.has(norm(p)) || dirExists(p),
      readFileSync: (p) => { const key = norm(p); if (!store.has(key)) throw new Error("ENOENT " + p); return store.get(key); },
      writeFileSync: (p, data) => { const key = norm(p); store.set(key, data); calls.push({ kind: "write", path: key }); },
      readdirSync: (dir, opts) => {
        const prefix = norm(dir).endsWith("/") ? norm(dir) : `${norm(dir)}/`;
        const names = new Set();
        for (const p of store.keys()) if (typeof p === "string" && p.startsWith(prefix) && !p.slice(prefix.length).includes("/")) names.add(p.slice(prefix.length));
        if (opts && opts.withFileTypes) return [...names].map((name) => ({ name, isDirectory: () => false }));
        return [...names];
      },
    },
    spawn,
    spawnCapture,
    fetch,
    dnsCheck: dnsCheck ?? {
      checkRecords: async () => ({ cname: { found: null, ok: false }, txt: { found: [], ok: null } }),
      probeHealth: async () => ({ status: null, body: null, error: "not configured for this test" }),
    },
    randomBytes: (n) => Buffer.alloc(n, 7),
    sleep: async () => {},
    log: (line) => calls.push({ kind: "log", line }),
    env: { PATH: "x" },
  };
  return { deps, calls, store, redirectState, readClient: () => JSON.parse(store.get(norm(CLIENT_PATH))), readProfiles: () => JSON.parse(store.get(norm(PROFILES_PATH))) };
}

const opts = (extra = {}) => ({ root: ROOT, clientPath: CLIENT_PATH, ...extra });
const platformFile = (overrides = {}) => JSON.stringify({ apexDomain: "sandbee.in", dnsNote: "GoDaddy → My Products → sandbee.in → DNS", ...overrides });

test("happy path: seed → account → create project → domains → env → profile → deploy → health", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  const s = await runGoLive(opts(), w.deps);

  const seq = w.calls.filter((c) => c.kind !== "log" && c.kind !== "write").map((c) => (c.kind === "spawn" ? `spawn:${isDeploy(c.args) ? "deploy" : c.args.some((a) => String(a).endsWith("seed-client.ts")) ? "seed" : c.args.join(" ")}` : `${c.method} ${c.path}`));
  assert.deepEqual(seq, [
    "spawn:seed",
    "GET /v2/user",
    "GET /v9/projects/sunrise-demo",
    "POST /v11/projects",
    "GET /v9/projects/prj_123/domains",
    "POST /v10/projects/prj_123/env?upsert=true",
    "spawn:deploy",
    "GET /api/health",
  ]);

  const create = w.calls.find((c) => c.path === "/v11/projects");
  assert.deepEqual(create.body, { name: "sunrise-demo", framework: "nextjs", rootDirectory: "apps/cafe" });
  assert.equal(create.auth, "Bearer tok_secret");

  const seed = w.calls.find((c) => c.kind === "spawn" && !isDeploy(c.args));
  assert.equal(seed.cmd, process.execPath, "node directly — npm's `--` passing is unreliable from PowerShell");
  assert.deepEqual(seed.args.slice(0, 2), ["--import", "tsx"]); assert.match(seed.args[2], /seed-client\.ts$/); assert.deepEqual(seed.args.slice(3), ["--file", CLIENT_PATH]);
  assert.equal(seed.cwd, path.join(ROOT, "apps", "cafe"));
  assert.equal(seed.env.MONGODB_URI, client().mongodbUri);
  assert.equal(seed.env.SEED_ADMIN_USERNAME, "Admin");
  assert.equal(seed.env.SEED_ADMIN_PASSWORD, "Strong-Pass-1!");
  assert.equal(seed.env.PATH, "x", "the parent env is passed through");

  const env = w.calls.find((c) => c.path?.startsWith("/v10/projects/prj_123/env")).body;
  const keys = env.map((e) => e.key).sort();
  assert.deepEqual(keys, ["AUTH_SECRET", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "CLOUDINARY_CLOUD_NAME", "CORE_MONGODB_URI", "HEALTH_STATS_TOKEN", "HOSTING_TIER", "IMAGE_STORE", "MONGODB_URI", "NEXTAUTH_SECRET", "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "NEXT_PUBLIC_R2_PUBLIC_BASE_URL", "R2_ACCESS_KEY_ID", "R2_ACCOUNT_ID", "R2_BUCKET", "R2_SECRET_ACCESS_KEY", "ROOT_DOMAIN", "TENANT_ID"]);
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "sunrise-demo-x7k2", "TENANT_ID comes from the ASSIGNED domain label, not the project name");
  assert.equal(env.find((e) => e.key === "ROOT_DOMAIN").value, "vercel.app");

  const deploy = w.calls.find((c) => c.kind === "spawn" && isDeploy(c.args));
  assert.equal(deploy.cmd, process.execPath);
  assert.deepEqual(deploy.args.slice(1), ["--profile", "sunrise-demo"]);
  assert.equal(deploy.cwd, ROOT);

  const profiles = w.readProfiles();
  assert.deepEqual(profiles["sunrise-demo"], { app: "apps/cafe", orgId: "team_owner", projectId: "prj_123", scope: null, tokenEnv: null, token: "tok_secret" });

  const saved = w.readClient();
  assert.equal(saved.generated.projectId, "prj_123");
  assert.equal(saved.generated.orgId, "team_owner");
  assert.match(saved.generated.seededAt, /^\d{4}-\d{2}-\d{2}T/, "the seed date is recorded so the console can lock seeded fields");
  assert.equal(saved.generated.host, "sunrise-demo-x7k2.vercel.app");
  assert.equal(saved.generated.authSecret, Buffer.alloc(32, 7).toString("base64"));
  assert.equal(saved.generated.healthStatsToken, Buffer.alloc(32, 7).toString("hex"));

  assert.equal(s.url, "https://sunrise-demo-x7k2.vercel.app");
  assert.equal(s.tenantId, "sunrise-demo-x7k2");
  assert.equal(s.adminUsername, "admin");
  assert.equal(s.health.ok, true);
  assert.equal(s.dns.pending, false);
  assert.equal(s.redeploy, "npm run deploy -- --profile sunrise-demo");
  assert.ok(!w.calls.some((c) => c.kind === "log" && /tok_secret|Strong-Pass|mongodb\+srv/.test(c.line)), "nothing secret is ever logged");
});

// ---- resume-after-interrupted-run: the deploy profile is written the moment the
// project exists, well before env/deploy — plan-resume-after-fresh.md §1/§6 -----
test("order pin: the deploy profile is written to deploy.profiles.json BEFORE the env upsert (an interrupted run — console closed right after project creation — still leaves the client redeployable by name), and the profile write happens AGAIN later (idempotent, same fields)", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  const s = await runGoLive(opts(), w.deps);

  const profileWrites = w.calls.filter((c) => c.kind === "write" && c.path === PROFILES_PATH.replace(/\\/g, "/"));
  assert.ok(profileWrites.length >= 2, "the profile is written at least twice: right after ensureProject, and again once env/deploy are known");

  const relevant = w.calls.filter((c) => c.kind === "write" || (c.kind === "fetch" && c.path?.startsWith("/v10/projects/prj_123/env")));
  const firstProfileIdx = relevant.findIndex((c) => c.kind === "write" && c.path === PROFILES_PATH.replace(/\\/g, "/"));
  const envIdx = relevant.findIndex((c) => c.kind === "fetch" && c.path?.startsWith("/v10/projects/prj_123/env"));
  assert.ok(firstProfileIdx >= 0 && envIdx >= 0, "positive landmark: both the profile write and the env POST actually happened");
  assert.ok(firstProfileIdx < envIdx, "the FIRST profile write must precede the env upsert call — an interrupted run before env/deploy still leaves a valid profile");

  // A second profile write happens after the env call too (the existing later pass).
  const secondProfileIdx = relevant.findIndex((c, i) => i > envIdx && c.kind === "write" && c.path === PROFILES_PATH.replace(/\\/g, "/"));
  assert.ok(secondProfileIdx > envIdx, "the profile is written AGAIN after the env upsert (the fuller, idempotent pass)");

  const profiles = w.readProfiles();
  assert.deepEqual(profiles["sunrise-demo"], { app: "apps/cafe", orgId: "team_owner", projectId: "prj_123", scope: null, tokenEnv: null, token: "tok_secret" });
  assert.equal(s.projectId, "prj_123");
});

test("interrupted-run resume: a project already created (adopted by id) with NO host recorded and NO deploy profile yet is still adopted and re-profiled on the very next run — the profile write does not depend on env/deploy having finished before", async () => {
  const c = client();
  c.generated = { projectId: "prj_123", orgId: "team_owner" }; // ensureProject created it, then the console closed — no host, no profile
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PROFILES_PATH]: JSON.stringify({}) } });
  await runGoLive(opts({ skipSeed: true }), w.deps);
  const profiles = w.readProfiles();
  assert.equal(profiles["sunrise-demo"].projectId, "prj_123", "the profile exists after this run, even though NOTHING about env/deploy had finished before it started");
});

// ---- hasProduction: a fresh Vercel project (or one adopted with no production
// deployment yet) must not HOLD the address behind a "protect what serves"
// gate that has nothing to protect — plan-resume-after-fresh.md §2/§6 --------
test("hasProduction:false (targets:{} — no production target) on an ADOPTED project with a subdomain set and DNS not ready → NO HOLD: env TENANT_ID takes the platform subdomain straight away", async () => {
  const c = client({ subdomain: "lucifer" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-x7k2.vercel.app", tenantId: "sunrise-demo-x7k2", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" };
  const w = fakeWorld({ projectExists: true, targets: {}, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, dnsCheck: pendingDns });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  const env = w.calls.find((x) => x.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "lucifer", "targets:{} (no production yet) → nothing is currently serving in PRODUCTION, so the address is taken straight away despite a *.vercel.app host being on file");
  assert.equal(s.held, false);
});

test("hasProduction:true (targets:{production:{...}}) on the same adopted project + DNS not ready → HOLD as today: env stays on the current *.vercel.app label", async () => {
  const c = client({ subdomain: "lucifer" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-x7k2.vercel.app", tenantId: "sunrise-demo-x7k2", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" };
  const w = fakeWorld({ projectExists: true, targets: { production: { id: "dpl_1" } }, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, dnsCheck: pendingDns });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  const env = w.calls.find((x) => x.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "sunrise-demo-x7k2", "a real production deployment exists → HOLD, TENANT_ID stays on what serves");
  assert.equal(s.held, true);
});

test("hasProduction:null (GET project response has no `targets` key at all) on the same adopted project + DNS not ready → HOLD (unknown is treated as \"serves\", conservatively)", async () => {
  const c = client({ subdomain: "lucifer" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-x7k2.vercel.app", tenantId: "sunrise-demo-x7k2", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" };
  // `targets` option omitted entirely: fakeWorld leaves the field OUT of the response body.
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, dnsCheck: pendingDns });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  const env = w.calls.find((x) => x.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "sunrise-demo-x7k2", "targets missing (unknown) → HOLD, same as a confirmed production deployment");
  assert.equal(s.held, true);
});

test("re-run: adopts the existing project, keeps the minted secrets, leaves other profiles alone", async () => {
  const first = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  await runGoLive(opts(), first.deps);
  const savedClient = first.readClient();

  const second = fakeWorld({
    projectExists: true,
    files: {
      [CLIENT_PATH]: JSON.stringify(savedClient),
      [PROFILES_PATH]: JSON.stringify({ lucifer007: { app: "apps/cafe", orgId: "team_a", projectId: "prj_a", scope: null, tokenEnv: "VERCEL_TOKEN", token: null } }),
    },
  });
  second.deps.randomBytes = () => { throw new Error("must not mint again"); };
  const s = await runGoLive(opts({ skipSeed: true }), second.deps);

  assert.ok(!second.calls.some((c) => c.path === "/v11/projects"), "no second create");
  assert.ok(!second.calls.some((c) => c.kind === "spawn" && !isDeploy(c.args)), "--skip-seed skips the seeder");
  assert.equal(second.readClient().generated.authSecret, savedClient.generated.authSecret);
  assert.equal(second.readClient().generated.seededAt, savedClient.generated.seededAt, "--skip-seed leaves the recorded seed date alone");
  const profiles = second.readProfiles();
  assert.deepEqual(profiles.lucifer007, { app: "apps/cafe", orgId: "team_a", projectId: "prj_a", scope: null, tokenEnv: "VERCEL_TOKEN", token: null });
  assert.equal(profiles["sunrise-demo"].projectId, "prj_123");
  assert.equal(s.health.ok, true);
});

test("fallback: no *.vercel.app domain listed yet → deploy, read the label, pin TENANT_ID, deploy again", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) }, domainsAfterDeploy: true });
  const s = await runGoLive(opts(), w.deps);
  const deploys = w.calls.filter((c) => c.kind === "spawn" && isDeploy(c.args));
  assert.equal(deploys.length, 2);
  const envCalls = w.calls.filter((c) => c.path?.startsWith("/v10/projects/prj_123/env"));
  assert.equal(envCalls.length, 2);
  assert.ok(!envCalls[0].body.some((e) => e.key === "TENANT_ID"), "first env set has no TENANT_ID (unknown yet)");
  assert.deepEqual(envCalls[1].body.map((e) => e.key).sort(), ["ROOT_DOMAIN", "TENANT_ID"]);
  assert.equal(envCalls[1].body.find((e) => e.key === "TENANT_ID").value, "sunrise-demo-x7k2");
  assert.equal(s.tenantId, "sunrise-demo-x7k2");
  assert.equal(s.health.ok, true);
});

// ---- Platform web-address scenarios (plan §9) --------------------------------
// Every scenario's client carries `subdomain: "lucifer"` and the fixture writes
// clients/_platform.json (apex "sandbee.in") unless a scenario says otherwise.
// The fake dnsCheck is parameterised per scenario via `dnsCheck` in fakeWorld().
const readyDns = { checkRecords: async () => ({ cname: { found: "abc.vercel-dns-017.com", ok: true }, txt: { found: [], ok: null } }), probeHealth: async (host) => ({ status: 200, body: { ok: true, db: "up", tenant: host.split(".")[0] }, error: null }) };
const pendingDns = { checkRecords: async () => ({ cname: { found: null, ok: false }, txt: { found: [], ok: null } }), probeHealth: async () => ({ status: null, body: null, error: "ENOTFOUND" }) };

test("web address scenario 1: new client (created) + ready DNS → env TENANT_ID=sub ROOT_DOMAIN=apex, deploy, probe health, redirect PATCH 308 on every *.vercel.app (skipping git-branch aliases), redirects verified via manual fetch, webAddress.live", async () => {
  const w = fakeWorld({
    files: { [CLIENT_PATH]: JSON.stringify(client({ subdomain: "lucifer" })), [PLATFORM_PATH]: platformFile() },
    manualRedirects: { "sunrise-demo-x7k2.vercel.app": "https://lucifer.sandbee.in/api/health" },
    dnsCheck: readyDns,
  });
  const s = await runGoLive(opts(), w.deps);
  const env = w.calls.find((c) => c.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "lucifer");
  assert.equal(env.find((e) => e.key === "ROOT_DOMAIN").value, "sandbee.in");
  assert.ok(w.calls.some((c) => c.kind === "spawn" && isDeploy(c.args)), "deploy happened");
  const patch = w.calls.find((c) => c.method === "PATCH" && c.path === "/v9/projects/prj_123/domains/sunrise-demo-x7k2.vercel.app");
  assert.deepEqual(patch.body, { redirect: "lucifer.sandbee.in", redirectStatusCode: 308 });
  const manual = w.calls.find((c) => c.manual && c.host === "sunrise-demo-x7k2.vercel.app");
  assert.ok(manual, "the redirect was verified with a manual-redirect fetch to the OLD host");
  const saved = w.readClient();
  assert.equal(saved.generated.webAddress.live, true);
  assert.equal(saved.generated.webAddress.host, "lucifer.sandbee.in");
  assert.deepEqual(saved.generated.webAddress.redirects, [{ from: "sunrise-demo-x7k2.vercel.app", ok: true, location: "https://lucifer.sandbee.in/api/health", pathKept: true }]);
  assert.equal(s.host, "lucifer.sandbee.in");
});

test("web address scenario 2: new client, DNS pending → env still platform (created), deploy, health skipped pending-dns, records in summary, no redirect", async () => {
  const w = fakeWorld({
    files: { [CLIENT_PATH]: JSON.stringify(client({ subdomain: "lucifer" })), [PLATFORM_PATH]: platformFile() },
    domainConfig: { misconfigured: true, configuredBy: null, recommendedCNAME: [{ rank: 1, value: "abc.vercel-dns-017.com" }] },
    dnsCheck: pendingDns,
  });
  const s = await runGoLive(opts(), w.deps);
  const env = w.calls.find((c) => c.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "lucifer", "created → env still carries the platform tenant even though DNS is pending");
  assert.ok(w.calls.some((c) => c.kind === "spawn" && isDeploy(c.args)), "deploy still happens");
  assert.ok(!w.calls.some((c) => c.method === "PATCH" && /\/domains\//.test(c.path)), "no redirect PATCH while pending");
  const saved = w.readClient();
  assert.equal(saved.generated.webAddress.state, "pending-dns");
  assert.ok(Array.isArray(saved.generated.webAddress.records) && saved.generated.webAddress.records.length > 0, "records are recorded for the console/CLI table");
  assert.equal(saved.generated.webAddress.live, false);
});

test("check-failed: Vercel's GET domain-config call fails (500) → configured:null, state check-failed — not confused with a real misconfigured:true verdict, no redirect, HOLD on the current host", async () => {
  const c = client({ subdomain: "lucifer" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-x7k2.vercel.app", tenantId: "sunrise-demo-x7k2", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" };
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, domainConfigFails: true, dnsCheck: readyDns });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  assert.equal(s.webAddress.configured, null);
  assert.equal(s.webAddress.state, "check-failed");
  assert.equal(s.held, true, "not ready (config unknown) → HOLD, the same as any other not-ready reason");
  assert.ok(!w.calls.some((x) => x.method === "PATCH" && /\/domains\//.test(x.path)), "no redirect PATCH");
  const saved = w.readClient();
  assert.equal(saved.generated.host, "sunrise-demo-x7k2.vercel.app", "stayed on the current host");
});

test("web address scenario 3: adopted live project (already on x.vercel.app), not ready → HOLD: env stays on the vercel label, deploy still happens, held:true, webAddress.state saved, NO redirect PATCH", async () => {
  const c = client({ subdomain: "lucifer" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-x7k2.vercel.app", tenantId: "sunrise-demo-x7k2", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" };
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, dnsCheck: pendingDns });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  const env = w.calls.find((x) => x.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "sunrise-demo-x7k2", "HOLD: TENANT_ID stays on the current *.vercel.app label");
  assert.ok(w.calls.some((x) => x.kind === "spawn" && isDeploy(x.args)), "the deploy still happens on HOLD");
  assert.ok(!w.calls.some((x) => x.method === "PATCH" && /\/domains\//.test(x.path)), "no redirect PATCH while held");
  assert.equal(s.held, true);
  const saved = w.readClient();
  assert.ok(saved.generated.webAddress, "the address status was saved even though the switch did not happen");
  assert.notEqual(saved.generated.webAddress.state, "ready", "not ready is why this held");
  assert.equal(saved.generated.host, "sunrise-demo-x7k2.vercel.app", "hosting stayed on the vercel.app address");
});

test("adopted project with NO host yet (never deployed, no *.vercel.app name listed): nothing serves, so no HOLD — the address is taken straight away (env TENANT_ID=sub), deploy once, health waits for DNS, held:false", async () => {
  const c = client({ subdomain: "lucifer" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" };
  const w = fakeWorld({ projectExists: true, domainsAfterDeploy: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, dnsCheck: pendingDns });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  const env = w.calls.find((x) => x.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "lucifer", "no host to protect → the platform tenant goes straight in");
  assert.equal(env.find((e) => e.key === "ROOT_DOMAIN").value, JSON.parse(platformFile()).apexDomain);
  assert.equal(w.calls.filter((x) => x.kind === "spawn" && isDeploy(x.args)).length, 1, "one deploy — the two-deploy *.vercel.app fallback is not needed for a platform address");
  assert.equal(s.held, false);
  assert.equal(s.switched, false, "not a switch — nothing was serving before");
  assert.equal(s.health.ok, null, "health waits for the DNS records");
  assert.ok(!w.calls.some((x) => x.method === "PATCH" && /\/domains\//.test(x.path)), "no redirect until the address is live");
  const saved = w.readClient();
  assert.equal(saved.generated.host, "lucifer." + JSON.parse(platformFile()).apexDomain);
  assert.equal(saved.generated.webAddress.held, false);
  assert.equal(saved.generated.webAddress.servingHost, null);
});

test("the recommended CNAME target loses Vercel's trailing dot (\"cname.vercel-dns.com.\") in the records the owner copies", async () => {
  const c = client({ subdomain: "lucifer" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-x7k2.vercel.app", tenantId: "sunrise-demo-x7k2", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" };
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, dnsCheck: pendingDns, domainConfig: { misconfigured: true, configuredBy: null, recommendedCNAME: [{ rank: 1, value: "cname.vercel-dns.com." }] } });
  await runGoLive(opts({ skipSeed: true }), w.deps);
  const rec = w.readClient().generated.webAddress.records.find((r) => r.type === "CNAME");
  assert.equal(rec.value, "cname.vercel-dns.com", "no trailing dot in what the owner types at GoDaddy");
});

test("rename-HOLD: a cafe already LIVE at a.<apex> whose subdomain is renamed to b stays on a while b is not ready — env TENANT_ID=a ROOT_DOMAIN=<apex> (never the *.vercel.app label), held:true, servingHost recorded", async () => {
  const c = client({ subdomain: "b" }); // the file now asks for b.sandbee.in
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "a.sandbee.in", tenantId: "a", rootDomain: "sandbee.in", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z", webAddress: { host: "a.sandbee.in", live: true } };
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, domains: [{ name: "sunrise-demo-x7k2.vercel.app", verified: true }], dnsCheck: pendingDns });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  const env = w.calls.find((x) => x.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "a", "the RECORDED platform host stays the tenant — never the *.vercel.app label the project also carries");
  assert.equal(env.find((e) => e.key === "ROOT_DOMAIN").value, "sandbee.in");
  assert.ok(!w.calls.some((x) => x.method === "PATCH" && /\/domains\//.test(x.path)), "no redirect PATCH while held — nothing about the address changes");
  assert.equal(s.held, true);
  assert.equal(s.host, "a.sandbee.in");
  const saved = w.readClient();
  assert.equal(saved.generated.host, "a.sandbee.in", "hosting stays on the currently-live platform host, not the vercel.app one");
  assert.equal(saved.generated.webAddress.held, true);
  assert.equal(saved.generated.webAddress.servingHost, "a.sandbee.in", "the console/CLI can say which host keeps serving");
});

test("rename-SWITCH: a cafe live at a.<apex> renamed to b, and b IS ready → the OLD platform name a.<apex> is redirected (308) to b.<apex> too, alongside every *.vercel.app name; the target host itself is never PATCHed", async () => {
  const c = client({ subdomain: "b" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "a.sandbee.in", tenantId: "a", rootDomain: "sandbee.in", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z", webAddress: { host: "a.sandbee.in", live: true } };
  const w = fakeWorld({
    projectExists: true,
    files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() },
    domains: [{ name: "sunrise-demo-x7k2.vercel.app", verified: true }, { name: "a.sandbee.in", verified: true }], // the old platform name is already attached, from when it was live
    dnsCheck: readyDns,
    manualRedirects: { "sunrise-demo-x7k2.vercel.app": "https://b.sandbee.in/api/health", "a.sandbee.in": "https://b.sandbee.in/api/health" },
  });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  assert.equal(s.switched, true);
  assert.equal(s.host, "b.sandbee.in");
  const patchedNames = w.calls.filter((x) => x.method === "PATCH" && /\/domains\//.test(x.path)).map((x) => decodeURIComponent(x.path.split("/").pop()));
  assert.ok(patchedNames.includes("a.sandbee.in"), "the OLD platform name is redirected too, or it would answer 404 (still attached, no longer TENANT_ID)");
  assert.ok(patchedNames.includes("sunrise-demo-x7k2.vercel.app"), "every *.vercel.app name is still redirected as usual");
  assert.ok(!patchedNames.includes("b.sandbee.in"), "the target host itself is never PATCHed to redirect to itself");
  const aPatch = w.calls.find((x) => x.method === "PATCH" && x.path === "/v9/projects/prj_123/domains/a.sandbee.in");
  assert.deepEqual(aPatch.body, { redirect: "b.sandbee.in", redirectStatusCode: 308 });
  assert.equal(w.redirectState.get("a.sandbee.in").redirect, "b.sandbee.in");
});

test("web address scenario 4: same adopted project, ready → switch: env platform, health on new host, redirect PATCH, switched:true, previousHost", async () => {
  const c = client({ subdomain: "lucifer" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-x7k2.vercel.app", tenantId: "sunrise-demo-x7k2", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" };
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, dnsCheck: readyDns, manualRedirects: { "sunrise-demo-x7k2.vercel.app": "https://lucifer.sandbee.in/api/health" } });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  const env = w.calls.find((x) => x.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "lucifer", "ready → env switches to the platform tenant");
  assert.ok(w.calls.some((x) => x.kind === "fetch" && x.path === "/api/health"), "health is checked on the new host");
  const patch = w.calls.find((x) => x.method === "PATCH" && x.path === "/v9/projects/prj_123/domains/sunrise-demo-x7k2.vercel.app");
  assert.deepEqual(patch.body, { redirect: "lucifer.sandbee.in", redirectStatusCode: 308 });
  assert.equal(s.switched, true);
  assert.equal(s.previousHost, "sunrise-demo-x7k2.vercel.app");
  assert.equal(s.host, "lucifer.sandbee.in");
});

test("web address scenario 5: already on the address → no switch, no HOLD, redirects ensured idempotently (PATCH only when d.redirect !== host)", async () => {
  const c = client({ subdomain: "lucifer" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "lucifer.sandbee.in", tenantId: "lucifer", rootDomain: "sandbee.in", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z", webAddress: { host: "lucifer.sandbee.in", live: true } };
  const w = fakeWorld({
    projectExists: true,
    files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() },
    domains: [{ name: "sunrise-demo-x7k2.vercel.app", verified: true, redirect: "lucifer.sandbee.in", redirectStatusCode: 308 }, { name: "lucifer.sandbee.in", verified: true }],
    dnsCheck: readyDns, manualRedirects: { "sunrise-demo-x7k2.vercel.app": "https://lucifer.sandbee.in/api/health" },
  });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  assert.equal(s.switched, false); assert.equal(s.held, false);
  assert.ok(!w.calls.some((x) => x.method === "PATCH" && x.path === "/v9/projects/prj_123/domains/sunrise-demo-x7k2.vercel.app"), "already redirect:lucifer.sandbee.in → PATCH is skipped (idempotent)");
  assert.equal(s.host, "lucifer.sandbee.in");
});

test("tenant-mismatch blocks readiness: the probe answers, but as a tenant this cafe does not know — state tenant-mismatch, reachable:false, no switch; a body tenant equal to the CURRENT *.vercel.app label counts as reachable instead", async () => {
  const c = client({ subdomain: "lucifer" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-x7k2.vercel.app", tenantId: "sunrise-demo-x7k2", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" };
  const strangerDns = { checkRecords: async () => ({ cname: { found: "abc.vercel-dns-017.com", ok: true }, txt: { found: [], ok: null } }), probeHealth: async () => ({ status: 200, body: { ok: true, db: "up", tenant: "stranger" }, error: null }) };
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, dnsCheck: strangerDns });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  assert.equal(s.held, true, "not reachable → not ready → HOLD, same as any other not-ready reason");
  assert.equal(s.webAddress.state, "tenant-mismatch");
  assert.equal(s.webAddress.reachable, false);
  assert.equal(s.webAddress.probeTenant, "stranger");
  assert.ok(w.calls.some((x) => x.kind === "log" && /answers as tenant/.test(x.line) && /stranger/.test(x.line)), "the log names the wrong tenant it saw");
  const env = w.calls.find((x) => x.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "sunrise-demo-x7k2", "TENANT_ID never switches to an address that answers as someone else");

  // Same shape, but the probe body's tenant is the CURRENT *.vercel.app label — that
  // IS a tenant this cafe is known as (current.tenantId is in knownTenants), so it counts as reachable.
  const knownLabelDns = { checkRecords: async () => ({ cname: { found: "abc.vercel-dns-017.com", ok: true }, txt: { found: [], ok: null } }), probeHealth: async () => ({ status: 200, body: { ok: true, db: "up", tenant: "sunrise-demo-x7k2" }, error: null }) };
  const w2 = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, dnsCheck: knownLabelDns, manualRedirects: { "sunrise-demo-x7k2.vercel.app": "https://lucifer.sandbee.in/api/health" } });
  const s2 = await runGoLive(opts({ skipSeed: true }), w2.deps);
  assert.equal(s2.webAddress.reachable, true, "the current vercel label is a KNOWN tenant for this cafe, not a stranger");
  assert.equal(s2.webAddress.state, "ready");
  assert.equal(s2.switched, true, "ready → the switch proceeds");
});

test("web address scenario 6: revert (subdomain cleared) → PATCH redirect:null on every *.vercel.app BEFORE the env call (order pin), env vercel shape, webAddress gone, previousWebAddress kept; a PATCH failure stops with GoLiveError step domain and NO env call", async () => {
  const withAddress = client({ subdomain: null });
  withAddress.generated = { projectId: "prj_123", orgId: "team_owner", host: "lucifer.sandbee.in", tenantId: "lucifer", rootDomain: "sandbee.in", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z", webAddress: { host: "lucifer.sandbee.in", live: true } };
  const w = fakeWorld({
    projectExists: true,
    files: { [CLIENT_PATH]: JSON.stringify(withAddress), [PLATFORM_PATH]: platformFile() },
    domains: [{ name: "sunrise-demo-x7k2.vercel.app", verified: true, redirect: "lucifer.sandbee.in", redirectStatusCode: 308 }],
  });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  const relevant = w.calls.filter((c) => (c.kind === "fetch" && (c.method === "PATCH" || c.path?.startsWith("/v10/projects/prj_123/env"))));
  const patchIdx = relevant.findIndex((c) => c.method === "PATCH");
  const envIdx = relevant.findIndex((c) => c.path?.startsWith("/v10/projects/prj_123/env"));
  assert.ok(patchIdx >= 0 && envIdx >= 0 && patchIdx < envIdx, "the redirect is dropped BEFORE the env call — order pin");
  const patch = w.calls.find((c) => c.method === "PATCH" && c.path === "/v9/projects/prj_123/domains/sunrise-demo-x7k2.vercel.app");
  assert.deepEqual(patch.body, { redirect: null, redirectStatusCode: null });
  const env = w.calls.find((c) => c.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "sunrise-demo-x7k2", "env goes back to the vercel shape");
  const saved = w.readClient();
  assert.equal("webAddress" in saved.generated, false, "the address is gone from generated");
  assert.equal(saved.generated.previousWebAddress.host, "lucifer.sandbee.in", "…but kept under previousWebAddress");
  assert.equal(s.host, "sunrise-demo-x7k2.vercel.app");

  // A PATCH failure during the revert: no env call, run stops with GoLiveError step "domain".
  const failing = fakeWorld({
    projectExists: true,
    files: { [CLIENT_PATH]: JSON.stringify(withAddress), [PLATFORM_PATH]: platformFile() },
    domains: [{ name: "sunrise-demo-x7k2.vercel.app", verified: true, redirect: "lucifer.sandbee.in", redirectStatusCode: 308 }],
  });
  const realFetch = failing.deps.fetch;
  failing.deps.fetch = async (url, init) => {
    if (init?.method === "PATCH" && String(url).includes("/domains/")) return { status: 400, ok: false, json: async () => ({ error: { code: "bad_request", message: "The domain redirect is not valid" } }) };
    return realFetch(url, init);
  };
  await assert.rejects(runGoLive(opts({ skipSeed: true }), failing.deps), (e) => e instanceof GoLiveError && e.step === "domain" && /NOT changed/.test(e.message) && /sunrise-demo-x7k2\.vercel\.app/.test(e.message));
  assert.ok(!failing.calls.some((c) => c.path?.startsWith("/v10/projects/prj_123/env")), "no env call when the revert's redirect removal fails");
});

test("revert clears ONLY redirects targeting the abandoned platform host — matched by TARGET, so an unrelated redirect the owner set up elsewhere survives untouched", async () => {
  const withAddress = client({ subdomain: null });
  withAddress.generated = { projectId: "prj_123", orgId: "team_owner", host: "lucifer.sandbee.in", tenantId: "lucifer", rootDomain: "sandbee.in", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z", webAddress: { host: "lucifer.sandbee.in", live: true } };
  const w = fakeWorld({
    projectExists: true,
    files: { [CLIENT_PATH]: JSON.stringify(withAddress), [PLATFORM_PATH]: platformFile() },
    domains: [
      { name: "sunrise-demo-x7k2.vercel.app", verified: true, redirect: "lucifer.sandbee.in", redirectStatusCode: 308 }, // this tool's own redirect → cleared
      { name: "other-owned.vercel.app", verified: true, redirect: "somewhere-else.example.com", redirectStatusCode: 301 }, // an unrelated redirect → must survive
    ],
  });
  await runGoLive(opts({ skipSeed: true }), w.deps);
  const patchedNames = w.calls.filter((c) => c.method === "PATCH" && /\/domains\//.test(c.path)).map((c) => decodeURIComponent(c.path.split("/").pop()));
  assert.deepEqual(patchedNames, ["sunrise-demo-x7k2.vercel.app"], "only the redirect that targeted the abandoned host was touched");
  assert.equal(w.redirectState.get("other-owned.vercel.app").redirect, "somewhere-else.example.com", "the unrelated redirect was never PATCHed");
  assert.equal(w.redirectState.get("sunrise-demo-x7k2.vercel.app").redirect, null, "the abandoned host's redirect was cleared");
});

test("web address scenario 7: 409 on add → GoLiveError step domain, no env call; verify 400 while pending is NOT an error", async () => {
  const w409 = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client({ subdomain: "lucifer" })), [PLATFORM_PATH]: platformFile() } });
  const realFetch409 = w409.deps.fetch;
  w409.deps.fetch = async (url, init) => {
    if (init?.method === "POST" && String(url).includes("/domains") && !String(url).includes("/verify")) return { status: 409, ok: false, json: async () => ({ error: { code: "forbidden", message: "already assigned to another Vercel project" } }) };
    return realFetch409(url, init);
  };
  await assert.rejects(runGoLive(opts(), w409.deps), (e) => e instanceof GoLiveError && e.step === "domain");
  assert.ok(!w409.calls.some((c) => c.path?.startsWith("/v10/projects/prj_123/env")), "no env call after the 409");

  const wPending = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client({ subdomain: "lucifer" })), [PLATFORM_PATH]: platformFile() }, dnsCheck: pendingDns });
  const realFetchPending = wPending.deps.fetch;
  wPending.deps.fetch = async (url, init) => {
    if (init?.method === "POST" && String(url).includes("/verify")) return { status: 400, ok: false, json: async () => ({ error: { code: "bad_request", message: "does not have a TXT record" } }) };
    return realFetchPending(url, init);
  };
  const s = await runGoLive(opts(), wPending.deps); // must NOT throw
  assert.equal(s.dryRun, false);
  assert.notEqual(s.webAddress?.state, undefined);
});

test("web address scenario 8: a sibling client file with the same subdomain is a guard error; checkWebAddress answers no-project/no-subdomain without a Vercel call; secrets never appear in a log line", async () => {
  const sibling = client({ slug: "other-cafe", subdomain: "lucifer" });
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client({ subdomain: "lucifer" })), [PLATFORM_PATH]: platformFile(), "/repo/clients/other-cafe.json": JSON.stringify(sibling) } });
  await assert.rejects(runGoLive(opts(), w.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /lucifer\.sandbee\.in/.test(e.message) && /other-cafe/.test(e.message));
  assert.ok(!w.calls.some((c) => c.kind === "fetch"), "the sibling guard runs before any Vercel call");
  assert.ok(!w.calls.some((c) => c.kind === "log" && /tok_secret|Strong-Pass|mongodb\+srv/.test(c.line)), "nothing secret is ever logged");

  const { checkWebAddress } = await import("./web-address.mjs");
  const noProject = await checkWebAddress({ clientPath: "/repo/clients/other-cafe.json" }, { ...w.deps, fs: { ...w.deps.fs } });
  assert.equal(noProject.state, "no-project");
  // Deployed (generated.projectId set) so validateClient allows a null subdomain
  // even with a platform configured (legacy *.vercel.app host) — otherwise the
  // "subdomain required" rule would fire before checkWebAddress ever reaches its
  // own no-subdomain branch.
  const noSubClient = client({ slug: "third-cafe", subdomain: null, generated: { projectId: "prj_legacy", host: "third-cafe-x1.vercel.app" } });
  w.store.set("/repo/clients/third-cafe.json", JSON.stringify(noSubClient));
  const noSub = await checkWebAddress({ clientPath: "/repo/clients/third-cafe.json" }, w.deps);
  assert.equal(noSub.state, "no-subdomain");
});

test("sibling guard: an ARCHIVED client claiming the same subdomain is a guard error too, named '<slug> (archived)' — an archived cafe can still hold the Vercel attachment for its address", async () => {
  const archived = client({ slug: "retired-cafe", subdomain: "lucifer" });
  const w = fakeWorld({
    files: {
      [CLIENT_PATH]: JSON.stringify(client({ subdomain: "lucifer" })),
      [PLATFORM_PATH]: platformFile(),
      "/repo/clients/_archive/retired-cafe.json": JSON.stringify(archived),
    },
  });
  await assert.rejects(runGoLive(opts(), w.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /lucifer\.sandbee\.in/.test(e.message) && /retired-cafe \(archived\)/.test(e.message));
  assert.ok(!w.calls.some((c) => c.kind === "fetch"), "the archive scan runs before any Vercel call too");
  // Case-insensitive, and an archived file whose subdomain does NOT clash is not reported.
  const noClash = fakeWorld({
    files: {
      [CLIENT_PATH]: JSON.stringify(client({ subdomain: "lucifer" })),
      [PLATFORM_PATH]: platformFile(),
      "/repo/clients/_archive/other-retired.json": JSON.stringify(client({ slug: "other-retired", subdomain: "somethingelse" })),
    },
  });
  await runGoLive(opts({ dryRun: true }), noClash.deps); // dry-run: never reaches the guard, just proves the fixture alone isn't the trigger
  const caseInsensitive = fakeWorld({
    files: {
      [CLIENT_PATH]: JSON.stringify(client({ subdomain: "lucifer" })),
      [PLATFORM_PATH]: platformFile(),
      "/repo/clients/_archive/retired-cafe.json": JSON.stringify(client({ slug: "retired-cafe", subdomain: "LUCIFER" })),
    },
  });
  await assert.rejects(runGoLive(opts(), caseInsensitive.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /retired-cafe \(archived\)/.test(e.message), "the match is case-insensitive");
});

test("web address scenario 9 (repeat/expand of the existing standby pin): a standby run never attaches the web address, and tenantOf is called with platform=null for a standby slot even though the file has a subdomain + a platform exists", async () => {
  const primary = client({ subdomain: "lucifer" });
  primary.generated = { projectId: "prj_primary", orgId: "team_owner", host: "lucifer.sandbee.in", tenantId: "lucifer", rootDomain: "sandbee.in", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z", webAddress: { host: "lucifer.sandbee.in", live: true } };
  primary.standbyHosts = [{ label: "standby", vercel: { token: "tok_standby", project: null, teamId: null } }];
  // A platform file DOES exist (a subdomain-carrying client cannot validate without one) — the pin
  // is that the STANDBY slot's own tenant/address decision never uses it (run.mjs passes `platform`
  // to tenantOf only when slot.isPrimary), not that the file is physically absent.
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(primary), [PLATFORM_PATH]: platformFile() } });
  const s = await runGoLive(opts({ host: "standby" }), w.deps);
  assert.ok(!w.calls.some((c) => c.path === "/v10/projects/prj_123/domains" && c.method === "POST"), "no domain attach for the standby");
  assert.equal(w.readClient().generated.webAddress.host, "lucifer.sandbee.in", "the primary's web address is untouched");
  assert.equal(s.hostLabel, "standby");
  const env = w.calls.find((c) => c.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "ROOT_DOMAIN").value, "vercel.app", "the standby serves on its own *.vercel.app, never the platform apex");
});

// ── Live-incident regressions: the Node 22 autoSelectFamily bug made EVERY
// address read "https not ready"/pending-cert while the site served fine
// (dns-check.mjs's probeHealth fix is pinned in dns-check.test.mjs). These two
// pins are the OTHER half: web-address.mjs's `switchedHere` rule, exercised
// through checkWebAddress exactly like scenario 8 above (dynamic import,
// direct call against the fakeWorld's deps — never a shortcut past the real
// function). ------------------------------------------------------------
test("web address scenario 10: a record ALREADY switched to a.sandbee.in (generated.host/tenantId = a.sandbee.in/a, webAddress.live false) whose probe answers 200 tenant \"a\" with Vercel verified+configured -> checkWebAddress returns state \"ready\" AND live true, and the saved file carries live true", async () => {
  const { checkWebAddress } = await import("./web-address.mjs");
  const c = client({ subdomain: "a" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "a.sandbee.in", tenantId: "a", rootDomain: "sandbee.in", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z", webAddress: { host: "a.sandbee.in", live: false, state: "pending-cert" } };
  const switchedDns = { checkRecords: async () => ({ cname: { found: "abc.vercel-dns-017.com", ok: true }, txt: { found: [], ok: null } }), probeHealth: async () => ({ status: 200, body: { ok: true, db: "up", tenant: "a" }, error: null }) };
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, dnsCheck: switchedDns });
  const r = await checkWebAddress({ clientPath: CLIENT_PATH }, w.deps);
  assert.equal(r.state, "ready");
  assert.equal(r.live, true, "already on this exact host, tenant proven live -> live true");
  const saved = w.readClient();
  assert.equal(saved.generated.webAddress.live, true, "the saved file must persist live:true, not just the return value");
  assert.equal(saved.generated.webAddress.state, "ready");
});

test("web address scenario 11: the record still on the *.vercel.app shape (generated.host = a-cafe.vercel.app, tenantId \"a-cafe\") whose probe answers tenant \"a\" (a MISMATCH from the current *.vercel.app label) -> state \"ready\", live FALSE (HELD — a run must switch it)", async () => {
  const { checkWebAddress } = await import("./web-address.mjs");
  const c = client({ subdomain: "a" });
  c.generated = { projectId: "prj_123", orgId: "team_owner", host: "a-cafe.vercel.app", tenantId: "a-cafe", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" };
  const mismatchDns = { checkRecords: async () => ({ cname: { found: "abc.vercel-dns-017.com", ok: true }, txt: { found: [], ok: null } }), probeHealth: async () => ({ status: 200, body: { ok: true, db: "up", tenant: "a" }, error: null }) };
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c), [PLATFORM_PATH]: platformFile() }, dnsCheck: mismatchDns });
  const r = await checkWebAddress({ clientPath: CLIENT_PATH }, w.deps);
  assert.equal(r.state, "ready", "DNS/https/verification are all fine — the address itself is ready");
  assert.equal(r.live, false, "the record is STILL on the *.vercel.app shape (generated.host !== web.host) — switchedHere must not fire, so live stays false until a run switches it");
  const saved = w.readClient();
  assert.equal(saved.generated.webAddress.live, false);
  assert.equal(saved.generated.host, "a-cafe.vercel.app", "the recorded host is untouched — checkWebAddress never switches TENANT_ID itself, only a run does");
});

test("--preview passes through to deploy.mjs and skips the health check", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  const s = await runGoLive(opts({ preview: true }), w.deps);
  const deploy = w.calls.find((c) => c.kind === "spawn" && isDeploy(c.args));
  assert.deepEqual(deploy.args.slice(1), ["--profile", "sunrise-demo", "--preview"]);
  assert.equal(s.health.ok, null);
  assert.ok(!w.calls.some((c) => c.path === "/api/health"));
});

test("--dry-run validates and plans without touching anything", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  const s = await runGoLive(opts({ dryRun: true }), w.deps);
  assert.equal(s.dryRun, true);
  assert.equal(w.calls.filter((c) => c.kind !== "log").length, 0);
});

test("a failing seed stops BEFORE any Vercel call, with a hint", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  w.deps.spawn = () => ({ status: 1 });
  await assert.rejects(runGoLive(opts(), w.deps), (err) => err instanceof GoLiveError && err.step === "seed" && /Network Access/.test(err.hint));
  assert.equal(w.calls.filter((c) => c.kind === "fetch").length, 0);
});

test("a failing deploy stops with the redeploy hint; the profile and env are already in place for the re-run", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  const realSpawn = w.deps.spawn;
  w.deps.spawn = (cmd, args, o) => (isDeploy(args) ? { status: 1 } : realSpawn(cmd, args, o));
  await assert.rejects(runGoLive(opts(), w.deps), (err) => err instanceof GoLiveError && err.step === "deploy" && /--profile sunrise-demo/.test(err.hint));
  assert.ok(w.store.has(PROFILES_PATH.replace(/\\/g, "/")));
  assert.ok(w.calls.some((c) => c.path?.startsWith("/v10/projects/prj_123/env")));
});

test("health 503 db:down is reported, not thrown, with the Atlas hint", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) }, health: { status: 503, body: { ok: false, db: "down" } } });
  const s = await runGoLive(opts(), w.deps);
  assert.equal(s.health.ok, false);
  assert.match(s.health.reason, /Atlas Network Access/);
});

test("an invalid or missing client file fails at validation with every problem listed", async () => {
  const bad = client({ slug: "www", admin: { username: "admin", password: "weak" } });
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(bad) } });
  await assert.rejects(runGoLive(opts(), w.deps), (err) => err instanceof GoLiveError && err.step === "validate" && /2 problem/.test(err.message));
  const missing = fakeWorld({ files: {} });
  await assert.rejects(runGoLive(opts(), missing.deps), (err) => err instanceof GoLiveError && err.step === "read");
});

test("partial env failures from Vercel are an error (a silently missing var is a broken deploy)", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  const realFetch = w.deps.fetch;
  w.deps.fetch = async (url, init) => {
    if (url.includes("/env?upsert=true")) return { status: 201, ok: true, json: async () => ({ created: [], failed: [{ error: { code: "ENV_TOO_LONG" } }] }) };
    return realFetch(url, init);
  };
  await assert.rejects(runGoLive(opts(), w.deps), /1\/18 env vars failed to save \(ENV_TOO_LONG\)/);
});

test("an edit the owner saves WHILE the job runs survives every later write of the job (read-modify-write on `generated` only)", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  const orig = w.deps.fs.writeFileSync; let injected = false;
  w.deps.fs.writeFileSync = (p, data) => {
    orig(p, data);
    if (p === CLIENT_PATH && !injected) { injected = true; const c = JSON.parse(w.store.get(CLIENT_PATH)); c.notes = "edited during the job"; c.cafe.tagline = "new tagline"; w.store.set(CLIENT_PATH, JSON.stringify(c)); }
  };
  await runGoLive(opts(), w.deps);
  const saved = w.readClient();
  assert.equal(injected, true, "the concurrent edit was injected after the job's first write");
  assert.equal(saved.notes, "edited during the job");
  assert.equal(saved.cafe.tagline, "new tagline");
  assert.equal(saved.generated.host, "sunrise-demo-x7k2.vercel.app", "and the job's own results still landed");
  assert.ok(saved.generated.authSecret);
});

test("ONE project forever: a renamed vercel.project on an already-deployed client adopts the RECORDED project by id — never a second project, never a new URL", async () => {
  const first = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  await first.deps.fetch; await runGoLive(opts(), first.deps);
  const saved = first.readClient();
  saved.vercel.project = "possandbee"; // the owner renamed the project in the file afterwards
  const second = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(saved) } });
  const s = await runGoLive(opts({ skipSeed: true }), second.deps);
  const gets = second.calls.filter((c) => c.kind === "fetch" && c.method === "GET" && c.path.startsWith("/v9/projects/"));
  assert.equal(gets[0].path, "/v9/projects/prj_123", "the recorded id is looked up FIRST");
  assert.ok(!second.calls.some((c) => c.path === "/v9/projects/possandbee"), "the new name is never even looked up");
  assert.ok(!second.calls.some((c) => c.path === "/v11/projects"), "no second project is created");
  assert.equal(s.projectId, "prj_123"); assert.equal(s.projectName, "sunrise-demo"); assert.equal(s.host, "sunrise-demo-x7k2.vercel.app");
  assert.ok(second.calls.some((c) => c.kind === "log" && /keeping the live one/.test(c.line)), "the owner is told the file's name was ignored");
  assert.equal(second.readClient().generated.projectId, "prj_123");
});

test("the host is re-read every run and the project's own *.vercel.app wins over a suffixed one; a changed host is announced", async () => {
  const c = client(); c.generated = { projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-two.vercel.app", tenantId: "sunrise-demo-two", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H" };
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c) }, domains: [{ name: "sunrise-demo-two.vercel.app", verified: true }, { name: "sunrise-demo.vercel.app", verified: true }] });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  assert.equal(s.host, "sunrise-demo.vercel.app");
  const env = w.calls.find((x) => x.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.equal(env.find((e) => e.key === "TENANT_ID").value, "sunrise-demo", "TENANT_ID follows the canonical host, not the stale file value");
  assert.ok(w.calls.some((x) => x.kind === "log" && /host changed: sunrise-demo-two\.vercel\.app → sunrise-demo\.vercel\.app/.test(x.line)));
  assert.equal(w.readClient().generated.host, "sunrise-demo.vercel.app");
});

test("a recorded project this token cannot see: adopt by NAME if the account has it (a Vercel transfer), otherwise STOP — never a silent second project", async () => {
  const c = client(); c.generated = { projectId: "prj_transferred", orgId: "team_owner", host: "old.vercel.app" };
  const transferred = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c) } });
  const s = await runGoLive(opts({ skipSeed: true }), transferred.deps);
  assert.ok(transferred.calls.some((x) => x.path === "/v9/projects/prj_transferred"), "the recorded id is tried first");
  assert.equal(s.projectId, "prj_123", "then the same-named project in this account is adopted (path A after a transfer)");
  assert.ok(!transferred.calls.some((x) => x.path === "/v11/projects"));
  const gone = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(c) } });
  await assert.rejects(runGoLive(opts({ skipSeed: true }), gone.deps), (e) => e instanceof GoLiveError && e.step === "project" && /not reachable with this token/.test(e.message) && /Move hosting/.test(e.hint));
  assert.ok(!gone.calls.some((x) => x.path === "/v11/projects"), "no project is created behind the owner's back");
});

test("after 'Move hosting' path B, a token that still reaches the OLD account stops the run instead of re-adopting the detached project", async () => {
  const c = client(); c.generated = { authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z", previousHosting: [{ projectId: "prj_123", host: "sunrise-demo-x7k2.vercel.app", detachedAt: "2026-09-12T01:00:00.000Z" }] };
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c) } });
  await assert.rejects(runGoLive(opts({ skipSeed: true }), w.deps), (e) => e instanceof GoLiveError && e.step === "project" && /DETACHED/.test(e.message) && /NEW Vercel account/.test(e.hint));
  assert.ok(!w.calls.some((x) => x.path === "/v11/projects") && !w.calls.some((x) => x.path?.startsWith("/v10/projects/prj_123/env")), "nothing written to the old project");
  const fresh = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(c) } }); // the new account: no such project → created
  const s = await runGoLive(opts({ skipSeed: true }), fresh.deps);
  assert.ok(fresh.calls.some((x) => x.path === "/v11/projects"), "with the NEW account's token a fresh project is created");
  assert.equal(s.projectId, "prj_123");
});

test("deployLock in the file stops the CLI too (guard, before any spawn or API call); a dry run is still allowed", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client({ deployLock: true })) } });
  await assert.rejects(runGoLive(opts(), w.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /locked/.test(e.message));
  assert.equal(w.calls.filter((c) => c.kind === "spawn" || c.kind === "fetch").length, 0);
  const dry = await runGoLive(opts({ dryRun: true }), w.deps); assert.equal(dry.dryRun, true);
});

test("a client file that disappears mid-run (archived/deleted) is never re-created as a credentials stub", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  const orig = w.deps.fs.writeFileSync; let writes = 0;
  w.deps.fs.writeFileSync = (p, d) => { orig(p, d); if (p === CLIENT_PATH && ++writes === 1) w.store.delete(CLIENT_PATH); };
  await assert.rejects(runGoLive(opts(), w.deps), (e) => e instanceof GoLiveError && e.step === "save" && /disappeared/.test(e.message));
  assert.equal(w.store.has(CLIENT_PATH), false, "no stub file was written");
});

test("runResetDemo: three guards, then ONLY the reset script runs (with the database name it must echo back) — Vercel is never touched", async () => {
  const notDemo = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  await assert.rejects(runResetDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos" }, notDemo.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /not marked as a demo/.test(e.message));
  const demo = client({ demo: true, generated: { projectId: "prj_123", host: "sunrise-demo-x7k2.vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" } });
  const wrong = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(demo) } });
  await assert.rejects(runResetDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "typo", confirmDb: "pos" }, wrong.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /does not equal/.test(e.message));
  await assert.rejects(runResetDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos_other" }, wrong.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /confirmed database "pos_other" is not the one/.test(e.message), "the database the owner was shown must be the one the file points at NOW");
  await assert.rejects(runResetDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo" }, wrong.deps), (e) => e instanceof GoLiveError && e.step === "guard", "no confirmDb → refused");
  assert.equal(wrong.calls.filter((c) => c.kind === "spawn").length, 0, "nothing ran");
  const broken = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify({ ...demo, admin: { username: "admin", password: "weak" } }) } });
  await assert.rejects(runResetDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos" }, broken.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /seeder would fail after the drop/.test(e.message), "a file the seeder would reject is refused BEFORE the drop");
  assert.equal(broken.calls.filter((c) => c.kind === "spawn").length, 0);
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(demo) } });
  const s = await runResetDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos" }, w.deps);
  const spawns = w.calls.filter((c) => c.kind === "spawn");
  assert.equal(spawns.length, 1); assert.equal(spawns[0].cmd, process.execPath); assert.deepEqual(spawns[0].args.slice(0, 2), ["--import", "tsx"]); assert.match(spawns[0].args[2], /reset-demo-db\.ts$/); assert.deepEqual(spawns[0].args.slice(3), ["--file", CLIENT_PATH]);
  assert.equal(spawns[0].env.RESET_CONFIRM_DB, "pos"); assert.equal(spawns[0].env.RESET_CONFIRM_SLUG, "sunrise-demo"); assert.equal(spawns[0].env.MONGODB_URI, demo.mongodbUri);
  assert.equal(w.calls.filter((c) => c.kind === "fetch").length, 0, "no Vercel calls");
  assert.deepEqual(s, { slug: "sunrise-demo", dbName: "pos", host: "sunrise-demo-x7k2.vercel.app", adminUsername: "admin" });
  const saved = w.readClient(); assert.notEqual(saved.generated.seededAt, "2026-09-12T00:00:00.000Z", "seed date refreshed"); assert.equal(saved.generated.projectId, "prj_123", "hosting untouched");
  const failing = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(demo) } }); failing.deps.spawn = () => ({ status: 1 });
  await assert.rejects(runResetDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos" }, failing.deps), (e) => e instanceof GoLiveError && e.step === "reset" && /may already be dropped/.test(e.message));
});

test("runSeedDemo: same three guards as runResetDemo, plus an imagesDir existence guard, then ONLY the seed-demo script runs with RESET_CONFIRM_* — Vercel is never touched", async () => {
  const notDemo = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  await assert.rejects(runSeedDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos", imagesDir: null }, notDemo.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /not marked as a demo/.test(e.message));
  const demo = client({ demo: true, generated: { projectId: "prj_123", host: "sunrise-demo-x7k2.vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" } });
  const wrong = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(demo) } });
  await assert.rejects(runSeedDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "typo", confirmDb: "pos", imagesDir: null }, wrong.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /does not equal/.test(e.message));
  await assert.rejects(runSeedDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos_other", imagesDir: null }, wrong.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /confirmed database "pos_other" is not the one/.test(e.message), "the database the owner was shown must be the one the file points at NOW");
  await assert.rejects(runSeedDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", imagesDir: null }, wrong.deps), (e) => e instanceof GoLiveError && e.step === "guard", "no confirmDb → refused");
  assert.equal(wrong.calls.filter((c) => c.kind === "spawn").length, 0, "nothing ran");
  const broken = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify({ ...demo, admin: { username: "admin", password: "weak" } }) } });
  await assert.rejects(runSeedDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos", imagesDir: null }, broken.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /seeder would fail after the drop/.test(e.message), "a file the seeder would reject is refused BEFORE the drop");
  assert.equal(broken.calls.filter((c) => c.kind === "spawn").length, 0);
  // The images-folder guard: checked AFTER the other four guards, BEFORE any spawn — a typo'd path fails before the drop, not after.
  const noImages = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(demo) } });
  await assert.rejects(runSeedDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos", imagesDir: "C:\\nope\\photos" }, noImages.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /images folder does not exist on this PC/.test(e.message) && /C:\\nope\\photos/.test(e.message));
  assert.equal(noImages.calls.filter((c) => c.kind === "spawn").length, 0, "the images guard fires before any spawn — the database is never touched");

  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(demo) } });
  w.deps.fs.existsSync = ((orig) => (p) => p === "C:\\photos\\demo" ? true : orig(p))(w.deps.fs.existsSync);
  const s = await runSeedDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos", imagesDir: "C:\\photos\\demo" }, w.deps);
  const spawns = w.calls.filter((c) => c.kind === "spawn");
  assert.equal(spawns.length, 1, "ONE spawn — seed-demo/index.ts, never the plain seed-client or reset-demo scripts");
  assert.equal(spawns[0].cmd, process.execPath);
  assert.deepEqual(spawns[0].args.slice(0, 2), ["--import", "tsx"]);
  assert.match(spawns[0].args[2], /seed-demo[\\/]index\.ts$/, "the seed-demo package entry, not seed-client.ts or reset-demo-db.ts");
  assert.deepEqual(spawns[0].args.slice(3), ["--file", CLIENT_PATH]);
  assert.equal(spawns[0].cwd, path.join(ROOT, "apps", "cafe"));
  assert.equal(spawns[0].env.RESET_CONFIRM_DB, "pos"); assert.equal(spawns[0].env.RESET_CONFIRM_SLUG, "sunrise-demo");
  assert.equal(spawns[0].env.MONGODB_URI, demo.mongodbUri);
  assert.equal(spawns[0].env.SEED_ADMIN_USERNAME, demo.admin.username); assert.equal(spawns[0].env.SEED_ADMIN_PASSWORD, demo.admin.password);
  assert.equal(spawns[0].env.DEMO_IMAGES_DIR, "C:\\photos\\demo");
  assert.equal("R2_ACCOUNT_ID" in spawns[0].env, false, "image is null on this client → no R2 env vars carried");
  assert.equal(w.calls.filter((c) => c.kind === "fetch").length, 0, "no Vercel calls — same as reset-demo");
  assert.deepEqual(s, { slug: "sunrise-demo", dbName: "pos", host: "sunrise-demo-x7k2.vercel.app", adminUsername: "admin", imagesDir: "C:\\photos\\demo" });
  const saved = w.readClient();
  assert.notEqual(saved.generated.seededAt, "2026-09-12T00:00:00.000Z", "seed date refreshed");
  assert.equal(saved.generated.demoSeededAt, saved.generated.seededAt, "demoSeededAt is recorded alongside seededAt");
  assert.equal(saved.generated.demoImagesDir, "C:\\photos\\demo");
  assert.equal(saved.generated.projectId, "prj_123", "hosting untouched — no Vercel project/env write happens for a seed-demo run");

  const failing = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(demo) } }); failing.deps.spawn = () => ({ status: 1 });
  await assert.rejects(runSeedDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos", imagesDir: null }, failing.deps), (e) => e instanceof GoLiveError && e.step === "seed-demo" && /may be dropped and only partly built/.test(e.message));
});

test("runSeedDemo: imagesDir omitted/null never triggers the existence guard (photos skipped is a valid, guard-free path), and an r2 image store on the client file is forwarded as R2_* env vars to the child", async () => {
  const demoNoImages = client({ demo: true, image: null, generated: { projectId: "prj_123", host: "sunrise-demo-x7k2.vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" } });
  const w1 = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(demoNoImages) } });
  const s1 = await runSeedDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos" }, w1.deps); // imagesDir omitted entirely
  assert.equal(s1.imagesDir, null);
  assert.equal(w1.calls.find((c) => c.kind === "spawn").env.DEMO_IMAGES_DIR, undefined, "no DEMO_IMAGES_DIR env var when no folder was given");
  assert.equal(w1.readClient().generated.demoImagesDir, null);

  const demoWithR2 = client({
    demo: true,
    image: { store: "r2", accountId: "acc123", accessKeyId: "keyid", secretAccessKey: "SECRET_KEY_VALUE", bucket: "demo-bucket", publicBaseUrl: "https://pub.r2.dev" },
    generated: { projectId: "prj_123", host: "sunrise-demo-x7k2.vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" },
  });
  const w2 = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(demoWithR2) } });
  await runSeedDemo({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmDb: "pos", imagesDir: null }, w2.deps);
  const env2 = w2.calls.find((c) => c.kind === "spawn").env;
  assert.equal(env2.R2_ACCOUNT_ID, "acc123"); assert.equal(env2.R2_ACCESS_KEY_ID, "keyid"); assert.equal(env2.R2_SECRET_ACCESS_KEY, "SECRET_KEY_VALUE");
  assert.equal(env2.R2_BUCKET, "demo-bucket"); assert.equal(env2.NEXT_PUBLIC_R2_PUBLIC_BASE_URL, "https://pub.r2.dev");
  assert.ok(!w2.calls.some((c) => c.kind === "log" && /SECRET_KEY_VALUE|acc123/.test(c.line)), "the R2 secret/account id is never logged");
});

test("a STANDBY host: same database/images/secrets, the standby's own token, its own project + URL + profile, no seed, web address left on the primary; the primary record is untouched; a standby run never attaches an address even when the primary carries one and a platform is configured", async () => {
  const primaryDone = client({ subdomain: "cafe", generated: { projectId: "prj_primary", orgId: "team_owner", host: "cafe.sandbee.in", tenantId: "cafe", rootDomain: "sandbee.in", authSecret: "SHARED_AUTH", healthStatsToken: "SHARED_HS", seededAt: "2026-09-12T00:00:00.000Z", webAddress: { host: "cafe.sandbee.in", state: "live" } }, standbyHosts: [{ label: "standby", vercel: { token: "tok_standby_account", project: null, teamId: null } }] });
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(primaryDone), [PLATFORM_PATH]: platformFile() } });
  const s = await runGoLive(opts({ host: "standby" }), w.deps);
  const fetches = w.calls.filter((c) => c.kind === "fetch" && c.path.startsWith("/v"));
  assert.ok(fetches.length > 0 && fetches.every((c) => c.auth === "Bearer tok_standby_account"), "every Vercel call uses the STANDBY account's token");
  assert.ok(!w.calls.some((c) => c.kind === "spawn" && !isDeploy(c.args)), "no seeding — the database is shared");
  const create = w.calls.find((c) => c.path === "/v11/projects"); assert.equal(create.body.name, "sunrise-demo-standby", "default standby project name");
  assert.ok(!w.calls.some((c) => c.path === "/v10/projects/prj_123/domains"), "the web address is NOT attached to the standby");
  const env = Object.fromEntries(w.calls.find((c) => c.path?.startsWith("/v10/projects/prj_123/env")).body.map((e) => [e.key, e.value]));
  assert.equal(env.MONGODB_URI, primaryDone.mongodbUri); assert.equal(env.AUTH_SECRET, "SHARED_AUTH", "secrets are SHARED so a login works on both hosts"); assert.equal(env.HEALTH_STATS_TOKEN, "SHARED_HS");
  assert.equal(env.TENANT_ID, "sunrise-demo-standby-x7k2"); assert.equal(env.ROOT_DOMAIN, "vercel.app", "the standby serves on its own *.vercel.app");
  const deploy = w.calls.find((c) => c.kind === "spawn" && isDeploy(c.args)); assert.deepEqual(deploy.args.slice(1), ["--profile", "sunrise-demo-standby"]);
  const profiles = w.readProfiles(); assert.equal(profiles["sunrise-demo-standby"].token, "tok_standby_account"); assert.equal("sunrise-demo" in profiles, false, "the primary's profile is not touched by a standby run");
  const saved = w.readClient();
  assert.equal(saved.generated.projectId, "prj_primary", "primary hosting untouched"); assert.equal(saved.generated.host, "cafe.sandbee.in"); assert.equal(saved.generated.authSecret, "SHARED_AUTH");
  assert.equal(saved.generated.webAddress.host, "cafe.sandbee.in", "the primary's recorded web address is untouched by a standby run");
  assert.equal(saved.standbyHosts[0].generated.projectId, "prj_123"); assert.equal(saved.standbyHosts[0].generated.host, "sunrise-demo-standby-x7k2.vercel.app"); assert.equal(saved.standbyHosts[0].vercel.token, "tok_standby_account");
  assert.equal(s.hostLabel, "standby"); assert.equal(s.url, "https://sunrise-demo-standby-x7k2.vercel.app"); assert.equal(s.redeploy, "npm run deploy -- --profile sunrise-demo-standby"); assert.equal(s.health.ok, true);
  await assert.rejects(runGoLive(opts({ host: "nope" }), w.deps), (e) => e instanceof GoLiveError && e.step === "read" && /no standby host "nope"/.test(e.message));
  const dry = await runGoLive(opts({ host: "standby", dryRun: true }), w.deps); assert.deepEqual(dry.steps, ["project", "env", "profile", "deploy", "health"]);
});

test("a standby needs a seeded primary and a unique '<slug>-<label>' name — both refused as guards before anything runs", async () => {
  const unseeded = client({ generated: { projectId: "prj_p", authSecret: "A", healthStatsToken: "H" }, standbyHosts: [{ label: "standby", vercel: { token: "tok_sb" } }] });
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(unseeded) } });
  await assert.rejects(runGoLive(opts({ host: "standby" }), w.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /never been seeded/.test(e.message));
  const seeded = { ...unseeded, generated: { ...unseeded.generated, seededAt: "2026-09-12T00:00:00.000Z" } };
  const clash = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(seeded), "/repo/clients/sunrise-demo-standby.json": JSON.stringify(client({ slug: "sunrise-demo-standby" })) } });
  await assert.rejects(runGoLive(opts({ host: "standby" }), clash.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /another client's slug/.test(e.message));
  assert.equal(w.calls.filter((c) => c.kind === "fetch").length + clash.calls.filter((c) => c.kind === "fetch").length, 0, "no Vercel call in either case");
});

test("a standby whose token still reaches the PRIMARY's account (the primary token pasted by mistake) is stopped before any project is created", async () => {
  const c = client({ generated: { projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-x7k2.vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" }, standbyHosts: [{ label: "standby", vercel: { token: "tok_secret", project: null, teamId: null } }] });
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(c) } }); // this fake account CAN see prj_123
  await assert.rejects(runGoLive(opts({ host: "standby" }), w.deps), (e) => e instanceof GoLiveError && e.step === "guard" && /reaches the PRIMARY's account/.test(e.message));
  assert.ok(!w.calls.some((x) => x.path === "/v11/projects") && !w.calls.some((x) => x.kind === "spawn"), "nothing created, nothing deployed");
});

test("a team token: every API call carries teamId and the deploy profile gets the scope", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client({ vercel: { token: "tok_secret", project: null, teamId: "team_slug" } })) } });
  await runGoLive(opts(), w.deps);
  const apiCalls = w.calls.filter((c) => c.kind === "fetch" && c.path.startsWith("/v"));
  assert.ok(apiCalls.length > 0 && apiCalls.every((c) => c.path.includes("teamId=team_slug")), "teamId on every Vercel call");
  assert.equal(w.readProfiles()["sunrise-demo"].scope, "team_slug");
});

// ── Fresh start on Vercel (plan-admin-fresh.md §A) ──────────────────────────
// scripts/go-live/fresh-start.mjs landed mid-round (measured just now by
// importing it, not assumed) — these pin its A.2 contract. A dedicated fake
// Vercel world models exactly the call sequence (GET project → GET domains →
// DELETE → poll GET until 404 → runGoLive's own create-or-adopt path),
// independent of the happy-path fakeWorld above so neither fixture constrains
// the other's evolution.
{
  const { runFreshStart } = await import("./fresh-start.mjs");

  /** A fake Vercel account whose one project ("prj_123", name "sunrise-demo")
   *  can be deleted; after DELETE it 404s until `deleteVisibleAfterPolls` more
   *  GETs have happened (simulating Vercel's own eventual-consistency), then a
   *  POST /v11/projects recreates it as "prj_456". Domains: sunrise-demo's are
   *  listed once before the delete; the health/env/deploy tail re-uses the
   *  same shape run.test.mjs's fakeWorld already pins, kept minimal here since
   *  runFreshStart delegates the create-and-deploy half to runGoLive itself. */
  function freshWorld({ deleteVisibleAfterPolls = 0, existingDomains = [{ name: "sunrise-demo-x7k2.vercel.app" }, { name: "sunrise-demo.sandbee.in" }], deleteStatus = 204 } = {}) {
    const calls = [];
    let projectId = "prj_123";
    let projectGone = false;
    let pollsSinceDelete = 0;
    let created = false;
    const store = new Map(Object.entries({ [CLIENT_PATH]: null, [PLATFORM_PATH]: platformFile() }));
    const norm = (p) => String(p).replace(/\\/g, "/");
    const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
    const sleeps = [];

    const fetch = async (url, init = {}) => {
      const u = new URL(url);
      const method = init.method ?? "GET";
      calls.push({ kind: "fetch", method, path: u.pathname });
      if (u.hostname !== "api.vercel.com") return json(200, { ok: true, db: "up", tenant: store.get("TENANT_ID") ?? "dev" });
      if (u.pathname === "/v2/user") return json(200, { user: { id: "team_owner", username: "sandbee", email: "o@x.in" } });
      if (method === "GET" && u.pathname === "/v9/projects/prj_123") {
        if (projectGone) { pollsSinceDelete += 1; return pollsSinceDelete > deleteVisibleAfterPolls ? json(404, { error: { code: "not_found" } }) : json(200, { id: projectId, name: "sunrise-demo", accountId: "team_owner" }); }
        return json(200, { id: projectId, name: "sunrise-demo", accountId: "team_owner" });
      }
      if (method === "GET" && u.pathname === "/v9/projects/sunrise-demo") return created ? json(200, { id: "prj_456", name: "sunrise-demo", accountId: "team_owner" }) : json(404, { error: { code: "not_found" } });
      if (method === "GET" && u.pathname === "/v9/projects/prj_456") return created ? json(200, { id: "prj_456", name: "sunrise-demo", accountId: "team_owner" }) : json(404, { error: { code: "not_found" } });
      if (method === "GET" && u.pathname === "/v9/projects/prj_123/domains") return json(200, { domains: existingDomains });
      if (method === "DELETE" && u.pathname === "/v9/projects/prj_123") { projectGone = true; return { status: deleteStatus, ok: deleteStatus >= 200 && deleteStatus < 300, json: async () => { throw new Error("204 has no body — must not be parsed"); } }; }
      if (method === "POST" && u.pathname === "/v11/projects") { created = true; return json(200, { id: "prj_456", name: "sunrise-demo", accountId: "team_owner" }); }
      if (method === "GET" && u.pathname === "/v9/projects/prj_456/domains") return json(200, { domains: [{ name: "sunrise-demo-new1.vercel.app", verified: true }] });
      if (method === "POST" && u.pathname === "/v10/projects/prj_456/env") return json(201, { created: [], failed: [] });
      return json(500, { error: { code: "unrouted", message: u.pathname } });
    };
    const spawn = (cmd, args, opts_) => { calls.push({ kind: "spawn", args }); return { status: 0 }; };
    const deps = {
      fs: {
        existsSync: (p) => store.has(norm(p)) && store.get(norm(p)) !== null,
        readFileSync: (p) => { const k = norm(p); if (!store.has(k) || store.get(k) === null) throw new Error("ENOENT " + p); return store.get(k); },
        writeFileSync: (p, data) => { calls.push({ kind: "write", path: norm(p) }); store.set(norm(p), data); },
        readdirSync: (dir) => { const prefix = `${norm(dir)}/`; const names = new Set(); for (const k of store.keys()) if (k.startsWith(prefix) && store.get(k) !== null && !k.slice(prefix.length).includes("/")) names.add(k.slice(prefix.length)); return [...names]; },
      },
      spawn, fetch, randomBytes: (n) => Buffer.alloc(n, 7),
      sleep: async (ms) => { sleeps.push(ms); },
      log: (line) => calls.push({ kind: "log", line }),
      env: { PATH: "x" },
      dnsCheck: { checkRecords: async () => ({ cname: { found: null, ok: false }, txt: { found: [], ok: null } }), probeHealth: async () => ({ status: null, body: null, error: "n/a" }) },
    };
    return { deps, calls, sleeps, store, norm, readClient: () => JSON.parse(store.get(norm(CLIENT_PATH))) };
  }

  const freshClient = (overrides = {}) => ({
    slug: "sunrise-demo", vercel: { token: "tok_secret", project: null, teamId: null }, subdomain: null,
    mongodbUri: "mongodb+srv://u:p@c.mongodb.net/pos?retryWrites=true", admin: { username: "Admin", password: "Strong-Pass-1!" },
    cafe: { name: "Sunrise Café" }, tables: 8, menu: null, image: null,
    generated: { projectId: "prj_123", orgId: "team_owner", projectName: "sunrise-demo", host: "sunrise-demo-x7k2.vercel.app", tenantId: "sunrise-demo", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" },
    ...overrides,
  });

  test("guards run BEFORE any delete: deployLock, no recorded project, wrong slug confirmation, wrong project-name confirmation — none of them call DELETE", async () => {
    const base = freshClient();
    for (const [label, overrides, confirm, confirmProject, matcher] of [
      ["deployLock", { deployLock: true }, "sunrise-demo", "sunrise-demo", /locked/],
      ["no project yet", { generated: { authSecret: "A", healthStatsToken: "H" } }, "sunrise-demo", "sunrise-demo", /no Vercel project yet/],
      ["wrong slug", {}, "wrong-slug", "sunrise-demo", /does not equal the client's slug/],
      ["wrong project name", {}, "sunrise-demo", "wrong-name", /does not equal the recorded project/],
    ]) {
      const w = freshWorld();
      w.store.set(w.norm(CLIENT_PATH), JSON.stringify({ ...base, ...overrides }));
      await assert.rejects(
        runFreshStart({ root: ROOT, clientPath: CLIENT_PATH, confirm, confirmProject }, w.deps),
        (e) => e instanceof GoLiveError && e.step === "guard" && matcher.test(e.message),
        `${label} must be refused as a guard`,
      );
      assert.ok(!w.calls.some((c) => c.kind === "fetch" && c.method === "DELETE"), `${label}: DELETE must never be called`);
    }
  });

  test("order pin: GET project → GET domains → DELETE → poll GET until 404 → (create-or-adopt) POST /v11/projects → env → deploy", async () => {
    const w = freshWorld({ deleteVisibleAfterPolls: 2 });
    w.store.set(w.norm(CLIENT_PATH), JSON.stringify(freshClient()));
    const s = await runFreshStart({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmProject: "sunrise-demo" }, w.deps);
    const seq = w.calls.filter((c) => c.kind === "fetch" || c.kind === "spawn").map((c) => (c.kind === "spawn" ? "spawn" : `${c.method} ${c.path}`));
    const firstDelete = seq.indexOf("DELETE /v9/projects/prj_123");
    assert.ok(firstDelete > 0, "a DELETE call happened");
    assert.deepEqual(seq.slice(0, firstDelete).filter((s_) => s_.startsWith("GET")), ["GET /v2/user", "GET /v9/projects/prj_123", "GET /v9/projects/prj_123/domains"], "GET project then GET domains, in that order, before DELETE");
    const afterDelete = seq.slice(firstDelete + 1);
    // Every call between the DELETE and the eventual create is a poll of the SAME
    // project id, or runGoLive's own re-entry (account check, then its create-or-adopt
    // name lookup) — never a second creation attempt or an unrelated call.
    const createIdx = afterDelete.indexOf("POST /v11/projects");
    assert.ok(createIdx > 0, "a create call follows the deletion");
    const allowedBeforeCreate = new Set(["GET /v9/projects/prj_123", "GET /v2/user", "GET /v9/projects/sunrise-demo"]);
    assert.ok(afterDelete.slice(0, createIdx).every((s_) => allowedBeforeCreate.has(s_)), `only polls / runGoLive's own account+lookup calls sit between DELETE and create, got: ${JSON.stringify(afterDelete.slice(0, createIdx))}`);
    assert.ok(afterDelete.slice(createIdx).some((s_) => s_ === "spawn"), "a deploy still happens after the new project exists");
    assert.equal(s.freshStart, true);
    assert.equal(s.deletedProject.id, "prj_123");
    assert.deepEqual(s.deletedProject.domains.sort(), ["sunrise-demo-x7k2.vercel.app", "sunrise-demo.sandbee.in"].sort());
  });

  test("previousHosting gains the deleted project's record; secrets + seededAt survive; the new project id is what's recorded after", async () => {
    const w = freshWorld({ deleteVisibleAfterPolls: 0 });
    w.store.set(w.norm(CLIENT_PATH), JSON.stringify(freshClient()));
    await runFreshStart({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmProject: "sunrise-demo" }, w.deps);
    const saved = w.readClient();
    assert.equal(saved.generated.authSecret, "A", "secrets are kept, never re-minted");
    assert.equal(saved.generated.healthStatsToken, "H");
    assert.equal(saved.generated.seededAt, "2026-09-12T00:00:00.000Z", "seededAt survives — the database is untouched by a fresh start");
    assert.ok(Array.isArray(saved.generated.previousHosting) && saved.generated.previousHosting.length === 1, "the deleted project is recorded under previousHosting");
    const prev = saved.generated.previousHosting[0];
    assert.equal(prev.projectId, "prj_123");
    assert.equal(prev.projectName, "sunrise-demo");
    assert.equal(prev.host, "sunrise-demo-x7k2.vercel.app");
    assert.ok(typeof prev.deletedAt === "string" && prev.deletedAt.length > 0);
    assert.equal(saved.generated.projectId, "prj_456", "the run recreated the project and recorded the NEW id");
  });

  test("deploy.profiles.json is rewritten under the new project id (the old profile entry is replaced, not merged)", async () => {
    const w = freshWorld({ deleteVisibleAfterPolls: 0 });
    w.store.set(w.norm(CLIENT_PATH), JSON.stringify(freshClient()));
    w.store.set(w.norm(PROFILES_PATH), JSON.stringify({ "sunrise-demo": { app: "apps/cafe", orgId: "team_owner", projectId: "prj_123", scope: null, tokenEnv: null, token: "tok_secret" } }));
    await runFreshStart({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmProject: "sunrise-demo" }, w.deps);
    const profiles = JSON.parse(w.store.get(w.norm(PROFILES_PATH)));
    assert.equal(profiles["sunrise-demo"].projectId, "prj_456", "the rewritten profile points at the NEW project, never the deleted one");
  });

  test("the poll gives up after DELETE_WAIT_ATTEMPTS and reports a 'clean' step error instead of creating a second project", async () => {
    const w = freshWorld({ deleteVisibleAfterPolls: 999 }); // never actually clears
    w.store.set(w.norm(CLIENT_PATH), JSON.stringify(freshClient()));
    await assert.rejects(
      runFreshStart({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmProject: "sunrise-demo" }, w.deps),
      (e) => e instanceof GoLiveError && e.step === "clean" && /still lists the project/.test(e.message),
    );
    assert.ok(!w.calls.some((c) => c.kind === "fetch" && c.method === "POST" && c.path === "/v11/projects"), "never creates a second project while the old one is still visible");
    assert.ok(w.sleeps.length > 0, "the poll actually waits between attempts (deps.sleep used, not a busy loop)");
  });

  test("post-getProject guard: Vercel's project name disagrees with the recorded name → GoLiveError step guard naming BOTH names, no DELETE call (a mis-copied project id must never be deleted on the file's word alone)", async () => {
    const w = freshWorld();
    // The fake's GET /v9/projects/prj_123 always answers "sunrise-demo" — record a DIFFERENT name so the two disagree.
    w.store.set(w.norm(CLIENT_PATH), JSON.stringify(freshClient({ generated: { ...freshClient().generated, projectName: "totally-different-name" } })));
    await assert.rejects(
      runFreshStart({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmProject: "totally-different-name" }, w.deps),
      (e) => e instanceof GoLiveError && e.step === "guard" && /"sunrise-demo"/.test(e.message) && /"totally-different-name"/.test(e.message) && /nothing was deleted/.test(e.message),
    );
    assert.ok(!w.calls.some((c) => c.kind === "fetch" && c.method === "DELETE"), "no DELETE call when the live project's name disagrees with the record");
  });

  test("rollout guards run BEFORE the Vercel API is even created: a LIVE rollout lock refuses with 'a rollout is running', an unfinished rollout state (no live lock) refuses with 'a rollout is unfinished' — neither calls Vercel at all", async () => {
    const liveLock = freshWorld();
    liveLock.store.set(liveLock.norm(CLIENT_PATH), JSON.stringify(freshClient()));
    liveLock.store.set(liveLock.norm("/repo/clients/_rollout.lock"), JSON.stringify({ owner: "cli", pid: 424242, at: "2026-09-13T00:00:00.000Z" }));
    liveLock.deps.isAlive = () => true;
    await assert.rejects(
      runFreshStart({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmProject: "sunrise-demo" }, liveLock.deps),
      (e) => e instanceof GoLiveError && e.step === "guard" && /a rollout is running/.test(e.message),
    );
    assert.equal(liveLock.calls.filter((c) => c.kind === "fetch").length, 0, "not even GET /v2/user — the rollout guard runs before the Vercel API is created");

    const unfinished = freshWorld();
    unfinished.store.set(unfinished.norm(CLIENT_PATH), JSON.stringify(freshClient()));
    unfinished.store.set(unfinished.norm("/repo/clients/_rollout.json"), JSON.stringify({ id: "1", label: "code update", startedAt: "2026-09-13T00:00:00.000Z", finishedAt: null, cancelRequested: false, targets: [{ name: "sunrise-demo", host: "primary", profile: "sunrise-demo", url: null, status: "pending" }] }));
    // No lock file at all here — pidAlive is irrelevant; the unfinished-state guard alone must fire.
    await assert.rejects(
      runFreshStart({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmProject: "sunrise-demo" }, unfinished.deps),
      (e) => e instanceof GoLiveError && e.step === "guard" && /a rollout is unfinished/.test(e.message),
    );
    assert.equal(unfinished.calls.filter((c) => c.kind === "fetch").length, 0, "no Vercel call for an unfinished rollout either");

    // Sanity: a DEAD lock (pid not alive) is not a live rollout — it must not block on its own.
    const deadLock = freshWorld();
    deadLock.store.set(deadLock.norm(CLIENT_PATH), JSON.stringify(freshClient()));
    deadLock.store.set(deadLock.norm("/repo/clients/_rollout.lock"), JSON.stringify({ owner: "cli", pid: 999999, at: "2026-09-13T00:00:00.000Z" }));
    deadLock.deps.isAlive = () => false;
    const s = await runFreshStart({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmProject: "sunrise-demo" }, deadLock.deps);
    assert.equal(s.freshStart, true, "a stale (dead-pid) lock never blocks a fresh start");
  });

  test("the delete-confirmation poll TOLERATES a thrown getProject (a transient API error is not read as 'still there') — logs once, keeps polling, and still confirms the delete", async () => {
    const w = freshWorld({ deleteVisibleAfterPolls: 1 });
    w.store.set(w.norm(CLIENT_PATH), JSON.stringify(freshClient()));
    const realFetch = w.deps.fetch;
    let deleted = false;
    let pollGetsSinceDelete = 0;
    w.deps.fetch = async (url, init) => {
      const u = new URL(url);
      const method = init?.method ?? "GET";
      if (method === "DELETE" && u.pathname === "/v9/projects/prj_123") deleted = true;
      // Only the FIRST poll (a GET after the delete) throws — the pre-delete guard's
      // own getProject call must be unaffected, or this test would pin the wrong call.
      if (deleted && method === "GET" && u.pathname === "/v9/projects/prj_123") {
        pollGetsSinceDelete += 1;
        if (pollGetsSinceDelete === 1) throw new Error("ECONNRESET");
      }
      return realFetch(url, init);
    };
    const s = await runFreshStart({ root: ROOT, clientPath: CLIENT_PATH, confirm: "sunrise-demo", confirmProject: "sunrise-demo" }, w.deps);
    assert.equal(s.freshStart, true, "the run still completed — a transient poll error never aborts the wait");
    const waitingLogs = w.calls.filter((c) => c.kind === "log" && /waiting for Vercel to confirm the delete/.test(c.line));
    assert.equal(waitingLogs.length, 1, "logged exactly once, not once per retry");
    assert.match(waitingLogs[0].line, /ECONNRESET/, "the transient error's own message is included");
  });
}

test("vercel-api: getProject and deleteProject treat HTTP 410 (Vercel's 'gone') exactly like 404 — null / { gone: true }, never a thrown error", async () => {
  const { createVercelApi } = await import("./vercel-api.mjs");
  const fetch410 = async (url, init) => {
    const method = init?.method ?? "GET";
    return { status: 410, ok: false, json: async () => ({ error: { code: "not_found", message: "The project was deleted." } }) };
  };
  const api = createVercelApi({ token: "tok_x", fetch: fetch410 });
  assert.equal(await api.getProject("prj_gone"), null, "410 reads as null, same as 404");
  assert.deepEqual(await api.deleteProject("prj_gone"), { gone: true }, "410 on delete is treated as already-gone, not an error");
});

test("vercel-api: getProject/createProject expose hasProduction — true when targets.production is set, false when targets is present but empty, null when the targets field is absent entirely", async () => {
  const { createVercelApi } = await import("./vercel-api.mjs");
  const respond = (body) => async () => ({ status: 200, ok: true, json: async () => body });

  const withProd = createVercelApi({ token: "t", fetch: respond({ id: "p", name: "n", accountId: "a", targets: { production: { id: "dpl_1" } } }) });
  assert.equal((await withProd.getProject("p")).hasProduction, true);
  assert.equal((await withProd.createProject("n", { framework: "nextjs", rootDirectory: "apps/cafe" })).hasProduction, true);

  const emptyTargets = createVercelApi({ token: "t", fetch: respond({ id: "p", name: "n", accountId: "a", targets: {} }) });
  assert.equal((await emptyTargets.getProject("p")).hasProduction, false, "targets present but production is absent/falsy → false, a brand-new/never-deployed project");
  assert.equal((await emptyTargets.createProject("n", { framework: "nextjs", rootDirectory: "apps/cafe" })).hasProduction, false);

  const explicitNullProd = createVercelApi({ token: "t", fetch: respond({ id: "p", name: "n", accountId: "a", targets: { production: null } }) });
  assert.equal((await explicitNullProd.getProject("p")).hasProduction, false, "targets.production explicitly null (Vercel's own null-target shape) → false, not true");

  const noTargetsField = createVercelApi({ token: "t", fetch: respond({ id: "p", name: "n", accountId: "a" }) });
  assert.equal((await noTargetsField.getProject("p")).hasProduction, null, "no `targets` key at all → null (unknown), never coerced to false");
  assert.equal((await noTargetsField.createProject("n", { framework: "nextjs", rootDirectory: "apps/cafe" })).hasProduction, null);
});

test("CLI: --fresh-start together with --host is a usage error (exit 2) — a fresh start is primary hosting only, never wired to a standby slot", () => {
  const res = spawnSync(process.execPath, [INDEX_MJS, "nosuch", "--fresh-start", "--confirm", "x", "--confirm-project", "y", "--host", "standby"], { encoding: "utf8" });
  assert.equal(res.status, 2, `expected exit 2, got ${res.status}; stderr:\n${res.stderr}`);
  assert.match(res.stderr, /primary hosting only/);
});

// ── Realtime (plan §5, run.mjs additions) ───────────────────────────────────
test("dry run: the \"realtime\" step appears right before \"env\" ONLY for a primary with a cloudflare block; absent when the block is null, absent for a standby even if the primary carries a block", async () => {
  const withBlock = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client({ cloudflare: { token: "cf-tok", accountId: null, publishSecret: null } })) } });
  const dryWith = await runGoLive(opts({ dryRun: true }), withBlock.deps);
  const realtimeIdx = dryWith.steps.indexOf("realtime");
  const envIdx = dryWith.steps.indexOf("env");
  assert.ok(realtimeIdx >= 0, `"realtime" must appear in the dry-run steps, got: ${dryWith.steps.join(", ")}`);
  assert.equal(realtimeIdx, envIdx - 1, '"realtime" sits immediately before "env"');

  const noBlock = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  const dryWithout = await runGoLive(opts({ dryRun: true }), noBlock.deps);
  assert.ok(!dryWithout.steps.includes("realtime"), "no cloudflare block -> no realtime step");

  const standbyWithBlock = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client({ cloudflare: { token: "cf-tok" }, generated: { seededAt: "2026-09-12T00:00:00.000Z" }, standbyHosts: [{ label: "standby", vercel: { token: "tok_sb" } }] })) } });
  const dryStandby = await runGoLive(opts({ dryRun: true, host: "standby" }), standbyWithBlock.deps);
  assert.ok(!dryStandby.steps.includes("realtime"), "a standby never gets a realtime step, even when the primary's record carries a cloudflare block");
});

test("full run with a cloudflare block: ensureRealtime is called exactly once before upsertEnv, and the upserted env carries the 3 REALTIME_* keys with the on-values", async () => {
  const w = fakeWorld({ cloudflare: true, files: { [CLIENT_PATH]: JSON.stringify(client({ cloudflare: { token: "cf-tok-full-run", accountId: null, publishSecret: null } })) } });
  const s = await runGoLive(opts(), w.deps);

  const relevant = w.calls.filter((c) => (c.kind === "spawn" && c.args.some((a) => String(a).includes("wrangler"))) || (c.kind === "fetch" && c.path?.startsWith("/v10/projects/prj_123/env")));
  const firstWranglerIdx = relevant.findIndex((c) => c.kind === "spawn");
  const envIdx = relevant.findIndex((c) => c.kind === "fetch");
  assert.ok(firstWranglerIdx >= 0, "wrangler was actually invoked (positive landmark: ensureRealtime really ran)");
  assert.ok(envIdx >= 0 && firstWranglerIdx < envIdx, "the realtime provisioning happens BEFORE the env upsert");

  const wranglerDeploySpawns = w.calls.filter((c) => c.kind === "spawn" && c.args.includes("deploy") && c.args.some((a) => String(a).includes("wrangler")));
  assert.equal(wranglerDeploySpawns.length, 1, "ensureRealtime's deploy runs exactly once for this single-deploy run");

  const env = w.calls.find((c) => c.path?.startsWith("/v10/projects/prj_123/env")).body;
  const byKey = Object.fromEntries(env.map((e) => [e.key, e.value]));
  assert.match(byKey.REALTIME_PUBLISH_URL, /^https:\/\/pos-realtime-sunrise-demo\.acme\.workers\.dev\/publish$/);
  assert.ok(typeof byKey.REALTIME_PUBLISH_SECRET === "string" && byKey.REALTIME_PUBLISH_SECRET.length > 0);
  assert.equal(byKey.NEXT_PUBLIC_REALTIME_URL, "wss://pos-realtime-sunrise-demo.acme.workers.dev/join");

  assert.equal(s.realtime.state, "on");
  assert.equal(s.realtime.workerName, "pos-realtime-sunrise-demo");
  assert.equal(s.realtime.deployed, true);
  assert.match(s.realtime.url, /^https:\/\/pos-realtime-sunrise-demo\.acme\.workers\.dev$/);

  const saved = w.readClient();
  assert.ok(saved.generated.realtime, "the realtime record is saved on generated.realtime");
  assert.equal(saved.generated.realtime.workerName, "pos-realtime-sunrise-demo");
  assert.ok(!w.calls.some((c) => c.kind === "log" && /cf-tok-full-run/.test(c.line)), "the cloudflare token is never logged");
});

test("realtime env is NOT written when the cloudflare block is absent and no prior realtime record exists (untouched — REALTIME_* left off the project entirely)", async () => {
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(client()) } });
  const s = await runGoLive(opts(), w.deps);
  const env = w.calls.find((c) => c.path?.startsWith("/v10/projects/prj_123/env")).body;
  assert.ok(!env.some((e) => REALTIME_ENV_KEYS_FOR_TEST.includes(e.key)), "no REALTIME_* key appears in the upserted env at all");
  assert.equal(s.realtime.state, "untouched");
  const saved = w.readClient();
  assert.equal("realtime" in saved.generated, false, "no realtime record is written either");
});

test("a standby run writes the 3 REALTIME_* keys as \"\" (a standby always polls; its own TENANT_ID would 403 the primary's Worker)", async () => {
  const primaryDone = client({ subdomain: "cafe", cloudflare: { token: "cf-tok", accountId: null, publishSecret: null }, generated: { projectId: "prj_primary", orgId: "team_owner", host: "cafe.sandbee.in", tenantId: "cafe", rootDomain: "sandbee.in", authSecret: "SHARED_AUTH", healthStatsToken: "SHARED_HS", seededAt: "2026-09-12T00:00:00.000Z", webAddress: { host: "cafe.sandbee.in", state: "live" }, realtime: { workerName: "pos-realtime-cafe", url: "https://pos-realtime-cafe.acme.workers.dev", accountId: "a".repeat(32), tenantId: "cafe", publishSecret: "primary-secret-0123456789ab", sourceHash: "x", deployedAt: "2026-09-12T00:00:00.000Z", verifiedAt: "2026-09-12T00:00:00.000Z" } }, standbyHosts: [{ label: "standby", vercel: { token: "tok_standby_account", project: null, teamId: null } }] });
  const w = fakeWorld({ files: { [CLIENT_PATH]: JSON.stringify(primaryDone), [PLATFORM_PATH]: platformFile() } });
  const s = await runGoLive(opts({ host: "standby" }), w.deps);
  const env = w.calls.find((c) => c.path?.startsWith("/v10/projects/prj_123/env")).body;
  const byKey = Object.fromEntries(env.map((e) => [e.key, e.value]));
  for (const k of REALTIME_ENV_KEYS_FOR_TEST) assert.equal(byKey[k], "", `${k} must be written as "" for a standby`);
  assert.equal(s.realtime.state, "standby");
  assert.ok(!w.calls.some((c) => c.kind === "spawn" && c.args.some((a) => String(a).includes("wrangler"))), "a standby run never touches wrangler");
});

test("summary.realtime shape: { state, workerName, url, tenantId, deployed } — 'off' state when the block is removed but a prior record exists", async () => {
  const withPrior = client({ generated: { realtime: { workerName: "pos-realtime-sunrise-demo", url: "https://pos-realtime-sunrise-demo.acme.workers.dev", accountId: "a".repeat(32), tenantId: "sunrise-demo-x7k2", publishSecret: "old-secret-0123456789ab", sourceHash: "x", deployedAt: "2026-09-12T00:00:00.000Z", verifiedAt: "2026-09-12T00:00:00.000Z" }, projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-x7k2.vercel.app", tenantId: "sunrise-demo-x7k2", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" } });
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(withPrior) } });
  const s = await runGoLive(opts({ skipSeed: true }), w.deps);
  assert.equal(s.realtime.state, "off");
  assert.deepEqual(Object.keys(s.realtime).sort(), ["deployed", "state", "tenantId", "url", "workerName"].sort());
  assert.equal(s.realtime.deployed, false);
  const env = w.calls.find((c) => c.path?.startsWith("/v10/projects/prj_123/env")).body;
  const byKey = Object.fromEntries(env.map((e) => [e.key, e.value]));
  for (const k of REALTIME_ENV_KEYS_FOR_TEST) assert.equal(byKey[k], "", `${k} must be blanked once the cloudflare block is removed`);
});

test("R2: a switch-off run (cloudflare block removed, a prior realtime record exists) saves the client file with NO generated.realtime — moved to generated.previousRealtime instead", async () => {
  const withPrior = client({ generated: { realtime: { workerName: "pos-realtime-sunrise-demo", url: "https://pos-realtime-sunrise-demo.acme.workers.dev", accountId: "a".repeat(32), tenantId: "sunrise-demo-x7k2", publishSecret: "old-secret-0123456789ab", sourceHash: "x", deployedAt: "2026-09-12T00:00:00.000Z", verifiedAt: "2026-09-12T00:00:00.000Z" }, projectId: "prj_123", orgId: "team_owner", host: "sunrise-demo-x7k2.vercel.app", tenantId: "sunrise-demo-x7k2", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" } });
  const w = fakeWorld({ projectExists: true, files: { [CLIENT_PATH]: JSON.stringify(withPrior) } });
  await runGoLive(opts({ skipSeed: true }), w.deps);
  const saved = w.readClient();
  assert.equal("realtime" in saved.generated, false, "the saved client file must have NO generated.realtime once the block was switched off");
  assert.ok(saved.generated.previousRealtime, "the saved client file must carry generated.previousRealtime instead");
  assert.equal(saved.generated.previousRealtime.workerName, "pos-realtime-sunrise-demo");
  assert.equal("publishSecret" in saved.generated.previousRealtime, false, "the switched-off Worker's secret must not persist under previousRealtime on disk");
});

test("R3 (index.mjs source pin): printWebAddressCheck's three branches exist in order — live / ready-not-live / records-table — read straight from source with existence asserts before the order comparison", () => {
  const indexSrc = readFileSync(fileURLToPath(new URL("./index.mjs", import.meta.url)), "utf8");
  const fnStart = indexSrc.indexOf("function printWebAddressCheck(");
  assert.ok(fnStart > 0, "positive landmark: printWebAddressCheck must exist in index.mjs");
  const fnEnd = indexSrc.indexOf("\n}\n", fnStart);
  const src = indexSrc.slice(fnStart, fnEnd);

  const liveIdx = src.indexOf("live and serving");
  const readyNotLiveIdx = src.indexOf('r.state === "ready"');
  const recordsIdx = src.indexOf("printRecordsTable(r.records)");
  assert.ok(liveIdx >= 0, 'the "live and serving" branch must exist');
  assert.ok(readyNotLiveIdx >= 0, 'the ready-but-not-live branch (checking r.state === "ready") must exist');
  assert.ok(recordsIdx >= 0, "the records-table fallback branch must exist");
  assert.ok(liveIdx < readyNotLiveIdx, "the live branch must be checked BEFORE the ready-not-live branch (an address that is both ready and live must print as live, not as 'DNS and https are ready')");
  assert.ok(readyNotLiveIdx < recordsIdx, "the ready-not-live branch must be checked BEFORE the records-table fallback (a ready-but-unswitched address must never fall through to 'add these records')");
  // Positive landmark on the exact wording of the ready-not-live message (naming go-live/Update on Vercel), so this isn't just matching the state check in isolation.
  assert.match(src, /run go-live[\s\S]*?Update on Vercel[\s\S]*?switch the cafe to this address/);
});
