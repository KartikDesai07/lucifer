"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UtensilsCrossed } from "lucide-react";
import { SCREEN_LOCK_DEFAULT_MINUTES } from "@pos/shared/staff-pin";

import { ADMIN_ROUTES, APP_NAME } from "@/lib/constants";
import { brandingUrl, productImageUrl } from "@/lib/images";
import { fetchKnownPeople, rememberThisDevice, type KnownPerson } from "@/lib/pin-sign-in-client";
import {
  LOCK_ATTR,
  LOCK_READY_ATTR,
  SCREEN_LOCK_EVENT,
  autoLockDue,
  clearLockState,
  isPersonScopedQuery,
  lockedAgoLabel,
  readLockState,
  writeLockState,
  type LockState,
} from "@/lib/screen-lock";
import { useAuth } from "@/hooks/use-auth";
import { useNow } from "@/hooks/use-now";
import { useSettings } from "@/hooks/use-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthShell } from "@/components/auth/AuthShell";
import { PinSignIn } from "@/components/auth/PinSignIn";
import { LockPasswordForm } from "@/components/lock/LockPasswordForm";

// The screen lock (spec 2026-10-16 §5.6). A COVER over the running dashboard, never a sign-out: signing out would
// unmount this layout and with it the print host, the pulse, the alarm and realtime, so the page keeps running under
// the cover and only the people at the counter are kept out. While it shows, every other child of <body> is inert.
// It locks from the account menu (requestScreenLock) or after the cafe's idle minutes, measured by the clock against
// the last tap or key (no request, no state per keystroke); it survives a reload through lib/screen-lock's stored
// state and the layout's no-flash script. Whoever enters a correct PIN (or password) continues: the same person just
// closes the cover; someone else switches the session in place, and the last person's admin-only data goes with them.

/** The idle check's tick: a clock read against the last tap or key, never a request. */
const IDLE_CHECK_MS = 30_000;
/** "Locked · 3 min ago" changes at most once a minute. */
const LABEL_TICK_MS = 60_000;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const LINK_CLASS =
  "inline-flex h-9 items-center rounded-md px-2 text-[13.5px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11";

type LockReason = "auto" | "manual" | "switch";
/** Who an unlock signed in; null when the new session could not be read back (treated as someone else). */
type SignedIn = { id: string; name: string | null; role: string | null } | null;
/** An open cover: the stored state, who was signed in when it opened, and a fresh key per lock. */
type OpenLock = { state: LockState; as: { id: string | null; name: string | null }; key: number };

function lockStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Storage access itself can throw (site data blocked): the in-memory cover still holds.
    return null;
  }
}

function isAdminPath(pathname: string): boolean {
  return ADMIN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function ScreenLock() {
  const { user, logout } = useAuth();
  const settings = useSettings();
  const minutes = settings.data?.screenLockMinutes ?? SCREEN_LOCK_DEFAULT_MINUTES;
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<OpenLock | null>(null);
  const [ready, setReady] = useState(false);
  const openRef = useRef<OpenLock | null>(null);
  const lastActivityAt = useRef(0);
  const keyRef = useRef(0);
  const resetPending = useRef(false);
  // The listeners and the timer read the latest render's values without subscribing again.
  const latest = useRef({ user, minutes, pathname });
  latest.current = { user, minutes, pathname };

  const show = useCallback((state: LockState) => {
    const u = latest.current.user;
    const next: OpenLock = { state, as: { id: u?.id ?? null, name: u?.name ?? null }, key: ++keyRef.current };
    openRef.current = next;
    document.documentElement.setAttribute(LOCK_ATTR, "");
    setOpen(next);
  }, []);

  const lockNow = useCallback(
    (reason: LockReason) => {
      if (openRef.current) return;
      const u = latest.current.user;
      // "Switch user" marks nobody as the locker: the list opens with no tile singled out, after a reload too.
      const marked = reason !== "switch";
      const state: LockState = {
        locked: true,
        by: marked ? (u?.id ?? null) : null,
        byName: marked ? (u?.name ?? null) : null,
        at: Date.now(),
      };
      writeLockState(lockStorage(), state);
      show(state);
    },
    [show],
  );

  const close = useCallback(() => {
    clearLockState(lockStorage());
    document.documentElement.removeAttribute(LOCK_ATTR);
    openRef.current = null;
    lastActivityAt.current = Date.now();
    setOpen(null);
  }, []);

  // A reload of a locked page opens on the cover.
  useEffect(() => {
    lastActivityAt.current = Date.now();
    const saved = readLockState(lockStorage());
    if (saved) show(saved);
    else document.documentElement.removeAttribute(LOCK_ATTR);
    setReady(true);
  }, [show]);

  // The no-flash CSS lets go only in the commit that holds the cover (a layout effect: before that frame paints).
  useLayoutEffect(() => {
    if (!ready) return;
    const html = document.documentElement;
    html.setAttribute(LOCK_READY_ATTR, "");
    return () => {
      html.removeAttribute(LOCK_READY_ATTR);
      html.removeAttribute(LOCK_ATTR);
    };
  }, [ready]);

  useEffect(() => {
    const onPointer = () => {
      lastActivityAt.current = Date.now();
    };
    const onKey = (e: KeyboardEvent) => {
      lastActivityAt.current = Date.now();
      // A sheet or menu left open under the cover closes on Escape from a document listener; this one runs first.
      if (openRef.current && e.key === "Escape") e.stopImmediatePropagation();
    };
    const check = () => {
      if (openRef.current) return;
      const { minutes: idleMinutes, pathname: path } = latest.current;
      if (autoLockDue({ lastActivityAt: lastActivityAt.current, now: Date.now(), minutes: idleMinutes, pathname: path })) {
        lockNow("auto");
      }
    };
    const onRequest = (e: Event) => {
      lockNow((e as CustomEvent<{ reason?: unknown }>).detail?.reason === "switch" ? "switch" : "manual");
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(SCREEN_LOCK_EVENT, onRequest);
    // A hidden Android or Windows app that comes back after the time opens locked.
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, IDLE_CHECK_MS);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(SCREEN_LOCK_EVENT, onRequest);
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
    };
  }, [lockNow]);

  // Someone else signed in: what the last person loaded for their role (staff list, reports, the multi-day
  // dashboard) goes. It runs once the new session has rendered, when an admin page under the cover has already
  // unmounted its admin-only queries (AdminGuard), so nothing is fetched again as a person who may not see it.
  const resetPersonScoped = useCallback(() => {
    resetPending.current = false;
    void queryClient.resetQueries({ predicate: (q) => isPersonScopedQuery(q.queryKey) });
  }, [queryClient]);
  const userId = user?.id;
  useEffect(() => {
    if (resetPending.current) resetPersonScoped();
  }, [userId, resetPersonScoped]);

  const unlocked = (person: SignedIn) => {
    const before = openRef.current?.as.id ?? null;
    if (!person || person.id !== before) {
      // The new session may not have rendered yet (signIn's update lands on React's next render).
      if (person && latest.current.user?.id !== person.id) resetPending.current = true;
      else resetPersonScoped();
      // An admin-only page is left for a non-admin. The POS cart is not tied to a person and stays.
      if (isAdminPath(latest.current.pathname) && person?.role !== "admin") router.replace("/");
      if (person?.name) toast.success(`Signed in as ${firstName(person.name)}`);
    }
    void rememberThisDevice();
    close();
  };

  const signOut = async () => {
    // Ruling R15: the stored lock goes first, so the next sign-in never lands on a stale cover.
    clearLockState(lockStorage());
    await logout();
    // Still here: the sign-out did not go through (logout has said so). The cover stays, and holds a reload again.
    const still = openRef.current;
    if (still) writeLockState(lockStorage(), still.state);
  };

  if (!open) return null;
  return (
    <LockCover
      key={open.key}
      lock={open.state}
      signedInAs={open.as.name}
      onUnlocked={unlocked}
      onSignOut={signOut}
    />
  );
}

interface LockCoverProps {
  lock: LockState;
  signedInAs: string | null;
  onUnlocked(person: SignedIn): void;
  onSignOut(): Promise<void>;
}

// Mounted for one lock and gone on unlock, so each lock starts fresh (PinSignIn's pad stays disabled after a success).
function LockCover({ lock, signedInAs, onUnlocked, onSignOut }: LockCoverProps) {
  const settings = useSettings();
  const { update } = useSession();
  const now = useNow(LABEL_TICK_MS);
  const [people, setPeople] = useState<KnownPerson[] | null>(null);
  // null: chosen from who this device remembers; then whatever the person picks.
  const [view, setView] = useState<"pin" | "password" | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // One look-up per lock: who this device remembers with a PIN (any failure reads as nobody).
  useEffect(() => {
    let live = true;
    void fetchKnownPeople().then((known) => {
      if (live) setPeople(known);
    });
    return () => {
      live = false;
    };
  }, []);

  // While the cover shows, no other child of <body> takes a tap, a key or focus; a portal that opens meanwhile
  // joins them. An iframe is react-to-print's offscreen print window: the slip going out is left alone.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const quieted: Element[] = [];
    const quiet = (el: Element) => {
      if (el === root || el.tagName === "IFRAME" || el.hasAttribute("inert")) return;
      el.setAttribute("inert", "");
      quieted.push(el);
    };
    Array.from(document.body.children).forEach(quiet);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) quiet(node);
        });
      }
    });
    observer.observe(document.body, { childList: true });
    root?.focus();
    return () => {
      observer.disconnect();
      for (const el of quieted) el.removeAttribute("inert");
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  // A sheet or menu left open under the cover listens on the document for a press, a focus or a scroll outside it,
  // and would close (or block the scroll) on one here. React's own document listener runs before theirs, so
  // stopping the native event at this root keeps the page under the cover exactly as it was.
  const keepFromLayersBelow = (e: SyntheticEvent) => e.nativeEvent.stopImmediatePropagation();

  // Tab and Shift+Tab wrap inside the cover.
  const keepTabInside = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.getClientRects().length > 0,
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    const wrapBack = e.shiftKey && (active === first || active === e.currentTarget);
    const wrapForward = !e.shiftKey && active === last;
    if (wrapBack || wrapForward) {
      e.preventDefault();
      (wrapBack ? last : first).focus();
    }
  };

  const pinSignedIn = (person: KnownPerson) => onUnlocked({ id: person.id, name: person.name, role: person.role });

  // The session now names whoever signed in; read it back once to tell a switch from the same person.
  const passwordSignedIn = async () => {
    const fresh = await update();
    const u = fresh?.user;
    onUnlocked(u?.id ? { id: u.id, name: u.name ?? null, role: u.role ?? null } : null);
  };

  const locker = lock.by;
  const lockerKnown = locker !== null && (people ?? []).some((p) => p.id === locker);
  const pinFirst = people !== null && people.length > 0 && (locker === null || lockerKnown);
  const showing = view ?? (pinFirst ? "pin" : "password");
  // The person who locked it first in the list, marked "Locked · 3 min ago".
  const ordered =
    people && lockerKnown
      ? [...people.filter((p) => p.id === locker), ...people.filter((p) => p.id !== locker)]
      : (people ?? []);
  const highlight =
    locker !== null && lockerKnown ? { id: locker, label: lockedAgoLabel(lock.at, now?.getTime() ?? Date.now()) } : null;

  let body: ReactNode;
  if (people === null) {
    body = (
      <div role="status" aria-label="Loading sign-in" className="flex flex-col gap-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="mt-3 h-[150px] w-full md:h-[160px]" />
      </div>
    );
  } else if (showing === "pin") {
    body = (
      <PinSignIn people={ordered} highlight={highlight} onUsePassword={() => setView("password")} onSignedIn={pinSignedIn} />
    );
  } else {
    body = (
      <LockPasswordForm
        signedInAs={signedInAs}
        onSignedIn={passwordSignedIn}
        onUsePin={people.length > 0 ? () => setView("pin") : undefined}
      />
    );
  }

  const brandName = settings.data?.restaurantName?.trim() || APP_NAME;
  // The sidebar's chain: the cafe's logo, then the saved product logo, then the branding route's built-in mark.
  const logoUrl =
    productImageUrl(settings.data?.logo, undefined, { fit: true }) ??
    productImageUrl(settings.data?.productLogo, undefined, { fit: true }) ??
    brandingUrl("productLogo");
  const logo = logoFailed ? (
    <UtensilsCrossed className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
  ) : (
    <Image
      src={logoUrl}
      alt=""
      width={48}
      height={48}
      unoptimized
      className="h-full w-auto max-w-full object-contain mix-blend-multiply"
      onError={() => setLogoFailed(true)}
    />
  );

  return createPortal(
    <div
      ref={rootRef}
      data-screen-lock=""
      role="dialog"
      aria-modal="true"
      aria-label="Screen locked"
      tabIndex={-1}
      onKeyDown={keepTabInside}
      onPointerDown={keepFromLayersBelow}
      onFocus={keepFromLayersBelow}
      onWheel={keepFromLayersBelow}
      onTouchMove={keepFromLayersBelow}
      // pointer-events-auto: a modal sheet left open under the cover sets pointer-events:none on <body>.
      className="pointer-events-auto fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-background outline-none"
    >
      <AuthShell
        brandName={brandName}
        logo={logo}
        title={people !== null && showing === "password" ? "Screen locked" : undefined}
        footer={
          <button type="button" onClick={() => void onSignOut()} className={LINK_CLASS}>
            Sign out
          </button>
        }
      >
        {body}
      </AuthShell>
    </div>,
    document.body,
  );
}
