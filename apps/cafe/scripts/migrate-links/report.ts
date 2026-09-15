/**
 * CB-DL-1 S4 — the census report shape shared by census-orders.ts and
 * census-refs.ts, plus the two output helpers (screen summary + JSON file).
 * Pure/data-only: no DB or fs import beyond node:fs for writeReport.
 */
import { writeFileSync } from "node:fs";

// ── Shared shapes ────────────────────────────────────────────────────────
export interface RefShapeBuckets {
  objectId: number;
  hex: number;
  hexNonCanonical: number;
  otherString: number;
  absent: number;
  otherType: number;
}

export interface OrphanSample {
  count: number;
  samples: string[];
}

export interface OrdersCensus {
  total: number;
  ledgerShaped: number;
  v1Shaped: number;
  customerId: RefShapeBuckets;
  customerIdOrphans: OrphanSample;
  productId: RefShapeBuckets;
  productIdOrphans: OrphanSample;
  tableNo: { present: number; unmatched: number; unmatchedLabels: string[] };
  receiver: {
    exactOneActiveStaff: number;
    ambiguous: number;
    noMatch: number;
    absent: number;
    unmatchedNames: string[];
  };
  sourceRequestIds: {
    docsWithField: number;
    totalIds: number;
    orphans: number;
    emptyArrayDocs: number;
    // C34: a TYPE signal, independent of `orphans` — canonicalHex/membership
    // treats a hex STRING and an ObjectId as the same referent, so a String-
    // typed id can be orphans:0 (it resolves) yet still be the wrong BSON
    // type for the Order model's cast query (Order.findOne({sourceRequestIds:
    // hex}) misses it entirely) and for the CAS accept-fence's {$ne: hex}
    // guard, which then reports an already-claimed request as unclaimed —
    // letting it be accepted twice. Never derived from canonicalHex/orphans.
    notObjectId: number;
  };
}

export interface DuePaymentsCensus {
  customerId: RefShapeBuckets;
  customerIdOrphans: OrphanSample;
  multiSpellingCustomers: number;
}

export interface CategoryRefBucket {
  count: number;
  sample: string[];
}

export interface ProductsCensus {
  total: number;
  inactive: number;
  categoryNoDoc: { count: number; names: string[] };
  categoryCaseMismatch: { count: number; names: string[] };
  categoryNameCollisions: string[][];
  // Post-D-A buckets (CB-DL-2): categoryId is now the link, category is the
  // legacy string path a product may still carry mid-migration.
  categoryIdMissing: CategoryRefBucket;
  categoryIdOrphan: CategoryRefBucket;
  categoryIdNotObjectId: CategoryRefBucket;
  legacyCategoryField: CategoryRefBucket;
  indexes: { category_1: boolean; categoryId_1: boolean };
}

export interface OrderRequestsCensus {
  productId: RefShapeBuckets;
  productIdOrphans: OrphanSample;
  tableNo: { present: number; unmatched: number };
  acceptedOrderId: { present: number; unmatched: number };
}

export interface PromoRedemptionsCensus {
  requestId: RefShapeBuckets;
  requestIdOrphans: OrphanSample;
  orderId: { present: number; unmatched: number };
}

export interface PrintJobsCensus {
  orderId: { present: number; unmatched: number };
}

export interface TablesCensus {
  currentOrderId: { present: number; missingOrder: number; nonOpenOrder: number };
}

export interface CustomersCensus {
  appliedOrders: { totalIds: number; unmatched: number };
}

// The apply pipeline's own step results (scripts/migrate-links/apply-run.ts),
// carried loosely here (report.ts stays data-only, no import of apply-run's
// richer types) to avoid a dependency cycle between the two modules.
export interface ApplyStepsSummary {
  categories: {
    scanned: number;
    alreadyObjectId: number;
    matched: number;
    skippedNoDoc: string[];
    skippedCollision: string[][];
    created: string[];
    modified: number;
  };
  reset: { deleted: Record<string, number>; tablesReleased: number; reservedKept: number } | null;
  dropLegacy: { refused: boolean; unset: number; indexDropped: boolean } | null;
}

export interface CensusReport {
  meta: { db: string; at: string; dryRun: boolean; script: "migrate-links"; version: 1 };
  orders: OrdersCensus;
  duepayments: DuePaymentsCensus;
  products: ProductsCensus;
  orderrequests: OrderRequestsCensus;
  promoredemptions: PromoRedemptionsCensus;
  printjobs: PrintJobsCensus;
  tables: TablesCensus;
  customers: CustomersCensus;
  apply?: { steps: ApplyStepsSummary; backupPath: string | null; resetList: string[] | null; resetRefused?: boolean };
  postCensus?: {
    orders: OrdersCensus;
    duepayments: DuePaymentsCensus;
    products: ProductsCensus;
    orderrequests: OrderRequestsCensus;
    promoredemptions: PromoRedemptionsCensus;
    printjobs: PrintJobsCensus;
    tables: TablesCensus;
    customers: CustomersCensus;
  };
}

function line(label: string, value: string | number): string {
  return `  ${label.padEnd(38, ".")} ${value}`;
}

// Cap on how many names renderSummary prints for a name list (unmatched /
// created categories) — keeps a large catalogue's terminal output readable
// while still giving the operator enough to act on (report.ts §C6).
const NAME_LIST_DISPLAY_CAP = 15;

function nameList(names: string[]): string {
  if (names.length === 0) return "(none)";
  const shown = names.slice(0, NAME_LIST_DISPLAY_CAP).join(", ");
  const remaining = names.length - NAME_LIST_DISPLAY_CAP;
  return remaining > 0 ? `${shown} (+${remaining} more)` : shown;
}

/** One screen, aligned lines — meant for a terminal, not machine parsing
 * (the JSON file from writeReport is the machine-readable copy). */
export function renderSummary(r: CensusReport): string {
  const out: string[] = [];
  out.push(`Link census — ${r.meta.db} @ ${r.meta.at}`);
  out.push("");
  out.push("orders");
  out.push(line("total", r.orders.total));
  out.push(line("ledger-shaped / v1-shaped", `${r.orders.ledgerShaped} / ${r.orders.v1Shaped}`));
  out.push(
    line(
      "customerId objectId/hex/nonCanon/other/absent",
      `${r.orders.customerId.objectId}/${r.orders.customerId.hex}/${r.orders.customerId.hexNonCanonical}/${r.orders.customerId.otherString}/${r.orders.customerId.absent}`,
    ),
  );
  out.push(line("customerId orphans", r.orders.customerIdOrphans.count));
  out.push(
    line(
      "items.productId objectId/hex/nonCanon/other/absent",
      `${r.orders.productId.objectId}/${r.orders.productId.hex}/${r.orders.productId.hexNonCanonical}/${r.orders.productId.otherString}/${r.orders.productId.absent}`,
    ),
  );
  out.push(line("items.productId orphans", r.orders.productIdOrphans.count));
  out.push(line("tableNo present/unmatched", `${r.orders.tableNo.present}/${r.orders.tableNo.unmatched}`));
  out.push(
    line(
      "receiver exact/ambiguous/none/absent",
      `${r.orders.receiver.exactOneActiveStaff}/${r.orders.receiver.ambiguous}/${r.orders.receiver.noMatch}/${r.orders.receiver.absent}`,
    ),
  );
  out.push(
    line(
      "sourceRequestIds docs/ids/orphans/emptyArr",
      `${r.orders.sourceRequestIds.docsWithField}/${r.orders.sourceRequestIds.totalIds}/${r.orders.sourceRequestIds.orphans}/${r.orders.sourceRequestIds.emptyArrayDocs}`,
    ),
  );
  out.push("");
  out.push("duepayments");
  out.push(
    line(
      "customerId objectId/hex/nonCanon/other/absent",
      `${r.duepayments.customerId.objectId}/${r.duepayments.customerId.hex}/${r.duepayments.customerId.hexNonCanonical}/${r.duepayments.customerId.otherString}/${r.duepayments.customerId.absent}`,
    ),
  );
  out.push(line("customerId orphans", r.duepayments.customerIdOrphans.count));
  out.push(line("customers under 2+ spellings", r.duepayments.multiSpellingCustomers));
  out.push("");
  out.push("products");
  out.push(line("total / inactive", `${r.products.total} / ${r.products.inactive}`));
  out.push(line("category names with no Category doc", r.products.categoryNoDoc.count));
  out.push(line("products matching a category case/space-only", r.products.categoryCaseMismatch.count));
  out.push(line("category name collisions (groups)", r.products.categoryNameCollisions.length));
  out.push(line("categoryId missing", r.products.categoryIdMissing.count));
  out.push(line("categoryId orphan", r.products.categoryIdOrphan.count));
  out.push(line("categoryId not an ObjectId", r.products.categoryIdNotObjectId.count));
  out.push(line("legacy category field still present", r.products.legacyCategoryField.count));
  out.push(
    line(
      "indexes category_1/categoryId_1",
      `${r.products.indexes.category_1}/${r.products.indexes.categoryId_1}`,
    ),
  );
  out.push("");
  out.push("orderrequests");
  out.push(line("items.productId orphans", r.orderrequests.productIdOrphans.count));
  out.push(
    line("tableNo present/unmatched", `${r.orderrequests.tableNo.present}/${r.orderrequests.tableNo.unmatched}`),
  );
  out.push(
    line(
      "acceptedOrderId present/unmatched",
      `${r.orderrequests.acceptedOrderId.present}/${r.orderrequests.acceptedOrderId.unmatched}`,
    ),
  );
  out.push("");
  out.push("promoredemptions");
  out.push(line("requestId orphans", r.promoredemptions.requestIdOrphans.count));
  out.push(
    line("orderId present/unmatched", `${r.promoredemptions.orderId.present}/${r.promoredemptions.orderId.unmatched}`),
  );
  out.push("");
  out.push("printjobs");
  out.push(line("orderId present/unmatched", `${r.printjobs.orderId.present}/${r.printjobs.orderId.unmatched}`));
  out.push("");
  out.push("tables");
  out.push(
    line(
      "currentOrderId present/missing/non-open",
      `${r.tables.currentOrderId.present}/${r.tables.currentOrderId.missingOrder}/${r.tables.currentOrderId.nonOpenOrder}`,
    ),
  );
  out.push("");
  out.push("customers");
  out.push(
    line("appliedOrders total/unmatched", `${r.customers.appliedOrders.totalIds}/${r.customers.appliedOrders.unmatched}`),
  );

  if (r.apply) {
    out.push("");
    out.push("apply");
    out.push(line("backup archive", r.apply.backupPath ?? "(none)"));
    out.push(line("reset list", r.apply.resetList ? r.apply.resetList.join(",") : "(none)"));
    if (r.apply.resetRefused) {
      out.push(line("reset refused", "yes (category back-fill was incomplete)"));
    }
    out.push(
      line(
        "categories scanned/matched/alreadyObjectId/modified",
        `${r.apply.steps.categories.scanned}/${r.apply.steps.categories.matched}/${r.apply.steps.categories.alreadyObjectId}/${r.apply.steps.categories.modified}`,
      ),
    );
    out.push(line("categories created", r.apply.steps.categories.created.length));
    out.push(line("categories created (names)", nameList(r.apply.steps.categories.created)));
    out.push(line("categories skipped (no doc)", r.apply.steps.categories.skippedNoDoc.length));
    out.push(line("categories skipped (no doc, names)", nameList(r.apply.steps.categories.skippedNoDoc)));
    out.push(line("categories skipped (collision)", r.apply.steps.categories.skippedCollision.length));
    if (r.apply.steps.reset) {
      out.push(line("reset tables released", r.apply.steps.reset.tablesReleased));
      out.push(line("reset tables reserved (left alone)", r.apply.steps.reset.reservedKept));
    }
    if (r.apply.steps.dropLegacy) {
      out.push(
        line(
          "drop-legacy-category refused/unset/indexDropped",
          `${r.apply.steps.dropLegacy.refused}/${r.apply.steps.dropLegacy.unset}/${r.apply.steps.dropLegacy.indexDropped}`,
        ),
      );
    }
  }

  if (r.postCensus) {
    out.push("");
    out.push("postCensus.products");
    out.push(line("categoryId missing", r.postCensus.products.categoryIdMissing.count));
    out.push(line("categoryId orphan", r.postCensus.products.categoryIdOrphan.count));
    out.push(line("categoryId not an ObjectId", r.postCensus.products.categoryIdNotObjectId.count));
    out.push(line("legacy category field still present", r.postCensus.products.legacyCategoryField.count));

    // The runbook's "0 remaining string-shaped refs" check (C2) — the same
    // hex/hexNonCanonical/otherString buckets the dry-run summary already
    // prints above, repeated here for the link collections a reset can leave
    // untouched, so this check can be satisfied from the terminal alone.
    out.push("");
    out.push("postCensus (String-shaped link refs remaining)");
    out.push(
      line(
        "orders.customerId hex/nonCanon/other",
        `${r.postCensus.orders.customerId.hex}/${r.postCensus.orders.customerId.hexNonCanonical}/${r.postCensus.orders.customerId.otherString}`,
      ),
    );
    out.push(
      line(
        "orders.items.productId hex/nonCanon/other",
        `${r.postCensus.orders.productId.hex}/${r.postCensus.orders.productId.hexNonCanonical}/${r.postCensus.orders.productId.otherString}`,
      ),
    );
    out.push(
      line(
        "duepayments.customerId hex/nonCanon/other",
        `${r.postCensus.duepayments.customerId.hex}/${r.postCensus.duepayments.customerId.hexNonCanonical}/${r.postCensus.duepayments.customerId.otherString}`,
      ),
    );
    out.push(
      line(
        "orderrequests.items.productId hex/nonCanon/other",
        `${r.postCensus.orderrequests.productId.hex}/${r.postCensus.orderrequests.productId.hexNonCanonical}/${r.postCensus.orderrequests.productId.otherString}`,
      ),
    );
    out.push(
      line(
        "promoredemptions.requestId hex/nonCanon/other",
        `${r.postCensus.promoredemptions.requestId.hex}/${r.postCensus.promoredemptions.requestId.hexNonCanonical}/${r.postCensus.promoredemptions.requestId.otherString}`,
      ),
    );
  }

  return out.join("\n");
}

/** Writes the full report as 2-space-indented JSON. */
export function writeReport(path: string, r: CensusReport): void {
  writeFileSync(path, JSON.stringify(r, null, 2));
}
