"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
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
      <h1 className="text-sm font-semibold">{name}</h1>
    </header>
  );
}
