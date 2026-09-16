/**
 * Shared helper for every seed/live-leg fixture that used to create a product
 * with `category: "<name>"`. Product.categoryId is now a required ObjectId
 * (models/Product.ts) with no `category` String path at all — every caller
 * MUST resolve a name to a Category `_id` through this ONE function first.
 *
 * Seeds/legs must NEVER write a category NAME onto a product — only the id
 * this helper returns.
 */
import { Types } from "mongoose";
import { Category } from "@/models/Category";

// Upsert-by-name: returns the existing category's _id, or creates one with
// the given display `order` and returns its new _id.
//
// `order` is set ONLY via $setOnInsert — never $set — so this never touches
// an existing category's own order value. (Mongo rejects a WriteError if the
// same field appears in both $set and $setOnInsert on one update; this helper
// only ever needs the insert branch.)
export async function ensureCategoryId(name: string, order = 0): Promise<Types.ObjectId> {
  const doc = await Category.findOneAndUpdate(
    { name },
    { $setOnInsert: { name, order } },
    { upsert: true, new: true },
  ).lean();
  if (!doc) {
    throw new Error(`ensureCategoryId: upsert for "${name}" returned no document`);
  }
  return doc._id as Types.ObjectId;
}
