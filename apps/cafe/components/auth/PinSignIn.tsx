"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Lock, Search } from "lucide-react";
import { pinFailureMessage, type PinSignInFailure } from "@pos/shared/staff-pin";

import { cn } from "@/lib/utils";
import { greetingFor } from "@/lib/brand-time";
import { signInWithPin, type KnownPerson } from "@/lib/pin-sign-in-client";
import { useNow } from "@/hooks/use-now";
import { Input } from "@/components/ui/input";
import { PinPad } from "@/components/ui/pin-pad";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StaffAvatar } from "@/components/shared/StaffAvatar";

// Sign in by name and PIN (spec 2026-10-16 §5.3): the tiles of the people this device remembers, then the PIN pad
// for the one tapped. Shared by the login page and the lock screen; the caller fetches the people once and decides
// what a successful sign-in does next. The PIN is only ever checked by the server (signInWithPin).

export type StaffFilter = "all" | "admin" | "staff";

/** The search field and the role tabs appear only above this many tiles (a counter usually knows a handful). */
export const FILTERS_ABOVE = 8;
/** The wait countdown's tick: a local timer, never a request. */
const WAIT_TICK_MS = 1_000;

const ROLE_LABEL: Record<KnownPerson["role"], string> = { admin: "Admin", staff: "Staff" };
const FILTER_TABS: { value: StaffFilter; label: string }[] = [
  { value: "all", label: "All staff" },
  { value: "admin", label: "Admin" },
  { value: "staff", label: "Staff" },
];

// Fixed English tables, not toLocaleString, so a device set to another language never changes the line.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "Friday, 16 October": the picker's date, in the counter's own local time. */
export function pickerDateLabel(now: Date): string {
  return `${WEEKDAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

/** "Good evening": the picker's headline (greetingFor's sentence without its full stop, as in the mock-up). */
export function pinGreeting(now: Date): string {
  return greetingFor(now).replace(/\.$/, "");
}

/** The tiles for a role tab and a search (trimmed, any case, the full name or the short one). */
export function visiblePeople(people: KnownPerson[], filter: StaffFilter, query: string): KnownPerson[] {
  const q = query.trim().toLowerCase();
  return people.filter(
    (p) =>
      (filter === "all" || p.role === filter) &&
      (q === "" || p.name.toLowerCase().includes(q) || p.shortName.toLowerCase().includes(q)),
  );
}

/**
 * What the pad shows: a wait (seconds left on the local countdown) disables it and words the minutes left; a block
 * disables it; a try in flight disables it; any other refusal (a wrong PIN included) leaves it enabled to try again.
 */
export function pinPadView(input: {
  failure: PinSignInFailure | null;
  waitLeftSec: number;
  busy: boolean;
}): { message: string | null; disabled: boolean } {
  if (input.waitLeftSec > 0) {
    return { message: pinFailureMessage({ kind: "wait", retryAfterSec: input.waitLeftSec }), disabled: true };
  }
  return {
    message: input.failure ? pinFailureMessage(input.failure) : null,
    disabled: input.busy || input.failure?.kind === "blocked",
  };
}

const LINK_CLASS =
  "inline-flex h-9 items-center gap-1 rounded-md px-1 text-[13.5px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11";

interface PinSignInProps {
  people: KnownPerson[];
  /** The lock screen's locker: that tile is marked and shows the label ("Locked · 3 min ago") in place of the role. */
  highlight?: { id: string; label: string } | null;
  onUsePassword(): void;
  onSignedIn(person: KnownPerson): void | Promise<void>;
}

export function PinSignIn({ people, highlight = null, onUsePassword, onSignedIn }: PinSignInProps) {
  const [chosen, setChosen] = useState<KnownPerson | null>(null);
  const [pin, setPin] = useState("");
  const [failure, setFailure] = useState<PinSignInFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotShown, setForgotShown] = useState(false);
  // A wait belongs to the person it was answered for; another person's pad stays usable.
  const [wait, setWait] = useState<{ id: string; until: number } | null>(null);
  const [waitLeftSec, setWaitLeftSec] = useState(0);
  const [filter, setFilter] = useState<StaffFilter>("all");
  const [query, setQuery] = useState("");
  const backRef = useRef<HTMLButtonElement>(null);
  // The greeting and the date change at most once a minute.
  const now = useNow(60_000);

  useEffect(() => {
    if (!wait) return;
    const tick = () => {
      const left = Math.ceil((wait.until - Date.now()) / 1000);
      if (left > 0) {
        setWaitLeftSec(left);
        return;
      }
      setWait(null);
      setWaitLeftSec(0);
    };
    const timer = setInterval(tick, WAIT_TICK_MS);
    return () => clearInterval(timer);
  }, [wait]);

  // The tile that was tapped is gone; the keyboard user lands on the way back.
  useEffect(() => {
    if (chosen) backRef.current?.focus();
  }, [chosen]);

  const choose = (person: KnownPerson) => {
    setChosen(person);
    setPin("");
    setFailure(null);
    setForgotShown(false);
  };

  const backToTiles = () => {
    setChosen(null);
    setPin("");
    setFailure(null);
    setForgotShown(false);
  };

  const submit = async (value: string) => {
    if (!chosen || busy) return;
    const person = chosen;
    setBusy(true);
    setFailure(null);
    const answer = await signInWithPin(person.id, value);
    if (answer.ok) {
      try {
        // The pad stays disabled while the caller moves on (the page navigates, the lock screen closes).
        await onSignedIn(person);
      } catch {
        setBusy(false);
        setPin("");
        setFailure({ kind: "error" });
      }
      return;
    }
    setBusy(false);
    setPin("");
    if (answer.failure.kind === "wait") {
      const seconds = Math.max(1, Math.ceil(answer.failure.retryAfterSec));
      setWait({ id: person.id, until: Date.now() + seconds * 1000 });
      setWaitLeftSec(seconds);
      return;
    }
    setFailure(answer.failure);
  };

  if (chosen) {
    const waiting = wait !== null && wait.id === chosen.id ? waitLeftSec : 0;
    const pad = pinPadView({ failure, waitLeftSec: waiting, busy });
    const useYourPassword = waiting === 0 && (failure?.kind === "device" || failure?.kind === "nopin");
    return (
      <div className="flex flex-col items-center gap-4 pb-1 motion-safe:animate-brand-fade md:pt-1">
        {/* Not while a try is in flight: its answer belongs to this pad. */}
        <button
          ref={backRef}
          type="button"
          onClick={backToTiles}
          disabled={busy}
          className={cn(LINK_CLASS, "self-start text-sm disabled:pointer-events-none disabled:opacity-50")}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          All staff
        </button>
        <StaffAvatar name={chosen.name} seed={chosen.id} size="lg" />
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{chosen.name}</h1>
          <p className="mt-0.5 text-[13.5px] text-muted-foreground">
            {ROLE_LABEL[chosen.role]} · Enter your 4-digit PIN
          </p>
        </div>
        <PinPad keyboard value={pin} onChange={setPin} onComplete={submit} error={pad.message} disabled={pad.disabled} />
        {useYourPassword && (
          <button type="button" onClick={onUsePassword} className={LINK_CLASS}>
            Sign in with username and password
          </button>
        )}
        <div className="flex flex-col items-center">
          <button
            type="button"
            onClick={() => setForgotShown(true)}
            aria-expanded={forgotShown}
            className={LINK_CLASS}
          >
            Forgot PIN?
          </button>
          {forgotShown && (
            <p className="text-center text-sm text-muted-foreground">Ask an admin to tell you or reset your PIN.</p>
          )}
        </div>
      </div>
    );
  }

  const filtersShown = people.length > FILTERS_ABOVE;
  const tiles = filtersShown ? visiblePeople(people, filter, query) : people;
  const grid = (
    <>
      <div className="grid grid-cols-3 gap-1.5 md:grid-cols-4 md:gap-2 xl:grid-cols-6">
        {tiles.map((person) => {
          const markLabel = highlight?.id === person.id ? highlight.label : null;
          const marked = markLabel !== null;
          return (
            <button
              key={person.id}
              type="button"
              data-staff-id={person.id}
              data-highlight={marked ? "true" : undefined}
              title={person.name}
              onClick={() => choose(person)}
              className={cn(
                "flex h-[150px] w-full min-w-0 max-w-[120px] flex-col items-center justify-center gap-2 justify-self-center rounded-xl border px-1.5 text-foreground transition-colors hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-[160px] md:max-w-[132px] xl:h-[168px] xl:max-w-[142px]",
                marked ? "border-status-info-border bg-accent" : "border-transparent",
              )}
            >
              <span className="relative inline-flex">
                <StaffAvatar name={person.name} seed={person.id} size="tile" />
                {marked && (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-on-ink ring-2 ring-card"
                  >
                    <Lock className="h-2.5 w-2.5" strokeWidth={2.8} />
                  </span>
                )}
              </span>
              <span className="flex max-w-full flex-col items-center">
                <span className="max-w-full truncate text-[13px] font-medium md:text-sm">{person.shortName}</span>
                <span className={cn("whitespace-nowrap text-xs", marked ? "text-accent-foreground" : "text-muted-foreground")}>
                  {markLabel ?? ROLE_LABEL[person.role]}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {tiles.length === 0 && (
        <p className="p-5 text-center text-sm text-muted-foreground">No staff found for “{query.trim()}”.</p>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3.5">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] md:text-[26px]">
            {now ? pinGreeting(now) : " "}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select your name to sign in{now ? ` · ${pickerDateLabel(now)}` : ""}
          </p>
        </div>
        {filtersShown && (
          <div className="relative w-full md:w-[260px]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search staff"
              aria-label="Search staff"
              autoComplete="off"
              className="h-10 rounded-lg pl-9 pointer-coarse:h-11"
            />
          </div>
        )}
      </div>

      {filtersShown ? (
        <Tabs value={filter} onValueChange={(v) => setFilter(v as StaffFilter)} className="-mt-1.5 flex flex-col gap-5">
          <TabsList variant="underline" className="w-full pointer-coarse:h-11">
            {FILTER_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} variant="underline" className="px-2 pointer-coarse:h-11">
                {tab.label}{" "}
                <span className="ml-1 font-normal text-subtle-foreground">
                  {tab.value === "all" ? people.length : people.filter((p) => p.role === tab.value).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {FILTER_TABS.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-0">
              {tab.value === filter ? grid : null}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        grid
      )}

      <button type="button" onClick={onUsePassword} className={cn(LINK_CLASS, "self-center")}>
        Sign in with username and password
      </button>
    </div>
  );
}
