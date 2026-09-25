"use client";

import { ChevronRight, ClipboardList, ReceiptText } from "lucide-react";

import { inr, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PUB_HOME_STACK_CLASS, PUB_ROW_BUTTON_CLASS, PUB_TINT_CLASS, PUB_TONAL_CARD_CLASS } from "@/components/public/public-ui";
import { PublicStatusChip } from "@/components/public/PublicStatusChip";
import { PublicHomeHero } from "@/components/public/PublicHomeHero";
import { PublicDinerBanners } from "@/components/public/PublicDinerBanners";
import { PublicActiveOrderCard } from "@/components/public/PublicActiveOrderCard";
import { PublicLoyaltyGlance } from "@/components/public/PublicLoyaltyGlance";
import { PublicPopularRow } from "@/components/public/PublicPopularRow";
import type { HomeActiveOrder, HomeLastOrder } from "@/components/public/public-home-data";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import type { DinerStampCard } from "@/lib/diner-loyalty";
import type { PublicDinerBanner } from "@pos/shared/public-diner";
import type { LogoPlacement } from "@pos/shared/appearance";

// CB-6D-A — the diner Home tab, redesigned Starbucks/premium-cafe style (the
// owner's own direction: calm, lots of whitespace, the stamp card as the
// hero) for the TAB (never the QR-scan screen — Menu stays the landing tab).
// Presentational only, like the other tabs: the shell resolves every prop
// here (menu snapshot, accounts fetch, the lifted orders fan-out) and this
// file renders from them alone — it never calls fetch(.
//
// Sections render in a fixed order — header, stamp card, live order,
// announcements, daily offers, popular here, order again, your orders — each
// one skipping itself when it has nothing to show, so a brand-new cafe with
// no orders, no rewards and no banners still gets a clean, uncluttered Home
// rather than a wall of empty sections.

interface PublicHomeTabProps {
  cafeName: string;
  chrome: { heroImage: string; logoPlacement: LogoPlacement };
  signedIn: boolean;
  dinerName: string;
  loyaltyEnabled: boolean;
  loading: boolean;
  stampCard: DinerStampCard | null;
  banners: readonly PublicDinerBanner[];
  activeOrder: HomeActiveOrder | null;
  lastOrder: HomeLastOrder | null;
  offerItems: PublicMenuProduct[];
  popularItems: PublicMenuProduct[];
  orderingAllowed: boolean;
  onBrowseMenu: () => void;
  onRepeatLast: () => void;
  onOpenOrders: () => void;
  onOpenActiveOrder: () => void;
  onOpenRewards: () => void;
  onSignIn: () => void;
  onQuickAdd: (product: PublicMenuProduct) => void;
}

export function PublicHomeTab({
  cafeName,
  chrome,
  signedIn,
  dinerName,
  loyaltyEnabled,
  loading,
  stampCard,
  banners,
  activeOrder,
  lastOrder,
  offerItems,
  popularItems,
  orderingAllowed,
  onBrowseMenu,
  onRepeatLast,
  onOpenOrders,
  onOpenActiveOrder,
  onOpenRewards,
  onSignIn,
  onQuickAdd,
}: PublicHomeTabProps) {
  const showOrderAgain = orderingAllowed && lastOrder && lastOrder.code !== activeOrder?.code;

  return (
    <div className={PUB_HOME_STACK_CLASS}>
      <PublicHomeHero cafeName={cafeName} chrome={chrome} signedIn={signedIn} dinerName={dinerName} />

      {loyaltyEnabled && (
        <PublicLoyaltyGlance
          signedIn={signedIn}
          loading={loading}
          stampCard={stampCard}
          onSignIn={onSignIn}
          onOpenRewards={onOpenRewards}
        />
      )}

      {activeOrder && <PublicActiveOrderCard order={activeOrder} onOpen={onOpenActiveOrder} />}

      <PublicDinerBanners banners={banners} />

      <PublicPopularRow title="Daily offers" items={offerItems} onQuickAdd={onQuickAdd} onBrowseMenu={onBrowseMenu} />

      <PublicPopularRow title="Popular here" items={popularItems} onQuickAdd={onQuickAdd} onBrowseMenu={onBrowseMenu} />

      {showOrderAgain && (
        <div className={cn(PUB_TONAL_CARD_CLASS, "flex items-center gap-4 p-5")}>
          <span className={cn(PUB_TINT_CLASS, "grid h-10 w-10 shrink-0 place-items-center rounded-full")}>
            <ReceiptText className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium">Order again</p>
            <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
              {lastOrder.itemCount} {lastOrder.itemCount === 1 ? "item" : "items"} · {inr(lastOrder.total)}
              <PublicStatusChip status={lastOrder.status} />
            </p>
          </div>
          <Button variant="outline" className="h-11 shrink-0 rounded-full" onClick={onRepeatLast}>
            Repeat
          </Button>
        </div>
      )}

      {!activeOrder && (
        <button
          type="button"
          onClick={onOpenOrders}
          className={cn(PUB_ROW_BUTTON_CLASS, "min-h-11 px-1")}
        >
          <ClipboardList className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-sm font-medium">See all your orders</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
