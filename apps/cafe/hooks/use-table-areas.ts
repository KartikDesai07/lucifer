"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { refreshAreasNow, useAreas } from "@/hooks/use-areas";
import { unknownAreaIdsKey } from "@/lib/table-areas";
import type { Table } from "@/types";

// A device whose 24 h areas copy predates an area made on another device would
// show those tables under "Other tables" until a reload. When tables point at
// area ids this device does not hold, the areas are re-read ONCE per distinct
// set of unknown ids. The Set is cleared when it reaches this many keys.
export const AREA_HEAL_TRIES_MAX = 20;

// MODULE scope on purpose: the Floor and the picker can mount together, and
// each one's effect must see the other's claim on the same key. The key is
// checked and added in the same synchronous step, before any read starts.
const triedHealKeys = new Set<string>();

// The areas list, healing itself when tables reference areas it does not hold.
// Use this wherever tables are grouped under areas.
export function useTableAreas(tables: readonly Table[] | undefined) {
  const qc = useQueryClient();
  const areas = useAreas();
  // "" while the list has not loaded (nothing can be unknown yet) or when every
  // table's area is known - either way, no heal.
  const unknownKey = unknownAreaIdsKey(tables ?? [], areas.data);

  useEffect(() => {
    if (unknownKey === "" || triedHealKeys.has(unknownKey)) return;
    if (triedHealKeys.size >= AREA_HEAL_TRIES_MAX) triedHealKeys.clear();
    triedHealKeys.add(unknownKey);
    refreshAreasNow(qc).catch(() => {
      // Offline: allow one more try the next time this key comes around.
      triedHealKeys.delete(unknownKey);
    });
  }, [unknownKey, qc]);

  return areas;
}
