"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createCustomerSchema } from "@/schemas";
import { CUSTOMER_NOTES } from "@/lib/constants";
import { useCreateCustomer, useUpdateCustomer } from "@/hooks/use-customers";
import { useAuth } from "@/hooks/use-auth";
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
  const { isAdmin, isLoading } = useAuth();
  // Creating a customer always needs a real number typed in, whoever does it —
  // only EDITING an existing (possibly masked) mobile is admin-restricted.
  //
  // `isLoading` counts as permissive so the field does not flash read-only for
  // an admin while the session resolves. Nothing can be SAVED in that window —
  // `isLoading` is folded into `saving` below, which disables the submit — so
  // this only governs how the field looks, never what gets written.
  const canEditMobile = !isEdit || isAdmin || isLoading;

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
        await updateCustomer.mutateAsync({
          id: customer._id,
          // A staff client only ever holds the masked number, so it can only
          // send that mask back — omit mobile entirely rather than write it.
          data: canEditMobile
            ? values
            : { name: values.name, notes: values.notes },
        });
      } else {
        // visits/totalSpend/totalDue are server-owned and seeded to 0 on create.
        await createCustomer.mutateAsync(values);
      }
      onOpenChange(false);
    } catch {
      // hooks toast on error
    }
  };

  // Blocked while the session is still resolving, which closes the only window
  // where `canEditMobile` can be wrong: nothing can be submitted before the
  // role is known, so neither an admin's real edit nor a staff member's
  // mistaken one can be silently discarded by the route's strip.
  const saving =
    createCustomer.isPending || updateCustomer.isPending || isLoading;

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
          readOnly={!canEditMobile}
          {...register("mobile")}
        />
        {!canEditMobile && (
          <p className="text-xs text-muted-foreground">
            Only an admin can see or change the full number.
          </p>
        )}
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
