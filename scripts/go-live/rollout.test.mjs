// node --test scripts/go-live/rollout.test.mjs — the "deploy update to all
// clients" plan, its durable state transitions, and the CLI loop with a fake
// deploy: failures are recorded and skipped over, a cut-off run is resumed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { acquireRolloutLock, applyResult, foreignLock, isFinished, loadRollout, markInterrupted, markRunning, newRollout, nextPending, planRollout, readRolloutLock, releaseRolloutLock, requeueRetryable, requestCancel, runRolloutCli, saveRollout, STATUS, summarize, targetsOf } from "./rollout.mjs";

const join = (a, b) => `${a}/${b}`;
function memFs() {
  const files = new Map();
  return { files, existsSync: (p) => files.has(p), readFileSync: (p) => { if (!files.has(p)) throw new Error("ENOENT " + p); return files.get(p); }, writeFileSync: (p, d) => files.set(p, d), rmSync: (p) => files.delete(p) };
}
const deployed = (name, extra = {}) => ({ name, client: { slug: name, generated: { projectId: `prj_${name}`, host: `${name}.vercel.app` }, ...extra } });

test("targetsOf: primary + deployed standbys become pending; locked / never-deployed slots are listed as skipped with the reason", () => {
  assert.deepEqual(targetsOf("a", { generated: { projectId: "p", host: "a.vercel.app" }, standbyHosts: [{ label: "sb", generated: { projectId: "q", host: "a-sb.vercel.app" } }, { label: "new", vercel: {} }] }).map((t) => [t.profile, t.status, t.reason]),
    [["a", "pending", undefined], ["a-sb", "pending", undefined], ["a-new", "skipped", "standby never deployed"]]);
  assert.deepEqual(targetsOf("b", { deployLock: true, generated: { projectId: "p" } }).map((t) => [t.profile, t.status]), [["b", "skipped"]]);
  assert.deepEqual(targetsOf("c", {}).map((t) => [t.status, t.reason]), [["skipped", "never deployed"]]);
  assert.equal(targetsOf("a", { generated: { projectId: "p", host: "a.vercel.app" } })[0].url, "https://a.vercel.app");
});

test("planRollout sorts by client and flattens; summarize counts", () => {
  const plan = planRollout([deployed("zeta"), deployed("alpha", { standbyHosts: [{ label: "sb", generated: { projectId: "x", host: "alpha-sb.vercel.app" } }] }), { name: "mid", client: {} }]);
  assert.deepEqual(plan.map((t) => t.profile), ["alpha", "alpha-sb", "mid", "zeta"]);
  const st = newRollout(plan, 1_000);
  assert.equal(st.id, "1000"); assert.deepEqual(summarize(st), { pending: 3, running: 0, ok: 0, failed: 0, skipped: 1, interrupted: 0, cancelled: 0, total: 4, finished: false, active: false });
});

test("rollout lock: one driver at a time — a live holder blocks, a dead holder (PC off) is taken over, only the holder releases", () => {
  const fs = memFs();
  const alive = new Set([111]);
  const isAlive = (pid) => alive.has(pid);
  assert.deepEqual(acquireRolloutLock(fs, "/c", join, { owner: "cli", pid: 111, isAlive, now: () => 5 }), { ok: true, tookOver: false });
  const blocked = acquireRolloutLock(fs, "/c", join, { owner: "console", pid: 222, isAlive, now: () => 6 });
  assert.equal(blocked.ok, false); assert.equal(blocked.held.pid, 111); assert.equal(blocked.held.owner, "cli");
  assert.deepEqual(foreignLock(fs, "/c", join, 222, isAlive), readRolloutLock(fs, "/c", join), "seen as foreign by the other process");
  assert.equal(foreignLock(fs, "/c", join, 111, isAlive), null, "not foreign to its own holder");
  releaseRolloutLock(fs, "/c", join, 222); assert.ok(fs.existsSync("/c/_rollout.lock"), "a non-holder cannot release");
  alive.delete(111); // the CLI process died mid-rollout
  assert.equal(foreignLock(fs, "/c", join, 222, isAlive), null, "a dead holder is not a live driver");
  assert.deepEqual(acquireRolloutLock(fs, "/c", join, { owner: "console", pid: 222, isAlive, now: () => 7 }), { ok: true, tookOver: true });
  releaseRolloutLock(fs, "/c", join, 222); assert.equal(fs.existsSync("/c/_rollout.lock"), false);
  fs.writeFileSync("/c/_rollout.lock", "{ not json"); assert.deepEqual(readRolloutLock(fs, "/c", join), { corrupt: true });
  assert.equal(acquireRolloutLock(fs, "/c", join, { owner: "cli", pid: 1, isAlive, now: () => 8 }).ok, true, "a corrupt lock never blocks");
});

test("runRolloutCli refuses to run under a live foreign lock, refuses to start OVER an unfinished rollout without --resume, and always releases its own lock", () => {
  const fs = memFs(); const deps = { fs, join, log: () => {}, now: () => 1, dir: "/c", root: "/r", env: {}, records: () => [deployed("a")], spawn: () => ({ status: 0 }), pid: 500, isAlive: (p) => p === 999 };
  fs.writeFileSync("/c/_rollout.lock", JSON.stringify({ owner: "console", pid: 999, at: "x" }));
  assert.throws(() => runRolloutCli({}, deps), /another process is driving a rollout right now \(console, pid 999/);
  fs.rmSync("/c/_rollout.lock");
  const unfinished = newRollout(planRollout([deployed("a"), deployed("b")]), 0); markRunning(unfinished, 0, 1); saveRollout(fs, "/c", join, unfinished);
  assert.throws(() => runRolloutCli({}, deps), /--resume/, "starting over would wipe unfinished progress");
  assert.equal(fs.existsSync("/c/_rollout.lock"), false, "the lock is released even when the run throws");
  const out = runRolloutCli({ resume: true }, deps); assert.equal(out.targets[0].status, "ok"); assert.equal(fs.existsSync("/c/_rollout.lock"), false);
});

test("state transitions: running → ok/failed, interrupted on reload, retry requeues, cancel marks pending as cancelled, finished detection", () => {
  const st = newRollout(planRollout([deployed("a"), deployed("b"), deployed("c")]), 0);
  assert.equal(nextPending(st), 0);
  markRunning(st, 0, 10); assert.equal(st.targets[0].status, STATUS.running);
  applyResult(st, 0, { ok: true, exitCode: 0 }, 20); assert.equal(st.targets[0].status, STATUS.ok); assert.equal(st.targets[0].error, null);
  markRunning(st, 1, 30); applyResult(st, 1, { ok: false, exitCode: 1 }, 40); assert.equal(st.targets[1].status, STATUS.failed); assert.match(st.targets[1].error, /exited with code 1/);
  assert.equal(nextPending(st), 2, "a failure does not stop the queue");
  markRunning(st, 2, 50);
  assert.equal(markInterrupted(st), true, "a 'running' target found on disk was cut off"); assert.equal(st.targets[2].status, STATUS.interrupted); assert.match(st.targets[2].error, /outcome unknown/);
  assert.equal(isFinished(st), true, "nothing pending or running");
  assert.equal(requeueRetryable(st), 2, "failed + interrupted go back to pending; the ok one stays"); assert.equal(st.targets[0].status, STATUS.ok);
  requestCancel(st); assert.ok(st.targets.slice(1).every((t) => t.status === STATUS.cancelled)); assert.equal(nextPending(st), -1);
  assert.equal(requeueRetryable(st), 2, "cancelled ones can be resumed too"); assert.equal(st.cancelRequested, false);
});

test("runRolloutCli: one deploy after another, a failure recorded and skipped over, state on disk after every step; --resume re-runs only what is not ok", () => {
  const fs = memFs(); const spawned = []; let clock = 100;
  const deps = { fs, join, log: () => {}, now: () => (clock += 1), dir: "/c", root: "/r", env: {}, pid: 1, isAlive: () => false, records: () => [deployed("a"), deployed("b"), deployed("c"), { name: "locked", client: { deployLock: true, generated: { projectId: "p" } } }],
    spawn: (cmd, args) => { spawned.push(args[2]); return { status: args[2] === "b" ? 1 : 0 }; } };
  const st = runRolloutCli({}, deps);
  assert.deepEqual(spawned, ["a", "b", "c"], "every pending target ran, in order, despite b failing");
  assert.deepEqual(st.targets.map((t) => [t.profile, t.status]), [["a", "ok"], ["b", "failed"], ["c", "ok"], ["locked", "skipped"]]);
  assert.ok(st.finishedAt); assert.equal(deps.spawn.length, 2);
  const onDisk = loadRollout(fs, "/c", join); assert.equal(onDisk.targets[1].status, "failed", "state persisted");
  spawned.length = 0; deps.spawn = (cmd, args) => { spawned.push(args[2]); return { status: 0 }; };
  const again = runRolloutCli({ resume: true }, deps);
  assert.deepEqual(spawned, ["b"], "resume re-runs ONLY the failed target"); assert.equal(again.targets[1].status, "ok");
  assert.throws(() => runRolloutCli({ resume: true }, { ...deps, fs: memFs() }), /nothing to resume/);
});

test("runRolloutCli --resume after a cut-off (target still 'running' on disk) treats it as interrupted and re-runs it", () => {
  const fs = memFs(); const st = newRollout(planRollout([deployed("a"), deployed("b")]), 0);
  markRunning(st, 0, 1); applyResult(st, 0, { ok: true, exitCode: 0 }, 2); markRunning(st, 1, 3); // PC died while b was deploying
  saveRollout(fs, "/c", join, st);
  const spawned = [];
  const out = runRolloutCli({ resume: true }, { fs, join, log: () => {}, now: () => 9, dir: "/c", root: "/r", env: {}, pid: 1, isAlive: () => false, records: () => [], spawn: (c, args) => { spawned.push(args[2]); return { status: 0 }; } });
  assert.deepEqual(spawned, ["b"]); assert.deepEqual(out.targets.map((t) => t.status), ["ok", "ok"]);
});
