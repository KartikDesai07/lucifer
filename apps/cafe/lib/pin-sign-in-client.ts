"use client";

import { signIn, type SignInResponse } from "next-auth/react";
import { parsePinFailure, type PinSignInFailure } from "@pos/shared/staff-pin";
import { apiGet, apiSend } from "@/lib/api-client";

// The page side of PIN sign-in (spec 2026-10-16 §5.3, §5.6), shared by the login page and the lock
// screen. Client-safe on purpose: only next-auth/react, the shared PIN rules and the fetch helpers
// (lib/client-graph-guard.test.ts holds the import graph). The PIN is only ever checked by the server.

/** One name tile: a person this device remembers who has a PIN (GET /api/sign-in/known). */
export type KnownPerson = {
  id: string;
  name: string;
  shortName: string;
  initials: string;
  role: "admin" | "staff";
};

export type PinSignInAnswer = { ok: true } | { ok: false; failure: PinSignInFailure };

const OFFLINE: PinSignInAnswer = { ok: false, failure: { kind: "offline" } };

/** The people this device remembers who have a PIN, newest sign-in first. Any failure reads as nobody. */
export async function fetchKnownPeople(): Promise<KnownPerson[]> {
  try {
    const data = await apiGet<{ people?: KnownPerson[] }>("/api/sign-in/known");
    return Array.isArray(data?.people) ? data.people : [];
  } catch {
    return [];
  }
}

/** After a sign-in, this device remembers the signed-in person. Never fails the sign-in. */
export async function rememberThisDevice(): Promise<void> {
  try {
    await apiSend("/api/sign-in/remember", "POST");
  } catch {
    // Best-effort: the next sign-in on this device remembers them instead.
  }
}

/**
 * One PIN try for the person whose tile was chosen. Switches the session in place (no reload):
 * Auth.js updates useSession everywhere. A device that is offline, or a request that never got an
 * answer, reads as "offline"; a refused try carries its code ("wrong:3", "wait:540", ...).
 */
export async function signInWithPin(staffId: string, pin: string): Promise<PinSignInAnswer> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return OFFLINE;
  let result: SignInResponse | undefined;
  try {
    result = await signIn("pin", { staffId, pin, redirect: false });
  } catch {
    return OFFLINE;
  }
  // No answer object: next-auth could not even read its provider list (it then navigates itself).
  if (!result) return OFFLINE;
  if (result.ok && !result.error) return { ok: true };
  return { ok: false, failure: parsePinFailure(result.code) };
}
