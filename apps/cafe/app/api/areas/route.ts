import { connectDB } from "@/lib/db";
import { Area } from "@/models/Area";
import cache from "@/lib/cache";
import {
  success,
  created,
  failure,
  validateBody,
  requireAuth,
  requireAdmin,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import { AREA_LIST, listAreas } from "@/lib/masters";
import { createAreaSchema, reorderAreasSchema } from "@/schemas";
import { TABLE_AREAS_MAX } from "@/lib/constants";
import { AREA_DUPLICATE_ERROR, AREA_LIMIT_ERROR } from "@/lib/area-admin";
import { sameIdSet } from "@/lib/category-order";
import { AREAS_FRESH_PARAM, AREA_LIST_CHANGED_ERROR, areaReorderOps } from "@/lib/area-order";

export const dynamic = "force-dynamic";

// Every write invalidates exactly the key the shared list function caches under.
const CACHE_KEY = AREA_LIST.cacheKey;

// GET /api/areas — the floor areas in the operator's arrangement (cached,
// TTL.AREAS). The query/sort/cache-key/TTL live in AREA_LIST (lib/masters.ts),
// which GET /api/bootstrap serves the areas part from too, so this route and the
// bootstrap can never drift apart. Staff may read (the floor and New Order group
// tables by area); every write below is admin-only.
// ?fresh=1 (the recovery read after a 409 or a stale area id) drops THIS
// instance's cached list first. It sits after the auth check so an anonymous
// caller can never flush the cache.
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  if (new URL(req.url).searchParams.get(AREAS_FRESH_PARAM) === "1") cache.del(CACHE_KEY);

  try {
    return success(await listAreas());
  } catch (error) {
    return serverError("Failed to fetch areas", error);
  }
}

// POST /api/areas — add an area (admin). The client sends only the name: a new
// area always lands at the END of the arrangement (same discipline as a new
// table), never at a position the client chose.
export async function POST(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, createAreaSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    // Await the unique collation-index build before the cap check and the insert:
    // connectDB()'s autoIndex createIndexes() is not awaited, so on a cold
    // cluster two inserts could both land before the index exists, and the
    // deferred build would then fail silently for good, voiding the
    // duplicate-name guard. .init() is memoized per process (see crud-route.ts).
    await Area.init();
    // Accepted residual: two admins adding in the same instant can both pass
    // this count and land one area over the cap; the next add is refused.
    if ((await Area.countDocuments()) >= TABLE_AREAS_MAX) return failure(AREA_LIMIT_ERROR, 400);

    const last = await Area.findOne({ displayOrder: { $exists: true } })
      .sort({ displayOrder: -1 })
      .select("displayOrder")
      .lean();
    // +1 past the last arranged area (a count would collide after a delete).
    const displayOrder = (last?.displayOrder ?? -1) + 1;
    const area = await Area.create({ ...parsed.data, displayOrder });
    cache.del(CACHE_KEY);
    return created(area);
  } catch (error) {
    if (isDuplicateKeyError(error)) return failure(AREA_DUPLICATE_ERROR, 400);
    return serverError("Failed to create area", error);
  }
}

// PATCH /api/areas — save the drag-and-drop arrangement (admin). The WHOLE
// ordered id list is sent (the PATCH /api/categories idiom): positions come from
// the index, so a client can never invent a sparse or colliding order. A list
// that is not EXACTLY the current set is refused whole (409) rather than
// reordering a subset or silently dropping an area nobody mentioned.
// Accepted residual: two admins saving in the very same instant can both pass
// the set check; the {displayOrder, name} sort keeps the list valid and the next
// save renumbers it.
export async function PATCH(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, reorderAreasSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const current = await Area.find().select("_id").lean();
    if (!sameIdSet(parsed.data.ids, current.map((a) => String(a._id)))) {
      return failure(AREA_LIST_CHANGED_ERROR, 409);
    }
    await Area.bulkWrite(areaReorderOps(parsed.data.ids));
    cache.del(CACHE_KEY);
    return success(await listAreas());
  } catch (error) {
    return serverError("Failed to save the arrangement", error);
  }
}
