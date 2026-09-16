/**
 * DEMO ONLY — drop a demo cafe's WHOLE database and seed it fresh from its
 * go-live client file (settings, admin, tables, starter menu). Run by the owner
 * console's "Reset demo database"; standalone:
 *   MONGODB_URI=… RESET_CONFIRM_SLUG=<slug> RESET_CONFIRM_DB=<dbname> SEED_ADMIN_USERNAME=… SEED_ADMIN_PASSWORD=… \
 *     npm run reset:demo -- --file ../../clients/<slug>.json
 *
 * Three independent guards, ALL required — a live cafe's database must never be
 * reachable from here:
 *   1. the client file says `"demo": true`
 *   2. RESET_CONFIRM_SLUG equals the file's slug (the owner typed it)
 *   3. RESET_CONFIRM_DB equals the database name inside MONGODB_URI
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { redactSeedError, seedClient } from "./seed-client";

function dbNameOf(uri: string | undefined): string | null {
  const m = typeof uri === "string" ? uri.match(/^mongodb(?:\+srv)?:\/\/[^/?]+\/([^/?]+)/) : null;
  return m ? decodeURIComponent(m[1]) : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function main(): Promise<void> {
  const fileFlag = process.argv.indexOf("--file");
  const file = fileFlag >= 0 ? process.argv[fileFlag + 1] : undefined;
  if (!file) throw new Error("usage: npm run reset:demo -- --file <clients/<slug>.json>");
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(parsed) || typeof parsed.slug !== "string") throw new Error("client file: slug missing");
  if (parsed.demo !== true) throw new Error(`refused: "${parsed.slug}" is not marked as a demo client (Status → Safety → Demo client). A live cafe's database is never reset from here.`);
  const slug = parsed.slug;
  const dbName = dbNameOf(process.env.MONGODB_URI);
  if (!dbName) throw new Error("refused: MONGODB_URI has no database name");
  if (process.env.RESET_CONFIRM_SLUG !== slug) throw new Error(`refused: confirmation "${process.env.RESET_CONFIRM_SLUG ?? ""}" does not equal the slug "${slug}"`);
  if (process.env.RESET_CONFIRM_DB !== dbName) throw new Error(`refused: RESET_CONFIRM_DB does not name the database in MONGODB_URI ("${dbName}")`);

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("no database handle after connect");
  const before = (await db.listCollections().toArray()).length;
  await db.dropDatabase();
  console.log(`Demo database "${dbName}" dropped (${before} collections). Seeding fresh…`);
  await seedClient(file);
  await mongoose.disconnect();
  console.log(`Demo "${slug}" is fresh: settings, admin, tables and starter menu re-created.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(redactSeedError(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
