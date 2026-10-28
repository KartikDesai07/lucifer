"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

import { PrinterStatusButton } from "@/components/print/PrinterStatusButton";
import { BrandTile } from "@/components/layout/BrandTile";
import { HeaderTitle } from "@/components/layout/HeaderTitle";
import { RefreshButton } from "@/components/layout/RefreshButton";
import { HeaderQuickTabs } from "@/components/layout/HeaderQuickTabs";
import { PosHeaderBrand, PosHeaderClock, usePosHeaderRoom } from "@/components/layout/PosHeaderBrand";
import { usePageHeader } from "@/components/layout/page-header-slot";
import { TokenSheet } from "@/components/pos/TokenSheet";
import { useNow } from "@/hooks/use-now";
import { useSettings } from "@/hooks/use-settings";
import { APP_NAME } from "@/lib/constants";
import { productImageUrl } from "@/lib/images";
import { headerWordsFor } from "@/lib/page-titles";
import { isFloorPath } from "@/lib/floor-layout";
import { isOrdersPath } from "@/lib/orders-layout";
import { isPosPath } from "@/lib/pos-layout";
import type { PrinterDotTone } from "@/lib/printer/printer-dot";

/** The default line's date is re-read once a minute (final review m6): a day change lands within a minute. */
const HEADER_CLOCK_MS = 60_000;

// The page header on every staff page (the owner's HTML, values 2.5; design 5.3; U0 Task 3): 56px, white, a rule
// under it, sticky. Left: on a phone the cafe's mini logo (the phone's nav is the tab bar, U0 Task 4); a back link
// when the page has one; the page's title (its h1) over a 12px line, the page's description or the HTML's cafe and
// date. Right: the page's own actions (portaled in by its PageHeader from 720px up while they fit beside a 140px
// title, ruling R6; drawn as the HTML's header buttons), then ours in the design's order.
// The title comes from the route at once and from the page's PageHeader once it mounts (the same words).
// On /pos (U1 Task 1; the POS values 1.2-1.4, design 6.1) it is the HTML's Order header: data-pos makes the bar
// exactly 56px with 16px gaps and not sticky (the page under it never scrolls); the brand block takes the mini logo's
// and the title block's place (the page's h1 stays, for screen readers); the actions box takes the free width,
// right-aligned, with the page's switch-order button in it (U1 Task 6: the HTML's own 42px button, so the box drops the
// header-button look there); the clock block follows; no quick links. While the room rule has a part out
// (data-room-out), the header is that part's positioned ancestor.
// On /orders (U2 Task 1; the Orders values 1.2, design 6.1) it is the HTML's Orders header: the title header with
// data-orders making its gaps 12px (U0's 10px on every other page); New order keeps its label on the phone there
// (HeaderQuickTabs).
// On /tables (U3 Task 1; the Floor values 1.2, design 6.1) it is the HTML's Floor header: data-floor making its gaps 12px
// as on /orders; New order alone (no Tables link: owner Q1) in the HTML Floor button's outline look (HeaderQuickTabs).
export function Header() {
  const pathname = usePathname() ?? "";
  const pos = isPosPath(pathname);
  const orders = isOrdersPath(pathname);
  const floor = isFloorPath(pathname);
  const settings = useSettings();
  const name = settings.data?.restaurantName?.trim() || APP_NAME;
  // The cafe's own logo only (ruling R3), as the nav's brand tile.
  const logoUrl = productImageUrl(settings.data?.logo, undefined, { fit: true });
  const { info, actionsRef, titleRef, actionsBox } = usePageHeader();
  // The date in the default line follows the clock, so a tablet left on past midnight shows the new day. Until the
  // hook's first tick (null) the line keeps this render's own date: the shell renders on the client only
  // (MasterDataProvider), so that is already the device's date, the same words and width, with no blank frame.
  const now = useNow(HEADER_CLOCK_MS) ?? new Date();
  const { title, subtitle } = headerWordsFor({ info, pathname, cafeName: name, now });
  // The /pos clock block's dot is the printer button's own (design 6.1): the button hands its tone over, on /pos only,
  // so every other page's header never re-renders for it.
  const [printerTone, setPrinterTone] = useState<PrinterDotTone>("none");
  const room = usePosHeaderRoom(pos, actionsBox);

  return (
    <header className="sticky top-0 z-[3] flex min-h-14 items-center gap-2.5 border-b border-border bg-card px-3 leading-[normal] text-foreground tab:px-5 data-pos:static data-pos:z-auto data-pos:h-14 data-pos:min-w-0 data-pos:gap-4 data-orders:gap-3 data-floor:gap-3 data-room-out:relative" data-ui="header" data-pos={pos ? "" : undefined} data-orders={orders ? "" : undefined} data-floor={floor ? "" : undefined} data-room-out={room.level > 0 ? "" : undefined}>
      {pos ? (
        <PosHeaderBrand name={name} logoUrl={logoUrl} room={room} />
      ) : (
        <BrandTile key={logoUrl ?? "initial"} name={name} logoUrl={logoUrl} size="mini" dataUi="header-mini-logo" className="tab:hidden" />
      )}
      {pos ? (
        <h1 data-ui="header-title" className="sr-only">{title}</h1>
      ) : (
        <HeaderTitle title={title} subtitle={subtitle} eyebrow={info?.eyebrow} back={info?.back} titleRef={titleRef} />
      )}
      {/* The page's own actions (ruling R6: the HTML's header buttons, data-header-actions in app/globals.css). min-w-0:
          they never push our buttons off screen while the slot measures whether they fit. On /pos the HTML's actions
          box: flex:1, right-aligned, 6px apart, scrolling sideways; it stays in the row while empty; no header-button
          look (it holds the HTML's own switch-order button). */}
      <div ref={actionsRef} data-ui="header-actions" data-header-actions={pos ? undefined : ""} data-pos={pos ? "" : undefined} className="flex min-w-0 items-center gap-2.5 empty:hidden data-pos:flex-1 data-pos:justify-end data-pos:gap-1.5 data-pos:overflow-x-auto data-pos:empty:flex" />
      <HeaderQuickTabs />
      {pos && <PosHeaderClock now={now} tone={printerTone} room={room} />}
      <RefreshButton />
      <TokenSheet />
      <PrinterStatusButton onToneChange={pos ? setPrinterTone : undefined} />
    </header>
  );
}
