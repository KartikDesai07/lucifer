import { Skeleton } from "@/components/ui/skeleton";

// Route-level loading UI shown during navigation between dashboard pages
// (CLAUDE.md §10/§17 — every route shows a skeleton, never a blank screen).
// Generic header + list shape that fits most management pages.
export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="space-y-2 rounded-lg border p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
