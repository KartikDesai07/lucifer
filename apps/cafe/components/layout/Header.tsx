"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { PrinterStatusButton } from "@/components/print/PrinterStatusButton";
import { BrandTile } from "@/components/layout/BrandTile";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/header-classes";
import { HeaderTitle } from "@/components/layout/HeaderTitle";
import { RefreshButton } from "@/components/layout/RefreshButton";
import { HeaderQuickTabs } from "@/components/layout/HeaderQuickTabs";
import { usePageHeader } from "@/components/layout/page-header-slot";
import { TokenSheet } from "@/components/pos/TokenSheet";
import { useSettings } from "@/hooks/use-settings";
import { APP_NAME } from "@/lib/constants";
import { productImageUrl } from "@/lib/images";
import { headerWordsFor } from "@/lib/page-titles";
import { cn } from "@/lib/utils";

// The page header on every staff page (the owner's HTML, values 2.5; design 5.3; U0 Task 3): 56px, white, a rule
// under it, sticky. Left: on a phone the menu (ruling R5, until the tab bar) and the cafe's mini logo; a back link
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
  const { title, subtitle } = headerWordsFor({ info, pathname, cafeName: name, now: new Date() });

  return (
    <header className="sticky top-0 z-[3] flex min-h-14 items-center gap-2.5 border-b border-border bg-card px-3 leading-[normal] text-foreground tab:px-5" data-ui="header">
      <PhoneMenuButton />
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

// Ruling R5: below 720px the nav is a sheet until the phone tab bar arrives (U0 Task 4); this opens it.
function PhoneMenuButton() {
  const { setOpenMobile } = useSidebar();
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn(HEADER_ICON_BUTTON_CLASS, "tab:hidden")}
      aria-label="Open the menu"
      title="Menu"
      data-ui="header-menu"
      onClick={() => setOpenMobile(true)}
    >
      <Menu aria-hidden="true" strokeWidth={1.8} />
    </Button>
  );
}
