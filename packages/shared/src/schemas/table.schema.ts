import { z } from "zod";
import {
  TABLE_STATUSES,
  TABLE_NO_MAX_LEN,
  TABLE_NO_MESSAGE,
  TABLE_NO_PATTERN,
  TABLE_CAPACITY_MAX,
  TABLE_CAPACITY_MIN,
  TABLE_CHARGE_MAX,
  TABLE_CHARGE_LABEL_MAX_LEN,
  TABLE_CHARGE_LABEL_MESSAGE,
  TABLE_CHARGE_LABEL_PATTERN,
  TABLE_REORDER_MAX,
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

// The extra charge this table adds to every bill, in whole rupees. 0 (or
// omitted) means the table adds nothing. Clamped again server-side when the
// bill is priced — this bound is the operator-facing guard, not the money one.
const chargeAmountSchema = z
  .number()
  .int("Charge must be a whole rupee amount")
  .min(0, "Charge cannot be negative")
  .max(TABLE_CHARGE_MAX, `At most ${TABLE_CHARGE_MAX}`);

// What that charge is CALLED on the customer's slip. Deliberately has no
// default: the product must never invent a name for someone else's charge.
const chargeLabelSchema = z
  .string()
  .trim()
  .min(1, TABLE_CHARGE_LABEL_MESSAGE)
  .max(
    TABLE_CHARGE_LABEL_MAX_LEN,
    `Keep it to ${TABLE_CHARGE_LABEL_MAX_LEN} characters or fewer`,
  )
  .regex(TABLE_CHARGE_LABEL_PATTERN, TABLE_CHARGE_LABEL_MESSAGE);

// A charge that costs money MUST say what it is, in the same payload that sets
// it — an unnamed charge prints as a bare rupee figure the customer cannot
// question. Applied to create AND patch: a patch that raises the amount has to
// carry the name too, because a partial payload cannot see the stored one.
function requireLabelWithCharge(
  data: { chargeAmount?: number; chargeLabel?: string },
  ctx: z.RefinementCtx,
) {
  if (data.chargeAmount !== undefined && data.chargeAmount > 0 && !data.chargeLabel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["chargeLabel"],
      message: TABLE_CHARGE_LABEL_MESSAGE,
    });
  }
}

// POST /api/tables (admin). Status is not accepted — a new table always starts
// Available; occupancy is owned by the order lifecycle, not by whoever adds it.
export const createTableSchema = z
  .object({
    tableNo: tableNoSchema,
    capacity: capacitySchema.optional(),
    chargeAmount: chargeAmountSchema.optional(),
    chargeLabel: chargeLabelSchema.optional(),
  })
  .strict()
  .superRefine(requireLabelWithCharge);

// PATCH /api/tables/[tableNo] (admin) — rename and/or re-seat an existing table.
// Deliberately separate from updateTableSchema below: that one is the STAFF-facing
// live-status seam, this one is admin config, and the split is what lets the route
// layer apply two different auth guards.
export const patchTableSchema = z
  .object({
    tableNo: tableNoSchema.optional(),
    capacity: capacitySchema.optional(),
    chargeAmount: chargeAmountSchema.optional(),
    // Sending "" clears the name; the route pairs that with a 0 amount so a
    // priced-but-unnamed charge can never be stored.
    chargeLabel: z.union([chargeLabelSchema, z.literal("")]).optional(),
  })
  .strict()
  // Anchored to a field on purpose: validateBody surfaces only `fieldErrors`, so a
  // path-less root refinement would land in `formErrors` and reach the operator as
  // a bare "Validation failed".
  .refine(
    (d) =>
      d.tableNo !== undefined ||
      d.capacity !== undefined ||
      d.chargeAmount !== undefined ||
      d.chargeLabel !== undefined,
    {
      path: ["tableNo"],
      message: "Provide a new name, seat count or charge",
    },
  )
  .superRefine(requireLabelWithCharge);

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

// PATCH /api/tables (admin) — the floor plan's hand arrangement. The WHOLE
// ordered list is sent rather than a pair of swapped positions: a full list
// cannot leave two tables sharing a position or half-apply a swap, and it costs
// one round trip instead of two (the Categories screen's two-PUT swap can do
// both). Names only — a position is derived from the index, never accepted, so a
// client cannot invent a sparse or colliding arrangement.
export const reorderTablesSchema = z
  .object({
    tableNos: z
      .array(tableNoSchema)
      .min(1, "Send the tables to arrange")
      .max(TABLE_REORDER_MAX, `At most ${TABLE_REORDER_MAX} tables`),
  })
  .strict()
  // Anchored to a field on purpose: validateBody surfaces only `fieldErrors`, so
  // a path-less refinement would reach the operator as a bare "Validation failed".
  .refine((d) => new Set(d.tableNos).size === d.tableNos.length, {
    path: ["tableNos"],
    message: "The same table appears twice",
  });

export type CreateTableInput = z.infer<typeof createTableSchema>;
export type PatchTableInput = z.infer<typeof patchTableSchema>;
export type UpdateTableInput = z.infer<typeof updateTableSchema>;
export type ReorderTablesInput = z.infer<typeof reorderTablesSchema>;
