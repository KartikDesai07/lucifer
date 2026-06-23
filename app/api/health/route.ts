import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";

// Never statically cache — this reflects live DB connectivity.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDB();
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
