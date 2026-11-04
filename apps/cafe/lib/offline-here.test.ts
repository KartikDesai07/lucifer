// Where an offline KOT prints on this device (Printing Phase 5, spec 5.3, ruling 15; plan Task 11): the printers it
// writes and can print now, plus the setup's network printers its POS app (bridge v2) reports connected, plus on the
// Windows app 1.12+ every network printer of the setup; each line's slip reaches its printer the way an online job's
// does (its target), names its printer (the text switch), and prints pictures on a printer it prints for another device.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrinterConfig } from "@pos/shared/print-printers";
import { offlineHereOf, offlineSlipFor } from "@/lib/offline-here";
import type { HostKotSlip } from "@/lib/print-host-slips";

const NONE = { bill: false, kotStations: [] as string[], kotAll: true, notices: false, eod: false };
const base = (id: string, connection: PrinterConfig["connection"], primaryDeviceId?: string): PrinterConfig => ({
  id,
  name: id,
  connection,
  ...(primaryDeviceId !== undefined ? { primaryDeviceId } : {}),
  order: 0,
  paper: 80,
  slips: NONE,
  copies: { kot: 1, bill: 1 },
  enabled: true,
});
const OWN_BT = base("pr-own", { kind: "device", deviceId: "me", transport: "bt-classic", address: "AA:BB" });
const LAN_MINE = base("pr-lan-mine", { kind: "lan", host: "192.168.1.50", port: 9100 }, "me");
const LAN_OTHER = base("pr-lan-other", { kind: "lan", host: "192.168.1.51", port: 9100 }, "counter-pc");
const LAN_DOWN = base("pr-lan-down", { kind: "lan", host: "192.168.1.52", port: 9100 }, "counter-pc");
const PRINTERS = [OWN_BT, LAN_MINE, LAN_OTHER, LAN_DOWN];

test("a POS app on bridge v2: what it writes and can print, plus the setup's network printers it reports connected", () => {
  const pool = {
    printers: [
      { id: "bt-classic:aa:bb", status: "connected" as const },
      { id: "tcp:192.168.1.50:9100", status: "connected" as const },
      { id: "tcp:192.168.1.51:9100", status: "connected" as const },
      { id: "tcp:192.168.1.52:9100", status: "disconnected" as const },
    ],
  };
  const here = offlineHereOf({ printers: PRINTERS, deviceId: "me", ready: ["pr-own"], desktop: null, pool });
  assert.deepEqual(here.hereIds, ["pr-own", "pr-lan-mine", "pr-lan-other"], "ready, then the connected network printers; never one that is down");
  assert.deepEqual(here.targets["pr-lan-other"], { nativeId: "tcp:192.168.1.51:9100", paper: "80mm" }, "the app's printer, its paper");
  assert.deepEqual(here.takeoverIds, ["pr-lan-other"], "a printer it prints for another device");
});

test("the Windows app 1.12+: every network printer of the setup (it connects per job)", () => {
  const desktop = { selected: null, names: [], named: true, lan: true };
  const here = offlineHereOf({ printers: PRINTERS, deviceId: "me", ready: [], desktop, pool: null });
  assert.deepEqual([...here.hereIds].sort(), ["pr-lan-down", "pr-lan-mine", "pr-lan-other"], "each network printer: a write that reaches nothing says no");
  assert.deepEqual(here.targets["pr-lan-down"], { lan: { host: "192.168.1.52", port: 9100 }, paper: "80mm" }, "by its address");
});

test("a browser tab or a waiter phone: only the printers it writes and can print now", () => {
  assert.deepEqual(offlineHereOf({ printers: PRINTERS, deviceId: "me", ready: [], desktop: null, pool: null }).hereIds, [], "nothing here");
});

test("each line's slip names its printer, reaches it by its target, and prints pictures for another device", () => {
  const pool = { printers: [{ id: "tcp:192.168.1.51:9100", status: "connected" as const }] };
  const here = offlineHereOf({ printers: PRINTERS, deviceId: "me", ready: [], desktop: null, pool });
  const slip = { surface: "kot", documentTitle: "KOT", order: {} } as unknown as HostKotSlip;
  assert.deepEqual(offlineSlipFor(slip, "pr-lan-other", here), { ...slip, printerId: "pr-lan-other", target: { nativeId: "tcp:192.168.1.51:9100", paper: "80mm" }, takeover: true }, "a takeover printer");
  assert.deepEqual(offlineSlipFor(slip, null, here), slip, "simple mode: the device's own printer, as today");
});
