import { z } from "zod";
import { CATEGORY_REORDER_MAX } from "../constants";
import { objectIdString } from "./object-id.schema";

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required"),
  order: z.number().int().min(0).default(0), // display order in POS
});

export const updateCategorySchema = createCategorySchema.partial();

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
