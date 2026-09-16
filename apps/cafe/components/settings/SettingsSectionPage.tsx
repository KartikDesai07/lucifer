"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useSettings } from "@/hooks/use-settings";
import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { settingsSectionBySlug, type SettingsSection, type SettingsSectionSlug } from "@/lib/settings-sections";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import type { Settings } from "@/types";

const SKELETON_CARD_COUNT = 3;

interface SettingsSectionPageProps {
  slug: SettingsSectionSlug;
  wide?: boolean;
  children: (settings: Settings, section: SettingsSection) => ReactNode;
}

// Shared page shell for every settings section route: looks the section up in
// SETTINGS_SECTIONS, loads the one Settings doc, and renders the header +
// loading/error/data states identically across all 7 pages.
export function SettingsSectionPage({ slug, wide, children }: SettingsSectionPageProps) {
  const section = settingsSectionBySlug(slug);
  const { data, isLoading, isError, refetch } = useSettings();

  return (
    <div className={cn("mx-auto w-full space-y-6 pb-10", wide ? "max-w-5xl" : "max-w-3xl")}>
      <SettingsPageHeader title={section.title} description={section.description} />

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : isError || !data ? (
        <ErrorState title="Couldn't load settings" onRetry={refetch} />
      ) : (
        children(data, section)
      )}
    </div>
  );
}
