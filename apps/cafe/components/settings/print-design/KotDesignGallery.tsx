"use client";

import { KOT_DESIGNS, type KotDesign } from "@pos/shared/print-template";
import { KOT_KIND } from "@/lib/print-design-kinds";
import { DesignCard } from "@/components/settings/print-design/DesignCard";
import { KotDesignThumb } from "@/components/settings/print-design/KotDesignThumb";
import type { Settings } from "@/types";

interface KotDesignGalleryProps {
  settings: Settings;
  /** The design being edited, or null while the ticket is today's (no template): Classic is then the current one. */
  active: KotDesign | null;
  createdAt: string;
  onPick: (design: KotDesign) => void;
}

// The kitchen ticket's designs as real thumbnails. A tap changes only the unsaved draft; nothing is saved until Save.
export function KotDesignGallery({ settings, active, createdAt, onPick }: KotDesignGalleryProps) {
  const current: KotDesign = active ?? "classic";
  const { copy, designLabel, designBlurb } = KOT_KIND;
  return (
    <div role="group" aria-label={copy.galleryLabel}>
      <ul className="grid grid-cols-2 gap-3">
        {KOT_DESIGNS.map((design) => {
          const today = design === "classic" && active === null;
          return (
            <li key={design} className="min-w-0">
              <DesignCard
                selected={design === current}
                label={today ? copy.todayCardLabel : designLabel[design]}
                blurb={designBlurb[design]}
                onPick={() => onPick(design)}
              >
                <KotDesignThumb design={design} settings={settings} createdAt={createdAt} today={today} />
              </DesignCard>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
