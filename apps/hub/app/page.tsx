import { APP_NAME } from "@pos/shared/constants";

import TasksPanel from "./TasksPanel";

// Placeholder landing for the F3.1 skeleton, now carrying the F3.8 federation
// task queue (hot-add DB cluster, and later ADD_CLOUD/FAILOVER). The rest of
// the gated owner console — tenant list, New-Client wizard, health view,
// step-up secret reveal — is built across the remaining F3 steps (F3.4 panel
// auth is already live; F3.12 is the full console).
export default function HubHome() {
  return (
    <main className="hub-shell">
      <h1>{APP_NAME} — Control Plane</h1>
      <p>Owner-only Hub.</p>
      <p>
        The gated console (tenant registry, provisioning, health monitoring) is
        built across Phase F3. The federation task queue below is the F3.8 slice.
      </p>
      <TasksPanel />
    </main>
  );
}
