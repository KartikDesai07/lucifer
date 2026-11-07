"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleArrowUp } from "lucide-react";
import { toast } from "sonner";

import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { POS_BUILD } from "@/lib/build-stamp";
import { desktopShell } from "@/lib/desktop-shell";
import { offlineOutbox } from "@/lib/offline-outbox-store";
import { cartLines, unsentWork } from "@/lib/page-refresh";
import { readDevicePrefs } from "@/lib/pos-device-prefs";
import { printHostBusy } from "@/lib/print-host-busy";
import { nativeBridge } from "@/lib/printer/native-bridge";
import {
  UPDATE_CHECK_MS,
  UPDATE_READY_LABEL,
  UPDATE_RELOAD_KEY,
  UPDATED_NOTE_MS,
  dialogOpenIn,
  quietVerdict,
  textFieldFocused,
} from "@/lib/quiet-reload";
import { LOCK_ATTR, isDisplayPath } from "@/lib/screen-lock";
import { STATUS_CLASSES } from "@/lib/ui";
import { updatePending } from "@/lib/update-pending";
import { cn } from "@/lib/utils";

// P2 N4: a newer build loads at a quiet moment, never mid-sale. While the pulse says a newer build waits
// (lib/update-pending.ts), a local 5 s check gathers the facts and acts on lib/quiet-reload.ts's verdict: "reload"
// reloads the page (nobody can lose anything), "chip" shows the header's "Update ready · Reload" (a plain browser
// with alerts on, whose sound a reload would lock until a tap), "wait" does nothing. No timer runs while nothing
// waits, and the check makes no request. Before any reload it starts, it writes the build it goes to into
// sessionStorage: the new page says "Updated" for 2 s; a page that reloaded and still runs the old build never
// reloads itself toward that build again (a loop on every pulse), it shows the chip instead.

const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
const INPUT_OPTIONS: AddEventListenerOptions = { capture: true, passive: true };

// The chip's one flag: the check sets it, the header's chip reads it (no context, so the header renders it anywhere).
let chipShown = false;
const chipListeners = new Set<() => void>();
function showChip(shown: boolean): void {
  if (shown === chipShown) return;
  chipShown = shown;
  for (const listener of [...chipListeners]) listener();
}
function subscribeChip(listener: () => void): () => void {
  chipListeners.add(listener);
  return () => void chipListeners.delete(listener);
}
const chipSnapshot = (): boolean => chipShown;
const noChip = (): boolean => false;

/** A reload would lock this device's sound until a tap: a plain browser (the POS apps unlock it themselves) with the
 *  alerts on, or a display page (the Now Serving voice). */
function soundNeedsGesture(): boolean {
  return nativeBridge() === null && desktopShell() === null && (readDevicePrefs().alertSound || isDisplayPath(window.location.pathname));
}

/** Keeps the server build this reload goes to; false when it could not be kept (no guard: no reload by itself). */
function rememberReloadTarget(): boolean {
  try {
    const target = updatePending.serverBuild();
    if (target === null) return false;
    window.sessionStorage.setItem(UPDATE_RELOAD_KEY, target);
    return window.sessionStorage.getItem(UPDATE_RELOAD_KEY) === target;
  } catch {
    return false;
  }
}

/** The chip's tap: staff chose to reload now. In a browser the page's own leave warning still guards unsent work. */
function reloadNow(): void {
  rememberReloadTarget();
  window.location.reload();
}

export function UpdateWhenQuiet(): null {
  const queryClient = useQueryClient();
  const pending = useSyncExternalStore(updatePending.subscribe, updatePending.isPending, () => false);
  const lastInputAt = useRef(0);
  // The build an earlier reload of this tab went to (null: none, or it arrived); broken: no sessionStorage.
  const guard = useRef<{ stored: string | null; broken: boolean }>({ stored: null, broken: false });

  useEffect(() => {
    lastInputAt.current = Date.now();
    try {
      const stored = window.sessionStorage.getItem(UPDATE_RELOAD_KEY);
      if (stored === POS_BUILD) {
        window.sessionStorage.removeItem(UPDATE_RELOAD_KEY);
        toast("Updated", { duration: UPDATED_NOTE_MS });
      } else guard.current.stored = stored;
    } catch {
      guard.current.broken = true;
    }
    const onInput = () => {
      lastInputAt.current = Date.now();
    };
    for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, INPUT_OPTIONS);
    return () => {
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, INPUT_OPTIONS);
    };
  }, []);

  useEffect(() => {
    if (!pending) {
      showChip(false);
      return;
    }
    const check = () => {
      const { stored, broken } = guard.current;
      const verdict = quietVerdict({
        pending: updatePending.isPending(),
        locked: document.documentElement.hasAttribute(LOCK_ATTR),
        msSinceInput: Date.now() - lastInputAt.current,
        dialogOpen: dialogOpenIn(document),
        textFocused: textFieldFocused(document),
        cartItems: cartLines(),
        unsentWork: unsentWork() !== null,
        outbox: offlineOutbox.getSnapshot().record?.entries.length ?? 0,
        mutating: queryClient.isMutating(),
        printBusy: printHostBusy(),
        soundNeedsGesture: soundNeedsGesture(),
        autoReloadSpent: broken || (stored !== null && stored === updatePending.serverBuild()),
      });
      showChip(verdict === "chip");
      if (verdict === "reload") {
        if (rememberReloadTarget()) {
          window.location.reload();
          return;
        }
        // The guard could not be written: a reload without it could repeat on every check, so the chip instead.
        guard.current.broken = true;
        showChip(true);
      }
    };
    const timer = window.setInterval(check, UPDATE_CHECK_MS);
    return () => {
      window.clearInterval(timer);
      showChip(false);
    };
  }, [pending, queryClient]);

  return null;
}

// The header's 36 px buttons (components/layout/header-classes.ts) in the info tone, with a 44 px touch area drawn by
// a ::before (no layout effect). Below 1100 px the icon alone, so the header's other controls keep their room; the
// accessible name is the chip's words at every width.
const CHIP_CLASS = cn(
  "relative inline-flex h-9 w-9 flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border px-0 text-[13px] font-semibold desk:w-auto desk:px-3 [&_svg]:size-4",
  "before:absolute before:-inset-1 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  STATUS_CLASSES.info.pill,
  STATUS_CLASSES.info.border,
  HTML_PRESS_CLASS,
);

/** "Update ready · Reload", beside Refresh, while the check says the page should not reload by itself. */
export function UpdateReadyChip() {
  const shown = useSyncExternalStore(subscribeChip, chipSnapshot, noChip);
  if (!shown) return null;
  return (
    <button
      type="button"
      data-ui="update-ready-chip"
      aria-label={UPDATE_READY_LABEL}
      title={UPDATE_READY_LABEL}
      className={CHIP_CLASS}
      onClick={reloadNow}
    >
      <CircleArrowUp strokeWidth={1.8} aria-hidden="true" />
      <span className="hidden desk:inline">{UPDATE_READY_LABEL}</span>
    </button>
  );
}
