import type { CreateStockEntryInput } from "@/schemas";
import type { StoredEntry } from "./entries-write";
import { purchaseSameAs } from "./purchase";

// Inventory lite (Slices 4-6): is a re-sent entry the SAME one its clientRef's first row recorded? Pure, no Mongoose,
// and only a TYPE import of entries-write (no runtime cycle). entries-write.ts answers a replay with the first row when
// this says yes, and 409 when it says no. It is only the same when the SAME account sends the SAME entry to a row that
// still counts: an edited re-send (same sheet, same ref) or the ref of a deleted row is not, so it can never be taken
// as a second entry (it would move stock or dues twice) nor silently answered as one it is not.

export type ReplayCommand = CreateStockEntryInput & { createdById: string };

export function sameEntry(first: StoredEntry, cmd: ReplayCommand): boolean {
  if (first.deletedAt || first.createdById !== cmd.createdById || first.kind !== cmd.kind || first.date !== cmd.date) return false;
  if ((first.note ?? "") !== (cmd.note ?? "")) return false;
  if (cmd.kind === "purchase") return purchaseSameAs(first, cmd);
  // A payment (Slice 6): the same supplier and the same amount (stored as totalPaise; its due is minus that).
  if (cmd.kind === "payment") return first.supplierId?.toString() === cmd.supplierId && first.totalPaise === cmd.amountPaise;
  const line = first.lines?.[0];
  if (line === undefined || line.itemId.toString() !== cmd.itemId) return false;
  return cmd.kind === "waste" ? line.qty === -cmd.qtyMilli && first.reason === cmd.reason : line.counted === cmd.countedMilli;
}
