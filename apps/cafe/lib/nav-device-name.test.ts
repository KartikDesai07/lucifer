import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrintHostState } from "@pos/shared/print-job";

import { navDeviceName, navSubline } from "@/lib/nav-device-name";

// U0 Task 2 (design 5.2): the nav's brand line reads "{product name} · {this device's print name}" and the user card
// "{role} · {this device's print name}", the HTML's "Sandbee POS · Counter 1" / "Manager · Counter 1". The name is the
// one typed under "Name for this device" in the printer panel, stored on the printing device (PrintHost.label).

const HOST: PrintHostState = {
  configured: true,
  deviceId: "dev-1",
  label: "Counter PC",
  lastSeenAt: null,
  offline: false,
  silentMode: true,
  printer: null,
};

test("navDeviceName: the printing device's own name, only on that device", () => {
  assert.equal(navDeviceName(HOST, "dev-1"), "Counter PC", "the printing device shows its name");
  assert.equal(navDeviceName(HOST, "dev-2"), null, "another device has no name of its own");
  assert.equal(navDeviceName(HOST, ""), null, "a device with no id has no name");
  assert.equal(navDeviceName({ ...HOST, configured: false }, "dev-1"), null, "no printing device set: no name");
  assert.equal(navDeviceName({ ...HOST, label: null }, "dev-1"), null, "a printing device without a name: no name");
  assert.equal(navDeviceName({ ...HOST, label: "   " }, "dev-1"), null, "a blank name is no name");
  assert.equal(navDeviceName({ ...HOST, label: "  Bar  " }, "dev-1"), "Bar", "the name is trimmed");
  assert.equal(navDeviceName(null, "dev-1"), null, "a degraded pulse tick: no name");
  assert.equal(navDeviceName(undefined, "dev-1"), null, "no pulse yet: no name");
});

test("navSubline: the lead, then ' · ' and the device name when there is one", () => {
  assert.equal(navSubline("Sandbee POS", "Counter PC"), "Sandbee POS · Counter PC", "the HTML's line with our device");
  assert.equal(navSubline("Sandbee POS", null), "Sandbee POS", "only the product name when the device has no name");
  assert.equal(navSubline("Admin", "Bar"), "Admin · Bar", "the user card's role line");
});
