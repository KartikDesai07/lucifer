# The owner's HTML mock-up, exact values (theme, shell, dashboard, sign-in and lock)

Source files (read-only): `unpacked/markup.html` (template, `{{ }}` bindings, `<sc-if>` / `<sc-for>`), `unpacked/app.js` (component class, `Lay` object returned to the template as `L`, `dashVals()` returning `db`, `renderVals()`), original bundle `olivea-pos-latest.html` (its `__bundler/template` block holds the `@font-face` rules and the component `data-props` defaults that `unpacked/markup.html` does not contain).

How values were obtained:
- Every value without a "measured" mark is copied from the source text.
- "Measured" values come from rendering `olivea-pos-latest.html` in headless local Chrome (playwright-core, every non-`file:` request blocked) on Mon 19 Oct 2026 between 12:19 and 12:32 IST, reading `getBoundingClientRect()` / `getComputedStyle()`. Rects are written `[x, y, width, height]` in CSS px. 390×844 was run with `isMobile`+`hasTouch`; the other viewports as plain desktop. Headless Chrome draws no classic scrollbars, so the `::-webkit-scrollbar{width:8px}` rule took no layout width in any measurement (`clientWidth` of the dashboard scroller = its full width).
- Data that depends on the clock (chart bars, "x min ago", times, greeting, dates) is shown as rendered at that time and given with its formula.

Reference shots: `D:\kd\pos-dev-keep\ui-redesign\design\spec-shots\` (index in section 6).

---

## 0. Conventions that affect every part

### 0.1 Breakpoint variables (app.js `renderVals`, line 740–742)

| Variable | Expression | 1280×800 | 1280×800 nav collapsed | 1024×768 | 820×1180 | 390×844 |
|---|---|---|---|---|---|---|
| `ph` | `s.w<720` | false | false | false | false | true |
| `tab` | `s.w>=720&&s.w<1100` | false | false | true | true | false |
| `desk` | `s.w>=1100` | true | true | false | false | false |
| `wide` | `s.w>=1280&&!s.navCollapsed` | true | false | false | false | false |
| `cmp` | `s.w<1024` | false | false | false | true | true |
| `big` | `s.w>=1024` | true | true | true | false | false |
| `cw` (dashboard only, `dashVals` line 622) | `ph?s.w:s.w-(wide?232:76)` | 1048 | 1204 | 948 | 744 | 390 |
| `xs` (dashboard only) | `cw<560` | false | false | false | false | true |

`s.w` / `s.h` = `window.innerWidth` / `window.innerHeight` (updated on resize, ResizeObserver, and every 800 ms).

### 0.2 Interpolation wrapper (measured)
The template runtime wraps every `{{ }}` interpolation in `<span class="sc-interp">`. Where a binding sits directly inside a `display:flex` element next to literal text, the literal text and the binding become separate flex items and the container `gap` is inserted between them (leading/trailing spaces of the literal are trimmed at the item edge). In-scope occurrences, all visible in the shots:
- Hero delta row (`gap:8px`): pill · 8px · `vs` · 8px · `{{ db.P.cmp }}` (measured: pill ends x 351.17, "last Monday" starts x 380.56 at 1280).
- More/profile sheet status line (`gap:6px`): dot · 6px · `{{ me.role }}` · 6px · `· signed in at` · 6px · `{{ me.sinceTxt }}`.
- Live tables legend items (`gap:6px`): swatch · 6px · `{{ g.label }}` · 6px · `<b>{{ g.n }}</b>`.

### 0.3 Line height
Nothing sets `line-height` globally; every text without an explicit value uses `line-height: normal`. Measured `normal` for the embedded fonts: Geist = 1.3 × font-size, Geist Mono = 1.3, Shrikhand = 1.458. Rendered Geist line-box heights (measured): 10.5px→14, 11px→14, 11.5px→15, 12px→16, 12.5px→17, 13px→17, 13.5px→18, 14px→18, 15px→19, 17px→22, 18px→23, 20px→26, 22px→28, 24px→31, 26px→34. (Tailwind preflight sets `line-height:1.5` on `html`; reproduce `normal`.)

### 0.4 Hover/active attributes
`style-hover="…"` / `style-active="…"` on an element = those declarations applied on `:hover` / `:active` (runtime turns them into a class, e.g. `class="scp0"`). All `button`s also get the global transition and `:active` scale (section 1.4).

### 0.5 Component props (defaults from the bundle's `data-props`)
`productName` "Sandbee POS" · `restaurantName` "Olivea Pizza" · `theme` "Light" (options Light, Dark, System) · `accent` "#0F62FE" (options #1F5C3A, #0F62FE, #161616) · `menuPhotos` "Show" · `offline` false. `restInitial = restaurantName[0]` = "O".

---

## 1. Theme

### 1.1 `:root` variables (light; `color-scheme:light`). Dark values (`:root[data-theme="dark"]`, `color-scheme:dark`) given for reference.

| Variable | Light | Dark |
|---|---|---|
| `--brand-nav` | `#FF6B4A` | (not redefined: `#FF6B4A`) |
| `--bg` | `#F4F4F5` | `#0E0E10` |
| `--surface` | `#FFFFFF` | `#17171A` |
| `--surface-2` | `#FAFAFA` | `#1C1C20` |
| `--surface-3` | `#E9E9EC` | `#27272B` |
| `--hover` | `#F2F2F4` | `#222226` |
| `--border` | `#E2E2E6` | `#2E2E33` |
| `--border-2` | `#ECECEF` | `#242428` |
| `--text` | `#18181B` | `#F4F4F5` |
| `--text-2` | `#52525B` | `#A9A9B2` |
| `--text-3` | `#6B6B74` | `#80808A` |
| `--ink` | `#18181B` | `#F4F4F5` |
| `--on-ink` | `#FFFFFF` | `#0E0E10` |
| `--seg` | `#FFFFFF` | `#3A3A40` |
| `--seg-sh` | `0 1px 2px rgba(0,0,0,.12),0 0 0 .5px rgba(0,0,0,.04)` | `0 1px 2px rgba(0,0,0,.5)` |
| `--accent` | `#0F62FE` | `#0F62FE` |
| `--accent-h` | `#0043CE` | `#4589FF` |
| `--accent-t` | `#EDF5FF` | `rgba(69,137,255,.16)` |
| `--accent-i` | `#0043CE` | `#A6C8FF` |
| `--accent-b` | `#A6C8FF` | `rgba(69,137,255,.55)` |
| `--link` | `#0F62FE` | `#78A9FF` |
| `--on-accent` | `#FFFFFF` | `#FFFFFF` |
| `--nav` | `#111113` | `#08080A` |
| `--nav-2` | `#27272A` | `#202024` |
| `--nav-t` | `#C8C8CC` | `#A9A9B2` |
| `--nav-t2` | `#8B8B93` | `#73737C` |
| `--nav-on` | `rgba(255,255,255,.09)` | `rgba(255,255,255,.08)` |
| `--ok` | `#24A148` | `#42BE65` |
| `--ok-i` | `#198038` | `#6FDC8C` |
| `--ok-t` | `#DEFBE6` | `rgba(66,190,101,.14)` |
| `--warn` | `#FF832B` | `#FF832B` |
| `--warn-i` | `#BA4E00` | `#FFB784` |
| `--warn-t` | `#FFF2E8` | `rgba(255,131,43,.14)` |
| `--bad` | `#DA1E28` | `#FA4D56` |
| `--bad-i` | `#A2191F` | `#FF8389` |
| `--bad-t` | `#FFF1F1` | `rgba(250,77,86,.14)` |
| `--info` | `#0F62FE` | `#4589FF` |
| `--info-i` | `#0043CE` | `#A6C8FF` |
| `--info-t` | `#EDF5FF` | `rgba(69,137,255,.13)` |
| `--info-b` | `#A6C8FF` | `rgba(69,137,255,.45)` |
| `--bill` | `#B28600` | `#F1C21B` |
| `--bill-i` | `#8E6A00` | `#F1C21B` |
| `--bill-t` | `#FCF4D6` | `rgba(241,194,27,.1)` |
| `--bill-b` | `#F1C21B` | `rgba(241,194,27,.45)` |
| `--res` | `#8A3FFC` | `#A56EFF` |
| `--res-i` | `#6929C4` | `#BE95FF` |
| `--res-t` | `#F6F2FF` | `rgba(165,110,255,.13)` |
| `--res-b` | `#D4BBFF` | `rgba(165,110,255,.45)` |
| `--veg` | `#198038` | `#42BE65` |
| `--nonveg` | `#A2191F` | `#FF8389` |
| `--scrim` | `rgba(17,17,19,.42)` | `rgba(0,0,0,.62)` |
| `--pop` | `0 24px 60px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.04)` | `0 24px 60px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.06)` |
| `--glass` | `rgba(255,255,255,.9)` | `rgba(23,23,26,.9)` |
| `--toast` | `#18181B` | `#F2F2F3` |
| `--toast-t` | `#FFFFFF` | `#0F0F10` |
| `--toast-a` | `#A9C8B2` | `#6FAF85` |
| `--brand` | `#C8381F` | `#FF7B5E` |

### 1.2 Runtime accent override (`applyTheme`, app.js line 118)
On mount/update the component sets `document.documentElement.dataset.theme` (`dark` if theme mode is Dark, or System and `prefers-color-scheme: dark` matches; otherwise `light`) and writes inline custom properties on `<html>` from `ACC[accent][l|d]`: `--accent, --accent-h, --accent-t, --accent-i, --accent-b, --link, --on-accent`. Accent = `state.accentO || props.accent || '#1F5C3A'`; with the default prop `#0F62FE` the inline values equal the `:root` values. Measured inline style at 1280: `--accent: #0F62FE; --accent-h: #0043CE; --accent-t: #EDF5FF; --accent-i: #0043CE; --accent-b: #A6C8FF; --link: #0F62FE; --on-accent: #FFFFFF;`, `data-theme="light"`.

`ACC` (light / dark):
- `#1F5C3A`: l `accent #1F5C3A, accent-h #164A2E, accent-t #E7F2EB, accent-i #164A2E, accent-b #A3CBB0, link #1F5C3A, on-accent #FFFFFF`; d `#5FB282, #79C597, rgba(95,178,130,.15), #A6DCBB, rgba(95,178,130,.5), #79C597, #0B130E`.
- `#0F62FE`: l `#0F62FE, #0043CE, #EDF5FF, #0043CE, #A6C8FF, #0F62FE, #FFFFFF`; d `#0F62FE, #4589FF, rgba(69,137,255,.16), #A6C8FF, rgba(69,137,255,.55), #78A9FF, #FFFFFF`.
- `#4F46E5`: l `#4F46E5, #4338CA, #EEF2FF, #4338CA, #C7D2FE, #4F46E5, #FFFFFF`; d `#5B55F0, #7C78FF, rgba(124,120,255,.16), #C7C5FF, rgba(124,120,255,.55), #A5A2FF, #FFFFFF`.
- `#161616`: l `#161616, #393939, #EFEFEF, #161616, #8D8D8D, #161616, #FFFFFF`; d `#F2F2F3, #FFFFFF, rgba(255,255,255,.1), #F2F2F3, rgba(255,255,255,.45), #F2F2F3, #0F0F10`.

Theme option buttons (profile sheet) set `state.themeO` to `Light` / `Dark` / `System`.

### 1.3 Fonts (embedded woff2 in the bundle, `font-display: swap`, subsets cyrillic-ext, cyrillic, vietnamese, latin-ext, latin)
- `Geist` weights 400, 500, 600, 700 (normal style).
- `Geist Mono` weights 400, 500, 600.
- `Shrikhand` 400.
Measured loaded faces on the dashboard: Geist 400/500/600, Geist Mono 400/500/600, Shrikhand 400.
Stacks used: body `'Geist',system-ui,-apple-system,'Segoe UI',sans-serif`; numbers `'Geist Mono',ui-monospace,monospace`; kbd chip `'Geist Mono',monospace`; brand `'Shrikhand',Georgia,serif`.
Viewport meta: `width=device-width, initial-scale=1, viewport-fit=cover`.

### 1.4 Global rules (verbatim)
```css
html,body{margin:0;height:100%;background:var(--bg);font-family:'Geist',system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--text);-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;font-variant-numeric:tabular-nums}
*{box-sizing:border-box}
a{color:var(--link)}a:hover{color:var(--accent-h)}
[data-photo="show"]:has(> image-slot:not([data-filled])){display:none}
[data-photo] image-slot:not([data-filled]){color:var(--text-3)}
input::placeholder{color:var(--text-3)}
button,input{font-family:inherit;font-variant-numeric:tabular-nums}
button:disabled{cursor:not-allowed}
::-webkit-scrollbar{width:8px;height:0}::-webkit-scrollbar-thumb{background:var(--border);border-radius:8px}
button{transition:background-color .16s ease,border-color .16s ease,color .16s ease,box-shadow .22s ease,transform .16s ease,opacity .16s ease}
button:not(:disabled):active{transform:scale(.97)}
@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
```

### 1.5 Keyframes used by the in-scope parts (verbatim)
```css
@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(3px)}}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes pageIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes growY{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes growX{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes sheetIn{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}
@keyframes unlock{to{opacity:0;transform:scale(1.08);filter:blur(12px)}}
@keyframes toastIn{from{opacity:0;transform:translate(-50%,16px) scale(.95)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(36,161,72,.45)}70%{box-shadow:0 0 0 7px rgba(36,161,72,0)}100%{box-shadow:0 0 0 0 rgba(36,161,72,0)}}
```
Defined but not used by the in-scope parts: `pop`, `drift1`, `drift2`, `blink`, `ringOut`, `lineIn`, `float`, `print`, `spin`, `stampIn`, `steam`, `drop`, `swing`, `pull`, `shakeA`, `shakeB`, `stamp`.
Shared easing: `cubic-bezier(.2,.8,.2,1)` (rise, pageIn, sheetIn, toastIn, chart grow); lock fade-out `cubic-bezier(.4,0,.2,1)`.

### 1.6 Shared constants
- `SEG_ON = {bg:'var(--seg)', shadow:'var(--seg-sh)'}`, `SEG_OFF = {bg:'transparent', shadow:'none'}` (segmented controls).
- Staff avatar colours: `avBg(h) = color-mix(in srgb, h 18%, var(--surface))`, `avFg(h) = color-mix(in srgb, h 80%, var(--text))`. Computed light values (and measured for #8A3FFC = `rgb(234,220,254)`, #1F5C3A = `rgb(215,226,220)` / `rgb(30,78,52)`):

| Hue | avBg (light) | avFg (light) |
|---|---|---|
| `#1F5C3A` | `#D7E2DC` | `#1E4E34` |
| `#007D79` | `#D1E8E7` | `#056966` |
| `#8A3FFC` | `#EADCFE` | `#7337CF` |
| `#D12771` | `#F7D8E5` | `#AC2460` |
| `#1192E8` | `#D4EBFB` | `#127ABF` |
| `#B28600` | `#F1E9D1` | `#937005` |
| `#198038` | `#D6E8DB` | `#196B32` |
| `#BA4E00` | `#F3DFD1` | `#9A4305` |

- Staff (`STAFF0`, hue = `HUES[i%8]`, pin `1234`, status `on`, `since = now − (30 + i×17) min`): rohan "Rohan Kapoor" Manager #1F5C3A · meera "Meera Iyer" Manager #007D79 · priya "Priya Sharma" Cashier #8A3FFC · neha "Neha Joshi" Cashier #D12771 · ishita "Ishita Desai" Cashier #1192E8 · amit "Amit Verma" Captain #B28600 · sana "Sana Khan" Captain #198038 · ananya "Ananya Bose" Captain #BA4E00 · arjun "Arjun Mehta" Captain #1F5C3A · karan "Karan Singh" Captain #007D79 · kavya "Kavya Nair" Captain #8A3FFC · rahul "Rahul Gupta" Captain #D12771.
- Initials `ini2(n)` = first letter of each word, first 2, upper-case.
- Money `RS(n)` = `'₹'+Math.round(n).toLocaleString('en-IN')`.
- Time `hm(d)` = `((h%12)||12)+':'+mm+(h<12?' AM':' PM')`.
- `ago(t)`: `<1 min` → `just now`, else `{m} min ago` (minutes, no hour rollover).

---

## 2. App shell

### 2.1 Layout object `L` (= `Lay`) values that touch the shell, resolved per viewport

| Key | Expression | 1280 | 1280 collapsed | 1024 | 820 | 390 |
|---|---|---|---|---|---|---|
| `rootCols` | `ph?'minmax(0,1fr)':(wide?'232px minmax(0,1fr)':'76px minmax(0,1fr)')` | `232px minmax(0,1fr)` | `76px minmax(0,1fr)` | `76px minmax(0,1fr)` | `76px minmax(0,1fr)` | `minmax(0,1fr)` |
| `railDisplay` | `ph?'none':'flex'` | flex | flex | flex | flex | none |
| `navPad` | `wide?'12px 10px':'12px 8px'` | `12px 10px` | `12px 8px` | `12px 8px` | `12px 8px` | (hidden) |
| `navJustify` | `wide?'flex-start':'center'` | flex-start | center | center | center | – |
| `wideFlex` | `wide?'flex':'none'` | flex | none | none | none | – |
| `wideInline` | `wide?'inline':'none'` | inline | none | none | none | – |
| `navDir` | `wide?'row':'column'` | row | column | column | column | – |
| `navGap` | `wide?'10px':'4px'` | 10px | 4px | 4px | 4px | – |
| `navItemPad` | `wide?'0 10px':'8px 0 6px'` | `0 10px` | `8px 0 6px` | `8px 0 6px` | `8px 0 6px` | – |
| `navItemH` | `wide?'38px':'0'` | 38px | 0 | 0 | 0 | – |
| `navFont` | `wide?'13.5px':'10.5px'` | 13.5px | 10.5px | 10.5px | 10.5px | – |
| `navLabelFlex` | `wide?'1':'none'` | 1 | none | none | none | – |
| `collapseDisplay` | `s.w>=1280?'flex':'none'` | flex | flex | none | none | none |
| `meCardPad` | `wide?'8px':'6px 0'` | 8px | `6px 0` | `6px 0` | `6px 0` | – |
| `barLeft` | `wide?'-10px':'-8px'` | -10px | -8px | -8px | -8px | – |
| `headPad` | `ph?'0 12px':'0 20px'` | `0 20px` | `0 20px` | `0 20px` | `0 20px` | `0 12px` |
| `miniLogo` | `ph?'flex':'none'` | none | none | none | none | flex |
| `pagePad` | `ph?'16px 14px':'20px 24px'` | `20px 24px` | `20px 24px` | `20px 24px` | `20px 24px` | `16px 14px` |
| `screenPadB` | `ph?'92px':'28px'` | 28px | 28px | 28px | 28px | 92px |
| `menuScrim` | `ph?'var(--scrim)':'transparent'` | transparent | transparent | transparent | transparent | var(--scrim) |
| `menuLeft` | `ph?'0':(wide?'12px':'84px')` | 12px | 84px | 84px | 84px | 0 |
| `menuRight` | `ph?'0':'auto'` | auto | auto | auto | auto | 0 |
| `menuBottom` | `ph?'0':(wide?'70px':'12px')` | 70px | 12px | 12px | 12px | 0 |
| `menuW` | `ph?'auto':'310px'` | 310px | 310px | 310px | 310px | auto |
| `menuRadius` | `ph?'16px 16px 0 0':'14px'` | 14px | 14px | 14px | 14px | `16px 16px 0 0` |
| `menuPadB` | `ph?'calc(10px + env(safe-area-inset-bottom))':'6px'` | 6px | 6px | 6px | 6px | `calc(10px + env(safe-area-inset-bottom))` |
| `sheetAlign` | `ph?'flex-end':'center'` | center | center | center | center | flex-end |
| `sheetPad` | `ph?'0':'16px'` | 16px | 16px | 16px | 16px | 0 |
| `sheetRadius` | `ph?'14px 14px 0 0':'14px'` | 14px | 14px | 14px | 14px | `14px 14px 0 0` |
| `toastB` | `ph?'140px':(cmp?'92px':'24px')` | 24px | 24px | 24px | 92px | 140px |

Keys of `Lay` that exist but are not referenced by the markup (do not use them for these screens): `heroPad, heroH, heroNum, heroAlign` (the dashboard uses `db.L.heroPad/heroNum` instead), `segH, ctxH, gBtn, chipH, siPad, siCols, siVisH, siVisPad, siFormPad, siH, siTag, receiptDisplay, headX, railCols, railX, mhCols, mhMid, mhPad, mhX, mhName, mhTime, lkMain, railGap, lkHead, tW, tH, tGap, tPadX, tName, padTicket, padGap, padName, boxH, keyH2, keyGap2, lkGap, clockSize, dateSize, keySize, keyGap, lockCols, lockHero, lockCompact, lockPad, lockMax, staffMin, loginCols, loginSide, loginLogo, mnLabel, ctxDisplay`.

### 2.2 Root
`div`: `height:100dvh; display:grid; grid-template-columns:{{ L.rootCols }}; background:var(--bg) (#F4F4F5); overflow:hidden`. Children: side `nav` (column 1), then the page (`data-screen-label` container), tab bar, overlays. Measured `grid-template-columns`: 1280 `232px 1048px`; collapsed `76px 1204px`; 1024 `76px 948px`; 820 `76px 744px`; 390 `390px`.

### 2.3 Side nav (`nav`, first child of root)
| Element | Properties |
|---|---|
| nav | `display:{{ L.railDisplay }}; flex-direction:column; gap:2px; background:var(--nav) (#111113); color:var(--nav-t) (#C8C8CC); padding:{{ L.navPad }}; min-height:0; overflow-y:auto`. Measured: 1280 `[0,0,232,800]`; rail `[0,0,76,H]`. |
| Brand block | `div title="{{ restaurantName }}"`: `display:flex; align-items:center; justify-content:{{ L.navJustify }}; gap:10px; padding:6px; margin-bottom:10px; color:#FFFFFF`. Measured wide `[10,12,212,48.69]`, rail `[8,12,60,46]`. |
| Brand logo | `span`: `34×34; flex:none; border-radius:9px; background:var(--brand) (#C8381F); color:#FFFFFF; display:flex; align/justify center; font-family:'Shrikhand',Georgia,serif; font-weight:400; font-size:19px; padding-top:2px`. Text `{{ restInitial }}` = "O". Measured wide `[16,19.34,34,34]`, rail `[21,18,34,34]`. |
| Brand text (wide only) | wrapper `display:{{ L.wideFlex }}; flex-direction:column; min-width:0`. Line 1 `{{ restaurantName }}`: `font-family:'Shrikhand',Georgia,serif; font-weight:400; font-size:18px; line-height:1.15; color:var(--brand-nav) (#FF6B4A); white-space:nowrap; overflow:hidden; text-overflow:ellipsis` (measured `[60,18,138.47,20.69]`). Line 2 `{{ productName }} · Counter 1` = "Sandbee POS · Counter 1": `font-size:12px; color:var(--nav-t2) (#8B8B93); white-space:nowrap` (measured `[60,38.69,138.47,16]`). |
| Group label | per group: `display:{{ g.headDisplay }}` (`wide?'block':'none'`); `font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--nav-t2); padding:14px 10px 6px`. Text "Operate" / "Manage" (rendered uppercase). Measured height 34 (`[10,72.69,212,34]`, `[10,348.69,212,34]`). |
| Group separator | `display:{{ g.sepDisplay }}` (`!wide&&gi>0?'block':'none'`, i.e. only in rail form, before every group after the first); `height:1px; background:var(--nav-2) (#27272A); margin:8px 14px`. Measured rail `[22,402,32,1]`. |
| Nav item | `button title="{{ n.label }}"`: `position:relative; display:flex; flex-direction:{{ L.navDir }}; align-items:center; gap:{{ L.navGap }}; width:100%; flex:none; min-height:{{ L.navItemH }}; border:0; border-radius:8px; padding:{{ L.navItemPad }}; background:{{ n.bg }}; color:{{ n.color }}; font-size:{{ L.navFont }}; font-weight:500; cursor:pointer; text-align:left`. Hover: `background:var(--nav-on); color:#FFFFFF`. Active: `bg var(--nav-on)` (rgba(255,255,255,.09)), `color #FFFFFF`; inactive: `transparent`, `var(--nav-t)`. Measured wide 212×38, step 40 (gap 2); rail 60×52, step 54. |
| Active bar | first child `span`: `position:absolute; left:{{ L.barLeft }}; top:9px; bottom:9px; width:3px; border-radius:0 3px 3px 0; background:var(--accent) (#0F62FE); opacity:{{ n.barOp }}; transform:scaleY({{ n.barOp }}); transition:opacity .25s,transform .3s`. `barOp` = 1 active, 0 otherwise. Measured wide `[0,y+9,3,20]` (flush with the window edge), rail `[0,y+9,3,34]`. |
| Item icon | `svg 20×20 viewBox 0 0 24 24 fill none stroke currentColor stroke-width 1.6 linecap/linejoin round; flex:none`. Measured wide x=20; rail x=28, y=item+8. |
| Item label | `span style="flex:{{ L.navLabelFlex }}; white-space:nowrap"`. Wide `[50,y+10,162,18]` (132 wide when a badge shows); rail centred, height 14 (10.5px). |
| Badge | `span display:{{ n.pill }}` (`b&&wide?'inline-flex':'none'`): `min-width:20px; height:20px; padding:0 6px; border-radius:10px; background:var(--nav-2); color:var(--nav-t); font-size:11.5px; font-weight:600; align-items:center; justify-content:center`. Only Orders has one: number of open orders with items (`s.orders.filter(x=>x.cart.length).length`, "8" in the demo). Measured `[192,237.69,20,20]`. Hidden in rail form. |
| Spacer | `div style="flex:1;min-height:16px"`. |
| Collapse toggle | `button title="{{ navToggleLabel }}"`: `display:{{ L.collapseDisplay }}; flex:none; align-items:center; justify-content:{{ L.navJustify }}; gap:10px; width:100%; border:0; border-radius:8px; height:34px; padding:0 10px; background:transparent; color:var(--nav-t2); font-size:12.5px; cursor:pointer`; hover `background:var(--nav-on); color:#FFFFFF`. Icon 18px stroke 1.8 path `{{ navToggleIcon }}` (wide `M15 6l-6 6 6 6` chevron-left; otherwise `M9 6l6 6-6 6` chevron-right). Label `span display:{{ L.wideInline }}` = `{{ navToggleLabel }}` (`wide?'Collapse':'Expand'`). Shown only when `s.w>=1280` (also when collapsed). Measured wide `[10,687,212,34]` (icon `[20,695,18,18]`, label `[48,695.5,49.88,17]`); collapsed `[8,691,60,34]`. Click toggles `state.navCollapsed`. |
| Divider | `div`: `height:1px; background:var(--nav-2); margin:6px 4px`. Measured wide `[14,729,204,1]`, rail `[12,H−67,52,1]`. |
| User card | `button title="{{ me.name }}"`: `display:flex; flex:none; align-items:center; justify-content:{{ L.navJustify }}; gap:10px; width:100%; border:0; border-radius:10px; padding:{{ L.meCardPad }}; background:transparent; color:#FFFFFF; cursor:pointer; text-align:left`; hover `background:var(--nav-on)`. Click opens the profile sheet (`menuOpen:true`). Measured wide `[10,738,212,50]`; rail `[8,H−58,60,46]`. |
| User avatar | `span`: `position:relative; 34×34; flex:none; border-radius:50%; background:{{ me.avBg }}; color:{{ me.avColor }}; display:flex; centred; font-weight:600; font-size:13px`; text `{{ me.ini }}` ("RK"). Status dot: `position:absolute; right:-2px; bottom:-2px; 11×11; border-radius:50%; background:var(--ok) (#24A148); box-shadow:0 0 0 2px var(--nav)`. |
| User text (wide only) | wrapper `display:{{ L.wideFlex }}; flex-direction:column; flex:1; min-width:0`. Name `font-size:13.5px; font-weight:600; nowrap; ellipsis`. Line 2 `{{ me.role }} · Counter 1` (e.g. "Manager · Counter 1"): `font-size:12px; color:var(--nav-t2); white-space:nowrap`. |

Measured wide vertical rhythm (1280×800, Manager): brand 12–60.69; "OPERATE" 72.69 (h 34); items at y 108.69, 148.69, 188.69, 228.69, 268.69, 308.69; "MANAGE" 348.69; items 384.69, 424.69, 464.69; spacer 504.69 (h 180.31); Collapse 687; divider 729; user card 738–788; nav bottom padding 12.
Measured rail (1024×768): brand `[8,12,60,46]`; items y 70, 124, 178, 232, 286, 340; separator y 402; items 413, 467, 521; spacer 575 (h 118 at 768 tall); divider y 701; user card `[8,710,60,46]`. 820×1180 identical x/y for the top part, spacer h 530, divider 1113, user card 1122. 1280 collapsed: same as 1024 plus the Expand button `[8,691,60,34]` (icon only, `[29,699,18,18]`), divider 733, user card 742.

### 2.4 Nav items and roles
`NAVDEF = [['Operate', [dashboard 'Home', floor 'Floor', order 'Order', orders 'Orders', kitchen 'Kitchen', reservations 'Reservations']], ['Manage', [menu 'Menu', reports 'Reports', settings 'Settings']]]`.
- Label override: `reservations` shows "Bookings" when `s.w<1280||s.navCollapsed` (rail form); "Reservations" in wide form.
- Groups keep only items in the role's `ROLES[role].nav`; empty groups are dropped.

| Role | `nav` (order) | `home` route after sign-in |
|---|---|---|
| Manager | dashboard, floor, order, orders, kitchen, reservations, menu, reports, settings | dashboard |
| Cashier | floor, order, orders, kitchen, reservations, menu | order |
| Captain | floor, order, orders, kitchen, reservations | floor |
| Kitchen | (none) | null |

Item click → `nav(r)`: if `r` not in `BUILT` (`reservations, dashboard, floor, order, orders, kitchen, menu`) → toast `{Label} is coming in the next build` (Reports, Settings); else route change, closes cart and menu.

Icons (all `viewBox 0 0 24 24`, outline): `dashboard`/`home` house with a door; `floor` 2×2 grid of squares; `order` shopping cart with two wheel dots; `orders` clipboard with clip and two text lines; `kitchen` serving cloche on a base line with a handle; `reservations` calendar with two binder rings, header rule and a small date square; `menu` page with three text lines (last short); `reports` three vertical bars with a baseline; `settings` small circle with eight short rays (sun-style cog).

### 2.5 Page header (values of the dashboard header; the other pages use the same mini logo, title block and printer button with their own `gap` and action buttons)
| Element | Properties |
|---|---|
| header | `display:flex; align-items:center; gap:10px; padding:{{ L.headPad }}; min-height:56px; background:var(--surface) (#FFFFFF); border-bottom:1px solid var(--border) (#E2E2E6); position:sticky; top:0; z-index:3`. Measured height 56 at all viewports; 1280 `[232,0,1048,56]`, 390 `[0,0,390,56]`. |
| Mini logo (phone only) | `div display:{{ L.miniLogo }}`: `30×30; flex:none; border-radius:8px; background:var(--brand); align/justify center; font-family:'Shrikhand',Georgia,serif; font-weight:400; font-size:19px; padding-top:2px; color:#FFFFFF`; text "O". Measured 390 `[12,12.5,30,30]`. |
| Title block | `div style="flex:1;min-width:0"`. Title "Dashboard": `font-weight:600; font-size:15px; line-height:1.2` (h 18). Subtitle `{{ restaurantName }} · {{ todayLabel }}` = "Olivea Pizza · Monday, 19 October": `font-size:12px; color:var(--text-2) (#52525B); white-space:nowrap; overflow:hidden; text-overflow:ellipsis` (h 16). Measured 1280 `[252,10.5,712.61,34]`; 390 `[52,10.5,177,34]` (subtitle ellipsised: "Olivea Pizza · Monday, 19 Octo…"). `todayLabel = now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})`. |
| End of day | `button title="Print end-of-day report"`: `border:1px solid var(--border); background:var(--surface); color:var(--text); border-radius:8px; height:36px; padding:0 12px; font-weight:500; font-size:13.5px; white-space:nowrap; display:flex; align-items:center; gap:7px`; hover `background:var(--hover) (#F2F2F4)`. Printer icon 15px stroke 1.8. Label `span display:{{ db.L.wideI }}` "End of day" (hidden when `xs`). Click → toast "End-of-day report sent to the printer". Measured 114.7×36 (390: 41×36). |
| New order | `button`: `border:0; background:var(--accent); color:var(--on-accent); border-radius:8px; height:36px; padding:0 14px; font-weight:600; font-size:13.5px; white-space:nowrap; display:flex; align-items:center; gap:6px`; hover `background:var(--accent-h) (#0043CE)`. Plus icon 14px stroke 2.4 (linecap round, no linejoin). Label "New order" `display:{{ db.L.wideI }}`. Click → route `order`. Measured 114.69×36 (390: 42×36). |
| Printer | `button title="{{ pr.title }}"`: `position:relative; flex:none; 36×36; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); display:flex; centred`; hover `background:var(--hover)`. Printer icon 17px stroke 1.8. Status dot: `position:absolute; top:-3px; right:-3px; 10×10; border-radius:50%; background:{{ pr.dot }}; box-shadow:0 0 0 2px var(--surface)`. `pr.dot` = `var(--ok)` when printing is on (default mode "counter", or mode "here" with a device), `var(--warn)` when off. `pr.title` = "Printer · printing is on" / "Printer · printing is off". Click opens the printer sheet (`pr.open`, out of scope). Measured 1280 `[1224,9.5,36,36]`, dot `[1252,7.5,10,10]`. |
Measured gaps (1280): title ends 964.61, End of day 974.61–1089.31, New order 1099.31–1214, printer 1224–1260, right padding 20.

### 2.6 Phone tab bar (`showTabbar = ph && route!=='login' && route!=='signin'`)
| Element | Properties |
|---|---|
| nav | `position:fixed; left:0; right:0; bottom:0; z-index:12; background:var(--glass) (rgba(255,255,255,.9)); backdrop-filter:saturate(180%) blur(20px); -webkit-backdrop-filter:saturate(180%) blur(20px); border-top:1px solid var(--border); display:grid; grid-template-columns:repeat({{ tabCols }},1fr); padding:2px 0 env(safe-area-inset-bottom)`. `tabCols = Math.min(4,tabs0.length)+1`. Measured 390 `[0,785,390,59]`, columns `78px ×5`. |
| Tab | `button`: `border:0; background:transparent; height:56px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; color:{{ b.color }}; font-size:11px; font-weight:500`. Icon 22px stroke 1.7. Colour `var(--accent)` when `route===r`, else `var(--text-2)`. Click → route `r`. Measured `[78k,788,78,56]`, icon `[28+78k,796.5,22,22]`. |
| More | same style; color `{{ moreC }}` = `var(--accent)` when the current route is one of `tabs0.slice(4)` routes or `menu`, `reports`, `settings`; else `var(--text-2)`. Icon: three horizontal lines (`M4 6h16M4 12h16M4 18h16`), 22px stroke 1.7. Label "More". Click opens the More sheet. |

`tabs0` (in this order, filtered by role): Home (`dashboard`, only if allowed), Floor, Order (always), Orders (if allowed), Kitchen (if allowed), Bookings (`reservations`, if allowed). The bar shows `tabs0.slice(0,4)` + More. Manager: Home, Floor, Order, Orders, More. Cashier and Captain: Floor, Order, Orders, Kitchen, More. Kitchen role: Floor, Order, More (3 columns).

### 2.7 More sheet (phone) / profile sheet (tablet, desktop) (`menuOpen`)
| Element | Properties |
|---|---|
| Scrim | `div` click → close: `animation:fadeIn .2s ease both; position:fixed; inset:0; z-index:40; background:{{ L.menuScrim }}` (phone `var(--scrim)` rgba(17,17,19,.42); others transparent). |
| Panel | click stops propagation: `animation:sheetIn .34s cubic-bezier(.2,.8,.2,1) both; position:absolute; left:{{ L.menuLeft }}; right:{{ L.menuRight }}; bottom:{{ L.menuBottom }}; width:{{ L.menuW }}; background:var(--surface); border:1px solid var(--border); border-radius:{{ L.menuRadius }}; box-shadow:var(--pop); overflow:hidden; padding-bottom:{{ L.menuPadB }}`. Measured: 1280 `[12,422,310,308]`; 1280 collapsed `[84,480,310,308]`; 1024 `[84,448,310,308]`; 820 `[84,860,310,308]`; 390 `[0,355,390,489]`. |
| User block | `display:flex; align-items:center; gap:12px; padding:16px` (h 76). Avatar `44×44; border-radius:50%; background:{{ me.avBg }}; color:{{ me.avColor }}; font-weight:600; font-size:15px` text initials. Name `font-size:15px; font-weight:600`. Status line `display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--text-2); margin-top:2px`: 7×7 dot `var(--ok)`, then `{{ me.role }} · signed in at {{ me.sinceTxt }}` (rendered with the 6px flex gaps, see 0.2; e.g. "Manager · signed in at 11:51 AM"; `sinceTxt = hm(me.since)` or "—"). |
| Nav grid (phone only) | wrapper `display:{{ moreNavD }}` (`ph?'block':'none'`); `border-top:1px solid var(--border-2) (#ECECEF); padding:12px 12px 14px` (h 177). Grid `repeat(4,minmax(0,1fr)); gap:6px`. Button: `display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; height:72px; border:1px solid var(--border); border-radius:12px; background:{{ n.bg }}; color:{{ n.color }}; font-size:12px; font-weight:600; padding:0 2px; text-align:center`; icon 22px stroke 1.7. Current route: bg `var(--accent-t)`, color `var(--accent-i)`; else transparent / `var(--text)`. Measured buttons 86.5×72. Items: `tabs0.slice(4)` ("Bookings" renamed "Reservations") then allowed Manage items. Manager: Kitchen, Reservations, Menu, Reports, Settings. Cashier: Reservations, Menu. Captain: Reservations. Click closes the sheet then `nav(r)`. |
| Rows | wrapper `border-top:1px solid var(--border-2); padding:6px` (h 117). Row button: `width:100%; display:flex; align-items:center; gap:12px; border:0; background:transparent; border-radius:8px; padding:9px 10px; text-align:left; color:{{ r.color }}` (`var(--text)`); hover `background:var(--hover)`. Icon 18px stroke 1.7. Label `font-size:14px; font-weight:500`; sub `font-size:12px; color:var(--text-2)`. Shortcut chip `display:{{ r.kbdDisplay }}` (`kbd && desk ? 'inline':'none'`): `font-family:'Geist Mono',monospace; font-size:11px; color:var(--text-3); border:1px solid var(--border); border-radius:4px; padding:0 5px; line-height:18px`. Rows measured 52 tall. Rows: 1) "Lock screen" / "Your open orders stay as they are" / chip "⌘L" / padlock icon → `lockNow('manual')`; 2) "Switch user" / "Lock and let a teammate sign in" / no chip / sign-out icon → `lockNow('manual')`. |
| Theme block | `border-top:1px solid var(--border-2); padding:12px 16px; display:flex; flex-direction:column; gap:8px` (h 107). Label "Theme" `font-size:12px; font-weight:600; color:var(--text-2)`. Segmented: `display:grid; grid-template-columns:repeat(3,1fr); background:var(--surface-3); border-radius:8px; padding:2px; gap:2px`; buttons `border:0; border-radius:6px; height:30px; font-size:13px; font-weight:500; background:{{ t.bg }}; box-shadow:{{ t.shadow }}; color:var(--text)` (selected = SEG_ON, others SEG_OFF). Options "Light", "Dark", "System". Measured buttons 89.33×30 (desktop) / 116×30 (phone). Footer `font-size:12px; color:var(--text-3)`: `Auto-locks after {n} min without activity` (n = 10) or "Auto-lock is off". |

Closing: scrim click, Escape key, or choosing a grid item.

### 2.8 Toast
`sc-if hasToast`. `div`: `position:fixed; left:50%; bottom:{{ L.toastB }}; transform:translateX(-50%); animation:toastIn .36s cubic-bezier(.2,.8,.2,1) both; background:var(--toast) (#18181B); color:var(--toast-t) (#FFFFFF); border-radius:10px; padding:10px 14px; font-size:13.5px; display:flex; gap:14px; align-items:center; z-index:70; white-space:nowrap; box-shadow:0 8px 24px rgba(0,0,0,.2)`. Content `<span>{{ toast }}</span>` and, when an undo exists, button "Undo": `border:0; background:transparent; color:var(--toast-a) (#A9C8B2); font-weight:600; font-size:13.5px; padding:0`. `flash(msg,undo)` shows it for 2800 ms (a new flash restarts the timer). Measured height 38; y = 738 (1280×800), 706 (1024×768), 1050 (820×1180), 666 (390×844).

### 2.9 Shell behaviours
- Keyboard (outside the lock screen): Ctrl/⌘+L → `lockNow('manual')`; Escape closes the profile sheet (and other overlays).
- `lockNow`: hides revealed sales (`rvShow:false, rvPin:null`); if the signed-in user has items not sent to the kitchen, opens the "unsent" confirm dialog (out of scope), else `doLock` → route `login`, `lockedBy` = user, `lockedAt` = now, `lockedRoute` = current route.
- Auto-lock: no `pointerdown`/`keydown` for `settings.autoLock` (10) minutes → `doLock('auto')`.
- Page container animation: `pageIn .4s cubic-bezier(.2,.8,.2,1) backwards`.

---

## 3. Dashboard (`on.dash`, route `dashboard`)

### 3.0 Containers and `db.L`
- Page: `div data-screen-label="Dashboard"`: `display:{{ S.dash }}` (flex when route is dashboard); `flex-direction:column; min-width:0; min-height:0; overflow-y:auto; overflow-x:hidden; animation:pageIn .4s cubic-bezier(.2,.8,.2,1) backwards`. It is the scroller; the header (2.5) is sticky inside it.
- Content: `padding:{{ L.pagePad }}; padding-bottom:{{ L.screenPadB }}; display:flex; flex-direction:column; gap:16px; width:100%; max-width:none`. Measured padding: `20px 24px 28px` (non-phone), `16px 14px 92px` (390).

`db.L` (dashVals line 699–701):

| Key | Expression | 1280 (cw 1048) | 1280 collapsed (1204) | 1024 (948) | 820 (744) | 390 (390, xs) |
|---|---|---|---|---|---|---|
| `hero` | `cw>=1000?'minmax(0,1.7fr) minmax(300px,1fr)':'minmax(0,1fr)'` | 2 cols | 2 cols | `minmax(0,1fr)` | `minmax(0,1fr)` | `minmax(0,1fr)` |
| `heroPad` | `xs?'20px':'24px 26px'` | `24px 26px` | `24px 26px` | `24px 26px` | `24px 26px` | `20px` |
| `heroNum` | `xs?'42px':'60px'` | 60px | 60px | 60px | 60px | 42px |
| `mini` | `xs?'minmax(0,1fr)':'repeat(3,minmax(0,1fr))'` | 3 cols | 3 cols | 3 cols | 3 cols | 1 col |
| `twoOne` | `cw>=1000?'minmax(0,2fr) minmax(0,1fr)':'minmax(0,1fr)'` | 2fr/1fr | 2fr/1fr | 1 col | 1 col | 1 col |
| `three` | `cw>=1080?'repeat(3,minmax(0,1fr))':(cw>=680?'repeat(2,minmax(0,1fr))':'minmax(0,1fr)')` | 2 cols | 3 cols | 2 cols | 2 cols | 1 col |
| `span3` | `cw>=680&&cw<1080?'1 / -1':'auto'` | `1 / -1` | auto | `1 / -1` | `1 / -1` | auto |
| `orderCols` | `xs?'40px minmax(0,1fr) auto':'40px minmax(0,1fr) auto 84px'` | 4 cols | 4 cols | 4 cols | 4 cols | 3 cols |
| `barGap` | `xs?'3px':'8px'` | 8px | 8px | 8px | 8px | 3px |
| `wideF` | `xs?'none':'flex'` | flex | flex | flex | flex | none |
| `wideI` | `xs?'none':'inline'` | inline | inline | inline | inline | none |
| `attWide` | `xs?'none':'flex'` | flex | flex | flex | flex | none |
| `attMob` | `xs?'flex':'none'` | none | none | none | none | flex |

Section order (top → bottom): attention row (wide) / attention card (phone) → period row → [net sales hero | bill breakdown] → [sales by hour | live tables] → [recent orders | today's reservations] → [how guests paid | where orders came from | money leaks] → [top items | sales by category | slow movers] → busy hours.

Generic card (used by every section except hero and bill breakdown): `section`: `background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px 20px; min-width:0`. Card title `font-weight:600; font-size:15px`; card subtitle `font-size:12.5px; color:var(--text-3) (#6B6B74); margin-top:3px`. Header link buttons ("Floor →", "All orders →", "View all →", "Menu →"): `border:0; background:transparent; color:var(--link) (#0F62FE); font-size:13px; font-weight:500; cursor:pointer; padding:0; white-space:nowrap`. List row separators: `border-top:1px solid var(--border-2)`.

### 3.1 Attention
Data (dashVals 664–667, built in this order):
1. Always: `{dot:'var(--bill)', strong:'₹8,450 due', rest:'from 6 customers', action:'Collect', onClick:go('orders')}`.
2. If any table is "Bill printed": `{dot:'var(--warn)', strong: tables joined ', ' as 'T{n}', rest: count>1 ? 'bills printed, not paid' : 'bill printed, not paid', action:'Open', → floor}`.
3. If any table is "KOT pending": `{dot:'var(--info)', strong: n+(n>1?' tables':' table'), rest:'with items not sent to kitchen', action:'Send', → floor}`.
4. If a reservation is listed today (first of `resMap()` sorted by time): `{dot:'var(--res)', strong:'T'+n, rest:'reserved for '+time.toLowerCase()+' · '+name, action:'View', → reservations}`.
Each item also gets `bt = index ? '1px solid var(--border-2)' : '0'`.
Rendered (12:2x): "₹8,450 due from 6 customers · Collect", "T1 bill printed, not paid · Open", "2 tables with items not sent to kitchen · Send", "T3 reserved for 12:30 pm · Rahul Mehta · View".

Wide row (`display:{{ db.L.attWide }}`): `align-items:center; flex-wrap:wrap; gap:8px; animation:rise .4s cubic-bezier(.2,.8,.2,1) both`.
- Label `span`: `display:flex; align-items:center; gap:7px; font-size:11.5px; font-weight:600; letter-spacing:.07em; text-transform:uppercase; color:var(--text-2); margin-right:4px`; 7×7 round dot `var(--warn)`; text "Needs attention". Measured `[256,85.5,129.72,15]`.
- Chip `button`: `display:flex; align-items:center; gap:9px; height:34px; padding:0 5px 0 12px; border:1px solid var(--border); border-radius:17px; background:var(--surface); color:var(--text); font-size:13px; white-space:nowrap`; hover `border-color:var(--text-3)`. Children: 8×8 round dot `{{ a.dot }}`; `<span><b style="font-weight:600">{{ a.strong }}</b> {{ a.rest }}</span>`; action pill `height:24px; padding:0 10px; border-radius:12px; background:var(--surface-3); display:flex; align-items:center; font-size:12px; font-weight:600`. Measured widths 284.98, 231.88, 324.45, 328.23 (h 34); at 1280 the fourth chip wraps to y 118 (row h 76).

Phone card (`display:{{ db.L.attMob }}`): `flex-direction:column; background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; animation:rise .4s cubic-bezier(.2,.8,.2,1) both`. Measured closed `[14,72,362,50]`, open `[14,72,362,235]`.
- Toggle `button`: `display:flex; align-items:center; gap:10px; height:48px; padding:0 12px; border:0; background:transparent; color:var(--text); text-align:left; min-width:0`. Count tile `28×28; border-radius:8px; background:var(--warn-t) (#FFF2E8); color:var(--warn-i) (#BA4E00); font-size:13px; font-weight:700` = `{{ db.att.n }}` (4). Text: "Needs attention" `display:block; font-size:13.5px; font-weight:600`; peek `display:block; font-size:12px; color:var(--text-2); nowrap; ellipsis` = strongs joined " · " ("₹8,450 due · T1 · 2 tables · T3"). Chevron-down 16px stroke 2, `flex:none; color:var(--text-2); transform:rotate({{ db.att.rot }}); transition:transform .2s` (0deg closed, 180deg open). Click toggles `state.dbAttOpen` (default closed).
- Open list: `display:flex; flex-direction:column; border-top:1px solid var(--border-2)`. Row `button`: `display:flex; align-items:center; gap:10px; min-height:46px; padding:8px 12px; border:0; border-top:{{ a.bt }}; background:transparent; color:var(--text); text-align:left; font-size:13px`. Dot `8×8; flex:none; border-radius:50%; margin:0 10px 0 10px`. Text `flex:1; min-width:0; line-height:1.35` with bold strong. Action `flex:none; height:28px; padding:0 11px; border-radius:8px; background:var(--surface-3); font-size:12px; font-weight:600`. Measured rows `[15,122,360,46]`, `[15,168,…]`, `[15,214,…]`, `[15,260,…]`.

### 3.2 Period row
`div`: `display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap; gap:12px`.
- Left: title `{{ db.P.label }}` `font-size:18px; font-weight:600; letter-spacing:-.01em`; sub `{{ db.P.range }} · compared with {{ db.P.cmp }}` `font-size:12.5px; color:var(--text-2); margin-top:2px`. Measured `[256,168,236.56,42]` (1280).
- Segmented: `display:flex; background:var(--surface-3); border-radius:9px; padding:3px; gap:2px; height:36px`. Buttons: `border:0; border-radius:7px; padding:0 12px; background:{{ p.bg }}; box-shadow:{{ p.sh }}; color:{{ p.color }}; font-size:13px; font-weight:{{ p.fw }}; white-space:nowrap`. Selected: `var(--seg)` #FFFFFF, `var(--seg-sh)`, `var(--text)`, 600; others transparent, none, `var(--text-2)`, 500. Labels "Today", "Yesterday", "7 days", "30 days". Measured 1280: container `[964.03,174,291.97,36]`; buttons Today `[967.03,177,60.77,30]`, Yesterday 83.83, 7 days 63.7, 30 days 71.67. At 390 the segmented control wraps under the title (`[14,192,291.97,36]`).
- Pick → `dbP` = key, `dbHov` = −1. Default `dbP` = `today`.

Period data `PD` (`fd(d,o) = d.toLocaleDateString('en-IN',o)`, `wd` = weekday long of today):

| Key | label | seg | short | range | cmp | cmpShort | days | net | orders | coll | d [net, orders, avg, coll] | disc | rew | gst | svc | lk [cancel n, ₹, void n, ₹, disc n, ₹, rew n, ₹] |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| today | Today | Today | Today | `fd(now,{weekday:'short',day:'numeric',month:'short'})` "Mon, 19 Oct" | `'last '+wd` "last Monday" | `'Last '+wd.slice(0,3)` "Last Mon" | 1 | 48250 | 126 | 46980 | 12.4, 6.8, 5.2, 11.1 | 1840 | 260 | 2480 | 750 | 2, 780, 5, 1140, 14, 1840, 3, 260 |
| yesterday | Yesterday | Yesterday | `fd(dayAgo(1),{day:'numeric',month:'short'})` "18 Oct" | "Sun, 18 Oct" | the same day last week | Week before | 1 | 44870 | 118 | 44120 | 3.1, -2.5, 5.8, 2.4 | 1620 | 180 | 2300 | 690 | 1, 420, 3, 610, 12, 1620, 2, 180 |
| week | Last 7 days | 7 days | 7 days | `fd(dayAgo(6),…)+' – '+fd(now,…)` "13 Oct – 19 Oct" | the previous 7 days | Previous 7 days | 7 | 321600 | 842 | 314900 | 9.2, 7.1, 2.0, 8.6 | 11800 | 1900 | 16500 | 4800 | 9, 3650, 27, 6240, 88, 11800, 19, 1900 |
| month | Last 30 days | 30 days | 30 days | "20 Sep – 19 Oct" | the previous 30 days | Previous 30 days | 30 | 1362400 | 3570 | 1335800 | -2.1, 1.4, -3.4, -1.8 | 49200 | 8100 | 69800 | 20300 | 38, 15200, 112, 25900, 371, 49200, 80, 8100 |

Scale factors: `kN = P.net/48250`, `kO = P.orders/126`. Count-up: on entering the dashboard `cu` animates 0→1 over 1100 ms; `E = 1-(1-cu)^3`; applied to net, orders and collected only.

### 3.3 Net sales hero
Grid wrapper: `display:grid; grid-template-columns:{{ db.L.hero }}; gap:16px`. Measured columns: 1280 `619.547px 364.438px`; collapsed `717.766px 422.234px`; 1024 `900px`; 820 `696px`; 390 `362px`.

`section`: `background:var(--nav) (#111113); color:#FFFFFF; border:1px solid var(--nav-2) (#27272A); border-radius:16px; padding:{{ db.L.heroPad }}; display:flex; flex-direction:column; gap:22px; min-width:0; animation:rise .5s cubic-bezier(.2,.8,.2,1) both`. Measured height 302 (1280, stretched to the row), 290 (1024/820), 521 (390).
- Top row: `display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap`.
  - Label `Net sales · {{ db.P.label }}`: `font-size:13px; color:#A1A1AA`.
  - Number `{{ db.K.net }}`: `font-family:'Geist Mono',ui-monospace,monospace; font-weight:500; font-size:{{ db.L.heroNum }}; letter-spacing:-.04em; line-height:1; margin-top:10px`. Measured 1280 `[283,278,…,60]`: masked width 302.41, shown "₹48,250" width 235.2; 390 42px tall, widths 211.69 / 170.27.
  - Delta row: `display:flex; align-items:center; gap:8px; margin-top:12px; font-size:13px; color:#A1A1AA`. Pill `display:flex; align-items:center; height:24px; padding:0 9px; border-radius:12px; background:{{ db.K.nd.bg }}; color:{{ db.K.nd.fg }}; font-weight:600` = `{{ db.K.nd.txt }}`; then `vs {{ db.P.cmp }}` (see 0.2). `nd = dl(P.d[0], true)`: up `txt '↑ '+d+'%'`, `fg '#6FDC8C'`, `bg 'rgba(66,190,101,.16)'`; down `'↓ '+|d|+'%'`, `'#FF8389'`, `'rgba(250,77,86,.16)'`. Measured pill 68.17×24 ("↑ 12.4%").
  - Right column: `display:flex; flex-direction:column; align-items:flex-end; gap:8px; font-size:12.5px; color:#A1A1AA`.
    - Reveal button `title="{{ db.rv.title }}"`: `display:flex; align-items:center; gap:8px; height:36px; padding:0 12px; border:1px solid #3A3A40; border-radius:999px; background:{{ db.rv.bg }}; color:#FFFFFF; font-size:13px; font-weight:600; white-space:nowrap`; hover `border-color:#6B6B74`. Icon 17px stroke 1.8 `{{ db.rv.icon }}`; text `{{ db.rv.label }}`. Measured "Show" 85.84×36, "Hide" 79.14×36.
    - Hint `span`: `display:flex; align-items:center; gap:6px; color:{{ db.rv.hintC }}`; icon 12px stroke 2 `{{ db.rv.hintIcon }}`; text `{{ db.rv.hint }}`.
  - At 390 the right column wraps below the number block (button measured `[77.66,382,85.84,36]` masked; it stays right-aligned inside its own column, whose width is the hint text width).
- Minis: `display:grid; grid-template-columns:{{ db.L.mini }}; gap:16px; padding-top:18px; border-top:1px solid var(--nav-2)`. Each: `display:flex; flex-direction:column; gap:6px; min-width:0`; label `font-size:12.5px; color:#A1A1AA`; value `font-family:'Geist Mono',ui-monospace,monospace; font-size:24px; font-weight:500; letter-spacing:-.03em; white-space:nowrap`; delta `font-size:12px; color:{{ m.dc }}; font-weight:500` = `{{ m.d }} ` + `<span style="color:#A1A1AA;font-weight:400">{{ m.note }}</span>`. `m.d/m.dc` from `dl(d,true)` (txt/fg). Measured mini columns: 1280 `177.844px ×3`; 1024 `271.328px 271.328px 271.344px`; 820 `203.328px ×3`; 390 `320px` (stacked, each 76 tall, 16 gap).

| Mini | label | value | delta | note |
|---|---|---|---|---|
| 1 | Orders | `String(Math.round(P.orders*E))` (never masked) | `P.d[1]` | `'vs '+P.cmpShort.toLowerCase()` ("vs last mon") |
| 2 | Average order | `MK(RS(P.net/P.orders))` | `P.d[2]` | `per bill` |
| 3 | Collected | `MK(RS(P.coll*E))` | `P.d[3]` | shown: `RS(P.net-P.coll)+' still due'` ("₹1,270 still due"); masked: `still due hidden` |

Reveal states (`SHOW = !!s.rvShow && rvOk()`, `ok = rvOk()`, `rvLeft = max(0, ceil((rvUntil−now)/60000))`):

| State | label | icon | bg | title | hint | hint icon | hint colour |
|---|---|---|---|---|---|---|---|
| Masked, no unlock | Show | eye | transparent | Enter your PIN to show sales | PIN needed to view | padlock | `#A1A1AA` |
| Shown | Hide | eye with slash | `#2A2A2F` | Hide sales figures | `Visible · hides in {rvLeft} min` | clock | `#6FDC8C` |
| Hidden but still unlocked (within the hour) | Show | eye | transparent | Show sales figures | `Unlocked · {rvLeft} min left` | clock | `#A1A1AA` |
Measured: "Visible · hides in 60 min" `rgb(111,220,140)`; "Unlocked · 60 min left" `rgb(161,161,170)`; Hide button bg `rgb(42,42,47)`.

### 3.4 Bill breakdown
`section`: `position:relative; background:var(--surface); border:1px solid var(--border); border-bottom:0; border-radius:16px 16px 0 0; padding:20px 22px 26px; min-width:0; margin-bottom:8px; animation:rise .5s .06s cubic-bezier(.2,.8,.2,1) both`. Measured 1280 `[891.55,226,364.44,294]`.
- Head: `display:flex; align-items:baseline; justify-content:space-between; gap:8px`; "Bill breakdown" `font-weight:600; font-size:15px`; right `{{ db.P.short }}` `font-family:'Geist Mono',ui-monospace,monospace; font-size:11px; color:var(--text-3); letter-spacing:.06em; text-transform:uppercase` ("TODAY").
- Rule: `border-top:1.5px dashed var(--border); margin:14px 0 6px`.
- Rows: `display:flex; justify-content:space-between; gap:12px; padding:7px 0; font-size:13.5px; color:{{ b.color }}`; value in Geist Mono.

| Row | shown value | shown colour | masked |
|---|---|---|---|
| Gross bill | `RS(gross)` (gross = net+disc+rew−gst−svc; today ₹47,120) | `var(--text)` | `• • • •` in `var(--text-3)` |
| Discounts | `'− '+RS(disc)` | `var(--bad-i)` (#A2191F) | same |
| Rewards given | `'− '+RS(rew)` | `var(--bad-i)` | same |
| GST (5%) | `'+ '+RS(gst)` | `var(--text-2)` | same |
| Service charge | `'+ '+RS(svc)` | `var(--text-2)` | same |
- Rule 2: `border-top:1.5px dashed var(--border); margin:6px 0 12px`.
- Total: `display:flex; justify-content:space-between; align-items:baseline`; "Net sales" `font-weight:600; font-size:15px`; value `{{ db.K.net }}` `font-family:'Geist Mono',…; font-weight:600; font-size:22px; letter-spacing:-.02em`.
- Torn edge: `div`: `position:absolute; left:-1px; right:-1px; bottom:-8px; height:9px; background:radial-gradient(circle at 7px 9px,transparent 5px,var(--surface) 5.5px) 0 0/14px 9px repeat-x`.

### 3.5 Sales by hour (first card of the `twoOne` grid)
Grid: `display:grid; grid-template-columns:{{ db.L.twoOne }}; gap:16px`. Measured columns 1280 `656px 328px`; collapsed `760px 380px`; 1024 `900px`; 820 `696px`; 390 `362px`.
- Head: `display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap`. Title `{{ db.C.title }}` = `P.days>1?'Average sales by hour':'Sales by hour'`; sub `{{ db.C.sub }}` = `P.label+' · open hours, 11 am – 11 pm'`.
- Legend: `display:flex; align-items:center; gap:14px; font-size:12px; color:var(--text-2)`; item 1 `gap:6px`: `10×10; border-radius:3px; background:var(--accent)` + `{{ db.P.label }}`; item 2: `width:14px; border-top:2px dashed var(--text-3)` + `{{ db.P.cmpShort }}`.
- Plot row: `display:flex; gap:10px; margin-top:18px`.
  - Y ticks: `display:flex; flex-direction:column; justify-content:space-between; height:210px; font-family:'Geist Mono',…; font-size:11px; color:var(--text-3); text-align:right; margin-top:-6px`; ticks `[3,2,1,0].map(i=>kf(step*i))`, `kf(v) = v ? '₹'+(v>=1000 ? (v/1000).toFixed(v%1000?1:0)+'k' : v) : '₹0'` (today: ₹6k, ₹4k, ₹2k, ₹0; 7 days: ₹7.5k, ₹5k, ₹2.5k, ₹0).
  - Plot: `position:relative; height:210px; background:repeating-linear-gradient(180deg,var(--border-2) 0 1px,transparent 1px 70px); border-bottom:1px solid var(--border)`. Measured 1280 `[306.81,620,584.19,210]`; 390 width 290.19.
  - Bars layer (mouse-leave → `dbHov=-1`): `position:absolute; inset:0; display:flex; align-items:flex-end; gap:{{ db.L.barGap }}`. Column (mouse-enter → `dbHov=i`): `position:relative; flex:1; height:100%; display:flex; align-items:flex-end; justify-content:center`. Bar: `width:100%; max-width:34px; height:{{ b.h }}%; min-height:2px; border-radius:5px 5px 2px 2px; background:{{ b.bg }}; opacity:{{ b.op }}; transform-origin:bottom; animation:growY .7s cubic-bezier(.2,.8,.2,1) both; transition:height .5s cubic-bezier(.2,.8,.2,1),opacity .15s`. `bg`: future hour → `var(--surface-3)`; peak → `var(--accent)`; others `color-mix(in oklab, var(--accent) 60%, var(--surface))` (measured `oklab(0.733904 -0.0203823 -0.144345)` ≈ #75A7FF). `op`: 1 when nothing hovered or this bar hovered, else .4. Measured bar width 34 (non-phone), 19.55 (390).
  - Tooltip (only on the hovered bar): `display:{{ b.tipD }}; position:absolute; bottom:calc({{ b.h }}% + 8px); left:50%; transform:translateX(-50%); z-index:2; background:var(--ink); color:var(--on-ink); border-radius:8px; padding:7px 10px; white-space:nowrap; font-size:12px; line-height:1.45; pointer-events:none`. Line 1 `font-weight:600` `{{ b.hour }} · {{ b.val }}`; line 2 `opacity:.7` `{{ b.cmpTxt }}`. Measured 115.23×48.78; texts "12 pm · ₹3,470" / "₹2,630 · last mon"; future bar "1 pm · not yet" / "₹5,360 · last mon".
  - Comparison line: `svg viewBox="0 0 100 100" preserveAspectRatio="none"` `position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible`; `polyline points="{{ db.C.line }}" fill="none" stroke="var(--text-3)" stroke-width="1.6" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" stroke-linejoin="round"`.
  - X labels: `display:flex; gap:{{ db.L.barGap }}; margin-top:8px`; each `flex:1; text-align:center; font-size:11px; color:var(--text-3); white-space:nowrap`; label = `hl(HR[i]).replace(' ','')` when `xs ? i%3===0 : i%2===0`, else empty. Rendered non-phone: 11am, 1pm, 3pm, 5pm, 7pm, 9pm, 11pm; phone: 11am, 2pm, 5pm, 8pm, 11pm.
- Footer: `display:flex; flex-wrap:wrap; gap:8px 24px; margin-top:14px; padding-top:12px; border-top:1px solid var(--border-2); font-size:12.5px; color:var(--text-2)`: `Peak <b>{{ db.C.peak }}</b>`, `Quietest <b>{{ db.C.low }}</b>`, `{{ db.C.vsLabel }} <b style="color:{{ db.C.vsColor }}">{{ db.C.vs }}</b>`; `<b>` = `color:var(--text); font-weight:600` (vs uses vsColor). `peak = hl(HR[pkI])+' · '+RS(vals[pkI])` or "—"; `low` = lowest past hour likewise; `vsLabel = today ? 'So far vs '+cmpShort.toLowerCase() : 'vs '+cmpShort.toLowerCase()`; `vs = (vsP>=0?'+':'')+vsP+'%'`; `vsColor = vsP>=0 ? 'var(--ok-i)' : 'var(--bad-i)'`.
- Data: `HV=[2.1,4.8,7.9,6.2,3.1,2.4,2.8,4.6,7.2,9.8,8.9,5.1,1.8]`, `HR` = 11…23, `hl(x) = ((x%12)||12)+(x<12?' am':' pm')`, `f = kN/P.days`, `rnd(x) = frac(sin(x*9301+49297)*233280)`, `r10(n)=round(n/10)*10`, `fut(i) = period is today && HR[i] > current hour`. `vals[i] = fut ? 0 : r10(v*723*f*(today?1:.88+rnd(i+days)*.24))`; `cmps[i] = r10(v*723*f*.89*(.85+rnd(i*7+days)*.3))`; `mx = max(vals, cmps, 500)`; `step = ceil(mx/3/500)*500`; `yTop = 3*step`; `b.h = (vals[i]/yTop*100).toFixed(1)`; line points `((i+.5)/13*100).toFixed(2)+','+(100-cmps[i]/yTop*100).toFixed(2)`; `vsP = round((ΣVals − ΣCmps of past hours)/ΣCmps*100)`. At 12:2x: "Peak 12 pm · ₹3,470", "Quietest 11 am · ₹1,520", "So far vs last mon +31%", bars 2 and 1 filled (heights 57.8% and 25.3%), others future.
- Values on this card are never masked.

### 3.6 Live tables (second card of the first `twoOne` grid)
`section` generic + `display:flex; flex-direction:column`.
- Head: `display:flex; align-items:flex-start; justify-content:space-between; gap:12px`. Title `display:flex; align-items:center; gap:8px; font-weight:600; font-size:15px` "Live tables" + `7×7; border-radius:50%; background:var(--ok); animation:pulse 2s infinite`. Sub `{{ db.T.sub }}` = `inUse+' of '+total+' in use · '+reserved+' reserved'` (inUse = occ+billed incl. KOT; "6 of 22 in use · 4 reserved"). Link "Floor →" → floor.
- Status bar: `display:flex; height:8px; border-radius:4px; overflow:hidden; gap:2px; margin-top:14px`; spans `flex:{{ g.n }}; background:{{ g.c }}`.
- Legend: `display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:10px; font-size:12px; color:var(--text-2)`; item `display:flex; align-items:center; gap:6px`: `8×8; border-radius:2px; background:{{ g.c }}` + label + `<b style="color:var(--text);font-weight:600">{{ g.n }}</b>`. Segments: Free `var(--ok)`, Eating `var(--info)` (occupied + KOT pending), Bill printed `var(--bill)`, Reserved `var(--res)`. Demo: 12, 5, 1, 4.
- Zone label: `font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--text-3); margin:16px 0 7px` ("Indoor", "Patio", "Rooftop").
- Tile grid: `display:grid; grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); gap:6px`.
- Tile `button title="{Table n} · {seats} seats · {status}"`: `display:flex; flex-direction:column; align-items:flex-start; gap:2px; height:52px; padding:7px 8px; border:1px solid {{ t.bd }}; border-radius:9px; background:{{ t.bg }}; color:var(--text); text-align:left; min-width:0`; hover `border-color:var(--text-3)`. Line 1 `display:flex; align-items:center; gap:5px; font-weight:600; font-size:12.5px`: 6×6 dot `{{ t.dot }}` + `T{n}`. Line 2 `font-size:10.5px; color:{{ t.fg }}; font-weight:500; nowrap; ellipsis; max-width:100%`. Click → floor.

| State | status text | bg | border | dot | line-2 colour | line 2 |
|---|---|---|---|---|---|---|
| free | Available | `var(--surface)` | `var(--border)` | `var(--ok)` | `var(--text-3)` | `{seats} seats` |
| occ | Occupied | `var(--info-t)` | `var(--info-b)` | `var(--info)` | `var(--info-i)` | `RS(amt)+' · '+m+'m'` |
| kot | KOT pending | `var(--info-t)` | `var(--info-b)` | `var(--warn)` | `var(--warn-i)` | `KOT pending` |
| billed | Bill printed | `var(--bill-t)` | `var(--bill-b)` | `var(--bill)` | `var(--bill-i)` | `Bill printed` |
| res | Reserved | `var(--res-t)` | `var(--res-b)` | `var(--res)` | `var(--res-i)` | reservation time ("12:30 PM") |
Tables: Indoor 1–12 (seats 4,2,4,4,6,2,4,4,8,2,4,6), Patio 13–18 (4,4,2,6,4,2), Rooftop 19–22 (4,4,8,2).

### 3.7 Recent orders (first card of the second `twoOne` grid)
Generic card + `padding-bottom:8px`.
- Head (`display:flex; align-items:flex-start; justify-content:space-between; gap:12px`): "Recent orders", sub "Completed today · newest first", link "All orders →" → orders.
- List `display:flex; flex-direction:column; margin-top:10px`.
- Empty state: `padding:24px 0; text-align:center; font-size:13px; color:var(--text-3)` "No completed orders yet today." (when history is empty).
- Row `button` (→ orders): `display:grid; grid-template-columns:{{ db.L.orderCols }}; align-items:center; gap:12px; padding:10px 8px; margin:0 -8px; border:0; border-top:1px solid var(--border-2); border-radius:10px; background:transparent; color:var(--text); text-align:left`; hover `background:var(--hover)`.
  - Code tile `40×40; border-radius:10px; background:var(--surface-3); centred; font-weight:600; font-size:12.5px`: Dine-in `'T'+digits of id`, Takeaway `TA`, Delivery `DL`.
  - Text: title `display:block; font-weight:600; font-size:14px` `'#'+no+' · '+id`; meta `display:block; font-size:12.5px; color:var(--text-3); margin-top:2px; nowrap; ellipsis` `type+' · '+n+(n===1?' item':' items')+' · '+ago(at)`.
  - Pay pill `display:{{ db.L.wideF }}; justify-self:start; align-items:center; height:24px; padding:0 9px; border-radius:12px; background:{{ o.pbg }}; color:{{ o.pfg }}; font-size:12px; font-weight:600`: UPI `var(--accent-t)/var(--accent-i)`; Cash `var(--ok-t)/var(--ok-i)`; Card `var(--res-t)/var(--res-i)`; refunded → text "Refunded" `var(--bad-t)/var(--bad-i)`; other `var(--surface-3)/var(--text-2)`.
  - Amount `font-family:'Geist Mono',…; font-weight:600; font-size:14px; text-align:right` `RS(total)` (not masked).
- Up to 5 rows, newest first. Demo: #1035 · Table 12 (UPI ₹879), #1034 · Table 9 (Card ₹1,019), #1033 · Delivery 1 (UPI ₹659), #1032 · Takeaway 8 (Cash ₹595), #1031 · Table 3 (UPI ₹779).

### 3.8 Today's reservations
Generic card + `display:flex; flex-direction:column`. Head: "Today's reservations", sub `{{ db.resSub }}` = `n+' bookings · by time'`, link "View all →" → reservations. List `margin-top:10px`. Row `display:flex; align-items:center; gap:12px; padding:10px 0; border-top:1px solid var(--border-2)`:
- Time pill `width:64px; flex:none; height:30px; border-radius:8px; background:var(--res-t) (#F6F2FF); color:var(--res-i) (#6929C4); centred; font-size:12.5px; font-weight:600; nowrap` (e.g. "12:30 PM").
- Text `flex:1; min-width:0`: name `display:block; font-size:14px; font-weight:500; nowrap; ellipsis`; where `display:block; font-size:12px; color:var(--text-3)` `'Table n · '+area+' · '+seats+' seats'`.
- "Seat" `button`: `height:30px; padding:0 11px; border:1px solid var(--border); border-radius:8px; background:var(--surface); color:var(--text); font-size:12.5px; font-weight:500`; hover `var(--hover)` → reservations.
Source `resMap()`: reservations with a table, status booked/confirmed, today, `at > now − 30 min`, first per table, sorted by time. No empty-state text exists for this card.

### 3.9 How guests paid (first card of the first `three` grid)
Grid `display:grid; grid-template-columns:{{ db.L.three }}; gap:16px`. Measured columns 1280 `492px 492px`; collapsed `374.656px 374.672px 374.656px`; 1024 `442px 442px`; 820 `340px 340px`; 390 `362px`.
- "How guests paid"; sub `{{ db.P.label }} · money collected`.
- Total `font-family:'Geist Mono',…; font-size:24px; font-weight:500; letter-spacing:-.03em; margin-top:14px` `RS(sum)` (not masked).
- Bar `display:flex; height:10px; border-radius:5px; overflow:hidden; gap:2px; margin-top:12px; background:var(--surface-3)`; spans `width:{{ r.pct }}%; background:{{ r.c }}; transform-origin:left; animation:growX .8s cubic-bezier(.2,.8,.2,1) both`.
- Rows `display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid var(--border-2); font-size:13.5px`: `9×9; border-radius:3px` swatch; `flex:1` `{{ r.label }} <span style="color:var(--text-3)">· {{ r.n }}</span>`; amount Geist Mono 600; pct `width:36px; text-align:right; font-size:12px; color:var(--text-3)` `{{ r.pct }}%`.
- Note `font-size:12px; color:var(--text-3); margin-top:6px; text-wrap:pretty`: "Due bills count only what was paid so far — the rest sits in customer dues."
- Data `pb`: UPI 58 orders ₹22080 `var(--accent)`; Cash 44 ₹17850 `var(--ok)`; Card 19 ₹7050 `var(--res)`; Due 5 ₹0 `var(--bill)`. `n = round(n*kO)+' orders'`; `a = r10(a*coll/46980)`; pct = `round(a/Σa*100)`. Today: 47%, 38%, 15%, 0%.

### 3.10 Where orders came from
- "Where orders came from"; sub `{{ db.P.label }} · completed orders`. List `display:flex; flex-direction:column; gap:8px; margin-top:14px`.
- Row `display:grid; grid-template-columns:34px minmax(0,1fr) auto; align-items:center; gap:12px; padding:10px 12px; border:1px solid var(--border-2); border-radius:12px`:
  - Icon tile `34×34; border-radius:9px; background:{{ r.bg }}; color:{{ r.fg }}`; icon 16px stroke 1.8.
  - Middle: `display:block; font-size:13.5px; font-weight:500` `{{ r.label }} <span style="color:var(--text-3);font-weight:400">· {{ r.n }} orders</span>`; track `display:block; height:4px; border-radius:2px; background:var(--surface-3); margin-top:7px; overflow:hidden` with fill `height:100%; width:{{ r.pct }}%; background:{{ r.c }}; border-radius:2px; transform-origin:left; animation:growX .8s cubic-bezier(.2,.8,.2,1) both`.
  - Right `text-align:right`: amount `display:block; Geist Mono; font-weight:600; font-size:13.5px`; pct `display:block; font-size:11.5px; color:var(--text-3)`.
- Data: Dine-in 74 ₹31360 table icon `var(--info)`/`var(--info-t)`/`var(--info-i)`; Takeaway 31 ₹9650 bag icon `var(--warn)`/`var(--warn-t)`/`var(--warn-i)`; Delivery 21 ₹7240 truck icon `var(--res)`/`var(--res-t)`/`var(--res-i)`. `n = round(n*kO)`, amount `RS(r10(a*kN))`, pct `round(a/48250*100)` (65%, 20%, 15% in every period).

### 3.11 Money leaks
Generic card + `grid-column:{{ db.L.span3 }}`.
- Head `display:flex; justify-content:space-between; align-items:flex-start; gap:10px`: "Money leaks", sub "Cancelled, voided and given away"; total pill `display:flex; align-items:center; height:24px; padding:0 9px; border-radius:12px; background:{{ db.leak.bg }}; color:{{ db.leak.fg }}; font-size:12px; font-weight:600; white-space:nowrap`: `RS(total)+' lost'` with `var(--bad-t)/var(--bad-i)`, or "Nothing lost" with `var(--ok-t)/var(--ok-i)`.
- Rows `display:flex; align-items:center; gap:12px; padding:9px 0; border-top:1px solid var(--border-2)`: icon tile `32×32; flex:none; border-radius:9px; background:{{ r.ibg }}; color:{{ r.ifg }}` (amount > 0: `var(--bad-t)`/`var(--bad-i)`; else `var(--surface-3)`/`var(--text-3)`), icon 16px stroke 1.8; text `flex:1`: label `display:block; font-size:13.5px; font-weight:500`, sub `display:block; font-size:12px; color:var(--text-3)` `n+' '+unit+(n===1?'':'s')`; amount `Geist Mono; font-weight:600; font-size:13.5px; color:{{ r.vc }}` `'− '+RS(amt)` (`var(--bad-i)`) or `₹0` (`var(--text-3)`).
- Rows: Cancelled orders (unit order, ban icon), Voided items (unit item, undo-arrow icon), Discounts given (unit order, price-tag icon), Rewards given (unit order, gift icon). Today: 2 orders − ₹780; 5 items − ₹1,140; 14 orders − ₹1,840; 3 orders − ₹260; pill "₹4,020 lost". Not masked.

### 3.12 Top items (first card of the second `three` grid)
- "Top items"; sub `{{ db.P.label }} · by sales`. List `margin-top:8px`.
- Row `display:grid; grid-template-columns:24px minmax(0,1fr) auto; align-items:center; gap:10px; padding:8px 0` (no separators): rank `Geist Mono; font-size:13px; font-weight:600; color:{{ t.rc }}` (`01` in `var(--brand)` #C8381F, others `var(--text-3)`); name line `display:flex; align-items:center; gap:7px; font-size:13.5px; font-weight:500; nowrap; overflow:hidden` with `7×7` round dot `{{ t.dot }}` (section hue) and ellipsised name; bar track as 3.10 (`margin-top:7px`) with fill `width:{{ t.w }}%; background:var(--accent); animation:growX .9s cubic-bezier(.2,.8,.2,1) both`; right amount `display:block; Geist Mono; 600; 13.5px` and `{{ t.sold }} sold` `display:block; font-size:11.5px; color:var(--text-3)`.
- Data `TP`: Chicken Biryani 38 / ₹13262; Butter Chicken 42 / ₹12558; Margherita 31 / ₹10819; Paneer Butter Masala 24 / ₹6696; Cold Coffee 29 / ₹3741. amount `RS(r10(a*kN))`, sold `round(q*kN)`, `w = round(a/13262*100)`. Section hues `SEC_HUE`: Starters #E8590C, Mains #C92A2A, Sides #D19A00, Drinks #1C7ED6, Desserts #AE3EC9.

### 3.13 Sales by category
- "Sales by category"; sub `{{ db.P.label }} · share of item sales`.
- Bar `display:flex; height:26px; border-radius:7px; overflow:hidden; gap:2px; margin-top:14px`; spans `title="{{ c.name }}"` `width:{{ c.pct }}%; background:{{ c.c }}`.
- Rows `display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid var(--border-2); font-size:13.5px`: `9×9; border-radius:50%` dot; name `flex:1`; amount Geist Mono 600; pct `width:36px; text-align:right; font-size:12px; color:var(--text-3)`.
- Data CB: Starters 7240, Mains 24110, Sides 4820, Drinks 7960, Desserts 4120; amount `RS(r10(v*kN))`; pct `round(v/48250*100)` (15, 50, 10, 16, 9).

### 3.14 Slow movers
Generic card + `grid-column:{{ db.L.span3 }}`. Head as Money leaks: "Slow movers", sub "Fewest sold · last 4 weeks", link "Menu →" → menu.
- Row `display:flex; align-items:center; gap:10px; padding:9px 0; border-top:1px solid var(--border-2)`: name line as Top items (7px dot, 13.5px 500, ellipsis); since `display:block; font-size:12px; color:var(--text-3); margin-top:2px; padding-left:14px`; tag `height:24px; padding:0 9px; border-radius:12px; background:{{ s.bg }}; color:{{ s.fg }}; font-size:12px; font-weight:600; display:flex; align-items:center; white-space:nowrap`.
- Five items (pool = non-popular items not in TP, indices `(k*7)%len` for k in 0,3,6,9,12): rendered Crispy Corn "No orders in 4 weeks" "Not sold"; Veg Dum Biryani "Added 2 Oct · never ordered" "Not sold"; Garlic Bread "Last sold 9 days ago" "1 sold"; Chicken Manchow "Last sold 6 days ago" "2 sold"; Mutton Rogan Josh "Last sold 4 days ago" "2 sold". Tag colours: not sold `var(--warn-t)/var(--warn-i)`; sold `var(--surface-3)/var(--text-2)`.

### 3.15 Busy hours (full width)
Generic card.
- Head `display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap`: "Busy hours", sub "Orders per hour on an average day · last 4 weeks"; caption chip `display:flex; align-items:center; gap:8px; height:34px; padding:0 12px; border-radius:9px; background:var(--surface-2); border:1px solid var(--border-2); font-size:13px; white-space:nowrap`: `<span style="color:var(--text-3)">{{ capLabel }}</span><b style="font-weight:600">{{ cap }}</b>`. Idle: "Hover any hour" / "to see the average". Hovered: `'{Day}, '+hl(hour)` / `v+' orders'` (measured "Sat, 7 pm" / "16.9 orders").
- Scroller `overflow-x:auto; margin-top:14px`; grid (mouse-leave → clear) `min-width:560px; display:grid; grid-template-columns:40px repeat(13,minmax(0,1fr)); gap:4px`. Header row: empty cell + 13 labels `font-size:11px; color:var(--text-3); text-align:center; white-space:nowrap` (even indices `11am, 1pm, 3pm, 5pm, 7pm, 9pm, 11pm`, others empty). Rows Mon…Sun: day label `font-size:12px; color:{{ r.dc }}; font-weight:{{ r.fw }}; display:flex; align-items:center` (today `var(--text)` 600, others `var(--text-2)` 400); cells `height:30px; border-radius:6px; background:{{ c.bg }}; box-shadow:{{ c.ring }}; transition:box-shadow .12s`; hovered cell ring `0 0 0 2px var(--text)`. Measured cell width 66.61 (1280), 58.92 (1024), 43.22 (820), 36 (390, grid 560 wide and horizontally scrollable).
- Levels `LV`: 0 `var(--surface-2)`; 1–5 `color-mix(in oklab, var(--accent) P%, var(--surface))` with P = 16, 30, 48, 70, 100 (≈ #DAE8FF, #B9D4FF, #90BAFF, #5E97FF, #0F62FE). `lvl(v) = v<=0 ? 0 : min(5, ceil(v/max*5))`. Values `HMv[d][i] = +(HV[i]/9.8*21*df[d]*(.86+rnd(d*31+i)*.22)).toFixed(1)`, `df = [.72,.7,.78,.82,1,1.18,1.05]`.
- Footer `display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-top:14px; font-size:12.5px; color:var(--text-2)`: `Busiest: <b style="color:var(--text);font-weight:600">{{ busiest }}</b> · {{ busiestN }} orders on average` ("Saturday, 8 pm – 9 pm", 23.7); legend `display:flex; align-items:center; gap:4px` "Fewer" + six `14×14; border-radius:3px` swatches + "More".

### 3.16 Reveal mechanism and PIN dialog
State: `rvShow`, `rvPin {pin,msg,errN}`, `rvBy`, `rvUntil`.
- `rvOk()` = `rvBy === user && Date.now() < rvUntil`.
- `rvToggle()`: if shown and ok → hide (`rvShow:false`); else if ok → show (no PIN); else open the PIN dialog `rvPin:{pin:'',msg:null,errN:0}`.
- `rvPress(k)`: ignored while busy; `del` removes the last digit; `clr` clears; max 4 digits; each digit clears `msg`. On the 4th digit, after 180 ms: if equal to the signed-in user's PIN → `rvPin:null, rvShow:true, rvBy:user, rvUntil:now+3600e3` (1 hour) and toast "Sales visible for the next hour · tap the eye to hide"; else `pin:'', msg:'Incorrect PIN', errN+1`.
- Leaving the dashboard sets `rvShow:false` (unlock window stays); `lockNow` sets `rvShow:false, rvPin:null`. Within the hour the same user can press Show again without a PIN.
- No keyboard input and no Escape handling for this dialog; it closes with Cancel or a scrim click.

Dialog (`sc-if rvOpen`):
| Element | Properties |
|---|---|
| Scrim | `animation:fadeIn .2s ease both; position:fixed; inset:0; z-index:50; background:var(--scrim); display:flex; align-items:{{ L.sheetAlign }}; justify-content:center; padding:{{ L.sheetPad }}`; click → close. |
| Panel | `animation:sheetIn .34s cubic-bezier(.2,.8,.2,1) both; width:100%; max-width:360px; background:var(--surface); border:1px solid var(--border); border-radius:{{ L.sheetRadius }}; box-shadow:var(--pop); padding:20px; display:flex; flex-direction:column; gap:16px`. Measured 360×506.69: 1280 `[460,146.66]`, 1024 `[332,130.66]`, 820 `[230,336.66]`, 390 `[15,337.31]` (bottom-anchored, radius `14px 14px 0 0`; not full width because of max-width 360). |
| Header | `display:flex; gap:12px; align-items:flex-start` (h 83.69). Icon tile `38×38; flex:none; border-radius:10px; background:var(--ink); color:var(--on-ink)` with eye icon 18px stroke 1.8. Title "Show sales figures" `font-size:17px; font-weight:600`. Sub `font-size:13.5px; color:var(--text-2); margin-top:3px; line-height:1.45; text-wrap:pretty`: "Sales stay visible on this device for 1 hour. They hide again when the screen locks or you leave Dashboard." |
| PIN block | `display:flex; flex-direction:column; align-items:center; gap:10px` (h 69). Prompt `font-size:13px; color:var(--text-2)` `{First name}, enter your PIN` ("Rohan, enter your PIN"). Dots (below). Message `min-height:18px; font-size:13px; font-weight:500; color:var(--bad-i)` ("Incorrect PIN"). |
| Keys | `display:grid; grid-template-columns:repeat(3,1fr); gap:8px` (318×224). Key `button`: `height:50px; border:1px solid {{ k.border }}; background:{{ k.bg }}; border-radius:14px; font-size:{{ k.size }}; font-weight:500; color:var(--text)`; hover `background:var(--hover)`; active `background:var(--surface-3)`. Measured keys 100.66×50. |
| Cancel | `height:40px; border:0; background:transparent; color:var(--link); font-size:14px; font-weight:500`. |

`keysFor(press, off)`: order `1 2 3 4 5 6 7 8 9 clr 0 del`; label `Clear` for clr, `⌫` (U+232B) for del; digits `size 24px`, `bg var(--surface)`, `border var(--border)`; del `20px`; Clear `14px`; non-digits `bg transparent`, `border transparent`; `off` → `disabled` (the reveal dialog markup does not bind `disabled`).

`dots(n, errN, err, key)` (reveal dialog; `err = !!msg && !pin.length`): container `display:flex; gap:16px; justify-content:center; animation: errN ? 'shake .42s ease' : 'none'`, React key `key+errN` (re-mount replays the shake on every error). Four spans `14×14; border-radius:50%; border:1.5px solid (err ? var(--bad) : (i<n ? var(--ink) : var(--text-3))); background: i<n ? var(--ink) : (err ? var(--bad-t) : transparent); transition:background .12s`. Measured empty `rgb(107,107,116)` border; filled `rgb(24,24,27)`; error border `rgb(218,30,40)` fill `rgb(255,241,241)`; dot pitch 30 (row 104 wide).

### 3.17 Masked vs shown
Mask function `MK(v) = SHOW ? v : '₹ • • • •'` (₹, space, then "•" U+2022 separated by single spaces). Masked: hero net sales, Average order, Collected (and its note becomes "still due hidden"), bill-breakdown values (`• • • •` in `var(--text-3)`), bill-breakdown Net sales. Not masked: Orders count, every delta %, chart (ticks, tooltip, peak/quietest amounts), live tables amounts, recent order amounts, payments, sources, leaks, top items, categories.

### 3.18 Measured section boxes
1280×800 (content x 256–1256): attention `[256,76,1000,76]`; period `[256,168,1000,42]`; hero grid `[256,226,1000,302]`; chart/tables `[256,544,1000,878]` (chart card 656 wide, tables 328); orders/reservations `[256,1438,1000,382]`; three-grid 1 `[256,1836,1000,631]` (paid/sources 492 each, h 316; leaks spans `[256,2168,1000,299]`); three-grid 2 `[256,2483,1000,708]` (top/categories h 330; slow movers `[256,2829,1000,362]`); busy hours `[256,3207,1000,374]`; content height 3553; full page 3609.
1280 collapsed (x 100–1256): hero `717.77 + 422.23`; chart/tables `[100,544,1156,682]` (760 + 380); three-grids 3×374.66; busy hours `[100,2366,1156,374]`; content height 2712.
1024×768 (x 100–1000): hero section `[100,226,900,290]`, bill `[100,532,900,294]`; chart `[100,850,900,371]`, tables `[100,1237,900,450]`; orders `[100,1703,900,382]`, reservations `[100,2101,900,307]`; paid/sources 442 each (h 332), leaks `[100,2772,900,299]`; top/categories h 330, slow `[100,3433,900,362]`; busy `[100,3811,900,374]`; full page 4213.
820×1180: same y values as 1024; width 696; two-column cards 340.
390×844 (x 14–376): attention card `[14,72,362,50]`; period `[14,138,362,90]`; hero `[14,244,362,521]`; bill `[14,781,362,294]`; chart `[14,1099,362,424]`; tables `[14,1539,362,704]`; orders `[14,2259,362,382]`; reservations `[14,2657,362,307]`; paid `[14,2980,362,332]`; sources `[14,3328,362,275]`; leaks `[14,3619,362,299]`; top `[14,3934,362,330]`; categories `[14,4280,362,302]`; slow `[14,4598,362,362]`; busy `[14,4976,362,447]`; full page 5515.

### 3.19 Rendered dashboard text (1280×800, revealed, 12:2x; " | " marks a break between text blocks)
```
NEEDS ATTENTION | ₹8,450 due from 6 customers | Collect | T1 bill printed, not paid | Open | 2 tables with items not sent to kitchen | Send | T3 reserved for 12:30 pm · Rahul Mehta | View | Today | Mon, 19 Oct · compared with last Monday | Today | Yesterday | 7 days | 30 days | Net sales · Today | ₹48,250 | ↑ 12.4% | vs | last Monday | Hide | Visible · hides in 60 min | Orders | 126 | ↑ 6.8% vs last mon | Average order | ₹383 | ↑ 5.2% per bill | Collected | ₹46,980 | ↑ 11.1% ₹1,270 still due | Bill breakdown | TODAY | Gross bill | ₹47,120 | Discounts | − ₹1,840 | Rewards given | − ₹260 | GST (5%) | + ₹2,480 | Service charge | + ₹750 | Net sales | ₹48,250 | Sales by hour | Today · open hours, 11 am – 11 pm | Today | Last Mon | ₹6k | ₹4k | ₹2k | ₹0 | 11am | 1pm | 3pm | 5pm | 7pm | 9pm | 11pm | Peak 12 pm · ₹3,470 | Quietest 11 am · ₹1,520 | So far vs last mon +31% | Live tables | 6 of 22 in use · 4 reserved | Floor → | Free | 12 | Eating | 5 | Bill printed | 1 | Reserved | 4 | INDOOR | T1 | Bill printed | T2 | 2 seats | T3 | 12:30 PM | T4 | KOT pending | T5 | 6 seats | T6 | ₹768 · 41m | T7 | ₹439 · 14m | T8 | 4 seats | T9 | 1:45 PM | T10 | 2 seats | T11 | 4 seats | T12 | 6 seats | PATIO | T13 | KOT pending | T14 | 4 seats | T15 | 2 seats | T16 | 1:00 PM | T17 | ₹767 · 55m | T18 | 2 seats | ROOFTOP | T19 | 4 seats | T20 | 4 seats | T21 | 2:45 PM | T22 | 2 seats | Recent orders | Completed today · newest first | All orders → | T12 | #1035 · Table 12 | Dine-in · 3 items · 74 min ago | UPI | ₹879 | T9 | #1034 · Table 9 | Dine-in · 6 items · 95 min ago | Card | ₹1,019 | DL | #1033 · Delivery 1 | Delivery · 2 items · 110 min ago | UPI | ₹659 | TA | #1032 · Takeaway 8 | Takeaway · 3 items · 128 min ago | Cash | ₹595 | T3 | #1031 · Table 3 | Dine-in · 3 items · 150 min ago | UPI | ₹779 | Today's reservations | 4 bookings · by time | View all → | 12:30 PM | Rahul Mehta | Table 3 · Indoor · 4 seats | Seat | 1:00 PM | Kapoor family | Table 16 · Patio · 6 seats | Seat | 1:45 PM | Priya Menon | Table 9 · Indoor · 8 seats | Seat | 2:45 PM | Infosys team | Table 21 · Rooftop · 8 seats | Seat | How guests paid | Today · money collected | ₹46,980 | UPI · 58 orders | ₹22,080 | 47% | Cash · 44 orders | ₹17,850 | 38% | Card · 19 orders | ₹7,050 | 15% | Due · 5 orders | ₹0 | 0% | Due bills count only what was paid so far — the rest sits in customer dues. | Where orders came from | Today · completed orders | Dine-in · 74 orders | ₹31,360 | 65% | Takeaway · 31 orders | ₹9,650 | 20% | Delivery · 21 orders | ₹7,240 | 15% | Money leaks | Cancelled, voided and given away | ₹4,020 lost | Cancelled orders | 2 orders | − ₹780 | Voided items | 5 items | − ₹1,140 | Discounts given | 14 orders | − ₹1,840 | Rewards given | 3 orders | − ₹260 | Top items | Today · by sales | 01 | Chicken Biryani | ₹13,260 | 38 sold | 02 | Butter Chicken | ₹12,560 | 42 sold | 03 | Margherita | ₹10,820 | 31 sold | 04 | Paneer Butter Masala | ₹6,700 | 24 sold | 05 | Cold Coffee | ₹3,740 | 29 sold | Sales by category | Today · share of item sales | Starters | ₹7,240 | 15% | Mains | ₹24,110 | 50% | Sides | ₹4,820 | 10% | Drinks | ₹7,960 | 16% | Desserts | ₹4,120 | 9% | Slow movers | Fewest sold · last 4 weeks | Menu → | Crispy Corn | No orders in 4 weeks | Not sold | Veg Dum Biryani | Added 2 Oct · never ordered | Not sold | Garlic Bread | Last sold 9 days ago | 1 sold | Chicken Manchow | Last sold 6 days ago | 2 sold | Mutton Rogan Josh | Last sold 4 days ago | 2 sold | Busy hours | Orders per hour on an average day · last 4 weeks | Hover any hour | to see the average | 11am | 1pm | 3pm | 5pm | 7pm | 9pm | 11pm | Mon | Tue | Wed | Thu | Fri | Sat | Sun | Busiest: Saturday, 8 pm – 9 pm · 23.7 orders on average | Fewer | More
```

Phone (390×844, masked) differs in: attention card "4 | Needs attention | ₹8,450 due · T1 · 2 tables · T3"; masked values "₹ • • • •" / "• • • •"; chart x labels "11am | 2pm | 5pm | 8pm | 11pm"; no pay pills in Recent orders; header buttons icon-only.

---

## 4. Sign-in and lock

### 4.1 Sign-in screen (`d-signin`)
Not present in this mock-up. `renderVals` returns `isSignin:false` and the markup has no block bound to it or to `si.*`. Route `#signin` renders the shell with an empty page area: on 1280/1024/820 the side nav of the last signed-in staff (Priya Sharma, Cashier) with nothing to its right; on 390 a blank `var(--bg)` screen (no tab bar). Shots `signin-route-*.png` show this.
Logic that still exists in app.js (no markup uses it): `SI0 = {user:'admin', pass:'', show:false, err:null, errN:0, loading:false, remember:true, caps:false, focus:null, leaving:false}`; `signin()`: empty username → "Enter your username"; empty password → "Enter your password"; then `loading` for 900 ms; username must be `admin` (case-insensitive) and password at least 6 characters, else "Incorrect username or password" (password cleared); success → `leaving` for 480 ms then route `login` and toast "Terminal unlocked · staff can sign in". Enter submits; Caps Lock state tracked. Computed `si` strings: button `Signing in…` / `Welcome` / `Sign in`; status `Kitchen live · 6 tables seated` / `Offline · will sync`; service `MORNING SERVICE` (<12h) / `LUNCH SERVICE` (<17h) / `EVENING SERVICE`; terminal `Counter 1`; show/hide titles `Show password` / `Hide password`; receipt lines Margherita ×1 ₹409, Butter Chicken ×1 ₹499, Garlic Naan ×3 ₹207, Cold Coffee ×2 ₹258; field focus border `var(--accent)` + ring `0 0 0 4px var(--accent-t)`, error border `var(--bad)`, idle `var(--border)`; remember box `var(--accent)` / `var(--text-3)`; password letter-spacing `.18em` when hidden and non-empty. Unused `Lay` keys for it: `siPad (ph 12px / 24px)`, `siCols`, `siVisH (230/560/620px)`, `siVisPad`, `siFormPad`, `siH (42/48/60px)`, `siTag (26/30/36px)`, `receiptDisplay`.

### 4.2 Lock screen root (`sc-if isLogin`, route `login`; initial route of the app)
| Element | Properties |
|---|---|
| Root | `position:fixed; inset:0; z-index:60; background:var(--bg); color:var(--text); display:flex; flex-direction:column; overflow:hidden; animation:{{ lk.anim }}` = `fadeIn .4s ease both`, or during unlock `unlock .44s cubic-bezier(.4,0,.2,1) forwards`. |
| Tint | `position:absolute; left:0; right:0; top:0; height:320px; background:linear-gradient(180deg,var(--accent-t),transparent); pointer-events:none`. |
| Top bar | `header`: `position:relative; flex:none; display:flex; align-items:center; gap:12px; padding:{{ L.lkHeadPad }}` (`20px 28px`; phone `14px 16px`). Measured h 78 (66 on phone). |
| Logo | `34×34; flex:none; border-radius:9px; background:var(--brand); color:#FFFFFF; centred; Shrikhand 400 19px; padding-top:2px` "O". Measured `[28,22,34,34]` / phone `[16,16,34,34]`. |
| Name block | `display:flex; flex-direction:column; flex:1; min-width:0`. Name `Shrikhand 400; font-size:20px; line-height:1.1; color:var(--brand) (#C8381F); nowrap; ellipsis`. Sub `font-size:12px; color:var(--text-2)` "Sandbee POS · Counter 1". |
| Online chip | `display:{{ L.lkChips }}` (none on phone); `align-items:center; gap:7px; font-size:12.5px; color:var(--text-2); white-space:nowrap`; dot `7×7; border-radius:50%; background:{{ lk.netDot }}` (`var(--ok)`, offline `var(--warn)`); text `Online` / `Offline · PINs still work`. Measured `[1115.16,30.5,50.81,17]`. |
| Divider | `display:{{ L.lkChips }}; width:1px; height:20px; background:var(--border)`. |
| Clock | `font-size:13.5px; font-weight:500; white-space:nowrap` `{{ lk.time }} {{ lk.ampm }}` (`((h%12)\|\|12)+':'+mm` + `AM`/`PM`, e.g. "12:22 PM"; refreshed every second on this screen). Measured 61.03×18. |
| Main | `position:relative; flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; align-items:center; padding:{{ L.lkPad }}` (`8px 24px`; phone `4px 12px 8px`). |
| Card | `margin:auto 0; width:100%; max-width:{{ L.lkMax }}; background:var(--surface); border:1px solid var(--border); border-radius:{{ L.lkCardR }}; box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 40px rgba(0,0,0,.06); padding:{{ L.lkCardPad }}; display:flex; flex-direction:column; gap:20px; animation:rise .45s cubic-bezier(.2,.8,.2,1) both`. Vertically centred in Main. |
| Footer | `position:relative; flex:none; display:flex; justify-content:center; flex-wrap:wrap; gap:6px 18px; padding:10px 16px calc(14px + env(safe-area-inset-bottom)); font-size:12.5px; color:var(--text-3)`: "Demo PIN 1234" and "Powered by Sandbee POS". Measured h 41. |

Lock `L` values:

| Key | Expression | 1280 (desk) | 1024 (tab) | 820 (tab) | 390 (ph) |
|---|---|---|---|---|---|
| `lkHeadPad` | `ph?'14px 16px':'20px 28px'` | `20px 28px` | `20px 28px` | `20px 28px` | `14px 16px` |
| `lkChips` | `ph?'none':'flex'` | flex | flex | flex | none |
| `lkPad` | `ph?'4px 12px 8px':'8px 24px'` | `8px 24px` | `8px 24px` | `8px 24px` | `4px 12px 8px` |
| `lkMax` | `desk?'900px':(tab?'680px':'520px')` | 900px | 680px | 680px | 520px |
| `lkCardR` | `ph?'16px':'20px'` | 20px | 20px | 20px | 16px |
| `lkCardPad` | `ph?'20px 16px':(tab?'24px':'28px 32px')` | `28px 32px` | 24px | 24px | `20px 16px` |
| `lockH` | `ph?'22px':'26px'` | 26px | 26px | 26px | 22px |
| `lkSearchW` | `ph?'calc(100% - 32px)':'260px'` | 260px | 260px | 260px | `calc(100% - 32px)` (300 measured) |
| `avCols` | `desk?'6':(tab?'4':'3')` | 6 | 4 | 4 | 3 |
| `avGap` | `ph?'6px':'8px'` | 8px | 8px | 8px | 6px |
| `avSize` | `ph?'52px':'60px'` | 60px | 60px | 60px | 52px |
| `avFont` | `ph?'17px':'20px'` | 20px | 20px | 20px | 17px |
| `avName` | `ph?'13px':'14px'` | 14px | 14px | 14px | 13px |
| `padInner` | `ph?'0':'4px 0 8px'` | `4px 0 8px` | `4px 0 8px` | `4px 0 8px` | 0 |
| `keyH` | `ph?'62px':'60px'` | 60px | 60px | 60px | 62px |

### 4.3 Staff picker (`lk.isPick`, `lock.step==='pick'`)
| Element | Properties |
|---|---|
| Head row | `display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:14px`. Measured 1280 `[223,219,834,56]`; 390 `[29,92,332,104]` (search wraps below). |
| Greeting | `font-size:{{ L.lockH }}; font-weight:600; letter-spacing:-.02em` `{{ greeting }}`: hour < 12 "Good morning", < 17 "Good afternoon", else "Good evening". Measured box h 34 (26px) / 28 (22px). |
| Sub | `font-size:14px; color:var(--text-2); margin-top:4px` `Select your name to sign in · {{ todayLabel }}` ("Select your name to sign in · Monday, 19 October"). |
| Search box | `display:flex; align-items:center; gap:8px; height:40px; width:{{ L.lkSearchW }}; border:1px solid var(--border); border-radius:8px; padding:0 12px; background:var(--surface)`. Icon 15px stroke 2 (linecap round) `flex:none; color:var(--text-3)`: circle cx 11 cy 11 r 7 + handle `m20 20-3.5-3.5`. Input `flex:1; min-width:0; border:0; outline:0; background:transparent; font-size:14px; color:var(--text)`, placeholder "Search staff" (`var(--text-3)`). No focus style. Filters by name substring, case-insensitive. Measured 1280 `[797,235,260,40]`. |
| Role tabs | `display:flex; gap:4px; border-bottom:1px solid var(--border); overflow-x:auto; margin-top:-6px`. Button `flex:none; border:0; background:transparent; height:40px; padding:0 12px; font-size:13.5px; font-weight:{{ r.fw }}; color:{{ r.color }}; box-shadow:{{ r.line }}; white-space:nowrap`; content `{{ r.label }} <span style="color:var(--text-3);font-weight:400">{{ r.count }}</span>`. Selected: 600, `var(--text)`, `inset 0 -2px 0 var(--accent)`; others 500, `var(--text-2)`, none. Tabs: "All staff 12", "Managers 2", "Cashiers 3", "Captains 7" (count = staff of that role; All = all staff). Measured widths 94.36, 97.95, 90.48, 91.89 (h 40); on 390 the row overflows (last tab ends at x 415.69) and scrolls horizontally. Click sets the role filter. |
| Grid | `display:grid; grid-template-columns:repeat({{ L.avCols }},minmax(0,1fr)); gap:{{ L.avGap }}`. Measured columns 1280 `132.328px ×6`; 1024/820 `151.5px ×4`; 390 `106.656px 106.672px 106.656px`. |
| Tile | `button title="{{ p.name }}"`: `position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; border:1px solid {{ p.border }}; background:{{ p.bg }}; padding:14px 6px 12px; border-radius:12px; color:var(--text); min-width:0; animation:rise .4s cubic-bezier(.2,.8,.2,1) both; animation-delay:{{ p.d }}` (`min(.05+index*.03,.4)` s, 2 decimals). Hover `background:var(--hover); border-color:var(--border)`. Measured 132.33×130 (desk), 151.5×130 (tab), 106.66×121 (phone). |
| Avatar | `position:relative; width/height:{{ L.avSize }}; border-radius:50%; background:{{ p.avBg }}; color:{{ p.avColor }}; centred; font-weight:600; font-size:{{ L.avFont }}`; text initials. |
| Lock badge | `display:{{ p.lockDisplay }}` (flex only for the staff who locked the screen); `position:absolute; right:-2px; bottom:-2px; 20×20; border-radius:50%; background:var(--ink); color:var(--on-ink); box-shadow:0 0 0 2px var(--surface); centred`; padlock icon 10px stroke 2.8. |
| Name | wrapper `display:flex; flex-direction:column; align-items:center; max-width:100%`. Short name `font-size:{{ L.avName }}; font-weight:500; nowrap; ellipsis; max-width:100%` = first name + space + first letter of the second word + "." ("Priya S."). Sub `font-size:12px; color:{{ p.subColor }}; white-space:nowrap`. |
| Empty | `padding:20px; text-align:center; font-size:14px; color:var(--text-2)` `No staff found for “{q}”.` |

Tile states:
| State | sub text | sub colour | border | bg | badge |
|---|---|---|---|---|---|
| Locked the screen (`lockedBy`) | `Locked · ` + `ago(lockedAt)` ("Locked · 3 min ago") | `var(--accent-i)` (#0043CE) | `var(--accent-b)` (#A6C8FF) | `var(--accent-t)` (#EDF5FF) | shown |
| Locked out (too many tries, until `lockUntil`) | Try again soon | `var(--bad-i)` | transparent | transparent | hidden |
| Normal | role (Manager/Cashier/Captain) | `var(--text-2)` | transparent | transparent | hidden |
Sort: the staff who locked the screen first, then role order Manager, Cashier, Captain, Kitchen, then name. Demo order: Priya S. (Locked · 3 min ago), Meera I., Rohan K., Ishita D., Neha J., Amit V., Ananya B., Arjun M., Karan S., Kavya N., Rahul G., Sana K. Tile click → PIN pad for that staff (`lock.step='pin'`, purpose `login`).

### 4.4 PIN pad (`lk.isPad`, `lock.step==='pin'`)
Final values are those of app.js lines 818–823 (they overwrite the earlier dark-style values of lines 800–803, except `msg`, `padOp`, key `off` and key `onClick`, which are kept from 801–803).

| Element | Properties |
|---|---|
| Wrapper | `display:flex; flex-direction:column; align-items:center; gap:18px; padding:{{ L.padInner }}; animation:fadeIn .25s ease both`. |
| Back | `button`: `align-self:flex-start; display:flex; align-items:center; gap:4px; border:0; background:transparent; color:var(--link); font-size:14px; font-weight:500; padding:4px 0`; chevron-left icon 16px stroke 2.2; text "All staff". Click → back to the picker (also Escape). Measured 71.05×26. |
| Avatar | `80×80; border-radius:50%; background:{{ lk.u.avBg }}; color:{{ lk.u.avColor }}; centred; font-weight:600; font-size:26px; box-shadow:{{ lk.ring }}; transition:box-shadow .3s`. `ring` = `0 0 0 4px var(--surface),0 0 0 6px var(--ok)` on success, else `none`. |
| Name | `text-align:center`; name `font-size:20px; font-weight:600`; line `font-size:13.5px; color:var(--text-2); margin-top:3px` `{role} · Enter your 4-digit PIN` ("Manager · Enter your 4-digit PIN"). Measured block 197.11×47. |
| Dots + message | `display:flex; flex-direction:column; align-items:center; gap:10px`. Dots `lk.dotsEl` (below). Message `min-height:20px; font-size:13px; font-weight:500; color:{{ lk.msgColor }}`. |
| Keypad | `display:grid; grid-template-columns:repeat(3,1fr); gap:10px; width:100%; max-width:300px; opacity:{{ lk.padOp }}` (.35 while locked out, else 1). Key `button disabled="{{ k.off }}"`: `height:{{ L.keyH }}; border:1px solid {{ k.border }}; background:{{ k.bg }}; border-radius:10px; font-size:{{ k.size }}; font-weight:500; color:var(--text)`; hover `background:var(--hover)`; active `background:var(--surface-3)`. Digits `22px`, `var(--surface)`, `var(--border)`; "⌫" `19px`; "Clear" `13.5px`; non-digits transparent bg and border. Order 1–9, Clear, 0, ⌫. Measured keys 93.33×60 (phone 93.33×62), grid 300×270 (phone 300×278). |
| Forgot | `button`: `border:0; background:transparent; color:var(--link); font-size:13.5px; font-weight:500; padding:4px` "Forgot PIN?" → toast "Ask a manager to reset your PIN from Settings → Staff". Measured 82.42×26. |

Lock dots (`lk.dotsEl`, line 822): container `display:flex; gap:16px; animation: errN ? 'shake .42s ease' : 'none'`, React key `'lk'+errN` (replays per error). Four spans `13×13; border-radius:50%; border:1.5px solid C; background:B; transition:background .15s,border-color .15s`, where C = `var(--ok)` on success; else `var(--bad)` if (locked out or last result bad) and no digits typed; else `var(--ink)` for typed positions, `var(--text-3)` for empty; B = typed ? (success ? `var(--ok)` : `var(--ink)`) : transparent. Measured pitch 29 (row 100×13); empty border `rgb(107,107,116)`; typed `rgb(24,24,27)` fill; error border `rgb(218,30,40)` with transparent fill (unlike the reveal dialog dots, no `--bad-t` fill); success `rgb(36,161,72)`.

Messages and colours (`msgColor`): success "Unlocking…" `var(--ok-i)`; wrong "Incorrect PIN · 2 tries left", then "Incorrect PIN · 1 try left" `var(--bad-i)`; lock-out "Too many tries. Try again in 0:SS" (`'0:'+String(secs).padStart(2,'0')`, starts at 0:30) `var(--bad-i)`; otherwise empty, `var(--text-2)`.

Behaviour:
- Physical keys 0–9 and Backspace work when focus is not in an input; Escape goes back.
- `pinPress`: ignored while busy or locked out; `del`/`clr`; max 4; typing after a bad result clears the message. 4th digit → 180 ms → `pinDone`.
- Wrong PIN: attempts+1; `maxTries` 3 → on the 3rd wrong attempt `lockUntil = now + lockoutSec (30) s`, attempts reset, keys disabled, pad opacity .35, tile sub "Try again soon".
- Correct PIN: `lock.ok=true` (green dots, ring, "Unlocking…"); after 420 ms the whole screen plays `unlock .44s`; at 860 ms `signIn`: route = the user's previous route if they locked it themselves (`lockedRoute`), else their role home; toast "Welcome back, {First}" (same user) or "Signed in as {First} · {Previous first}’s session saved" (measured "Signed in as Rohan · Priya’s session saved").

### 4.5 Measured lock layout
| Viewport | Picker card | Head / grid | PIN card | Avatar | Dots row | Keypad | Forgot | Footer |
|---|---|---|---|---|---|---|---|---|
| 1280×800 | `[190,190,900,457]` | head `[223,219,834,56]`, tabs `[223,289,834,41]`, grid `[223,350,834,268]` | `[190,92.5,900,652]` | `[600,169.5,80,80]` | `[590,332.5,100,13]` | `[490,393.5,300,270]` | `[598.78,681.5,82.42,26]` | `[0,759,1280,41]` |
| 1024×768 | `[172,109,680,587]` | head `[197,134,630,56]`, grid `[197,265,630,406]` | `[172,86,680,644]` | `[472,159,80,80]` | `[462,322,100,13]` | `[362,383,300,270]` | `[470.78,671,82.42,26]` | `[0,727,1024,41]` |
| 820×1180 | `[70,315,680,587]` | head `[95,340,630,56]`, grid `[95,471,630,406]` | `[70,286.5,680,644]` | `[370,359.5,80,80]` | `[360,522.5,100,13]` | `[260,583.5,300,270]` | `[368.78,871.5,82.42,26]` | `[0,1139,820,41]` |
| 390×844 | `[12,71,366,723]` | head `[29,92,332,104]`, tabs `[29,210,332,41]`, grid `[29,271,332,502]` | `[12,116.5,366,632]` | `[155,181.5,80,80]` | `[145,344.5,100,13]` | `[45,405.5,300,278]` | `[153.78,701.5,82.42,26]` | `[0,803,390,41]` |
Header row (1280): logo `[28,22,34,34]`, name block `[74,20,…,38]`, Online `[1115.16,30.5,50.81,17]`, divider `[1177.97,29,1,20]`, clock `[1190.97,30,61.03,18]`. Phone header: clock `[312.97,24,61.03,18]`.
Initial state of the demo: route `login`, `lockedBy:'priya'`, `lockedAt` = load time − 3 min, `lockedRoute:'order'`, role filter All, empty search.

---

## 5. Icons (24×24 viewBox, `fill:none`, `stroke:currentColor`, round caps/joins unless noted)
| Where | Depicts | Size | Stroke |
|---|---|---|---|
| Nav items | see 2.4 (house, 2×2 grid, cart, clipboard, cloche, calendar, page, bar chart, sun-cog) | 20 | 1.6 |
| Collapse / Expand | chevron left / chevron right | 18 | 1.8 |
| Header: End of day; header printer button | printer with paper and output tray | 15; 17 | 1.8 |
| Header: New order | plus (round caps, no linejoin attribute) | 14 | 2.4 |
| Tab bar items | same nav glyphs (Home house, Floor grid, Order cart, Orders clipboard, Kitchen cloche, Bookings calendar) | 22 | 1.7 |
| Tab bar More | three horizontal lines | 22 | 1.7 |
| More grid items | nav glyphs | 22 | 1.7 |
| Profile rows | padlock (Lock screen); door bracket with arrow pointing left (Switch user) | 18 | 1.7 |
| Attention card chevron | chevron down (rotates 180°) | 16 | 2 |
| Reveal button | eye (hidden state) / eye with diagonal slash (shown state) | 17 | 1.8 |
| Reveal hint | padlock (no unlock) / clock face with hands (unlocked) | 12 | 2 |
| Reveal dialog header | eye | 18 | 1.8 |
| Sources | Dine-in: table top with legs; Takeaway: shopping bag with handle; Delivery: truck with two wheels | 16 | 1.8 |
| Money leaks | Cancelled: circle with diagonal slash; Voided: undo arrow (left hook); Discounts: price tag with hole; Rewards: gift box | 16 | 1.8 |
| Lock search | magnifier (circle r7 + handle), linecap round only | 15 | 2 |
| Lock tile badge | padlock | 10 | 2.8 |
| PIN pad back | chevron left | 16 | 2.2 |
"⌫" on keypads is the text glyph U+232B, not an SVG.

---

## 6. Reference shots (`spec-shots\`, 77 files)
- Dashboard: `dashboard-masked-{1280x800,1024x768,820x1180,390x844}.png`; full height `dashboard-masked-full-{…}.png`; reveal PIN dialog `dashboard-reveal-pin-{…}.png`; two digits typed `dashboard-reveal-pin-typed-{…}.png`; wrong PIN `dashboard-reveal-pin-wrong-{…}.png`; revealed (with toast) `dashboard-revealed-{…}.png`; revealed full height `dashboard-revealed-full-{…}.png`; hidden but unlocked `dashboard-hidden-unlocked-{…}.png`; phone attention card open `dashboard-attention-open-390x844.png`; chart tooltip on a future hour `dashboard-chart-tooltip-1280x800.png` and on a past hour `dashboard-chart-tooltip-past-1280x800.png`; heat-map hover `dashboard-heatmap-hover-1280x800.png`; period "7 days" `dashboard-period-7days-1280x800.png`.
- Shell: `shell-nav-collapsed-1280x800.png`; profile sheet `shell-profile-menu-{1280x800,1024x768,820x1180}.png` and `shell-profile-menu-collapsed-1280x800.png`; phone More sheet `shell-more-sheet-390x844.png`; toast after unlock on the landing page `after-unlock-{…}.png`.
- Lock: picker `lock-pick-{…}.png`; Managers tab `lock-pick-managers-tab-1280x800.png`; no search results `lock-pick-noresults-1280x800.png`; PIN pad `lock-pin-{…}.png`; typed `lock-pin-typed-{…}.png`; wrong PIN `lock-pin-wrong-{…}.png` (the "1" key shows its hover background because the pointer rested there after the tile click); locked out `lock-pin-lockedout-{…}.png`; correct PIN `lock-pin-success-{…}.png`.
- Sign-in route (no sign-in screen exists): `signin-route-{…}.png`.

---

## Values I could not determine
- The sign-in screen (`d-signin`) layout: the mock-up has no markup for it (`isSignin` is hard-coded `false`; route `#signin` renders an empty page). Only its logic and strings exist (section 4.1); its visual sizes, colours and structure cannot be taken from this file.
- `env(safe-area-inset-bottom)` was 0 in every measurement; real-device values were not measured.
- Clock-dependent dashboard values (chart bars, peak/quietest, "so far" %, recent-order ages, reservation list, greeting, dates) are recorded only for Mon 19 Oct 2026 12:19–12:32 IST; other times follow the formulas given.
