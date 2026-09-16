"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiSend } from "@/lib/api-client";
import { PRODUCT_KEYS } from "@/hooks/use-products";
import { CATEGORY_KEYS } from "@/hooks/use-categories";
import type { ImportPreview, ImportResult } from "@/types";

type RawRow = Record<string, unknown>;

const IMPORT_PATH = "/api/products/import";

// Dry-run preview: server validates every row and reports create/update/error
// without writing. No cache effects — purely informational.
export function useImportPreview() {
  return useMutation({
    mutationFn: (rows: RawRow[]) =>
      apiSend<ImportPreview>(IMPORT_PATH, "POST", { dryRun: true, rows }),
    onError: (err: Error) =>
      toast.error(err.message || "Could not validate the file"),
  });
}

// Commit: upserts valid rows by name and auto-creates missing categories. Both
// the products and categories lists may change, so invalidate both.
export function useImportProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: RawRow[]) =>
      apiSend<ImportResult>(IMPORT_PATH, "POST", { dryRun: false, rows }),
    onError: (err: Error) =>
      toast.error(err.message || "Could not import products"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all });
      qc.invalidateQueries({ queryKey: CATEGORY_KEYS.all });
    },
  });
}
