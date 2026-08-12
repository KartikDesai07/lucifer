import {
  buildCoreMirror,
  CLUSTER_REGISTRY_ID,
  CORE_TAG,
  sealDocUri,
  type SecretIdentityKey,
} from "@/lib/provisioner-plan";
import type { ITaskPayload, ITaskRunTarget } from "@/models/Task";

// ─────────────────────────────────────────────────────────────────────────────
// F3.8 — the PURE half of the HOT-ADD-DB-CLUSTER state machine (F3.6
// provisioner-plan / plan-IO split precedent): step order, tag-mint + name
// mirrors of the cafe A-series (`ledger-scale-plan.ts`), ledger-secret
// identity, runtime-doc row shapes, the mint-vs-promote planner, flip
// idempotency/race classifiers, and bootstrap/flip/reconcile doc builders.
// NO IO — `lib/hotadd-ports.ts` owns the ports, `lib/hotadd.ts` the pump loop.
// Parity-pin: cannot import across the cafe/hub boundary, so the tag-mint/
// standby-tag rules + row shapes are hand-mirrored from the cafe
// `ledger-scale-plan.ts`/`cluster-router.ts`; a parity test (slice E, the
// provisioner-plan.test.ts readFileSync precedent) pins them.
// Amendment refs (f38-hotadd-design.md "ARBITRATED AMENDMENTS v2" — supersede
// the matching D-clause): A1 approvedBy auth, A2 pump budget/HotAddBusy, A4
// 90s lease, A5 close CAS, A6 reconcile-from-doc, A7 promote hardening, A8
// redaction parity, A9 dismiss gating, A10 audit volume.
// ─────────────────────────────────────────────────────────────────────────────

// ── Step machine (mirrors provisioner-plan's stepsAfter semantics) ──────────
export const HOTADD_STEP_ORDER = ["target", "cluster", "flip", "registry"] as const;
export type HotAddStepName = (typeof HOTADD_STEP_ORDER)[number];
export const HOTADD_STEP_DONE = "done";
/** Steps still to run after `last` completed. Unset/unknown ⇒ all; done ⇒ none. */
export function hotAddStepsAfter(last: string | undefined): HotAddStepName[] {
  if (last === HOTADD_STEP_DONE) return [];
  const idx = HOTADD_STEP_ORDER.indexOf(last as HotAddStepName);
  return HOTADD_STEP_ORDER.slice(idx + 1);
}

// ── Budget / lease constants (A2/A4) ─────────────────────────────────────────
/** Hard pump deadline (A2: ≈2 Atlas calls + 1–2 dials, inside the <8s rule). */
export const HOTADD_PUMP_BUDGET_MS = 6_000;
/** In-route 429 retry cap: beyond this the caller returns 'busy' (A2). */
export const HOTADD_RETRY_AFTER_CAP_MS = 2_000;
/** Task-doc CAS lease TTL (A4): a killed pump locks the task for ≤90s. */
export const HOTADD_LEASE_TTL_MS = 90_000;
/** Runtime-doc/ping dial timeout — pump-local, shorter than the F3.6 15s factory. */
export const HOTADD_DIAL_TIMEOUT_MS = 5_000;
/** Panel auto-re-pump cadence while 'creating' (A2, not 20s). */
export const HOTADD_REPUMP_HINT_S = 30;
/** Thrown by the machine's deadline-aware sleep when a Retry-After would blow the pump budget — the 'busy' outcome (A2). */
export class HotAddBusy extends Error {
  waitMs: number;
  constructor(waitMs: number) {
    super(`[hotadd] Retry-After ${waitMs}ms would exceed the pump budget — resumable as 'busy'`);
    this.name = "HotAddBusy";
    this.waitMs = waitMs;
  }
}

// ── Tag mint mirrors (cafe ledger-scale-plan.ts A-series) ───────────────────
/** Mirror of the cafe `nextLedgerTag`: 'A' when unseen, else `A<max+1>`. */
export function nextLedgerTagMirror(existingTags: string[]): string {
  let max = 0;
  for (const t of existingTags) {
    const m = /^A(\d*)$/.exec(t);
    if (m) max = Math.max(max, m[1] ? parseInt(m[1], 10) : 1);
  }
  return max === 0 ? "A" : `A${max + 1}`;
}
/** Mint a fresh tag over a doc's ledger ∪ standby tags. */
export function mintTagForDoc(ledgerTags: string[], standbyTags: string[]): string {
  return nextLedgerTagMirror([...ledgerTags, ...standbyTags]);
}

const MINT_TAG_COLLISION_MAX_ATTEMPTS = 50;
/** R10: re-mint the next A-series tag when it'd collide with an existing doc
 *  ledger id, standby id, or dbPool clusterName — else a corrupt doc could
 *  re-mint 'A' → 'pos-orders-a' (the SHIPPED day-one identity) and 409-adopt/
 *  reset the LIVE cluster's secret. Bounded; throws past the cap. */
function mintUncollidedTag(ledgerTags: string[], standbyTags: string[], reserved: Set<string>): string {
  let tags = [...ledgerTags, ...standbyTags];
  for (let attempt = 0; attempt < MINT_TAG_COLLISION_MAX_ATTEMPTS; attempt += 1) {
    const tag = nextLedgerTagMirror(tags);
    if (!reserved.has(hotAddClusterName(tag))) return tag;
    tags = [...tags, tag];
  }
  throw new Error(`[hotadd-plan] could not mint a non-colliding ledger tag after ${MINT_TAG_COLLISION_MAX_ATTEMPTS} attempts — corrupt state`);
}
/** Mirror of the cafe `mintOrValidateStandbyTag` rule: non-empty uppercase-alphanumeric, not CORE_TAG, not already a ledger tag. */
export function isUsableStandbyTag(tag: string, ledgerTags: string[]): boolean {
  return tag.length > 0 && /^[A-Z0-9]+$/.test(tag) && tag !== CORE_TAG && !ledgerTags.includes(tag);
}

// ── Deterministic names (hotAddClusterName("A") ≡ atlasClusterName("orders")) ─
export function hotAddClusterName(tag: string): string {
  return `pos-orders-${tag.toLowerCase()}`;
}
export function hotAddProjectName(slug: string, tag: string): string {
  return `pos-${slug}-orders-${tag.toLowerCase()}`;
}
/** Generalizes `dbUriId`: `ledgerUriId("pos-orders-a") ≡ dbUriId("orders")`. */
export function ledgerUriId(clusterId: string): SecretIdentityKey {
  return { provider: "atlas", accountLabel: `atlas-1/${clusterId}`, classification: "dbUri" };
}

// ── Runtime-doc row shapes (parity-pinned against cafe StoredClusterRegistry) ─
export interface StoredRuntimeLedger {
  id: string;
  uri: string;
  tag: string;
  from?: string | null;
  to?: string | null;
  active?: boolean;
  fillPct?: number;
  sizeBytes?: number;
  paused?: boolean;
}
export interface StoredRuntimeRegistryDoc {
  _id?: string;
  core?: { id: string; uri: string; tag: string };
  ledgers: StoredRuntimeLedger[];
  standby?: Array<{ id: string; uri: string; tag?: string; empty?: boolean }>;
}
/** The single active ledger, or throw (mirror of cafe `activeEntryOf` — never "fix" a corrupt manifest). */
export function activeLedgerOf(doc: StoredRuntimeRegistryDoc): StoredRuntimeLedger {
  const actives = doc.ledgers.filter((l) => l.active === true);
  if (actives.length !== 1) {
    throw new Error(
      `[hotadd-plan] expected exactly one active ledger, found ${actives.length} — refusing to plan against a corrupt manifest`,
    );
  }
  return actives[0];
}
function standbyTagsOf(doc: StoredRuntimeRegistryDoc): string[] {
  return (doc.standby ?? []).flatMap((s) => (s.tag === undefined ? [] : [s.tag]));
}

// ── The mint-vs-promote planner (D4, A7) ─────────────────────────────────────
export type HotAddPlanDecision =
  | { kind: "already-rolled"; reason: string }
  | { kind: "target"; target: ITaskRunTarget; note?: string };

/** Plan the hot-add target from LIVE doc state (payload is a stale hint, never
 *  trusted over the doc — D4); `dbPoolClusterNames` feeds the A7 promote guard. */
export function planHotAdd(
  doc: StoredRuntimeRegistryDoc | null,
  payload: ITaskPayload | undefined,
  dbPoolClusterNames: string[],
  slug: string,
): HotAddPlanDecision {
  if (doc === null) {
    const tag = mintUncollidedTag(["A"], [], new Set(dbPoolClusterNames)); // core-as-ledger already carries 'A'
    return {
      kind: "target",
      target: { mode: "mint", tag, clusterId: hotAddClusterName(tag), projectName: hotAddProjectName(slug, tag), oldActiveId: "core", bootstrap: true },
    };
  }

  const active = activeLedgerOf(doc);
  if (payload?.fillingLedger && active.id !== payload.fillingLedger) {
    return { kind: "already-rolled", reason: `ledger ${payload.fillingLedger} already rolled — active is now ${active.id}` };
  }

  const ledgerTags = doc.ledgers.map((l) => l.tag);
  const standby = doc.standby ?? [];
  const reserved = new Set([...doc.ledgers.map((l) => l.id), ...standby.map((s) => s.id), ...dbPoolClusterNames]);
  if (standby.length > 0) {
    const candidate = standby[0];
    const ledgerIds = doc.ledgers.map((l) => l.id);
    const tagOk = candidate.tag === undefined || isUsableStandbyTag(candidate.tag, ledgerTags);
    const guardOk =
      candidate.id !== "core" && !ledgerIds.includes(candidate.id) && !dbPoolClusterNames.includes(candidate.id) && tagOk;
    if (guardOk) {
      const tag = candidate.tag ?? mintTagForDoc(ledgerTags, standbyTagsOf(doc));
      return { kind: "target", target: { mode: "promote", tag, clusterId: candidate.id, standbyId: candidate.id, oldActiveId: active.id } };
    }
    const mintTag = mintUncollidedTag(ledgerTags, standbyTagsOf(doc), reserved);
    return {
      kind: "target",
      target: { mode: "mint", tag: mintTag, clusterId: hotAddClusterName(mintTag), projectName: hotAddProjectName(slug, mintTag), oldActiveId: active.id },
      note: `standby ${candidate.id} ignored — fails the A7 promote guard (id collision or unusable pre-minted tag)`,
    };
  }

  const mintTag = mintUncollidedTag(ledgerTags, standbyTagsOf(doc), reserved);
  return {
    kind: "target",
    target: { mode: "mint", tag: mintTag, clusterId: hotAddClusterName(mintTag), projectName: hotAddProjectName(slug, mintTag), oldActiveId: active.id },
  };
}

// ── Flip idempotency / race classification (A5/A6, D4 flip) ─────────────────
function flipTargetId(target: ITaskRunTarget): string {
  return target.standbyId ?? target.clusterId;
}
/** Our flip already landed (crash-after-write): a ledger row carries the target's id AND tag. */
export function alreadyFlipped(doc: StoredRuntimeRegistryDoc, target: ITaskRunTarget): boolean {
  const wantId = flipTargetId(target);
  return doc.ledgers.some((l) => l.id === wantId && l.tag === target.tag);
}
/** A concurrent roll won: target tag taken by a DIFFERENT id, or the active ledger moved on. Reason string, or null if safe. */
export function flipBlocked(doc: StoredRuntimeRegistryDoc, target: ITaskRunTarget): string | null {
  const wantId = flipTargetId(target);
  const tagRow = doc.ledgers.find((l) => l.tag === target.tag);
  if (tagRow && tagRow.id !== wantId) {
    return `tag ${target.tag} is already carried by ledger ${tagRow.id} (expected ${wantId}) — a concurrent roll won`;
  }
  const active = activeLedgerOf(doc);
  if (active.id !== target.oldActiveId) {
    return `active ledger changed from ${target.oldActiveId} to ${active.id} — a concurrent roll won`;
  }
  return null;
}

/** The CAS-guarded single-op flip write (mirrors cafe `buildFlipUpdate`): ONE `$set` of the
 *  whole `ledgers` array (+`standby` when promoting); `newLedgerUri` is sealed fresh for a
 *  mint or the standby's own stored uri VERBATIM for a promote; matchedCount 0 = raced. */
export function buildHotAddFlipUpdate(
  doc: StoredRuntimeRegistryDoc,
  target: ITaskRunTarget,
  newLedgerUri: string,
  todayIst: string,
  tomorrowIst: string,
): { filter: Record<string, unknown>; update: Record<string, unknown> } {
  const wantId = flipTargetId(target);
  const newLedgers: StoredRuntimeLedger[] = doc.ledgers.map((l) =>
    l.id === target.oldActiveId ? { ...l, active: false, to: tomorrowIst } : l,
  );
  newLedgers.push({
    id: wantId,
    uri: target.mode === "promote" ? newLedgerUri : sealDocUri(newLedgerUri),
    tag: target.tag,
    from: todayIst,
    to: null,
    active: true,
  });

  const filter: Record<string, unknown> = {
    _id: doc._id ?? CLUSTER_REGISTRY_ID,
    ledgers: { $elemMatch: { id: target.oldActiveId, active: true } },
  };
  const update: Record<string, unknown> = { $set: { ledgers: newLedgers } };
  if (target.mode === "promote") {
    filter["standby.0.id"] = target.standbyId;
    filter["standby"] = { $size: (doc.standby ?? []).length };
    (update.$set as Record<string, unknown>).standby = (doc.standby ?? []).slice(1);
  }
  return { filter, update };
}

/** The FIRST doc, on the absent-doc (bootstrap) path: core doubles as an archived
 *  ledger row (id 'core', tag 'A') so pre-hot-add `ORD-A-…` orders stay routable,
 *  plus the new active ledger — core stays role 'primary', never demoted. */
export function buildBootstrapRegistryDoc(
  coreSrv: string,
  target: ITaskRunTarget,
  newLedgerUri: string,
  todayIst: string,
  tomorrowIst: string,
  coreClusterName: string,
): StoredRuntimeRegistryDoc {
  return {
    _id: CLUSTER_REGISTRY_ID,
    core: buildCoreMirror(coreClusterName, coreSrv),
    ledgers: [
      { id: "core", uri: sealDocUri(coreSrv), tag: "A", from: null, to: tomorrowIst, active: false },
      { id: target.clusterId, uri: sealDocUri(newLedgerUri), tag: target.tag, from: todayIst, to: null, active: true },
    ],
    standby: [],
  };
}

// ── Reconcile builders (A6 — callable from any terminal path) ───────────────
export interface HotAddOrderWindow {
  clusterName: string;
  fromDate: Date;
  toDate: Date | null;
}
/** Rebuild `routing.orderWindows` from the POST-flip doc — runtime-ledger-id keyed, documented NOT dbPool-joinable. */
export function buildOrderWindows(ledgers: StoredRuntimeLedger[]): HotAddOrderWindow[] {
  return ledgers.map((l) => ({
    clusterName: l.id,
    fromDate: l.from ? new Date(l.from) : new Date(0),
    toDate: l.to ? new Date(l.to) : null,
  }));
}

export type HotAddDbPoolRole = "orders-current" | "orders-archive";
export interface DesiredDbPoolRole {
  clusterId: string;
  role: HotAddDbPoolRole;
}
/** Desired dbPool role per non-core ledger row: active → current, else archive. 'core' is SKIPPED (role 'primary', never demoted here). */
export function desiredDbPoolRoles(ledgers: StoredRuntimeLedger[]): DesiredDbPoolRole[] {
  return ledgers
    .filter((l) => l.id !== "core")
    .map((l) => ({ clusterId: l.id, role: l.active === true ? "orders-current" : "orders-archive" }));
}

// HotAddStatus + the R8 refusal-code union moved to hotadd-status.ts (300-line rule).
