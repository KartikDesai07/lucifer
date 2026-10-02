import { toast } from "sonner";

import { PRINTER_CONNECT_FAILED_MESSAGE, devicePrinter, type ConnectOutcome } from "@/lib/printer/device-printer";

export const PRINTER_CONNECTED_MESSAGE = "Printer connected.";

// Waits for a connect attempt the CLICK already started (a chooser or a
// reconnect needs the tap's user activation, so the caller makes the call) and
// tells the operator how it ended. Never rejects: a thrown attempt reads as the
// connect-failed sentence. A cancelled chooser is silent.
export async function toastConnectOutcome(attempt: Promise<ConnectOutcome>): Promise<ConnectOutcome | null> {
  try {
    const outcome = await attempt;
    if (outcome === "connected") toast.success(PRINTER_CONNECTED_MESSAGE);
    else if (outcome === "failed") toast.error(devicePrinter().getSnapshot().message ?? PRINTER_CONNECT_FAILED_MESSAGE);
    return outcome;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : PRINTER_CONNECT_FAILED_MESSAGE);
    return null;
  }
}
