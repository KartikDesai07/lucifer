import { NextResponse } from "next/server";

import { INGEST_SIG_HEADER, INGEST_TS_HEADER } from "@pos/shared/heartbeat";
import { verifyIngest } from "@/lib/heartbeat-hmac";
import { clientIp } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import {
  INGEST_IP_RATE_LIMIT_MAX,
  INGEST_IP_RATE_LIMIT_WINDOW_MS,
} from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// F3.7 — the machine-ingest gate. The heartbeat route is the Hub's ONE
// unauthenticated-by-design POST surface (the Worker is not a HubUser, so the
// F3.4 panel gate cannot apply); this wrapper is its structural equivalent:
// per-IP rate limit → fail-closed HMAC verify → hand the VERIFIED raw body to
// the handler. Routes export `POST = withIngestGate(fn)` and the
// routes.gate.test.ts scan asserts the INGEST_GATED marker on the public
// ingest route — so "public" still carries a machine-verified wall, proven
// structurally, exactly like PANEL_GATED proves the owner routes.
//
// Deny responses are TERSE (the panel-gate denyMessage precedent): every
// verify failure is one 401 "unauthorized" — an attacker learns nothing about
// which check failed. The ONE exception: a missing HUB_INGEST_SECRET is the
// HUB's own misconfiguration → 503, so the operator can tell it apart.
//
// No-console gate: the shared ingest secret flows through the verify call.
// ─────────────────────────────────────────────────────────────────────────────

/** Marker the source-scan test asserts on the ingest route export (the
 * PANEL_GATED pattern — structural proof, not a name-scan). */
export const INGEST_GATED = Symbol.for("hub.ingestGated");

/** A gated ingest handler: receives the ORIGINAL request and the HMAC-verified
 * raw body text (parse INSIDE the handler — the signature covered these exact
 * bytes, so nothing may re-read or transform the stream before verification). */
export type IngestHandler = (req: Request, rawBody: string) => Promise<Response> | Response;

export interface GatedIngestRoute {
  (req: Request): Promise<Response>;
  [INGEST_GATED]: true;
}

export function withIngestGate(handler: IngestHandler): GatedIngestRoute {
  const wrapped = async (req: Request): Promise<Response> => {
    // Per-IP limiter FIRST (cheapest wall; per-isolate best-effort like the
    // auth limiter — the real wall is the HMAC).
    const ip = clientIp(req.headers);
    const gate = rateLimit(`ingest:ip:${ip}`, {
      max: INGEST_IP_RATE_LIMIT_MAX,
      windowMs: INGEST_IP_RATE_LIMIT_WINDOW_MS,
    });
    if (!gate.allowed) {
      return NextResponse.json({ success: false, error: "too many requests" }, { status: 429 });
    }

    const rawBody = await req.text();
    const verdict = verifyIngest(
      process.env.HUB_INGEST_SECRET,
      req.headers.get(INGEST_TS_HEADER),
      req.headers.get(INGEST_SIG_HEADER),
      rawBody,
      Date.now(),
    );
    if (!verdict.ok) {
      if (verdict.reason === "no-secret") {
        return NextResponse.json(
          { success: false, error: "ingest not configured" },
          { status: 503 },
        );
      }
      return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
    }

    return handler(req, rawBody);
  };
  return Object.assign(wrapped, { [INGEST_GATED]: true as const });
}
