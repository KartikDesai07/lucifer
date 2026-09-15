import { OrderRequest } from "@/models/OrderRequest";
import { Order, type IOrder } from "@/models/Order";
import { SELF_ORDER_RECEIVER } from "@pos/shared/public";
import {
  PULSE_OPEN_SCAN_LIMIT,
  PULSE_SELF_ORDER_LIMIT,
  PULSE_SELF_ORDER_WINDOW_MS,
  type PosPulseData,
  type PulseSelfOrder,
} from "@pos/shared/self-order-alert";
import { readPrintHostState } from "@/lib/print-host";
import { readPrintJobFeeds } from "@/lib/print-queue-feeds";

// CR2.3 D9/§20, amended by the print-host plan (§B4) — SIX bounded index
// reads behind GET /api/order-requests/pulse (a 20s hot path polled from
// every open dashboard tab): the two OrderRequest queries below, PLUS the
// PrintHost singleton read and the D1 drain / D2 stale-band / D3 resolved-
// readback print-job feeds (homed in lib/print-host.ts / lib/print-queue-feeds.ts,
// not here, so this file keeps zero numeric limits and one responsibility).
// Also split out: the claim primitive behind POST
// /api/order-requests/[id]/kot-claim. Split from the route so a later
// live-leg slice can drive both directly without an HTTP round trip.
// `readPosPulse` is READ-ONLY by design: no pruneOrderRequests, no
// prunePrintJobs/prunePrintJobsThrottled — the tray GET and the public POST
// already prune OrderRequest, and the print-jobs/print-host routes already
// prune PrintJob; a poll this frequent must never itself become a write.

/** ISO string of the latest `updatedAt` across `rows`, or `null` when empty. */
function maxUpdatedAtIso(rows: { updatedAt: Date }[]): string | null {
  if (rows.length === 0) return null;
  let max = rows[0].updatedAt.getTime();
  for (const row of rows) {
    const t = row.updatedAt.getTime();
    if (t > max) max = t;
  }
  return new Date(max).toISOString();
}

// Only rows that actually carry every field a PulseSelfOrder needs — the
// query filter below already implies this at the DB level, but the lean
// read's TYPE is still optional-everywhere (mirrors the model), so this is
// belt-and-suspenders rather than a real-world skip.
interface SelfOrderRow {
  _id: unknown;
  acceptedOrderId?: string;
  acceptedKotRound?: number;
  acceptedAt?: Date;
  kotPrintedAt?: Date;
}

function toPulseSelfOrder(row: SelfOrderRow): PulseSelfOrder | null {
  if (row.acceptedOrderId === undefined || row.acceptedKotRound === undefined || row.acceptedAt === undefined) {
    return null;
  }
  return {
    requestId: String(row._id),
    orderId: row.acceptedOrderId,
    kotRound: row.acceptedKotRound,
    acceptedAt: row.acceptedAt.toISOString(),
    printed: row.kotPrintedAt != null,
  };
}

/**
 * The full staff-attention poll payload (packages/shared/src/self-order-alert.ts's
 * `PosPulseData`). SIX bounded reads total (two OrderRequest queries here,
 * plus the PrintHost singleton and the D1/D2/D3 print-job feeds pulled in
 * from lib/print-host.ts/lib/print-queue-feeds.ts) — no write, no Order read.
 * Caller (the pulse route) must `connectDB()` first.
 */
export async function readPosPulse(): Promise<PosPulseData> {
  // ONE server clock read for the whole pulse — reused below for the
  // self-order window math and passed down to the print-host reads.
  const nowMs = Date.now();

  // Query A — open (actionable) requests, rides {status:1,createdAt:-1}.
  const openRows = await OrderRequest.find({ status: { $in: ["pending", "accepting"] } })
    .select("_id createdAt updatedAt")
    .sort({ createdAt: -1 })
    .limit(PULSE_OPEN_SCAN_LIMIT)
    .lean();

  const newest = openRows[0] ?? null;

  // Query B — self-orders accepted recently enough to still need printing.
  // UNPRINTED-only (review C4): printed rows must not occupy the limited
  // slots, or a backlog deeper than PULSE_SELF_ORDER_LIMIT would hide its
  // OLDEST unprinted tickets from both the alert bar and the auto-printer —
  // exactly the printer-was-offline scenario this queue exists for. Printing
  // a shown row frees its slot, so a deep backlog drains across ticks.
  // `createdAt` (not `acceptedAt`) bounds the window here — pinned by the
  // CR2.3 spec so the filter can still lead with the request's own creation
  // time, which every row has from the moment it's inserted.
  const selfRows = await OrderRequest.find({
    status: "accepted",
    actor: SELF_ORDER_RECEIVER,
    acceptedKotRound: { $exists: true },
    kotPrintedAt: { $exists: false },
    createdAt: { $gte: new Date(nowMs - PULSE_SELF_ORDER_WINDOW_MS) },
  })
    .select("_id acceptedOrderId acceptedKotRound acceptedAt kotPrintedAt")
    .sort({ acceptedAt: -1 })
    .limit(PULSE_SELF_ORDER_LIMIT)
    .lean();

  const selfOrders: PulseSelfOrder[] = [];
  for (const row of selfRows) {
    const mapped = toPulseSelfOrder(row);
    if (mapped) selfOrders.push(mapped);
  }

  // (C) the PrintHost singleton + (D1/D2/D3) the print-job drain/stale/
  // resolved feeds — print-host plan §B4. Both reads are homed in their own
  // libs (lib/print-host.ts, lib/print-queue-feeds.ts); this file stays read-only.
  //
  // FAIL-SOFT, unlike the two OrderRequest reads above: a PrintJob read
  // failure (index build, post-deploy model registration, one slow read)
  // must not 500 this whole 20s hot path — every open dashboard tab would
  // freeze on the last-good TanStack `data`, so `selfOrders` would freeze
  // too and no new QR self-order would ever auto-print again, silently
  // (a stale-but-successful pulse renders identically to a fresh one). Only
  // this try/catch is fail-soft; a real OrderRequest outage above must still
  // surface as a 500.
  let printHost: PosPulseData["printHost"];
  let feeds: Awaited<ReturnType<typeof readPrintJobFeeds>>;
  try {
    [printHost, feeds] = await Promise.all([readPrintHostState(nowMs), readPrintJobFeeds(nowMs)]);
  } catch {
    printHost = null;
    feeds = { printJobs: [], printJobsTruncated: false, stalePrintJobs: [], stalePrintJobsTruncated: false, resolvedPrintJobs: [], resolvedPrintJobsTruncated: false };
  }

  return {
    openCount: openRows.length,
    openTruncated: openRows.length === PULSE_OPEN_SCAN_LIMIT,
    newestOpenId: newest ? String(newest._id) : null,
    newestOpenAt: newest ? newest.createdAt.toISOString() : null,
    openRev: maxUpdatedAtIso(openRows),
    selfOrders,
    // Same length===limit proxy as openTruncated: "at least this many" — the
    // bar tells staff older unprinted tickets exist beyond what is shown.
    selfOrdersTruncated: selfRows.length === PULSE_SELF_ORDER_LIMIT,
    printHost,
    ...feeds,
  };
}

export type ClaimKotPrintResult =
  | { claimed: false; reason: "no-order" | "raced" | "not-eligible" }
  | { claimed: true; order: IOrder; kotRound: number };

/**
 * Claims the right to print a self-order's KOT exactly once (CR2.3 D9). A
 * lost race is a NORMAL outcome (`{claimed:false, reason:"raced"}`), never an
 * error — the caller must 200 it, not error-toast. `kotPrintedAt` is set on
 * success and NEVER unset on any later client-side print failure
 * (never-revert-on-write-throw): a lost print is a staff reprint problem, not
 * a reason to reopen the claim to a second racer.
 */
export async function claimKotPrint(id: string): Promise<ClaimKotPrintResult> {
  const request = await OrderRequest.findById(id).lean();
  if (
    !request ||
    request.status !== "accepted" ||
    request.actor !== SELF_ORDER_RECEIVER ||
    request.acceptedOrderId === undefined ||
    request.acceptedKotRound === undefined
  ) {
    return { claimed: false, reason: "not-eligible" };
  }

  // Read the Order BEFORE any write — mirrors lib/order-request-accept-core.ts's
  // findByRequestId / the accept route's `result.order` (these v1 paths stay
  // default-bound, not leaned), so the client gets the identical JSON shape
  // the accept response already carries for the SAME print bridge to consume.
  const order = await Order.findOne({ orderId: request.acceptedOrderId });
  if (!order) return { claimed: false, reason: "no-order" };

  // The order's LIVE state gates the print (review C14): a KOT must never
  // reach the kitchen for an order staff already cancelled, or for a round
  // whose every line was since voided (a full-line void REMOVES the line —
  // lib/order-void.ts). Stamp kotPrintedAt anyway ("resolved — nothing left
  // to print", the same marker that stops the nag and frees the pulse slot;
  // idempotent under the CAS's own $exists guard) and report not-eligible so
  // no caller prints.
  const roundHasLines = order.items.some((it) => it.kotRound === request.acceptedKotRound);
  if (order.status === "Cancelled" || !roundHasLines) {
    await OrderRequest.updateOne(
      { _id: id, status: "accepted", kotPrintedAt: { $exists: false } },
      { $set: { kotPrintedAt: new Date() } },
    );
    return { claimed: false, reason: "not-eligible" };
  }

  // CAS — the actual claim. CHECKED, never assumed: a null result here is a
  // race a concurrent claim already won, not a failure of this one.
  const claimed = await OrderRequest.findOneAndUpdate(
    { _id: id, status: "accepted", actor: SELF_ORDER_RECEIVER, kotPrintedAt: { $exists: false } },
    { $set: { kotPrintedAt: new Date() } },
    { new: true },
  );
  if (!claimed) return { claimed: false, reason: "raced" };

  return { claimed: true, order, kotRound: request.acceptedKotRound };
}
