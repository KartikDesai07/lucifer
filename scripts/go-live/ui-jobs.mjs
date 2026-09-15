// scripts/go-live/ui-jobs.mjs — runs ONE owner-console job at a time (dry run,
// go live, preview, redeploy) as a child process and keeps its output so a browser
// can stream it (Server-Sent Events in ui-server.mjs). Pure enough to test with a
// fake `spawn`/`commandFor`.

import { spawnSync } from "node:child_process";
import path from "node:path";

export const ACTIONS = ["dry-run", "go-live", "preview", "redeploy", "reset-demo", "seed-demo", "fresh-start"];
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const MAX_LINES = 5_000;

/** After SIGTERM, how long to wait before SIGKILL (non-Windows only -- Windows
 *  taskkill /F is already forceful). */
export const KILL_GRACE_MS = 3_000;

/** Kill a job's whole process tree -- the "Stop" button's default. Windows has
 *  no SIGTERM/process-group story for a plain spawn, so taskkill /T /F
 *  (tree, force) is the one reliable way to take down a Vercel-CLI/tsx child
 *  and its own children; elsewhere SIGTERM first (graceful), then SIGKILL
 *  after KILL_GRACE_MS if it is still around. */
export function killTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }
  try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  setTimeout(() => { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }, KILL_GRACE_MS);
}

/** The command line for an action — always the same scripts the CLI path uses.
 *  go-live gets the client FILE PATH (index.mjs accepts a .json path), so the
 *  console and the CLI can never disagree about which folder a client lives in;
 *  redeploy goes by profile name, which equals the slug. */
export function commandFor(root, action, name, clientPath = name, extra = {}) {
  const goLive = path.join(root, "scripts", "go-live", "index.mjs");
  // A standby host: `--host <label>` for the go-live runs, `<slug>-<label>` as the deploy profile.
  const standby = extra.host && extra.host !== "primary" ? String(extra.host) : null;
  const hostArgs = standby ? ["--host", standby] : [];
  switch (action) {
    case "dry-run":
      return { cmd: process.execPath, args: [goLive, clientPath, "--dry-run", ...hostArgs] };
    case "go-live":
      return { cmd: process.execPath, args: [goLive, clientPath, ...hostArgs] };
    case "preview":
      return { cmd: process.execPath, args: [goLive, clientPath, "--preview", ...hostArgs] };
    case "reset-demo":
      // The typed slug AND the database name the owner was shown travel to the CLI, which re-checks both against the file.
      return { cmd: process.execPath, args: [goLive, clientPath, "--reset-demo", "--confirm", String(extra.confirm ?? ""), "--confirm-db", String(extra.confirmDb ?? "")] };
    case "seed-demo":
      // Same guards as reset-demo, plus an optional images folder on this pc.
      return { cmd: process.execPath, args: [goLive, clientPath, "--seed-demo", "--confirm", String(extra.confirm ?? ""), "--confirm-db", String(extra.confirmDb ?? ""), ...(extra.imagesDir ? ["--images", String(extra.imagesDir)] : [])] };
    case "fresh-start":
      // The typed slug AND the project name shown travel to the CLI, which re-checks both against the file.
      return { cmd: process.execPath, args: [goLive, clientPath, "--fresh-start", "--confirm", String(extra.confirm ?? ""), "--confirm-project", String(extra.confirmProject ?? "")] };
    case "redeploy":
      return { cmd: process.execPath, args: [path.join(root, "scripts", "deploy.mjs"), "--profile", standby ? `${name}-${standby}` : name] };
    default:
      throw new Error(`unknown action "${action}"`);
  }
}

/** Split a stdout/stderr chunk into clean lines; carriage-return spinners collapse to their last frame. */
export function cleanLines(text) {
  return text
    .replace(ANSI_RE, "")
    .split(/\r?\n/)
    .map((l) => l.split("\r").pop())
    .filter((l) => l.trim().length > 0);
}

export function createJobRunner({ root, spawn, commandFor: cmdFor = commandFor, env = process.env, now = () => Date.now(), killTree: kill = killTree }) {
  let current = null;
  let seq = 0;

  function push(job, rawLine) {
    const line = job.redact ? job.redact(rawLine) : rawLine;
    if (job.lines.length >= MAX_LINES) job.lines.shift();
    job.lines.push(line);
    for (const fn of job.listeners) fn({ type: "line", line });
  }

  /** `status` lets a caller finish a job as something other than ok/failed —
   *  "stopped" for the owner's Force-Stop button. */
  function finish(job, code, error, status) {
    job.status = status ?? (code === 0 && !error ? "ok" : "failed");
    job.exitCode = code;
    job.finishedAt = now();
    if (error) push(job, `job error: ${error}`);
    for (const fn of job.listeners) fn({ type: "done", status: job.status, exitCode: code });
    job.listeners.clear();
  }

  return {
    /** null when idle, else the running/last job (kept until the next start). */
    current: () => current,
    isBusy: () => Boolean(current && current.status === "running"),

    /** `redact(line)` — the server passes a scrubber built from the client file's
     *  secrets, so a token/URI/password can never reach the streamed log even if a
     *  child process prints it in an error. */
    start({ name, action, clientPath, redact = (l) => l, extra = {} }) {
      if (!ACTIONS.includes(action)) throw new Error(`unknown action "${action}"`);
      if (this.isBusy()) throw Object.assign(new Error(`a job is already running (${current.action} ${current.name})`), { code: "busy" });
      const { cmd, args } = cmdFor(root, action, name, clientPath, extra);
      const host = extra.host && extra.host !== "primary" ? String(extra.host) : null;
      const job = { id: String(++seq), name, action, host, status: "running", startedAt: now(), finishedAt: null, exitCode: null, lines: [], listeners: new Set(), redact, child: null };
      current = job;
      push(job, `$ ${action} ${name}${host ? ` --host ${host}` : ""}`);
      let child;
      try {
        child = spawn(cmd, args, { cwd: root, env: { ...env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      } catch (err) {
        finish(job, -1, err instanceof Error ? err.message : String(err));
        return job;
      }
      job.child = child;
      const onData = (chunk) => { for (const line of cleanLines(String(chunk))) push(job, line); };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", (err) => finish(job, -1, err.message));
      // A job already finished by stop() below keeps that verdict — the child's own
      // "close" (which fires anyway once the kill takes effect) must never overwrite it.
      child.on("close", (code) => { if (job.status === "running") finish(job, code ?? -1); });
      return job;
    },

    /** The owner's Force-Stop: kill the job's whole process tree and record it as
     *  "stopped" (never "ok"/"failed" — the outcome was never observed, it was cut
     *  short on purpose). `{ ok:true, job }` | `{ ok:false, code:"not_found"|"not_running" }`. */
    stop(id) {
      const job = current && current.id === id ? current : null;
      if (!job) return { ok: false, code: "not_found" };
      if (job.status !== "running") return { ok: false, code: "not_running" };
      if (job.child && job.child.pid) kill(job.child.pid);
      push(job, "■ stopped by the owner");
      finish(job, null, null, "stopped");
      return { ok: true, job };
    },

    /** Replay what exists, then follow. Returns an unsubscribe. */
    subscribe(job, fn) {
      for (const line of job.lines) fn({ type: "line", line });
      if (job.status !== "running") {
        fn({ type: "done", status: job.status, exitCode: job.exitCode });
        return () => {};
      }
      job.listeners.add(fn);
      return () => job.listeners.delete(fn);
    },

    summary(job) {
      return job ? { id: job.id, name: job.name, action: job.action, host: job.host ?? null, status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt, exitCode: job.exitCode, lines: job.lines.length } : null;
    },
  };
}
