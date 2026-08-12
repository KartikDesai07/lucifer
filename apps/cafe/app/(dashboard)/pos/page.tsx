"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useReactToPrint } from "react-to-print";
import { ChefHat } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useProducts } from "@/hooks/use-products";
import { useCategories } from "@/hooks/use-categories";
import { useTables } from "@/hooks/use-tables";
import { useOrders } from "@/hooks/use-orders";
import { usePosTab } from "@/hooks/use-pos-tab";
import { useItemVoid } from "@/hooks/use-item-void";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CategorySidebar,
  ALL_CATEGORIES,
} from "@/components/pos/CategorySidebar";
import { ProductGrid, GridSkeleton } from "@/components/pos/ProductGrid";
import { Cart } from "@/components/pos/Cart";
import { MobileCartBar } from "@/components/pos/MobileCartBar";
import { TableSelector } from "@/components/pos/TableSelector";
import { CustomerSearch } from "@/components/pos/CustomerSearch";
import { OpenTabsButton } from "@/components/pos/OpenTabsButton";
import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { PosPrompts } from "@/components/pos/PosPrompts";
import { RECEIPT_PAGE_STYLE } from "@/lib/print";
import type { Product } from "@/types";

// POS modals are interaction-gated — load their chunks lazily so they stay out
// of the initial POS bundle (CLAUDE.md §17). Client component, so ssr:false is OK.
const ModifierModal = dynamic(
  () => import("@/components/pos/ModifierModal").then((m) => m.ModifierModal),
  { ssr: false },
);
const PaymentModal = dynamic(
  () => import("@/components/pos/PaymentModal").then((m) => m.PaymentModal),
  { ssr: false },
);
const VoidItemDialog = dynamic(
  () => import("@/components/pos/VoidItemDialog").then((m) => m.VoidItemDialog),
  { ssr: false },
);

export default function PosPage() {
  const { user } = useAuth();
  const receiver = user?.name ?? "Staff";

  const products = useProducts();
  const categories = useCategories();
  const tables = useTables();
  // Open running orders, so staff can resume a tab to add a round or settle. Status
  // is part of the filter, not just payment: a cancelled tab keeps its historical
  // "Unpaid" mode, and a dead tab must never be offered up as resumable.
  const openTabs = useOrders({ payment: "Unpaid", status: "Pending" });
  const pos = usePosTab(receiver);
  // `kot: false` = re-sync the tab WITHOUT queueing a round KOT: the kitchen's slip
  // for a void is the void slip, and a round ticket here would tell them to make the
  // food again. The void slip is queued second and is the only print this raises.
  // `keepUnfired: true` = a void only ever touches already-fired lines, so any local
  // unsent cart lines are still owed and must survive this re-sync untouched.
  const itemVoid = useItemVoid(pos.resumedOrder?._id, (order, entry) => {
    pos.applyTabUpdate(order, { kot: false, keepUnfired: true });
    pos.queueVoidSlip(order, entry);
  });

  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [modifierOpen, setModifierOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Print only after the receipt/KOT DOM reflects the freshly-placed order.
  const {
    lastOrder,
    shouldPrintReceipt,
    clearPrintReceipt,
    shouldPrintKot,
    clearPrintKot,
  } = pos;

  const receiptRef = useRef<HTMLDivElement>(null);
  const print = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: pos.lastOrder?.orderId ?? "receipt",
    pageStyle: RECEIPT_PAGE_STYLE,
  });

  // kotPrinting keeps this effect from re-firing while a job is in flight, and the
  // receipt effect below waits for shouldPrintKot to clear. Both exist because
  // react-to-print reuses ONE iframe — see the print-chain note in lib/print.ts for
  // why two jobs in a single tick silently kill one of them (CR1.2).
  const kotPrinting = useRef(false);
  const kotRef = useRef<HTMLDivElement>(null);
  const printKot = useReactToPrint({
    contentRef: kotRef,
    documentTitle: pos.lastOrder ? `KOT-${pos.lastOrder.orderId}` : "kot",
    pageStyle: RECEIPT_PAGE_STYLE,
    onAfterPrint: () => {
      kotPrinting.current = false;
      clearPrintKot();
    },
  });

  // Kitchen ticket first, one print job at a time: the receipt effect below
  // waits for shouldPrintKot to clear before it fires.
  useEffect(() => {
    if (shouldPrintReceipt && lastOrder && !shouldPrintKot) {
      print();
      clearPrintReceipt();
    }
  }, [shouldPrintReceipt, lastOrder, shouldPrintKot, clearPrintReceipt, print]);

  useEffect(() => {
    if (shouldPrintKot && lastOrder && !kotPrinting.current) {
      kotPrinting.current = true;
      printKot();
    }
  }, [shouldPrintKot, lastOrder, printKot]);

  const handleProductClick = (product: Product) => {
    if (product.modifiers.length > 0) {
      setModifierProduct(product);
      setModifierOpen(true);
    } else {
      pos.addToCart(product);
    }
  };

  // Opens the SAME modal for a plain product too — it already hides its
  // add-ons block when the product carries none, so this is "free": the
  // operator still gets the instructions/qty fields.
  const handleProductOptions = (product: Product) => {
    setModifierProduct(product);
    setModifierOpen(true);
  };

  const cartProps = {
    items: pos.cart,
    subtotal: pos.subtotal,
    discount: pos.discount,
    gstAmount: pos.gstAmount,
    gstRate: pos.gstRate,
    discountRaw: pos.discountRaw,
    discountUnit: pos.discountUnit,
    onDiscountRawChange: pos.setDiscountRaw,
    onDiscountUnitChange: pos.setDiscountUnit,
    onUpdateQty: pos.updateQty,
    onRemove: pos.removeFromCart,
    onClear: pos.clearCart,
    notes: pos.notes,
    onNotesChange: pos.setNotes,
    onSendToKitchen: pos.sendToKitchen,
    onPayNow: pos.payNow,
    onSettle: pos.settle,
    onCloseTab: pos.requestCloseTab,
    onVoidItem: () => itemVoid.setOpen(true),
    resumedOrderId: pos.resumedOrder?.orderId,
    nextRound: (pos.resumedOrder?.kotRounds ?? 0) + 1,
    isBusy: pos.isBusy,
  };

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[30rem] flex-col gap-3 pb-16 md:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold tracking-tight">POS Terminal</h2>
        <div className="flex flex-wrap items-center gap-2">
          {pos.lastOrder && (
            <Button
              variant="outline"
              size="sm"
              onClick={pos.reprintKot}
              title={`Print kitchen ticket for ${pos.lastOrder.orderId}`}
            >
              <ChefHat className="mr-2 h-4 w-4" /> KOT
            </Button>
          )}
          <OpenTabsButton tabs={openTabs.data ?? []} onResume={pos.requestResume} />
          <TableSelector
            tables={tables.data}
            value={pos.table}
            onChange={pos.setTable}
            disabled={!!pos.resumedOrder}
          />
          <CustomerSearch value={pos.customer} onChange={pos.setCustomer} />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1fr_22rem]">
        <div className="flex min-h-0 gap-3">
          {categories.isLoading ? (
            <Skeleton className="h-full w-28 md:w-40" />
          ) : (
            <CategorySidebar
              categories={categories.data ?? []}
              selected={category}
              onSelect={setCategory}
            />
          )}
          {products.isLoading ? (
            <GridSkeleton />
          ) : products.isError ? (
            <p className="text-sm text-destructive">
              Failed to load products. Refresh to retry.
            </p>
          ) : (
            <ProductGrid
              products={products.data ?? []}
              selectedCategory={category}
              onProductClick={handleProductClick}
              onProductOptions={handleProductOptions}
            />
          )}
        </div>

        <div className="hidden min-h-0 md:block">
          <Cart {...cartProps} />
        </div>
      </div>

      {/* Phones: cart lives in a bottom sheet behind a sticky summary bar. */}
      <MobileCartBar
        open={mobileCartOpen}
        onOpenChange={setMobileCartOpen}
        cartProps={cartProps}
        count={pos.count}
        total={pos.total}
      />

      <ModifierModal
        product={modifierProduct}
        open={modifierOpen}
        onOpenChange={setModifierOpen}
        onConfirm={(p, opts) => pos.addToCart(p, opts)}
      />

      <PaymentModal
        open={pos.paymentOpen}
        onOpenChange={pos.setPaymentOpen}
        {...pos.modalTotals}
        customer={pos.customer}
        tableNo={pos.table}
        receiver={receiver}
        isSubmitting={pos.isBusy}
        onConfirm={pos.confirmPayment}
        // The settle route only ATTACHES a customer to a tab that has none — it
        // never reassigns one that already carries one. Hiding the picker there
        // (mirrors OrderDetailSheet) stops the modal from promising a swap the
        // server silently refuses (CR1.2 regression).
        onSelectCustomer={pos.resumedOrder?.customerId ? undefined : pos.setCustomer}
      />

      <PosPrompts
        closeConfirmOpen={pos.closeConfirmOpen}
        onCloseConfirmOpenChange={pos.setCloseConfirmOpen}
        onConfirmCloseTab={pos.confirmCloseTab}
        resumeConfirmOpen={!!pos.pendingResume}
        onCancelResume={pos.cancelResume}
        onConfirmResume={pos.confirmResume}
        freeTablePrompt={pos.freeTablePrompt}
        onDismissFreeTable={pos.dismissFreeTablePrompt}
        onConfirmFreeTable={pos.confirmFreeTable}
        freeingTable={pos.freeingTable}
      />

      <VoidItemDialog
        open={itemVoid.open}
        onOpenChange={itemVoid.setOpen}
        order={pos.resumedOrder}
        isPending={itemVoid.isPending}
        onConfirm={itemVoid.confirm}
      />

      {/* Off-screen print sources — cloned by react-to-print. */}
      <div
        className="pointer-events-none absolute left-[-9999px] top-0"
        aria-hidden
      >
        <OrderReceipt order={pos.lastOrder} settings={pos.settings.data} ref={receiptRef} />
        <KOTReceipt
          order={pos.lastOrder}
          settings={pos.settings.data}
          roundItems={pos.kotRoundItems ?? undefined}
          roundLabel={pos.kotRoundLabel}
          variant={pos.kotVariant}
          reason={pos.voidReason}
          voidedBy={pos.voidedBy}
          voidedAt={pos.voidedAt}
          ref={kotRef}
        />
      </div>
    </div>
  );
}
