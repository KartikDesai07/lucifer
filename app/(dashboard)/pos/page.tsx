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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CategorySidebar,
  ALL_CATEGORIES,
} from "@/components/pos/CategorySidebar";
import { ProductGrid } from "@/components/pos/ProductGrid";
import { Cart } from "@/components/pos/Cart";
import { MobileCartBar } from "@/components/pos/MobileCartBar";
import { TableSelector } from "@/components/pos/TableSelector";
import { CustomerSearch } from "@/components/pos/CustomerSearch";
import { OpenTabsButton } from "@/components/pos/OpenTabsButton";
import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
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

export default function PosPage() {
  const { user } = useAuth();
  const receiver = user?.name ?? "Staff";

  const products = useProducts();
  const categories = useCategories();
  const tables = useTables();
  // Open (Unpaid) running orders, so staff can resume a tab to add a round or settle.
  const openTabs = useOrders({ payment: "Unpaid" });
  const pos = usePosTab(receiver);

  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [modifierOpen, setModifierOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  const receiptRef = useRef<HTMLDivElement>(null);
  const print = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: pos.lastOrder?.orderId ?? "receipt",
    pageStyle: RECEIPT_PAGE_STYLE,
  });

  const kotRef = useRef<HTMLDivElement>(null);
  const printKot = useReactToPrint({
    contentRef: kotRef,
    documentTitle: pos.lastOrder ? `KOT-${pos.lastOrder.orderId}` : "kot",
    pageStyle: RECEIPT_PAGE_STYLE,
  });

  // Print only after the receipt/KOT DOM reflects the freshly-placed order.
  const {
    lastOrder,
    shouldPrintReceipt,
    clearPrintReceipt,
    shouldPrintKot,
    clearPrintKot,
  } = pos;
  useEffect(() => {
    if (shouldPrintReceipt && lastOrder) {
      print();
      clearPrintReceipt();
    }
  }, [shouldPrintReceipt, lastOrder, clearPrintReceipt, print]);

  useEffect(() => {
    if (shouldPrintKot && lastOrder) {
      printKot();
      clearPrintKot();
    }
  }, [shouldPrintKot, lastOrder, clearPrintKot, printKot]);

  const handleProductClick = (product: Product) => {
    if (product.modifiers.length > 0) {
      setModifierProduct(product);
      setModifierOpen(true);
    } else {
      pos.addToCart(product);
    }
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
    onSendToKitchen: pos.sendToKitchen,
    onPayNow: pos.payNow,
    onSettle: pos.settle,
    onCloseTab: pos.requestCloseTab,
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
      />

      <ConfirmDialog
        open={pos.closeConfirmOpen}
        onOpenChange={pos.setCloseConfirmOpen}
        title="Discard unsent items?"
        description="This tab has items not yet sent to the kitchen. Closing here discards them; the open tab itself stays open."
        confirmLabel="Discard & close"
        onConfirm={pos.confirmCloseTab}
      />

      <ConfirmDialog
        open={!!pos.pendingResume}
        onOpenChange={(o) => !o && pos.cancelResume()}
        title="Discard unsent items?"
        description="You have items not yet sent to the kitchen. Resuming another tab will discard them."
        confirmLabel="Discard & resume"
        onConfirm={pos.confirmResume}
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
          ref={kotRef}
        />
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="aspect-[3/4] w-full" />
      ))}
    </div>
  );
}
