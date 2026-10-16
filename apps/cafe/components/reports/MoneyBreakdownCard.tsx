import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { inr, cn } from "@/lib/utils";
import { STATUS_CLASSES } from "@/lib/ui";
import { MONEY_BREAKDOWN_LINES, MONEY_NET_LABEL } from "@/lib/money-breakdown";
import type { MoneyBreakdown } from "@/types";

interface MoneyBreakdownCardProps {
  money?: MoneyBreakdown | null;
  net: number;
  loading?: boolean;
  caption: string;
  className?: string;
}

// The receipt's torn lower edge: everything above the last EDGE_PX, plus a row
// of downward teeth (one EDGE_PX-tall triangle per 2 × EDGE_PX tile, repeated
// across). A plain CSS mask of gradients, sent with the -webkit- prefix that
// Android WebView 109 needs (unprefixed `mask` arrived in Chromium 120).
const EDGE_PX = 8;
const RECEIPT_EDGE_MASK =
  `linear-gradient(#000 0 0) top / 100% calc(100% - ${EDGE_PX}px) no-repeat, ` +
  `conic-gradient(from -45deg at bottom, transparent, #000 1deg 89deg, transparent 90deg) bottom / ${EDGE_PX * 2}px ${EDGE_PX}px repeat-x`;

// Deductions read in the "bad" ink, additions in the muted grey (the mock-up's receipt).
const AMOUNT_CLASS: Partial<Record<keyof MoneyBreakdown, string>> = {
  discount: STATUS_CLASSES.bad.ink,
  reward: STATUS_CLASSES.bad.ink,
  gst: "text-muted-foreground",
  charges: "text-muted-foreground",
};

const RULE_CLASS = "border-t-[1.5px] border-dashed border-border";

// D10 — where the money came from and where it went, drawn as a receipt
// (owner's mock-up): each line with a dotted leader to its amount, a dashed
// rule, the net, and a zig-zag lower edge. Purely presentational (no hooks) so
// it needs no "use client" of its own; the dashboard page that imports it is
// already a client component.
export function MoneyBreakdownCard({
  money,
  net,
  loading,
  caption,
  className,
}: MoneyBreakdownCardProps) {
  return (
    <Card
      className={cn(
        "flex min-w-0 flex-col rounded-b-none rounded-t-2xl border-b-0 shadow-none",
        className,
      )}
      style={{ WebkitMask: RECEIPT_EDGE_MASK, mask: RECEIPT_EDGE_MASK }}
    >
      <CardHeader className="space-y-1 px-5 pb-0 pt-5 sm:px-[22px]">
        <CardTitle className="text-[15px] font-semibold leading-tight">Bill breakdown</CardTitle>
        <CardDescription className="text-[12.5px] leading-tight text-subtle-foreground">{caption}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col px-5 pb-[34px] pt-0 sm:px-[22px]">
        <div aria-hidden className={cn(RULE_CLASS, "mb-1.5 mt-3.5")} />
        {loading ? (
          <>
            {MONEY_BREAKDOWN_LINES.map((line) => (
              <Skeleton key={line.key} className="my-[7px] h-5 w-full" />
            ))}
            <div className="mt-auto">
              <div aria-hidden className={cn(RULE_CLASS, "mb-3 mt-1.5")} />
              <Skeleton className="h-7 w-full" />
            </div>
          </>
        ) : (
          <>
            {MONEY_BREAKDOWN_LINES.map((line) => {
              const value = money?.[line.key] ?? 0;
              return (
                <div key={line.key} className="flex items-baseline gap-2 py-[7px] text-[13.5px] leading-5">
                  <span className={cn(line.key === "gross" && "font-medium")}>
                    {line.label}
                  </span>
                  <span aria-hidden className="min-w-3 flex-1 border-b border-dotted border-subtle-foreground/60" />
                  <span className={cn("tabular-nums", AMOUNT_CLASS[line.key])}>
                    {line.sign ? `${line.sign} ${inr(value)}` : inr(value)}
                  </span>
                </div>
              );
            })}
            {/* The total sits at the foot when the receipt stands taller than its lines. */}
            <div className="mt-auto">
              <div aria-hidden className={cn(RULE_CLASS, "mb-3 mt-1.5")} />
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-semibold">{MONEY_NET_LABEL}</span>
                <span className="text-[22px] font-semibold leading-7 tracking-[-0.02em] tabular-nums">{inr(net)}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
