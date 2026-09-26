// The sign-in card's artwork: lib/brand-scene.ts's painting, turned into
// pointillist dots — computed, not shipped as an image. PURE: no DOM, no
// canvas. components/brand/PointillistScene.tsx paints the result;
// lib/brand-art.test.ts pins the rules.
//
// Why computed: it is original (no borrowed illustration, no licence), it
// weighs nothing on the wire, it renders crisply at any size and pixel ratio,
// and it can follow the time of day — the palette changes with the greeting.
// Deterministic (seeded) so the painting is the same on every load.

import { LAYER_COUNT, SCENE_H, SCENE_W, mix, sceneAt, type Layer, type Rgb, type ScenePalette } from "@/lib/brand-scene";

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
/** A second, independent stream for the reveal timing, so how the painting
 *  paints in never changes what it paints. */
const REVEAL_SALT = 0x5eed;

/** The scene point kept in view, and where in the box it is placed. */
const FOCUS_V = 0.79;
const FOCUS_AT = 0.58;

/** How a box of cw×ch shows the scene: scaled to COVER it, and positioned so
 *  the bowl stays in view even in a short, wide strip (the phone banner). */
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

/** Map a scene point into box coordinates (for the steam). */
export function sceneToBox(x: number, y: number, cw: number, ch: number): { x: number; y: number } {
  const { scale, offsetX, offsetY } = fitScene(cw, ch);
  return { x: x * scale + offsetX, y: y * scale + offsetY };
}

// How the painting paints itself in on load: back to front, the way a painter
// works — sky first, the bowl last. Each layer starts REVEAL_STEP after the
// one behind it and its dots land at random across REVEAL_SPAN; the two are
// sized so the last layer ends at exactly 1.
const REVEAL_STEP = 0.12;
const REVEAL_SPAN = 1 - (LAYER_COUNT - 1) * REVEAL_STEP;
/** A layer's flat base colour (paintBlocks) fills in once most of its dots
 *  have landed, so the gaps first show paper, then the scene. */
const BLOCK_AT = 0.7;

/** When (0 = start, 1 = done) a dot of this layer lands, given u in [0, 1). */
export function revealAt(layer: Layer, u: number): number {
  return layer * REVEAL_STEP + u * REVEAL_SPAN;
}

export interface ArtDot {
  x: number;
  y: number;
  r: number;
  color: Rgb;
  /** When it lands in the load-time reveal, 0..1. */
  at: number;
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
  const revealRand = seededRandom(seed ^ REVEAL_SALT);
  const { scale, offsetX, offsetY } = fitScene(cw, ch);
  const dots: ArtDot[] = [];
  for (let gy = 0; gy < ch + DOT_SPACING; gy += DOT_SPACING) {
    for (let gx = 0; gx < cw + DOT_SPACING; gx += DOT_SPACING) {
      const x = gx + (rand() - 0.5) * DOT_SPACING * 0.8;
      const y = gy + (rand() - 0.5) * DOT_SPACING * 0.8;
      const { color: base, layer } = sceneAt((x - offsetX) / scale, (y - offsetY) / scale, p);
      const shade = (rand() - 0.5) * SHADE_RANGE;
      let color = shade > 0 ? mix(base, [255, 255, 255], shade) : mix(base, [0, 0, 0], -shade);
      if (rand() < GLINT_SHARE) color = mix(color, p.sun, GLINT_MIX);
      dots.push({
        x,
        y,
        r: DOT_SPACING * 0.56 * (0.8 + rand() * 0.4),
        color: [Math.round(color[0]), Math.round(color[1]), Math.round(color[2])],
        at: revealAt(layer, revealRand()),
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
  /** When it fills in during the reveal, 0..1. */
  at: number;
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
      const { color, layer } = sceneAt(cx, cy, p);
      blocks.push({ x, y, size: DOT_SPACING, color, at: revealAt(layer, BLOCK_AT) });
    }
  }
  return blocks;
}
