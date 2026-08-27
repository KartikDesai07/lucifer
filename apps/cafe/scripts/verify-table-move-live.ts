/**
 * Table-flow live leg — proves the floor-plan arrangement and the move-a-live-tab
 * write shapes against a REAL MongoDB, which the DB-free unit tests cannot:
 *
 *  - that a MISSING `displayOrder` really sorts before any value, so adding the
 *    field needs no backfill and an un-arranged cafe keeps plain name order;
 *  - that `reorderOps` really rewrites the whole arrangement in one bulkWrite;
 *  - that a new table lands LAST even after a middle table was deleted (why the
 *    create path takes max+1 rather than a document count);
 *  - that the destination claim only matches a genuinely free table, and that the
 *    order CAS matches nothing once the tab closed or already moved;
 *  - that the rollback frees only OUR OWN claim, and the source release cannot
 *    free a table another order has since taken (the double-free class);
 *  - that a move does NOT touch the bill — the table-charge snapshot and total
 *    come out byte-identical;
 *  - that the guarded re-occupy refuses to steal an occupied table, and that the
 *    UNGUARDED filter PUT /api/orders/[id] used to send really did steal it.
 *
 * SCOPE — reproduces the exact filter/update documents the routes issue, using
 * the REAL `reorderOps`, `claimTableFilter`, `moveOrderFilter`, `occupyUpdate`,
 * `RELEASE_UPDATE`, `tableUnavailableReason`, `FREE_TABLE_FILTER` and
 * `freeTableFilter` helpers plus the REAL `Order`/`Table` models. It does NOT
 * stand up the HTTP routes (no auth, no session, no Zod) — those are pinned by
 * lib/table-flow-paths.test.ts reading the routes' actual source.
 *
 *   npm run verify:table-move:live
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_table_move npm run verify:table-move:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops the WHOLE scratch database (start and end) rather
 * than leaving a prior run's fixed orderIds to collide with this one's.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Table } from "@/models/Table";
import { FREE_TABLE_FILTER, freeTableFilter } from "@/lib/table-admin";
import { reorderOps } from "@/lib/table-order";
import {
  claimTableFilter,
  moveOrderFilter,
  occupyUpdate,
  RELEASE_UPDATE,
  tableUnavailableReason,
  TABLE_TAKEN_ERROR,
  TABLE_RESERVED_ERROR,
} from "@/lib/order-table-move";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}table_move`;

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

// Seating carries no money, so these fixtures deliberately hold a trivial bill —
// except the charge legs below, which set the snapshot fields explicitly.
function buildOrder(opts: {
  orderId: string;
  tableNo?: string;
  status?: "Pending" | "Completed" | "Cancelled";
  chargeAmount?: number;
  chargeLabel?: string;
}) {
  const price = 100;
  return {
    orderId: opts.orderId,
    customerName: "Walk-In",
    items: [
      { productId: "p1", name: "Tea", price, qty: 1, modifiers: [], instructions: "", kotRound: 1 },
    ],
    subtotal: price,
    discount: 0,
    gstAmount: 0,
    chargeAmount: opts.chargeAmount,
    chargeLabel: opts.chargeLabel,
    total: price + (opts.chargeAmount ?? 0),
    paidAmount: 0,
    payment: "Unpaid" as const,
    status: opts.status ?? ("Pending" as const),
    receiver: "Verifier",
    tableNo: opts.tableNo,
    kotRounds: 1,
  };
}

async function names(): Promise<string[]> {
  const rows = await Table.find().sort({ displayOrder: 1, tableNo: 1 }).select("tableNo").lean();
  return rows.map((t) => t.tableNo);
}

// What POST /api/tables computes for a brand-new table: one past the LAST
// arranged position, so a table added after a middle one was deleted still lands
// at the end (a document count would collide with an existing position).
async function nextDisplayOrder(): Promise<number> {
  const last = await Table.findOne({ displayOrder: { $exists: true } })
    .sort({ displayOrder: -1 })
    .select("displayOrder")
    .lean();
  return (last?.displayOrder ?? -1) + 1;
}

async function arrangementLegs(): Promise<void> {
  console.log("\n── floor-plan arrangement ─────────────────────────────────────");

  // Created deliberately out of order and with NO displayOrder — exactly what
  // every table looks like before this feature ships.
  await Table.create({ tableNo: "T-2", capacity: 4 });
  await Table.create({ tableNo: "T-10", capacity: 6 });
  await Table.create({ tableNo: "T-1", capacity: 2 });

  check(
    "un-arranged tables keep plain NAME order (a missing displayOrder sorts before any value, so no backfill is needed)",
    JSON.stringify(await names()) === JSON.stringify(["T-1", "T-10", "T-2"]),
  );

  const arrangement = ["T-1", "T-2", "T-10"];
  await Table.bulkWrite(reorderOps(arrangement));
  check(
    "reorderOps rewrites the whole arrangement in one bulkWrite, and the hand order beats the lexicographic name sort (T-2 now precedes T-10)",
    JSON.stringify(await names()) === JSON.stringify(arrangement),
  );

  const positions = await Table.find().select("tableNo displayOrder").lean();
  check(
    "every table carries a numeric position after one arrange — no table is left with a missing field to jump the queue",
    positions.length === 3 && positions.every((t) => typeof t.displayOrder === "number"),
  );

  await Table.create({ tableNo: "Patio", capacity: 4, displayOrder: await nextDisplayOrder() });
  check(
    "a table added after arranging lands LAST, not first",
    JSON.stringify(await names()) === JSON.stringify(["T-1", "T-2", "T-10", "Patio"]),
  );

  // The gap case: this is the whole reason the create path reads max+1 instead of
  // counting documents — after a delete, a count would hand out a position that
  // is already taken and the new table would surface in the middle.
  await Table.deleteOne({ tableNo: "T-2" });
  const countWouldBe = await Table.countDocuments();
  const maxPlusOne = await nextDisplayOrder();
  check(
    "after a middle table is deleted, a document count would COLLIDE with an existing position while max+1 does not",
    countWouldBe === 3 && maxPlusOne === 4,
  );
  await Table.create({ tableNo: "Garden", capacity: 8, displayOrder: maxPlusOne });
  check(
    "so the next table still lands LAST across a delete gap",
    JSON.stringify(await names()) === JSON.stringify(["T-1", "T-10", "Patio", "Garden"]),
  );

  // Probed, not assumed: bulkWrite([]) does NOT throw on this driver — it is a
  // clean no-op (matched 0, modified 0). So the schema's min(1) exists to reject a
  // meaningless REQUEST, not to prevent corruption. What matters here is that an
  // empty arrangement cannot touch the positions already stored: a future
  // "optimisation" of reorderOps into a collection-wide $unset/updateMany would
  // wipe the whole arrangement on an empty list, and this is the leg that catches it.
  const beforeEmpty = await names();
  const emptyResult = await Table.bulkWrite(reorderOps([]));
  check(
    "an EMPTY arrangement is a harmless no-op — it writes nothing and leaves every stored position exactly as it was",
    emptyResult.modifiedCount === 0 &&
      emptyResult.matchedCount === 0 &&
      JSON.stringify(await names()) === JSON.stringify(beforeEmpty),
  );

  await Table.deleteMany({});
}

async function moveLegs(): Promise<void> {
  console.log("\n── moving a live tab ──────────────────────────────────────────");

  // A seeded table has NO currentOrderId field; a freed one has "".
  await Table.create({ tableNo: "T-A", capacity: 4, status: "Occupied", currentOrderId: "ORD-1" });
  await Table.create({ tableNo: "T-B", capacity: 4, currentOrderId: "" });
  await Table.create({ tableNo: "T-C", capacity: 4, status: "Occupied", currentOrderId: "ORD-OTHER" });
  await Table.create({ tableNo: "T-D", capacity: 4, status: "Reserved" });

  check(
    "the claim filter refuses a table held by another order",
    (await Table.findOneAndUpdate(claimTableFilter("T-C"), occupyUpdate("ORD-1"))) === null,
  );
  check(
    "the claim filter refuses a RESERVED table",
    (await Table.findOneAndUpdate(claimTableFilter("T-D"), occupyUpdate("ORD-1"))) === null,
  );

  // ── happy path: claim destination → move order → release source ────────────
  const ord1 = await Order.create(buildOrder({ orderId: "ORD-1", tableNo: "T-A" }));

  const claimed = await Table.findOneAndUpdate(claimTableFilter("T-B"), occupyUpdate("ORD-1"), {
    new: true,
  }).lean();
  check(
    "step 1 claims a free destination (an empty-string currentOrderId counts as free)",
    claimed?.status === "Occupied" && claimed?.currentOrderId === "ORD-1",
  );

  const moved = await Order.findOneAndUpdate(
    moveOrderFilter(String(ord1._id), "T-A"),
    { $set: { tableNo: "T-B" } },
    { new: true },
  ).lean();
  check("step 2 moves the order under CAS", moved?.tableNo === "T-B");

  const released = await Table.findOneAndUpdate(freeTableFilter("T-A", "ORD-1"), RELEASE_UPDATE, {
    new: true,
  }).lean();
  check(
    "step 3 releases the source and clears its pointer",
    released?.status === "Available" && released?.currentOrderId === "",
  );

  // ── the order CAS ──────────────────────────────────────────────────────────
  check(
    "the CAS matches nothing when the tab is no longer on the table we read (a second terminal already moved it)",
    (await Order.findOneAndUpdate(moveOrderFilter(String(ord1._id), "T-A"), {
      $set: { tableNo: "T-D" },
    })) === null,
  );

  const closed = await Order.create(buildOrder({ orderId: "ORD-2", tableNo: "T-D", status: "Completed" }));
  check(
    "the CAS matches nothing once the tab is Completed — a settled bill can never be re-seated",
    (await Order.findOneAndUpdate(moveOrderFilter(String(closed._id), "T-D"), {
      $set: { tableNo: "T-B" },
    })) === null,
  );

  // ── rollback: the claim landed but the order did not move ──────────────────
  await Table.create({ tableNo: "T-P", capacity: 2, status: "Occupied", currentOrderId: "ORD-4" });
  await Table.create({ tableNo: "T-Q", capacity: 2 });
  const ord4 = await Order.create(buildOrder({ orderId: "ORD-4", tableNo: "T-P" }));

  await Table.findOneAndUpdate(claimTableFilter("T-Q"), occupyUpdate("ORD-4"));
  // A deliberately stale source makes the order CAS miss, which is exactly the
  // branch that must undo its own claim.
  const missed = await Order.findOneAndUpdate(moveOrderFilter(String(ord4._id), "T-STALE"), {
    $set: { tableNo: "T-Q" },
  });
  const rolledBack = await Table.findOneAndUpdate(freeTableFilter("T-Q", "ORD-4"), RELEASE_UPDATE, {
    new: true,
  }).lean();
  const ord4After = await Order.findById(ord4._id).select("tableNo").lean();
  const sourceIntact = await Table.findOne({ tableNo: "T-P" }).lean();
  check(
    "a definite CAS no-match rolls the claim back, leaves the order on its original table, and never touches the source",
    missed === null &&
      rolledBack?.status === "Available" &&
      rolledBack?.currentOrderId === "" &&
      ord4After?.tableNo === "T-P" &&
      sourceIntact?.status === "Occupied" &&
      sourceIntact?.currentOrderId === "ORD-4",
  );

  // ── the rollback frees only OUR claim ─────────────────────────────────────
  await Table.create({ tableNo: "T-Z", capacity: 2, status: "Occupied", currentOrderId: "ORD-9" });
  const notOurs = await Table.findOneAndUpdate(freeTableFilter("T-Z", "ORD-4"), RELEASE_UPDATE);
  const zAfter = await Table.findOne({ tableNo: "T-Z" }).lean();
  check(
    "a release guarded on OUR order id cannot free a table another order has since taken (the double-free class)",
    notOurs === null && zAfter?.status === "Occupied" && zAfter?.currentOrderId === "ORD-9",
  );

  // ── money must not move ───────────────────────────────────────────────────
  await Table.create({ tableNo: "T-S", capacity: 2, status: "Occupied", currentOrderId: "ORD-7" });
  await Table.create({ tableNo: "T-T", capacity: 2, chargeAmount: 100, chargeLabel: "Garden" });
  const priced = await Order.create(
    buildOrder({ orderId: "ORD-7", tableNo: "T-S", chargeAmount: 50, chargeLabel: "Balcony" }),
  );
  await Table.findOneAndUpdate(claimTableFilter("T-T"), occupyUpdate("ORD-7"));
  const repriced = await Order.findOneAndUpdate(
    moveOrderFilter(String(priced._id), "T-S"),
    { $set: { tableNo: "T-T" } },
    { new: true },
  ).lean();
  check(
    "moving onto a table with a DIFFERENT charge leaves the bill byte-identical — the snapshot is frozen and only the POS cart may re-price it",
    repriced?.tableNo === "T-T" &&
      repriced?.chargeAmount === 50 &&
      repriced?.chargeLabel === "Balcony" &&
      repriced?.total === 150 &&
      repriced?.subtotal === 100,
  );

  // ── tableUnavailableReason against real documents ─────────────────────────
  const held = await Table.findOne({ tableNo: "T-C" }).select("status currentOrderId").lean();
  const reserved = await Table.findOne({ tableNo: "T-Q" }).select("status currentOrderId").lean();
  await Table.updateOne({ tableNo: "T-Q" }, { $set: { status: "Reserved" } });
  const reservedNow = await Table.findOne({ tableNo: "T-Q" }).select("status currentOrderId").lean();
  check(
    "tableUnavailableReason: held by another order → taken; held by US → allowed (a retry must succeed); reserved → reserved; free → allowed",
    held !== null &&
      reserved !== null &&
      reservedNow !== null &&
      tableUnavailableReason(held, "ORD-1") === TABLE_TAKEN_ERROR &&
      tableUnavailableReason(held, "ORD-OTHER") === null &&
      tableUnavailableReason(reservedNow, "ORD-1") === TABLE_RESERVED_ERROR &&
      tableUnavailableReason(reserved, "ORD-1") === null,
  );

  // ── a STRANDED retry must be able to finish (review fix) ─────────────────
  // The first attempt claimed the destination and then lost its order write (a
  // throw, a function timeout, or a response that never reached the tablet), so
  // the destination points at this order while the order still sits on its old
  // table. Replays the route's step 1 exactly.
  await Table.create({ tableNo: "R-OLD", capacity: 2, status: "Occupied", currentOrderId: "ORD-R" });
  await Table.create({ tableNo: "R-NEW", capacity: 2, status: "Occupied", currentOrderId: "ORD-R" });
  const stranded = await Order.create(buildOrder({ orderId: "ORD-R", tableNo: "R-OLD" }));

  const retryClaim = await Table.findOneAndUpdate(claimTableFilter("R-NEW"), occupyUpdate("ORD-R"));
  const retryDest = await Table.findOne({ tableNo: "R-NEW" }).select("status currentOrderId").lean();
  const alreadyOurs = retryDest?.currentOrderId === "ORD-R";
  // The route now falls through on `alreadyOurs`, re-asserts its own claim, and
  // proceeds to step 2 instead of returning a 409 about its own claim.
  if (alreadyOurs) {
    await Table.findOneAndUpdate(freeTableFilter("R-NEW", "ORD-R"), occupyUpdate("ORD-R"));
  }
  const retryMoved = alreadyOurs
    ? await Order.findOneAndUpdate(
        moveOrderFilter(String(stranded._id), "R-OLD"),
        { $set: { tableNo: "R-NEW" } },
        { new: true },
      ).lean()
    : null;
  if (retryMoved) {
    await Table.findOneAndUpdate(freeTableFilter("R-OLD", "ORD-R"), RELEASE_UPDATE);
  }
  const retryOld = await Table.findOne({ tableNo: "R-OLD" }).lean();
  const retryNew = await Table.findOne({ tableNo: "R-NEW" }).lean();
  check(
    "a retry whose FIRST attempt already claimed the destination completes the move instead of 409ing about its own claim",
    retryClaim === null &&
      alreadyOurs &&
      retryMoved?.tableNo === "R-NEW" &&
      retryOld?.status === "Available" &&
      retryOld?.currentOrderId === "" &&
      retryNew?.status === "Occupied" &&
      retryNew?.currentOrderId === "ORD-R",
  );

  // ── DELETE must free the table the order held AT REMOVAL (review fix) ────
  // A move lands between DELETE's read and its delete, so the pre-read snapshot
  // and the deleted document name DIFFERENT tables.
  await Table.create({ tableNo: "D-OLD", capacity: 2, status: "Occupied", currentOrderId: "ORD-D" });
  await Table.create({ tableNo: "D-NEW", capacity: 2 });
  const doomed = await Order.create(buildOrder({ orderId: "ORD-D", tableNo: "D-OLD" }));
  const staleRead = await Order.findById(doomed._id).lean(); // DELETE's first read

  // …the move completes in the gap…
  await Table.findOneAndUpdate(claimTableFilter("D-NEW"), occupyUpdate("ORD-D"));
  await Order.findOneAndUpdate(moveOrderFilter(String(doomed._id), "D-OLD"), {
    $set: { tableNo: "D-NEW" },
  });
  await Table.findOneAndUpdate(freeTableFilter("D-OLD", "ORD-D"), RELEASE_UPDATE);

  const deleted = await Order.findByIdAndDelete(doomed._id);
  await Table.findOneAndUpdate(
    { tableNo: deleted?.tableNo, currentOrderId: deleted?.orderId },
    RELEASE_UPDATE,
  );
  const dNew = await Table.findOne({ tableNo: "D-NEW" }).lean();
  check(
    "DELETE keyed on the DELETED document frees the table the order actually held (the stale read named D-OLD, which the move had already freed)",
    staleRead?.tableNo === "D-OLD" &&
      deleted?.tableNo === "D-NEW" &&
      dNew?.status === "Available" &&
      dNew?.currentOrderId === "",
  );

  // ── the stolen-table bug PUT used to have ────────────────────────────────
  await Table.create({ tableNo: "T-V", capacity: 2, status: "Occupied", currentOrderId: "ORD-VIC" });
  const guardedSteal = await Table.findOneAndUpdate(
    { tableNo: "T-V", ...FREE_TABLE_FILTER },
    occupyUpdate("ORD-THIEF"),
  );
  const victim = await Table.findOne({ tableNo: "T-V" }).lean();
  check(
    "the GUARDED re-occupy refuses an occupied destination, so the victim keeps its pointer",
    guardedSteal === null && victim?.currentOrderId === "ORD-VIC",
  );

  await Table.create({ tableNo: "T-W", capacity: 2, status: "Occupied", currentOrderId: "ORD-VIC2" });
  // The exact filter PUT /api/orders/[id] sent before this change — kept here as
  // the demonstration that the FREE_TABLE_FILTER term is load-bearing, not tidy.
  await Table.findOneAndUpdate({ tableNo: "T-W" }, occupyUpdate("ORD-THIEF"));
  const stolen = await Table.findOne({ tableNo: "T-W" }).lean();
  check(
    "the UNGUARDED filter PUT used to send really does steal the table (pointer overwritten, victim orphaned from the floor plan)",
    stolen?.currentOrderId === "ORD-THIEF",
  );
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`,
    );
  }

  process.env.MONGODB_URI = uri;
  await connectDB();
  await mongoose.connection.dropDatabase(); // clean slate even after a crashed prior run
  await Table.createIndexes(); // the unique + arrangement indexes must really exist

  console.log(`\nTable arrange + move guards — live against ${dbName}`);

  await arrangementLegs();
  await moveLegs();

  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
