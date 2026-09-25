import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { inr, cn } from "@/lib/utils";
import { MONEY_BREAKDOWN_LINES, MONEY_NET_LABEL } from "@/lib/money-breakdown";
import type { MoneyBreakdown } from "@/types";

interface MoneyBreakdownCardProps {
  money?: MoneyBreakdown | null;
  net: number;
  loading?: boolean;
  caption: string;
}

// D10 — where the money came from and where it went, presented. Purely
// presentational (no hooks) so it needs no "use client" of its own; the
// dashboard/reports pages that import it are already client components.
export function MoneyBreakdownCard({
  money,
  net,
  loading,
  caption,
}: MoneyBreakdownCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bill breakdown</CardTitle>
        <CardDescription>{caption}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <>
            {MONEY_BREAKDOWN_LINES.map((line) => (
              <Skeleton key={line.key} className="h-5 w-full" />
            ))}
            <Skeleton className="h-5 w-full" />
          </>
        ) : (
          <>
            {MONEY_BREAKDOWN_LINES.map((line) => {
              const value = money?.[line.key] ?? 0;
              return (
                <div key={line.key} className="flex justify-between">
                  <span className={cn(line.key === "gross" && "font-medium")}>
                    {line.label}
                  </span>
                  <span className="tabular-nums">
                    {line.sign ? `${line.sign} ${inr(value)}` : inr(value)}
                  </span>
                </div>
              );
            })}
            <div className="mt-2 flex justify-between border-t pt-2 font-bold">
              <span>{MONEY_NET_LABEL}</span>
              <span className="tabular-nums">{inr(net)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
