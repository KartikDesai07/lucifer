import { NextResponse } from "next/server";
import { z } from "zod";

import { connectDB } from "@/lib/db";
import { withIngestGate } from "@/lib/ingest-gate";
import { ingestHeartbeat, realIngestPorts } from "@/lib/heartbeat-ingest";
import { rateLimit } from "@/lib/rate-limit";
import {
  INGEST_TENANT_RATE_LIMIT_MAX,
  INGEST_TENANT_RATE_LIMIT_WINDOW_MS,
} from "@/lib/constants";

// POST /api/ingest/heartbeat — the F3.7 self-report ingest (phase-F3 §3.3/§3.7).
// PUBLIC by design (listed in routes.gate.test.ts PUBLIC_ROUTE_DIRS): the caller
// is the always-on CF failover Worker, a machine — not a HubUser — so the F3.4
// panel gate cannot apply. Its structural equivalent is withIngestGate (per-IP
// rate limit + fail-closed HMAC over the raw body), and the routes.gate scan
// asserts the INGEST_GATED marker on this export, so "public" still means
// machine-VERIFIED — never open.
export const dynamic = "force-dynamic";

const pct = z.number().finite().min(0).max(100);

const clusterSchema = z.object({
  name: z.string().min(1).max(200),
  tag: z.string().max(20).optional(),
  role: z.enum(["core", "ledger", "standby"]),
  active: z.boolean().optional(),
  state: z.enum(["ok", "error"]),
  usedPct: pct.optional(),
  dataSize: z.number().finite().min(0).optional(),
  indexSize: z.number().finite().min(0).optional(),
  conns: z.number().finite().min(0).optional(),
  paused: z.boolean().optional(),
});

const bodySchema = z.object({
  // The Worker's KV key = the Tenant slug (the cafe router's subdomain charset).
  tenant: z.string().regex(/^[a-z0-9-]{1,100}$/),
  hostOk: z.boolean(),
  at: z.string().max(64),
  servedOrigin: z.enum(["active", "standby"]).optional(),
  stats: z.enum(["ok", "denied", "error"]).optional(),
  bootstrap: z.boolean().optional(),
  // Bounded: a real cafe owns a handful of clusters; 50 caps a hostile payload.
  clusters: z.array(clusterSchema).max(50).optional(),
  imageUsage: z
    .object({
      storagePct: pct.optional(),
      bandwidthPct: pct.optional(),
      creditsPct: pct.optional(),
    })
    .optional(),
});

export const POST = withIngestGate(async (_req, rawBody) => {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: "invalid body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "invalid heartbeat" }, { status: 400 });
  }

  try {
    await connectDB();

    // Per-TENANT limiter AFTER the HMAC (the gate) — bounds registry-M0 growth
    // under a valid-key retry storm to ~8× the Worker's 15-min cadence.
    const gate = rateLimit(`ingest:tenant:${parsed.data.tenant}`, {
      max: INGEST_TENANT_RATE_LIMIT_MAX,
      windowMs: INGEST_TENANT_RATE_LIMIT_WINDOW_MS,
    });
    if (!gate.allowed) {
      return NextResponse.json({ success: false, error: "too many requests" }, { status: 429 });
    }

    const result = await ingestHeartbeat(parsed.data, realIngestPorts());
    if (result.status === "unknown-tenant") {
      return NextResponse.json({ success: false, error: "unknown tenant" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: { triggers: result.triggers } });
  } catch {
    // House rule: no stack traces / driver internals on the wire.
    return NextResponse.json({ success: false, error: "ingest failed" }, { status: 500 });
  }
});
