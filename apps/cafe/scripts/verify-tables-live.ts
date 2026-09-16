/**
 * CR1.1 live leg — proves the table-config guards against a REAL MongoDB, which
 * the DB-free unit tests cannot: that the unique index actually exists and raises
 * 11000, and that the busy-guard folded into the write filter really refuses a
 * rename/delete of an occupied table while still allowing a free one.
 *
 *   npm run verify:tables:live            (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_tables npm run verify:tables:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops only the collection it created.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { tableSchema } from "@/models/Table";
import { FREE_TABLE_FILTER, freeTableFilter } from "@/lib/table-admin";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}tables`;
const DUPLICATE_KEY_CODE = 11000;

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

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`,
    );
  }

  const conn = await mongoose.createConnection(uri).asPromise();
  const Table = conn.model("Table", tableSchema);
  await Table.collection.drop().catch(() => undefined);
  await Table.createIndexes(); // the unique index must really exist, not just be declared

  console.log(`\nCR1.1 table guards — live against ${dbName}\n`);

  // A seeded table has NO currentOrderId field at all; a freed one has "".
  await Table.create({ tableNo: "T-1", capacity: 4 });
  await Table.create({ tableNo: "T-2", capacity: 4, currentOrderId: "" });
  await Table.create({
    tableNo: "T-3",
    capacity: 4,
    status: "Occupied",
    currentOrderId: "ORD-A-20260809-001",
  });
  // The stale claim: reads Available, yet still points at a live tab.
  await Table.create({ tableNo: "T-4", capacity: 4, currentOrderId: "ORD-A-20260809-002" });

  const free = await Table.find(FREE_TABLE_FILTER).select("tableNo").lean();
  const freeNames = free.map((t) => t.tableNo).sort();
  check(
    "free-table filter matches an unset AND an empty currentOrderId, and nothing else",
    JSON.stringify(freeNames) === JSON.stringify(["T-1", "T-2"]),
  );

  // ── duplicate names ────────────────────────────────────────────────────────
  let duplicateCode = 0;
  try {
    await Table.create({ tableNo: "T-1", capacity: 2 });
  } catch (e) {
    duplicateCode = (e as { code?: number }).code ?? 0;
  }
  check("creating a duplicate table name raises a duplicate-key error", duplicateCode === DUPLICATE_KEY_CODE);

  let renameDupCode = 0;
  try {
    await Table.findOneAndUpdate({ tableNo: "T-2", ...FREE_TABLE_FILTER }, { $set: { tableNo: "T-1" } });
  } catch (e) {
    renameDupCode = (e as { code?: number }).code ?? 0;
  }
  check("renaming onto an existing name raises a duplicate-key error", renameDupCode === DUPLICATE_KEY_CODE);

  // ── rename guard ───────────────────────────────────────────────────────────
  const renamedOccupied = await Table.findOneAndUpdate(
    { tableNo: "T-3", ...FREE_TABLE_FILTER },
    { $set: { tableNo: "Rooftop 1" } },
    { new: true },
  );
  check("an OCCUPIED table cannot be renamed", renamedOccupied === null);

  const renamedStale = await Table.findOneAndUpdate(
    { tableNo: "T-4", ...FREE_TABLE_FILTER },
    { $set: { tableNo: "Rooftop 2" } },
    { new: true },
  );
  check("a table still holding an order pointer cannot be renamed", renamedStale === null);

  const renamedFree = await Table.findOneAndUpdate(
    { tableNo: "T-1", ...FREE_TABLE_FILTER },
    { $set: { tableNo: "Patio 1" } },
    { new: true },
  );
  check("a FREE table renames, and the new name sticks", renamedFree?.tableNo === "Patio 1");

  // ── capacity is editable at any time (it is not identity) ──────────────────
  const reseated = await Table.findOneAndUpdate(
    { tableNo: "T-3" },
    { $set: { capacity: 8 } },
    { new: true },
  );
  check("capacity can be changed while the table is occupied", reseated?.capacity === 8);

  // ── delete guard ───────────────────────────────────────────────────────────
  const deletedOccupied = await Table.findOneAndDelete({ tableNo: "T-3", ...FREE_TABLE_FILTER });
  check("an OCCUPIED table cannot be deleted", deletedOccupied === null);

  const deletedStale = await Table.findOneAndDelete({ tableNo: "T-4", ...FREE_TABLE_FILTER });
  check("a table still holding an order pointer cannot be deleted", deletedStale === null);

  const deletedFree = await Table.findOneAndDelete({ tableNo: "Patio 1", ...FREE_TABLE_FILTER });
  check("a FREE table deletes", deletedFree?.tableNo === "Patio 1");

  // ── CR1.5 Slice 2: freeTableFilter (PUT /api/tables/[tableNo]'s reciprocal-CAS) ──
  await Table.create({
    tableNo: "T-5",
    capacity: 2,
    status: "Occupied",
    currentOrderId: "ORD-A-20260810-005",
  });
  const freedMatching = await Table.findOneAndUpdate(
    freeTableFilter("T-5", "ORD-A-20260810-005"),
    { status: "Available", currentOrderId: "" },
    { new: true },
  );
  check(
    "freeTableFilter: a MATCHING expectedCurrentOrderId frees the table and clears currentOrderId",
    freedMatching?.status === "Available" && freedMatching?.currentOrderId === "",
  );

  await Table.create({
    tableNo: "T-6",
    capacity: 2,
    status: "Occupied",
    currentOrderId: "ORD-A-20260810-006",
  });
  const freedStale = await Table.findOneAndUpdate(
    freeTableFilter("T-6", "ORD-A-20260810-999"),
    { status: "Available", currentOrderId: "" },
    { new: true },
  );
  check("freeTableFilter: a STALE expectedCurrentOrderId matches nothing (no update applied)", freedStale === null);

  const stillClaimed = await Table.findOne({ tableNo: "T-6" }).lean();
  check(
    "freeTableFilter: a stale free leaves the table Occupied with its currentOrderId intact — a blind free was the CR1-audit bug",
    stillClaimed?.status === "Occupied" && stillClaimed?.currentOrderId === "ORD-A-20260810-006",
  );

  // Clean up this leg's own scratch tables so the pre-existing survivor count
  // below stays accurate.
  await Table.deleteMany({ tableNo: { $in: ["T-5", "T-6"] } });

  const survivors = await Table.countDocuments();
  check("exactly the two busy tables survived every guard", survivors === 3);

  await Table.collection.drop().catch(() => undefined);
  await conn.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
