"use client";

import { useMemo } from "react";
import { tableChargeOf } from "@/lib/receipt";
import { useTables } from "@/hooks/use-tables";
import type { Order } from "@/types";

// The table-charge entitlement behind the POS cart, split out of
// hooks/use-pos-tab.ts (S5a, behaviour-preserving move) for the line budget.
export function usePosCharge(resumedOrder: Order | null, table: string | undefined) {
  // The charge before any waiver: a resumed tab keeps the one it was OPENED with
  // (re-reading the table would let an admin edit re-price a served bill); a new
  // sale takes it from the table currently selected.
  const tables = useTables();
  const entitledCharge = useMemo(() => {
    if (resumedOrder) return resumedOrder.chargeAmount ?? 0;
    const selected = table
      ? tables.data?.find((t) => t.tableNo === table)
      : undefined;
    return tableChargeOf(selected).amount;
  }, [resumedOrder, table, tables.data]);

  const chargeLabel = useMemo(() => {
    if (resumedOrder) return resumedOrder.chargeLabel ?? "";
    const selected = table
      ? tables.data?.find((t) => t.tableNo === table)
      : undefined;
    return tableChargeOf(selected).label;
  }, [resumedOrder, table, tables.data]);
  return { entitledCharge, chargeLabel };
}
