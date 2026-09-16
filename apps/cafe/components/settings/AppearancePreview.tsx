"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { resolveAppearance, appearanceCssVars } from "@pos/shared/appearance";
import { FONT_PAIR_CLASSNAMES, FONT_PAIR_FAMILIES } from "@/lib/public-fonts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PublicMenuHeader } from "@/components/public/PublicMenuHeader";
import { PublicMenuItem, type PublicMenuProduct } from "@/components/public/PublicMenuItem";

// CR2.4 S5 (A7/A9/A17) — renders the REAL diner-facing components
// (PublicMenuHeader/PublicMenuItem) against the unsaved form draft, so
// "preview" and "the actual /m page" share one pinned source of truth
// (S6: this file must import PublicMenuHeader, never duplicate its markup).

// Generic sample dishes only — no photos (exercises the initial-glyph path),
// no cafe name (CLAUDE.md: never hardcode a cafe's identity in v2 code).
const APPEARANCE_PREVIEW_ITEMS: PublicMenuProduct[] = [
  { id: "preview-1", name: "Chef's Starter Platter", category: "Starters", price: 180, discount: 0, available: true, image: "", modifiers: ["Extra spicy"] },
  { id: "preview-2", name: "House Special Bowl", category: "Mains", price: 320, discount: 10, available: true, image: "", modifiers: [] },
  { id: "preview-3", name: "Seasonal Dessert", category: "Desserts", price: 150, discount: 0, available: false, image: "", modifiers: [] },
];

const PREVIEW_HEADER = {
  restaurantName: "Sample Menu",
  tableLabel: "12",
  showParcel: false,
  tableMissing: false,
};

type Scheme = "light" | "dark";

function noop() {
  // Intentional no-op — the preview is browse-only, PublicMenuItem's
  // Add/stepper controls just need to be PRESENT so the accent/radius/density
  // tokens actually paint them.
}

interface AppearancePreviewProps {
  control: Control<SettingsInput>;
}

// A phone-width frame, never the actual admin page: :root stays untouched
// (A9) — every token below is scoped to this subtree via inline style plus
// the selected pair's .variable classes, so the rest of Settings is never
// themed by a draft the admin hasn't saved yet.
export function AppearancePreview({ control }: AppearancePreviewProps) {
  const [scheme, setScheme] = useState<Scheme>("light");
  // useWatch (NOT the render-prop watch()) — the ONLY subscription this
  // preview needs is its own "appearance" slice, so a keystroke anywhere else
  // on the form never re-renders it (A17).
  const watched = useWatch({ control, name: "appearance" });
  const draft = resolveAppearance(watched);
  const families = FONT_PAIR_FAMILIES[draft.fontPairKey];

  const frameStyle = {
    ...appearanceCssVars(draft, scheme),
    "--pub-body-font": families.body,
    "--pub-display-font": families.display,
  } as CSSProperties;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Live preview</span>
        <div role="tablist" aria-label="Preview color scheme" className="inline-flex gap-1 rounded-lg border p-1">
          <Button
            type="button"
            role="tab"
            aria-selected={scheme === "light"}
            variant={scheme === "light" ? "default" : "ghost"}
            size="sm"
            onClick={() => setScheme("light")}
          >
            Light
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={scheme === "dark"}
            variant={scheme === "dark" ? "default" : "ghost"}
            size="sm"
            onClick={() => setScheme("dark")}
          >
            Dark
          </Button>
        </div>
      </div>

      <div
        style={frameStyle}
        className={cn(
          "mx-auto max-w-sm overflow-hidden rounded-2xl border bg-background text-foreground font-pub-body",
          FONT_PAIR_CLASSNAMES[draft.fontPairKey],
        )}
      >
        <div className="max-h-[32rem] overflow-y-auto p-pub-pad">
          <PublicMenuHeader
            restaurantName={PREVIEW_HEADER.restaurantName}
            tableLabel={PREVIEW_HEADER.tableLabel}
            showParcel={PREVIEW_HEADER.showParcel}
            tableMissing={PREVIEW_HEADER.tableMissing}
            chrome={{ heroImage: draft.heroImage, logoPlacement: draft.logoPlacement }}
          />
          <div className="space-y-pub-gap">
            {APPEARANCE_PREVIEW_ITEMS.map((item) => (
              <PublicMenuItem key={item.id} product={item} qty={0} onIncrement={noop} onDecrement={noop} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
