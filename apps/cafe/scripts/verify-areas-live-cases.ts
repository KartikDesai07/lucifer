/**
 * Cases for verify-areas-live.ts (Tables B2 Areas), 03-plan-b2-draft.md §G as
 * amended by 03-rulings-b2.md S-1/S-3/S-5. Reads/writes the `areas` collection
 * RAW (an independent path from the routes); expected copies and limits come
 * from the real constants. Runs against a scratch database the caller has
 * already fenced.
 */
import mongoose from "mongoose";
import cache from "@/lib/cache";
import { Table } from "@/models/Table";
import { Area, AREA_NAME_COLLATION } from "@/models/Area";
import { AREA_LIST, TABLE_LIST } from "@/lib/masters";
import { AREA_DUPLICATE_ERROR, AREA_LIMIT_ERROR, AREA_NOT_FOUND_ERROR } from "@/lib/area-admin";
import { AREA_LIST_CHANGED_ERROR } from "@/lib/area-order";
import { TABLE_AREAS_MAX, TABLE_AREA_NAME_MAX_LEN } from "@/lib/constants";

export type Role = "admin" | "staff";
export type Json = { success: boolean; data?: unknown; error?: string; details?: unknown };
export type Res = { status: number; body: Json };
export type Body = Record<string, unknown>;

export interface Harness {
  setRole(role: Role): void;
  check(label: string, ok: boolean, res?: Res): void;
  areas: {
    get(query?: string): Promise<Res>;
    post(body: unknown): Promise<Res>;
    patch(body: unknown): Promise<Res>;
    put(id: string, body: unknown): Promise<Res>;
    del(id: string): Promise<Res>;
  };
  tables: {
    get(query?: string): Promise<Res>;
    post(body: unknown): Promise<Res>;
    patchList(tableNos: string[]): Promise<Res>;
    patchOne(tableNo: string, body: unknown): Promise<Res>;
  };
  bootstrap(): Promise<Res>;
}

export const { ObjectId } = mongoose.Types;
const AREAS_CACHE_KEY = AREA_LIST.cacheKey;
const TABLES_CACHE_KEY = TABLE_LIST.cacheKey;
const AREAS_MAX = TABLE_AREAS_MAX;
const NAME_MAX = TABLE_AREA_NAME_MAX_LEN;
const DUP_KEY_CODE = 11000;
export const GHOST = "665f0000000000000000beef"; // a valid ObjectId no row carries
const DUPLICATE_COPY = AREA_DUPLICATE_ERROR;
const LIMIT_COPY = AREA_LIMIT_ERROR;
const AREA_NOT_FOUND_COPY = AREA_NOT_FOUND_ERROR;
const AREA_LIST_CHANGED_COPY = AREA_LIST_CHANGED_ERROR;

function areasCol() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("not connected");
  return db.collection("areas");
}
function dropCaches(): void {
  cache.del(AREAS_CACHE_KEY);
  cache.del(TABLES_CACHE_KEY);
}
export async function resetAll(): Promise<void> {
  await areasCol().deleteMany({});
  await Table.deleteMany({});
  dropCaches();
}
export async function rawArea(name: string, displayOrder: number): Promise<string> {
  const now = new Date();
  const r = await areasCol().insertOne({ name, displayOrder, createdAt: now, updatedAt: now });
  return String(r.insertedId);
}
// A raw insert leaves currentOrderId/areaId ABSENT unless given, like a seeded table.
export async function rawTable(tableNo: string, displayOrder: number, extra: Body = {}): Promise<void> {
  const now = new Date();
  await Table.collection.insertOne({ tableNo, status: "Available", capacity: 4, displayOrder, createdAt: now, updatedAt: now, ...extra });
}
export const oid = (hex: string) => new ObjectId(hex);
export const storedArea = (id: string) => areasCol().findOne({ _id: oid(id) });
export const rowsOf = (res: Res): Body[] => (Array.isArray(res.body.data) ? (res.body.data as Body[]) : []);
export const dataOf = (res: Res): Body => (res.body.data && !Array.isArray(res.body.data) ? (res.body.data as Body) : {});
async function areaSnapshot(): Promise<string> {
  const rows = await areasCol().find({}).sort({ _id: 1 }).toArray();
  return rows.map((r) => `${String(r.name)}:${String(r.displayOrder)}`).join(",");
}

async function caseIndex(h: Harness): Promise<void> {
  console.log("S-1 — the name index (built by Area.createIndexes()) is unique + collation en/strength 2; the DB proves it");
  type Idx = { key?: Record<string, number>; unique?: boolean; collation?: { locale?: string; strength?: number } };
  const idx = (await Area.collection.indexes()) as unknown as Idx[];
  const nameIdx = idx.find((i) => i.key?.name === 1 && Object.keys(i.key).length === 1);
  h.check("areas holds a {name:1} index", nameIdx !== undefined);
  h.check('it is unique with collation locale "en", strength 2',
    nameIdx?.unique === true &&
      nameIdx.collation?.locale === AREA_NAME_COLLATION.locale &&
      nameIdx.collation?.strength === AREA_NAME_COLLATION.strength);
  h.check('the collation is literally locale "en", strength 2 (not just equal to the model constant)',
    nameIdx?.collation?.locale === "en" && nameIdx.collation?.strength === 2);
  await areasCol().insertOne({ name: "Garden", displayOrder: 0 });
  let code: unknown;
  await areasCol().insertOne({ name: "GARDEN", displayOrder: 1 }).catch((e: { code?: number }) => { code = e.code; });
  h.check("a raw insert of GARDEN beside Garden is refused by the DB (E11000)", code === DUP_KEY_CODE);
  await resetAll();
}

async function caseStaff(h: Harness): Promise<void> {
  console.log("A1 — staff may read areas; every write is 403 and writes nothing");
  await resetAll();
  const id = await rawArea("Garden", 0);
  h.setRole("staff");
  const list = await h.areas.get();
  h.check("staff GET /api/areas -> 200 with the area", list.status === 200 && rowsOf(list).some((a) => a.name === "Garden"), list);
  for (const [label, res] of [
    ["POST", await h.areas.post({ name: "Nope" })],
    ["PATCH", await h.areas.patch({ ids: [id] })],
    ["PUT /[id]", await h.areas.put(id, { name: "Renamed" })],
    ["DELETE /[id]", await h.areas.del(id)],
  ] as const) h.check(`staff ${label} -> 403`, res.status === 403, res);
  h.check("nothing was written (one area, still Garden)", (await areaSnapshot()) === "Garden:0");
  h.setRole("admin");
}

async function caseCreate(h: Harness): Promise<void> {
  console.log("A2 — create: trimmed, appended at max+1, case-insensitive duplicate refused by the DB index");
  await resetAll();
  const first = await h.areas.post({ name: " Garden " });
  h.check('POST " Garden " -> 201 name "Garden" displayOrder 0',
    first.status === 201 && dataOf(first).name === "Garden" && dataOf(first).displayOrder === 0, first);
  const second = await h.areas.post({ name: "Patio" });
  h.check("second POST -> 201 displayOrder 1", second.status === 201 && dataOf(second).displayOrder === 1, second);
  const dup = await h.areas.post({ name: "garden" });
  h.check('POST "garden" -> 400 duplicate copy', dup.status === 400 && dup.body.error === DUPLICATE_COPY, dup);
  for (const [label, body] of [
    ["empty name", { name: "" }],
    [`${NAME_MAX + 1} characters`, { name: "x".repeat(NAME_MAX + 1) }],
    ["an extra key", { name: "Rooftop", displayOrder: 9 }],
  ] as const) {
    const res = await h.areas.post(body);
    h.check(`POST ${label} -> 400`, res.status === 400, res);
  }
  h.check("exactly Garden:0 and Patio:1 are stored", (await areaSnapshot()) === "Garden:0,Patio:1");
}

async function caseCap(h: Harness): Promise<void> {
  console.log("A3 — cap: the 51st area is refused");
  await resetAll();
  for (let i = 0; i < AREAS_MAX; i += 1) await rawArea(`Area ${i}`, i);
  const res = await h.areas.post({ name: "One too many" });
  h.check(`POST beyond ${AREAS_MAX} -> 400 limit copy`, res.status === 400 && res.body.error === LIMIT_COPY, res);
  h.check(`still ${AREAS_MAX} areas`, (await areasCol().countDocuments()) === AREAS_MAX);
}

async function caseRename(h: Harness): Promise<void> {
  console.log("A4 — rename: own case change allowed, another area's case variant refused, bad/unknown id 404");
  await resetAll();
  const a = await rawArea("Garden", 0);
  await rawArea("Patio", 1);
  const ok = await h.areas.put(a, { name: "Lounge" });
  h.check("rename -> 200 and stored", ok.status === 200 && (await storedArea(a))?.name === "Lounge", ok);
  const clash = await h.areas.put(a, { name: "PATIO" });
  h.check("rename to a case variant of ANOTHER area -> 400", clash.status === 400 && clash.body.error === DUPLICATE_COPY, clash);
  h.check("the refused rename wrote nothing", (await storedArea(a))?.name === "Lounge");
  const own = await h.areas.put(a, { name: "lounge" });
  h.check("own case change -> 200 and stored", own.status === 200 && (await storedArea(a))?.name === "lounge", own);
  const bad = await h.areas.put("not-an-id", { name: "X" });
  h.check("malformed id -> 404", bad.status === 404, bad);
  const ghost = await h.areas.put(GHOST, { name: "X" });
  h.check("unknown id -> 404", ghost.status === 404, ghost);
  // A rename that loses the race to a delete: the row is gone when the PUT lands.
  const gone = await rawArea("Rooftop", 2);
  const removed = await h.areas.del(gone);
  h.check("DELETE of an unused area -> 200", removed.status === 200, removed);
  const late = await h.areas.put(gone, { name: "Terrace" });
  h.check("PUT on a just-deleted id -> 404 Area not found (never a 500)", late.status === 404 && late.body.error === AREA_NOT_FOUND_COPY, late);
  h.check("the late rename wrote nothing", (await storedArea(gone)) === null);
}

async function caseReorder(h: Harness): Promise<void> {
  console.log("A5 — reorder: the full set only; subset/superset 409 and nothing written; duplicate 400");
  await resetAll();
  const [a, b, c] = [await rawArea("A", 0), await rawArea("B", 1), await rawArea("C", 2)];
  const perm = await h.areas.patch({ ids: [c, a, b] });
  h.check("full permutation -> 200 listing C, A, B",
    perm.status === 200 && rowsOf(perm).map((r) => r.name).join(",") === "C,A,B", perm);
  h.check("stored displayOrder 0..n-1 in that order", (await areaSnapshot()) === "A:1,B:2,C:0");
  const before = await areaSnapshot();
  for (const [label, ids] of [["a subset", [c, a]], ["a superset with an unknown id", [c, a, b, GHOST]]] as const) {
    const res = await h.areas.patch({ ids: [...ids] });
    h.check(`${label} -> 409 with the exact copy`, res.status === 409 && res.body.error === AREA_LIST_CHANGED_COPY, res);
    h.check(`${label}: nothing written`, (await areaSnapshot()) === before);
  }
  const dup = await h.areas.patch({ ids: [a, a, b, c] });
  h.check("a duplicate -> 400", dup.status === 400, dup);
  h.check("duplicate: nothing written", (await areaSnapshot()) === before);
}

async function caseFresh(h: Harness): Promise<void> {
  console.log("A6 — fresh read: ?fresh=1 drops this instance's cached area list");
  await resetAll();
  await rawArea("Garden", 0);
  const names = (r: Res): string[] => rowsOf(r).map((a) => String(a.name));
  const primed = await h.areas.get();
  h.check("a plain GET primes the cache (Garden)", names(primed).includes("Garden"), primed);
  await rawArea("Patio", 1); // direct write: the cache does not know
  const stale = await h.areas.get();
  h.check("a plain GET is still the cached list (no Patio)", stale.status === 200 && !names(stale).includes("Patio"), stale);
  const fresh = await h.areas.get("?fresh=1");
  h.check("GET ?fresh=1 shows Patio", fresh.status === 200 && names(fresh).includes("Patio"), fresh);
  const next = await h.areas.get();
  h.check("the next plain GET has Patio too", names(next).includes("Patio"), next);
}


export async function runCases(h: Harness): Promise<void> {
  await caseIndex(h);
  await caseStaff(h);
  await caseCreate(h);
  await caseCap(h);
  await caseRename(h);
  await caseReorder(h);
  await caseFresh(h);
  await resetAll();
}
