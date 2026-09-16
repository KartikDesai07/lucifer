import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";

import { requirePanelAccess, withPanelGate } from "@/lib/panel-gate";
import { connectDB } from "@/lib/db";
import { runHotAddDbCluster } from "@/lib/hotadd";
import { Task } from "@/models/Task";

// POST /api/tasks/[id]/run — the F3.8 bounded PUMP (D7, A1). The wrapper here
// carries NO step-up (continuation pumps need only session+owner+IP); a FRESH
// step-up verify is instead computed per-call via `requirePanelAccess` — but
// ONLY when the task is still 'open' (R3, post-review fix wave): evaluating
// stepUp on every ~30s continuation re-pump would deny (no fresh TOTP) and
// flood the audit log with panel.denied.stepup rows, poisoning the denial
// signal and burning the coalescing budget. The machine itself decides
// whether claimAllowed is needed (only an 'open' task's CLAIM consumes it;
// one TOTP authorizes one run, A1).
export const dynamic = "force-dynamic";

export const POST = withPanelGate(async (req, ctx, { params }) => {
  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ success: false, error: "invalid task id" }, { status: 400 });
  }

  try {
    await connectDB();
    const taskDoc = await Task.findById(id).select("status").lean<{ status: string } | null>();
    let claimAllowed = false;
    if (taskDoc?.status === "open") {
      const claim = await requirePanelAccess(req, { stepUp: true });
      claimAllowed = claim.ok;
    }
    // Task missing → claimAllowed stays false; the machine's own "task not
    // found" refusal path handles it.
    const result = await runHotAddDbCluster({
      taskId: id,
      actor: { actorId: ctx.actorId, ip: ctx.ip },
      claimAllowed,
    });

    if (result.status === "refused") {
      if (result.code === "needs-step-up") {
        return NextResponse.json({ success: false, error: "step-up re-authentication required" }, { status: 403 });
      }
      return NextResponse.json({ success: false, error: result.note ?? "refused" }, { status: 409 });
    }

    return NextResponse.json({ success: true, data: result });
  } catch {
    return NextResponse.json(
      { success: false, error: "hot-add pump failed — check the task's lastError in the queue" },
      { status: 500 },
    );
  }
});
