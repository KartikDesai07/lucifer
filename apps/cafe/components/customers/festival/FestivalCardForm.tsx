"use client";

import { useId, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import { REWARD_TITLE_MAX_LEN } from "@pos/shared/reward-levels";
import { CAMPAIGN_MAX_CARDS_MAX, CAMPAIGN_MAX_CARDS_MIN } from "@pos/shared/reward-campaigns";
import { cafeDateString } from "@pos/shared/utils";
import { useCreateRewardCampaign } from "@/hooks/use-reward-campaigns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DatePicker } from "@/components/shared/DatePicker";
import { Field } from "@/components/settings/SettingsFields";
import { HINT_CLASS } from "@/components/settings/hint-classes";
import { RewardNumberField } from "@/components/settings/rewards/RewardNumberField";
import { REWARD_BUTTON_CLASS, REWARD_FIELD_CLASS } from "@/components/settings/rewards/reward-ui";
import { FestivalAudienceField } from "@/components/customers/festival/FestivalAudienceField";
import { FestivalBoxFields } from "@/components/customers/festival/FestivalBoxFields";
import {
  NO_CAMPAIGN_PROBLEMS,
  campaignProblems,
  campaignSubmit,
  starterCampaignDraft,
  type CampaignDraft,
} from "@/lib/reward-campaign-form";
import { optionalNumber } from "@/lib/reward-levels-form";
import { MAX_CARDS_HINT, NAME_HINT, NEW_CAMPAIGN_DESCRIPTION, NEW_CAMPAIGN_TITLE } from "@/lib/festival-cards-view";

interface FestivalCardFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// The new-campaign side panel. SheetContent unmounts its children when closed, so the body re-seeds a fresh draft each
// time the panel opens (a cancelled draft is never kept).
export function FestivalCardForm({ open, onOpenChange }: FestivalCardFormProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{NEW_CAMPAIGN_TITLE}</SheetTitle>
          <SheetDescription>{NEW_CAMPAIGN_DESCRIPTION}</SheetDescription>
        </SheetHeader>
        <FestivalCardFormBody onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

function FestivalCardFormBody({ onClose }: { onClose: () => void }) {
  const nameId = useId();
  const [today] = useState(() => cafeDateString());
  const [draft, setDraft] = useState<CampaignDraft>(() => starterCampaignDraft(today));
  // Nothing is marked wrong before the first Create; after it, every field is marked as soon as it is wrong.
  const [attempted, setAttempted] = useState(false);
  const create = useCreateRewardCampaign();
  const problems = attempted ? campaignProblems(draft) : NO_CAMPAIGN_PROBLEMS;
  const { fields } = problems;
  const patch = (next: Partial<CampaignDraft>) => setDraft((d) => ({ ...d, ...next }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    const result = campaignSubmit(draft);
    if (!result.ok) return;
    try {
      await create.mutateAsync(result.body);
      onClose();
    } catch {
      // the hook already toasted the server's sentence; the panel stays open with the draft
    }
  };

  return (
    <form className="flex flex-1 flex-col gap-5 p-4" onSubmit={(event) => void submit(event)} noValidate>
      <Field label="Campaign name" htmlFor={nameId} error={fields.name} hint={NAME_HINT}>
        <Input
          id={nameId}
          value={draft.name}
          maxLength={REWARD_TITLE_MAX_LEN}
          onChange={(e) => patch({ name: e.target.value })}
          aria-invalid={fields.name !== undefined}
          className={REWARD_FIELD_CLASS}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First day" error={fields.startDay}>
          <DatePicker value={draft.startDay} min={today} onChange={(startDay) => patch({ startDay })} invalid={fields.startDay !== undefined} aria-label="First day" className="w-full" />
        </Field>
        <Field label="Last day" error={fields.endDay}>
          <DatePicker value={draft.endDay} min={draft.startDay || today} onChange={(endDay) => patch({ endDay })} invalid={fields.endDay !== undefined} aria-label="Last day" className="w-full" />
        </Field>
      </div>

      <FestivalAudienceField
        audience={draft.audience}
        customerIds={draft.customerIds}
        audienceError={fields.audience}
        customersError={fields.customerIds}
        onAudience={(audience) => patch({ audience, customerIds: audience === "picked" ? draft.customerIds : [] })}
        onCustomerIds={(customerIds) => patch({ customerIds })}
      />

      <RewardNumberField
        label="Limit the number of cards (optional)"
        value={draft.maxCards}
        min={CAMPAIGN_MAX_CARDS_MIN}
        max={CAMPAIGN_MAX_CARDS_MAX}
        error={fields.maxCards ?? null}
        hint={MAX_CARDS_HINT}
        onText={(text) => patch({ maxCards: optionalNumber(text) })}
      />

      <FestivalBoxFields draft={draft} problems={problems.box} onDraft={(update) => setDraft(update)} />

      <SheetFooter className="mt-auto flex-col gap-2 px-0 sm:flex-col sm:space-x-0">
        {problems.sentences.length > 0 && <p className="text-xs text-brand-danger">{problems.sentences[0]}</p>}
        <p className={HINT_CLASS}>Customers get their card the next time they open their rewards during these dates.</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className={`${REWARD_BUTTON_CLASS} flex-1`} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className={`${REWARD_BUTTON_CLASS} flex-1`} disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Create campaign
          </Button>
        </div>
      </SheetFooter>
    </form>
  );
}
