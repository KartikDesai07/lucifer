"use client";

import type { Ref } from "react";

import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import type { KotVariant } from "@/hooks/use-pos-print";
import type { Order, OrderItem, Settings } from "@/types";

interface PrintSourcesProps {
  order: Order | null;
  settings: Settings | null | undefined;
  kotRef: Ref<HTMLDivElement>;
  kotRoundItems?: OrderItem[] | null;
  kotRoundLabel?: string;
  // The ticket number the server allocated for THIS slip — round n's own
  // number, or a void slip's. Undefined on a full reprint, which matches no
  // single ticket the kitchen was handed.
  kotRoundNumber?: number;
  kotVariant: KotVariant;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  // Omitted for a KOT-only page (requests/page.tsx) — an accept never
  // collects money, so there is no customer receipt to render off-screen.
  receiptRef?: Ref<HTMLDivElement>;
}

// Off-screen print sources cloned by react-to-print — lifted out of
// pos/page.tsx (and the KOT-only half duplicated in requests/page.tsx) so
// both pages share one component instead of two hand-copied JSX blocks.
export function PrintSources({
  order,
  settings,
  kotRef,
  kotRoundItems,
  kotRoundLabel,
  kotRoundNumber,
  kotVariant,
  voidReason,
  voidedBy,
  voidedAt,
  receiptRef,
}: PrintSourcesProps) {
  return (
    <div
      className="pointer-events-none absolute left-[-9999px] top-0"
      aria-hidden
    >
      {receiptRef && (
        <OrderReceipt order={order} settings={settings} ref={receiptRef} />
      )}
      <KOTReceipt
        order={order}
        settings={settings}
        roundItems={kotRoundItems ?? undefined}
        roundLabel={kotRoundLabel}
        roundNumber={kotRoundNumber}
        variant={kotVariant}
        reason={voidReason}
        voidedBy={voidedBy}
        voidedAt={voidedAt}
        ref={kotRef}
      />
    </div>
  );
}
