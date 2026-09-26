// The steam rising from the sign-in painting's bowl, as a PURE function of
// time: three curling wisps of dots. No DOM, no canvas, no state carried
// between frames — components/brand/PointillistScene.tsx asks "where is every
// puff at time t" and draws the answer; lib/brand-steam.test.ts pins it.
//
// Stateless on purpose. Each puff loops on its own period, so its position is
// derived from t alone: a tab that sat in the background for an hour (rAF
// paused) wakes to steam that is just as evenly spread as ever. The earlier
// frame-by-frame version re-spawned every expired puff at the SAME instant on
// wake, and they rose together as one visible band.

import { seededRandom } from "@/lib/brand-art";

/** Wisps across the bowl, and where each leaves it (scene units from the
 *  steam origin, across). */
const WISP_BASE_X: readonly number[] = [-11, 0, 11];
const PUFFS_PER_WISP = 90;
/** Seconds one puff takes to rise its full height, and the spread of that. */
const LIFE_MIN_S = 3.6;
const LIFE_SPREAD_S = 1.8;
/** How high the steam climbs, in scene units. */
export const STEAM_HEIGHT = 128;
/** The curl: sideways swing at the top (scene units), its wavelength up the
 *  wisp (radians per scene unit), and how fast the wave travels (rad/s). */
const CURL = 15;
const CURL_WAVE = 0.05;
const CURL_DRIFT = 0.8;
/** Phase step between wisps, so they never swing in step. */
const WISP_PHASE = 2.1;
/** Each puff's own offset from its wisp's line, widening as it rises. */
const JITTER = 3.2;
const WIDEN = 2.6;
/** Peak opacity of ONE puff. Low on purpose: the plume reads soft because
 *  many translucent puffs overlap — a few opaque ones read as beads. */
const STEAM_ALPHA = 0.4;
/** Share of a puff's life spent fading in as it leaves the soup. */
const FADE_IN = 0.22;
const STEAM_SEED = 7;
/** How sharply a puff slows as it rises (1 = never slows). */
const EASE = 1.6;
/** Puff radius (scene units) as it leaves the soup, and how much it grows by the top. */
const R_MIN = 1.5;
const R_SPREAD = 1.1;
const R_GROW = 1.4;

export interface SteamSeed {
  wisp: number;
  life: number;
  /** Where in its loop the puff is at t = 0, 0..1. */
  offset: number;
  jitter: number;
  r: number;
}

/** The fixed per-puff constants. Offsets are stratified, so at ANY t the
 *  puffs are spread up the whole height of each wisp. */
export function steamSeeds(): SteamSeed[] {
  const rand = seededRandom(STEAM_SEED);
  const seeds: SteamSeed[] = [];
  for (let wisp = 0; wisp < WISP_BASE_X.length; wisp++) {
    for (let i = 0; i < PUFFS_PER_WISP; i++) {
      seeds.push({
        wisp,
        life: LIFE_MIN_S + rand() * LIFE_SPREAD_S,
        offset: (i + rand()) / PUFFS_PER_WISP,
        jitter: (rand() - 0.5) * 2 * JITTER,
        r: R_MIN + rand() * R_SPREAD,
      });
    }
  }
  return seeds;
}

export interface SteamPuff {
  /** Scene units from the steam origin: dx across, rise UP (positive). */
  dx: number;
  rise: number;
  r: number;
  alpha: number;
}

/** Every puff's position at time t (seconds). */
export function steamAt(t: number, seeds: readonly SteamSeed[]): SteamPuff[] {
  return seeds.map((s) => {
    const k = (((t / s.life + s.offset) % 1) + 1) % 1; // 0 → 1 up its life
    // Fast off the soup, slowing as it cools — steam decelerates as it rises.
    const rise = STEAM_HEIGHT * (1 - Math.pow(1 - k, EASE));
    const curl = CURL * k * Math.sin(rise * CURL_WAVE - t * CURL_DRIFT + s.wisp * WISP_PHASE);
    const alpha = Math.min(1, k / FADE_IN) * Math.pow(1 - k, 1.4) * STEAM_ALPHA;
    return {
      dx: WISP_BASE_X[s.wisp] + curl + s.jitter * (1 + k * WIDEN),
      rise,
      r: s.r * (1 + k * R_GROW),
      alpha,
    };
  });
}
