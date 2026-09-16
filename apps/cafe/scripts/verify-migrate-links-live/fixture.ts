/**
 * CB-DL-2 S4 — the v1-shaped fixture `verify-migrate-links-live.ts` seeds
 * with the RAW driver (never a Mongoose model — the whole point of this leg
 * is proving the migrate:links pipeline against documents shaped exactly like
 * the pre-D-A/D-B live database, which the current schemas would reject or
 * cast on the way in). Every collection the census/apply pipeline touches
 * gets at least one document; `settings` is untouched by the pipeline and
 * proves non-listed collections survive.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

export const BEVERAGES_NAME = "Beverages";
export const DESSERTS_NAME = "Desserts";
export const CASE_MISMATCH_NAME = " beverages"; // resolves to Beverages via normalizeName
export const UNMATCHED_NAME = "Snacks"; // no Category doc — must be skipped, then created
export const MATCHED_PRODUCT_NAME = "Cold Coffee";
export const CASE_MISMATCH_PRODUCT_NAME = "Iced Tea";
export const UNMATCHED_PRODUCT_NAME = "Chips";
export const ALREADY_MIGRATED_PRODUCT_NAME = "Brownie";
export const OCCUPIED_TABLE_NO = "T-1";
export const SEEDED_ORDER_ID = "ORD-A-20260101-001";
export const SEEDED_CUSTOMER_HEX = "507f1f77bcf86cd799439011";

export interface SeededIds {
  beveragesId: ObjectId;
  dessertsId: ObjectId;
  matchedProductId: ObjectId;
  caseMismatchProductId: ObjectId;
  unmatchedProductId: ObjectId;
  alreadyMigratedProductId: ObjectId;
}

/** Seeds the scratch database with a v1-shaped fixture through the raw
 * driver, plus the legacy `category_1` index (mirrors the index the old
 * schema declared, so dropLegacyCategory has something real to drop). */
export async function seedFixture(db: Db): Promise<SeededIds> {
  const now = new Date();

  const categoriesResult = await db.collection("categories").insertMany([
    { name: BEVERAGES_NAME, order: 1, createdAt: now, updatedAt: now },
    { name: DESSERTS_NAME, order: 2, createdAt: now, updatedAt: now },
  ]);
  const beveragesId = categoriesResult.insertedIds[0] as ObjectId;
  const dessertsId = categoriesResult.insertedIds[1] as ObjectId;

  // The legacy index the pre-D-A schema declared (productSchema.index({
  // category: 1 }) no longer exists in source, so it is created explicitly
  // here to prove dropLegacyCategory really removes a real index).
  await db.collection("products").createIndex({ category: 1 }, { name: "category_1" });

  const productsResult = await db.collection("products").insertMany([
    {
      name: MATCHED_PRODUCT_NAME,
      category: BEVERAGES_NAME, // exact match
      price: 90,
      discount: 0,
      available: true,
      image: "",
      modifiers: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      name: CASE_MISMATCH_PRODUCT_NAME,
      category: CASE_MISMATCH_NAME, // case/space mismatch, resolves via the normalized group
      price: 70,
      discount: 0,
      available: true,
      image: "",
      modifiers: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      name: UNMATCHED_PRODUCT_NAME,
      category: UNMATCHED_NAME, // no Category doc at all
      price: 40,
      discount: 0,
      available: true,
      image: "",
      modifiers: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      name: ALREADY_MIGRATED_PRODUCT_NAME,
      categoryId: dessertsId, // already migrated — no `category` key at all
      price: 60,
      discount: 0,
      available: true,
      image: "",
      modifiers: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  const matchedProductId = productsResult.insertedIds[0] as ObjectId;
  const caseMismatchProductId = productsResult.insertedIds[1] as ObjectId;
  const unmatchedProductId = productsResult.insertedIds[2] as ObjectId;
  const alreadyMigratedProductId = productsResult.insertedIds[3] as ObjectId;

  await db.collection("tables").insertOne({
    tableNo: OCCUPIED_TABLE_NO,
    capacity: 4,
    status: "Occupied",
    currentOrderId: SEEDED_ORDER_ID,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("orders").insertOne({
    orderId: SEEDED_ORDER_ID,
    customerId: SEEDED_CUSTOMER_HEX, // string-ref, pre-D-B shape
    items: [{ productId: String(matchedProductId), name: MATCHED_PRODUCT_NAME, price: 90, qty: 1 }],
    tableNo: OCCUPIED_TABLE_NO,
    status: "Pending",
    total: 90,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("duepayments").insertOne({
    customerId: SEEDED_CUSTOMER_HEX,
    amount: 50,
    mode: "Cash",
    receivedBy: "Fixture Staff",
    clientRef: "fixture-due-1",
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("orderrequests").insertOne({
    items: [{ productId: String(matchedProductId), name: MATCHED_PRODUCT_NAME, price: 90, qty: 1 }],
    tableNo: OCCUPIED_TABLE_NO,
    targetKind: "table",
    status: "Pending",
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("promoredemptions").insertOne({
    requestId: new ObjectId(),
    orderId: SEEDED_ORDER_ID,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("printjobs").insertOne({
    orderId: SEEDED_ORDER_ID,
    kind: "kot",
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("counters").insertOne({ _id: "order-20260101" as unknown as ObjectId, seq: 1 });

  await db.collection("customers").insertOne({
    name: "Fixture Customer",
    mobile: "9999999999",
    totalDue: 50,
    appliedOrders: [SEEDED_ORDER_ID],
    createdAt: now,
    updatedAt: now,
  });

  // Untouched by the pipeline — proves a non-listed collection survives
  // both the census and every apply step.
  await db.collection("settings").insertOne({
    restaurantName: "Scratch Migrate Cafe",
    createdAt: now,
    updatedAt: now,
  });

  return {
    beveragesId,
    dessertsId,
    matchedProductId,
    caseMismatchProductId,
    unmatchedProductId,
    alreadyMigratedProductId,
  };
}
