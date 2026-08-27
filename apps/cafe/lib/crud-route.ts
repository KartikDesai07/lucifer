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
  // Optional cross-collection check. Runs after the Zod parse and after
  // connectDB(), before the create — return a message to reject with 400,
  // or null to proceed.
  validate?: (data: z.infer<TCreate>) => Promise<string | null>;
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
      const invalid = await config.validate?.(parsed.data as z.infer<TCreate>);
      if (invalid) return failure(invalid, 400);
      // Await the unique-index build before the first insert — connectDB()'s
      // autoIndex createIndexes() is not awaited, so on a cold cluster two
      // concurrent inserts can both land before the index exists; the deferred
      // build then fails silently and PERMANENTLY, voiding this collection's
      // duplicate-name guard for its whole life. .init() is memoized per
      // process, so warm invocations pay nothing (mirrors due-payment.ts).
      await config.model.init();
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
  // Fields whose value may arrive as an explicit `null` meaning "clear this".
  // A plain update object cannot express that: Mongoose only $sets the keys
  // that are present, and a null left in place would STORE null rather than
  // remove the field — breaking the omit-empty discipline these documents rely
  // on. Naming a field here turns its null into a real $unset. An ABSENT key is
  // untouched either way, which is what keeps a partial PUT partial.
  nullClearsFields?: readonly string[];
}

// Turns a validated partial payload into an explicit update document, moving any
// field listed in `nullClearsFields` that arrived as `null` into $unset so it goes
// back to ABSENT. $set/$unset are spelled out rather than relying on the implicit
// $set, because the two cannot be mixed with bare keys in one object.
export function buildUpdate<TDoc>(
  data: unknown,
  nullClearsFields: readonly string[] = [],
): UpdateQuery<TDoc> {
  const fields = { ...(data as Record<string, unknown>) };
  const unset: Record<string, ""> = {};
  for (const field of nullClearsFields) {
    if (Object.hasOwn(fields, field) && fields[field] === null) {
      unset[field] = "";
      delete fields[field];
    }
  }
  const update: Record<string, unknown> = {};
  if (Object.keys(fields).length > 0) update.$set = fields;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return update as UpdateQuery<TDoc>;
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
        .findByIdAndUpdate(id, buildUpdate(parsed.data, config.nullClearsFields), {
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
