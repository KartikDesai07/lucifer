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
 *  - that the guarded re-occupy refuses to steal an occupied table, and that the
 *    UNGUARDED filter PUT /api/orders/[id] used to send really did steal it.
 *
 * REWRITTEN (CB-CHG, 2026-09-25) — a move now RE-PRICES (owner decision
 * reversal: "purana hatao, naye table ka lagao"). The OLD assertion here
 * ("moving onto a table with a DIFFERENT charge leaves the bill byte-
 * identical") encoded exactly the rule the owner has now reversed, so it is
 * DELETED, not extended, and replaced with plan §7's 8 legs (uncharged→
 * charged, charged→uncharged, replace-not-stack, the extra-survives-a-move
 * headline invariant, a legacy scalar-only order, a reward tab, the CAS
 * widening, and double-charge safety on a retry).
 *
 * SCOPE — reproduces the exact filter/update documents the routes issue, using
 * the REAL `reorderOps`, `claimTableFilter`, `moveOrderFilter`, `occupyUpdate`,
 * `RELEASE_UPDATE`, `tableUnavailableReason`, `FREE_TABLE_FILTER`,
 * `freeTableFilter`, `withTableCharge`, `chargesFromOrder`, `chargeWriteFields`,
 * `computeOrderTotals`, `gstConfigFromOrder` and `rewardFromOrderSnapshot`
 * helpers plus the REAL `Order`/`Table` models. It does NOT stand up the HTTP
 * routes (no auth, no session, no Zod) — those are pinned by
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
import { Order, type IOrder } from "@/models/Order";
import { Table } from "@/models/Table";
import { FREE_TABLE_FILTER, freeTableFilter, resolveTableCharge } from "@/lib/table-admin";
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
import { computeOrderTotals, gstConfigFromOrder, type GstConfig } from "@/lib/receipt";
import { getSettings, gstConfigOf } from "@/lib/settings";
import { rewardFromOrderSnapshot } from "@pos/shared/reward-redemption";
import {
  chargesFromOrder,
  withTableCharge,
  chargesTotal,
  splitChargeTotals,
  type OrderCharge,
} from "@pos/shared/order-charges";
import { chargeWriteFields } from "@/lib/order-charges-write";

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
// except the charge/reward legs below, which set the snapshot fields explicitly.
// `charges` builds the CB-CHG typed array + its mirror (the money the route's
// re-price must reproduce and then change); `chargeAmount`/`chargeLabel` alone
// (no `charges`) builds a LEGACY scalar-only order — leg 5's fixture shape.
function buildOrder(opts: {
  orderId: string;
  tableNo?: string;
  status?: "Pending" | "Completed" | "Cancelled";
  charges?: OrderCharge[];
  chargeAmount?: number;
  chargeLabel?: string;
  rewardAt?: number;
  rewardKind?: "flat" | "percent" | "item";
  rewardValue?: number;
  rewardItem?: string;
  discountKind?: "reward";
}) {
  const price = 100;
  const chargeAmount = opts.charges ? chargesTotal(opts.charges) : opts.chargeAmount;
  // CB-CHG — split, never summed: computeOrderTotals needs the table portion
  // (TABLE_CHARGE_MAX-clamped) and the extras portion (uncapped, decision 8)
  // separately. A legacy scalar-only fixture (no `charges`) has no extra by
  // definition, so its whole chargeAmount is the table portion.
  const { table: fixtureTableCharge, extra: fixtureExtraCharge } = opts.charges
    ? splitChargeTotals(opts.charges)
    : { table: opts.chargeAmount ?? 0, extra: 0 };
  const reward =
    opts.rewardAt !== undefined
      ? rewardFromOrderSnapshot({
          rewardAt: opts.rewardAt,
          rewardKind: opts.rewardKind,
          rewardValue: opts.rewardValue,
          rewardItem: opts.rewardItem,
        })
      : undefined;
  const cfg: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" };
  const totals = computeOrderTotals({
    items: [{ price, qty: 1, reward: false }],
    discount: 0,
    discountKind: opts.discountKind,
    charge: fixtureTableCharge,
    extraCharge: fixtureExtraCharge,
    cfg,
    reward,
  });
  return {
    orderId: opts.orderId,
    customerName: "Walk-In",
    items: [
      { productId: "00000000000000000000aaa1", name: "Tea", price, qty: 1, modifiers: [], instructions: "", kotRound: 1 },
    ],
    subtotal: totals.subtotal,
    discount: totals.discount,
    discountKind: opts.discountKind,
    gstAmount: totals.gstAmount,
    gstRate: 0,
    gstMode: "exclusive" as const,
    ...(opts.charges ? { charges: opts.charges } : {}),
    chargeAmount: opts.charges ? (chargeAmount! > 0 ? chargeAmount : undefined) : opts.chargeAmount,
    chargeLabel: opts.charges
      ? (chargeAmount! > 0 ? opts.charges!.find((c) => c.type === "table")?.label ?? opts.charges![0]?.label : undefined)
      : opts.chargeLabel,
    total: totals.total,
    paidAmount: 0,
    payment: "Unpaid" as const,
    status: opts.status ?? ("Pending" as const),
    receiver: "Verifier",
    tableNo: opts.tableNo,
    kotRounds: 1,
    ...(opts.rewardAt !== undefined
      ? {
          rewardAt: opts.rewardAt,
          rewardKind: opts.rewardKind,
          rewardValue: opts.rewardValue,
          rewardItem: opts.rewardItem ?? "",
        }
      : {}),
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
    moveOrderFilter(String(ord1._id), "T-A", ord1),
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
    (await Order.findOneAndUpdate(moveOrderFilter(String(ord1._id), "T-A", ord1), {
      $set: { tableNo: "T-D" },
    })) === null,
  );

  const closed = await Order.create(buildOrder({ orderId: "ORD-2", tableNo: "T-D", status: "Completed" }));
  check(
    "the CAS matches nothing once the tab is Completed — a settled bill can never be re-seated",
    (await Order.findOneAndUpdate(moveOrderFilter(String(closed._id), "T-D", closed), {
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
  const missed = await Order.findOneAndUpdate(moveOrderFilter(String(ord4._id), "T-STALE", ord4), {
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

  // ── CB-CHG plan §7 — a move now RE-PRICES ─────────────────────────────────
  // Replicates app/api/orders/[id]/table/route.ts's exact re-price steps
  // (resolveTableCharge → withTableCharge → computeOrderTotals →
  // chargeWriteFields → moveOrderFilter/$set in ONE findOneAndUpdate) against
  // a REAL document, which the DB-free unit tests cannot.
  const liveGst = gstConfigOf(await getSettings());
  async function doMove(order: IOrder, to: string) {
    const destCharge = await resolveTableCharge(to);
    if ("error" in destCharge) throw new Error(destCharge.error);
    const charges = withTableCharge(
      chargesFromOrder(order),
      destCharge.charge.amount > 0 ? { label: destCharge.charge.label, amount: destCharge.charge.amount } : null,
    );
    // CB-CHG — split, never summed (see the route's own comment for why).
    const { table: moveTableCharge, extra: moveExtraCharge } = splitChargeTotals(charges);
    const totals = computeOrderTotals({
      items: order.items,
      discount: order.discount,
      discountKind: order.discountKind,
      charge: moveTableCharge,
      extraCharge: moveExtraCharge,
      cfg: gstConfigFromOrder(order, liveGst),
      reward: rewardFromOrderSnapshot(order),
    });
    const chargeFields = chargeWriteFields(charges);
    return Order.findOneAndUpdate(
      moveOrderFilter(String(order._id), order.tableNo!, order),
      {
        $set: {
          tableNo: to,
          subtotal: totals.subtotal,
          discount: totals.discount,
          gstAmount: totals.gstAmount,
          total: totals.total,
          ...(chargeFields.set ?? {}),
        },
        ...(chargeFields.unset ? { $unset: chargeFields.unset } : {}),
      },
      { new: true },
    ).lean();
  }

  // Leg 1 — uncharged → charged: total +50, one table entry, mirror correct.
  await Table.create({ tableNo: "M1-FROM", capacity: 2, status: "Occupied", currentOrderId: "ORD-M1" });
  await Table.create({ tableNo: "M1-TO", capacity: 2, chargeAmount: 50, chargeLabel: "Rooftop" });
  const m1 = await Order.create(buildOrder({ orderId: "ORD-M1", tableNo: "M1-FROM" }));
  await Table.findOneAndUpdate(claimTableFilter("M1-TO"), occupyUpdate("ORD-M1"));
  const m1Moved = await doMove(m1, "M1-TO");
  check(
    "leg 1 — uncharged→charged: total +50, one table entry, mirror correct",
    m1Moved?.total === m1.total + 50 &&
      m1Moved?.chargeAmount === 50 &&
      m1Moved?.chargeLabel === "Rooftop" &&
      JSON.stringify(m1Moved?.charges) === JSON.stringify([{ type: "table", label: "Rooftop", amount: 50 }]),
  );

  // Leg 2 — charged → uncharged: total -50, all three fields ABSENT via
  // $unset, never 0 (a named ₹0 line must never print).
  await Table.create({ tableNo: "M2-FROM", capacity: 2, chargeAmount: 50, chargeLabel: "Rooftop" });
  await Table.create({ tableNo: "M2-TO", capacity: 2, status: "Occupied", currentOrderId: "ORD-M2" });
  const m2 = await Order.create(
    buildOrder({
      orderId: "ORD-M2",
      tableNo: "M2-FROM",
      charges: [{ type: "table", label: "Rooftop", amount: 50 }],
    }),
  );
  await Table.updateOne({ tableNo: "M2-TO" }, { status: "Available", currentOrderId: "" });
  await Table.findOneAndUpdate(claimTableFilter("M2-TO"), occupyUpdate("ORD-M2"));
  const m2Moved = await doMove(m2, "M2-TO");
  check(
    "leg 2 — charged→uncharged: total -50, charges/chargeAmount/chargeLabel all ABSENT ($unset, not 0)",
    m2Moved?.total === m2.total - 50 &&
      !("charges" in (m2Moved ?? {})) &&
      !("chargeAmount" in (m2Moved ?? {})) &&
      !("chargeLabel" in (m2Moved ?? {})),
  );

  // Leg 3 — ₹50 → ₹100 replace-not-stack: exactly ONE table entry.
  await Table.create({ tableNo: "M3-FROM", capacity: 2, chargeAmount: 50, chargeLabel: "Old" });
  await Table.create({ tableNo: "M3-TO", capacity: 2, chargeAmount: 100, chargeLabel: "New", status: "Occupied", currentOrderId: "ORD-M3" });
  const m3 = await Order.create(
    buildOrder({ orderId: "ORD-M3", tableNo: "M3-FROM", charges: [{ type: "table", label: "Old", amount: 50 }] }),
  );
  await Table.updateOne({ tableNo: "M3-TO" }, { status: "Available", currentOrderId: "" });
  await Table.findOneAndUpdate(claimTableFilter("M3-TO"), occupyUpdate("ORD-M3"));
  const m3Moved = await doMove(m3, "M3-TO");
  check(
    "leg 3 — ₹50→₹100 replace-not-stack: exactly ONE table entry, the new amount/label",
    m3Moved?.charges?.length === 1 &&
      m3Moved?.charges?.[0]?.type === "table" &&
      m3Moved?.charges?.[0]?.amount === 100 &&
      m3Moved?.charges?.[0]?.label === "New" &&
      m3Moved?.total === m3.total + 50,
  );

  // Leg 4 — THE HEADLINE INVARIANT: [table 50, extra 30] moved to an
  // uncharged table keeps [extra 30] — a move must never destroy a takeaway
  // charge.
  await Table.create({ tableNo: "M4-FROM", capacity: 2, chargeAmount: 50, chargeLabel: "Old" });
  await Table.create({ tableNo: "M4-TO", capacity: 2, status: "Occupied", currentOrderId: "ORD-M4" });
  const m4 = await Order.create(
    buildOrder({
      orderId: "ORD-M4",
      tableNo: "M4-FROM",
      charges: [
        { type: "table", label: "Old", amount: 50 },
        { type: "extra", label: "Takeaway", amount: 30 },
      ],
    }),
  );
  await Table.updateOne({ tableNo: "M4-TO" }, { status: "Available", currentOrderId: "" });
  await Table.findOneAndUpdate(claimTableFilter("M4-TO"), occupyUpdate("ORD-M4"));
  const m4Moved = await doMove(m4, "M4-TO");
  check(
    "leg 4 — [table 50, extra 30] moved to an UNCHARGED table keeps [extra 30] (the owner's headline invariant)",
    JSON.stringify(m4Moved?.charges) === JSON.stringify([{ type: "extra", label: "Takeaway", amount: 30 }]) &&
      m4Moved?.chargeAmount === 30 &&
      m4Moved?.chargeLabel === "Takeaway" &&
      m4Moved?.total === m4.total - 50,
  );

  // Leg 5 — a LEGACY order (scalars only, no `charges`) moved: correct
  // result, subtotal+gstAmount unchanged (derive-on-read upgrades in place,
  // no migration).
  await Table.create({ tableNo: "M5-FROM", capacity: 2, chargeAmount: 40, chargeLabel: "Legacy" });
  await Table.create({ tableNo: "M5-TO", capacity: 2, chargeAmount: 90, chargeLabel: "Fresh", status: "Occupied", currentOrderId: "ORD-M5" });
  const m5 = await Order.create(
    buildOrder({ orderId: "ORD-M5", tableNo: "M5-FROM", chargeAmount: 40, chargeLabel: "Legacy" }),
  );
  check("leg 5 fixture is genuinely legacy (no `charges` key)", !("charges" in m5.toObject()));
  await Table.updateOne({ tableNo: "M5-TO" }, { status: "Available", currentOrderId: "" });
  await Table.findOneAndUpdate(claimTableFilter("M5-TO"), occupyUpdate("ORD-M5"));
  const m5Moved = await doMove(m5, "M5-TO");
  check(
    "leg 5 — a LEGACY scalar-only order moved: charge replaced correctly, subtotal+gstAmount unchanged",
    m5Moved?.chargeAmount === 90 &&
      m5Moved?.chargeLabel === "Fresh" &&
      m5Moved?.subtotal === m5.subtotal &&
      m5Moved?.gstAmount === m5.gstAmount &&
      m5Moved?.total === m5.total + 50,
  );

  // Leg 6 — a REWARD tab moved keeps its reward discount (the fail-closed
  // trap: rewardDiscountAmount returns 0 for a MISSING reward, so omitting
  // rewardFromOrderSnapshot would re-bill this tab at full price).
  await Table.create({ tableNo: "M6-FROM", capacity: 2 });
  await Table.create({ tableNo: "M6-TO", capacity: 2, chargeAmount: 20, chargeLabel: "Garden", status: "Occupied", currentOrderId: "ORD-M6" });
  const m6 = await Order.create(
    buildOrder({
      orderId: "ORD-M6",
      tableNo: "M6-FROM",
      discountKind: "reward",
      rewardAt: 5,
      rewardKind: "flat",
      rewardValue: 40,
    }),
  );
  check("leg 6 fixture really carries a reward discount before the move", m6.discount === 40);
  await Table.updateOne({ tableNo: "M6-TO" }, { status: "Available", currentOrderId: "" });
  await Table.findOneAndUpdate(claimTableFilter("M6-TO"), occupyUpdate("ORD-M6"));
  const m6Moved = await doMove(m6, "M6-TO");
  check(
    "leg 6 — a REWARD tab moved keeps its reward discount (not re-billed at full price)",
    m6Moved?.discountKind === "reward" &&
      m6Moved?.discount === 40 &&
      m6Moved?.rewardAt === 5 &&
      m6Moved?.total === m6.subtotal - 40 + 20,
  );

  // Leg 7 — CAS: a concurrent add-round between read and write makes the
  // move 409 (findOneAndUpdate returns null) and the destination claim must
  // be released, exactly like the pre-existing stale-source leg above. The
  // new `total`/`kotRounds` terms in moveOrderFilter are what make this miss.
  await Table.create({ tableNo: "M7-FROM", capacity: 2, status: "Occupied", currentOrderId: "ORD-M7" });
  await Table.create({ tableNo: "M7-TO", capacity: 2 });
  const m7 = await Order.create(buildOrder({ orderId: "ORD-M7", tableNo: "M7-FROM" }));
  await Table.findOneAndUpdate(claimTableFilter("M7-TO"), occupyUpdate("ORD-M7"));
  // …a concurrent add-round lands in the gap, bumping total AND kotRounds…
  await Order.updateOne({ _id: m7._id }, { $set: { total: m7.total + 500, kotRounds: 2 } });
  const m7Missed = await Order.findOneAndUpdate(
    moveOrderFilter(String(m7._id), "M7-FROM", m7), // guards on the STALE total/kotRounds we read
    { $set: { tableNo: "M7-TO" } },
  );
  const m7Released = await Table.findOneAndUpdate(freeTableFilter("M7-TO", "ORD-M7"), RELEASE_UPDATE, {
    new: true,
  }).lean();
  const m7After = await Order.findById(m7._id).select("tableNo kotRounds").lean();
  check(
    "leg 7 — a concurrent add-round between read and write makes the move CAS miss (409), releases the claim, and the new round survives on the bill",
    m7Missed === null &&
      m7Released?.status === "Available" &&
      m7After?.tableNo === "M7-FROM" &&
      m7After?.kotRounds === 2,
  );

  // Leg 8 — a retried landed move does not double-charge: once the first
  // attempt's write lands (total already reflects the new charge), a retry
  // that guards on the OLD total/tableNo genuinely misses — it can never
  // re-apply the same charge a second time.
  await Table.create({ tableNo: "M8-FROM", capacity: 2 });
  await Table.create({ tableNo: "M8-TO", capacity: 2, chargeAmount: 70, chargeLabel: "Patio", status: "Occupied", currentOrderId: "ORD-M8" });
  const m8 = await Order.create(buildOrder({ orderId: "ORD-M8", tableNo: "M8-FROM" }));
  await Table.updateOne({ tableNo: "M8-TO" }, { status: "Available", currentOrderId: "" });
  await Table.findOneAndUpdate(claimTableFilter("M8-TO"), occupyUpdate("ORD-M8"));
  const m8First = await doMove(m8, "M8-TO");
  // …the client retries with its ORIGINAL (now-stale) snapshot of the order…
  const m8Retry = await Order.findOneAndUpdate(
    moveOrderFilter(String(m8._id), "M8-FROM", m8), // still the OLD total/tableNo
    { $set: { tableNo: "M8-TO", total: (m8First?.total ?? 0) + 70 } }, // would double-charge if it matched
  );
  check(
    "leg 8 — a retry whose filter still names the OLD total/tableNo genuinely misses once the first attempt landed — no double-charge",
    m8First?.total === m8.total + 70 && m8Retry === null,
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
        moveOrderFilter(String(stranded._id), "R-OLD", stranded),
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
  await Order.findOneAndUpdate(moveOrderFilter(String(doomed._id), "D-OLD", doomed), {
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

// ── CB-CHG's two NEW verbs — ASSIGN (seat a walk-in) and UNSEAT (leave the
// table), plus the single most important guard behind ASSIGN: that the
// widened moveOrderFilter's absent-field CAS actually matches a document
// whose tableNo key is genuinely MISSING, which a DB-free unit test cannot
// prove (it never round-trips through Mongoose's own storage/cast layer).
async function assignUnseatLegs(): Promise<void> {
  console.log("\n── ASSIGN + UNSEAT (the two new verbs) ─────────────────────────");

  const liveGst = gstConfigOf(await getSettings());

  // Shared re-price step, replicating the route's exact sequence for a
  // destination that may be null (UNSEAT) as well as a real table name
  // (ASSIGN). `fromTableNo` is passed straight through to moveOrderFilter so
  // the CAS matches exactly what the route would build from `order.tableNo`.
  // Same idiom as moveLegs()'s doMove() above: takes a hydrated IOrder
  // document (from Order.create/Order.findById, never a bare .lean() spread).
  async function doAssignOrUnseat(order: IOrder, fromTableNo: string | undefined, to: string | null) {
    const tableCharge =
      to === null
        ? null
        : await (async () => {
            const destCharge = await resolveTableCharge(to);
            if ("error" in destCharge) throw new Error(destCharge.error);
            return destCharge.charge.amount > 0
              ? { label: destCharge.charge.label, amount: destCharge.charge.amount }
              : null;
          })();
    const charges = withTableCharge(chargesFromOrder(order), tableCharge);
    const { table: moveTableCharge, extra: moveExtraCharge } = splitChargeTotals(charges);
    const totals = computeOrderTotals({
      items: order.items,
      discount: order.discount,
      discountKind: order.discountKind,
      charge: moveTableCharge,
      extraCharge: moveExtraCharge,
      cfg: gstConfigFromOrder(order, liveGst),
      reward: rewardFromOrderSnapshot(order),
    });
    const chargeFields = chargeWriteFields(charges);
    return Order.findOneAndUpdate(
      moveOrderFilter(String(order._id), fromTableNo, order),
      {
        $set: {
          ...(to !== null ? { tableNo: to } : {}),
          subtotal: totals.subtotal,
          discount: totals.discount,
          gstAmount: totals.gstAmount,
          total: totals.total,
          ...(chargeFields.set ?? {}),
        },
        ...(chargeFields.unset || to === null
          ? { $unset: { ...(chargeFields.unset ?? {}), ...(to === null ? { tableNo: "" } : {}) } }
          : {}),
      },
      { new: true, runValidators: true },
    ).lean();
  }

  // ── Leg A1 — ASSIGN: a walk-in tab with NO tableNo field at all seats onto
  // a charged table: the charge lands, the total rises by exactly that
  // amount, and the Table doc points at the order. ────────────────────────
  await Table.create({ tableNo: "A1-TO", capacity: 2, chargeAmount: 60, chargeLabel: "Balcony" });
  const a1 = await Order.create(buildOrder({ orderId: "ORD-A1" })); // no tableNo key at all
  check("leg A1 fixture is genuinely tableless (no tableNo key on the stored doc)", !("tableNo" in a1.toObject()));

  const a1Claimed = await Table.findOneAndUpdate(claimTableFilter("A1-TO"), occupyUpdate("ORD-A1"), {
    new: true,
  }).lean();
  check("leg A1 — claim succeeds against a free table", a1Claimed?.status === "Occupied" && a1Claimed?.currentOrderId === "ORD-A1");

  const a1Moved = await doAssignOrUnseat(a1, undefined, "A1-TO");
  check(
    "leg A1 — ASSIGN: tableNo lands, the table's charge is now in charges[]/chargeAmount, and total rose by exactly that amount",
    a1Moved?.tableNo === "A1-TO" &&
      a1Moved?.chargeAmount === 60 &&
      a1Moved?.chargeLabel === "Balcony" &&
      JSON.stringify(a1Moved?.charges) === JSON.stringify([{ type: "table", label: "Balcony", amount: 60 }]) &&
      a1Moved?.total === a1.total + 60,
  );
  const a1Table = await Table.findOne({ tableNo: "A1-TO" }).lean();
  check(
    "leg A1 — the Table doc is Occupied and points at the assigned order",
    a1Table?.status === "Occupied" && a1Table?.currentOrderId === "ORD-A1",
  );

  // ── Leg A2 — THE CRITICAL ONE: the absent-field CAS really matches a doc
  // whose tableNo is ABSENT, and really REFUSES a doc that carries a real
  // tableNo (the racing-seat guard must still hold). ─────────────────────
  const bare = await Order.create(buildOrder({ orderId: "ORD-A2" })); // no tableNo key
  check("leg A2 fixture is genuinely tableless", !("tableNo" in bare.toObject()));

  const matchedAbsent = await Order.findOneAndUpdate(
    moveOrderFilter(String(bare._id), undefined, bare),
    { $set: { total: bare.total } }, // a no-op write; only the MATCH matters here
    { new: true },
  );
  check(
    "leg A2 — moveOrderFilter(id, undefined, order) MATCHES a doc whose tableNo field is genuinely ABSENT (not \"\" and not null) — if this misses, every ASSIGN 409s and the feature is dead",
    matchedAbsent !== null,
  );

  const seated = await Order.create(buildOrder({ orderId: "ORD-A2B", tableNo: "A2-SEATED" }));
  const refusedSeated = await Order.findOneAndUpdate(
    moveOrderFilter(String(seated._id), undefined, seated), // deliberately the ASSIGN filter against a SEATED doc
    { $set: { total: seated.total } },
  );
  check(
    "leg A2 — the SAME absent-field filter does NOT match a doc that carries a real tableNo (the CAS must still refuse a racing seat)",
    refusedSeated === null,
  );

  // A legacy doc written before the omit-empty discipline landed can carry a
  // literal "" rather than an absent key (the comment on moveOrderFilter says
  // so explicitly). This is the half of the `$in: [null, ""]` term that a
  // bare `tableNo: undefined` filter — which the MongoDB driver happens to
  // treat as "match an ABSENT/null field" — would silently miss: an
  // undefined-valued filter key does NOT match a stored empty string. Proves
  // the explicit `""` arm is load-bearing, not redundant with the absent case.
  const legacyBlank = await Order.create(buildOrder({ orderId: "ORD-A2C" }));
  await Order.updateOne({ _id: legacyBlank._id }, { $set: { tableNo: "" } }); // bypass omit-empty on purpose
  const legacyBlankRead = await Order.findById(legacyBlank._id);
  if (!legacyBlankRead) throw new Error("leg A2: legacy-blank fixture vanished");
  check('leg A2 legacy fixture genuinely stores tableNo:"" (not absent)', legacyBlankRead.toObject().tableNo === "");
  const matchedLegacyBlank = await Order.findOneAndUpdate(
    moveOrderFilter(String(legacyBlankRead._id), undefined, legacyBlankRead),
    { $set: { total: legacyBlankRead.total } },
  );
  check(
    'leg A2 — the absent-field CAS ALSO matches a legacy doc whose tableNo is a literal "" (the other half of $in: [null, ""] — a bare undefined filter value would miss this one)',
    matchedLegacyBlank !== null,
  );

  // ── Leg U1 — UNSEAT: frees the table, drops the table charge (via $unset,
  // never null/""), and leaves any staff-entered extra untouched. ─────────
  await Table.create({ tableNo: "U1-FROM", capacity: 4, status: "Occupied", currentOrderId: "ORD-U1", chargeAmount: 45, chargeLabel: "Patio" });
  const u1 = await Order.create(
    buildOrder({
      orderId: "ORD-U1",
      tableNo: "U1-FROM",
      charges: [
        { type: "table", label: "Patio", amount: 45 },
        { type: "extra", label: "Takeaway box", amount: 15 },
      ],
    }),
  );
  const u1Unseated = await doAssignOrUnseat(u1, "U1-FROM", null);
  check(
    "leg U1 — UNSEAT: total dropped by exactly the table charge, and the extra survived untouched",
    u1Unseated?.total === u1.total - 45 &&
      JSON.stringify(u1Unseated?.charges) === JSON.stringify([{ type: "extra", label: "Takeaway box", amount: 15 }]) &&
      u1Unseated?.chargeAmount === 15 &&
      u1Unseated?.chargeLabel === "Takeaway box",
  );

  // A raw collection read (not the Mongoose-cast .lean() result above) proves
  // the field is truly ABSENT from the stored BSON, not merely falsy.
  const u1Raw = await mongoose.connection.collection("orders").findOne({ orderId: "ORD-U1" });
  check(
    "leg U1 — the RAW stored document has NO tableNo key at all ($unset, never null/\"\") — \"tableNo\" in doc === false",
    u1Raw !== null && "tableNo" in u1Raw === false,
  );

  await Table.findOneAndUpdate(freeTableFilter("U1-FROM", "ORD-U1"), RELEASE_UPDATE);
  const u1Table = await Table.findOne({ tableNo: "U1-FROM" }).lean();
  check(
    "leg U1 — the Table doc is back to Available with currentOrderId cleared",
    u1Table?.status === "Available" && u1Table?.currentOrderId === "",
  );

  // ── Leg U2 — round trip: UNSEAT then re-ASSIGN to the SAME table must
  // leave the money exactly where it started (proves the split/replace path
  // has no drift over two writes). ────────────────────────────────────────
  await Table.create({ tableNo: "U2-TABLE", capacity: 4, status: "Occupied", currentOrderId: "ORD-U2", chargeAmount: 35, chargeLabel: "Rooftop" });
  const u2 = await Order.create(
    buildOrder({ orderId: "ORD-U2", tableNo: "U2-TABLE", charges: [{ type: "table", label: "Rooftop", amount: 35 }] }),
  );
  const originalTotal = u2.total;

  const u2Unseated = await doAssignOrUnseat(u2, "U2-TABLE", null);
  await Table.findOneAndUpdate(freeTableFilter("U2-TABLE", "ORD-U2"), RELEASE_UPDATE);
  check("leg U2 — after unseat, total dropped by the table charge", u2Unseated?.total === originalTotal - 35);

  const u2ReClaimed = await Table.findOneAndUpdate(claimTableFilter("U2-TABLE"), occupyUpdate("ORD-U2"), {
    new: true,
  }).lean();
  check("leg U2 — the freed table can be re-claimed", u2ReClaimed?.status === "Occupied");

  // Re-read fresh, exactly like the route always does before pricing a
  // write — never hand-merge a partial update result into a stale in-memory
  // document. A hydrated document (not .lean()) to match doAssignOrUnseat's
  // IOrder parameter, same as every other call site in this file.
  const u2AfterUnseat = await Order.findById(u2._id);
  if (!u2AfterUnseat) throw new Error("leg U2: order vanished after unseat");
  check("leg U2 fixture re-read is genuinely tableless before the re-assign", !("tableNo" in u2AfterUnseat.toObject()));

  const u2ReAssigned = await doAssignOrUnseat(
    u2AfterUnseat,
    undefined, // the doc is now tableless again, exactly like a fresh ASSIGN
    "U2-TABLE",
  );
  check(
    "leg U2 — the round trip (unseat then re-assign to the SAME table) leaves the total exactly where it started",
    u2ReAssigned?.total === originalTotal &&
      u2ReAssigned?.chargeAmount === 35 &&
      u2ReAssigned?.chargeLabel === "Rooftop",
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
  await assignUnseatLegs();

  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
