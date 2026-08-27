"use client";

import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";

import type { SettingsInput } from "@/schemas";
import { SELF_ORDER_MODES } from "@pos/shared/public";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleRow } from "@/components/settings/SettingsFields";

interface SelfOrderCardProps {
  control: Control<SettingsInput>;
}

function selfOrderModeLabel(mode: (typeof SELF_ORDER_MODES)[number]): string {
  return mode === "approve" ? "Staff approves each order (recommended)" : "Sends straight to the kitchen";
}

// QR self-ordering — CR2.2. Mirrors the GST card's Controller/Select idiom in
// GeneralSettingsFields.tsx. Every field here is Controller-driven (a select
// and two switches) with no free-text input, so — unlike BillPrintCard/
// KotPrintCard — this card needs neither `register` nor `errors`: these three
// fields can never fail settingsSchema validation from the form UI.
export function SelfOrderCard({ control }: SelfOrderCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>QR self-ordering</CardTitle>
        <CardDescription>
          How orders placed from the shared menu link reach the kitchen, and what a diner can do on that page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>When a diner places an order</Label>
          <Controller
            control={control}
            name="selfOrderMode"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SELF_ORDER_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {selfOrderModeLabel(mode)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <p className="text-xs text-muted-foreground">
            &quot;Staff approves&quot; holds the order as a pending request until a staff member accepts it. &quot;Auto&quot;
            sends it straight to the kitchen, the same as an order rung up at the counter.
          </p>
        </div>

        <Controller
          control={control}
          name="allowTableChange"
          render={({ field }) => (
            <ToggleRow
              label="Allow table changes"
              description="Diners may pick or change the table on the shared menu link."
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />

        <Controller
          control={control}
          name="showPastOrdersToDiner"
          render={({ field }) => (
            <ToggleRow
              label="Show past orders to diners"
              description="Diners can see their past orders on this device. (takes effect when the diner history page ships)"
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </CardContent>
    </Card>
  );
}
