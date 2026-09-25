"use client";

import { useState } from "react";
import { ChevronLeft, ClipboardList } from "lucide-react";

import type { PublicGstConfig, PublicStatusItem } from "@pos/shared/public";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import {
  PUB_EYEBROW_CLASS,
  PUB_HOME_STACK_CLASS,
  PUB_SCREEN_TITLE_CLASS,
  PUB_SECTION_HEADING_CLASS,
  PUB_TONAL_CARD_CLASS,
  PUB_TINT_CLASS,
  PUB_PILL_BUTTON_CLASS,
} from "@/components/public/public-ui";
import {
  groupOrdersByDate,
  partitionPending,
  splitLiveOrders,
  type PastOrder,
} from "@/components/public/public-orders-grouping";
import { pickActiveOrders } from "@/components/public/public-home-data";
import { PublicOrderRow } from "@/components/public/PublicOrderRow";
import { PublicOrderBillView } from "@/components/public/PublicOrderBillView";
import { PublicActiveOrderCard } from "@/components/public/PublicActiveOrderCard";
import { cn } from "@/lib/utils";

// CB-4 — the diner's "My Orders" tab.
//
// Reads the DEVICE's own order-code history (localStorage, written at submit
// time), not a server-side per-account list — the codes are already there,
// each one is capability-scoped (holding the code IS the authorization, the
// same model the status page uses), and it works for a diner who has never
// made an account. An account-keyed server history is a strictly larger
// change and belongs with the redemption work.
//
// CB-6D-B (rewritten CB-6C) — Home vocabulary (calm, whitespace, ONE primary
// action per screen), and live orders surface on top: any order the counter
// can still act on renders as a PublicActiveOrderCard under "Live now"
// (never twice, and never duplicated into the day groups below it), so the
// owner's "running order upar, purane din-wise" split reads at a glance
// instead of being buried in a Today group with everything else.
//
// F8 (CB-6D-B review fix, LOW) — the first painted frame used to seed every
// row unresolved, so it briefly listed every order under "More orders" even
// though most rows were just mid-fetch. The skeleton gate now also covers
// "orders exist but every one is still pending", and the still-resolving
// rows render as trailing skeleton placeholders (partitionPending) instead
// of grouped-and-unresolved rows.
export type { PastOrder };

interface PublicMyOrdersTabProps {
  orders: PastOrder[] | null; // from the shell's useMyOrders (null = loading)
  initialOpenCode: string | null; // Home's active card deep-link; local state seeds from it
  signedIn: boolean;
  orderingAllowed: boolean;
  gst: PublicGstConfig;
  onSignIn: () => void;
  onBrowseMenu: () => void;
  // "Order this again" — the shell owns the cart write and the tab switch,
  // because the cart lives in PublicOrderFlow's tree, not this one.
  onRepeat: (items: PublicStatusItem[]) => void;
}

export function PublicMyOrdersTab({
  orders,
  initialOpenCode,
  signedIn,
  orderingAllowed,
  gst,
  onSignIn,
  onBrowseMenu,
  onRepeat,
}: PublicMyOrdersTabProps) {
  const [openCode, setOpenCode] = useState<string | null>(initialOpenCode);

  // F8 (CB-6D-B review fix, LOW) — `orders === null` alone missed the first
  // painted frame, where every row is already seeded `{ data: null, pending:
  // true }`: that frame would otherwise list every order as an unresolved
  // Link under "More orders" before any fetch could settle. The
  // `orders.length > 0` guard is MANDATORY: `[].every(...)` is vacuously
  // true, so without it a diner with NO orders at all would skeleton
  // forever instead of reaching the guided empty state below.
  if (orders === null || (orders.length > 0 && orders.every((o) => o.pending))) {
    return (
      <div className={PUB_HOME_STACK_CLASS}>
        <Skeleton className="h-24 w-full rounded-3xl" />
        <Skeleton className="h-24 w-full rounded-3xl" />
      </div>
    );
  }

  const openOrder = openCode ? orders.find((o) => o.code === openCode) ?? null : null;

  if (openOrder?.data) {
    return (
      <div className={PUB_HOME_STACK_CLASS}>
        <Button
          variant="ghost"
          className={cn(PUBLIC_TOUCH_TARGET_CLASS, "gap-1 px-2 -ml-2")}
          onClick={() => setOpenCode(null)}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <PublicOrderBillView
          data={openOrder.data}
          gst={gst}
          orderingAllowed={orderingAllowed}
          onRepeat={onRepeat}
        />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className={PUB_HOME_STACK_CLASS}>
        <div className={cn(PUB_TONAL_CARD_CLASS, "flex flex-col items-center p-6 text-center")}>
          <div className={cn(PUB_TINT_CLASS, "grid h-12 w-12 place-items-center rounded-full")}>
            <ClipboardList className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className={cn(PUB_SECTION_HEADING_CLASS, "mt-3")}>No orders yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Order from the menu and it will show up here</p>
          <Button className={cn(PUB_PILL_BUTTON_CLASS, PUBLIC_TOUCH_TARGET_CLASS, "mt-5")} onClick={onBrowseMenu}>
            Browse the menu
          </Button>
          {!signedIn && (
            <Button
              variant="ghost"
              className={cn(PUB_PILL_BUTTON_CLASS, PUBLIC_TOUCH_TARGET_CLASS, "mt-2")}
              onClick={onSignIn}
            >
              Sign in
            </Button>
          )}
        </div>
      </div>
    );
  }

  const { live, rest } = splitLiveOrders(orders);
  const liveCards = pickActiveOrders(live);
  // F8 — `rest` can still hold rows whose fetch hasn't settled; those group
  // as trailing skeleton rows instead of being grouped by day (they have no
  // createdAt to group by yet).
  const { settled, pendingCount } = partitionPending(rest);
  const groups = groupOrdersByDate(settled, new Date());

  return (
    <div className={PUB_HOME_STACK_CLASS}>
      <p className={PUB_SCREEN_TITLE_CLASS}>Your orders</p>

      {liveCards.length > 0 && (
        <div className="space-y-3">
          <p className={PUB_SECTION_HEADING_CLASS}>Live now</p>
          {liveCards.map((card) => (
            <PublicActiveOrderCard key={card.code} order={card} onOpen={() => setOpenCode(card.code)} />
          ))}
        </div>
      )}

      {groups.map((group) => (
        <div key={group.key} className="space-y-2">
          <p className={PUB_EYEBROW_CLASS}>{group.label}</p>
          <div className={cn(PUB_TONAL_CARD_CLASS, "divide-y divide-border/60 overflow-hidden")}>
            {group.orders.map((order) => (
              <PublicOrderRow key={order.code} order={order} onOpen={setOpenCode} />
            ))}
          </div>
        </div>
      ))}

      {Array.from({ length: pendingCount }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-3xl" />
      ))}
    </div>
  );
}
