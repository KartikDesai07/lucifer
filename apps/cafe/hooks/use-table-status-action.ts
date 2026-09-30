"use client";

import { useCallback, useRef, useState } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ApiError, apiSend } from "@/lib/api-client";
import { ORDER_KEYS } from "@/hooks/use-orders";
import { commitTableChange, refreshTablesNow, withTableRow } from "@/hooks/use-tables";
import type { TableStatus } from "@/lib/constants";
import type { Table, UpdateTableInput } from "@/types";

const HTTP_CONFLICT = 409;
const HTTP_NOT_FOUND = 404;
const FALLBACK_ERROR = "Could not update the table";

interface StatusVars {
  table: Table;
  status: TableStatus;
}

// The Floor's one status writer (Reserve / Free / Seat now). It sends what the
// tile SAW — `expectedCurrentOrderId` is that table's order pointer, "" for
// none — so a stale tile can never free a table another device has since
// given an order (the server refuses with a 409). Pending is tracked PER TILE:
// a state Set drives the disabled look, and a ref Set closes the same-frame
// double tap that state alone would let through. Nothing is reverted on a
// throw: there is no optimistic write to undo, and a failed write may still
// have landed, so every failure re-reads the live floor instead.
export function useTableStatusAction() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef<Set<string>>(new Set());

  const write = useMutation({
    mutationFn: ({ table, status }: StatusVars) => {
      const body: UpdateTableInput = { status, expectedCurrentOrderId: table.currentOrderId ?? "" };
      return apiSend<Table>(`/api/tables/${encodeURIComponent(table.tableNo)}`, "PUT", body);
    },
  });
  const { mutateAsync } = write;

  /** Resolves with the saved table, or null when the write did not happen
   *  (already in flight for this table, or it failed — the toast said why).
   *  `quiet` skips the success toast (Seat now: New Order opening is the answer). */
  const run = useCallback(
    async (table: Table, status: TableStatus, quiet = false): Promise<Table | null> => {
      const key = table.tableNo;
      if (pendingRef.current.has(key)) return null;
      pendingRef.current.add(key);
      setPending(new Set(pendingRef.current));
      try {
        const saved = await mutateAsync({ table, status });
        // Commit BEFORE returning: Seat now navigates right after this, and
        // New Order must find the table Available in the cache.
        await commitTableChange(qc, (list) => withTableRow(list, saved));
        if (!quiet) toast.success(status === "Reserved" ? `${key} reserved` : `${key} is free`);
        return saved;
      } catch (err) {
        await handleFailure(qc, key, err);
        return null;
      } finally {
        pendingRef.current.delete(key);
        setPending(new Set(pendingRef.current));
      }
    },
    [mutateAsync, qc],
  );

  const isPending = useCallback((tableNo: string) => pending.has(tableNo), [pending]);

  return { run, isPending };
}

async function handleFailure(qc: QueryClient, tableNo: string, err: unknown): Promise<void> {
  const status = err instanceof ApiError ? err.status : null;
  if (status === HTTP_CONFLICT) {
    toast.error(`${tableNo} changed on another device. The floor has been refreshed.`);
  } else if (status === HTTP_NOT_FOUND) {
    toast.error(`${tableNo} is no longer on the floor plan. The floor has been refreshed.`);
  } else {
    toast.error(err instanceof Error && err.message ? err.message : FALLBACK_ERROR);
  }
  try {
    await refreshTablesNow(qc);
  } catch {
    // Offline: the cache keeps the last confirmed floor; the poll corrects it.
  }
  // The open bills may have moved too (a 409 usually means an order claimed the table).
  if (status === HTTP_CONFLICT || status === HTTP_NOT_FOUND) {
    void qc.invalidateQueries({ queryKey: ORDER_KEYS.lists });
  }
}
