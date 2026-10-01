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
//
// Loaded settings always win: a failed background refetch (e.g. the one after
// a save) keeps the form — and anything typed into it — on screen. A parked
// (offline) first load has no data AND no error, so it gets its own line
// instead of the error screen.
export function SettingsSectionPage({ slug, wide, children }: SettingsSectionPageProps) {
  const section = settingsSectionBySlug(slug);
  const { data, isLoading, isPaused, refetch } = useSettings();

  return (
    <div className={cn("mx-auto w-full space-y-6 pb-10", wide ? "max-w-5xl" : "max-w-3xl")}>
      <SettingsPageHeader title={section.title} description={section.description} />

      {data ? (
        children(data, section)
      ) : isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: SKELETON_CARD_COUNT }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : isPaused ? (
        <p role="status" className="text-sm text-muted-foreground">
          You appear to be offline. Settings will load when the connection is back.
        </p>
      ) : (
        <ErrorState
          title="Couldn't load settings"
          description="Check the internet connection, then try again."
          onRetry={() => void refetch()}
          retryLabel="Try again"
        />
      )}
    </div>
  );
}
