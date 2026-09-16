"use client";

// Presentational row for the F3.8 tasks panel. Split out of TasksPanel.tsx
// (which owns all state/fetch logic) to respect the 300-line file-length rule.

export type TaskType = "ADD_DB_CLUSTER" | "ADD_CLOUD" | "FAILOVER";
export type TaskStatus = "open" | "in-progress" | "done" | "dismissed";

export interface TaskRunTarget {
  mode?: "mint" | "promote";
  tag?: string;
  clusterId?: string;
  standbyId?: string;
}

export interface TaskRun {
  step?: string;
  lastError?: string;
  approvedAt?: string;
  target?: TaskRunTarget;
}

export interface TaskRowData {
  _id: string;
  tenantSlug: string;
  type: TaskType;
  status: TaskStatus;
  reason: string;
  createdAt: string;
  updatedAt: string;
  run?: TaskRun;
}

export interface PumpState {
  status: string;
  note?: string;
}

export type PendingAction = "run" | "dismiss";

export interface StepUpState {
  taskId: string;
  action: PendingAction;
  code: string;
  verifying: boolean;
  error?: string;
}

interface TaskRowProps {
  task: TaskRowData;
  interactive: boolean;
  runBusy?: boolean;
  dismissBusy?: boolean;
  pump?: PumpState;
  rowError?: string;
  stepUp?: StepUpState | null;
  onRun?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onStepUpCodeChange?: (code: string) => void;
  onStepUpVerify?: () => void;
}

/** One task row. `interactive` drives whether Run/Dismiss + the step-up strip
 * render at all — the "Recent" (done/dismissed) list is read-only. */
export default function TaskRow({
  task,
  interactive,
  runBusy,
  dismissBusy,
  pump,
  rowError,
  stepUp,
  onRun,
  onDismiss,
  onStepUpCodeChange,
  onStepUpVerify,
}: TaskRowProps) {
  return (
    <li className="hub-tasks-row">
      <div className="hub-tasks-row-top">
        <span className="hub-tasks-badge">{task.type}</span>
        <span className="hub-tasks-slug">{task.tenantSlug}</span>
        <span className="hub-tasks-status">{task.status}</span>
      </div>
      <p className="hub-tasks-reason">{task.reason}</p>
      <p className="hub-tasks-meta">
        step: {task.run?.step ?? "—"} · {task.createdAt}
      </p>
      {task.run?.target ? (
        <p className="hub-tasks-meta">
          target: <span className="hub-tasks-badge">{task.run.target.mode}</span> tag {task.run.target.tag} ·{" "}
          {task.run.target.mode === "promote" ? task.run.target.standbyId : task.run.target.clusterId}
        </p>
      ) : null}
      {task.run?.lastError ? <p className="hub-tasks-lasterror">lastError: {task.run.lastError}</p> : null}
      {pump ? (
        <p className="hub-tasks-meta">
          pump: {pump.status}
          {pump.note ? ` — ${pump.note}` : ""}
        </p>
      ) : null}
      {interactive ? (
        <div className="hub-tasks-actions">
          {task.type === "ADD_DB_CLUSTER" ? (
            <button onClick={() => onRun?.(task._id)} disabled={runBusy}>
              {runBusy ? "Running…" : "Run"}
            </button>
          ) : null}
          <button className="hub-tasks-danger" onClick={() => onDismiss?.(task._id)} disabled={dismissBusy}>
            {dismissBusy ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
      ) : null}
      {rowError ? <p className="hub-error">{rowError}</p> : null}
      {stepUp ? (
        <div className="hub-tasks-stepup">
          <input
            type="text"
            inputMode="numeric"
            placeholder="6-digit code"
            value={stepUp.code}
            onChange={(e) => onStepUpCodeChange?.(e.target.value)}
          />
          <button onClick={onStepUpVerify} disabled={stepUp.verifying}>
            {stepUp.verifying ? "Verifying…" : "Verify"}
          </button>
          {stepUp.error ? <span className="hub-error">{stepUp.error}</span> : null}
        </div>
      ) : null}
    </li>
  );
}
