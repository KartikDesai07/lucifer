/**
 * CB-DL-2 S4 — orchestrates the `--apply` pipeline (D-C item 13): products
 * back-fill -> reset (if requested) -> drop-legacy (if requested) -> a
 * post-apply census with the SAME census functions the dry run uses, so the
 * report's "before" and "after" numbers come from one code path. RAW DRIVER
 * ONLY — this module only calls the raw-driver apply-* functions and the
 * existing census functions, never a Mongoose model.
 */
import type { Db } from "mongodb";
import type { MigrateArgs } from "./args";
import { applyProductCategories, dropLegacyCategory, APPLY_BATCH_SIZE, type CategoryApplyResult } from "./apply-categories";
import { applyReset } from "./apply-reset";
import { buildParentSets, censusOrders } from "./census-orders";
import {
  censusDuePayments,
  censusProducts,
  censusOrderRequests,
  censusPromoRedemptions,
  censusPrintJobs,
  censusTables,
  censusCustomers,
} from "./census-refs";
import type { CensusReport, RefShapeBuckets } from "./report";

export interface ApplySteps {
  categories: CategoryApplyResult;
  reset: { deleted: Record<string, number>; tablesReleased: number; reservedKept: number } | null;
  dropLegacy: { refused: boolean; unset: number; indexDropped: boolean } | null;
}

export type ApplyPostCensus = Omit<CensusReport, "meta" | "apply" | "postCensus">;

export interface ApplyRunResult {
  steps: ApplySteps;
  resetList: string[] | null;
  postCensus: ApplyPostCensus;
  clean: boolean;
  resetRefused?: boolean;
  // Detail behind the resetCollectionsNowEmpty / linkShapeClean terms of
  // `clean`, so the entry script can NAME the offending collection in its
  // exit-3 reasons instead of only reporting a boolean.
  nonEmptyResetCollections: string[];
  stringShapedCollections: string[];
}

// One entry per link field this apply pipeline can leave String-shaped when
// its owning collection is NOT in --reset — collection name (for the report
// reason) paired with the SAME RefShapeBuckets object the post-apply census
// already produced (never re-derived; read from census-orders.ts /
// census-refs.ts field names directly).
interface LinkShapeCheck {
  collection: string;
  field: string;
  buckets: RefShapeBuckets;
}

function stillStringShaped(buckets: RefShapeBuckets): boolean {
  return buckets.hex + buckets.hexNonCanonical + buckets.otherString > 0;
}

function linkShapeChecks(postCensus: ApplyPostCensus): LinkShapeCheck[] {
  return [
    { collection: "orders", field: "customerId", buckets: postCensus.orders.customerId },
    { collection: "orders", field: "items.productId", buckets: postCensus.orders.productId },
    { collection: "duepayments", field: "customerId", buckets: postCensus.duepayments.customerId },
    { collection: "orderrequests", field: "items.productId", buckets: postCensus.orderrequests.productId },
    { collection: "promoredemptions", field: "requestId", buckets: postCensus.promoredemptions.requestId },
  ];
}

async function runCensus(db: Db): Promise<ApplyPostCensus> {
  const parents = await buildParentSets(db);
  const [orders, duepayments, products, orderrequests, promoredemptions, printjobs, tables, customers] =
    await Promise.all([
      censusOrders(db, parents),
      censusDuePayments(db, parents),
      censusProducts(db, parents),
      censusOrderRequests(db, parents),
      censusPromoRedemptions(db, parents),
      censusPrintJobs(db, parents),
      censusTables(db, parents),
      censusCustomers(db, parents),
    ]);
  return { orders, duepayments, products, orderrequests, promoredemptions, printjobs, tables, customers };
}

/** Runs the full apply pipeline against `db`. `args` gates are assumed
 * already validated by parseMigrateArgs (apply true, reset needs apply,
 * etc.) — this function trusts them. */
export async function runApply(db: Db, args: MigrateArgs): Promise<ApplyRunResult> {
  const categories = await applyProductCategories(db, {
    createMissing: args.createMissingCategories,
    batchSize: APPLY_BATCH_SIZE,
  });

  const backFillIncomplete = categories.skippedNoDoc.length > 0 || categories.skippedCollision.length > 0;

  // C1: a reset must NEVER run on top of an incomplete category back-fill —
  // the unresolved products would be deleted along with the reset collections
  // with no way to recover them. Refuse the reset (write nothing) but still
  // produce a post-census so the report shows the operator what to fix.
  if (args.reset && backFillIncomplete) {
    const postCensus = await runCensus(db);
    return {
      steps: { categories, reset: null, dropLegacy: null },
      resetList: args.reset,
      postCensus,
      clean: false,
      resetRefused: true,
      nonEmptyResetCollections: [],
      stringShapedCollections: [],
    };
  }

  let reset: { deleted: Record<string, number>; tablesReleased: number; reservedKept: number } | null = null;
  const nonEmptyResetCollections: string[] = [];
  if (args.reset) {
    reset = await applyReset(db, args.reset);
    for (const name of args.reset) {
      const remaining = await db.collection(name).countDocuments({});
      if (remaining !== 0) nonEmptyResetCollections.push(name);
    }
  }
  const resetCollectionsNowEmpty = nonEmptyResetCollections.length === 0;

  let dropLegacy: { refused: boolean; unset: number; indexDropped: boolean } | null = null;
  if (args.dropLegacyCategory) {
    dropLegacy = await dropLegacyCategory(db);
  }

  const postCensus = await runCensus(db);

  const noSkips = categories.skippedNoDoc.length === 0 && categories.skippedCollision.length === 0;
  const categoryIdMissingClean = postCensus.products.categoryIdMissing.count === 0;
  const categoryIdResolvedClean =
    postCensus.products.categoryIdOrphan.count === 0 && postCensus.products.categoryIdNotObjectId.count === 0;
  const dropClean = dropLegacy === null || !dropLegacy.refused;

  // C2: a collection that still holds String-shaped link fields must not
  // certify clean — the census already computed these buckets, this just folds
  // them into the verdict.
  // C34: orders.sourceRequestIds carries no RefShapeBuckets — its census is a
  // canonicalHex membership check, which treats a hex STRING and an ObjectId
  // as the same referent (orphans stays 0). Only the notObjectId TYPE count
  // reveals a String-typed array, and it must gate `clean` too: a String entry
  // is invisible to the Order model's cast query, so the double-accept fence
  // (findOne / {$ne} CAS) reports an already-claimed request as unclaimed and
  // the sparse-unique index raises no E11000 — the same request is accepted
  // twice. Verified by live probe on the scratch mongod.
  // The buckets are read UNCONDITIONALLY — never gated on "was this collection
  // in --reset". A successfully reset collection is empty, so every bucket is
  // already 0 (live-probed) and the term is self-satisfying; gating on the
  // reset list instead switched the whole check off for `--reset default`,
  // which names every collection these checks cover — i.e. off for exactly the
  // command DL-3 runs. Un-gated, it stays silent on a clean reset and speaks up
  // only when documents actually survived (a write landing inside the
  // closed-shop window), which is when the operator needs the shape detail.
  const sourceRequestIdsStringShaped = postCensus.orders.sourceRequestIds.notObjectId > 0;

  const stringShapedCollections = [
    ...new Set([
      ...linkShapeChecks(postCensus)
        .filter((check) => stillStringShaped(check.buckets))
        .map((check) => check.collection),
      ...(sourceRequestIdsStringShaped ? ["orders"] : []),
    ]),
  ];
  const linkShapeClean = stringShapedCollections.length === 0;

  const clean =
    noSkips && categoryIdMissingClean && categoryIdResolvedClean && dropClean && resetCollectionsNowEmpty && linkShapeClean;

  return {
    steps: { categories, reset, dropLegacy },
    resetList: args.reset,
    postCensus,
    clean,
    nonEmptyResetCollections,
    stringShapedCollections,
  };
}
