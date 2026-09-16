"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/schemas/staff.schema";
import { useResetStaffPassword } from "@/hooks/use-staff";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Staff } from "@/types";

interface ResetPasswordDialogProps {
  // The staff member whose password is being reset; null closes the dialog.
  staff: Staff | null;
  onOpenChange: (open: boolean) => void;
}

// Admin-only: set a new password for a locked-out team member (they don't need
// to supply their current one). Self-service change lives in ChangePasswordDialog.
export function ResetPasswordDialog({
  staff,
  onOpenChange,
}: ResetPasswordDialogProps) {
  const resetPassword = useResetStaffPassword();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  // Clear the fields whenever a different member (or none) is selected.
  useEffect(() => {
    reset({ newPassword: "", confirmPassword: "" });
  }, [staff, reset]);

  const onSubmit = async (values: ResetPasswordInput) => {
    if (!staff) return;
    try {
      await resetPassword.mutateAsync({ id: staff._id, data: values });
      onOpenChange(false);
    } catch {
      // hook toasts on error
    }
  };

  return (
    <Dialog open={!!staff} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {staff?.name}. They can change it themselves
            after logging in.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="reset-newPassword">New password</Label>
            <Input
              id="reset-newPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.newPassword}
              {...register("newPassword")}
            />
            {errors.newPassword && (
              <p className="text-xs text-destructive">
                {errors.newPassword.message}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-confirmPassword">Confirm new password</Label>
            <Input
              id="reset-confirmPassword"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirmPassword}
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={resetPassword.isPending}>
              {resetPassword.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {resetPassword.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
