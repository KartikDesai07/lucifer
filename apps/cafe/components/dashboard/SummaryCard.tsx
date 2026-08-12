import type { ComponentType } from "react";
import Link from "next/link";
import type { LucideProps } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Variant = "green" | "blue" | "red" | "amber" | "indigo" | "purple";

const VARIANTS: Record<Variant, { ring: string; icon: string }> = {
  green: { ring: "bg-green-50 text-green-600", icon: "text-green-600" },
  blue: { ring: "bg-blue-50 text-blue-600", icon: "text-blue-600" },
  red: { ring: "bg-red-50 text-red-600", icon: "text-red-600" },
  amber: { ring: "bg-amber-50 text-amber-600", icon: "text-amber-600" },
  indigo: { ring: "bg-indigo-50 text-indigo-600", icon: "text-indigo-600" },
  purple: { ring: "bg-purple-50 text-purple-600", icon: "text-purple-600" },
};

interface SummaryCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ComponentType<LucideProps>;
  variant: Variant;
  loading?: boolean;
  href?: string; // when set, the tile becomes a link (e.g. In-progress → open tabs)
}

// Single KPI tile for the dashboard overview row (CLAUDE.md §10 — speed-first,
// always shows a skeleton while data loads rather than a blank box).
export function SummaryCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant,
  loading,
  href,
}: SummaryCardProps) {
  const v = VARIANTS[variant];
  const card = (
    <Card className={cn("h-full", href && "transition-colors hover:bg-muted/40")}>
      <CardContent className="flex items-center gap-4 p-4">
        <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-lg", v.ring)}>
          <Icon className={cn("h-5 w-5", v.icon)} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          {loading ? (
            <Skeleton className="mt-1 h-7 w-20" />
          ) : (
            <p className="truncate text-2xl font-bold tracking-tight tabular-nums duration-500 animate-in fade-in">
              {value}
            </p>
          )}
          {subtitle && (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (!href) return card;
  return (
    <Link
      href={href}
      className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {card}
    </Link>
  );
}
