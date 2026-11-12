"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { INVENTORY_KEYS } from "@/hooks/use-inventory";
import { PRODUCT_KEYS } from "@/hooks/use-products";
import type { OwnStockInput, StockUseInput } from "@/schemas";
import type { StockUseDto } from "@/types/inventory";

// Inventory lite, Slice 3: what one sold unit of a menu item takes out of stock. Admin-only routes, separate from the
// product routes on purpose. The editor always wants a fresh read when it opens, so the GET is never reused.
export const stockUseKey = (productId: string) => ["stock-use", productId] as const;

const stockUseUrl = (productId: string) => `/api/products/${productId}/stock-use`;

export function useStockUse(productId: string, enabled: boolean) {
  return useQuery({
    queryKey: stockUseKey(productId),
    queryFn: () => apiGet<StockUseDto>(stockUseUrl(productId)),
    enabled: enabled && productId !== "",
    staleTime: 0,
    // A refocus must not swap the rows under a half-typed edit.
    refetchOnWindowFocus: false,
  });
}

/** Shared by both writes: the answer is the new truth; the menu list and the stock list refresh. */
function useAfterWrite(productId: string) {
  const qc = useQueryClient();
  return (dto: StockUseDto, message: string) => {
    qc.setQueryData(stockUseKey(productId), dto);
    void qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all });
    void qc.invalidateQueries({ queryKey: INVENTORY_KEYS.items });
    toast.success(message);
  };
}

export function useSaveStockUse(productId: string) {
  const afterWrite = useAfterWrite(productId);
  return useMutation({
    mutationFn: (input: StockUseInput) => apiSend<StockUseDto>(stockUseUrl(productId), "PUT", input),
    onSuccess: (dto) => afterWrite(dto, "Stock use saved"),
    onError: (error: Error) => toast.error(error.message),
  });
}

/** The one tap: the menu item becomes its own stock item, one unit per sold. */
export function useTrackOwnStock(productId: string) {
  const afterWrite = useAfterWrite(productId);
  return useMutation({
    mutationFn: (input: OwnStockInput) => apiSend<StockUseDto>(`${stockUseUrl(productId)}/own`, "POST", input),
    onSuccess: (dto) => afterWrite(dto, "This item now tracks its own stock"),
    onError: (error: Error) => toast.error(error.message),
  });
}
