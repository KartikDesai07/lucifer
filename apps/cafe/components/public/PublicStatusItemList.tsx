import { type PublicStatusItem } from "@pos/shared/public";
import { StatusItemRow } from "@/components/public/PublicStatusItemRow";
import { type DraftLine } from "@/components/public/public-status-edit";

interface PublicStatusItemListProps {
  editable: boolean;
  lines: PublicStatusItem[] | DraftLine[];
  onIncrement: (lineId: string, qty: number) => void;
  onDecrement: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
}

// The bordered/divided item list on the diner's status page, extracted out of
// PublicStatusItems.tsx to keep that component under this repo's ~300-line
// budget — verbatim move, no behavior change. Render-only: the draft/reseed
// state machine (draft lines, seed refs, dirty, handleSave) stays in the
// parent; this component only maps `lines` to rows and wires the qty/remove
// callbacks it is handed.
export function PublicStatusItemList({ editable, lines, onIncrement, onDecrement, onRemove }: PublicStatusItemListProps) {
  return (
    <div className="divide-y rounded-lg border">
      {editable && lines.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No items in this order.</p>
      ) : (
        lines.map((line, i) => (
          <StatusItemRow
            key={editable ? (line as DraftLine).lineId : `${line.productId}-${i}`}
            line={line}
            controls={
              editable
                ? {
                    onIncrement: () => onIncrement((line as DraftLine).lineId, line.qty + 1),
                    onDecrement: () => onDecrement((line as DraftLine).lineId, line.qty - 1),
                    onRemove: () => onRemove((line as DraftLine).lineId),
                  }
                : undefined
            }
          />
        ))
      )}
    </div>
  );
}
