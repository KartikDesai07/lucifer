"use client";

import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useProducts } from "@/hooks/use-products";
import { useCategories } from "@/hooks/use-categories";
import { useTables } from "@/hooks/use-tables";
import { useOrders, OPEN_TABS_QUERY_OPTIONS } from "@/hooks/use-orders";
import { usePosTab } from "@/hooks/use-pos-tab";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useItemVoid } from "@/hooks/use-item-void";
import { useKotPrintBridge } from "@/hooks/use-kot-print-bridge";
import { useStableCallback } from "@/hooks/use-stable-callback";
import { useEmptiedSheetClose } from "@/hooks/use-emptied-sheet-close";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CategorySidebar,
  ALL_CATEGORIES,
  type CategoryPickerProps,
} from "@/components/pos/CategorySidebar";
import { ProductGrid, GridSkeleton, MenuLoadError } from "@/components/pos/ProductGrid";
import { Cart } from "@/components/pos/Cart";
import { MobileCartBar } from "@/components/pos/MobileCartBar";
import { PosHeader } from "@/components/pos/PosHeader";
import { PrintSources } from "@/components/pos/PrintSources";
import { PosModals } from "@/components/pos/PosModals";
import { SelfOrderAutoPrint } from "@/components/pos/SelfOrderAutoPrint";
import { PosKeys } from "@/components/pos/PosKeys";
import { printConfigOf } from "@/lib/print";
import { buildCartProps, hasPendingAdjustment } from "@/lib/pos-cart-props";
import { defaultAddOptions } from "@/lib/pos-price-buttons";
import {
  POS_PAGE_CLASS,
  POS_BODY_GRID_CLASS,
  POS_ASIDE_CLASS,
  POS_MAIN_CLASS,
  POS_CART_CLASS,
} from "@/lib/pos-layout";
import type { Order, Product } from "@/types";

// The cart's cells: a loading openTabs must not hand them a fresh [] each render (PosHeader takes the query's own data).
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
  const openTabs = useOrders({ payment: "Unpaid", status: "Pending" }, OPEN_TABS_QUERY_OPTIONS);
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
  const [catQuery, setCatQuery] = useState("");
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

  // The sheet closes itself as the order's last item goes with no adjustment left (see hasPendingAdjustment), main's
  // close; never when only an adjustment leaves an already item-less order: owner Q18's empty sheet is a working
  // place (ruling P50, lib/pos-cart-view.ts shouldCloseEmptiedSheet).
  const pendingAdjustment = hasPendingAdjustment(pos);
  useEmptiedSheetClose(pos.cart.length, pendingAdjustment, setMobileCartOpen);

  // Print only after the receipt/KOT DOM reflects the freshly-placed order.
  const {
    lastOrder,
    shouldPrintReceipt,
    clearPrintReceipt,
    shouldPrintKot,
    clearPrintKot,
  } = pos;

  // The print jobs can use different paper widths (a wider bill roll than the
  // kitchen printer), so each job's page setup comes from its OWN resolved config.
  const printCfg = printConfigOf(pos.settings.data);

  // Both useReactToPrint jobs, the guard ref, and the chaining effects live in
  // this shared hook now — see its own file for why (CR1.2's fixed-id-iframe
  // note carries over unchanged).
  const { receiptRef, kotRef, tokenRef, printBusy } = useKotPrintBridge({
    lastOrder,
    shouldPrintKot,
    clearPrintKot,
    kotPaperWidth: printCfg.kot.paperWidth,
    receipt: {
      shouldPrintReceipt,
      clearPrintReceipt,
      billPaperWidth: printCfg.bill.paperWidth,
    },
    token: { shouldPrintToken: pos.shouldPrintToken, clearPrintToken: pos.clearPrintToken, billPaperWidth: printCfg.bill.paperWidth },
  });

  const { addToCart } = pos;
  // A price button adds at once (owner Q5, U1 Task 3): the item, or the
  // variation its button names, with exactly what the options modal adds when
  // nothing in it is changed (lib/pos-price-buttons.ts) — so the two lines
  // merge. A variation item never adds without its size: every adding button
  // names one, and beyond three sizes one "Choose" button opens the modal.
  const handleProductClick = useCallback((product: Product, variation?: string) => {
    addToCart(product, defaultAddOptions(product, variation));
  }, [addToCart]);

  // Opens the SAME modal for a plain product too — it already hides its
  // add-ons block when the product carries none, so this is "free": the
  // operator still gets the instructions/qty fields. The card's name opens it
  // (and the "Choose" button of an item with more than three sizes).
  const handleProductOptions = useCallback((product: Product) => {
    setModifierProduct(product);
    setModifierOpen(true);
  }, []);

  // PosHeader is memoized: these two usePosTab closures are re-minted every render
  // (they read the live cart), so latch them; the move-table opener (the cart's Table
  // cell on a tab) only wraps a setState and needs plain useCallback.
  const onResumeTab = useStableCallback(pos.requestResume);
  const onTableChange = useStableCallback(pos.setTable);
  const handleMoveTable = useCallback(() => setMoveTableOpen(true), []);

  // One props object for both cart mounts. The head's cells take the floor, the open tabs and the two openers (owner
  // Q9); a sent line's Void opens the dialog on that line (owner Q10).
  const cartProps = buildCartProps(pos, itemVoid.openFor, products.data, {
    tables: tables.data, openTabs: openTabs.data ?? NO_OPEN_TABS, onResumeTab, onMoveTable: handleMoveTable,
  });
  // One picker and one Find category text (values 2.6) for the column and the Category sheet (design 6.3).
  const categoryPicker: CategoryPickerProps = {
    categories: categories.data,
    products: products.data,
    selected: category,
    onSelect: setCategory,
    query: catQuery,
    onQueryChange: setCatQuery,
  };

  return (
    <div className={POS_PAGE_CLASS}>
      {/* The header's switch-order button and its Open orders panel (portaled into the shell's header) and the Floor
          hand-off (U1 Task 6): nothing of it sits in the page's own flow. */}
      <PosHeader
        lastOrder={pos.lastOrder}
        onReprintKot={pos.reprintKot}
        openTabs={openTabs.data}
        onResumeTab={onResumeTab}
        resumedOrder={pos.resumedOrder}
        isBusy={pos.isBusy}
        onTableChange={onTableChange}
        customerName={pos.customer?.name}
        count={pos.count} newCount={pos.newCount} total={pos.total}
      />
      {/* The body grid (values 2.0): categories from 1100px, the menu, the cart from 1280px (owner Q19); each scrolls. */}
      <div data-ui="pos-body" className={POS_BODY_GRID_CLASS}>
        <aside data-ui="pos-aside" className={POS_ASIDE_CLASS}>
          {categories.isLoading ? (
            <Skeleton className="m-3 flex-1" />
          ) : (
            <CategorySidebar {...categoryPicker} />
          )}
        </aside>
        {/* The menu column (values 3.1): the HTML's one scroller, ProductGrid's sticky toolbar (the search box, the
            Category button below 1100px) and its list, which scroll under the toolbar. */}
        <div data-ui="pos-main" className={POS_MAIN_CLASS}>
          {/* Loading: the toolbar as it will stand (its search box and Category button take no input yet) over
              HTML-shaped cards, so nothing jumps when the menu arrives; a failed first read: the HTML's no-results
              line (design 6.3). A failed background refresh keeps the grid: only the toolbar's slot changes
              (lib/menu-freshness-paths.test.ts M1/M3). */}
          {products.isLoading ? (
            <GridSkeleton categoryPicker={categoryPicker} />
          ) : products.isError && products.data === undefined ? (
            <MenuLoadError />
          ) : (
            <ProductGrid
              products={products.data ?? []}
              selectedCategory={category}
              onProductClick={handleProductClick}
              onProductOptions={handleProductOptions}
              qtyByProduct={qtyByProduct}
              disabled={pos.isBusy}
              categoryPicker={categoryPicker}
            />
          )}
        </div>
        <section data-ui="pos-cart" className={POS_CART_CLASS}>
          <Cart {...cartProps} />
        </section>
      </div>

      {/* Below 1280px (values 6.1, 6.3; owner Q18, Q19): the HTML's glass order bar over the page's foot, in every state
          (on the tab bar on a phone); its "Review order" slides up the cart sheet, the whole screen at every width.
          The bar reads its figures (count, total, the tab on screen, an unanswered send) from the same cartProps. */}
      <MobileCartBar
        open={mobileCartOpen}
        onOpenChange={setMobileCartOpen}
        cartProps={cartProps}
      />
      <PosKeys busy={pos.isBusy} />

      {/* The modal roots live in one child: per-root memo boundaries skip PosPage's re-renders (CB-1d.3c / C3). */}
      <PosModals
        modifierProduct={modifierProduct}
        modifierOpen={modifierOpen}
        onModifierOpenChange={setModifierOpen}
        onModifierConfirm={(p, opts) => pos.addToCart(p, opts)}
        paymentOpen={pos.paymentOpen}
        onPaymentOpenChange={pos.onPaymentOpenChange}
        paymentNotice={pos.paymentNotice}
        totals={pos.modalTotals}
        customer={pos.customer}
        tableNo={pos.table}
        receiver={receiver}
        isSubmitting={pos.paymentBusy}
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
        voidInitialLine={itemVoid.line}
        moveTableOpen={moveTableOpen}
        onMoveTableOpenChange={setMoveTableOpen}
        // `kot:false` — the move's own slip IS the kitchen's paper; a round
        // ticket here would tell them to cook again. `keepUnfired:true` —
        // unsent cart lines are still owed and must survive the re-sync. No
        // charge rides a move, so the operator's waiver is left alone.
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
        tokenRef={tokenRef}
      />
    </div>
  );
}
