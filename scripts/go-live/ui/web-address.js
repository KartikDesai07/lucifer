// scripts/go-live/ui/web-address.js — the #web-address panel (chip · sentence ·
// records table · Check DNS & verify · help) and the "Revert web address…"
// flow, split out of app.js to keep that file under ~650 lines. Imported by
// app.js as an ES module; served by ui-server.mjs's STATIC map like pure.mjs.
import { webAddressStateOf } from "./pure.mjs";

/**
 * `deps`: { $, mk, api, copyText, esc, p, dialog, state, renderStatus,
 *   markDirty, save, run } — the same DOM helpers and shared `state` object
 *  app.js already has, passed in so this module needs no globals of its own.
 */
export function createWebAddress(deps) {
  const { $, mk, api, copyText, esc, p, dialog, state, renderStatus, markDirty, save, run } = deps;

  function chipFor(state_) {
    const ok = ["ready", "live"].includes(state_); const bad = ["check-failed", "tenant-mismatch"].includes(state_); const plain = state_ === "none";
    return mk("span", `chip ${ok ? "ok" : bad ? "failed" : plain ? "" : "pending"}`, state_);
  }

  function render() {
    const box = $("web-address"); if (!box) return;
    box.innerHTML = "";
    const apex = state.platform && state.platform.apexDomain;
    $("apex-suffix").textContent = apex ? `.${apex}` : "";
    const subInput = document.querySelector('[data-path="subdomain"]');
    subInput.disabled = !apex;
    subInput.title = apex ? "" : "Set the apex domain first (⚙ Platform)";
    const ws = webAddressStateOf(state.client, state.platform);
    box.appendChild(chipFor(ws.state));
    box.appendChild(mk("div", "sentence", ws.message));
    const w = state.client && state.client.generated && state.client.generated.webAddress;
    const records = w && Array.isArray(w.records) ? w.records : [];
    if (records.length && ws.state !== "live") {
      const table = mk("table");
      const thead = mk("tr"); ["Type", "Name", "Value", ""].forEach((h) => thead.appendChild(mk("th", null, h))); table.appendChild(thead);
      for (const r of records) {
        const tr = mk("tr"); tr.appendChild(mk("td", null, r.type)); tr.appendChild(mk("td", null, r.name)); tr.appendChild(mk("td", null, r.value));
        const td = mk("td"); const cp = mk("button", "icon", "⧉"); cp.type = "button"; cp.title = "copy"; cp.onclick = () => copyText(r.value, cp); td.appendChild(cp); tr.appendChild(td);
        table.appendChild(tr);
      }
      box.appendChild(table);
    }
    const acts = mk("div", "acts");
    const deployed = Boolean(state.client && state.client.generated && state.client.generated.projectId);
    const canCheck = Boolean(state.client && state.client.subdomain && deployed && !state.dirty && !state.isNew);
    const check = mk("button", "btn", "Check DNS & verify"); check.type = "button"; check.disabled = !canCheck;
    check.title = canCheck ? "" : state.dirty || state.isNew ? "Save first" : !deployed ? "Deploy first (Go live)" : "Set a web address first";
    check.onclick = () => checkNow().catch((e) => alert(e.message));
    acts.appendChild(check);
    box.appendChild(acts);
    const help = mk("details", "help");
    const summary = mk("summary", null, "How do I add these records?"); help.appendChild(summary);
    const ol = mk("ol");
    const dnsNote = (state.platform && state.platform.dnsNote) || "your DNS provider";
    ol.appendChild(mk("li", null, `${dnsNote} → Add New Record.`));
    ol.appendChild(mk("li", null, "CNAME: Type CNAME, Name = the first part only (shown above), Value = the target shown in the table, TTL 1 hour."));
    if (records.some((r) => r.type === "TXT")) ol.appendChild(mk("li", null, 'TXT: Type TXT, Name "_vercel" (as shown), Value as shown — add it as an EXTRA record, keep the existing ones.'));
    ol.appendChild(mk("li", null, "Never touch @, www, or MX."));
    ol.appendChild(mk("li", null, "Changes usually show in minutes (up to 48 hours). Vercel's own check decides — press Check DNS & verify."));
    help.appendChild(ol);
    help.appendChild(mk("p", null, "Let's Encrypt (the free certificate authority Vercel uses) allows at most about 40 new cafes per week on one apex domain."));
    box.appendChild(help);
  }

  async function checkNow() {
    const box = $("web-address"); const btn = box.querySelector(".acts .btn");
    if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
    try {
      await api("POST", `/api/clients/${state.name}/web-address/check`, {});
      const fresh = await api("GET", `/api/clients/${state.name}`);
      state.client = { ...state.client, generated: fresh.generated };
      render(); renderStatus();
    } finally { if (btn) btn.textContent = "Check DNS & verify"; }
  }

  /** Go back to the old *.vercel.app address: clears the subdomain, saves, then
   *  runs go-live so run.mjs removes the *.vercel.app redirects BEFORE anything
   *  else changes (a redirect left in place would loop the old address into a 404). */
  async function revert() {
    const w = state.client && state.client.generated && state.client.generated.webAddress;
    if (!w || !w.live) return void alert("No live web address to revert.");
    const r = await dialog({ title: "Revert web address", okLabel: "Revert & run", danger: true,
      body: [p(`Goes back to the old <b>*.vercel.app</b> address. The redirects on it are removed FIRST, then <code>${esc(w.host)}</code> stops being used (it stays attached in Vercel — remove it there if you like).`), p("Staff and devices pointed at the web address will need the old *.vercel.app address again.")] });
    if (!r.ok) return;
    document.querySelector('[data-path="subdomain"]').value = "";
    markDirty();
    if (!(await save())) return;
    await run("go-live");
  }

  return { render, check: checkNow, revert };
}
