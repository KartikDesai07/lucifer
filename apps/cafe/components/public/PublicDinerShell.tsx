"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "sonner";

import type { LogoPlacement } from "@pos/shared/appearance";
import type { PublicStatusItem } from "@pos/shared/public";
import type { PublicDinerBanner } from "@pos/shared/public-diner";
import { PublicOrderFlow } from "@/components/public/PublicOrderFlow";
import type { AssignedRewardOffer } from "@/components/public/PublicPromoField";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import { PublicTabBar, type DinerTab } from "@/components/public/PublicTabBar";
import { PublicRewardsTab } from "@/components/public/PublicRewardsTab";
import { PublicHomeTab } from "@/components/public/PublicHomeTab";
import { PublicAccountTab } from "@/components/public/PublicAccountTab";
import { PublicMyOrdersTab } from "@/components/public/PublicMyOrdersTab";
import {
  pickActiveOrder,
  pickLastOrder,
  pickOfferItems,
  pickPopularItems,
} from "@/components/public/public-home-data";
import {
  SHELL_DEFAULT_GST,
  applyRepeatOrder,
  fetchMenuSnapshot,
  repeatOrderCart,
  type MenuSnapshot,
} from "@/components/public/public-shell-repeat";
import {
  fetchDinerMe,
  postDinerLogout,
  type DinerIdentity,
} from "@/components/public/public-diner-me";
import { clearDinerData, readCart } from "@/components/public/public-cart-store";
import {
  CONTENT_PAD_TABS_ONLY,
  SHELL_BOTTOM_CHROME_STYLE,
} from "@/components/public/public-shell-layout";
import { useMyOrders } from "@/components/public/use-my-orders";
import type { DinerStampCard } from "@/lib/diner-loyalty";

// How many top sellers Home's "Popular here" row shows — a phone-width
// scroller, never the whole list.
const POPULAR_ROW_LIMIT = 8;

// Total ITEMS (not lines) in the persisted cart — the Menu tab's badge count.
// Read from the STORE (the same place PublicOrderFlow hydrates from), never
// from that component's state.
function countCartItems(): number {
  return readCart().reduce((sum, line) => sum + line.qty, 0);
}

interface PublicDinerShellProps {
  token?: string;
  chrome: { heroImage: string; logoPlacement: LogoPlacement };
  // Server-resolved from Settings by the /m pages. Both off → the shell
  // renders nothing of its own (no tab bar, no fetch): today's single screen.
  accountsEnabled: boolean;
  loyaltyEnabled: boolean;
  // Server-resolved via the SHARED selfOrderingAllowed predicate (S12).
  orderingAllowed: boolean;
  // CB-6C — owner-written Home banners, already normalised by
  // readPublicDinerConfig (never the raw Settings field).
  banners: readonly PublicDinerBanner[];
}

// CB-4 / CB-6C — the diner shell: Home · Menu · Orders · Rewards · Account.
// WRAPS PublicOrderFlow rather than reaching into it (it owns the cart, the
// table charge and the submit path). The Menu tab stays MOUNTED when another
// tab is shown (`hidden`, not unmounted) so the in-memory cart survives.
export function PublicDinerShell({
  token,
  chrome,
  accountsEnabled,
  loyaltyEnabled,
  orderingAllowed,
  banners,
}: PublicDinerShellProps) {
  const [tab, setTab] = useState<DinerTab>("menu");
  const [diner, setDiner] = useState<DinerIdentity | null>(null);
  const [stampCard, setStampCard] = useState<DinerStampCard | null>(null);
  const [rewards, setRewards] = useState<AssignedRewardOffer[] | undefined>(undefined);
  const [loading, setLoading] = useState(accountsEnabled);
  // Bumped ONLY by a cart write from outside PublicOrderFlow ("Order again",
  // Home's quick add) — see the key={menuEpoch} note below.
  const [menuEpoch, setMenuEpoch] = useState(0);
  const [cartCount, setCartCount] = useState(0);
  // The slice of /api/public/menu the shell holds (gst for bills, the cafe
  // name, popular ids + items for Home) — the cached route, one fetch.
  const [snapshot, setSnapshot] = useState<MenuSnapshot | null>(null);
  // Home's active-order card deep-links into the Orders tab's detail: the
  // code parks here until that tab mounts, and clears when the diner goes
  // anywhere else (so a later plain tap on Orders opens the list).
  const [pendingOpenCode, setPendingOpenCode] = useState<string | null>(null);
  // Bumped by signOut so the lifted fan-out re-reads the (now cleared) codes.
  const [ordersEpoch, setOrdersEpoch] = useState(0);

  // The both-features-off cafe must fetch NOTHING the shell adds.
  const shellActive = accountsEnabled || loyaltyEnabled;
  const orders = useMyOrders(shellActive, ordersEpoch);

  // A failed poll (null) keeps what is on screen rather than flipping a
  // signed-in diner to signed-out.
  const refresh = useCallback(async () => {
    if (!accountsEnabled) return;
    const data = await fetchDinerMe();
    if (data) {
      setDiner(data.diner);
      setStampCard(data.stampCard ?? null);
      setRewards(data.rewards);
    }
    setLoading(false);
  }, [accountsEnabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The cart survives a reload (it is persisted), so seed the badge on mount.
  useEffect(() => {
    setCartCount(countCartItems());
  }, []);

  // One read of the cached menu route for everything the shell shows off it.
  useEffect(() => {
    if (!shellActive) return;
    let cancelled = false;
    void fetchMenuSnapshot().then((resolved) => {
      if (!cancelled && resolved !== null) setSnapshot(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [shellActive]);

  // "Order this again" / Home quick add: rebuild the cart from past lines,
  // VALIDATED against the live menu (repeatOrderCart drops anything removed,
  // hidden, sold out or whose variation is gone — never a stale price), merge
  // onto the current cart, persist, remount the menu so it hydrates the new
  // cart, and tell the diner what happened.
  async function repeatOrder(items: PublicStatusItem[]) {
    const result = await repeatOrderCart(items);
    if (result === null) {
      toast.error("Couldn't reach the menu — please try again.");
      return;
    }
    if (!applyRepeatOrder(result)) return;
    setMenuEpoch((n) => n + 1);
    setCartCount(countCartItems()); // the repeat just wrote to the cart
    setTab("menu");
  }

  // Home's one-tap add rides the SAME validated path — priced from the LIVE
  // menu by buildRepeatCart, never from the snapshot. Simple items only.
  function quickAdd(product: PublicMenuProduct) {
    void repeatOrder([{ productId: product.id, name: product.name, price: product.price, qty: 1, modifiers: [] }]);
  }

  // Leaving the Menu tab must also dismiss anything the MENU had open: the
  // cart Drawer (vaul) and the item Sheet (Radix) PORTAL to document.body, so
  // they sit outside the `hidden` wrapper below. Escape is the documented
  // close path for both — each surface closes through its own state machine.
  function selectTab(next: DinerTab) {
    if (next !== "menu" && typeof document !== "undefined") {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
    if (next !== "orders") setPendingOpenCode(null);
    // Re-read the cart on every tab change so the Menu badge is right the
    // moment the diner walks away from the menu (store, not component state).
    setCartCount(countCartItems());
    setTab(next);
  }

  function openActiveOrder(code: string) {
    setPendingOpenCode(code);
    selectTab("orders");
  }

  async function signOut() {
    await postDinerLogout();
    setDiner(null);
    setStampCard(null);
    // CB-5D part 2 — the assigned codes go with the rest of the diner's state:
    // the promo field renders them as tap-to-apply rows, so the next person on
    // a shared phone could spend the previous diner's reward otherwise.
    setRewards(undefined);
    // Clears diner-owned localStorage (identity + codes + menu path + refresh
    // timestamps) — deliberately NOT the cart or the theme.
    clearDinerData();
    setOrdersEpoch((n) => n + 1);
    setPendingOpenCode(null);
    setTab("menu");
  }

  // A cafe running neither feature gets today's screen exactly: no tab bar, no
  // fetch, no behaviour change at all.
  if (!accountsEnabled && !loyaltyEnabled) {
    return <PublicOrderFlow token={token} chrome={chrome} />;
  }

  const tabs: DinerTab[] = loyaltyEnabled
    ? ["home", "menu", "orders", "rewards", "account"]
    : ["home", "menu", "orders", "account"];

  const signedIn = diner !== null;
  const activeOrder = orders ? pickActiveOrder(orders) : null;
  const lastOrder = orders ? pickLastOrder(orders) : null;
  const popularItems = pickPopularItems(snapshot?.items, snapshot?.popular, POPULAR_ROW_LIMIT);
  const offerItems = pickOfferItems(snapshot?.items);
  // Seeded with the SAME default shape PublicOrderFlow uses — a pre-load bill
  // must never invent tax.
  const gst = snapshot?.gst ?? SHELL_DEFAULT_GST;
  const cafeName = snapshot?.restaurantName ?? "";

  return (
    // style: raises --pub-bottom-chrome for this whole subtree, which is how
    // the cart bar (and the status action bar) float ABOVE the tab bar.
    // Without the shell the same class strings resolve to 0px.
    <div className={CONTENT_PAD_TABS_ONLY} style={SHELL_BOTTOM_CHROME_STYLE}>
      {/* `hidden`, never a conditional render — the Menu tab owns the
          in-memory cart. `key={menuEpoch}` is the ONE deliberate remount: a
          repeat/quick add writes the rebuilt cart to localStorage, and
          PublicOrderFlow hydrates from there exactly once on mount. */}
      <div hidden={tab !== "menu"}>
        <PublicOrderFlow key={menuEpoch} token={token} chrome={chrome} rewards={rewards} />
      </div>

      {tab === "home" && (
        <PublicHomeTab
          cafeName={cafeName}
          chrome={chrome}
          signedIn={signedIn}
          dinerName={diner?.name ?? ""}
          loyaltyEnabled={loyaltyEnabled}
          loading={loading}
          stampCard={stampCard}
          banners={banners}
          activeOrder={activeOrder}
          lastOrder={lastOrder}
          offerItems={offerItems}
          popularItems={popularItems}
          orderingAllowed={orderingAllowed}
          onBrowseMenu={() => selectTab("menu")}
          onRepeatLast={() => {
            const items = orders?.find((o) => o.code === lastOrder?.code)?.data?.items;
            if (items) void repeatOrder(items);
          }}
          onOpenOrders={() => selectTab("orders")}
          onOpenActiveOrder={() => {
            if (activeOrder) openActiveOrder(activeOrder.code);
          }}
          onOpenRewards={() => selectTab(loyaltyEnabled ? "rewards" : "account")}
          onSignIn={() => selectTab("account")}
          onQuickAdd={quickAdd}
        />
      )}

      {tab === "orders" && (
        <PublicMyOrdersTab
          orders={orders}
          initialOpenCode={pendingOpenCode}
          signedIn={signedIn}
          orderingAllowed={orderingAllowed}
          gst={gst}
          onSignIn={() => selectTab("account")}
          onBrowseMenu={() => selectTab("menu")}
          onRepeat={repeatOrder}
        />
      )}

      {tab === "account" && (
        <PublicAccountTab
          diner={diner}
          cafeName={cafeName}
          onSignedIn={(signedInDiner) => {
            setDiner(signedInDiner);
            void refresh();
          }}
          onSignOut={signOut}
        />
      )}

      {tab === "rewards" && (
        <PublicRewardsTab
          loading={loading}
          signedIn={signedIn}
          card={stampCard}
          rewards={rewards}
          onSignIn={() => selectTab("account")}
        />
      )}

      <PublicTabBar active={tab} onSelect={selectTab} tabs={tabs} cartCount={cartCount} />
    </div>
  );
}
