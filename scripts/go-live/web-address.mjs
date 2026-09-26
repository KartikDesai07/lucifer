// scripts/go-live/web-address.mjs — attaching/checking a platform subdomain
// (`<subdomain>.<apex>`) on a Vercel project: adopt-or-attach, ask Vercel to
// verify, read its DNS-config verdict, and cross-check the DNS the owner
// actually published (deps.dnsCheck — never the machine's cached resolver).
// Pulled out of run.mjs to keep both files under the house line limit.
//
// Never deletes a Vercel domain or DNS record. Never logs a token, URI or
// password — only host names and Vercel's own error codes/messages.

import path from "node:path";
import { migrateHosting, PRIMARY_HOST, projectNameForHost, tenantOf, VERCEL_CNAME_TARGET, validateClient, webAddressRecords, healthVerdict } from "./lib.mjs";
import { createVercelApi } from "./vercel-api.mjs";
import { GoLiveError, HEALTH_ATTEMPTS, HEALTH_INTERVAL_MS, readJson, readPlatform, saveClient, slotOf } from "./core.mjs";

const VERCEL_APP_SUFFIX = ".vercel.app";
const REDIRECT_STATUS_CODE = 308;
/** Sub-folder of the clients folder holding archived records (ui-server.mjs ARCHIVE_DIR). */
const ARCHIVE_DIR = "_archive";

const STATE = {
  ready: "ready",
  pendingVerify: "pending-verify",
  pendingDns: "pending-dns",
  pendingCert: "pending-cert",
  checkFailed: "check-failed", // Vercel's DNS-config endpoint did not answer — not a DNS verdict at all
  tenantMismatch: "tenant-mismatch", // the host answers, but as a tenant this project does not know
};

/** The Vercel-recommended CNAME target: the highest-ranked `recommendedCNAME`
 *  entry, else the documented fallback. */
function recommendedCnameOf(cfg) {
  const list = Array.isArray(cfg && cfg.recommendedCNAME) ? cfg.recommendedCNAME : [];
  if (list.length === 0) return VERCEL_CNAME_TARGET;
  const sorted = [...list].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  // Vercel may return the target as an absolute DNS name ("cname.vercel-dns.com.") — the
  // owner types it into GoDaddy without the trailing dot, and our own check compares without it.
  return String(sorted[0].value).replace(/\.+$/, "");
}

// Vercel's own verdict (`misconfigured:false` = configured AND a certificate can be
// issued) plus the verified flag plus OUR https probe decide readiness. The
// authoritative CNAME/TXT lookup is advisory (an A-record setup is valid for
// Vercel yet shows no CNAME) — it is shown to the owner, never gates the switch.
function stateOf({ verified, configured, reachable, hasTxtRow, answeredAs }) {
  if (verified && configured === true && reachable) return STATE.ready;
  if (configured === null) return STATE.checkFailed;
  if (hasTxtRow && !verified) return STATE.pendingVerify;
  if (configured !== true) return STATE.pendingDns;
  if (answeredAs) return STATE.tenantMismatch;
  return STATE.pendingCert;
}

/** Attach (or adopt) `target.host` on `project`, ask Vercel to verify it, read
 *  its DNS-config verdict, and cross-check the DNS the owner actually
 *  published. Returns the status object saved into `generated.webAddress` and
 *  used to decide HOLD vs switch in run.mjs. Never throws for a DNS miss —
 *  only a genuine Vercel API failure (attach conflict) raises. */
export async function ensureWebAddress(deps, api, project, target, platform, { knownTenants = [] } = {}) {
  let st = await api.getProjectDomain(project.id, target.host);
  if (!st) {
    try {
      st = await api.addDomain(project.id, target.host);
    } catch (err) {
      throw new GoLiveError(err instanceof Error ? err.message : String(err), { step: "domain", hint: "nothing changed" });
    }
  }

  if (!st.verified) {
    const v = await api.verifyDomain(project.id, target.host);
    if (v.verified) st = v;
    else st = { ...st, verified: false, verification: st.verification ?? [] };
  }

  const cfg = await api.getDomainConfig(target.host).catch(() => null);
  const configured = cfg ? !cfg.misconfigured : null;

  const records = webAddressRecords({
    subdomain: target.tenantId,
    apex: platform.apexDomain,
    recommendedCname: recommendedCnameOf(cfg),
    verification: st.verification,
  });
  const txtRow = records.find((r) => r.type === "TXT") ?? null;

  const dns = await deps.dnsCheck.checkRecords({ apex: platform.apexDomain, host: target.host, txt: txtRow }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));

  const probe = await deps.dnsCheck.probeHealth(target.host, platform.apexDomain);
  const probeTenant = probe.body && typeof probe.body.tenant === "string" ? probe.body.tenant : null;
  // Reachable = OUR project answered: the tenant it reports must be one this cafe is
  // known as (the target, the recorded one, or the *.vercel.app label). Any JSON with
  // a `tenant` field is not proof — another deployment or an edge error page could
  // answer at that IP, and switching TENANT_ID on that would take the cafe down.
  const known = knownTenants.filter((t) => typeof t === "string" && t.length > 0);
  const reachable = probe.status !== null && probeTenant !== null && known.includes(probeTenant);
  const answeredAs = probeTenant !== null && !reachable ? probeTenant : null;
  if (answeredAs) deps.log(`▶ ${target.host} answers as tenant "${answeredAs}" — not one of this cafe's ids (${known.join(", ")}); an Update on Vercel refreshes TENANT_ID, then check again`);

  const verified = Boolean(st.verified);
  const state = stateOf({ verified, configured, reachable, hasTxtRow: Boolean(txtRow), answeredAs });

  deps.log(`▶ address ${target.host}: attached · ${verified ? "verified" : "not verified"} · DNS ${dns && dns.cname && dns.cname.ok ? "ok" : "not ready"} · https ${reachable ? "ok" : "not ready"}`);

  return { host: target.host, verified, configured, configuredBy: cfg && typeof cfg.configuredBy === "string" ? cfg.configuredBy : null, reachable, probeTenant, records, dns, state };
}

/** Another client file (in the same clients folder) already claiming this
 *  subdomain — the name of that client's slug/file, or null. Skips `_*` files
 *  (the platform file) and `clientPath` itself. The separator style of
 *  `clientPath` is kept as-is (never `path.join`, which would normalise to the
 *  OS separator and could miss a `/`-given path — same gotcha as readPlatform). */
export function siblingSubdomainClash(deps, clientPath, subdomain) {
  const dir = path.dirname(clientPath);
  const self = path.basename(clientPath);
  const sep = clientPath.slice(dir.length, dir.length + 1);
  // Archived records count too: an archived cafe may still hold the Vercel attachment for its address.
  const archiveDir = `${dir}${sep}${ARCHIVE_DIR}`;
  const folders = [[dir, ""], ...(deps.fs.existsSync(archiveDir) ? [[archiveDir, " (archived)"]] : [])];
  for (const [folder, suffix] of folders) {
    for (const f of deps.fs.readdirSync(folder)) {
      if ((folder === dir && f === self) || f.startsWith("_") || !f.endsWith(".json")) continue;
      let other;
      try {
        other = JSON.parse(deps.fs.readFileSync(`${folder}${sep}${f}`, "utf8"));
      } catch {
        continue;
      }
      if (other && typeof other.subdomain === "string" && other.subdomain.toLowerCase() === subdomain.toLowerCase()) return `${f.slice(0, -".json".length)}${suffix}`;
    }
  }
  return null;
}

/** Drop the redirect on every *.vercel.app name of the project (revert path) —
 *  a PATCH failure here throws and stops the run, so a half-removed redirect
 *  never gets left in an inconsistent state. */
export async function clearVercelAppRedirects(api, projectId, domains, host) {
  for (const d of domains) {
    // Every name this tool pointed at the address (the *.vercel.app names, and an
    // older platform name after a rename) — matched by TARGET, so an owner's own
    // unrelated redirect is never touched.
    if (!(d.redirect === host && !d.gitBranch)) continue;
    try {
      await api.updateDomain(projectId, d.name, { redirect: null, redirectStatusCode: null });
    } catch (err) {
      throw new GoLiveError(`could not remove the redirect on ${d.name}; the address was NOT changed (${d.name} still serves)`, { step: "domain", hint: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** Point every *.vercel.app name of the project at `host` (a 308, never
 *  touching git-branch aliases) and verify each one actually redirects there
 *  (old printed QR codes, bookmarks, the desktop shell). A redirect PATCH
 *  failure is logged and skipped, never fatal — the old address just keeps
 *  serving directly until the owner retries. */
export async function applyVercelAppRedirects(deps, api, projectId, host, extraFrom = []) {
  const redirects = [];
  for (const d of await api.listDomains(projectId)) {
    const wanted = d.name.endsWith(VERCEL_APP_SUFFIX) || extraFrom.includes(d.name);
    if (!wanted || d.gitBranch || d.name === host) continue;
    if (d.redirect !== host) {
      await api.updateDomain(projectId, d.name, { redirect: host, redirectStatusCode: REDIRECT_STATUS_CODE }).catch((err) => deps.log(`▶ could not redirect ${d.name} → ${host}: ${err instanceof Error ? err.message : String(err)} (not fatal — the old address just keeps serving directly)`));
    }
    const r = await deps.fetch(`https://${d.name}/api/health`, { redirect: "manual" }).catch(() => null);
    const loc = r && r.headers ? r.headers.get("location") : null;
    const ok = Boolean(r && r.status >= 300 && r.status < 400 && loc && loc.startsWith(`https://${host}/`));
    const pathKept = ok ? loc === `https://${host}/api/health` : null;
    redirects.push({ from: d.name, ok, location: loc, pathKept });
  }
  return redirects;
}

/** The platform-shape health check: same retry loop as run.mjs's checkHealth,
 *  but through deps.dnsCheck.probeHealth (the authoritative-DNS path) instead
 *  of a fetch that trusts the machine's own resolver/cache. */
export async function checkPlatformHealth(deps, host, tenantId, apex) {
  deps.log(`▶ checking https://${host}/api/health`);
  let last = { ok: false, reason: "no response" };
  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    const probe = await deps.dnsCheck.probeHealth(host, apex);
    last = probe.error ? { ok: false, reason: probe.error } : healthVerdict(probe.status, probe.body, tenantId);
    if (last.ok) return last;
    if (attempt < HEALTH_ATTEMPTS) await deps.sleep(HEALTH_INTERVAL_MS);
  }
  return last;
}

/**
 * Re-check a client's web address without deploying anything — the console's
 * "Check DNS & verify" button and `--check-dns`. Read + migrate + validate,
 * then (only when there is something to check) call Vercel/DNS and persist
 * what was learned into `generated.webAddress`.
 */
export async function checkWebAddress({ clientPath }, deps) {
  const client = readJson(deps, clientPath, null);
  if (!client) throw new GoLiveError(`client file not found: ${clientPath}`, { step: "read" });
  const platform = readPlatform(deps, clientPath);
  const { client: migrated } = migrateHosting(client, platform);
  const errors = validateClient(migrated, platform);
  if (errors.length) throw new GoLiveError(`the client file has ${errors.length} problem(s):\n  - ${errors.join("\n  - ")}`, { step: "validate" });

  if (!migrated.subdomain) return { state: "no-subdomain", message: "no web address is set for this client yet — add one in Hosting and save" };
  if (!(migrated.generated && migrated.generated.projectId)) return { state: "no-project", message: "this client has not been deployed yet — go live first, then check the address" };

  const slot = slotOf(migrated, PRIMARY_HOST);
  const api = createVercelApi({ token: slot.vercel.token, teamId: slot.vercel.teamId ?? undefined, fetch: deps.fetch });
  const project = { id: migrated.generated.projectId, name: migrated.generated.projectName ?? projectNameForHost(migrated, PRIMARY_HOST), accountId: migrated.generated.orgId, created: false };
  const target = tenantOf(migrated, [], project.name, platform);
  const web = await ensureWebAddress(deps, api, project, target, platform, { knownTenants: [target.tenantId, slot.gen.tenantId] });

  const existing = slot.gen.webAddress;
  // `live` = the cafe is switched to this address AND it answers as this cafe. A
  // run earns it through its health check; this check earns it too when the
  // record already points TENANT_ID/host at this very address and the https
  // probe answered as that tenant — proven, not assumed (a still-HELD address
  // whose tenant is not switched yet stays "ready", never "live").
  const switchedHere = web.state === "ready" && slot.gen.host === web.host && typeof web.probeTenant === "string" && web.probeTenant === slot.gen.tenantId;
  slot.gen = { ...slot.gen, webAddress: { ...existing, ...web, live: Boolean((existing && existing.live && existing.host === web.host) || switchedHere), checkedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString() } };
  saveClient(deps, clientPath, migrated, slot);

  return { ...web, live: slot.gen.webAddress.live, records: web.records };
}
