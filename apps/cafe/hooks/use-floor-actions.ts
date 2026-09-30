"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { UseQueryResult } from "@tanstack/react-query";

import { useTableStatusAction } from "@/hooks/use-table-status-action";
import { FLOOR_POS_PATH, type FloorMenuAction, type FloorTileModel } from "@/lib/floor-tiles";
import { offerPosTable } from "@/lib/pos-table-handoff";
import { openTabForTable } from "@/lib/table-pick";
import type { Order, Table } from "@/types";

// A paused (offline) or hung read must not leave a tile stuck on "checking".
export const OPEN_TABS_CHECK_TIMEOUT_MS = 8_000;
const CHECK_FAILED_TOAST = "Could not check for an open bill. Try again.";
const TIMED_OUT = Symbol("timed-out");

export type FloorDialogKind = "free" | "seat";
export interface FloorDialog {
  kind: FloorDialogKind;
  table: Table;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

// What the Floor does when a tile asks for something that changes a table:
// Reserve straight away, Free and Seat now behind a confirm. All three FIRST
// re-read the open bills — the tile may be seconds stale, and freeing (or
// reserving) a table that holds a bill orphans the bill. The check fails
// closed: a timeout, a failed read or missing data all stop the write.
export function useFloorActions(openTabs: Pick<UseQueryResult<Order[]>, "refetch">) {
  const router = useRouter();
  const action = useTableStatusAction();
  const [dialog, setDialog] = useState<FloorDialog | null>(null);
  // Tables whose open-bill check is running (per tile, like the write's own
  // pending set); the ref closes a same-frame double tap.
  const [checking, setChecking] = useState<ReadonlySet<string>>(() => new Set());
  const checkingRef = useRef<Set<string>>(new Set());
  const confirmingRef = useRef(false);

  const startCheck = (tableNo: string): boolean => {
    if (checkingRef.current.has(tableNo)) return false;
    checkingRef.current.add(tableNo);
    setChecking(new Set(checkingRef.current));
    return true;
  };
  const endCheck = (tableNo: string) => {
    checkingRef.current.delete(tableNo);
    setChecking(new Set(checkingRef.current));
  };

  // The fresh open bills, or null when they could not be read. refetch()
  // RESOLVES on failure (with the stale data still attached), so the verdict
  // comes from res.isError / res.data — never from the last rendered list.
  const freshOpenTabs = async (): Promise<readonly Order[] | null> => {
    try {
      const res = await withTimeout(openTabs.refetch(), OPEN_TABS_CHECK_TIMEOUT_MS);
      if (res === TIMED_OUT || res.isError || res.data === undefined) return null;
      return res.data;
    } catch {
      return null;
    }
  };

  const cleared = async (table: Table): Promise<boolean> => {
    const tabs = await freshOpenTabs();
    if (tabs === null) {
      toast.error(CHECK_FAILED_TOAST);
      return false;
    }
    if (openTabForTable(table.tableNo, tabs)) {
      toast.error(`${table.tableNo} has an open bill now. Tap the table to open it.`);
      return false;
    }
    return true;
  };

  const confirm = async () => {
    if (!dialog || confirmingRef.current) return;
    const { kind, table } = dialog;
    if (!startCheck(table.tableNo)) return;
    confirmingRef.current = true;
    try {
      if (!(await cleared(table))) return;
      const saved = await action.run(table, "Available", kind === "seat");
      if (saved && kind === "seat") {
        offerPosTable(table.tableNo, Date.now());
        router.push(FLOOR_POS_PATH);
      }
    } finally {
      confirmingRef.current = false;
      endCheck(table.tableNo);
      setDialog(null);
    }
  };

  const reserve = async (table: Table) => {
    if (!startCheck(table.tableNo)) return;
    try {
      if (!(await cleared(table))) return;
      await action.run(table, "Reserved");
    } finally {
      endCheck(table.tableNo);
    }
  };

  const tapPrimary = (tile: FloorTileModel) => {
    if (tile.primary === "seat-now") setDialog({ kind: "seat", table: tile.table });
    else if (tile.primary === "free") setDialog({ kind: "free", table: tile.table });
  };

  const pickMenu = (table: Table, choice: FloorMenuAction) => {
    if (choice === "reserve") void reserve(table);
    else setDialog({ kind: "free", table });
  };

  const onDialogOpenChange = (open: boolean) => {
    if (!open && !confirmingRef.current) setDialog(null);
  };

  const isBusy = (tableNo: string) => checking.has(tableNo) || action.isPending(tableNo);

  return { dialog, confirm, tapPrimary, pickMenu, onDialogOpenChange, isBusy };
}
