/**
 * Seed the initial admin account.
 * Standalone:  npm run seed:admin
 * Also called by the combined seeder (npm run seed).
 *
 * Override defaults via env: SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD
 * (console output is intentional — this is an ops CLI script, not app code).
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/db";
import { Staff } from "@/models/Staff";

export async function seedAdmin() {
  const username = (process.env.SEED_ADMIN_USERNAME ?? "admin").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  // No baked-in default credential. Require a strong password up front so a
  // production seed can never leave a publicly-known login (CLAUDE.md §8).
  if (!password) {
    throw new Error(
      "SEED_ADMIN_PASSWORD is required. Set a strong password, e.g.\n" +
        "  SEED_ADMIN_PASSWORD='Your$trongPass1' npm run seed:admin",
    );
  }
  const strong = password.length >= 8 && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
  if (!strong) {
    throw new Error(
      "SEED_ADMIN_PASSWORD must be at least 8 characters and include a number and a special character.",
    );
  }

  await connectDB();

  const existing = await Staff.findOne({ role: "admin" });
  if (existing) {
    console.log(`Admin already exists: ${existing.username}`);
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  await Staff.create({
    name: "Admin",
    username,
    mobile: "0000000000",
    password: hashedPassword,
    role: "admin",
    isActive: true,
  });

  console.log("Admin account created.");
  console.log(`  Username: ${username}`);
  console.log("  Password: (the SEED_ADMIN_PASSWORD you provided)");
}

// Run standalone only when invoked directly — not when imported by seed.ts.
const isMain = (process.argv[1] ?? "")
  .replace(/\\/g, "/")
  .endsWith("scripts/seed-admin.ts");
if (isMain) {
  seedAdmin()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
