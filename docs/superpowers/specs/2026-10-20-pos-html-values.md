# The owner's HTML mock-up, exact values: the Order screen (POS) and every overlay it opens

Source files (read-only, `D:\kd\pos-dev-keep\ui-redesign\design\`): `unpacked/markup.html` (template: Order screen lines 73–270; order bar 1207–1215; category sheet 1217–1239; item options modal 1241–1292; payment 1294–1339; open orders 1341–1369; customer sheet 1371–1442; table picker 1444–1469; confirm 1038–1046; manager approval 1048–1059; toast 1548–1553), `unpacked/app.js` (demo data lines 2–98; `onKey` 119–128; `lockNow` 167–169; `setType` 177–179; `pickTable` 180–183; `openCust` 185; `attach` 187; `saveCust` 188–191; `needs` 192; `ask` 193; `apPress` 388–390; `dots` 391; `keysFor` 392; `cur`/`setCur` 393–394; `flash` 395; `addLine` 396–399; `kot` 400; `totals` 401; `finish` 402; `pay` 403; `num` 404; `oxVals` 405–413; `renderVals` 737–953 with the `Lay` object (= `L`) on 742–746), and the original bundle `olivea-pos-latest.html` (`@font-face` rules, `data-props` defaults, the generated hover classes).

The theme tokens, fonts, global rules, keyframes and shared constants are in **U0 values** = `docs/superpowers/specs/2026-10-19-u0-html-values.md` §1; the shell (side nav, rail, tab bar, More/profile sheet, toast) in U0 §2. They are referred to by section number and not repeated. Colour tokens below are written `var(--x)` with the light value in brackets where it helps; every token's light and dark value is in U0 §1.1.

How values were obtained:
- Every value without a "measured" mark is copied verbatim from the source text (inline `style="…"` strings, `renderVals()` expressions, handler strings).
- "Measured" values come from rendering `olivea-pos-latest.html` in headless local Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`) driven by playwright-core 1.64 (the npx-cache copy `shoot.mjs` uses), every non-`file:`/`data:`/`blob:` request aborted, on 2026-10-20, reading `getBoundingClientRect()` and `getComputedStyle()`. Rects are `[x, y, width, height]` in CSS px (rounded to 0.01). Tool: `D:\kd\pos-dev-keep\ui-redesign\design\measure-pos.mjs`; states: `make-shoot-pos.mjs` → `shoot-pos.json` (98 states, 344 shots); raw results `measure-pos-out\json\<state>-<vp>.json` (named boxes + element trees with computed styles; `popular`, `tp-hover`, `tp-moved`, `tp-busy`, the p390 runs of `disc` / `svc-removed` / `take-bill` / `delivery-bill` and the two extra states `pizza-oos` / `photos-edit` come from a second pass after two finders were fixed); printer: `summarize-pos.mjs` (`boxes <state> [regex]`, `tree <state> <vp> header|cart|toolbar|aside|list|ov:<overlay>`, `style`, `meta`).
- Viewports (as U0): `d1280` 1280×800; `c1280` 1280×800 after a click on `button[title='Collapse']`; `t1024` 1024×768 `hasTouch`; `t820` 820×1180 `hasTouch`; `p390` 390×844 `isMobile`+`hasTouch`. Headless Chrome draws no classic scrollbars, so `::-webkit-scrollbar{width:8px}` took no layout width anywhere (as in U0).
- Entry to every state: load, wait 2500 ms, click `text=Rohan K.` (or `Priya S.` / `Amit V.` where a state says so), wait 500 ms, type `1234` (60 ms per key), wait 2800 ms (Rohan lands on the dashboard), [collapse], click `nav button[title='Order']` (phone: the fixed tab bar's button whose text is exactly "Order"), wait 2300 ms (the sign-in toast "Signed in as Rohan · Priya’s session saved" has gone by then). Priya lands on Order directly (she is the locked user and `lockedRoute` is `order`); Amit (Captain) lands on Floor and is taken to Order the same way. Then the state's actions, then the pointer is parked 21 px into the header's left edge (y 28; nothing there has a hover look) unless the state measures a hover, then 900 ms, then shot + measurement.
- Animations had finished at measuring time (longest: `rise .35s` with a delay up to .3 s in the open-orders list).

---

## 0. Conventions for this screen

### 0.1 Clock used
The mock-up's `Date` was fixed with `page.clock.setFixedTime(new Date("2026-10-19T21:30:00+05:30"))` = **Monday 19 October 2026, 9:30 PM IST** (the same `mockClock` as the U0 probe files `match\probes\*.json`); timers keep running. Every demo time is relative to load time (`AGO(m) = Date.now() − m×60000`), so with the fixed clock every age is exact. Clock-dependent values on this screen and their formulas:
- Header clock `clock` = `now.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'})+'  '+((h%12)||12)+':'+mm+(h<12?' AM':' PM')` → source string "Mon, 19 Oct␣␣9:30 PM" (two spaces); rendered "Mon, 19 Oct 9:30 PM" (white-space collapses to one).
- Order age in the cart meta and the open-orders rows: `mins = Math.max(1, Math.round((now − opened)/60000))` → Table 4 "32 min" (opened `AGO(32)`), Table 7 14, Table 1 68, Table 6 41, Table 13 22, Table 17 55, Takeaway 12 3, Delivery 3 9, Takeaway 14 6; a new order shows "1 min".
- Reservations shown in the table picker (`resMap()`, today's booked/confirmed reservations with a table and `at > now − 30 min`, earliest per table, `hm(at)+' · '+name`). Reservation times are `rt(m) = Math.round((now + m min)/15 min)×15 min`: at 21:30 → T3 9:45 PM (r1, rt(10)), T16 10:15 PM (r3, rt(45)), T9 11:00 PM (r4, rt(90)); r5 (T21, rt(150) = 00:00) falls on the next day and is not shown.
- `s.now` refreshes only when 30 s have passed (`setInterval` 1 s); with the fixed clock it never changes after load.

### 0.2 Breakpoint variables
`ph`, `tab`, `desk`, `wide`, `cmp`, `big` exactly as U0 §0.1 (`ph = w<720`, `tab = 720≤w<1100`, `desk = w≥1100`, `wide = w≥1280 && !navCollapsed`, `cmp = w<1024`, `big = w≥1024`). Per viewport: d1280 desk+wide+big; c1280 desk+big; t1024 tab+big; t820 tab+cmp; p390 ph+cmp. Also `s.h` (window height) decides `billOpen` (0.4).

### 0.3 `L` keys used by this screen, resolved

| Key | Expression (verbatim) | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|---|
| `headPad` | `ph?'0 12px':'0 20px'` | `0 20px` | `0 20px` | `0 20px` | `0 20px` | `0 12px` |
| `miniLogo` | `ph?'flex':'none'` | none | none | none | none | flex |
| `brandText` | `ph\|\|wide?'none':'flex'` | none | flex | flex | flex | none |
| `swMax` | `ph?'none':'340px'` | 340px | 340px | 340px | 340px | none |
| `swFlex` | `ph?'1':'0 1 auto'` | `0 1 auto` | `0 1 auto` | `0 1 auto` | `0 1 auto` | `1` |
| `newPad` | `ph?'0 12px':'0 14px'` | `0 14px` | `0 14px` | `0 14px` | `0 14px` | `0 12px` |
| `newText` | `ph?'none':'inline'` | inline | inline | inline | inline | none |
| `clockDisplay` | `ph?'none':'flex'` | flex | flex | flex | flex | none |
| `bodyCols` | `cmp?'minmax(0,1fr)':(tab?'minmax(0,1fr) 340px':(wide?'200px minmax(0,1fr) 360px':'220px minmax(0,1fr) 380px'))` | `200px minmax(0,1fr) 360px` | `220px minmax(0,1fr) 380px` | `minmax(0,1fr) 340px` | `minmax(0,1fr)` | `minmax(0,1fr)` |
| `asideDisplay` | `desk?'flex':'none'` | flex | flex | none | none | none |
| `catBtnDisplay` | `desk?'none':'flex'` | none | none | flex | flex | flex |
| `catRowH` | `ph?'44px':'34px'` | 34px | 34px | 34px | 34px | 44px |
| `mainPadB` | `ph?'150px':(cmp?'100px':'16px')` | 16px | 16px | 16px | 100px | 150px |
| `toolPad` | `ph?'10px 12px 4px':'14px 20px 4px'` | `14px 20px 4px` | same | same | same | `10px 12px 4px` |
| `slashDisplay` | `ph?'none':'inline'` | inline | inline | inline | inline | none |
| `listPad` | `ph?'14px 12px':'16px 20px'` | `16px 20px` | same | same | same | `14px 12px` |
| `photoH` | `ph?'96px':'112px'` | 112px | 112px | 112px | 112px | 96px |
| `priceH` | `desk?'40px':'46px'` | 40px | 40px | 46px | 46px | 46px |
| `cartDisplay` | `cmp?(s.cartOpen?'flex':'none'):'flex'` | flex | flex | flex | none / flex when open | none / flex when open |
| `cartPos` | `cmp?'fixed':'relative'` | relative | relative | relative | fixed | fixed |
| `cartLeft` | `ph?'0':'auto'` | auto | auto | auto | auto | 0 |
| `cartW` | `ph\|\|!cmp?'auto':'min(440px,100%)'` | auto | auto | auto | `min(440px,100%)` | auto |
| `cartSh` | `cmp&&!ph?'var(--pop)':'none'` | none | none | none | `var(--pop)` | none |
| `linesMin` | `ph?'180px':'150px'` | 150px | 150px | 150px | 150px | 180px |
| `stepBox` | `desk?'30px':'36px'` | 30px | 30px | 36px | 36px | 36px |
| `stepW` | `desk?'30px':'38px'` | 30px | 30px | 38px | 38px | 38px |
| `stepH` | `desk?'28px':'34px'` | 28px | 28px | 34px | 34px | 34px |
| `cartFootB` | `ph?'calc(12px + env(safe-area-inset-bottom))':'14px'` | 14px | 14px | 14px | 14px | `calc(12px + env(safe-area-inset-bottom))` (12 measured) |
| `obLeft` | `ph?'0':(wide?'232px':'76px')` | (232px) | (76px) | (76px) | 76px | 0 |
| `obBottom` | `ph?'calc(60px + env(safe-area-inset-bottom))':'0'` | 0 | 0 | 0 | 0 | `calc(60px + env(safe-area-inset-bottom))` (60 measured) |
| `opScrim` | `ph?'var(--scrim)':'rgba(0,0,0,.06)'` | `rgba(0,0,0,.06)` | same | same | same | `var(--scrim)` |
| `opAlign` | `ph?'flex-end':'flex-start'` | flex-start | flex-start | flex-start | flex-start | flex-end |
| `opJustify` | `ph?'center':'flex-end'` | flex-end | flex-end | flex-end | flex-end | center |
| `opPad` | `ph?'0':'62px 16px 16px'` | `62px 16px 16px` | same | same | same | 0 |
| `opW` | `ph?'100%':'420px'` | 420px | 420px | 420px | 420px | 100% |
| `opMaxH` | `ph?'86dvh':'min(640px, calc(100dvh - 80px))'` | `min(640px, calc(100dvh - 80px))` | same | same | same | 86dvh |
| `opRadius` | `ph?'18px 18px 0 0':'16px'` | 16px | 16px | 16px | 16px | `18px 18px 0 0` |
| `csH` | `ph?'88dvh':'600px'` | 600px | 600px | 600px | 600px | 88dvh |
| `csMaxH` | `ph?'88dvh':'calc(100dvh - 32px)'` | `calc(100dvh - 32px)` | same | same | same | 88dvh |
| `sheetAlign` / `sheetPad` / `sheetRadius` | U0 §2.1 | center / 16px / 14px | same | same | same | flex-end / 0 / `14px 14px 0 0` |
| `toastB` | U0 §2.1 | 24px | 24px | 24px | 92px | 140px |

Values in brackets are computed but unused (the order bar exists only when `cmp`).

Other per-viewport values from `renderVals`: `cartClosable = cmp` (the "‹ Menu" button); `cartScrim = cmp && !ph && s.cartOpen && R==='order'` (t820 only); `showBar = cmp && s.route==='order' && !s.cartOpen && o.cart.length>0`; `showTabbar` (U0 §2.6) on p390.

### 0.4 `billOpen` depends on the window height
`billOpen = s.billOpen ?? (s.h>=820)`; `billLabel = billOpen ? 'Hide details' : 'Details'`; `toggleBill` stores `!billOpen`. So the bill details start **closed** at 1280×800 and 1024×768 and **open** at 820×1180 and 390×844 (844 ≥ 820).

### 0.5 Rendering conventions (as U0 §0.2–§0.4, plus what this screen adds)
- Interpolations are `<span class="sc-interp">` wrappers (U0 §0.2). In flex containers on this screen the binding and the literal text are separate flex items with the container gap between them: group heading (dot · 8 · name · 8 · count), status line under a cart line (dot · 6 · text), Send KOT / Pay buttons (label · 8 · key chip), the Total button ("Total" · 6 · `billLabel`), charge rows (label · 8 · "Remove"), the header "Printer" indicator (dot · 6 · "Printer"), table tiles (dot · 5 · label), approval manager pills (avatar · 8 · name). The literal-text + binding pairs inside plain inline spans (e.g. "Subtotal · {{ itemCount }} items", "Add to order · {{ m.total }}", "Save &amp; add to {{ cur.id }}", "{{ itemCount }} items · {{ cur.id }}") are ordinary inline text.
- `line-height: normal` = 1.3 × font-size for Geist and Geist Mono (U0 §0.3). Measured text-box heights with `line-height:normal` on this screen: 11px→14, 11.5px→15, 12px→16, 12.5px→17, 13px→17, 13.5px→18, 14px→18, 14.5px→19, 15px→19, 16px→21, 17px→22, 18px→23, 20px→26, 22px→28, 26px→34, 36px→47. Explicit line-heights on this screen: price buttons 1.15 (10.5px→12.08, 13.5px→15.53), modal size buttons 1.2, switcher title 1.2 / sub 1.3, cart cells 1.25, brand 1.1 / 1.3, customer row right column 1.4, confirm body 1.5, approval sub 1.45, payment and customer notes 1.5.
- Buttons with no `padding` in their style keep the UA padding `1px 6px` (measured on the stepper buttons, Send KOT, Pay, the printer button); buttons with no `font-size` compute to 13.3333px (UA) — this matters only where they contain unstyled text (none visible here). Buttons also get the global transition and `:active{transform:scale(.97)}` (U0 §1.4).
- **Hover rules with a binding inside are empty.** The runtime turns each distinct `style-hover`/`style-active` string into a class (`.scpN:hover{… !important}`). Where the string contains a `{{ }}` binding the generated rule is empty (measured `.scp5:hover { }`): the category rows (`style-hover="background:{{ c.hover }}"`, aside and sheet) and the open-orders rows (`style-hover="background:{{ r.hover }}"`) have **no** hover look in the mock-up, although `c.hover` / `r.hover` are computed. Static hover strings work (list below, measured class names in brackets): switcher `border-color:var(--text-3);box-shadow:0 4px 14px rgba(0,0,0,.06)` (scp2); New, Pay, modal Add, customer Save/new buttons `background:var(--accent-h)` (scp3); printer button, cart cells, Send KOT, add-on rows, customer rows, split options, approval keys `background:var(--hover)` (scp4); item card `transform:translateY(-2px);box-shadow:0 10px 26px rgba(0,0,0,.08)` (scp6); price button hover `background:var(--surface);box-shadow:0 1px 2px rgba(0,0,0,.1)` (scp7) and active `background:var(--accent-t)` (scp8); Clear `background:var(--bad-t)` (scp9); stepper − / + `background:var(--surface-2)` (scpa); "+ New …" buttons `border-color:var(--accent);color:var(--accent-i)` (scpo); table tiles `transform:translateY(-2px)` (scpp); approval keys active `background:var(--surface-3)` (scpm).
- The photo slot never shows in this file: `showPhotos = (props.menuPhotos??'Show')!=='Hide'` is true and `photoMode` = `'show'`, but `[data-photo="show"]:has(> image-slot:not([data-filled])){display:none}` hides every empty slot, and the slots stay empty (the `image-slot` element tries to fetch `.image-slots.state.json` next to the file; Chrome blocks it from `file://`, measured console error). With `menuPhotos = "Add photos"` (`photoMode 'edit'`) the slot would show as a 112 px (phone 96 px) box with the "Add photo" placeholder (measured by forcing it, section 4.6).
- Borders written `1.5px` (veg marks, diet marks, customer-sheet fields, table tiles, add-on boxes, PIN dots) compute to `1px` at device-pixel-ratio 1 (Chrome floors border widths to whole device pixels); the boxes keep their written outer size.
- The Order page container has no `data-screen-label` (every other page has one).

---

## 1. Page container and header

### 1.1 Page container (`sc-if on.order`)
`div`: `display:{{ S.order }}` (`grid` when `route==='order'`, else `none`); `grid-template-rows:auto 1fr; min-width:0; min-height:0; animation:pageIn .4s cubic-bezier(.2,.8,.2,1) backwards`. It sits in the root grid's second column (U0 §2.2). Unlike the dashboard, this page does **not** scroll: the header is a grid row and the body below scrolls in parts (menu `main`, category list, cart). Measured: d1280 `[232,0,1048,800]`, c1280 `[76,0,1204,800]`, t1024 `[76,0,948,768]`, t820 `[76,0,744,1180]`, p390 `[0,0,390,844]`.

### 1.2 Header elements (verbatim)
| Element | Properties |
|---|---|
| header | `display:flex; align-items:center; gap:16px; padding:{{ L.headPad }}; height:56px; background:var(--surface); border-bottom:1px solid var(--border); min-width:0`. Not sticky (the page does not scroll). Note `height` (dashboard header: `min-height`). |
| Brand wrapper | `div`: `display:flex; align-items:center; gap:10px; min-width:max-content`. Always present: at d1280 both children are hidden, the wrapper is 0 wide, and the header gap still applies (measured x 252, the actions start at 268). |
| Mini logo | `div`: `display:{{ L.miniLogo }}; width:30px; height:30px; border-radius:8px; background:var(--brand); align-items:center; justify-content:center; font-family:'Shrikhand',Georgia,serif; font-weight:400; font-size:19px; padding-top:2px; color:#FFFFFF`; text `{{ restInitial }}` "O". Phone only. (No `flex:none`, unlike the dashboard's.) |
| Brand text | `div`: `display:{{ L.brandText }}; flex-direction:column` (only c1280, t1024, t820). Line 1 `{{ restaurantName }}` "Olivea Pizza": `font-family:'Shrikhand',Georgia,serif; font-weight:400; font-size:20px; line-height:1.1; color:var(--brand)` (#C8381F; computed line-height 22px). Line 2 `{{ subline }}` = `productName+' · Counter 1'` = "Sandbee POS · Counter 1": `font-size:12px; color:var(--text-2); line-height:1.3` (15.6px). |
| Actions | `div`: `flex:1; display:flex; align-items:center; justify-content:flex-end; gap:6px; min-width:0; overflow-x:auto`. |
| Switch order | `button title="Switch order"`, click `op.toggle`: `display:flex; align-items:center; gap:10px; height:42px; min-width:0; max-width:{{ L.swMax }}; flex:{{ L.swFlex }}; padding:0 10px 0 6px; border:1px solid var(--border); background:var(--surface); border-radius:12px; cursor:pointer; color:var(--text); text-align:left`; hover `border-color:var(--text-3); box-shadow:0 4px 14px rgba(0,0,0,.06)`. |
| · code tile | `span`: `position:relative; width:30px; height:30px; flex:none; border-radius:8px; background:var(--ink); color:var(--on-ink); display:flex; align-items:center; justify-content:center; font-size:11.5px; font-weight:700; letter-spacing:-.01em` (−0.115px); text `{{ sw.code }}`. |
| · status dot | `span` inside the tile: `position:absolute; right:-3px; top:-3px; width:9px; height:9px; border-radius:50%; background:{{ sw.dot }}; box-shadow:0 0 0 2px var(--surface)`. |
| · text | `span`: `display:flex; flex-direction:column; min-width:0; flex:1`. Title `{{ sw.title }}`: `font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.2` (16.8px). Sub `{{ sw.sub }}`: `font-size:11.5px; color:var(--text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.3` (14.95px). |
| · count pill | `span`: `flex:none; height:22px; padding:0 8px; border-radius:999px; background:var(--surface-3); color:var(--text-2); font-size:11.5px; font-weight:600; display:flex; align-items:center; white-space:nowrap`; text `{{ sw.count }}`. |
| · chevron | `svg 16×16 viewBox 0 0 24 24 fill none stroke currentColor stroke-width 2 linecap/linejoin round; style flex:none; color:var(--text-3)`; path `m6 9 6 6 6-6` (chevron down). |
| New | `button title="New takeaway"`, click `newOrder`: `display:flex; align-items:center; justify-content:center; gap:6px; flex:none; border:0; background:var(--accent); color:var(--on-accent); border-radius:12px; height:42px; padding:{{ L.newPad }}; font-size:13.5px; font-weight:600; cursor:pointer; white-space:nowrap`; hover `background:var(--accent-h)`. Plus icon `svg 15×15 stroke-width 2.4 stroke-linecap round` (no linejoin), path `M12 5v14M5 12h14`. Label `span style="display:{{ L.newText }}"` "New" (hidden on the phone: icon only). |
| Clock block | `div`: `display:{{ L.clockDisplay }}; align-items:center; gap:14px; min-width:max-content; padding-left:16px; border-left:1px solid var(--border); height:28px`. Children: printer indicator `span`: `display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-2)` with a `6×6` round dot `background:var(--ok)` then the literal "Printer" (static: it is always the green dot and the word "Printer", whatever the printer state); clock `span`: `font-size:13px; font-weight:500`, text `{{ clock }}` (0.1). |
| Printer button | U0 §2.5 "Printer" (36×36, `pr.title`, `pr.dot`; demo default `var(--ok)`, title "Printer · printing is on"). It is a direct child of the header, after the clock block. |

### 1.3 `sw` values (renderVals 836–844)
- `code = codeOf(o)`: Dine-in → `'T'+o.id.replace(/\D/g,'')` (e.g. "T4"); Takeaway → "TA"; Delivery → "DL".
- `title = o.id` (e.g. "Table 4", "Takeaway 16", "Delivery 3").
- `sub = (customer ? customer.name : o.type)+' · '+(itemQty ? itemQty+' items · '+RS(total) : 'No items yet')`, e.g. "Neha Joshi · 5 items · ₹954", "Takeaway · No items yet". `itemQty` is the sum of quantities ("1 items" is possible: no singular).
- `count = openAll.length+' open'`, `openAll` = orders with at least one line, plus the active order even when empty. Demo: "8 open" (Takeaway 12 is empty and not active, so it is not counted); after New: "9 open".
- `dot = stOf(o)[1]`: no lines `var(--text-3)`; billed `var(--bill)`; any unsent line `var(--warn)`; else `var(--ok)`. Table 4 starts with an unsent line → `var(--warn)` (measured `rgb(255,131,43)`).

### 1.4 Measured header (state `default`)
| Element | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| header | `[232,0,1048,56]` | `[76,0,1204,56]` | `[76,0,948,56]` | `[76,0,744,56]` | `[0,0,390,56]` |
| brand wrapper | `[252,27.5,0,0]` | `[96,8.7,138.47,37.59]` | same as c1280 | same | `[12,12.5,30,30]` |
| mini logo | hidden | hidden | hidden | hidden | `[12,12.5,30,30]` |
| "Olivea Pizza" | hidden | `[96,8.7,138.47,22]` | same | same | hidden |
| "Sandbee POS · Counter 1" | hidden | `[96,30.7,138.47,15.59]` | same | same | hidden |
| actions | `[268,6.5,716.16,42]` | `[250.47,6.5,733.69,42]` | `[250.47,6.5,477.69,42]` | `[250.47,6.5,273.69,42]` | `[58,6.5,268,42]` |
| Switch order | `[610.45,6.5,289.8,42]` | `[610.45,6.5,289.8,42]` | `[354.45,6.5,289.8,42]` | `[250.47,6.5,189.78,42]` | `[58,6.5,223,42]` |
| · code tile | `[617.45,12.5,30,30]` | same | `[361.45,12.5,30,30]` | `[257.47,12.5,30,30]` | `[65,12.5,30,30]` |
| · dot | `[641.45,9.5,9,9]` | same | `[385.45,9.5,9,9]` | `[281.47,9.5,9,9]` | `[89,9.5,9,9]` |
| · title | `[657.45,11.63,142.45,16.8]` | same | `[401.45,11.63,142.45,16.8]` | `[297.47,11.63,42.44,16.8]` | `[105,11.63,75.66,16.8]` |
| · sub | `[657.45,28.42,142.45,14.94]` | same | `[401.45,28.42,142.45,14.94]` | `[297.47,28.42,42.44,14.94]` | `[105,28.42,75.66,14.94]` |
| · count pill | `[809.91,16.5,53.34,22]` | same | `[553.91,16.5,53.34,22]` | `[349.91,16.5,53.34,22]` | `[190.66,16.5,53.34,22]` |
| · chevron | `[873.25,19.5,16,16]` | same | `[617.25,19.5,16,16]` | `[413.25,19.5,16,16]` | `[254,19.5,16,16]` |
| New | `[906.25,6.5,77.91,42]` | same | `[650.25,6.5,77.91,42]` | `[446.25,6.5,77.91,42]` | `[287,6.5,39,42]` |
| · icon | `[920.25,20,15,15]` | same | `[664.25,20,15,15]` | `[460.25,20,15,15]` | `[299,20,15,15]` |
| · "New" | `[941.25,18.5,28.91,18]` | same | `[685.25,18.5,28.91,18]` | `[481.25,18.5,28.91,18]` | hidden |
| clock block | `[1000.16,13.5,207.84,28]` | same | `[744.16,13.5,207.84,28]` | `[540.16,13.5,207.84,28]` | hidden |
| · "Printer" | `[1017.16,19.5,49.05,16]` (dot `[1017.16,24.5,6,6]`) | same | `[761.16,19.5,49.05,16]` | `[557.16,19.5,49.05,16]` | hidden |
| · clock | `[1080.2,19,127.8,17]` | same | `[824.2,19,127.8,17]` | `[620.2,19,127.8,17]` | hidden |
| printer button | `[1224,9.5,36,36]` (dot `[1252,7.5,10,10]`) | same | `[968,9.5,36,36]` | `[764,9.5,36,36]` | `[342,9.5,36,36]` (dot `[370,7.5,10,10]`) |

Notes from the measurements:
- The switch button's natural width is 289.8 (it never reaches `max-width:340px` with the demo strings). At **t820** the actions area is only 273.69 wide (brand 138.47 + clock block 207.84 take the rest), the button shrinks to 189.78 and its title and sub are ellipsised to 42.44 px ("Tabl…", "Neha …", shot `default-820x1180.png`). At p390 (`flex:1`) it is 223 wide and the text column 75.66 ("Table 4", "Neha Joshi · …").
- Header gaps: 16 between the brand wrapper, actions, clock block and printer button; 6 inside the actions; the switch button sits at the right end of the actions area (`justify-content:flex-end`).
- Clock text measured "Mon, 19 Oct 9:30 PM" (one space after "Oct"), 13px/500, height 17.

---

## 2. Category aside (desk ≥ 1100) and category sheet (below 1100)

### 2.0 Body grid
`div`: `display:grid; grid-template-columns:{{ L.bodyCols }}; min-height:0`. Children in order: `aside`, `main`, [cart scrim], cart `section` (section 5). Measured `grid-template-columns`: d1280 `200px 488px 360px`; c1280 `220px 604px 380px`; t1024 `608px 340px` (aside `display:none` takes no track); t820 `744px`; p390 `390px`. Body box: d1280 `[232,56,1048,744]`, c1280 `[76,56,1204,744]`, t1024 `[76,56,948,712]`, t820 `[76,56,744,1124]`, p390 `[0,56,390,788]`.

### 2.1 Aside elements (verbatim)
| Element | Properties |
|---|---|
| aside | `display:{{ L.asideDisplay }}; flex-direction:column; min-height:0; background:var(--surface); border-right:1px solid var(--border)`. |
| Top block | `div`: `flex:none; padding:14px 12px 6px; display:flex; flex-direction:column; gap:8px`. |
| Title row | `div`: `display:flex; justify-content:space-between; align-items:baseline; padding:0 4px`. Left `span` "Categories": `font-size:13px; font-weight:600`. Right `span` `{{ catTotal }}` = `catArr().length+' total'` = "24 total": `font-size:12px; color:var(--text-2)`. |
| Find box | `div`: `display:flex; align-items:center; gap:8px; height:34px; border:1px solid var(--border); border-radius:6px; padding:0 10px; background:var(--bg)` (#F4F4F5). Magnifier `svg 14×14 fill none stroke currentColor stroke-width 2 stroke-linecap round; style color:var(--text-3); flex:none`, `circle cx 11 cy 11 r 7` + `path m20 20-3.5-3.5`. `input value="{{ catQuery }}" placeholder="Find category"`: `flex:1; min-width:0; border:0; outline:0; background:transparent; font-family:inherit; font-size:13px; color:var(--text)`; placeholder colour `var(--text-3)` (U0 §1.4). No focus look (outline 0, the box does not change). |
| List | `div`: `flex:1; overflow:auto; padding:0 8px 16px`. Items from `cats` (2.3). |
| Section header | `div`: `font-size:11px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--text-2); padding:14px 10px 4px` (measured height 32, letter-spacing 0.55px). Text = section name, rendered uppercase ("STARTERS", "MAINS", "SIDES", "DRINKS", "DESSERTS"). |
| Row | `button`, click `c.onClick`: `width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; border:0; border-radius:6px; height:{{ L.catRowH }}; padding:0 10px; font-size:13.5px; font-weight:{{ c.weight }}; background:{{ c.bg }}; color:{{ c.color }}; cursor:pointer; text-align:left`; `style-hover="background:{{ c.hover }}"` → empty rule, **no hover look** (0.5; measured: hovered "Soups" row keeps a transparent background). |
| · left | `span`: `display:flex; align-items:center; gap:9px; min-width:0`. Dot `span`: `display:{{ c.dotDisplay }}; width:8px; height:8px; flex:none; border-radius:50%; background:{{ c.dot }}`. Name `span`: `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`, text `{{ c.name }}`. |
| · count | `span`: `font-size:12px; color:{{ c.countColor }}`, text `{{ c.count }}`. |

### 2.2 Row values (`row(name,count,key,hue)`, renderVals 759)
`on = s.cat===key`. `weight: on?600:400`; `bg: on?'var(--accent-t)':'transparent'`; `hover: on?'var(--accent-t)':'var(--surface-2)'` (unused, 0.5); `color: on?'var(--accent-i)':'var(--ink)'`; `countColor: on?'var(--accent-i)':'var(--text-3)'`; `dot: hue||'transparent'`, `dotDisplay: hue?'block':'none'`; click → `setState({cat:key, catSheet:false})` (also closes the sheet). Measured selected row: background `rgb(237,245,255)`, colour `rgb(0,67,206)`, weight 600; normal row colour `rgb(24,24,27)`, count `rgb(107,107,116)`.

### 2.3 Rows list (`cats`, renderVals 758–761)
- When the find query `cq` (trimmed, lower-case `catQuery`) is empty: first `row('All items', ITEMS.length, 'All')` = "All items" **71** (no dot) and `row('Popular', ITEMS.filter(i=>i.pop).length, 'Popular')` = "Popular" **13** (no dot).
- Then for each section of `SECTIONS = ['Starters','Mains','Sides','Drinks','Desserts']`: the categories of that section whose name contains `cq`; if any, a header `{isHeader:true, name:sec}` and one row per category with the section hue `SEC_HUE = {Starters:'#E8590C', Mains:'#C92A2A', Sides:'#D19A00', Drinks:'#1C7ED6', Desserts:'#AE3EC9'}`.
- **Category rows show no count in the mock-up**: the row's count is `mm[2].length` where `mm[2]` is the category object (`{name,sec,station,kot}`), which has no `length`; the count span renders empty (measured width 0 at x = row right − 10). Only "All items" and "Popular" show a number. (Whether to show the real item count is an owner decision.)
- With a query, "All items" and "Popular" are dropped; sections with no match are dropped; no match at all → the list is simply empty (no empty-state text; measured `cat-find-none`).
- Demo categories (24, in order) and sections: Starters: Starters, Soups, Salads, Momos, Tandoor · Mains: Pizza, Burgers, Pasta, Biryani, Curries · Veg, Curries · Non-veg, Breads, Rice, Chinese, Noodles, Wraps, Sandwiches · Sides: Sides · Drinks: Cold Beverages, Hot Beverages, Shakes, Mocktails · Desserts: Desserts, Ice Cream.
- Find "ve" → MAINS: Curries · Veg, Curries · Non-veg; DRINKS: Cold Beverages, Hot Beverages (measured).

### 2.4 Measured aside (state `default`; the aside exists at d1280 and c1280 only)
| Element | d1280 | c1280 |
|---|---|---|
| aside | `[232,56,200,744]` | `[76,56,220,744]` |
| top block | `[232,56,199,79]` | `[76,56,219,79]` |
| title row | `[244,70,175,17]` | `[88,70,195,17]` |
| "Categories" | `[248,70,67.91,17]` | `[92,70,67.91,17]` |
| "24 total" | `[372.28,71,42.72,16]` | `[236.28,71,42.72,16]` |
| find box | `[244,95,175,34]` | `[88,95,195,34]` |
| · icon | `[255,105,14,14]` | `[99,105,14,14]` |
| · input | `[277,102.5,131,19]` | `[121,102.5,151,19]` |
| list (scroller) | `[232,135,199,665]` (scrollHeight 1060) | `[76,135,219,665]` |
| "All items" row (selected) | `[240,135,183,34]`, name `[250,143,56.27,18]`, count "71" `[398.02,144,14.98,16]` | `[84,135,203,34]` |
| "Popular" row | `[240,169,183,34]`, count "13" `[398.59,178,14.41,16]` | `[84,169,203,34]` |
| "STARTERS" header | `[240,203,183,32]` | `[84,203,203,32]` |
| "Starters" row | `[240,235,183,34]`, dot `[250,248,8,8]`, name `[267,243,49.42,18]`, count `[413,252,0,0]` | `[84,235,203,34]` |
| next rows | Soups 269, Salads 303, Momos 337, Tandoor 371, "MAINS" header 405 (h 32), Pizza 437, Burgers 471 … (34 apart) | same y |

Find "ve" (d1280): input value "ve", focused; list: "MAINS" header `[240,135,183,32]`, Curries · Veg `[240,167,183,34]`, Curries · Non-veg 201, "DRINKS" 235, Cold Beverages 267, Hot Beverages 301.

### 2.5 "Category" button (below 1100) — in the toolbar, section 3.

### 2.6 Category sheet (`sc-if catSheet`)
| Element | Properties |
|---|---|
| Scrim | `div`, click `closeCatSheet`: `animation:fadeIn .2s ease both; position:fixed; inset:0; background:var(--scrim); display:flex; align-items:flex-end; z-index:20`. Bottom-aligned at every width (no `L.sheetAlign`). |
| Panel | `div`, click stops: `animation:sheetIn .34s cubic-bezier(.2,.8,.2,1) both; width:100%; max-height:82dvh; background:var(--surface); border-radius:14px 14px 0 0; display:flex; flex-direction:column`. Full window width even at 1024 (no max-width, no border, no shadow). |
| Head | `div`: `flex:none; padding:14px 14px 8px; display:flex; flex-direction:column; gap:10px`. Row `display:flex; justify-content:space-between; align-items:center`: "Categories" `font-size:16px; font-weight:600`; "Done" `button` (click `closeCatSheet`): `border:0; background:transparent; color:var(--link); font-size:15px; font-weight:500; cursor:pointer` (UA padding 1px 6px kept). Then the same find box as 2.1 (same `catQuery`: the aside and the sheet share it). |
| List | `div`: `flex:1; overflow:auto; padding:0 8px 24px`; same headers and rows as 2.1 with `height:{{ L.catRowH }}` (34px; 44px on the phone). Picking a row closes the sheet. |

Measured sheet:
| Element | t1024 | t820 | p390 |
|---|---|---|---|
| panel | `[0,138.25,1024,629.75]` | `[0,212.41,820,967.59]` | `[0,151.92,390,692.08]` |
| head | `[0,138.25,1024,87]` | `[0,212.41,820,87]` | `[0,151.92,390,87]` |
| "Categories" / "Done" | `[14,152.25,83.58,21]` / `[961.31,152.25,48.69,21]` | `[14,226.41,83.58,21]` / `[757.31,226.41,48.69,21]` | `[14,165.92,83.58,21]` / `[327.31,165.92,48.69,21]` |
| find box | `[14,183.25,996,34]` (input `[47,190.75,952,19]`) | `[14,257.41,792,34]` (input `[47,264.91,748,19]`) | `[14,196.92,362,34]` (input `[47,204.42,318,19]`) |
| list | `[0,225.25,1024,542.75]` (scrollHeight 1068) | `[0,299.41,820,880.59]` | `[0,238.92,390,605.08]` (scrollHeight 1328) |
| first row ("All items", selected) | `[8,225.25,1008,34]` | `[8,299.41,804,34]` | `[8,238.92,374,44]`, name `[18,251.92,56.27,18]`, count `[357.02,252.92,14.98,16]` |
| header row | h 32 | h 32 | `[8,326.92,374,32]` |

The panel is `max-height:82dvh` = 0.82 × window height (629.76 / 967.6 / 692.08) while the list is long; with a query it shrinks to its content (p390 find "ve": panel `[0,493,390,351]`, list `[0,580,390,264]`).

---

## 3. Menu column: `main`, toolbar, search and diet filter

### 3.1 Elements (verbatim)
| Element | Properties |
|---|---|
| main | `main`: `overflow:auto; min-width:0; padding-bottom:{{ L.mainPadB }}`. It is the menu scroller (the toolbar is sticky inside it). |
| Toolbar | `div`: `position:sticky; top:0; z-index:3; background:var(--bg); padding:{{ L.toolPad }}`. |
| Toolbar row | `div`: `display:flex; gap:8px; align-items:center`. |
| Search box | `div`: `flex:1; display:flex; align-items:center; gap:8px; background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:0 10px; height:36px; min-width:0`. No focus look. |
| · icon | `svg 15×15 fill none stroke currentColor stroke-width 2 stroke-linecap round; style color:var(--text-3); flex:none`; `circle cx 11 cy 11 r 7`, `path m20 20-3.5-3.5`. |
| · input | `input ref={{ searchRef }} value="{{ query }}" placeholder="Search items"`: `border:0; outline:0; flex:1; font-family:inherit; font-size:14px; background:transparent; color:var(--text); min-width:0` (14px also on the phone). |
| · "/" chip | `span`: `display:{{ L.slashDisplay }}; font-size:11px; color:var(--text-3); border:1px solid var(--border); border-radius:4px; padding:0 5px; line-height:16px`; text "/". Hidden on the phone. |
| Diet filter | `div`: `display:flex; background:var(--surface-3); border-radius:8px; padding:2px; height:36px; flex:none` (no gap). |
| · option | `button` per `dietFilters` (All, Veg, Non-veg): `display:flex; align-items:center; gap:6px; border:0; border-radius:6px; padding:0 11px; font-size:13px; font-weight:500; cursor:pointer; background:{{ d.bg }}; color:var(--text); box-shadow:{{ d.shadow }}; white-space:nowrap`. Selected = `SEG_ON` (`var(--seg)` #FFFFFF, `var(--seg-sh)`), others `SEG_OFF` (U0 §1.6). |
| · · mark | `span`: `display:{{ d.markDisplay }}; width:11px; height:11px; border:1.5px solid {{ d.mark }}; border-radius:2px; align-items:center; justify-content:center` with an inner `4×4` round dot `background:{{ d.mark }}`. `mark` = `var(--veg)` for Veg, `var(--nonveg)` otherwise; `markDisplay` = `none` for All, `flex` otherwise. Measured border 1px at device-pixel-ratio 1 (Chrome draws a 1.5px border as 1px at DPR 1). |
| · · label | `span style="display:{{ d.textDisplay }}"` text `{{ d.label }}`; `textDisplay = ph && d!=='All' ? 'none' : 'inline'` → on the phone Veg and Non-veg are marks only, "All" keeps its word. |
| Category button | `button`, click `openCatSheet`: `display:{{ L.catBtnDisplay }}; margin-top:10px; width:100%; align-items:center; justify-content:space-between; height:40px; padding:0 12px; border:1px solid var(--border); background:var(--surface); border-radius:8px; font-size:14px; color:var(--text); cursor:pointer`. Left `span style="display:flex;gap:8px"`: "Category" `color:var(--text-2)` + `{{ curCatName }}` `font-weight:600` (`s.cat==='All' ? 'All items' : s.cat`, e.g. "Pizza", "Popular"). Right chevron `svg 16×16 stroke-width 2 round caps/joins; style color:var(--text-2)`, path `m6 9 6 6 6-6`. No hover rule. |
| List wrapper | `div`: `padding:{{ L.listPad }}`. Holds the groups (section 4) and the empty text. |
| No results | `sc-if empty` (`groups.length===0`): `div`: `text-align:center; padding:64px 0; color:var(--text-2); font-size:14px`; text `No results for “{{ query }}”` (curly quotes U+201C/U+201D around the raw query). Shown for any filter combination that leaves no group (also an empty diet × category combination, with an empty `query`: "No results for “”"). |

### 3.2 Filtering (`match`, renderVals 747–748)
`q = s.query.trim().toLowerCase()`. An item shows when `(s.cat==='All' || (s.cat==='Popular' ? it.pop : it.cat===s.cat)) && dietOk(it) && (!q || (it.name+' '+it.cat).toLowerCase().includes(q))`; `dietOk = s.diet==='All' || (s.diet==='Veg' ? it.veg : !it.veg)`. Archived items (`it.archived`) never show. Groups keep the category order (2.3) and drop empty ones. Search, category and diet combine. Search also matches the category name (e.g. "chi" → every item of "Chinese" and every "Chicken …": 15 groups, measured). "Popular" (state `popular`) keeps the category grouping: 12 groups, each with its popular items (Starters 1, Momos 1, Tandoor 1, Pizza 2, Burgers 1, Biryani 1, Curries · Veg 1, Curries · Non-veg 1, Wraps 1, Sides 1, Cold Beverages 1, Desserts 1); the Category button then reads "Category Popular". Veg (state `diet-veg`): 23 groups (Salads 1, Pizza 3 …); Non-veg (`diet-nonveg`): 15 groups.

### 3.3 Measured toolbar (state `default`)
| Element | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| main | `[432,56,488,744]` | `[296,56,604,744]` | `[76,56,608,712]` | `[76,56,744,1124]` | `[0,56,390,788]` |
| toolbar | `[432,56,488,54]` | `[296,56,604,54]` | `[76,56,608,104]` | `[76,56,744,104]` | `[0,56,390,100]` |
| row | `[452,70,448,36]` | `[316,70,564,36]` | `[96,70,568,36]` | `[96,70,704,36]` | `[12,66,366,36]` |
| search box | `[452,70,244.25,36]` | `[316,70,360.25,36]` | `[96,70,364.25,36]` | `[96,70,500.25,36]` | `[12,66,250.13,36]` |
| · icon | `[463,80.5,15,15]` | `[327,80.5,15,15]` | `[107,80.5,15,15]` | `[107,80.5,15,15]` | `[23,76.5,15,15]` |
| · input | `[486,78,173.97,20]` | `[350,78,289.97,20]` | `[130,78,293.97,20]` | `[130,78,429.97,20]` | `[46,74,205.13,20]` |
| · "/" | `[667.97,79,17.28,18]` | `[647.97,79,17.28,18]` | `[431.97,79,17.28,18]` | `[567.97,79,17.28,18]` | hidden |
| diet filter | `[704.25,70,195.75,36]` | `[684.25,70,195.75,36]` | `[468.25,70,195.75,36]` | `[604.25,70,195.75,36]` | `[270.13,66,107.88,36]` |
| · All | `[706.25,72,37.88,32]` | `[686.25,72,37.88,32]` | `[470.25,72,37.88,32]` | `[606.25,72,37.88,32]` | `[272.13,68,37.88,32]` |
| · Veg | `[744.13,72,62.63,32]` (mark `[755.13,82.5,11,11]`, label `[772.13,79.5,23.63,17]`) | `[724.13,72,62.63,32]` | `[508.13,72,62.63,32]` | `[644.13,72,62.63,32]` | `[310,68,33,32]` (mark `[321,78.5,11,11]`) |
| · Non-veg | `[806.75,72,91.25,32]` (label `[834.75,79.5,52.25,17]`) | `[786.75,72,91.25,32]` | `[570.75,72,91.25,32]` | `[706.75,72,91.25,32]` | `[343,68,33,32]` (mark `[354,78.5,11,11]`) |
| Category button | hidden | hidden | `[96,116,568,40]` | `[96,116,704,40]` | `[12,112,366,40]` |
| · "Category" / value | – | – | `[109,127,58.31,18]` / `[175.31,127,58.34,18]` | same | `[25,123,58.31,18]` / `[91.31,123,58.34,18]` |
| · chevron | – | – | `[635,128,16,16]` | `[771,128,16,16]` | `[349,124,16,16]` |
| list wrapper | `[432,110,488,6217]` | `[296,110,604,6217]` | `[76,160,608,6463]` | `[76,160,744,5022]` | `[0,156,390,10389]` |

No results ("zzz"): d1280 `[452,126,448,146]` (text "No results for “zzz”", 14px, `rgb(82,82,91)`, padding 64/0); p390 `[12,170,366,146]`. The search input keeps focus (`/` focuses it, 3.4).

### 3.4 Focus
`/` (when the focus is not in an input, route `order`) → `preventDefault` + `searchRef.current.focus()` (measured: the input is focused and the typed text lands in it). Clicking a diet option leaves the focus on that button. No element on this screen has a visible focus style (inputs `outline:0`; buttons use the browser default focus ring only for keyboard focus).

---

## 4. Item groups and item cards

### 4.1 Elements (verbatim)
| Element | Properties |
|---|---|
| Group | `section style="margin-bottom:24px"`, one per non-empty category (`groups`). |
| Group heading | `div`: `display:flex; align-items:center; gap:8px; font-size:13.5px; font-weight:600; color:var(--text); margin:4px 0 10px`. Children: `8×8` round dot `background:{{ g.dot }}` (the section hue, 2.3); `{{ g.name }}`; `span style="font-weight:400;color:var(--text-3)"` `{{ g.count }}` (number of items shown in the group). The 4px top margin collapses through the section (measured: the first section starts at list top + 16 + 4). |
| Card grid | `div`: `display:grid; grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr)); gap:8px`. |
| Card | `div`: `transition:transform .28s cubic-bezier(.2,.8,.2,1),box-shadow .28s,border-color .2s; background:var(--surface); border:1px solid {{ p.border }}; box-shadow:{{ p.ring }}; border-radius:14px; padding:12px; display:flex; flex-direction:column; gap:10px; opacity:{{ p.opacity }}`; hover `transform:translateY(-2px); box-shadow:0 10px 26px rgba(0,0,0,.08)` (measured hovered: `matrix(1,0,0,1,0,-2)`, `rgba(0,0,0,0.08) 0px 10px 26px 0px`; on an in-cart card the hover shadow replaces the 1px accent ring while hovered, because the hover rule is `!important` — cascade, not measured). |
| Photo (`sc-if showPhotos`) | `div data-photo="{{ photoMode }}"`: `position:relative; height:{{ L.photoH }}; border-radius:10px; overflow:hidden; background:var(--surface-2); filter:{{ p.photoFilter }}` with `image-slot id="{{ p.slot }}" shape="rect" fit="cover" placeholder="Add photo" style="position:absolute;inset:0;width:100%;height:100%"`. Hidden in this file (0.5): measured `display:none` on every card. |
| Name button | `button disabled="{{ p.oos }}"`, click `p.onOpen` (opens the item modal, section 10): `border:0; background:transparent; text-align:left; padding:0; cursor:pointer; color:inherit; display:flex; align-items:flex-start; gap:8px; width:100%`. |
| · veg mark | `span`: `width:12px; height:12px; flex:none; margin-top:3px; border:1.5px solid {{ p.mark }}; border-radius:2px; display:flex; align-items:center; justify-content:center` + inner `span` `width:4px; height:4px; border-radius:50%; background:{{ p.mark }}`. `mark` = `var(--veg)` (#198038) / `var(--nonveg)` (#A2191F). Measured border 1px at DPR 1. |
| · text column | `span`: `flex:1; min-width:0; display:flex; flex-direction:column; gap:2px`. Name: `font-weight:500; font-size:14.5px; letter-spacing:-.005em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis` (−0.0725px). Tag: `font-size:12px; color:{{ p.tagColor }}`, text `{{ p.tag }}`. |
| · in-cart badge (`sc-if p.inCart`) | `span`: `animation:pop .35s cubic-bezier(.2,.8,.2,1) both; flex:none; min-width:20px; height:20px; padding:0 6px; border-radius:10px; background:var(--accent); color:var(--on-accent); font-size:12px; font-weight:600; display:flex; align-items:center; justify-content:center`; text `{{ p.qty }}`. `@keyframes pop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.18)}100%{transform:scale(1);opacity:1}}`. |
| Price strip | `div`: `display:grid; grid-template-columns:repeat({{ p.cols }},1fr); background:var(--surface-2); border-radius:8px; padding:2px; gap:2px`. |
| · price button | `button disabled="{{ p.oos }}" title="Add {{ s.label }}"`, click `s.onAdd`: `border:0; background:transparent; border-radius:6px; height:{{ L.priceH }}; cursor:pointer; color:var(--text); display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1.15`; hover `background:var(--surface); box-shadow:0 1px 2px rgba(0,0,0,.1)`; active `background:var(--accent-t)` (+ the global `scale(.97)`; measured while pressed: background `rgb(237,245,255)`, `matrix(0.97,…)`). Label `span` `font-size:10.5px; color:var(--text-2)` (`{{ s.label }}`); price `span` `font-size:13.5px; font-weight:600` (`{{ s.price }}`). Computed line heights 12.08 / 15.53. |

### 4.2 Card values (renderVals 751–757)
- `qty = qtyOf(it.name)` = sum of `qty` of every cart line with that name (sent or not, any size). `inCart = qty>0`.
- `border = qty>0 ? 'var(--accent)' : 'var(--border)'`; `ring = qty>0 ? '0 0 0 1px var(--accent)' : 'none'` (written `'0 0 0 1px '+AC`).
- `tag = it.oos ? 'Unavailable' : (it.pop ? 'Popular' : (ADDONS[it.cat] ? 'Customisable' : ' '))` — a no-break space keeps the tag line (16 px) on every card, so every card has the same height. `tagColor = it.oos ? 'var(--bad-i)' : 'var(--text-2)'`. Customisable categories (with add-ons): Pizza, Burgers, Pasta.
- `opacity = it.oos ? .45 : 1`; `photoFilter = it.oos ? 'grayscale(1)' : 'none'`; both buttons get `disabled` when `oos` (no modal, no add; `cursor:not-allowed` from the global rule, no `:active` scale).
- `cols = it.sizes.length`; each size: `label = short(label)||'Add'` with `short = {Regular:'Reg',Medium:'Med',Large:'Lrg',Standard:''}[l] ?? l` (so "Standard" → "Add", "Half" stays "Half", "6 pcs" stays "6 pcs"); `price = RS(price)`; `title = "Add "+label` ("Add Add" for a single standard size).
- `slot = 'item-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-')`.
- The demo's only unavailable item is **Pepperoni** (Pizza; `['Pepperoni',0,S3(449,569,689),0,1]`).

### 4.3 Grid behaviour and card heights
Columns from `repeat(auto-fill,minmax(min(200px,100%),1fr))` with gap 8 inside the list padding (measured `grid-template-columns`):

| Viewport | list inner width | columns | card width |
|---|---|---|---|
| d1280 | 448 | 2 | 220 |
| c1280 | 564 | 2 | 278 |
| t1024 | 568 | 2 | 280 |
| t820 | 704 | 3 | 229.33 |
| p390 | 366 | 1 | 366 |

Card height (no photo; every card has the tag line): `1 + 12 + 37 (name 19 + 2 + tag 16) + 10 + (priceH + 4) + 12 + 1` = **117** at desk (priceH 40), **123** below 1100 (priceH 46). A group of n cards in c columns is `18 + 10 + rows×cardH + (rows−1)×8` tall (measured 145 / 270 / 395 at desk, 151 / 282 at t1024 and t820, 282 / 413 / 544 / 675 on the phone), and groups are 24 apart. With the photo slot visible (`menuPhotos` "Add photos") each card would grow by `photoH + 10` = 122 (phone 106).

### 4.4 Measured cards (state `default`, first group "Starters"; state `pizza` for the Pizza group)
| Element | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| first group | `[452,130,448,270]` | `[316,130,564,270]` | `[96,180,568,282]` | `[96,180,704,282]` | `[12,174,366,544]` |
| · heading | `[452,130,448,18]` (dot `[452,135,8,8]`, count "4" `[529.05,130,8.11,18]`) | `[316,130,564,18]` | `[96,180,568,18]` | `[96,180,704,18]` | `[12,174,366,18]` |
| · grid | `[452,158,448,242]` | `[316,158,564,242]` | `[96,208,568,254]` | `[96,208,704,123]` | `[12,202,366,516]` |
| card 1 (Paneer Tikka Bites) | `[452,158,220,117]` | `[316,158,278,117]` | `[96,208,280,123]` | `[96,208,229.33,123]` | `[12,202,366,123]` |
| · name button | `[465,171,194,37]` | `[329,171,252,37]` | `[109,221,254,37]` | `[109,221,203.33,37]` | `[25,215,340,37]` |
| · mark | `[465,174,12,12]` (dot `[469,178,4,4]`) | `[329,174,12,12]` | `[109,224,12,12]` | `[109,224,12,12]` | `[25,218,12,12]` |
| · name | `[485,171,174,19]` | `[349,171,232,19]` | `[129,221,234,19]` | `[129,221,183.33,19]` | `[45,215,320,19]` |
| · tag "Popular" | `[485,192,174,16]` | `[349,192,232,16]` | `[129,242,234,16]` | `[129,242,183.33,16]` | `[45,236,320,16]` |
| · price strip | `[465,218,194,44]` | `[329,218,252,44]` | `[109,268,254,50]` | `[109,268,203.33,50]` | `[25,262,340,50]` |
| · price button "Add ₹229" | `[467,220,190,40]` (label `[552.39,226.2,19.22,12.06]`, price `[544.63,238.27,34.73,15.52]`) | `[331,220,248,40]` | `[111,270,250,46]` | `[111,270,199.33,46]` | `[27,264,336,46]` |
| card 2 (Crispy Corn) | `[680,158,220,117]` | `[602,158,278,117]` | `[384,208,280,123]` | `[333.33,208,229.33,123]` | `[12,333,366,123]` |
| card 3 (Chicken Lollipop, 2 sizes) | `[452,283,220,117]`; prices `[467,345,94,40]`, `[563,345,94,40]` | `[316,283,278,117]`; `[331,345,123,40]`, `[456,345,123,40]` | `[96,339,280,123]`; `[111,401,124,46]`, `[237,401,124,46]` | third column `[570.66,208,229.33,123]`; `[585.66,270,98.66,46]`, `[686.31,270,98.67,46]` | `[12,464,366,123]`; `[27,526,167,46]`, `[196,526,167,46]` |

Pizza group (state `pizza`, d1280): heading "Pizza" + "5"; cards Margherita `[452,158,220,117]` (in cart: border `rgb(15,98,254)`, ring `0 0 0 1px`, badge "1" `[639,171,20,20]`, tag "Popular"; 3 price buttons 62×40 at x 467/531/595: "Reg ₹249", "Med ₹349", "Lrg ₹449"), Farmhouse `[680,158,220,117]` (tag "Customisable"; "Reg ₹329", "Med ₹439", "Lrg ₹549"), Paneer Tikka Pizza `[452,283,220,117]` ("Popular"; ₹389/₹499/₹599), Chicken Tikka Pizza ("Customisable"; ₹419/₹529/₹649), Pepperoni (unavailable, 4.5). Name width with the badge: 146 (badge 20 + gap 8 taken). p390: Margherita badge `[345,215,20,20]`, price buttons 110.66×46.

Hover (state `pizza-hover-card`, pointer on Farmhouse's name): card `[680,156,220,117]` (moved up 2), shadow `rgba(0,0,0,0.08) 0px 10px 26px 0px`. Price hover (`pizza-hover-price`, "Med" of Farmhouse): button background `rgb(255,255,255)`, shadow `rgba(0,0,0,0.1) 0px 1px 2px 0px` (and the card's hover lift, since the pointer is inside the card). Pressed (`pizza-press-price`): background `rgb(237,245,255)`, `scale(.97)` (box `[759.93,218.6,60.14,38.8]`).

Adding (state `pizza-add`, a click on Farmhouse "Med"): `addLine` → toast "Farmhouse added" + Undo (13); Farmhouse gets the accent border, ring and badge "1" (`[867,171,20,20]`); the cart gets line 04 "Farmhouse" / "Medium" / "New · not sent" ₹439; Send KOT · 3; total ₹1,438.

### 4.5 Unavailable card (state `pizza-oos`, Pepperoni, pointer on its name)
d1280 card `[452,408,220,117]` (measured `[452,406,220,117]` while hovered: the hover lift and shadow still apply to an unavailable card), `opacity:0.45`, normal border; name button and the three price buttons `disabled` (cursor `not-allowed`, no press scale); non-veg mark `rgb(162,25,31)`; tag "Unavailable" `[485,440,174,16]` in `rgb(162,25,31)`; prices "Reg ₹449", "Med ₹569", "Lrg ₹689". p390 card `[12,726,366,123]`, opacity 0.45. The photo slot (if shown) would get `filter:grayscale(1)`.

### 4.6 Photo slot made visible (state `photos-edit`: every `data-photo` attribute set to "edit" by script, the way `menuPhotos = "Add photos"` would render)
Card 1 d1280 `[452,158,220,239]` with the photo box `[465,171,194,112]` (`background:var(--surface-2)` `rgb(250,250,250)`, radius 10) and the name button moved to y 293; t1024 card `[96,208,280,245]`, photo `[109,221,254,112]`; p390 card `[12,202,366,229]`, photo `[25,215,340,96]`. Group heights grow accordingly (d1280 Starters 514). The `image-slot` element draws its own placeholder (dashed border, picture icon, "Add photo", system-ui 13px, colour `var(--text-3)`; shot `photos-edit-1280x800.png`); it belongs to the design tool, not to the app.


---

## 5. Cart (current order)

### 5.1 Container
| Element | Properties |
|---|---|
| Cart scrim (`sc-if cartScrim`, t820 with the cart open) | `div`, click `closeCart`: `position:fixed; inset:0; z-index:14; background:var(--scrim); animation:fadeIn .2s ease both`. Covers the rail too (measured `[0,0,820,1180]`). |
| Cart | `section`: `display:{{ L.cartDisplay }}; position:{{ L.cartPos }}; top:0; right:0; bottom:0; left:{{ L.cartLeft }}; width:{{ L.cartW }}; box-shadow:{{ L.cartSh }}; z-index:15; flex-direction:column; min-height:0; overflow-y:auto; overflow-x:hidden; overscroll-behavior:contain; background:var(--surface); border-left:1px solid var(--border)`. At desk and t1024 it is the third (second) body column (`position:relative`); at t820 a 440-wide sheet on the right with `var(--pop)` shadow over the scrim; at p390 a full-screen sheet (left 0, right 0) above the tab bar (z 15 > 12). The whole cart scrolls; the footer is sticky. No entrance animation. |

### 5.2 Cart head
| Element | Properties |
|---|---|
| Head | `div`: `position:relative; flex:none; padding:14px 16px; display:flex; flex-direction:column; gap:12px; border-bottom:1px solid var(--border)`. |
| "‹ Menu" (`sc-if cartClosable`, t820 and p390) | `button`, click `closeCart`: `align-self:flex-start; height:30px; border:0; background:transparent; color:var(--link); font-size:15px; padding:0; cursor:pointer; display:flex; align-items:center; gap:2px`; chevron-left `svg 18×18 stroke-width 2.2 round caps/joins`, path `m15 18-6-6 6-6`, then "Menu". Measured `[397,14,58.39,30]` (t820), `[17,14,58.39,30]` (p390). |
| Title row | `div`: `display:flex; align-items:baseline; justify-content:space-between; gap:10px`. |
| · title | `span`: `font-size:20px; font-weight:600; letter-spacing:-.015em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis` (−0.3px); text `{{ ox.title }}` = `tb ? 'Table '+tb.n : o.id` ("Table 4", "Takeaway 14", "Delivery 3"). |
| · right | `span`: `flex:none; display:flex; align-items:center; gap:10px`. Meta `span`: `font-family:'Geist Mono',monospace; font-size:12px; color:var(--text-2)`, text `{{ ox.meta }}` = `'#'+o.no+' · '+mins+' min'` ("#1040 · 32 min"). Clear `button`, click `clear`: `height:26px; border:0; background:transparent; color:var(--bad-i); font-size:12.5px; padding:0 4px; border-radius:6px; cursor:pointer`; hover `background:var(--bad-t)`; text "Clear" (shown also when the order is empty). |
| Cells | `div`: `display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); border:1px solid var(--border); border-radius:10px; overflow:hidden`. |
| · cell | `button`, click `c.onClick`: `display:flex; flex-direction:column; align-items:flex-start; line-height:1.25; min-width:0; padding:8px 10px; border:0; border-right:1px solid var(--border); background:{{ c.bg }}; cursor:pointer; text-align:left; color:var(--text)`; hover `background:var(--hover)`. The last cell keeps its `border-right` too, so the grid's right edge is drawn 2 px wide (cell border + grid border; measured pixels x 1262–1263 at d1280) while the left edge and the dividers are 1 px. Key `span`: `font-size:11px; color:{{ c.kColor }}; white-space:nowrap` (line-height 13.75). Value `span`: `width:100%; font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:{{ c.vColor }}` (line-height 16.88). |

Cell values (`oxVals`, app.js 405–409): `cell(k,v,warn,onClick)` → `kColor = warn?'var(--warn-i)':'var(--text-2)'`, `vColor = warn?'var(--warn-i)':'var(--text)'`, `bg = warn?'var(--warn-t)':'transparent'`.

| Cell | Dine-in | Takeaway | Delivery |
|---|---|---|---|
| 1 key / value | `o.type` "Dine-in" / `tb ? 'T'+tb.n+' · '+tb.area : 'Choose table'` ("T4 · Indoor"); warn when no table; click: no table → table picker, else toggles the details popover | "Takeaway" / `'Token #'+String(o.no).slice(-2)` ("Token #44"); click toggles the popover | "Delivery" / customer address, or "Add address" (no customer or no address); warn when there is no address; click toggles the popover |
| 2 | "Guests" / `tb ? g+' of '+tb.seats : String(g)` ("3 of 4"; `g = o.guests\|\|2`); warn when `g > tb.seats` | "Pickup" / `PICK[o.pickup??1]` (`PICK = ['ASAP','In 15 min','In 30 min','In 45 min']`, default "In 15 min") | "Arrives in" / "35 min" (fixed) |
| 2: click | toggles the popover | toggles the popover | toggles the popover |
| 3 | "Customer" / customer name or "Add"; click closes the popover and opens the customer sheet (section 8) | same | "Customer" / name or "Required" (warn when none); click opens the customer sheet with `need 'delivery'` (address mode when the customer has no address) |

### 5.3 Order details popover (`sc-if ox.menu` = `s.ctxMenu`)
| Element | Properties |
|---|---|
| Panel | `div`: `position:absolute; left:12px; right:12px; top:100%; margin-top:-6px; z-index:6; background:var(--surface); border:1px solid var(--border); border-radius:12px; box-shadow:var(--pop); padding:14px; display:flex; flex-direction:column; gap:12px; animation:sheetIn .25s cubic-bezier(.2,.8,.2,1) both`. It hangs over the lines (anchored to the head). No scrim; it closes with "Done", a second click on a cell, Escape, or picking "Move". |
| Head row | `display:flex; justify-content:space-between; align-items:center`: "Order details" `font-size:13px; font-weight:600`; "Done" `button` (click `ox.close`): `border:0; background:transparent; color:var(--link); font-size:13.5px; font-weight:600; cursor:pointer; padding:0`. |
| Type segments | `div`: `display:grid; grid-template-columns:repeat(3,1fr); background:var(--surface-3); border-radius:8px; padding:2px; gap:2px`; buttons (`orderTypes`: Dine-in, Takeaway, Delivery): `border:0; border-radius:6px; height:34px; font-weight:500; font-size:13px; cursor:pointer; background:{{ t.bg }}; color:var(--text); box-shadow:{{ t.shadow }}` (current type = `SEG_ON`). Click `setType(x)` (section 14). |
| Dine-in rows (`sc-if ox.isDine`) | Row 1 `div`: `display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13.5px`: `<span><span style="color:var(--text-2)">Table </span><b style="font-weight:600">{{ ox.table }}</b></span>` (`ox.table = tb ? 'T'+tb.n+' · '+tb.area+' · '+tb.seats+' seats' : 'Not chosen'` → "Table T4 · Indoor · 4 seats") and a `button` (click `ox.pickTable` → table picker, popover closes): `height:32px; border:1px solid var(--border); background:var(--surface); border-radius:8px; padding:0 12px; font-size:13px; font-weight:500; color:var(--text); cursor:pointer`, text `{{ ox.tableBtn }}` = `tb ? 'Move' : 'Choose'`. Row 2 same row style: `<span><span style="color:var(--text-2)">Guests </span><b>{{ ox.guests }}</b></span>` (`tb ? g+' of '+tb.seats+' seats' : String(g)` → "Guests 3 of 4 seats") and a stepper `span`: `display:flex; align-items:center; border:1px solid var(--border); border-radius:8px; height:34px` with `button` "−" / "+" (`width:36px; height:32px; border:0; background:transparent; font-size:16px; cursor:pointer; color:var(--text)`, U+2212 minus) around `span` `min-width:24px; text-align:center; font-weight:600; font-size:13px` (`{{ ox.g }}`). `gDec` → `max(1, g−1)`, `gInc` → `min(30, g+1)`; more guests than seats is allowed and turns the Guests cell orange. |
| Takeaway row (`sc-if ox.isTake`) | `div`: `display:grid; grid-template-columns:repeat(4,1fr); gap:6px`; buttons from `ox.pickups` (labels `PICK` with "In " removed: "ASAP", "15 min", "30 min", "45 min"): `height:34px; border:1px solid {{ p.border }}; background:{{ p.bg }}; color:{{ p.color }}; border-radius:8px; font-size:12.5px; font-weight:500; cursor:pointer; white-space:nowrap`; selected: `var(--ink)` border and background, `var(--on-ink)` text; others `var(--border)` / `var(--surface)` / `var(--text)`. Click sets `o.pickup = i`. |
| Delivery | only the head row and the type segments. |

Measured popover: Dine-in `[933,167.63,335,188]` (d1280), `[913,167.63,355,188]` (c1280), `[697,167.63,315,188]` (t1024), `[393,153.63,415,188]` (t820), `[13,153.63,365,188]` (p390); Takeaway height 144; Delivery height 98. Inside (d1280, Dine-in): head row `[948,182.63,305,18]` ("Order details" `[948,183.13,81.09,17]`, "Done" `[1219.39,182.63,33.61,18]`); segments `[948,212.63,305,38]` (buttons 99×34 at x 950 / 1051 / 1152); table row `[948,262.63,305,32]` ("Table" `[948,269.63,36.28,18]`, value `[984.28,269.63,124,18]`, "Move" `[1193.83,262.63,59.17,32]`); guests row `[948,306.63,305,34]` (stepper `[1155,306.63,98,34]`: − `[1156,307.63,36,32]`, "3" `[1192,315.13,24,17]`, + `[1216,307.63,36,32]`). Takeaway pickups (d1280): 71.75×34 at x 948 / 1025.75 / 1103.5 / 1181.25, y 262.63. On the phone segments are 109 wide.

### 5.4 Lines
| Element | Properties |
|---|---|
| Lines wrapper | `div`: `flex:1 0 auto; min-height:{{ L.linesMin }}; padding:0 14px`. |
| Empty (`sc-if cartEmpty`) | `div`: `height:100%; min-height:160px; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:4px`. "No items" `font-weight:600; font-size:15px`; "Tap a price on the menu to add an item." `font-size:13px; color:var(--text-2)`. Centred in the whole wrapper height (measured d1280 wrapper `[921,174.63,359,462.38]`, "No items" `[1068.7,385.81,63.59,19]`, sub `[984.09,408.81,232.81,17]`). |
| Line | `div`, click `l.onSel` (toggle selection): `display:grid; grid-template-columns:24px minmax(0,1fr) auto; gap:3px 10px; align-items:center; padding:10px 8px; margin:0 -8px; border-radius:10px; background:{{ l.bg }}; box-shadow:{{ l.ring }}; cursor:pointer; animation:lineIn .4s cubic-bezier(.2,.8,.2,1) both` (`@keyframes lineIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}`). No separators between lines. |
| · number | `span`: `font-family:'Geist Mono',monospace; font-size:12px; color:var(--text-3)`; `{{ l.no }}` = two-digit position "01", "02" … |
| · name column | `span style="min-width:0"`: name `span` `display:block; font-weight:500; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`; meta `span` `display:block; font-size:12px; color:var(--text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis`. |
| · controls | `span`: `display:flex; align-items:center; gap:10px`. Stepper `span`: `display:flex; align-items:center; border:1px solid var(--border); border-radius:8px; background:var(--surface); height:{{ L.stepBox }}`; "−" `button title="Remove one"` (`width:{{ L.stepW }}; height:{{ L.stepH }}; border:0; background:transparent; font-size:16px; cursor:pointer; color:var(--text); border-radius:7px 0 0 7px`; hover `background:var(--surface-2)`); qty `span` `min-width:22px; text-align:center; font-weight:600; font-size:13px`; "+" `button title="Add one"` (same, `border-radius:0 7px 7px 0`). Line total `span`: `min-width:54px; text-align:right; font-weight:500; font-size:14px`. |
| · spacer | empty `span` (grid cell 1 of row 2). |
| · status | `span`: `grid-column:2 / 4; display:flex; align-items:center; gap:6px; font-size:11.5px; color:{{ l.statusColor }}`; `6×6` round dot `background:{{ l.dot }}` + `{{ l.status }}`. |

Line values (`lines`, renderVals 935–938, then `num()` app.js 404):
- Order: **sent lines first, then unsent lines** (each group in cart order); `no` = position after this reorder.
- `name`; `meta = [size==='Standard' ? null : size, ...addons, note||null].filter(Boolean).join(', ') || RS(price)+' each'` (e.g. "Medium, Extra cheese", "Regular", "Less sugar", "₹199 each", "Medium, Extra cheese, Less spicy, Jain").
- `total = RS(price × qty)`, price already includes the add-ons (Margherita Medium + Extra cheese = 349 + 60 = ₹409).
- Status: sent → "Sent to kitchen", dot `var(--ok)`, colour `var(--text-2)`; not sent → **"New · not sent"**, dot `var(--warn)`, colour `var(--warn-i)` (the first map writes "Not sent" but `num()` overwrites the text).
- Selected (`s.selLine === index`): `bg 'var(--accent-t)'`, `ring 'inset 0 0 0 1px var(--accent-b)'` (measured `rgb(237,245,255)`, `rgb(166,200,255) 0px 0px 0px 1px inset`); else transparent / none. A second click unselects. Selection has no other effect in this file.
- `+` → qty + 1 (also on a sent line: the extra quantity stays marked "Sent to kitchen", nothing goes to the kitchen); `−` → see section 14 (approval for sent lines when not a manager; a toast with Undo when it removes the last unit).

### 5.5 Footer
| Element | Properties |
|---|---|
| Footer | `div`: `position:sticky; bottom:0; z-index:2; flex:none; padding:12px 16px {{ L.cartFootB }}; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:10px; background:var(--surface); box-shadow:0 -10px 24px rgba(0,0,0,.04)`. |
| Links row | `div`: `display:flex; flex-wrap:wrap; gap:4px 16px`. Four `button`s: `border:0; background:transparent; padding:0; font-size:12.5px; font-weight:500; color:var(--link); cursor:pointer`: `{{ discLabel }}` (`o.disc ? 'Remove discount' : 'Discount'`), "Note", "Split", "Print bill". No hover rule (the global `a:hover` does not apply to buttons). |
| Bill block | `div`: `display:flex; flex-direction:column; gap:5px; font-size:13px; color:var(--text-2)`. |
| · details (`sc-if billOpen`) | `div`: `display:flex; flex-direction:column; gap:5px; animation:fadeIn .2s ease both`, rows: (1) `display:flex; justify-content:space-between`: `Subtotal · {{ itemCount }} items` / `span style="color:var(--text)"` `{{ subtotal }}`; (2) `sc-if hasDisc`: "Discount 10%" / `span style="color:var(--ok-i)"` `−{{ discount }}` (U+2212); (3) one row per `charges` item: `display:flex; justify-content:space-between; align-items:center; gap:8px`: left `span style="display:flex;align-items:center;gap:8px"` = `{{ c.label }}` + `button` "Remove" (`display:{{ c.rmDisplay }}; border:0; background:transparent; padding:0; font-size:12px; color:var(--link); cursor:pointer`), right `span style="color:var(--text)"` `{{ c.value }}`; (4) `sc-if svcOff`: "Service charge removed" / `button` "Add back" (`border:0; background:transparent; padding:0; font-size:12px; color:var(--link); cursor:pointer`); (5) "GST 5%" / `span style="color:var(--text)"` `{{ tax }}`. |
| · total row | `div`: `display:flex; justify-content:space-between; align-items:baseline; margin-top:4px; padding-top:10px; border-top:1px solid var(--border-2); color:var(--text)`. Left `button` (click `toggleBill`): `display:flex; align-items:center; gap:6px; border:0; background:transparent; padding:0; cursor:pointer; color:var(--text); font-size:15px; font-weight:600`; "Total" + `span` `font-size:12px; font-weight:500; color:var(--link)` `{{ billLabel }}` ("Details" / "Hide details", 0.4). Right `span`: `font-size:26px; font-weight:600; letter-spacing:-.02em` (−0.52px) `{{ total }}`. |
| Buttons | `div`: `display:grid; grid-template-columns:1fr 1.4fr; gap:8px` (the tracks follow their content's min width: at t1024 "Send KOT · 2" + F8 needs 131.69, so the split is not exactly 1 : 1.4). |
| · Send KOT | `button disabled="{{ noNew }}"`, click `sendKot`: `height:50px; border:1px solid var(--ink); background:var(--surface); color:var(--text); border-radius:10px; font-weight:600; font-size:14.5px; cursor:pointer; opacity:{{ kotOpacity }}; display:flex; align-items:center; justify-content:center; gap:8px; white-space:nowrap`; hover `background:var(--hover)`. Label `{{ kotLabel }}` = `newCount ? 'Send KOT · '+newCount : 'All sent'` (`newCount` = sum of unsent quantities); `kotOpacity = newCount ? 1 : .5`; disabled when `newCount===0`. Key chip `span`: `display:{{ L.slashDisplay }}; font-family:'Geist Mono',monospace; font-size:11px; border-radius:4px; padding:0 4px; line-height:16px; border:1px solid var(--border); color:var(--text-2)` "F8". |
| · Pay | `button disabled="{{ cartEmpty }}"`, click `pay`: `height:50px; border:0; background:var(--accent); color:var(--on-accent); border-radius:10px; font-weight:600; font-size:15px; cursor:pointer; opacity:{{ payOpacity }}; display:flex; align-items:center; justify-content:center; gap:8px; white-space:nowrap`; hover `background:var(--accent-h)`. Label `{{ payLabel }}` = Captain `'Request bill'`, others `'Pay '+RS(total)`; `payOpacity = cart.length ? 1 : .4`. Chip `span`: `display:{{ L.slashDisplay }}; font-family:'Geist Mono',monospace; font-size:11px; border-radius:4px; padding:0 4px; line-height:16px; border:1px solid rgba(255,255,255,.5)` "F9" (colour inherits `var(--on-accent)`). |

Bill values (`totals(o)`, app.js 401; `charges`, renderVals 894):
```
sub  = Σ price × qty
disc = o.disc ? sub × 0.1 : 0
base = sub − disc
svc  = sub && type==='Dine-in' && !o.noSvc ? base × 0.05 : 0
pack = sub && type!=='Dine-in' ? 20 : 0
del  = sub && type==='Delivery' ? 40 : 0
tax  = (base + svc + pack + del) × 0.05
tot  = Math.round(base + svc + pack + del + tax)
```
Every amount is shown with `RS()` (rounded separately), so the rows need not add up to the total (Table 4: ₹865 + ₹43 + ₹45 = ₹953, total ₹954). `charges`: Dine-in `{label:'Service charge (5%)', value:RS(svc), rmDisplay:'inline', onRemove → o.noSvc=true}`; Takeaway `{label:'Packing', value:RS(20), rmDisplay:'none'}`; Delivery Packing + `{label:'Delivery fee', value:RS(40), rmDisplay:'none'}` (Remove is in the DOM but `display:none`). `svcOff = type==='Dine-in' && o.noSvc && cart.length>0`; "Add back" → `noSvc:false`. `itemCount` = Σ qty ("Subtotal · 5 items"; "1 items" for one). The rounding difference `round` is computed but not shown.

Demo bills (measured): Table 4 ₹865 / Service charge (5%) ₹43 / GST 5% ₹45 / Total ₹954; with Discount: ₹865 / Discount 10% −₹87 / ₹39 / ₹41 / ₹858; service charge removed: ₹865 / "Service charge removed · Add back" / ₹43 / ₹908; Takeaway 14 (3 items) ₹277 / Packing ₹20 / ₹15 / ₹312; Delivery 3 (4 items) ₹798 / Packing ₹20 / Delivery fee ₹40 / ₹43 / ₹901.

### 5.6 Measured cart (state `default`; t820 and p390 = state `cart-open`)
| Element | d1280 | c1280 | t1024 | t820 (sheet) | p390 (sheet) |
|---|---|---|---|---|---|
| cart | `[920,56,360,744]` | `[900,56,380,744]` | `[684,56,340,712]` | `[380,0,440,1180]` | `[0,0,390,844]` |
| head | `[921,56,359,118.63]` | `[901,56,379,118.63]` | `[685,56,339,118.63]` | `[381,0,439,160.63]` | `[1,0,389,160.63]` |
| "‹ Menu" | – | – | – | `[397,14,58.39,30]` | `[17,14,58.39,30]` |
| title row | `[937,70,327,29]` | `[917,70,347,29]` | `[701,70,307,29]` | `[397,56,407,29]` | `[17,56,357,29]` |
| · "Table 4" | `[937,70,66.73,26]` | `[917,70,66.73,26]` | `[701,70,66.73,26]` | `[397,56,66.73,26]` | `[17,56,66.73,26]` |
| · meta | `[1114.63,78,100.81,16]` | same | `[858.63,78,100.81,16]` | `[654.63,64,100.81,16]` | `[224.63,64,100.81,16]` |
| · Clear | `[1225.44,73,38.56,26]` | same | `[969.44,73,38.56,26]` | `[765.44,59,38.56,26]` | `[335.44,59,38.56,26]` |
| cells | `[937,111,327,48.63]` | `[917,111,347,48.63]` | `[701,111,307,48.63]` | `[397,97,407,48.63]` | `[17,97,357,48.63]` |
| · cell widths | 108.33 | 115 | 101.66 | 135 | 118.33 |
| · key / value (cell 1) | `[948,120,36.7,13.75]` / `[948,133.75,87.33,16.88]` | `[928,120,36.7,13.75]` / `[928,133.75,94,16.88]` | `[712,120,36.7,13.75]` / `[712,133.75,80.66,16.88]` | `[408,106,36.7,13.75]` / `[408,119.75,114,16.88]` | `[28,106,36.7,13.75]` / `[28,119.75,97.33,16.88]` |
| lines wrapper | `[921,174.63,359,462.38]` | `[901,174.63,379,462.38]` | `[685,174.63,339,430.38]` | `[381,160.63,439,790.38]` | `[1,160.63,389,456.38]` |
| line 1 | `[927,174.63,347,72]` | `[907,174.63,367,72]` | `[691,174.63,327,74]` | `[387,160.63,427,74]` | `[7,160.63,377,74]` |
| · "01" | `[935,193.63,24,16]` | `[915,193.63,24,16]` | `[699,194.63,24,16]` | `[395,180.63,24,16]` | `[15,180.63,24,16]` |
| · name / meta | `[969,184.63,139,18]` / `[969,202.63,139,16]` | `[949,184.63,159,18]` / `[949,202.63,159,16]` | `[733,185.63,103,18]` / `[733,203.63,103,16]` | `[429,171.63,203,18]` / `[429,189.63,203,16]` | `[49,171.63,153,18]` / `[49,189.63,153,16]` |
| · stepper | `[1118,186.63,84,30]` (− `[1119,187.63,30,28]`, qty `[1149,193.13,22,17]`, + `[1171,187.63,30,28]`) | same | `[846,184.63,100,36]` (− `[847,185.63,38,34]`, qty `[885,194.13,22,17]`, + `[907,185.63,38,34]`) | `[642,170.63,100,36]` | `[212,170.63,100,36]` (− `[213,171.63,38,34]`, + `[273,171.63,38,34]`) |
| · total "₹409" | `[1212,192.63,54,18]` | same | `[956,193.63,54,18]` | `[752,179.63,54,18]` | `[322,179.63,54,18]` |
| · status | `[969,221.63,297,15]` (dot `[969,226.13,6,6]`) | `[949,221.63,317,15]` | `[733,223.63,277,15]` | `[429,209.63,377,15]` | `[49,209.63,327,15]` |
| line 2 / line 3 y | 246.63 / 318.63 | same | 248.63 / 322.63 | 234.63 / 308.63 | 234.63 / 308.63 |
| footer | `[921,637,359,163]` | `[901,637,379,163]` | `[685,605,339,163]` | `[381,951,439,229]` | `[1,617,389,227]` |
| · links | `[937,650,327,17]`: Discount `[937,650,52.06,17]`, Note `[1005.06,650,28.31,17]`, Split `[1049.38,650,27.02,17]`, Print bill `[1092.39,650,48.53,17]` | x 917 | x 701, y 618 | x 397, y 964 | x 17, y 630 |
| · bill details | closed | closed | closed | `[397,991,407,61]` (rows y 991 / 1013 / 1035, h 17) | `[17,657,357,61]` (rows 657 / 679 / 701) |
| · total row | `[937,681,327,45]` | `[917,681,347,45]` | `[701,649,307,45]` | `[397,1061,407,45]` | `[17,727,357,45]` |
| · Total button | `[937,703,80.81,19]` ("Details" `[978.48,704.5,39.33,16]`) | x 917 | x 701, y 671 | `[397,1083,107.77,19]` ("Hide details" `[438.48,1084.5,66.28,16]`) | `[17,749,107.77,19]` |
| · "₹954" | `[1199.2,692,64.8,34]` | same | `[943.2,660,64.8,34]` | `[739.2,1072,64.8,34]` | `[309.2,738,64.8,34]` |
| · buttons | `[937,736,327,50]` | `[917,736,347,50]` | `[701,704,307,50]` | `[397,1116,407,50]` | `[17,782,357,50]` |
| · Send KOT | `[937,736,132.91,50]` (F8 `[1039.09,752,23.2,18]`) | `[917,736,141.25,50]` | `[701,704,131.69,50]` | `[397,1116,166.25,50]` | `[17,782,145.41,50]` (no chip) |
| · Pay | `[1077.91,736,186.08,50]` (F9 `[1197.61,752,23.2,18]`) | `[1066.25,736,197.75,50]` | `[840.69,704,167.3,50]` | `[571.25,1116,232.75,50]` | `[170.41,782,203.58,50]` |

Line row height: 72 at desk (stepper 30), 74 below 1100 (stepper 36). Opened details (desk, state `bill-toggled`): footer `[921,571,359,229]`, details `[937,611,327,61]` (Subtotal y 611, Service charge 633 with "Remove" `[1062.06,633.5,44.34,16]`, GST 655), total row unchanged at y 681; with the discount row the footer is `[921,549,359,251]`.

### 5.7 Cart states (d1280 unless stated)
- **Empty** (state `empty-new`, header New → "Takeaway 16", #1045 · 1 min): cells "Takeaway / Token #45", "Pickup / In 15 min", "Customer / Add"; the "No items" block; total "₹0" `[1230.61,692,33.39,34]`; Send KOT "All sent" disabled, opacity 0.5; Pay "Pay ₹0" disabled, opacity 0.4; switcher "TA", grey dot `rgb(107,107,116)`, "Takeaway 16", "Takeaway · No items yet", "9 open". At t1024 the KOT button is 124.58 wide and Pay 174.41 (content-sized tracks, 5.5). At t820 / p390 the new empty order shows no order bar, so its cart cannot be opened (state `empty-new` there is the menu only).
- **Cleared** (state `cleared`, Clear on Table 4 as Manager): toast "Order cleared" + Undo; the empty block; the cells keep "T4 · Indoor", "3 of 4", "Neha Joshi"; bill rows "Subtotal · 0 items ₹0" and "GST 5% ₹0" (no service-charge row while the subtotal is 0); "All sent" and "Pay ₹0" disabled. The cart sheet stays open at t820 / p390 (shot `cleared-390x844.png`; the phone toast at bottom 140 sits over the bill rows).
- **Selected line** (state `line-selected`, click on line 02): `rgb(237,245,255)` background + inset `rgb(166,200,255)` 1 px ring, radius 10, the line keeps its box `[927,246.63,347,72]`.
- **Stepper** (state `line-step`: + on Cold Coffee, − on French Fries): "3" ₹387, "1" ₹99, Send KOT · 3, total ₹987, no toast.
- **Remove last unit** (state `line-remove`, − on Margherita qty 1): line removed and renumbered (French Fries becomes 01), toast "Margherita removed" + Undo, total ₹503.
- **Over seats** (state `ox-guests-over`): Guests cell `rgb(255,242,232)` background, key and value `rgb(186,78,0)`, "5 of 4"; popover "Guests 5 of 4 seats".
- **Delivery without customer** (state `delivery-nocust`, "Delivery 5" with one item): cell 1 "Delivery / Add address" warn, cell 2 "Arrives in / 35 min", cell 3 "Customer / Required" warn; switcher sub "Delivery · 1 items · ₹303".
- **Dine-in without a table** ("Choose table" warn cell, "Not chosen" / "Choose" in the popover) cannot be reached in the demo: switching a non-table order to Dine-in opens the table picker instead and keeps the type until a table is picked; "+ Table" goes to the Floor page.
- **Hover**: Send KOT `rgb(242,242,244)`; Pay `rgb(0,67,206)`; cells `var(--hover)`; Clear `var(--bad-t)`; stepper buttons `var(--surface-2)`.

---

## 6. Phone and 820 tablet: order bar and cart sheet (`cmp`, w < 1024)

### 6.1 Order bar (`sc-if showBar`)
`showBar = cmp && route==='order' && !cartOpen && o.cart.length>0` → t820 and p390 only, only while the current order has lines and the cart sheet is closed (an empty order shows no bar).

| Element | Properties |
|---|---|
| Bar | `div`: `position:fixed; left:{{ L.obLeft }}; right:0; bottom:{{ L.obBottom }}; z-index:10; background:var(--glass); backdrop-filter:saturate(180%) blur(20px); -webkit-backdrop-filter:saturate(180%) blur(20px); border-top:1px solid var(--border); padding:10px 14px; display:flex; align-items:center; gap:12px`. |
| Text | `div style="flex:1"`: line 1 `div` `font-size:12px; color:var(--text-2)`: `{{ itemCount }} items · {{ cur.id }}` ("5 items · Table 4"); line 2 `div` `font-size:18px; font-weight:600; letter-spacing:-.015em` (−0.27px): `{{ total }}` ("₹954"). |
| Review order | `button`, click `openCart` (`cartOpen:true`): `border:0; background:var(--accent); color:var(--on-accent); border-radius:10px; height:44px; padding:0 20px; font-weight:600; font-size:15px; cursor:pointer`; text "Review order". No hover rule. |

Measured (state `default`):
| Element | t820 | p390 |
|---|---|---|
| bar | `[76,1115,744,65]` (left = rail width, bottom 0) | `[0,719,390,65]` (bottom 60: the bar ends at y 784 and the 59 px tab bar starts at 785, so 1 px of the menu shows between them) |
| text block | `[90,1128.5,569.94,39]` | `[14,732.5,215.94,39]` |
| · "5 items · Table 4" | `[90,1128.5,569.94,16]` | `[14,732.5,215.94,16]` |
| · "₹954" | `[90,1144.5,569.94,23]` | `[14,748.5,215.94,23]` |
| Review order | `[671.94,1126,134.06,44]` | `[241.94,730,134.06,44]` |

Tab bar on the phone: U0 §2.6 (`[0,785,390,59]`, Order tab in `var(--accent)`). The bar never overlaps it: `obBottom` = `calc(60px + env(safe-area-inset-bottom))`.

### 6.2 Page bottom padding
`main` `padding-bottom:{{ L.mainPadB }}`: 150px on the phone (room for the order bar 65 + tab bar 59 + 26), 100px at t820 (bar 65 + 35), 16px otherwise. Measured `main` boxes: p390 `[0,56,390,788]` (it runs under the bar and the tab bar to the window bottom; scrollHeight 10639), t820 `[76,56,744,1124]` (scrollHeight 5226).

### 6.3 Cart sheet (`cartOpen`)
Opened by "Review order"; closed by "‹ Menu", the scrim (t820), Escape, every `nav()` route change, sign-in, payment completion (`finish` sets `cartOpen:false`) and hash navigation. The cart `section` (5.1) becomes `display:flex; position:fixed; top:0; right:0; bottom:0`:
- **t820**: `left:auto; width:min(440px,100%)` → `[380,0,440,1180]`, `box-shadow:var(--pop)`, scrim `var(--scrim)` z 14 over the whole window (rail included), cart z 15. The header stays under the scrim.
- **p390**: `left:0; width:auto` → full screen `[0,0,390,844]`, no shadow, no scrim; it covers the page header and the tab bar (z 15 > 12). Its left border (1 px `var(--border)`) is still drawn at x 0, so content starts at x 1 (head `[1,0,389,160.63]`).
- Both: "‹ Menu" on top of the head (head 160.63 tall instead of 118.63), footer bottom padding `cartFootB` (p390 `calc(12px + env(safe-area-inset-bottom))`, t820 14px), the bill details open by default (window height ≥ 820, 0.4). Lines wrapper `min-height:{{ L.linesMin }}` (180 on the phone; the wrapper fills the free height anyway: p390 `[1,160.63,389,456.38]`, t820 `[381,160.63,439,790.38]`). Footer p390 `[1,617,389,227]`, t820 `[381,951,439,229]`; buttons p390 Send KOT `[17,782,145.41,50]`, Pay `[170.41,782,203.58,50]` (no F8 / F9 chips on the phone), t820 `[397,1116,166.25,50]` / `[571.25,1116,232.75,50]` with chips.
- No open / close animation on the sheet itself (only the scrim fades in).

Overlays opened from the sheet (payment, customer, table picker, approval, confirm) sit above it (z 44–50); the order-details popover opens inside it.

---

## 7. Open orders (switcher sheet, `sc-if op.open` = `s.opOpen`)

Opened by the header's Switch order button (`op.toggle`: `opOpen = !opOpen`, `opQ = ''`; after 60 ms the search input is focused **only when `desk`** — measured focused at d1280 / c1280, not at t1024 / t820 / p390). Closed by the scrim, Escape, picking a row, or a "+ New …" button.

### 7.1 Elements (verbatim)
| Element | Properties |
|---|---|
| Scrim | `div`, click `op.close`: `animation:fadeIn .2s ease both; position:fixed; inset:0; z-index:44; background:{{ L.opScrim }}; display:flex; align-items:{{ L.opAlign }}; justify-content:{{ L.opJustify }}; padding:{{ L.opPad }}`. Desk and tablets: a 6 % black veil, the panel at the top right under the header (padding 62 / 16 / 16). Phone: `var(--scrim)`, the panel at the bottom. |
| Panel | `div`, click stops: `animation:sheetIn .3s cubic-bezier(.2,.8,.2,1) both; width:100%; max-width:{{ L.opW }}; max-height:{{ L.opMaxH }}; display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--border); border-radius:{{ L.opRadius }}; box-shadow:var(--pop); overflow:hidden`. Height follows the content up to the max. |
| Head | `div`: `flex:none; padding:14px 14px 10px; display:flex; flex-direction:column; gap:10px; border-bottom:1px solid var(--border-2)`. |
| · title row | `div`: `display:flex; align-items:baseline; justify-content:space-between`: "Open orders" `font-size:16px; font-weight:600`; `{{ op.summary }}` `font-size:12.5px; color:var(--text-2)`. |
| · search | `div`: `display:flex; align-items:center; gap:8px; height:40px; border:1px solid var(--border); border-radius:10px; padding:0 12px; background:var(--surface-2)`; magnifier `svg 15×15 stroke-width 2 linecap round; flex:none; color:var(--text-3)`; `input ref={{ opRef }} value="{{ op.q }}" placeholder="Table, customer, phone or order #"`: `flex:1; min-width:0; border:0; outline:0; background:transparent; font-size:15px; color:var(--text)` (no `font-family:inherit` in the style, but the global `button,input{font-family:inherit}` applies: measured Geist). |
| · type tabs | `div`: `display:grid; grid-template-columns:repeat(4,1fr); background:var(--surface-3); border-radius:8px; padding:2px; gap:2px`; `button` per `op.types`: `border:0; border-radius:6px; height:30px; font-size:12.5px; font-weight:500; cursor:pointer; background:{{ t.bg }}; box-shadow:{{ t.shadow }}; color:var(--text); white-space:nowrap`; content `{{ t.label }} <span style="color:var(--text-3)">{{ t.count }}</span>` (label, a space, the count in grey: "All 8", "Dine-in 6", "Takeaway 1", "Delivery 1"). Selected = `SEG_ON`. |
| List | `div`: `flex:1; min-height:0; overflow:auto; padding:6px`. |
| · row | `button`, click `r.onClick`: `width:100%; display:flex; align-items:center; gap:12px; border:0; border-radius:10px; background:{{ r.bg }}; padding:9px 10px; cursor:pointer; text-align:left; color:var(--text); animation:rise .35s cubic-bezier(.2,.8,.2,1) both; animation-delay:{{ r.d }}`; `style-hover="background:{{ r.hover }}"` → empty rule, **no hover look** (0.5; measured class `scpn`, hovered row stays transparent). |
| · · code tile | `span`: `position:relative; width:36px; height:36px; flex:none; border-radius:10px; background:{{ r.codeBg }}; color:{{ r.codeColor }}; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700`; `{{ r.code }}`; dot `span`: `position:absolute; right:-3px; top:-3px; width:10px; height:10px; border-radius:50%; background:{{ r.dot }}; box-shadow:0 0 0 2px var(--surface)`. |
| · · text | `span style="flex:1;min-width:0"`: id `span` `display:block; font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis` (`{{ r.id }}`); sub `span` `display:block; font-size:12px; color:var(--text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis` (`{{ r.sub }}`). |
| · · right | `span`: `flex:none; display:flex; flex-direction:column; align-items:flex-end`: total `span` `font-size:14px; font-weight:600`; status `span` `font-size:11.5px; color:{{ r.stColor }}; font-weight:500`. |
| · empty (`sc-if op.empty`) | `div`: `padding:36px 12px; text-align:center; color:var(--text-2); font-size:13.5px`; `No open orders match “{{ op.q }}”`. |
| Footer | `div`: `flex:none; display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; padding:10px 12px calc(12px + env(safe-area-inset-bottom)); border-top:1px solid var(--border-2)`; `button` per `op.news`: `height:40px; border:1px solid var(--border); background:var(--surface); border-radius:10px; font-size:13px; font-weight:600; color:var(--text); cursor:pointer; white-space:nowrap`; hover `border-color:var(--accent); color:var(--accent-i)` (measured hovered: border `rgb(15,98,254)`, text `rgb(0,67,206)`); text `+ {{ n.label }}`: "+ Takeaway", "+ Delivery", "+ Table". |

### 7.2 Values (renderVals 837–849)
- `openAll` = orders with lines, plus the active order (even empty). `summary = openAll.length+' open · '+RS(Σ totals)` → "8 open · ₹5,740". The summary and the tab counts ignore the search.
- `types`: `['All','Dine-in','Takeaway','Delivery']`, `count` = openAll of that type (All 8, Dine-in 6, Takeaway 1, Delivery 1); selected by `s.opType` (default "All"; it persists between openings).
- Rows: `openAll` filtered by `opType` and the query `oq = opQ.trim().toLowerCase()` (match `(x.id+' '+x.no+' '+customerName).toLowerCase().includes(oq)`, or with ≥ 3 digits the customer's phone contains them), sorted current first, then newest `opened` first. Per row: `code = codeOf(x)`; `id = x.id + (current ? ' · current' : '')`; `sub = [customerName, n ? n+' items' : 'No items', mins+' min'].filter(Boolean).join(' · ')` (n = Σ qty); `total = n ? RS(total) : '—'`; `stOf(x)`: no lines `['Empty','var(--text-3)','var(--text-3)']`, billed `['Bill printed','var(--bill)','var(--bill-i)']`, any unsent `['KOT pending','var(--warn)','var(--warn-i)']`, else `['In kitchen','var(--ok)','var(--ok-i)']` → `status`, `dot`, `stColor`; `d = Math.min(k×.025,.3).toFixed(3)+'s'`; current: `bg 'var(--accent-t)'`, `codeBg 'var(--accent)'`, `codeColor 'var(--on-accent)'`; others transparent / `var(--surface-3)` / `var(--text)`. Click → `{active:i, opOpen:false, route:'order'}` (the cart sheet state is untouched).
- Demo rows (in order): T4 "Table 4 · current" / "Neha Joshi · 5 items · 32 min" / ₹954 / KOT pending; TA "Takeaway 14" / "Simran Kaur · 3 items · 6 min" / ₹312 / In kitchen; DL "Delivery 3" / "Karthik Iyer · 4 items · 9 min" / ₹901 / KOT pending; T7 "Table 7" / "2 items · 14 min" / ₹439 / In kitchen; T13 "Table 13" / "4 items · 22 min" / ₹536 / KOT pending; T6 "Table 6" / "3 items · 41 min" / ₹768 / In kitchen; T17 "Table 17" / "4 items · 55 min" / ₹767 / In kitchen; T1 "Table 1" / "6 items · 68 min" / ₹1,063 / Bill printed. (Status colours: In kitchen `rgb(25,128,56)` here, KOT pending `rgb(186,78,0)`, Bill printed `var(--bill-i)`.)
- `news`: "+ Takeaway" → `seq++`, new order `{id:'Takeaway '+(seq−1029), by:user, no:seq, type:'Takeaway', opened:now, disc:false, cart:[]}` made active, route `order`, sheet closed ("Takeaway 16" #1045 in the demo); "+ Delivery" → same with `'Delivery '+(seq−1040)` ("Delivery 5") and after 200 ms the customer sheet with `need 'delivery'` (section 8); "+ Table" → `{opOpen:false, route:'floor'}` (Floor page).

### 7.3 Measured
| Element | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| scrim | `[0,0,1280,800]` rgba(0,0,0,0.06) | same | `[0,0,1024,768]` | `[0,0,820,1180]` | `[0,0,390,844]` rgba(17,17,19,0.42) |
| panel | `[844,62,420,640]` | `[844,62,420,640]` | `[588,62,420,640]` | `[384,62,420,640]` | `[0,195,390,649]` |
| head | `[845,63,418,140]` | same | `[589,63,418,140]` | `[385,63,418,140]` | `[1,196,388,140]` |
| · title row | `[859,77,390,21]` ("Open orders" `[859,77,93.89,21]`, summary `[1160.09,80,88.91,17]`) | same | x 603 | x 399 | `[15,210,360,21]` |
| · search | `[859,108,390,40]` (input `[895,117.5,341,21]`, focused) | same, focused | `[603,108,390,40]` | `[399,108,390,40]` | `[15,241,360,40]` (input `[51,250.5,311,21]`) |
| · tabs | `[859,158,390,34]`, buttons 95×30 at x 861 / 958 / 1055 / 1152 | same | x 603 | x 399 | `[15,291,360,34]`, buttons 87.5×30 |
| list | `[845,203,418,435]` (scrollHeight 444: scrolls) | same | `[589,203,418,435]` | `[385,203,418,435]` | `[1,336,388,444]` (no scroll) |
| · row 1 | `[851,209,406,54]` (tile `[861,218,36,36]`, dot `[890,215,10,10]`, id `[909,219,257.94,18]`, sub `[909,237,257.94,16]`, total `[1210.98,219.5,36.02,18]`, status `[1178.94,237.5,68.06,15]`) | same | x 595 | x 391 | `[7,342,376,54]` |
| · rows 2–8 y | 263, 317, 371, 425, 479, 533, 587 (54 apart) | same | same | same | 396 … 720 |
| footer | `[845,638,418,63]`, buttons 126×40 at x 857 / 991 / 1125, y 649 | same | `[589,638,418,63]` | `[385,638,418,63]` | `[1,780,388,63]`, buttons 116×40 at x 13 / 137 / 261, y 791 |

The panel is 640 tall at d1280 / c1280 / t1024 / t820 (`min(640px, calc(100dvh − 80px))` = 640 at all four heights) and its list scrolls by 9 px; on the phone the content (649) is below 86dvh (725.84), so the sheet is content-sized and sits at y 195.
Search "neha" (state `op-search`): one row (Table 4 · current), panel `[844,62,420,271]`; "zzz" (`op-none`): panel `[844,62,420,307]`, empty text `[851,209,406,90]` "No open orders match “zzz”"; Takeaway tab (`op-take`): one row "Takeaway 14", tab "Takeaway 1" selected.
Switch button hover (`sw-hover`): border `rgb(107,107,116)`, shadow `rgba(0,0,0,0.06) 0px 4px 14px 0px`.

---

## 8. Customer sheet (`sc-if cs.open` = `s.custSheet`)

Opened by: the Customer cell (5.2; `openCust(del ? 'delivery' : undefined)`), "+ Delivery" and switching to Delivery without a customer (after 200 ms, `openCust('delivery')`), the payment's customer pill (`cu.open` → `openCust()`), Pay on a Delivery order without a customer (`openCust('pay')`), "Choose customer for due" (`openCust('pay')`). `openCust(need)`: if `need==='delivery'` and the order's customer has no address → `custSheet = {q:'', mode:'addr', …}`; otherwise it closes the payment and open-orders sheets and opens `{q:'', mode:'search', name:'', phone:'', addr:'', tried:false, need:need||null}` and focuses the search input after 80 ms. Closed by the scrim, the ✕ button, "Continue without customer", Escape, or a successful pick/save.

### 8.1 Frame (all modes)
| Element | Properties |
|---|---|
| Scrim | `div`, click `cs.close`: `animation:fadeIn .2s ease both; position:fixed; inset:0; z-index:46; background:var(--scrim); display:flex; align-items:{{ L.sheetAlign }}; justify-content:center; padding:{{ L.sheetPad }}`. |
| Panel | `div`, click stops: `animation:sheetIn .32s cubic-bezier(.2,.8,.2,1) both; width:100%; max-width:460px; height:{{ L.csH }}; max-height:{{ L.csMaxH }}; display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--border); border-radius:{{ L.sheetRadius }}; box-shadow:var(--pop); overflow:hidden`. Fixed height 600 (desk / tablets), 88dvh on the phone. |
| Head | `div`: `flex:none; display:flex; align-items:center; gap:10px; padding:16px 16px 12px`. Back `button` only in new mode (`sc-if cs.isNew`, click `cs.back` → search mode, `tried:false`): `width:32px; height:32px; flex:none; border:0; border-radius:8px; background:var(--surface-3); color:var(--text); cursor:pointer; display:flex; align-items:center; justify-content:center`, chevron-left `svg 16×16 stroke-width 2.2`, path `m15 18-6-6 6-6`. Text `div style="flex:1;min-width:0"`: title `div` `font-size:17px; font-weight:600` (`{{ cs.title }}`), sub `div` `font-size:12.5px; color:var(--text-2)` (`{{ cs.sub }}`). Close `button` (click `cs.close`): `width:32px; height:32px; flex:none; border:0; border-radius:50%; background:var(--surface-3); color:var(--text-2); cursor:pointer; display:flex; align-items:center; justify-content:center`, ✕ `svg 13×13 stroke-width 2.4 linecap round`, path `M6 6l12 12M18 6 6 18`. |
| Need banner (`sc-if cs.hasNeed` = `!!(c.need && o.type==='Delivery')`) | `div`: `margin:0 16px 10px; padding:9px 12px; border-radius:10px; background:var(--warn-t); color:var(--warn-i); font-size:13px; font-weight:500`; text `need==='pay' ? 'Delivery orders need a customer before payment.' : 'Add who this delivery is for.'`. Shown in search and new modes. |

Titles: search "Customer" / `o.id+' · '+o.type` ("Table 4 · Dine-in", "Delivery 5 · Delivery"); new "New customer" / "Phone number keeps every customer unique"; address "Delivery address" / `o.id+' · '+o.type`.

### 8.2 Search mode (`sc-if cs.isSearch`)
| Element | Properties |
|---|---|
| Search wrap | `div`: `flex:none; padding:0 16px 10px`. Box `div`: `display:flex; align-items:center; gap:10px; height:48px; border:1.5px solid var(--accent); border-radius:12px; padding:0 12px; box-shadow:0 0 0 4px var(--accent-t)` (always drawn "focused"; measured border 1px at DPR 1, ring `rgb(237,245,255) 0 0 0 4px`). Magnifier `svg 17×17 stroke-width 2 linecap round; flex:none; color:var(--text-2)`. `input ref={{ csRef }} value="{{ cs.q }}" placeholder="Phone number or name"`: `flex:1; min-width:0; border:0; outline:0; background:transparent; font-size:15px; color:var(--text)`. Mode `span`: `font-size:11.5px; color:var(--text-3); white-space:nowrap` (`{{ cs.mode }}`: "Phone" when the query is only digits, spaces, `+` or `-`; "Name" for other text; empty when there is no query). |
| List label | `div`: `flex:none; padding:4px 18px 6px; font-size:11.5px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--text-3)`; `{{ cs.listLabel }}`: no query "Frequent customers"; else `n+' match'` / `n+' matches'` / "No matches" (rendered uppercase). |
| List | `div`: `flex:1; min-height:0; overflow:auto; padding:0 8px`. |
| · row | `button`, click `r.onClick` (= `attach(id)`): `width:100%; display:flex; align-items:center; gap:12px; border:0; border-radius:10px; background:{{ r.bg }}; padding:9px 10px; cursor:pointer; text-align:left; color:var(--text); animation:rise .3s cubic-bezier(.2,.8,.2,1) both; animation-delay:{{ r.d }}`; hover `background:var(--hover)` (static, works: measured `rgb(242,242,244)`). Row height 56. |
| · · avatar | `span`: `width:38px; height:38px; flex:none; border-radius:50%; background:{{ r.avBg }}; color:{{ r.avColor }}; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:600`; `{{ r.ini }}` (`ini2(name)`). Colours `avBg(hue)` / `avFg(hue)` (U0 §1.6), customer hue `HUES[(i+3)%8]` (8.5). |
| · · text | `span style="flex:1;min-width:0"`: name line `span` `display:flex; align-items:center; gap:6px; font-size:14px; font-weight:600; white-space:nowrap` → name `span` `overflow:hidden; text-overflow:ellipsis` + tag `span` `display:{{ r.tagDisplay }}; font-size:10.5px; font-weight:600; padding:1px 6px; border-radius:5px; background:var(--ok-t); color:var(--ok-i)`; phone `span` `display:block; font-size:12.5px; color:var(--text-2); font-family:'Geist Mono',monospace` (`fmtPh`: "+91 98201 23456"). |
| · · right | `span`: `flex:none; text-align:right; font-size:12px; color:var(--text-2); line-height:1.4`; `{{ r.visits }}<br>{{ r.last }}` ("12 visits" / "Last 2 Oct"; a new customer "New" and an empty second line). |
| · empty (`sc-if cs.empty`) | `div`: `padding:24px 12px; text-align:center; font-size:13.5px; color:var(--text-2); line-height:1.5`; `No customer found for “{{ cs.q }}”.` + `<br>` + `Add them as new, it takes 5 seconds.` |
| Footer | `div`: `flex:none; display:flex; flex-direction:column; gap:8px; padding:12px 16px calc(14px + env(safe-area-inset-bottom)); border-top:1px solid var(--border-2)`. New `button` (click `cs.toNew`): `height:46px; border:0; border-radius:12px; background:var(--accent); color:var(--on-accent); font-size:14.5px; font-weight:600; cursor:pointer`; hover `var(--accent-h)`; `{{ cs.newLabel }}` = no query "+ New customer"; with a query `'+ New customer “'+(isPhone ? fmtPh(digits) : q)+'”'` ("+ New customer “+91 98201 23456”", "+ New customer “+91 9820”", "+ New customer “zzz”"). Skip `button` (`sc-if cs.canSkip` = not Delivery; click `cs.close`): `height:36px; border:0; background:transparent; color:var(--link); font-size:13.5px; font-weight:500; cursor:pointer`, "Continue without customer". |

Row values: results = no query → the 6 customers with most visits (Sneha Patil 22, Simran Kaur 15, Neha Joshi 12, Karthik Iyer 9, Aisha Khan 7, Arjun Rao 6); phone query → customers whose phone contains the normalised digits (`normPh`: strips non-digits, a leading `91` or `0` beyond 10 digits, max 10); name query → a word of the name starts with it or the name contains it; sorted exact phone first, then visits; max 8. `tag` = "Exact" (phone query equal to the number) or "Current" (the order's customer), `tagDisplay` `inline-block` / `none`; `bg` = current customer `var(--accent-t)`, else transparent; `d = (k×.03).toFixed(2)+'s'`; `visits` = `n+' visits'` or "New"; `last` = `'Last '+c.last` or '' for new. `toNew` → new mode with `phone` = the digits (phone query) and `name` = the query title-cased (name query).

### 8.3 New mode (`sc-if cs.isNew`)
| Element | Properties |
|---|---|
| Body | `div`: `flex:1; min-height:0; overflow:auto; padding:4px 16px 8px; display:flex; flex-direction:column; gap:14px`. |
| Phone field | `label`: `display:flex; flex-direction:column; gap:6px`; caption `span` `font-size:12.5px; font-weight:600; color:var(--text-2)` "Mobile number"; box `span`: `display:flex; align-items:center; gap:8px; height:48px; border:1.5px solid {{ cs.phBorder }}; border-radius:12px; padding:0 12px; background:var(--surface)`: "+91" `span` `font-size:15px; color:var(--text-2); font-family:'Geist Mono',monospace`; divider `span` `width:1px; height:20px; background:var(--border)`; `input type="tel" placeholder="98200 12345"`: `flex:1; min-width:0; border:0; outline:0; background:transparent; font-size:16px; color:var(--text); font-family:'Geist Mono',monospace; letter-spacing:.04em` (0.64px); counter `span` `font-size:12px; color:var(--text-3)` `{{ cs.phCount }}` (`len+'/10'`). Error `span` `display:{{ cs.phErrDisplay }}; font-size:12.5px; color:var(--bad-i)` "Enter a valid 10-digit mobile number". |
| Duplicate (`sc-if cs.hasDup`) | `div`: `display:flex; align-items:center; gap:12px; padding:12px; border-radius:12px; background:var(--warn-t); animation:rise .3s cubic-bezier(.2,.8,.2,1) both`: avatar `span` `width:36px; height:36px; flex:none; border-radius:50%; background:var(--surface); color:var(--warn-i); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:600` (initials); text: `Already saved as {{ cs.dup.name }}` (`display:block; font-size:13.5px; font-weight:600; color:var(--text)`) and `{{ cs.dup.meta }}` (`display:block; font-size:12px; color:var(--text-2)`; `fmtPh+' · '+visits+' visits · last '+last` → "+91 98201 23456 · 12 visits · last 2 Oct"); "Use" `button` (click `attach(dup.id)`): `flex:none; height:34px; padding:0 12px; border:0; border-radius:8px; background:var(--ink); color:var(--on-ink); font-size:13px; font-weight:600; cursor:pointer`. |
| Name field | `label` as above, caption "Name"; box `span`: `display:flex; align-items:center; height:48px; border:1.5px solid {{ cs.nmBorder }}; border-radius:12px; padding:0 12px; background:var(--surface)`; `input placeholder="Customer name"`: `flex:1; min-width:0; border:0; outline:0; background:transparent; font-size:16px; color:var(--text)`. Message `span` `display:{{ cs.nmErrDisplay }}; font-size:12.5px; color:{{ cs.nmErrColor }}`. |
| Address field (`sc-if cs.needAddr` = Delivery) | `label`, caption "Delivery address"; box `span`: `display:flex; align-items:center; min-height:48px; border:1.5px solid {{ cs.adBorder }}; border-radius:12px; padding:0 12px; background:var(--surface)`; `input placeholder="Flat, building, area"` (`font-size:15px`, same other styles); error `span` `display:{{ cs.adErrDisplay }}; font-size:12.5px; color:var(--bad-i)` "Add flat, building and area". |
| Footer | `div`: `flex:none; padding:12px 16px calc(14px + env(safe-area-inset-bottom)); border-top:1px solid var(--border-2)`; `button` (click `cs.save`): `width:100%; height:48px; border:0; border-radius:12px; background:var(--accent); color:var(--on-accent); font-size:15px; font-weight:600; cursor:pointer; opacity:{{ cs.saveOp }}`; hover `var(--accent-h)`; `Save &amp; add to {{ cur.id }}` ("Save & add to Table 4"). |

New-mode values: `ph = normPh(phone)`; `dup` = a saved customer with exactly that 10-digit phone; `phBad = !dup && (tried || ph.length===10) && !/^[6-9]\d{9}$/.test(ph)`; `phBorder = phBad ? 'var(--bad)' : (dup ? 'var(--warn)' : 'var(--border)')`; `nmBad = tried && name.trim().length<2`; `sameName` = another customer with the same name (≥ 3 chars, case-insensitive) and a different phone; `nmErr = nmBad ? 'Enter the customer’s name' : (sameName ? 'Another '+sameName.name+' exists ('+fmtPh(sameName.phone)+'). Different number, saved separately.' : '')`, `nmErrColor = nmBad ? 'var(--bad-i)' : 'var(--text-2)'`; `adBad = tried && Delivery && addr.trim().length<6`; `saveOp = dup ? .5 : 1` (the button stays clickable: with a duplicate it attaches the existing customer). Save (`saveCust`): duplicate → `attach`; invalid → `tried:true`; else adds `{id:'c'+Date.now(), name: title-cased, phone, visits:0, spent:0, last:'New', addr, hue:HUES[count%8]}`, attaches it, toast "New customer saved · {name as typed}", and if `need==='pay'` reopens payment after 250 ms.

### 8.4 Address mode (`sc-if cs.isAddr`)
Body `div`: `flex:1; min-height:0; overflow:auto; padding:4px 16px 8px; display:flex; flex-direction:column; gap:6px`: caption `span` `font-size:12.5px; font-weight:600; color:var(--text-2)` `Delivery address for {{ cu.name }}`; box `span`: `display:flex; align-items:center; min-height:48px; border:1.5px solid var(--accent); border-radius:12px; padding:0 12px; box-shadow:0 0 0 4px var(--accent-t)` with `input placeholder="Flat, building, area"` (15px; not auto-focused); hint `span` `font-size:12.5px; color:var(--text-2)` "Saved to the customer for next time.". Footer as 8.3 with `button` (click `cs.saveAddr`): `width:100%; height:48px; border:0; border-radius:12px; background:var(--accent); color:var(--on-accent); font-size:15px; font-weight:600; cursor:pointer` (no hover rule), "Save address". `saveAddr`: address < 6 chars → toast "Add flat, building and area"; else saves it on the customer, closes, toast "Address saved".

### 8.5 Demo customers (`CUST0`, hue = `HUES[(i+3)%8]`)
c1 Neha Joshi 9820123456, 12 visits, last 2 Oct, "Flat 402, Sea Breeze, Bandra West", #D12771 · c2 Rahul Mehta 9867004512, 3, 28 Sep, "B-12, Lokhandwala, Andheri West", #1192E8 · c3 Aisha Khan 9930287711, 7, 11 Oct, no address, #B28600 · c4 Vikram Shah 9819456230, 1, 5 Oct, #198038 · c5 Sneha Patil 9004512378, 22, Yesterday, "7, Hill Road, Bandra West", #BA4E00 · c6 Rohit Nair 9769123400, 5, 30 Sep, #1F5C3A · c7 Neha Kulkarni 9833221100, 2, 21 Sep, #007D79 · c8 Karthik Iyer 9820998877, 9, 9 Oct, "C-5, Juhu Tara Road, Juhu", #8A3FFC · c9 Pooja Desai 9821345670, 4, 1 Oct, #D12771 · c10 Arjun Rao 9892011223, 6, 7 Oct, #1192E8 · c11 Simran Kaur 9004433221, 15, 12 Oct, "12, Pali Hill, Bandra West", #B28600 · c12 Farah Sheikh 9819001122, 1, 3 Oct, #198038. (The avatar colours are `color-mix()` results: compare them as the 8-bit rgb they round to, as U0 / compare-ui do.)

### 8.6 Measured
| Element | d1280 / c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|
| panel | `[410,100,460,600]` | `[282,84,460,600]` | `[180,290,460,600]` | `[0,101.28,390,742.72]` (radius 14 14 0 0) |
| head | `[411,101,458,67]` (title `[427,117,384,22]`, sub `[427,139,384,17]`, ✕ `[821,120.5,32,32]` icon `[830.5,130,13,13]`) | `[283,85,458,67]` | `[181,291,458,67]` | `[1,102.28,388,67]` |
| search wrap / box | `[411,168,458,58]` / `[427,168,426,48]` (icon `[440,183.5,17,17]`, input `[467,181.5,363,21]`; mode label empty without a query, "Phone" `[806.73,184.5,33.27,15]` in `cs-phone`) | `[283,152,458,58]` / `[299,152,426,48]` | `[181,358,458,58]` / `[197,358,426,48]` | `[1,169.28,388,58]` / `[17,169.28,356,48]` |
| list label | `[411,226,458,25]` | `[283,210,458,25]` | `[181,416,458,25]` | `[1,227.28,388,25]` |
| list | `[411,251,458,331]` (scrollHeight 336) | `[283,235,458,331]` | `[181,441,458,331]` | `[1,252.28,388,473.72]` |
| · rows | 442×56 at y 251, 307, 363 (current, `rgb(237,245,255)`), 419, 475, 531; avatar `[429,260,38,38]`; name line `[479,261.5,279.36,18]` (row 1; the name span 75.48 wide); tag "Current" `[559.7,374.5,50.08,16]` on row 3; phone `[479,279.5,279.36,17]`; right `[770.36,262.2,80.64,33.59]` (row 1) | same offsets | same | 372×56 from y 252.28 |
| footer | `[411,582,458,117]`: "+ New customer" `[427,595,426,46]`, "Continue without customer" `[427,649,426,36]` | `[283,566,458,117]` | `[181,772,458,117]` | `[1,726,388,117]`: `[17,739,356,46]` |
| new mode body | `[411,168,458,456]`: phone label `[427,172,426,71]` (caption `[427,172,426,17]`, box `[427,195,426,48]`, "+91" `[440,209.5,27,19]`, divider `[475,209,1,20]`, input `[484,207.5,320.63,23]`, "0/10" `[812.63,211,27.38,16]`), name label `[427,257,426,71]` (box `[427,280,426,48]`, input `[440,292.5,400,23]`) | same offsets from the panel (x −128, y −16) | same offsets (x −230, y +190) | `[1,169.28,388,598.72]` |
| new mode footer | `[411,624,458,75]`, Save `[427,637,426,48]` | same offsets | same offsets | `[1,768,388,75]`, Save `[17,781,356,48]` |
| address mode | caption `[427,172,426,17]`, box `[427,195,426,48]` (input `[440,208.5,400,21]`), hint `[427,249,426,17]`, Save address `[427,637,426,48]` | same offsets | same offsets | caption `[17,173.28,356,17]`, Save address `[17,781,356,48]` |

States measured (d1280): `cs-search` (above); `cs-phone` "9820123456": mode "Phone", "1 MATCH", Neha Joshi with tag "Exact" `[559.7,262.5,40.48,16]` (Exact wins over Current), button "+ New customer “+91 98201 23456”"; `cs-phone-part` "9820": "2 MATCHES" (Neha Joshi "Current", Karthik Iyer), "+ New customer “+91 9820”"; `cs-name` "ne": mode "Name", "3 MATCHES" (Sneha Patil, Neha Joshi "Current", Neha Kulkarni); `cs-empty` "zzz": "NO MATCHES", empty text `[419,251,442,88.5]` (line-height 20.25), "+ New customer “zzz”"; `cs-new` (above, "Save & add to Table 4"); `cs-new-err` (Save with empty fields): both boxes `rgb(218,30,40)` borders, "Enter a valid 10-digit mobile number" `[427,249,426,17]` and "Enter the customer’s name" `[427,357,426,17]` in `rgb(162,25,31)`, labels 94 tall; `cs-new-dup` phone 9820123456: phone box border `rgb(255,131,43)`, "10/10", duplicate card `[427,257,426,60]` (avatar `[439,269,36,36]` "NJ" on white, "Use" `[793.23,270,47.77,34]`), Save opacity 0.5; `cs-new-same` (9876543210 + "neha joshi"): grey note "Another Neha Joshi exists (+91 98201 23456). Different number, saved separately." `[427,334,426,34]` (two lines); `delivery-new` ("+ Delivery"): sub "Delivery 5 · Delivery", need banner `[427,168,426,35]` "Add who this delivery is for.", no "Continue without customer"; `cs-delivery-new` (Save on the empty new form of a Delivery): banner + three errors incl. "Add flat, building and area" `[427,510,426,17]`, "Save & add to Delivery 5"; `cs-addr`: "Delivery address" / "Delivery 5 · Delivery", "Delivery address for Aisha Khan"; `cs-hover-row`: row 1 `rgb(242,242,244)`.

---

## 9. Table picker (`sc-if tp.open` = `s.tablePick`)

Opened by "Move" / "Choose" in the order-details popover, the Dine-in cell when the order has no table, and the Dine-in segment for an order that is not at a table (`setType('Dine-in')`). Closed by the scrim, ✕, Escape, the current table's tile, or picking a table.

### 9.1 Elements (verbatim)
| Element | Properties |
|---|---|
| Scrim | `div`, click `tp.close`: `animation:fadeIn .2s ease both; position:fixed; inset:0; z-index:46; background:var(--scrim); display:flex; align-items:{{ L.sheetAlign }}; justify-content:center; padding:{{ L.sheetPad }}`. |
| Panel | `div`, click stops: `animation:sheetIn .32s cubic-bezier(.2,.8,.2,1) both; width:100%; max-width:600px; max-height:{{ L.csMaxH }}; display:flex; flex-direction:column; background:var(--surface); border:1px solid var(--border); border-radius:{{ L.sheetRadius }}; box-shadow:var(--pop); overflow:hidden`. Content-sized up to the max height. |
| Head | `div`: `flex:none; display:flex; align-items:center; gap:10px; padding:16px 16px 10px`. Text `div style="flex:1;min-width:0"`: "Choose a table" `font-size:17px; font-weight:600`; `{{ tp.sub }}` `font-size:12.5px; color:var(--text-2)`. Close `button`: same as the customer sheet's ✕ (32×32 round, `var(--surface-3)`, 13 px cross). |
| Legend | `div`: `flex:none; display:flex; gap:14px; flex-wrap:wrap; padding:0 16px 10px; font-size:12px; color:var(--text-2)`; three `span`s `display:flex; align-items:center; gap:6px` each with an `8×8` round dot: `var(--ok)` "Free", `var(--info)` "Has an order · tap to open", `var(--res)` "Reserved". |
| Body | `div`: `flex:1; min-height:0; overflow:auto; padding:4px 16px calc(18px + env(safe-area-inset-bottom)); display:flex; flex-direction:column; gap:16px`. |
| Area | `div`: `display:flex; flex-direction:column; gap:8px`. Heading `div`: `display:flex; justify-content:space-between; font-size:12px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--text-2)` (0.48px): `{{ a.name }}` / `{{ a.free }}` ("INDOOR" / "6 FREE"). Grid `div`: `display:grid; grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); gap:8px`. |
| Tile | `button`, click `t.onClick`: `height:78px; border:1.5px solid {{ t.border }}; background:{{ t.bg }}; border-radius:12px; padding:9px 10px; text-align:left; cursor:pointer; color:var(--text); display:flex; flex-direction:column; justify-content:space-between; box-shadow:{{ t.ring }}; animation:rise .35s cubic-bezier(.2,.8,.2,1) both; animation-delay:{{ t.d }}`; hover `transform:translateY(-2px)`. Top `span`: `display:flex; justify-content:space-between; align-items:baseline; width:100%`: `{{ t.short }}` `font-size:17px; font-weight:600` ("T1"), `{{ t.seats }}` `font-size:11px; color:var(--text-2)` ("4 seats"). Bottom `span`: `display:flex; align-items:center; gap:5px; font-size:11.5px; font-weight:500; color:{{ t.labelColor }}; white-space:nowrap; overflow:hidden` with a `6×6` round dot `flex:none; background:{{ t.dot }}` and `{{ t.label }}`. Border measured 1px at DPR 1. |

### 9.2 Values (`tp`, renderVals 879–882)
- `sub = tb ? 'Move '+o.id+' to another table' : 'Seat '+o.id+' at a table · '+g+' guests'` ("Move Table 4 to another table").
- Tile style `sty = [label, bg, border, dot, labelColor]`:

| Tile state | Condition | label | bg | border | dot | label colour | ring |
|---|---|---|---|---|---|---|---|
| Current | the order's own table | "Current" | `var(--accent-t)` | `var(--accent)` | `var(--accent)` | `var(--accent-i)` | `0 0 0 3px var(--accent-t)` |
| Has an order | another order with lines at that table | `RS(total)+' open'` ("₹1,063 open") | `var(--info-t)` | `var(--info-b)` | `var(--info)` | `var(--info-i)` | none |
| Reserved | today's next booking (`resMap`, 0.1) | `'Res. '+time` ("Res. 9:45 PM") | `var(--res-t)` | `var(--res-b)` | `var(--res)` | `var(--res-i)` | none |
| Free | otherwise, seats ≥ guests | "Free" | `var(--surface)` | `var(--border)` | `var(--ok)` | `var(--ok-i)` | none |
| Small | otherwise, seats < guests | `'Small for '+g` | `var(--surface)` | `var(--border)` | `var(--ok)` (green dot) | `var(--warn-i)` | none |

- `free` count per area = tiles that are neither current, nor with an order, nor reserved (small tables count as free).
- `d = (k×.02).toFixed(2)+'s'` (index within the area).
- Click: current tile → close; otherwise `pickTable(name)`: if another order with lines is at that table → that order becomes active, the picker closes, toast `{name} already had an order · opened it`; else the current order moves there (`id = name`, `type 'Dine-in'`, `guests = min(guests||2, seats)`, an empty order already at that table is dropped), toast `('Moved to ' | 'Seated at ')+name+' · '+area` ("Moved to Table 5 · Indoor" when the order already had a table).
- Tables (`TABLES`): Indoor T1 4, T2 2, T3 4, T4 4, T5 6, T6 2, T7 4, T8 4, T9 8, T10 2, T11 4, T12 6 · Patio T13 4, T14 4, T15 2, T16 6, T17 4, T18 2 · Rooftop T19 4, T20 4, T21 8, T22 2 (seats).
- Demo at 9:30 PM for Table 4 (3 guests): Indoor "6 free": T1 ₹1,063 open, T2 Small for 3, T3 Res. 9:45 PM, T4 Current, T5 Free, T6 ₹768 open, T7 ₹439 open, T8 Free, T9 Res. 11:00 PM, T10 Small for 3, T11 Free, T12 Free · Patio "3 free": T13 ₹536 open, T14 Free, T15 Small for 3, T16 Res. 10:15 PM, T17 ₹767 open, T18 Small for 3 · Rooftop "4 free": T19 Free, T20 Free, T21 Free, T22 Small for 3.

### 9.3 Measured (state `tp`)
| Element | d1280 / c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|
| panel | `[340,44.5,600,711]` | `[212,28.5,600,711]` | `[110,234.5,600,711]` | `[0,101.28,390,742.72]` (radius 14 14 0 0) |
| head | `[341,45.5,598,65]` (title `[357,61.5,524,22]`, sub `[357,83.5,524,17]`, ✕ `[891,65,32,32]`) | `[213,29.5,598,65]` (panel offsets as d1280) | `[111,235.5,598,65]` | `[1,102.28,388,65]` |
| legend | `[341,110.5,598,26]`: "Free" `[357,110.5,38.14,16]` (dot `[357,114.5,8,8]`), "Has an order · tap to open" `[409.14,110.5,155.22,16]`, "Reserved" `[578.36,110.5,65.39,16]` | x −128, y −16 | x −230, y +190 | `[1,167.28,388,26]`: x 17 / 69.14 / 238.36, y 167.28 |
| body | `[341,136.5,598,618]` (no scroll) | `[213,120.5,598,618]` | `[111,326.5,598,618]` | `[1,193.28,388,649.72]` (scrollHeight 790: scrolls) |
| Indoor heading | `[357,140.5,566,16]` ("INDOOR" `[357,140.5,50.14,16]`, "6 FREE" `[879.81,140.5,43.19,16]`) | x −128, y −16 | x −230, y +190 | `[17,197.28,356,16]` |
| Indoor grid | `[357,164.5,566,250]`, 5 columns of 106.8 | `[229,148.5,566,250]` | `[127,354.5,566,250]` | `[17,221.28,356,336]`, 3 columns of 113.33 (4 rows) |
| tile T1 | `[357,164.5,106.8,78]`: "T1" `[368,174.5,20.55,22]`, "4 seats" `[416.25,180.5,36.55,14]`, label row `[368,217.5,84.8,15]`, dot `[368,222,6,6]` | same offsets | same offsets | `[17,221.28,113.33,78]` |
| tiles | x 357 / 471.8 / 586.59 / 701.39 / 816.19, rows y 164.5 / 250.5 / 336.5 (86 apart) | same offsets | same offsets | x 17 / 138.33 / 259.66, rows 221.28 / 307.28 / 393.28 / 479.28 |
| Patio | heading y 430.5, grid `[357,454.5,566,164]` | y −16 | y +190 | heading y 573.28, grid `[17,597.28,356,164]` |
| Rooftop | heading y 634.5, grid `[357,658.5,566,78]` | y −16 | y +190 | heading y 777.28, grid `[17,801.28,356,164]` |

The panel is 711 tall everywhere except the phone (content 711 < `calc(100dvh − 32px)`); on the phone it is 88dvh-limited (742.72) and the body scrolls. Colours measured: current tile bg `rgb(237,245,255)`, border `rgb(15,98,254)`, ring `rgb(237,245,255) 0 0 0 3px`, label `rgb(0,67,206)`; order tiles bg `rgb(237,245,255)`, border `rgb(166,200,255)`, label `rgb(0,67,206)`; reserved bg `rgb(246,242,255)`, border `rgb(212,187,255)`, label `rgb(105,41,196)`; free label `rgb(25,128,56)`; small label `rgb(186,78,0)`.

---

## 10. Item options modal (`sc-if modalOpen` = `!!s.modal`)

Opened by a click on an item card's name button (`p.onOpen` → `modal = {name, size:0, addons:[], qty:1, note:''}`); not for unavailable items (the button is disabled: state `modal-oos` opens nothing). Closed by the scrim, ✕, Escape, or "Add to order".

### 10.1 Elements (verbatim)
| Element | Properties |
|---|---|
| Scrim | `div`, click `closeModal`: `animation:fadeIn .2s ease both; position:fixed; inset:0; background:var(--scrim); display:flex; align-items:{{ L.sheetAlign }}; justify-content:center; z-index:20; padding:{{ L.sheetPad }}`. |
| Panel | `div`, click stops: `animation:sheetIn .34s cubic-bezier(.2,.8,.2,1) both; width:100%; max-width:440px; background:var(--surface); border-radius:{{ L.sheetRadius }}; box-shadow:var(--pop); overflow:hidden` (no border, no max-height). |
| Head | `div`: `display:flex; align-items:center; gap:10px; padding:16px 18px; border-bottom:1px solid var(--border-2)`. Veg mark `span` (as the card's: 12×12, `border:1.5px solid {{ m.mark }}`, radius 2, inner 4×4 dot) without the margin-top; name `span` `font-weight:600; font-size:17px; letter-spacing:-.01em; flex:1` (−0.17px); close `button` (click `closeModal`): `width:28px; height:28px; border:0; background:var(--surface-3); border-radius:50%; font-size:12px; cursor:pointer; color:var(--text-2)`, text "✕" (U+2715, a character, not an SVG). |
| Body | `div`: `padding:16px 18px; display:flex; flex-direction:column; gap:18px`. |
| Size block | `div`: `display:flex; flex-direction:column; gap:8px`; caption `span` `font-size:12px; font-weight:600; color:var(--text-2)` "Size" (always shown, also for a single "Standard" size); segments `div`: `display:grid; grid-template-columns:repeat({{ m.cols }},1fr); background:var(--surface-3); border-radius:8px; padding:2px; gap:2px`; `button` per size: `border:0; border-radius:6px; height:44px; cursor:pointer; color:var(--text); background:{{ s.bg }}; box-shadow:{{ s.shadow }}; display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1.2` with `span` `font-size:12px; color:var(--text-2)` (full size name: "Regular", "Medium", "Large", "Standard", "Half", "6 pcs") and `span` `font-weight:600; font-size:14px` (`RS(price)`). Selected = `SEG_ON`. |
| Add-ons (`sc-if m.hasAddons`) | `div` `display:flex; flex-direction:column; gap:8px`; caption "Add-ons" (as "Size"); list `div`: `border:1px solid var(--border); border-radius:10px; overflow:hidden`; `button` per add-on: `width:100%; display:flex; align-items:center; gap:10px; border:0; border-bottom:1px solid var(--border-2); background:var(--surface); padding:0 12px; height:42px; font-size:14px; cursor:pointer; color:var(--text); text-align:left`; hover `background:var(--hover)`. Check box `span`: `width:18px; height:18px; border-radius:5px; border:1.5px solid {{ a.box }}; background:{{ a.fill }}; color:var(--on-accent); font-size:11px; display:flex; align-items:center; justify-content:center`, text `{{ a.check }}` ("✓" U+2713 when on); label `span style="flex:1"`; price `span style="color:var(--text-2)"` `+{{ a.price }}` ("+₹60"). The last row keeps its bottom border, so the list's bottom edge is 2 px (border-2 + border). |
| Kitchen note | `div` `display:flex; flex-direction:column; gap:8px`; caption "Kitchen note"; chips `div`: `display:flex; flex-wrap:wrap; gap:6px`; `button` per note: `border:1px solid {{ q.border }}; background:{{ q.bg }}; color:{{ q.color }}; border-radius:7px; height:30px; padding:0 10px; font-size:13px; cursor:pointer`. No free-text note field. |
| Footer | `div`: `display:flex; align-items:center; gap:10px; padding:14px 18px 18px; border-top:1px solid var(--border-2)`. Stepper `div`: `display:flex; align-items:center; border:1px solid var(--border); border-radius:10px; height:46px` with `button` "−" / "+" (`width:42px; height:44px; border:0; background:transparent; font-size:18px; cursor:pointer; color:var(--text)`) around `span` `min-width:24px; text-align:center; font-weight:600; font-size:15px` (`{{ m.qty }}`). Add `button` (click `m.add`): `flex:1; height:46px; border:0; border-radius:10px; background:var(--accent); color:var(--on-accent); font-weight:600; font-size:15px; cursor:pointer`; hover `var(--accent-h)`; `Add to order · {{ m.total }}`. |

### 10.2 Values (`m`, renderVals 765–771)
- `mark` veg / non-veg; `cols = sizes.length`; `sizes[i]`: `{label, price:RS(price), …(i===modal.size ? SEG_ON : SEG_OFF)}`.
- `hasAddons = ADDONS[item.cat]` exists: Pizza: Extra cheese ₹60, Jalapeño ₹30, Olives ₹30, Cheese burst ₹90; Burgers: Extra patty ₹80, Cheese slice ₹30; Pasta: Extra cheese ₹50, Garlic bread ₹69. Add-on on: `box`/`fill` `var(--accent)`, `check '✓'`; off: `box 'var(--text-3)'`, `fill 'var(--surface)'`, `check ''`.
- Quick notes `NOTES = ['Less spicy','Extra spicy','No onion','Jain','Parcel']`, several can be on; `note` = the chosen ones joined with ", " in click order. On: `border 'var(--accent)'`, `bg 'var(--accent-t)'`, `color 'var(--accent-i)'`; off: `var(--border)` / `var(--surface)` / `var(--ink)`.
- `qty`: − stops at 1; + unbounded. `total = RS((sizePrice + Σ chosen add-on prices) × qty)`.
- Add → `addLine({name, size: sizeName, price: sizePrice + addOns, addons:[…names], qty, sent:false, note})` (merges into an existing unsent line with the same name, size, add-ons and note), toast `{name} added` + Undo, modal closes. The new line's meta lists size, add-ons and notes: "Medium, Extra cheese, Less spicy, Jain" (state `modal-added`, line ₹818).

### 10.3 Measured
| Element | d1280 / c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|
| panel (Margherita) | `[420,136,440,528]` | `[292,120,440,528]` | `[190,326,440,528]` | `[0,280,390,564]` (radius 14 14 0 0; the notes wrap to 2 rows) |
| head | `[420,136,440,61]`: mark `[438,160,12,12]`, name `[460,155,344,22]`, ✕ `[814,152,28,28]` | offsets as d1280 | offsets as d1280 | `[0,280,390,61]`: mark `[18,304,12,12]`, name `[40,299,294,22]`, ✕ `[344,296,28,28]` |
| body | `[420,197,440,388]` | offsets as d1280 (panel x −128 / y −16) | offsets as d1280 (x −230 / y +190) | `[0,341,390,424]` |
| size block | `[438,213,404,72]`: caption `[438,213,404,16]`, segments `[438,237,404,48]`, buttons 132×44 at x 440 / 574 / 708 (labels 12px line-height 14.4, prices 14px line-height 16.8) | offsets as d1280 (panel x −128 / y −16) | offsets as d1280 (x −230 / y +190) | `[18,357,354,72]` |
| add-ons block | `[438,303,404,194]`: list `[438,327,404,170]`, rows 402×42 at y 328 / 370 / 412 / 454; box `[451,339.5,18,18]`; label `[479,339.5,305.86,18]`; price `[794.86,339.5,34.14,18]` | offsets as d1280 (panel x −128 / y −16) | offsets as d1280 (x −230 / y +190) | `[18,447,354,194]` |
| note block | `[438,515,404,54]`: chips 30 tall at x 438 / 527.88 / 621.27 / 702.2 / 755.83 (widths 83.88, 87.39, 74.94, 47.63, 59.36), y 539 | offsets as d1280 (panel x −128 / y −16) | offsets as d1280 (x −230 / y +190) | `[18,659,354,90]`: first row y 683 (4 chips), "Parcel" `[18,719,59.36,30]` |
| footer | `[420,585,440,79]`: stepper `[438,600,110,46]` (− `[439,601,42,44]`, qty `[481,613.5,24,19]`, + `[505,601,42,44]`), Add `[558,600,284,46]` | offsets as d1280 (panel x −128 / y −16) | offsets as d1280 (x −230 / y +190) | `[0,765,390,79]`: stepper `[18,780,110,46]`, Add `[138,780,234,46]` |

No add-ons (Paneer Tikka Bites, `modal-noaddons`): panel `[420,242,440,316]`, one size button "Standard ₹229" `[440,345,400,44]`, note block `[438,409,404,54]`, Add "Add to order · ₹229" `[558,494,284,46]`.
Selected (`modal-sel`: Medium, Extra cheese, Less spicy, Jain, qty 2): Medium segment white + seg shadow; Extra cheese box `rgb(15,98,254)` fill and border, white "✓"; chips "Less spicy" and "Jain" `rgb(237,245,255)` bg, `rgb(15,98,254)` border, `rgb(0,67,206)` text; qty "2"; button "Add to order · ₹818".

---

## 11. Payment (`sc-if cashOpen` = `s.cashOpen`)

Opened by Pay / F9 (`pay()`, section 14: not for a Captain, not for an empty order, Delivery without a customer goes to the customer sheet first). Opening resets `tendered:null`, `splitCash:null` and closes the order-details popover; the method (`s.method`, default "Cash") is remembered between openings. Closed by the scrim, ✕, Escape, opening the customer sheet, or completing.

### 11.1 Elements (verbatim)
| Element | Properties |
|---|---|
| Scrim | `div`, click `closeCash`: `animation:fadeIn .2s ease both; position:fixed; inset:0; background:var(--scrim); display:flex; align-items:{{ L.sheetAlign }}; justify-content:center; z-index:45; padding:{{ L.sheetPad }}`. |
| Panel | `div`, click stops: `animation:sheetIn .34s cubic-bezier(.2,.8,.2,1) both; width:100%; max-width:420px; background:var(--surface); border-radius:{{ L.sheetRadius }}; box-shadow:var(--pop); padding:18px 18px {{ L.cartFootB }}; display:flex; flex-direction:column; gap:16px` (no border; content-sized). |
| Head | `div`: `display:flex; align-items:center; justify-content:space-between; gap:10px`: `{{ payTitle }}` `font-size:16px; font-weight:600` (`'Payment · '+o.id` → "Payment · Table 4"); close `button title="Close"`: `width:30px; height:30px; border:0; background:var(--surface-3); border-radius:50%; font-size:12px; cursor:pointer; color:var(--text-2)`, text "✕". |
| Amount | `div style="text-align:center"`: "Amount to collect" `font-size:13px; color:var(--text-2)`; `{{ total }}` `font-size:36px; font-weight:600; letter-spacing:-.025em; margin-top:2px` (−0.9px); customer pill `button` (click `cu.open` → customer sheet, payment closes): `margin-top:8px; border:0; background:var(--surface-2); border-radius:999px; height:28px; padding:0 12px; font-size:12.5px; color:{{ cu.payColor }}; cursor:pointer; font-weight:500`; `{{ cu.payLine }}` = customer ? `'Customer: '+name+' · change'` (colour `var(--text)`) : `'+ Add customer for e-bill'` (colour `var(--link)`). |
| Methods | `div`: `display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); background:var(--surface-3); border-radius:10px; padding:3px; gap:3px`; `button` per `payMethods` (Cash, UPI, Card, Split, Due): `border:0; border-radius:8px; height:40px; font-weight:600; font-size:13.5px; padding:0 2px; cursor:pointer; background:{{ m.bg }}; color:var(--text); box-shadow:{{ m.shadow }}` (selected `SEG_ON`). |
| Cash (`sc-if isCash`) | Block `div` `display:flex; flex-direction:column; gap:8px`: caption "Amount received" `font-size:12px; font-weight:600; color:var(--text-2)`; tender grid `div` `display:grid; grid-template-columns:repeat(4,1fr); gap:6px` with `button` per `tenderOpts`: `border:1px solid {{ o.border }}; background:{{ o.bg }}; color:{{ o.color }}; border-radius:8px; height:44px; font-weight:500; font-size:14px; cursor:pointer`; other-amount box `div`: `display:flex; align-items:center; gap:8px; height:44px; border:1px solid var(--border); border-radius:8px; padding:0 12px; background:var(--surface)` with "Other amount ₹" `span` `font-size:13px; color:var(--text-2)` and `input inputmode="numeric" value="{{ tenderVal }}" placeholder="0"`: `flex:1; min-width:0; border:0; outline:0; background:transparent; font-family:inherit; font-size:15px; font-weight:600; color:var(--text); text-align:right`; short text `div` `display:{{ shortD }}; font-size:12.5px; color:var(--bad-i)` `{{ shortTxt }}`. Then the change row `div`: `display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-2); padding-top:14px`: "Change to return" `font-size:14px; color:var(--text-2)`; `{{ change }}` `font-weight:600; font-size:22px; color:var(--ok-i)`. |
| Split (`sc-if isSplit`) | `div` `display:flex; flex-direction:column; gap:8px`: caption "Split between cash and UPI"; grid `div` `display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:8px`: cash box `div` `display:flex; flex-direction:column; gap:4px; border:1px solid var(--accent); border-radius:10px; padding:10px 12px; background:var(--surface)` ("Cash" `font-size:12px; color:var(--text-2)`; `span` `display:flex; align-items:center; gap:2px; font-size:18px; font-weight:600` = "₹" + `input inputmode="numeric" value="{{ splitVal }}"` `flex:1; min-width:0; border:0; outline:0; background:transparent; font-family:inherit; font-size:18px; font-weight:600; color:var(--text)`); UPI box `div` same layout with `border:1px solid var(--border); background:var(--surface-2)` ("UPI · balance", `{{ splitUpi }}` `font-size:18px; font-weight:600`). Quick buttons `div` `display:flex; gap:6px`: `button` per `splitOpts`: `flex:1; height:34px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); font-size:12.5px; font-weight:500; cursor:pointer`; hover `var(--hover)`. |
| Due (`sc-if isDue`) | `div`: `border:1px solid {{ dueBd }}; background:{{ dueBg }}; border-radius:10px; padding:14px; font-size:13.5px; color:var(--text-2); line-height:1.5`; `{{ dueNote }}`. |
| UPI / Card (`sc-if notCash`) | `div`: `border:1px solid var(--border); background:var(--surface-2); border-radius:10px; padding:14px; font-size:13.5px; color:var(--text-2); line-height:1.5`; `{{ payNote }}`. |
| Main button | `button` (click `completePay`): `height:50px; border:0; border-radius:10px; background:var(--accent); color:var(--on-accent); font-weight:600; font-size:15px; cursor:pointer`; hover `var(--accent-h)`; `{{ payBtn }}`. |

### 11.2 Values (renderVals 772–773, 941, 947–949)
- `tendered = s.tendered ?? total` (so "Exact" is selected when nothing was typed). `tOpts = [total, Math.ceil(total/100)×100, 500, 1000, 2000].filter((v,i,a) => v>=total && a.indexOf(v)===i).slice(0,4)`; labels: first "Exact", others `RS(v)`; selected (`tendered===v`): border `var(--accent)`, bg `var(--accent-t)`, colour `var(--accent-i)`; others `var(--border)` / `var(--surface)` / `var(--ink)`. Table 4 (₹954): "Exact", "₹1,000", "₹2,000" (3 of 4 columns used). Picking one sets `tendered` (and the input shows it: `tenderVal = s.tendered==null ? '' : String(s.tendered)`). Typing keeps digits only (`tendered = Number(digits)` or null).
- `change = RS(max(0, tendered − total))`; `shortD = tendered<total ? 'block':'none'`; `shortTxt = 'Short by '+RS(total−tendered)+' · choose Split or Due for part payment'`.
- Split: `splitVal = String(min(total, s.splitCash ?? round(total/2)))` ("477"); `splitUpi = RS(total − that)` ("₹477"); `splitOpts`: "Half" → round(total/2), "₹100 cash" → min(100,total), "₹500 cash" → min(500,total); typing keeps digits, capped at the total.
- Due: with a customer `dueNote = 'The full '+RS(total)+' is added to '+name+'’s dues. Collect it later from Orders → Due.'`, `dueBd 'var(--border)'`, `dueBg 'var(--surface-2)'`; without `'A due bill needs a customer. Tap the button below to choose or add one.'`, `var(--warn)` / `var(--warn-t)`.
- UPI `payNote = 'Ask the customer to scan the counter QR code. Tap “Mark as paid” once '+RS(total)+' shows in your UPI app.'`; Card `'Enter '+RS(total)+' on the card machine. Tap “Mark as paid” after the slip prints.'`.
- `payBtn`: Cash "Complete payment"; Split "Complete split payment"; Due with customer `'Add '+RS(total)+' to dues'`, without "Choose customer for due"; UPI / Card "Mark as paid".
- `completePay`: Due without customer → close payment, `openCust('pay')` (customer sheet; for a non-delivery order no need banner); Cash with `tendered < total` → toast `'Amount received is less than '+RS(total)` (sheet stays); otherwise `finish()` (section 14): the order is emptied (cart, discount, billed, customer, service-charge flag reset) and stays the active order, payment and cart sheet close, toast `RS(total)+' paid by '+method` or `RS(total)+' added to '+name+'’s dues'`, plus `' · e-bill sent to '+fmtPh(phone)` when a customer was attached (measured "₹954 paid by Cash · e-bill sent to +91 98201 23456"). There is no receipt screen and no confirm step.

### 11.3 Measured (state `pay`, Cash)
| Element | d1280 / c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|
| panel | `[430,148.5,420,503]` | `[302,132.5,420,503]` | `[200,338.5,420,503]` | `[0,343,390,501]` (radius 14 14 0 0, padding-bottom 12) |
| head | `[448,166.5,384,30]` ("Payment · Table 4" `[448,171,133.28,21]`, ✕ `[802,166.5,30,30]`) | x 320, y 150.5 | x 218, y 356.5 | `[18,361,354,30]` |
| amount block | `[448,212.5,384,102]`: label `[448,212.5,384,17]`, "₹954" `[448,231.5,384,47]`, pill `[537.55,286.5,204.91,28]` | y 196.5 | y 402.5 | `[18,407,354,102]`, pill `[92.55,481,204.91,28]` |
| methods | `[448,330.5,384,46]`, buttons 73.19×40 at x 451 / 527.19 / 603.39 / 679.59 / 755.8 | y 314.5 | y 520.5 | `[18,525,354,46]`, buttons 67.19×40 |
| cash block | `[448,392.5,384,120]`: caption `[448,392.5,384,16]`, tenders `[448,416.5,384,44]` (91.5×44 at x 448 / 545.5 / 643), other box `[448,468.5,384,44]` ("Other amount ₹" `[461,482,94.3,17]`, input `[563.3,480,255.7,21]`) | y 376.5 | y 582.5 | `[18,587,354,120]`, tenders 84×44 |
| change row | `[448,528.5,384,43]` ("Change to return" `[448,548.5,108.33,18]`, "₹0" `[802.86,543.5,29.14,28]`) | y 512.5 | y 718.5 | `[18,723,354,43]` |
| button | `[448,587.5,384,50]` | `[320,571.5,384,50]` | `[218,777.5,384,50]` | `[18,782,354,50]` |

Other method states (d1280, the panel stays centred so its y changes with its height):
- `pay-other` (500 typed): panel `[430,136,420,528]`; no tender selected; input value "500" (focused); short text `[448,508,384,17]` "Short by ₹454 · choose Split or Due for part payment" `rgb(162,25,31)`; change "₹0".
- `pay-2000`: "₹2,000" selected; input shows "2000"; change "₹1,046" `[756.73,543.5,75.27,28]`.
- `pay-upi` / `pay-card` / `pay-due`: panel `[430,202.75,420,394.5]`; note box `[448,446.75,384,70.5]` (line-height 20.25, 3 lines); button `[448,533.25,384,50]` "Mark as paid" / "Mark as paid" / "Add ₹954 to dues".
- `pay-due-nocust` (Table 7, ₹439, no customer): pill "+ Add customer for e-bill" `[555.58,340.75,168.84,28]` in `rgb(15,98,254)`; note border `rgb(255,131,43)`, bg `rgb(255,242,232)`; button "Choose customer for due"; pressing it (`pay-due-nocust-go`) shows the customer sheet ("Customer" / "Table 7 · Dine-in", no banner).
- `pay-split`: panel `[430,171.5,420,457]`; caption `[448,415.5,384,16]`; cash box input "477" `[475.61,470.5,147.39,25]`; "UPI · balance" "₹477" `[657,470.5,162,23]`; quick buttons 124×34 at x 448 / 578 / 708, y 514.5; button "Complete split payment" `[448,564.5,384,50]`.
- `pay-done`: toast "₹954 paid by Cash · e-bill sent to +91 98201 23456" (`[466.58,738,346.84,38]`); Table 4 stays active and empty ("No items", Customer "Add", switcher sub "Dine-in · No items yet", Pay "Pay ₹0").
- `pay-short`: toast "Amount received is less than ₹954"; the sheet stays.
- `pay-delivery-nocust` (Pay on a new Delivery with one item, no customer): the customer sheet opens instead, with the banner "Delivery orders need a customer before payment."; after a pick, payment opens 250 ms later.
- Captain (Amit, states `captain`, `captain-pay`): the Pay button reads "Request bill" (with the F9 chip); clicking marks the order billed (switcher dot `rgb(178,134,0)` = `var(--bill)`) and toasts "Bill requested · cashier notified for Table 4"; no payment sheet.

---

## 12. Confirm dialog and manager approval, as used from the Order screen

### 12.1 Confirm (`sc-if cfOpen` = `!!s.confirm`)
Reached from Order only by locking with unsent items of the signed-in user: Ctrl/⌘+L (or "Lock screen" / "Switch user" in the profile sheet) → `lockNow('manual')` → if any order **created by the current user** (`o.by === user`) has unsent lines → `confirm = {kind:'unsent', reason, n, where}` (`n` = Σ unsent qty of those orders, `where` = the order id when one order, else `count+' orders'`). Rohan's demo orders are created by others, so for him it appears only after he starts an order (state `confirm-unsent`: New → add Paneer Tikka Bites → Ctrl+L); for Priya it appears at once (Table 4 and Delivery 3 have unsent items: `confirm-unsent-priya`). (`kind 'end'` "End shift" is handled by the dialog, but nothing in the file opens it.)

| Element | Properties |
|---|---|
| Scrim | `div`, click `closeCf`: `animation:fadeIn .2s ease both; position:fixed; inset:0; z-index:50; background:var(--scrim); display:flex; align-items:{{ L.sheetAlign }}; justify-content:center; padding:{{ L.sheetPad }}`. |
| Panel | `div`, click stops: `animation:sheetIn .34s cubic-bezier(.2,.8,.2,1) both; width:100%; max-width:420px; background:var(--surface); border:1px solid var(--border); border-radius:{{ L.sheetRadius }}; box-shadow:var(--pop); padding:20px; display:flex; flex-direction:column; gap:16px`. |
| Text | `div`: title `div` `font-size:18px; font-weight:600; letter-spacing:-.01em` (−0.18px) `{{ cf.title }}`; body `div` `font-size:14px; color:var(--text-2); margin-top:6px; line-height:1.5; text-wrap:pretty` `{{ cf.body }}`. |
| Rows (`sc-if cf.hasRows`) | not used for `unsent`. |
| Buttons | `div` `display:flex; flex-direction:column; gap:8px`; `button` per `cf.btns`: `height:46px; border:1px solid {{ b.border }}; background:{{ b.bg }}; color:{{ b.color }}; border-radius:10px; font-size:14.5px; font-weight:600; cursor:pointer`. `BT(label, onClick, kind)`: kind 1 → bg `var(--accent)`, colour `var(--on-accent)`, border `var(--accent)`; kind 0 → `var(--surface-3)`, `var(--text)`, transparent; kind 2 → transparent, `var(--link)`, transparent. No hover rules. |

Texts (`unsent`): title `n+(n===1 ? ' item isn’t' : ' items aren’t')+' sent to the kitchen'`; body `where+' has items the kitchen hasn’t received yet. Send them before you '+(reason==='break' ? 'go on break' : 'lock the screen')+'?'`; buttons "Send to kitchen & lock" (kind 1: `sendMine()` marks every line of the user's orders sent, `doLock(reason)`, toast "Sent to kitchen · screen locked"), "Lock without sending" (kind 0: `doLock`), "Cancel" (kind 2: close). Measured: "1 item isn’t sent to the kitchen" / "Takeaway 16 has items the kitchen hasn’t received yet. Send them before you lock the screen?"; Priya: "4 items aren’t sent to the kitchen" / "2 orders has items the kitchen hasn’t received yet. …" (the mock-up's grammar).

Measured panel: d1280 / c1280 `[430,258.5,420,283]`, t1024 `[302,242.5,420,283]`, t820 `[200,448.5,420,283]`, p390 `[0,561,390,283]` (bottom sheet). Inside (d1280): text `[451,279.5,378,71]` (title `[451,279.5,378,23]`, body `[451,308.5,378,42]`, line-height 21), buttons 378×46 at y 366.5 / 420.5 / 474.5 (colours: `rgb(15,98,254)` / `rgb(233,233,236)` / transparent with `rgb(15,98,254)` text).

### 12.2 Manager approval (`sc-if apOpen` = `!!s.approval`)
`needs(kind)` is false for a Manager, so Rohan never sees it. For Cashier / Captain (`settings.discApproval` true) the Order screen asks for approval on: **Clear** when the order has sent items (`'Clear '+o.id+' · '+sentQty+' items were already sent to the kitchen'`, done text "Order cleared"); **−** on a sent line (`'Remove 1 × '+name+' · already sent to the kitchen'`, done `name+' removed'`); **Discount** when turning it on (`'Apply 10% discount on '+o.id`, done "Discount applied"). `ask(sub, run, done)` → `approval = {sub, run, done, mid: first on-shift Manager (Rohan), pin:'', msg:null, errN:0}`.

| Element | Properties |
|---|---|
| Scrim | as 12.1 (`z-index:50`), click `closeAp`. |
| Panel | as 12.1 but `max-width:380px` (so on the 390 phone it is 380 wide and centred: measured `[5,300.88,380,543.13]` with the top-only radius). |
| Head | `div`: `display:flex; gap:12px; align-items:flex-start`. Icon tile `span`: `width:38px; height:38px; flex:none; border-radius:10px; background:var(--warn-t); color:var(--warn-i); display:flex; align-items:center; justify-content:center` with a shield `svg 18×18 stroke-width 1.8 stroke-linejoin round` (no linecap), path `M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z`. Text `div style="flex:1;min-width:0"`: "Manager approval" `font-size:17px; font-weight:600`; `{{ ap.sub }}` `font-size:13.5px; color:var(--text-2); margin-top:3px; line-height:1.45`. |
| No manager (`sc-if ap.none`) | `div`: `font-size:13.5px; color:var(--text-2); border:1px dashed var(--border); border-radius:10px; padding:14px`; "No manager is on shift. Ask the owner to approve from the admin app." |
| Managers | `div` `display:flex; gap:8px; flex-wrap:wrap`; pill `button` per on-shift Manager: `display:flex; align-items:center; gap:8px; height:40px; padding:0 12px 0 5px; border-radius:999px; border:1px solid {{ m.border }}; background:{{ m.bg }}; cursor:pointer; color:var(--text); font-size:13.5px; font-weight:500`; avatar `span` `width:30px; height:30px; border-radius:50%; background:{{ m.avBg }}; color:{{ m.avColor }}; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:600` + first name. Selected: border `var(--accent)`, bg `var(--accent-t)`; others `var(--border)` / `var(--surface)`. Click selects and clears the PIN. |
| PIN area | `div` `display:flex; flex-direction:column; align-items:center; gap:10px`: prompt `span` `font-size:13px; color:var(--text-2)` (`m ? first+', enter your PIN' : 'Choose a manager'`); dots `this.dots(len, errN, err)` (`err = !!msg && !pin.length`): `div` `display:flex; gap:16px; justify-content:center; animation: errN ? 'shake .42s ease' : 'none'` with four `14×14` round spans, `border:1.5px solid (err ? var(--bad) : i<len ? var(--ink) : var(--text-3))`, `background: i<len ? var(--ink) : (err ? var(--bad-t) : transparent)`, `transition:background .12s`; message `span` `min-height:18px; font-size:13px; font-weight:500; color:var(--bad-i)` (`ap.msg`). |
| Keypad | `div`: `display:grid; grid-template-columns:repeat(3,1fr); gap:8px; opacity:{{ ap.padOp }}` (1 with a manager, .4 without); keys `1…9, Clear, 0, ⌫` (`keysFor`): `button disabled="{{ k.off }}"`: `height:50px; border:1px solid {{ k.border }}; background:{{ k.bg }}; border-radius:14px; font-size:{{ k.size }}; font-weight:500; color:var(--text); cursor:pointer`; hover `background:var(--hover)`, active `background:var(--surface-3)`; digits `24px`, `var(--surface)` bg, `var(--border)` border; "Clear" 14px and "⌫" 20px transparent bg and border. |
| Cancel | `button` (click `closeAp`): `height:40px; border:0; background:transparent; color:var(--link); font-size:14px; font-weight:500; cursor:pointer`. |

Behaviour (`apPress`, app.js 388–390): digits from the keypad or the physical keyboard (0–9, Backspace; Escape closes); at 4 digits, after 180 ms: the manager's PIN (demo 1234) → close, run the action, toast `done+' · approved by '+first` (measured "Order cleared · approved by Rohan"); wrong → `pin:''`, `msg 'Incorrect PIN'`, `errN+1` (dots red-ringed with `var(--bad-t)` fill, shake).

Measured (d1280, `approval-clear`): panel `[450,128.44,380,543.13]`; head `[471,149.44,338,64.13]` (icon `[471,149.44,38,38]`, title `[521,149.44,288,22]`, sub `[521,174.44,288,39.13]` two lines, line-height 19.58); managers `[471,229.56,338,40]` ("Rohan" `[471,229.56,97.2,40]` selected, "Meera" `[576.2,229.56,96.61,40]`, avatar `[477,234.56,30,30]`); PIN area `[471,285.56,338,69]` (prompt `[575.5,285.56,129,17]`, dots `[588,312.56,104,14]`, message line `[640,336.56,0,18]`); keypad `[471,370.56,338,224]` (keys 107.33×50, rows y 370.56 / 428.56 / 486.56 / 544.56); Cancel `[471,610.56,338,40]`. Other viewports: c1280 same; t1024 `[322,112.44,380,543.13]`; t820 `[220,318.44,380,543.13]`; p390 `[5,300.88,380,543.13]`. Discount (`approval-disc`): one-line sub "Apply 10% discount on Table 4", panel `[450,138.22,380,523.56]`. Typed 2 digits (`approval-typed`): two dots filled `rgb(24,24,27)`. Wrong (`approval-wrong`): "Incorrect PIN" `[600.31,336.56,79.38,18]`, all dots border `rgb(218,30,40)` and fill `rgb(255,241,241)`. Meera chosen (`approval-meera`): "Meera, enter your PIN".

---

## 13. Toasts and keyboard shortcuts

### 13.1 Toast
Element, timing and Undo button: U0 §2.8 (`flash(msg, undo)`, 2800 ms, a new flash replaces the old one; `bottom:{{ L.toastB }}`, centred on the **window**, not on the page column). Measured height 38 at every width; y = 738 (d1280, c1280), 706 (t1024), 1050 (t820), 666 (p390). Undo (`canUndo`): if the stored undo is a function it is called, otherwise it is an `orders` snapshot and the whole orders list is restored (any other order change made in the meantime is undone too); the toast closes.

Toasts the Order screen raises (verbatim; `RS()` amounts; "+ Undo" = with the Undo button):
| Trigger | Text |
|---|---|
| Price button, item modal "Add to order" | `{item} added` + Undo (e.g. "Farmhouse added", "Margherita added") |
| − on the last unit of a line (Manager, or an unsent line) | `{item} removed` + Undo ("Margherita removed") |
| Clear (Manager, or nothing sent) — also on an empty order | "Order cleared" + Undo |
| Send KOT / F8 (only when something is unsent) | `Sent {n} items to kitchen` ("Sent 2 items to kitchen"; "1 items" for one) |
| Approval granted | `{done} · approved by {First}`: "Order cleared · approved by Rohan", "{item} removed · approved by …", "Discount applied · approved by …" |
| Note | "Tap an item name to add a kitchen note" (nothing else happens) |
| Split | "Split by items or equally · next build" |
| Print bill (order has lines) | `Bill printed · {order id}` ("Bill printed · Table 4") |
| Type change in the details popover | `{old id} is now {new id}` ("Table 4 is now Takeaway 40") |
| Table picker | `{Table n} already had an order · opened it`; `Moved to {Table n} · {area}`; `Seated at {Table n} · {area}` |
| Customer picked | `{name} added to {order id}` ("Aisha Khan added to Delivery 5") |
| New customer saved | `New customer saved · {name as typed}` |
| Address | "Add flat, building and area" (too short); "Address saved" |
| Payment | `{₹total} paid by {Cash, UPI, Card or Split}` or `{₹total} added to {name}’s dues`, plus ` · e-bill sent to {+91 xxxxx xxxxx}` with a customer ("₹954 paid by Cash · e-bill sent to +91 98201 23456"); "Amount received is less than {₹total}" |
| Captain Pay | `Bill requested · cashier notified for {order id}` |
| Confirm "Send to kitchen & lock" | "Sent to kitchen · screen locked" |
| Nav to an unbuilt page | `{Label} is coming in the next build` (U0 §2.4) |

Measured toast boxes (d1280): "Farmhouse added | Undo" `[546.72,738,186.56,38]` (text `[560.72,748,110.78,18]`, Undo `[685.5,748,33.78,18]` `rgb(169,200,178)`); "Order cleared | Undo" `[559.97,738,160.06,38]`; "Sent 2 items to kitchen" `[554.72,738,170.56,38]`; "Margherita removed | Undo" `[540.37,738,199.27,38]`; "Tap an item name to add a kitchen note" `[504.94,738,270.13,38]`; "Table 4 is now Takeaway 40" `[540.3,738,199.39,38]`; "Bill printed · Table 4" `[565.82,738,148.36,38]`; "Split by items or equally · next build" `[517.05,738,245.89,38]`; p390 the same widths at y 666 (e.g. "Order cleared" `[114.97,666,160.06,38]`).

### 13.2 Keyboard (`onKey`, app.js 119–128; window `keydown`)
Order of checks (outside the lock / sign-in screens):
1. Approval open → only 0–9 (PIN), Backspace (delete) and Escape (close) are handled; everything else is ignored.
2. Ctrl/⌘ + L → `preventDefault`, `lockNow('manual')` (12.1).
3. Escape → closes everything at once: item editor, order-details popover, table picker, open orders, customer sheet, item modal, payment, cart sheet, category sheet, profile/More sheet, confirm.
4. Only on route `order`: `/` (focus not in an input) → `preventDefault` + focus the search input; **F8** → `preventDefault` + `kot()`; **F9** → `preventDefault` + `pay()`. F8 / F9 also work while typing in an input and while sheets are open (F9 with the payment sheet already open just resets the tender; measured `f9`: the payment sheet opens; `f8`: "Sent 2 items to kitchen").
The F8 / F9 chips are hints only (shown except on the phone). No other shortcut (no Enter in the payment or modal, no arrow keys). Focus is not moved into opened sheets except: open orders (desk only, 60 ms) and the customer search (80 ms); the pointer focus stays on the clicked button (measured `document.activeElement`).

---

## 14. Behaviours (what every control does, from the handlers)

### 14.1 Menu side
| Control | Handler and effect |
|---|---|
| Category row (aside or sheet) | `setState({cat:key, catSheet:false})`: filters the groups (3.2); the sheet closes; the list does not scroll back to the top by itself. |
| Find category | `catQuery` (shared by aside and sheet), filters the rows (2.3). |
| "Category" button | `catSheet:true`. "Done" / scrim → `catSheet:false`. |
| Search input | `query` (3.2). `/` focuses it. |
| Diet option | `diet` = "All" / "Veg" / "Non-veg". |
| Item name | Opens the item modal (`modal = {name, size:0, addons:[], qty:1, note:''}`); disabled when unavailable. |
| Price button | `addLine({name, size, price, addons:[], qty:1, sent:false, note:''})`: if an **unsent** line with the same name, size, add-ons and note exists its qty grows, else a new line is appended; toast `{name} added` + Undo. Disabled when unavailable. |
| Item modal "Add to order" | `addLine` with the chosen size, add-ons (price included), qty and note; closes the modal. |

### 14.2 Cart side
| Control | Handler and effect |
|---|---|
| Switch order (header) | Toggles the open-orders sheet (section 7). |
| New (header, title "New takeaway") | `seq++`; new order `{id:'Takeaway '+(seq−1029), no:seq, type:'Takeaway', by:user, opened:now, disc:false, cart:[]}` becomes active; route `order`. Never asks for a customer. Demo: "Takeaway 16", #1045. |
| Printer button | Printer panel (U0 §2.5; out of scope). The "Printer" text in the clock block does nothing. |
| Clear | Sent items and the user is not a Manager → approval (12.2). Otherwise the cart and the discount are cleared, toast "Order cleared" + Undo (also when already empty). The order stays (same id / table / customer). |
| Cell 1 / 2 | Toggle the details popover (`ctxMenu`); Dine-in without a table: cell 1 opens the table picker. |
| Cell 3 (Customer) | Closes the popover, opens the customer sheet (`need 'delivery'` for Delivery). |
| Popover type segment | `setType(x)`: same type → nothing. To Dine-in: already at a table → only the type changes; else → table picker (type unchanged until a table is picked). To Takeaway / Delivery: the id becomes `x+' '+(o.no−1000)` when the order was at a table ("Table 4" #1040 → "Takeaway 40"), else the word is swapped ("Takeaway 14" → "Delivery 14"); toast `{old} is now {new}`; to Delivery without a customer → customer sheet after 200 ms. Guests, pickup and lines are kept; the service charge disappears for non-Dine-in and Packing (+ Delivery fee) appear. |
| Popover Move / Choose | Table picker (popover closes). |
| Popover guests − / + | `guests = max(1, g−1)` / `min(30, g+1)`. |
| Popover pickup | `pickup = i` (`PICK` index; default 1 = "In 15 min"). |
| Line (row click) | Toggles `selLine` (highlight only). |
| Line + | qty + 1 (sent lines too; the line stays "Sent to kitchen"). |
| Line − | Sent line and not a Manager → approval "Remove 1 × {name} · already sent to the kitchen". Else qty − 1; at 0 the line is removed and the toast `{name} removed` + Undo appears (only when it was the last unit). |
| Discount | Turning on as non-Manager (`settings.discApproval`) → approval "Apply 10% discount on {id}"; else toggles `o.disc` (10 % of the subtotal; no toast for a Manager). Label "Discount" ↔ "Remove discount". |
| Note | Toast only. |
| Split | Toast only. |
| Print bill | Order with lines → `billed:true` (switcher dot and open-orders status "Bill printed", `var(--bill)`), toast `Bill printed · {id}`. Nothing is printed or shown. Empty order → nothing. |
| Total / Details | Toggles `billOpen` (0.4). |
| Remove (service charge) | `noSvc:true` → row "Service charge removed" + "Add back" (`noSvc:false`). |
| Send KOT / F8 | `kot()`: with unsent lines, a kitchen ticket (`mkTicket`, status 'new') is created for them, every line becomes sent, toast `Sent {n} items to kitchen`; nothing when all are sent (button disabled). |
| Pay / F9 | `pay()`: empty → nothing; Delivery without customer → customer sheet (`need 'pay'`, banner "Delivery orders need a customer before payment.", payment opens 250 ms after a pick/save); Captain → `billed:true` + toast "Bill requested · cashier notified for {id}"; else payment sheet (`tendered:null, splitCash:null`, popover closed). |
| Review order (order bar) | `cartOpen:true`. |
| ‹ Menu / cart scrim | `cartOpen:false`. |

### 14.3 Payment completion (`finish`, app.js 402)
Adds a history entry `{no, id, type, cust, by, guests, cart, disc, noSvc, method, total, at:now, due: Due ? total : 0, split: Split ? {cash, upi} : null}`; closes payment and the cart sheet; the active order keeps its id and table but its cart, discount, billed flag, customer and service-charge flag are reset (the table stays open and empty, "No items yet"); the signed-in staff member's order count, sales and cash (Cash: total; Split: the cash part) grow; the customer's visits +1, spent + total, last "Today"; toast (13.1); with `settings.lockAfterSale` (demo false) the screen locks after 900 ms.

### 14.4 Roles
Manager: no approvals. Cashier: approvals for Clear with sent items, − on sent lines, Discount on. Captain: approvals as Cashier; Pay becomes "Request bill" (marks billed, no payment). Kitchen role cannot use the Order screen in practice (no nav items; the tab bar still shows Order, U0 §2.6).

### 14.5 Order data the screen reads (demo, `state.orders`, `active:0`)
| id | by | no | type | guests | opened | customer | lines (name, size, qty, sent, add-ons / note) | total |
|---|---|---|---|---|---|---|---|---|
| Table 4 | priya | 1040 | Dine-in | 3 | −32 min | c1 Neha Joshi | Margherita Medium ×1 sent (+Extra cheese ₹60); French Fries Regular ×2 sent; Cold Coffee ×2 **unsent**, note "Less sugar" | ₹954 |
| Table 7 | amit | 1041 | Dine-in | 2 | −14 | – | Chicken Zinger ×2 sent | ₹439 |
| Table 1 | sana | 1036 | Dine-in | 4 | −68 | – (billed) | Butter Chicken Full ×1, Butter Naan ×4, Dal Makhani ×1, all sent | ₹1,063 |
| Table 6 | amit | 1038 | Dine-in | 2 | −41 | – | Chicken Biryani Full ×1, Virgin Mojito ×2, sent | ₹768 |
| Table 13 | ananya | 1039 | Dine-in | 4 | −22 | – | Paneer Butter Masala ×1 sent, Garlic Naan ×3 unsent | ₹536 |
| Table 17 | sana | 1037 | Dine-in | 3 | −55 | – | Tandoori Chicken Full ×1, Masala Chai ×3, sent | ₹767 |
| Takeaway 12 | priya | 1042 | Takeaway | – | −3 | c5 Sneha Patil | (empty) | – |
| Delivery 3 | priya | 1043 | Delivery | – | −9 | c8 Karthik Iyer | Farmhouse Large ×1 sent, Garlic Bread ×1 sent, Soft Drink ×2 unsent | ₹901 |
| Takeaway 14 | priya | 1044 | Takeaway | – | −6 | c11 Simran Kaur | Veg Steamed 10 pcs ×1, Masala Chai ×2, sent | ₹312 |

`seq` starts at 1044 (next new order #1045). Menu (`MENU`, `[name, veg, sizes, popular, unavailable]`), 71 items in 24 categories; popular (13): Paneer Tikka Bites, Veg Steamed, Tandoori Chicken, Margherita, Paneer Tikka Pizza, Chicken Zinger, Chicken Biryani, Paneer Butter Masala, Butter Chicken, Chicken Shawarma, French Fries, Cold Coffee, Choco Lava. Prices are in app.js lines 12–35 (e.g. Pizza sizes Regular/Medium/Large: Margherita 249/349/449, Farmhouse 329/439/549, Paneer Tikka Pizza 389/499/599, Chicken Tikka Pizza 419/529/649, Pepperoni 449/569/689).

### 14.6 Mock-up quirks an implementer will meet (each needs the owner's ruling before it is copied or fixed)
1. **Category rows show no item count** (only "All items" 71 and "Popular" 13 have one): `row()` reads `mm[2].length` of a category object (2.3).
2. **Hover looks bound to data never apply**: category rows (`c.hover`) and open-orders rows (`r.hover`) have computed hover colours but the runtime writes an empty hover rule (0.5).
3. **The switch-order button is squeezed at 820**: title and subtitle ellipsised to 42 px ("Tabl…", "Neha …") because the brand text and the clock block keep their full width (1.4).
4. **Grammar in generated strings**: "1 items" (switcher sub, order bar, "Subtotal · 1 items", "Sent 1 items to kitchen"); "2 orders has items the kitchen hasn’t received yet" (12.1).
5. **+ on a sent line** raises its quantity but the line stays "Sent to kitchen" and nothing is sent for the extra units (5.4).
6. **Bill rows do not add up** to the total (each row rounded separately: ₹865 + ₹43 + ₹45 vs ₹954) (5.5).
7. **Clear on an empty order** still shows "Order cleared" with Undo; **Print bill** only sets a flag and toasts; **Note** and **Split** are toasts only ("next build").
8. **Approval sheet on the phone** is 380 wide (max-width 380) with 5 px gaps, unlike every other phone sheet (12.2).
9. **The phone search input is 14px** (and the open-orders / customer inputs 15px): iOS zooms on focus below 16px (U0 ruling R36 is ours, not the HTML's).
10. **F8 / F9 work while typing and while sheets are open**; F9 over an open payment resets the tender (13.2).
11. **"Popular" keeps the category grouping** (12 groups) instead of one "Popular" list (3.2).
12. **Small-table tiles** have a green dot with an orange "Small for 3" label (9.2).
13. **The phone order bar sits 1 px above the tab bar** (`obBottom` 60 vs the 59 px bar), showing a 1 px strip of the menu (6.1).
14. **New always creates a Takeaway** (title "New takeaway"); dine-in orders start from "+ Table" (→ Floor page) only.
15. **After payment the table's order stays open and empty** (same id, "No items yet"; still counted in "8 open" while it is the current order) (14.3).
16. **Header "Printer" text is static** (always green "Printer"), independent of the printer button's state dot.
17. **The cart has no entrance animation** on 820 / 390 (only its scrim fades in); every other sheet uses `sheetIn`.
18. **Dine-in without a table cannot be reached** in the demo, so its warn look ("Choose table", "Not chosen" / "Choose") is source-only (5.7).

---

## 15. Measured layout per viewport

### 15.1 Regions (state `default`; t820 / p390 cart = state `cart-open`)
| Region | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| side nav / rail | `[0,0,232,800]` | `[0,0,76,800]` | `[0,0,76,768]` | `[0,0,76,1180]` | hidden |
| page (Order) | `[232,0,1048,800]` | `[76,0,1204,800]` | `[76,0,948,768]` | `[76,0,744,1180]` | `[0,0,390,844]` |
| header | `[232,0,1048,56]` | `[76,0,1204,56]` | `[76,0,948,56]` | `[76,0,744,56]` | `[0,0,390,56]` |
| body grid | `[232,56,1048,744]` `200px 488px 360px` | `[76,56,1204,744]` `220px 604px 380px` | `[76,56,948,712]` `608px 340px` | `[76,56,744,1124]` `744px` | `[0,56,390,788]` `390px` |
| category aside | `[232,56,200,744]` | `[76,56,220,744]` | – | – | – |
| main (menu scroller) | `[432,56,488,744]` | `[296,56,604,744]` | `[76,56,608,712]` | `[76,56,744,1124]` | `[0,56,390,788]` |
| toolbar | `[432,56,488,54]` | `[296,56,604,54]` | `[76,56,608,104]` | `[76,56,744,104]` | `[0,56,390,100]` |
| first group | `[452,130,448,270]` | `[316,130,564,270]` | `[96,180,568,282]` | `[96,180,704,282]` | `[12,174,366,544]` |
| first card | `[452,158,220,117]` | `[316,158,278,117]` | `[96,208,280,123]` | `[96,208,229.33,123]` | `[12,202,366,123]` |
| cart | `[920,56,360,744]` | `[900,56,380,744]` | `[684,56,340,712]` | sheet `[380,0,440,1180]` | sheet `[0,0,390,844]` |
| cart head / lines / footer | `[921,56,359,118.63]` / `[921,174.63,359,462.38]` / `[921,637,359,163]` | `[901,56,379,118.63]` / `[901,174.63,379,462.38]` / `[901,637,379,163]` | `[685,56,339,118.63]` / `[685,174.63,339,430.38]` / `[685,605,339,163]` | `[381,0,439,160.63]` / `[381,160.63,439,790.38]` / `[381,951,439,229]` | `[1,0,389,160.63]` / `[1,160.63,389,456.38]` / `[1,617,389,227]` |
| order bar | – | – | – | `[76,1115,744,65]` | `[0,719,390,65]` |
| tab bar | – | – | – | – | `[0,785,390,59]` |
| toast (when shown) | y 738, h 38 | y 738 | y 706 | y 1050 | y 666 |

### 15.2 Every measured state: what is open and the main panel box
Boxes are the overlay panel (first child of the overlay's scrim), the order-details popover, the cart sheet (t820 / p390) and the toast. "(page only)" = no overlay (the changes are in the page; see the section of that state). "·" = state not run at that viewport.

| State | Open | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|---|
| `default` |  | (page only) | (page only) | (page only) | (page only) | (page only) |
| `cart-open` | cart sheet | · | · | · | cart `[380,0,440,1180]` | cart `[0,0,390,844]` |
| `empty-new` |  | (page only) | (page only) | (page only) | (page only) | (page only) |
| `cleared` | toast, cart sheet | toast `[559.97,738,160.06,38]` | toast `[559.97,738,160.06,38]` | toast `[431.97,706,160.06,38]` | cart `[380,0,440,1180]`<br>toast `[329.97,1050,160.06,38]` | cart `[0,0,390,844]`<br>toast `[114.97,666,160.06,38]` |
| `line-selected` | cart sheet | (page only) | (page only) | (page only) | cart `[380,0,440,1180]` | cart `[0,0,390,844]` |
| `line-step` | cart sheet | (page only) | (page only) | (page only) | cart `[380,0,440,1180]` | cart `[0,0,390,844]` |
| `line-remove` | toast, cart sheet | toast `[540.37,738,199.27,38]` | toast `[540.37,738,199.27,38]` | toast `[412.37,706,199.27,38]` | cart `[380,0,440,1180]`<br>toast `[310.37,1050,199.27,38]` | cart `[0,0,390,844]`<br>toast `[95.37,666,199.27,38]` |
| `pizza` |  | (page only) | (page only) | (page only) | (page only) | (page only) |
| `pizza-hover-card` |  | (page only) | · | (page only) | · | · |
| `pizza-hover-price` |  | (page only) | · | · | · | · |
| `pizza-press-price` |  | (page only) | · | · | · | · |
| `pizza-add` | toast | toast `[546.72,738,186.56,38]` | toast `[546.72,738,186.56,38]` | toast `[418.72,706,186.56,38]` | toast `[316.72,1050,186.56,38]` | toast `[101.72,666,186.56,38]` |
| `popular` |  | (page only) | (page only) | (page only) | (page only) | (page only) |
| `cat-hover` |  | (page only) | · | · | · | · |
| `cat-find` |  | (page only) | (page only) | · | · | · |
| `cat-find-none` |  | (page only) | · | · | · | · |
| `cat-sheet` | catSheet | · | · | `[0,138.25,1024,629.75]` | `[0,212.41,820,967.59]` | `[0,151.92,390,692.08]` |
| `cat-sheet-find` | catSheet | · | · | `[0,457,1024,311]` | · | `[0,493,390,351]` |
| `search` |  | (page only) | (page only) | (page only) | (page only) | (page only) |
| `search-none` |  | (page only) | (page only) | (page only) | (page only) | (page only) |
| `diet-veg` |  | (page only) | (page only) | (page only) | (page only) | (page only) |
| `diet-nonveg` |  | (page only) | (page only) | (page only) | (page only) | (page only) |
| `ox-dine` | details popover, cart sheet | popover `[933,167.63,335,188]` | popover `[913,167.63,355,188]` | popover `[697,167.63,315,188]` | cart `[380,0,440,1180]`<br>popover `[393,153.63,415,188]` | cart `[0,0,390,844]`<br>popover `[13,153.63,365,188]` |
| `ox-guests-over` | details popover, cart sheet | popover `[933,167.63,335,188]` | popover `[913,167.63,355,188]` | popover `[697,167.63,315,188]` | cart `[380,0,440,1180]`<br>popover `[393,153.63,415,188]` | cart `[0,0,390,844]`<br>popover `[13,153.63,365,188]` |
| `ox-to-take` | toast, details popover, cart sheet | toast `[540.3,738,199.39,38]`<br>popover `[933,167.63,335,144]` | toast `[540.3,738,199.39,38]`<br>popover `[913,167.63,355,144]` | toast `[412.3,706,199.39,38]`<br>popover `[697,167.63,315,144]` | cart `[380,0,440,1180]`<br>toast `[310.3,1050,199.39,38]`<br>popover `[393,153.63,415,144]` | cart `[0,0,390,844]`<br>toast `[95.3,666,199.39,38]`<br>popover `[13,153.63,365,144]` |
| `ox-take` | details popover, cart sheet | popover `[933,167.63,335,144]` | popover `[913,167.63,355,144]` | popover `[697,167.63,315,144]` | cart `[380,0,440,1180]`<br>popover `[393,153.63,415,144]` | cart `[0,0,390,844]`<br>popover `[13,153.63,365,144]` |
| `ox-take-pick` | details popover, cart sheet | popover `[933,167.63,335,144]` | · | · | · | cart `[0,0,390,844]`<br>popover `[13,153.63,365,144]` |
| `ox-delivery` | details popover, cart sheet | popover `[933,167.63,335,98]` | popover `[913,167.63,355,98]` | popover `[697,167.63,315,98]` | cart `[380,0,440,1180]`<br>popover `[393,153.63,415,98]` | cart `[0,0,390,844]`<br>popover `[13,153.63,365,98]` |
| `delivery-new` | customer | `[410,100,460,600]` | `[410,100,460,600]` | `[282,84,460,600]` | `[180,290,460,600]` | `[0,101.28,390,742.72]` |
| `delivery-nocust` | toast, cart sheet | toast `[524.2,738,231.61,38]` | toast `[524.2,738,231.61,38]` | toast `[396.2,706,231.61,38]` | cart `[380,0,440,1180]`<br>toast `[294.2,1050,231.61,38]` | cart `[0,0,390,844]`<br>toast `[79.2,666,231.61,38]` |
| `bill-toggled` | cart sheet | (page only) | (page only) | (page only) | cart `[380,0,440,1180]` | cart `[0,0,390,844]` |
| `disc` | cart sheet | (page only) | (page only) | (page only) | cart `[380,0,440,1180]` | cart `[0,0,390,844]` |
| `svc-removed` | cart sheet | (page only) | (page only) | (page only) | cart `[380,0,440,1180]` | cart `[0,0,390,844]` |
| `take-bill` | cart sheet | (page only) | (page only) | (page only) | cart `[380,0,440,1180]` | cart `[0,0,390,844]` |
| `delivery-bill` | cart sheet | (page only) | (page only) | (page only) | cart `[380,0,440,1180]` | cart `[0,0,390,844]` |
| `note` | toast, cart sheet | toast `[504.94,738,270.13,38]` | toast `[504.94,738,270.13,38]` | toast `[376.94,706,270.13,38]` | cart `[380,0,440,1180]`<br>toast `[274.94,1050,270.13,38]` | cart `[0,0,390,844]`<br>toast `[59.94,666,270.13,38]` |
| `split` | toast, cart sheet | toast `[517.05,738,245.89,38]` | · | · | · | cart `[0,0,390,844]`<br>toast `[72.05,666,245.89,38]` |
| `print-bill` | toast, cart sheet | toast `[565.82,738,148.36,38]` | toast `[565.82,738,148.36,38]` | toast `[437.82,706,148.36,38]` | cart `[380,0,440,1180]`<br>toast `[335.82,1050,148.36,38]` | cart `[0,0,390,844]`<br>toast `[120.82,666,148.36,38]` |
| `kot` | toast, cart sheet | toast `[554.72,738,170.56,38]` | toast `[554.72,738,170.56,38]` | toast `[426.72,706,170.56,38]` | cart `[380,0,440,1180]`<br>toast `[324.72,1050,170.56,38]` | cart `[0,0,390,844]`<br>toast `[109.72,666,170.56,38]` |
| `kot-hover` |  | (page only) | · | · | · | · |
| `pay-hover` |  | (page only) | · | · | · | · |
| `op` | openOrders | `[844,62,420,640]` | `[844,62,420,640]` | `[588,62,420,640]` | `[384,62,420,640]` | `[0,195,390,649]` |
| `op-search` | openOrders | `[844,62,420,271]` | `[844,62,420,271]` | `[588,62,420,271]` | `[384,62,420,271]` | `[0,573,390,271]` |
| `op-none` | openOrders | `[844,62,420,307]` | `[844,62,420,307]` | `[588,62,420,307]` | `[384,62,420,307]` | `[0,537,390,307]` |
| `op-take` | openOrders | `[844,62,420,271]` | `[844,62,420,271]` | `[588,62,420,271]` | `[384,62,420,271]` | `[0,573,390,271]` |
| `op-hover` | openOrders | `[844,62,420,640]` | · | · | · | · |
| `op-hover-new` | openOrders | `[844,62,420,640]` | · | · | · | · |
| `sw-hover` |  | (page only) | · | · | · | · |
| `op-new-take` |  | (page only) | · | · | · | (page only) |
| `cs-search` | customer | `[410,100,460,600]` | `[410,100,460,600]` | `[282,84,460,600]` | `[180,290,460,600]` | `[0,101.28,390,742.72]` |
| `cs-phone` | customer | `[410,100,460,600]` | `[410,100,460,600]` | `[282,84,460,600]` | `[180,290,460,600]` | `[0,101.28,390,742.72]` |
| `cs-phone-part` | customer | `[410,100,460,600]` | · | · | · | `[0,101.28,390,742.72]` |
| `cs-name` | customer | `[410,100,460,600]` | `[410,100,460,600]` | `[282,84,460,600]` | `[180,290,460,600]` | `[0,101.28,390,742.72]` |
| `cs-empty` | customer | `[410,100,460,600]` | `[410,100,460,600]` | `[282,84,460,600]` | `[180,290,460,600]` | `[0,101.28,390,742.72]` |
| `cs-new` | customer | `[410,100,460,600]` | `[410,100,460,600]` | `[282,84,460,600]` | `[180,290,460,600]` | `[0,101.28,390,742.72]` |
| `cs-new-err` | customer | `[410,100,460,600]` | `[410,100,460,600]` | `[282,84,460,600]` | `[180,290,460,600]` | `[0,101.28,390,742.72]` |
| `cs-new-dup` | customer | `[410,100,460,600]` | `[410,100,460,600]` | `[282,84,460,600]` | `[180,290,460,600]` | `[0,101.28,390,742.72]` |
| `cs-new-name` | customer | `[410,100,460,600]` | · | · | · | `[0,101.28,390,742.72]` |
| `cs-new-same` | customer | `[410,100,460,600]` | · | · | · | · |
| `cs-delivery-new` | customer | `[410,100,460,600]` | · | · | · | `[0,101.28,390,742.72]` |
| `cs-addr` | customer, toast | `[410,100,460,600]`<br>toast `[524.2,738,231.61,38]` | `[410,100,460,600]`<br>toast `[524.2,738,231.61,38]` | `[282,84,460,600]`<br>toast `[396.2,706,231.61,38]` | `[180,290,460,600]` | `[0,101.28,390,742.72]` |
| `cs-hover-row` | customer | `[410,100,460,600]` | · | · | · | · |
| `tp` | tablePicker | `[340,44.5,600,711]` | `[340,44.5,600,711]` | `[212,28.5,600,711]` | `[110,234.5,600,711]` | `[0,101.28,390,742.72]` |
| `tp-hover` | tablePicker | `[340,44.5,600,711]` | · | · | · | · |
| `tp-moved` | toast, cart sheet | toast `[548.76,738,182.48,38]` | · | · | · | cart `[0,0,390,844]`<br>toast `[103.76,666,182.48,38]` |
| `tp-busy` | toast | toast `[505.31,738,269.38,38]` | · | · | · | · |
| `modal` | modal | `[420,136,440,528]` | `[420,136,440,528]` | `[292,120,440,528]` | `[190,326,440,528]` | `[0,280,390,564]` |
| `modal-sel` | modal | `[420,136,440,528]` | `[420,136,440,528]` | `[292,120,440,528]` | `[190,326,440,528]` | `[0,280,390,564]` |
| `modal-added` | toast, cart sheet | toast `[547.77,738,184.45,38]` | · | · | · | cart `[0,0,390,844]`<br>toast `[102.77,666,184.45,38]` |
| `modal-noaddons` | modal | `[420,242,440,316]` | `[420,242,440,316]` | `[292,226,440,316]` | `[190,432,440,316]` | `[0,492,390,352]` |
| `modal-oos` |  | (page only) | · | · | · | · |
| `pay` | payment | `[430,148.5,420,503]` | `[430,148.5,420,503]` | `[302,132.5,420,503]` | `[200,338.5,420,503]` | `[0,343,390,501]` |
| `pay-other` | payment | `[430,136,420,528]` | `[430,136,420,528]` | `[302,120,420,528]` | `[200,326,420,528]` | `[0,318,390,526]` |
| `pay-2000` | payment | `[430,148.5,420,503]` | `[430,148.5,420,503]` | `[302,132.5,420,503]` | `[200,338.5,420,503]` | `[0,343,390,501]` |
| `pay-upi` | payment | `[430,202.75,420,394.5]` | `[430,202.75,420,394.5]` | `[302,186.75,420,394.5]` | `[200,392.75,420,394.5]` | `[0,451.5,390,392.5]` |
| `pay-card` | payment | `[430,202.75,420,394.5]` | `[430,202.75,420,394.5]` | `[302,186.75,420,394.5]` | `[200,392.75,420,394.5]` | `[0,451.5,390,392.5]` |
| `pay-split` | payment | `[430,171.5,420,457]` | `[430,171.5,420,457]` | `[302,155.5,420,457]` | `[200,361.5,420,457]` | `[0,389,390,455]` |
| `pay-due` | payment | `[430,202.75,420,394.5]` | `[430,202.75,420,394.5]` | `[302,186.75,420,394.5]` | `[200,392.75,420,394.5]` | `[0,451.5,390,392.5]` |
| `pay-due-nocust` | payment | `[430,202.75,420,394.5]` | `[430,202.75,420,394.5]` | `[302,186.75,420,394.5]` | `[200,392.75,420,394.5]` | `[0,451.5,390,392.5]` |
| `pay-due-nocust-go` | customer | `[410,100,460,600]` | · | · | · | `[0,101.28,390,742.72]` |
| `pay-done` | toast | toast `[466.58,738,346.84,38]` | toast `[466.58,738,346.84,38]` | toast `[338.58,706,346.84,38]` | toast `[236.58,1050,346.84,38]` | toast `[21.58,666,346.84,38]` |
| `pay-short` | payment, toast | `[430,136,420,528]`<br>toast `[518.99,738,242.02,38]` | · | · | · | · |
| `pay-delivery-nocust` | customer, toast | `[410,100,460,600]`<br>toast `[524.2,738,231.61,38]` | · | · | · | `[0,101.28,390,742.72]` |
| `f9` | payment | `[430,148.5,420,503]` | · | · | · | · |
| `f8` | toast | toast `[554.72,738,170.56,38]` | · | · | · | · |
| `confirm-unsent` | confirm, toast | `[430,258.5,420,283]`<br>toast `[524.2,738,231.61,38]` | `[430,258.5,420,283]`<br>toast `[524.2,738,231.61,38]` | `[302,242.5,420,283]`<br>toast `[396.2,706,231.61,38]` | `[200,448.5,420,283]`<br>toast `[294.2,1050,231.61,38]` | `[0,561,390,283]`<br>toast `[79.2,666,231.61,38]` |
| `confirm-unsent-priya` (Priya S.) | confirm | `[430,258.5,420,283]` | · | · | · | `[0,561,390,283]` |
| `approval-clear` (Priya S.) | approval | `[450,128.44,380,543.13]` | `[450,128.44,380,543.13]` | `[322,112.44,380,543.13]` | `[220,318.44,380,543.13]` | `[5,300.88,380,543.13]` |
| `approval-disc` (Priya S.) | approval | `[450,138.22,380,523.56]` | · | · | · | `[5,320.44,380,523.56]` |
| `approval-void` (Priya S.) | approval | `[450,128.44,380,543.13]` | · | · | · | · |
| `approval-typed` (Priya S.) | approval | `[450,128.44,380,543.13]` | · | · | · | `[5,300.88,380,543.13]` |
| `approval-wrong` (Priya S.) | approval | `[450,128.44,380,543.13]` | · | · | · | `[5,300.88,380,543.13]` |
| `approval-meera` (Priya S.) | approval | `[450,128.44,380,543.13]` | · | · | · | · |
| `approval-ok` (Priya S.) | toast, cart sheet | toast `[519.8,738,240.39,38]` | · | · | · | cart `[0,0,390,844]`<br>toast `[74.8,666,240.39,38]` |
| `captain` (Amit V.) |  | (page only) | · | · | · | (page only) |
| `captain-pay` (Amit V.) | toast, cart sheet | toast `[497.15,738,285.7,38]` | · | · | · | cart `[0,0,390,844]`<br>toast `[52.15,666,285.7,38]` |
| `pizza-oos` |  | (page only) | · | · | · | (page only) |
| `photos-edit` |  | (page only) | · | (page only) | · | (page only) |

---

## 16. Reference shots (`D:\kd\pos-dev-keep\ui-redesign\design\spec-shots-pos\`, 344 files)
Names are `<state>-<w>x<h>.png` (`-1280x800-collapsed` for the collapsed nav); the state names are those of `make-shoot-pos.mjs` / §15.2. "×5" = 1280x800, 1280x800-collapsed, 1024x768, 820x1180, 390x844.
- Page: `default` ×5; `cart-open` (820, 390); `empty-new` ×5; `cleared` ×5; `line-selected` ×5; `line-step` ×5; `line-remove` ×5.
- Menu and cards: `pizza` ×5; `pizza-add` ×5; `pizza-hover-card` (1280, 1024); `pizza-hover-price`, `pizza-press-price` (1280); `pizza-oos` (1280, 390); `photos-edit` (1280, 1024, 390); `popular` ×5.
- Categories: `cat-hover` (1280); `cat-find` (1280, collapsed); `cat-find-none` (1280); `cat-sheet` (1024, 820, 390); `cat-sheet-find` (1024, 390).
- Toolbar: `search` ×5; `search-none` ×5; `diet-veg` ×5; `diet-nonveg` ×5.
- Order details: `ox-dine` ×5; `ox-guests-over` ×5; `ox-to-take` ×5; `ox-take` ×5; `ox-take-pick` (1280, 390); `ox-delivery` ×5; `delivery-new` ×5; `delivery-nocust` ×5.
- Footer: `bill-toggled` ×5 (opens the details at 1280 / 1024, closes them at 820 / 390); `disc` ×5; `svc-removed` ×5; `take-bill` ×5; `delivery-bill` ×5; `note` ×5; `split` (1280, 390); `print-bill` ×5; `kot` ×5; `kot-hover`, `pay-hover` (1280).
- Open orders: `op` ×5; `op-search` ×5; `op-none` ×5; `op-take` ×5; `op-hover`, `op-hover-new`, `sw-hover` (1280); `op-new-take` (1280, 390).
- Customer: `cs-search` ×5; `cs-phone` ×5; `cs-phone-part` (1280, 390); `cs-name` ×5; `cs-empty` ×5; `cs-new` ×5; `cs-new-err` ×5; `cs-new-dup` ×5; `cs-new-name` (1280, 390); `cs-new-same` (1280); `cs-delivery-new` (1280, 390); `cs-addr` ×5; `cs-hover-row` (1280).
- Table picker: `tp` ×5; `tp-hover` (1280); `tp-moved` (1280, 390); `tp-busy` (1280).
- Item modal: `modal` ×5; `modal-sel` ×5; `modal-added` (1280, 390); `modal-noaddons` ×5; `modal-oos` (1280: nothing opens).
- Payment: `pay` ×5; `pay-other` ×5; `pay-2000` ×5; `pay-upi` ×5; `pay-card` ×5; `pay-split` ×5; `pay-due` ×5; `pay-due-nocust` ×5; `pay-due-nocust-go` (1280, 390); `pay-done` ×5; `pay-short` (1280); `pay-delivery-nocust` (1280, 390); `f8`, `f9` (1280).
- Confirm and approval: `confirm-unsent` ×5; `confirm-unsent-priya` (1280, 390); `approval-clear` ×5 (Priya); `approval-disc`, `approval-typed`, `approval-wrong`, `approval-ok` (1280, 390); `approval-void`, `approval-meera` (1280); `captain`, `captain-pay` (1280, 390; Amit).

---

## Values I could not determine
- `env(safe-area-inset-bottom)` was 0 in every measurement (cart footer, payment padding, sheet footers, order bar offset); real-device insets were not measured.
- Device-pixel-ratio 2 rendering was not measured: every `1.5px` border (veg marks, customer and table-tile borders, add-on boxes, approval dots) was drawn as 1 px at DPR 1; at DPR 2 Chrome would draw 1.5 px.
- The intended category counts (14.6 #1) and the intended hover colours of category / open-orders rows (14.6 #2) exist only as source values (`c.hover` `var(--surface-2)` / selected `var(--accent-t)`; `r.hover` `var(--hover)` / current `var(--accent-t)`); the mock-up never renders them.
- Item photos: the file has no filled photo slots and the `image-slot` element (the design tool's component) could not load its state file from `file://`; a real photo's look (cover crop inside the 112 / 96 px box, radius 10) is source-only, and the placeholder's own drawing is not part of the app.
- Dark theme: only the light theme was measured (token values for dark are in U0 §1.1).
- Clock-dependent values were measured only at Mon 19 Oct 2026 9:30 PM IST (fixed clock); other times follow the formulas in 0.1.
- Animation in-between frames (`pageIn`, `sheetIn`, `rise` delays, `lineIn`, `pop`, `shake`, `toastIn`) were not measured, only end states; their timing is from the source.
- Pressed (`:active`) looks were measured only on a price button; the others follow the global `scale(.97)` rule and their `style-active` strings (approval keys `var(--surface-3)`).
- A long cart (enough lines to scroll the cart and slide lines under the sticky footer) was not measured; with the demo's 3–4 lines no cart scrolls at the five sizes.
- Hover on the touch viewports was driven with a mouse pointer; a real finger produces no hover.
- What "Send KOT" changes outside this screen (the kitchen ticket `mkTicket(..., 'new')`) and what payment adds to the Orders history are recorded only from the handlers (14.2–14.3), not measured on those pages.
