"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";
import { toast } from "sonner";

import { cn, inr } from "@/lib/utils";
import { POS_MOVE_TABLE_LIST_CAP_CLASS } from "@/lib/pos-layout";
import { slipPrintOptions } from "@/lib/desktop-shell";
import { printConfigOf, receiptPageStyle } from "@/lib/print";
import { moveChargePreview } from "@/lib/move-charge-preview";
import { useTables } from "@/hooks/use-tables";
import { useSettings } from "@/hooks/use-settings";
import { useMoveOrderTable } from "@/hooks/use-orders";
import { useHostRouting } from "@/hooks/use-print-routing";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import type { Order, Table } from "@/types";

// Same colour vocabulary as components/pos/TableSelector.tsx (CLAUDE.md §10
// table colors), duplicated rather than imported: that control's tap means
// "select/resume", this one's means "move a live tab", and nothing should
// couple the two just to share four lines of Tailwind classes.
const STATUS_STYLE: Record<string, string> = {
  Available: "border-green-300 bg-green-50 text-green-700",
  Occupied: "border-red-300 bg-red-50 text-red-700",
  Reserved: "border-amber-300 bg-amber-50 text-amber-700",
};

// Mirrors lib/table-admin.ts's isTableFree, NOT imported from there: that
// module's first line is `import { Table } from "@/models/Table"`, a live
// Mongoose model — pulling it into this client bundle would ship a server-only
// dependency to the browser. The predicate is one line and not worth a shared
// module across that boundary.
function isFree(table: Table): boolean {
  return table.status === "Available" && !table.currentOrderId;
}

interface MoveTableDialogProps {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Called with the moved/assigned/unseated order and the table it came FROM
  // (undefined on an assign — there was none), after the slip has been sent to
  // the printer, so a caller holding tab state can re-sync.
  onMoved?: (order: Order, fromTableNo: string | undefined) => void;
}

// The routed lane's verdict arrives after a round trip, and the print node below
// renders `slip` as it is THEN. `slip` is never cleared, so a second move inside
// that window would make the first slip's fallback print the SECOND move's paper
// — and the second's fallback print it again, leaving move #1 with nothing.
const PRINT_MOVE_SUPERSEDED_MESSAGE =
  "Another table move happened before that slip could print here — reprint it from Orders.";

// One pending slip, captured the instant the move succeeds: the table it came
// FROM (the order's own tableNo has already flipped to the destination by
// then) and this terminal's wall clock — there is no server-authoritative
// "moved at" on the order document, and this is what the operator is handing
// the kitchen right now.
interface PendingSlip {
  order: Order;
  // Absent for an ASSIGN — a tab with no table has nowhere to name as the
  // slip's "from". KOTReceipt already treats an absent movedFrom as "just
  // show the destination" (see its movedFrom prop).
  from: string | undefined;
  at: Date;
}

// One component owns the whole move interaction (Orders detail sheet + POS)
// so both surfaces behave identically and there is exactly one print path.
export function MoveTableDialog({ order, open, onOpenChange, onMoved }: MoveTableDialogProps) {
  const tables = useTables();
  const settings = useSettings();
  const moveTable = useMoveOrderTable();
  const { user } = useAuth();
  // This dialog is the ONLY moved-slip trigger on either surface (the POS and
  // the Orders sheet both render it), and it cannot reach usePosPrint — so the
  // host routing for this one document is wired here (§B5 carve-out).
  const { shouldRoute, queueMovedSlip } = useHostRouting();

  const [slip, setSlip] = useState<PendingSlip | null>(null);
  // Guards against printing the same slip twice — e.g. a parent re-render while
  // `slip` is still set from the last move. Keyed on the slip OBJECT's identity,
  // not on order id + destination: a tab that goes T1 → T2 → T1 → T2 within one
  // mount would hit an id+table key it had already printed, and the kitchen would
  // silently get no slip for that last move. Every move builds a fresh object,
  // so identity is unique per move while still absorbing re-renders.
  const printedSlipRef = useRef<PendingSlip | null>(null);
  // The slip the print node is rendering RIGHT NOW, readable from a callback
  // that runs after an await. A LAYOUT effect, not a passive one: the passive
  // flush is a scheduler task, so a promise continuation can run between the
  // commit that swapped the DOM and the mirror catching up — the same
  // one-wrong-frame reasoning RequestAlertBar.tsx already uses.
  const shownSlipRef = useRef<PendingSlip | null>(slip);
  useLayoutEffect(() => {
    shownSlipRef.current = slip;
  }, [slip]);

  const kotRef = useRef<HTMLDivElement>(null);
  const printSlip = useReactToPrint(slipPrintOptions({
    contentRef: kotRef,
    documentTitle: order ? `MOVED-${order.orderId}` : "moved",
    // The kitchen's own paper width, exactly like every other KOT print.
    pageStyle: receiptPageStyle(printConfigOf(settings.data).kot.paperWidth),
  }));

  useEffect(() => {
    if (!slip) return;
    if (printedSlipRef.current === slip) return;
    printedSlipRef.current = slip;
    // Firing here — after the mutation's success has already committed on a
    // prior tick — guarantees this print never shares a tick with another
    // print job. react-to-print keeps one fixed-id iframe (lib/print.ts): two
    // jobs in the same tick makes the second's teardown delete the first's
    // just-appended iframe.
    //
    // When a print host owns printing, this slip is ENQUEUED for the counter PC
    // and printSlip() runs only if the server answers that this device must
    // print it after all — queueMovedSlip is the sole reader of that verdict
    // (D-11), so exactly ONE of the two lanes ever prints: a duplicate slip at
    // the counter is worse than a missing one (§B7). The gate is `shouldRoute`,
    // not `hostConfigured`: on a degraded pulse tick a device that has already
    // SEEN a host must still attempt the enqueue instead of printing here
    // (§F/MERGED-19), and it is the very same predicate queueMovedSlip checks
    // internally, read from this same render — the two cannot disagree. Kept as
    // an explicit branch so the no-host lane still fires synchronously, in this
    // tick, before the dialog closes (§F byte-identical parity).
    //
    // ASSIGN builds a slip with no `from` (a walk-in tab had no table to name),
    // and that routes exactly like the other two: `from` is optional all the
    // way down (movedPayloadSchema, queueMovedSlip), and KOTReceipt already
    // renders an absent movedFrom as just the destination. Routing must NOT
    // depend on which verb produced the slip — a cafe with a print host expects
    // every table slip at the counter printer, not just two of the three.
    if (!shouldRoute) {
      printSlip();
    } else {
      void queueMovedSlip(slip.order, {
        from: slip.from,
        // Identical to what the off-screen KOTReceipt below renders, so the
        // counter's paper reads the same as this device's would have.
        movedBy: user?.name ?? "Staff",
        movedAt: slip.at.toISOString(),
      }).then((routed) => {
        if (routed) return;
        // Identity, not ids — every move builds a fresh slip object, exactly as
        // the printed-once guard above relies on.
        if (shownSlipRef.current === slip) {
          printSlip();
          return;
        }
        toast.error(PRINT_MOVE_SUPERSEDED_MESSAGE);
      });
    }
    onOpenChange(false);
    onMoved?.(slip.order, slip.from);
    // slip is the only thing this effect reacts to — printSlip/onOpenChange/
    // onMoved are stable-enough call targets and re-running on their identity
    // would defeat the printed-once guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slip]);

  const currentTableNo = order?.tableNo;
  // The three verbs the route accepts share this one dialog: no table means
  // only ASSIGN is possible; a seated tab can MOVE or UNSEAT.
  const isAssign = !currentTableNo;

  // Owner decision 1/2 (plan §0, 2026-09-25): a move now auto-adds/removes
  // the DESTINATION table's charge, but staff sees the money delta and
  // confirms first. Tapping a table no longer fires the mutation directly: it
  // sets a pending selection, and THIS panel (rendered inside the same
  // DialogContent, not a nested Dialog) is the only gate in front of the
  // mutateAsync call below. `unseatPending` is the same gate for the third
  // verb — the two are mutually exclusive by construction (see JSX below).
  const [pendingTable, setPendingTable] = useState<Table | null>(null);
  const [unseatPending, setUnseatPending] = useState(false);
  // Closing the dialog (Cancel, Escape, outside click) or switching to a
  // different order must not leave a stale confirm panel armed for whatever
  // opens next.
  useEffect(() => {
    if (!open) {
      setPendingTable(null);
      setUnseatPending(false);
    }
  }, [open]);
  useEffect(() => {
    setPendingTable(null);
    setUnseatPending(false);
  }, [order?._id]);

  // PREVIEW ONLY (useTables() already has full Table[] in hand, no new
  // fetch) — the server re-reads the destination authoritatively at move
  // time, so this is never more than a preview. lib/move-charge-preview.ts
  // reuses the same shared helpers the server-side writer uses so the two
  // cannot disagree. unseatPending previews against `null`, the same
  // "no destination" input the shared helper treats as "drop the charge".
  const preview = moveChargePreview(order, unseatPending ? null : pendingTable);

  // Exact shape pinned (lib/charge-ui-paths.test.ts PIN 1): a pure selection,
  // no mutation. Structurally unreachable while unseatPending is armed — the
  // grid it feeds only renders when neither confirm panel is showing.
  const handlePick = (table: Table) => setPendingTable(table);
  const armUnseat = () => setUnseatPending(true);
  const cancelPending = () => {
    setPendingTable(null);
    setUnseatPending(false);
  };

  const confirmLabel = unseatPending ? "Remove from table" : isAssign ? "Assign table" : "Move table";

  const confirmMove = async () => {
    if (!order) return;
    const nextTableNo = unseatPending ? null : pendingTable?.tableNo;
    if (nextTableNo === undefined) return;
    try {
      const updated = await moveTable.mutateAsync({ id: order._id, tableNo: nextTableNo });
      setSlip({ order: updated, from: currentTableNo, at: new Date() });
      setPendingTable(null);
      setUnseatPending(false);
    } catch {
      // hook toasts on error; dialog stays open (still on the confirm panel) to retry
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isAssign ? "Assign a table" : "Move table"}</DialogTitle>
            <DialogDescription>
              {isAssign ? (
                "Pick a free table to seat this tab at — the kitchen gets a slip so they can match it to the ticket they're holding."
              ) : (
                <>
                  Currently on{" "}
                  <span className="font-medium text-foreground">{currentTableNo}</span>
                  . Pick a free table to move this tab to — the kitchen gets a
                  slip so they can match it to the ticket they&apos;re holding.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {pendingTable || unseatPending ? (
            // The confirm step (plan §5B) — inside the SAME DialogContent, not
            // a nested Dialog. Only gate in front of moveTable.mutateAsync
            // (source-pinned: lib/charge-ui-paths.test.ts). Shared by all
            // three verbs — preview/confirmLabel already resolve to whichever
            // is armed; the two are mutually exclusive by construction.
            <div className="space-y-3">
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                {preview.note && <p>{preview.note}</p>}
                <p className={preview.note ? "mt-1 font-semibold" : "font-semibold"}>
                  New total: {inr(preview.total)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={moveTable.isPending}
                  onClick={cancelPending}
                >
                  Cancel
                </Button>
                <Button
                  className="min-h-11"
                  disabled={moveTable.isPending}
                  onClick={confirmMove}
                >
                  {confirmLabel}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className={cn("grid grid-cols-3 gap-2 overflow-y-auto", POS_MOVE_TABLE_LIST_CAP_CLASS)}>
                {(tables.data ?? []).map((t) => {
                  const isCurrent = t.tableNo === currentTableNo;
                  const tappable = !isCurrent && isFree(t);
                  const disabled = !tappable || moveTable.isPending;
                  return (
                    <button
                      key={t._id}
                      type="button"
                      disabled={disabled}
                      onClick={() => handlePick(t)}
                      className={cn(
                        "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border p-2 text-sm font-semibold transition",
                        STATUS_STYLE[t.status],
                        isCurrent && "ring-2 ring-primary ring-offset-1",
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <span className="max-w-full truncate px-1">{t.tableNo}</span>
                      <span className="max-w-full truncate text-[10px] font-normal">
                        {isCurrent ? "Current" : t.status} · {t.capacity} seats
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Its own row, never a grid tile — a tile-shaped control here
                  could be mis-tapped while scanning tables. Still gated by the
                  same confirm panel above before anything fires. */}
              {!isAssign && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 w-full justify-center text-sm font-medium text-destructive hover:text-destructive"
                  disabled={moveTable.isPending}
                  onClick={armUnseat}
                >
                  Remove from table
                </Button>
              )}

              <Button
                variant="outline"
                disabled={moveTable.isPending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Off-screen print source — a SIBLING of <Dialog>, not a child of it:
          closing the dialog unmounts DialogContent (Radix, no forceMount), and
          this node must survive that so react-to-print's clone-on-print keeps
          working across the close that happens right after printSlip() fires. */}
      <div className="pointer-events-none absolute left-[-9999px] top-0" aria-hidden>
        <KOTReceipt
          order={slip?.order ?? null}
          settings={settings.data}
          variant="moved"
          movedFrom={slip?.from}
          movedBy={user?.name ?? "Staff"}
          movedAt={slip?.at}
          ref={kotRef}
        />
      </div>
    </>
  );
}
