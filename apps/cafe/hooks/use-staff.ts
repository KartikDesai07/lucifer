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
//
// Master data (CB-DL-1): for an ADMIN session the list is seeded once per page
// load from GET /api/bootstrap (MasterDataProvider); a non-admin session gets no
// staff part at all, so this key stays empty until something actually reads it
// and the route's own admin gate answers. Freshness window is the blob's 24h;
// a page refresh re-fetches the bootstrap.
const staffHooks = createCrudHooks<Staff, CreateStaffInput, UpdateStaffInput>({
  path: "/api/staff",
  rootKey: STAFF_KEYS.all,
  staleTime: STALE_TIMES.MASTERS,
  gcTime: GC_TIMES.MASTERS,
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
