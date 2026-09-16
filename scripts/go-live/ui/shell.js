// scripts/go-live/ui/shell.js — the SaaS-style admin shell: hash routing between
// the 6 views (dashboard/clients/client/rollouts/archive/platform), the sidebar
// nav's active state + counts, the dashboard KPIs + clients table, the client
// view's tabs, and the inline Platform form. Split out of app.js (which still
// owns the client FORM itself — fill/collect/save/run/dialogs — and calls back
// into this module only for routing + the two tables). Served by ui-server.mjs's
// STATIC map like pure.mjs / web-address.js.
import { runStateOf, webAddressStateOf } from "./pure.mjs";

const ROUTES = ["dashboard", "clients", "client", "rollouts", "archive", "platform"];
const LS_HASH = "golive.lastHash";
const DEFAULT_TAB = "overview";
/** Web-address states that mean "the owner has to act" — counted on the dashboard next to the pending ones. */
const PENDING_STATES = ["pending-dns", "pending-verify", "pending-cert", "not-attached", "check-failed", "tenant-mismatch"];

/**
 * `deps`: { $, mk, esc, api, state, store, openClient, renderList, renderArchived,
 *   fill, dirtyGuard, platformSave, webAddressBadge, runningChip } — DOM
 *  helpers and app.js's existing functions, passed in so this module needs no
 *  globals of its own. `runningChip(slug)` (from activity.js, via app.js) is
 *  the small "running" chip shown on a locked/active client's row.
 */
export function createShell(deps) {
  const { $, mk, esc, api, state, store, openClient, renderList, renderArchived, fill, dirtyGuard, platformSave, webAddressBadge, runningChip, runBadge } = deps;
  let current = null; // the route the page is showing right now ({ route, slug, tab }) — for the leaving-a-client guard
  const knownTabs = () => [...document.querySelectorAll("#client-tabs [data-tab]")].map((b) => b.dataset.tab);

  function parseHash() {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    const parts = raw.split("/").filter(Boolean);
    if (parts[0] === "client" && parts[1]) { const tabs = knownTabs(); return { route: "client", slug: parts[1], tab: tabs.includes(parts[2]) ? parts[2] : DEFAULT_TAB }; }
    if (ROUTES.includes(parts[0])) return { route: parts[0] };
    return { route: "dashboard" };
  }

  function setHash(route, slug, tab) {
    const h = route === "client" ? `#/client/${slug}${tab ? `/${tab}` : ""}` : `#/${route}`;
    if (location.hash !== h) location.hash = h; else render();
  }

  function showView(route) {
    for (const r of ROUTES) { const v = $(`view-${r}`); if (v) v.hidden = r !== route; }
    document.querySelectorAll("#nav a[data-route]").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
  }

  function activeTab(name) {
    document.querySelectorAll("#client-tabs [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".panel[data-panel]").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
  }

  // ── dashboard KPIs + shared table-row renderer (dashboard's full table AND the Clients view share the same row shape) ──
  function kpiCard(value, label) { const c = mk("div", "kpi"); c.appendChild(mk("b", null, String(value))); c.appendChild(mk("span", null, label)); return c; }
  function renderKpis(rows, platform) {
    const box = $("kpis"); if (!box) return; box.innerHTML = "";
    const apex = platform && platform.apexDomain;
    const live = rows.filter((c) => c.webAddress && c.webAddress.state === "live").length;
    const job = state.locks && state.locks.job;
    const waiting = rows.filter((c) => (c.webAddress && PENDING_STATES.includes(c.webAddress.state)) || runStateOf(c, job) === "interrupted").length;
    const problems = rows.reduce((n, c) => n + (c.problems || 0), 0);
    const locked = rows.filter((c) => c.deployLock).length;
    box.appendChild(kpiCard(rows.length, "Clients"));
    box.appendChild(kpiCard(live, apex ? `Live on .${apex}` : "Live on the web address"));
    box.appendChild(kpiCard(waiting, "Address pending or needs attention"));
    box.appendChild(kpiCard(problems, "Problems to fix"));
    box.appendChild(kpiCard(locked, "Locked"));
  }
  // ONE renderer for the web-address badge (app.js owns it) — the dashboard and the Clients table never drift apart.
  function webAddrCell(c) { return webAddressBadge(c.webAddress); }
  function tableRow(c, { clickable = true } = {}) {
    const tr = mk("tr", clickable && !c.broken ? "clickable" : "");
    const nameTd = mk("td", null, c.cafeName || c.name);
    const running = runningChip && runningChip(c.name); if (running) nameTd.append(" ", running);
    tr.appendChild(nameTd);
    tr.appendChild(mk("td", null, c.name));
    const waTd = mk("td"); if (c.broken) waTd.appendChild(mk("span", "badge bad", "file is not valid JSON")); else waTd.appendChild(webAddrCell(c)); tr.appendChild(waTd);
    tr.appendChild(mk("td", null, c.host || "—"));
    const lastTd = mk("td", null, c.lastRun ? `${c.lastRun.action} · ${c.lastRun.status}` : "never");
    const runBadgeEl = runBadge && runBadge(c); if (runBadgeEl) lastTd.append(" ", runBadgeEl);
    tr.appendChild(lastTd);
    tr.appendChild(mk("td", null, c.problems ? String(c.problems) : "—"));
    const openTd = mk("td"); if (!c.broken) { const b = mk("button", "btn", "Open →"); b.type = "button"; b.onclick = (e) => { e.stopPropagation(); setHash("client", c.name); }; openTd.appendChild(b); }
    tr.appendChild(openTd);
    if (clickable && !c.broken) tr.onclick = () => setHash("client", c.name);
    return tr;
  }
  function renderDashboard() {
    const rows = [...state.list].sort((a, b) => (a.cafeName || a.name).localeCompare(b.cafeName || b.name));
    renderKpis(rows, state.platform);
    const body = $("dash-table-body"); if (body) { body.innerHTML = ""; for (const c of rows) body.appendChild(tableRow(c)); if (!rows.length) body.appendChild(mk("tr")).appendChild(mk("td", "empty", "No clients yet — + New client")).colSpan = 7; }
    const recentBody = $("dash-recent-body");
    if (recentBody) {
      recentBody.innerHTML = "";
      const recent = rows.filter((c) => c.lastRun).sort((a, b) => new Date(b.lastRun.at) - new Date(a.lastRun.at)).slice(0, 8);
      for (const c of recent) {
        const tr = mk("tr");
        tr.appendChild(mk("td", null, c.cafeName || c.name)); tr.appendChild(mk("td", null, c.lastRun.action));
        tr.appendChild(mk("td", null, c.lastRun.status)); tr.appendChild(mk("td", null, new Date(c.lastRun.at).toLocaleString()));
        recentBody.appendChild(tr);
      }
      if (!recent.length) { const tr = mk("tr"); const td = mk("td", "empty", "No runs yet."); td.colSpan = 4; tr.appendChild(td); recentBody.appendChild(tr); }
    }
  }
  function updateNavCounts() {
    $("nav-clients-count").textContent = state.list.length ? String(state.list.length) : "";
    $("nav-archive-count").textContent = (state.archived || []).length ? String(state.archived.length) : "";
  }

  // ── client switcher (jump to another client without leaving the client view) ──
  function renderSwitcher() {
    const sel = $("switcher"); if (!sel) return;
    sel.innerHTML = "";
    const opt0 = mk("option", null, "Switch client…"); opt0.value = ""; sel.appendChild(opt0);
    for (const c of [...state.list].sort((a, b) => (a.cafeName || a.name).localeCompare(b.cafeName || b.name))) {
      const o = mk("option", null, c.cafeName || c.name); o.value = c.name; if (c.name === state.name) o.selected = true; sel.appendChild(o);
    }
  }

  // ── rollouts / archive views: no rendering of their own beyond the pre-existing
  //    #rollout / #archived-list nodes app.js already fills — just empty-state toggling.
  function renderRolloutsView() { $("rollouts-empty").hidden = !$("rollout").hidden; }

  // ── platform (inline form, replaces the old dialog-only flow) ──
  function fillPlatformForm() {
    const p = state.platform;
    $("platform-apex").value = p ? p.apexDomain : "";
    $("platform-note").value = p ? p.dnsNote || "" : "";
  }

  async function render() {
    const r = parseHash();
    // Unsaved edits are only at risk when LEAVING the open client (another client, or
    // another view) — a tab switch inside the same client changes nothing.
    const leaving = current && current.route === "client" && state.dirty && (r.route !== "client" || r.slug !== state.name);
    if (leaving && !(await dirtyGuard())) { location.hash = `#/client/${state.name}/${current.tab || DEFAULT_TAB}`; return; }
    showView(r.route);
    store.set(LS_HASH, r.route === "client" ? `#/client/${r.slug}/${r.tab}` : `#/${r.route}`);
    updateNavCounts(); // the sidebar counts are right on EVERY view, not only the list views
    if (r.route === "dashboard") renderDashboard();
    else if (r.route === "clients") renderList();
    else if (r.route === "client") {
      // A brand-new, unsaved client (state.isNew) has no GET to fetch — its hash
      // was set by newClient()/cloneClient() right after they filled state.client.
      if (state.name !== r.slug) await openClient(r.slug, { guarded: false }); // the guard above already asked
      activeTab(r.tab); renderSwitcher();
    } else if (r.route === "rollouts") renderRolloutsView();
    else if (r.route === "archive") renderArchived();
    else if (r.route === "platform") fillPlatformForm();
    current = r;
  }

  function wire() {
    window.addEventListener("hashchange", () => render().catch((e) => alert(e.message)));
    document.querySelectorAll("#client-tabs [data-tab]").forEach((b) => b.onclick = () => setHash("client", state.name, b.dataset.tab));
    $("switcher").onchange = () => { const v = $("switcher").value; if (v) setHash("client", v); };
    $("rl-start-2").onclick = () => $("rl-start").click();
    $("platform-save").onclick = () => platformSave($("platform-apex").value, $("platform-note").value).catch((e) => alert(e.message));
  }

  return { render, setHash, wire, renderDashboard, renderSwitcher, updateNavCounts, renderRolloutsView };
}
