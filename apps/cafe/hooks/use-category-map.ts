"use client";

import { useMemo } from "react";

import { useCategories } from "@/hooks/use-categories";
import { buildCategoryMap } from "@/lib/category-map";

// Wraps useCategories() with the id->Category join map (CB-DL-2 D-A5), so
// every screen that needs a category NAME from a product's categoryId can
// call one hook instead of re-deriving the map itself.
export function useCategoryMap() {
  const { data, isLoading } = useCategories();
  const map = useMemo(() => buildCategoryMap(data ?? []), [data]);
  return { map, categories: data ?? [], isLoading };
}
