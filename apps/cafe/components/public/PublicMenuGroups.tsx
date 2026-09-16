// Presentational item-group list extracted out of PublicMenu.tsx (S1 split —
// that file had grown past the ~300-line cap). Behavior-identical to the
// inline JSX it replaces; same extraction discipline as PublicMenuHeader.tsx.
import {
  PublicMenuItem,
  type PublicMenuProduct,
} from "@/components/public/PublicMenuItem";
import type { PublicMenuGroup } from "@/components/public/public-menu-groups";

interface PublicMenuGroupsProps {
  groups: PublicMenuGroup[];
  // Heading only shows while browsing "All" — a single selected category's
  // one group renders its items with no heading above them.
  showHeadings: boolean;
  qtyByProduct: Record<string, number>;
  onIncrement: (product: PublicMenuProduct) => void;
  onDecrement: (productId: string) => void;
}

export function PublicMenuGroups({
  groups,
  showHeadings,
  qtyByProduct,
  onIncrement,
  onDecrement,
}: PublicMenuGroupsProps) {
  return (
    <div className="mt-4 space-y-pub-gap">
      {groups.map((group) => (
        <section key={group.name}>
          {showHeadings && (
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {group.name}
            </h2>
          )}
          <div className="space-y-pub-gap">
            {group.items.map((item) => (
              <PublicMenuItem
                key={item.id}
                product={item}
                qty={qtyByProduct[item.id] ?? 0}
                onIncrement={onIncrement}
                onDecrement={onDecrement}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
