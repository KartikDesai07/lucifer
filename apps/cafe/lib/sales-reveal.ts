// The dashboard's sales mask (U0 match Task 6; the owner's decision 1, design 7; values 3.3, 3.16, 3.17). The figures
// read "₹ • • • •" until the signed-in person enters their OWN PIN (checked by the server, POST
// /api/sign-in/verify-pin), then show for one hour on this device. Pure: the reveal button's three states, the mask,
// and the grant this tab keeps in sessionStorage. Whether the figures are shown right now is the page's own state
// (it starts hidden on every visit and hides on a lock); the grant only says who may show them again without a PIN,
// until when.

/** One hour (the HTML's rvUntil = now + 3600e3). */
export const SALES_REVEAL_MS = 3_600_000;
/** sessionStorage key of the grant, { by, until }. */
export const SALES_REVEAL_KEY = "pos.salesReveal";

/** values 3.17: MK(v) = '₹ • • • •' (₹, a space, then four U+2022 bullets with single spaces). */
export const MASKED_MONEY = "₹ • • • •";
/** values 3.4: a masked bill-breakdown row. */
export const MASKED_BILL_VALUE = "• • • •";

export const REVEAL_TOAST = "Sales visible for the next hour · tap the eye to hide";
export const REVEAL_TITLE = "Show sales figures";
export const REVEAL_SUB =
  "Sales stay visible on this device for 1 hour. They hide again when the screen locks or you leave Dashboard.";
/** design 7: a person with no PIN sees why instead of the keys. */
export const REVEAL_NO_PIN_MESSAGE = {
  admin: "Set a PIN on the Staff page to show sales.",
  staff: "Ask an admin to set your PIN to show sales.",
} as const;

const MINUTE_MS = 60_000;

/** Who may show the figures without a PIN, until when (epoch ms). */
export interface SalesReveal {
  by: string;
  until: number;
}

export type RevealIcon = "eye" | "eye-off";
export type RevealHintIcon = "lock" | "clock";

/** The reveal button and its hint (values 3.3's table), plus what the page acts on. */
export interface RevealView {
  label: "Show" | "Hide";
  icon: RevealIcon;
  /** The button's fill: the HTML's literal values. */
  bg: "transparent" | "#2A2A2F";
  title: string;
  hint: string;
  hintIcon: RevealHintIcon;
  hintColor: "#A1A1AA" | "#6FDC8C";
  /** The figures show (SHOW = rvShow && rvOk()). */
  visible: boolean;
  /** This person may show them without a PIN (rvOk(): the grant is theirs and the hour has not run out). */
  unlocked: boolean;
  /** Whole minutes left, rounded up (rvLeft); 0 without a live grant. */
  minutesLeft: number;
}

/** The HTML's rvOk(): the grant is this person's and still running. */
export function revealUnlocked(input: { by: string | null; until: number; me: string | null; now: number }): boolean {
  return input.me !== null && input.by === input.me && input.now < input.until;
}

/** values 3.3: masked with no unlock · shown · hidden but still unlocked within the hour. */
export function revealState(input: { shown: boolean; until: number; by: string | null; me: string | null; now: number }): RevealView {
  const unlocked = revealUnlocked(input);
  const visible = input.shown && unlocked;
  const minutesLeft = unlocked ? Math.ceil((input.until - input.now) / MINUTE_MS) : 0;
  if (visible) {
    return {
      label: "Hide",
      icon: "eye-off",
      bg: "#2A2A2F",
      title: "Hide sales figures",
      hint: `Visible · hides in ${minutesLeft} min`,
      hintIcon: "clock",
      hintColor: "#6FDC8C",
      visible,
      unlocked,
      minutesLeft,
    };
  }
  if (unlocked) {
    return {
      label: "Show",
      icon: "eye",
      bg: "transparent",
      title: "Show sales figures",
      hint: `Unlocked · ${minutesLeft} min left`,
      hintIcon: "clock",
      hintColor: "#A1A1AA",
      visible,
      unlocked,
      minutesLeft,
    };
  }
  return {
    label: "Show",
    icon: "eye",
    bg: "transparent",
    title: "Enter your PIN to show sales",
    hint: "PIN needed to view",
    hintIcon: "lock",
    hintColor: "#A1A1AA",
    visible,
    unlocked,
    minutesLeft,
  };
}

/** values 3.17: the money as given once shown, else "₹ • • • •" (a bill-breakdown row: "• • • •"). */
export function maskMoney(text: string, shown: boolean, kind: "money" | "bill" = "money"): string {
  if (shown) return text;
  return kind === "bill" ? MASKED_BILL_VALUE : MASKED_MONEY;
}

/** A right PIN: this person, for the next hour. */
export function grantSalesReveal(me: string, now: number): SalesReveal {
  return { by: me, until: now + SALES_REVEAL_MS };
}

/**
 * How long until the hint's minute count changes (or the hour ends), so the page re-renders exactly then; null once
 * the grant has run out (nothing left to count).
 */
export function nextRevealTick(until: number, now: number): number | null {
  const left = until - now;
  if (left <= 0) return null;
  return ((left - 1) % MINUTE_MS) + 1;
}

/** "{First name}, enter your PIN" (values 3.16), from the session's name. */
export function revealPrompt(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? `${first}, enter your PIN` : "Enter your PIN";
}

interface ReadStorage {
  getItem(key: string): string | null;
}
interface WriteStorage {
  setItem(key: string, value: string): void;
}

/** The grant this tab holds, or null (nothing, junk, the wrong shape, or a storage that throws). */
export function readSalesReveal(storage: ReadStorage | null): SalesReveal | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SALES_REVEAL_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { by, until } = value as { by?: unknown; until?: unknown };
    return typeof by === "string" && typeof until === "number" && Number.isFinite(until) ? { by, until } : null;
  } catch {
    return null;
  }
}

/** Keeps the grant for this tab; a storage that refuses only costs the next Show a PIN. */
export function writeSalesReveal(storage: WriteStorage | null, reveal: SalesReveal): void {
  if (!storage) return;
  try {
    storage.setItem(SALES_REVEAL_KEY, JSON.stringify({ by: reveal.by, until: reveal.until }));
  } catch {
    // Blocked or full storage: the figures still show for this visit.
  }
}
