"use client";

import { useEffect, useMemo, useState } from "react";

import {
  publicCartTotals,
  publicOrderStatusPath,
  PUBLIC_ORDER_MAX_ITEMS,
  PUBLIC_ORDER_MAX_QTY,
  type PublicGstConfig,
} from "@pos/shared/public";
import type { LogoPlacement } from "@pos/shared/appearance";
import { PublicMenu } from "@/components/public/PublicMenu";
import { PublicFlowChrome } from "@/components/public/PublicFlowChrome";
import { PublicItemSheet, type PublicAddToCartOpts } from "@/components/public/PublicItemSheet";
import { PublicCart } from "@/components/public/PublicCart";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import type { TablePick } from "@/components/public/TableChooser";
import {
  readCart,
  writeCart,
  readMyCodes,
  type CartLine,
} from "@/components/public/public-cart-store";
import {
  computeAddLine,
  computeLineCountByProduct,
  computeQtyByProduct,
  reconcileCartWithMenu,
} from "@/components/public/public-cart-math";
import { usePublicSuggestions } from "@/components/public/use-public-suggestions";
import { usePublicTableCharge } from "@/components/public/use-public-table-charge";

// Before any menu payload has landed, GST is unknown — this mirrors the menu
// route's own fallback (settings?.gstEnabled ?? false) so the pre-load total
// (subtotal + charge, no tax) matches what the route would return for a cafe
// with GST off.
const DEFAULT_GST: PublicGstConfig = { enabled: false, rate: 0, mode: "inclusive" };

interface PublicOrderFlowProps {
  // Present only on /m/<token>.
  token?: string;
  // CR2.4 (A1) — hero image/logo placement, server-read by the /m pages and
  // forwarded to PublicMenu → PublicMenuHeader unchanged.
  chrome: { heroImage: string; logoPlacement: LogoPlacement };
}

// Owns the diner's cart (persisted through public-cart-store), the resolved
// table charge, and the /m name-based table pick — the one parent PublicMenu,
// PublicItemSheet and PublicCart all report up to. SLICE 8.
export function PublicOrderFlow({ token, chrome }: PublicOrderFlowProps) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [pickedTable, setPickedTable] = useState<TablePick | null>(null);
  const [sheetProduct, setSheetProduct] = useState<PublicMenuProduct | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const { tableCharge, chargeApplies } = usePublicTableCharge(token);
  const [gst, setGst] = useState<PublicGstConfig>(DEFAULT_GST);
  const [menuItems, setMenuItems] = useState<PublicMenuProduct[] | null>(null);
  const [itemCapNotice, setItemCapNotice] = useState(false);
  const [staleNotice, setStaleNotice] = useState(false);
  const [latestOrderCode, setLatestOrderCode] = useState<string | null>(null);

  // Hydrate from localStorage exactly once, BEFORE the persist effect below
  // ever runs — reversing this order would overwrite a real saved cart with
  // the initial `[]` on every page load.
  useEffect(() => {
    setCart(readCart());
    setHydrated(true);
  }, []);

  // CR2.2b menu header pill — reads localStorage, so this MUST run post-mount
  // (never during SSR render/first paint) to stay hydration-safe. null when
  // this device has never placed an order; the pill in PublicMenu is hidden.
  useEffect(() => {
    setLatestOrderCode(readMyCodes()[0] ?? null);
  }, []);

  useEffect(() => {
    if (hydrated) writeCart(cart);
  }, [cart, hydrated]);

  // The cap notice is transient — once the diner removes a line and is back
  // under the limit, the message is no longer true and would otherwise sit
  // there for the rest of the visit.
  useEffect(() => {
    if (cart.length < PUBLIC_ORDER_MAX_ITEMS) setItemCapNotice(false);
  }, [cart.length]);

  // FIX4 — a diner can leave the menu tab open long enough for a product to
  // go sold-out, get discontinued, or reprice. Every time a fresh menu
  // payload lands (PublicMenu's onMenuData), re-derive each cart line's
  // display name/price from the LIVE product and drop lines that no longer
  // resolve — never silently sell what the kitchen can no longer make.
  //
  // CR2.2 fix round (setState closure flags) — reconcileCartWithMenu computes
  // the next cart AND the changed verdict in pure code against `cart`
  // (already in scope, kept fresh via the dependency array below) BEFORE
  // either setCart or setStaleNotice runs — never a flag read back out of a
  // setCart updater after the call.
  useEffect(() => {
    if (!menuItems) return;
    const { next, changed } = reconcileCartWithMenu(cart, menuItems);
    if (changed) {
      setCart(next);
      setStaleNotice(true);
    }
  }, [menuItems, cart]);

  function addLine(product: PublicMenuProduct, opts: PublicAddToCartOpts) {
    // FIX3 / CR2.2 fix round — computeAddLine decides the next cart AND the
    // capped verdict in pure code against `cart` first; setCart/setItemCapNotice
    // only ever consume that already-computed result, never a flag mutated
    // inside a setCart updater after the call (see reconcileCartWithMenu's
    // own comment above for why that pattern isn't safe to rely on).
    const { next, capped } = computeAddLine(cart, product, opts);
    setCart(next);
    if (capped) setItemCapNotice(true);
  }

  // CR2.2b Blinkit-pattern stepper's "+" (also the tile's ADD pill, qty 0).
  // Simple items (no variations, no modifiers) skip PublicItemSheet — this
  // merges/increments qty 1 straight in. Anything else opens the sheet for a
  // choice — unchanged from the earlier handleAdd behavior.
  function handleIncrement(product: PublicMenuProduct) {
    const needsChoices = (product.variations?.length ?? 0) > 0 || product.modifiers.length > 0;
    if (needsChoices) {
      setSheetProduct(product);
      setSheetOpen(true);
    } else {
      addLine(product, { qty: 1, modifiers: [], variation: undefined, instructions: undefined });
    }
  }

  function handleUpdateQty(lineId: string, qty: number) {
    setCart((prev) =>
      qty <= 0
        ? prev.filter((l) => l.lineId !== lineId)
        : prev.map((l) => (l.lineId === lineId ? { ...l, qty: Math.min(PUBLIC_ORDER_MAX_QTY, qty) } : l)),
    );
  }

  function handleRemove(lineId: string) {
    setCart((prev) => prev.filter((l) => l.lineId !== lineId));
  }

  // CR2.2b Blinkit-pattern stepper's "−". Exactly one cart line for this
  // product: qty>1 steps it down, qty 1 removes the line (stepper morphs back
  // to ADD). Several lines (different variation/modifier combinations) can't
  // be resolved to a single line from a tile tap, so this opens the cart
  // drawer instead — per-line editing lives there. Zero lines: no-op (the
  // tile wouldn't be showing a stepper to tap in the first place).
  function handleDecrement(productId: string) {
    const lineCount = lineCountByProduct[productId] ?? 0;
    if (lineCount === 0) return;
    if (lineCount > 1) {
      setCartOpen(true);
      return;
    }
    const line = cart.find((l) => l.productId === productId);
    if (!line) return;
    if (line.qty > 1) handleUpdateQty(line.lineId, line.qty - 1);
    else handleRemove(line.lineId);
  }

  // S4 — always the simple direct-add path: a suggestion chip is a ONE-TAP
  // add by design, never a detour through PublicItemSheet.
  function handleAddSuggestion(product: PublicMenuProduct) {
    addLine(product, { qty: 1, modifiers: [], variation: undefined, instructions: undefined });
  }

  // FIX2 — clears BOTH the in-memory cart here and localStorage (PublicCart's
  // own clearCart() call) on a successful submit, before router.push — the
  // double-post window this closes is a diner re-tapping Send while
  // navigation is still in flight and seeing the SAME cart still loaded.
  function handleSubmitted() {
    setCart([]);
  }

  // CR2.2b stepper derivations (public-cart-math.ts) — qty summed per product
  // drives ADD vs. [− n +] on each tile; line count per product drives
  // handleDecrement's single-line-vs-open-drawer branch above.
  const qtyByProduct = useMemo(() => computeQtyByProduct(cart), [cart]);
  const lineCountByProduct = useMemo(() => computeLineCountByProduct(cart), [cart]);

  // S4 — top sellers, extracted to its own hook (mechanical, ~300-line cap):
  // owns the popular-items fetch and the pure narrowing (no-variation, not
  // already in cart, live-menu availability). Behavior-identical.
  const suggestions = usePublicSuggestions(menuItems, cart);

  const cartCount = cart.reduce((sum, l) => sum + l.qty, 0);
  const subtotal = cart.reduce((sum, l) => sum + l.price * l.qty, 0);
  // FIX1 — the ONE place this flow derives a displayed total; PublicCart uses
  // the same helper independently for its own line-item breakdown so neither
  // can drift from what the kitchen will actually bill.
  const { total } = publicCartTotals(subtotal, tableCharge?.amount ?? 0, gst);

  return (
    <>
      {/* CR2.4 (A20 mechanical follow-up) — the persistent fixed-position
          chrome (stale-cart banner, item-cap notice, bottom View-cart bar)
          extracted to PublicFlowChrome.tsx, same tokens/classes/conditions. */}
      <PublicFlowChrome
        staleNotice={staleNotice}
        onDismissStale={() => setStaleNotice(false)}
        itemCapNotice={itemCapNotice}
        cartCount={cartCount}
        total={total}
        onOpenCart={() => setCartOpen(true)}
      />
      <PublicMenu
        token={token}
        qtyByProduct={qtyByProduct}
        onIncrement={handleIncrement}
        onDecrement={handleDecrement}
        cartCount={cartCount}
        pickedTable={pickedTable}
        onPickTable={setPickedTable}
        orderStatusHref={latestOrderCode ? publicOrderStatusPath(latestOrderCode) : null}
        onMenuData={({ items, gst: liveGst }) => {
          setMenuItems(items);
          setGst(liveGst);
        }}
        chrome={chrome}
      />
      <PublicItemSheet
        product={sheetProduct}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onConfirm={addLine}
      />
      <PublicCart
        open={cartOpen}
        onOpenChange={setCartOpen}
        cart={cart}
        onUpdateQty={handleUpdateQty}
        onRemove={handleRemove}
        token={token}
        pickedTable={pickedTable}
        tableCharge={tableCharge}
        chargeApplies={chargeApplies}
        gst={gst}
        onSubmitted={handleSubmitted}
        suggestions={suggestions}
        onAddSuggestion={handleAddSuggestion}
      />
    </>
  );
}
