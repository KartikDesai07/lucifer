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

// Categories sorted by display order then name (near-static). A category can
// only be deleted once it has no products (the route's 409 guard, CB-DL-2),
// so a successful delete can never itself change which category a product
// belongs to — but a stale cached products list could still show a card for
// the category id that was just removed, so the delete still invalidates the
// products list too (extraInvalidate below), just to fix the display rather
// than to follow a server-side cascade that no longer exists.
//
// Master data (CB-DL-1): seeded once per page load from GET /api/bootstrap
// (MasterDataProvider) and served from the tab's own copy afterwards, so the
// freshness window is the blob's 24h; a page refresh re-fetches the bootstrap.
const categoryHooks = createCrudHooks<
  Category,
  CreateCategoryInput,
  UpdateCategoryInput
>({
  path: "/api/categories",
  rootKey: CATEGORY_KEYS.all,
  staleTime: STALE_TIMES.MASTERS,
  gcTime: GC_TIMES.MASTERS,
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
