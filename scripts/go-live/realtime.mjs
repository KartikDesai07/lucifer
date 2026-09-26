// scripts/go-live/realtime.mjs — provision the per-cafe realtime Worker
// (workers/realtime) into the CLIENT'S OWN Cloudflare account. Mirrors the
// Vercel side (vercel-api.mjs / run.mjs's ensureProject): pure helpers first,
// the deps-injected flow last. No IO of its own beyond what `deps` grants —
// run.test.mjs (slice D) drives `ensureRealtime` against fakes.
//
// Off by default: `client.cloudflare === null` means the cafe polls, exactly
// as shipped — this module is only reached when the block is filled in.
// Never logs the token or the publish secret; the token reaches wrangler ONLY
// via env (never argv, per house rule).

import { createHmac } from "node:crypto";
import { GoLiveError } from "./core.mjs";
import { createCloudflareApi, resolveAccountId, resolveSubdomain, runWrangler, sourceHashOf, WRANGLER_VERSION } from "./cloudflare-api.mjs";

export { sourceHashOf, WRANGLER_VERSION };
export const WORKER_NAME_PREFIX = "pos-realtime-";
export const WORKER_NAME_MAX_LEN = 63;
export const WORKER_NAME_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
import { REALTIME_ENV_KEYS } from "./cloudflare-validate.mjs";
export { REALTIME_ENV_KEYS };
export const JOIN_PROBE_STATUS = 426;
export const PROBE_ATTEMPTS = 6;
export const PROBE_INTERVAL_MS = 2_000;
export const PUBLISH_SECRET_BYTES = 32;
// The block's validation rules live in the import-free leaf module (lib.mjs
// imports them from there too — no cycle through this file).
export { ACCOUNT_ID_RE, PUBLISH_SECRET_MIN_LEN, validateCloudflare } from "./cloudflare-validate.mjs";
/** Header + scheme literals — MIRROR of apps/cafe/lib/realtime-publish.ts /
 *  workers/realtime/src/index.ts (both pinned there against each other; this
 *  provisioner mirrors the same two constants for its own end-to-end probe). */
export const REALTIME_SIG_HEADER = "x-realtime-signature";
export const REALTIME_TS_HEADER = "x-realtime-ts";
/** A nudge kind that is always valid and always a safe no-op against a live
 *  cafe (a device with nothing to relax just ignores it). */
const PUBLISH_PROBE_KIND = "print-job";
const PUBLISH_HTTP_OK = 200;
const PUBLISH_HTTP_BAD_REQUEST = 400;
const PUBLISH_HTTP_UNAUTHORIZED = 401;
const PUBLISH_HTTP_FORBIDDEN = 403;
/** Answers that will not change by waiting — 200, or a 400 (the Worker judged
 *  the envelope itself). 401/403 are NOT definitive right after a deploy or a
 *  `secret put`: Cloudflare rolls the new Worker version / secret out over a
 *  few seconds and the OLD version answers 401 meanwhile (seen live on the
 *  first provisioning run: "Uploaded secret" then an immediate 401). So those
 *  are retried for the whole publish budget before they count. */
const PUBLISH_DEFINITIVE_STATUSES = [PUBLISH_HTTP_OK, PUBLISH_HTTP_BAD_REQUEST];
/** The /publish probe's own budget (30s) — longer than the /join probe's,
 *  because it also has to outlast secret/version propagation. Must stay well
 *  inside the Worker's ±300s timestamp window (pinned in realtime.test.mjs). */
export const PUBLISH_PROBE_ATTEMPTS = 10;
export const PUBLISH_PROBE_INTERVAL_MS = 3_000;
/** `pos-realtime-<slug>` — throws when the result breaks the Worker name rule
 *  wrangler itself enforces (lowercase/digits/hyphens, no leading/trailing
 *  hyphen, <= 63 chars). */
export function workerNameOf(slug) {
  const name = `${WORKER_NAME_PREFIX}${slug}`;
  if (name.length > WORKER_NAME_MAX_LEN || !WORKER_NAME_RE.test(name)) {
    throw new GoLiveError(`"${name}" is not a valid Worker name (lowercase letters, digits, hyphens; no leading/trailing hyphen; <= ${WORKER_NAME_MAX_LEN} chars) — shorten the slug`, { step: "realtime" });
  }
  return name;
}

/** The first `https://<name>.<sub>.workers.dev` URL in `text` (wrangler's own
 *  deploy output), trailing punctuation stripped, or null when none is found. */
export function parseWorkerUrl(text) {
  const m = String(text ?? "").match(/https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev/i);
  if (!m) return null;
  return m[0].replace(/[.,;:)]+$/, "");
}

const ENC = "encrypted";
const PLAIN = "plain";
const ENV_TARGETS = ["production", "preview"];
const envEntry = (key, value, type) => ({ key, value, type, target: ENV_TARGETS });

/** The three REALTIME_* env entries when the Worker is on. */
export function realtimeEnvOf({ url, secret }) {
  const host = url.replace(/^https:\/\//, "");
  return [
    envEntry(REALTIME_ENV_KEYS[0], `${url}/publish`, ENC),
    envEntry(REALTIME_ENV_KEYS[1], secret, ENC),
    envEntry(REALTIME_ENV_KEYS[2], `wss://${host}/join`, PLAIN),
  ];
}

/** The three REALTIME_* keys as "" — off/standby (upsert can only overwrite,
 *  never delete; this is what turns a switched-off Worker's values off on the
 *  project, same precedent as the image-store keys in lib.mjs buildEnv). */
export function realtimeOffEnv() {
  return REALTIME_ENV_KEYS.map((k) => envEntry(k, "", k === REALTIME_ENV_KEYS[2] ? PLAIN : ENC));
}

/** Lowercase-hex HMAC-SHA256 over `${tsSeconds}.${rawBody}` — the exact scheme
 *  apps/cafe/lib/realtime-publish.ts signRealtime() and the Worker's
 *  hmacHex()/verifyPublish() both implement; this is a THIRD, independent
 *  mirror (the provisioner cannot import either side), so a source-drift
 *  parity test on the cafe file is what keeps it honest. */
function signRealtime(secret, tsSeconds, rawBody) {
  return createHmac("sha256", secret).update(`${tsSeconds}.${rawBody}`).digest("hex");
}

/** The exact signed `{ body, headers }` a cafe would send for one nudge — used
 *  ONLY to prove, end to end, that URL + secret + TENANT_ID all agree after a
 *  deploy (a mismatch here is otherwise silent in production: the cafe's own
 *  publish is fire-and-forget and swallows a 401/403). Mirrors
 *  buildRealtimeRequest() field-for-field so the test-engineer can pin this
 *  against that function's own output. */
export function signedPublishRequest(secret, tenantId, nowMs) {
  const body = JSON.stringify({ tenant: tenantId, kind: PUBLISH_PROBE_KIND, at: new Date(nowMs).toISOString() });
  const ts = String(Math.floor(nowMs / 1000));
  return { body, headers: { "content-type": "application/json", [REALTIME_TS_HEADER]: ts, [REALTIME_SIG_HEADER]: signRealtime(secret, ts, body) } };
}

/** POST one signed `print-job` nudge and return the HTTP status reached (or
 *  null on a network failure) — retried up to PUBLISH_PROBE_ATTEMPTS times
 *  (401/403 included, see PUBLISH_DEFINITIVE_STATUSES). A nudge with no
 *  listeners is a safe no-op. */
async function probePublish(deps, url, secret, tenantId) {
  const { body, headers } = signedPublishRequest(secret, tenantId, deps.now ? deps.now() : Date.now());
  let status = null;
  for (let attempt = 1; attempt <= PUBLISH_PROBE_ATTEMPTS; attempt += 1) {
    try {
      const res = await deps.fetch(`${url}/publish`, { method: "POST", headers, body });
      status = res.status;
      if (PUBLISH_DEFINITIVE_STATUSES.includes(status)) break;
    } catch {
      status = null;
    }
    if (attempt < PUBLISH_PROBE_ATTEMPTS) await deps.sleep(PUBLISH_PROBE_INTERVAL_MS);
  }
  return status;
}

/**
 * Provision (or confirm) the realtime Worker for one cafe. `deps`: fs,
 * spawnCapture, fetch, randomBytes, sleep, log, env. `ctx`: { root, client,
 * slot, tenant }. Returns `{ state, env, workerName?, url?, tenantId?,
 * deployed }`. For state "on" it sets `slot.gen.realtime` (the record the
 * next run compares against); the caller (run.mjs) saveClient()s it. Every
 * other state leaves `slot.gen` untouched.
 */
export async function ensureRealtime(deps, { root, client, slot, tenant }) {
  if (!slot.isPrimary) {
    deps.log("▶ realtime: a standby keeps polling (the primary's Worker is bound to the primary's tenant)");
    return { state: "standby", env: realtimeOffEnv(), deployed: false };
  }
  const cf = client.cloudflare;
  const prior = slot.gen.realtime;
  if (!cf && prior) {
    deps.log(`▶ realtime: switched off on this record — Worker ${prior.workerName} stays in the client's Cloudflare account; the cafe goes back to polling`);
    // The record moves aside (same precedent as previousWebAddress /
    // previousHosting) WITHOUT its secret: the console's Status row then reads
    // "off" instead of asking for another run forever, and the key of a Worker
    // the cafe no longer talks to does not linger on disk.
    const { realtime: _switchedOff, ...restGen } = slot.gen;
    slot.gen = { ...restGen, previousRealtime: { workerName: prior.workerName, url: prior.url, accountId: prior.accountId, tenantId: prior.tenantId, switchedOffAt: new Date(deps.now ? deps.now() : Date.now()).toISOString() } };
    return { state: "off", env: realtimeOffEnv(), deployed: false };
  }
  if (!cf && !prior) {
    deps.log("▶ realtime: not set up (Hosting → Realtime) — the cafe polls; any REALTIME_* values already on the project are left as they are");
    return { state: "untouched", env: [], deployed: false };
  }
  if (!tenant || !tenant.tenantId) {
    deps.log("▶ realtime: TENANT_ID is not known yet — the Worker is provisioned once it is");
    return { state: "untouched", env: [], deployed: false };
  }

  const name = workerNameOf(client.slug);
  const secret = cf.publishSecret || prior?.publishSecret || deps.randomBytes(PUBLISH_SECRET_BYTES).toString("hex");
  const hash = sourceHashOf(deps, root);
  const tenantId = tenant.tenantId;
  const now = () => new Date(deps.now ? deps.now() : Date.now()).toISOString();

  const api = createCloudflareApi({ token: cf.token, fetch: deps.fetch });
  const accountId = await resolveAccountId(api, cf);
  const sub = await resolveSubdomain(deps, api, accountId, client.slug);
  let url = `https://${name}.${sub}.workers.dev`;

  let needsDeploy = !prior || prior.workerName !== name || prior.tenantId !== tenantId || prior.sourceHash !== hash || prior.url !== url;
  let needsSecret = needsDeploy || (prior && prior.publishSecret !== secret);
  const wranglerEnv = { ...deps.env, CLOUDFLARE_API_TOKEN: cf.token, CLOUDFLARE_ACCOUNT_ID: accountId, WRANGLER_SEND_METRICS: "false", CI: "true" };
  // Masked in every wrangler line before it is logged: the console's own
  // redaction list is snapshotted at job start, so a secret minted THIS run is
  // not in it yet — and the token must never reach a log line either way.
  const redact = [cf.token, secret];

  function deployWorker() {
    deps.log(`▶ realtime: deploying Worker ${name} into the client's Cloudflare account (tenant ${tenantId})`);
    const res = runWrangler(deps, root, ["deploy", "--name", name, "--var", `TENANT_ID:${tenantId}`], {
      env: wranglerEnv,
      redact,
      onFail: () => new GoLiveError(`deploying Worker ${name} failed — read the output above`, { step: "realtime", hint: "check the token scope (Workers Scripts: Edit + Account Settings: Read, this account only) and that the account has Workers enabled" }),
    });
    // wrangler's own printed URL is only a cross-check: adopt it ONLY when it
    // names this very Worker (its output can quote other *.workers.dev hosts —
    // notices, a previously deployed Worker), never wire the cafe to those.
    const parsed = parseWorkerUrl(res.stdout) ?? parseWorkerUrl(res.stderr);
    if (parsed && parsed !== url) {
      if (parsed.startsWith(`https://${name}.`)) {
        deps.log(`▶ realtime: wrangler reports ${parsed} — using that (workers.dev subdomain differed from the one just resolved)`);
        url = parsed;
      } else {
        deps.log(`▶ realtime: ignoring ${parsed} in wrangler's output — it is not this Worker's address (${url})`);
      }
    }
  }
  function putSecret() {
    deps.log(`▶ realtime: setting the publish secret on ${name}`);
    runWrangler(deps, root, ["secret", "put", "REALTIME_PUBLISH_SECRET", "--name", name], {
      env: wranglerEnv,
      input: `${secret}\n`,
      redact,
      onFail: () => new GoLiveError(`setting the publish secret on ${name} failed — read the output above`, { step: "realtime" }),
    });
  }

  if (needsDeploy) deployWorker();
  if (needsSecret) putSecret();
  if (!needsDeploy && !needsSecret) deps.log(`▶ realtime: Worker ${name} is up to date (tenant ${tenantId})`);

  let probeStatus = null;
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt += 1) {
    try {
      const res = await deps.fetch(`${url}/join`);
      probeStatus = res.status;
      if (probeStatus === JOIN_PROBE_STATUS) break;
    } catch {
      probeStatus = null;
    }
    if (attempt < PROBE_ATTEMPTS) await deps.sleep(PROBE_INTERVAL_MS);
  }
  if (probeStatus !== JOIN_PROBE_STATUS) {
    throw new GoLiveError(`${url}/join answered ${probeStatus ?? "no response"}, expected ${JOIN_PROBE_STATUS} — the Worker is not serving our code yet`, { step: "realtime", hint: "wait a minute and run again; check the Worker in the client's Cloudflare dashboard" });
  }

  // End-to-end proof: URL + secret + TENANT_ID must all agree, or a mismatch is
  // otherwise SILENT in production (the cafe's own publish is fire-and-forget
  // and swallows a 401/403). Self-heal once on each known-recoverable failure —
  // a 403 means this deployment serves a different tenant (redeploy fixes it),
  // a 401 means the secret drifted (re-put fixes it) — then re-probe once.
  let publishStatus = await probePublish(deps, url, secret, tenantId);
  if (publishStatus === PUBLISH_HTTP_FORBIDDEN && !needsDeploy) {
    deps.log(`▶ realtime: ${name} refused tenant ${tenantId} (403) — it was deployed for a different TENANT_ID; redeploying`);
    needsDeploy = true;
    deployWorker();
    publishStatus = await probePublish(deps, url, secret, tenantId);
  } else if (publishStatus === PUBLISH_HTTP_UNAUTHORIZED && !needsSecret) {
    deps.log(`▶ realtime: ${name} rejected the publish secret (401) — it drifted from the record; setting it again`);
    needsSecret = true;
    putSecret();
    publishStatus = await probePublish(deps, url, secret, tenantId);
  }
  if (publishStatus === PUBLISH_HTTP_FORBIDDEN) {
    throw new GoLiveError(`the Worker refuses tenant ${tenantId} — it was deployed for a different TENANT_ID; run again (the run redeploys it)`, { step: "realtime" });
  }
  if (publishStatus === PUBLISH_HTTP_UNAUTHORIZED) {
    throw new GoLiveError("the Worker's secret does not match — run again", { step: "realtime" });
  }
  // A 400 is NOT a credentials problem: the Worker keeps a closed allow-list of
  // event kinds and a strict envelope, so this means the probe's envelope no
  // longer matches the deployed Worker source — a code drift, not a setup one.
  if (publishStatus === PUBLISH_HTTP_BAD_REQUEST) {
    throw new GoLiveError(`${url}/publish rejected the probe envelope (400) — the provisioner's envelope no longer matches workers/realtime/src (a code change, not a setup problem)`, { step: "realtime", hint: "update scripts/go-live/realtime.mjs signedPublishRequest to match the Worker, then run again" });
  }
  if (publishStatus !== PUBLISH_HTTP_OK) {
    throw new GoLiveError(`${url}/publish answered ${publishStatus ?? "no response"}, expected ${PUBLISH_HTTP_OK} — the Worker is not accepting nudges yet`, { step: "realtime", hint: "wait a minute and run again; check the Worker in the client's Cloudflare dashboard" });
  }

  slot.gen = { ...slot.gen, realtime: { workerName: name, url, accountId, tenantId, publishSecret: secret, sourceHash: hash, deployedAt: needsDeploy ? now() : prior.deployedAt, verifiedAt: now() } };
  return { state: "on", env: realtimeEnvOf({ url, secret }), workerName: name, url, tenantId, deployed: needsDeploy };
}
