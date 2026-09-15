/**
 * Live leg for the demo seeder — proves the Mongoose insert shapes, indexes,
 * and backdated timestamps actually work against a REAL MongoDB, which the
 * pure-planner unit tests cannot. Runs the full CLI (`runSeedDemo`) against a
 * scratch database, then re-checks a sample of its own claims independently.
 *
 *   npm run verify:seed-demo:live
 *   SEED_DEMO_LIVE_URI=mongodb://127.0.0.1:27017/seeddemo_scratch_x npm run verify:seed-demo:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix; drops the scratch database when done. No R2 env is set, so
 * images are skipped — this leg never touches a real object store.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose, { Types } from "mongoose";
import { Order } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { Table } from "@/models/Table";
import { Counter } from "@/models/Counter";
import { duesPaidTotal } from "@/lib/due-payment";
import { cafeDateString, dayRange } from "@/lib/utils";
import { runSeedDemo } from "./seed-demo/index";

const SCRATCH_PREFIX = "seeddemo_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}live`;
const MIN_DISTINCT_DAYS = 28;
const EXPECTED_PENDING = 3;
const SAMPLE_CUSTOMER_COUNT = 3;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

function dbNameOf(uri: string): string {
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/?]+\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function main(): Promise<void> {
  const uri = process.env.SEED_DEMO_LIVE_URI ?? DEFAULT_URI;
  const dbName = dbNameOf(uri);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" — this live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }

  const clientPath = join(tmpdir(), `seeddemo-live-client-${process.pid}.json`);
  const clientFile = {
    slug: "seeddemo-live",
    demo: true,
    cafe: {
      name: "Demo Verify Cafe",
      tagline: "",
      mobile: "",
      address: "",
      receiptFooter: "",
      fssai: "",
      gst: { enabled: true, number: "", rate: 5, mode: "inclusive" },
    },
    tables: 10,
  };
  writeFileSync(clientPath, JSON.stringify(clientFile), "utf8");

  process.env.MONGODB_URI = uri;
  process.env.RESET_CONFIRM_SLUG = clientFile.slug;
  process.env.RESET_CONFIRM_DB = dbName;
  process.env.SEED_ADMIN_USERNAME = "admin";
  process.env.SEED_ADMIN_PASSWORD = "Demo-Pass-1!";
  // No R2 env — images must be skipped, never touching a real object store.
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_BUCKET;
  delete process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;

  console.log(`\nDemo seed live leg — against ${dbName}\n`);

  try {
    const summary = await runSeedDemo({ file: clientPath, imagesDir: null, seed: 20260913 });

    check("summary.verify.failed === 0", summary.verify.failed === 0);
    check(`images skipped (no R2 configured): note present`, summary.imagesUploaded === 0 && summary.imagesSkipped > 0);

    const distinctDays = (await Order.distinct("createdAt")).map((d) => cafeDateString(d as Date));
    const uniqueDays = new Set(distinctDays).size;
    check(`>= ${MIN_DISTINCT_DAYS} distinct IST days with orders (${uniqueDays})`, uniqueDays >= MIN_DISTINCT_DAYS);

    const pendingOrders = await Order.find({ status: "Pending" }).lean();
    check(`today's Pending === ${EXPECTED_PENDING}`, pendingOrders.length === EXPECTED_PENDING);
    const pendingTableNos = new Set(pendingOrders.map((o) => o.tableNo).filter((t): t is string => !!t));
    const occupiedTables = await Table.find({ status: "Occupied" }).lean();
    const occupiedTableNos = new Set(occupiedTables.map((t) => t.tableNo));
    check(
      "every Pending order's table is Occupied",
      [...pendingTableNos].every((t) => occupiedTableNos.has(t)) && pendingTableNos.size === occupiedTableNos.size,
    );

    const now = new Date();
    const range = dayRange(now);
    const todaysOrders = await Order.find({ createdAt: { $gte: range.start, $lte: range.end } }).lean();
    check("Order.find(dayRange(today)) is non-empty", todaysOrders.length > 0);

    const customersWithOrders = await Order.distinct("customerId", { customerId: { $ne: null } });
    const sample = customersWithOrders.slice(0, SAMPLE_CUSTOMER_COUNT);
    let rollupMismatch = false;
    for (const rawId of sample) {
      const customerId = new Types.ObjectId(String(rawId));
      const [agg] = await Order.aggregate([
        { $match: { customerId, status: { $ne: "Cancelled" } } },
        {
          $group: {
            _id: null,
            visits: {
              $sum: {
                $cond: [{ $or: [{ $eq: ["$payment", "Unpaid"] }, { $eq: ["$status", "Cancelled"] }] }, 0, 1],
              },
            },
            totalSpend: {
              $sum: {
                $cond: [{ $or: [{ $eq: ["$payment", "Unpaid"] }, { $eq: ["$status", "Cancelled"] }] }, 0, "$total"],
              },
            },
            totalDue: {
              $sum: {
                $cond: [
                  { $or: [{ $eq: ["$payment", "Unpaid"] }, { $eq: ["$status", "Cancelled"] }] },
                  0,
                  { $max: [0, { $subtract: ["$total", "$paidAmount"] }] },
                ],
              },
            },
          },
        },
      ]);
      const paidDues = await duesPaidTotal(customerId.toString());
      const expectedDue = Math.max(0, (agg?.totalDue ?? 0) - paidDues);
      const customer = await Customer.findById(customerId).lean();
      if (!customer || customer.visits !== (agg?.visits ?? 0) || customer.totalSpend !== (agg?.totalSpend ?? 0) || customer.totalDue !== expectedDue) {
        rollupMismatch = true;
      }
    }
    check(`reconcile-style aggregate equals stored rollups for ${sample.length} sampled customers`, !rollupMismatch);

    const todayKey = cafeDateString(now).replace(/-/g, "");
    const todayOrderCounter = await Counter.findById(`order-${todayKey}`).lean();
    const todaysOrderCount = todaysOrders.length;
    check(
      `Counter order-${todayKey} (${todayOrderCounter?.seq ?? 0}) === today's order count (${todaysOrderCount})`,
      (todayOrderCounter?.seq ?? 0) === todaysOrderCount,
    );
  } finally {
    const db = mongoose.connection.db;
    if (db) await db.dropDatabase();
    await mongoose.disconnect();
    try {
      unlinkSync(clientPath);
    } catch {
      // best-effort cleanup of the temp client file
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
