import { isDuplicateKeyError } from "@/lib/api-helpers";
import { connectDB, modelReady } from "@/lib/db";
import { STOCK_ITEM_LIMIT_ERROR } from "@/lib/inventory/items";
import { Product } from "@/models/Product";
import { StockItem } from "@/models/StockItem";
import {
  STOCK_ITEMS_MAX,
  STOCK_ITEM_NAME_MAX_LEN,
  STOCK_QTY_MAX_MILLI,
  STOCK_QTY_SCALE,
  convertMilli,
  type StockUnit,
} from "@pos/shared/inventory";
import type { StockUseInput, StockUseLineInput } from "@/schemas";
import type { StockUseDto, StockUseLineDto } from "@/types/inventory";

// Inventory lite Slice 3: what one sold unit of a menu item takes out of stock (Product.stockUse). Three operations:
// read it, replace it, and the one tap that makes a menu item its own stock item. The routes under
// app/api/products/[id]/stock-use own auth + the envelope + the products cache; this file owns every stockUse write
// (a pin counts the writers). Amounts are typed in any unit of the stock item's group and stored ONCE in the item's
// own unit as integer milli-units (convertMilli), so a sale (lib/inventory/stock-use.ts) never converts.
// Never writes the menu item's on/off flag (owner D3): stock use moves stock, it never hides a dish.

export const STOCK_USE_PRODUCT_NOT_FOUND_ERROR = "Item not found";
export const STOCK_USE_ITEM_REMOVED_ERROR = "A stock item in this list was removed. Close the item and open it again.";
export const STOCK_USE_OWN_BUSY_ERROR = "This item already uses stock. Remove its stock use first.";
export const STOCK_USE_OWN_NAME_ERROR =
  "A stock item with this item's name already exists. Add it with + Add stock item instead.";
export const stockUseSizeError = (name: string): string =>
  `This item has no size named "${name}". Close the item and open it again.`;
export const stockUseArchivedError = (name: string): string =>
  `${name} is archived. Remove it from this item's stock use.`;
export const stockUseUnitError = (name: string, unit: StockUnit): string => `Pick a unit that fits ${name} (${unit})`;
export const stockUseTooSmallError = (name: string): string => `Enter a larger amount of ${name}`;
export const stockUseTooBigError = (name: string): string => `Enter a smaller amount of ${name}`;

const BAD_REQUEST_STATUS = 400;
const NOT_FOUND_STATUS = 404;
const CONFLICT_STATUS = 409;

// Archive is only ever `$set archived: true`, so "active" is "the key is absent" (the items.ts rule).
const ACTIVE = { archived: { $exists: false } } as const;
// Names match without regard to case, like every other stock-item name check (items.ts).
const NAME_COLLATION = { locale: "en", strength: 2 } as const;

/** A stored link as read (`itemId` is an ObjectId; compared as text). */
export interface StoredLink {
  itemId: unknown;
  qty: number;
  sizes?: readonly { name: string; qty: number }[];
}

/** The slice of a product row these operations read (which fields depends on the call). */
export interface UseProductRow {
  name?: string;
  variations?: readonly { name: string }[];
  stockUse?: readonly StoredLink[];
}

export interface UseItemRow {
  _id: unknown;
  name: string;
  unit: StockUnit;
  archived?: boolean;
}

export type StockUseResult = { ok: true; dto: StockUseDto } | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): StockUseResult => ({ ok: false, status, error });

/** Thin ports over Mongo: the logic builds every filter and update itself, so a fake sees the exact documents. */
export interface StockUseDeps {
  connect(): Promise<void>;
  /** One product, only `fields` selected; null = no such product. */
  findProduct(id: string, fields: string): Promise<UseProductRow | null>;
  /** ONE `$in` read of stock items by id. */
  findItems(ids: string[]): Promise<UseItemRow[]>;
  findOwnItem(productId: string): Promise<UseItemRow | null>;
  countActive(): Promise<number>;
  /** An ACTIVE item with this name (any case) that is not owned by `productId`. */
  nameTaken(name: string, productId: string): Promise<boolean>;
  /** The upsert of the own item; answers the document after the write. */
  upsertItem(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<UseItemRow>;
  /** A Product update; answers how many products matched. */
  updateProduct(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<number>;
}

export const STOCK_USE_DEPS: StockUseDeps = {
  connect: async () => {
    await connectDB();
  },
  findProduct: (id, fields) => Product.findById(id).select(fields).lean(),
  findItems: (ids) => StockItem.find({ _id: { $in: ids } }).select("name unit archived").lean(),
  findOwnItem: (productId) => StockItem.findOne({ ownerProductId: productId }).select("name unit archived").lean(),
  countActive: () => StockItem.countDocuments(ACTIVE),
  nameTaken: async (name, productId) =>
    (await StockItem.exists({ ...ACTIVE, name, ownerProductId: { $ne: productId } }).collation(NAME_COLLATION)) !== null,
  upsertItem: async (filter, update) => {
    // The unique ownerProductId index makes two racing taps one item, so it must exist before the upsert (modelReady).
    await modelReady(StockItem);
    return StockItem.findOneAndUpdate(filter, update, { upsert: true, new: true }).select("name unit archived").lean() as Promise<UseItemRow>;
  },
  updateProduct: async (filter, update) => (await Product.updateOne(filter, update)).matchedCount,
};

const text = (id: unknown): string => String(id);

function lineDto(item: UseItemRow, qtyMilli: number, sizes?: readonly { name: string; qtyMilli: number }[]): StockUseLineDto {
  const dto: StockUseLineDto = { itemId: text(item._id), name: item.name, unit: item.unit, qtyMilli };
  if (item.archived) dto.archived = true;
  if (sizes?.length) dto.sizes = sizes.map((s) => ({ name: s.name, qtyMilli: s.qtyMilli }));
  return dto;
}

/** The stored links as the wire shape, from ONE read of their stock items; a link whose item is gone is left out. */
async function dtoOf(links: readonly StoredLink[], deps: StockUseDeps): Promise<StockUseDto> {
  if (links.length === 0) return { lines: [] };
  const items = new Map((await deps.findItems(links.map((l) => text(l.itemId)))).map((i) => [text(i._id), i]));
  const lines: StockUseLineDto[] = [];
  for (const link of links) {
    const item = items.get(text(link.itemId));
    if (item) lines.push(lineDto(item, link.qty, link.sizes?.map((s) => ({ name: s.name, qtyMilli: s.qty }))));
  }
  return { lines };
}

/** GET: the item's current stock use. */
export async function getStockUse(productId: string, deps: StockUseDeps = STOCK_USE_DEPS): Promise<StockUseResult> {
  await deps.connect();
  const product = await deps.findProduct(productId, "stockUse");
  if (!product) return refuse(NOT_FOUND_STATUS, STOCK_USE_PRODUCT_NOT_FOUND_ERROR);
  return { ok: true, dto: await dtoOf(product.stockUse ?? [], deps) };
}

type Converted = { ok: true; qty: number } | { ok: false; error: string };

/** One typed amount into the item's own unit; the same three refusals for a line and for a size (0 only for a size). */
function convert(milli: number, from: StockUnit, item: UseItemRow, min: number): Converted {
  const qty = convertMilli(milli, from, item.unit);
  if (qty === null) return { ok: false, error: stockUseUnitError(item.name, item.unit) };
  if (qty < min) return { ok: false, error: stockUseTooSmallError(item.name) };
  if (qty > STOCK_QTY_MAX_MILLI) return { ok: false, error: stockUseTooBigError(item.name) };
  return { ok: true, qty };
}

interface StoredUseLine {
  itemId: string;
  qty: number;
  sizes?: { name: string; qty: number }[];
}

/** Every line checked and converted, or the first refusal. Pure over the reads: nothing is written until all pass. */
function convertLines(
  lines: readonly StockUseLineInput[],
  items: ReadonlyMap<string, UseItemRow>,
): { ok: true; stored: StoredUseLine[]; dto: StockUseLineDto[] } | { ok: false; error: string } {
  const stored: StoredUseLine[] = [];
  const dto: StockUseLineDto[] = [];
  for (const line of lines) {
    const item = items.get(line.itemId);
    if (!item) return { ok: false, error: STOCK_USE_ITEM_REMOVED_ERROR };
    if (item.archived) return { ok: false, error: stockUseArchivedError(item.name) };
    const main = convert(line.qtyMilli, line.unit, item, 1);
    if (!main.ok) return main;
    const row: StoredUseLine = { itemId: line.itemId, qty: main.qty };
    const sizes: { name: string; qty: number }[] = [];
    for (const size of line.sizes ?? []) {
      // A typed 0 means "this size uses none"; anything typed above 0 must still count after the conversion.
      const one = convert(size.qtyMilli, line.unit, item, size.qtyMilli > 0 ? 1 : 0);
      if (!one.ok) return one;
      sizes.push({ name: size.name, qty: one.qty });
    }
    if (sizes.length > 0) row.sizes = sizes;
    stored.push(row);
    dto.push(lineDto(item, main.qty, row.sizes?.map((s) => ({ name: s.name, qtyMilli: s.qty }))));
  }
  return { ok: true, stored, dto };
}

/** PUT: replace the item's stock use in ONE write (`lines: []` removes the key). Every refusal writes nothing. */
export async function setStockUse(
  productId: string,
  input: StockUseInput,
  deps: StockUseDeps = STOCK_USE_DEPS,
): Promise<StockUseResult> {
  await deps.connect();
  const product = await deps.findProduct(productId, "variations");
  if (!product) return refuse(NOT_FOUND_STATUS, STOCK_USE_PRODUCT_NOT_FOUND_ERROR);

  // A size name must be one of the item's own, byte for byte: a sale matches it exactly (stockUsedOf).
  const sizeNames = new Set((product.variations ?? []).map((v) => v.name));
  for (const line of input.lines) {
    for (const size of line.sizes ?? []) {
      if (!sizeNames.has(size.name)) return refuse(BAD_REQUEST_STATUS, stockUseSizeError(size.name));
    }
  }

  let converted: { stored: StoredUseLine[]; dto: StockUseLineDto[] } = { stored: [], dto: [] };
  if (input.lines.length > 0) {
    const items = new Map((await deps.findItems(input.lines.map((l) => l.itemId))).map((i) => [text(i._id), i]));
    const result = convertLines(input.lines, items);
    if (!result.ok) return refuse(BAD_REQUEST_STATUS, result.error);
    converted = result;
  }

  const update = converted.stored.length === 0 ? { $unset: { stockUse: "" } } : { $set: { stockUse: converted.stored } };
  if ((await deps.updateProduct({ _id: productId }, update)) === 0) {
    return refuse(NOT_FOUND_STATUS, STOCK_USE_PRODUCT_NOT_FOUND_ERROR);
  }
  return { ok: true, dto: { lines: converted.dto } };
}

/** True when the stored use is exactly one link, to the item `ownId`. */
const isOnlyOwnLink = (links: readonly StoredLink[] | undefined, ownId: unknown): boolean =>
  links?.length === 1 && ownId !== undefined && text(links[0].itemId) === text(ownId);

/**
 * The one tap: the menu item IS its own stock item (one sold = one `unit`). Upserts the StockItem keyed by
 * ownerProductId (the unique partial index makes it one per menu item), then claims the product's stock use with a
 * `$exists: false` CAS so a racing tap or a hand-made recipe is never overwritten. A repeat tap is a 200 replay.
 */
export async function trackOwnStock(
  productId: string,
  unit: StockUnit,
  deps: StockUseDeps = STOCK_USE_DEPS,
): Promise<StockUseResult> {
  await deps.connect();
  const product = await deps.findProduct(productId, "name stockUse");
  if (!product) return refuse(NOT_FOUND_STATUS, STOCK_USE_PRODUCT_NOT_FOUND_ERROR);
  let own = await deps.findOwnItem(productId);

  if (product.stockUse?.length) {
    if (isOnlyOwnLink(product.stockUse, own?._id)) return { ok: true, dto: await dtoOf(product.stockUse, deps) };
    return refuse(CONFLICT_STATUS, STOCK_USE_OWN_BUSY_ERROR);
  }

  if (!own || own.archived) {
    // The item is about to become (or return as) an ACTIVE stock item: the same cap and name rule as + Add.
    if ((await deps.countActive()) >= STOCK_ITEMS_MAX) return refuse(BAD_REQUEST_STATUS, STOCK_ITEM_LIMIT_ERROR);
    // A restored item keeps its stored name, so that is the name checked; a new one takes the menu item's name.
    const name = own ? own.name : (product.name ?? "").trim().slice(0, STOCK_ITEM_NAME_MAX_LEN).trim();
    if (await deps.nameTaken(name, productId)) return refuse(CONFLICT_STATUS, STOCK_USE_OWN_NAME_ERROR);
    // $setOnInsert + $unset only (never one field in two operators; never a qty write on an existing item).
    const filter = { ownerProductId: productId };
    const update = { $setOnInsert: { name, unit }, $unset: { archived: "" } };
    try {
      own = await deps.upsertItem(filter, update);
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      own = await deps.findOwnItem(productId); // a racing tap created it first
      if (!own) throw error;
    }
  }

  const claim = { _id: productId, stockUse: { $exists: false } };
  const set = { $set: { stockUse: [{ itemId: own._id, qty: STOCK_QTY_SCALE }] } };
  if ((await deps.updateProduct(claim, set)) === 1) {
    return { ok: true, dto: { lines: [lineDto(own, STOCK_QTY_SCALE)] } };
  }

  // CAS miss: converge on what is stored now (the racing twin's identical write = a replay; anything else = busy).
  // Accepted residual (the items.ts kind): a recipe saved in the instant between the upsert and this claim gives a
  // 409 with the own stock item already made (or restored). It is not linked, shows on Inventory, can be archived,
  // and a later tap reuses it; undoing it here could undo a racing twin tap's item.
  const now = await deps.findProduct(productId, "stockUse");
  if (!now) return refuse(NOT_FOUND_STATUS, STOCK_USE_PRODUCT_NOT_FOUND_ERROR);
  if (isOnlyOwnLink(now.stockUse, own._id)) return { ok: true, dto: await dtoOf(now.stockUse ?? [], deps) };
  return refuse(CONFLICT_STATUS, STOCK_USE_OWN_BUSY_ERROR);
}
