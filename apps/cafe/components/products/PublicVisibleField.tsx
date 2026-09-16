"use client";

import { Switch } from "@/components/ui/switch";

interface PublicVisibleFieldProps {
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}

// "Show on public menu" control for `Product.publicVisible` (CR2.1's diner QR
// menu). The field is omit-empty on purpose — ABSENT means visible, so an
// existing cafe publishes its whole menu with no migration and the CSV import
// (which has no column for this) can never hide an item by omission. The
// switch mirrors that: ON reads `undefined` OR `true`; turning it OFF writes
// the real, meaningful `false`; turning it back ON writes `undefined` again
// rather than `true`, so a never-hidden product still stores no key at all.
//
// Pulled out of ProductFormSheet.tsx (already at the file's ~300-line budget)
// rather than inlined there — see that file's Controller usage.
export function PublicVisibleField({ value, onChange }: PublicVisibleFieldProps) {
  const visible = value === undefined || value === true;
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium">Show on public menu</p>
        <p className="text-xs text-muted-foreground">
          Hiding removes it from the public QR menu only — staff can still
          order it in the POS.
        </p>
      </div>
      <Switch
        aria-label="Show on public menu"
        checked={visible}
        onCheckedChange={(checked) => onChange(checked ? undefined : false)}
      />
    </div>
  );
}
