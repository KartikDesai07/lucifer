"use client";

import { useEffect, useRef } from "react";

import type { DayPart } from "@/lib/brand-time";
import { SCENE_PALETTES, STEAM_ORIGIN, type Rgb } from "@/lib/brand-scene";
import { fitScene, paintBlocks, paintDots, sceneToBox, type ArtBlock, type ArtDot } from "@/lib/brand-art";
import { steamAt, steamSeeds } from "@/lib/brand-steam";

// Paints lib/brand-art's pointillist scene into its box, and animates steam
// rising from the bowl. Two stacked canvases: the painting, and a small steam
// layer that redraws per frame.
//
// On load the painting PAINTS ITSELF IN, back to front — sky, sun, hills,
// table, bowl — dots landing on bare paper, each layer's own colour filling
// the gaps behind them (destination-over, so a late base never covers a
// dot); the steam then fades in over the soup. A resize repaints at once,
// never replays the reveal.
//
// Decoration only (aria-hidden). With "reduce motion" on, the finished
// painting and a still wisp are drawn once and no animation loop runs. Until
// the day part is known (first render, see useNow) the box shows the paper
// colour — nothing time-dependent is ever rendered on the server.

/** Canvas resolution is capped at 2x: sharper than that is invisible on a
 *  dot this size and only costs memory on a 3x phone. */
const MAX_PIXEL_RATIO = 2;
const REVEAL_MS = 1400;
/** The steam fades in once the bowl is painted, over this long. */
const STEAM_FADE_MS = 700;
/** Steam redraws at ~30fps: smooth for slow steam, half the work of 60. */
const STEAM_FRAME_MS = 33;

function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
}

const easeOut = (x: number) => 1 - (1 - x) * (1 - x);

export function PointillistScene({ dayPart, className }: { dayPart: DayPart | null; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLCanvasElement>(null);
  const steamRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const art = artRef.current;
    const steam = steamRef.current;
    if (!box || !art || !steam || !dayPart) return;
    const artCtx = art.getContext("2d");
    const steamCtx = steam.getContext("2d");
    if (!artCtx || !steamCtx) return; // no canvas: the paper colour shows

    const palette = SCENE_PALETTES[dayPart];
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seeds = steamSeeds();
    let w = 0;
    let h = 0;
    let raf = 0;
    let lastSteam = 0;
    // The reveal: dots and blocks sorted by when they land, and how many of
    // each are down. revealFrom < 0 once it has finished.
    let dots: ArtDot[] = [];
    let blocks: ArtBlock[] = [];
    let dotsDown = 0;
    let blocksDown = 0;
    let revealFrom = -1;
    let steamFrom = 0;

    const paintUpTo = (progress: number) => {
      artCtx.globalCompositeOperation = "source-over";
      for (; dotsDown < dots.length && dots[dotsDown].at <= progress; dotsDown++) {
        const d = dots[dotsDown];
        artCtx.fillStyle = rgba(d.color, 1);
        artCtx.beginPath();
        artCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        artCtx.fill();
      }
      // Behind whatever is already down: the gaps between dots take the
      // region's own colour, and no dot is ever painted over.
      artCtx.globalCompositeOperation = "destination-over";
      for (; blocksDown < blocks.length && blocks[blocksDown].at <= progress; blocksDown++) {
        const b = blocks[blocksDown];
        artCtx.fillStyle = rgba(b.color, 1);
        artCtx.fillRect(b.x, b.y, b.size + 0.5, b.size + 0.5);
      }
      artCtx.globalCompositeOperation = "source-over";
      // Once everything is down the lists are dead weight (tens of thousands
      // of dots) — the canvas holds the painting from here.
      if (dotsDown === dots.length && blocksDown === blocks.length) {
        dots = [];
        blocks = [];
        dotsDown = 0;
        blocksDown = 0;
      }
    };

    const paintSteam = (ms: number) => {
      steamCtx.clearRect(0, 0, w, h);
      const gain = Math.min(1, Math.max(0, (ms - steamFrom) / STEAM_FADE_MS));
      if (gain <= 0) return;
      const { scale } = fitScene(w, h);
      for (const puff of steamAt(ms / 1000, seeds)) {
        const at = sceneToBox(STEAM_ORIGIN.x + puff.dx, STEAM_ORIGIN.y - puff.rise, w, h);
        steamCtx.fillStyle = rgba(palette.steam, puff.alpha * gain);
        steamCtx.beginPath();
        steamCtx.arc(at.x, at.y, puff.r * scale, 0, Math.PI * 2);
        steamCtx.fill();
      }
    };

    const layout = (reveal: boolean) => {
      const rect = box.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
      for (const [canvas, ctx] of [
        [art, artCtx],
        [steam, steamCtx],
      ] as const) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(h * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      dots = paintDots(w, h, palette).sort((a, b) => a.at - b.at);
      blocks = paintBlocks(w, h, palette).sort((a, b) => a.at - b.at);
      dotsDown = 0;
      blocksDown = 0;
      artCtx.clearRect(0, 0, w, h);
      const now = performance.now();
      if (reveal) {
        revealFrom = now;
        steamFrom = now + REVEAL_MS * 0.85;
      } else {
        revealFrom = -1;
        paintUpTo(1);
        steamFrom = Math.min(steamFrom, now - STEAM_FADE_MS);
      }
      paintSteam(now);
    };

    const loop = (ms: number) => {
      raf = requestAnimationFrame(loop);
      if (revealFrom >= 0) {
        const x = Math.min(1, (ms - revealFrom) / REVEAL_MS);
        paintUpTo(easeOut(x));
        if (x >= 1) revealFrom = -1;
      }
      if (ms - lastSteam < STEAM_FRAME_MS) return;
      lastSteam = ms;
      paintSteam(ms);
    };

    layout(!reduceMotion);
    // ResizeObserver also fires once on observe with the size we just laid
    // out — only a REAL size change repaints (and never replays the reveal).
    const observer = new ResizeObserver(() => {
      const rect = box.getBoundingClientRect();
      if (Math.round(rect.width) !== w || Math.round(rect.height) !== h) layout(false);
    });
    observer.observe(box);
    // rAF already pauses in a background tab, so a counter left on this screen
    // costs nothing while another app is in front — and the steam is a pure
    // function of time (lib/brand-steam.ts), so it wakes up evenly spread.
    if (!reduceMotion) raf = requestAnimationFrame(loop);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [dayPart]);

  return (
    <div ref={boxRef} aria-hidden="true" className={className}>
      <canvas ref={artRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={steamRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
