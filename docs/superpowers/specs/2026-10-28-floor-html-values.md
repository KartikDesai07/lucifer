# The owner's HTML mock-up, exact values: the Floor screen and what it opens

Source files (read-only, `D:\kd\pos-dev-keep\ui-redesign\design\`): `unpacked/markup.html` (template: Floor screen lines 905–947 — page container 906, header 907–911, body 912, controls row 913–925, area sections 926–943, empty line 944), `unpacked/app.js` (`renderVals()` from line 737: the `Lay` object = `L` on 742–743 with `pagePad`, `screenPadB`, `tileMin`, `tileH`, `headPad`, `miniLogo`; the floor view-model on 778–786 — `ordTot`/`mins` 778, `openTable` 779, `RESV`/`tState` 780, `ST` 781, `fk` 782, `allT` 783, `counts` 784, `areas` 785, `occupied` 786; the values handed to the template on 912–915 — `floorSummary`, `areaTabs`, `tFilters`, `areas`, `noTables`; `newOrder` 928; `TABLES` 65; `RESV0` 72–76; `resMap()` 194; `ROLES` 48; `SEG_ON`/`SEG_OFF` 6; `RS` 2; `hm` 56; the seed orders 97), and the original bundle `olivea-pos-latest.html` (generated hover classes; it confirms the header button's label "Takeaway").

The theme tokens, fonts, global rules, keyframes and shared constants are in **U0 values** = `docs/superpowers/specs/2026-10-19-u0-html-values.md` §0–§1; the shell (side nav, rail, page-header frame, mini logo, printer button, tab bar, More/profile sheet, toast) in U0 §2. The Order screen a tile tap or the header button opens is in **U1 values** = `docs/superpowers/specs/2026-10-20-pos-html-values.md`. They are referred to by section number and not repeated; this document records only what the Floor screen adds. Colour tokens are written `var(--x)` with the resolved light value (measured `rgb()`); every token's light and dark value is in U0 §1.1. Format and method copy U2 (`docs/superpowers/specs/2026-10-22-orders-html-values.md`).

**Naming note for the reader of the brief:** the brief calls the header's outline button "New order". In the HTML it reads **"Takeaway"** (plus icon, outline style) and its handler is the shared `newOrder` (new Takeaway order, route `order`). It opens no popover or menu (section 8.1). This document uses the HTML's word.

How values were obtained:
- Every value without a "measured" mark is copied verbatim from the source text (inline `style="…"` strings, `renderVals()` expressions, handler strings).
- "Measured" values come from rendering `olivea-pos-latest.html` in headless local Chrome 156.0.8078.48 (`C:/Program Files/Google/Chrome/Application/chrome.exe`) driven by playwright-core 1.64.0-alpha (the npx-cache copy U1/U2 used), every non-`file:`/`data:`/`blob:` request aborted (none was attempted: 0 blocked; the only console errors are the bundle's own `file://…/.image-slots.state.json` fetch refused by Chrome's CORS rule, as in U2), on 2026-10-28, reading `getBoundingClientRect()`, `getComputedStyle()` and `document.getAnimations()`. Rects are `[x, y, width, height]` in CSS px (rounded to 0.01). Tool: `D:\kd\pos-dev-keep\ui-redesign\design\measure-floor.mjs`; states: `make-shoot-floor.mjs` → `shoot-floor.json` (60 states, 187 runs = 187 shots, plus 21 mid-animation shots = 208 PNG; the first pass had 43 states / 120 runs, a completeness pass the same day added 17 states — fonts, press, new-tile animation, reduced motion, dark theme, many tables, classic scrollbars — and widened 12 states to all five viewports: 67 more runs); raw results `measure-floor-out\json\<state>-<vp>.json` (named boxes, element trees with computed styles, every tile's box / detail text / ellipsis / colours / animation delay, the live floor view-model taken from `renderVals()`, the generated `scpN` hover rules, `getAnimations()` lists, the focused element with its outline, four `elementFromPoint` hit tests); printer: `summarize-floor.mjs` (`boxes <state> [regex]`, `tree <state> <vp> header|controls|body|ov:<overlay>`, `style`, `meta`, `vals <state> <vp> [key]`, `tiles <state> [vp]`, `sections <state>`, `anims <state> <vp>`, `scp <state> <vp>`, `panels`).
- Viewports (as U0 / U1 / U2): `d1280` 1280×800; `c1280` 1280×800 after a click on `button[title='Collapse']`; `t1024` 1024×768 `hasTouch`; `t820` 820×1180 `hasTouch`; `p390` 390×844 `isMobile`+`hasTouch`. Device-pixel-ratio 1, except state `default-dpr2` (ratio 2 at 1280 and 390). Headless Chrome draws no classic scrollbars (as in U0), except in state `many-scrollbar` (9.1). `prefers-color-scheme` light and `prefers-reduced-motion: no-preference` everywhere except the `dark*` (theme patch) and `reduced-motion` states.
- Entry to every state: load, wait 2500 ms, click `text=Rohan K.` (or `Amit V.` / `Priya S.` where a state says so), wait 500 ms, type `1234` (60 ms per key), wait 2800 ms, [collapse], click `nav button[title='Floor']` (phone: the fixed tab bar's button whose text is exactly "Floor"), wait 2300 ms. Rohan (Manager) lands on Dashboard, Priya (Cashier) on Order; **Amit (Captain) lands on Floor directly** (state `captain`: no nav click, then 4200 ms so the sign-in toast is gone). Then the state's actions (each click is a real mouse click at the element's centre; tile taps scroll the tile to the centre first), then the pointer is parked 21 px into the page header's left edge (y 28; nothing there has a hover look) unless the state measures a hover, then 900 ms (1200 ms after a route change), then shot + measurement.
- The demo data already holds every tile kind (free, occ, kot, billed, res), so no state needed data made first. Only `long` / `long-rooftop` add data, by a state patch inside the page (section 4.6). The `dark*` states patch `themeO:'Dark'` inside the page (what the profile sheet's theme switch sets; `applyTheme()` runs on every update). Nothing was written outside the page, with one exception made for "many tables": `TABLES` is a module constant, so the `many*` states load a **local copy** of the mock-up whose `TABLES` literal is replaced (written by `measure-floor.mjs` to `measure-floor-out\variant-many.html`; the original file is unchanged; section 2.6 / 4.7). `many-scrollbar` runs in a Chrome launched without Playwright's default `--hide-scrollbars`, so the page draws classic scrollbars as desktop Chrome / Electron on Windows does (9.1); `reduced-motion` runs with `prefers-reduced-motion: reduce` (7).

---

## 0. Conventions for this screen

### 0.1 Clock used
`Date` fixed with `page.clock.setFixedTime(new Date("2026-10-19T21:30:00+05:30"))` = **Monday 19 October 2026, 9:30 PM IST** (as U1 / U2). Clock-dependent values on this screen and their formulas:
- Tile minutes: `mins(x) = max(1, round((nowMs − (x.opened || nowMs)) / 60000))` with `nowMs = +s.now`; written `m+' min'` with **no hour rollover** ("68 min", "135 min"). `s.now` refreshes only when 30 s have passed (U1 §0.1), so tile minutes move at most every 30 s. Demo: Table 1 opened 8:22 PM → "68 min"; Table 17 → "55 min"; Table 6 → "41 min"; Table 4 → "32 min"; Table 13 → "22 min"; Table 7 → "14 min".
- Reservation note: `resMap()` (app.js 194) uses `Date.now()` (live, not `s.now`): today's reservations (`dkey(at) === today`) that have a table, status `booked` or `confirmed`, and `at > now − 30 min`, sorted by time; the first per table wins; value `hm(at)+' · '+name`.
- Demo reservations are made relative to the load time (`RESV0`, `rt(m) = round((now + m min) / 15 min) × 15 min`): at 9:30 PM → Table 3 "9:45 PM · Rahul Mehta" (`rt(10)`), Table 16 "10:15 PM · Kapoor family" (`rt(45)`), Table 9 "11:00 PM · Priya Menon" (`rt(90)`). Infosys team on Table 21 (`rt(150)`) falls at **12:00 AM the next day**, so it is not "today" and Table 21 is Available; at U0's noon clock it was a fourth reservation. The reserved count therefore depends on the hour.

### 0.2 Breakpoint variables, the content width and the tile grid
`ph`, `tab`, `desk`, `wide`, `cmp`, `big` exactly as U0 §0.1. The Floor adds no variable of its own; its grid is `repeat(auto-fill, minmax(L.tileMin, 1fr))` with `gap:10px`, so the browser picks the column count: `n = floor((W + 10) / (tileMin + 10))`, track `= (W − 10(n − 1)) / n`, where `W` = the body's inner width (window − nav − 2 × side padding).

| | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| nav width (U0 §2.1) | 232 | 76 | 76 | 76 | 0 |
| body inner width `W` (measured) | 1000 | 1156 | 900 | 696 | 362 |
| `tileMin` | 140px | 140px | 140px | 140px | 104px |
| columns (measured `grid-template-columns`) | **6** × 158.328 / 158.344 | **7** × 156.562 / 156.578 | **6** × 141.656 / 141.672 | **4** × 166.5 | **3** × 114 |
| tile height (`tileH`, min-height; content never grows it) | 112 | 112 | 112 | 112 | 100 |
| tile inner width (track − 2 border − 24 padding) | 132.33 | 130.56–130.58 | 115.66–115.67 | 140.5 | 88 |
| rows: Indoor 12 / Patio 6 / Rooftop 4 | 2 / 1 / 1 | 2 (7+5) / 1 / 1 | 2 / 1 / 1 | 3 / 2 (4+2) / 1 | 4 / 2 / 2 (3+1) |
| controls row | one line | one line | one line | **two lines** | **two lines**, pills scroll sideways |
| page scrolls (demo data) | no (content ends at y 733) | no (733) | no (733 of 768) | no (1019 of 1180) | **yes**, 383 px (1227 in 844) |
| page scrolls (48 tables, `many`) | 812 (1612 in 800) | 690 (1490) | 844 (1612 in 768) | 798 (1978 in 1180) | 1592 (2436 in 844) |
| with a classic 8 px page scrollbar (`many-scrollbar`, 9.1) | `W` 992 → 6 × **157** | 1148 → 7 × 155.422 / 155.438 | 892 → 6 × 140.328 / 140.344 | 688 → 4 × 164.5 | – (phones overlay their scrollbars) |

### 0.3 `L` keys used by this screen, resolved
| Key | Expression (verbatim) | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|---|
| `headPad` | `ph?'0 12px':'0 20px'` | `0 20px` | same | same | same | `0 12px` |
| `miniLogo` | `ph?'flex':'none'` | none | none | none | none | flex |
| `pagePad` | `ph?'16px 14px':'20px 24px'` | `20px 24px` | same | same | same | `16px 14px` |
| `screenPadB` | `ph?'92px':'28px'` (overrides the bottom of `pagePad`) | 28px | 28px | 28px | 28px | 92px |
| `tileMin` | `ph?'104px':'140px'` | 140px | 140px | 140px | 140px | 104px |
| `tileH` | `ph?'100px':'112px'` | 112px | 112px | 112px | 112px | 100px |

Measured body padding: `20px 24px 28px 24px` (d1280, c1280, t1024, t820), `16px 14px 92px 14px` (p390). Nothing else in `L` is read by the Floor markup.

### 0.4 Screen state (component `state`) and defaults
`area` ('All' | 'Indoor' | 'Patio' | 'Rooftop', default 'All') and `tfilter` ('all' | 'free' | 'occ' | 'billed' | 'res', default 'all'). Both live in the app component, so they **survive leaving and re-entering the Floor and a change of signed-in user** (neither `nav()`, `go()`, `signIn()` nor `doLock()` resets them); a reload resets them. The two are independent: picking an area keeps the status filter and the reverse.

### 0.5 Rendering conventions (as U0 §0.2–§0.4, U1 §0.5, U2 §0.5, plus what this screen adds)
- Interpolations are `<span class="sc-interp">` wrappers. In flex containers the binding and the literal text are separate flex items with the container gap between them: pills (dot · 7 · label · 7 · count), tile label row (dot · 6 · label).
- `line-height: normal` = 1.3 × font-size (U0 §0.3). Text-box heights measured here: 12px→16, 12.5px→17, 13px→17, 13.5px→18, 14px→18, 15px→19, 20px→26. Explicit line-height: header title 1.2 (15px → 18).
- **Borders written `1.5px` (the tiles) compute and draw as `1px` in this Chrome at every device-pixel-ratio**: measured `border-width: 1px` at DPR 1 and in `default-dpr2` at DPR 2; a separate local check in the same Chrome 156 gave a 1.5px border `1px` at DPR 1, 2 and 3 (`clientWidth` 98 of a 100px box). Other engines (Safari, Firefox, older Chromium / Android WebView) may draw 1.5 px on dense screens: not measured. The tile's outer box is unchanged (the grid sets it).
- **Fonts (measured, state `fonts`, d1280 and p390):** every text on the Floor — header title and subtitle, Takeaway, area tabs, pills and their counts, section names and counts, the tile number, seats, label and detail line, the empty line — computes `font-family: Geist` (U0 §1.3 body stack `'Geist',system-ui,-apple-system,'Segoe UI',sans-serif`), `font-variant-numeric: tabular-nums` and `-webkit-font-smoothing: antialiased` (inherited from `html,body`, also inside the buttons); the mini logo alone is Shrikhand. **No Geist Mono on this screen**: the tile amounts ("₹1,063 · 68 min") are Geist with tabular figures, while the Orders list writes its amounts in Geist Mono (U2 §3, §8, §9). Weights used: 400, 500, 600.
- Buttons with no `font-size` compute 13.3333px: the tiles and the printer button (no visible text uses it: every text has its own size). The printer button keeps the UA padding `1px 6px` (U2 §0.5).
- **Static hover / active strings** become generated classes (measured rule text): Takeaway `.scpa:hover{background:var(--surface-2) !important}`; printer `.scp4:hover{background:var(--hover) !important}`; tile `.scpj:hover{transform:translateY(-3px) !important; box-shadow:rgba(0,0,0,.1) 0 12px 28px !important}` and `.scpk:active{transform:scale(.98) !important}`. **No hover rule** on the area tabs or the status pills. Because the tile rules are `!important` they beat the tile's finished `rise` animation (whose `both` fill keeps `transform` set): measured, the hover lift works.
- The tile's inline `transition:transform .3s cubic-bezier(.2,.8,.2,1),box-shadow .3s` **replaces** the global button transition list (U0 §1.4) on tiles (measured `transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.3s`), so a tile has no colour transition; area tabs, pills, Takeaway and printer keep the global list (`background-color .16s ease, border-color .16s ease, color .16s ease, box-shadow .22s ease, transform .16s ease, opacity .16s ease`).
- The tile's finished `rise` animation leaves `transform: matrix(1,0,0,1,0,0)` on every tile (measured), i.e. each tile is its own stacking context.
- No element on this screen has `aria-*`, `role`, `title` (except the printer button) or a designed focus style (section 6.3).

### 0.6 Dark theme, resolved on this screen (measured: `dark` d1280 + p390, `dark-f-occ`, `dark-hover-tile`, `dark-hover-new` d1280)
The markup uses tokens only (no literal colour) except the mini logo's `#FFFFFF` text and the tile hover shadow `rgba(0,0,0,.1)`. Dark token values are in U0 §1.1; measured on the Floor (boxes identical to light):

| Element | Light (sections 1–5) | Dark (measured) |
|---|---|---|
| page background `var(--bg)` | `rgb(244,244,245)` | `rgb(14,14,16)` (U0) |
| header bg / bottom border | `rgb(255,255,255)` / `rgb(226,226,230)` | `rgb(23,23,26)` / `rgb(46,46,51)` |
| title / subtitle, section name / count, seats, detail line | `rgb(24,24,27)` / `rgb(82,82,91)` | `rgb(244,244,245)` / `rgb(169,169,178)` |
| Takeaway, printer: bg / border / text; hover bg | white / `rgb(226,226,230)` / `rgb(24,24,27)`; `rgb(250,250,250)`, printer `rgb(242,242,244)` | `rgb(23,23,26)` / `rgb(46,46,51)` / `rgb(244,244,245)`; Takeaway hover **`rgb(28,28,32)`** (`--surface-2`, 1.06:1 against the button at rest), printer hover `--hover` `#222226` (source, not run); printer dot `rgb(66,190,101)` with a `rgb(23,23,26)` ring |
| mini logo (phone) | `rgb(200,56,31)`, white "O" | `rgb(255,123,94)` (`--brand` dark), white "O" (literal `#FFFFFF`) |
| segmented track / on chip / chip shadow | `rgb(233,233,236)` / white / `rgba(0,0,0,.12) 0 1px 2px, rgba(0,0,0,.04) 0 0 0 .5px` | `rgb(39,39,43)` / `rgb(58,58,64)` / `rgba(0,0,0,.5) 0 1px 2px 0` (`--seg-sh` dark); tab text `rgb(244,244,245)` |
| pill off: bg / border / text / count | white / `rgb(226,226,230)` / `rgb(24,24,27)` / `rgb(107,107,116)` | `rgb(23,23,26)` / `rgb(46,46,51)` / `rgb(244,244,245)` / `rgb(128,128,138)` |
| pill on (`dark-f-occ`): bg = border / label / count | `rgb(24,24,27)` / white / `rgb(107,107,116)` | **`rgb(244,244,245)`** / **`rgb(23,23,26)`** (`--surface`; `--on-ink` would be `#0E0E10`) / `rgb(128,128,138)` (3.56:1 on the light pill) |
| pill dots | ok / info / bill / res as 2.4 | `rgb(66,190,101)` / `rgb(69,137,255)` / `rgb(241,194,27)` / `rgb(165,110,255)` (measured on the pills) |
| tile `free`: bg / border / dot / label | white / `rgb(226,226,230)` / `rgb(36,161,72)` / `rgb(25,128,56)` | `rgb(23,23,26)` / `rgb(46,46,51)` / `rgb(66,190,101)` / `rgb(111,220,140)` |
| tile `occ` | `rgb(237,245,255)` / `rgb(166,200,255)` / `rgb(15,98,254)` / `rgb(0,67,206)` | `rgba(69,137,255,.13)` / `rgba(69,137,255,.45)` / `rgb(69,137,255)` / `rgb(166,200,255)` |
| tile `kot` | as occ, dot `rgb(255,131,43)`, label `rgb(186,78,0)` | as occ, dot **`rgb(255,131,43)`** (`--warn` is the same in dark), label `rgb(255,183,132)` |
| tile `billed` | `rgb(252,244,214)` / `rgb(241,194,27)` / `rgb(178,134,0)` / `rgb(142,106,0)` | `rgba(241,194,27,.1)` / `rgba(241,194,27,.45)` / `rgb(241,194,27)` / `rgb(241,194,27)` (dot and label the same colour) |
| tile `res` | `rgb(246,242,255)` / `rgb(212,187,255)` / `rgb(138,63,252)` / `rgb(105,41,196)` | `rgba(165,110,255,.13)` / `rgba(165,110,255,.45)` / `rgb(165,110,255)` / `rgb(190,149,255)` |
| tile number | `rgb(24,24,27)` | `rgb(244,244,245)` |
| tile hover (`dark-hover-tile`, T6) | lift 3 px + `rgba(0,0,0,.1) 0 12px 28px` | same lift and the **same literal shadow**, which is all but invisible on `rgb(14,14,16)` |
| phone tab bar (U0 §2.6) | `var(--glass)` | `rgba(23,23,26,.9)`, top border `rgb(46,46,51)`, inactive tabs `rgb(169,169,178)` |

Shots `dark-1280x800.png`, `dark-390x844.png`, `dark-f-occ-1280x800.png`, `dark-hover-tile-1280x800.png`, `dark-hover-new-1280x800.png`. Dark was not run at c1280 / t1024 / t820 (no layout difference: every box equals the light run).

---

## 1. Page container and header

### 1.1 Page container (`sc-if on.floor`)
`div` (no `data-screen-label`, unlike Orders): `display:{{ S.floor }}` (`flex` on route `floor`); `flex-direction:column; min-width:0; min-height:0; overflow:auto; animation:pageIn .4s cubic-bezier(.2,.8,.2,1) backwards`. **The page itself is the scroller** (unlike Orders, whose page does not scroll): header and body scroll together inside it and the header stays on top by `position:sticky`. Measured: d1280 `[232,0,1048,800]`, c1280 `[76,0,1204,800]`, t1024 `[76,0,948,768]`, t820 `[76,0,744,1180]`, p390 `[0,0,390,844]`; `scrollHeight` 800 / 800 / 768 / 1180 / **1227** (p390 scrolls 383 px; the others do not scroll with the demo data).

### 1.2 Header elements (verbatim)
| Element | Properties |
|---|---|
| header | `display:flex; align-items:center; gap:12px; padding:{{ L.headPad }}; min-height:56px; background:var(--surface); border-bottom:1px solid var(--border); position:sticky; top:0; z-index:3`. Sticky like the dashboard header (U0 §2.5), gap 12 like Orders (U2 §1.2; the dashboard's is 10). Measured `position: sticky; top: 0px; z-index: 3`, background `rgb(255,255,255)`, bottom border `rgb(226,226,230)`. |
| Mini logo | as U0 §2.5 (phone only, 30×30, radius 8, `var(--brand)` `rgb(200,56,31)`, Shrikhand 19px "O" white, `padding-top:2px`), `flex:none`. |
| Title block | `div style="flex:1;min-width:0"`. Title "Floor": `font-weight:600; font-size:15px; line-height:1.2` (h 18), colour inherited `var(--text)` `rgb(24,24,27)`. Subtitle `{{ floorSummary }}`: `font-size:12px; color:var(--text-2)` (`rgb(82,82,91)`)`; white-space:nowrap; overflow:hidden; text-overflow:ellipsis` (h 16). |
| **Takeaway** | `button` click `newOrder` (section 8.1): `border:1px solid var(--border)` (measured `rgb(226,226,230)`)`; background:var(--surface)` (`rgb(255,255,255)`)`; color:var(--text)` (`rgb(24,24,27)`)`; border-radius:8px; height:36px; padding:0 12px; font-weight:500; font-size:13.5px; cursor:pointer; white-space:nowrap; display:flex; align-items:center; gap:6px`; hover `background:var(--surface-2)` (measured `rgb(250,250,250)`). Plus icon `svg 14×14 stroke-width 2.4 stroke-linecap round` (no linejoin), path `M12 5v14M5 12h14`. Label "Takeaway" (a bare text node: always shown, also on the phone). No `title`, no `flex:none` (it does not shrink in practice). Outline style here; the Orders / Dashboard "New order" (U2 §1.2, U0 §2.5) and the Order screen's "New" (U1 §1.2) are filled `var(--accent)` buttons with the same handler. |
| Printer | as U0 §2.5: `position:relative; flex:none; 36×36; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text)` (measured `rgb(226,226,230)` / `rgb(255,255,255)` / `rgb(24,24,27)`; UA padding `1px 6px`, font-size 13.3333px, no text), centred; hover `background:var(--hover)` (measured `rgb(242,242,244)`); `title="{{ pr.title }}"` = "Printer · printing is on"; icon 17×17 stroke 1.8; status dot `10×10` at `top:-3px; right:-3px`, `{{ pr.dot }}` = `var(--ok)` `rgb(36,161,72)`, ring `0 0 0 2px var(--surface)`. Opens the printer panel (a later page; not measured here). |

### 1.3 Measured header (state `default`)
| Element | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| header | `[232,0,1048,56]` | `[76,0,1204,56]` | `[76,0,948,56]` | `[76,0,744,56]` | `[0,0,390,56]` |
| mini logo | hidden | hidden | hidden | hidden | `[12,12.5,30,30]` |
| title block | `[252,10.5,839.66,34]` | `[96,10.5,995.66,34]` | `[96,10.5,739.66,34]` | `[96,10.5,535.66,34]` | `[54,10.5,155.66,34]` |
| "Floor" | `[252,10.5,839.66,18]` | `[96,10.5,…,18]` | `[96,10.5,…,18]` | `[96,10.5,…,18]` | `[54,10.5,155.66,18]` |
| subtitle (box / text) | `[252,28.5,839.66,16]` / text 158.11 | `[96,28.5,…]` / 158.11 | `[96,28.5,…]` / 158.11 | `[96,28.5,…]` / 158.11 | `[54,28.5,155.66,16]` / text 158.11 → **ellipsised** "6 of 22 occupied · 3 reserv…" |
| Takeaway | `[1103.66,9.5,108.34,36]` (icon `[1116.66,20.5,14,14]`) | same | `[847.66,9.5,108.34,36]` | `[643.66,9.5,108.34,36]` | `[221.66,9.5,108.34,36]` (icon `[234.66,20.5,14,14]`) |
| printer | `[1224,9.5,36,36]` (icon `[1233.5,19,17,17]`, dot `[1252,7.5,10,10]`) | same | `[968,9.5,36,36]` | `[764,9.5,36,36]` | `[342,9.5,36,36]` (dot `[370,7.5,10,10]`) |

Gaps: title block → 12 → Takeaway (108.34 = 1 + 12 + icon 14 + 6 + label 62.34 + 12 + 1) → 12 → printer → 20 (12 on the phone) right padding. On the phone: 12 | logo 30 | 12 | title block 155.66 | 12 | Takeaway 108.34 | 12 | printer 36 | 12.

### 1.4 Subtitle words
`floorSummary = occupied+' of '+allT.length+' occupied · '+(counts.res||0)+' reserved'` with `occupied = counts.occ + counts.billed` (KOT-pending tables are inside `counts.occ`, section 11.4). Demo "6 of 22 occupied · 3 reserved"; state `long` "9 of 22 occupied · 4 reserved". It counts all 22 tables whatever the area tab or status filter.

---

## 2. Body and the controls row

### 2.1 Body
`div`: `padding:{{ L.pagePad }}; padding-bottom:{{ L.screenPadB }}; display:flex; flex-direction:column; gap:16px`. Children in order: the controls row, one `section` per area that has tiles (section 3), and the empty line when there are none (section 5.2). Measured (state `default`): d1280 `[232,56,1048,677]`, c1280 `[76,56,1204,677]`, t1024 `[76,56,948,677]`, t820 `[76,56,744,963]`, p390 `[0,56,390,1171]`. Vertical sum at d1280: 20 + controls 36 + 16 + Indoor 263 + 16 + Patio 141 + 16 + Rooftop 141 + 28 = 677; p390: 16 + 78 + 16 + 459 + 16 + 239 + 16 + 239 + 92 = 1171.

### 2.2 Controls row
`div`: `display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between`. Two children: the area segmented control (2.3) and the status pills (2.4).

| | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| row | `[256,76,1000,36]` one line | `[100,76,1156,36]` one line | `[100,76,900,36]` one line | `[100,76,696,78]` **two lines** | `[14,72,362,78]` **two lines** |
| segmented | `[256,76,262.06,36]` | `[100,76,262.06,36]` | `[100,76,262.06,36]` | `[100,76,262.06,36]` | `[14,72,262.06,36]` |
| pills row | `[698.67,78,557.33,32]` (right edge, centred in the 36 line) | `[698.67,78,557.33,32]` | `[442.67,78,557.33,32]` | `[100,122,557.33,32]` (second line, left) | `[14,118,362,32]` (second line, **scrolls**: 557 in 362) |

One line needs `262.06 + 10 + 557.33 = 829.39` px of body width (demo counts), i.e. a window ≥ 953.39 px with the rail (with the wide nav, which exists only from 1280, it always fits); the free space between the two groups is 180.61 (d1280), 336.61 (c1280), 80.61 (t1024). On the second line the pills sit at the left (space-between with one item). The pills row width follows the counts' digits (state `long`: 549.38).

### 2.3 Area segmented control (`areaTabs`, app.js 913)
| Element | Properties |
|---|---|
| Track | `div`: `display:flex; background:var(--surface-3)` (`rgb(233,233,236)`)`; border-radius:8px; padding:2px; gap:2px; max-width:100%; overflow-x:auto`. Height 36 = 2 + 32 + 2. |
| Tab | `button` per `areaTabs` (`['All', ...TABLES areas]` = All, Indoor, Patio, Rooftop) click `a.onClick` (`area:a`): `border:0; border-radius:6px; height:32px; padding:0 14px; font-weight:500; font-size:13.5px; cursor:pointer; background:{{ a.bg }}; color:var(--text); box-shadow:{{ a.shadow }}; white-space:nowrap`. On = `SEG_ON` (`bg var(--seg)` `rgb(255,255,255)`, `shadow var(--seg-sh)` measured `rgba(0,0,0,.12) 0 1px 2px 0, rgba(0,0,0,.04) 0 0 0 .5px`); off = `SEG_OFF` (transparent, none). Text colour and weight are the same on and off (`rgb(24,24,27)`, 500): only the white chip marks the choice. No hover rule, no `aria-pressed`/`role`. |

Measured tabs (every viewport the same widths): All 44.48 (text 16.48), Indoor 68.67 (40.67), Patio 60.16 (32.16), Rooftop 78.75 (50.75), all 32 tall; x at d1280 258 / 304.48 / 375.16 / 437.31 (y 78); c1280, t1024, t820 102 / 148.48 / 219.16 / 281.31; p390 16 / 62.48 / 133.16 / 195.31 (y 74). The track never overflows at the five sizes (`scrollWidth` 262 = `clientWidth` 262 everywhere; at 390 it leaves 99.94 px free).

### 2.4 Status pills (`tFilters`, app.js 914)
| Element | Properties |
|---|---|
| Row | `div`: `display:flex; gap:6px; overflow-x:auto; max-width:100%`. No padding, no fade, no visible scrollbar (the global rule is `::-webkit-scrollbar{width:8px;height:0}` + thumb `background:var(--border); border-radius:8px`, U0 §1.4: horizontal bars are 0 tall, vertical bars 8 px wide — see 9.1 for the page's own vertical bar). |
| Pill | `button` click `f.onClick` (`tfilter:k`): `display:flex; align-items:center; gap:7px; flex:none; border:1px solid {{ f.border }}; background:{{ f.bg }}; color:{{ f.color }}; border-radius:999px; height:32px; padding:0 12px; font-size:13px; font-weight:500; cursor:pointer; white-space:nowrap`. No hover rule. |
| · dot | `span`: `display:{{ f.dotDisplay }}; width:8px; height:8px; border-radius:50%; background:{{ f.dot }}` (hidden on "All"). |
| · label | `{{ f.label }}` (sc-interp text). |
| · count | `span style="color:{{ f.countColor }}"` `{{ f.count }}` — same 13px / 500 as the label. |

Values (verbatim): keys and labels `all` "All", `free` "Available", `occ` "Occupied", `billed` "Bill printed", `res` "Reserved" (no pill for `kot`); `count = counts[k] || 0` (over all 22 tables, **ignoring the area tab**); `dot = k==='all' ? var(--text-2) : ST[k][3]` → Available `var(--ok)` `rgb(36,161,72)`, Occupied `var(--info)` `rgb(15,98,254)`, Bill printed `var(--bill)` `rgb(178,134,0)`, Reserved `var(--res)` `rgb(138,63,252)`; on: `bg var(--ink)` `rgb(24,24,27)`, `border var(--ink)`, `color var(--surface)` (white), off: `bg var(--surface)`, `border var(--border)` `rgb(226,226,230)`, `color var(--ink)`; `countColor = on ? var(--text-3) : var(--text-3)` — **grey `rgb(107,107,116)` in both states** (3.36:1 on the black pill).

Measured (state `default`, d1280; every viewport has the same widths, only x/y move): All `[698.67,78,64.8,32]` (label `[711.67,85.5,15.88,17]`, count "22" `[734.55,85.5,15.92,17]`); Available `[769.47,78,119.3,32]` (dot `[782.47,90,8,8]`, label `[797.47,85.5,55.38,17]`, count "13" `[859.84,85.5,15.92,17]`); Occupied `[894.77,78,114.13,32]` (label 58.16, count "5" 7.97); Bill printed `[1014.89,78,121.91,32]` (label 65.94, count "1" 7.97); Reserved `[1142.8,78,113.2,32]` (label 57.23, count "3" 7.97). Width = 2 + 24 + [8 + 7] + label + 7 + count.
Pill x per viewport: c1280 as d1280; t1024 442.67 / 513.47 / 638.77 / 758.89 / 886.8 (y 78); t820 100 / 170.8 / 296.09 / 416.22 / 544.13 (y 122); p390 14 / 84.8 / 210.09 / 330.22 / 458.13 (y 118).

### 2.5 The pills on the phone (states `default`, `pills-end`, `pills-end-res`)
At 390 the pills row is 362 wide for 557.33 of pills (`scrollWidth` 557): "Bill printed" is cut by the row's right edge at x 376 (45.78 of its 121.91 px visible, "Bill" readable) and "Reserved" is entirely out of view; nothing shows that the row scrolls. Swiped to the end (`pills-end`, `scrollLeft` 195): All `[-181,118,64.8,32]`, Available `[-110.2,…]`, Occupied `[15.09,…]`, Bill printed `[135.22,…]`, Reserved `[263.13,118,113.2,32]` (right edge 376.33). Tapping a pill does not scroll the row by itself (in `pills-end-res` the row was scrolled by the test so the tap could reach "Reserved"; shot `pills-end-res-390x844.png` shows the black "Reserved 3" pill at the right end). At 820 the pills fit on their own line (557.33 in 696); at 1024 and wider they share the line with the area tabs.

### 2.6 More areas and long area names (states `many`, `many-seg-end`, `many-area-bar`; local copy with 6 areas, see "How values were obtained")
Areas in the copy: Indoor, Patio, Rooftop, **Private dining room**, **Garden terrace**, **Bar counter** (48 tables). Tab widths (13.5px / 500, `0 14px` padding, every viewport): All 44.48, Indoor 68.67, Patio 60.16, Rooftop 78.75, Private dining room **150.17** (text 122.17), Garden terrace 122.48, Bar counter 102.3; track `2 + tabs + 6 × 2 + 2` = **643.02** wide.

| | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| controls row | `[256,76,1000,78]` **two lines** | `[100,76,1156,78]` two lines | `[100,76,900,78]` two lines | `[100,76,696,78]` two lines | `[14,72,362,78]` two lines |
| segmented track | `[256,76,643.02,36]` | `[100,76,643.02,36]` | `[100,76,643.02,36]` | `[100,76,643.02,36]` | `[14,72,362,36]`, **scrolls** (`scrollWidth` 643, 281 px hidden) |
| pills row | `[256,122,557.33,32]` (second line, left) | `[100,122,…]` | `[100,122,…]` | `[100,122,…]` | `[14,118,362,32]`, scrolls as 2.5 |

- With six areas the controls wrap at every size: 643.02 + 10 + 557.33 = 1210.35 > 1156 (c1280), so the row takes two lines (78 tall) and every section moves 42 px down (Indoor y 170 at ≥ 1024). The row stays on one line while track + 10 + pills ≤ `W` (0.2): by that arithmetic a single added "Private dining room" (track 414.23, total 981.56) would still fit at d1280 (1000) and c1280 (1156) but wrap at t1024 (900) — not rendered.
- **Phone:** the track is capped at `max-width:100%` (362) and scrolls sideways with no visible cue: at rest "Private dining room" is cut at the track's right edge (x 376; shot `many-390x844.png`), "Garden terrace" and "Bar counter" are out of view. Scrolled to the end (`many-seg-end`, `scrollLeft` 281): All `[-265,74]` … Private dining room `[-4.94,74,150.17,32]` (cut at the left edge), Garden terrace `[147.23,74,122.48,32]`, Bar counter `[271.72,74,102.3,32]` (right edge 374.02 = track inner edge). The grey track spans the full 362 at all scroll positions; only the tabs move. Tapping a tab does not scroll the track (the test scrolled first, `many-area-bar`): the white chip then sits on "Bar counter" at the right end (shot `many-area-bar-390x844.png`), and the page shows only "Bar counter · 4 tables".
- Section heads with long names: "Private dining room" 139.06 wide, "Garden terrace" 107.81, "Bar counter" 84.55 (15px / 600, one line; the count follows 8 px later).

---

## 3. Area sections

### 3.1 Elements (verbatim)
| Element | Properties |
|---|---|
| Section | `section` per `areas` entry: `display:flex; flex-direction:column; gap:10px`. Only areas with at least one tile after both filters are listed (an area with none disappears; no "0 tables" heading). Order = `TABLES` order (Indoor, Patio, Rooftop). |
| Head | `div`: `display:flex; align-items:baseline; gap:8px`: name `span` `font-size:15px; font-weight:600` `{{ a.name }}` (h 19, `var(--text)`); count `span` `font-size:12px; color:var(--text-2)` `{{ a.count }}` (h 16, `rgb(82,82,91)`), baseline-aligned (3 px lower than the name box). |
| Count words | `a.count = tiles.length + (tiles.length===1 ? ' table' : ' tables')` — the tiles left after the filters ("12 tables", "3 tables", "1 table"). |
| Grid | `div`: `display:grid; grid-template-columns:repeat(auto-fill,minmax({{ L.tileMin }},1fr)); gap:10px` (column count and tracks: 0.2). Row height = the tile's `min-height` (112 / 100). |

### 3.2 Measured (state `default`)
| Element | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| Indoor section | `[256,128,1000,263]` | `[100,128,1156,263]` | `[100,128,900,263]` | `[100,170,696,385]` | `[14,166,362,459]` |
| · head | `[256,128,1000,19]` (name 46.36 wide; "12 tables" `[310.36,131,51.58,16]`) | `[100,128,1156,19]` ("12 tables" x 154.36) | `[100,128,900,19]` | `[100,170,696,19]` (y 173) | `[14,166,362,19]` ("12 tables" `[68.36,169,51.58,16]`) |
| · grid | `[256,157,1000,234]` | `[100,157,1156,234]` | `[100,157,900,234]` | `[100,199,696,356]` | `[14,195,362,430]` |
| Patio section | `[256,407,1000,141]` (grid y 436) | `[100,407,1156,141]` | `[100,407,900,141]` | `[100,571,696,263]` (grid `[100,600,696,234]`) | `[14,641,362,239]` (grid `[14,670,362,210]`) |
| Rooftop section | `[256,564,1000,141]` (grid y 593) | `[100,564,1156,141]` | `[100,564,900,141]` | `[100,850,696,141]` (grid y 879) | `[14,896,362,239]` (grid `[14,925,362,210]`) |

Name widths: Indoor 46.36, Patio 36.8, Rooftop 57.95; count widths: "12 tables" 51.58, "6 tables" / "4 tables" 44.38; count x = name x + name width + 8. Section height = 19 + 10 + rows × tile height + (rows − 1) × 10.

Tile positions (state `default`, `[x, y]`, every tile `158.33×112` at d1280, `156.56/156.58×112` c1280, `141.66/141.67×112` t1024, `166.5×112` t820, `114×100` p390):
- d1280: Indoor row 1 y 157 (x 256, 424.33, 592.66, 760.98, 929.33, 1097.66 = T1–T6), row 2 y 279 (T7–T12); Patio y 436 (T13–T18); Rooftop y 593 (T19–T22 at x 256 … 760.98).
- c1280: Indoor y 157 T1–T7 (x 100, 266.56, 433.14, 599.7, 766.28, 932.84, 1099.42), y 279 T8–T12; Patio y 436; Rooftop y 593.
- t1024: x 100, 251.66, 403.33, 555, 706.66, 858.33; y 157 / 279 / 436 / 593.
- t820: x 100, 276.5, 453, 629.5; Indoor y 199 / 321 / 443; Patio y 600 / 722; Rooftop y 879.
- p390: x 14, 138, 262; Indoor y 195 / 305 / 415 / 525; Patio y 670 / 780; Rooftop y 925 / 1035.

---

## 4. Tiles

### 4.1 Elements (verbatim)
| Element | Properties |
|---|---|
| Tile | `button` click `t.onClick` = `openTable(name)` (section 8.2): `text-align:left; border:1.5px solid {{ t.border }}; background:{{ t.bg }}; border-radius:14px; padding:12px; min-height:{{ L.tileH }}; display:flex; flex-direction:column; justify-content:space-between; gap:8px; cursor:pointer; color:var(--text); font-family:inherit; animation:rise .5s cubic-bezier(.2,.8,.2,1) both; animation-delay:{{ t.d }}; transition:transform .3s cubic-bezier(.2,.8,.2,1),box-shadow .3s`; hover `transform:translateY(-3px); box-shadow:0 12px 28px rgba(0,0,0,.1)`; active `transform:scale(.98)`. No `title`, no `aria-label` (the accessible name is the whole text, e.g. "T1 4 seats Bill printed ₹1,063 · 68 min"). |
| · top row | `span`: `display:flex; justify-content:space-between; align-items:flex-start; width:100%`: short `span` `font-size:20px; font-weight:600; letter-spacing:-.01em` (measured −0.2px) `{{ t.short }}` = `'T'+n` (h 26, `var(--text)`); seats `span` `font-size:12px; color:var(--text-2)` `{{ t.seats }}` = `seats+' seats'` (h 16, `rgb(82,82,91)`, top-aligned with the "T1" box, right edge). |
| · bottom block | `span`: `display:flex; flex-direction:column; gap:2px; width:100%`. |
| · · label row | `span`: `display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:500; color:{{ t.labelColor }}`: dot `span` `width:7px; height:7px; border-radius:50%; background:{{ t.dot }}`, then `{{ t.label }}` (h 17). |
| · · detail | `span`: `font-size:12.5px; color:var(--text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis` `{{ t.detail }}` (h 17, `rgb(82,82,91)` on every kind). |

### 4.2 Tile kinds (`ST`, app.js 781: `[label, bg, border, dot, labelColour]`)
| Kind (`t.st.k`) | Label | Background | Border | Dot | Label colour | Pill it counts in |
|---|---|---|---|---|---|---|
| `free` | Available | `var(--surface)` `rgb(255,255,255)` | `var(--border)` `rgb(226,226,230)` | `var(--ok)` `rgb(36,161,72)` | `var(--ok-i)` `rgb(25,128,56)` | Available |
| `occ` | Occupied | `var(--info-t)` `rgb(237,245,255)` | `var(--info-b)` `rgb(166,200,255)` | `var(--info)` `rgb(15,98,254)` | `var(--info-i)` `rgb(0,67,206)` | Occupied |
| `kot` | KOT pending | `var(--info-t)` `rgb(237,245,255)` | `var(--info-b)` `rgb(166,200,255)` | **`var(--warn)` `rgb(255,131,43)`** | **`var(--warn-i)` `rgb(186,78,0)`** | Occupied (`fk`) |
| `billed` | Bill printed | `var(--bill-t)` `rgb(252,244,214)` | `var(--bill-b)` `rgb(241,194,27)` | `var(--bill)` `rgb(178,134,0)` | `var(--bill-i)` `rgb(142,106,0)` | Bill printed |
| `res` | Reserved | `var(--res-t)` `rgb(246,242,255)` | `var(--res-b)` `rgb(212,187,255)` | `var(--res)` `rgb(138,63,252)` | `var(--res-i)` `rgb(105,41,196)` | Reserved |

All colours measured in state `default` (T2 free, T6 occ, T4 kot, T1 billed, T3 res). The KOT tile is a blue (occupied) card with an orange dot and orange label.

### 4.3 Words and formulas (app.js 785)
- `short = 'T'+n`; `seats = seats+' seats'` (every table has 2–8 seats, so always plural).
- `label = ST[k][0]`.
- `detail = t.st.amt != null ? RS(amt)+' · '+m+' min' : (t.st.note || 'Tap to seat guests')` — open orders (occ, kot, billed): bill total incl. service charge and GST (`totals(x).tot`, unsent items included) and minutes since opened (0.1); reserved: `hm(at)+' · '+name`; free: "Tap to seat guests".
- Demo details: T1 "₹1,063 · 68 min", T4 "₹954 · 32 min", T6 "₹768 · 41 min", T7 "₹439 · 14 min", T13 "₹536 · 22 min", T17 "₹767 · 55 min", T3 "9:45 PM · Rahul Mehta", T9 "11:00 PM · Priya Menon", T16 "10:15 PM · Kapoor family", the 13 free tables "Tap to seat guests".
- `d = Math.min(ti*.03, .45).toFixed(2)+'s'` — the animation delay (section 7).

### 4.4 Measured tile anatomy (state `default`; free tile T2, the other kinds identical apart from colours and words)
| Element | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| tile T2 | `[424.33,157,158.33,112]` | `[266.56,157,156.58,112]` | `[251.66,157,141.67,112]` | `[276.5,199,166.5,112]` | `[138,195,114,100]` |
| top row | `[437.33,170,132.33,26]` | `[279.56,170,130.58,26]` | `[264.66,170,115.67,26]` | `[289.5,212,140.5,26]` | `[151,208,88,26]` |
| "T2" | `[437.33,170,23.77,26]` | `[279.56,170,23.77,26]` | `[264.66,170,23.77,26]` | `[289.5,212,23.77,26]` | `[151,208,23.77,26]` |
| "2 seats" | `[529.78,170,39.88,16]` | `[370.27,170,39.88,16]` | `[340.45,170,39.88,16]` | `[390.13,212,39.88,16]` | `[199.13,208,39.88,16]` |
| bottom block | `[437.33,220,132.33,36]` | `[279.56,220,130.58,36]` | `[264.66,220,115.67,36]` | `[289.5,262,140.5,36]` | `[151,246,88,36]` |
| label row | `[437.33,220,132.33,17]` | `[279.56,220,…,17]` | `[264.66,220,…,17]` | `[289.5,262,…,17]` | `[151,246,88,17]` |
| dot | `[437.33,225,7,7]` | `[279.56,225,7,7]` | `[264.66,225,7,7]` | `[289.5,267,7,7]` | `[151,251,7,7]` |
| "Available" | `[450.33,220,53.25,17]` | `[292.56,220,53.25,17]` | `[277.66,220,53.25,17]` | `[302.5,262,53.25,17]` | `[164,246,53.25,17]` |
| detail | `[437.33,239,132.33,17]` | `[279.56,239,130.58,17]` | `[264.66,239,115.67,17]` | `[289.5,281,140.5,17]` | `[151,265,88,17]` |

Vertical rhythm: border 1 + padding 12 → top row 26 → free space (24 at 112 tall, 12 at 100; `gap:8px` is only the minimum) → bottom block 36 (17 + 2 + 17) → padding 12 + border 1. The bottom block therefore sits at tile y + 63 (112) / + 51 (100). Other widths: "T13"… "T22" 36.05; labels "Occupied" 55.92, "KOT pending" 73.98, "Bill printed" 63.41, "Reserved" 55.03; "4 seats" / "6 seats" / "8 seats" 39.88.

### 4.5 Detail line fit per tile (state `default`; `scrollWidth`/`clientWidth` of the detail span, **cut** = ellipsised)
| Tile | Kind | Detail | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|---|---|
| T1 | billed | ₹1,063 · 68 min | fits 132 | fits 131 | fits 116 | fits 141 | **cut** 89 > 88 ("₹1,063 · 68 m…") |
| T3 | res | 9:45 PM · Rahul Mehta | fits | fits | **cut** 129 > 116 | fits | **cut** 129 > 88 |
| T4, T13 | kot | ₹954 · 32 min / ₹536 · 22 min | fits | fits | fits | fits | fits 88 |
| T6, T7, T17 | occ | ₹768 · 41 min / ₹439 · 14 min / ₹767 · 55 min | fits | fits | fits | fits | fits |
| T9 | res | 11:00 PM · Priya Menon | **cut** 135 > 132 | **cut** 135 > 131 | **cut** 135 > 116 | fits 141 | **cut** 135 > 88 |
| T16 | res | 10:15 PM · Kapoor family | **cut** 143 > 132 | **cut** 143 > 131 | **cut** 143 > 116 | **cut** 143 > 141 | **cut** 143 > 88 |
| 13 free tiles | free | Tap to seat guests | fits | fits | fits | fits | **cut** 105 > 88 on every one ("Tap to seat gu…") |

Labels never overflow (the longest, "KOT pending" with its dot, is 86.98 wide in an 88 row at 390). Seats never collide with the number (narrowest gap 12.07 px at 390: "T13"…"T22" 36.05 + "n seats" 39.88 in 88).

### 4.6 Long texts (states `long`, `long-rooftop`: state patch inside the page)
Patch (`make-shoot-floor.mjs` `LONG`): reservation `{name:'Infosys leadership offsite team', at: today 10:00 PM, guests 8, table 'Table 21', status 'confirmed'}`; order `Table 20` #1050 opened 135 min ago, 4 × ₹2,450 sent; order `Table 22` #1051 billed, 2 × ₹60 sent, opened 7 min ago; order `Table 19` #1052, 1 × ₹180 not sent, 3 min ago. Results (Rooftop tiles):

| Tile | Kind | Detail | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|---|---|
| T19 | kot | ₹198 · 3 min | fits | fits | fits | fits | fits |
| T20 | occ | ₹10,805 · 135 min | fits | fits | fits | fits | **cut** 104 > 88 |
| T21 | res | 10:00 PM · Infosys leadership offsite team | **cut** 239 > 132 | **cut** 239 > 131 | **cut** 239 > 116 | **cut** 239 > 141 | **cut** 239 > 88 |
| T22 | billed | ₹132 · 7 min | fits | fits | fits | fits | fits |

Header "9 of 22 occupied · 4 reserved" (text still 158.11 wide: same digits count); pills Available 9 (pill 111.34 wide), Occupied 7, Bill printed 2, Reserved 4; pills row 549.38. Tiles keep their height (nothing wraps: one-line detail). The Rooftop section alone (`long-rooftop`): d1280 tiles at y 157, x 256 / 424.33 / 592.66 / 760.98; c1280 y 157, x 100 / 266.56 / 433.14 / 599.7; t1024 y 157, x 100 / 251.66 / 403.33 / 555; t820 y 199, x 100 / 276.5 / 453 / 629.5; p390 `[14,195]`, `[138,195]`, `[262,195]`, `[14,305]`. Shots `long-*.png`, `long-rooftop-*.png`.
"Many tables": the table list is the constant `TABLES` (22 tables, 12 in the largest area) and cannot be changed from the page; it was rendered from a local copy of the mock-up (4.7).

### 4.7 Many tables, the delay cap and 3-digit numbers (states `many`, `many-bottom`; local copy, 48 tables in 6 areas)
Copy's `TABLES`: the demo's 22, then "Private dining room" T23 (10 seats), T24 (12 seats); "Garden terrace" T25–T44 (20 tables, 2 / 4 / 6 seats); "Bar counter" **T101, T102, T103 (2 seats), T104 (12 seats)**. Orders and reservations unchanged (header "6 of 48 occupied · 3 reserved", pills All 48 · Available 39 · Occupied 5 · Bill printed 1 · Reserved 3; pills row still 557.33 wide).

| | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| body | `[232,56,1048,1556]` | `[76,56,1204,1434]` | `[76,56,948,1556]` | `[76,56,744,1922]` | `[0,56,390,2380]` |
| section y / height: Indoor, Patio, Rooftop, Private dining room, Garden terrace, Bar counter | 170/263, 449/141, 606/141, 763/141, 920/**507**, 1443/141 | 170/263, 449/141, 606/141, 763/141, 920/385, 1321/141 | as d1280 | 170/385, 571/263, 850/141, 1007/141, 1164/629, 1809/141 | 166/459, 641/239, 896/239, 1151/129, 1296/789, 2101/**243** |
| page scroll (`many-bottom`, at the end) | `scrollTop` 812: T101–T104 at y 660, last tile ends 772, 28 px padding to 800 | 690 | 844 | 798 | 1592: T104 `[14,650,114,102]` ends at 752, 33 px above the tab bar (as 9) |

- **Delay cap:** Garden terrace (20 tiles) delays 0, 30, … 420 ms for T25–T39, then **450 ms for T40–T44** (`min(i × .03, .45)`: the 16th tile onwards), so the last five rise together; its cascade ends at 950 ms.
- **3-digit numbers on the phone:** "T101" is 48.33 wide (20px / 600, −0.2px tracking; "T23" 36.05). At ≥ 820 everything fits ("T101" + "2 seats" 39.88 in 115.66–140.5). At **390** the top row has 88: "T101" 48.33 + "2 seats" 39.88 = 88.21 > 88, so the seats `span` shrinks to 39.67 and **wraps to two lines** ("2" / "seats", `[75.33,2143,39.67,32]`), touching the number with no gap; the top row grows to 32, so **T101–T103 and T104 are 102 tall instead of 100** (the whole grid row grows with them). "T104" + "12 seats" (47.08) wraps the same way. Two-digit numbers with "10 seats" / "12 seats" fit (36.05 + 47.08 = 83.13). Shot `many-area-bar-390x844.png` (Bar counter only).
- Long area names do not affect the tiles. Section count words stay "n tables".
- Shots `many-*.png` ×5, `many-bottom-*.png` ×5, `many-seg-end-390x844.png`, `many-area-bar-820x1180.png` / `-390x844.png`, `many-scrollbar-*.png` (4 sizes).

---

## 5. Area tabs and status filters: what they show

### 5.1 Every filter state (sections and counts; header and pills unchanged in every one: "6 of 22 occupied · 3 reserved", All 22 · Available 13 · Occupied 5 · Bill printed 1 · Reserved 3)
| State | `area` / `tfilter` | Sections shown (count words) | Body height d1280 / c1280 / t1024 / t820 / p390 |
|---|---|---|---|
| `default` | All / all | Indoor "12 tables", Patio "6 tables", Rooftop "4 tables" | 677 / 677 / 677 / 963 / 1171 |
| `area-indoor` | Indoor / all | Indoor "12 tables" | 363 / 363 / 363 / 527 / 661 |
| `area-patio` | Patio / all | Patio "6 tables" | 241 / 241 / 241 / 405 / 441 |
| `area-rooftop` | Rooftop / all | Rooftop "4 tables" | 241 / 241 / 241 / 283 / 441 |
| `f-free` | All / free | Indoor "6 tables" (T2, T5, T8, T10, T11, T12), Patio "3 tables" (T14, T15, T18), Rooftop "4 tables" | 555 / 555 / 555 / 719 / 841 (p390 page scrolls 53) |
| `f-occ` | All / occ | Indoor "3 tables" (T4 kot, T6, T7), Patio "2 tables" (T13 kot, T17) | 398 / 398 / 398 / 440 / 476 |
| `f-billed` | All / billed | Indoor "1 table" (T1) | 241 / 241 / 241 / 283 / 331 |
| `f-res` | All / res | Indoor "2 tables" (T3, T9), Patio "1 table" (T16) | 398 / 398 / 398 / 440 / 476 |
| `indoor-res` | Indoor / res | Indoor "2 tables" | 241 / 241 / 241 / 283 / 331 |
| `empty-rooftop-occ` | Rooftop / occ | none → empty line | 214 / 214 / 214 / 256 / 316 |
| `empty-patio-billed` | Patio / billed | none → empty line (box as `empty-rooftop-occ` at every size) | 214 / 214 / 214 / 256 / 316 |

Within a section, tiles keep `TABLES` order (T-number), never sorted by status. Picking a filter keeps the section headings of the areas that still have tiles; an area with none is dropped. The selected tab gets the white chip (2.3) and the selected pill turns black with white label and grey count (2.4); shots `area-*.png`, `f-*.png`.

### 5.2 Empty line (`sc-if noTables`, markup 944)
`div`: `text-align:center; padding:48px 0; color:var(--text-2); font-size:14px` "No tables match this filter." (h 114 = 48 + 18 + 48; `rgb(82,82,91)`). Measured (state `empty-rooftop-occ`): d1280 `[256,128,1000,114]`, c1280 `[100,128,1156,114]`, t1024 `[100,128,900,114]`, t820 `[100,170,696,114]`, p390 `[14,166,362,114]`. No icon, no "clear filter" action. It also shows when the area tab alone has nothing in that status (the pill counts, being over all areas, still read "Occupied 5" above it).

---

## 6. Hover, press and focus

### 6.1 Hover (d1280, c1280 only; pointer kept on the element; states `hover-*`)
| Element | Rule (generated class) | Measured result |
|---|---|---|
| Tile (free T2) | `.scpj:hover{transform:translateY(-3px) !important; box-shadow:rgba(0,0,0,.1) 0 12px 28px !important}` | d1280 `[424.33,154,158.33,112]` (3 px up), `transform: matrix(1,0,0,1,0,-3)`, `box-shadow: rgba(0,0,0,0.1) 0 12px 28px 0`; c1280 `[266.56,154,156.58,112]`. Background and border unchanged. Animated by the tile's own `.3s` transition. |
| Tile (occ T6) | same | d1280 `[1097.66,154,158.33,112]`, c1280 `[932.84,154,156.58,112]`; same lift and shadow on the tinted card. |
| Area tab (Indoor, off) | none | unchanged (transparent, `rgb(24,24,27)` text). |
| Pill (Available, off) | none | unchanged (`rgb(255,255,255)`, border `rgb(226,226,230)`). |
| Takeaway | `.scpa:hover{background:var(--surface-2) !important}` | background `rgb(250,250,250)` (from white; border, text unchanged). |
| Printer | `.scp4:hover{background:var(--hover) !important}` | background `rgb(242,242,244)`. |

Shots `hover-tile-free-*`, `hover-tile-occ-*`, `hover-area-*`, `hover-pill-*`, `hover-new-*`, `hover-printer-*` (1280, 1280 collapsed). Hover on touch viewports was not measured (a finger produces none).

### 6.2 Press (state `press-tile`, d1280: pointer on T2, mouse button held 400 ms)
`.scpk:active{transform:scale(.98) !important}` replaces the hover's translate (both `!important`; the active rule comes later) and the global `scale(.97)`: measured box `[425.91,158.12,155.16,109.76]` (98 % around the centre, back at its rest position), `transform: matrix(0.98,0,0,0.98,0,0)`, hover shadow kept; the tile takes focus without a focus ring (pointer focus). The area tabs, pills, Takeaway and printer get only the global `button:not(:disabled):active{transform:scale(.97)}` (U0 §1.4), animated by the global `transform .16s ease`. Measured (states `press-area`, `press-pill`, `press-new`, `press-printer`, d1280: pointer on the control, mouse button held 400 ms, so nothing is activated):

| Pressed control | Rest box | Pressed box | Other changes |
|---|---|---|---|
| Area tab "Indoor" (off) | `[304.48,78,68.67,32]` | `[305.51,78.48,66.61,31.04]`, `matrix(0.97,0,0,0.97,0,0)` | none: stays transparent (no hover or active colour), the white chip stays on "All" until the button is released (the `onClick` runs on release) |
| Pill "Available" (off) | `[769.47,78,119.3,32]` | `[771.26,78.48,115.72,31.04]`, scale .97 | none: white, border `rgb(226,226,230)` |
| Takeaway | `[1103.66,9.5,108.34,36]` | `[1105.28,10.04,105.09,34.92]`, scale .97 | hover background kept `rgb(250,250,250)` |
| Printer | `[1224,9.5,36,36]` | `[1224.54,10.04,34.92,34.92]`, scale .97 | hover background kept `rgb(242,242,244)` |

Each pressed control takes focus without a ring (pointer focus, `:focus-visible` false). Shots `press-area-`, `press-pill-`, `press-new-`, `press-printer-1280x800.png`.

### 6.3 Keyboard focus (states `focus-*`: the previous control focused by script, then Tab or Shift+Tab, so the focus is keyboard-made)
No focus style is written anywhere on the screen; Chrome's default ring applies on `:focus-visible`: measured `outline: auto 1px rgb(16,16,16)` (drawn as Chrome's dark ring hugging the border radius). Pointer and touch focus show nothing (`:focus-visible` false after a click).

| Focused element (Tab from …) | d1280 | c1280 | t1024 | t820 | p390 | Ring visible? |
|---|---|---|---|---|---|---|
| Takeaway (`focus-new2`: Shift+Tab from the printer; `focus-new` d1280: Tab from the nav's last button) | `[1103.66,9.5,108.34,36]` | same | `[847.66,9.5,108.34,36]` | `[643.66,9.5,108.34,36]` | `[221.66,9.5,108.34,36]` | yes |
| Printer (Tab from Takeaway) | `[1224,9.5,36,36]` | same | `[968,9.5,36,36]` | `[764,9.5,36,36]` | `[342,9.5,36,36]` | yes |
| Area tab "All" (Tab from the printer) | `[258,78,44.48,32]` | `[102,78,44.48,32]` | same as c1280 | same as c1280 | `[16,74,44.48,32]` | yes, inside the track's 2 px padding (shot `focus-area-1280x800.png`) |
| Pill "All" (Tab from the last area tab) | `[698.67,78,64.8,32]` | same | `[442.67,78,64.8,32]` | `[100,122,64.8,32]` | `[14,118,64.8,32]` | **no** at all five: the pills row (`overflow-x:auto`, no padding, same 32 px height) clips the ring, and the pill is black (shots `focus-pill-*.png`) |
| Tile T1 (Tab from the last pill) | `[256,157,158.33,112]` | `[100,157,156.56,112]` | `[100,157,141.66,112]` | `[100,199,166.5,112]` | `[14,195,114,100]` | yes, dark ring around the 14 px radius (shot `focus-tile-1280x800.png`) |

Every row measured `:focus-visible` true and `outline: auto 1px rgb(16,16,16)` at all five sizes (touch contexts included: the focus is keyboard-made).
Tab order: side nav (wide / rail) → Takeaway → printer → All, Indoor, Patio, Rooftop → the five pills → the tiles in `TABLES` order → (phone: the tab bar). Enter on a focused tile opens it (`focus-tile-enter`: route `order`, Table 1). The first `focus-new` run at 390 started from the tab bar's "Floor" button (focused by the navigation tap) and landed on the tab bar's "Order" (`[156,788,78,56]`); `focus-new2` is the valid phone measurement.

---

## 7. Animations and transitions

| What | Source | Measured |
|---|---|---|
| Page entrance | `animation:pageIn .4s cubic-bezier(.2,.8,.2,1) backwards` (opacity 0 → 1, `translateY(6px)` → none; U0 §1.5) | state `anim` (Orders → Floor): at 17 ms (d1280) page `translateY(4.98px)`, opacity 0.17; at 33 ms (p390) 3.99 px, 0.33; at 200 ms 0.32 px, 0.95 (d1280) / 217 ms 0.25 px, 0.96 (p390); done at 400 ms. |
| Tile rise | `animation:rise .5s cubic-bezier(.2,.8,.2,1) both` (opacity 0 → 1, `translateY(12px)` → none) with `animation-delay: min(i × 0.03, 0.45) s`, `i` = the tile's index **inside its area section after filtering** (restarts at 0 in every area) | delays measured (`getAnimations()`): Indoor T1–T12 0, 30, …, 330 ms; Patio T13–T18 0 … 150 ms; Rooftop T19–T22 0 … 90 ms. The 0.45 s cap is reached only from a section's 16th tile (never in the demo; measured with the 48-table copy: Garden terrace T40–T44 all 450 ms, 4.7). `both` fill: before its delay a tile is invisible and 12 px low. At 17 ms (d1280): T1 opacity 0.14, +10.37 px; T2 onwards opacity 0, +12 px. At 200 ms: T1 0.90 / +1.16 px, T2 0.86 / +1.64 px. At 483 ms: T1 0.9999, T6 0.98 / +0.21 px, T12 0.83 / +1.99 px (each tile at `(t − delay) / 500` of its curve). The cascade ends at 830 ms (T12: 330 + 500). Page and tiles run together, so a first-row tile travels 18 px in total. Shots `anim-t20-*`, `anim-t120-*`, `anim-t320-*` (nominal waits; real times above). The same run at c1280, t1024 and t820 (completeness pass) follows the same curves; its first snapshot fell at 0 ms (c1280, t820: page opacity 0, +6 px; tiles 0, +12 px) or 17 ms (t1024: page 0.17 / +4.99 px, T1 0.13 / +10.39 px), the second at 167 ms (page 0.91 / +0.53 px, T1 0.86 / +1.70 px); by the third the page animation was finished at every size. |
| Area tab / pill change | template reuses the tile elements by position | `anim-area` (All → Patio) and `anim-pill` (→ Available): 40 ms after the click every tile's `rise` reads *finished* — **no tile animation replays**; the tiles change content in place. Only the global button transitions run: the area tabs' `background-color .16s ease` and `box-shadow .22s ease`; the pills' `background-color`, `border-*-color`, `color` `.16s ease`. |
| Tiles that newly appear after a change | the template keeps elements by position (sections by index in `areas`, tiles by index in `a.tiles`) and creates only the missing ones | `anim-more-pill` (Bill printed → All; d1280, p390) and `anim-more-area` (Rooftop → All; d1280): **a tile element that did not exist before runs `rise` with its own delay; a reused element does not.** Bill printed → All: T1 (the one tile already there) stays *finished*; T2–T12 (new in the reused Indoor grid) rise with 30…330 ms delays, and the new Patio and Rooftop sections' tiles from 0 ms (T13 0, T19 0). Measured 50 ms after the click (`currentTime` 50): T2 opacity 0.16 / +10.06 px, T3 onwards 0 / +12 px, T13 0.40 / +7.24 px; at 283 ms T2 0.95 / +0.62 px, T12 0 / +12 px; at 483 ms T12 0.83 / +1.99 px. Rooftop → All: T1–T4 take over the four Rooftop tile elements and do not move (finished), T5–T12 rise with 120…330 ms delays, the new Patio and Rooftop sections' tiles from 0 ms. So the same change cascades fully, partly or not at all depending on how many tiles were on screen before. The new section heads have no animation (only the page and the tiles animate). Shots `anim-more-pill-t40-*.png`, `anim-more-area-t40-1280x800.png`. |
| Tile hover / press | tile `transition:transform .3s cubic-bezier(.2,.8,.2,1), box-shadow .3s` | section 6. |
| Takeaway / printer hover | global button transition (background `.16s ease`) | section 6.1. |
| Reduced motion | global `@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}` (U0 §1.4) — **durations only, delays kept** | `reduced-motion` (d1280, Orders → Floor, snapshot 33 ms after the nav click): page `pageIn 1e-05s`, tiles `rise 1e-05s … delay 0.03s both`, every transition `1e-05s`. The page appears at once, but **the tiles still appear one by one**: at 33 ms T1 and T2 are visible (finished), T3 onwards opacity 0 at +12 px until their delay passes; each tile pops in fully at its delay (30 ms steps, the last Indoor tile at 330 ms; with 16+ tiles in an area, up to 450 ms). No movement is seen. Shot `reduced-motion-t20-1280x800.png`. |

---

## 8. What the Floor opens

The Floor has **no dialog, sheet, popover or toast of its own** (no `sc-if` overlay in its markup). Escape only closes shell overlays (the global Escape list, U1 §13.2, has no Floor key) and Ctrl/⌘+L still locks (U0 §2.9); no Floor shortcut exists (`onKey` returns for any route but `order` after those two, app.js 123–125).

### 8.1 "Takeaway" (header; `newOrder`, app.js 928)
`seq++`; a new order `{id:'Takeaway '+(seq−1029), no:seq, type:'Takeaway', by:user, opened:now, disc:false, cart:[]}` is appended and made active; route `order` (U1 §14.2 "New"). Measured (`takeaway`, all five sizes): route `order`, active order "Takeaway 16" #1045, type Takeaway, 0 lines, 10 orders; no toast; the Floor's `area` / `tfilter` are kept for the way back. What appears is U1's Order screen with an empty Takeaway (not re-measured; shots `takeaway-*.png`). **It never asks for an order type**: no Takeaway / Delivery / Table menu exists on this button.

### 8.2 Tile tap (`openTable(name)`, app.js 779)
`i = s.orders.findIndex(x => x.id === name)`; if an order with that table id exists (with or without lines) → `active:i, route:'order'`; else `seq++` and a new order `{id:name, no:seq, type:'Dine-in', guests:2, by:user, opened:now, disc:false, cart:[]}` is appended, made active, route `order`. No role check, no confirmation, no guest-count question, no `cartOpen` change.

| State (1280, 390; `tap-free`, `tap-occ` at all five) | Tile | Result (measured) |
|---|---|---|
| `tap-free` | T2 (free) | new order "Table 2" #1045 Dine-in, 0 lines, guests 2 (source); 10 orders; route `order`; same at all five sizes; `cartOpen` stays false |
| `tap-occ` | T7 (occ) | existing "Table 7" #1041 (1 line) active; 9 orders; same at all five sizes. Below 1024 (t820, p390) U1's Order screen opens with the cart closed and the order bar showing (t820 bar `[76,1115,744,65]`, inner `[90,1128.5,569.94,39]`; p390 `[0,719,390,65]` / `[14,732.5,215.94,39]`); at 1024 and wider the cart column is visible. |
| `tap-kot` | T4 (kot) | existing "Table 4" #1040 (3 lines) |
| `tap-billed` | T1 (billed) | existing "Table 1" #1036 (3 lines) |
| `tap-res` | T3 (reserved) | **new empty order "Table 3" #1045**, guests 2 (not the booking's 4, no customer); the reservation stays `confirmed` (not seated) |
| `tap-free-back` | T2, then nav back to Floor | Floor identical to `default`: T2 still "Available · Tap to seat guests" (an order with no lines does not count; a second tap reopens the same empty "Table 2") |
| `focus-tile-enter` (1280) | T1 by keyboard Enter | as `tap-billed` |

On the phone and at 820 U1's order bar appears when the order has lines (`tap-occ` / `tap-kot` / `tap-billed` p390: `[14,732.5,215.94,39]`; `tap-occ` t820 `[90,1128.5,569.94,39]`; U1 §6.1).

### 8.3 Printer button
Opens the printer panel (`pr.open`, U0 §2.5) — a later page; only its box is recorded here (1.3).

---

## 9. Phone and tablets: tab bar, page scroll, sticky header

- **390:** the fixed tab bar (U0 §2.6, `[0,785,390,59]`, z 12, columns 78 × 5) sits over the scrolling page; Manager tabs Home, **Floor** (lit `var(--accent)` `rgb(15,98,254)`, `[78,788,78,56]`), Order, Orders, More; Captain and Cashier Floor (first tab, lit), Order, Orders, Kitchen, More. The page's 92 px bottom padding (`screenPadB`) leaves, at full scroll (`scroll-bottom`, `scrollTop` 383), the last tile T22 `[14,652,114,100]` ending at y 752, **33 px above the tab bar** (785); the body ends at 844. Hit test at `(195,814)` → the tab bar's svg. The header stays at `[0,0,390,56]` while the body moves to y −327 (sticky, z 3). Before scrolling, the Patio row 2 (T16–T18, y 780) is mostly under the tab bar.
- **820:** no scroll with the demo data (content ends at 1019; 161 px of `var(--bg)` below); `scroll-bottom` changes nothing. The controls row takes two lines (2.2).
- **1024, 1280:** no scroll (content ends at 733; 35 px / 67 px spare).
- Safe area: the Floor adds no `env(safe-area-inset-*)` of its own (the tab bar has `padding-bottom: env(safe-area-inset-bottom)`, U0 §2.6; 0 in every measurement).

### 9.1 The page's vertical scrollbar on a desktop browser (state `many-scrollbar`: 48 tables, Chrome with classic scrollbars)
The Floor page container is the scroller (1.1) and the global rule gives vertical scrollbars `width:8px` with a `var(--border)` thumb, radius 8, no track colour (U0 §1.4). Headless measurements hide scrollbars; with them shown (desktop Chrome / Electron on Windows, mouse) the bar appears only when the floor is taller than the window (never with the demo's 22 tables at the four larger sizes; always with 48):

| | d1280 | c1280 | t1024 | t820 |
|---|---|---|---|---|
| page `clientWidth` / `offsetWidth` | 1040 / 1048 | 1196 / 1204 | 940 / 948 | 736 / 744 |
| header (sticky, inside the scroller) | `[232,0,1040,56]`: Takeaway `[1095.66,9.5,…]`, printer `[1216,9.5,36,36]` (8 px left of the no-scrollbar position) | `[76,0,1196,56]`, same x | `[76,0,940,56]`, Takeaway x 839.66, printer x 960 | `[76,0,736,56]`, Takeaway x 635.66, printer x 756 |
| body / controls | `[232,56,1040,1556]` / `[256,76,992,78]` | `[76,56,1196,1434]` / `[100,76,1148,78]` | `[76,56,940,1556]` / `[100,76,892,78]` | `[76,56,736,1922]` / `[100,76,688,78]` |
| grid tracks | 6 × 157 | 7 × 155.422 / 155.438 | 6 × 140.328 / 140.344 | 4 × 164.5 |

The bar runs the full window height **beside the sticky header as well** (the header sits inside the scroller), so the header's right edge moves 8 px in when the floor gets long; column counts stay 6 / 7 / 6 / 4. (The 820 run used a desktop Chrome with touch emulation; a touch tablet would overlay its scrollbar and keep 744.) Shots `many-scrollbar-1280x800.png`, `-1280x800-collapsed.png`, `-1024x768.png`, `-820x1180.png`.

---

## 10. Roles and ways in

| | Manager (Rohan) | Cashier (Priya) | Captain (Amit) |
|---|---|---|---|
| Lands on after sign-in | Dashboard | Order | **Floor** (`ROLES.Captain.home`) |
| Floor in the side nav / tab bar | yes / 2nd tab | yes / 1st tab | yes / 1st tab |
| What the Floor shows and allows | everything above | identical (state `cashier`: every named box at all five sizes equal to `default`) | identical (state `captain`: every box at all five sizes equal to `default`) |

The Floor markup has no role branch: every role can tap any tile and create orders. Ways in besides the nav and the tab bar: the dashboard's "Floor →" link and Live-tables tiles (U0 §3.6), its attention chips "Open" (bills printed) and "Send" (KOT pending) (U0 §3.1), the Order screen's open-orders sheet "+ Table" (U1 §7, `{opOpen:false, route:'floor'}`), and returning to a locked session whose `lockedRoute` was `floor`.

---

## 11. View-model facts

### 11.1 Tables (`TABLES`, app.js 65; constant)
Indoor: T1 4, T2 2, T3 4, T4 4, T5 6, T6 2, T7 4, T8 4, T9 8, T10 2, T11 4, T12 6 seats. Patio: T13 4, T14 4, T15 2, T16 6, T17 4, T18 2. Rooftop: T19 4, T20 4, T21 8, T22 2. Table names are `'Table '+n`; an order belongs to a table only through `order.id === 'Table n'`.

### 11.2 Kind of a table (`tState(name)`, app.js 780)
1. `x = s.orders.find(z => z.id === name)` (the first order with that id). If `x` has lines: `k = x.billed ? 'billed' : (x.cart.some(y => !y.sent) ? 'kot' : 'occ')`, `amt = totals(x).tot`, `m = mins(x)`. **Bill printed wins over KOT pending** (a billed order with unsent items shows "Bill printed").
2. Else, if `resMap()` has the table → `res` with `note`.
3. Else `free`.
So an open order hides a reservation on the same table; an order with no lines (just opened from the Floor, paid, cancelled or seated from Reservations with nothing ordered yet) counts as free; a reservation more than 30 min late disappears (the table turns Available); a seated reservation never shows (status `seated` is excluded) until its first item makes the table occupied.

### 11.3 Demo data at the clock (seed orders, app.js 97; `RESV0`)
| Table | Order | Lines (sent?) | Kind | Detail |
|---|---|---|---|---|
| T1 | #1036, billed, 4 guests, opened 8:22 PM | 3 lines, all sent | billed | ₹1,063 · 68 min |
| T4 | #1040, Neha Joshi, 3 guests, 8:58 PM | Margherita, French Fries sent; Cold Coffee ×2 **not sent** | kot | ₹954 · 32 min |
| T6 | #1038, 2 guests, 8:49 PM | all sent | occ | ₹768 · 41 min |
| T7 | #1041, 2 guests, 9:16 PM | all sent | occ | ₹439 · 14 min |
| T13 | #1039, 4 guests, 9:08 PM | Paneer Butter Masala sent; Garlic Naan ×3 **not sent** | kot | ₹536 · 22 min |
| T17 | #1037, 3 guests, 8:35 PM | all sent | occ | ₹767 · 55 min |
| T3 | Rahul Mehta, confirmed, 4 guests | – | res | 9:45 PM · Rahul Mehta |
| T9 | Priya Menon, confirmed, 8 guests | – | res | 11:00 PM · Priya Menon |
| T16 | Kapoor family, booked, 5 guests | – | res | 10:15 PM · Kapoor family |
| other 13 | – | – | free | Tap to seat guests |

Not on the Floor: Takeaway 12 (no lines), Delivery 3, Takeaway 14; reservations without a table (Ananya Rao), seated (Neha Joshi on T4), done (T6), no-show (T12), cancelled, tomorrow's and later, and Infosys team (T21, 12:00 AM tomorrow at this clock).

### 11.4 Counts and words
- `fk(k) = k === 'kot' ? 'occ' : k`; `counts = {all: 22}` plus one per `fk(kind)` over all 22 tables → demo free 13, occ 5 (3 occupied + 2 KOT pending), billed 1, res 3.
- Pills show `counts[k] || 0` — whole floor, area ignored. The `occ` filter shows `kot` tiles too.
- Header: `occupied = counts.occ + counts.billed` → "6 of 22 occupied" (KOT pending and Bill printed included) — while the "Occupied" pill says 5 (Bill printed not included).
- Section count: the tiles after both filters, "1 table" / "n tables".
- Areas list: `TABLES.filter(area match).map(…).filter(a => a.tiles.length)`; `noTables = areas.length === 0`.
- The dashboard's Live tables (U0 §3.6) reads the same `tState` with other words: "Free" / "Eating" legend, "6 of 22 in use", line 2 "₹768 · 41m".

---

## 12. The HTML's own slips (each needs the owner's ruling before it is copied or fixed)

1. **Every free tile on the phone reads "Tap to seat gu…"** (105 px of text in an 88 px line, 13 tiles), and the bill tile "₹1,063 · 68 m…" is cut by 1 px; reservations are cut at every size from "11:00 PM · Priya Men…" / "10:15 PM · Kapoor fa…" (1280) to all three at 390 (4.5). Names are the part lost.
2. **"Tap to seat guests" promises a seating step that does not exist**: the tap opens a new Dine-in order with 2 guests fixed and asks nothing; the word "Available" on the tile and pill is the status, the second line is an instruction where every other kind shows data.
3. **A reserved tile, tapped, opens a new empty order on that table** without seating the reservation (guests 2, not the booking's; no customer; the booking stays "confirmed"), and the tile keeps saying "Reserved" until an item is added (8.2).
4. **KOT pending is a blue Occupied card with an orange dot and orange label** (`info-t` / `info-b` background and border, `warn` dot, `warn-i` text), and it has no pill of its own: it is counted and filtered under the blue "Occupied" pill.
5. **The header says "6 of 22 occupied" while the "Occupied" pill says 5**: the header adds Bill printed, the pill does not; the dashboard says "6 of 22 in use" and "Eating 5" / "Free 12" for the same tables (U0 §3.6, at its clock).
6. **Pill counts ignore the area tab**: with "Rooftop" chosen the pills still read "Occupied 5 · Bill printed 1 · Reserved 3" and choosing one shows "No tables match this filter." (`empty-rooftop-occ`).
7. **The active pill's count stays grey `var(--text-3)` on the black pill** (3.36:1; `countColor` is `text-3` in both branches) and its label uses `var(--surface)` instead of `var(--on-ink)`.
8. **On the phone the pills row hides "Reserved" and cuts "Bill printed" mid-pill** with no scroll cue (no scrollbar, no fade; 557 px in 362) (2.5).
9. **The pill focus ring is invisible** at all five sizes: the pills row's `overflow-x:auto` (no padding) clips Chrome's ring, and the active pill is black (6.3). Nothing on the screen has a designed focus style.
10. **The header button reads "Takeaway"** (outline) while the same `newOrder` handler is "New order" (filled accent) on Orders and the dashboard and "New" on the Order screen; on the dine-in Floor it is the only way to start a takeaway and there is no Delivery choice.
11. **Minutes have no hour rollover on tiles** ("68 min", "135 min") while Orders writes "1h 8m" and the dashboard "41m".
12. **No hover look on the area tabs and pills**, a near-invisible one on Takeaway (`#FFFFFF` → `#FAFAFA`), a 3 px lift + shadow on tiles.
13. **The phone header subtitle is ellipsised by 2.45 px**: "6 of 22 occupied · 3 reserv…".
14. **The tiles' `1.5px` border draws as 1 px** in Chrome at any pixel ratio (0.5); other engines may draw 1.5.
15. **An area with no matching tiles vanishes** (no "0 tables" heading) and the empty line offers no way to clear the filter; the filter and area survive leaving the page and a change of user (0.4).
16. **Seats sit top-aligned with the "T1" box** (`align-items:flex-start`): "4 seats" (12px, 16 tall) is level with the top of a 26-tall number, above its baseline.
17. **A late reservation disappears after 30 min** and the table shows Available; a seated reservation never shows and a table opened from the Floor with nothing ordered shows Available (11.2).
18. **Bill printed hides KOT pending**: a printed bill with new unsent items shows only "Bill printed" (11.2).
19. **Area / status changes animate inconsistently**: tile elements that already existed change in place with no animation, while tiles that did not exist before rise with their cascade delay — so All → Patio shows no motion, Bill printed → All makes T2–T22 rise around a still T1, and Rooftop → All keeps T1–T4 still and raises T5 onwards; entering the page cascades everything for up to 830 ms (7).
20. **At 820 the controls take two lines and leave 161 px of empty background at the bottom**; at 1024 the row fits with 80.61 px to spare, so one more area or a longer area name wraps it there; with six areas the controls take two lines at every size (2.6).
21. **A 3-digit table number breaks the phone tile**: "T101" (48.33) + "2 seats" (39.88) is 0.21 px wider than the 88 px row, so "2 seats" wraps onto two lines ("2" / "seats") glued to the number with no gap, and the tile — and with it its whole grid row — grows from 100 to 102 (4.7, shot `many-area-bar-390x844.png`).
22. **More or longer area names scroll the area control sideways on the phone with no cue**: with six areas the 643 px track scrolls in 362, "Private dining room" is cut mid-word and two tabs are out of view; tapping a half-hidden tab does not scroll it into view (2.6).
23. **Reduced motion keeps the cascade**: the global rule shortens durations but not delays, so with `prefers-reduced-motion: reduce` the tiles still pop in one by one over 330 ms (up to 450 ms) instead of appearing together (7).
24. **Dark theme**: the tile hover shadow is the literal `rgba(0,0,0,.1)` and is all but invisible on `#0E0E10`; the Takeaway hover is 1.06:1 against its rest colour; the active pill's label is `var(--surface)` (`#17171A`) rather than `var(--on-ink)` (`#0E0E10`); the KOT dot `var(--warn)` keeps the same orange in both themes while its label lightens (0.6).
25. **On a desktop browser the page's 8 px scrollbar runs beside the sticky header too** (the header lives inside the scroller), so when the floor grows past the window the header's Takeaway and printer buttons move 8 px left and the grid tracks narrow (9.1).
26. **Tile amounts are in Geist with tabular figures, not Geist Mono**, while the Orders list (U2) and the dashboard's money figures (U0 §3) use Geist Mono (0.5).

---

## 13. Measured layout per viewport

### 13.1 Regions (state `default`)
| Region | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| side nav / rail (U0 §2.3) | `[0,0,232,800]` | `[0,0,76,800]` | `[0,0,76,768]` | `[0,0,76,1180]` | hidden |
| page (Floor, scroller) | `[232,0,1048,800]` | `[76,0,1204,800]` | `[76,0,948,768]` | `[76,0,744,1180]` | `[0,0,390,844]`, scrolls 383 |
| header (sticky) | `[232,0,1048,56]` | `[76,0,1204,56]` | `[76,0,948,56]` | `[76,0,744,56]` | `[0,0,390,56]` |
| body | `[232,56,1048,677]` | `[76,56,1204,677]` | `[76,56,948,677]` | `[76,56,744,963]` | `[0,56,390,1171]` |
| controls row | `[256,76,1000,36]` | `[100,76,1156,36]` | `[100,76,900,36]` | `[100,76,696,78]` | `[14,72,362,78]` |
| Indoor / Patio / Rooftop | y 128 / 407 / 564 | 128 / 407 / 564 | 128 / 407 / 564 | 170 / 571 / 850 | 166 / 641 / 896 |
| grid columns | 6 × 158.33 | 7 × 156.57 | 6 × 141.67 | 4 × 166.5 | 3 × 114 |
| tab bar (U0 §2.6) | – | – | – | – | `[0,785,390,59]` |

### 13.2 Every measured state (what is on screen; "·" = not run at that size)
| State | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| `default`, `captain` (Amit V., lands on Floor), `cashier` (Priya S.) | Floor | Floor | Floor | Floor | Floor, scrolls 383 |
| `fonts` | Floor (font fields) | · | · | · | same |
| `area-indoor`, `area-patio`, `area-rooftop` | Floor (one area) | same | same | same | same |
| `f-free`, `f-occ`, `f-billed`, `f-res` | Floor (filtered) | same | same | same | same (`f-free` scrolls 53) |
| `empty-rooftop-occ`, `empty-patio-billed` | empty line | empty line | empty line | empty line | empty line |
| `indoor-res` | 2 tiles | 2 tiles | 2 tiles | 2 tiles | 2 tiles |
| `long`, `long-rooftop` | Floor / Rooftop (patched data) | same | same | same | same (`long` scrolls 383) |
| `scroll-bottom` | no scroll | no scroll | no scroll | no scroll | scrolled 383/383 |
| `pills-end`, `pills-end-res` | · | · | · | · | pills scrolled 195 |
| `many` (48 tables, 6 areas, local copy) | controls 2 lines, scrolls 812 | 690 | 844 | 798 | seg + pills scroll, page 1592 |
| `many-bottom` | scrolled to the end | same | same | same | same |
| `many-seg-end`, `many-area-bar` | · | · | · | Bar counter only (`many-area-bar`) | seg scrolled 281; Bar counter only |
| `many-scrollbar` (classic scrollbars) | 8 px page bar | same | same | same | · |
| `hover-tile-free`, `hover-tile-occ`, `hover-area`, `hover-pill`, `hover-new`, `hover-printer` | Floor + hover | Floor + hover | · | · | · |
| `press-tile`, `press-area`, `press-pill`, `press-new`, `press-printer` | pressed (mouse down) | · | · | · | · |
| `takeaway` | route `order` (Takeaway 16) | same | same | same | same |
| `tap-free`, `tap-occ` | route `order` (new Table 2 #1045 / Table 7) | same | same | same + order bar for Table 7 `[90,1128.5,569.94,39]` | same + order bar `[14,732.5,215.94,39]` for Table 7 |
| `tap-res` | route `order` (new Table 3, #1045) | · | · | · | same |
| `tap-kot`, `tap-billed` | route `order` (Table 4 / 1) | · | · | · | same + order bar `[14,732.5,215.94,39]` |
| `tap-free-back` | Floor = `default` | · | · | · | Floor = `default` |
| `anim` | Orders → Floor, 3 snapshots | same | same | same | same |
| `anim-area`, `anim-pill` | snapshot 40 ms after the click | · | · | · | · |
| `anim-more-pill` | Bill printed → All, 3 snapshots | · | · | · | same |
| `anim-more-area` | Rooftop → All, 2 snapshots | · | · | · | · |
| `reduced-motion` | Orders → Floor with reduced motion, 1 snapshot | · | · | · | · |
| `dark` | Floor, dark theme | · | · | · | same |
| `dark-f-occ`, `dark-hover-tile`, `dark-hover-new` | dark: Occupied pill on / T6 hover / Takeaway hover | · | · | · | · |
| `focus-new2`, `focus-printer`, `focus-area`, `focus-pill`, `focus-tile` | keyboard focus | same | same | same | same |
| `focus-new` | keyboard focus | · | · | · | tab bar "Order" (see 6.3) |
| `focus-tile-enter` | route `order` (Table 1) | · | · | · | · |
| `default-dpr2` | Floor at DPR 2 | · | · | · | Floor at DPR 2 |

---

## 14. Reference shots (`D:\kd\pos-dev-keep\ui-redesign\design\spec-shots-floor\`, 208 files)
Names are `<state>-<w>x<h>.png` (`-1280x800-collapsed` for the collapsed nav); mid-animation extras `<state>-<t>-<w>x<h>.png`. "×5" = 1280x800, 1280x800-collapsed, 1024x768, 820x1180, 390x844.
- Entry and roles: `default` ×5; `captain` ×5; `cashier` ×5; `fonts` (1280, 390); `default-dpr2` (1280, 390; 2560×1600 / 780×1688 pixels).
- Area tabs: `area-indoor` ×5; `area-patio` ×5; `area-rooftop` ×5.
- Status pills and empty: `f-free` ×5; `f-occ` ×5; `f-billed` ×5; `f-res` ×5; `empty-rooftop-occ` ×5; `empty-patio-billed` ×5; `indoor-res` ×5.
- Long texts and scrolling: `long` ×5; `long-rooftop` ×5; `scroll-bottom` ×5; `pills-end`, `pills-end-res` (390).
- Many tables (local copy): `many` ×5; `many-bottom` ×5; `many-seg-end` (390); `many-area-bar` (820, 390); `many-scrollbar` (1280, collapsed, 1024, 820).
- Hover and press: `hover-tile-free`, `hover-tile-occ`, `hover-area`, `hover-pill`, `hover-new`, `hover-printer` (1280, collapsed); `press-tile`, `press-area`, `press-pill`, `press-new`, `press-printer` (1280).
- Dark theme: `dark` (1280, 390); `dark-f-occ`, `dark-hover-tile`, `dark-hover-new` (1280).
- What it opens: `takeaway` ×5 (Order screen); `tap-free`, `tap-occ` ×5; `tap-kot`, `tap-billed`, `tap-res`, `tap-free-back` (1280, 390); `focus-tile-enter` (1280).
- Animations: `anim` ×5 + `anim-t20-*`, `anim-t120-*`, `anim-t320-*` ×5; `anim-area` + `anim-area-t40-1280x800`; `anim-pill` + `anim-pill-t40-1280x800`; `anim-more-pill` (1280, 390) + `anim-more-pill-t40-*`; `anim-more-area` + `anim-more-area-t40-1280x800`; `reduced-motion` + `reduced-motion-t20-1280x800`.
- Focus: `focus-new2`, `focus-printer`, `focus-area`, `focus-pill`, `focus-tile` ×5; `focus-new` (1280, 390).

---

## Values I could not determine
- A larger floor was rendered only from a **local copy** of the mock-up with a longer `TABLES` (2.6, 4.7): the owner's HTML itself has 22 tables in 3 areas. Very long single area names (e.g. one longer than the 362 px phone track) and more than 6 areas were not tried.
- Dark theme: measured at d1280 and p390 (plus three d1280 interaction states); c1280 / t1024 / t820 not run in dark (boxes are theme-independent: the dark runs equal the light boxes). The printer hover in dark was not run (source value `--hover` `#222226`).
- `env(safe-area-inset-bottom)` was 0 in every measurement.
- The `1.5px` border on other engines and on Android WebView 109 / 154 (only Chrome 156 was measured: 1 px at DPR 1, 2 and 3).
- Clock-dependent values only at Mon 19 Oct 2026 9:30 PM IST (formulas in 0.1); the reserved count changes with the hour.
- Hover on touch viewports (a finger produces none) and `:active` by touch (only mouse presses at d1280 were measured, 6.2).
- The printer panel (a later page) and the Order screen reached from a tile or "Takeaway" (U1) were not measured here.
- Exact frame-by-frame animation curves: only two or three snapshots per run (times in section 7 are the animations' own `currentTime`, not the nominal waits).
- Classic scrollbars were measured only with the 48-table copy (the demo's 22 never scroll at the four larger sizes) and only in Chrome; the phone was not run with them (mobile browsers overlay scrollbars).
