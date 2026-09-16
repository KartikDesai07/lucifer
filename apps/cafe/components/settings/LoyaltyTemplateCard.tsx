"use client";

import { useFieldArray } from "react-hook-form";
import type { Control, UseFormSetValue } from "react-hook-form";
import { Sparkles } from "lucide-react";

import type { SettingsInput } from "@/schemas";
import { LOYALTY_PRESETS } from "@/lib/loyalty-presets";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface LoyaltyTemplateCardProps {
  control: Control<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
}

// CB-5A FIX ROUND — a template must land through EACH registered piece of
// state that owns it, never through one grandparent `setValue("loyaltyRules"`
// write. Confirmed against react-hook-form 7.71.2's own source: `_setValue`
// only notifies `_subjects.array` (what refreshes a useFieldArray's `fields`)
// when the touched name IS a registered array name — `loyaltyRules.milestones`,
// not its grandparent `loyaltyRules`. So this card runs its OWN
// useFieldArray for that name (RHF keys a field array by control+name, not
// by call site — LoyaltyStampGrid's own hook and this one are independent
// subscribers to the same array) and drives it through replace(), which DOES
// notify _subjects.array. The scalar leftover (unitLabel) goes through
// setValue as before — nothing else reads it through a useFieldArray, so
// setValue's _subjects.state notification is sufficient.
//
// CB-5D — membership and levels are REMOVED (owner, 2026-09-15): no client
// uses either, so this card no longer wires them.
//
// Every preset in loyalty-presets.ts is a COMPLETE LoyaltyRulesInput (all
// loyaltyRulesSchema keys) — writing milestones, unitLabel and v here
// together is what keeps that completeness true after a template is
// applied, which is the only fence against Mongoose's whole-nested-path
// $set clobber on save.
export function LoyaltyTemplateCard({ control, setValue }: LoyaltyTemplateCardProps) {
  const { replace: replaceMilestones } = useFieldArray({ control, name: "loyaltyRules.milestones" });

  function applyPreset(rules: (typeof LOYALTY_PRESETS)[number]["rules"]): void {
    replaceMilestones(rules.milestones);
    setValue("loyaltyRules.unitLabel", rules.unitLabel, { shouldDirty: true, shouldValidate: true });
    setValue("loyaltyRules.v", rules.v, { shouldDirty: true, shouldValidate: true });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Start from a template
        </CardTitle>
        <CardDescription>
          Pick one to fill in the reward ladder below. Applying a template replaces whatever is set up now — you can
          still fine-tune every row after.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {LOYALTY_PRESETS.map((preset) => (
          <div key={preset.id} className="flex flex-col justify-between gap-3 rounded-lg border p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">{preset.label}</p>
              <p className="text-xs text-muted-foreground">{preset.description}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => applyPreset(preset.rules)}>
              Use this template
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
