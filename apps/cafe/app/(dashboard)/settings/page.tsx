import Link from "next/link";
import { ChevronRight, Printer } from "lucide-react";

import { SETTINGS_SECTIONS, settingsSectionPath } from "@/lib/settings-sections";
import { SETTINGS_SECTION_ICONS } from "@/components/settings/settings-section-icons";
import { PageHeader } from "@/components/shared/PageHeader";
import { BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";
import { cn } from "@/lib/utils";

// CB-UI1 S2 — the settings hub: one card per SETTINGS_SECTIONS entry (the 7
// form sections) plus a literal Printer-setup card (pinned by
// printer-setup-paths.test.ts's `href="/settings/printing"` needle).
// AdminGuard now lives in settings/layout.tsx, wrapping every settings route.
// Eyebrow = the sidebar group Settings sits in (Admin), as on every screen.
const CARD_CLASS = cn(
  "flex items-start justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
  BRAND_PANEL_CLASS,
);
const ICON_TILE_CLASS = "grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-primary-soft text-brand-primary";
const FORM_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.slug !== "printing");

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-10">
      <PageHeader
        eyebrow="Admin"
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
              className={CARD_CLASS}
            >
              <div className="flex items-start gap-3">
                <div className={ICON_TILE_CLASS}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-medium text-brand-ink">{section.title}</p>
                  <p className="text-sm text-muted-foreground">{section.description}</p>
                </div>
              </div>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-brand-muted" aria-hidden="true" />
            </Link>
          );
        })}

        <Link
          href="/settings/printing"
          className={CARD_CLASS}
        >
          <div className="flex items-start gap-3">
            <div className={ICON_TILE_CLASS}>
              <Printer className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-brand-ink">Printer setup</p>
              <p className="text-sm text-muted-foreground">
                Make this PC the print host and install the POS Printer shortcut.
              </p>
            </div>
          </div>
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-brand-muted" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
