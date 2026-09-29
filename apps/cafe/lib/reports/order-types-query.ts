// Query-string -> the hour-detail route's params — pure (no DB). Lives in
// lib/ rather than the route file because a Next route module may only
// export handlers/config. `type` is checked with Object.hasOwn, never `in` or
// a plain lookup, so a prototype key ("constructor"/"__proto__"/"toString")
// can never slip through as if it were a real DashboardChannel.
import { CHANNEL_LABELS } from "@/lib/dashboard/fold";
import type { DashboardChannel } from "@/types/dashboard";

const HOUR_DIGITS = /^\d{1,2}$/;
const MIN_HOUR = 0;
const MAX_HOUR = 23;
const HOUR_ERROR = `Pick an hour between ${MIN_HOUR} and ${MAX_HOUR}`;
const TYPE_ERROR = "Unknown order type";

export function parseHourDetailQuery(sp: URLSearchParams): { hour: number; type: DashboardChannel | null } | { error: string } {
  const hourParam = sp.get("hour");
  if (hourParam === null || !HOUR_DIGITS.test(hourParam)) return { error: HOUR_ERROR };
  const hour = Number(hourParam);
  if (hour < MIN_HOUR || hour > MAX_HOUR) return { error: HOUR_ERROR };

  const typeParam = sp.get("type") ?? "";
  if (typeParam === "") return { hour, type: null };
  if (!Object.hasOwn(CHANNEL_LABELS, typeParam)) return { error: TYPE_ERROR };
  return { hour, type: typeParam as DashboardChannel };
}
