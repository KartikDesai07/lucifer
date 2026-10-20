"use client";

import { usePathname } from "next/navigation";

import { PrinterStatusButton } from "@/components/print/PrinterStatusButton";
import { BrandTile } from "@/components/layout/BrandTile";
import { HeaderTitle } from "@/components/layout/HeaderTitle";
import { RefreshButton } from "@/components/layout/RefreshButton";
import { HeaderQuickTabs } from "@/components/layout/HeaderQuickTabs";
import { usePageHeader } from "@/components/layout/page-header-slot";
import { TokenSheet } from "@/components/pos/TokenSheet";
import { useNow } from "@/hooks/use-now";
import { useSettings } from "@/hooks/use-settings";
import { APP_NAME } from "@/lib/constants";
import { productImageUrl } from "@/lib/images";
import { headerWordsFor } from "@/lib/page-titles";

/** The default line's date is re-read once a minute (final review m6): a day change lands within a minute. */
const HEADER_CLOCK_MS = 60_000;

// The page header on every staff page (the owner's HTML, values 2.5; design 5.3; U0 Task 3): 56px, white, a rule
// under it, sticky. Left: on a phone the cafe's mini logo (the phone's nav is the tab bar, U0 Task 4); a back link
// when the page has one; the page's title (its h1) over a 12px line, the page's description or the HTML's cafe and
// date. Right: the page's own actions (portaled in by its PageHeader from 720px up while they fit beside a 140px
// title, ruling R6; drawn as the HTML's header buttons), then ours in the design's order.
// The title comes from the route at once and from the page's PageHeader once it mounts (the same words).
export function Header() {
  const pathname = usePathname() ?? "";
  const settings = useSettings();
  const name = settings.data?.restaurantName?.trim() || APP_NAME;
  // The cafe's own logo only (ruling R3), as the nav's brand tile.
  const logoUrl = productImageUrl(settings.data?.logo, undefined, { fit: true });
  const { info, actionsRef, titleRef } = usePageHeader();
  // The date in the default line follows the clock, so a tablet left on past midnight shows the new day. Until the
  // hook's first tick (null) the line keeps this render's own date: the shell renders on the client only
  // (MasterDataProvider), so that is already the device's date, the same words and width, with no blank frame.
  const now = useNow(HEADER_CLOCK_MS) ?? new Date();
  const { title, subtitle } = headerWordsFor({ info, pathname, cafeName: name, now });

  return (
    <header className="sticky top-0 z-[3] flex min-h-14 items-center gap-2.5 border-b border-border bg-card px-3 leading-[normal] text-foreground tab:px-5" data-ui="header">
      <BrandTile key={logoUrl ?? "initial"} name={name} logoUrl={logoUrl} size="mini" dataUi="header-mini-logo" className="tab:hidden" />
      <HeaderTitle title={title} subtitle={subtitle} eyebrow={info?.eyebrow} back={info?.back} titleRef={titleRef} />
      {/* The page's own actions (ruling R6: the HTML's header buttons, data-header-actions in app/globals.css). min-w-0:
          they never push our buttons off screen while the slot measures whether they fit. */}
      <div ref={actionsRef} data-ui="header-actions" data-header-actions="" className="flex min-w-0 items-center gap-2.5 empty:hidden" />
      <HeaderQuickTabs />
      <RefreshButton />
      <TokenSheet />
      <PrinterStatusButton />
    </header>
  );
}
