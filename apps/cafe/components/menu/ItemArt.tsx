"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

import { productImageUrl } from "@/lib/images";
import { productIconComponent } from "@/lib/product-icon-map";
import { cn } from "@/lib/utils";

// The Items page's art tile: photo, then the chosen icon, then the name's
// initial — in that order, everywhere (owner: "image ho to wo, other wise
// icon bhi set kar sakta hai"). A broken photo URL falls back via onError,
// same idea as PublicInitialTile's `failed` state.

// U5 Task 2 (owner Q3): one size, the 34px tile (radius 8) the HTML's veg mark sat in; the row stays 55px.
const SIZE_CLASS = {
  34: "size-[34px] rounded-[8px] text-sm",
} as const;

export type ItemArtSize = keyof typeof SIZE_CLASS;

interface ItemArtProps {
  name: string;
  image: string; // opaque image ref, "" = none
  icon?: string;
  size: ItemArtSize;
  className?: string;
}

export function ItemArt({ name, image, icon, size, className }: ItemArtProps) {
  const [failed, setFailed] = useState(false);
  const url = image ? productImageUrl(image, size * 2) : null;
  const Icon = productIconComponent(icon);

  // G13 — a row's image ref can change under this same mounted instance (an
  // edit picks a new photo, a list re-renders a row for a different item via
  // key reuse); without this, one broken load stuck `failed` true forever and
  // a later GOOD ref never got its own chance to render.
  useEffect(() => {
    setFailed(false);
  }, [image]);

  if (url && !failed) {
    return (
      <div className={cn("relative shrink-0 overflow-hidden bg-muted", SIZE_CLASS[size], className)}>
        <Image
          src={url}
          alt=""
          fill
          sizes={`${size}px`}
          className="object-cover"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center bg-muted font-semibold text-muted-foreground",
        SIZE_CLASS[size],
        className,
      )}
    >
      {Icon ? <Icon className="h-4 w-4" /> : name.charAt(0).toUpperCase() || "•"}
    </span>
  );
}
