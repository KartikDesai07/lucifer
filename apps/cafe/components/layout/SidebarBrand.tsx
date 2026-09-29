"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

// The sidebar's top row: the cafe's logo at its own shape (a wide wordmark
// keeps its width), then the cafe's name over the product name. Extracted
// from AppSidebar, which still owns WHICH logo to show (restaurant logo,
// then product logo, then the branding route — pinned there).
//
// The whole row is a link to the Dashboard (owner, 2026-09-29), like the
// home link in any app's header. It never prefetches on its own — the
// sidebar's only warmer is useWarmRoutes, which already keeps "/" warm — and
// it closes the phone sheet exactly like a nav row does.
//
// In the 3rem icon rail the real logo shows, scaled down to fit the 32px
// square (object-contain: a wide wordmark shrinks to the square's width
// rather than being cropped). A monogram tile — the name's first letter, ink
// on paper — stands in only when the logo fails to load.

interface SidebarBrandProps {
  brandName: string;
  logoUrl: string;
  collapsed: boolean;
  /** Called on a tap — AppSidebar closes the phone sheet with it. */
  onNavigate: () => void;
}

export function SidebarBrand({ brandName, logoUrl, collapsed, onNavigate }: SidebarBrandProps) {
  const [failed, setFailed] = useState(false);
  const initial = brandName.trim().charAt(0).toUpperCase() || "?";

  return (
    <Link
      href="/"
      prefetch={false}
      onClick={onNavigate}
      aria-label={`${brandName}, go to Dashboard`}
      className="flex h-9 min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
    >
      {failed ? (
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-ink font-brand-display text-[15px] font-semibold text-brand-slip"
        >
          {initial}
        </span>
      ) : (
        <Image
          src={logoUrl}
          alt=""
          width={32}
          height={32}
          unoptimized
          onError={() => setFailed(true)}
          // multiply: a logo saved on a white background sits on the paper
          // without a white box around it.
          className={cn(
            "h-8 w-auto max-w-[6.5rem] shrink-0 object-contain mix-blend-multiply",
            collapsed && "w-8 max-w-8",
          )}
        />
      )}
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-brand-ink">{brandName}</div>
          {/* The product name, unless the cafe has no name of its own yet —
              then the line above already says it. */}
          {brandName !== APP_NAME && <div className="truncate text-[12px] text-brand-muted">{APP_NAME}</div>}
        </div>
      )}
    </Link>
  );
}
