import type { BillBlockType, KotBlockType } from "@pos/shared/print-template";

// Classic's legacy markup wraps runs of lines in a container (the centred header, the spaced meta list, the
// totals list). A template is a flat block list, so the engine restores those wrappers by run-length grouping:
// consecutive visible blocks of the same group share one wrapper, an ungrouped block stands alone.

export type ClassicGroup = "billHeader" | "billMeta" | "billTotals" | "kotMeta";

// Whole literal class names (Tailwind scans source text). Each is the legacy wrapper's exact className.
export const CLASSIC_GROUP_CLASS: Record<ClassicGroup, string> = {
  billHeader: "text-center", // OrderReceipt: the header block
  billMeta: "space-y-0.5", // OrderReceipt: bill no / order / date / table / customer / staff
  billTotals: "space-y-0.5", // OrderReceipt: subtotal .. due
  kotMeta: "space-y-0.5 text-[0.93em]", // KOTReceipt: order / table / time / staff / reason
};

export const CLASSIC_BILL_GROUP: Partial<Record<BillBlockType, ClassicGroup>> = {
  logo: "billHeader",
  name: "billHeader",
  tagline: "billHeader",
  address: "billHeader",
  phone: "billHeader",
  gstin: "billHeader",
  fssai: "billHeader",
  headerText: "billHeader",
  billNo: "billMeta",
  // Sits between billNo and orderId: ungrouped, it would split the meta wrapper in two.
  token: "billMeta",
  orderId: "billMeta",
  dateTime: "billMeta",
  table: "billMeta",
  customer: "billMeta",
  cashier: "billMeta",
  cancelReason: "billMeta",
  subtotal: "billTotals",
  discount: "billTotals",
  taxes: "billTotals",
  charges: "billTotals",
  // Sits between the charges and the total: ungrouped, it would split the totals wrapper in two.
  loyalty: "billTotals",
  total: "billTotals",
  taxIncluded: "billTotals",
  payment: "billTotals",
  due: "billTotals",
};

export const CLASSIC_KOT_GROUP: Partial<Record<KotBlockType, ClassicGroup>> = {
  orderId: "kotMeta",
  table: "kotMeta",
  time: "kotMeta",
  staff: "kotMeta",
  voidReason: "kotMeta",
};

export interface BlockRun<B> {
  group: string | undefined;
  blocks: B[];
}

// Consecutive blocks with the SAME defined group form one run; an ungrouped block is its own run. Callers pass
// only the visible blocks, so a wrapper is emitted iff its run holds at least one block. The group key is any
// string: every design names its own groups (slip-designs.ts), Classic's are the ones above.
export function groupRuns<B>(blocks: readonly B[], groupOf: (block: B) => string | undefined): BlockRun<B>[] {
  const runs: BlockRun<B>[] = [];
  for (const block of blocks) {
    const group = groupOf(block);
    const last = runs[runs.length - 1];
    if (group !== undefined && last !== undefined && last.group === group) {
      last.blocks.push(block);
    } else {
      runs.push({ group, blocks: [block] });
    }
  }
  return runs;
}
