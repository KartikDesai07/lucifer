"use client";

import { useSettings } from "@/hooks/use-settings";
import { AdminGuard } from "@/components/shared/AdminGuard";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsPage() {
  return (
    <AdminGuard>
      <SettingsContent />
    </AdminGuard>
  );
}

function SettingsContent() {
  const { data, isLoading, isError } = useSettings();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-10">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Restaurant details, receipt text, GST, and print customization —
          used on printed bills and kitchen tickets.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">
          Failed to load settings. Refresh to retry.
        </p>
      ) : (
        <SettingsForm settings={data} />
      )}
    </div>
  );
}
