"use client";

import { useMemo, useState } from "react";

import {
  PRODUCT_ICONS,
  PRODUCT_ICON_GROUPS,
  PRODUCT_ICON_KEYS,
  type ProductIconGroup,
  type ProductIconKey,
} from "@pos/shared/product-icons";
import { productIconComponent } from "@/lib/product-icon-map";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface IconPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ProductIconKey | undefined;
  onChange: (key: ProductIconKey | undefined) => void;
}

function matchesQuery(key: ProductIconKey, q: string): boolean {
  if (q === "") return true;
  const meta = PRODUCT_ICONS[key];
  if (meta.label.toLowerCase().includes(q)) return true;
  return meta.keywords.some((k) => k.toLowerCase().includes(q));
}

// R19 — Dialog content is height-capped with the search box OUTSIDE the
// scrolling grid region (a full 67-icon grid plus groups is taller than an
// iPhone SE screen). 44px buttons, aria-pressed + aria-label per button, and
// a "Remove icon" action so a chosen icon can be cleared without leaving with
// an unrelated pick.
export function IconPicker({ open, onOpenChange, value, onChange }: IconPickerProps) {
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byGroup = new Map<ProductIconGroup, ProductIconKey[]>();
    for (const key of PRODUCT_ICON_KEYS) {
      if (!matchesQuery(key, q)) continue;
      const group = PRODUCT_ICONS[key].group;
      const list = byGroup.get(group) ?? [];
      list.push(key);
      byGroup.set(group, list);
    }
    return PRODUCT_ICON_GROUPS.filter((g) => (byGroup.get(g)?.length ?? 0) > 0).map((g) => ({
      group: g,
      keys: byGroup.get(g) ?? [],
    }));
  }, [search]);

  const pick = (key: ProductIconKey) => {
    onChange(key);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSearch("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[85dvh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose an icon</DialogTitle>
          <DialogDescription>Shown only when this item has no photo.</DialogDescription>
        </DialogHeader>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search icons…"
          aria-label="Search icons"
        />

        {value && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              onChange(undefined);
              onOpenChange(false);
            }}
          >
            Remove icon
          </Button>
        )}

        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {grouped.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No icons match.</p>
          ) : (
            <div className="space-y-4">
              {grouped.map(({ group, keys }) => (
                <div key={group}>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">{group}</p>
                  <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-7">
                    {keys.map((key) => {
                      const Icon = productIconComponent(key);
                      const selected = value === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={selected}
                          aria-label={PRODUCT_ICONS[key].label}
                          title={PRODUCT_ICONS[key].label}
                          onClick={() => pick(key)}
                          className={cn(
                            "grid h-11 w-11 place-items-center rounded-lg border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected && "border-primary bg-primary/10 text-primary",
                          )}
                        >
                          {Icon && <Icon className="h-5 w-5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
