// node --test scripts/go-live/ui.test.mjs — the owner console's local API on a
// temp clients folder: template → save → list → validate → job stream, plus the
// same-origin and content-type gates and the server-owned-field rule.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { cleanLines, commandFor } from "./ui-jobs.mjs";
import http from "node:http";
import { clientTemplate, createServer, hostAllowed, originAllowed, summarize } from "./ui-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
let dir, srv, base;

/** Jobs run `node -e` echo scripts instead of the real go-live/deploy commands. */
let lastClientPath = null;
let lastExtra = null;
const rolloutProfiles = [];
const fakeCommandFor = (_root, action, name, clientPath, extra) => {
  lastClientPath = clientPath; lastExtra = extra;
  if (action === "reset-demo") return { cmd: process.execPath, args: ["-e", `console.log('reset ${name} confirm=${(extra && extra.confirm) || ""}'); process.exit(0)`] };
  if (action === "seed-demo") return { cmd: process.execPath, args: ["-e", `console.log('seed-demo ${name} confirm=${(extra && extra.confirm) || ""} imagesDir=${(extra && extra.imagesDir) || ""}'); process.exit(0)`] };
  if (action === "fresh-start") return { cmd: process.execPath, args: ["-e", `console.log('fresh-start ${name} confirm=${(extra && extra.confirm) || ""} confirmProject=${(extra && extra.confirmProject) || ""}'); process.exit(0)`] };
  if (action === "redeploy") {
    const profile = extra && extra.host ? `${name}-${extra.host}` : name;
    rolloutProfiles.push(profile);
    return { cmd: process.execPath, args: ["-e", `console.log('deploying ${name} token tok_secret_123 uri mongodb+srv://u:p@c.mongodb.net/pos'); console.error('\\u001b[32mgreen\\u001b[0m done'); process.exit(${name === "badcafe" ? 1 : 0})`] };
  }
  return { cmd: process.execPath, args: ["-e", `console.log('a ${name}'); console.log('b'); process.exit(${action === "preview" ? 3 : 0})`] };
};

before(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "golive-ui-"));
  srv = createServer({ root: ROOT, clientsDir: dir, spawn, commandFor: fakeCommandFor, profilesPath: path.join(dir, "deploy.profiles.json"), fetch: async () => ({ status: 200, json: async () => ({ ok: true, db: "up", tenant: "sunrise-x1" }) }) });
  base = `http://127.0.0.1:${await srv.listen()}`;
});
after(async () => { await srv.close(); rmSync(dir, { recursive: true, force: true }); });

const j = async (method, p, body, headers = {}) => {
  const res = await fetch(base + p, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json() };
};
function filled(slug) {
  return { slug, vercel: { token: "tok_secret_123", project: null, teamId: null }, domain: null, mongodbUri: "mongodb+srv://u:p@c.mongodb.net/pos?retryWrites=true", admin: { username: "admin", password: "Strong-Pass-1!" }, cafe: { name: "Sunrise Café", gst: { enabled: true, rate: 5, mode: "inclusive" } }, tables: 8, menu: null, image: null, accounts: { vercel: { email: "o@x.in", password: "pw" } }, notes: "hi" };
}

test("static page and app.js are served; unknown paths 404", async () => {
  // Updated for the admin-panel/SaaS shell (plan-admin-fresh.md §B.1): the page
  // title is now "POS go-live console" and the topbar brand reads
  // "POS Software · Owner console" — the old literal "Go-live console" pin no
  // longer matches either string now that the shell has landed.
  const page = await fetch(base + "/"); assert.equal(page.status, 200); assert.match(await page.text(), /POS go-live console/);
  const js = await fetch(base + "/app.js"); assert.equal(js.status, 200); assert.match(js.headers.get("content-type"), /javascript/);
  const pure = await fetch(base + "/pure.mjs"); assert.equal(pure.status, 200); assert.match(await pure.text(), /export function cloneTemplateOf/);
  const webAddress = await fetch(base + "/web-address.js"); assert.equal(webAddress.status, 200); assert.match(webAddress.headers.get("content-type"), /javascript/); assert.match(await webAddress.text(), /export function createWebAddress/);
  const shell = await fetch(base + "/shell.js"); assert.equal(shell.status, 200); assert.match(shell.headers.get("content-type"), /javascript/); assert.match(await shell.text(), /export function createShell/);
  assert.equal((await fetch(base + "/nope")).status, 404);
});

test("template has empty credentials, the owner record blocks, and no _readme", async () => {
  const { status, json } = await j("GET", "/api/template");
  assert.equal(status, 200);
  const t = json.data;
  assert.equal(t._readme, undefined);
  assert.equal(t.vercel.token, ""); assert.equal(t.mongodbUri, ""); assert.equal(t.admin.password, "");
  assert.deepEqual(Object.keys(t.accounts).sort(), ["atlas", "images", "other", "vercel"]);
  assert.equal(t.tables, 8);
  assert.equal(t.subdomain, "", "own domains are gone — the template's web address starts empty"); assert.equal("domain" in t, false);
  const demo = await j("GET", "/api/demo-menu"); assert.equal(demo.json.data.length, 8, "the demo menu ships 8 categories");
});

test("save: bad names and slug mismatches are refused; a good save creates the file and reports problems", async () => {
  assert.equal((await j("PUT", "/api/clients/Bad_Name", filled("Bad_Name"))).status, 400);
  assert.equal((await j("PUT", "/api/clients/sunrise", { ...filled("sunrise"), slug: "other" })).status, 400);
  const create = await j("PUT", "/api/clients/sunrise", { ...filled("sunrise"), vercel: { token: "", project: null, teamId: null } });
  assert.equal(create.status, 201);
  assert.ok(create.json.data.problems.some((p) => p.startsWith("vercel.token")));
  const update = await j("PUT", "/api/clients/sunrise", filled("sunrise"));
  assert.equal(update.status, 200); assert.deepEqual(update.json.data.problems, []);
  const onDisk = JSON.parse(readFileSync(path.join(dir, "sunrise.json"), "utf8"));
  assert.equal(onDisk.accounts.vercel.password, "pw"); assert.equal(onDisk.notes, "hi");
});

test("server-owned fields (generated, lastRun) survive a browser save that omits or fakes them", async () => {
  const file = path.join(dir, "sunrise.json");
  const c = JSON.parse(readFileSync(file, "utf8")); c.generated = { host: "sunrise-x1.vercel.app", tenantId: "sunrise-x1", projectId: "prj_1" }; writeFileSync(file, JSON.stringify(c));
  await j("PUT", "/api/clients/sunrise", { ...filled("sunrise"), generated: { host: "evil" }, lastRun: { status: "ok" } });
  const after_ = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(after_.generated.host, "sunrise-x1.vercel.app"); assert.equal(after_.lastRun, undefined);
});

test("list summarizes each file; a broken JSON file is listed as broken, not fatal", async () => {
  writeFileSync(path.join(dir, "broken.json"), "{ not json");
  writeFileSync(path.join(dir, "notes.md"), "ignored");
  const { json } = await j("GET", "/api/clients");
  const names = json.data.map((c) => c.name);
  assert.deepEqual(names, ["broken", "sunrise"]);
  const s = json.data.find((c) => c.name === "sunrise");
  assert.equal(s.cafeName, "Sunrise Café"); assert.equal(s.host, "sunrise-x1.vercel.app"); assert.equal(s.problems, 0);
  assert.ok(s.webAddress && typeof s.webAddress.state === "string", "the summary carries the web-address state for the list view");
  assert.equal(json.data.find((c) => c.name === "broken").broken, true);
  rmSync(path.join(dir, "broken.json"));
});

test("web-address check: 200 with the ensureWebAddress status shape, driven by a fake Vercel fetch + a fake dnsCheck (own server instance so it never touches the shared fixture's clients)", async () => {
  const dir2 = mkdtempSync(path.join(os.tmpdir(), "golive-ui-webaddr-"));
  writeFileSync(path.join(dir2, "_platform.json"), JSON.stringify({ apexDomain: "sandbee.in", dnsNote: null }));
  const c = { ...filled("cafe2"), subdomain: "cafe2", generated: { projectId: "prj_9", orgId: "team_9", host: "cafe2-x1.vercel.app", tenantId: "cafe2-x1", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" } };
  writeFileSync(path.join(dir2, "cafe2.json"), JSON.stringify(c));

  const vercelFetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    if (u.hostname !== "api.vercel.com") return { status: 200, ok: true, json: async () => ({ ok: true }) };
    if (u.pathname === "/v9/projects/prj_9/domains/cafe2.sandbee.in") return { status: 404, ok: false, json: async () => ({ error: { code: "not_found" } }) };
    if (method === "POST" && u.pathname === "/v10/projects/prj_9/domains") return { status: 200, ok: true, json: async () => ({ name: "cafe2.sandbee.in", verified: true, verification: [] }) };
    if (u.pathname === "/v6/domains/cafe2.sandbee.in/config") return { status: 200, ok: true, json: async () => ({ misconfigured: false, configuredBy: "CNAME", recommendedCNAME: [{ rank: 1, value: "abc.vercel-dns-017.com" }] }) };
    return { status: 500, ok: false, json: async () => ({ error: { code: "unrouted", message: u.pathname } }) };
  };
  const fakeDnsCheck = { checkRecords: async () => ({ cname: { found: "abc.vercel-dns-017.com", ok: true }, txt: { found: [], ok: null } }), probeHealth: async () => ({ status: 200, body: { ok: true, db: "up", tenant: "cafe2" }, error: null }) };

  const srv2 = createServer({ root: ROOT, clientsDir: dir2, spawn, commandFor: fakeCommandFor, profilesPath: path.join(dir2, "deploy.profiles.json"), fetch: vercelFetch, dnsCheck: fakeDnsCheck });
  const port2 = await srv2.listen();
  const j2 = async (method, p, body) => { const res = await fetch(`http://127.0.0.1:${port2}${p}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json() }; };
  const r = await j2("POST", "/api/clients/cafe2/web-address/check", {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.data.host, "cafe2.sandbee.in");
  assert.equal(r.json.data.verified, true);
  assert.ok(["ready", "pending-verify", "pending-dns", "pending-cert"].includes(r.json.data.state));
  assert.ok(Array.isArray(r.json.data.records) && r.json.data.records.some((row) => row.type === "CNAME"));
  await srv2.close();
  rmSync(dir2, { recursive: true, force: true });
});

test("validate and health endpoints", async () => {
  const v = await j("POST", "/api/clients/sunrise/validate", {}); assert.deepEqual(v.json.data.problems, []);
  assert.equal((await j("POST", "/api/clients/ghost/validate", {})).status, 404);
  const h = await j("GET", "/api/clients/sunrise/health");
  assert.equal(h.json.data.ok, true); assert.equal(h.json.data.host, "sunrise-x1.vercel.app");
});

test("jobs: one at a time, streamed as SSE, ANSI stripped, lastRun recorded on the file", async () => {
  const start = await j("POST", "/api/jobs", { name: "sunrise", action: "redeploy" });
  assert.equal(start.status, 201); const id = start.json.data.id;
  assert.equal(lastClientPath, path.join(dir, "sunrise.json"), "the job is handed the client's FILE PATH from the console's folder");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "dry-run" })).status, 409, "second job while busy → 409");
  const text = await (await fetch(`${base}/api/jobs/${id}/stream`)).text();
  const events = text.split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")));
  const lines = events.filter((e) => e.type === "line").map((e) => e.line);
  assert.deepEqual(lines, ["$ redeploy sunrise", "deploying sunrise token ••• uri mongodb+srv://•••@c.mongodb.net/pos", "green done"], "the client's token is scrubbed from the streamed log and any URI's user:password is masked");
  assert.deepEqual(events[events.length - 1], { type: "done", status: "ok", exitCode: 0 });
  await new Promise((r) => setTimeout(r, 50));
  const onDisk = JSON.parse(readFileSync(path.join(dir, "sunrise.json"), "utf8"));
  assert.equal(onDisk.lastRun.action, "redeploy"); assert.equal(onDisk.lastRun.status, "ok");
  const failing = await j("POST", "/api/jobs", { name: "sunrise", action: "preview" });
  const t2 = await (await fetch(`${base}/api/jobs/${failing.json.data.id}/stream`)).text();
  assert.match(t2, /"status":"failed","exitCode":3/);
  assert.equal((await j("POST", "/api/jobs", { name: "ghost", action: "dry-run" })).status, 404);
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "rm-rf" })).status, 400);
  assert.equal((await fetch(`${base}/api/jobs/999/stream`)).status, 404);
});

// ── resumability fix round: lastRun must show "running" the INSTANT a job
// starts, not only once it finishes — plan-resume-after-fresh.md §5/§6. Own
// server + temp dir (a slow fake job, never used by the shared fixture above,
// whose jobs must stay fast so they don't slow down every other test).
test("GET /api/clients/:name shows lastRun.status \"running\" the moment a job starts (before it has finished), and \"ok\" once it completes", async () => {
  const dir3 = mkdtempSync(path.join(os.tmpdir(), "golive-ui-running-"));
  const slowCommandFor = (_root, action, name) => ({ cmd: process.execPath, args: ["-e", "setTimeout(() => { console.log('done'); process.exit(0); }, 300)"] });
  const srv3 = createServer({ root: ROOT, clientsDir: dir3, spawn, commandFor: slowCommandFor, profilesPath: path.join(dir3, "deploy.profiles.json") });
  const port3 = await srv3.listen();
  const j3 = async (method, p, body) => { const res = await fetch(`http://127.0.0.1:${port3}${p}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json() }; };

  writeFileSync(path.join(dir3, "sunrise.json"), JSON.stringify(filled("sunrise")));

  const start = await j3("POST", "/api/jobs", { name: "sunrise", action: "redeploy" });
  assert.equal(start.status, 201);

  // Immediately (the child is still running its 300ms setTimeout): lastRun must
  // already say "running" — recorded when the job STARTS, not only at the end.
  const whileRunning = await j3("GET", "/api/clients/sunrise");
  assert.equal(whileRunning.status, 200);
  assert.ok(whileRunning.json.data.lastRun, "lastRun must be recorded already, not still null/absent");
  assert.equal(whileRunning.json.data.lastRun.status, "running");
  assert.equal(whileRunning.json.data.lastRun.action, "redeploy");
  // The file on disk carries the same thing (not just an in-memory job-runner view).
  const onDiskWhileRunning = JSON.parse(readFileSync(path.join(dir3, "sunrise.json"), "utf8"));
  assert.equal(onDiskWhileRunning.lastRun.status, "running", "the running status is actually WRITTEN to the client file, not only held in memory");

  const text = await (await fetch(`http://127.0.0.1:${port3}/api/jobs/${start.json.data.id}/stream`)).text();
  assert.match(text, /"status":"ok"/);
  await new Promise((r) => setTimeout(r, 50));

  const afterDone = await j3("GET", "/api/clients/sunrise");
  assert.equal(afterDone.json.data.lastRun.status, "ok");

  await srv3.close(); rmSync(dir3, { recursive: true, force: true });
});

test("archive / restore: the record moves between clients/ and clients/_archive/, is listed separately, locks deploys, parks its deploy profile, and is never deleted", async () => {
  const profilesFile = path.join(dir, "deploy.profiles.json");
  writeFileSync(profilesFile, JSON.stringify({ lucifer007: { app: "apps/cafe", projectId: "prj_a" }, oldcafe: { app: "apps/cafe", orgId: "team_o", projectId: "prj_old", scope: null, tokenEnv: null, token: "tok_old" }, "oldcafe-standby": { app: "apps/cafe", projectId: "prj_old_sb", token: "tok_old_sb" } }));
  await j("PUT", "/api/clients/oldcafe", { ...filled("oldcafe"), standbyHosts: [{ label: "standby", vercel: { token: "tok_old_sb", project: null, teamId: null } }] });
  assert.equal((await j("POST", "/api/clients/ghost/archive", {})).status, 404);
  const a = await j("POST", "/api/clients/oldcafe/archive", {});
  assert.equal(a.status, 200); assert.deepEqual(a.json.data, { archived: "oldcafe" });
  assert.equal(existsSync(path.join(dir, "oldcafe.json")), false); assert.equal(existsSync(path.join(dir, "_archive", "oldcafe.json")), true);
  const archivedRecord = JSON.parse(readFileSync(path.join(dir, "_archive", "oldcafe.json"), "utf8"));
  assert.equal(archivedRecord.deployLock, true, "archiving locks deploys on the record (honoured by the CLI too)");
  assert.equal(archivedRecord.archivedProfiles.oldcafe.projectId, "prj_old", "its deploy profile is parked inside the record");
  assert.equal(archivedRecord.archivedProfiles["oldcafe-standby"].projectId, "prj_old_sb", "…and every standby's profile with it");
  const profilesAfter = JSON.parse(readFileSync(profilesFile, "utf8"));
  assert.equal("oldcafe" in profilesAfter, false, "…and removed from deploy.profiles.json, so `npm run deploy -- --profile oldcafe` cannot deploy a retired cafe");
  assert.equal("oldcafe-standby" in profilesAfter, false, "the standby profile is gone too");
  assert.deepEqual(profilesAfter.lucifer007, { app: "apps/cafe", projectId: "prj_a" }, "other profiles untouched");
  assert.ok(!(await j("GET", "/api/clients")).json.data.some((c) => c.name === "oldcafe"), "gone from the active list");
  const arch = (await j("GET", "/api/archive")).json.data; assert.equal(arch.length, 1); assert.equal(arch[0].name, "oldcafe"); assert.equal(arch[0].archived, true);
  assert.equal((await j("GET", "/api/clients/oldcafe")).status, 404, "an archived record is not addressable as active");
  assert.equal((await j("PUT", "/api/clients/oldcafe", filled("oldcafe"))).status, 409, "a NEW client cannot take an archived name (restore it instead)");
  const r = await j("POST", "/api/clients/oldcafe/restore", {}); assert.equal(r.status, 200);
  assert.equal(existsSync(path.join(dir, "oldcafe.json")), true); assert.equal((await j("GET", "/api/archive")).json.data.length, 0);
  const back = JSON.parse(readFileSync(path.join(dir, "oldcafe.json"), "utf8"));
  assert.equal(back.vercel.token, "tok_secret_123", "credentials survive the round trip");
  assert.equal(back.deployLock, true, "the lock stays until the owner unticks it"); assert.equal("archivedProfiles" in back, false);
  const restoredProfiles = JSON.parse(readFileSync(profilesFile, "utf8"));
  assert.equal(restoredProfiles.oldcafe.projectId, "prj_old", "the deploy profile is put back on restore"); assert.equal(restoredProfiles["oldcafe-standby"].projectId, "prj_old_sb", "…and the standby's");
  await j("POST", "/api/clients/oldcafe/archive", {});
  await j("PUT", "/api/clients/oldcafe2", { ...filled("oldcafe2") });
  assert.equal((await j("POST", "/api/clients/oldcafe2/archive", {})).status, 200, "a record without a deploy profile archives fine");
  rmSync(path.join(dir, "_archive"), { recursive: true, force: true }); rmSync(profilesFile);
});

test("detach-hosting forgets the recorded project (kept under previousHosting), keeps secrets and the seed date", async () => {
  const file = path.join(dir, "sunrise.json");
  const c = JSON.parse(readFileSync(file, "utf8"));
  c.generated = { projectId: "prj_old", orgId: "team_old", projectName: "sunrise", host: "sunrise-x1.vercel.app", tenantId: "sunrise-x1", rootDomain: "vercel.app", authSecret: "AUTH", healthStatsToken: "HS", seededAt: "2026-09-12T06:05:00.000Z" };
  writeFileSync(file, JSON.stringify(c));
  const r = await j("POST", "/api/clients/sunrise/detach-hosting", {});
  assert.equal(r.status, 200); assert.deepEqual(r.json.data, { detached: { projectId: "prj_old", host: "sunrise-x1.vercel.app" } });
  const g = JSON.parse(readFileSync(file, "utf8")).generated;
  for (const k of ["projectId", "orgId", "projectName", "host", "tenantId", "rootDomain"]) assert.equal(k in g, false, k);
  assert.equal(g.authSecret, "AUTH"); assert.equal(g.healthStatsToken, "HS"); assert.equal(g.seededAt, "2026-09-12T06:05:00.000Z");
  assert.equal(g.previousHosting.length, 1); assert.equal(g.previousHosting[0].projectId, "prj_old"); assert.ok(g.previousHosting[0].detachedAt);
  assert.equal((await j("POST", "/api/clients/sunrise/detach-hosting", {})).status, 400, "nothing recorded → 400");
  c.generated = { ...c.generated, previousHosting: g.previousHosting }; writeFileSync(file, JSON.stringify(c)); // restore the fixture's hosting for later tests
});

test("reset-demo job: refused for non-demo clients and wrong confirmations; deploy actions refused when deploys are locked", async () => {
  const file = path.join(dir, "sunrise.json");
  const c = JSON.parse(readFileSync(file, "utf8"));
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "reset-demo", confirm: "sunrise", confirmDb: "pos" })).status, 403, "not a demo client");
  c.demo = true; writeFileSync(file, JSON.stringify(c));
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "reset-demo", confirm: "wrong", confirmDb: "pos" })).status, 400, "confirmation must equal the slug");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "reset-demo", confirmDb: "pos" })).status, 400, "a missing confirmation never matches (undefined !== undefined must not pass)");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "reset-demo", confirm: "sunrise", confirmDb: "pos_shown_earlier" })).status, 409, "the database the owner was shown must be the one the SAVED file points at");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "reset-demo", confirm: "sunrise" })).status, 409, "no confirmDb → refused");
  const ok_ = await j("POST", "/api/jobs", { name: "sunrise", action: "reset-demo", confirm: "sunrise", confirmDb: "pos" });
  assert.equal(ok_.status, 201); assert.deepEqual(lastExtra, { confirm: "sunrise", confirmDb: "pos" }, "both confirmations are handed to the CLI");
  const text = await (await fetch(`${base}/api/jobs/${ok_.json.data.id}/stream`)).text(); assert.match(text, /reset sunrise confirm=sunrise/);
  c.demo = false; c.deployLock = true; writeFileSync(file, JSON.stringify(c));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "go-live" })).status, 403, "deploy lock is enforced server-side too");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "redeploy" })).status, 403);
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "dry-run" })).status, 201, "a dry run is still allowed under the lock");
  await (await fetch(`${base}/api/jobs/${(await j("GET", "/api/jobs/current")).json.data.id}/stream`)).text();
  c.deployLock = false; writeFileSync(file, JSON.stringify(c));
});

test("seed-demo job: same guards as reset-demo (403/400/409), imagesDir validation (400 on non-string/empty/too long), no host allowed, and both confirmations + imagesDir reach the CLI via `extra`", async () => {
  const file = path.join(dir, "sunrise.json");
  const c = JSON.parse(readFileSync(file, "utf8"));
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirm: "sunrise", confirmDb: "pos" })).status, 403, "not a demo client");
  c.demo = true; writeFileSync(file, JSON.stringify(c));
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirm: "wrong", confirmDb: "pos" })).status, 400, "confirmation must equal the slug");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirmDb: "pos" })).status, 400, "a missing confirmation never matches (undefined !== undefined must not pass)");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirm: "sunrise", confirmDb: "pos_shown_earlier" })).status, 409, "the database the owner was shown must be the one the SAVED file points at");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirm: "sunrise" })).status, 409, "no confirmDb → refused");

  // imagesDir validation: 400 on a non-string, an empty string, or something over 500 chars; absent/null is fine (photos skipped).
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirm: "sunrise", confirmDb: "pos", imagesDir: 123 })).status, 400, "imagesDir must be a string");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirm: "sunrise", confirmDb: "pos", imagesDir: "" })).status, 400, "imagesDir must not be empty when present");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirm: "sunrise", confirmDb: "pos", imagesDir: "x".repeat(501) })).status, 400, "imagesDir over 500 chars is refused");
  const noImages = await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirm: "sunrise", confirmDb: "pos", imagesDir: null });
  assert.equal(noImages.status, 201, "imagesDir: null is a valid, guard-free path (photos skipped)");
  assert.deepEqual(lastExtra, { confirm: "sunrise", confirmDb: "pos" }, "a null/absent imagesDir is never forwarded in extra");
  await (await fetch(`${base}/api/jobs/${noImages.json.data.id}/stream`)).text();

  // no host allowed — same rule as reset-demo, checked before the seed-demo-specific guards.
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirm: "sunrise", confirmDb: "pos", host: "standby" })).status, 400, "about the database, not a host");

  const ok_ = await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirm: "sunrise", confirmDb: "pos", imagesDir: "C:/Users/owner/Pictures/demo" });
  assert.equal(ok_.status, 201);
  assert.deepEqual(lastExtra, { confirm: "sunrise", confirmDb: "pos", imagesDir: "C:/Users/owner/Pictures/demo" }, "both confirmations AND imagesDir are handed to the CLI");
  const text = await (await fetch(`${base}/api/jobs/${ok_.json.data.id}/stream`)).text();
  assert.match(text, /seed-demo sunrise confirm=sunrise imagesDir=C:\/Users\/owner\/Pictures\/demo/);

  c.demo = false; c.deployLock = true; writeFileSync(file, JSON.stringify(c));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "seed-demo", confirm: "sunrise", confirmDb: "pos" })).status, 403, "not a demo client any more — checked before the deploy-lock branch even applies");
  c.demo = false; c.deployLock = false; writeFileSync(file, JSON.stringify(c));
});

test("standby records: a Save never wipes a standby's recorded project (server-owned by label); a label clashing with another client's slug is refused; health?host= checks the standby", async () => {
  const file = path.join(dir, "sunrise.json");
  const c = JSON.parse(readFileSync(file, "utf8"));
  c.standbyHosts = [{ label: "standby", vercel: { token: "tok_second_acct", project: null, teamId: null }, generated: { projectId: "prj_sb", orgId: "team_sb", host: "sunrise-standby-x1.vercel.app", tenantId: "sunrise-standby-x1", rootDomain: "vercel.app" } }];
  writeFileSync(file, JSON.stringify(c));
  const stale = { ...filled("sunrise"), standbyHosts: [{ label: "standby", vercel: { token: "tok_second_acct_edited", project: null, teamId: null } }, { label: "b2", vercel: { token: "tok_b2", project: null, teamId: null }, generated: { projectId: "prj_forged" } }] };
  assert.equal((await j("PUT", "/api/clients/sunrise", stale)).status, 200);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(saved.standbyHosts[0].vercel.token, "tok_second_acct_edited", "the owner's edit lands");
  assert.deepEqual(saved.standbyHosts[0].generated, c.standbyHosts[0].generated, "…but the recorded project/host come from disk, not from the stale tab");
  assert.equal("generated" in saved.standbyHosts[1], false, "a browser cannot forge a standby's recorded project");
  writeFileSync(path.join(dir, "sunrise-b2.json"), JSON.stringify(filled("sunrise-b2")));
  assert.equal((await j("PUT", "/api/clients/sunrise", stale)).status, 409, "standby 'b2' would be named 'sunrise-b2' — another client's slug");
  rmSync(path.join(dir, "sunrise-b2.json"));
  const h = await j("GET", "/api/clients/sunrise/health?host=standby");
  assert.equal(h.json.data.host, "sunrise-standby-x1.vercel.app"); assert.equal(h.json.data.hostLabel, "standby");
  assert.equal((await j("GET", "/api/clients/sunrise/health?host=nope")).status, 404);
  const { seededAt, ...neverSeeded } = saved.generated; writeFileSync(file, JSON.stringify({ ...saved, generated: neverSeeded }));
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "go-live", host: "standby" })).status, 400, "a standby cannot go live before the primary seeded the database");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "dry-run", host: "standby" })).status, 201, "a dry run is fine (nothing deploys)");
  await (await fetch(`${base}/api/jobs/${(await j("GET", "/api/jobs/current")).json.data.id}/stream`)).text();
  c.generated = { ...c.generated, seededAt: seededAt ?? "2026-09-12T06:05:00.000Z" };
  c.standbyHosts = [{ label: "standby", vercel: { token: "tok_second_acct", project: null, teamId: null } }]; writeFileSync(file, JSON.stringify(c));
});

test("jobs take a `host`: a saved standby label is passed to the CLI, an unknown one is refused, reset-demo never takes one", async () => {
  const file = path.join(dir, "sunrise.json");
  const c = JSON.parse(readFileSync(file, "utf8")); c.standbyHosts = [{ label: "standby", vercel: { token: "tok_second_acct", project: null, teamId: null } }]; writeFileSync(file, JSON.stringify(c));
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "dry-run", host: "nope" })).status, 400);
  const ok_ = await j("POST", "/api/jobs", { name: "sunrise", action: "dry-run", host: "standby" });
  assert.equal(ok_.status, 201); assert.equal(lastExtra.host, "standby"); assert.equal(ok_.json.data.host, "standby");
  const text = await (await fetch(`${base}/api/jobs/${ok_.json.data.id}/stream`)).text(); assert.match(text, /\$ dry-run sunrise --host standby/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(JSON.parse(readFileSync(file, "utf8")).lastRun.host, "standby", "lastRun remembers which host ran");
  const primary = await j("POST", "/api/jobs", { name: "sunrise", action: "dry-run", host: "primary" });
  assert.equal(primary.status, 201); assert.equal("host" in lastExtra, false, "primary is the default — no host handed to the CLI");
  await (await fetch(`${base}/api/jobs/${primary.json.data.id}/stream`)).text();
  c.demo = true; writeFileSync(file, JSON.stringify(c));
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "reset-demo", confirm: "sunrise", confirmDb: "pos", host: "standby" })).status, 400);
  c.demo = false; delete c.standbyHosts; writeFileSync(file, JSON.stringify(c));
  assert.deepEqual(commandFor("/r", "redeploy", "x", "/c/x.json", { host: "standby" }).args.slice(1), ["--profile", "x-standby"], "a standby redeploy targets its own profile");
  assert.deepEqual(commandFor("/r", "go-live", "x", "/c/x.json", { host: "standby" }).args.slice(1), ["/c/x.json", "--host", "standby"]);
  assert.deepEqual(commandFor("/r", "go-live", "x", "/c/x.json", { host: "primary" }).args.slice(1), ["/c/x.json"]);
});

test("delete: an active record with history is refused (archive first); a slip with no history is removed with its profile; archived records delete with typed confirmation", async () => {
  const profilesFile = path.join(dir, "deploy.profiles.json");
  await j("PUT", "/api/clients/slip", filled("slip"));
  writeFileSync(profilesFile, JSON.stringify({ slip: { app: "apps/cafe", projectId: "prj_slip" }, keep: { app: "apps/cafe" } }));
  assert.equal((await j("DELETE", "/api/clients/slip", { confirm: "wrong" })).status, 400);
  assert.equal((await j("DELETE", "/api/clients/sunrise", { confirm: "sunrise" })).status, 409, "the fixture has a recorded project → archive first");
  const d = await j("DELETE", "/api/clients/slip", { confirm: "slip" });
  assert.equal(d.status, 200); assert.equal(existsSync(path.join(dir, "slip.json")), false);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(profilesFile, "utf8"))), ["keep"], "its deploy profile went with it");
  assert.equal((await j("DELETE", "/api/clients/slip", { confirm: "slip" })).status, 404);
  await j("PUT", "/api/clients/oldone", filled("oldone")); await j("POST", "/api/clients/oldone/archive", {});
  assert.equal((await j("DELETE", "/api/archive/oldone", { confirm: "nope" })).status, 400);
  assert.equal((await j("DELETE", "/api/archive/oldone", { confirm: "oldone" })).status, 200);
  assert.equal(existsSync(path.join(dir, "_archive", "oldone.json")), false); assert.equal((await j("DELETE", "/api/archive/oldone", { confirm: "oldone" })).status, 404);
  rmSync(profilesFile);
});

test("rollout: deploys every deployed target one after another via redeploy jobs, records a failure and continues, blocks other jobs meanwhile, and a cut-off rollout is marked interrupted on the next start", async () => {
  const file = path.join(dir, "sunrise.json");
  const c = JSON.parse(readFileSync(file, "utf8"));
  c.standbyHosts = [{ label: "sb", vercel: { token: "tok_sb_acct" }, generated: { projectId: "prj_sb", host: "sunrise-sb.vercel.app" } }]; writeFileSync(file, JSON.stringify(c));
  await j("PUT", "/api/clients/never", filled("never")); // never deployed → skipped
  const bad = { ...filled("badcafe"), generated: { projectId: "prj_bad", host: "badcafe.vercel.app" } }; writeFileSync(path.join(dir, "badcafe.json"), JSON.stringify(bad)); // its redeploy will fail (fake exit 1)
  rolloutProfiles.length = 0; // earlier tests ran redeploys of their own
  const started = await j("POST", "/api/rollout", {});
  assert.equal(started.status, 201);
  assert.deepEqual(started.json.data.targets.map((t) => [t.profile, t.status]), [["badcafe", "running"], ["never", "skipped"], ["sunrise", "pending"], ["sunrise-sb", "pending"]]);
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "dry-run" })).status, 409, "no other job while a rollout runs");
  assert.equal((await j("POST", "/api/rollout", {})).status, 409, "no second rollout");
  for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 100)); if ((await j("GET", "/api/rollout")).json.data.summary.finished) break; }
  const done = (await j("GET", "/api/rollout")).json.data;
  assert.deepEqual(done.targets.map((t) => [t.profile, t.status]), [["badcafe", "failed"], ["never", "skipped"], ["sunrise", "ok"], ["sunrise-sb", "ok"]], "a failure is recorded and the queue continued to the end");
  assert.match(done.targets[0].error, /exit/); assert.ok(done.finishedAt);
  assert.deepEqual(rolloutProfiles, ["badcafe", "sunrise", "sunrise-sb"], "each target was a plain redeploy of its own profile, in order");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).lastRun.host, "sb", "the standby's lastRun is recorded per host");
  assert.ok(existsSync(path.join(dir, "_rollout.json")), "state lives on disk");
  const resumed = await j("POST", "/api/rollout/resume", {});
  assert.equal(resumed.status, 200); assert.equal(resumed.json.data.targets[0].status, "running", "retry re-runs only the failed target");
  for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 100)); if ((await j("GET", "/api/rollout")).json.data.summary.finished) break; }
  assert.equal((await j("DELETE", "/api/rollout", {})).status, 200); assert.equal((await j("GET", "/api/rollout")).json.data, null); assert.equal(existsSync(path.join(dir, "_rollout.json")), false);
  // A rollout cut off mid-deploy (PC switched off): on the next server start the running target is marked interrupted.
  const cut = { id: "1", label: "code update", startedAt: new Date().toISOString(), finishedAt: null, cancelRequested: false, targets: [{ name: "sunrise", host: "primary", profile: "sunrise", url: null, status: "ok" }, { name: "sunrise", host: "sb", profile: "sunrise-sb", url: null, status: "running" }] };
  writeFileSync(path.join(dir, "_rollout.json"), JSON.stringify(cut));
  const second = createServer({ root: ROOT, clientsDir: dir, spawn, commandFor: fakeCommandFor, profilesPath: path.join(dir, "deploy.profiles.json") });
  const port2 = await second.listen();
  const seen = await (await fetch(`http://127.0.0.1:${port2}/api/rollout`)).json();
  assert.equal(seen.data.targets[1].status, "interrupted"); assert.match(seen.data.targets[1].error, /outcome unknown/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, "_rollout.json"), "utf8")).targets[1].status, "interrupted", "…and persisted");
  await second.close();
  rmSync(path.join(dir, "_rollout.json")); rmSync(path.join(dir, "badcafe.json")); rmSync(path.join(dir, "never.json"));
  delete c.standbyHosts; writeFileSync(file, JSON.stringify(c));
});

test("rollout lock across processes: a live CLI lock makes the console read-only for that rollout (409 on start/resume, no 'interrupted' relabel); a dead lock is taken over", async () => {
  const lockFile = path.join(dir, "_rollout.lock"); const stateFile = path.join(dir, "_rollout.json");
  const live = { id: "77", label: "code update", startedAt: new Date().toISOString(), finishedAt: null, cancelRequested: false, targets: [{ name: "sunrise", host: "primary", profile: "sunrise", url: null, status: "running" }] };
  writeFileSync(stateFile, JSON.stringify(live)); writeFileSync(lockFile, JSON.stringify({ owner: "cli", pid: 424242, at: "x" }));
  const alive = new Set([424242]);
  const other = createServer({ root: ROOT, clientsDir: dir, spawn, commandFor: fakeCommandFor, profilesPath: path.join(dir, "deploy.profiles.json"), pid: 1, isAlive: (p) => alive.has(p) });
  const port2 = await other.listen(); const j2 = async (m, p) => { const r = await fetch(`http://127.0.0.1:${port2}${p}`, { method: m, headers: { "content-type": "application/json" }, body: m === "GET" ? undefined : "{}" }); return { status: r.status, json: await r.json() }; };
  const view = await j2("GET", "/api/rollout");
  assert.equal(view.json.data.targets[0].status, "running", "a CLI-driven rollout is NOT relabelled interrupted while the CLI lives");
  assert.equal(view.json.data.drivenBy, "cli (pid 424242)");
  assert.equal((await j2("POST", "/api/rollout")).status, 409); assert.equal((await j2("POST", "/api/rollout/resume")).status, 409); assert.equal((await j2("DELETE", "/api/rollout")).status, 409);
  alive.delete(424242); // the CLI process is gone (PC off) → the lock is stale
  const resumed = await j2("POST", "/api/rollout/resume");
  assert.equal(resumed.status, 200, "a dead holder is taken over"); assert.equal(JSON.parse(readFileSync(lockFile, "utf8")).pid, 1, "the console now holds the lock");
  for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 100)); if ((await j2("GET", "/api/rollout")).json.data.summary.finished) break; }
  assert.equal((await j2("GET", "/api/rollout")).json.data.targets[0].status, "ok");
  assert.equal(existsSync(lockFile), false, "the lock is released when the queue is done");
  assert.equal((await j2("DELETE", "/api/rollout")).status, 200);
  await other.close();
});

test("every request needs our own loopback Host (DNS-rebinding pages get 403, reads included)", async () => {
  const port = srv.port();
  assert.equal(hostAllowed({ host: `127.0.0.1:${port}` }, port), true);
  assert.equal(hostAllowed({ host: `localhost:${port}` }, port), true);
  assert.equal(hostAllowed({ host: "evil.example:4848" }, 4848), false);
  assert.equal(hostAllowed({}, 4848), false);
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/clients/sunrise", method: "GET", headers: { host: `evil.example:${port}` } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject); req.end();
  });
  assert.equal(status, 403, "a rebinding page cannot read the credential file");
});

test("mutations need same-origin + JSON content type", async () => {
  assert.equal((await j("PUT", "/api/clients/sunrise", filled("sunrise"), { origin: "https://evil.example" })).status, 403);
  assert.equal((await j("PUT", "/api/clients/sunrise", filled("sunrise"), { origin: base })).status, 200);
  const noType = await fetch(base + "/api/jobs", { method: "POST", body: "{}" }); assert.equal(noType.status, 400);
  assert.equal(originAllowed({}, 4848), true);
  assert.equal(originAllowed({ origin: "http://localhost:4848" }, 4848), true);
  assert.equal(originAllowed({ origin: "http://127.0.0.1:4849" }, 4848), false);
});

test("pure helpers: commandFor, cleanLines, clientTemplate, summarize", () => {
  assert.deepEqual(commandFor("/r", "redeploy", "x").args.slice(1), ["--profile", "x"]);
  assert.match(commandFor("/r", "go-live", "x").args[0], /go-live[\\/]index\.mjs$/);
  assert.deepEqual(commandFor("/r", "dry-run", "x").args.slice(1), ["x", "--dry-run"]);
  assert.deepEqual(commandFor("/r", "dry-run", "x", "/c/x.json").args.slice(1), ["/c/x.json", "--dry-run"], "go-live actions take the client file path when given");
  assert.deepEqual(commandFor("/r", "redeploy", "x", "/c/x.json").args.slice(1), ["--profile", "x"], "redeploy stays by profile name");
  assert.throws(() => commandFor("/r", "nuke", "x"));
  assert.deepEqual(cleanLines("\u001b[32mok\u001b[0m\r\nspin1\rspin2\n\n  \nlast"), ["ok", "spin2", "last"]);
  const t = clientTemplate({ _readme: ["x"], slug: "<s>", cafe: { name: "<n>", tagline: "" }, extra: 1 });
  assert.equal(t._readme, undefined); assert.equal(t.slug, ""); assert.equal(t.cafe.name, ""); assert.equal(t.extra, 1);
  const s = summarize("a", { slug: "a", cafe: { name: "A" }, generated: { host: "a.vercel.app" }, lastRun: { status: "ok" } });
  assert.equal(s.host, "a.vercel.app"); assert.ok(s.problems > 0);
});

// ---- Platform / web-address tests (run LAST: setting clients/_platform.json on
// the shared fixture makes `subdomain` required for any NEW, undeployed client —
// every earlier test in this file saves plain `filled()` fixtures with no
// subdomain and must keep working, so nothing above this point may leave the
// platform file behind). ---------------------------------------------------

test("platform: GET starts null (legacy mode), PUT saves it, GET reflects it; changing the apex while a client is on the old one is refused", async () => {
  assert.deepEqual((await j("GET", "/api/platform")).json.data, null);
  const bad = await j("PUT", "/api/platform", { apexDomain: "Not Valid!" });
  assert.equal(bad.status, 400);
  const put = await j("PUT", "/api/platform", { apexDomain: "sandbee.in", dnsNote: "GoDaddy → My Products → sandbee.in → DNS" });
  assert.equal(put.status, 200); assert.deepEqual(put.json.data, { saved: true });
  assert.deepEqual((await j("GET", "/api/platform")).json.data, { apexDomain: "sandbee.in", dnsNote: "GoDaddy → My Products → sandbee.in → DNS" });

  // A client already carrying a web address on the CURRENT apex blocks a change to a different apex.
  const file = path.join(dir, "sunrise.json");
  const c = JSON.parse(readFileSync(file, "utf8"));
  c.generated = { ...c.generated, host: "sunrise.sandbee.in", webAddress: { host: "sunrise.sandbee.in", state: "live" } };
  writeFileSync(file, JSON.stringify(c));
  const blocked = await j("PUT", "/api/platform", { apexDomain: "other.in" });
  assert.equal(blocked.status, 409); assert.match(blocked.json.error, /sunrise/);
  assert.deepEqual((await j("GET", "/api/platform")).json.data.apexDomain, "sandbee.in", "the refused change never landed");
  delete c.generated.webAddress; c.generated.host = null; writeFileSync(file, JSON.stringify(c));
});

test("client GET migrates a legacy `domain` field to `subdomain` on read (never written back until the next Save)", async () => {
  const file = path.join(dir, "legacy.json");
  writeFileSync(file, JSON.stringify({ ...filled("legacy"), domain: "legacy.sandbee.in" }));
  const g = await j("GET", "/api/clients/legacy");
  assert.equal(g.status, 200);
  assert.equal(g.json.data.subdomain, "legacy", "the migration promoted domain → subdomain for the response");
  assert.equal("domain" in g.json.data, false);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).domain, "legacy.sandbee.in", "the file on disk is untouched until a Save persists the migration");
});

test("save: a subdomain equal to another record's is refused, active or archived, case-insensitively", async () => {
  await j("PUT", "/api/clients/sunrise", { ...filled("sunrise"), subdomain: "lucifer" });
  const clash = await j("PUT", "/api/clients/other", { ...filled("other"), subdomain: "Lucifer" });
  assert.equal(clash.status, 409);
  assert.match(clash.json.error, /sunrise/);
  assert.equal(existsSync(path.join(dir, "other.json")), false, "the conflicting file was never written");
  // Archived clients count too.
  await j("PUT", "/api/clients/parked", { ...filled("parked"), subdomain: "archived-sub" });
  await j("POST", "/api/clients/parked/archive", {});
  const clashArchived = await j("PUT", "/api/clients/newone", { ...filled("newone"), subdomain: "archived-sub" });
  assert.equal(clashArchived.status, 409);
  assert.match(clashArchived.json.error, /parked/);
});

test("web-address check: 409 while a job runs for the same client", async () => {
  const file = path.join(dir, "sunrise.json");
  const c = JSON.parse(readFileSync(file, "utf8"));
  c.generated = { ...c.generated, projectId: "prj_check", orgId: "team_check", host: "sunrise-x1.vercel.app" };
  writeFileSync(file, JSON.stringify({ ...c, subdomain: "lucifer" }));

  const busy = await j("POST", "/api/jobs", { name: "sunrise", action: "redeploy" });
  assert.equal(busy.status, 201);
  const checkWhileBusy = await j("POST", "/api/clients/sunrise/web-address/check", {});
  assert.equal(checkWhileBusy.status, 409);
  await (await fetch(`${base}/api/jobs/${busy.json.data.id}/stream`)).text(); // drain so the process exits cleanly
  await new Promise((r) => setTimeout(r, 50));

  const checkNoSuchClient = await j("POST", "/api/clients/no-such-client/web-address/check", {});
  assert.equal(checkNoSuchClient.status, 404, "no such client");
});

// ── Fresh start on Vercel — POST /api/jobs guards (plan-admin-fresh.md §A.4) ─
test("fresh-start job: refused with no recorded project, wrong slug, wrong project name, a host, or a deploy lock; a good request reaches the CLI with both confirmations", async () => {
  const file = path.join(dir, "sunrise.json");
  const c = { ...filled("sunrise") };
  writeFileSync(file, JSON.stringify(c));
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "fresh-start", confirm: "sunrise", confirmProject: "sunrise" })).status, 400, "no generated.projectId yet → nothing to clean up");

  c.generated = { projectId: "prj_live", orgId: "team_x", projectName: "sunrise", host: "sunrise-x1.vercel.app", tenantId: "sunrise-x1", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" };
  writeFileSync(file, JSON.stringify(c));

  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "fresh-start", confirm: "wrong-slug", confirmProject: "sunrise" })).status, 400, "typed slug must equal the client's slug");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "fresh-start", confirmProject: "sunrise" })).status, 400, "a missing confirm never matches (undefined !== undefined must not pass)");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "fresh-start", confirm: "sunrise", confirmProject: "wrong-project-name" })).status, 409, "typed project name must equal the recorded generated.projectName");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "fresh-start", confirm: "sunrise" })).status, 409, "a missing confirmProject never matches either");
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "fresh-start", confirm: "sunrise", confirmProject: "sunrise", host: "standby" })).status, 400, "fresh start is primary-only — a host is refused");

  c.deployLock = true; writeFileSync(file, JSON.stringify(c));
  assert.equal((await j("POST", "/api/jobs", { name: "sunrise", action: "fresh-start", confirm: "sunrise", confirmProject: "sunrise" })).status, 403, "the deploy lock covers fresh-start too");
  c.deployLock = false; writeFileSync(file, JSON.stringify(c));

  const ok_ = await j("POST", "/api/jobs", { name: "sunrise", action: "fresh-start", confirm: "sunrise", confirmProject: "sunrise" });
  assert.equal(ok_.status, 201);
  assert.deepEqual(lastExtra, { confirm: "sunrise", confirmDb: undefined, confirmProject: "sunrise" }, "both confirmations are handed through to the CLI (confirmDb is simply absent for this action)");
  const text = await (await fetch(`${base}/api/jobs/${ok_.json.data.id}/stream`)).text();
  assert.match(text, /fresh-start sunrise confirm=sunrise confirmProject=sunrise/);
});

test("commandFor('fresh-start', …): the CLI flags carry the client path and both confirmations, in the shape index.mjs's --fresh-start parser expects", () => {
  const r = commandFor("/root", "fresh-start", "sunrise", "/root/clients/sunrise.json", { confirm: "sunrise", confirmProject: "sunrise" });
  assert.equal(r.cmd, process.execPath);
  assert.match(r.args[0], /index\.mjs$/);
  assert.deepEqual(r.args.slice(1), ["/root/clients/sunrise.json", "--fresh-start", "--confirm", "sunrise", "--confirm-project", "sunrise"]);
  // A missing confirm/confirmProject must never silently become the literal string "undefined" on the command line.
  const empty = commandFor("/root", "fresh-start", "sunrise", "/root/clients/sunrise.json", {});
  assert.deepEqual(empty.args.slice(1), ["/root/clients/sunrise.json", "--fresh-start", "--confirm", "", "--confirm-project", ""]);
});

// ── Per-client lock + Force (plan-locks-force.md §1-4) ──────────────────────
// A live lock file for a client (owner "cli"/"rollout"/"deploy" — i.e. NOT this
// console's own running job) must 409 every mutating route for that client, from
// ANY tab/process; GET /api/locks must report it; Force lets the owner kill a
// stuck process and free the lock, or stop the console's OWN running job.
//
// NOT LANDED YET at the time this file was written: createServer accepts no
// killTree/processInfo deps, and none of /api/locks, /api/jobs/:id/stop or
// /api/locks/:slug/force-release exist — every test below is written against
// the plan's exact names/shapes (§1-§4) and is EXPECTED to fail until the core
// and UI implementers land lock.mjs + the corresponding ui-server.mjs routes.
// Own server instances (own temp clientsDir) so a stuck/never-cleaned lock file
// from a failing assertion can never leak into the shared fixture's `dir`.
test("GET /api/locks: live client locks (with a `stale` dead-pid count) + the rollout lock + the current job summary — plan §2", async () => {
  const dir3 = mkdtempSync(path.join(os.tmpdir(), "golive-ui-locks-"));
  const alive = new Set([424243]);
  const srv3 = createServer({ root: ROOT, clientsDir: dir3, spawn, commandFor: fakeCommandFor, profilesPath: path.join(dir3, "deploy.profiles.json"), pid: 1, isAlive: (p) => alive.has(p) });
  const port3 = await srv3.listen();
  const j3 = async (m, p) => { const r = await fetch(`http://127.0.0.1:${port3}${p}`, { method: m }); return { status: r.status, json: await r.json() }; };
  mkdirSync(path.join(dir3, "_locks"), { recursive: true });
  writeFileSync(path.join(dir3, "_locks", "sunrise.lock"), JSON.stringify({ slug: "sunrise", pid: 424243, action: "go-live", owner: "cli", at: "2026-09-13T00:00:00.000Z" }));
  writeFileSync(path.join(dir3, "_locks", "stale-one.lock"), JSON.stringify({ slug: "stale-one", pid: 999999, action: "redeploy", owner: "deploy", at: "2026-09-13T00:00:00.000Z" }));
  const r = await j3("GET", "/api/locks");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(Array.isArray(r.json.data.clients), "clients is a list — plan §2 GET /api/locks shape");
  const live = r.json.data.clients.find((c) => c.slug === "sunrise");
  assert.ok(live, "the live lock is reported");
  assert.equal(live.alive, true);
  assert.equal(r.json.data.clients.some((c) => c.slug === "stale-one"), false, "a dead-pid lock is 'live ones only' — not listed as a live client lock");
  assert.equal(r.json.data.stale, 1, "the dead-pid lock is counted separately as `stale`");
  assert.ok("rollout" in r.json.data, "rollout key present (null when nothing is running)");
  assert.ok("job" in r.json.data, "job key present — jobs.summary(current)");
  await srv3.close();
  rmSync(dir3, { recursive: true, force: true });
});

test("POST /api/jobs and /api/clients/:name/web-address/check: 409 with { lock } when a LIVE lock exists for that client (from another process); a dead-pid lock never blocks — plan §2", async () => {
  const dir4 = mkdtempSync(path.join(os.tmpdir(), "golive-ui-locked-"));
  writeFileSync(path.join(dir4, "_platform.json"), JSON.stringify({ apexDomain: "sandbee.in", dnsNote: null }));
  writeFileSync(path.join(dir4, "sunrise.json"), JSON.stringify(filled("sunrise")));
  const alive = new Set([777777]);
  const srv4 = createServer({ root: ROOT, clientsDir: dir4, spawn, commandFor: fakeCommandFor, profilesPath: path.join(dir4, "deploy.profiles.json"), pid: 1, isAlive: (p) => alive.has(p) });
  const port4 = await srv4.listen();
  const j4 = async (method, p, body) => { const res = await fetch(`http://127.0.0.1:${port4}${p}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json() }; };
  mkdirSync(path.join(dir4, "_locks"), { recursive: true });
  writeFileSync(path.join(dir4, "_locks", "sunrise.lock"), JSON.stringify({ slug: "sunrise", pid: 777777, action: "go-live", owner: "cli", at: "2026-09-13T00:00:00.000Z" }));

  const busy = await j4("POST", "/api/jobs", { name: "sunrise", action: "dry-run" });
  assert.equal(busy.status, 409, "a live foreign lock blocks even a dry-run, from the console");
  assert.ok(busy.json.error && /sunrise/.test(busy.json.error) && /cli/.test(busy.json.error), "the message names the slug and the owner (lockMessage shape)");
  assert.ok(busy.json.lock && busy.json.lock.pid === 777777, "the lock itself travels in the error payload as `lock` — fail(res, 409, msg, { lock })");

  const check = await j4("POST", "/api/clients/sunrise/web-address/check", {});
  assert.equal(check.status, 409, "the web-address check is guarded by the same client lock");

  alive.delete(777777); // the process died — the lock is stale
  const afterDead = await j4("POST", "/api/jobs", { name: "sunrise", action: "dry-run" });
  assert.notEqual(afterDead.status, 409, "a dead-pid lock never blocks — it is taken over, not honoured");
  if (afterDead.status === 201) await (await fetch(`http://127.0.0.1:${port4}/api/jobs/${afterDead.json.data.id}/stream`)).text();

  await srv4.close();
  rmSync(dir4, { recursive: true, force: true });
});

test("POST /api/jobs/:id/stop: stops the RUNNING console job — status \"stopped\", SSE done carries \"stopped\", lastRun records \"stopped\"; 404 unknown id; 409 not running — plan §3", async () => {
  const dir5 = mkdtempSync(path.join(os.tmpdir(), "golive-ui-stop-"));
  writeFileSync(path.join(dir5, "sunrise.json"), JSON.stringify(filled("sunrise")));
  const killed = [];
  const fakeKillTree = (pid) => { killed.push(pid); };
  const srv5 = createServer({ root: ROOT, clientsDir: dir5, spawn, commandFor: fakeCommandFor, profilesPath: path.join(dir5, "deploy.profiles.json"), killTree: fakeKillTree });
  const port5 = await srv5.listen();
  const j5 = async (method, p, body) => { const res = await fetch(`http://127.0.0.1:${port5}${p}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json() }; };

  assert.equal((await j5("POST", "/api/jobs/999/stop", {})).status, 404, "unknown job id");
  await srv5.close();

  // A slow fake job — the plan's own recipe (`node -e "setTimeout(()=>{}, 60000)"`),
  // shortened to a few seconds so an unimplemented /stop fails this test in
  // seconds rather than hanging for a full minute; the child is killed directly
  // (not through the route under test) as a safety net regardless of the route's
  // outcome, so no stray node process survives a failing assertion here.
  const SLOW_JOB_MS = 4000;
  const STOP_WAIT_MS = 3000;
  const dir5b = mkdtempSync(path.join(os.tmpdir(), "golive-ui-stop2-"));
  writeFileSync(path.join(dir5b, "sunrise.json"), JSON.stringify(filled("sunrise")));
  const slowCommandFor = () => ({ cmd: process.execPath, args: ["-e", `setTimeout(() => {}, ${SLOW_JOB_MS})`] });
  // Track the real spawned child ourselves as a safety net: if /api/jobs/:id/stop
  // is not implemented (or fails to kill it), we still reap it below so no node
  // process outlives this test for the full SLOW_JOB_MS.
  const spawnedChildren = [];
  const trackingSpawn = (...args) => { const child = spawn(...args); spawnedChildren.push(child); return child; };
  const srv5b = createServer({ root: ROOT, clientsDir: dir5b, spawn: trackingSpawn, commandFor: slowCommandFor, profilesPath: path.join(dir5b, "deploy.profiles.json"), killTree: fakeKillTree });
  const port5b = await srv5b.listen();
  const j5b = async (method, p, body) => { const res = await fetch(`http://127.0.0.1:${port5b}${p}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json() }; };
  const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms — /api/jobs/:id/stop did not end the job`)), ms));

  const start = await j5b("POST", "/api/jobs", { name: "sunrise", action: "dry-run" });
  assert.equal(start.status, 201);
  const id = start.json.data.id;
  const streamPromise = (async () => (await fetch(`http://127.0.0.1:${port5b}/api/jobs/${id}/stream`)).text())();
  await new Promise((r) => setTimeout(r, 100)); // let the child actually spawn before we stop it
  const stop = await j5b("POST", `/api/jobs/${id}/stop`, {});
  assert.equal(stop.status, 200, JSON.stringify(stop.json));
  assert.equal(stop.json.data.status, "stopped");
  let streamed;
  try {
    streamed = await Promise.race([streamPromise, timeout(STOP_WAIT_MS)]);
  } finally {
    // Safety net: kill the real child regardless of whether the route under test
    // actually stopped it, so a failing assertion never leaves a node process
    // running for the full SLOW_JOB_MS on this machine.
    for (const child of spawnedChildren) { try { if (!child.killed) child.kill(); } catch { /* already gone */ } }
  }
  assert.match(streamed, /"status":"stopped"/, "the SSE done event carries status \"stopped\"");
  await new Promise((r) => setTimeout(r, 50));
  const onDisk = JSON.parse(readFileSync(path.join(dir5b, "sunrise.json"), "utf8"));
  assert.equal(onDisk.lastRun.status, "stopped", "lastRun records the stop");
  const secondStop = await j5b("POST", `/api/jobs/${id}/stop`, {});
  assert.equal(secondStop.status, 409, "a job already finished (stopped) cannot be stopped again");
  await srv5b.close();
  rmSync(dir5b, { recursive: true, force: true });
  rmSync(dir5, { recursive: true, force: true });
});

test("POST /api/locks/:slug/force-release: kills+releases when the pid is verified ours (fake processInfo/killTree/isAlive injected via createServer); refuses+removes-file-only when the pid is not ours; wrong/missing confirm → 400 — plan §3", async () => {
  const dir6 = mkdtempSync(path.join(os.tmpdir(), "golive-ui-force-"));
  writeFileSync(path.join(dir6, "sunrise.json"), JSON.stringify(filled("sunrise")));
  mkdirSync(path.join(dir6, "_locks"), { recursive: true });
  const LOCK_AT = "2026-09-13T05:00:00.000Z";
  writeFileSync(path.join(dir6, "_locks", "sunrise.lock"), JSON.stringify({ slug: "sunrise", pid: 55555, action: "go-live", owner: "cli", at: LOCK_AT }));

  let stillAlive = true;
  const killedPids = [];
  const fakeKillTree = (pid) => { killedPids.push(pid); stillAlive = false; };
  const fakeIsAlive = (pid) => (pid === 55555 ? stillAlive : false);
  // Ours: a node process started within PID_MATCH_TOLERANCE_MS of lock.at.
  const oursProcessInfo = (_pid) => ({ name: "node", startedAt: LOCK_AT });
  const srv6 = createServer({ root: ROOT, clientsDir: dir6, spawn, commandFor: fakeCommandFor, profilesPath: path.join(dir6, "deploy.profiles.json"), killTree: fakeKillTree, processInfo: oursProcessInfo, isAlive: fakeIsAlive });
  const port6 = await srv6.listen();
  const j6 = async (method, p, body) => { const res = await fetch(`http://127.0.0.1:${port6}${p}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json() }; };

  assert.equal((await j6("POST", "/api/locks/sunrise/force-release", { confirm: "wrong" })).status, 400, "wrong typed slug → 400");
  assert.equal((await j6("POST", "/api/locks/sunrise/force-release", {})).status, 400, "missing confirm → 400");

  const r = await j6("POST", "/api/locks/sunrise/force-release", { confirm: "sunrise" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.data, { released: true, killed: true });
  assert.deepEqual(killedPids, [55555]);
  assert.equal(existsSync(path.join(dir6, "_locks", "sunrise.lock")), false, "the lock file is removed once the process is confirmed dead");

  // Not ours: processInfo says a DIFFERENT process now owns that pid (recycled by the OS).
  writeFileSync(path.join(dir6, "_locks", "sunrise.lock"), JSON.stringify({ slug: "sunrise", pid: 66666, action: "redeploy", owner: "deploy", at: LOCK_AT }));
  const notOursProcessInfo = (_pid) => ({ name: "chrome", startedAt: "2020-01-01T00:00:00.000Z" });
  const srv6b = createServer({ root: ROOT, clientsDir: dir6, spawn, commandFor: fakeCommandFor, profilesPath: path.join(dir6, "deploy.profiles.json"), killTree: fakeKillTree, processInfo: notOursProcessInfo, isAlive: (pid) => pid === 66666 });
  const port6b = await srv6b.listen();
  const j6b = async (method, p, body) => { const res = await fetch(`http://127.0.0.1:${port6b}${p}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, json: await res.json() }; };
  const notOurs = await j6b("POST", "/api/locks/sunrise/force-release", { confirm: "sunrise" });
  assert.equal(notOurs.status, 409, "the pid is not verified as our own process — refused, not force-killed");
  assert.match(notOurs.json.error, /not our process/i);
  assert.equal(existsSync(path.join(dir6, "_locks", "sunrise.lock")), false, "even when refused, the stale file is removed (it can never be our lock any more)");

  await srv6.close(); await srv6b.close();
  rmSync(dir6, { recursive: true, force: true });
});

test("fresh-start confirmProject falls back to vercel.project, then the slug, when generated.projectName is missing — a 409 only when it TRULY differs from whichever of those applies", async () => {
  const file = path.join(dir, "fallback-cafe.json");
  // No generated.projectName at all (an older record, or one saved before the field existed);
  // vercel.project set → that is the fallback, NOT the slug.
  const withProject = { ...filled("fallback-cafe"), vercel: { token: "tok_secret_123", project: "custom-project-name", teamId: null }, generated: { projectId: "prj_live", orgId: "team_x", host: "fallback-cafe-x1.vercel.app", tenantId: "fallback-cafe-x1", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" } };
  writeFileSync(file, JSON.stringify(withProject));
  assert.equal((await j("POST", "/api/jobs", { name: "fallback-cafe", action: "fresh-start", confirm: "fallback-cafe", confirmProject: "fallback-cafe" })).status, 409, "the slug alone is wrong while vercel.project is set — that takes priority");
  const okProject = await j("POST", "/api/jobs", { name: "fallback-cafe", action: "fresh-start", confirm: "fallback-cafe", confirmProject: "custom-project-name" });
  assert.equal(okProject.status, 201, "vercel.project is accepted when generated.projectName is absent");
  await (await fetch(`${base}/api/jobs/${okProject.json.data.id}/stream`)).text();

  // No generated.projectName AND no vercel.project → the slug itself is the fallback.
  const file2 = path.join(dir, "fallback-cafe2.json");
  const noProjectField = { ...filled("fallback-cafe2"), vercel: { token: "tok_secret_123", project: null, teamId: null }, generated: { projectId: "prj_live2", orgId: "team_x", host: "fallback-cafe2-x1.vercel.app", tenantId: "fallback-cafe2-x1", rootDomain: "vercel.app", authSecret: "A", healthStatsToken: "H", seededAt: "2026-09-12T00:00:00.000Z" } };
  writeFileSync(file2, JSON.stringify(noProjectField));
  assert.equal((await j("POST", "/api/jobs", { name: "fallback-cafe2", action: "fresh-start", confirm: "fallback-cafe2", confirmProject: "something-else" })).status, 409);
  const okSlug = await j("POST", "/api/jobs", { name: "fallback-cafe2", action: "fresh-start", confirm: "fallback-cafe2", confirmProject: "fallback-cafe2" });
  assert.equal(okSlug.status, 201, "the slug itself is accepted when neither generated.projectName nor vercel.project is set");
  await (await fetch(`${base}/api/jobs/${okSlug.json.data.id}/stream`)).text();
});
