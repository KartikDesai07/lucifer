# The owner's HTML mock-up, exact values: the Orders screen and every overlay it opens

Source files (read-only, `D:\kd\pos-dev-keep\ui-redesign\design\`): `unpacked/markup.html` (template: Orders screen lines 272–412 — header 274–279, lanes 283–291, phone strip 292–307, toolbar row 308–312, filters popover 313–327, chips 328–331, list head 334, table head 336–338, empty state 339, table row 341–350, card row 351–355, detail scrim 358, detail aside 359–410), `unpacked/app.js` (`ordersVals()` lines 432–513 returning `ov`; demo history `seed()` 414–417; `finish` 402; `pay` 403; `flash` 395; `ask` 193; `openCust` 185; `totals` 401; the `Lay` object = `L` on 742–746 with the `ov*` keys), and the original bundle `olivea-pos-latest.html` (generated hover classes).

The theme tokens, fonts, global rules, keyframes and shared constants are in **U0 values** = `docs/superpowers/specs/2026-10-19-u0-html-values.md` §1; the shell (side nav, rail, tab bar, More/profile sheet, toast) in U0 §2. The payment sheet, table picker, customer sheet, confirm and manager-approval dialogs are in **U1 values** = `docs/superpowers/specs/2026-10-20-pos-html-values.md` §§8, 9, 11, 12. They are referred to by section number and not repeated; this document records only what the Orders screen adds and how those overlays sit over it. Colour tokens are written `var(--x)` with the resolved light value (measured `rgb()`) where it helps; every token's light and dark value is in U0 §1.1.

How values were obtained:
- Every value without a "measured" mark is copied verbatim from the source text (inline `style="…"` strings, `ordersVals()` expressions, handler strings).
- "Measured" values come from rendering `olivea-pos-latest.html` in headless local Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`) driven by playwright-core 1.64 (the npx-cache copy U1 used), every non-`file:`/`data:`/`blob:` request aborted, on 2026-10-22, reading `getBoundingClientRect()` and `getComputedStyle()`. Rects are `[x, y, width, height]` in CSS px (rounded to 0.01). Tool: `D:\kd\pos-dev-keep\ui-redesign\design\measure-orders.mjs`; states: `make-shoot-orders.mjs` → `shoot-orders.json` (76 states, 270 runs = 270 shots; the last six states and the phone re-runs of `sel-dl3` / `sel-new-unsent` are a second pass made on 2026-10-22 after the first pass showed the clipped quick actions, 20 #2–#3); raw results `measure-orders-out\json\<state>-<vp>.json` (named boxes, element trees with computed styles, the live `ordersVals()` result, the generated `scpN` hover rules, and five `elementFromPoint` hit tests for z-order); printer: `summarize-orders.mjs` (`boxes <state> [regex]`, `tree <state> <vp> header|toolbar|list|aside|scrim|ov:<overlay>`, `style`, `meta`, `vals <state> <vp> [key]`, `panels`).
- Viewports (as U0 / U1): `d1280` 1280×800; `c1280` 1280×800 after a click on `button[title='Collapse']`; `t1024` 1024×768 `hasTouch`; `t820` 820×1180 `hasTouch`; `p390` 390×844 `isMobile`+`hasTouch`. **Extra, not one of the five:** `x1600` 1600×900 (plain desktop, nav expanded), run only for `default`, `lane-paid`, `lane-due-filled`, `search` and `captain`, because the table's **Items** column needs `listW ≥ 900` and none of the five viewports reaches it (0.2). Headless Chrome draws no classic scrollbars (as in U0).
- Entry to every state: load, wait 2500 ms, click `text=Rohan K.` (or `Priya S.` / `Amit V.` where a state says so), wait 500 ms, type `1234` (60 ms per key), wait 2800 ms, [collapse], click `nav button[title='Orders']` (phone: the fixed tab bar's button whose text is exactly "Orders"), wait 2300 ms. Rohan (Manager) lands on Dashboard, Priya (Cashier, the locked user) on Order, Amit (Captain) on Floor; all three are then taken to Orders the same way. Then the state's actions (each click is a real mouse click at the element's centre; selects are changed with `selectOption`), then the pointer is parked 21 px into the page header's left edge (y 28; nothing there has a hover look) unless the state measures a hover, then 900 ms, then shot + measurement.
- States that need data the demo lacks were made with the mock-up's own controls inside the page (a Due bill: Table 4 → Settle & pay → Due → "Add ₹954 to dues"; a split bill: Table 6 → Split → "Complete split payment"; a cancelled order: Table 7 → "Cancel this order"; a refund: Paid → Table 12 → "Refund this bill"; an order with nothing sent: header "New order" → first price button → back to Orders). Nothing was written outside the page.

---

## 0. Conventions for this screen

### 0.1 Clock used
`Date` fixed with `page.clock.setFixedTime(new Date("2026-10-19T21:30:00+05:30"))` = **Monday 19 October 2026, 9:30 PM IST** (same as U1 §0.1). Clock-dependent values on this screen and their formulas:
- Open-order times: `time = hm(opened)`; age `m = max(1, round((now − opened)/60000))`; row text `age = 'Open '+(m<60 ? m+' min' : floor(m/60)+'h '+(m%60)+'m')`, card text `ageShort` = the same without "Open "; colour `ageC = m>=60 ? var(--bad-i) : m>=30 ? var(--warn-i) : var(--text-3)`, weight `ageW = m>=30 ? 600 : 400`. Demo: Table 1 8:22 PM "Open 1h 8m" (bad-i, 600); Table 17 8:35 PM 55 min, Table 6 8:49 PM 41 min, Table 4 8:58 PM 32 min (warn-i, 600); Table 13 9:08 PM 22 min, Table 7 9:16 PM 14 min, Delivery 3 9:21 PM 9 min, Takeaway 14 9:24 PM 6 min (text-3, 400).
- Closed rows (history): `time = hm(at)`; `age` = `'Today'` when `at ≥` today's midnight, else `toLocaleDateString('en-IN',{day:'numeric',month:'short'})`; `ageShort = hm(at)` (so a card shows the clock time where an open card shows the age); colour `var(--text-3)`, weight 400. Seed (`AGO(m)` at load): #1031 Table 3 7:00 PM (150 min ago), #1032 Takeaway 8 7:22 PM, #1033 Delivery 1 7:40 PM, #1034 Table 9 7:55 PM, #1035 Table 12 8:16 PM — all "Today".
- Detail meta clock: open → `hm(at)+' · '+agT` (`agT` as `ageShort`), colour/weight as above (e.g. "8:22 PM · 1h 8m" bad-i 600, "8:58 PM · 32 min" warn-i 600, "9:16 PM · 14 min" text-2 400); closed → `hm(at)` only.
- Date filter `inDate(at)`: `today` → `at ≥ d0` (local midnight); `yesterday` → `d0−24h ≤ at < d0`; `week` → `at ≥ d0 − 6×24h`; `all` → always. **Open orders are always kept whatever the date** (`inDate(r.at) || r.kind==='open'`).
- `s.now` refreshes only when 30 s have passed (U1 §0.1); a payment / cancel made during a state is stamped `Date.now()` = 9:30 PM.

### 0.2 Breakpoint variables and the list width
`ph`, `tab`, `desk`, `wide`, `cmp`, `big` exactly as U0 §0.1. This screen adds (ordersVals line 433, 512):
- `listW = s.w − (ph ? 0 : (wide ? 232 : 76)) − (big ? 400 : 0) − (ph ? 24 : 40)` — the list column's inner width (window − nav − detail column − list padding).
- `table = listW ≥ 700` (list drawn as a table with a header row; rows carry Settle / Collect buttons) — else **cards**.
- Items column `itemsD = listW ≥ 900 ? 'block' : 'none'` (table header cell and row cell).
- `phoneLanes = listW < 560` → the lanes are drawn as the **phone strip** (tabs + current-lane row) instead of four cards.
- `big = s.w ≥ 1024` → the detail is a **400 px right column**; below 1024 it is a **sheet over a scrim**.

| | d1280 | c1280 | t1024 | t820 | p390 | x1600 (extra) |
|---|---|---|---|---|---|---|
| `listW` (computed = measured list inner width) | 608 | 764 | 508 | 704 | 366 | 928 |
| list form | **cards** | table | cards | table | cards | table |
| Items column | – | no | – | no | – | **yes** |
| lanes form | 4 cards | 4 cards | **strip** | 4 cards | **strip** | 4 cards |
| detail | column 400 | column 400 | column 400 | sheet 440 (right) | sheet full screen | column 400 |

So, at the five target sizes, the 1280 desktop with the nav expanded gets **cards** (608 < 700) while the 1280 collapsed desktop and the 820 tablet get the **table**, and the Items column never shows (see 20 #1).

### 0.3 `L` keys used by this screen, resolved

| Key | Expression (verbatim) | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|---|
| `headPad` | `ph?'0 12px':'0 20px'` | `0 20px` | same | same | same | `0 12px` |
| `miniLogo` | `ph?'flex':'none'` | none | none | none | none | flex |
| `ovCols` | `big?'minmax(0,1fr) 400px':'minmax(0,1fr)'` | `648px 400px` (measured) | `804px 400px` | `548px 400px` | `744px` | `390px` |
| `toolPad` | `ph?'10px 12px 4px':'14px 20px 4px'` — then the element's own `padding-bottom:12px` wins | `14px 20px 12px` (measured) | same | same | same | `10px 12px 12px` |
| `listPad` | `ph?'14px 12px':'16px 20px'` — then `padding-top:0` and `padding-bottom:{{ L.screenPadB }}` win | `0 20px 28px` (measured) | same | same | same | `0 12px 92px` |
| `screenPadB` | `ph?'92px':'28px'` (U0 §2.1) | 28px | 28px | 28px | 28px | 92px |
| `ovDPos` | `big?'relative':'fixed'` | relative | relative | relative | fixed | fixed |
| `ovDInset` | `big?'auto':(ph?'0':'0 0 0 auto')` | auto | auto | auto | `0 0 0 auto` | `0` |
| `ovDW` | `big?'auto':(ph?'100%':'min(440px,100%)')` | auto | auto | auto | `min(440px,100%)` | `100%` |
| `ovDZ` | `big?'1':'30'` | 1 | 1 | 1 | 30 | 30 |
| `ovDSh` | `big?'none':'var(--pop)'` | none | none | none | `var(--pop)` | `var(--pop)` |
| `ovClose` | `big?'none':'flex'` (detail ✕) | none | none | none | flex | flex |
| `cartFootB` | `ph?'calc(12px + env(safe-area-inset-bottom))':'14px'` (detail foot bottom padding) | 14px | 14px | 14px | 14px | 12px (inset 0) |
| `toastB` | U0 §2.1 | 24px | 24px | 24px | 92px | 140px |
| `sheetAlign` / `sheetPad` / `sheetRadius` | U0 §2.1 (payment, approval) | center / 16px / 14px | same | same | same | flex-end / 0 / `14px 14px 0 0` |

`ov.L` (ordersVals line 512), resolved:

| Key | Expression | d1280 | c1280 | t1024 | t820 | p390 | x1600 |
|---|---|---|---|---|---|---|---|
| `qBasis` (search `flex-basis`) | `ph?'0px':'220px'` | 220px | 220px | 220px | 220px | 0px | 220px |
| `dateD` (date select) | `ph?'none':'flex'` | flex | flex | flex | flex | none | flex |
| `fLblD` ("Filters" word) | `ph?'none':'inline'` | inline | inline | inline | inline | none | inline |
| `cardsG` (lane cards) | `phoneLanes?'none':'grid'` | grid | grid | none | grid | none | grid |
| `stripF` (phone strip) | `phoneLanes?'flex':'none'` | none | none | flex | none | flex | none |
| `lanes` | `'repeat(4,minmax(0,1fr))'` | | | | | | |
| `tableG` (table head + table rows) | `table?'grid':'none'` | none | grid | none | grid | none | grid |
| `cardF` (card rows) | `table?'none':'flex'` | flex | none | flex | none | flex | none |
| `itemsD` | `listW>=900?'block':'none'` | none | none | none | none | none | block |
| `cols` | `'minmax(150px,1.3fr) minmax(110px,1fr)'+(listW>=900?' minmax(140px,1.4fr)':'')+' 92px 124px 92px 84px'` | (unused) | `157.125px 120.875px 92px 124px 92px 84px` (measured) | (unused) | `150px 110px 92px 124px 92px 84px` | (unused) | `151.078px 116.219px 162.703px 92px 124px 92px 84px` |

Both row forms are always in the DOM (one `display:none`), so every row exists twice.

### 0.4 Screen state (component `state`) and defaults
`oTab` ('open' | 'paid' | 'due' | 'cancel', default 'open'), `oSel` (row key, default null), `oQ` (search text, default ''), `oType` ('All'), and — not in the initial state, so `undefined` until first set — `oDate` (default `'today'`), `oPay` (`'All'`), `oTbl` (`'All'`), `oFOpen` (popover, false). Row keys: open `'o'+no`, closed `'h'+no+'-'+at`. Nothing on this screen is kept across a reload.

### 0.5 Rendering conventions (as U0 §0.2–§0.4 and U1 §0.5, plus what this screen adds)
- Interpolations are `<span class="sc-interp">` wrappers. In flex containers the binding and the literal text are separate flex items with the container gap between them: lane head (dot · 7 · label), strip tab top (dot · 5 · count), status pills (dot · 6 · status), filter chips (label · 6 · ✕ circle), detail meta items (icon · 5 · text), quick actions (icon · 5 · label, column), danger (icon · 6 · label), foot "Edit items" (icon · 7 · label).
- `line-height: normal` = 1.3 × font-size (U0 §0.3). Text-box heights measured here: 11px→14, 11.5px→15, 12px→16, 12.5px→17, 13px→17, 13.5px→18, 14px→18, 14.5px→19, 15px→19, 17px→22, 18px→23, 22px→28. Explicit line-heights: header title 1.2 (15px → 18), strip tab count 1 (19px → 19).
- Buttons with no `padding` keep the UA `1px 6px` (printer button, Edit items, Settle & pay); buttons with no `font-size` compute 13.3333px (lane cards, strip tabs, printer button: only their unstyled wrapper; every visible text has its own size).
- **Hover strings with a binding are empty** (U1 §0.5): the table row's `style-hover="background:{{ r.hov }}"` becomes the measured rule `.scpc:hover { }` — **table rows have no hover look** although `r.hov` is computed (`var(--hover)`, selected `var(--accent-t)`). Card rows have no hover attribute at all. Static hover strings on this screen (measured rule text): lane card and Filters button `.scpb:hover{border-color:var(--text-3) !important}`; New order and Settle & pay `.scp3:hover{background:var(--accent-h) !important}`; printer button, "+ Add customer", quick actions, Edit items `.scp4:hover{background:var(--hover) !important}`; danger link `.scp9:hover{background:var(--bad-t) !important}`; row Settle / Collect `.scpd:hover{background:var(--ink) !important;color:var(--on-ink) !important;border-color:var(--ink) !important}`. The strip tabs, strip action, filter options, chips, Clear all, Reset, Done, search ✕ and detail ✕ have no hover rule.
- **Buttons drawn `display:flex` without `align-items`** keep their text at the top of the box: the row **Settle / Collect** button (32 tall: text box measured `y 301–318` inside `300–332`, 6.5 px above centre) and the strip action (30 tall: text `125–142` inside `125–155`). See 20 #4.
- `1.5px dashed` rules (the two dividers in the items box) compute to 1 px at DPR 1 (U1 §0.5).
- Selects are native `<select>` elements with `appearance:none` and a drawn chevron; their open list is the browser's own and was not measured.

---

## 1. Page container and header

### 1.1 Page container (`sc-if on.orders`)
`div data-screen-label="Orders"`: `display:{{ S.orders }}` (`flex` on route `orders`); `flex-direction:column; min-width:0; min-height:0; overflow:hidden; animation:pageIn .4s cubic-bezier(.2,.8,.2,1) backwards`. The page itself does not scroll: the header is `flex:none`, the body below scrolls in parts (the list scroller and the detail body). Measured: d1280 `[232,0,1048,800]`, c1280 `[76,0,1204,800]`, t1024 `[76,0,948,768]`, t820 `[76,0,744,1180]`, p390 `[0,0,390,844]`, x1600 `[232,0,1368,900]`.

### 1.2 Header elements (verbatim)
| Element | Properties |
|---|---|
| header | `flex:none; display:flex; align-items:center; gap:12px; padding:{{ L.headPad }}; min-height:56px; background:var(--surface); border-bottom:1px solid var(--border)`. Not sticky (no `position`). Note the gap is 12 (the dashboard header's is 10, U0 §2.5). |
| Mini logo | as U0 §2.5 (phone only, 30×30, radius 8, `var(--brand)`, Shrikhand 19px "O", `padding-top:2px`), `flex:none`. |
| Title block | `div style="flex:1;min-width:0"`. Title "Orders": `font-weight:600; font-size:15px; line-height:1.2` (h 18). Subtitle `{{ ov.sub }}`: `font-size:12px; color:var(--text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis` (h 16). |
| New order | `button` click `newOrder` (U1 §14.2: new Takeaway, route `order`): `border:0; background:var(--accent); color:var(--on-accent); border-radius:8px; height:36px; padding:0 14px; font-weight:600; font-size:13.5px; cursor:pointer; white-space:nowrap; display:flex; align-items:center; gap:6px; flex:none`; hover `background:var(--accent-h)`. Plus icon `svg 14×14 stroke-width 2.4 stroke-linecap round` (no linejoin), path `M12 5v14M5 12h14`. Label "New order" (always shown, also on the phone: unlike the dashboard's, it has no `wideI` switch). No `title`. |
| Printer | as U0 §2.5 (36×36, radius 8, `pr.title`, status dot 10×10 `pr.dot` at top/right −3 with `0 0 0 2px var(--surface)` ring; demo `var(--ok)` `rgb(36,161,72)`). |

`ov.sub` = `oL.length+' open · '+RS(sum(oL))+'  ·  '+pL.length+' paid · '+RS(sum(paid, refunded excluded))+(dueTot ? '  ·  '+RS(dueTot)+' due' : '')` — written with two spaces around the middle dots; rendered with one (white-space collapses). Demo "8 open · ₹5,740 · 5 paid · ₹3,931"; with the made Due bill "7 open · ₹4,786 · 5 paid · ₹3,931 · ₹954 due". It counts the whole day whatever the lane, search, filters or date (`oL/pL/dL` come from `all`, which applies only the date rule).

### 1.3 Measured header (state `default`)
| Element | d1280 | c1280 | t1024 | t820 | p390 | x1600 |
|---|---|---|---|---|---|---|
| header | `[232,0,1048,56]` | `[76,0,1204,56]` | `[76,0,948,56]` | `[76,0,744,56]` | `[0,0,390,56]` | `[232,0,1368,56]` |
| mini logo | hidden | hidden | hidden | hidden | `[12,12.5,30,30]` | hidden |
| title block | `[252,10.5,833.31,34]` | `[96,10.5,989.31,34]` | `[96,10.5,733.31,34]` | `[96,10.5,529.31,34]` | `[54,10.5,149.31,34]` | `[252,10.5,1153.31,34]` |
| "Orders" | `[252,10.5,833.31,18]` | `[96,10.5,…,18]` | `[96,10.5,…,18]` | `[96,10.5,…,18]` | `[54,10.5,149.31,18]` | `[252,10.5,…,18]` |
| subtitle | `[252,28.5,833.31,16]` (text 175.41 wide) | `[96,28.5,…,16]` | `[96,28.5,…,16]` | `[96,28.5,…,16]` | `[54,28.5,149.31,16]` **ellipsised** "8 open · ₹5,740 · 5 paid · …" | `[252,28.5,…,16]` |
| New order | `[1097.31,9.5,114.69,36]` (icon `[1111.31,20.5,14,14]`) | same | `[841.31,9.5,114.69,36]` | `[637.31,9.5,114.69,36]` | `[215.31,9.5,114.69,36]` (icon `[229.31,20.5,14,14]`) | `[1417.31,9.5,114.69,36]` |
| printer | `[1224,9.5,36,36]` (dot `[1252,7.5,10,10]`) | same | `[968,9.5,36,36]` | `[764,9.5,36,36]` | `[342,9.5,36,36]` (dot `[370,7.5,10,10]`) | `[1544,9.5,36,36]` |

Gaps: title block → 12 → New order → 12 → printer → 20 (12 on the phone) right padding. Colours: title `rgb(24,24,27)` (`--text`), subtitle `rgb(82,82,91)` (`--text-2`), New order `rgb(15,98,254)` bg / white text.

---

## 2. Body grid and the list column

### 2.1 Body
`div`: `flex:1; min-height:0; display:grid; grid-template-columns:{{ L.ovCols }}`. Children in order: the list column `div`, [detail scrim, `sc-if ov.scrim`], the detail `aside` (section 11). Measured body: d1280 `[232,56,1048,744]` cols `648px 400px`; c1280 `[76,56,1204,744]` `804px 400px`; t1024 `[76,56,948,712]` `548px 400px`; t820 `[76,56,744,1124]` `744px`; p390 `[0,56,390,788]` `390px`; x1600 `[232,56,1368,844]` `968px 400px`. Below 1024 the aside is `position:fixed`, so it takes no grid track.

### 2.2 List column
`div`: `display:flex; flex-direction:column; min-width:0; min-height:0`. Two children: the top block (lanes / strip, toolbar row, filters popover, chips — section 3–6) and the list scroller (sections 7–9).
- Top block `div`: `flex:none; padding:{{ L.toolPad }}; padding-bottom:12px; display:flex; flex-direction:column; gap:12px`. Measured (state `default`): d1280 `[232,56,648,170]`, c1280 `[76,56,804,170]`, t1024 `[76,56,548,175]` (the strip is 5 px taller than the cards), t820 `[76,56,744,170]`, p390 `[0,56,390,171]`, x1600 `[232,56,968,170]`. Its children: lane cards `div` (always present, `display:{{ ov.L.cardsG }}`), strip `div` (`display:{{ ov.L.stripF }}`), toolbar row, [popover], chips row (`display:{{ ov.chipsD }}`); the hidden ones take no gap.
- List scroller `div`: `flex:1; overflow-y:auto; overflow-x:hidden; padding:{{ L.listPad }}; padding-top:0; padding-bottom:{{ L.screenPadB }}`. Measured (state `default`): d1280 `[232,226,648,574]`, c1280 `[76,226,804,574]`, t1024 `[76,231,548,537]`, t820 `[76,226,744,954]`, p390 `[0,227,390,617]`, x1600 `[232,226,968,674]`. The list head and the list box scroll together inside it (no sticky head). On the phone the fixed tab bar (59 tall, U0 §2.6) covers the scroller's last 59 px; the 92 px bottom padding keeps the last row clear of it.

---

## 3. Lanes: four cards (`listW ≥ 560`) and the phone strip (`listW < 560`)

### 3.1 Lane values (`LN(k,label,dot,arr,amt,sub,subC)`, ordersVals 502–507)
`on = !q && lane===k` (no lane is "on" while searching). Per lane:

| Lane (`k`) | label | dot | count | amount | sub (`subC`) |
|---|---|---|---|---|---|
| `open` | Open | `var(--info)` | open orders with lines | `RS(Σ totals)` | `billedN ? billedN+(billedN>1?' bills':' bill')+' waiting to be paid' : (lateN ? lateN+' open 30+ min' : 'All in service')`; colour `var(--warn-i)` when `billedN‖lateN`, else `var(--text-3)` |
| `paid` | Paid | `var(--ok)` | paid history rows (incl. refunded) | `RS(Σ total of non-refunded)` | `pL.length ? 'Avg '+RS(Σ total of all paid incl. refunded / pL.length)+' per bill' : 'No payments '+dLabel`; `var(--text-3)` |
| `due` | Due | `var(--bill)` | due rows | `RS(Σ due)` | `dL.length ? 'To collect from customers' : 'Nothing to collect'`; `var(--bill-i)` when any, else `var(--text-3)` |
| `cancel` | Cancelled | `var(--bad)` | cancelled rows | `RS(Σ total)` | `cL.length ? 'Not charged' : 'None '+dLabel`; `var(--text-3)` |

`dLabel` = `{today:'today', yesterday:'yesterday', week:'in the last 7 days', all:''}[oDate]` (with "All dates" the subs read "No payments " / "None " with a trailing space). `lateN` = open orders `≥ 30 min` old. Demo (state `default`): Open "8" "₹5,740" "1 bill waiting to be paid" (warn-i `rgb(186,78,0)`); Paid "5" "₹3,931" "Avg ₹786 per bill"; Due "0" "₹0" "Nothing to collect"; Cancelled "0" "₹0" "None today". Clicking a lane (card or strip tab) → `oTab:k, oSel:null, oQ:''` (also clears the search).

### 3.2 Lane cards (verbatim)
| Element | Properties |
|---|---|
| Grid | `div`: `display:{{ ov.L.cardsG }}; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px`. |
| Card | `button` click `c.pick`: `display:flex; flex-direction:column; align-items:flex-start; gap:3px; min-width:0; padding:11px 14px 12px; border:1px solid {{ c.bd }}; box-shadow:{{ c.ring }}; border-radius:12px; background:var(--surface); color:var(--text); text-align:left; cursor:pointer`; hover `border-color:var(--text-3)`. On: `bd var(--text)` + `ring 0 0 0 1px var(--text)` (a 2 px dark outline, measured `rgb(24,24,27)` border + `rgb(24,24,27) 0 0 0 1px` shadow); off: `var(--border)`, none. |
| · head | `span`: `display:flex; align-items:center; gap:7px; font-size:12.5px; font-weight:500; color:var(--text-2)`; dot `span` `8×8; border-radius:50%; background:{{ c.dot }}`; then `{{ c.label }}`. |
| · number row | `span`: `display:flex; align-items:baseline; gap:8px; min-width:0; max-width:100%`: count `span` `font-size:22px; font-weight:600; letter-spacing:-.02em` (−0.44px); amount `span` `font-family:'Geist Mono',ui-monospace,monospace; font-size:13px; color:var(--text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis`. |
| · sub | `span`: `font-size:12px; color:{{ c.subC }}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%`. |

Measured (state `default`):
| Element | d1280 | c1280 | t820 | x1600 |
|---|---|---|---|---|
| grid | `[252,70,608,92]` | `[96,70,764,92]` | `[96,70,704,92]` | `[252,70,928,92]` |
| card 1–4 (x) | 146×92 at x 252 / 406 / 560 / 714 | 185×92 at x 96 / 289 / 482 / 675 | 170×92 at x 96 / 274 / 452 / 630 | 226×92 at x 252 / 486 / 720 / 954 |
| head (Open) | `[267,82,46.33,17]` (dot `[267,86.5,8,8]`, label x 282) | x 111 | x 111 | x 267 |
| number row | `[267,102,68.11,28]`: count `[267,102,13.3,28]`, amount `[288.3,111,46.81,17]` | x 111 | x 111 | x 267 |
| sub | `[267,133,116,16]` — **ellipsised** ("1 bill waiting to be …", text 127.11) | `[111,133,127.11,16]` | `[111,133,127.11,16]` | `[267,133,127.11,16]` |

Vertical rhythm inside a card: border 1 + padding 11 → head 17 → 3 → number row 28 → 3 → sub 16 → padding 12 + border 1 = 92.

### 3.3 Phone strip (verbatim; t1024 and p390)
| Element | Properties |
|---|---|
| Frame | `div`: `display:{{ ov.L.stripF }}; flex-direction:column; background:var(--surface); border:1px solid var(--border); border-radius:14px; overflow:hidden`. |
| Tabs | `div role="tablist"`: `display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border-bottom:1px solid var(--border-2)`. |
| Tab | `button role="tab" aria-selected="{{ c.on }}"` click `c.pick`: `position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; min-width:0; height:50px; border:0; background:{{ c.tabBg }}; color:var(--text); cursor:pointer; padding:0 2px`. `tabBg` on `var(--surface)` (white) / off `var(--surface-2)` (`rgb(250,250,250)`). No hover. |
| · top | `span` `display:flex; align-items:center; gap:5px`: dot `7×7` round `{{ c.dot }}`; count `span` `font-size:19px; font-weight:600; letter-spacing:-.02em; line-height:1; color:{{ c.numC }}` (on `var(--text)`, off `var(--text-2)`). |
| · label | `span`: `font-size:11.5px; font-weight:{{ c.fw }}; color:{{ c.lblC }}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%` (on 600 `var(--text)`, off 500 `var(--text-3)`). |
| · bar | `span`: `position:absolute; left:14%; right:14%; bottom:0; height:3px; border-radius:3px 3px 0 0; background:{{ c.dot }}; opacity:{{ c.barOp }}` (1 on, 0 off) — the bar takes the lane's own colour. |
| Current-lane row | `div`: `display:flex; align-items:center; gap:10px; padding:7px 12px; min-width:0`: amount `span` `flex:none; font-family:'Geist Mono',…; font-size:17px; font-weight:600; letter-spacing:-.02em` (−0.34px) `{{ ov.cur.amt }}`; sub `span` `flex:1; min-width:0; font-size:12.5px; color:{{ ov.cur.subC }}; font-weight:500; nowrap; ellipsis` `{{ ov.cur.sub }}`; action `button` `display:{{ ov.cur.actD }}; flex:none; height:30px; padding:0 11px; border:0; border-radius:8px; background:var(--ink); color:var(--on-ink); font-size:12.5px; font-weight:600; cursor:pointer; white-space:nowrap` `{{ ov.cur.actL }}` (no hover; text top-aligned, 0.5). |

`ov.cur` (ordersVals 509–511): searching → `amt = rows.length+' found'`, `sub 'Searching all orders'` (`var(--text-3)`), no action; else `amt/sub/subC` of the current lane, action: open lane with a billed order and the user not a Captain → `'Settle '+firstBilled.id.replace('Table ','T')` ("Settle T1"; a takeaway would read "Settle Takeaway 14") → `settle(i)` (payment sheet); due lane with a due bill → "Collect" → **only selects the first due bill** (`oSel = firstDue.key`, opening its detail; it does not collect); otherwise hidden.

Measured (state `default`):
| Element | t1024 | p390 |
|---|---|---|
| frame | `[96,70,508,97]` | `[12,66,366,97]` |
| tabs | `[97,71,506,51]` (columns `126.5px ×4`) | `[13,67,364,51]` (`91px ×4`) |
| tab 1–4 | 126.5×50 at x 97 / 223.5 / 350 / 476.5 | 91×50 at x 13 / 104 / 195 / 286 |
| tab 1 top / count / label / bar | `[148.5,78,23.48,19]` / `[160.5,78,11.48,19]` / `[145.55,99,29.41,15]` / `[114.7,118,91.09,3]` | `[46.75,74,23.48,19]` / `[58.75,74,11.48,19]` / `[43.8,95,29.41,15]` / `[25.73,114,65.53,3]` |
| current row | `[97,122,506,44]`: amount `[109,133,59.17,22]`, sub `[178.17,135.5,326.63,17]`, "Settle T1" `[514.8,129,76.2,30]` | `[13,118,364,44]`: amount `[25,129,59.17,22]`, sub `[94.17,131.5,184.63,17]`, "Settle T1" `[288.8,125,76.2,30]` |

---

## 4. Toolbar row: search, date, Filters

### 4.1 Elements (verbatim)
| Element | Properties |
|---|---|
| Row | `div`: `display:flex; flex-wrap:wrap; gap:8px`. |
| Search box | `div`: `flex:1 1 {{ ov.L.qBasis }}; display:flex; align-items:center; gap:8px; background:var(--surface); border:1px solid var(--border); border-radius:9px; padding:0 10px; height:40px; min-width:0`. Icon `svg 15×15 stroke-width 2 stroke-linecap round; color:var(--text-3); flex:none` (circle cx 11 cy 11 r 7 + path `m20 20-3.5-3.5`). |
| · input | `input value="{{ ov.q }}" placeholder="Search order no., table, name or phone"` (change on every keystroke → `oQ`, `oSel:null`): `border:0; outline:0; flex:1; font-family:inherit; font-size:14px; background:transparent; color:var(--text); min-width:0` (UA padding `1px 2px`, height 20). No focus ring on the box. 14px also on the phone (iOS zooms below 16px; U1 §14.6 #9). |
| · clear | `button title="Clear search"` click `clearQ` (`oQ:''`): `display:{{ ov.qClearD }}` (`flex` when the trimmed query is non-empty); `width:24px; height:24px; flex:none; border:0; border-radius:50%; background:var(--surface-3); color:var(--text-2); font-size:11px; cursor:pointer; align-items:center; justify-content:center`; text "✕". |
| Date select | `label`: `flex:0 1 160px; min-width:130px; position:relative; display:{{ ov.L.dateD }}` (hidden on the phone: the Date group moves into the popover, 5). `select` (`value {{ ov.fDate.v }}`, change → `oDate`, `oSel:null`): `appearance:none; width:100%; height:40px; padding:0 32px 0 12px; border:1px solid var(--border); border-radius:9px; background:var(--surface); color:var(--text); font-family:inherit; font-size:13.5px; font-weight:500; cursor:pointer; outline:0`. Options `today` Today · `yesterday` Yesterday · `week` Last 7 days · `all` All dates. Chevron `svg 14×14 stroke-width 2` path `m6 9 6 6 6-6`, `position:absolute; right:11px; top:13px; color:var(--text-2); pointer-events:none`. |
| Filters | `button` click `toggleF` (`oFOpen` toggles): `flex:none; display:flex; align-items:center; gap:8px; height:40px; padding:0 13px; border:1px solid {{ ov.fBtnBd }}; border-radius:9px; background:{{ ov.fBtnBg }}; color:var(--text); font-size:13.5px; font-weight:500; cursor:pointer`; hover `border-color:var(--text-3)`. `fBtnBd = (oFOpen ‖ chips.length) ? var(--text) : var(--border)`; `fBtnBg = var(--surface)`. Icon `svg 15×15 stroke-width 1.9 linecap round` path `M4 6h16M7 12h10M10 18h4`. Label `span display:{{ ov.L.fLblD }}` "Filters" (icon only on the phone). Count `span display:{{ ov.fCountD }}`: `min-width:19px; height:19px; padding:0 5px; border-radius:10px; background:var(--accent); color:var(--on-accent); font-size:11px; font-weight:700; align-items:center; justify-content:center`; `{{ ov.fCount }}` = number of chips (6). |

### 4.2 Measured (state `default`)
| Element | d1280 | c1280 | t1024 | t820 | p390 | x1600 |
|---|---|---|---|---|---|---|
| row | `[252,174,608,40]` | `[96,174,764,40]` | `[96,179,508,40]` | `[96,174,704,40]` | `[12,175,366,40]` | `[252,174,928,40]` |
| search box | `[252,174,341.7,40]` | `[96,174,497.7,40]` | `[96,179,241.7,40]` | `[96,174,437.7,40]` | `[12,175,315,40]` | `[252,174,661.7,40]` |
| · icon | `[263,186.5,15,15]` | `[107,186.5,15,15]` | `[107,191.5,15,15]` | `[107,186.5,15,15]` | `[23,187.5,15,15]` | `[263,186.5,15,15]` |
| · input | `[286,184,296.7,20]` | `[130,184,452.7,20]` | `[130,189,196.7,20]` (placeholder cut: "Search order no., table, name c") | `[130,184,392.7,20]` | `[46,185,270,20]` | `[286,184,616.7,20]` |
| date select | `[601.7,174,160,40]` (chevron `[736.7,187,14,14]`) | same | `[345.7,179,160,40]` | `[541.7,174,160,40]` | hidden | `[921.7,174,160,40]` |
| Filters | `[769.7,174,90.3,40]` (icon `[783.7,186.5,15,15]`, label `[806.7,185,39.3,18]`) | same | `[513.7,179,90.3,40]` | `[709.7,174,90.3,40]` | `[335,175,43,40]` (icon `[349,187.5,15,15]`) | `[1089.7,174,90.3,40]` |

With no filter the row stays on one line at every size. **At t1024 it wraps as soon as the count badge shows** (state `filter-chip`: 220 + 8 + 160 + 8 + 117.3 = 513.3 > 508, so the Filters button drops to a second line `[96,227,117.3,40]` and the top block grows from 175 to 263). Placeholder colour `var(--text-3)` (U0 §1.4).

With one chip (state `filter-chip`) the Filters button is `[742.7,174,117.3,40]` at d1280 / c1280 (border `rgb(24,24,27)` = `var(--text)`; count badge `[827,184.5,19,19]` "1", `rgb(15,98,254)` bg, white 11px/700), t820 `[682.7,174,117.3,40]`, p390 `[308,175,70,40]` (icon `[322,187.5,15,15]`, badge `[345,185.5,19,19]`); the search box shrinks by the same 27 px.

---

## 5. Filters popover (`sc-if ov.fOpen` = `s.oFOpen`)

Opened and closed by the Filters button (`toggleF`) and closed by **Done**. It is **in the page flow** (no `position`), inserted between the toolbar row and the chips row: it pushes the list down instead of floating over it. No scrim, no outside-click close, no Escape handling (the global Escape list in U1 §13.2 does not include `oFOpen`).

### 5.1 Elements (verbatim)
| Element | Properties |
|---|---|
| Panel | `div`: `background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:14px; animation:rise .25s cubic-bezier(.2,.8,.2,1) both`. No shadow. |
| Group (per `ov.fGroups`) | `div` `display:flex; flex-direction:column; gap:8px`: label `span` `font-size:11.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--text-3)` (0.69px; `{{ g.label }}`); options `div` `display:flex; flex-wrap:wrap; gap:6px` with `button` per option: `height:32px; padding:0 12px; border-radius:999px; border:1px solid {{ o.bd }}; background:{{ o.bg }}; color:{{ o.color }}; font-size:13px; font-weight:500; cursor:pointer; white-space:nowrap`. Selected (`OPT`): `bd var(--ink)`, `bg var(--ink)`, `color var(--on-ink)` (black pill, white text); others `var(--border)` / `var(--surface)` / `var(--text)`. No hover. |
| Groups | Phone only first: **Date** (`today` Today, `yesterday` Yesterday, `week` Last 7 days, `all` All dates → `oDate`). Then **Order type** (`All` All types, `Dine-in`, `Takeaway`, `Delivery` → `oType`) and **Payment** (`All` Any, `Cash`, `UPI`, `Card`, `Split`, `Due` → `oPay`). Picking sets the key and `oSel:null`; the popover stays open. |
| Table group | `div` `display:flex; flex-direction:column; gap:8px`: label "Table" (same style); `label` `position:relative; display:flex; max-width:260px` holding `select` (`value {{ ov.fTbl.v }}`, change → `oTbl`, `oSel:null`): `appearance:none; width:100%; height:38px; padding:0 32px 0 12px; border:1px solid var(--border); border-radius:9px; background:var(--surface); color:var(--text); font-family:inherit; font-size:13.5px; cursor:pointer; outline:0` (weight 400, unlike the date select's 500); chevron 14×14 at `right:11px; top:12px; color:var(--text-2)`. Options: `All` All tables, `Takeaway`, `Delivery`, then `Table 1` … `Table 22` (all `TABLES`: Indoor 1–12, Patio 13–18, Rooftop 19–22). |
| Footer | `div` `display:flex; justify-content:flex-end; gap:8px; border-top:1px solid var(--border-2); padding-top:12px`: **Reset** `button` (click `ov.clear`) `height:34px; padding:0 12px; border:0; background:transparent; color:var(--text-2); font-size:13px; font-weight:500; cursor:pointer`; **Done** `button` (click `toggleF`) `height:34px; padding:0 16px; border:0; border-radius:8px; background:var(--ink); color:var(--on-ink); font-size:13px; font-weight:600; cursor:pointer`. |

`ov.clear` (Reset and "Clear all") = `oType:'All', oPay:'All', oTbl:'All', oQ:'', oSel:null` — it does **not** reset the date (on the phone the date chip survives Reset / Clear all) and does not close the popover.

### 5.2 Measured (state `filters`)
| Element | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|
| panel | `[252,226,608,290]` | `[96,226,764,290]` | `[96,231,508,290]` | `[96,226,704,290]` | `[12,227,366,435]` |
| group 1 (d/c/t: Order type; p: Date) | `[267,241,578,55]`: label `[267,241,578,15]`, options `[267,264,578,32]` | x 111 | x 111, y 246 | x 111 | `[27,242,336,93]` (options wrap to 2 rows: `[27,265,336,70]`) |
| · options | "All types" 79.23 · "Dine-in" 70.19 · "Takeaway" 86.03 · "Delivery" 75.75 (×32, gap 6) | same | same | same | Date: "Today" 61.81 · "Yesterday" 85.83 · "Last 7 days" 95.64 / "All dates" 79 (2nd row y 303) |
| group 2 (Payment; p: Order type) | `[267,310,578,55]`: "Any" 49.14 · "Cash" 56.98 · "UPI" 47.14 · "Card" 55.02 · "Split" 54.09 · "Due" 50.09 | x 111 | y 315 | x 111 | `[27,349,336,55]` Order type in one row |
| Payment on the phone | | | | | `[27,418,336,93]` (wraps: "Due" `[27,479,50.09,32]`) |
| Table group | `[267,379,578,61]`: label 15 + select `[267,402,260,38]` (chevron `[502,414,14,14]`) | select x 111 | y 407 | x 111 | `[27,525,336,61]`, select `[27,548,260,38]` |
| footer | `[267,454,578,47]`: Reset `[713.31,467,59.31,34]`, Done `[780.63,467,64.38,34]` | Reset x 713.31 | y 472 | Reset x 653.31 | `[27,600,336,47]`: Reset `[231.31,613,59.31,34]`, Done `[298.63,613,64.38,34]` |
| list head after it | y 528 | y 528 | y 533 | y 528 | y 674 (the scroller keeps 170 px) |

Colours: label `rgb(107,107,116)` (`--text-3`); selected option `rgb(24,24,27)` bg + white text; others white with `rgb(226,226,230)` border; footer rule `rgb(236,236,239)` (`--border-2`); Reset text `rgb(82,82,91)`; Done `rgb(24,24,27)` bg.

---

## 6. Chips row

`div`: `display:{{ ov.chipsD }}` (`flex` when any chip); `flex-wrap:wrap; align-items:center; gap:6px`. It sits under the popover (or under the toolbar row when the popover is closed).

| Element | Properties |
|---|---|
| Chip (per `ov.chips`) | `button` click `c.clear`: `display:flex; align-items:center; gap:6px; height:28px; padding:0 6px 0 10px; border:0; border-radius:999px; background:var(--accent-t); color:var(--accent-i); font-size:12.5px; font-weight:600; cursor:pointer`; `{{ c.label }}` then the ✕ circle `span` `width:18px; height:18px; border-radius:50%; background:rgba(15,98,254,.14); display:flex; align-items:center; justify-content:center; font-size:9px` "✕" (the circle colour is a literal, not a token: it stays blue with any accent and in dark mode). No hover. The whole chip clears that one filter. |
| Clear all | `button` click `ov.clear`: `border:0; background:transparent; color:var(--text-2); font-size:12.5px; font-weight:500; cursor:pointer; padding:0 4px`; "Clear all" (5.1: not the date). |

Chips (`ov.chips`, in this order): phone only, when `oDate ≠ 'today'`: "Yesterday" / "Last 7 days" / "All dates" (clear → `oDate:'today'`); `oType ≠ All`: "Dine-in" / "Takeaway" / "Delivery"; `oPay ≠ All`: "Due bills" for Due, else `'Paid by '+method` ("Paid by Cash"); `oTbl ≠ All`: the table value ("Table 4", "Takeaway", "Delivery"). `fCount = chips.length` (the desktop date select never counts).

Measured (state `filter-chip`, "Dine-in"): row d1280 `[252,226,608,28]`, chip `[252,226,83.31,28]` (✕ `[311.31,231,18,18]`), "Clear all" `[341.31,231.5,56.28,17]`; c1280 / t820 x 96; t1024 `[96,279,508,28]` (under the wrapped toolbar); p390 `[12,227,366,28]`. Chip colours: `rgb(237,245,255)` bg, `rgb(0,67,206)` text, ✕ circle `rgba(15,98,254,0.14)`. The list head moves down by 40 (28 + gap 12).

---

## 7. List head

`div`: `display:flex; align-items:baseline; justify-content:space-between; gap:10px; padding:0 2px 8px; font-size:12.5px; color:var(--text-2)`. Left `span`: `<b style="color:var(--text);font-weight:600">{{ ov.count }}</b> {{ ov.scope }}`; right `span` `{{ ov.sortTxt }}`.
- `scope` = searching ? (`n===1` ? "match in all orders" : "matches in all orders") : `laneName+(n===1 ? ' order' : ' orders')`, `laneName` = open / paid / due / cancelled. ("0 due orders", "1 due order", "1 match in all orders", "4 matches in all orders".)
- `sortTxt` = open lane and not searching ? "Bills printed first, then oldest" : "Newest first".
- Measured (state `default`): d1280 `[252,226,608,25]` (left `[254,226,78.78,17]` "8 open orders", count `[254,226,7.81,17]` `rgb(24,24,27)` 600; right `[693.41,226,164.59,17]`); c1280 x 96 / right x 693.41; t1024 y 231; t820 right x 633.41; p390 `[12,227,366,25]` (right x 211.41); x1600 right x 1013.41. Height 25 = 17 + 8 padding.

---

## 8. The list as a table (`listW ≥ 700`: c1280, t820, x1600)

### 8.1 Elements (verbatim)
| Element | Properties |
|---|---|
| List box (both forms) | `div`: `background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden`. Children: table head, [empty state], then per row a table row **and** a card row (one of them `display:none`). |
| Head | `div`: `display:{{ ov.L.tableG }}; grid-template-columns:{{ ov.L.cols }}; gap:12px; padding:10px 16px; background:var(--surface-2); border-bottom:1px solid var(--border); font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--text-3)` (0.66px). Cells "Order", "Customer", "Items" (`display:{{ ov.L.itemsD }}`), "Time", "Status", "Amount" (`text-align:right`), empty. |
| Row | `div` click `r.onClick` (`oSel = key`): `position:relative; display:{{ ov.L.tableG }}; grid-template-columns:{{ ov.L.cols }}; align-items:center; gap:12px; padding:11px 16px; border-top:{{ r.bt }}; background:{{ r.bg }}; cursor:pointer`; `style-hover="background:{{ r.hov }}"` → **empty rule** (0.5). `bt` = first row `0`, others `1px solid var(--border-2)`; `bg` selected `var(--accent-t)` else transparent. |
| · selection bar | `span`: `position:absolute; left:0; top:8px; bottom:8px; width:3px; border-radius:0 3px 3px 0; background:var(--accent); opacity:{{ r.barOp }}` (1 selected). |
| · Order cell | `span` `display:flex; align-items:center; gap:10px; min-width:0`: code tile `span` `width:36px; height:36px; flex:none; border-radius:9px; background:{{ r.bBg }}; color:{{ r.bFg }}; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px` (`{{ r.code }}`: T{n}, TA, DL; billed open order `var(--bill-t)` / `var(--bill-i)`, else `var(--surface-3)` / `var(--text)`); text `span min-width:0`: title `display:block; font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`; sub `display:block; font-family:'Geist Mono',ui-monospace,monospace; font-size:11.5px; color:var(--text-3)` = `{{ r.no }} · {{ r.type }}` (**no nowrap**: it wraps in a narrow column, 20 #6). |
| · Customer cell | `span min-width:0`: name `display:block; font-size:13.5px; nowrap; ellipsis` (`r.cust` = customer name or "Walk-in"); sub `display:block; font-size:12px; color:var(--text-3); nowrap; ellipsis` (`r.custSub` = `fmtPh(phone)`, else Dine-in with guests `n+' guests'`, else "No customer added"). |
| · Items cell | `span` `display:{{ ov.L.itemsD }}; min-width:0; font-size:13px; color:var(--text-2); nowrap; ellipsis`; `r.items` = `qty+'× '+first name` plus `' +'+(lines−1)+' more'` when more than one line ("1× Butter Chicken +2 more", "2× Chicken Zinger"), "—" for an empty cart. |
| · Time cell | `span min-width:0`: `display:block; font-size:13px; white-space:nowrap` `r.time`; `display:block; font-size:12px; color:{{ r.ageC }}; font-weight:{{ r.ageW }}; white-space:nowrap` `r.age` (0.1). |
| · Status cell | `span` > pill `span`: `display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 9px; border-radius:999px; background:{{ r.stBg }}; color:{{ r.stColor }}; font-size:12px; font-weight:600; white-space:nowrap`; dot `6×6` round `{{ r.dot }}`; `{{ r.status }}` (10.1). |
| · Amount cell | `span` `text-align:right; min-width:0`: amount `display:block; font-family:'Geist Mono',…; font-size:14px; font-weight:600; text-decoration:{{ r.amtDeco }}; color:{{ r.amtColor }}` (cancelled: `line-through`, `var(--text-3)`); due line `display:block; font-size:11.5px; color:var(--bill-i); font-weight:600` `r.dueTxt` (`RS(due)+' due'` or empty — the empty span still sits there with 0 height). |
| · Action cell | `span` `display:flex; justify-content:flex-end`: `button` click `r.onAct` (stops propagation, so the row is not selected): `display:{{ r.actD }}; height:32px; padding:0 12px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); font-size:12.5px; font-weight:600; cursor:pointer; white-space:nowrap`; hover `background:var(--ink); color:var(--on-ink); border-color:var(--ink)`. `r.act` = "Settle" (open, user not Captain → `settle(i)`: payment sheet, 14) or "Collect" (due → `collect`: 17), else hidden. Text sits at the top of the box (0.5). |

### 8.2 Measured (state `default`, open lane)
| Element | c1280 | t820 | x1600 |
|---|---|---|---|
| list box | `[96,251,764,508]` | `[96,251,704,532]` | `[252,251,928,532]` |
| head | `[97,252,762,35]`, columns `157.125px 120.875px 92px 124px 92px 84px` | `[97,252,702,35]`, `150px 110px 92px 124px 92px 84px` (both `minmax` at their minimum) | `[253,252,926,35]`, `151.078px 116.219px 162.703px 92px 124px 92px 84px` |
| head cells x | Order 113 · Customer 282.13 · Time 415 · Status 519 · Amount 655 (92 wide, right-aligned) · (759, 84) | 113 · 275 · 397 · 501 · 637 · 741 | 269 · 432.08 · Items 560.3 · 735 · 839 · 975 · 1079 |
| head text | y 262, h 14, `rgb(107,107,116)` on `rgb(250,250,250)` | | |
| row 1 (Table 1, selected) | `[97,287,762,58]` | `[97,287,702,58]` | `[253,287,926,58]` |
| row 2, 3 | `[97,345,762,59]`, `[97,404,762,59]` (59 = 1 border + 58) | same y | same y |
| · bar | `[97,295,3,42]` | same | `[253,295,3,42]` |
| · tile | `[113,298,36,36]` (`rgb(252,244,214)` / `rgb(142,106,0)` for billed T1; `rgb(233,233,236)` / `rgb(24,24,27)` otherwise) | `[113,298,36,36]` | `[269,298,36,36]` |
| · title / sub | `[159,299.5,103.52,18]` / `[159,317.5,103.52,15]` "#1036 · Dine-in" | same | x 315 |
| · customer name / sub | `[282.13,299,120.88,18]` / `[282.13,317,120.88,16]` | `[275,299,110,18]` / `[275,317,110,16]` | `[432.08,299,116.22,18]` |
| · items | hidden | hidden | `[560.3,307.5,162.7,17]` "1× Butter Chicken +2 more" |
| · time / age | `[415,299.5,92,17]` / `[415,316.5,92,16]` "Open 1h 8m" `rgb(162,25,31)` 600 | x 397 | x 735 |
| · status pill | `[519,304.5,92.61,24]` "Bill printed" (dot `[528,313.5,6,6]`) | x 501 | x 839 |
| · amount | `[655,307,92,18]` (right-aligned) | x 637 | x 975 |
| · Settle | `[780.86,300,62.14,32]` | `[762.86,300,62.14,32]` | `[1100.86,300,62.14,32]` |

Row height 58 = padding 11 + 36 tile + 11 when every text fits on one line. At **t820** the Order column is 150 wide, so the title column is 103.52 and the sub "#1043 · Delivery" / "#1044 · Takeaway" wraps to two lines: those rows grow (shot `default-820x1180.png`: Delivery 3 and Takeaway 14 rows are taller, see 21.3).

---

## 9. The list as cards (`listW < 700`: d1280, t1024, p390)

### 9.1 Elements (verbatim)
| Element | Properties |
|---|---|
| Card row | `div` click `r.onClick`: `position:relative; display:{{ ov.L.cardF }}; flex-direction:column; gap:6px; padding:12px 14px; border-top:{{ r.bt }}; background:{{ r.bg }}; cursor:pointer`. No hover attribute at all. |
| · selection bar | as the table's but `top:10px; bottom:10px`. |
| · top line | `span` `display:flex; align-items:center; gap:10px; min-width:0`: tile `38×38; flex:none; border-radius:9px; bBg / bFg; font-weight:700; font-size:12px`; middle `span flex:1; min-width:0`: line 1 `display:block; font-size:14.5px; font-weight:600; nowrap; ellipsis` = `{{ r.title }}` + space + `span` `font-family:'Geist Mono',…; font-size:11.5px; color:var(--text-3); font-weight:400` `{{ r.no }}`; line 2 `display:block; font-size:12.5px; color:var(--text-2); nowrap; ellipsis` = `{{ r.cust }} · {{ r.items }}`; right `span` `flex:none; text-align:right`: amount `display:block; Geist Mono; font-size:14.5px; font-weight:600; text-decoration:{{ r.amtDeco }}; color:{{ r.amtColor }}`; age `display:block; font-size:11.5px; color:{{ r.ageC }}; font-weight:{{ r.ageW }}` `{{ r.ageShort }}` (closed rows: the clock time). |
| · bottom line | `span` `display:flex; align-items:center; gap:8px; padding-left:48px` (aligned with the text column): pill `span` `display:inline-flex; align-items:center; gap:6px; height:22px; padding:0 8px; border-radius:999px; stBg / stColor; font-size:11.5px; font-weight:600; white-space:nowrap` + dot 6×6; due `span` `font-size:12px; color:var(--bill-i); font-weight:600` `{{ r.dueTxt }}`. |

Cards carry **no Settle / Collect button** (and no customer sub-line, time or type): on d1280, t1024 and p390 settling starts only from the detail (or the strip's "Settle T1").

### 9.2 Measured (state `default`)
| Element | d1280 | t1024 | p390 |
|---|---|---|---|
| list box | `[252,251,608,729]` (taller than the scroller: the list scrolls) | `[96,256,508,729]` | `[12,252,366,729]` |
| card 1 (Table 1, selected) | `[253,252,606,90]` | `[97,257,506,90]` | `[13,253,364,90]` |
| card 2, 3 | `[253,342,606,91]`, `[253,433,606,91]` | y 347, 438 | y 343, 434 |
| · bar | `[253,262,3,70]` | `[97,267,3,70]` | `[13,263,3,70]` |
| · top line | `[267,264,578,38]` | `[111,269,478,38]` | `[27,265,336,38]` |
| · tile | `[267,264,38,38]` | `[111,269,38,38]` | `[27,265,38,38]` |
| · line 1 / "#1036" | `[315,265,467.8,19]` / `[368.34,268,34.5,15]` | `[159,270,367.8,19]` | `[75,266,225.8,19]` / `[128.34,269,34.5,15]` |
| · line 2 | `[315,284,467.8,17]` "Walk-in · 1× Butter Chicken +2 more" | `[159,289,367.8,17]` | `[75,285,225.8,17]` (ellipsised for Table 13: "Walk-in · 1× Paneer Butter Masala +1 mo…") |
| · amount / age | `[792.8,266,52.2,19]` / `[792.8,285,52.2,15]` "1h 8m" `rgb(162,25,31)` | x 536.8 | x 310.8 |
| · bottom line / pill | `[267,308,578,22]` / `[315,308,88,22]` "Bill printed" (dot `[323,316,6,6]`) | `[111,313,478,22]` / x 159 | `[27,309,336,22]` / x 75 |

Card height 90 = 12 + 38 + 6 + 22 + 12; each following card 91 (1 px top border `rgb(236,236,239)`).

---

## 10. Row values, sort and row states

### 10.1 Status per row (`st`, ordersVals 436–437)
| Row kind | Status text | dot / text / pill bg |
|---|---|---|
| open, billed | "Bill printed" | `var(--bill)` / `var(--bill-i)` / `var(--bill-t)` (`rgb(178,134,0)` / `rgb(142,106,0)` / `rgb(252,244,214)`) |
| open, any unsent line | "KOT pending" | `var(--warn)` / `var(--warn-i)` / `var(--warn-t)` (`rgb(255,131,43)` / `rgb(186,78,0)` / `rgb(255,242,232)`) |
| open, all sent | "In kitchen" | `var(--info)` / `var(--info-i)` / `var(--info-t)` (`rgb(15,98,254)` / `rgb(0,67,206)` / `rgb(237,245,255)`) |
| closed, cancelled | "Cancelled" | `var(--bad)` / `var(--bad-i)` / `var(--bad-t)` |
| closed, refunded | "Refunded" | bad colours |
| closed, due | "Due" | bill colours |
| closed, paid | `'Paid · '+method` ("Paid · UPI", "Paid · Cash", "Paid · Card", "Paid · Split") | `var(--ok)` / `var(--ok-i)` / `var(--ok-t)` |

Kinds: history rows are `cancel` when `cancelled`, `due` when `due && !refunded`, else `paid` (so a refunded bill stays in **Paid** with a red "Refunded" pill, and a refunded due bill moves from Due to Paid). `due` = `refunded ? 0 : due`.

### 10.2 Sort, pool and filters (ordersVals 441–447)
- `pool` = searching ? **all rows of every lane** (`all`) : the current lane's rows. Then filters: `oType` (row type), `oPay` (`Due` → `due > 0`; a method → closed rows with that `method`; **open rows never match a payment filter**), `oTbl` (`Takeaway` / `Delivery` → type; a table → `id === 'Table n'`), and the search `match`: `(id+' '+no+' '+customer name)` lower-case contains the query, or (query has ≥ 3 digits) the customer phone contains them.
- Sort: open lane, not searching → billed first, then oldest first (`a.at − b.at`); everything else → newest first.
- Selection: `sel` = the row whose key is `oSel`, else (big only) the first row, else none. Below 1024 nothing is selected until a row is tapped.

### 10.3 Row states (measured)
| State | Look |
|---|---|
| selected (`sel-*`, `default` at ≥ 1024) | background `var(--accent-t)` `rgb(237,245,255)` + 3 px `var(--accent)` bar (table: top/bottom inset 8; card: 10) |
| hover, table row (`hover-row` c1280, pointer on Table 17) | **no change** (rule `.scpc:hover{}` empty) |
| hover, card row (`hover-row` d1280) | no change (no hover attribute) |
| hover, row Settle (`hover-settle` c1280) | `rgb(24,24,27)` bg, white text, `rgb(24,24,27)` border |
| billed open order | tile `var(--bill-t)` / `var(--bill-i)`; pill "Bill printed"; sorted first |
| cancelled (`lane-cancel-filled`) | amount `line-through` in `var(--text-3)` `rgb(107,107,116)` (card `[800.67,266,44.33,19]` at d1280; table `[655,307,92,18]` at c1280); card age = the cancel time "9:30 PM"; pill "Cancelled" `rgb(162,25,31)` on `rgb(255,241,241)` (card 83.41×22); no action button |
| due (`lane-due-filled`) | pill "Due" (bill colours; table 52.64×24, card 49.7×22); amount `var(--text)`; due line "₹954 due" 11.5px/600 `rgb(142,106,0)` under the amount in the table (amount moves up: `[655,299.5,92,18]` + `[655,317.5,92,15]` at c1280) / 12px/600 next to the pill on cards (`[372.7,311,55.08,16]` at d1280); "Collect" button in the table `[773.88,300,69.13,32]` |
| refunded (`sel-refund`) | pill "Refunded" (red); amount **not** struck in the row (struck only in the detail total) |
| late open order | age text `var(--warn-i)` ≥ 30 min, `var(--bad-i)` ≥ 60 min, weight 600 |

---

## 11. Order detail (`aside`)

### 11.1 Container
`aside`: `display:{{ ov.dDisplay }}; position:{{ L.ovDPos }}; inset:{{ L.ovDInset }}; width:{{ L.ovDW }}; z-index:{{ L.ovDZ }}; flex-direction:column; min-height:0; background:var(--surface); border-left:1px solid var(--border); box-shadow:{{ L.ovDSh }}`. `dDisplay = (sel ‖ big) ? 'flex' : 'none'` — at ≥ 1024 the column is always there (with the "Select an order…" text when nothing is selected, section 13); below 1024 it exists only while a row is selected. No entrance animation at any size (only the scrim fades in; 20 #10).
- ≥ 1024: the grid's second track (400 px), `position:relative; z-index:1`, no shadow. Measured d1280 / c1280 `[880,56,400,744]`, t1024 `[624,56,400,712]`, x1600 `[1200,56,400,844]` (left border `rgb(226,226,230)` inside the 400).
- 820: `position:fixed; inset:0 0 0 auto; width:min(440px,100%); z-index:30; box-shadow:var(--pop)` → `[380,0,440,1180]`, full height, square corners, over the nav rail's right and the page header.
- 390: `position:fixed; inset:0; width:100%; z-index:30` → `[0,0,390,844]`, full screen: it also covers the page header and the fixed tab bar (z 12) — measured hit test at `(195,814)` returns the "Settle & pay" button inside the aside, not the tab bar.

Children when an order is selected (`sc-if ov.d.has`): head (11.2–11.3), scrolling body (11.4–11.9), [foot] (11.10).

### 11.2 Head (verbatim)
| Element | Properties |
|---|---|
| Head | `div`: `flex:none; padding:16px 18px 16px; border-bottom:1px solid var(--border); display:flex; flex-direction:column; gap:14px`. |
| Top row | `div` `display:flex; align-items:flex-start; gap:12px`. |
| · code tile | `span`: `width:46px; height:46px; flex:none; border-radius:12px; background:var(--ink); color:var(--on-ink); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13.5px`; `{{ ov.d.code }}` (T1, TA, DL — always ink, also for a billed order). |
| · title column | `div style="flex:1;min-width:0"`: name row `div` `display:flex; align-items:baseline; gap:8px; min-width:0` = name `span` `font-size:18px; font-weight:600; letter-spacing:-.01em; nowrap; ellipsis` (−0.18px) + number `span` `flex:none; font-family:'Geist Mono',…; font-size:12.5px; color:var(--text-3)` ("#1036"); meta `div` `display:flex; flex-wrap:wrap; gap:4px 10px; margin-top:4px; font-size:12.5px; color:var(--text-2)` with an item per `ov.d.meta`: `span` `display:flex; align-items:center; gap:5px; white-space:nowrap; color:{{ m.c }}; font-weight:{{ m.w }}` = `svg 13×13 stroke-width 1.9 linecap/linejoin round; flex:none; opacity:.8` + text. |
| · close | `button title="Close"` click `ov.close`: `display:{{ L.ovClose }}` (below 1024 only); `width:34px; height:34px; flex:none; border:0; background:var(--surface-3); border-radius:50%; font-size:12px; cursor:pointer; color:var(--text-2); align-items:center; justify-content:center`; "✕". No hover. |
| Steps box | `div`: `display:grid; grid-template-columns:{{ ov.d.stepCols }}` (`repeat(n,minmax(0,1fr))`, n = 4, or 2 for a cancelled order); `padding:12px 12px 10px; border-radius:12px; background:var(--surface-2); border:1px solid var(--border-2)`. |
| · step | `div` `display:flex; flex-direction:column; gap:7px; min-width:0`: row `div` `display:flex; align-items:center` = dot `span` `14×14; flex:none; border-radius:50%; background:{{ st.dotBg }}; box-shadow:{{ st.ring }}; display:flex; centred; color:#FFFFFF` holding a tick `svg 8×8 stroke-width 4 linecap/linejoin round; opacity:{{ st.tick }}` path `M5 12l5 5L20 7`, then the connector `span` `flex:1; height:2px; border-radius:1px; margin:0 6px; background:{{ st.line }}; opacity:{{ st.lineOp }}`; label `span` `font-size:12px; font-weight:600; color:{{ st.lc }}; nowrap; ellipsis; padding-right:6px`; time `span` `font-size:11px; color:{{ st.tc }}; white-space:nowrap; margin-top:-4px`. |

Meta items (`ov.d.meta`), icons (`MI`): type (`M3 11h18M12 11v9M7 20h10M6 11V5M18 11V5`, a table) "Dine-in" / "Takeaway" / "Delivery"; guests (`M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z`) `n+' guests'` (Dine-in with guests only); staff (`M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0`) first name of the order's creator ("Sana", "Priya", "Amit", "Rohan"); clock (`M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2`) per 0.1. Default colour `var(--text-2)` 400. The meta wraps when its items exceed the column (305 px at ≥ 1024, 299 at 820, 249 at 390): open dine-in orders (four items, the clock with its age) take two lines (head 190 tall: Table 1, 4, 7 everywhere); Delivery 3 (three items) and closed orders (clock only, e.g. Table 12 "Dine-in · 2 guests · Ananya · 8:16 PM") fit on one line (head 171), except on the 390 phone where the closed dine-in meta wraps too (head 190).

Step states (`ST(label,state,time)`):
| state | dot | ring | tick | connector after it | label colour | time colour |
|---|---|---|---|---|---|---|
| done | `var(--ok)` `rgb(36,161,72)` | none | shown | `var(--ok)` | `var(--text)` | `var(--text-3)` |
| cur | `var(--surface)` (white) | `inset 0 0 0 3px var(--accent)` | hidden | `var(--border)` | `var(--accent-i)` `rgb(0,67,206)` | `var(--accent-i)` |
| todo | `var(--surface-3)` `rgb(233,233,236)` | none | hidden | `var(--border)` | `var(--text-3)` | `var(--text-3)` |
| bad (Cancelled, Refunded) | `var(--bad)` `rgb(218,30,40)` | none | hidden | `var(--border)` | `var(--bad-i)` | `var(--text-3)` |
| due | `var(--bill)` `rgb(178,134,0)` | none | hidden | `var(--border)` | `var(--bill-i)` | `var(--text-3)` |
The last step's connector has `opacity:0`.

Step sequences:
- Open: "Opened" (done, `hm(opened)`), "Kitchen" (done "Sent" when any line was sent, else **cur "Not sent"**), "Bill printed" (done "Printed" when billed), "Paid" (never done). The first not-done step is `cur` and shows "Next" when it has no time of its own; later ones are `todo` with no time. Table 1 (billed): done/done/done/cur "Next"; Table 4, Table 7, Delivery 3: done "8:58 PM" · done "Sent" · cur "Next" · todo; a new order with nothing sent (`sel-new-unsent`): done "9:30 PM" · **cur "Not sent"** · todo · todo.
- Paid: Opened, Kitchen, Bill printed all done **with no time**, then "Paid" done `hm(at)`. Due: last step "Due" (due look) `hm(at)`. Refunded: last step "Refunded" (bad) with the **bill's** time `hm(at)` (the refund time is not stored: "Refunded 8:16 PM" for a refund made at 9:30 PM).
- Cancelled: two steps "Opened" (done, no time) and "Cancelled" (bad, `hm(at)`), columns `168.5px 168.5px` at d1280.

### 11.3 Measured head (state `sel-t1`, Table 1; `default` is identical at ≥ 1024)
| Element | d1280 / c1280 | t1024 | t820 (sheet) | p390 (sheet) |
|---|---|---|---|---|
| head | `[881,56,399,190]` | `[625,56,399,190]` | `[381,0,439,190]` | `[1,0,389,190]` |
| top row | `[899,72,363,65]` | `[643,72,363,65]` | `[399,16,403,65]` | `[19,16,353,65]` |
| tile | `[899,72,46,46]` `rgb(24,24,27)` / white | `[643,72,46,46]` | `[399,16,46,46]` | `[19,16,46,46]` |
| name / number | `[957,72,60.7,23]` / `[1025.7,77,37.5,17]` | x 701 / 769.7 | x 457 / 525.7, y 16 / 21 | x 77 / 145.7 |
| meta | `[957,99,305,38]`: "Dine-in" `[957,99,59.7,17]`, "4 guests" `[1026.7,99,67.33,17]`, "Sana" `[1104.03,99,47,17]`, "8:22 PM · 1h 8m" `[957,120,113.44,17]` (`rgb(162,25,31)` 600); icons 13×13 at y +2 | x 701 | `[457,43,299,38]` | `[77,43,249,38]` |
| close | hidden | hidden | `[768,16,34,34]` | `[338,16,34,34]` |
| steps box | `[899,151,363,78]`, columns `84.25px ×4` | `[643,151,363,78]` | `[399,95,403,78]`, `94.25px ×4` | `[19,95,353,78]`, `81.75px ×4` |
| step 1 dot / connector / label / time | `[912,164,14,14]` / `[932,170,58.25,2]` / `[912,185,84.25,16]` / `[912,204,84.25,14]` | x 656 | `[412,108,14,14]` / `[432,114,68.25,2]` / y 129 / y 148 | `[32,108,14,14]` / `[52,114,55.75,2]` |
| step 4 | x 1164.75 ("Paid" `rgb(0,67,206)`, "Next") | x 908.75 | x 694.75 | x 277.25 |

Vertical rhythm of the head: padding 16 → top row 65 (tile 46, title column 23 + 4 + 38) → gap 14 → steps 78 (1 + 12 + 14 + 7 + 16 + 7 − 4 + 14 + 10 + 1) → padding 16 + border 1 = 190 (171 when the meta fits on one line).

### 11.4 Body and customer block
| Element | Properties |
|---|---|
| Body | `div`: `flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; padding:14px 18px 18px; display:flex; flex-direction:column; gap:14px`. Children: customer row, items box, [cancel note], [quick actions], [danger link]. Flex children shrink: the quick-actions grid (`overflow:hidden`, so its automatic minimum height is 0) is squeezed before the body starts to scroll (20 #2). |
| Customer row | `div` `display:flex; align-items:center; gap:10px`: avatar `span` `36×36; flex:none; border-radius:50%; background:{{ ov.d.avBg }}; color:{{ ov.d.avFg }}; display:flex; centred; font-weight:600; font-size:12.5px` (`avTxt` = initials of the first two words, "NJ"; no customer "?"; with a customer `var(--accent-t)` / `var(--accent-i)`, without `var(--surface-3)` / `var(--text-3)` — not the staff-hue colours of U0 §1.6); text `span flex:1; min-width:0`: name `display:block; font-size:14px; font-weight:600; nowrap; ellipsis` (`custName` = name or "Walk-in customer"); sub `display:block; font-size:12.5px; color:var(--text-3); nowrap; ellipsis` (`custSub` = `fmtPh(phone)+(visits ? ' · '+visits+' visits' : '')` or "No phone · bill can’t be sent"). |
| + Add customer | `button` click `addCust` (`active = order`, then `openCust()`: the customer sheet, U1 §8): `display:{{ ov.d.addCustD }}` (open order without a customer); `align-items:center; flex:none; height:32px; padding:0 12px; border:1px dashed var(--text-3); border-radius:8px; background:transparent; color:var(--text); font-size:12.5px; font-weight:600; cursor:pointer; white-space:nowrap`; hover `background:var(--hover)`. |

Measured (state `sel-t1`, walk-in): body d1280 / c1280 `[881,246,399,479]`, t1024 `[625,246,399,447]`, t820 `[381,190,439,915]`, p390 `[1,190,389,581]`; customer row `[899,260,363,36]` (avatar `[899,260,36,36]` "?" `rgb(107,107,116)` on `rgb(233,233,236)`; name `[945,260.5,187.08,18]`; sub `[945,278.5,187.08,17]`; "+ Add customer" `[1142.08,262,119.92,32]`, dashed `rgb(107,107,116)`); t820 avatar x 399, button x 682.08; p390 x 19 / 252.08. With a customer (`sel-t4`, Neha Joshi): avatar "NJ" `rgb(0,67,206)` on `rgb(237,245,255)`, name `[945,260.5,317,18]`, sub "+91 98201 23456 · 12 visits".

### 11.5 Items box, sums and total
| Element | Properties |
|---|---|
| Box | `div`: `position:relative; background:var(--surface-2); border:1px solid var(--border-2); border-radius:12px; padding:12px 14px 14px`. |
| Head | `div`: `display:flex; justify-content:space-between; align-items:baseline; font-size:11.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--text-3); padding-bottom:4px`: `{{ ov.d.itemsHead }}` (`n+(n===1 ? ' item' : ' items')`, n = Σ qty: "6 items", "1 item") and "Amount". |
| Line (per `ov.d.lines`) | `div`: `display:grid; grid-template-columns:28px minmax(0,1fr) auto; gap:2px 8px; padding:8px 0; align-items:baseline`: qty `span` `font-family:'Geist Mono',…; font-weight:600; font-size:13px; color:var(--text-2)` (`qty+'×'`); name column `span min-width:0`: name `display:block; font-size:13.5px; font-weight:500`, meta `display:block; font-size:12px; color:var(--text-3)` (size unless "Standard", add-ons, note, joined ", ": "Medium, Extra cheese", "Less sugar"; empty → 0-height line); total `span` `font-family:'Geist Mono',…; font-size:13.5px` (`RS(price×qty)`). Names wrap (no nowrap). |
| Divider 1 | `div` `border-top:1.5px dashed var(--border); margin:6px 0 8px` (1 px measured). |
| Sums | `div` `display:flex; flex-direction:column; gap:6px; font-size:13px; color:var(--text-2)`; row per `ov.d.sums`: `div` `display:flex; justify-content:space-between; color:{{ r.c }}` = label + `span` `font-family:'Geist Mono',…` value. Colour: "Still due" `var(--bill-i)`; "Refunded" and "Discount 10%" `var(--bad-i)`; others `var(--text-2)`. |
| Divider 2 | `div` `border-top:1.5px dashed var(--border); margin:10px 0 10px`. |
| Total | `div` `display:flex; justify-content:space-between; align-items:baseline`: label `span` `font-size:14px; font-weight:600` (`totalLabel`); value `span` `font-family:'Geist Mono',…; font-size:22px; font-weight:600; letter-spacing:-.02em; text-decoration:{{ ov.d.totDeco }}; color:{{ ov.d.totC }}` (−0.44px). |

Sums by kind (ordersVals 466–467) and total:
| Kind | Rows | Total label · value |
|---|---|---|
| open | "Subtotal" · [ "Discount 10%" `−₹x` ] · [ "Service charge 5%" (Dine-in) ] · [ "Packing" ₹20 (not Dine-in) ] · [ "Delivery fee" ₹40 (Delivery) ] · "GST 5%" | "To pay" · `RS(total)` |
| paid / due / refunded | "Subtotal" (= Σ price × qty, before discount, charges and tax) · split: "Paid in cash", "Paid by UPI" · else not Due: `'Paid by '+method` (total − due) · [ "Still due" ] · [ "Refunded" `−₹total` ] | "Bill total" · `RS(total)` (refunded: struck, `var(--text-3)`) |
| cancelled | none (the two dividers stay, 10 px apart) | "Not charged" · `RS(total)` struck, `var(--text-3)` `rgb(107,107,116)` |

Measured (state `sel-t1`, d1280): box `[899,310,363,292]`; head `[914,323,333,19]` ("6 items" `[914,323,49.05,15]`, "Amount" `[1192.84,323,54.16,15]`, `rgb(107,107,116)`, 0.69px); lines `[914,342,333,50]` (with meta "Full"), `[914,392,333,34]`, `[914,426,333,34]` (qty `[914,351,28,17]`, name `[950,350,256.59,18]`, meta `[950,368,256.59,16]`, total `[1214.59,350,32.41,18]`); divider 1 `[914,466,333,1]` dashed `rgb(226,226,230)`; sums `[914,475,333,63]` (rows 17 tall at y 475 / 498 / 521: "Subtotal ₹964", "Service charge 5% ₹48", "GST 5% ₹51"); divider 2 `[914,548,333,1]`; total `[914,559,333,28]` ("To pay" `[914,567,43.16,18]`, "₹1,063" `[1170.44,559,76.56,28]`). t1024 x 658; t820 `[399,254,403,292]` (inner 373); p390 `[19,254,353,292]` (inner 323). Table 4 (`sel-t4`, three lines with meta): box `[899,310,363,324]`, total y 591.

### 11.6 Cancel note (`sc-if ov.d.hasNote`, cancelled only)
`div`: `border-radius:10px; background:var(--bad-t); color:var(--bad-i); padding:11px 12px; font-size:13px; font-weight:500`; `'This order was cancelled at '+hm(at)+'. Nothing was charged.'` Measured (`sel-cancel` d1280): `[899,450,363,56]` (two lines), `rgb(255,241,241)` / `rgb(162,25,31)`.

### 11.7 Quick actions (`sc-if ov.d.hasQuick`)
| Element | Properties |
|---|---|
| Grid | `div`: `display:grid; grid-template-columns:{{ ov.d.quickCols }}` (`repeat(n,minmax(0,1fr))`); `border:1px solid var(--border); border-radius:12px; overflow:hidden; background:var(--surface)`. |
| Button (per `ov.d.quick`) | `button`: `display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; height:62px; border:0; border-left:{{ a.bl }}` (first `0`, others `1px solid var(--border)`); `background:transparent; color:var(--text); font-size:12px; font-weight:600; cursor:pointer; padding:0 4px; text-align:center; white-space:nowrap`; hover `background:var(--hover)`. Icon `svg 18×18 stroke-width 1.8 linecap/linejoin round`, then the label. |

Actions (`IP` icons): open order → "Print bill" / "Reprint bill" when billed (printer `M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z`), "Reprint KOT" (cloche `M6 13a6 6 0 1 1 12 0v2H6zM5 19h14M12 7V4`), "Share bill" (speech bubble `M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12z`), and for Dine-in "Move table" (`M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h20`) → 4 or 3 columns. Paid / due / refunded → "Reprint bill", "Share bill" (2 columns). Cancelled → none (the grid is not rendered).

Measured unsqueezed (`sel-t7`, d1280): grid `[899,532,363,64]`, buttons 90.25×62 at x 900 / 990.25 / 1080.5 / 1170.75 (icon 18×18 at y +11.5, label 16 tall at y +34.5); 3 columns (Delivery) 120.33 wide; 2 columns 180.5 wide; t820 buttons 100.25 (4) / 133.66 (3) / 200.5 (2); p390 87.75 (4) / 175.5 (2). **Squeezed** heights (the grid's visible height; the buttons stay 62 and are clipped):

| Selected order | d1280 / c1280 | t1024 | t820 / p390 |
|---|---|---|---|
| Table 1 (`default`, `sel-t1`) | 48 | 16 | 64 |
| Table 4 (`sel-t4`, 3 lines with meta) | **16** | **2** (and the body scrolls: 465 in 447) | 64 |
| Delivery 3 | 44 | 12 | 64 |
| Due bill (`sel-due`, with foot) | 58 | 26 | 64 |
| Table 7, paid, split, refunded, new order | 64 | 64 | 64 |

### 11.8 Danger link (`sc-if ov.d.hasDanger`)
`button` `align-self:center; display:flex; align-items:center; gap:6px; border:0; background:transparent; color:var(--bad-i); font-size:13px; font-weight:600; cursor:pointer; padding:6px 10px; border-radius:8px`; hover `background:var(--bad-t)`; icon `svg 15×15 stroke-width 1.9 linecap/linejoin round`. Open order: "Cancel this order" (ban icon `M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8`); paid or due, not refunded: "Refund this bill" (undo arrow `M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3`); refunded / cancelled: none. Measured (`sel-t1` d1280): `[1006.73,678,147.52,29]` (icon `[1016.73,685,15,15]`, `rgb(162,25,31)`); "Refund this bill" `[1013.06,618,134.86,29]` (`sel-paid`).

### 11.9 Foot (`sc-if ov.d.hasFoot`)
| Element | Properties |
|---|---|
| Foot | `div`: `flex:none; padding:12px 18px {{ L.cartFootB }}; border-top:1px solid var(--border); display:grid; grid-template-columns:{{ ov.d.footCols }}; gap:8px; background:var(--surface)`. `footCols` = both buttons `minmax(0,1fr) minmax(0,2fr)`, one `minmax(0,1fr)`. |
| Edit items (`second`) | `button` `display:{{ ov.d.secondD }}; height:48px; border:1px solid var(--border); border-radius:10px; background:var(--surface); color:var(--text); font-weight:600; font-size:14px; cursor:pointer; align-items:center; justify-content:center; gap:7px; white-space:nowrap`; hover `var(--hover)`; pencil `svg 16×16 stroke-width 1.9` path `M4 20h4L19 9l-4-4L4 16zM14 6l4 4`. Open orders only → route `order` with that order active (`cartOpen:false`). |
| Primary | `button` `display:{{ ov.d.primaryD }}; height:48px; border:0; border-radius:10px; background:var(--accent); color:var(--on-accent); font-weight:600; font-size:15px; cursor:pointer; align-items:center; justify-content:center; gap:8px; white-space:nowrap`; hover `var(--accent-h)`. Open order and not Captain: `'Settle & pay · '+RS(total)` → `settle(i)`; due bill (any role): `'Collect due · '+RS(due)` → `collect`. |

Which foot: open order → Edit items + Settle & pay (Captain: Edit items alone, full width); due → Collect due alone; paid, refunded, cancelled → **no foot** (the body runs to the bottom). Measured (`sel-t1`): d1280 / c1280 foot `[881,725,399,75]`, Edit items `[899,738,118.33,48]` (icon `[913.31,754,16,16]`), Settle & pay `[1025.33,738,236.67,48]` (`rgb(15,98,254)`); t1024 foot `[625,693,399,75]`; t820 `[381,1105,439,75]`, `[399,1118,131.66,48]` + `[538.66,1118,263.34,48]`; p390 `[1,771,389,73]` (bottom padding 12), `[19,784,115,48]` + `[142,784,230,48]`. Due (`sel-due` d1280): "Collect due · ₹954" `[899,738,363,48]`.

### 11.10 Detail content per kind (summary)
| | open | open, billed | paid | split-paid | due | refunded | cancelled |
|---|---|---|---|---|---|---|---|
| state | `sel-t4`, `sel-t7`, `sel-dl3` | `sel-t1` | `sel-paid` | `sel-split` | `sel-due` | `sel-refund` | `sel-cancel` |
| meta clock | time · age (coloured) | same | time | time | time | bill time | cancel time |
| + Add customer | when no customer | same | – | – | – | – | – |
| steps | 4, cur on the first not done | Paid = cur "Next" | 4 done | 4 done | last "Due" | last "Refunded" | 2 |
| sums | Subtotal, charges, GST | same | Subtotal, Paid by x | Subtotal, Paid in cash, Paid by UPI | Subtotal, Still due | Subtotal, Paid by x, Refunded | – |
| total | To pay | To pay | Bill total | Bill total | Bill total | Bill total struck | Not charged struck |
| note | – | – | – | – | – | – | red note |
| quick | Print bill, Reprint KOT, Share bill, [Move table] | Reprint bill, … | Reprint bill, Share bill | same | same | same | – |
| danger | Cancel this order | same | Refund this bill | same | Refund this bill | – | – |
| foot | Edit items + Settle & pay | same | – | – | Collect due | – | – |

Measured examples: split (`sel-split`, Table 6 ₹768, made with the default half split): "Subtotal ₹697", "Paid in cash ₹384", "Paid by UPI ₹384", "Bill total ₹768"; refunded (`sel-refund`, Table 12): "Subtotal ₹797", "Paid by UPI ₹879", "Refunded −₹879" (`rgb(162,25,31)`), "₹879" struck `rgb(107,107,116)`; due (`sel-due`): "Subtotal ₹865", "Still due ₹954" (`rgb(142,106,0)`), step "Due" dot `rgb(178,134,0)`, customer sub "+91 98201 23456 · 13 visits" (the Due payment counted a visit); cancelled (`sel-cancel`, Table 7): steps `168.5px ×2`, "Cancelled" `rgb(162,25,31)` 9:30 PM, "Not charged" + "₹439" struck, note `[899,450,363,56]`.

---

## 12. The detail as a sheet below 1024 (t820, p390)

- Opened by tapping a row (`oSel = key`); nothing is selected by default below 1024.
- Scrim (`sc-if ov.scrim`, `scrim = !big && !!sel && route==='orders'`): `div` click `ov.close`: `position:fixed; inset:0; z-index:29; background:var(--scrim); animation:fadeIn .2s ease both`. Measured `[0,0,820,1180]` / `[0,0,390,844]`, `rgba(17,17,19,0.42)`, `position:fixed z29`. It covers the nav rail, the page and (on the phone) the tab bar; at 390 it is entirely hidden under the full-screen aside.
- Sheet: the aside (11.1): t820 `[380,0,440,1180]` with `var(--pop)` shadow and the 1 px left border; p390 `[0,0,390,844]`. Square corners, no handle, no animation. Inside, the head starts at y 0 (no page header above it); the foot sits at the window bottom (t820 y 1105, p390 y 771, with the 12 px phone bottom padding `calc(12px + env(safe-area-inset-bottom))`).
- Close: ✕ (34×34 at `[768,16,34,34]` / `[338,16,34,34]`) or a click on the scrim (t820, left of x 380) → `oSel:'__none'` (state `sheet-close`, `sheet-scrim`: the list comes back, nothing selected, `oSel` "__none"). At ≥ 1024 the same `close` would re-select the first row, so it is not offered there.
- The row stays highlighted under the scrim (shot `sel-t7-820x1180.png`).
- Below the sheet the selected order also becomes the target of the overlays it opens (payment, table picker, customer sheet), which stack above it (section 14).

---

## 13. Empty states and no selection

| Element | Properties |
|---|---|
| Empty (`sc-if ov.empty`) | inside the list box, after the table head: `div` `text-align:center; padding:56px 16px; display:flex; flex-direction:column; align-items:center; gap:6px`: title `span` `font-size:14px; font-weight:600` `{{ ov.emptyT }}`; text `span` `font-size:13px; color:var(--text-2)` `{{ ov.emptyS }}`. |
| No selection (`sc-if ov.noSel`, ≥ 1024 only) | in the aside: `div` `margin:auto; text-align:center; color:var(--text-2); font-size:14px; padding:24px`; "Select an order to see its details." |

Texts (`emptyT` / `emptyS`): searching → `'No orders match “'+query.trim()+'”'` / "Try an order number, table or phone number."; filters active (any chip) → "No orders match these filters" / "Remove a filter to see more."; else `'No '+laneName+' orders '+dLabel` / "They will show up here as they happen." ("No due orders today", "No cancelled orders today", "No paid orders yesterday", "No cancelled orders in the last 7 days", "No cancelled orders " with All dates).

Measured (state `lane-due`, "No due orders today"): list box d1280 `[252,251,608,155]` (empty `[253,252,606,153]`, title `[488.5,308,135,18]`, text `[440.16,332,231.69,17]`); c1280 `[96,251,764,190]` (the table head stays: empty `[97,287,762,153]`); t1024 `[96,248,508,155]` (the strip is shorter without its action button); t820 `[96,251,704,190]`; p390 `[12,244,366,155]`. No-selection text: d1280 / c1280 `[952.17,395,256.66,66]` (24 padding, 18 line), t1024 `[696.17,379,256.66,66]`, centred in the column.

---

## 14. Overlays opened from Orders (placement and z-order only)

Their insides are U1's and were not re-measured; here is what opens them from this screen and how they sit over it.

### 14.1 Which control opens what
| Overlay (U1 section) | Opened from Orders by | Notes |
|---|---|---|
| Payment (U1 §11) | detail "Settle & pay · ₹x"; table row "Settle" (c1280, t820); strip "Settle T1" (t1024, p390) | `settle(i)`: `active = i`, then `pay()` on the next tick (U1 §14.2). Tender options follow the order's total (Table 1 ₹1,063: "Exact", "₹1,100", "₹2,000"). Completing it adds the history row (U1 §14.3); the toast is U1's (`"₹768 paid by Split"`, `"₹954 added to Neha Joshi’s dues · e-bill sent to +91 98201 23456"`). A Delivery without a customer opens the customer sheet instead (state `pay-dl-nocust`, customer removed by script: banner "Delivery orders need a customer before payment."). |
| Table picker (U1 §9) | detail quick action "Move table" (Dine-in only) | `active = i; tablePick:true`. Sub "Move Table 4 to another table". |
| Customer sheet (U1 §8) | detail "+ Add customer" | `active = i`, then `openCust()` (search mode, no need banner). |
| Manager approval (U1 §12.2) | "Cancel this order" / "Refund this bill" by a Cashier or Captain | section 15. |
| Order screen (U1) | detail "Edit items"; header "New order" | route change (`edit-items`: route `order` with Table 4 active; phone shows U1's order bar). |

The Orders screen itself opens no confirm dialog: Manager cancel and refund run at once.

### 14.2 Stacking (measured `position` / `z-index`, `elementFromPoint` hit tests)
Window order, bottom to top: Orders page (no stacking context) → phone tab bar `z 12` → detail scrim `z 29` → detail sheet `z 30` (below 1024) → payment scrim `z 45` → table picker / customer sheet `z 46` → approval / confirm `z 50` → toast `z 70`. The ≥ 1024 detail column is `position:relative; z-index:1` (in-page only). Every U1 overlay is a direct child of the app root with its own full-window scrim (`var(--scrim)`), so over an open detail sheet two scrims add up (the sheet stays open and visible, darkened, behind the payment sheet: shot `pay-detail-820x1180.png`). Hit tests: `pay-detail` t820 / p390 every probe point → inside `div:fixed:z45`; `move-table`, `cust-detail` → `z46`; `approval-cancel` → `z50`; `sel-t4` p390 (sheet only) → `aside:fixed:z30`, including the tab bar's area.

### 14.3 Measured panel boxes over Orders
| State | Overlay | d1280 | c1280 | t1024 | t820 | p390 |
|---|---|---|---|---|---|---|
| `pay-detail` (Table 1) | payment | `[430,148.5,420,503]` | same | `[302,132.5,420,503]` | `[200,338.5,420,503]` over the sheet `[380,0,440,1180]` | `[0,343,390,501]` over the full-screen sheet |
| `pay-row` (row "Settle", Table 17) | payment | – | `[430,148.5,420,503]` | – | `[200,338.5,420,503]` (no sheet: the row button does not select) | – |
| `pay-strip` ("Settle T1") | payment | – | – | `[302,132.5,420,503]` | – | `[0,343,390,501]` |
| `move-table` / `move-table-js` (Table 4) | table picker | `[340,44.5,600,711]` (js) | `[340,44.5,600,711]` (js) | `[212,28.5,600,711]` (js) | `[110,234.5,600,711]` over the sheet | `[0,101.28,390,742.72]` over the sheet |
| `cust-detail` (Table 7) | customer | `[410,100,460,600]` | same | `[282,84,460,600]` | `[180,290,460,600]` over the sheet | `[0,101.28,390,742.72]` over the sheet |
| `approval-cancel` (Priya) | approval | `[450,138.22,380,523.56]` | same | `[322,122.22,380,523.56]` | `[220,328.22,380,523.56]` over the sheet | `[5,320.44,380,523.56]` over the sheet |

These are U1's boxes (U1 §15.2) to the pixel; the Orders screen changes nothing in them. At d1280 / c1280 / t1024 the real-click `move-table` run did **not** open the picker (the button is clipped, 11.7 / 20 #2): `move-table-js` fires the button's own `click()` by script to measure the placement.

---

## 15. Manager approval from Orders (Cashier, Captain)

Frame, keypad, PIN rules and measurements: U1 §12.2 (same element, `z-index:50`, `max-width:380px`). From Orders, `role !== 'Manager'` turns two actions into `ask(sub, run, done)`:
| Action | `sub` (second line) | `done` → toast after the PIN |
|---|---|---|
| Cancel this order | `'Cancel '+id+' · '+RS(total)` → "Cancel Table 7 · ₹439" | "Order cancelled" → "Order cancelled · approved by Rohan" |
| Refund this bill | `'Refund '+RS(total)+' on order #'+no` → "Refund ₹879 on order #1035" | "Refund recorded" → "Refund recorded · approved by Rohan" |

Not gated: Settle (Cashier), Collect due (any role), Print / Reprint, Share, Move table, Edit items. Measured (`approval-cancel`, Priya): panel d1280 / c1280 `[450,138.22,380,523.56]` (one-line sub, as U1's `approval-disc`), t1024 `[322,122.22,380,523.56]`, t820 `[220,328.22,380,523.56]`, p390 `[5,320.44,380,523.56]`; head `[471,159.22,338,44.56]` (shield tile `[471,159.22,38,38]` `rgb(186,78,0)` on `rgb(255,242,232)`; "Manager approval" `[521,159.22,288,22]` 17px/600; sub `[521,184.22,288,19.56]` 13.5px, line-height 19.575 `rgb(82,82,91)`); managers row `[471,219.78,338,40]` ("Rohan" pill selected: `rgb(237,245,255)` / border `rgb(15,98,254)`). The Captain (`captain-cancel`) gets the same sheet. After `approval-ok` (PIN 1234): toast "Order cancelled · approved by Rohan" `[512.9,738,254.2,38]` (p390 `[67.9,666,254.2,38]`); the order moves to Cancelled.

---

## 16. Toasts

Element and timing: U0 §2.8 (`flash`, 2800 ms, `bottom:{{ L.toastB }}`, centred on the window, `white-space:nowrap`, `z-index:70`). **No toast on this screen has an Undo** (cancel and refund included). Measured height 38 everywhere; y 738 (d1280, c1280), 706 (t1024), 1050 (t820), 666 (p390).

| Trigger | Text (verbatim) | Measured box d1280 (width) | p390 |
|---|---|---|---|
| Print bill / Reprint bill (open order) | `'Bill printed · '+id` "Bill printed · Table 4" (also for "Reprint bill") | `[565.82,738,148.36,38]` (`toast-print-js`) | `[120.82,666,148.36,38]` |
| Reprint KOT | `'KOT reprinted · '+id` "KOT reprinted · Table 1" | `[556.97,738,166.06,38]` | `[111.97,666,166.06,38]` |
| Share bill, with customer | `'Bill sent on WhatsApp to '+name+' · '+fmtPh(phone)` "Bill sent on WhatsApp to Neha Joshi · +91 98201 23456" | `[453.38,738,373.25,38]` (`toast-share-js`) | `[8.38,666,373.25,38]` |
| Share bill, no customer | "Bill link copied · add a customer to send it on WhatsApp" | `[454.93,738,370.14,38]` | `[9.93,666,370.14,38]` |
| Reprint bill (closed) | `'Bill reprinted · #'+no` "Bill reprinted · #1035" | `[562.57,738,154.86,38]` | `[117.57,666,154.86,38]` |
| Cancel (Manager) | `id+' cancelled · '+RS(total)` "Table 7 cancelled · ₹439" | `[550.8,738,178.39,38]` | `[105.8,666,178.39,38]` |
| Refund (Manager) | `'Refund of '+RS(total)+' recorded'` "Refund of ₹879 recorded" | `[548.02,738,183.95,38]` | `[103.02,666,183.95,38]` |
| Collect (detail or row) | `RS(due)+' collected · #'+no` "₹954 collected · #1040" | `[554.98,738,170.03,38]` | `[109.98,666,170.03,38]` |
| Approval granted | "Order cancelled · approved by Rohan", "Refund recorded · approved by Rohan" | `[512.9,738,254.2,38]` | `[67.9,666,254.2,38]` |
| Payment completed (U1 §11.2) | "₹768 paid by Split"; "₹954 added to Neha Joshi’s dues · e-bill sent to +91 98201 23456" | `[569.34,738,141.31,38]`; `[421.21,738,437.58,38]` | `[124.34,666,141.31,38]`; **`[-23.79,666,437.58,38]`** (wider than the phone, cut at both edges) |

Other sizes: t1024 x = d1280 x − 128, y 706; t820 x = d1280 x − 230, y 1050 (e.g. "Table 7 cancelled · ₹439" `[422.8,706,…]` / `[320.8,1050,…]`). "Refund recorded · approved by Rohan" is from the source (`done+' · approved by '+first`, U1 §12.2); the refund approval was opened (`approval-refund`) but not completed.

---

## 17. Behaviours (what every control does, from the handlers)

| Control | Handler and effect |
|---|---|
| Lane card / strip tab | `oTab:k, oSel:null, oQ:''` — also **clears the search**. The selection falls back to the first row (≥ 1024) or none. |
| Strip action | Open lane: "Settle T1" → `settle(i)` (payment sheet for the first billed order). Due lane: "Collect" → `oSel = first due` (only opens its detail). |
| Search input | `oQ` on every keystroke, `oSel:null`; searching ignores the lane (all orders) and turns every lane off. |
| Search ✕ | `oQ:''` (selection kept). |
| Date select (and phone Date options) | `oDate`, `oSel:null`. Open orders ignore it. |
| Filters button / Done | toggle / close the popover (`oFOpen`). |
| Option pill | `oType` / `oPay` (/ `oDate`), `oSel:null`; popover stays open. |
| Table select | `oTbl`, `oSel:null`. |
| Reset, Clear all | `oType/oPay/oTbl:'All', oQ:'', oSel:null` (date kept). |
| Chip | clears its own filter only (`oSel` untouched). |
| Row (table or card) | `oSel = key` (a second tap keeps it selected; no toggle). Below 1024 this opens the sheet. |
| Row Settle | `settle(i)` → `active = i`, payment sheet; the row is not selected. |
| Row Collect | `collect(x)`: the history row gets `due:0, method:'Cash'` at once (no payment sheet, no method choice, no confirmation; the bill moves to Paid as "Paid · Cash"); toast `RS(due)+' collected · #'+no`. |
| Detail ✕ / sheet scrim | `oSel:'__none'` (below 1024 the sheet closes; at ≥ 1024 the first row would be selected again, so the ✕ is hidden there). |
| Print bill / Reprint bill (open) | order `billed:true` (re-sorted to the top of Open, still selected; status "Bill printed"; quick label becomes "Reprint bill"; step "Bill printed" done "Printed"); toast "Bill printed · {id}". Nothing is printed. |
| Reprint KOT | toast only (no kitchen ticket is made). |
| Share bill | toast only (texts in section 16): nothing is sent or copied. |
| Move table | `active = i, tablePick:true` → table picker (U1 §9: moving re-ids the order "Table n"). |
| + Add customer | `active = i`, then `openCust()` (customer sheet; picking attaches the customer, toast `{name} added to {id}`, U1 §8). |
| Cancel this order | Manager: a history row `{no, id, type, cust, by, guests, cart, disc, noSvc, method:'—', total, at:now, cancelled:true}` is added, the open order's `cart, disc, billed, cust, noSvc` are reset (the table's order record stays, empty, so it leaves the Open lane), `oSel:null`, toast `{id} cancelled · ₹x`. No confirmation, no Undo. Kitchen tickets are not touched. Others: approval (15). |
| Refund this bill | Manager: the history row gets `refunded:true` (stays in Paid with "Refunded"; a refunded due bill leaves Due for Paid); toast "Refund of ₹x recorded". No confirmation, no Undo. Others: approval. |
| Reprint bill (closed) | toast "Bill reprinted · #no". |
| Settle & pay | `settle(i)`. |
| Collect due · ₹x | `collect(x)` (as Row Collect). |
| Edit items | `route:'order', active:i, cartOpen:false` (U1 Order screen with that order). |
| New order (header) | U1 §14.2 `newOrder` (new Takeaway, route `order`). |
| Printer button | printer sheet (U0 §2.5). |

Keyboard: none of U1's shortcuts are handled on this route (`/`, F8, F9 are Order-only); Escape closes the U1 overlays but not the filters popover or the detail sheet (U1 §13.2 list has neither `oFOpen` nor `oSel`).

---

## 18. Roles

| | Manager (Rohan) | Cashier (Priya) | Captain (Amit) |
|---|---|---|---|
| Lands on after sign-in | Dashboard | Order | Floor |
| Row "Settle", strip "Settle T1", detail "Settle & pay · ₹x" | yes | yes | **no** (row button and strip action hidden; detail foot = "Edit items" alone, full width) |
| Row "Collect", strip "Collect", detail "Collect due · ₹x" | yes | yes | **yes** (not gated) |
| Cancel this order / Refund this bill | at once | Manager approval | Manager approval |
| Everything else | same | same | same |

Measured Captain (`captain`, `captain-sel`): table rows without the Settle button (c1280 `r0.act` hidden); strip current row 36 tall without its button (t1024 `[97,122,506,36]`, p390 `[13,118,364,36]`); detail foot `[881,725,399,75]` with "Edit items" `[899,738,363,48]` (t820 `[399,1118,403,48]`, p390 `[19,784,353,48]`, x1600 `[1219,838,363,48]`). Cashier (`cashier`) renders exactly like the Manager.

---

## 19. Data the screen reads

### 19.1 Open orders (`state.orders` with lines; U1 §14.5 for their lines)
| Row | no | type | customer (sub) | items text | opened | status | total |
|---|---|---|---|---|---|---|---|
| Table 1 | #1036 | Dine-in | Walk-in (4 guests) | 1× Butter Chicken +2 more | 8:22 PM, 1h 8m | Bill printed | ₹1,063 |
| Table 17 | #1037 | Dine-in | Walk-in (3 guests) | 1× Tandoori Chicken +1 more | 8:35 PM, 55 min | In kitchen | ₹767 |
| Table 6 | #1038 | Dine-in | Walk-in (2 guests) | 1× Chicken Biryani +1 more | 8:49 PM, 41 min | In kitchen | ₹768 |
| Table 4 | #1040 | Dine-in | Neha Joshi (+91 98201 23456) | 1× Margherita +2 more | 8:58 PM, 32 min | KOT pending | ₹954 |
| Table 13 | #1039 | Dine-in | Walk-in (4 guests) | 1× Paneer Butter Masala +1 more | 9:08 PM, 22 min | KOT pending | ₹536 |
| Table 7 | #1041 | Dine-in | Walk-in (2 guests) | 2× Chicken Zinger | 9:16 PM, 14 min | In kitchen | ₹439 |
| Delivery 3 | #1043 | Delivery | Karthik Iyer (+91 98209 98877) | 1× Farmhouse +2 more | 9:21 PM, 9 min | KOT pending | ₹901 |
| Takeaway 14 | #1044 | Takeaway | Simran Kaur (+91 90044 33221) | 1× Veg Steamed +1 more | 9:24 PM, 6 min | In kitchen | ₹312 |
(Shown in this order: billed first, then oldest. Takeaway 12 has no lines and is not listed.) Σ ₹5,740.

### 19.2 Closed orders (`seed()` history, all paid today)
| no | id | type | customer | lines | method | total | by | guests | at |
|---|---|---|---|---|---|---|---|---|---|
| #1035 | Table 12 | Dine-in | Simran Kaur (c11) | Paneer Tikka Pizza Medium ×1, Virgin Mojito ×2 | UPI | ₹879 | ananya | 2 | 8:16 PM |
| #1034 | Table 9 | Dine-in | – | Butter Chicken Full ×1, Garlic Naan ×4, Jeera Rice ×1 | Card | ₹1,019 | sana | 5 | 7:55 PM |
| #1033 | Delivery 1 | Delivery | Rahul Mehta (c2) | Farmhouse Medium ×1, Garlic Bread ×1 | UPI | ₹659 | priya | – | 7:40 PM |
| #1032 | Takeaway 8 | Takeaway | – ("No customer added") | Chicken Zinger ×2, French Fries Large ×1 | Cash | ₹595 | priya | – | 7:22 PM |
| #1031 | Table 3 | Dine-in | Aisha Khan (c3) | Margherita Large ×1, Cold Coffee ×2 | UPI | ₹779 | amit | 3 | 7:00 PM |
Σ ₹3,931, average ₹786. Totals use `totals()` with the order's type (service charge / packing / delivery fee, 5 % GST). The seed has no due, split, cancelled or refunded bill and nothing older than today, so the Due and Cancelled lanes start empty and the date filter changes only the Paid lane.

---

## 20. Mock-up quirks an implementer will meet (each needs the owner's ruling before it is copied or fixed)

1. **The table's Items column never shows at the five sizes**, and the expanded 1280 desktop gets **cards** (listW 608) while the collapsed 1280 desktop (764) and the 820 tablet (704) get the **table**; the Items column needs listW ≥ 900 (≥ 1572 px window with the nav expanded, ≥ 1416 collapsed; measured only at the extra 1600×900).
2. **Quick actions are squeezed and clipped at 1280×800 and 1024×768**: the grid has `overflow:hidden` inside the flex body, so it shrinks before the body scrolls; its buttons stay 62 tall and are cut (11.7: Table 1 shows 48 of 64 at 1280 and 16 at 1024; Table 4 16 and 2; labels cut, shot `default-1280x800.png`).
3. **A tap on a squeezed quick action can cancel the order**: the click at the button's centre falls below the clipped grid; for "Share bill" (third column) and "Reprint KOT" (second column, 1024) that point is on "Cancel this order", which for a Manager cancels at once with no confirmation and no Undo. Measured with real clicks: `toast-share` d1280 / c1280 / t1024 → "Table 4 cancelled · ₹954"; `toast-kot` t1024 → "Table 1 cancelled · ₹1,063"; "Print bill" (first column) and "Move table" (fourth) hit nothing (`toast-print`, `move-table` at those sizes: no effect).
4. **Row Settle / Collect and the strip action keep their text at the top** (`display:flex` without `align-items`; 0.5).
5. **Table rows have no hover look** (binding inside `style-hover`), card rows none at all; lane cards and Filters have one.
6. **At 820 the table's "#1043 · Delivery" sub wraps** (no `nowrap`) and those rows grow from 59 to 71 (21.3).
7. **At 1024 the toolbar wraps as soon as a filter count shows** (4.2).
8. **Lane-card sub ellipsised at the 1280 desktop** ("1 bill waiting to be …", 146 px cards) and the **phone header subtitle ellipsised** ("8 open · ₹5,740 · 5 paid · …").
9. **Header subtitle and lanes ignore search, filters and lane**; **open orders ignore the date filter**; **a payment filter never matches an open order** (Open + "Cash" is always empty).
10. **The detail has no entrance animation** at any size; on the phone the full-screen sheet covers the tab bar and its scrim is invisible underneath.
11. **The Due-payment toast is wider than the phone** (437.58 on 390: cut at both edges; `white-space:nowrap`).
12. **Paid lane: the amount excludes refunded bills but "Avg … per bill" includes them** (after a refund: "₹3,052" with "Avg ₹786 per bill" = ₹3,931 / 5; count still 5).
13. **The refund time is not stored**: the "Refunded" step shows the bill's time ("8:16 PM" for a 9:30 PM refund).
14. **A due (unpaid) bill offers "Refund this bill"**; refunding it moves it from Due to Paid as "Refunded".
15. **Closed-bill sums do not add up**: "Subtotal" is the pre-tax line sum, followed directly by "Paid by UPI ₹879" (no charges or GST rows): "Subtotal ₹797 … Bill total ₹879".
16. **Cancelled detail shows two dashed dividers with nothing between** (empty sums).
17. **Strip "Collect" only opens the first due bill**, while row "Collect" and "Collect due" collect at once, always as **Cash**, with no confirmation.
18. **A Captain cannot settle but can collect dues** (Collect is not role-gated).
19. **"Reprint bill" on an open billed order toasts "Bill printed · …"** (the closed-bill one says "Bill reprinted · #no"); **"Reprint KOT" and "Share bill" are toasts only**.
20. **Reset / Clear all do not reset the date**: the phone date chip survives them.
21. **Same state, different empty text on the phone**: the date is a chip there, so "Yesterday" + Paid reads "No orders match these filters / Remove a filter to see more." on 390 but "No paid orders yesterday / They will show up here as they happen." on the desktop (`date-yesterday-paid`).
22. **"All dates" leaves a trailing space and no qualifier**: "None ", "No payments ", "No cancelled orders ".
23. **"guests" has no singular** (`n+' guests'` in the row sub and the detail meta: a one-guest table would read "1 guests").
24. **The filters popover is in the page flow** (pushes the list; on the phone the list keeps 170 px) and has no outside-click or Escape close.
25. **The chip's ✕ circle colour is a literal** `rgba(15,98,254,.14)` (does not follow the accent or dark mode).
26. **Changing lane clears the search**; the search ✕ keeps the selection; picking a row while searching works across lanes.
27. **Cancel leaves the table's order record (empty) and the kitchen tickets** in place (source).
28. **A Due payment counts a customer visit** ("12 visits" → "13 visits").

---

## 21. Measured layout per viewport

### 21.1 Regions (state `default`; t820 / p390 detail = state `sel-t1`)
| Region | d1280 | c1280 | t1024 | t820 | p390 | x1600 (extra) |
|---|---|---|---|---|---|---|
| side nav / rail (U0 §2.3) | `[0,0,232,800]` | `[0,0,76,800]` | `[0,0,76,768]` | `[0,0,76,1180]` | hidden | 232 wide |
| page (Orders) | `[232,0,1048,800]` | `[76,0,1204,800]` | `[76,0,948,768]` | `[76,0,744,1180]` | `[0,0,390,844]` | `[232,0,1368,900]` |
| header | `[232,0,1048,56]` | `[76,0,1204,56]` | `[76,0,948,56]` | `[76,0,744,56]` | `[0,0,390,56]` | `[232,0,1368,56]` |
| body grid | `[232,56,1048,744]` `648px 400px` | `[76,56,1204,744]` `804px 400px` | `[76,56,948,712]` `548px 400px` | `[76,56,744,1124]` `744px` | `[0,56,390,788]` `390px` | `[232,56,1368,844]` `968px 400px` |
| list column | `[232,56,648,744]` | `[76,56,804,744]` | `[76,56,548,712]` | `[76,56,744,1124]` | `[0,56,390,788]` | `[232,56,968,844]` |
| top block | `[232,56,648,170]` | `[76,56,804,170]` | `[76,56,548,175]` | `[76,56,744,170]` | `[0,56,390,171]` | `[232,56,968,170]` |
| lanes | cards `[252,70,608,92]` | cards `[96,70,764,92]` | strip `[96,70,508,97]` | cards `[96,70,704,92]` | strip `[12,66,366,97]` | cards `[252,70,928,92]` |
| toolbar row | `[252,174,608,40]` | `[96,174,764,40]` | `[96,179,508,40]` | `[96,174,704,40]` | `[12,175,366,40]` | `[252,174,928,40]` |
| list scroller | `[232,226,648,574]` | `[76,226,804,574]` | `[76,231,548,537]` | `[76,226,744,954]` | `[0,227,390,617]` | `[232,226,968,674]` |
| list head | `[252,226,608,25]` | `[96,226,764,25]` | `[96,231,508,25]` | `[96,226,704,25]` | `[12,227,366,25]` | `[252,226,928,25]` |
| list box | `[252,251,608,729]` cards | `[96,251,764,508]` table | `[96,256,508,729]` cards | `[96,251,704,532]` table | `[12,252,366,729]` cards | `[252,251,928,532]` table |
| first row | `[253,252,606,90]` | head `[97,252,762,35]`, row `[97,287,762,58]` | `[97,257,506,90]` | head `[97,252,702,35]`, row `[97,287,702,58]` | `[13,253,364,90]` | head `[253,252,926,35]`, row `[253,287,926,58]` |
| detail | column `[880,56,400,744]` | column `[880,56,400,744]` | column `[624,56,400,712]` | sheet `[380,0,440,1180]` + scrim `[0,0,820,1180]` | sheet `[0,0,390,844]` + scrim | column `[1200,56,400,844]` |
| detail head / body / foot | `[881,56,399,190]` / `[881,246,399,479]` / `[881,725,399,75]` | same | `[625,56,399,190]` / `[625,246,399,447]` / `[625,693,399,75]` | `[381,0,439,190]` / `[381,190,439,915]` / `[381,1105,439,75]` | `[1,0,389,190]` / `[1,190,389,581]` / `[1,771,389,73]` | `[1201,56,399,190]` / `[1201,246,399,579]` / `[1201,825,399,75]` |
| tab bar (U0 §2.6) | – | – | – | – | `[0,785,390,59]` (under the sheet when open) | – |
| toast (when shown) | y 738, h 38 | y 738 | y 706 | y 1050 | y 666 | – |

### 21.2 Every measured state: what is open and the main panel box
Boxes: the detail sheet (below 1024), U1 overlay panels (first child of their scrim), the filters popover, the toast. "(page only)" = no overlay (the changes are in the page; see the section of that state). "·" = not run at that viewport.

| State | d1280 | c1280 | t1024 | t820 | p390 | x1600 |
|---|---|---|---|---|---|---|
| `default` | (page only) | (page only) | (page only) | (page only) | (page only) | (page only) |
| `lane-paid` | (page only) | (page only) | (page only) | (page only) | (page only) | (page only) |
| `lane-due` | (page only) | (page only) | (page only) | (page only) | (page only) | · |
| `lane-cancel` | (page only) | (page only) | (page only) | (page only) | (page only) | · |
| `sel-t1` | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]` | sheet `[0, 0, 390, 844]` | · |
| `sel-t4` | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]` | sheet `[0, 0, 390, 844]` | · |
| `sel-t7` | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]` | sheet `[0, 0, 390, 844]` | · |
| `sel-dl3` | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]` | sheet `[0, 0, 390, 844]` | · |
| `sel-paid` | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]` | sheet `[0, 0, 390, 844]` | · |
| `sel-new-unsent` | (page only) | · | · | sheet `[380, 0, 440, 1180]` | sheet `[0, 0, 390, 844]` | · |
| `due-done` | toast `[421.21,738,437.58,38]` | toast `[421.21,738,437.58,38]` | toast `[293.21,706,437.58,38]` | toast `[191.21,1050,437.58,38]` | toast `[-23.79,666,437.58,38]` | · |
| `lane-due-filled` | (page only) | (page only) | (page only) | (page only) | (page only) | (page only) |
| `sel-due` | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]` | sheet `[0, 0, 390, 844]` | · |
| `collect-done` | toast `[554.98,738,170.03,38]` | toast `[554.98,738,170.03,38]` | toast `[426.98,706,170.03,38]` | toast `[324.98,1050,170.03,38]` | toast `[109.98,666,170.03,38]` | · |
| `row-collect` | · | toast `[554.98,738,170.03,38]` | · | toast `[324.98,1050,170.03,38]` | · | · |
| `strip-collect` | · | · | (page only) | · | sheet `[0, 0, 390, 844]` | · |
| `split-done` | toast `[569.34,738,141.31,38]` | · | · | · | toast `[124.34,666,141.31,38]` | · |
| `sel-split` | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]` | sheet `[0, 0, 390, 844]` | · |
| `cancel-done` | toast `[550.8,738,178.39,38]` | toast `[550.8,738,178.39,38]` | toast `[422.8,706,178.39,38]` | toast `[320.8,1050,178.39,38]` | toast `[105.8,666,178.39,38]` | · |
| `lane-cancel-filled` | (page only) | (page only) | (page only) | (page only) | (page only) | · |
| `sel-cancel` | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]` | sheet `[0, 0, 390, 844]` | · |
| `refund-done` | toast `[548.02,738,183.95,38]` | toast `[548.02,738,183.95,38]` | toast `[420.02,706,183.95,38]` | sheet `[380, 0, 440, 1180]`<br>toast `[318.02,1050,183.95,38]` | sheet `[0, 0, 390, 844]`<br>toast `[103.02,666,183.95,38]` | · |
| `sel-refund` | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]` | sheet `[0, 0, 390, 844]` | · |
| `search` | (page only) | (page only) | (page only) | (page only) | (page only) | (page only) |
| `search-one` | (page only) | (page only) | (page only) | (page only) | (page only) | · |
| `search-none` | (page only) | (page only) | (page only) | (page only) | (page only) | · |
| `search-phone` | (page only) | · | · | · | · | · |
| `search-clear` | (page only) | · | · | · | (page only) | · |
| `filters` | filters `[252, 226, 608, 290]` | filters `[96, 226, 764, 290]` | filters `[96, 231, 508, 290]` | filters `[96, 226, 704, 290]` | filters `[12, 227, 366, 435]` | · |
| `filters-sel` | filters `[252, 226, 608, 290]` | filters `[96, 226, 764, 290]` | filters `[96, 279, 508, 290]` | filters `[96, 226, 704, 290]` | filters `[12, 227, 366, 435]` | · |
| `filter-chip` | (page only) | (page only) | (page only) | (page only) | (page only) | · |
| `filter-empty` | (page only) | (page only) | (page only) | (page only) | (page only) | · |
| `filter-two` | (page only) | · | · | · | (page only) | · |
| `date-yesterday` | (page only) | (page only) | (page only) | (page only) | (page only) | · |
| `date-yesterday-paid` | (page only) | (page only) | (page only) | (page only) | (page only) | · |
| `date-all-cancel` | (page only) | · | · | · | (page only) | · |
| `date-week-cancel` | (page only) | · | · | · | · | · |
| `table-sel` | filters `[252, 226, 608, 290]` | filters `[96, 226, 764, 290]` | filters `[96, 279, 508, 290]` | filters `[96, 226, 704, 290]` | filters `[12, 227, 366, 435]` | · |
| `table-done` | (page only) | (page only) | (page only) | (page only) | (page only) | · |
| `sheet-close` | · | · | · | (page only) | (page only) | · |
| `sheet-scrim` | · | · | · | (page only) | · | · |
| `hover-row` | (page only) | (page only) | · | · | · | · |
| `hover-lane` | (page only) | · | · | · | · | · |
| `hover-settle` | · | (page only) | · | · | · | · |
| `hover-fbtn` | (page only) | · | · | · | · | · |
| `hover-new` | (page only) | · | · | · | · | · |
| `hover-quick` | (page only) | · | · | · | · | · |
| `hover-danger` | (page only) | · | · | · | · | · |
| `hover-primary` | (page only) | · | · | · | · | · |
| `hover-second` | (page only) | · | · | · | · | · |
| `hover-addcust` | (page only) | · | · | · | · | · |
| `toast-print` | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]`<br>toast `[335.82,1050,148.36,38]` | sheet `[0, 0, 390, 844]`<br>toast `[120.82,666,148.36,38]` | · |
| `toast-kot` | toast `[556.97,738,166.06,38]` | toast `[556.97,738,166.06,38]` | toast `[417.39,706,189.22,38]` | sheet `[380, 0, 440, 1180]`<br>toast `[326.97,1050,166.06,38]` | sheet `[0, 0, 390, 844]`<br>toast `[111.97,666,166.06,38]` | · |
| `toast-share` | toast `[550.8,738,178.39,38]` | toast `[550.8,738,178.39,38]` | toast `[422.8,706,178.39,38]` | sheet `[380, 0, 440, 1180]`<br>toast `[223.38,1050,373.25,38]` | sheet `[0, 0, 390, 844]`<br>toast `[8.38,666,373.25,38]` | · |
| `toast-share-walkin` | toast `[454.93,738,370.14,38]` | · | · | · | sheet `[0, 0, 390, 844]`<br>toast `[9.93,666,370.14,38]` | · |
| `toast-reprint-paid` | toast `[562.57,738,154.86,38]` | · | · | · | sheet `[0, 0, 390, 844]`<br>toast `[117.57,666,154.86,38]` | · |
| `move-table` | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]`<br>tablePicker `[110,234.5,600,711]` | sheet `[0, 0, 390, 844]`<br>tablePicker `[0,101.28,390,742.72]` | · |
| `pay-detail` | payment `[430,148.5,420,503]` | payment `[430,148.5,420,503]` | payment `[302,132.5,420,503]` | sheet `[380, 0, 440, 1180]`<br>payment `[200,338.5,420,503]` | sheet `[0, 0, 390, 844]`<br>payment `[0,343,390,501]` | · |
| `pay-row` | · | payment `[430,148.5,420,503]` | · | payment `[200,338.5,420,503]` | · | · |
| `pay-strip` | · | · | payment `[302,132.5,420,503]` | · | payment `[0,343,390,501]` | · |
| `cust-detail` | customer `[410,100,460,600]` | customer `[410,100,460,600]` | customer `[282,84,460,600]` | sheet `[380, 0, 440, 1180]`<br>customer `[180,290,460,600]` | sheet `[0, 0, 390, 844]`<br>customer `[0,101.28,390,742.72]` | · |
| `pay-dl-nocust` | customer `[410,100,460,600]` | · | · | · | · | · |
| `edit-items` | route order | · | · | · | z10 `[14,732.5,215.94,39]`<br>route order | · |
| `approval-cancel` (Priya S.) | approval `[450,138.22,380,523.56]` | approval `[450,138.22,380,523.56]` | approval `[322,122.22,380,523.56]` | sheet `[380, 0, 440, 1180]`<br>approval `[220,328.22,380,523.56]` | sheet `[0, 0, 390, 844]`<br>approval `[5,320.44,380,523.56]` | · |
| `approval-refund` (Priya S.) | approval `[450,138.22,380,523.56]` | · | · | · | sheet `[0, 0, 390, 844]`<br>approval `[5,320.44,380,523.56]` | · |
| `approval-ok` (Priya S.) | toast `[512.9,738,254.2,38]` | · | · | · | toast `[67.9,666,254.2,38]` | · |
| `cashier` (Priya S.) | (page only) | (page only) | · | · | (page only) | · |
| `captain` (Amit V.) | (page only) | (page only) | (page only) | (page only) | (page only) | (page only) |
| `captain-sel` (Amit V.) | (page only) | (page only) | (page only) | sheet `[380, 0, 440, 1180]` | sheet `[0, 0, 390, 844]` | · |
| `captain-cancel` (Amit V.) | approval `[450,138.22,380,523.56]` | · | · | · | sheet `[0, 0, 390, 844]`<br>approval `[5,320.44,380,523.56]` | · |
| `toast-print-js` | toast `[565.82,738,148.36,38]` | toast `[565.82,738,148.36,38]` | toast `[437.82,706,148.36,38]` | · | · | · |
| `toast-share-js` | toast `[453.38,738,373.25,38]` | toast `[453.38,738,373.25,38]` | toast `[325.38,706,373.25,38]` | · | · | · |
| `toast-kot-js` | toast `[556.97,738,166.06,38]` | toast `[556.97,738,166.06,38]` | toast `[428.97,706,166.06,38]` | · | · | · |
| `move-table-js` | tablePicker `[340,44.5,600,711]` | tablePicker `[340,44.5,600,711]` | tablePicker `[212,28.5,600,711]` | · | · | · |
| `rows-all` | (page only) | (page only) | (page only) | (page only) | (page only) | · |
| `rows-all-paid` | · | (page only) | · | (page only) | · | · |

Notes on the table: `toast-share` at d1280 / c1280 / t1024 and `toast-kot` at t1024 show a **cancel** toast: those real clicks hit "Cancel this order" (20 #3); `toast-print` and `move-table` at d1280 / c1280 / t1024 show "(page only)" because the real click hit nothing; the `-js` states give the intended results. `sel-dl3` and `sel-new-unsent` were run with the row first scrolled to the scroller's centre (on the phone a row below the sixth card otherwise ends under the fixed tab bar and the click lands on the "Order" tab: a measuring artefact, not an HTML behaviour).

### 21.3 Row heights (states `rows-all`, `rows-all-paid`: every row's y + height)
| | rows |
|---|---|
| c1280, open | head 252+35; rows 287+58, then 59 each (345, 404, 463, 522, 581, 640, 699) |
| t820, open | head 252+35; 287+58, 345+59, 404+59, 463+59, 522+59, 581+59, **640+71 (Delivery 3), 711+71 (Takeaway 14)** |
| t820, paid | head 252+35; 287+58, 345+59, **404+71 (Delivery 1), 475+71 (Takeaway 8)**, 546+59 |
| c1280, paid | head 252+35; 287+58, then 59 each |
| t1024 cards, open | 257+90, then 91 each (347 … 893) |
| d1280 / p390 cards | 90, then 91 each (as t1024) |

---

## 22. Reference shots (`D:\kd\pos-dev-keep\ui-redesign\design\spec-shots-orders\`, 270 files)
Names are `<state>-<w>x<h>.png` (`-1280x800-collapsed` for the collapsed nav, `-1600x900` for the extra viewport); state names as in `make-shoot-orders.mjs` / 21.2. "×5" = 1280x800, 1280x800-collapsed, 1024x768, 820x1180, 390x844.
- Lanes and lists: `default` ×5 + 1600; `lane-paid` ×5 + 1600; `lane-due` ×5; `lane-cancel` ×5; `lane-due-filled` ×5 + 1600; `lane-cancel-filled` ×5; `rows-all` ×5; `rows-all-paid` (collapsed, 820).
- Selected orders (detail; sheet at 820 / 390): `sel-t1` ×5; `sel-t4` ×5; `sel-t7` ×5; `sel-dl3` ×5; `sel-paid` ×5; `sel-due` ×5; `sel-split` ×5; `sel-cancel` ×5; `sel-refund` ×5; `sel-new-unsent` (1280, 820, 390).
- Actions and toasts: `due-done` ×5; `collect-done` ×5; `row-collect` (collapsed, 820); `strip-collect` (1024, 390); `split-done` (1280, 390); `cancel-done` ×5; `refund-done` ×5; `toast-print` ×5; `toast-kot` ×5; `toast-share` ×5; `toast-share-walkin`, `toast-reprint-paid` (1280, 390); `toast-print-js`, `toast-share-js`, `toast-kot-js` (1280, collapsed, 1024).
- Search: `search` ×5 + 1600; `search-one` ×5; `search-none` ×5; `search-phone` (1280); `search-clear` (1280, 390).
- Filters, chips, date, table: `filters` ×5; `filters-sel` ×5; `filter-chip` ×5; `filter-empty` ×5; `filter-two` (1280, 390); `date-yesterday` ×5; `date-yesterday-paid` ×5; `date-all-cancel` (1280, 390); `date-week-cancel` (1280); `table-sel` ×5; `table-done` ×5.
- Sheet: `sheet-close` (820, 390); `sheet-scrim` (820).
- Hover (1280 unless noted): `hover-row` (1280, collapsed); `hover-lane`; `hover-settle` (collapsed); `hover-fbtn`; `hover-new`; `hover-quick`; `hover-danger`; `hover-primary`; `hover-second`; `hover-addcust`.
- Overlays from Orders: `move-table` ×5; `move-table-js` (1280, collapsed, 1024); `pay-detail` ×5; `pay-row` (collapsed, 820); `pay-strip` (1024, 390); `cust-detail` ×5; `pay-dl-nocust` (1280); `edit-items` (1280, 390: the Order screen).
- Roles: `approval-cancel` ×5 (Priya); `approval-refund`, `approval-ok` (1280, 390; Priya); `cashier` (1280, collapsed, 390); `captain` ×5 + 1600 (Amit); `captain-sel` ×5; `captain-cancel` (1280, 390).

---

## Values I could not determine
- The Items column at any of the five target sizes: it never renders there (0.2); its look was measured only at the extra 1600×900 viewport.
- `env(safe-area-inset-bottom)` was 0 in every measurement (detail foot padding on the phone, U1 overlays); real-device insets were not measured.
- Device-pixel-ratio 2: the `1.5px dashed` dividers drew as 1 px at DPR 1.
- Dark theme: only the light theme was measured (token values in U0 §1.1). The chip ✕ circle's literal `rgba(15,98,254,.14)` would not change in dark.
- The native `<select>` drop-down lists (date, table) are drawn by the browser and were not measured; only the closed controls and their option values / labels are recorded.
- History older than today: the seed has none, so "Yesterday" / "Last 7 days" with real older bills, the closed-row date text (the `day month` form of `age`) and the strip's "Settle Takeaway 14" form (needs a billed takeaway) are source-only.
- The refund approval was opened but not completed; its toast text is from the source.
- Clock-dependent values only at Mon 19 Oct 2026 9:30 PM IST (formulas in 0.1).
- Animation in-between frames (`pageIn`, the popover's `rise`, the scrim's `fadeIn`, `toastIn`) were not measured, only end states; the detail sheet has no animation of its own.
- Pressed (`:active`) looks: only the global `scale(.97)` rule applies on this screen (no `style-active` strings); not measured.
- Hover on touch viewports was not measured (a finger produces none); all hover states were run at 1280.
- A long list (many more rows than the demo's 8 open / 5 paid) was not measured; by its styles the list head is not sticky.
