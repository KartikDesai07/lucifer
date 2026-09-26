"use client";

import { AlertTriangle, CheckCircle2, Clock, PackageCheck, QrCode } from "lucide-react";

import { kitchenAgeBand, type KitchenRow } from "@/lib/kitchen-board";
import type { KitchenOrderCard as KitchenOrderCardData } from "@/lib/kitchen-cards";
import { Button } from "@/components/ui/button";
import { KitchenLineCard } from "@/components/kitchen/KitchenLineCard";
import { cn } from "@/lib/utils";

// P4-B — one ORDER's card. Every status channel (destination, self-order,
// age, ready state) pairs an icon + a colour + literal text, never colour
// alone (cafe.md UI rule); no emoji anywhere, lucide only.
const AGE_ICON = {
  none: null,
  Clock,
  AlertTriangle,
} as const;

interface KitchenOrderCardProps {
  card: KitchenOrderCardData;
  now: Date;
  onToggleLine: (line: KitchenRow, done: boolean) => void;
  onReady: (card: KitchenOrderCardData) => void;
  lineInFlight: (line: KitchenRow) => boolean;
  readyInFlight: boolean;
}

export function KitchenOrderCard({
  card,
  now,
  onToggleLine,
  onReady,
  lineInFlight,
  readyInFlight,
}: KitchenOrderCardProps) {
  const band = kitchenAgeBand(card.cardFiredAt, now);
  const AgeIcon = AGE_ICON[band.icon];
  const ageMinutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(card.cardFiredAt).getTime()) / 60_000),
  );
  const ageText = `${card.cardFiredAtApprox ? "~" : ""}${ageMinutes}m`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      {/* HEADER — destination is the biggest thing on the card: a cook needs
          to know WHERE before WHAT. Parcel and table are mutually exclusive,
          never colour alone. */}
      {card.parcel ? (
        <div className="flex items-center gap-2 text-2xl font-black text-orange-600 xl:text-3xl">
          <PackageCheck className="h-7 w-7 shrink-0" />
          PARCEL
        </div>
      ) : (
        <div className="text-2xl font-black xl:text-3xl">{card.tableLabel}</div>
      )}

      {/* Secondary header row */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{card.orderNo}</span>
        {card.ticketNumbers.map((n) => (
          <span key={n}>#{n}</span>
        ))}
        {card.selfOrder && (
          <span className="flex items-center gap-1 text-blue-600">
            <QrCode className="h-3.5 w-3.5" />
            Self-order
          </span>
        )}
        <span
          className={cn(
            "flex items-center gap-1",
            band.key === "late" && "font-semibold text-red-600",
            band.key === "warn" && "text-amber-600",
          )}
          title={card.cardFiredAtApprox ? "approximate — fired before age tracking" : undefined}
        >
          {AgeIcon && <AgeIcon className="h-3.5 w-3.5" />}
          {ageText}
          {band.key === "late" && " Late"}
        </span>
      </div>

      {/* BODY */}
      <div className="space-y-2">
        {card.lines.map((line) => (
          <KitchenLineCard
            key={line.id}
            row={line}
            now={now}
            onToggle={onToggleLine}
            pending={lineInFlight(line)}
          />
        ))}
      </div>

      {/* PROGRESS — literal text, never a bare colour bar */}
      <div className="text-sm font-medium">
        {card.doneCount}/{card.totalCount} done
      </div>

      {card.allDone && (
        <div className="flex items-center gap-1.5 text-sm font-semibold text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          Ready to serve
        </div>
      )}

      {/* FOOTER — always rendered, disabled until allDone; a button that only
          appears at the end is easy to miss on a wall. */}
      <Button
        type="button"
        className="min-h-12 w-full text-base font-semibold"
        disabled={!card.allDone || readyInFlight}
        onClick={() => onReady(card)}
      >
        {card.allDone ? "Ready — clear from board" : "Tick every line first"}
      </Button>
    </div>
  );
}
