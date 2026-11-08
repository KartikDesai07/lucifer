# Settings → GST & taxes in the new UI (plan)

**The owner's ask (2026-11-08):** after the main pull (aab2a63, deployed by the owner) the owner picked "Settings > Taxes
naya UI" as the next task: the same card design as Business details, for phone, tablet and PC.

**Decisions (from the Business page's, 2026-11-06, which the owner chose; no new question):**
- **Layout:** cards. On a PC (1280 px and up) the sample bill is a sticky 340 px column on the right; tablet and phone
  get one column with the sample bill last, as today.
- **Groups:** today's five, one card each: GST · How prices work · GST rate · GST number · Bill preview. With GST off,
  only the GST card shows (as today). It stays in the left column, so it does not jump when GST is switched on.
- **Scope:** the Taxes page, plus three small pieces shared with Business details:
  - the grid constants get page-neutral names;
  - one `SettingsSwitchRow` serves both Charge GST and Pay QR's No limit;
  - the choice-tile classes are shared by the GST mode tiles and the New order layout tiles.

**Base:** `main` aab2a63. Branch `feat/ui-settings-taxes`.

**Rules:** as in `2026-11-06-settings-business-ui.md`:
- UI only: the same fields, parsing, ids, words and the one PUT.
- Tokens only; WebView 109 safe.
- 42 px controls, with 16 px text below 720 px.
- The kit pieces only.
- Files ≤ 300 lines; pins move only on purpose.

**What it looks like:**

**`lib/settings-card-layout.ts`:**
- `BUSINESS_GRID_CLASS` → `SETTINGS_PREVIEW_GRID_CLASS`, same value.
- `BUSINESS_MAIN_CARD_CLASS` → `SETTINGS_MAIN_CARD_CLASS`, same value.
- New `TAXES_PREVIEW_CLASS`: `xl:sticky xl:top-20 xl:col-start-2 xl:[grid-row:1/span_4]`.
- The choice tile: `SETTINGS_TILE_CLASS` / `_ON_` / `_OFF_`, plus the radio dot. These are today's New order layout
  strings.
- The GST rate chips: `SETTINGS_CHIP_CLASS` / `_ON_` / `_OFF_`: 42 px, radius 10, the selected chip with the primary
  border on the info tint.

**`SettingsCard.tsx` gains `SettingsSwitchRow`:**
- The whole row is the label.
- The `MenuSwitch` is named by the label and described by its line.
- Pay QR's No limit row uses it, with the same words.

**`GstFields.tsx`:**
- The root is the preview grid.
- Charge GST is a `SettingsSwitchRow`.
- The mode picker keeps its `Controller` line.
- The rate chips keep `aria-pressed` and the `setValue(…, { shouldDirty, shouldValidate })` call.
- "Other rate" becomes a `[ 5 | % ]` unit box: a bare input with `inputMode="decimal"`, `step="0.5"`, 0–100,
  `register("gstRate", { valueAsNumber: true })`, and `aria-invalid` while it has an error.
- The GSTIN field uses the U5 input look and keeps its placeholder and `autoCapitalize`.
- The Bill preview card has a `bg-surface-2` body around today's `GstSampleBill`, which is untouched (paper).

**`GstModePicker.tsx`:**
- Tokens: the tile classes, and the example box `bg-surface-2` with `overflow-clip`.
- The words, ids and aria wiring are unchanged.

**`taxes/page.tsx`:** `<SettingsSectionPage slug="taxes" wide>` and `saveBarLook="card"`.

**Pins moved on purpose:**
- `settings-card-layout.test.ts`: the renamed constants and the new ones; `SettingsSwitchRow` render.
- `settings-business-layout.test.ts`:
  - the renamed needles;
  - the No limit row is a `SettingsSwitchRow`;
  - the scope list is Business and Taxes.
- `tokens-settings-paths.test.ts`: the sibling landmark drops the closing `>`.
- New `lib/settings-taxes-layout.test.ts`:
  - the card order and the GST-on gate;
  - the preview placement;
  - the words and ids;
  - the bans and the line budget.

**Verify:**
- In `apps/cafe`: the touched suites, then `npm test`, `npm run typecheck` and `npx eslint .`.
- The SSR + compiled CSS + CDP shots at 390 / 820 / 1024 / 1280, with GST on and with GST off.
- One fresh read-only review.

## Results

**Built (2026-11-08, branch `feat/ui-settings-taxes` off `main` aab2a63).** GST & taxes is now five cards: GST · How
prices work · GST rate · GST number · Bill preview.
- With GST off, only the GST card shows, in the left column.
- From 1280 px the sample bill is a 340 px sticky column; below that it comes last in one column.
- Every field keeps its name, parsing (`valueAsNumber`, `inputMode="decimal"`, `step="0.5"`, 0–100), id, error text
  and words. The rate chips keep `aria-pressed` and the same `setValue` call.
- Shared with Business details:
  - the grid constants are renamed (same values);
  - one `SettingsSwitchRow` serves Charge GST and Pay QR's No limit, with the same sentinel rule;
  - one set of tile classes serves both tile pickers. All 7 tile classes are byte-equal to the old New order layout
    strings, checked against HEAD.

**Verify** (in `apps/cafe`):
- `npm test`: 8091 tests, 8091 pass, 0 fail.
- `npm run typecheck`: clean.
- `npx eslint .`: 0 errors. The 2 old warnings are in the untouched `lib/masters-blob.test.ts`.
- Mutants: 6 of 6 deliberate breaks caught, plus the 2 the review asked for (the switch moved outside its label; the
  GST gate closed above the sample bill). Every file was restored byte for byte.

**Look.** SSR with the compiled CSS, then CDP exact-width shots:
- At 390 / 820 / 1024 / 1280 with GST on, at 390 / 1280 with GST off, and Business at 390 / 1280: no sideways scroll,
  the right order, and at 1280 the sample bill at column 2, row 1.
- On a phone the rate chips wrap to two rows.

**Review.** One fresh read-only reviewer found no behaviour defects in its six areas. It found two LOW pin gaps; both
were fixed, and each new assertion was mutation-proven:
- The `SettingsSwitchRow` render now proves the switch sits inside its label.
- The GST-on gate pin now proves the gate closes after the sample bill.

**Still open:** the owner's merge OK and their device look; the owner deploys from his admin panel.
