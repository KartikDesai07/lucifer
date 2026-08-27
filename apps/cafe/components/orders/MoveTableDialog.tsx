"use client";

import { useEffect, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";

import { cn, inr } from "@/lib/utils";
import { printConfigOf, receiptPageStyle } from "@/lib/print";
import { useTables } from "@/hooks/use-tables";
import { useSettings } from "@/hooks/use-settings";
import { useMoveOrderTable } from "@/hooks/use-orders";
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
  // Called with the moved order and the table it came FROM, after the slip has
  // been sent to the printer, so a caller holding tab state can re-sync.
  onMoved?: (order: Order, fromTableNo: string) => void;
}

// One pending slip, captured the instant the move succeeds: the table it came
// FROM (the order's own tableNo has already flipped to the destination by
// then) and this terminal's wall clock — there is no server-authoritative
// "moved at" on the order document, and this is what the operator is handing
// the kitchen right now.
interface PendingSlip {
  order: Order;
  from: string;
  at: Date;
}

// One component owns the whole move interaction (Orders detail sheet + POS)
// so both surfaces behave identically and there is exactly one print path.
export function MoveTableDialog({ order, open, onOpenChange, onMoved }: MoveTableDialogProps) {
  const tables = useTables();
  const settings = useSettings();
  const moveTable = useMoveOrderTable();
  const { user } = useAuth();

  const [slip, setSlip] = useState<PendingSlip | null>(null);
  // Guards against printing the same slip twice — e.g. a parent re-render while
  // `slip` is still set from the last move. Keyed on the slip OBJECT's identity,
  // not on order id + destination: a tab that goes T1 → T2 → T1 → T2 within one
  // mount would hit an id+table key it had already printed, and the kitchen would
  // silently get no slip for that last move. Every move builds a fresh object,
  // so identity is unique per move while still absorbing re-renders.
  const printedSlipRef = useRef<PendingSlip | null>(null);

  const kotRef = useRef<HTMLDivElement>(null);
  const printSlip = useReactToPrint({
    contentRef: kotRef,
    documentTitle: order ? `MOVED-${order.orderId}` : "moved",
    // The kitchen's own paper width, exactly like every other KOT print.
    pageStyle: receiptPageStyle(printConfigOf(settings.data).kot.paperWidth),
  });

  useEffect(() => {
    if (!slip) return;
    if (printedSlipRef.current === slip) return;
    printedSlipRef.current = slip;
    // Firing here — after the mutation's success has already committed on a
    // prior tick — guarantees this print never shares a tick with another
    // print job. react-to-print keeps one fixed-id iframe (lib/print.ts): two
    // jobs in the same tick makes the second's teardown delete the first's
    // just-appended iframe.
    printSlip();
    onOpenChange(false);
    onMoved?.(slip.order, slip.from);
    // slip is the only thing this effect reacts to — printSlip/onOpenChange/
    // onMoved are stable-enough call targets and re-running on their identity
    // would defeat the printed-once guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slip]);

  const currentTableNo = order?.tableNo;
  // Always visible regardless of which table gets tapped — the one thing an
  // operator can get wrong is assuming a move re-prices the bill. Covers both
  // directions: the order's own snapshot charge survives untouched, and a
  // destination table's charge is never picked up just by moving onto it.
  const moneyNote =
    order && order.chargeAmount
      ? `Moving keeps the bill's ${order.chargeLabel ?? "table charge"} of ${inr(order.chargeAmount)} — it is not re-priced. Change it from the POS cart if the bill needs to change.`
      : "This order carries no table charge. If the table you move to has one, moving here will NOT add it to this bill — that only happens from the POS cart.";

  const handlePick = async (tableNo: string) => {
    if (!order || !currentTableNo) return;
    try {
      const updated = await moveTable.mutateAsync({ id: order._id, tableNo });
      setSlip({ order: updated, from: currentTableNo, at: new Date() });
    } catch {
      // hook toasts on error; dialog stays open to retry
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move table</DialogTitle>
            <DialogDescription>
              Currently on{" "}
              <span className="font-medium text-foreground">
                {currentTableNo ?? "Walk-In"}
              </span>
              . Pick a free table to move this tab to — the kitchen gets a
              slip so they can match it to the ticket they&apos;re holding.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            {moneyNote}
          </div>

          <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto">
            {(tables.data ?? []).map((t) => {
              const isCurrent = t.tableNo === currentTableNo;
              const tappable = !isCurrent && isFree(t);
              const disabled = !tappable || moveTable.isPending;
              return (
                <button
                  key={t._id}
                  type="button"
                  disabled={disabled}
                  onClick={() => handlePick(t.tableNo)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-0.5 rounded-lg border p-2 text-sm font-semibold transition",
                    STATUS_STYLE[t.status],
                    isCurrent && "ring-2 ring-primary ring-offset-1",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span>{t.tableNo}</span>
                  <span className="text-[10px] font-normal">
                    {isCurrent ? "Current" : t.status} · {t.capacity} seats
                  </span>
                </button>
              );
            })}
          </div>

          <Button
            variant="outline"
            disabled={moveTable.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
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
