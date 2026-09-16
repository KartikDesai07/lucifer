// ─────────────────────────────────────────────────────────────────────────────
// F3.5 — the Hub's Atlas Admin API client (the IO half; pure protocol shapes
// live in lib/atlas-plan.ts). Primitive per-resource operations only — the
// idempotent check-then-create ORDER is the F3.6 provisioner's job. Mirrors
// the cafe's proven client (apps/cafe/lib/provisioners/atlas.ts): versioned
// Accept, bounded Retry-After-honoring 429 handling (via lib/provider-retry),
// 409-adoption on every create, and error messages that carry ONLY the HTTP
// status + Atlas errorCode (never request bodies — passwords flow through).
//
// One client per tenant Atlas account: `createAtlasClient(creds)` caches its
// own OAuth2 bearer (refresh with slack BEFORE the 3600s expiry) and its own
// proactive rate-limit gate. Project creation is serialized MODULE-wide —
// across all client instances — because bursty parallel creates against the
// cap-10/refill-5-per-60s token bucket are exactly what half-provisions a
// tenant (§2 decision 7 / risk row 5).
//
// No-console gate (eslint override + scan test): SRV URIs with passwords and
// bearer tokens flow through this module.
// ─────────────────────────────────────────────────────────────────────────────

import {
  accessListBody,
  ATLAS_BASE_URL,
  ATLAS_TOKEN_PATH,
  ATLAS_VERSION_CLUSTER_READ,
  ATLAS_VERSION_CLUSTER_WRITE,
  ATLAS_VERSION_CORE,
  atlasMediaType,
  buildSrvUri,
  CLUSTER_POLL_INTERVAL_MS,
  CLUSTER_POLL_MAX_ATTEMPTS,
  createClusterBody,
  createProjectBody,
  createUserBody,
  DEFAULT_CLUSTER_SPEC,
  TOKEN_REFRESH_SLACK_MS,
  TOKEN_TTL_FALLBACK_SECONDS,
  type AtlasClusterSpec,
  type AtlasCredentials,
  type ClusterView,
  type DbUserSpec,
} from "@/lib/atlas-plan";
import {
  createRetryingFetch,
  createSerialQueue,
  resolveRetryDeps,
  type RetryDeps,
} from "@/lib/provider-retry";

const LABEL = "hub-atlas";

/** Module-wide: org/project creation runs one-at-a-time across ALL clients. */
const serializeProjectCreate = createSerialQueue();

export interface AtlasClient {
  /** POST /groups; a 409 (name taken) ADOPTS the existing project by name. */
  createProject(name: string): Promise<string>;
  /** POST /groups/{id}/clusters — create-or-leave (M0 cannot be modified);
   *  a 409 means a prior/concurrent create won — adopt it via pollIdle. */
  createM0(projectId: string, name: string, spec?: AtlasClusterSpec): Promise<void>;
  /** GET one cluster; null when it does not exist. */
  getCluster(projectId: string, name: string): Promise<ClusterView | null>;
  /** Poll until stateName === 'IDLE' (bounded; a timeout THROWS — the F3.6
   *  machine persists its step and resumes on the next run). */
  pollIdle(projectId: string, name: string): Promise<ClusterView>;
  /** POST /groups/{id}/databaseUsers; a 409 (user survives a crashed run)
   *  PATCH-resets the password so the URI we store carries a password THIS
   *  run knows (the cafe F2.8 resume rule). */
  createDbUser(projectId: string, user: DbUserSpec): Promise<void>;
  /** POST /groups/{id}/accessList 0.0.0.0/0; a 409 (already open) is fine. */
  addAccessList(projectId: string): Promise<void>;
  /** GET the cluster's bare standardSrv and inject the user's credentials. */
  getSrvUri(projectId: string, clusterName: string, user: DbUserSpec): Promise<string>;
}

interface AtlasInit {
  token?: string;
  body?: unknown; // JSON-encoded
  form?: string; // urlencoded (the OAuth token grant)
  /** The per-OPERATION resource version this call pins (plan-module note). */
  version?: string;
  headers?: Record<string, string>;
}

/** Non-2xx → throw with the Atlas errorCode; never echoes bodies we sent. */
async function expectOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  const code = await res
    .json()
    .then((body) => (body as { errorCode?: string }).errorCode ?? "")
    .catch(() => "");
  throw new Error(`[${LABEL}] ${what} → HTTP ${res.status} ${code}`);
}

/**
 * Build a client bound to ONE tenant Atlas account's Service-Account creds
 * (vault-decrypted by the caller — this module never touches the vault).
 * `overrides` is the test seam: fake fetch/sleep/clock, per instance, no
 * module-level state to reset (the F3.4 injectable-deps precedent).
 */
export function createAtlasClient(
  creds: AtlasCredentials,
  overrides?: Partial<RetryDeps>,
): AtlasClient {
  const deps = resolveRetryDeps(overrides);
  const rateLimitedFetch = createRetryingFetch(deps, { label: LABEL });
  let bearer: { token: string; expiresAtMs: number } | null = null;

  async function atlasFetch(method: string, path: string, init: AtlasInit): Promise<Response> {
    const media = atlasMediaType(init.version ?? ATLAS_VERSION_CORE);
    const payload =
      init.form !== undefined
        ? { type: "application/x-www-form-urlencoded", body: init.form }
        : init.body !== undefined
          ? // Atlas docs send the versioned media type as Content-Type too.
            { type: media, body: JSON.stringify(init.body) }
          : null;
    return rateLimitedFetch(`${ATLAS_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: media,
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
        ...(payload ? { "Content-Type": payload.type } : {}),
        ...(init.headers ?? {}),
      },
      ...(payload ? { body: payload.body } : {}),
    });
  }

  /** OAuth2 client-credentials → a 1h bearer, cached, refreshed with slack
   *  BEFORE expiry (the step's explicit verify leg). */
  async function getToken(): Promise<string> {
    if (bearer && deps.now() < bearer.expiresAtMs - TOKEN_REFRESH_SLACK_MS) {
      return bearer.token;
    }
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
    const res = await atlasFetch("POST", ATLAS_TOKEN_PATH, {
      form: "grant_type=client_credentials",
      // The token endpoint is unversioned — plain-JSON Accept + Basic auth.
      headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
    });
    await expectOk(res, "service-account token");
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    bearer = {
      token: body.access_token,
      expiresAtMs: deps.now() + (body.expires_in ?? TOKEN_TTL_FALLBACK_SECONDS) * 1000,
    };
    return bearer.token;
  }

  async function getCluster(projectId: string, name: string): Promise<ClusterView | null> {
    const token = await getToken();
    const res = await atlasFetch("GET", `/api/atlas/v2/groups/${projectId}/clusters/${name}`, {
      token,
      version: ATLAS_VERSION_CLUSTER_READ,
    });
    if (res.status === 404) return null;
    await expectOk(res, `get cluster ${name}`);
    return (await res.json()) as ClusterView;
  }

  return {
    createProject(name) {
      // Serialized module-wide; the token fetch rides inside the slot so a
      // parallel provision can't interleave /groups POSTs between clients.
      return serializeProjectCreate(async () => {
        const token = await getToken();
        const res = await atlasFetch("POST", "/api/atlas/v2/groups", {
          token,
          body: createProjectBody(creds.orgId, name),
        });
        if (res.status === 409) {
          // Resume: a prior run created it — adopt by its deterministic name.
          const got = await atlasFetch("GET", `/api/atlas/v2/groups/byName/${name}`, { token });
          await expectOk(got, `project byName ${name}`);
          return ((await got.json()) as { id: string }).id;
        }
        await expectOk(res, `create project ${name}`);
        return ((await res.json()) as { id: string }).id;
      });
    },

    async createM0(projectId, name, spec = DEFAULT_CLUSTER_SPEC) {
      const token = await getToken();
      const res = await atlasFetch("POST", `/api/atlas/v2/groups/${projectId}/clusters`, {
        token,
        body: createClusterBody(spec, name),
        version: ATLAS_VERSION_CLUSTER_WRITE,
      });
      if (res.status === 409) return; // create-or-leave: adopt via pollIdle
      await expectOk(res, `create cluster ${name}`);
    },

    getCluster,

    async pollIdle(projectId, name) {
      for (let poll = 0; poll < CLUSTER_POLL_MAX_ATTEMPTS; poll += 1) {
        const cluster = await getCluster(projectId, name);
        if (cluster?.stateName === "IDLE") return cluster;
        await deps.sleep(CLUSTER_POLL_INTERVAL_MS);
      }
      throw new Error(
        `[${LABEL}] cluster ${name} not IDLE after ${CLUSTER_POLL_MAX_ATTEMPTS} polls — resumable`,
      );
    },

    async createDbUser(projectId, user) {
      const token = await getToken();
      const res = await atlasFetch("POST", `/api/atlas/v2/groups/${projectId}/databaseUsers`, {
        token,
        body: createUserBody(user),
      });
      if (res.status === 409) {
        const patched = await atlasFetch(
          "PATCH",
          `/api/atlas/v2/groups/${projectId}/databaseUsers/admin/${user.username}`,
          { token, body: { password: user.password } },
        );
        await expectOk(patched, `reset password for ${user.username}`);
        return;
      }
      await expectOk(res, `create db user ${user.username}`);
    },

    async addAccessList(projectId) {
      const token = await getToken();
      const res = await atlasFetch("POST", `/api/atlas/v2/groups/${projectId}/accessList`, {
        token,
        body: accessListBody(),
      });
      if (res.status === 409) return; // already open — fine
      await expectOk(res, "open access list");
    },

    async getSrvUri(projectId, clusterName, user) {
      const cluster = await getCluster(projectId, clusterName);
      if (!cluster) throw new Error(`[${LABEL}] cluster ${clusterName} not found`);
      const srv = cluster.connectionStrings?.standardSrv;
      if (!srv) {
        throw new Error(`[${LABEL}] cluster ${clusterName} exposes no standardSrv (not IDLE yet?)`);
      }
      return buildSrvUri(srv, user);
    },
  };
}
