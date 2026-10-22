// The /pos header's clock (the owner's HTML Order header, values 0.1 and 1.2; design 6.1; U1 Task 1): the HTML's
// `toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })` then the 12-hour time, e.g.
// "Mon, 19 Oct 9:30 PM". In the cafe's time zone, as the header's default date line (lib/page-titles.ts). Pure, so the
// words are unit-tested (lib/pos-frame.test.ts); the header re-reads the time once a minute.
import { CAFE_TIMEZONE } from "@/lib/constants";
import type { PrinterDotTone } from "@/lib/printer/printer-dot";
import { timeLabel } from "@/lib/time-input";

const CLOCK_DATE = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: CAFE_TIMEZONE });
// "21:30" (24-hour, zero-padded, midnight "00:00"), the stored shape timeLabel reads.
const CLOCK_TIME = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: CAFE_TIMEZONE });

/** "Mon, 19 Oct 9:30 PM": the cafe's weekday, day and month, then the 12-hour time. */
export function posClockLabel(now: Date): string {
  return `${CLOCK_DATE.format(now)} ${timeLabel(CLOCK_TIME.format(now))}`;
}

/** The clock block's printer state in words, for screen readers only (U1 final fix wave: its dot never carries the
 *  state by colour alone): after the visible "Printer", the printer button's own words ("Printer connected — …",
 *  "Printer not connected — …"); nothing while the button draws no dot (checking, or nothing set up). */
export function clockPrinterWords(tone: PrinterDotTone): string | null {
  if (tone === "green") return "connected";
  if (tone === "red") return "not connected";
  return null;
}
