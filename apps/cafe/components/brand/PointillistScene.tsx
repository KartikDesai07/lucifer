"use client";

import { useEffect, useRef } from "react";

import type { DayPart } from "@/lib/brand-time";
import {
  SCENE_H,
  SCENE_PALETTES,
  STEAM_ORIGIN,
  fitScene,
  paintBlocks,
  paintDots,
  sceneToBox,
  seededRandom,
  type Rgb,
} from "@/lib/brand-art";

// Paints lib/brand-art's pointillist scene into its box, and animates steam
// rising from the bowl. Two stacked canvases: the painting is drawn once per
// size/day-part change; only the small steam layer redraws per frame.
//
// Decoration only (aria-hidden). With "reduce motion" on, the steam is drawn
// once as a still wisp and no animation loop runs. Until the day part is
// known (first render, see useNow) the box shows the paper colour — nothing
// time-dependent is ever rendered on the server.

/** Canvas resolution is capped at 2x: sharper than that is invisible on a
 *  dot this size and only costs memory on a 3x phone. */
const MAX_PIXEL_RATIO = 2;
const STEAM_PARTICLES = 140;
/** Seconds a steam dot lives, rising and fading. */
const STEAM_LIFE_MIN_S = 3.2;
const STEAM_LIFE_SPREAD_S = 2.4;
/** Rise speed, in scene heights per second (so it scales with the box). */
const STEAM_RISE = 0.07;
/** Sideways spread of where steam leaves the bowl, and how far it sways,
 *  both in scene units (they scale with the box like the painting does). */
const STEAM_SPREAD = 60;
const STEAM_SWAY = 7;
/** Peak opacity of a steam dot — high enough to read against a dusk sky. */
const STEAM_ALPHA = 0.9;
/** Once per ~33ms: 30fps is smooth for slow steam and half the work of 60. */
const STEAM_FRAME_MS = 33;

interface SteamDot {
  born: number;
  life: number;
  dx: number;
  sway: number;
  phase: number;
  r: number;
}

function newSteamDot(now: number, rand: () => number, spreadStart = false): SteamDot {
  const life = STEAM_LIFE_MIN_S + rand() * STEAM_LIFE_SPREAD_S;
  return {
    // spreadStart: the first batch is scattered through its life so the wisp
    // is already rising on the first frame, not all born at once.
    born: spreadStart ? now - rand() * life : now,
    life,
    dx: (rand() - 0.5) * 0.5,
    sway: 0.5 + rand() * 0.9,
    phase: rand() * Math.PI * 2,
    r: 0.55 + rand() * 0.6,
  };
}

function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
}

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
    const rand = seededRandom(7);
    let w = 0;
    let h = 0;
    let ratio = 1;
    let raf = 0;
    let lastFrame = 0;
    const start = performance.now() / 1000;
    const dots: SteamDot[] = Array.from({ length: STEAM_PARTICLES }, () => newSteamDot(start, rand, true));

    const size = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const paintArt = () => {
      artCtx.clearRect(0, 0, w, h);
      // Flat per-region colour first, so the gaps between dots read as the
      // scene itself — never as one wash showing through everywhere.
      for (const b of paintBlocks(w, h, palette)) {
        artCtx.fillStyle = rgba(b.color, 1);
        artCtx.fillRect(b.x, b.y, b.size + 0.5, b.size + 0.5);
      }
      for (const d of paintDots(w, h, palette)) {
        artCtx.fillStyle = rgba(d.color, 1);
        artCtx.beginPath();
        artCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        artCtx.fill();
      }
    };

    const paintSteam = (t: number) => {
      steamCtx.clearRect(0, 0, w, h);
      const origin = sceneToBox(STEAM_ORIGIN.x, STEAM_ORIGIN.y, w, h);
      const { scale } = fitScene(w, h);
      const riseScale = STEAM_RISE * SCENE_H * scale; // scene heights → box px per second
      for (let i = 0; i < dots.length; i++) {
        let d = dots[i];
        let age = t - d.born;
        if (age > d.life) {
          d = dots[i] = newSteamDot(t, rand);
          age = 0;
        }
        const k = age / d.life; // 0 → 1 over its life
        const y = origin.y - age * riseScale;
        const x = origin.x + d.dx * STEAM_SPREAD * scale + Math.sin(age * d.sway + d.phase) * STEAM_SWAY * scale * k;
        // Fade in quickly, thin out as it rises.
        const alpha = Math.min(1, k * 5) * (1 - k * 0.9) * STEAM_ALPHA;
        steamCtx.fillStyle = rgba(palette.steam, alpha);
        steamCtx.beginPath();
        steamCtx.arc(x, y, d.r * scale * (1 + k * 0.5), 0, Math.PI * 2);
        steamCtx.fill();
      }
    };

    const loop = (ms: number) => {
      raf = requestAnimationFrame(loop);
      if (ms - lastFrame < STEAM_FRAME_MS) return;
      lastFrame = ms;
      paintSteam(ms / 1000);
    };

    const layout = () => {
      const rect = box.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
      size(art, artCtx);
      size(steam, steamCtx);
      paintArt();
      paintSteam(performance.now() / 1000);
    };

    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(box);
    // rAF already pauses in a background tab, so a counter left on this screen
    // costs nothing while another app is in front.
    if (!reduceMotion) raf = requestAnimationFrame(loop);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [dayPart]);

  return (
    <div ref={boxRef} aria-hidden="true" className={className}>
      <canvas ref={artRef} className="absolute inset-0 h-full w-full motion-safe:animate-brand-fade" />
      <canvas ref={steamRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
