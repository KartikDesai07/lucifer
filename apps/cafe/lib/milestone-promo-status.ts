import { normalizePromoCode } from "@pos/shared/public-promo";

// Settings pass slice 8 — what a loyalty reward's promo code will do for a
// diner, judged against the cafe's promo list. Pure and client-safe so the
// reward panel can warn BEFORE a diner finds out.
//
// This MUST stay in step with buildRewardAssignment (lib/reward-assignment.ts):
// a code is handed out only if it is already in Settings' promo list AND not
// switched off; otherwise the claim silently gives no code. Nothing creates
// the code for the owner. The parity test in milestone-promo-status.test.ts
// runs both functions over the same fixtures.
export type MilestonePromoStatus = "none" | "ok" | "off" | "missing";

// The Select's "No code" item. A real code is 3-16 uppercase letters/digits,
// so this can never collide with one.
export const NO_PROMO_CODE_VALUE = "__none__";

export function milestonePromoStatus(
  code: string | null | undefined,
  promoCodes: readonly { code: string; active?: boolean }[] | undefined,
): MilestonePromoStatus {
  if (!code) return "none";
  const wanted = normalizePromoCode(code);
  // Array.find on purpose, never a keyed lookup: a code literally named
  // "constructor" must be judged purely by membership (same as the builder).
  const match = (promoCodes ?? []).find((c) => c.code === wanted);
  if (!match) return "missing";
  if (match.active === false) return "off";
  return "ok";
}
