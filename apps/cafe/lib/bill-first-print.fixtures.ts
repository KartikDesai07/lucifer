import { firstBillPrintFilter, type BillFirstPrintDeps, type StampedOrder } from "@/lib/bill-first-print";

// Shared by bill-first-print.test.ts and bill-first-print-payload.test.ts (not a test file: it is not in the testChain).

export const ID = "64b7f0c2a1d2e3f4a5b6c7d8";
export const NOW_MS = Date.parse("2026-10-04T08:30:00.000Z");
export const STORED = new Date("2026-10-04T08:00:00.000Z");
export const OTHER = new Date("2026-10-04T08:20:00.000Z");
export const TOTAL = 240;

export interface Doc { total: number; billFirstPrintedAt?: Date; billFirstPrintedTotal?: number; cancelled?: boolean }
export interface Calls { read: string[]; cas: Array<{ id: string; seen: StampedOrder; at: Date }> }

// A fake order document. readBill answers like the real read (null once cancelled); casStamp applies the REAL filter's
// four conditions to the doc and, on a hit, the real $set (stamp + the total read). `race` runs between the read and
// the CAS: another request changing the doc in that gap.
export function fakeDb(start: Doc | null, race?: (doc: Doc) => void) {
  const doc = start;
  const calls: Calls = { read: [], cas: [] };
  const copy = (d: Doc): StampedOrder => ({ total: d.total, billFirstPrintedAt: d.billFirstPrintedAt, billFirstPrintedTotal: d.billFirstPrintedTotal });
  const deps: BillFirstPrintDeps = {
    readBill: async (id) => {
      calls.read.push(id);
      return doc === null || doc.cancelled ? null : copy(doc);
    },
    casStamp: async (id, seen, at) => {
      calls.cas.push({ id, seen, at });
      if (doc === null) return null;
      if (calls.cas.length === 1) race?.(doc);
      const f = firstBillPrintFilter(id, seen);
      const stampOk = f.billFirstPrintedAt instanceof Date
        ? doc.billFirstPrintedAt?.getTime() === f.billFirstPrintedAt.getTime()
        : doc.billFirstPrintedAt === undefined;
      if (doc.cancelled || doc.total !== f.total || !stampOk) return null;
      doc.billFirstPrintedAt = at;
      doc.billFirstPrintedTotal = seen.total;
      return copy(doc);
    },
  };
  return { deps, calls, doc };
}
