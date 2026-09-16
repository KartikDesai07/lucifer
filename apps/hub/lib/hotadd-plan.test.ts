import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  alreadyFlipped,
  buildBootstrapRegistryDoc,
  buildHotAddFlipUpdate,
  buildOrderWindows,
  desiredDbPoolRoles,
  flipBlocked,
  hotAddClusterName,
  hotAddStepsAfter,
  isUsableStandbyTag,
  ledgerUriId,
  mintTagForDoc,
  nextLedgerTagMirror,
  planHotAdd,
  type StoredRuntimeLedger,
  type StoredRuntimeRegistryDoc,
} from "./hotadd-plan";
import { atlasClusterName, buildCoreMirror, CORE_TAG, dbUriId } from "./provisioner-plan";
import type { ITaskRunTarget } from "@/models/Task";

// DB-free unit tests for the PURE F3.8 hot-add plan module (slice E) + the
// cross-app contract parity guards against the cafe A-series/flip source.
// hotadd-ports.ts / hotadd-steps.ts / hotadd.ts (the IO half + step bodies +
// pump loop) are NOT exercised here — another agent owns their behavior tests;
// this file only imports `hotadd-plan.ts` (the trailing grep gate below reads
// the others' raw source for a console.* scan, which is not an import).

const TODAY = "2026-08-09T00:00:00.000Z";
const TOMORROW = "2026-08-10T00:00:00.000Z";

function targetOf(decision: ReturnType<typeof planHotAdd>): ITaskRunTarget {
  assert.equal(decision.kind, "target", "expected a target decision, not already-rolled");
  return (decision as { kind: "target"; target: ITaskRunTarget }).target;
}

// ── 1. Tag mint mirror ───────────────────────────────────────────────────────

test("nextLedgerTagMirror: 'A' when unseen, then A2/A3, jumps to A10 after A9, ignores non-A-series tags", () => {
  assert.equal(nextLedgerTagMirror([]), "A");
  assert.equal(nextLedgerTagMirror(["A"]), "A2");
  assert.equal(nextLedgerTagMirror(["A", "A2"]), "A3");
  assert.equal(nextLedgerTagMirror(["A", "A9"]), "A10");
  assert.equal(nextLedgerTagMirror(["C", "B2"]), "A", "non-A-series tags never bump the counter");
});

test("mintTagForDoc unions ledger + standby tags before minting", () => {
  assert.equal(mintTagForDoc(["A"], ["A2"]), "A3");
  assert.equal(mintTagForDoc([], []), "A");
  assert.equal(mintTagForDoc(["A", "A5"], ["A3"]), "A6");
});

test("isUsableStandbyTag: rejects empty/lowercase/CORE/existing-ledger-tag, accepts a fresh tag", () => {
  const ledgerTags = ["A"];
  assert.equal(isUsableStandbyTag("", ledgerTags), false, "empty");
  assert.equal(isUsableStandbyTag("a5", ledgerTags), false, "lowercase");
  assert.equal(isUsableStandbyTag(CORE_TAG, ledgerTags), false, "CORE reserved");
  assert.equal(isUsableStandbyTag("A", ledgerTags), false, "already a ledger tag");
  assert.equal(isUsableStandbyTag("A5", ledgerTags), true, "fresh tag usable");
});

// ── 2. Parity pins against the cafe source ──────────────────────────────────

function cafeSource(rel: string): string {
  return readFileSync(new URL(`../../cafe/lib/${rel}`, import.meta.url), "utf8");
}
function constOf(src: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(src)?.[1];
}

test("PARITY: cafe ledger-scale-plan still carries the A-series regex ^A(\\d*)$ (nextLedgerTagMirror hand-mirror)", () => {
  const src = cafeSource("ledger-scale-plan.ts");
  assert.ok(src.includes("/^A(\\d*)$/"), "A-series regex drift — nextLedgerTagMirror would silently diverge from the cafe mint rule");
});

test("PARITY: cafe ledger-scale-plan still carries the FLIP-DAY overlap markers (to: tomorrowIst / from: todayIst)", () => {
  const src = cafeSource("ledger-scale-plan.ts");
  assert.ok(src.includes("to: tomorrowIst"), "retiring-row 'to' marker drift");
  assert.ok(src.includes("from: todayIst"), "new-row 'from' marker drift");
});

test("PARITY: cafe cluster-router still pins BOOTSTRAP_LEDGER_TAG 'A' and CORE_TAG 'C'", () => {
  const src = cafeSource("cluster-router.ts");
  assert.equal(constOf(src, "BOOTSTRAP_LEDGER_TAG"), "A", "bootstrap tag drift — buildBootstrapRegistryDoc hardcodes 'A' for the core-archived row");
  assert.equal(constOf(src, "CORE_TAG"), "C");
  assert.equal(CORE_TAG, "C", "hub-side CORE_TAG (imported from provisioner-plan) must agree");
});

test("PARITY: hotAddClusterName('A') stays the F3.6 day-one pair (pos-orders-a)", () => {
  assert.equal(hotAddClusterName("A"), atlasClusterName("orders"));
  assert.equal(hotAddClusterName("A"), "pos-orders-a");
});

test("PARITY: ledgerUriId generalizes dbUriId for the day-one orders cluster", () => {
  assert.deepEqual(ledgerUriId("pos-orders-a"), dbUriId("orders"));
});

// ── 3. planHotAdd ─────────────────────────────────────────────────────────────

test("planHotAdd: doc null ⇒ mint+bootstrap, tag A2, oldActiveId 'core'", () => {
  const decision = planHotAdd(null, undefined, [], "acme");
  const target = targetOf(decision);
  assert.deepEqual(target, {
    mode: "mint",
    tag: "A2",
    clusterId: "pos-orders-a2",
    projectName: "pos-acme-orders-a2",
    oldActiveId: "core",
    bootstrap: true,
  });
});

test("planHotAdd: doc active === payload.fillingLedger, no standby ⇒ mint A2, oldActiveId is the live active", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-a", uri: "mongodb+srv://u:p@a/pos", tag: "A", from: null, to: null, active: true }],
    standby: [],
  };
  const decision = planHotAdd(doc, { fillingLedger: "pos-orders-a" }, [], "acme");
  const target = targetOf(decision);
  assert.equal(target.mode, "mint");
  assert.equal(target.tag, "A2");
  assert.equal(target.oldActiveId, "pos-orders-a");
  assert.equal(target.clusterId, "pos-orders-a2");
  assert.equal(target.projectName, "pos-acme-orders-a2");
});

test("planHotAdd: payload.fillingLedger names a DIFFERENT id than the live active ⇒ already-rolled", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-a", uri: "u", tag: "A", from: null, to: null, active: true }],
    standby: [],
  };
  const decision = planHotAdd(doc, { fillingLedger: "pos-orders-zzz" }, [], "acme");
  assert.equal(decision.kind, "already-rolled");
  assert.match((decision as { reason: string }).reason, /already rolled/);
});

test("planHotAdd: valid standby present ⇒ promote consumes standby[0], pre-minted tag used VERBATIM", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-a", uri: "u", tag: "A", from: null, to: null, active: true }],
    standby: [{ id: "pos-orders-b", uri: "standby-uri", tag: "B5" }],
  };
  const decision = planHotAdd(doc, undefined, [], "acme");
  const target = targetOf(decision);
  assert.deepEqual(target, {
    mode: "promote",
    tag: "B5",
    clusterId: "pos-orders-b",
    standbyId: "pos-orders-b",
    oldActiveId: "pos-orders-a",
  });
});

test("planHotAdd: tagless standby ⇒ promote mints a fresh tag", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-a", uri: "u", tag: "A", from: null, to: null, active: true }],
    standby: [{ id: "pos-orders-b", uri: "standby-uri" }],
  };
  const decision = planHotAdd(doc, undefined, [], "acme");
  const target = targetOf(decision);
  assert.deepEqual(target, {
    mode: "promote",
    tag: "A2",
    clusterId: "pos-orders-b",
    standbyId: "pos-orders-b",
    oldActiveId: "pos-orders-a",
  });
});

test("planHotAdd A7 guard: standby.id === 'core' falls back to MINT with a note", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-a", uri: "u", tag: "A", from: null, to: null, active: true }],
    standby: [{ id: "core", uri: "attacker-uri", tag: "B5" }],
  };
  const decision = planHotAdd(doc, undefined, [], "acme");
  const target = targetOf(decision);
  assert.equal(target.mode, "mint");
  assert.equal(target.tag, "A2");
  assert.ok((decision as { note?: string }).note?.includes("standby core ignored"));
});

test("planHotAdd A7 guard: standby.id collides with a doc ledger id falls back to MINT with a note", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-a", uri: "u", tag: "A", from: null, to: null, active: true }],
    standby: [{ id: "pos-orders-a", uri: "attacker-uri", tag: "B5" }],
  };
  const decision = planHotAdd(doc, undefined, [], "acme");
  const target = targetOf(decision);
  assert.equal(target.mode, "mint");
  assert.ok((decision as { note?: string }).note?.includes("standby pos-orders-a ignored"));
});

test("planHotAdd A7 guard: standby.id collides with a dbPool clusterName falls back to MINT with a note", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-a", uri: "u", tag: "A", from: null, to: null, active: true }],
    standby: [{ id: "pos-orders-b", uri: "attacker-uri", tag: "B5" }],
  };
  const decision = planHotAdd(doc, undefined, ["pos-orders-b"], "acme");
  const target = targetOf(decision);
  assert.equal(target.mode, "mint");
  assert.ok((decision as { note?: string }).note?.includes("standby pos-orders-b ignored"));
});

test("planHotAdd A7 guard: unusable pre-minted standby tag (already a ledger tag) falls back to MINT with a note", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-a", uri: "u", tag: "A", from: null, to: null, active: true }],
    standby: [{ id: "pos-orders-b", uri: "standby-uri", tag: "A" }],
  };
  const decision = planHotAdd(doc, undefined, [], "acme");
  const target = targetOf(decision);
  assert.equal(target.mode, "mint");
  assert.equal(target.tag, "A2");
  assert.ok((decision as { note?: string }).note?.includes("standby pos-orders-b ignored"));
});

test("R10a: mint tag collision — ledger tags ['Z'] would naturally mint 'A' but dbPool 'pos-orders-a' collides; the next free tag is chosen", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-z", uri: "u", tag: "Z", from: null, to: null, active: true }],
    standby: [],
  };
  const decision = planHotAdd(doc, undefined, ["pos-orders-a"], "acme");
  const target = targetOf(decision);
  assert.notEqual(target.tag, "A", "R10: 'A' collides with the reserved dbPool clusterName — must not be chosen");
  assert.notEqual(target.clusterId, "pos-orders-a");
  assert.equal(target.tag, "A2");
  assert.equal(target.clusterId, "pos-orders-a2");
});

test("R10b: mint tag collision with a doc ledger id 'pos-orders-a2' skips straight to 'A3'", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [
      { id: "pos-orders-a", uri: "u", tag: "A", from: null, to: null, active: true },
      { id: "pos-orders-a2", uri: "u2", tag: "Z", from: null, to: null, active: false },
    ],
    standby: [],
  };
  const decision = planHotAdd(doc, undefined, [], "acme");
  const target = targetOf(decision);
  assert.notEqual(target.tag, "A2");
  assert.notEqual(target.clusterId, "pos-orders-a2");
  assert.equal(target.tag, "A3");
  assert.equal(target.clusterId, "pos-orders-a3");
});

test("R10c: the bounded collision-mint loop throws only pathologically (50 consecutive reserved tags)", () => {
  const reserved = Array.from({ length: 50 }, (_, i) => `pos-orders-a${i + 2}`);
  assert.throws(
    () => planHotAdd(null, undefined, reserved, "acme"),
    /could not mint a non-colliding ledger tag/,
    "R10: the bounded loop's throw is reachable only under a pathologically corrupt reservation set",
  );
});

test("planHotAdd: a corrupt manifest (0 or 2 active ledgers) throws instead of guessing", () => {
  const zeroActive: StoredRuntimeRegistryDoc = { ledgers: [] };
  assert.throws(() => planHotAdd(zeroActive, undefined, [], "acme"), /exactly one active ledger/);

  const twoActive: StoredRuntimeRegistryDoc = {
    ledgers: [
      { id: "pos-orders-a", uri: "u1", tag: "A", from: null, to: null, active: true },
      { id: "pos-orders-b", uri: "u2", tag: "A2", from: null, to: null, active: true },
    ],
  };
  assert.throws(() => planHotAdd(twoActive, undefined, [], "acme"), /exactly one active ledger/);
});

// ── 4. Flip builders ─────────────────────────────────────────────────────────

test("buildHotAddFlipUpdate (mint): one $set of the WHOLE ledgers array, retiring row keeps its other fields", () => {
  const doc: StoredRuntimeRegistryDoc = {
    _id: "cluster-registry",
    ledgers: [{ id: "pos-orders-a", uri: "old-uri", tag: "A", from: null, to: null, active: true, fillPct: 0.5 }],
    standby: [],
  };
  const target: ITaskRunTarget = { mode: "mint", tag: "A2", clusterId: "pos-orders-a2", oldActiveId: "pos-orders-a" };
  const { filter, update } = buildHotAddFlipUpdate(doc, target, "mongodb+srv://new-orders", TODAY, TOMORROW);

  assert.equal(filter["standby.0.id"], undefined, "mint mode never touches standby");
  assert.deepEqual(filter, {
    _id: "cluster-registry",
    ledgers: { $elemMatch: { id: "pos-orders-a", active: true } },
  });
  const newLedgers = (update.$set as { ledgers: StoredRuntimeLedger[] }).ledgers;
  assert.equal(newLedgers.length, 2);
  const retiring = newLedgers.find((l) => l.id === "pos-orders-a")!;
  assert.deepEqual(retiring, { id: "pos-orders-a", uri: "old-uri", tag: "A", from: null, to: TOMORROW, active: false, fillPct: 0.5 });
  const fresh = newLedgers.find((l) => l.id === "pos-orders-a2")!;
  assert.deepEqual(fresh, { id: "pos-orders-a2", uri: "mongodb+srv://new-orders", tag: "A2", from: TODAY, to: null, active: true });
  const actives = newLedgers.filter((l) => l.active === true);
  assert.equal(actives.length, 1, "exactly one active:true row in the update payload");
  assert.equal((update.$set as Record<string, unknown>).standby, undefined, "mint mode never touches standby");
});

test("buildHotAddFlipUpdate (promote): pops standby[0], filter carries standby.0.id + $size, promoted uri kept verbatim", () => {
  const doc: StoredRuntimeRegistryDoc = {
    _id: "cluster-registry",
    ledgers: [{ id: "pos-orders-a", uri: "old-uri", tag: "A", from: null, to: null, active: true }],
    standby: [{ id: "pos-orders-b", uri: "standby-uri", tag: "B5" }],
  };
  const target: ITaskRunTarget = { mode: "promote", tag: "B5", clusterId: "pos-orders-b", standbyId: "pos-orders-b", oldActiveId: "pos-orders-a" };
  const { filter, update } = buildHotAddFlipUpdate(doc, target, "standby-uri", TODAY, TOMORROW);

  assert.deepEqual(filter, {
    _id: "cluster-registry",
    ledgers: { $elemMatch: { id: "pos-orders-a", active: true } },
    "standby.0.id": "pos-orders-b",
    standby: { $size: 1 },
  });
  const set = update.$set as { ledgers: StoredRuntimeLedger[]; standby: unknown[] };
  const promoted = set.ledgers.find((l) => l.id === "pos-orders-b")!;
  assert.equal(promoted.uri, "standby-uri", "the standby's stored uri is kept VERBATIM, never re-sealed");
  assert.deepEqual(set.standby, [], "standby array sliced past the consumed entry");
  const actives = set.ledgers.filter((l) => l.active === true);
  assert.equal(actives.length, 1);
});

test("buildBootstrapRegistryDoc: core-archived row + new active row, standby empty, exactly one active", () => {
  const target: ITaskRunTarget = {
    mode: "mint",
    tag: "A2",
    clusterId: "pos-orders-a2",
    projectName: "pos-acme-orders-a2",
    oldActiveId: "core",
    bootstrap: true,
  };
  const doc = buildBootstrapRegistryDoc("mongodb+srv://u:p@core/pos", target, "mongodb+srv://u:p@orders/pos", TODAY, TOMORROW, "pos-core");

  assert.equal(doc._id, "cluster-registry");
  assert.deepEqual(doc.core, buildCoreMirror("pos-core", "mongodb+srv://u:p@core/pos"));
  assert.equal(doc.ledgers.length, 2);
  assert.deepEqual(doc.ledgers[0], { id: "core", uri: "mongodb+srv://u:p@core/pos", tag: "A", from: null, to: TOMORROW, active: false });
  assert.deepEqual(doc.ledgers[1], { id: "pos-orders-a2", uri: "mongodb+srv://u:p@orders/pos", tag: "A2", from: TODAY, to: null, active: true });
  assert.deepEqual(doc.standby, []);
  const actives = doc.ledgers.filter((l) => l.active === true);
  assert.equal(actives.length, 1);
});

// ── 5. Classifiers ────────────────────────────────────────────────────────────

test("alreadyFlipped: true only when id AND tag both match a doc row", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [
      { id: "pos-orders-a2", uri: "u", tag: "A2", from: TODAY, to: null, active: true },
      { id: "pos-orders-a", uri: "u2", tag: "A", from: null, to: TOMORROW, active: false },
    ],
  };
  const target: ITaskRunTarget = { mode: "mint", tag: "A2", clusterId: "pos-orders-a2", oldActiveId: "pos-orders-a" };
  assert.equal(alreadyFlipped(doc, target), true);
  assert.equal(alreadyFlipped(doc, { ...target, tag: "A3" }), false, "id matches, tag doesn't");
  assert.equal(alreadyFlipped(doc, { ...target, clusterId: "pos-orders-zzz" }), false, "tag matches a different id");
});

test("alreadyFlipped (promote): checks the standbyId, not clusterId", () => {
  const doc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-b", uri: "u", tag: "B5", from: TODAY, to: null, active: true }],
  };
  const target: ITaskRunTarget = { mode: "promote", tag: "B5", clusterId: "pos-orders-b", standbyId: "pos-orders-b", oldActiveId: "pos-orders-a" };
  assert.equal(alreadyFlipped(doc, target), true);
});

test("flipBlocked: null when clean; a reason when the target tag sits on a different id", () => {
  const target: ITaskRunTarget = { mode: "mint", tag: "A2", clusterId: "pos-orders-a2", oldActiveId: "pos-orders-a" };
  const cleanDoc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-a", uri: "u", tag: "A", from: null, to: null, active: true }],
  };
  assert.equal(flipBlocked(cleanDoc, target), null);

  const tagStolenDoc: StoredRuntimeRegistryDoc = {
    ledgers: [
      { id: "pos-orders-zzz", uri: "u", tag: "A2", from: null, to: null, active: false },
      { id: "pos-orders-a", uri: "u2", tag: "A", from: null, to: null, active: true },
    ],
  };
  const reason = flipBlocked(tagStolenDoc, target);
  assert.match(reason ?? "", /tag A2 is already carried by ledger pos-orders-zzz/);
});

test("flipBlocked: a reason when the active ledger changed from oldActiveId", () => {
  const target: ITaskRunTarget = { mode: "mint", tag: "A2", clusterId: "pos-orders-a2", oldActiveId: "pos-orders-a" };
  const rolledDoc: StoredRuntimeRegistryDoc = {
    ledgers: [{ id: "pos-orders-other", uri: "u", tag: "A", from: null, to: null, active: true }],
  };
  const reason = flipBlocked(rolledDoc, target);
  assert.match(reason ?? "", /active ledger changed from pos-orders-a to pos-orders-other/);
});

// ── 6. Reconcile builders ─────────────────────────────────────────────────────

test("buildOrderWindows: null from ⇒ epoch, open to ⇒ null, keyed by runtime ledger id (core row allowed)", () => {
  const ledgers: StoredRuntimeLedger[] = [
    { id: "core", uri: "u", tag: "A", from: null, to: TOMORROW, active: false },
    { id: "pos-orders-a2", uri: "u2", tag: "A2", from: TODAY, to: null, active: true },
  ];
  const windows = buildOrderWindows(ledgers);
  assert.deepEqual(windows, [
    { clusterName: "core", fromDate: new Date(0), toDate: new Date(TOMORROW) },
    { clusterName: "pos-orders-a2", fromDate: new Date(TODAY), toDate: null },
  ]);
});

test("desiredDbPoolRoles: active ⇒ orders-current, inactive ⇒ orders-archive, 'core' skipped", () => {
  const ledgers: StoredRuntimeLedger[] = [
    { id: "core", uri: "u", tag: "A", from: null, to: TOMORROW, active: false },
    { id: "pos-orders-a", uri: "u2", tag: "A", from: null, to: TOMORROW, active: false },
    { id: "pos-orders-a2", uri: "u3", tag: "A2", from: TODAY, to: null, active: true },
  ];
  const roles = desiredDbPoolRoles(ledgers);
  assert.deepEqual(roles, [
    { clusterId: "pos-orders-a", role: "orders-archive" },
    { clusterId: "pos-orders-a2", role: "orders-current" },
  ]);
});

// ── 7. hotAddStepsAfter ───────────────────────────────────────────────────────

test("hotAddStepsAfter: undefined/unknown ⇒ all 4 steps; 'cluster' ⇒ tail; 'done' ⇒ none", () => {
  assert.deepEqual(hotAddStepsAfter(undefined), ["target", "cluster", "flip", "registry"]);
  assert.deepEqual(hotAddStepsAfter("intake-ish"), ["target", "cluster", "flip", "registry"]);
  assert.deepEqual(hotAddStepsAfter("cluster"), ["flip", "registry"]);
  assert.deepEqual(hotAddStepsAfter("done"), []);
});

// ── Grep gate (the vault.test.ts / heartbeat-hmac.test.ts precedent): SRV URIs
// and the Atlas SA flow through the whole F3.8 module family — none may
// console-log. A raw source scan, not an import — the module-boundary comment
// above (this file exercises hotadd-plan.ts only) still holds. ────────────────
test("hotadd: grep gate — no console.* in the hot-add plan/ports/steps/machine modules", () => {
  for (const rel of ["./hotadd-plan.ts", "./hotadd-ports.ts", "./hotadd-steps.ts", "./hotadd.ts", "./hotadd-status.ts"]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.ok(!/\bconsole\s*\./.test(src), `${rel} must never log (SRV URIs/Atlas SA flow through)`);
  }
});
