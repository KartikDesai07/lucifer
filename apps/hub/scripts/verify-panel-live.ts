// Dev verify script — prints pass/fail lines only, NEVER the TOTP secret, KEK, or
// URI. (The no-console gate covers lib/, not scripts/.) Run via
// `npm run verify:panel-live` with HUB_MONGODB_URI (→ the scratch db) + HUB_KEK.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import mongoose, { Types } from "mongoose";

import { connectDB } from "../lib/db";
import { HubUser } from "../models/HubUser";
import { AuditLog } from "../models/AuditLog";
import { generateTotpSecret, totpCodeForStep, totpStep } from "../lib/totp";
import { decryptTotpSecret, encryptTotpSecret } from "../lib/totp-secret";
import { checkOwnerTotp } from "../lib/owner-totp";
import { rotateKEK } from "../lib/vault";
import { evaluatePanelAccess } from "../lib/panel-gate-core";
import { writeAudit } from "../lib/audit";
import { STEP_UP_WINDOW_MS } from "../lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// LIVE panel-hardening round-trip on a SCRATCH db (F3.4 verify; the F3.2/F3.3
// precedent). Prefix-guarded (refuses unless the db is exactly `hubreg_verify`)
// and dropped after. Proves the DB-backed logic the DB-free unit tests can't:
// TOTP enrol + the atomic replay claim, the login-time lazy KEK rewrap, the
// rotateKEK HubUser-TOTP sweep (so `remaining===0` truly retires the old KEK
// WITHOUT a prior login), step-up stamping, and the gate's fresh-HubUser read
// flowing into evaluatePanelAccess. The full HTTP gate (requirePanelAccess with
// a real Auth.js session) stays owner-blocked — it needs the running server.
// ─────────────────────────────────────────────────────────────────────────────

const SCRATCH_DB = "hubreg_verify";
const EMAIL = "owner@verify.local";
const ALLOWLIST = ["203.0.113.0/24"];

async function main() {
  const uri = process.env.HUB_MONGODB_URI ?? "";
  const dbInUri = uri.split("?")[0].split("/").pop();
  assert.equal(dbInUri, SCRATCH_DB, `refusing: URI db must be '${SCRATCH_DB}'`);
  assert.ok(process.env.HUB_KEK, "HUB_KEK must be set (a throwaway 32-byte key)");

  // Ensure a clean KEK map for the rotation legs (restore at the end).
  const savedEnv = {
    HUB_KEK: process.env.HUB_KEK,
    HUB_KEK_VERSION: process.env.HUB_KEK_VERSION,
    HUB_KEK_V1: process.env.HUB_KEK_V1,
  };
  const KEK1 = process.env.HUB_KEK!;
  const KEK2 = randomBytes(32).toString("base64");
  delete process.env.HUB_KEK_VERSION;
  delete process.env.HUB_KEK_V1;

  await connectDB();
  assert.equal(mongoose.connection.name, SCRATCH_DB, "connected db is the scratch db");
  console.log(`✓ connected to scratch db '${SCRATCH_DB}'`);

  try {
    // Seed the owner with an allowlist (the seed path).
    await HubUser.create({ email: EMAIL, role: "owner", isActive: true, ipAllowlist: ALLOWLIST });
    const owner = await HubUser.findOne({ email: EMAIL }).select("_id").lean<{ _id: unknown }>();
    const userId = String(owner!._id);

    // ── Enrol (v1 KEK) ────────────────────────────────────────────────────────
    const secret = generateTotpSecret();
    await HubUser.updateOne(
      { _id: owner!._id },
      { $set: { totpSecretEnc: encryptTotpSecret(userId, secret) }, $unset: { totpLastStep: "", stepUp: "" } },
    );
    const enc0 = (await HubUser.findById(owner!._id).select("+totpSecretEnc").lean<{ totpSecretEnc: string }>())!.totpSecretEnc;
    assert.equal(decryptTotpSecret(userId, enc0), secret, "enrolled secret round-trips");
    assert.equal(JSON.parse(enc0).keyVersion, 1, "enrolled under KEK v1");
    console.log("✓ enrol: totpSecretEnc stored + decrypts, keyVersion 1");

    // ── Valid code accepted + replay rejected ──────────────────────────────────
    const now = Date.now();
    const code = totpCodeForStep(secret, totpStep(now));
    const ok1 = await checkOwnerTotp(userId, enc0, code, now);
    assert.equal(ok1.ok, true, "valid current code accepted");
    const afterClaim = await HubUser.findById(owner!._id).select("totpLastStep").lean<{ totpLastStep: number }>();
    assert.equal(afterClaim!.totpLastStep, totpStep(now), "totpLastStep claimed");

    const replay = await checkOwnerTotp(userId, enc0, code, now);
    assert.equal(replay.ok, false, "same code re-use rejected (replay guard)");
    console.log("✓ TOTP verify: valid accepted + step claimed; replay rejected");

    // A wrong code is rejected and (in the auth path) audited — write the row here
    // to prove writeAudit persists.
    const wrong = await checkOwnerTotp(userId, enc0, "000000", now);
    assert.equal(wrong.ok, false, "wrong code rejected");
    await writeAudit({ actorId: userId, action: "auth.login.fail", ip: "203.0.113.7" });
    assert.equal(await AuditLog.countDocuments({ actorId: owner!._id, action: "auth.login.fail" }), 1);
    console.log("✓ wrong code rejected; auth.login.fail audit row written");

    // ── Login-time lazy KEK rewrap (v1 → v2) ───────────────────────────────────
    process.env.HUB_KEK = KEK2;
    process.env.HUB_KEK_VERSION = "2";
    process.env.HUB_KEK_V1 = KEK1;
    const nextStep = totpStep(now) + 5; // a fresh, un-replayed step
    const code2 = totpCodeForStep(secret, nextStep);
    const ok2 = await checkOwnerTotp(userId, enc0, code2, nextStep * 30_000);
    assert.equal(ok2.ok, true, "code accepted after KEK flip");
    const enc1 = (await HubUser.findById(owner!._id).select("+totpSecretEnc").lean<{ totpSecretEnc: string }>())!.totpSecretEnc;
    assert.equal(JSON.parse(enc1).keyVersion, 2, "lazy-rewrapped to v2 on use");
    assert.equal(decryptTotpSecret(userId, enc1), secret, "still decrypts after lazy rewrap");
    console.log("✓ login-time lazy KEK rewrap: v1 → v2, secret intact");

    // ── rotateKEK sweeps the TOTP secret (the fix-#5 leg) ──────────────────────
    // Re-enrol under v1 by wrapping with an explicit v1 map, then flip to v2 and
    // rotate — proving remaining===0 accounts for HubUser.totpSecretEnc.
    process.env.HUB_KEK = KEK1;
    delete process.env.HUB_KEK_VERSION;
    delete process.env.HUB_KEK_V1;
    await HubUser.updateOne({ _id: owner!._id }, { $set: { totpSecretEnc: encryptTotpSecret(userId, secret) } });
    process.env.HUB_KEK = KEK2;
    process.env.HUB_KEK_VERSION = "2";
    process.env.HUB_KEK_V1 = KEK1;
    const rot = await rotateKEK({ actorId: new Types.ObjectId(), ip: "203.0.113.7" });
    assert.ok(rot.scanned >= 1 && rot.rotated >= 1, "rotateKEK swept the TOTP secret");
    assert.equal(rot.remaining, 0, "remaining 0 ⇒ old KEK retirable (TOTP included)");
    console.log(`✓ rotateKEK TOTP sweep: scanned ${rot.scanned}, rotated ${rot.rotated}, remaining 0`);

    // Retire the old KEK WITHOUT any prior login — the secret must still decrypt.
    delete process.env.HUB_KEK_V1;
    const encFinal = (await HubUser.findById(owner!._id).select("+totpSecretEnc").lean<{ totpSecretEnc: string }>())!.totpSecretEnc;
    assert.equal(decryptTotpSecret(userId, encFinal), secret, "decrypts after retiring old KEK with no login");
    console.log("✓ retire-after-rotation with NO login: TOTP secret not stranded");

    // ── Step-up stamp + the gate's fresh-read → evaluatePanelAccess ────────────
    const sid = "sid-live-1";
    await HubUser.updateOne({ _id: owner!._id }, { $set: { stepUp: { at: new Date(), sid } } });
    const fresh = await HubUser.findById(owner!._id).select("isActive ipAllowlist stepUp").lean<{
      isActive: boolean; ipAllowlist: string[]; stepUp?: { at: Date; sid: string };
    }>();
    const session = { userId, role: "owner", sid };
    const user = { isActive: fresh!.isActive, ipAllowlist: fresh!.ipAllowlist, stepUp: fresh!.stepUp };

    assert.deepEqual(
      evaluatePanelAccess({ session, user, ip: "203.0.113.7", now: Date.now(), needStepUp: true, allowAnyIp: false }),
      { ok: true }, "allowlisted IP + fresh step-up passes",
    );
    assert.equal(
      evaluatePanelAccess({ session, user, ip: "8.8.8.8", now: Date.now(), needStepUp: false, allowAnyIp: false }).ok,
      false, "non-allowlisted IP denied",
    );
    assert.equal(
      evaluatePanelAccess({ session: { userId, role: "owner", sid: "other" }, user, ip: "203.0.113.7", now: Date.now(), needStepUp: true, allowAnyIp: false }).ok,
      false, "step-up from a different session denied",
    );
    assert.equal(
      evaluatePanelAccess({ session, user, ip: "203.0.113.7", now: Date.now() + STEP_UP_WINDOW_MS + 1, needStepUp: true, allowAnyIp: false }).ok,
      false, "stale step-up denied",
    );
    // Deactivation is instant on the fresh read.
    await HubUser.updateOne({ _id: owner!._id }, { $set: { isActive: false } });
    const off = await HubUser.findById(owner!._id).select("isActive ipAllowlist stepUp").lean<{ isActive: boolean; ipAllowlist: string[] }>();
    assert.equal(
      evaluatePanelAccess({ session, user: { isActive: off!.isActive, ipAllowlist: off!.ipAllowlist }, ip: "203.0.113.7", now: Date.now(), needStepUp: false, allowAnyIp: false }).ok,
      false, "deactivated account denied on fresh read",
    );
    console.log("✓ gate: fresh HubUser read → evaluatePanelAccess (allow / IP / sid / stale / deactivated)");

    console.log("LIVE PANEL ROUND-TRIP: ALL GREEN");
  } finally {
    // Restore env.
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    assert.equal(mongoose.connection.name, SCRATCH_DB, "drop-guard: still the scratch db");
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(`✓ scratch db '${SCRATCH_DB}' dropped`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
