import { KeyRound, Pencil, UserCheck, UserX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Staff } from "@/types";

interface StaffRowCardProps {
  member: Staff;
  isSelf: boolean;
  protectedAccount: boolean;
  reactivateDisabled: boolean;
  onEdit: (member: Staff) => void;
  onResetPassword: (member: Staff) => void;
  onDeactivate: (member: Staff) => void;
  onReactivate: (member: Staff) => void;
}

/** Card layout for one staff row — mirrors the table row exactly (same handlers, same conditions). */
export function StaffRowCard({
  member,
  isSelf,
  protectedAccount,
  reactivateDisabled,
  onEdit,
  onResetPassword,
  onDeactivate,
  onReactivate,
}: StaffRowCardProps) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">
            {member.name}
            {isSelf && (
              <span className="ml-1 text-xs text-muted-foreground">(you)</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{member.username}</div>
        </div>
        <Badge variant={member.isActive ? "outline" : "secondary"}>
          {member.isActive ? "Active" : "Inactive"}
        </Badge>
      </div>

      <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
        <span>{member.mobile}</span>
        <Badge
          variant={member.role === "admin" ? "default" : "secondary"}
          className="capitalize"
        >
          {member.role}
        </Badge>
      </div>

      <div className="mt-2 flex justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(member)}
          aria-label="Edit staff"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onResetPassword(member)}
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
            onClick={() => onDeactivate(member)}
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
            disabled={reactivateDisabled}
            onClick={() => onReactivate(member)}
            aria-label="Reactivate staff"
            title="Reactivate"
          >
            <UserCheck className="h-4 w-4 text-green-600" />
          </Button>
        )}
      </div>
    </div>
  );
}
