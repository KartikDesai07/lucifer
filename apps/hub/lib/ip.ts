// ─────────────────────────────────────────────────────────────────────────────
// IP allowlisting (F3.4 / fed-secrets-vault.json §E-3: "source IP ∈ allowlist,
// checked in the route handler, NOT only middleware"). Pure — no I/O, fully
// unit-testable. Matches an IP against exact addresses or CIDR ranges, IPv4 and
// IPv6 (BigInt prefix compare). Every entry FAILS CLOSED: an unparseable entry
// or address matches nothing, so a typo in the allowlist can never widen it.
//
// TRUST MODEL: on Vercel, the platform sets `x-forwarded-for` (client → edge
// chain) and `x-real-ip` (the true client IP) and OVERWRITES any client-supplied
// value at the proxy, so the LEFTMOST forwarded hop / x-real-ip is trustworthy
// on that host. This is the documented deployment assumption; a bare Node host
// behind no trusted proxy would need its own reverse-proxy guarantee.
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the client IP from request headers (see the trust model above).
 * Prefers `x-real-ip`; falls back to the FIRST `x-forwarded-for` hop; then a
 * dev-only loopback. Strips an IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4)
 * so allowlist entries can be written as plain IPv4. */
export function clientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return stripV4Mapped(realIp);
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return stripV4Mapped(first);
  }
  return "127.0.0.1"; // local dev / no proxy — never allowlisted in prod
}

function stripV4Mapped(ip: string): string {
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/iu.exec(ip);
  return m ? m[1] : ip;
}

/** Parse an IPv4/IPv6 address to a BigInt + bit-width, or null if malformed. */
function parseIp(ip: string): { value: bigint; bits: number } | null {
  const clean = stripV4Mapped(ip.trim());
  if (clean.includes(".") && !clean.includes(":")) {
    const parts = clean.split(".");
    if (parts.length !== 4) return null;
    // BigInt() constructors (not `0n`/`8n` literals) so the module type-checks on
    // the hub's ES2017 target while the `bigint` type comes from the esnext lib.
    let value = BigInt(0);
    for (const part of parts) {
      if (!/^\d{1,3}$/u.test(part)) return null;
      const n = Number(part);
      if (n > 255) return null;
      value = (value << BigInt(8)) | BigInt(n);
    }
    return { value, bits: 32 };
  }
  if (clean.includes(":")) {
    const v6 = expandV6(clean);
    // `=== null`, NOT `!v6`: the all-zeros address `::` is a VALID BigInt(0),
    // which is falsy — a `!v6` guard would wrongly reject it.
    if (v6 === null) return null;
    return { value: v6, bits: 128 };
  }
  return null;
}

/** Expand an IPv6 address (including `::` compression) to a 128-bit BigInt. */
function expandV6(ip: string): bigint | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - (head.length + tail.length);
  if (halves.length === 1) {
    if (head.length !== 8) return null;
  } else if (missing < 0) {
    return null;
  }
  const groups = [...head, ...Array(Math.max(missing, 0)).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  let value = BigInt(0);
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/u.test(group)) return null;
    value = (value << BigInt(16)) | BigInt(parseInt(group, 16));
  }
  return value;
}

/** Match `ip` against one allowlist entry (exact address or `addr/prefix` CIDR).
 * Returns false on ANY malformed input (fail-closed per entry). */
export function ipMatchesEntry(ip: string, entry: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return false;
  const slash = trimmed.indexOf("/");
  const addr = slash === -1 ? trimmed : trimmed.slice(0, slash);

  const target = parseIp(ip);
  const base = parseIp(addr);
  if (!target || !base) return false;
  if (target.bits !== base.bits) return false; // never cross v4/v6 families

  if (slash === -1) return target.value === base.value;

  const prefixRaw = trimmed.slice(slash + 1);
  if (!/^\d{1,3}$/u.test(prefixRaw)) return false;
  const prefix = Number(prefixRaw);
  if (prefix > base.bits) return false;
  if (prefix === 0) return true; // 0.0.0.0/0 or ::/0 — matches all of its family
  const shift = BigInt(base.bits - prefix);
  return target.value >> shift === base.value >> shift;
}

/** True if `ip` matches any entry in `allowlist`. An EMPTY allowlist returns
 * false — the caller (the gate) decides the "not yet configured" bootstrap
 * policy explicitly; this function never implicitly allows. */
export function ipInAllowlist(ip: string, allowlist: readonly string[]): boolean {
  return allowlist.some((entry) => ipMatchesEntry(ip, entry));
}

/**
 * The FULL allowlist decision used by both the login path (lib/auth.ts) and the
 * panel gate (lib/panel-gate.ts). FAILS CLOSED on an empty allowlist unless the
 * explicit `allowAnyIp` bootstrap flag is set — so a production HubUser whose
 * allowlist was never configured is locked out, not silently open (the §E-3
 * allowlist must never be a no-op). `allowAnyIp` (env HUB_ALLOW_ANY_IP=1) is a
 * local-dev / first-boot escape hatch; in prod the seed sets the allowlist
 * BEFORE first login, so there is no chicken-and-egg.
 */
export function ipAllowed(
  ip: string,
  allowlist: readonly string[],
  allowAnyIp: boolean,
): boolean {
  if (allowlist.length === 0) return allowAnyIp;
  return ipInAllowlist(ip, allowlist);
}
