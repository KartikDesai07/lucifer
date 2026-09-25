import { ChevronRight } from "lucide-react";

import { inr, cn } from "@/lib/utils";
import { PUB_PRESS_CLASS, PUB_TONAL_CARD_CLASS } from "@/components/public/public-ui";
import { PublicStatusChip } from "@/components/public/PublicStatusChip";
import { itemNamesPreview, type HomeActiveOrder } from "@/components/public/public-home-data";

// CB-6D-A — the "this is happening right now" card: only drawn when the diner
// has an order the counter can still act on (pending/accepting). A pulsing
// dot next to the status chip is the at-a-glance "still live" signal; the
// chip itself carries the word so status is never colour/animation alone.

interface PublicActiveOrderCardProps {
  order: HomeActiveOrder;
  onOpen: () => void;
}

export function PublicActiveOrderCard({ order, onOpen }: PublicActiveOrderCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(PUB_TONAL_CARD_CLASS, PUB_PRESS_CLASS, "flex w-full items-center gap-4 p-5 text-left")}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <PublicStatusChip status={order.status} />
        </div>
        <p className="mt-1.5 text-base font-medium">Order #{order.code}</p>
        <p className="truncate text-sm text-muted-foreground">
          {itemNamesPreview(order.itemLines)}
        </p>
        <p className="mt-0.5 text-base font-semibold tabular-nums">{inr(order.total)}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
