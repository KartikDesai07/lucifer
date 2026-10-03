import type { NativeBluetoothState, NativePrinter } from "@/lib/printer/native-bridge-protocol";

// The in-app printer picker's state rules, kept pure so they are unit-tested (the panel itself is
// pinned by source checks in lib/printer-ui-paths.test.ts).

/** Find printers (a Bluetooth scan) is offered unless Bluetooth is KNOWN to be unusable. Unknown
 *  (null: the status request failed or has not answered) stays enabled: the scan reports its own error. */
export function canScanBluetooth(bluetooth: NativeBluetoothState | null): boolean {
  return bluetooth !== "off" && bluetooth !== "unauthorized" && bluetooth !== "unsupported";
}

export interface PickerLoad {
  /** null: the status request failed; keep whatever the panel already shows. */
  bluetooth: NativeBluetoothState | null;
  /** null: the list request failed; `listError` says why. */
  printers: NativePrinter[] | null;
  listError: unknown;
}

/** Status and list are independent requests: one failing never discards the other, so a USB
 *  printer still lists on a tablet whose Bluetooth status cannot be read. */
export async function loadPicker(
  status: () => Promise<{ bluetooth: NativeBluetoothState }>,
  list: () => Promise<NativePrinter[]>,
): Promise<PickerLoad> {
  const [s, l] = await Promise.allSettled([status(), list()]);
  return {
    bluetooth: s.status === "fulfilled" ? s.value.bluetooth : null,
    printers: l.status === "fulfilled" ? l.value : null,
    listError: l.status === "rejected" ? l.reason : null,
  };
}

/** Orders Bluetooth-state writes: a request's reply is dropped when a pushed printer.status event
 *  arrived after the request started (the event is newer). */
export function createStatusOrder(): { event(): void; start(): number; fresh(startedAt: number): boolean } {
  let events = 0;
  return {
    event() {
      events += 1;
    },
    start() {
      return events;
    },
    fresh(startedAt) {
      return startedAt === events;
    },
  };
}
