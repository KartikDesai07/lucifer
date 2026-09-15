import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { SETTINGS_BASE_PATH } from "@/lib/settings-sections";

interface SettingsPageHeaderProps {
  title: string;
  description: string;
}

// Shared header for every settings section page: a back link to the hub, the
// page title, and its one-line description — CB-UI1 design contract.
export function SettingsPageHeader({ title, description }: SettingsPageHeaderProps) {
  return (
    <div className="space-y-1">
      <Link
        href={SETTINGS_BASE_PATH}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Settings
      </Link>
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
