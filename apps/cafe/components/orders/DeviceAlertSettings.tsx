"use client";

import { useEffect, useState } from "react";

import { ToggleRow } from "@/components/settings/SettingsFields";
import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import {
  readDevicePrefs,
  writeDevicePrefs,
  type PosDevicePrefs,
} from "@/lib/pos-device-prefs";

const DEFAULT_PREFS: PosDevicePrefs = { autoPrintSelfOrders: false, alertSound: true, printHost: false, printHostSeen: false };

// Print-host plan A-13 (PH-7): on the designated host the layout-level host
// lane already prints every accepted self-order, and a page lane switched on
// here would race it on the claim — so the toggle is disabled there AND shown
// off. The stored value is left as-is (it comes back when the host is cleared);
// since the PH-11 gate the page lane itself yields on a host device
// (use-self-order-auto-print.ts), so a pre-designation ON can no longer race.
const AUTO_PRINT_DESCRIPTION =
  "Print the kitchen ticket automatically when a diner's self-order is accepted, on this device only.";
const HOST_AUTO_PRINT_NOTE =
  "This device is the print host — self-orders already print here through the host lane, so this toggle stays off.";

// CR2.3 §20 — per-DEVICE (not per-cafe) alert/auto-print toggles, shown in
// the Device settings dialog on /requests (PH-10b — a card inside a dialog
// is wrong, so this renders as a bare div there). Read on mount (never
// during the server render — these come from localStorage, which doesn't
// exist there) so the counter tablet and the back-office laptop can each opt
// in differently.
export function DeviceAlertSettings() {
  const { unlock } = usePosPulseContext();
  const { isHostDevice } = usePrintHostContext();
  const [prefs, setPrefs] = useState<PosDevicePrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setPrefs(readDevicePrefs());
  }, []);

  // Merges over a FRESH read, never over `prefs` (a mount-time snapshot):
  // PH-4 grew this blob with printHost/printHostSeen, which useHostRouting's
  // own effect persists while this screen is mounted, so writing the whole
  // object back from stale state would silently revert the print-host lane
  // (the reciprocal half of that hook's own read-modify-write).
  const update = (next: Partial<PosDevicePrefs>) => {
    const merged = { ...readDevicePrefs(), ...next };
    setPrefs(merged);
    writeDevicePrefs(merged);
  };

  return (
    <div className="space-y-4">
      <ToggleRow
        label="Alert sound"
        description="Ping when a new request or self-order arrives, on this device only."
        checked={prefs.alertSound}
        onChange={(checked) => {
          update({ alertSound: checked });
          // Turning sound ON is itself a user gesture — unlock right here
          // instead of waiting for a separate click elsewhere.
          if (checked) unlock();
        }}
      />
      <ToggleRow
        label="Auto-print self-orders"
        description={isHostDevice ? HOST_AUTO_PRINT_NOTE : AUTO_PRINT_DESCRIPTION}
        checked={prefs.autoPrintSelfOrders && !isHostDevice}
        disabled={isHostDevice}
        onChange={(checked) => update({ autoPrintSelfOrders: checked })}
      />
    </div>
  );
}
