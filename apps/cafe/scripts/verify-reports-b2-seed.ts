/**
 * Seed builder for scripts/verify-reports-b2-live.ts — split out to keep the
 * live leg itself under the file-size budget. Every hand-computed number in
 * the comments below is what the assertion blocks in verify-reports-b2-live.ts
 * check against; nothing here calls the folds under test.
 *
 * ── Seed shape ─────────────────────────────────────────────────────────────
 * 3 IST days: 27 (Sun), 28 (Mon), 29 (Tue) Sep 2026, plus two orders in the
 * compare window (24 Sep) so kpis.previous is non-trivially exercised. Two
 * categories (Drinks, Snacks) + a third category created then DELETED
 * (Cookie-Cat, "FreeCookie" -> Uncategorised) + a product sold then DELETED
 * (Burger -> Removed items). Every rule the batch-2 plan calls out: inclusive
 * 5% snapshot, exclusive 5% with gstAmount, exclusive snapshot with gstAmount
 * 0, a legacy bill with NO gstMode (live-settings fallback), a GST-disabled
 * snapshot, a table charge + a staff extra charge, a fractional-price line, a
 * free reward line, a reward-kind discount, a manual discount, a "gst"
 * discount, a never-billed cancel, a cancel-after-billing, a void on a
 * Completed order, a void of a reward line (value 0) on a Cancelled order,
 * two cancel reasons that differ only in case/space, per-day billNumber
 * restarts, a Completed bill with no billNumber (numbering off), and an empty
 * cancelledBy.
 */
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { Category } from "@/models/Category";
import { Settings } from "@/models/Settings";

const IST_OFFSET_MS = 330 * 60 * 1000;

function ist(localNoZ: string): Date {
  return new Date(new Date(`${localNoZ}Z`).getTime() - IST_OFFSET_MS);
}

export interface SeedResult {
  tea: mongoose.Types.ObjectId;
  coffee: mongoose.Types.ObjectId;
  burgerId: mongoose.Types.ObjectId;
  cookie: mongoose.Types.ObjectId;
  completedBills: Array<{
    orderId: string; createdAt: Date; total: number; gstAmount?: number; gstRate?: number;
    gstMode?: "inclusive" | "exclusive"; chargeAmount?: number; status: string;
  }>;
}

export async function seedReportsB2(): Promise<SeedResult> {
  // Live GST settings — the fallback a LEGACY bill (no gstMode snapshot) reads.
  await Settings.create({ gstEnabled: true, gstRate: 5, gstMode: "inclusive" });

  // ── Menu: 2 live categories + 1 that gets deleted, 1 product that gets deleted ──
  const drinks = await Category.create({ name: "Drinks", order: 1 });
  const snacks = await Category.create({ name: "Snacks", order: 2 });
  const cookieCat = await Category.create({ name: "Cookie-Cat", order: 3 });

  const tea = await Product.create({ name: "Tea", categoryId: drinks._id, price: 30 });
  const coffee = await Product.create({
    name: "Coffee",
    categoryId: drinks._id,
    price: 50,
    variations: [{ name: "Large", price: 60 }],
  });
  const samosa = await Product.create({ name: "Samosa", categoryId: snacks._id, price: 20 });
  const burger = await Product.create({ name: "Burger", categoryId: snacks._id, price: 150 });
  const cookie = await Product.create({ name: "FreeCookie", categoryId: cookieCat._id, price: 60 });

  const orderId = (label: string) => `SCRATCH-RPTB2-${randomUUID().slice(0, 8)}-${label}`;
  const line = (productId: mongoose.Types.ObjectId, name: string, price: number, qty: number, over: Record<string, unknown> = {}) => ({
    productId,
    name,
    price,
    qty,
    modifiers: [],
    instructions: "",
    kotRound: 1,
    ...over,
  });
  type OrderDoc = Record<string, unknown>;
  const baseOrder = (over: OrderDoc): OrderDoc => ({
    orderId: orderId(String(over.orderId ?? "x")),
    customerName: "Walk-In",
    subtotal: 0,
    discount: 0,
    gstAmount: 0,
    paidAmount: 0,
    payment: "Cash",
    status: "Completed",
    receiver: "Verifier",
    kotRounds: 1,
    ...over,
  });

  // ═══════════════════════════ Day 27 Sep (Sun) ═══════════════════════════
  // O1: inclusive 5% snapshot. subtotal=300 (Tea x10@30), total=300 (inclusive
  // adds nothing). receiptGst: taxedTotal=300, taxable=round(300/1.05)=286, gst=14.
  const O1 = baseOrder({
    orderId: "d27-inclusive", createdAt: ist("2026-09-27T10:00:00"),
    items: [line(tea._id, "Tea", 30, 10)], subtotal: 300, total: 300, paidAmount: 300,
    gstMode: "inclusive", gstRate: 5, receiver: "Asha", billNumber: 1,
  });
  // O2: LEGACY — no gstMode at all -> falls back to live Settings (inclusive 5%).
  // subtotal=400 (Samosa x20@20), total=400. taxedTotal=400, taxable=round(400/1.05)=381, gst=19.
  const O2 = baseOrder({
    orderId: "d27-legacy", createdAt: ist("2026-09-27T11:00:00"),
    items: [line(samosa._id, "Samosa", 20, 20)], subtotal: 400, total: 400, paidAmount: 400,
    payment: "Online", receiver: "Bina", billNumber: 2,
  });
  // O3: cancelled, NEVER billed (no billNumber, unpaid). Voided nothing.
  const O3 = baseOrder({
    orderId: "d27-cancel-neverbilled", createdAt: ist("2026-09-27T12:00:00"),
    items: [line(tea._id, "Tea", 30, 2)], subtotal: 60, total: 60, paidAmount: 0,
    status: "Cancelled", cancelReason: "Customer left", cancelledBy: "Asha",
    cancelledAt: ist("2026-09-27T12:05:00"), receiver: "Asha",
  });

  // ═══════════════════════════ Day 28 Sep (Mon) ═══════════════════════════
  // O4: exclusive 5% WITH gstAmount. subtotal=240 (Coffee Large x4@60),
  // gstAmount=round(240*5/100)=12, total=252. taxedTotal=252, taxable=252-12=240.
  const O4 = baseOrder({
    orderId: "d28-exclusive", createdAt: ist("2026-09-28T10:00:00"),
    items: [line(coffee._id, "Coffee", 60, 4, { variation: "Large" })], subtotal: 240,
    gstAmount: 12, gstMode: "exclusive", gstRate: 5, total: 252, paidAmount: 252,
    receiver: "Chetan", billNumber: 1,
  });
  // O5: exclusive snapshot with gstAmount 0 (gstRate 0 at order time -> GST was off).
  // subtotal=150 (Tea x5@30), total=150. receiptGst: gstEnabled=(rate 0)>0=false -> noGst=150.
  const O5 = baseOrder({
    orderId: "d28-exclusive-zero", createdAt: ist("2026-09-28T10:15:00"),
    items: [line(tea._id, "Tea", 30, 5)], subtotal: 150, gstAmount: 0, gstMode: "exclusive",
    gstRate: 0, total: 150, paidAmount: 150, receiver: "Chetan", billNumber: 2,
  });
  // O6: GST 0/disabled inclusive snapshot. subtotal=200 (Samosa x10@20), total=200.
  // receiptGst: gstEnabled=false -> noGst=200.
  const O6 = baseOrder({
    orderId: "d28-disabled", createdAt: ist("2026-09-28T10:30:00"),
    items: [line(samosa._id, "Samosa", 20, 10)], subtotal: 200, gstAmount: 0, gstMode: "inclusive",
    gstRate: 0, total: 200, paidAmount: 200, payment: "Online", receiver: "Bina", billNumber: 3,
  });
  // O7: table charge (20) + staff extra charge (15) = chargeAmount 35, untaxed.
  // subtotal=150 (Burger x1@150), total=150-0+0+35=185. taxedTotal=185-35=150.
  // inclusive 5%: taxable=round(150/1.05)=143, gst=150-143=7. value(taxable+gst)=150; +charges=185=total.
  const O7 = baseOrder({
    orderId: "d28-charges", createdAt: ist("2026-09-28T11:00:00"),
    items: [line(burger._id, "Burger", 150, 1)], subtotal: 150,
    charges: [{ type: "table", label: "Rooftop charge", amount: 20 }, { type: "extra", label: "Delivery box", amount: 15 }],
    chargeAmount: 35, chargeLabel: "Rooftop charge", gstMode: "inclusive", gstRate: 5, total: 185,
    paidAmount: 185, receiver: "Chetan", tableNo: "T-1", billNumber: 4,
  });
  // O8: fractional price line. Coffee (no variation) x3 @ 49.5 = 148.5 -> subtotal
  // = Math.round(148.5) = 149 (JS half-up). total=149. taxable=round(149/1.05)=142, gst=7.
  const O8 = baseOrder({
    orderId: "d28-fractional", createdAt: ist("2026-09-28T11:15:00"),
    items: [line(coffee._id, "Coffee", 49.5, 3)], subtotal: 149, gstMode: "inclusive", gstRate: 5,
    total: 149, paidAmount: 149, receiver: "Bina", billNumber: 5,
  });
  // O9: free reward LINE (FreeCookie qty1 reward:true, price 60 -> 0 revenue, 0 subtotal
  // contribution). subtotal=200 (Samosa x10@20), total=200. money.reward += 60 (rewardLines).
  // taxable=round(200/1.05)=190, gst=10.
  const O9 = baseOrder({
    orderId: "d28-reward-line", createdAt: ist("2026-09-28T11:30:00"),
    items: [line(samosa._id, "Samosa", 20, 10), line(cookie._id, "FreeCookie", 60, 1, { reward: true })],
    subtotal: 200, gstMode: "inclusive", gstRate: 5, total: 200, paidAmount: 200,
    receiver: "Asha", billNumber: 6,
  });
  // O10: reward-KIND discount. subtotal=300 (Tea x10@30), discountKind "reward", discount=30
  // (the server-derived reward value), total=270. money.reward += 30 (the discount, isRewardKind).
  // taxable=round(270/1.05)=257, gst=13.
  const O10 = baseOrder({
    orderId: "d28-reward-kind", createdAt: ist("2026-09-28T12:00:00"),
    items: [line(tea._id, "Tea", 30, 10)], subtotal: 300, discount: 30, discountKind: "reward",
    gstMode: "inclusive", gstRate: 5, total: 270, paidAmount: 270, payment: "Online",
    receiver: "Chetan", billNumber: 7,
  });
  // O11: manual discount. subtotal=300 (Burger x2@150), discount=40 (discountKind absent
  // = manual), total=260. taxable=round(260/1.05)=248, gst=12.
  const O11 = baseOrder({
    orderId: "d28-manual-discount", createdAt: ist("2026-09-28T12:15:00"),
    items: [line(burger._id, "Burger", 150, 2)], subtotal: 300, discount: 40,
    gstMode: "inclusive", gstRate: 5, total: 260, paidAmount: 260, receiver: "Bina", billNumber: 8,
  });
  // O12: "gst" discount preset. subtotal=120 (Coffee Large x2@60), discountKind "gst",
  // discount=gstEquivalentDiscount(120, inclusive5%)=120-round(120/1.05)=120-114=6, total=114.
  // taxable=round(114/1.05)=109, gst=5.
  const O12 = baseOrder({
    orderId: "d28-gst-discount", createdAt: ist("2026-09-28T12:30:00"),
    items: [line(coffee._id, "Coffee", 60, 2, { variation: "Large" })], subtotal: 120, discount: 6,
    discountKind: "gst", gstMode: "inclusive", gstRate: 5, total: 114, paidAmount: 114,
    payment: "Online", receiver: "Asha", billNumber: 9,
  });
  // O13: cancelled AFTER billing (kept its billNumber + paidAmount). cancelReason has
  // surrounding spaces + different case than O3's — must group into ONE reason row.
  const O13 = baseOrder({
    orderId: "d28-cancel-afterbilling", createdAt: ist("2026-09-28T13:00:00"),
    items: [line(tea._id, "Tea", 30, 5)], subtotal: 150, total: 150, paidAmount: 150,
    billNumber: 10, status: "Cancelled", cancelReason: " customer left ", cancelledBy: "",
    cancelledAt: ist("2026-09-28T13:10:00"), receiver: "Chetan",
  });
  // O14: Completed order with a void trail entry (2 units of Tea taken back —
  // items[] already reflects the reduced qty: 8 sold @30 = 240).
  const O14 = baseOrder({
    orderId: "d28-void-completed", createdAt: ist("2026-09-28T13:30:00"),
    items: [line(tea._id, "Tea", 30, 8)], subtotal: 240, gstMode: "inclusive", gstRate: 5,
    total: 240, paidAmount: 240, receiver: "Chetan", billNumber: 11,
    voids: [{ productId: tea._id, name: "Tea", price: 30, qty: 2, kotRound: 1, reason: "Wrong order", voidedBy: "Bina", at: ist("2026-09-28T13:25:00") }],
  });
  // O15: Cancelled order (never billed) whose void trail voided a REWARD line
  // (FreeCookie, reward:true) — VOID_VALUE_EXPR must value it at 0, not price*qty.
  // Its own cancelReason is ALSO "Customer left" (3rd member of that reason group).
  const O15 = baseOrder({
    orderId: "d28-void-cancelled", createdAt: ist("2026-09-28T14:00:00"),
    items: [line(samosa._id, "Samosa", 20, 5)], subtotal: 100, total: 100, paidAmount: 0,
    status: "Cancelled", cancelReason: "Customer left", cancelledBy: "Asha",
    cancelledAt: ist("2026-09-28T14:20:00"), receiver: "Asha",
    voids: [{ productId: cookie._id, name: "FreeCookie", price: 60, qty: 1, reward: true, kotRound: 1, reason: "Wrong order", voidedBy: "Asha", at: ist("2026-09-28T14:10:00") }],
  });

  // ═══════════════════════════ Day 29 Sep (Tue) — today ═══════════════════
  // O16: just after IST midnight (00:10 IST 29th = 18:40 UTC 28th) — IST day is
  // 29 Sep. First bill of the day (numbering restarts). taxable=round(60/1.05)=57, gst=3.
  const O16 = baseOrder({
    orderId: "d29-midnight", createdAt: ist("2026-09-29T00:10:00"),
    items: [line(tea._id, "Tea", 30, 2)], subtotal: 60, gstMode: "inclusive", gstRate: 5,
    total: 60, paidAmount: 60, receiver: "Asha", billNumber: 1,
  });
  // O17: ordinary bill today (before NOW=14:30 IST). taxable=round(120/1.05)=114, gst=6.
  const O17 = baseOrder({
    orderId: "d29-normal", createdAt: ist("2026-09-29T08:00:00"),
    items: [line(coffee._id, "Coffee", 60, 2, { variation: "Large" })], subtotal: 120,
    gstMode: "inclusive", gstRate: 5, total: 120, paidAmount: 120, receiver: "Bina", billNumber: 2,
  });
  // O18: Completed, bill numbering OFF for this bill — no billNumber key at all.
  // taxable=round(60/1.05)=57, gst=3.
  const O18 = baseOrder({
    orderId: "d29-no-billnumber", createdAt: ist("2026-09-29T08:30:00"),
    items: [line(samosa._id, "Samosa", 20, 3)], subtotal: 60, gstMode: "inclusive", gstRate: 5,
    total: 60, paidAmount: 60, payment: "Online", receiver: "Chetan",
  });

  // ═══════════════════ Compare window (24 Sep) — kpis.previous ═══════════
  // compareWindow for the 3-day range 27-29 shifts back 3 days: [24T00:00, 26T14:30 IST].
  const O19 = baseOrder({
    orderId: "cmp-normal", createdAt: ist("2026-09-24T10:00:00"),
    items: [line(tea._id, "Tea", 30, 4)], subtotal: 120, gstMode: "inclusive", gstRate: 5,
    total: 120, paidAmount: 120, receiver: "Asha",
  });
  const O20 = baseOrder({
    orderId: "cmp-cancelled", createdAt: ist("2026-09-24T11:00:00"),
    items: [line(tea._id, "Tea", 30, 1)], subtotal: 30, total: 30, paidAmount: 0,
    status: "Cancelled", cancelReason: "test", cancelledBy: "Asha",
    cancelledAt: ist("2026-09-24T11:05:00"), receiver: "Asha",
  });

  await Order.insertMany([O1, O2, O3, O4, O5, O6, O7, O8, O9, O10, O11, O12, O13, O14, O15, O16, O17, O18, O19, O20]);
  console.log(`Seeded 20 orders across 27-29 Sep + compare window.\n`);

  // ── Delete Burger (sold, must fall into "Removed items") and Cookie-Cat
  // (a product's category deleted -> "Uncategorised"), AFTER the orders that
  // reference them are written — mirrors the plan's "a product later deleted"
  // and "a product whose category was deleted" fixtures.
  await Product.deleteOne({ _id: burger._id });
  await Category.deleteOne({ _id: cookieCat._id });

  const completedBills = [O1, O2, O4, O5, O6, O7, O8, O9, O10, O11, O12, O14, O16, O17, O18] as SeedResult["completedBills"];

  return { tea: tea._id, coffee: coffee._id, burgerId: burger._id, cookie: cookie._id, completedBills };
}
