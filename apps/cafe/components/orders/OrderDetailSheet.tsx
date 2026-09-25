"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useReactToPrint } from "react-to-print";
import { Printer, ChefHat, MessageCircle, HandCoins, Replace } from "lucide-react";

import { toast } from "sonner";

import { orderItemLabel, discountLineLabel } from "@pos/shared/utils";
import { REWARD_ITEM_LINE_NOTE } from "@pos/shared/reward-redemption";
import { chargesFromOrder } from "@pos/shared/order-charges";
import { PAY_STYLES, type SettlementPayMode } from "@/lib/constants";
import { inr, formatDate, cn } from "@/lib/utils";
import { slipPrintOptions } from "@/lib/desktop-shell";
import { printConfigOf, receiptPageStyle } from "@/lib/print";
import { billPrintJob, cancelNoticePrintJob, kotPrintJob } from "@/lib/print-routing";
import { useSettings } from "@/hooks/use-settings";
import { useSettleOrder } from "@/hooks/use-orders";
import { useHostRouting } from "@/hooks/use-print-routing";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { OrderVoidTrail } from "@/components/orders/OrderVoidTrail";
import { MoveTableDialog } from "@/components/orders/MoveTableDialog";
import type { PaymentResult } from "@/components/pos/PaymentModal";
import { collectedAmount } from "@/lib/payment-result";
import type { Customer, Order } from "@/types";

const PaymentModal = dynamic(
  () => import("@/components/pos/PaymentModal").then((m) => m.PaymentModal),
  { ssr: false },
);

// wa.me share link (no recipient — opens WhatsApp's contact picker), per
// CLAUDE.md §12 nice-to-have. Order has no customer mobile, so we don't prefill.
// Branding lines come from Settings only — no hardcoded name/footer fallback
// (CR1.5): each line is skipped entirely when the cafe hasn't set it.
function whatsAppLink(
  order: Order,
  restaurantName: string,
  receiptFooter: string,
): string {
  const text = [
    ...(restaurantName ? [`*${restaurantName} - Receipt*`] : []),
    `Order: ${order.orderId}`,
    `Date: ${formatDate(order.createdAt)}`,
    `Total: ${inr(order.total)}`,
    `Payment: ${order.payment}`,
    ...(receiptFooter ? ["", receiptFooter] : []),
  ].join("\n");
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

// A routed print's local fallback runs only AFTER the enqueue round trip, and
// react-to-print resolves its content node at CALL time (verified against the
// installed 3.3.0 dist). By then this sheet may have moved on, and all three
// outcomes are silent: for ~300ms after a close the ref'd wrapper is still
// mounted but EMPTY (OrderReceipt gates only its contents on `order`), so a
// BLANK slip prints and looks like success; after that the node is unmounted and
// react-to-print only console.errors; and if a different order was opened into
// this same instance, the paper shows THAT order while the document title and
// the queued label still say this one. So the fallback prints only while its own
// order is still on screen, and says so when it is not.
const PRINT_ORDER_CHANGED_MESSAGE =
  "That order is no longer open — reopen it from the list and print again.";

interface OrderDetailSheetProps {
  order: Order | null;
  onOpenChange: (open: boolean) => void;
  // Called with a fresher version of this order after ANY action taken inside the
  // sheet that changes it — a settle (keeping the sheet open on the now-Completed
  // order, Print available) or a table move — so the parent can refresh the
  // snapshot it is passing back in. Named for the settle that came first.
  onSettled?: (order: Order) => void;
}

export function OrderDetailSheet({
  order,
  onOpenChange,
  onSettled,
}: OrderDetailSheetProps) {
  const settings = useSettings();
  const settleOrder = useSettleOrder();
  // Both buttons in this sheet's footer are INDEPENDENT print sites: they fire
  // their own useReactToPrint triggers straight from onClick and never touch
  // usePosPrint, so nothing routes them to a print host unless it is wired
  // here (§B5 carve-out). One hook instance, so two quick taps serialize —
  // and `enqueuePending` disables BOTH while either POST is in flight (PH-8
  // MUST): these payloads are jobKey-less, the routed lane is silent on
  // "queued", so a double tap would mint two slips at the counter.
  const { routePrint, enqueuePending } = useHostRouting();
  const [settleOpen, setSettleOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  // Only relevant for a Due/Credit (or partial) settle on an order that has no
  // customer yet — reset whenever the sheet switches to viewing a new order.
  const [settleCustomer, setSettleCustomer] = useState<Customer | undefined>();
  useEffect(() => setSettleCustomer(undefined), [order?._id]);

  // A reprint has to declare the SAME paper the slip is laid out for. The
  // receipt and KOT components below resolve their own width from Settings, so
  // a fixed 80mm page here would make a 58mm cafe's duplicate bill shrink-to-fit
  // (or clip the amount column) while its original POS slip printed correctly —
  // the exact mismatch lib/print.ts warns about.
  const printCfg = printConfigOf(settings.data);

  const receiptRef = useRef<HTMLDivElement>(null);
  const print = useReactToPrint(slipPrintOptions({
    contentRef: receiptRef,
    documentTitle: order?.orderId ?? "receipt",
    pageStyle: receiptPageStyle(printCfg.bill.paperWidth),
  }));

  const kotRef = useRef<HTMLDivElement>(null);
  const printKot = useReactToPrint(slipPrintOptions({
    contentRef: kotRef,
    documentTitle: order ? `KOT-${order.orderId}` : "kot",
    pageStyle: receiptPageStyle(printCfg.kot.paperWidth),
  }));

  const due = order ? order.total - order.paidAmount : 0;
  const payStyle = order ? PAY_STYLES[order.payment] : undefined;
  const restaurantName = settings.data?.restaurantName?.trim() ?? "";
  const receiptFooter = settings.data?.receiptFooter?.trim() ?? "";
  const isOpenTab = order?.status === "Pending";
  const isCancelled = order?.status === "Cancelled";

  // The order this sheet is showing RIGHT NOW, readable from a callback that
  // runs after an await — a handler's own closure holds the order as it was at
  // TAP time, which is exactly what this has to be compared against.
  // A LAYOUT effect, not a passive one: the passive flush is a scheduler task,
  // so the enqueue's promise continuation can run between the commit that put a
  // different order in the print DOM and the mirror catching up — one wrong
  // frame is enough to print it, the same reasoning RequestAlertBar.tsx uses.
  const shownOrderRef = useRef<Order | null>(order);
  useLayoutEffect(() => {
    shownOrderRef.current = order;
  }, [order]);

  // Wraps a local print trigger so a DEFERRED routed fallback can only fire
  // while the print DOM still renders the order the tap referred to — one
  // comparison covering all three windows above (closed sheet ⇒ null, switched
  // order ⇒ a different _id). On the no-host lane routePrint calls this
  // SYNCHRONOUSLY inside the click tick, where the check is trivially true, so
  // today's local path is unchanged (§F).
  const localPrintOf = (target: Order, trigger: () => void) => () => {
    if (shownOrderRef.current?._id === target._id) {
      trigger();
      return;
    }
    toast.error(PRINT_ORDER_CHANGED_MESSAGE);
  };

  // Staff asked for this bill by tapping Print, so it is always a duplicate:
  // `reprint: true` (D-10). Without the flag the job carries the same dedupe
  // key as the bill the POS already printed, the enqueue answers "that one is
  // already resolved", and the slip appears NOWHERE.
  const printBill = () => {
    // Reachable with no order for the ~300ms the sheet spends animating out
    // (SheetContent — buttons included — is still mounted once `order` has gone
    // null). Printing then is NOT the harmless no-op it looks like: OrderReceipt
    // renders its ref'd wrapper unconditionally and gates only the CONTENTS, so
    // react-to-print would happily emit a blank page and say nothing.
    if (!order) {
      toast.error(PRINT_ORDER_CHANGED_MESSAGE);
      return;
    }
    routePrint(() => billPrintJob(order, { reprint: true }), localPrintOf(order, print));
  };

  // One button, TWO kitchen documents (MERGED-04), matching what the off-screen
  // KOTReceipt below renders for each case: a whole-tab reprint (`round: null`,
  // the repeatable discriminator — it must never dedupe onto a fired round's
  // key) or, once the order is cancelled, the "Notify Kitchen" stop-notice that
  // carries the cancel reason instead of a round.
  const printKitchenSlip = () => {
    // Same blank-page window as printBill above (KOTReceipt gates its contents
    // the same way).
    if (!order) {
      toast.error(PRINT_ORDER_CHANGED_MESSAGE);
      return;
    }
    routePrint(
      () =>
        isCancelled
          ? cancelNoticePrintJob(order, order.cancelReason ?? "")
          : kotPrintJob(order, null),
      localPrintOf(order, printKot),
    );
  };

  const handleSettle = async (result: PaymentResult) => {
    if (!order) return;
    try {
      const updated = await settleOrder.mutateAsync({
        id: order._id,
        data: {
          payment: result.payment as SettlementPayMode,
          splitCash: result.splitCash,
          splitOnline: result.splitOnline,
          // The order's own customer is authoritative once attached; only an
          // unattached order can pick one up here. No `discount` — this path
          // (unlike the POS settle) always charges the stored total unchanged.
          customerId: order.customerId ?? settleCustomer?._id,
          paidAmount: collectedAmount(result),
          // Only meaningful alongside a defined paidAmount above — lets the
          // route detect a stale `order` snapshot (CR1.2 regression).
          total: order.total,
        },
      });
      setSettleOpen(false);
      onSettled?.(updated);
    } catch {
      // hook toasts on error; leave the modal open to retry
    }
  };

  return (
    <Sheet open={!!order} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{order?.orderId}</SheetTitle>
          <SheetDescription>
            {order && (
              <>
                {formatDate(order.createdAt)} ·{" "}
                {new Date(order.createdAt).toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        {order && (
          <div className="flex flex-1 flex-col gap-4 p-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={order.status === "Completed" ? "default" : "secondary"}
                className={cn(
                  order.status === "Pending" && "bg-amber-100 text-amber-800",
                  order.status === "Completed" && "bg-green-100 text-green-800",
                  order.status === "Cancelled" && "bg-gray-100 text-gray-800",
                )}
              >
                {order.status}
              </Badge>
              <Badge variant="outline" className={cn(payStyle?.color)}>
                {payStyle?.label ?? order.payment}
              </Badge>
              <Badge variant="outline">{order.tableNo ?? "Walk-In"}</Badge>
            </div>

            {/* Colour alone never carries this — the heading names it too, and
                the reason/who/when make the cancellation legible on its own. */}
            {order.status === "Cancelled" && (
              <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                <p className="font-semibold">Cancelled</p>
                {order.cancelReason && <p>{order.cancelReason}</p>}
                <p className="text-xs opacity-80">
                  {order.cancelledBy ?? "Unknown"}
                  {order.cancelledAt && ` · ${formatDate(order.cancelledAt)}`}
                </p>
              </div>
            )}

            <div className="space-y-1">
              <Row label="Customer" value={order.customerName} />
              <Row label="Served by" value={order.receiver} />
            </div>

            <Separator />

            <div className="space-y-2">
              {order.items.map((item, i) => (
                <div key={`${item.productId}-${i}`} className="flex justify-between">
                  <div className="min-w-0">
                    <span className="font-medium">
                      {orderItemLabel(item)}
                      {item.qty > 1 ? ` ×${item.qty}` : ""}
                    </span>
                    {item.modifiers.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        + {item.modifiers.join(", ")}
                      </div>
                    )}
                    {item.instructions && (
                      <div className="text-xs italic text-muted-foreground">
                        {item.instructions}
                      </div>
                    )}
                    {/* CB-5B — a reward line's money is excluded from the
                        subtotal (lib/receipt.ts's reducer skips it), so
                        showing its real price here would make the amounts
                        below visibly not add up. The stored `note` is
                        preferred over the live constant so a settled order
                        reads the same note it was issued with; only a
                        pre-S14 reward line (stored before this field
                        existed) falls back to it. */}
                    {item.reward && (
                      <div className="text-xs italic text-muted-foreground">
                        {item.note ?? REWARD_ITEM_LINE_NOTE}
                      </div>
                    )}
                  </div>
                  {item.reward ? (
                    <span className="whitespace-nowrap">
                      <span className="line-through opacity-60">{inr(item.price * item.qty)}</span>{" "}
                      FREE
                    </span>
                  ) : (
                    <span>{inr(item.price * item.qty)}</span>
                  )}
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-1">
              <Row label="Subtotal" value={inr(order.subtotal)} />
              {order.discount > 0 && (
                <Row label={discountLineLabel(order.discountKind)} value={`−${inr(order.discount)}`} />
              )}
              {/* CB-CHG — every charge line (table + staff-entered extras),
                  from the order's own snapshot, so this sheet reads the same
                  as the slip that was printed for the customer, even if the
                  table has since changed what it charges. A legacy order
                  derives to exactly the one line the old conditional showed. */}
              {chargesFromOrder(order).map((c, i) => (
                <Row key={`${c.label}-${i}`} label={c.label} value={`+${inr(c.amount)}`} />
              ))}
              <div className="flex justify-between text-base font-bold">
                <span>Total</span>
                <span>{inr(order.total)}</span>
              </div>
              <Row label="Paid" value={inr(order.paidAmount)} />
              {due > 0 && order.status === "Completed" && (
                <div className="flex justify-between font-medium text-destructive">
                  <span>Due</span>
                  <span>{inr(due)}</span>
                </div>
              )}
            </div>

            {order.voids && order.voids.length > 0 && (
              <>
                <Separator />
                <OrderVoidTrail voids={order.voids} />
              </>
            )}
          </div>
        )}

        {/* Two rows at EVERY width. The sheet is at most 28rem wide
            (sm:max-w-md above), but the SheetFooter primitive switches to a
            single sm:flex-row line at >=640px — five buttons in 448px
            overlapped their icons and truncated "Share" (owner screenshots,
            2026-09-08). The secondary actions share one grid (2 columns when
            Move table joins them, 3 otherwise) and Settle & Pay keeps a full
            row of its own, so the primary action is never squeezed. */}
        <SheetFooter className="flex-col gap-2 px-4 sm:flex-col sm:justify-start sm:space-x-0">
          <div className={cn("grid gap-2", isOpenTab && !!order.tableNo ? "grid-cols-2" : "grid-cols-3")}>
            <Button variant="outline" onClick={printBill} disabled={enqueuePending}>
              <Printer className="mr-2 h-4 w-4" /> Print
            </Button>
            <Button variant="outline" onClick={printKitchenSlip} disabled={enqueuePending}>
              <ChefHat className="mr-2 h-4 w-4" /> {isCancelled ? "Notify Kitchen" : "KOT"}
            </Button>
            <Button variant="outline" asChild>
              <a
                href={
                  order
                    ? whatsAppLink(order, restaurantName, receiptFooter)
                    : "#"
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="mr-2 h-4 w-4" /> Share
              </a>
            </Button>
            {/* Same live-tab gate as Settle & Pay, plus a table to move FROM —
                a walk-in order has nothing to move. Owner decision: all staff,
                no admin gate (matches Settle, not Cancel). */}
            {isOpenTab && !!order.tableNo && (
              <Button variant="outline" onClick={() => setMoveOpen(true)}>
                <Replace className="mr-2 h-4 w-4" /> Move table
              </Button>
            )}
          </div>
          {isOpenTab && (
            <Button className="w-full" onClick={() => setSettleOpen(true)}>
              <HandCoins className="mr-2 h-4 w-4" /> Settle &amp; Pay
            </Button>
          )}
        </SheetFooter>

        {/* Off-screen print sources — cloned by react-to-print. */}
        <div className="pointer-events-none absolute left-[-9999px] top-0" aria-hidden>
          <OrderReceipt order={order} settings={settings.data} ref={receiptRef} />
          <KOTReceipt
            order={order}
            settings={settings.data}
            variant={isCancelled ? "void" : "kot"}
            reason={isCancelled ? order?.cancelReason : undefined}
            ref={kotRef}
          />
        </div>
      </SheetContent>

      {order && (
        <PaymentModal
          open={settleOpen}
          onOpenChange={setSettleOpen}
          subtotal={order.subtotal}
          discount={order.discount}
          discountKind={order.discountKind}
          gstAmount={order.gstAmount ?? 0}
          gstRate={order.gstRate}
          charge={order.chargeAmount ?? 0}
          chargeLabel={order.chargeLabel}
          charges={chargesFromOrder(order)}
          total={order.total}
          itemCount={order.items.reduce((n, it) => n + it.qty, 0)}
          customer={
            order.customerId
              ? ({ _id: order.customerId, name: order.customerName } as Customer)
              : settleCustomer
          }
          tableNo={order.tableNo}
          receiver={order.receiver}
          isSubmitting={settleOrder.isPending}
          onConfirm={handleSettle}
          confirmLabel="Settle"
          onSelectCustomer={order.customerId ? undefined : setSettleCustomer}
        />
      )}

      {/* The moved order MUST go back to the parent. Without it this sheet keeps
          rendering its pre-move snapshot, and its own KOT button would then print
          a kitchen ticket naming the table the guests just LEFT — the opposite of
          what the move slip was for. `onSettled` is this sheet's generic "here is
          a fresher order, take it" channel (both call sites pass their setState
          straight in); the name is historical, it is not settle-specific. */}
      <MoveTableDialog
        order={order}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        onMoved={(moved) => onSettled?.(moved)}
      />
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
