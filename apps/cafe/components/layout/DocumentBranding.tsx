"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSettings } from "@/hooks/use-settings";
import { brandedTitle, brandingOf } from "@/lib/document-branding";

// The staff frame is static (no Settings read on the server), so the cafe's name and logo reach the tab here, from
// the settings the shell already holds. It runs again after every path change: Next may put its own static
// <title> / <link rel="icon"> back on a client navigation. It writes only a value that differs, so a quiet screen
// touches nothing, and it keeps the pulse's "(N) " open-request prefix (brandedTitle). Renders nothing.
export function DocumentBranding() {
  const pathname = usePathname();
  const { data } = useSettings();
  const { title, iconHref } = brandingOf(data);

  useEffect(() => {
    const next = brandedTitle(document.title, title);
    if (document.title !== next) document.title = next;
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link && link.getAttribute("href") !== iconHref) link.setAttribute("href", iconHref);
  }, [title, iconHref, pathname]);

  return null;
}
