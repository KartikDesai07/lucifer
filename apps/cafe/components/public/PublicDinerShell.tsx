"use client";

import { useCallback, useEffect, useState } from "react";

import { toast } from "sonner";

import type { LogoPlacement } from "@pos/shared/appearance";
import type { PublicGstConfig, PublicStatusItem } from "@pos/shared/public";
import { PublicOrderFlow } from "@/components/public/PublicOrderFlow";
import type { AssignedRewardOffer } from "@/components/public/PublicPromoField";
import { PublicTabBar, type DinerTab } from "@/components/public/PublicTabBar";
import { PublicRewardsTab } from "@/components/public/PublicRewardsTab";
import { PublicDinerSignIn } from "@/components/public/PublicDinerSignIn";
import { PublicHomeTab } from "@/components/public/PublicHomeTab";
import { PublicAccountTab } from "@/components/public/PublicAccountTab";
import { PublicMyOrdersTab } from "@/components/public/PublicMyOrdersTab";
import { pickLastOrder } from "@/components/public/public-home-data";
import type { PastOrder } from "@/components/public/public-orders-grouping";
import {
  SHELL_DEFAULT_GST,
  applyRepeatOrder,
  fetchMenuGst,
  repeatOrderCart,
} from "@/components/public/public-shell-repeat";
import { clearDinerData, readCart } from "@/components/public/public-cart-store";
import {
  CONTENT_PAD_TABS_ONLY,
  SHELL_BOTTOM_CHROME_STYLE,
} from "@/components/public/public-shell-layout";
import type { DinerStampCard } from "@/lib/diner-loyalty";

const ME_ENDPOINT = "/api/public/diner/me";
const LOGOUT_ENDPOINT = "/api/public/diner/logout";

// Total ITEMS (not lines) in the persisted cart — the Menu tab's badge count.
// Read from the store, the same place PublicOrderFlow hydrates its cart from,
// so the badge never requires reaching into that component's state.
function countCartItems(): number {
  return readCart().reduce((sum, line) => sum + line.qty, 0);
}

interface DinerIdentity {
  name: string;
  mobile: string;
}

interface DinerMeResponse {
  diner: DinerIdentity | null;
  stampCard?: DinerStampCard;
  // CB-5D part 2 — the codes a milestone claim has assigned to this diner.
  // Server-filtered: already-used and already-expired codes never arrive, so
  // the shell renders whatever it is given without re-judging it (the SERVER
  // is what enforces a deadline; this list is the display half).
  rewards?: AssignedRewardOffer[];
}

interface PublicDinerShellProps {
  token?: string;
  chrome: { heroImage: string; logoPlacement: LogoPlacement };
  // Server-resolved from Settings by the /m pages. When BOTH are off the shell
  // renders nothing of its own — no tab bar, no fetch — and the diner sees
  // exactly today's single-screen menu. That is the behaviour every existing
  // cafe keeps until its owner opts in.
  accountsEnabled: boolean;
  loyaltyEnabled: boolean;
  // Server-resolved via the SHARED selfOrderingAllowed predicate (S12) — feeds
  // the Home tab's "Order again" affordance and the Orders tab's bill view.
  orderingAllowed: boolean;
}

// CB-4 — the 3-tab diner shell (Menu | My Orders | Rewards).
//
// WRAPS PublicOrderFlow rather than reaching into it: that component owns the
// cart, the table charge and the whole submit path, and is already at this
// repo's file budget. The Menu tab is therefore byte-for-byte today's screen.
//
// Menu stays MOUNTED when another tab is shown (hidden via `hidden`, not
// unmounted) — unmounting it would drop the in-memory cart the diner is
// building, which is the one thing this surface must never lose.
export function PublicDinerShell({
  token,
  chrome,
  accountsEnabled,
  loyaltyEnabled,
  orderingAllowed,
}: PublicDinerShellProps) {
  const [tab, setTab] = useState<DinerTab>("menu");
  const [diner, setDiner] = useState<DinerIdentity | null>(null);
  const [stampCard, setStampCard] = useState<DinerStampCard | null>(null);
  const [rewards, setRewards] = useState<AssignedRewardOffer[] | undefined>(undefined);
  const [loading, setLoading] = useState(accountsEnabled);
  // Bumped ONLY by "Order this again" — see the key={menuEpoch} note below.
  const [menuEpoch, setMenuEpoch] = useState(0);
  // Total items in the cart, for the Menu tab badge. Refreshed on every tab
  // change (and after a repeat) — the cart itself lives in PublicOrderFlow.
  const [cartCount, setCartCount] = useState(0);
  // Fed by PublicMyOrdersTab's onOrdersResolved once its mount-time fan-out
  // settles — so Home's "Order again" card can read the same resolved list
  // with NO fetch of its own. If the Orders tab has never been opened this
  // stays null and the card is simply absent; that is an accepted trade-off
  // (see the prop below), not a bug to work around with a second fetch.
  const [resolvedOrders, setResolvedOrders] = useState<PastOrder[] | null>(null);
  // Seeded with the SAME default shape PublicOrderFlow uses (SHELL_DEFAULT_GST
  // — a pre-load bill must never invent tax) and refreshed from the cached
  // /api/public/menu response (nearly always a cache hit, see
  // public-shell-repeat.ts's own comment) once it resolves.
  const [gst, setGst] = useState<PublicGstConfig>(SHELL_DEFAULT_GST);

  const refresh = useCallback(async () => {
    if (!accountsEnabled) return;
    try {
      const res = await fetch(ME_ENDPOINT);
      const envelope = (await res.json().catch(() => null)) as
        | { success: true; data: DinerMeResponse }
        | { success: false; error: string }
        | null;
      if (envelope?.success) {
        setDiner(envelope.data.diner);
        setStampCard(envelope.data.stampCard ?? null);
        setRewards(envelope.data.rewards);
      }
    } catch {
      // Offline or a hiccup: leave whatever is already on screen rather than
      // flipping a signed-in diner to signed-out on one failed poll.
    } finally {
      setLoading(false);
    }
  }, [accountsEnabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The cart survives a reload (it is persisted), so seed the badge on mount —
  // otherwise a diner who returns to a still-full cart sees no count until
  // they happen to switch tabs.
  useEffect(() => {
    setCartCount(countCartItems());
  }, []);

  // Seeds the bill-view gst once, from the SAME cached menu route the repeat
  // path already hits — not a second real load (see public-shell-repeat.ts).
  useEffect(() => {
    let cancelled = false;
    void fetchMenuGst().then((resolved) => {
      if (!cancelled && resolved !== null) setGst(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // "Order this again": rebuild the cart from a past order, VALIDATED against
  // the live menu (repeatOrderCart drops anything removed, hidden, sold out or
  // whose variation is gone — a repeat must never re-add at a stale price),
  // merge it onto whatever is already in the cart, persist, then remount the
  // menu so it hydrates from the new cart and show the diner what happened.
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

  // Leaving the Menu tab must also dismiss anything the MENU had open.
  //
  // The cart Drawer (vaul) and the item Sheet (Radix) both PORTAL to
  // document.body, so they are NOT inside the `hidden` wrapper below — hiding
  // the menu leaves an open drawer floating over the Orders/Rewards tab, on
  // top of a menu that is `display:none`. Their open state lives inside
  // PublicOrderFlow, which this shell deliberately does not reach into (it
  // owns the cart, and remounting it here would throw that cart away).
  //
  // Escape is the documented close path for BOTH libraries, so dispatching it
  // asks each surface to close itself through its own state machine — no
  // reaching in, no remount, and a no-op when nothing is open.
  function selectTab(next: DinerTab) {
    if (next !== "menu" && typeof document !== "undefined") {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
    // Re-read the cart on every tab change so the Menu tab's badge is right
    // the moment the diner walks away from the menu. Reading the STORE rather
    // than PublicOrderFlow's state keeps this shell out of that component
    // (it owns the cart, and reaching in would mean remounting it).
    setCartCount(countCartItems());
    setTab(next);
  }

  async function signOut() {
    try {
      await fetch(LOGOUT_ENDPOINT, { method: "POST" });
    } catch {
      // The server row may survive a failed call, but it expires on its own —
      // and the local state below is what the diner actually sees.
    }
    setDiner(null);
    setStampCard(null);
    setResolvedOrders(null);
    // CB-5D part 2 — the assigned codes go with the rest of the diner's state.
    // Missing this leaks a REAL benefit, not just a display: the promo field
    // renders these as tap-to-apply rows, so the next person on a shared
    // phone (or the cafe's own tablet) could spend the previous diner's
    // reward. The route deliberately no-stores this payload for exactly that
    // reason; the client must not undo it on sign-out.
    setRewards(undefined);
    // A logout clears diner-owned localStorage (identity + codes + menu path
    // + refresh timestamps) — deliberately NOT the cart or the theme, see
    // clearDinerData's own comment.
    clearDinerData();
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

  // HOME LOADING (deliberate decision, see slice brief): gate the loyalty
  // strip on the SAME `loading` state the Rewards tab already holds, by
  // withholding stampCard until it resolves — a signed-in diner whose card
  // has not loaded yet sees no strip rather than a stale/undefined one.
  const homeStampCard = loading ? null : stampCard;
  const lastOrder = resolvedOrders ? pickLastOrder(resolvedOrders) : null;

  return (
    // style: raises --pub-bottom-chrome for this whole subtree, which is how
    // PublicFlowChrome's cart bar (and the status action bar) learn to float
    // ABOVE the tab bar instead of underneath it. Without the shell the same
    // class strings resolve to 0px, so a cafe with these features off renders
    // exactly as it did before CB-4.
    <div className={CONTENT_PAD_TABS_ONLY} style={SHELL_BOTTOM_CHROME_STYLE}>
      {/* `hidden` rather than a conditional render — see the note above on why
          the Menu tab must never unmount.

          `key={menuEpoch}` is the ONE deliberate exception: "Order this again"
          writes the rebuilt cart to localStorage, and PublicOrderFlow hydrates
          from there exactly once on mount. Bumping the key remounts it so it
          picks the new cart up, rather than reaching into that component's
          state from out here (it owns the cart, and it is already at this
          repo's file budget). Nothing else changes the epoch, so the normal
          tab-switching path still never remounts the menu. */}
      <div hidden={tab !== "menu"}>
        <PublicOrderFlow key={menuEpoch} token={token} chrome={chrome} rewards={rewards} />
      </div>

      {tab === "home" && (
        <PublicHomeTab
          signedIn={diner !== null}
          dinerName={diner?.name ?? ""}
          stampCard={homeStampCard}
          lastOrder={lastOrder}
          orderingAllowed={orderingAllowed}
          onBrowseMenu={() => selectTab("menu")}
          onRepeatLast={() => {
            const items = resolvedOrders?.find((o) => o.code === lastOrder?.code)?.data?.items;
            if (items) void repeatOrder(items);
          }}
          onOpenOrders={() => selectTab("orders")}
          onSignIn={() => selectTab("rewards")}
        />
      )}

      {tab === "orders" && (
        <PublicMyOrdersTab
          signedIn={diner !== null}
          dinerName={diner?.name ?? ""}
          onSignIn={() => setTab("rewards")}
          onSignOut={signOut}
          onRepeat={repeatOrder}
          orderingAllowed={orderingAllowed}
          gst={gst}
          onOrdersResolved={setResolvedOrders}
        />
      )}

      {tab === "account" && (
        <PublicAccountTab diner={diner} onSignIn={() => selectTab("rewards")} onSignOut={signOut} />
      )}

      {tab === "rewards" &&
        (diner === null ? (
          <PublicDinerSignIn
            onSignedIn={(signedIn) => {
              setDiner(signedIn);
              void refresh();
            }}
          />
        ) : (
          <PublicRewardsTab
            loading={loading}
            signedIn
            card={stampCard}
            onSignIn={() => undefined}
          />
        ))}

      <PublicTabBar active={tab} onSelect={selectTab} tabs={tabs} cartCount={cartCount} />
    </div>
  );
}
