# Settings hub in the new UI (plan)

**The owner's ask (2026-11-09, s110):** they deployed main d7d3a3d and checked Settings > Tokens & numbering on phone,
tablet and PC: all fine. Bill print and Kitchen ticket are already redesigned ("usko kuch nahi karna hai"). Notifications
is still hidden (owner 2026-10-03), so the next page picked is the **Settings hub** (`/settings`), in the look
**"Groups me list"** (AskUserQuestion with previews, the Recommended option).

**Decisions:**
- **Groups**, in the sidebar's order: **Your cafe** (Business details, GST & taxes) · **Printing** (Bill print, Kitchen
  ticket, Tokens & numbering) · **Diners** (QR ordering, Rewards & loyalty, Appearance). Hidden Notifications has a group
  too (Diners, last), so bringing it back needs no change to the grouping.
- **Look:** each group is an h2 title over one card. The card is a list of link rows, and each whole row is the link: an
  icon tile, the section's title and its one line (the words are unchanged), and a chevron. Rules sit between rows. One
  column at every width, in the same narrow shell as the section pages (`max-w-3xl`).
- **Scope:** the hub page; the group map in `lib/settings-sections.ts` (pure, node-tested); the hub class constants in
  `lib/settings-card-layout.ts`. The sidebar sub-menu stays a flat list.

**Base:** `main` d7d3a3d. Branch `feat/ui-settings-hub`.

**Rules:** as in `2026-11-06-settings-business-ui.md`: UI only (the same links, words, icons and section list); tokens
only (no `brand-*`, `color-mix()`, `/NN` colour opacity, `light-dark()`, `backdrop-blur`; `overflow-clip`); rows ≥ 44 px;
files ≤ 300 lines; pins move only on purpose.

## The work (main thread)

**`lib/settings-sections.ts`:** `settingsHubGroups(sections)` returns the groups in order (`cafe`, `printing`, `diners`),
each with its title and the sections it was given in their given order; a group with none is left out. The slug → group
map is a total `Record<SettingsSectionSlug, …>`, so a new slug without a group fails tsc.

**`lib/settings-card-layout.ts`:** the `SETTINGS_HUB_*` classes (stack, group, group title, list card, item rule, row,
icon tile, row title, row line, chevron). The row's focus ring is inset, because the card clips the rows' hover to its
corners.

**`app/(dashboard)/settings/page.tsx`:** `settingsHubGroups(VISIBLE_SETTINGS_SECTIONS)` → a `section` named by its h2,
then a `ul` of `li` rows. Each row is an `AppLink` to `settingsSectionPath(slug)`. Still a server component.

**Pins:**
- New `lib/settings-hub-layout.test.ts`: the constants, every class on its own element (once), the row's structure,
  heading levels (one h2 per group, no h1/h3, no `<p>` in a link), raw-byte bans.
- `settings-sections.test.ts`: the grouping (order, every section once, hidden comes back in Diners, empty groups out).
- `settings-shell-paths.test.ts`: the hub pin moves on purpose. The page maps
  `settingsHubGroups(VISIBLE_SETTINGS_SECTIONS)` and then `group.sections`, and never the raw list.

**Verify:** in `apps/cafe`: the touched suites, `npm test`, `npx tsc --noEmit`, `npm run lint`; mutants on the new pins;
one fresh read-only review (diff file + HEAD copies). The owner's device pass is the acceptance.

## Results

**Built (2026-11-09, s110, branch `feat/ui-settings-hub` off `main` d7d3a3d).** The Settings hub now lists the sections in
three groups, each an h2 over one card of link rows: **Your cafe** (Business details, GST & taxes) · **Printing** (Bill
print, Kitchen ticket, Tokens & numbering) · **Diners** (QR ordering, Rewards & loyalty, Appearance). Each row has an icon
tile, the title, the line and a chevron, and the whole row is the link. Rows are 64 px tall at least, with an inset focus
ring because the card clips. The links, words, icons, header and the narrow shell are unchanged. The page is still a
server component, and hidden Notifications still has no row (its group is Diners if it comes back).

**Pins:** new `lib/settings-hub-layout.test.ts` (4 tests: constants, classes on their elements once + row structure,
heading levels, raw-byte bans); `settings-sections.test.ts` +1 (the grouping); `settings-shell-paths.test.ts` hub pin
moved on purpose (maps `settingsHubGroups(VISIBLE_SETTINGS_SECTIONS)` then `group.sections`, never the raw list).
RED first: 6 failures before the code, all for the missing grouping / page.

**Checks:** cafe `npx tsc --noEmit` 0; `npm run lint` 0 errors (2 warnings, untouched `masters-blob.test.ts`);
`npm test` 8218/8218 (8213 + 5). Shared and hub untouched (last measured 1079 / 288 at d7d3a3d). Mutation pass 18/18
caught; afterwards the tree matched the reviewed diff by hash. One fresh opus review (diff file + HEAD copies): nothing
found in any of the five areas (behaviour, markup, styling, pin blindness, repo rules). Not measured: a real-browser
render at 360 / 768 / 1280 px (that is the owner's device pass).
