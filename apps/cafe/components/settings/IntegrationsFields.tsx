"use client";

import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleRow } from "@/components/settings/SettingsFields";
import { TelegramSetupCard } from "@/components/settings/TelegramSetupCard";

interface IntegrationsFieldsProps {
  control: Control<SettingsInput>;
}

// CR2.3b §21.9 — the Integrations tab body. `telegramPaused` is the ONE field
// here that rides the settings form PUT like every other field (settingsSchema
// carries it, S1) — a Controller-driven Switch, same idiom as SelfOrderCard's
// toggles. Everything else on this tab (connect/repair/disconnect, chat
// registry, invites) is imperative TanStack state via hooks/use-telegram.ts,
// entirely separate from this RHF form — TelegramSetupCard takes no form
// props at all.
export function IntegrationsFields({ control }: IntegrationsFieldsProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Telegram alerts</CardTitle>
          <CardDescription>
            Ping staff in Telegram when a diner places a QR order. This is a
            second, optional layer — the in-panel tray and bell alerts stay on
            regardless of this switch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Controller
            control={control}
            name="telegramPaused"
            render={({ field }) => (
              <ToggleRow
                label="Pause Telegram alerts"
                description="Connections stay; no messages are sent while paused."
                checked={field.value ?? false}
                onChange={field.onChange}
              />
            )}
          />
        </CardContent>
      </Card>

      <TelegramSetupCard />
    </>
  );
}
