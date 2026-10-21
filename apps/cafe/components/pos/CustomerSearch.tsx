"use client";

import { useEffect, useState, type ReactElement } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";

import {
  useCustomerSearch,
  CUSTOMER_SEARCH_MIN_CHARS,
} from "@/hooks/use-customers";
import { cn } from "@/lib/utils";
import { PAY_PILL_ADD_CLASS, PAY_PILL_CLASS, PAY_PILL_SET_CLASS, pickerPillText } from "@/lib/payment-sheet";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { CustomerRow } from "@/components/pos/CustomerRow";
import { CustomerAddForm } from "@/components/pos/CustomerAddForm";
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
  // The order the sheet is for, its sub line (ruling P30, as the HTML's names it): the cart's title from the cell, the
  // payment title's place word from the pill ("New order" / "Table T-4" / "Walk-In"). None: no sub line.
  context?: string;
}

// The customer sheet in the owner's HTML (U1 Task 10; values 8 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 4 builder-check, 6.12; owner Q1; rulings P30-P33), wherever it opens: the cart's Customer cell, and the payment
// sheet's pill on /pos, the Orders page and the dashboard. "Customer" over the order it is for; the 48px search; today's
// line in the list area until a search runs (no frequent list: that would be a new request); "Results" over our rows
// and over the no-match line; our search lines; the 46px "+ New customer" and our "Walk-In" link at the foot. The add
// form is CustomerAddForm.tsx, a row CustomerRow.tsx; the HTML's back button is today's Cancel. A Radix dialog of its
// own: focus trap, Escape and the scrim close it, the focus goes back to what opened it.

// Separators a cafe actually types around a phone number ("+91 98765-43210").
// Stripped before the digits check below — this is a shape guess for the "+ New customer"
// hand-off, not a validity check (CustomerAddForm's own `valid` gate is that).
const PHONE_SEPARATOR_PATTERN = /[+\s-]/g;
const DIGITS_ONLY_PATTERN = /^\d+$/;

/** Today's description: the list's line until a search runs (design 4), and the dialog's description, read out only. */
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
const SUB_CLASS = "truncate text-[12.5px] text-muted-foreground";
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
// The caption (values 8.2 list label): 4px 18px 6px, 11.5px 600 .05em upper-case --text-3.
const CAPTION_CLASS =
  "flex-none px-[18px] pt-1 pb-1.5 text-[11.5px] font-semibold tracking-[0.05em] uppercase text-subtle-foreground";
const LIST_CLASS = "min-h-0 flex-1 overflow-auto px-2";
// Our lines in the list area, in the HTML's empty block (values 8.2): 24px 12px, centred, 13.5px --text-2, 1.5; the
// offline and failed lines in --bad-i (they mean "we did not find out").
const LINE_CLASS = "px-3 py-6 text-center text-[13.5px] leading-[1.5] text-muted-foreground";
const LINE_BAD_CLASS = cn(LINE_CLASS, "text-status-bad-ink");
const SEARCHING_CLASS = cn(LINE_CLASS, "flex items-center justify-center gap-2");
// The foot (values 8.2): 12px 16px and 14px + the safe area, gap 8, a --border-2 rule; "+ New customer" 46px on --accent,
// radius 12, 14.5px 600, hover --accent-h; our Walk-In as the HTML's 36px --link button, 13.5px 500.
const FOOT_CLASS =
  "flex flex-none flex-col gap-2 border-t border-border-2 px-4 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]";
const NEW_CLASS =
  "h-[46px] cursor-pointer rounded-[12px] border-0 bg-primary px-1.5 py-px text-[14.5px] font-semibold text-primary-foreground hover:bg-primary-hover";
const LINK_CLASS = "h-9 cursor-pointer border-0 bg-transparent px-1.5 py-px text-[13.5px] font-medium text-link";

/** As the sheet opens, the field marked data-autofocus takes the focus (the search, or the add form's empty field).
 *  Opened from inside another dialog (the cart sheet below 1024px, the payment sheet), that dialog pulls a plain
 *  autoFocus back before this one traps the focus, and Radix would then focus the first control in the head (the ✕). */
function focusMarkedField(e: Event) {
  const field = e.currentTarget instanceof HTMLElement ? e.currentTarget.querySelector<HTMLElement>("[data-autofocus]") : null;
  if (!field) return;
  e.preventDefault();
  field.focus();
}

export function CustomerSearch({ value, onChange, className, disabled, trigger, context }: CustomerSearchProps) {
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
  // The no-match line's case (the same chain as the line itself below): the caption sits over it too (ruling P31).
  const noMatches =
    !searching && !isPaused && !isError && debounced.trim().length >= CUSTOMER_SEARCH_MIN_CHARS && rows.length === 0;

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
                {context && (
                  <div data-ui="cs-context" className={SUB_CLASS}>
                    {context}
                  </div>
                )}
                <DialogPrimitive.Description className="sr-only">{SEARCH_HINT}</DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close data-ui="cs-close" aria-label="Close" className={CLOSE_CLASS}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </DialogPrimitive.Close>
            </div>

            {adding ? (
              <CustomerAddForm
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
                {(rows.length > 0 || noMatches) && (
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
