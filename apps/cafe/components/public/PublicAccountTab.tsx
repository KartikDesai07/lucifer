"use client";

import { useEffect, useState } from "react";
import { LogOut, Monitor, Moon, Sun, User } from "lucide-react";

import { maskMobile } from "@pos/shared/utils";
import { DINER_THEME_ATTR, type DinerTheme } from "@pos/shared/appearance-theme-override";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import { readTheme, writeTheme, type ThemeValue } from "@/components/public/public-cart-store";
import { cn } from "@/lib/utils";

// S9 — the diner Account tab: who you are (or a sign-in prompt), the device
// theme control, and sign out. The theme control works for EVERY diner, signed
// in or not — it is a device preference (public-cart-store's THEME key
// survives logout), never an account setting.

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeValue; label: string; Icon: typeof Monitor }> = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

// DinerTheme (the shared producer's export) and ThemeValue (the store's own
// type) are the same three strings by construction — both read
// THEME_VALUES-shaped data — so this cast site is the one place that
// equivalence is assumed rather than re-declared.
function applyThemeAttribute(theme: ThemeValue): void {
  if (theme === "system") {
    document.documentElement.removeAttribute(DINER_THEME_ATTR);
  } else {
    document.documentElement.setAttribute(DINER_THEME_ATTR, theme satisfies DinerTheme);
  }
}

interface PublicAccountTabProps {
  diner: { name: string; mobile: string } | null;
  onSignIn: () => void;
  onSignOut: () => void | Promise<void>;
}

export function PublicAccountTab({ diner, onSignIn, onSignOut }: PublicAccountTabProps) {
  const [theme, setTheme] = useState<ThemeValue>("system");
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Hydrate from localStorage on mount only — the no-flash script in
  // app/m/layout.tsx already applied the attribute before paint; this just
  // brings the control's own displayed selection in sync with it.
  useEffect(() => {
    setTheme(readTheme() ?? "system");
  }, []);

  function selectTheme(next: ThemeValue) {
    setTheme(next);
    writeTheme(next);
    applyThemeAttribute(next);
  }

  // Two-tap confirm, same pattern as PublicOrderStatus's "Cancel this order":
  // first tap arms the confirm state, second tap actually signs out.
  async function handleSignOut() {
    if (!confirmingSignOut) {
      setConfirmingSignOut(true);
      return;
    }
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setConfirmingSignOut(false);
      setSigningOut(false);
    }
  }

  return (
    <div className="space-y-pub-gap p-pub-pad">
      {diner === null ? (
        <EmptyState
          icon={<User className="h-8 w-8" aria-hidden="true" />}
          title="Sign in to your account"
          description="Sign in with your mobile number to see your orders and rewards."
          action={
            <Button className={PUBLIC_TOUCH_TARGET_CLASS} onClick={onSignIn}>
              Sign in
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border p-pub-pad">
          <p className="text-sm font-medium">{diner.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{maskMobile(diner.mobile)}</p>
        </div>
      )}

      <div className="rounded-lg border p-pub-pad">
        <p className="text-sm font-medium">Theme</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This only changes how this menu looks on this device.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => selectTheme(value)}
              aria-pressed={theme === value}
              className={cn(
                PUBLIC_TOUCH_TARGET_CLASS,
                "flex flex-col items-center justify-center gap-1 rounded-lg border text-xs",
                theme === value
                  ? "border-primary bg-primary/5 text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {diner !== null && (
        <div className="space-y-2">
          <Button
            type="button"
            variant={confirmingSignOut ? "destructive" : "outline"}
            className={cn("w-full", PUBLIC_TOUCH_TARGET_CLASS)}
            disabled={signingOut}
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {signingOut ? "Signing out…" : confirmingSignOut ? "Really sign out?" : "Sign out"}
          </Button>
          {confirmingSignOut && !signingOut && (
            <button
              type="button"
              onClick={() => setConfirmingSignOut(false)}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Never mind
            </button>
          )}
        </div>
      )}
    </div>
  );
}
