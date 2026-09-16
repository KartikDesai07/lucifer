// Dev verify script — prints pass/fail lines only, never the URI, KEK, or any
// plaintext secret value. (The vault no-console gate covers lib/, not scripts/.)
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import mongoose, { Types } from "mongoose";

import { connectDB } from "../lib/db";
import { getSecret, storeSecret, VaultError } from "../lib/vault";
import { AuditLog } from "../models/AuditLog";
import { Secret } from "../models/Secret";

// ─────────────────────────────────────────────────────────────────────────────
// LIVE vault round-trip on a SCRATCH db (F3.2 verify; the F2 §5-sweep / F3.1
// precedent). Prefix-guarded: refuses to run unless the target db is exactly
// `hubreg_verify`, and drops it afterwards. Run via `npm run verify:vault-live`
// with HUB_MONGODB_URI (pointed at the scratch db) + HUB_KEK in the env.
// Proves the DB layer the DB-free unit tests can't: Secret.create shapes,
// the fail-closed audit row, lastUsedAt stamping, and in-DB tamper rejection.
// ─────────────────────────────────────────────────────────────────────────────

const SCRATCH_DB = "hubreg_verify";
const PLAINTEXT = "mongodb+srv://verify:live-probe-cred@scratch.example.mongodb.net/pos";

function corrupt(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  buf[Math.floor(buf.length / 2)] ^= 0xff;
  return buf.toString("base64");
}

async function main() {
  const uri = process.env.HUB_MONGODB_URI ?? "";
  const dbInUri = uri.split("?")[0].split("/").pop();
  assert.equal(dbInUri, SCRATCH_DB, `refusing: URI db must be '${SCRATCH_DB}'`);
  assert.ok(process.env.HUB_KEK, "HUB_KEK must be set (a throwaway 32-byte key)");

  await connectDB();
  assert.equal(mongoose.connection.name, SCRATCH_DB, "connected db is the scratch db");
  console.log(`✓ connected to scratch db '${SCRATCH_DB}'`);

  try {
    const tenantId = new Types.ObjectId();
    const actorId = new Types.ObjectId();

    // §A — store (untrimmed label on purpose: proves trim happens BEFORE the AAD).
    const id = await storeSecret(
      { tenantId, provider: "atlas", accountLabel: "  atlas-1  ", classification: "dbUri", scope: "project:verify" },
      PLAINTEXT,
    );
    console.log("✓ storeSecret persisted a record");

    // Raw-BSON read (native driver — no Mongoose casting) — nothing plaintext.
    const raw = await Secret.collection.findOne({ _id: id });
    assert.ok(raw, "raw doc found");
    for (const [key, value] of Object.entries(raw)) {
      assert.ok(
        typeof value !== "string" || !value.includes("live-probe-cred"),
        `raw field ${key} leaks plaintext`,
      );
    }
    assert.equal(raw.accountLabel, "atlas-1", "label stored trimmed");
    assert.equal(raw.keyVersion, 1);
    assert.equal(raw.lastUsedAt, null, "lastUsedAt starts null");
    assert.ok(raw.createdAt instanceof Date && raw.updatedAt instanceof Date, "timestamps");
    console.log("✓ raw BSON: all crypto fields ciphertext-only, no plaintext leak");

    // §B — reveal: plaintext back, audit row written, lastUsedAt stamped.
    const revealed = await getSecret(id, { actorId, ip: "127.0.0.1" });
    assert.equal(revealed, PLAINTEXT, "round-trip plaintext matches");
    const used = await Secret.findById(id).lean();
    assert.ok(used?.lastUsedAt instanceof Date, "lastUsedAt stamped");
    const audit = await AuditLog.findOne({ secretId: id }).lean();
    assert.ok(audit, "audit row written");
    assert.equal(audit.action, "secret.reveal");
    assert.equal(String(audit.actorId), String(actorId));
    assert.equal(String(audit.targetTenantId), String(tenantId));
    assert.equal(audit.ip, "127.0.0.1");
    assert.ok(audit.ts instanceof Date, "audit ts stamped");
    console.log("✓ getSecret round-trip + audit row + lastUsedAt");

    // Wrong KEK (fresh key in env) → unwrap fails.
    const goodKek = process.env.HUB_KEK!;
    process.env.HUB_KEK = randomBytes(32).toString("base64");
    await assert.rejects(
      getSecret(id, { actorId, ip: "127.0.0.1" }),
      (e: unknown) => e instanceof VaultError && /DEK unwrap failed/.test(e.message),
    );
    process.env.HUB_KEK = goodKek;
    console.log("✓ wrong KEK rejected at unwrap");

    // In-DB cross-tenant swap → AAD binding mismatch.
    await Secret.collection.updateOne(
      { _id: id },
      { $set: { tenantId: new Types.ObjectId() } },
    );
    await assert.rejects(
      getSecret(id, { actorId, ip: "127.0.0.1" }),
      (e: unknown) => e instanceof VaultError && /AAD binding mismatch/.test(e.message),
    );
    await Secret.collection.updateOne({ _id: id }, { $set: { tenantId: tenantId } });
    console.log("✓ in-DB tenantId swap rejected (AAD binding)");

    // In-DB keyVersion bump → unknown-version (the F3.3 key-map seam).
    await Secret.collection.updateOne({ _id: id }, { $set: { keyVersion: 2 } });
    await assert.rejects(
      getSecret(id, { actorId, ip: "127.0.0.1" }),
      (e: unknown) => e instanceof VaultError && /unknown KEK version/.test(e.message),
    );
    await Secret.collection.updateOne({ _id: id }, { $set: { keyVersion: 1 } });
    console.log("✓ unknown keyVersion rejected");

    // In-DB tag TRUNCATION (the GCM tag-downgrade vector — pre-fix this
    // decrypted successfully on Node 22) → must now be rejected by length gate.
    const tag8 = Buffer.from(raw.tag as string, "base64").subarray(0, 8).toString("base64");
    await Secret.collection.updateOne({ _id: id }, { $set: { tag: tag8 } });
    await assert.rejects(
      getSecret(id, { actorId, ip: "127.0.0.1" }),
      (e: unknown) => e instanceof VaultError && /wrong length/.test(e.message),
    );
    console.log("✓ in-DB truncated tag rejected (downgrade defense)");

    // In-DB tag tamper → decrypt fails; and fail-closed: NO new audit row from
    // any of the failed reveals above.
    await Secret.collection.updateOne({ _id: id }, { $set: { tag: corrupt(raw.tag as string) } });
    await assert.rejects(
      getSecret(id, { actorId, ip: "127.0.0.1" }),
      (e: unknown) => e instanceof VaultError,
    );
    const auditCount = await AuditLog.countDocuments({ secretId: id });
    assert.equal(auditCount, 1, "failed reveals wrote no audit row (fail-closed)");
    console.log("✓ in-DB tag tamper rejected; failed reveals left no audit rows");

    console.log("LIVE VAULT ROUND-TRIP: ALL GREEN");
  } finally {
    assert.equal(mongoose.connection.name, SCRATCH_DB, "drop-guard: still the scratch db");
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(`✓ scratch db '${SCRATCH_DB}' dropped`);
  }
}

main().catch((err) => {
  console.error("LIVE VAULT ROUND-TRIP FAILED:", err);
  process.exitCode = 1;
});
