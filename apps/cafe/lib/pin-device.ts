import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { PIN_DEVICE_MAX, PIN_DEVICE_MAX_AGE_SECONDS } from "@pos/shared/staff-pin";

// The device's memory for PIN sign-in: a signed httpOnly cookie listing the
// people who signed in on this device with a username and password. Pure
// node:crypto, no DB. Server-only: never import from a "use client" file.
// Every read failure returns null; nothing here throws.

export type PinDevicePerson = { id: string; at: number };

const SALT = "pos-pin-device-v1";
const INFO = "pin-device";
const KEY_BYTES = 32;
const ID_PATTERN = /^[0-9a-f]{24}$/;

/** HKDF key from the auth secret; null (never throws) when no secret is set. */
export function pinDeviceKey(secret: string | undefined): Buffer | null {
  if (!secret) return null;
  try {
    return Buffer.from(hkdfSync("sha256", secret, SALT, INFO, KEY_BYTES));
  } catch {
    return null;
  }
}

function mac(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function signPinDevice(people: PinDevicePerson[], key: Buffer): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, p: people.map((p) => [p.id, p.at]) }), "utf8").toString(
    "base64url",
  );
  return `${payload}.${mac(payload, key)}`;
}

export function readPinDevice(value: string | undefined, key: Buffer | null): PinDevicePerson[] | null {
  if (!value || !key || typeof value !== "string") return null;
  try {
    const parts = value.split(".");
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    const expected = Buffer.from(mac(payload, key), "utf8");
    const given = Buffer.from(signature, "utf8");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (typeof data !== "object" || data === null) return null;
    const { v, p } = data as { v?: unknown; p?: unknown };
    if (v !== 1 || !Array.isArray(p) || p.length > PIN_DEVICE_MAX) return null;

    const people: PinDevicePerson[] = [];
    for (const entry of p) {
      if (!Array.isArray(entry) || entry.length !== 2) return null;
      const [id, at] = entry as [unknown, unknown];
      if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
      if (typeof at !== "number" || !Number.isFinite(at) || at < 0) return null;
      people.push({ id, at });
    }
    return people;
  } catch {
    return null;
  }
}

/** The person moves to the front with `at = now`; duplicates removed; oldest dropped past the cap. Pure. */
export function rememberPerson(people: PinDevicePerson[] | null, id: string, now: number): PinDevicePerson[] {
  const rest = (people ?? []).filter((p) => p.id !== id);
  return [{ id, at: now }, ...rest].slice(0, PIN_DEVICE_MAX);
}

/** Raw value of cookie `name` from a Cookie header (whole-name match only). */
export function cookieValue(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function pinDeviceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: PIN_DEVICE_MAX_AGE_SECONDS,
  };
}
