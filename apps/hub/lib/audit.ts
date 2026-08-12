import type { Types } from "mongoose";

import { AuditLog } from "@/models/AuditLog";
import { connectDB } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────────────────────
// Audit helper (F3.4 / §E-5: "audit-log every action append-only"). The Hub's
// AuditLog is append-only (the model has no updatedAt and nothing ever mutates a
// row) and TTL-FREE (retained forever — the ONLY registry TTL is the F3.7
// Heartbeat collection). The vault (lib/vault.ts) writes its own fail-closed
// `secret.reveal` row BEFORE returning plaintext; this helper covers the auth
// and gate actions around it.
//
// actorId is REQUIRED by the schema — so a row can only be written for a KNOWN
// principal. Unknown-email login attempts write NOTHING (there is no actorId to
// attribute, and an attacker who could mint rows for arbitrary emails would fill
// the 512MB M0). That is a deliberate, spec-consistent bound: the gate only ever
// audits actions by a principal it has already identified.
// ─────────────────────────────────────────────────────────────────────────────

/** The closed set of Hub audit actions (string-typed on the model, but centralized
 * here so every writer uses a known verb.noun and the set is greppable). */
export type AuditAction =
  | "auth.login"
  | "auth.login.fail"
  | "auth.stepup"
  | "auth.stepup.fail"
  | "panel.denied.ip"
  | "panel.denied.stepup"
  | "panel.denied.inactive"
  | "totp.enrol"
  | "secret.reveal" // written by the vault, listed here for completeness
  | "kek.rotate"
  | "cred.rotate"
  | "tenant.provision" // F3.6 — one row per provisionTenant invocation
  | "tenant.hotAddDbCluster" // F3.8 — one row per hot-add CLAIM (A1/A10)
  | "task.dismiss"; // F3.8 — one row per task dismissal (A9)

export interface AuditRow {
  actorId: Types.ObjectId | string;
  action: AuditAction;
  ip: string;
  targetTenantId?: Types.ObjectId | string;
  secretId?: Types.ObjectId | string;
}

/**
 * Append one audit row. Best-effort: never throws (a failed audit write must not
 * take down the surrounding action — the row is a record, not a gate; the
 * vault's OWN reveal audit is the one that is fail-closed BEFORE plaintext).
 * Returns whether the row was written, so callers/tests can assert it.
 */
export async function writeAudit(row: AuditRow): Promise<boolean> {
  try {
    await connectDB();
    await AuditLog.create({
      actorId: row.actorId,
      action: row.action,
      ip: row.ip,
      ...(row.targetTenantId ? { targetTenantId: row.targetTenantId } : {}),
      ...(row.secretId ? { secretId: row.secretId } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Coalesced audit write for HIGH-FREQUENCY failure/denial actions on the
 * TTL-free log: at most `max` rows per (action, actorId) per window. A repeated
 * failure — a benign auto-refetching panel stuck off-allowlist, or an attacker
 * rotating IPs who knows the owner email — thus can't fill the 512MB M0. The
 * action still HAPPENS and its response is returned every time; only the log row
 * is rate-bounded (per-isolate, best-effort — like the auth limiter). Success /
 * reveal / rotate rows are NEVER coalesced — use writeAudit for those.
 */
export async function writeAuditCoalesced(
  row: AuditRow,
  opts: { max?: number; windowMs?: number } = {},
): Promise<boolean> {
  const gate = rateLimit(`audit:${row.action}:${String(row.actorId)}`, {
    max: opts.max ?? 3,
    windowMs: opts.windowMs ?? 60_000,
  });
  if (!gate.allowed) return false;
  return writeAudit(row);
}
