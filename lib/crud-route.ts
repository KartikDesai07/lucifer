import mongoose, {
  type Model,
  type FilterQuery,
  type UpdateQuery,
} from "mongoose";
import type { ZodTypeAny, z } from "zod";
import { connectDB } from "@/lib/db";
import cache from "@/lib/cache";
import {
  success,
  created,
  failure,
  notFound,
  validateBody,
  requireAuth,
  requireAdmin,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";

// Generic CRUD route handlers for the entities whose API is pure boilerplate
// (auth → connect → query → cache). Entities with special logic (orders' money
// recompute, categories' rename propagation, customers' search) keep their own
// handlers. Each route file destructures only the verbs it needs:
//   export const { GET, POST } = createCollectionRoute({ ... })
//   export const { PUT, DELETE } = createItemRoute({ ... })

type Guard = "auth" | "admin";

function runGuard(guard: Guard | undefined) {
  return guard === "admin" ? requireAdmin() : requireAuth();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface EntityLabels {
  singular: string; // "reservation" — used in error messages
  plural: string; // "reservations"
}

// Shared list-filter for the date/time-keyed bookings (reservations + events):
// filter by status and a single date or a from/to range. Returns the Mongo
// query plus whether any filter was applied (filtered lists skip the cache).
export function bookingListFilter(sp: URLSearchParams): {
  query: Record<string, unknown>;
  filtered: boolean;
} {
  const status = sp.get("status");
  const date = sp.get("date");
  const from = sp.get("from");
  const to = sp.get("to");
  const filtered = !!(status || date || from || to);

  const query: Record<string, unknown> = {};
  if (status) query.status = status;
  if (date) {
    query.date = date;
  } else if (from || to) {
    const range: Record<string, string> = {};
    if (from) range.$gte = from;
    if (to) range.$lte = to;
    query.date = range;
  }
  return { query, filtered };
}

interface CollectionRouteConfig<TDoc, TCreate extends ZodTypeAny> {
  model: Model<TDoc>;
  cacheKey: string;
  ttl: number;
  createSchema: TCreate;
  entity: EntityLabels;
  sort: Record<string, 1 | -1>;
  guard?: Guard; // default "auth"
  // Always-on filter (e.g. { isActive: true } for the products list).
  baseFilter?: FilterQuery<TDoc>;
  // Optional query-param-driven filter; when it reports `filtered`, the cache is
  // bypassed so filtered reads always hit the DB.
  listFilter?: (sp: URLSearchParams) => {
    query: Record<string, unknown>;
    filtered: boolean;
  };
  // Friendly message for a unique-index (11000) violation on create.
  onDuplicate?: string;
}

export function createCollectionRoute<TDoc, TCreate extends ZodTypeAny>(
  config: CollectionRouteConfig<TDoc, TCreate>,
) {
  async function GET(req: Request) {
    const authed = await runGuard(config.guard);
    if ("error" in authed) return authed.error;

    let query: FilterQuery<TDoc> = { ...(config.baseFilter ?? {}) };
    let filtered = false;
    if (config.listFilter) {
      const result = config.listFilter(new URL(req.url).searchParams);
      query = { ...query, ...result.query } as FilterQuery<TDoc>;
      filtered = result.filtered;
    }

    try {
      // Check the cache BEFORE opening a DB connection — a cache hit needs no DB.
      if (!filtered) {
        const cached = cache.get(config.cacheKey);
        if (cached) return success(cached);
      }
      await connectDB();
      const docs = await config.model.find(query).sort(config.sort).lean();
      if (!filtered) cache.set(config.cacheKey, docs, config.ttl);
      return success(docs);
    } catch (error) {
      return serverError(`Failed to fetch ${config.entity.plural}`, error);
    }
  }

  async function POST(req: Request) {
    const authed = await runGuard(config.guard);
    if ("error" in authed) return authed.error;

    const parsed = await validateBody(req, config.createSchema);
    if ("error" in parsed) return parsed.error;

    try {
      await connectDB();
      const doc = await config.model.create(parsed.data as z.infer<TCreate>);
      cache.del(config.cacheKey);
      return created(doc);
    } catch (e) {
      if (config.onDuplicate && isDuplicateKeyError(e)) {
        return failure(config.onDuplicate, 400);
      }
      return serverError(`Failed to create ${config.entity.singular}`, e);
    }
  }

  return { GET, POST };
}

interface ItemRouteConfig<TDoc, TUpdate extends ZodTypeAny> {
  model: Model<TDoc>;
  cacheKey: string;
  updateSchema: TUpdate;
  entity: EntityLabels;
  guard?: Guard; // default "auth"
  softDelete?: boolean; // set isActive:false instead of removing the document
}

export function createItemRoute<TDoc, TUpdate extends ZodTypeAny>(
  config: ItemRouteConfig<TDoc, TUpdate>,
) {
  const notFoundMsg = `${capitalize(config.entity.singular)} not found`;
  type Params = { params: Promise<{ id: string }> };

  // GET-by-id is only wired into route files that need it (products); other
  // routes destructure just { PUT, DELETE } and never expose this handler.
  async function GET(_req: Request, { params }: Params) {
    const authed = await runGuard(config.guard);
    if ("error" in authed) return authed.error;

    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) return notFound(notFoundMsg);

    try {
      await connectDB();
      const doc = await config.model.findById(id).lean();
      if (!doc) return notFound(notFoundMsg);
      return success(doc);
    } catch (error) {
      return serverError(`Failed to fetch ${config.entity.singular}`, error);
    }
  }

  async function PUT(req: Request, { params }: Params) {
    const authed = await runGuard(config.guard);
    if ("error" in authed) return authed.error;

    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) return notFound(notFoundMsg);

    const parsed = await validateBody(req, config.updateSchema);
    if ("error" in parsed) return parsed.error;

    try {
      await connectDB();
      const doc = await config.model
        .findByIdAndUpdate(id, parsed.data as UpdateQuery<TDoc>, {
          new: true,
          runValidators: true,
        })
        .lean();
      if (!doc) return notFound(notFoundMsg);
      cache.del(config.cacheKey);
      return success(doc);
    } catch (error) {
      return serverError(`Failed to update ${config.entity.singular}`, error);
    }
  }

  async function DELETE(_req: Request, { params }: Params) {
    const authed = await runGuard(config.guard);
    if ("error" in authed) return authed.error;

    const { id } = await params;
    if (!mongoose.isValidObjectId(id)) return notFound(notFoundMsg);

    try {
      await connectDB();
      const doc = config.softDelete
        ? await config.model
            .findByIdAndUpdate(id, { isActive: false } as UpdateQuery<TDoc>, {
              new: true,
            })
            .lean()
        : await config.model.findByIdAndDelete(id).lean();
      if (!doc) return notFound(notFoundMsg);
      cache.del(config.cacheKey);
      return success({ deleted: true });
    } catch (error) {
      return serverError(`Failed to delete ${config.entity.singular}`, error);
    }
  }

  return { GET, PUT, DELETE };
}
