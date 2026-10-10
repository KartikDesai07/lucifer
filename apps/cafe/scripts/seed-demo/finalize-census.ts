/**
 * BSON-type census for the seeded documents. Every id path must hold a real
 * ObjectId, never a hex STRING: a String-typed `sourceRequestIds` makes the
 * double-accept fence blind (a `{$ne}` CAS and the sparse-unique index compare
 * BSON values, and "abc…" ≠ ObjectId("abc…")), and string productIds break every
 * join the reports do. The seeder writes through the models (casting happens
 * there) — this proves it on the stored data, the same check the migrate-links
 * census runs. (console output is intentional — ops CLI script, not app code.)
 */
import { Order } from "@/models/Order";
import { OrderRequest } from "@/models/OrderRequest";
import { DuePayment } from "@/models/DuePayment";
import { Table } from "@/models/Table";
import { invoiceCounterKey } from "@/models/Counter";
import { isTaxInvoice } from "@/lib/gst-invoice";

export interface CensusLine {
  pass: boolean;
  message: string;
}

const NOT_OBJECT_ID = { $not: { $type: "objectId" } } as const;

export async function objectIdCensus(): Promise<CensusLine[]> {
  const lines: CensusLine[] = [];
  const push = (count: number, what: string) =>
    lines.push({ pass: count === 0, message: `ObjectId census: ${what} (${count} offending documents)` });

  push(
    await Order.countDocuments({ items: { $elemMatch: { productId: NOT_OBJECT_ID } } }),
    "every Order items[].productId is a BSON ObjectId",
  );
  push(
    await Order.countDocuments({ customerId: { $exists: true, ...NOT_OBJECT_ID } }),
    "every present Order.customerId is a BSON ObjectId",
  );
  push(
    await Order.countDocuments({ staffId: { $exists: true, ...NOT_OBJECT_ID } }),
    "every present Order.staffId is a BSON ObjectId",
  );
  push(
    await Order.countDocuments({ sourceRequestIds: { $exists: true, $elemMatch: NOT_OBJECT_ID } }),
    "every Order.sourceRequestIds entry is a BSON ObjectId",
  );
  push(
    await Order.countDocuments({ sourceRequestIds: { $size: 0 } }),
    "no Order carries an EMPTY sourceRequestIds array (the sparse-unique fence needs it absent)",
  );
  push(
    await Order.countDocuments({ voids: { $elemMatch: { productId: NOT_OBJECT_ID } } }),
    "every Order voids[].productId is a BSON ObjectId",
  );
  push(
    await OrderRequest.countDocuments({ items: { $elemMatch: { productId: NOT_OBJECT_ID } } }),
    "every OrderRequest items[].productId is a BSON ObjectId",
  );
  push(
    await DuePayment.countDocuments({ customerId: NOT_OBJECT_ID }),
    "every DuePayment.customerId is a BSON ObjectId",
  );
  push(
    await Table.countDocuments({ areaId: { $exists: true, ...NOT_OBJECT_ID } }),
    "every present Table.areaId is a BSON ObjectId",
  );
  return lines;
}

type TaxedOrder = Parameters<typeof isTaxInvoice>[0];

interface InvoicedOrder extends TaxedOrder {
  status: string;
  invoiceNumber?: number | null;
  invoiceFy?: number | null;
}

/**
 * GST invoice serials (print customization S10): both fields or neither on every order, each financial year's
 * serials run 1..n with no gap, and its `invoice-<yyzz>` counter holds exactly the last one (the next live GST sale
 * continues the series instead of colliding with a seeded number).
 */
export function invoiceSeedLines(orders: ReadonlyArray<InvoicedOrder>, counterByKey: ReadonlyMap<string, number>): CensusLine[] {
  const lines: CensusLine[] = [];
  const lonely = orders.filter((o) => (o.invoiceNumber == null) !== (o.invoiceFy == null)).length;
  lines.push({ pass: lonely === 0, message: `invoice: invoiceNumber and invoiceFy are set together (${lonely} offending orders)` });
  // S10 review M4: every paid GST bill carries its serial (the seed never leaves a "without" row on the GST report).
  const missing = orders.filter((o) => o.status === "Completed" && isTaxInvoice(o) && o.invoiceNumber == null).length;
  lines.push({ pass: missing === 0, message: `invoice: every paid GST bill carries its serial (${missing} without)` });

  const serialsByFy = new Map<number, number[]>();
  for (const o of orders) {
    if (o.invoiceNumber == null || o.invoiceFy == null) continue;
    const arr = serialsByFy.get(o.invoiceFy) ?? [];
    arr.push(o.invoiceNumber);
    serialsByFy.set(o.invoiceFy, arr);
  }
  for (const [fy, serials] of serialsByFy) {
    const sorted = [...serials].sort((a, b) => a - b);
    lines.push({ pass: sorted.every((n, i) => n === i + 1), message: `invoice FY ${fy}: serials contiguous from 1 (${sorted.length})` });
    const key = invoiceCounterKey(fy);
    const stored = counterByKey.get(key);
    lines.push({ pass: stored === sorted[sorted.length - 1], message: `counter ${key} (${stored}) === last serial (${sorted[sorted.length - 1]})` });
  }
  return lines;
}
