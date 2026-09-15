/**
 * CB-5B D8 — `migrate:reward-items`: back-fill `loyaltyRules.milestones[].itemProductId`
 * on a live cafe.
 *
 * Before D8 a kind:"item" milestone stored only a typed NAME ("Masala Chai").
 * D5's reversal puts that dish on the BILL and the KOT at its real price, so
 * the server now resolves an actual Product — by REFERENCE, because a name
 * breaks the moment a dish is renamed, deleted, or duplicated. Existing rows
 * carry no reference, so they cannot be saved through the settings form until
 * one is filled in.
 *
 * DEFAULT IS A DRY RUN (read-only, safe on a live database) — it censuses what
 * would change and what cannot be matched. `--apply` writes.
 *
 *   npm run migrate:reward-items -- --uri "<mongodb uri>"
 *   npm run migrate:reward-items -- --uri "<uri>" --apply --confirm <dbName>
 *
 * Matching is EXACT, case-insensitive, on the product name, and a name that
 * matches more than one active product is reported as AMBIGUOUS and left
 * alone — the whole point of D8 is that an ambiguous name must never silently
 * become a reference to the wrong dish. Those rows are for the owner to fix in
 * the settings picker.
 *
 * SAFETY: never prints the URI (it may carry credentials) — only the db name.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import mongoose from "mongoose";

const EXIT_OK = 0;
const EXIT_REFUSED = 1;
const EXIT_UNRESOLVED = 3;

interface MilestoneRow {
  at?: number;
  kind?: string;
  item?: string;
  itemProductId?: string;
}

interface CensusRow {
  // The row's INDEX in the stored milestones array. This, not `at`, is what
  // the apply step matches on: `at` is only unique because the save-time Zod
  // refinement rejects duplicates, and a legacy stored document predates that
  // guarantee. Matching on `at` would give two same-`at` rungs the same dish.
  index: number;
  at: number;
  name: string;
  verdict: "already-linked" | "matched" | "no-match" | "ambiguous" | "blank-name";
  productId?: string;
  productName?: string;
  candidates?: number;
}

export interface RewardItemCensus {
  totalMilestones: number;
  itemMilestones: number;
  rows: CensusRow[];
  writable: number;
  unresolved: number;
}

/**
 * Decide, per milestone row, what the migration would do. PURE — takes the
 * product index rather than reading the DB, so the decision table is testable
 * without a live cluster.
 *
 * `productsByName` maps a LOWERCASED name to every active product id under it;
 * a list longer than one is what makes a row ambiguous.
 */
export function censusRewardItems(
  milestones: readonly MilestoneRow[],
  productsByName: ReadonlyMap<string, readonly string[]>,
  namesById?: ReadonlyMap<string, string>,
): RewardItemCensus {
  const rows: CensusRow[] = [];
  let itemMilestones = 0;

  for (const [index, milestone] of milestones.entries()) {
    if (milestone.kind !== "item") continue;
    itemMilestones += 1;
    const at = milestone.at ?? 0;
    const name = (milestone.item ?? "").trim();

    // Already migrated (or configured through the new picker) — never rewrite
    // an existing reference from a name, which would undo a deliberate fix.
    if (milestone.itemProductId) {
      rows.push({ index, at, name, verdict: "already-linked", productId: milestone.itemProductId });
      continue;
    }
    if (name.length === 0) {
      rows.push({ index, at, name, verdict: "blank-name" });
      continue;
    }

    const candidates = productsByName.get(name.toLowerCase()) ?? [];
    if (candidates.length === 1) {
      const productId = candidates[0]!;
      rows.push({
        index,
        at,
        name,
        verdict: "matched",
        productId,
        // The product's CURRENT name. The display snapshot is re-written from
        // this, not left at the old typed string: otherwise a later rename
        // would leave the diner's rewards tab showing one dish while the bill
        // printed another, with no edit able to fix it but re-picking.
        productName: namesById?.get(productId) ?? name,
      });
    } else if (candidates.length === 0) {
      rows.push({ index, at, name, verdict: "no-match" });
    } else {
      // Deliberately NOT "pick the first": guessing between two dishes with the
      // same name is exactly the failure D8 exists to prevent.
      rows.push({ index, at, name, verdict: "ambiguous", candidates: candidates.length });
    }
  }

  const writable = rows.filter((r) => r.verdict === "matched").length;
  const unresolved = rows.filter(
    (r) => r.verdict === "no-match" || r.verdict === "ambiguous" || r.verdict === "blank-name",
  ).length;
  return { totalMilestones: milestones.length, itemMilestones, rows, writable, unresolved };
}

/** Build the lowercased name -> ids index the census consumes. */
export function indexProductsByName(
  products: readonly { _id: { toString(): string }; name: string }[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const product of products) {
    const key = product.name.trim().toLowerCase();
    if (key.length === 0) continue;
    const existing = index.get(key);
    if (existing) existing.push(product._id.toString());
    else index.set(key, [product._id.toString()]);
  }
  return index;
}

function argOf(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<number> {
  const uri = argOf("--uri");
  const apply = process.argv.includes("--apply");
  const confirm = argOf("--confirm");
  if (!uri) {
    console.error("Missing --uri");
    return EXIT_REFUSED;
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error("No database handle");
    return EXIT_REFUSED;
  }
  const dbName = db.databaseName;
  console.log(`Database: ${dbName}`);

  if (apply && confirm !== dbName) {
    console.error(`--apply needs --confirm ${dbName}`);
    await mongoose.disconnect();
    return EXIT_REFUSED;
  }

  const settings = await db.collection("settings").findOne({});
  const milestones = ((settings?.loyaltyRules as { milestones?: MilestoneRow[] } | undefined)
    ?.milestones ?? []) as MilestoneRow[];
  const products = (await db
    .collection("products")
    .find({ isActive: { $ne: false } })
    .project({ name: 1 })
    .toArray()) as unknown as { _id: { toString(): string }; name: string }[];

  const namesById = new Map(products.map((product) => [product._id.toString(), product.name]));
  const census = censusRewardItems(milestones, indexProductsByName(products), namesById);
  console.log(
    `Milestones: ${census.totalMilestones} (free-item rungs: ${census.itemMilestones})`,
  );
  for (const row of census.rows) {
    const detail = row.productId
      ? ` -> ${row.productId}`
      : row.candidates
        ? ` (${row.candidates} products share this name)`
        : "";
    console.log(`  at ${row.at}: "${row.name}" — ${row.verdict}${detail}`);
  }
  console.log(`Writable: ${census.writable} · Needs the owner: ${census.unresolved}`);

  if (!apply) {
    console.log("DRY RUN — nothing written. Re-run with --apply --confirm <dbName>.");
    await mongoose.disconnect();
    return census.unresolved > 0 ? EXIT_UNRESOLVED : EXIT_OK;
  }

  if (census.writable > 0) {
    // Write the whole array back once: `loyaltyRules` is a nested container
    // that Mongoose $set-replaces WHOLE, so a per-row positional update would
    // fight that discipline. Read-modify-write on the array we just censused.
    const matchedByIndex = new Map(
      census.rows.filter((row) => row.verdict === "matched").map((row) => [row.index, row]),
    );
    const next = milestones.map((milestone, index) => {
      // Matched by INDEX, never by `at` — see CensusRow.index.
      const match = matchedByIndex.get(index);
      if (!match?.productId) return milestone;
      // The reference AND the display name travel together, always — writing
      // only the ref would leave the ladder reading the old typed string.
      return { ...milestone, itemProductId: match.productId, item: match.productName ?? milestone.item };
    });
    await db
      .collection("settings")
      .updateOne({ _id: settings!._id }, { $set: { "loyaltyRules.milestones": next } });
    console.log(`Applied: ${census.writable} reference(s) written.`);
  } else {
    console.log("Nothing to write.");
  }

  if (census.unresolved > 0) {
    console.log(
      `${census.unresolved} rung(s) still need a product picked in Settings -> Rewards & loyalty.`,
    );
  }
  await mongoose.disconnect();
  return census.unresolved > 0 ? EXIT_UNRESOLVED : EXIT_OK;
}

// Only run when invoked directly, so the pure exports above stay importable
// from the test suite without opening a connection. Compared against THIS
// module's own path, not a substring of the name: the test file is also named
// "migrate-reward-items…", and a substring check would run the CLI (and its
// "Missing --uri" exit) the moment the suite imported the pure helpers.
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Migration failed");
      process.exit(EXIT_REFUSED);
    });
}
