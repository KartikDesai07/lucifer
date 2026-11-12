import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { addDays } from "@/lib/dashboard/range";
import { cafeDateString } from "@/lib/utils";
import { StockItem } from "@/models/StockItem";
import { ACTIVE_STOCK_ENTRY, StockEntry } from "@/models/StockEntry";
import {
  STOCK_ENTRY_BACKDATE_MAX_DAYS,
  STOCK_ENTRY_PAGE_MAX,
  type StockEntryKind,
  type StockUnit,
  type WasteReason,
} from "@pos/shared/inventory";
import type { StockEntryDto, StockEntryLineDto, StockEntryPageDto } from "@/types/inventory";

// Read side of the stock entries (Inventory lite, Slice 4): the wire DTO, the date window, the page cursor and the
// list read. The writes live in ./entries-write.ts. The helpers above `listStockEntries` are pure and DB-free so
// tests call them directly. Nothing here ever sends clientRef, createdById, v, the delete stamp or a money field.

export const STOCK_ENTRY_FUTURE_DATE_ERROR = "The date can't be in the future";
export const STOCK_ENTRY_OLD_DATE_ERROR = `The date can't be more than ${STOCK_ENTRY_BACKDATE_MAX_DAYS} days ago`;

/** A lean StockEntry as the DTO reads it (ids may be ObjectIds or strings). */
export interface StockEntryRow {
  _id: { toString(): string };
  kind: StockEntryKind;
  date: string;
  lines?: readonly { itemId: { toString(): string }; qty: number; counted?: number }[];
  reason?: string;
  note?: string;
  createdBy: string;
  createdAt: Date;
}

/** The two facts of a stock item an entry line shows. */
export interface StockEntryItemInfo {
  name: string;
  unit: StockUnit;
}

/**
 * Lean row to wire shape. Lines keep their stored order; a line whose item is not in `items` is left out. `qtyMilli`
 * is the SIGNED change as it was applied; `countedMilli` appears only on a count's line.
 */
export function toStockEntryDto(row: StockEntryRow, items: ReadonlyMap<string, StockEntryItemInfo>): StockEntryDto {
  const lines: StockEntryLineDto[] = [];
  for (const line of row.lines ?? []) {
    const itemId = line.itemId.toString();
    const item = items.get(itemId);
    if (!item) continue;
    const dto: StockEntryLineDto = { itemId, name: item.name, unit: item.unit, qtyMilli: line.qty };
    if (typeof line.counted === "number") dto.countedMilli = line.counted;
    lines.push(dto);
  }
  return {
    id: row._id.toString(),
    kind: row.kind,
    date: row.date,
    lines,
    ...(row.reason !== undefined ? { reason: row.reason as WasteReason } : {}),
    ...(row.note !== undefined ? { note: row.note } : {}),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The IST day keys an entry may be dated: today back to STOCK_ENTRY_BACKDATE_MAX_DAYS ago, both ends inclusive. */
export function stockEntryDateWindow(now: Date): { min: string; max: string } {
  const max = cafeDateString(now);
  return { min: addDays(max, -STOCK_ENTRY_BACKDATE_MAX_DAYS), max };
}

/** Why `date` ("YYYY-MM-DD") is outside the window, or null when it is fine. */
export function stockEntryDateError(date: string, now: Date): string | null {
  const { min, max } = stockEntryDateWindow(now);
  if (date > max) return STOCK_ENTRY_FUTURE_DATE_ERROR;
  if (date < min) return STOCK_ENTRY_OLD_DATE_ERROR;
  return null;
}

const CURSOR_SEPARATOR = "_";

/** The page cursor of a row: "<date>_<id>" (the list sorts by date, then id, newest first). */
export function entryCursorOf(row: { date: string; _id: { toString(): string } }): string {
  return `${row.date}${CURSOR_SEPARATOR}${row._id.toString()}`;
}

export interface EntryCursorFilter {
  $or?: [{ date: { $lt: string } }, { date: string; _id: { $lt: Types.ObjectId } }];
}

/** The filter for rows strictly after (older than) a cursor; no cursor means the first page. The route has validated the shape. */
export function entryCursorFilter(before?: string): EntryCursorFilter {
  if (before === undefined) return {};
  const [date, hex] = before.split(CURSOR_SEPARATOR);
  return { $or: [{ date: { $lt: date } }, { date, _id: { $lt: new Types.ObjectId(hex) } }] };
}

export interface StockEntryListOptions {
  before?: string;
  limit?: number;
}

/** One page of active entries, newest first, with item names and units from ONE `$in` read (archived items included). */
export async function listStockEntries(options: StockEntryListOptions = {}): Promise<StockEntryPageDto> {
  const limit = options.limit ?? STOCK_ENTRY_PAGE_MAX;
  await connectDB();
  const found = await StockEntry.find({ ...ACTIVE_STOCK_ENTRY, ...entryCursorFilter(options.before) })
    .sort({ date: -1, _id: -1 })
    .limit(limit + 1)
    .select("kind date lines reason note createdBy createdAt")
    .lean();
  const hasMore = found.length > limit;
  const rows = hasMore ? found.slice(0, limit) : found;

  const ids = [...new Set(rows.flatMap((row) => (row.lines ?? []).map((line) => line.itemId.toString())))];
  const items = new Map<string, StockEntryItemInfo>();
  if (ids.length > 0) {
    const stock = await StockItem.find({ _id: { $in: ids } }).select("name unit").lean();
    for (const item of stock) items.set(item._id.toString(), { name: item.name, unit: item.unit });
  }

  const page: StockEntryPageDto = { rows: rows.map((row) => toStockEntryDto(row, items)) };
  if (hasMore) page.nextBefore = entryCursorOf(rows[rows.length - 1]);
  return page;
}
