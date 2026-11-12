import { z } from "zod";
import {
  PURCHASE_MAX_LINES,
  STOCK_ENTRY_MAX_TOTAL_PAISE,
  STOCK_ENTRY_NOTE_MAX_LEN,
  STOCK_ENTRY_PAGE_MAX,
  STOCK_ITEM_NAME_MAX_LEN,
  STOCK_QTY_MAX,
  STOCK_QTY_MAX_MILLI,
  STOCK_RATE_MAX_PAISE,
  STOCK_UNITS,
  STOCK_USE_MAX_LINES,
  SUPPLIER_NAME_MAX_LEN,
  SUPPLIER_NOTE_MAX_LEN,
  SUPPLIER_PHONE_MAX_LEN,
  SUPPLIER_PHONE_PATTERN,
  WASTE_REASONS,
  purchaseTotalPaise,
} from "../inventory";
import { MAX_VARIATIONS, VARIATION_NAME_MAX_LEN } from "../constants";
import { expenseDateSchema } from "./expense.schema";
import { objectIdString } from "./object-id.schema";

// Inventory lite, Slice 2 (docs/superpowers/plans/2026-11-10-inventory-lite.md): the write surfaces of
// /api/inventory/items. Quantities travel as INTEGER milli-units of the item's own unit (the client converts the
// typed text with qtyToMilli), so no float ever reaches the server: the amountPaise precedent.

const TOO_MUCH = `Enter at most ${STOCK_QTY_MAX.toLocaleString("en-IN")}`;
const DECIMALS = "Use at most 3 decimal places";
const PAISE_DECIMALS = "Use at most 2 decimal places";
const PAISE_PER_RUPEE = 100;
const TOTAL_TOO_BIG = `A purchase can total at most ₹${(STOCK_ENTRY_MAX_TOTAL_PAISE / PAISE_PER_RUPEE).toLocaleString("en-IN")}`;
const PAYMENT_TOO_BIG = `A payment can be at most ₹${(STOCK_ENTRY_MAX_TOTAL_PAISE / PAISE_PER_RUPEE).toLocaleString("en-IN")}`;
/** Shared with the server's own re-check (lib/inventory), so both refusals read the same. */
export const PAID_OVER_TOTAL_ERROR = "Paid can't be more than the total";
export const DUE_NEEDS_SUPPLIER_ERROR = "Pick a supplier for what is still to pay";

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

// Slice 4: POST /api/inventory/entries. A wastage (any signed-in account: staff log what was thrown away) takes
// `qtyMilli` out of stock; a count (admin) sets the stock to `countedMilli`, and the entry records the change it made.
// Both are in the item's OWN unit (integer milli-units), and both are idempotent on `clientRef` (one per opened sheet).
// The route checks that `date` is inside the allowed window (it needs "today"); this only checks the shape.
// A note of "" is no note.
const stockEntryNoteSchema = z
  .string()
  .trim()
  .max(STOCK_ENTRY_NOTE_MAX_LEN, `Keep the note to ${STOCK_ENTRY_NOTE_MAX_LEN} characters or fewer`);

const wasteEntrySchema = z
  .object({
    kind: z.literal("waste"),
    itemId: objectIdString,
    qtyMilli: z.number().int(DECIMALS).min(1, "Enter an amount above 0").max(STOCK_QTY_MAX_MILLI, TOO_MUCH),
    reason: z.enum(WASTE_REASONS),
    date: expenseDateSchema,
    note: stockEntryNoteSchema.optional(),
    clientRef: z.string().uuid(),
  })
  .strict();

const countEntrySchema = z
  .object({
    kind: z.literal("count"),
    itemId: objectIdString,
    countedMilli: openingQtyMilliSchema,
    date: expenseDateSchema,
    note: stockEntryNoteSchema.optional(),
    clientRef: z.string().uuid(),
  })
  .strict();

// Slice 5: a purchase (admin) adds each line's quantity to stock and records what it cost. Quantities are integer
// milli-units of the item's own unit; `ratePaise` is what ONE unit cost, in integer paise (0 = free goods). Line
// amounts and the total are worked out with purchaseLineAmountPaise / purchaseTotalPaise (the server stores its own
// sums, never a client's). `paidPaise` is what was paid now; total - paid is owed to the supplier, so anything left
// to pay needs `supplierId`. The route checks the date window and that the supplier and every item are active.
const purchaseLineSchema = z
  .object({
    itemId: objectIdString,
    qtyMilli: z.number().int(DECIMALS).min(1, "Enter an amount above 0").max(STOCK_QTY_MAX_MILLI, TOO_MUCH),
    ratePaise: z
      .number()
      .int(PAISE_DECIMALS)
      .min(0, "Enter 0 or more")
      .max(STOCK_RATE_MAX_PAISE, `Enter at most ₹${(STOCK_RATE_MAX_PAISE / PAISE_PER_RUPEE).toLocaleString("en-IN")}`),
  })
  .strict();

const purchaseEntrySchema = z
  .object({
    kind: z.literal("purchase"),
    supplierId: objectIdString.optional(),
    date: expenseDateSchema,
    lines: z
      .array(purchaseLineSchema)
      .min(1, "Add at least one stock item")
      .max(PURCHASE_MAX_LINES, `A purchase can have at most ${PURCHASE_MAX_LINES} stock items`)
      .refine((lines) => new Set(lines.map((l) => l.itemId)).size === lines.length, "A stock item is listed twice"),
    paidPaise: z.number().int(PAISE_DECIMALS).min(0, "Enter 0 or more").max(STOCK_ENTRY_MAX_TOTAL_PAISE, TOTAL_TOO_BIG),
    note: stockEntryNoteSchema.optional(),
    clientRef: z.string().uuid(),
  })
  .strict();

// Slice 6: a payment to a supplier (admin). No stock moves: the row alone lowers what the supplier is owed by
// `amountPaise` (stored as totalPaise = amount, duePaise = -amount; dues are summed on read). Paying more than is owed
// is allowed (the supplier then shows "paid ahead"). The amount is always the one the person typed, never a "pay it
// all" flag the server would fill in. The route checks the date window; the server checks the supplier is active.
const paymentEntrySchema = z
  .object({
    kind: z.literal("payment"),
    supplierId: objectIdString,
    amountPaise: z.number().int(PAISE_DECIMALS).min(1, "Enter an amount above 0").max(STOCK_ENTRY_MAX_TOTAL_PAISE, PAYMENT_TOO_BIG),
    date: expenseDateSchema,
    note: stockEntryNoteSchema.optional(),
    clientRef: z.string().uuid(),
  })
  .strict();

// The money rules of a purchase need the whole body, so they sit on the union (a discriminatedUnion member must be a
// plain object). The server re-checks all three with its own sums.
export const createStockEntrySchema = z
  .discriminatedUnion("kind", [wasteEntrySchema, countEntrySchema, purchaseEntrySchema, paymentEntrySchema])
  .superRefine((entry, ctx) => {
    if (entry.kind !== "purchase") return;
    const total = purchaseTotalPaise(entry.lines);
    if (total > STOCK_ENTRY_MAX_TOTAL_PAISE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lines"], message: TOTAL_TOO_BIG });
    } else if (entry.paidPaise > total) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["paidPaise"], message: PAID_OVER_TOTAL_ERROR });
    } else if (entry.paidPaise < total && entry.supplierId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["supplierId"], message: DUE_NEEDS_SUPPLIER_ERROR });
    }
  });

// Slice 5: suppliers (admin). A phone or note of "" is none. On PATCH, `phone` / `note` of null or "" clears it, and
// `archived` can only be set (the server refuses it while the supplier still has dues either way).
const supplierNameSchema = z
  .string()
  .trim()
  .min(1, "Name the supplier")
  .max(SUPPLIER_NAME_MAX_LEN, `Keep the name to ${SUPPLIER_NAME_MAX_LEN} characters or fewer`);

const supplierPhoneSchema = z
  .string()
  .trim()
  .max(SUPPLIER_PHONE_MAX_LEN, `Keep the phone to ${SUPPLIER_PHONE_MAX_LEN} characters or fewer`)
  .regex(SUPPLIER_PHONE_PATTERN, "Use digits, spaces, + or - only");

const supplierNoteSchema = z
  .string()
  .trim()
  .max(SUPPLIER_NOTE_MAX_LEN, `Keep the note to ${SUPPLIER_NOTE_MAX_LEN} characters or fewer`);

export const createSupplierSchema = z
  .object({
    name: supplierNameSchema,
    phone: supplierPhoneSchema.optional(),
    note: supplierNoteSchema.optional(),
  })
  .strict();

export const updateSupplierSchema = z
  .object({
    name: supplierNameSchema.optional(),
    phone: supplierPhoneSchema.nullable().optional(),
    note: supplierNoteSchema.nullable().optional(),
    archived: z.literal(true).optional(),
  })
  .strict();

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

/**
 * The entries list's page cursor: the last row's "<date>_<id>" (the list is sorted by date, then id, newest first).
 * The server hands it out as `nextBefore`; the client sends it back untouched.
 */
export const STOCK_ENTRY_CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}_[0-9a-f]{24}$/;

// GET /api/inventory/entries (admin): ?before=<cursor>&limit=<1..50>, and (Slice 6) ?supplierId=<id> for one
// supplier's purchases and payments only.
export const stockEntryListQuerySchema = z
  .object({
    before: z.string().regex(STOCK_ENTRY_CURSOR_PATTERN, "Invalid page").optional(),
    limit: z.coerce.number().int().min(1).max(STOCK_ENTRY_PAGE_MAX).optional(),
    supplierId: objectIdString.optional(),
  })
  .strict();

export type CreateStockEntryInput = z.infer<typeof createStockEntrySchema>;
export type WasteEntryInput = Extract<CreateStockEntryInput, { kind: "waste" }>;
export type CountEntryInput = Extract<CreateStockEntryInput, { kind: "count" }>;
export type PurchaseEntryInput = Extract<CreateStockEntryInput, { kind: "purchase" }>;
export type PurchaseLineInput = PurchaseEntryInput["lines"][number];
export type PaymentEntryInput = Extract<CreateStockEntryInput, { kind: "payment" }>;
export type StockEntryListQuery = z.infer<typeof stockEntryListQuerySchema>;

export type StockUseInput = z.infer<typeof stockUseSchema>;
export type StockUseLineInput = StockUseInput["lines"][number];
export type OwnStockInput = z.infer<typeof ownStockSchema>;
