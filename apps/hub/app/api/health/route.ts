import { NextResponse } from "next/server";

import { connectDB } from "@/lib/db";

// Hub self-health: proves the registry connection is up. Deliberately leaks NO
// detail on failure (the panel is the crown jewel — no driver messages on the
// wire). The tenant-facing failover/heartbeat ingest routes are F3.7.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDB();
    return NextResponse.json({ ok: true, db: "up" });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
