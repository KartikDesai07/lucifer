// scripts/go-live/rollout.mjs — "deploy this code update to EVERY client": the
// plan (which targets), the durable state (clients/_rollout.json, so a PC that
// switches off mid-way resumes where it stopped), and the pure transitions. The
// console (ui-server.mjs) and the CLI (index.mjs --deploy-all) both drive this;
// each target is one ordinary redeploy (`scripts/deploy.mjs --profile <p>`), run
// ONE AT A TIME, and a failure never stops the queue — it is recorded and the
// next target starts.

export const ROLLOUT_FILE = "_rollout.json";
export const STATUS = { pending: "pending", running: "running", ok: "ok", failed: "failed", skipped: "skipped", interrupted: "interrupted", cancelled: "cancelled" };
const RETRYABLE = new Set([STATUS.failed, STATUS.interrupted, STATUS.cancelled]);

/** The deploy targets of one client record: its primary (profile <slug>) and
 *  every standby (profile <slug>-<label>) that has actually been deployed.
 *  Locked records and never-deployed slots are listed as SKIPPED with the
 *  reason, so the owner sees them rather than wondering. */
export function targetsOf(name, client) {
  const out = [];
  const locked = client && client.deployLock === true;
  const g = (client && client.generated) || {};
  const base = { name, host: "primary", profile: name, url: g.host ? `https://${g.host}` : null };
  if (locked) out.push({ ...base, status: STATUS.skipped, reason: "deploys locked (Status → Safety)" });
  else if (!g.projectId) out.push({ ...base, status: STATUS.skipped, reason: "never deployed" });
  else out.push({ ...base, status: STATUS.pending });
  for (const h of Array.isArray(client && client.standbyHosts) ? client.standbyHosts : []) {
    if (!h || !h.label) continue;
    const sg = h.generated || {};
    const t = { name, host: h.label, profile: `${name}-${h.label}`, url: sg.host ? `https://${sg.host}` : null };
    if (locked) out.push({ ...t, status: STATUS.skipped, reason: "deploys locked (Status → Safety)" });
    else if (!sg.projectId) out.push({ ...t, status: STATUS.skipped, reason: "standby never deployed" });
    else out.push({ ...t, status: STATUS.pending });
  }
  return out;
}

/** Plan a rollout over `records` = [{ name, client }] (active clients only). */
export function planRollout(records) {
  return [...records].sort((a, b) => a.name.localeCompare(b.name)).flatMap(({ name, client }) => targetsOf(name, client));
}

export function newRollout(targets, now, label = "code update") {
  return { id: String(now), label, startedAt: new Date(now).toISOString(), finishedAt: null, cancelRequested: false, targets: targets.map((t) => ({ ...t, startedAt: null, finishedAt: null, exitCode: null, error: null })) };
}

/** A target that says "running" in a file we are only now reading was cut off
 *  (the process died — PC off, console closed). Its outcome is unknown, so it
 *  is marked interrupted and offered for a re-run. */
export function markInterrupted(state) {
  let changed = false;
  for (const t of state.targets) if (t.status === STATUS.running) { t.status = STATUS.interrupted; t.error = "the console/CLI stopped while this deploy was running — outcome unknown, re-run it"; changed = true; }
  return changed;
}

export function nextPending(state) {
  if (state.cancelRequested) return -1;
  return state.targets.findIndex((t) => t.status === STATUS.pending);
}

export function markRunning(state, index, now) {
  const t = state.targets[index];
  t.status = STATUS.running; t.startedAt = new Date(now).toISOString(); t.finishedAt = null; t.exitCode = null; t.error = null;
}

export function applyResult(state, index, { ok, exitCode, error }, now) {
  const t = state.targets[index];
  t.status = ok ? STATUS.ok : STATUS.failed; t.finishedAt = new Date(now).toISOString(); t.exitCode = exitCode ?? null; t.error = ok ? null : (error || `deploy exited with code ${exitCode}`);
}

/** Put every failed / interrupted / cancelled target back in the queue. */
export function requeueRetryable(state) {
  let n = 0;
  for (const t of state.targets) if (RETRYABLE.has(t.status)) { t.status = STATUS.pending; t.error = null; t.exitCode = null; n += 1; }
  state.cancelRequested = false; state.finishedAt = null;
  return n;
}

/** Cancel = finish the running target, then stop; pending ones become "cancelled" when the loop reaches them. */
export function requestCancel(state) {
  state.cancelRequested = true;
  for (const t of state.targets) if (t.status === STATUS.pending) t.status = STATUS.cancelled;
}

export function isRunning(state) {
  return Boolean(state) && state.targets.some((t) => t.status === STATUS.running);
}

export function isFinished(state) {
  return Boolean(state) && !state.targets.some((t) => t.status === STATUS.pending || t.status === STATUS.running);
}

export function summarize(state) {
  const counts = {};
  for (const s of Object.values(STATUS)) counts[s] = 0;
  for (const t of state.targets) counts[t.status] = (counts[t.status] || 0) + 1;
  // `running` is the COUNT of running targets (like every other status key); `active` is the boolean.
  return { ...counts, total: state.targets.length, finished: isFinished(state), active: isRunning(state) };
}

// ── one driver at a time ──────────────────────────────────────────────────────
// The console and the CLI share the same state file; a lock file next to it names
// the process that is driving the rollout. A lock whose pid is dead is stale (PC
// switched off, console closed) and is taken over — that is exactly the resume
// case; a lock whose pid is alive means "another process is deploying right now".
export const ROLLOUT_LOCK = "_rollout.lock";
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err && err.code === "EPERM"; }
}
export function readRolloutLock(fs, dir, join) {
  const file = join(dir, ROLLOUT_LOCK);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { corrupt: true }; }
}
/** Returns { ok: true } after writing the lock, or { ok: false, held } when a live process holds it. */
export function acquireRolloutLock(fs, dir, join, { owner, pid, isAlive = pidAlive, now = Date.now }) {
  const held = readRolloutLock(fs, dir, join);
  if (held && !held.corrupt && held.pid !== pid && isAlive(held.pid)) return { ok: false, held };
  fs.writeFileSync(join(dir, ROLLOUT_LOCK), `${JSON.stringify({ owner, pid, at: new Date(now()).toISOString() })}\n`, "utf8");
  return { ok: true, tookOver: Boolean(held) };
}
/** Only the holder releases its own lock. */
export function releaseRolloutLock(fs, dir, join, pid) {
  const held = readRolloutLock(fs, dir, join);
  if (held && (held.pid === pid || held.corrupt)) fs.rmSync(join(dir, ROLLOUT_LOCK));
}
/** A live lock held by someone else? (for read-only views and guards) */
export function foreignLock(fs, dir, join, pid, isAlive = pidAlive) {
  const held = readRolloutLock(fs, dir, join);
  return held && !held.corrupt && held.pid !== pid && isAlive(held.pid) ? held : null;
}

export function loadRollout(fs, dir, join) {
  const file = join(dir, ROLLOUT_FILE);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

export function saveRollout(fs, dir, join, state) {
  fs.writeFileSync(join(dir, ROLLOUT_FILE), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function clearRollout(fs, dir, join) {
  const file = join(dir, ROLLOUT_FILE);
  if (fs.existsSync(file)) fs.rmSync(file);
}

/**
 * The CLI loop (`npm run go-live -- --deploy-all [--resume]`): one target after
 * another via `deploy.mjs --profile`, state saved to disk before and after each,
 * failures recorded and skipped over. `deps`: { fs, join, spawn, log, now, dir,
 * root, records? }. Returns the final state.
 */
export function runRolloutCli({ resume = false }, deps) {
  const pid = deps.pid ?? process.pid;
  const lock = acquireRolloutLock(deps.fs, deps.dir, deps.join, { owner: "cli", pid, isAlive: deps.isAlive, now: deps.now });
  if (!lock.ok) throw new Error(`another process is driving a rollout right now (${lock.held.owner}, pid ${lock.held.pid}, since ${lock.held.at}) — let it finish, or close it, then run again`);
  try {
    let state = resume ? loadRollout(deps.fs, deps.dir, deps.join) : null;
    if (resume && !state) throw new Error("nothing to resume — no unfinished rollout on disk");
    if (!resume && state === null) {
      const onDisk = loadRollout(deps.fs, deps.dir, deps.join);
      if (onDisk && !isFinished(onDisk)) throw new Error("an unfinished rollout is on disk — run with --resume to continue it (or dismiss it in the console) instead of starting over");
    }
    if (state) { markInterrupted(state); requeueRetryable(state); }
    else state = newRollout(planRollout(deps.records()), deps.now());
    saveRollout(deps.fs, deps.dir, deps.join, state);
    const s0 = summarize(state);
    deps.log(`▶ rollout: ${s0.pending} target(s) to deploy, ${s0.skipped} skipped${s0.ok ? `, ${s0.ok} already done` : ""}`);
    for (;;) {
      const i = nextPending(state);
      if (i < 0) break;
      const t = state.targets[i];
      markRunning(state, i, deps.now()); saveRollout(deps.fs, deps.dir, deps.join, state);
      deps.log(`▶ [${i + 1}/${state.targets.length}] ${t.name}${t.host !== "primary" ? ` @${t.host}` : ""} → profile ${t.profile}`);
      const res = deps.spawn(process.execPath, [deps.join(deps.root, "scripts", "deploy.mjs"), "--profile", t.profile], { cwd: deps.root, env: deps.env, stdio: "inherit", windowsHide: true });
      applyResult(state, i, { ok: res.status === 0, exitCode: res.status ?? -1, error: res.error ? res.error.message : null }, deps.now());
      saveRollout(deps.fs, deps.dir, deps.join, state);
      deps.log(res.status === 0 ? `   ✓ ${t.profile} deployed` : `   ✗ ${t.profile} FAILED (exit ${res.status}) — continuing with the next one`);
    }
    state.finishedAt = new Date(deps.now()).toISOString(); saveRollout(deps.fs, deps.dir, deps.join, state);
    return state;
  } finally {
    releaseRolloutLock(deps.fs, deps.dir, deps.join, pid);
  }
}
