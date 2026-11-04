// Where an offline KOT prints on this device (Printing Phase 5, spec 5.3, ruling 15; plan Task 11), and how each of its
// lines reaches its printer. Pure: the hook passes what the device holds (lib/offline-lines.ts offlineHereIds decides).

import { printerWriterDeviceId, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import { offlineHereIds } from "@/lib/offline-lines";
import { nativeIdOf, targetsOf, type DesktopPrinters, type NativePoolView } from "@/lib/print-agent-printers";
import type { HostKotSlip, HostPrintSlip, SlipPrintTarget } from "@/lib/print-host-slips";

export interface OfflineHere {
  /** The printers this device can print an offline line on now. */
  hereIds: string[];
  /** How each of them is reached (a Windows printer, one of the POS app's printers, a network printer of the Windows
   *  app); none for this device's own printer, which the bridge prints on as today. */
  targets: Record<string, SlipPrintTarget>;
  /** The ones it prints for another device: pictures, never text (Phase 4 spec §5.3, as a takeover job). */
  takeoverIds: string[];
}

export function offlineHereOf(input: {
  printers: readonly PrinterConfig[];
  deviceId: string;
  /** readyPrinterIds(): what its agent prints on now. */
  ready: readonly string[];
  desktop: DesktopPrinters | null;
  pool: NativePoolView | null;
}): OfflineHere {
  const network = routablePrinters(input.printers).filter((printer) => printer.connection.kind === "lan");
  const pool = input.pool;
  const appConnected = pool === null ? null : network.filter((printer) => pool.printers.some((entry) => entry.id === nativeIdOf(printer, pool) && entry.status === "connected")).map((printer) => printer.id);
  const hereIds = offlineHereIds({ ready: input.ready, setupNetworkIds: network.map((printer) => printer.id), appConnectedNetworkIds: appConnected, windowsRaw: input.desktop?.lan === true });
  const herePrinters = input.printers.filter((printer) => hereIds.includes(printer.id));
  return {
    hereIds,
    targets: targetsOf(herePrinters, input.desktop, pool),
    takeoverIds: herePrinters.filter((printer) => printerWriterDeviceId(printer) !== input.deviceId).map((printer) => printer.id),
  };
}

/** One line's slip as an online job's slip reaches the bridge (lib/print-agent-slip.ts): it names its printer (the
 *  text switch), carries its target, and is a takeover on a printer it prints for another device. Simple mode's line
 *  (no printer) is the device's own slip, as today. */
export function offlineSlipFor(slip: HostKotSlip, printerId: string | null, here: OfflineHere): HostPrintSlip {
  if (printerId === null) return slip;
  const target = here.targets[printerId];
  return { ...slip, printerId, ...(target !== undefined ? { target } : {}), ...(here.takeoverIds.includes(printerId) ? { takeover: true as const } : {}) };
}
