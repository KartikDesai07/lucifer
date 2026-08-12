import mongoose, { type Types } from "mongoose";

import { Secret } from "@/models/Secret";
import { Tenant, type IDbCluster, type IHostingAccount, type ICloudAccount } from "@/models/Tenant";
import { getSecret, storeSecret, VaultError, type VaultAuditContext } from "@/lib/vault";
import {
  CLUSTER_REGISTRY_COLLECTION,
  CLUSTER_REGISTRY_ID,
  type ProvisionIntake,
  type RuntimeClusterRegistryDoc,
  type SecretIdentityKey,
} from "@/lib/provisioner-plan";

// ─────────────────────────────────────────────────────────────────────────────
// F3.6 — the IO ports the provisioner composes: RegistryPort (the Hub `Tenant`
// registry doc) + VaultPort (the F3.2 vault) + the runtime clusterRegistry doc
// writer (which dials the tenant's OWN primary cluster — a DIFFERENT database
// from the Hub registry). Behind interfaces so provisioner.ts is driven by
// in-memory fakes in the DB-free tests and the real Mongoose/vault here + on the
// live leg.
//
// Concurrency (R5): saveStep/pool writes are serialized by a per-tenant CAS
// LEASE (acquireLease); pool inserts are ALSO guarded ($push only when no entry
// with that clusterName/role exists) so a duplicate can never be minted even if
// a lease is ever bypassed. Non-atomic find-then-write is thus safe.
//
// No-console gate: SRV URIs with passwords + token plaintext flow through the
// vault adapter and the runtime-doc writer.
// ─────────────────────────────────────────────────────────────────────────────

/** The shard-map routing block the runtime F2 ClusterRouter mirrors. */
export interface TenantRouting {
  reference: string;
  counters: string;
  orders: string;
  orderWindows: { clusterName: string; fromDate: Date; toDate: Date | null }[];
}

/** The lean Tenant view the machine reasons over (never the full Mongoose doc). */
export interface TenantSnapshot {
  _id: Types.ObjectId;
  slug: string;
  status: string;
  step?: string;
  idempotencyKey?: string;
  leaseToken?: string;
  leaseUntil?: Date;
  dbPool: IDbCluster[];
  hosting: IHostingAccount[];
  imagePool: ICloudAccount[];
  domain?: { primary?: string; sslState?: string };
}

export interface RegistryPort {
  findBySlug(slug: string): Promise<TenantSnapshot | null>;
  create(intake: ProvisionIntake, runId: string, leaseUntil: Date): Promise<TenantSnapshot>;
  /** Atomic CAS: claim the lease iff free/expired AND the key matches. */
  acquireLease(slug: string, key: string, runId: string, leaseUntil: Date, now: Date): Promise<boolean>;
  renewLease(slug: string, runId: string, leaseUntil: Date): Promise<void>;
  releaseLease(slug: string, runId: string): Promise<void>;
  saveStep(slug: string, step: string): Promise<void>;
  saveError(slug: string, message: string): Promise<void>;
  upsertDbCluster(slug: string, entry: IDbCluster): Promise<void>;
  upsertHosting(slug: string, entry: IHostingAccount): Promise<void>;
  upsertImagePool(slug: string, entry: ICloudAccount): Promise<void>;
  /** Demote every OTHER active image account to 'full' (there is ≤1 active image
   *  store per cafe). Keeps a re-paste that SWITCHES store type from leaving two
   *  role:'active' entries (which would make the image/host steps pick the stale one). */
  demoteOtherImagePools(slug: string, keepAccountLabel: string): Promise<void>;
  repointImageRef(slug: string, which: "apiKeyRef" | "apiSecretRef", secretId: Types.ObjectId): Promise<void>;
  setRouting(slug: string, routing: TenantRouting): Promise<void>;
  setDomain(slug: string, domain: { primary: string; dnsMode: "cname"; sslState: string }): Promise<void>;
  activate(slug: string): Promise<void>;
  /** Reconcile the runtime CORE doc (R1): absent ⇒ insert full doc; present ⇒
   *  $set the orders ledger's uri to THIS run's fresh SRV (preserving core /
   *  standby / any F3.8 ledgers). Dials the tenant's primary cluster. */
  writeRuntimeClusterRegistry(primarySrv: string, doc: RuntimeClusterRegistryDoc): Promise<void>;
}

export interface VaultPort {
  store(tenantId: Types.ObjectId, id: SecretIdentityKey, plaintext: string, scope?: string): Promise<Types.ObjectId>;
  findActiveSecretId(tenantId: Types.ObjectId, id: SecretIdentityKey): Promise<Types.ObjectId | null>;
  /** findActive + audited getSecret; THROWS when no active credential exists. */
  reveal(tenantId: Types.ObjectId, id: SecretIdentityKey, audit: VaultAuditContext): Promise<string>;
  /** Revoke every ACTIVE row of this identity except `exceptId`. */
  revokeOthers(tenantId: Types.ObjectId, id: SecretIdentityKey, exceptId: Types.ObjectId): Promise<number>;
}

// ── Mongoose-backed RegistryPort ─────────────────────────────────────────────
function toSnapshot(doc: {
  _id: Types.ObjectId;
  slug: string;
  status: string;
  provisioning?: { step?: string; idempotencyKey?: string; leaseToken?: string; leaseUntil?: Date };
  dbPool?: IDbCluster[];
  hosting?: IHostingAccount[];
  imagePool?: ICloudAccount[];
  domain?: { primary?: string; sslState?: string };
}): TenantSnapshot {
  return {
    _id: doc._id,
    slug: doc.slug,
    status: doc.status,
    step: doc.provisioning?.step,
    idempotencyKey: doc.provisioning?.idempotencyKey,
    leaseToken: doc.provisioning?.leaseToken,
    leaseUntil: doc.provisioning?.leaseUntil,
    dbPool: doc.dbPool ?? [],
    hosting: doc.hosting ?? [],
    imagePool: doc.imagePool ?? [],
    domain: doc.domain,
  };
}

/** Injectable connection factory for the runtime-doc write (real by default;
 *  the live leg can point it at a stand-in). */
export interface RegistryDeps {
  openRuntimeConn: (uri: string) => Promise<mongoose.Connection>;
}

function defaultRuntimeConn(uri: string): Promise<mongoose.Connection> {
  // A short-lived, single-socket connection to the tenant's OWN primary cluster
  // (NOT the Hub registry). Generous server-selection so a just-IDLE M0 that is
  // still finishing DNS propagation is tolerated; the caller closes it.
  const conn = mongoose.createConnection(uri, {
    maxPoolSize: 1,
    minPoolSize: 0,
    bufferCommands: false,
    serverSelectionTimeoutMS: 15_000,
  });
  return conn.asPromise();
}

export function createMongooseRegistry(deps: Partial<RegistryDeps> = {}): RegistryPort {
  const openRuntimeConn = deps.openRuntimeConn ?? defaultRuntimeConn;

  const setProvisioning = (slug: string, set: Record<string, unknown>, unset?: Record<string, "">) =>
    Tenant.updateOne(
      { slug },
      {
        $set: { ...set, "provisioning.updatedAt": new Date() },
        ...(unset ? { $unset: unset } : {}),
      },
    ).then(() => undefined);

  return {
    async findBySlug(slug) {
      const doc = await Tenant.findOne({ slug }).lean();
      return doc ? toSnapshot(doc as Parameters<typeof toSnapshot>[0]) : null;
    },

    async create(intake, runId, leaseUntil) {
      const doc = await Tenant.create({
        slug: intake.slug,
        status: "provisioning",
        ownerEmail: intake.ownerEmail,
        businessType: intake.businessType,
        ...(intake.branding ? { branding: intake.branding } : {}),
        provisioning: {
          step: "intake",
          idempotencyKey: intake.idempotencyKey,
          leaseToken: runId,
          leaseUntil,
          updatedAt: new Date(),
        },
      });
      return toSnapshot(doc.toObject() as Parameters<typeof toSnapshot>[0]);
    },

    async acquireLease(slug, key, runId, leaseUntil, now) {
      const res = await Tenant.updateOne(
        {
          slug,
          "provisioning.idempotencyKey": key,
          $or: [
            { "provisioning.leaseUntil": { $exists: false } },
            { "provisioning.leaseUntil": { $lt: now } },
            { "provisioning.leaseToken": runId }, // re-entrant: already ours
          ],
        },
        { $set: { "provisioning.leaseToken": runId, "provisioning.leaseUntil": leaseUntil } },
      );
      return res.modifiedCount === 1 || res.matchedCount === 1;
    },

    renewLease(slug, runId, leaseUntil) {
      return Tenant.updateOne(
        { slug, "provisioning.leaseToken": runId },
        { $set: { "provisioning.leaseUntil": leaseUntil } },
      ).then(() => undefined);
    },

    releaseLease(slug, runId) {
      return Tenant.updateOne(
        { slug, "provisioning.leaseToken": runId },
        { $unset: { "provisioning.leaseToken": "", "provisioning.leaseUntil": "" } },
      ).then(() => undefined);
    },

    saveStep(slug, step) {
      return setProvisioning(slug, { "provisioning.step": step }, { "provisioning.lastError": "" });
    },

    saveError(slug, message) {
      return setProvisioning(slug, { "provisioning.lastError": message });
    },

    async upsertDbCluster(slug, entry) {
      // Guarded push: only when no entry with this clusterName exists.
      const pushed = await Tenant.updateOne(
        { slug, "dbPool.clusterName": { $ne: entry.clusterName } },
        { $push: { dbPool: entry } },
      );
      if (pushed.modifiedCount === 0) {
        await Tenant.updateOne(
          { slug, "dbPool.clusterName": entry.clusterName },
          { $set: { "dbPool.$": entry } },
        );
      }
    },

    async upsertHosting(slug, entry) {
      const pushed = await Tenant.updateOne(
        { slug, "hosting.accountLabel": { $ne: entry.accountLabel } },
        { $push: { hosting: entry } },
      );
      if (pushed.modifiedCount === 0) {
        await Tenant.updateOne(
          { slug, "hosting.accountLabel": entry.accountLabel },
          { $set: { "hosting.$": entry } },
        );
      }
    },

    async upsertImagePool(slug, entry) {
      const pushed = await Tenant.updateOne(
        { slug, "imagePool.accountLabel": { $ne: entry.accountLabel } },
        { $push: { imagePool: entry } },
      );
      if (pushed.modifiedCount === 0) {
        await Tenant.updateOne(
          { slug, "imagePool.accountLabel": entry.accountLabel },
          { $set: { "imagePool.$": entry } },
        );
      }
    },

    demoteOtherImagePools(slug, keepAccountLabel) {
      return Tenant.updateOne(
        { slug },
        { $set: { "imagePool.$[e].role": "full" } },
        { arrayFilters: [{ "e.accountLabel": { $ne: keepAccountLabel }, "e.role": "active" }] },
      ).then(() => undefined);
    },

    repointImageRef(slug, which, secretId) {
      // Re-point the FIRST (active) image account's ref. No-op if none exists yet
      // (the image step hasn't run — findActiveSecretId will pick the fresh row).
      return Tenant.updateOne(
        { slug, "imagePool.role": "active" },
        { $set: { [`imagePool.$.${which}`]: secretId } },
      ).then(() => undefined);
    },

    setRouting(slug, routing) {
      return setProvisioning(slug, { routing }).then(() => undefined);
    },

    setDomain(slug, domain) {
      return Tenant.updateOne({ slug }, { $set: { domain } }).then(() => undefined);
    },

    activate(slug) {
      return Tenant.updateOne(
        { slug },
        { $set: { status: "active", "provisioning.step": "done", "provisioning.updatedAt": new Date() } },
      ).then(() => undefined);
    },

    async writeRuntimeClusterRegistry(primarySrv, doc) {
      // Sanitize the CONNECT error at source: a driver connect/parse failure can
      // echo the credential-bearing SRV, which the machine would persist into
      // Tenant.provisioning.lastError (and the nightly registry mongodump). Surface
      // only the error's class name — never its message. (Operation errors below
      // do not carry the SRV, so their messages are left intact.)
      let conn: mongoose.Connection;
      try {
        conn = await openRuntimeConn(primarySrv);
      } catch (err) {
        throw new Error(
          `[provisioner] runtime clusterRegistry connect failed (${(err as { name?: string })?.name ?? "Error"})`,
        );
      }
      try {
        // Type the collection with our STRING-`_id` doc so the driver stops typing
        // `_id` as ObjectId (the cafe registry-io dodges this with an empty filter).
        const coll = conn.db!.collection<RuntimeClusterRegistryDoc>(CLUSTER_REGISTRY_COLLECTION);
        const existing = await coll.findOne({});
        const orders = doc.ledgers[0];
        if (!existing) {
          await coll.insertOne(doc);
          return;
        }
        // RECONCILE (R1): re-sync ONLY the orders ledger's uri to THIS run's fresh
        // SRV (db.orders re-mints the password every run) — preserving core,
        // standby, and any F3.8 hot-added ledgers.
        const hasOrders = (existing.ledgers ?? []).some((l) => l.id === orders.id);
        if (hasOrders) {
          await coll.updateOne(
            { _id: CLUSTER_REGISTRY_ID, "ledgers.id": orders.id },
            { $set: { "ledgers.$.uri": orders.uri } },
          );
        } else {
          await coll.updateOne({ _id: CLUSTER_REGISTRY_ID }, { $push: { ledgers: orders } });
        }
      } finally {
        await conn.close();
      }
    },
  };
}

// ── Vault-backed VaultPort ───────────────────────────────────────────────────
export function createVaultPort(): VaultPort {
  return {
    store(tenantId, id, plaintext, scope) {
      return storeSecret(
        {
          tenantId,
          provider: id.provider,
          accountLabel: id.accountLabel,
          classification: id.classification,
          ...(scope ? { scope } : {}),
        },
        plaintext,
      );
    },

    async findActiveSecretId(tenantId, id) {
      const doc = await Secret.findOne({
        tenantId,
        provider: id.provider,
        accountLabel: id.accountLabel,
        classification: id.classification,
        status: { $ne: "revoked" },
      })
        .sort({ createdAt: -1 })
        .select("_id")
        .lean();
      return doc ? (doc._id as Types.ObjectId) : null;
    },

    async reveal(tenantId, id, audit) {
      const secretId = await this.findActiveSecretId(tenantId, id);
      if (!secretId) {
        throw new VaultError(
          `no active credential for ${id.provider}/${id.accountLabel}/${id.classification}`,
        );
      }
      return getSecret(secretId, audit);
    },

    async revokeOthers(tenantId, id, exceptId) {
      const res = await Secret.updateMany(
        {
          tenantId,
          provider: id.provider,
          accountLabel: id.accountLabel,
          classification: id.classification,
          status: { $ne: "revoked" },
          _id: { $ne: exceptId },
        },
        { $set: { status: "revoked" } },
      );
      return res.modifiedCount;
    },
  };
}
