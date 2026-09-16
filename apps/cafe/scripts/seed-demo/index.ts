/**
 * Demo-account seeder CLI — drops a demo cafe's WHOLE database and rebuilds
 * it with ~1 month of realistic data (menu with photos, customers, orders,
 * dues, events, reservations, self-order requests) for prospect demos.
 *
 *   node --import tsx scripts/seed-demo/index.ts --file ../../clients/<slug>.json [--images <dir>] [--seed <n>]
 *
 * env: MONGODB_URI RESET_CONFIRM_SLUG RESET_CONFIRM_DB SEED_ADMIN_USERNAME SEED_ADMIN_PASSWORD
 *      [R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET NEXT_PUBLIC_R2_PUBLIC_BASE_URL]
 *      [DEMO_IMAGES_DIR] [DEMO_SEED]
 *
 * Three guards, ALL required, identical to reset-demo-db.ts — a live cafe's
 * database must never be reachable from here:
 *   1. the client file says `"demo": true`
 *   2. RESET_CONFIRM_SLUG equals the file's slug (the owner typed it)
 *   3. RESET_CONFIRM_DB equals the database name inside MONGODB_URI
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { readFileSync } from "node:fs";
import mongoose, { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { gstConfigOf } from "@/lib/settings";
import { printConfigOf } from "@/lib/print";
import { Settings, type ISettings } from "@/models/Settings";
import { Category } from "@/models/Category";
import { Table } from "@/models/Table";
import { Event } from "@/models/Event";
import { Reservation } from "@/models/Reservation";
import { DuePayment } from "@/models/DuePayment";
import { redactSeedError } from "../seed-client";
import { DEMO_CATEGORIES, DEMO_PRODUCTS } from "./menu-data";
import { DEMO_CUSTOMERS, DEMO_STAFF } from "./people-data";
import { createRng, dayKeysEndingToday } from "./rng";
import { planOrders } from "./orders-plan";
import { planExtras } from "./extras-plan";
import { uploadDemoImages } from "./images";
import { seedBase, seedStaff, seedTables, seedMenu, seedCustomers, backdatedRaw } from "./seed-core";
import { writeOrders } from "./orders-write";
import { applyCustomerRollups, verifySeed } from "./finalize";
import { seedLoyaltyRules, applyLoyaltyCustomerData } from "./loyalty-data";
import type { PlannedCustomer, PlanContext, SeedDemoSummary } from "./types";

const DEMO_SEED_DEFAULT = 20260913;
const DEMO_DAYS = 31;
const TOP_PRODUCTS_SHOWN = 3;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// seedBase's `client.cafe` parameter type comes from seed-client.ts's
// unexported CafeBlock interface — derived structurally (see seed-core.ts's
// own CafeBlock alias) rather than re-declaring the shape here.
type CafeBlock = Parameters<typeof seedBase>[0]["cafe"];

interface DemoClientFile {
  slug: string;
  demo: boolean;
  cafe: CafeBlock;
  tables: number | string[];
}

function readClientFile(file: string): DemoClientFile {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(parsed) || typeof parsed.slug !== "string") throw new Error("client file: slug missing");
  if (!isRecord(parsed.cafe) || typeof parsed.cafe.name !== "string" || !parsed.cafe.name.trim()) {
    throw new Error("client file: cafe.name is required");
  }
  const tables = parsed.tables;
  if (typeof tables !== "number" && !Array.isArray(tables)) {
    throw new Error('client file: "tables" is required — a count or a list of table names');
  }
  return {
    slug: parsed.slug,
    demo: parsed.demo === true,
    // Shape beyond the name check above is validated by scripts/go-live/lib.mjs
    // before this ever runs (mirrors seed-client.ts's own readClientFile cast).
    cafe: parsed.cafe as unknown as CafeBlock,
    tables: tables as number | string[],
  };
}

function dbNameOf(uri: string | undefined): string | null {
  const m = typeof uri === "string" ? uri.match(/^mongodb(?:\+srv)?:\/\/[^/?]+\/([^/?]+)/) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

function parseArgs(argv: string[]): { file: string; imagesDir: string | null; seed: number } {
  const fileFlag = argv.indexOf("--file");
  const file = fileFlag >= 0 ? argv[fileFlag + 1] : undefined;
  if (!file) throw new Error("usage: node --import tsx scripts/seed-demo/index.ts --file <clients/<slug>.json> [--images <dir>] [--seed <n>]");
  const imagesFlag = argv.indexOf("--images");
  const imagesDir = imagesFlag >= 0 ? argv[imagesFlag + 1] : (process.env.DEMO_IMAGES_DIR ?? null);
  const seedFlag = argv.indexOf("--seed");
  const seed = seedFlag >= 0 ? Number(argv[seedFlag + 1]) : Number(process.env.DEMO_SEED ?? DEMO_SEED_DEFAULT);
  return { file, imagesDir: imagesDir || null, seed };
}

/** Run the demo seed end-to-end against the currently-connected default
 *  connection. Exported for the live leg (verify-seed-demo-live.ts), which
 *  drives this the same way the CLI's main() does. */
export async function runSeedDemo(opts: { file: string; imagesDir: string | null; seed: number; now?: Date }): Promise<SeedDemoSummary> {
  const client = readClientFile(opts.file);
  if (client.demo !== true) {
    throw new Error(`refused: "${client.slug}" is not marked as a demo client (Status → Safety → Demo client). A live cafe's database is never seeded from here.`);
  }
  const dbName = dbNameOf(process.env.MONGODB_URI);
  if (!dbName) throw new Error("refused: MONGODB_URI has no database name");
  if (process.env.RESET_CONFIRM_SLUG !== client.slug) {
    throw new Error(`refused: confirmation "${process.env.RESET_CONFIRM_SLUG ?? ""}" does not equal the slug "${client.slug}"`);
  }
  if (process.env.RESET_CONFIRM_DB !== dbName) {
    throw new Error(`refused: RESET_CONFIRM_DB does not name the database in MONGODB_URI ("${dbName}")`);
  }

  await connectDB();

  console.log(`DEMO SEED "${client.slug}": dropping database "${dbName}" and building ${DEMO_DAYS} days of demo data`);
  const db = mongoose.connection.db;
  if (!db) throw new Error("no database handle after connect");
  await db.dropDatabase();

  const log = (line: string) => console.log(line);

  await seedBase({ cafe: client.cafe, tables: client.tables }, log);

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error("SEED_ADMIN_PASSWORD is required (see seed-admin.ts)");
  const staff = await seedStaff(DEMO_STAFF, adminPassword);

  // Images before the menu so refs exist when products are created.
  const imageResult = await uploadDemoImages(DEMO_PRODUCTS, opts.imagesDir, log);
  if (imageResult.note) log(imageResult.note);

  const products = await seedMenu(DEMO_CATEGORIES, DEMO_PRODUCTS, imageResult.refs);

  // CB-5B S16 — demo loyalty rules: after the menu (the item rung needs a
  // real productId), before planning (the planner needs the rung's cost/dish
  // to plant reward orders against it). seed-client.ts's seedSettings() stays
  // untouched — this write is DEMO SEEDER ONLY.
  const rewardRung = await seedLoyaltyRules(products);

  const now = opts.now ?? new Date();
  const rng = createRng(opts.seed);

  const customerIds = DEMO_CUSTOMERS.map(() => new Types.ObjectId());
  const customersWithIds = DEMO_CUSTOMERS.map((customer, index) => ({ ...customer, _id: customerIds[index] }));

  const tables = await seedTables(client.tables, rng);

  // Read directly (never getSettings()/readSettings()): those share a
  // process-level cache across runs, and a live leg that seeds twice in one
  // process must never see a prior run's stale Settings doc. Cast mirrors
  // lib/settings.ts's own getSettings() — a lean read is a plain object, and
  // every field here has a schema default so the cast is safe.
  const settingsDoc = (await Settings.findOne().lean()) as unknown as ISettings;
  if (!settingsDoc) throw new Error("seedBase did not create a Settings document");
  const gst = gstConfigOf(settingsDoc);
  const print = printConfigOf(settingsDoc);
  const days = dayKeysEndingToday(now, DEMO_DAYS);

  // planOrders needs customer _ids up front (it assigns customerId directly),
  // so customers are inserted using placeholder rollups (0/0/0) BEFORE their
  // real createdAt is known — seedCustomers backfills createdAt once planning
  // has produced each customer's first order instant.
  const planContext: PlanContext = {
    products,
    tables,
    customers: customersWithIds.map((c) => ({ _id: c._id, name: c.name, mobile: c.mobile, notes: c.notes })),
    staff,
    gst,
    print,
    days,
    now,
    rng,
    rewardRung,
  };

  const ordersPlan = planOrders(planContext);
  const occupiedTables = ordersPlan.tableStates.filter((s) => s.status === "Occupied").map((s) => s.tableNo);
  const extrasPlan = planExtras(planContext, ordersPlan.orders, occupiedTables);

  const firstOrderAt = new Map<string, Date>();
  for (const order of ordersPlan.orders) {
    if (!order.customerId) continue;
    const customer = customersWithIds.find((c) => c._id.equals(order.customerId!));
    if (!customer) continue;
    const existing = firstOrderAt.get(customer.mobile);
    if (!existing || order.createdAt < existing) firstOrderAt.set(customer.mobile, order.createdAt);
  }
  const rangeStart = new Date(planContext.now);
  const seededCustomers: PlannedCustomer[] = await seedCustomers(customersWithIds, firstOrderAt, rangeStart, rng);

  await writeOrders(ordersPlan);

  // CB-5B S16 — stamps + redemption claims, after the orders are written and
  // customers exist with their real _ids: every reward order's customer gets
  // its rung cost debited and the orderId recorded spent; a further random
  // share of customers gets a starting stamp balance so the loyalty screens
  // are not empty for everyone else.
  await applyLoyaltyCustomerData(seededCustomers, ordersPlan.orders, rewardRung, rng);

  const eventDocs = extrasPlan.events.map((event) => backdatedRaw(Event, event as unknown as Record<string, unknown> & { createdAt: Date; updatedAt: Date }));
  if (eventDocs.length > 0) await Event.collection.insertMany(eventDocs, { ordered: true });

  const reservationDocs = extrasPlan.reservations.map((reservation) =>
    backdatedRaw(Reservation, reservation as unknown as Record<string, unknown> & { createdAt: Date; updatedAt: Date }),
  );
  if (reservationDocs.length > 0) await Reservation.collection.insertMany(reservationDocs, { ordered: true });

  const dueDocs = extrasPlan.duePayments.map((due) => backdatedRaw(DuePayment, due as unknown as Record<string, unknown> & { createdAt: Date; updatedAt: Date }));
  if (dueDocs.length > 0) await DuePayment.collection.insertMany(dueDocs, { ordered: true });

  if (extrasPlan.reservedTable) {
    await Table.updateOne({ tableNo: extrasPlan.reservedTable.tableNo }, { $set: { status: "Reserved" } });
  }

  await applyCustomerRollups(ordersPlan.orders, extrasPlan.duePayments);

  const verify = await verifySeed(ordersPlan, extrasPlan, gst, log);

  const categoriesCount = await Category.countDocuments();
  const completed = ordersPlan.orders.filter((o) => o.status === "Completed");
  const pending = ordersPlan.orders.filter((o) => o.status === "Pending");
  const cancelled = ordersPlan.orders.filter((o) => o.status === "Cancelled");
  const selfOrder = ordersPlan.orders.filter((o) => o.source === "qr");
  const sales = completed.reduce((sum, o) => sum + o.total, 0);

  const topByRevenue = new Map<string, number>();
  for (const order of completed) {
    for (const item of order.items) {
      topByRevenue.set(item.name, (topByRevenue.get(item.name) ?? 0) + item.price * item.qty);
    }
  }
  const topProducts = [...topByRevenue.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_PRODUCTS_SHOWN);

  const summary: SeedDemoSummary = {
    slug: client.slug,
    dbName,
    days: { from: days[0], to: days[days.length - 1], count: days.length },
    categories: categoriesCount,
    products: products.length,
    imagesUploaded: imageResult.uploaded,
    imagesSkipped: imageResult.skipped,
    tables: tables.length,
    staff: staff.length,
    customers: seededCustomers.length,
    orders: { total: ordersPlan.orders.length, completed: completed.length, pending: pending.length, cancelled: cancelled.length, selfOrder: selfOrder.length },
    sales,
    duePayments: extrasPlan.duePayments.length,
    events: extrasPlan.events.length,
    reservations: extrasPlan.reservations.length,
    orderRequests: ordersPlan.requests.length,
    verify,
  };

  log("");
  log(`Demo data for "${summary.slug}": ${summary.days.count} days (${summary.days.from} … ${summary.days.to})`);
  log(`  Categories: ${summary.categories} · Products: ${summary.products} (${summary.imagesUploaded} photos uploaded, ${summary.imagesSkipped} skipped)`);
  log(`  Tables: ${summary.tables} · Staff: ${summary.staff} · Customers: ${summary.customers}`);
  log(`  Orders: ${summary.orders.total} (${summary.orders.completed} completed, ${summary.orders.pending} pending, ${summary.orders.cancelled} cancelled, ${summary.orders.selfOrder} self-order)`);
  log(`  Sales: ₹${summary.sales} · Due payments: ${summary.duePayments} · Events: ${summary.events} · Reservations: ${summary.reservations} · Self-order requests: ${summary.orderRequests}`);
  if (topProducts.length > 0) {
    log(`  Top products by revenue: ${topProducts.map(([name, revenue]) => `${name} (₹${revenue})`).join(", ")}`);
  }
  const adminUsername = (process.env.SEED_ADMIN_USERNAME ?? "admin").toLowerCase();
  log(`  Logins: admin = ${adminUsername}; staff priya / rahul / amit use the admin password`);
  log(`  Verify: ${summary.verify.passed} passed, ${summary.verify.failed} failed`);

  return summary;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const summary = await runSeedDemo(opts);
  await mongoose.disconnect();
  if (summary.verify.failed > 0) {
    console.error(`${summary.verify.failed} verify check(s) failed — data was NOT rolled back. Re-run the seed — it drops and rebuilds from scratch.`);
    process.exit(1);
  }
}

// Run standalone only when invoked directly — not when imported by the live leg.
const isMain = (process.argv[1] ?? "").replace(/\\/g, "/").endsWith("scripts/seed-demo/index.ts");
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(redactSeedError(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    });
}
