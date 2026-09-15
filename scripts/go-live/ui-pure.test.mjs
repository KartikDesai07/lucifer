// node --test scripts/go-live/ui-pure.test.mjs — the console's DOM-free rules
// (ui/pure.mjs) plus source pins on ui/app.js for the two behaviours a DOM-less
// test cannot execute: locked (disabled) inputs still round-trip through collect(),
// and the seed cards are the ones applyLocks() disables.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CLONE_CLEARED, cloneTemplateOf, dbNameOf, lockStateOf, needsUriConfirm, runStateOf, subdomainFromInput, tablesFromForm, webAddressStateOf } from "./ui/pure.mjs";
import { ACTIONS, commandFor } from "./ui-jobs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(path.join(HERE, "ui", "app.js"), "utf8");
const indexHtml = readFileSync(path.join(HERE, "ui", "index.html"), "utf8");
const shellJs = readFileSync(path.join(HERE, "ui", "shell.js"), "utf8");
const activityJs = readFileSync(path.join(HERE, "ui", "activity.js"), "utf8");

test("lockStateOf: seededAt or a finished go-live means seeded; projectId means deployed", () => {
  assert.deepEqual(lockStateOf(null), { seeded: false, seededAt: null, deployed: false, configured: false });
  assert.deepEqual(lockStateOf({ generated: { seededAt: "2026-09-12T06:05:00.000Z", projectId: "prj_1" } }), { seeded: true, seededAt: "2026-09-12T06:05:00.000Z", deployed: true, configured: false }, "deployed (projectId) but no host recorded yet — an interrupted run, e.g. Fresh start stopped before env/deploy");
  assert.deepEqual(lockStateOf({ lastRun: { action: "go-live", status: "ok", at: "2026-09-12T06:09:00.000Z" } }), { seeded: true, seededAt: "2026-09-12T06:09:00.000Z", deployed: false, configured: false }, "pre-seededAt files: a go-live can only end ok after its seed ran");
  assert.equal(lockStateOf({ lastRun: { action: "go-live", status: "failed", at: "x" } }).seeded, false, "a failed go-live never counts as seeded");
  assert.equal(lockStateOf({ lastRun: { action: "dry-run", status: "ok", at: "x" } }).seeded, false);
  assert.equal(lockStateOf({ lastRun: { action: "redeploy", status: "ok", at: "x" }, generated: { projectId: "p" } }).seeded, false, "a redeploy proves deployment, not a seed");
});

test("lockStateOf.configured: true only once a host is recorded — a project that exists (deployed:true) with NO host yet (env/deploy never finished) is NOT configured", () => {
  assert.equal(lockStateOf(null).configured, false);
  assert.equal(lockStateOf({ generated: { projectId: "prj_1" } }).configured, false, "deployed, but no host: the interrupted-run case this fix round is about");
  assert.equal(lockStateOf({ generated: { projectId: "prj_1", host: "sunrise-x1.vercel.app" } }).configured, true);
  assert.equal(lockStateOf({ generated: { host: "sunrise-x1.vercel.app" } }).configured, true, "configured is host-only — it does not itself require projectId (deployed is the separate flag for that)");
});

test("runStateOf: null with no lastRun.status===running at all; \"running\" when the client IS the current job; \"interrupted\" when lastRun says running but no live job matches it", () => {
  assert.equal(runStateOf(null, null), null);
  assert.equal(runStateOf({ slug: "sunrise", lastRun: { status: "ok" } }, null), null, "a finished run is never reported as running/interrupted");
  assert.equal(runStateOf({ slug: "sunrise" }, null), null, "no lastRun at all");
  assert.equal(runStateOf({ slug: "sunrise", lastRun: { status: "running" } }, null), "interrupted", "lastRun says running, but there is no current job at all — the console/CLI died");
  assert.equal(runStateOf({ slug: "sunrise", lastRun: { status: "running" } }, { name: "sunrise", status: "running" }), "running", "the current job IS this client's run");
  assert.equal(runStateOf({ slug: "sunrise", lastRun: { status: "running" } }, { name: "other-cafe", status: "running" }), "interrupted", "a DIFFERENT client's job is running — this one's own lastRun:running is still stale/interrupted");
  assert.equal(runStateOf({ slug: "sunrise", lastRun: { status: "running" } }, { name: "sunrise", status: "ok" }), "interrupted", "the current job slot names this client but is no longer itself running (finished a tick ago) — still interrupted, not running");
  assert.equal(runStateOf({ name: "sunrise", lastRun: { status: "running" } }, { name: "sunrise", status: "running" }), "running", "the list summary's `name` field works the same as `slug`");
});

test("PIN app.js: the Redeploy button's disabled title for an unfinished set-up (deployed but not configured) is the exact wording \"Set-up unfinished — press Update on Vercel\" (plan-resume-after-fresh.md §4/§6)", () => {
  const needle = "Set-up unfinished" + " — press Update on Vercel";
  assert.ok(appJs.includes(needle), `app.js must contain the literal string ${JSON.stringify(needle)} — not landed yet if this fails`);
  // Positive landmark: the existing (already-landed) applyLock()/lockState() wiring this title sits inside.
  assert.match(appJs, /function applyLock\(\)/, "positive landmark: the existing applyLock() function this pin's title lives inside");
  assert.match(appJs, /\bconfigured\b/, "positive landmark: applyLock must actually read `configured` off lockStateOf's result");
});

test("PIN app.js: the interrupted-run message is exactly \"interrupted (the console closed mid-run?) — press Update on Vercel to continue\" (plan-resume-after-fresh.md §5/§6)", () => {
  const needle = "interrupted (the console closed mid-run?) — press Update on Vercel to continue";
  assert.ok(appJs.includes(needle), `app.js must contain the literal string ${JSON.stringify(needle)} — not landed yet if this fails`);
  // Positive landmark: runStateOf is actually imported/used, not just a coincidental string match.
  assert.match(appJs, /runStateOf/, "positive landmark: app.js must import/use runStateOf from pure.mjs to drive this message");
});

test("subdomainFromInput: a bare label, a full host or a pasted URL all resolve to the first label; empty → null; a remaining dot/bad shape/reserved name throws", () => {
  assert.equal(subdomainFromInput("lucifer", "sandbee.in"), "lucifer");
  assert.equal(subdomainFromInput("  Lucifer  ", "sandbee.in"), "lucifer", "trimmed + lowercased");
  assert.equal(subdomainFromInput("lucifer.sandbee.in", "sandbee.in"), "lucifer", "a trailing .<apex> is stripped");
  assert.equal(subdomainFromInput("https://lucifer.sandbee.in/", "sandbee.in"), "lucifer", "scheme + trailing slash stripped");
  assert.equal(subdomainFromInput("", "sandbee.in"), null);
  assert.equal(subdomainFromInput(null, "sandbee.in"), null);
  assert.throws(() => subdomainFromInput("lucifer.other.in", "sandbee.in"), /just the first part/, "a dot that survives stripping the apex is refused");
  assert.throws(() => subdomainFromInput("Lucifer_1", "sandbee.in"), /lowercase letters, digits and hyphens/);
  assert.throws(() => subdomainFromInput("www", "sandbee.in"), /"www" is reserved/);
  assert.throws(() => subdomainFromInput("api", "sandbee.in"), /reserved/);
});

test("webAddressStateOf: every state the panel can show", () => {
  const platform = { apexDomain: "sandbee.in", dnsNote: null };
  assert.deepEqual(webAddressStateOf(null, platform), { state: "none", host: null, message: "No web address set yet." });
  assert.equal(webAddressStateOf({ subdomain: "lucifer" }, null).state, "none", "a subdomain with no platform configured shows none, not a crash");
  assert.equal(webAddressStateOf({ subdomain: null, generated: { projectId: "prj_1" } }, platform).state, "legacy", "deployed on *.vercel.app, no subdomain yet");

  // A subdomain set but not yet attached splits on whether the project is deployed at all.
  const notDeployed = webAddressStateOf({ subdomain: "lucifer", generated: {} }, platform);
  assert.equal(notDeployed.state, "not-deployed");
  assert.match(notDeployed.message, /Go live/, 'not-deployed tells the owner to "Go live" first');
  const notAttached = webAddressStateOf({ subdomain: "lucifer", generated: { projectId: "prj_1" } }, platform);
  assert.equal(notAttached.state, "not-attached", "deployed, but no webAddress recorded yet — Update on Vercel will attach it");

  // Reverting: no subdomain any more, but a webAddress is still recorded (the owner cleared it and hasn't run yet).
  const reverting = webAddressStateOf({ subdomain: null, generated: { projectId: "prj_1", webAddress: { host: "lucifer.sandbee.in" } } }, platform);
  assert.equal(reverting.state, "reverting");
  assert.match(reverting.message, /redirects/); assert.match(reverting.message, /\*\.vercel\.app/);

  const withStatus = (state, extra = {}) => webAddressStateOf({ subdomain: "lucifer", generated: { projectId: "prj_1", webAddress: { host: "lucifer.sandbee.in", state, ...extra } } }, platform);
  assert.equal(withStatus("pending-dns").state, "pending-dns");
  assert.equal(withStatus("pending-verify").state, "pending-verify");
  assert.equal(withStatus("pending-cert").state, "pending-cert");
  assert.equal(withStatus("ready").state, "ready");
  assert.equal(withStatus("ready", { live: true }).state, "live", "live always wins over the recorded state");
  const checkFailed = withStatus("check-failed");
  assert.equal(checkFailed.state, "check-failed");
  assert.match(checkFailed.message, /press Check DNS/i);
  const tenantMismatch = withStatus("tenant-mismatch", { probeTenant: "stranger" });
  assert.equal(tenantMismatch.state, "tenant-mismatch");
  assert.match(tenantMismatch.message, /"stranger"/, "the message names the wrong tenant it actually saw");
  for (const s of ["pending-dns", "pending-verify", "pending-cert", "ready", "live", "check-failed", "tenant-mismatch"]) assert.ok(withStatus(s).message.length > 0, `${s} carries a message`);

  // HOLD suffix: appended whenever held && servingHost, on top of whichever state is showing.
  const held = withStatus("pending-cert", { held: true, servingHost: "sunrise-demo-x7k2.vercel.app" });
  assert.match(held.message, /HOLD — sunrise-demo-x7k2\.vercel\.app keeps serving until this is ready\.$/);
  const heldReady = withStatus("ready", { held: true, servingHost: "a.sandbee.in" });
  assert.match(heldReady.message, /HOLD — a\.sandbee\.in keeps serving until this is ready\.$/, "the suffix applies regardless of which state is showing");
  const notHeld = withStatus("pending-cert", { held: false, servingHost: "sunrise-demo-x7k2.vercel.app" });
  assert.ok(!/HOLD/.test(notHeld.message), "held:false never adds the suffix, even with a servingHost recorded");
  const heldNoServingHost = withStatus("pending-cert", { held: true, servingHost: null });
  assert.ok(!/HOLD/.test(heldNoServingHost.message), "held:true with no servingHost never adds the suffix");
});

test("tablesFromForm: count 1..99 or a non-empty names list; anything else is refused with the owner-facing reason", () => {
  assert.equal(tablesFromForm("count", "8", ""), 8);
  assert.deepEqual(tablesFromForm("names", "", " Bar 1 \n\nRoof\n"), ["Bar 1", "Roof"]);
  assert.throws(() => tablesFromForm("count", "", "T-1\nT-2"), /between 1 and 99/, 'the old Number("") === 0 bug');
  assert.throws(() => tablesFromForm("count", "0", ""), /between 1 and 99/);
  assert.throws(() => tablesFromForm("count", "100", ""), /between 1 and 99/);
  assert.throws(() => tablesFromForm("names", "", "  \n "), /at least one table name/);
});

test("needsUriConfirm: only a CHANGED URI on a DEPLOYED client asks", () => {
  assert.equal(needsUriConfirm({ deployed: true, previousUri: "a", nextUri: "b" }), true);
  assert.equal(needsUriConfirm({ deployed: true, previousUri: "a", nextUri: "a" }), false);
  assert.equal(needsUriConfirm({ deployed: false, previousUri: "a", nextUri: "b" }), false);
  assert.equal(needsUriConfirm({ deployed: true, previousUri: "", nextUri: "b" }), false, "first-ever URI on a client never asks");
});

test("cloneTemplateOf: keeps the starter setup, clears every identity and credential, never carries ids/history/locks", () => {
  const source = {
    slug: "sunrise", vercel: { token: "tok_secret", project: "possandbee", teamId: "team_x" }, subdomain: "sunrise",
    mongodbUri: "mongodb+srv://u:p@c.mongodb.net/pos", admin: { username: "boss", password: "Strong-Pass-1!" },
    cafe: { name: "Sunrise Café", tagline: "t", mobile: "m", address: "a", receiptFooter: "See you!", fssai: "F1", gst: { enabled: true, number: "27ABC", rate: 12, mode: "exclusive" } },
    tables: ["Bar 1", "Roof"], menu: [{ category: "Coffee", items: [{ name: "Espresso", price: 90 }] }],
    image: { store: "r2", accountId: "acc", accessKeyId: "k", secretAccessKey: "s", bucket: "b", publicBaseUrl: "https://pub.r2.dev" },
    contact: { ownerName: "O", phone: "1", whatsapp: "2" }, accounts: { vercel: { email: "e", password: "pw" }, atlas: { email: "e2", password: "pw2" }, images: { email: "", password: "" }, other: "x" },
    notes: "secret notes", generated: { projectId: "prj_1", authSecret: "A", seededAt: "2026-09-12" }, lastRun: { action: "go-live", status: "ok" }, deployLock: true, demo: true,
  };
  const { client, cleared } = cloneTemplateOf(source, "moonlight");
  assert.equal(cleared, CLONE_CLEARED);
  assert.equal(client.slug, "moonlight");
  assert.deepEqual(client.vercel, { token: "", project: null, teamId: null }); assert.equal(client.subdomain, "moonlight", "the clone's subdomain is set to the NEW slug, never carried over"); assert.equal(client.mongodbUri, "");
  assert.deepEqual(client.admin, { username: "boss", password: "" }, "the admin USERNAME convention is kept, the password never");
  assert.deepEqual(client.cafe, { name: "", tagline: "", mobile: "", address: "", receiptFooter: "See you!", fssai: "", gst: { enabled: true, number: "", rate: 12, mode: "exclusive" } });
  assert.deepEqual(client.tables, ["Bar 1", "Roof"]); assert.deepEqual(client.menu, source.menu);
  assert.deepEqual(client.image, { store: "r2", accountId: "", accessKeyId: "", secretAccessKey: "", bucket: "", publicBaseUrl: "" }, "store TYPE kept, every key blanked");
  assert.deepEqual(client.contact, { ownerName: "", phone: "", whatsapp: "" }); assert.equal(client.accounts.vercel.password, ""); assert.equal(client.accounts.other, ""); assert.equal(client.notes, "");
  for (const k of ["generated", "lastRun", "deployLock", "demo", "standbyHosts"]) assert.equal(k in client, false, `${k} must not exist on a clone`);
  assert.equal("standbyHosts" in cloneTemplateOf({ ...source, standbyHosts: [{ label: "standby", vercel: { token: "tok_standby_secret" } }] }, "z").client, false, "standby tokens never travel with a clone");
  assert.equal(JSON.stringify(client).includes("tok_secret"), false); assert.equal(JSON.stringify(client).includes("Strong-Pass"), false); assert.equal(JSON.stringify(client).includes("prj_1"), false);
  const cl = cloneTemplateOf({ image: { store: "cloudinary", cloudName: "c", apiKey: "k", apiSecret: "s" } }, "x");
  assert.deepEqual(cl.client.image, { store: "cloudinary", cloudName: "", apiKey: "", apiSecret: "" });
  assert.equal(cloneTemplateOf({}, "y").client.image, null); assert.equal(cloneTemplateOf({}, "y").client.tables, 8);
});

test("dbNameOf: the database in a Mongo URI, or null", () => {
  assert.equal(dbNameOf("mongodb+srv://u:p@c.mongodb.net/pos?retryWrites=true"), "pos");
  assert.equal(dbNameOf("mongodb://127.0.0.1:27017/pos_scratch"), "pos_scratch");
  assert.equal(dbNameOf("mongodb+srv://u:p@c.mongodb.net/?x=1"), null);
  assert.equal(dbNameOf("mongodb+srv://u:p@c.mongodb.net"), null);
  assert.equal(dbNameOf(undefined), null);
});

test("PIN app.js: collect() reads every bound input regardless of `disabled` (locked cards round-trip unchanged), and applyLocks() disables exactly the seed cards", () => {
  const collectStart = appJs.indexOf("function collect()");
  const collectEnd = appJs.indexOf("function showImage", collectStart);
  assert.ok(collectStart > 0 && collectEnd > collectStart, "collect() present before showImage()");
  const collectSrc = appJs.slice(collectStart, collectEnd);
  assert.ok(collectSrc.includes("if (el.readOnly ||"), "positive landmark: the loop skips readOnly inputs");
  assert.ok(!/el\.disabled/.test(collectSrc), "collect() must NOT skip disabled inputs — a locked field's value has to survive a Save");
  assert.ok(collectSrc.includes("subdomainFromInput("), "the web-address input goes through the pinned subdomain rule");
  assert.ok(collectSrc.includes("tablesFromForm("), "tables go through the pinned rule");
  const locksStart = appJs.indexOf("function applyLocks()");
  const locksSrc = appJs.slice(locksStart, appJs.indexOf("\n  }\n", locksStart));
  assert.ok(locksSrc.includes('.card[data-lock="seed"]') && locksSrc.includes("el.disabled = lock"), "applyLocks disables inputs inside the seed-locked cards");
  assert.ok(locksSrc.includes("proj.disabled = deployed"), "and the project name once deployed");
  const seedCards = [...indexHtml.matchAll(/data-lock="seed" data-lock-what="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(seedCards, ["cafe details", "admin login", "tables and menu"], "exactly the three seed-owned cards are lockable");
  assert.ok(indexHtml.includes('<script type="module" src="/app.js"></script>'), "app.js loads as a module so it can import pure.mjs");
});

test("PIN app.js/index.html: the own-domain field is fully gone, replaced by the web-address / subdomain wiring (own domains are no longer a thing — every cafe is <sub>.<apex>)", () => {
  // Needles assembled from parts (never a single literal) — a literal match could
  // trip on the gate's own source line if this file were ever scanned the same way.
  const subFn = "subdomainFromInput" + "(";
  const oldFn = "resolveVercel" + "Address";
  assert.ok(appJs.includes(subFn), "positive landmark: app.js calls the new subdomain rule");
  assert.ok(!appJs.includes(oldFn), "app.js must not reference the removed resolveVercelAddress");
  const oldPath = "data-path=" + '"domain"';
  const newPath = "data-path=" + '"subdomain"';
  assert.ok(indexHtml.includes(newPath), "positive landmark: the web-address input is bound");
  assert.ok(!indexHtml.includes(oldPath), 'index.html must not carry a data-path="domain" field any more');
});

test("PIN index.html: every id is unique (the console addresses everything by id; a duplicate once made the More menu swallow the Starter-menu textarea)", () => {
  const ids = [...indexHtml.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `duplicate id(s): ${dupes.join(", ")}`);
  for (const id of ["more-menu", "menu", "dlg", "archived", "b-more"]) assert.ok(ids.includes(id), `id "${id}" present`);
  // Admin-panel shell (plan-admin-fresh.md §B): ids the tests below and the
  // owner-facing views key off — every existing element MOVED into the new
  // shell, none were duplicated or dropped.
  for (const id of ["list", "rollout", "archived-list", "web-address", "more-menu", "b-live"]) assert.ok(ids.includes(id), `id "${id}" present (SaaS shell §B.2)`);
  // "m-reset" moved OUT of static HTML: the danger zone (§B.2) now builds its
  // rows at runtime (renderDangerZone() -> dangerRow(...)), so this id is set
  // via `btn.id = id` in app.js, never as a literal `id="m-reset"` in
  // index.html — a static-HTML uniqueness scan can no longer see it there.
  // Positive landmark: pin it at its actual (dynamic) source instead of just
  // dropping the check.
  assert.ok(!ids.includes("m-reset"), 'the reset-demo button id moved to runtime — it must not reappear as static HTML (would risk a duplicate once renderDangerZone() also assigns it)');
  assert.match(appJs, /dangerRow\([^)]*"m-reset"/, 'app.js still wires id "m-reset" onto the Reset-demo danger row (dynamically)');
  const used = [...appJs.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]);
  const missing = [...new Set(used)].filter((id) => !ids.includes(id));
  assert.deepEqual(missing, [], `app.js addresses ids that do not exist in index.html: ${missing.join(", ")}`);
});

// ── Admin-panel / SaaS shell (plan-admin-fresh.md §B) ───────────────────────
test("PIN index.html: the six top-level views exist exactly once each, routed by the shell", () => {
  const VIEW_IDS = ["view-dashboard", "view-clients", "view-client", "view-rollouts", "view-archive", "view-platform"];
  for (const id of VIEW_IDS) {
    const count = [...indexHtml.matchAll(new RegExp(`id="${id}"`, "g"))].length;
    assert.equal(count, 1, `#${id} must exist exactly once`);
  }
  // Positive landmark for the "exactly once" pins above: the views really are
  // distinguishable sections, not one grep match repeated across copies of the same markup.
  assert.match(indexHtml, /<section class="view" id="view-dashboard">/, "view-dashboard is a real <section>, not just a stray id attribute");
});

test("PIN index.html: the client view has at least 6 tabs, and every data-panel has a matching data-tab (no orphaned panel, no tab with nothing to show)", () => {
  const tabs = [...indexHtml.matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(tabs.length >= 6, `expected >= 6 tabs, found ${tabs.length}: ${tabs.join(", ")}`);
  const panels = [...indexHtml.matchAll(/data-panel="([^"]+)"/g)].map((m) => m[1]);
  const tabSet = new Set(tabs);
  const panelSet = new Set(panels);
  const orphanPanels = panels.filter((p) => !tabSet.has(p));
  const orphanTabs = tabs.filter((t) => !panelSet.has(t));
  assert.deepEqual(orphanPanels, [], `data-panel with no matching data-tab: ${orphanPanels.join(", ")}`);
  assert.deepEqual(orphanTabs, [], `data-tab with no matching data-panel: ${orphanTabs.join(", ")}`);
  // Vision guard: the tabs really are buttons the owner clicks, not text that happens to contain the attribute.
  assert.match(indexHtml, /<button[^>]*class="tab"[^>]*data-tab="overview"/, "positive landmark: a real <button class=\"tab\"> carries data-tab");
});

test("PIN: 'Fresh start on Vercel' (A.5) is wired as a danger-zone action named \"fresh\" — the dangerRow() call and the run_ dispatch table both carry it", () => {
  // Built from parts, not one literal, so this needle can't accidentally match this very test file if it were ever scanned the same way.
  const actAttr = "data-act" + "=\"fresh\"";
  // The danger zone is rendered at runtime (renderDangerZone() -> dangerRow(...)),
  // so `data-act="fresh"` never appears as static HTML — index.html must NOT
  // claim it does (that would be an untested assumption about a dynamic view).
  assert.ok(!indexHtml.includes(actAttr), "data-act=\"fresh\" is produced by JS at runtime, not static HTML — pin app.js instead");
  const dangerRowsStart = appJs.indexOf("function renderDangerZone()");
  assert.ok(dangerRowsStart > 0, "renderDangerZone() must exist — the danger zone is rendered there (plan §B.2)");
  const dangerRowsSrc = appJs.slice(dangerRowsStart, appJs.indexOf("\n  }\n", dangerRowsStart));
  assert.match(dangerRowsSrc, /dangerRow\([^)]*"Fresh start on Vercel"/, "a 'Fresh start on Vercel' row is appended in the danger zone");
  assert.match(dangerRowsSrc, /dangerRow\(\s*"Fresh start on Vercel"[\s\S]*?,\s*"fresh"\s*,/, "the row's action name is exactly \"fresh\"");
  // The dispatch table (run_ = { ...[b.dataset.act] }) must route "fresh" to a handler.
  const dispatchLine = appJs.split("\n").find((l) => l.includes("const run_ = {") && l.includes("[b.dataset.act]"));
  assert.ok(dispatchLine, "the data-act dispatch table exists");
  assert.match(dispatchLine, /\bfresh:\s*freshStart\b/, "\"fresh\" dispatches to a freshStart handler");
});

test("PIN: the danger-zone 'Fresh start' button is disabled until the client is deployed, AND while deploys are locked — with the locked title naming the reason (Status → Safety)", () => {
  const renderStart = appJs.indexOf("function renderDangerZone()");
  const renderSrc = appJs.slice(renderStart, appJs.indexOf("\n  }\n", renderStart));
  assert.match(renderSrc, /\[data-act="fresh"\]'\)\.disabled\s*=\s*!deployed\s*\|\|\s*locked/, "the fresh-start action is gated on BOTH `deployed` and `locked` — a locked client must not offer a fresh start either");
  assert.match(renderSrc, /locked\s*=\s*isLocked\(\)/, "the lock state is read via isLocked(), the same helper every other lock check uses");
  const lockedTitle = "Deploys are locked for this client (Status → Safety)";
  assert.ok(renderSrc.includes(lockedTitle), `the disabled title names the reason: "${lockedTitle}"`);
});

test("PIN app.js: openClient's second parameter destructures { guarded = true } — the shell calls it with guarded:false after running its OWN dirty-guard, so a route change is never asked twice", () => {
  assert.ok(appJs.includes("async function openClient(name, { guarded = true } = {})"), "openClient's signature — positive landmark: the default is true (a direct call, e.g. the switcher, still asks)");
  const openClientStart = appJs.indexOf("async function openClient(name, { guarded = true } = {})");
  assert.ok(openClientStart > 0);
  const openClientSrc = appJs.slice(openClientStart, appJs.indexOf("\n  }\n", openClientStart));
  assert.match(openClientSrc, /if\s*\(\s*guarded\s*&&\s*!\s*\(\s*await\s+dirtyGuard\(\)\s*\)\s*\)\s*return;/, "guarded:true is what actually triggers the confirm() prompt inside openClient");
});

test("PIN shell.js: the shell calls openClient with { guarded: false } after its own dirtyGuard has already run — never a double prompt on a route change", () => {
  assert.ok(shellJs.includes('await openClient(r.slug, { guarded: false })'), 'the shell disables openClient\'s OWN guard: it already asked via `leaving` above');
  // Vision guard: the shell's render() function does compute its own `leaving` + dirtyGuard() check before this call.
  const renderStart = shellJs.indexOf("async function render()");
  assert.ok(renderStart > 0);
  const renderSrc = shellJs.slice(renderStart, shellJs.indexOf("\n  }\n", renderStart));
  assert.match(renderSrc, /const leaving = current && current\.route === "client" && state\.dirty/, "positive landmark: render() computes its own leaving-guard before calling openClient");
});

test("PIN shell.js: the dirty guard fires only when LEAVING the open client — a tab switch inside the same client (same route, same slug) never prompts", () => {
  const renderStart = shellJs.indexOf("async function render()");
  const renderSrc = shellJs.slice(renderStart, shellJs.indexOf("\n  }\n", renderStart));
  assert.match(renderSrc, /r\.route !== "client" \|\| r\.slug !== state\.name/, 'leaving is true only on a DIFFERENT route or a DIFFERENT slug — never merely a different tab of the SAME client');
  assert.ok(!/r\.tab !== current\.tab/.test(renderSrc), "a tab-only change must never be part of the leaving condition");
});

test("PIN shell.js: parseHash() maps an unknown/garbled client tab to the DEFAULT_TAB ('overview'), never undefined or a blank panel", () => {
  const defaultTabConst = shellJs.match(/const DEFAULT_TAB = "([^"]+)";/);
  assert.ok(defaultTabConst, "DEFAULT_TAB is a named constant");
  assert.equal(defaultTabConst[1], "overview");
  const parseHashStart = shellJs.indexOf("function parseHash()");
  const parseHashSrc = shellJs.slice(parseHashStart, shellJs.indexOf("\n  }\n", parseHashStart));
  assert.match(parseHashSrc, /tab:\s*tabs\.includes\(parts\[2\]\)\s*\?\s*parts\[2\]\s*:\s*DEFAULT_TAB/, "an unrecognised tab segment falls back to DEFAULT_TAB, not the raw (possibly garbage) hash segment");
});

test("PIN shell.js: PENDING_STATES (the dashboard KPI 'Address pending or needs attention') includes check-failed and tenant-mismatch, not just the original pending-* states", () => {
  const m = shellJs.match(/const PENDING_STATES = \[([^\]]*)\];/);
  assert.ok(m, "PENDING_STATES must be a literal array — positive landmark for the negative checks below");
  const states = [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]);
  for (const s of ["pending-dns", "pending-verify", "pending-cert", "not-attached", "check-failed", "tenant-mismatch"]) assert.ok(states.includes(s), `PENDING_STATES must include "${s}"`);
  assert.ok(!states.includes("ready") && !states.includes("live") && !states.includes("none"), "a READY/LIVE/no-address state must never count as 'needs attention'");
});

test("PIN shell.js: updateNavCounts() runs on EVERY render (not only on the list views) — the sidebar's client/archive counts stay correct on the dashboard, client and platform views too", () => {
  const renderStart = shellJs.indexOf("async function render()");
  const renderSrc = shellJs.slice(renderStart, shellJs.indexOf("\n  }\n", renderStart));
  const updateCountsIdx = renderSrc.indexOf("updateNavCounts();");
  const routeBranchIdx = renderSrc.search(/if \(r\.route === "dashboard"\)/);
  assert.ok(updateCountsIdx > 0, "updateNavCounts() is called inside render()");
  assert.ok(routeBranchIdx > 0 && updateCountsIdx < routeBranchIdx, "updateNavCounts() runs BEFORE the per-route branching, so every route hits it — not just the ones that render a list");
});

// ── Locks + Force (plan-locks-force.md §3/§4) ───────────────────────────────
// NOT LANDED at the time this file was written: no #activity element, no
// /activity.js file, no data-act="force-unlock", no #b-refresh button, and no
// disabled-titles for a locked/busy client exist yet in ui/index.html or
// ui/app.js. These pins are written against the plan's exact ids/strings and
// are EXPECTED to fail until the UI implementer lands ui/activity.js + the
// corresponding index.html/app.js wiring.
test("PIN index.html: the topbar carries an #activity chip (idle → hidden) — plan §4", () => {
  assert.match(indexHtml, /id="activity"/, '#activity element must exist in the topbar (plan §4: "idle → hidden; a console job running → ...")');
});

test("PIN ui-server.mjs STATIC map: /activity.js is served (plan §4 — new ui/activity.js served at /activity.js)", () => {
  const serverSrc = readFileSync(path.join(HERE, "ui-server.mjs"), "utf8");
  assert.match(serverSrc, /"\/activity\.js"/, "the STATIC route map in ui-server.mjs must serve /activity.js");
  // Positive landmark: the STATIC map itself really exists and carries the other known routes (proves this isn't a stale/renamed table).
  assert.match(serverSrc, /"\/app\.js"/, "positive landmark: the existing STATIC map this pin extends");
});

test("PIN activity.js: a data-act=\"force-unlock\" control exists for the per-client Force stop & unlock dialog (plan §3/§4) — landed in the new ui/activity.js, not app.js/index.html", () => {
  // The attribute is set via the DOM property (`el.dataset.act = "force-unlock"`),
  // not a static `data-act="force-unlock"` HTML string — that property write is
  // exactly what PRODUCES the data-act="force-unlock" attribute at runtime.
  assert.match(activityJs, /forceBtn\.dataset\.act\s*=\s*"force-unlock"/, 'the Force button must set dataset.act = "force-unlock" (renders as data-act="force-unlock")');
  assert.match(activityJs, /forceReleaseClient/, "the button must actually call the force-release flow, not just carry the marker");
});

test("PIN index.html: a Refresh button with id \"b-refresh\" exists on the client header (plan §3 'GET /api/clients/:name already returns fresh data; add a header button ↻ Refresh')", () => {
  assert.match(indexHtml, /id="b-refresh"/, '#b-refresh must exist — the client view header\'s ↻ Refresh button (plan §3)');
});

test("PIN activity.js: the disabled-title strings for a locked/busy client are present verbatim, returned by statusFor() (plan §4) — app.js/applyActivityGate() just applies whatever title this module hands back", () => {
  assert.ok(activityJs.includes("A deploy is running for this client — wait or Stop it (top bar)"), "the SAME-client busy/locked disabled title must appear verbatim in activity.js's statusFor()");
  assert.ok(activityJs.includes("Another job is running") && /one at a time/.test(activityJs), 'the OTHER-clients disabled title ("Another job is running (<action> <cafe>) — one at a time") must appear');
  // Positive landmark: app.js really does delegate to statusFor() rather than hard-coding its own copy of these strings (so they can never drift apart).
  assert.match(appJs, /activity\.statusFor\(/, "positive landmark: app.js's applyActivityGate() reads the title from activity.js's statusFor(), not a duplicated literal");
});

test("PIN index.html + activity.js: the rollouts view offers a Force stop & unlock… button (#rl-force, data-act=\"force-rollout\") wired to forceReleaseRollout(), gated on the rollout API's existing drivenBy field — plan §4", () => {
  assert.match(indexHtml, /id="rl-force"/, "#rl-force button must exist in the rollouts view markup");
  const forceRolloutAttr = "data-act" + '="force-rollout"';
  assert.ok(indexHtml.includes(forceRolloutAttr), 'the rollout Force button carries data-act="force-rollout"');
  assert.match(activityJs, /forceReleaseRollout/, "activity.js must export/implement forceReleaseRollout, the handler behind #rl-force");
  assert.match(appJs, /drivenBy/, "positive landmark: the existing drivenBy field this Force control is conditioned on (app.js decides #rl-force.hidden from it)");
});

test("PIN shell.js + activity.js: Clients table + dashboard rows show a small 'running' chip for a locked/active client, delegated to activity.js's runningChip (from GET /api/locks) — plan §4, same delegation pattern already pinned for webAddressBadge", () => {
  assert.match(shellJs, /runningChip/, "shell.js must call the shared runningChip helper, not build its own 'running' markup");
  assert.match(shellJs, /const\s*\{[^}]*runningChip[^}]*\}\s*=\s*deps;/, "runningChip arrives through deps, same as webAddressBadge");
  assert.match(activityJs, /function runningChip\(/, "positive landmark: runningChip is really defined in activity.js");
  assert.match(activityJs, /\bchip running\b/, "the chip carries the 'running' CSS class + label activity.js actually renders");
});

test("PIN shell.js: the dashboard/Clients table's web-address cell delegates to app.js's webAddressBadge (passed in via deps) — the shell renders no badge markup of its own, so the two tables can never drift apart", () => {
  assert.ok(shellJs.includes("function webAddrCell(c)"), "webAddrCell exists — positive landmark");
  const cellStart = shellJs.indexOf("function webAddrCell(c)");
  const cellSrc = shellJs.slice(cellStart, shellJs.indexOf("\n  }", cellStart) + 4);
  assert.match(cellSrc, /return webAddressBadge\(c\.webAddress\)/, "webAddrCell is a thin delegate to the shared webAddressBadge, not its own rendering logic");
  assert.match(shellJs, /const\s*\{[^}]*webAddressBadge[^}]*\}\s*=\s*deps;/, "webAddressBadge arrives through deps, same as every other app.js callback the shell uses");
});

// ── seed-demo wiring (plan §5/§6 — "Reset & seed demo data") ────────────────
test("ui-jobs ACTIONS includes \"seed-demo\", and commandFor(\"seed-demo\") builds the CLI args: client path, --seed-demo, --confirm/--confirm-db, and --images only when an imagesDir was given", () => {
  assert.ok(ACTIONS.includes("seed-demo"), 'ACTIONS must list "seed-demo" — the same allow-list the server checks body.action against');

  const withImages = commandFor("/repo", "seed-demo", "sunrise", "/repo/clients/sunrise.json", { confirm: "sunrise", confirmDb: "pos", imagesDir: "C:/photos/demo" });
  assert.equal(withImages.cmd, process.execPath);
  assert.deepEqual(withImages.args, [
    path.join("/repo", "scripts", "go-live", "index.mjs"),
    "/repo/clients/sunrise.json",
    "--seed-demo",
    "--confirm", "sunrise",
    "--confirm-db", "pos",
    "--images", "C:/photos/demo",
  ]);

  const noImages = commandFor("/repo", "seed-demo", "sunrise", "/repo/clients/sunrise.json", { confirm: "sunrise", confirmDb: "pos" });
  assert.deepEqual(noImages.args.slice(-2), ["--confirm-db", "pos"], "no trailing --images flag when imagesDir is absent");
  assert.ok(!noImages.args.includes("--images"), "the --images flag is omitted entirely, not passed empty");

  const blankImages = commandFor("/repo", "seed-demo", "sunrise", "/repo/clients/sunrise.json", { confirm: "sunrise", confirmDb: "pos", imagesDir: "" });
  assert.ok(!blankImages.args.includes("--images"), "a falsy (empty-string) imagesDir is also omitted, same as absent");

  // Missing confirm/confirmDb still produce a well-shaped command (the guards live server/CLI-side, not here) — empty strings, never "undefined".
  const missing = commandFor("/repo", "seed-demo", "sunrise", "/repo/clients/sunrise.json", {});
  assert.deepEqual(missing.args.slice(-4), ["--confirm", "", "--confirm-db", ""]);
});

test("PIN ui-jobs.mjs: seed-demo shares the SAME per-client command shape as reset-demo (client path first, then the flag, then --confirm/--confirm-db) — a positive landmark this pin's expectations are grounded in the real reset-demo behaviour, not an assumption", () => {
  const reset = commandFor("/repo", "reset-demo", "sunrise", "/repo/clients/sunrise.json", { confirm: "sunrise", confirmDb: "pos" });
  const seed = commandFor("/repo", "seed-demo", "sunrise", "/repo/clients/sunrise.json", { confirm: "sunrise", confirmDb: "pos" });
  assert.deepEqual(reset.args.slice(0, 2), [path.join("/repo", "scripts", "go-live", "index.mjs"), "/repo/clients/sunrise.json"]);
  assert.deepEqual(seed.args.slice(0, 2), reset.args.slice(0, 2), "same entry point + client path as reset-demo");
  assert.equal(reset.args[2], "--reset-demo"); assert.equal(seed.args[2], "--seed-demo");
  assert.deepEqual(reset.args.slice(3), seed.args.slice(3, 7), "--confirm/--confirm-db carried identically");
});

test("PIN app.js: seed-demo is wired end to end — a \"Reset & seed demo data\" danger-zone row (id m-seed, act \"seed\") dispatching to a seedDemo() handler that posts action:\"seed-demo\" with confirm/confirmDb/imagesDir, gated on demo:true same as reset", () => {
  // renderDangerZone(): the seed row is appended right after the reset row, same id/act-naming convention.
  const dzStart = appJs.indexOf("function renderDangerZone()");
  assert.ok(dzStart > 0, "renderDangerZone() must exist");
  const dzSrc = appJs.slice(dzStart, appJs.indexOf("\n  }\n", dzStart));
  assert.match(dzSrc, /dangerRow\(\s*"Reset & seed demo data"[\s\S]*?"m-seed"\s*,\s*"seed"\s*,\s*seedDemo\s*\)/, 'a dangerRow("Reset & seed demo data", …, "m-seed", "seed", seedDemo) call must exist');
  // Positive landmark: the reset row it sits beside really is there too (this pin is additive, not a replacement).
  assert.match(dzSrc, /dangerRow\(\s*"Reset demo database"[\s\S]*?"m-reset"\s*,\s*"reset"\s*,\s*resetDemo\s*\)/, "positive landmark: the existing reset-demo row this seed row is modeled on");
  // Gating: disabled unless demo === true, same rule/title as the reset row.
  assert.match(dzSrc, /\[data-act="seed"\]'\)\.disabled\s*=\s*!\(c\s*&&\s*c\.demo\s*===\s*true\)/, "the seed row is disabled for any client not ticked demo:true");
  assert.ok(dzSrc.includes("Only for clients ticked as 'Demo client' (Status → Safety)"), "the disabled title names the same reason as the reset row");

  // Dispatch table: data-act="seed" -> seedDemo.
  const dispatchLine = appJs.split("\n").find((l) => l.includes("const run_ = {") && l.includes("[b.dataset.act]"));
  assert.ok(dispatchLine, "the data-act dispatch table exists");
  assert.match(dispatchLine, /\bseed:\s*seedDemo\b/, '"seed" dispatches to a seedDemo handler');

  // seedDemo() itself: gated on demo:true, posts the seed-demo job with confirm/confirmDb/imagesDir.
  const seedFnStart = appJs.indexOf("async function seedDemo()");
  assert.ok(seedFnStart > 0, "an async function seedDemo() must exist");
  const seedFnSrc = appJs.slice(seedFnStart, appJs.indexOf("\n  }\n", seedFnStart));
  assert.match(seedFnSrc, /state\.client\.demo !== true/, "seedDemo() refuses when the (freshly re-read) client is not ticked demo:true");
  assert.match(seedFnSrc, /action:\s*"seed-demo"/, 'seedDemo() POSTs /api/jobs with action:"seed-demo"');
  assert.match(seedFnSrc, /confirm:\s*r\.value/, "the typed confirmation is sent as `confirm`");
  assert.match(seedFnSrc, /confirmDb:\s*db\b/, "the database shown on screen is sent as `confirmDb`, bound to what was just re-read from disk");
  assert.match(seedFnSrc, /imagesDir\b/, "the images-folder input value is included in the job body (omitted when blank)");
  // Vision guard: seedDemo() really re-reads the client from the server before building the confirm dialog (same pattern as resetDemo()), not just a coincidental string match above.
  assert.match(seedFnSrc, /state\.client\s*=\s*await\s+api\("GET",\s*`\/api\/clients\/\$\{state\.name\}`\)/, "positive landmark: seedDemo() re-fetches the saved record before showing the drop-database dialog, same as resetDemo()");
});

