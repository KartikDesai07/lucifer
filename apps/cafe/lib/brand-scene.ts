// The sign-in painting's SCENE: what colour every point is, and which layer
// of the picture it belongs to. Hills, a sun, and a steaming bowl on a table
// in the foreground — the one scene every food business shares. PURE: no
// DOM, no canvas. lib/brand-art.ts turns it into dots; lib/brand-art.test.ts
// pins the rules.

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
  herb: Rgb;
  steam: Rgb;
  /** The postmark's ink — dark on a light sky, light on a dusk one. */
  postmark: Rgb;
  /** Normalised height of the sun's centre (0 = top). Low at the ends of the day. */
  sunV: number;
}

const hex = (h: string): Rgb => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

// Art-only colours: none of these is a UI or status colour. The only thing
// ever read against them is the decorative postmark, whose ink is chosen per
// sky so it shows.
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
    herb: hex("#4f7a3a"),
    steam: hex("#fffaf1"),
    postmark: hex("#5a3a28"),
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
    herb: hex("#46703a"),
    steam: hex("#ffffff"),
    postmark: hex("#27405a"),
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
    herb: hex("#5f8a45"),
    steam: hex("#fbf1e2"),
    postmark: hex("#f6e7d6"),
    sunV: 0.48,
  },
};

/** The scene's own frame. Everything is laid out in these units, then fitted
 *  to whatever box it is painted into (lib/brand-art.ts fitScene). Portrait,
 *  like the desktop art panel. */
export const SCENE_W = 300;
export const SCENE_H = 400;

/** Where the steam leaves the bowl, in scene units — the animation's origin. */
export const STEAM_ORIGIN = { x: 126, y: 294 } as const;

/** The picture's layers, back to front — also the order it paints itself in
 *  on load (lib/brand-art.ts revealAt). */
export const LAYER = { sky: 0, sun: 1, hillFar: 2, hillMid: 3, hillNear: 4, table: 5, bowl: 6 } as const;
export type Layer = (typeof LAYER)[keyof typeof LAYER];
export const LAYER_COUNT = 7;

// Scene geometry, normalised to the frame (u across, v down).
const SUN_U = 0.64;
const SUN_R = 0.1; // of SCENE_W
const SUN_HALO = 1.9; // halo reaches this many radii
const TABLE_V = 0.8;
const TABLE_EDGE_V = 0.816;
export const BOWL_U = 0.42;
export const BOWL_RIM_V = 0.765;
const BOWL_RX = 0.2; // of SCENE_W
const BOWL_RY = 0.1; // of SCENE_H
export const BOWL_BASE_V = BOWL_RIM_V + BOWL_RY;
const RIM_RY = 0.024; // of SCENE_H
const SOUP_INSIDE = 0.62; // of the rim ellipse
const SHADOW_V = 0.872;
const SHADOW_RY = 0.028;
const SHADOW_SHIFT_U = 0.03;
/** The sun sits up and to the right, so the bowl darkens towards its lower
 *  left — shaded with the table's own colour, the warm bounce light a
 *  painter would use, never grey. */
const BOWL_SHADE_MAX = 0.42;
/** Wood grain: thin streaks of the table's edge colour across its top. */
const GRAIN_FREQ = 0.55; // per scene unit, down the table
const GRAIN_WOBBLE = 3;
const GRAIN_CUT = 0.86;
const GRAIN_MIX = 0.3;
/** A few herb leaves floating on the soup, in scene units from the bowl's
 *  centre on the rim line. */
const HERBS: ReadonlyArray<readonly [number, number]> = [
  [-16, -1.5],
  [-3, 2.5],
  [11, -0.5],
  [20, 2],
];
const HERB_R = 3.4;

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** A layered hill line: the ground starts below this v at a given u. */
function hillLine(u: number, base: number, amp: number, freq: number, phase: number): number {
  return base + amp * Math.sin(u * Math.PI * 2 * freq + phase);
}

export interface ScenePoint {
  color: Rgb;
  layer: Layer;
}

/** The painting at a point in scene units: its colour and its layer. Layers
 *  are drawn back to front: sky, sun, three hills, table, bowl. */
export function sceneAt(x: number, y: number, p: ScenePalette): ScenePoint {
  const u = x / SCENE_W;
  const v = y / SCENE_H;
  let layer: Layer = LAYER.sky;

  // Sky: a vertical gradient, then the sun and its soft halo on top.
  let c = mix(p.skyTop, p.skyBottom, v / 0.7);
  const sunDist = Math.hypot(x - SUN_U * SCENE_W, y - p.sunV * SCENE_H) / (SUN_R * SCENE_W);
  if (sunDist <= 1) {
    c = p.sun;
    layer = LAYER.sun;
  } else if (sunDist < SUN_HALO) c = mix(p.sun, c, (sunDist - 1) / (SUN_HALO - 1) + 0.35);

  if (v > hillLine(u, 0.54, 0.035, 1.1, 0.6)) [c, layer] = [p.hillFar, LAYER.hillFar];
  if (v > hillLine(u, 0.62, 0.045, 0.8, 2.1)) [c, layer] = [p.hillMid, LAYER.hillMid];
  if (v > hillLine(u, 0.7, 0.03, 1.6, 4.0)) [c, layer] = [p.hillNear, LAYER.hillNear];

  if (v > TABLE_V) {
    layer = LAYER.table;
    if (v < TABLE_EDGE_V) c = p.tableEdge;
    else {
      const grain = Math.sin(y * GRAIN_FREQ + Math.sin(x * 0.03) * GRAIN_WOBBLE);
      c = grain > GRAIN_CUT ? mix(p.table, p.tableEdge, GRAIN_MIX) : p.table;
    }
    // A soft shadow under the bowl, so it sits ON the table instead of floating.
    const sx = (u - BOWL_U - SHADOW_SHIFT_U) / (BOWL_RX * 1.15);
    const sy = (v - SHADOW_V) / SHADOW_RY;
    if (sx * sx + sy * sy <= 1) c = mix(c, [0, 0, 0], 0.28);
  }

  // The bowl: a half-ellipse body hanging below its rim line, a thin rim
  // ellipse across the top, soup (with a few herbs) showing inside the rim.
  const bx = (u - BOWL_U) / BOWL_RX;
  const body = (v - BOWL_RIM_V) / BOWL_RY;
  if (v >= BOWL_RIM_V && bx * bx + body * body <= 1) {
    layer = LAYER.bowl;
    c = mix(p.bowl, p.table, clamp01(-bx * 0.55 + body * 0.8 - 0.15) * BOWL_SHADE_MAX);
  }
  const rim = (v - BOWL_RIM_V) / RIM_RY;
  const rimD = bx * bx + rim * rim;
  if (rimD <= 1) {
    layer = LAYER.bowl;
    c = rimD <= SOUP_INSIDE ? p.soup : p.bowlRim;
    if (rimD <= SOUP_INSIDE) {
      const cx = BOWL_U * SCENE_W;
      const cy = BOWL_RIM_V * SCENE_H;
      for (const [hx, hy] of HERBS) {
        if (Math.hypot(x - cx - hx, (y - cy - hy) * 1.8) <= HERB_R) c = p.herb;
      }
    }
  }

  return { color: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])], layer };
}

/** The painting's colour at a point in scene units. */
export function sceneColorAt(x: number, y: number, p: ScenePalette): Rgb {
  return sceneAt(x, y, p).color;
}
