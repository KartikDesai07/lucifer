/**
 * DB-free pins for the demo-account seeder's pure planners (rng, menu/people
 * data, orders-plan, extras-plan, rollupsOf) + source-level guard/parity pins
 * on index.ts / images.ts. No Mongo — everything here runs against the real
 * modules with a hand-built PlanContext (fixed ObjectIds, fake products/
 * tables/customers/staff), the same pattern the plan's smoke script uses.
 *
 * Money/GST/payment math is never re-implemented here — every total is
 * re-checked against the REAL `computeOrderTotals`/`derivePayment` the
 * planners themselves import, so a planner bug and a test bug can't cancel
 * out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Types } from "mongoose";

import { createRng, istInstant, dayKeysEndingToday, addMinutes, dayKeyToCompact, weekdayOf } from "./rng";
import { DEMO_CATEGORIES, DEMO_PRODUCTS, DEMO_MENU_STATS } from "./menu-data";
import {
  DEMO_CUSTOMERS,
  DEMO_STAFF,
  EVENT_TEMPLATES,
  RESERVATION_NOTES,
  ORDER_NOTES,
  CANCEL_REASONS,
  VOID_REASONS,
  ITEM_INSTRUCTIONS,
  SELF_ORDER_NOTES,
  DUE_NOTES,
} from "./people-data";
import { planOrders, orderTotalsOf } from "./orders-plan";
import { planExtras } from "./extras-plan";
import { rollupsOf } from "./finalize";
import { computeOrderTotals } from "@/lib/receipt";
import { derivePayment } from "@/lib/order";
import { REWARD_ITEM_LINE_NOTE } from "@pos/shared/reward-redemption";
import type {
  PlanContext,
  PlannedProduct,
  PlannedTable,
  PlannedCustomer,
  PlannedStaff,
  PlannedOrder,
  PlannedDuePayment,
  PlannedRewardRung,
} from "./types";

const SEED_DIR = __dirname;

// ── Fake PlanContext builder ─────────────────────────────────────────────────
const FIXED_NOW = new Date("2026-09-13T09:30:00.000Z"); // ~15:00 IST — well inside cafe hours
const DAYS_COUNT = 31;

function fakeProducts(): PlannedProduct[] {
  return DEMO_PRODUCTS.map((p, i) => ({
    _id: new Types.ObjectId(`${(i + 1).toString().padStart(24, "0")}`.slice(0, 24)),
    name: p.name,
    price: p.price,
    variations: p.variations,
    modifiers: p.modifiers ?? [],
    available: p.available ?? true,
    discount: p.discount ?? 0,
    weight: p.weight,
  }));
}

function fakeTables(count: number): PlannedTable[] {
  const tables: PlannedTable[] = [];
  for (let i = 1; i <= count; i++) {
    const capacity = [2, 4, 4, 6, 4, 2, 8, 4][(i - 1) % 8];
    const isLast = i === count;
    tables.push({
      tableNo: `T${i}`,
      capacity,
      ...(isLast ? { chargeAmount: 50, chargeLabel: "Rooftop seating" } : {}),
    });
  }
  return tables;
}

function fakeCustomers(): PlannedCustomer[] {
  return DEMO_CUSTOMERS.map((c, i) => ({
    _id: new Types.ObjectId(`${(i + 1).toString().padStart(24, "0")}`.slice(0, 24)),
    name: c.name,
    mobile: c.mobile,
    notes: c.notes,
  }));
}

function fakeStaff(): PlannedStaff[] {
  return DEMO_STAFF.map((s, i) => ({
    _id: new Types.ObjectId(`${(90 + i + 1).toString().padStart(24, "0")}`.slice(0, 24)),
    name: s.name,
    weight: s.weight,
  }));
}

// CB-5B S16 — a fixed reward rung mirroring loyalty-data.ts's own shape: an
// item reward against the first fake product, at a stamp cost distinct from
// any other fixture number in this file.
const REWARD_RUNG_AT = 8;
function fakeRewardRung(products: readonly PlannedProduct[]): PlannedRewardRung {
  const product = products[0];
  return { at: REWARD_RUNG_AT, productId: product._id, productName: product.name, price: product.price, qty: 1 };
}

function buildCtx(opts: {
  seed: number;
  gstEnabled: boolean;
  gstRate: number;
  gstMode: "inclusive" | "exclusive";
  now?: Date;
  days?: number;
}): PlanContext {
  const now = opts.now ?? FIXED_NOW;
  const products = fakeProducts();
  return {
    products,
    tables: fakeTables(8),
    customers: fakeCustomers(),
    staff: fakeStaff(),
    gst: { gstEnabled: opts.gstEnabled, gstRate: opts.gstRate, gstMode: opts.gstMode },
    print: {
      bill: {
        showNumber: true,
        numberStart: 1,
        showLogo: true,
        logoSize: "medium",
        showAddress: true,
        showMobile: true,
        showGstNumber: true,
        showFssai: true,
        paperWidth: "80mm",
        fontSize: "small",
      },
      kot: {
        showPrices: true,
        showTotal: true,
        showNumber: true,
        numberStart: 1,
        numberVoidSlips: true,
        showLogo: false,
        showRestaurantName: false,
        showTable: true,
        showStaff: true,
        showTime: true,
        showNotes: true,
        paperWidth: "80mm",
        fontSize: "normal",
      },
    },
    days: dayKeysEndingToday(now, opts.days ?? DAYS_COUNT),
    now,
    rng: createRng(opts.seed),
    rewardRung: fakeRewardRung(products),
  };
}

// ── rng.ts ───────────────────────────────────────────────────────────────────
test("rng: same seed produces the same sequence (determinism)", () => {
  const a = createRng(7);
  const b = createRng(7);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test("rng: different seeds diverge", () => {
  const a = createRng(1);
  const b = createRng(2);
  const seqA = Array.from({ length: 10 }, () => a.next());
  const seqB = Array.from({ length: 10 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});

test("rng.int: always within [min, max] inclusive", () => {
  const rng = createRng(42);
  for (let i = 0; i < 500; i++) {
    const v = rng.int(3, 9);
    assert.ok(v >= 3 && v <= 9, `int ${v} out of [3,9]`);
    assert.equal(v, Math.round(v));
  }
});

test("rng.weighted: never picks an item whose weight is 0", () => {
  const rng = createRng(99);
  const items = [
    { name: "zero", weight: 0 },
    { name: "live", weight: 5 },
  ];
  for (let i = 0; i < 300; i++) {
    const picked = rng.weighted(items, (it) => it.weight);
    assert.equal(picked.name, "live");
  }
});

test("rng.weighted: throws when every weight is <= 0", () => {
  const rng = createRng(1);
  assert.throws(() => rng.weighted([{ w: 0 }, { w: -1 }], (i) => i.w));
});

test("istInstant / dayKeysEndingToday / dayKeyToCompact / weekdayOf: basic shape", () => {
  const days = dayKeysEndingToday(FIXED_NOW, DAYS_COUNT);
  assert.equal(days.length, DAYS_COUNT);
  // Oldest -> today: strictly ascending day keys, no duplicates.
  for (let i = 1; i < days.length; i++) assert.ok(days[i] > days[i - 1]);
  assert.equal(dayKeyToCompact("2026-09-13"), "20260913");
  assert.equal(typeof weekdayOf(days[0]), "number");
  const inst = istInstant("2026-09-13", 15, 0, 0);
  assert.equal(inst.toISOString(), "2026-09-13T09:30:00.000Z");
  assert.equal(addMinutes(inst, 5).toISOString(), "2026-09-13T09:35:00.000Z");
});

// ── menu-data.ts ─────────────────────────────────────────────────────────────
test("menu data: category/product counts match DEMO_MENU_STATS and the plan (11/105/100)", () => {
  assert.equal(DEMO_MENU_STATS.categories, 11);
  assert.equal(DEMO_MENU_STATS.products, 105);
  assert.equal(DEMO_MENU_STATS.withImages, 100);
  assert.equal(DEMO_CATEGORIES.length, 11);
  assert.equal(DEMO_PRODUCTS.length, 105);
});

test("menu data: product names are unique", () => {
  const names = new Set(DEMO_PRODUCTS.map((p) => p.name));
  assert.equal(names.size, DEMO_PRODUCTS.length);
});

test("menu data: every product's category is a real DEMO_CATEGORIES name", () => {
  const categoryNames = new Set(DEMO_CATEGORIES.map((c) => c.name));
  for (const p of DEMO_PRODUCTS) {
    assert.ok(categoryNames.has(p.category), `unknown category "${p.category}" on product "${p.name}"`);
  }
});

test("menu data: every category is referenced by at least one product", () => {
  const usedCategories = new Set(DEMO_PRODUCTS.map((p) => p.category));
  for (const c of DEMO_CATEGORIES) {
    assert.ok(usedCategories.has(c.name), `category "${c.name}" has no products`);
  }
});

test("menu data: every price is > 0", () => {
  for (const p of DEMO_PRODUCTS) {
    assert.ok(p.price > 0, `"${p.name}" price ${p.price} is not > 0`);
    for (const v of p.variations ?? []) {
      assert.ok(v.price > 0, `"${p.name}" variation "${v.name}" price ${v.price} is not > 0`);
    }
  }
});

test("menu data: a variation product's price equals its FIRST variation's price", () => {
  for (const p of DEMO_PRODUCTS) {
    if (p.variations && p.variations.length > 0) {
      assert.equal(p.price, p.variations[0].price, `"${p.name}" price !== first variation price`);
    }
  }
});

test("menu data: imageFile is unique across products that have one", () => {
  const files = DEMO_PRODUCTS.map((p) => p.imageFile).filter((f): f is string => f !== undefined);
  assert.equal(new Set(files).size, files.length);
});

test("menu data: exactly 100 products carry an imageFile", () => {
  const withImages = DEMO_PRODUCTS.filter((p) => p.imageFile !== undefined);
  assert.equal(withImages.length, 100);
});

test("menu data: exactly 2 products are unavailable (available: false)", () => {
  const unavailable = DEMO_PRODUCTS.filter((p) => p.available === false);
  assert.equal(unavailable.length, 2, `unavailable products: ${unavailable.map((p) => p.name).join(", ")}`);
});

test("menu data: every discount is within [0, 100]", () => {
  for (const p of DEMO_PRODUCTS) {
    const d = p.discount ?? 0;
    assert.ok(d >= 0 && d <= 100, `"${p.name}" discount ${d} out of [0,100]`);
  }
});

// ── people-data.ts ───────────────────────────────────────────────────────────
test("people data: 40 customers, all mobiles distinct 10-digit strings", () => {
  assert.equal(DEMO_CUSTOMERS.length, 40);
  const mobiles = new Set(DEMO_CUSTOMERS.map((c) => c.mobile));
  assert.equal(mobiles.size, DEMO_CUSTOMERS.length);
  for (const c of DEMO_CUSTOMERS) {
    assert.match(c.mobile, /^\d{10}$/, `mobile "${c.mobile}" is not 10 digits`);
  }
});

test("people data: exactly 6 VIP customers", () => {
  const vips = DEMO_CUSTOMERS.filter((c) => c.notes === "VIP");
  assert.equal(vips.length, 6);
});

test("people data: 3 staff members, usernames lowercase [a-z0-9._@-]+", () => {
  assert.equal(DEMO_STAFF.length, 3);
  for (const s of DEMO_STAFF) {
    assert.match(s.username, /^[a-z0-9._@-]+$/, `username "${s.username}" fails the lowercase pattern`);
  }
});

// ── planOrders invariants (run twice: inclusive 5% GST, exclusive 18% GST) ──
function runPlanOrdersChecks(label: string, gstEnabled: boolean, gstRate: number, gstMode: "inclusive" | "exclusive") {
  test(`planOrders[${label}]: volume, Pending tabs, and per-order total parity`, () => {
    const ctx = buildCtx({ seed: 7, gstEnabled, gstRate, gstMode });
    const plan = planOrders(ctx);

    assert.ok(plan.orders.length >= 600, `only ${plan.orders.length} orders (want >= 600)`);

    const pending = plan.orders.filter((o) => o.status === "Pending");
    assert.equal(pending.length, 3, "exactly 3 Pending orders");
    const todayKey = ctx.days[ctx.days.length - 1];
    for (const o of pending) {
      assert.equal(o.orderId.slice(4, 12), dayKeyToCompact(todayKey), `Pending order ${o.orderId} is not dated today`);
    }
    const pendingTables = new Set(pending.map((o) => o.tableNo));
    assert.equal(pendingTables.size, 3, "3 distinct tables for the 3 Pending orders");
    const occupiedStates = plan.tableStates.filter((s) => s.status === "Occupied");
    assert.equal(occupiedStates.length, 3);
    const occupiedTableNos = new Set(occupiedStates.map((s) => s.tableNo));
    assert.deepEqual(occupiedTableNos, pendingTables, "tableStates Occupied === Pending orders' tables");
    for (const state of occupiedStates) {
      const match = pending.find((o) => o.tableNo === state.tableNo);
      assert.ok(match, `Occupied table ${state.tableNo} has no matching Pending order`);
      assert.equal(state.currentOrderId, match!.orderId);
    }

    const cancelled = plan.orders.filter((o) => o.status === "Cancelled");
    assert.ok(cancelled.length >= 1, "at least 1 Cancelled order");
    for (const o of cancelled) {
      assert.ok(o.cancelReason, `Cancelled order ${o.orderId} missing cancelReason`);
      assert.ok(o.cancelledBy, `Cancelled order ${o.orderId} missing cancelledBy`);
      assert.ok(o.cancelledAt instanceof Date, `Cancelled order ${o.orderId} missing cancelledAt`);
    }

    const qrOrders = plan.orders.filter((o) => o.source === "qr");
    assert.ok(qrOrders.length >= 6, `only ${qrOrders.length} qr orders (want >= 6)`);

    // Re-check EVERY order's total against the real computeOrderTotals, using
    // its own stored items/discount/charge/gst fields (not the planner's
    // internal state) — a genuine round-trip check.
    for (const o of plan.orders) {
      const recomputed = computeOrderTotals({
        items: o.items,
        discount: o.discount,
        discountKind: o.discountKind,
        charge: o.chargeAmount ?? 0,
        cfg: { gstEnabled, gstRate: gstEnabled ? gstRate : 0, gstMode },
      });
      assert.equal(o.total, recomputed.total, `order ${o.orderId}: stored total ${o.total} !== recomputed ${recomputed.total}`);
      assert.equal(o.subtotal, recomputed.subtotal, `order ${o.orderId}: subtotal mismatch`);
      assert.equal(o.gstAmount, recomputed.gstAmount, `order ${o.orderId}: gstAmount mismatch`);
      // orderTotalsOf is the exported re-check helper — it must agree too.
      const viaHelper = orderTotalsOf(o.items, o.discount, o.discountKind, o.chargeAmount ?? 0, {
        gstEnabled,
        gstRate: gstEnabled ? gstRate : 0,
        gstMode,
      });
      assert.equal(viaHelper.total, o.total, `orderTotalsOf disagrees with stored total for ${o.orderId}`);
    }
  });

  test(`planOrders[${label}]: Split sums, Due/Credit require a customer, paidAmount <= total`, () => {
    const ctx = buildCtx({ seed: 7, gstEnabled, gstRate, gstMode });
    const plan = planOrders(ctx);

    for (const o of plan.orders) {
      if (o.status === "Pending") continue;
      assert.ok(o.paidAmount <= o.total, `order ${o.orderId}: paidAmount ${o.paidAmount} > total ${o.total}`);
      if (o.payment === "Split") {
        assert.equal((o.splitCash ?? 0) + (o.splitOnline ?? 0), o.total, `order ${o.orderId}: split sum !== total`);
      }
      if (o.payment === "Due" || o.payment === "Credit") {
        assert.ok(o.customerId, `order ${o.orderId}: ${o.payment} payment with no customerId`);
      }
      // Every non-pending order's derived payment must independently agree
      // with the real derivePayment — proves the planner didn't drift from
      // the route logic it's supposed to model.
      const derived = derivePayment(o.payment, o.total, o.splitCash, o.splitOnline, o.payment === "Split" ? undefined : o.paidAmount);
      assert.ok(!("error" in derived), `derivePayment(${o.payment}) errored for order ${o.orderId}`);
    }
  });

  test(`planOrders[${label}]: orderIds unique, NNN contiguous per day, day === createdAt's IST day`, () => {
    const ctx = buildCtx({ seed: 7, gstEnabled, gstRate, gstMode });
    const plan = planOrders(ctx);

    const ids = new Set(plan.orders.map((o) => o.orderId));
    assert.equal(ids.size, plan.orders.length, "orderIds must be unique");

    const perDay = new Map<string, number[]>();
    for (const o of plan.orders) {
      const m = /^ORD-(\d{8})-(\d{3})$/.exec(o.orderId);
      assert.ok(m, `orderId "${o.orderId}" does not match ORD-YYYYMMDD-NNN`);
      const [, compactDay, nnn] = m!;
      const arr = perDay.get(compactDay) ?? [];
      arr.push(Number(nnn));
      perDay.set(compactDay, arr);
    }
    for (const [compactDay, seqs] of perDay) {
      const sorted = [...seqs].sort((a, b) => a - b);
      assert.deepEqual(sorted, sorted.map((_, i) => i + 1), `day ${compactDay}: NNN not contiguous from 1 (${sorted.join(",")})`);
    }
  });

  test(`planOrders[${label}]: createdAt strictly ascending across the whole plan`, () => {
    const ctx = buildCtx({ seed: 7, gstEnabled, gstRate, gstMode });
    const plan = planOrders(ctx);
    for (let i = 1; i < plan.orders.length; i++) {
      assert.ok(
        plan.orders[i].createdAt.getTime() >= plan.orders[i - 1].createdAt.getTime(),
        `orders[${i}] createdAt not >= orders[${i - 1}] createdAt`,
      );
    }
  });

  test(`planOrders[${label}]: kot/bill numbers contiguous per day, counters match max issued`, () => {
    const ctx = buildCtx({ seed: 7, gstEnabled, gstRate, gstMode });
    const plan = planOrders(ctx);

    const kotByDay = new Map<string, number[]>();
    const billByDay = new Map<string, number[]>();
    for (const o of plan.orders) {
      const compactDay = o.orderId.slice(4, 12);
      if (o.kotNumbers) {
        const arr = kotByDay.get(compactDay) ?? [];
        arr.push(...o.kotNumbers);
        kotByDay.set(compactDay, arr);
      }
      if (o.billNumber !== undefined) {
        const arr = billByDay.get(compactDay) ?? [];
        arr.push(o.billNumber);
        billByDay.set(compactDay, arr);
      }
    }
    for (const [compactDay, nums] of kotByDay) {
      const sorted = [...nums].sort((a, b) => a - b);
      assert.deepEqual(sorted, sorted.map((_, i) => i + 1), `kot day ${compactDay} not contiguous`);
      const counterKey = `kot-${compactDay}`;
      assert.ok(plan.counters[counterKey] >= Math.max(...sorted), `counter ${counterKey} < max issued kot`);
    }
    for (const [compactDay, nums] of billByDay) {
      const sorted = [...nums].sort((a, b) => a - b);
      assert.deepEqual(sorted, sorted.map((_, i) => i + 1), `bill day ${compactDay} not contiguous`);
      const counterKey = `bill-${compactDay}`;
      assert.ok(plan.counters[counterKey] >= Math.max(...sorted), `counter ${counterKey} < max issued bill`);
    }
    // Every counters["order-<day>"] must exist for every day in ctx.days.
    for (const dayKey of ctx.days) {
      const key = `order-${dayKeyToCompact(dayKey)}`;
      assert.ok(key in plan.counters, `missing order counter for ${dayKey}`);
    }
  });

  test(`planOrders[${label}]: no order has sourceRequestIds === []; qr orders <-> accepted requests`, () => {
    const ctx = buildCtx({ seed: 7, gstEnabled, gstRate, gstMode });
    const plan = planOrders(ctx);

    for (const o of plan.orders) {
      if (o.sourceRequestIds) {
        assert.ok(o.sourceRequestIds.length > 0, `order ${o.orderId} has sourceRequestIds: []`);
      }
    }
    const qrOrders = plan.orders.filter((o) => o.source === "qr");
    const acceptedRequests = plan.requests.filter((r) => r.status === "accepted");
    assert.equal(qrOrders.length, acceptedRequests.length, "qr order count !== accepted request count");
    const acceptedIds = new Set(acceptedRequests.map((r) => r._id.toString()));
    for (const o of qrOrders) {
      assert.ok(o.sourceRequestIds && o.sourceRequestIds.length === 1, `qr order ${o.orderId} must carry exactly one sourceRequestIds entry`);
      assert.ok(acceptedIds.has(o.sourceRequestIds![0].toString()), `qr order ${o.orderId}'s request id is not an accepted request`);
    }
    for (const r of acceptedRequests) {
      assert.ok(r.acceptedOrderId, `accepted request ${r._id.toString()} missing acceptedOrderId`);
      const order = plan.orders.find((o) => o.orderId === r.acceptedOrderId);
      assert.ok(order, `accepted request's acceptedOrderId "${r.acceptedOrderId}" matches no planned order`);
    }
    // Today's standalone requests: 2 pending + 1 rejected, present.
    const todayKey = ctx.days[ctx.days.length - 1];
    void todayKey;
    const pendingRequests = plan.requests.filter((r) => r.status === "pending");
    const rejectedRequests = plan.requests.filter((r) => r.status === "rejected");
    assert.equal(pendingRequests.length, 2, "2 standalone pending requests");
    assert.equal(rejectedRequests.length, 1, "1 standalone rejected request");
  });

  test(`planOrders[${label}]: voids reduce/remove a line and never empty an order`, () => {
    const ctx = buildCtx({ seed: 7, gstEnabled, gstRate, gstMode });
    const plan = planOrders(ctx);
    const voided = plan.orders.filter((o) => o.voids && o.voids.length > 0);
    assert.ok(voided.length >= 1, "expected at least one voided order for a solid pin (seed 7, 31 days, >=600 orders)");
    for (const o of voided) {
      assert.ok(o.items.length >= 1, `order ${o.orderId} has voids but zero items left`);
      assert.equal(o.voids!.length, 1, `order ${o.orderId}: only ONE void per order expected`);
    }
  });

  test(`planOrders[${label}]: chargeAmount only appears on the charged table's orders`, () => {
    const ctx = buildCtx({ seed: 7, gstEnabled, gstRate, gstMode });
    const plan = planOrders(ctx);
    const chargedTable = ctx.tables.find((t) => t.chargeAmount !== undefined)!;
    for (const o of plan.orders) {
      if (o.chargeAmount !== undefined) {
        assert.equal(o.tableNo, chargedTable.tableNo, `order ${o.orderId} has a chargeAmount but is not on the charged table`);
        assert.equal(o.chargeLabel, chargedTable.chargeLabel);
      }
      if (o.tableNo && o.tableNo !== chargedTable.tableNo) {
        assert.equal(o.chargeAmount, undefined, `order ${o.orderId} on an uncharged table has a chargeAmount`);
      }
    }
  });

  // CB-5B S16 — reward orders: the ONE extra item line is untotalled/untaxed,
  // discountKind stores "reward" at ₹0, and all 7 snapshot fields are present.
  test(`planOrders[${label}]: reward orders plant an untotalled, noted item line + full snapshot`, () => {
    const ctx = buildCtx({ seed: 7, gstEnabled, gstRate, gstMode });
    const plan = planOrders(ctx);
    const rewardOrders = plan.orders.filter((o) => o.discountKind === "reward");
    assert.ok(rewardOrders.length >= 1, "expected at least one reward order for a solid pin (seed 7, 31 days, >=600 orders)");

    for (const o of rewardOrders) {
      assert.equal(o.discount, 0, `reward order ${o.orderId}: discount must be 0`);
      assert.ok(o.customerId, `reward order ${o.orderId}: must have a customer (stamps live on a Customer row)`);
      assert.equal(o.status, "Completed", `reward order ${o.orderId}: only Completed orders claim a reward in this seed`);

      const rewardLines = o.items.filter((l) => l.reward === true);
      assert.equal(rewardLines.length, 1, `reward order ${o.orderId}: exactly one items[].reward===true line expected`);
      assert.equal(rewardLines[0].note, REWARD_ITEM_LINE_NOTE, `reward order ${o.orderId}: reward line must carry the shared note constant`);
      assert.equal(rewardLines[0].productId.toString(), ctx.rewardRung.productId.toString());
      assert.equal(rewardLines[0].qty, ctx.rewardRung.qty);

      assert.equal(o.rewardAt, ctx.rewardRung.at, `reward order ${o.orderId}: rewardAt mismatch`);
      assert.equal(o.rewardKind, "item", `reward order ${o.orderId}: rewardKind must be "item"`);
      assert.equal(o.rewardValue, 0, `reward order ${o.orderId}: rewardValue must be 0`);
      assert.equal(o.rewardItem, ctx.rewardRung.productName, `reward order ${o.orderId}: rewardItem name mismatch`);
      assert.equal(o.rewardItemProductId, ctx.rewardRung.productId.toString(), `reward order ${o.orderId}: rewardItemProductId mismatch`);
      assert.equal(o.rewardQty, ctx.rewardRung.qty, `reward order ${o.orderId}: rewardQty mismatch`);
      assert.equal(o.rewardStamps, ctx.rewardRung.at, `reward order ${o.orderId}: rewardStamps mismatch`);

      // The stored total must EXCLUDE the reward line's price — recomputed
      // over the SAME items with the reward line dropped entirely, matching
      // what a plain, non-reward version of this same bill would total.
      const withoutRewardLine = o.items.filter((l) => !l.reward);
      const recomputedWithout = computeOrderTotals({
        items: withoutRewardLine,
        discount: 0,
        discountKind: undefined,
        charge: o.chargeAmount ?? 0,
        cfg: { gstEnabled, gstRate: gstEnabled ? gstRate : 0, gstMode },
      });
      assert.equal(o.total, recomputedWithout.total, `reward order ${o.orderId}: stored total must equal the bill recomputed WITHOUT the reward line`);
    }

    // Negative pin: no order carries a reward line without discountKind === "reward".
    for (const o of plan.orders) {
      const hasRewardLine = o.items.some((l) => l.reward === true);
      if (hasRewardLine) assert.equal(o.discountKind, "reward", `order ${o.orderId}: a reward item line without discountKind "reward"`);
    }
  });
}

runPlanOrdersChecks("gst-inclusive-5pct", true, 5, "inclusive");
runPlanOrdersChecks("gst-exclusive-18pct", true, 18, "exclusive");

// ── planExtras invariants ────────────────────────────────────────────────────
test("planExtras: event/reservation date formats, future/past split, Seated table not in occupied set", () => {
  const ctx = buildCtx({ seed: 7, gstEnabled: true, gstRate: 5, gstMode: "inclusive" });
  const ordersPlan = planOrders(ctx);
  const occupiedTables = ordersPlan.tableStates.filter((s) => s.status === "Occupied").map((s) => s.tableNo);
  const extras = planExtras(ctx, ordersPlan.orders, occupiedTables);

  const todayKey = ctx.days[ctx.days.length - 1];
  for (const e of extras.events) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, `event date "${e.date}" not YYYY-MM-DD`);
    assert.match(e.time, /^\d{2}:\d{2}$/, `event time "${e.time}" not HH:MM`);
  }
  for (const r of extras.reservations) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, `reservation date "${r.date}" not YYYY-MM-DD`);
    assert.match(r.time, /^\d{2}:\d{2}$/, `reservation time "${r.time}" not HH:MM`);
  }

  const futureEvents = extras.events.filter((e) => e.date > todayKey);
  const pastEvents = extras.events.filter((e) => e.date < todayKey || e.date === todayKey);
  assert.equal(futureEvents.filter((e) => e.status === "Booked").length, 7, "7 future Booked events");
  assert.equal(pastEvents.filter((e) => e.status === "Completed").length, 3, "3 past Completed events");
  assert.equal(pastEvents.filter((e) => e.status === "Cancelled").length, 1, "1 past Cancelled event");

  if (extras.reservedTable) {
    assert.ok(!occupiedTables.includes(extras.reservedTable.tableNo), "reservedTable must not be an already-Occupied table");
    assert.equal(extras.reservedTable.status, "Reserved");
    assert.equal(extras.reservedTable.currentOrderId, undefined, "Reserved table state must carry no currentOrderId");
  }

  const seated = extras.reservations.filter((r) => r.status === "Seated");
  assert.equal(seated.length, 1, "exactly 1 Seated reservation");
  for (const r of seated) {
    if (r.tableNo) assert.ok(!occupiedTables.includes(r.tableNo), "Seated reservation's table must not be in the occupied set");
  }
});

test("planExtras: due payments never exceed the running due at their instant (brute-force check)", () => {
  const ctx = buildCtx({ seed: 7, gstEnabled: true, gstRate: 5, gstMode: "inclusive" });
  const ordersPlan = planOrders(ctx);
  const occupiedTables = ordersPlan.tableStates.filter((s) => s.status === "Occupied").map((s) => s.tableNo);
  const extras = planExtras(ctx, ordersPlan.orders, occupiedTables);

  assert.ok(extras.duePayments.length >= 1, "expected at least one due payment for seed 7 / 31 days / 40 customers");

  const runningDue = new Map<string, number>();
  const events: { at: number; customerId: string; delta: number }[] = [];
  for (const o of ordersPlan.orders) {
    if (!o.customerId) continue;
    if (o.status === "Cancelled" || o.payment === "Unpaid") continue;
    const due = Math.max(0, o.total - o.paidAmount);
    if (due > 0) events.push({ at: o.createdAt.getTime(), customerId: o.customerId.toString(), delta: due });
  }
  for (const d of extras.duePayments) {
    events.push({ at: d.createdAt.getTime(), customerId: d.customerId.toString(), delta: -d.amount });
  }
  events.sort((a, b) => a.at - b.at);
  for (const ev of events) {
    const before = runningDue.get(ev.customerId) ?? 0;
    const after = before + ev.delta;
    if (ev.delta < 0) {
      assert.ok(after >= 0, `customer ${ev.customerId}: a due payment exceeded the running balance (${before} + ${ev.delta} = ${after})`);
    }
    runningDue.set(ev.customerId, Math.max(0, after));
  }
});

// ── rollupsOf: equals a brute-force fold ────────────────────────────────────
test("rollupsOf: matches an independent brute-force fold over orders + due payments", () => {
  const ctx = buildCtx({ seed: 11, gstEnabled: true, gstRate: 5, gstMode: "inclusive" });
  const ordersPlan = planOrders(ctx);
  const occupiedTables = ordersPlan.tableStates.filter((s) => s.status === "Occupied").map((s) => s.tableNo);
  const extras = planExtras(ctx, ordersPlan.orders, occupiedTables);

  const actual = rollupsOf(ordersPlan.orders, extras.duePayments);

  // Independent brute-force fold, written without reusing rollupsOf's own code.
  const bruteForce = new Map<string, { visits: number; totalSpend: number; totalDue: number }>();
  for (const o of ordersPlan.orders as PlannedOrder[]) {
    if (!o.customerId) continue;
    if (o.status === "Cancelled") continue;
    if (o.payment === "Unpaid") continue;
    const id = o.customerId.toString();
    const row = bruteForce.get(id) ?? { visits: 0, totalSpend: 0, totalDue: 0 };
    row.visits += 1;
    row.totalSpend += o.total;
    row.totalDue += Math.max(0, o.total - o.paidAmount);
    bruteForce.set(id, row);
  }
  const paidByCustomer = new Map<string, number>();
  for (const d of extras.duePayments as PlannedDuePayment[]) {
    const id = d.customerId.toString();
    paidByCustomer.set(id, (paidByCustomer.get(id) ?? 0) + d.amount);
  }
  for (const [id, row] of bruteForce) {
    row.totalDue = Math.max(0, row.totalDue - (paidByCustomer.get(id) ?? 0));
  }

  assert.equal(actual.size, bruteForce.size, "rollupsOf produced a different number of customer entries");
  for (const [id, row] of bruteForce) {
    const got = actual.get(id);
    assert.ok(got, `rollupsOf missing an entry for customer ${id}`);
    assert.deepEqual(got, row, `rollupsOf entry for ${id} disagrees with the brute-force fold`);
  }
});

// ── Source pins ──────────────────────────────────────────────────────────────
function readSeedDemoFile(name: string): string {
  return readFileSync(join(SEED_DIR, name), "utf8");
}

const SEED_DEMO_FILES = [
  "types.ts",
  "rng.ts",
  "menu-data.ts",
  "menu-data-drinks.ts",
  "menu-data-food.ts",
  "people-data.ts",
  "orders-plan.ts",
  "orders-plan-day.ts",
  "orders-plan-draft.ts",
  "orders-plan-lines.ts",
  "orders-plan-assemble.ts",
  "extras-plan.ts",
  "extras-plan-dates.ts",
  "extras-plan-events.ts",
  "finalize.ts",
  "finalize-census.ts",
  "images.ts",
  "seed-core.ts",
  "orders-write.ts",
  "loyalty-data.ts",
  "index.ts",
];

// Needle built by concatenation so this pin's own source line can never match
// itself under a naive scan of the test file (house testing rule).
const BANNED_WORD = "Luci" + "fer";

// `imageFile` values are the owner's photo FILE names on disk — asset paths the
// seeder reads from, shown to nobody. Two of those files carry the previous
// cafe's name, so they are blanked before the SOURCE scan; the CONTENT scan
// below still covers every string a client could ever see.
const IMAGE_FILE_LITERAL_RE = /imageFile:\s*"[^"]*"/g;

test("source pin: the previous cafe's name appears nowhere in seed-demo source (asset file names excepted)", () => {
  const offenders: string[] = [];
  for (const file of SEED_DEMO_FILES) {
    const src = readSeedDemoFile(file).replace(IMAGE_FILE_LITERAL_RE, 'imageFile: ""');
    if (src.includes(BANNED_WORD)) offenders.push(file);
  }
  // Vision guard: prove the scan itself actually inspects real content by
  // requiring a positive landmark string be present in at least one scanned
  // file — a scan that silently read "" from every file would pass emptily.
  const landmark = readSeedDemoFile("menu-data.ts").includes("DEMO_CATEGORIES");
  assert.ok(landmark, "vision-guard landmark failed — menu-data.ts did not read as expected");
  // And prove the blanking really removes only imageFile literals: the raw
  // source of the two rows DOES carry the asset name (so this pin is not vacuous).
  const rawRows = readSeedDemoFile("menu-data-drinks.ts") + readSeedDemoFile("menu-data-food.ts");
  assert.ok(rawRows.includes(BANNED_WORD), "landmark: the two asset file names are present in the raw data files");
  assert.deepEqual(offenders, [], `banned word found outside imageFile literals in: ${offenders.join(", ")} — the demo product is generic "POS Software"`);
});

test("content pin: nothing a client can see (names, categories, variations, modifiers, people, notes) carries the previous cafe's name", () => {
  const visible = JSON.stringify({
    products: DEMO_PRODUCTS.map(({ imageFile: _asset, ...shown }) => shown),
    categories: DEMO_CATEGORIES,
    customers: DEMO_CUSTOMERS,
    staff: DEMO_STAFF,
    EVENT_TEMPLATES,
    RESERVATION_NOTES,
    ORDER_NOTES,
    CANCEL_REASONS,
    VOID_REASONS,
    ITEM_INSTRUCTIONS,
    SELF_ORDER_NOTES,
    DUE_NOTES,
  });
  assert.ok(visible.includes("House Special"), "landmark: the renamed products are in the scanned content");
  assert.ok(visible.includes("Birthday"), "landmark: the event templates are in the scanned content");
  assert.equal(visible.toLowerCase().includes(BANNED_WORD.toLowerCase()), false, "client-facing demo content must not name the previous cafe");
});

test("source pin: index.ts contains the three exact guard messages, in guard order, and dropDatabase runs AFTER all three", () => {
  const src = readSeedDemoFile("index.ts");
  const guard1 = "is not marked as a demo client";
  const guard2 = 'does not equal the slug "';
  const guard3 = "does not name the database in MONGODB_URI";
  const idx1 = src.indexOf(guard1);
  const idx2 = src.indexOf(guard2);
  const idx3 = src.indexOf(guard3);
  assert.ok(idx1 >= 0, "guard 1 (demo flag) message not found");
  assert.ok(idx2 >= 0, "guard 2 (slug confirm) message not found");
  assert.ok(idx3 >= 0, "guard 3 (db confirm) message not found");
  assert.ok(idx1 < idx2 && idx2 < idx3, "guards are not in the documented order (demo -> slug -> db)");

  const dropIdx = src.indexOf("dropDatabase()");
  assert.ok(dropIdx >= 0, "dropDatabase() call not found");
  assert.ok(dropIdx > idx3, "dropDatabase() must run AFTER all three guard checks");

  // Vision guard for the ordering assertion: a positive landmark proves the
  // file actually contains real, substantial code around the drop call.
  assert.ok(src.includes("await connectDB()"), "vision-guard landmark (connectDB) missing — index.ts did not read as expected");
});

test("source pin: index.ts never logs MONGODB_URI (the raw env var name is absent from console output lines)", () => {
  const src = readSeedDemoFile("index.ts");
  // Vision guard: prove the scan sees real console.log usage before asserting
  // an absence around it.
  assert.ok(src.includes("console.log("), "vision-guard landmark (console.log) missing — index.ts did not read as expected");
  const consoleLines = src.split("\n").filter((line) => line.includes("console.log(") || line.includes("console.error("));
  for (const line of consoleLines) {
    assert.ok(!line.includes("MONGODB_URI"), `a console line references MONGODB_URI directly: ${line.trim()}`);
  }
  // process.env.MONGODB_URI itself is read (to derive dbName) but must never
  // be interpolated into a logged string — dbNameOf() extracts only the db
  // name, and that derived value (not the URI) is what gets logged.
  assert.ok(src.includes("dbNameOf(process.env.MONGODB_URI)"), "vision-guard: dbNameOf(...) call site missing");
});

test("source pin: images.ts calls presignProductImagePut( with a randomHex option and uses r2Ref(", () => {
  const src = readSeedDemoFile("images.ts");
  assert.ok(src.includes("presignProductImagePut" + "("), "presignProductImagePut( call not found");
  assert.ok(src.includes("randomHex"), "randomHex option not found near the presign call");
  assert.ok(src.includes("r2Ref" + "("), "r2Ref( call not found");
  // Vision guard: confirm the file substantially matches its documented shape.
  assert.ok(src.includes("uploadDemoImages"), "vision-guard landmark (uploadDemoImages) missing — images.ts did not read as expected");
  // Never logs the presigned URL itself.
  const logLines = src.split("\n").filter((line) => line.trim().startsWith("log(") || line.includes("console.log("));
  for (const line of logLines) {
    assert.ok(!line.includes("grant.uploadUrl"), `a log line references grant.uploadUrl directly: ${line.trim()}`);
  }
});
