/**
 * CB-DL-2 S4 — the products -> categories back-fill and the legacy-field drop
 * (D-C items 12-13). RAW DRIVER ONLY, same discipline as census-orders.ts /
 * census-refs.ts: a Mongoose schema would cast the very strings/ids this
 * module reads and writes, and Product no longer even carries a `category`
 * path to cast against.
 */
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { normalizeName, type RawDoc } from "./census-orders";

// bulkWrite batch size for the categoryId back-fill — keeps a single request
// well inside Atlas M0's document/op limits on a large product catalogue.
export const APPLY_BATCH_SIZE = 500;

// The index the legacy `category` string path used to carry (models/Product.ts
// pre-D-A) — dropLegacyCategory removes it once every product has migrated.
const LEGACY_CATEGORY_INDEX = "category_1";
const INDEX_NOT_FOUND_CODE = 27;

export interface CategoryApplyResult {
  scanned: number;
  alreadyObjectId: number;
  matched: number;
  skippedNoDoc: string[];
  skippedCollision: string[][];
  created: string[];
  modified: number;
}

interface CategoryDoc extends RawDoc {
  name: string;
  order: number;
}

interface ProductDoc extends RawDoc {
  category?: unknown;
  categoryId?: unknown;
}

/** Resolves every product's legacy `category` name to a `categoryId`
 * ObjectId and writes it back in batches. Products that already carry an
 * ObjectId `categoryId` are left untouched (counted, not re-written). */
export async function applyProductCategories(
  db: Db,
  opts: { createMissing: boolean; batchSize: number },
): Promise<CategoryApplyResult> {
  const categories = await db.collection<CategoryDoc>("categories").find({}).toArray();
  const byExactName = new Map<string, ObjectId>();
  const normalizedGroups = new Map<string, string[]>();
  let maxOrder = 0;
  for (const cat of categories) {
    byExactName.set(cat.name, cat._id as ObjectId);
    const norm = normalizeName(cat.name);
    const group = normalizedGroups.get(norm) ?? [];
    group.push(cat.name);
    normalizedGroups.set(norm, group);
    if (cat.order > maxOrder) maxOrder = cat.order;
  }

  const result: CategoryApplyResult = {
    scanned: 0,
    alreadyObjectId: 0,
    matched: 0,
    skippedNoDoc: [],
    skippedCollision: [],
    created: [],
    modified: 0,
  };

  const skippedCollisionSet = new Set<string>();
  const skippedNoDocSet = new Set<string>();
  const noDocProducts: { productId: ObjectId; name: string }[] = [];
  const resolvedByProductId = new Map<string, ObjectId>();

  const cursor = db.collection<ProductDoc>("products").find({});
  for await (const doc of cursor) {
    result.scanned += 1;
    if (doc.categoryId instanceof ObjectId) {
      result.alreadyObjectId += 1;
      continue;
    }
    if (typeof doc.category !== "string") continue;

    const exact = byExactName.get(doc.category);
    if (exact) {
      resolvedByProductId.set(String(doc._id), exact);
      result.matched += 1;
      continue;
    }

    const norm = normalizeName(doc.category);
    const group = normalizedGroups.get(norm) ?? [];
    if (group.length === 1) {
      const id = byExactName.get(group[0]);
      if (id) {
        resolvedByProductId.set(String(doc._id), id);
        result.matched += 1;
        continue;
      }
    }
    if (group.length > 1) {
      skippedCollisionSet.add(JSON.stringify([...group].sort()));
      continue;
    }

    // No Category doc for this name at all (group.length === 0).
    skippedNoDocSet.add(doc.category);
    noDocProducts.push({ productId: doc._id as ObjectId, name: doc.category });
  }

  result.skippedCollision = [...skippedCollisionSet].map((g) => JSON.parse(g) as string[]);

  if (opts.createMissing && skippedNoDocSet.size > 0) {
    // Group the unmatched names by the SAME normalization used above for
    // matching, so two spellings differing only by case/whitespace collapse
    // into exactly one Category doc instead of one each (review C6).
    const unmatchedGroups = new Map<string, string[]>();
    for (const name of skippedNoDocSet) {
      const norm = normalizeName(name);
      const group = unmatchedGroups.get(norm) ?? [];
      group.push(name);
      unmatchedGroups.set(norm, group);
    }

    let nextOrder = maxOrder + 1;
    const rawSpellingToNewId = new Map<string, ObjectId>();
    for (const spellings of unmatchedGroups.values()) {
      // Display name = the first raw spelling seen, whitespace collapsed and
      // trimmed (the raw driver bypasses the Mongoose `trim: true`), keeping
      // the operator's original casing.
      const displayName = spellings[0].trim().replace(/\s+/g, " ");
      const now = new Date();
      const insertResult = await db.collection<CategoryDoc>("categories").insertOne({
        name: displayName,
        order: nextOrder,
        createdAt: now,
        updatedAt: now,
      } as unknown as CategoryDoc);
      const newId = insertResult.insertedId as ObjectId;
      for (const spelling of spellings) rawSpellingToNewId.set(spelling, newId);
      result.created.push(displayName);
      nextOrder += 1;
    }
    for (const { productId, name } of noDocProducts) {
      const id = rawSpellingToNewId.get(name);
      if (id) resolvedByProductId.set(String(productId), id);
    }
    // Every no-doc name just got a Category doc created for it — none of
    // them are "skipped" any more (skippedNoDoc stays [] on this branch).
  } else {
    result.skippedNoDoc = [...skippedNoDocSet];
  }

  if (resolvedByProductId.size > 0) {
    const ids = [...resolvedByProductId.keys()];
    for (let i = 0; i < ids.length; i += opts.batchSize) {
      const batchIds = ids.slice(i, i + opts.batchSize);
      const ops = batchIds.map((idStr) => ({
        updateOne: {
          filter: { _id: new ObjectId(idStr) },
          update: { $set: { categoryId: resolvedByProductId.get(idStr) } },
        },
      }));
      const writeResult = await db.collection("products").bulkWrite(ops);
      result.modified += writeResult.modifiedCount;
    }
  }

  return result;
}

/** Drops the legacy `category` field and its index, but only once every
 * product carries an ObjectId `categoryId` that ALSO resolves against a live
 * Category doc — refuses (writes nothing) otherwise. A type-only check would
 * let a product pointing at a deleted category ($type check passes) lose the
 * only in-DB copy of its legacy name (review C7). */
export async function dropLegacyCategory(
  db: Db,
): Promise<{ refused: boolean; unset: number; indexDropped: boolean }> {
  const products = db.collection<ProductDoc>("products");
  const total = await products.countDocuments({});
  const withObjectIdCategoryId = await products.countDocuments({
    categoryId: { $type: "objectId" },
  });
  if (withObjectIdCategoryId !== total) {
    return { refused: true, unset: 0, indexDropped: false };
  }

  const liveCategoryIds = new Set(
    (await db.collection<CategoryDoc>("categories").find({}, { projection: { _id: 1 } }).toArray()).map((c) =>
      String(c._id),
    ),
  );
  const distinctCategoryIds = await products.distinct("categoryId");
  const everyIdResolves = distinctCategoryIds.every((id) => liveCategoryIds.has(String(id)));
  if (!everyIdResolves) {
    return { refused: true, unset: 0, indexDropped: false };
  }

  const updateResult = await products.updateMany(
    { category: { $exists: true } },
    { $unset: { category: "" } },
  );

  let indexDropped = true;
  try {
    await products.dropIndex(LEGACY_CATEGORY_INDEX);
  } catch (error) {
    const code = (error as { code?: number } | null)?.code;
    if (code === INDEX_NOT_FOUND_CODE) {
      indexDropped = false;
    } else {
      throw error;
    }
  }

  return { refused: false, unset: updateResult.modifiedCount, indexDropped };
}
