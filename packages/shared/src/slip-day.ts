// Print customization S6: the "business day" a printed number belongs to. Token, kitchen-ticket and bill numbers
// each restart once a day; until now that was IST midnight (cafeDateString). A cafe that trades past midnight wants
// the restart at its own time (say 4:00 am), so the day is SHIFTED back by the restart time before it is named:
// at 02:00 with a 4:00 am restart it is still yesterday's day, at 04:00 it is today's. Pure and client-safe.
//
// 0 minutes (also what an absent or unusable stored value means) shifts nothing, so the day is exactly the IST
// calendar date and every counter key is byte-identical to the one the cafe used before this setting existed.
import { cafeDateString, dayRange } from "./utils";
import { MS_PER_MINUTE } from "./print-qr";

export const NUMBER_RESET_MINUTES_MIN = 0; // minutes after IST midnight; 0 = midnight, the old behaviour
export const NUMBER_RESET_MINUTES_MAX = 1439; // 23:59 — a restart is always inside the calendar day
export const NUMBER_RESET_STEP_MINUTES = 30; // what the settings picker offers; stored values may be any minute

/** A whole number of minutes in 0..1439. */
export function isNumberResetMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= NUMBER_RESET_MINUTES_MIN &&
    value <= NUMBER_RESET_MINUTES_MAX
  );
}

/** The stored restart time when it is valid, else 0 (midnight). Never throws, whatever was stored. */
export function numberResetMinutesOf(value: unknown): number {
  return isNumberResetMinutes(value) ? value : NUMBER_RESET_MINUTES_MIN;
}

function shiftedBack(date: Date, resetMinutes: number): Date {
  return new Date(date.getTime() - resetMinutes * MS_PER_MINUTE);
}

/** The business day of an instant as "YYYYMMDD" (no dashes) — the suffix of every slip counter key. */
export function slipDayKey(date: Date, resetMinutes = 0): string {
  return cafeDateString(shiftedBack(date, resetMinutes)).replace(/-/g, "");
}

/** The instant the business day containing `date` began (IST midnight plus the restart time). */
export function slipDayStart(date: Date, resetMinutes = 0): Date {
  return new Date(dayRange(shiftedBack(date, resetMinutes)).start.getTime() + resetMinutes * MS_PER_MINUTE);
}

const MINUTES_PER_HOUR = 60;
const HOURS_ON_CLOCK = 12;

/** The restart times the settings picker offers: every half hour, 12:00 am to 11:30 pm. A valid stored value that is
 * not one of those steps is added in order, so a time saved some other way never disappears from the picker. */
export function numberResetOptions(stored?: number): number[] {
  const options: number[] = [];
  for (let m = NUMBER_RESET_MINUTES_MIN; m <= NUMBER_RESET_MINUTES_MAX; m += NUMBER_RESET_STEP_MINUTES) options.push(m);
  if (isNumberResetMinutes(stored) && !options.includes(stored)) {
    options.push(stored);
    options.sort((a, b) => a - b);
  }
  return options;
}

/** "12:00 am (midnight)" for 0, else "h:mm am/pm" ("4:30 am", "12:00 pm", "11:30 pm"). Not formatTime: that one
 * takes an "HH:mm" string and prints 0 o'clock as "0". */
export function numberResetLabel(minutes: number): string {
  const total = numberResetMinutesOf(minutes);
  if (total === NUMBER_RESET_MINUTES_MIN) return "12:00 am (midnight)";
  const hour24 = Math.floor(total / MINUTES_PER_HOUR);
  const minute = String(total % MINUTES_PER_HOUR).padStart(2, "0");
  const hour12 = hour24 % HOURS_ON_CLOCK === 0 ? HOURS_ON_CLOCK : hour24 % HOURS_ON_CLOCK;
  return `${hour12}:${minute} ${hour24 < HOURS_ON_CLOCK ? "am" : "pm"}`;
}

// Print customization S8: how long a READY token stays on the token list before it clears by itself (01-PLAN Q3,
// owner: 10 minutes by default, changeable). Read at request time — no write and no cron clears it. Absent or
// unusable stored values read as the default; the settings picker offers the steps, a stored off-step value is kept.
export const TOKEN_READY_CLEAR_MINUTES_MIN = 1;
export const TOKEN_READY_CLEAR_MINUTES_MAX = 120;
export const TOKEN_READY_CLEAR_MINUTES_DEFAULT = 10;
export const TOKEN_READY_CLEAR_STEPS: readonly number[] = [2, 5, 10, 15, 20, 30, 45, 60];

/** A whole number of minutes in 1..120. */
export function isTokenReadyClearMinutes(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= TOKEN_READY_CLEAR_MINUTES_MIN &&
    value <= TOKEN_READY_CLEAR_MINUTES_MAX
  );
}

/** The stored clear time when it is valid, else 10 minutes. Never throws, whatever was stored. */
export function tokenReadyClearMinutesOf(value: unknown): number {
  return isTokenReadyClearMinutes(value) ? value : TOKEN_READY_CLEAR_MINUTES_DEFAULT;
}

/** The clear times the settings picker offers; a valid stored value that is not a step is added in order. */
export function tokenReadyClearOptions(stored?: number): number[] {
  const options = [...TOKEN_READY_CLEAR_STEPS];
  if (isTokenReadyClearMinutes(stored) && !options.includes(stored)) {
    options.push(stored);
    options.sort((a, b) => a - b);
  }
  return options;
}

/** "1 minute", "10 minutes". */
export function tokenReadyClearLabel(minutes: number): string {
  const m = tokenReadyClearMinutesOf(minutes);
  return `${m} minute${m === 1 ? "" : "s"}`;
}
