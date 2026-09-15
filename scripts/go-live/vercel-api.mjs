// scripts/go-live/vercel-api.mjs — the few Vercel REST calls go-live needs, bound
// to ONE account token. Endpoint versions are per-path (Vercel versions each path
// independently; verified against vercel.com/docs/rest-api 2026-09-12) and pinned
// here as constants. Errors carry the HTTP status + Vercel error code only — never
// a request body (env values include the Atlas URI and the auth secret).
//
// `fetch` is injectable so run.test.mjs drives the whole flow against a fake API.

export const API_BASE = "https://api.vercel.com";
export const VERSIONS = {
  user: "v2", // GET /v2/user
  projectGet: "v9", // GET /v9/projects/{idOrName}
  projectCreate: "v11", // POST /v11/projects
  projectDelete: "v9", // DELETE /v9/projects/{idOrName}
  domains: "v9", // GET /v9/projects/{id}/domains
  domainGet: "v9", // GET /v9/projects/{id}/domains/{domain}
  domainAdd: "v10", // POST /v10/projects/{id}/domains
  domainVerify: "v9", // POST /v9/projects/{id}/domains/{domain}/verify
  domainUpdate: "v9", // PATCH /v9/projects/{id}/domains/{domain}
  domainConfig: "v6", // GET /v6/domains/{domain}/config
  env: "v10", // POST /v10/projects/{id}/env?upsert=true
};
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;
const HTTP_GONE = 410;

export function createVercelApi({ token, teamId, fetch = globalThis.fetch, base = API_BASE }) {
  if (!token) throw new Error("vercel-api: a token is required");

  async function request(method, path, { body, query } = {}) {
    const url = new URL(`${base}${path}`);
    if (teamId) url.searchParams.set("teamId", teamId);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
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

  /** `codeOnly` for calls whose request carried secrets (env upsert): Vercel's
   *  message text is not ours to trust with the values, so only the code is shown. */
  function fail(what, r, { codeOnly = false } = {}) {
    const code = r.json && r.json.error && r.json.error.code ? ` ${r.json.error.code}` : "";
    const msg = !codeOnly && r.json && r.json.error && r.json.error.message ? ` — ${r.json.error.message}` : "";
    return new Error(`vercel: ${what} → HTTP ${r.status}${code}${msg}`);
  }

  return {
    /** Who the token belongs to — printed so the owner sees WHICH account is being used. */
    async getUser() {
      const r = await request("GET", `/${VERSIONS.user}/user`);
      if (!r.ok) throw fail("get user (is the token valid?)", r);
      const u = r.json.user ?? r.json;
      return { id: u.id, username: u.username, email: u.email };
    },

    /** null when the project does not exist yet (404) — the create-or-adopt check.
     *  `hasProduction`: docs 2026-09-13, GET /v9/projects/{idOrName} → a `targets`
     *  object keyed by environment, each target nullable — `targets.production`
     *  is the project's latest production deployment, or null when it has none
     *  yet. true/false when `targets` is present, null when the field itself is
     *  missing (unknown — treated as "serves" by the conservative caller). */
    async getProject(idOrName) {
      const r = await request("GET", `/${VERSIONS.projectGet}/projects/${encodeURIComponent(idOrName)}`);
      // 404 = never existed / deleted; 410 = Vercel's "gone" — both mean "no such project" here.
      if (r.status === HTTP_NOT_FOUND || r.status === HTTP_GONE) return null;
      if (!r.ok) throw fail(`get project ${idOrName}`, r);
      return { id: r.json.id, name: r.json.name, accountId: r.json.accountId, hasProduction: r.json.targets ? Boolean(r.json.targets.production) : null };
    },

    /** A Next.js project whose Root Directory is the cafe workspace. NOT connected
     *  to git — deploys are CLI uploads (apps/cafe/DEPLOY.md "Do NOT use GitHub
     *  auto-deploy for a client"). A brand-new project has no production target
     *  yet, but `created:true` (set by run.mjs's ensureProject) already covers
     *  that case — `hasProduction` here is for symmetry with getProject. */
    async createProject(name, { framework, rootDirectory }) {
      const r = await request("POST", `/${VERSIONS.projectCreate}/projects`, { body: { name, framework, rootDirectory } });
      if (!r.ok) throw fail(`create project ${name}`, r);
      return { id: r.json.id, name: r.json.name, accountId: r.json.accountId, hasProduction: r.json.targets ? Boolean(r.json.targets.production) : null };
    },

    /** Delete a project — its deployments, env vars and custom domains go with
     *  it (Fresh start). Success is 2xx/204 with no body to parse; a 404 means
     *  it is already gone (treat that as success, not an error). */
    async deleteProject(idOrName) {
      const r = await request("DELETE", `/${VERSIONS.projectDelete}/projects/${encodeURIComponent(idOrName)}`);
      if (r.status === HTTP_NOT_FOUND || r.status === HTTP_GONE) return { gone: true };
      if (!r.ok) throw fail(`delete project ${idOrName}`, r);
      return { gone: true };
    },

    async listDomains(projectId) {
      const r = await request("GET", `/${VERSIONS.domains}/projects/${encodeURIComponent(projectId)}/domains`);
      if (!r.ok) throw fail("list project domains", r);
      return Array.isArray(r.json.domains) ? r.json.domains : [];
    },

    /** null when the domain is not attached to this project (404) — the
     *  attach-or-adopt check for ensureWebAddress. */
    async getProjectDomain(projectId, name) {
      const r = await request("GET", `/${VERSIONS.domainGet}/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(name)}`);
      if (r.status === HTTP_NOT_FOUND) return null;
      if (!r.ok) throw fail(`get domain ${name}`, r);
      return r.json;
    },

    /** DNS/TLS readiness Vercel itself computed for this domain, whichever
     *  project it is on. Throws on failure — callers catch when it is optional. */
    async getDomainConfig(name) {
      const r = await request("GET", `/${VERSIONS.domainConfig}/domains/${encodeURIComponent(name)}/config`);
      if (!r.ok) throw fail(`get domain config for ${name}`, r);
      return r.json;
    },

    /** Change a domain's redirect (or clear it with nulls). Never a secret in
     *  this call's body or its error — redirect targets are host names only. */
    async updateDomain(projectId, name, { redirect, redirectStatusCode }) {
      const r = await request("PATCH", `/${VERSIONS.domainUpdate}/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(name)}`, { body: { redirect, redirectStatusCode } });
      if (!r.ok) throw fail(`update domain ${name}`, r);
      return r.json;
    },

    /** Attach a custom domain. "Already on this project" comes back as 400 and a
     *  domain on ANOTHER project as 409 — the first is adopted (re-run), the
     *  second is a real conflict the owner must resolve in that other project. */
    async addDomain(projectId, name) {
      const r = await request("POST", `/${VERSIONS.domainAdd}/projects/${encodeURIComponent(projectId)}/domains`, { body: { name } });
      if (r.status === HTTP_BAD_REQUEST) {
        const existing = (await this.listDomains(projectId)).find((d) => d.name === name);
        if (existing) return existing;
      }
      if (r.status === HTTP_CONFLICT) throw fail(`add domain ${name} — it is attached to ANOTHER Vercel project of this account (this cafe's old project, or another client). Remove it there (Vercel → that project → Settings → Domains), then run again. Nothing was changed.`, r, { codeOnly: true });
      if (!r.ok) throw fail(`add domain ${name}`, r);
      return r.json;
    },

    /** Re-check an unverified domain (the owner has since added the DNS/TXT
     *  record). A 400 WHILE still pending ("does not have a TXT record" / "does
     *  not match") is not an error for us — it just means "not yet"; only other
     *  failures throw. */
    async verifyDomain(projectId, name) {
      const r = await request("POST", `/${VERSIONS.domainVerify}/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(name)}/verify`);
      if (r.status === HTTP_BAD_REQUEST) {
        const reason = r.json && r.json.error && r.json.error.message ? r.json.error.message : "not verified yet";
        return { verified: false, pending: true, reason };
      }
      if (!r.ok) throw fail(`verify domain ${name}`, r);
      return r.json;
    },

    /** Batch upsert (?upsert=true → re-runs overwrite, never 409). A 2xx can still
     *  carry partial failures in `failed[]` — a silently missing env var is a
     *  broken deploy, so that is an error too (codes only). */
    async upsertEnv(projectId, envs) {
      if (envs.length === 0) return;
      const r = await request("POST", `/${VERSIONS.env}/projects/${encodeURIComponent(projectId)}/env`, { body: envs, query: { upsert: "true" } });
      if (!r.ok) throw fail(`set ${envs.length} env vars`, r, { codeOnly: true });
      const failed = r.json && Array.isArray(r.json.failed) ? r.json.failed : [];
      if (failed.length > 0) {
        const codes = failed.map((f) => (f.error && f.error.code) || "unknown").join(",");
        throw new Error(`vercel: ${failed.length}/${envs.length} env vars failed to save (${codes})`);
      }
    },
  };
}
