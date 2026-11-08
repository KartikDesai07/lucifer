import { test } from "node:test";
import assert from "node:assert/strict";

import { createUpdatePending } from "@/lib/update-pending";

test("a fresh store is not pending and knows no server build", () => {
  const s = createUpdatePending();
  assert.equal(s.isPending(), false, "nothing reported, nothing pending");
  assert.equal(s.serverBuild(), null, "no server build before the first report");
});

test("the same build is not pending but is remembered", () => {
  const s = createUpdatePending();
  s.observe("a", "a");
  assert.equal(s.isPending(), false, "the server runs the page's build");
  assert.equal(s.serverBuild(), "a", "the report is remembered");
});

test("a different build is pending; another different one keeps it pending and updates the server build", () => {
  const s = createUpdatePending();
  s.observe("b", "a");
  assert.equal(s.isPending(), true, "a different build is pending");
  s.observe("c", "a");
  assert.equal(s.isPending(), true, "still pending while the server reports another build");
  assert.equal(s.serverBuild(), "c", "serverBuild follows the latest report");
});

test("a report equal to the page's build clears pending (a rollback)", () => {
  const s = createUpdatePending();
  s.observe("b", "a");
  s.observe("a", "a");
  assert.equal(s.isPending(), false, "back on the page's own build: nothing to reload for");
  assert.equal(s.serverBuild(), "a", "the latest report is kept");
});

test("missing, null, number, empty and object reports are ignored", () => {
  const s = createUpdatePending();
  s.observe("b", "a");
  for (const bad of [undefined, null, 7, "", {}]) {
    s.observe(bad, "a");
    assert.equal(s.isPending(), true, `pending stays after ${JSON.stringify(bad)}`);
    assert.equal(s.serverBuild(), "b", `serverBuild stays after ${JSON.stringify(bad)}`);
  }
  const fresh = createUpdatePending();
  fresh.observe(undefined, "a");
  fresh.observe(7, "a");
  assert.equal(fresh.isPending(), false, "a bad report never makes a fresh store pending");
  assert.equal(fresh.serverBuild(), null, "a bad report never sets serverBuild");
});

test("subscribers hear a change, not an identical report, and not after unsubscribe", () => {
  const s = createUpdatePending();
  let calls = 0;
  const off = s.subscribe(() => void calls++);
  s.observe("b", "a");
  assert.equal(calls, 1, "a change notifies");
  s.observe("b", "a");
  assert.equal(calls, 1, "an identical report does not notify");
  s.observe("c", "a");
  assert.equal(calls, 2, "a new server build notifies even while pending stays");
  s.observe("a", "a");
  assert.equal(calls, 3, "clearing notifies");
  off();
  s.observe("b", "a");
  assert.equal(calls, 3, "unsubscribed: no more calls");
});

// Post-verifier V1: when the pulse last said "this page's build" bounds which prefetches a newer build may have answered.
test("sameBuildAt: the latest report equal to the page's build, by its time; null before any", () => {
  const s = createUpdatePending();
  assert.equal(s.sameBuildAt(), null, "no report yet");
  s.observe("a", "a", 100);
  assert.equal(s.sameBuildAt(), 100, "a same-build report's time");
  s.observe("a", "a", 250);
  assert.equal(s.sameBuildAt(), 250, "an identical report moves it (the pulse said so again)");
  s.observe("b", "a", 400);
  assert.equal(s.sameBuildAt(), 250, "a newer build's report does not move it");
  s.observe(undefined, "a", 500);
  s.observe("", "a", 500);
  assert.equal(s.sameBuildAt(), 250, "a bad report does not either");
  s.observe("a", "a", 600);
  assert.equal(s.sameBuildAt(), 600, "a rollback's report is a same-build report");
  s.observe("a", "a", 300);
  assert.equal(s.sameBuildAt(), 600, "an older time never moves it back");
});

test("sameBuildAt: a report with no time is stamped now; a same-build time alone notifies nobody", () => {
  const s = createUpdatePending();
  const before = Date.now();
  s.observe("a", "a");
  const at = s.sameBuildAt();
  assert.ok(at !== null && at >= before && at <= Date.now(), `stamped with Date.now(), got ${at}`);
  let calls = 0;
  s.subscribe(() => void calls++);
  s.observe("a", "a", (at ?? 0) + 1000);
  assert.equal(calls, 0, "pending and the build are unchanged: no listener runs");
  assert.equal(s.sameBuildAt(), (at ?? 0) + 1000, "but the time moved");
});
