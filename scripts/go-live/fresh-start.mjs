// scripts/go-live/fresh-start.mjs — "Fresh start on Vercel": delete the client's
// Vercel project (its deployments, env vars, custom domains and *.vercel.app
// names) and deploy fresh into the SAME account under the same name. Database,
// images, admin/staff logins and secrets are untouched — only the hosting is
// rebuilt. Guards run in order and NOTHING is deleted until every one passes.
//
// Never logs a token, URI or password — only host/project names and Vercel's
// own error codes.

import path from "node:path";
import { migrateHosting, PRIMARY_HOST, projectNameForHost, validateClient } from "./lib.mjs";
import { createVercelApi } from "./vercel-api.mjs";
import { GoLiveError, PROFILES_FILE, readJson, readPlatform, saveClient, slotOf, writeJson } from "./core.mjs";
import { runGoLive } from "./run.mjs";
import { isFinished as rolloutFinished, loadRollout, pidAlive, readRolloutLock } from "./rollout.mjs";

export const DELETE_WAIT_ATTEMPTS = 10;
export const DELETE_WAIT_MS = 2_000;

/**
 * Delete the primary's recorded Vercel project and deploy fresh into the same
 * account. `opts`: { root, clientPath, confirm, confirmProject }. Returns
 * runGoLive's summary extended with `{ freshStart: true, deletedProject }`.
 */
export async function runFreshStart({ root, clientPath, confirm, confirmProject }, deps) {
  let client = readJson(deps, clientPath, null);
  if (!client) throw new GoLiveError(`client file not found: ${clientPath}`, { step: "read" });
  const platform = readPlatform(deps, clientPath);
  ({ client } = migrateHosting(client, platform));
  const errors = validateClient(client, platform);
  if (errors.length) throw new GoLiveError(`the client file has ${errors.length} problem(s):\n  - ${errors.join("\n  - ")}`, { step: "validate" });

  const slug = client.slug;
  const slot = slotOf(client, PRIMARY_HOST);

  // Guards — order pinned: NOTHING is deleted before every one of these passes.
  if (client.deployLock === true) throw new GoLiveError(`deploys are locked for "${slug}" (deployLock: true in the client file)`, { step: "guard", hint: "untick 'Lock deploys' in the console (Status → Safety) and Save, if this is intended" });
  if (!slot.gen.projectId) throw new GoLiveError("nothing to clean up — this client has no Vercel project yet; Go live creates one", { step: "guard" });
  if (confirm !== slug) throw new GoLiveError("the typed confirmation does not equal the client's slug", { step: "guard" });
  const recordedProjectName = slot.gen.projectName ?? projectNameForHost(client, PRIMARY_HOST);
  if (confirmProject !== recordedProjectName) throw new GoLiveError("the typed project name does not equal the recorded project", { step: "guard" });

  // A rollout (console or CLI --deploy-all) redeploys by profile name — deleting the
  // profile / project under it would hand it a dead target. Same guard the console applies.
  const clientsDir = path.dirname(clientPath);
  const lock = readRolloutLock(deps.fs, clientsDir, path.join);
  if (lock && (deps.isAlive ?? pidAlive)(lock.pid)) throw new GoLiveError(`a rollout is running (${lock.owner ?? "another process"}, pid ${lock.pid}) — wait for it to finish`, { step: "guard" });
  const rollout = loadRollout(deps.fs, clientsDir, path.join);
  if (rollout && !rolloutFinished(rollout)) throw new GoLiveError("a rollout is unfinished (see Rollouts in the console) — resume or cancel and dismiss it first", { step: "guard" });

  const api = createVercelApi({ token: slot.vercel.token, teamId: slot.vercel.teamId ?? undefined, fetch: deps.fetch });
  const user = await api.getUser();
  deps.log(`▶ Vercel account: ${user.username}${user.email ? ` (${user.email})` : ""}`);

  const project = await api.getProject(slot.gen.projectId);
  if (!project) throw new GoLiveError(`project ${slot.gen.projectId} is not reachable with this token — nothing was deleted (wrong token or Team id? or already gone: use More → Move hosting)`, { step: "guard" });
  // The record and Vercel must AGREE on which project this id is: a mis-copied id
  // (another client's project) must never be deleted on the strength of our own file.
  if (String(project.name).toLowerCase() !== String(recordedProjectName).toLowerCase()) throw new GoLiveError(`Vercel says project ${project.id} is named "${project.name}", but this record says "${recordedProjectName}" — nothing was deleted. Fix the record (Hosting → Vercel project) or use More → Move hosting.`, { step: "guard" });

  const domains = await api.listDomains(project.id);
  const domainNames = domains.map((d) => d.name);
  deps.log(`▶ FRESH START: deleting Vercel project ${project.name} (${project.id}) and with it ${domainNames.length} domain name(s): ${domainNames.join(", ")} — its env vars and deployments go too. Database, images and logins are NOT touched.`);
  if (slot.gen.realtime) deps.log(`▶ the realtime Worker (${slot.gen.realtime.workerName}) lives in Cloudflare, not Vercel — it is untouched; the run below reprovisions its env on the new project`);

  await api.deleteProject(project.id);

  // Deletion may take a moment to be visible — poll until Vercel agrees it is gone.
  let gone = false;
  for (let attempt = 1; attempt <= DELETE_WAIT_ATTEMPTS; attempt += 1) {
    let still;
    try {
      still = await api.getProject(project.id); // 404/410 → null = gone
    } catch (err) {
      // A transient API error while polling is not "still there" — keep polling, say so once.
      if (attempt === 1) deps.log(`▶ waiting for Vercel to confirm the delete (${err instanceof Error ? err.message : String(err)})`);
      still = { id: project.id };
    }
    if (!still) { gone = true; break; }
    if (attempt < DELETE_WAIT_ATTEMPTS) await deps.sleep(DELETE_WAIT_MS);
  }
  if (!gone) throw new GoLiveError("Vercel still lists the project — wait a minute and run Go live (it creates the new project)", { step: "clean" });

  const gen = slot.gen;
  const previous = { projectId: gen.projectId, orgId: gen.orgId, projectName: gen.projectName, host: gen.host, tenantId: gen.tenantId, rootDomain: gen.rootDomain, deletedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString() };
  const { projectId: _projectId, orgId: _orgId, projectName: _projectName, host: _host, tenantId: _tenantId, rootDomain: _rootDomain, webAddress: _webAddress, previousWebAddress: _previousWebAddress, ...restGen } = gen;
  slot.gen = { ...restGen, previousHosting: [...(gen.previousHosting ?? []), previous] };
  saveClient(deps, clientPath, client, slot);

  // The profile entry pins the OLD project id — drop it; the run below re-adds it with the new one.
  const profilesPath = path.join(root, PROFILES_FILE);
  const profiles = readJson(deps, profilesPath, {});
  if (profiles && typeof profiles === "object" && slug in profiles) {
    const { [slug]: _dropped, ...rest } = profiles;
    writeJson(deps, profilesPath, rest);
  }

  deps.log("▶ creating the project again in the same account and deploying");
  const summary = await runGoLive({ root, clientPath, skipSeed: true }, deps);

  return { ...summary, freshStart: true, deletedProject: { id: project.id, name: project.name, domains: domainNames } };
}
