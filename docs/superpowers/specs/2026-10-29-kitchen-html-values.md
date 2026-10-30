# The owner's HTML mock-up, exact values: the Kitchen screen

Source files (read-only, `D:\kd\pos-dev-keep\ui-redesign\design\`): `unpacked/markup.html` (Kitchen screen lines 540–579: `sc-if on.kitchen` 540, page container 541, header 542–547, column-tab row 548–552, board 553–577 — column 555, column head 556, empty box 557, card 559–573: head row 560–563, item list 564–570, footer 571, action button 572; the shell toast 1548–1549), `unpacked/app.js` (`kitchenVals()` 527–540; `mkTicket()` 418; `seed()` 414–417 with the seed ticket map on 416; `kot()` 400; `flash()` 395; `sendMine()` 171; `let kseq=214` 46; `hm` 56; `SEG_ON`/`SEG_OFF` 6; `ROLES` 48; `NAVDEF` 42; `onKey` 119–128; `afterAuth`/`signIn` 155–158; the `Lay` keys `headPad`/`miniLogo` 743, `kdCols`/`kdTabs`/`kdTypes`/`kdColHead`/`kdPad` 744, `toastB` 746; `tabs0` 833; `tabbar`/`tabCols`/`moreC` 917), and the original bundle `olivea-pos-latest.html` (generated hover classes).

The theme tokens, fonts, global rules, keyframes and shared constants are in **U0 values** = `docs/superpowers/specs/2026-10-19-u0-html-values.md` §0–§1; the shell (side nav, rail, page-header frame, mini logo, printer button, tab bar, More/profile sheet, toast) in U0 §2. They are referred to by section number and not repeated; this document records only what the Kitchen screen adds. Colour tokens are written `var(--x)` with the resolved light value (measured `rgb()`); every token's light and dark value is in U0 §1.1. Format and method copy U3 (`docs/superpowers/specs/2026-10-28-floor-html-values.md`).

How values were obtained:
- Every value without a "measured" mark is copied verbatim from the source text (inline `style="…"` strings, `kitchenVals()` / `renderVals()` expressions, handler strings).
- "Measured" values come from rendering `olivea-pos-latest.html` (the original file, never changed) in headless local Chrome 156.0.8078.48 (`C:/Program Files/Google/Chrome/Application/chrome.exe`) driven by playwright-core 1.64.0-alpha (the npx-cache copy U1–U3 used), on 2026-10-29, reading `getBoundingClientRect()`, `getComputedStyle()` and `document.getAnimations()`. Every request that was not `file:` / `data:` / `blob:` was aborted and logged (none was attempted: 0 blocked); no server was contacted (no `localhost` at all; `:3110` is refused in code and was never requested). The only console errors are the bundle's own `file://…/.image-slots.state.json` fetch refused by Chrome's CORS rule, as in U2 / U3. Rects are `[x, y, width, height]` in CSS px (rounded to 0.01). Tool: `D:\kd\pos-dev-keep\ui-redesign\design\measure-kitchen.mjs`; states: `make-shoot-kitchen.mjs` → `shoot-kitchen.json` (68 states, 194 runs = 194 shots, plus mid-animation extras, section 11); raw results `measure-kitchen-out\json\<state>-<vp>.json` (named boxes, element trees with computed styles, every card's summary — code, box, border, time pill, action, every item —, the live `kd` view-model taken from `renderVals()`, the raw `s.tickets`, the generated `scpN` hover rules, `getAnimations()` lists, the focused element with its outline, four `elementFromPoint` hit tests); printer: `summarize-kitchen.mjs` (`boxes <state> [regex]`, `tree <state> <vp> header|ctabs|board|ov:<overlay>`, `style`, `meta`, `vals <state> <vp> [key.path]`, `cards <state> [vp] [items]`, `cols <state>`, `anims <state> <vp>`, `scp <state> <vp>`, `toast <state>`, `panels`).
- Viewports (as U0–U3): `d1280` 1280×800; `c1280` 1280×800 after a click on `button[title='Collapse']`; `t1024` 1024×768 `hasTouch`; `t820` 820×1180 `hasTouch`; `p390` 390×844 `isMobile`+`hasTouch`. Device-pixel-ratio 1, except `cards-dpr2` / `empty-dpr2` (ratio 2). Headless Chrome draws no classic scrollbars, except in state `many-scrollbar` (6.3). `prefers-color-scheme` light and `prefers-reduced-motion: no-preference` everywhere except the `dark*` (theme patch) and `reduced-motion` states.
- Entry to every state: load, wait 2500 ms, click `text=Rohan K.` (or `Priya S.` / `Amit V.` where a state says so), wait 500 ms, type `1234` (60 ms per key), wait 2800 ms, [collapse], open Kitchen: at ≥ 720 a click on `nav button[title='Kitchen']`; on the phone the tab bar's "Kitchen" (Cashier, Captain) or, for the Manager, the tab bar's "More", 700 ms, then the More sheet's "Kitchen" button (the way the Manager reaches it, section 8); wait 2300 ms. Rohan lands on Dashboard, Priya on Order, Amit on Floor; none lands on Kitchen. Then the state's actions, then the pointer is parked 21 px into the header's left edge (y 28; nothing there has a hover look) unless the state measures a hover, then 900 ms, then shot + measurement.
- Clicks are real mouse clicks at the element's centre after `scrollIntoView({block:'nearest'})` inside the board. On the phone the board runs under the fixed tab bar (6.1), so a "nearest" scroll can leave a button under the bar; when `elementFromPoint` at the centre was not the element, the element was scrolled to the centre first (logged at 390 for the low "Mark ready" / "Picked up" buttons in `ready`, `pickup` and `take-ready`; the d1280 log was lost when the disk filled, section 11). A test click can therefore leave the board scrolled (measured `scrollTop` after the run: `ready` 22 / 22 / 54 at d1280 / c1280 / t1024, `pickup` 59 / 59 / 91, `take-ready` d1280 97 and p390 95; 0 elsewhere).
- **What was patched (all inside the page, nothing written outside it):** the seed has no item note, no long text, no "Now" ticket, no Takeaway in Ready and no late ticket in To cook, so these states replace `s.tickets` with `["tickets", …]` (the `mkTicket` shape, app.js 418; `at` = the fixed clock minus the given minutes; kids 301 up): `cards`, `cards-prep`, `cards-ready`, `cards-dpr2`, `dark-cards`, `hover-item-done` (7 tickets, 4.1), `long`, `long-prep` (3 tickets, 4.7), `bands`, `bands-prep`, `bands-ready`, `dark-bands` (13 tickets, 4.4), `many`, `many-bottom`, `many-prep-bottom`, `many-scrollbar` (14 tickets, 6.2); `empty` / `empty-dpr2` set `tickets: []`; `one` keeps only the seed's Table 7 ticket. `type-del-phone` sets `kTab:'Delivery'` (the control is not on the phone, 3.5). `dark*` set `themeO:'Dark'` (what the profile sheet's theme switch sets). `role-kitchen` / `role-kitchen-signin` change Rohan's role to `Kitchen` (8.3). Every other state uses the seed and real clicks / keys only; `kot-t4` makes a real ticket from the Order screen (F8 = `kot()`, 9.6).

---

## 0. Conventions for this screen

### 0.1 Clock used
`Date` fixed with `page.clock.setFixedTime(new Date("2026-10-19T21:30:00+05:30"))` = **Monday 19 October 2026, 9:30 PM IST** (as U1–U3). `Date.now()` stays at that instant for the whole run, so ticket ages never move during a measurement. Clock-dependent values on this screen:
- Ticket minutes: `m = max(0, floor((now − t.at) / 60000))` with `now = +s.now` (**floor**, not round as on the Floor; 0 allowed). Shown `m < 1 ? 'Now' : m + ' min'`, **no hour rollover** ("75 min", "135 min", state `bands`). `s.now` refreshes only when 30 s have passed (app.js 107), so a ticket's minutes move at most every 30 s.
- KOT time: `hm(t.at)` ("9:26 PM"; U0 §1.6).
- Header average: `avg = round(Σ (now − t.at) / n / 60000)` over all active tickets (exact milliseconds, then rounded; section 9.3).
- Seed ticket ages are exact whole minutes before load (`AGO(m)`, app.js 67), so at the fixed clock: Table 7 "4 min" (KOT 9:26 PM), Takeaway 14 "2 min" (9:28 PM), Table 17 "24 min" (9:06 PM), Table 4 "14 min" (9:16 PM), Table 13 "9 min" (9:21 PM), Table 6 "22 min" (9:08 PM), Delivery 3 "7 min" (9:23 PM). Average (4+2+24+14+9+22+7)/7 = 11.71 → **"12 min"**.

### 0.2 Breakpoint variables and the board's columns
`ph` (`w<720`), `big` (`w>=1024`), `cmp` (`w<1024`) exactly as U0 §0.1. The Kitchen reads `ph` (type control, column-tab row padding, board padding, header padding, mini logo) and `big` (three columns vs one chosen column). The board is `display:grid; grid-template-columns:{{ L.kdCols }}; gap:16px; align-items:start`:
- `big`: `repeat(3, minmax(0,1fr))` → each column `(W − 32) / 3`, `W` = board inner width.
- not `big`: `minmax(0,1fr)` → one column (the chosen one; the other two are `display:none`), itself a grid `repeat(auto-fill, minmax(min(300px,100%), 1fr))` with `gap:10px`: `n = floor((W + 10) / 310)` cards per row (at least 1), track `(W − 10(n − 1)) / n`.

| | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| nav width (U0 §2.1) | 232 | 76 | 76 | 76 | 0 |
| board inner width `W` (measured) | 1008 | 1164 | 908 | 704 | 366 |
| columns (measured `grid-template-columns` of the board) | 3 × 325.328 / 325.328 / 325.344 | 3 × 377.328 / 377.328 / 377.344 | 3 × 292 | `704px` (one column) | `366px` (one column) |
| cards per row inside a column | 1 (columns are flex columns) | 1 | 1 | **2** × 347 (measured `347px 347px`) | **1** × 366 |
| board scrolls with the seed | yes, 59 px (803 in 744) | yes, 59 px | yes, 91 px (803 in 712) | no (1066) | no (730; "Cooking" chosen: 95 px, 6.2) |

Computed from the formula, not rendered: below 1024 a third card per row would need `W ≥ 920`, i.e. a 1036 px window with the rail, so it never happens (at 1023 px `W` = 907 → 2); a phone in landscape (< 720, padding 12) gets 2 per row from `W ≥ 610` (a 634 px window).

### 0.3 `L` keys used by this screen, resolved (measured `renderVals().L`)
| Key | Expression (verbatim, app.js 743–746) | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|---|
| `headPad` | `ph?'0 12px':'0 20px'` | `0 20px` | same | same | same | `0 12px` |
| `miniLogo` | `ph?'flex':'none'` | none | none | none | none | flex |
| `kdTypes` | `ph?'none':'flex'` | flex | flex | flex | flex | **none** |
| `kdTabs` | `big?'none':'flex'` | none | none | none | **flex** | **flex** |
| `kdCols` | `big?'repeat(3,minmax(0,1fr))':'minmax(0,1fr)'` | 3 columns | 3 | 3 | 1 | 1 |
| `kdColHead` | `big?'flex':'none'` | flex | flex | flex | none | none |
| `kdPad` | `ph?'12px 12px calc(84px + env(safe-area-inset-bottom))':'16px 20px 24px'` | `16px 20px 24px` | same | same | same | `12px 12px 84px` (inset 0) |
| `toastB` (shell) | `ph?'140px':(cmp?'92px':'24px')` | 24px | 24px | 24px | 92px | 140px |

Nothing else in `L` is read by the Kitchen markup. Note the column-tab row's side padding is a literal `12px` at every width (3.1) while the board's is 20 px at 820.

### 0.4 Screen state (component `state`) and defaults
`kTab` ('All' | 'Dine-in' | 'Takeaway' | 'Delivery', default 'All') and `kCol` ('new' | 'prep' | 'ready', default 'new'; read as `s.kCol || 'new'`). Both live in the app component, so they **survive leaving and re-entering Kitchen and a change of signed-in user** (`nav()`, `signIn()`, `doLock()` reset neither); a reload resets them. `kCol` has no effect at ≥ 1024 (all three columns show) but is kept; `kTab` has no control on the phone but still filters there (3.5). The tickets themselves are `s.tickets` (section 9).

### 0.5 Rendering conventions (as U0 §0.2–§0.4, U3 §0.5, plus what this screen adds)
- Interpolations are `<span class="sc-interp">` wrappers. In flex containers the binding and the literal text are separate flex items with the container gap between them: column head (dot · 8 · label · 8 · count), column tab (dot · 7 · label · 7 · count). The item note is the literal `Note: ` followed by `{{ i.note }}` inside one block span (no gap).
- `line-height: normal` = 1.3 × font-size (U0 §0.3). Text boxes measured here: 11.5px→15, 12px→16, 12.5px→17, 13px→17, 13.5px→18, 15px→19. Explicit line-heights: header title 1.2 (15px → 18), card code **1.1** (20px → 22).
- **Borders written `1.5px` compute and draw as `1px`** in this Chrome (as U3 §0.5): the item checkbox (`1.5px solid`) and the empty box (`1.5px dashed`) measured `border-width: 1px` at DPR 1 and in `cards-dpr2` / `empty-dpr2` at DPR 2. Other engines may draw 1.5 px: not measured.
- **Fonts (measured, every state's header, column-tab and board trees):** every text on the screen computes `font-family: Geist`, `font-variant-numeric: tabular-nums`, `-webkit-font-smoothing: antialiased` (inherited from `html,body` and the global `button` rule); the mini logo alone is Shrikhand. **No Geist Mono** on this screen (KOT numbers, order numbers, minutes, quantities are all Geist with tabular figures). Weights used: 400, 500, 600, **700** (card code, time pill, quantity — the Floor used no 700).
- Buttons with no `font-size` compute 13.3333px: the item rows (every visible text inside has its own size) and the printer. Buttons with no `padding` keep the UA `1px 6px`: the printer, the column tabs, the **action button** (its `height:46px` and centred text hide it).
- **Static hover strings** become generated classes (measured rule text): the item row and the printer share one class, `.scp4:hover{background:var(--hover) !important}` (same declaration → same class). **No hover rule** on the type tabs, the column tabs, the action buttons or the cards (measured: nothing changes, 5.4). The global `button` transition list and `:active{transform:scale(.97)}` (U0 §1.4) apply to every button here (item rows and action buttons included).
- The card's finished `rise` animation (`both` fill) leaves `transform: matrix(1,0,0,1,0,0)` on every card (measured), i.e. each card is its own stacking context.
- No element on this screen has `aria-*`, `role` or `title` except the printer button; there is no designed focus style (5.5).

### 0.6 Dark theme (state patch `themeO:'Dark'`; measured `dark` d1280 + p390, `dark-cards` d1280 + p390, `dark-bands` d1280, `dark-hover-item` d1280)
The markup uses tokens only, except three literals: the mini logo's `#FFFFFF`, the "Mark ready" text `#FFFFFF` and the checkbox tick `color:#FFFFFF`. Boxes are identical to light. Measured:

| Element | Light (sections 1–4) | Dark (measured) |
|---|---|---|
| page / board background `var(--bg)` | `rgb(244,244,245)` | `rgb(14,14,16)` (U0) |
| header bg / bottom border | `rgb(255,255,255)` / `rgb(226,226,230)` | `rgb(23,23,26)` / `rgb(46,46,51)` |
| title / subtitle | `rgb(24,24,27)` / `rgb(82,82,91)` | `rgb(244,244,245)` / `rgb(169,169,178)` |
| type track / on chip / chip shadow (also the column-tab track and chip) | `rgb(233,233,236)` / white / `--seg-sh` | `rgb(39,39,43)` / `rgb(58,58,64)` / `rgba(0,0,0,.5) 0 1px 2px 0` |
| column-tab count / column-head count | `rgb(82,82,91)` / `rgb(107,107,116)` | `rgb(169,169,178)` / `rgb(128,128,138)` |
| printer | white / `rgb(226,226,230)` border, dot `rgb(36,161,72)` | `rgb(23,23,26)` / `rgb(46,46,51)`, dot `rgb(66,190,101)` ring `rgb(23,23,26)` |
| mini logo (phone) | `rgb(200,56,31)` | `rgb(255,123,94)`, white "O" |
| card bg / border / head separator | white / `rgb(226,226,230)` / `rgb(236,236,239)` | `rgb(23,23,26)` / `rgb(46,46,51)` / `rgb(36,36,40)` |
| late border | `rgb(218,30,40)` | `rgb(250,77,86)` |
| time pill ok / warn / bad (bg / text) | `rgb(222,251,230)`/`rgb(25,128,56)`; `rgb(255,242,232)`/`rgb(186,78,0)`; `rgb(255,241,241)`/`rgb(162,25,31)` | `rgba(66,190,101,.14)`/`rgb(111,220,140)`; `rgba(255,131,43,.14)`/`rgb(255,183,132)`; `rgba(250,77,86,.14)`/`rgb(255,131,137)` (`dark-bands`) |
| where / meta / footer | `rgb(82,82,91)` / `rgb(82,82,91)` / `rgb(107,107,116)` | `rgb(169,169,178)` / `rgb(169,169,178)` / `rgb(128,128,138)` |
| note | `rgb(186,78,0)` | `rgb(255,183,132)` |
| open checkbox border / **tick** | `rgb(107,107,116)` / white tick on transparent = invisible on white | `rgb(128,128,138)` / **the white tick shows on the dark card: every open item looks ticked** (shot `dark-cards-390x844.png`, "0 of 2 done" under two ticked boxes) |
| done checkbox | `rgb(36,161,72)` fill + border | `rgb(66,190,101)` |
| "Start cooking" bg / text | `rgb(24,24,27)` / white | **`rgb(244,244,245)` / `rgb(14,14,16)`** (ink flips to a white button) |
| "Mark ready" bg / text | `rgb(36,161,72)` / white (3.35:1, computed) | `rgb(66,190,101)` / white literal (**2.39:1**, computed) |
| "Served" / "Picked up" / "Handed to rider" | `rgb(233,233,236)` / `rgb(24,24,27)` | `rgb(39,39,43)` / `rgb(244,244,245)` |
| item hover (`dark-hover-item`) | `rgb(242,242,244)` | `rgb(34,34,38)` |
| empty box | dashed `rgb(226,226,230)`, text `rgb(107,107,116)` | dashed `rgb(46,46,51)`, text `rgb(128,128,138)` (tokens; the dark `empty` state was not run) |
| phone tab bar | `var(--glass)` | `rgba(23,23,26,.9)`, top border `rgb(46,46,51)` (U0) |

Shots `dark-1280x800.png`, `dark-390x844.png`, `dark-cards-*.png` (1280, 390), `dark-bands-1280x800.png`, `dark-hover-item-1280x800.png` (the last two re-run after the disk filled, section 11).

---

## 1. Layout per viewport

### 1.1 Page container (`sc-if on.kitchen`, markup 541)
`div data-screen-label="Kitchen"`: `display:{{ S.kitchen }}` (`flex` on route `kitchen`)`; flex-direction:column; min-width:0; min-height:0; overflow:hidden; animation:pageIn .4s cubic-bezier(.2,.8,.2,1) backwards`. **The page does not scroll** (unlike the Floor, whose page is the scroller): the header and the column-tab row are `flex:none`, and only the board below them scrolls (section 6). The header is therefore **not sticky** (measured `position: static`): it simply never moves.

### 1.2 Regions (state `default`, measured)
| Region | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| side nav / rail (U0 §2.3) | `[0,0,232,800]` | `[0,0,76,800]` | `[0,0,76,768]` | `[0,0,76,1180]` | hidden |
| page | `[232,0,1048,800]` | `[76,0,1204,800]` | `[76,0,948,768]` | `[76,0,744,1180]` | `[0,0,390,844]` |
| header | `[232,0,1048,56]` | `[76,0,1204,56]` | `[76,0,948,56]` | `[76,0,744,56]` | `[0,0,390,56]` |
| column-tab row | hidden | hidden | hidden | `[76,56,744,58]` | `[0,56,390,58]` |
| board (the scroller) | `[232,56,1048,744]` | `[76,56,1204,744]` | `[76,56,948,712]` | `[76,114,744,1066]` | `[0,114,390,730]` |
| board padding | `16 20 24 20` | same | same | same | `12 12 84 12` |
| column "To cook" | `[252,72,325.33,488]` | `[96,72,377.33,488]` | `[96,72,292,488]` | `[96,130,704,249]` (the chosen one) | `[12,126,366,454]` (the chosen one) |
| column "Cooking" | `[593.33,72,325.33,763]` | `[489.33,72,377.33,763]` | `[404,72,292,763]` | hidden | hidden |
| column "Ready" | `[934.66,72,325.34,542]` | `[882.66,72,377.34,542]` | `[712,72,292,542]` | hidden | hidden |
| phone tab bar (U0 §2.6) | – | – | – | – | `[0,785,390,59]` (over the board) |

Columns are `align-items:start` in the board grid, so each column is only as tall as its cards (488 / 763 / 542 at ≥ 1024); the column gap is 16; cards stack with 10 between them and 10 below the column head.

---

## 2. Header (markup 542–547)

### 2.1 Elements (verbatim)
| Element | Properties |
|---|---|
| header | `flex:none; display:flex; align-items:center; gap:12px; padding:{{ L.headPad }}; min-height:56px; background:var(--surface); border-bottom:1px solid var(--border)`. **No `position:sticky`** (Floor and dashboard have it; here the page does not scroll). Measured 56 tall at every size, background `rgb(255,255,255)`, bottom border `rgb(226,226,230)`, gap 12 (Floor 12, dashboard 10). |
| Mini logo | as U0 §2.5 (phone only, 30×30, radius 8, `var(--brand)` `rgb(200,56,31)`, Shrikhand 19px "O" white, `padding-top:2px`), `flex:none`. |
| Title block | `div style="flex:1;min-width:0"`. Title "Kitchen": `font-weight:600; font-size:15px; line-height:1.2` (h 18, `var(--text)` `rgb(24,24,27)`). Subtitle `{{ kd.sub }}`: `font-size:12px; color:var(--text-2)` (`rgb(82,82,91)`)`; white-space:nowrap; overflow:hidden; text-overflow:ellipsis` (h 16). |
| Type control | `div`: `display:{{ L.kdTypes }}` (hidden on the phone)`; flex:none; background:var(--surface-3)` (`rgb(233,233,236)`)`; border-radius:8px; padding:2px; gap:2px; height:36px`. No `overflow`, no `max-width`. |
| · type tab | `button` per `kd.types` (All, Dine-in, Takeaway, Delivery) click `kTab:x`: `border:0; border-radius:6px; padding:0 12px; font-size:13px; font-weight:500; cursor:pointer; background:{{ t.bg }}; box-shadow:{{ t.shadow }}; color:var(--text); display:flex; align-items:center; gap:6px; white-space:nowrap`. No height: stretched to 32 by the 36 px track. On = `SEG_ON` (`var(--seg)` `rgb(255,255,255)` + `var(--seg-sh)` measured `rgba(0,0,0,.12) 0 1px 2px 0, rgba(0,0,0,.04) 0 0 0 .5px`), off = `SEG_OFF` (transparent, none). Text colour and weight equal on and off (`rgb(24,24,27)`, 500). No hover rule, no `aria-pressed`. 13px here vs the Floor's area tabs 13.5px with `0 14px` padding and an explicit 32 px height. |
| Printer | as U0 §2.5 / U3 §1.2: 36×36, `border:1px solid var(--border)`, radius 8, `var(--surface)`, hover `var(--hover)` `rgb(242,242,244)` (class `scp4`), `title` "Printer · printing is on", icon 17×17 stroke 1.8, dot 10×10 at `top:-3px; right:-3px` `var(--ok)` `rgb(36,161,72)` with ring `0 0 0 2px var(--surface)`. Opens the printer panel (a later page). |

The Kitchen header has **no "New order" / "Takeaway" button** (Floor, Orders and the dashboard have one).

### 2.2 Measured header (state `default`)
| Element | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| header | `[232,0,1048,56]` | `[76,0,1204,56]` | `[76,0,948,56]` | `[76,0,744,56]` | `[0,0,390,56]` |
| mini logo | hidden | hidden | hidden | hidden | `[12,12.5,30,30]` |
| title block | `[252,10.5,672.16,34]` | `[96,10.5,828.16,34]` | `[96,10.5,572.16,34]` | `[96,10.5,368.16,34]` | `[54,10.5,276,34]` |
| "Kitchen" | `[252,10.5,672.16,18]` | `[96,10.5,…,18]` | `[96,10.5,…,18]` | `[96,10.5,…,18]` | `[54,10.5,276,18]` |
| subtitle (box / text) | `[252,28.5,672.16,16]` / text 202.34 | same / 202.34 | same / 202.34 | same / 202.34 | `[54,28.5,276,16]` / 202.34 (fits) |
| type control | `[936.16,9.5,275.84,36]` | `[936.16,9.5,275.84,36]` | `[680.16,9.5,275.84,36]` | `[476.16,9.5,275.84,36]` | hidden |
| · All / Dine-in / Takeaway / Delivery | x 938.16 / 980.03 / 1050.22 / 1136.25 (y 11.5, h 32) | same | x 682.16 / 724.03 / 794.22 / 880.25 | x 478.16 / 520.03 / 590.22 / 676.25 | hidden |
| printer | `[1224,9.5,36,36]` (icon `[1233.5,19,17,17]`, dot `[1252,7.5,10,10]`) | same | `[968,9.5,36,36]` | `[764,9.5,36,36]` | `[342,9.5,36,36]` (dot `[370,7.5,10,10]`) |

Tab widths (every viewport): All 39.88 (text 15.88), Dine-in 68.19 (44.19), Takeaway 84.03 (60.03), Delivery 73.75 (49.75); track = 2 + tabs + 3 × 2 + 2 = 275.84. Gaps: title block → 12 → type control → 12 → printer → 20 right padding (phone: 12 | logo 30 | 12 | title block 276 | 12 | printer 36 | 12). The subtitle never needs an ellipsis with the demo words (202.34 in 276 on the phone; `many`: "14 active tickets · average wait 10 min", text 209.55).

### 2.3 Subtitle words
`kd.sub = all.length + ' active tickets · average wait ' + avg + ' min'` — `all` = every ticket whose status is not `done`, **whatever the type filter** (measured: "7 active tickets · average wait 12 min" with All, Dine-in, Takeaway and Delivery chosen). Plural is fixed: one ticket reads **"1 active tickets"** (state `one`: "1 active tickets · average wait 4 min"); none reads "0 active tickets · average wait 0 min" (state `empty`). After "Served" on Table 6 (22 min): "6 active tickets · average wait 10 min"; after "Handed to rider" on Delivery 3: "6 … 13 min".

---

## 3. Column tabs, column heads, the empty column

### 3.1 Column-tab row (below 1024 only; markup 548–552)
| Element | Properties |
|---|---|
| Row | `div`: `display:{{ L.kdTabs }}; flex:none; padding:10px 12px 0` — **12 px sides at every width** (the board below is 20 px at 820). Measured t820 `[76,56,744,58]`, p390 `[0,56,390,58]`. Not inside the scroller: it never moves when the board scrolls (6.2). |
| Track | `div`: `flex:1; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); background:var(--surface-3)` (`rgb(233,233,236)`)`; border-radius:10px; padding:3px; gap:3px`. Measured t820 `[88,66,720,48]`, p390 `[12,66,366,48]`. |
| Tab | `button` per `kd.colTabs` click `kCol:k`: `height:42px; border:0; border-radius:8px; background:{{ c.bg }}; box-shadow:{{ c.shadow }}; display:flex; align-items:center; justify-content:center; gap:7px; font-size:13.5px; font-weight:600; color:var(--text); cursor:pointer; white-space:nowrap` (UA padding `1px 6px` kept). On = `SEG_ON` (white + `--seg-sh`), off = `SEG_OFF`. Label weight and colour equal on and off; no hover rule. Measured tabs t820 `[91,69,236,42]`, `[330,69,236,42]`, `[569,69,236,42]`; p390 `[15,69,118,42]`, `[136,69,118,42]`, `[257,69,118,42]`. |
| · dot | `span`: `width:8px; height:8px; border-radius:50%; background:{{ c.dot }}` — To cook `var(--warn)` `rgb(255,131,43)`, Cooking `var(--info)` `rgb(15,98,254)`, Ready `var(--ok)` `rgb(36,161,72)`. |
| · label | `{{ c.label }}` 13.5px / 600, h 18: "To cook" 50.33, "Cooking" 53.5, "Ready" 40.7 wide. |
| · count | `span style="font-weight:500;color:var(--text-2)"` `{{ c.count }}` (`rgb(82,82,91)`, 13.5px; "2" 8.27 wide). **The column heads (3.2) write the same count in `var(--text-3)`.** |

Content is centred in the tab: p390 "To cook" dot at x 33.7, label 48.7, count 106.03 (tab 15–133); t820 dot 168.7, label 183.7, count 241.03 (tab 91–327). Counts are over the **type-filtered** tickets (`T`), so they change with the type control (3.4).

### 3.2 Column head (≥ 1024 only; markup 556)
`div`: `grid-column:1 / -1; display:{{ L.kdColHead }}; align-items:center; gap:8px; font-size:13.5px; font-weight:600; padding:2px 2px 4px`: dot `span` 8×8 round `{{ c.dot }}`, label `{{ c.label }}`, count `span style="font-weight:500;color:var(--text-3)"` (`rgb(107,107,116)`). Measured (d1280): To cook head `[252,72,325.33,24]`, dot `[254,79,8,8]`, label `[270,74,50.33,18]`, count "2" `[328.33,74,8.27,18]`; Cooking label x 611.33, count 672.83; Ready label 952.66, count 1001.36. Height 24 = 2 + 18 + 4. The first card starts 10 below (y 106). Below 1024 the head is `display:none` (the column tabs replace it).

### 3.3 Column container (markup 555)
`div`: `display:{{ c.display }}; flex-direction:column; grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr)); gap:10px; min-width:0; align-items:stretch`. `c.display = big ? 'flex' : (kCol === k ? 'grid' : 'none')`. At ≥ 1024 it is a flex column (the `grid-template-columns` is ignored); below 1024 the chosen column is a grid (its `flex-direction` ignored), and `align-items:stretch` makes **cards in the same grid row equally tall** (4.8).

### 3.4 The type filter (states `type-dine`, `type-take`, `type-del`; d1280, c1280, t1024, t820 — the control is hidden on the phone)
Subtitle unchanged ("7 active tickets · average wait 12 min") in all three. Cards per column and column heights (d1280; c1280 / t1024 the same counts):

| `kTab` | To cook | Cooking | Ready | Board scrolls (d1280) | t820 (To cook chosen) column tabs |
|---|---|---|---|---|---|
| All (`default`) | Table 7, Takeaway 14 (488) | Table 17, Table 4, Table 13 (763) | Table 6, Delivery 3 (542) | 59 | 2 · 3 · 2 |
| Dine-in | Table 7 (229) | Table 17, Table 4, Table 13 (763) | Table 6 (283) | 59 | 1 · 3 · 1 |
| Takeaway | Takeaway 14 (283) | **empty** (109) | **empty** (109) | no | 1 · 0 · 0 |
| Delivery | **empty** (109) | **empty** (109) | Delivery 3 (283) | no | 0 · 0 · 1 (the chosen To cook shows the empty box) |

The chosen tab gets the white chip; only the cards' column changes, no animation replays on kept cards (7.2). `type-take-ready` (t820: Takeaway, then the "Ready" tab): the Ready column shows only the empty box `[96,130,704,75]`.

### 3.5 The phone and a type filter carried over (state `type-del-phone`: `kTab:'Delivery'` patched at 390)
The phone has no type control, but `kTab` still filters: with Delivery carried over (e.g. chosen on a tablet, then rotated, or set before a change of user on a shared device) the phone shows "To cook 0 · Cooking 0 · Ready 1", the To cook column shows only "No tickets here" `[12,126,366,75]`, and nothing on screen says a filter is on; the subtitle still says "7 active tickets".

### 3.6 Empty column box (`sc-if c.empty`, markup 557)
`div`: `grid-column:1 / -1; border:1.5px dashed var(--border); border-radius:12px; padding:28px 12px; text-align:center; font-size:13px; color:var(--text-3)` "No tickets here". Measured: border `1px dashed rgb(226,226,230)` (1.5 → 1, 0.5), text `rgb(107,107,116)` 13px / 400, height 75 = 1 + 28 + 17 + 28 + 1. Boxes: d1280 Cooking `[593.33,106,325.33,75]`, Ready `[934.66,106,325.34,75]`; c1280 x 489.33 / 882.66, width 377.33; t1024 x 404 / 712, width 292; t820 (chosen column) `[96,130,704,75]` (spans both grid tracks); p390 `[12,126,366,75]`. An empty column at ≥ 1024 is 109 tall (head 24 + 10 + 75). No icon, no hint, no "clear filter".

---

## 4. The ticket card

### 4.1 Elements (verbatim, markup 559–572)
| Element | Properties |
|---|---|
| Card | `div`: `background:var(--surface); border:1px solid {{ t.border }}; border-radius:12px; overflow:hidden; display:flex; flex-direction:column; animation:rise .35s cubic-bezier(.2,.8,.2,1) both`. Not a button, no hover, no shadow. `t.border = late && column !== 'ready' ? var(--bad) : var(--border)` → measured normal `rgb(226,226,230)`, late **`rgb(218,30,40)`** (1 px). |
| · head row | `div`: `display:flex; align-items:flex-start; gap:10px; padding:12px 12px 10px; border-bottom:1px solid var(--border-2)` (measured `rgb(236,236,239)`). |
| · · title block | `div style="flex:1;min-width:0"` (no `overflow`, no ellipsis): code `div` `font-size:20px; font-weight:700; letter-spacing:-.01em; line-height:1.1` `{{ t.code }}` (measured −0.2px, h 22, `var(--text)` `rgb(24,24,27)`); where `div` `font-size:12px; color:var(--text-2); margin-top:3px` `{{ t.where }}` (h 16, `rgb(82,82,91)`). Both wrap freely. |
| · · time pill | `span`: `flex:none; height:26px; padding:0 9px; border-radius:999px; background:{{ t.timeBg }}; color:{{ t.timeColor }}; font-size:12.5px; font-weight:700; display:flex; align-items:center` `{{ t.mins }}`. Top-aligned with the code (`align-items:flex-start`). |
| · item list | `div`: `display:flex; flex-direction:column; padding:4px 0`. |
| · · item row | `button` per item, click `i.toggle`: `display:flex; align-items:flex-start; gap:10px; padding:9px 12px; border:0; background:transparent; text-align:left; cursor:pointer; color:var(--text); opacity:{{ i.op }}; width:100%`; hover `background:var(--hover)` (class `scp4`). Full card width (edge to edge inside the border), square corners. |
| · · · checkbox | `span`: `width:18px; height:18px; flex:none; margin-top:2px; border-radius:5px; border:1.5px solid {{ i.checkBorder }}; background:{{ i.check }}; color:#FFFFFF; display:flex; align-items:center; justify-content:center` with `svg 11×11 viewBox 0 0 24 24 fill none stroke currentColor stroke-width 3.5 round caps/joins`, path `M5 12l5 5L20 7`. The white tick is always drawn; on an open item it sits on a transparent box (invisible on white). Measured border `1px` (0.5). Open: border `var(--text-3)` `rgb(107,107,116)`, transparent; done: border and fill `var(--ok)` `rgb(36,161,72)`. |
| · · · quantity | `span`: `font-size:15px; font-weight:700; min-width:26px` `{{ i.qty }}` = `qty + '×'` (h 19). Grows past 26 for long numbers ("12×" 27.19, "100×" 36.73), pushing that row's name right. |
| · · · text | `span style="flex:1;min-width:0"`: name `span` `display:block; font-size:15px; font-weight:500; text-decoration:{{ i.deco }}` (h 19 per line); meta `span` `display:{{ i.metaDisplay }}; font-size:12.5px; color:var(--text-2)` (h 17, `rgb(82,82,91)`); note `span` `display:{{ i.noteDisplay }}; font-size:12.5px; font-weight:600; color:var(--warn-i)` "Note: {{ i.note }}" (h 17, `rgb(186,78,0)`). No ellipsis anywhere: everything wraps. |
| · footer | `div`: `display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 12px 4px; font-size:11.5px; color:var(--text-3)` (`rgb(107,107,116)`): `<span>{{ t.kot }}</span><span>{{ t.progress }}</span>` (h 15 each, row 19). |
| · action | `button` click `t.act`: `margin:6px 12px 12px; height:46px; border:0; border-radius:10px; background:{{ t.actBg }}; color:{{ t.actColor }}; font-weight:600; font-size:14.5px; cursor:pointer` `{{ t.action }}` (UA padding `1px 6px`; text centred). Full width of the card minus 24. |

### 4.2 Measured anatomy (state `default`; the first "To cook" card, Table 7: one item, no meta)
| Element | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| card | `[252,106,325.33,195]` | `[96,106,377.33,195]` | `[96,106,292,195]` | `[96,130,347,249]` (stretched, 4.8) | `[12,126,366,195]` |
| head row | `[253,107,323.33,64]` | `[97,107,375.33,64]` | `[97,107,290,64]` | `[97,131,345,64]` | `[13,127,364,64]` |
| title block | `[265,119,238.13,41]` | `[109,119,290.13,41]` | `[109,119,204.8,41]` | `[109,143,259.8,41]` | `[25,139,278.8,41]` |
| code "Table 7" | `[265,119,238.13,22]` | `[109,119,…,22]` | `[109,119,…,22]` | `[109,143,…,22]` | `[25,139,278.8,22]` |
| where | `[265,144,238.13,16]` | `[109,144,…,16]` | `[109,144,…,16]` | `[109,168,…,16]` | `[25,164,278.8,16]` |
| time pill "4 min" | `[513.13,119,51.2,26]` | `[409.13,119,51.2,26]` | `[323.8,119,51.2,26]` | `[378.8,143,51.2,26]` | `[313.8,139,51.2,26]` |
| item list | `[253,171,323.33,46]` | `[97,171,375.33,46]` | `[97,171,290,46]` | `[97,195,345,46]` | `[13,191,364,46]` |
| item row | `[253,175,323.33,38]` | `[97,175,375.33,38]` | `[97,175,290,38]` | `[97,199,345,38]` | `[13,195,364,38]` |
| checkbox / tick | `[265,186,18,18]` / `[268.5,189.5,11,11]` | `[109,186,18,18]` | `[109,186,18,18]` | `[109,210,18,18]` | `[25,206,18,18]` / `[28.5,209.5,11,11]` |
| quantity "2×" | `[293,184,26,19]` | `[137,184,26,19]` | `[137,184,26,19]` | `[137,208,26,19]` | `[53,204,26,19]` |
| name | `[329,184,235.33,19]` | `[173,184,287.33,19]` | `[173,184,202,19]` | `[173,208,257,19]` | `[89,204,276,19]` |
| footer | `[253,217,323.33,19]` | `[97,217,375.33,19]` | `[97,217,290,19]` | `[97,241,345,19]` | `[13,237,364,19]` |
| "KOT 216 · 9:26 PM" / "0 of 1 done" | `[265,217,97.25,15]` / `[504.91,217,59.42,15]` | x 109 / 400.91 | x 109 / 315.58 | x 109 / 370.58 | x 25 / 305.58 |
| action "Start cooking" | `[265,242,299.33,46]` | `[109,242,351.33,46]` | `[109,242,266,46]` | `[109,266,321,46]` | `[25,262,340,46]` |

Horizontal: 1 border + 12 | checkbox 18 | 10 | quantity 26 | 10 | text (card − 90) | 12 + 1. Title block = card − 2 − 24 − 10 − pill. Vertical rhythm: 1 + head 64 (12 + code 22 + 3 + where 16 + 10 + 1 border) + list (4 + rows + 4) + footer 19 + 6 + action 46 + 12 + 1, i.e. **card height = 157 + Σ row heights** (measured: 195 = 157 + 38; 249 = 157 + 54 + 38; 265 = 157 + 54 + 54). Row heights: 38 (one-line name), 54 (name + one line of meta or note), 56 (two-line name); +19 per extra name line, +17 per extra meta / note line. The checkbox sits 2 px below the row's text top (row y + 11) and stays at the first line when the name wraps.

Text widths: "KOT 216 · 9:26 PM" 97.25; "0 of 1 done" / "0 of 2 done" 59.42; time pills "Now" 45.23, "1 min"–"9 min" 51.2, "10 min"–"75 min" 59.16, "135 min" 67.11.

### 4.3 Words (app.js 532–535)
- `code = t.oid` — the order id as is: "Table 7", "Takeaway 14", "Delivery 3" (not the "T7" short form, which only the toasts use, 5.2).
- `where = t.type + (t.type==='Dine-in' && t.guests ? ' · ' + t.guests + ' guests' : '') + ' · Order #' + t.no` → "Dine-in · 2 guests · Order #1041", "Takeaway · Order #1044", "Delivery · Order #1043". **One guest reads "1 guests"** (state `cards`, Table 2: "Dine-in · 1 guests · Order #1049"); a Dine-in ticket with no guest count drops the middle part (source).
- `kot = 'KOT ' + t.kid + ' · ' + hm(t.at)`; `progress = done + ' of ' + items.length + ' done'`.
- `qty = qty + '×'`; `meta = [size === 'Standard' ? null : size, ...addons].filter(Boolean).join(', ')` ("Medium, Extra cheese", "Large, Extra cheese, Jalapeños", "10 pcs", "Full"), shown only when the size is not Standard or there are addons; the note shows as "Note: " + note when not empty.

### 4.4 Time bands and the late border (states `bands`, `bands-prep`, `bands-ready`; 13 patched tickets, one "Masala Chai" each; measured d1280, t820, p390 and the `bands` run at all five, same colours everywhere)
| Minutes (`m`) | Pill text | Pill background | Pill text colour | Card border |
|---|---|---|---|---|
| < 1 (0.3 min) | **"Now"** (45.23 wide) | `var(--ok-t)` `rgb(222,251,230)` | `var(--ok-i)` `rgb(25,128,56)` | `rgb(226,226,230)` |
| 1, 9 | "1 min", "9 min" | ok-t | ok-i | normal |
| 10, 19 (also 19.5 → "19 min") | "10 min", "19 min" | `var(--warn-t)` `rgb(255,242,232)` | `var(--warn-i)` `rgb(186,78,0)` | normal |
| 20, 75 in To cook; 20, 135 in Cooking | "20 min", "75 min", "135 min" | `var(--bad-t)` `rgb(255,241,241)` | `var(--bad-i)` `rgb(162,25,31)` | **`var(--bad)` `rgb(218,30,40)`** |
| 30 in Ready | "30 min" | bad-t | bad-i | **normal** (Ready is never "late") |
| 12 / 5 in Ready | "12 min" / "5 min" | warn / ok | | normal |

Thresholds (verbatim): `late = m >= 20`, `warn = m >= 10`; `m = max(0, floor(ms / 60000))`. The red border is the only "late" sign besides the pill colour: no icon, no reordering, no count in the header. Seed: Table 17 (24 min, Cooking) is the only late card; Table 6 (22 min) has a red pill but a grey border because it is in Ready. Oldest-first order puts the late cards at the top of each column.

### 4.5 The action button's three kinds (measured `default` / `cards`)
| Column | Label | Background | Text | What it does (9.4) |
|---|---|---|---|---|
| To cook (`new`) | "Start cooking" | `var(--ink)` `rgb(24,24,27)` | `var(--on-ink)` `rgb(255,255,255)` | status → `prep` |
| Cooking (`prep`) | "Mark ready" | `var(--ok)` `rgb(36,161,72)` | `#FFFFFF` (literal) | status → `ready`, every item ticked |
| Ready (`ready`) | "Served" (Dine-in) / "Picked up" (Takeaway) / "Handed to rider" (Delivery) | `var(--surface-3)` `rgb(233,233,236)` | `var(--text)` `rgb(24,24,27)` | status → `done` (the card leaves the board) |

All three: 46 tall, radius 10, 14.5px / 600, no hover look, the global `:active` scale .97 (5.4).

### 4.6 Item states (state `cards`, patched; d1280, card Table 12 in To cook)
| Item | Row | Name | Meta / note |
|---|---|---|---|
| 1 × Margherita, Large, addons Extra cheese + Jalapeños | `[253,434,323.33,54]` | `[329,443,235.33,19]` | meta "Large, Extra cheese, Jalapeños" `[329,462,235.33,17]` |
| 2 × Cold Coffee, note "Less sugar, no ice" | `[253,488,323.33,54]` | `[329,497,235.33,19]` | note "Note: Less sugar, no ice" `[329,516,235.33,17]`, 12.5px / 600 `rgb(186,78,0)` |
| 1 × "Paneer Tikka Butter Masala with Garlic Naan and Jeera Rice" | `[253,542,323.33,56]` | `[329,551,235.33,38]` (two lines; the checkbox stays at y 553) | – |
| 3 × Butter Naan, **done** | `[253,598,323.33,38]` | line-through `rgb(24,24,27)` on the **name only** | the whole row at `opacity:.5`: checkbox fill and border `rgb(36,161,72)` with the white tick, quantity and text all at half opacity |

Done look (verbatim): `deco: done ? 'line-through' : 'none'`, `op: done ? .5 : 1`, `check: done ? var(--ok) : 'transparent'`, `checkBorder: done ? var(--ok) : var(--text-3)`. A done item keeps its place in the list (no reordering). Card Table 12 = 157 + 54 + 54 + 56 + 38 = **359** tall (measured). The seed's meta lines are sizes and one addon ("Medium, Extra cheese", "Regular", "Full", "Large", "10 pcs"); the seed has **no note** on any ticket (Table 4's "Less sugar" is on its unsent Cold Coffee, which reaches the board only through `kot()`, 9.6).

### 4.7 Long texts (states `long`, `long-prep`, patched; 3 tickets)
| Ticket | d1280 (card 325.33) | c1280 (377.33) | t1024 (292) | t820 (347) | p390 (366) |
|---|---|---|---|---|---|
| code "Takeaway-SWIGGY-998877665544332211" | 2 lines (h 44), breaks after the last hyphen | 2 lines | 2 lines; **the second line (225 px) is wider than the 197 px title block** and runs 28 px into the pill's column, just under the "11 min" pill (shot `long-1024x768.png`) | 2 lines | 2 lines |
| code "Table 21 Rooftop Private Dining" | 2 lines | 2 lines | 2 lines | 2 lines | 2 lines |
| item "Paneer Tikka Butter Masala Family Combo with Garlic Naan, Jeera Rice and Raita", size "Family pack (serves 4)", 3 addons, a 2-sentence note | name 3 lines (57), meta 2 (34), note 3 (51): row **160** | 57 / 34 / 34: row 143 | 57 / 51 / 51: row 177 | 57 / 34 / 51: row 160 | 57 / 34 / 34: row 143 |
| quantities "12×" / "100×" | 27.19 / 36.73 wide: names start at x 330.19 / 339.73 instead of 329 (names misalign) | same | same | same | same |
| item "Supercalifragilisticexpialidociousmushroompizza" (one 342 px word) | overflows the 235.33 text box and is **cut by the card edge** (no ellipsis; the card is `overflow:hidden`) | 342 in 287.33, cut | 342 in 202, cut | 342 in 257, cut (`long-prep`) | 342 in 276, cut (`long-prep`) |
| order number 1234567 | "Delivery · Order #1234567" fits | fits | fits | fits | fits |

Cards keep growing with the text (no max height, no "+n more"). Shots `long-*.png`, `long-prep-*.png`.

### 4.8 Cards in the same row are stretched (below 1024)
The chosen column is a grid with `align-items:stretch`, so at 820 (2 per row) a short card takes its neighbour's height and its content stays at the top, leaving blank card below the action button: `default` t820 Table 7 (195 of content) is drawn 249 tall next to Takeaway 14 (249), its "Start cooking" at y 266 while the neighbour's is at y 320 — **54 px of empty white card** under it (shot `default-820x1180.png`); `cards-ready` t820 Delivery 5 (211 of content) next to Table 9 (249): 38 px. At 390 (one per row) and at ≥ 1024 (flex columns) every card has its own height.

---

## 5. Interactions and toasts

### 5.1 Ticking an item (states `tick` ×5, `untick` 1280 / 390, `tick-all` 1280 / 820 / 390, `focus-item-enter` 1280 / 390)
A click (or Enter on the focused row) flips that item's `done` (`setT(kid, items[ii].done = !done)`). `tick`: Table 7's "2× Chicken Zinger" → row `opacity` 0.5, name line-through, checkbox `rgb(36,161,72)` fill and border; footer "1 of 1 done"; **the card stays in To cook with "Start cooking"** (ticking never moves a card, even when every item is done: `tick-all` Table 4 "2 of 2 done" stays in Cooking with "Mark ready"). Boxes do not change (the row stays 38 tall). `untick` (a second click) restores the open look ("0 of 1 done"). No toast, no undo, no sound. The row's opacity fades over the global `.16s` button transition (7); the checkbox fill changes at once (a `span`, no transition).

### 5.2 Action buttons and their toasts (states `start`, `ready`, `served`, `rider`, `pickup` ×5; `take-ready`, `start-cooking-col` 1280 / 820 / 390)
Each press changes the ticket's status at once and calls `flash(short(oid) + suffix)` — the shell toast (U0 §2.8: `position:fixed; left:50%; bottom:{{ L.toastB }}; translateX(-50%)`, `var(--toast)` `rgb(24,24,27)`, white 13.5px / 400, radius 10, padding `10px 14px`, shadow `rgba(0,0,0,.2) 0 8px 24px 0`, `toastIn .36s`, z 70, 38 tall, 2800 ms, **no Undo** button: these flashes pass no undo). Words and boxes (measured):

| Press | Toast words | d1280 / c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| "Start cooking" on Table 7 | "T7 · cooking started" (text 121.34) | `[565.33,738,149.34,38]` | `[437.33,706,149.34,38]` | `[335.33,1050,149.34,38]` | `[120.33,666,149.34,38]` |
| "Mark ready" on Table 13 | "T13 · ready to serve" (120.95) | `[565.52,738,148.95,38]` | `[437.52,706,…]` | `[335.52,1050,…]` | `[120.52,666,…]` |
| "Served" on Table 6 | "T6 · served" (66.48) | `[592.76,738,94.48,38]` | `[464.76,706,…]` | `[362.76,1050,…]` | `[147.76,666,…]` |
| "Handed to rider" on Delivery 3 | "Delivery 3 · handed to rider" (165.05) | `[543.48,738,193.05,38]` | `[415.48,706,…]` | `[313.48,1050,…]` | `[98.48,666,…]` |
| "Picked up" on Takeaway 14 (after Start cooking and Mark ready) | "Takeaway 14 · picked up" (150.27) | `[550.87,738,178.27,38]` | `[422.87,706,…]` | `[320.87,1050,…]` | `[105.87,666,…]` |

Toast width = text + 28; y = window height − `toastB` − 38 (738 / 706 / 1050 / 666). It is centred on the **window** (x centre 640 at 1280, 512 at 1024), not on the page area beside the nav (756 at 1280). On the phone it sits 81 px above the tab bar, over the cards. Suffix (verbatim): `prep` → " · cooking started", `ready` → " · ready to serve", `done` → " · " + the button label in lower case ("served", "picked up", "handed to rider"). `short(id)` (app.js 530): digits of the id; "Table n" → "Tn", "Takeaway n" → "Takeaway n", **anything else → "Delivery n"**.

Where the card goes (measured d1280 unless noted):
- `start`: Table 7 leaves To cook (Takeaway 14 moves up to y 106 at once) and appears **last** in Cooking at y 845 (Cooking is sorted by ticket age, oldest first: Table 17, Table 4, Table 13, Table 7); the board's scroll height grows (Cooking 968 tall). Subtitle unchanged ("7 active tickets · average wait 12 min"). Below 1024 the card simply vanishes from the chosen To cook column; the column tabs read "To cook 1 · Cooking 4 · Ready 2" (`start-cooking-col`: the Cooking tab then shows it 4th).
- `ready`: Table 13 moves to Ready between Table 6 (22 min) and Delivery 3 (7 min), all its items ticked ("1 of 1 done", row at half opacity), button "Served". Tabs "2 · 2 · 3".
- `served` / `rider` / `pickup`: the card is removed (status `done`, filtered out for good); subtitle "6 active tickets · average wait 10 min" (Table 6 gone) / "6 … 13 min" (Delivery 3 gone) / "6 … 13 min" (Takeaway 14 gone).
- `take-ready` (no toast left: 3000 ms after "Mark ready"): Takeaway 14 is 3rd in Ready with "Picked up" (the only way to see a Takeaway "Picked up" button with the seed).
No confirmation on any press (also not on "Served", which removes the card), and nothing can be undone.

### 5.3 Making a ticket (states `kot-t4` 1280 / 390, `kot-toast` 1280)
Floor → tap T4 → Order screen (Table 4 has "2 × Cold Coffee, Less sugar" not sent) → F8 (`kot()`, the Order screen's "Send KOT · n" does the same): toast on the Order screen "Sent 2 items to kitchen" `[554.72,738,170.56,38]` (d1280). On Kitchen: a new card "Table 4" in To cook, 3rd (oldest first: Table 7, Takeaway 14, Table 4), `[252,570,325.33,211]` at d1280, time pill **"Now"**, "KOT 222 · 9:30 PM", "Dine-in · 3 guests · Order #1040", one row "2× Cold Coffee" + "Note: Less sugar" (54 tall); the older Table 4 ticket (KOT 215) stays in Cooking — **the same table shows as two cards**. Subtitle "8 active tickets · average wait 10 min".

### 5.4 Hover and press (hover: d1280 and c1280 only — the touch viewports have no hover; press: d1280)
| Element | Rule | Measured |
|---|---|---|
| Item row (open, `hover-item`) | `.scp4:hover{background:var(--hover) !important}` | background `rgb(242,242,244)` over the full card width (`[253,175,323.33,38]` d1280, `[97,175,375.33,38]` c1280); the white tick shows faintly on it. |
| Item row (done, `hover-item-done`) | same | `rgb(242,242,244)` under the half-opacity row. |
| Action "Start cooking" / "Mark ready" (`hover-act`, `hover-act-ok`) | none | unchanged (`rgb(24,24,27)` / `rgb(36,161,72)`). |
| Type tab "Dine-in" (off, `hover-type`) | none | unchanged (transparent). |
| Printer (`hover-printer`) | `.scp4:hover` (same class) | `rgb(242,242,244)`. |
| Column tabs | none (source; they exist only below 1024, where the viewports are touch) | – |
| Card | none | – |

Press (mouse button held 400 ms, nothing activated): action "Start cooking" `[265,242,299.33,46]` → `[269.49,242.69,290.35,44.62]`, `matrix(0.97,…)`, colour unchanged; item row `[253,175,323.33,38]` → `[257.85,175.57,313.63,36.86]`, scale .97 with the hover background — both from the global `button:not(:disabled):active{transform:scale(.97)}` (U0 §1.4), animated by `transform .16s ease`. Each takes focus without a ring (pointer focus).

### 5.5 Keyboard focus (states `focus-*`: the previous control focused by script, then Tab / Shift+Tab, so the focus is keyboard-made)
No focus style is written; Chrome's default `:focus-visible` ring applies: measured `outline: auto 1px rgb(16,16,16)` on every row below (`:focus-visible` true at all five sizes, touch contexts included).

| Focused element (how) | d1280 | c1280 | t1024 | t820 | p390 | Ring |
|---|---|---|---|---|---|---|
| Type tab "All" (Tab from the nav's last button) | `[938.16,11.5,39.88,32]` | same | `[682.16,11.5,…]` | `[478.16,11.5,…]` | – (hidden) | visible around the white chip |
| Printer (Tab from the last type tab; phone: Shift+Tab from "To cook") | `[1224,9.5,36,36]` | same | `[968,9.5,36,36]` | `[764,9.5,36,36]` | `[342,9.5,36,36]` | visible |
| Column tab "To cook" (Tab from the printer) | – | – | – | `[91,69,236,42]` | `[15,69,118,42]` | visible (shot `focus-ctab-390x844.png`) |
| First item row, Table 7 (Tab from the printer; below 1024 from the last column tab) | `[253,175,323.33,38]` | `[97,175,375.33,38]` | `[97,175,290,38]` | `[97,199,345,38]` | `[13,195,364,38]` | visible, square corners, drawn inside the card edge |
| Action "Start cooking" of Table 7 (Tab from its last item) | `[265,242,299.33,46]` | `[109,242,351.33,46]` | `[109,242,266,46]` | `[109,266,321,46]` | `[25,262,340,46]` | **barely visible**: a dark ring on the near-black button (shot `focus-act-1024x768.png`) |

Tab order: side nav → type tabs (≥ 720) → printer → column tabs (< 1024) → for each shown card, in column order and then card order: its item rows, then its action button → (phone: the tab bar). Hidden columns' buttons are skipped (`display:none`). Enter / Space on a focused row ticks it (`focus-item-enter`: "2× Chicken Zinger DONE"). No arrow-key moves, no shortcut keys (9.8).

---

## 6. Scrolling and insets

### 6.1 The board is the only scroller
`div` (markup 553): `flex:1; min-height:0; overflow:auto; padding:{{ L.kdPad }}; display:grid; grid-template-columns:{{ L.kdCols }}; gap:16px; align-items:start`. The page (`overflow:hidden`), the header and the column-tab row never scroll: after scrolling to the end (`many-bottom`) the header is still `[232,0,1048,56]` … `[0,0,390,56]`, the column-tab row `[76,56,744,58]` / `[0,56,390,58]` and "To cook" `[91,69,236,42]` / `[15,69,118,42]` — fixed by layout, not by `position:sticky`. At ≥ 1024 the three columns scroll together in the one board (a long "To cook" scrolls "Ready" away with it). On the phone the board's box `[0,114,390,730]` runs to the window bottom **under the fixed tab bar** (`[0,785,390,59]`, z 12; hit test at (195, 814) = the tab bar's svg); its bottom padding `calc(84px + env(safe-area-inset-bottom))` = 84 (inset 0 here) keeps the last card clear of the bar at full scroll. Board bottom padding elsewhere: 24.

### 6.2 With the seed and with 14 tickets (states `default`, `col-prep`, `many`, `many-bottom`, `many-prep-bottom`; `many` = 14 patched tickets: To cook 7, Cooking 5, Ready 2; subtitle "14 active tickets · average wait 10 min")
| | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| seed: board scroll | 59 (803 in 744) | 59 | 91 (803 in 712) | 0 (To cook 249 tall) | 0 (To cook); **95** with "Cooking" chosen (825 in 730) |
| `many`: column heights | To cook 1859, Cooking 1357, Ready 488 | same | same | To cook 1140 (4 rows of 2) | To cook 1825 |
| `many`: board scroll range | 1155 (1899 in 744) | 1155 | 1187 (1899 in 712) | 114 (1180 in 1066) | 1191 (1921 in 730) |
| at the end (`many-bottom`) | last To cook card ends at y 776, 24 above the window bottom | same | ends 744 (768 − 24) | ends 1156 (1180 − 24) | Table 21 `[12,511,366,249]` ends at **760**: 84 above the window bottom, **25 px above the tab bar** (785) |
| `many-prep-bottom` (Cooking chosen) | – | – | – | no scroll (Cooking 843) | scroll 689 (1419 in 730) |

### 6.3 Classic scrollbars (state `many-scrollbar`: 14 tickets, Chrome launched without `--hide-scrollbars`, d1280 / c1280 / t1024 / t820)
The global rule gives vertical scrollbars `width:8px` (U0 §1.4); the bar sits **inside the board only** (not beside the header, unlike the Floor, U3 §9.1): board `clientWidth` 1040 / 1196 / 940 / 736 (offset 1048 / 1204 / 948 / 744), columns 322.656 / 322.672 / 322.656 (d1280), 374.656 / 374.672 / 374.656 (c1280), 3 × 289.33 (t1024), t820 2 × **343** (was 347); first card `[252,106,322.66,265]` (d1280). The header, the type control and the printer do not move (`[1224,9.5,36,36]`).

---

## 7. Animations and transitions (`document.getAnimations()`, times are the animations' own `currentTime`)

| What | Source | Measured |
|---|---|---|
| Page entrance (`anim`, Orders → Kitchen, ×5) | `pageIn .4s cubic-bezier(.2,.8,.2,1) backwards` (opacity 0 → 1, `translateY(6px)` → none; U0 §1.5) | at 17 ms (d1280, t1024, t820) +4.98 px / opacity 0.17; at 33 ms (c1280, p390) +3.99 / 0.33; at 183 ms +0.41 / 0.93, at 200 ms +0.32 / 0.95; done at 400 ms. |
| Card rise | `rise .35s cubic-bezier(.2,.8,.2,1) both` (opacity 0 → 1, `translateY(12px)` → none), **no delay**: every card rises together (the Floor staggers its tiles) | at 17 ms opacity 0.19, +9.68 px; at 33 ms 0.38, +7.44; at 183 ms 0.95, +0.56; at 200 ms 0.97, +0.42; finished at 350 ms (all seven cards in step). Page and card run together, so a card travels 18 px in all. Shots `anim-t20-*`, `anim-t120-*`, `anim-t320-*` ×5. |
| Type filter change (`anim-type` All → Dine-in, 1280 / 820) | the template keeps card elements by position | 40 ms after the click every visible card's `rise` reads *finished*: **nothing replays**, cards change content in place; only the type tabs' `background-color .16s` and `box-shadow .22s` run. |
| Type change that adds cards (`anim-type-back` Delivery → All) | elements that did not exist before run `rise` | To cook and Cooking cards all rise (at 50 ms 0.54 / +5.53); in Ready, Table 6 takes over the element that showed Delivery 3 and appears **without** animation, while Delivery 3 (now in a new, second element) rises again. |
| Column tab change (below 1024; `anim-ctab`, `anim-ctab-back`, 820 / 390) | the chosen column goes from `display:none` to `grid`, which restarts CSS animations | **every card of the newly shown column rises again** on every switch (t820 at 67 ms 0.66 / +4.07; p390 at 33 ms 0.38 / +7.45; done by 350 ms); switching back replays the other column's rise too. Tab chips: `background-color .16s`, `box-shadow .22s`. |
| Action press (`anim-start` 1280 / 390) | position reuse | d1280: Table 7 lands in a **new** 4th Cooking element and rises (50 ms: 0.54 / +5.55); Takeaway 14 jumps up into the first To cook slot with no movement. p390: the moved card goes to a hidden column; Takeaway 14 jumps up instantly (no slide, no fade-out of the leaving card). |
| Card leaving ("Served" etc.) | – | removed at once; the cards below jump up; no exit animation. |
| Tick (`anim-tick`) | global button transition | the row's `opacity` 1 → 0.5 over `.16s` (at 50 ms 0.73) and its hover `background-color .16s`; the checkbox fill changes instantly. |
| Hover / press | global button transition | item row background `.16s ease`; press `transform .16s ease` (5.4). |
| Reduced motion (`reduced-motion`, d1280, Orders → Kitchen with `prefers-reduced-motion: reduce`) | global rule: durations .01 ms, delays kept | at 20 ms after the click the page and every card are finished: the screen appears at once (no delays exist here, so nothing cascades — unlike the Floor, U3 §7). |

---

## 8. Roles, the phone tab bar and the More sheet

### 8.1 Who can open Kitchen (`ROLES`, app.js 48; `NAVDEF` 42)
| | Manager (Rohan) | Cashier (Priya) | Captain (Amit) | Kitchen role |
|---|---|---|---|---|
| Lands on after sign-in | Dashboard | Order | Floor | **nothing** (`home: null`, 8.3) |
| Kitchen in the side nav / rail | yes (5th in Operate) | yes | yes | no (nav is empty) |
| Kitchen on the phone | inside **More** | **tab bar**, 4th tab | tab bar, 4th tab | – |
| What the screen shows / allows | everything above | identical (`cashier` ×5: every named box and colour equal to `default`) | identical (`captain` 1280 / 390) | the full board if reached (8.3) |

The markup has no role branch: any role can tick items and press every action (no manager approval, unlike voids on the Order screen).

### 8.2 Phone tab bar and More sheet (390; U0 §2.6–§2.7 for the frame)
- **Cashier / Captain** (`cashier` p390): Floor `[0,788,78,56]`, Order `[78,…]`, Orders `[156,…]`, **Kitchen `[234,788,78,56]` lit** — label and 22 px icon (`[262,796.5,22,22]`, stroke 1.7) in `var(--accent)` `rgb(15,98,254)`; the others `var(--text-2)` `rgb(82,82,91)` —, More `[312,788,78,56]`.
- **Manager** (`default` p390): Home, Floor, Order, Orders, **More lit** `rgb(15,98,254)` (`moreC`: the route is one of `tabs0.slice(4)` = Kitchen, Bookings); no Kitchen tab.
- **More sheet with Kitchen lit** (`more-sheet`, Manager on Kitchen, tap "More"): scrim `[0,0,390,844]` `rgba(17,17,19,.42)` z 40 (covers the tab bar); panel `[0,355,390,489]` (radius `16px 16px 0 0`, padding-bottom 10); nav grid: **Kitchen `[13,445,86.5,72]`** bg `var(--accent-t)` `rgb(237,245,255)`, text and icon `var(--accent-i)` `rgb(0,67,206)`, 12px / 600, border `rgb(226,226,230)`, radius 12; Reservations `[105.5,445,…]`, Menu `[198,445,…]`, Reports `[290.5,445,…]`, Settings `[13,523,…]` (transparent, `rgb(24,24,27)`); rows "Lock screen" `[7,616,376,52]`, "Switch user" `[7,668,376,52]`; theme buttons y 765. Tapping "Kitchen" there closes the sheet and stays on Kitchen (source: close, then `nav('kitchen')`).
- Desktop (`profile-sheet`, d1280): the profile sheet has no nav grid (U0 §2.7); the side nav's "Kitchen" item is the lit one.

### 8.3 The Kitchen role (states `role-kitchen`, `role-kitchen-signin`; Rohan's role patched to `Kitchen`)
`ROLES.Kitchen = {home:null, nav:[]}`; `afterAuth()` returns `signIn()` on its first statement, so the clock-in / station step written after it never runs (dead code). Signing in as a Kitchen user (`role-kitchen-signin`) sets `route: null`: **no page renders** — on the phone an empty `var(--bg)` screen with a 3-column tab bar Floor · Order · More (`tabCols` 3; neither lit), on the desktop the side nav with no items. A Kitchen user already on the Kitchen route (`role-kitchen`, patched after sign-in) gets the full board, working, with an empty side nav and "Kitchen · Counter 1" under the name. STAFF0 has no Kitchen user, so the demo never shows this.

---

## 9. View-model logic (app.js, read; checked against the measurements)

### 9.1 Ticket shape (`mkTicket(o, lines, at, status)`, 418)
`{kid: ++kseq, oid: o.id, no: o.no, type: o.type, guests: o.guests, at, status, items: lines.map(x => ({name, size, qty, note: x.note || '', addons: x.addons || [], done: false}))}`. `kseq` is a module counter starting at 214, so the first ticket is KOT 215. Items are a **snapshot** of the order lines at send time (addon names only, no prices). Statuses: `new` (To cook) → `prep` (Cooking) → `ready` (Ready) → `done` (gone).

### 9.2 Filter and order (527)
`all = tickets.filter(t => t.status !== 'done')`; `T = all.filter(t => kTab === 'All' || t.type === kTab).sort((a, b) => a.at - b.at)` — **oldest first by `at`** (the time the ticket was made, i.e. the KOT time; not the time it changed column). Each column = `T.filter(t => t.status === k)`, so a card that moves keeps its age rank (Table 7, 4 min, goes to the bottom of Cooking; Table 13, 9 min, lands between Table 6 and Delivery 3 in Ready). Within a card, items keep the order line order.

### 9.3 Counts and the average
- Column head count = `String(list.length)`; column-tab count = `T.filter(status).length` — both over the **type-filtered** list.
- `sub = all.length + ' active tickets · average wait ' + avg + ' min'` with `avg = all.length ? round(Σ(now − at) / all.length / 60000) : 0` — over **all** active tickets of every type and column (Ready ones included), **ignoring the type filter**, from exact milliseconds, then rounded (seed 11.71 → 12). It is the average age since the KOT, not a measured wait.
- The time pill uses `floor` (4.4); the Floor's tile minutes use `round` with a minimum of 1 (U3 §0.1).

### 9.4 What each action does (`t.act`, 535)
`setT(kid, z => ({...z, status: next, items: next === 'ready' ? z.items.map(y => ({...y, done: true})) : z.items}))`, then the toast (5.2). Start cooking: `new → prep` (items untouched). Mark ready: `prep → ready` and **every item ticked**. Served / Picked up / Handed to rider: `ready → done` (filtered out; it never shows again anywhere: no history, no recall). Nothing writes back to the order (the order's lines, billing and the Floor tile are untouched), nothing prints, nothing checks the role, nothing asks to confirm, no undo.

### 9.5 Ticking (`i.toggle`, 534)
Flips `items[ii].done` on that ticket only. It does not change the status, the order or anything else; "n of m done" is the only summary.

### 9.6 Where tickets come from
- **Seed** (`seed()`, 414–417, run once on mount): for each order in the map `{'Table 4':['prep',14], 'Table 7':['new',4], 'Table 6':['ready',22], 'Table 13':['prep',9], 'Delivery 3':['ready',7], 'Takeaway 14':['new',2], 'Table 17':['prep',24]}` that has sent lines, one ticket of its **sent lines only**, `at = AGO(minutes)`, in `s.orders` order → KOT 215 Table 4, 216 Table 7, 217 Table 6, 218 Table 13, 219 Table 17, 220 Delivery 3, 221 Takeaway 14 (measured). Unsent lines (Table 4's Cold Coffee "Less sugar", Table 13's Garlic Naan, Delivery 3's Soft Drink) are not on the board. Table 1 (billed) and Takeaway 12 (empty) have no ticket.
- **`kot()`** (400; the Order screen's "Send KOT · n" button `sendKot` and the F8 key on route `order`): if the current order has unsent lines, a new ticket of those lines with `at = Date.now()`, status `new`; then the lines are marked sent and the toast "Sent {n} items to kitchen" ({n} = total quantity, always "items"). Measured in 5.3.
- **`sendMine()`** (171; the "Send to kitchen & lock" choice of the lock-with-unsent-items dialog): marks the user's unsent lines as sent **without making a ticket** — those items never reach the Kitchen board.
- Nothing else reads or writes `s.tickets` (search of app.js: line 98 `tickets:null`, 400 `kot()`, 417 `seed()`, 418 `mkTicket`, 527–540 `kitchenVals()`; the `tickets:` on line 810 is the lock screen's staff cards, unrelated). Paying, clearing, voiding or moving an order does not touch its tickets; tickets live only in memory (a reload re-seeds).

### 9.7 Words used, all from the source
Column labels "To cook" / "Cooking" / "Ready"; type labels "All" / "Dine-in" / "Takeaway" / "Delivery"; buttons "Start cooking" / "Mark ready" / "Served" / "Picked up" / "Handed to rider"; "No tickets here"; "Note: "; "KOT {kid} · {h:mm AM}"; "{d} of {n} done"; "Now" / "{m} min"; "{n} active tickets · average wait {m} min"; toasts in 5.2.

### 9.8 What the screen does not have
No keyboard shortcut (`onKey` returns for any route but `order` after ⌘/Ctrl+L and Escape, app.js 123–125), no sound or alert for a new or late ticket, no auto-refresh other than the 30 s `s.now` tick, no search, no station filter (the `STATIONS` constant, app.js 37, and each menu category's `station` are not used here), no bump / recall, no print button on a card, no undo.

---

## 10. HTML bugs and oddities seen (listed, not fixed; each needs the owner's ruling before it is copied or changed)

1. **Dark theme: every open item shows a white tick.** The tick `svg` is always drawn with the literal `color:#FFFFFF` on a transparent box; invisible on a white card, fully visible on the dark card, so open items look done ("0 of 2 done" under two ticked boxes; shot `dark-cards-390x844.png`). In light it shows faintly on the hovered row (`#F2F2F4`).
2. **"1 guests"** and **"1 active tickets"**: both plurals are fixed (4.3, 2.3); "Sent 1 items to kitchen" likewise (source, 9.6).
3. **Cards below 1024 are stretched to their row neighbour** (`align-items:stretch` in the column grid): a short card gets empty white space under its action button and the buttons of one row sit at different heights (54 px at 820 with the seed; 4.8).
4. **Switching column tabs replays the rise animation of every card** in the newly shown column (display none → grid), each time (7). A type change, by contrast, animates only the card elements that are new, so the same data cascades fully, partly or not at all (Delivery 3 rises again while Table 6 appears still).
5. **The type filter is invisible on the phone but still filters**: a `kTab` set on a wider screen keeps filtering at 390 with no control and no hint (3.5); it also survives a change of user (0.4).
6. **The header count and average ignore the type filter** ("7 active tickets" with "Delivery" chosen showing one card), and the average includes Ready tickets and is "time since KOT", not a wait (9.3).
7. **"Late" is shown only by a red card border, and only outside Ready**: a ticket waiting 30 min in Ready has a red pill but a normal border (4.4); nothing else (no count, no sound) flags late tickets.
8. **Ticking every item does not move the card**, and "Mark ready" ticks everything even if nothing was ticked (9.4, 9.5): the ticks and the columns are independent.
9. **No confirmation and no undo** on "Served" / "Picked up" / "Handed to rider", which remove the card for good; the toasts have no Undo although the shell supports one (5.2).
10. **The same table can show as two cards** (a second KOT for Table 4 sits in To cook while the first is in Cooking; 5.3); cards show the order id ("Table 4") while toasts say "T4".
11. **`short()` calls every id that is not "Table…" or "Takeaway…" a "Delivery"**, and drops all but the digits (9.6 / 5.2).
12. **`sendMine()` marks items sent without making a ticket**, so "Send to kitchen & lock" loses them from the Kitchen (9.6).
13. **Long words are cut, not wrapped**: an unbreakable item name runs past its text box and is clipped by the card edge with no ellipsis; at 1024 a long code's second line runs 28 px into the time pill's column (4.7).
14. **Quantities wider than 26 px push the name right** ("12×", "100×"), so names in one card stop lining up (4.7).
15. **The column-tab row has 12 px side padding at 820 while the board has 20 px**: the tabs start at x 88, the cards at x 96 (3.1).
16. **Column-tab counts are `var(--text-2)` while the column-head counts are `var(--text-3)`** for the same number (3.1, 3.2).
17. **The focus ring on "Start cooking" is nearly invisible** (Chrome's dark ring on the near-black button; 5.5); nothing on the screen has a designed focus style, and no hover look exists on the action buttons, type tabs or column tabs (5.4).
18. **"Mark ready" is white text on green**: 3.35:1 in light, 2.39:1 in dark (computed from the measured colours, 0.6); in dark "Start cooking" turns into a near-white button.
19. **At ≥ 1024 the three columns share one scroller**: scrolling a long To cook column scrolls the short Ready column out of view (6.1); with the seed the board already scrolls 59 px at 1280 (Cooking 763 tall).
20. **The toast is centred on the window, not on the page area** (640 at 1280 while the page centre is 756), and on the phone it covers the cards (5.2).
21. **A Kitchen-role user lands on a blank screen** (`home: null`) with a tab bar of Floor and Order only, and the station step after `return` in `afterAuth()` is dead code (8.3).
22. **Item borders and the empty box are written `1.5px`** and draw 1 px in Chrome (0.5).
23. **No exit or move animation**: a card that changes column or leaves disappears instantly and the cards below jump up; on the phone it vanishes into a hidden column with only the tab count changing (7, 5.2).
24. **Kitchen minutes and Floor minutes measure different things with different rounding**: the card counts from the KOT with `floor` (min 0, "Now"), the Floor tile from the order's opening with `round` (min 1); Table 4 reads "14 min" here and "32 min" on its Floor tile (U3 §4.3) at the same clock (9.3).

---

## 11. Shot index (`D:\kd\pos-dev-keep\ui-redesign\design\spec-shots-kitchen\`, 216 usable files)
Names are `<state>-<w>x<h>.png` (`-1280x800-collapsed` for the collapsed nav); mid-animation extras `<state>-<t>-<w>x<h>.png`. "×5" = 1280x800, 1280x800-collapsed, 1024x768, 820x1180, 390x844.
- Entry and roles: `default` ×5; `cashier` ×5; `captain` (1280, 390); `more-sheet` (390); `profile-sheet` (1280); `role-kitchen`, `role-kitchen-signin` (1280, 390).
- Type filter: `type-dine`, `type-take`, `type-del` (1280, collapsed, 1024, 820); `type-take-ready` (820); `type-del-phone` (390).
- Column tabs: `col-prep`, `col-ready` (820, 390).
- Cards (patched): `cards` ×5; `cards-prep`, `cards-ready` (820, 390); `cards-dpr2` (1280, 390; 2560×1600 / 780×1688 px); `long` ×5; `long-prep` (820, 390); `bands` ×5; `bands-prep`, `bands-ready` (820, 390).
- Interactions: `tick` ×5; `untick` (1280, 390); `tick-all` (1280, 820, 390); `start`, `ready`, `served`, `rider`, `pickup` ×5 (toasts); `take-ready`, `start-cooking-col` (1280, 820, 390); `kot-t4` (1280, 390); `kot-toast` (1280, Order screen).
- Hover / press: `hover-item`, `hover-item-done`, `hover-act`, `hover-act-ok`, `hover-printer`, `hover-type` (1280, collapsed); `press-act`, `press-item` (1280).
- Focus: `focus-item`, `focus-act`, `focus-printer` ×5; `focus-type` (1280, collapsed, 1024, 820); `focus-ctab` (820, 390); `focus-item-enter` (1280, 390).
- Scrolling: `many`, `many-bottom` ×5; `many-prep-bottom` (820, 390); `many-scrollbar` (1280, collapsed, 1024, 820).
- Empty / one: `empty` ×5; `empty-dpr2` (1280); `one` ×5.
- Animations: `anim` ×5 + `anim-t20-*`, `anim-t120-*`, `anim-t320-*` ×5; `anim-type`, `anim-type-back` (1280, 820) + `-t40`; `anim-ctab` (820, 390) + `-t40`; `anim-ctab-back` (820, 390); `anim-start` (1280, 390) + `-t40`; `anim-tick` (1280); `reduced-motion` (1280) + `-t20`.
- Dark: `dark` (1280, 390); `dark-cards` (1280, 390); `dark-bands-1280x800.png` and `dark-hover-item-1280x800.png` (the D: drive filled up while the last two d1280 runs were writing; both states were re-run into the session scratchpad and the two shots copied here on 2026-10-30; their values are in 0.6).

---

## Values I could not determine
- Hover on touch viewports (a finger produces none) and `:active` by touch; press was measured with the mouse at d1280 only.
- The printer panel (a later page) and the Order screen reached through `kot()` (U1) were not re-measured.
- Dark theme only at d1280 / p390 (`dark`, `dark-cards`) and d1280 (`dark-bands`, `dark-hover-item`); the dark empty box is given from tokens, not measured.
- `1.5px` borders on other engines and Android WebView (only Chrome 156 measured: 1 px at DPR 1 and 2).
- `env(safe-area-inset-bottom)` was 0 in every measurement (the board's bottom padding is 84 + the inset).
- Clock-dependent values only at the fixed clock (Mon 19 Oct 2026 9:30 PM IST); the 30 s `s.now` refresh was read from the source, not watched.
- Animation curves: two or three snapshots per run only.
- A Kitchen-role user was reached only by patching Rohan's role (no Kitchen user exists in the demo).
