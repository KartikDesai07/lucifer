"use client";

import { memo, useMemo } from "react";

import { TOKEN_DESIGNS, type TokenDesign } from "@pos/shared/print-template";
import { TokenSlip } from "@/components/print/slip/TokenSlip";
import { DesignCard } from "@/components/settings/print-design/DesignCard";
import { sampleTokenOrder } from "@/lib/bill-print-sample";
import { TOKEN_EDITOR, activate } from "@/lib/print-design-editor";
import { TOKEN_KIND } from "@/lib/print-design-kinds";
import type { Settings } from "@/types";

interface TokenDesignGalleryProps {
  settings: Settings;
  /** The design being edited, or null while the slip is the standard one (no template): Big number is then current. */
  active: TokenDesign | null;
  createdAt: string;
  onPick: (design: TokenDesign) => void;
}

interface TokenDesignThumbProps {
  design: TokenDesign;
  /** The SAVED settings: a thumbnail follows them, never the keystrokes in the form, so it does not re-render per key. */
  settings: Settings;
  /** One date for every sample (fixed per mount by the gallery), so the sample's time never ticks. */
  createdAt: string;
  /** The standard-slip card (no design saved yet): draws the slip printed today, with no template at all. */
  today: boolean;
}

// The real token slip, scaled down: a card's picture is <TokenSlip> over the sample order with the design's own
// starting template, exactly what the editor's preview and a printed slip draw. Same 0.4 scale and window as the
// bill and ticket thumbnails. Token designs are eager, so there is no lazy chunk to wait for and no skeleton.
const THUMB_HEIGHT_CLASS = "h-44";
const THUMB_SCALE_CLASS = "scale-[0.4]";

const TokenDesignThumb = memo(function TokenDesignThumb({ design, settings, createdAt, today }: TokenDesignThumbProps) {
  const shown = useMemo(() => {
    const template = today ? null : activate(TOKEN_EDITOR, design, settings).template;
    return { settings: { ...settings, tokenTemplate: template }, order: sampleTokenOrder(createdAt, settings) };
  }, [design, settings, createdAt, today]);

  return (
    <div
      aria-hidden="true"
      inert
      className={`${THUMB_HEIGHT_CLASS} relative flex w-full justify-center overflow-hidden bg-white`}
    >
      <div className={`pointer-events-none shrink-0 origin-top ${THUMB_SCALE_CLASS}`}>
        <TokenSlip order={shown.order} settings={shown.settings} />
      </div>
    </div>
  );
});

// The two token designs as real thumbnails. A tap changes only the unsaved draft; nothing is saved until Save.
export function TokenDesignGallery({ settings, active, createdAt, onPick }: TokenDesignGalleryProps) {
  const { copy, designLabel, designBlurb, todayDesign } = TOKEN_KIND;
  const current: TokenDesign = active ?? todayDesign;
  return (
    <div role="group" aria-label={copy.galleryLabel}>
      <ul className="grid grid-cols-2 gap-3">
        {TOKEN_DESIGNS.map((design) => {
          const today = design === todayDesign && active === null;
          return (
            <li key={design} className="min-w-0">
              <DesignCard
                selected={design === current}
                label={today ? copy.todayCardLabel : designLabel[design]}
                blurb={designBlurb[design]}
                onPick={() => onPick(design)}
              >
                <TokenDesignThumb design={design} settings={settings} createdAt={createdAt} today={today} />
              </DesignCard>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
