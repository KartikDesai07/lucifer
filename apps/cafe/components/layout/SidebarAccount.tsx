"use client";

import { useState } from "react";
import { ChevronsUpDown, KeyRound, Lock, LogIn, LogOut } from "lucide-react";
import { SCREEN_LOCK_DEFAULT_MINUTES } from "@pos/shared/staff-pin";

import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { brandFontVariables } from "@/lib/brand-fonts";
import { requestScreenLock, screenLockLine } from "@/lib/screen-lock";
import { cn } from "@/lib/utils";
import { brandTooltip } from "@/components/brand/brand-tooltip";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

// The sidebar's foot: who is signed in, and what they can do about it (lock
// the screen, let a teammate sign in, change password, sign out). Extracted
// from AppSidebar to keep that file small. The role is plain muted text — the
// old filled badge was the primary GREEN, which in this app means a
// "Completed" status, not a role.
//
// Lock screen and Switch user only ask the dashboard's screen-lock cover to
// show (components/lock/ScreenLock.tsx): nobody is signed out, so printing and
// the open orders go on under it. The last line says when it locks by itself.
//
// The menu is portaled out of the sidebar, so it carries the brand font
// variables itself.

const MENU_ITEM_CLASS = "gap-2.5 rounded-md px-2.5 py-2 text-[14px] focus:bg-brand-wash focus:text-brand-ink";

export function SidebarAccount({ collapsed }: { collapsed: boolean }) {
  const { user, isAdmin, logout } = useAuth();
  const settings = useSettings();
  const lockMinutes = settings.data?.screenLockMinutes ?? SCREEN_LOCK_DEFAULT_MINUTES;
  const [pwdOpen, setPwdOpen] = useState(false);
  const name = user?.name ?? "Account";
  const initial = (user?.name ?? "?").charAt(0).toUpperCase();
  const role = isAdmin ? "Admin" : "Staff";

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                tooltip={brandTooltip(name)}
                className="h-12 gap-2.5 rounded-lg px-2 hover:bg-brand-wash data-[state=open]:bg-brand-slip data-[state=open]:shadow-[0_0_0_1px_rgb(29_27_24/0.12)]"
              >
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-primary text-[13px] font-semibold text-brand-slip"
                >
                  {initial}
                </span>
                {!collapsed && (
                  <>
                    <span className="grid min-w-0 flex-1 text-left leading-tight">
                      <span className="truncate text-[14px] font-semibold text-brand-ink">{name}</span>
                      <span className="truncate text-[12px] text-brand-muted">{role}</span>
                    </span>
                    <ChevronsUpDown className="ml-auto size-4 text-brand-muted" aria-hidden="true" />
                  </>
                )}
              </SidebarMenuButton>
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
        </SidebarMenuItem>
      </SidebarMenu>

      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </>
  );
}
