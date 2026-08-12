"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createCustomerSchema } from "@/schemas";
import { CUSTOMER_NOTES } from "@/lib/constants";
import { useCreateCustomer, useUpdateCustomer } from "@/hooks/use-customers";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSheet } from "@/components/shared/FormSheet";
import { FormField } from "@/components/shared/FormField";
import type { Customer } from "@/types";

// Only the human-editable fields — visits/totalSpend/totalDue are derived from
// orders and must never be reset by an edit.
const customerFormSchema = createCustomerSchema.pick({
  name: true,
  mobile: true,
  notes: true,
});
// `notes` has a zod default → input type is optional but output is required.
type CustomerFormValues = z.input<typeof customerFormSchema>;
type CustomerFormData = z.output<typeof customerFormSchema>;

interface CustomerFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: Customer | null; // null → create
}

export function CustomerFormSheet({
  open,
  onOpenChange,
  customer,
}: CustomerFormSheetProps) {
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const isEdit = !!customer;

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CustomerFormValues, unknown, CustomerFormData>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: { name: "", mobile: "", notes: "Regular" },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      customer
        ? { name: customer.name, mobile: customer.mobile, notes: customer.notes }
        : { name: "", mobile: "", notes: "Regular" },
    );
  }, [open, customer, reset]);

  const onSubmit = async (values: CustomerFormData) => {
    try {
      if (isEdit) {
        await updateCustomer.mutateAsync({ id: customer._id, data: values });
      } else {
        // visits/totalSpend/totalDue are server-owned and seeded to 0 on create.
        await createCustomer.mutateAsync(values);
      }
      onOpenChange(false);
    } catch {
      // hooks toast on error
    }
  };

  const saving = createCustomer.isPending || updateCustomer.isPending;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit customer" : "Add customer"}
      description={
        isEdit
          ? "Update this customer's details."
          : "Add a new customer to the CRM."
      }
      submitLabel={isEdit ? "Save changes" : "Add customer"}
      saving={saving}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormField label="Name" htmlFor="customer-name" error={errors.name?.message}>
        <Input
          id="customer-name"
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name")}
        />
      </FormField>

      <FormField
        label="Mobile"
        htmlFor="customer-mobile"
        error={errors.mobile?.message}
      >
        <Input
          id="customer-mobile"
          inputMode="numeric"
          placeholder="10-digit number"
          aria-invalid={!!errors.mobile}
          {...register("mobile")}
        />
      </FormField>

      <FormField label="Type">
        <Controller
          control={control}
          name="notes"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_NOTES.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
    </FormSheet>
  );
}
