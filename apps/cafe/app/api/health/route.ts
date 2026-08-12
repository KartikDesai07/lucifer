import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/db";
import { buildHeartbeat, statsTokenMatches } from "@/lib/heartbeat";

// Never statically cache — reflects live DB connectivity. This is the failover
// contract the Cloudflare Worker polls (PLATFORM.md §4 / F1.5): HTTP 200
// { ok:true, db:"up", tenant, ts } ONLY when the cluster is reachable for queries,
// else 503 { ok:false, db:"down", tenant, ts }. It NEVER throws — the poller needs a
// fast, deterministic status, not a 500 stack. Driver internals are never leaked.
//
// F2.9 folds the runtime heartbeat in (the F3 §3.3 fold-in): `?stats=1` adds a
// `clusters` block — every owned cluster gauged via `db.stats()` (lib/heartbeat).
// That per-cluster DB touch is what lets F3's Worker poll double as the keep-alive
// (superseding .github/workflows/db-keepalive.yml). The PLAIN call is unchanged
// and stays cheap — the Worker's liveness probe must never pay N cluster dials.
// Gate: when HEALTH_STATS_TOKEN is set (F3 hands it to the Worker), stats require
// a matching `x-stats-token` header; a mismatch yields the plain contract plus
// stats:"denied" — the HEALTH verdict itself is never affected. Failed probes
// surface as state:"error" only; raw driver strings stay server-side (F2.7 caveat).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ts = Date.now();
  const tenant = process.env.TENANT_ID ?? "dev";
  try {
    // Real round-trip via the ClusterRouter seam — proves the connection is usable
    // for QUERIES on this request, not just that a cached handle exists.
    const conn = await getConnection("core");
    const db = conn.db;
    if (!db) throw new Error("no database handle after connect");
    await db.admin().command({ ping: 1 });
  } catch {
    return NextResponse.json(
      { ok: false, db: "down", tenant, ts },
      { status: 503 },
    );
  }

  const base = { ok: true, db: "up", tenant, ts };
  if (req.nextUrl.searchParams.get("stats") !== "1") {
    return NextResponse.json(base, { status: 200 });
  }
  if (!statsTokenMatches(req.headers.get("x-stats-token"), process.env.HEALTH_STATS_TOKEN)) {
    return NextResponse.json({ ...base, stats: "denied" }, { status: 200 });
  }
  try {
    const hb = await buildHeartbeat();
    return NextResponse.json(
      {
        ...base,
        ...(hb.bootstrap ? { bootstrap: true } : {}),
        clusters: hb.clusters,
        // F3.7 — the §3.3 imageUsage leg (Cloudinary tenants only; see lib/heartbeat).
        ...(hb.imageUsage ? { imageUsage: hb.imageUsage } : {}),
      },
      { status: 200 },
    );
  } catch (err) {
    // Health stays truthful (CORE answered above); only the stats leg degrades —
    // e.g. a registry READ ERROR (#19: never serve a bootstrap-shaped guess).
    console.error("[health] stats leg failed:", err);
    return NextResponse.json({ ...base, stats: "error" }, { status: 200 });
  }
}
