"use client";

import { useWatch, type Control } from "react-hook-form";

import { HINT_CLASS } from "@/components/settings/SettingsFields";
import { DesignSection } from "@/components/settings/print-design/DesignSection";
import { TokenDesignGallery } from "@/components/settings/print-design/TokenDesignGallery";
import type { TokenDesignDraft } from "@/hooks/use-token-design-draft";
import { TOKEN_KIND } from "@/lib/print-design-kinds";
import { TOKENS_OFF_HINT } from "@/lib/print-design-labels";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

interface TokenDesignSectionProps {
  design: TokenDesignDraft;
  /** The SAVED settings. */
  settings: Settings;
  control: Control<SettingsInput>;
}

// "Token slip design": the two designs, then (once one is customized) every line of the slip and its font and size.
// Shown whether tokens are on or off, so the owner can set the slip up first; the one line below only says so, it
// never switches anything. Every change is only the unsaved draft; the page's one Save bar saves it with the form.
export function TokenDesignSection({ design, settings, control }: TokenDesignSectionProps) {
  const tokensOn = useWatch({ control, name: "tokenEnabled" }) === true;
  return (
    <div className="space-y-3">
      {!tokensOn && <p className={HINT_CLASS}>{TOKENS_OFF_HINT}</p>}
      <DesignSection
        kind={TOKEN_KIND}
        design={design}
        settings={settings}
        legacy={() => settings}
        gallery={(args) => <TokenDesignGallery settings={settings} {...args} />}
      />
    </div>
  );
}
