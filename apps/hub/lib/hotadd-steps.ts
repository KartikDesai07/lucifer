import { Types } from "mongoose";

import { cafeDateString } from "@pos/shared/utils";
import { createAtlasClient } from "@/lib/atlas";
import type { RetryDeps } from "@/lib/provider-retry";
import { VaultError, type VaultAuditContext } from "@/lib/vault";
import type { VaultPort } from "@/lib/provisioner-registry";
import { ATLAS_SA, APP_DB_NAME, DB_USERNAME, atlasClusterName, dbUriId, type AtlasSaCreds } from "@/lib/provisioner-plan";
import type { HotAddTaskPort, HubTenantPort, RuntimeDocPort } from "@/lib/hotadd-ports";
import {
  alreadyFlipped, buildBootstrapRegistryDoc, buildHotAddFlipUpdate, buildOrderWindows,
  desiredDbPoolRoles, flipBlocked, ledgerUriId, type StoredRuntimeRegistryDoc,
} from "@/lib/hotadd-plan";
import type { ITaskRunTarget } from "@/models/Task";
import type { IDbCluster } from "@/models/Tenant";

// ─────────────────────────────────────────────────────────────────────────────
// F3.8 — the HOT-ADD-DB-CLUSTER step BODIES (the provisioner-steps.ts precedent):
// cluster (mint/promote), flip (bootstrap-insert or the CAS whole-ledgers `$set`),
// registry (A6 reconcile-from-doc), plus their shared reveal helpers. lib/hotadd.ts
// owns the machine LOOP (claim, lease, budget, dispatch, close, dismiss) and
// imports these — it is the ONLY caller.
// No-console gate: SRV URIs + the Atlas SA flow through here.
// ─────────────────────────────────────────────────────────────────────────────

const HOTADD_M0_CAPACITY_BYTES = 536_870_912;

/** A lease-fenced write returned false mid-pump (A4) — the machine stops
 *  immediately with 'lost-lease', no `run.lastError` persisted. */
export class LostLease extends Error {}

/** The per-step collaborators the machine loop assembles once per pump. */
export interface StepCtx {
  taskId: string;
  runId: string;
  target: ITaskRunTarget;
  tenantId: Types.ObjectId;
  slug: string;
  auditCtx: VaultAuditContext;
  vault: VaultPort;
  docPort: RuntimeDocPort;
  tenants: HubTenantPort;
  taskPort: HotAddTaskPort;
  mintSecret: (bytes?: number) => string;
  retryOverrides: Partial<RetryDeps>;
  checkBudget: () => void;
  now: () => number;
}

/** dbUriId('primary') absent ⇒ a manually-onboarded tenant with no CORE SRV in
 *  the vault yet — actionable, names the manual paste flow (F3.9+ scope). */
export async function revealPrimarySrv(vault: VaultPort, tenantId: Types.ObjectId, audit: VaultAuditContext): Promise<string> {
  try {
    return await vault.reveal(tenantId, dbUriId("primary"), audit);
  } catch (err) {
    if (err instanceof VaultError) {
      throw new Error("[hotadd] no primary SRV on file for this tenant — onboard it via the manual paste-and-Connect flow first");
    }
    throw err;
  }
}

/** Mirror of provisioner-steps.atlasCreds (not exported there): never let a raw
 *  JSON.parse error propagate — it can embed the SA secret. */
async function revealAtlasCreds(vault: VaultPort, tenantId: Types.ObjectId, audit: VaultAuditContext): Promise<AtlasSaCreds> {
  const json = await vault.reveal(tenantId, ATLAS_SA, audit);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("[hotadd] stored Atlas SA credential is not valid JSON");
  }
  const c = parsed as Partial<AtlasSaCreds>;
  if (!c.clientId || !c.clientSecret || !c.orgId) {
    throw new Error("[hotadd] stored Atlas SA credential is missing clientId/clientSecret/orgId");
  }
  return { clientId: c.clientId, clientSecret: c.clientSecret, orgId: c.orgId };
}

/** A6 — reconcile-from-doc: shared by the registry step below AND hotadd.ts's
 *  already-rolled terminal path (`target` undefined there — no run of ours
 *  minted anything, so the Atlas reveal below never fires). */
export async function reconcileFromDoc(
  tenants: HubTenantPort,
  vault: VaultPort,
  tenantId: Types.ObjectId,
  slug: string,
  doc: StoredRuntimeRegistryDoc,
  target: ITaskRunTarget | undefined,
  auditCtx: VaultAuditContext,
): Promise<void> {
  const tenant = await tenants.findTenant(slug);
  const known = new Set((tenant?.dbPool ?? []).map((d) => d.clusterName));
  for (const row of desiredDbPoolRoles(doc.ledgers)) {
    if (known.has(row.clusterId)) {
      await tenants.setDbClusterRole(slug, row.clusterId, row.role);
      continue;
    }
    const isTarget = target !== undefined && row.clusterId === target.clusterId;
    const srvUriRef = await vault.findActiveSecretId(tenantId, ledgerUriId(row.clusterId));
    const entry: IDbCluster = {
      provider: "atlas",
      accountLabel: isTarget ? (target!.mode === "mint" ? "atlas-1" : "pasted-standby") : "runtime-doc",
      clusterName: row.clusterId,
      role: row.role,
      capacityBytes: HOTADD_M0_CAPACITY_BYTES,
      state: "idle",
      ...(srvUriRef ? { srvUriRef } : {}),
    };
    if (isTarget && target!.mode === "mint" && target!.projectId) {
      const creds = await revealAtlasCreds(vault, tenantId, auditCtx);
      entry.orgId = creds.orgId;
      entry.projectId = target!.projectId;
    }
    await tenants.upsertDbCluster(slug, entry);
  }
  await tenants.setRouting(slug, {
    reference: "primary",
    counters: "primary",
    orders: "orders-current",
    orderWindows: buildOrderWindows(doc.ledgers),
  });
}

export type ClusterOutcome = { kind: "advance" } | { kind: "creating" };

/** D4 'cluster' step: mint (createProject[A3: skip once stamped]→createM0[R2:
 *  skip once stamped]→ONE getCluster→createDbUser→addAccessList→getSrvUri→
 *  vault store+revokeOthers) or promote (A7b: no-revoke store, refuse on a
 *  secret-identity collision). */
export async function runClusterStep(ctx: StepCtx): Promise<ClusterOutcome> {
  const { target, vault, tenantId, auditCtx } = ctx;
  if (target.mode === "mint") {
    const creds = await revealAtlasCreds(vault, tenantId, auditCtx);
    const atlas = createAtlasClient(creds, ctx.retryOverrides);
    let projectId = target.projectId;
    if (!projectId) {
      if (!target.projectName) throw new Error("[hotadd] mint target missing projectName");
      projectId = await atlas.createProject(target.projectName);
      if (!(await ctx.taskPort.stampProjectId(ctx.taskId, ctx.runId, projectId))) throw new LostLease();
      target.projectId = projectId; // R5: in-memory too — a single-pump run's registry step needs it
    }
    ctx.checkBudget();
    if (!target.m0Created) {
      // R2: create-M0 exactly once — re-calling it every pump silently
      // re-creates a cluster deleted externally, masking the 404 branch below.
      await atlas.createM0(projectId, target.clusterId);
      if (!(await ctx.taskPort.stampM0Created(ctx.taskId, ctx.runId))) throw new LostLease();
      target.m0Created = true;
    }
    const cluster = await atlas.getCluster(projectId, target.clusterId);
    if (!cluster) {
      throw new Error(`[hotadd] cluster ${target.clusterId} not found after create — deleted externally? inspect Atlas project ${projectId}`);
    }
    if (cluster.stateName !== "IDLE") return { kind: "creating" };
    ctx.checkBudget();
    const user = { username: DB_USERNAME, password: ctx.mintSecret(24), dbName: APP_DB_NAME };
    await atlas.createDbUser(projectId, user);
    await atlas.addAccessList(projectId);
    const srv = await atlas.getSrvUri(projectId, target.clusterId, user);
    const newId = await vault.store(tenantId, ledgerUriId(target.clusterId), srv, `project:${projectId}`);
    await vault.revokeOthers(tenantId, ledgerUriId(target.clusterId), newId);
    return { kind: "advance" };
  }

  // promote: the standby row must still exist; an id already holding a DIFFERENT
  // active secret is refused (A7b — never silently adopt another URI).
  const primarySrv = await revealPrimarySrv(vault, tenantId, auditCtx);
  const doc = await ctx.docPort.readDoc(primarySrv);
  const standbyRow = doc?.standby?.find((s) => s.id === target.standbyId);
  if (!standbyRow) throw new Error(`[hotadd] standby '${target.standbyId}' no longer present in the runtime doc — raced`);
  const id = ledgerUriId(target.standbyId as string);
  const existingId = await vault.findActiveSecretId(tenantId, id);
  if (!existingId) {
    await vault.store(tenantId, id, standbyRow.uri);
  } else if ((await vault.reveal(tenantId, id, auditCtx)) !== standbyRow.uri) {
    throw new Error(`[hotadd] secret identity collision for standby '${target.standbyId}' — resolve in the vault before promoting`);
  }
  return { kind: "advance" };
}

/** D4 'flip' step: bootstrap-insert or the CAS `$set`-whole-ledgers flip
 *  (buildHotAddFlipUpdate); validate-before-activate via ping; idempotent on
 *  crash-after-write (alreadyFlipped), actionable on a concurrent roll (flipBlocked). */
export async function runFlipStep(ctx: StepCtx): Promise<void> {
  const { target, vault, docPort, tenantId, auditCtx } = ctx;
  const primarySrv = await revealPrimarySrv(vault, tenantId, auditCtx);
  ctx.checkBudget();
  let doc = await docPort.readDoc(primarySrv);
  const nowDate = new Date(ctx.now());
  const todayIst = cafeDateString(nowDate);
  const tomorrowIst = cafeDateString(new Date(nowDate.getTime() + 86_400_000));
  const mintUri = () => vault.reveal(tenantId, ledgerUriId(target.clusterId), auditCtx);
  if (doc === null) {
    const bootUri = await mintUri();
    ctx.checkBudget();
    await docPort.ping(bootUri);
    ctx.checkBudget();
    const ins = await docPort.insertDoc(
      primarySrv,
      buildBootstrapRegistryDoc(primarySrv, target, bootUri, todayIst, tomorrowIst, atlasClusterName("primary")),
    );
    if (ins !== "exists") return; // freshly inserted — flip complete
    ctx.checkBudget();
    doc = await docPort.readDoc(primarySrv);
    if (doc === null) throw new Error("[hotadd] runtime doc vanished after a concurrent insert — raced");
  }
  if (alreadyFlipped(doc, target)) return;
  const blocked = flipBlocked(doc, target);
  if (blocked) throw new Error(`[hotadd] ${blocked}`);

  const targetUri = target.mode === "promote" ? doc.standby?.find((s) => s.id === target.standbyId)?.uri : await mintUri();
  if (!targetUri) throw new Error(`[hotadd] standby '${target.standbyId}' missing its stored uri — raced`);
  ctx.checkBudget();
  await docPort.ping(targetUri);
  ctx.checkBudget();
  const matched = await docPort.applyUpdate(primarySrv, buildHotAddFlipUpdate(doc, target, targetUri, todayIst, tomorrowIst));
  if (matched === 0) {
    ctx.checkBudget();
    const reread = await docPort.readDoc(primarySrv);
    if (!reread || !alreadyFlipped(reread, target)) throw new Error("[hotadd] flip raced — re-run");
  }
}

/** D4/A6 'registry' step: reconcile Hub bookkeeping from the POST-flip doc. */
export async function runRegistryStep(ctx: StepCtx): Promise<void> {
  ctx.checkBudget();
  const primarySrv = await revealPrimarySrv(ctx.vault, ctx.tenantId, ctx.auditCtx);
  ctx.checkBudget();
  const doc = await ctx.docPort.readDoc(primarySrv);
  if (!doc) throw new Error("[hotadd] runtime doc missing at the registry step — flip did not persist");
  await reconcileFromDoc(ctx.tenants, ctx.vault, ctx.tenantId, ctx.slug, doc, ctx.target, ctx.auditCtx);
}
