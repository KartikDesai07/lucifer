"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { useCreateCustomer } from "@/hooks/use-customers";
import { cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import type { Customer } from "@/types";

// The customer sheet's add form (U1 Task 10; values 8.3 in docs/superpowers/specs/2026-10-20-pos-html-values.md; design
// 6.12; owner Q1), with today's rules: "Mobile number" then "Name", "Add customer". The body 4px 16px 8px, fields 14px
// apart; a caption 12.5px 600 --text-2, 6px over its 48px box (a 1.5px --border rule, radius 12, 0 12px, gap 8,
// --surface); the inputs 16px with the UA's 1px 2px, the mobile in Geist Mono .04em after the 15px "+91" and a 1x20
// --border divider, the 12px --text-3 count after it. The box shows the focus in the --ring colour (ours; the HTML has
// none). The foot 12px 16px and 14px + the safe area over a --border-2 rule, the 48px button (15px 600), at .5 while
// today's rules block it (ruling P32). Its way back is the sheet head's back button (CustomerSearch: today's Cancel).
const NEW_BODY_CLASS = "flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-4 pt-1 pb-2";
const FIELD_CLASS = "flex flex-col gap-1.5";
const FIELD_CAPTION_CLASS = "text-[12.5px] font-semibold text-muted-foreground";
const FIELD_BOX_CLASS =
  "flex h-12 items-center gap-2 rounded-[12px] border-[1.5px] border-border bg-card px-3 focus-within:border-ring";
const FIELD_INPUT_CLASS =
  "min-w-0 flex-1 [border:0] bg-transparent px-0.5 py-px text-[16px] text-foreground outline-none placeholder:text-subtle-foreground";
const MOBILE_INPUT_CLASS = cn(FIELD_INPUT_CLASS, "font-mono tracking-[0.04em]");
const PREFIX_CLASS = "font-mono text-[15px] text-muted-foreground";
const COUNT_CLASS = "text-[12px] text-subtle-foreground";
const NEW_FOOT_CLASS = "flex-none border-t border-border-2 px-4 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]";
const SAVE_CLASS =
  "flex h-12 w-full cursor-pointer items-center justify-center rounded-[12px] border-0 bg-primary px-1.5 py-px text-[15px] font-semibold text-primary-foreground not-disabled:hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";

export function CustomerAddForm({
  onCreated,
  initialName,
  initialMobile,
}: {
  onCreated: (customer: Customer) => void;
  initialName?: string;
  initialMobile?: string;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [mobile, setMobile] = useState(initialMobile ?? "");
  const createCustomer = useCreateCustomer();
  // Focus goes to whichever field the search term did NOT already fill —
  // that is the one the operator still has to type.
  const focusMobile = !!initialName;

  const submit = async () => {
    const created = await createCustomer.mutateAsync({
      name: name.trim(),
      mobile: mobile.trim(),
      notes: "Regular",
    });
    onCreated(created);
  };

  const valid = name.trim().length > 0 && mobile.trim().length >= 10;
  // The HTML's count: the digits typed so far, of the 10 a mobile has (shown only; today's rule above decides).
  const digits = mobile.replace(/\D/g, "").length;

  return (
    <>
      <div data-ui="cs-form" className={NEW_BODY_CLASS}>
        <label htmlFor="new-customer-mobile" className={FIELD_CLASS}>
          <span className={FIELD_CAPTION_CLASS}>Mobile number</span>
          <span data-ui="cs-mobile" className={FIELD_BOX_CLASS}>
            <span aria-hidden="true" className={PREFIX_CLASS}>+91</span>
            <span aria-hidden="true" className="h-5 w-px flex-none bg-border" />
            <input
              id="new-customer-mobile"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              inputMode="numeric"
              placeholder="98200 12345"
              autoFocus={focusMobile}
              data-autofocus={focusMobile ? "" : undefined}
              autoComplete="off"
              className={MOBILE_INPUT_CLASS}
            />
            <span aria-hidden="true" className={COUNT_CLASS}>{digits}/10</span>
          </span>
        </label>
        <label htmlFor="new-customer-name" className={FIELD_CLASS}>
          <span className={FIELD_CAPTION_CLASS}>Name</span>
          <span data-ui="cs-name" className={FIELD_BOX_CLASS}>
            <input
              id="new-customer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer name"
              autoFocus={!focusMobile}
              data-autofocus={focusMobile ? undefined : ""}
              autoComplete="off"
              className={FIELD_INPUT_CLASS}
            />
          </span>
        </label>
      </div>
      <div data-ui="cs-form-foot" className={NEW_FOOT_CLASS}>
        <button
          type="button"
          data-ui="cs-add"
          className={cn(SAVE_CLASS, BRAND_PRESS_CLASS)}
          disabled={!valid || createCustomer.isPending}
          onClick={submit}
        >
          {createCustomer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add customer"}
        </button>
      </div>
    </>
  );
}
