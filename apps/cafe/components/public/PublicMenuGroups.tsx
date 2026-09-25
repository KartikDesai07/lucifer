// Presentational item-group list extracted out of PublicMenu.tsx (S1 split —
// that file had grown past the ~300-line cap). Behavior-identical to the
// inline JSX it replaces; same extraction discipline as PublicMenuHeader.tsx.
// S4 — group headings restyled onto the shared PUB_SECTION_TITLE_CLASS
// vocabulary and now carry an item count, matching every other section
// heading on the diner surface.
import {
  PublicMenuItem,
  type PublicMenuProduct,
} from "@/components/public/PublicMenuItem";
import { cn } from "@/lib/utils";
import type { PublicMenuGroup } from "@/components/public/public-menu-groups";
import { PUB_SECTION_TITLE_CLASS } from "@/components/public/public-ui";

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
            <h2 className={cn(PUB_SECTION_TITLE_CLASS, "mb-2 flex items-baseline gap-1.5")}>
              {group.name}
              <span className="text-xs font-normal text-muted-foreground">({group.items.length})</span>
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
