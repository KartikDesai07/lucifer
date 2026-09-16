/**
 * CB-5B S4/S5 — live-DB leg for the reward MONEY path (claim/return atomicity
 * + the Order snapshot round-trip through the ROUTE's exact write shapes).
 *
 * WHY THIS EXISTS: session 33's adversarial review found that Mongoose
 * `strict: true` silently drops any field declared on Zod/domain types but not
 * on the Mongoose schema — 200 OK, nothing stored, tsc/eslint/2100+ unit tests
 * all green. A DB-free suite structurally cannot see a field a real mongod
 * discards on write. This leg goes through the ROUTE'S EXACT SHAPE — the same
 * `Order.create` / `Order.findOneAndUpdate(filter, update, {new:true,
 * runValidators:true})` calls app/api/orders/route.ts, .../settle/route.ts,
 * .../items/route.ts and .../items/void/route.ts use — against a real mongod,
 * and reads back what actually landed. Where the route handler itself is not
 * imported directly (Next.js route modules are awkward to invoke standalone),
 * the update DOCUMENT is reproduced byte-for-byte from the route source, and
 * that is called out at each call site below.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_reward_redeem npm run verify:reward-redeem:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops what it touches. Prints pass/fail only, never the URI.
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Order, type IOrder } from "@/models/Order";
import { Customer } from "@/models/Customer";
import { Product } from "@/models/Product";
// CB-5B S16 legs 18/19 — the print-host queue and the Settings doc the settle
// fence resolves against. Imported here (not inside a scenario) so tsc sees
// the same module graph the routes do.
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { Settings } from "@/models/Settings";
import { computeOrderTotals, gstConfigFromOrder } from "@/lib/receipt";
import { claimRewardStamps, returnRewardStamps, rewardSnapshotFields } from "@/lib/reward-claim";
import { voidGuardFilter, resolveItemVoid } from "@/lib/order-void";
import { resolveRewardClaim } from "@/lib/reward-claim";
import { billPrintJob, kotPrintJob, voidPrintJob } from "@/lib/print-routing";
import { enqueuePrintJob } from "@/lib/print-queue";
import { updateSettingsSchema } from "@/schemas";
import type { Order as ClientOrder, OrderVoid as ClientOrderVoid } from "@/types";
import { acceptAddRoundBranch } from "@/lib/order-request-accept-addround";
import type { IOrderRequest } from "@/models/OrderRequest";
import type { AcceptContext } from "@/lib/order-request-accept";
import type { ISettings } from "@/models/Settings";
import { LOYALTY_STAMP_ORDERS_MAX } from "@pos/shared/public-diner";
import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import { printJobPayloadSchema } from "@pos/shared/schemas/print-job.schema";
import { LOYALTY_RULES_SCHEMA_VERSION } from "@pos/shared/loyalty-rules";
import {
  shouldStoreDiscountKind,
  redemptionSnapshotOf,
  REWARD_ITEM_LINE_NOTE,
  type RedeemedReward,
} from "@pos/shared/reward-redemption";
import { orderLineKey } from "@pos/shared/utils";
import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}reward_redeem`;

const NO_GST = { gstEnabled: false, gstRate: 0, gstMode: "inclusive" as const };

let passed = 0;
let failed = 0;

async function scenario(n: number, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok ${n} — ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${n} — ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

// A resolved flat-money milestone (no dish), same shape lib/reward-claim.ts's
// findMilestoneAt hands to resolveRewardClaim.
function flatMilestone(at: number, value: number): ResolvedMilestone {
  // qty carries no meaning for a flat reward — normalizeMilestones itself
  // normalises an absent/non-item qty to LOYALTY_REWARD_QTY_DEFAULT (1), never
  // 0 (loyalty-rules.ts); itemProductId stays null for a non-item rung.
  // CB-5D part 2 — a resolved rung states both promo axes explicitly; null =
  // this rung mints no code and its claim window never closes.
  return {
    at,
    kind: "flat",
    value,
    item: "",
    itemProductId: null,
    qty: 1,
    minBill: null,
    promoCode: null,
    claimWithinDays: null,
  };
}

function itemMilestone(at: number, productId: string, qty: number): ResolvedMilestone {
  return {
    at,
    kind: "item",
    value: 0,
    item: "Masala Chai",
    itemProductId: productId,
    qty,
    minBill: null,
  } as ResolvedMilestone;
}

// ── CB-5B S7 fixtures — the shapes acceptAddRoundBranch actually reads ─────
// Only the fields the branch touches are populated; the cast is confined here
// so every scenario below drives the REAL function rather than a re-implementation.
const PRINT_CFG_NO_NUMBER = { kot: { showNumber: false, numberStart: 1 } } as Parameters<
  typeof acceptAddRoundBranch
>[4];

const ACCEPT_CTX: AcceptContext = { actor: "Live Leg Staff", settings: null, createCustomer: false };

// A settings doc carrying one flat promo code, so the promo arm actually
// resolves to money (a code that resolves to 0 would not exercise A2 at all).
const SETTINGS_WITH_PROMO = {
  promoCodes: [{ code: "FLAT20", kind: "flat", value: 20, active: true, minBill: 0 }],
} as unknown as ISettings;

// One added round's item, in the shape acceptAddRoundBranch takes (the
// productId is a real ObjectId there, unlike the create-doc builder above).
function addRoundItem(pid: string): Parameters<typeof acceptAddRoundBranch>[2][number] {
  return {
    productId: new mongoose.Types.ObjectId(pid),
    name: "Masala Chai", price: 200, qty: 1, modifiers: [], instructions: "",
  } as unknown as Parameters<typeof acceptAddRoundBranch>[2][number];
}

function fakeRequest(over: Partial<IOrderRequest>): IOrderRequest {
  return {
    items: [], mobile: "9876543210", name: "Reward Test Diner",
    note: undefined, promoCode: undefined, quotedDiscount: undefined,
    ...over,
  } as unknown as IOrderRequest;
}

async function freshCustomer(stamps: number): Promise<mongoose.Types.ObjectId> {
  const c = await Customer.create({
    name: "Reward Test Diner",
    mobile: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
    stamps,
  });
  return c._id as mongoose.Types.ObjectId;
}

// Builds the doc exactly the way app/api/orders/route.ts's POST handler does
// for the fields this leg exercises — items, money, and (when `reward` is
// supplied) the omit-empty reward snapshot via rewardSnapshotFields. Mirrors
// the route's own construction rather than shortcutting it, since it is
// precisely THIS cast (the plain object handed to Order.create) that dropped
// fields silently when the Mongoose schema lagged behind.
function buildCreateDoc(input: {
  orderId: string;
  items: Array<{ productId: string; name: string; price: number; qty: number; reward?: boolean; note?: string }>;
  totals: ReturnType<typeof computeOrderTotals>;
  discountKind: "reward" | undefined;
  reward?: { reward: RedeemedReward; cost: number };
  customerId?: mongoose.Types.ObjectId;
}) {
  return {
    orderId: input.orderId,
    customerName: "Reward Test Diner",
    customerId: input.customerId,
    items: input.items.map((it) => ({ ...it, modifiers: [], instructions: "", kotRound: 1 })),
    kotRounds: 1,
    subtotal: input.totals.subtotal,
    discount: input.totals.discount,
    discountKind: shouldStoreDiscountKind(input.totals.discount, input.discountKind)
      ? input.discountKind
      : undefined,
    gstAmount: input.totals.gstAmount,
    gstRate: 0,
    gstMode: "inclusive" as const,
    total: input.totals.total,
    paidAmount: input.totals.total,
    payment: "Cash" as const,
    status: "Completed" as const,
    receiver: "Live Leg Staff",
    ...(input.reward ? rewardSnapshotFields(input.reward.reward, input.reward.cost) : {}),
  };
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = uri.split("/").pop()?.split("?")[0] ?? "";
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    console.error(`Refusing to run: database "${dbName}" is not a ${SCRATCH_PREFIX}* scratch DB.`);
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`\nreward redemption live — live against ${dbName}\n`);

  const product = await Product.create({
    name: "Masala Chai",
    categoryId: new mongoose.Types.ObjectId(),
    price: 200,
    discount: 0,
    available: true,
    isActive: true,
    image: "",
    modifiers: [],
  });
  const productId = product._id.toString();

  let orderSeq = 0;
  const nextOrderId = () => `ORD-LIVELEG-${(orderSeq += 1).toString().padStart(4, "0")}`;

  try {
    // ── Scenario 1 — round-trip storage of all seven snapshot fields ───────
    await scenario(
      1,
      "an item-reward order stores all SEVEN reward snapshot fields and reads them back",
      async () => {
        const customerId = await freshCustomer(20);
        const milestone = itemMilestone(8, productId, 2);
        const reward = redemptionSnapshotOf(milestone);
        const items = [
          { productId: new mongoose.Types.ObjectId().toString(), name: "Butter Naan", price: 60, qty: 2 },
          { productId, name: "Masala Chai", price: 200, qty: 2, reward: true },
        ];
        const totals = computeOrderTotals({
          items,
          discount: 0,
          discountKind: "reward",
          charge: 0,
          cfg: NO_GST,
          reward,
        });
        const orderId = nextOrderId();
        const claimed = await claimRewardStamps(customerId.toString(), orderId, milestone.at);
        assert.equal(claimed, true, "the claim must land for a funded balance");
        const doc = buildCreateDoc({
          orderId,
          items,
          totals,
          discountKind: "reward",
          reward: { reward, cost: milestone.at },
          customerId,
        });
        const created = await Order.create(doc);
        const stored = (await Order.findById(created._id).lean()) as unknown as IOrder;

        assert.equal(stored.rewardAt, 8, "rewardAt must survive the write");
        assert.equal(stored.rewardKind, "item", "rewardKind must survive the write");
        assert.equal(stored.rewardValue, 0, "rewardValue must survive the write");
        assert.equal(stored.rewardItem, "Masala Chai", "rewardItem must survive the write");
        assert.equal(stored.rewardStamps, 8, "rewardStamps (the cost) must survive the write");
        assert.equal(stored.rewardItemProductId, productId, "rewardItemProductId must survive the write");
        assert.equal(stored.rewardQty, 2, "rewardQty must survive the write");
      },
    );

    // ── Scenario 2 — item-line reward flag on the OrderItem subdocument ────
    await scenario(
      2,
      "items[].reward === true survives the OrderItem SUBDOCUMENT's own strict boundary",
      async () => {
        const orderId = nextOrderId();
        const items = [
          { productId: new mongoose.Types.ObjectId().toString(), name: "Butter Naan", price: 60, qty: 1 },
          { productId, name: "Masala Chai", price: 200, qty: 2, reward: true },
        ];
        const totals = computeOrderTotals({
          items,
          discount: 0,
          discountKind: undefined,
          charge: 0,
          cfg: NO_GST,
        });
        const doc = buildCreateDoc({ orderId, items, totals, discountKind: undefined });
        const created = await Order.create(doc);
        const stored = (await Order.findById(created._id).lean()) as unknown as IOrder;

        const rewardLine = stored.items.find((it) => it.name === "Masala Chai");
        assert.ok(rewardLine, "the reward dish line must be stored");
        assert.equal(rewardLine!.reward, true, "the SUBDOCUMENT must carry reward:true, not drop it");
        // Positive landmark: the OTHER line must NOT carry the flag, proving
        // this isn't a schema-wide default masking the assertion above.
        const ordinaryLine = stored.items.find((it) => it.name === "Butter Naan");
        assert.ok(ordinaryLine, "the ordinary line must also be stored");
        assert.notEqual(ordinaryLine!.reward, true, "an ordinary line must not carry reward:true");
      },
    );

    // ── Scenario 3 — claim atomicity ────────────────────────────────────────
    await scenario(3, "claimRewardStamps spends exactly once per orderId, and never over-balance", async () => {
      const customerId = await freshCustomer(10);
      const orderId = nextOrderId();

      const first = await claimRewardStamps(customerId.toString(), orderId, 8);
      assert.equal(first, true, "first claim against a funded balance must land");
      const second = await claimRewardStamps(customerId.toString(), orderId, 8);
      assert.equal(second, false, "a second claim for the SAME orderId must be a no-op");

      const afterDouble = await Customer.findById(customerId).select("stamps redeemedOrders").lean();
      assert.equal(afterDouble!.stamps, 2, "balance must drop by cost exactly ONCE (10 - 8 = 2)");
      const marks = (afterDouble!.redeemedOrders ?? []).filter((o) => o === orderId);
      assert.equal(marks.length, 1, "redeemedOrders must contain the orderId exactly once");

      // cost > balance must NOT spend — the $gte gate is in the filter.
      const orderId2 = nextOrderId();
      const overspend = await claimRewardStamps(customerId.toString(), orderId2, 100);
      assert.equal(overspend, false, "a claim costing more than the balance must not spend");
      const afterOverspend = await Customer.findById(customerId).select("stamps redeemedOrders").lean();
      assert.equal(afterOverspend!.stamps, 2, "balance must be UNCHANGED after a refused overspend claim");
      assert.ok(
        !(afterOverspend!.redeemedOrders ?? []).includes(orderId2),
        "a refused claim must not mark the orderId as redeemed",
      );
    });

    // ── Scenario 4 — return reciprocity ─────────────────────────────────────
    await scenario(
      4,
      "returnRewardStamps refunds exactly once for a landed claim, never for one that never claimed",
      async () => {
        const customerId = await freshCustomer(10);
        const orderIdClaimed = nextOrderId();
        const orderIdNeverClaimed = nextOrderId();

        const claimed = await claimRewardStamps(customerId.toString(), orderIdClaimed, 8);
        assert.equal(claimed, true);

        // Reciprocal guard: a return for an orderId that never claimed must not fire.
        const returnedForOther = await returnRewardStamps(customerId.toString(), orderIdNeverClaimed, 8);
        assert.equal(returnedForOther, false, "an orderId that never claimed must not be refunded");
        const afterOtherAttempt = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(afterOtherAttempt!.stamps, 2, "balance must be unaffected by the refused reciprocal return");

        const returned = await returnRewardStamps(customerId.toString(), orderIdClaimed, 8);
        assert.equal(returned, true, "returning a genuinely-claimed orderId must refund");
        const afterReturn = await Customer.findById(customerId).select("stamps returnedOrders").lean();
        assert.equal(afterReturn!.stamps, 10, "balance must be restored exactly once (2 + 8 = 10)");
        assert.equal(
          (afterReturn!.returnedOrders ?? []).filter((o) => o === orderIdClaimed).length,
          1,
          "returnedOrders must carry the orderId exactly once",
        );

        // Second return for the same orderId must be a no-op (no double-refund).
        const secondReturn = await returnRewardStamps(customerId.toString(), orderIdClaimed, 8);
        assert.equal(secondReturn, false, "a second return for the same orderId must not fire");
        const afterSecondReturn = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(afterSecondReturn!.stamps, 10, "balance must NOT double-refund");
      },
    );

    // ── Scenario 5 — money on the stored row, including the item-reward ₹0 case ─
    await scenario(
      5,
      "stored discount/total match computeOrderTotals, and discountKind==='reward' is STORED even at ₹0 (item reward)",
      async () => {
        // 5a — flat reward: nonzero discount, kind stored.
        const flatMs = flatMilestone(5, 50);
        const flatReward = redemptionSnapshotOf(flatMs);
        const flatItems = [{ productId: new mongoose.Types.ObjectId().toString(), name: "Thali", price: 200, qty: 1 }];
        const flatTotals = computeOrderTotals({
          items: flatItems,
          discount: 0,
          discountKind: "reward",
          charge: 0,
          cfg: NO_GST,
          reward: flatReward,
        });
        assert.equal(flatTotals.discount, 50, "sanity: flat reward must derive a 50 discount");
        const flatDoc = buildCreateDoc({
          orderId: nextOrderId(),
          items: flatItems,
          totals: flatTotals,
          discountKind: "reward",
          reward: { reward: flatReward, cost: flatMs.at },
        });
        const flatCreated = await Order.create(flatDoc);
        const flatStored = (await Order.findById(flatCreated._id).lean()) as unknown as IOrder;
        assert.equal(flatStored.discount, flatTotals.discount, "stored discount must match computeOrderTotals");
        assert.equal(flatStored.total, flatTotals.total, "stored total must match computeOrderTotals");
        assert.equal(flatStored.discountKind, "reward", "discountKind must be stored for a flat reward");

        // 5b — item reward: derived discount amount is ALWAYS 0, kind must
        // still be STORED (not $unset) — the whole reason shouldStoreDiscountKind
        // carries a named exception for "reward".
        const itemMs = itemMilestone(8, productId, 1);
        const itemReward = redemptionSnapshotOf(itemMs);
        const itemItems = [
          { productId: new mongoose.Types.ObjectId().toString(), name: "Thali", price: 200, qty: 1 },
          { productId, name: "Masala Chai", price: 200, qty: 1, reward: true },
        ];
        const itemTotals = computeOrderTotals({
          items: itemItems,
          discount: 0,
          discountKind: "reward",
          charge: 0,
          cfg: NO_GST,
          reward: itemReward,
        });
        assert.equal(itemTotals.discount, 0, "sanity: an item reward derives a ZERO discount amount");
        const itemDoc = buildCreateDoc({
          orderId: nextOrderId(),
          items: itemItems,
          totals: itemTotals,
          discountKind: "reward",
          reward: { reward: itemReward, cost: itemMs.at },
        });
        const itemCreated = await Order.create(itemDoc);
        const itemStored = (await Order.findById(itemCreated._id).lean()) as unknown as IOrder;
        assert.equal(itemStored.discount, 0, "stored discount must be 0 for an item reward");
        assert.equal(
          itemStored.discountKind,
          "reward",
          "discountKind MUST be stored even at ₹0 discount — this is shouldStoreDiscountKind's whole reason to exist; " +
            "if this reads undefined the reward snapshot is orphaned",
        );
      },
    );

    // ── Scenario 6 — item reward line is priced but untotalled ─────────────
    await scenario(
      6,
      "an item-reward order's stored total EXCLUDES the reward line's price while the line itself stores its real price",
      async () => {
        const itemMs = itemMilestone(8, productId, 1);
        const itemReward = redemptionSnapshotOf(itemMs);
        const items = [
          { productId: new mongoose.Types.ObjectId().toString(), name: "Thali", price: 200, qty: 1 },
          { productId, name: "Masala Chai", price: 200, qty: 1, reward: true },
        ];
        const totals = computeOrderTotals({
          items,
          discount: 0,
          discountKind: "reward",
          charge: 0,
          cfg: NO_GST,
          reward: itemReward,
        });
        // Subtotal must be JUST the Thali (200), not 200+200=400.
        assert.equal(totals.subtotal, 200, "computeOrderTotals must exclude the reward line from the subtotal");
        const doc = buildCreateDoc({
          orderId: nextOrderId(),
          items,
          totals,
          discountKind: "reward",
          reward: { reward: itemReward, cost: itemMs.at },
        });
        const created = await Order.create(doc);
        const stored = (await Order.findById(created._id).lean()) as unknown as IOrder;

        assert.equal(stored.total, 200, "the stored total must exclude the reward line's price (priced-but-untotalled)");
        const rewardLine = stored.items.find((it) => it.name === "Masala Chai");
        assert.ok(rewardLine, "the reward line must still be stored");
        assert.equal(rewardLine!.price, 200, "the reward line itself must store its REAL price, not 0");
        assert.equal(rewardLine!.qty, 1);
      },
    );

    // ── Scenario 7 — settle CAS miss returns the stamps ─────────────────────
    await scenario(
      7,
      "a settle write that loses its CAS (total moved underneath it) returns the claimed stamps",
      async () => {
        const customerId = await freshCustomer(10);
        const orderId = nextOrderId();
        const items = [{ productId: new mongoose.Types.ObjectId().toString(), name: "Thali", price: 200, qty: 1 }];
        const totals = computeOrderTotals({ items, discount: 0, discountKind: undefined, charge: 0, cfg: NO_GST });
        const created = await Order.create({
          orderId,
          customerName: "Reward Test Diner",
          customerId,
          items: items.map((it) => ({ ...it, modifiers: [], instructions: "", kotRound: 1 })),
          kotRounds: 1,
          subtotal: totals.subtotal,
          discount: totals.discount,
          gstAmount: totals.gstAmount,
          gstRate: 0,
          gstMode: "inclusive",
          total: totals.total,
          paidAmount: 0,
          payment: "Unpaid",
          status: "Pending",
          receiver: "Live Leg Staff",
        });

        // The route reads `old` (total=200), then resolves+claims the reward,
        // THEN writes with a CAS filter keyed on the total it read. Simulate a
        // racing writer landing between read and write — the same shape
        // scenario 7's spec calls for — by mutating the stored total directly
        // (a round fired from another device) before the settle's own write.
        await Order.updateOne({ _id: created._id }, { $set: { total: 999 } });

        const flatMs = flatMilestone(5, 50);
        const reward = redemptionSnapshotOf(flatMs);
        const claimed = await claimRewardStamps(customerId.toString(), orderId, flatMs.at);
        assert.equal(claimed, true, "the claim itself must land before the CAS write is attempted");

        // Mirrors app/api/orders/[id]/settle/route.ts's own filter/update shape,
        // keyed on the STALE total (200) it "read" — this is the CAS miss.
        const filter = {
          _id: created._id,
          status: "Pending",
          total: 200, // stale — the racing update above already moved it to 999
          ...voidGuardFilter(0),
        };
        const set: Record<string, unknown> = {
          payment: "Cash",
          paidAmount: 200,
          status: "Completed",
          ...rewardSnapshotFields(reward, flatMs.at),
        };
        const updated = await Order.findOneAndUpdate(filter, { $set: set }, { new: true, runValidators: true }).lean();
        assert.equal(updated, null, "the CAS write must miss (the filter's stale total cannot match)");

        // The route's own CAS-miss branch: on a definite no-write, return the claim.
        const returned = await returnRewardStamps(customerId.toString(), orderId, flatMs.at);
        assert.equal(returned, true, "a CAS miss must return the stamps that were claimed for this settle");

        const afterMiss = await Customer.findById(customerId).select("stamps returnedOrders").lean();
        assert.equal(afterMiss!.stamps, 10, "balance must be fully restored after the CAS miss");
        assert.ok(
          (afterMiss!.returnedOrders ?? []).includes(orderId),
          "returnedOrders must carry the orderId after the CAS-miss return",
        );

        // Vision guard: the order itself must still read UNCHANGED (no reward
        // snapshot leaked onto it from the failed write).
        const stillOld = (await Order.findById(created._id).lean()) as unknown as IOrder;
        assert.equal(stillOld.status, "Pending", "the order must remain Pending — the settle never landed");
        assert.equal(stillOld.rewardAt, undefined, "no reward snapshot may appear on an order the CAS write never touched");
      },
    );

    // ── Scenario 8 — void keeps a reward's discountKind ─────────────────────
    await scenario(
      8,
      "a void that drops the derived discount to 0 must NOT $unset discountKind==='reward' (the widened gate)",
      async () => {
        const itemMs = itemMilestone(8, productId, 1);
        const itemReward = redemptionSnapshotOf(itemMs);
        const orderId = nextOrderId();
        const items = [
          { productId: new mongoose.Types.ObjectId().toString(), name: "Thali", price: 200, qty: 1, kotRound: 1 },
          { productId, name: "Masala Chai", price: 200, qty: 1, reward: true, kotRound: 1 },
        ];
        const totals = computeOrderTotals({
          items,
          discount: 0,
          discountKind: "reward",
          charge: 0,
          cfg: NO_GST,
          reward: itemReward,
        });
        assert.equal(totals.discount, 0, "sanity: an item reward's derived discount is 0 going in");

        const created = await Order.create({
          orderId,
          customerName: "Reward Test Diner",
          items: items.map((it) => ({ ...it, modifiers: [], instructions: "" })),
          kotRounds: 1,
          subtotal: totals.subtotal,
          discount: totals.discount,
          discountKind: "reward",
          gstAmount: totals.gstAmount,
          gstRate: 0,
          gstMode: "inclusive",
          total: totals.total,
          paidAmount: 0,
          payment: "Unpaid",
          status: "Pending",
          receiver: "Live Leg Staff",
          ...rewardSnapshotFields(itemReward, itemMs.at),
        });
        const before = (await Order.findById(created._id).lean()) as unknown as IOrder;
        assert.equal(before.discountKind, "reward", "sanity: the order starts with discountKind reward");

        // Void the ORDINARY line (Thali), mirroring
        // app/api/orders/[id]/items/void/route.ts's resolveItemVoid + write shape.
        const resolved = resolveItemVoid({
          items: before.items,
          request: {
            index: 0,
            lineKey: orderLineKey({
              productId: String(before.items[0]!.productId),
              qty: before.items[0]!.qty,
              kotRound: before.items[0]!.kotRound,
              instructions: before.items[0]!.instructions,
              modifiers: before.items[0]!.modifiers,
              variation: before.items[0]!.variation,
            }),
            qty: 1,
            reason: "test void",
            voidedBy: "Live Leg Staff",
            at: new Date(),
          },
          discount: before.discount,
          discountKind: before.discountKind,
          // CB-5B — this fixture carries no reward; stated explicitly because
          // ItemVoidInput.reward is REQUIRED (a void must never silently strip one).
          reward: undefined,
          charge: 0,
          gstCfg: gstConfigFromOrder(before, NO_GST),
        });
        assert.ok(!("error" in resolved), "the void must resolve against the line as stored");
        if ("error" in resolved) return;
        assert.equal(resolved.totals.discount, 0, "the re-derived discount after voiding stays 0");

        // The route's OWN gate: widened to route through shouldStoreDiscountKind
        // so a "reward" kind is never $unset just because the amount reads 0.
        const mustUnset =
          before.discountKind !== undefined &&
          resolved.totals.discount === 0 &&
          !shouldStoreDiscountKind(resolved.totals.discount, before.discountKind);
        assert.equal(mustUnset, false, "the widened gate must refuse to $unset a reward kind at ₹0 discount");

        const update: Record<string, unknown> = {
          $set: {
            items: resolved.nextItems,
            subtotal: resolved.totals.subtotal,
            discount: resolved.totals.discount,
            gstAmount: resolved.totals.gstAmount,
            total: resolved.totals.total,
          },
          $push: { voids: resolved.entry },
          ...(mustUnset ? { $unset: { discountKind: "" } } : {}),
        };
        const updated = await Order.findOneAndUpdate(
          { _id: created._id, status: "Pending", ...voidGuardFilter(0) },
          update,
          { new: true, runValidators: true },
        ).lean();
        assert.ok(updated, "the void write must land");
        assert.equal(
          updated!.discountKind,
          "reward",
          "discountKind must SURVIVE the void — a widened-gate regression would $unset it here",
        );
        assert.equal(updated!.rewardAt, itemMs.at, "the reward snapshot's rewardAt must still be present after the void");
        assert.equal(updated!.rewardItemProductId, productId, "the reward snapshot's product ref must still be present");
        // Vision guard: the voided line really is gone/reduced (proves this
        // wasn't a no-op write that trivially "kept" the kind).
        assert.equal(
          updated!.voids?.length,
          1,
          "the void trail must record exactly one entry — proves the write actually happened",
        );
      },
    );
    // ── Scenario 9 — the CAS-miss retry lockout (the reported HIGH bug) ────
    // Full lifecycle against real mongod: claim -> return -> RETRY CLAIM
    // SUCCEEDS is the actual regression (a bare `redeemedOrders:{$ne:orderId}`
    // filter locks a returned order out of ever claiming again — this is
    // Mongo $or/$addToSet/$pull semantics no DB-free fake can prove). Also
    // exercises the double-spend refusal after the retry, a second
    // return/double-return, a DIFFERENT orderId staying unaffected throughout,
    // and an over-balance claim refusal — all against the SAME customer row so
    // any cross-order leakage in the marker arrays would surface here.
    await scenario(
      9,
      "claim -> return -> RETRY CLAIM succeeds (lockout regression), then double-spend/double-return refused, a second return fires, a different order is unaffected, and over-balance is refused",
      async () => {
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();
        const otherOrderId = nextOrderId();
        const cost = 8;

        // (d) baseline: a DIFFERENT order's own claim first, so it has a
        // chance to be corrupted by anything the primary orderId's lifecycle
        // below does to the shared Customer row.
        const otherClaimed = await claimRewardStamps(customerId.toString(), otherOrderId, cost);
        assert.equal(otherClaimed, true, "sanity: the other order's own first claim must land");
        const afterOtherClaim = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(afterOtherClaim!.stamps, 12, "20 - 8 = 12 after the other order's claim");

        // First claim on the primary orderId — simulates the write whose CAS
        // is about to be lost (e.g. a settle whose total moved underneath it).
        const firstClaim = await claimRewardStamps(customerId.toString(), orderId, cost);
        assert.equal(firstClaim, true, "the primary order's first claim must land");
        const afterFirstClaim = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(afterFirstClaim!.stamps, 4, "12 - 8 = 4 after the primary claim");

        // The CAS-losing write returns the stamps (the correct compensating
        // action) — this leaves orderId in BOTH redeemedOrders (never removed,
        // by design — the historical record) AND returnedOrders.
        const returned = await returnRewardStamps(customerId.toString(), orderId, cost);
        assert.equal(returned, true, "the compensating return must land");
        const afterReturn = await Customer.findById(customerId).select("stamps redeemedOrders returnedOrders").lean();
        assert.equal(afterReturn!.stamps, 12, "4 + 8 = 12 after the return — balance correctly restored");
        assert.ok(
          (afterReturn!.redeemedOrders ?? []).includes(orderId),
          "sanity: WAS-bug precondition — orderId is still in redeemedOrders after the return",
        );
        assert.ok(
          (afterReturn!.returnedOrders ?? []).includes(orderId),
          "sanity: orderId is in returnedOrders after the return",
        );

        // (a) THE REGRESSION: a retry of the SAME orderId must now succeed.
        // Pre-fix, the bare {$ne: orderId} filter refused this forever (the
        // exact "Not enough stamps at a full card" symptom) even though the
        // balance was correctly back at 20 (here 12, since otherOrderId also
        // spent 8 of the original 20).
        const retryClaim = await claimRewardStamps(customerId.toString(), orderId, cost);
        assert.equal(retryClaim, true, "RETRY CLAIM must succeed after a return — this is the lockout regression");
        const afterRetry = await Customer.findById(customerId).select("stamps redeemedOrders returnedOrders").lean();
        assert.equal(afterRetry!.stamps, 4, "12 - 8 = 4 after the retry claim lands");
        assert.equal(
          (afterRetry!.redeemedOrders ?? []).filter((o) => o === orderId).length,
          1,
          "$addToSet must keep exactly ONE entry for orderId in redeemedOrders, never a duplicate",
        );
        assert.ok(
          !(afterRetry!.returnedOrders ?? []).includes(orderId),
          "the retry's $pull must clear orderId from returnedOrders — it is spent-and-not-returned again",
        );

        // (b) double-spend: a claim for the SAME orderId right after the
        // successful retry must still be refused (it is not also returned).
        const doubleSpend = await claimRewardStamps(customerId.toString(), orderId, cost);
        assert.equal(doubleSpend, false, "a double-spend on the SAME orderId (not returned) must still be refused");
        const afterDoubleSpend = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(afterDoubleSpend!.stamps, 4, "balance must be unchanged by the refused double-spend");

        // (c) a SECOND return still fires after the re-claim (true, balance
        // restored), and a double-return right after is refused.
        const secondReturn = await returnRewardStamps(customerId.toString(), orderId, cost);
        assert.equal(secondReturn, true, "a second return, after the re-claim, must fire");
        const afterSecondReturn = await Customer.findById(customerId).select("stamps returnedOrders").lean();
        assert.equal(afterSecondReturn!.stamps, 12, "4 + 8 = 12 after the second return");
        assert.equal(
          (afterSecondReturn!.returnedOrders ?? []).filter((o) => o === orderId).length,
          1,
          "returnedOrders must carry orderId exactly once after the second return, not accumulate",
        );

        const doubleReturn = await returnRewardStamps(customerId.toString(), orderId, cost);
        assert.equal(doubleReturn, false, "a double-return right after the second return must be refused");
        const afterDoubleReturn = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(afterDoubleReturn!.stamps, 12, "balance must NOT double-refund");

        // (d) the DIFFERENT order's own state must be untouched by any of the
        // above — its own claim (8) still stands, never returned.
        const otherFinal = await Customer.findById(customerId).select("redeemedOrders returnedOrders").lean();
        assert.ok(
          (otherFinal!.redeemedOrders ?? []).includes(otherOrderId),
          "the other order's own claim mark must survive untouched",
        );
        assert.ok(
          !(otherFinal!.returnedOrders ?? []).includes(otherOrderId),
          "the other order must never have been marked returned by anything the primary orderId's lifecycle did",
        );

        // (e) an over-balance claim is still refused: balance is 12, cost 999.
        const overBalance = await claimRewardStamps(customerId.toString(), nextOrderId(), 999);
        assert.equal(overBalance, false, "a claim costing more than the balance must still be refused after all this");
        const afterOverBalance = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(afterOverBalance!.stamps, 12, "balance must be unchanged by the refused over-balance claim");
      },
    );

    // ── Scenario 10 — `note` round-trips through a real Order.create ───────
    // Session-33 bug class: a field declared on the domain shape (here
    // RewardItemLine's `note`) but not on the Mongoose orderItemSchema is
    // SILENTLY DROPPED by strict:true — 200 OK, `reward: true` beside it
    // stores fine, `note` reads back undefined. Only a real mongod write can
    // prove this; a DB-free fake would just echo back whatever JS object it
    // was handed.
    await scenario(
      10,
      "a reward item line's `note` round-trips through a real Order.create and reads back === REWARD_ITEM_LINE_NOTE; an ordinary line carries no note",
      async () => {
        const orderId = nextOrderId();
        const items = [
          { productId: new mongoose.Types.ObjectId().toString(), name: "Butter Naan", price: 60, qty: 1 },
          {
            productId,
            name: "Masala Chai",
            price: 200,
            qty: 1,
            reward: true,
            note: REWARD_ITEM_LINE_NOTE,
          },
        ];
        const totals = computeOrderTotals({
          items,
          discount: 0,
          discountKind: undefined,
          charge: 0,
          cfg: NO_GST,
        });
        const doc = buildCreateDoc({ orderId, items, totals, discountKind: undefined });
        const created = await Order.create(doc);
        const stored = (await Order.findById(created._id).lean()) as unknown as IOrder;

        // The strict-drop canary: this is exactly the field session-33's bug
        // class silently discards while `reward` beside it stores fine.
        const rewardLine = stored.items.find((it) => it.name === "Masala Chai");
        assert.ok(rewardLine, "the reward dish line must be stored");
        assert.equal(
          rewardLine!.note,
          REWARD_ITEM_LINE_NOTE,
          "note must round-trip through Order.create/find — a schema-less path silently drops it",
        );
        assert.equal(rewardLine!.reward, true, "sanity: reward:true must still store beside note");

        // Positive landmark: an ordinary line carries no note at all (proves
        // this isn't a schema-wide default masking the assertion above).
        const ordinaryLine = stored.items.find((it) => it.name === "Butter Naan");
        assert.ok(ordinaryLine, "the ordinary line must also be stored");
        assert.equal(ordinaryLine!.note, undefined, "an ordinary line must carry no note");
      },
    );

    // ── Scenario 11 — S6: CANCEL RETURNS THE STAMPS (D2) ──────────────────
    // The cancel ROUTE's own shape, not just the lib pair: the CAS document
    // from app/api/orders/[id]/cancel/route.ts is reproduced byte-for-byte,
    // and the return is driven off the STORED rewardStamps the way the route
    // reads it (updated.rewardStamps), against a real mongod. Proves the full
    // money round-trip a DB-free fake cannot: that the cost actually persisted
    // on the order is the cost the diner gets back.
    await scenario(
      11,
      "S6: a claimed reward order, when CANCELLED, returns exactly the STORED rewardStamps cost — once, and only once",
      async () => {
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();
        const milestone = flatMilestone(8, 100);
        const reward = redemptionSnapshotOf(milestone);

        // Claim, exactly as a staff writer does, BEFORE the order is written.
        const claimed = await claimRewardStamps(customerId.toString(), orderId, milestone.at);
        assert.equal(claimed, true, "sanity: the claim must land before the order is created");
        const items = [{ productId, name: "Masala Chai", price: 200, qty: 2 }];
        const totals = computeOrderTotals({
          items,
          discount: 100,
          discountKind: "reward",
          charge: 0,
          cfg: NO_GST,
        });
        const created = await Order.create(
          buildCreateDoc({
            orderId,
            items,
            totals,
            discountKind: "reward",
            reward: { reward, cost: milestone.at },
            customerId,
          }),
        );
        const afterClaim = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(afterClaim!.stamps, 12, "20 - 8 = 12 while the reward order stands");

        // The cancel route's OWN CAS write, reproduced from its source.
        const cancelled = (await Order.findOneAndUpdate(
          { _id: created._id, status: "Completed" },
          {
            $set: {
              status: "Cancelled",
              cancelReason: "Wrong order",
              cancelledBy: "Live Leg Admin",
              cancelledAt: new Date(),
            },
          },
          { new: true, runValidators: true },
        ).lean()) as unknown as IOrder | null;
        assert.ok(cancelled, "sanity: the cancel CAS must land");

        // THE COST COMES OFF THE ORDER, not the live ladder — the route reads
        // updated.rewardStamps precisely so an owner retuning the rung after
        // the claim cannot change what gets refunded.
        assert.equal(cancelled!.rewardStamps, 8, "the stamp cost must have persisted on the order for S6 to read");
        const returned = await returnRewardStamps(
          customerId.toString(),
          cancelled!.orderId,
          cancelled!.rewardStamps ?? 0,
        );
        assert.equal(returned, true, "the cancel must return the stamps");
        const afterCancel = await Customer.findById(customerId).select("stamps stampsLifetime").lean();
        assert.equal(afterCancel!.stamps, 20, "12 + 8 = 20 — the diner is made whole by the cancel");

        // A re-run of the same cancel (an operator double-tap, a retried
        // request) must NOT refund twice.
        const secondCancelReturn = await returnRewardStamps(
          customerId.toString(),
          cancelled!.orderId,
          cancelled!.rewardStamps ?? 0,
        );
        assert.equal(secondCancelReturn, false, "a repeated cancel-return must be refused");
        const afterDouble = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(afterDouble!.stamps, 20, "the balance must NOT double-refund on a repeated cancel");
      },
    );

    // ── Scenario 12 — S6: the stamps can be spent AGAIN after a cancel ─────
    // The reason claimRewardStamps carries its $or re-entry arm. A diner whose
    // order was cancelled must be able to redeem the same rung on the NEXT
    // order — both on a brand-new orderId and (the harder case) on the very
    // same orderId, since the marker arrays keep the cancelled order forever.
    await scenario(
      12,
      "S6: after a cancel returns the stamps, the diner can redeem again — on a new order AND on the same orderId",
      async () => {
        const customerId = await freshCustomer(10);
        const orderId = nextOrderId();
        const cost = 8;

        assert.equal(await claimRewardStamps(customerId.toString(), orderId, cost), true, "sanity: first claim lands");
        assert.equal(await returnRewardStamps(customerId.toString(), orderId, cost), true, "sanity: the cancel returns it");
        const afterReturn = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(afterReturn!.stamps, 10, "the balance is whole again after the cancel");

        // Same orderId again (the lockout regression, in the CANCEL direction).
        assert.equal(
          await claimRewardStamps(customerId.toString(), orderId, cost),
          true,
          "the SAME orderId must be able to claim again after a cancel returned its stamps",
        );
        assert.equal(
          (await Customer.findById(customerId).select("stamps").lean())!.stamps,
          2,
          "10 - 8 = 2 after the re-claim",
        );
        // ...and a fresh order cannot claim on the now-drained balance.
        assert.equal(
          await claimRewardStamps(customerId.toString(), nextOrderId(), cost),
          false,
          "a second order must be refused once the balance is drained — no phantom stamps from the cancel cycle",
        );
      },
    );

    // ── Scenario 13 — S6: a REASSIGNED customer is not credited ────────────
    // PUT /api/orders/[id] (updateOrderSchema picks customerId) can move a tab
    // to a different customer AFTER a reward was claimed. The cancel must then
    // refuse rather than mint stamps on a row that never spent any — the
    // filter's `redeemedOrders: orderId` term is what makes that safe, and this
    // is the only place it can be proven against real Mongo.
    //
    // READ THIS BEFORE "FIXING" THE ASSERTION BELOW. The refusal is the SAFE
    // half of the story, not the whole of it: the spender's stamps are then
    // stuck spent with no path back, because the marker that would authorise a
    // refund sits on the SPENDER's row while the cancel only ever looks at the
    // order's CURRENT customerId. This scenario pins the refusal (which must
    // never change — crediting the new owner would MINT stamps) and documents
    // the loss; it does not endorse it. The real fix belongs at the PUT, which
    // should refuse to reassign a reward-carrying order at all — the open item
    // already booked in cb5b-plan.md. Recovery, if it is ever needed before
    // then, is `Customer.findOne({ redeemedOrders: <orderId> })`, which finds
    // the true spender. Today the path is UNREACHABLE from the shipped UI:
    // useUpdateOrder (hooks/use-orders.ts:222) has no call sites.
    await scenario(
      13,
      "S6: cancelling an order whose customer was REASSIGNED credits nobody — the spender keeps the debit, the new customer gets no free stamps",
      async () => {
        const spender = await freshCustomer(20);
        const newOwner = await freshCustomer(5);
        const orderId = nextOrderId();
        const cost = 8;

        assert.equal(await claimRewardStamps(spender.toString(), orderId, cost), true, "sanity: the spender's claim lands");

        // The cancel, now reading the REASSIGNED customerId off the order.
        const returned = await returnRewardStamps(newOwner.toString(), orderId, cost);
        assert.equal(returned, false, "a customer who never spent for this order must NOT be credited");
        assert.equal(
          (await Customer.findById(newOwner).select("stamps").lean())!.stamps,
          5,
          "the reassigned customer's balance must be untouched — no minted stamps",
        );
        assert.equal(
          (await Customer.findById(spender).select("stamps").lean())!.stamps,
          12,
          "the original spender is STILL OUT the stamps — the refund follows the ORDER's current customerId, so a "
            + "reassignment strands them (documented above, fixed at the PUT, not here). This asserts the CURRENT "
            + "behaviour so a future PUT-side fence has a pin to flip, NOT that the loss is acceptable.",
        );
      },
    );


    // ── Scenario 14 — REGRESSION: marker-array eviction must not re-open the
    // double refund. The bug (found by review, then LIVE-PROBED before the
    // fix): returnedOrders was $slice-capped at LOYALTY_STAMP_ORDERS_MAX while
    // its partner redeemedOrders is uncapped. returnRewardStamps's filter has
    // no re-entry arm, so returnedOrders is its ONLY guard — and a capped guard
    // FORGETS. Once an orderId aged out, `redeemedOrders: orderId` still
    // matched AND `returnedOrders: {$ne: orderId}` matched again, so a repeat
    // return credited the stamps a SECOND time, minting stamps nobody spent.
    // This drives the real helpers past the old cap and asserts the repeat
    // return is still refused. Against the pre-fix code it FAILED (+cost).
    await scenario(
      14,
      "REGRESSION: a repeat return is still refused after MORE than LOYALTY_STAMP_ORDERS_MAX distinct returns — the eviction double-refund stays closed",
      async () => {
        // Enough stamps to actually fund the victim's claim: claimRewardStamps
        // carries `stamps: {$gte: cost}` in its FILTER, so a zero balance
        // cannot claim at all (the filler claims below cost 0 and need none).
        const cost = 8;
        const customerId = await freshCustomer(cost);
        const victimOrderId = nextOrderId();

        // The order whose refund must never fire twice, claimed and returned
        // FIRST so it is the oldest entry — the one a capped array evicts.
        assert.equal(await claimRewardStamps(customerId.toString(), victimOrderId, cost), true, "sanity: the victim order's claim lands");
        assert.equal(await returnRewardStamps(customerId.toString(), victimOrderId, cost), true, "sanity: its first return fires");

        // Push PAST the old cap with distinct orders, each claimed then
        // returned, so returnedOrders would have evicted the victim.
        for (let i = 0; i <= LOYALTY_STAMP_ORDERS_MAX; i += 1) {
          const oid = nextOrderId();
          await claimRewardStamps(customerId.toString(), oid, 0);
          await returnRewardStamps(customerId.toString(), oid, 0);
        }

        const row = await Customer.findById(customerId).select("stamps returnedOrders redeemedOrders").lean();
        assert.ok(
          (row!.returnedOrders ?? []).length > LOYALTY_STAMP_ORDERS_MAX,
          "landmark: returnedOrders must have grown PAST the old cap — otherwise this scenario never reaches the eviction it exists to test",
        );
        assert.ok(
          (row!.returnedOrders ?? []).includes(victimOrderId),
          "the victim orderId must STILL be remembered in returnedOrders — a capped array would have evicted it here, which is the bug",
        );
        assert.ok(
          (row!.redeemedOrders ?? []).includes(victimOrderId),
          "landmark: the partner array still remembers the victim too — that asymmetry is what made eviction exploitable",
        );

        // THE REGRESSION: a repeat return of the long-ago order must be refused.
        const balanceBefore = row!.stamps;
        const repeat = await returnRewardStamps(customerId.toString(), victimOrderId, cost);
        assert.equal(repeat, false, "a repeat return of an aged-out order must be REFUSED — this is the eviction double-refund");
        const after = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(after!.stamps, balanceBefore, "no stamps may be minted by a repeat return of an aged-out order");
      },
    );


    // ── CB-5B S7 — the QR add-round path, driven through the REAL branch ───
    //
    // WHY THESE ARE LIVE: acceptAddRoundBranch ends in a real
    // Order.findOneAndUpdate with runValidators — the only place that can show
    // what a mongod actually stores after a diner adds a round to a tab that
    // carries a reward. The DB-free pins prove the DECISION; these prove the
    // stored BILL.
    await scenario(
      15,
      "S7 REGRESSION: a QR add-round onto a REWARD tab keeps the kind and the discount — the tab is NOT re-billed at full price",
      async () => {
        const cost = 8;
        const customerId = await freshCustomer(cost);
        const orderId = nextOrderId();
        const reward = redemptionSnapshotOf(flatMilestone(cost, 50));

        // A tab already carrying a claimed flat reward: Rs 200 of food, Rs 50 off.
        const openItems = [{ productId, name: "Masala Chai", price: 200, qty: 1 }];
        const tabTotals = computeOrderTotals({
          items: openItems, discount: 0, discountKind: "reward", charge: 0, cfg: NO_GST, reward,
        });
        assert.equal(tabTotals.discount, 50, "sanity: the reward must be worth Rs 50 on the open tab");
        await claimRewardStamps(customerId.toString(), orderId, cost);
        const created = await Order.create({
          ...buildCreateDoc({
            orderId, items: openItems, totals: tabTotals, discountKind: "reward",
            reward: { reward, cost }, customerId,
          }),
          payment: "Unpaid", status: "Pending", paidAmount: 0,
        });

        // The diner adds a second round of Rs 200 through the QR surface.
        const openTab = (await Order.findById(created._id).lean()) as unknown as IOrder;
        const result = await acceptAddRoundBranch(
          fakeRequest({}), openTab,
          [addRoundItem(productId)],
          NO_GST, PRINT_CFG_NO_NUMBER, String(created._id), ACCEPT_CTX,
        );
        assert.ok(!("error" in result), `the add-round must succeed: ${"error" in result ? result.error : ""}`);

        const after = await Order.findById(created._id).select("discount discountKind rewardAt rewardStamps subtotal total").lean();
        // THE BUG THIS CATCHES: pre-fix, keepGstKind knew only "gst", so the
        // kind was $unset and the whole bill re-priced at FULL price while the
        // diner's stamps stayed spent — they lost the money AND the stamps.
        assert.equal(after!.discountKind, "reward", "the reward kind must SURVIVE a diner add-round");
        assert.equal(after!.discount, 50, "the reward's Rs 50 must still be off the bill — never re-billed at full price");
        assert.equal(after!.subtotal, 400, "landmark: both rounds must actually be on the bill");
        assert.equal(after!.total, 350, "the stored total must be subtotal minus the still-derived reward");
        assert.equal(after!.rewardAt, cost, "the reprint snapshot must survive the round untouched");
        assert.equal(after!.rewardStamps, cost, "the stored stamp COST must survive — it is what a cancel refunds");

        const row = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(row!.stamps, 0, "no stamps may be spent or returned by an add-round");
      },
    );

    await scenario(
      16,
      "S7 A2/D6: a PROMO arriving onto a reward tab is REFUSED — never silently merged",
      async () => {
        const cost = 8;
        const customerId = await freshCustomer(cost);
        const orderId = nextOrderId();
        const reward = redemptionSnapshotOf(flatMilestone(cost, 50));
        const openItems = [{ productId, name: "Masala Chai", price: 200, qty: 1 }];
        const tabTotals = computeOrderTotals({
          items: openItems, discount: 0, discountKind: "reward", charge: 0, cfg: NO_GST, reward,
        });
        await claimRewardStamps(customerId.toString(), orderId, cost);
        const created = await Order.create({
          ...buildCreateDoc({
            orderId, items: openItems, totals: tabTotals, discountKind: "reward",
            reward: { reward, cost }, customerId,
          }),
          payment: "Unpaid", status: "Pending", paidAmount: 0,
        });

        const openTab = (await Order.findById(created._id).lean()) as unknown as IOrder;
        const result = await acceptAddRoundBranch(
          // A round carrying a promo code that resolves to a real discount.
          fakeRequest({ promoCode: "FLAT20", quotedDiscount: 20 }), openTab,
          [addRoundItem(productId)],
          NO_GST, PRINT_CFG_NO_NUMBER, String(created._id),
          { ...ACCEPT_CTX, settings: SETTINGS_WITH_PROMO },
        );
        assert.ok("error" in result, "a promo onto a reward tab must be REFUSED, not merged");
        assert.match(
          (result as { error: string }).error,
          /promo code|reward/i,
          "the refusal must be staff-actionable, naming what to do about it",
        );

        // And nothing may have changed on the bill.
        const after = await Order.findById(created._id).select("discount discountKind subtotal kotRounds").lean();
        assert.equal(after!.discountKind, "reward", "a refused round must leave the reward kind alone");
        assert.equal(after!.discount, 50, "a refused round must not change the discount");
        assert.equal(after!.subtotal, 200, "a refused round must not add its items to the bill");
      },
    );

    await scenario(
      17,
      "S7: the shipped GST behaviour is unchanged — gst alone survives a QR add-round, gst+promo collapses to a manual discount",
      async () => {
        // The C5 precedent this slice must not have disturbed.
        const gstCfg = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" as const };
        const openItems = [{ productId, name: "Masala Chai", price: 200, qty: 1 }];
        const tabTotals = computeOrderTotals({
          items: openItems, discount: 0, discountKind: "gst", charge: 0, cfg: gstCfg,
        });
        const created = await Order.create({
          ...buildCreateDoc({
            orderId: nextOrderId(), items: openItems, totals: tabTotals, discountKind: undefined,
          }),
          // buildCreateDoc's kind param is typed for the reward path, so the
          // gst kind is stamped on HERE — deliberately explicit, because the
          // whole point of this scenario is that the tab really does carry
          // "gst" before the add-round runs (a fixture that stored nothing
          // would assert against a tab with no kind and pass vacuously).
          discountKind: "gst",
          gstRate: 5, gstMode: "exclusive", payment: "Unpaid", status: "Pending", paidAmount: 0,
        });
        assert.equal(
          (await Order.findById(created._id).select("discountKind").lean())!.discountKind,
          "gst",
          "fixture sanity: the tab must really carry the gst kind before the add-round",
        );
        const openTab = (await Order.findById(created._id).lean()) as unknown as IOrder;
        const result = await acceptAddRoundBranch(
          fakeRequest({}), openTab,
          [addRoundItem(productId)],
          gstCfg, PRINT_CFG_NO_NUMBER, String(created._id), ACCEPT_CTX,
        );
        assert.ok(!("error" in result), "a plain gst add-round must still succeed");
        const after = await Order.findById(created._id).select("discountKind discount").lean();
        assert.equal(after!.discountKind, "gst", "a gst tab with no promo must keep its kind (shipped C5 behaviour)");
        assert.ok((after!.discount ?? 0) > 0, "the gst preset must still re-derive against the grown bill");
      },
    );

    // ── CB-5B S16 legs 18-20 — the surfaces S13/S14 built, proven LIVE ─────
    // Scenarios 1-17 prove the reward MONEY path against a real mongod. What
    // no scenario above touches is what the free dish does AFTER it is stored:
    // whether a host-routed slip can actually carry it (S14's `.strict()`
    // blocker), whether settle refuses an item rung against real Settings
    // (R10), and whether voiding the REWARD LINE ITSELF keeps its provenance
    // on the trail (scenario 8 voids the ORDINARY line on a reward tab — the
    // reward line's own void entry has never been written to a real mongod).

    // ── Scenario 18 — the three-surface pin, against a real PrintJob row ───
    // P-NEW-10 lives DB-free in print-routing.test.ts. What that suite
    // structurally cannot see: `printOrderSnapshotItemSchema` is `.strict()`,
    // and the payload is stored as a JSON STRING, so a key the projection
    // drops or the schema refuses is only visible once the payload has made
    // the full round trip — built from a doc a real mongod handed back,
    // parsed by the REAL route schema (app/api/print-jobs/route.ts:22), and
    // read back out of a persisted PrintJob. That is the exact shape the S14
    // deploy blocker took: a KOT stamped "invalid-payload" and dismissed, i.e.
    // the kitchen never told to make the free dish.
    await scenario(
      18,
      "S13/S14 THREE SURFACES: a stored reward order's KOT, BILL and VOID payloads each carry the reward line THROUGH the real .strict() schema and a persisted PrintJob round-trip",
      async () => {
        const customerId = await freshCustomer(20);
        const itemMs = itemMilestone(8, productId, 1);
        const reward = redemptionSnapshotOf(itemMs);
        const items = [
          { productId: new mongoose.Types.ObjectId().toString(), name: "Paneer Thali", price: 260, qty: 1 },
          { productId, name: "Masala Chai", price: 200, qty: 1, reward: true, note: REWARD_ITEM_LINE_NOTE },
        ];
        const totals = computeOrderTotals({
          items, discount: 0, discountKind: "reward", charge: 0, cfg: NO_GST, reward,
        });
        const orderId = nextOrderId();
        const created = await Order.create({
          ...buildCreateDoc({
            orderId, items, totals, discountKind: "reward",
            reward: { reward, cost: itemMs.at }, customerId,
          }),
          tableNo: "T-4",
          kotNumbers: [11],
          billNumber: 501,
        });

        // Read the order back the way the API hands it to the client: the GET
        // route carries NO projection (app/api/orders/route.ts:62), so the
        // stored document IS what the print builders receive. Anything Mongoose
        // dropped on write is therefore missing here too — which is the point.
        const stored = (await Order.findById(created._id).lean()) as unknown as IOrder;
        assert.equal(stored.items[1]!.reward, true, "fixture sanity: the reward flag must be STORED before any slip is built");
        assert.equal(stored.items[1]!.note, REWARD_ITEM_LINE_NOTE, "fixture sanity: the marker note must be STORED too");
        const clientOrder = JSON.parse(JSON.stringify(stored)) as unknown as ClientOrder;

        // The void trail entry is taken from the REAL resolveItemVoid, not
        // hand-built. This matters: order-void.ts:171-173 writes
        // `instructions`/`modifiers` OMIT-EMPTY, and a reward line always
        // carries `instructions: ""` + `modifiers: []` (reward-claim.ts), so a
        // genuine reward-line void entry has NEITHER key. A hand-written
        // fixture that set them to ""/[] would be testing a shape production
        // never produces — and would keep passing if `voidPrintJob` ever
        // stopped null-guarding those two fields, while every real reward void
        // slip broke. Reviewer-found (S16); closed by driving the real builder.
        const rewardLineForVoid = stored.items[1]!;
        const resolvedVoid = resolveItemVoid({
          items: stored.items,
          request: {
            index: 1,
            lineKey: orderLineKey({
              productId: String(rewardLineForVoid.productId),
              qty: rewardLineForVoid.qty,
              kotRound: rewardLineForVoid.kotRound,
              instructions: rewardLineForVoid.instructions,
              modifiers: rewardLineForVoid.modifiers,
              variation: rewardLineForVoid.variation,
            }),
            qty: 1,
            reason: "customer changed mind",
            voidedBy: "Live Leg Staff",
            at: new Date(),
          },
          discount: stored.discount,
          discountKind: stored.discountKind,
          reward,
          charge: 0,
          gstCfg: gstConfigFromOrder(stored, NO_GST),
        });
        assert.ok(!("error" in resolvedVoid), "fixture: voiding the reward line must resolve");
        if ("error" in resolvedVoid) return;
        const voidEntry = resolvedVoid.entry;
        assert.equal(voidEntry.reward, true, "fixture sanity: the real builder must mark the entry a reward");
        // The omit-empty shape itself, pinned — so this fixture cannot silently
        // drift back into the hand-built ""/[] shape it replaced.
        assert.equal(voidEntry.instructions, undefined, "a reward line's void entry omits `instructions` entirely (order-void.ts omit-empty)");
        assert.equal(voidEntry.modifiers, undefined, "a reward line's void entry omits `modifiers` entirely (order-void.ts omit-empty)");
        const clientVoid = JSON.parse(JSON.stringify(voidEntry)) as unknown as ClientOrderVoid;

        const surfaces: Array<{ what: string; job: ReturnType<typeof billPrintJob> }> = [
          { what: "kot", job: kotPrintJob(clientOrder, 1) },
          { what: "bill", job: billPrintJob(clientOrder, { reprint: false }) },
          { what: "void", job: voidPrintJob(clientOrder, clientVoid, { reprint: false }) },
        ];

        // A host is required or enqueuePrintJob short-circuits on "no-host"
        // and nothing would be written at all (print-queue.ts:97). PrintHost.key
        // is UNIQUE, so the row is cleared FIRST and dropped in a finally: a
        // throw anywhere below would otherwise leak it and make the NEXT run of
        // this scenario die on a duplicate key — a false RED that hides the
        // real verdict (measured: this is exactly what an unrelated mutation
        // run surfaced).
        await PrintJob.deleteMany({});
        await PrintHost.deleteMany({});
        await PrintHost.create({
          key: PRINT_HOST_KEY,
          deviceId: "live-leg-device",
          label: "Live Leg Host",
          setBy: "Live Leg Staff",
          setAt: new Date(),
          lastSeenAt: new Date(),
        });

        try {
        for (const { what, job } of surfaces) {
          // (1) THE REAL GATE. app/api/print-jobs/route.ts:22 parses the body
          // through this exact schema. `.strict()` makes an unlisted key a
          // PARSE FAILURE, not a dropped field — the S14 blocker exactly.
          const parsed = printJobPayloadSchema.safeParse(job.payload);
          assert.ok(
            parsed.success,
            `${what}: the payload must survive the ROUTE's own .strict() parse — ${
              !parsed.success ? JSON.stringify(parsed.error.flatten()) : ""
            }`,
          );

          // (2) Persist and read back. The payload is stored as a JSON string,
          // so this proves the reward key survives serialization into a real
          // document and out again, not just an in-memory object.
          const result = await enqueuePrintJob({
            payload: parsed.data, label: job.label, queuedBy: "Live Leg Staff",
          });
          assert.equal(result.outcome, "queued", `${what}: the job must actually be queued (got ${result.outcome})`);
          const row = await PrintJob.findById("id" in result ? result.id : "").lean();
          assert.ok(row, `${what}: the PrintJob row must exist`);
          const roundTripped = printJobPayloadSchema.parse(JSON.parse(row!.payload));

          // (3) THE SURFACE ASSERTION — the free dish is on the slip, priced.
          if (roundTripped.kind === "kot" || roundTripped.kind === "bill") {
            const line = roundTripped.snapshot.items.find((i) => i.reward === true);
            assert.ok(line, `${what}: the reward line must be present on the slip after the round trip`);
            assert.equal(line!.price, 200, `${what}: the reward line keeps its REAL price on the slip (D5's whole point)`);
            assert.equal(line!.note, REWARD_ITEM_LINE_NOTE, `${what}: the marker note must reach the slip`);
            // Vision guard: the ORDINARY line is there too and carries NO
            // reward key, so this did not pass by flagging everything.
            const plain = roundTripped.snapshot.items.find((i) => i.name === "Paneer Thali");
            assert.ok(plain, `${what}: the ordinary line must still be on the slip`);
            assert.equal(plain!.reward, undefined, `${what}: an ordinary line must carry NO reward key (the omit-empty fence)`);
          } else if (roundTripped.kind === "void") {
            assert.equal(roundTripped.line.reward, true, "void: the voided line must be marked a reward on the slip");
            assert.equal(roundTripped.line.price, 200, "void: the void slip records the dish's REAL value, never ₹0");
            // KOTReceipt has no `item.reward` branch, so the marker rides the
            // instructions STRING (print-routing.ts:142) — if that fold is
            // lost the kitchen slip stops SAYING it was a reward even though
            // the flag is present.
            assert.equal(
              roundTripped.line.instructions,
              REWARD_ITEM_LINE_NOTE,
              "void: the reward marker must be folded into the printed instructions line",
            );
            // The void payload embeds `printOrderSnapshot(order)` TOO
            // (print-routing.ts:161), carrying the same reward/note keys
            // through the same item sub-schema as the kot/bill slips. Asserted
            // explicitly (reviewer-found, S16): without this the third surface
            // only proved its synthesized `line`, and its SNAPSHOT half was
            // covered incidentally by the safeParse gate rather than named.
            const voidSnapLine = roundTripped.snapshot.items.find((i) => i.reward === true);
            assert.ok(voidSnapLine, "void: the reward line must also survive in the void payload's own order snapshot");
            assert.equal(voidSnapLine!.note, REWARD_ITEM_LINE_NOTE, "void: the snapshot's reward line keeps its marker note");
            const voidSnapPlain = roundTripped.snapshot.items.find((i) => i.name === "Paneer Thali");
            assert.ok(voidSnapPlain, "void: the ordinary line must be in the void payload's snapshot too");
            assert.equal(voidSnapPlain!.reward, undefined, "void: an ordinary line carries NO reward key in the snapshot either");
          }
        }

        // The bill total on the slip must still EXCLUDE the free dish — the
        // slip is what the customer reads, so a regression that re-added the
        // price would be visible here and nowhere else in this leg.
        const billJob = printJobPayloadSchema.parse(billPrintJob(clientOrder, { reprint: false }).payload);
        assert.equal(billJob.kind, "bill");
        if (billJob.kind === "bill") {
          assert.equal(billJob.snapshot.total, 260, "the printed bill total must be the ordinary line alone (260), never 460");
          assert.equal(billJob.snapshot.subtotal, 260, "the printed subtotal must exclude the reward line's price");
        }

        } finally {
          await PrintJob.deleteMany({});
          await PrintHost.deleteMany({});
        }
      },
    );

    // ── Scenario 19 — R10: settle REFUSES an item rung, and spends nothing ─
    // The fence that keeps the KOT honest: a free dish claimed at payment time
    // would ask the kitchen to cook after the customer has paid and left. The
    // DB-free suite pins the `refuseItemKind` branch; what it cannot prove is
    // the refusal against a rung that came out of a REAL Settings document via
    // the route's own validator, nor that the refusal leaves the stamp balance
    // untouched (a refusal that had already debited would be silent theft).
    await scenario(
      19,
      "S5/R10: settle REFUSES an item rung resolved from a REAL Settings doc and spends NO stamps, while create ACCEPTS the same rung",
      async () => {
        // Same rerun-safety discipline as scenario 18: Settings is a
        // single-document collection, so a throw below would leave this
        // fixture standing and silently steer a later scenario.
        await Settings.deleteMany({});
        try {
        const parsedSettings = updateSettingsSchema.safeParse({
          loyaltyRules: {
            v: LOYALTY_RULES_SCHEMA_VERSION,
            unitLabel: "stamp",
            milestones: [
              { at: 8, kind: "item", value: 0, item: "Masala Chai", itemProductId: productId, qty: 1 },
              { at: 10, kind: "flat", value: 50, item: "" },
            ],
          },
        });
        assert.ok(
          parsedSettings.success,
          `fixture must parse: ${!parsedSettings.success ? JSON.stringify(parsedSettings.error.flatten()) : ""}`,
        );
        await Settings.findOneAndUpdate({}, parsedSettings.data, {
          new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true,
        }).lean();
        const settings = (await Settings.findOne().lean()) as unknown as ISettings;
        assert.equal(
          settings.loyaltyRules?.milestones?.length,
          2,
          "fixture sanity: both rungs must really be STORED — a dropped item rung would make the refusal below pass vacuously",
        );

        const customerId = await freshCustomer(20);
        const before = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(before!.stamps, 20, "fixture sanity: the diner starts funded");

        // THE FENCE — settle/route.ts:93 passes refuseItemKind: true.
        const atSettle = await resolveRewardClaim({
          settings, customerId: String(customerId), rewardAt: 8, billTotal: 500, refuseItemKind: true,
        });
        assert.ok(!atSettle.ok, "settle must REFUSE an item rung");
        assert.equal(
          !atSettle.ok ? atSettle.reason : "",
          "item-not-at-settle",
          "the refusal must name the item-at-settle reason, not a balance complaint",
        );

        // NOTHING was spent. resolveRewardClaim does not claim, but a
        // regression that folded the claim into the resolver would debit a
        // diner who was then refused — provable only against a real row.
        const afterRefusal = await Customer.findById(customerId).select("stamps").lean();
        assert.equal(afterRefusal!.stamps, 20, "a REFUSED settle claim must leave the stamp balance untouched");

        // The money rung at the SAME settle still resolves — proves the fence
        // is keyed on the KIND, not on settle refusing every reward.
        const moneyAtSettle = await resolveRewardClaim({
          settings, customerId: String(customerId), rewardAt: 10, billTotal: 500, refuseItemKind: true,
        });
        assert.ok(moneyAtSettle.ok, "settle must still accept a flat money rung");
        assert.equal(moneyAtSettle.ok ? moneyAtSettle.reward.kind : "", "flat");

        // And the ORDER-TAKING writers (refuseItemKind: false) accept the very
        // rung settle just refused — the inverse arm, so this pins a fence and
        // not a dead rung.
        const atCreate = await resolveRewardClaim({
          settings, customerId: String(customerId), rewardAt: 8, billTotal: 500, refuseItemKind: false,
        });
        assert.ok(atCreate.ok, "create/add-round must ACCEPT the item rung settle refused");
        assert.equal(atCreate.ok ? atCreate.reward.kind : "", "item");
        assert.equal(
          atCreate.ok ? atCreate.reward.itemProductId : "",
          productId,
          "the accepted rung must carry the product reference the dish is resolved from",
        );

        } finally {
          await Settings.deleteMany({});
        }
      },
    );

    // ── Scenario 20 — voiding the REWARD LINE ITSELF keeps its provenance ──
    // Scenario 8 voids the ORDINARY line on a reward tab. The reward line's
    // OWN void entry is a different write: `IOrderVoid.reward` is an optional
    // Mongoose path, so a missing schema declaration drops it silently on a
    // real mongod (the exact class of bug this whole leg exists for) and the
    // trail then cannot tell a comped dish from a sold one.
    await scenario(
      20,
      "S14: voiding the REWARD LINE stores IOrderVoid.reward on the trail, keeps the reward snapshot, and does NOT re-add the dish's price to the bill",
      async () => {
        const customerId = await freshCustomer(20);
        const itemMs = itemMilestone(8, productId, 1);
        const reward = redemptionSnapshotOf(itemMs);
        const items = [
          { productId: new mongoose.Types.ObjectId().toString(), name: "Paneer Thali", price: 260, qty: 1 },
          { productId, name: "Masala Chai", price: 200, qty: 1, reward: true, note: REWARD_ITEM_LINE_NOTE },
        ];
        const totals = computeOrderTotals({
          items, discount: 0, discountKind: "reward", charge: 0, cfg: NO_GST, reward,
        });
        assert.equal(totals.total, 260, "fixture sanity: the reward line is already untotalled before the void");
        const created = await Order.create({
          ...buildCreateDoc({
            orderId: nextOrderId(), items, totals, discountKind: "reward",
            reward: { reward, cost: itemMs.at }, customerId,
          }),
          payment: "Unpaid", status: "Pending", paidAmount: 0,
        });
        const before = (await Order.findById(created._id).lean()) as unknown as IOrder;
        const rewardLine = before.items[1]!;
        assert.equal(rewardLine.reward, true, "fixture sanity: the line to void really is the reward line");

        const resolved = resolveItemVoid({
          items: before.items,
          request: {
            index: 1,
            lineKey: orderLineKey({
              productId: String(rewardLine.productId),
              qty: rewardLine.qty,
              kotRound: rewardLine.kotRound,
              instructions: rewardLine.instructions,
              modifiers: rewardLine.modifiers,
              variation: rewardLine.variation,
            }),
            qty: 1,
            reason: "dish returned",
            voidedBy: "Live Leg Staff",
            at: new Date(),
          },
          discount: before.discount,
          discountKind: before.discountKind,
          reward,
          charge: 0,
          gstCfg: gstConfigFromOrder(before, NO_GST),
        });
        assert.ok(!("error" in resolved), "voiding the reward line must resolve");
        if ("error" in resolved) return;

        const mustUnset =
          before.discountKind !== undefined &&
          resolved.totals.discount === 0 &&
          !shouldStoreDiscountKind(resolved.totals.discount, before.discountKind);
        assert.equal(mustUnset, false, "voiding a reward line must not $unset the reward kind");

        const updated = await Order.findOneAndUpdate(
          { _id: created._id, status: "Pending", ...voidGuardFilter(0) },
          {
            $set: {
              items: resolved.nextItems,
              subtotal: resolved.totals.subtotal,
              discount: resolved.totals.discount,
              gstAmount: resolved.totals.gstAmount,
              total: resolved.totals.total,
            },
            $push: { voids: resolved.entry },
          },
          { new: true, runValidators: true },
        ).lean();
        assert.ok(updated, "the void write must land");

        // THE PIN: the trail entry carries the flag, through a real mongod.
        assert.equal(updated!.voids?.length, 1, "exactly one trail entry must be written");
        const entry = updated!.voids![0]!;
        assert.equal(entry.reward, true, "IOrderVoid.reward must SURVIVE the write — a missing schema path drops it silently");
        assert.equal(entry.price, 200, "the trail records the dish's REAL value, never ₹0 (the void-trail corruption D5 rejected)");
        assert.equal(entry.name, "Masala Chai");

        // Provenance intact, and the bill did NOT grow: removing an untotalled
        // line must leave the total where it was. A reducer regression that
        // stopped skipping the reward line would show up as 460 here.
        assert.equal(updated!.discountKind, "reward", "the reward kind must survive voiding the reward line itself");
        assert.equal(updated!.rewardAt, itemMs.at, "the reward snapshot must survive the void");
        assert.equal(updated!.rewardItemProductId, productId, "the product reference must survive the void");
        assert.equal(updated!.total, 260, "voiding an UNTOTALLED line must not move the total");
        assert.equal(updated!.subtotal, 260, "and must not move the subtotal either");
      },
    );

  } finally {
    await Order.deleteMany({});
    await Customer.deleteMany({});
    await Product.deleteMany({});
    // CB-5B S16 — the collections legs 18/19 touch. PrintHost.key is UNIQUE and
    // Settings is single-document, so leaving either behind would poison the
    // NEXT run of this leg rather than just this one.
    await PrintJob.deleteMany({});
    await PrintHost.deleteMany({});
    await Settings.deleteMany({});
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "live leg failed");
  process.exit(1);
});
