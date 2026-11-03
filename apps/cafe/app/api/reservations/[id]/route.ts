import { Reservation } from "@/models/Reservation";
import { createItemRoute } from "@/lib/crud-route";
import { updateReservationSchema } from "@/schemas";

export const dynamic = "force-dynamic";

// PUT /api/reservations/[id] — update (clears cache)
// DELETE /api/reservations/[id] — delete (clears cache)
//
// Deliberately NOT table-existence-checked, unlike POST /api/reservations. An
// edit resubmits the whole booking, so if the table it was made for is later
// removed from the floor plan, checking here would make the reservation
// permanently un-editable — including impossible to CANCEL. Creating a booking
// for a table that does not exist is the real data-entry error, and that is
// caught on the way in. Shape (charset/length) is still enforced by the schema.
export const { PUT, DELETE } = createItemRoute({
  model: Reservation,
  cacheKey: "reservations",
  updateSchema: updateReservationSchema,
  entity: { singular: "reservation", plural: "reservations" },
  // Q6 (U6): the form's "Unassigned" over a saved table sends tableNo: null, back to ABSENT.
  nullClearsFields: ["tableNo"],
});
