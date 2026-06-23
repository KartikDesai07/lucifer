"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createReservationSchema } from "@/schemas";
import { TABLE_NUMBERS } from "@/lib/constants";
import {
  useCreateReservation,
  useUpdateReservation,
} from "@/hooks/use-reservations";
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

const UNASSIGNED = "none"; // Radix Select can't use "" as an item value

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
  const isEdit = !!reservation;

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
                  {TABLE_NUMBERS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
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
