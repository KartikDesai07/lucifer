// Print-standardization plan (.claude/plan/v2/print-standardization-plan.md
// §B3, slice A1) — pure, DOM-free template + copy constants for the
// self-service "POS Printer" kiosk shortcut. No imports from app code: the
// wizard (A2) and its tests both consume this module directly. Generic
// product voice throughout — never a cafe's own name (CLAUDE.md).

export const KIOSK_PRINTING_FLAG = "--kiosk-printing";
const KIOSK_APP_PATH = "/requests";
const KIOSK_USER_DATA_DIR = "%LOCALAPPDATA%\\pos-print-host";

/**
 * The ONE composed kiosk flag string. The .bat builder and the manual-
 * fallback Target string both derive from this — never re-type the literal.
 * The profile-dir VALUE is quoted: %LOCALAPPDATA% expands to a path with a
 * space whenever the Windows username has one, and an unquoted space splits
 * the argument (argv-probed 2026-09-03) — the browser would silently use a
 * truncated profile dir.
 */
export function KIOSK_ARGS(origin: string): string {
  return `${KIOSK_PRINTING_FLAG} --app=${origin}${KIOSK_APP_PATH} --user-data-dir="${KIOSK_USER_DATA_DIR}"`;
}

/** Manual-fallback shortcut Target line: quoted browser path + one space +
 * the same kiosk args (reuses KIOSK_ARGS, never a second copy). */
export function shortcutTargetString(origin: string, browserPath: string): string {
  return `"${browserPath}" ${KIOSK_ARGS(origin)}`;
}

export const CHROME_PATHS: readonly string[] = [
  "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe",
  "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe",
  "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe",
];

export const EDGE_PATHS: readonly string[] = [
  "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe",
  "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe",
];

const BROWSER_MISSING_MESSAGE =
  "Chrome or Edge was not found. Install Google Chrome or Microsoft Edge and run this file again.";

/**
 * Full one-click installer .bat text: locate chrome.exe (3 standard paths),
 * else msedge.exe (2 standard paths), else echo an install message; create
 * the Desktop shortcut "POS Printer.lnk" via a PowerShell WScript.Shell
 * one-liner (Desktop path from [Environment]::GetFolderPath — never a
 * hardcoded user path); then launch once. CRLF endings — joined with the
 * "\r\n" escape sequence, never a literal control character in source.
 */
export function kioskShortcutBat(origin: string): string {
  const args = KIOSK_ARGS(origin);
  const candidatePaths = [...CHROME_PATHS, ...EDGE_PATHS];
  const candidateVars = candidatePaths.map((_, i) => `CAND${i}`);

  // Plain setlocal — delayed expansion would eat "!" inside expanded values
  // (a username like Rock!Star corrupts every path; probed 2026-09-03) and no
  // !var! syntax is used anywhere in this script.
  const lines: string[] = ["@echo off", "setlocal", ""];
  candidatePaths.forEach((exePath, i) => lines.push(`set "${candidateVars[i]}=${exePath}"`));
  lines.push("", 'set "BROWSER="');
  candidateVars.forEach((v) => lines.push(`if not defined BROWSER if exist "%${v}%" set "BROWSER=%${v}%"`));
  lines.push(
    "",
    "if not defined BROWSER (",
    `  echo ${BROWSER_MISSING_MESSAGE}`,
    "  pause",
    "  exit /b 1",
    ")",
    "",
    // The kiosk args carry embedded double quotes (quoted profile dir); inside
    // this cmd-level double-quoted -Command string they must ride as \" so
    // powershell.exe's own CLI parser keeps them literal.
    "powershell -NoProfile -Command " +
      `"$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\\POS Printer.lnk'); $lnk.TargetPath = '%BROWSER%'; $lnk.Arguments = '${args.replace(/"/g, '\\"')}'; $lnk.Save()"`,
    "",
    `start "" "%BROWSER%" ${args}`,
  );
  return lines.join("\r\n");
}

// ── Wizard copy (§B2) — generic product voice, no cafe name anywhere ───────

export interface WizardStepCopy {
  readonly title: string;
  readonly body: string;
}

export const WIZARD_STEPS: readonly WizardStepCopy[] = [
  {
    title: "Device check",
    body: "The print host is always a PC or laptop — this step does not run on a phone or tablet. Set up in this order: install the POS Printer shortcut (step 3), open it and log in, then return to this page inside that window to designate and test — that window has its own browser profile, and the profile you designate is the one that prints.",
  },
  {
    title: "Designate this PC",
    body: "Make this PC the print host — give it a label (for example \"Counter PC\") and save.",
  },
  {
    title: "Kiosk shortcut",
    body: "Download the \"POS Printer\" shortcut and run it from the Desktop — that window is the one that prints. The first time it opens the login page (it has its own browser profile) — log in once and it stays signed in.",
  },
  {
    title: "Silent print status",
    body: "Run a test print from the Print host card at the top of this page, inside the POS Printer window; the confirmation that silent printing is on appears here.",
  },
  {
    title: "Done",
    body: "Setup complete — read the troubleshooting tips below once.",
  },
];

export const WIZARD_TROUBLESHOOTING: readonly string[] = [
  "If the POS Printer window asks you to log in, log in once in that window — it uses a separate browser profile.",
  "After Chrome or Edge updates, run the test print again.",
  "Do not close or fully cover the POS Printer window — prints slow down.",
  "If the internet is down, nothing prints — write the order on paper and reprint when the connection returns.",
  "Dismissing an \"older slip\" only removes it from the list — the order is safe and can be reprinted at any time.",
];
