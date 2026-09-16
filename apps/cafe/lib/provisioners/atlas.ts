import { randomBytes } from "node:crypto";

import { encryptUriForStore } from "@/lib/cluster-router";
import type { StoredClusterRegistry } from "@/lib/cluster-router";
import {
  buildStandbyPushUpdate,
  mintNextStandbyTag,
  type RegistryUpdate,
} from "@/lib/ledger-scale-plan";
import { setStandbyProvisioner } from "@/lib/ledger-scale";
import { applyRegistryUpdate, readStoredRegistryDoc } from "@/lib/registry-io";
import {
  accessListBody,
  atlasConfigFromEnv,
  ATLAS_BASE_URL,
  ATLAS_VERSIONED_JSON,
  buildLedgerUri,
  CLUSTER_POLL_INTERVAL_MS,
  CLUSTER_POLL_MAX_ATTEMPTS,
  clusterNameFor,
  createClusterBody,
  createProjectBody,
  createUserBody,
  dbUsernameFor,
  projectNameFor,
  RATE_LIMIT_MAX_RETRIES,
  retryAfterMs,
  type AtlasProvisionerConfig,
  type EnsureStandbyResult,
} from "@/lib/provisioners/atlas-plan";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.8 — the REAL `ensureNextStandby` behind F2.7's provisioner seam:
// OAuth2 Service-Account token → ensure project → ensure M0 (TENANT) → poll
// IDLE → ensure DB user + 0.0.0.0/0 → push one warm standby `{id, uri(enc),
// tag, empty:true}` through the F2.7 registry write path (never forked).
//
// THE MANUAL SIGNUP BOUNDARY (irreducible — documented, never crossed): a human
// created the free Atlas ACCOUNT/ORG (signup + captcha) and pasted the
// Service-Account creds once; this module only acts INSIDE that org (250
// projects/org ≈ one signup per cafe). The PRIMARY growth flow stays the manual
// paste-and-Connect (F2 §2.12) — this is the optional accelerator F3 installs.
//
// Idempotent + resumable: an armed standby short-circuits; deterministic
// tag-keyed names let a re-run ADOPT half-created resources (project 409 →
// byName, cluster GET-first, user 409 → password PATCH so the pushed URI always
// carries a password THIS run knows); the final push is CAS-guarded. Errors
// THROW — the nudge wrapper logs them fire-and-forget; the next nudge resumes.
//
// Honest caveats: (a) runs are single-flighted in-process, but two PROCESSES
// racing one tag could interleave password PATCHes and push a since-reset URI —
// entry is the single Hub cron (#26), and a poisoned standby fails F2.7's
// validate-before-activate ping (the active keeps writes; F3's panel heals).
// (b) a push losing its CAS to a concurrent paste ORPHANS the created
// project/cluster — logged loudly with names; the Hub adopts or deletes (F3).
// ─────────────────────────────────────────────────────────────────────────────

// ── Injectable collaborators (the F2.7 `__setScaleDepsForTests` precedent) ────
interface AtlasDeps {
  fetchImpl: typeof fetch;
  readRegistryDoc: () => Promise<StoredClusterRegistry | null>;
  updateRegistryDoc: (upd: RegistryUpdate) => Promise<number>;
  sleep: (ms: number) => Promise<void>;
  randomSecret: () => string;
  config: () => AtlasProvisionerConfig | null;
  now: () => number;
}
const realDeps: AtlasDeps = {
  fetchImpl: (...args) => fetch(...args),
  readRegistryDoc: readStoredRegistryDoc,
  updateRegistryDoc: applyRegistryUpdate,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  randomSecret: () => randomBytes(24).toString("base64url"),
  config: atlasConfigFromEnv,
  now: () => Date.now(),
};
let deps: AtlasDeps = realDeps;
let bearer: { token: string; expiresAtMs: number } | null = null;
let inFlight: Promise<EnsureStandbyResult> | null = null;
/** TEST SEAM — override collaborators; `null` restores. Always clears the
 *  cached bearer + in-flight run so tests are hermetic. */
export function __setAtlasDepsForTests(overrides: Partial<AtlasDeps> | null): void {
  deps = overrides ? { ...realDeps, ...overrides } : realDeps;
  bearer = null;
  inFlight = null;
}

// ── HTTP layer (versioned Accept, bearer, bounded Retry-After-honoring 429) ───
interface AtlasInit {
  token?: string;
  body?: unknown; // JSON-encoded
  form?: string; // urlencoded (the OAuth token grant)
  headers?: Record<string, string>;
}
async function atlasFetch(method: string, path: string, init: AtlasInit): Promise<Response> {
  const payload =
    init.form !== undefined
      ? { type: "application/x-www-form-urlencoded", body: init.form }
      : init.body !== undefined
        ? { type: "application/json", body: JSON.stringify(init.body) }
        : null;
  for (let attempt = 0; ; attempt += 1) {
    const res = await deps.fetchImpl(`${ATLAS_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: ATLAS_VERSIONED_JSON,
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(payload ? { "Content-Type": payload.type } : {}),
        ...(init.headers ?? {}),
      },
      ...(payload ? { body: payload.body } : {}),
    });
    if (res.status !== 429) return res;
    if (attempt >= RATE_LIMIT_MAX_RETRIES) {
      throw new Error(`[atlas-provisioner] ${method} ${path} still 429 after ${attempt + 1} attempts`);
    }
    await deps.sleep(retryAfterMs(res.headers.get("Retry-After"), deps.now()));
  }
}

/** Non-2xx → throw with the Atlas errorCode; never echoes bodies we sent. */
async function expectOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  const code = await res
    .json()
    .then((b) => (b as { errorCode?: string }).errorCode ?? "")
    .catch(() => "");
  throw new Error(`[atlas-provisioner] ${what} → HTTP ${res.status} ${code}`);
}

/** OAuth2 client-credentials → a 1h bearer, cached with 60s slack (§2.8). */
async function getBearer(cfg: AtlasProvisionerConfig): Promise<string> {
  if (bearer && deps.now() < bearer.expiresAtMs - 60_000) return bearer.token;
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await atlasFetch("POST", "/api/oauth/token", {
    form: "grant_type=client_credentials",
    // The token endpoint is unversioned — plain-JSON Accept + Basic auth.
    headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
  });
  await expectOk(res, "service-account token");
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  bearer = { token: body.access_token, expiresAtMs: deps.now() + (body.expires_in ?? 3600) * 1000 };
  return bearer.token;
}

// ── Ensure steps (each ADOPTS an existing resource on conflict — resume) ──────
async function ensureProject(cfg: AtlasProvisionerConfig, token: string, name: string): Promise<string> {
  const res = await atlasFetch("POST", "/api/atlas/v2/groups", { token, body: createProjectBody(cfg, name) });
  if (res.status === 409) {
    // Resume: a prior run created it — adopt by its deterministic name.
    const got = await atlasFetch("GET", `/api/atlas/v2/groups/byName/${name}`, { token });
    await expectOk(got, `project byName ${name}`);
    return ((await got.json()) as { id: string }).id;
  }
  await expectOk(res, `create project ${name}`);
  return ((await res.json()) as { id: string }).id;
}

interface ClusterView {
  id?: string;
  stateName?: string;
  connectionStrings?: { standardSrv?: string };
}
async function getCluster(token: string, projectId: string, name: string): Promise<ClusterView | null> {
  const res = await atlasFetch("GET", `/api/atlas/v2/groups/${projectId}/clusters/${name}`, { token });
  if (res.status === 404) return null;
  await expectOk(res, `get cluster ${name}`);
  return (await res.json()) as ClusterView;
}

/** Create the M0 when absent, then poll until IDLE (bounded; a timeout throws —
 *  the flow resumes on the next nudge, re-adopting the CREATING cluster). */
async function ensureIdleCluster(
  cfg: AtlasProvisionerConfig,
  token: string,
  projectId: string,
  name: string,
): Promise<ClusterView> {
  let cluster = await getCluster(token, projectId, name);
  if (cluster?.stateName === "IDLE") return cluster; // resume: already live
  if (!cluster) {
    const res = await atlasFetch("POST", `/api/atlas/v2/groups/${projectId}/clusters`, {
      token,
      body: createClusterBody(cfg, name),
    });
    // A 409 here means a concurrent/prior create won — adopt it via the poll.
    if (res.status !== 409) await expectOk(res, `create cluster ${name}`);
  }
  for (let poll = 0; poll < CLUSTER_POLL_MAX_ATTEMPTS; poll += 1) {
    cluster = await getCluster(token, projectId, name);
    if (cluster?.stateName === "IDLE") return cluster;
    await deps.sleep(CLUSTER_POLL_INTERVAL_MS);
  }
  throw new Error(`[atlas-provisioner] cluster ${name} not IDLE after ${CLUSTER_POLL_MAX_ATTEMPTS} polls — will resume on the next nudge`);
}

/** Create the scoped DB user; if one survives a crashed run, PATCH-reset its
 *  password so the URI we push carries a password THIS run knows. */
async function ensureDbUser(
  cfg: AtlasProvisionerConfig,
  token: string,
  projectId: string,
  username: string,
  password: string,
): Promise<void> {
  const res = await atlasFetch("POST", `/api/atlas/v2/groups/${projectId}/databaseUsers`, {
    token,
    body: createUserBody(cfg, username, password),
  });
  if (res.status === 409) {
    const patched = await atlasFetch(
      "PATCH",
      `/api/atlas/v2/groups/${projectId}/databaseUsers/admin/${username}`,
      { token, body: { password } },
    );
    await expectOk(patched, `reset password for ${username}`);
    return;
  }
  await expectOk(res, `create db user ${username}`);
}

async function ensureAccessList(token: string, projectId: string): Promise<void> {
  const res = await atlasFetch("POST", `/api/atlas/v2/groups/${projectId}/accessList`, {
    token,
    body: accessListBody(),
  });
  if (res.status === 409) return; // already open — fine
  await expectOk(res, "open access list");
}

// ── The provisioner ───────────────────────────────────────────────────────────
/** Single-flighted in-process (concurrent nudges share one run — interleaved
 *  password PATCHes within a process are impossible; see the header caveat). */
export function ensureNextStandby(): Promise<EnsureStandbyResult> {
  inFlight ??= runEnsure().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runEnsure(): Promise<EnsureStandbyResult> {
  const cfg = deps.config();
  if (!cfg) return { status: "not-configured" };
  const doc = await deps.readRegistryDoc();
  if (!doc) {
    // Bootstrap era: doc creation is F3's paste-and-Connect — the provisioner
    // only ever UPDATES an existing manifest (the F2.7 write-side rule).
    console.warn("[atlas-provisioner] no registry doc yet — the FIRST ledger arrives via the manual paste-and-Connect (F3 owns doc creation)");
    return { status: "no-registry-doc" };
  }
  if ((doc.standby ?? []).length > 0) return { status: "already-armed" };

  const tag = mintNextStandbyTag(doc); // F2.7's single mint path — never forked
  const projectName = projectNameFor(cfg, tag);
  const clusterName = clusterNameFor(tag);
  const token = await getBearer(cfg);
  const projectId = await ensureProject(cfg, token, projectName);
  const cluster = await ensureIdleCluster(cfg, token, projectId, clusterName);
  const srv = cluster.connectionStrings?.standardSrv;
  if (!srv) throw new Error(`[atlas-provisioner] IDLE cluster ${clusterName} exposes no standardSrv`);
  const username = dbUsernameFor(tag);
  const password = deps.randomSecret();
  await ensureDbUser(cfg, token, projectId, username, password);
  await ensureAccessList(token, projectId);

  const entry = {
    id: cluster.id ?? `${projectId}:${clusterName}`,
    // NEW secret entering the doc → the write-side vault seam (identity until F3).
    uri: encryptUriForStore(buildLedgerUri(srv, username, password, cfg.ledgerDb)),
    tag,
    empty: true,
  };
  const matched = await deps.updateRegistryDoc(buildStandbyPushUpdate(doc, entry));
  if (matched === 0) {
    const fresh = await deps.readRegistryDoc();
    if ((fresh?.standby ?? []).some((s) => s.id === entry.id)) {
      return { status: "already-armed", tag, projectId, clusterName };
    }
    console.error(
      `[atlas-provisioner] standby push lost its CAS — cluster ${clusterName} in project ${projectName} (${projectId}) is ORPHANED until the Hub adopts or deletes it`,
    );
    return { status: "raced", tag, projectId, clusterName };
  }
  return { status: "pushed", tag, projectId, clusterName };
}

// ── Wiring into F2.7's seam ───────────────────────────────────────────────────
/** Install the Atlas provisioner behind `setStandbyProvisioner` when the
 *  Service-Account env is present; otherwise leave the manual paste-and-Connect
 *  prompt (the primary flow) in place and return false. F3's Hub-invoked
 *  entrypoint calls this before `scaleCheck()` — per #26 nothing in the cafe
 *  app schedules or auto-installs it. */
export function installAtlasProvisioner(): boolean {
  if (!deps.config()) return false;
  setStandbyProvisioner(async () => {
    await ensureNextStandby();
  });
  return true;
}
