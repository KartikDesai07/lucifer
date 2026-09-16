// ─────────────────────────────────────────────────────────────────────────────
// F3.5 — the Hub's Vercel REST client. Primitive per-resource operations only
// (create project / upsert env / deploy / domain add-verify-remove / deployment
// status) — the F3.6 provisioner owns ordering, and F3.10's failover runbook
// owns when remove+add runs. One client per Vercel ACCOUNT (each cafe has an
// active + a standby account, §2 decision 11): `createVercelClient({token,
// teamId?})`, token pasted once and vault-stored — this module never touches
// the vault.
//
// All calls ride the shared rate-limit layer (lib/provider-retry). Vercel 429s
// carry X-RateLimit-Remaining/-Reset (epoch SECONDS) but — per the docs and
// the OpenAPI spec, re-verified 2026-07-12 — NO documented Retry-After; the
// shared layer computes the wait from the reset header (and still honors a
// Retry-After if one ever appears). Endpoint VERSION segments are pinned as
// constants below — Vercel versions per-path (v9/v10/v13 coexist); bump one
// constant, not call sites. Versions verified against openapi.vercel.sh
// 2026-07-12.
//
// No-console gate (eslint override + scan test): env-var VALUES pushed via
// upsertEnv include MONGODB_URIs and NEXTAUTH_SECRETs; errors carry the Vercel
// error CODE only, never request bodies.
// ─────────────────────────────────────────────────────────────────────────────

import {
  createRetryingFetch,
  resolveRetryDeps,
  type RetryDeps,
} from "@/lib/provider-retry";

const LABEL = "hub-vercel";
export const VERCEL_BASE_URL = "https://api.vercel.com";

/** Per-path API versions (Vercel versions endpoints independently). */
const V_PROJECTS = "v11";
const V_ENV = "v10";
const V_DEPLOYMENTS = "v13";
const V_DOMAINS = "v10";
const V_DOMAIN_VERIFY = "v9";

// ── Inputs (from the vault / the F3.6 provisioner — never from Hub env) ──────
export interface VercelCredentials {
  token: string;
  /** Present only when the token acts inside a team, appended as ?teamId=. */
  teamId?: string;
}

/** One env var to upsert. `type:'encrypted'` is the Vercel default for
 *  secrets; `sensitive` additionally makes the value unreadable in the
 *  dashboard — the §2-decision-3 posture for KEK-class material. */
export interface VercelEnvVar {
  key: string;
  value: string;
  type?: "plain" | "encrypted" | "sensitive";
  target?: ("production" | "preview" | "development")[];
}

export interface VercelDeployOptions {
  /** The project name (doubles as the deployment name). */
  name: string;
  project: string;
  target?: "production";
  /** Deploy from the connected git repo (the provisioner's path). */
  gitSource?: { type: "github"; repoId: number | string; ref: string };
}

export interface VercelDeployment {
  id: string;
  readyState: string; // QUEUED | BUILDING | INITIALIZING | READY | ERROR | CANCELED
  url?: string;
}

export interface VercelDomainStatus {
  name: string;
  verified: boolean;
  /** Present when unverified: the DNS challenge(s) the registrar must carry. */
  verification?: { type: string; domain: string; value: string }[];
}

/** Optional project-creation settings. `rootDirectory` targets the monorepo's
 *  cafe app (apps/cafe); `gitRepository` connects the repo so deploys can be
 *  triggered from a ref. All optional — the primitive passes through whatever
 *  the F3.6 provisioner supplies. */
export interface VercelCreateProjectOpts {
  framework?: string;
  rootDirectory?: string;
  gitRepository?: { type: "github"; repo: string };
}

export interface VercelClient {
  /** GET one project by id-or-name; null when it does not exist (404). The F3.6
   *  machine calls this FIRST so a crash between createProject and recording its
   *  id resumes by adoption instead of a name-conflict throw. */
  getProject(projectIdOrName: string): Promise<{ id: string; name: string } | null>;
  /** POST /projects → the new project's id (name conflicts THROW — project
   *  naming/adoption policy is the F3.6 machine's, not this primitive's). */
  createProject(name: string, opts?: VercelCreateProjectOpts): Promise<{ id: string; name: string }>;
  /** Batch-upsert env vars (?upsert=true — re-runs overwrite, never 409). */
  upsertEnv(projectIdOrName: string, envs: VercelEnvVar[]): Promise<void>;
  /** POST /deployments → id + readyState (poll with deploymentStatus). */
  deploy(opts: VercelDeployOptions): Promise<VercelDeployment>;
  deploymentStatus(deploymentId: string): Promise<VercelDeployment>;
  addDomain(projectIdOrName: string, domain: string): Promise<VercelDomainStatus>;
  verifyDomain(projectIdOrName: string, domain: string): Promise<VercelDomainStatus>;
  /** Idempotent: removing an already-absent domain (404) is a no-op — the
   *  manual failover runbook (F3.10) must be safely re-runnable. */
  removeDomain(projectIdOrName: string, domain: string): Promise<void>;
}

/** Non-2xx → throw with the Vercel error code; never echoes bodies we sent. */
async function expectOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  const code = await res
    .json()
    .then((body) => (body as { error?: { code?: string } }).error?.code ?? "")
    .catch(() => "");
  throw new Error(`[${LABEL}] ${what} → HTTP ${res.status} ${code}`);
}

/**
 * Build a client bound to ONE Vercel account's token. `overrides` is the test
 * seam (fake fetch/sleep/clock) — per instance, nothing module-level.
 */
export function createVercelClient(
  creds: VercelCredentials,
  overrides?: Partial<RetryDeps>,
): VercelClient {
  const deps = resolveRetryDeps(overrides);
  const rateLimitedFetch = createRetryingFetch(deps, { label: LABEL });

  function url(path: string): string {
    const u = new URL(`${VERCEL_BASE_URL}${path}`);
    if (creds.teamId) u.searchParams.set("teamId", creds.teamId);
    return u.toString();
  }

  async function vercelFetch(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<Response> {
    const u = new URL(url(path));
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    return rateLimitedFetch(u.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${creds.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function domainStatus(res: Response, what: string): Promise<VercelDomainStatus> {
    await expectOk(res, what);
    const body = (await res.json()) as {
      name?: string;
      verified?: boolean;
      verification?: { type: string; domain: string; value: string }[];
    };
    return {
      name: body.name ?? "",
      verified: body.verified === true,
      ...(body.verification?.length ? { verification: body.verification } : {}),
    };
  }

  return {
    async getProject(projectIdOrName) {
      const res = await vercelFetch(
        "GET",
        `/${V_PROJECTS}/projects/${encodeURIComponent(projectIdOrName)}`,
      );
      if (res.status === 404) return null;
      await expectOk(res, `get project ${projectIdOrName}`);
      const body = (await res.json()) as { id: string; name: string };
      return { id: body.id, name: body.name };
    },

    async createProject(name, opts) {
      const res = await vercelFetch("POST", `/${V_PROJECTS}/projects`, {
        name,
        // The POS is a Next.js app; framework drives Vercel's build defaults.
        framework: opts?.framework ?? "nextjs",
        // Monorepo: the cafe app lives under apps/cafe.
        ...(opts?.rootDirectory ? { rootDirectory: opts.rootDirectory } : {}),
        ...(opts?.gitRepository ? { gitRepository: opts.gitRepository } : {}),
      });
      await expectOk(res, `create project ${name}`);
      const body = (await res.json()) as { id: string; name: string };
      return { id: body.id, name: body.name };
    },

    async upsertEnv(projectIdOrName, envs) {
      if (envs.length === 0) return;
      const payload = envs.map((env) => ({
        key: env.key,
        value: env.value,
        type: env.type ?? "encrypted",
        target: env.target ?? ["production", "preview"],
      }));
      const res = await vercelFetch(
        "POST",
        `/${V_ENV}/projects/${encodeURIComponent(projectIdOrName)}/env`,
        payload,
        { upsert: "true" },
      );
      await expectOk(res, `upsert ${envs.length} env vars on ${projectIdOrName}`);
      // A 201 can still carry PARTIAL failures: {created, failed:[{error}]}.
      // A silently-missing env var is a broken tenant deploy — fail loudly
      // (codes only, never values).
      const body = (await res.json().catch(() => ({}))) as {
        failed?: { error?: { code?: string } }[];
      };
      if (body.failed && body.failed.length > 0) {
        const codes = body.failed.map((f) => f.error?.code ?? "unknown").join(",");
        throw new Error(
          `[${LABEL}] ${body.failed.length}/${envs.length} env vars failed to upsert on ${projectIdOrName} (${codes})`,
        );
      }
    },

    async deploy(opts) {
      const res = await vercelFetch("POST", `/${V_DEPLOYMENTS}/deployments`, {
        name: opts.name,
        project: opts.project,
        target: opts.target ?? "production",
        ...(opts.gitSource ? { gitSource: opts.gitSource } : {}),
      });
      await expectOk(res, `deploy ${opts.project}`);
      const body = (await res.json()) as VercelDeployment;
      return { id: body.id, readyState: body.readyState, url: body.url };
    },

    async deploymentStatus(deploymentId) {
      const res = await vercelFetch(
        "GET",
        `/${V_DEPLOYMENTS}/deployments/${encodeURIComponent(deploymentId)}`,
      );
      await expectOk(res, `deployment status ${deploymentId}`);
      const body = (await res.json()) as VercelDeployment;
      return { id: body.id, readyState: body.readyState, url: body.url };
    },

    async addDomain(projectIdOrName, domain) {
      const res = await vercelFetch(
        "POST",
        `/${V_DOMAINS}/projects/${encodeURIComponent(projectIdOrName)}/domains`,
        { name: domain },
      );
      // NOT adoptable: a 409 here means the domain is assigned to ANOTHER
      // Vercel project (a real conflict — F3.10's failover must remove it
      // there first); "already on THIS project" is a 400. Resume-adoption is
      // the F3.6 machine's check-then-create (verifyDomain reads state back).
      return domainStatus(res, `add domain ${domain}`);
    },

    async verifyDomain(projectIdOrName, domain) {
      const res = await vercelFetch(
        "POST",
        `/${V_DOMAIN_VERIFY}/projects/${encodeURIComponent(projectIdOrName)}/domains/${encodeURIComponent(domain)}/verify`,
      );
      return domainStatus(res, `verify domain ${domain}`);
    },

    async removeDomain(projectIdOrName, domain) {
      const res = await vercelFetch(
        "DELETE",
        `/${V_DOMAIN_VERIFY}/projects/${encodeURIComponent(projectIdOrName)}/domains/${encodeURIComponent(domain)}`,
      );
      if (res.status === 404) return; // already gone — the runbook re-ran
      await expectOk(res, `remove domain ${domain}`);
    },
  };
}
