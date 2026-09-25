import { Skeleton } from "@/components/ui/skeleton";

// S4 — the menu tab's loading skeleton, extracted out of PublicMenu.tsx so
// that file stays under the repo's 300-line file budget after the Zomato-tile
// redesign + offers strip landed. Behavior-identical to the block it replaces:
// a header-height bar, a search-bar-height bar, then a handful of tile-height
// bars — never invents real numbers, just holds the shape while the fetch
// resolves.
const SKELETON_TILE_COUNT = 5;

export function PublicMenuSkeleton() {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-pub-pad">
      <Skeleton className="h-12 w-40" />
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: SKELETON_TILE_COUNT }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </main>
  );
}
