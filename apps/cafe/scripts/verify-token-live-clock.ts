/**
 * Print customization S8 live legs - the IST clock helpers. The legs back-date orders by minutes, so the restart time
 * (numberResetMinutes) is derived from the clock to keep every back-dated instant inside the business day at ANY hour.
 * (Ops script helper, not app code.)
 */
import { MS_PER_MINUTE } from "@pos/shared/print-qr";

export const MINUTES_PER_DAY = 1440;
const IST_OFFSET_MINUTES = 330;
const DAY_MS = MINUTES_PER_DAY * MS_PER_MINUTE;

/** The restart time (IST minute of the day) whose business day began at that instant. */
export const istMinuteOf = (ms: number): number => Math.floor(((ms + IST_OFFSET_MINUTES * MS_PER_MINUTE) % DAY_MS) / MS_PER_MINUTE);

const BASE_DAY_AGE_MINUTES = 6 * 60;
/** A restart time whose business day began 6 h ago: any leg back-dating by under 6 h stays inside the day. */
export const baseResetMinutes = (nowMs: number = Date.now()): number => istMinuteOf(nowMs - BASE_DAY_AGE_MINUTES * MS_PER_MINUTE);
