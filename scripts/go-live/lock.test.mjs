// node --test scripts/go-live/lock.test.mjs — the PER-CLIENT lock (plan §1,
// plan-locks-force.md): "a deploy running for a client blocks a second one,
// from anywhere" — acquire/held/takeover/release-by-pid/list/lockMessage
// against a fake fs + a fake isAlive, the same style as rollout.test.mjs's
// rollout-lock suite (this is the SAME shape, one lock file per client instead
// of one for the whole rollout).
import assert from "node:assert/strict";
import { test } from "node:test";
import { acquireClientLock, listClientLocks, lockMessage, readClientLock, releaseClientLock } from "./lock.mjs";

const join = (a, b) => `${a}/${b}`;
function memFs() {
  const files = new Map();
  // A "directory" exists if any stored file sits directly under it — the fake
  // store has no real directory entries (mkdirSync is a no-op), so
  // listClientLocks's existsSync(dir) guard needs this to see "_locks" as
  // present once acquireClientLock has ever written a file into it (the same
  // pattern run.test.mjs's fakeWorld uses for its own dirExists()).
  const dirExists = (p) => { const prefix = `${p}/`; for (const k of files.keys()) if (k.startsWith(prefix)) return true; return false; };
  return {
    files,
    existsSync: (p) => files.has(p) || dirExists(p),
    readFileSync: (p) => { if (!files.has(p)) throw new Error("ENOENT " + p); return files.get(p); },
    writeFileSync: (p, d, opts) => { if (opts && typeof opts === "object" && opts.flag === "wx" && files.has(p)) { const e = new Error(`EEXIST: ${p}`); e.code = "EEXIST"; throw e; } files.set(p, d); },
    rmSync: (p) => files.delete(p),
    mkdirSync: () => {}, // acquireClientLock ensures the _locks dir exists — the fake store needs no real directories
    readdirSync: (dir) => { const prefix = `${dir}/`; const names = []; for (const k of files.keys()) if (k.startsWith(prefix) && !k.slice(prefix.length).includes("/")) names.push(k.slice(prefix.length)); return names; },
  };
}

test("readClientLock: null when absent, null on invalid JSON (never throws)", () => {
  const fs = memFs();
  assert.equal(readClientLock(fs, "/c/_locks", "sunrise", join), null);
  fs.writeFileSync("/c/_locks/sunrise.lock", "{ not json");
  assert.equal(readClientLock(fs, "/c/_locks", "sunrise", join), null);
});

test("acquireClientLock: first acquire ok, a live foreign pid is held, the SAME pid re-acquiring is idempotent-ok", () => {
  const fs = memFs();
  const alive = new Set([111]);
  const isAlive = (pid) => alive.has(pid);
  const r1 = acquireClientLock(fs, "/c/_locks", "sunrise", { pid: 111, action: "go-live", owner: "cli", isAlive, now: () => 1000 }, join);
  assert.deepEqual(r1, { ok: true, takenOver: null });
  const stored = JSON.parse(fs.readFileSync("/c/_locks/sunrise.lock"));
  assert.deepEqual(stored, { slug: "sunrise", pid: 111, action: "go-live", owner: "cli", at: new Date(1000).toISOString() });

  const r2 = acquireClientLock(fs, "/c/_locks", "sunrise", { pid: 222, action: "redeploy", owner: "deploy", isAlive, now: () => 1001 }, join);
  assert.equal(r2.ok, false);
  assert.deepEqual(r2.held, stored, "a live foreign pid blocks — the FULL stored lock is handed back so the caller can build lockMessage()");

  // idempotent: our own pid re-acquiring (a child re-entering, or a re-run before release) succeeds.
  const r3 = acquireClientLock(fs, "/c/_locks", "sunrise", { pid: 111, action: "go-live", owner: "cli", isAlive, now: () => 1002 }, join);
  assert.equal(r3.ok, true);
});

test("acquireClientLock: a dead-pid lock is taken over (self-healing) — takenOver carries the PREVIOUS lock", () => {
  const fs = memFs();
  const alive = new Set([111]);
  const isAlive = (pid) => alive.has(pid);
  acquireClientLock(fs, "/c/_locks", "sunrise", { pid: 111, action: "go-live", owner: "cli", isAlive, now: () => 1 }, join);
  alive.delete(111); // the process died (PC off, killed, crashed)
  const r = acquireClientLock(fs, "/c/_locks", "sunrise", { pid: 222, action: "redeploy", owner: "deploy", isAlive, now: () => 2 }, join);
  assert.equal(r.ok, true);
  assert.equal(r.takenOver.pid, 111, "the previous (dead) lock is returned as takenOver, not silently discarded");
  const stored = JSON.parse(fs.readFileSync("/c/_locks/sunrise.lock"));
  assert.equal(stored.pid, 222);
});

test("acquireClientLock: a corrupt lock file never blocks (treated like absent)", () => {
  const fs = memFs();
  fs.writeFileSync("/c/_locks/sunrise.lock", "{ not json");
  const r = acquireClientLock(fs, "/c/_locks", "sunrise", { pid: 1, action: "go-live", owner: "cli", isAlive: () => true, now: () => 1 }, join);
  assert.equal(r.ok, true);
});

test("releaseClientLock: removes the file ONLY if it names our pid — a non-holder cannot release someone else's lock", () => {
  const fs = memFs();
  acquireClientLock(fs, "/c/_locks", "sunrise", { pid: 111, action: "go-live", owner: "cli", isAlive: () => true, now: () => 1 }, join);
  releaseClientLock(fs, "/c/_locks", "sunrise", 222, join);
  assert.ok(fs.existsSync("/c/_locks/sunrise.lock"), "a non-holder's release is a no-op");
  releaseClientLock(fs, "/c/_locks", "sunrise", 111, join);
  assert.equal(fs.existsSync("/c/_locks/sunrise.lock"), false, "the actual holder releases it");
});

test("releaseClientLock: releasing an absent lock never throws", () => {
  const fs = memFs();
  assert.doesNotThrow(() => releaseClientLock(fs, "/c/_locks", "ghost", 1, join));
});

test("listClientLocks: every *.lock file, each with its computed `alive` flag — never a client itself (folder starts with _)", () => {
  const fs = memFs();
  const alive = new Set([111]);
  const isAlive = (pid) => alive.has(pid);
  acquireClientLock(fs, "/c/_locks", "sunrise", { pid: 111, action: "go-live", owner: "cli", isAlive, now: () => 5 }, join);
  acquireClientLock(fs, "/c/_locks", "moonlight", { pid: 999, action: "redeploy", owner: "deploy", isAlive, now: () => 6 }, join);
  const list = listClientLocks(fs, "/c/_locks", join, isAlive).sort((a, b) => a.slug.localeCompare(b.slug));
  assert.deepEqual(list, [
    { slug: "moonlight", pid: 999, action: "redeploy", owner: "deploy", at: new Date(6).toISOString(), alive: false },
    { slug: "sunrise", pid: 111, action: "go-live", owner: "cli", at: new Date(5).toISOString(), alive: true },
  ]);
});

test("listClientLocks: an empty/absent locks directory lists nothing (never throws)", () => {
  const fs = memFs();
  assert.deepEqual(listClientLocks(fs, "/c/_locks", join, () => false), []);
});

test("lockMessage: names the slug, action, owner, time and pid — the owner-facing sentence used by every guard (index.mjs, deploy.mjs, the console 409)", () => {
  const lock = { slug: "sunrise", pid: 4242, action: "go-live", owner: "console", at: "2026-09-13T05:00:00.000Z" };
  const msg = lockMessage(lock);
  assert.match(msg, /"sunrise"/);
  assert.match(msg, /go-live/);
  assert.match(msg, /console/);
  assert.match(msg, /4242/);
  assert.match(msg, /wait for it/i);
  assert.match(msg, /Force/, "the message points the owner at the Force option in the console");
});

test("acquireClientLock honours GO_LIVE_LOCK_HELD reentrancy: a child whose parent already holds the SAME slug's lock is not blocked by its own parent's live pid — this is tested at the caller (index.mjs/deploy.mjs), not inside acquireClientLock itself, which knows nothing about env; documented here as a pin that acquireClientLock's signature carries no env/reentrancy special-case of its own", () => {
  // acquireClientLock is pure w.r.t. env — reentrancy is the CALLER's job (skip the
  // acquire call entirely when GO_LIVE_LOCK_HELD === slug). Pin the function's
  // arity/behaviour has no hidden env read that would make this untestable in isolation.
  const fs = memFs();
  const before = process.env.GO_LIVE_LOCK_HELD;
  process.env.GO_LIVE_LOCK_HELD = "sunrise";
  try {
    // Even with the env var set, calling acquireClientLock directly still acquires —
    // proving the skip is the CALLER's responsibility (index.mjs/deploy.mjs), not a
    // hidden behaviour inside lock.mjs a caller could forget to check.
    const r = acquireClientLock(fs, "/c/_locks", "sunrise", { pid: 1, action: "go-live", owner: "cli", isAlive: () => true, now: () => 1 }, join);
    assert.equal(r.ok, true, "acquireClientLock itself has no env-based reentrancy bypass — callers must check GO_LIVE_LOCK_HELD themselves before calling it");
  } finally {
    if (before === undefined) delete process.env.GO_LIVE_LOCK_HELD; else process.env.GO_LIVE_LOCK_HELD = before;
  }
});

test("acquireClientLock is race-safe: the exclusive create decides — a taker that loses every retry against another live taker ends with ok:false, never a second holder", () => {
  const base = memFs();
  // Another process wins the create between our stale-removal and our retry: model it as a
  // writeFileSync whose "wx" ALWAYS finds the file present, while the file names a LIVE other pid.
  const racing = { ...base, writeFileSync: (p, d, opts) => { if (opts && opts.flag === "wx") { base.files.set(p, JSON.stringify({ slug: "sunrise", pid: 222, action: "go-live", owner: "cli", at: new Date().toISOString() })); const e = new Error("EEXIST"); e.code = "EEXIST"; throw e; } base.writeFileSync(p, d, opts); } };
  const r = acquireClientLock(racing, "/c/_locks", "sunrise", { pid: 111, action: "redeploy", owner: "deploy", isAlive: (pid) => pid === 222 }, join);
  assert.equal(r.ok, false);
  assert.equal(r.held.pid, 222, "the winner of the race is reported as the holder");
});
