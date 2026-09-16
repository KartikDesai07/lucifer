import { test } from "node:test";
import assert from "node:assert/strict";
import type mongoose from "mongoose";

import { HubUser, hubUserSchema } from "./HubUser";

// DB-free schema guards for the single-owner auth store (phase-F3 §3.2 + P8-G).

function defaultOf(schema: mongoose.Schema, path: string): unknown {
  return (schema.path(path) as unknown as { defaultValue?: unknown }).defaultValue;
}

test("HubUser: email is required + normalized + unique", () => {
  const err = new HubUser({}).validateSync();
  assert.ok(err?.errors.email, "email required");
  const u = new HubUser({ email: "OWNER@X.CO" });
  assert.equal(u.email, "owner@x.co", "email lowercased");
  assert.equal(hubUserSchema.path("email").options.unique, true, "email unique index");
});

test("HubUser: role defaults to 'owner' and rejects other values (F3 = single-owner)", () => {
  const u = new HubUser({ email: "a@b.co" });
  assert.equal(u.role, "owner");
  const bad = new HubUser({ email: "a@b.co", role: "staff" }).validateSync();
  assert.ok(bad?.errors.role, "non-owner role rejected in F3");
});

test("HubUser: webauthnCredentials + ipAllowlist default to []; isActive defaults true", () => {
  const u = new HubUser({ email: "a@b.co" });
  assert.deepEqual(u.webauthnCredentials, []);
  assert.deepEqual(u.ipAllowlist, []);
  assert.equal(u.isActive, true);
});

test("HubUser: totpSecretEnc is select:false (never returned by default)", () => {
  assert.equal(hubUserSchema.path("totpSecretEnc").options.select, false);
});

test("HubUser: F3.4 totpLastStep + stepUp are omit-empty (no defaults)", () => {
  assert.equal(defaultOf(hubUserSchema, "totpLastStep"), undefined);
  assert.equal(defaultOf(hubUserSchema, "stepUp"), undefined);
  const u = new HubUser({ email: "a@b.co" });
  assert.equal(u.totpLastStep, undefined, "no last step until first accepted code");
  assert.equal(u.stepUp, undefined, "no stepUp until first step-up");
});

test("HubUser: stepUp subdoc requires both at + sid, carries no own _id", () => {
  const missingSid = new HubUser({ email: "a@b.co", stepUp: { at: new Date() } }).validateSync();
  assert.ok(missingSid?.errors["stepUp.sid"], "sid required");
  const ok = new HubUser({ email: "a@b.co", stepUp: { at: new Date(), sid: "s1" } });
  assert.equal(ok.validateSync(), undefined);
  assert.equal((ok.stepUp as unknown as { _id?: unknown })?._id, undefined, "no nested _id");
});

test("HubUser: the P8-G franchise fields are omit-empty (no defaults)", () => {
  for (const p of ["franchiseRole", "chainClientId", "outletScope"]) {
    assert.equal(defaultOf(hubUserSchema, p), undefined, `${p} must have no default`);
  }
});

test("HubUser: franchiseRole enum rejects unknown values", () => {
  const bad = new HubUser({ email: "a@b.co", franchiseRole: "regional" }).validateSync();
  assert.ok(bad?.errors.franchiseRole, "unknown franchiseRole rejected");
  const ok = new HubUser({ email: "a@b.co", franchiseRole: "franchisee" }).validateSync();
  assert.equal(ok, undefined);
});

test("HubUser: outletScope is Mixed (carries the 'all' | ObjectId[] union; P8 validates)", () => {
  assert.equal(hubUserSchema.path("outletScope").instance, "Mixed");
});
