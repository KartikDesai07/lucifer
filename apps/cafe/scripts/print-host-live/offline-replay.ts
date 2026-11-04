/**
 * Printing Phase 5 live leg (spec 2026-11-03 §5.8–5.9; plan Session 5A Task 3) against a REAL MongoDB: the replay of a
 * request that carries the `offline` field (its key was used: the first send landed, its answer was lost) — an untried
 * queued KOT job on a line printed offline moves to printed, every other job stays; a round with no jobs (its creation
 * threw) is made with its verdicts, a sale's bill too; a round's replay on the items route; the answer carries the
 * jobs and the echo (bi). Run by scripts/verify-print-host-live.ts after leg bh. Ends in simple mode with no host.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import type { OfflineLine } from "@pos/shared/offline-kot";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { Category } from "@/models/Category";
import { Order } from "@/models/Order";
import { PrintJob } from "@/models/PrintJob";
import { Printer } from "@/models/Printer";
import { Product } from "@/models/Product";
import { Station } from "@/models/Station";
import { createOrderPrintJobs, type PrintIntent } from "@/lib/print-order-jobs";
import type { OfflineAsk } from "@/lib/print-offline-jobs";
import { markOfflineRoundPrinted, offlineReplayAnswer } from "@/lib/print-offline-replay";
import { repairMissingKotJobs } from "@/lib/print-repair";
import { check, resetCollections } from "./harness";
import { STAFF, rowOf, setRaw } from "./lifecycle";
import { COUNTER, isPrintedOffline, isReprint, offlineOrder, outlet } from "./offline";

const askOf = (lines: OfflineLine[], takenAt = Date.now()): OfflineAsk => ({ deviceId: COUNTER, round: { ref: "O-3", takenAt, lines } });
const INTENT: PrintIntent = { deviceId: COUNTER, bill: false };

/** The first send as an online send makes it: no field, queued for each line's writer. */
async function onlineJobs(orderId: string, nowMs: number): Promise<PrintJobRef[]> {
  return createOrderPrintJobs({ order: await Order.findById(orderId).lean(), slips: [{ kind: "kot", round: 1 }], originDeviceId: COUNTER, queuedBy: STAFF, nowMs });
}

/** The route's 200 replay answer for this order, then offlineReplayAnswer as the route runs it. */
async function replay(orderId: string, ask: OfflineAsk, intent: PrintIntent = INTENT, roundKey?: string) {
  const order = await Order.findById(orderId).lean();
  const answer = await offlineReplayAnswer(new Response(JSON.stringify({ success: true, data: order }), { status: 200 }), ask, intent, STAFF, roundKey);
  const body = (await answer.json()) as { data?: { printJobs?: PrintJobRef[]; offline?: { ref: string; takenAtKept: boolean } } };
  return { status: answer.status, jobs: body.data?.printJobs ?? [], echo: body.data?.offline };
}

export async function legBI(nowMs: number): Promise<void> {
  console.log("\n(bi) the replay of an offline round: untried queued lines it printed move to printed; missing jobs are made with their verdicts");
  const o = await outlet();
  const printedAll = (lines: Array<[string, string]>): OfflineLine[] => lines.map(([printerId, part]) => ({ printerId, part, outcome: "printed" }));
  const every = printedAll([[o.kitchen, o.kitchenSt], [o.bar, o.barSt], [o.counter, "all"]]);

  // The half-way send: the first send landed online (no field), then the device printed it offline ("Print KOT here").
  const first = await offlineOrder(o);
  const made = new Map((await onlineJobs(first, nowMs)).map((ref) => [ref.printerId, ref.id]));
  const [kitchenId, barId, fullId] = [made.get(o.kitchen) ?? "", made.get(o.bar) ?? "", made.get(o.counter) ?? ""];
  await setRaw(barId, { status: "leased", epoch: 1, attempts: 1, lease: { deviceId: "live-5a-bar", tabId: "t", epoch: 1, expiresAt: new Date(nowMs + 90_000) } });
  await setRaw(fullId, { status: "printed", printedAt: new Date(nowMs), printedBy: COUNTER });
  const moved = await markOfflineRoundPrinted({ orderObjectId: first, round: 1, ask: askOf(every), nowMs: nowMs + 1_000 });
  const kitchen = await rowOf(kitchenId);
  check("(bi) the untried queued kitchen job on a line printed offline moves to printed (log 'offline O-3')", moved === 1 && kitchen?.status === "printed" && kitchen.printedBy === COUNTER && kitchen.log?.at(-1)?.detail === "offline O-3");
  check("(bi) the leased bar job and the printed full copy stay as they are", (await rowOf(barId))?.status === "leased" && (await rowOf(fullId))?.printedBy === COUNTER && (await rowOf(fullId))?.log?.length === 1);
  check("(bi) a second replay moves nothing", (await markOfflineRoundPrinted({ orderObjectId: first, round: 1, ask: askOf(every), nowMs: nowMs + 2_000 })) === 0);
  const tried = await offlineOrder(o);
  const triedKitchen = (await onlineJobs(tried, nowMs)).find((ref) => ref.printerId === o.kitchen)?.id ?? "";
  await setRaw(triedKitchen, { attempts: 1, nextAttemptAt: new Date(nowMs + 2_000) });
  const triedMoved = await markOfflineRoundPrinted({ orderObjectId: tried, round: 1, ask: askOf(every), nowMs });
  check("(bi) a queued job with an attempt (refused once) stays queued: it may be printing", (await rowOf(triedKitchen))?.status === "queued" && triedMoved === 2);
  const later = await offlineOrder(o);
  await onlineJobs(later, nowMs);
  const laterLines: OfflineLine[] = [{ printerId: o.kitchen, part: o.kitchenSt, outcome: "later" }, { printerId: o.bar, part: o.barSt, outcome: "maybe" }];
  check("(bi) a line the field names later or maybe is never moved", (await markOfflineRoundPrinted({ orderObjectId: later, round: 1, ask: askOf(laterLines), nowMs })) === 0);

  // The first send landed with the field but its jobs could not be made (503): the replay makes them with their verdicts.
  const takenAt = nowMs - 60_000;
  const bare = await offlineOrder(o, { createdAt: new Date(takenAt) });
  const lines: OfflineLine[] = [
    { printerId: o.kitchen, part: o.kitchenSt, outcome: "printed" },
    { printerId: o.bar, part: o.barSt, outcome: "maybe" },
    { printerId: o.counter, part: "all", outcome: "later" },
  ];
  const answered = await replay(bare, askOf(lines, takenAt));
  const byPrinter = new Map(answered.jobs.map((ref) => [ref.printerId, ref]));
  check("(bi) a round with no jobs is made on the replay: printed, REPRINT and as today", answered.status === 200 && answered.jobs.length === 3 && isPrintedOffline(await rowOf(byPrinter.get(o.kitchen)?.id ?? "")) && isReprint(await rowOf(byPrinter.get(o.bar)?.id ?? "")) && byPrinter.get(o.counter)?.status === "queued");
  check("(bi) the replay answer echoes the field: O-3, its taken time kept", answered.echo?.ref === "O-3" && answered.echo.takenAtKept === true);
  const again = await replay(bare, askOf(lines, takenAt));
  check("(bi) the same replay again makes nothing new and answers the same jobs", again.jobs.length === 3 && (await PrintJob.countDocuments({ orderId: bare })) === 3);
  check("(bi) the sweep then makes nothing for it", (await repairMissingKotJobs(nowMs)) === 0 && (await PrintJob.countDocuments({ orderId: bare })) === 3);

  // A round's replay on the items route (the key's index in kotIdemKeys), printed offline on the kitchen only.
  const tab = await offlineOrder(o, {
    kotRounds: 2,
    kotIdemKeys: ["", "round-2-key"],
    kotFiredAt: [new Date(nowMs - 3_600_000), new Date(takenAt)],
  });
  await Order.updateOne({ _id: tab }, { $push: { items: { productId: o.paneer, name: "Paneer Tikka", price: 250, qty: 1, modifiers: [], instructions: "", kotRound: 2 } } });
  const roundAnswer = await replay(tab, askOf([{ printerId: o.kitchen, part: o.kitchenSt, outcome: "printed" }], takenAt), INTENT, "round-2-key");
  const roundRow = await rowOf(roundAnswer.jobs.find((ref) => ref.printerId === o.kitchen)?.id ?? "");
  const roundFull = roundAnswer.jobs.find((ref) => ref.printerId === o.counter);
  check("(bi) a round's replay makes that round's jobs: the kitchen line it printed under round 2's key, the full copy as today", roundAnswer.jobs.length === 2 && isPrintedOffline(roundRow) && roundRow?.jobKey === `kot:${tab}:2:${o.kitchen}:${o.kitchenSt}` && roundFull?.status === "queued" && roundAnswer.echo?.takenAtKept === true);

  // Simple mode: a Pay Now sale whose first send left no job — the KOT it printed is printed; its bill is made (N3).
  await Promise.all([Printer.deleteMany({}), resetCollections()]);
  const sale = await offlineOrder(o, { status: "Completed", payment: "Cash", paidAmount: 400 });
  const saleAnswer = await replay(sale, askOf([{ printerId: null, part: "-", outcome: "printed" }]), { deviceId: COUNTER, bill: true });
  const [kot, bill] = [saleAnswer.jobs.find((ref) => ref.kind === "kot"), saleAnswer.jobs.find((ref) => ref.kind === "bill")];
  check("(bi) a sale's replay: its KOT printed offline is printed, its bill is made to print now", isPrintedOffline(await rowOf(kot?.id ?? "")) && bill?.status === "queued" && bill.targetDeviceId === COUNTER);
  await Promise.all([resetCollections(), Order.deleteMany({}), Station.deleteMany({}), Category.deleteMany({}), Product.deleteMany({})]);
}
