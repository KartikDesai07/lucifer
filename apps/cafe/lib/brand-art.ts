// The sign-in card's artwork: a pointillist painting — hills, a sun, and a
// steaming bowl on a table in the foreground (the one scene every food
// business shares) — computed, not shipped as an image. PURE: no DOM, no
// canvas. The scene is a function from a point to a colour; the dots are a
// seeded jittered grid sampled from it. components/brand/PointillistScene.tsx
// paints the result onto a canvas; lib/brand-art.test.ts pins the rules.
//
// Why computed: it is original (no borrowed illustration, no licence), it
// weighs nothing on the wire, it renders crisply at any size and pixel ratio,
// and it can follow the time of day — the palette changes with the greeting.
// Deterministic (seeded) so the painting is the same on every load.

import type { DayPart } from "@/lib/brand-time";

export type Rgb = readonly [number, number, number];

export interface ScenePalette {
  skyTop: Rgb;
  skyBottom: Rgb;
  sun: Rgb;
  hillFar: Rgb;
  hillMid: Rgb;
  hillNear: Rgb;
  table: Rgb;
  tableEdge: Rgb;
  bowl: Rgb;
  bowlRim: Rgb;
  soup: Rgb;
  steam: Rgb;
  /** Normalised height of the sun's centre (0 = top). Low at the ends of the day. */
  sunV: number;
}

const hex = (h: string): Rgb => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

// Art-only colours: none of these is a UI or status colour, and nothing is
// ever read against them — the painting carries no text.
export const SCENE_PALETTES: Readonly<Record<DayPart, ScenePalette>> = {
  morning: {
    skyTop: hex("#f3cfa9"),
    skyBottom: hex("#fbeedb"),
    sun: hex("#f2a541"),
    hillFar: hex("#bccb9e"),
    hillMid: hex("#93ab78"),
    hillNear: hex("#607f53"),
    table: hex("#b5643c"),
    tableEdge: hex("#cf8458"),
    bowl: hex("#f4eee4"),
    bowlRim: hex("#fffaf1"),
    soup: hex("#d98e4a"),
    steam: hex("#fffaf1"),
    sunV: 0.4,
  },
  afternoon: {
    skyTop: hex("#b9d6e6"),
    skyBottom: hex("#f3efe2"),
    sun: hex("#f6c85a"),
    hillFar: hex("#aec790"),
    hillMid: hex("#82a468"),
    hillNear: hex("#577b49"),
    table: hex("#a95b36"),
    tableEdge: hex("#c77b51"),
    bowl: hex("#f4eee4"),
    bowlRim: hex("#fffaf1"),
    soup: hex("#d5873f"),
    steam: hex("#ffffff"),
    sunV: 0.2,
  },
  evening: {
    skyTop: hex("#5d4b79"),
    skyBottom: hex("#f0c294"),
    sun: hex("#e8633b"),
    hillFar: hex("#76845f"),
    hillMid: hex("#53684a"),
    hillNear: hex("#364b31"),
    table: hex("#8e4a2c"),
    tableEdge: hex("#ad6544"),
    bowl: hex("#efe6d8"),
    bowlRim: hex("#fbf4e8"),
    soup: hex("#c9763a"),
    steam: hex("#fbf1e2"),
    sunV: 0.48,
  },
};

/** The scene's own frame. Everything is laid out in these units, then fitted
 *  to whatever box it is painted into (see fitScene). Portrait, like the
 *  desktop art panel. */
export const SCENE_W = 300;
export const SCENE_H = 400;

/** Where the steam leaves the bowl, in scene units — the animation's origin. */
export const STEAM_ORIGIN = { x: 126, y: 294 } as const;

// Scene geometry, normalised to the frame (u across, v down).
const SUN_U = 0.64;
const SUN_R = 0.1; // of SCENE_W
const SUN_HALO = 1.9; // halo reaches this many radii
const TABLE_V = 0.8;
const TABLE_EDGE_V = 0.816;
const BOWL_U = 0.42;
const BOWL_RIM_V = 0.765;
const BOWL_RX = 0.2; // of SCENE_W
const BOWL_RY = 0.1; // of SCENE_H
const RIM_RY = 0.024; // of SCENE_H
const SHADOW_V = 0.872;
const SHADOW_RY = 0.028;
const SHADOW_SHIFT_U = 0.03;

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** A layered hill line: the ground starts below this v at a given u. */
function hillLine(u: number, base: number, amp: number, freq: number, phase: number): number {
  return base + amp * Math.sin(u * Math.PI * 2 * freq + phase);
}

/** The painting's colour at a point in scene units. Layers are drawn back to
 *  front: sky, sun, three hills, table, bowl. */
export function sceneColorAt(x: number, y: number, p: ScenePalette): Rgb {
  const u = x / SCENE_W;
  const v = y / SCENE_H;

  // Sky: a vertical gradient, then the sun and its soft halo on top.
  let c = mix(p.skyTop, p.skyBottom, v / 0.7);
  const sunDist = Math.hypot(x - SUN_U * SCENE_W, y - p.sunV * SCENE_H) / (SUN_R * SCENE_W);
  if (sunDist <= 1) c = p.sun;
  else if (sunDist < SUN_HALO) c = mix(p.sun, c, (sunDist - 1) / (SUN_HALO - 1) + 0.35);

  if (v > hillLine(u, 0.54, 0.035, 1.1, 0.6)) c = p.hillFar;
  if (v > hillLine(u, 0.62, 0.045, 0.8, 2.1)) c = p.hillMid;
  if (v > hillLine(u, 0.7, 0.03, 1.6, 4.0)) c = p.hillNear;

  if (v > TABLE_V) c = v < TABLE_EDGE_V ? p.tableEdge : p.table;

  // A soft shadow under the bowl, so it sits ON the table instead of floating.
  const sx = (u - BOWL_U - SHADOW_SHIFT_U) / (BOWL_RX * 1.15);
  const sy = (v - SHADOW_V) / SHADOW_RY;
  if (v > TABLE_V && sx * sx + sy * sy <= 1) c = mix(c, [0, 0, 0], 0.28);

  // The bowl: a half-ellipse body hanging below its rim line, a thin rim
  // ellipse across the top, soup showing inside the rim.
  const bx = (u - BOWL_U) / BOWL_RX;
  const body = (v - BOWL_RIM_V) / (BOWL_RY);
  if (v >= BOWL_RIM_V && bx * bx + body * body <= 1) c = p.bowl;
  const rim = (v - BOWL_RIM_V) / RIM_RY;
  const rimD = bx * bx + rim * rim;
  if (rimD <= 1) c = rimD <= 0.62 ? p.soup : p.bowlRim;

  return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
}

/** Small, fast, seeded PRNG (mulberry32) — the same painting on every load. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ART_SEED = 20260926;

/** How a box of cw×ch shows the scene: scaled to COVER it, and positioned so
 *  the bowl stays in view even in a short, wide strip (the phone banner). */
/** The scene point kept in view, and where in the box it is placed. */
const FOCUS_V = 0.79;
const FOCUS_AT = 0.58;

export function fitScene(cw: number, ch: number): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.max(cw / SCENE_W, ch / SCENE_H);
  const offsetX = (cw - SCENE_W * scale) / 2;
  // Anchor the scene's focus — the bowl — at 58% of the box height, clamped so
  // the scene never leaves a gap at either edge. In the tall panel the clamp
  // wins and the whole scene shows; in the phone strip the bowl stays whole.
  const focusY = FOCUS_V * SCENE_H * scale;
  const wanted = ch * FOCUS_AT - focusY;
  const offsetY = Math.min(0, Math.max(ch - SCENE_H * scale, wanted));
  return { scale, offsetX, offsetY };
}

export interface ArtDot {
  x: number;
  y: number;
  r: number;
  color: Rgb;
}

/** Dot spacing in CSS px — small enough to read as a painting, large enough
 *  to read as dots. */
export const DOT_SPACING = 3.6;
/** Share of dots that catch the sun's colour — the warm glints a pointillist
 *  scatters through a field so it glows instead of sitting flat. */
const GLINT_SHARE = 0.08;
const GLINT_MIX = 0.35;
const SHADE_RANGE = 0.24; // ±12% towards white or black

/**
 * The painting as dots for a box of cw×ch CSS px: a jittered grid, each dot
 * coloured from the scene with a little lightness variation, the way a
 * pointillist builds a colour from many near-neighbours.
 */
export function paintDots(cw: number, ch: number, p: ScenePalette, seed: number = ART_SEED): ArtDot[] {
  const rand = seededRandom(seed);
  const { scale, offsetX, offsetY } = fitScene(cw, ch);
  const dots: ArtDot[] = [];
  for (let gy = 0; gy < ch + DOT_SPACING; gy += DOT_SPACING) {
    for (let gx = 0; gx < cw + DOT_SPACING; gx += DOT_SPACING) {
      const x = gx + (rand() - 0.5) * DOT_SPACING * 0.8;
      const y = gy + (rand() - 0.5) * DOT_SPACING * 0.8;
      const base = sceneColorAt((x - offsetX) / scale, (y - offsetY) / scale, p);
      const shade = (rand() - 0.5) * SHADE_RANGE;
      let color = shade > 0 ? mix(base, [255, 255, 255], shade) : mix(base, [0, 0, 0], -shade);
      if (rand() < GLINT_SHARE) color = mix(color, p.sun, GLINT_MIX);
      dots.push({
        x,
        y,
        r: DOT_SPACING * 0.56 * (0.8 + rand() * 0.4),
        color: [Math.round(color[0]), Math.round(color[1]), Math.round(color[2])],
      });
    }
  }
  return dots;
}

export interface ArtBlock {
  x: number;
  y: number;
  size: number;
  color: Rgb;
}

/** The scene as flat blocks one dot-spacing square — painted UNDER the dots,
 *  so the gaps between them show each region's own colour instead of one
 *  wash across the whole picture. */
export function paintBlocks(cw: number, ch: number, p: ScenePalette): ArtBlock[] {
  const { scale, offsetX, offsetY } = fitScene(cw, ch);
  const blocks: ArtBlock[] = [];
  for (let y = 0; y < ch; y += DOT_SPACING) {
    for (let x = 0; x < cw; x += DOT_SPACING) {
      const cx = (x + DOT_SPACING / 2 - offsetX) / scale;
      const cy = (y + DOT_SPACING / 2 - offsetY) / scale;
      blocks.push({ x, y, size: DOT_SPACING, color: sceneColorAt(cx, cy, p) });
    }
  }
  return blocks;
}

/** Map a scene point into box coordinates (for the steam's origin). */
export function sceneToBox(x: number, y: number, cw: number, ch: number): { x: number; y: number } {
  const { scale, offsetX, offsetY } = fitScene(cw, ch);
  return { x: x * scale + offsetX, y: y * scale + offsetY };
}
