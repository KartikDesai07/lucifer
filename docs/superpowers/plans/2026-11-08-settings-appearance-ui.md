# Settings → Appearance in the new UI (plan)

**The owner's ask (2026-11-08, s107):** they deployed main 59a2060 and checked Settings > QR ordering on phone, tablet
and PC: all fine. Next settings page picked: **Appearance** (AskUserQuestion, the Recommended option).

**Decisions (from the Business, Taxes and QR pages, which the owner chose; no new question):**
- **Layout:** the Taxes layout. Cards in one column; from 1280 px the menu preview is a sticky 340 px column on the
  right, spanning the four form cards, and it scrolls inside itself (it can be taller than the screen). Below 1280 px the
  preview comes last, and the "See the preview" jump link sits at the top (hidden from 1280 px). Today the preview
  column starts at 1024 px; it now starts at 1280 px like Business and Taxes.
- **Cards:** today's five groups, one card each: Theme · Button colour · Text and layout · Banner picture · Preview.
- **Scope:** the Appearance page and its six files, plus small kit pieces:
  - `APPEARANCE_PREVIEW_CLASS`: the Taxes preview class plus `xl:max-h-[calc(100dvh-11rem)] xl:overflow-y-auto`
    (today's column already scrolls inside itself);
  - `SETTINGS_BUTTON_CLASS` / `SETTINGS_OUTLINE_BUTTON_CLASS`: the card-look kit Button, main and plain; the Save bar's
    Submit / Discard constants now alias them (same values);
  - `SettingsChoice` gains an optional `hint`, as `PrintSizeChoice` has (in the fieldset, after the options, describing
    the group).
  - `PrintSizeChoice` itself is untouched: the Bill print and Kitchen ticket pages still use it.

**Base:** `main` 59a2060. Branch `feat/ui-settings-appearance`.

**Rules:** as in `2026-11-06-settings-business-ui.md`:
- **UI only:** the same seven `appearance.*` Controllers (never `register`/`setValue`), the presetId `useWatch`, the
  words, hints, ids, aria wiring, the accent picker's one-commit rule and its feedback guard, the ImageUpload props,
  and the one PUT.
- Tokens only. No `brand-*` / `BRAND_*`, `color-mix()`, `/NN` colour opacity, `light-dark()` or `backdrop-blur`, and
  `overflow-clip` instead of `overflow-hidden`. WebView 109 safe.
- 42 px controls we own (the 44 px swatches stay 44 px).
- Every raw `<button>` and kit `<Button>` in the Appearance files is `type="button"`, written as the first attribute
  (auto-memory settings-card-restyle-buttons-and-heading-levels).
- No heading below h2 is added: the cards hold fieldsets, not h3/h4.
- Files ≤ 300 lines; pins move only on purpose.

## Done in the main thread (before the slice)

- `lib/settings-card-layout.ts`: `APPEARANCE_PREVIEW_CLASS`, `SETTINGS_BUTTON_CLASS`, `SETTINGS_OUTLINE_BUTTON_CLASS`
  (the Save bar's two constants alias them).
- `SettingsCard.tsx`: `SettingsChoice` `hint?: ReactNode` → `aria-describedby` on the fieldset and a
  `SETTINGS_HINT_CLASS mt-1.5` paragraph after the options.
- `settings-card-layout.test.ts`: the new constants; a `SettingsChoice` render with a hint (and none without).

## The slice (one implementer)

**`app/(dashboard)/settings/appearance/page.tsx`:** still `wide`; `saveBarLook="card"`.

**`AppearanceFields.tsx`:** the root is `<div className={SETTINGS_PREVIEW_GRID_CLASS}>`, children in this order:
1. the jump link, same `href`, icon and words; classes
   `inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13.5px] font-semibold text-primary xl:hidden`;
2. `AppearanceThemeGroup`, `AppearanceAccentGroup`, `AppearanceTextLayoutGroup` (same props);
3. a `SettingsCard` "Banner picture" (today's line as its sub, `SETTINGS_MAIN_CARD_CLASS`) around today's Controller;
4. a `SettingsCard id="appearance-preview"` "Preview" (today's line as its sub), `className={APPEARANCE_PREVIEW_CLASS}`,
   `bodyClassName="rounded-b-[12px] bg-surface-2 p-3"` (the Taxes Bill preview body), around `AppearancePreview`.

**`AppearanceThemeGroup.tsx`:** a `SettingsCard` "Theme" with `SETTINGS_MAIN_CARD_CLASS`. Tiles:
`cn(SETTINGS_TILE_CLASS, THEME_TILE_CLASS, on/off)` with a local `THEME_TILE_CLASS = "min-h-11 min-w-0 justify-center"`;
grid `grid grid-cols-2 gap-2 sm:grid-cols-3`; dots `border-border`; the name `text-[14px] font-semibold
text-foreground`.

**`AppearanceAccentGroup.tsx`:** a `SettingsCard` "Button colour" with `SETTINGS_MAIN_CARD_CLASS`; the swatch ring
`ring-primary`; "Use the theme's colour" is the kit `Button` `variant="outline"` with `SETTINGS_OUTLINE_BUTTON_CLASS`.

**`AppearanceAccentInput.tsx`:** token swaps only: labels `SETTINGS_LABEL_CLASS`, the hex field `SETTINGS_INPUT_CLASS`,
errors `SETTINGS_ERROR_CLASS`, "Use this colour" `SETTINGS_BUTTON_CLASS` full width, the trigger and popup swatches on
`border-border` / `border-foreground` / `ring-primary`, radius 10.

**`AppearanceTextLayoutGroup.tsx`:** a `SettingsCard` "Text and layout" with `SETTINGS_MAIN_CARD_CLASS`. Font tiles on
the tile classes (local `FONT_TILE_CLASS`, still `min-h-14`), legend `SETTINGS_LABEL_CLASS`, hint `SETTINGS_HINT_CLASS`.
Corners, Spacing and Logo on the menu are `SettingsChoice` with the same props and hints; the logo hint links Business
details with `AppLink` + `settingsSectionPath("business")` in `SETTINGS_LINK_CLASS`.

**`AppearancePreview.tsx`:** "Diner's phone in" is a `SettingsChoice` (same props and hint); the frame is
`overflow-clip`. The frame's scoped diner tokens and the real `PublicMenuHeader` / `PublicMenuItem` are untouched.

**Pins moved on purpose:**
- `appearance-settings-paths.test.ts`: the grid and sticky column → the kit constants; the preview group →
  `SettingsCard`; the jump link `xl:hidden` + `text-primary`; "every SettingsGroup stacked" → five `SettingsCard`s;
  the tile colours → the kit constants; the reset button class; the status `SETTINGS_ERROR_CLASS`; `PrintSizeChoice` →
  `SettingsChoice` (Corners, Spacing, Logo, Diner's phone in); `SectionLink` → `AppLink`.
- `appearance-settings-paths-2.test.ts`: the tile grid `grid grid-cols-2 gap-2 sm:grid-cols-3`; the left-column
  first-section override is gone (no left column).
- `settings-business-layout.test.ts`: the scope list adds Appearance.
- New `lib/settings-appearance-layout.test.ts`: the page shell and card order, titles and subs, the preview placement,
  the tile and choice looks, the type="button" pin, no h3–h6, the bans and the line budget.

**Verify:** in `apps/cafe`: the touched suites, `npm test`, `npm run typecheck`, `npx eslint .`; mutants; SSR + compiled
CSS + CDP shots at 390 / 820 / 1280; one fresh read-only review.

## Results

**Built (2026-11-09, s107, branch `feat/ui-settings-appearance` off `main` 59a2060).** Appearance is now five cards:
Theme · Button colour · Text and layout · Banner picture · Preview.
- From 1280 px the menu preview is a sticky 340 px column beside the four form cards and scrolls inside itself. Below
  that it comes last, under the "See the preview" jump link.
- Every Controller keeps its `appearance.*` name and default, and the presetId watch stays. The words, hints, ids,
  aria wiring and ImageUpload props are unchanged. The accent picker still commits once per pick, and its feedback
  guard is unchanged.
- Corners, Spacing, Logo on the menu and the preview's Light / Dark are `SettingsChoice` groups, using its new `hint`.
  `PrintSizeChoice` is unchanged for Bill print and Kitchen ticket.
- All 5 buttons on the page are `type="button"`, written as the first attribute.
- The slice's implementer agent stopped part way (sonnet blocked: `oauth_org_not_allowed`). The main thread checked
  the 5 files it had finished against the spec and wrote the rest.

**Verify** (in `apps/cafe`):
- `npm test`: 8113 tests, 8113 pass, 0 fail. After that run one pin was tightened (below); its suite is 6 / 6.
- `npm run typecheck`: clean. `npx eslint` on the touched files: clean.
- Mutants: 16 of 16 deliberate breaks caught, every file restored byte for byte. The first pass missed 1: the colour
  problem line losing its error look. The pin only looked for `SETTINGS_ERROR_CLASS` anywhere in the file, and the hex
  error also uses it. The status pin now requires the class on the problem line itself.

**Look.** SSR (with a `next/font` stub) and the compiled CSS, then CDP exact-width shots at 390 / 820 / 1024 / 1280,
with the default accent and with a too-pale one:
- no sideways scroll at any width;
- at 1280 the preview is in column 2, row 1;
- below 1280 the cards come in order, with the preview last;
- the plain-English colour problem line shows under the picker row.

**Review.** One fresh read-only reviewer (opus) found nothing in any of the five areas: hidden behaviour, layout and
tailwind-merge, accessibility, pin quality, constraints. The tree hash was the same before and after.

**Still open:** the owner's device look on phone, tablet and PC; the owner deploys from his admin panel.
