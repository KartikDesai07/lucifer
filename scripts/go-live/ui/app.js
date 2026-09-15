// Owner console front-end (vanilla JS, no build step). State: the client list,
// the open client (form ↔ JSON via data-path bindings), a dirty flag, one job
// stream. Everything talks to ui-server.mjs on the same origin. Remembers the
// last open client + log height in localStorage; restores the last job's log.
// DOM-free decisions (locks, the Vercel-address rule, tables) live in ./pure.mjs
// so ui-pure.test.mjs can pin them.
import { cloneTemplateOf, dbNameOf, lockStateOf, needsUriConfirm, runStateOf, subdomainFromInput, tablesFromForm, VERCEL_APP, webAddressStateOf } from "./pure.mjs";
import { createWebAddress } from "./web-address.js";
import { createShell } from "./shell.js";
import { createActivity } from "./activity.js";
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,50}[a-z0-9])?$/;
  const LS = { last: "golive.lastClient", logH: "golive.logHeight", hash: "golive.lastHash" };
  const state = { list: [], name: null, client: null, dirty: false, isNew: false, job: null, es: null, unlocked: false, platform: null };
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
  // #web-address panel + revert flow (split into its own file — see web-address.js
  // header). Function declarations below are hoisted, so passing them by
  // reference here is safe even though most are defined further down.
  const webAddress = createWebAddress({ $: (id) => $(id), mk: (...a) => mk(...a), api: (...a) => api(...a), copyText: (...a) => copyText(...a), esc: (...a) => esc(...a), p: (...a) => p(...a), dialog: (...a) => dialog(...a), state, renderStatus: () => renderStatus(), markDirty: () => markDirty(), save: () => save(), run: (...a) => run(...a) });
  // Shell: hash routing (dashboard/clients/client/rollouts/archive/platform),
  // the sidebar nav + dashboard table, the client view's tabs, the client
  // switcher, and the inline Platform form (split into its own file — see
  // shell.js header). Defined further down; declarations are hoisted.
  // Activity: the topbar chip + cross-process lock polling (see activity.js
  // header). onRefresh() is called after every poll (and after Stop/Force) —
  // it re-renders whatever depends on locks: both tables' "running" chips via
  // renderList()/shell.renderDashboard(), the OPEN client's deploy +
  // danger-zone gating, and the Rollouts view's Force button.
  const activity = createActivity({ $: (id) => $(id), mk: (...a) => mk(...a), esc: (...a) => esc(...a), p: (...a) => p(...a), api: (...a) => api(...a), dialog: (...a) => dialog(...a), state, expandLog: () => expandLog(), onRefresh: () => { renderList(); shell.renderDashboard(); if (state.client) regate(); } });
  const shell = createShell({ webAddressBadge, runningChip: (n) => activity.runningChip(n), runBadge: (c) => runBadge(c), $: (id) => $(id), mk: (...a) => mk(...a), esc: (...a) => esc(...a), api: (...a) => api(...a), state, store, openClient: (n) => openClient(n), renderList: () => renderList(), renderArchived: () => renderArchived(), fill: () => fill(), dirtyGuard: () => dirtyGuard(), platformSave: (...a) => platformSave(...a) });

  // ── JSON helpers ────────────────────────────────────────────────────────────
  const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
  function setPath(o, p, v) {
    const ks = p.split("."); let cur = o;
    for (const k of ks.slice(0, -1)) { if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {}; cur = cur[k]; }
    cur[ks[ks.length - 1]] = v;
  }
  async function api(method, path, body) {
    const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
    if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);
    return json.data;
  }
  function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  // ── secrets: eye + copy buttons on every bound input ────────────────────────
  function decorate() {
    document.querySelectorAll("[data-path]").forEach((el) => {
      if (el.dataset.decorated || el.type === "checkbox" || el.tagName === "SELECT") return;
      el.dataset.decorated = "1";
      if (el.hasAttribute("data-secret")) {
        el.type = "password";
        const eye = mk("button", "icon", "👁"); eye.title = "show / hide"; eye.type = "button";
        eye.onclick = () => { el.type = el.type === "password" ? "text" : "password"; };
        el.after(eye);
      }
      if (el.dataset.path === "subdomain") return; // the suffix sits where the copy icon would (the value is a single word)
      const copy = mk("button", "icon", "⧉"); copy.title = "copy"; copy.type = "button";
      copy.onclick = () => copyText(el.value, copy);
      (el.nextElementSibling && el.nextElementSibling.classList.contains("icon") ? el.nextElementSibling : el).after(copy);
    });
  }
  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text || ""); } catch { const t = mk("textarea"); t.value = text || ""; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    if (btn) { const old = btn.textContent; btn.textContent = "✓"; setTimeout(() => (btn.textContent = old), 900); }
  }

  // ── list ────────────────────────────────────────────────────────────────────
  async function loadList() {
    state.list = await api("GET", "/api/clients");
    state.archived = await api("GET", "/api/archive").catch(() => []);
    renderList(); renderArchived();
  }
  function renderArchived() {
    const box = $("archived"); const list = $("archived-list"); list.innerHTML = "";
    const rows = state.archived || [];
    box.hidden = rows.length === 0; $("archived-count").textContent = rows.length ? `(${rows.length})` : "";
    for (const c of rows) {
      const wrap = mk("div", "item"); wrap.appendChild(mk("b", null, c.cafeName || c.name)); wrap.appendChild(mk("span", null, c.host ? `was https://${c.host}` : c.name));
      const b = mk("button", "btn restore", "Restore"); b.type = "button";
      b.onclick = () => api("POST", `/api/clients/${c.name}/restore`, {}).then(() => loadList()).then(() => shell.setHash("client", c.name)).catch((e) => alert(e.message));
      const d = mk("button", "btn del", "Delete permanently…"); d.type = "button";
      d.onclick = () => deleteArchived(c).catch((e) => alert(e.message));
      wrap.append(b, d); list.appendChild(wrap);
    }
  }
  async function deleteArchived(c) {
    const r = await dialog({ title: `Delete archived "${c.name}" permanently`, okLabel: "Delete forever", danger: true,
      body: [p(`Removes <code>clients/_archive/${esc(c.name)}.json</code> for good — its tokens, Mongo URI, passwords and notes are gone from this PC. <b>Nothing on Vercel or Atlas changes</b>: retire those first (the Archive dialog listed the steps) or you lose the only record of where they are.`), p("Cannot be undone.")],
      input: { label: `Type the slug "${c.name}" to confirm`, mustEqual: c.name } });
    if (!r.ok) return;
    await api("DELETE", `/api/archive/${c.name}`, { confirm: r.value });
    await loadList();
  }
  /** The web address cell shown in a client row: its state while pending, the
   *  host once live, a nudge for a cafe still on *.vercel.app only. */
  function webAddressBadge(wa) {
    if (!wa || !wa.state || wa.state === "none") return mk("span", "hintline", "—");
    if (wa.state === "live") return mk("span", "badge ok", wa.host);
    if (wa.state === "legacy") return mk("span", "badge warn", "vercel.app only");
    return mk("span", "badge " + (["check-failed", "tenant-mismatch"].includes(wa.state) ? "bad" : "warn"), `${wa.host || "address"} · ${wa.state}`);
  }
  /** "interrupted" badge for a table row (dashboard + Clients share this, like
   *  activity.runningChip): a `lastRun.status === "running"` row whose client is
   *  not the console's current job — the run stopped mid-way (console closed,
   *  a crash) and Redeploy/Go live need one more "Update on Vercel" to finish. */
  function runBadge(c) { return runStateOf(c, state.locks && state.locks.job) === "interrupted" ? mk("span", "badge warn", "interrupted") : null; }
  /** `#list` is the clients table's <tbody> (Cafe · slug · Web address · Hosting
   *  host · Last run · Problems · Open) — a broken client.json shows a red badge
   *  and is not clickable. Shared by the Clients view; the Dashboard has its own
   *  full-table renderer in shell.js (same row shape, different data slice). */
  function renderList() {
    const q = $("search").value.trim().toLowerCase();
    const box = $("list"); box.innerHTML = "";
    const rows = state.list.filter((c) => !q || `${c.name} ${c.cafeName} ${c.host || ""}`.toLowerCase().includes(q));
    if (state.isNew && state.client) rows.unshift({ name: state.name, cafeName: getPath(state.client, "cafe.name") || "(new)", host: null, problems: 0, unsaved: true });
    for (const c of rows) {
      const tr = mk("tr", c.broken ? "" : "clickable" + (c.name === state.name ? " active" : ""));
      const nameTd = mk("td", null, c.cafeName || c.name);
      const running = activity.runningChip(c.name); if (running) nameTd.append(" ", running);
      tr.appendChild(nameTd);
      tr.appendChild(mk("td", null, c.name));
      const waTd = mk("td");
      if (c.broken) waTd.appendChild(mk("span", "badge bad", "file is not valid JSON"));
      else waTd.appendChild(webAddressBadge(c.webAddress));
      tr.appendChild(waTd);
      tr.appendChild(mk("td", null, c.host || (c.unsaved ? "not saved yet" : "not deployed")));
      const lastTd = mk("td", null, c.lastRun ? `${c.lastRun.action} · ${c.lastRun.status === "ok" ? "✓" : "✗"}` : "never");
      const runBadgeEl = runBadge(c); if (runBadgeEl) lastTd.append(" ", runBadgeEl);
      tr.appendChild(lastTd);
      tr.appendChild(mk("td", null, c.problems ? String(c.problems) : "—"));
      const openTd = mk("td");
      if (!c.broken) { const b = mk("button", "btn", "Open →"); b.type = "button"; b.onclick = (e) => { e.stopPropagation(); shell.setHash("client", c.name); }; openTd.appendChild(b); }
      tr.appendChild(openTd);
      if (!c.broken) tr.onclick = () => shell.setHash("client", c.name);
      box.appendChild(tr);
    }
    if (!rows.length) { const tr = mk("tr"); const td = mk("td", "empty", q ? "No match." : "No clients yet — + New client"); td.colSpan = 7; tr.appendChild(td); box.appendChild(tr); }
  }

  // ── open / fill / collect ───────────────────────────────────────────────────
  /** Shared "leaving unsaved work?" guard — used both by direct calls (openClient)
   *  and by hash-based routing (a client tab jump / navigating away from #/client/…). */
  async function dirtyGuard() { return !state.dirty || confirm("Discard unsaved changes?"); }
  async function openClient(name, { guarded = true } = {}) {
    if (guarded && !(await dirtyGuard())) return;
    state.client = await api("GET", `/api/clients/${name}`); state.name = name; state.isNew = false; state.unlocked = false; markClean();
    store.set(LS.last, name);
    if (!state.platform) await loadPlatform(); // a failed first fetch must not leave the session in "legacy mode"
    fill(); renderList();
    const v = await api("POST", `/api/clients/${name}/validate`, {});
    showProblems(v.problems, v.problems.length ? undefined : "Ready. Dry run first, then Go live.");
    applyRunBanner(); // wins over showProblems()'s banner when interrupted — a no-op otherwise
  }
  function fill() {
    const c = state.client;
    $("empty").hidden = true; $("form").hidden = false; $("bar").hidden = false;
    setTitle(); $("subtitle").textContent = `clients/${state.name}.json`;
    document.querySelectorAll("[data-path]").forEach((el) => {
      const v = getPath(c, el.dataset.path);
      if (el.type === "checkbox") el.checked = Boolean(v);
      else el.value = v === undefined || v === null ? "" : String(v);
    });
    const imgStore = c.image && c.image.store ? c.image.store : "none";
    $("img-store").value = imgStore; showImage(imgStore);
    const tables = c.tables;
    if (Array.isArray(tables)) { $("tables-mode").value = "names"; $("tables-names").value = tables.join("\n"); $("tables-count").value = ""; }
    else { $("tables-mode").value = "count"; $("tables-count").value = typeof tables === "number" ? tables : 8; $("tables-names").value = ""; }
    showTables();
    $("menu").value = c.menu ? JSON.stringify(c.menu, null, 2) : ""; menuCount();
    projectUrlHint(); renderStatus(); applyLocks(); renderStandbys(); webAddress.render(); renderDangerZone(); applyActivityGate(); shell.renderSwitcher();
    banner(null); applyRunBanner();
  }

  // ── standby hosts: same cafe, other Vercel accounts (edited live on state.client) ─
  function secretField(value, onChange, placeholder) {
    const wrap = mk("div", "field");
    const input = mk("input", "secret"); input.type = "password"; input.value = value || ""; input.placeholder = placeholder || ""; input.oninput = () => { onChange(input.value); markDirty(); };
    const eye = mk("button", "icon", "👁"); eye.type = "button"; eye.onclick = () => { input.type = input.type === "password" ? "text" : "password"; };
    const copy = mk("button", "icon", "⧉"); copy.type = "button"; copy.onclick = () => copyText(input.value, copy);
    wrap.append(input, eye, copy); return wrap;
  }
  function textField(value, onChange, placeholder) {
    const wrap = mk("div", "field"); const input = mk("input"); input.value = value || ""; input.placeholder = placeholder || ""; input.oninput = () => { onChange(input.value.trim()); markDirty(); };
    const copy = mk("button", "icon", "⧉"); copy.type = "button"; copy.onclick = () => copyText(input.value, copy);
    wrap.append(input, copy); return wrap;
  }
  function row(label, field) { const r = mk("div", "row"); r.appendChild(mk("label", null, label)); r.appendChild(field); return r; }
  function renderStandbys() {
    const box = $("standby-list"); box.innerHTML = "";
    const hosts = Array.isArray(state.client.standbyHosts) ? state.client.standbyHosts : [];
    const locked = isLocked();
    hosts.forEach((h, i) => {
      h.vercel = h.vercel || { token: "", project: null, teamId: null };
      const g = h.generated || {};
      const card = mk("div", "standby");
      const head = mk("div", "head"); head.appendChild(mk("b", null, `Standby “${h.label}”`));
      const st = mk("span", "hintline"); if (g.host) { const a = mk("a", null, `live at https://${g.host}`); a.href = `https://${g.host}`; a.target = "_blank"; a.rel = "noopener"; st.appendChild(a); } else st.textContent = "not deployed yet — fill the token, Save, then Go live on this standby";
      head.appendChild(st); card.appendChild(head);
      card.appendChild(row("Token *", secretField(h.vercel.token, (v) => { h.vercel.token = v; }, "a token from THIS standby account")));
      card.appendChild(row("Team id", textField(h.vercel.teamId || "", (v) => { h.vercel.teamId = v || null; }, "(personal account)")));
      card.appendChild(row("Project", textField(h.vercel.project || "", (v) => { h.vercel.project = v || null; }, `(default: ${state.name}-${h.label})`)));
      const acts = mk("div", "acts");
      const mkBtn = (label, title, fn, opts = {}) => { const b = mk("button", "btn" + (opts.cls ? " " + opts.cls : ""), label); b.type = "button"; b.title = title; b.disabled = Boolean(opts.disabled); b.onclick = () => fn().catch((e) => alert(e.message)); return b; };
      acts.appendChild(mkBtn("Dry run", "Validate and show the plan for this standby", () => run("dry-run", h.label)));
      acts.appendChild(mkBtn(g.projectId ? "Update on Vercel" : "Go live", g.projectId ? `Save env vars on the existing standby project ${g.projectId} and redeploy` : "Create the project in the standby account, save env vars, deploy, health check (no seed — same database)", () => run("go-live", h.label), { disabled: locked }));
      acts.appendChild(mkBtn("Redeploy", "Deploy the current code to this standby only", () => run("redeploy", h.label), { disabled: locked || !g.projectId }));
      if (g.host) acts.appendChild(mkBtn("Health", "GET /api/health on THIS standby's address", async () => {
        st.textContent = "checking…";
        const r = await api("GET", `/api/clients/${state.name}/health?host=${encodeURIComponent(h.label)}`);
        st.textContent = r.ok === true ? `✓ ok · db up · https://${g.host}` : r.ok === null ? r.reason : `✗ ${r.reason}`;
      }));
      if (g.host) acts.appendChild(mkBtn("Open ↗", "Open the standby site", async () => window.open(`https://${g.host}`, "_blank", "noopener")));
      acts.appendChild(mkBtn("Remove", "Forget this standby in the record (the Vercel project itself stays until you delete it)", async () => {
        const r = await dialog({ title: `Remove standby “${h.label}”?`, okLabel: "Remove from record", danger: true, body: [p(`Only this record changes. ${g.projectId ? `The Vercel project <code>${esc(g.projectId)}</code>${g.host ? ` (${esc(g.host)})` : ""} keeps running until you delete it in Vercel (project → Settings → General → Delete Project). Its deploy profile <code>${esc(state.name)}-${esc(h.label)}</code> stays in deploy.profiles.json until you remove it.` : "Nothing was deployed for it yet."}`)] });
        if (!r.ok) return; state.client.standbyHosts.splice(i, 1); markDirty(); renderStandbys();
      }, { cls: "rm" }));
      card.appendChild(acts); box.appendChild(card);
    });
  }
  async function addStandby() {
    const r = await dialog({ title: "Add a standby host", okLabel: "Add",
      body: [p("A <b>second Vercel account</b> serving the SAME cafe: same database, same images, same logins — only the hosting differs. Useful as a warm spare (\"2 servers, 1 backup\"): if one account is suspended, the other address keeps working."), ul(["Create the standby Vercel account (another email), make a token there → paste it into the new block.", "Go live on the standby: it creates <code>" + esc(state.name) + "-&lt;label&gt;</code> in that account and deploys — no seeding, the database is shared.", "Your web address stays on the primary; the standby answers on its own <b>name.vercel.app</b>. To fail over, point your DNS at the standby (or move the domain in Vercel).", "After every code update: Redeploy the primary AND each standby."])],
      input: { label: "Label for this standby (lowercase letters, digits, hyphens)", placeholder: "standby" } });
    if (!r.ok) return;
    const label = r.value.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,20}$/.test(label) || label === "primary") return void alert('Label: lowercase letters, digits and hyphens; not "primary".');
    if ((state.client.standbyHosts || []).some((h) => h.label === label)) return void alert("A standby with that label already exists.");
    state.client.standbyHosts = [...(state.client.standbyHosts || []), { label, vercel: { token: "", project: null, teamId: null } }];
    markDirty(); renderStandbys();
  }
  /** What is already real: seeded (settings/admin/tables/menu live in the DB) and deployed (the Vercel project exists). Rule in pure.mjs. */
  function lockState() { return lockStateOf(state.client); }
  const INTERRUPTED_MESSAGE = "interrupted (the console closed mid-run?) — press Update on Vercel to continue";
  /** "running" | "interrupted" | null for the OPEN client — the current job
   *  comes from activity.js's /api/locks poll (state.locks.job), so this stays
   *  in sync with a job started from any tab/process, not just this one. */
  function runState() { return runStateOf(state.client, state.locks && state.locks.job); }
  let runBannerShown = false; // tracks whether the CURRENT banner is this module's own run-state message, so a later regate() (the interrupted run finished/resumed) clears it instead of leaving it stuck
  /** Shows the interrupted message in the banner area, or clears it once the
   *  client is no longer interrupted (but only if THIS banner put it there —
   *  never steps on a banner from showProblems()/save()/a dialog). Called
   *  right after fill()'s own clear, after openClient()'s showProblems() (so it
   *  wins there), and from regate() on every activity poll so the message
   *  disappears again once Update on Vercel finishes. */
  function applyRunBanner() {
    if (runState() === "interrupted") { banner([], "", INTERRUPTED_MESSAGE); runBannerShown = true; }
    else if (runBannerShown) { banner(null); runBannerShown = false; }
  }
  /** Seed-locked cards become record-only after the first seed: a re-seed never
   *  overwrites, so an edit here would change nothing in the running cafe — the
   *  POS owns that data now. "Edit anyway" is for seeding a NEW database. The
   *  project name locks once the Vercel project exists (rename only in Vercel). */
  function applyLocks() {
    const { seeded, seededAt, deployed } = lockState();
    document.querySelectorAll('.card[data-lock="seed"]').forEach((card) => {
      const lock = seeded && !state.unlocked;
      card.classList.toggle("locked", lock);
      card.querySelectorAll("input, select, textarea, button.btn").forEach((el) => { if (!el.closest(".lockbar")) el.disabled = lock; });
      const bar = card.querySelector(".lockbar"); bar.hidden = !seeded; bar.textContent = "";
      if (!seeded) return;
      bar.appendChild(mk("span", null, `Seeded on ${new Date(seededAt).toLocaleDateString()} — the ${card.dataset.lockWhat} now live in the cafe's database. Edits here do not reach the running POS; manage them inside the POS.`));
      if (lock) { const b = mk("button", "btn", "Edit anyway"); b.type = "button"; b.title = "Only useful when you point this client at a NEW, empty database and seed again"; b.onclick = () => { state.unlocked = true; applyLocks(); }; bar.appendChild(b); }
      else bar.appendChild(mk("b", null, "· unlocked for this visit"));
    });
    const proj = document.querySelector('[data-path="vercel.project"]');
    proj.disabled = deployed; proj.title = deployed ? "The Vercel project already exists — a rename is done in Vercel, not here" : "";
  }
  /** Form → client object. The Web address input holds only the FIRST label —
   *  subdomainFromInput() strips a pasted scheme/apex/slash and validates it. */
  function collect() {
    const c = JSON.parse(JSON.stringify(state.client || {}));
    document.querySelectorAll("[data-path]").forEach((el) => {
      if (el.readOnly || el.dataset.path.startsWith("generated.") || el.dataset.path.startsWith("image.")) return;
      let v;
      if (el.type === "checkbox") v = el.checked;
      else if (el.dataset.type === "number") v = Number(el.value);
      else if (el.dataset.type === "nullable") v = el.value.trim() === "" ? null : el.value.trim();
      else v = el.value;
      setPath(c, el.dataset.path, v);
    });
    const notes = [];
    const apex = state.platform && state.platform.apexDomain;
    c.subdomain = subdomainFromInput(document.querySelector('[data-path="subdomain"]').value, apex);
    const imgStore = $("img-store").value;
    if (imgStore === "none") c.image = null;
    else { c.image = { store: imgStore }; document.querySelectorAll(`#img-${imgStore === "r2" ? "r2" : "cl"} [data-path^="image."]`).forEach((el) => { c.image[el.dataset.path.slice("image.".length)] = el.value.trim(); }); }
    c.tables = tablesFromForm($("tables-mode").value, $("tables-count").value, $("tables-names").value);
    const menuText = $("menu").value.trim();
    if (!menuText) c.menu = null;
    else { try { c.menu = JSON.parse(menuText); } catch (e) { throw new Error("Starter menu is not valid JSON: " + e.message); } }
    c.slug = state.name;
    return { client: c, notes };
  }
  function showImage(s) { $("img-r2").hidden = s !== "r2"; $("img-cl").hidden = s !== "cloudinary"; }
  function showTables() { const names = $("tables-mode").value === "names"; $("tables-names-row").hidden = !names; $("tables-count").hidden = names; }
  function menuCount() {
    try { const m = JSON.parse($("menu").value || "null"); $("menu-count").textContent = Array.isArray(m) ? `${m.length} categories · ${m.reduce((n, c) => n + ((c.items && c.items.length) || 0), 0)} items` : ""; }
    catch { $("menu-count").textContent = "invalid JSON"; }
  }
  function projectUrlHint() {
    const g = (state.client && state.client.generated) || {};
    const sub = document.querySelector('[data-path="subdomain"]').value.trim().toLowerCase();
    const apex = state.platform && state.platform.apexDomain;
    const proj = (document.querySelector('[data-path="vercel.project"]').value.trim() || state.name || "").toLowerCase();
    $("proj-url").textContent = g.host ? `Live at https://${g.host}` : sub && apex ? `URL: https://${sub}.${apex}` : proj ? `URL will be https://${proj}${VERCEL_APP} — or with a suffix if the name is taken` : "";
  }
  function setTitle() {
    const t = $("title"); t.textContent = getPath(state.client, "cafe.name") || state.name;
    if (state.dirty) t.appendChild(mk("span", "pill", "unsaved"));
  }
  function renderStatus() {
    const g = (state.client && state.client.generated) || {};
    const { deployed, configured } = lockState();
    $("s-host").textContent = "";
    if (g.host) { const a = mk("a", null, `https://${g.host}`); a.href = `https://${g.host}`; a.target = "_blank"; a.rel = "noopener"; $("s-host").appendChild(a); }
    else if (deployed && !configured) $("s-host").textContent = "set-up unfinished — press Update on Vercel";
    else $("s-host").textContent = "— (not deployed yet)";
    const ws = webAddressStateOf(state.client, state.platform);
    $("s-web").textContent = ws.host ? `${ws.host} · ${ws.state}` : `— (${ws.state})`;
    $("s-tenant").textContent = g.tenantId ? `TENANT_ID=${g.tenantId} · ROOT_DOMAIN=${g.rootDomain}` : "—";
    $("s-project").textContent = g.projectId || "—"; $("s-org").textContent = g.orgId || "—";
    const lr = state.client && state.client.lastRun;
    $("s-last").textContent = lr ? `${lr.action} · ${lr.status} · ${new Date(lr.at).toLocaleString()}` : "never";
    applyLock();
    $("b-open").disabled = !g.host; $("b-health").disabled = !g.host;
  }
  /** deployLock = a record-only client (e.g. an already-live cafe managed elsewhere): no Go live / Redeploy from here. */
  function isLocked() { const el = document.querySelector('[data-path="deployLock"]'); return el ? el.checked : Boolean(state.client && state.client.deployLock); }
  const UNFINISHED_TITLE = "Set-up unfinished — press Update on Vercel (it saves the env vars, the deploy profile and deploys)";
  function applyLock() {
    const locked = isLocked(); const { deployed, configured } = lockState();
    const g = (state.client && state.client.generated) || {};
    const unfinished = deployed && !configured;
    $("b-live").disabled = locked; $("b-redeploy").disabled = locked || !deployed || unfinished;
    // After the first deploy the everyday action is REDEPLOY (same project, same
    // URL). The full run stays available as "Update on Vercel" for env changes
    // (token, Mongo URI, image store, domain) — it adopts the recorded project,
    // never creates another one.
    $("b-live").textContent = deployed ? "Update on Vercel" : "Go live";
    $("b-live").classList.toggle("go", !deployed); $("b-redeploy").classList.toggle("go", deployed);
    $("b-live").title = locked ? "Deploys are locked for this client (Status → Safety)"
      : deployed ? `Full run on the EXISTING project ${g.projectId}: save env vars (token / Mongo URI / image store / domain) and redeploy. Seed is a no-op. Never creates a new project.`
      : "Full run: seed the database (only what is still EMPTY) · create the Vercel project · save env vars · deploy · health check";
    $("b-redeploy").title = locked ? $("b-live").title : unfinished ? UNFINISHED_TITLE : "Deploy the current code to the same project and URL — env vars and database untouched";
    // Never advertise the CLI command for a locked client (deploy.mjs refuses it too).
    $("s-redeploy").textContent = locked ? "locked — untick Lock deploys (Status → Safety) and Save to enable" : `npm run deploy -- --profile ${state.name}`;
  }
  /** Layers the CROSS-PROCESS lock (a console job or a live lock — CLI, another
   *  console tab/terminal — anywhere) on top of the per-client `deployLock`
   *  gate above: THIS client busy → Dry run/Redeploy/Go live/every standby
   *  Go live·Redeploy/danger-zone all disabled; another client's console job →
   *  only the deploy buttons, "one at a time". Only ever ADDS a disable/title
   *  on top of applyLock()'s own decision — never re-enables anything. */
  /** Re-derive every deploy/danger button from scratch and THEN apply the activity gate —
   *  so a lock that went away (or another client's job that finished) re-enables the buttons
   *  on the next poll instead of leaving them stuck disabled with a stale title. */
  function regate() {
    const dry = $("b-dry"); dry.disabled = false; dry.title = "Validate the file and show the plan — changes nothing";
    applyLock(); renderStandbys(); renderDangerZone(); applyActivityGate(); applyRunBanner();
  }
  function applyActivityGate() {
    const s = activity.statusFor(state.name);
    if (s.disableDeploy) {
      for (const id of ["b-dry", "b-redeploy", "b-live"]) { $(id).disabled = true; $(id).title = s.title; }
      document.querySelectorAll("#standby-list .acts .btn").forEach((b) => { if (b.textContent !== "Remove" && b.textContent !== "Health" && b.textContent !== "Open ↗") { b.disabled = true; b.title = s.title; } });
    }
    if (s.disableDanger) document.querySelectorAll("#danger-rows button.btn").forEach((b) => { b.disabled = true; b.title = s.title; });
  }
  /** ↻ Refresh (client header, §3): re-fetch this client + the current job +
   *  the locks snapshot and re-render — without discarding unsaved edits, the
   *  same rule attachStream()'s "done" handler already follows: server-owned
   *  fields (generated/lastRun, + each standby's) are taken from disk, the
   *  rest of a dirty form stays exactly as typed. */
  async function refreshClient() {
    const name = state.name; if (!name) return;
    const [fresh, cur] = await Promise.all([api("GET", `/api/clients/${name}`), api("GET", "/api/jobs/current").catch(() => null)]);
    if (state.dirty) {
      const recorded = new Map((fresh.standbyHosts || []).map((h) => [h.label, h.generated]));
      const standbyHosts = (state.client.standbyHosts || []).map((h) => (recorded.has(h.label) ? { ...h, generated: recorded.get(h.label) } : h));
      state.client = { ...state.client, generated: fresh.generated, lastRun: fresh.lastRun, standbyHosts };
      renderStatus(); applyLocks(); webAddress.render(); regate();
    } else { state.client = fresh; fill(); }
    if (cur && cur.status === "running" && (!state.job || state.job.id !== cur.id)) attachStream(cur, `${cur.action} ${cur.name}${cur.host ? ` @${cur.host}` : ""}`);
    await activity.refresh();
  }
  function banner(items, kind, title) {
    const b = $("banner");
    if (!items) { b.hidden = true; return; }
    b.hidden = false; b.className = "banner " + (kind || "");
    b.innerHTML = ""; b.appendChild(mk("b", null, title || ""));
    if (items.length) { const ul = mk("ul"); items.forEach((p) => ul.appendChild(mk("li", null, p))); b.appendChild(ul); }
  }
  function showProblems(problems, okTitle, extraNotes) {
    const notes = extraNotes || [];
    if (problems.length) banner([...notes, ...problems], "", `${problems.length} thing(s) to fix before go-live:`);
    else banner(notes, "ok", okTitle || "Saved. Ready for a dry run.");
  }
  function markDirty() { if (!state.dirty) { state.dirty = true; $("b-save").textContent = "Save •"; setTitle(); } }
  function markClean() { state.dirty = false; $("b-save").textContent = "Save"; if (state.client) setTitle(); }

  // ── actions ─────────────────────────────────────────────────────────────────
  async function save() {
    let collected;
    try { collected = collect(); } catch (e) { banner([e.message], "bad", "Cannot save:"); return false; }
    if (needsUriConfirm({ deployed: lockState().deployed, previousUri: state.client.mongodbUri, nextUri: collected.client.mongodbUri })
      && !confirm("Mongo URI changed on a DEPLOYED cafe.\n\nThe next Go live points the live app at this other database (and seeds it if it is empty). Continue?")) return false;
    const r = await api("PUT", `/api/clients/${state.name}`, collected.client);
    state.client = { ...collected.client, generated: state.client.generated, lastRun: state.client.lastRun }; state.isNew = false; markClean();
    if (collected.notes.length) fill();
    showProblems(r.problems, undefined, collected.notes);
    await loadList();
    return true;
  }
  function attachStream(job, action) {
    if (state.es) state.es.close();
    state.job = job; logStatus(`${action} · running…`, job.status === "running");
    if (job.status === "running") expandLog();
    const es = new EventSource(`/api/jobs/${job.id}/stream`); state.es = es;
    es.onmessage = async (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "line") { $("log-body").textContent += m.line + "\n"; $("log-body").scrollTop = $("log-body").scrollHeight; }
      if (m.type === "done") {
        es.close(); state.job.status = m.status;
        // The vercel CLI prints per-deployment URLs in the log; the address that matters is the stable one — of THE HOST THIS JOB RAN ON.
        const slot = job.host ? ((state.client && state.client.standbyHosts) || []).find((h) => h.label === job.host) : state.client;
        const host = slot && slot.generated && slot.generated.host;
        logStatus(`${action} · ${m.status === "ok" ? `finished ✓${host && job.name === state.name ? ` · live at https://${host}` : ""}` : "FAILED ✗ (exit " + m.exitCode + ")"}`, false);
        if (job.name === state.name) {
          const fresh = await api("GET", `/api/clients/${state.name}`);
          if (state.dirty) {
            // Keep the owner's unsaved edits, but take EVERY server-owned piece from disk — the top-level
            // generated/lastRun AND each standby's recorded project/host (matched by label).
            const recorded = new Map((fresh.standbyHosts || []).map((h) => [h.label, h.generated]));
            const standbyHosts = (state.client.standbyHosts || []).map((h) => (recorded.has(h.label) ? { ...h, generated: recorded.get(h.label) } : h));
            state.client = { ...state.client, generated: fresh.generated, lastRun: fresh.lastRun, standbyHosts };
          } else state.client = fresh;
          if (!state.dirty) fill(); else { renderStatus(); applyLocks(); renderStandbys(); webAddress.render(); applyActivityGate(); }
        }
        await loadList();
      }
    };
    es.onerror = async () => {
      es.close(); state.job = null;
      // Ask the server what is true instead of guessing: re-attach if it still runs.
      try {
        const cur = await api("GET", "/api/jobs/current");
        if (cur && cur.status === "running") { logStatus(`${action} · stream lost, re-attaching…`, true); setTimeout(() => attachStream(cur, action), 1500); return; }
        logStatus(`${action} · ${cur && cur.status === "ok" ? "finished ✓" : "ended (see Last run)"}`, false);
        await loadList();
      } catch { logStatus(`${action} · stream lost — reload the page`, false); }
    };
  }
  async function run(action, host) {
    // The SERVER knows whether a job runs (this tab's state can be stale after a lost stream).
    const cur = await api("GET", "/api/jobs/current");
    if (cur && cur.status === "running") { alert(`A job is already running (${cur.action} ${cur.name}) — wait for the log to finish.`); attachStream(cur, `${cur.action} ${cur.name}`); return; }
    if ((action === "go-live" || action === "redeploy") && isLocked()) { alert("Deploys are locked for this client (Status → Safety). Untick the lock and Save first."); return; }
    if (state.dirty || state.isNew) { if (!(await save())) return; }
    const standby = host && host !== "primary" ? (state.client.standbyHosts || []).find((h) => h.label === host) : null;
    if (host && host !== "primary" && !standby) return void alert(`Standby "${host}" is not in the saved record.`);
    const g = standby ? standby.generated || {} : (state.client && state.client.generated) || {};
    const who = standby ? `standby "${host}" of "${state.name}"` : `"${state.name}"`;
    if (action === "go-live" && g.projectId && !standby) {
      const ws = webAddressStateOf(state.client, state.platform);
      const addrLine = `• web address: ${ws.message}`;
      const switchLine = ws.state === "ready" ? `\n• SWITCHES the address to https://${ws.host} — the old ${g.host || "*.vercel.app"} address will redirect there; staff sign in again; update the counter PC's server address; Settings → Telegram → Repair webhook; R2 CORS: add the new origin` : "";
      if (!confirm(`Update ${who} on Vercel?\n\n• uses the EXISTING project ${g.projectId} (${g.host || "host pending"}) — no new project, no new URL\n• REPLACES its environment variables with this file's values\n• seed is a no-op on a cafe that already has data\n• deploys to PRODUCTION\n${addrLine}${switchLine}`)) return;
    } else if (action === "go-live" && g.projectId && !confirm(`Update ${who} on Vercel?\n\n• uses the EXISTING project ${g.projectId} (${g.host || "host pending"}) — no new project, no new URL\n• REPLACES its environment variables with this file's values\n• no seeding — the database is shared with the primary\n• deploys to PRODUCTION`)) return;
    if (action === "go-live" && !g.projectId && !confirm(standby
      ? `Go live on ${who}?\n\n• creates project "${standby.vercel.project || `${state.name}-${host}`}" in the STANDBY account and saves the same env vars (same database, images, logins)\n• no seeding — the database is shared with the primary\n• deploys to PRODUCTION on its own *.vercel.app address`
      : `Go live for "${state.name}"?\n\n• seeds the database (never overwrites existing data)\n• creates the Vercel project and saves its environment variables from this file\n• deploys to PRODUCTION`)) return;
    if (action === "redeploy" && !confirm(`Redeploy ${who} to the same project and URL with the code in this repo right now?`)) return;
    $("log-body").textContent = ""; expandLog();
    const job = await api("POST", "/api/jobs", { name: state.name, action, ...(standby ? { host } : {}) });
    attachStream(job, standby ? `${action} @${host}` : action);
  }
  async function health() {
    $("s-health").textContent = "checking…";
    const h = await api("GET", `/api/clients/${state.name}/health`);
    $("s-health").textContent = h.ok === true ? `✓ ok · db up · tenant ${h.body && h.body.tenant}` : h.ok === null ? h.reason : `✗ ${h.reason}`;
  }
  function logStatus(text, busy) { $("log-status").textContent = text; $("log").classList.toggle("busy", busy); document.body.classList.toggle("busy", busy); }
  async function newClient() {
    if (state.dirty && !confirm("Discard unsaved changes?")) return;
    const slug = (prompt("Slug for the new client — lowercase letters, digits, hyphens.\nBecomes the Vercel project name and the URL label, e.g. sunrise-cafe") || "").trim().toLowerCase();
    if (!slug) return;
    if (!SLUG_RE.test(slug)) { alert("Slug: lowercase letters, digits and hyphens only."); return; }
    if (state.list.some((c) => c.name === slug)) { alert("That client already exists."); return; }
    if ((state.archived || []).some((c) => c.name === slug)) { alert("An ARCHIVED client has that name — restore it from the Archived list instead, or pick another slug."); return; }
    const t = await api("GET", "/api/template"); t.slug = slug; t.subdomain = slug;
    state.client = t; state.name = slug; state.isNew = true; state.unlocked = false;
    shell.setHash("client", slug); fill(); markDirty(); renderList();
    banner(["Fill in the cafe name, Vercel token, Mongo URI and admin password, then Save (Ctrl+S)."], "", "New client");
  }

  // ── dialog (native <dialog>): title, rich body, optional typed input, ok/cancel ─
  function dialog({ title, body, okLabel = "OK", danger = false, input = null }) {
    return new Promise((resolve) => {
      const d = $("dlg"); $("dlg-title").textContent = title; $("dlg-body").innerHTML = ""; $("dlg-body").append(...(Array.isArray(body) ? body : [body]));
      const row = $("dlg-input-row"); row.hidden = !input; $("dlg-input").value = "";
      if (input) { $("dlg-input-label").textContent = input.label; $("dlg-input").placeholder = input.placeholder || ""; }
      const ok = $("dlg-ok"); ok.textContent = okLabel; ok.className = "btn " + (danger ? "danger" : "primary");
      const check = () => { ok.disabled = Boolean(input && input.mustEqual !== undefined && $("dlg-input").value.trim() !== input.mustEqual); };
      check(); $("dlg-input").oninput = check;
      const finish = (v) => { d.close(); ok.onclick = null; $("dlg-cancel").onclick = null; resolve(v); };
      ok.onclick = () => finish({ ok: true, value: $("dlg-input").value.trim(), form: d });
      $("dlg-cancel").onclick = () => finish({ ok: false });
      d.oncancel = (e) => { e.preventDefault(); finish({ ok: false }); };
      d.showModal(); if (input) $("dlg-input").focus();
    });
  }
  const p = (html) => { const e = mk("p"); e.innerHTML = html; return e; };
  const ul = (items) => { const e = mk("ul"); items.forEach((t) => { const li = mk("li"); li.innerHTML = t; e.appendChild(li); }); return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ── lifecycle: clone · move hosting · reset demo · archive ──────────────────
  // (Move / reset / revert-address / archive / delete / fresh-start now live as
  // rows in the client view's Danger zone tab — see renderDangerZone(). The
  // More ▾ menu keeps only the two non-destructive shortcuts.)
  function toggleMenu(force) {
    const m = $("more-menu"); const open = force !== undefined ? force : m.hidden; m.hidden = !open;
  }
  async function cloneClient() {
    if (state.dirty && !confirm("Discard unsaved changes?")) return;
    const r = await dialog({ title: `Clone "${state.name}" as a new client`, okLabel: "Create clone",
      body: [p("Copies the <b>starter setup</b> so the next cafe of this kind starts from the same base:"), ul(["tables and starter menu", "GST mode and rate, receipt footer", "which image store (R2 / Cloudinary), not its keys"]), p("<b>Not copied</b> — every credential and identity: cafe name and address, Vercel token and project, Mongo URI, admin password, logins, notes, run history. The clone opens unsaved; fill those in, Save, Dry run, Go live.")],
      input: { label: "Slug for the new client (lowercase letters, digits, hyphens) — becomes the Vercel project name and URL label", placeholder: "e.g. moonlight-cafe" } });
    if (!r.ok) return;
    const slug = r.value.toLowerCase();
    if (!SLUG_RE.test(slug)) return void alert("Slug: lowercase letters, digits and hyphens only.");
    if (state.list.some((c) => c.name === slug) || (state.archived || []).some((c) => c.name === slug)) return void alert("That client already exists (active or archived).");
    const { client, cleared } = cloneTemplateOf(state.client, slug);
    const from = state.name;
    state.client = client; state.name = slug; state.isNew = true; state.unlocked = false; fill(); markDirty(); renderList();
    banner([`Cleared: ${cleared.join(", ")}.`, "Fill in: cafe name, Vercel token, Mongo URI, admin password — then Save (Ctrl+S)."], "", `Cloned from "${from}" — not saved yet`);
  }
  async function moveHosting() {
    const g = (state.client && state.client.generated) || {};
    const choices = mk("div");
    choices.innerHTML = `<label class="choice"><input type="radio" name="mv" value="A" checked> <b>A · Transfer the project in Vercel (recommended)</b><br><small>Same URL, same env vars, domains and deployments move along. In the OLD account: project → Settings → General → <b>Transfer Project</b> → choose the new team (you must be an owner there / a member; Vercel may ask the new team for a payment method; if the name is taken there Vercel asks for a new name). Then here: Hosting → <b>Token</b> = a token from the NEW account, <b>Team id</b> = the new team's id (or empty for a personal account), Save, and press <b>Update on Vercel</b> — the console adopts the transferred project (by its id, else by its name), nothing is created.</small></label>
      <label class="choice"><input type="radio" name="mv" value="B"> <b>B · Start a fresh project in the new account</b><br><small>Use when the old account is gone or suspended. The console forgets project <code>${esc(g.projectId || "")}</code> (kept under history), you paste the new token (and Team id), Save, and press <b>Go live</b> (the button is renamed once the project is forgotten) — it creates a new project → a <b>new *.vercel.app URL</b>. Data is untouched (same database). ${g.webAddress ? `Your web address <code>${esc(g.webAddress.host || "")}</code> must first be removed from the old project (or claimed via the TXT record Vercel offers) — otherwise Vercel answers 409.` : ""}</small></label>`;
    const r = await dialog({ title: "Move hosting to another Vercel account", okLabel: "Continue", body: [p(`Live now: <b>${esc(g.host || "—")}</b> · project <code>${esc(g.projectId || "—")}</code>`), choices, p("Vercel facts checked 2026-09-12: transfers copy env vars (except vercel.json ones), move domains and deployments; integrations must be re-added. A deleted project cannot be restored — export the database with mongodump before deleting anything.")] });
    if (!r.ok) return;
    const choice = choices.querySelector("input:checked").value;
    if (choice === "A") { banner(["1. Old account → project → Settings → General → Transfer Project → new team.", "2. Here: Hosting → Token = a token from the NEW account; Team id = the new team's id (or empty for a personal account) → Save.", "3. Update on Vercel — it adopts the transferred project (by id, else by name). Same URL. If it cannot find the project with that token it stops and says so — it never creates a second one."], "", "Path A — nothing changed yet"); return; }
    const c2 = await dialog({ title: "Forget the current Vercel project?", okLabel: "Forget project & continue", danger: true, body: [p(`The console will stop treating <code>${esc(g.projectId || "")}</code> (${esc(g.host || "")}) as this client's project. The old project keeps running until you delete it in Vercel. The next run — the button is then called <b>Go live</b> — creates a NEW project in the account the token belongs to; if the token still reaches the OLD account, the run stops instead of re-adopting the old project.`), p("Secrets and the seed date are kept, so existing logins keep working on the new URL.")], input: { label: `Type the slug "${state.name}" to confirm`, mustEqual: state.name } });
    if (!c2.ok) return;
    await api("POST", `/api/clients/${state.name}/detach-hosting`, {});
    await openClient(state.name);
    const wg = (state.client && state.client.generated && state.client.generated.webAddress) || null;
    banner(["Paste the NEW account's token into Hosting → Token, Save, then press Go live (it creates the project in that account).", wg ? `Web address ${wg.host}: remove it from the old project first, or use Vercel's TXT claim.` : "The new *.vercel.app address will be shown in Status after the run."], "", "Hosting detached");
  }
  async function resetDemo() {
    if (!state.client || state.client.demo !== true) return void alert("Only for clients ticked as 'Demo client' (Status → Safety).");
    // Consent must be about what is ON DISK: flush the form first, re-read the
    // saved record, and show THAT database — then bind the job to the shown name.
    if (state.dirty) { if (!(await save())) return; }
    state.client = await api("GET", `/api/clients/${state.name}`);
    if (state.client.demo !== true) return void alert("This client is not ticked as a demo any more.");
    const db = dbNameOf(state.client.mongodbUri);
    if (!db) return void alert("The Mongo URI has no database name — nothing to reset.");
    const r = await dialog({ title: `Reset the demo database of "${state.name}"`, okLabel: "Drop & seed fresh", danger: true,
      body: [p(`<span class="warn">Drops the WHOLE database "${esc(db)}"</span> — orders, customers, dues, staff, settings, tables, menu — then seeds it fresh from this file (settings · admin · tables · starter menu). Vercel is untouched: same project, same URL, same env.`), p(`This cannot be undone. The run is bound to database <b>"${esc(db)}"</b> exactly as shown here, to the demo flag in the saved file, and to the slug you type; the script re-checks all three before dropping anything.`)],
      input: { label: `Type the slug "${state.name}" to confirm`, mustEqual: state.name } });
    if (!r.ok) return;
    $("log-body").textContent = ""; expandLog();
    const job = await api("POST", "/api/jobs", { name: state.name, action: "reset-demo", confirm: r.value, confirmDb: db });
    attachStream(job, "reset-demo");
  }
  async function seedDemo() {
    if (!state.client || state.client.demo !== true) return void alert("Only for clients ticked as 'Demo client' (Status → Safety).");
    // Consent must be about what is ON DISK: flush the form first, re-read the
    // saved record, and show THAT database — then bind the job to the shown name.
    if (state.dirty) { if (!(await save())) return; }
    state.client = await api("GET", `/api/clients/${state.name}`);
    if (state.client.demo !== true) return void alert("This client is not ticked as a demo any more.");
    const db = dbNameOf(state.client.mongodbUri);
    if (!db) return void alert("The Mongo URI has no database name — nothing to seed.");
    const imagesInput = mk("input");
    imagesInput.value = state.client.generated && state.client.generated.demoImagesDir ? state.client.generated.demoImagesDir : "";
    imagesInput.placeholder = "e.g. C:\\Users\\you\\Pictures\\demo-photos";
    const imagesField = mk("div", "field"); imagesField.append(mk("label", null, "Images folder on this PC (optional)"), imagesInput);
    const r = await dialog({ title: `Reset & seed demo data for "${state.name}"`, okLabel: "Drop & seed demo data", danger: true,
      body: [p(`<span class="warn">Drops the database "${esc(db)}"</span> and rebuilds it with a full demo: menu with photos, 31 days of orders, customers with dues, events, reservations and QR requests. Vercel is not touched.`), imagesField],
      input: { label: `Type the slug "${state.name}" to confirm`, mustEqual: state.name } });
    if (!r.ok) return;
    const imagesDir = imagesInput.value.trim() || undefined;
    $("log-body").textContent = ""; expandLog();
    const job = await api("POST", "/api/jobs", { name: state.name, action: "seed-demo", confirm: r.value, confirmDb: db, ...(imagesDir ? { imagesDir } : {}) });
    attachStream(job, "seed-demo");
  }
  async function archiveClient() {
    const g = (state.client && state.client.generated) || {};
    const uri = state.client.mongodbUri || "<mongo uri>";
    const standbys = (state.client.standbyHosts || []);
    const projectLines = [
      g.projectId ? `Vercel (primary account): project <code>${esc(g.projectName || g.projectId)}</code>${g.host ? ` (${esc(g.host)})` : ""} → Settings → General → <b>Delete Project</b> (type its name). Move any custom domain to another project BEFORE deleting.` : "Vercel (primary): no project recorded.",
      ...standbys.map((h) => { const sg = h.generated || {}; return sg.projectId ? `Vercel (standby “${esc(h.label)}” — its OWN account): project <code>${esc(sg.projectName || sg.projectId)}</code>${sg.host ? ` (${esc(sg.host)})` : ""} → Delete Project.` : `Standby “${esc(h.label)}”: nothing deployed.`; }),
    ];
    const tokenLine = `Tokens: Account Settings → Tokens → delete <code>pos-go-live</code> in the primary account${standbys.length ? ` and in each standby account (${standbys.map((h) => esc(h.label)).join(", ")})` : ""}. Atlas: Database Access → delete the user.`;
    const r = await dialog({ title: `Archive "${state.name}"`, okLabel: "Archive record", danger: true,
      body: [p("Moves <code>clients/" + esc(state.name) + ".json</code> into <code>clients/_archive/</code>, ticks <b>Lock deploys</b> on it and removes its deploy profiles (primary and standbys) from <code>deploy.profiles.json</code> (kept inside the record, put back on Restore) — so neither the console nor <code>npm run deploy</code> can deploy a retired cafe by accident. Every credential stays in the file; the client disappears from the list and can be <b>restored</b> any time. <b>Nothing on Vercel or Atlas changes</b> — the site keeps running until you retire it yourself:"),
        ul([`<b>Export the data first</b> (M0 has no backups; terminating a cluster is irreversible). Needs MongoDB Database Tools installed; run in any terminal:<span class="snippet">mongodump --uri="${esc(uri)}" --gzip --archive=${esc(state.name)}-backup.archive.gz</span>`,
          ...projectLines,
          "Atlas: cluster ··· → <b>Terminate</b> (type the cluster name). Or leave it — a free cluster auto-pauses after 30 idle days.",
          tokenLine,
          state.client.subdomain ? `DNS: remove the CNAME <code>${esc(state.client.subdomain)}</code> (and its TXT) at ${esc((state.platform && state.platform.dnsNote) || "your DNS provider")}.` : "No web address to clean up."])] });
    if (!r.ok) return;
    await api("POST", `/api/clients/${state.name}/archive`, {});
    state.client = null; state.name = null; markClean(); $("form").hidden = true; $("bar").hidden = true; $("empty").hidden = false;
    store.set(LS.last, ""); await loadList(); shell.setHash("clients");
  }
  // ── delete (a slip) ─────────────────────────────────────────────────────────
  function historyOf(c) {
    const g = (c && c.generated) || {};
    return Boolean(g.projectId || g.seededAt || (Array.isArray(g.previousHosting) && g.previousHosting.length) || (c.lastRun && c.lastRun.action === "go-live" && c.lastRun.status === "ok") || (c.standbyHosts || []).some((h) => h && h.generated && h.generated.projectId));
  }
  async function deleteClient() {
    if (state.isNew) { // never saved: just drop it from the screen
      state.client = null; state.name = null; state.isNew = false; markClean(); $("form").hidden = true; $("bar").hidden = true; $("empty").hidden = false; renderList(); shell.setHash("clients"); return;
    }
    if (historyOf(state.client)) {
      const r = await dialog({ title: `"${state.name}" has history — archive it instead`, okLabel: "Archive instead", danger: true,
        body: [p("This record was deployed or seeded, so its credentials are the only record of a real Vercel project / database. Deleting it directly is not offered."), ul(["<b>Archive</b> it (kept, restorable, deploys locked).", "Retire the Vercel project / Atlas cluster with the checklist in that dialog.", "Then <b>Delete permanently</b> from the Archived list."])] });
      if (r.ok) await archiveClient();
      return;
    }
    const r = await dialog({ title: `Delete "${state.name}"`, okLabel: "Delete", danger: true,
      body: [p(`Removes <code>clients/${esc(state.name)}.json</code> (never deployed, never seeded — nothing exists on Vercel or Atlas for it) and its deploy profile if any. Cannot be undone.`)],
      input: { label: `Type the slug "${state.name}" to confirm`, mustEqual: state.name } });
    if (!r.ok) return;
    await api("DELETE", `/api/clients/${state.name}`, { confirm: r.value });
    state.client = null; state.name = null; markClean(); $("form").hidden = true; $("bar").hidden = true; $("empty").hidden = false;
    store.set(LS.last, ""); await loadList(); shell.setHash("clients");
  }

  // ── fresh start: delete the Vercel project and deploy fresh into the same account ─
  /** Danger zone (client view, Danger zone tab): one row per lifecycle action,
   *  each reusing the SAME handler the old More ▾ menu called — the button
   *  nodes are rebuilt here (not duplicated: they no longer exist in #more-menu,
   *  which now holds only Clone + the rollout shortcut). `id`s m-reset and
   *  m-revert-address are kept so existing pins/behaviour still find them. */
  function dangerRow(label, sentence, btnLabel, id, act, fn) {
    const wrap = mk("div", "danger-row");
    const text = mk("p"); text.appendChild(document.createTextNode(label)); const small = mk("small"); small.innerHTML = sentence; text.appendChild(small);
    const btn = mk("button", "btn danger", btnLabel); btn.type = "button"; if (id) btn.id = id; if (act) btn.dataset.act = act;
    btn.onclick = () => fn().catch((e) => alert(e.message));
    wrap.append(text, btn); return wrap;
  }
  function renderDangerZone() {
    const box = $("danger-rows"); if (!box) return; box.innerHTML = "";
    const c = state.client; const g = (c && c.generated) || {};
    const { deployed } = lockState();
    const liveAddress = Boolean(g.webAddress && g.webAddress.live);
    box.appendChild(dangerRow("Revert web address", "Go back to the old *.vercel.app address. Redirects are removed first, then this address stops being used.", "Revert web address…", "m-revert-address", "revert-address", webAddress.revert));
    box.appendChild(dangerRow("Move hosting", "Transfer the project in Vercel (same URL) or start a fresh project with a new token — for moving to another Vercel account.", "Move hosting to another Vercel account…", null, "move", moveHosting));
    box.appendChild(dangerRow("Fresh start on Vercel", "Delete this Vercel project and deploy fresh into the SAME account — same database, images and logins; only the hosting is rebuilt.", "Fresh start on Vercel…", null, "fresh", freshStart));
    box.appendChild(dangerRow("Reset demo database", "Demo clients only: drop the database and seed it fresh from this file.", "Reset demo database…", "m-reset", "reset", resetDemo));
    box.appendChild(dangerRow("Reset & seed demo data", "Demo clients only: drop the database and rebuild it with a month of realistic demo data (menu photos need the R2 keys on the Hosting tab).", "Seed demo data…", "m-seed", "seed", seedDemo));
    box.appendChild(dangerRow("Archive client", "Move the record out of the list (kept, restorable). Vercel and Atlas are not touched — a retire checklist is shown.", "Archive client…", null, "archive", archiveClient));
    box.appendChild(dangerRow("Delete client", "Only for a record that never deployed or seeded (a slip). Anything with history: Archive first, retire, then delete from the Archived list.", "Delete client…", null, "delete", deleteClient));
    // Each row's enabled/disabled state + its reason (per-action, computed from live client state).
    box.querySelector('[data-act="revert-address"]').disabled = !liveAddress; box.querySelector('[data-act="revert-address"]').title = liveAddress ? "" : "Only once the web address is live";
    box.querySelector('[data-act="move"]').disabled = !deployed; box.querySelector('[data-act="move"]').title = deployed ? "" : "Deploy first";
    const locked = isLocked();
    box.querySelector('[data-act="fresh"]').disabled = !deployed || locked; box.querySelector('[data-act="fresh"]').title = locked ? "Deploys are locked for this client (Status → Safety)" : deployed ? "" : "Nothing to clean up — this client has no Vercel project yet";
    box.querySelector('[data-act="reset"]').disabled = !(c && c.demo === true); box.querySelector('[data-act="reset"]').title = box.querySelector('[data-act="reset"]').disabled ? "Only for clients ticked as 'Demo client' (Status → Safety)" : "";
    box.querySelector('[data-act="seed"]').disabled = !(c && c.demo === true); box.querySelector('[data-act="seed"]').title = box.querySelector('[data-act="seed"]').disabled ? "Only for clients ticked as 'Demo client' (Status → Safety)" : "";
  }
  /** "Fresh start on Vercel" (A.5/A.6): delete the Vercel project (with ALL its
   *  domains/URLs, env vars, deployments, WAF rules) and deploy fresh into the
   *  SAME account. Database, images, admin/staff logins and secrets are NOT
   *  touched — staff stay signed in on the new address. The new project may get
   *  a DIFFERENT *.vercel.app name (Vercel does not reliably release the old
   *  one) — the web address (if any) is the stable URL and is re-attached by
   *  the run. Downtime: from delete to the new deploy finishing, ~3–5 minutes.
   *  WAF custom rules live on the project and are lost — re-add the 3 rules. */
  async function freshStart() {
    const g = (state.client && state.client.generated) || {};
    if (!g.projectId) return void alert("Nothing to clean up — this client has no Vercel project yet; Go live creates one.");
    const projectName = g.projectName || g.projectId;
    const domains = [g.webAddress && g.webAddress.host, g.host].filter(Boolean);
    const uniqueDomains = [...new Set(domains)];
    const r = await dialog({ title: "Fresh start on Vercel", okLabel: "Delete & start fresh", danger: true,
      body: [
        p(`Deletes the Vercel project <code>${esc(projectName)}</code>${uniqueDomains.length ? ` and with it ALL its web addresses: ${uniqueDomains.map((d) => `<code>${esc(d)}</code>`).join(", ")}` : ""} — its environment variables, deployments and WAF custom rules go too.`),
        p("<b>Stays exactly as it is:</b> the database, product images, admin/staff logins and secrets (staff stay signed in on the new address), and this client record."),
        p("<b>What happens next:</b> a new project with the same name is created in the SAME account (it usually gets the plain <code>.vercel.app</code> name back, but Vercel does not guarantee that — a suffixed name is possible; your web address is the stable URL either way), env vars are saved again, it deploys, and the web address is re-attached (the DNS records are shown again if Vercel needs to re-verify)."),
        p(`<span class="warn">The cafe is offline from the delete until the new deploy finishes — usually 3–5 minutes.</span> Afterwards: re-add the 3 WAF custom rules in Vercel (Security → WAF → Custom rules) — they cannot be recreated automatically.`),
      ],
      input: { label: `Type the project name "${projectName}" to confirm`, mustEqual: projectName } });
    if (!r.ok) return;
    $("log-body").textContent = ""; expandLog();
    const job = await api("POST", "/api/jobs", { name: state.name, action: "fresh-start", confirm: state.name, confirmProject: r.value });
    attachStream(job, "fresh-start");
  }

  // ── rollout: deploy the current code to every client, one after another ────
  let rolloutTimer = null;
  function chip(status) { return mk("span", `chip ${status}`, status); }
  function renderRollout(st) {
    const box = $("rollout"); box.hidden = !st;
    if (!st) { if (rolloutTimer) { clearInterval(rolloutTimer); rolloutTimer = null; } shell.renderRolloutsView(); return; }
    const s = { ...st.summary, running: st.summary.active }; // `active` = a target is running right now
    $("rl-summary").textContent = `${s.ok} ok · ${s.failed} failed · ${s.interrupted} interrupted · ${s.pending} pending · ${s.skipped} skipped${s.cancelled ? ` · ${s.cancelled} cancelled` : ""} — started ${new Date(st.startedAt).toLocaleString()}${st.finishedAt ? `, finished ${new Date(st.finishedAt).toLocaleTimeString()}` : s.running ? ", running…" : ""}${st.drivenBy && st.drivenBy !== "console" ? ` — driven by the ${st.drivenBy}; this page only watches` : ""}`;
    const rows = $("rl-rows"); rows.innerHTML = "";
    for (const t of st.targets) {
      const name = mk("div", "t", t.name); if (t.host !== "primary") name.appendChild(mk("small", null, `@${t.host}`)); name.appendChild(mk("small", null, t.profile));
      rows.append(name, mk("div", null, t.url ? t.url.replace(/^https:\/\//, "") : "—"), chip(t.status));
      if (t.error || t.reason) rows.appendChild(mk("div", "e", t.error || t.reason));
    }
    const retryable = st.targets.some((t) => ["failed", "interrupted", "cancelled"].includes(t.status)) || (s.pending > 0 && !s.running);
    const foreign = Boolean(st.drivenBy && st.drivenBy !== "console");
    $("rl-resume").hidden = foreign || !retryable || s.running; $("rl-resume").textContent = s.pending > 0 && !s.running && !st.targets.some((t) => t.status === "interrupted") ? "Resume" : "Retry failed / resume";
    $("rl-cancel").hidden = foreign || !(s.running || s.pending > 0) || st.cancelRequested;
    $("rl-dismiss").hidden = foreign || s.running;
    // Force stop & unlock…: only when a foreign (non-console) driver HOLDS the
    // rollout lock right now (`drivenBy` + `s.running` — a finished/interrupted
    // foreign rollout with no live process holding the lock has nothing to force).
    $("rl-force").hidden = !(foreign && s.running);
    $("rl-force").onclick = () => activity.forceReleaseRollout().then(refreshRollout).catch((e) => alert(e.message));
    document.body.classList.toggle("busy", Boolean(s.running));
    if (s.running && st.currentJob && (!state.job || state.job.id !== st.currentJob.id)) { $("log-body").textContent = ""; attachStream(st.currentJob, `${st.currentJob.action} ${st.currentJob.name}${st.currentJob.host ? ` @${st.currentJob.host}` : ""}`); }
    if (s.running || s.pending > 0) { if (!rolloutTimer) rolloutTimer = setInterval(() => refreshRollout().catch(() => {}), 2000); }
    else if (rolloutTimer) { clearInterval(rolloutTimer); rolloutTimer = null; loadList().catch(() => {}); }
    shell.renderRolloutsView();
  }
  async function refreshRollout() { renderRollout(await api("GET", "/api/rollout")); }
  async function startRollout() {
    if (state.dirty && !(await save())) return;
    const targets = []; const skipped = [];
    for (const c of state.list) {
      // Mirrors rollout.mjs targetsOf(): a locked client skips its primary AND every standby.
      if (c.deployLock) { skipped.push(`${c.name} — deploys locked`); for (const sb of c.standbys || []) skipped.push(`${c.name} @${sb.label} — deploys locked`); continue; }
      if (c.deployed) targets.push(`${c.name}  (${c.host || "primary"})`); else skipped.push(`${c.name} — never deployed`);
      for (const sb of c.standbys || []) (sb.deployed ? targets : skipped).push(sb.deployed ? `${c.name} @${sb.label}  (${sb.host})` : `${c.name} @${sb.label} — standby never deployed`);
    }
    const r = await dialog({ title: "Deploy the current code to all clients", okLabel: `Deploy ${targets.length} target(s)`,
      body: [p(`Runs <code>Redeploy</code> for each target below, <b>one after another</b> — same projects, same URLs, env vars and databases untouched. A failing target is marked and the queue moves on; the state is saved to disk after every step, so if this PC switches off you press <b>Resume</b> later and only the unfinished ones run.`), targets.length ? ul(targets.map(esc)) : p("<span class='warn'>No deployed, unlocked target found.</span>"), skipped.length ? p(`<small>Skipped: ${skipped.map(esc).join(" · ")}</small>`) : mk("span")] });
    if (!r.ok || !targets.length) return;
    renderRollout(await api("POST", "/api/rollout", {}));
  }
  $("rl-resume").onclick = () => api("POST", "/api/rollout/resume", {}).then(renderRollout).catch((e) => alert(e.message));
  $("rl-cancel").onclick = () => api("POST", "/api/rollout/cancel", {}).then(renderRollout).catch((e) => alert(e.message));
  $("rl-dismiss").onclick = () => api("DELETE", "/api/rollout", {}).then(() => renderRollout(null)).catch((e) => alert(e.message));

  $("add-standby").onclick = () => addStandby().catch((e) => alert(e.message));
  $("b-more").onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  document.addEventListener("click", (e) => { if (!e.target.closest(".more")) toggleMenu(false); });
  document.addEventListener("click", (e) => {
    // The More ▾ menu (clone, rollout) AND the Danger zone rows (move, fresh,
    // reset, revert-address, archive, delete) share this one delegation —
    // their button nodes are built in different places but never duplicated.
    const b = e.target.closest("button[data-act]"); if (!b || b.disabled) return;
    if (b.closest("#more-menu")) toggleMenu(false);
    const run_ = { clone: cloneClient, move: moveHosting, reset: resetDemo, seed: seedDemo, "revert-address": webAddress.revert, fresh: freshStart, archive: archiveClient, delete: deleteClient, rollout: startRollout }[b.dataset.act];
    if (run_) run_().catch((err) => alert(err.message));
  });

  // ── log panel: drag to resize, collapse, remembered ─────────────────────────
  /** The log starts MINIMIZED every time; it opens itself when a job starts (run/attach) and stays open after, until you collapse it. Only the height is remembered. */
  function applyLogPrefs() {
    const h = Number(store.get(LS.logH)); if (h >= 36) $("log").style.height = `${h}px`;
    $("log").classList.add("collapsed");
    $("log-toggle").textContent = "▴";
  }
  function toggleLog(force) {
    const el = $("log"); const collapse = force !== undefined ? force : !el.classList.contains("collapsed");
    el.classList.toggle("collapsed", collapse); $("log-toggle").textContent = collapse ? "▴" : "▾";
  }
  function expandLog() { if ($("log").classList.contains("collapsed")) toggleLog(false); }
  $("log-grip").onmousedown = (e) => {
    e.preventDefault(); const el = $("log"); const startY = e.clientY, startH = el.getBoundingClientRect().height; toggleLog(false);
    const move = (ev) => { const h = Math.max(36, Math.min(window.innerHeight - 160, startH + (startY - ev.clientY))); el.style.height = `${h}px`; };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); store.set(LS.logH, String(Math.round(el.getBoundingClientRect().height))); };
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  };
  $("log-grip").ondblclick = () => toggleLog();
  $("log-toggle").onclick = () => toggleLog();

  // ── wiring ──────────────────────────────────────────────────────────────────
  decorate(); applyLogPrefs();
  $("search").oninput = renderList;
  $("new").onclick = () => newClient().catch((e) => alert(e.message));
  $("b-save").onclick = () => save().catch((e) => banner([e.message], "bad", "Save failed:"));
  $("b-dry").onclick = () => run("dry-run").catch((e) => alert(e.message));
  $("b-live").onclick = () => run("go-live").catch((e) => alert(e.message));
  $("b-redeploy").onclick = () => run("redeploy").catch((e) => alert(e.message));
  $("b-refresh").onclick = () => refreshClient().catch((e) => alert(e.message));
  $("b-health").onclick = () => health().catch((e) => ($("s-health").textContent = "✗ " + e.message));
  $("b-open").onclick = () => { const g = state.client && state.client.generated; if (g && g.host) window.open(`https://${g.host}`, "_blank", "noopener"); };
  $("img-store").onchange = () => { showImage($("img-store").value); markDirty(); };
  $("tables-mode").onchange = () => {
    showTables(); markDirty();
    // Switching to a count from a names list must not turn into "0 tables": prefill with the list's size.
    if ($("tables-mode").value === "count" && !$("tables-count").value) $("tables-count").value = String($("tables-names").value.split("\n").filter((s) => s.trim()).length || 8);
  };
  $("menu").oninput = () => { menuCount(); markDirty(); };
  $("menu-demo").onclick = async () => { $("menu").value = JSON.stringify(await api("GET", "/api/demo-menu"), null, 2); menuCount(); markDirty(); };
  $("menu-clear").onclick = () => { $("menu").value = ""; menuCount(); markDirty(); };
  $("log-clear").onclick = () => ($("log-body").textContent = "");
  $("form").addEventListener("input", (e) => {
    if (e.target.matches("[data-path], #tables-count, #tables-names")) markDirty();
    if (e.target.matches('[data-path="vercel.project"], [data-path="subdomain"]')) projectUrlHint();
    if (e.target.matches('[data-path="deployLock"]')) applyLock();
    if (e.target.matches('[data-path="demo"]') && e.target.checked && !confirm("Mark this client as a DEMO?\n\nIts whole database can then be dropped from More → Reset demo database. Never do this on a real cafe.")) { e.target.checked = false; }
  });
  $("b-platform").onclick = () => shell.setHash("platform");
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (state.client) $("b-save").click(); } });
  window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });

  async function loadPlatform() {
    state.platform = await api("GET", "/api/platform").catch(() => null);
    $("platform-pill").textContent = state.platform ? "" : " · not set";
    if (state.client) { webAddress.render(); projectUrlHint(); renderStatus(); }
  }
  /** The Platform view's inline form — same PUT + 409 handling the old dialog used. */
  async function platformSave(apexDomainRaw, dnsNoteRaw) {
    const apexDomain = String(apexDomainRaw || "").trim().toLowerCase();
    const dnsNote = String(dnsNoteRaw || "").trim() || null;
    await api("PUT", "/api/platform", { apexDomain, dnsNote });
    await loadPlatform();
  }

  shell.wire();
  loadList().then(async () => {
    await loadPlatform();
    // Restore the last hash on reload (default: dashboard); an unknown hash
    // falls back to it too (parseHash() inside shell.render() handles that).
    // The last-OPENED client is still remembered separately (golive.lastClient)
    // so #/clients and #/dashboard can highlight it even when the hash itself
    // points elsewhere.
    if (!location.hash) { const lastHash = store.get(LS.hash); if (lastHash) location.hash = lastHash; }
    await shell.render();
    const cur = await api("GET", "/api/jobs/current");
    if (cur) { $("log-body").textContent = ""; attachStream(cur, `${cur.action} ${cur.name}${cur.host ? ` @${cur.host}` : ""}`); }
    await refreshRollout(); // an unfinished rollout (PC switched off?) shows up with Resume
    activity.start(); // ONE polling interval for /api/locks (JOB_POLL_MS), cleared on unload
  }).catch((e) => alert("Console failed to load: " + e.message));
})();
