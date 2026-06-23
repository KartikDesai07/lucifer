"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createStaffSchema } from "@/schemas";
import { STAFF_ROLES } from "@/lib/constants";
import { useCreateStaff, useUpdateStaff } from "@/hooks/use-staff";
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
import type { Staff } from "@/types";

// One schema for both modes — password is optional here and required only on
// create (checked manually below); on edit, passwords are changed by the user
// from their own account menu. `role` has a default, so input ≠ output.
const staffFormSchema = createStaffSchema
  .pick({ name: true, mobile: true, username: true, role: true })
  .extend({ password: z.string().optional() });

type StaffFormValues = z.input<typeof staffFormSchema>;
type StaffFormData = z.output<typeof staffFormSchema>;

const MIN_PASSWORD = 8;

interface StaffFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: Staff | null; // null → create
}

export function StaffFormSheet({
  open,
  onOpenChange,
  staff,
}: StaffFormSheetProps) {
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();
  const isEdit = !!staff;

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<StaffFormValues, unknown, StaffFormData>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: { name: "", mobile: "", username: "", password: "", role: "staff" },
  });

  useEffect(() => {
    if (!open) return;
    reset(
      staff
        ? {
            name: staff.name,
            mobile: staff.mobile,
            username: staff.username,
            password: "",
            role: staff.role,
          }
        : { name: "", mobile: "", username: "", password: "", role: "staff" },
    );
  }, [open, staff, reset]);

  const onSubmit = async (values: StaffFormData) => {
    try {
      if (isEdit) {
        await updateStaff.mutateAsync({
          id: staff._id,
          data: {
            name: values.name,
            mobile: values.mobile,
            username: values.username,
            role: values.role,
          },
        });
      } else {
        // Password is optional in the schema (so edit can skip it); enforce it here.
        if (!values.password || values.password.length < MIN_PASSWORD) {
          setError("password", {
            message: `Password must be at least ${MIN_PASSWORD} characters`,
          });
          return;
        }
        await createStaff.mutateAsync({
          name: values.name,
          mobile: values.mobile,
          username: values.username,
          role: values.role,
          password: values.password,
          isActive: true,
        });
      }
      onOpenChange(false);
    } catch {
      // hooks toast on error (e.g. duplicate username)
    }
  };

  const saving = createStaff.isPending || updateStaff.isPending;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit staff" : "Add staff"}
      description={
        isEdit
          ? "Update this team member's details."
          : "Create a login for a new team member."
      }
      submitLabel={isEdit ? "Save changes" : "Add staff"}
      saving={saving}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormField label="Name" htmlFor="staff-name" error={errors.name?.message}>
        <Input
          id="staff-name"
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name")}
        />
      </FormField>

      <FormField label="Mobile" htmlFor="staff-mobile" error={errors.mobile?.message}>
        <Input
          id="staff-mobile"
          inputMode="numeric"
          aria-invalid={!!errors.mobile}
          {...register("mobile")}
        />
      </FormField>

      <FormField
        label="Username"
        htmlFor="staff-username"
        error={errors.username?.message}
      >
        <Input
          id="staff-username"
          autoComplete="off"
          aria-invalid={!!errors.username}
          {...register("username")}
        />
      </FormField>

      {!isEdit && (
        <FormField
          label="Password"
          htmlFor="staff-password"
          error={errors.password?.message}
        >
          <Input
            id="staff-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
        </FormField>
      )}

      <FormField label="Role">
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAFF_ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>

      {isEdit && (
        <p className="text-xs text-muted-foreground">
          Passwords are changed by the team member from their own account menu.
        </p>
      )}
    </FormSheet>
  );
}
