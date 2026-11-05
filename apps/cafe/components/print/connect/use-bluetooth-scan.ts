import { useState } from "react";

import { nativeRequest } from "@/lib/printer/native-bridge";
import { scanRefusalOf, type ScanRefusal } from "@/lib/printer/native-picker-state";
import { nativeErrorMessage } from "@/lib/printer/transport-native";

// The Bluetooth list's scan outcome (PX-3 Task 13): the app's own sentence inline, or a refusal for Location (Allow, then the
// Settings steps). `scan` is the list hook's (it resolves to the scan's error or null and never toasts).
export function useBluetoothScan(scan: () => Promise<unknown>) {
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanRefusal, setScanRefusal] = useState<ScanRefusal | null>(null);
  // Set once an Allow came back refused: Android will not ask twice, so the next refusal shows the steps.
  const [asked, setAsked] = useState(false);
  const search = (wasAsked = asked): void => {
    setScanError(null);
    setScanRefusal(null);
    void scan().then((failed) => {
      const refusal = failed === null ? null : scanRefusalOf(failed, wasAsked);
      setScanRefusal(refusal);
      setScanError(failed === null || refusal !== null ? null : nativeErrorMessage(failed));
    });
  };
  const allowLocation = async (): Promise<void> => {
    try {
      const { granted } = await nativeRequest("permissions.request", { kind: "bluetooth" });
      if (granted) search();
      else {
        setAsked(true);
        setScanRefusal("settings-steps");
      }
    } catch (error) {
      setScanRefusal(null);
      setScanError(nativeErrorMessage(error));
    }
  };
  return { scanError, scanRefusal, search, allowLocation };
}
