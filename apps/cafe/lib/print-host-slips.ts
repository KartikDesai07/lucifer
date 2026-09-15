// Print-host plan (.claude/plan/v2/print-host-plan.md §B1/§B5, slice PH-5) —
// the PURE half of the drain: turns a claimed job's payload back into the
// exact renderer props the local lane synthesizes in hooks/use-pos-print.ts,
// so a host-printed slip and a locally-printed one are the same paper. Zero
// React, zero DB — every rule here mirrors a named function in use-pos-print.ts
// (kotRoundSlip ↔ queueKotRound/reprintKot, void ↔ queueVoidSlip), and the
// unit suite pins the pair.

import type {
  KotPrintJobPayload,
  PrintJobPayload,
  VoidPrintJobPayload,
} from "@pos/shared/schemas/print-job.schema";
import type { PrintOrderSnapshot } from "@pos/shared/print-job";
import type { KotReceiptVariant } from "@/hooks/use-pos-print";
import type { Order, OrderItem } from "@/types";

/** Web Locks name every window of the host PC contends for — the holder drains,
 *  the others render readback only (§B5, design review MERGED-23). */
export const PRINT_HOST_DRAIN_LOCK_NAME = "pos.print-host.drain";

/** How long the bridge waits for `PrintHostEodSource`'s figures to load before
 *  giving the claimed end-of-day job up — a burned claim with no paper is a
 *  visible "tap End of day again", never a wedged drain (§B5). */
export const PRINT_HOST_EOD_READY_TIMEOUT_MS = 45 * 1000;

/** How long the bridge waits, after firing a surface, for react-to-print's
 *  onAfterPrint/onPrintError before it gives the job up (2026-09-11, owner:
 *  prints must never silently stop). The desktop seam answers within its own
 *  35 s no-reply timeout and a kiosk print returns in seconds, so a window still
 *  open past this is a wedge (a vanished surface, a torn-down iframe), not a
 *  slow printer — releasing it is what keeps every later slip printing. */
export const PRINT_HOST_DISPATCH_TIMEOUT_MS = 90 * 1000;

export const PRINT_HOST_EOD_TIMEOUT_MESSAGE =
  "End-of-day figures did not load on the print host — tap End of day again.";
export const PRINT_HOST_PRINT_FAILED_MESSAGE =
  "The print host could not open that slip — reprint it from Orders.";
/** A surface whose node carries no text would print a BLANK slip and say
 *  nothing; the bridge refuses it out loud instead. */
export const PRINT_HOST_EMPTY_SLIP_MESSAGE =
  "That slip had nothing to print — reprint it from Orders.";
export const PRINT_HOST_BUSY_MESSAGE = "The print host is busy with another slip — try again in a moment.";
export const PRINT_HOST_TEST_TITLE = "print-host-test";

/** The three provider-owned print surfaces (§B5): the KOT/void/moved surface,
 *  the customer bill, and the fixed-80mm end-of-day summary. */
export type HostPrintSurface = "kot" | "receipt" | "eod";

/** A KOT-surface slip — every prop `PrintSources` forwards to `KOTReceipt`. */
export interface HostKotSlip {
  surface: "kot";
  order: Order;
  kotRoundItems?: OrderItem[];
  kotRoundLabel?: string;
  kotRoundNumber?: number;
  kotVariant: KotReceiptVariant;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  movedFrom?: string;
  movedBy?: string;
  movedAt?: string;
  documentTitle: string;
}

export interface HostReceiptSlip {
  surface: "receipt";
  order: Order;
  documentTitle: string;
}

/** The one payload exception (§B1): a live aggregate the host recomputes. */
export interface HostEodSlip {
  surface: "eod";
  dateKey: string;
  dateLabel: string;
  /** Whether the open-tabs section applies — derived on the HOST from
   *  `dateKey` vs the host's own cafe-day at claim time (PH-6 MUST): a slip
   *  tapped at 23:59 and drained at 00:01 prints WITHOUT the open-tabs
   *  section, exactly what End of day itself prints for a past date. */
  isToday: boolean;
  documentTitle: string;
}

export type HostPrintSlip = HostKotSlip | HostReceiptSlip | HostEodSlip;

const ROUND_LABEL_PREFIX = "Round ";
const KOT_TITLE_PREFIX = "KOT-";
const EOD_TITLE_PREFIX = "EOD-";

/** Widens a payload snapshot back into the `Order` the receipts render. The
 *  snapshot carries every field they read (§B1); `updatedAt` is the one
 *  required `Order` key it lacks, and no renderer reads it. */
export function orderFromSnapshot(snapshot: PrintOrderSnapshot): Order {
  return { ...snapshot, updatedAt: snapshot.createdAt };
}

/** Round n's ticket number, or undefined for an unnumbered round — the same
 *  `> 0` guard `queueKotRound` applies so the route's 0 sentinel never prints
 *  as "#0". */
function roundTicketNumber(order: Order, round: number): number | undefined {
  const ticket = order.kotNumbers?.[round - 1];
  return ticket !== undefined && ticket > 0 ? ticket : undefined;
}

/** One fired round (`round` a number — `queueKotRound`'s shape) or the whole
 *  tab (`round: null` — `reprintKot`'s three resets: no items filter, no label,
 *  no number, since that slip matches no single ticket the kitchen holds). */
export function kotRoundSlip(order: Order, round: number | null): HostKotSlip {
  const documentTitle = `${KOT_TITLE_PREFIX}${order.orderId}`;
  if (round === null) {
    return { surface: "kot", order, kotVariant: "kot", documentTitle };
  }
  return {
    surface: "kot",
    order,
    kotRoundItems: order.items.filter((it) => it.kotRound === round),
    kotRoundLabel: `${ROUND_LABEL_PREFIX}${round}`,
    kotRoundNumber: roundTicketNumber(order, round),
    kotVariant: "kot",
    documentTitle,
  };
}

function kotSlipOf(payload: KotPrintJobPayload): HostKotSlip {
  return kotRoundSlip(orderFromSnapshot(payload.snapshot), payload.round);
}

/** `queueVoidSlip` verbatim: the synthesized single line (voided qty, the
 *  entry's own preparation fields), the entry's OWN ticket number, and the
 *  void's own actor/moment on the slip — never the tab's opener/open-time. */
function voidSlipOf(payload: VoidPrintJobPayload): HostKotSlip {
  const order = orderFromSnapshot(payload.snapshot);
  const { kotNumber, ...line } = payload.line;
  return {
    surface: "kot",
    order,
    kotRoundItems: [line],
    kotRoundLabel: `${ROUND_LABEL_PREFIX}${line.kotRound}`,
    kotRoundNumber: kotNumber,
    kotVariant: "void",
    voidReason: payload.reason,
    voidedBy: payload.voidedBy,
    voidedAt: payload.voidedAt,
    documentTitle: `${KOT_TITLE_PREFIX}${order.orderId}`,
  };
}

/**
 * The renderer props for one claimed job. `todayKey` is the HOST's cafe-day
 * (`cafeDateString()` at claim time) — only the `eod` branch reads it.
 * Exhaustive over `PrintJobPayload["kind"]`: a new kind fails to compile here
 * before it can ever print as the wrong document.
 */
export function hostPrintSlipOf(payload: PrintJobPayload, todayKey: string): HostPrintSlip {
  switch (payload.kind) {
    case "kot":
      return kotSlipOf(payload);
    case "void":
      return voidSlipOf(payload);
    case "bill": {
      const order = orderFromSnapshot(payload.snapshot);
      return { surface: "receipt", order, documentTitle: order.orderId };
    }
    case "moved": {
      // KOTReceipt's "moved" banner suppresses the item list itself; the three
      // meta props are the mover and moment PH-4 added the PrintSources props
      // for (PH-4 MUST — omitting them prints the tab's opener instead).
      const order = orderFromSnapshot(payload.snapshot);
      return {
        surface: "kot",
        order,
        kotVariant: "moved",
        movedFrom: payload.from,
        movedBy: payload.movedBy,
        movedAt: payload.movedAt,
        documentTitle: `${KOT_TITLE_PREFIX}${order.orderId}`,
      };
    }
    case "cancel-notice": {
      // Whole-order void render (§B1): no roundItems, so KOTReceipt lists every
      // item under the void banner with the cancel reason; the snapshot carries
      // no cancelledBy/At, so the Staff/Time lines stay off — there is no
      // single actor for a cancelled order the way there is for a voided line.
      const order = orderFromSnapshot(payload.snapshot);
      return {
        surface: "kot",
        order,
        kotVariant: "void",
        voidReason: payload.reason,
        documentTitle: `${KOT_TITLE_PREFIX}${order.orderId}`,
      };
    }
    case "eod":
      return {
        surface: "eod",
        dateKey: payload.dateKey,
        dateLabel: payload.dateLabel,
        isToday: payload.dateKey === todayKey,
        documentTitle: `${EOD_TITLE_PREFIX}${payload.dateKey}`,
      };
  }
}
