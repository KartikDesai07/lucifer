"use client";

import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2 } from "lucide-react";

import { createReservationSchema } from "@/schemas";
import { useReservationCreate, useReservationUpdate } from "@/hooks/use-reservation-writes";
import { MENU_EDITOR_ERROR_CLASS, MENU_EDITOR_FIELD_CLASS, MENU_EDITOR_LABEL_CLASS } from "@/lib/menu-editor-layout";
import { createPayload, editPayload, formDefaults, knownName, returningGuestLine, summaryLine, type FormValues } from "@/lib/reservation-form";
import {
  RES_FORM_DELETE_CLASS,
  RES_FORM_GROUP_CLASS,
  RES_FORM_GUEST_INFO_CLASS,
  RES_FORM_INPUT_CLASS,
  RES_FORM_NOTE_CLASS,
  RES_FORM_PAIR_CLASS,
  RES_FORM_PHONE_BOX_CLASS,
  RES_FORM_PHONE_INPUT_CLASS,
  RES_FORM_PREFIX_CLASS,
  RES_FORM_SAVE_CLASS,
  RES_FORM_SUMMARY_BAD_CLASS,
  RES_FORM_SUMMARY_CLASS,
  RES_FORM_SUMMARY_TEXT_CLASS,
} from "@/lib/reservation-form-layout";
import { updatedToast } from "@/lib/reservations-toasts";
import { cn } from "@/lib/utils";
import { ReservationDayTimeFields } from "@/components/reservations/ReservationDayTimeFields";
import { ReservationFormFrame } from "@/components/reservations/ReservationFormFrame";
import { ReservationGuestsField } from "@/components/reservations/ReservationGuestsField";
import { ReservationTableField } from "@/components/reservations/ReservationTableField";
import type { Reservation, Table } from "@/types";

// The same rules as ever (today's zod messages), on the fields the form holds.
const reservationFormSchema = createReservationSchema.pick({
  name: true,
  mobile: true,
  date: true,
  time: true,
  guests: true,
  tableNo: true,
  notes: true,
});

/** Book again (U6 Task 2): the guest's name, mobile and party seed a NEW booking. */
export interface ReservationPrefill {
  name: string;
  mobile: string;
  guests: number;
}

interface ReservationFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservation: Reservation | null; // null → create
  prefill?: ReservationPrefill; // seeds a create only
  /** The one list and the floor plan the page already holds (no request of the form's own), and the page's clock. */
  list: readonly Reservation[];
  tables: readonly Table[] | undefined;
  today: string;
  nowMs: number;
  /** The day the page shows ("all" = All dates): a new booking opens on it when it is today or later (B20). */
  shownDay: string | "all";
  /** After a create: the page shows that booking's day (B20). */
  onCreated: (day: string) => void;
  /** Delete reservation (edit only): the page's confirm opens over the form. */
  onDelete: (r: Reservation) => void;
}

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none text-subtle-foreground">
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
  </svg>
);
const PersonIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />
  </svg>
);

/** The reservation form (U6 Task 4; values 13; design 8.1): create and edit in the HTML's look. The create and the edit run their
 *  OWN write instances (the page's status instance stays the status writes' busy flag). Mobile number first: ten digits fill an
 *  empty name from an earlier booking and show the returning-guest line. Validation is today's zod messages. */
export function ReservationFormSheet({ open, onOpenChange, reservation, prefill, list, tables, today, nowMs, shownDay, onCreated, onDelete }: ReservationFormSheetProps) {
  const createReservation = useReservationCreate();
  const updateReservation = useReservationUpdate();
  const isEdit = !!reservation;
  const editingId = reservation?._id ?? null;
  const [failed, setFailed] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    getValues,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(reservationFormSchema),
    defaultValues: formDefaults({ shownDay, today }),
  });

  // The opening values read the page's day and clock as they are when the form opens; a later tick never resets what is typed.
  const latest = useRef({ shownDay, today });
  useEffect(() => {
    latest.current = { shownDay, today };
  });
  useEffect(() => {
    if (!open) return;
    setFailed(false);
    reset(
      reservation
        ? {
            name: reservation.name,
            mobile: reservation.mobile,
            date: reservation.date,
            time: reservation.time,
            guests: reservation.guests,
            tableNo: reservation.tableNo,
            notes: reservation.notes ?? "",
          }
        : formDefaults({ ...latest.current, prefill }),
    );
  }, [open, reservation, prefill, reset]);

  const values = watch();

  const onSubmit = async (v: FormValues) => {
    setFailed(false);
    try {
      if (reservation) {
        await updateReservation.mutateAsync({ id: reservation._id, data: editPayload(v, reservation), toast: updatedToast });
      } else {
        const saved = await createReservation.mutateAsync(createPayload(v));
        onCreated(saved.date);
      }
      onOpenChange(false);
    } catch {
      // the hooks toast on error; the form stays with what was typed
    }
  };

  const saving = createReservation.isPending || updateReservation.isPending;
  const hasErrors = Object.keys(errors).length > 0;
  const returning = returningGuestLine(list, values.mobile ?? "", editingId ?? "");
  const sub = !reservation ? "Book a table for a guest" : `${reservation.name} · ${reservation.status === "Seated" ? "seated" : "booking"}`;

  return (
    <ReservationFormFrame
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit reservation" : "New reservation"}
      sub={sub}
      onSubmit={handleSubmit(onSubmit, () => setFailed(true))}
      footer={
        <>
          <div data-ui="reservation-form-summary" className={RES_FORM_SUMMARY_CLASS}>
            <ClockIcon />
            <span className={cn(RES_FORM_SUMMARY_TEXT_CLASS, failed && hasErrors && RES_FORM_SUMMARY_BAD_CLASS)}>
              {failed && hasErrors ? "Fix the highlighted fields to continue" : summaryLine(values)}
            </span>
          </div>
          <button type="submit" data-ui="reservation-form-save" className={RES_FORM_SAVE_CLASS} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isEdit ? "Save changes" : "Book table"}
          </button>
        </>
      }
    >
      <div className={RES_FORM_PAIR_CLASS}>
        <div className={MENU_EDITOR_FIELD_CLASS}>
          <label htmlFor="res-mobile" className={MENU_EDITOR_LABEL_CLASS}>
            Mobile number
          </label>
          <div className={RES_FORM_PHONE_BOX_CLASS}>
            <span className={RES_FORM_PREFIX_CLASS}>+91</span>
            <Controller
              control={control}
              name="mobile"
              render={({ field }) => (
                <input
                  id="res-mobile"
                  ref={field.ref}
                  data-autofocus=""
                  inputMode="numeric"
                  placeholder="10-digit mobile"
                  aria-invalid={errors.mobile ? true : undefined}
                  className={RES_FORM_PHONE_INPUT_CLASS}
                  value={field.value ?? ""}
                  onBlur={field.onBlur}
                  onChange={(e) => {
                    field.onChange(e.target.value);
                    // Ten digits and an empty name: the name of the earlier booking on that number.
                    const known = knownName(list, e.target.value, editingId ?? "");
                    if (known && getValues("name").trim() === "") setValue("name", known, { shouldValidate: !!errors.name });
                  }}
                />
              )}
            />
          </div>
          {returning && (
            <div data-ui="reservation-form-returning" className={RES_FORM_GUEST_INFO_CLASS}>
              <PersonIcon />
              <span className="min-w-0">{returning}</span>
            </div>
          )}
          {errors.mobile && <span className={MENU_EDITOR_ERROR_CLASS}>{errors.mobile.message}</span>}
        </div>
        <div className={MENU_EDITOR_FIELD_CLASS}>
          <label htmlFor="res-name" className={MENU_EDITOR_LABEL_CLASS}>
            Guest name
          </label>
          <input id="res-name" placeholder="Who is the booking for?" aria-invalid={errors.name ? true : undefined} className={RES_FORM_INPUT_CLASS} {...register("name")} />
          {errors.name && <span className={MENU_EDITOR_ERROR_CLASS}>{errors.name.message}</span>}
        </div>
      </div>

      <Controller control={control} name="guests" render={({ field }) => <ReservationGuestsField value={field.value} onChange={field.onChange} error={errors.guests?.message} />} />

      <ReservationDayTimeFields
        date={values.date}
        time={values.time}
        onDate={(d) => setValue("date", d, { shouldValidate: !!errors.date, shouldDirty: true })}
        onTime={(t) => setValue("time", t, { shouldValidate: !!errors.time, shouldDirty: true })}
        list={list}
        editingId={editingId}
        today={today}
        nowMs={nowMs}
        dateError={errors.date?.message}
        timeError={errors.time?.message}
      />

      <ReservationTableField
        tables={tables}
        values={values}
        onPick={(t) => setValue("tableNo", t, { shouldDirty: true })}
        list={list}
        editingId={editingId}
        today={today}
        nowMs={nowMs}
      />

      <div className={RES_FORM_GROUP_CLASS}>
        <label htmlFor="res-notes" className={MENU_EDITOR_LABEL_CLASS}>
          Occasion &amp; requests
        </label>
        <textarea id="res-notes" rows={2} placeholder="Notes for the team · e.g. cake at 9:30, allergic to peanuts" className={RES_FORM_NOTE_CLASS} {...register("notes")} />
      </div>

      {reservation && (
        <button type="button" data-ui="reservation-form-delete" className={RES_FORM_DELETE_CLASS} onClick={() => onDelete(reservation)}>
          <Trash2 className="size-[15px]" strokeWidth={1.8} aria-hidden="true" />
          Delete reservation
        </button>
      )}
    </ReservationFormFrame>
  );
}
