"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

import { useAuth } from "@/hooks/use-auth";
import { useProducts } from "@/hooks/use-products";
import { useCategories } from "@/hooks/use-categories";
import { useTables } from "@/hooks/use-tables";
import { useOrders } from "@/hooks/use-orders";
import { usePosTab } from "@/hooks/use-pos-tab";
import { useItemVoid } from "@/hooks/use-item-void";
import { useKotPrintBridge } from "@/hooks/use-kot-print-bridge";
import { useSelfOrderAutoPrint } from "@/hooks/use-self-order-auto-print";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CategorySidebar,
  ALL_CATEGORIES,
} from "@/components/pos/CategorySidebar";
import { ProductGrid, GridSkeleton } from "@/components/pos/ProductGrid";
import { Cart } from "@/components/pos/Cart";
import { MobileCartBar } from "@/components/pos/MobileCartBar";
import { PosHeader } from "@/components/pos/PosHeader";
import { PrintSources } from "@/components/pos/PrintSources";
import { PosPrompts } from "@/components/pos/PosPrompts";
import { printConfigOf } from "@/lib/print";
import { buildCartProps } from "@/lib/pos-cart-props";
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
const MoveTableDialog = dynamic(
  () => import("@/components/orders/MoveTableDialog").then((m) => m.MoveTableDialog),
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
  const [moveTableOpen, setMoveTableOpen] = useState(false);

  // Print only after the receipt/KOT DOM reflects the freshly-placed order.
  const {
    lastOrder,
    shouldPrintReceipt,
    clearPrintReceipt,
    shouldPrintKot,
    clearPrintKot,
  } = pos;

  // The two print jobs can legitimately use different paper widths (a cafe
  // may run a wider bill roll than its kitchen printer), so each job's page
  // setup is derived from its OWN resolved config rather than one shared
  // constant.
  const printCfg = printConfigOf(pos.settings.data);

  // Both useReactToPrint jobs, the guard ref, and the chaining effects live in
  // this shared hook now — see its own file for why (CR1.2's fixed-id-iframe
  // note carries over unchanged).
  const { receiptRef, kotRef, printBusy } = useKotPrintBridge({
    lastOrder,
    shouldPrintKot,
    clearPrintKot,
    kotPaperWidth: printCfg.kot.paperWidth,
    receipt: {
      shouldPrintReceipt,
      clearPrintReceipt,
      billPaperWidth: printCfg.bill.paperWidth,
    },
  });

  // CR2.3 §20 — registers this page's KOT print bridge with PosPulseProvider
  // and auto-prints an opted-in device's self-orders; busy on ANY print job
  // queued or physically in flight (printBusy — the bridge tracks the receipt
  // through onAfterPrint, review C3: an auto KOT landing mid-receipt would
  // swap lastOrder under the customer's receipt) or an in-flight order write.
  useSelfOrderAutoPrint({
    enabled: true,
    busy: printBusy || pos.isBusy,
    queueKotRound: pos.queueKotRound,
  });

  const handleProductClick = (product: Product) => {
    // A variation item must never add straight to the cart — there is no
    // meaningful default size, so the modal's required chooser is the only
    // way to pick the price that gets billed.
    if (product.modifiers.length > 0 || (product.variations?.length ?? 0) > 0) {
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

  const cartProps = buildCartProps(pos, () => itemVoid.setOpen(true));

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[30rem] flex-col gap-3 pb-16 md:pb-0">
      <PosHeader
        lastOrder={pos.lastOrder}
        onReprintKot={pos.reprintKot}
        openTabs={openTabs.data ?? []}
        onResumeTab={pos.requestResume}
        resumedOrder={pos.resumedOrder}
        isBusy={pos.isBusy}
        onMoveTable={() => setMoveTableOpen(true)}
        tables={tables.data}
        table={pos.table}
        onTableChange={pos.setTable}
        customer={pos.customer}
        onCustomerChange={pos.setCustomer}
      />

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1fr_22rem]">
        <div className="flex min-h-0 gap-3">
          {categories.isLoading ? (
            <Skeleton className="h-full w-28 shrink-0 md:w-44" />
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

      <MoveTableDialog
        order={pos.resumedOrder}
        open={moveTableOpen}
        onOpenChange={setMoveTableOpen}
        // `kot:false` — the move's own slip IS the kitchen's paper; a round
        // ticket here would tell them to cook again. `keepUnfired:true` —
        // unsent cart lines are still owed and must survive the re-sync. No
        // `chargeSent` — the move never carries a charge, so a waiver the
        // operator already promised must not be cleared by this re-sync.
        onMoved={(order) =>
          pos.applyTabUpdate(order, { kot: false, keepUnfired: true })
        }
      />

      <PrintSources
        order={pos.lastOrder}
        settings={pos.settings.data}
        kotRef={kotRef}
        kotRoundItems={pos.kotRoundItems}
        kotRoundLabel={pos.kotRoundLabel}
        kotRoundNumber={pos.kotRoundNumber}
        kotVariant={pos.kotVariant}
        voidReason={pos.voidReason}
        voidedBy={pos.voidedBy}
        voidedAt={pos.voidedAt}
        receiptRef={receiptRef}
      />
    </div>
  );
}
