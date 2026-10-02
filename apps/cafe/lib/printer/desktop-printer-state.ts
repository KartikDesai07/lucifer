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
export type DesktopChosen = "unknown" | "none" | "chosen";

export const SERVER_DESKTOP_CHOSEN: DesktopChosen = "unknown";

let current: DesktopChosen = SERVER_DESKTOP_CHOSEN;
// Bumped by every read, so a slow earlier read can never overwrite a later one.
let readTicket = 0;
const listeners = new Set<() => void>();

// The shell's "selected" field: null / "" = nothing chosen, a name = chosen, anything else = cannot tell.
function chosenOf(selected: unknown): DesktopChosen {
  if (selected === null || selected === "") return "none";
  return typeof selected === "string" ? "chosen" : "unknown";
}

function publish(next: DesktopChosen): void {
  if (next === current) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

export function desktopChosen(): DesktopChosen {
  return current;
}

/** Re-read the choice from the shell. A failed read keeps the last known value. */
export async function refreshDesktopPrinterChosen(): Promise<DesktopChosen> {
  const ticket = ++readTicket;
  const api = desktopPrinterApi();
  if (api === null) {
    publish("unknown");
    return current;
  }
  try {
    const { selected } = await api.listPrinters();
    if (ticket !== readTicket) return current;
    publish(chosenOf(selected));
  } catch {
    // Unreadable right now: keep what we knew rather than flip the dot.
  }
  return current;
}

/** Follow what the shell just answered to a save (savePrinter's `selected`) without reading the
 *  shell again, so a failing follow-up read cannot leave the store on the old choice. Bumps the
 *  ticket so a slower read that started earlier cannot overwrite it. */
export function publishDesktopPrinterSelection(selected: string | null): void {
  readTicket += 1;
  publish(chosenOf(selected));
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
  current = SERVER_DESKTOP_CHOSEN;
}
