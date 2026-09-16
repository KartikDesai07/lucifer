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
  return lines;
}
