// Pure "HH:mm" <-> 12-hour parts helpers for TimePicker (no-native-pickers
// slice T, 2026-10-11). The stored shape is the one the event/reservation
// schemas require (`^\d{2}:\d{2}$`, 24 h, zero-padded); the picker shows and
// edits it as hour 1-12 + minute + AM/PM. No Date parsing: a bare wall-clock
// time has no zone to shift.

export type TimePeriod = "AM" | "PM";

export interface TimeParts {
  hour12: number; // 1..12
  minute: number; // 0..59
  period: TimePeriod;
}

const STORED_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOURS_ON_CLOCK = 12;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
/** The picker's minute column steps by this; an old off-step value is added. */
export const MINUTE_STEP = 5;

export const HOUR_OPTIONS: readonly number[] = Array.from({ length: HOURS_ON_CLOCK }, (_, i) => i + 1);
export const PERIOD_OPTIONS: readonly TimePeriod[] = ["AM", "PM"];

const pad2 = (n: number): string => String(n).padStart(2, "0");

// "" or anything but a real 24 h "HH:mm" -> null, never a bogus time.
export function parseTimeInput(value: string): TimeParts | null {
  const m = STORED_TIME_PATTERN.exec(value);
  if (!m) return null;
  const hour24 = Number(m[1]);
  return {
    hour12: hour24 % HOURS_ON_CLOCK || HOURS_ON_CLOCK,
    minute: Number(m[2]),
    period: hour24 < HOURS_ON_CLOCK ? "AM" : "PM",
  };
}

export function formatTimeInput(parts: TimeParts): string {
  const hour24 = (parts.hour12 % HOURS_ON_CLOCK) + (parts.period === "PM" ? HOURS_ON_CLOCK : 0);
  return `${pad2(hour24)}:${pad2(parts.minute)}`;
}

// "19:30" -> "7:30 PM"; 00:00 -> "12:00 AM"; 12:00 -> "12:00 PM"; bad -> "".
export function timeLabel(value: string): string {
  const parts = parseTimeInput(value);
  return parts ? `${parts.hour12}:${pad2(parts.minute)} ${parts.period}` : "";
}

/** The minute column: 00, 05 ... 55, plus `current` when it is off the step
 *  (an old 7:32 booking still shows its own minute selected). */
export function minuteOptions(current: number | null): number[] {
  const steps = Array.from({ length: MINUTES_PER_HOUR / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
  if (current === null || current < 0 || current >= MINUTES_PER_HOUR || steps.includes(current)) return steps;
  return [...steps, current].sort((a, b) => a - b);
}

/** What a first tap on an empty value fills the other parts with: the current
 *  hour and the next 5-minute step (rolling into the next hour, past midnight). */
export function defaultTimeParts(now: Date): TimeParts {
  let hour24 = now.getHours();
  let minute = Math.ceil(now.getMinutes() / MINUTE_STEP) * MINUTE_STEP;
  if (minute >= MINUTES_PER_HOUR) {
    minute = 0;
    hour24 = (hour24 + 1) % HOURS_PER_DAY;
  }
  return parseTimeInput(`${pad2(hour24)}:${pad2(minute)}`) as TimeParts;
}

/** Apply one tapped part to the current value; the other parts are kept, or
 *  (empty / unreadable value) taken from `defaultTimeParts(now)`. */
export function withTimePart(value: string, change: Partial<TimeParts>, now: Date): string {
  const base = parseTimeInput(value) ?? defaultTimeParts(now);
  return formatTimeInput({ ...base, ...change });
}
