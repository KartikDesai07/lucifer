// The DRIVER print lane: Chromium's own print call through the Windows GDI
// driver. Since 2026-09-19 this is the FALLBACK, not the default (see print-direct.ts):
// it is kept for a printer that does not understand ESC/POS, and it is
// selected by the operator in Settings → Printing ("Through the Windows
// driver"). Everything measured about page geometry on this lane still holds
// and is recorded below, because the lane still ships.
//
// The hard limit of this lane, MEASURED on the counter PC's POS80 (2026-09-19):
// the driver IGNORES the page size the app asks for and prints on its own
// configured form. With the form on "Letter" a 32-item bill was cut short at
// ~225mm and the rest was lost silently; with the form on a custom 80 x 297mm
// a 4cm test slip still came out on a 297mm page. Chromium sets the requested
// width/length on the DEVMODE but leaves the driver's own paper-size field in
// place, and a driver is free to prefer that. So the paper length here is
// whatever the driver's form says — it can never follow the content.
import type { BrowserWindow } from "electron";
import type { Logger } from "./log";
import type { PaintProbe } from "./print-job";
import { sanitizeFailureReason } from "./print-messages";

// The slip's own paper WIDTH, read out of the `@page { size: <w> ... }` rule
// the web app already puts in every document (lib/print.ts's RECEIPT_PAGE_STYLE
// / receiptPageStyle, driven by the cafe's Settings paper width).
//
// Why this is read rather than assumed (2026-09-19): silent printing used
// `usePrinterDefaultPageSize: true`, which asks the DRIVER for its paper. A
// thermal driver such as "POS80" frequently reports none, and Electron then
// falls back to **A4 (210 x 297mm)** — documented behaviour. An A4 page handed
// to an 80mm roll leaves the slip in the top-left corner of a sheet 2.6x too
// wide, so the roll prints blank or clipped, while the print call still
// reports success. Reading the width from the document and passing it as an
// EXPLICIT pageSize removes the guess: the printer is told the real roll width.
// The direct lane reads the same rule to pick the printer's dot width.
//
// Height is NEVER a fixed guess. An explicit page height IS the page LENGTH:
// a 1200mm one fed 1.2 METRES per slip on 2026-09-17 and ran a whole roll out.
// MEASURED here before shipping: with a 31.8mm slip, a 3000mm height still
// produced a 3000mm page — i.e. a "generous composition height" is the exact
// same disaster wearing a different number. So the height is derived from the
// slip's OWN measured content height (the paint probe already reports it),
// plus a small tail for the page margin, and is clamped to sane bounds.
const PAGE_WIDTH_RE = /@page[^{]*\{[^}]*\bsize:\s*([\d.]+)(mm|cm|in)\b/i;
const MICRONS_PER = { mm: 1000, cm: 10000, in: 25400 } as const;
// Chromium refuses a page smaller than this; also a sanity floor/ceiling so a
// malformed rule can never ask for an absurd sheet.
const MIN_WIDTH_MICRONS = 20_000; // 20mm
const MAX_WIDTH_MICRONS = 300_000; // 300mm

// CSS px -> microns. A CSS pixel is 1/96 inch; an inch is 25400 microns.
const MICRONS_PER_CSS_PX = 25_400 / 96;
// A small tail so the last line is never clipped by rounding, and so the
// thermal cutter has something to cut into. Kept DELIBERATELY small: every
// micron here is paper fed on every single slip. It does NOT need to cover the
// @page margin — `document.body.scrollHeight` already includes the slip's own
// padding, and the printer margin is switched off (marginType "none").
const PAGE_HEIGHT_TAIL_MICRONS = 4_000; // 4mm
// Chromium refuses a page shorter than a few mm.
const MIN_HEIGHT_MICRONS = 25_000; // 25mm
// The longest single page to compose. A slip longer than this is NOT
// truncated: Chromium paginates it, and on a continuous roll consecutive pages
// come out as one unbroken strip, so the operator just sees a long bill.
//
// Why a ceiling exists at all. MEASURED on the counter PC's POS80 on
// 2026-09-19, while its Windows paper size was still "Letter": a 32-item bill
// asked for a 317mm page, the printer stopped after ~23 items (~225mm), and
// the rest of the bill was lost SILENTLY with the job still reported as sent.
// That was data loss on a real bill, so a hard stop stays — a mis-set printer
// must degrade into a page break, never into a missing half of a bill.
//
// Why 280mm. It sits just under a 297mm roll form, leaving a margin for the
// device's own unprintable lead-in, and it is far enough above a normal bill
// that pagination is rare (~28 items at the measured ~9.8mm per line).
//
// This is the opposite failure to the 2026-09-17 runaway feed (a 1200mm page
// fed 1.2m of blank per slip): there the page was far LONGER than the content,
// here the content outgrows what one page may be. Both are fixed by the page
// tracking the content — with this ceiling as the safety stop.
const MAX_HEIGHT_MICRONS = 280_000; // 280mm

/**
 * The page height for ONE slip, derived from its measured content height so
 * the printer advances the paper the slip actually needs — never a fixed
 * guess. `contentPx` is the paint probe's `document.body.scrollHeight`.
 */
export function pageHeightMicronsOf(contentPx: number): number {
  if (!Number.isFinite(contentPx) || contentPx <= 0) return MIN_HEIGHT_MICRONS;
  const microns = Math.round(contentPx * MICRONS_PER_CSS_PX) + PAGE_HEIGHT_TAIL_MICRONS;
  return Math.min(MAX_HEIGHT_MICRONS, Math.max(MIN_HEIGHT_MICRONS, microns));
}

/**
 * "80x36mm" — the page the printer was actually told to use, for the field
 * log. When a slip comes out too long this is the only number that settles it;
 * two rounds of this bug were lost inferring it from the content height
 * instead of recording it (2026-09-19). "printer default" means no width could
 * be read from the document and the driver's own paper was used.
 */
export function pageLabelOf(html: string, contentPx: number): string {
  const w = pageWidthMicronsOf(html);
  if (w === null) return "printer default";
  return `${Math.round(w / 1000)}x${Math.round(pageHeightMicronsOf(contentPx) / 1000)}mm`;
}

/** The slip's paper width in microns, or null when the rule cannot be read. */
export function pageWidthMicronsOf(html: string): number | null {
  const m = PAGE_WIDTH_RE.exec(html);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase() as keyof typeof MICRONS_PER;
  if (!Number.isFinite(value) || value <= 0 || !MICRONS_PER[unit]) return null;
  const microns = Math.round(value * MICRONS_PER[unit]);
  if (microns < MIN_WIDTH_MICRONS || microns > MAX_WIDTH_MICRONS) return null;
  return microns;
}

/**
 * Sends the already-drawn slip through the Windows driver. Resolves when
 * Chromium reports the job handed over; rejects with a sanitized reason.
 */
export async function printThroughDriver(
  win: BrowserWindow,
  html: string,
  probe: PaintProbe,
  deviceName: string,
  log: Logger,
): Promise<void> {
  // The roll width the slip was drawn for. Logged so a blank-paper report can
  // be diagnosed from the field log alone: a null here means the job fell back
  // to the driver's own default, which is where A4-on-an-80mm-roll comes from.
  const pageWidthMicrons = pageWidthMicronsOf(html);
  if (pageWidthMicrons === null) {
    log.info(`print job (${html.length} chars): no @page width found, using the printer's default page size`);
  }
  // A slip taller than one page is split across pages by Chromium. On a
  // continuous roll that is invisible and fine — but it is ALSO the shape of
  // the 2026-09-19 data loss, where the driver's Letter page ended and the
  // remaining items were never printed at all. So it is recorded: if a bill
  // ever comes up short again, this line says whether it was multi-page.
  const contentMicrons = Math.round(probe.height * MICRONS_PER_CSS_PX);
  if (contentMicrons > MAX_HEIGHT_MICRONS) {
    log.info(
      `print job (${html.length} chars): slip is ${Math.round(contentMicrons / 1000)}mm, longer than one ${MAX_HEIGHT_MICRONS / 1000}mm page — it will print across ${Math.ceil(contentMicrons / MAX_HEIGHT_MICRONS)} pages`,
    );
  }

  await new Promise<void>((resolve, reject) => {
    win.webContents.print(
      {
        silent: true,
        printBackground: true,
        // NO printer margin. `margins` defaults to marginType "default", which
        // is Chromium's ~10mm page margin — and on a thermal roll that lands
        // as blank paper fed before the slip even starts, on top of whatever
        // unprintable lead-in the device already has. The owner measured ~7cm
        // of leading blank on 2026-09-19 with the default in place.
        // The slip supplies its own spacing: the @page rule asks for 4mm and
        // the receipt component adds its own padding, so nothing is clipped by
        // removing this. Width is unaffected — that was already correct.
        margins: { marginType: "none" },
        // The slip's REAL roll width, read from its own @page rule, so the
        // layout is composed on the paper that is actually loaded. Falls back
        // to asking the driver only when the rule cannot be read — and that
        // fallback is the weaker one: a thermal driver that reports no default
        // makes Electron use A4, which on an 80mm roll prints blank.
        // `pageSize` and `usePrinterDefaultPageSize` are mutually exclusive
        // (Electron rejects the pair), hence the either/or below.
        ...(pageWidthMicrons !== null
          ? { pageSize: { width: pageWidthMicrons, height: pageHeightMicronsOf(probe.height) } }
          : { usePrinterDefaultPageSize: true }),
        // Always explicit: the handler refuses the job before this point
        // unless a real printer has been chosen.
        deviceName,
      },
      (ok, reason) => (ok ? resolve() : reject(new Error(sanitizeFailureReason(reason)))),
    );
  });
}
