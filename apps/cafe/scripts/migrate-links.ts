/**
 * CB-DL-1/DL-2 S4 — `migrate:links`: an OWNER-RUN census + apply pipeline for
 * every ObjectId-shaped link across the app's collections (orders.customerId,
 * items[].productId, products.categoryId, etc — see the CB-DL brief §A table
 * and cb-dl2-decisions.md D-C). The default is a DRY RUN (read-only, safe on
 * a live database). `--apply` runs the real pipeline: it back-fills
 * product.categoryId from the legacy category name, optionally resets the
 * listed transactional collections, optionally drops the legacy `category`
 * field/index, then re-censuses with the SAME functions the dry run uses.
 *
 *   npm run migrate:links -- --uri "<mongodb uri>"
 *   npm run migrate:links -- --uri "<mongodb uri>" --out report.json
 *   npm run migrate:links -- --uri "<uri>" --apply --backup <archive>|auto \
 *     --confirm <dbName> [--reset default|<list>] \
 *     [--create-missing-categories] [--drop-legacy-category]
 *
 * SAFETY: never prints the URI (it may carry credentials) — only the db name.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import mongoose from "mongoose";
import { parseMigrateArgs, scrubUri, type ArgsDeps, type MigrateArgs } from "./migrate-links/args";
import { buildParentSets, censusOrders } from "./migrate-links/census-orders";
import {
  censusDuePayments,
  censusProducts,
  censusOrderRequests,
  censusPromoRedemptions,
  censusPrintJobs,
  censusTables,
  censusCustomers,
} from "./migrate-links/census-refs";
import { renderSummary, writeReport, type CensusReport } from "./migrate-links/report";
import { runApply } from "./migrate-links/apply-run";

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_APPLY_NOT_CLEAN = 3;

// Set once the args parse; the top-level error handler scrubs it out of any
// message before printing (driver errors can quote the raw uri).
let currentUri = "";

function hasMongodump(): boolean {
  const result = spawnSync("mongodump", ["--version"]);
  return result.status === 0;
}

const REAL_DEPS: ArgsDeps = {
  env: process.env,
  existsSync,
  statSync,
  hasMongodump,
  now: Date.now(),
  cwd: process.cwd(),
};

/** Runs `mongodump --backup auto`, refusing on a non-zero exit or a 0-byte
 * archive. The uri is passed only as an argv element (spawnSync, never a
 * shell string), and never appears in any printed message. The archive is
 * written OUTSIDE the repo (os.tmpdir(), never cwd) — `migrate:links` is a
 * cafe-workspace npm script, so a cwd-based path would put a full dump of the
 * live database (customer names, mobile numbers, order/dues history) inside
 * this public repo. */
function autoBackup(uri: string, dbName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = `${tmpdir()}/migrate-links-backup-${dbName}-${stamp}.archive.gz`;
  const result = spawnSync(
    "mongodump",
    [`--uri=${uri}`, "--gzip", `--archive=${archivePath}`, "--quiet"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString() : "unknown error";
    throw new Error(`mongodump --backup auto failed: ${scrubUri(stderr, uri)}`);
  }
  const size = existsSync(archivePath) ? statSync(archivePath).size : 0;
  if (size === 0) {
    throw new Error("mongodump --backup auto produced a 0-byte archive; refusing to apply");
  }
  return archivePath;
}

async function runDryRunCensus(db: NonNullable<mongoose.Connection["db"]>): Promise<CensusReport> {
  const parents = await buildParentSets(db);
  const [orders, duepayments, products, orderrequests, promoredemptions, printjobs, tables, customers] =
    await Promise.all([
      censusOrders(db, parents),
      censusDuePayments(db, parents),
      censusProducts(db, parents),
      censusOrderRequests(db, parents),
      censusPromoRedemptions(db, parents),
      censusPrintJobs(db, parents),
      censusTables(db, parents),
      censusCustomers(db, parents),
    ]);
  return {
    meta: { db: "", at: "", dryRun: true, script: "migrate-links", version: 1 },
    orders,
    duepayments,
    products,
    orderrequests,
    promoredemptions,
    printjobs,
    tables,
    customers,
  };
}

async function main(): Promise<void> {
  const parsed = parseMigrateArgs(process.argv.slice(2), REAL_DEPS);
  if (!parsed.ok) {
    // C11: the refusal text can quote a raw argv token, and a connection
    // string typed without its `--uri` marker lands in argv verbatim. No URI
    // has been parsed yet at this point (currentUri is still ""), but the
    // credential-fragment rule runs unconditionally, so `//user:pass@` still
    // becomes `//<credentials>@` while the host and db survive — the operator
    // still sees WHICH token was rejected.
    console.error(scrubUri(parsed.error, ""));
    process.exit(EXIT_REFUSED);
    return;
  }
  const args: MigrateArgs = parsed.args;
  currentUri = args.uri;

  console.log(`${args.apply ? "APPLY" : "DRY RUN"} — census of ${args.dbName}`);

  // The driver's connection-string parser interpolates the RAW uri into its
  // MongoParseError messages (review round 1), so a mistyped --uri must never
  // reach console.error unscrubbed — only the db name is ever printed.
  let conn: mongoose.Connection;
  try {
    conn = await mongoose.createConnection(args.uri).asPromise();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "connection failed";
    console.error(`Could not connect to ${args.dbName}: ${scrubUri(reason, args.uri)}`);
    process.exit(EXIT_REFUSED);
    return;
  }
  const db = conn.db;
  if (!db) throw new Error("Connection has no db handle");

  if (!args.apply) {
    const base = await runDryRunCensus(db);
    const report: CensusReport = {
      ...base,
      meta: { db: args.dbName, at: new Date().toISOString(), dryRun: true, script: "migrate-links", version: 1 },
    };
    writeReport(args.out, report);
    console.log(renderSummary(report));
    console.log(`\nFull report written to ${args.out}`);
    await conn.close();
    return;
  }

  // ── --apply ────────────────────────────────────────────────────────────
  let backupPath: string | null = args.backup;
  if (args.backup === "auto") {
    try {
      backupPath = autoBackup(args.uri, args.dbName);
      console.log(`Backup archive written to ${backupPath} — move it to secure storage.`);
    } catch (error) {
      console.error(scrubUri(error instanceof Error ? error.message : "backup failed", args.uri));
      await conn.close();
      process.exit(EXIT_REFUSED);
      return;
    }
  }

  const base = await runDryRunCensus(db);
  const {
    steps,
    resetList,
    postCensus,
    clean,
    resetRefused,
    nonEmptyResetCollections,
    stringShapedCollections,
  } = await runApply(db, args);

  const report: CensusReport = {
    ...base,
    meta: { db: args.dbName, at: new Date().toISOString(), dryRun: false, script: "migrate-links", version: 1 },
    apply: { steps, backupPath, resetList, resetRefused },
    postCensus,
  };

  writeReport(args.out, report);
  console.log(renderSummary(report));
  console.log(`\nFull report written to ${args.out}`);

  await conn.close();

  // C1: the reset was refused outright because the category back-fill was
  // incomplete — nothing was deleted. This is a refusal (exit 1), not the
  // "apply ran but is not clean" verdict (exit 3): the pipeline stopped
  // before doing the unsafe part.
  if (resetRefused) {
    const skippedCount = steps.categories.skippedNoDoc.length + steps.categories.skippedCollision.length;
    console.log(
      `\n--reset was refused: ${skippedCount} category name(s) could not be resolved, so nothing was deleted. ` +
        "Re-run with --create-missing-categories, or fix the product category names, then retry --reset.",
    );
    process.exit(EXIT_REFUSED);
    return;
  }

  if (!clean) {
    const reasons: string[] = [];
    if (steps.categories.skippedNoDoc.length > 0) reasons.push(`${steps.categories.skippedNoDoc.length} category name(s) skipped (no doc)`);
    if (steps.categories.skippedCollision.length > 0) reasons.push(`${steps.categories.skippedCollision.length} category name collision group(s) skipped`);
    if (postCensus.products.categoryIdMissing.count > 0) reasons.push(`${postCensus.products.categoryIdMissing.count} product(s) still missing categoryId`);
    if (postCensus.products.categoryIdOrphan.count > 0) reasons.push(`${postCensus.products.categoryIdOrphan.count} product(s) have a categoryId that does not resolve to a live category`);
    if (postCensus.products.categoryIdNotObjectId.count > 0) reasons.push(`${postCensus.products.categoryIdNotObjectId.count} product(s) have a categoryId that is not an ObjectId`);
    if (steps.dropLegacy?.refused) reasons.push("drop-legacy-category was refused (not every product has an ObjectId categoryId that resolves to a live category)");
    for (const name of nonEmptyResetCollections) reasons.push(`${name} still holds documents after --reset`);
    for (const name of stringShapedCollections) reasons.push(`${name} is still String-shaped (not reset, and still carries hex/other-string link values)`);
    if (postCensus.orders.sourceRequestIds.notObjectId > 0)
      reasons.push(
        `${postCensus.orders.sourceRequestIds.notObjectId} orders.sourceRequestIds entr(ies) are not ObjectId — the double-accept fence cannot match them, so a request could be accepted twice`,
      );
    console.log(`\nApply ran but the result is not clean: ${reasons.join("; ")}`);
    process.exit(EXIT_APPLY_NOT_CLEAN);
    return;
  }

  process.exit(EXIT_OK);
}

main().catch((error) => {
  console.error(scrubUri(error instanceof Error ? error.message : "Census failed", currentUri));
  process.exit(EXIT_REFUSED);
});
