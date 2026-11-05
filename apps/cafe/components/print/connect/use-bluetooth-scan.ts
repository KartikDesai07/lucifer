import { useState } from "react";

import { SCAN_SHOWN_NONE, bluetoothScanOf, type ScanShown } from "@/lib/printer/bluetooth-scan";
import { nativeRequest } from "@/lib/printer/native-bridge";

// The Bluetooth list's scan outcome (PX-3 Task 13): the app's own sentence inline, or a refusal for Location (Allow, then the
// Settings steps). `scan` is the list hook's (its error, null when it listed, undefined when it did nothing; never toasts).
// The decisions are lib/printer/bluetooth-scan.ts's; its one scanner lives as long as the list (the final review's I2: its
// `asked` and its one Allow at a time).
export function useBluetoothScan(scan: () => Promise<unknown>) {
  const [shown, setShown] = useState<ScanShown>(SCAN_SHOWN_NONE);
  const [scanner] = useState(() => bluetoothScanOf(setShown));
  const search = (): void => void scanner.search(scan);
  const allowLocation = (): Promise<void> => scanner.allowLocation(scan, () => nativeRequest("permissions.request", { kind: "bluetooth" }));
  return { scanError: shown.error, scanRefusal: shown.refusal, search, allowLocation };
}
