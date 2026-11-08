import { Skeleton } from "@/components/ui/skeleton";
import type { SkeletonKind } from "@/lib/nav-skeleton";

// The screen a tap opens, drawn in the tap's own frame (P2 N1) while the real one loads: the same quiet shapes for
// every kind (the kit's Skeleton, whose pulse is opacity only), a title bar over its line, then the body. "list" is the
// route skeleton the dashboard used to show (the old app/(dashboard)/loading.tsx), and still the default; "board" is a
// grid of tiles (Home, the floor, the kitchen, the POS, Now serving); "form" is a column of field cards (Settings,
// Printers). lib/nav-skeleton.ts picks the kind per route.

function ListBody() {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function BoardBody() {
  return (
    <div className="grid grid-cols-2 gap-3 tab:grid-cols-3 desk:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-lg" />
      ))}
    </div>
  );
}

function FormBody() {
  return (
    <div className="max-w-2xl space-y-4">
      {Array.from({ length: 2 }).map((_, card) => (
        <div key={card} className="space-y-4 rounded-lg border p-4">
          <Skeleton className="h-5 w-40" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function NavSkeleton({ kind }: { kind: SkeletonKind }) {
  return (
    <div data-ui="nav-skeleton" data-kind={kind} aria-busy="true" className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      {kind === "board" ? <BoardBody /> : kind === "form" ? <FormBody /> : <ListBody />}
    </div>
  );
}
