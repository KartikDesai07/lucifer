# Marketing assets — POS Software by sandbee

Everything here renders locally with the desktop app's Electron. Nothing is uploaded anywhere.

## What is here

| File | What it is | Output |
|---|---|---|
| `poster-1-midnight.html` | Features overview — dark green "Midnight" theme | `out/poster-1-midnight.png` |
| `poster-2-paper.html` | Pricing — cream "Paper & Ink" invoice theme | `out/poster-2-paper.png` |
| `poster-3-qr.html` | QR self-ordering flow — green gradient theme | `out/poster-3-qr.png` |
| `poster-4-whatsapp.html` | WhatsApp & Telegram updates — charcoal chat theme | `out/poster-4-whatsapp.png` |
| `poster-5-hook.html` | The hook — "Every year, your billing software sends you a bill. Ours doesn’t." black + acid contrast table | `out/poster-5-hook.png` |
| `book.html` + `book.js` | 6-page brochure ("the book"): cover · 3 pains · everything included · QR flow · WhatsApp & reports · the hook page | `out/pos-software-brochure.pdf` + `out/book/page-1..6.png` |
| `demo-video.html` + `demo-video.js` | 52 s product demo, 1080×1920 (reel / status) | `out/demo-video.mp4` |
| `assets/sandbee-logo.png` | Brand mark (square, dark-green background baked in) | — |

Posters are 1080 × 1350 (4:5) and render at 2× (2160 × 2700 PNG). The video is 1080 × 1920, 30 fps, H.264 MP4.

## Editing the copy

Each poster has a `<script type="application/json" id="poster-data">` block near the top (brand, headline,
features, pricing, contact). Change the text there and re-render — no CSS knowledge needed.

Placeholders still to fill in every file: the WhatsApp number `+91 XXXXX XXXXX`.
Site is `pos.sandbee.in`; pricing is `₹25,000` one-time + `₹5,000` WhatsApp credit (wa.sandbee.in).
Messaging (all assets): "Pay once. Use it for life." · "₹0 yearly renewal — ever" · "Your data is in your hands" — the
renewal/lifetime claim is about the SOFTWARE licence; hosting runs on the café’s own free-tier accounts, so every asset
carries the footnote. Never write "lifetime free" / "free forever" for the whole service — see `docs/PLATFORM.md` §1.

## Rendering

```bash
# one poster (name = file name without .html)
bash marketing/tools/render.sh poster-1-midnight
# several
bash marketing/tools/render.sh poster-1-midnight poster-2-paper poster-3-qr poster-4-whatsapp poster-5-hook

# demo video (first time: cd marketing/tools && npm install)
bash marketing/tools/record.sh            # -> out/demo-video.mp4
bash marketing/tools/stills.sh 3 8.5 24   # still frames at those seconds -> out/stills/

# brochure (PDF + one PNG per page)
bash marketing/tools/render-book.sh
```

Open any `.html` directly in a browser to preview; the video page loops its timeline.

## How it works

- `tools/render-poster.cjs` — offscreen Electron window, waits for fonts (`dataset.ready`), captures a PNG.
- `tools/record-video.cjs` — steps `window.__seek(t)` frame by frame, encodes with WebCodecs (H.264 High)
  in a second window (`tools/encoder.html`) and muxes the MP4 with `mp4-muxer`. Deterministic: same input,
  same video.
- `demo-video.js` — scene times are local (ms from the scene start); move a scene by editing `SCENES` only.
- Fonts come from Google Fonts when online and fall back to Georgia / Segoe UI offline.
- `tools/` has its own `package.json` (outside the npm workspace); its `node_modules` is gitignored.

## Pitch deck (10 slides: PNG + PDF + PPTX)

```bash
# first time: (cd marketing/tools && npm install)   # adds pptxgenjs; tools/ is outside the npm workspace
bash marketing/tools/render-deck.sh
# -> out/deck/slide-01.png .. slide-10.png (1920 x 1080), pos-software-pitch.pdf (16:9), pos-software-pitch.pptx
```

- **Edit the words** in `deck/deck-content.json` only (headline, sub, bullets, cards, price, notes, screenshot slots), then re-render.
  Both outputs read that one file, so the PDF/PNGs and the PPTX stay in step.
- `deck/deck.html` + `deck.css` + `deck.js` draw a slide at 1920 x 1080: `deck.html?slide=3` shows one slide,
  `?slide=all` stacks all of them (one 16:9 print page each, no margins) - the PDF is printed from that in one pass.
  A browser opening the file directly cannot read the JSON; preview with `cd marketing && python -m http.server 8080`.
- `tools/render-deck.cjs` - Electron (from `apps/desktop`): one PNG per slide, then `printToPDF` at 20 x 11.25 in and
  a self-check (page count = slide count, page box 16:9). `tools/render-deck.sh` runs it and then `tools/build-pptx.cjs`.
- `tools/build-pptx.cjs` - `pptxgenjs`: the same 10 slides as editable text boxes and shapes, plus speaker notes
  (the `notes` field). Fonts are Calibri / Georgia so any PowerPoint shows it as designed; run with
  `PPTX_BRAND_FONTS=1` to name Schibsted Grotesk / Fraunces instead (only if those are installed on the presenting PC).
- **Screenshots**: slots load `marketing/shots/<name>.png` (`dashboard`, `pos`, `kitchen`, `qr-menu`, `qr-cart`, `reports`,
  `customers`). A missing file shows a soft blue "name screenshot" card in the PNG/PDF/PPTX, so renders never break.
  Drop the real PNGs into `marketing/shots/` and re-run; frames are shown whole (no cropping).
- Claims: the pricing slide, the cover, the problem slide and the ownership slide carry the footnote
  "*No software renewal, ever. Hosting runs on the café's own free-tier accounts; a small fee may apply as you grow."
  Never write "lifetime free" or "free forever". WhatsApp stays `+91 XXXXX XXXXX` until the real number is set in `deck-content.json`.

## Social set (6 designs x 3 sizes = 18 PNG) — White & Blue

Square 1080x1080, portrait 1080x1350 and story 1080x1920 of every design, rendered at 2x. Each design REFLOWS from the
size (`?size=square|portrait|story`, read by `social/social.js`), nothing is scaled. In the story size, key content stays
out of the top ~150px and bottom ~190px (Instagram / WhatsApp status UI).

| File (`social/`) | Design | Screenshot slots (`shots/`) |
|---|---|---|
| `s1-overview.html` | "Run your whole café from one screen." + 6 feature chips | `dashboard.png` |
| `s2-pricing.html` | ₹25,000 one-time, what is included, claims footnote | none |
| `s3-qr.html` | Scan, order, kitchen; the diner phone | `qr-menu.png` (390x844 phone) |
| `s4-kitchen.html` | Kitchen board, order card, "Updates instantly" | `kitchen.png` |
| `s5-udhaar-reports.html` | Dues per customer + end-of-day reports | `customers.png`, `reports.png` |
| `s6-hook.html` | "Every year your billing software sends you a bill. Ours doesn’t." | none |

```bash
bash marketing/tools/render-social.sh                    # all 18 -> out/social/<design>-<square|portrait|story>.png
bash marketing/tools/render-social.sh s2-pricing s6-hook # just those designs (x 3 sizes)
```

- Copy: each HTML has a `<script type="application/json" id="poster-data">` block (brand, headline, lines, features,
  pricing, footnote, cta, whatsapp, site). Edit it and re-render. `social.css` holds the brand tokens (blue `#2563eb`,
  ink `#0f172a`, 12px cards, Fraunces headlines, Schibsted Grotesk body); `social.js` builds the header and footer.
- Screenshots: `<img data-shot="name">` loads `marketing/shots/<name>.png`. A missing file shows a soft `#e8f0fe` card with a
  small "screenshot" label, so renders never break. Frames crop to fill (top-left anchored): shoot desktop screens at about
  16:10 (s5 square shows each at about 4:5, so keep the important part at the top left), `qr-menu` at 390x844.
- Claims: only the pricing and hook designs carry a price and the footnote "*No software renewal, ever. Hosting runs on the
  café's own free-tier accounts; a small fee may apply as you grow." Never write "lifetime free" or "free forever".
  WhatsApp stays `+91 XXXXX XXXXX` until the real number is set.
- `tools/render-poster.cjs` also accepts `<file.html?query>` (the query string reaches `location.search`); a bare path
  renders exactly as before.

## Recording the live app

Films the real, deployed demo cafe (read-only pages unless a script clicks something) into a branded MP4 — local only,
nothing is uploaded.

```bash
# first time: (cd marketing/tools && npm install)
bash marketing/tools/record-app.sh <script> <16x9|9x16> [slug=demo] [fps=12]
bash marketing/tools/record-app.sh smoke-login 16x9      # -> marketing/out/video/smoke-login-16x9.mp4
bash marketing/tools/record-app.sh smoke-login 9x16      # -> marketing/out/video/smoke-login-9x16.mp4
```

- `script` = `marketing/video/scripts/<script>.json`; `slug` = `clients/<slug>.json` (admin login + `generated.host`
  are read in-process, never printed, never in argv; the session lives in an in-memory Electron partition).
- Output is 1920x1080 (16x9, app window 1920x1080) or 1080x1920 (9x16, app window 1080x1620 — staff screens).
  Override per script with `"viewport": { "16x9": [w, h], "9x16": [w, h] }`; pair a phone-sized viewport with a
  `zoom` step for the diner QR flow. Stills (every 60th output frame) land in `marketing/out/video/stills/`.
- Frames: 1.5 s title card (script `title`) -> the app (brand mark top-left, caption bar bottom) -> 1.5 s end card
  ("Book a free demo · pos.sandbee.in"). Encoded with WebCodecs H.264 + mp4-muxer, like the demo reel.
- The login is a silent pre-roll (not filmed); the script starts on `"start"` (default `/`). Set `"login": false`
  for public pages (e.g. the QR menu). While a `goto` loads, the video holds the last good frame (no blank flashes).

Script shape — `{ "title": "...", "start": "/", "steps": [ { "op": "...", ... } ] }`:

| op | fields |
|---|---|
| `goto` | `path` (starts with `/`), `settleMs` |
| `wait` / `hold` | `ms` |
| `waitFor` | `selector` or `text`, `timeoutMs` |
| `click` / `hover` | `selector` or `text` (visible text; real mouse events + a blue cursor ring) |
| `type` | `selector`, `text`, `delayMs` (per character), `clear` |
| `scroll` | `by` (px), `ms`, optional `selector` (default: the largest scrollable pane) |
| `caption` | `text` (shown from here on; empty string clears) |
| `zoom` | `factor` (page zoom, e.g. 1.2) |
| `window` | `name` (second window, same login — e.g. `kitchen` next to the POS) |

- `click` / `waitFor` / `hover` / `type` accept `"optional": true` (+ `"timeoutMs"`, default 2500 when optional): a missing target logs
  `skip: ...` to stdout and the take continues instead of failing (for state-dependent UI such as a dialog that may not open).
- `text` targets also take `"exact": true` (no partial-text fallback, e.g. a dialog's "New" must not hit the sidebar's "New Order").
- Printing: every recorder window preloads `tools/record-app-preload.cjs`, a no-op `window.posDesktop` print bridge, so the app
  prints KOT/bills silently (no system print dialog) while filming.
- Scrollbars: every recorder window hides the classic Windows scrollbars on load (a touch device shows none), so grids and
  category bars film clean.
- The four product clips are `pos-billing`, `qr-self-order`, `kitchen-realtime`, `dues-and-reports` (record each in `16x9` and
  `9x16`). `setup-kitchen-card` and `settle-a4` are helpers, not clips: run the first, then `shoot.sh demo kitchen` so the
  kitchen screenshot has a live card, then the second to settle that A-4 tab (delete their MP4s afterwards).

Limits: the capture is `capturePage()` on a steady 12 fps clock; this PC reaches about 5–10 fresh frames per second
(capture ~60 ms + compose/encode), and a late frame is covered by repeating the previous one so timing never drifts.
Files: `tools/record-app.cjs` (+ `-steps.cjs`, `-compose.cjs`), `tools/compose.html` + `compose-draw.js` (branding,
captions, cards, encoder), `video/scripts/*.json`.
## Screenshots from the live app

Photographs the real, deployed demo cafe into `marketing/shots/<name>.png` (the files the social posters and the deck
read) — local only, nothing is uploaded, and it never commits an order, saves a setting or deletes anything.

```bash
bash marketing/tools/shoot.sh                      # all shots, slug=demo
bash marketing/tools/shoot.sh demo pos,qr-cart     # just those
```

- Driven by `marketing/shots/shots.json`: `{ "shots": [ { "name", "path", "viewport": [w, h] (CSS px, default 1440x900),
  "zoom"?, "steps"?, "settleMs"?, "crop"? ([x, y, w, h] in CSS px — `kitchen-board` is the kitchen page without its sidebar) } ] }`. One login (credentials read in-process from `clients/<slug>.json`, never
  printed), then one offscreen window per shot at device scale factor 2 (so a 1440x900 shot is a 2880x1800 PNG).
  `steps` are the recorder's ops (`click`, `waitFor`, `scroll`, ...; see above) — the blue cursor ring and the
  scrollbars are removed before the capture.
- Read-only guard: a `click` whose text/selector looks like Send to Kitchen / Send order / Pay / Save / Delete / Void /
  Print / Confirm is refused. The `pos` and `qr-cart` shots only fill the cart (items in the cart are never sent; closing
  the window discards them). Table B2 must be Available for the `pos` shot (an occupied table would resume its tab).
- `qr-menu` / `qr-cart` open table B2's public page `/m/<token>` (token from `GET /api/tables`; if the demo is re-seeded,
  update the token in `shots.json`). Phone shots are 390x844 with the default Electron user agent.
- Failures are printed per shot (the rest still run) and the exit code is non-zero if any failed; 10-minute cap.

