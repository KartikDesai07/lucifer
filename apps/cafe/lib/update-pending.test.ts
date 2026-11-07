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
