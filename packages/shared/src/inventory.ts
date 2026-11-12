// ─────────────────────────────────────────────────────────────────────────────
// Inventory Lite — the shared stock units + quantity codec.
//
// Pure POJO helpers, no Mongoose, no I/O: safe to import on the client (the
// stock screens format with these) and on the server (the settle / cancel paths
// move stock with them). Like the paise codec this is the ONE storage⇄
// presentation translator for stock quantities — apps never hand-roll the maths.
//
// Storage: a quantity is an INTEGER count of MILLI-units of the item's OWN unit
// (STOCK_QTY_SCALE per unit). 150 ml of a litre item is 150; 10 g of a kg item
// is 10; 3 pcs is 3000. Integers matter because the stock moves are `$inc`s: an
// integer sum never drifts, where 0.1 + 0.2 as floats is 0.30000000000000004.
// ─────────────────────────────────────────────────────────────────────────────

// ── Units ────────────────────────────────────────────────────────────────────

/**
 * Every unit a stock item can be counted in. APPEND-ONLY: a unit stored on an
 * item (or in a recipe) must never disappear from this list, or that document
 * stops decoding. A unit is fixed once the item is created.
 */
export const STOCK_UNITS = ["kg", "g", "L", "ml", "pcs", "packet", "box", "bottle"] as const;

export type StockUnit = (typeof STOCK_UNITS)[number];

export function isStockUnit(value: unknown): value is StockUnit {
  return typeof value === "string" && (STOCK_UNITS as readonly string[]).includes(value);
}

/**
 * Units convert only inside one group: mass (kg, g) and volume (L, ml). Pieces,
 * packets, boxes and bottles each stand alone, so a recipe cannot silently turn
 * "2 packets" into "2 pieces".
 */
export const STOCK_UNIT_GROUP: Readonly<Record<StockUnit, string>> = {
  kg: "mass",
  g: "mass",
  L: "volume",
  ml: "volume",
  pcs: "pcs",
  packet: "packet",
  box: "box",
  bottle: "bottle",
};

/** Multiplier to the group's base unit (g, ml): kg is 1000 g, L is 1000 ml. */
export const STOCK_UNIT_FACTOR: Readonly<Record<StockUnit, number>> = {
  kg: 1000,
  g: 1,
  L: 1000,
  ml: 1,
  pcs: 1,
  packet: 1,
  box: 1,
  bottle: 1,
};

/** Plain-English dropdown labels. */
export const STOCK_UNIT_LABEL: Readonly<Record<StockUnit, string>> = {
  kg: "Kilogram (kg)",
  g: "Gram (g)",
  L: "Litre (L)",
  ml: "Millilitre (ml)",
  pcs: "Pieces (pcs)",
  packet: "Packet",
  box: "Box",
  bottle: "Bottle",
};

/** Limits shared by the routes and the forms. */
export const STOCK_USE_MAX_LINES = 10;
export const STOCK_ITEM_NAME_MAX_LEN = 60;
/** Active (not archived) stock items one outlet may have: the list is read whole, with no paging. */
export const STOCK_ITEMS_MAX = 500;
/**
 * The largest number a person may type for one item (opening stock, low-stock
 * level), in whole units of the item's own unit. Keeps every quantity sum, and
 * a later qty × rate, far inside 2^53.
 */
export const STOCK_QTY_MAX = 100_000;

// ── Quantity codec ───────────────────────────────────────────────────────────

/** Milli-units stored per one whole unit of the item's own unit. */
export const STOCK_QTY_SCALE = 1000;

/** STOCK_QTY_MAX in stored milli-units. */
export const STOCK_QTY_MAX_MILLI = STOCK_QTY_MAX * STOCK_QTY_SCALE;

/**
 * Quantity (in the item's own unit) → integer MILLI-units for storage
 * (1.25 → 1250), rounded ONCE here at the input edge, half-up, with the same
 * `+ Number.EPSILON` guard as `rupeesToPaise`. Non-finite input is not
 * repaired (same as the paise codec): NaN/Infinity come back as-is, so callers
 * validate finiteness before they call.
 */
export function qtyToMilli(qty: number): number {
  return Math.round(qty * STOCK_QTY_SCALE + Number.EPSILON);
}

/** Integer milli-units → quantity in the item's own unit for presentation. */
export function milliToQty(milli: number): number {
  return milli / STOCK_QTY_SCALE;
}

/**
 * `qty` expressed in `from` → integer milli-units of the item's unit `to`, or
 * null when the two units are in different groups (no conversion exists).
 * Multiplies first and divides last, then rounds ONCE at the end, so
 * 150 ml → a litre item is 150 and 1.5 kg → a gram item is 1500000.
 */
export function convertToMilli(qty: number, from: StockUnit, to: StockUnit): number | null {
  if (STOCK_UNIT_GROUP[from] !== STOCK_UNIT_GROUP[to]) return null;
  const milli = (qty * STOCK_QTY_SCALE * STOCK_UNIT_FACTOR[from]) / STOCK_UNIT_FACTOR[to];
  return Math.round(milli + Number.EPSILON);
}

/**
 * Integer milli-units of `from` → integer milli-units of `to` (a recipe typed in ml, stored against a litre item),
 * or null across groups. Integer × integer ÷ integer, rounded ONCE: 150000 milli-ml → 150 milli-L. Used both ways:
 * the server stores in the item's unit, the item editor shows a stored amount back in the unit a person reads.
 */
export function convertMilli(milli: number, from: StockUnit, to: StockUnit): number | null {
  if (STOCK_UNIT_GROUP[from] !== STOCK_UNIT_GROUP[to]) return null;
  return Math.round((milli * STOCK_UNIT_FACTOR[from]) / STOCK_UNIT_FACTOR[to] + Number.EPSILON);
}

/** Units a recipe may use for an item counted in `unit`: its group, in list order. */
export function compatibleUnits(unit: StockUnit): StockUnit[] {
  const group = STOCK_UNIT_GROUP[unit];
  return STOCK_UNITS.filter((u) => STOCK_UNIT_GROUP[u] === group);
}

// ── Presentation ─────────────────────────────────────────────────────────────

/** Under one whole kg / L the screen shows the small unit instead (250 g). */
const SMALL_UNIT: Partial<Record<StockUnit, StockUnit>> = { kg: "g", L: "ml" };

/** Fixed decimals before trimming: milli-units give at most three. */
const QTY_DECIMALS = 3;

/** Up to three decimals, trailing zeros (and a dangling point) trimmed. */
function trimmed(value: number): string {
  const text = value.toFixed(QTY_DECIMALS).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

/**
 * Milli-units of `unit` → the text a person reads: "1.25 kg", "3 pcs". A kg / L
 * quantity under one whole unit shows in g / ml ("250 g"); zero stays "0 kg".
 * A negative stock (sold past zero) keeps an ASCII minus: "-2 pcs".
 */
export function formatQty(milli: number, unit: StockUnit): string {
  const small = SMALL_UNIT[unit];
  if (small !== undefined && milli !== 0 && Math.abs(milli) < STOCK_QTY_SCALE) {
    // 1 kg = 1000 g, so a milli-kg count IS the gram count (same for L / ml).
    return `${trimmed(milli)} ${small}`;
  }
  return `${trimmed(milliToQty(milli))} ${unit}`;
}

// ── Stock entries (Slice 4) ──────────────────────────────────────────────────

/**
 * Every kind of stock entry. APPEND-ONLY: stored on every entry. Wastage and
 * counts ship first; purchases and supplier payments arrive in later slices.
 */
export const STOCK_ENTRY_KINDS = ["purchase", "waste", "count", "payment"] as const;

export type StockEntryKind = (typeof STOCK_ENTRY_KINDS)[number];

/** Why stock was thrown away. APPEND-ONLY: stored on wastage entries, shown as-is. */
export const WASTE_REASONS = ["Spoiled", "Spilled or broken", "Staff meal", "Other"] as const;

export type WasteReason = (typeof WASTE_REASONS)[number];

export const STOCK_ENTRY_NOTE_MAX_LEN = 200;
/** One page of the entries list, newest first. */
export const STOCK_ENTRY_PAGE_MAX = 50;
/** How many days back an entry may be dated (today is day 0). */
export const STOCK_ENTRY_BACKDATE_MAX_DAYS = 31;

// ── Suppliers and purchases (Slice 5) ────────────────────────────────────────

export const SUPPLIER_NAME_MAX_LEN = 60;
export const SUPPLIER_PHONE_MAX_LEN = 20;
export const SUPPLIER_NOTE_MAX_LEN = 200;
/** Digits, spaces, "+", "-" and brackets: a phone as people write it. Empty is allowed (no phone). */
export const SUPPLIER_PHONE_PATTERN = /^[0-9+()\s-]*$/;
/** Active suppliers one outlet may have: the list is read whole, with no paging. */
export const SUPPLIERS_MAX = 200;
/** Lines one purchase may carry, one per stock item. */
export const PURCHASE_MAX_LINES = 20;
/**
 * The most one unit may cost: ₹5,00,000 in paise. With a quantity of at most STOCK_QTY_MAX_MILLI, a line's
 * qtyMilli × ratePaise stays at or under 5 × 10^15, inside 2^53, so the line amount is worked out exactly.
 */
export const STOCK_RATE_MAX_PAISE = 50_000_000;
/** One purchase's total: at most ₹1,00,00,000 in paise, inside Int32 (it is stored as Int32 paise). */
export const STOCK_ENTRY_MAX_TOTAL_PAISE = 1_000_000_000;

/**
 * One purchase line's amount in paise: quantity (integer milli-units of the item's own unit) × the rate of ONE unit
 * (integer paise), rounded ONCE, half-up. The server stores this and the purchase sheet previews with it, so both
 * always agree. Exact: the product is an integer under 2^53 and a tie (x.5) divides out exactly.
 */
export function purchaseLineAmountPaise(qtyMilli: number, ratePaise: number): number {
  return Math.round((qtyMilli * ratePaise) / STOCK_QTY_SCALE);
}

/** A purchase's total in paise: the sum of its rounded line amounts (each line rounds once, never the sum). */
export function purchaseTotalPaise(lines: readonly { qtyMilli: number; ratePaise: number }[]): number {
  return lines.reduce((sum, line) => sum + purchaseLineAmountPaise(line.qtyMilli, line.ratePaise), 0);
}

// ── Stock level ──────────────────────────────────────────────────────────────

export type StockLevel = "out" | "low" | "ok";

/** qty <= 0 is Out; qty <= the item's low-stock line (when set) is Low; else OK. */
export function stockLevel(qtyMilli: number, lowAtMilli?: number): StockLevel {
  if (qtyMilli <= 0) return "out";
  if (lowAtMilli !== undefined && qtyMilli <= lowAtMilli) return "low";
  return "ok";
}
