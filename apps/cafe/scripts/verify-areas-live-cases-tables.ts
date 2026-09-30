/**
 * Table-side cases for verify-areas-live.ts (Tables B2 Areas): A7-A11 plus the
 * ruling additions S-3 (delete), S-5 (a)-(d). Shares the raw helpers of
 * verify-areas-live-cases.ts; copies and versions come from the real constants.
 */
import { Table } from "@/models/Table";
import { TABLE_BUSY_ERROR } from "@/lib/table-admin";
import { TABLE_LIST_CHANGED_ERROR } from "@/lib/table-order";
import { BOOTSTRAP_VERSION } from "@/lib/bootstrap-contract";
import { areaInUseMessage } from "@/lib/table-areas";
import {
  GHOST,
  ObjectId,
  dataOf,
  oid,
  rawArea,
  rawTable,
  resetAll,
  rowsOf,
  storedArea,
  type Body,
  type Harness,
  type Res,
  type Role,
} from "./verify-areas-live-cases";

const BOOTSTRAP_MIN_VERSION = BOOTSTRAP_VERSION;
const HEX24 = /^[0-9a-f]{24}$/;
const AREAS_VERSION_RE = /\|areas:\d+:\d+\|/;
const TABLE_LIST_CHANGED_COPY = TABLE_LIST_CHANGED_ERROR;
const inUseCopy = areaInUseMessage;

const storedTable = (tableNo: string) => Table.collection.findOne({ tableNo });
const isOid = (v: unknown, hex: string): boolean => v instanceof ObjectId && String(v) === hex;
const mentionsArea = (res: Res): boolean => JSON.stringify(res.body).toLowerCase().includes("area");

async function caseTableCreate(h: Harness): Promise<void> {
  console.log("A7 — POST /api/tables with areaId: stored as an ObjectId; unknown/malformed -> 400, nothing created");
  await resetAll();
  const g = await rawArea("Garden", 0);
  const ok = await h.tables.post({ tableNo: "T-1", capacity: 4, areaId: g });
  h.check("POST with a real areaId -> 201", ok.status === 201, ok);
  h.check("stored areaId is an ObjectId equal to the area", isOid((await storedTable("T-1"))?.areaId, g));
  const ghost = await h.tables.post({ tableNo: "T-2", capacity: 4, areaId: GHOST });
  h.check("POST with an unknown areaId -> 400", ghost.status === 400, ghost);
  const junk = await h.tables.post({ tableNo: "T-3", capacity: 4, areaId: "not-an-id" });
  h.check("POST with a malformed areaId -> 400", junk.status === 400, junk);
  h.check("neither refused table was created", (await storedTable("T-2")) === null && (await storedTable("T-3")) === null);
}

async function caseTablePatch(h: Harness): Promise<void> {
  console.log("A8 — PATCH a table's areaId: set lands at max+1, null unsets the key, capacity-only leaves it");
  await resetAll();
  const [a, b] = [await rawArea("Garden", 0), await rawArea("Patio", 1)];
  await rawTable("T-1", 0, { areaId: oid(a) });
  await rawTable("T-2", 1, { areaId: oid(a) }); // starts IN an area so the null-clear is not vacuous
  await rawTable("T-3", 2);
  await rawTable("T-4", 3, { areaId: oid(a) });
  const set = await h.tables.patchOne("T-2", { areaId: b });
  h.check("PATCH areaId B -> 200", set.status === 200, set);
  const t2 = await storedTable("T-2");
  h.check("stored areaId is ObjectId B and displayOrder is max+1 (4)", isOid(t2?.areaId, b) && t2?.displayOrder === 4);
  const clear = await h.tables.patchOne("T-2", { areaId: null });
  h.check("PATCH areaId null -> 200", clear.status === 200, clear);
  h.check("the areaId KEY is absent (unset, not null)", !("areaId" in ((await storedTable("T-2")) ?? {})));
  const cap = await h.tables.patchOne("T-4", { capacity: 6 });
  const t4 = await storedTable("T-4");
  h.check("capacity-only PATCH -> 200 and leaves areaId + displayOrder",
    cap.status === 200 && isOid(t4?.areaId, a) && t4?.displayOrder === 3 && t4?.capacity === 6, cap);
  const ghost = await h.tables.patchOne("T-3", { areaId: GHOST });
  h.check("PATCH an unknown areaId -> 400 and nothing stored",
    ghost.status === 400 && !("areaId" in ((await storedTable("T-3")) ?? {})), ghost);
  const empty = await h.tables.patchOne("T-3", {});
  h.check("PATCH {} -> 400 and the message names the area", empty.status === 400 && mentionsArea(empty), empty);
}

async function caseTableDelete(h: Harness): Promise<void> {
  console.log("A9/S-3 — DELETE an area: refused while in use (exact copy), then 200; unknown/already-deleted 404");
  await resetAll();
  const g = await rawArea("Garden", 0);
  const unused = await rawArea("Unused", 1);
  await rawTable("T-1", 0, { areaId: oid(g) });
  await rawTable("T-2", 1, { areaId: oid(g) });
  const busy = await h.areas.del(g);
  h.check("DELETE in use by 2 tables -> 409 exact copy", busy.status === 409 && busy.body.error === inUseCopy(2), busy);
  h.check("the area is still stored", (await storedArea(g)) !== null);
  await Table.collection.updateMany({}, { $unset: { areaId: "" } });
  const gone = await h.areas.del(g);
  h.check("after clearing the tables: DELETE -> 200 {deleted:true}", gone.status === 200 && dataOf(gone).deleted === true, gone);
  h.check("the area is gone", (await storedArea(g)) === null);
  const again = await h.areas.del(g);
  h.check("S-3: DELETE the already-deleted id -> 404", again.status === 404, again);
  const ghost = await h.areas.del(GHOST);
  h.check("S-3: DELETE an unknown id -> 404", ghost.status === 404, ghost);
  const free = await h.areas.del(unused);
  h.check("DELETE an unused area -> 200", free.status === 200, free);
}

async function bootstrapChecks(h: Harness, role: Role): Promise<void> {
  console.log(`A10${role === "staff" ? "/S-5d" : ""} — bootstrap areas part as ${role}`);
  await resetAll();
  const zed = await rawArea("Zed", 0);
  const alpha = await rawArea("Alpha", 1);
  await rawTable("T-1", 0, { areaId: oid(zed) });
  await rawTable("T-2", 1, { areaId: oid(alpha) });
  await rawTable("T-3", 2);
  h.setRole(role);
  const res = await h.bootstrap();
  const data = dataOf(res);
  const areas = Array.isArray(data.areas) ? (data.areas as Body[]) : [];
  h.check(`bootstrap as ${role} -> 200`, res.status === 200, { status: res.status, body: { success: res.body.success, error: res.body.error } });
  h.check("areas part lists Zed, Alpha (displayOrder order, not name order)", areas.map((a) => a.name).join(",") === "Zed,Alpha");
  const list = await h.areas.get();
  h.check("areas part equals GET /api/areas", JSON.stringify(areas) === JSON.stringify(rowsOf(list)) && areas.length > 0);
  h.check(`v >= ${BOOTSTRAP_MIN_VERSION} (observed ${String(data.v)})`, typeof data.v === "number" && data.v >= BOOTSTRAP_MIN_VERSION);
  h.check("mastersVersion carries an areas:n:m component", AREAS_VERSION_RE.test(String(data.mastersVersion)));
  const ids = new Set(areas.map((a) => String(a._id)));
  const tables = Array.isArray(data.tables) ? (data.tables as Body[]) : [];
  const withArea = tables.filter((t) => t.areaId !== undefined);
  h.check("tables[].areaId are 24-hex ids that name an areas[] row",
    withArea.length === 2 && withArea.every((t) => HEX24.test(String(t.areaId)) && ids.has(String(t.areaId))));
  if (role === "staff") h.check("staff part is null for a non-admin", data.staff === null);
  h.setRole("admin");
}

async function caseCompose(h: Harness): Promise<void> {
  console.log("A11 — a composed (area-contiguous) tables reorder saves; a subset is 409; areaIds untouched");
  await resetAll();
  const [a, b] = [await rawArea("Garden", 0), await rawArea("Patio", 1)];
  await rawTable("T-1", 0, { areaId: oid(a) });
  await rawTable("T-2", 1, { areaId: oid(b) });
  await rawTable("T-3", 2, { areaId: oid(a) });
  await rawTable("T-4", 3);
  const order = ["T-1", "T-3", "T-2", "T-4"];
  const ok = await h.tables.patchList(order);
  h.check("composed flat list -> 200 in that order",
    ok.status === 200 && rowsOf(ok).map((t) => t.tableNo).join(",") === order.join(","), ok);
  h.check("areaIds unchanged by the reorder",
    isOid((await storedTable("T-3"))?.areaId, a) && isOid((await storedTable("T-2"))?.areaId, b) && !("areaId" in ((await storedTable("T-4")) ?? {})));
  const subset = await h.tables.patchList(["T-1", "T-3", "T-2"]);
  h.check("a subset -> 409 with the table copy", subset.status === 409 && subset.body.error === TABLE_LIST_CHANGED_COPY, subset);
}

async function caseOccupied(h: Harness): Promise<void> {
  console.log("S-5a/b — an Occupied table: area change lands; rename + area is refused whole");
  await resetAll();
  const [a, b] = [await rawArea("Garden", 0), await rawArea("Patio", 1)];
  await rawTable("T-1", 0);
  await rawTable("T-2", 1, { status: "Occupied", currentOrderId: "ORD-1" });
  await rawTable("T-3", 2, { status: "Occupied", currentOrderId: "ORD-2" });
  const move = await h.tables.patchOne("T-2", { areaId: a });
  const t2 = await storedTable("T-2");
  h.check("(a) areaId change on an Occupied table -> 200, areaId + displayOrder max+1 (3) written",
    move.status === 200 && isOid(t2?.areaId, a) && t2?.displayOrder === 3, move);
  const busy = await h.tables.patchOne("T-3", { tableNo: "T-3B", areaId: b });
  h.check("(b) rename + areaId on an Occupied table -> 400 busy copy", busy.status === 400 && busy.body.error === TABLE_BUSY_ERROR, busy);
  const t3 = await storedTable("T-3");
  h.check("(b) neither the rename nor the area was written",
    t3 !== null && !("areaId" in t3) && (await storedTable("T-3B")) === null);
}

async function caseDangling(h: Harness): Promise<void> {
  console.log("S-5c — a raw dangling areaId is tolerated everywhere and cleared by {areaId:null}");
  await resetAll();
  const dangling = String(new ObjectId());
  await rawTable("T-9", 0, { areaId: oid(dangling) });
  const list = await h.tables.get();
  h.check("GET /api/tables -> 200 carrying the raw id",
    list.status === 200 && rowsOf(list).some((t) => t.tableNo === "T-9" && String(t.areaId) === dangling), list);
  const boot = await h.bootstrap();
  const bootTables = Array.isArray(dataOf(boot).tables) ? (dataOf(boot).tables as Body[]) : [];
  h.check("bootstrap -> 200 carrying the raw id",
    boot.status === 200 && bootTables.some((t) => t.tableNo === "T-9" && String(t.areaId) === dangling),
    { status: boot.status, body: { success: boot.body.success, error: boot.body.error } });
  const cap = await h.tables.patchOne("T-9", { capacity: 2 });
  h.check("capacity-only PATCH -> 200 and leaves the dangling id", cap.status === 200 && isOid((await storedTable("T-9"))?.areaId, dangling), cap);
  const clear = await h.tables.patchOne("T-9", { areaId: null });
  h.check("{areaId:null} -> 200 and the key is gone", clear.status === 200 && !("areaId" in ((await storedTable("T-9")) ?? {})), clear);
}

export async function runTableCases(h: Harness): Promise<void> {
  await caseTableCreate(h);
  await caseTablePatch(h);
  await caseTableDelete(h);
  await bootstrapChecks(h, "admin");
  await bootstrapChecks(h, "staff");
  await caseCompose(h);
  await caseOccupied(h);
  await caseDangling(h);
  await resetAll();
}
