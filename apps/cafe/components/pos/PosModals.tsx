"use client";

import { memo } from "react";
import dynamic from "next/dynamic";

import { PosPrompts, type PosPromptsProps } from "@/components/pos/PosPrompts";
import type { AddToCartOpts } from "@/components/pos/ModifierModal";
import type { PosModalTotals } from "@/hooks/use-pos-modal-totals";
import { useStableCallback } from "@/hooks/use-stable-callback";
import type { PaymentResult } from "@/lib/payment-result";
import type { Customer, Order, Product, VoidItemInput } from "@/types";

// CB-1d.3c / C3 — the five POS modal roots (ModifierModal · PaymentModal ·
// PosPrompts · VoidItemDialog · MoveTableDialog) extracted out of pos/page.tsx;
// every piece of modal STATE stays in PosPage and arrives as props; the memo
// gate is per root (the four dynamic() loaders are each wrapped in React.memo,
// PosPrompts is memoized in its own file); this shell is deliberately NOT
// memoized because PosPage re-mints its callback props and its totals object
// on every render — instead the shell latches every callback through
// useStableCallback and spreads totals into primitives, so a closed root's
// props are Object.is-stable across taps that do not concern it; PaymentModal
// legitimately re-renders when the cart's totals change (real prop diff);
// MoveTableDialog additionally consumes the print-lane string context and
// re-renders on a lane transition regardless of memo.

// POS modals are interaction-gated — load their chunks lazily so they stay out
// of the initial POS bundle (CLAUDE.md §17). Client component, so ssr:false is OK.
// Each loader is wrapped in React.memo so a closed modal's whole Radix root
// (Dialog → Portal → Presence) is skipped while its own props are unchanged. No
// displayName is set on the wrappers on purpose — the profiler keeps naming them
// LoadableComponent, so before/after harness rows stay comparable.
const ModifierModal = memo(dynamic(
  () => import("@/components/pos/ModifierModal").then((m) => m.ModifierModal),
  { ssr: false },
));
const PaymentModal = memo(dynamic(
  () => import("@/components/pos/PaymentModal").then((m) => m.PaymentModal),
  { ssr: false },
));
const VoidItemDialog = memo(dynamic(
  () => import("@/components/pos/VoidItemDialog").then((m) => m.VoidItemDialog),
  { ssr: false },
));
const MoveTableDialog = memo(dynamic(
  () => import("@/components/orders/MoveTableDialog").then((m) => m.MoveTableDialog),
  { ssr: false },
));

export interface PosModalsProps extends PosPromptsProps {
  // ModifierModal
  modifierProduct: Product | null;
  modifierOpen: boolean;
  onModifierOpenChange: (open: boolean) => void;
  onModifierConfirm: (product: Product, opts: AddToCartOpts) => void;
  // PaymentModal
  paymentOpen: boolean;
  onPaymentOpenChange: (open: boolean) => void;
  totals: PosModalTotals;
  customer: Customer | undefined;
  tableNo: string | undefined;
  receiver: string;
  isSubmitting: boolean;
  onPaymentConfirm: (result: PaymentResult) => void;
  onSelectCustomer?: (customer: Customer | undefined) => void;
  // VoidItemDialog
  voidOpen: boolean;
  onVoidOpenChange: (open: boolean) => void;
  voidPending: boolean;
  onVoidConfirm: (payload: VoidItemInput) => void;
  // MoveTableDialog
  moveTableOpen: boolean;
  onMoveTableOpenChange: (open: boolean) => void;
  onMoved: (order: Order, fromTableNo: string | undefined) => void;
  resumedOrder: Order | null;
}

const noopSelectCustomer: NonNullable<PosModalsProps["onSelectCustomer"]> = () => undefined;

// NOT memoized on purpose: PosPage re-mints these callback props on every render
// (usePosTab's closures) and `totals` is a fresh object each render, so a memo here
// could never bail out. The gate is one level down — each root is memoized — and
// this shell's job is to hand them referentially STABLE callbacks and primitive totals.
export function PosModals({
  modifierProduct,
  modifierOpen,
  onModifierOpenChange,
  onModifierConfirm,
  paymentOpen,
  onPaymentOpenChange,
  totals,
  customer,
  tableNo,
  receiver,
  isSubmitting,
  onPaymentConfirm,
  onSelectCustomer,
  closeConfirmOpen,
  onCloseConfirmOpenChange,
  onConfirmCloseTab,
  resumeConfirmOpen,
  onCancelResume,
  onConfirmResume,
  freeTablePrompt,
  onDismissFreeTable,
  onConfirmFreeTable,
  freeingTable,
  voidOpen,
  onVoidOpenChange,
  voidPending,
  onVoidConfirm,
  moveTableOpen,
  onMoveTableOpenChange,
  onMoved,
  resumedOrder,
}: PosModalsProps) {
  const modifierOpenChange = useStableCallback(onModifierOpenChange);
  const modifierConfirm = useStableCallback(onModifierConfirm);
  const paymentOpenChange = useStableCallback(onPaymentOpenChange);
  const paymentConfirm = useStableCallback(onPaymentConfirm);
  // PaymentModal hides its customer picker when the prop is undefined (a tab that
  // already carries a customer) — one latched function, and the prop's
  // presence/absence still follows the parent's decision below.
  const selectCustomer = useStableCallback(onSelectCustomer ?? noopSelectCustomer);
  const closeConfirmOpenChange = useStableCallback(onCloseConfirmOpenChange);
  const confirmCloseTab = useStableCallback(onConfirmCloseTab);
  const cancelResume = useStableCallback(onCancelResume);
  const confirmResume = useStableCallback(onConfirmResume);
  const dismissFreeTable = useStableCallback(onDismissFreeTable);
  const confirmFreeTable = useStableCallback(onConfirmFreeTable);
  const voidOpenChange = useStableCallback(onVoidOpenChange);
  const voidConfirm = useStableCallback(onVoidConfirm);
  const moveTableOpenChange = useStableCallback(onMoveTableOpenChange);
  const moved = useStableCallback(onMoved);

  return (
    <>
      <ModifierModal
        product={modifierProduct}
        open={modifierOpen}
        onOpenChange={modifierOpenChange}
        onConfirm={modifierConfirm}
      />

      <PaymentModal
        open={paymentOpen}
        onOpenChange={paymentOpenChange}
        {...totals}
        customer={customer}
        tableNo={tableNo}
        receiver={receiver}
        isSubmitting={isSubmitting}
        onConfirm={paymentConfirm}
        onSelectCustomer={onSelectCustomer ? selectCustomer : undefined}
      />

      <PosPrompts
        closeConfirmOpen={closeConfirmOpen}
        onCloseConfirmOpenChange={closeConfirmOpenChange}
        onConfirmCloseTab={confirmCloseTab}
        resumeConfirmOpen={resumeConfirmOpen}
        onCancelResume={cancelResume}
        onConfirmResume={confirmResume}
        freeTablePrompt={freeTablePrompt}
        onDismissFreeTable={dismissFreeTable}
        onConfirmFreeTable={confirmFreeTable}
        freeingTable={freeingTable}
      />

      <VoidItemDialog
        open={voidOpen}
        onOpenChange={voidOpenChange}
        order={resumedOrder}
        isPending={voidPending}
        onConfirm={voidConfirm}
      />

      <MoveTableDialog
        order={resumedOrder}
        open={moveTableOpen}
        onOpenChange={moveTableOpenChange}
        onMoved={moved}
      />
    </>
  );
}
