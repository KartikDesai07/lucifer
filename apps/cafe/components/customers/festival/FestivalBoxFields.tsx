"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { REWARD_OPTIONS_PER_SLOT_MAX } from "@pos/shared/reward-levels";
import { optionChances } from "@pos/shared/reward-levels-view";
import { useProducts } from "@/hooks/use-products";
import { Button } from "@/components/ui/button";
import { HINT_CLASS } from "@/components/settings/hint-classes";
import { RewardCostPreview } from "@/components/settings/rewards/RewardCostPreview";
import { RewardOptionFields } from "@/components/settings/rewards/RewardOptionFields";
import { RewardTtlFields } from "@/components/settings/rewards/RewardTtlFields";
import { REWARD_BUTTON_CLASS } from "@/components/settings/rewards/reward-ui";
import { CAMPAIGN_BOX_LEVEL, CAMPAIGN_BOX_STEP, editBox, type CampaignDraft } from "@/lib/reward-campaign-form";
import { newOption, nextOptionId, priceOfFrom, replaceOption, withOption, withoutOption } from "@/lib/reward-levels-edit";
import { REWARD_COST_EXAMPLE_BILL_DEFAULT } from "@/lib/reward-levels-copy";
import { fieldProblem, type RewardProblem } from "@/lib/reward-levels-form";
import { BOX_SECTION_HINT, BOX_SECTION_TITLE } from "@/lib/festival-cards-view";

interface FestivalBoxFieldsProps {
  draft: CampaignDraft;
  problems: readonly RewardProblem[];
  onDraft: (update: (current: CampaignDraft) => CampaignDraft) => void;
}

// The campaign's one box, edited with the settings editor's own fields: its rewards (each with its chance and limits),
// what the box costs, and the two clocks. The campaign has no level or box number, so its problems are looked up at the
// fixed sentinel position the form lib maps them onto.
export function FestivalBoxFields({ draft, problems, onDraft }: FestivalBoxFieldsProps) {
  const { box } = draft;
  const [exampleBill, setExampleBill] = useState(REWARD_COST_EXAMPLE_BILL_DEFAULT);
  const products = useProducts();
  const priceOf = useMemo(() => priceOfFrom(products.data), [products.data]);
  const slot = { step: CAMPAIGN_BOX_STEP, ...box };
  const weightsOk = box.options.every((o) => Number.isFinite(o.weight) && o.weight > 0);
  const chances = weightsOk ? optionChances(slot) : box.options.map(() => 0);
  const atOptionMax = box.options.length >= REWARD_OPTIONS_PER_SLOT_MAX;
  const boxProblem = (field: string): string | null => fieldProblem(problems, CAMPAIGN_BOX_LEVEL, CAMPAIGN_BOX_STEP, null, field);
  const boxError = boxProblem("options");

  return (
    <section className="space-y-4" aria-label={BOX_SECTION_TITLE}>
      <div>
        <h3 className="text-sm font-semibold text-brand-ink">{BOX_SECTION_TITLE}</h3>
        <p className={HINT_CLASS}>{BOX_SECTION_HINT}</p>
      </div>

      {box.options.map((option, index) => (
        <RewardOptionFields
          key={option.id}
          option={option}
          index={index}
          count={box.options.length}
          chance={chances[index] ?? 0}
          level={CAMPAIGN_BOX_LEVEL}
          step={CAMPAIGN_BOX_STEP}
          problems={problems}
          onChange={(next) => onDraft((d) => editBox(d, (s) => replaceOption(s, option.id, next)))}
          onRemove={() => onDraft((d) => editBox(d, (s) => withoutOption(s, option.id)))}
        />
      ))}
      {boxError && <p className="text-xs text-brand-danger">{boxError}</p>}

      <Button
        type="button"
        variant="outline"
        className={`${REWARD_BUTTON_CLASS} w-full`}
        disabled={atOptionMax}
        onClick={() => onDraft((d) => editBox(d, (s) => withOption(s, newOption("bill-percent", nextOptionId(s.options)))))}
      >
        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
        Add a reward
      </Button>
      {atOptionMax && <p className={HINT_CLASS}>{`A box can have up to ${REWARD_OPTIONS_PER_SLOT_MAX} rewards. Remove one to add another.`}</p>}

      <RewardCostPreview slot={slot} exampleBill={exampleBill} onExampleBillChange={setExampleBill} priceOf={priceOf} />

      <RewardTtlFields
        slot={box}
        scratchError={boxProblem("scratchDays")}
        useError={boxProblem("useDays")}
        onChange={(patch) => onDraft((d) => editBox(d, (s) => ({ ...s, ...patch })))}
      />
    </section>
  );
}
