import { z } from "zod";
import { STAFF_ROLES } from "@/lib/constants";

// Login credentials — shared by the login form and the authorize() callback.
export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

// Admin-only staff creation. Username is stored lowercase by the Staff model
// (lowercase:true), matching how authorize() looks accounts up.
export const createStaffSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  mobile: z.string().trim().min(10, "Enter a valid mobile number"),
  username: z.string().trim().min(3, "Username must be at least 3 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(STAFF_ROLES).default("staff"),
  isActive: z.boolean().default(true),
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

// Admin-only staff update. Password is changed via changePasswordSchema only.
export const updateStaffSchema = createStaffSchema
  .omit({ password: true })
  .partial();
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

// Self-service password change for any signed-in user.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// Admin-initiated password reset for another staff member (no current password
// required — used when a team member is locked out and has forgotten theirs).
export const resetPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm the new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
