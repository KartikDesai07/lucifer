"use client";

import { useEffect, useState, type ReactElement } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Loader2 } from "lucide-react";

import {
  useCustomerSearch,
  useCreateCustomer,
  CUSTOMER_SEARCH_MIN_CHARS,
} from "@/hooks/use-customers";
import { cn, inr } from "@/lib/utils";
import { AVATAR_HUES, avatarHueIndex } from "@/lib/ui";
import { PAY_PILL_ADD_CLASS, PAY_PILL_CLASS, PAY_PILL_SET_CLASS, pickerPillText } from "@/lib/payment-sheet";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import type { Customer } from "@/types";

interface CustomerSearchProps {
  value: Customer | undefined;
  onChange: (customer: Customer | undefined) => void;
  // Applied to the own trigger (the payment sheet's pill) only.
  className?: string;
  // A send is in flight: the customer cannot change under it.
  disabled?: boolean;
  // The control this dialog opens from instead of the pill: the cart head's Customer cell (U1 Task 4, owner Q9). It
  // brings its own words, title and lock; className and disabled above style and lock the pill (the payment sheet's).
  trigger?: ReactElement;
}

// The customer sheet in the owner's HTML (U1 Task 10; values 8 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 4 builder-check, 6.12; owner Q1), wherever it opens: the cart's Customer cell, and the payment sheet's pill on
// /pos, the Orders page and the dashboard. "Customer" over today's description; the 48px search; today's line in the
// list area until a search runs (no frequent list: that would be a new request); "Results" over our rows; our search
// lines; the 46px "+ New customer" and our "Walk-In" link at the foot. The add form: "Mobile number" (+91) then "Name",
// today's rules, "Add customer"; the HTML's back button is today's Cancel. A Radix dialog of its own: focus trap, Escape
// and the scrim close it, the focus goes back to what opened it.

// Separators a cafe actually types around a phone number ("+91 98765-43210").
// Stripped before the digits check below — this is a shape guess for the "+ New customer"
// hand-off, not a validity check (AddCustomerForm's own `valid` gate is that).
const PHONE_SEPARATOR_PATTERN = /[+\s-]/g;
const DIGITS_ONLY_PATTERN = /^\d+$/;

/** Today's description: the sheet's sub line, and the list's line until a search runs (design 4). */
const SEARCH_HINT = "Search by name or mobile, or add a new customer.";

// The scrim (values 8.1, 0.3 sheetAlign/sheetPad): --scrim, fadeIn .2s, the panel centred in 16px, along the window's
// foot with no padding below 720px. z-index 51: over the payment sheet's 50 (lib/payment-sheet.ts), as the HTML's 46 over
// its 45, so the sheet opened from the payment pill is on top everywhere the payment sheet opens.
const SCRIM_CLASS =
  "fixed inset-0 z-[51] flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0";
// The panel (values 8.1, 0.3 csH/csMaxH/sheetRadius): 460px on --surface, 600 tall at most 100dvh - 32px, a 1px --border,
// radius 14, --pop, sheetIn .32s; below 720px the full width, 88dvh, radius 14 14 0 0. The vh sizes are the base, the
// dvh ones where they exist.
const PANEL_CLASS =
  "flex w-full max-w-[460px] flex-col overflow-hidden rounded-[14px] border border-border bg-card [box-shadow:var(--pop)] outline-none motion-safe:animate-html-sheet-in-cs tab:h-[600px] tab:max-h-[calc(100vh-32px)] tab:supports-[height:1dvh]:max-h-[calc(100dvh-32px)] max-tab:h-[88vh] max-tab:max-h-[88vh] max-tab:rounded-[14px_14px_0_0] max-tab:supports-[height:1dvh]:h-[88dvh] max-tab:supports-[height:1dvh]:max-h-[88dvh]";
// The head (values 8.1): 16px 16px 12px, gap 10; the title 17px 600 over the sub 12.5px --text-2; the 32px back (radius
// 8, --text) in the add form and the 32px round ✕ (--text-2), both on --surface-3 (the UA's 1px 6px: the HTML sets none).
const HEAD_CLASS = "flex flex-none items-center gap-2.5 px-4 pt-4 pb-3";
const TITLE_CLASS = "text-[17px] font-semibold";
const SUB_CLASS = "text-[12.5px] text-muted-foreground";
const ROUND_CLASS = "flex size-8 flex-none cursor-pointer items-center justify-center border-0 bg-surface-3 px-1.5 py-px";
const BACK_CLASS = cn(ROUND_CLASS, "rounded-[8px] text-foreground", BRAND_PRESS_CLASS);
const CLOSE_CLASS = cn(ROUND_CLASS, "rounded-[50%] text-muted-foreground", BRAND_PRESS_CLASS);
// The search (values 8.2): 0 16px 10px around a 48px box, always drawn focused (a 1.5px --accent rule, radius 12, the
// 4px --accent-t ring), 0 12px, gap 10: the 17px --text-2 magnifier, the input 15px (16px below 720px, ruling R36) with
// the UA's 1px 2px, the mode word 11.5px --text-3 (an empty span without a query, as the HTML's).
const SEARCH_WRAP_CLASS = "flex-none px-4 pb-2.5";
const SEARCH_BOX_CLASS =
  "flex h-12 items-center gap-2.5 rounded-[12px] border-[1.5px] border-primary px-3 [box-shadow:0_0_0_4px_var(--accent)]";
const SEARCH_INPUT_CLASS =
  "min-w-0 flex-1 [border:0] bg-transparent px-0.5 py-px text-[15px] text-foreground outline-none placeholder:text-subtle-foreground max-tab:text-[16px]";
const MODE_CLASS = "whitespace-nowrap text-[11.5px] text-subtle-foreground";
// The caption over the rows (values 8.2 list label): 4px 18px 6px, 11.5px 600 .05em upper-case --text-3.
const CAPTION_CLASS =
  "flex-none px-[18px] pt-1 pb-1.5 text-[11.5px] font-semibold tracking-[0.05em] uppercase text-subtle-foreground";
const LIST_CLASS = "min-h-0 flex-1 overflow-auto px-2";
// Our lines in the list area, in the HTML's empty block (values 8.2): 24px 12px, centred, 13.5px --text-2, 1.5; the
// offline and failed lines in --bad-i (they mean "we did not find out").
const LINE_CLASS = "px-3 py-6 text-center text-[13.5px] leading-[1.5] text-muted-foreground";
const LINE_BAD_CLASS = cn(LINE_CLASS, "text-status-bad-ink");
const SEARCHING_CLASS = cn(LINE_CLASS, "flex items-center justify-center gap-2");
// A row (values 8.2): 9px 10px, radius 10, 12px apart, rising in turn, hover --hover; the current customer on --accent-t
// with a check where the HTML puts its tag. The avatar 38px round, 13px 600 initials in U0's tint for the name; the name
// 14px 600 over the mobile in Geist Mono 12.5px --text-2 (masked for staff by the server); on the right, 12px --text-2
// at 1.4: the visits, and our due in --bad-i.
const ROW_CLASS =
  "flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 px-2.5 py-[9px] text-left text-foreground hover:bg-hover motion-safe:animate-html-rise-cs";
const ROW_CURRENT_CLASS = "bg-accent";
const ROW_OTHER_CLASS = "bg-transparent";
const AVATAR_CLASS = "flex size-[38px] flex-none items-center justify-center rounded-[50%] text-[13px] font-semibold";
const NAME_LINE_CLASS = "flex items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold";
const PHONE_CLASS = "block font-mono text-[12.5px] text-muted-foreground";
const RIGHT_CLASS = "flex-none text-right text-[12px] leading-[1.4] text-muted-foreground";
// The foot (values 8.2): 12px 16px and 14px + the safe area, gap 8, a --border-2 rule; "+ New customer" 46px on --accent,
// radius 12, 14.5px 600, hover --accent-h; our Walk-In as the HTML's 36px --link button, 13.5px 500.
const FOOT_CLASS =
  "flex flex-none flex-col gap-2 border-t border-border-2 px-4 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]";
const NEW_CLASS =
  "h-[46px] cursor-pointer rounded-[12px] border-0 bg-primary px-1.5 py-px text-[14.5px] font-semibold text-primary-foreground hover:bg-primary-hover";
const LINK_CLASS = "h-9 cursor-pointer border-0 bg-transparent px-1.5 py-px text-[13.5px] font-medium text-link";
// The add form (values 8.3): the body 4px 16px 8px, fields 14px apart; a caption 12.5px 600 --text-2, 6px over its 48px
// box (a 1.5px --border rule, radius 12, 0 12px, gap 8, --surface); the inputs 16px with the UA's 1px 2px, the mobile in
// Geist Mono .04em after the 15px "+91" and a 1x20 --border divider, the 12px --text-3 count after it. The box shows
// the focus in the --ring colour (ours; the HTML has none). The foot as the search foot's with the 48px button (15px
// 600), at .5 while today's rules block it (as the item options modal, ruling P25).
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

/** The HTML's ini2 (values 8.2): the first letters of the first two words, upper-cased. */
function initials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w.charAt(0)).join("").slice(0, 2).toUpperCase();
}

/** "1 visit", "12 visits" (never the HTML's "1 visits"). */
function visitsText(visits: number): string {
  return `${visits} visit${visits === 1 ? "" : "s"}`;
}

/** As the sheet opens, the field marked data-autofocus takes the focus (the search, or the add form's empty field).
 *  Opened from inside another dialog (the cart sheet below 1024px, the payment sheet), that dialog pulls a plain
 *  autoFocus back before this one traps the focus, and Radix would then focus the first control in the head (the ✕). */
function focusMarkedField(e: Event) {
  const field = e.currentTarget instanceof HTMLElement ? e.currentTarget.querySelector<HTMLElement>("[data-autofocus]") : null;
  if (!field) return;
  e.preventDefault();
  field.focus();
}

export function CustomerSearch({ value, onChange, className, disabled, trigger }: CustomerSearchProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [adding, setAdding] = useState(false);

  // 300ms debounce so we don't fire the (uncached) search on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(id);
  }, [term]);

  const { data: results, isFetching, isPaused, isError } =
    useCustomerSearch(debounced);
  // Rows must answer what is ON SCREEN. Until the debounce catches up, the
  // previous query's rows are still in hand — and once numbers are masked every
  // row reads the same "98765*****", so a stale row is invisible to the person
  // tapping it. That tap attaches the WRONG customer to the bill and puts any
  // Due on their ledger, which no later reconcile can undo (the order carries
  // the wrong customerId). Compared trimmed, matching the query key.
  const settled = debounced.trim() === term.trim();
  const rows = settled ? (results ?? []) : [];
  const searching = term.trim().length > 0 && (!settled || isFetching);

  const select = (customer: Customer | undefined) => {
    onChange(customer);
    setOpen(false);
    setTerm("");
    setDebounced("");
    setAdding(false);
  };

  // The operator already typed SOMETHING before hitting "+ New customer" — a phone-shaped
  // term seeds the mobile field (and puts focus on name, the field still
  // blank), anything else seeds name (and puts focus on mobile). Re-typing the
  // number is where a wrong digit lands on the wrong customer's ledger.
  const strippedTerm = term.trim().replace(PHONE_SEPARATOR_PATTERN, "");
  const termIsPhoneLike = strippedTerm.length > 0 && DIGITS_ONLY_PATTERN.test(strippedTerm);
  // The HTML's mode word in the search box: which field "+ New customer" will fill (the same rule as the seeding above).
  const termMode = termIsPhoneLike ? "Phone" : term.trim() ? "Name" : "";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      {/* The own trigger is the payment sheet's pill (U1 Task 9; values 11.1): "+ Add customer" in --link, or
          "Customer: {name} · change" in --text; its empty words are never "Walk-In" (the table owns that word). Its
          words are its name; title = the untruncated name. */}
      <DialogPrimitive.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            data-ui="pay-customer"
            className={cn(PAY_PILL_CLASS, value ? PAY_PILL_SET_CLASS : PAY_PILL_ADD_CLASS, BRAND_PRESS_CLASS, className)}
            disabled={disabled}
            title={value ? value.name : "Select customer"}
          >
            {pickerPillText(value?.name)}
          </button>
        )}
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-ui="cs-sheet" className={SCRIM_CLASS}>
          <DialogPrimitive.Content data-ui="cs-panel" onOpenAutoFocus={focusMarkedField} className={PANEL_CLASS}>
            <div data-ui="cs-head" className={HEAD_CLASS}>
              {adding && (
                <button type="button" data-ui="cs-back" onClick={() => setAdding(false)} aria-label="Cancel" title="Cancel" className={BACK_CLASS}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
              )}
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className={TITLE_CLASS}>Customer</DialogPrimitive.Title>
                <DialogPrimitive.Description className={SUB_CLASS}>{SEARCH_HINT}</DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close data-ui="cs-close" aria-label="Close" className={CLOSE_CLASS}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </DialogPrimitive.Close>
            </div>

            {adding ? (
              <AddCustomerForm
                onCreated={select}
                initialName={termIsPhoneLike ? undefined : term.trim()}
                initialMobile={termIsPhoneLike ? strippedTerm : undefined}
              />
            ) : (
              <>
                <div data-ui="cs-search-wrap" className={SEARCH_WRAP_CLASS}>
                  <div data-ui="cs-search" className={SEARCH_BOX_CLASS}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="flex-none text-muted-foreground">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input
                      autoFocus
                      data-autofocus=""
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                      placeholder="Phone number or name"
                      autoComplete="off"
                      spellCheck={false}
                      className={SEARCH_INPUT_CLASS}
                    />
                    <span data-ui="cs-mode" className={MODE_CLASS}>{termMode}</span>
                  </div>
                </div>
                {rows.length > 0 && (
                  <div data-ui="cs-caption" className={CAPTION_CLASS}>
                    Results
                  </div>
                )}

                <div data-ui="cs-list" className={LIST_CLASS}>
                  {!searching && debounced.trim().length < CUSTOMER_SEARCH_MIN_CHARS && (
                    <p data-ui="cs-line" className={LINE_CLASS}>{SEARCH_HINT}</p>
                  )}
                  {searching && (
                    <div data-ui="cs-line" className={SEARCHING_CLASS}>
                      <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                    </div>
                  )}
                  {/* Offline and failed both mean "we did not find out", never "no
                      such customer". That wrong answer ends with a duplicate record
                      taking the bill while the real customer's dues are orphaned. */}
                  {!searching && isPaused && (
                    <p data-ui="cs-line" className={LINE_BAD_CLASS}>
                      Offline — could not check the customer list.
                    </p>
                  )}
                  {!searching && !isPaused && isError && (
                    <p data-ui="cs-line" className={LINE_BAD_CLASS}>
                      Search failed. Try again.
                    </p>
                  )}
                  {!searching &&
                    !isPaused &&
                    !isError &&
                    debounced.trim().length >= CUSTOMER_SEARCH_MIN_CHARS &&
                    rows.length === 0 && (
                      <p data-ui="cs-line" className={LINE_CLASS}>
                        No matches. Add a new customer below.
                      </p>
                    )}
                  {rows.map((c) => (
                    <CustomerRow
                      key={c._id}
                      customer={c}
                      index={rows.indexOf(c)}
                      current={value?._id === c._id}
                      onPick={select}
                    />
                  ))}
                </div>

                <div data-ui="cs-foot" className={FOOT_CLASS}>
                  <button type="button" data-ui="cs-new" onClick={() => setAdding(true)} className={cn(NEW_CLASS, BRAND_PRESS_CLASS)}>
                    + New customer
                  </button>
                  <button type="button" data-ui="cs-walk-in" onClick={() => select(undefined)} className={cn(LINK_CLASS, BRAND_PRESS_CLASS)}>
                    Walk-In
                  </button>
                </div>
              </>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** One search result: a tap attaches the customer and closes the sheet. Rows rise 30 ms apart (values 8.2 d). */
function CustomerRow({
  customer: c,
  index,
  current,
  onPick,
}: {
  customer: Customer;
  index: number;
  current: boolean;
  onPick: (customer: Customer) => void;
}) {
  const hue = AVATAR_HUES[avatarHueIndex(c.name)];
  return (
    <button
      type="button"
      data-ui="cs-row"
      aria-current={current ? "true" : undefined}
      onClick={() => onPick(c)}
      style={{ animationDelay: `${(index * 0.03).toFixed(2)}s` }}
      className={cn(ROW_CLASS, current ? ROW_CURRENT_CLASS : ROW_OTHER_CLASS, BRAND_PRESS_CLASS)}
    >
      <span aria-hidden="true" className={AVATAR_CLASS} style={{ backgroundColor: hue.bg, color: hue.fg }}>
        {initials(c.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className={NAME_LINE_CLASS}>
          <span className="overflow-hidden text-ellipsis">{c.name}</span>
          {current && <Check aria-hidden="true" className="size-4 flex-none text-primary" />}
        </span>
        <span className={PHONE_CLASS}>{c.mobile}</span>
      </span>
      <span className={RIGHT_CLASS}>
        {visitsText(c.visits)}
        {c.totalDue > 0 && (
          <>
            <br />
            <span className="text-status-bad-ink">Due {inr(c.totalDue)}</span>
          </>
        )}
      </span>
    </button>
  );
}

function AddCustomerForm({
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
