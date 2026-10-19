"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { VENDOR_PRODUCT_NAME } from "@/lib/constants";
import { NavDeviceLine } from "@/components/layout/NavDeviceLine";

// The nav's brand block (the owner's HTML, values 2.3; design 5.2): a 34px tile, then (wide form only) the cafe's
// name in Shrikhand over "{product name} · {this device's print name}". The tile shows the cafe's uploaded logo when
// there is one (AppSidebar decides which, pinned there), else the name's first letter in Shrikhand on the brand red;
// a logo that fails to load falls back to the letter too.
//
// The block is a link to the Dashboard (owner, 2026-09-29), like the home link in any app's header. It never
// prefetches on its own (the nav's only warmer is useWarmRoutes, which keeps "/" warm) and it closes the phone sheet
// exactly like a nav row does.

interface SidebarBrandProps {
  brandName: string;
  /** The uploaded logo to show in the tile, or null for the letter. */
  logoUrl: string | null;
  /** Called on a tap: AppSidebar closes the phone sheet with it. */
  onNavigate: () => void;
}

export function SidebarBrand({ brandName, logoUrl, onNavigate }: SidebarBrandProps) {
  const [failed, setFailed] = useState(false);
  const initial = brandName.trim().charAt(0).toUpperCase() || "?";

  return (
    <Link
      href="/"
      prefetch={false}
      onClick={onNavigate}
      title={brandName}
      aria-label={`${brandName}, go to Dashboard`}
      data-ui="nav-brand"
      className="mb-2.5 flex flex-none items-center justify-center gap-2.5 rounded-[8px] p-1.5 text-white outline-none focus-visible:ring-2 focus-visible:ring-brand-nav-focus wide:justify-start"
    >
      {failed || logoUrl === null ? (
        <span
          aria-hidden="true"
          data-ui="nav-brand-tile"
          className="flex size-[34px] flex-none items-center justify-center rounded-[9px] bg-brand-red pt-0.5 font-brand-script text-[19px] font-normal text-white"
        >
          {initial}
        </span>
      ) : (
        <Image
          src={logoUrl}
          alt=""
          width={34}
          height={34}
          unoptimized
          onError={() => setFailed(true)}
          data-ui="nav-brand-tile"
          // A white tile: a logo drawn for a white page stays readable on the dark nav; scaled, never cropped.
          className="size-[34px] flex-none rounded-[9px] bg-white object-contain p-0.5"
        />
      )}
      <span className="hidden min-w-0 flex-col wide:flex">
        <span
          data-ui="nav-brand-name"
          className="truncate font-brand-script text-[18px] font-normal leading-[1.15] text-brand-nav-name"
        >
          {brandName}
        </span>
        <NavDeviceLine lead={VENDOR_PRODUCT_NAME} dataUi="nav-brand-line" className="whitespace-nowrap text-[12px] text-nav-t2" />
      </span>
    </Link>
  );
}
