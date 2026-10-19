"use client";

import { useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { BRAND_NAV_PRESS_CLASS } from "@/components/brand/brand-classes";
import { NavDeviceLine } from "@/components/layout/NavDeviceLine";
import { ProfileSheet } from "@/components/layout/ProfileSheet";
import { StaffAvatar } from "@/components/shared/StaffAvatar";

// The nav's foot: who is signed in. Extracted from AppSidebar to keep that file small. The card is the owner's HTML
// user card (values 2.3): a 34px avatar with the green online dot, then (wide form only) the name and
// "{role} · {this device's print name}". A tap opens the profile sheet (components/layout/ProfileSheet.tsx, values
// 2.7; U0 Task 4) anchored above it: lock the screen, let a teammate sign in, change password, sign out.

export function SidebarAccount() {
  const { user, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const name = user?.name ?? "Account";
  const role = isAdmin ? "Admin" : "Staff";

  return (
    <>
      <button
        type="button"
        title={name}
        data-ui="nav-user"
        className={cn(
          "flex w-full flex-none items-center justify-center gap-2.5 rounded-[10px] px-0 py-1.5 text-left text-white hover:bg-nav-on wide:justify-start wide:p-2",
          BRAND_NAV_PRESS_CLASS,
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {/* The HTML's 34px avatar, 13px initials; its 11px online dot ringed in the nav colour. */}
        <StaffAvatar
          name={name}
          size="sm"
          status="online"
          className="[&>span:first-child]:size-[34px] [&>span:first-child]:rounded-[50%] [&>span:first-child]:text-[13px] [&_[data-status]]:-bottom-0.5 [&_[data-status]]:-right-0.5 [&_[data-status]]:size-[11px] [&_[data-status]]:rounded-[50%] [&_[data-status]]:border-0 [&_[data-status]]:[box-shadow:0_0_0_2px_var(--color-nav)]"
        />
        <span className="hidden min-w-0 flex-1 flex-col wide:flex">
          <span data-ui="nav-user-name" className="truncate text-[13.5px] font-semibold">
            {name}
          </span>
          <NavDeviceLine lead={role} dataUi="nav-user-line" className="truncate text-[12px] text-nav-t2" />
        </span>
      </button>

      <ProfileSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
