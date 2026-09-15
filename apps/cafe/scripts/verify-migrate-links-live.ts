/**
 * CB-DL-2 S4 live leg — proves the `migrate:links --apply` pipeline against a
 * REAL MongoDB, which the DB-free unit tests (lib/migrate-links-args.test.ts)
 * cannot: that the category back-fill really resolves exact/case-mismatch
 * names and skips an unmatched one, that a reset really empties the listed
 * collections and releases tables, that drop-legacy-category really refuses
 * until every product is migrated and then really drops the field + index,
 * that a re-run is idempotent, and that the FINAL Mongoose shape (Product's
 * `categoryId`, `toPublicMenuItem`'s resolver param) reads the migrated data
 * correctly.
 *
 *   npm run verify:migrate:live         (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_migrate npm run verify:migrate:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix; the CLI it spawns is the SAME `--confirm`-gated pipeline
 * the owner runs, so this leg cannot touch anything outside that database
 * either. Cleans up the stand-in backup file and report files it created.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, unlinkSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ObjectId } from "mongodb";
import mongoose from "mongoose";
import {
  seedFixture,
  MATCHED_PRODUCT_NAME,
  CASE_MISMATCH_PRODUCT_NAME,
  UNMATCHED_PRODUCT_NAME,
  ALREADY_MIGRATED_PRODUCT_NAME,
  UNMATCHED_NAME,
  OCCUPIED_TABLE_NO,
} from "./verify-migrate-links-live/fixture";
import { RESET_DEFAULT_COLLECTIONS } from "./migrate-links/args";
import type { CensusReport } from "./migrate-links/report";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}migrate`;
const CAFE_DIR = fileURLToPath(new URL("..", import.meta.url));
const ENTRY_SCRIPT = "scripts/migrate-links.ts";
const EXIT_OK = 0;
const EXIT_APPLY_NOT_CLEAN = 3;

let passed = 0;
let failed = 0;
const createdReportFiles: string[] = [];

function check(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Spawns the real CLI exactly as the owner would run it — same process,
 * same argv shape — so this leg proves the pipeline end-to-end rather than
 * calling its internals directly. */
function runCli(uri: string, extraArgs: string[], backupFile: string, dbName: string): CliResult {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", ENTRY_SCRIPT, "--uri", uri, "--apply", "--backup", backupFile, "--confirm", dbName, ...extraArgs],
    { cwd: CAFE_DIR, encoding: "utf8" },
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Finds the report file the CLI just wrote (migrate-links-report-<db>-*),
 * newest first, so this leg can inspect the JSON without re-deriving the
 * exact timestamped name the entry script generated. */
function latestReport(dbName: string): CensusReport {
  const prefix = `migrate-links-report-${dbName}-`;
  const files = readdirSync(CAFE_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort();
  const latest = files[files.length - 1];
  if (!latest) throw new Error(`No report file found matching ${prefix}*.json in ${CAFE_DIR}`);
  const fullPath = path.join(CAFE_DIR, latest);
  createdReportFiles.push(fullPath);
  return JSON.parse(readFileSync(fullPath, "utf8")) as CensusReport;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`,
    );
  }

  const conn = await mongoose.createConnection(uri).asPromise();
  const db = conn.db;
  if (!db) throw new Error("Connection has no db handle");
  await conn.dropDatabase();

  console.log(`\nCB-DL-2 migrate:links --apply — live against ${dbName}\n`);

  await seedFixture(db);

  // Stand-in backup file (rehearsal-only — a real run needs a real mongodump
  // archive; parseMigrateArgs only checks existence + freshness of this path).
  const backupFile = path.join(tmpdir(), `verify-migrate-links-backup-${Date.now()}.gz`);
  writeFileSync(backupFile, "stand-in archive — not a real mongodump");

  // ── run 1: no create-missing / no reset / no drop-legacy — expect exit 3 ──
  const run1 = runCli(uri, [], backupFile, dbName);
  check("run 1 (no extra flags) exits with EXIT_APPLY_NOT_CLEAN (3)", run1.status === EXIT_APPLY_NOT_CLEAN);

  const report1 = latestReport(dbName);
  check("run 1 report meta.dryRun === false", report1.meta.dryRun === false);
  check(
    `run 1 report lists the unmatched category name (${UNMATCHED_NAME})`,
    (report1.apply?.steps.categories.skippedNoDoc ?? []).includes(UNMATCHED_NAME),
  );

  const matchedAfter1 = await db.collection("products").findOne({ name: MATCHED_PRODUCT_NAME });
  check(
    "run 1: the EXACT-match product now carries an ObjectId categoryId",
    matchedAfter1?.categoryId instanceof ObjectId,
  );
  const caseAfter1 = await db.collection("products").findOne({ name: CASE_MISMATCH_PRODUCT_NAME });
  check(
    "run 1: the case/space-mismatch product resolved to the single normalized-group category",
    caseAfter1?.categoryId instanceof ObjectId,
  );
  const unmatchedAfter1 = await db.collection("products").findOne({ name: UNMATCHED_PRODUCT_NAME });
  check(
    "run 1: the UNMATCHED product is untouched — still no categoryId, still carries its legacy category name",
    unmatchedAfter1?.categoryId === undefined && unmatchedAfter1?.category === UNMATCHED_NAME,
  );
  check(
    "run 1: matched/case-mismatch products still carry their legacy `category` field (drop-legacy-category was not requested)",
    typeof matchedAfter1?.category === "string" && typeof caseAfter1?.category === "string",
  );

  const ordersAfter1 = await db.collection("orders").countDocuments({});
  const duesAfter1 = await db.collection("duepayments").countDocuments({});
  const tableAfter1 = await db.collection("tables").findOne({ tableNo: OCCUPIED_TABLE_NO });
  check(
    "run 1: no transactional collection was touched (no --reset requested)",
    ordersAfter1 === 1 && duesAfter1 === 1,
  );
  check(
    "run 1: the occupied table is untouched (no --reset orders requested)",
    tableAfter1?.status === "Occupied" && typeof tableAfter1?.currentOrderId === "string",
  );

  // ── run 2: --create-missing-categories --reset default --drop-legacy-category — expect exit 0 ──
  const run2 = runCli(
    uri,
    ["--create-missing-categories", "--reset", "default", "--drop-legacy-category"],
    backupFile,
    dbName,
  );
  check("run 2 (create-missing + reset default + drop-legacy) exits EXIT_OK (0)", run2.status === EXIT_OK);

  const report2 = latestReport(dbName);
  check("run 2 report meta.dryRun === false", report2.meta.dryRun === false);
  check("run 2 report carries a postCensus", report2.postCensus !== undefined);
  check(
    `run 2 report shows the created category (${UNMATCHED_NAME})`,
    (report2.apply?.steps.categories.created ?? []).includes(UNMATCHED_NAME),
  );

  const allProducts = await db.collection("products").find({}).toArray();
  const allHaveObjectIdCategoryId = allProducts.every((p) => p.categoryId instanceof ObjectId);
  check("run 2: every product now has an ObjectId categoryId", allHaveObjectIdCategoryId);
  const noneHaveLegacyField = allProducts.every((p) => !Object.hasOwn(p, "category"));
  check("run 2: no product carries the legacy `category` field any more", noneHaveLegacyField);

  const categories = await db.collection("categories").find({}).toArray();
  const categoryIds = new Set(categories.map((c) => String(c._id)));
  const allResolve = allProducts.every((p) => categoryIds.has(String(p.categoryId)));
  check("run 2: every product's categoryId resolves to a real categories doc", allResolve);
  const snacksCategory = categories.find((c) => c.name === UNMATCHED_NAME);
  check(`run 2: a Category doc named "${UNMATCHED_NAME}" was created`, snacksCategory !== undefined);

  const productIndexes = await db.collection("products").indexes();
  const hasLegacyIndex = productIndexes.some((idx) => idx.name === "category_1");
  check("run 2: the legacy category_1 index is gone", !hasLegacyIndex);

  for (const name of RESET_DEFAULT_COLLECTIONS) {
    const count = await db.collection(name).countDocuments({});
    check(`run 2: reset collection "${name}" is now empty`, count === 0);
  }

  const releasedTable = await db.collection("tables").findOne({ tableNo: OCCUPIED_TABLE_NO });
  check(
    "run 2: the table was released (status Available, no currentOrderId)",
    releasedTable?.status === "Available" && !Object.hasOwn(releasedTable ?? {}, "currentOrderId"),
  );

  const settingsAfter2 = await db.collection("settings").countDocuments({});
  check("run 2: the untouched `settings` collection still has its one document", settingsAfter2 === 1);

  // ── run 3: identical to run 2 — must be a no-op (idempotent) ──────────────
  const run3 = runCli(
    uri,
    ["--create-missing-categories", "--reset", "default", "--drop-legacy-category"],
    backupFile,
    dbName,
  );
  check("run 3 (identical to run 2) exits EXIT_OK (0)", run3.status === EXIT_OK);
  const report3 = latestReport(dbName);
  check("run 3: modified === 0 (nothing left to back-fill)", report3.apply?.steps.categories.modified === 0);
  const resetAllZero = Object.values(report3.apply?.steps.reset?.deleted ?? {}).every((n) => n === 0);
  check("run 3: every reset collection deleted 0 (already empty)", resetAllZero);

  // ── final: the FINAL Mongoose shape reads the migrated data correctly ────
  process.env.MONGODB_URI = uri;
  const { connectDB } = await import("@/lib/db");
  const { listFromSpec, PRODUCT_LIST } = await import("@/lib/masters");
  const { toPublicMenuItem } = await import("@/lib/public-menu");
  const { UNCATEGORIZED } = await import("@pos/shared/constants");
  await connectDB();

  const rows = await listFromSpec(PRODUCT_LIST);
  check(
    "final: listFromSpec(PRODUCT_LIST) returns rows whose categoryId is an ObjectId",
    rows.length > 0 && rows.every((r) => r.categoryId instanceof mongoose.Types.ObjectId),
  );

  const nameById = new Map(categories.map((c) => [String(c._id), c.name as string]));
  const categoryNameOf = (id: unknown): string => nameById.get(String(id)) ?? UNCATEGORIZED;
  const dessertsRow = rows.find((r) => r.name === ALREADY_MIGRATED_PRODUCT_NAME);
  check(
    "final: toPublicMenuItem(row, categoryNameOf) yields the category NAME for the already-migrated product",
    !!dessertsRow && toPublicMenuItem(dessertsRow as never, categoryNameOf).category === "Desserts",
  );
  const matchedRow = rows.find((r) => r.name === MATCHED_PRODUCT_NAME);
  check(
    "final: toPublicMenuItem resolves the back-filled product to its category name",
    !!matchedRow && toPublicMenuItem(matchedRow as never, categoryNameOf).category === "Beverages",
  );

  // ── cleanup ────────────────────────────────────────────────────────────
  if (existsSync(backupFile)) unlinkSync(backupFile);
  for (const reportFile of createdReportFiles) {
    if (existsSync(reportFile)) unlinkSync(reportFile);
  }
  await conn.dropDatabase();
  await conn.close();
  await mongoose.disconnect();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
