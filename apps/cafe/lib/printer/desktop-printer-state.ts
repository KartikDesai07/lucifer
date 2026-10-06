import { desktopPrinterApi } from "@/lib/desktop-shell-printer";

// Whether the Windows desktop shell has a printer CHOSEN. The shell refuses
// every job while none is chosen (apps/desktop/src/print.ts), so a PC in that
// state must not read "connected" and must not burn a slip claim:
//   unknown - the shell predates listPrinters/savePrinter, or nothing was read
//             yet (treated exactly as before this store existed: can print)
//   none    - the shell says no printer is chosen
//   chosen  - a printer is chosen
// A module store (subscribe / snapshot) so the hooks and the call-time lane
// functions read ONE value. It refreshes on the first subscribe and whenever
// the picker saves a choice (publishDesktopPrinterSelection, then a refresh).
// Phase 2 Session 2E (spec §9.2): it also keeps the chosen printer's NAME and
// every printer Windows reports on this PC, so the page knows which of the
// outlet's Windows printers this PC prints (lib/print-agent-printers.ts).
export type DesktopChosen = "unknown" | "none" | "chosen";

export const SERVER_DESKTOP_CHOSEN: DesktopChosen = "unknown";

/** One immutable value, replaced on every change (a stable useSyncExternalStore snapshot). */
export interface DesktopPrinterSnapshot {
  chosen: DesktopChosen;
  /** The chosen printer's name; null when none is chosen or nothing was read. */
  selected: string | null;
  /** Every printer Windows reports on this PC, by name; null until read. */
  names: readonly string[] | null;
}

export const SERVER_DESKTOP_SNAPSHOT: DesktopPrinterSnapshot = { chosen: SERVER_DESKTOP_CHOSEN, selected: null, names: null };

let current: DesktopPrinterSnapshot = SERVER_DESKTOP_SNAPSHOT;
// Bumped by every read, so a slow earlier read can never overwrite a later one.
let readTicket = 0;
const listeners = new Set<() => void>();

// The shell's "selected" field: null / "" = nothing chosen, a name = chosen, anything else = cannot tell.
function chosenOf(selected: unknown): DesktopChosen {
  if (selected === null || selected === "") return "none";
  return typeof selected === "string" ? "chosen" : "unknown";
}

function selectedOf(selected: unknown): string | null {
  return typeof selected === "string" && selected !== "" ? selected : null;
}

function namesOf(printers: unknown): readonly string[] | null {
  if (!Array.isArray(printers)) return null;
  return printers.map((printer: unknown) => (printer as { name?: unknown } | null)?.name).filter((name): name is string => typeof name === "string" && name !== "");
}

function sameNames(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

function publish(next: DesktopPrinterSnapshot): void {
  if (next.chosen === current.chosen && next.selected === current.selected && sameNames(next.names, current.names)) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

export function desktopChosen(): DesktopChosen {
  return current.chosen;
}

/** Phase 2 Session 2E: the chosen printer, its name and this PC's printers, as one stable value. */
export function desktopPrinterSnapshot(): DesktopPrinterSnapshot {
  return current;
}

/** Re-read the choice from the shell. A failed read keeps the last known value. */
export async function refreshDesktopPrinterChosen(): Promise<DesktopChosen> {
  const ticket = ++readTicket;
  const api = desktopPrinterApi();
  if (api === null) {
    publish(SERVER_DESKTOP_SNAPSHOT);
    return current.chosen;
  }
  try {
    const { selected, printers } = await api.listPrinters();
    if (ticket !== readTicket) return current.chosen;
    publish({ chosen: chosenOf(selected), selected: selectedOf(selected), names: namesOf(printers) });
  } catch {
    // Unreadable right now: keep what we knew rather than flip the dot.
  }
  return current.chosen;
}

/** Follow what the shell just answered to a save (savePrinter's `selected`) without reading the
 *  shell again, so a failing follow-up read cannot leave the store on the old choice. Bumps the
 *  ticket so a slower read that started earlier cannot overwrite it. The printer list stays. */
export function publishDesktopPrinterSelection(selected: string | null): void {
  readTicket += 1;
  publish({ ...current, chosen: chosenOf(selected), selected: selectedOf(selected) });
}

export function subscribeDesktopPrinterChosen(onChange: () => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) void refreshDesktopPrinterChosen();
  return () => {
    listeners.delete(onChange);
  };
}

/** Test seam: back to the never-read state. */
export function resetDesktopPrinterChosen(): void {
  readTicket += 1;
  listeners.clear();
  current = SERVER_DESKTOP_SNAPSHOT;
}
