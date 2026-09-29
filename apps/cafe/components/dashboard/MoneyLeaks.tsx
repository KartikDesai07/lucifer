import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BadgePercent, Ban, Gift, Undo2 } from "lucide-react";
import { inr } from "@/lib/utils";
import { plural } from "@/lib/dashboard/format";
import type { DashboardLeaks } from "@/types/dashboard";

// Where money did not come in: cancelled bills, dishes taken back off a tab,
// discounts and rewards. Four separate lines, never one total — a cancelled
// bill, a void and a discount are different events, and adding them up would
// invent a number nobody lost.

interface LeakRow {
  key: string;
  icon: LucideIcon;
  label: string;
  detail: string;
  amount: number;
  href?: string;
}

export const MONEY_LEAK_ROWS = 4;

function rowsOf(leaks: DashboardLeaks): LeakRow[] {
  return [
    {
      key: "cancelled",
      icon: Ban,
      label: "Cancelled orders",
      detail: plural(leaks.cancelled.count, "order"),
      amount: leaks.cancelled.value,
      href: "/orders?status=Cancelled",
    },
    { key: "voids", icon: Undo2, label: "Voided items", detail: plural(leaks.voids.qty, "item"), amount: leaks.voids.value },
    {
      key: "discounts",
      icon: BadgePercent,
      label: "Discounts given",
      detail: plural(leaks.discounts.orders, "order"),
      amount: leaks.discounts.amount,
    },
    { key: "rewards", icon: Gift, label: "Rewards given", detail: plural(leaks.rewards.orders, "order"), amount: leaks.rewards.amount },
  ];
}

export function MoneyLeaks({ leaks }: { leaks: DashboardLeaks }) {
  return (
    <ul className="flex flex-col divide-y divide-brand-rule/70">
      {rowsOf(leaks).map((r) => {
        const body = (
          <>
            <r.icon className="h-4 w-4 shrink-0 text-brand-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-brand-ink">{r.label}</span>
              <span className="block text-[12px] text-brand-muted">{r.detail}</span>
            </span>
            <span className="shrink-0 text-[13.5px] font-semibold text-brand-ink">{inr(r.amount)}</span>
          </>
        );
        return (
          <li key={r.key}>
            {r.href ? (
              <Link
                href={r.href}
                className="-mx-2 flex min-h-[52px] items-center gap-3 rounded-md px-2 hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
              >
                {body}
              </Link>
            ) : (
              <div className="flex min-h-[52px] items-center gap-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
