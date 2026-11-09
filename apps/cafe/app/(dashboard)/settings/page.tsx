import { AppLink } from "@/components/layout/AppLink";
import { ChevronRight } from "lucide-react";

import { VISIBLE_SETTINGS_SECTIONS, settingsHubGroups, settingsSectionPath } from "@/lib/settings-sections";
import { SETTINGS_SECTION_ICONS } from "@/components/settings/settings-section-icons";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  SETTINGS_HUB_CHEVRON_CLASS,
  SETTINGS_HUB_GROUP_CLASS,
  SETTINGS_HUB_GROUP_TITLE_CLASS,
  SETTINGS_HUB_ICON_CLASS,
  SETTINGS_HUB_ITEM_CLASS,
  SETTINGS_HUB_LIST_CLASS,
  SETTINGS_HUB_ROW_CLASS,
  SETTINGS_HUB_ROW_SUB_CLASS,
  SETTINGS_HUB_ROW_TITLE_CLASS,
  SETTINGS_HUB_STACK_CLASS,
} from "@/lib/settings-card-layout";

// CB-UI1 S2 — the settings hub: a row for every visible section (a hidden one,
// HIDDEN_SETTINGS_SLUGS, has no row; Printer setup has its own sidebar row and
// /printers page, owner 2026-10-02).
// AdminGuard now lives in settings/layout.tsx, wrapping every settings route.
// Eyebrow = the sidebar group Settings sits in (Admin), as on every screen.
// New UI (docs/superpowers/plans/2026-11-09-settings-hub-ui.md): the sections in
// groups (settingsHubGroups), each group an h2 over one card of link rows.
export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-10">
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Everything about how this POS works, prints and looks."
      />

      <div className={SETTINGS_HUB_STACK_CLASS}>
        {settingsHubGroups(VISIBLE_SETTINGS_SECTIONS).map((group) => (
          <section
            key={group.key}
            aria-labelledby={`settings-group-${group.key}`}
            className={SETTINGS_HUB_GROUP_CLASS}
          >
            <h2 id={`settings-group-${group.key}`} className={SETTINGS_HUB_GROUP_TITLE_CLASS}>
              {group.title}
            </h2>
            <ul className={SETTINGS_HUB_LIST_CLASS}>
              {group.sections.map((section) => {
                const Icon = SETTINGS_SECTION_ICONS[section.slug];
                return (
                  <li key={section.slug} className={SETTINGS_HUB_ITEM_CLASS}>
                    <AppLink href={settingsSectionPath(section.slug)} className={SETTINGS_HUB_ROW_CLASS}>
                      <span className={SETTINGS_HUB_ICON_CLASS}>
                        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                      </span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className={SETTINGS_HUB_ROW_TITLE_CLASS}>{section.title}</span>
                        <span className={SETTINGS_HUB_ROW_SUB_CLASS}>{section.description}</span>
                      </span>
                      <ChevronRight className={SETTINGS_HUB_CHEVRON_CLASS} aria-hidden="true" />
                    </AppLink>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
