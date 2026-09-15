import type { FilterQuery, FlattenMaps, Model, Types } from "mongoose";
import cache, { TTL } from "@/lib/cache";
import { connectDB } from "@/lib/db";
import { Category, type ICategory } from "@/models/Category";
import { Product, type IProduct } from "@/models/Product";
import { Staff, type IStaff } from "@/models/Staff";
import { Table, type ITable } from "@/models/Table";

// The ONE description of how each master collection is listed — the query, the
// sort, the cache key and the TTL that GET /api/categories, /api/products,
// /api/tables and /api/staff already used. Those routes and GET /api/bootstrap
// both read through `listFromSpec`, so the bootstrap payload can never drift
// from what the five master routes serve (CB-DL-1).
//
// Settings deliberately gets NO spec: its getter is `getSettings()`
// (lib/settings.ts), which the settings route itself calls, so that stays the
// single source there.

// What `Model<TDoc>.find().lean()` resolves to — the same plain-object row the
// master routes already hand to `success()` (ObjectId `_id`, Date fields, `__v`).
export type LeanRow<TDoc> = FlattenMaps<TDoc> &
  Required<{ _id: Types.ObjectId }> & { __v: number };

export interface MasterListSpec<TDoc> {
  model: Model<TDoc>;
  cacheKey: string;
  ttl: number;
  filter: FilterQuery<TDoc>;
  sort: Record<string, 1 | -1>;
  // Projection passed straight to `.select()`. Only staff needs one.
  select?: string;
}

export const CATEGORY_LIST: MasterListSpec<ICategory> = {
  model: Category,
  cacheKey: "categories",
  ttl: TTL.CATEGORIES,
  filter: {},
  sort: { order: 1, name: 1 },
};

export const PRODUCT_LIST: MasterListSpec<IProduct> = {
  model: Product,
  cacheKey: "products",
  ttl: TTL.PRODUCTS,
  // Archived (soft-deleted) products are a separate, uncached management view.
  filter: { isActive: true },
  // An ObjectId sort is meaningless (no name to alphabetize) — the client
  // orders by the joined category map instead (lib/category-map.ts).
  sort: { name: 1 },
};

export const TABLE_LIST: MasterListSpec<ITable> = {
  model: Table,
  cacheKey: "tables",
  ttl: TTL.TABLES,
  filter: {},
  // The operator's hand arrangement wins; the name is the tie-break, so
  // tables that were never arranged (missing displayOrder) keep name order.
  sort: { displayOrder: 1, tableNo: 1 },
};

export const STAFF_LIST: MasterListSpec<IStaff> = {
  model: Staff,
  cacheKey: "staff",
  ttl: TTL.STAFF,
  filter: {},
  sort: { name: 1 },
  // Staff reads NEVER carry the password hash.
  select: "-password",
};

// Same order of operations as lib/crud-route.ts's GET and the hand-written
// tables/staff routes: check the cache BEFORE opening a DB connection (a cache
// hit needs no DB), then query, then cache. Deliberately does NOT catch —
// every caller already wraps this in its own try/catch with its own message.
export async function listFromSpec<TDoc>(
  spec: MasterListSpec<TDoc>,
): Promise<LeanRow<TDoc>[]> {
  const cached = cache.get<LeanRow<TDoc>[]>(spec.cacheKey);
  if (cached) return cached;

  await connectDB();
  const query = spec.model.find(spec.filter).sort(spec.sort);
  // Mongoose's lean() return type stays an unreduced conditional while TDoc is
  // still generic; it resolves to exactly LeanRow<TDoc> for every concrete doc
  // type (probe-checked against Model<ICategory>), which is what the four
  // wrappers below expose.
  const docs = (await (spec.select ? query.select(spec.select) : query).lean()) as LeanRow<TDoc>[];
  cache.set(spec.cacheKey, docs, spec.ttl);
  return docs;
}

// Spreads a spec into the `createCollectionRoute` config fields that MUST agree
// with it, so a route cannot declare one model/sort/filter/cacheKey/TTL for its
// cached list and another for its filtered one. The spec is spelled once:
//   createCollectionRoute({ ...listSpecConfig(PRODUCT_LIST), ... })
// Lives here rather than in crud-route.ts to keep that file under the 300-line
// ceiling; the returned shape is structural, so tsc checks it against
// CollectionRouteConfig at every spread site.
//
// What this DOES guarantee: the cached branch (listSpec) and the filtered
// branch (cacheKey/sort/baseFilter) of one route are the same five values, so
// they cannot drift apart field by field. What it does NOT: passing the WRONG
// spec wholesale still typechecks (probe-verified — `TDoc` is inferred from the
// spread, so the config just re-infers for that model), which is what the
// route-source parity pin covers.
export function listSpecConfig<TDoc>(
  spec: MasterListSpec<TDoc>,
): {
  model: Model<TDoc>;
  cacheKey: string;
  ttl: number;
  sort: Record<string, 1 | -1>;
  baseFilter: FilterQuery<TDoc>;
  listSpec: MasterListSpec<TDoc>;
} {
  return {
    model: spec.model,
    cacheKey: spec.cacheKey,
    ttl: spec.ttl,
    sort: spec.sort,
    baseFilter: spec.filter,
    listSpec: spec,
  };
}

export function listCategories(): Promise<LeanRow<ICategory>[]> {
  return listFromSpec(CATEGORY_LIST);
}

export function listProducts(): Promise<LeanRow<IProduct>[]> {
  return listFromSpec(PRODUCT_LIST);
}

export function listTables(): Promise<LeanRow<ITable>[]> {
  return listFromSpec(TABLE_LIST);
}

export function listStaff(): Promise<LeanRow<IStaff>[]> {
  return listFromSpec(STAFF_LIST);
}
