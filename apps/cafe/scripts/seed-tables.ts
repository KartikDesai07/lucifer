/**
 * Bootstrap a brand-new cafe with eight default tables (T-1 .. T-8).
 * Standalone:  npm run seed:tables
 * Also called by the combined seeder (npm run seed).
 *
 * EMPTY-DB BOOTSTRAP ONLY (CR1.1). Tables are dynamic now — a cafe defines its
 * own floor plan from the admin Tables page. So this bails out the moment ANY
 * table exists: re-running the seeder after an admin has renamed or deleted the
 * defaults must never resurrect them. TABLE_NUMBERS exists for this file alone;
 * nothing at runtime may validate against it (pinned by a grep test).
 * (console output is intentional — this is an ops CLI script, not app code).
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import { TABLE_NUMBERS } from "@/lib/constants";

export async function seedTables() {
  await connectDB();

  const existing = await Table.countDocuments();
  if (existing > 0) {
    console.log(`${existing} tables already defined — leaving the floor plan alone.`);
    return;
  }

  for (const tableNo of TABLE_NUMBERS) {
    await Table.findOneAndUpdate(
      { tableNo },
      { $setOnInsert: { tableNo, status: "Available", capacity: 4 } },
      { upsert: true },
    );
  }

  console.log(`${TABLE_NUMBERS.length} tables seeded (T-1 .. T-8).`);
}

// Run standalone only when invoked directly — not when imported by seed.ts.
const isMain = (process.argv[1] ?? "")
  .replace(/\\/g, "/")
  .endsWith("scripts/seed-tables.ts");
if (isMain) {
  seedTables()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
