import type { Types } from "mongoose";

import { createAtlasClient } from "@/lib/atlas";
import { createVercelClient, type VercelClient, type VercelDeployment } from "@/lib/vercel";
import { validateCloudinary, validateR2 } from "@/lib/imagestore";
import { resolveRetryDeps, type RetryDeps } from "@/lib/provider-retry";
import type { VaultAuditContext } from "@/lib/vault";
import type { RegistryPort, TenantSnapshot, VaultPort } from "@/lib/provisioner-registry";
import {
  APP_DB_NAME,
  ATLAS_SA,
  atlasClusterName,
  atlasProjectName,
  appSecretId,
  buildClusterRegistryDoc,
  buildCoreMirror,
  buildOrdersLedgerEntry,
  buildTenantEnv,
  DB_USERNAME,
  dbUriId,
  domainFor,
  imageSecretId,
  vercelProjectName,
  vercelTokenId,
  type AtlasSaCreds,
  type DbRole,
  type HostRole,
  type ImageStore,
  type ProvisionConfig,
  type ProvisionIntake,
  type TenantEnvInput,
} from "@/lib/provisioner-plan";

// ─────────────────────────────────────────────────────────────────────────────
// F3.6 — the eight PROVISION-NEW-TENANT step bodies + their shared helpers. Each
// step is check-then-create so a re-run after a mid-step crash ADOPTS what a prior
// run created (createProject 409→byName / getProject-first, createM0 create-or-
// leave, createDbUser 409→PATCH, addDomain-then-verify adoption). The machine
// (lib/provisioner.ts) owns the order, the lease, the heal, and activation.
//
// Credentials are revealed JIT from the vault (audited, §2 dec 5), held only for
// the one provider call, never persisted anywhere but the tenant's Vercel env.
//
// No-console gate: SRV URIs, tokens, and env values flow through here.
// ─────────────────────────────────────────────────────────────────────────────

/** Deploy poll: 15s × 60 = 15 min, matching Atlas pollIdle — a cold monorepo
 *  Next.js build must not be aborted just-before-ready (R11). */
const DEPLOY_POLL_INTERVAL_MS = 15_000;
const DEPLOY_POLL_MAX_ATTEMPTS = 60;
const M0_CAPACITY_BYTES = 536_870_912;

/** A step either advances (void) or PAUSES the machine without error/advance
 *  ({pending}) — the domain step's "waiting on the owner's DNS" outcome. */
export interface PendingInfo {
  reason: string;
  domainChallenges?: { type: string; domain: string; value: string }[];
}
export type StepResult = void | { pending: PendingInfo };

/** Seed/invite are injectable hooks — their real impls are F3.13/F3.12. */
export interface SeedContext {
  slug: string;
  tenantId: Types.ObjectId;
  ownerEmail: string;
  businessType: string;
  deployUrl?: string;
  domain?: string;
  /** JIT-reveal any stored secret (audited) — e.g. the admin token /api/seed checks. */
  reveal: (id: Parameters<VaultPort["reveal"]>[1]) => Promise<string>;
}
export type InviteContext = SeedContext;

export interface ProvisionHooks {
  runSeed: (ctx: SeedContext) => Promise<void>;
  sendInvite: (ctx: InviteContext) => Promise<void>;
}

export interface StepContext {
  tenantId: Types.ObjectId;
  intake: ProvisionIntake;
  config: ProvisionConfig;
  audit: VaultAuditContext;
  registry: RegistryPort;
  vault: VaultPort;
  hooks: ProvisionHooks;
  /** The committed Tenant state at the START of this step (machine re-reads it). */
  snapshot: TenantSnapshot;
  /** Fresh random hex (DB passwords, app secrets) — injectable for the live leg. */
  mintSecret: (bytes?: number) => string;
  /** Test seam: fake fetch/sleep/clock for the F3.5 provider clients. */
  overrides?: Partial<RetryDeps>;
}

// ── shared: Atlas creds from the vault ───────────────────────────────────────
async function atlasCreds(ctx: StepContext): Promise<AtlasSaCreds> {
  const json = await ctx.vault.reveal(ctx.tenantId, ATLAS_SA, ctx.audit);
  // NEVER let a raw JSON.parse error propagate — Node's parse messages can embed
  // a snippet of the input, which here is the SA secret. Wrap it opaquely.
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("[provisioner] stored Atlas SA credential is not valid JSON");
  }
  const c = parsed as Partial<AtlasSaCreds>;
  if (!c.clientId || !c.clientSecret || !c.orgId) {
    throw new Error("[provisioner] stored Atlas SA credential is missing clientId/clientSecret/orgId");
  }
  return { clientId: c.clientId, clientSecret: c.clientSecret, orgId: c.orgId };
}

// ── db.primary / db.orders (parametrized) ────────────────────────────────────
async function ensureDbCluster(ctx: StepContext, role: DbRole): Promise<void> {
  const creds = await atlasCreds(ctx);
  const atlas = createAtlasClient(creds, ctx.overrides);
  const projectName = atlasProjectName(ctx.intake.slug, role);
  const clusterName = atlasClusterName(role);

  // KEY (dec 4): createProject uses the ORG-scoped Project-Creator SA — the ONLY
  // org-level call. 409 → adopt byName (resume).
  const projectId = await atlas.createProject(projectName);
  // KEY (dec 4): in-project ops act as the SAME SA, auto-granted Project Owner on
  // the projects it creates (documented Atlas behavior) — i.e. project-scoped.
  await atlas.createM0(projectId, clusterName); // create-or-leave (M0 unpatchable)
  await atlas.pollIdle(projectId, clusterName);
  // A fresh password EVERY run; 409 → PATCH-reset so the URI we store carries a
  // password THIS run owns. The runtime doc is reconciled to match (R1).
  const password = ctx.mintSecret(24);
  const user = { username: DB_USERNAME, password, dbName: APP_DB_NAME };
  await atlas.createDbUser(projectId, user);
  await atlas.addAccessList(projectId);
  const srv = await atlas.getSrvUri(projectId, clusterName, user);

  // Store fresh, THEN revoke old (never a no-active-secret window — R3/R6).
  const newId = await ctx.vault.store(ctx.tenantId, dbUriId(role), srv, `project:${projectId}`);
  await ctx.vault.revokeOthers(ctx.tenantId, dbUriId(role), newId);
  await ctx.registry.upsertDbCluster(ctx.intake.slug, {
    provider: "atlas",
    accountLabel: "atlas-1",
    orgId: creds.orgId,
    projectId,
    clusterName,
    srvUriRef: newId,
    role: role === "primary" ? "primary" : "orders-current",
    capacityBytes: M0_CAPACITY_BYTES,
    state: "idle",
  });
}

export const stepDbPrimary = (ctx: StepContext): Promise<StepResult> => ensureDbCluster(ctx, "primary");

export async function stepDbOrders(ctx: StepContext): Promise<StepResult> {
  await ensureDbCluster(ctx, "orders");

  // Routing + the runtime CORE clusterRegistry doc: day-one orders must land on
  // the orders cluster, not bootstrap-CORE. The cafe reads ledger URIs ONLY from
  // this doc, so it is reconciled to the freshly-minted password on every run (R1).
  const coreCluster = atlasClusterName("primary");
  const ordersCluster = atlasClusterName("orders");
  const primarySrv = await ctx.vault.reveal(ctx.tenantId, dbUriId("primary"), ctx.audit);
  const ordersSrv = await ctx.vault.reveal(ctx.tenantId, dbUriId("orders"), ctx.audit);

  await ctx.registry.setRouting(ctx.intake.slug, {
    reference: "primary",
    counters: "primary",
    orders: "orders-current",
    // Hub-side informational mirror (the runtime reads the DOC, not this).
    orderWindows: [{ clusterName: ordersCluster, fromDate: new Date(), toDate: null }],
  });

  const doc = buildClusterRegistryDoc(
    buildOrdersLedgerEntry(ordersCluster, ordersSrv),
    buildCoreMirror(coreCluster, primarySrv),
  );
  await ctx.registry.writeRuntimeClusterRegistry(primarySrv, doc);
}

// ── image (validate the pasted cloud; the pool entry is written by the heal) ──
export async function stepImage(ctx: StepContext): Promise<StepResult> {
  const pool = ctx.snapshot.imagePool.find((p) => p.role === "active");
  if (!pool) {
    // The heal writes the pool entry before the loop. If a FIRST run crashed
    // mid-heal (after some creds stored, before the image pool), a plain creds-less
    // resume can't reconstruct the non-secret image config (store/cloudName/bucket
    // live only on the pool entry, not the vault) — so surface an actionable,
    // resumable error: re-running WITH creds re-runs the (idempotent) heal.
    throw new Error(
      "[provisioner] image pool not initialized — re-run provisioning WITH creds to complete the image paste",
    );
  }
  const store = pool.provider as ImageStore;
  const apiKey = await ctx.vault.reveal(ctx.tenantId, imageSecretId(store, "apiKey"), ctx.audit);
  const apiSecret = await ctx.vault.reveal(ctx.tenantId, imageSecretId(store, "apiSecret"), ctx.audit);

  const result =
    store === "cloudinary"
      ? await validateCloudinary({ cloudName: pool.cloudName ?? "", apiKey, apiSecret }, ctx.overrides)
      : await validateR2(
          { accountId: pool.accountId ?? "", accessKeyId: apiKey, secretAccessKey: apiSecret, bucket: pool.bucket ?? "" },
          ctx.overrides,
        );
  if (!result.ok) throw new Error(`[provisioner] image validation failed: ${result.reason}`);

  await ctx.registry.upsertImagePool(ctx.intake.slug, {
    ...pool,
    usage: result.usage,
    lastUsageAt: new Date(),
  });
}

// ── host.active / host.standby (parametrized) ────────────────────────────────
async function buildEnvInput(ctx: StepContext): Promise<TenantEnvInput> {
  const pool = ctx.snapshot.imagePool.find((p) => p.role === "active");
  if (!pool) throw new Error("[provisioner] host step: image pool not yet recorded");
  const store = pool.provider as ImageStore;
  const [coreSrv, authSecret, healthStatsToken, apiKey, apiSecret] = await Promise.all([
    ctx.vault.reveal(ctx.tenantId, dbUriId("primary"), ctx.audit),
    ctx.vault.reveal(ctx.tenantId, appSecretId("auth"), ctx.audit),
    ctx.vault.reveal(ctx.tenantId, appSecretId("healthStats"), ctx.audit),
    ctx.vault.reveal(ctx.tenantId, imageSecretId(store, "apiKey"), ctx.audit),
    ctx.vault.reveal(ctx.tenantId, imageSecretId(store, "apiSecret"), ctx.audit),
  ]);
  const image =
    store === "cloudinary"
      ? { store: "cloudinary" as const, cloudName: pool.cloudName ?? "", apiKey, apiSecret }
      : {
          store: "r2" as const,
          accountId: pool.accountId ?? "",
          accessKeyId: apiKey,
          secretAccessKey: apiSecret,
          bucket: pool.bucket ?? "",
          publicBaseUrl: pool.publicBaseUrl ?? "",
        };
  return {
    slug: ctx.intake.slug,
    rootDomain: ctx.config.rootDomain,
    coreSrv,
    authSecret,
    healthStatsToken,
    image,
  };
}

async function pollDeployment(
  vercel: VercelClient,
  deployment: VercelDeployment,
  sleep: (ms: number) => Promise<void>,
): Promise<string> {
  let current = deployment;
  for (let attempt = 0; attempt < DEPLOY_POLL_MAX_ATTEMPTS; attempt += 1) {
    if (current.readyState === "READY") return current.url ?? "";
    if (current.readyState === "ERROR" || current.readyState === "CANCELED") {
      throw new Error(`[provisioner] deployment ${current.id} ${current.readyState} — resumable`);
    }
    await sleep(DEPLOY_POLL_INTERVAL_MS);
    current = await vercel.deploymentStatus(current.id);
  }
  throw new Error(`[provisioner] deployment ${current.id} not READY after ${DEPLOY_POLL_MAX_ATTEMPTS} polls — resumable`);
}

async function ensureHost(ctx: StepContext, role: HostRole): Promise<void> {
  const accountLabel = role === "active" ? "vercel-1" : "vercel-2";
  // Fully-done resume short-circuit: a recorded deployUrl means this host is up.
  const existing = ctx.snapshot.hosting.find((h) => h.accountLabel === accountLabel);
  if (existing?.deployUrl) return;

  const token = await ctx.vault.reveal(ctx.tenantId, vercelTokenId(role), ctx.audit);
  const vercel = createVercelClient({ token }, ctx.overrides);
  const name = vercelProjectName(ctx.intake.slug);

  // check-then-create (resume): adopt an existing project instead of a name-clash throw.
  let project = await vercel.getProject(name);
  if (!project) {
    project = await vercel.createProject(name, {
      ...(ctx.config.deploySource.rootDirectory ? { rootDirectory: ctx.config.deploySource.rootDirectory } : {}),
      ...(ctx.config.deploySource.repo ? { gitRepository: { type: "github", repo: ctx.config.deploySource.repo } } : {}),
    });
  }
  // Record the project id BEFORE env/deploy so a crash between create and record
  // resumes by adoption (getProject).
  await ctx.registry.upsertHosting(ctx.intake.slug, {
    provider: "vercel",
    accountLabel,
    projectId: project.id,
    role: role === "active" ? "active" : "standby",
  });

  await vercel.upsertEnv(project.id, buildTenantEnv(await buildEnvInput(ctx)));

  const deployment = await vercel.deploy({
    name,
    project: project.id,
    target: "production",
    gitSource: { type: "github", repoId: ctx.config.deploySource.repoId, ref: ctx.config.deploySource.ref },
  });
  const deps = resolveRetryDeps(ctx.overrides);
  const url = await pollDeployment(vercel, deployment, deps.sleep);

  await ctx.registry.upsertHosting(ctx.intake.slug, {
    provider: "vercel",
    accountLabel,
    projectId: project.id,
    deployUrl: url,
    role: role === "active" ? "active" : "standby",
  });
}

export const stepHostActive = (ctx: StepContext): Promise<StepResult> => ensureHost(ctx, "active");
export const stepHostStandby = (ctx: StepContext): Promise<StepResult> => ensureHost(ctx, "standby");

// ── domain (R2: required; R9: no HTTP-400 string-match) ──────────────────────
export async function stepDomain(ctx: StepContext): Promise<StepResult> {
  const active = ctx.snapshot.hosting.find((h) => h.role === "active");
  if (!active?.projectId) throw new Error("[provisioner] domain step: no active hosting project");
  const token = await ctx.vault.reveal(ctx.tenantId, vercelTokenId("active"), ctx.audit);
  const vercel = createVercelClient({ token }, ctx.overrides);
  const domain = domainFor(ctx.intake.slug, ctx.config.rootDomain);
  const projectId = active.projectId;

  // check-then-create WITHOUT a status-string heuristic: try addDomain; on any
  // error read the state back with verifyDomain — if that succeeds the domain is
  // already on the project (a resume), else the original error is genuine.
  let status;
  try {
    status = await vercel.addDomain(projectId, domain);
  } catch (addErr) {
    try {
      status = await vercel.verifyDomain(projectId, domain);
    } catch {
      throw addErr;
    }
  }
  if (!status.verified) status = await vercel.verifyDomain(projectId, domain);

  if (status.verified) {
    await ctx.registry.setDomain(ctx.intake.slug, { primary: domain, dnsMode: "cname", sslState: "issued" });
    return;
  }
  // Not verified: record 'pending' and PAUSE (never advance to seed/invite while
  // the only reachable host is an unresolvable bare *.vercel.app — R2). The owner
  // sets the CNAME and re-runs; the challenge values are returned to the caller.
  await ctx.registry.setDomain(ctx.intake.slug, { primary: domain, dnsMode: "cname", sslState: "pending" });
  return { pending: { reason: "domain DNS not yet verified", domainChallenges: status.verification } };
}

// ── seed / invite (F3.13 / F3.12 hooks) ──────────────────────────────────────
function hookContext(ctx: StepContext): SeedContext {
  const active = ctx.snapshot.hosting.find((h) => h.role === "active");
  return {
    slug: ctx.intake.slug,
    tenantId: ctx.tenantId,
    ownerEmail: ctx.intake.ownerEmail,
    businessType: ctx.intake.businessType,
    ...(active?.deployUrl ? { deployUrl: active.deployUrl } : {}),
    ...(ctx.snapshot.domain?.primary ? { domain: ctx.snapshot.domain.primary } : {}),
    reveal: (id) => ctx.vault.reveal(ctx.tenantId, id, ctx.audit),
  };
}

export async function stepSeed(ctx: StepContext): Promise<StepResult> {
  await ctx.hooks.runSeed(hookContext(ctx));
}
export async function stepInvite(ctx: StepContext): Promise<StepResult> {
  await ctx.hooks.sendInvite(hookContext(ctx));
}
