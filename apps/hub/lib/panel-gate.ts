import { NextResponse } from "next/server";
import type { Types } from "mongoose";

import { auth } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { HubUser } from "@/models/HubUser";
import { writeAuditCoalesced, type AuditAction } from "@/lib/audit";
import { clientIp } from "@/lib/ip";
import {
  evaluatePanelAccess,
  type PanelDenyReason,
  type PanelSession,
  type PanelUser,
} from "@/lib/panel-gate-core";

// ─────────────────────────────────────────────────────────────────────────────
// Panel access gate (F3.4 / fed-secrets-vault.json §E). EVERY super-admin API
// route runs this FIRST — routes export handlers wrapped in withPanelGate, and a
// source-scan test (routes.gate.test.ts) proves each non-public export is so
// wrapped. Middleware is only a first-pass page guard (edge-safe, no Mongo); the
// real authorization lives HERE, in the route handler / data-access layer, per
// the spec ("checked in the route handler, NOT only middleware"). So a bypassed
// or misconfigured middleware never exposes a route.
//
// The decision (evaluatePanelAccess, in panel-gate-core.ts) is PURE and
// exhaustively unit-tested. requirePanelAccess wires it to the live session + a
// FRESH HubUser read every request (no cache) — so a deactivation or an
// allowlist edit takes effect immediately, and a stale JWT can never outlive the
// DB state. One tiny indexed lookup on a low-traffic owner panel; correctness wins.
// ─────────────────────────────────────────────────────────────────────────────

export * from "@/lib/panel-gate-core";

/** The audit action a denial maps to (only inactive/ip/stepup are audited — an
 * unauthenticated/not-owner caller has no attributable actorId). */
const DENY_AUDIT: Partial<Record<PanelDenyReason, AuditAction>> = {
  inactive: "panel.denied.inactive",
  ip: "panel.denied.ip",
  stepup: "panel.denied.stepup",
};

/** Context handed to a route on a successful gate — exactly the vault's
 * VaultAuditContext plus the login-session id (for step-up checks downstream). */
export interface PanelContext {
  actorId: string;
  ip: string;
  sid: string;
}

export type RequirePanelResult =
  | { ok: true; ctx: PanelContext }
  | { ok: false; response: NextResponse };

/**
 * Live §E gate for a route handler. Resolves the session (Auth.js), reads the
 * HubUser FRESH, evaluates, and on a denial with a known actor writes ONE
 * append-only audit row. Returns either the context to proceed or a ready
 * NextResponse to return. `stepUp: true` for any getSecret/reveal/provision.
 */
export async function requirePanelAccess(
  req: Request,
  options: { stepUp?: boolean } = {},
): Promise<RequirePanelResult> {
  const ip = clientIp(req.headers);
  const session = await auth();

  const panelSession: PanelSession | null =
    session?.user?.id && session.user.role
      ? { userId: session.user.id, role: session.user.role, sid: session.user.sid ?? "" }
      : null;

  // Read the user fresh (no cache) so deactivation + allowlist edits are instant.
  let user: PanelUser | null = null;
  if (panelSession) {
    await connectDB();
    const doc = await HubUser.findById(panelSession.userId)
      .select("isActive ipAllowlist stepUp")
      .lean<{ isActive: boolean; ipAllowlist: string[]; stepUp?: { at: Date; sid: string } } | null>();
    if (doc) {
      user = { isActive: doc.isActive, ipAllowlist: doc.ipAllowlist ?? [], stepUp: doc.stepUp };
    }
  }

  const decision = evaluatePanelAccess({
    session: panelSession,
    user,
    ip,
    now: Date.now(),
    needStepUp: options.stepUp === true,
    allowAnyIp: process.env.HUB_ALLOW_ANY_IP === "1",
  });

  if (decision.ok) {
    return {
      ok: true,
      ctx: { actorId: panelSession!.userId, ip, sid: panelSession!.sid },
    };
  }

  // Audit denials we can attribute to a known, authenticated principal —
  // COALESCED (writeAuditCoalesced) so a valid-session caller stuck off-allowlist
  // (or an auto-refetching panel) can't fill the TTL-free log with one
  // panel.denied.* row per request. The deny RESPONSE is still returned every time.
  const action = DENY_AUDIT[decision.reason];
  if (action && panelSession) {
    await writeAuditCoalesced({ actorId: panelSession.userId, action, ip });
  }

  return {
    ok: false,
    response: NextResponse.json(
      { success: false, error: denyMessage(decision.reason) },
      { status: decision.status },
    ),
  };
}

/** Deliberately terse — the crown-jewel panel leaks no detail on why access was
 * refused (which IP, whether the account exists, etc.). */
function denyMessage(reason: PanelDenyReason): string {
  switch (reason) {
    case "unauthenticated":
      return "authentication required";
    case "stepup":
      return "step-up re-authentication required";
    default:
      return "forbidden";
  }
}

/** Narrow a Types.ObjectId|string to the vault's audit-context shape. */
export function toVaultAudit(ctx: PanelContext): { actorId: string | Types.ObjectId; ip: string } {
  return { actorId: ctx.actorId, ip: ctx.ip };
}

/** A gated route handler: receives the ORIGINAL request, the gate context, and
 * the Next.js route context (e.g. `{ params }`). */
export type GatedHandler = (
  req: Request,
  ctx: PanelContext,
  routeContext: { params: Promise<Record<string, string>> },
) => Promise<Response> | Response;

/** Marker the source-scan test asserts on every non-public route export — proof
 * the handler is STRUCTURALLY behind the gate, not merely that the file mentions
 * requirePanelAccess (which a name-scan could satisfy while leaving a route
 * open). See routes.gate.test.ts. */
export const PANEL_GATED = Symbol.for("hub.panelGated");

/** R9 (post-review fix wave): the resolved gate options attached structurally
 * to every wrapped route (additive) — lets a test assert a specific route's
 * step-up requirement without re-deriving it from source text. */
export const PANEL_GATE_OPTS = Symbol.for("hub.panelGateOpts");

export interface GatedRoute {
  (req: Request, routeContext: { params: Promise<Record<string, string>> }): Promise<Response>;
  [PANEL_GATED]: true;
  [PANEL_GATE_OPTS]: { stepUp: boolean };
}

/**
 * Wrap a route handler so it CANNOT run until the §E gate passes. The wrapper
 * owns the deny short-circuit (returns the gate's response on !ok) — a handler
 * author cannot forget the `if (!gate.ok) return …` check because there is no
 * un-gated path to the handler. Export handlers as
 * `export const POST = withPanelGate(fn, { stepUp: true })`.
 */
export function withPanelGate(
  handler: GatedHandler,
  options: { stepUp?: boolean } = {},
): GatedRoute {
  const wrapped = async (
    req: Request,
    routeContext: { params: Promise<Record<string, string>> },
  ): Promise<Response> => {
    const gate = await requirePanelAccess(req, options);
    if (!gate.ok) return gate.response;
    return handler(req, gate.ctx, routeContext);
  };
  return Object.assign(wrapped, {
    [PANEL_GATED]: true as const,
    [PANEL_GATE_OPTS]: { stepUp: options.stepUp === true },
  });
}
