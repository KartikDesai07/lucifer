// Constants shared across the main process modules. Preloads run sandboxed and
// may only `require("electron")`, so they duplicate these literals rather than
// importing this file — pins assert the duplicated literals stay equal.

export const APP_ID = "com.possoftware.pos-desktop";
// Vendor branding (owner decision 2026-09-07): the shell is "POS Software by sandbee";
// "sandbee" is the software vendor, never a cafe — cafe branding stays in the web app.
export const PRODUCT_NAME = "POS Software by sandbee";
export const VENDOR_NAME = "sandbee";

export const PRINT_CHANNEL = "pos-desktop:print-html";
// 2026-09-17: silent printing went to the WINDOWS DEFAULT printer because
// `deviceName` was null and there was no picker (it was "hand-edited on disk"
// in v1). On a counter PC whose default is a virtual device — Microsoft Print
// to PDF, OneNote, XPS, Fax — every slip vanished into it: no error, no paper,
// while the browser print dialog still worked because the operator picks the
// printer there. These two channels give the web app a real picker.
export const PRINTERS_CHANNEL = "pos-desktop:printers";
export const PRINTER_SAVE_CHANNEL = "pos-desktop:printer-save";
// 2026-09-19: HOW a slip reaches the printer. "direct" rasterizes the drawn
// slip and sends ESC/POS bytes RAW to the Windows queue, so the paper is
// exactly as long as the slip whatever paper size the driver is set to.
// "driver" is the old lane (webContents.print through the GDI driver), kept
// only as a fallback for a printer that does not understand ESC/POS. It is
// the fallback and not the default because of what was MEASURED on the
// counter PC's POS80: the driver ignores the page size the app asks for and
// prints on its own fixed form — a 4cm slip came out on a 297mm page, and a
// 32-item bill was cut short on a Letter page. No per-client driver
// configuration can make that lane dynamic; the direct lane needs none.
export const PRINT_MODE_SAVE_CHANNEL = "pos-desktop:print-mode-save";
export const PRINT_MODES = ["direct", "driver"] as const;
export type PrintMode = (typeof PRINT_MODES)[number];
export const DEFAULT_PRINT_MODE: PrintMode = "direct";

/** True for one of the two stored print modes; anything else is not stored. */
export function isPrintMode(value: unknown): value is PrintMode {
  return typeof value === "string" && (PRINT_MODES as readonly string[]).includes(value);
}
export const URL_CURRENT_CHANNEL = "pos-desktop:url-current";
export const URL_SAVE_CHANNEL = "pos-desktop:url-save";
export const URL_CANCEL_CHANNEL = "pos-desktop:url-cancel";

export const BRIDGE_KEY = "posDesktop";
export const SETUP_BRIDGE_KEY = "posDesktopSetup";

export const VERSION_ARG_PREFIX = "--pos-desktop-version=";
export const HIDDEN_FLAG = "--hidden";

export const POS_PARTITION = "persist:pos";
export const PRINT_PARTITION = "print"; // no persist: prefix — in-memory only

export const PRINT_HTML_MAX_CHARS = 1_500_000;
// A Windows printer name is short; anything longer is not a device name and
// is refused rather than stored.
export const PRINTER_NAME_MAX_CHARS = 256;

// Devices that consume a slip WITHOUT putting ink on paper (owner rule
// 2026-09-17: "file save ya printer ka dialog open ho raha hai, wo nahi hona
// chahiye"). Two distinct harms, both observed on a real counter PC:
//   · a "nul:" port device (OneNote) swallows the job silently — the operator
//     sees an automatic print and blank/no paper, and nothing is logged wrong;
//   · a "PORTPROMPT:" device (Microsoft Print to PDF, XPS Document Writer)
//     pops a SAVE-FILE dialog, which is exactly what must never appear on an
//     unattended counter PC — it also wedges the job until someone dismisses it.
// Electron's PrinterInfo exposes no port on Windows (`options` comes back
// empty), so the port cannot be read at runtime and these are matched by name.
// Matching is case-insensitive and substring-based so localised and
// "(Desktop)"/"(redirected)" variants are covered too. This is a SAFETY NET,
// not the primary control — the primary control is that a printer must be
// chosen explicitly before anything prints at all.
export const NON_PAPER_PRINTER_PATTERNS: readonly string[] = [
  "print to pdf",
  "xps document writer",
  "onenote",
  "fax",
  "adobe pdf",
  "pdfcreator",
  "send to onenote",
];

/** True when this device name is a known file/virtual target, not real paper. */
export function isNonPaperPrinter(name: string): boolean {
  const lower = name.toLowerCase();
  return NON_PAPER_PRINTER_PATTERNS.some((p) => lower.includes(p));
}
export const PRINT_JOB_TIMEOUT_MS = 30_000;
export const FONTS_READY_MAX_MS = 3_000;
// After the load and the fonts wait, the print window must PROVE it has drawn
// the slip (two animation frames, then visible body text) before anything is
// sent to the printer; past this the document is probed directly and an empty
// one is refused rather than printed blank (2026-09-11).
export const PAINT_READY_MAX_MS = 2_000;
// Chromium refuses to navigate a data: URL longer than ~2 MB; the ENCODED slip
// (encodeURIComponent grows markup and ₹/× glyphs several-fold) must stay under
// that with headroom, or loadURL fails with an opaque error.
export const DATA_URL_MAX_CHARS = 1_900_000;
export const RETRY_LOAD_MS = 5_000;
// If the first paint never comes (server unreachable at launch, ready-to-show
// never fires), the window is shown anyway so the operator is not left with
// an invisible app and only a tray icon.
export const READY_TO_SHOW_FALLBACK_MS = 4_000;
export const LOAD_ABORTED_CODE = -3; // ERR_ABORTED: a superseded navigation, not a real failure

export const BOUNDS_SAVE_DEBOUNCE_MS = 500;
// shell.openExternal is never user-gesture-gated in Electron: throttle it so a
// misbehaving page cannot flood the default browser with windows.
export const OPEN_EXTERNAL_MIN_INTERVAL_MS = 2_000;
// A printer driver's failure reason is a short English string from Chromium;
// anything longer or non-printable is not forwarded (log, IPC, notification).
export const PRINT_FAILURE_REASON_MAX_CHARS = 120;
export const PRINT_FAILED_PREFIX = "Printing failed: ";

export const LOG_MAX_BYTES = 512 * 1024;
export const LOG_FILE_NAME = "pos-desktop.log";

// The product icon shown on every window, the taskbar entry and the About
// dialog. Lives under assets/ (NOT resources/, which build.files does not
// package) so it is present in the installed app too. The exe carries its own
// embedded icon for Explorer; this is for the places Windows does not take
// that from — window chrome, alt-tab, and dialogs. Owner 2026-09-19: the
// product logo must appear everywhere OUTSIDE the loaded web page; inside the
// page the cafe's own branding still wins.
export const APP_ICON_FILE = "app-icon.png";
