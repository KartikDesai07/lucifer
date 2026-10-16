"use client";

import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createStaffSchema } from "@/schemas";
import { STAFF_ROLES } from "@/lib/constants";
import { STAFF_PIN_MESSAGES, staffPinProblem } from "@pos/shared/staff-pin";
import { useCreateStaff, useRevealStaffPin, useUpdateStaff } from "@/hooks/use-staff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BRAND_CONTROL_CLASS } from "@/components/brand/brand-classes";
import { FormSheet } from "@/components/shared/FormSheet";
import { FormField } from "@/components/shared/FormField";
import type { Staff } from "@/types";

// One schema for both modes — password is optional here and required only on
// create (checked manually below); on edit, passwords are changed by the user
// from their own account menu. `role` has a default, so input ≠ output.
const staffFormSchema = createStaffSchema
  .pick({ name: true, mobile: true, username: true, role: true })
  .extend({ password: z.string().optional(), pin: z.string().optional() });

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
  const revealPin = useRevealStaffPin();
  const isEdit = !!staff;
  const [shownPin, setShownPin] = useState<string | null | undefined>(undefined);
  // The member the sheet shows now: a reveal answering after the sheet closed or moved on is dropped.
  const shownFor = useRef<string | undefined>(undefined);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = useForm<StaffFormValues, unknown, StaffFormData>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: { name: "", mobile: "", username: "", password: "", pin: "", role: "staff" },
  });

  useEffect(() => {
    shownFor.current = open ? staff?._id : undefined;
    setShownPin(undefined);
    if (!open) return;
    reset(
      staff
        ? {
            name: staff.name,
            mobile: staff.mobile,
            username: staff.username,
            password: "",
            pin: "",
            role: staff.role,
          }
                : { name: "", mobile: "", username: "", password: "", pin: "", role: "staff" },
    );
  }, [open, staff, reset]);

  const onSubmit = async (values: StaffFormData) => {
    try {
      const pin = values.pin ?? "";
      if (isEdit) {
        // A blank New PIN keeps the current one; a typed one must pass the same check as on create.
        const problem = pin === "" ? null : staffPinProblem(pin);
        if (problem) {
          setError("pin", { message: STAFF_PIN_MESSAGES[problem] });
          return;
        }
        await updateStaff.mutateAsync({
          id: staff._id,
          data: {
            name: values.name,
            mobile: values.mobile,
            username: values.username,
            role: values.role,
            ...(pin !== "" ? { pin } : {}),
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
        const problem = staffPinProblem(pin);
        if (problem) {
          setError("pin", { message: STAFF_PIN_MESSAGES[problem] });
          return;
        }
        await createStaff.mutateAsync({
          name: values.name,
          mobile: values.mobile,
          username: values.username,
          role: values.role,
          password: values.password,
          pin,
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
          className={BRAND_CONTROL_CLASS}
          aria-invalid={!!errors.name}
          {...register("name")}
        />
      </FormField>

      <FormField label="Mobile" htmlFor="staff-mobile" error={errors.mobile?.message}>
        <Input
          id="staff-mobile"
          inputMode="numeric"
          placeholder="10-digit number"
          className={BRAND_CONTROL_CLASS}
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
          className={BRAND_CONTROL_CLASS}
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
            className={BRAND_CONTROL_CLASS}
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <p className="text-xs text-muted-foreground">
            At least {MIN_PASSWORD} characters.
          </p>
        </FormField>
      )}

      <FormField
        label={isEdit ? "New PIN" : "PIN (4 digits)"}
        htmlFor="staff-pin"
        error={errors.pin?.message}
      >
        <div className="flex items-center gap-2">
          <Input
            id="staff-pin"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            placeholder={isEdit ? "Leave blank to keep the current PIN" : undefined}
            className={BRAND_CONTROL_CLASS}
            aria-invalid={!!errors.pin}
            {...register("pin")}
          />
          {isEdit && staff && (
            <Button
              type="button"
              variant="outline"
              className={BRAND_CONTROL_CLASS}
              disabled={revealPin.isPending}
              onClick={() => {
                const askedFor = staff._id;
                revealPin.mutate(askedFor, {
                  onSuccess: (r) => {
                    if (shownFor.current === askedFor) setShownPin(r.pin);
                  },
                });
              }}
            >
              Show
            </Button>
          )}
        </div>
        {isEdit && shownPin !== undefined && (
          <p className="text-sm">
            {shownPin === null ? (
              "No PIN set yet."
            ) : (
              <>
                Current PIN: <span className="font-mono font-semibold tracking-widest">{shownPin}</span>
              </>
            )}
          </p>
        )}
        {!isEdit && (
          <p className="text-xs text-muted-foreground">
            Used to unlock the screen and to sign in on this device.
          </p>
        )}
      </FormField>

      <FormField label="Role">
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className={BRAND_CONTROL_CLASS}>
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
