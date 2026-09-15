"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  PUBLIC_MOBILE_PATTERN,
  publicMenuPath,
  publicOrderStatusPath,
  type PublicOrderRequestCreatedData,
} from "@pos/shared/public";
import { createPublicOrderRequestSchema } from "@pos/shared/schemas/public-order.schema";
import type { TablePick } from "@/components/public/TableChooser";
import {
  clearAppliedPromoCode,
  clearCart,
  clearRequestedRewardAt,
  pushMyCode,
  readAppliedPromoCode,
  readIdentity,
  readRequestedRewardAt,
  writeAppliedPromoCode,
  writeIdentity,
  writeLastMenuPath,
  type CartLine,
} from "@/components/public/public-cart-store";
import {
  buildOrderRequestBody,
  classifyRewardFailure,
  classifySubmitError,
  classifySubmitFailure,
  GENERIC_SEND_ERROR,
  MALFORMED_RESPONSE_ERROR,
  resolveTarget,
  SUBMIT_TIMEOUT_MS,
  TABLE_NAME_BLOCKED_ERROR,
} from "@/components/public/public-submit";

const ORDER_REQUEST_ENDPOINT = "/api/public/order-request";

export interface UsePublicCartSubmitOptions {
  cart: CartLine[];
  // Present only on /m/<token> — the proven target for this order.
  token?: string;
  // The /m (no-token) name-based pick, owned by PublicOrderFlow.
  pickedTable: TablePick | null;
  // FIX2 — fires on a confirmed 201 so the parent clears its IN-MEMORY cart
  // (clearCart() below only wipes localStorage) before navigation.
  onSubmitted: () => void;
  // CB-5B S8 — the Drawer's own open state. This hook's component (PublicCart)
  // stays mounted-but-hidden while the diner is on the Rewards tab (see
  // PublicDinerShell's own comment on why the Menu tab is never unmounted),
  // so a reward selected during that time needs a re-read at the moment the
  // drawer actually opens, not just on this hook's own one-time mount.
  open: boolean;
}

// Owns the diner's cart-submit state machine: identity fields, the promo
// draft, and handleSubmit itself — split out of PublicCart.tsx (CB-4) so
// that component stays under this repo's ~300-line budget.
export function usePublicCartSubmit({ cart, token, pickedTable, onSubmitted, open }: UsePublicCartSubmitOptions) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [hp, setHp] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local-until-Send (§17.E) — no validate endpoint exists, so tapping Apply
  // never hits the network; the code rides the SAME submit the rest of the
  // cart does, and a rejected code reverts this to null (promoError carries
  // the server's own reason) rather than staying "applied".
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  // CB-5B S8 — the reward-claim intent PublicRewardsTab sets, bridged through
  // the store (see public-cart-store.ts's REQUESTED_REWARD_KEY comment for
  // why this can't be a prop). Hydrated on mount and every time the cart
  // drawer opens, so a reward picked while this hook's component stayed
  // mounted-but-hidden is never missed.
  const [requestedRewardAt, setRequestedRewardAt] = useState<number | null>(null);
  // Mirrors promoError's own shape — a server-rejected reward reverts the
  // selection to null and shows the server's own reason, rather than staying
  // "selected" while the diner tries to fix something they cannot see.
  const [rewardError, setRewardError] = useState<string | null>(null);

  useEffect(() => {
    const identity = readIdentity();
    if (identity) {
      setMobile(identity.mobile);
      setName(identity.name);
    }
  }, []);

  // Re-synced every time the drawer opens (see the `open` doc comment above)
  // rather than only on this hook's first mount.
  useEffect(() => {
    if (!open) return;
    setRequestedRewardAt(readRequestedRewardAt());
    setPromoCode(readAppliedPromoCode());
  }, [open]);

  const identityValid = PUBLIC_MOBILE_PATTERN.test(mobile.trim()) && name.trim().length > 0;

  // FIX6 — surfaced the moment the pick IS a name, not only after a doomed
  // submit — `token` present means a real scan, so this only fires on /m.
  const blockedReason = !token && pickedTable?.kind === "tableName" ? TABLE_NAME_BLOCKED_ERROR : null;

  function handleApplyPromo(code: string) {
    setPromoCode(code);
    setPromoError(null);
    writeAppliedPromoCode(code);
  }

  function handleRemovePromo() {
    setPromoCode(null);
    setPromoError(null);
    clearAppliedPromoCode();
  }

  // CB-5B S8 — lets the diner deselect a reward from the cart itself (not
  // only from the Rewards tab rung they tapped), the same "Remove" affordance
  // shape PublicPromoField already uses for its own applied code.
  function handleRemoveReward() {
    setRequestedRewardAt(null);
    clearRequestedRewardAt();
  }

  async function handleSubmit() {
    setSubmitted(true);
    setError(null);
    setPromoError(null); // a fresh attempt makes any previous promo rejection stale
    setRewardError(null); // same, for a previous reward rejection
    // Honeypot tripped — a naive bot filled a field a diner's browser never
    // shows. Drop silently: no error text that would help it learn.
    if (hp.trim().length > 0) return;

    const resolved = resolveTarget(token, pickedTable);
    if (!resolved.ok) {
      setError(resolved.message);
      return;
    }
    if (cart.length === 0 || !identityValid) return;

    const body = buildOrderRequestBody({
      target: resolved.target,
      cart,
      note,
      promoCode,
      name,
      mobile,
      requestedRewardAt,
    });

    // FIX3 preflight — the SAME schema the route enforces (shared source of
    // truth, no duplicated limit logic) so a doomed body is caught with a
    // real message instead of a round trip that just produces GENERIC_SEND_ERROR.
    const preflight = createPublicOrderRequestSchema.safeParse(body);
    if (!preflight.success) {
      setError(preflight.error.issues[0]?.message ?? GENERIC_SEND_ERROR);
      return;
    }

    setIsSubmitting(true);
    try {
      // Hard timeout (field bug 2026-08-20): a stalled request — the BotID
      // challenge wrapper waiting forever, a dead radio, anything — must
      // NEVER leave the button stuck on "Sending…" with no way out. The
      // abort surfaces in the catch below as a retryable error.
      const res = await fetch(ORDER_REQUEST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        // Feature-guarded: AbortSignal.timeout needs ~2022 browsers; an older
        // phone simply skips the timeout rather than failing before the send.
        ...(typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
          ? { signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS) }
          : {}),
      });
      if (res.status === 201) {
        const envelope = (await res.json().catch(() => null)) as {
          success: true;
          data: PublicOrderRequestCreatedData;
        } | null;
        const code = envelope?.data.shortCode;
        // FIX2 — a malformed 201 (no shortCode) is an ERROR path: nothing
        // cleared, button re-enabled, error shown.
        if (!code) {
          setError(MALFORMED_RESPONSE_ERROR);
          setIsSubmitting(false);
          return;
        }
        clearCart();
        onSubmitted();
        writeIdentity({ mobile: mobile.trim(), name: name.trim() });
        pushMyCode(code);
        // "Order more" (PublicOrderStatus.tsx) returns here — the exact menu
        // context this order was placed from (a scanned table, or a picked
        // /m target), never a bare un-tabled /m.
        writeLastMenuPath(
          publicMenuPath(resolved.target.kind === "table" ? resolved.target.token : undefined),
        );
        router.push(publicOrderStatusPath(code));
        return; // isSubmitting deliberately stays true — this unmounts on navigation.
      }
      const envelope422 =
        res.status === 422 ? ((await res.json().catch(() => null)) as { success: false; error: string } | null) : null;
      // Checked BEFORE classifySubmitFailure — see that function's own
      // comment on why the reward classification stays a separate function.
      const rewardFailure = classifyRewardFailure(res.status, requestedRewardAt, envelope422?.error);
      if (rewardFailure !== null) {
        setRequestedRewardAt(null);
        clearRequestedRewardAt();
        setRewardError(rewardFailure);
      } else {
        const failure = classifySubmitFailure(res.status, promoCode, envelope422?.error);
        if (failure.promoRejected) {
          setPromoCode(null);
          clearAppliedPromoCode();
          setPromoError(failure.message);
        } else {
          setError(failure.message);
        }
      }
      setIsSubmitting(false);
    } catch (e) {
      setError(classifySubmitError(e));
      setIsSubmitting(false);
    }
  }

  return {
    note,
    setNote,
    mobile,
    setMobile,
    name,
    setName,
    hp,
    setHp,
    submitted,
    isSubmitting,
    error,
    promoCode,
    promoError,
    requestedRewardAt,
    rewardError,
    identityValid,
    blockedReason,
    handleApplyPromo,
    handleRemovePromo,
    handleRemoveReward,
    handleSubmit,
  };
}
