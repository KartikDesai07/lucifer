"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import TaskRow, { type PumpState, type StepUpState, type TaskRowData } from "./TaskRow";

// F3.8 panel queue (D8): lists the federation Task collection, drives the
// bounded-pump `POST /api/tasks/[id]/run` loop for ADD_DB_CLUSTER tasks, and
// exposes step-up-gated Dismiss. The full console (search/filter/history)
// lands in F3.12 — this is the minimal "does the queue work" surface. Row
// markup lives in ./TaskRow.tsx (300-line file-length rule).

interface TasksData {
  open: TaskRowData[];
  recent: TaskRowData[];
}

interface TasksResponse {
  success: boolean;
  data?: TasksData;
  error?: string;
}

interface RunResponse {
  success: boolean;
  data?: { status: string; step?: string; note?: string; repumpAfterS?: number };
  error?: string;
}

interface DismissResponse {
  success: boolean;
  data?: { status: string };
  error?: string;
}

interface StepUpResponse {
  success: boolean;
  data?: { stepUp: boolean };
  error?: string;
}

// Terminal pump statuses — stop the auto-re-pump loop and refresh the list.
const TERMINAL_STATUSES = new Set(["done", "already-rolled", "closed-by-other", "refused", "lost-lease"]);

// R7 (post-review fix wave): the step-up strip may ONLY appear for this exact
// deny message — any other 403 (IP-allowlist/deactivated) renders plainly.
const STEP_UP_ERROR = "step-up re-authentication required";

// R6(c): shown before Run on an OPEN task — the owner must know a hot-add can
// PROMOTE a live warm standby, not just mint a fresh M0.
const RUN_CONFIRM_TEXT =
  "Starting this hot-add will PROMOTE a warm standby from the tenant's runtime doc if one exists, " +
  "otherwise mint a new M0 cluster. Continue?";

async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default function TasksPanel() {
  const [data, setData] = useState<TasksData | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [runLoopIds, setRunLoopIds] = useState<Set<string>>(new Set());
  const [dismissBusyIds, setDismissBusyIds] = useState<Set<string>>(new Set());
  const [pumpState, setPumpState] = useState<Record<string, PumpState>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [stepUp, setStepUp] = useState<StepUpState | null>(null);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((taskId: string) => {
    const t = timers.current.get(taskId);
    if (t) {
      clearTimeout(t);
      timers.current.delete(taskId);
    }
  }, []);

  // Clear every outstanding auto-re-pump timer on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/tasks");
      const json = await parseJson<TasksResponse>(res);
      if (!json?.success || !json.data) {
        setListError(json?.error ?? "failed to load tasks");
        return;
      }
      setData(json.data);
    } catch {
      setListError("failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const setRunLoop = (taskId: string, active: boolean) =>
    setRunLoopIds((prev) => {
      const next = new Set(prev);
      if (active) next.add(taskId);
      else next.delete(taskId);
      return next;
    });

  const setDismissBusy = (taskId: string, busy: boolean) =>
    setDismissBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(taskId);
      else next.delete(taskId);
      return next;
    });

  // One pump call; re-arms its own timer while non-terminal (never more than
  // one timer per task — clearTimer always runs first).
  const runTask = useCallback(
    async (taskId: string) => {
      clearTimer(taskId);
      setRunLoop(taskId, true);
      setRowErrors((prev) => ({ ...prev, [taskId]: "" }));
      try {
        const res = await fetch(`/api/tasks/${taskId}/run`, { method: "POST" });
        if (res.status === 403) {
          const body = await parseJson<RunResponse>(res);
          setRunLoop(taskId, false);
          if (body?.error === STEP_UP_ERROR) {
            setStepUp({ taskId, action: "run", code: "", verifying: false });
          } else {
            setRowErrors((prev) => ({ ...prev, [taskId]: body?.error ?? "forbidden" }));
          }
          return;
        }
        const json = await parseJson<RunResponse>(res);
        if (!json?.success || !json.data) {
          setRunLoop(taskId, false);
          setRowErrors((prev) => ({ ...prev, [taskId]: json?.error ?? "run failed" }));
          return;
        }
        const { status, note, repumpAfterS } = json.data;
        setPumpState((prev) => ({ ...prev, [taskId]: { status, note } }));
        if (TERMINAL_STATUSES.has(status)) {
          setRunLoop(taskId, false);
          fetchTasks();
          return;
        }
        timers.current.set(
          taskId,
          setTimeout(() => runTask(taskId), (repumpAfterS ?? 30) * 1000),
        );
      } catch {
        setRunLoop(taskId, false);
        setRowErrors((prev) => ({ ...prev, [taskId]: "run failed" }));
      }
    },
    [clearTimer, fetchTasks],
  );

  // The actual dismiss call, retriable after a step-up verify (no re-confirm).
  const doDismiss = useCallback(
    async (taskId: string) => {
      setDismissBusy(taskId, true);
      setRowErrors((prev) => ({ ...prev, [taskId]: "" }));
      try {
        const res = await fetch(`/api/tasks/${taskId}/dismiss`, { method: "POST" });
        if (res.status === 403) {
          const body = await parseJson<DismissResponse>(res);
          setDismissBusy(taskId, false);
          if (body?.error === STEP_UP_ERROR) {
            setStepUp({ taskId, action: "dismiss", code: "", verifying: false });
          } else {
            setRowErrors((prev) => ({ ...prev, [taskId]: body?.error ?? "forbidden" }));
          }
          return;
        }
        const json = await parseJson<DismissResponse>(res);
        if (!json?.success) {
          setDismissBusy(taskId, false);
          setRowErrors((prev) => ({ ...prev, [taskId]: json?.error ?? "dismiss failed" }));
          return;
        }
        clearTimer(taskId);
        setRunLoop(taskId, false);
        setDismissBusy(taskId, false);
        fetchTasks();
      } catch {
        setDismissBusy(taskId, false);
        setRowErrors((prev) => ({ ...prev, [taskId]: "dismiss failed" }));
      }
    },
    [clearTimer, fetchTasks],
  );

  const onDismissClick = useCallback(
    (taskId: string) => {
      if (!window.confirm("Dismiss this task?")) return;
      doDismiss(taskId);
    },
    [doDismiss],
  );

  const onRunClick = useCallback(
    (taskId: string) => {
      if (!window.confirm(RUN_CONFIRM_TEXT)) return;
      runTask(taskId);
    },
    [runTask],
  );

  const verifyStepUp = useCallback(async () => {
    if (!stepUp) return;
    setStepUp((prev) => (prev ? { ...prev, verifying: true, error: undefined } : prev));
    try {
      const res = await fetch("/api/step-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: stepUp.code }),
      });
      const json = await parseJson<StepUpResponse>(res);
      if (!json?.success) {
        setStepUp((prev) => (prev ? { ...prev, verifying: false, error: json?.error ?? "invalid code" } : prev));
        return;
      }
      const { taskId, action } = stepUp;
      setStepUp(null);
      if (action === "run") await runTask(taskId);
      else await doDismiss(taskId);
    } catch {
      setStepUp((prev) => (prev ? { ...prev, verifying: false, error: "verify failed" } : prev));
    }
  }, [stepUp, runTask, doDismiss]);

  const onStepUpCodeChange = (code: string) => setStepUp((prev) => (prev ? { ...prev, code } : prev));

  return (
    <section className="hub-tasks">
      <h2>Federation task queue</h2>
      <div className="hub-tasks-toolbar">
        <button onClick={fetchTasks} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        {listError ? <span className="hub-tasks-muted">{listError}</span> : null}
      </div>

      <h3>Open</h3>
      {(data?.open.length ?? 0) === 0 ? (
        <p className="hub-tasks-muted">No open tasks.</p>
      ) : (
        <ul className="hub-tasks-list">
          {data!.open.map((task) => (
            <TaskRow
              key={task._id}
              task={task}
              interactive
              runBusy={runLoopIds.has(task._id)}
              dismissBusy={dismissBusyIds.has(task._id)}
              pump={pumpState[task._id]}
              rowError={rowErrors[task._id]}
              stepUp={stepUp?.taskId === task._id ? stepUp : null}
              onRun={task.status === "open" ? onRunClick : runTask}
              onDismiss={onDismissClick}
              onStepUpCodeChange={onStepUpCodeChange}
              onStepUpVerify={verifyStepUp}
            />
          ))}
        </ul>
      )}

      <h3>Recent</h3>
      {(data?.recent.length ?? 0) === 0 ? (
        <p className="hub-tasks-muted">No recent tasks.</p>
      ) : (
        <ul className="hub-tasks-list">
          {data!.recent.map((task) => (
            <TaskRow key={task._id} task={task} interactive={false} />
          ))}
        </ul>
      )}
    </section>
  );
}
