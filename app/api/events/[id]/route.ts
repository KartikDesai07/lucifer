import { Event } from "@/models/Event";
import { createItemRoute } from "@/lib/crud-route";
import { updateEventSchema } from "@/schemas";

export const dynamic = "force-dynamic";

// PUT /api/events/[id] — update (clears cache)
// DELETE /api/events/[id] — delete (clears cache)
export const { PUT, DELETE } = createItemRoute({
  model: Event,
  cacheKey: "events",
  updateSchema: updateEventSchema,
  entity: { singular: "event", plural: "events" },
});
