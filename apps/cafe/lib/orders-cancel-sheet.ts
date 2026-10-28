// The Orders page's cancel sheet as a pure controller (U2 final fix wave, 2026-10-23; the whole-branch review's Important
// 1; docs/superpowers/specs/2026-10-23-orders-match-html-design.md 6.6, 6.10; Ruling P6). An admin's "Cancel this order"
// opens the sheet for that order; Escape and "Keep order" close it only while no cancel request is in flight (the sheet
// itself never closes on an outside press: components/orders/CancelOrderDialog.tsx); the cancelled order the server
// returns becomes the detail, as a settle's does, but only while the sheet is still open for that order — so a late
// success can never swap a choice the operator made since. hooks/use-cancel-sheet.ts wires the ports (the sheet's order
// in a ref, today's request, the page's setDetail); tested over fake ports in lib/orders-cancel-sheet.test.ts.
// Client-safe: no React.
import type { Order } from "@/types";

export interface CancelSheetPorts {
  /** The order the sheet is open for right now (null: closed): the latest value, read again after the request's await. */
  openFor: () => Order | null;
  /** Opens the sheet for an order, or closes it (null). */
  setOpenFor: (order: Order | null) => void;
  /** The cancel request is in flight. */
  pending: () => boolean;
  /** Today's cancel request (the hook toasts its success or failure). */
  send: (id: string, reason: string) => Promise<Order>;
  /** The page's choice: the cancelled order becomes the detail. */
  choose: (order: Order) => void;
}

export interface CancelSheet {
  /** The detail's "Cancel this order". */
  open: (order: Order) => void;
  /** The sheet's onOpenChange: Escape or "Keep order" close an idle sheet only. */
  onOpenChange: (open: boolean) => void;
  /** "Cancel order" with the trimmed reason (the dialog's rules). */
  confirm: (reason: string) => Promise<void>;
}

export function cancelSheet(ports: CancelSheetPorts): CancelSheet {
  return {
    open: (order) => ports.setOpenFor(order),
    onOpenChange: (open) => {
      if (!open && !ports.pending()) ports.setOpenFor(null);
    },
    confirm: async (reason) => {
      const target = ports.openFor();
      if (!target) return;
      try {
        const cancelled = await ports.send(target._id, reason);
        if (ports.openFor()?._id !== target._id) return;
        ports.choose(cancelled);
        ports.setOpenFor(null);
      } catch {
        // the hook toasts a failure; the sheet stays open
      }
    },
  };
}
