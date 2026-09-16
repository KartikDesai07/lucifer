import { NextResponse } from "next/server";
import type { Types } from "mongoose";

import { withPanelGate } from "@/lib/panel-gate";
import { connectDB } from "@/lib/db";
import { Task, type ITaskPayload, type TaskStatus, type TaskType } from "@/models/Task";

// GET /api/tasks — the F3.8 panel queue read (D7/D8): the open/in-progress
// federation tasks (all of them — this owner-only queue is never large) plus
// the last 10 closed ones for context. No step-up (a list read, not a reveal/
// provision/rotate). `run.leaseToken`/`leaseUntil` are NEVER selected — they
// are lease-fencing internals, not panel-facing state.
export const dynamic = "force-dynamic";

const LIST_SELECT =
  "tenantSlug type status reason payload createdAt updatedAt " +
  "run.step run.lastError run.approvedAt run.target.mode run.target.tag run.target.clusterId run.target.standbyId";

interface TaskListRun {
  step?: string;
  lastError?: string;
  approvedAt?: Date;
  target?: {
    mode?: "mint" | "promote";
    tag?: string;
    clusterId?: string;
    standbyId?: string;
  };
}

interface TaskListRow {
  _id: Types.ObjectId;
  tenantSlug: string;
  type: TaskType;
  status: TaskStatus;
  reason: string;
  payload?: ITaskPayload;
  createdAt: Date;
  updatedAt: Date;
  run?: TaskListRun;
}

export const GET = withPanelGate(async () => {
  try {
    await connectDB();
    const [open, recent] = await Promise.all([
      Task.find({ status: { $in: ["open", "in-progress"] } })
        .select(LIST_SELECT)
        .sort({ createdAt: -1 })
        .lean<TaskListRow[]>(),
      Task.find({ status: { $in: ["done", "dismissed"] } })
        .select(LIST_SELECT)
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean<TaskListRow[]>(),
    ]);
    return NextResponse.json({ success: true, data: { open, recent } });
  } catch {
    return NextResponse.json({ success: false, error: "failed to load tasks" }, { status: 500 });
  }
});
