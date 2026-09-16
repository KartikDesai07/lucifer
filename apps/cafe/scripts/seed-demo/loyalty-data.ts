/**
 * CB-5B S16 — demo loyalty data: a Settings.loyaltyRules ladder (one item
 * rung against a REAL seeded product, one ordinary flat rung) plus the
 * Customer-side stamp balances/redemption claims the reward orders spend
 * against.
 *
 * DEMO SEEDER ONLY. seed-client.ts's seedSettings() is SHARED with the real
 * go-live seeder — adding loyalty rules there would ship demo loyalty config
 * to a real cafe's Settings doc, so this module runs from index.ts instead,
 * strictly AFTER seedBase (Settings must already exist) and AFTER seedMenu
 * (the item rung needs a real productId).
 */
import { Types } from "mongoose";
import { Settings } from "@/models/Settings";
import { Customer } from "@/models/Customer";
import { updateSettingsSchema } from "@/schemas";
import { LOYALTY_RULES_SCHEMA_VERSION } from "@pos/shared/loyalty-rules";
import { effectiveUnitPrice } from "@pos/shared/public";
import type { PlannedProduct, PlannedRewardRung, PlannedOrder, PlannedCustomer, Rng } from "./types";

const LOYALTY_UNIT_LABEL = "stamp";
// The item rung's stamp cost and the flat rung's — deliberately DIFFERENT
// numbers so the two rungs are unambiguous on the ladder and in test fixtures.
const ITEM_RUNG_AT = 8;
const ITEM_RUNG_QTY = 1;
const FLAT_RUNG_AT = 20;
// Rupees off. An ordinary money rung, present so the demo ladder is not
// item-only — but never CLAIMED by this seed: only item rewards are planted
// (see seedLoyaltyRules's docblock for why).
const FLAT_RUNG_VALUE = 100;
const LOYALTY_CARD_SIZE = 20;

// The rung dish is picked at the MEDIAN effective price, not the cheapest:
// the cheapest variation-free item in the demo menu is bottled water (₹20), and
// a demo whose loyalty reward is a free water reads as a broken feature rather
// than a showcase. The median is also stable against menu edits in a way a
// hand-picked name is not.
const REWARD_DISH_PRICE_PERCENTILE = 0.5;

/**
 * Picks the item rung's dish deterministically (never `ctx.rng` — this runs
 * BEFORE the rng-driven order plan, from the products list alone): the
 * median-priced AVAILABLE product with no variations, so the reward order's
 * extra line prices simply and unambiguously (a variation-bearing dish has no
 * single price to put on the rung). Throws if no such product exists — a
 * STOP-and-report condition, never a silent fallback to a priced-oddly dish.
 *
 * Prices are compared — and returned — as the EFFECTIVE (product-discount
 * applied) price, because that is what the POS actually bills and therefore
 * what orders-plan-lines.ts stores in `items[].price` for every ordinary line
 * (see that file's header). A rung carrying the raw price would bill the free
 * dish ABOVE what the counter charges for the same item.
 */
function pickRewardProduct(products: readonly PlannedProduct[]): { product: PlannedProduct; price: number } {
  const candidates = products
    .filter((p) => p.available && !p.variations)
    .map((product) => ({ product, price: effectiveUnitPrice(product.price, product.discount) }))
    .sort((a, b) => a.price - b.price || a.product.name.localeCompare(b.product.name));
  if (candidates.length === 0) {
    throw new Error("loyalty-data: no available, variation-free product to seed the item reward rung against");
  }
  return candidates[Math.floor((candidates.length - 1) * REWARD_DISH_PRICE_PERCENTILE)];
}

/**
 * Writes Settings.loyaltyRules with a two-rung demo ladder — ONE kind:"item"
 * rung against a real product (the only kind this seed ever claims — see the
 * seed's hard constraint on why: verifySeed recomputes totals WITHOUT
 * `reward`, so only an item reward derives 0 either way and survives that
 * recompute) and one ordinary kind:"flat" rung so the demo ladder is not
 * item-only. Validated through updateSettingsSchema + the SAME
 * Settings.findOneAndUpdate option set the route uses (verify-loyalty-
 * reward-item-live.ts's routeShapedUpdate) — a shortcut write would let a
 * strict-schema drop pass silently. Throws loudly on a parse failure.
 */
export async function seedLoyaltyRules(products: readonly PlannedProduct[]): Promise<PlannedRewardRung> {
  const { product, price } = pickRewardProduct(products);

  const candidate = {
    loyaltyRules: {
      v: LOYALTY_RULES_SCHEMA_VERSION,
      unitLabel: LOYALTY_UNIT_LABEL,
      cardSize: LOYALTY_CARD_SIZE,
      milestones: [
        {
          at: ITEM_RUNG_AT,
          kind: "item" as const,
          value: 0,
          item: product.name,
          itemProductId: product._id.toString(),
          qty: ITEM_RUNG_QTY,
        },
        {
          at: FLAT_RUNG_AT,
          kind: "flat" as const,
          value: FLAT_RUNG_VALUE,
          item: "",
        },
      ],
    },
  };

  const parsed = updateSettingsSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`loyalty-data: demo loyaltyRules failed updateSettingsSchema: ${JSON.stringify(parsed.error.flatten())}`);
  }
  await Settings.findOneAndUpdate({}, parsed.data, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  }).lean();

  return {
    at: ITEM_RUNG_AT,
    productId: product._id,
    productName: product.name,
    price,
    qty: ITEM_RUNG_QTY,
  };
}

// The balance range for customers who have NOT claimed. The top of the range
// deliberately clears ITEM_RUNG_AT (reviewer-found, S16): with a max of 7
// against an 8-stamp rung, EVERY seeded customer read `insufficient-stamps`
// and the owner could not demo a claim at all — the ladder was visible but
// unreachable. The range now straddles the rung, so the demo shows both
// states: diners still working towards it, and diners who can redeem today.
const STAMPS_STARTING_BALANCE_MIN = 2;
const STAMPS_STARTING_BALANCE_MAX = ITEM_RUNG_AT + 4;
// Share of customers who get a non-zero starting stamp balance (so the
// loyalty screens show something for more than just the reward-order
// claimants).
const STAMPED_CUSTOMER_SHARE = 0.4;

/**
 * Post-plan Customer bulk-write, mirroring applyCustomerRollups' own $set
 * bulkWrite shape (finalize.ts): every customer with at least one reward
 * order gets `stamps` DEBITED by the rung's cost and the orderId recorded in
 * `redeemedOrders` (the claim() the reward order represents); a further
 * random share of the remaining customers gets a small starting balance so
 * the loyalty screens are not empty for everyone else. Deterministic — draws
 * only from `rng`, never Math.random.
 */
export async function applyLoyaltyCustomerData(
  customers: readonly PlannedCustomer[],
  orders: readonly PlannedOrder[],
  rewardRung: PlannedRewardRung,
  rng: Rng,
): Promise<void> {
  const redeemedOrdersByCustomer = new Map<string, string[]>();
  for (const order of orders) {
    if (order.discountKind !== "reward" || !order.customerId) continue;
    const id = order.customerId.toString();
    const list = redeemedOrdersByCustomer.get(id) ?? [];
    list.push(order.orderId);
    redeemedOrdersByCustomer.set(id, list);
  }

  const writes: { updateOne: { filter: { _id: Types.ObjectId }; update: Record<string, unknown> } }[] = [];
  for (const customer of customers) {
    const id = customer._id.toString();
    const redeemed = redeemedOrdersByCustomer.get(id);
    if (redeemed && redeemed.length > 0) {
      // A claimant's balance is DERIVED, not asserted: earn a plausible
      // lifetime total, then subtract exactly what the claimed orders spent
      // (rewardRung.at per claim — the same figure each of those orders stored
      // as rewardStamps, so a cancel's refund lands the balance back exactly
      // where it was). Earning the spend PLUS a remainder is what keeps the
      // result non-negative for a customer who claimed more than once; the
      // earlier form hard-coded the post-spend figure and only described the
      // derivation in a comment.
      const spent = rewardRung.at * redeemed.length;
      const remainder = rng.int(STAMPS_STARTING_BALANCE_MIN, STAMPS_STARTING_BALANCE_MAX);
      const stampsLifetime = spent + remainder;
      writes.push({
        updateOne: {
          filter: { _id: customer._id },
          update: {
            $set: {
              stamps: stampsLifetime - spent,
              stampsLifetime,
              redeemedOrders: redeemed,
            },
          },
        },
      });
      continue;
    }
    if (rng.chance(STAMPED_CUSTOMER_SHARE)) {
      const stamps = rng.int(STAMPS_STARTING_BALANCE_MIN, STAMPS_STARTING_BALANCE_MAX);
      writes.push({
        updateOne: {
          filter: { _id: customer._id },
          update: { $set: { stamps, stampsLifetime: stamps } },
        },
      });
    }
  }

  if (writes.length > 0) await Customer.bulkWrite(writes);
}
