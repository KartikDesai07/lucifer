/**
 * CB-DL-1 S4 — read-only census of the "orders" collection PLUS the shared
 * raw-driver helpers (ref classification + parent-id set builder) that
 * census-refs.ts also imports. RAW DRIVER ONLY (Db from mongodb) — never a
 * Mongoose model, because a schema would cast the very strings this census
 * measures. Orphan checks compare canonical (lower-case) hex, so a
 * case-varied spelling of a real parent is a hexNonCanonical row, not an
 * orphan.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { OrdersCensus, RefShapeBuckets, OrphanSample } from "./report";

// The whole point of this census is to measure whatever is ACTUALLY stored —
// including shapes the schema does not expect — so every collection is read
// through this untyped shape rather than a Mongoose-cast or driver-inferred
// document type. `_id` is spelled out (rather than left to the index
// signature) so the driver's `InferIdType` picks it up as `ObjectId | string`
// instead of collapsing to `never` — a plain document's _id really can be
// either, and the ledger-shaped rows (String `_id` starting "ORD-") are
// exactly what this census is checking for.
export type RawDoc = { _id: ObjectId | string } & Record<string, unknown>;

const HEX_24 = /^[0-9a-fA-F]{24}$/;
const ORPHAN_SAMPLE_LIMIT = 20;

export type RefShapeKind = "objectId" | "hex" | "otherString" | "absent" | "otherType";

export function classifyRef(v: unknown): { kind: RefShapeKind; nonCanonical: boolean } {
  if (v === null || v === undefined) return { kind: "absent", nonCanonical: false };
  if (v instanceof ObjectId) return { kind: "objectId", nonCanonical: false };
  if (typeof v === "string") {
    if (HEX_24.test(v)) return { kind: "hex", nonCanonical: v !== v.toLowerCase() };
    return { kind: "otherString", nonCanonical: false };
  }
  return { kind: "otherType", nonCanonical: false };
}

// Canonical form for a hex-shaped ref (ObjectId or 24-hex string), used for
// EVERY parent-Set membership check and for building the parent Sets
// themselves — an orphan check must never depend on which case the id
// happened to be stored in. `null` for anything that is not hex-shaped at
// all (the caller has already classified those via classifyRef/addToBuckets).
export function canonicalHex(v: unknown): string | null {
  if (v instanceof ObjectId) return v.toHexString();
  if (typeof v === "string" && HEX_24.test(v)) return v.toLowerCase();
  return null;
}

export function emptyBuckets(): RefShapeBuckets {
  return { objectId: 0, hex: 0, hexNonCanonical: 0, otherString: 0, absent: 0, otherType: 0 };
}

export function addToBuckets(buckets: RefShapeBuckets, v: unknown): void {
  const { kind, nonCanonical } = classifyRef(v);
  buckets[kind] += 1;
  if (kind === "hex" && nonCanonical) buckets.hexNonCanonical += 1;
}

export function newOrphanSample(): OrphanSample {
  return { count: 0, samples: [] };
}

export function addOrphan(sample: OrphanSample, id: string): void {
  sample.count += 1;
  if (sample.samples.length < ORPHAN_SAMPLE_LIMIT) sample.samples.push(id);
}

// Normalization for category-name duplicate detection (also used by
// census-refs.ts): trim + collapse inner whitespace + lowercase.
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface ParentSets {
  customerIds: Set<string>;
  productIds: Set<string>;
  tableIds: Set<string>;
  tableNos: Set<string>;
  activeStaffNameCounts: Map<string, number>;
  orderRequestIds: Set<string>;
  orderObjectIds: Set<string>;
  orderIds: Set<string>;
  categoryNames: Set<string>;
  categoryNormalizedNames: Map<string, string[]>;
  categoryIds: Set<string>;
}

async function idSet(db: Db, collection: string): Promise<Set<string>> {
  const set = new Set<string>();
  const cursor = db.collection<RawDoc>(collection).find({}, { projection: { _id: 1 } });
  for await (const doc of cursor) {
    const canonical = canonicalHex(doc._id);
    if (canonical) set.add(canonical);
  }
  return set;
}

/** Builds every parent-id lookup set ONCE, up front, so both census modules
 * classify orphans against the same snapshot of the DB. */
export async function buildParentSets(db: Db): Promise<ParentSets> {
  const customerIds = await idSet(db, "customers");
  const productIds = await idSet(db, "products");

  const tableIds = new Set<string>();
  const tableNos = new Set<string>();
  for await (const doc of db.collection<RawDoc>("tables").find({}, { projection: { _id: 1, tableNo: 1 } })) {
    const canonical = canonicalHex(doc._id);
    if (canonical) tableIds.add(canonical);
    if (typeof doc.tableNo === "string") tableNos.add(doc.tableNo);
  }

  const activeStaffNameCounts = new Map<string, number>();
  for await (const doc of db
    .collection<RawDoc>("staff")
    .find({ isActive: true }, { projection: { name: 1 } })) {
    if (typeof doc.name !== "string") continue;
    activeStaffNameCounts.set(doc.name, (activeStaffNameCounts.get(doc.name) ?? 0) + 1);
  }

  const orderRequestIds = await idSet(db, "orderrequests");

  const orderObjectIds = new Set<string>();
  const orderIds = new Set<string>();
  for await (const doc of db.collection<RawDoc>("orders").find({}, { projection: { _id: 1, orderId: 1 } })) {
    const canonical = canonicalHex(doc._id);
    if (canonical) orderObjectIds.add(canonical);
    if (typeof doc.orderId === "string") orderIds.add(doc.orderId);
  }

  const categoryNames = new Set<string>();
  const categoryNormalizedNames = new Map<string, string[]>();
  const categoryIds = new Set<string>();
  for await (const doc of db.collection<RawDoc>("categories").find({}, { projection: { name: 1 } })) {
    const canonical = canonicalHex(doc._id);
    if (canonical) categoryIds.add(canonical);
    if (typeof doc.name !== "string") continue;
    categoryNames.add(doc.name);
    const norm = normalizeName(doc.name);
    const group = categoryNormalizedNames.get(norm) ?? [];
    group.push(doc.name);
    categoryNormalizedNames.set(norm, group);
  }

  return {
    customerIds,
    productIds,
    tableIds,
    tableNos,
    activeStaffNameCounts,
    orderRequestIds,
    orderObjectIds,
    orderIds,
    categoryNames,
    categoryNormalizedNames,
    categoryIds,
  };
}

const LEDGER_ID_PREFIX = "ORD-";

/** Census of the "orders" collection against the parent sets built above. */
export async function censusOrders(db: Db, parents: ParentSets): Promise<OrdersCensus> {
  let total = 0;
  let ledgerShaped = 0;
  let v1Shaped = 0;
  const customerId = emptyBuckets();
  const customerIdOrphans = newOrphanSample();
  const productId = emptyBuckets();
  const productIdOrphans = newOrphanSample();
  let tableNoPresent = 0;
  let tableNoUnmatched = 0;
  const tableNoUnmatchedLabels = new Set<string>();
  let receiverExact = 0;
  let receiverAmbiguous = 0;
  let receiverNoMatch = 0;
  let receiverAbsent = 0;
  const receiverUnmatchedNames = new Set<string>();
  let sourceReqDocs = 0;
  let sourceReqTotalIds = 0;
  let sourceReqOrphans = 0;
  let sourceReqEmptyArrayDocs = 0;
  let sourceReqNotObjectId = 0;

  const cursor = db.collection<RawDoc>("orders").find({});
  for await (const doc of cursor) {
    total += 1;
    if (typeof doc._id === "string" && doc._id.startsWith(LEDGER_ID_PREFIX)) {
      ledgerShaped += 1;
    } else {
      v1Shaped += 1;
    }

    addToBuckets(customerId, doc.customerId);
    const custCanonical = canonicalHex(doc.customerId);
    if (custCanonical && !parents.customerIds.has(custCanonical)) {
      addOrphan(customerIdOrphans, String(doc.orderId ?? doc._id));
    }

    const items: unknown[] = Array.isArray(doc.items) ? doc.items : [];
    let orderHasProductOrphan = false;
    for (const item of items) {
      const pid = (item as { productId?: unknown } | null)?.productId;
      addToBuckets(productId, pid);
      const pidCanonical = canonicalHex(pid);
      if (pidCanonical && !parents.productIds.has(pidCanonical)) {
        orderHasProductOrphan = true;
      }
    }
    if (orderHasProductOrphan) addOrphan(productIdOrphans, String(doc.orderId ?? doc._id));

    if (typeof doc.tableNo === "string") {
      tableNoPresent += 1;
      if (!parents.tableNos.has(doc.tableNo)) {
        tableNoUnmatched += 1;
        tableNoUnmatchedLabels.add(doc.tableNo);
      }
    }

    if (typeof doc.receiver !== "string" || doc.receiver.length === 0) {
      receiverAbsent += 1;
    } else {
      const count = parents.activeStaffNameCounts.get(doc.receiver) ?? 0;
      if (count === 1) receiverExact += 1;
      else if (count > 1) receiverAmbiguous += 1;
      else {
        receiverNoMatch += 1;
        receiverUnmatchedNames.add(doc.receiver);
      }
    }

    if (Object.hasOwn(doc, "sourceRequestIds")) {
      sourceReqDocs += 1;
      const ids: unknown[] = Array.isArray(doc.sourceRequestIds) ? doc.sourceRequestIds : [];
      if (ids.length === 0) sourceReqEmptyArrayDocs += 1;
      for (const id of ids) {
        sourceReqTotalIds += 1;
        // TYPE signal, deliberately separate from the membership check below:
        // a hex STRING resolves through canonicalHex (orphans stays 0) but is
        // the wrong BSON type for the Order model's cast queries.
        if (!(id instanceof ObjectId)) sourceReqNotObjectId += 1;
        const canonical = canonicalHex(id);
        if (!canonical || !parents.orderRequestIds.has(canonical)) sourceReqOrphans += 1;
      }
    }
  }

  return {
    total,
    ledgerShaped,
    v1Shaped,
    customerId,
    customerIdOrphans,
    productId,
    productIdOrphans,
    tableNo: {
      present: tableNoPresent,
      unmatched: tableNoUnmatched,
      unmatchedLabels: [...tableNoUnmatchedLabels],
    },
    receiver: {
      exactOneActiveStaff: receiverExact,
      ambiguous: receiverAmbiguous,
      noMatch: receiverNoMatch,
      absent: receiverAbsent,
      unmatchedNames: [...receiverUnmatchedNames],
    },
    sourceRequestIds: {
      docsWithField: sourceReqDocs,
      totalIds: sourceReqTotalIds,
      orphans: sourceReqOrphans,
      emptyArrayDocs: sourceReqEmptyArrayDocs,
      notObjectId: sourceReqNotObjectId,
    },
  };
}
