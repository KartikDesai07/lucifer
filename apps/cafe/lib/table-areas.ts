// Floor areas as pure functions (Tables B2, 2026-09-30): how tables group under
// their area, the copy that goes with it, and the area picker's decision rules.
// Grouping lives HERE and nowhere else - the Floor, Setup, New Order and Move
// table screens all render what groupByArea() returns. No React, no fetching, no
// models: client-safe (lib/client-graph-guard.test.ts walks this file).
import { areaNameSchema } from "@pos/shared/schemas/area.schema";
import type { Area, Table } from "@/types";

/** The group for tables with no area (or an area this device does not know). */
export const NO_AREA_KEY = "none";
export const NO_AREA_LABEL = "Other tables";
/** The area picker's two non-id values. Neither can be an ObjectId hex. */
export const NO_AREA_CHOICE = "none";
export const NEW_AREA_CHOICE = "new";

export const AREA_REMOVED_MESSAGE = "That area was removed. Pick another area.";
export const AREA_NAME_NEEDED_MESSAGE = "Type a name for the new area.";

const OCCUPIED_WORD = "occupied";
const SUMMARY_SEPARATOR = " · ";

export interface AreaGroup<T> {
  /** An Area._id, or NO_AREA_KEY for the trailing "Other tables" group. */
  key: string;
  name: string;
  items: T[];
}

/**
 * Groups items by area, in AREA order (the server's arrangement, not the order
 * the items happen to appear in). Items keep their input order inside a group.
 * An absent or dangling area id lands in the trailing "Other tables" group;
 * empty groups are dropped. With no areas at all the result is ONE group holding
 * every item - the flat list, unchanged.
 */
export function groupByArea<T>(
  items: readonly T[],
  areaIdOf: (item: T) => string | undefined,
  areas?: readonly Area[],
): AreaGroup<T>[] {
  if (items.length === 0) return [];
  const known = new Map<string, T[]>();
  for (const area of areas ?? []) known.set(area._id, []);
  const other: T[] = [];
  for (const item of items) {
    const id = areaIdOf(item);
    const bucket = id === undefined ? undefined : known.get(id);
    if (bucket) bucket.push(item);
    else other.push(item);
  }
  const groups: AreaGroup<T>[] = [];
  for (const area of areas ?? []) {
    const bucket = known.get(area._id);
    if (bucket && bucket.length > 0) groups.push({ key: area._id, name: area.name, items: bucket });
  }
  if (other.length > 0) groups.push({ key: NO_AREA_KEY, name: NO_AREA_LABEL, items: other });
  return groups;
}

/** Headings render only once at least one table sits in a KNOWN area. */
export function showAreaHeadings(groups: readonly AreaGroup<unknown>[]): boolean {
  return groups.some((g) => g.key !== NO_AREA_KEY);
}

/** How many NAMED area groups are shown ("Other tables" is not counted). */
export function namedAreaCount(groups: readonly AreaGroup<unknown>[]): number {
  return groups.filter((g) => g.key !== NO_AREA_KEY).length;
}

/** The ONE reader of a table's area link for grouping: screens call this (or
 *  groupTablesByArea) and never read the link field themselves. */
export function tableAreaIdOf(table: Pick<Table, "areaId">): string | undefined {
  return table.areaId;
}

/** groupByArea for tables (the New Order picker, Move table, Setup). */
export function groupTablesByArea<T extends Pick<Table, "areaId">>(
  tables: readonly T[],
  areas?: readonly Area[],
): AreaGroup<T>[] {
  return groupByArea(tables, tableAreaIdOf, areas);
}

const groupsOf = (tables: readonly Table[], areas?: readonly Area[]) => groupTablesByArea(tables, areas);

/** The full flat tableNo list, contiguous per area (no areas = the input order). */
export function composeAreaOrder(tables: readonly Table[], areas?: readonly Area[]): string[] {
  return groupsOf(tables, areas).flatMap((g) => g.items.map((t) => t.tableNo));
}

/** Changes when a table moves between areas even if the flat order does not. */
export function areaOrderSignature(tables: readonly Table[], areas?: readonly Area[]): string {
  return JSON.stringify(groupsOf(tables, areas).map((g) => [g.key, g.items.map((t) => t.tableNo)]));
}

/** tableNo -> the group key it renders under. */
export function areaGroupKeyMap(
  tables: readonly Table[],
  areas?: readonly Area[],
): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  for (const g of groupsOf(tables, areas)) for (const t of g.items) keys.set(t.tableNo, g.key);
  return keys;
}

/** True only when both tables are known and render in the same group. */
export function sameAreaGroup(
  keys: ReadonlyMap<string, string>,
  a: string,
  b: string,
): boolean {
  const ka = keys.get(a);
  return ka !== undefined && ka === keys.get(b);
}

/**
 * The area ids tables point at that this device's areas list does not hold,
 * sorted and comma-joined ("" = none). "" also while the list has not loaded
 * (undefined): nothing can be called unknown yet.
 */
export function unknownAreaIdsKey(
  tables: readonly Table[],
  areas: readonly Area[] | undefined,
): string {
  if (areas === undefined) return "";
  const known = new Set(areas.map((a) => a._id));
  const unknown = new Set<string>();
  for (const t of tables) if (t.areaId !== undefined && !known.has(t.areaId)) unknown.add(t.areaId);
  return [...unknown].sort().join(",");
}

export function tablesInArea(tables: readonly Table[], areaId: string): Table[] {
  return tables.filter((t) => t.areaId === areaId);
}

export function tableCountText(n: number): string {
  return `${n} ${n === 1 ? "table" : "tables"}`;
}

/** "4 tables · 2 occupied" - the heading summary on the Floor. */
export function areaSummaryText(total: number, occupied: number): string {
  return `${tableCountText(total)}${SUMMARY_SEPARATOR}${occupied} ${OCCUPIED_WORD}`;
}

export function areaInUseMessage(n: number): string {
  return `This area still has ${n} ${n === 1 ? "table" : "tables"}. Move ${n === 1 ? "it" : "them"} to another area first.`;
}

/** The picker's starting value: the table's own area id (even while areas load). */
export function initialAreaChoice(table: Pick<Table, "areaId"> | undefined): string {
  return table?.areaId ?? NO_AREA_CHOICE;
}

/** An area this form just created; it may not be in the areas list yet. */
export interface CreatedArea {
  id: string;
  name: string;
}

export type AreaResolution =
  | { kind: "none" }
  | { kind: "existing"; id: string }
  | { kind: "create"; name: string }
  | { kind: "invalid"; message: string };

// ICU strength 2 - case-insensitive, accent-sensitive - is the same comparison
// the database's collation index makes. Best effort only: the server's 400 is
// the authority.
const sameAreaName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "accent" }) === 0;

/**
 * What submitting the area picker means. A typed name that matches an existing
 * (or just-created) area resolves to that area instead of creating a duplicate;
 * an id that is neither in the list nor just created was removed. While the
 * list is still loading (undefined) an id cannot be judged, so it is trusted.
 */
export function resolveAreaChoice(
  choice: string,
  newName: string,
  areas: readonly Area[] | undefined,
  createdArea?: CreatedArea,
): AreaResolution {
  if (choice === NO_AREA_CHOICE) return { kind: "none" };
  if (choice === NEW_AREA_CHOICE) {
    const parsed = areaNameSchema.safeParse(newName);
    if (!parsed.success) {
      const typed = newName.trim().length > 0;
      return {
        kind: "invalid",
        message: typed ? parsed.error.issues[0].message : AREA_NAME_NEEDED_MESSAGE,
      };
    }
    if (createdArea && sameAreaName(createdArea.name, parsed.data)) {
      return { kind: "existing", id: createdArea.id };
    }
    const match = areas?.find((a) => sameAreaName(a.name, parsed.data));
    return match ? { kind: "existing", id: match._id } : { kind: "create", name: parsed.data };
  }
  if (createdArea && choice === createdArea.id) return { kind: "existing", id: choice };
  if (areas === undefined || areas.some((a) => a._id === choice)) return { kind: "existing", id: choice };
  return { kind: "invalid", message: AREA_REMOVED_MESSAGE };
}

/** The PATCH fragment for an area change: nothing, a clear, or a move. */
export function areaPatchOf(
  initialChoice: string,
  nextId: string | null,
): { areaId?: string | null } {
  if (nextId === null) return initialChoice === NO_AREA_CHOICE ? {} : { areaId: null };
  return nextId === initialChoice ? {} : { areaId: nextId };
}
