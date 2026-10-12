/// <reference types="node" />
// The POS app's launcher icon (2026-10-12, the owner: the logo did not show outside the app, and both apps must carry
// the same logo). The Android app shows the Sandbee mark on the Windows app's red (apps/desktop/resources/icon.png),
// never the React Native template's robot: a launcher and a round PNG per density, and on Android 8+ an adaptive icon
// whose foreground mark stays inside the 66 dp safe zone of its 108 dp canvas, with a monochrome layer for Android 13
// themed icons. The PNGs are decoded here (8-bit RGB/RGBA, no interlace), so the pixels themselves are checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const ROOT = join(__dirname, '..');
const MAIN = join(ROOT, 'android', 'app', 'src', 'main');
const RES = join(MAIN, 'res');
const DESKTOP_ICON = join(ROOT, '..', 'desktop', 'resources', 'icon.png');
// density, launcher px (48 dp), adaptive foreground px (108 dp)
const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
] as const;
const WHITE = [255, 255, 255];

type Rgba = [number, number, number, number];
interface Png {
  width: number;
  height: number;
  pixel(x: number, y: number): Rgba;
}

function decodePng(file: string): Png {
  assert.ok(existsSync(file), `${file} exists`);
  const b = readFileSync(file);
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${file} is a PNG`);
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (at < b.length) {
    const len = b.readUInt32BE(at);
    const kind = b.toString('latin1', at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8] ?? 0;
      type = data[9] ?? 0;
      interlace = data[12] ?? 0;
    } else if (kind === 'IDAT') {
      idat.push(data);
    } else if (kind === 'IEND') {
      break;
    }
    at += 12 + len;
  }
  assert.ok(depth === 8 && (type === 2 || type === 6) && interlace === 0, `${file}: an 8-bit RGB or RGBA PNG, not interlaced`);
  const bpp = type === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? (out[y * stride + i - bpp] ?? 0) : 0;
      const up = y > 0 ? (out[(y - 1) * stride + i] ?? 0) : 0;
      const upLeft = y > 0 && i >= bpp ? (out[(y - 1) * stride + i - bpp] ?? 0) : 0;
      let v = raw[y * (stride + 1) + 1 + i] ?? 0;
      if (filter === 1) v += left;
      else if (filter === 2) v += up;
      else if (filter === 3) v += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[y * stride + i] = v % 256;
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => {
      const o = y * stride + x * bpp;
      return [out[o] ?? 0, out[o + 1] ?? 0, out[o + 2] ?? 0, bpp === 4 ? (out[o + 3] ?? 0) : 255];
    },
  };
}

const near = (a: readonly number[], b: readonly number[], tol = 12): boolean =>
  [0, 1, 2].every(i => Math.abs((a[i] ?? 0) - (b[i] ?? 0)) <= tol);
const desktopRed = (): Rgba => decodePng(DESKTOP_ICON).pixel(4, 4);

test('icon 1: the manifest names the launcher icon and its round form', () => {
  const manifest = readFileSync(join(MAIN, 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/, 'the launcher icon');
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/, 'its round form');
});

test("icon 2: Android 8+ draws an adaptive icon: the Sandbee mark on the Windows app's red, with a monochrome layer for themed icons", () => {
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    const file = join(RES, 'mipmap-anydpi-v26', `${name}.xml`);
    assert.ok(existsSync(file), `mipmap-anydpi-v26/${name}.xml exists`);
    const xml = readFileSync(file, 'utf8');
    assert.match(xml, /<adaptive-icon\b/, `${name}: an adaptive icon`);
    assert.match(xml, /<background android:drawable="@color\/ic_launcher_background"\s*\/>/, `${name}: the brand red behind`);
    assert.match(xml, /<foreground android:drawable="@mipmap\/ic_launcher_foreground"\s*\/>/, `${name}: the mark in front`);
    assert.match(xml, /<monochrome android:drawable="@mipmap\/ic_launcher_foreground"\s*\/>/, `${name}: the mark for themed icons`);
  }
  const colorsFile = join(RES, 'values', 'ic_launcher_background.xml');
  assert.ok(existsSync(colorsFile), 'values/ic_launcher_background.xml exists');
  const hex = /<color name="ic_launcher_background">#([0-9A-Fa-f]{6})<\/color>/.exec(readFileSync(colorsFile, 'utf8'))?.[1];
  assert.ok(hex !== undefined, 'the background colour is defined');
  const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const red = desktopRed();
  assert.ok(near(rgb, red, 6), `#${hex} is the Windows app icon's red (${red.slice(0, 3).join(', ')})`);
});

test('icon 3: every density has its launcher, round and foreground PNG at its size', () => {
  for (const [density, px, fg] of DENSITIES) {
    for (const [name, size] of [
      ['ic_launcher', px],
      ['ic_launcher_round', px],
      ['ic_launcher_foreground', fg],
    ] as const) {
      const png = decodePng(join(RES, `mipmap-${density}`, `${name}.png`));
      assert.deepEqual([png.width, png.height], [size, size], `mipmap-${density}/${name}.png is ${size}x${size}`);
    }
  }
});

test("icon 4: the launcher icon is the Sandbee mark on the Windows app's red, not the React Native template", () => {
  const red = desktopRed();
  for (const [density] of DENSITIES) {
    for (const name of ['ic_launcher', 'ic_launcher_round']) {
      const png = decodePng(join(RES, `mipmap-${density}`, `${name}.png`));
      const mid = Math.floor(png.height / 2);
      assert.ok(near(png.pixel(Math.round(png.width * 0.18), mid), red), `${density}/${name}: the background left of the mark is the brand red`);
      let white = 0;
      for (let y = Math.round(png.height * 0.3); y < png.height * 0.7; y++) {
        for (let x = Math.round(png.width * 0.3); x < png.width * 0.7; x++) {
          const p = png.pixel(x, y);
          if (p[3] > 200 && near(p, WHITE, 40)) white++;
        }
      }
      assert.ok(white > png.width * png.height * 0.03, `${density}/${name}: the white mark sits in the middle (${white} white pixels)`);
    }
    const round = decodePng(join(RES, `mipmap-${density}`, 'ic_launcher_round.png'));
    assert.equal(round.pixel(0, 0)[3], 0, `${density}: the round icon is transparent outside its circle`);
  }
});

test('icon 5: the adaptive foreground is the white mark alone, inside the 66 dp safe zone of its 108 dp canvas', () => {
  // The Windows icon's square maps to the 72 dp visible area, so the mark covers its share of the Windows icon times
  // (72/108)^2 of the foreground: the same logo at the same proportion.
  // Area is measured the same way on both: the Windows icon's whiteness (its green channel, from the red's to 255) and
  // the foreground's alpha, so anti-aliased edges count by how much they cover.
  const desktop = decodePng(DESKTOP_ICON);
  const redGreen = desktopRed()[1];
  let desktopArea = 0;
  for (let y = 0; y < desktop.height; y++) {
    for (let x = 0; x < desktop.width; x++) {
      desktopArea += Math.min(1, Math.max(0, (desktop.pixel(x, y)[1] - redGreen) / (255 - redGreen)));
    }
  }
  const expected = (desktopArea / (desktop.width * desktop.height)) * (72 / 108) ** 2;
  for (const [density, , fg] of DENSITIES) {
    const png = decodePng(join(RES, `mipmap-${density}`, 'ic_launcher_foreground.png'));
    const centre = fg / 2;
    const safe = (fg * 33) / 108;
    let area = 0;
    let outside = 0;
    let coloured = 0;
    for (let y = 0; y < fg; y++) {
      for (let x = 0; x < fg; x++) {
        const p = png.pixel(x, y);
        area += p[3] / 255;
        if (p[3] < 32) continue;
        if (!near(p, WHITE, 40)) coloured++;
        if (Math.hypot(x + 0.5 - centre, y + 0.5 - centre) > safe) outside++;
      }
    }
    const share = area / (fg * fg);
    assert.ok(
      share > expected * 0.85 && share < expected * 1.15,
      `${density}: the mark covers ${(share * 100).toFixed(2)} % of the canvas, the Windows icon's proportion is ${(expected * 100).toFixed(2)} %`,
    );
    assert.equal(coloured, 0, `${density}: the foreground is white only (the red is the background layer)`);
    assert.equal(outside, 0, `${density}: no part of the mark is outside the safe zone`);
  }
});
