"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { PrinterStatusButton } from "@/components/print/PrinterStatusButton";
import { RefreshButton } from "@/components/layout/RefreshButton";
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
      <Separator orientation="vertical" className="h-6" />
      {/* [contain:inline-size] keeps a long cafe name's min-content width out of the page (min-w-0 alone does not stop
          it widening SidebarInset at 768 px); flex-1 lets the name fill the row and truncate before the printer icon. */}
      <h1 className="min-w-0 truncate flex-1 text-sm font-semibold [contain:inline-size]">{name}</h1>
      <div className="ml-auto flex items-center">
        <RefreshButton />
        <PrinterStatusButton />
      </div>
    </header>
  );
}
