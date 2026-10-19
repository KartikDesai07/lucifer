"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { pinFailureMessage } from "@pos/shared/staff-pin";

import { cn } from "@/lib/utils";
import { verifyOwnPin } from "@/lib/pin-sign-in-client";
import { LOCK_ATTR, SCREEN_LOCK_EVENT } from "@/lib/screen-lock";
import {
  REVEAL_NO_PIN_MESSAGE,
  REVEAL_SUB,
  REVEAL_TITLE,
  REVEAL_TOAST,
  grantSalesReveal,
  nextRevealTick,
  readSalesReveal,
  revealPrompt,
  revealState,
  writeSalesReveal,
  type RevealHintIcon,
  type RevealIcon,
  type RevealView,
  type SalesReveal as RevealGrant,
} from "@/lib/sales-reveal";
import { STAFF_KEYS } from "@/hooks/use-staff";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { Dialog, DialogPortal } from "@/components/ui/dialog";
import { PinPad, type PinPadTones } from "@/components/ui/pin-pad";
import type { Staff } from "@/types";

// The sales mask's controls (U0 match Task 6; the owner's decision 1, design 7; values 3.3, 3.16): the hero's reveal
// button and hint, and the "Show sales figures" PIN dialog. Show asks for the signed-in person's OWN PIN, which the
// server checks (POST /api/sign-in/verify-pin, the PIN sign-in's own window and limits); a right PIN shows the figures
// and lets this person show them again without a PIN for an hour on this tab (sessionStorage). Shown is this page's
// own state: every visit starts hidden (leaving the dashboard hides them), a lock of any kind hides them and closes
// the dialog, and another person signed in on the device never inherits the hour.

/** values 3.16: the dialog waits 180 ms after the 4th digit, so the last dot is seen filled. */
const PIN_SETTLE_MS = 180;

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Storage access itself can throw (site data blocked): the reveal still works for this visit.
    return null;
  }
}

export interface SalesRevealState {
  /** The signed-in person (the session's id), or null. */
  me: string | null;
  view: RevealView;
  /** The figures show right now. */
  shown: boolean;
  /** The reveal button: hide, show again within the hour, or ask for the PIN. */
  toggle: () => void;
  pinOpen: boolean;
  closePin: () => void;
  /** A right PIN: show, keep the hour, close the dialog, say so. */
  granted: () => void;
}

/** The page's one reveal: both the hero and the receipt read `shown`. */
export function useSalesReveal(me: string | null): SalesRevealState {
  const [grant, setGrant] = useState<RevealGrant | null>(null);
  const [shown, setShown] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // The hour this tab already holds (sessionStorage exists only after mount).
  useEffect(() => {
    setGrant(readSalesReveal(sessionStore()));
    setNow(Date.now());
  }, []);

  // A lock hides the figures and closes the dialog: one asked for (Lock screen, Switch user, Ctrl/⌘+L) and the idle
  // cover, which marks <html> with LOCK_ATTR without the event.
  useEffect(() => {
    const hide = () => {
      setShown(false);
      setPinOpen(false);
    };
    const html = document.documentElement;
    const observer = new MutationObserver(() => {
      if (html.hasAttribute(LOCK_ATTR)) hide();
    });
    window.addEventListener(SCREEN_LOCK_EVENT, hide);
    observer.observe(html, { attributes: true, attributeFilter: [LOCK_ATTR] });
    return () => {
      window.removeEventListener(SCREEN_LOCK_EVENT, hide);
      observer.disconnect();
    };
  }, []);

  // Re-render when the hint's minute count changes and when the hour ends (no interval, no request).
  const until = grant && grant.by === me ? grant.until : 0;
  useEffect(() => {
    const wait = nextRevealTick(until, Date.now());
    if (wait === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), wait);
    return () => window.clearTimeout(timer);
  }, [until, now]);

  const stateAt = (at: number) => revealState({ shown, until: grant?.until ?? 0, by: grant?.by ?? null, me, now: at });
  const view = stateAt(now);

  const toggle = () => {
    const at = Date.now();
    const fresh = stateAt(at);
    setNow(at);
    if (fresh.visible) setShown(false);
    else if (fresh.unlocked) setShown(true);
    else setPinOpen(true);
  };

  const granted = () => {
    if (!me) return;
    const at = Date.now();
    const next = grantSalesReveal(me, at);
    writeSalesReveal(sessionStore(), next);
    setGrant(next);
    setNow(at);
    setShown(true);
    setPinOpen(false);
    toast.success(REVEAL_TOAST);
  };

  return { me, view, shown: view.visible, toggle, pinOpen, closePin: () => setPinOpen(false), granted };
}

// values 3.3 / 3.16 icons (24x24, round caps and joins).
const ICON_PATHS: Record<RevealIcon | RevealHintIcon, string> = {
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "eye-off":
    "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
};

function Glyph({ name, size, stroke }: { name: keyof typeof ICON_PATHS; size: number; stroke: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-none"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/**
 * The hero's right column (values 3.3): the 36px pill button (eye 17px, "Show" / "Hide", a #3A3A40 ring that lights
 * to #6B6B74 on hover, #2A2A2F while shown) over its hint (a 12px padlock or clock, the words, grey or green), and
 * the PIN dialog.
 */
export function SalesReveal({ reveal, name, isAdmin }: { reveal: SalesRevealState; name?: string | null; isAdmin: boolean }) {
  const v = reveal.view;
  return (
    <div data-ui="hero-right" className="flex flex-col items-end gap-2 text-[12.5px] text-[#a1a1aa]">
      <button
        type="button"
        data-ui="hero-reveal"
        title={v.title}
        onClick={reveal.toggle}
        style={{ backgroundColor: v.bg }}
        className={cn(
          "flex h-9 items-center gap-2 whitespace-nowrap rounded-[999px] border border-[#3a3a40] px-3 text-[13px] font-semibold text-white outline-none hover:border-[#6b6b74] focus-visible:ring-2 focus-visible:ring-brand-nav-focus",
          HTML_PRESS_CLASS,
        )}
      >
        <Glyph name={v.icon} size={17} stroke={1.8} />
        {v.label}
      </button>
      <span data-ui="hero-hint" className="flex items-center gap-1.5" style={{ color: v.hintColor }}>
        <Glyph name={v.hintIcon} size={12} stroke={2} />
        {v.hint}
      </span>
      <Dialog open={reveal.pinOpen} onOpenChange={(open) => !open && reveal.closePin()}>
        <DialogPortal>
          {/* values 3.16: the scrim centres the 360px panel (16px from the edges); on a phone it is a bottom sheet. */}
          <DialogPrimitive.Overlay
            data-ui="reveal-scrim"
            className="fixed inset-0 z-50 flex items-end justify-center bg-scrim p-0 motion-safe:animate-scrim-in tab:items-center tab:p-4"
          >
            <DialogPrimitive.Content
              data-ui="reveal-dialog"
              className="flex w-full max-w-[360px] flex-col gap-4 rounded-t-[14px] border border-border bg-card p-5 font-sans leading-[normal] text-foreground outline-none [box-shadow:var(--pop)] motion-safe:animate-sheet-in tab:rounded-[14px]"
            >
              <RevealPin reveal={reveal} name={name} isAdmin={isAdmin} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Overlay>
        </DialogPortal>
      </Dialog>
    </div>
  );
}

/** The HTML's shades the kit pad has no preset twin for: empty dots in text-3, the bad tint, bad-i words, the press. */
const REVEAL_TONES: PinPadTones = {
  dotEmpty: "border-subtle-foreground",
  dotErrorFill: "bg-status-bad-tint",
  message: "text-status-bad-ink",
  key: cn("active:bg-surface-3", HTML_PRESS_CLASS),
};

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** The dialog's live part: it mounts with each opening, so every opening starts empty. */
function RevealPin({ reveal, name, isAdmin }: { reveal: SalesRevealState; name?: string | null; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  // An admin's own row is in the staff list the page already holds (the bootstrap seeds it; nothing is fetched):
  // without a PIN the dialog says so at once. Anyone else learns it from the server's "nopin".
  const [noPin, setNoPin] = useState(() => {
    if (!isAdmin || !reveal.me) return false;
    const mine = queryClient.getQueryData<Staff[]>(STAFF_KEYS.all)?.find((s) => s._id === reveal.me);
    return !!mine && mine.hasPin !== true;
  });
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorCount, setErrorCount] = useState(0);
  const busy = useRef(false);
  // An answer that lands after the dialog closed is dropped (set in the effect body too: React's dev double-run).
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  const onChange = (next: string) => {
    if (busy.current) return;
    // Each digit clears the last answer's words (values 3.16); Clear and ⌫ leave them.
    if (next.length > pin.length) setMessage(null);
    setPin(next);
  };

  const onComplete = async (typed: string) => {
    if (busy.current) return;
    busy.current = true;
    const [answer] = await Promise.all([verifyOwnPin(typed), wait(PIN_SETTLE_MS)]);
    busy.current = false;
    if (!open.current) return;
    if (answer.ok) {
      reveal.granted();
      return;
    }
    if (answer.failure.kind === "nopin") {
      setNoPin(true);
      return;
    }
    setPin("");
    setMessage(pinFailureMessage(answer.failure));
    setErrorCount((n) => n + 1);
  };

  return (
    <RevealPinPanel
      prompt={revealPrompt(name)}
      noPin={noPin ? REVEAL_NO_PIN_MESSAGE[isAdmin ? "admin" : "staff"] : null}
      pin={pin}
      message={message}
      errorCount={errorCount}
      onChange={onChange}
      onComplete={(typed) => void onComplete(typed)}
      onCancel={reveal.closePin}
      keyboard
    />
  );
}

export interface RevealPinPanelProps {
  prompt: ReactNode;
  /** A person with no PIN: these words instead of the keys (design 7). */
  noPin: string | null;
  pin: string;
  message: string | null;
  errorCount: number;
  onChange: (next: string) => void;
  onComplete: (pin: string) => void;
  onCancel: () => void;
  keyboard?: boolean;
}

/**
 * The dialog's panel (values 3.16): the 38px ink tile with the eye beside "Show sales figures" (17/600) and its sub
 * (13.5px, text-2, line-height 1.45); the PIN block (the prompt, the dots, the message) and the 50px keys; Cancel, a
 * 40px link. It must sit inside the Dialog (its title and description name the dialog).
 */
export function RevealPinPanel(p: RevealPinPanelProps) {
  return (
    <>
      <div data-ui="reveal-head" className="flex items-start gap-3">
        <span
          data-ui="reveal-icon"
          className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-ink text-on-ink"
        >
          <Glyph name="eye" size={18} stroke={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="text-[17px] font-semibold">{REVEAL_TITLE}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-[3px] text-[13.5px] leading-[1.45] text-pretty text-muted-foreground">
            {REVEAL_SUB}
          </DialogPrimitive.Description>
        </div>
      </div>
      {p.noPin ? (
        <p data-ui="reveal-nopin" role="alert" className="text-center text-[13.5px] leading-[1.45] text-muted-foreground">
          {p.noPin}
        </p>
      ) : (
        <PinPad
          size="reveal"
          value={p.pin}
          onChange={p.onChange}
          onComplete={p.onComplete}
          error={p.message}
          errorCount={p.errorCount}
          keyboard={p.keyboard}
          tones={REVEAL_TONES}
          prompt={
            <span data-ui="reveal-prompt" className="text-[13px] text-muted-foreground">
              {p.prompt}
            </span>
          }
        />
      )}
      <button
        type="button"
        data-ui="reveal-cancel"
        onClick={p.onCancel}
        className={cn(
          "h-10 rounded-[8px] border-0 bg-transparent text-[14px] font-medium text-link outline-none focus-visible:ring-2 focus-visible:ring-ring",
          HTML_PRESS_CLASS,
        )}
      >
        Cancel
      </button>
    </>
  );
}
