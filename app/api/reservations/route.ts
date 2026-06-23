import { Reservation } from "@/models/Reservation";
import { TTL } from "@/lib/cache";
import { createCollectionRoute, bookingListFilter } from "@/lib/crud-route";
import { createReservationSchema } from "@/schemas";

export const dynamic = "force-dynamic";

// GET /api/reservations — list (cached 1min) or filter by status / date range
// POST /api/reservations — create (clears cache)
export const { GET, POST } = createCollectionRoute({
  model: Reservation,
  cacheKey: "reservations",
  ttl: TTL.RESERVATIONS,
  createSchema: createReservationSchema,
  entity: { singular: "reservation", plural: "reservations" },
  sort: { date: 1, time: 1 },
  listFilter: bookingListFilter,
});
