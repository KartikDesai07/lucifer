"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { apiGet } from "@/lib/api-client";
import { inr, cn } from "@/lib/utils";
import type { PublicGstConfig } from "@pos/shared/public";
import type { LogoPlacement } from "@pos/shared/appearance";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  PublicMenuItem,
  type PublicMenuCategoryInfo,
  type PublicMenuProduct,
} from "@/components/public/PublicMenuItem";
import { PublicMenuHeader } from "@/components/public/PublicMenuHeader";
import { TableChooser, type TablePick } from "@/components/public/TableChooser";
import { CategoryPill } from "@/components/public/CategoryPill";

interface PublicMenuData {
  restaurantName: string;
  // Diner-pickable-table toggle — read here, not a prop, to avoid a 2nd fetch.
  allowTableChange: boolean;
  // FIX1 — so the diner cart can show a tax-exclusive total matching the bill.
  gst: PublicGstConfig;
  categories: PublicMenuCategoryInfo[];
  items: PublicMenuProduct[];
}

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
    apiGet<PublicMenuData>("/api/public/menu")
      .then((data) => {
        if (active) setMenu(data);
      })
      .catch(() => {
        if (active) setMenuError(true);
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

  const categoryOrder = useMemo(() => {
    const map = new Map<string, number>();
    sortedCategories.forEach((c) => map.set(c.name, c.order));
    return map;
  }, [sortedCategories]);

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
  const groups = useMemo(() => {
    if (selectedCategory !== ALL_CATEGORIES) {
      return [{ name: selectedCategory, items: filteredItems }];
    }
    const byCategory = new Map<string, PublicMenuProduct[]>();
    for (const item of filteredItems) {
      const list = byCategory.get(item.category) ?? [];
      list.push(item);
      byCategory.set(item.category, list);
    }
    return [...byCategory.entries()]
      .sort(
        ([a], [b]) =>
          (categoryOrder.get(a) ?? Number.POSITIVE_INFINITY) -
          (categoryOrder.get(b) ?? Number.POSITIVE_INFINITY),
      )
      .map(([name, items]) => ({ name, items }));
  }, [filteredItems, selectedCategory, categoryOrder]);

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
    return (
      <main className="mx-auto max-w-lg space-y-4 p-pub-pad">
        <Skeleton className="h-12 w-40" />
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </main>
    );
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
    <main className={cn("mx-auto max-w-lg p-pub-pad", cartCount > 0 ? "pb-28" : "pb-10")}>
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
            <span aria-hidden>🧾</span>
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
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the menu…"
            className="pl-8"
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
        <div className="mt-4 space-y-pub-gap">
          {groups.map((group) => (
            <section key={group.name}>
              {selectedCategory === ALL_CATEGORIES && (
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.name}
                </h2>
              )}
              <div className="space-y-pub-gap">
                {group.items.map((item) => (
                  <PublicMenuItem
                    key={item.id}
                    product={item}
                    qty={qtyByProduct[item.id] ?? 0}
                    onIncrement={onIncrement}
                    onDecrement={onDecrement}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
