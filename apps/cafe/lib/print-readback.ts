// ─────────────────────────────────────────────────────────────────────────────
// Print-host plan §B7 (PH-8) — the PURE half of the band's readback. No React,
// no fetch, no "use client": this device's own BOUNDED set of outstanding
// print-job ids (design review MERGED-10 — a set, never a single "last job
// id", because Pay-Now enqueues two jobs), how each entry reads against the
// pulse's three feeds (D1/D2 queued · D3 resolved), the per-order chip that
// folds an order's jobs into ONE worst-state line, and the stale-band row
// order (D-6). PosPulseProvider holds the entries and calls record/prune;
// PrintHostBandSection renders. Client-only policy, so it lives in the cafe
// lib, not @pos/shared — the server never reads any of it.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PRINT_BAND_MAX_STALE_BUTTONS,
  PRINT_HOST_OFFLINE_WARNING,
  PRINT_HOST_SILENT_OFF_WARNING,
  printHostActiveNote,
  type PrintHostState,
  type PrintJobDismissReason,
  type PrintJobFeedRow,
  type PrintJobKind,
  type PrintJobResolvedRow,
} from "@pos/shared/print-job";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { printJobOrderRef } from "@/lib/print-routing";

/** Bound on this device's tracked jobs — the OLDEST are dropped first. */
export const PRINT_READBACK_MAX_ENTRIES = 20;

/** A job seen in NO feed yet is kept "waiting" this long: the tick in flight
 *  when the enqueue landed predates the row, and a truncated read can miss
 *  it. Past the grace it is presumed gone — §B7's "waiting/unknown" never
 *  turns into a ✓ by absence, it just leaves the band. Two ticks plus slack. */
export const PRINT_READBACK_UNSEEN_GRACE_MS = 60 * 1000;

/** A printed ✓ stays on the band this long after it was FIRST seen resolved —
 *  long enough to be read on the next glance, short enough not to pin the
 *  band open after every routed KOT. */
export const PRINT_READBACK_PRINTED_LINGER_MS = 45 * 1000;

/** A cancellation (nothing printed) lingers longer: it is the one readback
 *  state that needs an action from the reader (reprint from Orders). */
export const PRINT_READBACK_DISMISSED_LINGER_MS = 5 * 60 * 1000;

/** A SEEN job that then appears in NO feed while some feed was CUT at its
 *  limit is "waiting/unknown" (§B7 — a truncated read, not a resolution):
 *  kept, rendered as waiting, for this long after it first went missing, then
 *  dropped — never a ✓ by absence, never pinned open either. */
export const PRINT_READBACK_UNKNOWN_LINGER_MS = PRINT_READBACK_PRINTED_LINGER_MS;

const MS_PER_MINUTE = 60 * 1000;

/** Band copy — the host's label is substituted at render. */
const HOST_LABEL_FALLBACK = "the print host";
const EOD_ORDER_REF = "End of day";
const KIND_NAMES: Record<PrintJobKind, string> = {
  kot: "KOT",
  bill: "Bill",
  void: "Void",
  moved: "Move",
  eod: "Closing slip",
  "cancel-notice": "Cancel notice",
};

/** The four readback states of §B7 (MERGED-10, fresh-eyes F13). Ranked worst-
 *  last so a per-order chip can fold its jobs: a cancellation outranks a wait,
 *  a wait outranks a ✓ — a chip must never read as done while a job is open. */
export type PrintReadbackState = "printed" | "waiting" | "cancelled" | "cancelled-at-host";
const STATE_RANK: Record<PrintReadbackState, number> = { printed: 0, waiting: 1, cancelled: 2, "cancelled-at-host": 3 };

export interface PrintReadbackResolved {
  status: PrintJobResolvedRow["status"];
  dismissReason?: PrintJobDismissReason;
  /** Client clock at the FIRST tick that showed the row resolved (linger base). */
  seenAt: number;
}

export interface PrintReadbackEntry {
  id: string;
  kind: PrintJobKind;
  /** Groups an order's jobs into one chip: the snapshot's `_id`, or the job's own id for the order-less eod. */
  orderKey: string;
  /** What staff call it: "T-4" when seated, else the orderId; the day label for eod. */
  orderRef: string;
  recordedAt: number;
  /** True once ANY feed has carried this id — after that, absence means gone, not "not yet". */
  seen: boolean;
  /** Client clock at the first tick a SEEN id was in no feed while a feed was
   *  truncated (the "waiting/unknown" bucket); null while present or unseen. */
  absentSince: number | null;
  /** STICKY once set: a later truncated D3 must not flip a ✓ back to "waiting". */
  resolved: PrintReadbackResolved | null;
}

export type PrintReadbackRecord = Pick<PrintReadbackEntry, "id" | "kind" | "orderKey" | "orderRef">;

/** What `useHostRouting.enqueue` records (A-17): the id the SERVER answered
 *  with — for "queued" the new row, for "already-resolved" the EXISTING row the
 *  tap referred to — plus the order handle the chip groups and names by. */
export function printReadbackRecordOf(id: string, payload: PrintJobPayload): PrintReadbackRecord {
  if (payload.kind === "eod") return { id, kind: payload.kind, orderKey: id, orderRef: `${EOD_ORDER_REF} ${payload.dateLabel}` };
  return { id, kind: payload.kind, orderKey: payload.snapshot._id, orderRef: printJobOrderRef(payload.snapshot) };
}

/** Appends one record, bounded. Returns the SAME array when nothing changed
 *  (an id already tracked keeps its history) so a state setter can bail out.
 *  Over the cap, a RESOLVED entry goes first (its ✓/cancel is already on a
 *  self-expiring linger); only when none is left does the oldest waiting one. */
export function recordPrintReadback(
  entries: PrintReadbackEntry[],
  record: PrintReadbackRecord,
  nowMs: number,
): PrintReadbackEntry[] {
  if (entries.some((entry) => entry.id === record.id)) return entries;
  const next = [...entries, { ...record, recordedAt: nowMs, seen: false, absentSince: null, resolved: null }];
  if (next.length <= PRINT_READBACK_MAX_ENTRIES) return next;
  const evict = next.findIndex((entry) => entry.resolved !== null);
  next.splice(evict >= 0 ? evict : 0, 1);
  return next;
}

interface FeedIndex {
  queued: ReadonlySet<string>;
  resolved: ReadonlyMap<string, PrintJobResolvedRow>;
  /** ANY of the three reads hit its limit — an absent id may just be cut off. */
  truncated: boolean;
}

/** Bounds, in order: a resolved entry lingers then drops; a queued one stays
 *  "waiting" for as long as the job itself is queued (D1 or the stale band —
 *  §B7 says D2 is still "Waiting for <label>", so no readback-local age may
 *  drop it while the counter still owes the slip); an absent one is "not yet"
 *  within the unseen grace, "waiting/unknown" for a bounded linger when a feed
 *  was truncated, and gone otherwise. Never a ✓ by absence. */
function advanceEntry(entry: PrintReadbackEntry, feeds: FeedIndex, nowMs: number): PrintReadbackEntry | null {
  if (entry.resolved !== null) {
    const linger =
      entry.resolved.status === "printed" ? PRINT_READBACK_PRINTED_LINGER_MS : PRINT_READBACK_DISMISSED_LINGER_MS;
    return nowMs - entry.resolved.seenAt > linger ? null : entry;
  }
  const row = feeds.resolved.get(entry.id);
  if (row !== undefined) {
    return {
      ...entry,
      seen: true,
      absentSince: null,
      resolved: { status: row.status, ...(row.dismissReason !== undefined ? { dismissReason: row.dismissReason } : {}), seenAt: nowMs },
    };
  }
  if (feeds.queued.has(entry.id)) {
    return entry.seen && entry.absentSince === null ? entry : { ...entry, seen: true, absentSince: null };
  }
  if (!entry.seen) return nowMs - entry.recordedAt <= PRINT_READBACK_UNSEEN_GRACE_MS ? entry : null;
  if (!feeds.truncated) return null;
  const since = entry.absentSince ?? nowMs;
  if (nowMs - since > PRINT_READBACK_UNKNOWN_LINGER_MS) return null;
  return entry.absentSince === null ? { ...entry, absentSince: nowMs } : entry;
}

/** One pulse tick's worth of bookkeeping over the entries (the drain's
 *  `attemptedRef` discipline, applied to readback). A DEGRADED tick
 *  (`printHost === null` — the print reads failed, so all three feeds are
 *  empty) says nothing about any job and must not prune (MERGED-19). Returns
 *  the SAME array when nothing changed so the state setter can bail out. */
export function prunePrintReadback(entries: PrintReadbackEntry[], pulse: PosPulseData, nowMs: number): PrintReadbackEntry[] {
  if (entries.length === 0 || pulse.printHost === null) return entries;
  const feeds: FeedIndex = {
    queued: new Set([...pulse.printJobs, ...pulse.stalePrintJobs].map((row) => row.id)),
    resolved: new Map(pulse.resolvedPrintJobs.map((row) => [row.id, row])),
    truncated: pulse.printJobsTruncated || pulse.stalePrintJobsTruncated || pulse.resolvedPrintJobsTruncated,
  };
  let changed = false;
  const next: PrintReadbackEntry[] = [];
  for (const entry of entries) {
    const advanced = advanceEntry(entry, feeds, nowMs);
    if (advanced !== entry) changed = true;
    if (advanced !== null) next.push(advanced);
  }
  return changed ? next : entries;
}

export function printReadbackStateOf(entry: PrintReadbackEntry): PrintReadbackState {
  if (entry.resolved === null) return "waiting";
  if (entry.resolved.status === "printed") return "printed";
  // A staff Dismiss from the host's band is worth naming apart from an
  // automatic order-cancelled / round-voided / host-cleared teardown (F13).
  return entry.resolved.dismissReason === "staff" ? "cancelled-at-host" : "cancelled";
}

export interface PrintReadbackChip {
  key: string;
  orderRef: string;
  /** The order's job kinds, de-duplicated, in enqueue order ("KOT, Bill"). */
  kinds: string;
  state: PrintReadbackState;
}

/** One chip per ORDER carrying the WORST state across that order's jobs and
 *  naming every kind — never one chip per job (MERGED-10). */
export function printReadbackChips(entries: PrintReadbackEntry[]): PrintReadbackChip[] {
  const byOrder = new Map<string, { orderRef: string; kinds: string[]; state: PrintReadbackState }>();
  for (const entry of entries) {
    const state = printReadbackStateOf(entry);
    const kind = KIND_NAMES[entry.kind];
    const group = byOrder.get(entry.orderKey);
    if (group === undefined) {
      byOrder.set(entry.orderKey, { orderRef: entry.orderRef, kinds: [kind], state });
      continue;
    }
    if (!group.kinds.includes(kind)) group.kinds.push(kind);
    if (STATE_RANK[state] > STATE_RANK[group.state]) group.state = state;
  }
  return [...byOrder].map(([key, group]) => ({ key, orderRef: group.orderRef, kinds: group.kinds.join(", "), state: group.state }));
}

/** The chip's verb, §B7's exact four renderings. Exhaustive: a fifth state
 *  fails to compile here before it can render as the wrong sentence. */
export function printReadbackText(state: PrintReadbackState, hostLabel: string): string {
  switch (state) {
    case "waiting":
      return `Waiting for ${hostLabel}`;
    case "printed":
      return `Sent to ${hostLabel} ✓`;
    case "cancelled":
      return "Cancelled — nothing printed";
    case "cancelled-at-host":
      return "Cancelled at host";
  }
}

export interface StaleBandRow {
  id: string;
  label: string;
  ageMinutes: number;
}

/** D-6: D2 arrives OLDEST-first (the drain's order), so taking its head would
 *  show an 11-hour-old breakfast ticket while the slip the kitchen waits on
 *  sits at row 13. The band shows the NEWEST stale slips, capped, and counts
 *  the rest for the "+k older" link. A malformed `createdAt` is folded into
 *  the hidden count rather than sorted as NaN. */
export function staleBandRows(rows: PrintJobFeedRow[], nowMs: number): { shown: StaleBandRow[]; hiddenCount: number } {
  const dated = rows
    .map((row) => ({ row, createdMs: Date.parse(row.createdAt) }))
    .filter(({ createdMs }) => !Number.isNaN(createdMs))
    .sort((a, b) => b.createdMs - a.createdMs);
  const shown = dated.slice(0, PRINT_BAND_MAX_STALE_BUTTONS).map(({ row, createdMs }) => ({
    id: row.id,
    label: row.label,
    ageMinutes: Math.max(0, Math.floor((nowMs - createdMs) / MS_PER_MINUTE)),
  }));
  return { shown, hiddenCount: rows.length - shown.length };
}

/** The configured host's staff-facing label, or the generic fallback. */
export function printHostLabelOf(host: PrintHostState | null): string {
  return host !== null && host.configured && host.label !== null ? host.label : HOST_LABEL_FALLBACK;
}

/** The band's host warnings (§B7): offline outranks silent-off but both can
 *  stand — a dialog-bound host that also stopped beating is two problems. An
 *  unconfigured host (or a degraded tick) warns of nothing. */
export function printHostWarnings(host: PrintHostState | null): string[] {
  if (host === null || !host.configured) return [];
  const warnings: string[] = [];
  if (host.offline) warnings.push(PRINT_HOST_OFFLINE_WARNING);
  if (!host.silentMode) warnings.push(PRINT_HOST_SILENT_OFF_WARNING);
  return warnings;
}

/** §B7's third-to-fifth `visible` disjuncts, ONE predicate: a host warning,
 *  a stale backlog, or THIS device's own outstanding work. A merely in-flight
 *  job on another device never flips a band (MERGED-18). */
export function printBandVisible(pulse: PosPulseData | undefined, readback: PrintReadbackEntry[]): boolean {
  if (readback.length > 0) return true;
  if (pulse === undefined) return false;
  return printHostWarnings(pulse.printHost).length > 0 || pulse.stalePrintJobs.length > 0;
}

/** MERGED-22: the host-aware limitation line once a host is configured, else
 *  `null` so the band renders the legacy SELF_ORDER_ALERT_LIMITATION and the
 *  dark-rollout state stays byte-identical (§F). A DEGRADED tick (`printHost
 *  === null`) is not "no host" (MERGED-19): a device that has SEEN a host
 *  (`printHostSeen`) keeps the host-aware line with the fallback label. */
export function printHostNoteOf(pulse: PosPulseData | undefined, printHostSeen: boolean): string | null {
  const host = pulse?.printHost ?? null;
  if (host !== null) return host.configured ? printHostActiveNote(printHostLabelOf(host)) : null;
  return pulse !== undefined && printHostSeen ? printHostActiveNote(printHostLabelOf(null)) : null;
}
