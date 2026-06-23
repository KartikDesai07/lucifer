"use client";

import { createCrudHooks } from "@/hooks/create-crud-hooks";
import { STALE_TIMES, GC_TIMES } from "@/lib/query";
import { PRODUCT_KEYS } from "@/hooks/use-products";
import type {
  Category,
  CreateCategoryInput,
  UpdateCategoryInput,
} from "@/types";

export const CATEGORY_KEYS = {
  all: ["categories"] as const,
};

// Categories sorted by display order then name (near-static). Deleting a
// category reassigns its products to "Uncategorized" server-side, so the delete
// also refreshes the products list (CLAUDE.md §9 — invalidate on write).
const categoryHooks = createCrudHooks<
  Category,
  CreateCategoryInput,
  UpdateCategoryInput
>({
  path: "/api/categories",
  rootKey: CATEGORY_KEYS.all,
  staleTime: STALE_TIMES.CATEGORIES,
  gcTime: GC_TIMES.DEFAULT,
  messages: {
    created: "Category added",
    updated: "Category updated",
    deleted: "Category removed",
    createError: "Could not add category",
    updateError: "Could not update category",
    deleteError: "Could not remove category",
  },
  extraInvalidate: { remove: [PRODUCT_KEYS.all] },
});

export const useCategories = categoryHooks.useList;
export const useCreateCategory = categoryHooks.useCreate;
export const useUpdateCategory = categoryHooks.useUpdate;
export const useDeleteCategory = categoryHooks.useRemove;
