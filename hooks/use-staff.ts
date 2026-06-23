"use client";

import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiSend } from "@/lib/api-client";
import { createCrudHooks } from "@/hooks/create-crud-hooks";
import { STALE_TIMES, GC_TIMES } from "@/lib/query";
import type {
  Staff,
  CreateStaffInput,
  UpdateStaffInput,
  ResetPasswordInput,
} from "@/types";

export const STAFF_KEYS = {
  all: ["staff"] as const,
};

// Admin-only staff list (never includes passwords). Delete is a soft deactivate
// server-side; the route blocks an admin deactivating self / the last admin.
const staffHooks = createCrudHooks<Staff, CreateStaffInput, UpdateStaffInput>({
  path: "/api/staff",
  rootKey: STAFF_KEYS.all,
  staleTime: STALE_TIMES.STAFF,
  gcTime: GC_TIMES.DEFAULT,
  messages: {
    created: "Staff member added",
    updated: "Staff member updated",
    deleted: "Staff member deactivated",
    createError: "Could not add staff",
    updateError: "Could not update staff",
    deleteError: "Could not deactivate staff",
  },
});

export const useStaff = staffHooks.useList;
export const useCreateStaff = staffHooks.useCreate;
export const useUpdateStaff = staffHooks.useUpdate;
export const useDeleteStaff = staffHooks.useRemove;

// Admin override: set a new password for a locked-out staff member. Doesn't
// touch the staff list, so no cache invalidation is needed.
export function useResetStaffPassword() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ResetPasswordInput }) =>
      apiSend<{ updated: true }>(
        `/api/staff/${id}/reset-password`,
        "POST",
        data,
      ),
    onSuccess: () => toast.success("Password reset"),
    onError: (err: Error) =>
      toast.error(err.message || "Could not reset password"),
  });
}
