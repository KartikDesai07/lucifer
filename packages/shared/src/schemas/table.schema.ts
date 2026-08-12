import { z } from "zod";
import {
  TABLE_STATUSES,
  TABLE_NO_MAX_LEN,
  TABLE_NO_MESSAGE,
  TABLE_NO_PATTERN,
  TABLE_CAPACITY_MAX,
  TABLE_CAPACITY_MIN,
} from "../constants";

// The shape of a table's identity, shared by every schema that carries a tableNo
// (tables CRUD, orders, reservations). Shape only — that a table actually EXISTS
// is a live lookup against the Table collection in the route layer, because a
// compile-time list cannot know a cafe's floor plan (CR1.1).
export const tableNoSchema = z
  .string()
  .trim()
  .min(1, "Table name is required")
  .max(TABLE_NO_MAX_LEN, `Keep it to ${TABLE_NO_MAX_LEN} characters or fewer`)
  .regex(TABLE_NO_PATTERN, TABLE_NO_MESSAGE);

const capacitySchema = z
  .number()
  .int("Seats must be a whole number")
  .min(TABLE_CAPACITY_MIN, `At least ${TABLE_CAPACITY_MIN} seat`)
  .max(TABLE_CAPACITY_MAX, `At most ${TABLE_CAPACITY_MAX} seats`);

// POST /api/tables (admin). Status is not accepted — a new table always starts
// Available; occupancy is owned by the order lifecycle, not by whoever adds it.
export const createTableSchema = z
  .object({
    tableNo: tableNoSchema,
    capacity: capacitySchema.optional(),
  })
  .strict();

// PATCH /api/tables/[tableNo] (admin) — rename and/or re-seat an existing table.
// Deliberately separate from updateTableSchema below: that one is the STAFF-facing
// live-status seam, this one is admin config, and the split is what lets the route
// layer apply two different auth guards.
export const patchTableSchema = z
  .object({
    tableNo: tableNoSchema.optional(),
    capacity: capacitySchema.optional(),
  })
  .strict()
  // Anchored to a field on purpose: validateBody surfaces only `fieldErrors`, so a
  // path-less root refinement would land in `formErrors` and reach the operator as
  // a bare "Validation failed".
  .refine((d) => d.tableNo !== undefined || d.capacity !== undefined, {
    path: ["tableNo"],
    message: "Provide a new name or seat count",
  });

// PUT /api/tables/[tableNo] — the live status/order pointer (staff-accessible).
export const updateTableSchema = z.object({
  status: z.enum(TABLE_STATUSES),
  currentOrderId: z.string().optional(),
  // The order the operator's view expected this table to currently hold —
  // lets the route detect a stale view (same discipline as the order settle/
  // void seams' echo fields) instead of quietly overwriting a pointer another
  // device already moved on.
  expectedCurrentOrderId: z.string().max(40).optional(),
});

export type CreateTableInput = z.infer<typeof createTableSchema>;
export type PatchTableInput = z.infer<typeof patchTableSchema>;
export type UpdateTableInput = z.infer<typeof updateTableSchema>;
