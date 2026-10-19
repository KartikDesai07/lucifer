"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, KeyRound, LogOut } from "lucide-react";
import { SCREEN_LOCK_DEFAULT_MINUTES } from "@pos/shared/staff-pin";

import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { isActivePath } from "@/lib/nav-active";
import { lockShortcutLabel, requestScreenLock, screenLockLine } from "@/lib/screen-lock";
import { cn } from "@/lib/utils";
import { BRAND_NAV_FLYOUT_ITEM_CLASS, BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { GlyphLock, GlyphSwitch, type NavIcon } from "@/components/layout/nav-icons";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { StaffAvatar } from "@/components/shared/StaffAvatar";

// The profile sheet (the owner's HTML, values 2.7; design 5.4; U0 Task 4). From 720px it is the panel the nav's user
// card opens, anchored above the card (no scrim); on a phone it is the More sheet the tab bar's More opens, from the
// bottom over the scrim, with the grid of every page the tab bar does not hold. The HTML's user block, then its rows
// (Lock screen with the shortcut chip on a desk, Switch user) and ours in the same style (Change password, Sign out),
// then the auto-lock line; no Theme block (light only for now). Escape, a tap outside or a choice closes it.
//
// The rows do what the account menu did: Lock screen and Switch user only ask the screen-lock cover to show
// (components/lock/ScreenLock.tsx), so nobody is signed out and printing and the open orders go on under it.

/** A page in the phone's More grid: a nav row the tab bar does not hold, with its sub-pages when it has them. */
export interface MoreItem {
  title: string;
  url: string;
  icon: NavIcon;
  exact?: boolean;
  sub: readonly { title: string; href: string }[];
}

/** A More tile is lit on its own page, its sub-pages and any of its sub-pages' pages. */
export function isMoreItemActive(item: MoreItem, pathname: string): boolean {
  const own = item.exact ? pathname === item.url : isActivePath(pathname, item.url);
  return own || item.sub.some((s) => isActivePath(pathname, s.href));
}

// The scrim: the phone's --scrim, transparent from 720px (a tap outside still closes the panel). It holds the panel,
// as the HTML's does (Radix's scrollable-overlay shape: the content inside the overlay).
const SCRIM_CLASS = "fixed inset-0 z-40 bg-scrim motion-safe:animate-scrim-in tab:bg-transparent";

// The panel (values 2.1 menuLeft/menuBottom/menuW/menuRadius/menuPadB): full width at the foot on a phone, radius
// 16 16 0 0; 310px wide from 720px, radius 14, 12px above the window's foot beside the 76px rail, 70px up and 12px in
// beside the wide sidebar. It never grows past the screen (it scrolls instead). The HTML's --pop shadow as written
// (an arbitrary property, so no empty ring layers are added to it).
const PANEL_CLASS = cn(
  "absolute inset-x-0 bottom-0 max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-t-[16px] border border-border bg-card pb-[calc(10px+env(safe-area-inset-bottom))] font-sans leading-[normal] text-foreground [box-shadow:var(--pop)] outline-none motion-safe:animate-sheet-in",
  "tab:right-auto tab:bottom-3 tab:left-[84px] tab:w-[310px] tab:rounded-[14px] tab:pb-1.5",
  "wide:bottom-[70px] wide:left-3",
);

// The 44px avatar with 15px initials, laid over StaffAvatar's md circle (the nav card's way of resizing it).
const AVATAR_44_CLASS =
  "[&>span:first-child]:size-11 [&>span:first-child]:rounded-[50%] [&>span:first-child]:text-[15px]";

// A More tile: 72px, 1px border, radius 12, 12px/600, the 22px glyph 6px above the label; the current page on the
// accent tint (--accent-t / --accent-i).
const TILE_CLASS = cn(
  "flex h-[72px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-[12px] border border-border bg-transparent px-0.5 text-center text-[12px] font-semibold text-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground",
  BRAND_PRESS_CLASS,
);

// A row: 9px 10px, radius 8, the 18px glyph 12px from a 14px/500 label over a 12px --text-2 line; hover --hover.
const ROW_CLASS = cn("flex w-full items-center gap-3 rounded-[8px] px-2.5 py-[9px] text-left text-foreground hover:bg-hover", BRAND_PRESS_CLASS);

// The section rule between the blocks (--border-2).
const BLOCK_CLASS = "border-t border-border-2";

function SheetRow({ icon: Icon, label, sub, kbd, onClick }: { icon: NavIcon; label: string; sub?: string; kbd?: string; onClick: () => void }) {
  return (
    <button type="button" data-ui="profile-row" onClick={onClick} className={ROW_CLASS}>
      <Icon aria-hidden="true" strokeWidth={1.7} className="size-[18px] flex-none" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{label}</span>
        {sub && <span className="block text-[12px] text-muted-foreground">{sub}</span>}
      </span>
      {kbd && (
        <kbd
          data-ui="profile-kbd"
          className="hidden rounded-[4px] border border-border px-[5px] font-mono text-[11px] font-normal leading-[18px] text-subtle-foreground desk:inline"
        >
          {kbd}
        </kbd>
      )}
    </button>
  );
}

export interface ProfileSheetBodyProps {
  name: string;
  /** "Admin" or "Staff", beside the ok dot (our session carries no sign-in time, so no "signed in at"). */
  roleLabel: string;
  lockMinutes: number;
  /** The Lock screen chip: ⌘L on Apple devices, Ctrl L elsewhere (lockShortcutLabel). */
  shortcutLabel: string;
  pathname: string;
  /** The phone's More grid (the tab bar's sheet only); below 720px. */
  more?: readonly MoreItem[];
  onLock: () => void;
  onSwitch: () => void;
  onChangePassword: () => void;
  onSignOut: () => void;
  /** A tile or a sub-page was chosen: the sheet closes as the page opens. */
  onNavigate: () => void;
}

/** The sheet's content, without the dialog around it (render-tested in lib/screen-lock-paths.test.ts). */
export function ProfileSheetBody({
  name,
  roleLabel,
  lockMinutes,
  shortcutLabel,
  pathname,
  more,
  onLock,
  onSwitch,
  onChangePassword,
  onSignOut,
  onNavigate,
}: ProfileSheetBodyProps) {
  // A tile with sub-pages opens a second view in the sheet: its sub-pages, with a way back (design 5.4, my call).
  const [groupUrl, setGroupUrl] = useState<string | null>(null);
  const group = more?.find((m) => m.url === groupUrl && m.sub.length > 0) ?? null;

  return (
    <>
      <div data-ui="profile-user" className="flex items-center gap-3 p-4">
        <StaffAvatar name={name} className={AVATAR_44_CLASS} />
        <div className="min-w-0 flex-1">
          <div data-ui="profile-name" className="truncate text-[15px] font-semibold">
            {name}
          </div>
          <div data-ui="profile-status" className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <span aria-hidden="true" className="size-[7px] flex-none rounded-[50%] bg-status-ok" />
            {roleLabel}
          </div>
        </div>
      </div>

      {more && more.length > 0 && (
        <div data-ui="more-grid" className={cn(BLOCK_CLASS, "px-3 pb-3.5 pt-3 tab:hidden")}>
          {group ? (
            <div data-ui="more-group">
              {/* The HTML's back link (the PIN pad's "All staff"), then the group's name as a section label. */}
              <button
                type="button"
                onClick={() => setGroupUrl(null)}
                className={cn("flex items-center gap-1 rounded-[8px] px-1 py-1 text-[14px] font-medium text-link", BRAND_PRESS_CLASS)}
              >
                <ChevronLeft aria-hidden="true" strokeWidth={2.2} className="size-4 flex-none" />
                More
              </button>
              <p className="px-2.5 pb-1 pt-2 text-[12px] font-semibold text-muted-foreground">{group.title}</p>
              <ul className="flex flex-col">
                {group.sub.map((page) => {
                  const active = isActivePath(pathname, page.href);
                  return (
                    <li key={page.href}>
                      <Link
                        href={page.href}
                        prefetch={false}
                        data-ui="more-sub-row"
                        data-active={active}
                        aria-current={active ? "page" : undefined}
                        onClick={onNavigate}
                        className={BRAND_NAV_FLYOUT_ITEM_CLASS}
                      >
                        {page.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {more.map((item) => {
                const active = isMoreItemActive(item, pathname);
                const Icon = item.icon;
                const inside = (
                  <>
                    <Icon aria-hidden="true" strokeWidth={1.7} className="size-[22px] flex-none" />
                    <span className="max-w-full">{item.title}</span>
                  </>
                );
                return item.sub.length > 0 ? (
                  <button
                    key={item.url}
                    type="button"
                    data-ui="more-tile"
                    data-active={active}
                    onClick={() => setGroupUrl(item.url)}
                    className={TILE_CLASS}
                  >
                    {inside}
                  </button>
                ) : (
                  <Link
                    key={item.url}
                    href={item.url}
                    prefetch={false}
                    data-ui="more-tile"
                    data-active={active}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                    className={TILE_CLASS}
                  >
                    {inside}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div data-ui="profile-rows" className={cn(BLOCK_CLASS, "p-1.5")}>
        <SheetRow icon={GlyphLock} label="Lock screen" sub="Your open orders stay as they are" kbd={shortcutLabel} onClick={onLock} />
        <SheetRow icon={GlyphSwitch} label="Switch user" sub="Lock and let a teammate sign in" onClick={onSwitch} />
        <SheetRow icon={KeyRound} label="Change password" onClick={onChangePassword} />
        <SheetRow icon={LogOut} label="Sign out" onClick={onSignOut} />
      </div>

      <div data-ui="profile-foot" className={cn(BLOCK_CLASS, "px-4 py-3 text-[12px] text-subtle-foreground")}>
        {screenLockLine(lockMinutes)}
      </div>
    </>
  );
}

interface ProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The phone's More grid: the tab bar passes every page it does not hold (components/layout/TabBar.tsx). */
  more?: readonly MoreItem[];
}

export function ProfileSheet({ open, onOpenChange, more }: ProfileSheetProps) {
  const { user, isAdmin, logout } = useAuth();
  const settings = useSettings();
  const pathname = usePathname() ?? "";
  const lockMinutes = settings.data?.screenLockMinutes ?? SCREEN_LOCK_DEFAULT_MINUTES;
  const [pwdOpen, setPwdOpen] = useState(false);
  const name = user?.name ?? "Account";
  const close = () => onOpenChange(false);

  // Whatever opened the sheet (the nav's user card, the More tab) gets the focus back when it closes: the sheet has no
  // Radix trigger to return it to.
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
  }, [open]);
  const returnFocus = (event: Event) => {
    event.preventDefault();
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    opener.current = null;
  };

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay data-ui="more-sheet" className={SCRIM_CLASS}>
            <DialogPrimitive.Content
              data-ui="profile-panel"
              aria-describedby={undefined}
              onCloseAutoFocus={returnFocus}
              className={PANEL_CLASS}
            >
              <DialogPrimitive.Title className="sr-only">{more ? "More" : name}</DialogPrimitive.Title>
              <ProfileSheetBody
                name={name}
                roleLabel={isAdmin ? "Admin" : "Staff"}
                lockMinutes={lockMinutes}
                // The sheet's content renders only while it is open, in the browser.
                shortcutLabel={lockShortcutLabel(navigator.platform)}
                pathname={pathname}
                more={more}
                onLock={() => {
                  close();
                  requestScreenLock("manual");
                }}
                onSwitch={() => {
                  close();
                  requestScreenLock("switch");
                }}
                onChangePassword={() => {
                  close();
                  setPwdOpen(true);
                }}
                onSignOut={() => {
                  close();
                  void logout();
                }}
                onNavigate={close}
              />
            </DialogPrimitive.Content>
          </DialogPrimitive.Overlay>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </>
  );
}
