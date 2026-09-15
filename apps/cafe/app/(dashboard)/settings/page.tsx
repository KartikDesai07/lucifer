import Link from "next/link";
import { ChevronRight, Printer } from "lucide-react";

import { SETTINGS_SECTIONS, settingsSectionPath } from "@/lib/settings-sections";
import { SETTINGS_SECTION_ICONS } from "@/components/settings/settings-section-icons";
import { PageHeader } from "@/components/shared/PageHeader";

// CB-UI1 S2 — the settings hub: one card per SETTINGS_SECTIONS entry (the 7
// form sections) plus a literal Printer-setup card (pinned by
// printer-setup-paths.test.ts's `href="/settings/printing"` needle).
// AdminGuard now lives in settings/layout.tsx, wrapping every settings route.
const FORM_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.slug !== "printing");

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-10">
      <PageHeader
        title="Settings"
        description="Everything about how this POS works, prints and looks."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {FORM_SECTIONS.map((section) => {
          const Icon = SETTINGS_SECTION_ICONS[section.slug];
          return (
            <Link
              key={section.slug}
              href={settingsSectionPath(section.slug)}
              className="flex items-start justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-muted"
            >
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-medium">{section.title}</p>
                  <p className="text-sm text-muted-foreground">{section.description}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          );
        })}

        <Link
          href="/settings/printing"
          className="flex items-start justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-muted"
        >
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted">
              <Printer className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium">Printer setup</p>
              <p className="text-sm text-muted-foreground">
                Make this PC the print host and install the POS Printer shortcut.
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
