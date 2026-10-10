import { Badge } from "@/components/ui/badge";
import { KITCHEN_NO_KOT_TAG, skipsKitchenTicket } from "@/lib/kitchen-lines";
import type { Category, Product } from "@/types";

// True when this item never goes on a kitchen ticket: its own choice wins (true = never, false = always), and
// an item with no choice follows its category (the same rule the server stamps lines with, lib/kitchen-lines.ts).
export function itemSkipsKitchen(product: Product, categoryMap: ReadonlyMap<string, Category>): boolean {
  return skipsKitchenTicket({ noKot: product.noKot ?? categoryMap.get(product.categoryId)?.noKot });
}

// The small "No KOT" tag on a Categories row and an Items row (owner F5). Renders nothing for a kitchen item.
export function NoKotTag({ skips }: { skips: boolean }) {
  if (!skips) return null;
  return (
    <Badge variant="outline" className="text-[10px]">
      {KITCHEN_NO_KOT_TAG}
    </Badge>
  );
}
