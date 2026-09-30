import { z } from "zod";
import {
  TABLE_AREAS_MAX,
  TABLE_AREA_NAME_MAX_LEN,
  TABLE_AREA_NAME_MESSAGE,
  TABLE_AREA_NAME_PATTERN,
} from "../constants";
import { objectIdString } from "./object-id.schema";

// A floor area's name — what staff call the section ("Garden", "AC Hall").
// Trimmed before validating so padding never reaches the database. Whether it
// duplicates another area is NOT decided here: the collation unique index in
// models/Area.ts is the authority (a JS lower-case would disagree with ICU).
export const areaNameSchema = z
  .string()
  .trim()
  .min(1, "Area name is required")
  .max(TABLE_AREA_NAME_MAX_LEN, `Keep it to ${TABLE_AREA_NAME_MAX_LEN} characters or fewer`)
  .regex(TABLE_AREA_NAME_PATTERN, TABLE_AREA_NAME_MESSAGE);

// POST /api/areas (admin). No order is accepted — the route appends at the end.
export const createAreaSchema = z.object({ name: areaNameSchema }).strict();

// PUT /api/areas/[id] (admin) — the same one field.
export const renameAreaSchema = createAreaSchema;

// PATCH /api/areas (admin) — the drag-and-drop arrangement. The WHOLE ordered id
// list is sent (the categories precedent): positions come from the index, so a
// client cannot invent a sparse or colliding order, and the route refuses a list
// that is not exactly the current set. The duplicate check sits on the ARRAY so
// the error path is `ids` (validateBody surfaces only fieldErrors).
export const reorderAreasSchema = z
  .object({
    ids: z
      .array(objectIdString)
      .min(1, "Send the areas to arrange")
      .max(TABLE_AREAS_MAX, `At most ${TABLE_AREAS_MAX} areas`)
      .refine((ids) => new Set(ids).size === ids.length, "The same area appears twice"),
  })
  .strict();

export type CreateAreaInput = z.infer<typeof createAreaSchema>;
export type RenameAreaInput = z.infer<typeof renameAreaSchema>;
export type ReorderAreasInput = z.infer<typeof reorderAreasSchema>;
