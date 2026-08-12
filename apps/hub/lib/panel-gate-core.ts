import { ipAllowed } from "@/lib/ip";
import { STEP_UP_WINDOW_MS } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// panel-gate-core — the PURE §E gate decision (fed-secrets-vault.json §E). No
// DB, no Auth.js, no I/O: fully unit-testable (panel-gate.test.ts). The wired
// half (requirePanelAccess/withPanelGate, which resolve the live session + a
// fresh HubUser read + audit) lives in lib/panel-gate.ts, which re-exports this.
// ─────────────────────────────────────────────────────────────────────────────

/** The session facts the gate needs (from the Auth.js JWT). */
export interface PanelSession {
  userId: string;
  role: string;
  sid: string;
}

/** The user facts the gate needs (from a fresh HubUser read). */
export interface PanelUser {
  isActive: boolean;
  ipAllowlist: readonly string[];
  stepUp?: { at: Date; sid: string };
}

export type PanelDenyReason = "unauthenticated" | "not-owner" | "inactive" | "ip" | "stepup";

export type PanelDecision =
  | { ok: true }
  | { ok: false; reason: PanelDenyReason; status: number };

/**
 * PURE §E gate decision. Order: identity → role → active → IP → step-up. IP is
 * checked before step-up so a non-allowlisted request never reveals whether a
 * step-up would have been required.
 *
 * IP policy FAILS CLOSED: an empty ipAllowlist is a lockout unless `allowAnyIp`
 * (env HUB_ALLOW_ANY_IP=1, a local-dev / first-boot escape hatch) is set — so
 * the §E-3 allowlist is never a silent no-op in production. The seed/enrol path
 * sets the allowlist BEFORE first login, so there is no chicken-and-egg.
 */
export function evaluatePanelAccess(input: {
  session: PanelSession | null;
  user: PanelUser | null;
  ip: string;
  now: number;
  needStepUp: boolean;
  allowAnyIp: boolean;
}): PanelDecision {
  const { session, user, ip, now, needStepUp, allowAnyIp } = input;

  if (!session || !session.userId) return { ok: false, reason: "unauthenticated", status: 401 };
  if (session.role !== "owner") return { ok: false, reason: "not-owner", status: 403 };
  if (!user || !user.isActive) return { ok: false, reason: "inactive", status: 403 };

  if (!ipAllowed(ip, user.ipAllowlist, allowAnyIp)) {
    return { ok: false, reason: "ip", status: 403 };
  }

  if (needStepUp) {
    const su = user.stepUp;
    const fresh =
      !!su && su.sid === session.sid && now - new Date(su.at).getTime() <= STEP_UP_WINDOW_MS;
    if (!fresh) return { ok: false, reason: "stepup", status: 403 };
  }

  return { ok: true };
}
