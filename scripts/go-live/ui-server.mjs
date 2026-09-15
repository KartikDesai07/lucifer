// scripts/go-live/ui-server.mjs — the owner console's local HTTP server: a JSON
// API over clients/<name>.json plus the job runner, and the static page in ui/.
// Loopback only, no CORS, same-origin check on every mutation — this is the
// owner's private notebook of live credentials, not a product surface.
// `createServer` takes its deps so ui.test.mjs can run it on a temp folder.

import { spawnSync } from "node:child_process";
import http from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDnsCheck } from "./dns-check.mjs";
import { healthVerdict, migrateHosting, parsePlatform, PLATFORM_FILE, redactSecrets, secretsOf, validateClient, validatePlatform, VERCEL_APP_SUFFIX } from "./lib.mjs";
import { acquireClientLock, listClientLocks, LOCKS_DIR, lockMessage, pidAlive, readClientLock, releaseClientLock } from "./lock.mjs";
import { checkWebAddress } from "./web-address.mjs";
import { dbNameOf, webAddressStateOf } from "./ui/pure.mjs";
import { acquireRolloutLock, applyResult, clearRollout, foreignLock, isFinished, isRunning, loadRollout, markInterrupted, markRunning, newRollout, nextPending, planRollout, readRolloutLock, releaseRolloutLock, requestCancel, requeueRetryable, saveRollout, summarize as summarizeRollout } from "./rollout.mjs";
import { ACTIONS, createJobRunner, killTree as defaultKillTree } from "./ui-jobs.mjs";

/** How close a live pid's own start time must be to the lock's `at` timestamp
 *  to be trusted as "the same process that wrote the lock" (Force-release's
 *  ours-or-not-ours check) — a few seconds of clock/measurement slop, never
 *  enough to mistake an unrelated, later-started process for it. */
const PID_MATCH_TOLERANCE_MS = 10_000;
/** Force stop: how long to wait for a killed process to disappear before giving up (lock kept). */
const KILL_WAIT_ATTEMPTS = 5;
const KILL_WAIT_MS = 500;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const UI_DIR = path.join(HERE, "ui");
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,50}$/;
const MAX_BODY_BYTES = 2_000_000;
const JSON_INDENT = 2;
const HTTP = { ok: 200, created: 201, badRequest: 400, forbidden: 403, notFound: 404, conflict: 409, tooLarge: 413, error: 500 };
const STATIC = { "/": ["index.html", "text/html; charset=utf-8"], "/app.js": ["app.js", "text/javascript; charset=utf-8"], "/pure.mjs": ["pure.mjs", "text/javascript; charset=utf-8"], "/web-address.js": ["web-address.js", "text/javascript; charset=utf-8"], "/shell.js": ["shell.js", "text/javascript; charset=utf-8"], "/activity.js": ["activity.js", "text/javascript; charset=utf-8"] };
/** Fields the CLI/server own — a browser PUT never overwrites them. */
const SERVER_OWNED = ["generated", "lastRun"];
const HEALTH_TIMEOUT_MS = 8_000;
/** Sub-folder of clients/ for archived records (starts with "_", so listClients never picks it up as a client). */
export const ARCHIVE_DIR = "_archive";

function send(res, status, body, type = "application/json; charset=utf-8") {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  res.end(data);
}
// `data` (e.g. `{ lock }`) is spread onto the body next to `error` — ui.test.mjs
// reads a locked 409's lock as `body.lock`, not `body.data.lock`.
const fail = (res, status, error, data) => send(res, status, { success: false, error, ...data });
const ok = (res, data, status = HTTP.ok) => send(res, status, { success: true, data });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error("body too large"), { code: "too_large" })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Loopback-only origin gate: a page from anywhere else must not drive the console. */
export function originAllowed(headers, port) {
  const origin = headers.origin;
  if (!origin) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

/** Host gate on EVERY request, reads included: a DNS-rebinding page (evil.example →
 *  127.0.0.1) would arrive with Host: evil.example and could otherwise read the
 *  credential files with a plain GET. Only our own loopback names are served. */
export function hostAllowed(headers, port) {
  const host = headers.host ?? "";
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

export function clientTemplate(exampleJson) {
  const { _readme, domain: _domain, ...t } = exampleJson;
  return {
    ...t,
    slug: "",
    vercel: { token: "", project: null, teamId: null },
    subdomain: "",
    mongodbUri: "",
    admin: { username: "admin", password: "" },
    cafe: { ...t.cafe, name: "" },
    tables: 8,
    menu: null,
    image: null,
    contact: { ownerName: "", phone: "", whatsapp: "" },
    accounts: { vercel: { email: "", password: "" }, atlas: { email: "", password: "" }, images: { email: "", password: "" }, other: "" },
    notes: "",
  };
}

export function summarize(name, c, platform = null) {
  return {
    name,
    slug: typeof c.slug === "string" ? c.slug : name,
    cafeName: c.cafe && typeof c.cafe.name === "string" ? c.cafe.name : "",
    host: c.generated && c.generated.host ? c.generated.host : null,
    subdomain: c.subdomain ?? null,
    webAddress: (() => { const s = webAddressStateOf(c, platform); return { host: s.host, state: s.state }; })(),
    lastRun: c.lastRun ?? null,
    problems: validateClient(c, platform).length,
    deployLock: c.deployLock === true,
    deployed: Boolean(c.generated && c.generated.projectId),
    standbys: (Array.isArray(c.standbyHosts) ? c.standbyHosts : []).map((h) => ({ label: h && h.label, host: h && h.generated && h.generated.host ? h.generated.host : null, deployed: Boolean(h && h.generated && h.generated.projectId) })),
  };
}

/** Windows: `Get-Process -Id N` via PowerShell, parsed to `{name, startedAt}`.
 *  Elsewhere: `ps -o comm=,lstart= -p N`. Never throws — an unreachable or
 *  unparsable pid answers null ("unknown"), which Force-release treats as
 *  "not verified ours" rather than crashing the request. */
export function processInfo(pid) {
  try {
    if (process.platform === "win32") {
      const r = spawnSync("powershell", ["-NoProfile", "-Command", `Get-Process -Id ${Number(pid)} | Select-Object ProcessName,StartTime | ConvertTo-Json`], { encoding: "utf8" });
      if (r.status !== 0 || !r.stdout) return null;
      const parsed = JSON.parse(r.stdout);
      if (!parsed || typeof parsed !== "object") return null;
      return { name: parsed.ProcessName ?? null, startedAt: parsed.StartTime ?? null };
    }
    const r = spawnSync("ps", ["-o", "comm=,lstart=", "-p", String(Number(pid))], { encoding: "utf8" });
    if (r.status !== 0 || !r.stdout) return null;
    const line = r.stdout.trim();
    if (!line) return null;
    const sp = line.indexOf(" ");
    if (sp < 0) return null;
    return { name: line.slice(0, sp), startedAt: line.slice(sp + 1).trim() };
  } catch {
    return null;
  }
}

export function createServer({ root, clientsDir, spawn, fetch = globalThis.fetch, port = 0, commandFor, now = () => Date.now(), profilesPath = path.join(root, "deploy.profiles.json"), pid = process.pid, isAlive = pidAlive, dnsCheck = createDnsCheck(), killTree = defaultKillTree, processInfo: getProcessInfo = processInfo }) {
  /** A live pid is OURS only when it is a node process that started within PID_MATCH_TOLERANCE_MS of the lock's own timestamp — pids get reused by the OS. */
  const ownsPid = (lock) => { const info = getProcessInfo(lock.pid); const lockAt = Date.parse(lock.at); const startedAt = info && info.startedAt ? Date.parse(info.startedAt) : NaN; return Boolean(info) && /node/i.test(info.name ?? "") && Number.isFinite(lockAt) && Number.isFinite(startedAt) && Math.abs(startedAt - lockAt) <= PID_MATCH_TOLERANCE_MS; };
  const jobs = createJobRunner({ root, spawn, ...(commandFor ? { commandFor } : {}), now, killTree });
  const filePath = (name) => path.join(clientsDir, `${name}.json`);
  const readProfiles = () => { try { return existsSync(profilesPath) ? JSON.parse(readFileSync(profilesPath, "utf8")) : {}; } catch { return null; } };
  const writeProfiles = (p) => writeFileSync(profilesPath, `${JSON.stringify(p, null, JSON_INDENT)}\n`, "utf8");
  /** Archived records keep every credential, just out of the active list — never deleted by this tool. */
  const archiveDir = path.join(clientsDir, ARCHIVE_DIR);
  const archivePath = (name) => path.join(archiveDir, `${name}.json`);
  /** null when absent OR unparseable — callers that must tell the two apart use isBroken(). Never throws
   *  (it also runs inside child-process callbacks where a throw would take the whole console down). */
  const readClient = (name) => { if (!existsSync(filePath(name))) return null; try { return JSON.parse(readFileSync(filePath(name), "utf8")); } catch { return null; } };
  const isBroken = (name) => { if (!existsSync(filePath(name))) return false; try { JSON.parse(readFileSync(filePath(name), "utf8")); return false; } catch { return true; } };
  const writeClient = (name, value) => { mkdirSync(clientsDir, { recursive: true }); writeFileSync(filePath(name), `${JSON.stringify(value, null, JSON_INDENT)}\n`, "utf8"); };
  // ── per-client lock: a live lock (CLI/rollout/another deploy) for THIS client
  // blocks a console job or a web-address check from any tab, same as index.mjs.
  const lockFs = { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync };
  const locksDir = path.join(clientsDir, LOCKS_DIR);
  /** A LIVE lock for `name` (pid alive, held by some other process — the
   *  console's own job never writes one of these, it only checks them). */
  const liveClientLock = (name) => { const lock = readClientLock(lockFs, locksDir, name, path.join); return lock && isAlive(lock.pid) ? lock : null; };
  const example = JSON.parse(readFileSync(path.join(HERE, "client.example.json"), "utf8"));
  const demo = JSON.parse(readFileSync(path.join(HERE, "demo.example.json"), "utf8"));
  const platformPath = path.join(clientsDir, PLATFORM_FILE);
  /** `clients/_platform.json`, parsed — null in "legacy mode" (absent or invalid). */
  const readPlatform = () => parsePlatform(existsSync(platformPath) ? readFileSync(platformPath, "utf8") : null);
  const withMigration = (c) => { if (!c) return c; const { client } = migrateHosting(c, readPlatform()); return client; };
  let boundPort = port;

  function listDir(dir) {
    if (!existsSync(dir)) return [];
    const out = [];
    const platform = readPlatform();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const name = f.slice(0, -".json".length);
      if (!NAME_RE.test(name)) continue;
      try {
        out.push(summarize(name, withMigration(JSON.parse(readFileSync(path.join(dir, f), "utf8"))), platform));
      } catch {
        out.push({ name, slug: name, cafeName: "(file is not valid JSON)", host: null, subdomain: null, lastRun: null, problems: 1, broken: true });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  const listClients = () => listDir(clientsDir);
  const listArchive = () => listDir(archiveDir).map((c) => ({ ...c, archived: true }));
  /** Every record (active or archived) that owns deploy-profile `name`: as its slug, or as one of its "<slug>-<label>" standbys. */
  function profileOwners(name) {
    const out = [];
    for (const [dir, archived] of [[clientsDir, false], [archiveDir, true]]) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json")) continue;
        const slug = f.slice(0, -".json".length);
        let rec; try { rec = JSON.parse(readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
        const labels = Array.isArray(rec.standbyHosts) ? rec.standbyHosts.map((h) => h && h.label).filter(Boolean) : [];
        if (slug === name || labels.some((l) => `${slug}-${l}` === name)) out.push({ slug, archived });
      }
    }
    return out;
  }

  /** Every OTHER record (active or archived) already using `subdomain` — case-insensitive.
   *  A subdomain is a DNS label, so two records answering the same host would fight over the
   *  same Vercel domain attach; the console refuses the SAVE, not just the deploy. */
  function subdomainOwners(subdomain, excludeName) {
    if (!subdomain) return [];
    const want = subdomain.toLowerCase();
    const out = [];
    for (const dir of [clientsDir, archiveDir]) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json")) continue;
        const slug = f.slice(0, -".json".length);
        if (slug === excludeName) continue;
        let rec; try { rec = JSON.parse(readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
        if (typeof rec.subdomain === "string" && rec.subdomain.toLowerCase() === want) out.push(slug);
      }
    }
    return out;
  }

  /** Move a record between the active folder and _archive/ (never across names,
   *  never deleting). Archiving also LOCKS deploys on the record and parks its
   *  deploy.profiles.json entry inside it, so neither the console nor
   *  `npm run deploy -- --profile <slug>` can deploy a retired cafe by accident;
   *  Restore puts the profile back (the lock stays until the owner unticks it). */
  function moveRecord(name, toArchive) {
    const from = toArchive ? filePath(name) : archivePath(name);
    const to = toArchive ? archivePath(name) : filePath(name);
    if (!existsSync(from)) return { status: HTTP.notFound, error: toArchive ? "no such client" : "no such archived client" };
    if (existsSync(to)) return { status: HTTP.conflict, error: toArchive ? "an archived record with this name already exists — restore or rename it first" : "an active client with this name already exists" };
    const running = jobs.current();
    if (running && running.status === "running" && running.name === name) return { status: HTTP.conflict, error: "a job is running for this client — wait for it to finish" };
    let record;
    try { record = JSON.parse(readFileSync(from, "utf8")); } catch { record = null; }
    const profiles = readProfiles();
    if (record && profiles) {
      // Every profile this record owns: the primary's (<slug>) and every "<slug>-<something>" — current standbys
      // AND standbys removed earlier whose profile entry is still around (never leave a deployable orphan behind).
      const ownedRe = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-[a-z0-9-]+)?$`);
      const owned = Object.keys(profiles).filter((k) => ownedRe.test(k));
      if (toArchive) {
        const parked = {};
        for (const key of owned) if (profiles[key]) { parked[key] = profiles[key]; delete profiles[key]; }
        if (Object.keys(parked).length) { record.archivedProfiles = parked; writeProfiles(profiles); }
        record.deployLock = true;
      } else {
        const parked = record.archivedProfiles ?? (record.archivedProfile ? { [name]: record.archivedProfile } : {});
        let changed = false;
        for (const [key, value] of Object.entries(parked)) if (!profiles[key]) { profiles[key] = value; changed = true; }
        if (changed) writeProfiles(profiles);
        delete record.archivedProfiles; delete record.archivedProfile;
      }
      writeFileSync(from, `${JSON.stringify(record, null, JSON_INDENT)}\n`, "utf8");
    }
    mkdirSync(path.dirname(to), { recursive: true });
    renameSync(from, to);
    return { status: HTTP.ok };
  }

  function recordRun(job) {
    const c = readClient(job.name);
    if (!c) return;
    c.lastRun = { action: job.action, status: job.status, at: new Date(job.finishedAt ?? now()).toISOString(), exitCode: job.exitCode, ...(job.host ? { host: job.host } : {}) };
    writeClient(job.name, c);
  }

  /** Has this record ever done anything real (deployed or seeded)? Such a record
   *  is never deleted directly — archive first, retire, then delete from the archive. */
  function hasHistory(c) {
    const g = c.generated || {};
    // previousHosting = a detached (path B) project that still exists in some Vercel account: the record is its only trace.
    return Boolean(g.projectId || g.seededAt || (Array.isArray(g.previousHosting) && g.previousHosting.length > 0) || (c.lastRun && c.lastRun.action === "go-live" && c.lastRun.status === "ok") || (Array.isArray(c.standbyHosts) && c.standbyHosts.some((h) => h && h.generated && h.generated.projectId)));
  }

  // ── rollout: deploy the current code to every client, one after another ─────
  const rolloutFs = { existsSync, readFileSync, writeFileSync, rmSync };
  const rolloutJoin = (a, b) => path.join(a, b);
  const lockOpts = { owner: "console", pid, ...(isAlive ? { isAlive } : {}), now };
  const otherDriver = () => foreignLock(rolloutFs, clientsDir, rolloutJoin, pid, isAlive);
  let rollout = loadRollout(rolloutFs, clientsDir, rolloutJoin);
  // A "running" target on disk with NO live driver = a previous console/CLI died mid-deploy → interrupted.
  // With a live driver (the CLI is deploying right now) the file is theirs: show it, never touch it.
  if (rollout && !otherDriver() && markInterrupted(rollout)) saveRollout(rolloutFs, clientsDir, rolloutJoin, rollout);
  let driving = false; // this console holds the lock and runs the queue
  const persistRollout = () => {
    // Compare-and-swap on the rollout id: if another process replaced the file, our copy is stale — reload, never clobber.
    const onDisk = loadRollout(rolloutFs, clientsDir, rolloutJoin);
    if (onDisk && rollout && onDisk.id !== rollout.id) { rollout = onDisk; return false; }
    saveRollout(rolloutFs, clientsDir, rolloutJoin, rollout); return true;
  };
  function stopDriving() { if (driving) { releaseRolloutLock(rolloutFs, clientsDir, rolloutJoin, pid); driving = false; } }
  function startDriving() {
    const lock = acquireRolloutLock(rolloutFs, clientsDir, rolloutJoin, lockOpts);
    if (!lock.ok) return lock.held;
    driving = true; return null;
  }
  /** Start the next pending target unless a job is already running; called after every finished job.
   *  Everything here runs from child-process callbacks / timers — it must never throw. */
  function advanceRollout() {
    try {
      if (!rollout || !driving || jobs.isBusy()) return;
      const i = nextPending(rollout);
      if (i < 0) { if (isFinished(rollout)) { if (!rollout.finishedAt) { rollout.finishedAt = new Date(now()).toISOString(); persistRollout(); } stopDriving(); } return; }
      const t = rollout.targets[i];
      const target = readClient(t.name);
      if (!target || target.deployLock === true) { applyResult(rollout, i, { ok: false, exitCode: null, error: !target ? (isBroken(t.name) ? "client file is not valid JSON" : "client record no longer exists") : "deploys are locked for this client now" }, now()); persistRollout(); return advanceRollout(); }
      markRunning(rollout, i, now()); persistRollout();
      const secrets = secretsOf(target);
      const job = jobs.start({ name: t.name, action: "redeploy", clientPath: filePath(t.name), redact: (line) => redactSecrets(line, secrets), extra: t.host !== "primary" ? { host: t.host } : {} });
      const onDone = (ev) => {
        if (ev.type !== "done") return;
        try {
          // Rollout bookkeeping FIRST (durable even if the per-client lastRun write fails), then lastRun.
          const idx = rollout ? rollout.targets.findIndex((x) => x.profile === t.profile && x.status === "running") : -1;
          if (idx >= 0) { applyResult(rollout, idx, { ok: ev.status === "ok", exitCode: ev.exitCode, error: ev.status === "ok" ? null : `deploy exited with code ${ev.exitCode} — see its log` }, now()); persistRollout(); }
          try { recordRun(job); } catch { /* a broken client file must not stop the queue */ }
        } finally { setTimeout(advanceRollout, 0); }
      };
      job.listeners.add(onDone);
      if (job.status !== "running") onDone({ type: "done", status: job.status, exitCode: job.exitCode });
    } catch (err) {
      // Degrade the ONE target, keep the console alive, keep the queue moving.
      const i = rollout ? rollout.targets.findIndex((x) => x.status === "running") : -1;
      if (i >= 0) { applyResult(rollout, i, { ok: false, exitCode: null, error: `console error: ${err instanceof Error ? err.message : String(err)}` }, now()); try { persistRollout(); } catch { /* disk trouble — nothing more we can do here */ } }
      setTimeout(advanceRollout, 0);
    }
  }
  const rolloutView = () => {
    if (!rollout && !otherDriver()) return null;
    const other = otherDriver();
    if (other) rollout = loadRollout(rolloutFs, clientsDir, rolloutJoin) ?? rollout; // live view of a CLI-driven rollout
    return rollout ? { ...rollout, summary: summarizeRollout(rollout), currentJob: driving ? jobs.summary(jobs.current()) : null, drivenBy: driving ? "console" : other ? `${other.owner} (pid ${other.pid})` : null } : null;
  };

  async function handle(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${boundPort}`);
    const seg = url.pathname.split("/").filter(Boolean);
    const isMutation = req.method !== "GET";
    if (!hostAllowed(req.headers, boundPort)) return fail(res, HTTP.forbidden, "this console answers only on 127.0.0.1 / localhost");
    if (isMutation && !originAllowed(req.headers, boundPort)) return fail(res, HTTP.forbidden, "cross-origin request refused");
    if (isMutation && !/^application\/json/.test(req.headers["content-type"] ?? "")) return fail(res, HTTP.badRequest, "send application/json");

    if (req.method === "GET" && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      return send(res, HTTP.ok, readFileSync(path.join(UI_DIR, file)), type);
    }
    if (seg[0] !== "api") return fail(res, HTTP.notFound, "not found");

    if (req.method === "GET" && seg[1] === "clients" && seg.length === 2) return ok(res, listClients());
    if (req.method === "GET" && seg[1] === "archive" && seg.length === 2) return ok(res, listArchive());

    // ── rollout endpoints ──
    if (seg[1] === "rollout") {
      if (req.method === "GET" && seg.length === 2) return ok(res, rolloutView());
      if (req.method === "POST" && seg[2] === "force-release" && seg.length === 3) {
        let body; try { body = JSON.parse(await readBody(req)); } catch { return fail(res, HTTP.badRequest, "body must be JSON"); }
        if (body.confirm !== "rollout") return fail(res, HTTP.badRequest, 'type "rollout" to confirm');
        const held = readRolloutLock(rolloutFs, clientsDir, rolloutJoin);
        if (!held || held.corrupt) return fail(res, HTTP.notFound, "no rollout lock is held");
        let killed = false;
        if (isAlive(held.pid)) {
          // Same ownership proof as the client lock: never kill a pid the OS may have reused.
          if (!ownsPid(held)) { releaseRolloutLock(rolloutFs, clientsDir, rolloutJoin, held.pid); stopDriving(); return fail(res, HTTP.conflict, `pid ${held.pid} is not our process any more — the lock is stale; removing only the file`); }
          killTree(held.pid); killed = true;
          for (let i = 0; i < KILL_WAIT_ATTEMPTS && isAlive(held.pid); i++) await new Promise((r) => setTimeout(r, KILL_WAIT_MS));
          if (isAlive(held.pid)) return fail(res, HTTP.conflict, `pid ${held.pid} is still shutting down — the lock stays until it is gone; try again in a few seconds`);
        }
        stopDriving();
        releaseRolloutLock(rolloutFs, clientsDir, rolloutJoin, held.pid);
        // The driver died mid-run — whatever it was doing is unknown, so the
        // rollout is marked interrupted (like a crash) so Resume works.
        rollout = loadRollout(rolloutFs, clientsDir, rolloutJoin);
        if (rollout) { markInterrupted(rollout); persistRollout(); }
        return ok(res, { released: true, killed });
      }
      const other = req.method !== "GET" ? otherDriver() : null;
      if (other) return fail(res, HTTP.conflict, `another process is driving a rollout right now (${other.owner}, pid ${other.pid}) — wait for it to finish`);
      if (req.method === "POST" && seg.length === 2) {
        if (rollout && !isFinished(rollout)) return fail(res, HTTP.conflict, "a rollout is still running or unfinished — resume, retry or dismiss it first");
        if (jobs.isBusy()) return fail(res, HTTP.conflict, "a job is running — wait for it to finish");
        const records = listClients().filter((s) => !s.broken).map((s) => ({ name: s.name, client: readClient(s.name) })).filter((r) => r.client);
        const targets = planRollout(records);
        if (!targets.some((t) => t.status === "pending")) return fail(res, HTTP.badRequest, "nothing to deploy — no client has a deployed, unlocked host");
        const held = startDriving(); if (held) return fail(res, HTTP.conflict, `another process holds the rollout lock (${held.owner}, pid ${held.pid})`);
        rollout = newRollout(targets, now()); saveRollout(rolloutFs, clientsDir, rolloutJoin, rollout); advanceRollout();
        return ok(res, rolloutView(), HTTP.created);
      }
      if (req.method === "POST" && seg[2] === "resume") { // pending + interrupted/failed/cancelled → run again
        rollout = loadRollout(rolloutFs, clientsDir, rolloutJoin) ?? rollout;
        if (!rollout) return fail(res, HTTP.notFound, "no rollout on disk");
        if (jobs.isBusy()) return fail(res, HTTP.conflict, "a job is running — wait for it to finish");
        const held = startDriving(); if (held) return fail(res, HTTP.conflict, `another process holds the rollout lock (${held.owner}, pid ${held.pid})`);
        markInterrupted(rollout); requeueRetryable(rollout); persistRollout(); advanceRollout();
        return ok(res, rolloutView());
      }
      if (req.method === "POST" && seg[2] === "cancel") {
        if (!rollout) return fail(res, HTTP.notFound, "no rollout on disk");
        requestCancel(rollout); persistRollout();
        if (!jobs.isBusy()) advanceRollout(); // nothing running → finishes and releases the lock right away
        return ok(res, rolloutView());
      }
      if (req.method === "DELETE" && seg.length === 2) { // dismiss: forget a finished/cancelled rollout
        if (rollout && isRunning(rollout) && jobs.isBusy()) return fail(res, HTTP.conflict, "a deploy is running — cancel first, then dismiss when it has finished");
        stopDriving(); clearRollout(rolloutFs, clientsDir, rolloutJoin); rollout = null;
        return ok(res, { dismissed: true });
      }
    }
    if (req.method === "GET" && seg[1] === "template") return ok(res, clientTemplate(example));
    if (req.method === "GET" && seg[1] === "demo-menu") return ok(res, demo.menu);
    if (req.method === "GET" && seg[1] === "jobs" && seg[2] === "current") return ok(res, jobs.summary(jobs.current()));

    // ── locks: every client lock (live + stale count) + the rollout lock + the
    // console's own current job — the owner's one-screen view of "what is running,
    // from anywhere", and what the Force controls act on. ──
    if (req.method === "GET" && seg[1] === "locks" && seg.length === 2) {
      const all = listClientLocks(lockFs, locksDir, path.join, isAlive);
      const live = all.filter((l) => l.alive);
      const rolloutLock = readRolloutLock(rolloutFs, clientsDir, rolloutJoin);
      return ok(res, {
        clients: live,
        stale: all.length - live.length,
        rollout: rolloutLock && !rolloutLock.corrupt ? { owner: rolloutLock.owner, pid: rolloutLock.pid, at: rolloutLock.at, alive: isAlive(rolloutLock.pid) } : null,
        job: jobs.summary(jobs.current()),
      });
    }
    if (req.method === "POST" && seg[1] === "locks" && seg.length === 4 && seg[3] === "force-release") {
      const slug = seg[2];
      let body; try { body = JSON.parse(await readBody(req)); } catch { return fail(res, HTTP.badRequest, "body must be JSON"); }
      if (typeof body.confirm !== "string" || body.confirm !== slug) return fail(res, HTTP.badRequest, "type the client's slug exactly to confirm");
      const lock = readClientLock(lockFs, locksDir, slug, path.join);
      if (!lock) return fail(res, HTTP.notFound, "no lock is held for this client");
      if (!isAlive(lock.pid)) { releaseClientLock(lockFs, locksDir, slug, lock.pid, path.join); return ok(res, { released: true, killed: false }); }
      // A live pid alone is not proof it is OUR process — pids get reused by the
      // OS. Verified "ours" = a node process whose own start time is close to
      // the moment the lock says it started.
      const ours = ownsPid(lock);
      if (!ours) {
        // Refused, not force-killed — but the file can never be trusted as this
        // lock's own process any more either, so it is removed on the way out.
        releaseClientLock(lockFs, locksDir, slug, lock.pid, path.join);
        return fail(res, HTTP.conflict, `pid ${lock.pid} is not our process any more — the lock is stale; removing only the file`);
      }
      killTree(lock.pid);
      for (let i = 0; i < KILL_WAIT_ATTEMPTS && isAlive(lock.pid); i++) await new Promise((r) => setTimeout(r, KILL_WAIT_MS));
      // The lock is released only once the process is really gone — a lock removed from
      // under a still-running deploy would let a second run start on the same client.
      if (isAlive(lock.pid)) return fail(res, HTTP.conflict, `pid ${lock.pid} is still shutting down — the lock stays until it is gone; try again in a few seconds`, { lock });
      releaseClientLock(lockFs, locksDir, slug, lock.pid, path.join);
      return ok(res, { released: true, killed: true });
    }

    // ── platform: the ONE owner-controlled apex domain every cafe is a subdomain of ──
    if (seg[1] === "platform" && seg.length === 2) {
      if (req.method === "GET") return ok(res, readPlatform());
      if (req.method === "PUT") {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch (err) { return fail(res, err.code === "too_large" ? HTTP.tooLarge : HTTP.badRequest, "body must be a JSON object"); }
        const problems = validatePlatform(body);
        if (problems.length) return fail(res, HTTP.badRequest, problems.join("; "));
        const current = readPlatform();
        if (current && current.apexDomain !== body.apexDomain) {
          // Changing the apex out from under a client that is already ON it (attached
          // OR served) would silently orphan its address — list the names, refuse.
          const affected = [];
          for (const c of listClients()) {
            if (c.broken) continue;
            const rec = readClient(c.name);
            if (!rec) continue;
            const oldSuffix = `.${current.apexDomain}`;
            const onOldHost = typeof rec.generated?.host === "string" && rec.generated.host.toLowerCase().endsWith(oldSuffix);
            const hasWebAddress = Boolean(rec.generated && rec.generated.webAddress);
            if (onOldHost || hasWebAddress) affected.push(c.name);
          }
          if (affected.length) return fail(res, HTTP.conflict, `changing the apex domain would strand ${affected.join(", ")} — move or revert their web address first`);
        }
        writeFileSync(platformPath, `${JSON.stringify({ apexDomain: body.apexDomain, dnsNote: body.dnsNote ?? null }, null, JSON_INDENT)}\n`, "utf8");
        return ok(res, { saved: true });
      }
    }

    if (seg[1] === "clients" && seg.length >= 3) {
      const name = seg[2];
      if (!NAME_RE.test(name)) return fail(res, HTTP.badRequest, "client name: lowercase letters, digits and hyphens");
      if (req.method === "GET" && seg.length === 3) {
        const c = readClient(name);
        return c ? ok(res, withMigration(c)) : fail(res, HTTP.notFound, "no such client");
      }
      if (req.method === "PUT" && seg.length === 3) {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch (err) { return fail(res, err.code === "too_large" ? HTTP.tooLarge : HTTP.badRequest, "body must be a JSON object"); }
        if (typeof body !== "object" || body === null || Array.isArray(body)) return fail(res, HTTP.badRequest, "body must be a JSON object");
        if (body.slug !== name) return fail(res, HTTP.badRequest, `slug must equal the file name "${name}"`);
        if (isBroken(name)) return fail(res, HTTP.conflict, `clients/${name}.json exists but is not valid JSON — fix it by hand (a save now would lose its recorded secrets)`);
        const onDiskRaw = readClient(name) ?? {};
        const onDisk = withMigration(onDiskRaw);
        if (!onDisk.slug && existsSync(archivePath(name))) return fail(res, HTTP.conflict, `an ARCHIVED client named "${name}" exists — restore it from the Archived list, or choose another slug`);
        // Symmetric name guard: this slug must not be another record's "<slug>-<label>" standby name either.
        if (!onDisk.slug) {
          const taken = profileOwners(name).filter((o) => o.slug !== name);
          if (taken.length) return fail(res, HTTP.conflict, `"${name}" is already the standby name "<slug>-<label>" of client "${taken[0].slug}" — choose another slug`);
        }
        // A subdomain is a DNS label — two clients (active or archived) fighting over the
        // same host would both fail to attach cleanly. Refuse the save, not just the deploy.
        if (typeof body.subdomain === "string" && body.subdomain) {
          const owners = subdomainOwners(body.subdomain, name);
          if (owners.length) return fail(res, HTTP.conflict, `"${body.subdomain}.${readPlatform()?.apexDomain ?? "<apex>"}" is already the web address of client "${owners[0]}"`);
        }
        for (const k of SERVER_OWNED) { delete body[k]; if (onDisk[k] !== undefined) body[k] = onDisk[k]; }
        // Per-standby `generated` is server-owned too: keep what the runs recorded (by label), never what a stale tab sends.
        if (Array.isArray(body.standbyHosts)) {
          const recorded = new Map((Array.isArray(onDisk.standbyHosts) ? onDisk.standbyHosts : []).filter((h) => h && h.label).map((h) => [h.label, h.generated]));
          body.standbyHosts = body.standbyHosts.map((h) => { if (!h || typeof h !== "object") return h; const { generated: _drop, ...rest } = h; const g = recorded.get(h.label); return g !== undefined ? { ...rest, generated: g } : rest; });
          // A standby's project/profile is "<slug>-<label>" — that name must not be another client's slug.
          for (const h of body.standbyHosts) {
            const derived = h && h.label ? `${name}-${h.label}` : null;
            if (derived && (existsSync(filePath(derived)) || existsSync(archivePath(derived)))) return fail(res, HTTP.conflict, `standby "${h.label}" would use the project/profile name "${derived}", which is another client's slug — pick a different label`);
          }
        }
        writeClient(name, body);
        return ok(res, { saved: name, problems: validateClient(body, readPlatform()) }, existsSync(filePath(name)) && onDisk.slug ? HTTP.ok : HTTP.created);
      }
      if (req.method === "POST" && seg[3] === "validate") {
        const c = readClient(name);
        return c ? ok(res, { problems: validateClient(withMigration(c), readPlatform()) }) : fail(res, HTTP.notFound, "no such client");
      }
      if (req.method === "POST" && (seg[3] === "archive" || seg[3] === "restore") && seg.length === 4) {
        const r = moveRecord(name, seg[3] === "archive");
        return r.status === HTTP.ok ? ok(res, { [seg[3] === "archive" ? "archived" : "restored"]: name }) : fail(res, r.status, r.error);
      }
      if (req.method === "DELETE" && seg.length === 3) {
        // Permanent delete of an ACTIVE record: only for a record with no history (a
        // slip, a test entry). Anything that was deployed or seeded goes through
        // Archive → retire → delete-from-archive, so credentials of a live cafe are
        // never one click from disappearing.
        let body; try { body = JSON.parse(await readBody(req)); } catch { return fail(res, HTTP.badRequest, "body must be JSON"); }
        const c = readClient(name);
        if (!c) return fail(res, HTTP.notFound, "no such client");
        if (typeof body.confirm !== "string" || body.confirm !== name) return fail(res, HTTP.badRequest, "type the client's slug exactly to confirm");
        if (hasHistory(c)) return fail(res, HTTP.conflict, "this record was deployed or seeded — archive it first, retire Vercel/Atlas, then delete it from the Archived list");
        const running = jobs.current();
        if (running && running.status === "running" && running.name === name) return fail(res, HTTP.conflict, "a job is running for this client");
        const profiles = readProfiles();
        if (profiles && profiles[name]) { delete profiles[name]; writeProfiles(profiles); }
        rmSync(filePath(name));
        return ok(res, { deleted: name });
      }
      if (req.method === "POST" && seg[3] === "detach-hosting" && seg.length === 4) {
        // "Move hosting, path B": forget the recorded Vercel project so the next
        // Update creates a fresh one in whatever account the (new) token belongs
        // to. Secrets and the seed date stay (sessions survive, locks stay right);
        // the old project's identity is kept under previousHosting, never lost.
        const c = readClient(name);
        if (!c) return fail(res, HTTP.notFound, "no such client");
        const running = jobs.current();
        if (running && running.status === "running" && running.name === name) return fail(res, HTTP.conflict, "a job is running for this client — wait for it to finish");
        const g = c.generated ?? {};
        if (!g.projectId) return fail(res, HTTP.badRequest, "no hosting is recorded for this client yet");
        const { projectId, orgId, projectName, host, tenantId, rootDomain, ...keep } = g;
        c.generated = { ...keep, previousHosting: [...(g.previousHosting ?? []), { projectId, orgId, projectName, host, tenantId, rootDomain, detachedAt: new Date(now()).toISOString() }] };
        writeClient(name, c);
        return ok(res, { detached: { projectId, host } });
      }
      if (req.method === "GET" && seg[3] === "health") {
        const c = readClient(name);
        // ?host=<label> checks a standby's own address; default = the primary.
        const label = url.searchParams.get("host");
        const slot = c && label && label !== "primary" ? (Array.isArray(c.standbyHosts) ? c.standbyHosts : []).find((h) => h && h.label === label) : c;
        if (c && label && label !== "primary" && !slot) return fail(res, HTTP.notFound, `no standby host "${label}"`);
        const gen = (slot && slot.generated) || {};
        const host = gen.host;
        if (!host) return ok(res, { ok: null, reason: "not deployed yet — no host recorded", hostLabel: label || "primary" });
        // A platform host (<sub>.<apex>) resolves through DNS the owner just added — go
        // through the authoritative-nameserver path (dns-check.mjs), never this PC's
        // cache, or a record added seconds ago reads back as "not found" for hours.
        if (!host.toLowerCase().endsWith(VERCEL_APP_SUFFIX)) {
          const probe = await dnsCheck.probeHealth(host, (readPlatform() || {}).apexDomain ?? null);
          if (probe.status === null) return ok(res, { ok: false, reason: probe.error || "no response", host, hostLabel: label || "primary" });
          return ok(res, { ...healthVerdict(probe.status, probe.body, gen.tenantId), status: probe.status, body: probe.body, host, hostLabel: label || "primary" });
        }
        try {
          const r = await fetch(`https://${host}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS), headers: { accept: "application/json" } });
          const body = await r.json().catch(() => null);
          return ok(res, { ...healthVerdict(r.status, body, gen.tenantId), status: r.status, body, host, hostLabel: label || "primary" });
        } catch (err) {
          return ok(res, { ok: false, reason: err instanceof Error ? err.message : String(err), host });
        }
      }
      if (req.method === "POST" && seg[3] === "web-address" && seg[4] === "check" && seg.length === 5) {
        const target = readClient(name);
        if (!target) return fail(res, HTTP.notFound, "no such client");
        const running = jobs.current();
        // ensureWebAddress/checkWebAddress writes `generated` wholesale — a run.mjs job for
        // this client touches the same field, so the two must never race each other.
        if (running && running.status === "running" && running.name === name) return fail(res, HTTP.conflict, "a job is running for this client — wait for it to finish");
        const lock = liveClientLock(name);
        if (lock) return fail(res, HTTP.conflict, lockMessage(lock), { lock });
        try {
          const status = await checkWebAddress({ clientPath: filePath(name) }, { fs: { existsSync, readFileSync, writeFileSync, readdirSync }, fetch, dnsCheck, log: () => {}, env: process.env, now });
          return ok(res, status);
        } catch (err) {
          const secrets = secretsOf(target);
          return fail(res, HTTP.badRequest, redactSecrets(err instanceof Error ? err.message : String(err), secrets));
        }
      }
    }

    if (req.method === "DELETE" && seg[1] === "archive" && seg.length === 3) {
      // Permanent delete of an ARCHIVED record (any history) — the owner has been
      // through the retire checklist; typed confirmation, file removed for good.
      const name = seg[2];
      if (!NAME_RE.test(name)) return fail(res, HTTP.badRequest, "client name: lowercase letters, digits and hyphens");
      let body; try { body = JSON.parse(await readBody(req)); } catch { return fail(res, HTTP.badRequest, "body must be JSON"); }
      if (!existsSync(archivePath(name))) return fail(res, HTTP.notFound, "no such archived client");
      if (typeof body.confirm !== "string" || body.confirm !== name) return fail(res, HTTP.badRequest, "type the client's slug exactly to confirm");
      rmSync(archivePath(name));
      return ok(res, { deleted: name, from: "archive" });
    }

    if (seg[1] === "jobs") {
      if (req.method === "POST" && seg.length === 2) {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { return fail(res, HTTP.badRequest, "body must be JSON"); }
        const target = NAME_RE.test(body.name ?? "") ? readClient(body.name) : null;
        if (!target) return fail(res, HTTP.notFound, "no such client");
        // A live lock for this client (CLI, another deploy, a rollout target) blocks
        // EVERY action here, including a dry-run — a second click from any tab/process
        // must not start a second one while one is already running for this client.
        const lock = liveClientLock(body.name);
        if (lock) return fail(res, HTTP.conflict, lockMessage(lock), { lock });
        if (!ACTIONS.includes(body.action)) return fail(res, HTTP.badRequest, `action must be one of ${ACTIONS.join(", ")}`);
        if (target.deployLock === true && (body.action === "go-live" || body.action === "redeploy" || body.action === "preview" || body.action === "fresh-start")) return fail(res, HTTP.forbidden, "deploys are locked for this client (Status → Safety)");
        // `host` picks the hosting slot: the primary (default) or one of the record's standby labels.
        if (body.host !== undefined && body.host !== "primary") {
          if (body.action === "fresh-start") return fail(res, HTTP.badRequest, "fresh start is for the primary hosting only — run it without a host");
          const labels = (Array.isArray(target.standbyHosts) ? target.standbyHosts : []).map((h) => h && h.label);
          if (typeof body.host !== "string" || !labels.includes(body.host)) return fail(res, HTTP.badRequest, `no standby host "${body.host}" on this client — save it first (Hosting → Standby hosts)`);
          if (body.action === "reset-demo" || body.action === "seed-demo") return fail(res, HTTP.badRequest, "about the database, not a host — run it without a host");
          // A standby serves the primary's database — deploying it before that database was ever seeded would publish an empty cafe.
          if ((body.action === "go-live" || body.action === "preview") && !(target.generated && target.generated.seededAt)) return fail(res, HTTP.badRequest, "go live on the PRIMARY first (it seeds the database) — a standby only mirrors it");
        }
        if (body.action === "fresh-start") {
          // Server-side twin of runFreshStart's guards: NOTHING is deleted before
          // these pass, so a stale console tab cannot delete the wrong project.
          if (!(target.generated && target.generated.projectId)) return fail(res, HTTP.badRequest, "nothing to clean up — this client has no Vercel project yet; Go live creates one");
          if (typeof body.confirm !== "string" || body.confirm !== target.slug) return fail(res, HTTP.badRequest, "type the client's slug exactly to confirm");
          if (typeof body.confirmProject !== "string" || body.confirmProject !== (target.generated.projectName ?? ((target.vercel && target.vercel.project) || target.slug))) return fail(res, HTTP.conflict, "the project name shown does not match the saved record — reload");
        }
        if (body.action === "reset-demo" || body.action === "seed-demo") {
          // Server-side twin of the CLI/seeder guards: the request alone can never
          // reach a live cafe's data. confirmDb binds the run to the database the
          // owner was SHOWN — a URI edited in between makes the request fail.
          if (target.demo !== true) return fail(res, HTTP.forbidden, "not a demo client — tick 'Demo client' (Status → Safety) and Save first");
          if (typeof body.confirm !== "string" || body.confirm !== target.slug) return fail(res, HTTP.badRequest, "type the client's slug exactly to confirm the reset");
          const dbName = dbNameOf(target.mongodbUri);
          if (!dbName || typeof body.confirmDb !== "string" || body.confirmDb !== dbName) return fail(res, HTTP.conflict, `the database shown (${body.confirmDb ?? "?"}) is not the one the saved file points at (${dbName ?? "none"}) — reload and try again`);
        }
        if (body.action === "seed-demo" && body.imagesDir !== undefined && body.imagesDir !== null && (typeof body.imagesDir !== "string" || body.imagesDir.length === 0 || body.imagesDir.length > 500)) return fail(res, HTTP.badRequest, "imagesDir: a non-empty path, at most 500 characters (or omit it)");
        if (rollout && !isFinished(rollout) && !rollout.cancelRequested) return fail(res, HTTP.conflict, "a rollout is in progress — wait for it, or cancel it (More → Deploy update to all clients)");
        try {
          const secrets = secretsOf(target);
          const job = jobs.start({ name: body.name, action: body.action, clientPath: filePath(body.name), redact: (line) => redactSecrets(line, secrets), extra: { confirm: body.confirm, confirmDb: body.confirmDb, ...(body.action === "fresh-start" ? { confirmProject: body.confirmProject } : {}), ...(body.action === "seed-demo" && body.imagesDir ? { imagesDir: body.imagesDir } : {}), ...(body.host !== undefined && body.host !== "primary" ? { host: body.host } : {}) } });
          // Recorded the instant the job STARTS, not only when it finishes: a console
          // that closes (or a PC that restarts) mid-run must still leave the client's
          // lastRun showing "running" — the resumability fix this belongs to reads
          // that to say "interrupted", not silently keep whatever the PREVIOUS run
          // recorded. The end-of-job write below (unchanged) overwrites this with the
          // real outcome once the job finishes.
          if (job.status === "running") recordRun(job);
          job.listeners.add((ev) => { if (ev.type === "done") recordRun(job); });
          if (job.status !== "running") recordRun(job);
          return ok(res, jobs.summary(job), HTTP.created);
        } catch (err) {
          return fail(res, err.code === "busy" ? HTTP.conflict : HTTP.error, err.message);
        }
      }
      if (req.method === "POST" && seg.length === 4 && seg[3] === "stop") {
        const result = jobs.stop(seg[2]);
        if (!result.ok) return fail(res, result.code === "not_found" ? HTTP.notFound : HTTP.conflict, result.code === "not_found" ? "no such job" : "this job is not running");
        recordRun(result.job);
        return ok(res, jobs.summary(result.job));
      }
      if (req.method === "GET" && seg.length === 4 && seg[3] === "stream") {
        const job = jobs.current();
        if (!job || job.id !== seg[2]) return fail(res, HTTP.notFound, "no such job");
        res.writeHead(HTTP.ok, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        const unsubscribe = jobs.subscribe(job, (ev) => { res.write(`data: ${JSON.stringify(ev)}\n\n`); if (ev.type === "done") res.end(); });
        req.on("close", unsubscribe);
        return undefined;
      }
    }
    return fail(res, HTTP.notFound, "not found");
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => { if (!res.headersSent) fail(res, HTTP.error, err instanceof Error ? err.message : String(err)); else res.end(); });
  });

  return {
    server,
    jobs,
    listen: () => new Promise((resolve) => server.listen(port, "127.0.0.1", () => { boundPort = server.address().port; resolve(boundPort); })),
    close: () => new Promise((resolve) => server.close(() => resolve())),
    port: () => boundPort,
  };
}
