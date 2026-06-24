import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";

// Never statically cache — this reflects live DB connectivity.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDB();
    // Real round-trip to MongoDB — verifies the connection is usable for QUERIES
    // on this request, not just that connectDB() returned a cached handle. This
    // exercises the same cross-request connection-reuse path the data routes use.
    const db = mongoose.connection.db;
    if (!db) throw new Error("No database handle after connect");
    await db.admin().command({ ping: 1 });
    return NextResponse.json({
      success: true,
      data: { status: "ok", db: "connected" },
    });
  } catch (error) {
    // Don't leak driver/connection internals to unauthenticated callers in prod.
    const body: { success: false; error: string; details?: { db: string[] } } = {
      success: false,
      error: "Database connection failed",
    };
    if (process.env.NODE_ENV !== "production") {
      const message = error instanceof Error ? error.message : "Unknown error";
      body.details = { db: [message] };
    }
    return NextResponse.json(body, { status: 500 });
  }
}
