// ─────────────────────────────────────────────────────────────────────────────
// Print-host plan, PH-4 — the PURE half of the routing seam. No React, no
// fetch, no `"use client"`: the 3-state lane derivation, the label truncator
// and the five payload builders decide WHAT gets enqueued, so they stay
// DB-free/DOM-free and unit-testable alone (PH-3's `print-queue-feeds.ts`
// split). The hooks that USE this live next door — `use-print-host.ts`
// (mutations) and `use-print-routing.ts` (the seam that picks a lane).
// ─────────────────────────────────────────────────────────────────────────────

import { PRINT_JOB_LABEL_MAX_CHARS, printOrderSnapshot } from "@pos/shared/print-job";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { REWARD_ITEM_LINE_NOTE } from "@pos/shared/reward-redemption";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import type { Order, OrderVoid } from "@/types";

// ── The seam's user-facing copy ───────────────────────────────────────────────
// Homed here beside the label vocabulary (and imported by the hook) so the seam
// keeps one place for the strings a human reads. The ONLY outcome that needs a
// voice: "too-large" is a dead end on both lanes — the host never got the job
// and §B7 forbids the local fallback — so without this the tap does nothing at
// all. "queued" and "already-resolved" stay SILENT on purpose (PH-8's band
// readback is their feedback surface, and a toast here would also fire on the
// unattended self-order auto-print lane).
export const PRINT_JOB_TOO_LARGE_MESSAGE =
  "This slip is too large to send to the print host — print it from the host device.";

/** A payload the renderer's own snapshot could not be built from. Nothing was
 *  enqueued and nothing printed locally, so this must be said out loud. */
export const PRINT_JOB_BUILD_FAILED_MESSAGE =
  "Could not prepare this slip for the print host — print it from the host device.";

/** Which lane a print takes. `"unknown"` covers BOTH an unresolved pulse and a
 *  degraded tick (`printHost === null`, the two print reads failed) — plan §B4
 *  says a degraded tick must never read as "no host configured". */
export type PrintHostRouting = "host" | "no-host" | "unknown";

/** Derives the lane from the pulse ALONE. `PosPulseData.printHost` is a
 *  REQUIRED key with a NULLABLE value, so `pulse?.printHost.configured` does
 *  not even typecheck — and coercing the null with `?? false` would print
 *  locally while a live host drains (MERGED-19). */
export function hostRoutingOf(pulse: PosPulseData | undefined): PrintHostRouting {
  if (pulse === undefined || pulse.printHost === null) return "unknown";
  return pulse.printHost.configured ? "host" : "no-host";
}

/** True when a print must be ENQUEUED rather than printed on this device:
 *  a configured host, or an UNKNOWN lane on a device that has seen one
 *  (MERGED-19 — never coerce unknown with `?? false`). Written as host/unknown
 *  checks so the ROUTING state string never appears in a decision: the enqueue
 *  OUTCOME shares the spelling with the OPPOSITE meaning ("you may print
 *  locally"), and only `printJobEnqueueAllowsLocalPrint` may test THAT (D-11). */
export function shouldRoutePrint(routing: PrintHostRouting, printHostSeen: boolean): boolean {
  if (routing === "host") return true;
  if (routing === "unknown") return printHostSeen;
  return false;
}

// Label vocabulary, hoisted so no bare fragment is sprinkled inline below.
const PRINT_JOB_LABEL_FALLBACK = "Print job";
const LABEL_SEPARATOR = " · ";
// Printed slip CONTENT, deliberately its own constant: LABEL_SEPARATOR above is
// UI-only label vocabulary (print-job.ts:77 — a label is never printed), and one
// constant serving both would silently couple a label tweak to the paper.
const PRINTED_NOTE_SEPARATOR = " · ";
const TABLE_LABEL_PREFIX = "T-";
const KOT_ROUND_LABEL_PREFIX = "KOT round ";
const KOT_REPRINT_LABEL = "KOT reprint";
const BILL_LABEL = "Bill";
const BILL_REPRINT_LABEL = "Bill reprint";
const VOID_LABEL = "VOID";
const VOID_REPRINT_LABEL = "VOID reprint";
const MOVED_LABEL = "Moved";
const MOVED_REPRINT_LABEL = "Moved reprint";
const MOVED_ARROW = " → ";
const CANCELLED_LABEL = "Cancelled";
const EOD_LABEL = "End of day";

// Collapses any whitespace run (newlines a product name or void reason carry
// included) so a label stays ONE band row. Safe as a module const: `replace`
// with a /g regex resets `lastIndex` itself.
const WHITESPACE_RUN = /\s+/g;

/** Single-lines, trims and caps one candidate; the trim AFTER the slice stops a
 *  mid-space cut leaving a trailing one. */
function normalizeLabel(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim().slice(0, PRINT_JOB_LABEL_MAX_CHARS).trim();
}

/** Trims, collapses to a single line, and caps at PRINT_JOB_LABEL_MAX_CHARS so a
 *  long product name can never 400 the enqueue (the route's Zod bound). Falls
 *  back to `fallback` when empty — the route's `.min(1)` rejects the whole slip
 *  over a "" label, so this must never return one. */
export function printJobLabel(text: string, fallback: string): string {
  const normalized = normalizeLabel(text);
  if (normalized !== "") return normalized;
  const fromFallback = normalizeLabel(fallback);
  return fromFallback !== "" ? fromFallback : PRINT_JOB_LABEL_FALLBACK;
}

/** What staff call an order: the TABLE when the tab is seated, the orderId
 *  when not. Shared by the label tail below and PH-8's per-order readback chip
 *  (lib/print-readback.ts) so both name the same thing the same way. Takes the
 *  two fields only — a payload SNAPSHOT (not a live Order) is what the chip has. */
export function printJobOrderRef(order: Pick<Order, "tableNo" | "orderId">): string {
  const table = order.tableNo;
  if (typeof table === "string" && table.trim() !== "") return `${TABLE_LABEL_PREFIX}${table}`;
  return order.orderId;
}

/** The " · <where>" tail that makes a band row identifiable at a glance. */
function orderSuffix(order: Order): string {
  return `${LABEL_SEPARATOR}${printJobOrderRef(order)}`;
}

/** One enqueue's two halves: the schema-shaped payload the host renders from,
 *  and the UI-only label the stale band and the readback show. */
export interface PrintJobRequest {
  payload: PrintJobPayload;
  label: string;
}

/** `round` is the CALLER's already-resolved round (a number), or `null` for a
 *  whole-tab reprint — the MERGED-04 discriminator. It is always stated, never
 *  derived here. */
export function kotPrintJob(order: Order, round: number | null): PrintJobRequest {
  const base = round === null ? KOT_REPRINT_LABEL : `${KOT_ROUND_LABEL_PREFIX}${round}`;
  return {
    payload: { kind: "kot", snapshot: printOrderSnapshot(order), round },
    label: printJobLabel(`${base}${orderSuffix(order)}`, order.orderId),
  };
}

// CB-5B S14-remainder — KOTReceipt.tsx's items.map (the SAME renderer the
// owner's absence pin guards, reward-rungs.test.ts:770-779) only ever prints
// `item.instructions` as its "▸" sub-line; it has no `item.reward` branch and
// must never grow one. So a void slip's reward marker has to ride the
// instructions STRING itself, not a new field the renderer would need to
// read. Single-homed here and imported by `use-pos-print.ts`'s `queueVoidSlip`
// twin so the two synthesis sites cannot drift on how the marker is folded in
// (only WHAT they fold — `entry.instructions` vs the local void's own field —
// stays call-site-specific).
export function voidLineInstructionsWithRewardMarker(instructions: string, reward: boolean | undefined): string {
  if (!reward) return instructions;
  // The marker comes from the shared constant, not a per-row snapshot: the void
  // TRAIL deliberately carries no `note` of its own (orderVoidSchema omits it —
  // pinned at reward-item-line-schema-parity.test.ts:108, where an earlier
  // misplacement onto the void schema was corrected).
  return instructions === "" ? REWARD_ITEM_LINE_NOTE : `${instructions}${PRINTED_NOTE_SEPARATOR}${REWARD_ITEM_LINE_NOTE}`;
}

/** The VOID slip. `line` mirrors `use-pos-print.ts`'s `queueVoidSlip` synthesis
 *  field-for-field — voided qty (not what remains), the variation/modifiers/
 *  instructions snapshotted onto the trail entry so the kitchen knows WHICH
 *  cover to stop, and the entry's OWN ticket number. A field missed here
 *  compiles clean and just never prints (memory
 *  `synthesized-print-lines-need-every-new-field`) — grow BOTH sites together. */
export function voidPrintJob(order: Order, entry: OrderVoid, opts: { reprint: boolean }): PrintJobRequest {
  const prefix = opts.reprint ? VOID_REPRINT_LABEL : VOID_LABEL;
  return {
    payload: {
      kind: "void",
      snapshot: printOrderSnapshot(order),
      line: {
        productId: entry.productId,
        name: entry.name,
        // The size that was voided — a tab holding a Small and a Large of one
        // dish needs the slip to say WHICH cover to stop (CR1.3).
        variation: entry.variation,
        price: entry.price,
        qty: entry.qty,
        modifiers: entry.modifiers ?? [],
        instructions: voidLineInstructionsWithRewardMarker(entry.instructions ?? "", entry.reward),
        kotRound: entry.kotRound,
        // Omitted rather than sent as an explicit `undefined`: the sub-schema
        // is `.strict()` with `kotNumber` optional, so both parse — this just
        // keeps the stored JSON off the 64KB M0 cap.
        ...(entry.kotNumber !== undefined ? { kotNumber: entry.kotNumber } : {}),
        // CB-5B S14-remainder — mirrors IOrderVoid.reward (Order.ts:67):
        // the void trail's OWN reward flag rides onto the printed line the
        // same OMIT-EMPTY way `variation`/`kotNumber` already do, so a staff
        // surface reading the print payload (not just the trail) can also
        // tell a comped dish from a sold one.
        ...(entry.reward ? { reward: true as const } : {}),
      },
      // The void's OWN reason/actor/moment, never the tab's opener and open
      // time (CR1.3) — `entry.at` is the field the payload calls `voidedAt`.
      reason: entry.reason,
      voidedBy: entry.voidedBy,
      voidedAt: entry.at,
      ...(opts.reprint ? { reprint: true as const } : {}),
    },
    label: printJobLabel(`${prefix} ${entry.name}${LABEL_SEPARATOR}${order.orderId}`, order.orderId),
  };
}

/** The customer bill. `opts.reprint` is REQUIRED (D-10): without the flag a
 *  staff reprint collides with the resolved original's `jobKey`, answers
 *  `already-resolved` and prints NOWHERE, so tsc forces every caller to say
 *  which it is. `false` OMITS the key (`z.literal(true).optional()`). */
export function billPrintJob(order: Order, opts: { reprint: boolean }): PrintJobRequest {
  const prefix = opts.reprint ? BILL_REPRINT_LABEL : BILL_LABEL;
  return {
    payload: { kind: "bill", snapshot: printOrderSnapshot(order), ...(opts.reprint ? { reprint: true as const } : {}) },
    label: printJobLabel(`${prefix}${LABEL_SEPARATOR}${order.orderId}`, order.orderId),
  };
}

/** The table slip, for all three verbs. `meta.from` is the table the food was
 *  ordered FROM — the order's own `tableNo` is already the destination. It is
 *  OPTIONAL because an ASSIGN seats a tab that never had a table, so there is
 *  no origin to name; the label then reads as a plain destination rather than
 *  an arrow from nowhere. Same required `opts.reprint` reasoning as
 *  `billPrintJob`. */
export function movedPrintJob(
  order: Order,
  meta: { from?: string; movedBy: string; movedAt: string },
  opts: { reprint: boolean },
): PrintJobRequest {
  const prefix = opts.reprint ? MOVED_REPRINT_LABEL : MOVED_LABEL;
  const to = order.tableNo ?? order.orderId;
  const route = meta.from ? `${meta.from}${MOVED_ARROW}${to}` : to;
  return {
    payload: {
      kind: "moved",
      snapshot: printOrderSnapshot(order),
      // Omitted, never null/"": the schema field is optional and this repo's
      // omit-empty discipline keeps an absent origin absent from the payload.
      ...(meta.from ? { from: meta.from } : {}),
      movedBy: meta.movedBy,
      movedAt: meta.movedAt,
      ...(opts.reprint ? { reprint: true as const } : {}),
    },
    label: printJobLabel(`${prefix} ${route}${LABEL_SEPARATOR}${order.orderId}`, order.orderId),
  };
}

/** The end-of-day closing slip — the ONE payload kind with no order snapshot
 *  (§B1): it is a LIVE aggregate over that day's orders and the still-open
 *  tabs, so the host recomputes the whole summary from `dateKey` itself rather
 *  than printing the tapping device's figures. Carries no `jobKey` either, so
 *  re-tapping "End of day" always prints again. Taken as ONE object because
 *  both members are strings and a positional swap would print a slip titled
 *  "2026-09-01" for the wrong day. PH-6 wires it at `EndOfDayButton.tsx`. */
export function eodPrintJob(meta: { dateKey: string; dateLabel: string }): PrintJobRequest {
  return {
    payload: { kind: "eod", dateKey: meta.dateKey, dateLabel: meta.dateLabel },
    label: printJobLabel(`${EOD_LABEL}${LABEL_SEPARATOR}${meta.dateLabel}`, meta.dateKey),
  };
}

/** "Notify Kitchen" on an already-cancelled order — a whole-order void render,
 *  so it carries the cancel reason and no per-line synthesis. This kind has NO
 *  `reprint` member: re-tapping the notice is deliberately repeatable, so it
 *  carries no `jobKey` at all. Called from `OrderDetailSheet.tsx`'s "Notify
 *  Kitchen" action (PH-6) — the one trigger that sends a stop-instruction for
 *  an order that is already cancelled. */
export function cancelNoticePrintJob(order: Order, reason: string): PrintJobRequest {
  return {
    payload: { kind: "cancel-notice", snapshot: printOrderSnapshot(order), reason },
    label: printJobLabel(`${CANCELLED_LABEL}${LABEL_SEPARATOR}${order.orderId}`, order.orderId),
  };
}
