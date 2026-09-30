/**
 * Menu redesign (2026-09-30) Slice A live leg — drives the REAL route handlers
 * (products, products/[id], products/bulk, products/import, categories,
 * categories/[id], upload, public/menu) against a real mongod. `@/lib/auth`
 * is swapped for a signed-in stub with a SWITCHABLE role (admin/staff) —
 * mirrors verify-order-idem-live.ts:47-59 — so both sides of every access
 * fence (R1) can be exercised from one process.
 *
 *   node --import tsx scripts/verify-menu-live.ts
 *
 * SAFETY: refuses any database whose name lacks the scratch prefix, and drops
 * ONLY that database (by exact name) at start and end — never lists or drops
 * any other database. (console output is intentional — this is an ops CLI
 * script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import cache from "@/lib/cache";
import { Product } from "@/models/Product";
import { Category } from "@/models/Category";
import { Reservation } from "@/models/Reservation";
import { Event } from "@/models/Event";
import { PUBLIC_MENU_CACHE_KEY } from "@/lib/public-menu";

const SCRATCH_PREFIX = "pos_scratch_";
const DB_NAME = `${SCRATCH_PREFIX}menu_live`;
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${DB_NAME}`;
const STAFF_ID = "665f0000000000000000a001";
const ADMIN_ID = "665f0000000000000000a002";

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

let productsRoute: typeof import("@/app/api/products/route");
let productItemRoute: typeof import("@/app/api/products/[id]/route");
let productBulkRoute: typeof import("@/app/api/products/bulk/route");
let productImportRoute: typeof import("@/app/api/products/import/route");
let categoriesRoute: typeof import("@/app/api/categories/route");
let categoryItemRoute: typeof import("@/app/api/categories/[id]/route");
let uploadRoute: typeof import("@/app/api/upload/route");
let publicMenuRoute: typeof import("@/app/api/public/menu/route");
let bootstrapContract: typeof import("@/lib/bootstrap-contract");
let reservationItemRoute: typeof import("@/app/api/reservations/[id]/route");
let eventItemRoute: typeof import("@/app/api/events/[id]/route");

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean): void {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
}

// R8 — clear every in-process cache a direct DB write could have raced past,
// before any read that follows one.
function clearCaches(): void {
  cache.del("products");
  cache.del("categories");
  cache.del(PUBLIC_MENU_CACHE_KEY);
}

type Json = { success: boolean; data?: unknown; error?: string };
async function asJson(res: Response): Promise<{ status: number; body: Json }> {
  return { status: res.status, body: (await res.json()) as Json };
}
function req(method: string, url: string, body?: unknown): Request {
  return new Request(`http://live.test${url}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedCategory(name: string): Promise<string> {
  const doc = await Category.create({ name, order: 0 });
  return String(doc._id);
}
async function seedProduct(overrides: Record<string, unknown> = {}): Promise<string> {
  const catId = (overrides.categoryId as string | undefined) ?? (await seedCategory(`Cat-${Date.now()}-${Math.random()}`));
  const { categoryId: _drop, ...rest } = overrides;
  const doc = await Product.create({
    name: `Item-${Date.now()}-${Math.random()}`,
    price: 100,
    available: true,
    isActive: true,
    image: "",
    modifiers: [],
    discount: 0,
    ...rest,
    categoryId: catId,
  });
  return String(doc._id);
}

// ── Staff fence: {available} 200; everything else 403, document unchanged ──
async function legStaffFence(): Promise<void> {
  console.log("L1 — staff fence: only {available} PUT succeeds; every other admin-only write is 403 and writes nothing");
  currentRole = "staff";

  const pid = await seedProduct({ price: 100, name: "Fence Item" });
  const before = await Product.findById(pid).lean();

  const okToggle = await asJson(await productItemRoute.PUT(req("PUT", `/api/products/${pid}`, { available: false }), params(pid)));
  check("staff PUT {available:false} -> 200", okToggle.status === 200);
  const afterToggle = await Product.findById(pid).lean();
  check("the stored available flag actually flipped", afterToggle?.available === false);

  const priceAttempt = await asJson(await productItemRoute.PUT(req("PUT", `/api/products/${pid}`, { price: 999 }), params(pid)));
  check("staff PUT {price} -> 403", priceAttempt.status === 403);
  const mixedAttempt = await asJson(await productItemRoute.PUT(req("PUT", `/api/products/${pid}`, { available: true, price: 999 }), params(pid)));
  check("staff PUT {available, price} (mixed) -> 403", mixedAttempt.status === 403);
  const afterAttempts = await Product.findById(pid).lean();
  check("price never changed by either refused attempt", afterAttempts?.price === before?.price);

  const del = await asJson(await productItemRoute.DELETE(req("DELETE", `/api/products/${pid}`), params(pid)));
  check("staff DELETE (archive) -> 403", del.status === 403);
  const create = await asJson(await productsRoute.POST(req("POST", "/api/products", { name: "New", categoryId: before?.categoryId, price: 10 })));
  check("staff POST /api/products (create) -> 403", create.status === 403);
  const restore = await asJson(await productItemRoute.PUT(req("PUT", `/api/products/${pid}`, { isActive: true }), params(pid)));
  check("staff PUT {isActive:true} (restore) -> 403 — restore is admin-only", restore.status === 403);

  const imp = await asJson(await productImportRoute.POST(req("POST", "/api/products/import", { dryRun: false, rows: [{ name: "X", category: "Y", price: "1" }] })));
  check("staff POST /api/products/import -> 403", imp.status === 403);
  const upload = await asJson(await uploadRoute.POST(req("POST", "/api/upload", { contentType: "image/png", size: 100 })));
  check("staff POST /api/upload -> 403", upload.status === 403);

  const catPost = await asJson(await categoriesRoute.POST(req("POST", "/api/categories", { name: "Staff Cat" })));
  check("staff POST /api/categories -> 403", catPost.status === 403);
  const catPut = await asJson(await categoryItemRoute.PUT(req("PUT", `/api/categories/${before?.categoryId}`, { name: "Renamed" }), params(String(before?.categoryId))));
  check("staff PUT /api/categories/[id] -> 403", catPut.status === 403);
  const catPatch = await asJson(await categoriesRoute.PATCH(req("PATCH", "/api/categories", { ids: [String(before?.categoryId)] })));
  check("staff PATCH /api/categories -> 403", catPatch.status === 403);

  const bulkArchive = await asJson(await productBulkRoute.POST(req("POST", "/api/products/bulk", { action: "archive", ids: [pid] })));
  check("staff bulk archive -> 403", bulkArchive.status === 403);
  const afterBulkRefused = await Product.findById(pid).lean();
  check("the refused bulk archive changed nothing", afterBulkRefused?.isActive === true);

  // The item was already toggled to available:false earlier in this leg, so a
  // second out-of-stock action must match nothing (R9 — an already-out-of-
  // stock item is excluded by the state filter).
  const bulkStock = await asJson(await productBulkRoute.POST(req("POST", "/api/products/bulk", { action: "out-of-stock", ids: [pid] })));
  check("staff bulk out-of-stock -> 200 with counts", bulkStock.status === 200);
  const bulkBody = bulkStock.body.data as { requested: number; matched: number } | undefined;
  check("bulk out-of-stock counts: requested 1, matched 0 (item was already out-of-stock)", bulkBody?.requested === 1 && bulkBody?.matched === 0);

  currentRole = "admin";
}

// G1 regression (arbitrated BLOCKER fix) — createItemRoute's PUT must NOT
// 403 every non-admin on entities that never opted into the staff-scoped
// discipline. Reservations and events set no staffUpdateFields, so a staff
// PUT on either must still return 200 and the document must actually change,
// exactly as it did before the R1 work (Seat button, reservation status,
// EventFormSheet edits).
async function legStaffReservationEvent(): Promise<void> {
  console.log("L1b — G1 regression: staff PUT on a reservation and an event both return 200 and the document changes");
  currentRole = "staff";

  const reservation = await Reservation.create({
    name: "G1 Regression",
    mobile: "9999900001",
    date: "2026-10-01",
    time: "19:00",
    guests: 2,
    status: "Booked",
  });
  const reservationId = String(reservation._id);
  const seatReply = await asJson(
    await reservationItemRoute.PUT(req("PUT", `/api/reservations/${reservationId}`, { status: "Seated" }), params(reservationId)),
  );
  check("staff PUT /api/reservations/[id] {status:'Seated'} -> 200 (Seat button)", seatReply.status === 200);
  const reservationAfter = await Reservation.findById(reservationId).lean();
  check("the reservation's status actually changed to Seated", reservationAfter?.status === "Seated");

  const event = await Event.create({
    name: "G1 Regression",
    mobile: "9999900002",
    date: "2026-10-02",
    time: "20:00",
    eventName: "Birthday",
    payable: 5000,
    advance: 0,
    payMode: "Cash",
    status: "Booked",
  });
  const eventId = String(event._id);
  const eventReply = await asJson(
    await eventItemRoute.PUT(req("PUT", `/api/events/${eventId}`, { status: "Completed" }), params(eventId)),
  );
  check("staff PUT /api/events/[id] {status:'Completed'} -> 200 (EventFormSheet edit)", eventReply.status === 200);
  const eventAfter = await Event.findById(eventId).lean();
  check("the event's status actually changed to Completed", eventAfter?.status === "Completed");

  currentRole = "admin";
}

// G7 regression — DELETE /api/categories/[id] must stay admin-only even for
// an EMPTY category (no products/items linked) that would otherwise pass the
// 409 in-use guard; a staff session must never reach the delete itself.
async function legStaffCategoryDelete(): Promise<void> {
  console.log("L1c — G7 regression: a staff DELETE on an EMPTY category is 403, and the category still exists");
  currentRole = "staff";

  const emptyCatId = await seedCategory("G7 Empty Category");
  const del = await asJson(await categoryItemRoute.DELETE(req("DELETE", `/api/categories/${emptyCatId}`), params(emptyCatId)));
  check("staff DELETE /api/categories/[id] on an EMPTY category -> 403 (never reaches the in-use guard)", del.status === 403);
  const stillThere = await Category.findById(emptyCatId).lean();
  check("the category still exists after the refused delete", stillThere !== null);

  currentRole = "admin";
}

// ── Icon: set, null-clears, unknown-key rejected, CSV re-import preserves ──
async function legIcon(): Promise<void> {
  console.log("L2 — icon: set/clear via PUT, unknown key 400, CSV re-import keeps the icon");
  const catId = await seedCategory("Icon Cat");
  const create = await asJson(await productsRoute.POST(req("POST", "/api/products", { name: "Cold Coffee", categoryId: catId, price: 120, icon: "coffee" })));
  check("admin create with icon:'coffee' -> 201", create.status === 201);
  const pid = String((create.body.data as { _id: string })._id);

  const unknownIcon = await asJson(await productItemRoute.PUT(req("PUT", `/api/products/${pid}`, { icon: "not-a-real-icon" }), params(pid)));
  check("PUT icon: an unknown key -> 400", unknownIcon.status === 400);

  const beforeClear = await Product.findById(pid).lean();
  check("vision guard: icon is really 'coffee' (present) BEFORE the clear — otherwise the absence check below would pass vacuously", beforeClear?.icon === "coffee");

  const clear = await asJson(await productItemRoute.PUT(req("PUT", `/api/products/${pid}`, { icon: null }), params(pid)));
  check("PUT icon:null -> 200", clear.status === 200);
  const clearedRaw = await Product.findById(pid).lean();
  check("the document still exists after the clear (vision guard — a missing doc must not pass the absence check vacuously)", clearedRaw !== null);
  check("icon confirmed ABSENT from the raw document after the clear", clearedRaw !== null && Object.hasOwn(clearedRaw, "icon") === false);

  const resetIcon = await asJson(await productItemRoute.PUT(req("PUT", `/api/products/${pid}`, { icon: "pizza" }), params(pid)));
  check("PUT icon:'pizza' -> 200 (re-set after clearing)", resetIcon.status === 200);
  const beforeImport = await Product.findById(pid).lean();
  check("icon is really 'pizza' before the re-import (vision guard)", beforeImport?.icon === "pizza");

  const reimport = await asJson(
    await productImportRoute.POST(
      req("POST", "/api/products/import", { dryRun: false, rows: [{ name: "Cold Coffee", category: "Icon Cat", price: "130" }] }),
    ),
  );
  check("admin CSV re-import of the same name -> 200", reimport.status === 200);
  const afterImport = await Product.findById(pid).lean();
  check("price updated by the re-import", afterImport?.price === 130);
  check("icon SURVIVES the re-import — the $set never names icon", afterImport?.icon === "pizza");
}

// ── Public menu: emits a real icon, omits it for a legacy/stale key ────────
async function legPublicMenu(): Promise<void> {
  console.log("L3 — public menu: emits a real catalogue icon, omits an absent or stale one");
  const catId = await seedCategory("Public Cat");
  const withIcon = await seedProduct({ categoryId: catId, name: "Iced Tea", icon: "cup-soda" });
  const withStaleIcon = await seedProduct({ categoryId: catId, name: "Old Item", icon: "a-retired-icon-key" });
  const legacy = await seedProduct({ categoryId: catId, name: "Legacy Item" });

  clearCaches();
  const res = await publicMenuRoute.GET();
  const body = (await res.json()) as { success: boolean; data?: { items: Array<{ id: string; name: string; icon?: string }> } };
  const items = body.data?.items ?? [];
  const byId = new Map(items.map((i) => [i.id, i]));

  check("public menu 200", res.status === 200);
  check("vision guard: all three seeded items actually appear in the public payload", byId.has(withIcon) && byId.has(withStaleIcon) && byId.has(legacy));
  check("the real catalogue icon rides onto the public payload", byId.get(withIcon)?.icon === "cup-soda");
  check("a stale/unknown icon key is omitted, not published as-is", byId.has(withStaleIcon) && byId.get(withStaleIcon)?.icon === undefined);
  check("a legacy item with no icon carries no icon key at all", byId.get(legacy) !== undefined && !Object.hasOwn(byId.get(legacy) ?? {}, "icon"));
}

// ── Reorder: permute -> 0..n-1; stale list -> 409, orders unchanged ────────
async function legReorder(): Promise<void> {
  console.log("L4 — categories PATCH: permute succeeds (0..n-1, no dupes); partial/unknown/stale-by-new-category all 409 with orders unchanged");
  const a = await seedCategory("Reorder A");
  const b = await seedCategory("Reorder B");
  const c = await seedCategory("Reorder C");
  // The PATCH's same-id-set check compares against EVERY category in the DB,
  // not just this leg's three — earlier legs seeded their own categories too.
  const otherIds = (await Category.find({ _id: { $nin: [a, b, c] } }).select("_id").lean()).map((d) => String(d._id));
  const fullSet = (order: string[]) => [...order, ...otherIds];

  const permuted = await asJson(await categoriesRoute.PATCH(req("PATCH", "/api/categories", { ids: fullSet([c, a, b]) })));
  check("a full permutation -> 200", permuted.status === 200);
  const afterPermute = await Category.find({ _id: { $in: [a, b, c] } }).select("order").lean();
  const orderOf = (id: string) => afterPermute.find((d) => String(d._id) === id)?.order;
  check("orders land as 0..n-1 with no duplicates, matching the submitted order", orderOf(c) === 0 && orderOf(a) === 1 && orderOf(b) === 2);

  const beforePartial = await Category.find({ _id: { $in: [a, b, c] } }).select("order").lean();
  const partial = await asJson(await categoriesRoute.PATCH(req("PATCH", "/api/categories", { ids: [a, b] })));
  check("a PARTIAL list (missing everything else) -> 409", partial.status === 409);
  const unknown = await asJson(await categoriesRoute.PATCH(req("PATCH", "/api/categories", { ids: fullSet([a, b, c, "64f0000000000000000000ff"]) })));
  check("a list with an UNKNOWN id -> 409", unknown.status === 409);

  // A new category was created since the client's list was loaded — the old
  // full list is now stale (missing the newest member).
  const d = await seedCategory("Reorder D — added after load");
  const stale = await asJson(await categoriesRoute.PATCH(req("PATCH", "/api/categories", { ids: fullSet([a, b, c]) })));
  check("a list made stale by a NEW category -> 409", stale.status === 409);
  const afterAllRefusals = await Category.find({ _id: { $in: [a, b, c] } }).select("order").lean();
  check(
    "none of the three refused PATCHes changed any order",
    JSON.stringify(beforePartial.map((x) => x.order).sort()) === JSON.stringify(afterAllRefusals.map((x) => x.order).sort()),
  );

  // R12 — ?fresh=1 sees category d immediately; the cached list may not.
  cache.set("categories", await Category.find().sort({ order: 1, name: 1 }).lean(), 300);
  const freshRes = await categoriesRoute.GET(new Request("http://live.test/api/categories?fresh=1"));
  const freshBody = (await freshRes.json()) as { data: Array<{ _id: string }> };
  check("?fresh=1 sees the new category even though a stale copy sits in the cache", freshBody.data.some((x) => String(x._id) === d));
}

// ── Bulk move to a missing category: 400, writes nothing ──────────────────
async function legBulkMoveMissing(): Promise<void> {
  console.log("L5 — bulk move to a missing category: 400, no product changed");
  const pid = await seedProduct({ name: "Move Me" });
  const before = await Product.findById(pid).lean();
  const res = await asJson(await productBulkRoute.POST(req("POST", "/api/products/bulk", { action: "move", ids: [pid], categoryId: "64f0000000000000000000ff" })));
  check("bulk move to an unknown categoryId -> 400", res.status === 400);
  const after = await Product.findById(pid).lean();
  check("the product's categoryId is untouched", String(after?.categoryId) === String(before?.categoryId));
}

// ── R9 counts: an already-out-of-stock item is not "matched" again ─────────
async function legBulkCounts(): Promise<void> {
  console.log("L6 — bulk counts: an already-out-of-stock item is not matched by a second out-of-stock action");
  const p1 = await seedProduct({ available: false, name: "Already Out" });
  const p2 = await seedProduct({ available: true, name: "Still In" });
  const res = await asJson(await productBulkRoute.POST(req("POST", "/api/products/bulk", { action: "out-of-stock", ids: [p1, p2] })));
  const body = res.body.data as { requested: number; matched: number };
  check("requested 2, matched 1 (only the still-in-stock item counted)", body.requested === 2 && body.matched === 1);
}

// G17 — the products routes' generated messages must read "item"/"items".
async function legItemWording(): Promise<void> {
  console.log("L8 — G17: crud-route's generated messages read 'Item not found', not 'Product not found'");
  const missingId = "64f0000000000000000000fe";
  const res = await asJson(await productItemRoute.GET(req("GET", `/api/products/${missingId}`), params(missingId)));
  check("GET /api/products/[missing] -> 404 'Item not found'", res.status === 404 && res.body.error === "Item not found");
}

async function legBootstrap(): Promise<void> {
  console.log("L7 — bootstrap version");
  // Menu B1 bumped to 4 (Product.icon); Tables B1 moved it on to 5 (Settings).
  check("BOOTSTRAP_VERSION >= 4 (Menu B1 bump still in force)", bootstrapContract.BOOTSTRAP_VERSION >= 4);
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

  productsRoute = await import("@/app/api/products/route");
  productItemRoute = await import("@/app/api/products/[id]/route");
  productBulkRoute = await import("@/app/api/products/bulk/route");
  productImportRoute = await import("@/app/api/products/import/route");
  categoriesRoute = await import("@/app/api/categories/route");
  categoryItemRoute = await import("@/app/api/categories/[id]/route");
  uploadRoute = await import("@/app/api/upload/route");
  publicMenuRoute = await import("@/app/api/public/menu/route");
  bootstrapContract = await import("@/lib/bootstrap-contract");
  reservationItemRoute = await import("@/app/api/reservations/[id]/route");
  eventItemRoute = await import("@/app/api/events/[id]/route");

  await connectDB();
  console.log(`\nMenu redesign Slice A — live against ${dbName}\n`);

  try {
    await legStaffFence();
    await legStaffReservationEvent();
    await legStaffCategoryDelete();
    await legIcon();
    await legPublicMenu();
    await legReorder();
    await legBulkMoveMissing();
    await legBulkCounts();
    await legItemWording();
    await legBootstrap();
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
