/**
 * Combined seeder — runs admin + tables in sequence over one connection.
 * Run with:  npm run seed
 *
 * Both seeders call connectDB() (cached on global), so they share a single
 * MongoDB connection; this script owns the disconnect.
 */
import mongoose from "mongoose";
import { seedAdmin } from "./seed-admin";
import { seedTables } from "./seed-tables";

async function seed() {
  await seedAdmin();
  await seedTables();
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
