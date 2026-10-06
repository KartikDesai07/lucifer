"use client";

import { BILL_DESIGNS, type BillDesign } from "@pos/shared/print-template";
import { CLASSIC_CURRENT_LABEL, DESIGN_BLURB, DESIGN_LABEL } from "@/lib/print-design-labels";
import { DesignCard } from "@/components/settings/print-design/DesignCard";
import { DesignThumb } from "@/components/settings/print-design/DesignThumb";
import type { Settings } from "@/types";

interface DesignGalleryProps {
  settings: Settings;
  /** The design being edited, or null while the bill is today's (no template): Classic is then the current one. */
  active: BillDesign | null;
  createdAt: string;
  onPick: (design: BillDesign) => void;
}

// The four designs as real thumbnails. A tap changes only the unsaved draft; nothing is saved until Save.
export function DesignGallery({ settings, active, createdAt, onPick }: DesignGalleryProps) {
  const current: BillDesign = active ?? "classic";
  return (
    <div role="group" aria-label="Bill design">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {BILL_DESIGNS.map((design) => {
          const label = design === "classic" && active === null ? CLASSIC_CURRENT_LABEL : DESIGN_LABEL[design];
          return (
            <li key={design} className="min-w-0">
              <DesignCard selected={design === current} label={label} blurb={DESIGN_BLURB[design]} onPick={() => onPick(design)}>
                <DesignThumb
                  design={design}
                  settings={settings}
                  createdAt={createdAt}
                  today={design === "classic" && active === null}
                />
              </DesignCard>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
