"use client";

import { useState } from "react";
import { Plus, Pencil, UserX, UserCheck, UserCog, KeyRound } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useStaff, useDeleteStaff, useUpdateStaff } from "@/hooks/use-staff";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminGuard } from "@/components/shared/AdminGuard";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  BRAND_CONTROL_CLASS,
  BRAND_PANEL_CLASS,
  BRAND_TABLE_CONTAIN_CLASS,
  BRAND_ROW_ACTION_CLASS,
} from "@/components/brand/brand-classes";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { StaffFormSheet } from "@/components/staff/StaffFormSheet";
import { ResetPasswordDialog } from "@/components/staff/ResetPasswordDialog";
import { StaffLoadStatus } from "@/components/staff/StaffLoadStatus";
import { StaffRowCard } from "@/components/staff/StaffRowCard";
import type { Staff } from "@/types";

export default function StaffPage() {
  return (
    <AdminGuard>
      <MenuPageShell>
        <StaffManager />
      </MenuPageShell>
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
    <>
      <PageHeader
        eyebrow="Admin"
        title="Staff"
        description="Manage team logins and roles."
        actions={
          <Button onClick={openAdd} className={BRAND_CONTROL_CLASS}>
            <Plus className="mr-2 h-4 w-4" /> Add staff
          </Button>
        }
      />

      {staff.data === undefined ? (
        <StaffLoadStatus
          isError={staff.isError}
          isPaused={staff.isPaused}
          onRetry={() => void staff.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<UserCog className="h-8 w-8" />}
          title="No staff yet"
          description="Add your first team member to give them a login."
          action={
            <Button onClick={openAdd} className={cn("mt-2", BRAND_CONTROL_CLASS)}>
              <Plus className="mr-2 h-4 w-4" /> Add staff
            </Button>
          }
        />
      ) : (
        <>
          <div className={cn("hidden rounded-lg border lg:block", BRAND_PANEL_CLASS, BRAND_TABLE_CONTAIN_CLASS)}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-40 text-right">Actions</TableHead>
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
                            className={BRAND_ROW_ACTION_CLASS}
                            onClick={() => openEdit(member)}
                            aria-label="Edit staff"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={BRAND_ROW_ACTION_CLASS}
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
                              className={BRAND_ROW_ACTION_CLASS}
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
                              className={BRAND_ROW_ACTION_CLASS}
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

          <div className="space-y-2 lg:hidden">
            {list.map((member) => {
              const isSelf = member._id === user?.id;
              const protectedAccount = isSelf || member.role === "admin";
              return (
                <StaffRowCard
                  key={member._id}
                  member={member}
                  isSelf={isSelf}
                  protectedAccount={protectedAccount}
                  reactivateDisabled={updateStaff.isPending}
                  onEdit={openEdit}
                  onResetPassword={setResetting}
                  onDeactivate={setDeactivating}
                  onReactivate={reactivate}
                />
              );
            })}
          </div>
        </>
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
        description={`"${deactivating?.name ?? "This team member"}" will no longer be able to log in. You can reactivate them later.`}
        confirmLabel="Deactivate"
        isLoading={deleteStaff.isPending}
        onConfirm={confirmDeactivate}
      />
    </>
  );
}
