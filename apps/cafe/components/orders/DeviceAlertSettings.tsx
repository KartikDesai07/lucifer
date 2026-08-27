"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleRow } from "@/components/settings/SettingsFields";
import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import {
  readDevicePrefs,
  writeDevicePrefs,
  type PosDevicePrefs,
} from "@/lib/pos-device-prefs";

const DEFAULT_PREFS: PosDevicePrefs = { autoPrintSelfOrders: false, alertSound: true };

// CR2.3 §20 — per-DEVICE (not per-cafe) alert/auto-print toggles, shown on
// the /requests page. Read on mount (never during the server render — these
// come from localStorage, which doesn't exist there) so the counter tablet
// and the back-office laptop can each opt in differently.
export function DeviceAlertSettings() {
  const { unlock } = usePosPulseContext();
  const [prefs, setPrefs] = useState<PosDevicePrefs>(DEFAULT_PREFS);

  useEffect(() => {
    setPrefs(readDevicePrefs());
  }, []);

  const update = (next: Partial<PosDevicePrefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    writeDevicePrefs(merged);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">This device&apos;s alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
          description="Print the kitchen ticket automatically when a diner's self-order is accepted, on this device only."
          checked={prefs.autoPrintSelfOrders}
          onChange={(checked) => update({ autoPrintSelfOrders: checked })}
        />
      </CardContent>
    </Card>
  );
}
