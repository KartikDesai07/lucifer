import { Reservation } from "@/models/Reservation";
import { createItemRoute } from "@/lib/crud-route";
import { updateReservationSchema } from "@/schemas";

export const dynamic = "force-dynamic";

// PUT /api/reservations/[id] — update (clears cache)
// DELETE /api/reservations/[id] — delete (clears cache)
export const { PUT, DELETE } = createItemRoute({
  model: Reservation,
  cacheKey: "reservations",
  updateSchema: updateReservationSchema,
  entity: { singular: "reservation", plural: "reservations" },
});
