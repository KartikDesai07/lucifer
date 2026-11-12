import { STOCK_ENTRY_MAX_TOTAL_PAISE, purchaseLineAmountPaise } from "@pos/shared/inventory";
import { DUE_NEEDS_SUPPLIER_ERROR, PAID_OVER_TOTAL_ERROR, type PurchaseEntryInput } from "@/schemas";

// Pure helpers of the purchase write (Inventory lite, Slice 5): the server's OWN sums and money re-checks, so a
// client's totals are never trusted (the schema validates the same rules, but only the server's numbers are
// stored), and the replay same-check. No Mongoose here and no runtime import of entries-write.

const PAISE_PER_RUPEE = 100;
export const PURCHASE_TOTAL_TOO_BIG_ERROR = `A purchase can total at most ₹${(STOCK_ENTRY_MAX_TOTAL_PAISE / PAISE_PER_RUPEE).toLocaleString("en-IN")}`;

type Lines = PurchaseEntryInput["lines"];

/** One purchase line as stored: `qty` is the milli-units added (positive), `amountPaise` is worked out by the server. */
export interface PurchaseLineDoc {
  itemId: string;
  qty: number;
  ratePaise: number;
  amountPaise: number;
}

export interface PurchaseSums {
  lines: PurchaseLineDoc[];
  totalPaise: number;
  paidPaise: number;
  /** total minus paid. 0 means nothing is owed: the stored row then carries no duePaise key. */
  duePaise: number;
}

/** Each line's amount (rounded once per line) and their sum, from the request's quantities and rates only. */
export function purchaseSums(cmd: { lines: Lines; paidPaise: number }): PurchaseSums {
  const lines = cmd.lines.map((line) => ({
    itemId: line.itemId,
    qty: line.qtyMilli,
    ratePaise: line.ratePaise,
    amountPaise: purchaseLineAmountPaise(line.qtyMilli, line.ratePaise),
  }));
  const totalPaise = lines.reduce((sum, line) => sum + line.amountPaise, 0);
  return { lines, totalPaise, paidPaise: cmd.paidPaise, duePaise: totalPaise - cmd.paidPaise };
}

/** Why these sums cannot be saved (a 400), or null: total over the cap, paid over the total, or a due with no supplier. */
export function purchaseMoneyError(sums: PurchaseSums, supplierId: string | undefined): string | null {
  if (sums.totalPaise > STOCK_ENTRY_MAX_TOTAL_PAISE) return PURCHASE_TOTAL_TOO_BIG_ERROR;
  if (sums.paidPaise > sums.totalPaise) return PAID_OVER_TOTAL_ERROR;
  if (sums.duePaise > 0 && supplierId === undefined) return DUE_NEEDS_SUPPLIER_ERROR;
  return null;
}

/** A stored purchase as the replay check reads it (ids may be ObjectIds or strings). */
export interface StoredPurchase {
  supplierId?: { toString(): string };
  paidPaise?: number;
  lines?: readonly { itemId: { toString(): string }; qty: number; ratePaise?: number }[];
}

/**
 * Is a re-sent purchase the SAME one the first row recorded? Supplier (both absent or equal), paid now, and the lines
 * in order (item, quantity, rate). Totals follow from those, so they are not compared again.
 */
export function purchaseSameAs(first: StoredPurchase, cmd: { supplierId?: string; paidPaise: number; lines: Lines }): boolean {
  if (first.supplierId?.toString() !== cmd.supplierId) return false;
  if ((first.paidPaise ?? 0) !== cmd.paidPaise) return false;
  const stored = first.lines ?? [];
  return (
    stored.length === cmd.lines.length &&
    cmd.lines.every((line, i) => {
      const have = stored[i];
      return have.itemId.toString() === line.itemId && have.qty === line.qtyMilli && have.ratePaise === line.ratePaise;
    })
  );
}
