// scripts/go-live/ui/activity.js — the topbar activity chip (§4 of the
// locks-and-force plan) and the console's cross-process lock awareness: polls
// GET /api/locks every JOB_POLL_MS so a deploy started from the CLI, another
// console tab, or another terminal is reflected here too. Owns:
//   - #activity: idle (hidden) · a console job running (View log / Stop…) ·
//     a live lock held by ANOTHER process (Force stop & unlock…).
//   - the disabled/title rule for THIS client's deploy + danger-zone buttons
//     (locked or a console job for THIS client) vs. another client's console
//     job (deploy buttons only, "one at a time").
//   - the small "running" chip on a locked/active client's table row.
//   - forceReleaseRollout(): the dialog + POST behind the Rollouts view's own
//     "Force stop & unlock…" button (app.js shows/hides it, keyed off the
//     rollout API's existing `drivenBy` — not this module's /api/locks poll).
// Split out of app.js; served by ui-server.mjs's STATIC map like shell.js.
export const JOB_POLL_MS = 4000;

/**
 * `deps`: { $, mk, esc, p, api, dialog, state, expandLog, onRefresh } — the
 * same DOM helpers and shared `state` object app.js already has, passed in so
 * this module needs no globals of its own. `onRefresh()` is called after
 * every poll (and after Stop/Force) so app.js can re-render whatever depends
 * on locks: the two tables' "running" chips, the open client's deploy +
 * danger-zone buttons, and the Rollouts view's Force button. `state.locks`
 * (this module's own field) holds the latest GET /api/locks snapshot:
 * { clients, stale, rollout, job } | null.
 */
export function createActivity(deps) {
  const { $, mk, esc, p, api, dialog, state, expandLog, onRefresh } = deps;
  let timer = null;

  /** Live locks are keyed by slug for O(1) lookup from table rows and the form. */
  function lockFor(slug) {
    const locks = state.locks && state.locks.clients;
    return Array.isArray(locks) ? locks.find((l) => l.slug === slug && l.alive) : undefined;
  }

  /** §4 disabled rule: THIS client locked/job → every deploy + danger-zone
   *  action disabled with the "wait or Stop it" title; another client's
   *  console job (one at a time) → only the deploy buttons disabled with the
   *  "one at a time" title; otherwise nothing from here disables anything
   *  (Save is never touched by this module). */
  function statusFor(slug) {
    const l = deps.state.locks;
    const job = l && l.job;
    const jobIsThisClient = Boolean(job && job.status === "running" && job.name === slug);
    const lockIsThisClient = Boolean(lockFor(slug));
    if (jobIsThisClient || lockIsThisClient) {
      return { disableDeploy: true, disableDanger: true, title: "A deploy is running for this client — wait or Stop it (top bar)." };
    }
    const jobIsOther = Boolean(job && job.status === "running" && job.name !== slug);
    if (jobIsOther) {
      return { disableDeploy: true, disableDanger: false, title: `Another job is running (${job.action} ${job.name}) — one at a time.` };
    }
    return { disableDeploy: false, disableDanger: false, title: "" };
  }

  /** Small "running" chip for a table row (dashboard + clients list share this). */
  function runningChip(slug) {
    const l = deps.state.locks;
    const jobHere = Boolean(l && l.job && l.job.status === "running" && l.job.name === slug);
    if (jobHere || lockFor(slug)) return mk("span", "chip running", "running");
    return null;
  }

  // ── topbar chip ──────────────────────────────────────────────────────────
  function clear(el) { el.innerHTML = ""; }
  function render() {
    const box = $("activity"); if (!box) return;
    const l = state.locks;
    const job = l && l.job && l.job.status === "running" ? l.job : null;
    // A live lock from ANOTHER process — the console's own running job also
    // holds a "console"-owned lock, so exclude that one to avoid a double chip.
    const foreignLock = l && Array.isArray(l.clients) ? l.clients.find((c) => c.alive && !(job && c.slug === job.name)) : null;
    clear(box);
    if (job) {
      box.hidden = false;
      box.appendChild(mk("span", null, `● Running: ${job.action} · ${job.name}`));
      const viewBtn = mk("button", "btn", "View log"); viewBtn.type = "button"; viewBtn.onclick = () => expandLog();
      const stopBtn = mk("button", "btn", "Stop…"); stopBtn.type = "button"; stopBtn.dataset.act = "stop-job";
      stopBtn.onclick = () => stopJob(job).catch((e) => alert(e.message));
      box.append(viewBtn, stopBtn);
    } else if (foreignLock) {
      box.hidden = false;
      box.appendChild(mk("span", null, `● Deploy running from the ${foreignLock.owner} · ${foreignLock.slug}`));
      const forceBtn = mk("button", "btn danger", "Force stop & unlock…"); forceBtn.type = "button"; forceBtn.dataset.act = "force-unlock";
      forceBtn.onclick = () => forceReleaseClient(foreignLock).catch((e) => alert(e.message));
      box.appendChild(forceBtn);
    } else {
      box.hidden = true;
    }
  }

  async function stopJob(job) {
    const r = await dialog({ title: "Stop the running job?", okLabel: "Stop", danger: true,
      body: [p(`Stop the running ${esc(job.action)} for ${esc(job.name)}? A stopped run is safe to repeat — every step checks before it changes anything.`)] });
    if (!r.ok) return;
    await api("POST", `/api/jobs/${job.id}/stop`, {});
    await refresh();
  }

  async function forceReleaseClient(lock) {
    const r = await dialog({ title: `Force stop & unlock "${lock.slug}"`, okLabel: "Force stop & unlock", danger: true,
      body: [p(`This kills the process holding the lock for "${esc(lock.slug)}" (${esc(lock.action)}, started from the ${esc(lock.owner)}, pid ${lock.pid}) if it is still ours, and frees the lock either way. Use this only when the status is not updating on its own.`)],
      input: { label: `Type the slug "${lock.slug}" to confirm`, mustEqual: lock.slug } });
    if (!r.ok) return;
    await api("POST", `/api/locks/${lock.slug}/force-release`, { confirm: r.value });
    await refresh();
  }

  async function forceReleaseRollout() {
    const r = await dialog({ title: "Force stop & unlock the rollout", okLabel: "Force stop & unlock", danger: true,
      body: [p("This kills the process driving \"Deploy update to all clients\" if it is still ours, and frees the rollout lock either way. Use this only when the status is not updating on its own.")],
      input: { label: 'Type "rollout" to confirm', mustEqual: "rollout" } });
    if (!r.ok) return;
    await api("POST", "/api/rollout/force-release", { confirm: r.value });
    await refresh();
  }

  // ── polling: ONE interval, started on load, cleared on unload ───────────
  async function refresh() {
    state.locks = await api("GET", "/api/locks").catch(() => state.locks || null);
    render();
    onRefresh();
  }
  function start() {
    if (timer) return;
    refresh().catch(() => {});
    timer = setInterval(() => refresh().catch(() => {}), JOB_POLL_MS);
    window.addEventListener("beforeunload", stop);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return { start, stop, refresh, render, statusFor, runningChip, forceReleaseRollout };
}
