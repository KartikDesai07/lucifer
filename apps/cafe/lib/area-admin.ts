import { Area } from "@/models/Area";
import { TABLE_AREAS_MAX } from "@/lib/constants";

// Server-side helpers for the areas routes and for the table writes that name an
// area. Mirrors lib/category-admin.ts: a table links to its area by id only, so
// a delete can strand a link (the count -> deleteOne window, accepted, same as
// categories) and a posted areaId must be checked to name a live area.

export const AREA_DUPLICATE_ERROR = "An area with that name already exists";
export const AREA_INVALID_ERROR = "Select a valid area.";
export const AREA_LIMIT_ERROR = `You can have up to ${TABLE_AREAS_MAX} areas.`;
export const AREA_NOT_FOUND_ERROR = "Area not found";

// Confirms an areaId names an actual area. Returns null when the area exists;
// otherwise the rejection message. Caller must have already called connectDB().
export async function checkAreaExists(areaId: string): Promise<string | null> {
  const exists = await Area.exists({ _id: areaId });
  return exists ? null : AREA_INVALID_ERROR;
}
