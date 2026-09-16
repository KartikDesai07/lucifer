// Constants shared across the main process modules. Preloads run sandboxed and
// may only `require("electron")`, so they duplicate these literals rather than
// importing this file — pins assert the duplicated literals stay equal.

export const APP_ID = "com.possoftware.pos-desktop";
// Vendor branding (owner decision 2026-09-07): the shell is "POS Software by sandbee";
// "sandbee" is the software vendor, never a cafe — cafe branding stays in the web app.
export const PRODUCT_NAME = "POS Software by sandbee";
export const VENDOR_NAME = "sandbee";

export const PRINT_CHANNEL = "pos-desktop:print-html";
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
