// scripts/go-live/cloudflare-api.mjs — everything realtime.mjs needs to talk
// to Cloudflare: the few REST calls (bound to ONE client-issued token) plus
// the wrangler CLI invocation + Worker-source hashing plumbing. Kept apart
// from realtime.mjs purely to stay under the ~300-line file budget — this
// module owns "how we reach Cloudflare", realtime.mjs owns "what we decide".
//
// Endpoint shapes (accounts / workers subdomain get+put) are pinned against
// research-cf-provision.md when that file exists; the fallback below is the
// documented Cloudflare v4 shape (GET/PUT /accounts/{id}/workers/subdomain,
// { result: { subdomain } }) used when the research file was not available
// at implementation time — see the STOP note in this repo's session report.
//
// `fetch` is injectable so realtime.test.mjs drives this against a fake API.

import { createHash } from "node:crypto";
import path from "node:path";
import { GoLiveError } from "./core.mjs";

export const CF_API_BASE = "https://api.cloudflare.com/client/v4";
export const WRANGLER_VERSION = "4.140.0";
export const SUBDOMAIN_CANDIDATE_ATTEMPTS = 3;
const HTTP_NOT_FOUND = 404;
const SUBDOMAIN_SUFFIX_HEX_BYTES = 2; // 4 hex chars, for a clashed candidate
const REALTIME_WORKER_DIR = path.join("workers", "realtime");
const REALTIME_WORKER_SRC = path.join(REALTIME_WORKER_DIR, "src");
const REALTIME_WORKER_MANIFEST = path.join(REALTIME_WORKER_DIR, "wrangler.jsonc");

export function createCloudflareApi({ token, fetch = globalThis.fetch, base = CF_API_BASE }) {
  if (!token) throw new Error("cloudflare-api: a token is required");

  async function request(method, path, { body } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, ok: res.ok, json };
  }

  // Never echo the token; only Cloudflare's own status + message.
  function fail(what, r) {
    const msg = r.json && Array.isArray(r.json.errors) && r.json.errors[0] && r.json.errors[0].message ? ` — ${r.json.errors[0].message}` : "";
    return new Error(`cloudflare: ${what} → HTTP ${r.status}${msg}`);
  }

  return {
    /** Every account this token can see: [{ id, name }]. */
    async listAccounts() {
      const r = await request("GET", "/accounts");
      if (!r.ok) throw fail("list accounts (is the token valid?)", r);
      const list = Array.isArray(r.json.result) ? r.json.result : [];
      return list.map((a) => ({ id: a.id, name: a.name }));
    },

    /** The account's workers.dev subdomain, or null when none is registered yet. */
    async getWorkersSubdomain(accountId) {
      const r = await request("GET", `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`);
      if (r.status === HTTP_NOT_FOUND) return null;
      if (!r.ok) throw fail("get workers.dev subdomain", r);
      const sub = r.json && r.json.result ? r.json.result.subdomain : null;
      return sub || null;
    },

    /** Register `name` as the account's workers.dev subdomain. Returns the
     *  subdomain Cloudflare accepted (may differ from the candidate on a clash —
     *  callers retry with a new candidate on a thrown error instead). */
    async registerWorkersSubdomain(accountId, name) {
      const r = await request("PUT", `/accounts/${encodeURIComponent(accountId)}/workers/subdomain`, { body: { subdomain: name } });
      if (!r.ok) throw fail(`register workers.dev subdomain "${name}"`, r);
      const sub = r.json && r.json.result ? r.json.result.subdomain : name;
      return sub || name;
    },
  };
}

/** sha1 over the Worker's manifest + every file under its src/ (sorted
 *  relative paths, path + content) — a change here forces a redeploy even
 *  when the client record has not changed. `deps.hash` is an injectable seam
 *  (default: node:crypto createHash); `deps.fs.readdirSync` is called with
 *  `{ withFileTypes: true }` to recurse. */
export function sourceHashOf(deps, root) {
  const h = (deps.hash ?? ((algo) => createHash(algo)))("sha1");
  const manifestPath = path.join(root, REALTIME_WORKER_MANIFEST);
  h.update(path.relative(root, manifestPath).split(path.sep).join("/"));
  h.update(deps.fs.readFileSync(manifestPath, "utf8"));
  const srcRoot = path.join(root, REALTIME_WORKER_SRC);
  const files = [];
  (function walk(dir) {
    for (const ent of deps.fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else files.push(full);
    }
  })(srcRoot);
  files.sort();
  for (const f of files) {
    h.update(path.relative(root, f).split(path.sep).join("/"));
    h.update(deps.fs.readFileSync(f, "utf8"));
  }
  return h.digest("hex");
}

/** How to invoke wrangler on this box (plan §0 / MEASURED in
 *  research-cf-provision.md): spawn `process.execPath <npx-cli.js> --yes
 *  wrangler@<version> …` when npm's npx-cli.js is found next to the running
 *  node (no shell, no .cmd — avoids the npm-run-eats-flags class of bug on
 *  Windows); fall back to `npx`/`npx.cmd` + shell:true only when that file is
 *  missing (e.g. a different node layout). */
export function wranglerCommand(deps, args) {
  const npxCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (deps.fs.existsSync(npxCli)) {
    return { cmd: process.execPath, args: [npxCli, "--yes", `wrangler@${WRANGLER_VERSION}`, ...args] };
  }
  return { cmd: process.platform === "win32" ? "npx.cmd" : "npx", args: ["--yes", `wrangler@${WRANGLER_VERSION}`, ...args], shell: true };
}

const REDACTED = "•••";

/** Run wrangler and stream every output line through `deps.log` (the CLI
 *  prints it, the console redacts it with secretsOf) — never through a
 *  message a caller could echo raw. Every value in `redact` (the token, the
 *  publish secret) is masked in those lines FIRST: the console's own list is
 *  snapshotted at job start, so a secret minted this run is not in it yet.
 *  A process that could not be STARTED (spawnSync `error`, status null) is
 *  reported as that — not as a wrangler failure the token could explain. */
export function runWrangler(deps, root, args, { env, input, onFail, redact = [] }) {
  const { cmd, args: fullArgs, shell } = wranglerCommand(deps, args);
  const res = deps.spawnCapture(cmd, fullArgs, { cwd: path.join(root, REALTIME_WORKER_DIR), env, input, shell });
  const mask = (line) => redact.filter((v) => typeof v === "string" && v.length > 0).reduce((acc, v) => acc.split(v).join(REDACTED), line);
  for (const line of `${res.stdout ?? ""}${res.stderr ?? ""}`.split(/\r?\n/)) if (line.length > 0) deps.log(`  ${mask(line)}`);
  if (res.status === null || res.status === undefined) {
    const code = res.error && res.error.code ? res.error.code : "no exit status";
    throw new GoLiveError(`wrangler could not be started (${code}) — the command was "${cmd}"`, { step: "realtime", hint: "node's bundled npm (npx-cli.js) was not found next to node.exe and npx is not on PATH — install Node from nodejs.org (which bundles npm) or add npx to PATH, then run again" });
  }
  if (res.status !== 0) throw onFail();
  return res;
}

/** One deployed candidate at a time: "pos-<slug>", then "pos-<slug>-<4 hex>"
 *  up to SUBDOMAIN_CANDIDATE_ATTEMPTS — a workers.dev subdomain is account-wide
 *  and can already be taken by an unrelated account. */
async function registerSubdomain(deps, api, accountId, slug) {
  let lastErr = null;
  for (let attempt = 1; attempt <= SUBDOMAIN_CANDIDATE_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 1 ? `pos-${slug}` : `pos-${slug}-${deps.randomBytes(SUBDOMAIN_SUFFIX_HEX_BYTES).toString("hex")}`;
    try {
      return await api.registerWorkersSubdomain(accountId, candidate);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new GoLiveError(`could not register a workers.dev subdomain for this account after ${SUBDOMAIN_CANDIDATE_ATTEMPTS} tries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, { step: "realtime" });
}

/** The account id to deploy into: the record's own `cloudflare.accountId`
 *  when set, else the token's one and only visible account. Several visible
 *  accounts with none pinned is not a guess we make silently. */
export async function resolveAccountId(api, cf) {
  if (cf.accountId) return cf.accountId;
  const accounts = await api.listAccounts();
  if (accounts.length === 1) return accounts[0].id;
  throw new GoLiveError(`the Cloudflare token reaches ${accounts.length} accounts — put the account id on the record (Hosting → Realtime)`, { step: "realtime" });
}

/** The workers.dev subdomain to build the Worker's URL on: the account's
 *  existing one, else a freshly registered candidate. */
export async function resolveSubdomain(deps, api, accountId, slug) {
  const existing = await api.getWorkersSubdomain(accountId);
  if (existing) return existing;
  return registerSubdomain(deps, api, accountId, slug);
}
