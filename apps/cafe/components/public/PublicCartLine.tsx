import { Minus, Plus, Trash2 } from "lucide-react";

import { PUBLIC_ORDER_MAX_QTY } from "@pos/shared/public";
import { Button } from "@/components/ui/button";
import type { CartLine } from "@/components/public/public-cart-store";

// Extracted from PublicCart.tsx (SLICE 8) to keep that file under the repo's
// ~300-line budget — one cart line: name/variation, modifiers, instructions,
// a qty stepper and remove. Behavior unchanged from its original inline form.
export function PublicCartLine({
  line,
  onUpdateQty,
  onRemove,
}: {
  line: CartLine;
  onUpdateQty: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2 border-b pb-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {line.name}
          {line.variation ? ` (${line.variation})` : ""}
        </p>
        {line.modifiers.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">{line.modifiers.join(", ")}</p>
        )}
        {line.instructions && (
          <p className="truncate text-xs italic text-muted-foreground">{line.instructions}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onUpdateQty(line.lineId, line.qty - 1)}
          aria-label="Decrease quantity"
        >
          <Minus className="h-3 w-3" />
        </Button>
        <span className="w-6 text-center text-sm">{line.qty}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => onUpdateQty(line.lineId, line.qty + 1)}
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
          onClick={() => onRemove(line.lineId)}
          aria-label={`Remove ${line.name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
