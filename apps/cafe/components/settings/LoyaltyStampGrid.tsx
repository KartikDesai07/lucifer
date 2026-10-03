"use client";

import { useState } from "react";
import { useFieldArray, useWatch } from "react-hook-form";
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { Trash2 } from "lucide-react";

import type { SettingsInput } from "@/schemas";
import { LOYALTY_MILESTONES_MAX } from "@pos/shared/loyalty-rules";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { BRAND_FIELD_ERROR_CLASS } from "@/components/brand/brand-classes";
import { HINT_CLASS, SettingsGroup } from "@/components/settings/SettingsFields";
import { LoyaltyStampBox } from "@/components/settings/LoyaltyStampBox";
import { MilestoneRewardFields } from "@/components/settings/MilestoneRewardFields";
import { milestonePromoStatus } from "@/lib/milestone-promo-status";

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
// CB-5D — membership and levels were REMOVED (owner: no client used them).
// The card size and the stamp's name used to live here; settings pass slice 8
// moved both to LoyaltyCard's "Stamp card" group (they describe the card, not
// a reward). This file is the "Rewards" group only.
//
// Settings pass slice 8 — a reward is made only by "Add reward". Tapping an
// EMPTY box appends a draft row so the panel has something to edit, but
// closing it any other way (Cancel, the X, Escape, a tap outside) removes that
// row again, so merely looking at a box leaves no reward and the page clean.
// An existing reward has Done and Remove reward; Remove asks first.

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

// True when the reward row at `index` carries ANY error object, so its box can
// be marked: a failed Save puts the message inside the closed panel.
function rowHasError(milestonesErrors: unknown, index: number): boolean {
  if (!milestonesErrors || typeof milestonesErrors !== "object") return false;
  const row = (milestonesErrors as Record<number, unknown>)[index];
  return typeof row === "object" && row !== null && Object.keys(row).length > 0;
}

// Footer buttons: 44px on touch, 40px from md (the Promo codes idiom).
const FOOTER_BUTTON_CLASS = "h-11 md:h-10";

export function LoyaltyStampGrid({ control, register, errors, setValue }: LoyaltyStampGridProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "loyaltyRules.milestones" });
  const milestones = useWatch({ control, name: "loyaltyRules.milestones" });
  const cardSize = useWatch({ control, name: "loyaltyRules.cardSize" });
  const promoCodes = useWatch({ control, name: "promoCodes" });

  // Which box's panel is open. `null` = closed. Kept as the STAMP NUMBER, not a
  // row index: a box may have no row yet, and rows shift when one is removed.
  const [openAt, setOpenAt] = useState<number | null>(null);
  // The stamp number the panel TITLE reads. Set on open and never cleared on
  // close, so the title does not flicker during the close animation.
  const [panelAt, setPanelAt] = useState<number | null>(null);
  // True when the panel was opened on an empty box (its row is a draft). Set
  // ONLY when a box opens, never on close: the title and footer read it, so
  // they keep their words through the close animation. A stale true after
  // "Add reward" is harmless — closePanel only drops a draft while openAt is set.
  const [panelIsNew, setPanelIsNew] = useState(false);
  // The Remove dialog's flag and its target are separate on purpose (the
  // PromoCodesFields idiom): the target stays set through the close animation.
  const [removeAt, setRemoveAt] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rows = Array.isArray(milestones) ? milestones : [];
  const size = typeof cardSize === "number" && cardSize > 0 ? Math.floor(cardSize) : 0;
  // Never draw fewer boxes than the ladder already uses — a reward above the
  // card's size would otherwise be invisible AND unreachable.
  const highestAt = rows.reduce((max, row) => (typeof row?.at === "number" && row.at > max ? row.at : max), 0);
  const boxes = Math.max(size, highestAt);

  const rowIndexAt = (at: number) => rows.findIndex((row) => row?.at === at);
  // The body follows openAt, NOT panelAt: it must unmount in the same render
  // as a remove(). useWatch's rows lag the field array by a render, so a body
  // still mounted there re-registers the removed index and RHF re-creates it
  // as a phantom row (smoke s8lylive2: Cancel left the page dirty, ghost count).
  const openIndex = openAt === null ? -1 : rowIndexAt(openAt);
  const atMax = fields.length >= LOYALTY_MILESTONES_MAX;

  // Opening a box that has no reward yet APPENDS a draft row for that exact
  // stamp number, so the panel always edits a real row. Blocked at the cap,
  // where the panel would otherwise open onto nothing.
  const openBox = (at: number) => {
    if (rowIndexAt(at) === -1) {
      if (atMax) return;
      append({ at, kind: "flat", value: 50, item: "" });
      setPanelIsNew(true);
    } else {
      setPanelIsNew(false);
    }
    setPanelAt(at);
    setOpenAt(at);
  };

  // Every way out except "Add reward" / "Done" / a confirmed Remove: a draft
  // row is dropped (looked up by stamp number NOW, since rows may have shifted).
  const closePanel = () => {
    if (panelIsNew && openAt !== null) {
      const draftIndex = rowIndexAt(openAt);
      if (draftIndex !== -1) remove(draftIndex);
    }
    setOpenAt(null);
  };

  const arrayError = arrayLevelMessage(errors.loyaltyRules?.milestones);

  return (
    <>
      <SettingsGroup
        title="Rewards"
        description="Tap a box to choose what a diner gets when they reach it. The card starts again once it is full."
      >
        {arrayError && (
          <p className={BRAND_FIELD_ERROR_CLASS} role="alert">
            {arrayError}
          </p>
        )}

        {boxes === 0 ? (
          <p className="rounded-md border border-dashed border-brand-rule p-4 text-sm text-brand-muted">
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
                // CB-5D — a promo code, shown as a small corner mark only: the
                // grid must stay a clean row of numbers. Marked only when a
                // diner will really get it; a deleted or switched-off code
                // marks the box as needing a fix instead (the panel says why).
                const codeStatus = hasReward ? milestonePromoStatus(rows[index]?.promoCode, promoCodes) : "none";
                const hasCode = codeStatus === "ok";
                const codeBroken = codeStatus === "missing" || codeStatus === "off";
                return (
                  <LoyaltyStampBox
                    key={at}
                    at={at}
                    hasReward={hasReward}
                    hasCode={hasCode}
                    hasError={hasReward && (codeBroken || rowHasError(errors.loyaltyRules?.milestones, index))}
                    disabled={atMax && !hasReward}
                    onOpen={() => openBox(at)}
                  />
                );
              })}
            </div>

            {fields.length === 0 ? (
              <p className="rounded-md border border-dashed border-brand-rule p-4 text-sm text-brand-muted">
                No rewards yet. Tap a box to add one.
              </p>
            ) : (
              <p className={HINT_CLASS}>{`${fields.length} of ${LOYALTY_MILESTONES_MAX} rewards on the card.`}</p>
            )}
            {atMax && (
              <p className={HINT_CLASS}>
                {`You can place up to ${LOYALTY_MILESTONES_MAX} rewards. Remove one to place another.`}
              </p>
            )}
          </>
        )}
      </SettingsGroup>

      {/* The per-box editor. Its body is mounted only while the box has a row so
          its inputs cannot hold a stale row after one is removed. */}
      <Sheet
        open={openAt !== null}
        onOpenChange={(next) => {
          if (!next) closePanel();
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{panelIsNew ? `Add a reward at stamp ${panelAt}` : `Reward at stamp ${panelAt}`}</SheetTitle>
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
            </div>
          )}

          <div className="mt-auto space-y-3 border-t border-brand-rule pt-4">
            <p className={HINT_CLASS}>Changes save when you press Save changes.</p>
            {panelIsNew ? (
              <SheetFooter className="gap-2 sm:space-x-0">
                <Button type="button" variant="outline" className={FOOTER_BUTTON_CLASS} onClick={closePanel}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className={FOOTER_BUTTON_CLASS}
                  // Closing WITHOUT closePanel is what keeps the draft row.
                  onClick={() => setOpenAt(null)}
                >
                  Add reward
                </Button>
              </SheetFooter>
            ) : (
              <SheetFooter className="gap-2 sm:space-x-0">
                <Button
                  type="button"
                  variant="ghost"
                  className={`${FOOTER_BUTTON_CLASS} text-brand-danger hover:text-brand-danger`}
                  onClick={() => {
                    setRemoveAt(openAt);
                    setConfirmOpen(true);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  Remove reward
                </Button>
                <Button type="button" className={FOOTER_BUTTON_CLASS} onClick={() => setOpenAt(null)}>
                  Done
                </Button>
              </SheetFooter>
            )}
          </div>
          {/* INSIDE SheetContent on purpose: Radix decides "outside" by the React
              tree, so a confirm rendered as the Sheet's sibling made its Cancel
              tap an outside tap that closed the panel too (smoke s8lylive2). */}
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={`Remove the reward at stamp ${removeAt ?? ""}?`}
            description="Nothing changes for diners until you save."
            confirmLabel="Remove"
            onConfirm={() => {
              const removeIndex = removeAt === null ? -1 : rowIndexAt(removeAt);
              if (removeIndex !== -1) remove(removeIndex);
              setConfirmOpen(false);
              setOpenAt(null);
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
