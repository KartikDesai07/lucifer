import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import type { NativeTransport } from "@/lib/printer/native-bridge-protocol";

// How a printer connects, in the words a cafe owner knows. The two Bluetooth
// kinds differ only in how they are found (paired first, or nearby), so the
// second says "nearby" instead of a radio name. (Was components/print/printer-type.ts:
// pure words, so lib/printer/settings-view.ts reads them without a component file;
// its unused icons went with the move.)
export const NATIVE_TYPE_LABELS: Record<NativeTransport, string> = {
  "bt-classic": "Bluetooth",
  ble: "Bluetooth (nearby)",
  tcp: "Network",
  usb: "USB",
};
const PC_PRINTER_LABEL = "PC printer";

// Bluetooth / Bluetooth (nearby) / Network / USB / PC printer.
export function printerTypeLabel(printer: DevicePrinter): string {
  if (printer.kind === "ble") return NATIVE_TYPE_LABELS.ble;
  if (printer.kind === "native") return NATIVE_TYPE_LABELS[printer.transport];
  if (printer.bluetoothServiceClassId !== undefined) return NATIVE_TYPE_LABELS["bt-classic"];
  return printer.usbVendorId !== undefined ? NATIVE_TYPE_LABELS.usb : PC_PRINTER_LABEL;
}
