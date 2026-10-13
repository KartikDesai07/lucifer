"use client";

import { useMemo } from "react";
import { tableChargeOf } from "@/lib/receipt";
import { orderTableCharge } from "@pos/shared/order-charges";
import { useTables } from "@/hooks/use-tables";
import type { Order } from "@/types";

// The table-charge entitlement behind the POS cart, split out of
// hooks/use-pos-tab.ts (S5a, behaviour-preserving move) for the line budget.
export function usePosCharge(resumedOrder: Order | null, table: string | undefined) {
  // The charge before any waiver: a resumed tab keeps the one it was OPENED with
  // (re-reading the table would let an admin edit re-price a served bill); a new
  // sale takes it from the table currently selected.
  // A resumed tab's table charge is its stored TABLE entry only — its extras ride separately (use-pos-tab seeds them),
  // so the table + extras mirror would count each extra twice.
  const tables = useTables();
  const resumedTable = useMemo(() => (resumedOrder ? orderTableCharge(resumedOrder) : null), [resumedOrder]);
  const entitledCharge = useMemo(() => {
    if (resumedOrder) return resumedTable?.amount ?? 0;
    const selected = table
      ? tables.data?.find((t) => t.tableNo === table)
      : undefined;
    return tableChargeOf(selected).amount;
  }, [resumedOrder, resumedTable, table, tables.data]);

  const chargeLabel = useMemo(() => {
    if (resumedOrder) return resumedTable?.label ?? "";
    const selected = table
      ? tables.data?.find((t) => t.tableNo === table)
      : undefined;
    return tableChargeOf(selected).label;
  }, [resumedOrder, resumedTable, table, tables.data]);
  return { entitledCharge, chargeLabel };
}
