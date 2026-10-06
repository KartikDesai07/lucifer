/**
 * Phase 3 Session 3A live leg (az) — the token fix's review, M-2, against a REAL MongoDB: a page that cannot print a
 * token job (one from before print-customization S7, whose lease steps over it) is never told `more` for one by an
 * ack, nor counted one by the pulse or the wake, so it no longer pays an empty lease per ack and per pulse while a
 * token waits; a page that prints them is, by its own word or by what its device's last lease said. Run by
 * scripts/verify-print-host-live.ts after leg ay.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { Order } from "@/models/Order";
import { PrintDevice } from "@/models/PrintDevice";
import { readPulseJobsForDevice } from "@/lib/print-agent-server";
import { beatPrintDevice, printDeviceDrawsTokens, touchPrintDevice } from "@/lib/print-device";
import { ackPrintJob, leasePrintJobs, readJobsForDevice } from "@/lib/print-lease";
import { createOrderPrintJobs, openingSlipsOf } from "@/lib/print-order-jobs";
import type { Order as OrderShape } from "@/types";
import { check, seedRealOrder } from "./harness";
import { HOST, STAFF, freshHost } from "./lifecycle";

const PHONE = "live-fence-phone";
const CAPS = { lan: true, bluetooth: true, usb: true, windowsPrinters: false, webSerial: false, webBluetooth: false };

/** A token order's opening slips (its KOT, then its token), queued for the host. */
async function kotAndToken(nowMs: number): Promise<void> {
  const id = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { tokenNumber: 9 } });
  const order = JSON.parse(JSON.stringify(await Order.findById(id).lean())) as OrderShape;
  await createOrderPrintJobs({ order, slips: openingSlipsOf(order, 1), originDeviceId: PHONE, queuedBy: STAFF, nowMs });
}

/** What the lease route does: the lease, then the device's touch with what the lease said. */
async function routeLease(nowMs: number, tokenSlips: boolean) {
  const got = await leasePrintJobs({ deviceId: HOST, tabId: tokenSlips ? "new-tab" : "old-tab", dismissedBy: STAFF, nowMs, tokenSlips });
  await touchPrintDevice(HOST, nowMs, tokenSlips);
  return got;
}

export async function legAZ(nowMs: number): Promise<void> {
  console.log("\n(az) the token fix's M-2: a page that cannot print a token is never told `more` for one, nor counted one on the pulse or the wake");
  await freshHost(nowMs);
  await beatPrintDevice({ deviceId: HOST, label: "Counter PC", shell: "android", capabilities: CAPS }, nowMs);
  check("(az) a device no lease has spoken for yet counts token jobs, as before", await printDeviceDrawsTokens(HOST));
  check("(az) ... and so does a device with no row at all", await printDeviceDrawsTokens("live-no-such-device"));

  await kotAndToken(nowMs);
  const old = await routeLease(nowMs + 1_000, false);
  const row = await PrintDevice.findOne({ deviceId: HOST }).select("tokenSlips").lean();
  check("(az) a page from before S7 leases the KOT (its lease steps over the token) and its device row keeps what it said", old.jobs[0]?.kind === "kot" && row?.tokenSlips === false);
  const job = old.jobs[0];
  const acked = await ackPrintJob({ id: job?.id ?? "", deviceId: HOST, epoch: job?.epoch ?? 0, outcome: "printed", nowMs: nowMs + 2_000 });
  check("(az) its ack (it says nothing) answers more:false: the waiting token is not for it", acked.status === "printed" && acked.more === false);
  check("(az) its pulse (it says nothing) counts nothing for it", (await readPulseJobsForDevice(HOST, false, nowMs + 3_000)).count === 0);
  check("(az) a page that says ?tokens=1 is counted the token", (await readPulseJobsForDevice(HOST, true, nowMs + 3_000)).count === 1);
  check("(az) the lib's default still counts every kind (the wake of a page that prints tokens)", (await readJobsForDevice(HOST, nowMs + 3_000)).count === 1);
  const empty = await leasePrintJobs({ deviceId: HOST, tabId: "old-tab", dismissedBy: STAFF, nowMs: nowMs + 3_500, tokenSlips: false });
  check("(az) (why it matters: that page's lease would be empty)", empty.jobs.length === 0);

  const reloaded = await routeLease(nowMs + 4_000, true);
  check("(az) the reloaded page leases the token and its device row now says it prints tokens", reloaded.jobs[0]?.kind === "token" && (await printDeviceDrawsTokens(HOST)));
  const before = (await PrintDevice.findOne({ deviceId: HOST }).select("lastSeenAt").lean())?.lastSeenAt.getTime();
  await touchPrintDevice(HOST, nowMs + 5_000, true);
  const after = (await PrintDevice.findOne({ deviceId: HOST }).select("lastSeenAt").lean())?.lastSeenAt.getTime();
  check("(az) the touch writes nothing when the word is unchanged and the heartbeat is not due", before !== undefined && before === after);
  const token = reloaded.jobs[0];
  await ackPrintJob({ id: token?.id ?? "", deviceId: HOST, epoch: token?.epoch ?? 0, outcome: "printed", tokenSlips: true, nowMs: nowMs + 5_000 });

  await kotAndToken(nowMs + 6_000);
  const kot = (await routeLease(nowMs + 7_000, true)).jobs[0];
  const told = await ackPrintJob({ id: kot?.id ?? "", deviceId: HOST, epoch: kot?.epoch ?? 0, outcome: "printed", tokenSlips: true, nowMs: nowMs + 8_000 });
  check("(az) a page that prints tokens is told more:true for the token behind its KOT", told.status === "printed" && told.more === true);
}
