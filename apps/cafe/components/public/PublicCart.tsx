"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  PUBLIC_MOBILE_PATTERN,
  publicCartTotals,
  publicMenuPath,
  publicOrderStatusPath,
  type PublicGstConfig,
  type PublicOrderRequestCreatedData,
} from "@pos/shared/public";
import { createPublicOrderRequestSchema } from "@pos/shared/schemas/public-order.schema";
import { inr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { PublicPromoField } from "@/components/public/PublicPromoField";
import { PublicCartLine } from "@/components/public/PublicCartLine";
import { PublicCartBill } from "@/components/public/PublicCartBill";
import { PublicSuggestionChips } from "@/components/public/PublicSuggestionChips";
import type { TablePick } from "@/components/public/TableChooser";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import {
  clearCart,
  pushMyCode,
  readIdentity,
  writeIdentity,
  writeLastMenuPath,
  type CartLine,
} from "@/components/public/public-cart-store";
import {
  buildOrderRequestBody,
  classifySubmitError,
  classifySubmitFailure,
  GENERIC_SEND_ERROR,
  MALFORMED_RESPONSE_ERROR,
  resolveTarget,
  SUBMIT_TIMEOUT_MS,
  TABLE_NAME_BLOCKED_ERROR,
} from "@/components/public/public-submit";

const ORDER_REQUEST_ENDPOINT = "/api/public/order-request";

interface PublicCartProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cart: CartLine[];
  onUpdateQty: (lineId: string, qty: number) => void;
  onRemove: (lineId: string) => void;
  // Present only on /m/<token> — the proven target for this order.
  token?: string;
  // The /m (no-token) name-based pick, owned by PublicOrderFlow.
  pickedTable: TablePick | null;
  tableCharge: { amount: number; label: string } | null;
  // CR2.2c §17.E — the raw signal behind tableCharge above (which folds
  // chargeApplies:false down to null). A promo is only offered on a table's
  // first order of a session; true (the default, and always true off /m with
  // no token) means the promo control is shown.
  chargeApplies: boolean;
  // FIX1 — live GST config off the menu payload, for a total matching the bill.
  gst: PublicGstConfig;
  // FIX2 — fires on a confirmed 201 so the parent clears its IN-MEMORY cart
  // (clearCart() below only wipes localStorage) before navigation.
  onSubmitted: () => void;
  // S4 — up to 3 top-sellers not already in the cart (owned/derived by
  // PublicOrderFlow); an empty array renders no section at all.
  suggestions?: PublicMenuProduct[];
  onAddSuggestion?: (item: PublicMenuProduct) => void;
}

// The diner's review-and-send screen: line list, the table-charge disclosure
// (§1 — the price shown here is the price consented to), a note, identity,
// and one Send button. Builds the request body EXACTLY to
// createPublicOrderRequestSchema's .strict() shape — items carry no
// price/name, the server derives both from the live product.
export function PublicCart({
  open,
  onOpenChange,
  cart,
  onUpdateQty,
  onRemove,
  token,
  pickedTable,
  tableCharge,
  chargeApplies,
  gst,
  onSubmitted,
  suggestions,
  onAddSuggestion,
}: PublicCartProps) {
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

  useEffect(() => {
    const identity = readIdentity();
    if (identity) {
      setMobile(identity.mobile);
      setName(identity.name);
    }
  }, []);

  const subtotal = cart.reduce((sum, line) => sum + line.price * line.qty, 0);
  const chargeAmount = tableCharge?.amount ?? 0;
  // FIX1 — the ONE totals computation on this screen; every displayed figure
  // (the GST line below, the Total row, and the Send button's own amount)
  // reads off this SAME result, never a hand `subtotal + charge` sum.
  const { gstAmount, total } = publicCartTotals(subtotal, chargeAmount, gst);
  const identityValid = PUBLIC_MOBILE_PATTERN.test(mobile.trim()) && name.trim().length > 0;

  // FIX6 — surfaced the moment the pick IS a name, not only after a doomed
  // submit — `token` present means a real scan, so this only fires on /m.
  const blockedReason = !token && pickedTable?.kind === "tableName" ? TABLE_NAME_BLOCKED_ERROR : null;

  function handleApplyPromo(code: string) {
    setPromoCode(code);
    setPromoError(null);
  }

  function handleRemovePromo() {
    setPromoCode(null);
    setPromoError(null);
  }

  async function handleSubmit() {
    setSubmitted(true);
    setError(null);
    setPromoError(null); // a fresh attempt makes any previous promo rejection stale
    // Honeypot tripped — a naive bot filled a field a diner's browser never
    // shows. Drop silently: no error text that would help it learn.
    if (hp.trim().length > 0) return;

    const resolved = resolveTarget(token, pickedTable);
    if (!resolved.ok) {
      setError(resolved.message);
      return;
    }
    if (cart.length === 0 || !identityValid) return;

    const body = buildOrderRequestBody({ target: resolved.target, cart, note, promoCode, name, mobile });

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
      const failure = classifySubmitFailure(res.status, promoCode, envelope422?.error);
      if (failure.promoRejected) {
        setPromoCode(null);
        setPromoError(failure.message);
      } else {
        setError(failure.message);
      }
      setIsSubmitting(false);
    } catch (e) {
      setError(classifySubmitError(e));
      setIsSubmitting(false);
    }
  }

  return (
    // repositionInputs={false}: vaul's keyboard repositioning is the documented
    // cause of the drawer/page blanking or shooting off-screen when a diner
    // focuses an input on a real phone (vaul#619/#294/#255/#216 — field report
    // 2026-08-20). With it off, the browser's native scroll-into-view works
    // because everything between header and footer scrolls (single container,
    // dvh-capped so the on-screen keyboard shrinks it instead of hiding it).
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className="mx-auto max-w-lg">
        <DrawerHeader>
          <DrawerTitle>Your order</DrawerTitle>
        </DrawerHeader>

        <div className="max-h-[65dvh] space-y-3 overflow-y-auto overscroll-contain">
          <div className="space-y-3 px-4">
            {cart.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Your cart is empty.</p>
            ) : (
              cart.map((line) => (
                <PublicCartLine key={line.lineId} line={line} onUpdateQty={onUpdateQty} onRemove={onRemove} />
              ))
            )}
          </div>

          {suggestions && onAddSuggestion && (
            <PublicSuggestionChips suggestions={suggestions} onAdd={onAddSuggestion} />
          )}

          <PublicCartBill
            subtotal={subtotal}
            tableCharge={tableCharge}
            gstAmount={gstAmount}
            gstRate={gst.rate}
            total={total}
            note={note}
            onNoteChange={setNote}
            mobile={mobile}
            name={name}
            onMobileChange={setMobile}
            onNameChange={setName}
            submitted={submitted}
            hp={hp}
            onHpChange={setHp}
            blockedReason={blockedReason}
            error={error}
          >
            {/* §17.E — a promo on a second round of the SAME table session is a
                race remnant, not a normal path; hidden once chargeApplies says
                this table's session is already open. */}
            {chargeApplies && (
              <PublicPromoField
                code={promoCode}
                // Never known until the server answers (no validate endpoint,
                // and the client never computes money) — the field itself
                // renders the "will be applied at the counter" copy for 0.
                savedAmount={0}
                error={promoError}
                busy={isSubmitting}
                onApply={handleApplyPromo}
                onRemove={handleRemovePromo}
              />
            )}
          </PublicCartBill>
        </div>

        <DrawerFooter>
          <Button onClick={handleSubmit} disabled={isSubmitting || cart.length === 0 || blockedReason !== null}>
            {isSubmitting ? "Sending…" : `Send order — ${inr(total)}`}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
