"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createEventSchema } from "@/schemas";
import { EVENT_PAY_MODES } from "@/lib/constants";
import { useCreateEvent, useUpdateEvent } from "@/hooks/use-events";
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
import type { Event } from "@/types";

const eventFormSchema = createEventSchema.pick({
  name: true,
  mobile: true,
  date: true,
  time: true,
  eventName: true,
  notes: true,
  payable: true,
  advance: true,
  payMode: true,
});
// `advance` has a zod default → input ≠ output.
type EventFormValues = z.input<typeof eventFormSchema>;
type EventFormData = z.output<typeof eventFormSchema>;

const emptyValues: EventFormValues = {
  name: "",
  mobile: "",
  date: "",
  time: "",
  eventName: "",
  notes: "",
  payable: 0,
  advance: 0,
  payMode: "Cash",
};

interface EventFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event | null; // null → create
}

export function EventFormSheet({
  open,
  onOpenChange,
  event,
}: EventFormSheetProps) {
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const isEdit = !!event;

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<EventFormValues, unknown, EventFormData>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: emptyValues,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      event
        ? {
            name: event.name,
            mobile: event.mobile,
            date: event.date,
            time: event.time,
            eventName: event.eventName,
            notes: event.notes ?? "",
            payable: event.payable,
            advance: event.advance,
            payMode: event.payMode,
          }
        : emptyValues,
    );
  }, [open, event, reset]);

  const onSubmit = async (values: EventFormData) => {
    try {
      if (isEdit) {
        await updateEvent.mutateAsync({ id: event._id, data: values });
      } else {
        await createEvent.mutateAsync({ ...values, status: "Booked" });
      }
      onOpenChange(false);
    } catch {
      // hooks toast on error
    }
  };

  const saving = createEvent.isPending || updateEvent.isPending;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit event" : "New event"}
      description={
        isEdit
          ? "Update this event booking."
          : "Book an event with advance payment."
      }
      submitLabel={isEdit ? "Save changes" : "Book event"}
      saving={saving}
      onSubmit={handleSubmit(onSubmit)}
      contentClassName="overflow-y-auto"
    >
      <FormField
        label="Event name"
        htmlFor="evt-name"
        error={errors.eventName?.message}
      >
        <Input
          id="evt-name"
          autoFocus
          placeholder="e.g. Birthday party"
          aria-invalid={!!errors.eventName}
          {...register("eventName")}
        />
      </FormField>

      <FormField
        label="Customer name"
        htmlFor="evt-customer"
        error={errors.name?.message}
      >
        <Input
          id="evt-customer"
          aria-invalid={!!errors.name}
          {...register("name")}
        />
      </FormField>

      <FormField label="Mobile" htmlFor="evt-mobile" error={errors.mobile?.message}>
        <Input
          id="evt-mobile"
          inputMode="numeric"
          aria-invalid={!!errors.mobile}
          {...register("mobile")}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Date" htmlFor="evt-date" error={errors.date?.message}>
          <Input
            id="evt-date"
            type="date"
            aria-invalid={!!errors.date}
            {...register("date")}
          />
        </FormField>
        <FormField label="Time" htmlFor="evt-time" error={errors.time?.message}>
          <Input
            id="evt-time"
            type="time"
            aria-invalid={!!errors.time}
            {...register("time")}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="Payable (₹)"
          htmlFor="evt-payable"
          error={errors.payable?.message}
        >
          <Input
            id="evt-payable"
            type="number"
            min={0}
            aria-invalid={!!errors.payable}
            {...register("payable", { valueAsNumber: true })}
          />
        </FormField>
        <FormField
          label="Advance (₹)"
          htmlFor="evt-advance"
          error={errors.advance?.message}
        >
          <Input
            id="evt-advance"
            type="number"
            min={0}
            aria-invalid={!!errors.advance}
            {...register("advance", { valueAsNumber: true })}
          />
        </FormField>
      </div>

      <FormField label="Payment mode">
        <Controller
          control={control}
          name="payMode"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_PAY_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>

      <FormField label="Notes" htmlFor="evt-notes">
        <Textarea id="evt-notes" rows={2} {...register("notes")} />
      </FormField>
    </FormSheet>
  );
}
