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

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;

export interface PostmarkText {
  /** Round the top of the ring: "EVENING SERVICE". */
  service: string;
  /** Round the bottom of the ring: "SATURDAY". */
  weekday: string;
  /** In the middle: "26 SEP" over "2026". */
  dayMonth: string;
  year: string;
}

/** The words on the painting's postmark — today, in the counter's own time.
 *  Fixed English tables, not toLocaleString, so a device set to another
 *  language never changes the stamp. */
export function postmarkFor(now: Date): PostmarkText {
  return {
    service: `${dayPartOf(now).toUpperCase()} SERVICE`,
    weekday: WEEKDAYS[now.getDay()],
    dayMonth: `${now.getDate()} ${MONTHS[now.getMonth()]}`,
    year: String(now.getFullYear()),
  };
}
