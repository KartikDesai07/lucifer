import { z } from "zod";
import { DINER_PIN_BANNED } from "./public-diner";

// Staff PIN sign-in rules (spec 2026-10-16 §5.1-5.4), shared by the schemas, the
// routes, the login page and the lock screen.

// ── The PIN ─────────────────────────────────────────────────────────────────
export const STAFF_PIN_LENGTH = 4;
export const STAFF_PIN_PATTERN = /^[0-9]{4}$/;
// The same easy-to-guess list the diner PIN refuses (one list, not a copy).
export const STAFF_PIN_EASY = DINER_PIN_BANNED;

export function staffPinProblem(v: unknown): "shape" | "easy" | null {
  if (typeof v !== "string" || !STAFF_PIN_PATTERN.test(v)) return "shape";
  if ((STAFF_PIN_EASY as readonly string[]).includes(v)) return "easy";
  return null;
}

export function isValidStaffPin(v: unknown): v is string {
  return staffPinProblem(v) === null;
}

export const STAFF_PIN_MESSAGES = {
  shape: "Enter exactly 4 digits.",
  easy: "Too easy to guess. Pick another PIN.",
} as const;

export const staffPinSchema = z.string().superRefine((v, ctx) => {
  const problem = staffPinProblem(v);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: STAFF_PIN_MESSAGES[problem] });
});

// ── Rate limits ─────────────────────────────────────────────────────────────
export const STAFF_PIN_RATE_MAX = 5;
export const STAFF_PIN_DAILY_BLOCK = 20;
export function staffPinBucket(staffId: string): string {
  return `staffpin:${staffId}`;
}

// ── Remembered devices ──────────────────────────────────────────────────────
export const PIN_DEVICE_COOKIE = "pos-pin-device";
export const PIN_DEVICE_MAX = 30;
export const PIN_DEVICE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

// ── Screen lock ─────────────────────────────────────────────────────────────
// Idle minutes before the lock screen; 0 = never lock.
export const SCREEN_LOCK_MINUTES = [0, 30, 60, 120] as const;
export type ScreenLockMinutes = (typeof SCREEN_LOCK_MINUTES)[number];
export const SCREEN_LOCK_DEFAULT_MINUTES = 60;

// ── Sign-in failures ────────────────────────────────────────────────────────
export type PinSignInFailure =
  | { kind: "wrong"; triesLeft: number }
  | { kind: "wait"; retryAfterSec: number }
  | { kind: "blocked" }
  | { kind: "device" }
  | { kind: "nopin" }
  | { kind: "offline" }
  // The server answered but could not check the PIN (a database blip): page-side only, never a code.
  | { kind: "error" };

export function encodePinFailure(f: PinSignInFailure): string {
  switch (f.kind) {
    case "wrong":
      return `wrong:${f.triesLeft}`;
    case "wait":
      return `wait:${f.retryAfterSec}`;
    default:
      return f.kind;
  }
}

// An unknown or missing code is "nopin": a strange answer must never show a
// misleading count of tries.
export function parsePinFailure(code: string | undefined | null): PinSignInFailure {
  if (typeof code !== "string") return { kind: "nopin" };
  const [kind, n] = code.split(":");
  const num = n !== undefined && /^[0-9]+$/.test(n) ? Number(n) : null;
  if (kind === "wrong" && num !== null) return { kind: "wrong", triesLeft: num };
  if (kind === "wait" && num !== null) return { kind: "wait", retryAfterSec: num };
  if (n === undefined && (kind === "blocked" || kind === "device" || kind === "nopin" || kind === "offline")) {
    return { kind };
  }
  return { kind: "nopin" };
}

export function pinFailureMessage(f: PinSignInFailure): string {
  switch (f.kind) {
    case "wrong":
      return f.triesLeft > 0
        ? `Incorrect PIN · ${f.triesLeft} ${f.triesLeft === 1 ? "try" : "tries"} left`
        : "Incorrect PIN";
    case "wait":
      return `Too many wrong PINs. Try again in ${Math.ceil(f.retryAfterSec / 60)} min.`;
    case "blocked":
      return "This PIN is blocked after too many wrong tries. Ask an admin to unblock it.";
    case "device":
      return "Sign in with your username and password on this device first.";
    case "nopin":
      return "Sign in with your username and password.";
    case "offline":
      return "No internet. The PIN can't be checked right now. Printing goes on.";
    case "error":
      return "The PIN couldn't be checked just now. Please try again.";
  }
}
