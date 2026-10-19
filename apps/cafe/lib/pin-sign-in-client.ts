"use client";

import { getProviders, signIn, type SignInResponse } from "next-auth/react";
import { parsePinFailure, type PinSignInFailure } from "@pos/shared/staff-pin";
import { ApiError, apiGet, apiSend } from "@/lib/api-client";

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
/** The lock screen's in-place password sign-in; "credentials" shows today's "Invalid username or password". */
export type PasswordSignInAnswer = { ok: true } | { ok: false; failure: PinSignInFailure | { kind: "credentials" } };
/** The fields of what signIn(..., { redirect: false }) resolves with that the answers are read from. */
export type SignInResult = { ok: boolean; error?: string; code?: string };

const OFFLINE: { ok: false; failure: { kind: "offline" } } = { ok: false, failure: { kind: "offline" } };
const ERROR: { ok: false; failure: { kind: "error" } } = { ok: false, failure: { kind: "error" } };
const CREDENTIALS: { ok: false; failure: { kind: "credentials" } } = { ok: false, failure: { kind: "credentials" } };

/**
 * What a PIN try's result means for the page. Only a code the server really sends counts as that
 * kind (parsePinFailure reads any unknown code as nopin); anything else, such as Auth.js's
 * "Configuration" with no code on a server or database error, is "error" (try again), never nopin.
 */
export function pinSignInOutcome(result: SignInResult | undefined): PinSignInAnswer {
  if (!result) return OFFLINE;
  if (result.ok && !result.error) return { ok: true };
  const failure = parsePinFailure(result.code);
  const known = typeof result.code === "string" && (failure.kind !== "nopin" || result.code === "nopin");
  return known ? { ok: false, failure } : ERROR;
}

/** What a password sign-in's result means: any refusal reads as wrong credentials, as on the login page. */
export function passwordSignInOutcome(result: SignInResult | undefined): PasswordSignInAnswer {
  if (!result) return OFFLINE;
  if (result.ok && !result.error) return { ok: true };
  return CREDENTIALS;
}

// next-auth's signIn navigates the whole page away when it cannot read its provider list (it sets
// window.location to /api/auth/error, or to its sign-in page for an unknown provider). Under the lock
// screen that would unload the dashboard and stop printing, so each sign-in asks for the list itself
// first and never calls signIn without it (controller ruling R8).
async function reachServer(provider: "pin" | "credentials"): Promise<"ok" | "offline" | "missing"> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  let providers: Awaited<ReturnType<typeof getProviders>>;
  try {
    providers = await getProviders();
  } catch {
    return "offline";
  }
  if (!providers) return "offline";
  return providers[provider] ? "ok" : "missing";
}

/** How long the known-people look-up may take before the page stops waiting (any late answer is ignored). */
export const KNOWN_PEOPLE_TIMEOUT_MS = 6000;

/**
 * The people this device remembers who have a PIN, newest sign-in first. Any failure, or no answer within
 * the timeout, reads as nobody (the login page then shows the password form). `opts` is for tests.
 */
export async function fetchKnownPeople(
  opts: { timeoutMs?: number; get?: () => Promise<{ people?: KnownPerson[] }> } = {},
): Promise<KnownPerson[]> {
  const { timeoutMs = KNOWN_PEOPLE_TIMEOUT_MS, get = () => apiGet<{ people?: KnownPerson[] }>("/api/sign-in/known") } = opts;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const nobody = new Promise<KnownPerson[]>((resolve) => {
    timer = setTimeout(() => resolve([]), timeoutMs);
  });
  const answer = (async (): Promise<KnownPerson[]> => {
    try {
      const data = await get();
      return Array.isArray(data?.people) ? data.people : [];
    } catch {
      return [];
    }
  })();
  try {
    return await Promise.race([answer, nobody]);
  } finally {
    clearTimeout(timer);
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
 * Auth.js updates useSession everywhere. A device that is offline, a server that cannot be reached
 * or a request that never got an answer reads as "offline"; a refused try carries its code
 * ("wrong:3", "wait:540", ...).
 */
export async function signInWithPin(staffId: string, pin: string): Promise<PinSignInAnswer> {
  const server = await reachServer("pin");
  if (server !== "ok") return server === "offline" ? OFFLINE : ERROR;
  let result: SignInResponse | undefined;
  try {
    result = await signIn("pin", { staffId, pin, redirect: false });
  } catch {
    return OFFLINE;
  }
  return pinSignInOutcome(result);
}

/**
 * The dashboard's sales reveal (U0 match Task 6, design 7): is this the signed-in person's own PIN? The server checks
 * it in the same per-person window as a PIN sign-in and answers the same codes; nobody is signed in or out. An offline
 * device, or a request that never got an answer, reads as "offline"; a server error as "error" (try again).
 */
export async function verifyOwnPin(pin: string): Promise<PinSignInAnswer> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return OFFLINE;
  try {
    const data = await apiSend<{ ok?: unknown; code?: unknown }>("/api/sign-in/verify-pin", "POST", { pin });
    if (data?.ok === true) return { ok: true };
    return pinSignInOutcome({ ok: false, code: typeof data?.code === "string" ? data.code : undefined });
  } catch (error) {
    return error instanceof ApiError && error.kind === "http" ? ERROR : OFFLINE;
  }
}

/**
 * The lock screen's password sign-in, in place (no reload), with the same guard as the PIN: it
 * switches or confirms the person exactly like a PIN does, so printing goes on.
 */
export async function signInWithPassword(username: string, password: string): Promise<PasswordSignInAnswer> {
  const server = await reachServer("credentials");
  if (server !== "ok") return server === "offline" ? OFFLINE : ERROR;
  let result: SignInResponse | undefined;
  try {
    result = await signIn("credentials", { username, password, redirect: false });
  } catch {
    return OFFLINE;
  }
  return passwordSignInOutcome(result);
}
