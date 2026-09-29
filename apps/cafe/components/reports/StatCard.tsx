import { DASH_CARD_CLASS, BrandSkeleton } from "@/components/dashboard/DashCard";
import { cn } from "@/lib/utils";

// A plain figure card — label, value, an optional sub-line — for numbers that
// have no period-over-period comparison (Payments/Dues live totals). Same
// shell as KpiCard but without the delta row.
interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
  /** The figure is still the previous period's while a new one loads. */
  updating?: boolean;
}

export function StatCard({ label, value, sub, loading, updating }: StatCardProps) {
  return (
    <section className={cn(DASH_CARD_CLASS, "flex flex-col gap-1.5")} aria-busy={loading || updating}>
      <h3 className="text-[13px] font-medium text-brand-muted">{label}</h3>
      {loading ? (
        <div>
          <BrandSkeleton className="h-8 w-28" />
          <div className="mt-1.5 min-h-4">
            <BrandSkeleton className="h-4 w-32" />
          </div>
        </div>
      ) : (
        <div className={cn("transition-opacity duration-200", updating && "opacity-55")}>
          <p className="text-[26px] font-semibold leading-8 tracking-[-0.01em] text-brand-ink">{value}</p>
          <p className="mt-1 min-h-4 text-[12px] leading-4 text-brand-muted">{sub}</p>
        </div>
      )}
    </section>
  );
}
