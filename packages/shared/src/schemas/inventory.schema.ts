import { z } from "zod";
import { STOCK_ITEM_NAME_MAX_LEN, STOCK_QTY_MAX, STOCK_QTY_MAX_MILLI, STOCK_UNITS } from "../inventory";

// Inventory lite, Slice 2 (docs/superpowers/plans/2026-11-10-inventory-lite.md): the write surfaces of
// /api/inventory/items. Quantities travel as INTEGER milli-units of the item's own unit (the client converts the
// typed text with qtyToMilli), so no float ever reaches the server: the amountPaise precedent.

const TOO_MUCH = `Enter at most ${STOCK_QTY_MAX.toLocaleString("en-IN")}`;
const DECIMALS = "Use at most 3 decimal places";

const stockItemNameSchema = z
  .string()
  .trim()
  .min(1, "Name the stock item")
  .max(STOCK_ITEM_NAME_MAX_LEN, `Keep the name to ${STOCK_ITEM_NAME_MAX_LEN} characters or fewer`);

/** How much there is when the item is added: 0 or more. */
export const openingQtyMilliSchema = z.number().int(DECIMALS).min(0, "Enter 0 or more").max(STOCK_QTY_MAX_MILLI, TOO_MUCH);

/** The low-stock line: above 0 (at 0 or under, an item already shows Out). */
export const lowAtMilliSchema = z
  .number()
  .int(DECIMALS)
  .min(1, "Enter a level above 0, or leave it empty")
  .max(STOCK_QTY_MAX_MILLI, TOO_MUCH);

// POST /api/inventory/items: admin.
export const createStockItemSchema = z
  .object({
    name: stockItemNameSchema,
    unit: z.enum(STOCK_UNITS),
    openingQtyMilli: openingQtyMilliSchema.optional(),
    lowAtMilli: lowAtMilliSchema.optional(),
  })
  .strict();

// PATCH /api/inventory/items/[id]: admin. No `unit` (fixed once the item is created) and no stock number (stock moves
// only through sales and, later, wastage and counts): the strict schema refuses both keys. `lowAtMilli: null` clears
// the low-stock line. `archived` can only be set; no screen brings an item back yet.
export const updateStockItemSchema = z
  .object({
    name: stockItemNameSchema.optional(),
    lowAtMilli: lowAtMilliSchema.nullable().optional(),
    archived: z.literal(true).optional(),
  })
  .strict();

export type CreateStockItemInput = z.infer<typeof createStockItemSchema>;
export type UpdateStockItemInput = z.infer<typeof updateStockItemSchema>;
