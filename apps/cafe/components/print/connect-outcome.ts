import { toast } from "sonner";

import { CONNECT_ADDED, CONNECT_ADD_FAILED } from "@/lib/printer/connect-flow";
import { PRINTER_CONNECT_FAILED_MESSAGE, devicePrinter, type ConnectOutcome } from "@/lib/printer/device-printer";

export const PRINTER_CONNECTED_MESSAGE = "Printer connected.";

// A thrown attempt in its own words, else the connect-failed sentence (both toasts below).
const thrownWordsOf = (error: unknown): string => (error instanceof Error ? error.message : PRINTER_CONNECT_FAILED_MESSAGE);

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
    toast.error(thrownWordsOf(error));
    return null;
  }
}

/** Today's toast for Connect another printer (OtherDevicePrinters' add before PX-3: its added / not connected yet words),
 *  for an add that ends after staff left the guided connect (the final review's m1). Never rejects. */
export function toastAddOutcome(attempt: Promise<ConnectOutcome>): Promise<void> {
  return attempt.then(
    (outcome) => {
      if (outcome === "connected") toast.success(CONNECT_ADDED);
      else toast.error(CONNECT_ADD_FAILED);
    },
    (error: unknown) => {
      toast.error(thrownWordsOf(error));
    },
  );
}
