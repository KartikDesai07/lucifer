/// <reference types="node" />
// Pins for src/screens/auto-retry.ts and backstop.ts (pure; node:test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEALTHY_LOAD_MS,
  MAX_AUTO_RETRIES,
  RETRY_DELAY_MS,
  canAutoRetry,
  usedAfterFailure,
} from './auto-retry';
import {
  BACKSTOP_WINDOW_MS,
  EXTERNAL_OPEN_DEDUPE_MS,
  MAX_BACKSTOP_RECOVERIES,
  isDuplicateOpen,
  spendRecovery,
} from './backstop';

test('auto-retry constants: a short delay, a capped count, a healthy-run reset', () => {
  assert.equal(RETRY_DELAY_MS, 15_000);
  assert.equal(MAX_AUTO_RETRIES, 40);
  assert.equal(HEALTHY_LOAD_MS, 60_000);
  assert.ok(RETRY_DELAY_MS * MAX_AUTO_RETRIES >= 5 * 60_000, 'covers minutes');
});

test('canAutoRetry: only while the app is active and attempts remain', () => {
  assert.equal(canAutoRetry(0, 'active'), true);
  assert.equal(canAutoRetry(MAX_AUTO_RETRIES - 1, 'active'), true);
  assert.equal(canAutoRetry(MAX_AUTO_RETRIES, 'active'), false);
  assert.equal(canAutoRetry(MAX_AUTO_RETRIES + 5, 'active'), false);
  assert.equal(canAutoRetry(0, 'background'), false);
  assert.equal(canAutoRetry(0, 'inactive'), false);
  assert.equal(canAutoRetry(0, 'unknown'), false);
  assert.equal(canAutoRetry(0, ''), false);
});

test('usedAfterFailure: a quick failure keeps the count, a healthy run resets it', () => {
  assert.equal(usedAfterFailure(7, 0), 7);
  assert.equal(usedAfterFailure(7, HEALTHY_LOAD_MS - 1), 7);
  assert.equal(usedAfterFailure(7, HEALTHY_LOAD_MS), 0);
  assert.equal(usedAfterFailure(39, HEALTHY_LOAD_MS * 10), 0);
});

test('spendRecovery: three per window, then refused; old ones expire', () => {
  assert.equal(MAX_BACKSTOP_RECOVERIES, 3);
  let times: number[] = [];
  const t0 = 1_000_000;
  for (let i = 0; i < MAX_BACKSTOP_RECOVERIES; i += 1) {
    const r = spendRecovery(times, t0 + i);
    assert.equal(r.allowed, true, 'recovery ' + i);
    times = r.times;
  }
  const refused = spendRecovery(times, t0 + 10);
  assert.equal(refused.allowed, false);
  assert.equal(refused.times.length, MAX_BACKSTOP_RECOVERIES);
  // The oldest expires exactly one window after it was spent.
  assert.equal(
    spendRecovery(times, t0 + BACKSTOP_WINDOW_MS - 1).allowed,
    false,
  );
  const later = spendRecovery(times, t0 + BACKSTOP_WINDOW_MS);
  assert.equal(later.allowed, true);
  assert.equal(later.times.length, MAX_BACKSTOP_RECOVERIES);
});

test('isDuplicateOpen: the same page within the window is a duplicate', () => {
  const last = { url: 'https://other.example.com/', at: 5_000 };
  assert.equal(isDuplicateOpen(null, last.url, 5_001), false);
  assert.equal(isDuplicateOpen(last, last.url, 5_001), true);
  assert.equal(
    isDuplicateOpen(last, last.url, 5_000 + EXTERNAL_OPEN_DEDUPE_MS - 1),
    true,
  );
  assert.equal(
    isDuplicateOpen(last, last.url, 5_000 + EXTERNAL_OPEN_DEDUPE_MS),
    false,
  );
  assert.equal(
    isDuplicateOpen(last, 'https://third.example.com/', 5_001),
    false,
  );
});
