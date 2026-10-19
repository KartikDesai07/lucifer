"use client";

import { useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { PrinterStatusButton } from "@/components/print/PrinterStatusButton";
import { PRINTER_ICON_BUTTON_CLASS } from "@/components/print/printer-classes";
import { RefreshButton } from "@/components/layout/RefreshButton";
import { HeaderQuickTabs } from "@/components/layout/HeaderQuickTabs";
import { PageHeaderBackLink, usePageHeader } from "@/components/layout/page-header-slot";
import { TokenSheet } from "@/components/pos/TokenSheet";
import { useSettings } from "@/hooks/use-settings";
import { APP_NAME } from "@/lib/constants";
import { productImageUrl } from "@/lib/images";
import { defaultPageSubtitle, pageTitleFor } from "@/lib/page-titles";
import { cn } from "@/lib/utils";

// The page header on every staff page (the owner's HTML, values 2.5; design 5.3; U0 Task 3): 56px, white, a rule
// under it, sticky. Left: on a phone the menu (ruling R5, until the tab bar) and the cafe's mini logo; a back link
// when the page has one; the page's title (its h1) over a 12px line, the page's description or the HTML's cafe and
// date. Right: the page's own actions (portaled in by its PageHeader from 720px up), then ours in the design's order.
// The title comes from the route at once and from the page's PageHeader once it mounts (the same words).
export function Header() {
  const pathname = usePathname() ?? "";
  const settings = useSettings();
  const name = settings.data?.restaurantName?.trim() || APP_NAME;
  // The cafe's own logo only (ruling R3), as the nav's brand tile.
  const logoUrl = productImageUrl(settings.data?.logo, undefined, { fit: true });
  const { info, actionsRef } = usePageHeader();
  const title = info?.title ?? pageTitleFor(pathname);
  const subtitle = info?.description ?? defaultPageSubtitle(name, new Date());

  return (
    <header className="sticky top-0 z-[3] flex min-h-14 items-center gap-2.5 border-b border-border bg-card px-3 leading-[normal] text-foreground tab:px-5" data-ui="header">
      <PhoneMenuButton />
      <HeaderMiniLogo key={logoUrl ?? "initial"} name={name} logoUrl={logoUrl} />
      {info?.back && <PageHeaderBackLink back={info.back} />}
      <div data-ui="header-title-block" className="min-w-0 flex-1">
        {info?.eyebrow && <span className="sr-only">{`${info.eyebrow}: `}</span>}
        <h1 data-ui="header-title" className="text-[15px] font-semibold leading-[1.2]">{title}</h1>
        <p data-ui="header-subtitle" className="truncate text-[12px] text-muted-foreground">
          {subtitle}
        </p>
      </div>
      {/* min-w-0: on a narrow tablet a page with wide actions wraps them here instead of pushing ours off screen. */}
      <div ref={actionsRef} data-ui="header-actions" className="flex min-w-0 items-center gap-2.5 empty:hidden" />
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
      className={cn(PRINTER_ICON_BUTTON_CLASS, "tab:hidden")}
      aria-label="Open the menu"
      title="Menu"
      data-ui="header-menu"
      onClick={() => setOpenMobile(true)}
    >
      <Menu aria-hidden="true" strokeWidth={1.8} />
    </Button>
  );
}

// The HTML's phone mini logo: the nav's brand tile at 30px, radius 8 (ruling R3: the cafe's own logo, else its first
// letter in Shrikhand on the brand red; a logo that fails to load falls back to the letter).
function HeaderMiniLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (logoUrl === null || failed) {
    return (
      <span
        aria-hidden="true"
        data-ui="header-mini-logo"
        className="flex size-[30px] flex-none items-center justify-center rounded-[8px] bg-brand-red pt-0.5 font-brand-script text-[19px] font-normal text-white tab:hidden"
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    <Image
      src={logoUrl}
      alt=""
      width={30}
      height={30}
      unoptimized
      onError={() => setFailed(true)}
      data-ui="header-mini-logo"
      className="size-[30px] flex-none rounded-[8px] bg-white object-contain p-0.5 tab:hidden"
    />
  );
}
