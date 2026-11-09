# Settings → Tokens & numbering in the new UI (plan)

**The owner's ask (2026-11-09, s109):** they deployed main afb1cbb and checked Settings > Rewards & loyalty on phone,
tablet and PC: all fine. Next settings page picked: **Tokens** (AskUserQuestion, the Recommended option).

**Decisions (from the Business, Taxes, QR, Appearance and Loyalty pages, which the owner chose; no new question):**
- **Layout:** the Business / Taxes / Appearance preview layout. One column of cards; from 1280 px the "Slip preview"
  card is a sticky 340 px column on the right that scrolls inside itself. Below that it comes last, under the
  "See the slip" jump link. The form cards sit in ONE stack in column 1 (the design editor adds 1 or 3 cards, so the
  preview cannot span a fixed number of rows like Appearance's). The page stays `wide`, with the card Save bar.
- **Cards:** Tokens · Daily restart time · Ready tokens · Token slip design (+ Lines on the token slip, Font and text
  size once a design is customized) · Slip preview.
- **Scope:** the page, `TokenSettingsFields.tsx`, `print-design/TokenDesignSection.tsx`, and a `look="card"` option
  on the shared `print-design/DesignSection.tsx` (its three groups become cards; its notices, alert, hint and buttons
  take the kit look). Bill print and Kitchen ticket keep the old look (the default) until their own session.
  Out of scope (shared with Bill print / Kitchen ticket, restyled with them): the gallery tiles (`DesignCard`), the
  line editor (`BlockEditor` / `BlockRow` / `BlockOptionsSheet`), `FontPicker`, `PrintSizeChoice`, `PreviewLoadNotice`.
  The paper slips (`TokenSlipPreview`, the gallery thumbnails) stay paper, as on the Business page.
- **Now Serving hint:** moves from between the groups into the Tokens card, under the start number
  (`now-serving-paths.test.ts` moves with it). The `NowServingLink` itself is unchanged (the Kitchen header shares it).
- **Kit:** `SETTINGS_ALERT_CLASS` (the red-ruled warning box: no bill printer, an unreadable design) and
  `TOKENS_PREVIEW_CLASS`.

**Base:** `main` afb1cbb. Branch `feat/ui-settings-tokens`.

**Rules:** as in `2026-11-06-settings-business-ui.md`:
- **UI only:** the same Controllers, `register` call, field names, option lists from the SAVED values, words, hints,
  ids, aria wiring, the one form + `extra={design.extra}`, every confirm and draft rule. Nothing flips a setting.
- Tokens only (no `brand-*` / `BRAND_*`, `color-mix()`, `/NN` colour opacity, `light-dark()`, `backdrop-blur`,
  `overflow-hidden`) in the owned Tokens files; `DesignSection`'s default look is byte-for-byte today's classes.
- 42 px controls. Every raw `<button>` and kit `<Button>` in the owned files is `type="button"`, written FIRST.
- Headings: the cards are h2; no h3-h6 in the owned files.
- Classes are pinned on their own element. Files ≤ 300 lines; pins move only on purpose.

**Pins moved on purpose:** `tokens-settings-paths.test.ts` (groups → cards, hint class), `print-setup-fields.test.ts`
(the no-KOT hint class), `now-serving-paths.test.ts` (the hint lives in the Tokens card), `print-design-editor-paths
.test.ts` (recovery buttons per look), `settings-business-layout.test.ts` (scope adds Tokens), `settings-card-layout
.test.ts` (alert + preview classes). New `lib/settings-tokens-layout.test.ts`.

**Verify:** in `apps/cafe`: the touched suites, `npm test`, `npm run typecheck`, `npx eslint` on the touched files;
the default look of `DesignSection` diffed against HEAD; mutants; one fresh read-only review (diff file + HEAD copies).

## Results

**Built (2026-11-09, s109, branch `feat/ui-settings-tokens` off `main` afb1cbb).** Tokens & numbering is now cards: Tokens
· Daily restart time · Ready tokens · Token slip design (+ Lines on the token slip, Font and text size once customized)
in one stack, beside the sticky "Slip preview" card from 1280 px (below that it comes last, under "See the slip"). The
page keeps its wide shell and uses the card Save bar.
- The token switch is a kit `SettingsSwitchRow`, the two times are kit `SettingsSelect`s (options still from the SAVED
  values), and the start number is on `SETTINGS_INPUT_CLASS`. All three controls are 240 px wide at most (`max-w-60`).
- The no-bill-printer warning uses the new `SETTINGS_ALERT_CLASS`. The Now Serving hint now sits in the Tokens card, under
  the start number (the `NowServingLink` itself is unchanged).
- `DesignSection` gained `look="card"` + `note`, from one `LOOKS` table and a `Part` wrapper. The old look is the default:
  Bill print and Kitchen ticket render **byte-identical HTML to HEAD** (24/24 states: bill / ticket / token kinds × draft
  none / active × unreadable × notices; dnd-kit's global id counter normalized).
- A before / after script compared every string literal, JSX text run and key prop outside class names in the 3 Tokens
  files. Only the intended renames show (ToggleRow `onChange` → `onCheckedChange`, the hint's move, `saveBarLook`,
  `look`, the width constant, the old preview panel class).
- Out of scope, as planned: the gallery tiles, line editor, font / size pickers, `PreviewLoadNotice`, paper slips.

**Pins:** new `lib/settings-tokens-layout.test.ts` (9 tests: shell + stack close, cards in order, hints / warning / Now
Serving on their own elements and inside the Tokens card, the `LOOKS` table both ways, a real render of both looks,
buttons type-first (6), no raw headings, bans incl. WebView bans on the shared section, line budget). Moved on purpose:
`tokens-settings-paths` (groups → cards, hint class, form tag), `token-design-editor-paths` (form tag),
`print-design-editor-paths` (recovery class per look), `now-serving-paths` (hint in the Tokens card),
`print-setup-fields` (hint class), `settings-business-layout` (scope adds Tokens), `settings-card-layout` (alert +
preview classes).

**Checks:** touched suites green; cafe `npm test` 8213/8213 (8204 + 9); tsc 0; eslint 0 on the touched files.
Mutation pass 24/24 caught (first run showed `overflow-hidden` in the shared section's card look would survive, so the
WebView bans were extended to `DesignSection` before the pass; the tree was restored byte-for-byte). One fresh opus
review (diff file + HEAD copies): no findings in all five areas (behaviour, layout, DesignSection default look, pin
blindness, repo rules). Not measured: real-browser sticky / 360 px layout (the owner's device pass).
