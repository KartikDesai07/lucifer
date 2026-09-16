import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluatePanelAccess, type PanelUser } from "./panel-gate-core";
import { STEP_UP_WINDOW_MS } from "./constants";

// DB-free tests for the PURE §E gate decision (fed-secrets-vault.json §E). The
// wired half (requirePanelAccess + audit + fresh HubUser read) is exercised by
// scripts/verify-panel-live.ts against the scratch M0.

const NOW = 1_700_000_000_000;
const SID = "sid-abc";
const session = { userId: "u1", role: "owner", sid: SID };
const activeUser: PanelUser = { isActive: true, ipAllowlist: ["203.0.113.0/24"] };

function base(over: Partial<Parameters<typeof evaluatePanelAccess>[0]> = {}) {
  return evaluatePanelAccess({
    session,
    user: activeUser,
    ip: "203.0.113.7",
    now: NOW,
    needStepUp: false,
    allowAnyIp: false,
    ...over,
  });
}

test("allows an owner with a session, active account, and allowlisted IP", () => {
  assert.deepEqual(base(), { ok: true });
});

test("401 when unauthenticated; 403 when the role is not owner", () => {
  assert.deepEqual(base({ session: null }), { ok: false, reason: "unauthenticated", status: 401 });
  assert.deepEqual(base({ session: { userId: "u1", role: "staff", sid: SID } }), {
    ok: false,
    reason: "not-owner",
    status: 403,
  });
});

test("403 inactive when the account is deactivated or missing", () => {
  assert.deepEqual(base({ user: { isActive: false, ipAllowlist: ["203.0.113.0/24"] } }), {
    ok: false,
    reason: "inactive",
    status: 403,
  });
  assert.deepEqual(base({ user: null }), { ok: false, reason: "inactive", status: 403 });
});

test("403 ip when the source is not in a non-empty allowlist", () => {
  assert.deepEqual(base({ ip: "8.8.8.8" }), { ok: false, reason: "ip", status: 403 });
});

test("empty allowlist FAILS CLOSED unless allowAnyIp is set", () => {
  const emptyUser: PanelUser = { isActive: true, ipAllowlist: [] };
  assert.deepEqual(base({ user: emptyUser }), { ok: false, reason: "ip", status: 403 });
  assert.deepEqual(base({ user: emptyUser, allowAnyIp: true }), { ok: true });
});

test("step-up: fresh same-sid stamp within the window passes; stale/missing/other-sid deny", () => {
  const withStepUp = (over: Partial<{ at: Date; sid: string }>): PanelUser => ({
    isActive: true,
    ipAllowlist: ["203.0.113.0/24"],
    stepUp: { at: new Date(NOW), sid: SID, ...over },
  });

  // fresh + same sid
  assert.deepEqual(base({ needStepUp: true, user: withStepUp({}) }), { ok: true });
  // exactly at the window edge still passes
  assert.deepEqual(
    base({ needStepUp: true, user: withStepUp({ at: new Date(NOW - STEP_UP_WINDOW_MS) }) }),
    { ok: true },
  );
  // one ms past the window → deny
  assert.deepEqual(
    base({ needStepUp: true, user: withStepUp({ at: new Date(NOW - STEP_UP_WINDOW_MS - 1) }) }),
    { ok: false, reason: "stepup", status: 403 },
  );
  // a step-up from a DIFFERENT login session → deny (unforgeable across sessions)
  assert.deepEqual(base({ needStepUp: true, user: withStepUp({ sid: "other" }) }), {
    ok: false,
    reason: "stepup",
    status: 403,
  });
  // no step-up ever recorded → deny
  assert.deepEqual(base({ needStepUp: true }), { ok: false, reason: "stepup", status: 403 });
});

test("a non-allowlisted IP is denied at the IP step even when a step-up is required (no step-up leak)", () => {
  assert.deepEqual(base({ needStepUp: true, ip: "8.8.8.8" }), {
    ok: false,
    reason: "ip",
    status: 403,
  });
});
