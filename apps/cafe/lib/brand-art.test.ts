import { test } from "node:test";
import assert from "node:assert/strict";

import { fitScene, paintBlocks, paintDots, revealAt, sceneToBox, seededRandom } from "./brand-art";
import {
  BOWL_BASE_V,
  BOWL_RIM_V,
  BOWL_U,
  LAYER,
  LAYER_COUNT,
  SCENE_H,
  SCENE_PALETTES,
  SCENE_W,
  STEAM_ORIGIN,
  sceneAt,
  sceneColorAt,
  type Layer,
} from "./brand-scene";

const PARTS = ["morning", "afternoon", "evening"] as const;

test("every part of the day has a complete palette", () => {
  for (const part of PARTS) {
    const p = SCENE_PALETTES[part];
    assert.ok(p, `palette for ${part}`);
    for (const [key, value] of Object.entries(p)) {
      if (key === "sunV") continue;
      assert.equal((value as number[]).length, 3, `${part}.${key} is an RGB triple`);
    }
    assert.ok(p.sunV > 0 && p.sunV < 0.6, `${part}: the sun sits in the sky, above the hills`);
  }
});

test("sceneColorAt: every sampled point is a valid colour, for every palette", () => {
  for (const part of PARTS) {
    for (let y = -20; y <= SCENE_H + 20; y += 13) {
      for (let x = -20; x <= SCENE_W + 20; x += 11) {
        for (const ch of sceneColorAt(x, y, SCENE_PALETTES[part])) {
          assert.ok(Number.isInteger(ch) && ch >= 0 && ch <= 255, `${part} (${x},${y}) channel ${ch}`);
        }
      }
    }
  }
});

test("sceneColorAt: the layers land where the composition puts them", () => {
  const p = SCENE_PALETTES.afternoon;
  // The soup sits inside the bowl's rim, just below the steam's origin.
  assert.deepEqual(sceneColorAt(STEAM_ORIGIN.x, STEAM_ORIGIN.y + 12, p), p.soup);
  // The table runs across the bottom edge of the frame.
  assert.deepEqual(sceneColorAt(SCENE_W - 5, SCENE_H - 5, p), p.table);
  // The sun is centred where its palette says, in the upper sky.
  assert.deepEqual(sceneColorAt(0.64 * SCENE_W, p.sunV * SCENE_H, p), p.sun);
});

test("the sun moves with the time of day — high in the afternoon, low at the ends", () => {
  assert.ok(SCENE_PALETTES.afternoon.sunV < SCENE_PALETTES.morning.sunV);
  assert.ok(SCENE_PALETTES.afternoon.sunV < SCENE_PALETTES.evening.sunV);
});

test("seededRandom is deterministic and stays in [0, 1)", () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  for (let i = 0; i < 200; i++) {
    const x = a();
    assert.equal(x, b(), "same seed, same sequence");
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(seededRandom(1)(), seededRandom(2)(), "different seeds diverge");
});

test("paintDots: the same box paints the same painting on every load", () => {
  const one = paintDots(120, 90, SCENE_PALETTES.evening);
  const two = paintDots(120, 90, SCENE_PALETTES.evening);
  assert.ok(one.length > 400, `a dense field of dots, got ${one.length}`);
  assert.deepEqual(one, two);
  for (const d of one.slice(0, 50)) {
    assert.ok(d.r > 0, "every dot has a size");
    assert.ok(Number.isFinite(d.x) && Number.isFinite(d.y));
  }
});

test("fitScene covers the box with no gap at any edge — portrait panel and phone strip alike", () => {
  for (const [cw, ch] of [
    [380, 520],
    [340, 150],
    [720, 300],
    [300, 400],
  ] as const) {
    const { scale, offsetX, offsetY } = fitScene(cw, ch);
    assert.ok(SCENE_W * scale >= cw - 0.001 && SCENE_H * scale >= ch - 0.001, `${cw}x${ch}: scene covers the box`);
    assert.ok(offsetX <= 0.001 && offsetY <= 0.001, `${cw}x${ch}: no gap at the top/left`);
    assert.ok(offsetX + SCENE_W * scale >= cw - 0.001, `${cw}x${ch}: no gap at the right`);
    assert.ok(offsetY + SCENE_H * scale >= ch - 0.001, `${cw}x${ch}: no gap at the bottom`);
  }
});

test("the steam's origin stays inside the box even in the short phone strip", () => {
  for (const [cw, ch] of [
    [380, 520],
    [340, 150],
  ] as const) {
    const o = sceneToBox(STEAM_ORIGIN.x, STEAM_ORIGIN.y, cw, ch);
    assert.ok(o.x > 0 && o.x < cw && o.y > 0 && o.y < ch, `${cw}x${ch}: steam starts at (${o.x.toFixed(0)},${o.y.toFixed(0)})`);
  }
});

test("paintBlocks tiles the whole box with valid colours — no gap for a single wash to show through", () => {
  const [cw, ch] = [97, 61];
  const blocks = paintBlocks(cw, ch, SCENE_PALETTES.morning);
  const right = Math.max(...blocks.map((b) => b.x + b.size));
  const bottom = Math.max(...blocks.map((b) => b.y + b.size));
  assert.ok(right >= cw && bottom >= ch, `blocks reach both far edges (${right}, ${bottom})`);
  assert.equal(Math.min(...blocks.map((b) => b.x)), 0);
  assert.equal(Math.min(...blocks.map((b) => b.y)), 0);
  for (const b of blocks) for (const c of b.color) assert.ok(c >= 0 && c <= 255);
});

test("the phone strip shows the WHOLE bowl — rim and base both inside the box", () => {
  // The strip is h-40 (160px) across a ~360px card.
  const [cw, ch] = [340, 160];
  const rim = sceneToBox(STEAM_ORIGIN.x, BOWL_RIM_V * SCENE_H, cw, ch);
  const base = sceneToBox(STEAM_ORIGIN.x, BOWL_BASE_V * SCENE_H, cw, ch);
  assert.ok(rim.y > 0, `rim below the top edge (${rim.y.toFixed(0)})`);
  assert.ok(base.y < ch, `base above the bottom edge (${base.y.toFixed(0)} < ${ch})`);
});

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const LAYERS = Array.from({ length: LAYER_COUNT }, (_, i) => i as Layer);

test("the reveal paints back to front — each layer starts after the one behind it, and all of it lands by the end", () => {
  for (const d of paintDots(240, 320, SCENE_PALETTES.afternoon)) assert.ok(d.at >= 0 && d.at < 1, `dot at ${d.at}`);
  for (const b of paintBlocks(240, 320, SCENE_PALETTES.afternoon)) assert.ok(b.at >= 0 && b.at < 1, `block at ${b.at}`);
  for (const layer of LAYERS.slice(1)) {
    assert.ok(revealAt(layer, 0) > revealAt((layer - 1) as Layer, 0), `layer ${layer} starts after ${layer - 1}`);
  }
  assert.ok(revealAt(LAYER.bowl, 0.999999) < 1, "the front layer's last dot still lands by the end");
  // And the painting really comes in that way: the dots that land in the
  // back half of the reveal sit lower in the frame than the ones that open it.
  const dots = paintDots(240, 320, SCENE_PALETTES.afternoon);
  const early = dots.filter((d) => d.at < revealAt(LAYER.sun, 0));
  const late = dots.filter((d) => d.at >= revealAt(LAYER.table, 0));
  assert.ok(early.length > 100 && late.length > 100, `both ends of the reveal have dots (${early.length}, ${late.length})`);
  assert.ok(median(late.map((d) => d.y)) > median(early.map((d) => d.y)), "sky first, foreground last");
});

test("a region's flat base fills in only once its dots are half down, so the gaps show paper first", () => {
  const [cw, ch] = [120, 160];
  const p = SCENE_PALETTES.morning;
  const { scale, offsetX, offsetY } = fitScene(cw, ch);
  for (const b of paintBlocks(cw, ch, p)) {
    const half = b.size / 2;
    const { layer } = sceneAt((b.x + half - offsetX) / scale, (b.y + half - offsetY) / scale, p);
    assert.ok(b.at > revealAt(layer, 0.5), `block at (${b.x},${b.y}) fills at ${b.at}`);
  }
});

test("the soup carries herbs, and the bowl is shaded — lighter towards the sun, never grey", () => {
  const p = SCENE_PALETTES.afternoon;
  const cx = BOWL_U * SCENE_W;
  const cy = BOWL_RIM_V * SCENE_H;
  let herbs = 0;
  for (let x = cx - 50; x <= cx + 50; x += 0.5) {
    for (let y = cy - 8; y <= cy + 8; y += 0.5) if (sceneColorAt(x, y, p).join() === p.herb.join()) herbs++;
  }
  assert.ok(herbs > 10, `herb leaves float on the soup (${herbs} samples)`);
  const lowLeft = sceneAt(cx - 30, cy + 25, p);
  const upRight = sceneAt(cx + 30, cy + 12, p);
  assert.equal(lowLeft.layer, LAYER.bowl);
  assert.equal(upRight.layer, LAYER.bowl);
  const lum = (c: readonly number[]) => c[0] + c[1] + c[2];
  assert.ok(lum(lowLeft.color) < lum(upRight.color), "the side away from the sun is darker");
  assert.ok(lowLeft.color[0] > lowLeft.color[2], "the shade is warm (the table's colour), not grey");
});
