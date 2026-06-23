"use client";

import { useState } from "react";
import { Plus, Pencil, UserX, UserCheck, UserCog, KeyRound } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useStaff, useDeleteStaff, useUpdateStaff } from "@/hooks/use-staff";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminGuard } from "@/components/shared/AdminGuard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { StaffFormSheet } from "@/components/staff/StaffFormSheet";
import { ResetPasswordDialog } from "@/components/staff/ResetPasswordDialog";
import type { Staff } from "@/types";

export default function StaffPage() {
  return (
    <AdminGuard>
      <StaffManager />
    </AdminGuard>
  );
}

function StaffManager() {
  const { user } = useAuth();
  const staff = useStaff();
  const deleteStaff = useDeleteStaff();
  const updateStaff = useUpdateStaff();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [deactivating, setDeactivating] = useState<Staff | null>(null);
  const [resetting, setResetting] = useState<Staff | null>(null);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (member: Staff) => {
    setEditing(member);
    setFormOpen(true);
  };

  const confirmDeactivate = async () => {
    if (!deactivating) return;
    try {
      await deleteStaff.mutateAsync(deactivating._id);
      setDeactivating(null);
    } catch {
      // hook toasts on error (e.g. cannot deactivate self)
    }
  };

  const reactivate = (member: Staff) =>
    updateStaff.mutate({ id: member._id, data: { isActive: true } });

  const list = staff.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Staff</h2>
          <p className="text-sm text-muted-foreground">
            Manage team logins and roles. Admin only.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" /> Add staff
        </Button>
      </div>

      {staff.isLoading ? (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : staff.isError ? (
        <p className="text-sm text-destructive">
          Failed to load staff. Refresh to retry.
        </p>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<UserCog className="h-8 w-8" />}
          title="No staff yet"
          description="Add your first team member to give them a login."
          action={
            <Button onClick={openAdd} className="mt-2">
              <Plus className="mr-2 h-4 w-4" /> Add staff
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-36 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((member) => {
                const isSelf = member._id === user?.id;
                const protectedAccount = isSelf || member.role === "admin";
                return (
                  <TableRow key={member._id}>
                    <TableCell className="font-medium">
                      {member.name}
                      {isSelf && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.username}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.mobile}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={member.role === "admin" ? "default" : "secondary"}
                        className="capitalize"
                      >
                        {member.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.isActive ? "outline" : "secondary"}>
                        {member.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(member)}
                          aria-label="Edit staff"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setResetting(member)}
                          aria-label="Reset password"
                          title="Reset password"
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                        {member.isActive ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={protectedAccount}
                            onClick={() => setDeactivating(member)}
                            aria-label="Deactivate staff"
                            title={
                              protectedAccount
                                ? "Admin accounts cannot be deactivated"
                                : "Deactivate"
                            }
                          >
                            <UserX className="h-4 w-4 text-destructive" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={updateStaff.isPending}
                            onClick={() => reactivate(member)}
                            aria-label="Reactivate staff"
                            title="Reactivate"
                          >
                            <UserCheck className="h-4 w-4 text-green-600" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <StaffFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        staff={editing}
      />

      <ResetPasswordDialog
        staff={resetting}
        onOpenChange={(o) => !o && setResetting(null)}
      />

      <ConfirmDialog
        open={!!deactivating}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title="Deactivate staff?"
        description={`"${deactivating?.name}" will no longer be able to log in. You can reactivate them later.`}
        confirmLabel="Deactivate"
        isLoading={deleteStaff.isPending}
        onConfirm={confirmDeactivate}
      />
    </div>
  );
}
