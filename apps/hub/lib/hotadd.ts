import { randomBytes } from "node:crypto";
import { Types } from "mongoose";

import { writeAudit } from "@/lib/audit";
import { safeMessage } from "@/lib/provisioner";
import type { RetryDeps } from "@/lib/provider-retry";
import type { VaultAuditContext } from "@/lib/vault";
import { createVaultPort, type VaultPort } from "@/lib/provisioner-registry";
import {
  createHotAddTaskPort, createHubTenantPort, createRuntimeDocPort,
  type HotAddDismissOutcome, type HotAddTaskPort, type HubTenantPort, type RuntimeDocPort,
} from "@/lib/hotadd-ports";
import {
  HOTADD_LEASE_TTL_MS, HOTADD_PUMP_BUDGET_MS, HOTADD_REPUMP_HINT_S, HOTADD_RETRY_AFTER_CAP_MS,
  HOTADD_STEP_DONE, HotAddBusy, hotAddStepsAfter, planHotAdd,
} from "@/lib/hotadd-plan";
import type { HotAddRefusalCode, HotAddStatus } from "@/lib/hotadd-status";
import {
  LostLease, reconcileFromDoc, revealPrimarySrv, runClusterStep, runFlipStep, runRegistryStep,
  type StepCtx,
} from "@/lib/hotadd-steps";
import type { ITaskRunTarget } from "@/models/Task";

// ─────────────────────────────────────────────────────────────────────────────
// F3.8 — the bounded-pump HOT-ADD-DB-CLUSTER machine LOOP (f38-hotadd-design.md
// D1–D14 + ARBITRATED AMENDMENTS v2 A1–A10, which SUPERSEDE the matching
// D-clauses; the provisioner.ts/provisioner-steps.ts split precedent — step
// BODIES live in lib/hotadd-steps.ts). The ROUTE owns auth (`claimAllowed` = a
// fresh step-up verify, A1) — this module is gate-agnostic. One call = one
// bounded pump inside a hard time budget (A2), returning a resumable status;
// the panel re-pumps every ~30s.
// No-console gate: SRV URIs flow through the claim/plan path.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunHotAddInput {
  taskId: string;
  actor: { actorId: string; ip: string };
  /** The route's own auth decision: a FRESH step-up verify, needed only to CLAIM
   *  an 'open' task (A1). Continuation pumps ignore it. */
  claimAllowed: boolean;
}

export interface RunHotAddResult {
  status: HotAddStatus;
  step: string;
  note?: string;
  repumpAfterS?: number;
  /** R8: machine-readable refusal classification — the route maps 403 off
   *  this instead of parsing `note` text. */
  code?: HotAddRefusalCode;
}

/** Injectable machine collaborators (the F3.6 provisioner test seam). */
export interface RunHotAddDeps {
  taskPort: HotAddTaskPort;
  docPort: RuntimeDocPort;
  tenants: HubTenantPort;
  vault: VaultPort;
  mintSecret: (bytes?: number) => string;
  now: () => number;
  retryOverrides?: Partial<RetryDeps>;
}

function resolveDeps(overrides?: Partial<RunHotAddDeps>): RunHotAddDeps {
  return {
    taskPort: overrides?.taskPort ?? createHotAddTaskPort(),
    docPort: overrides?.docPort ?? createRuntimeDocPort(),
    tenants: overrides?.tenants ?? createHubTenantPort(),
    vault: overrides?.vault ?? createVaultPort(),
    mintSecret: overrides?.mintSecret ?? ((bytes = 32) => randomBytes(bytes).toString("hex")),
    now: overrides?.now ?? (() => Date.now()),
    retryOverrides: overrides?.retryOverrides,
  };
}

function refused(step: string, note: string, code?: HotAddRefusalCode): RunHotAddResult {
  return { status: "refused", step, note, ...(code ? { code } : {}) };
}

/** R6(a): a one-line "what got claimed" summary threaded into the claim
 *  pump's result note — owner visibility into mint-vs-promote before the
 *  panel confirms Run. */
function targetSummary(target: ITaskRunTarget): string {
  return target.mode === "promote"
    ? `PROMOTE standby '${target.standbyId}' (tag ${target.tag})`
    : `mint ${target.clusterId} (tag ${target.tag})`;
}

/** The F3.8 machine entry point. Gate-agnostic (A1); bounded (A2: returns
 *  'creating'/'busy' rather than blocking); single-flight per task (A4 lease);
 *  exactly-once close (A5). */
export async function runHotAddDbCluster(input: RunHotAddInput, overrides?: Partial<RunHotAddDeps>): Promise<RunHotAddResult> {
  const deps = resolveDeps(overrides);
  const { taskPort, docPort, tenants, vault, mintSecret, now } = deps;
  // R1: anchored at the very START of the run — the claim path's own
  // reveal/doc-read below now counts against the same budget as the step
  // bodies, instead of getting a fresh 6s window after the claim finishes.
  const deadlineAt = now() + HOTADD_PUMP_BUDGET_MS;

  let task = await taskPort.load(input.taskId);
  if (!task) return refused("target", "task not found");
  if (task.type !== "ADD_DB_CLUSTER") return refused("target", "not an ADD_DB_CLUSTER task");
  if (task.status === "done" || task.status === "dismissed") {
    return { status: "closed-by-other", step: task.run?.step ?? HOTADD_STEP_DONE };
  }
  const tenant = await tenants.findTenant(task.tenantSlug);
  if (!tenant) return refused("target", "tenant not found");
  if (tenant.status !== "active") return refused("target", `tenant is '${tenant.status}', not active`);
  const tenantId = task.tenantId;
  const slug = task.tenantSlug;

  let claimNote: string | undefined;
  if (task.status === "open") {
    if (!input.claimAllowed) return refused("target", "step-up required to start a hot-add", "needs-step-up");
    try {
      const claimAudit: VaultAuditContext = { actorId: input.actor.actorId, ip: input.actor.ip };
      const primarySrv = await revealPrimarySrv(vault, tenantId, claimAudit);
      const doc = await docPort.readDoc(primarySrv);
      const decision = planHotAdd(doc, task.payload, tenant.dbPool.map((d) => d.clusterName), slug);
      if (decision.kind === "already-rolled") {
        if (doc) await reconcileFromDoc(tenants, vault, tenantId, slug, doc, undefined, claimAudit);
        const closed = await taskPort.close(input.taskId, { kind: "unclaimed" });
        return closed ? { status: "already-rolled", step: HOTADD_STEP_DONE } : { status: "closed-by-other", step: HOTADD_STEP_DONE };
      }

      const claimed = await taskPort.claim(input.taskId, decision.target, new Types.ObjectId(input.actor.actorId), new Date(now()));
      if (claimed) {
        await writeAudit({ actorId: input.actor.actorId, action: "tenant.hotAddDbCluster", ip: input.actor.ip, targetTenantId: tenantId });
      }
      // Re-load regardless of who won the claim CAS (A1: continue with whichever
      // target got stamped — re-deriving mid-run risks minting a second cluster).
      const fresh = await taskPort.load(input.taskId);
      if (!fresh) return refused("target", "task disappeared mid-claim");
      task = fresh;
      if (!task.run?.target) return { status: "in-progress", step: task.run?.step ?? "target" };
      claimNote = [targetSummary(task.run.target), decision.note].filter(Boolean).join(" — ");
    } catch (err) {
      // R4: no lease exists yet at this point — the regular lease-fenced
      // saveError can't touch this task, so a pre-claim throw otherwise
      // vanishes silently (the GET route's "check lastError" advice would lie).
      await taskPort.saveErrorUnclaimed(input.taskId, safeMessage(err));
      throw err;
    }
  }

  // R6(a): every result returned from THIS call carries the claim summary +
  // planner note when this pump was the one that claimed the task.
  const finish = (result: RunHotAddResult): RunHotAddResult =>
    claimNote ? { ...result, note: result.note ? `${claimNote} — ${result.note}` : claimNote } : result;

  if (!task.run?.target || !task.run?.approvedBy) return finish(refused(task.run?.step ?? "target", "task lacks an approved claim"));
  const target = task.run.target;
  const auditCtx: VaultAuditContext = { actorId: task.run.approvedBy, ip: input.actor.ip };
  const runId = mintSecret(16);
  const acquired = await taskPort.acquireLease(input.taskId, runId, new Date(now() + HOTADD_LEASE_TTL_MS), new Date(now()));
  if (!acquired) return finish({ status: "in-progress", step: task.run?.step ?? "target", repumpAfterS: HOTADD_REPUMP_HINT_S });

  const baseSleep = deps.retryOverrides?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const budgetSleep = async (ms: number): Promise<void> => {
    if (ms > HOTADD_RETRY_AFTER_CAP_MS || now() + ms > deadlineAt) throw new HotAddBusy(ms);
    await baseSleep(ms);
    try {
      await taskPort.renewLease(input.taskId, runId, new Date(now() + HOTADD_LEASE_TTL_MS));
    } catch {
      /* best-effort — the boundary renew below is the backstop */
    }
  };
  const checkBudget = (): void => {
    if (now() > deadlineAt) throw new HotAddBusy(0);
  };
  const stepCtx: StepCtx = {
    taskId: input.taskId, runId, target, tenantId, slug, auditCtx, vault, docPort, tenants, taskPort,
    mintSecret, retryOverrides: { ...deps.retryOverrides, sleep: budgetSleep }, checkBudget, now,
  };
  let lastStep = task.run?.step ?? "";
  try {
    for (const step of hotAddStepsAfter(task.run?.step)) {
      await taskPort.renewLease(input.taskId, runId, new Date(now() + HOTADD_LEASE_TTL_MS));
      checkBudget();
      if (step === "cluster") {
        const outcome = await runClusterStep(stepCtx);
        if (outcome.kind === "creating") return finish({ status: "creating", step: lastStep, repumpAfterS: HOTADD_REPUMP_HINT_S });
      } else if (step === "flip") {
        await runFlipStep(stepCtx);
      } else if (step === "registry") {
        await runRegistryStep(stepCtx);
      }
      // step === "target": nothing left to do — the claim above already resolved it.

      if (!(await taskPort.saveStep(input.taskId, runId, step))) throw new LostLease();
      lastStep = step;
    }
    const closed = await taskPort.close(input.taskId, { kind: "claimed", runId });
    return finish(closed ? { status: "done", step: HOTADD_STEP_DONE } : { status: "closed-by-other", step: HOTADD_STEP_DONE });
  } catch (err) {
    if (err instanceof HotAddBusy) {
      return finish({ status: "busy", step: lastStep, note: "provider backoff exceeds the pump budget — re-pump", repumpAfterS: HOTADD_REPUMP_HINT_S });
    }
    if (err instanceof LostLease) return finish({ status: "lost-lease", step: lastStep });
    await taskPort.saveError(input.taskId, runId, safeMessage(err));
    throw err;
  } finally {
    await taskPort.releaseLease(input.taskId, runId);
  }
}

/** Thin wrapper over the lease-fenced, step-up-gated dismiss (A9). The ROUTE
 *  writes the `task.dismiss` audit row itself (machine paths write no audit rows). */
export async function dismissHotAddTask(
  taskId: string,
  overrides?: Partial<Pick<RunHotAddDeps, "taskPort" | "now">>,
): Promise<HotAddDismissOutcome> {
  const taskPort = overrides?.taskPort ?? createHotAddTaskPort();
  const now = overrides?.now ?? (() => Date.now());
  return taskPort.dismiss(taskId, new Date(now()));
}
