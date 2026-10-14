"use client";

import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";

import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_AUDIENCE_WORDS,
  CAMPAIGN_CUSTOMERS_MAX,
  type CampaignAudience,
} from "@pos/shared/reward-campaigns";
import { useCustomers } from "@/hooks/use-customers";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { BRAND_CHECKBOX_SQUARE_CLASS } from "@/components/brand/brand-classes";
import { Field } from "@/components/settings/SettingsFields";
import { HINT_CLASS } from "@/components/settings/hint-classes";
import { REWARD_FIELD_CLASS, REWARD_SELECT_ITEM_CLASS, REWARD_SELECT_TRIGGER_CLASS } from "@/components/settings/rewards/reward-ui";
import {
  PICK_CAP_NOTE,
  PICK_NONE_YET,
  PICK_NO_MATCH,
  PICK_SEARCH_PLACEHOLDER,
  customerLabel,
  pickedCountText,
} from "@/lib/festival-cards-view";

// Rows drawn at once. The list is an admin's full customer list (real numbers, so the search matches a number too); past
// this the owner types more of the name or number to narrow it.
const VISIBLE_ROWS_MAX = 50;
const LIST_CLASS = "max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-brand-rule bg-brand-slip p-1";

interface FestivalAudienceFieldProps {
  audience: CampaignAudience;
  customerIds: readonly string[];
  audienceError?: string;
  customersError?: string;
  onAudience: (next: CampaignAudience) => void;
  onCustomerIds: (next: string[]) => void;
}

// Who gets a card: a dropdown of the two audiences and, for "Customers I pick", a searchable multi-pick. The list shows
// a name and at most the last 4 digits of the mobile, so two customers with one name can be told apart.
export function FestivalAudienceField({ audience, customerIds, audienceError, customersError, onAudience, onCustomerIds }: FestivalAudienceFieldProps) {
  const audienceId = useId();
  const searchId = useId();
  const customers = useCustomers();
  const [search, setSearch] = useState("");
  const picked = useMemo(() => new Set(customerIds), [customerIds]);
  const atCap = customerIds.length >= CAMPAIGN_CUSTOMERS_MAX;

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = customers.data ?? [];
    return q === "" ? all : all.filter((c) => c.name.toLowerCase().includes(q) || c.mobile.includes(q));
  }, [customers.data, search]);

  const toggle = (id: string, on: boolean) => onCustomerIds(on ? [...customerIds, id] : customerIds.filter((x) => x !== id));

  return (
    <div className="space-y-3">
      <Field label="Who gets a card" htmlFor={audienceId} error={audienceError}>
        <Select value={audience} onValueChange={(next) => onAudience(next as CampaignAudience)}>
          <SelectTrigger id={audienceId} className={REWARD_SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CAMPAIGN_AUDIENCES.map((a) => (
              <SelectItem key={a} value={a} className={REWARD_SELECT_ITEM_CLASS}>
                {CAMPAIGN_AUDIENCE_WORDS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {audience === "picked" && (
        <Field label="Pick your customers" htmlFor={searchId} error={customersError}>
          <div className="flex items-center justify-between gap-2">
            <p className={HINT_CLASS}>{`${pickedCountText(customerIds.length)} picked`}</p>
            {customerIds.length > 0 && (
              <Button type="button" variant="ghost" className="h-11 px-2 text-sm" onClick={() => onCustomerIds([])}>
                Clear all
              </Button>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" aria-hidden="true" />
            <Input
              id={searchId}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={PICK_SEARCH_PLACEHOLDER}
              className={`${REWARD_FIELD_CLASS} pl-9`}
            />
          </div>
          {customers.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : matches.length === 0 ? (
            <p className={HINT_CLASS}>{(customers.data?.length ?? 0) === 0 ? PICK_NONE_YET : PICK_NO_MATCH}</p>
          ) : (
            <ul className={LIST_CLASS}>
              {matches.slice(0, VISIBLE_ROWS_MAX).map((customer) => {
                const checked = picked.has(customer._id);
                return (
                  <li key={customer._id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded px-2 text-sm text-brand-ink hover:bg-brand-wash">
                      <Checkbox
                        checked={checked}
                        disabled={!checked && atCap}
                        className={BRAND_CHECKBOX_SQUARE_CLASS}
                        onCheckedChange={(next) => toggle(customer._id, next === true)}
                      />
                      <span className="min-w-0 truncate">{customerLabel(customer)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {matches.length > VISIBLE_ROWS_MAX && <p className={HINT_CLASS}>{`Showing the first ${VISIBLE_ROWS_MAX}. Type more of the name or number to narrow it down.`}</p>}
          {atCap && <p className={HINT_CLASS}>{PICK_CAP_NOTE}</p>}
        </Field>
      )}
    </div>
  );
}
