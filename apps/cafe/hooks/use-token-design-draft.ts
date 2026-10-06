"use client";

import type { TokenTemplate } from "@pos/shared/print-template";
import { useSlipDesignDraft, type SlipDesignDraft } from "@/hooks/use-slip-design-draft";
import { TOKEN_KIND } from "@/lib/print-design-kinds";
import type { Settings } from "@/types";

// The Tokens page's design draft (print customization S7): the generic state machine over the token kind. No saved
// template means the standard slip (Big number), so `draft === null` is that slip, and "Back to standard" is the
// draft going back to null (Save then removes the stored design). Unlike the bill and the ticket, the token slip has
// no legacy toggles for a design to start from, so the saved settings are all a design needs.

export type TokenDesignDraft = SlipDesignDraft<TokenTemplate>;

export function useTokenDesignDraft(settings: Settings): TokenDesignDraft {
  return useSlipDesignDraft(TOKEN_KIND, settings);
}
