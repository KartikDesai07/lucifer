"use client";

import { useOfflineReplay } from "@/hooks/use-offline-replay";

// Printing Phase 5 (spec 5.8; plan Task 13): the outbox's replay runner, mounted once per tab in the dashboard shell
// (inside the pulse and print host providers), so offline orders go out from any staff screen. Renders nothing.
export function OfflineReplayRunner() {
  useOfflineReplay();
  return null;
}
