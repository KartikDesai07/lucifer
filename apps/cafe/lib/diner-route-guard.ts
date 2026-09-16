import { createHash } from "node:crypto";

import type { ISettings } from "@/models/Settings";

// CB-4 — the shared gates and headers every /api/public/diner/** route uses,
// single-homed here so a new route on that surface cannot accidentally ship
// without them.

// A cafe that has not switched diner accounts on has no diner surface at all.
// Returned as a 404 rather than a 403: a cafe's feature configuration is not
// something an anonymous caller needs confirmed either way.
export const DINER_ACCOUNTS_OFF_MESSAGE = "Not found";

// Asked through this ONE predicate rather than `settings?.dinerAccountsEnabled`
// at each call site, so the "absent means OFF" reading is decided once. Note
// this is the OPPOSITE default from selfOrderingAllowed (where absent means
// ordering stays ON): ordering is pre-existing behaviour every live cafe
// already has, while a diner account is a NEW capability that must be an
// explicit opt-in, never switched on by a deploy.
export function dinerAccountsOn(settings: ISettings | null): boolean {
  return settings?.dinerAccountsEnabled === true;
}

// The stamp card additionally requires accounts — a stamp belongs to an
// account, so loyalty without identity is meaningless. Checked as a
// conjunction here so no route can enable one without the other.
export function dinerLoyaltyOn(settings: ISettings | null): boolean {
  return dinerAccountsOn(settings) && settings?.loyaltyEnabled === true;
}

// Every response on this surface is uncacheable and nosniff. These payloads
// name a SPECIFIC diner, so a cached copy served to the next phone on the same
// cafe WiFi would be a cross-diner data leak — the one failure this surface
// must never have. Mirrors the noStore helper on the sibling public routes.
export function noStoreDiner<T extends { headers: Headers }>(res: T): T {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

// A stable, NON-REVERSIBLE bucket id for one network source. Single-homed here
// so every route on this surface derives it identically — two routes hashing
// differently would mean an attacker blocked on one could keep probing via the
// other under a different key.
//
// Hashed, never stored raw: PublicRateLimit is rate-limit bookkeeping, not a
// visitor log, and a bucket id that IS an IP address would quietly make it one.
// Truncated because this only has to SEPARATE sources, not identify them.
const SOURCE_HASH_LEN = 16;
const UNKNOWN_SOURCE = "unknown";

export function hashSource(forwardedFor: string | null): string {
  // The left-most entry of X-Forwarded-For is the client as the edge saw it.
  const first = (forwardedFor ?? "").split(",")[0]?.trim() ?? "";
  if (first.length === 0) return UNKNOWN_SOURCE;
  return createHash("sha256").update(first).digest("hex").slice(0, SOURCE_HASH_LEN);
}
