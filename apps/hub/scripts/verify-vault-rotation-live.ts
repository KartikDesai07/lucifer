// Dev verify script — prints pass/fail lines only, never a URI, KEK, or any
// plaintext secret value. (The vault no-console gate covers lib/, not scripts/.)
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import mongoose, { Types } from "mongoose";

import { connectDB } from "../lib/db";
import { getSecret, rotateCred, rotateKEK, storeSecret, VaultError } from "../lib/vault";
import { AuditLog } from "../models/AuditLog";
import { Secret } from "../models/Secret";

// ─────────────────────────────────────────────────────────────────────────────
// LIVE F3.3 rotation legs on a SCRATCH db (rides verify:vault-live after the
// F3.2 script). Prefix-guarded: refuses unless the URI db is exactly
// `hubreg_verify`, and drops it afterwards. Needs HUB_MONGODB_URI (scratch) +
// HUB_KEK (a throwaway 32-byte v1 key) in the env; the v2 KEK + the env flip
// happen in-process. Proves what the DB-free tests can't: the rotateKEK sweep
// over real rows (payload bytes untouched, rotatedAt stamped, off-version
// failure honesty, idempotence, retire-after-migration) and the rotateCred
// orchestration (§D order, rollback, status lifecycle, audit rows).
// ─────────────────────────────────────────────────────────────────────────────

const SCRATCH_DB = "hubreg_verify";
const PT = (n: number) => `mongodb+srv://rot:cred-${n}-value@scratch.example.mongodb.net/pos`;
const actorId = new Types.ObjectId();
const AUDIT = { actorId, ip: "127.0.0.1" };

type RawSecret = Record<string, unknown>;
const raw = async (id: Types.ObjectId): Promise<RawSecret> => {
  const doc = await Secret.collection.findOne({ _id: id });
  assert.ok(doc, "raw doc found");
  return doc as unknown as RawSecret;
};

async function main() {
  const uri = process.env.HUB_MONGODB_URI ?? "";
  assert.equal(uri.split("?")[0].split("/").pop(), SCRATCH_DB, `refusing: URI db must be '${SCRATCH_DB}'`);
  assert.ok(process.env.HUB_KEK, "HUB_KEK must be set (a throwaway 32-byte v1 key)");
  const kek1 = process.env.HUB_KEK;

  await connectDB();
  assert.equal(mongoose.connection.name, SCRATCH_DB, "connected db is the scratch db");
  console.log(`✓ connected to scratch db '${SCRATCH_DB}'`);

  try {
    // ── Seed: 3 records under v1 (one to be revoked pre-rotation) ────────────
    const tenantA = new Types.ObjectId();
    const tenantB = new Types.ObjectId();
    const id1 = await storeSecret({ tenantId: tenantA, provider: "atlas", accountLabel: "atlas-1", classification: "dbUri" }, PT(1));
    const id2 = await storeSecret({ tenantId: tenantA, provider: "r2", accountLabel: "r2-1", classification: "apiSecret", scope: "bucket:pos" }, PT(2));
    const id3 = await storeSecret({ tenantId: tenantB, provider: "vercel", accountLabel: "vercel-1", classification: "token" }, PT(3));
    await Secret.updateOne({ _id: id3 }, { $set: { status: "revoked" } }); // historical revoked row
    const before = [await raw(id1), await raw(id2), await raw(id3)];
    assert.ok(before.every((r) => r.keyVersion === 1 && r.rotatedAt === undefined), "seeded at v1, no rotatedAt");
    assert.equal((await raw(id1)).status, "active", "status defaults active");
    console.log("✓ seeded 3 v1 records (one revoked)");

    // ── The zero-downtime env flip: v2 current, v1 retired-but-readable ──────
    process.env.HUB_KEK_V1 = kek1;
    process.env.HUB_KEK = randomBytes(32).toString("base64");
    process.env.HUB_KEK_VERSION = "2";
    assert.equal(await getSecret(id1, AUDIT), PT(1), "v1 record still reveals AFTER the flip (key map)");
    const id4 = await storeSecret({ tenantId: tenantB, provider: "atlas", accountLabel: "atlas-2", classification: "dbUri" }, PT(4));
    assert.equal((await raw(id4)).keyVersion, 2, "post-flip writes wrap under v2");
    console.log("✓ env flip: old reads + new writes both live (zero-downtime)");

    // ── rotateKEK: re-wrap DEKs only ─────────────────────────────────────────
    const res = await rotateKEK(AUDIT);
    assert.deepEqual(
      { toVersion: res.toVersion, scanned: res.scanned, rotated: res.rotated, failed: res.failed, remaining: res.remaining },
      { toVersion: 2, scanned: 3, rotated: 3, failed: [], remaining: 0 },
    );
    for (const [i, id] of [id1, id2, id3].entries()) {
      const after = await raw(id);
      for (const f of ["ciphertext", "iv", "tag", "aad"]) assert.equal(after[f], before[i][f], `payload '${f}' untouched`);
      for (const f of ["wrappedDek", "wrapIv", "wrapTag"]) assert.notEqual(after[f], before[i][f], `wrap '${f}' moved`);
      assert.equal(after.keyVersion, 2);
      assert.ok(after.rotatedAt instanceof Date, "rotatedAt stamped");
    }
    assert.equal((await raw(id4)).rotatedAt, undefined, "already-current record untouched");
    assert.equal(await AuditLog.countDocuments({ action: "kek.rotate" }), 1, "one kek.rotate audit row");
    console.log("✓ rotateKEK: 3/3 re-wrapped, payloads byte-identical, revoked row included");

    // ── Retire the old KEK: everything still decrypts on v2 alone ────────────
    delete process.env.HUB_KEK_V1;
    assert.equal(await getSecret(id1, AUDIT), PT(1));
    assert.equal(await getSecret(id2, AUDIT), PT(2));
    assert.equal(await getSecret(id4, AUDIT), PT(4));
    await assert.rejects(getSecret(id3, AUDIT), (e: unknown) => e instanceof VaultError && /revoked/.test(e.message));
    assert.equal(await AuditLog.countDocuments({ action: "secret.reveal", secretId: id3 }), 0, "gated reveal wrote no row");
    assert.equal(await getSecret(id3, AUDIT, { allowRevoked: true }), PT(3), "forensic reveal of revoked row");
    // Legacy F3.2 parity: a raw row with NO status field (pre-F3.3) is active.
    await Secret.collection.updateOne({ _id: id2 }, { $unset: { status: "" } });
    assert.equal(await getSecret(id2, AUDIT), PT(2), "status-less legacy row reveals as active");
    await Secret.collection.updateOne({ _id: id2 }, { $set: { status: "active" } });
    console.log("✓ old KEK retired AFTER migration; revoked gate + forensic + legacy-row reveals");

    // ── Idempotence + per-record failure honesty ─────────────────────────────
    const again = await rotateKEK(AUDIT);
    assert.deepEqual({ scanned: again.scanned, rotated: again.rotated, remaining: again.remaining }, { scanned: 0, rotated: 0, remaining: 0 });
    await Secret.collection.updateOne({ _id: id4 }, { $set: { keyVersion: 3 } }); // orphan version, no HUB_KEK_V3
    const withOrphan = await rotateKEK(AUDIT);
    assert.equal(withOrphan.failed.length, 1);
    assert.match(withOrphan.failed[0].error, /unknown KEK version 3/);
    assert.deepEqual({ rotated: withOrphan.rotated, remaining: withOrphan.remaining }, { rotated: 0, remaining: 1 });
    const orphan = await raw(id4);
    for (const f of ["wrappedDek", "wrapIv", "wrapTag", "ciphertext"]) {
      assert.ok(typeof orphan[f] === "string" && (orphan[f] as string).length > 0, `orphan '${f}' intact`);
    }
    await Secret.collection.updateOne({ _id: id4 }, { $set: { keyVersion: 2 } });
    assert.equal(await getSecret(id4, AUDIT), PT(4), "orphan restored + still decrypts (sweep never corrupted it)");
    console.log("✓ rotateKEK idempotent; unknown-KEK record reported, never touched");

    // ── rotateCred: §D happy path ────────────────────────────────────────────
    const calls: string[] = [];
    const pointers: string[] = [];
    const NEW_PT = "mongodb+srv://rot:fresh-key-value@scratch.example.mongodb.net/pos";
    const hooks = (opts: { failVerify?: boolean; failRevoke?: boolean } = {}) => ({
      createKey: async () => { calls.push("createKey"); return { plaintext: NEW_PT, scope: "project:rotated" }; },
      setActivePointer: async (id: Types.ObjectId) => { calls.push("setActivePointer"); pointers.push(String(id)); },
      healthVerify: async (pt: string) => { calls.push(`healthVerify:${pt === NEW_PT ? "new-cred" : "WRONG"}`); if (opts.failVerify) throw new Error("probe failed"); },
      revokeOldKey: async () => { calls.push("revokeOldKey"); if (opts.failRevoke) throw new Error("provider 500"); },
    });

    const happy = await rotateCred(id1, hooks(), AUDIT);
    assert.deepEqual(calls, ["createKey", "setActivePointer", "healthVerify:new-cred", "revokeOldKey"], "§D order");
    assert.deepEqual(pointers, [String(happy.newSecretId)], "pointer flipped to the NEW record");
    assert.equal(happy.oldKeyRevoked, true);
    assert.equal((await raw(id1)).status, "revoked", "old record revoked, ciphertext kept");
    const newRaw = await raw(happy.newSecretId);
    assert.deepEqual(
      { status: newRaw.status, keyVersion: newRaw.keyVersion, accountLabel: newRaw.accountLabel, scope: newRaw.scope },
      { status: "active", keyVersion: 2, accountLabel: "atlas-1", scope: "project:rotated" },
    );
    assert.equal(await getSecret(happy.newSecretId, AUDIT), NEW_PT, "new record reveals the new key");
    const credAudit = await AuditLog.findOne({ action: "cred.rotate" }).lean();
    assert.ok(credAudit, "cred.rotate audit row");
    assert.equal(String(credAudit.secretId), String(id1));
    assert.equal(String(credAudit.targetTenantId), String(tenantA));
    await assert.rejects(rotateCred(id1, hooks(), AUDIT), (e: unknown) => e instanceof VaultError && /cannot rotate a revoked secret/.test(e.message));
    console.log("✓ rotateCred happy path: order, statuses, audit, re-rotation refused");

    // ── rotateCred: health-verify failure rolls back ─────────────────────────
    calls.length = 0; pointers.length = 0;
    await assert.rejects(rotateCred(id2, hooks({ failVerify: true }), AUDIT), (e: unknown) => e instanceof VaultError && /rolled back/.test(e.message));
    assert.deepEqual(calls, ["createKey", "setActivePointer", "healthVerify:new-cred", "setActivePointer"], "no revoke after failed verify");
    assert.equal(pointers[1], String(id2), "pointer rolled back to the OLD record");
    assert.equal((await raw(id2)).status, "active", "old record stays active");
    const deadNew = await Secret.findOne({ _id: { $ne: id2 }, accountLabel: "r2-1" }).lean();
    assert.equal(deadNew?.status, "revoked", "never-adopted new record marked revoked");
    assert.equal(await getSecret(id2, AUDIT), PT(2), "old cred still reveals");
    console.log("✓ rotateCred verify-failure: rollback, old active, dead new record revoked");

    // ── rotateCred: old-key revocation failure ⇒ 'retired', rotation stands ──
    calls.length = 0; pointers.length = 0;
    const partial = await rotateCred(id4, hooks({ failRevoke: true }), AUDIT);
    assert.equal(partial.oldKeyRevoked, false, "revocation failure reported");
    assert.equal((await raw(id4)).status, "retired", "old record retired, not revoked");
    assert.equal(await getSecret(id4, AUDIT), PT(4), "retired record still revealable");
    assert.equal((await raw(partial.newSecretId)).status, "active");
    assert.equal(await AuditLog.countDocuments({ action: "cred.rotate" }), 2, "failed rollback wrote no cred.rotate row");
    console.log("✓ rotateCred revoke-failure: retired status, rotation stands, honest result");

    console.log("LIVE ROTATION LEGS: ALL GREEN");
  } finally {
    assert.equal(mongoose.connection.name, SCRATCH_DB, "drop-guard: still the scratch db");
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(`✓ scratch db '${SCRATCH_DB}' dropped`);
  }
}

main().catch((err) => {
  console.error("LIVE ROTATION LEGS FAILED:", err);
  process.exitCode = 1;
});
