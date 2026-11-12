import { isDuplicateKeyError } from "@/lib/api-helpers";
import { connectDB, modelReady } from "@/lib/db";
import { StockItem } from "@/models/StockItem";
import { ACTIVE_STOCK_ENTRY, STOCK_ENTRY_SCHEMA_VERSION, StockEntry } from "@/models/StockEntry";
import type { CountEntryInput, CreateStockEntryInput, WasteEntryInput } from "@/schemas";
import { STOCK_ITEM_NOT_FOUND_ERROR } from "./items";
import type { StockEntryItemInfo, StockEntryRow } from "./entries-read";
import { moveStock, type StockSign, type StockUsedRef } from "./stock-move";

// Inventory lite Slice 4: the write side of the manual stock entries (wastage and counts). Entries are the SECOND
// stock writer after a sale (stock-move.ts): BOTH kinds land their row first (it claims the clientRef) and only then
// move stock through moveStock, by exactly the change the row records. So a retried or racing Save can never move
// stock twice, and deleting a row undoes exactly what it did. No auth gate lives here: the routes own that, and every
// identity field arrives from the SESSION. Ports are injected (real defaults below) so tests are DB-free.

export const STOCK_ENTRY_ALREADY_SAVED_ERROR = "This entry was already saved. Close this and check the list.";
export const STOCK_ENTRY_NOT_FOUND_ERROR = "Entry not found";
export const STOCK_ENTRY_SAVED_STOCK_OFF_ERROR = "Saved, but the stock number may be off. Count this item.";
export const STOCK_ENTRY_DELETED_STOCK_OFF_ERROR = "Deleted, but the stock number may be off. Count this item.";

const NOT_FOUND_STATUS = 404;
const CONFLICT_STATUS = 409;
const SERVER_ERROR_STATUS = 500;

/** Putting an entry's stored lines into stock (their qty is already signed as applied). */
export const ENTRY_APPLY: StockSign = 1;
/** Taking an entry's stored lines back out of stock (a delete). */
export const ENTRY_REVERSE: StockSign = -1;

/** An entry as stored, with the fields the replay check and the delete read. Never sent over the wire as is. */
export type StoredEntry = StockEntryRow & { createdById: string; deletedAt?: Date };

export interface NewEntryLine {
  itemId: string;
  qty: number;
  counted?: number;
}

export interface NewEntryDoc {
  kind: "waste" | "count";
  date: string;
  lines: NewEntryLine[];
  reason?: string;
  note?: string;
  createdBy: string;
  createdById: string;
  clientRef: string;
  v: number;
}

/** An active stock item as an entry reads it: the count needs today's stock number. */
export interface ActiveItemRow extends StockEntryItemInfo {
  qty?: number;
}

export type StockEntryCommand = CreateStockEntryInput & { createdBy: string; createdById: string };
type WasteCommand = WasteEntryInput & { createdBy: string; createdById: string };
type CountCommand = CountEntryInput & { createdBy: string; createdById: string };

export type CreateStockEntryResult =
  | { ok: true; row: StoredEntry; items: Map<string, StockEntryItemInfo>; replay?: true }
  | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

/** Thin ports over Mongo: the logic builds every document itself, so a fake sees the exact writes. */
export interface StockEntryDeps {
  connect(): Promise<void>;
  /** The entry that carries this clientRef (deleted or not), or null. */
  findByRef(clientRef: string): Promise<StoredEntry | null>;
  /** An ACTIVE (not archived) stock item with its stock number, or null. */
  findActiveItem(id: string): Promise<ActiveItemRow | null>;
  /** A stock item of any state (a replay reads it for the answer), or null. */
  findItem(id: string): Promise<StockEntryItemInfo | null>;
  /** Inserts the entry row; a duplicate clientRef throws the driver's E11000. */
  insert(doc: NewEntryDoc): Promise<StoredEntry>;
  /** One `$inc` per stock item (stock-move.ts). */
  move(lines: readonly StockUsedRef[], sign: StockSign): Promise<void>;
  /** The delete's CAS on "not deleted"; answers the lines of the row it just marked, or null on a miss. */
  softDelete(id: string, deletedBy: string, now: Date): Promise<{ lines?: readonly NewEntryLine[] } | null>;
}

const ACTIVE_ITEM = { archived: { $exists: false } } as const;

export const STOCK_ENTRY_DEPS: StockEntryDeps = {
  connect: async () => {
    await connectDB();
  },
  findByRef: (clientRef) => StockEntry.findOne({ clientRef }).lean() as Promise<StoredEntry | null>,
  findActiveItem: (id) => StockItem.findOne({ _id: id, ...ACTIVE_ITEM }).select("name unit qty").lean(),
  findItem: (id) => StockItem.findById(id).select("name unit").lean(),
  insert: async (doc) => {
    // The unique clientRef index must exist before the insert (modelReady), or two racing taps could both land.
    await modelReady(StockEntry);
    return (await StockEntry.create(doc)).toObject() as StoredEntry;
  },
  move: (lines, sign) => moveStock(lines, sign),
  softDelete: (id, deletedBy, now) =>
    StockEntry.findOneAndUpdate({ _id: id, ...ACTIVE_STOCK_ENTRY }, { $set: { deletedAt: now, deletedBy } }, { new: true })
      .select("lines")
      .lean() as Promise<{ lines?: readonly NewEntryLine[] } | null>,
};

const infoMap = (id: string, info: StockEntryItemInfo | null): Map<string, StockEntryItemInfo> =>
  new Map(info ? [[id, { name: info.name, unit: info.unit }]] : []);

// A retried or double-tapped Save carries the same clientRef and gets the FIRST row back (`replay`), never a second
// entry and never a second stock move. It is only a replay when it is the SAME account sending the SAME entry to a
// row that still counts; an edited re-send (same sheet, same ref) or a ref of a deleted row answers 409 instead.
async function replayOf(first: StoredEntry, cmd: StockEntryCommand, deps: StockEntryDeps): Promise<CreateStockEntryResult> {
  const line = first.lines?.[0];
  let same =
    !first.deletedAt &&
    first.createdById === cmd.createdById &&
    first.kind === cmd.kind &&
    first.date === cmd.date &&
    (first.note ?? "") === (cmd.note ?? "") &&
    line !== undefined &&
    line.itemId.toString() === cmd.itemId;
  if (same && cmd.kind === "waste") same = line?.qty === -cmd.qtyMilli && first.reason === cmd.reason;
  if (same && cmd.kind === "count") same = line?.counted === cmd.countedMilli;
  if (!same) return refuse(CONFLICT_STATUS, STOCK_ENTRY_ALREADY_SAVED_ERROR);
  return { ok: true, row: first, items: infoMap(cmd.itemId, await deps.findItem(cmd.itemId)), replay: true };
}

type Inserted = { row: StoredEntry } | { done: CreateStockEntryResult };

// The pre-read covers the common retry; the duplicate-key catch covers two requests racing past it.
async function insertEntry(doc: NewEntryDoc, cmd: StockEntryCommand, deps: StockEntryDeps): Promise<Inserted> {
  try {
    return { row: await deps.insert(doc) };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const first = await deps.findByRef(cmd.clientRef);
    if (!first) throw error;
    return { done: await replayOf(first, cmd, deps) };
  }
}

function baseDoc(cmd: StockEntryCommand, lines: NewEntryLine[]): NewEntryDoc {
  return {
    kind: cmd.kind,
    date: cmd.date,
    lines,
    // omit-empty: an empty note is no note.
    ...(cmd.note ? { note: cmd.note } : {}),
    createdBy: cmd.createdBy,
    createdById: cmd.createdById,
    clientRef: cmd.clientRef,
    v: STOCK_ENTRY_SCHEMA_VERSION,
  };
}

// Both kinds: the row lands FIRST (an insert that fails moved nothing, so its retry starts clean; the loser of a
// same-ref race replays and moves nothing), THEN stock moves by exactly the row's lines. A throw from the move leaves
// the row in place (never reverted) and says so; a Count fixes the stock number. A line of 0 is never sent.
async function insertThenMove(doc: NewEntryDoc, cmd: StockEntryCommand, item: ActiveItemRow, deps: StockEntryDeps): Promise<CreateStockEntryResult> {
  const inserted = await insertEntry(doc, cmd, deps);
  if ("done" in inserted) return inserted.done;
  const lines = doc.lines.filter((line) => line.qty !== 0).map((line) => ({ itemId: line.itemId, qty: line.qty }));
  if (lines.length > 0) {
    try {
      await deps.move(lines, ENTRY_APPLY);
    } catch {
      return refuse(SERVER_ERROR_STATUS, STOCK_ENTRY_SAVED_STOCK_OFF_ERROR);
    }
  }
  return { ok: true, row: inserted.row, items: infoMap(cmd.itemId, item) };
}

// A wastage takes its amount out of stock.
async function createWaste(cmd: WasteCommand, deps: StockEntryDeps): Promise<CreateStockEntryResult> {
  const item = await deps.findActiveItem(cmd.itemId);
  if (!item) return refuse(NOT_FOUND_STATUS, STOCK_ITEM_NOT_FOUND_ERROR);
  const doc: NewEntryDoc = { ...baseDoc(cmd, [{ itemId: cmd.itemId, qty: -cmd.qtyMilli }]), reason: cmd.reason };
  return insertThenMove(doc, cmd, item, deps);
}

// A count brings the stock number to what was counted: its row records the change from the number read here, and
// stock moves by that change (an $inc, never a $set). A sale that lands between the read and the move still counts
// on top of it. Review s116 (MED): setting the number BEFORE the row let a retry after a failed insert, or a same-ref
// race, apply a count twice and leave a row that no longer matched what it did to stock. Accepted residual (the
// items.ts kind): two admins counting the SAME item inside one read-to-move window both add their change; each row
// still equals what it did, and the next count puts the number right.
async function createCount(cmd: CountCommand, deps: StockEntryDeps): Promise<CreateStockEntryResult> {
  const item = await deps.findActiveItem(cmd.itemId);
  if (!item) return refuse(NOT_FOUND_STATUS, STOCK_ITEM_NOT_FOUND_ERROR);
  const delta = cmd.countedMilli - (item.qty ?? 0);
  const doc = baseDoc(cmd, [{ itemId: cmd.itemId, qty: delta, counted: cmd.countedMilli }]);
  return insertThenMove(doc, cmd, item, deps);
}

export async function createStockEntry(cmd: StockEntryCommand, deps: StockEntryDeps = STOCK_ENTRY_DEPS): Promise<CreateStockEntryResult> {
  await deps.connect();
  // A replay must never write anything again: it gets the first row back and moves nothing.
  const existing = await deps.findByRef(cmd.clientRef);
  if (existing) return replayOf(existing, cmd, deps);
  return cmd.kind === "waste" ? createWaste(cmd, deps) : createCount(cmd, deps);
}

export type DeleteStockEntryResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Soft delete (the row stays, with who and when), then take its lines back out of stock exactly once. The CAS on
 * "not deleted" makes a double tap or two racing deletes reverse once; the loser is a 404. A throw from the reversal
 * leaves the delete in place and says so.
 */
export async function deleteStockEntry(
  id: string,
  deletedBy: string,
  now: Date,
  deps: StockEntryDeps = STOCK_ENTRY_DEPS,
): Promise<DeleteStockEntryResult> {
  await deps.connect();
  const won = await deps.softDelete(id, deletedBy, now);
  if (!won) return refuse(NOT_FOUND_STATUS, STOCK_ENTRY_NOT_FOUND_ERROR);
  // A line that changed nothing (a count with no change) is never sent to the move.
  const lines = (won.lines ?? []).filter((line) => line.qty !== 0).map((line) => ({ itemId: line.itemId, qty: line.qty }));
  if (lines.length === 0) return { ok: true };
  try {
    await deps.move(lines, ENTRY_REVERSE);
  } catch {
    return refuse(SERVER_ERROR_STATUS, STOCK_ENTRY_DELETED_STOCK_OFF_ERROR);
  }
  return { ok: true };
}
