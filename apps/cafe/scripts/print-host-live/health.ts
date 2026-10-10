/**
 * Phase 3 Session 3A live leg (bc) — printer health (spec §10) and the problem every device's waiting-slips feed shows
 * (spec §9.4) against a REAL MongoDB: a writer's report is kept for the printers it writes now and dropped for any other;
 * it is written only when it says something new, or a steady one is due its 5-minute refresh; every device reads it with
 * the printers; a slip waiting on a printer says the printer's problem (out of paper; its device offline), and says
 * nothing when none is known. Run by scripts/verify-print-host-live.ts after leg bb.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { PRINTER_HEALTH_REFRESH_MS } from "@pos/shared/print-failover";
import { PrintDevice } from "@/models/PrintDevice";
import { Printer } from "@/models/Printer";
import { readPrintAttention } from "@/lib/print-attention";
import { readOnlinePrintDevices } from "@/lib/print-device";
import { recordPrinterHealth } from "@/lib/print-health";
import { listPrinters } from "@/lib/print-printers";
import { check } from "./harness";
import { BAR, COUNTER, KITCHEN, failoverOutlet, kotOf, offline, online } from "./failover";

/** What the wake does with a beat's printers: who is online, then the health the device reports. */
async function beat(deviceId: string, reports: Parameters<typeof recordPrinterHealth>[0]["reports"], nowMs: number): Promise<number> {
  return recordPrinterHealth({ deviceId, reports, printers: await listPrinters(), failover: { online: await readOnlinePrintDevices(nowMs), nowMs }, nowMs });
}

const healthOf = async (printerId: string) => (await listPrinters()).find((printer) => printer.id === printerId)?.health;

export async function legBC(nowMs: number): Promise<void> {
  console.log("\n(bc) printer health rides the heartbeat (§10); a waiting slip says its printer's problem on every device (§9.4)");
  const o = await failoverOutlet();
  await Promise.all([online(KITCHEN, nowMs), online(COUNTER, nowMs), online(BAR, nowMs)]);
  const first = await beat(BAR, [{ printerId: o.bar, link: "connected", paper: "out" }, { printerId: o.kitchen, link: "connected" }], nowMs);
  const bar = await healthOf(o.bar);
  check("(bc) the bar phone's report is kept for its own printer only, never for the kitchen's", first === 1 && bar?.paper === "out" && bar.deviceId === BAR && (await healthOf(o.kitchen)) === undefined);
  check("(bc) the same report again writes nothing", (await beat(BAR, [{ printerId: o.bar, link: "connected", paper: "out" }], nowMs + 60_000)) === 0 && (await healthOf(o.bar))?.at === new Date(nowMs).toISOString());
  check("(bc) a change is written at once (paper back in)", (await beat(BAR, [{ printerId: o.bar, link: "connected", paper: "ok" }], nowMs + 61_000)) === 1 && (await healthOf(o.bar))?.paper === "ok");
  await online(BAR, nowMs + 61_000 + PRINTER_HEALTH_REFRESH_MS);
  check("(bc) a steady state is written again after 5 minutes, to stay fresh", (await beat(BAR, [{ printerId: o.bar, link: "connected", paper: "ok" }], nowMs + 61_000 + PRINTER_HEALTH_REFRESH_MS + 1)) === 1);
  check("(bc) a report with no paper state clears the kept one", (await beat(BAR, [{ printerId: o.bar, link: "connected" }], nowMs + 61_000 + PRINTER_HEALTH_REFRESH_MS + 2)) === 1 && (await healthOf(o.bar))?.paper === undefined);

  const t = nowMs + 61_000 + PRINTER_HEALTH_REFRESH_MS + 10_000;
  await Promise.all([online(KITCHEN, t), online(COUNTER, t), online(BAR, t)]);
  await beat(BAR, [{ printerId: o.bar, link: "connected", paper: "out" }], t);
  const waiting = await kotOf(o, t);
  const feed = await readPrintAttention(t + 25_000);
  const rowOn = (id: string | undefined) => feed.rows.find((row) => row.id === id);
  check("(bc) every device's feed: the bar slip waiting 20 s says its printer is out of paper", rowOn(waiting.bar?.id)?.problem === "paper-out");
  check("(bc) ... and the kitchen slip, whose printer reported nothing, says nothing more", rowOn(waiting.kitchen?.id) !== undefined && !("problem" in (rowOn(waiting.kitchen?.id) ?? {})));
  await offline(BAR, t + 25_000);
  check("(bc) the bar phone offline: its slip says the device that prints Bar is offline", rowOn(waiting.bar?.id) !== undefined && (await readPrintAttention(t + 25_000)).rows.find((row) => row.id === waiting.bar?.id)?.problem === "device-offline");
  await offline(KITCHEN, t + 25_000);
  const kitchenRow = (await readPrintAttention(t + 25_000)).rows.find((row) => row.id === waiting.kitchen?.id);
  check("(bc) the kitchen tablet offline but the counter took its network printer over: no device-offline for the kitchen slip", kitchenRow !== undefined && !("problem" in kitchenRow));
  check("(bc) a device that no longer writes a printer cannot report for it", (await beat(KITCHEN, [{ printerId: o.kitchen, link: "disconnected" }], t + 25_000)) === 0);
  await Promise.all([Printer.deleteMany({}), PrintDevice.deleteMany({})]);
}
