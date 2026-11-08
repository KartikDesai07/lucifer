# Settings → QR ordering in the new UI (plan)

**The owner's ask (2026-11-08, s106):** they deployed main 59013b3 and checked Business details and GST & taxes on
phone, tablet and PC: all fine. Next settings page picked: **QR ordering** (AskUserQuestion, the Recommended option).

**Decisions (from the Business and Taxes pages, which the owner chose; no new question):**
- **Layout:** cards in one column at every width. The page has no preview, so it stays in the narrow shell
  (`max-w-3xl`, no `wide`) and uses the card Save bar.
- **Groups:** today's four, one card each: Ordering · Tables · Promo codes · Announcements.
- **Scope:** the QR ordering page, plus small shared kit pieces:
  - `SETTINGS_STACK_CLASS`: the one-column page;
  - `SettingsChoice`, a one-of-a-few choice in the card look (the promo Discount type);
  - one list-row look: the UPI slab row's class moves into the kit (same value) and also serves promo codes and
    announcements, along with a row title and an empty-list box.

**Base:** `main` 59013b3. Branch `feat/ui-settings-qr`.

**Rules:** as in `2026-11-06-settings-business-ui.md`:
- **UI only:**
  - the same fields, `register`/`Controller` names, parsing, ids, words, error text, the confirm-before-remove
    rules and the one PUT;
  - `SETTINGS_SECTIONS["qr-ordering"].fields` stays unchanged (`showPastOrdersToDiner` stays hidden but saved).
- Tokens only. No `brand-*`, `color-mix()`, `/NN` colour opacity, `light-dark()` or `backdrop-blur`, and
  `overflow-clip` instead of `overflow-hidden`. WebView 109 safe.
- Inputs are 42 px with 16 px text below 720 px. Buttons we own are at least 42 px.
- The kit pieces only.
- Files ≤ 300 lines; pins move only on purpose.

## Done in the main thread (before the slice)

**`lib/settings-card-layout.ts`:**
- `SETTINGS_STACK_CLASS` = `grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4`.
- `SETTINGS_CHOICE_CLASS`: 42 px equal-width options, with the ring on `has-[:focus-visible]`. The selected and resting
  colours are the chip ones.
- `SETTINGS_LIST_ROW_CLASS`: the old `UpiRulesFields` `SLAB_ROW_CLASS`, byte for byte. `UpiRulesFields` now imports it.
- `SETTINGS_LIST_ROW_TITLE_CLASS` and `SETTINGS_LIST_EMPTY_CLASS`.

**`SettingsCard.tsx`:** `SettingsChoice<T>({ legend, options, value, onChange, labelOf })`:
- a `fieldset` whose legend is in the label look;
- each option is a label around an `sr-only` native radio, and all radios share one `useId` name.

**`settings-card-layout.test.ts`:**
- the new constants;
- a `SettingsChoice` render: one label per radio, one shared name, only the selected radio checked.

## The slice (one implementer)

**`app/(dashboard)/settings/qr-ordering/page.tsx`:**
- `<SettingsSectionPage slug="qr-ordering">`, still not `wide`.
- `saveBarLook="card"`.
- The root is `<div className={SETTINGS_STACK_CLASS}>`, with the same three children in the same order and the same
  `dinerAccountsOn` prop.

**`SelfOrderCard.tsx`:** two `SettingsCard`s, using today's group titles and lines as title and sub.
- **Ordering:** the mode tiles move onto the shared tile classes:
  - `cn(SETTINGS_TILE_CLASS, MODE_TILE_CLASS, on/off)`, with a local `MODE_TILE_CLASS = "min-h-11 flex-row items-start
    gap-3"`;
  - the drawn radio is `mt-0.5` plus the `SETTINGS_TILE_RADIO_*` classes and `SETTINGS_TILE_DOT_CLASS`;
  - the label is a literal 14 px semibold `text-foreground` class, and the badge and description use tokens;
  - the copy Record, the ids and the aria wiring are unchanged.
- **Tables:** a `SettingsSwitchRow` with today's words. `checked={field.value}`.

**`PromoCodesFields.tsx`:** a `SettingsCard` titled "Promo codes", with today's line as its sub.
- The array error uses `SETTINGS_ERROR_CLASS` with `role="alert"`.
- The empty list uses `SETTINGS_LIST_EMPTY_CLASS`.
- Add is a `<button className={SETTINGS_ADD_BUTTON_CLASS}>` with the same append payload and `disabled={atMax}`. The
  at-max hint uses `SETTINGS_HINT_CLASS`.
- The `ConfirmDialog` and the remove flow are untouched.

**`PromoCodeRow.tsx`:**
- The row uses `SETTINGS_LIST_ROW_CLASS`, with an h4 in `SETTINGS_LIST_ROW_TITLE_CLASS`.
- Remove is a `<button>` with `cn(SETTINGS_REMOVE_BUTTON_CLASS, "shrink-0")`, a Trash2 icon and the visible text
  Remove. It keeps the same aria-label and onClick.
- `Field` becomes `CardField`. Code uses `SETTINGS_INPUT_CLASS` and gains `aria-invalid`.
- The Type is `<SettingsChoice<PromoKind> legend="Discount type" …>`. The read-only branch is a `CardField` holding a
  42 px text line.
- Discount and Minimum order:
  - each is a `SETTINGS_UNIT_BOX_CLASS` box around a bare `<input className={SETTINGS_NUMBER_CLASS}>`, the same look
    as UPI slab "Bills up to ₹" (the unit stays in the label);
  - each keeps its attributes and parsing, plus `aria-invalid`.
- The two toggles become `SettingsSwitchRow`s with today's words.

**`DinerBannersFields.tsx`:**
- The rows and Remove change as in `PromoCodeRow`. Title and details become `CardField` plus `SETTINGS_INPUT_CLASS`,
  with `aria-invalid`.
- The list is a `SettingsCard` titled "Announcements", with today's line as its sub.
- The Diner accounts note becomes `SETTINGS_HINT_CLASS` with an `AppLink` to `settingsSectionPath("loyalty")` in
  `SETTINGS_LINK_CLASS`, the same link idiom as Business.
- The empty box, Add and the hint change as in Promo codes.

**Pins moved on purpose:**
- `qr-ordering-settings-paths.test.ts`:
  - ToggleRow → SettingsSwitchRow;
  - SettingsGroup → SettingsCard;
  - PrintSizeChoice → SettingsChoice;
  - Field → CardField;
  - `</Button>` → `</button>`;
  - the dashed empty state and the 44 px Add button → the kit constants;
  - the note's link → AppLink;
  - the `space-y-6` wrapper → `SETTINGS_STACK_CLASS`.
- `settings-business-layout.test.ts`: the scope list becomes Business, Taxes and QR ordering.
- New `lib/settings-qr-layout.test.ts`:
  - the page shell and order;
  - the card titles and subs;
  - the tile, row and switch looks;
  - the words, ids and input attributes;
  - the bans and the line budget.

**Verify:**
- In `apps/cafe`: the touched suites, then `npm test`, `npm run typecheck` and `npx eslint .`.
- Mutants.
- The SSR + compiled CSS + CDP shots at 390 / 820 / 1280: empty lists, then one promo code and one announcement.
- One fresh read-only review.

## Results

**Built (2026-11-08, s106, branch `feat/ui-settings-qr` off `main` 59013b3).** QR ordering is now four cards in one
column: Ordering · Tables · Promo codes · Announcements. It uses the narrow shell and the card Save bar.
- Every field keeps its name, parsing, id, words and error text:
  - promo value keeps `valueAsNumber`;
  - Minimum order: blank still means none;
  - Code is still uppercased;
  - `showPastOrdersToDiner` is still hidden but saved.
- The confirm-before-remove rules and the append payloads are byte-identical.
- The promo Discount type is the new `SettingsChoice`; each row has its own radio group.
- Discount and Minimum order sit in unit boxes, the same look as the UPI slab amount.
- The three on/off rows are `SettingsSwitchRow`s.
- UPI slabs, promo codes and announcements share one row look (`SETTINGS_LIST_ROW_CLASS`, the old slab value byte for
  byte).

**Verify** (in `apps/cafe`):
- `npm test`: 8102 tests, 8102 pass, 0 fail. That run came before the review fix below; the touched suites were then
  re-run: 128 / 128.
- `npm run typecheck`: clean.
- `npx eslint .`: 0 errors. The 2 old warnings are in the untouched `lib/masters-blob.test.ts`.
- Mutants: 13 of 13 deliberate breaks caught, every file restored byte for byte. The first pass missed 2: an Add or
  Remove button switched to `type="submit"`. A new pin now requires every `<button>` in the three list files to be
  `type="button"`. It catches those 2, plus a button with no type at all.

**Look.** SSR with the compiled CSS, then CDP exact-width shots:
- empty lists at 390 / 1280;
- one promo code, one stored Free item code and one announcement at 390 / 820 / 1280;
- in every shot: no sideways scroll and the right card order;
- on a phone everything is one column; from `sm` Code sits beside Discount type, and Discount beside Minimum order.

**Review.** One fresh read-only reviewer found no HIGH or MED defects. Clean in all four areas: hidden behaviour
changes, accessibility, Tailwind merge and pin quality. It found one LOW, which was fixed test first:
- The row titles were h4 under the card's h2 (the old group heading was an h3).
- They are now h3, the same level as `SettingsBlock`.
- The new pin failed before the fix.

**Still open:** the owner's device look on phone, tablet and PC; the owner deploys from his admin panel.
