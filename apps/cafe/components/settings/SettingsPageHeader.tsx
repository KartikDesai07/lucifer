import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { SETTINGS_BASE_PATH } from "@/lib/settings-sections";
import { PageHeader } from "@/components/shared/PageHeader";

interface SettingsPageHeaderProps {
  title: string;
  description: string;
}

// Shared header for every settings section page: the
// page-header idiom of every other screen, with the eyebrow — the sidebar
// group the page sits in — doubling as the way back to the Settings hub (a
// phone has no sidebar on screen). py-3 + -my-3 make the link a 40px-tall
// target without moving the title.
export function SettingsPageHeader({ title, description }: SettingsPageHeaderProps) {
  return (
    <PageHeader
      eyebrow={
        <Link
          href={SETTINGS_BASE_PATH}
          className="-mx-1 -my-3 inline-flex items-center gap-0.5 rounded-md px-1 py-3 hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Settings
        </Link>
      }
      title={title}
      description={description}
    />
  );
}
