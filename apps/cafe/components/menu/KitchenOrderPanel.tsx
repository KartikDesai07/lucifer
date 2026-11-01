"use client";

import { useState } from "react";
import { useIsMutating } from "@tanstack/react-query";

import { CATEGORY_KEYS, useClearKitchenOrder } from "@/hooks/use-categories";
import { CategoryArrangeList } from "@/components/menu/CategoryArrangeList";
import { kitchenOrderIsSet } from "@/lib/category-arrange";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Category, Product } from "@/types";

type OrderView = "menu" | "kitchen";

const VIEW_OPTIONS: { value: OrderView; label: string }[] = [
  { value: "menu", label: "Menu order" },
  { value: "kitchen", label: "Kitchen order" },
];

interface KitchenOrderPanelProps {
  categories: Category[];
  activeProducts: Product[];
  archivedProducts: Product[];
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
}

// The Categories arrangement area: the menu order (POS + QR menu) or the
// kitchen order (the order dishes print on every kitchen ticket). Both are the
// same drag list over a different arrangement.
export function KitchenOrderPanel(props: KitchenOrderPanelProps) {
  const [view, setView] = useState<OrderView>("menu");
  const clear = useClearKitchenOrder();
  // A drag save in flight (or a clear) blocks Clear: the two must never cross.
  const arranging = useIsMutating({ mutationKey: CATEGORY_KEYS.arrange }) > 0;
  const isSet = kitchenOrderIsSet(props.categories);

  return (
    <div className="space-y-3">
      <SegmentedControl label="Which order" value={view} options={VIEW_OPTIONS} onChange={setView} />
      {view === "menu" ? (
        <CategoryArrangeList list="menu" {...props} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-muted-foreground">
              <p>Kitchen order: dishes print on the kitchen ticket in this order. Drag to arrange.</p>
              {!isSet && <p>Not set: kitchen tickets print in the order items were added.</p>}
            </div>
            {isSet && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={arranging}>
                    Clear kitchen order
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear the kitchen order?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Kitchen tickets go back to printing items in the order they were added. Tickets already
                      printed are not changed.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => clear.mutate()}>Clear</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <CategoryArrangeList key="kitchen" list="kitchen" {...props} />
        </>
      )}
    </div>
  );
}
