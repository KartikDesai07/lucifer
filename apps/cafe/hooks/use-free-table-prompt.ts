"use client";

import { useState } from "react";

import { useUpdateTable } from "@/hooks/use-tables";

interface FreeTablePromptState {
  tableNo: string;
  orderId: string;
}

// POST /api/orders occupies a table on EVERY create, so a brand-new Pay-Now
// sale against a table leaves it Occupied forever unless someone frees it (a
// resumed-tab SETTLE already auto-frees the table server-side — this prompt
// is only for the create path, see usePosTab's confirmPayment). Freeing goes
// through the same PUT the table-status seam already uses, echoing the order
// that was just paid so a stale prompt can't blindly clear a DIFFERENT order's
// claim on the table (reciprocal-CAS — CR1.5 Slice 2).
export function useFreeTablePrompt() {
  const [freeTablePrompt, setFreeTablePrompt] = useState<FreeTablePromptState | null>(
    null,
  );
  const updateTable = useUpdateTable();

  const askToFreeTable = (state: FreeTablePromptState) => setFreeTablePrompt(state);
  const dismissFreeTablePrompt = () => setFreeTablePrompt(null);

  const confirmFreeTable = async () => {
    if (!freeTablePrompt) return;
    try {
      // useUpdateTable already toasts success/failure — including the 409
      // TABLE_CLAIMED_ERROR body when another order claimed the table first,
      // which is an expected outcome here, not a bug to retry.
      await updateTable.mutateAsync({
        tableNo: freeTablePrompt.tableNo,
        data: { status: "Available", expectedCurrentOrderId: freeTablePrompt.orderId },
      });
    } catch {
      /* already toasted by useUpdateTable's onError */
    } finally {
      setFreeTablePrompt(null);
    }
  };

  return {
    freeTablePrompt,
    askToFreeTable,
    dismissFreeTablePrompt,
    confirmFreeTable,
    freeingTable: updateTable.isPending,
  };
}
