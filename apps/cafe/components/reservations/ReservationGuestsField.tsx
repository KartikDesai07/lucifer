"use client";

import { MENU_EDITOR_ERROR_CLASS, MENU_EDITOR_LABEL_CLASS } from "@/lib/menu-editor-layout";
import {
  RES_FORM_COUNT_CLASS,
  RES_FORM_GROUP_CLASS,
  RES_FORM_GUESTS_ROW_CLASS,
  RES_FORM_HEAD_CLASS,
  RES_FORM_HINT_CLASS,
  RES_FORM_OFF_CLASS,
  RES_FORM_ON_CLASS,
  RES_FORM_QUICK_CLASS,
  RES_FORM_STEPPER_CLASS,
  RES_FORM_STEP_CLASS,
} from "@/lib/reservation-form-layout";
import { cn } from "@/lib/utils";

/** The quick party sizes next to the stepper. */
const QUICK_GUESTS = [2, 4, 6, 8, 10] as const;
/** From this party size the form suggests joining tables. */
const LARGE_PARTY = 8;

interface ReservationGuestsFieldProps {
  /** NaN while the count box is empty. */
  value: number;
  onChange: (next: number) => void;
  error?: string;
}

/** Guests (values 13.2 #1): "−  n  +" (44px, the count typeable, at least 1, no maximum) and the quick chips 2 4 6 8 10. */
export function ReservationGuestsField({ value, onChange, error }: ReservationGuestsFieldProps) {
  const set = Number.isFinite(value);
  return (
    <div data-ui="reservation-form-guests" role="group" aria-label="Guests" className={RES_FORM_GROUP_CLASS}>
      <div className={RES_FORM_HEAD_CLASS}>
        <span className={MENU_EDITOR_LABEL_CLASS}>Guests</span>
        <span className={RES_FORM_HINT_CLASS}>{set && value >= LARGE_PARTY ? "Large party · consider joining tables" : ""}</span>
      </div>
      <div className={RES_FORM_GUESTS_ROW_CLASS}>
        <div className={RES_FORM_STEPPER_CLASS}>
          <button type="button" data-ui="reservation-form-minus" aria-label="One guest fewer" className={RES_FORM_STEP_CLASS} onClick={() => onChange(Math.max(1, (set ? value : 1) - 1))}>
            −
          </button>
          <input
            data-ui="reservation-form-count"
            inputMode="numeric"
            aria-label="Number of guests"
            aria-invalid={error ? true : undefined}
            className={RES_FORM_COUNT_CLASS}
            value={set ? String(value) : ""}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "");
              onChange(digits === "" ? Number.NaN : Number(digits));
            }}
          />
          <button type="button" data-ui="reservation-form-plus" aria-label="One guest more" className={RES_FORM_STEP_CLASS} onClick={() => onChange((set ? value : 0) + 1)}>
            +
          </button>
        </div>
        {QUICK_GUESTS.map((n) => (
          <button
            key={n}
            type="button"
            data-ui="reservation-form-quick"
            aria-pressed={value === n}
            className={cn(RES_FORM_QUICK_CLASS, value === n ? RES_FORM_ON_CLASS : RES_FORM_OFF_CLASS)}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      {error && <span className={MENU_EDITOR_ERROR_CLASS}>{error}</span>}
    </div>
  );
}
