"use client";

import { useState } from "react";
import { KeyRound, Lock, LogIn, LogOut } from "lucide-react";
import { SCREEN_LOCK_DEFAULT_MINUTES } from "@pos/shared/staff-pin";

import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { brandFontVariables } from "@/lib/brand-fonts";
import { requestScreenLock, screenLockLine } from "@/lib/screen-lock";
import { cn } from "@/lib/utils";
import { NavDeviceLine } from "@/components/layout/NavDeviceLine";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StaffAvatar } from "@/components/shared/StaffAvatar";

// The nav's foot: who is signed in, and what they can do about it (lock
// the screen, let a teammate sign in, change password, sign out). Extracted
// from AppSidebar to keep that file small. The trigger is the owner's HTML
// user card (values 2.3): a 34px avatar with the green online dot, then (wide
// form only) the name and "{role} · {this device's print name}"; the menu it
// opens stays a light card until the profile sheet replaces it (U0 Task 4).
//
// Lock screen and Switch user only ask the dashboard's screen-lock cover to
// show (components/lock/ScreenLock.tsx): nobody is signed out, so printing and
// the open orders go on under it. The last line says when it locks by itself.
//
// The menu is portaled out of the sidebar, so it carries the brand font
// variables itself.

const MENU_ITEM_CLASS = "gap-2.5 rounded-md px-2.5 py-2 text-[14px] focus:bg-brand-wash focus:text-brand-ink";

export function SidebarAccount() {
  const { user, isAdmin, logout } = useAuth();
  const settings = useSettings();
  const lockMinutes = settings.data?.screenLockMinutes ?? SCREEN_LOCK_DEFAULT_MINUTES;
  const [pwdOpen, setPwdOpen] = useState(false);
  const name = user?.name ?? "Account";
  const role = isAdmin ? "Admin" : "Staff";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={name}
            data-ui="nav-user"
            className="flex w-full flex-none items-center justify-center gap-2.5 rounded-[10px] px-0 py-1.5 text-left text-white outline-none transition-[background-color,color,transform] duration-[160ms] ease-[ease] hover:bg-nav-on focus-visible:ring-2 focus-visible:ring-brand-nav-focus active:scale-[0.97] data-[state=open]:bg-nav-on wide:justify-start wide:p-2"
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
              <NavDeviceLine lead={role} dataUi="nav-user-line" className="whitespace-nowrap text-[12px] text-nav-t2" />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className={cn(
            brandFontVariables,
            "w-64 rounded-xl border-brand-rule bg-brand-slip p-1.5 font-brand-sans text-brand-ink shadow-[0_12px_32px_-12px_rgb(29_27_24/0.28)]",
          )}
        >
          <DropdownMenuLabel className="px-2.5 py-2 font-normal">
            <span className="block truncate text-[14px] font-semibold">{user?.name}</span>
            <span className="block text-[12px] text-brand-muted">
              {isAdmin ? "Administrator" : "Staff member"}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-brand-rule" />
          <DropdownMenuItem
            className={cn(MENU_ITEM_CLASS, "items-start")}
            onSelect={() => requestScreenLock("manual")}
          >
            <Lock className="mt-0.5 text-brand-muted" aria-hidden="true" />
            <span className="grid min-w-0 leading-tight">
              <span>Lock screen</span>
              <span className="mt-0.5 text-[12px] text-brand-muted">Your open orders stay as they are</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={cn(MENU_ITEM_CLASS, "items-start")}
            onSelect={() => requestScreenLock("switch")}
          >
            <LogIn className="mt-0.5 text-brand-muted" aria-hidden="true" />
            <span className="grid min-w-0 leading-tight">
              <span>Switch user</span>
              <span className="mt-0.5 text-[12px] text-brand-muted">Lock and let a teammate sign in</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-brand-rule" />
          <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => setPwdOpen(true)}>
            <KeyRound className="text-brand-muted" aria-hidden="true" />
            Change password
          </DropdownMenuItem>
          <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => logout()}>
            <LogOut className="text-brand-muted" aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-brand-rule" />
          <DropdownMenuLabel className="px-2.5 py-1.5 text-[12px] font-normal text-brand-muted">
            {screenLockLine(lockMinutes)}
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </>
  );
}
