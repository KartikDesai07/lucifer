import type { NativeBluetoothState } from "@/lib/printer/native-bridge-protocol";
import { canScanBluetooth, scanRefusalOf, type ScanRefusal } from "@/lib/printer/native-picker-state";
import { nativeErrorMessage } from "@/lib/printer/transport-native";

// The guided connect's Bluetooth scan decisions (PX-3 Task 13; the final review's I2 and m3), kept pure so they are unit-
// tested (lib/printer/bluetooth-scan.test.ts): what the list says after a scan (the app's own sentence inline, or a refusal
// for Location: Allow, then the Settings steps), the Allow tap, and when the list scans by itself. The hook that holds what
// it shows: components/print/connect/use-bluetooth-scan.ts.

export interface ScanShown {
  /** Why the last scan did not list (the app's own words). */
  error: string | null;
  refusal: ScanRefusal | null;
}
export const SCAN_SHOWN_NONE: ScanShown = { error: null, refusal: null };

/** What the list shows once a scan answered (the list hook's scan: its error, null when it listed). `undefined` is a scan
 *  that did nothing (another job held the list): nothing changes, so a tap during a running scan never clears that scan's
 *  outcome. Nothing is cleared before a scan answers either: while one runs the list hides both lines. */
export function scanShownOf(failed: unknown, asked: boolean): ScanShown | undefined {
  if (failed === undefined) return undefined;
  if (failed === null) return SCAN_SHOWN_NONE;
  const refusal = scanRefusalOf(failed, asked);
  return { error: refusal !== null ? null : nativeErrorMessage(failed), refusal };
}

export interface BluetoothScan {
  search(scan: () => Promise<unknown>): Promise<void>;
  /** Android's Location ask (`ask`, permissions.request), then a scan when granted. */
  allowLocation(scan: () => Promise<unknown>, ask: () => Promise<{ granted: boolean }>): Promise<void>;
}

/** One list's scanner. `asked`: an Allow came back refused, and Android will not ask twice, so the next refusal shows the
 *  steps. One Allow at a time: a double tap asks Android once and scans once. */
export function bluetoothScanOf(show: (next: ScanShown) => void): BluetoothScan {
  let asked = false;
  let allowing = false;
  const search = async (scan: () => Promise<unknown>): Promise<void> => {
    const next = scanShownOf(await scan(), asked);
    if (next !== undefined) show(next);
  };
  const allowLocation = async (scan: () => Promise<unknown>, ask: () => Promise<{ granted: boolean }>): Promise<void> => {
    if (allowing) return;
    allowing = true;
    try {
      const { granted } = await ask();
      if (granted) await search(scan);
      else {
        asked = true;
        show({ error: null, refusal: "settings-steps" });
      }
    } catch (error) {
      show({ error: nativeErrorMessage(error), refusal: null });
    } finally {
      allowing = false;
    }
  };
  return { search, allowLocation };
}

/** The list's automatic scan (spec §6.7 item 2: it starts by itself; today's 8 s Find printers). `seen`: the Bluetooth state
 *  the last decision was made for (undefined before the first). Once when the first list has answered, unless Bluetooth is
 *  known to be unusable (its notice says why); once more when Bluetooth turns usable (Turn on or Allow Bluetooth, or
 *  Android's own switch: off or not allowed, then on). */
export function autoScanOf(seen: NativeBluetoothState | null | undefined, now: NativeBluetoothState | null): boolean {
  if (seen === undefined) return canScanBluetooth(now);
  return (seen === "off" || seen === "unauthorized") && now === "on";
}
