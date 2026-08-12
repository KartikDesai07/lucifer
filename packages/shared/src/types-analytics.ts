// Dues + analytics shapes split out of types.ts (CR1.4) to keep that file
// under the ~300-line guideline once the dues surfaces landed.
import type { SettlementPayMode, DuesReceiptMode } from "./constants";

// One financial record of money collected against a customer's outstanding
// balance — append-only, kept alongside Customer.totalDue with no unit
// conversion (rupees, matching v1's whole-rupee money shape; see
// apps/cafe/models/DuePayment.ts for the storage-side header).
export interface DuePayment {
  _id: string;
  customerId: string;
  amount: number; // rupees, whole-number (v1 money shape, see §0)
  mode: SettlementPayMode;
  note?: string;
  receivedBy: string; // staff name from the session, never client-supplied
  clientRef: string; // idempotency key
  createdAt: string;
  updatedAt: string;
}

// Dues collected over a period (a day's summary / a report range), broken
// down by RECEIPT mode (G7: Cash/Online only — the modes that represent
// money actually arriving). `byMode` is required, not decorative — the
// drawer is physical: ₹500 of dues taken in Cash vs Online changes what is
// in the till.
export interface DuesCollected {
  total: number;
  count: number;
  byMode: Record<DuesReceiptMode, number>;
}
