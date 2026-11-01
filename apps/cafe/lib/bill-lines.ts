// Bill line grouping (owner, 2026-11-02): the same item ordered in different rounds (one cold drink, then another)
// is ONE line on the bill and on the Orders page detail, qty summed ("Cold Drink x2"). PURE and client-safe.
//
// "The same" = everything a bill line prints: the name, the variation, the add-ons (in any order), the "NO ..."
// removals, the instructions, the unit price, and the reward flag with its note. Anything that differs stays its own
// line, so a note or a FREE mark can never land on the wrong dish. The bill's money never comes from these lines (the
// totals are the order's own, lib/receipt.ts): a grouped line's amount is price x qty, the sum of the lines it holds.
// The stored order keeps one line per round (the KOT, voids and the POS cart need them); only the bill's rows group.

/** The fields a bill line prints. */
export interface BillLineSource {
  name: string;
  price: number;
  qty: number;
  variation?: string;
  modifiers?: readonly string[];
  removedModifiers?: readonly string[];
  instructions?: string;
  reward?: boolean;
  note?: string;
}

function billLineKey(line: BillLineSource): string {
  return JSON.stringify([
    line.name,
    line.variation ?? "",
    line.price,
    [...(line.modifiers ?? [])].sort(),
    [...(line.removedModifiers ?? [])].sort(),
    line.instructions ?? "",
    line.reward === true,
    line.note ?? "",
  ]);
}

/** The bill's rows: repeated lines joined at the first one's place, qty added. Returns the SAME array when nothing
 *  repeats, so every bill without a repeat renders exactly as before. Never mutates the input. */
export function billLinesOf<T extends BillLineSource>(items: readonly T[]): readonly T[] {
  const indexByKey = new Map<string, number>();
  const rows: T[] = [];
  for (const item of items) {
    const key = billLineKey(item);
    const at = indexByKey.get(key);
    if (at === undefined) {
      indexByKey.set(key, rows.length);
      rows.push(item);
    } else {
      rows[at] = { ...rows[at], qty: rows[at].qty + item.qty };
    }
  }
  return rows.length === items.length ? items : rows;
}
