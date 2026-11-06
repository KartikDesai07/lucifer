# Settings → Business details in the new UI (plan)

**The owner's ask (2026-11-06):** "product new UI review karo, understand karo, and setting ka first business details wala
page kese new design ke base pe mobile, tablet and pc sab me proper way me manage kar sakte hai dekho and implement karo.
easy to use and easy to understand." There is no owner HTML for Settings (the Olivea mock-up has a Settings nav row
only), so the page takes the shipped new language: U0 tokens + the U5 item editor's field look
(`lib/menu-editor-layout.ts`) + the U5/U6 card look.

**The owner's decisions (AskUserQuestion, 2026-11-06, all Recommended):**
- **D1 layout:** cards, and on a PC (1280 px and up) a sticky **Bill preview** column on the right; tablet and phone:
  one column, the preview right after the Contact card.
- **D2 groups:** five clear groups instead of seven: Restaurant · Contact & licence · UPI payments · Screens · App
  branding (+ the Bill preview). Only where things sit on the page changes; the saved data and the one PUT stay.
- **D3 scope:** the Business page only. New settings card pieces are made now and used only here; the other 8 settings
  pages keep today's look until their own session. The shared Save bar gets an opt-in `look="card"` (default = today's).

**Base:** `main` fff1e22. Branch `feat/ui-settings-business`.

## Rules (from the UI redesign plan, `2026-10-16-ui-redesign.md`, held here)

- **UI only:** no change to `app/api`, `models`, `packages`, `hooks` logic, the form's fields/validation/requests, the
  route or its AdminGuard. `SETTINGS_SECTIONS.business.fields` unchanged. Every field keeps its `register`/`Controller`
  name, its parsing (valueAsNumber, NaN blanks, the No limit sentinel) and its error text.
- **Words** stay unless listed here. Changed: the section's description (hub card + header line) →
  "Name, logo, contact, UPI payments and screen options."; new card/block titles and subs listed below.
- **Tokens only** (`bg-card`, `bg-surface-2/3`, `border-border(-2)`, `text-foreground`, `text-muted-foreground`,
  `text-subtle-foreground`, `bg-hover`, `primary`, `status-info-tint/ink`, `status-bad(-ink|-tint)`). No `brand-*` class
  in the new/restyled files, no `color-mix()`, no Tailwind `/NN` opacity modifier on a colour, no `light-dark()`, no
  `backdrop-blur`, `overflow-clip` (never `overflow-hidden`) for clipping. WebView 109 safe.
- **Touch & phone:** text/number inputs and select triggers 42 px with 16 px text below 720 px (`max-tab:text-base`, no
  zoom); buttons we own ≥ 42 px; a 390 px phone with no sideways scroll; hover only `pointer-fine:`.
- **No native pickers:** selects are the kit `Select` (never `<select>`).
- Files ≤ 300 lines; every new assertion carries a message; a new test file goes into `apps/cafe/package.json`
  `testChain`; pins move only on purpose, named below.

## The visual contract

All class strings live in **`apps/cafe/lib/settings-card-layout.ts`** (new), so the pins read the same constants.
Field look = the U5 editor's: re-export `MENU_EDITOR_FIELD_CLASS`, `MENU_EDITOR_LABEL_CLASS`, `MENU_EDITOR_ERROR_CLASS`,
`MENU_EDITOR_INPUT_CLASS`, `MENU_EDITOR_CELL_LEFT_CLASS`, `MENU_EDITOR_CELL_RIGHT_CLASS`, `MENU_EDITOR_NUMBER_CLASS`
from `lib/menu-editor-layout.ts` under `SETTINGS_*` names (one source for the new field look).

| Constant | Value |
|---|---|
| `BUSINESS_GRID_CLASS` | `grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start xl:gap-5` |
| `BUSINESS_MAIN_CARD_CLASS` | `xl:col-start-1` (each of the five form cards) |
| `BUSINESS_PREVIEW_CLASS` | `xl:sticky xl:top-20 xl:col-start-2 xl:[grid-row:1/span_5]` (one declaration: `row-start` + `row-span` would fight) |
| `SETTINGS_CARD_CLASS` | `min-w-0 scroll-mt-20 rounded-[12px] border border-border bg-card text-foreground` |
| `SETTINGS_CARD_HEAD_CLASS` | `border-b border-border-2 px-[18px] pt-4 pb-3.5 max-tab:px-4` |
| `SETTINGS_CARD_TITLE_CLASS` | `text-[15px] font-semibold leading-snug` (an `<h2>`: the shell header holds the `<h1>`) |
| `SETTINGS_CARD_SUB_CLASS` | `mt-0.5 text-[13px] text-muted-foreground text-pretty` |
| `SETTINGS_CARD_BODY_CLASS` | `grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 px-[18px] pt-4 pb-[18px] max-tab:px-4` |
| `SETTINGS_BLOCK_CLASS` | `grid min-w-0 scroll-mt-20 grid-cols-[minmax(0,1fr)] gap-3 border-t border-border-2 pt-4 first:border-t-0 first:pt-0` |
| `SETTINGS_BLOCK_TITLE_CLASS` | `text-[14px] font-semibold` (an `<h3>`) |
| `SETTINGS_BLOCK_SUB_CLASS` | `mt-0.5 text-[12.5px] text-muted-foreground text-pretty` |
| `SETTINGS_HINT_CLASS` | `text-[12.5px] leading-snug text-muted-foreground text-pretty` |
| `SETTINGS_LINK_CLASS` | `font-medium text-primary underline underline-offset-2` |
| `SETTINGS_SELECT_TRIGGER_CLASS` | `h-[42px] w-full min-w-0 rounded-[10px] border border-border bg-card px-3 text-[14.5px] text-foreground max-tab:text-base [&>svg]:text-muted-foreground [&>svg]:opacity-100` |
| `SETTINGS_UNIT_BOX_CLASS` | `flex h-[42px] w-full max-w-[200px] items-center overflow-clip rounded-[10px] border border-border bg-card focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1 has-[input[aria-invalid=true]]:border-status-bad` |
| `SETTINGS_SWITCH_ROW_CLASS` | `flex min-h-11 cursor-pointer items-center justify-between gap-3` |
| `SETTINGS_ADD_BUTTON_CLASS` | `inline-flex h-[42px] cursor-pointer items-center gap-1.5 self-start justify-self-start rounded-[10px] border border-dashed border-subtle-foreground bg-transparent px-3.5 text-[13.5px] font-semibold text-foreground pointer-fine:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50` + `FLOOR_FOCUS_RING_CLASS` |
| `SETTINGS_REMOVE_BUTTON_CLASS` | `inline-flex h-[42px] cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-0 bg-transparent px-3 text-[13.5px] font-semibold text-status-bad-ink pointer-fine:hover:bg-status-bad-tint disabled:cursor-not-allowed disabled:opacity-50` + `FLOOR_FOCUS_RING_CLASS` |
| `SETTINGS_SAVE_BAR_CARD_CLASS` | `sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[12px] border border-border bg-card px-4 py-3 [box-shadow:var(--pop)] pb-[calc(0.75rem+env(safe-area-inset-bottom))]` |
| `SETTINGS_SAVE_DISCARD_CLASS` | `h-[42px] rounded-[10px] border border-border bg-card px-4 text-[14px] font-semibold text-foreground pointer-fine:hover:bg-hover` |
| `SETTINGS_SAVE_SUBMIT_CLASS` | `h-[42px] rounded-[10px] px-5 text-[14.5px] font-semibold` |

## The page (DOM order = phone order)

`BusinessDetailsFields` root = `BUSINESS_GRID_CLASS`:
1. **Restaurant** (`BUSINESS_MAIN_CARD_CLASS`) — sub "Your name, logo and tagline. They print at the top of every bill."
   Body `grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]`: "Restaurant logo" (ImageUpload slot="logo", hint "On bills,
   kitchen tickets and the sidebar.") | "Restaurant name" + "Tagline".
2. **Contact & licence** (main) — sub "Printed under your name on bills." Address; "Contact mobile" + "FSSAI licence
   number" (hint "Printed on the bill when set.") two columns from `sm`.
3. **Bill preview** (`BUSINESS_PREVIEW_CLASS`) — sub "How the top of a bill looks. Choose which lines print in
   [Bill print]." (link `settingsSectionPath("bill-print")`, `SETTINGS_LINK_CLASS`); body `rounded-b-[12px] bg-surface-2
   p-3` around today's `BillHeaderPreview` (untouched).
4. **UPI payments** (`UpiPaymentsCard.tsx`, main) — sub "Customers scan the QR on a bill and pay to these UPI IDs."
   "UPI ID" (today's hint); block "Different UPI ID by bill amount (optional)" (`UpiRulesFields`); block "Pay QR on
   bills" (sub "When a bill prints a QR, and how long it works.") with `PayQrFields`.
5. **Screens** (`ScreensSettingsCard.tsx`, main) — sub "How the app's screens work for your staff." Blocks: "New order
   screen" (sub "How items are laid out when staff start a new order.") + `PosLayoutPicker`; `id="tables-screen"`
   "Tables screen" (sub "How the live floor flags tables.") + "Long stay alert" `[ 60 | minutes ]` with today's hint
   byte for byte; `id="screen-lock"` `title="Screen lock"` (today's sub) + "Lock the screen after no activity for" select.
6. **App branding** (main) — today's sub; "Product logo" (ImageUpload slot="productLogo", today's hint).

`business/page.tsx`: `<SettingsSectionPage slug="business" wide>` and `<SettingsSectionForm … saveBarLook="card">`.
`SettingsSectionForm` gains `saveBarLook?: SettingsSaveBarLook` → `<SettingsSaveBar look={saveBarLook}>`;
`SettingsSaveBar` gains `look?: "classic" | "card"` (default classic = today's output byte for byte), same two Buttons,
classes by look, words "Unsaved changes" / "Discard" / "Save changes".

## Pins moved on purpose

- `lib/staff-pin-ui-paths.test.ts` — the Screen lock needles now read `ScreensSettingsCard.tsx` (the block moved there, D2).
- `lib/floor-tile-slot.test.ts` — the Long stay hint now read from `ScreensSettingsCard.tsx` (same words).
- `lib/settings-upi-rules.test.ts` — "renders the slab editor" now reads `UpiPaymentsCard.tsx`.
- `lib/settings-shell-paths.test.ts` §7 — the submit Button's `className={…}` may be any expression (the look lookup).
- New `lib/settings-business-layout.test.ts` — the order of the cards, the preview placement, the anchors, the words,
  the WebView/P1 bans and the 16 px phone text, and that no other settings page passes `saveBarLook`.

## Verify

In `apps/cafe`: the touched suites, then `npm test`, `npm run typecheck`, `NODE_OPTIONS=--max-old-space-size=6144 npx
eslint .`. Look: SSR/browser shots at 390, 820, 1024, 1280 (sidebar open and collapsed) when RAM allows (free RAM check
first). Then one fresh read-only review; then the owner's device look.

## Results

**Built (2026-11-06, branch `feat/ui-settings-business` off `main` fff1e22).** The page is the six cards above, in that
DOM order. From 1280 px the Bill preview is a 340 px sticky column; below that it is one column, with the preview after
Contact & licence. Every field keeps its name, parsing, id, error text and words. The other 8 settings pages are
untouched: the classic Save bar's class string is byte-identical to HEAD.

**Changes beyond the plan:**
- **Duplicate ₹ removed.** The slab amount's box has no "₹" cell, because the label "Bills up to ₹" already shows it.
- **No limit switch.** It is described by its line again: `MenuSwitch` gains an optional `aria-describedby`. The old
  `ToggleRow` had this.
- **Top-aligned rows.** Contact mobile's box sat lower than FSSAI's at 640 px and up: a stretched grid row gave its spare
  height to the label row. Both side-by-side rows now use `sm:items-start`, pinned.
- **Pins split.** They are in two files, `lib/settings-card-layout.test.ts` (constants and render) and
  `lib/settings-business-layout.test.ts` (page, words, anchors, bans and scope), each under 300 lines. Both are in
  `testChain`.

**Verify** (in `apps/cafe`):
- `npm test`: 7866 tests, 7866 pass, 0 fail, exit 0.
- `npm run typecheck`: clean.
- `npx eslint .`: 0 errors. The 2 warnings are already on `main`, in the untouched `lib/masters-blob.test.ts`.

**Look.** The page was rendered with SSR and the compiled app CSS, then shot in headless Chrome through the DevTools
protocol at exact widths, without mobile emulation:
- 390, 820, 1024 and 1280 px (sidebar open and collapsed) have no sideways scroll (`scrollWidth = clientWidth`).
- The card order is correct at every width.
- At 1280 px the preview sits at column 2, row 1. Scrolled 1400 px, it holds at 80 px from the top.

**Review.** One fresh read-only reviewer found no defects in its six areas. It raised two possible regressions, and both
were checked against HEAD:
- **Classic Save bar:** identical to HEAD.
- **`field.ref`:** the Controller-driven number boxes (Minutes valid, slab amount) do not connect `field.ref`, so
  Save-time `setFocus` cannot focus them. HEAD did not connect it either, so this is not a regression. It is left as a
  possible follow-up.

**Still open:** the owner's look on a real device (phone, tablet and PC), and posdemo, which the owner deploys
themselves.
