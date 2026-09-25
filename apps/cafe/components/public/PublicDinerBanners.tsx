import { Megaphone } from "lucide-react";

import { cn } from "@/lib/utils";
import { PUB_HSCROLL_CLASS, PUB_TINT_CLASS, PUB_TONAL_CARD_CLASS } from "@/components/public/public-ui";
import type { PublicDinerBanner } from "@pos/shared/public-diner";

// CB-6D-A — owner-written marketing announcements on Home (CB-6C, Settings'
// `dinerBanners` field). A snap-scroll row so 2-3 short announcements read
// like a small carousel; a single banner takes the full card width rather
// than sitting stranded in a half-empty scroller. Hidden entirely when the
// owner has written none — never an empty section title with nothing under it.

interface PublicDinerBannersProps {
  banners: readonly PublicDinerBanner[];
}

export function PublicDinerBanners({ banners }: PublicDinerBannersProps) {
  if (banners.length === 0) return null;

  return (
    <div className={PUB_HSCROLL_CLASS}>
      {banners.map((banner, i) => (
        <div
          key={`${banner.title}-${i}`}
          className={cn(
            PUB_TONAL_CARD_CLASS,
            "flex shrink-0 snap-start items-start gap-3 p-5",
            banners.length === 1 ? "w-full" : "w-80",
          )}
        >
          <span className={cn(PUB_TINT_CLASS, "grid h-10 w-10 shrink-0 place-items-center rounded-full")}>
            <Megaphone className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-pub-display text-lg font-semibold leading-tight">{banner.title}</p>
            {banner.body !== "" && (
              <p className="mt-1.5 text-sm text-muted-foreground">{banner.body}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
