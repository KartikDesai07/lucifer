# Settings → Rewards & loyalty in the new UI (plan)

**The owner's ask (2026-11-09, s108):** they deployed main d0f5a86 and checked Settings > Appearance on phone, tablet
and PC: all fine. Next settings page picked: **Loyalty** (AskUserQuestion, the Recommended option).

**Decisions (from the Business, Taxes, QR and Appearance pages, which the owner chose; no new question):**
- **Layout:** the QR ordering layout. One column of cards at every width (`SETTINGS_STACK_CLASS`), no preview. The page
  stays `wide`: the stamp boxes fill the row (the reason it was made wide).
- **Cards:** today's five groups, one card each: Diner accounts · Stamp card · Rewards · Scratch cards · Levels (Levels
  only once a scratch-card setup exists, as today).
- **Scope:** the page and the files that draw those cards:
  `LoyaltyCard.tsx`, `LoyaltyStampGrid.tsx`, `LoyaltyStampBox.tsx`, `rewards/RewardLevelsSection.tsx`,
  `rewards/RewardLevelGrid.tsx`, `rewards/RewardStarterButtons.tsx`, plus a `look="card"` option on
  `rewards/RewardNumberField.tsx` (the side panels and the Festival cards keep the old field).
  Out of scope: the two side panels' bodies (`MilestoneRewardFields`, `RewardSlotSheet` / `RewardSlotEditor` and the
  rest of `rewards/`), which keep their look.
- **Kit:** `SettingsSwitchRow` gains `disabled` (the stamp card switch locks while sign-in is off; the scratch-card
  switch locks while blocked), and `SETTINGS_NOTE_CLASS`: the quiet notice box (Scratch-card levels are on, blocked,
  unreadable, copy notes, position warning) on the list-row colours.

**Base:** `main` d0f5a86. Branch `feat/ui-settings-loyalty`.

**Rules:** as in `2026-11-06-settings-business-ui.md`:
- **UI only:** the same Controllers, `register` calls, field names, watches, words, hints, ids, aria wiring, disabled /
  checked rules (stamp switch: off and locked while sign-in is off; scratch switch: `!switchable || (blocked && off)`),
  the levels draft (`levels.extra`, one Save bar, one PUT), every side panel, confirm and close rule.
- Tokens only. No `brand-*` / `BRAND_*`, `color-mix()`, `/NN` colour opacity, `light-dark()` or `backdrop-blur`;
  `overflow-clip`, never the hidden one. WebView 109 safe.
- 42 px controls we own. The stamp boxes keep their square size.
- Every raw `<button>` and kit `<Button>` in the owned files is `type="button"`, written FIRST (auto-memory
  settings-card-restyle-buttons-and-heading-levels).
- Headings: the cards are h2; "Level N" in the Levels card becomes h3 (it was h4 under the old h3 group). No h4-h6.
- Classes are pinned on their own element, never "somewhere in the file".
- Files ≤ 300 lines; pins move only on purpose.

## The slice (main thread; one page, interdependent files)

- **Kit:** `SETTINGS_NOTE_CLASS` in `lib/settings-card-layout.ts`; `SettingsSwitchRow` `disabled?: boolean` →
  `MenuSwitch disabled` + the row `cursor-not-allowed`.
- **page.tsx:** `saveBarLook="card"`; the root is `<div className={SETTINGS_STACK_CLASS}>` around the same three parts.
- **LoyaltyCard:** two `SettingsCard`s; `ToggleRow` → `SettingsSwitchRow`; `Field` → `CardField`; inputs on
  `SETTINGS_INPUT_CLASS`; the three fields `grid items-start gap-4 sm:grid-cols-2`; the levels note on the note class.
- **LoyaltyStampGrid:** the Rewards `SettingsCard`; the array error `SETTINGS_ERROR_CLASS`; the two empty boxes
  `SETTINGS_LIST_EMPTY_CLASS`; hints `SETTINGS_HINT_CLASS`; the panel footer rule `border-border-2`, Remove reward on
  `text-status-bad-ink`.
- **LoyaltyStampBox:** a reward box `border-primary bg-status-info-tint`, an empty one dashed `border-subtle-foreground`,
  an error `border-solid border-status-bad`, the focus ring `FLOOR_FOCUS_RING_CLASS`, radius 10.
- **RewardLevelsSection:** two `SettingsCard`s; the switch a `SettingsSwitchRow`; notes on the note class; Start over
  (unreadable) and Dismiss the kit outline Button with `SETTINGS_OUTLINE_BUTTON_CLASS`; Start over (danger) a raw button
  with `SETTINGS_REMOVE_BUTTON_CLASS`; Add a level a raw button with `SETTINGS_ADD_BUTTON_CLASS`; the min bill
  `look="card"`.
- **RewardLevelGrid:** "Level N" an h3 in `SETTINGS_BLOCK_TITLE_CLASS`; Boxes `look="card"`; Remove level a raw button
  with `SETTINGS_REMOVE_BUTTON_CLASS` (a 42 px square); error, empty and hint on the kit classes.
- **RewardStarterButtons:** the outline look on the kit tokens; words unchanged.

**Pins moved on purpose:** `loyalty-settings-paths.test.ts` (column, groups → cards, ToggleRow → SettingsSwitchRow,
inputs, Rewards card, box colours, save note), `reward-levels-ui-paths.test.ts` (column, switch row; the 44 px ToggleRow
pin stays as it is: ToggleRow still serves Bill print and the others), `reward-levels-unlock.test.ts` (switch row, note
class), `settings-business-layout.test.ts` (scope adds Loyalty), `settings-card-layout.test.ts` (note class, disabled
row). New `lib/settings-loyalty-layout.test.ts`: shell, card order / titles / subs, notes, buttons type-first, headings,
bans, line budget.

**Verify:** in `apps/cafe`: the touched suites, `npm test`, `npm run typecheck`, `npx eslint` on the touched files;
mutants; SSR + CSS shots at 390 / 820 / 1280 if RAM allows; one fresh read-only review.

## Results

**Built (2026-11-09, s108, branch `feat/ui-settings-loyalty` off `main` d0f5a86).** Rewards & loyalty is now five cards
in one column: Diner accounts · Stamp card · Rewards · Scratch cards · Levels (Levels only once a scratch-card setup
exists). The page keeps its wide shell and uses the card Save bar.
- The three switches are kit `SettingsSwitchRow`s. The kit row gained `disabled`, and the two locks pass through it
  unchanged: the stamp card while sign-in is off, and scratch cards while locked or blocked-and-off.
- The quiet notes (levels on, blocked, unreadable, copy notes, position warning) use the new `SETTINGS_NOTE_CLASS`.
  Errors, empty boxes, hints and labels use the kit classes.
- The stamp / level boxes use the tile colours. "Level N" is an h3 under the Levels card's h2.
- `RewardNumberField` has `look="card"` for the minimum bill and a level's box count. The side panels and the festival
  cards keep the old field.
- All 12 buttons in the owned files are `type="button"`, written first.
- Done in the main thread: one interdependent page, and Sonnet agents were blocked last session.
- A before / after script compared every prop value and JSX text run outside class names in the 9 component files
  against HEAD. Only the intended renames differ: `ToggleRow` → `SettingsSwitchRow`, `description` → `sub`,
  `onChange` → `onCheckedChange`, the kit ghost `Button` → a raw button, `look="card"`, `saveBarLook`, and `disabled`
  passed through.

**Verify** (sequential, measured after the last edit):
- shared: tsc 0; 1079 / 1079.
- cafe: tsc 0; lint 0 errors (2 warnings, both in `lib/masters-blob.test.ts`, which this change does not touch);
  8204 / 8204.
- hub: tsc 0; lint 0; 288 / 288.
- Mutants: 25 of 25 deliberate breaks caught, every file restored byte for byte.
  - The first pass missed 1: the side panel's "Remove reward" losing its red. That button's class is now pinned on the
    button itself.
  - After the review fixes: the stamp box pins read the box button's own class list, and the ban scan reads raw bytes,
    so a banned class in a comment fails it (mutant 25).

**Review.** One fresh read-only reviewer (opus): no defects in behaviour, form submission, layout / tailwind-merge or
accessibility; 3 LOW pin findings, all fixed:
- `loyalty-settings-paths.test.ts` had grown by a line. It is back to 336 lines; it was already over the 300-line cap
  before this change, and it stays out of the new budget list for that reason.
- The ban scan read comment-stripped source; it now reads raw bytes.
- The stamp box classes were matched anywhere in the file; they are now matched inside the box button's own class list.
- The reviewer had no shell, so the before / after check above was run in the main thread.
- The tree hash was the same before and after the review.

**Look:** no screenshots this session; the low-RAM box had no harness ready, and the pins cover classes, not pixels.

**Still open:** the owner's device look on phone, tablet and PC (stamp boxes, a locked switch, the scratch-card cards
with and without a setup). The owner deploys from his admin panel.
