"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ReceiptText, Search } from "lucide-react";

import { apiGet } from "@/lib/api-client";
import { inr, cn } from "@/lib/utils";
import { MENU_PAD_NO_CART, MENU_PAD_WITH_CART } from "@/components/public/public-shell-layout";
import {
  MENU_CACHE_TTL_MS,
  readMenuCache,
  writeMenuCache,
} from "@/components/public/public-cart-store";
import type { PublicGstConfig } from "@pos/shared/public";
import type { LogoPlacement } from "@pos/shared/appearance";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/EmptyState";
import { type PublicMenuProduct } from "@/components/public/PublicMenuItem";
import { PublicMenuHeader } from "@/components/public/PublicMenuHeader";
import { PublicMenuGroups } from "@/components/public/PublicMenuGroups";
import { PublicMenuSkeleton } from "@/components/public/PublicMenuStates";
import {
  groupItemsByCategory,
  isPublicMenuData,
  type PublicMenuData,
} from "@/components/public/public-menu-groups";
import { TableChooser, type TablePick } from "@/components/public/TableChooser";
import { CategoryPill } from "@/components/public/CategoryPill";



interface PublicTableInfo {
  tableNo: string;
  charge: { amount: number; label: string } | null;
  chargeApplies: boolean; // see PublicOrderFlow.tsx's own TableChargeInfo — same field, same rule
}

// Sentinel for "no category filter" — cannot collide with a real category name.
const ALL_CATEGORIES = "__all__";

interface PublicMenuProps {
  // Present only on /m/<token> — absent on the bare /m route.
  token?: string;
  // Per-product total cart qty, owned by PublicOrderFlow — 0 shows each
  // tile's ADD pill, >0 shows its [− n +] stepper.
  qtyByProduct: Record<string, number>;
  // Raises a tap up to PublicOrderFlow, which owns the cart and decides
  // simple-add vs. PublicItemSheet (increment) or line-remove/drawer-open
  // (decrement).
  onIncrement: (product: PublicMenuProduct) => void;
  onDecrement: (productId: string) => void;
  // Reserves room at the bottom so the fixed "View cart" bar never overlaps.
  cartCount: number;
  // The name-based pick (ADDENDUM 1, /m only), lifted to PublicOrderFlow.
  pickedTable: TablePick | null;
  onPickTable: (pick: TablePick) => void;
  // CR2.2b — /m/o/<latest code> when this device holds an order code
  // (readMyCodes()[0], computed by PublicOrderFlow post-mount); null hides
  // the pill entirely (first-time device, or nothing found).
  orderStatusHref: string | null;
  // Fires when the menu payload lands so PublicOrderFlow can price the cart
  // (gst) and reconcile stale lines (items) without a second fetch.
  onMenuData?: (data: { items: PublicMenuProduct[]; gst: PublicGstConfig }) => void;
  chrome: { heroImage: string; logoPlacement: LogoPlacement }; // CR2.4 (A1) — server-read, forwarded to PublicMenuHeader
}

// The whole diner screen: brand mark, table/parcel context, category rail,
// search, and the item list grouped by category order. Plain fetch/apiGet,
// never TanStack Query — keeps this bundle free of the admin data layer.
export function PublicMenu({
  token,
  qtyByProduct,
  onIncrement,
  onDecrement,
  cartCount,
  pickedTable,
  onPickTable,
  orderStatusHref,
  onMenuData,
  chrome,
}: PublicMenuProps) {
  const [menu, setMenu] = useState<PublicMenuData | null>(null);
  const [menuError, setMenuError] = useState(false);
  const [table, setTable] = useState<PublicTableInfo | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORIES);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    setMenuError(false);

    // CACHE-FIRST PAINT (CB-6A S10). The industry bar for a QR menu is under
    // 3s or the diner gives up and calls staff, and a cold fetch on a cheap
    // phone on cafe wifi does not reliably clear it. A cached payload younger
    // than MENU_CACHE_TTL_MS paints IMMEDIATELY, then the live fetch below
    // replaces it. SMOOTHNESS ONLY, never a source of truth: it is public
    // menu data (never diner-identifying), the cart re-validates every line
    // against the LIVE menu before anything is ordered, and a stale tile can
    // therefore never produce a stale PRICE — only a brief flicker.
    const cached = readMenuCache();
    if (cached !== null && Date.now() - cached.at < MENU_CACHE_TTL_MS && isPublicMenuData(cached.payload)) {
      setMenu(cached.payload);
    }

    apiGet<PublicMenuData>("/api/public/menu")
      .then((data) => {
        if (!active) return;
        setMenu(data);
        writeMenuCache(data);
      })
      .catch(() => {
        // Only surface the error when there is nothing on screen — a diner
        // already reading a cached menu must not be dropped into an error
        // state by a background refresh that failed.
        if (active && cached === null) setMenuError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Reports items/gst up to PublicOrderFlow — it owns the cart and needs
  // both for pricing (FIX1) and stale-line reconcile (FIX4).
  useEffect(() => {
    if (menu) onMenuData?.({ items: menu.items, gst: menu.gst });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setTableMissing(false);
    apiGet<PublicTableInfo>(`/api/public/table/${encodeURIComponent(token)}`)
      .then((data) => {
        if (active) setTable(data);
      })
      .catch(() => {
        // A dead/tampered sticker must not block browsing — just loses the preview.
        if (active) setTableMissing(true);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const sortedCategories = useMemo(
    () => [...(menu?.categories ?? [])].sort((a, b) => a.order - b.order),
    [menu],
  );

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (menu?.items ?? []).filter((item) => {
      const inCategory =
        selectedCategory === ALL_CATEGORIES || item.category === selectedCategory;
      const matches = q === "" || item.name.toLowerCase().includes(q);
      return inCategory && matches;
    });
  }, [menu, selectedCategory, search]);

  // Grouped by category in `order`, only while browsing "All".
  const groups = useMemo(
    () => groupItemsByCategory(filteredItems, selectedCategory, sortedCategories, ALL_CATEGORIES),
    [filteredItems, selectedCategory, sortedCategories],
  );

  if (menuError) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <EmptyState
          title="Couldn't load the menu"
          description="Check your connection and try again."
          action={
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Try again
            </button>
          }
        />
      </main>
    );
  }

  if (!menu) {
    return <PublicMenuSkeleton />;
  }

  const tableLabel = table
    ? table.tableNo
    : pickedTable?.kind === "tableName"
      ? pickedTable.name
      : null;
  const showParcel = !table && pickedTable?.kind === "parcel";
  // D4: an unscanned table claim disabled by the operator's toggle offers Parcel only.
  const parcelOnly = menu.allowTableChange === false;

  return (
    // MENU_PAD_* also clear the diner shell's tab bar when one is present.
    <main className={cn("mx-auto max-w-lg p-pub-pad", cartCount > 0 ? MENU_PAD_WITH_CART : MENU_PAD_NO_CART)}>
      <PublicMenuHeader
        restaurantName={menu.restaurantName}
        tableLabel={tableLabel}
        showParcel={showParcel}
        tableMissing={tableMissing}
        chrome={chrome}
      />
      {/* CR2.2b — a slim, quiet pill to the diner's own still-open/recent
          order, only when this device actually holds one. */}
      {orderStatusHref && (
        <div className="mb-4 -mt-2">
          <Link
            href={orderStatusHref}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Order status →</span>
          </Link>
        </div>
      )}
      {table?.charge && table.charge.amount > 0 && (
        <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {table.chargeApplies ? `This table adds ${table.charge.label}: ${inr(table.charge.amount)}` : `${table.charge.label} already on this table's bill`}
        </p>
      )}
      {!token && (
        <div className="mb-4">
          <TableChooser value={pickedTable} onSelect={onPickTable} parcelOnly={parcelOnly} />
        </div>
      )}
      <div className="sticky top-0 z-10 -mx-pub-pad bg-background/95 px-pub-pad py-2 backdrop-blur">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the menu…"
            className="h-11 rounded-full pl-10"
            aria-label="Search the menu"
          />
        </div>
        <div
          className="flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Menu categories"
        >
          <CategoryPill
            label="All"
            active={selectedCategory === ALL_CATEGORIES}
            onClick={() => setSelectedCategory(ALL_CATEGORIES)}
          />
          {sortedCategories.map((c) => (
            <CategoryPill
              key={c.name}
              label={c.name}
              active={selectedCategory === c.name}
              onClick={() => setSelectedCategory(c.name)}
            />
          ))}
        </div>
      </div>
      {filteredItems.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No items found"
          description="Try a different category or search term."
        />
      ) : (
        <PublicMenuGroups
          groups={groups}
          showHeadings={selectedCategory === ALL_CATEGORIES}
          qtyByProduct={qtyByProduct}
          onIncrement={onIncrement}
          onDecrement={onDecrement}
        />
      )}
    </main>
  );
}
