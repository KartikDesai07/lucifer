import { Minus, Plus, Trash2 } from "lucide-react";

import { PUBLIC_ORDER_MAX_QTY, type PublicStatusItem } from "@pos/shared/public";
import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// The status page's own item row, extracted out of PublicStatusItems.tsx
// (CR2.2d split D4) to keep that component under this repo's ~300-line
// budget — verbatim move, no behavior change.
export function StatusItemRow({
  line,
  controls,
}: {
  line: PublicStatusItem;
  controls?: { onIncrement: () => void; onDecrement: () => void; onRemove: () => void };
}) {
  return (
    <div className="p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-sm font-medium">
          {line.name}
          {line.variation ? ` (${line.variation})` : ""} × {line.qty}
        </p>
        <span className="shrink-0 text-sm font-medium tabular-nums">{inr(line.price * line.qty)}</span>
      </div>
      {line.modifiers.length > 0 && (
        <p className="truncate text-xs text-muted-foreground">{line.modifiers.join(", ")}</p>
      )}
      {line.instructions && <p className="truncate text-xs italic text-muted-foreground">{line.instructions}</p>}
      {controls && (
        <div className="mt-1 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={controls.onDecrement}
            aria-label="Decrease quantity"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <span className="w-5 text-center text-sm tabular-nums">{line.qty}</span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={controls.onIncrement}
            aria-label="Increase quantity"
            disabled={line.qty >= PUBLIC_ORDER_MAX_QTY}
            title={line.qty >= PUBLIC_ORDER_MAX_QTY ? `Maximum ${PUBLIC_ORDER_MAX_QTY} per item` : undefined}
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={controls.onRemove}
            aria-label={`Remove ${line.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
