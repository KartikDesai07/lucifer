// scripts/go-live/lock.mjs — "only one deploy at a time per client, from
// anywhere": a per-client lock file next to the rollout lock, so a CLI run,
// a console job and a rollout target can never step on each other for the
// SAME client. Pure (fs/join/isAlive injected) like rollout.mjs's own lock,
// which this reuses `pidAlive` from — a lock whose pid died (PC off, console
// closed) is stale and is taken over automatically.

import { pidAlive } from "./rollout.mjs";

export { pidAlive };

/** Folder name (relative to the clients dir) holding one `<slug>.lock` file
 *  per locked client. Starts with "_" like every other owner-data folder, so
 *  it is never mistaken for a client record. */
export const LOCKS_DIR = "_locks";
/** How often the exclusive create is retried after a stale lock was removed (a
 *  second taker of the same stale lock loses the retry with EEXIST). */
export const ACQUIRE_ATTEMPTS = 3;

/** `readClientLock(fs, dir, slug, join)` → the lock object, or null when
 *  there is none (absent) or it is not valid JSON (invalid → treated as if
 *  absent: a corrupt lock must never block forever). */
export function readClientLock(fs, dir, slug, join) {
  const file = join(dir, `${slug}.lock`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Take the lock for `slug`. `{ ok: true, takenOver: lock|null }` on success
 * (`takenOver` is the previous lock when one existed with a dead pid — this
 * self-heals like the rollout lock; null when the folder had nothing);
 * `{ ok: false, held: lock }` when a LIVE lock names a different pid. The
 * same pid re-acquiring is idempotent (also ok:true, takenOver: the prior
 * lock, since it is simply overwritten).
 */
export function acquireClientLock(fs, dir, slug, { pid, action, owner, isAlive = pidAlive, now = Date.now }, join) {
  const file = join(dir, `${slug}.lock`);
  const payload = () => `${JSON.stringify({ slug, pid, action, owner, at: new Date(now()).toISOString() })}\n`;
  fs.mkdirSync(dir, { recursive: true });
  let takenOver = null;
  for (let attempt = 1; attempt <= ACQUIRE_ATTEMPTS; attempt += 1) {
    // Exclusive create: when two processes race for the same slug the OS lets exactly
    // one succeed — the loser gets EEXIST and falls through to the checks below.
    try {
      fs.writeFileSync(file, payload(), { encoding: "utf8", flag: "wx" });
      return { ok: true, takenOver };
    } catch (err) {
      if (!err || err.code !== "EEXIST") throw err;
    }
    const held = readClientLock(fs, dir, slug, join);
    if (held && held.pid === pid) { fs.writeFileSync(file, payload(), "utf8"); return { ok: true, takenOver: held }; } // our own lock — re-acquire is idempotent
    if (held && isAlive(held.pid)) return { ok: false, held };
    // Stale (dead pid) or unreadable: remove it and retry the exclusive create — self-healing,
    // and still race-safe (a second taker of the same stale lock loses the retry).
    takenOver = held ?? takenOver;
    try { fs.rmSync(file); } catch { /* already gone */ }
  }
  const last = readClientLock(fs, dir, slug, join);
  return { ok: false, held: last ?? { slug, pid: null, action: null, owner: null, at: null } };
}

/** Removes the lock file ONLY if it still names our pid — a lock someone
 *  else has since taken over (our process died and was declared stale, or
 *  we never held it) must never be deleted out from under its new holder. */
export function releaseClientLock(fs, dir, slug, pid, join) {
  const held = readClientLock(fs, dir, slug, join);
  if (held && held.pid === pid) fs.rmSync(join(dir, `${slug}.lock`));
}

/** Every `*.lock` file in the folder, each with its own `alive` flag —
 *  the console's `GET /api/locks` and the Force UI read straight from this. */
export function listClientLocks(fs, dir, join, isAlive = pidAlive) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".lock")) continue;
    const slug = f.slice(0, -".lock".length);
    const lock = readClientLock(fs, dir, slug, join);
    if (lock) out.push({ ...lock, slug: lock.slug ?? slug, alive: isAlive(lock.pid) });
  }
  return out;
}

/** The one-line explanation shown to the owner wherever a lock blocks them
 *  (CLI stderr, the console's 409 body). */
export function lockMessage(lock) {
  return `a deploy is already running for "${lock.slug}" (${lock.action}, started from the ${lock.owner} at ${lock.at}, pid ${lock.pid}) — wait for it, or use Force in the console`;
}
