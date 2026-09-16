import { NextResponse } from "next/server";
import { isValidObjectId, type Types } from "mongoose";

import { withPanelGate } from "@/lib/panel-gate";
import { connectDB } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { dismissHotAddTask } from "@/lib/hotadd";
import { Task } from "@/models/Task";

// POST /api/tasks/[id]/dismiss — step-up gated + lease-fenced (D7, A9): a task
// with a run in flight cannot be dismissed out from under it. The route (not
// the machine) writes the ONE `task.dismiss` audit row, per the F3.7/A10
// "machine paths write no audit rows" split.
export const dynamic = "force-dynamic";

export const POST = withPanelGate(
  async (req, ctx, { params }) => {
    const { id } = await params;
    if (!isValidObjectId(id)) {
      return NextResponse.json({ success: false, error: "invalid task id" }, { status: 400 });
    }

    try {
      await connectDB();
      const outcome = await dismissHotAddTask(id);

      if (outcome === "dismissed") {
        const task = await Task.findById(id).select("tenantId").lean<{ tenantId: Types.ObjectId } | null>();
        await writeAudit({
          actorId: ctx.actorId,
          action: "task.dismiss",
          ip: ctx.ip,
          ...(task?.tenantId ? { targetTenantId: task.tenantId } : {}),
        });
        return NextResponse.json({ success: true, data: { status: "dismissed" } });
      }

      if (outcome === "run-in-flight") {
        return NextResponse.json(
          { success: false, error: "a run is in flight — retry after it settles" },
          { status: 409 },
        );
      }

      return NextResponse.json({ success: false, error: "task is not open" }, { status: 409 });
    } catch {
      return NextResponse.json({ success: false, error: "dismiss failed" }, { status: 500 });
    }
  },
  { stepUp: true },
);
