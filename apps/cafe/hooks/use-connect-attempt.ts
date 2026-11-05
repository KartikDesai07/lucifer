"use client";

import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { useOwnPrinterInSetup } from "@/hooks/use-agent-printers";
import { useNativePool } from "@/hooks/use-device-printer";
import { useSettings } from "@/hooks/use-settings";
import { printConfigOf } from "@/lib/print";
import { devicePrinter, type ConnectOutcome } from "@/lib/printer/device-printer";
import { nativePool } from "@/lib/printer/native-pool";
import { nativeTargetId, type NativeSelectTarget } from "@/lib/printer/transport-native";

// The guided connect's two calls (PX-3 Task 11, spec §6.7), moved as they were from DevicePrinterSection.tsx (Change
// printer, keepInApp) and OtherDevicePrinters.tsx (Connect another printer): replace makes a printer this device's own,
// add joins the app's printers (bridge v2). Neither toasts: the step says how it ended. Both read only what is cached.

export interface ConnectAttempt {
  replace(target: NativeSelectTarget): Promise<ConnectOutcome>;
  add(target: NativeSelectTarget): Promise<ConnectOutcome>;
}

export function useConnectAttempt(): ConnectAttempt {
  const settings = useSettings();
  const paperDefault = printConfigOf(settings.data).bill.paperWidth;
  const { deviceId } = usePrintHostContext();
  const { inSetup, known } = useOwnPrinterInSetup(deviceId);
  const pool = useNativePool();
  // The 2F2 review gate (M-4): Change printer of a printer the setup prints through this device keeps it in the POS app
  // (bridge v2): a new printer is added first (one the app lists already is only chosen: an add would restart its link),
  // then made this device's printer, and the old one stays among the app's other printers; also while the setup is not
  // known yet (its review, m-F: a setup printer dropped there would wait; one kept costs a Remove). Anywhere else it is
  // replaced, as before.
  const listed = (target: NativeSelectTarget) => pool.printers.some((entry) => entry.id.toLowerCase() === nativeTargetId(target).toLowerCase());
  const keepInApp = pool.active && (inSetup || !known) ? async (target: NativeSelectTarget) => {
    if (!listed(target)) await nativePool().add(target);
    return devicePrinter().selectNative(target, paperDefault);
  } : undefined;
  return {
    replace: (target) => (keepInApp !== undefined ? keepInApp(target) : devicePrinter().selectNative(target, paperDefault)),
    add: (target) => nativePool().add(target),
  };
}
