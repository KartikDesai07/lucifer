import { isDuplicateKeyError } from "@pos/shared/api";
import type { PrintDeviceCapabilities, PrintDeviceShell } from "@pos/shared/print-agent-wire";
import { PRINT_DEVICE_HEARTBEAT_WRITE_MS, PRINT_DEVICE_ONLINE_MS, PRINT_DEVICE_PRUNE_MS } from "@pos/shared/print-lifecycle";
import { PrintDevice } from "@/models/PrintDevice";

// Printing redesign, Phase 1 (spec §6.4, §10): the device heartbeat. It rides the agent's existing
// wake poll, and lease calls refresh it too, so it adds no request. Atlas M0 budget: at most ONE
// write per device per 30 s, however often the agent polls. Never calls connectDB(). No console.*.

export interface PrintDeviceBeat {
  deviceId: string;
  label: string;
  shell: PrintDeviceShell;
  capabilities: PrintDeviceCapabilities;
  appVersion?: string;
  nativeProtocol?: number;
}

/** The wake's heartbeat: creates the row on first sight, refreshes it at most every 30 s. */
export async function beatPrintDevice(beat: PrintDeviceBeat, nowMs: number): Promise<void> {
  // The upsert's "one row per device" rests on the unique deviceId index, and connectDB()'s autoIndex
  // build is not awaited. Without this, a cold-start wake could insert a second row before the index
  // exists; the build then fails for good and countOnlineAgents over-counts, shrinking every agent's
  // wake share. .init() is memoized per process (house rule: due-payment.ts, crud-route.ts).
  await PrintDevice.init();
  try {
    await PrintDevice.updateOne(
      { deviceId: beat.deviceId, lastSeenAt: { $lt: new Date(nowMs - PRINT_DEVICE_HEARTBEAT_WRITE_MS) } },
      {
        $set: {
          label: beat.label,
          shell: beat.shell,
          capabilities: beat.capabilities,
          lastSeenAt: new Date(nowMs),
          ...(beat.appVersion !== undefined ? { appVersion: beat.appVersion } : {}),
          ...(beat.nativeProtocol !== undefined ? { nativeProtocol: beat.nativeProtocol } : {}),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // A fresh row exists, so the filter missed and the upsert hit the unique deviceId: nothing to write.
    if (!isDuplicateKeyError(error)) throw error;
  }
}

/** A lease counts as a heartbeat (spec §7.3) for a device the wake already knows. It never creates
 *  a row: label, shell and capabilities come only from the wake. */
export async function touchPrintDevice(deviceId: string, nowMs: number): Promise<void> {
  await PrintDevice.updateOne(
    { deviceId, lastSeenAt: { $lt: new Date(nowMs - PRINT_DEVICE_HEARTBEAT_WRITE_MS) } },
    { $set: { lastSeenAt: new Date(nowMs) } },
  );
}

/** Devices seen in the last 90 s. Never 0: it divides the cafe's one daily wake cap (spec §9.1). */
export async function countOnlineAgents(nowMs: number): Promise<number> {
  const online = await PrintDevice.countDocuments({ lastSeenAt: { $gte: new Date(nowMs - PRINT_DEVICE_ONLINE_MS) } });
  return Math.max(1, online);
}

/** Owner, after Session 1D: a device not seen for 7 days is gone (a reset or reinstall gets a new id), so
 *  its row goes. A device that comes back writes its row again on its next wake. One delete over a
 *  collection of a few rows (no index needed), on the prune's own throttle (lib/print-queue.ts). */
export async function prunePrintDevices(nowMs: number): Promise<void> {
  await PrintDevice.deleteMany({ lastSeenAt: { $lt: new Date(nowMs - PRINT_DEVICE_PRUNE_MS) } });
}
