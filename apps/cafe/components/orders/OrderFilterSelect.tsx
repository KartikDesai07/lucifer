"use client";

import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Sentinel for "no filter". Table names are free text now (CR1.1), so this must
// be a value no real table can carry — a cafe naming a table "all" would other-
// wise silently clear the filter. TABLE_NO_PATTERN requires an alphanumeric first
// character, so a leading underscore is unnameable by construction.
export const ALL = "__all__";

export interface FilterOption {
  value: string;
  label: string;
}

// One of the Orders page's filter dropdowns. `options` carry a separate label so
// a filter can show the word the rows show (payment "Unpaid" reads "Open") while
// the value sent to the list query stays the stored one.
export function FilterSelect({
  value,
  onChange,
  allLabel,
  ariaLabel,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  ariaLabel: string;
  options: FilterOption[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className={BRAND_CONTROL_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
