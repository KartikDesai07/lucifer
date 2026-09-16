"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useProducts } from "@/hooks/use-products";
import { useCategories } from "@/hooks/use-categories";
import { useTables } from "@/hooks/use-tables";
import { useOrders } from "@/hooks/use-orders";
import { usePosTab } from "@/hooks/use-pos-tab";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useItemVoid } from "@/hooks/use-item-void";
import { useKotPrintBridge } from "@/hooks/use-kot-print-bridge";
import { useStableCallback } from "@/hooks/use-stable-callback";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CategorySidebar,
  CategoryChips,
  ALL_CATEGORIES,
} from "@/components/pos/CategorySidebar";
import { ProductGrid, GridSkeleton } from "@/components/pos/ProductGrid";
import { Cart } from "@/components/pos/Cart";
import { MobileCartBar } from "@/components/pos/MobileCartBar";
import { PosHeader } from "@/components/pos/PosHeader";
import { PrintSources } from "@/components/pos/PrintSources";
import { PosModals } from "@/components/pos/PosModals";
import { SelfOrderAutoPrint } from "@/components/pos/SelfOrderAutoPrint";
import { printConfigOf } from "@/lib/print";
import { cn } from "@/lib/utils";
import { buildCartProps } from "@/lib/pos-cart-props";
import {
  POS_ROOT_CLASS,
  POS_INSET_CLASS,
  POS_SPLIT_CLASS,
  POS_PANE_CLASS,
  POS_DESKTOP_CART_CLASS,
} from "@/lib/pos-layout";
import type { Order, Product } from "@/types";

// PosHeader is memoized (CB-1d.3c): a still-loading openTabs must not hand it a
// fresh [] every render, or its three dialog-bearing children re-render per tap.
const NO_OPEN_TABS: Order[] = [];

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
  // Owner decision O4 (2026-09-04): screen stays awake for as long as the New
  // Order screen is mounted; no per-device toggle.
  useWakeLock(true);
  // Warn before a tab/window close discards a live order (pos.dirty; CB-1d.4).
  useUnsavedGuard(pos.dirty);
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

  // Summed qty per product across the cart — the grid tile's "already in
  // cart" badge (mobile/tablet feedback loop: add, glance, keep adding).
  const qtyByProduct = useMemo(() => {
    const m: Record<string, number> = {};
    for (const line of pos.cart) m[line.productId] = (m[line.productId] ?? 0) + line.qty;
    return m;
  }, [pos.cart]);

  // An open sheet over an empty cart is a dead end — the fixed bar cannot
  // re-open it while empty, so close it the moment the cart drains (Pay Now,
  // Clear, or closing the resumed tab all funnel through pos.cart).
  useEffect(() => {
    if (pos.cart.length === 0) setMobileCartOpen(false);
  }, [pos.cart.length]);

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

  const { addToCart } = pos;
  const handleProductClick = useCallback((product: Product) => {
    // A variation item must never add straight to the cart — there is no
    // meaningful default size, so the modal's required chooser is the only
    // way to pick the price that gets billed.
    if (product.modifiers.length > 0 || (product.variations?.length ?? 0) > 0) {
      setModifierProduct(product);
      setModifierOpen(true);
    } else {
      addToCart(product);
    }
  }, [addToCart]);

  // Opens the SAME modal for a plain product too — it already hides its
  // add-ons block when the product carries none, so this is "free": the
  // operator still gets the instructions/qty fields.
  const handleProductOptions = useCallback((product: Product) => {
    setModifierProduct(product);
    setModifierOpen(true);
  }, []);

  // PosHeader is memoized: these two usePosTab closures are re-minted every render
  // (they read the live cart), so latch them; the move-table opener only wraps a
  // setState and needs plain useCallback.
  const onResumeTab = useStableCallback(pos.requestResume);
  const onTableChange = useStableCallback(pos.setTable);
  const handleMoveTable = useCallback(() => setMoveTableOpen(true), []);

  const cartProps = buildCartProps(pos, () => itemVoid.setOpen(true));

  return (
    <div className={POS_ROOT_CLASS}>
      {/* The root is full-bleed below xl (its bottom edge is the screen edge, for
          the sticky bar); the header and the split re-inset themselves. */}
      <div className={POS_INSET_CLASS}>
        <PosHeader
          lastOrder={pos.lastOrder}
          onReprintKot={pos.reprintKot}
          openTabs={openTabs.data ?? NO_OPEN_TABS}
          onResumeTab={onResumeTab}
          resumedOrder={pos.resumedOrder}
          isBusy={pos.isBusy}
          onMoveTable={handleMoveTable}
          tables={tables.data}
          table={pos.table}
          onTableChange={onTableChange}
          customer={pos.customer}
          onCustomerChange={pos.setCustomer}
        />
      </div>

      <div className={cn(POS_SPLIT_CLASS, POS_INSET_CLASS)}>
        <div className={POS_PANE_CLASS}>
          {categories.isLoading ? (
            <>
              <Skeleton className="hidden h-full w-44 shrink-0 xl:block" />
              <Skeleton className="h-10 w-full xl:hidden" />
            </>
          ) : (
            <>
              <CategoryChips
                categories={categories.data ?? []}
                selected={category}
                onSelect={setCategory}
              />
              <CategorySidebar
                categories={categories.data ?? []}
                selected={category}
                onSelect={setCategory}
              />
            </>
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
              qtyByProduct={qtyByProduct}
            />
          )}
        </div>

        <div className={POS_DESKTOP_CART_CLASS}>
          <Cart {...cartProps} />
        </div>
      </div>

      {/* Below xl: cart lives in a bottom sheet behind a fixed summary bar. */}
      <MobileCartBar
        open={mobileCartOpen}
        onOpenChange={setMobileCartOpen}
        cartProps={cartProps}
        count={pos.count}
        total={pos.total}
      />

      {/* The five modal roots live in one child whose per-root memo boundaries let
          a closed modal skip PosPage's re-renders (CB-1d.3c / C3); every piece of
          modal state stays here. */}
      <PosModals
        modifierProduct={modifierProduct}
        modifierOpen={modifierOpen}
        onModifierOpenChange={setModifierOpen}
        onModifierConfirm={(p, opts) => pos.addToCart(p, opts)}
        paymentOpen={pos.paymentOpen}
        onPaymentOpenChange={pos.setPaymentOpen}
        totals={pos.modalTotals}
        customer={pos.customer}
        tableNo={pos.table}
        receiver={receiver}
        isSubmitting={pos.isBusy}
        onPaymentConfirm={pos.confirmPayment}
        // The settle route only ATTACHES a customer to a tab that has none — it
        // never reassigns one that already carries one. Hiding the picker there
        // (mirrors OrderDetailSheet) stops the modal from promising a swap the
        // server silently refuses (CR1.2 regression).
        onSelectCustomer={pos.resumedOrder?.customerId ? undefined : pos.setCustomer}
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
        voidOpen={itemVoid.open}
        onVoidOpenChange={itemVoid.setOpen}
        voidPending={itemVoid.isPending}
        onVoidConfirm={itemVoid.confirm}
        moveTableOpen={moveTableOpen}
        onMoveTableOpenChange={setMoveTableOpen}
        // `kot:false` — the move's own slip IS the kitchen's paper; a round
        // ticket here would tell them to cook again. `keepUnfired:true` —
        // unsent cart lines are still owed and must survive the re-sync. No
        // `chargeSent` — the move never carries a charge, so a waiver the
        // operator already promised must not be cleared by this re-sync.
        onMoved={(order) =>
          pos.applyTabUpdate(order, { kot: false, keepUnfired: true })
        }
        resumedOrder={pos.resumedOrder}
      />

      {/* CR2.3 §20 — registers this page's KOT print bridge with PosPulseProvider
          and auto-prints an opted-in device's self-orders; busy on ANY print job
          queued or physically in flight (printBusy — the bridge tracks the receipt
          through onAfterPrint, review C3) or an in-flight order write. A child, not
          a hook call: the pulse subscription must not sit in PosPage's render (C1). */}
      <SelfOrderAutoPrint
        busy={printBusy || pos.isBusy}
        queueKotRound={pos.queueKotRound}
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
