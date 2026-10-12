// Native apps 2.0 (spec §6.2, §6.3): what the update card shows, as a pure reducer (node tests in update-card.test.ts).
// The app hands a card out only at an app open (Kotlin's UpdateSchedule); here it shows while the app is in view and
// goes when the app goes to the background (never later in a session), except while Android's own screens are up for
// an install the card started ("Install unknown apps", the installer's dialog). Later closes it until the next open.

import type { InstallAnswer, UpdateCardInfo } from './native/PosUpdate';

export type CardState = {
  card: UpdateCardInfo | null;
  note: 'none' | 'permission' | 'failed';
  waiting: 'none' | 'permission' | 'installer';
  active: boolean;
};

export type CardEvent =
  | { type: 'card'; info: UpdateCardInfo }
  | { type: 'appState'; state: string }
  | { type: 'installing' }
  | { type: 'install'; answer: InstallAnswer }
  | { type: 'later' }
  | { type: 'installFailed' };

export const CARD_START: CardState = {
  card: null,
  note: 'none',
  waiting: 'none',
  active: true,
};

const VERSION = /^\d{1,3}\.\d{1,2}\.\d{1,2}$/;
const MAX_NOTES_CHARS = 300;

/** A card from the app (its answer or its event), or null when it is not one. */
export function asCardInfo(value: unknown): UpdateCardInfo | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { version, notes } = value as { version?: unknown; notes?: unknown };
  if (typeof version !== 'string' || !VERSION.test(version)) {
    return null;
  }
  if (typeof notes !== 'string' || notes.length > MAX_NOTES_CHARS) {
    return null;
  }
  return { version, notes };
}

function closed(state: CardState): CardState {
  return { ...state, card: null, note: 'none', waiting: 'none' };
}

function installed(state: CardState, answer: InstallAnswer): CardState {
  switch (answer) {
    case 'started':
      return { ...state, note: 'none', waiting: 'installer' };
    case 'permission':
      return { ...state, note: 'permission', waiting: 'permission' };
    case 'failed':
      return { ...state, note: 'failed', waiting: 'none' };
    case 'missing':
      return closed(state);
  }
}

export function reduceCard(state: CardState, event: CardEvent): CardState {
  switch (event.type) {
    case 'card':
      return state.active
        ? { ...state, card: event.info, note: 'none', waiting: 'none' }
        : state;
    case 'appState': {
      const active = event.state === 'active';
      if (active) {
        // Back from "Install unknown apps": the note says what to do next.
        const waiting = state.waiting === 'permission' ? 'none' : state.waiting;
        return { ...state, active, waiting };
      }
      if (event.state === 'background' && state.waiting === 'none') {
        return { ...closed(state), active };
      }
      return { ...state, active };
    }
    case 'installing':
      // Install was tapped: Android's own screens may come before the app's answer.
      return state.card === null
        ? state
        : { ...state, note: 'none', waiting: 'installer' };
    case 'install':
      return state.card === null ? state : installed(state, event.answer);
    case 'later':
      return closed(state);
    case 'installFailed':
      return state.card === null
        ? state
        : { ...state, note: 'failed', waiting: 'none' };
  }
}
