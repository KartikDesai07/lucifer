"use client";

import { useEffect, useRef, useState } from "react";
import { pinFailureMessage, type PinSignInFailure } from "@pos/shared/staff-pin";

import { cn } from "@/lib/utils";
import { pickerGreeting } from "@/lib/brand-time";
import { signInWithPin, type KnownPerson } from "@/lib/pin-sign-in-client";
import { tileNames } from "@/lib/staff-display";
import { useNow } from "@/hooks/use-now";
import { PinPad, type PinPadTones } from "@/components/ui/pin-pad";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StaffAvatar } from "@/components/shared/StaffAvatar";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { AUTH_LINK_CLASS } from "@/components/auth/auth-classes";

// Sign in by name and PIN: the tiles of the people this device remembers, then the PIN pad for the one tapped. Shared
// by the login page and the lock screen; the caller fetches the people once and decides what a successful sign-in does
// next. The PIN is only ever checked by the server (signInWithPin). The look is the owner's HTML lock (values 4.3–4.4,
// design 5.6): the greeting, the search and the role tabs (always shown), the 6/4/3-column tile grid, then the pad.

export type StaffFilter = "all" | "admin" | "staff";

/** The wait countdown's tick: a local timer, never a request. */
const WAIT_TICK_MS = 1_000;

const ROLE_LABEL: Record<KnownPerson["role"], string> = { admin: "Admin", staff: "Staff" };
const FILTER_TABS: { value: StaffFilter; label: string }[] = [
  { value: "all", label: "All staff" },
  { value: "admin", label: "Admin" },
  { value: "staff", label: "Staff" },
];

/** A right PIN's line while our own sign-in completes (the HTML's word, ruling R30). */
const UNLOCKING = "Unlocking…";

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

/** "Good evening": the picker's headline, by the HTML's hours (ruling R28). */
export function pinGreeting(now: Date): string {
  return pickerGreeting(now);
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

/** The role tabs with their counts: everyone this device remembers, the admins, the staff (design 5.6, our roles). */
export function roleTabs(people: KnownPerson[]): { value: StaffFilter; label: string; count: number }[] {
  return FILTER_TABS.map((tab) => ({
    ...tab,
    count: tab.value === "all" ? people.length : people.filter((p) => p.role === tab.value).length,
  }));
}

export type TileSub = { text: string; tone: "locked" | "blocked" | "role" };

/** The line under a tile's name (values 4.3, design 5.6): the locker's "Locked · {ago}", "PIN blocked" for a PIN this
 *  screen has been told is blocked, else the role. */
export function tileSub(
  person: KnownPerson,
  highlight: { id: string; label: string } | null,
  blocked: ReadonlySet<string>,
): TileSub {
  if (highlight?.id === person.id) return { text: highlight.label, tone: "locked" };
  if (blocked.has(person.id)) return { text: "PIN blocked", tone: "blocked" };
  return { text: ROLE_LABEL[person.role], tone: "role" };
}

/** An empty search's line (the HTML's words, values 4.3). */
export function noStaffLine(query: string): string {
  return `No staff found for “${query.trim()}”.`;
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

// The tile's sub line colour per state (values 4.3): accent-i for the locker, bad-i for a blocked PIN, else text-2.
const SUB_TONE: Record<TileSub["tone"], string> = {
  locked: "text-accent-foreground",
  blocked: "text-status-bad-ink",
  role: "text-muted-foreground",
};

// A tile (values 4.3): 14px 6px 12px, radius 12, 8px from the avatar to the name; hover --hover with the border.
const TILE_CLASS = cn(
  "relative flex min-w-0 flex-col items-center gap-2 rounded-[12px] border px-1.5 pb-3 pt-3.5 text-foreground hover:border-border hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-html-rise-tile",
  HTML_PRESS_CLASS,
);

// A role tab (values 4.3): 40px, 0 12px, 13.5px; the chosen one 600 in the text colour with the accent's 2px inset line,
// as the HTML's exact shadow (Tailwind's shadow utilities add four empty ring layers), so the focus mark is an outline
// (RangeBar's way): the focused tab is the chosen one, whose line would hide a ring.
const TAB_CLASS = cn(
  "inline-block h-10 flex-none px-3 text-[13.5px] font-medium leading-[normal] text-muted-foreground after:hidden data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:[box-shadow:inset_0_-2px_0_var(--color-primary)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
  HTML_PRESS_CLASS,
);

// The pad's back link (values 4.4): link colour, 14/500, 4px 0, a 16px chevron 4px from the words.
const BACK_CLASS = cn(
  "flex items-center gap-1 self-start rounded-[6px] px-0 py-1 text-[14px] font-medium leading-[normal] text-link outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  HTML_PRESS_CLASS,
);

// The 80px avatar's ring on a right PIN (values 4.4 lk.ring): 4px of the card, then 2px of --ok; it eases in over .3s.
const AVATAR_RING_EASE = "[&>span:first-child]:transition-[box-shadow] [&>span:first-child]:duration-300";
const AVATAR_RING = "[&>span:first-child]:[box-shadow:0_0_0_4px_var(--color-card),0_0_0_6px_var(--color-status-ok)]";

/** The HTML's shades the kit pad has no preset twin for: text-3 empty dots, ok on success, bad-i / ok-i words, the
 *  pressed fill and the press. */
const PAD_TONES: PinPadTones = {
  dotEmpty: "border-subtle-foreground",
  dotSuccess: "border-status-ok bg-status-ok",
  message: "text-status-bad-ink",
  messageSuccess: "text-status-ok-ink",
  key: cn("active:bg-surface-3", HTML_PRESS_CLASS),
};

// The HTML's glyphs (values 5): the search magnifier, the tile's padlock, the back chevron.
function SearchGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="flex-none text-subtle-foreground"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PadlockGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function BackGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

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
  // Ruling R30: a right PIN shows the HTML's success look while the caller finishes the sign-in.
  const [succeeded, setSucceeded] = useState(false);
  // Each refusal replays the dots' shake (the HTML's errN).
  const [errorCount, setErrorCount] = useState(0);
  // The people this screen has been told have a blocked PIN: their tiles say so (design 5.6). Local only.
  const [blockedIds, setBlockedIds] = useState<ReadonlySet<string>>(() => new Set());
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
    setSucceeded(false);
    setErrorCount(0);
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
      // The success look (green dots, the ring, "Unlocking…") shows at once; the pad stays disabled while the caller
      // moves on (the page navigates, the lock screen closes). Nothing here waits for an animation.
      setSucceeded(true);
      try {
        await onSignedIn(person);
      } catch {
        setSucceeded(false);
        setBusy(false);
        setPin("");
        setFailure({ kind: "error" });
        setErrorCount((n) => n + 1);
      }
      return;
    }
    setBusy(false);
    setPin("");
    setErrorCount((n) => n + 1);
    if (answer.failure.kind === "blocked") setBlockedIds((ids) => new Set(ids).add(person.id));
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
    // The HTML dims the keypad while a person is locked out: our wait and a blocked PIN.
    const lockedOut = waiting > 0 || failure?.kind === "blocked";
    return (
      <div data-ui="pin-view" className="flex flex-col items-center gap-[18px] motion-safe:animate-html-fade-fast tab:pb-2 tab:pt-1">
        {/* Not while a try is in flight: its answer belongs to this pad. */}
        <button ref={backRef} type="button" data-ui="pin-back" onClick={backToTiles} disabled={busy} className={BACK_CLASS}>
          <BackGlyph />
          All staff
        </button>
        <StaffAvatar
          name={chosen.name}
          seed={chosen.id}
          size="lg"
          className={cn(AVATAR_RING_EASE, succeeded && AVATAR_RING)}
        />
        <div data-ui="pin-name" className="text-center">
          <h1 className="text-[20px] font-semibold">{chosen.name}</h1>
          <p className="mt-[3px] text-[13.5px] text-muted-foreground">{ROLE_LABEL[chosen.role]} · Enter your 4-digit PIN</p>
        </div>
        <PinPad
          keyboard
          value={pin}
          onChange={setPin}
          onComplete={submit}
          error={pad.message}
          disabled={pad.disabled}
          errorCount={errorCount}
          successText={succeeded ? UNLOCKING : null}
          dimmed={lockedOut}
          tones={PAD_TONES}
        />
        {useYourPassword && (
          <button type="button" data-ui="pin-use-password" onClick={onUsePassword} className={AUTH_LINK_CLASS}>
            Sign in with username and password
          </button>
        )}
        <div className="flex flex-col items-center">
          <button
            type="button"
            data-ui="pin-forgot"
            onClick={() => setForgotShown(true)}
            aria-expanded={forgotShown}
            className={AUTH_LINK_CLASS}
          >
            Forgot PIN?
          </button>
          {forgotShown && (
            <p className="text-center text-[13.5px] text-muted-foreground">Ask an admin to tell you or reset your PIN.</p>
          )}
        </div>
      </div>
    );
  }

  const tabs = roleTabs(people);
  const tiles = visiblePeople(people, filter, query);
  const names = tileNames(tiles);
  const grid = (
    <>
      <div data-ui="pick-grid" className="grid grid-cols-3 gap-1.5 tab:grid-cols-4 tab:gap-2 desk:grid-cols-6">
        {tiles.map((person, index) => {
          const sub = tileSub(person, highlight, blockedIds);
          const marked = sub.tone === "locked";
          return (
            <button
              key={person.id}
              type="button"
              data-staff-id={person.id}
              data-highlight={marked ? "true" : undefined}
              title={person.name}
              onClick={() => choose(person)}
              // The HTML's stagger: min(.05 + i × .03, .4) s.
              style={{ animationDelay: `${Math.min(0.05 + index * 0.03, 0.4).toFixed(2)}s` }}
              className={cn(TILE_CLASS, marked ? "border-accent-b bg-accent" : "border-transparent bg-transparent")}
            >
              <span className="relative inline-flex">
                <StaffAvatar name={person.name} seed={person.id} size="tile" />
                {marked && (
                  <span
                    data-ui="pick-badge"
                    aria-hidden="true"
                    className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-[50%] bg-ink text-on-ink [box-shadow:0_0_0_2px_var(--color-card)]"
                  >
                    <PadlockGlyph />
                  </span>
                )}
              </span>
              <span className="flex max-w-full flex-col items-center">
                <span data-ui="pick-tile-name" className="max-w-full truncate text-[13px] font-medium tab:text-[14px]">
                  {names.get(person.id)}
                </span>
                <span data-ui="pick-tile-sub" className={cn("whitespace-nowrap text-[12px]", SUB_TONE[sub.tone])}>
                  {sub.text}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {tiles.length === 0 && (
        <p data-ui="pick-empty" className="p-5 text-center text-[14px] text-muted-foreground">
          {noStaffLine(query)}
        </p>
      )}
    </>
  );

  return (
    <div data-ui="pick" className="flex flex-col gap-5">
      <div data-ui="pick-head" className="flex flex-wrap items-end justify-between gap-3.5">
        <div>
          <h1 data-ui="pick-greeting" className="text-[22px] font-semibold tracking-[-0.02em] tab:text-[26px]">
            {now ? pinGreeting(now) : " "}
          </h1>
          <p data-ui="pick-sub" className="mt-1 text-[14px] text-muted-foreground">
            Select your name to sign in{now ? ` · ${pickerDateLabel(now)}` : ""}
          </p>
        </div>
        <label
          data-ui="pick-search"
          className="flex h-10 w-[calc(100%-32px)] items-center gap-2 rounded-[8px] border border-border bg-card px-3 tab:w-[260px]"
        >
          <SearchGlyph />
          {/* type="search" for the phone keyboard's search key; Chrome's own clear button is hidden (the HTML's input has
              none). */}
          <input
            data-ui="pick-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search staff"
            aria-label="Search staff"
            autoComplete="off"
            className="min-w-0 flex-1 border-0 bg-transparent px-0.5 py-px text-[14px] text-foreground outline-none placeholder:text-subtle-foreground [&::-webkit-search-cancel-button]:appearance-none"
          />
        </label>
      </div>

      <Tabs
        data-ui="pick-tabs-root"
        value={filter}
        onValueChange={(v) => setFilter(v as StaffFilter)}
        className="-mt-1.5 flex flex-col gap-5"
      >
        <TabsList
          variant="underline"
          data-ui="pick-tabs"
          className="flex h-auto w-full justify-start gap-1 overflow-x-auto border-b border-border [&::-webkit-scrollbar]:h-0"
        >
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} variant="underline" data-ui="pick-tab" className={TAB_CLASS}>
              {tab.label}{" "}
              <span data-ui="pick-tab-count" className="font-normal text-subtle-foreground">
                {tab.count}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="mt-0 flex flex-col gap-5">
            {tab.value === filter ? grid : null}
          </TabsContent>
        ))}
      </Tabs>

      <button type="button" data-ui="pin-use-password" onClick={onUsePassword} className={cn(AUTH_LINK_CLASS, "self-center")}>
        Sign in with username and password
      </button>
    </div>
  );
}
