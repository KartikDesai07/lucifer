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
