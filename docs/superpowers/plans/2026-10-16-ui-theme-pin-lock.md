# The new look, staff PIN sign-in and screen lock, sidebar and dashboard (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the owner's mock-up look across the cafe app (light), a name + PIN sign-in after a first username/password
sign-in on each device, a screen-lock cover that keeps printing running, a dark sidebar, and the dashboard re-arranged,
with every feature, request, word and printed slip unchanged.

**Architecture:** the look moves through token VALUES in `apps/cafe/app/globals.css`, the kit `components/ui/*`
(restyled, same API) and a few staff-only shared components; the PIN feature adds three Staff fields, a signed httpOnly
"device memory" cookie, a second Auth.js Credentials provider (`id: "pin"`) and two small `/api/sign-in/*` routes; the
lock is a client cover portalled over the dashboard layout, so the print host, pulse and alarm under it never unmount.

**Tech stack:** Next.js 15.5 (app router), React 19, Tailwind v4 (OKLCH + the postcss RGB fallbacks), shadcn/Radix kit,
Auth.js (next-auth 5.0.0-beta.31, JWT sessions), Mongoose / MongoDB, `node:test` with `tsx`, chart.js (two charts only).

**Spec:** `docs/superpowers/specs/2026-10-16-ui-theme-pin-lock-design.md` (approved by the owner 2026-10-16, commit
`5ee556e` plus the planning findings folded in). The owner's mock-up and its renders:
`D:\kd\pos-dev-keep\ui-redesign\design\` (`olivea-pos-latest.html`, `unpacked\markup.html` for exact pixel values,
`shots\`, `shoot.mjs`). Read both before Task 1.

## Global Constraints

- UI only, except the PIN feature's files listed in spec §3.1; no route, role or `ADMIN_ROUTES` change; no change under
  `workers/`; in `packages/shared` only `src/staff-pin.ts` (new), `src/schemas/staff.schema.ts`,
  `src/schemas/settings.schema.ts`, `src/types.ts`, `src/constants.ts` (`SESSION_MAX_AGE_SECONDS` only) and their tests;
  `packages/shared/src/appearance*.ts` untouched.
- No recurring request of any kind; no `refetchInterval`, poll or prefetch added; `print-budget.test.ts` unchanged.
- The 43 files of the S1 pin (`apps/cafe/lib/printer/kot-text/text-kot-print.test.ts`) byte for byte; no slip file edited.
- WebView 109 CSS only: no `light-dark()`, `@starting-style`, `subgrid`, `@scope`, anchor positioning, popover API,
  `field-sizing`, view transitions; colours in `@theme`/`:root` as hex or OKLCH through the existing pipeline;
  `lib/css-compat.test.ts` must pass after every CSS change.
- Kit files (`components/ui/*`) and any file the diner menu reaches (`app/m/**`, `components/public/**` and what they
  import from `components/ui` and `components/shared`) use only the preset-set colour tokens (spec §3.6).
- 44 px touch targets on touch pages (`pointer-coarse:` variants); phone 390 px without sideways scroll.
- Test-used names keep their text: "Refresh", "Toggle Sidebar", "Printer …", "Open tabs (…)", "New Order", "Tables",
  "Quick links", "Main", every form label/id and aria-label listed in the tasks.
- Fonts through `next/font` only.
- Every new cafe test file goes into `apps/cafe/package.json` `"testChain"` (the runner refuses missing files); every new
  shared test file into `packages/shared/package.json` `"test"`; every new assertion carries a message (a bare
  `assert.ok(x)` hangs a big file under tsx).
- A pinned class string or test that changes is changed in the same commit, with the reason in the commit body.
- Write edit scripts with the Write tool (Bash heredocs mangle backslashes on this PC). Commit with `git commit -F <file>`
  (messages carry quotes). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Local only: no connector, upload, deploy or push; branch `feat/ui-redesign`; merge only on the owner's word.

Commands used below (Git Bash):

- one cafe test file: `cd /d/kd/lucifer/apps/cafe && node --import tsx --test lib/<name>.test.ts`
- one shared test file: `cd /d/kd/lucifer/packages/shared && node --import tsx --test src/<name>.test.ts`
- cafe chain, typecheck, lint: `cd /d/kd/lucifer/apps/cafe && npm test && npm run typecheck && npm run lint`
- shared suite: `cd /d/kd/lucifer/packages/shared && npm test`

## Review Focus

1. **A user switch while the POS cart holds unsent items:** the cart stays on screen and the next "Send" is stamped with
   the new person; nothing is lost or re-sent. Pinned in Task 15 (the cover never touches the cart hook) and checked on
   the emulator in Task 22.
2. **Lock while a sheet or dialog is open** (the printer panel, a payment dialog): the cover is above it, focus stays in
   the cover, the dialog under it cannot be tapped or typed into, and it is still there after unlock. Pinned in Task 15
   (`inert` on every other body child, z-index above Radix's `z-50`).
3. **A hidden Android/Windows app that comes back after the lock time** opens locked, and a reload while locked stays
   locked with no flash of the page. Pinned in Task 14 (wall-clock `autoLockDue`, the visibility check, the script run
   against a fake `localStorage`/`document`).
4. **A staff member deactivated, or whose PIN an admin removed or blocked, while a device remembers them:** their tile
   disappears, a PIN try answers "nopin"/"blocked", and their open session still ends within a minute as today.
   Pinned in Task 11's live leg.
5. **Two people share one PIN, and a device remembers 30+ people:** the chosen tile decides who signs in; the 31st
   person pushes out the oldest. Pinned in Tasks 9 and 10.

---

## Phase A: the theme and the kit

### Task 1: Theme tokens (light values, new tokens, the dark set)

**Files:**
- Modify: `apps/cafe/app/globals.css` (`@theme inline`, both `:root` blocks, `.dark`)
- Create: `apps/cafe/lib/theme-tokens.test.ts`
- Modify: `apps/cafe/lib/brand-contrast.test.ts` (only if a pair's name changes; values are re-measured automatically),
  `apps/cafe/lib/table-status.test.ts` (only if a measured brand token's hex changes shape), `apps/cafe/package.json`

**Interfaces:**
- Produces (CSS, read by every later task): the token names and values below, and the Tailwind colour names
  `status-{ok,warn,bad,info,bill,reserved}`, `status-<kind>-ink`, `status-<kind>-tint`, `status-{info,bill,reserved}-border`,
  `ink`, `on-ink`, `subtle-foreground`, `primary-hover`; the utility `shadow-pop`; `--radius: 0.625rem`.

- [ ] **Step 1: Write the failing test `lib/theme-tokens.test.ts`**

  Parse `app/globals.css` (the first `:root { … }` block holding `--background:` and the one holding `--brand-paper:`)
  and assert, each with a message naming the token:
  - light values: `--background #f4f4f5`, `--foreground #18181b`, `--card #ffffff`, `--popover #ffffff`,
    `--muted #f2f2f4`, `--secondary #f2f2f4`, `--muted-foreground #52525b`, `--secondary-foreground #52525b`,
    `--subtle-foreground #6b6b74`, `--border #e2e2e6`, `--input #8b8b93`, `--primary var(--brand-primary)`,
    `--primary-hover #0043ce`, `--primary-foreground #ffffff`, `--accent #edf5ff`, `--accent-foreground #0043ce`,
    `--ring var(--brand-accent)`, `--destructive #da1e28`, `--destructive-foreground #ffffff`, `--success #24a148`,
    `--warning #ff832b`, `--ink #18181b`, `--on-ink #ffffff`, `--radius 0.625rem`;
  - status set: ok `#24a148 / #16733a / #defbe6`, warn `#ff832b / #ba4e00 / #fff2e8`, bad `#da1e28 / #a2191f / #fff1f1`,
    info `#0f62fe / #0043ce / #edf5ff` border `#a6c8ff`, bill `#b28600 / #8e6a00 / #fcf4d6` border `#f1c21b`,
    reserved `#8a3ffc / #6929c4 / #f6f2ff` border `#d4bbff` (`--status-<kind>`, `--status-<kind>-ink`,
    `--status-<kind>-tint`, `--status-<kind>-border`);
  - brand values: `paper #f4f4f5`, `sidebar #fafafa` (light in this task; Task 16 makes it dark), `wash #f2f2f4`,
    `slip #ffffff`, `ink #18181b`, `ink-hover #27272a`, `muted #52525b`, `rule #e2e2e6`, `field #8b8b93`,
    `accent #0f62fe`, `primary #0f62fe`, `primary-hover #0043ce`, `primary-soft #edf5ff`, `danger #a2191f`, `up #16733a`;
  - `@theme inline` registers `--color-status-ok: var(--status-ok)` (and every status name above), `--color-ink`,
    `--color-on-ink`, `--color-subtle-foreground`, `--color-primary-hover`, and `--shadow-pop:
    0 24px 60px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(0 0 0 / 0.04)`;
  - `.dark` still declares `--primary` and keeps `--border`, `--input` and `--sidebar-border` with an alpha (`/ ` inside
    the value) — `lib/css-compat.test.ts` depends on that shape;
  - the file contains none of `light-dark(`, `@starting-style`, `@scope`, `subgrid`.

  `--brand-up` and `--status-ok-ink` are `#16733a`, not the mock-up's `#198038`: on its own 10 % tint (the Tally card) the
  mock-up green measures 4.38:1, under the pinned 4.5 (`brand-contrast.test.ts`, TallyCard pair).

- [ ] **Step 2: Run it; expect FAIL** (`node --import tsx --test lib/theme-tokens.test.ts`: the first value assertion
  fails with the old `--background`).

- [ ] **Step 3: Implement in `globals.css`.** Write the values above (hex, lower case, one per line, `name: value;`, so
  the existing parsers in `brand-contrast.test.ts` and `table-status.test.ts` still match `#rrggbb;`). In `.dark`, write
  the mock-up's dark set (`design\unpacked\markup.html`, the `:root[data-theme="dark"]` block: bg `#0e0e10`, surface
  `#17171a`, text `#f4f4f5`, text-2 `#a9a9b2`, accent `#0f62fe` with hover `#4589ff`, the status sets) on our names,
  keeping `--border: oklch(1 0 0 / 12%)`, `--input: oklch(1 0 0 / 16%)`, `--sidebar-border: oklch(1 0 0 / 10%)`.
  Leave the `--sidebar-*` mapping lines exactly as they are (pinned by `sidebar-paths.test.ts`; Task 16 changes them).
  Keep every other block (the touch layer, `[data-pos-native]`, keyframes) byte for byte.

- [ ] **Step 4: Run the new test, `brand-contrast`, `table-status`, `css-compat`, `sidebar-paths`, `appearance-paths`,
  `appearance-paths-2` and `pos-layout-paths`; expect PASS.** If a contrast pair fails, stop and report the pair (do not
  weaken a threshold).

- [ ] **Step 5: Add the test to `testChain`, run the cafe chain + typecheck + lint, commit**
  `feat(ui): the new theme's token values (owner's mock-up, light): …` (list the token groups and the `#16733a` reason).

### Task 2: Fonts (Geist everywhere, the brand fonts retired)

**Files:**
- Modify: `apps/cafe/app/globals.css` (`--font-brand-sans`, `--font-brand-display` in `@theme inline`),
  `apps/cafe/lib/brand-fonts.ts`
- Create: `apps/cafe/lib/fonts-paths.test.ts`

**Interfaces:**
- Produces: `brandFontVariables` stays exported from `lib/brand-fonts.ts` (seven importers keep compiling) as `""`;
  `font-brand-sans` and `font-brand-display` resolve to Geist.

- [ ] **Step 1: Failing test `lib/fonts-paths.test.ts`:** `lib/brand-fonts.ts` imports nothing from `next/font`, exports
  `brandFontVariables` equal to `""`; the `@theme inline` slice of `globals.css` has
  `--font-brand-sans: var(--font-geist-sans);` and `--font-brand-display: var(--font-geist-sans);` and still
  `--font-sans: var(--font-geist-sans);`; `lib/fonts.ts` still declares `variable: "--font-geist-sans"`.
- [ ] **Step 2: Run; expect FAIL** (Schibsted import found).
- [ ] **Step 3: Implement.** `brand-fonts.ts` keeps a comment saying why it is now empty (the brand faces were replaced by
  Geist on 2026-10-16; the export stays so the importers need no change in this work).
- [ ] **Step 4: Run the new test + `appearance-paths` + `pos-layout-paths`; expect PASS.**
- [ ] **Step 5: Chain, typecheck, lint; commit** `feat(ui): Geist for the whole staff app …`.

### Task 3: The UI constants module (`lib/ui/`)

**Files:**
- Create: `apps/cafe/lib/ui/status.ts`, `apps/cafe/lib/ui/palette.ts`, `apps/cafe/lib/ui/avatar.ts`,
  `apps/cafe/lib/ui/index.ts`
- Create: `apps/cafe/lib/ui-constants.test.ts`

**Interfaces (produced):**
- `type StatusKind = "ok" | "warn" | "bad" | "info" | "bill" | "reserved" | "neutral"`;
  `STATUS_CLASSES: Record<StatusKind, { dot: string; ink: string; tint: string; border: string; pill: string }>`
  (`ok.dot = "bg-status-ok"`, `ok.ink = "text-status-ok-ink"`, `ok.tint = "bg-status-ok-tint"`,
  `ok.pill = "bg-status-ok-tint text-status-ok-ink"`; info/bill/reserved borders `border-status-<kind>-border`, the others
  `border-transparent`; `neutral` uses `bg-subtle-foreground` / `text-muted-foreground` / `bg-muted`).
- `PAYMENT_KIND: Record<SettlementPayMode, StatusKind>` = `{ Online: "info", Cash: "ok", Split: "reserved", Due: "bill",
  Credit: "warn" }` keyed by `SETTLEMENT_PAY_MODES` from `@pos/shared`; `PAY_PILL_KIND` adds `Unpaid: "neutral"`.
- `CHANNEL_KIND: Record<ChannelLabel, StatusKind>` = `{ "Dine-in": "info", Takeaway: "warn", "QR self-order":
  "reserved", Counter: "ok" }` keyed by the labels in `lib/dashboard/fold.ts`.
- `TABLE_KIND = { Available: "ok", Occupied: "info", Reserved: "reserved" }`;
  `RESERVATION_KIND = { Booked: "info", Seated: "ok", Completed: "neutral", Cancelled: "bad" }`.
- `AVATAR_HUES: readonly { bg: string; fg: string }[]` (six: `#f6f2ff/#6929c4`, `#d9fbfb/#005d5d`, `#defbe6/#0e6027`,
  `#edf5ff/#0043ce`, `#fff0f7/#9f1853`, `#fcf4d6/#8e6a00`) and `avatarHueIndex(seed: string): number` (stable: sum of char
  codes mod 6).
- `PIN_KEY_CLASS = "h-14"` (56 px keys) and `PIN_KEY_CLASS_PHONE = "h-[54px]"`.

- [ ] **Step 1: Failing test `lib/ui-constants.test.ts`:** every `StatusKind` has all five strings and each names only
  `status-*`, `muted`, `muted-foreground`, `subtle-foreground` tokens; `Object.keys(PAYMENT_KIND)` sorted equals
  `SETTLEMENT_PAY_MODES` sorted; `CHANNEL_KIND` keys equal the channel labels `foldChannels` can produce (import the
  label constants from `lib/dashboard/fold.ts`; if they are not exported, export them in this task without changing
  their values); each `AVATAR_HUES` pair is ≥ 4.5:1 (relative-luminance helper in the test); `avatarHueIndex("Rohan
  Kapoor")` is in `0..5` and equal across two calls; no file under `components/` defines a `bg-status-` class map of its
  own (grep for `bg-status-` outside `lib/ui/` finds only `className` uses, never an object literal of all kinds).
- [ ] **Step 2: Run; expect FAIL** (module not found).
- [ ] **Step 3: Implement the four files** (`index.ts` re-exports).
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(ui): one home for the new UI constants …`.

### Task 4: Kit restyle, controls (button, badge, card, input, textarea, select, checkbox, radio, switch, label, skeleton, table)

**Files:**
- Modify: `apps/cafe/components/ui/{button,badge,card,input,textarea,select,checkbox,radio-group,switch,label,skeleton,table,separator}.tsx`
- Create: `apps/cafe/lib/kit-look-paths.test.ts`

**Interfaces:** every export, prop, `cva` variant name and size name unchanged; no new required prop.

- [ ] **Step 1: Failing test `lib/kit-look-paths.test.ts`** (reads sources, comments stripped):
  - **The preset-token rule:** compute the kit and shared files the diner menu reaches (scan `app/m/**` and
    `components/public/**` for `@/components/(ui|shared)/X` imports, then those files' own `@/components/ui/` imports,
    to a fixed point; today: button, skeleton, input, label, sheet, drawer, checkbox, badge, shared/EmptyState). For
    each, every colour utility (`(bg|text|border|ring|ring-offset|outline|fill|stroke|placeholder|divide|decoration|
    caret|accent|shadow)-<token>(/N)?`) must name a token in the set `appearanceCssVars(DEFAULT_APPEARANCE, "light")`
    emits (strip `--`, drop `-rgb` keys) or one of `black, white, transparent, current, inherit`. Message names file and
    class.
  - **No staff-only token in any kit file:** no `status-`, `brand-`, `ink`, `on-ink`, `subtle-foreground`,
    `primary-hover` colour utility under `components/ui/` (sidebar.tsx may use `sidebar-*`).
  - **The look:** button base has `rounded-md`, `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
    and no bare `shadow` in `default`/`outline`/`secondary`/`destructive`; `outline` is
    `border border-border bg-card text-foreground hover:bg-muted`; sizes still `h-9 px-4`, `h-8 … px-3 text-xs`,
    `h-10 … px-8`, `h-9 w-9`; input's first `h-N` is still `h-9` (pinned by `pos-layout-paths`) and it has
    `border-input bg-card` and `focus-visible:border-ring`; card is `rounded-xl border border-border bg-card` with no
    `shadow`; badge base is `rounded-full`; switch checked `data-[state=checked]:bg-primary`, unchecked
    `data-[state=unchecked]:bg-input`; skeleton `bg-muted`; table header cells `text-muted-foreground`.
- [ ] **Step 2: Run; expect FAIL** (button `default` still has `shadow`).
- [ ] **Step 3: Restyle the thirteen files** to spec §4.7 within the rule above (values from §4.5: controls 8 px =
  `rounded-md` once `--radius` is 0.625rem; chips `rounded-sm`; cards `rounded-xl`). Keep `{...props}` spreading
  (`settle-points-view.test.ts` renders `ui/switch` and reads `aria-describedby`).
- [ ] **Step 4: Run the new test + `pos-layout-paths` + `settle-points-view` + `removed-modifiers-paths` +
  `public-diner-polish` + `css-compat`; expect PASS.**
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(ui): the kit's controls in the new look …`.

### Task 5: Kit restyle, surfaces (tabs, dialog, alert-dialog, sheet, drawer, dropdown, popover, tooltip, hover-card, context-menu, command, sonner)

**Files:**
- Modify: `apps/cafe/components/ui/{tabs,dialog,alert-dialog,sheet,drawer,dropdown-menu,popover,tooltip,hover-card,context-menu,command,sonner}.tsx`
- Modify: `apps/cafe/lib/kit-look-paths.test.ts`

**Interfaces:**
- Produces: `TabsList` and `TabsTrigger` accept an optional `variant?: "segmented" | "underline"` (default
  `"segmented"`, today's look restyled; `"underline"`: a 2 px `bg-primary` bar under the active trigger, no track).
  Nothing else gains a prop.

- [ ] **Step 1: Extend the test:** tabs list (segmented) `bg-muted rounded-lg p-1`, active trigger
  `data-[state=active]:bg-card data-[state=active]:shadow-sm`; the `underline` variant exists in both cva maps; dialog,
  alert-dialog and sheet content carry `shadow-pop` and their overlays `bg-black/40`; dialog content `rounded-2xl`;
  dropdown/popover content `rounded-xl … shadow-pop`; tooltip content `bg-foreground text-background`; sonner `toast`
  class has `group-[.toaster]:bg-foreground group-[.toaster]:text-background` and no `bg-background`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Restyle the twelve files.** Sonner keeps `richColors` working (its success/error attribute styles win on
  specificity; do not add `!` to our toast class).
- [ ] **Step 4: Run the kit test + `css-compat` + `token-sheet-paths` + `print-host-card-paths`; expect PASS.**
- [ ] **Step 5: Chain, typecheck, lint; commit** `feat(ui): the kit's surfaces in the new look …`.

### Task 6: Shared states and common components (EmptyState, ErrorState, PageHeader, PinPad, StaffAvatar, StatusPill, SegmentedControl)

**Files:**
- Modify: `apps/cafe/components/shared/{EmptyState,ErrorState,PageHeader}.tsx`
- Create: `apps/cafe/lib/pin-pad.ts`, `apps/cafe/lib/staff-display.ts`, `apps/cafe/components/ui/pin-pad.tsx`,
  `apps/cafe/components/shared/StaffAvatar.tsx`, `apps/cafe/components/shared/StatusPill.tsx`,
  `apps/cafe/components/ui/segmented-control.tsx`
- Create: `apps/cafe/lib/pin-pad.test.ts`, `apps/cafe/lib/staff-display.test.ts`, `apps/cafe/lib/common-components.test.ts`

**Interfaces (produced):**
- `type PinKey = "0" | … | "9" | "clear" | "back"`; `pinPadNext(value: string, key: PinKey, length = 4): string`;
  `pinKeyFromKeyboard(key: string): PinKey | null` (`"0"`–`"9"` → digit, `Backspace` → `"back"`, `Escape` → null,
  `Delete` → `"clear"`).
- `<PinPad value: string; length?: number; onChange(next: string): void; onComplete(pin: string): void;
  error?: string | null; disabled?: boolean; keyboard?: boolean />` — four dots (`aria-hidden`), a visually hidden live
  line "N of 4 digits entered", keys with accessible names `"1"`…`"9"`, `"0"`, `"Clear"`, `"Delete last digit"`, each
  `type="button"` and at least `PIN_KEY_CLASS` tall; the error in `role="alert"`; `onComplete` fires once when the value
  reaches `length`; `keyboard` adds a `keydown` listener on `window` using `pinKeyFromKeyboard`.
- `lib/staff-display.ts`: `shortStaffName(name: string): string` ("Priya Sharma" → "Priya S.", "Priya" → "Priya",
  "  rohan   kapoor " → "rohan K." — trim and collapse spaces, keep the first name as given, upper-case the initial) and
  `staffInitials(name: string): string` ("Priya Sharma" → "PS", "Priya" → "PR", "" → "?").
- `<StaffAvatar name: string; seed?: string; size?: "sm" | "md" | "lg"; status?: "online" | "locked" | null />` —
  initials from `staffInitials(name)` on `AVATAR_HUES[avatarHueIndex(seed ?? name)]`, colours as inline style.
- `<StatusPill kind: StatusKind; children; dot?: boolean />` and `<StatusDot kind: StatusKind />` using `STATUS_CLASSES`.
- `<SegmentedControl<T extends string> label: string; value: T; options: { value: T; label: string }[];
  onChange(v: T): void />` — `role="group" aria-label={label}`, buttons with `aria-pressed`.
- EmptyState / ErrorState / PageHeader: same props as today.

- [ ] **Step 1: Failing tests.** `lib/staff-display.test.ts`: the examples above. `lib/pin-pad.test.ts`:
  `pinPadNext("12","3")` = `"123"`; `pinPadNext("1234","5")` =
  `"1234"`; `"back"` drops one; `"clear"` empties; `pinKeyFromKeyboard("7")` = `"7"`, `("Backspace")` = `"back"`,
  `("a")` = null. `lib/common-components.test.ts` (renderToStaticMarkup with a global React, as
  `print-template-golden.test.ts` does): PinPad with value `"12"` renders 12 buttons with the names above, two filled
  dots of four, the live line "2 of 4 digits entered", and with `error="Incorrect PIN"` a `role="alert"` holding it;
  StaffAvatar("Priya Sharma") renders "PS"; StatusPill kind `bill` carries `bg-status-bill-tint text-status-bill-ink`;
  SegmentedControl renders `role="group"`, `aria-label`, and `aria-pressed="true"` on the chosen option only; EmptyState
  renders title, description and action as today.
- [ ] **Step 2: Run both; expect FAIL** (modules not found).
- [ ] **Step 3: Implement**; restyle the three shared states with tokens only (EmptyState is reached by `/m`: preset
  tokens only).
- [ ] **Step 4: Run both + `kit-look-paths`; expect PASS.**
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(ui): the common components (PIN pad, avatar, status
  pill, segmented control) and the shared states restyled …`.

## Phase B: staff PIN sign-in and the screen lock

### Task 7: Shared rules (PIN, screen-lock values, 90-day session)

**Files:**
- Create: `packages/shared/src/staff-pin.ts`, `packages/shared/src/staff-pin.test.ts`
- Modify: `packages/shared/src/schemas/staff.schema.ts`, `packages/shared/src/schemas/settings.schema.ts`,
  `packages/shared/src/types.ts`, `packages/shared/src/constants.ts`, `packages/shared/package.json` (test list),
  `packages/shared/src/schemas/settings.schema.test.ts`
- Modify (the 90-day pins): `apps/cafe/lib/session-rolling.test.ts`, `apps/cafe/lib/go-live-runbook.test.ts`,
  `docs/GO-LIVE-CHECKLIST.md` (lines ~838, ~882, ~1513), and every comment that says the staff sign-in lasts 30 days
  (`app/(dashboard)/layout.tsx:91`, `components/layout/SessionKeepalive.tsx:6`, `hooks/use-auth.ts:29`,
  `packages/shared/src/constants.ts` block above the constant)

**Interfaces (produced, `@pos/shared/staff-pin`):**
- `STAFF_PIN_LENGTH = 4`, `STAFF_PIN_PATTERN = /^[0-9]{4}$/`, `STAFF_PIN_EASY = DINER_PIN_BANNED` (imported from
  `./public-diner`), `isValidStaffPin(v: unknown): v is string`, `staffPinProblem(v: unknown): "shape" | "easy" | null`,
  `STAFF_PIN_MESSAGES = { shape: "Enter exactly 4 digits.", easy: "Too easy to guess. Pick another PIN." }`,
  `staffPinSchema` (zod string, `superRefine` with those messages).
- `STAFF_PIN_RATE_MAX = 5`, `STAFF_PIN_DAILY_BLOCK = 20`, `staffPinBucket(staffId: string): string` = `staffpin:<id>`.
- `PIN_DEVICE_COOKIE = "pos-pin-device"`, `PIN_DEVICE_MAX = 30`, `PIN_DEVICE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60`.
- `SCREEN_LOCK_MINUTES = [0, 30, 60, 120] as const`, `type ScreenLockMinutes`, `SCREEN_LOCK_DEFAULT_MINUTES = 60`.
- `type PinSignInFailure = { kind: "wrong"; triesLeft: number } | { kind: "wait"; retryAfterSec: number } |
  { kind: "blocked" } | { kind: "device" } | { kind: "nopin" } | { kind: "offline" }`;
  `encodePinFailure(f): string` (`wrong:3`, `wait:540`, `blocked`, `device`, `nopin`) and
  `parsePinFailure(code: string | undefined | null): PinSignInFailure` (an unknown or missing code →
  `{ kind: "nopin" }`, so a strange answer never shows a misleading count of tries);
  `pinFailureMessage(f): string` with the exact copy: wrong → `Incorrect PIN · ${n} ${n === 1 ? "try" : "tries"} left`
  (n = 0 → `Incorrect PIN`), wait → `Too many wrong PINs. Try again in ${ceil(sec / 60)} min.`, blocked → `This PIN is
  blocked after too many wrong tries. Ask an admin to unblock it.`, device → `Sign in with your username and password on
  this device first.`, nopin → `Sign in with your username and password.`, offline → `No internet. The PIN can't be
  checked right now. Printing goes on.`
- `createStaffSchema` gains `pin: staffPinSchema.optional()` (optional: `go-live-runbook.test.ts`'s `BASE_STAFF` must
  still parse; the form requires it); `updateStaffSchema` (derived) therefore accepts `pin`, and gains
  `pinBlocked: z.literal(false).optional()` (the unblock).
- `settingsSchema.screenLockMinutes`: `z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(120)]).optional()`
  (no `.default()`, the `tableLongStayMinutes` precedent; message "Pick one of the listed times").
- `Staff` type gains `hasPin?: boolean; pinBlocked?: boolean;` (never `pin`); `Settings.screenLockMinutes?: number`.
- `SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60` (comment: the owner's 2026-10-16 decision; rolling through the 30-minute
  keepalive; the diner session constant is separate and stays 30 days).

- [ ] **Step 1: Failing tests.** `src/staff-pin.test.ts`: shape/easy for `"0000"`, `"1234"`, `"2580"`, `"12a4"`, `"123"`,
  `"7391"`; `staffPinSchema` messages; `staffPinBucket("abc")`; encode/parse round trips for all six kinds and
  `parsePinFailure("weird")`/`(undefined)` → nopin; every `pinFailureMessage` string exactly as above (1 try / 3 tries /
  0); `SCREEN_LOCK_MINUTES` and the default. `settings.schema.test.ts`: `screenLockMinutes` accepts 0/30/60/120 and
  undefined, refuses 45 and "60". Cafe `session-rolling.test.ts` and `go-live-runbook.test.ts`: change `30 * 24 * 60 * 60`
  to `90 * 24 * 60 * 60` and `/30 days/` to `/90 days/` (in the same commit, the reason: the owner's decision).
- [ ] **Step 2: Run the shared test file and the two cafe files; expect FAIL** (module missing; 30 ≠ 90).
- [ ] **Step 3: Implement; update the three GO-LIVE-CHECKLIST lines** ("Staff stay signed in for 90 days of use…", the §A
  row "| Staff session lifetime | 90 days, rolling with use | …") and the comments.
- [ ] **Step 4: Run the shared suite, the cafe chain, typecheck and lint; expect PASS** (the staff schema parse in
  `go-live-runbook` still passes because `pin` is optional).
- [ ] **Step 5: Commit** `feat(auth): the staff PIN rules, the screen-lock values and a 90-day rolling sign-in …`.

### Task 8: Staff data and the staff API (PIN set, shown to admins, unblock; never listed)

**Files:**
- Modify: `apps/cafe/models/Staff.ts`, `apps/cafe/app/api/staff/route.ts`, `apps/cafe/app/api/staff/[id]/route.ts`,
  `apps/cafe/lib/bootstrap-contract.ts` (`BOOTSTRAP_VERSION` 15 → 16 with its changelog line: "Staff gains hasPin and
  pinBlocked; Settings gains screenLockMinutes"), `apps/cafe/lib/bootstrap-parity.test.ts` (add
  `assert.ok(BOOTSTRAP_VERSION >= 16, …)`)
- Create: `apps/cafe/app/api/staff/[id]/pin/route.ts`
- Create: `apps/cafe/lib/staff-pin-paths.test.ts`, `apps/cafe/scripts/verify-staff-pin-live.ts`
  (+ `"verify:staff-pin:live"` in `apps/cafe/package.json` scripts)

**Interfaces:**
- Consumes: `staffPinSchema`, `createStaffSchema`/`updateStaffSchema` (Task 7).
- Produces: Staff fields `pin?: string` (`select: false`), `hasPin: boolean` (default false), `pinBlocked: boolean`
  (default false), `pinFailDay?: string` (`select: false`), `pinFailCount: number` (default 0, `select: false`).
  `GET /api/staff/[id]/pin` (admin) → `{ pin: string | null }` with `Cache-Control: no-store`. POST/PUT with `pin` set
  `pin`, `hasPin: true`, `pinBlocked: false`, `pinFailCount: 0`; PUT with `pinBlocked: false` unblocks (also zeroes
  `pinFailCount`). Both clear the `"staff"` cache key as today, and the PUT also deletes `auth:revalidated:<id>`.

- [ ] **Step 1: Failing tests.** `lib/staff-pin-paths.test.ts` (source, comments stripped): the model declares `pin` and
  `pinFailDay`/`pinFailCount` with `select: false`, and `hasPin`/`pinBlocked` with `default: false`; the POST and PUT
  routes write `hasPin: true` when `pin` is present; `[id]/pin/route.ts` calls `requireAdmin(` before any DB read,
  selects `+pin`, and sets `no-store`; `lib/masters.ts` `STAFF_LIST` still `select: "-password"` (pinned elsewhere; the
  schema-level `select: false` keeps `pin` out). `scripts/verify-staff-pin-live.ts` (the `verify-expenses-live.ts`
  harness: stub `@/lib/auth` as admin, DB `pos_scratch_staffpin`, refuse other names, drop it at start and end), part
  A: create a staff with pin `"7391"` → 201 and the body has `hasPin: true` and no `pin` key; `GET /api/staff` row has
  `hasPin: true` and no `pin`/`pinFailCount` key; `GET /api/staff/<id>/pin` → `{ pin: "7391" }`; PUT `{ pin: "1234" }`
  → 400 with "Too easy to guess. Pick another PIN."; PUT `{ pinBlocked: false }` → 200; as staff (role switched),
  `GET …/pin` → 403. Each check prints `PASS`/`FAIL` with the status and body; the script exits 1 on any FAIL.
- [ ] **Step 2: Run** `node --import tsx --test lib/staff-pin-paths.test.ts` **and**
  `node --import tsx scripts/verify-staff-pin-live.ts`; **expect FAIL** (fields and route missing).
- [ ] **Step 3: Implement.** Cast-free: the route reads `parsed.data.pin` and builds `$set` explicitly.
- [ ] **Step 4: Run both + `bootstrap-parity` + `masters-provider-paths` + `masters-seed`; expect PASS.**
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(staff): a 4-digit PIN per staff member, set and read by
  admins, never listed …`.

### Task 9: The device memory (a signed httpOnly cookie)

**Files:**
- Create: `apps/cafe/lib/pin-device.ts`, `apps/cafe/lib/pin-device.test.ts`

**Interfaces (produced):**
- `type PinDevicePerson = { id: string; at: number }`.
- `pinDeviceKey(secret: string | undefined): Buffer | null` — HKDF-SHA256 over `secret` with salt
  `"pos-pin-device-v1"` and info `"pin-device"`, 32 bytes; null when no secret (the `lib/telegram/secret.ts` pattern;
  callers pass `process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET`).
- `signPinDevice(people: PinDevicePerson[], key: Buffer): string` — `base64url(JSON {v:1,p:[[id,at],…]})` + `"."` +
  `base64url(HMAC-SHA256(key, payload))`.
- `readPinDevice(value: string | undefined, key: Buffer | null): PinDevicePerson[] | null` — null for missing value,
  missing key, bad shape, wrong signature (compared with `timingSafeEqual` after a length check), or more than
  `PIN_DEVICE_MAX` entries; ids must be 24-hex.
- `rememberPerson(people: PinDevicePerson[] | null, id: string, now: number): PinDevicePerson[]` — the person moves to
  the front with `at = now`, duplicates removed, capped at `PIN_DEVICE_MAX` (oldest dropped).
- `cookieValue(cookieHeader: string | null, name: string): string | undefined` (plain parser for `authorize`'s request).
- `pinDeviceCookieOptions()` → `{ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
  path: "/", maxAge: PIN_DEVICE_MAX_AGE_SECONDS }`.

- [ ] **Step 1: Failing tests.** `pin-device.test.ts`: sign → read round trip; a one-character change in the payload or
  the signature → null; another key → null; an empty or garbage value → null; no key → null; 31 people → null on read;
  `rememberPerson` moves an existing id to the front with the new time, caps at 30 dropping the oldest (Review Focus 5),
  never duplicates; `cookieValue("a=1; pos-pin-device=xyz; b=2", "pos-pin-device")` = `"xyz"`; the options object
  equals the values above.
- [ ] **Step 2: Run; expect FAIL** (modules missing).
- [ ] **Step 3: Implement** with `node:crypto` only (no new dependency).
- [ ] **Step 4: Run; expect PASS.**
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(auth): the device memory for PIN sign-in, a signed
  httpOnly cookie …`.

### Task 10: PIN verification on the server

**Files:**
- Create: `apps/cafe/lib/staff-pin-signin.ts`, `apps/cafe/lib/staff-pin-signin.test.ts`
- Modify: `apps/cafe/scripts/verify-staff-pin-live.ts` (part B)

**Interfaces:**
- Consumes: `peekRateLimit`, `hitRateLimit` (`lib/public-rate-limit.ts`), `staffPinBucket`, `STAFF_PIN_RATE_MAX`,
  `STAFF_PIN_DAILY_BLOCK`, `isValidStaffPin` (Task 7), `PinDevicePerson` (Task 9), `cafeDateString` (`lib/utils`).
- Produces: `type PinSignInResult = { ok: true; user: { id: string; name: string; role: "admin" | "staff" } } |
  { ok: false; failure: Exclude<PinSignInFailure, { kind: "offline" }> }` and
  `verifyStaffPinSignIn(input: { staffId: unknown; pin: unknown; devicePeople: PinDevicePerson[] | null; now?: number }):
  Promise<PinSignInResult>` — the spec §5.4 steps in order: shape (→ wrong, nothing counted), device (`staffId` not in
  `devicePeople` → device, nothing counted), peek the person's bucket (full → wait with the window's seconds left),
  load `Staff.findOne({ _id, isActive: true }).select("+pin +pinFailDay +pinFailCount name role hasPin pinBlocked")`
  (missing / no PIN → nopin; `pinBlocked` → blocked), `timingSafeEqual` of the two 4-byte buffers, wrong → `hitRateLimit`
  and one atomic `findOneAndUpdate` that sets `pinFailDay` to today and increments (or resets to 1 on a new day)
  `pinFailCount`, setting `pinBlocked: true` when it reaches 20 → wrong with `STAFF_PIN_RATE_MAX - n` tries left; right
  → `{ ok: true, user }`.
- Produces (pure, for the unit test): `nextPinFailState(prev: { day?: string; count: number }, today: string,
  blockAt = STAFF_PIN_DAILY_BLOCK): { day: string; count: number; block: boolean }`.

- [ ] **Step 1: Failing tests.** `staff-pin-signin.test.ts`: `nextPinFailState({count:0}, "2026-10-16")` →
  `{day:"2026-10-16", count:1, block:false}`; same day 19 → 20 and `block: true`; a new day → count 1, block false.
  Live leg part B (same harness, no auth stub needed for this module): seed staff A (pin `"7391"`, active) and B
  (inactive, pin), C (active, no pin); device `[A, B, C]`:
  - A with `"7391"` → ok and the user's id/name/role;
  - A with `"7391"` but `devicePeople` without A → `device`, and A's bucket and `pinFailCount` unchanged;
  - B → `nopin`; C → `nopin`; a bad id string → `wrong`;
  - five wrong PINs for A → `wrong` with 4,3,2,1,0 tries left, then the sixth (even the right PIN) → `wait` with
    `retryAfterSec` in `1..600`;
  - after resetting A's bucket rows (delete A's `publicratelimits` rows by `_id` prefix `staffpin:<A>:`), set A's
    `pinFailCount` to 19 on today and send one wrong PIN → `pinBlocked` true in the DB and the answer `wrong`; the next
    try → `blocked`;
  - two staff with the same PIN: A's tile signs in A, D's tile signs in D (Review Focus 5).
- [ ] **Step 2: Run both; expect FAIL** (module missing).
- [ ] **Step 3: Implement** `lib/staff-pin-signin.ts` (server-only; never imported by a `"use client"` file —
  `client-graph-guard` holds it).
- [ ] **Step 4: Run both + `client-graph-guard`; expect PASS.**
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(auth): PIN verification with per-person limits only …`.

### Task 11: Auth wiring and the two sign-in routes

**Files:**
- Modify: `apps/cafe/lib/auth.ts`, `apps/cafe/auth.config.ts`, `apps/cafe/lib/telegram-paths.test.ts`
  (`FROZEN_UNAUTH_ROUTES` gains `app/api/sign-in/known/route.ts` with a review comment: public by design, spec §5.3,
  answers only for a signed device cookie, no staff data otherwise)
- Create: `apps/cafe/app/api/sign-in/known/route.ts`, `apps/cafe/app/api/sign-in/remember/route.ts`,
  `apps/cafe/lib/pin-sign-in-client.ts`, `apps/cafe/lib/sign-in-paths.test.ts`
- Modify: `apps/cafe/scripts/verify-staff-pin-live.ts` (part C)

**Interfaces:**
- Consumes: Tasks 7, 9, 10.
- Produces:
  - `lib/auth.ts`: `class PinSignInError extends CredentialsSignin` (its `code` set from `encodePinFailure`) and a second
    provider `Credentials({ id: "pin", credentials: { staffId: {}, pin: {} }, authorize })` whose `authorize(credentials,
    request)` reads `cookieValue(request.headers.get("cookie"), PIN_DEVICE_COOKIE)`, calls `readPinDevice(…,
    pinDeviceKey(secret))` and `verifyStaffPinSignIn`, returns the user or throws `PinSignInError`. The `jwt`/`session`
    callbacks are unchanged (the PIN user goes through the same sign-in branch as the password user). The edge
    `auth.config.ts` gains the stub `Credentials({ id: "pin", credentials: { staffId: {}, pin: {} }, authorize: () =>
    null })`.
  - `GET /api/sign-in/known` → `{ people: KnownPerson[] }`, `KnownPerson = { id: string; name: string; shortName: string;
    initials: string; role: "admin" | "staff" }`, in the cookie's order, only active staff with `hasPin: true`; the tenant
    check copied from `app/api/public/diner/login/route.ts` (404 "Not found" on a mismatch); no cookie or a bad one →
    `{ people: [] }`; `Cache-Control: no-store`.
  - `POST /api/sign-in/remember` → `requireAuth()`; reads the cookie with `cookies()` from `next/headers`, applies
    `rememberPerson(…, session.user.id, Date.now())`, sets the cookie with `pinDeviceCookieOptions()`, answers
    `{ remembered: true }`; with no signing key it answers 200 `{ remembered: false }` and sets nothing.
  - `lib/pin-sign-in-client.ts` (client-safe): `fetchKnownPeople(): Promise<KnownPerson[]>` (`apiGet`; any error → `[]`),
    `rememberThisDevice(): Promise<void>` (`apiSend` POST; errors swallowed), `signInWithPin(staffId: string, pin: string):
    Promise<{ ok: true } | { ok: false; failure: PinSignInFailure }>` (`signIn("pin", { staffId, pin, redirect: false })`;
    a thrown network error or `navigator.onLine === false` → `offline`; `result.error` → `parsePinFailure(result.code)`).

- [ ] **Step 1: Failing tests.** `lib/sign-in-paths.test.ts` (source, comments stripped): `lib/auth.ts` has
  `id: "pin"` and `extends CredentialsSignin` and calls `verifyStaffPinSignIn(` and `readPinDevice(`; `auth.config.ts`
  has the `id: "pin"` stub with `authorize: () => null`; `known/route.ts` has the tenant check (`resolveTenantFromHost(`
  and `process.env.TENANT_ID`), `hasPin: true`, `isActive: true`, `no-store`, and never selects `pin`; `remember/route.ts`
  calls `requireAuth(` first and `rememberPerson(`; `pin-sign-in-client.ts` has no import from `@/models` or `@/lib/db`.
  Live leg part C: call the route handlers directly (the harness pattern) — `GET known` with no cookie →
  `{ people: [] }`; `POST remember` as A (auth stubbed as A) → a `Set-Cookie` for `pos-pin-device` with `HttpOnly`,
  `SameSite=lax`, `Max-Age=34560000`; `GET known` with that cookie → `[A]` (after A has a PIN) and not C (no PIN) and not
  B (inactive); a tampered cookie → `[]`.
- [ ] **Step 2: Run the paths test and the live leg; expect FAIL.**
- [ ] **Step 3: Implement.** With `known/route.ts` in place, run `telegram-paths` once BEFORE adding its
  `FROZEN_UNAUTH_ROUTES` entry and see it fail on the new unguarded route (the guard bites), then add the entry with its
  review comment.
- [ ] **Step 4: Run them + `telegram-paths` + `public-surface-paths` + `session-rolling` + `client-graph-guard`; expect
  PASS.**
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(auth): PIN sign-in through Auth.js and the device's
  remembered people …`.

### Task 12: The login page (picker, PIN pad, the password form in the new look)

**Files:**
- Modify: `apps/cafe/app/(auth)/login/page.tsx`, `apps/cafe/components/auth/AuthShell.tsx`
- Create: `apps/cafe/components/auth/PinSignIn.tsx`, `apps/cafe/lib/login-pin-paths.test.ts`
- Delete (no importer left after AuthShell's new look): `components/brand/BrandCard.tsx`, `PointillistScene.tsx`,
  `Postmark.tsx`, `StampFrame.tsx`, and `lib/brand-art.ts`, `lib/brand-steam.ts` with their tests
  (`lib/brand-art.test.ts`, `lib/brand-steam.test.ts`, removed from `testChain`) if, and only if, `grep` shows no other
  importer. `VendorMark.tsx` and `lib/brand-time.ts` stay (used).

**Interfaces:**
- Consumes: `PinPad`, `StaffAvatar` (Task 6), `pinFailureMessage` (Task 7), `fetchKnownPeople`, `signInWithPin`,
  `rememberThisDevice` (Task 11), `greetingFor` (`lib/brand-time.ts`), `useNow`.
- Produces: `<PinSignIn people: KnownPerson[]; highlight?: { id: string; label: string } | null; onUsePassword(): void;
  onSignedIn(person: KnownPerson): void | Promise<void> />` (shared with the lock screen in Task 15): the tiles (search and
  "All staff N / Admin N / Staff N" underline tabs only when `people.length > 8`), the pad view ("← All staff", the avatar,
  the full name, "Admin · Enter your 4-digit PIN" / "Staff · Enter your 4-digit PIN", the pad with `keyboard`, "Forgot
  PIN?" → the line "Ask an admin to tell you or reset your PIN."), the "Sign in with username and password" link under
  the tiles; while a `wait` failure lasts the pad is disabled and the line counts down once a second (a timer, no
  request).

- [ ] **Step 1: Failing test `lib/login-pin-paths.test.ts`:** the existing pins still hold (run
  `branding-paths`, `masters-provider-paths`, `pos-layout-paths` unchanged: the first `<button` in `page.tsx` is still the
  reveal toggle, the first `<form` still `method="post"` with `onSubmit={handleSubmit(onSubmit)}`, `signIn("credentials"`,
  the `clearMastersBlob` effect, `productLogoSrc`, `<AuthShell`, AuthShell's `<main className=` holding `min-h-screen`);
  new: `page.tsx` renders `<PinSignIn` and calls `fetchKnownPeople(` and, after a successful password sign-in,
  `rememberThisDevice(` before `router.replace("/")`; `PinSignIn.tsx` calls `signInWithPin(` and `pinFailureMessage(`,
  holds the copy "Select your name to sign in", "Sign in with username and password", "Forgot PIN?", "Ask an admin to
  tell you or reset your PIN.", and has no `fetch(` of its own; `AuthShell.tsx` no longer imports `PointillistScene`,
  `Postmark`, `StampFrame` or `BrandCard`; the page shows "Sign in with PIN" only when people exist. A render test of
  `PinSignIn` with three people: three tiles named "Priya S.", "Rohan K.", "Meera I." with their roles, no search field;
  with nine people: the search field and the tabs "All staff 9".
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** The page's mode: `"loading"` (one skeleton card, no flash of either form) → `"pin"` when
  `people.length > 0`, else `"password"`; PIN success → `rememberThisDevice()` → `router.replace("/")` +
  `router.refresh()`. AuthShell's new look per the mock-up (`shots\d-lock-pick.png`, `p-lock-pick.png`): the cafe header
  row (logo tile, `APP_NAME`, the clock), the soft background, the white 20 px card, `VendorMark` below.
- [ ] **Step 4: Run the new test + the three existing pin files + `brand-time` + `client-graph-guard`; expect PASS.**
- [ ] **Step 5: testChain (add the new test, remove deleted ones), chain, typecheck, lint; commit** `feat(login): sign in
  by name and PIN after the first username/password sign-in on a device …`.

### Task 13: Staff page (PIN on add and edit, show, unblock) and the Screen lock setting

**Files:**
- Modify: `apps/cafe/components/staff/StaffFormSheet.tsx`, `StaffRowCard.tsx`, `apps/cafe/app/(dashboard)/staff/page.tsx`,
  `apps/cafe/hooks/use-staff.ts`
- Modify (setting): `apps/cafe/models/Settings.ts`, `apps/cafe/models/settings.types.ts`, `apps/cafe/lib/settings-sections.ts`
  (business `fields` gains `screenLockMinutes`), `apps/cafe/lib/settings-form-defaults.ts`
  (`screenLockMinutes: settings.screenLockMinutes ?? SCREEN_LOCK_DEFAULT_MINUTES`),
  `apps/cafe/components/settings/BusinessDetailsFields.tsx`
- Create: `apps/cafe/lib/staff-pin-ui-paths.test.ts`

**Interfaces:**
- Consumes: Task 7 schemas, Task 8 routes.
- Produces: `useRevealStaffPin()` = `useMutation({ mutationFn: (id: string) => apiGet<{ pin: string | null }>(…) })`
  (on demand, never cached) in `hooks/use-staff.ts`; unblock uses the existing `useUpdateStaff` with
  `{ pinBlocked: false }`.

- [ ] **Step 1: Failing test `lib/staff-pin-ui-paths.test.ts`:** the form has a "PIN (4 digits)" field
  `id="staff-pin"` with `inputMode="numeric"` and `maxLength={4}`, required on create (the submit refuses an empty or
  invalid PIN with `staffPinProblem`'s message), optional on edit ("New PIN", blank keeps the current one) with a "Show"
  button calling `useRevealStaffPin`; the row card and the table show a "PIN blocked" `StatusPill` and an "Unblock PIN"
  action when `pinBlocked`, and a "No PIN" muted pill when `!hasPin`; every `size="icon"` button still uses
  `BRAND_ROW_ACTION_CLASS` (run `polish-pages-paths` unchanged); `BusinessDetailsFields.tsx` has a `SettingsGroup`
  titled "Screen lock" with the field label "Lock the screen after no activity for" and the options "Off", "30 minutes",
  "1 hour", "2 hours" through the kit `Select` (no native `<select`: `no-native-pickers-paths`), registered as
  `screenLockMinutes` with a number value; the model field `screenLockMinutes: { type: Number, enum: [0, 30, 60, 120],
  default: 60 }`; `settings-sections.test` partitions cleanly (run it).
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the new test + `polish-pages-paths` + `settings-sections` + `no-native-pickers-paths` +
  `settings-upi-rules` + `branding-paths`; the live leg gains part D (PUT settings `{ screenLockMinutes: 30 }` → 200 and
  read back; `45` → 400); expect PASS.**
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(staff): PIN on the Staff page and the Screen lock time
  under Business details …`.

### Task 14: The lock's pure core (state, idle clock, no-flash script, scoped queries)

**Files:**
- Create: `apps/cafe/lib/screen-lock.ts`, `apps/cafe/lib/screen-lock.test.ts`

**Interfaces (produced):**
- `SCREEN_LOCK_STORAGE_KEY = "pos.lock.v1"`; `type LockState = { locked: true; by: string | null; byName: string | null;
  at: number }`; `readLockState(storage: Pick<Storage, "getItem"> | null): LockState | null` (try/catch; bad JSON → null);
  `writeLockState(storage, state)`; `clearLockState(storage)`.
- `LOCK_ATTR = "data-pos-locked"`, `LOCK_READY_ATTR = "data-pos-lock-ready"`.
- `SCREEN_LOCK_SCRIPT: string` — a constant (no template interpolation) that reads the key, and if the parsed value's
  `locked === true` sets `LOCK_ATTR` on `document.documentElement`; wrapped in try/catch; contains no `<`, `>` or `&`
  (React renders a script child as text, the `DINER_THEME_SCRIPT` precedent).
- `isDisplayPath(pathname: string): boolean` — `/kitchen` and `NOW_SERVING_PATH` (imported from
  `@/components/now-serving/NowServingLink`; the literal `"/now-serving"` may not be written outside the two pinned files,
  `now-serving-paths.test.ts`); exact path or a sub-path.
- `autoLockDue(input: { lastActivityAt: number; now: number; minutes: number; pathname: string }): boolean` — false for
  `minutes <= 0` or a display path; true when `now - lastActivityAt >= minutes * 60_000`.
- `lockedAgoLabel(at: number, now: number): string` — "Locked · just now" (< 1 min), "Locked · N min ago",
  "Locked · N h ago" (≥ 60 min, floor).
- `screenLockLine(minutes: number): string` — 0 → "Screen lock is off", 30 → "Locks after 30 minutes without activity",
  60 → "Locks after 1 hour without activity", 120 → "Locks after 2 hours without activity".
- `PERSON_SCOPED_QUERY_ROOTS: readonly string[]` — the first key segment of `STAFF_KEYS.all`, `REPORT_KEYS.all`,
  `DASHBOARD_KEYS.all`, `EXPENSE_KEYS.all`, `TELEGRAM_KEYS.all`, `PRINT_DEVICES_KEYS.all` written as literals here; and
  `isPersonScopedQuery(queryKey: readonly unknown[]): boolean`.
- `requestScreenLock(reason: "manual" | "switch"): void` — dispatches `window` `CustomEvent("pos:screen-lock", { detail:
  { reason } })`; `SCREEN_LOCK_EVENT = "pos:screen-lock"`.

- [ ] **Step 1: Failing test `lib/screen-lock.test.ts`:** read/write/clear round trip with a fake storage, bad JSON → null,
  a throwing storage → null; `autoLockDue` at 59:59 false and 60:00 true for 60, always false for 0 and on `/kitchen`,
  `/kitchen/x` and `NOW_SERVING_PATH`, true on `/pos` (Review Focus 3: a `now` hours later is still true — wall clock);
  `lockedAgoLabel` and `screenLockLine` strings; the script: run `new Function("localStorage", "document",
  SCREEN_LOCK_SCRIPT)` with a fake storage holding `{"locked":true}` and a fake `document.documentElement` with
  `setAttribute` → the attribute is set; with `{"locked":false}`, nothing, with garbage, nothing and no throw; the script
  contains none of `<`, `>`, `&`; `PERSON_SCOPED_QUERY_ROOTS` equals the roots imported from the six hook modules (so a
  renamed key fails here).
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run + `kitchen-paths` + `now-serving-paths`; expect PASS.**
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(lock): the screen lock's core …`.

### Task 15: The lock cover (in the dashboard layout) and the account menu's Lock / Switch user

**Files:**
- Create: `apps/cafe/components/lock/ScreenLock.tsx`, `apps/cafe/components/lock/LockPasswordForm.tsx`,
  `apps/cafe/lib/screen-lock-paths.test.ts`
- Modify: `apps/cafe/app/(dashboard)/layout.tsx` (`<script>{SCREEN_LOCK_SCRIPT}</script>` first inside the returned tree,
  `<ScreenLock />` right after `<SessionKeepalive />`), `apps/cafe/app/globals.css` (one rule:
  `html[data-pos-locked]:not([data-pos-lock-ready]) body > * { visibility: hidden; }`),
  `apps/cafe/components/layout/SidebarAccount.tsx` (menu items "Lock screen" with "Your open orders stay as they are",
  "Switch user" with "Lock and let a teammate sign in", the existing "Change password" and "Sign out", and a last muted
  line `screenLockLine(minutes)`)

**Interfaces:**
- Consumes: Tasks 11, 12, 14; `useAuth`, `useSettings`, `useQueryClient`, `usePathname`, `useRouter`, `ADMIN_ROUTES`.
- Produces: `<ScreenLock />` (no props). Behaviour, per spec §5.6:
  - on mount: if `readLockState` says locked, show the cover; set `LOCK_READY_ATTR` on `<html>` after the first render;
  - activity = `pointerdown` and `keydown` on `window` in the capture phase (update `lastActivityAt`); a 30 s timer and
    `visibilitychange` call `autoLockDue` (no request in either);
  - lock (auto, `requestScreenLock`): `writeLockState({ locked: true, by: user.id, byName: user.name, at: now })`, set
    `LOCK_ATTR`, `fetchKnownPeople()` once, show the cover;
  - the cover: `createPortal` into `document.body`, `data-screen-lock`, `fixed inset-0 z-[100]`, `role="dialog"`
    `aria-modal="true"` `aria-label="Screen locked"`; while shown, every other `document.body` child gets `inert` (removed
    on unlock);
  - content: `<PinSignIn people highlight={{ id: by, label: lockedAgoLabel(at, now) }} …/>` ("switch" → no highlight);
    when the locker is not among `people` or `people` is empty → `<LockPasswordForm />` (the same labels and ids as the
    login form but `lock-username` / `lock-password`, the line "Signed in as <name>", `signIn("credentials", { …,
    redirect: false })`), with "Sign in with PIN" back when people exist; a "Sign out" link (`useAuth().logout`);
  - success (PIN or password) for the same id → `clearLockState`, remove the attribute, close; for another id →
    additionally `queryClient.resetQueries({ predicate: (q) => isPersonScopedQuery(q.queryKey) })`, `router.replace("/")`
    when `ADMIN_ROUTES` covers the path and the new role is not admin, a toast `Signed in as ${first name}`; in both cases
    `rememberThisDevice()`.
  - It never imports `use-cart` or any POS/cart module, and never calls `fetch(` directly.

- [ ] **Step 1: Failing test `lib/screen-lock-paths.test.ts`:** layout order (raw): `<script>{SCREEN_LOCK_SCRIPT}</script>`
  before `<SidebarProvider>`, `<SessionKeepalive />` before `<ScreenLock />` before `<AppSidebar`; and the existing layout
  pins still pass (run `pos-layout-paths`, `print-host-paths`, `order-request-paths`, `print-routing`,
  `realtime-live-state`, `session-rolling`, `token-sheet-paths`, `settings-shell-paths`, `print-fonts-paths`,
  `pos-install-paths` unchanged); `ScreenLock.tsx` contains `createPortal(`, `inert`, `role="dialog"`,
  `aria-modal="true"`, `addEventListener("pointerdown"` and `("keydown"` with `true`/`{ capture: true }`, `autoLockDue(`,
  `resetQueries(` with `isPersonScopedQuery`, `z-[100]`, and none of `use-cart`, `fetch(`, `setInterval(` with a delay
  under `15_000`; `SidebarAccount.tsx` has "Lock screen", "Switch user", `requestScreenLock("manual")`,
  `requestScreenLock("switch")`, `screenLockLine(`, and still "Change password" and "Sign out"; `globals.css` has the
  `data-pos-locked` rule outside the `[data-pos-touch]` block (`pos-layout-paths` reads that block).
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the new test and every layout pin file listed + `css-compat`; expect PASS.** Then a headless check
  (`D:\kd\pos-dev-keep\ui-redesign\tools\baseline.mjs`'s browser setup, scratch script): sign in, open the printer panel,
  lock from the menu → the cover shows, a Tab key stays inside it, the panel is still open after unlock (Review Focus 2).
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(lock): the screen-lock cover over the dashboard, Lock
  screen and Switch user …`.

## Phase C: the app shell's look

### Task 16: The dark sidebar

**Files:**
- Modify: `apps/cafe/app/globals.css` (brand nav tokens; the `--sidebar-*` mapping), `apps/cafe/components/brand/brand-classes.ts`
  (`NAV_ACTIVE`, `BRAND_NAV_ITEM_CLASS`, `BRAND_NAV_SUB_ITEM_CLASS`, `BRAND_NAV_LABEL_CLASS`),
  `apps/cafe/components/layout/{AppSidebar,SidebarBrand,SidebarAccount}.tsx`
- Modify (pins, on purpose): `apps/cafe/lib/sidebar-paths.test.ts` (the mapping lines), `apps/cafe/lib/brand-contrast.test.ts`
  (the sidebar pairs, the translucent rows, the luminance order)
- Create: `apps/cafe/lib/shell-look-paths.test.ts`

**Interfaces:**
- Produces: tokens `--brand-sidebar: #111113`, `--brand-nav-text: #c8c8cc`, `--brand-nav-muted: #8b8b93`,
  `--brand-nav-hover: #1f1f23`, `--brand-nav-rule: #27272a`, `--brand-nav-focus: #78a9ff` (Tailwind `brand-nav-*`);
  mapping `--sidebar: var(--brand-sidebar)`, `--sidebar-foreground: var(--brand-nav-text)`, `--sidebar-accent:
  var(--brand-nav-hover)`, `--sidebar-accent-foreground: var(--brand-slip)`, `--sidebar-border: var(--brand-nav-rule)`,
  `--sidebar-ring: var(--brand-nav-focus)`, and the new `--sidebar-muted: var(--brand-nav-muted)`.

- [ ] **Step 1: Change the pins and write the failing test.** `sidebar-paths.test.ts`: the six expected mapping pairs
  above. `brand-contrast.test.ts`: replace `[ink, sidebar]`, `[muted, sidebar]`, `[accent, sidebar]` and the two
  translucent ink rows with `[nav-text, sidebar] ≥ 4.5`, `[nav-muted, sidebar] ≥ 4.5`, `[slip, nav-hover] ≥ 4.5`,
  `[accent, sidebar] ≥ 3` (the active bar), `[nav-focus, sidebar] ≥ 3`; replace "paper < sidebar < slip" with "sidebar
  darker than paper and slip" (luminance); the literal check becomes `text-brand-nav-text` in `BRAND_NAV_ITEM_CLASS`.
  `shell-look-paths.test.ts`: the nav classes carry `text-brand-nav-text`, `hover:bg-brand-nav-hover`,
  `data-[active=true]:bg-brand-nav-hover`, `data-[active=true]:text-white`, the active bar
  `data-[active=true]:shadow-[inset_3px_0_0_var(--color-brand-accent)]`, `pointer-coarse:h-11`; `BRAND_NAV_LABEL_CLASS` is
  one literal with `uppercase`, `text-[11px]`, `tracking-[0.06em]`, `text-brand-nav-muted` and the two
  `group-data-[collapsible=icon]` tokens; `SidebarBrand.tsx` no longer has `mix-blend-multiply` and puts the logo on a
  white tile; AppSidebar's scrollbar colour reads `--brand-nav-rule`; SidebarAccount's trigger text is
  `text-brand-slip` with the role in `text-brand-nav-muted` and a `StaffAvatar` with the online dot.
- [ ] **Step 2: Run the three files; expect FAIL.**
- [ ] **Step 3: Implement.** Row height `h-9` on a mouse (the 17-row list must still fit a 768 px laptop: measure in the
  headless check), 44 px on touch; widths untouched.
- [ ] **Step 4: Run the three + `sidebar-order-paths`, `settings-shell-paths`, `reports-paths`, `tables-setup-paths`,
  `now-serving-paths`, `kitchen-paths`, `branding-paths`, `settings-branding`, `header-quick-tabs`, `order-request-paths`,
  `pos-layout-paths`; expect PASS.**
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(shell): the dark sidebar (owner's mock-up) at today's
  widths …` (body: why the two pin files changed).

### Task 17: Top bar, quick tabs, printer button, request alert bar

**Files:**
- Modify: `apps/cafe/components/layout/Header.tsx`, `HeaderQuickTabs.tsx` (`TAB_CLASS` only),
  `apps/cafe/components/orders/RequestAlertBar.tsx` (the band's colour classes only; stay within 150 lines),
  `apps/cafe/components/print/PrinterStatusButton.tsx` (button look only; stay within 120 lines)
- Modify (pin, on purpose): `apps/cafe/lib/pos-layout-paths.test.ts` (`bg-amber-50` → `bg-status-warn-tint` in the
  `ref={bandRef}` regex)
- Modify: `apps/cafe/lib/shell-look-paths.test.ts`

- [ ] **Step 1: Extend the test and change the pin:** the header tag is `sticky top-0 … h-14 … border-b bg-card`; the band
  tag carries `bg-status-warn-tint text-status-warn-ink`; `TAB_CLASS` keeps `min-w-0` and `shrink` and gains the active
  `data-[active=true]:bg-accent data-[active=true]:text-accent-foreground`; the printer button keeps every pinned
  attribute (`printer-dot-ui-paths`) and becomes the outline square.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run + `printer-dot-ui-paths`, `page-refresh`, `token-sheet-paths`, `header-quick-tabs`,
  `print-host-band-paths`, `products-sort`, `self-order-alert-paths`, `self-order-alert-review-pins`, `pos-pulse-paths`,
  `settings-shell-paths`; expect PASS.**
- [ ] **Step 5: Chain, typecheck, lint; commit** `feat(shell): the top bar and the request band in the new look …`.

## Phase D: the dashboard

### Task 18: The dashboard's arrangement, the Net sales hero and the receipt

**Files:**
- Modify: `apps/cafe/app/(dashboard)/page.tsx`, `apps/cafe/components/dashboard/{AttentionStrip,KpiCard,RangeBar,RangeCards}.tsx`,
  `apps/cafe/components/reports/MoneyBreakdownCard.tsx` (dashboard-only importer)
- Create: `apps/cafe/components/dashboard/SalesHero.tsx`, `apps/cafe/components/dashboard/KpiChange.tsx`,
  `apps/cafe/lib/dashboard-layout-paths.test.ts`

**Interfaces:**
- Produces: `kpiFigures(data: DashboardData, today: string, period: string): KpiFigure[]` exported from `RangeCards.tsx`
  (the four `{ label, value, delta, compareLabel, noCompareText, hint?, upIsGood }` objects `KpiRow` builds today, moved
  verbatim into the function; `KpiRow` maps it, unchanged output); `<KpiChange delta compareLabel noCompareText upIsGood
  tone?: "light" | "dark" />` (the arrow + "Up"/"Down"/"No change," sr text + text, extracted from `KpiCard`, which then
  renders it); `<SalesHero {...RangeCardProps} />` (dark `bg-ink text-on-ink` card: Net sales big, its change as a pill,
  a rule, then Orders / Average order / Collected with their changes and the Collected hint; loading skeletons; the
  `updating` dim).
- `RangeBar` keeps its props and behaviour, restyled to the segmented look (track `bg-muted`, chosen `bg-card shadow-sm`).
- `AttentionStrip` keeps every chip text, link and order; below `sm` a button "N · Needs attention" with
  `aria-expanded` folds the chips; from `sm` the uppercase label with an orange `StatusDot` and wrapping white chips with
  a `StatusDot` per kind (QR waiting warn, open tabs info, bookings reserved, unavailable bad, dues bill).

- [ ] **Step 1: Failing test `lib/dashboard-layout-paths.test.ts`:** `page.tsx` order of first occurrences:
  `<AttentionStrip` < `<RangeBar` < `<SalesHero` < `<MoneyBreakdownCard` < `<SalesCard` < `<LiveFloorPanel` <
  `<RecentOrders` < `<TodayReservations` < `<PaymentMixCard` < `<ChannelsCard` < `<TopItemsCard` < `<SlowItemsCard` <
  `<CategoriesCard` < `<LeaksCard` < `<BusyHoursCard`; no `<KpiRow` in the page; a render of `KpiCard` with fixed props
  equals the markup captured from today's `KpiCard` before the refactor (write the golden string in this step, from the
  current code); a render of `SalesHero` with a fixture holds "Net sales", "Orders", "Average order", "Collected" and the
  hint "+ ₹100 paid against earlier dues"; `AttentionStrip` has `aria-expanded` and still builds the five chip texts;
  `MoneyBreakdownCard` still has `<CardDescription` and no `<p className` (its existing pin). Run the dashboard's
  existing pins unchanged: `dashboard-paths`, `realtime-live-state`, `money-breakdown-source-pins`, `print-routing`,
  `print-paths`, `print-host-paths`, `print-host-band-paths`, `desktop-shell-paths`, `date-input`, `print-slip-code-pins`.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement** the spec §7 arrangement (desktop: hero row `lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]`;
  Sales 2/3 + Live tables 1/3; then two-column rows; phone: one column). The receipt look of `MoneyBreakdownCard`:
  dotted leaders between label and amount, a zig-zag lower edge (a CSS mask with a repeating gradient; no `@property`).
  `EndOfDayButton` is not edited.
- [ ] **Step 4: Run + all the files above; expect PASS.**
- [ ] **Step 5: testChain, chain, typecheck, lint; commit** `feat(dashboard): the mock-up's arrangement with every card
  kept …`.

### Task 19: The dashboard's colours (payment, channels, tables, reservations, recent orders)

**Files:**
- Modify: `apps/cafe/components/dashboard/{RankedList,RangeCards,LiveFloorPanel,TodayReservations,RecentOrders}.tsx`,
  `apps/cafe/lib/table-status.ts` (`TABLE_STATUS_META` colours to the 4.2 vocabulary: Available ok, Occupied info,
  Reserved reserved), `apps/cafe/lib/table-status.test.ts` (its tints)
- Modify: `apps/cafe/lib/dashboard-layout-paths.test.ts`

**Interfaces:**
- Consumes: `STATUS_CLASSES`, `PAYMENT_KIND`, `PAY_PILL_KIND`, `CHANNEL_KIND`, `TABLE_KIND`, `RESERVATION_KIND` (Task 3),
  `StatusPill` (Task 6).
- Produces: `RankedRow` gains `barClass?: string` (default stays the literal `"bg-brand-primary/85 "` …, pinned by
  `brand-contrast`); `PaymentMixCard` adds a stacked mix bar (one segment per mode, width = share) above its rows and a
  `StatusDot` per row; `ChannelsCard` passes `barClass` per channel; `TodayReservations` and `RecentOrders` use
  `StatusPill` (no raw palette left in either file).

- [ ] **Step 1: Extend the test:** the two cards import `PAYMENT_KIND` / `CHANNEL_KIND`; `TodayReservations.tsx` and
  `RecentOrders.tsx` contain no `-(blue|green|gray|red|yellow|purple|orange|slate)-[0-9]` class; `RankedList.tsx` still
  contains `bg-brand-primary/85 `; `LiveFloorPanel.tsx` still references `TABLE_STATUS_META` and has no
  `bg-(green|red|amber)-500` (existing pins); `table-status.test.ts` measures ink and muted ≥ 4.5 on the three new tints
  (`#defbe6`, `#edf5ff`, `#f6f2ff`) and the danger pair.
- [ ] **Step 2: Run; expect FAIL.**
- [ ] **Step 3: Implement.** The `/tables` Floor page takes the new table colours through the shared meta (the same
  vocabulary everywhere; its layout is untouched).
- [ ] **Step 4: Run + `tables-floor-paths`, `table-areas-picker-paths`, `brand-contrast`, `dashboard-paths`; expect PASS.**
- [ ] **Step 5: Chain, typecheck, lint; commit** `feat(dashboard): category and status colours from the one palette …`.

## Phase E: docs, seeds, verification, the owner's check

### Task 20: Docs and seeds

**Files:**
- Modify: `docs/GO-LIVE-CHECKLIST.md` §6 "Staff accounts" (PINs: set on the Staff page; first sign-in per device with
  username and password; then name + PIN; the screen lock and its setting; "Log out when handing it over" stays true for
  a device that leaves the cafe), a new "Existing cafes: the PIN and new-look release" section;
  `apps/cafe/README.md` / `DEPLOY.md` lines about the 30-day sign-in; `apps/cafe/scripts/seed-admin.ts` (optional
  `SEED_ADMIN_PIN`, validated with `staffPinProblem`), `apps/cafe/scripts/seed-demo/seed-core.ts` + `people-data.ts`
  (demo staff get PINs: priya `2468`, rahul `1357`, amit `8642`; the admin `9753`)
- Modify: `apps/cafe/lib/go-live-runbook.test.ts` (§6 must mention "PIN" and "first time on each device")

- [ ] **Step 1: Failing pin in `go-live-runbook.test.ts`.** **Step 2: Run; FAIL.** **Step 3: Write the docs and seeds.**
  **Step 4: Run it + the cafe chain; PASS; run `verify:seed-demo:live` against its scratch DB; PASS.** **Step 5: Commit**
  `docs(go-live): staff PINs, the first sign-in per device and the screen lock …`.

### Task 21: Verification (everything, before the review)

- [ ] **Suites:** shared suite; cafe chain, typecheck, lint; `npm run test:print-tools`, `test:release-native` at the root;
  mobile and desktop suites once (untouched, to confirm). Record each count against the base (main `4388752`).
- [ ] **Live legs:** `verify:staff-pin:live`, and the existing `verify:bootstrap:live`, `verify:dashboard:live`,
  `verify:print:live`, `verify:appearance:live` on their own scratch DBs.
- [ ] **Build:** a production build in a D:\kd build worktree (webpack cache off: `config.cache = false` in its
  uncommitted `next.config.ts`), the route count as before plus the three new API routes.
- [ ] **Geist `tnum`:** in headless Chrome on the built page, `"0000"` and `"1111"` measure the same width with
  `font-variant-numeric: tabular-nums` (else report; the spec relies on it).
- [ ] **The paper:** the S1 pin and `print-budget.test.ts` unchanged (in the chain); and a computed-style comparison of
  the slip previews (Settings → Bill print, Kitchen ticket, Tokens previews and the Test print slip) between the base
  build (`D:\kd\p4b-new`) and the new build: every element's computed `color`, `font-*`, `border-*`, `background-color`
  and box size identical; if any differ, hold the slip root in `globals.css` (never a slip file) and re-check.
- [ ] **Screens:** `tools\baseline.mjs` with `FOLD=1` on `pos_scratch_e2e_4g_uibase` (its admin gets the PIN `9753` and
  two staff PINs first) → every page's phone and desktop first screen next to `baseline-fold\`: same content, layout and
  words, the new look; `/login`, `/` and the shell changed on purpose; the lock screen and the PIN pad at 390, 820, 1024
  and 1280; the diner menu `/m` in two presets (new shapes, the cafe's colours).
- [ ] **Emulator (WebView 109):** as in memory (pm path and the start screen first, `10.0.2.2:9100` for the fake printer,
  the put-back, `adb shell sync` before `adb emu kill`): first sign-in with the password, then lock → PIN unlock; a user
  switch while a test slip prints (it prints once); a cart with unsent items survives a switch (Review Focus 1); `/pos`,
  `/orders`, the printer panel, the dashboard.
- [ ] **Accessibility** (`chrome-devtools-mcp:a11y-debugging`, local page only): contrast of the new pairs, focus rings on
  the pad and the sidebar, 44 px targets, the cover's focus containment.
- [ ] **Requests:** a counting proxy log of an idle signed-in dashboard for 10 minutes, base vs new: no new request kind
  and the same rate.

### Task 22: The fresh review, the Results, the owner's check and merge OK

- [ ] A fresh Claude Fable 5.1 reviewer (read-only, probes in a junction-linked D:\kd worktree; it deletes every
  junction, `.bin` included, before any worktree removal; on HTTP 429 wait for the reset, tell the owner, never switch
  models). A Critical or Important finding is fixed by TDD in its own commit.
- [ ] Append "### U0 (the new look, PIN sign-in and screen lock, sidebar, dashboard)" to the redesign plan's Results
  (`docs/superpowers/plans/2026-10-16-ui-redesign.md`): commits, counts, RED/GREEN, screenshots' folder, the review, the
  deviations.
- [ ] Serve the new build at `http://localhost:3110` on `pos_scratch_e2e_4g_uibase` (the env file in
  `D:\kd\pos-dev-keep\ui-redesign\e2e\`), with the demo PINs, left running for the owner (long-lived background,
  `timeout: 7200000`); tell the owner the address and the PINs.
- [ ] Update the memory (`ui-redesign-2026-10.md`, `android-build-env-this-pc.md` lessons).
- [ ] Ask the owner for the merge OK, saying plainly: merged alone, this changes every page's look at once (each page's
  layout stays until its own session), changes the login, adds the PIN and the lock, and cafes must set PINs after the
  deploy. The push is a separate word. Then write the next session's prompt (the first page, with a fill-in section for
  the owner's design) into `D:\kd\pos-dev-keep\ui-redesign\`.
