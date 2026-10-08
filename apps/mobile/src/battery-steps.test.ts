import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTERY_BRANDS,
  BATTERY_SECTIONS,
  batteryBrandOf,
  batterySectionsFor,
  hasAutostartScreen,
} from './battery-steps';

// Phase 3 Session 3D (spec §9.5): the battery checklist's words, this phone's brand first.

test('every brand the app reports has its steps, once', () => {
  assert.deepEqual(
    BATTERY_SECTIONS.map(s => s.brand),
    [...BATTERY_BRANDS],
  );
  for (const section of BATTERY_SECTIONS) {
    assert.ok(section.steps.length >= 2, section.brand + ' has steps');
    for (const step of section.steps) {
      assert.ok(step.endsWith('.'), 'a step is a sentence: ' + step);
    }
  }
});

test("this phone's steps come first; an unknown brand reads as other", () => {
  assert.equal(batterySectionsFor('vivo')[0]?.brand, 'vivo');
  assert.equal(batterySectionsFor('vivo').length, BATTERY_SECTIONS.length);
  assert.equal(batteryBrandOf('samsung'), 'samsung');
  assert.equal(batteryBrandOf('Huawei'), 'other');
  assert.equal(batteryBrandOf(undefined), 'other');
  assert.equal(batterySectionsFor(batteryBrandOf('nokia'))[0]?.brand, 'other');
});

test('only the four brands with their own screen offer the autostart link', () => {
  assert.deepEqual(
    BATTERY_BRANDS.filter(hasAutostartScreen),
    ['xiaomi', 'oppo', 'vivo', 'samsung'],
  );
});
