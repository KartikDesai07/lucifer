import type { PrinterHere } from "@/lib/print-agent-here";
import type { ConnectOutcome } from "@/lib/printer/web-printer-types";

// Printer UX PX-2 (spec §6.5, F-M5): the status card's one Reconnect reconnects exactly the printers of this device that
// are down (the view's `subject`), in the setup's order, one after the other: the client's tablet reconnected its default
// printer while the Kitchen printer stayed down. The first call is made inside the tap, before anything is awaited, so a
// browser's printer still has the tap's user activation for its chooser. Pure: the reconnects arrive as deps.

/** This device's own printer (simple mode: an empty subject), as the toast names it. */
export const THIS_DEVICE_PRINTER = "the printer";

export interface ReconnectResult {
  connected: string[];
  failed: string[];
}

export interface ReconnectDeps {
  /** devicePrinter().reconnect(): this device's one printer. */
  device(): Promise<ConnectOutcome>;
  /** nativePool().reconnect(id): one of the POS app's printers. */
  native(id: string): Promise<ConnectOutcome>;
}

// A call that throws at once is a failure like one that rejects: the tap never sees a throw.
function attempt(run: () => Promise<ConnectOutcome>): Promise<ConnectOutcome> {
  try {
    return run();
  } catch (error) {
    return Promise.reject(error);
  }
}

export function reconnectDown(subject: readonly PrinterHere[], deps: ReconnectDeps): Promise<ReconnectResult> {
  const steps =
    subject.length === 0
      ? [{ name: THIS_DEVICE_PRINTER, run: () => deps.device() }]
      : subject
          .filter((printer) => printer.status !== "connected")
          .map((printer) => ({ name: printer.name, run: () => (printer.nativeId !== undefined ? deps.native(printer.nativeId) : deps.device()) }));
  const result: ReconnectResult = { connected: [], failed: [] };
  // A closed chooser ("cancelled") is neither: it says nothing (today's toastConnectOutcome, F-M5).
  const settle = (name: string, outcome: Promise<ConnectOutcome>): Promise<void> =>
    outcome.then(
      (said) => {
        if (said === "connected") result.connected.push(name);
        else if (said === "failed") result.failed.push(name);
      },
      () => {
        result.failed.push(name);
      },
    );
  const [first, ...rest] = steps;
  // The first call is made now, inside the caller's tap; each next one only after the one before has settled.
  let chain = first === undefined ? Promise.resolve() : settle(first.name, attempt(first.run));
  for (const step of rest) chain = chain.then(() => settle(step.name, attempt(step.run)));
  return chain.then(() => result);
}

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** The one toast at the end (spec §6.5): any failed → the failed ones; else the connected ones. The caller says nothing
 *  when neither list has a name (every chooser was closed). */
export function reconnectToastOf(result: ReconnectResult): { tone: "success" | "error"; text: string } {
  if (result.failed.length > 0) return { tone: "error", text: `Could not connect ${result.failed.join(", ")}. Check it is on, then tap Reconnect again.` };
  return { tone: "success", text: sentence(`${result.connected.join(", ")} connected.`) };
}
