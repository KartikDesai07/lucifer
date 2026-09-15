/**
 * CB-DL-1 S4 — read-only census of every collection besides "orders":
 * duepayments, products, orderrequests, promoredemptions, printjobs, tables,
 * customers. RAW DRIVER ONLY, same discipline as census-orders.ts (which
 * owns the shared classify/orphan/normalize helpers this file imports).
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import {
  addToBuckets,
  addOrphan,
  canonicalHex,
  emptyBuckets,
  newOrphanSample,
  normalizeName,
  type ParentSets,
  type RawDoc,
} from "./census-orders";
import type {
  DuePaymentsCensus,
  ProductsCensus,
  OrderRequestsCensus,
  PromoRedemptionsCensus,
  PrintJobsCensus,
  TablesCensus,
  CustomersCensus,
} from "./report";

// The one status value that means "still an open bill" (packages/shared's
// ORDER_STATUSES = Pending/Completed/Cancelled) — a table's currentOrderId
// should never point at a Completed/Cancelled order.
const OPEN_ORDER_STATUSES = ["Pending"];

export async function censusDuePayments(db: Db, parents: ParentSets): Promise<DuePaymentsCensus> {
  const customerId = emptyBuckets();
  const customerIdOrphans = newOrphanSample();
  const spellingsByCanonical = new Map<string, Set<string>>();

  for await (const doc of db.collection<RawDoc>("duepayments").find({})) {
    addToBuckets(customerId, doc.customerId);
    const canonical = canonicalHex(doc.customerId);
    // No type gate here (review round 1): the orphan check must cover an
    // ObjectId-typed customerId too — after DL-3's apply this collection WILL
    // hold ObjectIds, and the post-apply census is what proves no link broke.
    // Mirrors the orders census. A mixed collection (ObjectId + hex string for
    // the same customer) counts as two spellings, which is exactly the
    // partially-migrated state the owner must see.
    if (canonical) {
      if (!parents.customerIds.has(canonical)) {
        addOrphan(customerIdOrphans, String(doc._id));
      }
      const spellings = spellingsByCanonical.get(canonical) ?? new Set<string>();
      spellings.add(typeof doc.customerId === "string" ? doc.customerId : `ObjectId(${canonical})`);
      spellingsByCanonical.set(canonical, spellings);
    }
  }

  let multiSpellingCustomers = 0;
  for (const spellings of spellingsByCanonical.values()) {
    if (spellings.size > 1) multiSpellingCustomers += 1;
  }

  return { customerId, customerIdOrphans, multiSpellingCustomers };
}

// Cap on how many offending _ids the new post-D-A buckets keep as a sample —
// mirrors ORPHAN_SAMPLE_LIMIT in census-orders.ts (defined locally here since
// that constant is not exported: these buckets are a products-only concern).
const CATEGORY_REF_SAMPLE_LIMIT = 20;

function addCategoryRefSample(bucket: { count: number; sample: string[] }, id: string): void {
  bucket.count += 1;
  if (bucket.sample.length < CATEGORY_REF_SAMPLE_LIMIT) bucket.sample.push(id);
}

export async function censusProducts(db: Db, parents: ParentSets): Promise<ProductsCensus> {
  let total = 0;
  let inactive = 0;
  const namesWithNoDoc = new Set<string>();
  const caseMismatchNames = new Set<string>();
  const categoryIdMissing = { count: 0, sample: [] as string[] };
  const categoryIdOrphan = { count: 0, sample: [] as string[] };
  const categoryIdNotObjectId = { count: 0, sample: [] as string[] };
  const legacyCategoryField = { count: 0, sample: [] as string[] };

  for await (const doc of db
    .collection<RawDoc>("products")
    .find({}, { projection: { isActive: 1, category: 1, categoryId: 1 } })) {
    total += 1;
    if (doc.isActive === false) inactive += 1;

    // The legacy name-bucket check STAYS byte-identical to the pre-D-A
    // behaviour: an absent `category` field must never count as "no doc" —
    // a fully migrated product carries no `category` key at all.
    if (typeof doc.category === "string") {
      addCategoryRefSample(legacyCategoryField, String(doc._id));
      if (!parents.categoryNames.has(doc.category)) {
        const norm = normalizeName(doc.category);
        const group = parents.categoryNormalizedNames.get(norm);
        if (group && group.length > 0) {
          caseMismatchNames.add(doc.category);
        } else {
          namesWithNoDoc.add(doc.category);
        }
      }
    }

    // Post-D-A link check: categoryId is the real link now. categoryIdNotObjectId
    // is a TYPE check (instanceof ObjectId) — a hex-shaped STRING categoryId is
    // still not the ObjectId type the schema expects, so it counts here, not as
    // an orphan. Once a value IS an ObjectId instance, canonicalHex is used for
    // the parent-set membership check (never instanceof) so a case-varied id
    // stays a hexNonCanonical concern elsewhere, never a false orphan here.
    if (doc.categoryId === null || doc.categoryId === undefined) {
      addCategoryRefSample(categoryIdMissing, String(doc._id));
    } else if (!(doc.categoryId instanceof ObjectId)) {
      addCategoryRefSample(categoryIdNotObjectId, String(doc._id));
    } else {
      const canonical = canonicalHex(doc.categoryId);
      if (canonical && !parents.categoryIds.has(canonical)) {
        addCategoryRefSample(categoryIdOrphan, String(doc._id));
      }
    }
  }

  const categoryNameCollisions: string[][] = [];
  for (const group of parents.categoryNormalizedNames.values()) {
    if (group.length > 1) categoryNameCollisions.push([...group]);
  }

  const productIndexes = await db.collection("products").indexes();
  const indexNames = new Set(productIndexes.map((idx) => idx.name));

  return {
    total,
    inactive,
    categoryNoDoc: { count: namesWithNoDoc.size, names: [...namesWithNoDoc] },
    categoryCaseMismatch: { count: caseMismatchNames.size, names: [...caseMismatchNames] },
    categoryNameCollisions,
    categoryIdMissing,
    categoryIdOrphan,
    categoryIdNotObjectId,
    legacyCategoryField,
    indexes: {
      category_1: indexNames.has("category_1"),
      categoryId_1: indexNames.has("categoryId_1"),
    },
  };
}

export async function censusOrderRequests(db: Db, parents: ParentSets): Promise<OrderRequestsCensus> {
  const productId = emptyBuckets();
  const productIdOrphans = newOrphanSample();
  let tableNoPresent = 0;
  let tableNoUnmatched = 0;
  let acceptedPresent = 0;
  let acceptedUnmatched = 0;

  for await (const doc of db.collection<RawDoc>("orderrequests").find({})) {
    const items: unknown[] = Array.isArray(doc.items) ? doc.items : [];
    let hasOrphan = false;
    for (const item of items) {
      const pid = (item as { productId?: unknown } | null)?.productId;
      addToBuckets(productId, pid);
      const pidCanonical = canonicalHex(pid);
      if (pidCanonical && !parents.productIds.has(pidCanonical)) {
        hasOrphan = true;
      }
    }
    if (hasOrphan) addOrphan(productIdOrphans, String(doc._id));

    if (typeof doc.tableNo === "string") {
      tableNoPresent += 1;
      if (!parents.tableNos.has(doc.tableNo)) tableNoUnmatched += 1;
    }

    if (typeof doc.acceptedOrderId === "string") {
      acceptedPresent += 1;
      if (!parents.orderIds.has(doc.acceptedOrderId)) acceptedUnmatched += 1;
    }
  }

  return {
    productId,
    productIdOrphans,
    tableNo: { present: tableNoPresent, unmatched: tableNoUnmatched },
    acceptedOrderId: { present: acceptedPresent, unmatched: acceptedUnmatched },
  };
}

export async function censusPromoRedemptions(db: Db, parents: ParentSets): Promise<PromoRedemptionsCensus> {
  const requestId = emptyBuckets();
  const requestIdOrphans = newOrphanSample();
  let orderIdPresent = 0;
  let orderIdUnmatched = 0;

  for await (const doc of db.collection<RawDoc>("promoredemptions").find({})) {
    addToBuckets(requestId, doc.requestId);
    const canonical = canonicalHex(doc.requestId);
    if (canonical && !parents.orderRequestIds.has(canonical)) {
      addOrphan(requestIdOrphans, String(doc._id));
    }
    if (typeof doc.orderId === "string") {
      orderIdPresent += 1;
      if (!parents.orderIds.has(doc.orderId)) orderIdUnmatched += 1;
    }
  }

  return {
    requestId,
    requestIdOrphans,
    orderId: { present: orderIdPresent, unmatched: orderIdUnmatched },
  };
}

export async function censusPrintJobs(db: Db, parents: ParentSets): Promise<PrintJobsCensus> {
  let present = 0;
  let unmatched = 0;
  for await (const doc of db.collection<RawDoc>("printjobs").find({}, { projection: { orderId: 1 } })) {
    if (typeof doc.orderId === "string") {
      present += 1;
      if (!parents.orderIds.has(doc.orderId)) unmatched += 1;
    }
  }
  return { orderId: { present, unmatched } };
}

export async function censusTables(db: Db, parents: ParentSets): Promise<TablesCensus> {
  let present = 0;
  let missingOrder = 0;
  let nonOpenOrder = 0;

  for await (const doc of db.collection<RawDoc>("tables").find({}, { projection: { currentOrderId: 1 } })) {
    if (typeof doc.currentOrderId !== "string" || doc.currentOrderId.length === 0) continue;
    present += 1;
    // The parent set (built once) already knows whether this orderId exists
    // at all — only a real hit needs the extra round trip for its status.
    if (!parents.orderIds.has(doc.currentOrderId)) {
      missingOrder += 1;
      continue;
    }
    const order = await db
      .collection<RawDoc>("orders")
      .findOne({ orderId: doc.currentOrderId }, { projection: { status: 1 } });
    if (!order) {
      missingOrder += 1;
    } else if (!OPEN_ORDER_STATUSES.includes(String(order.status))) {
      nonOpenOrder += 1;
    }
  }

  return { currentOrderId: { present, missingOrder, nonOpenOrder } };
}

export async function censusCustomers(db: Db, parents: ParentSets): Promise<CustomersCensus> {
  let totalIds = 0;
  let unmatched = 0;
  // appliedOrders is `select:false` in the schema, which only affects
  // Mongoose reads — the raw driver still sees the field.
  for await (const doc of db.collection<RawDoc>("customers").find({}, { projection: { appliedOrders: 1 } })) {
    const ids: unknown[] = Array.isArray(doc.appliedOrders) ? doc.appliedOrders : [];
    for (const id of ids) {
      totalIds += 1;
      if (typeof id !== "string" || !parents.orderIds.has(id)) unmatched += 1;
    }
  }
  return { appliedOrders: { totalIds, unmatched } };
}
