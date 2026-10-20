import type { PrintHostState } from "@pos/shared/print-job";

// The nav's second lines (design 5.2): the brand block reads "{product name} · {this device's name}" and the user card
// "{role} · {this device's name}", the HTML's "Sandbee POS · Counter 1". A device's name is the one typed under "Name
// for this device" in the printer panel, which the server keeps on the printing device (PrintHost.label), so only that
// device has one; every other device shows the lead alone. Pure, so the rule is unit-tested (lib/nav-device-name.test.ts).

/** This device's print name, or null when it has none. */
export function navDeviceName(host: PrintHostState | null | undefined, deviceId: string): string | null {
  if (!host || !host.configured || deviceId === "" || host.deviceId !== deviceId) return null;
  const label = host.label?.trim() ?? "";
  return label === "" ? null : label;
}

/** "{lead} · {device name}", or the lead alone when the device has no name. */
export function navSubline(lead: string, deviceName: string | null): string {
  return deviceName === null ? lead : `${lead} · ${deviceName}`;
}
