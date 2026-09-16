import { randomBytes } from "node:crypto";

import type { Types } from "mongoose";

import { writeAudit } from "@/lib/audit";
import type { RetryDeps } from "@/lib/provider-retry";
import type { VaultAuditContext } from "@/lib/vault";
import {
  createMongooseRegistry,
  createVaultPort,
  type RegistryPort,
  type TenantSnapshot,
  type VaultPort,
} from "@/lib/provisioner-registry";
import {
  appSecretId,
  ATLAS_SA,
  assertProvisionableSlug,
  imageSecretId,
  STEP_DONE,
  stepsAfter,
  vercelTokenId,
  type AppSecretKind,
  type ImagePaste,
  type ProvisionConfig,
  type ProvisionIntake,
  type SecretIdentityKey,
} from "@/lib/provisioner-plan";
import {
  stepDbOrders,
  stepDbPrimary,
  stepDomain,
  stepHostActive,
  stepHostStandby,
  stepImage,
  stepInvite,
  stepSeed,
  type PendingInfo,
  type ProvisionHooks,
  type StepContext,
  type StepResult,
} from "@/lib/provisioner-steps";
import type { StepName } from "@/lib/provisioner-plan";

// ─────────────────────────────────────────────────────────────────────────────
// F3.6 — the idempotent, resumable PROVISION-NEW-TENANT state machine. Composes
// the F3.5 provider clients + the F3.2 vault behind the F3.6 ports. Persists
// `provisioning.step` (LAST COMPLETED) after each step; a re-run with the same
// idempotencyKey resumes at `stepsAfter(step)`, and a step that THREW re-runs
// from the top (every sub-op is check-then-create). Two overlapping same-key runs
// are serialized by a per-tenant CAS lease so a step's password reset + secret
// store + runtime-doc write cannot interleave.
//
// No-console gate: credentials + SRV URIs flow through the composed steps.
// ─────────────────────────────────────────────────────────────────────────────

/** Lease TTL: longer than the longest single step (pollIdle 15m / deploy 15m) so
 *  the lease can't expire mid-step; renewed at each step boundary. A crashed
 *  holder's lease expires after this, freeing the tenant for a later resume. */
const LEASE_TTL_MS = 20 * 60 * 1000;

export type ProvisionStatus = "done" | "pending" | "inProgress" | "alreadyDone";

export interface ProvisionResult {
  status: ProvisionStatus;
  /** The last COMPLETED step (STEP_DONE when finished). */
  step: string;
  /** Present when status==='pending' (e.g. the domain awaits the owner's DNS). */
  pending?: PendingInfo;
}

/** Injectable machine collaborators (test seam). */
export interface ProvisionDeps {
  registry: RegistryPort;
  vault: VaultPort;
  /** Fresh random hex (DB passwords + app secrets). */
  mintSecret: (bytes?: number) => string;
  /** Passed to the F3.5 provider clients inside steps (fake fetch/clock in tests). */
  retryOverrides?: Partial<RetryDeps>;
  now: () => number;
}

const STEP_FNS: Record<StepName, (ctx: StepContext) => Promise<StepResult>> = {
  "db.primary": stepDbPrimary,
  "db.orders": stepDbOrders,
  image: stepImage,
  "host.active": stepHostActive,
  "host.standby": stepHostStandby,
  domain: stepDomain,
  seed: stepSeed,
  invite: stepInvite,
};

function resolveDeps(overrides?: Partial<ProvisionDeps>): ProvisionDeps {
  return {
    registry: overrides?.registry ?? createMongooseRegistry(),
    vault: overrides?.vault ?? createVaultPort(),
    mintSecret: overrides?.mintSecret ?? ((bytes = 32) => randomBytes(bytes).toString("hex")),
    retryOverrides: overrides?.retryOverrides,
    now: overrides?.now ?? (() => Date.now()),
  };
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

/** Store a fresh row unless the current active row is byte-identical (avoid churn
 *  on an unchanged re-paste). Does NOT revoke — the caller revokes AFTER any
 *  dependent pool ref is re-pointed (R3 ordering: store → re-point → revoke). */
async function storeFreshOrKeep(
  vault: VaultPort,
  tenantId: Types.ObjectId,
  id: SecretIdentityKey,
  plaintext: string,
  audit: VaultAuditContext,
): Promise<Types.ObjectId> {
  const existing = await vault.findActiveSecretId(tenantId, id);
  if (existing) {
    const current = await vault.reveal(tenantId, id, audit); // reveals the newest active = existing
    if (current === plaintext) return existing;
  }
  return vault.store(tenantId, id, plaintext);
}

/** Heal a cred with NO persisted pool ref (Atlas SA, Vercel tokens): store fresh
 *  then revoke old — safe because nothing points at it by _id. */
async function healNoRef(
  vault: VaultPort,
  tenantId: Types.ObjectId,
  id: SecretIdentityKey,
  plaintext: string,
  audit: VaultAuditContext,
): Promise<void> {
  const newId = await storeFreshOrKeep(vault, tenantId, id, plaintext, audit);
  await vault.revokeOthers(tenantId, id, newId);
}

/** Heal the image creds ref-safely (R3): store both fresh → re-point the pool
 *  refs to the fresh ids (via upsertImagePool) → THEN revoke old rows. No live
 *  pool ref ever references a revoked row. */
async function healImage(
  deps: ProvisionDeps,
  slug: string,
  tenantId: Types.ObjectId,
  image: ImagePaste,
  audit: VaultAuditContext,
): Promise<void> {
  const { vault, registry } = deps;
  const keyPlain = image.store === "cloudinary" ? image.apiKey : image.accessKeyId;
  const secPlain = image.store === "cloudinary" ? image.apiSecret : image.secretAccessKey;
  const keyId = await storeFreshOrKeep(vault, tenantId, imageSecretId(image.store, "apiKey"), keyPlain, audit);
  const secId = await storeFreshOrKeep(vault, tenantId, imageSecretId(image.store, "apiSecret"), secPlain, audit);

  const accountLabel = image.store === "r2" ? "r2-1" : "cloudinary-1";
  await registry.upsertImagePool(slug, {
    provider: image.store,
    accountLabel,
    role: "active",
    ...(image.store === "cloudinary"
      ? { cloudName: image.cloudName }
      : { bucket: image.bucket, accountId: image.accountId, publicBaseUrl: image.publicBaseUrl }),
    apiKeyRef: keyId,
    apiSecretRef: secId,
  });
  // If a re-paste SWITCHED the store type, demote the previous active entry so the
  // image/host steps never pick the stale store (only one active image store per cafe).
  await registry.demoteOtherImagePools(slug, accountLabel);

  await vault.revokeOthers(tenantId, imageSecretId(image.store, "apiKey"), keyId);
  await vault.revokeOthers(tenantId, imageSecretId(image.store, "apiSecret"), secId);
}

/** Store the pasted creds (first run + explicit re-paste). ONLY runs when
 *  intake.creds is present; a plain resume reads everything from the vault. */
async function healPastedCreds(
  deps: ProvisionDeps,
  slug: string,
  tenantId: Types.ObjectId,
  intake: ProvisionIntake,
  audit: VaultAuditContext,
): Promise<void> {
  const creds = intake.creds;
  if (!creds) return;
  await healNoRef(deps.vault, tenantId, ATLAS_SA, JSON.stringify(creds.atlas), audit);
  await healNoRef(deps.vault, tenantId, vercelTokenId("active"), creds.vercelActive, audit);
  await healNoRef(deps.vault, tenantId, vercelTokenId("standby"), creds.vercelStandby, audit);
  await healImage(deps, slug, tenantId, creds.image, audit);
}

/** Mint the app-level secrets (auth, health-stats) once; identical across
 *  active+standby so JWT sessions survive failover. Idempotent — mint only if absent. */
async function mintAppSecrets(deps: ProvisionDeps, tenantId: Types.ObjectId): Promise<void> {
  const kinds: AppSecretKind[] = ["auth", "healthStats"];
  for (const kind of kinds) {
    const id = appSecretId(kind);
    if (!(await deps.vault.findActiveSecretId(tenantId, id))) {
      await deps.vault.store(tenantId, id, deps.mintSecret(32));
    }
  }
}

/** Never store a raw error that could carry a secret snippet (lastError persists
 *  in the registry + the nightly mongodump). The provider clients already redact,
 *  and writeRuntimeClusterRegistry sanitizes its connect error at source; this
 *  strips any `://user:pass@host` credentials as the final defense-in-depth net.
 *  Exported: the F3.8 hot-add machine (lib/hotadd.ts) shares this single-homed
 *  redacting net for its own `run.lastError` (D6). */
export function safeMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "provision step failed";
  return raw.replace(/(\/\/)[^/@\s:]+:[^/@\s]+@/g, "$1***:***@").slice(0, 500);
}

/**
 * The provisioner entry point. Idempotent + resumable + concurrency-safe. Returns
 * a terminal outcome ('done'), a pause ('pending' — e.g. domain DNS), a lease
 * refusal ('inProgress'), or a no-op ('alreadyDone').
 */
export async function provisionTenant(
  intake: ProvisionIntake,
  audit: VaultAuditContext,
  config: ProvisionConfig,
  hooks: ProvisionHooks,
  overrides?: Partial<ProvisionDeps>,
): Promise<ProvisionResult> {
  assertProvisionableSlug(intake.slug);
  const deps = resolveDeps(overrides);
  const { registry, vault } = deps;
  const runId = deps.mintSecret(16);
  const nowMs = deps.now();

  // ── ensure Tenant + acquire the single-flight lease ──
  let snap = await registry.findBySlug(intake.slug);
  let created = false;
  if (!snap) {
    try {
      snap = await registry.create(intake, runId, new Date(nowMs + LEASE_TTL_MS));
      created = true;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      snap = await registry.findBySlug(intake.slug); // a concurrent first run won the create
    }
  }
  if (!snap) throw new Error("[provisioner] tenant could not be ensured");

  if (!created) {
    // R4: terminal short-circuit BEFORE the key gate. A FULLY-provisioned tenant
    // (step==='done') is a no-op regardless of key AND regardless of admin status —
    // so a matching-key re-submit can never resurrect a suspended/archived/failover
    // tenant back to 'active' (it would run zero steps then activate()).
    if (snap.step === STEP_DONE) {
      return { status: "alreadyDone", step: STEP_DONE };
    }
    // A half-built tenant is only (re)provisionable from the 'provisioning' state;
    // an admin state (suspended/failover/archived) is not a provisioning input.
    if (snap.status !== "provisioning") {
      throw new Error(`[provisioner] tenant is '${snap.status}', not provisioning — refusing to (re)provision`);
    }
    if (snap.idempotencyKey !== intake.idempotencyKey) {
      throw new Error("[provisioner] idempotencyKey mismatch — refusing to adopt half-built state");
    }
    const acquired = await registry.acquireLease(
      intake.slug,
      intake.idempotencyKey,
      runId,
      new Date(nowMs + LEASE_TTL_MS),
      new Date(nowMs),
    );
    if (!acquired) return { status: "inProgress", step: snap.step ?? "intake" };
  }

  const tenantId = snap._id;

  // Keep the lease alive DURING long provider waits, not only at step boundaries.
  // A single step's pollIdle (up to ~15 min) + stacked 429 backoffs can exceed
  // LEASE_TTL_MS, so a boundary-only renew would let a still-running holder's lease
  // lapse mid-step — after which a concurrent same-key run could legitimately
  // acquire it and interleave db.orders (both PATCH the DB password → the stored
  // SRV / runtime doc can desync from the live Atlas password). Renewing on every
  // provider `sleep` (pollIdle / deploy poll / retry backoff) closes that: a live
  // holder never lapses; a crashed holder stops sleeping → its lease still expires
  // → resume stays possible. (The step-boundary renew below is the backstop.)
  const baseSleep = deps.retryOverrides?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const renewingSleep = async (ms: number) => {
    await baseSleep(ms);
    try {
      await registry.renewLease(intake.slug, runId, new Date(deps.now() + LEASE_TTL_MS));
    } catch {
      /* best-effort — the boundary renew is the backstop */
    }
  };
  const stepRetryOverrides: Partial<RetryDeps> = { ...deps.retryOverrides, sleep: renewingSleep };

  try {
    await healPastedCreds(deps, intake.slug, tenantId, intake, audit);
    await mintAppSecrets(deps, tenantId);
    await writeAudit({ actorId: audit.actorId, action: "tenant.provision", ip: audit.ip, targetTenantId: tenantId });

    let lastStep = snap.step ?? "intake";
    for (const step of stepsAfter(snap.step)) {
      // Renew the lease at each boundary (backstop for steps with no provider wait).
      await registry.renewLease(intake.slug, runId, new Date(deps.now() + LEASE_TTL_MS));
      const fresh = (await registry.findBySlug(intake.slug)) as TenantSnapshot;
      const ctx: StepContext = {
        tenantId,
        intake,
        config,
        audit,
        registry,
        vault,
        hooks,
        snapshot: fresh,
        mintSecret: deps.mintSecret,
        overrides: stepRetryOverrides,
      };
      const result = await STEP_FNS[step](ctx);
      if (result && "pending" in result) {
        return { status: "pending", step: lastStep, pending: result.pending };
      }
      await registry.saveStep(intake.slug, step);
      lastStep = step;
    }

    await registry.activate(intake.slug);
    return { status: "done", step: STEP_DONE };
  } catch (err) {
    await registry.saveError(intake.slug, safeMessage(err));
    throw err;
  } finally {
    await registry.releaseLease(intake.slug, runId);
  }
}
