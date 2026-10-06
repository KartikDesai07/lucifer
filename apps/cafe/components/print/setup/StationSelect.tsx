"use client";

import type { StationConfig } from "@pos/shared/print-printers";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface StationSelectProps {
  id: string;
  /** A listed station's id, or "" for the inherited one. */
  value: string;
  onChange: (value: string) => void;
  stations: readonly StationConfig[];
  /** What "" means here: the default station (a category), or the category's station (an item). */
  inheritLabel: string;
}

// The Select's own value for "": an empty string is not a value a Select item may carry.
const INHERIT = "inherit";

// Printing redesign, Phase 2 Session 2D (spec §6.2, §11): a category's or an item's "Kitchen station". "" keeps the
// inherited one (absent on the record, so it follows a moved default or the category's own choice). A saved id not
// in the list (still loading, or gone) shows as inherited and is kept as it is until changed, as routing reads it
// (an unknown station falls back the same way).
export function StationSelect({ id, value, onChange, stations, inheritLabel }: StationSelectProps) {
  const shown = value !== "" && stations.some((station) => station.id === value) ? value : INHERIT;
  return (
    <Select value={shown} onValueChange={(next) => onChange(next === INHERIT ? "" : next)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
        {stations.map((station) => (
          <SelectItem key={station.id} value={station.id}>
            {station.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
