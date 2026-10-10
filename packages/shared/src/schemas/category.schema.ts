import { z } from "zod";
import { CATEGORY_REORDER_MAX } from "../constants";
import { objectIdString } from "./object-id.schema";

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required"),
  order: z.number().int().min(0).default(0), // display order in POS
  // Printing Phase 2 (spec §6.2): the kitchen station its items print at. Optional with NO default:
  // absent means the default station, so every existing category keeps printing where it does.
  stationId: objectIdString.optional(),
  // Skip-KOT: `true` = items in this category never go on a kitchen ticket. Optional with NO default
  // and no `false` (omit-empty): absent means "they do", so every existing category is unchanged.
  noKot: z.literal(true).optional(),
});

// `stationId: null` is the explicit "back to the default station" (the product icon precedent): JSON
// cannot carry undefined, and an absent key means "leave it alone".
export const updateCategorySchema = createCategorySchema.partial().extend({
  stationId: objectIdString.nullable().optional(),
  // `null` = back to "sent to the kitchen" (the route $unsets it), same sentinel as stationId.
  noKot: z.literal(true).nullable().optional(),
});

// PATCH /api/categories (admin) — the drag-and-drop arrangement. The WHOLE
// ordered id list is sent (the Tables reorderTablesSchema precedent): positions
// are derived from the index, so a client cannot invent a sparse or colliding
// order, and the route refuses a list that is not exactly the current set.
// The duplicate check sits on the ARRAY so the error path is `ids` (validateBody
// surfaces only fieldErrors) and the object stays a plain strict schema.
export const reorderCategoriesSchema = z
  .object({
    ids: z
      .array(objectIdString)
      .min(1, "Send the categories to arrange")
      .max(CATEGORY_REORDER_MAX, `At most ${CATEGORY_REORDER_MAX} categories`)
      .refine((ids) => new Set(ids).size === ids.length, "The same category appears twice"),
  })
  .strict();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
