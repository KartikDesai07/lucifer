"use client";

import { useState } from "react";
import Image from "next/image";

import { cn } from "@/lib/utils";

// The cafe's brand tile (the owner's HTML; ruling R3): the cafe's own uploaded logo on white, else the first letter of
// its name in Shrikhand on the brand red. A logo that fails to load falls back to the letter. Two sizes: the nav's
// 34px tile (values 2.3) and the phone header's 30px mini logo (values 2.5). The caller passes the cafe's logo only
// (never the product logo) and keys the tile on it, so a new logo gets a fresh try.

const TILE_SIZES = {
  nav: { px: 34, box: "size-[34px] rounded-[9px]" },
  mini: { px: 30, box: "size-[30px] rounded-[8px]" },
} as const;

const LETTER_CLASS = "flex flex-none items-center justify-center bg-brand-red pt-0.5 font-brand-script text-[19px] font-normal text-white";
// A white tile: a logo drawn for a white page stays readable on the dark nav; scaled, never cropped.
const LOGO_CLASS = "flex-none bg-white object-contain p-0.5";

interface BrandTileProps {
  /** The cafe's name: its first letter when there is no logo. */
  name: string;
  /** The cafe's own uploaded logo, or null for the letter. */
  logoUrl: string | null;
  size: keyof typeof TILE_SIZES;
  /** Probe hook (data-ui). */
  dataUi: string;
  className?: string;
}

export function BrandTile({ name, logoUrl, size, dataUi, className }: BrandTileProps) {
  const [failed, setFailed] = useState(false);
  const tile = TILE_SIZES[size];
  return (
    <>
      {failed || logoUrl === null ? (
        <span aria-hidden="true" data-ui={dataUi} className={cn(LETTER_CLASS, tile.box, className)}>
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      ) : (
        <Image
          src={logoUrl}
          alt=""
          width={tile.px}
          height={tile.px}
          unoptimized
          onError={() => setFailed(true)}
          data-ui={dataUi}
          className={cn(LOGO_CLASS, tile.box, className)}
        />
      )}
    </>
  );
}
