"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useReactToPrint } from "react-to-print";
import { Ticket } from "lucide-react";
import { toast } from "sonner";

import { chargesFromOrder } from "@pos/shared/order-charges";
import type { SettlementPayMode } from "@/lib/constants";
import { inr, formatDate, cn } from "@/lib/utils";
import { slipPrintOptions } from "@/lib/desktop-shell";
import { printConfigOf, receiptPageStyle } from "@/lib/print";
import { billPrintJob, cancelNoticePrintJob, kotPrintJob } from "@/lib/print-routing";
import { useSettings } from "@/hooks/use-settings";
import { useSettleFlow } from "@/hooks/use-settle-flow";
import { useHostRouting } from "@/hooks/use-print-routing";
import { useTokenPrint } from "@/hooks/use-token-print";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useOpenerFocus } from "@/hooks/use-opener-focus";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { TokenSlip } from "@/components/print/slip/TokenSlip";
import { OrderDetailHead } from "@/components/orders/OrderDetailHead";
import { OrderDetailBody } from "@/components/orders/OrderDetailBody";
import { MoveTableDialog } from "@/components/orders/MoveTableDialog";
import type { PaymentResult } from "@/components/pos/PaymentModal";
import { collectedAmount } from "@/lib/payment-result";
import {
  ORDERS_XL_QUERY,
  ORDER_DANGER_CLASS,
  ORDER_DETAIL_COLUMN_CLASS,
  ORDER_DETAIL_SCROLL_CLASS,
  ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS,
  ORDER_DETAIL_SHEET_CLASS,
  ORDER_DETAIL_SHEET_SCRIM_CLASS,
  ORDER_DETAIL_SIDE_CLASS,
  ORDER_EDIT_ITEMS_CLASS,
  ORDER_QUICK_ACTION_CLASS,
  ORDER_QUICK_LABEL_CLASS,
  ORDER_SETTLE_CLASS,
  detailFootClass,
  frameInUse,
  orderDetailFrame,
  quickGridClass,
  type OrderDetailFrame,
  type OrderDetailPlace,
} from "@/lib/orders-layout";
import { detailFoot, quickActions, type QuickActionKey } from "@/lib/order-detail-view";
import { offerPosTable } from "@/lib/pos-table-handoff";
import { KITCHEN_NOTHING_TO_SEND_MESSAGE, kitchenOrderOf, orderSkipsKitchen } from "@/lib/kitchen-lines";
import { keepOpenForNestedDialog } from "@/lib/nested-dialog";
import type { Customer, Order, SettleOrderInput } from "@/types";

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

// The settle this sheet sends for `order` — the latched bill being paid.
function sheetSettlePayload(order: Order, result: PaymentResult, picked: Customer | undefined): SettleOrderInput {
  return {
    payment: result.payment as SettlementPayMode,
    splitCash: result.splitCash,
    splitOnline: result.splitOnline,
    // The order's own customer is authoritative once attached; only an
    // unattached order can pick one up here. No `discount` — this path
    // (unlike the POS settle) always charges the stored total unchanged.
    customerId: order.customerId ?? picked?._id,
    paidAmount: collectedAmount(result),
    // Only meaningful alongside a defined paidAmount above — lets the
    // route detect a stale `order` snapshot (CR1.2 regression).
    total: order.total,
    // The tab this sheet is showing — refused once it has moved
    // (lib/settle-guard.ts), so a bill is never closed unseen.
    expectedTotal: order.total,
    expectedVoids: order.voids?.length ?? 0,
  };
}

interface OrderDetailSheetProps {
  order: Order | null;
  onOpenChange: (open: boolean) => void;
  // Called with a fresher version of this order after ANY action taken inside the
  // sheet that changes it — a settle (keeping the sheet open on the now-Completed
  // order, Print available) or a table move — so the parent can refresh the
  // snapshot it is passing back in. Named for the settle that came first.
  onSettled?: (order: Order) => void;
  /** Where it opens (U2 Task 5; design 6.6, Q8): "page" = the /orders column from 1280px; "overlay" (the default, the
   *  dashboard) = a 400px side sheet from 1280px. Below 1280px both open full screen from the window's foot. */
  place?: OrderDetailPlace;
  /** The page's cancel (admins on /orders): the detail then offers "Cancel this order" (U2 Task 7, Ruling P6). The
   *  dashboard provides none, so it shows none. */
  onCancel?: (order: Order) => void;
  /** The page's cancel sheet is open over this detail: the frame stays, as for the payment and move sheets. */
  cancelOpen?: boolean;
  /** The page's minute tick for the meta clock, so the head's age reads as the list's (the Orders page's useNow); without
   *  it (the dashboard) the head keeps its own. */
  now?: Date;
  /** The page's list has not answered yet (a first or uncached load, a typed phone not searched yet): the column shows
   *  nothing rather than "Select an order to see its details." */
  listPending?: boolean;
}

export function OrderDetailSheet({
  order,
  onOpenChange,
  onSettled,
  place = "overlay",
  onCancel,
  cancelOpen = false,
  now,
  listPending = false,
}: OrderDetailSheetProps) {
  const forWidth = orderDetailFrame(place, useMediaQuery(ORDERS_XL_QUERY));
  const settings = useSettings();
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
  // One frame for the width (design 6.6): the column, the side sheet or the bottom sheet — none until the width is
  // known — so the print sources, the settle latch and the payment preload exist once at any width. While the payment
  // (with the customer sheet it opens), the move sheet or the page's cancel sheet is up, the frame it opened from stays
  // (frameInUse): a frame mounted under it would take Radix's top layer and trap focus, take Escape and close the detail
  // under the payment. Only over an order: a detail with none holds no sheet.
  const [heldFrame, setHeldFrame] = useState(forWidth);
  const frame = frameInUse(heldFrame, forWidth, !!order && (settleOpen || moveOpen || cancelOpen));
  if (frame !== heldFrame) setHeldFrame(frame);
  // Ruling P38: the payment and move dialogs render beside the sheet (outside its panel), so a press that closes one of
  // them must not close the sheet too; the panel tells such a press from a tap outside every dialog.
  const sheetRef = useRef<HTMLDivElement>(null);
  // The tab as it was when "Settle & Pay" opened: the popup shows, and the
  // settle echoes, THIS bill even if a live refresh moves `order` meanwhile —
  // never a total the operator did not collect. Cleared when the popup closes.
  const [payingOrder, setPayingOrder] = useState<Order | null>(null);
  const paying = payingOrder ?? order;
  // A detail whose order went away holds no payment or move (unreachable today; a stuck latch would pop the payment
  // open over the next order and be hard to diagnose) — reset during render, as the frame is stored.
  if (!order && (settleOpen || moveOpen || payingOrder)) {
    setSettleOpen(false);
    setMoveOpen(false);
    setPayingOrder(null);
  }
  // One confirmed settle (hooks/use-settle-flow.ts); outcomes show in the popup.
  // No bill prints here on a settle (owner O3) — Print stays in the footer.
  const settleFlow = useSettleFlow({
    onSettled: (u) => {
      setSettleOpen(false);
      setPayingOrder(null);
      onSettled?.(u);
    },
    // The bill changed on another device: re-latch the fresh tab (or the next
    // Settle would resend the old expectedTotal and 409 forever), show it.
    onChanged: (o) => {
      setPayingOrder(o);
      onSettled?.(o);
    },
    onFinished: (o) => {
      setSettleOpen(false);
      setPayingOrder(null);
      if (o) onSettled?.(o);
      else onOpenChange(false);
    },
  });
  const openSettle = () => {
    setPayingOrder(order);
    setSettleOpen(true);
  };
  // Every close of the popup: never mid-request; a finished notice ends here.
  const settleOpenChange = (next: boolean) => {
    if (next) return setSettleOpen(true);
    if (!settleFlow.dismiss(paying?._id)) return;
    setSettleOpen(false);
    setPayingOrder(null);
  };
  // Only relevant for a Due/Credit (or partial) settle on an order that has no
  // customer yet — reset whenever the sheet switches to viewing a new order.
  const [settleCustomer, setSettleCustomer] = useState<Customer | undefined>();
  useEffect(() => setSettleCustomer(undefined), [order?._id]);
  // F10: load the payment popup's chunk as the sheet mounts, so Settle & Pay
  // opens at once. The literal specifier is what webpack splits on — the same
  // chunk the dynamic() loader above uses; a failed preload is simply retried
  // by that loader when the popup opens.
  useEffect(() => {
    void import("@/components/pos/PaymentModal").catch(() => undefined);
  }, []);

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

  const { tokenRef, printToken } = useTokenPrint({ order, routePrint, localPrintOf, billPaperWidth: printCfg.bill.paperWidth });
  const hasToken = order?.tokenNumber !== undefined && !isCancelled;
  // The actions' words and the foot (lib/order-detail-view.ts; design 6.9): the live order's, none while a sheet closes.
  const quick = order ? quickActions(order) : [];
  const quickLabel = (key: QuickActionKey): string => quick.find((a) => a.key === key)?.label ?? "";
  const foot = order ? detailFoot(order) : null;
  const editTable = foot?.editTable ?? null;

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
    // Skip-KOT: every fired line skips the kitchen, so there is no ticket (or stop notice) to send.
    if (orderSkipsKitchen(order)) {
      toast.info(KITCHEN_NOTHING_TO_SEND_MESSAGE);
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

  const handleSettle = (result: PaymentResult) => {
    if (!paying) return;
    void settleFlow.submit(paying, sheetSettlePayload(paying, result, settleCustomer));
  };

  return (
    <>
      <DetailFrame frame={frame} open={!!order} waiting={listPending} onOpenChange={onOpenChange} sheetRef={sheetRef}>
        {/* Through a sheet's close the last order stays drawn; the buttons and the print sources follow the live one. */}
        <KeepWhileClosing show={!!order}>
          {order && <OrderDetailHead order={order} now={now} onClose={frame === "column" ? undefined : () => onOpenChange(false)} />}
        </KeepWhileClosing>

        {/* Under the head the body scrolls (values 11.1, 11.4): the customer row, the items box with the sums and the
            void trail, the cancel note (OrderDetailBody, U2 Task 6), then the quick actions and "Cancel this order"
            (U2 Task 7, values 11.7-11.8). The actions follow the live order: through a sheet's close there are none, so
            a tap never prints a closed order. */}
        <div data-ui="order-detail-scroll" className={cn(ORDER_DETAIL_SCROLL_CLASS, foot && ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS)}>
          <KeepWhileClosing show={!!order}>
            {order && <OrderDetailBody order={order} />}
          </KeepWhileClosing>

          {/* Today's buttons under the HTML's words (design 6.9; quickActions): Print bill / Reprint bill (always a
              duplicate), Reprint KOT / Notify kitchen, Share bill, Reprint token, Move / Assign table (all staff, no
              admin gate: matches Settle, not Cancel). A print button is off while a print is being queued (PH-8). */}
          {order && (
            <div data-ui="order-detail-quick" className={quickGridClass(quick.length)}>
              <QuickAction onClick={printBill} disabled={enqueuePending} label={quickLabel("bill")} icon={<Glyph path={QUICK_PATHS.bill} />} />
              <QuickAction onClick={printKitchenSlip} disabled={enqueuePending} label={quickLabel("kot")} icon={<Glyph path={QUICK_PATHS.kot} />} />
              <a
                href={whatsAppLink(order, restaurantName, receiptFooter)}
                target="_blank"
                rel="noopener noreferrer"
                data-ui="order-detail-quick-action"
                className={cn(ORDER_QUICK_ACTION_CLASS, BRAND_PRESS_CLASS)}
              >
                <Glyph path={QUICK_PATHS.share} />
                <span data-ui="order-detail-quick-label" className={ORDER_QUICK_LABEL_CLASS}>{quickLabel("share")}</span>
              </a>
              {hasToken && (
                <QuickAction onClick={printToken} disabled={enqueuePending} label={quickLabel("token")} icon={<Ticket size={18} strokeWidth={1.8} aria-hidden className="flex-none" />} />
              )}
              {isOpenTab && (
                <QuickAction onClick={() => setMoveOpen(true)} label={quickLabel("move")} icon={<Glyph path={QUICK_PATHS.move} />} />
              )}
            </div>
          )}

          {/* Ruling P6: the page's cancel (admins on /orders; the dashboard gives none), on an order not cancelled. */}
          {order && onCancel && !isCancelled && (
            <button type="button" data-ui="order-detail-danger" onClick={() => onCancel(order)} className={cn(ORDER_DANGER_CLASS, BRAND_PRESS_CLASS)}>
              <Glyph path={QUICK_PATHS.ban} size={15} stroke={1.9} />
              Cancel this order
            </button>
          )}
        </div>

        {/* The foot at the window's foot (values 11.9; design 6.9, Q7), an open tab only: Edit items for a tab at a
            table — a plain /pos link (its warm prefetch reused, no ?table=) whose plain click hands the table to New
            Order (the Floor's hand-off, no request) — then Settle & pay (today's Settle & Pay: the same latch). */}
        {foot && (
          <div data-ui="order-detail-foot" className={detailFootClass(editTable !== null)}>
            {editTable !== null && (
              <Link
                href="/pos"
                prefetch={false}
                data-ui="order-detail-edit"
                onClick={(e) => {
                  if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) offerPosTable(editTable, Date.now());
                }}
                className={cn(ORDER_EDIT_ITEMS_CLASS, BRAND_PRESS_CLASS)}
              >
                <Glyph path={QUICK_PATHS.pencil} size={16} stroke={1.9} />
                Edit items
              </Link>
            )}
            <button type="button" data-ui="order-detail-settle" onClick={openSettle} className={cn(ORDER_SETTLE_CLASS, BRAND_PRESS_CLASS)}>
              {foot.settleLabel}
            </button>
          </div>
        )}

        {/* Off-screen print sources — cloned by react-to-print. */}
        <div className="pointer-events-none absolute left-[-9999px] top-0" aria-hidden>
          <OrderReceipt order={order} settings={settings.data} ref={receiptRef} />
          <KOTReceipt
            order={order ? kitchenOrderOf(order) : order}
            settings={settings.data}
            variant={isCancelled ? "void" : "kot"}
            reason={isCancelled ? order?.cancelReason : undefined}
            ref={kotRef}
          />
          {hasToken && <TokenSlip order={order} settings={settings.data} ref={tokenRef} />}
        </div>
      </DetailFrame>

      {order && paying && (
        <PaymentModal
          open={settleOpen}
          onOpenChange={settleOpenChange}
          subtotal={paying.subtotal}
          discount={paying.discount}
          discountKind={paying.discountKind}
          gstAmount={paying.gstAmount ?? 0}
          gstRate={paying.gstRate}
          charge={paying.chargeAmount ?? 0}
          chargeLabel={paying.chargeLabel}
          charges={chargesFromOrder(paying)}
          total={paying.total}
          itemCount={paying.items.reduce((n, it) => n + it.qty, 0)}
          customer={
            paying.customerId
              ? ({ _id: paying.customerId, name: paying.customerName } as Customer)
              : settleCustomer
          }
          tableNo={paying.tableNo}
          receiver={paying.receiver}
          isSubmitting={settleFlow.busy}
          onConfirm={handleSettle}
          confirmLabel="Settle"
          onSelectCustomer={paying.customerId ? undefined : setSettleCustomer}
          notice={settleFlow.noticeFor(order._id)}
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
    </>
  );
}

interface DetailFrameProps {
  frame: OrderDetailFrame | null;
  /** An order is shown (the sheets open with it). */
  open: boolean;
  /** The page's list has not answered yet: the column shows nothing. */
  waiting: boolean;
  onOpenChange: (open: boolean) => void;
  sheetRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

// The detail's three frames (U2 Task 5; design 6.6; values 11.1, 12, 13), one per width. The column (/orders from
// 1280px) is a plain flex column filling the page's 400px column, no dialog and no ✕; with nothing chosen it shows the
// HTML's words once the list has answered (nothing before). The side sheet (the dashboard from 1280px) is the kit sheet
// over its scrim. The bottom sheet (both pages below 1280px) is the /pos cart sheet's: a Radix dialog over the whole
// window, its overlay mounted and never drawn. Escape and the head's ✕ close both sheets; ruling P38: a press that
// closes a nested dialog (the payment, the move: rendered beside the frame) never closes the sheet beneath. Both sheets
// open from state, with no Radix trigger: the shared opener hook (U1 ruling P22; V-C F4) gives the focus back to what
// opened them (a row's title or Settle, a dashboard tile) as they close, the panel taking it as they open.
function DetailFrame({ frame, open, waiting, onOpenChange, sheetRef, children }: DetailFrameProps) {
  const openerFocus = useOpenerFocus();
  if (frame === null) return null;
  if (frame === "column") {
    return (
      <div data-ui="order-detail" className={ORDER_DETAIL_COLUMN_CLASS}>
        {open ? (
          children
        ) : waiting ? null : (
          <p data-ui="order-detail-none" className="m-auto p-6 text-center text-[14px] text-muted-foreground">
            Select an order to see its details.
          </p>
        )}
      </div>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {frame === "side" ? (
        <SheetContent
          ref={sheetRef}
          {...openerFocus}
          data-ui="order-detail"
          aria-describedby={undefined}
          className={ORDER_DETAIL_SIDE_CLASS}
          onInteractOutside={(e) => keepOpenForNestedDialog(e, sheetRef.current)}
        >
          {children}
        </SheetContent>
      ) : (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className={ORDER_DETAIL_SHEET_SCRIM_CLASS} />
          <DialogPrimitive.Content
            ref={sheetRef}
            {...openerFocus}
            data-ui="order-detail"
            aria-describedby={undefined}
            className={ORDER_DETAIL_SHEET_CLASS}
            onInteractOutside={(e) => keepOpenForNestedDialog(e, sheetRef.current)}
          >
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </Sheet>
  );
}

// Radix keeps a closing sheet's panel mounted while it slides away, but by then `order` is null: this keeps the last
// shown head and body on screen through that close (set after each commit with an order, so a render that is thrown
// away never changes it). Only the display: the buttons, their guards and the print sources always follow the live
// `order`, so a tap during the slide still refuses a closed order (PRINT_ORDER_CHANGED_MESSAGE).
function KeepWhileClosing({ show, children }: { show: boolean; children: ReactNode }) {
  const last = useRef<ReactNode>(null);
  useLayoutEffect(() => {
    if (show) last.current = children;
  });
  return show ? children : last.current;
}

/** The HTML's action glyphs (values 11.7 `IP`, 11.8, 11.9), 24x24 outline paths: the printer, the cloche, the speech
 *  bubble, the two arrows, the ban sign and the pencil (the token's is our ticket glyph, lucide's Ticket). */
const QUICK_PATHS = {
  bill: "M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z",
  kot: "M6 13a6 6 0 1 1 12 0v2H6zM5 19h14M12 7V4",
  share: "M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12z",
  move: "M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h20",
  ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8",
  pencil: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
} as const;

/** One glyph: round caps and joins, never shrinking; a quick action's 18px at stroke 1.8 unless told otherwise. */
function Glyph({ path, size = 18, stroke = 1.8 }: { path: string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-none">
      <path d={path} />
    </svg>
  );
}

interface QuickActionProps {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  icon: ReactNode;
}

/** A quick action (values 11.7): the HTML's 62px cell, its icon over its label, with the HTML's press. */
function QuickAction({ onClick, disabled, label, icon }: QuickActionProps) {
  return (
    <button
      type="button"
      data-ui="order-detail-quick-action"
      onClick={onClick}
      disabled={disabled}
      className={cn(ORDER_QUICK_ACTION_CLASS, BRAND_PRESS_CLASS)}
    >
      {icon}
      <span data-ui="order-detail-quick-label" className={ORDER_QUICK_LABEL_CLASS}>{label}</span>
    </button>
  );
}
