// Tables redesign Step 0 — the shared table-pick rule (lib/table-pick):
// the picker's tablePickAction (pinned equivalent to the OLD inline
// TableSelector rule) and the floor hand-off's stricter handoffPickAction.

import { test } from "node:test";
import assert from "node:assert/strict";

import { TABLE_STATUSES, type TableStatus } from "@/lib/constants";
import { OPEN_TABS_FILTERS, handoffPickAction, openTabForTable, tablePickAction } from "@/lib/table-pick";
import type { Order } from "@/types";

const TABLE_NO = "T1";

function tabFor(tableNo: string, orderId: string): Order {
  // Only tableNo/orderId are read by the rule under test.
  return { _id: `id-${orderId}`, orderId, tableNo } as unknown as Order;
}

const table = (status: TableStatus, tableNo = TABLE_NO) => ({ tableNo, status });

test("OPEN_TABS_FILTERS is the exact open-tabs query (Unpaid AND Pending)", () => {
  assert.deepEqual(OPEN_TABS_FILTERS, { payment: "Unpaid", status: "Pending" });
});

test("openTabForTable: finds by tableNo; undefined / empty / other tables give undefined", () => {
  const mine = tabFor(TABLE_NO, "ORD-1");
  assert.equal(openTabForTable(TABLE_NO, [tabFor("T2", "ORD-2"), mine]), mine);
  assert.equal(openTabForTable(TABLE_NO, undefined), undefined);
  assert.equal(openTabForTable(TABLE_NO, []), undefined);
  assert.equal(openTabForTable(TABLE_NO, [tabFor("T2", "ORD-2")]), undefined);
});

test("tablePickAction: 3 statuses x tab present/absent (6 rows)", () => {
  const tab = tabFor(TABLE_NO, "ORD-1");
  const tabs = [tab];
  const none: Order[] = [];

  assert.deepEqual(tablePickAction(table("Available"), tabs), { kind: "select" }, "Available + tab");
  assert.deepEqual(tablePickAction(table("Available"), none), { kind: "select" }, "Available + no tab");
  const resume = tablePickAction(table("Occupied"), tabs);
  assert.equal(resume.kind, "resume", "Occupied + tab");
  assert.equal(resume.kind === "resume" ? resume.tab : undefined, tab, "resume carries the SAME order object");
  assert.deepEqual(
    tablePickAction(table("Occupied"), none),
    { kind: "unavailable", reason: "occupied-no-tab" },
    "Occupied + no tab",
  );
  assert.deepEqual(tablePickAction(table("Reserved"), tabs), { kind: "unavailable", reason: "reserved" }, "Reserved + tab");
  assert.deepEqual(tablePickAction(table("Reserved"), none), { kind: "unavailable", reason: "reserved" }, "Reserved + no tab");
});

test("tablePickAction: tabs still loading (undefined) never resumes; Occupied is unavailable, Available selects", () => {
  assert.deepEqual(tablePickAction(table("Occupied"), undefined), { kind: "unavailable", reason: "occupied-no-tab" });
  assert.deepEqual(tablePickAction(table("Available"), undefined), { kind: "select" });
});

// ---------------------------------------------------------------------------
// EQUIVALENCE: the new derivation must reproduce the OLD TableSelector inline
// rule for every combination, so moving the component onto tablePickAction
// changes nothing the cashier can see.
// ---------------------------------------------------------------------------
interface Outcome {
  disabled: boolean;
  resumable: boolean;
  click: "resume" | "select";
  clickTab: Order | undefined;
}

function oldRule(
  t: { tableNo: string; status: TableStatus },
  tabs: readonly Order[] | undefined,
  isSelected: boolean,
  onResume: ((o: Order) => void) | undefined,
): Outcome {
  const tab = tabs?.find((o) => o.tableNo === t.tableNo);
  const resumable = t.status === "Occupied" && !!tab && !!onResume;
  const disabled = !isSelected && !resumable && t.status !== "Available";
  const resumes = !!(tab && resumable);
  return { disabled, resumable, click: resumes ? "resume" : "select", clickTab: resumes ? tab : undefined };
}

function newRule(
  t: { tableNo: string; status: TableStatus },
  tabs: readonly Order[] | undefined,
  isSelected: boolean,
  onResume: ((o: Order) => void) | undefined,
): Outcome {
  const pick = tablePickAction(t, tabs);
  const tab = pick.kind === "resume" ? pick.tab : undefined;
  const resumable = !!tab && !!onResume;
  const disabled = !isSelected && !resumable && pick.kind !== "select";
  const resumes = !!(tab && resumable);
  return { disabled, resumable, click: resumes ? "resume" : "select", clickTab: resumes ? tab : undefined };
}

test("EQUIVALENCE: tablePickAction reproduces the old TableSelector rule for status x tab x isSelected x onResume", () => {
  const mine = tabFor(TABLE_NO, "ORD-1");
  const tabsVariants: ReadonlyArray<readonly [string, readonly Order[] | undefined]> = [
    ["undefined", undefined],
    ["empty", []],
    ["other table only", [tabFor("T2", "ORD-2")]],
    ["this table", [mine]],
    ["this table among others", [tabFor("T2", "ORD-2"), mine, tabFor("T3", "ORD-3")]],
  ];
  const onResumeVariants: ReadonlyArray<readonly [string, ((o: Order) => void) | undefined]> = [
    ["defined", () => undefined],
    ["undefined", undefined],
  ];
  assert.equal(TABLE_STATUSES.length, 3, "landmark: the matrix covers every status");
  let combos = 0;
  for (const status of TABLE_STATUSES) {
    for (const [tabsName, tabs] of tabsVariants) {
      for (const isSelected of [false, true]) {
        for (const [resumeName, onResume] of onResumeVariants) {
          const t = table(status);
          assert.deepEqual(
            newRule(t, tabs, isSelected, onResume),
            oldRule(t, tabs, isSelected, onResume),
            `${status} / tabs ${tabsName} / selected ${isSelected} / onResume ${resumeName}`,
          );
          combos += 1;
        }
      }
    }
  }
  assert.equal(combos, 3 * 5 * 2 * 2, "every combination was compared");
});

test("EQUIVALENCE sanity: the old-rule oracle itself flags a disabled Reserved tile and a resumable Occupied one", () => {
  const mine = tabFor(TABLE_NO, "ORD-1");
  assert.equal(oldRule(table("Reserved"), [mine], false, () => undefined).disabled, true);
  assert.equal(oldRule(table("Occupied"), [mine], false, () => undefined).disabled, false);
  assert.equal(oldRule(table("Occupied"), [mine], false, undefined).disabled, true, "no onResume = not resumable");
  assert.equal(oldRule(table("Occupied"), [mine], true, undefined).disabled, false, "the selected tile stays enabled");
});

// ---------------------------------------------------------------------------
// handoffPickAction
// ---------------------------------------------------------------------------
test("handoffPickAction: Available resumes a known open tab, else selects (no cached bill = never waits)", () => {
  const tab = tabFor(TABLE_NO, "ORD-1");
  const resumed = handoffPickAction(table("Available"), [tab]);
  assert.equal(resumed.kind, "resume");
  assert.equal(resumed.kind === "resume" ? resumed.tab : undefined, tab);
  assert.deepEqual(handoffPickAction(table("Available"), []), { kind: "select" });
  assert.deepEqual(handoffPickAction(table("Available"), [tabFor("T2", "ORD-2")]), { kind: "select" });
  assert.deepEqual(handoffPickAction(table("Available"), undefined), { kind: "select" });
});

test("handoffPickAction: Occupied waits for the tabs, then resumes or reports no tab", () => {
  const tab = tabFor(TABLE_NO, "ORD-1");
  assert.deepEqual(handoffPickAction(table("Occupied"), undefined), { kind: "wait" });
  const resumed = handoffPickAction(table("Occupied"), [tab]);
  assert.equal(resumed.kind, "resume");
  assert.equal(resumed.kind === "resume" ? resumed.tab : undefined, tab);
  assert.deepEqual(handoffPickAction(table("Occupied"), []), { kind: "unavailable", reason: "occupied-no-tab" });
});

test("handoffPickAction: Reserved is unavailable whatever the tabs are (never waits)", () => {
  const tab = tabFor(TABLE_NO, "ORD-1");
  for (const tabs of [undefined, [], [tab]] as const) {
    assert.deepEqual(handoffPickAction(table("Reserved"), tabs), { kind: "unavailable", reason: "reserved" });
  }
});

test("handoffPickAction: an Available table the unconfirmed cache shows with a bill WAITS for the fresh list (never a second bill)", () => {
  const cachedTab = tabFor(TABLE_NO, "ORD-1");
  // Fresh tabs not known yet + the floor's cached list names a bill → wait.
  assert.deepEqual(handoffPickAction(table("Available"), undefined, [cachedTab]), { kind: "wait" });
  // A cached bill for ANOTHER table does not hold this one up.
  assert.deepEqual(handoffPickAction(table("Available"), undefined, [tabFor("T2", "ORD-2")]), { kind: "select" });
  // Once the fresh list lands it decides, whatever the cache said.
  assert.deepEqual(handoffPickAction(table("Available"), [], [cachedTab]), { kind: "select" });
  const resumed = handoffPickAction(table("Available"), [cachedTab], [cachedTab]);
  assert.equal(resumed.kind, "resume");
  // Occupied / Reserved ignore the cache (their own rules above).
  assert.deepEqual(handoffPickAction(table("Occupied"), undefined, [cachedTab]), { kind: "wait" });
  assert.deepEqual(handoffPickAction(table("Reserved"), undefined, [cachedTab]), { kind: "unavailable", reason: "reserved" });
});
