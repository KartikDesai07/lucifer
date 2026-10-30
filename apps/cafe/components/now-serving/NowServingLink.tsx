"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Tv } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HEADER_ACTION_FLOOR_OUTLINE_CLASS } from "@/components/layout/header-classes";
import { HINT_CLASS, HINT_LINK_CLASS } from "@/components/settings/hint-classes";
import { useSettings } from "@/hooks/use-settings";
import { printConfigOf } from "@/lib/print";
import { cn } from "@/lib/utils";

// Print customization S9 - the two inbound links to the Now Serving screen: a button beside the Kitchen header's
// freshness chip, and a hint under the token settings. Both show only while tokens are on (the same gate as the
// top-bar Tokens button); with tokens off it renders just its children, so the Kitchen chip never disappears.
// U4 Task 1 (Kitchen design 6.1, owner Q10): the button is U3's outline header button (the HTML Floor button's look) and
// is not drawn below 720px, where the More sheet's Now Serving tile is the way there.
export const NOW_SERVING_PATH = "/now-serving";
const BUTTON_LABEL = "Now Serving";
const HINT_TEXT = "Show token numbers on a TV for your customers.";
const HINT_LINK_LABEL = "Open Now Serving";

interface NowServingLinkProps {
  variant: "button" | "hint";
  children?: ReactNode;
}

export function NowServingLink({ variant, children }: NowServingLinkProps) {
  const settings = useSettings();
  if (!printConfigOf(settings.data).token.enabled) return <>{children}</>;

  if (variant === "hint") {
    return (
      <p className={HINT_CLASS}>
        {HINT_TEXT}{" "}
        <Link href={NOW_SERVING_PATH} prefetch={false} className={cn(HINT_LINK_CLASS, "inline-flex min-h-11 items-center")}>
          {HINT_LINK_LABEL}
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" className={cn(HEADER_ACTION_FLOOR_OUTLINE_CLASS, "max-tab:hidden")}>
        <Link href={NOW_SERVING_PATH} prefetch={false}>
          <Tv aria-hidden="true" />
          {BUTTON_LABEL}
        </Link>
      </Button>
      {children}
    </div>
  );
}
