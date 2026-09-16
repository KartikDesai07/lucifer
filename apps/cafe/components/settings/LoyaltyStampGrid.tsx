"use client";

import { useState } from "react";
import { useFieldArray, useWatch } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { Gift, Plus, Ticket, Trash2 } from "lucide-react";

import type { SettingsInput } from "@/schemas";
import {
  LOYALTY_CARD_SIZE_MIN,
  LOYALTY_CARD_SIZE_MAX,
  LOYALTY_MILESTONES_MAX,
  LOYALTY_UNIT_LABEL_MAX_LEN,
} from "@pos/shared/loyalty-rules";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Field } from "@/components/settings/SettingsFields";
import { MilestoneRewardFields } from "@/components/settings/MilestoneRewardFields";

// CB-5C — the stamp card as the owner actually pictures it: a row of numbered
// boxes. Tapping a box opens a side panel to say what that box gives, so the
// ladder is edited ON the card instead of in a list of rows that never showed
// the card at all. A box with a reward is marked; the rest are plain stamps.
//
// The reward rows themselves are unchanged `loyaltyRules.milestones` entries —
// this component only changes HOW they are reached. Per-level cards (each level
// owning its own card and rewards) are the next step and would reshape that
// array; nothing here assumes the array stays flat beyond the field name.
//
// CB-5D — membership and levels were REMOVED (owner: no client used them);
// `LoyaltyAdvancedFields.tsx` existed only to hold those two sections plus
// the unit-label field, so deleting them left it with nothing of its own.
// `unitLabel` moved HERE rather than to a new file: it is still part of the
// SAME `loyaltyRules` container this component already edits directly
// (`cardSize` below), so it needs no separate panel.

interface LoyaltyStampGridProps {
  control: Control<SettingsInput>;
  register: UseFormRegister<SettingsInput>;
  errors: FieldErrors<SettingsInput>;
  setValue: UseFormSetValue<SettingsInput>;
}

// The array-root message (the duplicate-`at` refinement lands here, not on a
// row) — same two-place error lesson the list view already carries.
function arrayLevelMessage(milestonesErrors: unknown): string | undefined {
  if (!milestonesErrors || typeof milestonesErrors !== "object") return undefined;
  const message = (milestonesErrors as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}

export function LoyaltyStampGrid({ control, register, errors, setValue }: LoyaltyStampGridProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "loyaltyRules.milestones" });
  const milestones = useWatch({ control, name: "loyaltyRules.milestones" });
  const cardSize = useWatch({ control, name: "loyaltyRules.cardSize" });

  // Which box's panel is open. `null` = closed. Kept as the STAMP NUMBER, not a
  // row index: a box may have no row yet, and rows shift when one is removed.
  const [openAt, setOpenAt] = useState<number | null>(null);

  const rows = Array.isArray(milestones) ? milestones : [];
  const size = typeof cardSize === "number" && cardSize > 0 ? Math.floor(cardSize) : 0;
  // Never draw fewer boxes than the ladder already uses — a reward above the
  // card's size would otherwise be invisible AND unreachable.
  const highestAt = rows.reduce((max, row) => (typeof row?.at === "number" && row.at > max ? row.at : max), 0);
  const boxes = Math.max(size, highestAt);

  const rowIndexAt = (at: number) => rows.findIndex((row) => row?.at === at);
  const openIndex = openAt === null ? -1 : rowIndexAt(openAt);
  const atMax = fields.length >= LOYALTY_MILESTONES_MAX;

  // Opening a box that has no reward yet APPENDS one for that exact stamp
  // number, so the panel always edits a real row. Blocked at the cap, where the
  // panel would otherwise open onto nothing.
  const openBox = (at: number) => {
    if (rowIndexAt(at) === -1) {
      if (atMax) return;
      append({ at, kind: "flat", value: 50, item: "" });
    }
    setOpenAt(at);
  };

  const arrayError = arrayLevelMessage(errors.loyaltyRules?.milestones);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stamp card</CardTitle>
        <CardDescription>
          Set how many stamps fill the card, then tap any box to give a reward there. Diners earn one stamp per
          visit; the card starts again once it is full.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
          <Field
            label="Stamps to fill the card"
            error={
              typeof errors.loyaltyRules?.cardSize?.message === "string"
                ? errors.loyaltyRules.cardSize.message
                : undefined
            }
            hint="How many boxes the card shows"
          >
            <Input
              type="number"
              min={LOYALTY_CARD_SIZE_MIN}
              max={LOYALTY_CARD_SIZE_MAX}
              {...register("loyaltyRules.cardSize", { valueAsNumber: true })}
            />
          </Field>

          {/* CB-5D — moved from the deleted LoyaltyAdvancedFields.tsx; still
              the same `loyaltyRules.unitLabel` field, unchanged. */}
          <Field
            label="What to call the unit diners earn"
            error={
              typeof errors.loyaltyRules?.unitLabel?.message === "string"
                ? errors.loyaltyRules.unitLabel.message
                : undefined
            }
            hint='Shown to diners, e.g. "stamp" or "point".'
          >
            <Input maxLength={LOYALTY_UNIT_LABEL_MAX_LEN} {...register("loyaltyRules.unitLabel")} />
          </Field>
        </div>

        {arrayError && <p className="text-xs text-destructive">{arrayError}</p>}

        {boxes === 0 ? (
          <p className="text-xs text-muted-foreground">
            Set how many stamps fill the card to draw it.
          </p>
        ) : (
          <>
            {/* auto-fill, not a fixed column count: the card uses the full
                width the settings page gives it and reflows on a phone, rather
                than leaving the right-hand side empty. */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
              {Array.from({ length: boxes }, (_, i) => i + 1).map((at) => {
                const index = rowIndexAt(at);
                const hasReward = index !== -1;
                // CB-5D — a minted promo code, shown as a small corner mark
                // only: the grid must stay a clean row of numbers, so this
                // adds one extra icon at most, never text that would widen
                // the box or wrap on a phone.
                const hasCode = hasReward && typeof rows[index]?.promoCode === "string" && rows[index].promoCode.length > 0;
                return (
                  <button
                    key={at}
                    type="button"
                    onClick={() => openBox(at)}
                    aria-label={
                      hasCode
                        ? `Stamp ${at} — edit its reward, promo code minted`
                        : hasReward
                          ? `Stamp ${at} — edit its reward`
                          : `Stamp ${at} — add a reward`
                    }
                    className={cn(
                      "relative flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-sm transition-colors",
                      "hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      hasReward
                        ? "border-solid border-primary bg-primary/5 font-semibold text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {hasCode && (
                      <Ticket
                        className="absolute right-1 top-1 h-3 w-3 text-primary/70"
                        aria-hidden="true"
                      />
                    )}
                    {hasReward && <Gift className="h-4 w-4" aria-hidden="true" />}
                    <span>{at}</span>
                  </button>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              {fields.length === 0
                ? "No rewards yet — tap a box to add one."
                : `${fields.length} of ${LOYALTY_MILESTONES_MAX} rewards placed.`}
            </p>
          </>
        )}
      </CardContent>

      {/* The per-box editor. Mounted only while a box is open so its inputs
          cannot hold a stale row after one is removed. */}
      <Sheet
        open={openAt !== null}
        onOpenChange={(next) => {
          if (!next) setOpenAt(null);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Reward at stamp {openAt}</SheetTitle>
            <SheetDescription>What a diner gets when they reach this box.</SheetDescription>
          </SheetHeader>

          {openIndex !== -1 && (
            <div className="space-y-4 py-4">
              <MilestoneRewardFields
                control={control}
                register={register}
                errors={errors}
                index={openIndex}
                setValue={setValue}
              />

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  remove(openIndex);
                  setOpenAt(null);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Remove this reward
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {atMax && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">
            <Plus className="mr-1 inline h-3 w-3" />
            Maximum {LOYALTY_MILESTONES_MAX} rewards — remove one to place another.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
