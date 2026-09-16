import { cookies } from "next/headers";

import {
  DINER_COOKIE_NAME,
  DINER_SESSION_MAX_AGE_SECONDS,
  DINER_SESSION_TOKEN_LENGTH,
} from "@pos/shared/public-diner";
import { DinerSession } from "@/models/DinerSession";
import { mintUniquePublicToken } from "@/lib/public-token";
import { pruneRateWindows } from "@/lib/public-rate-limit";

// CB-4 — the diner session seam. The ONLY place the `pos_diner` cookie is read
// or written, so every rule below holds for the whole surface rather than at
// each call site.
//
// The cookie carries an OPAQUE HANDLE, never a signed claim about who the
// diner is. The entire forgotten-PIN recovery story is "staff reset it at the
// counter" (no OTP — the phase brief's cost decision), and a reset has to kill
// live sessions INSTANTLY; a stateless token stays valid until it expires, so
// it would make that counter promise false. Resolving therefore costs one
// primary-key lookup, which is also what lets `revokeDinerSessions` work.

// Rows older than this are reaped opportunistically. NOT a TTL index:
// @pos/shared/ttl-guard is default-DENY and throws at schema registration for
// any collection outside its allowlist, so the app prunes instead — the same
// discipline as lib/public-rate-limit.ts's pruneRateWindows.
const PRUNE_GRACE_MS = 24 * 60 * 60 * 1000;

export interface DinerSessionIdentity {
  customerId: string;
  mobile: string;
}

// `secure` is conditional ONLY on a non-production runtime: a Secure cookie is
// never sent over plain http, which would make the whole feature untestable on
// a local dev server. Every deployed environment is https, so this is always
// true in production.
function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // "lax", not "strict": the diner reaches /m by SCANNING A QR CODE, which
    // in many Android camera apps is a cross-site top-level navigation. Under
    // "strict" the cookie would be withheld on exactly that first hop and a
    // signed-in diner would look signed-out every time they scanned. "lax"
    // still withholds it from cross-site POSTs, which is the CSRF case that
    // matters — and the one unauthenticated write this app has
    // (POST /api/public/order-request) deliberately never reads this cookie
    // for authority at all, so its blast radius is unchanged either way.
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

// Mints a session row + sets the cookie. Called ONLY after a PIN has actually
// been verified — this function does not authenticate anything itself.
export async function startDinerSession(
  customerId: string,
  mobile: string,
  now: number = Date.now(),
): Promise<void> {
  const token = await mintUniquePublicToken(
    (t) => DinerSession.exists({ _id: t }).then(Boolean),
    DINER_SESSION_TOKEN_LENGTH,
  );
  const expiresAt = new Date(now + DINER_SESSION_MAX_AGE_SECONDS * 1000);
  await DinerSession.create({
    _id: token,
    customerId,
    mobile,
    at: new Date(now),
    expiresAt,
  });
  const jar = await cookies();
  jar.set(DINER_COOKIE_NAME, token, cookieOptions(DINER_SESSION_MAX_AGE_SECONDS));
}

// The raw cookie value, with NO database round-trip — used only as a
// rate-limit bucket key, never as proof of anything. An attacker can of course
// invent a token here, but that only buys them their own bucket; a REAL
// diner's budget is keyed on the token they actually hold, so one caller can
// never spend another's. Callers must still resolve the session properly
// (readDinerSession) before trusting any identity.
export async function readDinerSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(DINER_COOKIE_NAME)?.value ?? null;
}

// Resolves the caller's cookie to an identity, or null. Returns null for every
// failure mode alike (no cookie, unknown token, expired row) — a caller must
// never be able to tell "that session was revoked" from "there was no session".
//
// Expiry is checked in CODE as well as pruned: a row that outlives the prune,
// or one read under clock skew, still must not authenticate anyone.
export async function readDinerSession(
  now: number = Date.now(),
): Promise<DinerSessionIdentity | null> {
  const jar = await cookies();
  const token = jar.get(DINER_COOKIE_NAME)?.value;
  if (!token) return null;
  const row = await DinerSession.findById(token).lean();
  if (!row) return null;
  if (row.expiresAt.getTime() <= now) return null;
  return { customerId: String(row.customerId), mobile: row.mobile };
}

// Signs this ONE device out: deletes the row, then clears the cookie. Deleting
// first means a failure part-way through leaves the diner logged OUT, never
// holding a cookie that still resolves.
export async function endDinerSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(DINER_COOKIE_NAME)?.value;
  if (token) {
    try {
      await DinerSession.deleteOne({ _id: token });
    } catch {
      // Best-effort: the cookie is cleared below regardless, and the row
      // expires on its own. Never turn a sign-out into a 500.
    }
  }
  jar.delete(DINER_COOKIE_NAME);
}

// Revokes EVERY live session for one customer. This is what makes the
// counter-side PIN reset honest: the moment staff reset a PIN, any device
// still holding a cookie for that account stops resolving. Errors PROPAGATE —
// the caller (the staff reset route) must not report success if the old
// sessions might still be live.
export async function revokeDinerSessions(customerId: string): Promise<void> {
  await DinerSession.deleteMany({ customerId });
}

// Best-effort reap of long-expired rows, called opportunistically off the
// login path (never on a schedule — this platform has no cafe-side cron). The
// grace period keeps a just-expired row around briefly rather than racing a
// request that is already reading it.
export async function pruneDinerSessions(now: number = Date.now()): Promise<void> {
  try {
    await DinerSession.deleteMany({ expiresAt: { $lt: new Date(now - PRUNE_GRACE_MS) } });
  } catch {
    // best-effort — a failed prune costs storage, never correctness, and must
    // never turn a successful sign-in into an error.
  }
  // The diner buckets (dinerpin:/dinersrc:/dinerme:) write rows into the SAME
  // PublicRateLimit collection the order route uses, but the order route is the
  // only other caller of pruneRateWindows — so on a MENU-ONLY cafe (ordering
  // off, accounts on) nothing would ever reap them and that collection would
  // grow unbounded on a 512MB M0. Pruning here keeps every producer of those
  // rows paired with a reaper. Best-effort and already error-swallowing.
  await pruneRateWindows(now);
}
