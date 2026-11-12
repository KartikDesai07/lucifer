import type { UpdateQuery } from "mongoose";
import { connectDB } from "@/lib/db";
import { StockItem, type IStockItem } from "@/models/StockItem";
import { STOCK_ITEMS_MAX, type StockUnit } from "@pos/shared/inventory";
import type { CreateStockItemInput, UpdateStockItemInput } from "@/schemas";
import type { StockItemDto } from "@/types/inventory";

// Server core for the stock-item list (Inventory lite, Slice 2). The routes under app/api/inventory/items own auth
// + the envelope; this file owns the DTO, the update shape and the two write rules (cap, unique active name).
// Stock itself (qty) only ever moves through lib/inventory/stock-move.ts: nothing here writes qty after create.

export const STOCK_ITEM_DUPLICATE_ERROR = "A stock item with that name already exists";
export const STOCK_ITEM_LIMIT_ERROR = `You can have at most ${STOCK_ITEMS_MAX} stock items. Archive one you no longer use.`;
export const STOCK_ITEM_NOT_FOUND_ERROR = "Stock item not found";
export const STOCK_ITEM_NOTHING_ERROR = "Nothing to change";

const BAD_REQUEST_STATUS = 400;
const NOT_FOUND_STATUS = 404;

// Archive is only ever `$set archived: true`, so "active" is "the key is absent" (omit-empty).
const ACTIVE = { archived: { $exists: false } } as const;

// Names match without regard to case ("milk" is "Milk"): the expense-category / Area collation.
const NAME_COLLATION = { locale: "en", strength: 2 } as const;

export interface StockItemRow {
  _id: { toString(): string };
  name: string;
  unit: StockUnit;
  qty?: number;
  lowAt?: number;
  lastRatePaise?: number;
}

/** Lean item to the wire shape. `lastRatePaise` is a cost: the KEY is absent for staff (and when never set). */
export function toStockItemDto(row: StockItemRow, isAdmin: boolean): StockItemDto {
  const dto: StockItemDto = {
    id: row._id.toString(),
    name: row.name,
    unit: row.unit,
    qtyMilli: row.qty ?? 0,
  };
  if (typeof row.lowAt === "number") dto.lowAtMilli = row.lowAt;
  if (isAdmin && typeof row.lastRatePaise === "number") dto.lastRatePaise = row.lastRatePaise;
  return dto;
}

/**
 * The PATCH body as ONE update, or null when nothing would change. Only the name, the low-stock line and the
 * archive flag are ever written: never the stock number or the unit. `lowAtMilli: null` clears the line ($unset).
 */
export function stockItemUpdate(input: UpdateStockItemInput): UpdateQuery<IStockItem> | null {
  const set: Partial<Pick<IStockItem, "name" | "lowAt" | "archived">> = {};
  if (input.name !== undefined) set.name = input.name;
  if (typeof input.lowAtMilli === "number") set.lowAt = input.lowAtMilli;
  if (input.archived === true) set.archived = true;

  const update: UpdateQuery<IStockItem> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (input.lowAtMilli === null) update.$unset = { lowAt: "" };
  return update.$set || update.$unset ? update : null;
}

export type StockItemWrite =
  | { ok: true; row: StockItemRow }
  | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): StockItemWrite => ({ ok: false, status, error });

/** Every active item, A to Z, no pagination (the cap keeps the list small). */
export async function listStockItems(isAdmin: boolean): Promise<StockItemDto[]> {
  await connectDB();
  const rows = await StockItem.find(ACTIVE)
    .select("name unit qty lowAt lastRatePaise")
    .sort({ name: 1 })
    .collation(NAME_COLLATION)
    .limit(STOCK_ITEMS_MAX)
    .lean();
  return rows.map((row) => toStockItemDto(row, isAdmin));
}

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const filter = exceptId ? { ...ACTIVE, name, _id: { $ne: exceptId } } : { ...ACTIVE, name };
  return (await StockItem.exists(filter).collation(NAME_COLLATION)) !== null;
}

/**
 * Add an item: refused at the cap and when an active item already has the name. Accepted residual (the Area /
 * expense-category one): two admins adding in the same instant can both pass these checks and land one over the
 * cap or with the same name; the cap is not a money fence and a duplicate can simply be archived.
 */
export async function createStockItem(input: CreateStockItemInput): Promise<StockItemWrite> {
  await connectDB();
  if ((await StockItem.countDocuments(ACTIVE)) >= STOCK_ITEMS_MAX) {
    return refuse(BAD_REQUEST_STATUS, STOCK_ITEM_LIMIT_ERROR);
  }
  if (await nameTaken(input.name)) return refuse(BAD_REQUEST_STATUS, STOCK_ITEM_DUPLICATE_ERROR);

  const doc: Partial<IStockItem> = { name: input.name, unit: input.unit, qty: input.openingQtyMilli ?? 0 };
  if (input.lowAtMilli !== undefined) doc.lowAt = input.lowAtMilli;
  const created = await StockItem.create(doc);
  return { ok: true, row: created.toObject() };
}

/**
 * Rename / set or clear the low-stock line / archive, in ONE atomic write on an ACTIVE item. An unknown id is a 404,
 * not a 500; so is an item archived meanwhile (a sheet left open elsewhere must not "save" into a hidden row).
 */
export async function updateStockItem(id: string, input: UpdateStockItemInput): Promise<StockItemWrite> {
  const update = stockItemUpdate(input);
  if (!update) return refuse(BAD_REQUEST_STATUS, STOCK_ITEM_NOTHING_ERROR);

  await connectDB();
  // Renaming "milk" to "Milk" on itself is fine: only ANOTHER active item's name blocks.
  if (input.name !== undefined && (await nameTaken(input.name, id))) {
    return refuse(BAD_REQUEST_STATUS, STOCK_ITEM_DUPLICATE_ERROR);
  }
  const updated = await StockItem.findOneAndUpdate({ _id: id, ...ACTIVE }, update, { new: true, runValidators: true }).lean();
  if (!updated) return refuse(NOT_FOUND_STATUS, STOCK_ITEM_NOT_FOUND_ERROR);
  return { ok: true, row: updated };
}
