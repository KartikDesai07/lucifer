// Pure time-to-words helpers for the brand screens. No React, no clock of its
// own — callers pass a Date, so every rule here is testable at a fixed instant
// (lib/brand-time.test.ts).
//
// Local time on purpose: these describe the counter the operator is standing
// at, and a counter is set to the cafe's own zone (IST for every cafe today).

/** Hours (local, 24h) at which each part of the day begins. Before
 *  MORNING_FROM_HOUR it is still "evening" — a late kitchen closing at 1am is
 *  finishing the evening's service, not starting a morning one. */
export const MORNING_FROM_HOUR = 5;
export const AFTERNOON_FROM_HOUR = 12;
export const EVENING_FROM_HOUR = 17;

export type DayPart = "morning" | "afternoon" | "evening";

export function dayPartOf(now: Date): DayPart {
  const hour = now.getHours();
  if (hour >= MORNING_FROM_HOUR && hour < AFTERNOON_FROM_HOUR) return "morning";
  if (hour >= AFTERNOON_FROM_HOUR && hour < EVENING_FROM_HOUR) return "afternoon";
  return "evening";
}

/** "Good evening." — the sign-in card's headline. */
export function greetingFor(now: Date): string {
  return `Good ${dayPartOf(now)}.`;
}
