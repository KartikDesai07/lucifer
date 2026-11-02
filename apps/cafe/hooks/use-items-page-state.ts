"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { PRODUCT_KEYS, useProducts } from "@/hooks/use-products";
import { useCategoryMap } from "@/hooks/use-category-map";
import { MENU_STATUS_PARAM, MENU_CATEGORY_PARAM } from "@/lib/menu-sections";
import { isMenuStatusFilter, filterItems, statusCounts, type MenuStatusFilter } from "@/lib/menu-items";
import { DEFAULT_PRODUCT_SORT, nextProductSort, sortProducts, type ProductSort, type ProductSortKey } from "@/lib/products-sort";
import { MENU_LOADING_LINE, categoryCounts, menuHeaderCounts, menuHeaderLine } from "@/lib/menu-view";
import type { Product } from "@/types";

// The Items page's state (U5 Task 1, ruling M1: moved out of app/(dashboard)/products/page.tsx so the page keeps room): the
// view (active / archived), the list's query, the filters, the selection and the derived rows, counts and header line.
// Nothing here is new behaviour but the approved ones: the default sort (Q1, lib/products-sort.ts), the In stock filter and
// the header line's counts, which are the ACTIVE list's in either view.
export function useItemsPageState({ isAdmin, authLoading }: { isAdmin: boolean; authLoading: boolean }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"active" | "archived">("active");
  const isArchived = view === "archived";

  const products = useProducts(isArchived ? { archived: true } : {});
  const { map: categoryMap, categories, isLoading: categoriesLoading } = useCategoryMap();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [status, setStatus] = useState<MenuStatusFilter>("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<ProductSort>(DEFAULT_PRODUCT_SORT);

  // Read ?status= — but only once isAdmin is KNOWN (useAuth().isLoading
  // false), so a staff link to an admin-only "archived" deep link is ignored
  // rather than raced against a session that hasn't resolved yet, and an
  // admin's own link still applies once that resolution lands (not just on
  // whatever the first render happened to be).
  useEffect(() => {
    if (authLoading) return;
    const params = new URLSearchParams(window.location.search);
    const s = params.get(MENU_STATUS_PARAM);
    if (!s || !isMenuStatusFilter(s)) return;
    if (s === "archived") {
      if (isAdmin) setView("archived");
      return;
    }
    setStatus(s);
  }, [authLoading, isAdmin]);

  useEffect(() => {
    if (categories.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const c = params.get(MENU_CATEGORY_PARAM);
    if (c && categories.some((cat) => cat._id === c)) setCategoryId(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length > 0]);

  // Selection clears on an active/archived switch.
  useEffect(() => setSelected(new Set()), [view]);

  const filtered = useMemo(() => {
    const rows = filterItems(products.data ?? [], { search, categoryId, status: isArchived ? "all" : status });
    return sortProducts(rows, sort, categoryMap);
  }, [products.data, search, categoryId, status, isArchived, sort, categoryMap]);

  // Selection intersected with the visible rows — a filter/search change can
  // only ever shrink the checked set, never leave a phantom id behind.
  const effectiveSelected = useMemo(() => {
    const visible = new Set(filtered.map((p) => p._id));
    return new Set([...selected].filter((id) => visible.has(id)));
  }, [selected, filtered]);

  const counts = useMemo(
    () => statusCounts(products.data ?? [], search, categoryId),
    [products.data, search, categoryId],
  );
  // The rail's, the select's and the chips' counts: of the list on screen (the archived one in the Archived view).
  const categoryTotals = useMemo(() => categoryCounts(products.data ?? [], categories), [products.data, categories]);

  // The header's second line (design 6.1): always the ACTIVE list's counts. In the Archived view that list is read from the
  // query cache (the key the active view's own query wrote; no request of its own, so nothing new is asked of the server);
  // while it is not known, "Loading items…". A first-load error leaves the shell's default line.
  const activeList = isArchived ? queryClient.getQueryData<Product[]>(PRODUCT_KEYS.all) : products.data;
  const headerCounts = menuHeaderCounts(activeList);
  const headerLine =
    products.isError && products.data === undefined
      ? undefined
      : headerCounts && !categoriesLoading
        ? menuHeaderLine({ ...headerCounts, categories: categories.length })
        : MENU_LOADING_LINE;

  // The ONE filter select drives both the status filter and the active/archived view (G5/G6, M1 fidelity — no separate
  // view toggle): picking "Archived" switches the query view; any other value switches back to the active view with that
  // status filter applied.
  const handleStatusChange = (next: MenuStatusFilter) => {
    if (next === "archived") {
      setView("archived");
      return;
    }
    setView("active");
    setStatus(next);
  };

  const clearSelection = () => setSelected(new Set());
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // The table head's select-all (values 5.1): every LISTED item (after the filters and the search), or none when all of them
  // are on. The 500 cap stays the bar's words (a bigger list can be ticked; the actions then disable).
  const toggleSelectAll = () => {
    const ids = filtered.map((p) => p._id);
    const allOn = ids.length > 0 && ids.every((id) => effectiveSelected.has(id));
    setSelected(allOn ? new Set() : new Set(ids));
  };
  // A rail row, a chip or the select: today's category filter, and the selection clears (the HTML's pick).
  const pickCategory = (id: string | null) => {
    setCategoryId(id);
    clearSelection();
  };

  return {
    isArchived,
    products,
    categoryMap,
    categories,
    search,
    setSearch,
    categoryId,
    pickCategory,
    status,
    setStatus,
    selectMode,
    toggleSelectMode: () => setSelectMode((v) => !v),
    effectiveSelected,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    filtered,
    counts,
    categoryTotals,
    headerLine,
    sort,
    changeSort: (key: ProductSortKey) => setSort((current) => nextProductSort(current, key)),
    handleStatusChange,
    clearFilters: () => {
      setSearch("");
      setCategoryId(null);
      setStatus("all");
    },
  };
}
