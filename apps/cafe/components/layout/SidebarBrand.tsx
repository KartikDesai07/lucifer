"use client";

import { useState } from "react";
import Image from "next/image";

import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

// The sidebar's top row: the cafe's logo at its own shape (a wide wordmark
// keeps its width), then the cafe's name over the product name. Extracted
// from AppSidebar, which still owns WHICH logo to show (restaurant logo,
// then product logo, then the branding route — pinned there).
//
// A monogram tile — the name's first letter, ink on paper — stands in when
// the logo fails to load, and in the 3rem icon rail when the logo is a wide
// wordmark (squeezed into 32px it would be an unreadable smear).

/** Width/height above which a logo counts as a wordmark, not a mark. */
const WIDE_LOGO_RATIO = 1.4;

interface SidebarBrandProps {
  brandName: string;
  logoUrl: string;
  collapsed: boolean;
}

export function SidebarBrand({ brandName, logoUrl, collapsed }: SidebarBrandProps) {
  const [failed, setFailed] = useState(false);
  const [wide, setWide] = useState(false);
  const showMonogram = failed || (collapsed && wide);
  const initial = brandName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex h-9 min-w-0 items-center gap-2.5">
      {!failed && (
        // Stays mounted (only hidden) while the monogram shows, so expanding
        // the rail again needs no reload and no second measurement.
        <Image
          src={logoUrl}
          alt="Logo"
          width={32}
          height={32}
          unoptimized
          onLoad={(e) =>
            setWide(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight * WIDE_LOGO_RATIO)
          }
          onError={() => setFailed(true)}
          // multiply: a logo saved on a white background sits on the paper
          // without a white box around it.
          className={cn(
            "h-8 w-auto max-w-[6.5rem] shrink-0 object-contain mix-blend-multiply",
            collapsed && "w-8 max-w-8",
            showMonogram && "hidden",
          )}
        />
      )}
      {showMonogram && (
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-ink font-brand-display text-[15px] font-semibold text-brand-slip"
        >
          {initial}
        </span>
      )}
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-brand-ink">{brandName}</div>
          {/* The product name, unless the cafe has no name of its own yet —
              then the line above already says it. */}
          {brandName !== APP_NAME && <div className="truncate text-[12px] text-brand-muted">{APP_NAME}</div>}
        </div>
      )}
    </div>
  );
}
