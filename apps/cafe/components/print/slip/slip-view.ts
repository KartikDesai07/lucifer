import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

import { loadSlipCode, slipCodeStatus, subscribeSlipCode, templateNeedsSlipCode } from "./slip-code";

// R6: how a receipt reads the lazy slip chunk's status (slip-code.ts). Kept apart from that store because the print
// host's hooks import the store under lib/hook-harness.ts, whose fake React has no createContext.

/** True inside <SlipPreview> (SlipSkeleton.tsx): an on-screen preview, never printed. Every other receipt prints. */
export const SlipPreviewContext = createContext(false);

type TemplateLike = { design: string; blocks: readonly { type: string }[] };

/**
 * What a receipt with this template renders: "slip" (the design: at once when it needs no lazy code), "skeleton"
 * (a preview while the chunk loads), or "legacy" (no template; or a print surface whose chunk is not in yet or
 * failed to load, so a print is never blank). The server snapshot is the same store: nothing loads on the server,
 * and the node:test renders load the chunk before they render a design.
 */
export function useSlipView(template: TemplateLike | null): "slip" | "skeleton" | "legacy" {
  const status = useSyncExternalStore(subscribeSlipCode, slipCodeStatus, slipCodeStatus);
  const preview = useContext(SlipPreviewContext);
  const needs = template !== null && templateNeedsSlipCode(template);
  useEffect(() => {
    // Only a first ask fetches from here. A failed fetch is retried when the print host mounts
    // (hooks/use-slip-code-pending.ts) or the page reloads, never by a re-render, so an offline device does not loop.
    if (needs && slipCodeStatus() === "idle") void loadSlipCode();
  }, [needs]);
  if (template === null) return "legacy";
  if (!needs || status === "ready") return "slip";
  return preview && status !== "failed" ? "skeleton" : "legacy";
}
