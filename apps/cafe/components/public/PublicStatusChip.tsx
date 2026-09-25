import { CircleCheck, CircleX, Clock } from "lucide-react";

import type { PublicOrderRequestStatusData } from "@pos/shared/public";
import { cn } from "@/lib/utils";
import { PUB_CHIP_CLASS } from "@/components/public/public-ui";

// CB-6C — the ONE home for how a diner-visible order status reads: its plain
// English word, its icon and its chip colour. Home's active-order card, the
// Orders list rows and the bill view all render through this Record, so a
// status can never be spelled two ways on two screens (three files used to
// carry their own copies).
//
// EXHAUSTIVE by construction — a new request status fails tsc here rather
// than rendering a raw enum value to a diner. Never colour alone: every chip
// carries an icon AND the word (a cafe's accent is owner-configurable and can
// sit close to the muted tone on a sunlit cheap phone).

export type PublicOrderStatus = PublicOrderRequestStatusData["status"];

interface StatusChipMeta {
  word: string;
  className: string;
  Icon: typeof Clock;
}

// F2 (CB-6D-B review fix, MEDIUM) — "accepting" used to speak "Being
// prepared" (ChefHat, solid primary) while packages/shared/src/public.ts and
// PublicStatusTimeline render "accepting" IDENTICALLY to "pending" ("the
// counter is confirming it" — the kitchen hasn't started yet). The chip and
// the timeline said opposite things on the same receipt. Fix: "accepting"
// shares "pending"'s exact word/className/Icon via ONE shared meta object,
// so the two can never drift apart again.
const WAITING_META: StatusChipMeta = { word: "Waiting for the counter", className: "bg-primary/10 text-primary", Icon: Clock };

export const STATUS_CHIP_META: Record<PublicOrderStatus, StatusChipMeta> = {
  pending: WAITING_META,
  accepting: WAITING_META,
  accepted: { word: "Accepted", className: "bg-muted text-foreground", Icon: CircleCheck },
  rejected: { word: "Cancelled", className: "bg-destructive/10 text-destructive", Icon: CircleX },
};

export function statusWord(status: PublicOrderStatus): string {
  return STATUS_CHIP_META[status].word;
}

// "Active" = the counter can still act on it. Both pending (waiting for staff)
// and accepting (staff have opened it) qualify; a settled order never does.
export function isActiveOrderStatus(status: PublicOrderStatus): status is "pending" | "accepting" {
  return status === "pending" || status === "accepting";
}

interface PublicStatusChipProps {
  status: PublicOrderStatus;
  className?: string;
}

export function PublicStatusChip({ status, className }: PublicStatusChipProps) {
  const { word, className: tone, Icon } = STATUS_CHIP_META[status];
  return (
    <span className={cn(PUB_CHIP_CLASS, tone, className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {word}
    </span>
  );
}
