// Native apps 2.0 (spec §6.2, §6.3): the update card's rules, as the POS screen applies them to what the app hands out
// at an app open. Never in the middle of work: a card that arrives while the app is hidden is dropped, and going to the
// background drops it, except while Android's own screens are up for an install the card started.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asCardInfo, CARD_START, reduceCard, type CardState } from './update-card';

const info = { version: '2.0.1', notes: 'Faster printing.' };
const shown = (state: CardState = CARD_START) => reduceCard(state, { type: 'card', info });

test('a card that arrives while the app is in view shows; while the app is hidden it is dropped', () => {
  assert.deepEqual(shown().card, info);
  const hidden = reduceCard(CARD_START, { type: 'appState', state: 'background' });
  assert.equal(shown(hidden).card, null, 'never shown later, when the app comes back');
  assert.equal(reduceCard(shown(hidden), { type: 'appState', state: 'active' }).card, null);
});

test('going to the background drops the card: never later in a session', () => {
  const away = reduceCard(shown(), { type: 'appState', state: 'background' });
  assert.equal(away.card, null);
  assert.equal(reduceCard(away, { type: 'appState', state: 'active' }).card, null);
});

test('Install the first time: the card stays across the "Install unknown apps" page, with what to do next', () => {
  const asked = reduceCard(shown(), { type: 'install', answer: 'permission' });
  assert.equal(asked.note, 'permission');
  const settings = reduceCard(asked, { type: 'appState', state: 'background' });
  assert.deepEqual(settings.card, info, "Android's settings page is not the app going away");
  const back = reduceCard(settings, { type: 'appState', state: 'active' });
  assert.deepEqual(back.card, info);
  assert.equal(back.note, 'permission');
  assert.equal(back.waiting, 'none', 'back on the card: going away now drops it again');
  assert.equal(reduceCard(back, { type: 'appState', state: 'background' }).card, null);
});

test("Install started: the card stays while Android's dialog is up; a failed or cancelled install says so", () => {
  const started = reduceCard(shown(), { type: 'install', answer: 'started' });
  const dialog = reduceCard(started, { type: 'appState', state: 'background' });
  assert.deepEqual(dialog.card, info, "Android's install dialog is not the app going away");
  const cancelled = reduceCard(reduceCard(dialog, { type: 'appState', state: 'active' }), { type: 'installFailed' });
  assert.deepEqual(cancelled.card, info);
  assert.equal(cancelled.note, 'failed');
  assert.equal(reduceCard(shown(), { type: 'install', answer: 'failed' }).note, 'failed');
  assert.equal(reduceCard(CARD_START, { type: 'installFailed' }).card, null, 'no card, nothing to say');
});

test('Later, or an update whose file is gone, closes the card', () => {
  assert.equal(reduceCard(shown(), { type: 'later' }).card, null);
  assert.equal(reduceCard(shown(), { type: 'install', answer: 'missing' }).card, null);
  const later = reduceCard(reduceCard(shown(), { type: 'install', answer: 'permission' }), { type: 'later' });
  assert.equal(later.note, 'none');
  assert.equal(later.waiting, 'none');
});

test("Install tapped: Android's screens may come before the app's answer, and the card stays", () => {
  // The N2 review's #3: on a slow phone the app can go to the background before install() answers.
  const tapped = reduceCard(shown(), { type: 'installing' });
  const settings = reduceCard(tapped, { type: 'appState', state: 'background' });
  assert.deepEqual(settings.card, info, 'the app going away right after Install is Android asking');
  const asked = reduceCard(settings, { type: 'install', answer: 'permission' });
  assert.equal(asked.note, 'permission');
  assert.deepEqual(reduceCard(asked, { type: 'appState', state: 'active' }).card, info);
  assert.equal(reduceCard(CARD_START, { type: 'installing' }).card, null, 'no card, nothing to wait for');
});

test('only a well-formed card is shown', () => {
  assert.deepEqual(asCardInfo({ version: '2.0.1', notes: '' }), { version: '2.0.1', notes: '' });
  for (const bad of [null, 'x', { version: '2.0', notes: '' }, { version: '2.0.1' }, { version: 2, notes: '' }, { version: '2.0.1', notes: 'x'.repeat(301) }]) {
    assert.equal(asCardInfo(bad), null, JSON.stringify(bad));
  }
});
