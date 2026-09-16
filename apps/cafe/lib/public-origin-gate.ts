// Cheap same-origin check for the public order-intake path — DEFENCE IN
// DEPTH only. The primary fence is Vercel BotID (checked first, in
// public-order-intake.ts): it issues a client-side challenge the browser must
// echo back, so a cross-site POST arrives with NO challenge token and is
// already rejected 403 before this ever runs (live-probed 2026-09-13). This
// helper is a cheap belt-and-braces backstop behind that, not a rewrite of it.

// Public denial copy — never echoes the received origin/host back to the
// caller (mirrors lib/order-request-edit.ts's own denial-message style: a
// public 403 must not leak what it saw).
export const ORIGIN_DENIED_MESSAGE = "Access denied";

// Parses `url` and lowercases its host, or returns null on any malformed/
// unparseable input — the `URL` constructor throws on bad input, and a public
// gate must never let a parse failure become an uncaught 500.
function parsedHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

// origin/referer/host -> allow decision.
//   origin present                    -> true only if its host === host
//   origin absent, referer present    -> true only if referer's host === host
//   origin absent AND referer absent  -> true (see below)
//   either header malformed/unparseable -> false, never throws
// `origin` is checked first and wins over `referer` when both are present:
// a request that carries a mismatched Origin must not be let through by a
// spoofed-but-matching Referer.
//
// BOTH absent -> TRUE. Load-bearing: a QR-code scan opened by a phone
// camera app, and some in-app browsers, legitimately send neither header on
// the very first navigation — failing closed here would block real diners,
// not attackers (a scripted client can trivially set either header anyway,
// so the absence case carries no defensive value to begin with).
export function sameOriginOk(origin: string | null, referer: string | null, host: string | null): boolean {
  if (origin !== null) {
    const originHost = parsedHost(origin);
    return originHost !== null && originHost === host?.toLowerCase();
  }
  if (referer !== null) {
    const refererHost = parsedHost(referer);
    return refererHost !== null && refererHost === host?.toLowerCase();
  }
  return true;
}
