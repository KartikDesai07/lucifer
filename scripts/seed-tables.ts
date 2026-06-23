/**
 * Seed the 8 fixed cafe tables (T-1 .. T-8).
 * Standalone:  npm run seed:tables
 * Also called by the combined seeder (npm run seed).
 *
 * Idempotent: $setOnInsert only writes on first insert, so re-running never
 * resets the live status of a table that is already Occupied/Reserved.
 * (console output is intentional — this is an ops CLI script, not app code).
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import { TABLE_NUMBERS } from "@/lib/constants";

export async function seedTables() {
  await connectDB();

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
