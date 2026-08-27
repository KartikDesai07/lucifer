"use client";

import { useState } from "react";
import Image from "next/image";
import { UtensilsCrossed } from "lucide-react";

import { brandingUrl, productImageUrl } from "@/lib/images";
import { HERO_MAX_DIMENSION_PX } from "@/lib/constants";
import type { LogoPlacement } from "@pos/shared/appearance";

// CR2.4 S3 (A4) — extracted from PublicMenu.tsx (was inline :211-242), which
// had grown past the ~300-line file cap. Behavior-identical for every prop
// that already existed there; this file only ADDS the hero banner and
// logoPlacement branching described below.

// The hero banner renders at a fixed 16:9 box — a chosen DISPLAY crop
// (object-cover inside an aspect-[16/9] wrapper), not a claim about the
// stored image's own ratio: prepareImage (ImageUpload.tsx) never crops, it
// only scales the longest edge down to HERO_MAX_DIMENSION_PX and preserves
// whatever ratio the admin uploaded. Sizing the <Image> tag off this same
// constant keeps the box's PIXEL dimensions tied to the real upload bound
// (never a bare literal); the box itself is what stays a stable, reserved
// 16:9 rect before AND after the image decodes, which is what actually
// prevents layout shift on a non-16:9 upload.
const HERO_RENDER_WIDTH = HERO_MAX_DIMENSION_PX;
const HERO_RENDER_HEIGHT = Math.round(HERO_RENDER_WIDTH * (9 / 16));

// Three COMPLETE static class strings (never computed/interpolated) — one per
// LogoPlacement value. "hidden" only omits the logo IMAGE below; the
// restaurant name and table label still render in the same row shape as
// "left" (A4's own wording: "hidden hides the logo img only, name still shows").
const HEADER_ROW_CLASSNAME: Record<LogoPlacement, string> = {
  left: "mb-4 flex items-center gap-3",
  center: "mb-4 flex flex-col items-center gap-2 text-center",
  hidden: "mb-4 flex items-center gap-3",
};

interface PublicMenuHeaderProps {
  restaurantName: string;
  tableLabel: string | null;
  showParcel: boolean;
  tableMissing: boolean;
  // CR2.4 (A1) — the appearance fields this component needs, threaded down
  // from the /m server pages through PublicOrderFlow/PublicMenu. Never widen
  // /api/public/menu to carry these instead (A1's own resolution).
  chrome: { heroImage: string; logoPlacement: LogoPlacement };
}

export function PublicMenuHeader({
  restaurantName,
  tableLabel,
  showParcel,
  tableMissing,
  chrome,
}: PublicMenuHeaderProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  // A prune-vs-save race (A14's accepted residual grace-window edge) can leave
  // Settings pointing at a hero version that has since been collected — the
  // logo two blocks below already degrades to a glyph on a broken image, the
  // hero must do the same rather than show a permanently broken image box.
  const [heroFailed, setHeroFailed] = useState(false);
  const heroUrl = chrome.heroImage !== "" ? productImageUrl(chrome.heroImage) : null;
  const showLogo = chrome.logoPlacement !== "hidden";

  return (
    <>
      {heroUrl && !heroFailed && (
        // bg-muted placeholder, never accent-tinted (A12) — this box is food
        // photography, not a themed surface, so it must read the same as a
        // product tile's own image placeholder regardless of preset/accent.
        <div className="mb-4 aspect-[16/9] w-full overflow-hidden rounded-lg bg-muted">
          <Image
            src={heroUrl}
            alt=""
            width={HERO_RENDER_WIDTH}
            height={HERO_RENDER_HEIGHT}
            priority
            onError={() => setHeroFailed(true)}
            className="h-full w-full object-cover"
          />
        </div>
      )}

      <header className={HEADER_ROW_CLASSNAME[chrome.logoPlacement]}>
        {showLogo &&
          (!logoFailed ? (
            // Same public branding route the login screen/sidebar use — falls back to a glyph.
            <Image
              src={brandingUrl("logo")}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 rounded-xl object-contain"
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground">
              <UtensilsCrossed className="h-6 w-6" />
            </div>
          ))}
        <div>
          <h1 className="text-xl font-bold leading-tight font-pub-display">
            {restaurantName || "Menu"}
          </h1>
          {tableLabel && (
            <p className="text-sm text-muted-foreground">Table {tableLabel}</p>
          )}
          {showParcel && <p className="text-sm text-muted-foreground">Parcel</p>}
          {tableMissing && (
            <p className="text-xs text-destructive">
              This table&apos;s QR looks out of date — ask staff to confirm your table.
            </p>
          )}
        </div>
      </header>
    </>
  );
}
