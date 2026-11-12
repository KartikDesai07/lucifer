import { z } from "zod";
import {
  STOCK_ITEM_NAME_MAX_LEN,
  STOCK_QTY_MAX,
  STOCK_QTY_MAX_MILLI,
  STOCK_UNITS,
  STOCK_USE_MAX_LINES,
} from "../inventory";
import { MAX_VARIATIONS, VARIATION_NAME_MAX_LEN } from "../constants";
import { objectIdString } from "./object-id.schema";

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

// Slice 3: PUT /api/products/[id]/stock-use (admin): what one sold unit of a menu item takes out of stock. Each line
// names a stock item, the unit the person typed the amount in (any unit of the item's group), and the amount as
// INTEGER milli-units of THAT unit. The server converts to the item's own unit once, at save (convertMilli).
// `sizes` (absent = the same amount for every size) gives one size its own amount; 0 = that size uses none. A size
// `name` must equal the menu item's size name byte for byte (a sale matches it exactly), so it is NOT trimmed.
// `lines: []` clears the item's stock use.
const stockUseSizeSchema = z
  .object({
    name: z.string().min(1, "Name the size").max(VARIATION_NAME_MAX_LEN, "Unknown size"),
    qtyMilli: z.number().int(DECIMALS).min(0, "Enter 0 or more").max(STOCK_QTY_MAX_MILLI, TOO_MUCH),
  })
  .strict();

const stockUseLineSchema = z
  .object({
    itemId: objectIdString,
    unit: z.enum(STOCK_UNITS),
    qtyMilli: z.number().int(DECIMALS).min(1, "Enter an amount above 0").max(STOCK_QTY_MAX_MILLI, TOO_MUCH),
    sizes: z
      .array(stockUseSizeSchema)
      .min(1, "Enter an amount for each size")
      .max(MAX_VARIATIONS, `At most ${MAX_VARIATIONS} sizes`)
      .refine((sizes) => new Set(sizes.map((s) => s.name)).size === sizes.length, "Two sizes have the same name")
      .optional(),
  })
  .strict();

export const stockUseSchema = z
  .object({
    lines: z
      .array(stockUseLineSchema)
      .max(STOCK_USE_MAX_LINES, `An item can use at most ${STOCK_USE_MAX_LINES} stock items`)
      .refine((lines) => new Set(lines.map((l) => l.itemId)).size === lines.length, "A stock item is listed twice"),
  })
  .strict();

// POST /api/products/[id]/stock-use/own (admin): the one tap that makes a menu item its own stock item (a store or
// dairy item IS its stock), counted in `unit`. One sold = one unit taken.
export const ownStockSchema = z.object({ unit: z.enum(STOCK_UNITS).default("pcs") }).strict();

export type StockUseInput = z.infer<typeof stockUseSchema>;
export type StockUseLineInput = StockUseInput["lines"][number];
export type OwnStockInput = z.infer<typeof ownStockSchema>;
