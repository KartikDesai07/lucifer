import { z } from "zod";
import { PRODUCT_BULK_MAX } from "../constants";
import { OBJECT_ID_HEX_PATTERN, objectIdString } from "./object-id.schema";

// POST /api/products/bulk — the Items page's bulk bar (Menu redesign,
// 2026-09-30). Staff may only change stock (owner: "staff sirf Out of stock");
// every other action is admin-only, and the ROUTE enforces that split — this
// list is what it checks.
export const PRODUCT_BULK_ACTIONS = ["out-of-stock", "in-stock", "move", "archive", "restore"] as const;
export type ProductBulkAction = (typeof PRODUCT_BULK_ACTIONS)[number];

export const STAFF_PRODUCT_BULK_ACTIONS = ["out-of-stock", "in-stock"] as const satisfies readonly ProductBulkAction[];

export function isStaffBulkAction(action: ProductBulkAction): boolean {
  return (STAFF_PRODUCT_BULK_ACTIONS as readonly ProductBulkAction[]).includes(action);
}

// The duplicate check sits on the ARRAY (not a refine on each branch object):
// z.discriminatedUnion only accepts plain object branches, and an array-level
// refine reports under `ids`, which validateBody surfaces as a field error.
const bulkIdsSchema = z
  .array(objectIdString)
  .min(1, "Pick at least one item")
  .max(PRODUCT_BULK_MAX, `Select up to ${PRODUCT_BULK_MAX} items at a time`)
  .refine((ids) => new Set(ids).size === ids.length, "The same item appears twice");

export const bulkProductsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("out-of-stock"), ids: bulkIdsSchema }).strict(),
  z.object({ action: z.literal("in-stock"), ids: bulkIdsSchema }).strict(),
  z
    .object({
      action: z.literal("move"),
      ids: bulkIdsSchema,
      // A malformed id must be a 400 here, never a CastError 500 at the
      // category lookup.
      categoryId: z
        .string({ required_error: "Pick a category" })
        .regex(OBJECT_ID_HEX_PATTERN, "Pick a category"),
    })
    .strict(),
  z.object({ action: z.literal("archive"), ids: bulkIdsSchema }).strict(),
  z.object({ action: z.literal("restore"), ids: bulkIdsSchema }).strict(),
]);

export type BulkProductsInput = z.infer<typeof bulkProductsSchema>;
