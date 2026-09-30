/**
 * Tables redesign B1 Slice A live leg (2026-09-30) — drives the REAL route
 * handlers (tables, tables/[tableNo], settings) against a real mongod. `@/lib/auth`
 * is swapped for a signed-in stub with a SWITCHABLE role (admin/staff), copied
 * from verify-menu-live.ts, so both sides of every fence run from one process.
 *
 *   node --import tsx scripts/verify-tables-floor-live.ts
 *
 * Imports NO symbol added by the tables redesign (the fresh param and the 409
 * copy are literals) so it can run BEFORE the route edits and show which checks
 * fail (R7); every check prints the observed status + body.
 *
 * SAFETY: refuses any database without the scratch prefix; drops ONLY that
 * database (by exact name) at start and end. (console output is intentional:
 * ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import cache from "@/lib/cache";
import { Table } from "@/models/Table";
import { Settings } from "@/models/Settings";

const SCRATCH_PREFIX = "pos_scratch_";
const DB_NAME = `${SCRATCH_PREFIX}tables_floor`;
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
const STAFF_ID = "665f0000000000000000a001";
const ADMIN_ID = "665f0000000000000000a002";
const TABLES_CACHE_KEY = "tables";
const BODY_PRINT_MAX = 150;
const LIST_CHANGED_COPY = "The table list changed on another screen. It has been refreshed — arrange again.";
const LONG_STAY_DEFAULT = 60;
const LONG_STAY_STORED = 45;

// Mirrors app/api/orders/route.ts occupyTable: the order claim only lands on a
// table whose status is still "Available", keyed by tableNo (R6). A source pin
// (lib/tables-route-paths.test.ts) keeps this and the route in step.
const ORDER_CLAIM_FILTER_SHAPE = { status: "Available" } as const;
function orderClaimFilter(tableNo: string) {
  return { tableNo, ...ORDER_CLAIM_FILTER_SHAPE };
}

type Role = "admin" | "staff";
let currentRole: Role = "admin";

function stubAuth(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  stub.exports = {
    auth: async () => ({
      user:
        currentRole === "admin"
          ? { id: ADMIN_ID, name: "Live leg admin", role: "admin" }
          : { id: STAFF_ID, name: "Live leg staff", role: "staff" },
    }),
    handlers: {},
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  require.cache[file] = stub;
}
stubAuth();

let tablesRoute: typeof import("@/app/api/tables/route");
let tableItemRoute: typeof import("@/app/api/tables/[tableNo]/route");
let settingsRoute: typeof import("@/app/api/settings/route");
let bootstrapContract: typeof import("@/lib/bootstrap-contract");

let passed = 0;
let failed = 0;
type Json = { success: boolean; data?: unknown; error?: string };
type Res = { status: number; body: Json };

// Prints the observed status + (truncated) body for every check, pass or fail.
function check(label: string, ok: boolean, res?: Res): void {
  if (ok) passed += 1;
  else failed += 1;
  const seen = res ? ` -> ${res.status} ${JSON.stringify(res.body).slice(0, BODY_PRINT_MAX)}` : "";
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${seen}`);
}
async function asJson(res: Response): Promise<Res> {
  return { status: res.status, body: (await res.json()) as Json };
}
function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://live.test${url}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}
const putTable = async (tableNo: string, body: unknown): Promise<Res> =>
  asJson(await tableItemRoute.PUT(req("PUT", `/api/tables/${tableNo}`, body), { params: Promise.resolve({ tableNo }) }));
const patchList = async (tableNos: string[]): Promise<Res> =>
  asJson(await tablesRoute.PATCH(req("PATCH", "/api/tables", { tableNos })));
const getList = async (query = ""): Promise<Res> =>
  asJson(await (tablesRoute.GET as (r: Request) => Promise<Response>)(req("GET", `/api/tables${query}`)));
const putSettings = async (body: unknown): Promise<Res> => asJson(await settingsRoute.PUT(req("PUT", "/api/settings", body)));

async function resetTables(): Promise<void> {
  await Table.deleteMany({});
  cache.del(TABLES_CACHE_KEY);
}
// A raw insert leaves currentOrderId ABSENT, exactly like a seeded table.
async function rawTable(tableNo: string, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  const now = new Date();
  await Table.collection.insertOne({ tableNo, status, capacity: 4, createdAt: now, updatedAt: now, ...extra });
}
async function stored(tableNo: string) {
  return Table.findOne({ tableNo }).lean();
}
async function arrangement(): Promise<Array<[string, number | undefined]>> {
  const rows = await Table.find().sort({ tableNo: 1 }).select("tableNo displayOrder").lean();
  return rows.map((r) => [r.tableNo, r.displayOrder]);
}
function namesOf(res: Res): string[] {
  return ((res.body.data as Array<{ tableNo: string }> | undefined) ?? []).map((t) => t.tableNo);
}

async function legStaff(): Promise<void> {
  console.log("L1 — staff: status writes with an empty-pointer echo land; every admin write is 403 and writes nothing");
  currentRole = "staff";
  await resetTables();
  await Settings.deleteMany({});
  await rawTable("T-1", "Available");
  const reserve = await putTable("T-1", { status: "Reserved", expectedCurrentOrderId: "" });
  check("staff PUT Reserved + echo '' on a free table (pointer absent) -> 200", reserve.status === 200, reserve);
  check("stored status is Reserved", (await stored("T-1"))?.status === "Reserved");
  const free = await putTable("T-1", { status: "Available", expectedCurrentOrderId: "" });
  check("staff PUT Available + echo '' -> 200", free.status === 200, free);
  const after = await stored("T-1");
  check("stored: Available with pointer ''", after?.status === "Available" && after?.currentOrderId === "");
  const before = await Table.countDocuments();
  const patch = await patchList(["T-1"]);
  check("staff PATCH /api/tables -> 403", patch.status === 403, patch);
  const post = await asJson(await tablesRoute.POST(req("POST", "/api/tables", { tableNo: "T-9", capacity: 4 })));
  check("staff POST /api/tables -> 403", post.status === 403, post);
  check("no table was added or removed", (await Table.countDocuments()) === before);
  const set = await putSettings({ tableLongStayMinutes: 30 });
  check("staff PUT /api/settings -> 403", set.status === 403, set);
  check("no settings document was created", (await Settings.countDocuments()) === 0);
  currentRole = "admin";
}

async function legCas(): Promise<void> {
  console.log("L2 — CAS: '' means expect no order (absent or ''); a real id is matched verbatim");
  await resetTables();
  await rawTable("T-A", "Occupied", { currentOrderId: "ORD-X" });
  await rawTable("T-B", "Reserved");
  await rawTable("T-C", "Available", { currentOrderId: "" });
  await rawTable("T-D", "Occupied", { currentOrderId: "ORD-Q" });
  const blind = await putTable("T-A", { status: "Available", expectedCurrentOrderId: "" });
  check("Occupied by ORD-X, echo '' -> 409", blind.status === 409, blind);
  const unchanged = await stored("T-A");
  check("doc unchanged (Occupied, ORD-X)", unchanged?.status === "Occupied" && unchanged?.currentOrderId === "ORD-X");
  const matching = await putTable("T-A", { status: "Available", expectedCurrentOrderId: "ORD-X" });
  check("echo ORD-X -> 200", matching.status === 200, matching);
  check("pointer cleared to ''", (await stored("T-A"))?.currentOrderId === "");
  const absent = await putTable("T-B", { status: "Available", expectedCurrentOrderId: "" });
  check("Reserved with the pointer field ABSENT, echo '' -> 200", absent.status === 200, absent);
  const empty = await putTable("T-C", { status: "Reserved", expectedCurrentOrderId: "" });
  check("pointer '' stored, echo '' -> 200", empty.status === 200, empty);
  const wrong = await putTable("T-D", { status: "Available", expectedCurrentOrderId: "ORD-WRONG" });
  check("wrong id -> 409", wrong.status === 409, wrong);
  check("T-D untouched", (await stored("T-D"))?.currentOrderId === "ORD-Q");
  const missing = await putTable("T-NOPE", { status: "Available", expectedCurrentOrderId: "" });
  check("missing table with an echo -> 404", missing.status === 404, missing);
}

async function legRace(): Promise<void> {
  console.log("L3 — both race directions between an order claim and Free (echo '')");
  await resetTables();
  await rawTable("T-R1", "Available");
  const claimed = await Table.findOneAndUpdate(orderClaimFilter("T-R1"), { status: "Occupied", currentOrderId: "ORD-Y" });
  check("(a) the order claim lands first", claimed !== null);
  const lost = await putTable("T-R1", { status: "Available", expectedCurrentOrderId: "" });
  check("(a) Free with echo '' after the claim -> 409", lost.status === 409, lost);
  const kept = await stored("T-R1");
  check("(a) ORD-Y intact (Occupied)", kept?.status === "Occupied" && kept?.currentOrderId === "ORD-Y");
  await rawTable("T-R2", "Reserved");
  const freed = await putTable("T-R2", { status: "Available", expectedCurrentOrderId: "" });
  check("(b) Free lands first -> 200", freed.status === 200, freed);
  const claimAfter = await Table.findOneAndUpdate(orderClaimFilter("T-R2"), { status: "Occupied", currentOrderId: "ORD-Z" });
  check("(b) the order claim after the Free succeeds", claimAfter !== null);
  check("(b) stored Occupied by ORD-Z", (await stored("T-R2"))?.currentOrderId === "ORD-Z");
}

async function legReorder(): Promise<void> {
  console.log("L4 — reorder: the submitted set must equal the current set, else 409 and nothing is written");
  await resetTables();
  for (const [i, no] of ["T-1", "T-2", "T-3", "T-4"].entries()) await Table.create({ tableNo: no, capacity: 4, displayOrder: i });
  const perm = await patchList(["T-4", "T-3", "T-2", "T-1"]);
  check("a permutation -> 200", perm.status === 200, perm);
  check("response lists the new order", JSON.stringify(namesOf(perm)) === JSON.stringify(["T-4", "T-3", "T-2", "T-1"]));
  const written = (await arrangement()).map(([no, order]) => `${no}:${order}`).join(",");
  check("displayOrder is 0..n-1 in that order", written === "T-1:3,T-2:2,T-3:1,T-4:0");
  for (const [label, list] of [
    ["a stale list missing one table", ["T-1", "T-2", "T-3"]],
    ["a list with an unknown name (same length)", ["T-1", "T-2", "T-3", "Ghost"]],
    ["a list with one extra unknown name", ["T-1", "T-2", "T-3", "T-4", "Ghost"]],
  ] as const) {
    const before = await arrangement();
    const res = await patchList([...list]);
    check(`${label} -> 409 with the exact copy`, res.status === 409 && res.body.error === LIST_CHANGED_COPY, res);
    check(`${label}: displayOrders unchanged`, JSON.stringify(await arrangement()) === JSON.stringify(before));
  }
  const dupBefore = await arrangement();
  const dup = await patchList(["T-1", "T-1", "T-2", "T-3", "T-4"]);
  check("a duplicate -> 400", dup.status === 400, dup);
  check("duplicate: displayOrders unchanged", JSON.stringify(await arrangement()) === JSON.stringify(dupBefore));
}

async function legFresh(): Promise<void> {
  console.log("L5 — fresh read: ?fresh=1 drops this instance's cached list");
  await resetTables();
  await Table.create({ tableNo: "T-1", capacity: 4 });
  await Table.create({ tableNo: "T-2", capacity: 4 });
  const primed = await getList();
  check("a plain GET primes the cache (T-2 present)", namesOf(primed).includes("T-2"), primed);
  await Table.deleteOne({ tableNo: "T-2" }); // direct write: the cache does not know
  const stale = await getList();
  check("a plain GET is still the cached list (T-2 present)", namesOf(stale).includes("T-2"), stale);
  const fresh = await getList("?fresh=1");
  check("GET ?fresh=1 shows the new list (T-2 gone)", fresh.status === 200 && !namesOf(fresh).includes("T-2"), fresh);
  const next = await getList();
  check("the next plain GET is new too (cache re-primed)", !namesOf(next).includes("T-2"), next);
}

async function legSettings(): Promise<void> {
  console.log("L6 — settings: tableLongStayMinutes stored, range-checked, defaulted on upsert");
  await Settings.deleteMany({});
  const ok = await putSettings({ tableLongStayMinutes: LONG_STAY_STORED });
  check("PUT 45 -> 200", ok.status === 200, ok);
  const doc = await Settings.findOne().lean();
  check("45 is stored", (doc as { tableLongStayMinutes?: number } | null)?.tableLongStayMinutes === LONG_STAY_STORED);
  for (const bad of [14, 601, 45.5]) {
    const res = await putSettings({ tableLongStayMinutes: bad });
    check(`PUT ${bad} -> 400`, res.status === 400, res);
  }
  const kept = await Settings.findOne().lean();
  check("45 survives the refused writes", (kept as { tableLongStayMinutes?: number } | null)?.tableLongStayMinutes === LONG_STAY_STORED);

  await Settings.deleteMany({});
  const upsert = await putSettings({ restaurantName: "Scratch Cafe" });
  check("PUT without the field on an empty collection -> 200 (upsert)", upsert.status === 200, upsert);
  const fresh = await Settings.findOne().lean();
  check("the upserted document carries 60", (fresh as { tableLongStayMinutes?: number } | null)?.tableLongStayMinutes === LONG_STAY_DEFAULT);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" — scratch (${SCRATCH_PREFIX}*) databases only.`);
  }
  process.env.MONGODB_URI = uri;

  const scratch = await mongoose.createConnection(uri).asPromise();
  try {
    await scratch.dropDatabase();
  } finally {
    await scratch.close();
  }

  tablesRoute = await import("@/app/api/tables/route");
  tableItemRoute = await import("@/app/api/tables/[tableNo]/route");
  settingsRoute = await import("@/app/api/settings/route");
  bootstrapContract = await import("@/lib/bootstrap-contract");

  await connectDB();
  console.log(`\nTables redesign Slice A — live against ${dbName}\n`);

  try {
    await legStaff();
    await legCas();
    await legRace();
    await legReorder();
    await legFresh();
    await legSettings();
    console.log("L7 — bootstrap version");
    check(`BOOTSTRAP_VERSION >= 5 (observed ${bootstrapContract.BOOTSTRAP_VERSION})`, bootstrapContract.BOOTSTRAP_VERSION >= 5);
  } finally {
    // Drop ONLY this scratch database, by exact name — never list or drop
    // any other database.
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
