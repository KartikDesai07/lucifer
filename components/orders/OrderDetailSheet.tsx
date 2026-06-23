"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useReactToPrint } from "react-to-print";
import { Printer, ChefHat, MessageCircle, HandCoins } from "lucide-react";

import { PAY_STYLES, type SettlementPayMode } from "@/lib/constants";
import { inr, formatDate, cn } from "@/lib/utils";
import { RECEIPT_PAGE_STYLE } from "@/lib/print";
import { useSettings } from "@/hooks/use-settings";
import { useSettleOrder } from "@/hooks/use-orders";
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
import type { PaymentResult } from "@/components/pos/PaymentModal";
import type { Customer, Order } from "@/types";

const PaymentModal = dynamic(
  () => import("@/components/pos/PaymentModal").then((m) => m.PaymentModal),
  { ssr: false },
);

// wa.me share link (no recipient — opens WhatsApp's contact picker), per
// CLAUDE.md §12 nice-to-have. Order has no customer mobile, so we don't prefill.
function whatsAppLink(order: Order, restaurantName: string): string {
  const text = [
    `*${restaurantName} - Receipt*`,
    `Order: ${order.orderId}`,
    `Date: ${formatDate(order.createdAt)}`,
    `Total: ${inr(order.total)}`,
    `Payment: ${order.payment}`,
    "",
    "Thank you! Visit again 🙏",
  ].join("\n");
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

interface OrderDetailSheetProps {
  order: Order | null;
  onOpenChange: (open: boolean) => void;
  // Called with the freshly-settled order so the parent can refresh its snapshot
  // (keeping the sheet open showing the now-Completed order, Print available).
  onSettled?: (order: Order) => void;
}

export function OrderDetailSheet({
  order,
  onOpenChange,
  onSettled,
}: OrderDetailSheetProps) {
  const settings = useSettings();
  const settleOrder = useSettleOrder();
  const [settleOpen, setSettleOpen] = useState(false);

  const receiptRef = useRef<HTMLDivElement>(null);
  const print = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: order?.orderId ?? "receipt",
    pageStyle: RECEIPT_PAGE_STYLE,
  });

  const kotRef = useRef<HTMLDivElement>(null);
  const printKot = useReactToPrint({
    contentRef: kotRef,
    documentTitle: order ? `KOT-${order.orderId}` : "kot",
    pageStyle: RECEIPT_PAGE_STYLE,
  });

  const due = order ? order.total - order.paidAmount : 0;
  const payStyle = order ? PAY_STYLES[order.payment] : undefined;
  const restaurantName = settings.data?.restaurantName?.trim() || "Lucifer Cafe";
  const isOpenTab = order?.status === "Pending";

  const handleSettle = async (result: PaymentResult) => {
    if (!order) return;
    try {
      const updated = await settleOrder.mutateAsync({
        id: order._id,
        data: {
          payment: result.payment as SettlementPayMode,
          splitCash: result.splitCash,
          splitOnline: result.splitOnline,
          customerId: order.customerId,
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
                )}
              >
                {order.status}
              </Badge>
              <Badge variant="outline" className={cn(payStyle?.color)}>
                {payStyle?.label ?? order.payment}
              </Badge>
              <Badge variant="outline">{order.tableNo ?? "Walk-In"}</Badge>
            </div>

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
                      {item.name}
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
                  </div>
                  <span>{inr(item.price * item.qty)}</span>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-1">
              <Row label="Subtotal" value={inr(order.subtotal)} />
              {order.discount > 0 && (
                <Row label="Discount" value={`−${inr(order.discount)}`} />
              )}
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
          </div>
        )}

        <SheetFooter className="gap-2 px-4">
          <div className="grid grid-cols-3 gap-2">
            <Button variant="outline" onClick={() => print()}>
              <Printer className="mr-2 h-4 w-4" /> Print
            </Button>
            <Button variant="outline" onClick={() => printKot()}>
              <ChefHat className="mr-2 h-4 w-4" /> KOT
            </Button>
            <Button variant="outline" asChild>
              <a
                href={order ? whatsAppLink(order, restaurantName) : "#"}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="mr-2 h-4 w-4" /> Share
              </a>
            </Button>
          </div>
          {isOpenTab && (
            <Button onClick={() => setSettleOpen(true)}>
              <HandCoins className="mr-2 h-4 w-4" /> Settle &amp; Pay
            </Button>
          )}
        </SheetFooter>

        {/* Off-screen print sources — cloned by react-to-print. */}
        <div className="pointer-events-none absolute left-[-9999px] top-0" aria-hidden>
          <OrderReceipt order={order} settings={settings.data} ref={receiptRef} />
          <KOTReceipt order={order} settings={settings.data} ref={kotRef} />
        </div>
      </SheetContent>

      {order && (
        <PaymentModal
          open={settleOpen}
          onOpenChange={setSettleOpen}
          subtotal={order.subtotal}
          discount={order.discount}
          gstAmount={order.gstAmount ?? 0}
          gstRate={order.gstRate}
          total={order.total}
          itemCount={order.items.reduce((n, it) => n + it.qty, 0)}
          customer={
            order.customerId
              ? ({ _id: order.customerId, name: order.customerName } as Customer)
              : undefined
          }
          tableNo={order.tableNo}
          receiver={order.receiver}
          isSubmitting={settleOrder.isPending}
          onConfirm={handleSettle}
          confirmLabel="Settle"
        />
      )}
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
