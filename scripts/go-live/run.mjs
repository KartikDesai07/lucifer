// scripts/go-live/run.mjs — the go-live flow for ONE cafe, with every side effect
// behind `deps` (fs / spawn / fetch / randomBytes / sleep / log) so run.test.mjs
// can drive it end to end against fakes. index.mjs wires the real deps.
//
//   validate → seed the cafe's DB → Vercel project (create-or-adopt) → host/tenant
//   → env vars → deploy.profiles.json → `scripts/deploy.mjs --profile <slug>`
//   → GET /api/health → summary
//
// Idempotent by construction: every step checks before it creates, secrets are
// minted once and saved back into the client file, and a re-run after a failure
// simply continues. Nothing here prints a token, a URI or a password.

import path from "node:path";
import {
  buildEnv, DEFAULT_ROOT_DOMAIN, FRAMEWORK, healthVerdict, mergeProfile, migrateHosting, mintSecrets, PRIMARY_HOST,
  profileNameForHost, projectNameForHost, ROOT_DIRECTORY, tenantOf, validateClient, VERCEL_APP_SUFFIX,
} from "./lib.mjs";
import { createVercelApi } from "./vercel-api.mjs";
import { GoLiveError, HEALTH_ATTEMPTS, HEALTH_INTERVAL_MS, PROFILES_FILE, readJson, readPlatform, saveClient, slotOf, writeJson } from "./core.mjs";
import { applyVercelAppRedirects, checkPlatformHealth, clearVercelAppRedirects, ensureWebAddress, siblingSubdomainClash } from "./web-address.mjs";

export { GoLiveError, HEALTH_ATTEMPTS, HEALTH_INTERVAL_MS, PROFILES_FILE, readJson, writeJson, readPlatform, slotOf, saveClient } from "./core.mjs";

function seedDatabase(deps, root, clientPath, client) {
  deps.log("▶ seeding the cafe's database (settings · admin · tables · menu) — existing data is never overwritten");
  // node + tsx directly (what `npm run seed:client` does) — npm's `--` argument
  // passing is unreliable from PowerShell on Windows, so npm stays out of the chain.
  const res = deps.spawn(process.execPath, ["--import", "tsx", path.join(root, "apps", "cafe", "scripts", "seed-client.ts"), "--file", clientPath], {
    cwd: path.join(root, "apps", "cafe"),
    env: {
      ...deps.env,
      MONGODB_URI: client.mongodbUri,
      SEED_ADMIN_USERNAME: client.admin.username,
      SEED_ADMIN_PASSWORD: client.admin.password,
    },
  });
  if (res.status !== 0) {
    throw new GoLiveError("seeding failed — nothing was created on Vercel", {
      step: "seed",
      hint: "check mongodbUri (user/password, and that it ends with the database name) and that Atlas Network Access allows this machine (0.0.0.0/0 is what Vercel needs anyway)",
    });
  }
}

/** ONE project per client, forever: the project this client already created is
 *  looked up by its recorded ID first, whatever the file's name field says now
 *  (a renamed `vercel.project` or slug must never spawn a second project and a
 *  second URL). Only when nothing is recorded — or the recorded project was
 *  deleted in Vercel — does the name lookup / creation path run. */
async function ensureProject(deps, api, client, slot) {
  const recordedId = slot.gen.projectId;
  if (recordedId) {
    const recorded = await api.getProject(recordedId);
    if (recorded) {
      const wanted = projectNameForHost(client, slot.label);
      if (recorded.name !== wanted) deps.log(`▶ file names the project "${wanted}" but this host's live project is "${recorded.name}" (${recorded.id}) — keeping the live one; rename only in Vercel`);
      else deps.log(`▶ Vercel project "${recorded.name}" (${recorded.id}) — using it`);
      return { ...recorded, created: false };
    }
    deps.log(`▶ recorded project ${recordedId} is not reachable with this token — looking it up by name`);
  }
  const name = projectNameForHost(client, slot.label);
  const existing = await api.getProject(name);
  if (existing) {
    const detached = slot.gen.previousHosting || [];
    // Path B of "Move hosting" forgot this project on purpose: re-adopting it would
    // silently undo the move. Stop; the owner pastes the NEW account's token first.
    if (detached.some((h) => h.projectId === existing.id)) throw new GoLiveError(`"${name}" (${existing.id}) is the project you DETACHED with "Move hosting" — this token still reaches the OLD account`, { step: "project", hint: "paste a token from the NEW Vercel account (and its Team id) into Hosting, Save, then run again; or restore the old hosting by putting the token of the old account back and pressing Update" });
    deps.log(`▶ Vercel project "${name}" already exists — using it`);
    return { ...existing, created: false };
  }
  // A recorded project that this token cannot see AND no project of that name here:
  // most likely a wrong token / team id, not an intent to start over. Creating a
  // second project would mean a second URL — refuse; path B (detach) is the explicit
  // way to start fresh.
  if (recordedId) throw new GoLiveError(`this client's project ${recordedId} is not reachable with this token, and the account has no project named "${name}"`, { step: "project", hint: "wrong token or Team id? Fix Hosting and run again. Moving accounts on purpose? Use More → Move hosting (path A after a Vercel transfer, or path B to start a fresh project)." });
  deps.log(`▶ creating Vercel project "${name}" (Next.js · Root Directory ${ROOT_DIRECTORY})`);
  const created = await api.createProject(name, { framework: FRAMEWORK, rootDirectory: ROOT_DIRECTORY });
  return { ...created, created: true };
}

function runDeploy(deps, root, slug, preview) {
  const args = [path.join(root, "scripts", "deploy.mjs"), "--profile", slug];
  if (preview) args.push("--preview");
  deps.log(`▶ deploying (${preview ? "PREVIEW" : "PRODUCTION"}) via scripts/deploy.mjs --profile ${slug}`);
  const res = deps.spawn(process.execPath, args, { cwd: root, env: deps.env });
  if (res.status !== 0) throw new GoLiveError("the Vercel deploy failed — read the build log above", { step: "deploy", hint: `fix the cause, then re-run; or redeploy alone with: npm run deploy -- --profile ${slug}` });
}

async function checkHealth(deps, host, tenantId) {
  deps.log(`▶ checking https://${host}/api/health`);
  let last = { ok: false, reason: "no response" };
  for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1) {
    try {
      const res = await deps.fetch(`https://${host}/api/health`, { headers: { accept: "application/json" } });
      const body = await res.json().catch(() => null);
      last = healthVerdict(res.status, body, tenantId);
      if (last.ok) return last;
    } catch (err) {
      last = { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    if (attempt < HEALTH_ATTEMPTS) await deps.sleep(HEALTH_INTERVAL_MS);
  }
  return last;
}

/** The database name a mongodb(+srv):// URI points at. */
function dbNameOf(uri) {
  const m = typeof uri === "string" ? uri.match(/^mongodb(?:\+srv)?:\/\/[^/?]+\/([^/?]+)/) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * DEMO ONLY: drop the demo cafe's database and seed it fresh from the file.
 * Guards here AND in apps/cafe/scripts/reset-demo-db.ts (demo flag, typed slug,
 * database name) — the child re-checks everything it is handed. Vercel is not
 * touched: same project, same URL, same env.
 */
export async function runResetDemo({ root, clientPath, confirm, confirmDb }, deps) {
  const client = readJson(deps, clientPath, null);
  if (!client) throw new GoLiveError(`client file not found: ${clientPath}`, { step: "read" });
  if (client.demo !== true) throw new GoLiveError(`"${client.slug}" is not marked as a demo client — a live cafe's database is never reset from here`, { step: "guard", hint: "Status → Safety → tick 'Demo client' and Save, if this really is a demo" });
  if (typeof confirm !== "string" || confirm !== client.slug) throw new GoLiveError("the typed confirmation does not equal the client's slug", { step: "guard" });
  const dbName = dbNameOf(client.mongodbUri);
  if (!dbName) throw new GoLiveError("mongodbUri has no database name", { step: "guard" });
  // The caller names the database it showed the owner; a URI changed since then fails here, not after the drop.
  if (typeof confirmDb !== "string" || confirmDb !== dbName) throw new GoLiveError(`the confirmed database "${confirmDb ?? ""}" is not the one the file points at ("${dbName}")`, { step: "guard", hint: "reload the console and start the reset again so the shown database matches the saved file" });
  // A broken file (weak admin password, no cafe name…) would fail the seeder AFTER the drop — validate first.
  const problems = validateClient(client);
  if (problems.length) throw new GoLiveError(`the client file has ${problems.length} problem(s) — fix them first, the seeder would fail after the drop:\n  - ${problems.join("\n  - ")}`, { step: "guard" });
  deps.log(`▶ RESET DEMO "${client.slug}": dropping database "${dbName}" and seeding it fresh (settings · admin · tables · menu)`);
  const res = deps.spawn(process.execPath, ["--import", "tsx", path.join(root, "apps", "cafe", "scripts", "reset-demo-db.ts"), "--file", clientPath], {
    cwd: path.join(root, "apps", "cafe"),
    env: { ...deps.env, MONGODB_URI: client.mongodbUri, SEED_ADMIN_USERNAME: client.admin.username, SEED_ADMIN_PASSWORD: client.admin.password, RESET_CONFIRM_SLUG: confirm, RESET_CONFIRM_DB: confirmDb },
  });
  if (res.status !== 0) throw new GoLiveError("the demo reset failed — the database may already be dropped and only partly seeded", { step: "reset", hint: "fix the cause shown above and run the reset again: it drops and seeds from scratch" });
  client.generated = { ...(client.generated ?? {}), seededAt: new Date(deps.now ? deps.now() : Date.now()).toISOString() };
  saveClient(deps, clientPath, client, slotOf(client, PRIMARY_HOST));
  return { slug: client.slug, dbName, host: client.generated.host ?? null, adminUsername: client.admin.username.toLowerCase() };
}

/**
 * DEMO ONLY: drop the demo cafe's database and rebuild it with a month of
 * realistic demo data — menu with photos, customers, orders, dues, events,
 * reservations, self-order requests. Same three guards as `runResetDemo`
 * (demo flag, typed slug, database name) plus `imagesDir` (optional — when
 * given it must exist on THIS pc, or the child would fail after the drop).
 * Vercel is not touched: same project, same URL, same env.
 */
export async function runSeedDemo({ root, clientPath, confirm, confirmDb, imagesDir }, deps) {
  const client = readJson(deps, clientPath, null);
  if (!client) throw new GoLiveError(`client file not found: ${clientPath}`, { step: "read" });
  if (client.demo !== true) throw new GoLiveError(`"${client.slug}" is not marked as a demo client — a live cafe's database is never seeded from here`, { step: "guard", hint: "Status → Safety → tick 'Demo client' and Save, if this really is a demo" });
  if (typeof confirm !== "string" || confirm !== client.slug) throw new GoLiveError("the typed confirmation does not equal the client's slug", { step: "guard" });
  const dbName = dbNameOf(client.mongodbUri);
  if (!dbName) throw new GoLiveError("mongodbUri has no database name", { step: "guard" });
  // The caller names the database it showed the owner; a URI changed since then fails here, not after the drop.
  if (typeof confirmDb !== "string" || confirmDb !== dbName) throw new GoLiveError(`the confirmed database "${confirmDb ?? ""}" is not the one the file points at ("${dbName}")`, { step: "guard", hint: "reload the console and start the seed again so the shown database matches the saved file" });
  // A broken file (weak admin password, no cafe name…) would fail the seeder AFTER the drop — validate first.
  const problems = validateClient(client);
  if (problems.length) throw new GoLiveError(`the client file has ${problems.length} problem(s) — fix them first, the seeder would fail after the drop:\n  - ${problems.join("\n  - ")}`, { step: "guard" });
  if (imagesDir !== undefined && imagesDir !== null && !deps.fs.existsSync(imagesDir)) throw new GoLiveError(`the images folder does not exist on this PC: ${imagesDir}`, { step: "guard" });
  deps.log(`▶ SEED DEMO "${client.slug}": dropping database "${dbName}" and building 31 days of demo data (menu · photos · customers · orders · dues · events · reservations)`);
  const imageEnv = client.image && client.image.store === "r2"
    ? { R2_ACCOUNT_ID: client.image.accountId, R2_ACCESS_KEY_ID: client.image.accessKeyId, R2_SECRET_ACCESS_KEY: client.image.secretAccessKey, R2_BUCKET: client.image.bucket, NEXT_PUBLIC_R2_PUBLIC_BASE_URL: client.image.publicBaseUrl }
    : {};
  const res = deps.spawn(process.execPath, ["--import", "tsx", path.join(root, "apps", "cafe", "scripts", "seed-demo", "index.ts"), "--file", clientPath], {
    cwd: path.join(root, "apps", "cafe"),
    env: {
      ...deps.env,
      MONGODB_URI: client.mongodbUri,
      SEED_ADMIN_USERNAME: client.admin.username,
      SEED_ADMIN_PASSWORD: client.admin.password,
      RESET_CONFIRM_SLUG: confirm,
      RESET_CONFIRM_DB: confirmDb,
      ...(imagesDir ? { DEMO_IMAGES_DIR: imagesDir } : {}),
      ...imageEnv,
    },
  });
  if (res.status !== 0) throw new GoLiveError("the demo seed failed — the database may be dropped and only partly built", { step: "seed-demo", hint: "fix the cause shown above and run it again: it drops and rebuilds from scratch" });
  client.generated = { ...(client.generated ?? {}), seededAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(), demoSeededAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(), demoImagesDir: imagesDir ?? null };
  saveClient(deps, clientPath, client, slotOf(client, PRIMARY_HOST));
  return { slug: client.slug, dbName, host: client.generated.host ?? null, adminUsername: client.admin.username.toLowerCase(), imagesDir: imagesDir ?? null };
}

/**
 * Run the whole flow. `opts`: { root, clientPath, preview, skipSeed, dryRun }.
 * Returns a summary object (index.mjs prints it). Throws GoLiveError on a step
 * failure — the client file already carries everything learned so far.
 */
export async function runGoLive(opts, deps) {
  const { root, clientPath } = opts;
  let client = readJson(deps, clientPath, null);
  if (!client) throw new GoLiveError(`client file not found: ${clientPath}`, { step: "read", hint: "copy scripts/go-live/client.example.json to clients/<name>.json and fill it in" });
  const platform = readPlatform(deps, clientPath);
  ({ client } = migrateHosting(client, platform));
  const errors = validateClient(client, platform);
  if (errors.length) throw new GoLiveError(`the client file has ${errors.length} problem(s):\n  - ${errors.join("\n  - ")}`, { step: "validate" });

  const slug = client.slug;
  const slot = slotOf(client, opts.host);
  const projectName = projectNameForHost(client, slot.label);
  const profileName = profileNameForHost(slug, slot.label);
  // The console's "Lock deploys" is honoured here too, so the CLI cannot be the
  // back door (a dry run stays allowed — it changes nothing).
  if (client.deployLock === true && !opts.dryRun) throw new GoLiveError(`deploys are locked for "${slug}" (deployLock: true in the client file)`, { step: "guard", hint: "untick 'Lock deploys' in the console (Status → Safety) and Save, if this deploy is intended" });
  const dryRunHost = slot.isPrimary && client.subdomain && platform ? `${client.subdomain}.${platform.apexDomain}` : `<${projectName}[-suffix]>.vercel.app`;
  if (opts.dryRun) {
    return { dryRun: true, slug, hostLabel: slot.label, projectName, host: dryRunHost, steps: [...(slot.isPrimary ? ["seed"] : []), "project", ...(slot.isPrimary && client.subdomain ? ["address"] : []), "env", "profile", "deploy", "health"] };
  }
  // Sibling guard (primary only): another client file claiming the same subdomain
  // would mean two cafes fighting over one Vercel domain attach.
  if (slot.isPrimary && client.subdomain) {
    const clash = siblingSubdomainClash(deps, clientPath, client.subdomain);
    if (clash) throw new GoLiveError(`"${client.subdomain}.${platform.apexDomain}" is already the address of client "${clash}"`, { step: "guard" });
  }
  if (!slot.isPrimary) {
    deps.log(`▶ STANDBY host "${slot.label}": same database, images and secrets as the primary — only the Vercel account differs. The web address stays on the primary.`);
    // A standby mirrors a cafe that exists: the primary must have seeded the database first.
    if (!(client.generated && client.generated.seededAt)) throw new GoLiveError(`the primary of "${slug}" has never been seeded — a standby would publish an empty cafe`, { step: "guard", hint: "go live on the primary first (it seeds settings, admin, tables, menu), then deploy the standby" });
    // "<slug>-<label>" is this standby's project AND deploy-profile name — it must not be another client's slug
    // (a sibling file in the same clients folder; the separator style of clientPath is kept as-is).
    const clash = clientPath.replace(/[^\\/]+$/, `${profileName}.json`);
    if (deps.fs.existsSync(clash)) throw new GoLiveError(`standby "${slot.label}" would use the name "${profileName}", which is another client's slug (clients/${profileName}.json exists)`, { step: "guard", hint: "rename the standby label so <slug>-<label> is unique" });
  }

  if (!opts.skipSeed && slot.isPrimary) {
    seedDatabase(deps, root, clientPath, client);
    // From here on the cafe's settings, admin, tables and menu live in the
    // DATABASE — the console shows this date and locks those fields as "record
    // only" (a re-seed never overwrites, so editing them would change nothing).
    client.generated = { ...(client.generated ?? {}), seededAt: new Date(deps.now ? deps.now() : Date.now()).toISOString() };
    saveClient(deps, clientPath, client, slot);
  } else if (!slot.isPrimary) {
    deps.log("▶ seed skipped — a standby shares the primary's database");
  }

  const api = createVercelApi({ token: slot.vercel.token, teamId: slot.vercel.teamId ?? undefined, fetch: deps.fetch });
  const user = await api.getUser();
  deps.log(`▶ Vercel account: ${user.username}${user.email ? ` (${user.email})` : ""}${slot.isPrimary ? "" : ` — standby "${slot.label}"`}`);
  // A standby only makes sense in ANOTHER account: if this token can see the
  // primary's project, the owner pasted the primary token by mistake — stop before
  // a "<slug>-<label>" duplicate is created next to the live project.
  if (!slot.isPrimary && client.generated && client.generated.projectId && !slot.gen.projectId) {
    const seesPrimary = await api.getProject(client.generated.projectId);
    if (seesPrimary) throw new GoLiveError(`the token of standby "${slot.label}" reaches the PRIMARY's account (it can see project ${client.generated.projectId})`, { step: "guard", hint: "a standby is a DIFFERENT Vercel account — create one, make a token there, paste it into this standby and run again" });
  }

  const project = await ensureProject(deps, api, client, slot);
  slot.gen = { ...slot.gen, projectId: project.id, orgId: project.accountId, projectName: project.name };
  saveClient(deps, clientPath, client, slot);

  // Written IMMEDIATELY the project exists, not only once env/deploy finish: an
  // interrupted run (console closed, PC restarted) still leaves this client
  // redeployable by name from this moment on — "Redeploy" in the console
  // resolves the same profile a completed run would have written. The later
  // write (below, once the env is known) is the idempotent, fuller pass — this
  // one is deliberately redundant with it, same fields, so neither can drift.
  const profilesPath = path.join(root, PROFILES_FILE);
  writeJson(deps, profilesPath, mergeProfile(readJson(deps, profilesPath, {}), profileName, { orgId: project.accountId, projectId: project.id, token: slot.vercel.token, teamId: slot.vercel.teamId ?? null }));

  const domains = await api.listDomains(project.id);
  // The *.vercel.app shape (re-read from Vercel every run — the file's label can be
  // stale, see pickVercelDomain) and what serves the cafe RIGHT NOW: a recorded
  // platform host if the cafe already lives at <sub>.<apex>, else that shape.
  const vercelShape = tenantOf({ ...client, subdomain: null }, domains, project.name);
  const recordedPlatform = slot.isPrimary && slot.gen.host && slot.gen.rootDomain && slot.gen.rootDomain !== DEFAULT_ROOT_DOMAIN
    ? { tenantId: slot.gen.tenantId, rootDomain: slot.gen.rootDomain, host: slot.gen.host, shape: "platform" } : null;
  const current = recordedPlatform ?? vercelShape;
  const target = tenantOf(client, domains, project.name, slot.isPrimary ? platform : null);
  // Default: the *.vercel.app shape (legacy cafes, and the REVERT path). A platform
  // target that is not ready yet keeps `current` — whatever serves today, never a
  // different host (a renamed address must not drop the cafe back to *.vercel.app).
  let tenant = vercelShape;
  let switched = false;
  let held = false;
  let web = null;
  let addressPending = false; // a NEW project deployed straight onto the address while its DNS is still missing
  const previousHost = slot.gen.host ?? null;

  if (target && target.shape === "platform") {
    web = await ensureWebAddress(deps, api, project, target, platform, { knownTenants: [target.tenantId, slot.gen.tenantId, current ? current.tenantId : null] });
    const alreadyOn = slot.gen.host === target.host && slot.gen.tenantId === target.tenantId;
    // Nothing serves yet when the project is brand new, has no host at all (adopted
    // but never deployed: no *.vercel.app name listed), or Vercel itself reports no
    // production deployment (docs 2026-09-13: GET /v9/projects/{id} → targets.production
    // is null until the first prod deploy) — the gate protects a SERVING host, so with
    // none to protect the address is taken straight away. `hasProduction === null`
    // (the field was absent) is unknown, not "empty" — treated as "serves", conservatively.
    const nothingServes = project.created || current === null || project.hasProduction === false;
    if (nothingServes || alreadyOn || web.state === "ready") {
      tenant = target;
      switched = !alreadyOn && !nothingServes && web.state === "ready";
      addressPending = web.state !== "ready";
    } else {
      held = true;
      tenant = current;
      deps.log(`▶ HOLD: ${target.host} is not ready (${web.state}) — TENANT_ID stays on ${current ? current.host : "the *.vercel.app address"}; nothing about the address changes this run`);
    }
    // `live` is re-earned by this run's health check below; only a host that is
    // already switched keeps its flag meanwhile (a transient health miss must not
    // make the console say "press Update to switch" about an address that serves).
    slot.gen = { ...slot.gen, webAddress: { ...web, held, servingHost: held && current ? current.host : null, live: Boolean(alreadyOn && slot.gen.webAddress && slot.gen.webAddress.live), redirects: (slot.gen.webAddress && slot.gen.webAddress.redirects) ?? [], checkedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString() } };
    saveClient(deps, clientPath, client, slot);
  } else if (slot.gen.webAddress) {
    // REVERT: the owner cleared the subdomain — drop the redirects FIRST, or the
    // old address would 308 into what is now a dead host (a redirect loop to 404).
    await clearVercelAppRedirects(api, project.id, domains, slot.gen.webAddress.host);
    deps.log(`▶ reverting to ${vercelShape ? vercelShape.host : "the *.vercel.app address"}: redirects removed; ${slot.gen.webAddress.host} stays attached (remove it in Vercel → Domains if you like)`);
    const { webAddress, ...restGen } = slot.gen;
    slot.gen = { ...restGen, previousWebAddress: { host: webAddress.host, revertedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString() } };
    saveClient(deps, clientPath, client, slot);
  }

  const needsSecondDeploy = tenant === null;
  if (needsSecondDeploy) {
    deps.log("▶ Vercel has not listed the project's *.vercel.app domain yet — deploying first, then pinning TENANT_ID and deploying again");
    tenant = { tenantId: null, rootDomain: "vercel.app", host: null, shape: "vercel" };
  } else {
    if (previousHost && previousHost !== tenant.host) deps.log(`▶ host changed: ${previousHost} → ${tenant.host} — TENANT_ID is updated to match (the old address will 404, that is expected)`);
    deps.log(`▶ host ${tenant.host} → TENANT_ID=${tenant.tenantId} ROOT_DOMAIN=${tenant.rootDomain}`);
  }

  // Secrets are SHARED across hosts (minted once, on the primary's `generated`):
  // the same auth secret means a login on one host is valid on the other.
  client.generated = mintSecrets(client.generated, deps.randomBytes);
  saveClient(deps, clientPath, client, slot);

  const envs = buildEnv(client, tenant, client.generated);
  deps.log(`▶ saving ${envs.length} environment variables on the project (${envs.map((e) => e.key).join(", ")})`);
  await api.upsertEnv(project.id, envs);

  const profiles = mergeProfile(readJson(deps, profilesPath, {}), profileName, { orgId: project.accountId, projectId: project.id, token: slot.vercel.token, teamId: slot.vercel.teamId ?? null });
  writeJson(deps, profilesPath, profiles);
  deps.log(`▶ deploy profile "${profileName}" written to ${PROFILES_FILE} (later updates: npm run deploy -- --profile ${profileName})`);

  runDeploy(deps, root, profileName, Boolean(opts.preview));

  if (needsSecondDeploy) {
    tenant = tenantOf({ ...client, subdomain: null }, await api.listDomains(project.id), project.name);
    if (!tenant) throw new GoLiveError("Vercel still lists no *.vercel.app domain for the project", { step: "domain", hint: "open the project in Vercel → Domains, then set TENANT_ID to that domain's first label and redeploy" });
    deps.log(`▶ host ${tenant.host} → TENANT_ID=${tenant.tenantId}; saving and deploying once more`);
    await api.upsertEnv(project.id, buildEnv(client, tenant, client.generated).filter((e) => e.key === "TENANT_ID" || e.key === "ROOT_DOMAIN"));
    runDeploy(deps, root, profileName, Boolean(opts.preview));
  }

  slot.gen = { ...slot.gen, host: tenant.host, tenantId: tenant.tenantId, rootDomain: tenant.rootDomain };
  saveClient(deps, clientPath, client, slot);

  let health = { ok: null, reason: "skipped (preview deploys serve on a different host — judge by the build log)" };
  if (!opts.preview && addressPending) {
    // Nothing to poll yet: the address has no DNS. The records are in the summary;
    // the next run (or Check DNS & verify) completes the health check and the redirect.
    health = { ok: null, reason: `skipped — waiting for the DNS records of ${tenant.host} (add them, then run again or press Check DNS & verify)` };
  } else if (!opts.preview) {
    health = tenant.shape === "platform" ? await checkPlatformHealth(deps, tenant.host, tenant.tenantId, platform.apexDomain) : await checkHealth(deps, tenant.host, tenant.tenantId);
  }

  let redirects = [];
  if (tenant.shape === "platform" && health.ok) {
    // Point the *.vercel.app names at the address (old printed QR codes, bookmarks
    // and the desktop shell keep working); a redirect failure never fails the run.
    // A RENAMED address (A.<apex> → B.<apex>) redirects the old name too — it stays attached and would otherwise answer 404.
    const oldPlatformHost = previousHost && previousHost !== tenant.host && !previousHost.endsWith(VERCEL_APP_SUFFIX) ? [previousHost] : [];
    redirects = await applyVercelAppRedirects(deps, api, project.id, tenant.host, oldPlatformHost);
    slot.gen = { ...slot.gen, webAddress: { ...slot.gen.webAddress, live: true, redirects, checkedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString() } };
  }
  slot.gen = { ...slot.gen, host: tenant.host, tenantId: tenant.tenantId, rootDomain: tenant.rootDomain };
  saveClient(deps, clientPath, client, slot);

  return {
    dryRun: false,
    slug,
    hostLabel: slot.label,
    account: user.username,
    projectName: project.name,
    projectId: project.id,
    host: tenant.host,
    url: `https://${tenant.host}`,
    tenantId: tenant.tenantId,
    rootDomain: tenant.rootDomain,
    adminUsername: client.admin.username.toLowerCase(),
    // The seeder creates the admin ONLY when none exists; a later password change
    // in the file is not applied (the client changes it in the POS).
    adminNote: !slot.isPrimary ? "shared with the primary (not seeded from a standby)" : opts.skipSeed ? "not seeded this run" : "set on the FIRST seed only",
    envCount: envs.length,
    imageStore: client.image ? client.image.store : "none",
    health,
    dns: { pending: false },
    redeploy: `npm run deploy -- --profile ${profileName}`,
    webAddress: web ? { ...web, live: tenant.shape === "platform" && Boolean(health.ok), redirects } : null,
    switched,
    held,
    previousHost: switched ? previousHost : null,
  };
}
