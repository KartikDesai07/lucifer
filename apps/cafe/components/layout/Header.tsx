"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { PrinterStatusButton } from "@/components/print/PrinterStatusButton";
import { RefreshButton } from "@/components/layout/RefreshButton";
import { HeaderQuickTabs } from "@/components/layout/HeaderQuickTabs";
import { TokenSheet } from "@/components/pos/TokenSheet";
import { useSettings } from "@/hooks/use-settings";
import { APP_NAME } from "@/lib/constants";

export function Header() {
  // The cafe's name is configured from the Settings page (Settings.restaurantName);
  // the header reflects it, with a generic fallback before it's set.
  const settings = useSettings();
  const name = settings.data?.restaurantName?.trim() || APP_NAME;

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger />
      <Separator orientation="vertical" className="hidden h-6 sm:block" />
      {/* The cafe name stays the page's h1 for screen readers; on screen the sidebar's top shows it, and this row
          carries the New Order + Tables tabs (owner, 2026-10-11). The tabs' nav is min-w-0 flex-1 [contain:inline-size],
          so a narrow phone truncates a label instead of pushing the printer button off the bar (the s63 768 px lesson). */}
      <h1 className="sr-only">{name}</h1>
      <HeaderQuickTabs />
      <div className="ml-auto flex items-center">
        <TokenSheet />
        <RefreshButton />
        <PrinterStatusButton />
      </div>
    </header>
  );
}
