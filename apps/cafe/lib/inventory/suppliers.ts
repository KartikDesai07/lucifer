import { Types, type UpdateQuery } from "mongoose";
import { connectDB } from "@/lib/db";
import { Supplier, SUPPLIER_SCHEMA_VERSION, type ISupplier } from "@/models/Supplier";
import { ACTIVE_STOCK_ENTRY, StockEntry } from "@/models/StockEntry";
import { SUPPLIERS_MAX } from "@pos/shared/inventory";
import type { CreateSupplierInput, UpdateSupplierInput } from "@/schemas";
import type { SupplierDto } from "@/types/inventory";

// Server core for the supplier list (Inventory lite, Slice 5). The routes under app/api/inventory/suppliers own auth
// + the envelope; this file owns the DTO, the update shape, the dues sum and the write rules (cap, unique active
// name, no archive while money is owed). There is NO stored balance: what a supplier is owed is worked out on read
// from their entries that still count (ACTIVE_STOCK_ENTRY), so deleting a purchase drops its due by itself.

export const SUPPLIER_DUPLICATE_ERROR = "A supplier with that name already exists";
export const SUPPLIER_LIMIT_ERROR = `You can have at most ${SUPPLIERS_MAX} suppliers. Archive one you no longer use.`;
export const SUPPLIER_NOT_FOUND_ERROR = "Supplier not found";
export const SUPPLIER_HAS_DUES_ERROR = "Settle this supplier's dues before you archive them.";
export const SUPPLIER_NOTHING_ERROR = "Nothing to change";
export const SUPPLIER_ARCHIVED_ENTRY_ERROR = "This entry belongs to an archived supplier, so it can't be deleted.";

const BAD_REQUEST_STATUS = 400;
const NOT_FOUND_STATUS = 404;

// Archive is only ever `$set archived: true`, so "active" is "the key is absent" (omit-empty).
const ACTIVE = { archived: { $exists: false } } as const;

// Names match without regard to case ("sharma" is "Sharma"): the items.ts / Area collation.
const NAME_COLLATION = { locale: "en", strength: 2 } as const;

export interface SupplierRow {
  _id: { toString(): string };
  name: string;
  phone?: string;
  note?: string;
}

/** Lean supplier to the wire shape: phone and note only when set; `duePaise` is the sum worked out by supplierDues. */
export function toSupplierDto(row: SupplierRow, duePaise: number): SupplierDto {
  return {
    id: row._id.toString(),
    name: row.name,
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.note ? { note: row.note } : {}),
    duePaise,
  };
}

/**
 * The PATCH body as ONE update, or null when nothing would change. `phone` / `note`: a non-empty string sets it, null
 * or "" clears it ($unset, omit-empty). `archived` can only be set. The name is never cleared.
 */
export function supplierUpdate(input: UpdateSupplierInput): UpdateQuery<ISupplier> | null {
  const set: Partial<Pick<ISupplier, "name" | "phone" | "note" | "archived">> = {};
  const unset: Record<string, ""> = {};
  if (input.name !== undefined) set.name = input.name;
  for (const key of ["phone", "note"] as const) {
    const value = input[key];
    if (typeof value === "string" && value !== "") set[key] = value;
    else if (value === null || value === "") unset[key] = "";
  }
  if (input.archived === true) set.archived = true;

  const update: UpdateQuery<ISupplier> = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return update.$set || update.$unset ? update : null;
}

/**
 * What each supplier is owed: ONE aggregate over the entries that still count, summing `duePaise` per supplier
 * (purchase: total minus paid, so positive; payment: negative). A supplier with no entry is absent from the map.
 * An aggregate does NOT cast, so string ids are turned into ObjectIds here.
 */
export async function supplierDues(ids?: readonly string[]): Promise<Map<string, number>> {
  const supplierId = ids ? { $in: ids.map((id) => new Types.ObjectId(id)) } : { $exists: true };
  const rows = await StockEntry.aggregate<{ _id: Types.ObjectId; due: number }>([
    { $match: { supplierId, ...ACTIVE_STOCK_ENTRY, duePaise: { $exists: true } } },
    { $group: { _id: "$supplierId", due: { $sum: "$duePaise" } } },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), row.due]));
}

/**
 * Would deleting this entry change an ARCHIVED supplier's dues? Review s118 (MED): an archived supplier owes 0 (the
 * archive rule), but its rows can still hold amounts that cancel out (a purchase and the payment that settled it).
 * Deleting one would bring back a due nobody can see or pay (archived suppliers leave the list and cannot be paid), so
 * the DELETE route refuses it. A row without duePaise (wastage, count, a purchase paid in full) never moves dues.
 * Accepted residual (the archive race kind): an archive landing between this read and the delete's CAS.
 */
export async function entryMovesArchivedDues(entryId: string): Promise<boolean> {
  await connectDB();
  const entry = await StockEntry.findOne({ _id: entryId, ...ACTIVE_STOCK_ENTRY, duePaise: { $exists: true } }).select("supplierId").lean();
  if (!entry?.supplierId) return false;
  return (await Supplier.exists({ _id: entry.supplierId, archived: { $exists: true } })) !== null;
}

export type SupplierWrite =
  | { ok: true; dto: SupplierDto }
  | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): SupplierWrite => ({ ok: false, status, error });

/** Every active supplier, A to Z, no pagination (the cap keeps the list small), each with what they are owed. */
export async function listSuppliers(): Promise<SupplierDto[]> {
  await connectDB();
  const rows = await Supplier.find(ACTIVE)
    .select("name phone note")
    .sort({ name: 1 })
    .collation(NAME_COLLATION)
    .limit(SUPPLIERS_MAX)
    .lean();
  const dues = await supplierDues();
  return rows.map((row) => toSupplierDto(row, dues.get(row._id.toString()) ?? 0));
}

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const filter = exceptId ? { ...ACTIVE, name, _id: { $ne: exceptId } } : { ...ACTIVE, name };
  return (await Supplier.exists(filter).collation(NAME_COLLATION)) !== null;
}

/**
 * Add a supplier: refused at the cap and when an active supplier already has the name. Accepted residual (the
 * items.ts one): two admins adding in the same instant can both pass these checks and land one over the cap or with
 * the same name; neither is a money fence and a duplicate can simply be archived (while it owes nothing).
 */
export async function createSupplier(input: CreateSupplierInput): Promise<SupplierWrite> {
  await connectDB();
  if ((await Supplier.countDocuments(ACTIVE)) >= SUPPLIERS_MAX) return refuse(BAD_REQUEST_STATUS, SUPPLIER_LIMIT_ERROR);
  if (await nameTaken(input.name)) return refuse(BAD_REQUEST_STATUS, SUPPLIER_DUPLICATE_ERROR);

  // omit-empty: an empty phone or note is not stored.
  const doc: Partial<ISupplier> = { name: input.name, v: SUPPLIER_SCHEMA_VERSION };
  if (input.phone) doc.phone = input.phone;
  if (input.note) doc.note = input.note;
  const created = await Supplier.create(doc);
  return { ok: true, dto: toSupplierDto(created.toObject(), 0) };
}

/**
 * Rename / set or clear the phone and note / archive, in ONE atomic write on an ACTIVE supplier. An unknown id is a
 * 404, not a 500; so is a supplier archived meanwhile. Archiving is refused while the supplier's dues are not 0
 * (either sign: an advance is money too). Accepted residual: a purchase that lands between the dues check and the
 * archive write (or two admins doing both at once) leaves an archived supplier with a due; it still shows its name on
 * the entry, and the amount stays in the books, but there is no Pay action for an archived supplier.
 */
export async function updateSupplier(id: string, input: UpdateSupplierInput): Promise<SupplierWrite> {
  const update = supplierUpdate(input);
  if (!update) return refuse(BAD_REQUEST_STATUS, SUPPLIER_NOTHING_ERROR);

  await connectDB();
  // Renaming "sharma" to "Sharma" on itself is fine: only ANOTHER active supplier's name blocks.
  if (input.name !== undefined && (await nameTaken(input.name, id))) return refuse(BAD_REQUEST_STATUS, SUPPLIER_DUPLICATE_ERROR);
  const dues = await supplierDues([id]);
  const due = dues.get(id) ?? 0;
  if (input.archived === true && due !== 0) return refuse(BAD_REQUEST_STATUS, SUPPLIER_HAS_DUES_ERROR);

  const updated = await Supplier.findOneAndUpdate({ _id: id, ...ACTIVE }, update, { new: true, runValidators: true }).lean();
  if (!updated) return refuse(NOT_FOUND_STATUS, SUPPLIER_NOT_FOUND_ERROR);
  return { ok: true, dto: toSupplierDto(updated, due) };
}
