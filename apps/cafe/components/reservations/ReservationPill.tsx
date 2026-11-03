import { RES_PILL_NEUTRAL_CLASS, RES_PILL_SIZE_CLASS } from "@/lib/reservations-layout";
import type { ResPill } from "@/lib/reservations-view";
import { STATUS_CLASSES } from "@/lib/ui";
import { RESERVATION_PILL_KIND } from "@/lib/ui/status";
import { cn } from "@/lib/utils";

/** The status pill (values 8.2 / 8.3 / 10.3): the words and a 6px dot, in the tokens of RESERVATION_PILL_KIND (B15). */
export function ReservationPill({ kind, size, ui }: { kind: ResPill; size: keyof typeof RES_PILL_SIZE_CLASS; ui?: string }) {
  const tone = STATUS_CLASSES[RESERVATION_PILL_KIND[kind]];
  return (
    <span
      data-ui={ui ?? "reservations-pill"}
      className={cn("inline-flex flex-none items-center rounded-[999px] font-semibold whitespace-nowrap", RES_PILL_SIZE_CLASS[size], RESERVATION_PILL_KIND[kind] === "neutral" ? RES_PILL_NEUTRAL_CLASS : tone.pill)}
    >
      <span data-ui="reservations-pill-dot" aria-hidden="true" className={cn("size-1.5 flex-none rounded-[50%]", tone.dot)} />
      {kind}
    </span>
  );
}
