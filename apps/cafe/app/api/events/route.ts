import { Event } from "@/models/Event";
import { TTL } from "@/lib/cache";
import { createCollectionRoute, bookingListFilter } from "@/lib/crud-route";
import { createEventSchema } from "@/schemas";

export const dynamic = "force-dynamic";

// GET /api/events — list (cached 1min) or filter by status / date range
// POST /api/events — create (clears cache)
export const { GET, POST } = createCollectionRoute({
  model: Event,
  cacheKey: "events",
  ttl: TTL.EVENTS,
  createSchema: createEventSchema,
  entity: { singular: "event", plural: "events" },
  sort: { date: 1, time: 1 },
  listFilter: bookingListFilter,
});
