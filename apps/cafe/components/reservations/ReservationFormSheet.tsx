"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createReservationSchema } from "@/schemas";
import {
  useCreateReservation,
  useUpdateReservation,
} from "@/hooks/use-reservations";
import { useTables } from "@/hooks/use-tables";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSheet } from "@/components/shared/FormSheet";
import { FormField } from "@/components/shared/FormField";
import type { Reservation } from "@/types";

const reservationFormSchema = createReservationSchema.pick({
  name: true,
  mobile: true,
  date: true,
  time: true,
  guests: true,
  tableNo: true,
  notes: true,
});
type ReservationFormInput = z.infer<typeof reservationFormSchema>;

// Radix Select can't use "" as an item value, so "unassigned" needs a sentinel.
// It must be a string no real table can be called: table names are now free text
// (CR1.1), and a cafe naming a table "none" would otherwise collide with this and
// silently lose the assignment. TABLE_NO_PATTERN requires an alphanumeric first
// character, so a leading underscore is unnameable by construction.
const UNASSIGNED = "__unassigned__";

const emptyValues: ReservationFormInput = {
  name: "",
  mobile: "",
  date: "",
  time: "",
  guests: 2,
  tableNo: undefined,
  notes: "",
};

interface ReservationFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservation: Reservation | null; // null → create
}

export function ReservationFormSheet({
  open,
  onOpenChange,
  reservation,
}: ReservationFormSheetProps) {
  const createReservation = useCreateReservation();
  const updateReservation = useUpdateReservation();
  const tables = useTables();
  const isEdit = !!reservation;

  // Live floor plan, plus the reservation's own saved table if it's since been
  // renamed or removed — the select must keep showing that value, not silently
  // clear it out from under an existing booking. It is labelled as gone so the
  // operator can tell a real table from a stale one and re-seat the booking.
  const liveTableNos = (tables.data ?? []).map((t) => t.tableNo);
  const tableOptions: { value: string; label: string }[] = liveTableNos.map((t) => ({
    value: t,
    label: t,
  }));
  if (reservation?.tableNo && !liveTableNos.includes(reservation.tableNo)) {
    tableOptions.push({
      value: reservation.tableNo,
      label: `${reservation.tableNo} (no longer on the floor plan)`,
    });
  }

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<ReservationFormInput>({
    resolver: zodResolver(reservationFormSchema),
    defaultValues: emptyValues,
  });

  useEffect(() => {
    if (!open) return;
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
        : emptyValues,
    );
  }, [open, reservation, reset]);

  const onSubmit = async (values: ReservationFormInput) => {
    const payload = {
      ...values,
      tableNo: values.tableNo || undefined,
    };
    try {
      if (isEdit) {
        await updateReservation.mutateAsync({
          id: reservation._id,
          data: payload,
        });
      } else {
        await createReservation.mutateAsync({ ...payload, status: "Booked" });
      }
      onOpenChange(false);
    } catch {
      // hooks toast on error
    }
  };

  const saving = createReservation.isPending || updateReservation.isPending;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit reservation" : "New reservation"}
      description={
        isEdit ? "Update this booking's details." : "Book a table for a guest."
      }
      submitLabel={isEdit ? "Save changes" : "Book reservation"}
      saving={saving}
      onSubmit={handleSubmit(onSubmit)}
      contentClassName="overflow-y-auto"
    >
      <FormField label="Guest name" htmlFor="res-name" error={errors.name?.message}>
        <Input
          id="res-name"
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name")}
        />
      </FormField>

      <FormField label="Mobile" htmlFor="res-mobile" error={errors.mobile?.message}>
        <Input
          id="res-mobile"
          inputMode="numeric"
          aria-invalid={!!errors.mobile}
          {...register("mobile")}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date" htmlFor="res-date" error={errors.date?.message}>
          <Input
            id="res-date"
            type="date"
            aria-invalid={!!errors.date}
            {...register("date")}
          />
        </FormField>
        <FormField label="Time" htmlFor="res-time" error={errors.time?.message}>
          <Input
            id="res-time"
            type="time"
            aria-invalid={!!errors.time}
            {...register("time")}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="Guests"
          htmlFor="res-guests"
          error={errors.guests?.message}
        >
          <Input
            id="res-guests"
            type="number"
            min={1}
            aria-invalid={!!errors.guests}
            {...register("guests", { valueAsNumber: true })}
          />
        </FormField>
        <FormField label="Table">
          <Controller
            control={control}
            name="tableNo"
            render={({ field }) => (
              <Select
                value={field.value || UNASSIGNED}
                onValueChange={(v) =>
                  field.onChange(v === UNASSIGNED ? undefined : v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {tableOptions.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
      </div>

      <FormField label="Notes" htmlFor="res-notes">
        <Textarea
          id="res-notes"
          rows={2}
          placeholder="Any special requests…"
          {...register("notes")}
        />
      </FormField>
    </FormSheet>
  );
}
